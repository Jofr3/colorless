import { describe, expect, it } from "vitest";
import { bundledPackages, shippedDependencies } from "./worker-bundle";

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
