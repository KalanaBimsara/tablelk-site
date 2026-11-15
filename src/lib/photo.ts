/**
 * Small WebP copies of the site's photos. Spread the result onto an <img>:
 *
 *   <img {...photo(product.images[0], SIZES.card)} alt="..." />
 *
 * scripts/photos-build.mjs makes the copies and the manifest before each build. A photo that
 * is not in the manifest (uploaded after the last build, or in development before any build)
 * simply keeps its original address.
 */
import { photoAttrs, type PhotoManifest } from "./photoSet";

export { SIZES } from "./photoSet";

// The manifest is generated, so it may not exist yet: a glob matches nothing instead of failing.
const found = import.meta.glob<PhotoManifest>("./photo-manifest.json", { eager: true, import: "default" });
const manifest: PhotoManifest = Object.values(found)[0] ?? {};

export const photo = (url: string, sizes: string) => photoAttrs(manifest, url, sizes);

/** For onError handlers: shows the placeholder, clearing the small copies so the browser does not retry them. */
export const showPlaceholder = (e: React.SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget;
  img.onerror = null;
  img.removeAttribute("srcset");
  img.removeAttribute("sizes");
  img.src = "/placeholder.svg";
};
