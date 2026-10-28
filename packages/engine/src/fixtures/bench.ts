import type { Card } from "@colorless/schema";
import snapshot from "./benchPool.json" with { type: "json" };

/** The four real-card archetype decks in `benchPool.json`, which `bun run bench` plays. */
export type BenchDeckName = "charizard" | "gardevoir" | "dragapult" | "miraidon";

const SNAPSHOT = snapshot as unknown as {
  decks: Record<BenchDeckName, [string, number][]>;
  pool: Record<string, Card>;
};

/**
 * The catalog faces the bench decks name, as the API served them when `scripts/bench/write-pool.ts`
 * last ran. An ingest can rewrite it, so a test reads properties of a game on it, never counts.
 */
export const BENCH_POOL: Readonly<Record<string, Card>> = SNAPSHOT.pool;

/** A bench deck as its 60 card ids, in list order. */
export function benchDeck(name: BenchDeckName): string[] {
  return SNAPSHOT.decks[name].flatMap(([id, count]) => Array<string>(count).fill(id));
}
