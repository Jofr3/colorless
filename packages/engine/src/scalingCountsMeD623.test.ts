import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { deriveAttackDamageBonus, deriveAttackDamageMultiplier, deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  discardFromDeck,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D623 — WP28b: THE REST OF THE SCALING COUNT SOURCES ─────────────────────────────────────
//
// 5 printed attack texts / 7 `me` printings, all attacks, no registry key. Three NEW `DamageCountSource`
// members — `damagedBenchedPokemon` (Gourgeist ex ×2), `benchedPokemonWithEnergy` (Armarouge ×2) and
// `benchedPokemonWithMaxHp` (Igglybuff, R-BOC1) — the body-map key "Pikachu and Pikachu ex" (Pikachu
// `30th-034`) and Kyogre "Riptide", one anchor read by the multiplier (the count) and by
// `deriveAttackEffect` (the shipped retrieval + shuffle tail). Every id and text off the LOCAL D1,
// 2026-10-09, `legal_standard = 1`; no id was referenced in the tree outside docs before this slice.
// Dropped and named: Doublade ×3 and Okidogi (§1) [🆕🆕🆕 D630 (D539): Okidogi BUILT at D630 (M1)].

const RONDO = "This attack does 50 more damage for each of your Benched Pokémon that has any damage counters on it.";
const FLAME_LEGION = "This attack does 40 more damage for each of your Benched Pokémon that has any {R} Energy attached.";
const BOUNCY_CIRCLE = "This attack does 30 damage for each of your Benched Pokémon that has a maximum HP of 30.";
const PIKA_CHAIN = "This attack does 40 damage for each of your Pikachu and Pikachu ex in play.";
const RIPTIDE =
  "This attack does 20 damage for each Basic {W} Energy card in your discard pile. Then, shuffle those cards into your deck.";

/** [attack text, the `me` printing ids that print it]. */
const SENTENCES: readonly (readonly [string, readonly string[]])[] = [
  [RONDO, ["me04-041", "me04-102"]],
  [FLAME_LEGION, ["me05-012", "me05-086"]],
  [BOUNCY_CIRCLE, ["30th-120"]],
  [PIKA_CHAIN, ["30th-034"]],
  [RIPTIDE, ["me01-034"]],
];

/** Dropped from WP28b and named: each needs vocabulary beyond a count source. */
const DROPPED: readonly (readonly [string, number])[] = [
  // An own-hand pick that moves nothing plus a partial public reveal (a new op and event).
  [
    "Reveal any number of Honedge, Doublade, and Aegislash from your hand, and this attack does 60 damage for each card you revealed in this way.",
    3,
  ],
  // The Prizes taken during the opponent's last turn: no state records them (an MRV bump). [🆕🆕🆕 D630 (D539):
  // WITHDRAWN — `PlayerSide.prizesTakenOnTurn` records them since D630 (MRV 43 → 44).]
  ["This attack does 60 more damage for each Prize card your opponent took during their last turn.", 1],
];

describe("D623 §1 — the texts: 5 attack sentences / 7 printings", () => {
  it("each is a row of the committed `me` corpus at its printing count, none printed in legal `sv`, each now read", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, ids] of SENTENCES) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
    }
    expect(SENTENCES.flatMap(([, ids]) => ids)).toHaveLength(7);
  });

  it("Doublade ×3 and Okidogi stay unbuilt: 2 texts / 4 printings, named (🆕🆕🆕 D630 (D539): WITHDRAWN for Okidogi — built at D630, `persistedRecordsMeD630.test.ts`)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    for (const [text, n] of DROPPED) {
      expect([text, me.get(text)]).toEqual([text, n]);
      // 🆕🆕🆕 D630 — Settle the Score reads now (the persisted `PlayerSide.prizesTakenOnTurn`, MRV 43 → 44).
      expect(resolvedByAnyReader(text), text).toBe(text.startsWith("This attack does 60 more damage"));
    }
    expect(DROPPED.reduce((sum, [, n]) => sum + n, 0)).toBe(4);
  });
});

describe("D623 §2 — the readings", () => {
  it("three new members, each on its own literal anchor", () => {
    expect(deriveAttackDamageBonus(RONDO)).toEqual({ per: 50, count: { kind: "damagedBenchedPokemon" } });
    expect(deriveAttackDamageBonus(FLAME_LEGION)).toEqual({
      per: 40,
      count: { kind: "benchedPokemonWithEnergy", energyType: "Fire" },
    });
    expect(deriveAttackDamageMultiplier(BOUNCY_CIRCLE)).toEqual({
      per: 30,
      count: { kind: "benchedPokemonWithMaxHp", hp: 30 },
    });
    // Each on its own fold only.
    expect(deriveAttackDamageMultiplier(RONDO)).toBeNull();
    expect(deriveAttackDamageMultiplier(FLAME_LEGION)).toBeNull();
    expect(deriveAttackDamageBonus(BOUNCY_CIRCLE)).toBeNull();
    // The printed-zero guards (both numbers on Bouncy Circle).
    for (const zero of [
      "This attack does 0 more damage for each of your Benched Pokémon that has any damage counters on it.",
      "This attack does 0 more damage for each of your Benched Pokémon that has any {R} Energy attached.",
    ]) {
      expect(deriveAttackDamageBonus(zero), zero).toBeNull();
    }
    for (const zero of [
      "This attack does 0 damage for each of your Benched Pokémon that has a maximum HP of 30.",
      "This attack does 30 damage for each of your Benched Pokémon that has a maximum HP of 0.",
    ]) {
      expect(deriveAttackDamageMultiplier(zero), zero).toBeNull();
    }
    // A different energy symbol is not read (the {R} is literal).
    expect(
      deriveAttackDamageBonus("This attack does 40 more damage for each of your Benched Pokémon that has any {W} Energy attached."),
    ).toBeNull();
  });

  it("Pika Chain is the shipped `pokemonInPlay` fold on the new key", () => {
    expect(deriveAttackDamageMultiplier(PIKA_CHAIN)).toEqual({
      per: 40,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: {
          kind: "anyOf",
          filters: [
            { kind: "byName", name: "Pikachu" },
            { kind: "byName", name: "Pikachu ex" },
          ],
        },
      },
    });
  });

  it("Riptide is read by TWO readers over one filter: the count and the retrieval tail", () => {
    const water = { kind: "basicEnergy", energyType: "Water" };
    expect(deriveAttackDamageMultiplier(RIPTIDE)).toEqual({
      per: 20,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: water },
    });
    expect(deriveAttackEffect(RIPTIDE)).toEqual([
      { op: "discardPileRetrieval", filter: water, dest: "deck", max: "all" },
      { op: "shuffleDeck" },
    ]);
    // The printed-zero guard refuses BOTH halves.
    const zero = RIPTIDE.replace("20 damage", "0 damage");
    expect(deriveAttackDamageMultiplier(zero)).toBeNull();
    expect(deriveAttackEffect(zero)).toBeNull();
    // The head alone stays the shipped discard-pile arm's (a different, filter-mapped reading).
    expect(deriveAttackEffect("This attack does 20 damage for each Basic {W} Energy card in your discard pile.")).toBeNull();
  });
});

// ── ON A BOARD ──

const FILLER = "d623-filler";
const TINY = "d623-tiny"; // a 30-HP Basic
const SMALL = "d623-small"; // a 60-HP Basic
const PIKACHU = "d623-pikachu";
const PIKACHU_EX = "d623-pikachu-ex";
const RAICHU = "d623-raichu";
const FIRE = "d623-fire";
const WATER = "d623-water";
const PSY = "d623-psychic";
const LIGHTNING = "d623-lightning";
const BRAVERY_CHARM = "sv02-173"; // FIXTURE_POOL — +50 HP on a Basic holder

const mon = (id: string, name: string, hp: number, type: string, attacks: Card["attacks"], extra: Partial<Card> = {}) =>
  battler(id, { name, hp, types: [type], retreat: 2, attacks, ...extra });
const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];

const LOCAL: Record<string, Card> = {
  "me04-041": mon(
    "me04-041",
    "Gourgeist ex",
    270,
    "Psychic",
    [
      { cost: ["Psychic"], name: "Horrifying Rondo", damage: "30+", effect: RONDO },
      { cost: ["Psychic", "Psychic"], name: "Ghostly Touch", damage: 140, effect: "Discard a random card from your opponent's hand." },
    ],
    { stage: "Stage1", evolveFrom: "Pumpkaboo" },
  ),
  "me05-012": mon(
    "me05-012",
    "Armarouge",
    140,
    "Fire",
    [{ cost: ["Fire"], name: "Flame Legion", damage: "40+", effect: FLAME_LEGION }],
    { stage: "Stage1", evolveFrom: "Charcadet" },
  ),
  // The printed attack carries no cost (LOCAL D1: no `cost` key).
  "30th-120": mon("30th-120", "Igglybuff", 30, "Colorless", [{ name: "Bouncy Circle", damage: "30×", effect: BOUNCY_CIRCLE }]),
  "30th-034": mon("30th-034", "Pikachu", 70, "Lightning", [
    { cost: ["Lightning", "Lightning", "Lightning"], name: "Pika Chain", damage: "40×", effect: PIKA_CHAIN },
  ]),
  "me01-034": mon("me01-034", "Kyogre", 150, "Water", [
    { cost: ["Water"], name: "Riptide", damage: "20×", effect: RIPTIDE },
    { cost: ["Water", "Water", "Colorless"], name: "Swirling Waves", damage: 130, effect: "Discard 2 Energy from this Pokémon." },
  ]),
  [FILLER]: mon(FILLER, "D623 Filler", 400, "Colorless", TAP),
  [TINY]: mon(TINY, "D623 Tiny", 30, "Colorless", TAP),
  [SMALL]: mon(SMALL, "D623 Small", 60, "Colorless", TAP),
  [PIKACHU]: mon(PIKACHU, "Pikachu", 60, "Lightning", TAP),
  [PIKACHU_EX]: mon(PIKACHU_EX, "Pikachu ex", 200, "Lightning", TAP),
  [RAICHU]: mon(RAICHU, "Raichu", 120, "Lightning", TAP, { stage: "Stage1", evolveFrom: "Pikachu" }),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [WATER]: typedEnergy(WATER, "Water"),
  [PSY]: typedEnergy(PSY, "Psychic"),
  [LIGHTNING]: typedEnergy(LIGHTNING, "Lightning"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  "me04-041": 1,
  "me05-012": 1,
  "30th-120": 1,
  "30th-034": 1,
  "me01-034": 1,
  [FILLER]: 6,
  [TINY]: 3,
  [SMALL]: 2,
  [PIKACHU]: 2,
  [PIKACHU_EX]: 1,
  [RAICHU]: 1,
  [FIRE]: 4,
  [WATER]: 6,
  [PSY]: 3,
  [LIGHTNING]: 3,
  [BRAVERY_CHARM]: 2,
  "fix-blend": 2,
  "fix-energy": 20,
});
const BOARD_IDS = new Set([...Object.keys(LOCAL).filter((id) => id !== FILLER), BRAVERY_CHARM, "fix-blend"]);

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own FIRST turn (P2 went first and passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6230, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], deck: [...side.deck, ...side.hand] } } };
  }
  return state;
}

/** TEST SURGERY — every Prize whose id is a board id swapped with a Filler / fix-energy deck card. */
function unprize(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  let deck = [...side.deck];
  const prizes = side.prizes.map((u) => {
    if (!BOARD_IDS.has(state.cardIdByUid[u] ?? "")) return u;
    const swap = deck.find((d) => !BOARD_IDS.has(state.cardIdByUid[d] ?? ""));
    if (swap === undefined) throw new Error("no swap card");
    deck = [...deck.filter((d) => d !== swap), u];
    return swap;
  });
  return { ...state, players: { ...state.players, [seat]: { ...side, prizes, deck } } };
}

/** P1's Active is `attacker` with `energy` attached; P2's Active is a Filler. Both Benches empty. */
function table(attacker: string, energy: readonly (readonly [string, number])[]): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const) state = unprize(clearBench(setActiveFromDeck(state, s, FILLER), s), s);
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  for (const [id, n] of energy) state = attachFromDeck(state, "p1", id, n);
  return state;
}

const attack = (index: number, seat: Seat = "p1"): GameAction => ({ type: "attack", seat, index });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const dealtRows = (state: GameState, index: number) => of(mustApply(state, attack(index)).events, "DAMAGE_DEALT");
const dealt = (state: GameState, index: number) => dealtRows(state, index)[0]?.dealt;

describe("D623 §3 — the three new members on a board", () => {
  it("Horrifying Rondo counts YOUR damaged Benched bodies: 30 + 2 × 50 = 130", () => {
    let state = table("me04-041", [[PSY, 1]]);
    expect(dealt(state, 0)).toBe(30); // the printed base, nobody damaged
    state = setDamage(state, "p1", 50); // the Active's own damage is not a Benched body
    state = setBenchDamage(benchFromDeck(state, "p1", FILLER), "p1", 0, 10);
    state = setBenchDamage(benchFromDeck(state, "p1", FILLER), "p1", 1, 90);
    state = benchFromDeck(state, "p1", FILLER); // undamaged
    state = setBenchDamage(benchFromDeck(state, "p2", FILLER), "p2", 0, 30); // theirs
    expect(dealt(state, 0)).toBe(130);
  });

  it("Flame Legion counts YOUR Benched bodies with any {R} Energy, by provision: 40 + 2 × 40 = 120", () => {
    let state = table("me05-012", [[FIRE, 1]]);
    expect(dealt(state, 0)).toBe(40); // the Active's own {R} is not a Benched body
    state = attachBenchFromDeck(benchFromDeck(state, "p1", FILLER), "p1", 0, FIRE, 2); // one body, two cards
    state = attachBenchFromDeck(benchFromDeck(state, "p1", FILLER), "p1", 1, "fix-blend", 1); // provides {R}
    state = attachBenchFromDeck(benchFromDeck(state, "p1", FILLER), "p1", 2, PSY, 1); // no {R}
    state = attachBenchFromDeck(benchFromDeck(state, "p2", FILLER), "p2", 0, FIRE, 1); // theirs
    expect(dealt(state, 0)).toBe(120);
  });

  it("Bouncy Circle counts YOUR Benched bodies whose MODIFIED max HP is exactly 30 (R-BOC1)", () => {
    let state = table("30th-120", []);
    expect(dealtRows(state, 0)).toEqual([]); // empty Bench: the `×` fold is 0, no DAMAGE_DEALT
    state = benchFromDeck(state, "p1", TINY); // 30: counts
    state = benchFromDeck(state, "p1", TINY); // 30 + Bravery Charm = 80: does not
    state = attachToolFromDeck(state, "p1", 1, BRAVERY_CHARM);
    state = benchFromDeck(state, "p1", SMALL); // 60: does not
    state = benchFromDeck(state, "p2", TINY); // theirs
    expect(dealt(state, 0)).toBe(30);
    state = benchFromDeck(state, "p1", TINY);
    expect(dealt(state, 0)).toBe(60);
  });
});

describe("D623 §4 — the two texts on shipped members, on a board", () => {
  it("Pika Chain counts YOUR Pikachu and Pikachu ex by exact name — not Raichu, not theirs", () => {
    let state = table("30th-034", [[LIGHTNING, 3]]);
    expect(dealt(state, 0)).toBe(40); // itself
    state = benchFromDeck(state, "p1", PIKACHU);
    state = benchFromDeck(state, "p1", PIKACHU_EX);
    state = benchFromDeck(state, "p1", RAICHU);
    state = benchFromDeck(state, "p2", PIKACHU);
    expect(dealt(state, 0)).toBe(120);
  });

  it("Riptide counts YOUR Basic {W} Energy cards in the discard, then shuffles exactly those into the deck", () => {
    let state = table("me01-034", [[WATER, 1]]);
    state = discardFromDeck(state, "p1", WATER, 3);
    state = discardFromDeck(state, "p1", FIRE, 1);
    state = discardFromDeck(state, "p1", "fix-blend", 1); // provides {W}, but is not a Basic {W} Energy card
    state = discardFromDeck(state, "p2", WATER, 2); // theirs
    const waters = state.players.p1.discard.filter((u) => state.cardIdByUid[u] === WATER);
    expect(waters).toHaveLength(3);
    const out = mustApply(state, attack(0));
    expect(of(out.events, "DAMAGE_DEALT")[0]?.dealt).toBe(60);
    const after = out.state.players.p1;
    for (const u of waters) {
      expect(after.discard).not.toContain(u);
      expect(after.deck).toContain(u);
    }
    expect(after.discard.map((u) => out.state.cardIdByUid[u]).sort()).toEqual([FIRE, "fix-blend"].sort());
    expect(out.state.players.p2.discard).toHaveLength(2);
    expect(of(out.events, "SHUFFLE")).toHaveLength(1);
  });

  it("Riptide with no Basic {W} Energy in the discard deals nothing and still shuffles (D538's posture)", () => {
    const state = discardFromDeck(table("me01-034", [[WATER, 1]]), "p1", FIRE, 2);
    const out = mustApply(state, attack(0));
    expect(of(out.events, "DAMAGE_DEALT")).toEqual([]);
    expect(of(out.events, "SHUFFLE")).toHaveLength(1);
    expect(out.state.players.p1.discard).toHaveLength(2);
  });
});

describe("D623 §5 — the version", () => {
  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.513.0");
  });
});
