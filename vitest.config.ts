import { defineConfig } from "vitest/config";

// Every suite is pure logic (engine, adapters, reducers, parsing), so the fast
// Node environment covers them all. The fixture pool's `fix-*` programs live
// outside the production registry and are registered for every project.
const setupFiles = ["packages/engine/src/fixtures/vitestSetup.ts"];

export default defineConfig({
  test: {
    // Transformed modules are cached on disk by content hash. The mutation harness
    // points this at its own directory so mutated sources never land here.
    experimental: {
      fsModuleCache: true,
      fsModuleCachePath: process.env.VITEST_MODULE_CACHE_PATH,
    },
    projects: [
      {
        test: {
          name: "engine",
          environment: "node",
          setupFiles,
          include: ["packages/engine/src/**/*.{test,spec}.ts"],
          // Engine suites use no mocks, stubs or fake timers, so files can share
          // one module graph per worker; isolating them costs most of the run in
          // re-importing the engine.
          isolate: false,
        },
      },
      {
        test: {
          name: "app",
          environment: "node",
          setupFiles,
          include: [
            "src/**/*.{test,spec}.ts",
            "apps/*/src/**/*.{test,spec}.ts",
            "packages/schema/src/**/*.{test,spec}.ts",
            "scripts/**/*.{test,spec}.ts",
          ],
        },
      },
    ],
  },
});
