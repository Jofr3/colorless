import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  discardFromDeck,
  handFromDeck,
  itemTrainer,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  trainerCard,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D616 — WP31b: THE SECOND PART OF THE `me` DECK / HAND / DISCARD / ENERGY MISC ───────────────
//
// 9 attack sentences / 11 `me` printings newly reader-built (effects.ts arm 6e-quater), each onto a SHIPPED
// op's program; the one new field is `devolveChosen.defenderOnly`. Every other text on the 11 cards was
// already built, so all 11 are finished. Every id and text off the LOCAL D1, 2026-10-09, `legal_standard = 1`;
// no id was in the tree before this slice except in D615's WP31-rest list.
//
//   Ice Prison            — `discardEnergy` 2, then `applyStatus` Paralyzed on the Defending Pokémon.
//   Backfire              — `discardEnergy` `to: "hand"`, 2 `providesEnergy` Fire.
//   Soothing Melody ×2    — `healChosen` `zone: "bench"` with a `typedPokemon` Psychic filter (D569's field).
//   Devolution Ray ×2     — `devolveChosen` with the NEW `defenderOnly`.
//   Trials and Trip-ulations — `searchDeck` `byName` "Transformation Tome" → hand, revealed.
//   Roto Call             — `optional` over a `pokemonNameContaining` "Rotom" Bench search and its shuffle.
//   Reversed Clock        — Super Rod's program (`pokemonOrBasicEnergy` → deck, shuffle).
//   Traverse Time         — `searchDeck` `anyOf` {G} Pokémon / Stadium → hand, revealed.
//   Fetch and Hide        — `bottomFromOpponentHand` over an Item.
//
// WP31's other 8 texts / 11 printings stay for WP31c, named in §1 [🆕🆕🆕 D624 (D539): 5 / 7 BUILT by WP31c; 3 / 4 stay].

const ICE_PRISON = "Discard 2 Energy from this Pokémon, and your opponent's Active Pokémon is now Paralyzed.";
const BACKFIRE = "Put 2 {R} Energy attached to this Pokémon into your hand.";
const SOOTHING_MELODY = "Heal 120 damage from 1 of your Benched {P} Pokémon.";
const DEVOLUTION_RAY =
  "If your opponent's Active Pokémon is an evolved Pokémon, devolve it by putting the highest Stage Evolution card on it into your opponent's hand.";
const TRIALS =
  "Search your deck for up to 2 Transformation Tome cards, reveal them, and put them into your hand. Then, shuffle your deck.";
const ROTO_CALL =
  'You may search your deck for any number of Pokémon that have "Rotom" in their name and put them onto your Bench. Then, shuffle your deck.';
const REVERSED_CLOCK =
  "Shuffle up to 3 in any combination of Pokémon and Basic Energy cards from your discard pile into your deck.";
const TRAVERSE_TIME =
  "Search your deck for up to 3 in any combination of {G} Pokémon and Stadium cards, reveal them, and put them into your hand. Then, shuffle your deck.";
const FETCH_AND_HIDE =
  "Your opponent reveals their hand, and you put an Item card you find there on the bottom of your opponent's deck.";

/** [attack text, the `me` printing ids that print it]. */
const SENTENCES: readonly (readonly [string, readonly string[]])[] = [
  [ICE_PRISON, ["me02.5-048"]],
  [BACKFIRE, ["me01-025"]],
  [SOOTHING_MELODY, ["mep-026", "me02-040"]],
  [DEVOLUTION_RAY, ["me04-047", "me04-092"]],
  [TRIALS, ["me04-043"]],
  [ROTO_CALL, ["me02.5-092"]],
  [REVERSED_CLOCK, ["30th-103"]],
  [TRAVERSE_TIME, ["me01-012"]],
  [FETCH_AND_HIDE, ["30th-116"]],
];

/** WP31's rest (WP31c): [text, ids, the vocabulary it needs beyond this brief]. */
const WP31_REST: readonly (readonly [string, readonly string[], string])[] = [
  [
    "Choose Basic {L} Energy cards from your discard pile up to the amount of Energy attached to all of your opponent's Pokémon and attach them to your {L} Pokémon in any way you like.",
    ["me03-029", "me03-093"],
    "a count-scaled discard attach",
  ],
  [
    "Discard a {R} Energy, a {W} Energy, and a {L} Energy from this Pokémon.",
    ["30th-121"],
    "a matched multi-type discard (Legacy Energy can fill any slot)",
  ],
  [
    "Discard random cards from your opponent's hand until they have 5 cards in their hand.",
    ["me03-067"],
    "a random discard down to a hand size",
  ],
  [
    "Discard the top 3 cards of your deck and put 1 of them into your hand.",
    ["30th-061", "30th-135"],
    "a mill with a pick",
  ],
  [
    "Each player may attach up to 3 Basic Energy cards from their hand to their Pokémon in any way they like. Your opponent does this first.",
    ["me04-018"],
    "an attach for both players, the opponent first",
  ],
  [
    "Search your deck for an Energy card and attach it to 1 of your Benched {G} Pokémon. Then, shuffle your deck.",
    ["me03-003"],
    "a deck attach of any Energy (the family's noun is Basic only)",
  ],
  [
    "Search your deck for up to 2 Pokémon with {F} Resistance, reveal them, and put them into your hand. Then, shuffle your deck.",
    ["me03-066"],
    "a Resistance filter",
  ],
  [
    "If you have no cards in your hand, choose an attack from 1 of your opponent's Pokémon in play and use it as this attack.",
    ["me05-054", "me05-092"],
    "a gated copy of any opponent's attack",
  ],
];

/** 🆕🆕🆕 D624 — the first printing of each WP31_REST text WP31c builds (`deckHandMiscMeD624.test.ts`). */
const BUILT_AT_D624: ReadonlySet<string> = new Set(["me03-029", "me03-067", "30th-061", "me03-003", "me03-066"]);
/** 🆕🆕🆕 D633 (D539) — O1 reads Elemental Blast (`attackOddsMeD633.test.ts`). */
const BUILT_AT_D633: ReadonlySet<string> = new Set(["30th-121"]);

describe("D616 §1 — the texts", () => {
  it("9 sentences / 11 printings, each a row of the committed `me` corpus, none printed in legal `sv`, each now read", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, ids] of SENTENCES) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
      for (const id of ids) expect(programFor(id)?.attack, id).toBeUndefined();
    }
    expect(SENTENCES.flatMap(([, ids]) => ids)).toHaveLength(11);
  });

  it("WP31's rest stays unbuilt: 8 texts / 11 printings, named (🆕🆕🆕 D624: 5 of them / 7 printings are built — WP31c; 3 / 4 stay; 🆕🆕🆕 D633: Elemental Blast too — O1; 2 / 3 stay)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    for (const [text, ids] of WP31_REST) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      // 🆕🆕🆕 D624 (D539): WP31c reads five of these; Elemental Blast, Pleasing Present and Skill Thief stay unbuilt.
      // [🆕🆕🆕 D633 (D539): Elemental Blast no longer — O1.]
      // 🆕🆕🆕 D633 (D539): and O1 reads Elemental Blast.
      expect(resolvedByAnyReader(text), text).toBe(BUILT_AT_D624.has(ids[0] ?? "") || BUILT_AT_D633.has(ids[0] ?? ""));
      for (const id of ids) expect(programFor(id)?.attack, id).toBeUndefined();
    }
    expect(WP31_REST.filter(([, ids]) => BUILT_AT_D624.has(ids[0] ?? "")).flatMap(([, ids]) => ids)).toHaveLength(7);
    expect(WP31_REST).toHaveLength(8);
    expect(WP31_REST.flatMap(([, ids]) => ids)).toHaveLength(11);
  });
});

describe("D616 §2 — the readings", () => {
  it("Ice Prison: the self-discard at the printed count, then the Paralysis", () => {
    expect(deriveAttackEffect(ICE_PRISON)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: 2 },
      { op: "applyStatus", target: "defender", status: "paralyzed" },
    ]);
    expect(deriveAttackEffect(ICE_PRISON.replace("2 Energy", "3 Energy"))?.[0]).toMatchObject({ count: 3 });
    expect(deriveAttackEffect(ICE_PRISON.replace("2 Energy", "0 Energy"))).toBeNull();
    expect(deriveAttackEffect(ICE_PRISON.replace("2 Energy", "11 Energy"))).toBeNull();
    expect(deriveAttackEffect(ICE_PRISON.replace("opponent's", "opponent’s"))).toHaveLength(2);
    expect(deriveAttackEffect(ICE_PRISON.replace("Paralyzed", "Asleep"))).toBeNull();
    expect(deriveAttackEffect(`${ICE_PRISON} Draw a card.`)).toBeNull();
  });

  it("Backfire: `PUT_SELF_ENERGY_TO_HAND`'s op, typed and counted", () => {
    expect(deriveAttackEffect(BACKFIRE)).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType: "Fire" },
        count: 2,
        to: "hand",
      },
    ]);
    expect(deriveAttackEffect(BACKFIRE.replace("{R}", "{W}"))?.[0]).toMatchObject({
      filter: { kind: "providesEnergy", energyType: "Water" },
    });
    expect(deriveAttackEffect(BACKFIRE.replace("{R}", "{C}"))).toBeNull();
    expect(deriveAttackEffect(BACKFIRE.replace("2 {R}", "0 {R}"))).toBeNull();
    expect(deriveAttackEffect(BACKFIRE.replace("2 {R}", "11 {R}"))).toBeNull();
    expect(deriveAttackEffect(`${BACKFIRE} Draw a card.`)).toBeNull();
  });

  it("Soothing Melody: the Benched heal with a typed candidate filter", () => {
    expect(deriveAttackEffect(SOOTHING_MELODY)).toEqual([
      { op: "healChosen", amount: 120, zone: "bench", filter: { kind: "typedPokemon", pokemonType: "Psychic" } },
    ]);
    expect(deriveAttackEffect(SOOTHING_MELODY.replace("{P}", "{N}"))?.[0]).toMatchObject({
      filter: { kind: "typedPokemon", pokemonType: "Dragon" },
    });
    expect(deriveAttackEffect(SOOTHING_MELODY.replace("{P}", "{X}"))).toBeNull();
    expect(deriveAttackEffect(SOOTHING_MELODY.replace("120", "0"))).toBeNull();
    // The untyped sentence keeps its shipped reading.
    expect(deriveAttackEffect(SOOTHING_MELODY.replace(" {P}", ""))).toEqual([
      { op: "healChosen", amount: 120, zone: "bench" },
    ]);
    expect(deriveAttackEffect(`${SOOTHING_MELODY} Draw a card.`)).toBeNull();
  });

  it("Devolution Ray: `devolveChosen` on the Defending Pokémon; row 87 keeps the bare op", () => {
    expect(deriveAttackEffect(DEVOLUTION_RAY)).toEqual([{ op: "devolveChosen", defenderOnly: true }]);
    expect(
      deriveAttackEffect(
        "Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand.",
      ),
    ).toEqual([{ op: "devolveChosen" }]);
    expect(deriveAttackEffect(DEVOLUTION_RAY.replaceAll("opponent's", "opponent’s"))).toEqual([
      { op: "devolveChosen", defenderOnly: true },
    ]);
    expect(deriveAttackEffect(`${DEVOLUTION_RAY} Draw a card.`)).toBeNull();
  });

  it("Trials and Trip-ulations: the two-word name, the count off the print", () => {
    expect(deriveAttackEffect(TRIALS)).toEqual([
      {
        op: "searchDeck",
        filter: { kind: "byName", name: "Transformation Tome", cardNoun: true },
        dest: "hand",
        max: 2,
        reveal: true,
      },
      { op: "shuffleDeck" },
    ]);
    expect(deriveAttackEffect(TRIALS.replace("up to 2", "up to 0"))).toBeNull();
    expect(deriveAttackEffect(TRIALS.replace("up to 2", "up to 11"))).toBeNull();
    expect(deriveAttackEffect(TRIALS.replace("up to 2", "up to 10"))?.[0]).toMatchObject({ max: 10 });
    expect(deriveAttackEffect(`${TRIALS} Draw a card.`)).toBeNull();
  });

  it("Roto Call: the printed \"You may\" is a confirm over the search and its shuffle", () => {
    expect(deriveAttackEffect(ROTO_CALL)).toEqual([
      {
        op: "optional",
        note: ROTO_CALL,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          { op: "searchDeck", filter: { kind: "pokemonNameContaining", fragment: "Rotom" }, dest: "bench", max: "any" },
          { op: "shuffleDeck" },
        ],
      },
    ]);
    expect(deriveAttackEffect(ROTO_CALL.replaceAll('"', "“").replace("“ in", "” in"))?.[0]).toMatchObject({
      op: "optional",
    });
    const pikachu = deriveAttackEffect(ROTO_CALL.replace("Rotom", "Pikachu"));
    expect(pikachu?.[0]?.op === "optional" ? pikachu[0].then[0] : null).toMatchObject({
      filter: { kind: "pokemonNameContaining", fragment: "Pikachu" },
    });
    expect(deriveAttackEffect(ROTO_CALL.replace("You may search", "Search"))).toBeNull();
    expect(deriveAttackEffect(`${ROTO_CALL} Draw a card.`)).toBeNull();
  });

  it("Reversed Clock: Super Rod's program at the printed count", () => {
    expect(deriveAttackEffect(REVERSED_CLOCK)).toEqual(programFor("sv02-188")?.trainer);
    expect(deriveAttackEffect(REVERSED_CLOCK.replace("up to 3", "up to 0"))).toBeNull();
    expect(deriveAttackEffect(REVERSED_CLOCK.replace("up to 3", "up to 11"))).toBeNull();
    expect(deriveAttackEffect(REVERSED_CLOCK.replace("up to 3", "up to 5"))?.[0]).toMatchObject({ max: 5 });
    expect(deriveAttackEffect(`${REVERSED_CLOCK} Draw a card.`)).toBeNull();
  });

  it("Traverse Time: `anyOf` the typed Pokémon and the Stadium, revealed into the hand", () => {
    expect(deriveAttackEffect(TRAVERSE_TIME)).toEqual([
      {
        op: "searchDeck",
        filter: { kind: "anyOf", filters: [{ kind: "typedPokemon", pokemonType: "Grass" }, { kind: "stadium" }] },
        dest: "hand",
        max: 3,
        reveal: true,
      },
      { op: "shuffleDeck" },
    ]);
    expect(deriveAttackEffect(TRAVERSE_TIME.replace("{G}", "{X}"))).toBeNull();
    expect(deriveAttackEffect(TRAVERSE_TIME.replace("up to 3", "up to 0"))).toBeNull();
    expect(deriveAttackEffect(TRAVERSE_TIME.replace("up to 3", "up to 11"))).toBeNull();
    expect(deriveAttackEffect(`${TRAVERSE_TIME} Draw a card.`)).toBeNull();
  });

  it("Fetch and Hide: the Supporter sentence's op over an Item", () => {
    expect(deriveAttackEffect(FETCH_AND_HIDE)).toEqual([{ op: "bottomFromOpponentHand", filter: { kind: "item" } }]);
    expect(deriveAttackEffect(FETCH_AND_HIDE.replace("opponent's deck", "opponent’s deck"))).toHaveLength(1);
    expect(deriveAttackEffect(FETCH_AND_HIDE.replace("an Item card", "a Supporter card"))).toBeNull();
    expect(deriveAttackEffect(`${FETCH_AND_HIDE} Draw a card.`)).toBeNull();
  });
});

// ── ON A BOARD ──

const FILLER = "d616-filler";
const BASIC = "d616-basic";
const STAGE1 = "d616-stage1";
const PSY = "d616-psychic-mon";
const GRASS = "d616-grass-mon";
const ROTOM = "d616-rotom";
const WASH = "d616-wash-rotom";
const TRAINER = "d616-item";
const ITEM_B = "d616-item-b";
const TOME = "d616-tome";
const STADIUM = "d616-stadium";
const SUPPORTER = "d616-supporter";
const W = "d616-water";
const R = "d616-fire";
const P = "d616-psychic";
const G = "d616-grass";
const F = "d616-fighting";

const mon = (id: string, name: string, hp: number, type: string, attacks: Card["attacks"], extra: Partial<Card> = {}) =>
  battler(id, { name, hp, types: [type], retreat: 2, attacks, ...extra });
const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];

const LOCAL: Record<string, Card> = {
  "me02.5-048": mon("me02.5-048", "Regice ex", 230, "Water", [
    { cost: ["Colorless"], name: "Regi Charge", effect: "Attach up to 2 Basic {W} Energy cards from your discard pile to this Pokémon." },
    { cost: ["Water", "Colorless", "Colorless", "Colorless"], name: "Ice Prison", damage: 140, effect: ICE_PRISON },
  ]),
  "me01-025": mon("me01-025", "Volcanion", 130, "Fire", [
    { cost: ["Fire"], name: "Singe", effect: "Your opponent's Active Pokémon is now Burned." },
    { cost: ["Fire", "Fire", "Colorless"], name: "Backfire", damage: 130, effect: BACKFIRE },
  ]),
  "mep-026": mon("mep-026", "Meloetta", 90, "Psychic", [
    { cost: ["Psychic"], name: "Soothing Melody", effect: SOOTHING_MELODY },
    { cost: ["Psychic", "Colorless"], name: "Magical Shot", damage: 50 },
  ]),
  "me04-047": mon(
    "me04-047",
    "Claydol",
    120,
    "Fighting",
    [{ cost: ["Fighting"], name: "Devolution Ray", damage: 50, effect: DEVOLUTION_RAY }],
    { stage: "Stage1", evolveFrom: "Baltoy" },
  ),
  "me04-043": mon("me04-043", "Sudowoodo", 110, "Fighting", [
    { cost: ["Colorless"], name: "Trials and Trip-ulations", effect: TRIALS },
    { cost: ["Fighting"], name: "Rock Hurl", damage: 30, effect: "This attack's damage isn't affected by Resistance." },
  ]),
  "me02.5-092": mon("me02.5-092", "Rotom", 60, "Psychic", [{ cost: ["Colorless"], name: "Roto Call", effect: ROTO_CALL }]),
  "30th-103": mon("30th-103", "Dialga", 130, "Metal", [
    { cost: ["Colorless"], name: "Reversed Clock", effect: REVERSED_CLOCK },
    { cost: ["Metal", "Metal", "Colorless"], name: "Heavy Impact", damage: 110 },
  ]),
  "me01-012": mon("me01-012", "Celebi", 80, "Grass", [
    { cost: ["Grass"], name: "Traverse Time", effect: TRAVERSE_TIME },
    { cost: ["Grass"], name: "Solar Cutter", damage: 30 },
  ]),
  "30th-116": mon("30th-116", "Eevee", 70, "Colorless", [
    { cost: ["Colorless"], name: "Fetch and Hide", effect: FETCH_AND_HIDE },
    { cost: ["Colorless"], name: "Tackle", damage: 10 },
  ]),
  [FILLER]: mon(FILLER, "D616 Filler", 400, "Colorless", TAP),
  [BASIC]: mon(BASIC, "D616 Basic", 60, "Colorless", TAP),
  [STAGE1]: mon(STAGE1, "D616 Stage 1", 90, "Colorless", TAP, { stage: "Stage1", evolveFrom: "D616 Basic" }),
  [PSY]: mon(PSY, "D616 Psychic", 200, "Psychic", TAP),
  [GRASS]: mon(GRASS, "D616 Grass", 70, "Grass", TAP),
  [ROTOM]: mon(ROTOM, "Rotom", 60, "Psychic", TAP),
  [WASH]: mon(WASH, "Wash Rotom", 70, "Water", TAP),
  [TRAINER]: itemTrainer(TRAINER),
  [ITEM_B]: itemTrainer(ITEM_B),
  [TOME]: { ...itemTrainer(TOME), name: "Transformation Tome" },
  [STADIUM]: trainerCard(STADIUM, "Stadium", "D616 Stadium."),
  [SUPPORTER]: trainerCard(SUPPORTER, "Supporter", "D616 Supporter."),
  [W]: typedEnergy(W, "Water"),
  [R]: typedEnergy(R, "Fire"),
  [P]: typedEnergy(P, "Psychic"),
  [G]: typedEnergy(G, "Grass"),
  [F]: typedEnergy(F, "Fighting"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  "me02.5-048": 1,
  "me01-025": 1,
  "mep-026": 1,
  "me04-047": 1,
  "me04-043": 1,
  "me02.5-092": 1,
  "30th-103": 1,
  "me01-012": 1,
  "30th-116": 1,
  [FILLER]: 8,
  [BASIC]: 4,
  [STAGE1]: 3,
  [PSY]: 3,
  [GRASS]: 2,
  [ROTOM]: 2,
  [WASH]: 1,
  [TRAINER]: 3,
  [ITEM_B]: 1,
  [TOME]: 3,
  [STADIUM]: 2,
  [SUPPORTER]: 1,
  "fix-unaware": 2,
  [W]: 4,
  [R]: 4,
  [P]: 2,
  [G]: 2,
  [F]: 2,
  "fix-energy": 2,
});
const BOARD_IDS = new Set([...Object.keys(LOCAL).filter((id) => id !== FILLER), "fix-unaware", "fix-energy"]);

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own FIRST turn (P2 went first and passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6162, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** P1's Active is `attacker` with `energy` and `ownBench`; P2's Active is `defender` with `bench`. */
function table(
  attacker: string,
  energy: readonly (readonly [string, number])[],
  defender: string = FILLER,
  bench: readonly string[] = [],
  ownBench: readonly string[] = [],
): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const) state = unprize(clearBench(setActiveFromDeck(state, s, FILLER), s), s);
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  for (const [id, n] of energy) state = attachFromDeck(state, "p1", id, n);
  for (const id of ownBench) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", defender), "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  return state;
}

/** TEST SURGERY — `cardId` (off `seat`'s deck) onto the body at `spot`, as an evolution would stack it. */
function evolveBySurgery(state: GameState, seat: Seat, spot: "active" | number, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat} deck has no ${cardId}`);
  const deck = side.deck.filter((u) => u !== uid);
  if (spot === "active") {
    if (side.active === null) throw new Error("no Active");
    const active = { ...side.active, stack: [...side.active.stack, uid] };
    return { ...state, players: { ...state.players, [seat]: { ...side, deck, active } } };
  }
  const bench = side.bench.map((b, i) => (i === spot ? { ...b, stack: [...b.stack, uid] } : b));
  return { ...state, players: { ...state.players, [seat]: { ...side, deck, bench } } };
}

const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
const sorted = (xs: readonly (string | undefined)[]) => [...xs].sort();

function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected a chooseCards park, got ${state.phase.kind}`);
  }
  return state.phase.prompt;
}
const answerCards = (state: GameState, uids: string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } } as GameAction);

describe("D616 §3 — Ice Prison: 2 Energy off the attacker, the Defending Pokémon Paralyzed", () => {
  it("the damage lands, 2 of the 4 Water Energy are discarded, and the Defending Pokémon is Paralyzed", () => {
    const state = table("me02.5-048", [[W, 4]]);
    const result = mustApply(state, attack(1));
    expect(result.state.players.p2.active?.damage).toBe(140);
    expect(ids(result.state, result.state.players.p1.active?.energy ?? [])).toEqual([W, W]);
    expect(ids(result.state, result.state.players.p1.discard).filter((id) => id === W)).toHaveLength(2);
    expect(result.state.players.p2.active?.conditions.rotation).toBe("paralyzed");
  });

  it("an effects shield on the Defending Pokémon refuses the Paralysis; the discard still happens", () => {
    const state = table("me02.5-048", [[W, 4]], "fix-unaware");
    const result = mustApply(state, attack(1));
    expect(result.state.players.p2.active?.conditions.rotation).toBe("none");
    expect(result.state.players.p1.active?.energy).toHaveLength(2);
  });
});

describe("D616 §4 — Backfire: 2 {R} Energy from this Pokémon into the hand", () => {
  it("two Fire Energy go to the hand; the Colorless Energy stays", () => {
    const state = table("me01-025", [[R, 3], ["fix-energy", 1]]);
    const result = mustApply(state, attack(1));
    expect(result.state.players.p2.active?.damage).toBe(130);
    expect(ids(result.state, result.state.players.p1.hand)).toEqual([R, R]);
    expect(sorted(ids(result.state, result.state.players.p1.active?.energy ?? []))).toEqual(sorted([R, "fix-energy"]));
    expect(ids(result.state, result.state.players.p1.discard).filter((id) => id === R)).toEqual([]);
  });
});

describe("D616 §5 — Soothing Melody: 120 from 1 Benched {P} Pokémon", () => {
  it("only the Psychic body is a candidate: forced, healed 120; the Colorless body is untouched", () => {
    let state = table("mep-026", [[P, 1]], FILLER, [], [BASIC, PSY]);
    state = setBenchDamage(setBenchDamage(state, "p1", 0, 30), "p1", 1, 130);
    const result = mustApply(state, attack(0));
    expect(result.state.players.p1.bench.map((b) => b.damage)).toEqual([30, 10]);
  });

  it("two Psychic bodies park a pick between exactly those two", () => {
    let state = table("mep-026", [[P, 1]], FILLER, [], [PSY, BASIC, PSY]);
    state = setBenchDamage(setBenchDamage(setBenchDamage(state, "p1", 0, 50), "p1", 1, 50), "p1", 2, 50);
    const parked = mustApply(state, attack(0)).state;
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "choosePokemon") {
      throw new Error(`expected a choosePokemon park, got ${parked.phase.kind}`);
    }
    expect(parked.phase.prompt.candidates.map((r) => (r.spot.spot === "bench" ? r.spot.index : -1))).toEqual([0, 2]);
    const result = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 2 } } },
    } as GameAction);
    expect(result.state.players.p1.bench.map((b) => b.damage)).toEqual([50, 50, 0]);
  });

  it("no Benched Psychic body: a silent no-op", () => {
    const state = setBenchDamage(table("mep-026", [[P, 1]], FILLER, [], [BASIC]), "p1", 0, 30);
    const result = mustApply(state, attack(0));
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(result.state.players.p1.bench[0]?.damage).toBe(30);
  });
});

describe("D616 §6 — Devolution Ray: the Defending Pokémon alone, its top card into the opponent's hand", () => {
  it("an evolved Active devolves after the damage; an evolved Benched body is not touched", () => {
    let state = table("me04-047", [[F, 1]], BASIC, [BASIC]);
    state = evolveBySurgery(evolveBySurgery(state, "p2", "active", STAGE1), "p2", 0, STAGE1);
    const result = mustApply(state, attack(0));
    expect(of(result.events, "POKEMON_DEVOLVED").map((e) => [e.seat, ids(result.state, [e.from])[0], e.zone])).toEqual([
      ["p2", STAGE1, "hand"],
    ]);
    expect(result.state.players.p2.active?.stack).toHaveLength(1);
    expect(result.state.players.p2.active?.damage).toBe(50);
    expect(result.state.players.p2.bench[0]?.stack).toHaveLength(2);
  });

  it("an unevolved Active: nothing devolves, even with an evolved Benched body", () => {
    let state = table("me04-047", [[F, 1]], BASIC, [BASIC]);
    state = evolveBySurgery(state, "p2", 0, STAGE1);
    const result = mustApply(state, attack(0));
    expect(of(result.events, "POKEMON_DEVOLVED")).toEqual([]);
    expect(result.state.players.p2.bench[0]?.stack).toHaveLength(2);
  });

  it("a shielded evolved Active is refused (§11)", () => {
    let state = table("me04-047", [[F, 1]], BASIC);
    state = evolveBySurgery(state, "p2", "active", "fix-unaware");
    const result = mustApply(state, attack(0));
    expect(of(result.events, "POKEMON_DEVOLVED")).toEqual([]);
    expect(of(result.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    expect(result.state.players.p2.active?.stack).toHaveLength(2);
  });

  it("a shielded evolved Benched body is never asked: no refusal row, the Active still devolves", () => {
    let state = table("me04-047", [[F, 1]], BASIC, [BASIC]);
    state = evolveBySurgery(evolveBySurgery(state, "p2", "active", STAGE1), "p2", 0, "fix-unaware");
    const result = mustApply(state, attack(0));
    expect(of(result.events, "ATTACK_EFFECT_PREVENTED")).toEqual([]);
    expect(of(result.events, "POKEMON_DEVOLVED")).toHaveLength(1);
    expect(result.state.players.p2.bench[0]?.stack).toHaveLength(2);
  });

  it("devolving below the damage Knocks Out", () => {
    let state = table("me04-047", [[F, 1]], BASIC);
    state = setDamage(evolveBySurgery(state, "p2", "active", STAGE1), "p2", 20);
    const result = mustApply(state, attack(0));
    expect(of(result.events, "KNOCKED_OUT").map((e) => [e.seat, ids(result.state, [e.uid])[0]])).toEqual([
      ["p2", BASIC],
    ]);
  });
});

describe("D616 §7 — Trials and Trip-ulations: up to 2 Transformation Tome cards, revealed into the hand", () => {
  it("only the Tomes are offered, at most 2; the picks go to the hand and the deck is shuffled", () => {
    const state = table("me04-043", [["fix-energy", 1]]);
    const parked = mustApply(state, attack(0)).state;
    const prompt = cardsPrompt(parked);
    expect(new Set(ids(parked, prompt.candidates))).toEqual(new Set([TOME]));
    expect(prompt.candidates).toHaveLength(3);
    expect(prompt.max).toBe(2);
    const result = answerCards(parked, prompt.candidates.slice(0, 2));
    expect(ids(result.state, result.state.players.p1.hand)).toEqual([TOME, TOME]);
    expect(of(result.events, "DECK_SEARCHED")[0]?.reveal).toBe(true);
    expect(of(result.events, "SHUFFLE").map((e) => e.seat)).toContain("p1");
  });
});

describe("D616 §8 — Roto Call: \"You may\", then any number of Rotom onto the Bench", () => {
  const confirm = (state: GameState, yes: boolean) =>
    mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } } as GameAction);

  it("yes: only Pokémon with \"Rotom\" in their name are offered, and the picks are benched", () => {
    const asked = mustApply(table("me02.5-092", [["fix-energy", 1]]), attack(0)).state;
    if (asked.phase.kind !== "effect:choose" || asked.phase.prompt.kind !== "confirm") {
      throw new Error(`expected a confirm park, got ${asked.phase.kind}`);
    }
    expect(asked.phase.prompt.note).toBe(ROTO_CALL);
    const parked = confirm(asked, true).state;
    const prompt = cardsPrompt(parked);
    expect(sorted(ids(parked, prompt.candidates))).toEqual(sorted([ROTOM, ROTOM, WASH]));
    expect(prompt.min).toBe(0);
    const result = answerCards(parked, prompt.candidates);
    expect(sorted(result.state.players.p1.bench.map((b) => ids(result.state, b.stack)[0]))).toEqual(
      sorted([ROTOM, ROTOM, WASH]),
    );
    expect(of(result.events, "SHUFFLE").map((e) => e.seat)).toContain("p1");
  });

  it("no: nothing is searched and the deck is not shuffled", () => {
    const asked = mustApply(table("me02.5-092", [["fix-energy", 1]]), attack(0)).state;
    const deckBefore = asked.players.p1.deck;
    const result = confirm(asked, false);
    expect(result.state.players.p1.bench).toEqual([]);
    expect(of(result.events, "SHUFFLE").filter((e) => e.seat === "p1")).toEqual([]);
    expect(result.state.players.p1.deck).toEqual(deckBefore);
  });
});

describe("D616 §9 — Reversed Clock: up to 3 Pokémon / Basic Energy from the discard into the deck", () => {
  it("Pokémon and Basic Energy are offered, a Trainer is not; the picks are shuffled into the deck", () => {
    let state = table("30th-103", [["fix-energy", 1]]);
    state = discardFromDeck(discardFromDeck(discardFromDeck(state, "p1", BASIC, 1), "p1", STAGE1, 1), "p1", W, 2);
    state = discardFromDeck(state, "p1", TRAINER, 1);
    const parked = mustApply(state, attack(0)).state;
    const prompt = cardsPrompt(parked);
    expect(sorted(ids(parked, prompt.candidates))).toEqual(sorted([BASIC, STAGE1, W, W]));
    expect(prompt.max).toBe(3);
    const deckBefore = parked.players.p1.deck.length;
    const result = answerCards(parked, prompt.candidates.slice(0, 3));
    expect(result.state.players.p1.deck).toHaveLength(deckBefore + 3);
    expect(ids(result.state, result.state.players.p1.discard)).toHaveLength(2);
    expect(of(result.events, "SHUFFLE").map((e) => e.seat)).toContain("p1");
  });
});

describe("D616 §10 — Traverse Time: up to 3 {G} Pokémon / Stadium cards into the hand", () => {
  it("only the Grass Pokémon and the Stadiums are offered, at most 3", () => {
    const state = table("me01-012", [[G, 1]]);
    const parked = mustApply(state, attack(0)).state;
    const prompt = cardsPrompt(parked);
    const offered = ids(parked, prompt.candidates);
    expect(new Set(offered)).toEqual(new Set([GRASS, STADIUM]));
    expect(offered.filter((id) => id === STADIUM)).toHaveLength(2);
    expect(prompt.max).toBe(3);
    const pick = [
      ...prompt.candidates.filter((u) => parked.cardIdByUid[u] === STADIUM).slice(0, 1),
      ...prompt.candidates.filter((u) => parked.cardIdByUid[u] === GRASS).slice(0, 2),
    ];
    const result = answerCards(parked, pick);
    expect(sorted(ids(result.state, result.state.players.p1.hand))).toEqual(sorted([STADIUM, GRASS, GRASS]));
    expect(of(result.events, "DECK_SEARCHED")[0]?.reveal).toBe(true);
  });
});

describe("D616 §11 — Fetch and Hide: an Item from the opponent's hand to the bottom of their deck", () => {
  it("one Item print among a Supporter and a Stadium: forced, it goes to the bottom of p2's deck", () => {
    let state = table("30th-116", [["fix-energy", 1]]);
    state = handFromDeck(handFromDeck(handFromDeck(state, "p2", TRAINER, 2), "p2", SUPPORTER, 1), "p2", STADIUM, 1);
    const result = mustApply(state, attack(0));
    expect(result.state.phase.kind).not.toBe("effect:choose");
    // p2 draws for its turn off the top, so the bottom card is still the Item.
    expect(ids(result.state, [result.state.players.p2.deck.at(-1) ?? ""])).toEqual([TRAINER]);
    const hand = ids(result.state, result.state.players.p2.hand);
    expect([TRAINER, SUPPORTER, STADIUM].map((id) => hand.filter((h) => h === id).length)).toEqual([1, 1, 1]);
  });

  it("two Item prints park a pick between the Items only", () => {
    let state = table("30th-116", [["fix-energy", 1]]);
    state = handFromDeck(handFromDeck(handFromDeck(state, "p2", TRAINER, 1), "p2", ITEM_B, 1), "p2", SUPPORTER, 1);
    const parked = mustApply(state, attack(0)).state;
    const prompt = cardsPrompt(parked);
    expect(sorted(ids(parked, prompt.candidates))).toEqual(sorted([TRAINER, ITEM_B]));
    const pick = prompt.candidates.find((u) => parked.cardIdByUid[u] === ITEM_B) as string;
    const result = answerCards(parked, [pick]);
    expect(result.state.players.p2.deck.at(-1)).toBe(pick);
  });

  it("no Item in the opponent's hand: nothing moves", () => {
    let state = table("30th-116", [["fix-energy", 1]]);
    state = handFromDeck(state, "p2", SUPPORTER, 1);
    const result = mustApply(state, attack(0));
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(ids(result.state, result.state.players.p2.hand)).toContain(SUPPORTER);
  });
});

describe("D616 §12 — the version", () => {
  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.520.0");
  });
});
