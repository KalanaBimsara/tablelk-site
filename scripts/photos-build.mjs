#!/usr/bin/env node
/**
 * Runs before `vite build`. The site's photos are full-size JPEGs on cubeupload and in
 * Supabase storage (up to 1 MB each), which made phones wait about 7 seconds for the main
 * photo. This script downloads every photo the site shows, saves small WebP copies in three
 * widths under public/photos/ and records them in src/lib/photo-manifest.json. The app
 * (src/lib/photo.ts) then serves the small copy that fits the screen and falls back to the
 * original address for any photo that is not in the manifest, for example one uploaded in
 * the admin dashboard after the last build.
 *
 * Photos come from two places: addresses written in src/ and the products, carousel and
 * review rows in Supabase. Results are cached in node_modules/.cache, so only new photos
 * are downloaded on the next build. Nothing here can fail the build: a photo that cannot be
 * fetched keeps its original address, and without the `sharp` package the step is skipped.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { env, rows, PHOTO_MANIFEST } from "./shared.mjs";

const TAG = "photos-build";
const OUT = path.resolve("public/photos");
const CACHE = path.resolve("node_modules/.cache/tablelk-photos");
const WIDTHS = [480, 960, 1600];
const QUALITY = 72;
/** Part of every file name: change WIDTHS or QUALITY and the names change, so browsers never keep a stale copy. */
const VERSION = `v1-${WIDTHS.join("-")}-q${QUALITY}`;
const MAX_BYTES = 30 * 1024 * 1024;

const writeManifest = (manifest) => {
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(PHOTO_MANIFEST, `${JSON.stringify(sorted, null, 1)}\n`);
};

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.warn(`${TAG}: the "sharp" package is not installed; photos keep their original addresses.`);
  writeManifest({});
  process.exit(0);
}

// ---- which photos does the site show? ----
const hosts = new Set(["u.cubeupload.com"]);
try {
  hosts.add(new URL(env.VITE_SUPABASE_URL).host);
} catch {
  /* no Supabase URL: only the photos written in src/ */
}
const urls = new Set();
const add = (u) => {
  try {
    if (typeof u === "string" && hosts.has(new URL(u).host)) urls.add(u);
  } catch {
    /* not an absolute address (for example /placeholder.svg) */
  }
};

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
for (const file of walk(path.resolve("src"))) {
  for (const m of fs.readFileSync(file, "utf8").matchAll(/https:\/\/[^\s"'`<>)]+?\.(?:jpe?g|png|webp)/gi)) add(m[0]);
}

const [products, slides, reviews] = await Promise.all([
  rows("products", "select=images,image_url", TAG),
  rows("hero_slides", "select=image_url&active=eq.true", TAG),
  rows("customer_reviews", "select=images&published=eq.true", TAG),
]);
for (const p of products) [p.image_url, ...(p.images || [])].forEach(add);
for (const s of slides) add(s.image_url);
for (const r of reviews) (r.images || []).forEach(add);

// ---- make the small copies ----
fs.mkdirSync(CACHE, { recursive: true });
const idFor = (url) => crypto.createHash("sha1").update(`${VERSION}|${url}`).digest("hex").slice(0, 12);
const fileName = (id, w) => `${id}-${w}.webp`;

const build = async (url) => {
  const id = idFor(url);
  const metaFile = path.join(CACHE, `${id}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    if (cached.widths.every((w) => fs.existsSync(path.join(CACHE, fileName(id, w))))) return cached;
  } catch {
    /* not cached yet */
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!/^image\//.test(res.headers.get("content-type") || "")) throw new Error("not an image");
  const input = Buffer.from(await res.arrayBuffer());
  if (input.length > MAX_BYTES) throw new Error("larger than 30 MB");

  const info = await sharp(input, { failOn: "none" }).metadata();
  const turned = (info.orientation ?? 1) >= 5; // the camera saved it sideways
  const w = turned ? info.height : info.width;
  const h = turned ? info.width : info.height;
  if (!w || !h) throw new Error("unknown size");
  const top = Math.min(w, WIDTHS[WIDTHS.length - 1]);
  const widths = [...WIDTHS.filter((x) => x < top), top];
  for (const width of widths) {
    await sharp(input, { failOn: "none" }).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: QUALITY }).toFile(path.join(CACHE, fileName(id, width)));
  }
  const entry = { id, w, h, widths, bytes: input.length };
  fs.writeFileSync(metaFile, JSON.stringify(entry));
  return entry;
};

const manifest = {};
const queue = [...urls];
let failed = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        manifest[url] = await build(url);
      } catch (e) {
        failed++;
        console.warn(`${TAG}: ${url} skipped (${e.message}).`);
      }
    }
  }),
);

// ---- publish: public/photos holds exactly the files in the manifest ----
fs.mkdirSync(OUT, { recursive: true });
const wanted = new Set(Object.values(manifest).flatMap((e) => e.widths.map((w) => fileName(e.id, w))));
for (const f of fs.readdirSync(OUT)) if (!wanted.has(f)) fs.unlinkSync(path.join(OUT, f));
let before = 0;
let after = 0;
for (const e of Object.values(manifest)) {
  before += e.bytes;
  for (const w of e.widths) {
    const to = path.join(OUT, fileName(e.id, w));
    if (!fs.existsSync(to)) fs.copyFileSync(path.join(CACHE, fileName(e.id, w)), to);
  }
  after += fs.statSync(path.join(OUT, fileName(e.id, e.widths[Math.min(1, e.widths.length - 1)]))).size;
}
writeManifest(Object.fromEntries(Object.entries(manifest).map(([url, { id, w, h, widths }]) => [url, { id, w, h, widths }])));

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
console.log(
  `${TAG}: ${Object.keys(manifest).length} photos${failed ? `, ${failed} skipped` : ""}. Originals ${mb(before)}; the mid-size copies phones load ${mb(after)}.`,
);
