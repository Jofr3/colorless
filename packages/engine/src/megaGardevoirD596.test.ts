import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
} from "./effects";
import type { GameAction, GameEvent, GameState } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import type { PokemonRef } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D596 — WP09: MEGA GARDEVOIR ex AND XERNEAS ──
//
// 3 printed attack texts / 14 `me` printings. Every id and text measured on the LOCAL D1,
// 2026-10-08, `legal_standard = 1`; no id was referenced in the tree before this slice. No `me`
// row is a fixture, so the printed faces used on a board are carried HERE.
//   • Mega Symphonia ×6 (Mega Gardevoir ex `me01-060`/`-159`/`-178`/`-187`, `mep-032`,
//     `me02.5-089`) and Geo Storm ×2 (Xerneas `me04-042`/`-091`): `SELF_BOARD_ENERGY_MULTIPLY`,
//     `energyOnSelf` at `zone: "board"` on the `×` fold — D407's board count, which was
//     additive-only until now.
//   • Overflowing Wishes ×6 (the same six Mega Gardevoir ex): `EACH_BENCHED_DECK_ATTACH`,
//     `attachFromDeck { basicEnergy {P}, max: 1, benchOnly, each }` + `shuffleDeck`. `each` is the
//     one new op field: `max` is per Benched body. R-OW1 (UNRULED): one answer, up to one card per
//     Benched body, and a short answer stands (a deck search may come up short).

const T = {
  wishes:
    "For each of your Benched Pokémon, search your deck for a Basic {P} Energy card and attach it to that Pokémon. Then, shuffle your deck.",
  symphonia: "This attack does 50 damage for each {P} Energy attached to all of your Pokémon.",
  geoStorm: "This attack does 30 damage for each {P} Energy attached to all of your Pokémon.",
} as const;

const GARDEVOIR_IDS = ["me01-060", "me01-159", "me01-178", "me01-187", "mep-032", "me02.5-089"];
const XERNEAS_IDS = ["me04-042", "me04-091"];

/** [text, legal `me` printings, the ids]. */
const ROWS: readonly (readonly [string, number, readonly string[]])[] = [
  [T.wishes, 6, GARDEVOIR_IDS],
  [T.symphonia, 6, GARDEVOIR_IDS],
  [T.geoStorm, 2, XERNEAS_IDS],
];

describe("D596 §1 — the three sentences and their readings", () => {
  it("each is the `me` corpus's row at its printing count, none printed in `sv`, none registry-keyed", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n, ids] of ROWS) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
      expect(ids).toHaveLength(n);
      for (const id of ids) expect(programFor(id), id).toBeUndefined();
    }
    expect(ROWS.reduce((sum, [, n]) => sum + n, 0)).toBe(14);
  });

  it("Mega Symphonia and Geo Storm: `energyOnSelf` at the BOARD zone, typed {P}, on the `×` fold only", () => {
    expect(deriveAttackDamageMultiplier(T.symphonia)).toEqual({
      per: 50,
      count: { kind: "energyOnSelf", zone: "board", energyType: "Psychic" },
    });
    expect(deriveAttackDamageMultiplier(T.geoStorm)).toEqual({
      per: 30,
      count: { kind: "energyOnSelf", zone: "board", energyType: "Psychic" },
    });
    for (const text of [T.symphonia, T.geoStorm]) {
      expect(deriveAttackDamageBonus(text), text).toBeNull();
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("Overflowing Wishes: one Basic {P} Energy per Benched body, then the shuffle", () => {
    expect(deriveAttackEffect(T.wishes)).toEqual([
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Psychic" },
        max: 1,
        benchOnly: true,
        each: true,
      },
      { op: "shuffleDeck" },
    ]);
  });
});

describe("D596 §2 — near misses stay null", () => {
  it("the multiply anchor: a {C} filter, a zero, the Iono subgroup, a Tool, the opponent's board", () => {
    expect(deriveAttackDamageMultiplier(T.symphonia.replace("{P}", "{C}"))).toBeNull();
    expect(deriveAttackDamageMultiplier(T.symphonia.replace("50", "0"))).toBeNull();
    expect(deriveAttackDamageMultiplier(T.symphonia.replace("your Pokémon", "your Iono's Pokémon"))).toBeNull();
    expect(deriveAttackDamageMultiplier(T.symphonia.replace("{P} Energy", "Energy card"))).toBeNull();
    // Sylveon ex "Colorful Harmony" (`me` ×3): a TYPE count, not an Energy count — still unbuilt.
    // [🆕🆕🆕 D607 (D539): "still unbuilt" is WITHDRAWN, kept as written — WP28a builds it on its own
    // member, `basicEnergyTypesOnYourBoard`; it is still not THIS anchor's Energy count.]
    expect(
      resolvedByAnyReader(
        "This attack does 50 damage for each type of Basic Energy attached to all of your Pokémon.",
      ),
    ).toBe(true);
    expect(
      deriveAttackDamageMultiplier("This attack does 50 damage for each type of Basic Energy attached to all of your Pokémon.")
        ?.count.kind,
    ).toBe("basicEnergyTypesOnYourBoard");
    // The opponent's board stays `energyOnOpponent`'s.
    expect(deriveAttackDamageMultiplier(T.symphonia.replace("your Pokémon", "your opponent's Pokémon"))?.count).toEqual({
      kind: "energyOnOpponent",
      zone: "board",
      energyType: "Psychic",
    });
  });

  it("the attach anchor: every Pokémon (not Benched), this Pokémon, no shuffle, a suffix, 'up to 2'", () => {
    const controls = [
      T.wishes.replace("your Benched Pokémon", "your Pokémon"),
      T.wishes.replace("that Pokémon", "this Pokémon"),
      T.wishes.replace(" Then, shuffle your deck.", ""),
      `${T.wishes} Draw a card.`,
      T.wishes.replace("a Basic {P} Energy card and attach it", "up to 2 Basic {P} Energy cards and attach them"),
    ];
    for (const text of controls) expect(deriveAttackEffect(text), text).toBeNull();
    // The untyped spelling is unprinted and reads as the untyped search (D131).
    expect(deriveAttackEffect(T.wishes.replace("Basic {P} Energy", "Basic Energy"))?.[0]).toEqual({
      op: "attachFromDeck",
      filter: { kind: "basicEnergy" },
      max: 1,
      benchOnly: true,
      each: true,
    });
  });
});

// ── ON A BOARD ──

const GARDEVOIR = "me01-060";
const XERNEAS = "me04-042";
const FILLER = "d596-filler"; // a {C} Basic, 300 HP
const PSYCHIC = "d596-psychic";
const FIRE = "d596-fire";

const LOCAL: Record<string, Card> = {
  [GARDEVOIR]: battler(GARDEVOIR, {
    name: "Mega Gardevoir ex",
    hp: 360,
    stage: "Stage2",
    evolveFrom: "Kirlia",
    types: ["Psychic"],
    retreat: 2,
    attacks: [
      { cost: ["Psychic"], name: "Overflowing Wishes", effect: T.wishes },
      { cost: ["Psychic"], name: "Mega Symphonia", damage: "50×", effect: T.symphonia },
    ],
  } as Partial<Card>),
  [XERNEAS]: battler(XERNEAS, {
    name: "Xerneas",
    hp: 130,
    types: ["Psychic"],
    retreat: 2,
    attacks: [{ cost: ["Psychic", "Psychic", "Psychic"], name: "Geo Storm", damage: "30×", effect: T.geoStorm }],
  } as Partial<Card>),
  [FILLER]: battler(FILLER, { name: "D596 Filler", hp: 300, types: ["Colorless"], retreat: 1 }),
  [PSYCHIC]: typedEnergy(PSYCHIC, "Psychic"),
  [FIRE]: typedEnergy(FIRE, "Fire"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [GARDEVOIR]: 1,
  [XERNEAS]: 1,
  [FILLER]: 20,
  [PSYCHIC]: 16,
  [FIRE]: 6,
  "fix-special": 4,
  "fix-energy": 12,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup (P2 first), then P1's turn 4 with both hands and Prizes back in the decks (D595's idiom). */
function p1Turn(): GameState {
  const created = createGame({ seed: 5961, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
    const uid = state.players[s].hand.find((h) => state.cardIdByUid[h] === FILLER);
    if (uid === undefined) throw new Error(`no Filler in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    state = {
      ...state,
      players: { ...state.players, [s]: { ...side, hand: [], prizes: [], deck: [...side.deck, ...side.hand, ...side.prizes] } },
    };
  }
  return state;
}

/** Attach `count` copies of `cardId` from P1's deck onto P1's Active. */
function onActive(state: GameState, cardId: string, count: number): GameState {
  const side = state.players.p1;
  const uids = side.deck.filter((u) => state.cardIdByUid[u] === cardId).slice(0, count);
  if (uids.length < count || side.active === null) throw new Error(`cannot attach ${count} ${cardId}`);
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        deck: side.deck.filter((u) => !uids.includes(u)),
        active: { ...side.active, energy: [...side.active.energy, ...uids] },
      },
    },
  };
}

/** P1's `active` with `paid` Psychic Energy on it and `bench` FILLERs; P2 a FILLER Active and no Bench. */
function table(active: string, paid: number, bench: number): GameState {
  let state = p1Turn();
  state = clearBench(setActiveFromDeck(state, "p1", active), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
  for (let i = 0; i < bench; i++) state = benchFromDeck(state, "p1", FILLER);
  return onActive(state, PSYCHIC, paid);
}

/** Remove every copy of `cardId` from P1's deck but `keep` (moved to the discard pile). */
function thinDeck(state: GameState, cardId: string, keep: number): GameState {
  const side = state.players.p1;
  const copies = side.deck.filter((u) => state.cardIdByUid[u] === cardId);
  const gone = new Set(copies.slice(keep));
  return {
    ...state,
    players: {
      ...state.players,
      p1: { ...side, deck: side.deck.filter((u) => !gone.has(u)), discard: [...side.discard, ...gone] },
    },
  };
}

const swing = (state: GameState, index: number) => mustApply(state, { type: "attack", seat: "p1", index });
const of = <K extends GameEvent["type"]>(events: readonly GameEvent[], type: K) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: K }>[];
const idsOf = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
const benchRef = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

function promptOf(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "attachCards") throw new Error(`expected attachCards, got ${prompt.kind}`);
  return prompt;
}
const answer = (state: GameState, assignments: { uid: string; to: PokemonRef }[]) =>
  applyAction(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "attachCards", assignments },
  } as GameAction);

describe("D596 §3 — Mega Symphonia and Geo Storm count {P} Energy on the whole own board", () => {
  it("Mega Symphonia: 50 per {P} on the Active AND the Bench; Fire, Colorless and the opponent's {P} do not count", () => {
    let state = table(GARDEVOIR, 1, 2);
    state = attachBenchFromDeck(state, "p1", 0, PSYCHIC, 2);
    state = attachBenchFromDeck(state, "p1", 1, PSYCHIC, 1);
    state = attachBenchFromDeck(state, "p1", 1, FIRE, 2);
    state = attachBenchFromDeck(state, "p1", 0, "fix-energy", 1);
    // The opponent's Active wears 3 {P}: the printed "your" excludes them.
    const p2 = state.players.p2;
    const theirs = p2.deck.filter((u) => state.cardIdByUid[u] === PSYCHIC).slice(0, 3);
    state = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...p2,
          deck: p2.deck.filter((u) => !theirs.includes(u)),
          active: p2.active === null ? null : { ...p2.active, energy: theirs },
        },
      },
    };
    const { events } = swing(state, 1);
    // 1 on the Active (it paid the cost) + 2 + 1 on the Bench = 4 → 200.
    expect(of(events, "DAMAGE_DEALT")[0]?.dealt).toBe(200);
  });

  it("Mega Symphonia: the attacking body alone would be 50 — a Bench-only board still scores", () => {
    let state = table(GARDEVOIR, 1, 1);
    state = attachBenchFromDeck(state, "p1", 0, PSYCHIC, 3);
    expect(of(swing(state, 1).events, "DAMAGE_DEALT")[0]?.dealt).toBe(200);
    expect(of(swing(table(GARDEVOIR, 1, 1), 1).events, "DAMAGE_DEALT")[0]?.dealt).toBe(50);
  });

  it("Geo Storm: 30 per {P} on the whole board", () => {
    let state = table(XERNEAS, 3, 1);
    state = attachBenchFromDeck(state, "p1", 0, PSYCHIC, 2);
    expect(of(swing(state, 0).events, "DAMAGE_DEALT")[0]?.dealt).toBe(150);
  });
});

describe("D596 §4 — Overflowing Wishes on a board", () => {
  it("parks one decision: up to one Basic {P} Energy onto EACH Benched Pokémon, never the Active", () => {
    const state = table(GARDEVOIR, 1, 3);
    const parked = swing(state, 0);
    const prompt = promptOf(parked.state);
    expect(prompt.targets).toEqual([benchRef(0), benchRef(1), benchRef(2)]);
    expect(prompt.max).toBe(3);
    expect(prompt.maxPerTarget).toBe(1);
    expect(prompt.oneTarget).toBeUndefined();
    expect(prompt.note).toBe(
      "For each of your Benched Pokémon, search your deck for a Basic Psychic Energy card and attach it to that Pokémon.",
    );
    // Only Basic {P} Energy is offered (Fire, Colorless and the Special are not), collapsed to 3 rows.
    expect(new Set(idsOf(parked.state, prompt.candidates))).toEqual(new Set([PSYCHIC]));
    expect(prompt.candidates).toHaveLength(3);

    const [a, b, c] = prompt.candidates as [string, string, string];
    const done = answer(parked.state, [
      { uid: a, to: benchRef(0) },
      { uid: b, to: benchRef(1) },
      { uid: c, to: benchRef(2) },
    ]);
    if (!done.ok) throw new Error(done.error.message);
    const bench = done.state.players.p1.bench.map((p) => idsOf(done.state, p.energy));
    expect(bench).toEqual([[PSYCHIC], [PSYCHIC], [PSYCHIC]]);
    expect(of(done.events, "SHUFFLE").length).toBeGreaterThan(0);
    expect(done.state.turn).toBe(state.turn + 1);
  });

  it("two on one body is refused; a short answer and a decline stand (R-OW1)", () => {
    const parked = swing(table(GARDEVOIR, 1, 2), 0);
    const [a, b] = promptOf(parked.state).candidates as [string, string];
    expect(
      answer(parked.state, [
        { uid: a, to: benchRef(0) },
        { uid: b, to: benchRef(0) },
      ]).ok,
    ).toBe(false);
    const short = answer(parked.state, [{ uid: a, to: benchRef(1) }]);
    if (!short.ok) throw new Error(short.error.message);
    expect(short.state.players.p1.bench.map((p) => p.energy.length)).toEqual([0, 1]);
    const declined = answer(parked.state, []);
    if (!declined.ok) throw new Error(declined.error.message);
    expect(declined.state.players.p1.bench.every((p) => p.energy.length === 0)).toBe(true);
  });

  it("the ceiling is the smaller of the Bench and the {P} left in the deck", () => {
    const state = thinDeck(table(GARDEVOIR, 1, 3), PSYCHIC, 2);
    const prompt = promptOf(swing(state, 0).state);
    expect([prompt.max, prompt.maxPerTarget, prompt.targets.length]).toEqual([2, 1, 3]);
  });

  it("an empty Bench asks nothing and still shuffles", () => {
    const state = table(GARDEVOIR, 1, 0);
    const { state: after, events } = swing(state, 0);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(of(events, "SHUFFLE").length).toBeGreaterThan(0);
    expect(after.turn).toBe(state.turn + 1);
  });
});

describe("D596 §5 — the version", () => {
  it("is built at engine 0.519.0", () => {
    expect(engineVersion).toBe("0.519.0");
  });
});
