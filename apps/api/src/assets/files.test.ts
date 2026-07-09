import { describe, expect, it } from "vitest";
import {
  CARD_ASSET_FILES,
  cardAssetKey,
  cardOriginUrl,
  contentTypeFor,
  isCardAssetFile,
  isSetAssetFile,
  SET_ASSET_FILES,
  setAssetKey,
  setAssetKind,
  setOriginUrl,
} from "./files";

describe("asset file allowlists", () => {
  it("accepts every allowlisted card file", () => {
    for (const file of CARD_ASSET_FILES) {
      expect(isCardAssetFile(file)).toBe(true);
    }
  });

  it("accepts every allowlisted set file", () => {
    for (const file of SET_ASSET_FILES) {
      expect(isSetAssetFile(file)).toBe(true);
    }
  });

  it("rejects anything else — wrong names, traversal, casing, extra quality", () => {
    const rejected = [
      "high.gif",
      "medium.webp",
      "high.jpeg",
      "HIGH.WEBP",
      "high.webp/../../secret",
      "../high.webp",
      "high",
      "",
      "logo.png", // a set file is not a card file
    ];
    for (const file of rejected) {
      expect(isCardAssetFile(file)).toBe(false);
    }
    for (const file of ["logo.jpg", "symbol.gif", "logo", "high.webp", "logo.png.exe", ""]) {
      expect(isSetAssetFile(file)).toBe(false);
    }
  });
});

describe("R2 keys", () => {
  it("builds card and set keys under their prefixes", () => {
    expect(cardAssetKey("sv06.5-001", "low.webp")).toBe("cards/sv06.5-001/low.webp");
    expect(setAssetKey("sv01", "symbol.png")).toBe("sets/sv01/symbol.png");
  });
});

describe("origin URLs (§4.4)", () => {
  it("cards append the quality file as a path segment", () => {
    expect(cardOriginUrl("https://assets.tcgdex.net/en/sv/sv01/081", "high.webp")).toBe(
      "https://assets.tcgdex.net/en/sv/sv01/081/high.webp",
    );
  });

  it("sets append ONLY the extension — no quality segment", () => {
    expect(setOriginUrl("https://assets.tcgdex.net/en/sv/sv01/logo", "logo.png")).toBe(
      "https://assets.tcgdex.net/en/sv/sv01/logo.png",
    );
    expect(setOriginUrl("https://assets.tcgdex.net/univ/sv/sv01/symbol", "symbol.webp")).toBe(
      "https://assets.tcgdex.net/univ/sv/sv01/symbol.webp",
    );
  });

  it("splits set files into the asset kind that picks the DB column", () => {
    expect(setAssetKind("logo.png")).toBe("logo");
    expect(setAssetKind("logo.webp")).toBe("logo");
    expect(setAssetKind("symbol.png")).toBe("symbol");
    expect(setAssetKind("symbol.webp")).toBe("symbol");
  });
});

describe("contentTypeFor", () => {
  it("maps each allowlisted extension", () => {
    expect(contentTypeFor("high.webp")).toBe("image/webp");
    expect(contentTypeFor("low.png")).toBe("image/png");
    expect(contentTypeFor("high.jpg")).toBe("image/jpeg");
    expect(contentTypeFor("logo.png")).toBe("image/png");
    expect(contentTypeFor("symbol.webp")).toBe("image/webp");
  });
});
