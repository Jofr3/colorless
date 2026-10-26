#!/usr/bin/env bun
/**
 * The repo's module import graph. `--check` fails when a runtime (non-test) import cycle other than
 * the recorded one exists, or when a relative import crosses a workspace root (each package, each
 * app, `src`, `scripts`); cross-root imports go through the package's `exports` instead. It also
 * fails when the web page's eager bundle (everything `EAGER_ENTRY` imports without `import()`)
 * reaches a module in `LAZY_ONLY`. Without `--check` it prints every runtime cycle and every
 * crossing import. A step of `bun run check`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { expandedCheckScript, fail, isRecord, parseJson } from "./lib/cli";
import { REPO_ROOT, repoPath, repoSourceFiles } from "./lib/repo";

const SELF_PATH = "scripts/import-graph.ts";

/**
 * The one runtime cycle the engine keeps on purpose: a program step can knock a Pokémon out, which
 * runs triggers and the between-turns flow, which run programs again.
 */
export const RECORDED_CYCLE: readonly string[] = [
  "packages/engine/src/flow.ts",
  "packages/engine/src/interpreter.ts",
  "packages/engine/src/ops/board.ts",
  "packages/engine/src/ops/energy.ts",
  "packages/engine/src/triggers.ts",
];

/**
 * Relative imports allowed to cross a root, as `from -> specifier`. The web app under `src` is not a
 * package, so a script reading from it has no package entry to go through.
 */
export const ALLOWED_CROSSINGS: readonly string[] = [
  "scripts/lua-constants.ts -> ../src/host/mailboxes",
  "scripts/lua-constants.ts -> ../src/lua/wireFields",
];

/** The web page's one module script. */
export const EAGER_ENTRY = "src/lua/bridge.ts";

/**
 * Modules the page loads only through `import()`: the full engine entry pulls in the rules
 * interpreter, which only the game table, sandbox setup and the builder's simulation gaps need.
 */
export const LAZY_ONLY: readonly string[] = ["packages/engine/src/index.ts"];

const EXTENSIONS = ["ts", "tsx", "mts", "cts"];
const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".mts", ".cts", "/index.ts", "/index.tsx"];
const WORKSPACE_GROUPS = ["packages", "apps"];
const ROOT_DIRS = ["src", "scripts"];

const isTestFile = (file: string): boolean => /\.test\.tsx?$/.test(file);

/** The workspace root a repo-relative path belongs to; files at the repo root belong to ".". */
export function workspaceRootOf(file: string): string {
  const parts = file.split("/");
  const head = parts[0] ?? "";
  if (WORKSPACE_GROUPS.includes(head) && parts.length > 2) return `${head}/${parts[1]}`;
  if (ROOT_DIRS.includes(head) && parts.length > 1) return head;
  return ".";
}

type Import = { specifier: string; runtime: boolean; dynamic?: boolean };

const STATEMENT_START = /^(?:import\b|export(?:\s+type)?\s*[{*])/;
const FROM = /\bfrom\s*["']([^"']+)["']/;
const SIDE_EFFECT = /^import\s*["']([^"']+)["']/;
const DYNAMIC = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

/** True when every binding the statement names is type-only, so it is erased at runtime. */
function isTypeOnly(statement: string): boolean {
  if (/^(?:import|export)\s+type\b/.test(statement)) return true;
  const head = statement.slice(0, statement.search(FROM));
  const braces = /^(?:import|export)\s*\{([^}]*)\}\s*$/.exec(head.trim());
  if (!braces) return false;
  const names = (braces[1] ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  return names.length > 0 && names.every((n) => n.startsWith("type "));
}

/**
 * Every module specifier a Biome-formatted file names, and whether the import survives type
 * erasure. Top-level import and re-export statements start at column 0 and end with a semicolon.
 */
export function importsOf(source: string): Import[] {
  const out: Import[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!STATEMENT_START.test(lines[i] ?? "")) continue;
    let statement = lines[i] ?? "";
    while (!statement.trimEnd().endsWith(";") && i + 1 < lines.length) {
      i++;
      statement += `\n${lines[i]}`;
    }
    const specifier = (FROM.exec(statement) ?? SIDE_EFFECT.exec(statement))?.[1];
    if (specifier !== undefined) out.push({ specifier, runtime: !isTypeOnly(statement) });
  }
  for (const m of source.matchAll(DYNAMIC))
    out.push({ specifier: m[1] ?? "", runtime: true, dynamic: true });
  return out;
}

/** Workspace package entry points: `@scope/name[/sub]` to a repo-relative file. */
function packageEntries(): Map<string, string> {
  const entries = new Map<string, string>();
  for (const group of WORKSPACE_GROUPS) {
    const dir = repoPath(group);
    if (!existsSync(dir)) continue;
    for (const name of readdirNames(dir)) {
      const pkgPath = join(dir, name, "package.json");
      if (!existsSync(pkgPath)) continue;
      const pkg = parseJson(readFileSync(pkgPath, "utf8"), pkgPath, isRecord);
      if (typeof pkg.name !== "string" || !isRecord(pkg.exports)) continue;
      for (const [sub, target] of Object.entries(pkg.exports)) {
        if (typeof target !== "string") continue;
        const spec = sub === "." ? pkg.name : `${pkg.name}/${sub.replace(/^\.\//, "")}`;
        entries.set(spec, relative(REPO_ROOT, resolve(dir, name, target)));
      }
    }
  }
  return entries;
}

function readdirNames(dir: string): string[] {
  return readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
}

function resolveRelative(
  from: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | null {
  const base = relative(REPO_ROOT, resolve(REPO_ROOT, dirname(from), specifier));
  for (const suffix of RESOLVE_SUFFIXES) {
    if (known.has(base + suffix)) return base + suffix;
  }
  return null;
}

function resolvePackage(specifier: string, entries: ReadonlyMap<string, string>): string | null {
  const exact = entries.get(specifier);
  if (exact) return exact;
  for (const [spec, target] of entries) {
    if (!spec.includes("*")) continue;
    const [head = "", tail = ""] = spec.split("*");
    if (specifier.startsWith(head) && specifier.endsWith(tail)) {
      const middle = specifier.slice(head.length, specifier.length - tail.length);
      return target.replace("*", middle);
    }
  }
  return null;
}

export type Graph = {
  runtimeEdges: Map<string, Set<string>>;
  /** Runtime edges other than `import()`: what a bundler puts in the importer's chunk. */
  staticEdges: Map<string, Set<string>>;
  crossings: { from: string; specifier: string; to: string }[];
};

export function buildGraph(files: readonly string[], read: (file: string) => string): Graph {
  const known = new Set(files);
  const entries = packageEntries();
  const runtimeEdges = new Map<string, Set<string>>();
  const staticEdges = new Map<string, Set<string>>();
  const crossings: Graph["crossings"] = [];
  for (const file of files) {
    const edges = new Set<string>();
    const eager = new Set<string>();
    for (const imp of importsOf(read(file))) {
      const relativeSpec = imp.specifier.startsWith(".");
      if (relativeSpec) {
        const path = relative(REPO_ROOT, resolve(REPO_ROOT, dirname(file), imp.specifier));
        if (workspaceRootOf(path) !== workspaceRootOf(file)) {
          crossings.push({ from: file, specifier: imp.specifier, to: path });
        }
      }
      const target = relativeSpec
        ? resolveRelative(file, imp.specifier, known)
        : resolvePackage(imp.specifier, entries);
      if (target === null) continue;
      if (imp.runtime && !isTestFile(file) && !isTestFile(target)) {
        edges.add(target);
        if (!imp.dynamic) eager.add(target);
      }
    }
    if (!isTestFile(file)) {
      runtimeEdges.set(file, edges);
      staticEdges.set(file, eager);
    }
  }
  return { runtimeEdges, staticEdges, crossings };
}

/** Tarjan's strongly connected components with more than one member (or a self-import). */
export function cyclesOf(edges: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  const visit = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) ?? 0, index.get(w) ?? 0));
      }
    }
    if (low.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1 || edges.get(v)?.has(v)) out.push(scc.sort());
    }
  };
  for (const v of [...edges.keys()].sort()) if (!index.has(v)) visit(v);
  return out.sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? ""));
}

/** The import chain from `entry` to the first `targets` module its static imports reach, if any. */
export function eagerPathTo(
  edges: ReadonlyMap<string, ReadonlySet<string>>,
  entry: string,
  targets: readonly string[],
): string[] | null {
  const parent = new Map<string, string>([[entry, entry]]);
  const queue = [entry];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (targets.includes(next)) {
      const path = [next];
      while (path[0] !== entry) path.unshift(parent.get(path[0] ?? "") ?? entry);
      return path;
    }
    for (const to of edges.get(next) ?? []) {
      if (parent.has(to)) continue;
      parent.set(to, next);
      queue.push(to);
    }
  }
  return null;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));

export function problemsOf(graph: Graph): string[] {
  const problems: string[] = [];
  const cycles = cyclesOf(graph.runtimeEdges);
  for (const scc of cycles) {
    if (sameSet(scc, RECORDED_CYCLE)) continue;
    problems.push(
      `import-graph: FAIL — runtime import cycle of ${scc.length} module(s) is not the recorded one:`,
      ...scc.map((f) => `  ${f}`),
    );
  }
  if (!cycles.some((scc) => sameSet(scc, RECORDED_CYCLE))) {
    problems.push(
      "import-graph: FAIL — the recorded cycle no longer exists as recorded. If it shrank, update",
      `RECORDED_CYCLE in ${SELF_PATH} to what remains.`,
    );
  }
  const seen = new Set(graph.crossings.map((c) => `${c.from} -> ${c.specifier}`));
  for (const allowed of ALLOWED_CROSSINGS) {
    if (!seen.has(allowed)) {
      problems.push(
        `import-graph: FAIL — allowed crossing "${allowed}" no longer exists; remove it from ALLOWED_CROSSINGS.`,
      );
    }
  }
  for (const c of graph.crossings) {
    if (ALLOWED_CROSSINGS.includes(`${c.from} -> ${c.specifier}`)) continue;
    problems.push(
      `import-graph: FAIL — ${c.from} imports "${c.specifier}" across a workspace root (${c.to}); use the package's exports.`,
    );
  }
  const eager = eagerPathTo(graph.staticEdges, EAGER_ENTRY, LAZY_ONLY);
  if (eager) {
    problems.push(
      "import-graph: FAIL — the page's eager bundle reaches a lazy-only module; import engine values from `@colorless/engine/rules`, or load the code with `import()`:",
      ...eager.map((f) => `  ${f}`),
    );
  }
  return problems;
}

/** Keeps the guard able to go red: a known cycle and a known crossing must both be reported. */
export function selfCheck(): string[] {
  const problems: string[] = [];
  const files: Record<string, string> = {
    "src/a.ts": 'import {\n  b,\n} from "./b";\nimport { type T, type U } from "./c";',
    "src/b.ts": 'export { a } from "./a";',
    "src/c.ts":
      'import { a } from "./a";\nimport { x } from "../scripts/x";\nconst d = () => import("./d");',
    "src/d.ts": "export const d = 1;",
    "scripts/x.ts": "export const x = 1;",
  };
  const graph = buildGraph(Object.keys(files), (f) => files[f] ?? "");
  const cycles = cyclesOf(graph.runtimeEdges);
  if (cycles.length !== 1 || !sameSet(cycles[0] ?? [], ["src/a.ts", "src/b.ts"])) {
    problems.push(
      `import-graph: SELF-CHECK FAILED — expected the cycle [src/a.ts, src/b.ts] and no other (a type-only import is not an edge), got ${JSON.stringify(cycles)}.`,
    );
  }
  if (
    eagerPathTo(graph.staticEdges, "src/c.ts", ["src/d.ts"]) !== null ||
    eagerPathTo(graph.runtimeEdges, "src/c.ts", ["src/d.ts"])?.join(" ") !== "src/c.ts src/d.ts"
  ) {
    problems.push(
      "import-graph: SELF-CHECK FAILED — expected src/d.ts reachable from src/c.ts only through import().",
    );
  }
  if (graph.crossings.length !== 1 || graph.crossings[0]?.to !== "scripts/x") {
    problems.push(
      `import-graph: SELF-CHECK FAILED — expected one crossing into scripts/x, got ${JSON.stringify(graph.crossings)}.`,
    );
  }
  return problems;
}

/** A guard `check` no longer runs looks the same as one that passes. */
function checkRunsThisGuard(): string[] {
  const call = `${SELF_PATH} --check`;
  if (expandedCheckScript().includes(call)) return [];
  return [
    `import-graph: FAIL — \`${call}\` is not part of the \`check\` script in package.json.`,
    "Re-add it (NOT by deleting this rung).",
  ];
}

function main(): void {
  const check = process.argv.includes("--check");
  const t0 = performance.now();
  const files = repoSourceFiles(EXTENSIONS);
  const graph = buildGraph(files, (f) => readFileSync(repoPath(f), "utf8"));
  if (!check) {
    for (const scc of cyclesOf(graph.runtimeEdges)) {
      console.log(`cycle (${scc.length}):`);
      for (const f of scc) console.log(`  ${f}`);
    }
    for (const c of graph.crossings) console.log(`crossing: ${c.from} -> ${c.specifier}`);
    return;
  }
  const problems = [...selfCheck(), ...checkRunsThisGuard(), ...problemsOf(graph)];
  if (problems.length > 0) fail(problems.join("\n"));
  const ms = (performance.now() - t0).toFixed(0);
  console.log(
    `import-graph: OK — ${files.length} files, one recorded runtime cycle of ${RECORDED_CYCLE.length} modules, no cross-root relative imports beyond the ${ALLOWED_CROSSINGS.length} allowed · ${ms}ms.`,
  );
}

if (import.meta.main) main();
