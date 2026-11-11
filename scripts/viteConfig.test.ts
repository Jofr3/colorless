import { EventEmitter } from "node:events";
import { join } from "node:path";
import { type ResolvedConfig, resolveConfig, type ViteDevServer } from "vite";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./lib/repo";

/** vite.config.ts as the dev server resolves it. */
const devConfig = (): Promise<ResolvedConfig> =>
  resolveConfig(
    { root: REPO_ROOT, configFile: join(REPO_ROOT, "vite.config.ts"), logLevel: "silent" },
    "serve",
  );

async function devServer() {
  const plugin = (await devConfig()).plugins.find((p) => p.name === "love-reload");
  const hook = plugin?.configureServer;
  if (typeof hook !== "function") throw new Error("no love-reload plugin with a configureServer");
  const sent: unknown[] = [];
  const watcher = new EventEmitter();
  const server = {
    config: { publicDir: "/repo/public", logger: { info: () => {} } },
    ws: { send: (payload: unknown) => sent.push(payload) },
    watcher,
  };
  await hook.call({} as never, server as unknown as ViteDevServer);
  return { sent, watcher };
}

describe("love-reload", () => {
  it("reloads the page when a Lua build writes versions.json, created or rewritten", async () => {
    const { sent, watcher } = await devServer();
    watcher.emit("add", "/repo/public/love/versions.json");
    watcher.emit("change", "/repo/public/love/versions.json");
    expect(sent).toEqual([{ type: "full-reload" }, { type: "full-reload" }]);
  });

  it("ignores the other files a build writes, so one build reloads once", async () => {
    const { sent, watcher } = await devServer();
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

describe("the dev server's fs.deny", () => {
  /** Vite's own matcher over the configured deny list, as it checks every file it serves. */
  async function denied() {
    const config = (await devConfig()) as unknown as { fsDenyGlob?: (path: string) => boolean };
    if (!config.fsDenyGlob) throw new Error("Vite's resolved config has no fsDenyGlob any more");
    return config.fsDenyGlob;
  }

  it("refuses the API's secrets, its sources and every local D1 state", async () => {
    const glob = await denied();
    for (const path of [
      "apps/api/.dev.vars",
      ".dev.vars",
      "apps/api/src/index.ts",
      "apps/api/.wrangler/state/v3/d1/db.sqlite",
      ".wrangler/state/v3/d1/db.sqlite",
      "tmp/dx/notes.md",
      ".env.production",
    ])
      expect(glob(`${REPO_ROOT}/${path}`), path).toBe(true);
  });

  it("serves the page's own files, also from a checkout under a tmp/ or apps/ directory", async () => {
    const glob = await denied();
    for (const path of [
      `${REPO_ROOT}/index.html`,
      `${REPO_ROOT}/src/lua/bridge.ts`,
      `${REPO_ROOT}/public/love/versions.json`,
      "/scratch/tmp/checkout/src/lua/bridge.ts",
      "/work/apps/colorless/index.html",
    ])
      expect(glob(path), path).toBe(false);
  });
});
