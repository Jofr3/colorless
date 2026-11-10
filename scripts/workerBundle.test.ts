import { describe, expect, it } from "vitest";
import {
  bundledPackages,
  deployFlags,
  deployProblems,
  observabilityProblems,
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

  it("reads the wrangler deploy a release-gate run starts after its gates", () => {
    expect(deployFlags(`${gate} ci -- wrangler deploy --minify`)).toEqual(["--minify"]);
    expect(deployFlags(`${gate} -- wrangler deploy`)).toEqual([]);
    expect(deployFlags(`${gate} -- wrangler versions deploy --minify`)).toBeUndefined();
    expect(deployFlags(`${gate} health`)).toBeUndefined();
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

  it("refuses an API config without logs, query redaction or Workers Issues", () => {
    const config = (body: string) =>
      `{\n  "main": "src/index.ts",\n  "observability": {\n${body}\n  },\n  "vars": { "enabled": true }\n}`;
    const missing = (setting: string) =>
      `apps/api/wrangler.jsonc does not set \`observability.${setting}: true\``;
    const on = '    "enabled": true,\n    // why\n    "redact_query_string": true,';
    expect(observabilityProblems(config(`${on}\n    "issues": { "enabled": true }`))).toEqual([]);
    expect(observabilityProblems(config(on))).toEqual([missing("issues.enabled")]);
    expect(
      observabilityProblems(config(`${on}\n    "issues": {\n      "enabled": false\n    }`)),
    ).toEqual([missing("issues.enabled")]);
    // Issues' own `enabled` does not stand in for the logs' one, nor does one outside the block.
    expect(
      observabilityProblems(
        config('    "redact_query_string": true,\n    "issues": { "enabled": true }'),
      ),
    ).toEqual([missing("enabled")]);
    expect(
      observabilityProblems(
        config(
          '    "enabled": true,\n    // "redact_query_string": true,\n    "issues": { "enabled": true }',
        ),
      ),
    ).toEqual([missing("redact_query_string")]);
    expect(observabilityProblems('{ "main": "src/index.ts" }')).toEqual([
      missing("enabled"),
      missing("redact_query_string"),
      missing("issues.enabled"),
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
