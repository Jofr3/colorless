// @ts-check
// `bun run dev`'s Lua watcher: `node frontend/lua/watch.mjs <command…>` runs the command (the Vite
// dev server), relays its exit and the stop signals, and reruns build.mjs 200 ms after the last
// change to what it packs. Each rebuild is a whole build.mjs in its own process, so it keeps the
// unlink, pause and re-add of love.js and love.wasm that a running Vite needs. A change during a
// build queues one more; a failed build is reported and the watch goes on. The command comes last
// so that `bun run dev --port N` (dev-tailnet.ts) still reaches Vite.
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { constants } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("usage: node frontend/lua/watch.mjs <command> [args…]");
const server = spawn(command, args, { stdio: "inherit" });
server.on("exit", (code, signal) =>
  process.exit(code ?? 128 + (signal ? constants.signals[signal] : 0)),
);
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM", "SIGHUP"]))
  process.on(signal, () => server.kill(signal));

/** @type {NodeJS.Timeout | undefined} */
let timer;
let building = false;
let again = false;
const build = () => {
  if (building) {
    again = true;
    return;
  }
  building = true;
  spawn(process.execPath, [join(here, "build.mjs")], { stdio: "inherit" }).on("exit", (code) => {
    building = false;
    if (code !== 0) console.error(`Lua build failed (exit ${code}); watching for the next change`);
    if (again) {
      again = false;
      build();
    }
  });
};
// What build.mjs reads from here; tests/ and tools/ are not packed. The directory is watched
// rather than each file, since an editor that saves by rename replaces the file's inode.
const packed = new Set(["main.lua", "conf.lua", "ui", "assets", "web"]);
watch(here, { recursive: true }, (_event, file) => {
  if (!file || !packed.has(file.split(sep)[0] ?? "")) return;
  clearTimeout(timer);
  timer = setTimeout(build, 200);
});
