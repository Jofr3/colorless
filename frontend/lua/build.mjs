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
import { resolve, join, dirname } from "node:path";
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
  ...["splash", "background", "CRT", "dissolve", "played", "foil", "holo", "polychrome"].map((n) => `shaders/${n}.fs`),
  ...[
    "button", "card1", "cardSlide1", "cardSlide2", "cardFan2", "highlight1", "paper1", "music1",
    "chips1", "multhit1", "multhit2", "cancel", "coin1", "coin3", "tarot2", "whoosh", "win", "glass2",
    "whoosh2", "crumple1", "crumple2", "crumple3", "crumple4", "crumple5", "generic1", "gold_seal",
  ].map((n) => `sounds/${n}.ogg`),
];
try {
  for (const name of ["conf.lua", "main.lua", "ui", "assets"])
    cpSync(join(here, name), join(stage, name), { recursive: true });
  const manifest = {};
  for (const name of ['colorless.png','colorless-menu.png','colorless-menu-base.png','colorless-energy-star.png']) {
    manifest[`branding/${name}`] = createHash('sha256')
      .update(readFileSync(join(here, 'assets/branding', name))).digest('hex');
  }
  for (const name of readdirSync(join(here, "assets/transition_cards"))) {
    if (!name.endsWith(".png")) continue;
    manifest[`transition_cards/${name}`] = createHash("sha256")
      .update(readFileSync(join(here, "assets/transition_cards", name))).digest("hex");
  }
  for (const asset of assets) {
    const from = join(source, "resources", asset);
    const to = join(stage, "assets", asset);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    manifest[asset] = createHash("sha256").update(readFileSync(from)).digest("hex");
  }
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
  for (const name of ["love.js", "love.wasm"]) {
    const path = join(output, name);
    const bytes = readFileSync(path);
    rmSync(path);
    await new Promise((done) => setTimeout(done, 500));
    writeFileSync(path, bytes);
  }
  // The root index.html is the host page; drop the compiler's own page and theme.
  rmSync(join(output, "index.html"), { force: true });
  rmSync(join(output, "theme"), { recursive: true, force: true });
  writeFileSync(join(output, "asset-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  // Content hashes for cache busting: host.js gets the runtime's (love.js asks
  // its locateFile for love.wasm and game.js for game.data), then
  // versions.json lists every file for the Vite plugin that versions
  // index.html's own /love/ references (vite.config.ts).
  const shortHash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12);
  const versions = {};
  for (const name of readdirSync(output).sort()) {
    if (!["host.js", "host.css", "versions.json"].includes(name)) versions[name] = shortHash(join(output, name));
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
