import { describe, expect, it } from "vitest";
import {
  bundledPackages,
  deployFlags,
  deployProblems,
  shippedDependencies,
  uploadsSourceMaps,
} from "./worker-bundle";

const store = "../../../../home/u/colorless/node_modules/.bun";

describe("worker-bundle packages", () => {
  it("names the packages behind bun store paths, scoped ones included", () => {
    expect(
      bundledPackages([
        `${store}/zod@4.6.7/node_modules/zod/v4/core/util.js`,
        `${store}/@hono+zod-validator@0.9.1+b1ce3f965d7af37e/node_modules/@hono/zod-validator/src/index.ts`,
        `${store}/@noble+ciphers@2.4.0/node_modules/@noble/ciphers/_arx.js`,
        // drizzle-orm's own source map points at its src/, so only the store segment names it.
        `${store}/drizzle-orm@0.45.2+7962b15f01f7975c/node_modules/src/entity.ts`,
        "../../../../home/u/colorless/node_modules/@tcgdex/sdk/dist/tcgdex.mjs",
        "../../../../home/u/colorless/packages/schema/src/text.ts",
      ]),
    ).toEqual(["@hono/zod-validator", "@noble/ciphers", "@tcgdex/sdk", "drizzle-orm", "zod"]);
  });

  it("allows only non-workspace production dependencies", () => {
    const allowed = shippedDependencies([
      {
        dependencies: { "@colorless/schema": "workspace:*", hono: "^4.13.13" },
        devDependencies: { "@tcgdex/sdk": "2.9.0" },
      },
      { dependencies: { zod: "^4.6.7" } },
      { name: "no-deps" },
    ]);
    expect([...allowed].sort()).toEqual(["hono", "zod"]);
  });
});

describe("worker-bundle deploy flags", () => {
  const gate = "bun scripts/release-gate.ts migrations clean-tree";

  it("reads the flags of the step that runs wrangler deploy, so the dry run builds what ships", () => {
    expect(deployFlags(`${gate} && wrangler deploy --minify`)).toEqual(["--minify"]);
    expect(deployFlags(`${gate}  &&  wrangler deploy  --minify --keep-vars`)).toEqual([
      "--minify",
      "--keep-vars",
    ]);
    expect(deployFlags(`${gate} && wrangler deploy`)).toEqual([]);
    expect(deployFlags("wrangler dev")).toBeUndefined();
    expect(deployFlags(`${gate} && wrangler versions deploy`)).toBeUndefined();
  });

  it("refuses a deploy that does not minify or upload source maps", () => {
    expect(deployProblems(["--minify"], true)).toEqual([]);
    expect(deployProblems([], true)).toEqual([
      "the apps/api `deploy` script runs `wrangler deploy` without `--minify`",
    ]);
    expect(deployProblems(undefined, true)).toEqual([
      "the apps/api `deploy` script runs no `wrangler deploy` step",
    ]);
    expect(deployProblems(["--minify"], false)).toEqual([
      'apps/api/wrangler.jsonc does not set `"upload_source_maps": true`',
    ]);
  });

  it("takes upload_source_maps only when a live line sets it true", () => {
    const config = (line: string) => `{\n  "main": "src/index.ts",\n${line}\n}`;
    expect(uploadsSourceMaps(config('  "upload_source_maps": true,'))).toBe(true);
    expect(uploadsSourceMaps(config('  "upload_source_maps": false,'))).toBe(false);
    expect(uploadsSourceMaps(config('  // "upload_source_maps": true,'))).toBe(false);
    expect(uploadsSourceMaps(config(""))).toBe(false);
  });
});
