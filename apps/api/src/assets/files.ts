// Pure helpers for the /assets proxy route. Card images append `{quality}.{ext}` to the origin
// base.

/**
 * The card files a client requests: the web app shows `high.webp` only (src/lib/api.ts
 * `cardImageUrl`). Every allowed file is one more object anyone can make the mirror fetch and keep
 * in R2 for good, so a variant joins this list when a client starts using it.
 */
export const CARD_ASSET_FILES = ["high.webp"] as const;
export type CardAssetFile = (typeof CARD_ASSET_FILES)[number];

/** The only origin the mirror fetches from, and the only asset URLs ingest keeps. */
export const ASSET_ORIGIN = "https://assets.tcgdex.net/";

/** Whether `url` is an https URL on the asset origin's host. */
export function isAssetOriginUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  return parsed.protocol === "https:" && parsed.host === new URL(ASSET_ORIGIN).host;
}

/** The origin's card scans are about 100 KB; a body past this is not one. */
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;

export type ImageType = "image/webp" | "image/png" | "image/jpeg";

/** The image type `bytes` start with, by its magic number, or null for anything else. */
export function sniffImageType(bytes: ArrayBuffer): ImageType | null {
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 12));
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (head.length === 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, index) => head[index] === byte)) return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  return null;
}

export function isCardAssetFile(file: string): file is CardAssetFile {
  return (CARD_ASSET_FILES as readonly string[]).includes(file);
}

/** R2 object key for a card asset: `cards/{cardId}/{file}`. */
export function cardAssetKey(cardId: string, file: CardAssetFile): string {
  return `cards/${cardId}/${file}`;
}

/** Card origin URL: `{base}/{quality}.{ext}` (§4.4). */
export function cardOriginUrl(imageBase: string, file: CardAssetFile): string {
  return `${imageBase}/${file}`;
}

const CONTENT_TYPES: Record<string, ImageType> = { webp: "image/webp" };

/** Content type by file extension; the allowlists make misses impossible. */
export function contentTypeFor(file: CardAssetFile): ImageType {
  const extension = file.slice(file.lastIndexOf(".") + 1);
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) {
    throw new Error(`no content type for extension "${extension}"`);
  }
  return contentType;
}
