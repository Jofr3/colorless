// @ts-check
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import { withPackageUuid } from "./packageUuid.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const source = resolve(process.env.BALATRO_SOURCE || join(root, "../balatro-source"));
const compiler = join(source, "node_modules/love.js/index.js");
if (!existsSync(compiler))
  throw new Error(
    `Install love.js in ${source}, or set BALATRO_SOURCE to your Balatro source directory.`,
  );
/** Runs a repo script under bun and returns its stdout; its stderr reaches the terminal.
    @param {string} script @param {string[]} args */
const bunScript = (script, args) =>
  execFileSync("bun", [join(root, "scripts", script), ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
// love.js must be the pinned 11.4.1 (scripts/love-inputs.ts): a mismatch stops the build, naming
// each file that differs; otherwise it reports the source tree's commit.
/** @type {{ loveJs: object, balatroSource: object | null }} */
let inputs;
try {
  inputs = JSON.parse(bunScript("love-inputs.ts", [source]));
} catch {
  // love-inputs.ts has printed what differs.
  process.exit(1);
}
const stage = mkdtempSync(join(tmpdir(), "colorless-love-"));
// Vite's public dir: served at /love/ by the dev server and copied into
// dist/love/ by the production build. Generated, so gitignored.
const output = join(root, "public/love");
const assets = [
  "fonts/m6x11plus.ttf",
  "textures/2x/Enhancers.png",
  "textures/2x/chips.png",
  ...["splash", "background", "CRT", "dissolve", "played", "foil", "holo", "polychrome"].map(
    (n) => `shaders/${n}.fs`,
  ),
  ...[
    "button",
    "card1",
    "cardSlide1",
    "cardSlide2",
    "cardFan2",
    "highlight1",
    "paper1",
    "chips1",
    "multhit1",
    "multhit2",
    "cancel",
    "coin1",
    "coin3",
    "tarot2",
    "whoosh",
    "win",
    "glass2",
    "whoosh2",
    "crumple1",
    "crumple2",
    "crumple3",
    "crumple4",
    "crumple5",
    "generic1",
    "gold_seal",
  ].map((n) => `sounds/${n}.ogg`),
];
// The menu music downloads after Lua is ready (web/host.js), outside game.data, which must arrive
// in full before Lua starts.
const music = "sounds/music1.ogg";
// The screen wipe's fallback scans download after ready too (web/host.js), each beside game.data
// under its content hash; Lua lists only those already written.
const transitionCards = "transition_cards";
// Kept in the repo for tools/logo_bake.lua and attribution; Lua never reads them.
const unpackaged = new Set(["assets/branding/colorless.png", "assets/branding/colorless-menu.png"]);
try {
  for (const name of ["conf.lua", "main.lua", "ui", "assets"])
    cpSync(join(here, name), join(stage, name), {
      recursive: true,
      filter: (from) => {
        const path = relative(here, from).split(sep).join("/");
        return (
          !unpackaged.has(path) &&
          !path.endsWith(".md") &&
          path !== `assets/${transitionCards}` &&
          !path.startsWith(`assets/${transitionCards}/`)
        );
      },
    });
  /** @type {Record<string, string>} */
  const manifest = {};
  for (const name of [
    "colorless.png",
    "colorless-menu.png",
    "colorless-menu-base.png",
    "colorless-energy-star.png",
  ]) {
    manifest[`branding/${name}`] = createHash("sha256")
      .update(readFileSync(join(here, "assets/branding", name)))
      .digest("hex");
  }
  const cards = readdirSync(join(here, "assets", transitionCards))
    .filter((name) => name.endsWith(".png"))
    .sort();
  for (const name of cards) {
    manifest[`${transitionCards}/${name}`] = createHash("sha256")
      .update(readFileSync(join(here, "assets", transitionCards, name)))
      .digest("hex");
  }
  for (const asset of assets) {
    const from = join(source, "resources", asset);
    const to = join(stage, "assets", asset);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    manifest[asset] = createHash("sha256").update(readFileSync(from)).digest("hex");
  }
  manifest[music] = createHash("sha256")
    .update(readFileSync(join(source, "resources", music)))
    .digest("hex");
  mkdirSync(output, { recursive: true });
  execFileSync(
    process.execPath,
    [compiler, "--compatibility", "--title", "Colorless", "--memory", "134217728", stage, output],
    { stdio: "inherit" },
  );
  // The compiler copies the runtime with fs-extra, which unlinks the old file
  // first; a running Vite dev server sees the unlink but tends to miss the
  // instant re-add and then serves index.html for /love/love.js. Re-create
  // the two files with a pause between unlink and write so the watcher
  // registers them again.
  const runtime = ["love.js", "love.wasm"].map((name) => {
    const path = join(output, name);
    const bytes = readFileSync(path);
    rmSync(path);
    return { path, bytes };
  });
  await new Promise((done) => setTimeout(done, 500));
  for (const { path, bytes } of runtime) writeFileSync(path, bytes);
  copyFileSync(join(source, "resources", music), join(output, "music1.ogg"));
  rmSync(join(output, transitionCards), { recursive: true, force: true });
  mkdirSync(join(output, transitionCards));
  for (const name of cards)
    copyFileSync(join(here, "assets", transitionCards, name), join(output, transitionCards, name));
  // The root index.html is the host page; drop the compiler's own page and theme.
  rmSync(join(output, "index.html"), { force: true });
  rmSync(join(output, "theme"), { recursive: true, force: true });
  // The build's record of what it took from outside the repo: the pinned love.js, the Balatro
  // tree's commit (null when it is not a git checkout) and one digest over every file copied
  // from it, beside each file's own hash.
  const copied = [...assets, music].map((asset) => `${asset} ${manifest[asset]}\n`).join("");
  const record = {
    inputs: {
      loveJs: inputs.loveJs,
      balatroSource: {
        git: inputs.balatroSource,
        resources: createHash("sha256").update(copied).digest("hex"),
      },
    },
    files: manifest,
  };
  writeFileSync(join(output, "asset-manifest.json"), `${JSON.stringify(record, null, 2)}\n`);
  // The credits Settings and the page's Credits link open: every third-party licence and credit
  // for what this build ships, Balatro's files listed from `assets`.
  bunScript("third-party-notices.ts", [
    "--love-js",
    join(source, "node_modules/love.js"),
    "--out",
    join(output, "THIRD-PARTY-NOTICES.txt"),
    ...[...assets, music].flatMap((asset) => ["--balatro", asset]),
  ]);
  // Workers static assets give .data no Content-Type, and Cloudflare compresses only the types it
  // lists, so game.data would go out as is. host.js downloads this gzip copy instead (served as
  // application/gzip, never compressed twice) and unpacks it with DecompressionStream; game.data
  // stays beside it for a browser without one. game.js's loader asks host.js for the package
  // (Module.fetchPackage), which this build patches in; a love.js whose loader no longer has
  // that function stops the build rather than shipping a package nothing compresses or counts.
  // The package's random uuid becomes one derived from game.data, so the build is reproducible
  // and a returning player's cached package survives a release that leaves game.data unchanged.
  const gameData = readFileSync(join(output, "game.data"));
  writeFileSync(join(output, "game.data.gz"), gzipSync(gameData, { level: 9 }));
  const loader = "function fetchRemotePackage(packageName, packageSize, callback, errback) {";
  const gameJs = readFileSync(join(output, "game.js"), "utf8");
  if (gameJs.split(loader).length !== 2)
    throw new Error(`love.js's game.js no longer has exactly one \`${loader}\`; update build.mjs`);
  writeFileSync(
    join(output, "game.js"),
    withPackageUuid(
      gameJs.replace(
        loader,
        `${loader}\n      if (Module['fetchPackage']) return Module['fetchPackage'](packageName, callback);`,
      ),
      gameData,
    ),
  );
  // Byte sizes for host.js's boot bar: response bodies yield decoded bytes, so love.wasm counts
  // against its own size and is weighed by about what Cloudflare's brotli sends; the package is
  // counted as the gzip copy that arrives.
  const loveWasm = readFileSync(join(output, "love.wasm"));
  const sizes = {
    wasm: loveWasm.length,
    wasmTransfer: brotliCompressSync(loveWasm, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 },
    }).length,
    data: gameData.length,
    packed: readFileSync(join(output, "game.data.gz")).length,
  };
  // Content hashes for cache busting: host.js gets the runtime's (love.js asks
  // its locateFile for love.wasm, and host.js for the game package), then
  // versions.json lists every file for the Vite plugin that versions
  // index.html's own /love/ references (vite.config.ts).
  /** @param {string} path */
  const shortHash = (path) =>
    createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12);
  /** @type {Record<string, string>} */
  const versions = {};
  for (const name of readdirSync(output).sort()) {
    if (name === transitionCards)
      for (const card of cards) versions[`${name}/${card}`] = shortHash(join(output, name, card));
    else if (!["host.js", "host.css", "versions.json"].includes(name))
      versions[name] = shortHash(join(output, name));
  }
  let host = readFileSync(join(here, "web/host.js"), "utf8");
  /** @type {[string, object][]} */
  const placeholders = [
    ["/* love-versions */ {}", versions],
    ["/* love-sizes */ {}", sizes],
  ];
  for (const [marker, value] of placeholders) {
    if (host.split(marker).length !== 2)
      throw new Error(`web/host.js must hold its ${marker} placeholder exactly once`);
    host = host.replace(marker, JSON.stringify(value));
  }
  writeFileSync(join(output, "host.js"), host);
  copyFileSync(join(here, "web/host.css"), join(output, "host.css"));
  for (const name of ["host.js", "host.css"]) versions[name] = shortHash(join(output, name));
  writeFileSync(join(output, "versions.json"), `${JSON.stringify(versions, null, 2)}\n`);
  console.log("Colorless Lua frontend built → public/love/");
} finally {
  rmSync(stage, { recursive: true, force: true });
}
