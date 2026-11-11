// A bounded, seeded fuzz of `applyAction` with hostile wire actions, on states reached by seeded
// walks over the fixture decks. Each action takes the lobby's path:
// a JSON round trip, `wireActionSchema` (as the DO's frame parse), then the actor's own seat
// spread over the claimed one (`applyMatchAction`). The engine is total: it must answer every one
// without throwing or mutating its input, and an accepted action must leave a state the lobby can
// still persist, redact and log. Input states are deep-frozen, so a mutation throws.
//
// The audit's full sweep (145M actions over every fixture deck) found exactly one throw: a turn-1
// `attack` whose index names an array member. This keeps a deterministic slice of it in CI (about
// 68k actions per generator); raise DECK_COUNT and MAX_STEPS locally for a wider sweep. Each deck
// is walked twice, on the legacy mulberry32 generator and on ChaCha20, which every real game uses.

import { wireActionSchema } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameState, RngState } from "./index";
import { applyAction, createGame } from "./index";
import * as Decks from "./fixtures/decks";
import { afterAccept, hostileActionsAt, rngFrom } from "./fixtures/fuzz";
import { FIXTURE_POOL, deepFreeze, drbgSeed, walkGame } from "./testFixtures";

/** Decks walked, steps per walk, and the fuzz rng's seed. The defaults run in a few seconds. */
const DECK_COUNT = 6;
const MAX_STEPS = 60;
const FUZZ_SEED = 0x5ec0;

/** The fixture decks the walks use: every 60-card one, then `DECK_COUNT` of them by a stride, so
    the slice is spread over the file rather than its first entries. */
function fuzzDecks(): [string, string[]][] {
  const all = Object.entries(Decks)
    .filter(([name, deck]) => name.endsWith("_DECK") && Array.isArray(deck) && deck.length === 60)
    .sort(([a], [b]) => a.localeCompare(b)) as [string, string[]][];
  const stride = Math.max(1, Math.floor(all.length / DECK_COUNT));
  return all.filter((_, i) => i % stride === 0).slice(0, DECK_COUNT);
}

describe("applyAction under hostile wire actions (MI3)", () => {
  it("answers every action without throwing, and an accepted one leaves a usable state", () => {
    const rng = rngFrom(FUZZ_SEED);
    const problems = new Map<string, string>();
    let sent = 0;
    let accepted = 0;
    let turnOneAttacks = 0;
    const walks = fuzzDecks().flatMap(([name, deck]) => [
      [name, deck, FUZZ_SEED],
      [`${name} (ChaCha20)`, deck, drbgSeed(FUZZ_SEED)],
    ]) as [string, string[], RngState][];
    for (const [deckName, deck, seed] of walks) {
      const start = createdOn(deck, seed);
      if (start === null) continue;
      walkGame(
        start,
        FUZZ_SEED,
        (state) => {
          const frozen = deepFreeze(state);
          for (const { action, seat } of hostileActionsAt(rng, frozen)) {
            // The DO's path: the frame is JSON, the schema keeps unknown keys, and the actor's
            // own seat replaces whatever the frame claimed.
            const wire = wireActionSchema.safeParse(JSON.parse(JSON.stringify(action)));
            if (!wire.success) continue;
            const bound = { ...wire.data, seat } as GameAction;
            if (bound.type === "attack" && frozen.turn === 1) turnOneAttacks++;
            sent++;
            const where = `${deckName} ${frozen.phase.kind} ${JSON.stringify(bound).slice(0, 200)}`;
            try {
              const result = applyAction(frozen, bound);
              if (!result.ok) continue;
              accepted++;
              const problem = afterAccept(frozen, result.state, result.events);
              if (problem !== null) problems.set(`${bound.type}: ${problem}`, where);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              problems.set(`${bound.type} threw: ${message}`, where);
            }
          }
        },
        { maxSteps: MAX_STEPS },
      );
    }
    // A sweep that sent little or reached no turn-1 attack would pass without testing anything.
    expect(sent).toBeGreaterThan(20_000);
    expect(accepted).toBeGreaterThan(100);
    expect(turnOneAttacks).toBeGreaterThan(0);
    expect(Object.fromEntries(problems)).toEqual({});
    // No `__proto__` key in any frame reached the shared prototype.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // About 6 s alone; the margin covers a loaded machine running the whole suite.
  }, 60_000);
});

/** A fresh game on `deck` for both seats, or null when the fixture deck is not a legal start. */
function createdOn(deck: string[], seed: RngState): GameState | null {
  const created = createGame({
    seed,
    decks: { p1: deck, p2: deck },
    cardPool: FIXTURE_POOL,
  });
  return created.ok ? created.state : null;
}
