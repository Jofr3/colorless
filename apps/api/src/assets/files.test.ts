import { describe, expect, it } from "vitest";
import {
  ASSET_ORIGIN,
  CARD_ASSET_FILES,
  cardAssetKey,
  cardOriginUrl,
  contentTypeFor,
  isAssetOriginUrl,
  isCardAssetFile,
  isSetAssetFile,
  SET_ASSET_FILES,
  setAssetKey,
  setAssetKind,
  setOriginUrl,
  sniffImageType,
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
      // Variants no client requests.
      "low.webp",
      "high.png",
      "low.jpg",
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
    for (const file of [
      "logo.png",
      "symbol.png",
      "logo.jpg",
      "symbol.gif",
      "logo",
      "high.webp",
      "logo.webp.exe",
      "",
    ]) {
      expect(isSetAssetFile(file)).toBe(false);
    }
  });
});

describe("R2 keys", () => {
  it("builds card and set keys under their prefixes", () => {
    expect(cardAssetKey("sv06.5-001", "high.webp")).toBe("cards/sv06.5-001/high.webp");
    expect(setAssetKey("sv01", "symbol.webp")).toBe("sets/sv01/symbol.webp");
  });
});

describe("origin URLs (§4.4)", () => {
  it("cards append the quality file as a path segment", () => {
    expect(cardOriginUrl("https://assets.tcgdex.net/en/sv/sv01/081", "high.webp")).toBe(
      "https://assets.tcgdex.net/en/sv/sv01/081/high.webp",
    );
  });

  it("sets append ONLY the extension — no quality segment", () => {
    expect(setOriginUrl("https://assets.tcgdex.net/en/sv/sv01/logo", "logo.webp")).toBe(
      "https://assets.tcgdex.net/en/sv/sv01/logo.webp",
    );
    expect(setOriginUrl("https://assets.tcgdex.net/univ/sv/sv01/symbol", "symbol.webp")).toBe(
      "https://assets.tcgdex.net/univ/sv/sv01/symbol.webp",
    );
  });

  it("splits set files into the asset kind that picks the DB column", () => {
    expect(setAssetKind("logo.webp")).toBe("logo");
    expect(setAssetKind("symbol.webp")).toBe("symbol");
  });
});

describe("contentTypeFor", () => {
  it("maps each allowlisted extension", () => {
    for (const file of [...CARD_ASSET_FILES, ...SET_ASSET_FILES]) {
      expect(contentTypeFor(file)).toBe("image/webp");
    }
  });
});

describe("isAssetOriginUrl", () => {
  it("accepts only https URLs on the asset origin's host", () => {
    expect(isAssetOriginUrl(`${ASSET_ORIGIN}en/sv/sv01/081/high.webp`)).toBe(true);
    for (const url of [
      "http://assets.tcgdex.net/en/sv/sv01/081/high.webp",
      "https://evil.example/high.webp",
      "https://assets.tcgdex.net.evil.example/x.webp",
      "https://evil.example/https://assets.tcgdex.net/x.webp",
      "https://assets.tcgdex.net:8443/x.webp",
      "data:image/webp;base64,AAAA",
      "/en/sv/sv01/081",
      "",
    ]) {
      expect(isAssetOriginUrl(url)).toBe(false);
    }
  });
});

describe("sniffImageType", () => {
  const bytes = (...values: (number | string)[]) =>
    new Uint8Array(
      values.flatMap((v) => (typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v])),
    ).buffer;

  it("reads WebP, PNG and JPEG magic numbers", () => {
    expect(sniffImageType(bytes("RIFF", 1, 2, 3, 4, "WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
  });

  it("refuses anything else, short bodies included", () => {
    for (const body of [
      bytes("<!doctype html>"),
      bytes("RIFF", 1, 2, 3, 4, "WAVE"),
      bytes("RIFF"),
      bytes(0xff, 0xd8),
      bytes(),
    ]) {
      expect(sniffImageType(body)).toBeNull();
    }
  });
});
