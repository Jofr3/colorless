import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
} from "./testFixtures";

// ── 🆕🆕🆕 D560 — THE ABILITY BUNDLE, PART 1: THE ELEVEN REGISTRY ROWS AND THE FIVE
//    TRIGGERED ABILITIES ──
//
//   Drilbur               sv05-085                 "Dig Dig Dig"         onPlayToBench → search {F} → discard
//   Team Rocket's Koffing sv10-125                 "Smog Signals"        onDamagedByAttack → 2 "Koffing" → Bench
//   Whimsicott            sv05-015 / sv08.5-008    "Wafting Heal"        onEvolve → gates → confirm → heal "all" + discard
//   Dachsbun ex           sv07-067 / -160 / -169   "Time to Chow Down"   onEvolve → confirm → healEach "all" Evolution
//   Indeedee              sv08-093 / svp-154       "Obliging Heal"       onPlayToBench → heal 30 → recoverOneStatus
//
// Part 2 (the three passives, Magmortar, Thwackey and Cradily) is
// `abilityPassivesD560.test.ts`. Every board rides a LOCAL `cardPool` (D275) in the suite's
// OWN 60-card deck (D270): the printed cards transcribed from the tcgdex JSON (2026-09-26)
// plus `d560-*` demonstrators. Readings R-KF, R-DB and the `MATCH_RECORD_VERSION` hold:
// docs/decisions.md D560.

const DRILBUR = "sv05-085";
const KOFFING_TR = "sv10-125";
const KOFFING = "sv09-091"; // Basic, no Ability — the second "Koffing" the search may take
const WHIMSICOTT = ["sv05-015", "sv08.5-008"] as const;
const COTTONEE = "sv05-014";
const DACHSBUN = ["sv07-067", "sv07-160", "sv07-169"] as const;
const FIDOUGH = "sv07-066";
const INDEEDEE = ["sv08-093", "svp-154"] as const;

const WAFTING_HEAL_TEXT =
  "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may heal all damage from your Active {G} Pokémon. If you healed any damage in this way, discard all Energy from that Pokémon.";
const CHOW_DOWN_TEXT =
  "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may heal all damage from each of your Evolution Pokémon. If you healed any damage in this way, discard all Energy from those Pokémon.";

const HITTER = "d560-hitter"; // {C}: Poke 50 / Smash 100
const GRASS = "d560-grass"; // a {G} Basic, 300 HP — Wafting Heal's noun
const WATER = "d560-water"; // a {W} Basic, 300 HP — the non-{G} control
const SPROUT = "d560-sprout"; // a {C} STAGE 1 (an Evolution Pokémon), 300 HP
const WALL = "d560-wall"; // a {C} Basic, 900 HP, no Ability

const LOCAL_CARDS: Record<string, Card> = {
  [DRILBUR]: battler(DRILBUR, {
    name: "Drilbur",
    hp: 70,
    retreat: 1,
    types: ["Fighting"],
    weaknesses: [{ type: "Grass", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Dig Dig Dig",
        effect:
          "When you play this Pokémon from your hand onto your Bench during your turn, you may search your deck for up to 3 Basic {F} Energy cards and discard them. Then, shuffle your deck.",
      },
    ],
    attacks: [{ cost: ["Fighting", "Colorless"], name: "Sand Spray", damage: 20 }],
  }),
  [KOFFING_TR]: battler(KOFFING_TR, {
    name: "Team Rocket's Koffing",
    hp: 70,
    retreat: 1,
    types: ["Darkness"],
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Smog Signals",
        effect:
          'If this Pokémon is in the Active Spot and is damaged by an attack from your opponent\'s Pokémon (even if this Pokémon is Knocked Out), search your deck for up to 2 Pokémon that have "Koffing" in their name and put them onto your Bench. Then, shuffle your deck.',
      },
    ],
    attacks: [{ cost: ["Darkness", "Colorless"], name: "Leaking Gas", damage: 30 }],
  }),
  [KOFFING]: battler(KOFFING, { name: "Koffing", hp: 70, retreat: 1, types: ["Darkness"] }),
  ...Object.fromEntries(
    WHIMSICOTT.map((id) => [
      id,
      battler(id, {
        name: "Whimsicott",
        stage: "Stage1",
        evolveFrom: "Cottonee",
        hp: 100,
        retreat: 1,
        types: ["Grass"],
        weaknesses: [{ type: "Fire", value: "×2" }],
        abilities: [{ type: "Ability", name: "Wafting Heal", effect: WAFTING_HEAL_TEXT }],
        attacks: [{ cost: ["Grass"], name: "Seed Bomb", damage: 40 }],
      }),
    ]),
  ),
  [COTTONEE]: battler(COTTONEE, { name: "Cottonee", hp: 60, retreat: 1, types: ["Grass"] }),
  ...Object.fromEntries(
    DACHSBUN.map((id) => [
      id,
      battler(id, {
        name: "Dachsbun ex",
        stage: "Stage1",
        evolveFrom: "Fidough",
        hp: 250,
        retreat: 2,
        types: ["Psychic"],
        weaknesses: [{ type: "Metal", value: "×2" }],
        abilities: [{ type: "Ability", name: "Time to Chow Down", effect: CHOW_DOWN_TEXT }],
        attacks: [
          {
            cost: ["Colorless", "Colorless"],
            name: "Wonder Shine",
            damage: 130,
            effect: "Your opponent's Active Pokémon is now Confused.",
          },
        ],
      }),
    ]),
  ),
  [FIDOUGH]: battler(FIDOUGH, { name: "Fidough", hp: 60, retreat: 2, types: ["Psychic"] }),
  ...Object.fromEntries(
    INDEEDEE.map((id) => [
      id,
      battler(id, {
        name: "Indeedee",
        hp: 100,
        retreat: 1,
        types: ["Psychic"],
        weaknesses: [{ type: "Darkness", value: "×2" }],
        resistances: [{ type: "Fighting", value: "-30" }],
        abilities: [
          {
            type: "Ability",
            name: "Obliging Heal",
            effect:
              "When you play this Pokémon from your hand onto your Bench during your turn, you may heal 30 damage from your Active Pokémon and have it recover from a Special Condition.",
          },
        ],
        attacks: [{ cost: ["Psychic", "Colorless"], name: "Super Psy Bolt", damage: 50 }],
      }),
    ]),
  ),
  [HITTER]: battler(HITTER, {
    name: "D560 Hitter",
    hp: 300,
    retreat: 1,
    types: ["Colorless"],
    attacks: [
      { cost: ["Colorless"], name: "Poke", damage: 50 },
      { cost: ["Colorless"], name: "Smash", damage: 100 },
    ],
  }),
  [GRASS]: battler(GRASS, { name: "D560 Grass", hp: 300, retreat: 1, types: ["Grass"] }),
  [WATER]: battler(WATER, { name: "D560 Water", hp: 300, retreat: 1, types: ["Water"] }),
  [SPROUT]: battler(SPROUT, {
    name: "D560 Sprout",
    stage: "Stage1",
    evolveFrom: "D560 Seed",
    hp: 300,
    retreat: 1,
    types: ["Colorless"],
  }),
  [WALL]: battler(WALL, { name: "D560 Wall", hp: 900, retreat: 2, types: ["Colorless"], weaknesses: null }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [DRILBUR]: 1,
  [KOFFING_TR]: 2,
  [KOFFING]: 2,
  [WHIMSICOTT[0]]: 1,
  [WHIMSICOTT[1]]: 1,
  [COTTONEE]: 2,
  [DACHSBUN[0]]: 1,
  [DACHSBUN[1]]: 1,
  [DACHSBUN[2]]: 1,
  [FIDOUGH]: 2,
  [INDEEDEE[0]]: 1,
  [INDEEDEE[1]]: 1,
  [HITTER]: 2,
  [GRASS]: 2,
  [WATER]: 2,
  [SPROUT]: 2,
  [WALL]: 6,
  "fix-fighting-energy": 4,
  "fix-energy": 26,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup with p2 going first; p1's turn 2 after p2 passed — or, with `evolve`, p1's turn
    4 (§4: nobody evolves on their first turn). */
function opened(seed: number, evolve = false): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic");
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (!evolve) return state;
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** TEST SURGERY — `count` copies of `id` into `seat`'s DECK (back from the hand, or
    swapped out of the Prizes). Every uid stays in exactly one zone. */
function ensureInDeck(state: GameState, seat: Seat, id: string, count = 1): GameState {
  let next = state;
  for (;;) {
    const side = next.players[seat];
    if (side.deck.filter((u) => next.cardIdByUid[u] === id).length >= count) return next;
    const held = side.hand.find((u) => next.cardIdByUid[u] === id);
    if (held !== undefined) {
      const moved = { ...side, hand: side.hand.filter((u) => u !== held), deck: [...side.deck, held] };
      next = { ...next, players: { ...next.players, [seat]: moved } };
      continue;
    }
    const prized = side.prizes.find((u) => next.cardIdByUid[u] === id);
    const swap = side.deck.find((u) => next.cardIdByUid[u] !== id);
    if (prized === undefined || swap === undefined) throw new Error(`${seat} has no ${id} to seat`);
    const moved = {
      ...side,
      prizes: side.prizes.map((u) => (u === prized ? swap : u)),
      deck: [...side.deck.filter((u) => u !== swap), prized],
    };
    next = { ...next, players: { ...next.players, [seat]: moved } };
  }
}

/** TEST SURGERY — every copy of `id` OUT of `seat`'s deck (into the discard pile). */
function purgeFromDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  const gone = side.deck.filter((u) => state.cardIdByUid[u] === id);
  const moved = { ...side, deck: side.deck.filter((u) => !gone.includes(u)), discard: [...side.discard, ...gone] };
  return { ...state, players: { ...state.players, [seat]: moved } };
}

function seatActive(state: GameState, seat: Seat, id: string): GameState {
  const active = state.players[seat].active;
  const top = active?.stack[active.stack.length - 1];
  if (top !== undefined && state.cardIdByUid[top] === id) return state;
  return setActiveFromDeck(ensureInDeck(state, seat, id), seat, id);
}

/** A fresh board: `active` / `bench` for p1 and `oppActive` / `oppBench` for p2, and the
    named cards in p1's HAND. */
function table(
  opts: {
    active: string;
    bench?: readonly string[];
    oppActive?: string;
    oppBench?: readonly string[];
    hand?: readonly string[];
    evolve?: boolean;
  },
  seed = 5602,
): GameState {
  let state = opened(seed, opts.evolve === true);
  state = seatActive(state, "p1", opts.active);
  state = seatActive(state, "p2", opts.oppActive ?? WALL);
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  for (const id of opts.bench ?? []) state = benchFromDeck(ensureInDeck(state, "p1", id), "p1", id);
  for (const id of opts.oppBench ?? []) state = benchFromDeck(ensureInDeck(state, "p2", id), "p2", id);
  for (const id of opts.hand ?? []) state = handFromDeck(ensureInDeck(state, "p1", id), "p1", id, 1);
  return state;
}

function body(state: GameState, seat: Seat, spot: "active" | number = "active"): InPlayPokemon {
  const side = state.players[seat];
  const found = spot === "active" ? side.active : side.bench[spot];
  if (found === null || found === undefined) throw new Error(`${seat} has no body at ${spot}`);
  return found;
}
const idOf = (state: GameState, pokemon: InPlayPokemon) =>
  state.cardIdByUid[pokemon.stack[pokemon.stack.length - 1] as string];
const handUidOf = (state: GameState, id: string) =>
  state.players.p1.hand.find((u) => state.cardIdByUid[u] === id) as string;

/** TEST SURGERY — bench[index]'s damage for `seat`. */
function benchDamage(state: GameState, seat: Seat, index: number, damage: number): GameState {
  const side = state.players[seat];
  const bench = side.bench.map((b, i) => (i === index ? { ...b, damage } : b));
  return { ...state, players: { ...state.players, [seat]: { ...side, bench } } };
}

function prompt(state: GameState): Record<string, unknown> {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt as unknown as Record<string, unknown>;
}
const confirm = (state: GameState, yes: boolean, seat: Seat = "p1") =>
  mustApply(state, { type: "resolveEffect", seat, choice: { kind: "confirm", yes } });

/** A revived record: through JSON, optionally with EVERY `labels` key STRIPPED — from the
    parked prompt, the pending op AND the chain link nested in its `otherwise` (the reader
    that does not know `labels`). */
function revived(state: GameState, stripLabels = false): GameState {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "labels")
        .map(([key, inner]) => [key, strip(inner)]),
    );
  };
  const copy = JSON.parse(JSON.stringify(state)) as GameState;
  return (stripLabels ? { ...copy, phase: strip(copy.phase) } : copy) as GameState;
}

// ────────────────────────────────────────────────────────────────────────────
describe("D560 §1 — the eleven registry rows: 17 printings, 11 objects, NO `attack` key", () => {
  const ROWS: readonly { ids: readonly string[]; key: "triggered" | "abilities" | "passive"; name?: string }[] = [
    { ids: [DRILBUR], key: "triggered", name: "Dig Dig Dig" },
    { ids: [KOFFING_TR], key: "triggered", name: "Smog Signals" },
    { ids: ["sv06-015", "svp-115"], key: "abilities", name: "Boom Boom Groove" },
    { ids: ["sv08-147", "sv08-227"], key: "passive" },
    { ids: ["sv10-092"], key: "passive" },
    { ids: ["sv06.5-002"], key: "passive" },
    { ids: ["sv09-021"], key: "passive" },
    { ids: WHIMSICOTT, key: "triggered", name: "Wafting Heal" },
    { ids: DACHSBUN, key: "triggered", name: "Time to Chow Down" },
    { ids: INDEEDEE, key: "triggered", name: "Obliging Heal" },
    { ids: ["sv07-006"], key: "abilities", name: "Selective Slime" },
  ];

  it("17 ids on 11 objects, each ONE key, reprints sharing their object", () => {
    const ids = ROWS.flatMap((r) => r.ids);
    expect(ids).toHaveLength(17);
    expect(new Set(ids.map((id) => programFor(id))).size).toBe(11);
    for (const row of ROWS) {
      const first = programFor(row.ids[0] as string);
      for (const id of row.ids) {
        expect(programFor(id), id).toBe(first);
        expect(Object.keys(programFor(id) ?? {}), id).toEqual([row.key]);
      }
      if (row.name !== undefined) {
        const entries = (first?.[row.key] ?? []) as readonly { name: string }[];
        expect(entries.map((e) => e.name)).toEqual([row.name]);
      }
    }
  });

  it("MID-MAP: every id is keyed and `raw[last]` is still `sv09-107`", () => {
    const keys = registryCardIds();
    expect(keys[keys.length - 1]).toBe("sv09-107");
    for (const row of ROWS) for (const id of row.ids) expect(keys).toContain(id);
  });

  it("the triggered rows' timings, `optional` and Active-Spot clauses are the printed ones", () => {
    const t = (id: string) => programFor(id)?.triggered?.[0];
    expect(t(DRILBUR)).toMatchObject({ trigger: "onPlayToBench", optional: true });
    expect(t(KOFFING_TR)).toMatchObject({ trigger: "onDamagedByAttack", activeOnly: true });
    expect(t(KOFFING_TR)?.optional).toBeUndefined(); // no "you may" is printed
    expect(t(WHIMSICOTT[0])).toMatchObject({ trigger: "onEvolve", optional: true });
    expect(t(DACHSBUN[0])).toMatchObject({ trigger: "onEvolve", optional: true });
    expect(t(INDEEDEE[0])).toMatchObject({ trigger: "onPlayToBench", optional: true });
    expect(t(INDEEDEE[0])?.program).toEqual([
      { op: "heal", target: "self", amount: 30 },
      { op: "recoverOneStatus" },
    ]);
    expect(t(KOFFING_TR)?.program[0]).toEqual({
      op: "searchDeck",
      filter: { kind: "pokemonNameContaining", fragment: "Koffing" },
      dest: "bench",
      max: 2,
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D560 §2 — Drilbur \"Dig Dig Dig\": up to 3 Basic {F} Energy to the discard pile", () => {
  function bench(fighting: number) {
    let state = table({ active: WALL, hand: [DRILBUR] });
    state = purgeFromDeck(ensureInDeck(state, "p1", "fix-fighting-energy", 4), "p1", "fix-fighting-energy");
    // …then put back exactly `fighting` of them.
    const side = state.players.p1;
    const back = side.discard.filter((u) => state.cardIdByUid[u] === "fix-fighting-energy").slice(0, fighting);
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...side, discard: side.discard.filter((u) => !back.includes(u)), deck: [...side.deck, ...back] },
      },
    };
    return mustApply(state, { type: "playBasicToBench", seat: "p1", uid: handUidOf(state, DRILBUR) });
  }

  it("0 {F} Energy in the deck: nothing is asked, and the deck still shuffles", () => {
    const { state, events } = bench(0);
    expect(events.some((e) => e.type === "ABILITY_TRIGGERED")).toBe(true);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(events.some((e) => e.type === "SHUFFLE")).toBe(true);
  });

  it("3 in the deck: a chooseCards of 3, up to 3, to the DISCARD; all 3 land there", () => {
    const { state } = bench(3);
    const p = prompt(state);
    expect(p).toMatchObject({ kind: "chooseCards", min: 0, max: 3, dest: "discard" });
    const picks = p.candidates as string[];
    expect(picks).toHaveLength(3);
    const done = mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: picks } });
    for (const uid of picks) expect(done.state.players.p1.discard).toContain(uid);
    expect(done.events.some((e) => e.type === "SHUFFLE")).toBe(true);
  });

  it("4 in the deck: 4 offered, still at most 3 taken; declining (0) is legal", () => {
    const { state } = bench(4);
    const p = prompt(state);
    expect((p.candidates as string[]).length).toBe(4);
    expect(p.max).toBe(3);
    const none = mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [] } });
    expect(none.state.players.p1.discard.filter((u) => none.state.cardIdByUid[u] === "fix-fighting-energy")).toHaveLength(
      0,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D560 §3 — Team Rocket's Koffing \"Smog Signals\": the bench search that parks on the OPPONENT's turn (R-KF)", () => {
  const koffingBoard = (oppBench: readonly string[] = []) =>
    attachFromDeck(
      ensureInDeck(table({ active: HITTER, oppActive: KOFFING_TR, oppBench }), "p1", "fix-energy"),
      "p1",
      "fix-energy",
      1,
    );
  const koffingsIn = (state: GameState, seat: Seat) =>
    state.players[seat].deck.filter((u) => /Koffing/.test(POOL[state.cardIdByUid[u] ?? ""]?.name ?? ""));

  it("damaged, not Knocked Out: parks a p2 search (p2 decides, on p1's turn) for up to 2 onto the Bench", () => {
    const { state, events } = mustApply(koffingBoard(), { type: "attack", seat: "p1", index: 0 });
    expect(events.find((e) => e.type === "ABILITY_TRIGGERED")).toMatchObject({ seat: "p2", ability: "Smog Signals" });
    expect(state.phase.kind).toBe("effect:choose");
    if (state.phase.kind !== "effect:choose") return;
    expect(state.phase.seat).toBe("p2");
    expect(state.phase.resumeTail).toBe(true);
    const p = prompt(state);
    expect(p).toMatchObject({ kind: "chooseCards", max: 2, dest: "bench" });
    // Both Koffing-named cards the deck holds, and nothing else.
    expect([...(p.candidates as string[])].sort()).toEqual([...koffingsIn(state, "p2")].sort());
    const picks = (p.candidates as string[]).slice(0, 2);
    const done = mustApply(state, { type: "resolveEffect", seat: "p2", choice: { kind: "cards", uids: picks } });
    expect(done.state.players.p2.bench.map((b) => b.stack[0])).toEqual(picks);
    // The tail resumed: p1's turn ended, so it is now p2's.
    expect(done.state.phase.kind).toBe("turn:action");
    expect(done.events.some((e) => e.type === "SHUFFLE" && e.seat === "p2")).toBe(true);
  });

  it("🛑 Knocked Out by the hit: the search still runs FIRST, then the KO, then p2 PROMOTES a new Koffing", () => {
    let { state } = mustApply(koffingBoard(), { type: "attack", seat: "p1", index: 1 });
    expect(state.phase.kind).toBe("effect:choose");
    const pick = (prompt(state).candidates as string[])[0] as string;
    state = mustApply(state, { type: "resolveEffect", seat: "p2", choice: { kind: "cards", uids: [pick] } }).state;
    expect(state.players.p2.active).toBeNull();
    for (let guard = 0; guard < 6 && state.phase.kind !== "turn:action"; guard++) {
      const phase = state.phase as { kind: string; seat?: Seat; count?: number };
      if (phase.kind === "ko:takePrizes") {
        state = mustApply(state, { type: "takePrizes", seat: "p1", prizeIndices: [0] }).state;
      } else if (phase.kind === "ko:promote") {
        state = mustApply(state, { type: "promote", seat: "p2", benchIndex: 0 }).state;
      } else {
        throw new Error(`unexpected phase ${phase.kind}`);
      }
    }
    expect(state.players.p2.active?.stack[0]).toBe(pick);
  });

  it("a FULL Bench: nothing is asked (the bench clamp), the deck still shuffles", () => {
    const { state, events } = mustApply(koffingBoard([WALL, WALL, WALL, WALL, WALL]), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(events.some((e) => e.type === "ABILITY_TRIGGERED" && e.seat === "p2")).toBe(true);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(events.some((e) => e.type === "SHUFFLE" && e.seat === "p2")).toBe(true);
    expect(state.players.p2.bench).toHaveLength(5);
  });

  // NOT a guard on `activeOnly` (which §1's shape pin holds): an `onDamagedByAttack` trigger
  // is only ever SEEDED for the damaged Active (R-KF), and Poke never damages a Bench body, so
  // this rung stays green with `activeOnly` removed — `activeOnly` is structurally redundant
  // on today's seed sites. It pins the seeding, not the clause.
  it("a BENCHED Team Rocket's Koffing does not fire (no damaged-trigger is seeded for an undamaged Bench body)", () => {
    let state = table({ active: HITTER, oppActive: WALL, oppBench: [KOFFING_TR] });
    state = attachFromDeck(ensureInDeck(state, "p1", "fix-energy"), "p1", "fix-energy", 1);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(events.some((e) => e.type === "ABILITY_TRIGGERED")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D560 §4 — Whimsicott \"Wafting Heal\": gates, then a real confirm (R-DB)", () => {
  function evolve(active: string, damage: number, id: string = WHIMSICOTT[0]) {
    let state = table({ active, bench: [COTTONEE], hand: [id], evolve: true });
    state = attachFromDeck(ensureInDeck(state, "p1", "fix-energy", 2), "p1", "fix-energy", 2);
    state = setDamage(state, "p1", damage);
    return mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUidOf(state, id),
      target: { spot: "bench", index: 0 },
    });
  }

  it("a damaged {G} Active: the confirm is offered, carrying the whole print", () => {
    for (const id of WHIMSICOTT) {
      const { state } = evolve(GRASS, 70, id);
      expect(prompt(state)).toStrictEqual({ kind: "confirm", note: WAFTING_HEAL_TEXT });
    }
  });

  it("decline: the Active keeps its damage and its Energy", () => {
    const done = confirm(evolve(GRASS, 70).state, false).state;
    expect(body(done, "p1").damage).toBe(70);
    expect(body(done, "p1").energy).toHaveLength(2);
  });

  it("accept: ALL damage healed, then ALL Energy discarded", () => {
    const { state, events } = confirm(evolve(GRASS, 70).state, true);
    expect(body(state, "p1").damage).toBe(0);
    expect(body(state, "p1").energy).toHaveLength(0);
    expect(events.find((e) => e.type === "HEALED")).toMatchObject({ seat: "p1", amount: 70 });
    const types = events.map((e) => e.type);
    expect(types.indexOf("HEALED")).toBeLessThan(types.indexOf("ENERGY_DISCARDED"));
  });

  it("a non-{G} Active, or an UNDAMAGED {G} Active: no prompt, nothing moves", () => {
    for (const [active, damage] of [
      [WATER, 70],
      [GRASS, 0],
    ] as const) {
      const { state } = evolve(active, damage);
      expect(state.phase.kind, `${active}/${damage}`).toBe("turn:action");
      expect(body(state, "p1").energy).toHaveLength(2);
      expect(body(state, "p1").damage).toBe(damage);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D560 §5 — Dachsbun ex \"Time to Chow Down\": every Evolution Pokémon, per healed body (R-DB)", () => {
  /** p1: Active `active` (undamaged unless stated), Bench [Fidough, SPROUT (Evolution),
      WALL (Basic)]; the Sprout and the Wall carry 50 damage and 1 Energy each. */
  function evolve(opts: { activeDamage?: number; fidoughDamage?: number; benchDamage?: number } = {}) {
    let state = table({ active: GRASS, bench: [FIDOUGH, SPROUT, WALL], hand: [DACHSBUN[0]], evolve: true });
    state = attachFromDeck(ensureInDeck(state, "p1", "fix-energy"), "p1", "fix-energy", 1);
    for (const index of [0, 1, 2]) {
      const side = state.players.p1;
      const uid = side.deck.find((u) => state.cardIdByUid[u] === "fix-energy") as string;
      const bench = side.bench.map((b, i) => (i === index ? { ...b, energy: [...b.energy, uid] } : b));
      state = {
        ...state,
        players: { ...state.players, p1: { ...side, deck: side.deck.filter((u) => u !== uid), bench } },
      };
    }
    state = setDamage(state, "p1", opts.activeDamage ?? 0);
    state = benchDamage(state, "p1", 0, opts.fidoughDamage ?? 0);
    state = benchDamage(state, "p1", 1, opts.benchDamage ?? 50);
    state = benchDamage(state, "p1", 2, opts.benchDamage ?? 50);
    return mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUidOf(state, DACHSBUN[0]),
      target: { spot: "bench", index: 0 },
    });
  }

  it("the confirm is UNGATED and carries the whole print", () => {
    expect(prompt(evolve().state)).toStrictEqual({ kind: "confirm", note: CHOW_DOWN_TEXT });
    expect(prompt(evolve({ benchDamage: 0 }).state).kind).toBe("confirm");
  });

  it("decline: nothing heals and nothing is discarded", () => {
    const done = confirm(evolve().state, false).state;
    expect(body(done, "p1", 1).damage).toBe(50);
    expect(body(done, "p1", 1).energy).toHaveLength(1);
  });

  it("accept: the damaged BENCHED Evolution heals fully and loses its Energy; the Basic and the undamaged Active keep theirs", () => {
    const { state, events } = confirm(evolve().state, true);
    expect(idOf(state, body(state, "p1", 1))).toBe(SPROUT);
    expect(body(state, "p1", 1).damage).toBe(0);
    expect(body(state, "p1", 1).energy).toHaveLength(0);
    // The Basic is NOT an Evolution Pokémon: still damaged, Energy kept.
    expect(body(state, "p1", 2).damage).toBe(50);
    expect(body(state, "p1", 2).energy).toHaveLength(1);
    // The undamaged Active healed nothing, so it is not one of "those Pokémon" (R-DB).
    expect(body(state, "p1").energy).toHaveLength(1);
    expect(events.filter((e) => e.type === "HEALED")).toHaveLength(1);
    expect(events.filter((e) => e.type === "ENERGY_DISCARDED")).toHaveLength(1);
  });

  it("🛑 R-DB: accepting on a board where NO Evolution Pokémon is damaged heals and discards NOTHING", () => {
    const { state, events } = confirm(evolve({ benchDamage: 0 }).state, true);
    expect(events.some((e) => e.type === "HEALED" || e.type === "ENERGY_DISCARDED")).toBe(false);
    expect(body(state, "p1", 0).energy).toHaveLength(1); // Dachsbun ex (Fidough's Energy)
    expect(body(state, "p1", 1).energy).toHaveLength(1);
  });

  it("a damaged Evolution ACTIVE heals and loses its Energy too — \"each of your\", not \"Benched\"", () => {
    let state = table({ active: SPROUT, bench: [FIDOUGH], hand: [DACHSBUN[1]], evolve: true });
    state = setDamage(attachFromDeck(ensureInDeck(state, "p1", "fix-energy", 2), "p1", "fix-energy", 2), "p1", 80);
    const parked = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUidOf(state, DACHSBUN[1]),
      target: { spot: "bench", index: 0 },
    }).state;
    const { state: done, events } = confirm(parked, true);
    expect(body(done, "p1").damage).toBe(0);
    expect(body(done, "p1").energy).toHaveLength(0);
    expect(events.find((e) => e.type === "ENERGY_DISCARDED")).toMatchObject({ from: { spot: "active" } });
  });

  it("🛑 Dachsbun ex ITSELF is an Evolution Pokémon and keeps Fidough's damage: it heals and discards too", () => {
    const { state } = confirm(evolve({ fidoughDamage: 30, benchDamage: 0 }).state, true);
    expect(idOf(state, body(state, "p1", 0))).toBe(DACHSBUN[0]);
    expect(body(state, "p1", 0).damage).toBe(0);
    expect(body(state, "p1", 0).energy).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D560 §6 — Indeedee \"Obliging Heal\": heal 30, then recover from ONE Special Condition", () => {
  function play(conditions: Parameters<typeof setConditions>[2], damage = 50, id: string = INDEEDEE[0]) {
    let state = table({ active: WALL, hand: [id] });
    state = setDamage(setConditions(state, "p1", conditions), "p1", damage);
    return mustApply(state, { type: "playBasicToBench", seat: "p1", uid: handUidOf(state, id) });
  }

  it("0 conditions: heals 30 and asks nothing", () => {
    for (const id of INDEEDEE) {
      const { state } = play({}, 50, id);
      expect(state.phase.kind).toBe("turn:action");
      expect(body(state, "p1").damage).toBe(20);
    }
  });

  it("1 condition: it clears DIRECTLY — no prompt (the M1 rule)", () => {
    const { state, events } = play({ poisonDamage: 10 });
    expect(state.phase.kind).toBe("turn:action");
    expect(body(state, "p1").conditions.poisonDamage).toBe(0);
    expect(events.find((e) => e.type === "STATUS_CLEARED")).toMatchObject({ statuses: ["poisoned"] });
  });

  it("2 conditions: one labelled confirm between them; each answer clears exactly one", () => {
    const parked = play({ poisonDamage: 10, burned: true }).state;
    expect(prompt(parked).labels).toEqual({ yes: "Poisoned", no: "Burned" });
    expect(body(parked, "p1").damage).toBe(20); // the heal already landed
    const yes = body(confirm(parked, true).state, "p1").conditions;
    expect([yes.poisonDamage, yes.burned]).toEqual([0, true]);
    const no = body(confirm(parked, false).state, "p1").conditions;
    expect([no.poisonDamage, no.burned]).toEqual([10, false]);
  });

  it("3 conditions: a CHAIN of two binary confirms; every one of the three is reachable", () => {
    const parked = play({ rotation: "asleep", poisonDamage: 10, burned: true }).state;
    expect(prompt(parked).labels).toEqual({ yes: "Asleep", no: "Poisoned or Burned" });
    const asleep = body(confirm(parked, true).state, "p1").conditions;
    expect([asleep.rotation, asleep.poisonDamage, asleep.burned]).toEqual(["none", 10, true]);
    const second = confirm(parked, false).state;
    expect(prompt(second).labels).toEqual({ yes: "Poisoned", no: "Burned" });
    const poisoned = body(confirm(second, true).state, "p1").conditions;
    expect([poisoned.rotation, poisoned.poisonDamage, poisoned.burned]).toEqual(["asleep", 0, true]);
    const burned = body(confirm(second, false).state, "p1").conditions;
    expect([burned.rotation, burned.poisonDamage, burned.burned]).toEqual(["asleep", 10, false]);
  });

  it("🛑 a revived link with its labels STRIPPED still resolves yes = the first, no = the rest", () => {
    const parked = play({ rotation: "confused", poisonDamage: 10, burned: true }).state;
    const bare = revived(parked, true);
    expect(JSON.stringify(bare.phase)).not.toContain('"labels"');
    const first = body(confirm(bare, true).state, "p1").conditions;
    expect([first.rotation, first.poisonDamage, first.burned]).toEqual(["none", 10, true]);
    const second = revived(confirm(bare, false).state, true);
    const last = body(confirm(second, false).state, "p1").conditions;
    expect([last.rotation, last.poisonDamage, last.burned]).toEqual(["confused", 10, false]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D560 §7 — `MATCH_RECORD_VERSION` HOLDS AT 35: the widened ops ride parked records, DRIVEN", () => {
  it("a parked Whimsicott record carries `amount: \"all\"` and, revived from JSON, heals all", () => {
    let state = table({ active: GRASS, bench: [COTTONEE], hand: [WHIMSICOTT[1]], evolve: true });
    state = setDamage(state, "p1", 90);
    const parked = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUidOf(state, WHIMSICOTT[1]),
      target: { spot: "bench", index: 0 },
    }).state;
    expect(JSON.stringify(parked.phase)).toContain('"amount":"all"');
    const done = confirm(revived(parked), true).state;
    expect(body(done, "p1").damage).toBe(0);
  });

  it("a parked Dachsbun ex record carries the three `healEach` widenings and resolves them", () => {
    let state = table({ active: GRASS, bench: [FIDOUGH, SPROUT], hand: [DACHSBUN[2]], evolve: true });
    state = benchDamage(state, "p1", 1, 120);
    const parked = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUidOf(state, DACHSBUN[2]),
      target: { spot: "bench", index: 0 },
    }).state;
    const wire = JSON.stringify(parked.phase);
    for (const key of ['"amount":"all"', '"evolutionOnly":true', '"discardEnergyFromHealed":true']) {
      expect(wire).toContain(key);
    }
    expect(body(confirm(revived(parked), true).state, "p1", 1).damage).toBe(0);
  });

  it("a parked Indeedee link carries `clearStatus { only }` and resolves it after revival", () => {
    let state = table({ active: WALL, hand: [INDEEDEE[1]] });
    state = setConditions(state, "p1", { poisonDamage: 10, burned: true });
    const parked = mustApply(state, {
      type: "playBasicToBench",
      seat: "p1",
      uid: handUidOf(state, INDEEDEE[1]),
    }).state;
    expect(JSON.stringify(parked.phase)).toContain('"only":"poisoned"');
    const after = body(confirm(revived(parked), true).state, "p1").conditions;
    expect([after.poisonDamage, after.burned]).toEqual([0, true]);
  });

  it("the engine is 0.484.0", () => {
    expect(engineVersion).toBe("0.484.0");
  });
});
