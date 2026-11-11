import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// Every suite is pure logic (engine, adapters, reducers, parsing), so the fast
// Node environment covers them all. The fixture pool's `fix-*` programs live
// outside the production registry and are registered for every project.
const setupFiles = ["packages/engine/src/fixtures/vitestSetup.ts"];

const ROOT = dirname(fileURLToPath(import.meta.url));
const APP_ROOTS = [
  "src",
  ...readdirSync(join(ROOT, "apps"))
    .map((app) => `apps/${app}/src`)
    .filter((dir) => existsSync(join(ROOT, dir))),
  "packages/schema/src",
  "scripts",
];

// A suite that replaces a global, an env var, the clock or a module, or
// touches `globalThis` itself, can leak into the next file sharing its worker,
// so it runs isolated; `vi.unstubAll*` marks one whose stubs come from a helper.
// The rest share one module graph per worker; a stub or spy a helper installs
// there is undone after each test, since the file's own text cannot reveal it.
const NEEDS_ISOLATION =
  /\bvi\.(mock|doMock|stubGlobal|stubEnv|unstubAll\w*|useFakeTimers|setSystemTime|spyOn|resetModules)\b|\bglobalThis\b/;

const suitesNeedingIsolation = (roots: readonly string[]) =>
  roots.flatMap((root) =>
    readdirSync(join(ROOT, root), { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(test|spec)\.ts$/.test(file))
      .map((file) => `${root}/${file}`)
      .filter((file) => NEEDS_ISOLATION.test(readFileSync(join(ROOT, file), "utf8"))),
  );

const isolatedAppSuites = suitesNeedingIsolation(APP_ROOTS);
const isolatedEngineSuites = suitesNeedingIsolation(["packages/engine/src"]);

const sharedGraph = {
  isolate: false,
  unstubGlobals: true,
  unstubEnvs: true,
  restoreMocks: true,
} as const;

export default defineConfig({
  // Watch mode follows the repository's own files, not scratch trees or other checkouts.
  server: { watch: { ignored: [`${ROOT}/tmp/**`, `${ROOT}/.claude/**`, "**/.wrangler/**"] } },
  test: {
    // Transformed modules are cached on disk by content hash. The mutation harness
    // points this at its own directory so mutated sources never land here.
    fsModuleCache: true,
    fsModuleCachePath: process.env.VITEST_MODULE_CACHE_PATH,
    projects: [
      {
        test: {
          name: "engine",
          environment: "node",
          setupFiles,
          include: ["packages/engine/src/**/*.{test,spec}.ts"],
          exclude: [...configDefaults.exclude, ...isolatedEngineSuites],
          // Isolating every engine file would cost most of the run in re-importing the engine.
          ...sharedGraph,
        },
      },
      {
        test: {
          name: "engine-isolated",
          environment: "node",
          setupFiles,
          include: isolatedEngineSuites,
        },
      },
      {
        test: {
          name: "app",
          environment: "node",
          setupFiles,
          include: APP_ROOTS.map((root) => `${root}/**/*.{test,spec}.ts`),
          exclude: [...configDefaults.exclude, ...isolatedAppSuites],
          ...sharedGraph,
        },
      },
      {
        test: {
          name: "app-isolated",
          environment: "node",
          setupFiles,
          include: isolatedAppSuites,
        },
      },
    ],
  },
});
