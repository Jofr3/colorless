#!/usr/bin/env bun
// The site's third-party notices: one plain-text file, written by the Lua build
// (frontend/lua/build.mjs) into public/love/, which Vite copies to
// dist/love/THIRD-PARTY-NOTICES.txt; index.html's Credits link and Settings' Credits button open
// it. It holds the fan-project disclaimer, Colorless's own LICENSE, the credits for the Balatro
// assets and the m6x11plus font the build copies, the TCGdex and Pokémon notices, the licence text
// of every npm package the web page and the API Worker may ship, love.js, and LÖVE with the
// libraries love.wasm carries. Package texts come from node_modules; texts a package does not ship,
// and the ones from outside npm, are kept in scripts/notices/ (`VENDORED`).
//
//   bun scripts/third-party-notices.ts --love-js <dir> --out <file> [--balatro <resource>]...

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fail, isRecord, parseJson } from "./lib/cli";
import { repoPath } from "./lib/repo";
import { SHIPPED, shippedDependencies } from "./worker-bundle";

/** The workspaces whose production dependencies the web page may bundle: the page itself (the
    root) and the two packages it imports. vite.config.ts fails a build whose bundle carries any
    other npm package, so this list cannot fall behind the bundle. */
export const WEB_WORKSPACES = [".", "packages/engine", "packages/schema"];

/** Licence texts kept in the repo, by package or part, each with where it was copied from. */
export const VENDORED: Record<string, { file: string; from: string }> = {
  // drizzle-orm's and @hono/zod-validator's npm tarballs carry no LICENSE file.
  "drizzle-orm": {
    file: "drizzle-orm.txt",
    from: "https://github.com/drizzle-team/drizzle-orm/blob/main/LICENSE",
  },
  "@hono/zod-validator": {
    file: "hono-zod-validator.txt",
    from: "https://github.com/honojs/middleware/blob/main/LICENSE",
  },
  love: { file: "love-11.4.txt", from: "https://github.com/love2d/love/blob/11.4/license.txt" },
  tcgdex: {
    file: "tcgdex-cards-database.txt",
    from: "https://github.com/tcgdex/cards-database/blob/master/LICENSE",
  },
  vera: { file: "bitstream-vera.txt", from: "the licence text embedded in love.wasm" },
};

export type PackageNotice = { name: string; version: string; license: string; text: string };

export type NoticeParts = {
  /** The repository's LICENSE. */
  project: string;
  /** Resource paths build.mjs copies from the Balatro source tree (`build.mjs` `assets` + music). */
  balatro: readonly string[];
  web: readonly PackageNotice[];
  worker: readonly PackageNotice[];
  loveJs: { version: string; license: string };
  love: string;
  tcgdex: string;
  vera: string;
};

const LICENSE_FILE = /^(licen[cs]e|copying)(\.(md|txt))?$/i;

/** The npm packages, sorted, that the `workspaces` declare as production dependencies. */
export function packagesOf(workspaces: readonly string[]): string[] {
  return [...shippedDependencies(workspaces.map(manifestOf))].sort();
}

function manifestOf(dir: string): Record<string, unknown> {
  const path = repoPath(join(dir, "package.json"));
  return parseJson(readFileSync(path, "utf8"), path, isRecord);
}

/** A package's installed directory: under the first of `workspaces` that has it, else the root. */
function packageDir(name: string, workspaces: readonly string[]): string {
  for (const dir of [...workspaces, "."]) {
    const path = repoPath(join(dir, "node_modules", name));
    if (existsSync(join(path, "package.json"))) return path;
  }
  throw new Error(`${name} is not installed; run \`bun install\``);
}

/** A package's version, declared licence and licence text: its own LICENSE file, or the vendored
    copy when its tarball has none. */
export function packageNotice(name: string, workspaces: readonly string[]): PackageNotice {
  const dir = packageDir(name, workspaces);
  const manifest = parseJson(readFileSync(join(dir, "package.json"), "utf8"), name, isRecord);
  const own = readdirSync(dir).find((file) => LICENSE_FILE.test(file));
  const vendored = VENDORED[name];
  const text = own
    ? readFileSync(join(dir, own), "utf8")
    : vendored
      ? readVendored(name)
      : undefined;
  if (text === undefined)
    throw new Error(`${name} ships no licence file; add its text to VENDORED (scripts/notices/)`);
  return {
    name,
    version: String(manifest.version ?? "?"),
    license: String(manifest.license ?? "see below"),
    text,
  };
}

function readVendored(part: string): string {
  const entry = VENDORED[part];
  if (!entry) throw new Error(`no vendored text for ${part}`);
  return readFileSync(repoPath(join("scripts/notices", entry.file)), "utf8");
}

const RULE = "=".repeat(79);

/** A numbered section: its title, ruled, then its body. */
function section(number: number, title: string, body: string): string {
  return `${RULE}\n${number}. ${title}\n${RULE}\n\n${body.trim()}\n`;
}

/** Each package's name, version and licence, then its licence text. */
function packageBlock(packages: readonly PackageNotice[]): string {
  return packages
    .map((p) => `--- ${p.name} ${p.version} (${p.license}) ---\n\n${p.text.trim()}\n`)
    .join("\n");
}

/** The resources under `folder`, as an indented list. */
function listed(resources: readonly string[], folder: string): string {
  return resources
    .filter((path) => path.startsWith(`${folder}/`))
    .map((path) => `    ${path}`)
    .join("\n");
}

export const DISCLAIMER = `Colorless is an unofficial fan project. It is not affiliated with, endorsed,
sponsored or approved by Nintendo, Creatures Inc., GAME FREAK inc., The Pokémon
Company, LocalThunk or Playstack. Pokémon and Pokémon character names are
trademarks of Nintendo, Creatures Inc., GAME FREAK inc. and The Pokémon Company.`;

export const SECTIONS = [
  "Colorless",
  "Balatro assets",
  "The m6x11plus font",
  "Pokémon TCG card data and images",
  "npm packages in the web page",
  "npm packages in the API Worker",
  "love.js",
  "LÖVE 11.4 and the libraries in love.wasm",
] as const;

/** Notices for the libraries love.wasm carries that LÖVE's own licence file leaves out. */
const LOVE_WASM_EXTRAS = `
 - Lua 5.1
	Website: https://www.lua.org/
	License: MIT/Expat
	Copyright (C) 1994-2012 Lua.org, PUC-Rio.

 - SDL2
	Website: https://www.libsdl.org/
	License: zlib
	Copyright (C) Sam Lantinga <slouken@libsdl.org>

 - FreeType
	Website: https://freetype.org/
	License: FreeType License (FTL)
	Portions of this software are copyright (C) The FreeType Project
	(www.freetype.org). All rights reserved.

 - PhysicsFS
	Website: https://icculus.org/physfs/
	License: zlib
	Copyright (c) Ryan C. Gordon and others.

 - Box2D
	Website: https://box2d.org/
	License: zlib
	Copyright (c) Erin Catto

 - Ogg, Vorbis and Theora
	Website: https://xiph.org/
	License: 3-Clause BSD
	Copyright (c) Xiph.Org Foundation`;

/** The whole notices file. */
export function noticesText(parts: NoticeParts): string {
  const font = parts.balatro.filter((path) => path.startsWith("fonts/")).join(", ");
  const contents = SECTIONS.map((title, i) => `  ${i + 1}. ${title}`).join("\n");
  const body = [
    `Colorless: third-party notices and credits
${RULE}

${DISCLAIMER}

This file lists the parts of this site that are not Colorless's own work, with
each part's credit and licence. Colorless's own code and original assets are
under the MIT licence in section 1; that licence does not extend to anything
else listed here.

${contents}
`,
    section(1, SECTIONS[0], parts.project),
    section(
      2,
      SECTIONS[1],
      `Balatro is a game by LocalThunk, published by Playstack. The build copies the
files below unmodified from a local Balatro source tree; they are not stored in
Colorless's repository, are not covered by its licence, and remain the property
of their owners. Colorless's Lua interface is also modelled on Balatro's: several
of its layouts, motion equations and drawing routines follow Balatro's own code,
and the COLORLESS wordmark is modelled on Balatro's logo.

  Shaders:
${listed(parts.balatro, "shaders")}

  Textures:
${listed(parts.balatro, "textures")}

  Sound effects and music:
${listed(parts.balatro, "sounds")}`,
    ),
    section(
      3,
      SECTIONS[2],
      `${font || "fonts/m6x11plus.ttf"} is m6x11plus, a font by Daniel Linssen (managore):
https://managore.itch.io/m6x11

Its author's page says the font is "free to use with attribution". The build
copies it from the same Balatro source tree as the files in section 2.`,
    ),
    section(
      4,
      SECTIONS[3],
      `Card names, text and data come from TCGdex (https://tcgdex.dev), from its
cards-database, under this licence:

${parts.tcgdex.trim()}

Card images come from TCGdex's image server (assets.tcgdex.net), served through
Colorless's API as a cached mirror. The card scans the screen wipe shows
(love/transition_cards/) are unmodified TCGdex downloads. Card artwork and card
text are the work of their respective rights holders (Nintendo, Creatures Inc.,
GAME FREAK inc., The Pokémon Company and the card illustrators); they are not
Colorless's work and are not covered by its licence.`,
    ),
    section(
      5,
      SECTIONS[4],
      `The page's script (assets/*.js) bundles these packages:\n\n${packageBlock(parts.web)}`,
    ),
    section(
      6,
      SECTIONS[5],
      `Colorless's API runs as a Cloudflare Worker that bundles these packages:\n\n${packageBlock(parts.worker)}`,
    ),
    section(
      7,
      SECTIONS[6],
      `love.js ${parts.loveJs.version}, the Emscripten port of LÖVE (https://github.com/Davidobot/love.js),
provides love.js, love.wasm and the game.js loader. Colorless's build adds one
line to game.js's loader.

${parts.loveJs.license}`,
    ),
    section(
      8,
      SECTIONS[7],
      `love.wasm is LÖVE 11.4 (https://love2d.org, zlib licence, Copyright (c) 2006-2022
LOVE Development Team) compiled to WebAssembly by love.js. Besides LÖVE it
carries, among others, Lua 5.1, SDL2, FreeType, PhysicsFS, Box2D, the Xiph.Org
codecs (Ogg, Vorbis, Theora), libmpg123, glslang, ENet, LuaSocket, LZ4 and the
Bitstream Vera Sans font. Their notices follow: first the ones LÖVE's own
licence file leaves out, then that file verbatim. The zlib, MIT/Expat, BSD and
LGPL 2.1 texts the list refers to are in LÖVE's file. libmpg123 is under the
LGPL 2.1; its source is at https://www.mpg123.de/, and love.js's build of LÖVE
is at the love.js address in section 7.
${LOVE_WASM_EXTRAS}

 - Bitstream Vera Sans

${parts.vera.trim()}

--- LÖVE 11.4 license.txt ---

${parts.love.trim()}`,
    ),
  ];
  return body.join("\n");
}

/** Reads every part from the repo, node_modules and the love.js package at `loveJs`. */
export function readParts(loveJs: string, balatro: readonly string[]): NoticeParts {
  const loveManifest = parseJson(
    readFileSync(join(loveJs, "package.json"), "utf8"),
    "love.js/package.json",
    isRecord,
  );
  return {
    project: readFileSync(repoPath("LICENSE"), "utf8"),
    balatro,
    web: packagesOf(WEB_WORKSPACES).map((name) => packageNotice(name, WEB_WORKSPACES)),
    worker: packagesOf(SHIPPED).map((name) => packageNotice(name, SHIPPED)),
    loveJs: {
      version: String(loveManifest.version ?? "?"),
      license: readFileSync(join(loveJs, "LICENSE"), "utf8"),
    },
    love: readVendored("love"),
    tcgdex: readVendored("tcgdex"),
    vera: readVendored("vera"),
  };
}

/** `--name value` arguments: the last value of each single flag, every value of `--balatro`. */
function parseArgs(argv: readonly string[]): { loveJs: string; out: string; balatro: string[] } {
  const single: Record<string, string> = {};
  const balatro: string[] = [];
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) fail(`third-party-notices: ${flag} needs a value`);
    if (flag === "--balatro") balatro.push(value);
    else if (flag === "--love-js" || flag === "--out") single[flag] = value;
    else fail(`third-party-notices: unknown flag ${flag}`);
  }
  const loveJs = single["--love-js"];
  const out = single["--out"];
  if (loveJs === undefined || out === undefined)
    fail(
      "usage: bun scripts/third-party-notices.ts --love-js <dir> --out <file> [--balatro <resource>]...",
    );
  return { loveJs, out, balatro };
}

function main(): void {
  const { loveJs, out, balatro } = parseArgs(process.argv.slice(2));
  mkdirSync(dirname(out), { recursive: true });
  // A byte-order mark, so a server that sends text/plain without a charset (Vite's dev server and
  // preview do; Cloudflare adds utf-8) still shows LÖVE and Pokémon rather than mojibake.
  writeFileSync(out, `﻿${noticesText(readParts(loveJs, balatro))}`);
}

if (import.meta.main) main();
