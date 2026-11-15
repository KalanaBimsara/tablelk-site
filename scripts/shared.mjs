/** Helpers shared by the build scripts (photos-build.mjs and seo-build.mjs). */
import fs from "node:fs";
import path from "node:path";

/** .env values, with real environment variables (set on the host) taking precedence. */
export const env = (() => {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.resolve(".env"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch {
    /* no .env file: rely on process.env */
  }
  return { ...out, ...process.env };
})();

/** Reads rows from a public Supabase table. Returns [] (and says why) when it cannot. */
export const rows = async (table, query, tag = "build") => {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.warn(`${tag}: Supabase URL or key missing; ${table} skipped.`);
    return [];
  }
  try {
    const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn(`${tag}: ${table} could not be loaded (${e.message}); skipped.`);
    return [];
  }
};

/** Where photos-build.mjs records the small copies it made; read by the app and by seo-build.mjs. */
export const PHOTO_MANIFEST = path.resolve("src/lib/photo-manifest.json");

export const readPhotoManifest = () => {
  try {
    return JSON.parse(fs.readFileSync(PHOTO_MANIFEST, "utf8"));
  } catch {
    return {};
  }
};
