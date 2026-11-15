Keep the shared fixed-header offset in Layout for non-home pages; the home slideshow intentionally sits behind the header, so page-level top offsets must not duplicate the shared spacing.
The header height is the CSS variable `--header-h` (src/index.css). Layout applies it with `pt-header`; sticky panels use `top-header` and anchor targets use `scroll-mt-header`, never fixed values like `top-20`.

Every route needs its own HTML file, written by scripts/seo-build.mjs after `vite build`: public pages are listed in src/lib/seo.json, private pages (noindex) in `PRIVATE_ROUTES` in that script. A route in neither list still opens, but the host answers it with 404.html and status 404. Hosting is Cloudflare Pages (public/_headers, public/_redirects); there is no catch-all rewrite.

Design system: tokens and utilities in src/index.css and tailwind.config.ts, motion primitives in src/components/motion.tsx, product truth in PRODUCT.md. Use real Table LK photos only (src/lib/photos.ts) and render them with `photo(url, SIZES.x)` from src/lib/photo.ts, which serves the small WebP copies made by scripts/photos-build.mjs; format prices with `formatPrice` from src/lib/format.ts.
