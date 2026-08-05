// Pure helpers for the /assets proxy routes (D9 lazy R2 mirror): filename
// allowlists, R2 key construction, origin-URL construction and content types.
// Kept free of Worker types so they unit-test as plain functions; the
// fetch/R2/D1 plumbing lives in ./routes.ts.
//
// tcgdex origin URL shapes (docs/workstreams/backend-data.md §4.4):
// - card image: `{base}/{quality}.{ext}` — the file name IS the suffix path;
// - set logo/symbol: `{base}.{ext}` — ONLY the extension is appended (there
//   is no quality segment), so the DB stores the extensionless base and the
//   file name here is split into asset kind + extension.

export const CARD_ASSET_FILES = [
  "high.webp",
  "low.webp",
  "high.png",
  "low.png",
  "high.jpg",
  "low.jpg",
] as const;
export type CardAssetFile = (typeof CARD_ASSET_FILES)[number];

export const SET_ASSET_FILES = ["logo.png", "logo.webp", "symbol.png", "symbol.webp"] as const;
export type SetAssetFile = (typeof SET_ASSET_FILES)[number];

export function isCardAssetFile(file: string): file is CardAssetFile {
  return (CARD_ASSET_FILES as readonly string[]).includes(file);
}

export function isSetAssetFile(file: string): file is SetAssetFile {
  return (SET_ASSET_FILES as readonly string[]).includes(file);
}

/** R2 object key for a card asset: `cards/{cardId}/{file}`. */
export function cardAssetKey(cardId: string, file: CardAssetFile): string {
  return `cards/${cardId}/${file}`;
}

/** R2 object key for a set asset: `sets/{setId}/{file}`. */
export function setAssetKey(setId: string, file: SetAssetFile): string {
  return `sets/${setId}/${file}`;
}

/** Which DB column a set asset file reads its origin base from. */
export function setAssetKind(file: SetAssetFile): "logo" | "symbol" {
  return file.startsWith("logo.") ? "logo" : "symbol";
}

/** Card origin URL: `{base}/{quality}.{ext}` (§4.4). */
export function cardOriginUrl(imageBase: string, file: CardAssetFile): string {
  return `${imageBase}/${file}`;
}

/** Set origin URL: `{base}.{ext}` — extension only, no quality segment (§4.4). */
export function setOriginUrl(assetBase: string, file: SetAssetFile): string {
  const extension = file.slice(file.lastIndexOf(".") + 1);
  return `${assetBase}.${extension}`;
}

const CONTENT_TYPES: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
};

/** Content type by file extension; the allowlists make misses impossible. */
export function contentTypeFor(file: CardAssetFile | SetAssetFile): string {
  const extension = file.slice(file.lastIndexOf(".") + 1);
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) {
    throw new Error(`no content type for extension "${extension}"`);
  }
  return contentType;
}
