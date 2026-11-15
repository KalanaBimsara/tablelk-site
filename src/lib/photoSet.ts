/**
 * Turns a photo address into <img> attributes that use the small WebP copies made by
 * scripts/photos-build.mjs. No Vite-only code here: scripts/seo-build.mjs loads this file
 * too, so the preload tag in the HTML asks for exactly the file the page will show.
 */
export type PhotoEntry = { id: string; w: number; h: number; widths: number[] };
export type PhotoManifest = Record<string, PhotoEntry>;

export type PhotoAttrs = { src: string; srcSet?: string; sizes?: string };

/** The `sizes` value for each place a large photo appears. Keep these next to the layouts they describe. */
export const SIZES = {
  /** Full-width photos: the home hero and the About opener. */
  full: "100vw",
  /** Main product photo: 7 of 12 columns on a desktop, full width on a phone. */
  productMain: "(min-width: 1024px) 58vw, 100vw",
  /** Gallery thumbnails under the main product photo. */
  productThumb: "(min-width: 1024px) 10vw, 20vw",
  /** Product cards: two per row on phones, three on tablets, four on desktops. */
  card: "(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw",
  /** A photo beside text: half the page on a desktop. */
  half: "(min-width: 1024px) 50vw, 100vw",
  /** A photo in a 7-of-12 column from tablets up. */
  wide: "(min-width: 768px) 58vw, 100vw",
  /** Review photos in a card. */
  review: "(min-width: 768px) 20vw, 45vw",
  /** Small square pictures: cart lines and team portraits. */
  small: "112px",
} as const;

const file = (e: PhotoEntry, w: number) => `/photos/${e.id}-${w}.webp`;

/** Attributes for a photo. Photos without small copies keep their original address. */
export const photoAttrs = (manifest: PhotoManifest, url: string, sizes: string): PhotoAttrs => {
  const e = manifest[url];
  if (!e) return { src: url };
  // `src` is the fallback for browsers without srcset: the mid-size copy.
  return {
    src: file(e, e.widths[Math.min(1, e.widths.length - 1)]),
    srcSet: e.widths.map((w) => `${file(e, w)} ${w}w`).join(", "),
    sizes,
  };
};
