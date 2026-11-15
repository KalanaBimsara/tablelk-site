-- Security hardening (2026-11-15). Safe to run more than once.
--
-- HOW TO APPLY: Supabase Dashboard -> SQL Editor -> New query -> paste this whole
-- file -> Run. It runs in one transaction: if anything fails, nothing is applied.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Remove the admin backdoor.
--    The sign-up trigger used to hand the admin role to whoever registered the
--    address kalanabimsara@tablelk.com. Sign-ups need no email confirmation, so
--    the first person to register that address became an admin. New accounts now
--    only get a profile. Admin rights are granted by an existing admin (Users tab)
--    or by the database owner here in the SQL editor:
--      INSERT INTO public.user_roles (user_id, role)
--      SELECT id, 'admin' FROM auth.users WHERE email = '<address>'
--      ON CONFLICT DO NOTHING;
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    left(COALESCE(NEW.raw_user_meta_data->>'full_name', ''), 200),
    left(COALESCE(NEW.raw_user_meta_data->>'avatar_url', ''), 1000)
  );
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Stop anonymous visitors from testing which email addresses have accounts.
--    Sign-up itself already reports a duplicate address.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.check_email_exists(text);

-- ---------------------------------------------------------------------------
-- 3. Cash-on-delivery and WhatsApp orders: never trust prices sent by the browser.
--    The browser used to send item names, prices and the total, so anyone could
--    file an order for Rs. 1. Names, prices, subtotal and total are now rebuilt
--    from the products table, and field lengths are capped.
--    Card orders are created by the payhere-checkout function, which already
--    prices from the database, so they pass through untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_order_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  it jsonb;
  p record;
  qty integer;
  new_items jsonb := '[]'::jsonb;
  sub numeric := 0;
BEGIN
  IF NEW.payment_method = 'card' THEN
    RETURN NEW;
  END IF;

  IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN
    RAISE EXCEPTION 'Order items are missing' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(NEW.items) < 1 OR jsonb_array_length(NEW.items) > 20 THEN
    RAISE EXCEPTION 'An order needs between 1 and 20 items' USING ERRCODE = '22023';
  END IF;

  FOR it IN SELECT value FROM jsonb_array_elements(NEW.items) LOOP
    IF COALESCE(it->>'quantity', '') !~ '^[0-9]{1,3}$' THEN
      RAISE EXCEPTION 'Item quantity must be a whole number' USING ERRCODE = '22023';
    END IF;
    qty := (it->>'quantity')::integer;
    IF qty < 1 OR qty > 20 THEN
      RAISE EXCEPTION 'Item quantity must be between 1 and 20' USING ERRCODE = '22023';
    END IF;

    IF COALESCE(it->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'An item in this order is no longer available' USING ERRCODE = '22023';
    END IF;
    SELECT id, name, price INTO p FROM public.products WHERE id = (it->>'product_id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'An item in this order is no longer available' USING ERRCODE = '22023';
    END IF;

    sub := sub + p.price * qty;
    new_items := new_items || jsonb_strip_nulls(jsonb_build_object(
      'product_id', p.id,
      'name', p.name,
      'price', p.price,
      'quantity', qty,
      'color', NULLIF(left(btrim(COALESCE(it->>'color', '')), 50), '')
    ));
  END LOOP;

  NEW.items := new_items;
  NEW.subtotal := sub;
  -- Delivery is free today (policyConfig.deliveryFee). When a real fee is set,
  -- compute it here from NEW.district instead of accepting the browser's figure.
  NEW.delivery_fee := GREATEST(COALESCE(NEW.delivery_fee, 0), 0);
  NEW.total := sub + NEW.delivery_fee;

  IF NEW.order_ref !~ '^TLK-[0-9]{6}-[A-Z0-9]{5}$' THEN
    RAISE EXCEPTION 'Invalid order reference' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(COALESCE(NEW.customer_name, ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Customer name is missing or too long' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(NEW.customer_email, '')) > 320
     OR char_length(COALESCE(NEW.customer_phone, '')) > 50
     OR char_length(COALESCE(NEW.shipping_address, '')) > 1000
     OR char_length(COALESCE(NEW.city, '')) > 100
     OR char_length(COALESCE(NEW.district, '')) > 100
     OR char_length(COALESCE(NEW.notes, '')) > 2000 THEN
    RAISE EXCEPTION 'One of the order fields is too long' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_enforce_integrity ON public.orders;
CREATE TRIGGER orders_enforce_integrity
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_order_integrity();

-- ---------------------------------------------------------------------------
-- 4. The public image bucket only accepts images, up to 15 MB each.
-- ---------------------------------------------------------------------------
UPDATE storage.buckets
SET file_size_limit = 15728640,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
WHERE id = 'product-images';

NOTIFY pgrst, 'reload schema';

COMMIT;
