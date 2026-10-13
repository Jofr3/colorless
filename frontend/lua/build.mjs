import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { build } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const source = resolve(process.env.BALATRO_SOURCE || join(root, "../balatro-source"));
const compiler = join(source, "node_modules/love.js/index.js");
if (!existsSync(compiler))
  throw new Error(
    `Install love.js in ${source}, or set BALATRO_SOURCE to your Balatro source directory.`,
  );
const stage = mkdtempSync(join(tmpdir(), "luminous-love-"));
const output = join(root, "public/lua");
const assets = [
  "fonts/m6x11plus.ttf",
  ...["splash", "CRT", "dissolve", "foil", "holo", "polychrome"].map((n) => `shaders/${n}.fs`),
  ...["button", "card1", "cardSlide1", "highlight1", "paper1", "music1"].map(
    (n) => `sounds/${n}.ogg`,
  ),
];
try {
  for (const name of ["conf.lua", "main.lua", "ui"])
    cpSync(join(here, name), join(stage, name), { recursive: true });
  const manifest = {};
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
    [compiler, "--compatibility", "--title", "Luminous", "--memory", "134217728", stage, output],
    { stdio: "inherit" },
  );
  for (const name of ["index.html", "host.js", "host.css"])
    copyFileSync(join(here, "web", name), join(output, name));
  // Also make the standalone WASM output usable outside the Vite dev server.
  // The main app build emits this entry again with its own VITE_API_ORIGIN.
  await build({
    configFile: false,
    root,
    publicDir: false,
    build: {
      outDir: output,
      emptyOutDir: false,
      lib: {
        entry: join(root, "src/features/lua/accountBridge.ts"),
        formats: ["es"],
        fileName: () => "account.js",
      },
    },
  });
  writeFileSync(join(output, "asset-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("Luminous Lua home built → public/lua/");
} finally {
  rmSync(stage, { recursive: true, force: true });
}
