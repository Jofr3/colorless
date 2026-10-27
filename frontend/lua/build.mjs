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

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const source = resolve(process.env.BALATRO_SOURCE || join(root, "../balatro-source"));
const compiler = join(source, "node_modules/love.js/index.js");
if (!existsSync(compiler))
  throw new Error(
    `Install love.js in ${source}, or set BALATRO_SOURCE to your Balatro source directory.`,
  );
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
// Kept in the repo for tools/logo_bake.lua and attribution; Lua never reads them.
const unpackaged = new Set(["assets/branding/colorless.png", "assets/branding/colorless-menu.png"]);
try {
  for (const name of ["conf.lua", "main.lua", "ui", "assets"])
    cpSync(join(here, name), join(stage, name), {
      recursive: true,
      filter: (from) => {
        const path = relative(here, from).split(sep).join("/");
        return !unpackaged.has(path) && !path.endsWith(".md");
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
  for (const name of readdirSync(join(here, "assets/transition_cards"))) {
    if (!name.endsWith(".png")) continue;
    manifest[`transition_cards/${name}`] = createHash("sha256")
      .update(readFileSync(join(here, "assets/transition_cards", name)))
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
  // The root index.html is the host page; drop the compiler's own page and theme.
  rmSync(join(output, "index.html"), { force: true });
  rmSync(join(output, "theme"), { recursive: true, force: true });
  writeFileSync(join(output, "asset-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  // Content hashes for cache busting: host.js gets the runtime's (love.js asks
  // its locateFile for love.wasm and game.js for game.data), then
  // versions.json lists every file for the Vite plugin that versions
  // index.html's own /love/ references (vite.config.ts).
  /** @param {string} path */
  const shortHash = (path) =>
    createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12);
  /** @type {Record<string, string>} */
  const versions = {};
  for (const name of readdirSync(output).sort()) {
    if (!["host.js", "host.css", "versions.json"].includes(name))
      versions[name] = shortHash(join(output, name));
  }
  const marker = "/* love-versions */ {}";
  const host = readFileSync(join(here, "web/host.js"), "utf8");
  if (!host.includes(marker)) throw new Error(`web/host.js lost its ${marker} placeholder`);
  writeFileSync(join(output, "host.js"), host.replace(marker, JSON.stringify(versions)));
  copyFileSync(join(here, "web/host.css"), join(output, "host.css"));
  for (const name of ["host.js", "host.css"]) versions[name] = shortHash(join(output, name));
  writeFileSync(join(output, "versions.json"), `${JSON.stringify(versions, null, 2)}\n`);
  console.log("Colorless Lua frontend built → public/love/");
} finally {
  rmSync(stage, { recursive: true, force: true });
}
