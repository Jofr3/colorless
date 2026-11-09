import { describe, expect, it } from "vitest";
import {
  DISCLAIMER,
  type NoticeParts,
  noticesText,
  packageNotice,
  packagesOf,
  SECTIONS,
  WEB_WORKSPACES,
} from "./third-party-notices";
import { SHIPPED } from "./worker-bundle";

const PARTS: NoticeParts = {
  project: "MIT License\n\nCopyright (c) 2026 Jofr3\n",
  balatro: [
    "fonts/m6x11plus.ttf",
    "textures/2x/chips.png",
    "shaders/CRT.fs",
    "sounds/button.ogg",
    "sounds/music1.ogg",
  ],
  web: [{ name: "zod", version: "4.6.7", license: "MIT", text: "zod licence text\n" }],
  worker: [
    { name: "drizzle-orm", version: "0.45.2", license: "Apache-2.0", text: "Apache text" },
    { name: "hono", version: "4.13.13", license: "MIT", text: "hono licence text" },
  ],
  loveJs: { version: "11.4.1", license: "Copyright (c) 2016 Tanner Rogalsky" },
  love: "LOVE zlib text",
  tcgdex: "Copyright (c) 2021 TCGdex",
  vera: "Copyright (c) 2003 by Bitstream, Inc.",
};

/** The body of section `n` (1-based): from its title to the next section's rule. */
function sectionOf(text: string, n: number): string {
  const start = text.indexOf(`\n${n}. ${SECTIONS[n - 1]}\n`);
  const next = text.indexOf(`\n${n + 1}. `, start + 1);
  expect(start, `section ${n}`).toBeGreaterThan(0);
  return text.slice(start, next === -1 ? undefined : next);
}

describe("noticesText", () => {
  const text = noticesText(PARTS);

  it("opens with the fan-project disclaimer and the contents, then every section in order", () => {
    expect(text.startsWith("Colorless: third-party notices and credits\n")).toBe(true);
    expect(text.indexOf(DISCLAIMER)).toBeLessThan(text.indexOf("\n1. Colorless\n"));
    expect(DISCLAIMER).toContain("not affiliated with");
    expect(DISCLAIMER).toContain("trademarks of Nintendo, Creatures Inc., GAME FREAK inc.");
    const positions = SECTIONS.map((title, i) => text.indexOf(`\n${i + 1}. ${title}\n`));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const [i, title] of SECTIONS.entries()) expect(text).toContain(`  ${i + 1}. ${title}\n`);
  });

  it("carries the project's own licence first", () => {
    expect(sectionOf(text, 1)).toContain("Copyright (c) 2026 Jofr3");
  });

  it("credits Balatro's author and publisher and lists each copied file under its kind", () => {
    const balatro = sectionOf(text, 2);
    expect(balatro).toContain("Balatro is a game by LocalThunk, published by Playstack.");
    expect(balatro).toContain("not covered by its licence");
    expect(balatro).toMatch(/Shaders:\n {4}shaders\/CRT\.fs\n\n/);
    expect(balatro).toMatch(/Textures:\n {4}textures\/2x\/chips\.png\n\n/);
    expect(balatro).toMatch(/music:\n {4}sounds\/button\.ogg\n {4}sounds\/music1\.ogg/);
    expect(balatro).not.toContain("fonts/m6x11plus.ttf");
  });

  it("credits the font to Daniel Linssen with his page's terms", () => {
    const font = sectionOf(text, 3);
    expect(font).toContain("fonts/m6x11plus.ttf is m6x11plus, a font by Daniel Linssen (managore)");
    expect(font).toContain("https://managore.itch.io/m6x11");
    expect(font).toContain('"free to use with attribution"');
  });

  it("carries TCGdex's licence and the card artwork's owners", () => {
    const cards = sectionOf(text, 4);
    expect(cards).toContain("Copyright (c) 2021 TCGdex");
    expect(cards).toContain("The Pokémon Company");
  });

  it("prints each package's name, version, licence and text in its bundle's section", () => {
    expect(sectionOf(text, 5)).toContain("--- zod 4.6.7 (MIT) ---\n\nzod licence text\n");
    const worker = sectionOf(text, 6);
    expect(worker).toContain("--- drizzle-orm 0.45.2 (Apache-2.0) ---\n\nApache text\n");
    expect(worker).toContain("--- hono 4.13.13 (MIT) ---\n\nhono licence text\n");
    expect(worker).not.toContain("zod licence text");
  });

  it("carries love.js's and LÖVE's licences and the libraries love.wasm adds", () => {
    expect(sectionOf(text, 7)).toContain("love.js 11.4.1");
    expect(sectionOf(text, 7)).toContain("Copyright (c) 2016 Tanner Rogalsky");
    const love = sectionOf(text, 8);
    for (const part of [
      "LOVE zlib text",
      "Copyright (c) 2003 by Bitstream, Inc.",
      "Lua.org, PUC-Rio",
      "FreeType Project",
    ])
      expect(love).toContain(part);
  });
});

describe("the packages it reads", () => {
  it("covers what the web page and the Worker may bundle", () => {
    expect(packagesOf(WEB_WORKSPACES)).toEqual(["@noble/ciphers", "zod"]);
    expect(packagesOf(SHIPPED)).toEqual([
      "@hono/zod-validator",
      "@noble/ciphers",
      "drizzle-orm",
      "hono",
      "zod",
    ]);
  });

  it("reads a package's own licence file, or the vendored copy when it ships none", () => {
    const zod = packageNotice("zod", WEB_WORKSPACES);
    expect(zod).toMatchObject({ name: "zod", license: "MIT" });
    expect(zod.text).toContain("Permission is hereby granted");
    const drizzle = packageNotice("drizzle-orm", SHIPPED);
    expect(drizzle.license).toBe("Apache-2.0");
    expect(drizzle.text).toContain("Apache License\n                           Version 2.0");
  });
});
