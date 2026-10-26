#!/usr/bin/env bun
// Engine benchmark. Plays seeded games over a committed real-card pool once, then replays the
// recorded actions through applyAction, redactGame (both seats), logFromEvents and the legality
// probes a client makes, and times a cold import of the engine. Prints medians and a SHA-1 over
// every state, event list, redaction and log row, so two builds can be checked for identical play.
// Not part of `check`: timings depend on the machine and are never gated.
//
//   bun run bench [--games N] [--runs N] [--node] [--cpu-prof] [--json <file>]
//
// --node bundles the benchmark and runs it under Node (V8, as in the browser and the Worker).
// --cpu-prof writes a profile of the whole run to tmp/bench/.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type GameAction,
  type GameEvent,
  type GameState,
  type Seat,
  applyAction,
  createGame,
  logFromEvents,
  redactGame,
} from "@colorless/engine";
import { candidateActions, walkGame } from "@colorless/engine/testing";
import type { Card } from "@colorless/schema";
import snapshot from "./bench/pool.json";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const OUT_DIR = resolve(REPO_ROOT, "tmp/bench");
const ENGINE_ENTRY = resolve(REPO_ROOT, "packages/engine/src/index.ts");
const CHILD_ENV = "COLORLESS_BENCH_CHILD";
const ENGINE_BUNDLE_ENV = "COLORLESS_BENCH_ENGINE";

const PAIRS = [
  ["charizard", "gardevoir"],
  ["dragapult", "miraidon"],
  ["charizard", "dragapult"],
  ["gardevoir", "miraidon"],
] as const;
type DeckName = (typeof PAIRS)[number][number];

const SNAPSHOT = snapshot as unknown as {
  decks: Record<DeckName, [string, number][]>;
  pool: Record<string, Card>;
};

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
function option(name: string, fallback: number): number {
  const at = args.indexOf(name);
  if (at === -1) return fallback;
  const value = Number(args[at + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} takes a positive integer`);
  return value;
}
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt === -1 ? undefined : args[jsonAt + 1];
const isBun = typeof process.versions.bun === "string";

if (process.env[CHILD_ENV] === undefined && (flag("--node") || flag("--cpu-prof"))) {
  process.exit(relaunch());
}

function bundle(entry: string, name: string, extra: string[]): void {
  const out = resolve(OUT_DIR, name);
  const run = spawnSync(
    process.execPath,
    ["build", entry, "--target=node", `--outfile=${out}`, ...extra],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`bundling ${entry} failed: ${run.stderr}`);
}

/** Re-runs this benchmark under the runtime and flags asked for; returns its exit code. */
function relaunch(): number {
  mkdirSync(OUT_DIR, { recursive: true });
  const rest = args.filter((a) => a !== "--node" && a !== "--cpu-prof");
  const prof = flag("--cpu-prof") ? ["--cpu-prof", `--cpu-prof-dir=${OUT_DIR}`] : [];
  const env: Record<string, string | undefined> = { ...process.env, [CHILD_ENV]: "1" };
  let argv: string[];
  if (flag("--node")) {
    bundle(resolve(REPO_ROOT, "scripts/bench.ts"), "bench.node.mjs", []);
    bundle(ENGINE_ENTRY, "engine.node.mjs", ["--minify"]);
    env[ENGINE_BUNDLE_ENV] = resolve(OUT_DIR, "engine.node.mjs");
    argv = ["node", ...prof, resolve(OUT_DIR, "bench.node.mjs"), ...rest];
  } else {
    argv = [process.execPath, ...prof, resolve(REPO_ROOT, "scripts/bench.ts"), ...rest];
  }
  const [cmd = "node", ...cmdArgs] = argv;
  const run = spawnSync(cmd, cmdArgs, { stdio: "inherit", env });
  if (prof.length > 0) console.log(`cpu profile written to ${OUT_DIR}`);
  return run.status ?? 1;
}

interface Trajectory {
  initial: GameState;
  actions: GameAction[];
}

function deckOf(name: DeckName): string[] {
  return SNAPSHOT.decks[name].flatMap(([id, count]) => Array<string>(count).fill(id));
}

function record(games: number): Trajectory[] {
  const out: Trajectory[] = [];
  for (let g = 0; g < games; g += 1) {
    const [a, b] = PAIRS[g % PAIRS.length] ?? PAIRS[0];
    const created = createGame({
      seed: 1000 + g,
      decks: { p1: deckOf(a), p2: deckOf(b) },
      cardPool: SNAPSHOT.pool,
    });
    if (!created.ok) throw new Error(created.error.message);
    const actions: GameAction[] = [];
    walkGame(created.state, 7 + g, () => {}, {
      maxSteps: 600,
      onStep: (_before, action) => actions.push(action),
    });
    out.push({ initial: created.state, actions });
  }
  return out;
}

const NAMES: Record<Seat, string> = { p1: "One", p2: "Two" };

function mustApply(
  state: GameState,
  action: GameAction,
): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`replay diverged at ${action.type}: ${result.error.message}`);
  return result;
}

/** Microseconds of `pass` per recorded action, one sample per run. */
type Pass = (trajs: readonly Trajectory[], perType?: Map<string, number[]>) => number;

const applyPass: Pass = (trajs, perType) => {
  let total = 0;
  for (const t of trajs) {
    let state = t.initial;
    for (const action of t.actions) {
      const t0 = performance.now();
      const result = applyAction(state, action);
      const dt = performance.now() - t0;
      if (!result.ok) throw new Error(`replay diverged at ${action.type}`);
      total += dt;
      if (perType !== undefined) {
        const times = perType.get(action.type);
        if (times === undefined) perType.set(action.type, [dt]);
        else times.push(dt);
      }
      state = result.state;
    }
  }
  return total;
};

function timedAfterApply(work: (state: GameState, events: GameEvent[]) => void): Pass {
  return (trajs) => {
    let total = 0;
    for (const t of trajs) {
      let state = t.initial;
      for (const action of t.actions) {
        const result = mustApply(state, action);
        const t0 = performance.now();
        work(result.state, result.events);
        total += performance.now() - t0;
        state = result.state;
      }
    }
    return total;
  };
}

const redactPass = timedAfterApply((state) => {
  redactGame(state, "p1");
  redactGame(state, "p2");
});

const logPass = timedAfterApply((state, events) => {
  logFromEvents(events, { names: NAMES, state, elapsed: "+00:00" });
});

let probeCount = 0;
const probePass: Pass = (trajs) => {
  let total = 0;
  probeCount = 0;
  for (const t of trajs) {
    let state = t.initial;
    for (const action of t.actions) {
      if (state.phase.kind === "turn:action") {
        const t0 = performance.now();
        for (const candidate of candidateActions(state, state.phase.seat)) {
          applyAction(state, candidate);
          probeCount += 1;
        }
        total += performance.now() - t0;
      }
      state = mustApply(state, action).state;
    }
  }
  return total;
};

function fingerprint(trajs: readonly Trajectory[]): string {
  const hash = createHash("sha1");
  for (const t of trajs) {
    let state = t.initial;
    hash.update(JSON.stringify(state));
    for (const action of t.actions) {
      const result = mustApply(state, action);
      state = result.state;
      hash.update(JSON.stringify(result.events));
      hash.update(JSON.stringify(state));
      hash.update(JSON.stringify(redactGame(state, "p1")));
      hash.update(JSON.stringify(redactGame(state, "p2")));
      hash.update(
        JSON.stringify(logFromEvents(result.events, { names: NAMES, state, elapsed: "" })),
      );
    }
  }
  return hash.digest("hex");
}

function median(xs: readonly number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Milliseconds to import the engine in a fresh process, median of `n`. */
function importMs(n: number): number {
  const bundle = process.env[ENGINE_BUNDLE_ENV];
  const target = isBun ? ENGINE_ENTRY : bundle;
  if (target === undefined) return Number.NaN;
  const code = `const t0 = performance.now(); await import(${JSON.stringify(target)}); console.log(performance.now() - t0);`;
  const argv = isBun ? ["-e", code] : ["--input-type=module", "-e", code];
  const samples: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const run = spawnSync(process.execPath, argv, { encoding: "utf8" });
    if (run.status !== 0) throw new Error(`engine import failed: ${run.stderr}`);
    samples.push(Number(run.stdout.trim()));
  }
  return median(samples);
}

const games = option("--games", 40);
const runs = option("--runs", 7);
const runtime = isBun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;

const t0 = performance.now();
const trajs = record(games);
const recordMs = performance.now() - t0;
const actions = trajs.reduce((n, t) => n + t.actions.length, 0);
const turnActions = trajs.reduce((n, t) => {
  let state = t.initial;
  let k = 0;
  for (const action of t.actions) {
    if (state.phase.kind === "turn:action") k += 1;
    state = mustApply(state, action).state;
  }
  return n + k;
}, 0);

const passes = { apply: applyPass, redact2: redactPass, log: logPass, probes: probePass };
const samples: Record<keyof typeof passes, number[]> = {
  apply: [],
  redact2: [],
  log: [],
  probes: [],
};
const perType = new Map<string, number[]>();
for (const pass of Object.values(passes)) pass(trajs);
for (let r = 0; r < runs; r += 1) {
  for (const [name, pass] of Object.entries(passes) as [keyof typeof passes, Pass][]) {
    samples[name].push((pass(trajs, name === "apply" ? perType : undefined) * 1000) / actions);
  }
}

const result = {
  runtime,
  games,
  runs,
  actions,
  recordMs: Math.round(recordMs),
  usPerAction: Object.fromEntries(
    Object.entries(samples).map(([k, v]) => [k, Number(median(v).toFixed(2))]),
  ),
  probesPerTurnAction: Number((probeCount / turnActions).toFixed(1)),
  applyP50ByType: Object.fromEntries(
    [...perType.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, v]) => [
        type,
        { n: v.length / runs, us: Number((median(v) * 1000).toFixed(2)) },
      ]),
  ),
  importMs: Number(importMs(5).toFixed(1)),
  fingerprint: fingerprint(trajs),
};

console.log(`engine bench · ${runtime} · ${games} games · ${actions} actions · ${runs} runs`);
console.log(`recorded in ${result.recordMs} ms; engine import ${result.importMs} ms (median of 5)`);
console.log("µs per recorded action (median of runs):");
for (const [name, us] of Object.entries(result.usPerAction))
  console.log(`  ${name.padEnd(8)} ${String(us).padStart(8)}`);
console.log(`  (probes: ${result.probesPerTurnAction} candidates per turn:action state)`);
console.log("applyAction p50 by action type (µs, actions per run):");
for (const [type, { n, us }] of Object.entries(result.applyP50ByType))
  console.log(`  ${type.padEnd(20)} ${String(us).padStart(8)}  ×${n}`);
console.log(`fingerprint ${result.fingerprint}`);
if (jsonOut !== undefined) writeFileSync(resolve(jsonOut), `${JSON.stringify(result, null, 2)}\n`);
