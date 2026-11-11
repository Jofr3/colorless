import { EventEmitter } from "node:events";
import type { ViteDevServer } from "vite";
import { describe, expect, it } from "vitest";
import { loveReloadPlugin } from "../vite.config";

function devServer() {
  const sent: unknown[] = [];
  const watcher = new EventEmitter();
  const server = {
    config: { publicDir: "/repo/public", logger: { info: () => {} } },
    ws: { send: (payload: unknown) => sent.push(payload) },
    watcher,
  };
  const hook = loveReloadPlugin().configureServer;
  if (typeof hook !== "function") throw new Error("love-reload has no configureServer function");
  hook.call({} as never, server as unknown as ViteDevServer);
  return { sent, watcher };
}

describe("love-reload", () => {
  it("reloads the page when a Lua build writes versions.json, created or rewritten", () => {
    const { sent, watcher } = devServer();
    watcher.emit("add", "/repo/public/love/versions.json");
    watcher.emit("change", "/repo/public/love/versions.json");
    expect(sent).toEqual([{ type: "full-reload" }, { type: "full-reload" }]);
  });

  it("ignores the other files a build writes, so one build reloads once", () => {
    const { sent, watcher } = devServer();
    for (const file of [
      "/repo/public/love/game.data",
      "/repo/public/love/host.js",
      "/repo/public/love/index.html",
      "/repo/public/versions.json",
      "/repo/frontend/lua/versions.json",
    ])
      watcher.emit("change", file);
    watcher.emit("unlink", "/repo/public/love/versions.json");
    expect(sent).toEqual([]);
  });
});
