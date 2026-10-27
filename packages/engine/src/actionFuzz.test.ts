// A bounded, seeded fuzz of `applyAction` with hostile wire actions, on states reached by seeded
// walks over the fixture decks (security audit, Phase 0; MI3). Each action takes the lobby's path:
// a JSON round trip, `wireActionSchema` (as the DO's frame parse), then the actor's own seat
// spread over the claimed one (`applyMatchAction`). The engine is total: it must answer every one
// without throwing or mutating its input, and an accepted action must leave a state the lobby can
// still persist, redact and log. Input states are deep-frozen, so a mutation throws.
//
// The audit's full sweep (145M actions over every fixture deck) found exactly one throw: a turn-1
// `attack` whose index names an array member. This keeps a deterministic slice of it in CI (about
// 68k actions per generator); raise DECK_COUNT and MAX_STEPS locally for a wider sweep. Each deck
// is walked twice, on the legacy mulberry32 generator and on ChaCha20, which every real game uses
// (MI1).

import { wireActionSchema } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState, InPlayPokemon, RngState, Seat } from "./index";
import { applyAction, createGame, isRngState, logFromEvents, redactGame, SEATS } from "./index";
import * as Decks from "./fixtures/decks";
import { FIXTURE_POOL, candidateActions, deepFreeze, drbgSeed, walkGame } from "./testFixtures";

/** Decks walked, steps per walk, and the fuzz rng's seed. The defaults run in a few seconds. */
const DECK_COUNT = 6;
const MAX_STEPS = 60;
const FUZZ_SEED = 0x5ec0;

/** Values a hostile client puts where a field belongs: prototype keys, wrong types, huge and
    fractional numbers, numeric and NaN strings, and malformed spots. */
const JUNK: readonly unknown[] = [
  null,
  true,
  -1,
  1e9,
  Number.MAX_SAFE_INTEGER,
  1.5,
  "",
  "0",
  "NaN",
  "Infinity",
  "-0",
  "__proto__",
  "constructor",
  "prototype",
  "length",
  "toString",
  "hasOwnProperty",
  [],
  [null],
  ["__proto__"],
  {},
  JSON.parse('{"__proto__":{"polluted":1}}'), // an own `__proto__` key, as a parsed frame carries
  { spot: "bench", index: 99 },
  { spot: "bench", index: -1 },
  { spot: "bench", index: "0" },
  { spot: "bench", index: "__proto__" },
  { spot: "nope" },
  { seat: "p1", spot: { spot: "active" } },
  { seat: "zz", spot: { spot: "active" } },
  { seat: "__proto__", spot: { spot: "active" } },
];

/** Every action type the engine knows, plus names it does not. */
const TYPES: readonly string[] = [
  "chooseFirstPlayer",
  "setupDrawExtra",
  "setupPlaceActive",
  "setupPlaceBench",
  "setupReady",
  "reorderBench",
  "attachEnergy",
  "playBasicToBench",
  "evolve",
  "attachTool",
  "playTrainer",
  "useAbility",
  "useStadiumAbility",
  "rareCandy",
  "concede",
  "attack",
  "takePrizes",
  "promote",
  "retreat",
  "resolveEffect",
  "endTurn",
  "discardFromPlay",
  "bogus",
  "__proto__",
  "constructor",
];

/** The fields actions carry, so a crafted action can put junk in any of them. */
const FIELDS: readonly string[] = [
  "uid",
  "index",
  "target",
  "first",
  "count",
  "abilityName",
  "evolutionUid",
  "prizeIndices",
  "benchIndex",
  "discardEnergy",
  "promoteBenchIndex",
  "choice",
];

/** Effect choice kinds, for junk answers to whatever prompt is parked. */
const CHOICE_KINDS: readonly string[] = [
  "mayDraw",
  "hpGuess",
  "confirm",
  "orderCards",
  "pokemon",
  "pokemonMulti",
  "moveEnergy",
  "discardEnergy",
  "discardTools",
  "cards",
  "attach",
  "attack",
  "prize",
  "bogus",
  "__proto__",
];

/** mulberry32: a small seeded rng, so every run sends the same actions. */
function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;

/** `action` with the value at one of its fields (nested ones included) replaced by junk, or
    removed. `type` and `seat` stay: `seat` is overwritten on the way in anyway. */
function mutate(rng: Rng, action: Record<string, unknown>): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(action)) as Record<string, unknown>;
  const paths: string[][] = [];
  const visit = (obj: Record<string, unknown>, path: string[]) => {
    for (const [key, value] of Object.entries(obj)) {
      if (path.length === 0 && (key === "type" || key === "seat")) continue;
      paths.push([...path, key]);
      if (value !== null && typeof value === "object" && !Array.isArray(value))
        visit(value as Record<string, unknown>, [...path, key]);
    }
  };
  visit(copy, []);
  const path = paths.length === 0 ? [pick(rng, FIELDS)] : pick(rng, paths);
  let holder = copy;
  for (const key of path.slice(0, -1)) holder = holder[key] as Record<string, unknown>;
  const last = path[path.length - 1] as string;
  const roll = rng();
  if (roll < 0.1) delete holder[last];
  else if (roll < 0.2 && Array.isArray(holder[last]))
    holder[last] = [...(holder[last] as unknown[]), ...(holder[last] as unknown[])];
  else if (roll < 0.3) holder[last] = [pick(rng, JUNK)];
  else holder[last] = pick(rng, JUNK);
  return copy;
}

/** A made-up action: any type, any seat, and a few fields of junk. */
function crafted(rng: Rng, seat: Seat): Record<string, unknown> {
  const action: Record<string, unknown> = { type: pick(rng, TYPES), seat };
  const fields = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < fields; i++) action[pick(rng, FIELDS)] = pick(rng, JUNK);
  return action;
}

/** A junk answer to the parked prompt: a real or made-up kind with junk in every field. */
function junkChoice(rng: Rng, seat: Seat): Record<string, unknown> {
  const choice: Record<string, unknown> = { kind: pick(rng, CHOICE_KINDS) };
  for (const key of ["uids", "ref", "refs", "index", "moves", "attachments", "hp", "yes", "draw"])
    if (rng() < 0.5) choice[key] = pick(rng, JUNK);
  return { type: "resolveEffect", seat, choice };
}

/** The turn-1 crafted attack MI3 names, aimed at whichever seat is acting. */
function prototypeAttacks(state: GameState): Record<string, unknown>[] {
  if (state.phase.kind !== "turn:action") return [];
  const seat = state.phase.seat;
  return ["__proto__", "constructor", "length", "toString"].map((index) => ({
    type: "attack",
    seat,
    index,
  }));
}

/** The actions sent at `state`: each seat's candidates sent as either seat (out of turn and for
    the opponent), a mutated copy of each, made-up actions, and junk prompt answers. */
function actionsAt(rng: Rng, state: GameState): { action: unknown; seat: Seat }[] {
  const out: { action: unknown; seat: Seat }[] = [];
  for (const owner of SEATS) {
    for (const candidate of candidateActions(state, owner)) {
      const asRecord = candidate as unknown as Record<string, unknown>;
      out.push({ action: candidate, seat: pick(rng, SEATS) });
      out.push({ action: mutate(rng, asRecord), seat: owner });
    }
  }
  for (const seat of SEATS) {
    for (let i = 0; i < 8; i++) out.push({ action: crafted(rng, seat), seat });
    if (state.phase.kind === "effect:choose")
      for (let i = 0; i < 8; i++) out.push({ action: junkChoice(rng, seat), seat });
    for (const action of prototypeAttacks(state)) out.push({ action, seat });
  }
  return out;
}

/** Every card uid in a zone, sorted: an accepted action moves cards, never mints or loses them. */
function zoneUids(state: GameState): string[] {
  const body = (p: InPlayPokemon | null) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools];
  const uids = SEATS.flatMap((seat) => {
    const side = state.players[seat];
    return [
      ...side.deck,
      ...side.hand,
      ...side.discard,
      ...side.prizes,
      ...body(side.active),
      ...side.bench.flatMap(body),
    ];
  });
  if (state.stadium !== null) uids.push(state.stadium.uid);
  return uids.sort();
}

/** The path to the first value JSON cannot carry (a non-finite number, undefined in an array, a
    function), or null. Storage and the wire are JSON, so such a value silently becomes null. */
function nonJsonAt(value: unknown, path = "state"): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? null : path;
  if (typeof value === "function" || typeof value === "bigint" || typeof value === "symbol")
    return path;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (value[i] === undefined) return `${path}[${i}]`;
      const bad = nonJsonAt(value[i], `${path}[${i}]`);
      if (bad !== null) return bad;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const bad = nonJsonAt(item, `${path}.${key}`);
      if (bad !== null) return bad;
    }
  }
  return null;
}

/** What the lobby does with an accepted action's result: log the events, redact for each seat
    and for spectators, and persist. Returns the first problem, or null. */
function afterAccept(before: GameState, after: GameState, events: GameEvent[]): string | null {
  logFromEvents(events, { names: { p1: "a", p2: "b" }, state: after, elapsed: "+00:00" });
  redactGame(after, "p1");
  redactGame(after, "p2");
  redactGame(after, "p1", true);
  const bad = nonJsonAt(after);
  if (bad !== null) return `non-JSON value at ${bad}`;
  const [was, now] = [zoneUids(before), zoneUids(after)];
  if (was.join() !== now.join()) return `card count ${String(was.length)} -> ${String(now.length)}`;
  // A game keeps its generator: a ChaCha20 game never falls back to a guessable number.
  if (!isRngState(after.rngState) || typeof after.rngState !== typeof before.rngState)
    return "rngState left its generator";
  return null;
}

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
          for (const { action, seat } of actionsAt(rng, frozen)) {
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
