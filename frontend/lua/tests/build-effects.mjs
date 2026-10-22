import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(process.env.BALATRO_SOURCE || join(here, "../../../../balatro-source"));
const root = mkdtempSync(join(tmpdir(), "colorless-effects-"));
const stage = join(root, "source");
const web = join(root, "web");
mkdirSync(stage);
mkdirSync(web);
cpSync(join(here, "../ui"), join(stage, "ui"), { recursive: true });
cpSync(join(here, "effects_gpu.lua"), join(stage, "main.lua"));
cpSync(join(source, "resources/shaders/CRT.fs"), join(stage, "CRT.fs"));
cpSync(join(here, "../conf.lua"), join(stage, "conf.lua"));
const game = readFileSync(join(source, "game.lua"), "utf8");
const start = game.indexOf("G.SETTINGS.GRAPHICS.crt = G.SETTINGS.GRAPHICS.crt*0.3");
const endText = "G.SETTINGS.GRAPHICS.crt = G.SETTINGS.GRAPHICS.crt/0.3";
const end = game.indexOf(endText, start);
if (start < 0 || end < 0) throw new Error("Cannot locate original CRT draw block");
writeFileSync(join(stage, "reference.lua"), game.slice(start, end + endText.length));
execFileSync(process.execPath, [
  join(source, "node_modules/love.js/index.js"),
  "--compatibility",
  "--title",
  "CRT comparison",
  "--memory",
  "134217728",
  stage,
  web,
]);
writeFileSync(
  join(web, "index.html"),
  `<!doctype html><title>CRT GPU comparison</title>
<canvas id="canvas" width="1280" height="900"></canvas>
<script>var results=[]; var Module={arguments:["./"],canvas:document.getElementById("canvas"),print:function(s){results.push(s);console.log(s)}};</script>
<script src="game.js"></script><script src="love.js" onload="Love(Module)"></script>`,
);
console.log(web);
