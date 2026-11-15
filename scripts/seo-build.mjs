#!/usr/bin/env node
/**
 * Runs after `vite build`. The site is a single-page app, so without this step every URL
 * serves the same HTML with the home page's title. This script writes a real HTML file for
 * each public page and each product (dist/shop.html, dist/product/<id>.html ...) carrying
 * that page's own title, description, canonical URL, share image, structured data and a
 * plain-HTML summary for crawlers that do not run JavaScript.
 *
 * Files are named <route>.html, not <route>/index.html: Cloudflare Pages and Netlify both
 * serve shop.html at /shop, while shop/index.html makes Cloudflare redirect to /shop/.
 *
 * It also writes:
 *   - a "noindex" page for every private route (sign-in, checkout, admin ...),
 *   - dist/404.html, which the host serves with status 404 for any other address. It is the
 *     app itself, so a product added after the last build still opens for visitors,
 *   - dist/sitemap.xml and dist/llms.txt.
 *
 * Titles, descriptions and structured data come from src/lib/seo.ts and src/lib/seo.json,
 * the same code the React pages use, so the static and the live markup cannot drift apart.
 * Products, reviews and the first carousel photo are read from Supabase with the public
 * key; if that fails those parts are skipped and the build still succeeds.
 */
import fs from "node:fs";
import path from "node:path";
import { buildSync } from "esbuild";
import { rows as readRows, readPhotoManifest } from "./shared.mjs";

const DIST = path.resolve("dist");
const today = new Date().toISOString().slice(0, 10);

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error("seo-build: dist/index.html not found. Run `vite build` first.");
  process.exit(1);
}

/** Loads a TypeScript module from src/ (bundled in memory by esbuild, which ships with Vite). */
const loadTs = async (entry) => {
  const out = buildSync({ entryPoints: [path.resolve(entry)], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
};
const { policyConfig } = await loadTs("src/lib/policyConfig.ts");
const seo = await loadTs("src/lib/seo.ts");
const routes = JSON.parse(fs.readFileSync(path.resolve("src/lib/seo.json"), "utf8"));
const SITE = policyConfig.website.replace(/\/+$/, "");
// Small WebP copies of the photos (scripts/photos-build.mjs). Empty when that step was skipped.
const photoSet = await loadTs("src/lib/photoSet.ts");
const photos = readPhotoManifest();
const rows = (table, query) => readRows(table, query, "seo-build");

/** Pages that must stay out of search results. Each gets its own file so it answers "200 OK". */
const PRIVATE_ROUTES = {
  "/login": "Sign in",
  "/register": "Create an account",
  "/forgot-password": "Forgot password",
  "/reset-password": "Reset password",
  "/checkout": "Checkout",
  "/my-orders": "My orders",
  "/payment/success": "Payment",
  "/payment/cancel": "Payment",
  "/admin": "Admin",
  "/admin/login": "Admin sign in",
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const plain = (s, max = 300) =>
  String(s || "")
    .replace(/[^\p{L}\p{N}\p{P}\p{Zs}\n]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const rupees = (n) => `Rs. ${Math.round(n).toLocaleString("en-LK")}`;

/** Same shape as mapRow in src/hooks/useProducts.ts, so src/lib/seo.ts can describe it. */
const toProduct = (r) => ({
  id: r.id,
  name: r.name,
  description: r.description ?? "",
  shortDescription: r.short_description ?? "",
  price: Number(r.price) || 0,
  images: (r.images && r.images.length ? r.images : [r.image_url]).filter(Boolean),
  categories: r.categories?.length ? r.categories : r.category ? [r.category] : [],
  material: r.material ?? "",
  inStock: (r.stock ?? 0) > 0,
  updated: String(r.updated_at || r.created_at || today).slice(0, 10),
});

const [productRows, reviewRows, slideRows] = await Promise.all([
  rows("products", "select=*&order=sort_order.asc,created_at.desc"),
  rows("customer_reviews", "select=customer_name,rating,review,review_date,product_id&published=eq.true&order=sort_order.asc,review_date.desc"),
  rows("hero_slides", "select=image_url&active=eq.true&order=sort_order.asc,created_at.asc&limit=1"),
]);
const products = productRows.map(toProduct);
const reviewsFor = (id) => reviewRows.filter((r) => r.product_id === id);

// The business markup in index.html gains the real price range of the catalogue.
let base = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
// With small copies served from this site, the early connection to the photo host is wasted.
if (Object.keys(photos).length) base = base.replace(/\s*<link rel="preconnect" href="https:\/\/u\.cubeupload\.com" \/>/, "");
const prices = products.map((p) => p.price).filter((n) => n > 0);
if (prices.length) {
  base = base.replace(
    '"currenciesAccepted": "LKR",',
    `"currenciesAccepted": "LKR",\n        "priceRange": "${rupees(Math.min(...prices))} to ${rupees(Math.max(...prices))}",`,
  );
}

const NAV = [
  ["/", "Home"],
  ["/shop", "Shop tables"],
  ["/design", "Design a table"],
  ["/about", "About"],
  ["/contact", "Contact"],
];

/**
 * Returns the base HTML with this page's head tags, structured data and a no-JavaScript summary.
 * `preload` is the page's main photo and the `sizes` value of its <img>: the browser starts
 * fetching the copy that fits the screen before the app has loaded.
 */
const render = ({ route, title, description, image, jsonLd, body, noindex, preload }) => {
  const url = `${SITE}${route === "/" ? "/" : route}`;
  let html = base
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="title" content=")[^"]*/, `$1${esc(title)}`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${esc(description)}`)
    .replace(/(<link rel="canonical" href=")[^"]*/, `$1${url}`)
    .replace(/(<meta property="(?:og|twitter):url" content=")[^"]*/g, `$1${url}`)
    .replace(/(<meta property="(?:og|twitter):title" content=")[^"]*/g, `$1${esc(title)}`)
    .replace(/(<meta property="(?:og|twitter):description" content=")[^"]*/g, `$1${esc(description)}`);
  if (image) html = html.replace(/(<meta property="(?:og|twitter):image" content=")[^"]*/g, `$1${esc(seo.absoluteUrl(image))}`);
  if (noindex) {
    html = html
      .replace(/(<meta name="robots" content=")[^"]*/, "$1noindex, nofollow")
      .replace(/\s*<link rel="canonical"[^>]*>/, "");
  }
  if (preload?.url) {
    const a = photoSet.photoAttrs(photos, preload.url, preload.sizes);
    const set = a.srcSet ? ` imagesrcset="${esc(a.srcSet)}" imagesizes="${esc(a.sizes)}"` : "";
    html = html.replace("<title>", `<link rel="preload" as="image" href="${esc(a.src)}"${set} fetchpriority="high" />
    <title>`);
  }
  if (jsonLd) {
    const data = JSON.stringify(jsonLd).replace(/</g, "\\u003c");
    html = html.replace("</head>", `  <script type="application/ld+json" id="page-jsonld">${data}</script>\n  </head>`);
  }
  const summary = `<noscript><h1>${esc(title)}</h1><p>${esc(description)}</p>${body || ""}<nav>${NAV.map(
    ([href, label]) => `<a href="${href}">${label}</a>`,
  ).join(" ")}</nav></noscript>`;
  return html.replace('<div id="root"></div>', `<div id="root">${summary}</div>`);
};

const write = (route, html) => {
  const file = route === "/" ? path.join(DIST, "index.html") : path.join(DIST, `${route}.html`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
};

const productLinks = products
  .map((p) => `<li><a href="/product/${p.id}">${esc(p.name)}</a> ${rupees(p.price)}</li>`)
  .join("");
const faqHtml = seo.HOME_FAQS.map((f) => `<h2>${esc(f.q)}</h2><p>${esc(f.a)}</p>`).join("");

// Fixed pages
for (const [route, meta] of Object.entries(routes)) {
  const list = productLinks ? `<ul>${productLinks}</ul>` : "";
  const page = { route, title: meta.title, description: meta.description };
  if (route === "/") {
    Object.assign(page, { body: list + faqHtml, jsonLd: seo.faqLd(seo.HOME_FAQS), preload: { url: slideRows[0]?.image_url, sizes: photoSet.SIZES.full } });
  } else if (route === "/shop") {
    Object.assign(page, { body: list, jsonLd: products.length ? seo.itemListLd(products) : undefined });
  }
  write(route, render(page));
}

// Product pages
for (const p of products) {
  const route = `/product/${p.id}`;
  const { title, description } = seo.productSeo(p);
  const gallery = p.images.filter((src) => !src.includes("placeholder"));
  const jsonLd = [
    seo.productLd(p, reviewsFor(p.id)),
    seo.breadcrumbLd([
      { name: "Home", path: "/" },
      { name: "Shop", path: "/shop" },
      { name: p.name, path: route },
    ]),
  ];
  const body = `${gallery[0] ? `<img src="${esc(seo.absoluteUrl(gallery[0]))}" alt="${esc(p.name)}" width="600">` : ""}<p>${rupees(
    p.price,
  )}</p><p>${esc(plain(p.description, 1200))}</p>`;
  write(route, render({ route, title, description, image: gallery[0], jsonLd, body, preload: { url: gallery[0], sizes: photoSet.SIZES.productMain } }));
}

// Private pages: the app with a "noindex" rule already in the HTML.
for (const [route, name] of Object.entries(PRIVATE_ROUTES)) {
  write(route, render({ route, title: `${name} | ${policyConfig.brandName}`, description: `${name} on ${SITE.replace("https://", "")}.`, noindex: true }));
}

// Any other address: served by the host with status 404.
fs.writeFileSync(
  path.join(DIST, "404.html"),
  render({
    route: "/404",
    title: `Page not found | ${policyConfig.brandName}`,
    description: "There is no page at this address.",
    noindex: true,
  }),
);

// Sitemap
const urls = [
  ...Object.entries(routes).map(([route, meta]) => ({
    loc: `${SITE}${route === "/" ? "/" : route}`,
    lastmod: today,
    changefreq: meta.changefreq || "monthly",
    priority: meta.priority || "0.5",
  })),
  ...products.map((p) => ({ loc: `${SITE}/product/${p.id}`, lastmod: p.updated, changefreq: "weekly", priority: "0.8" })),
];
fs.writeFileSync(
  path.join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (u) =>
        `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`,
    )
    .join("\n")}\n</urlset>\n`,
);

// llms.txt: a plain-text summary of the business and its pages for AI assistants.
const md = (s) => String(s).replace(/[[\]]/g, "");
fs.writeFileSync(
  path.join(DIST, "llms.txt"),
  [
    `# ${policyConfig.brandName}`,
    "",
    `> ${routes["/"].description}`,
    "",
    `${policyConfig.brandName} makes tables in its own workshop at ${policyConfig.address} and sells them direct. Tops are 15 mm melamine board on a 1.5 inch powder-coated steel frame. Every table can be made to a custom size.`,
    "",
    "## Pages",
    "",
    ...Object.entries(routes).map(([route, meta]) => `- [${md(meta.title)}](${SITE}${route === "/" ? "/" : route}): ${meta.description}`),
    "",
    ...(products.length
      ? ["## Tables and prices", "", ...products.map((p) => `- [${md(p.name)}](${SITE}/product/${p.id}): ${rupees(p.price)}${p.shortDescription ? `. ${plain(p.shortDescription, 160)}` : ""}`), ""]
      : []),
    "## Ordering and delivery",
    "",
    ...seo.HOME_FAQS.map((f) => `- ${f.q} ${f.a}`),
    "",
    "## Contact",
    "",
    `- Phone and WhatsApp: ${policyConfig.phone}`,
    `- Email: ${policyConfig.email}`,
    `- Address: ${policyConfig.address}`,
    `- Hours: ${policyConfig.businessHours}`,
    "",
  ].join("\n"),
);

console.log(
  `seo-build: ${Object.keys(routes).length} pages, ${products.length} product pages, ${Object.keys(PRIVATE_ROUTES).length} private pages, 404 page, llms.txt, sitemap with ${urls.length} URLs.`,
);
