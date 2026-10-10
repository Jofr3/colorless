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
  toDeckTop,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D615 — WP31a: THE FIRST PART OF THE `me` DECK / HAND / DISCARD / ENERGY MISC ────────────────
//
// 8 attack sentences / 13 `me` printings newly reader-built, each onto a SHIPPED op's program with no new
// op, prompt or event; the one new field is `devolveEach.toHand`. Every other text on the 13 cards was
// already built (Frosmoth's Ability since D591), so all 13 are finished. Every id and text off the LOCAL
// D1, 2026-10-09, `legal_standard = 1`; no id was in the tree before this slice except Frosmoth
// `me02.5-053` (D591's Alluring Wings key).
//
//   Trick Portal       — `lookAtTopN` → Bench, `max: "any"` (`ATTACK_LOOK_TOP_BENCH`'s program, comma join).
//   Fruity Aroma       — `lookAtTopN` → hand, `max: "any"`, `reveal` (Roto-Stick's shape over Pokémon).
//   Pika-Pika Parade ×3 — Precious Trolley's `searchDeck` (Basic → Bench, `max: "any"`).
//   Gentle Light ×3    — Picnic Basket's `healEachAll` (R-GLT1: a §11 shield does not refuse the heal).
//   Nitpick ×2         — `handRefresh` `who: "opponent"`, a fixed draw of 4.
//   Flames of Revival  — `discardPileRetrieval` of Basic Pokémon onto the Bench.
//   Miraculous Shine   — `devolveEach` with the NEW `toHand` (`devolveChosen`'s writer per body).
//   Cold Cyclone       — `moveEnergy` `selfToBench` with a typed (`providesEnergy`) noun.
//
// WP31's other 17 texts / 22 printings stay for WP31b / WP31c, named in §1.

const TRICK_PORTAL =
  "Look at the top 9 cards of your deck, and you may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.";
const FRUITY_AROMA =
  "Look at the top 6 cards of your deck, and you may reveal any number of Pokémon you find there and put them into your hand. Shuffle the other cards back into your deck.";
const PIKA_PIKA_PARADE =
  "Search your deck for any number of Basic Pokémon and put them onto your Bench. Then, shuffle your deck.";
const GENTLE_LIGHT = "Heal 30 damage from each Pokémon (both yours and your opponent's).";
const NITPICK = "Your opponent shuffles their hand into their deck and draws 4 cards.";
const FLAMES_OF_REVIVAL = "Put up to 3 Basic Pokémon from your discard pile onto your Bench.";
const MIRACULOUS_SHINE =
  "Devolve each of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand.";
const COLD_CYCLONE = "Move a {W} Energy from this Pokémon to 1 of your Benched Pokémon.";

/** [attack text, the `me` printing ids that print it]. */
const SENTENCES: readonly (readonly [string, readonly string[]])[] = [
  [TRICK_PORTAL, ["me05-008"]],
  [FRUITY_AROMA, ["me05-001"]],
  [PIKA_PIKA_PARADE, ["mep-107", "30th-053", "30th-149"]],
  [GENTLE_LIGHT, ["me04-035", "me04-101", "me04-117"]],
  [NITPICK, ["30th-094", "30th-140"]],
  [FLAMES_OF_REVIVAL, ["me04-010"]],
  [MIRACULOUS_SHINE, ["30th-069"]],
  [COLD_CYCLONE, ["me02.5-053"]],
];

/** WP31's rest (WP31b / WP31c): [text, ids]. Each needs vocabulary beyond this brief's shipped programs. */
const WP31_REST: readonly (readonly [string, readonly string[]])[] = [
  [
    "Choose Basic {L} Energy cards from your discard pile up to the amount of Energy attached to all of your opponent's Pokémon and attach them to your {L} Pokémon in any way you like.",
    ["me03-029", "me03-093"],
  ],
  ["Discard 2 Energy from this Pokémon, and your opponent's Active Pokémon is now Paralyzed.", ["me02.5-048"]],
  ["Discard a {R} Energy, a {W} Energy, and a {L} Energy from this Pokémon.", ["30th-121"]],
  ["Discard random cards from your opponent's hand until they have 5 cards in their hand.", ["me03-067"]],
  ["Discard the top 3 cards of your deck and put 1 of them into your hand.", ["30th-061", "30th-135"]],
  [
    "Each player may attach up to 3 Basic Energy cards from their hand to their Pokémon in any way they like. Your opponent does this first.",
    ["me04-018"],
  ],
  ["Heal 120 damage from 1 of your Benched {P} Pokémon.", ["mep-026", "me02-040"]],
  [
    "If your opponent's Active Pokémon is an evolved Pokémon, devolve it by putting the highest Stage Evolution card on it into your opponent's hand.",
    ["me04-047", "me04-092"],
  ],
  ["Put 2 {R} Energy attached to this Pokémon into your hand.", ["me01-025"]],
  [
    "Search your deck for an Energy card and attach it to 1 of your Benched {G} Pokémon. Then, shuffle your deck.",
    ["me03-003"],
  ],
  [
    "Search your deck for up to 2 Pokémon with {F} Resistance, reveal them, and put them into your hand. Then, shuffle your deck.",
    ["me03-066"],
  ],
  [
    "Search your deck for up to 2 Transformation Tome cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    ["me04-043"],
  ],
  [
    "Search your deck for up to 3 in any combination of {G} Pokémon and Stadium cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    ["me01-012"],
  ],
  [
    "Shuffle up to 3 in any combination of Pokémon and Basic Energy cards from your discard pile into your deck.",
    ["30th-103"],
  ],
  [
    'You may search your deck for any number of Pokémon that have "Rotom" in their name and put them onto your Bench. Then, shuffle your deck.',
    ["me02.5-092"],
  ],
  [
    "Your opponent reveals their hand, and you put an Item card you find there on the bottom of your opponent's deck.",
    ["30th-116"],
  ],
  [
    "If you have no cards in your hand, choose an attack from 1 of your opponent's Pokémon in play and use it as this attack.",
    ["me05-054", "me05-092"],
  ],
];

/** 🆕🆕🆕 D616 — the first printing of each WP31_REST text WP31b builds. */
const BUILT_AT_D616: ReadonlySet<string> = new Set([
  "me02.5-048",
  "mep-026",
  "me04-047",
  "me01-025",
  "me04-043",
  "me01-012",
  "30th-103",
  "me02.5-092",
  "30th-116",
]);

/** 🆕🆕🆕 D624 — the first printing of each WP31_REST text WP31c builds. */
const BUILT_AT_D624: ReadonlySet<string> = new Set(["me03-029", "me03-067", "30th-061", "me03-003", "me03-066"]);
/** 🆕🆕🆕 D633 (D539) — O1 reads Elemental Blast (`attackOddsMeD633.test.ts`). */
const BUILT_AT_D633: ReadonlySet<string> = new Set(["30th-121"]);
/** 🆕🆕🆕 D638 (D539) — X1 reads Skill Thief (`copyBorrowedMeD638.test.ts`). */
const BUILT_AT_D638: ReadonlySet<string> = new Set(["me05-054"]);
/** 🆕🆕🆕 D641 (D539) — W1 reads Pleasing Present (two `attachFromHand { max }`, the opponent's first). */
const BUILT_AT_D641: ReadonlySet<string> = new Set(["me04-018"]);

describe("D615 §1 — the texts", () => {
  it("8 sentences / 13 printings, each a row of the committed `me` corpus, none printed in legal `sv`, each now read", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, ids] of SENTENCES) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
      for (const id of ids) expect(programFor(id)?.attack, id).toBeUndefined();
    }
    expect(SENTENCES.flatMap(([, ids]) => ids)).toHaveLength(13);
  });

  it("WP31's rest stays unbuilt: 17 texts / 22 printings, named (🆕🆕🆕 D616: 9 of them / 11 printings are built — WP31b; 8 / 11 stay; 🆕🆕🆕 D624: 5 more / 7 — WP31c; 3 / 4 stay; 🆕🆕🆕 D633: Elemental Blast too — O1; 2 / 3 stay; 🆕🆕🆕 D638: Skill Thief ×2 too — X1; 1 / 1 stays)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    for (const [text, ids] of WP31_REST) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      // 🆕🆕🆕 D616 (D539): WP31b reads nine of these (`deckHandMiscMeD616.test.ts`); the rest stay unbuilt.
      // 🆕🆕🆕 D624 (D539): and WP31c reads five more (`deckHandMiscMeD624.test.ts`).
      // 🆕🆕🆕 D633 (D539): and O1 reads Elemental Blast.
      // 🆕🆕🆕 D638 (D539): and X1 reads Skill Thief.
      // 🆕🆕🆕 D641 (D539): and W1 reads Pleasing Present — none of WP31's rest stays unbuilt.
      expect(resolvedByAnyReader(text), text).toBe(
        BUILT_AT_D616.has(ids[0] ?? "") ||
          BUILT_AT_D624.has(ids[0] ?? "") ||
          BUILT_AT_D633.has(ids[0] ?? "") ||
          BUILT_AT_D638.has(ids[0] ?? "") ||
          BUILT_AT_D641.has(ids[0] ?? ""),
      );
      for (const id of ids) expect(programFor(id)?.attack, id).toBeUndefined();
    }
    expect(WP31_REST.filter(([, ids]) => BUILT_AT_D616.has(ids[0] ?? "")).flatMap(([, ids]) => ids)).toHaveLength(11);
    expect(WP31_REST.filter(([, ids]) => BUILT_AT_D624.has(ids[0] ?? "")).flatMap(([, ids]) => ids)).toHaveLength(7);
    expect(WP31_REST).toHaveLength(17);
    expect(WP31_REST.flatMap(([, ids]) => ids)).toHaveLength(22);
  });
});

describe("D615 §2 — the readings", () => {
  it("Trick Portal and Fruity Aroma: the two looks, the window off the print", () => {
    expect(deriveAttackEffect(TRICK_PORTAL)).toEqual([
      { op: "lookAtTopN", n: 9, filter: { kind: "anyPokemon" }, max: "any", dest: "bench" },
      { op: "shuffleDeck" },
    ]);
    // The comma join reads exactly as the shipped full-stop sentence does.
    expect(deriveAttackEffect(TRICK_PORTAL)).toEqual(
      deriveAttackEffect(TRICK_PORTAL.replace(", and you may put", ". You may put")),
    );
    expect(deriveAttackEffect(FRUITY_AROMA)).toEqual([
      { op: "lookAtTopN", n: 6, filter: { kind: "anyPokemon" }, max: "any", reveal: true },
      { op: "shuffleDeck" },
    ]);
    for (const text of [TRICK_PORTAL, FRUITY_AROMA]) {
      const window = text.includes("top 9") ? "top 9" : "top 6";
      expect(deriveAttackEffect(text.replace(window, "top 0")), text).toBeNull();
      expect(deriveAttackEffect(text.replace(window, "top 31")), text).toBeNull();
      expect(deriveAttackEffect(text.replace(window, "top 30"))?.[0], text).toMatchObject({ n: 30 });
      expect(deriveAttackEffect(`${text} Draw a card.`), text).toBeNull();
      expect(deriveAttackEffect(`Draw a card. ${text}`), text).toBeNull();
    }
    expect(deriveAttackEffect(FRUITY_AROMA.replace("Pokémon you find", "Supporter cards you find"))).toBeNull();
  });

  it("Pika-Pika Parade: Precious Trolley's program, the noun pinned", () => {
    expect(deriveAttackEffect(PIKA_PIKA_PARADE)).toEqual(programFor("sv08-185")?.trainer);
    expect(deriveAttackEffect(PIKA_PIKA_PARADE)).toEqual([
      { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: "any" },
      { op: "shuffleDeck" },
    ]);
    expect(deriveAttackEffect(PIKA_PIKA_PARADE.replace("Basic Pokémon", "Pokémon"))).toBeNull();
    expect(deriveAttackEffect(`${PIKA_PIKA_PARADE} Draw a card.`)).toBeNull();
  });

  it("Gentle Light: Picnic Basket's program at the printed amount", () => {
    expect(deriveAttackEffect(GENTLE_LIGHT)).toEqual(programFor("sv01-184")?.trainer);
    expect(deriveAttackEffect(GENTLE_LIGHT.replace("30", "50"))).toEqual([{ op: "healEachAll", amount: 50 }]);
    expect(deriveAttackEffect(GENTLE_LIGHT.replace("30", "0"))).toBeNull();
    expect(deriveAttackEffect(GENTLE_LIGHT.replace("opponent's", "opponent’s"))).toEqual([
      { op: "healEachAll", amount: 30 },
    ]);
    expect(deriveAttackEffect(GENTLE_LIGHT.replace(" (both yours and your opponent's)", ""))).toBeNull();
    expect(deriveAttackEffect(`${GENTLE_LIGHT} Draw a card.`)).toBeNull();
  });

  it("Nitpick: the opponent's hand alone, the count off the print", () => {
    expect(deriveAttackEffect(NITPICK)).toEqual([
      { op: "handRefresh", who: "opponent", draw: { kind: "fixed", count: 4 } },
    ]);
    expect(deriveAttackEffect(NITPICK.replace("4", "6"))?.[0]).toMatchObject({ draw: { kind: "fixed", count: 6 } });
    expect(deriveAttackEffect(NITPICK.replace("4", "0"))).toBeNull();
    expect(deriveAttackEffect(`${NITPICK} Draw a card.`)).toBeNull();
  });

  it("Flames of Revival: Basic Pokémon from the discard onto the Bench, the count guarded", () => {
    expect(deriveAttackEffect(FLAMES_OF_REVIVAL)).toEqual([
      { op: "discardPileRetrieval", filter: { kind: "basicPokemon" }, dest: "bench", max: 3 },
    ]);
    expect(deriveAttackEffect(FLAMES_OF_REVIVAL.replace("3", "0"))).toBeNull();
    expect(deriveAttackEffect(FLAMES_OF_REVIVAL.replace("3", "11"))).toBeNull();
    expect(deriveAttackEffect(FLAMES_OF_REVIVAL.replace("3", "10"))?.[0]).toMatchObject({ max: 10 });
    expect(deriveAttackEffect(`${FLAMES_OF_REVIVAL} Draw a card.`)).toBeNull();
  });

  it("Miraculous Shine: the sweep with `toHand`; the deck sentence keeps the bare op", () => {
    expect(deriveAttackEffect(MIRACULOUS_SHINE)).toEqual([{ op: "devolveEach", toHand: true }]);
    expect(
      deriveAttackEffect(
        "Devolve each of your opponent's evolved Pokémon by shuffling the highest Stage Evolution card on it into your opponent's deck.",
      ),
    ).toEqual([{ op: "devolveEach" }]);
    expect(deriveAttackEffect(MIRACULOUS_SHINE.replace("opponent's hand", "opponent’s hand"))).toEqual([
      { op: "devolveEach", toHand: true },
    ]);
    expect(deriveAttackEffect(`${MIRACULOUS_SHINE} Draw a card.`)).toBeNull();
  });

  it("Cold Cyclone: the typed noun is `providesEnergy`, the code mapped", () => {
    expect(deriveAttackEffect(COLD_CYCLONE)).toEqual([
      { op: "moveEnergy", filter: { kind: "providesEnergy", energyType: "Water" }, max: 1, route: "selfToBench" },
    ]);
    expect(deriveAttackEffect(COLD_CYCLONE.replace("{W}", "{R}"))?.[0]).toMatchObject({
      filter: { kind: "providesEnergy", energyType: "Fire" },
    });
    expect(deriveAttackEffect(COLD_CYCLONE.replace("{W}", "{C}"))).toBeNull();
    expect(deriveAttackEffect(`${COLD_CYCLONE} Draw a card.`)).toBeNull();
  });
});

// ── ON A BOARD ──

const FILLER = "d615-filler";
const BASIC = "d615-basic";
const STAGE1 = "d615-stage1";
const TRAINER = "d615-item";
const W = "d615-water";
const R = "d615-fire";
const P = "d615-psychic";

const mon = (id: string, name: string, hp: number, type: string, attacks: Card["attacks"], extra: Partial<Card> = {}) =>
  battler(id, { name, hp, types: [type], retreat: 2, attacks, ...extra });
const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];

const LOCAL: Record<string, Card> = {
  "me05-008": mon(
    "me05-008",
    "Mega Delphox ex",
    350,
    "Fire",
    [{ cost: ["Fire"], name: "Trick Portal", effect: TRICK_PORTAL }],
    { stage: "Stage2", evolveFrom: "Braixen" },
  ),
  "me05-001": mon("me05-001", "Tropius", 120, "Grass", [
    { cost: ["Colorless"], name: "Fruity Aroma", effect: FRUITY_AROMA },
  ]),
  "mep-107": mon("mep-107", "Pikachu ex", 200, "Lightning", [
    { cost: ["Colorless"], name: "Pika-Pika Parade", effect: PIKA_PIKA_PARADE },
  ]),
  "me04-035": mon(
    "me04-035",
    "Mega Floette ex",
    310,
    "Psychic",
    [{ cost: ["Psychic"], name: "Gentle Light", effect: GENTLE_LIGHT }],
    { stage: "Stage1", evolveFrom: "Flabébé" },
  ),
  "30th-094": mon("30th-094", "Scraggy", 70, "Darkness", [
    { cost: ["Colorless"], name: "Nitpick", effect: NITPICK },
  ]),
  "me04-010": mon("me04-010", "Ho-Oh", 130, "Fire", [
    { cost: ["Fire"], name: "Flames of Revival", effect: FLAMES_OF_REVIVAL },
  ]),
  "30th-069": mon(
    "30th-069",
    "Espeon",
    110,
    "Psychic",
    [{ cost: ["Colorless"], name: "Miraculous Shine", effect: MIRACULOUS_SHINE }],
    { stage: "Stage1", evolveFrom: "Eevee" },
  ),
  "me02.5-053": mon(
    "me02.5-053",
    "Frosmoth",
    120,
    "Water",
    [{ cost: ["Colorless"], name: "Cold Cyclone", damage: 90, effect: COLD_CYCLONE }],
    { stage: "Stage1", evolveFrom: "Snom" },
  ),
  [FILLER]: mon(FILLER, "D615 Filler", 400, "Colorless", TAP),
  [BASIC]: mon(BASIC, "D615 Basic", 60, "Colorless", TAP),
  [STAGE1]: mon(STAGE1, "D615 Stage 1", 90, "Colorless", TAP, { stage: "Stage1", evolveFrom: "D615 Basic" }),
  [TRAINER]: itemTrainer(TRAINER),
  [W]: typedEnergy(W, "Water"),
  [R]: typedEnergy(R, "Fire"),
  [P]: typedEnergy(P, "Psychic"),
};
/** Ludicolo `sv09-037` off the LOCAL D1 (2026-10-09): Vibrant Dance's +40 HP to its own side — the
    seat-wide HP aura §8's KO-cause case needs. Off the deck and the pool: `relabel` puts it in. */
const AURA = "sv09-037";
const LUDICOLO: Card = battler(AURA, {
  name: "Ludicolo",
  stage: "Stage2",
  evolveFrom: "Lombre",
  hp: 140,
  retreat: 2,
  types: ["Water"],
  abilities: [
    {
      type: "Ability",
      name: "Vibrant Dance",
      effect: "All of your Pokémon in play get +40 HP. The effect of Vibrant Dance doesn't stack.",
    },
  ],
  attacks: [{ cost: ["Water", "Water", "Colorless"], name: "Hydro Splash", damage: 130 }],
});
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  "me05-008": 1,
  "me05-001": 1,
  "mep-107": 1,
  "me04-035": 1,
  "30th-094": 1,
  "me04-010": 1,
  "30th-069": 1,
  "me02.5-053": 1,
  [FILLER]: 10,
  [BASIC]: 8,
  [STAGE1]: 6,
  [TRAINER]: 4,
  "fix-unaware": 2,
  [W]: 4,
  [R]: 4,
  [P]: 4,
  "fix-energy": 10,
});
const BOARD_IDS = new Set([...Object.keys(LOCAL).filter((id) => id !== FILLER), "fix-unaware"]);

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own FIRST turn (P2 went first and passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6152, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
const topIds = (state: GameState, seat: Seat) => [
  ids(state, [state.players[seat].active?.stack.at(-1) ?? ""])[0],
  ...state.players[seat].bench.map((b) => ids(state, [b.stack.at(-1) ?? ""])[0]),
];

function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected a chooseCards park, got ${state.phase.kind}`);
  }
  return state.phase.prompt;
}
const answerCards = (state: GameState, uids: string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } } as GameAction);

describe("D615 §3 — Trick Portal and Fruity Aroma: the top window, Pokémon only", () => {
  it("Trick Portal: the Basic Pokémon in the top 9 are offered (D613); the picks are benched, the rest shuffled back", () => {
    let state = table("me05-008", [[R, 1]]);
    state = toDeckTop(toDeckTop(toDeckTop(state, "p1", P, 4), "p1", STAGE1, 1), "p1", BASIC, 2);
    const parked = mustApply(state, attack(0)).state;
    const prompt = cardsPrompt(parked);
    expect(ids(parked, prompt.candidates)).toEqual([BASIC, BASIC]);
    expect(prompt.min).toBe(0);
    const result = answerCards(parked, prompt.candidates);
    expect(topIds(result.state, "p1")).toEqual(["me05-008", BASIC, BASIC]);
    expect(of(result.events, "SHUFFLE").map((e) => e.seat)).toContain("p1");
  });

  it("Fruity Aroma: any Pokémon in the top 6 go to the HAND, revealed; a decline takes nothing", () => {
    let state = table("me05-001", [["fix-energy", 1]]);
    state = toDeckTop(toDeckTop(toDeckTop(state, "p1", P, 3), "p1", STAGE1, 1), "p1", BASIC, 1);
    const parked = mustApply(state, attack(0)).state;
    const prompt = cardsPrompt(parked);
    expect(ids(parked, prompt.candidates)).toEqual([BASIC, STAGE1]);
    const handBefore = parked.players.p1.hand.length;
    const result = answerCards(parked, [prompt.candidates[0] as string]);
    expect(result.state.players.p1.hand).toHaveLength(handBefore + 1);
    expect(ids(result.state, result.state.players.p1.hand)).toContain(BASIC);
    expect(result.state.players.p1.bench).toEqual([]);
    const declined = answerCards(parked, []);
    expect(declined.state.players.p1.hand).toHaveLength(handBefore);
  });
});

describe("D615 §4 — Pika-Pika Parade: any number of Basic Pokémon onto the Bench", () => {
  it("only Basic Pokémon are offered, and the take is clamped to the Bench space", () => {
    const state = table("mep-107", [["fix-energy", 1]], FILLER, [], [FILLER, FILLER]);
    const parked = mustApply(state, attack(0)).state;
    const prompt = cardsPrompt(parked);
    const offered = new Set(ids(parked, prompt.candidates));
    expect(offered.has(STAGE1)).toBe(false);
    expect(offered.has(TRAINER)).toBe(false);
    expect(offered.has(BASIC)).toBe(true);
    expect(prompt.max).toBe(3);
    const picks = prompt.candidates.filter((u) => parked.cardIdByUid[u] === BASIC).slice(0, 3);
    const result = answerCards(parked, picks);
    expect(result.state.players.p1.bench).toHaveLength(5);
    expect(of(result.events, "SHUFFLE").map((e) => e.seat)).toContain("p1");
  });
});

describe("D615 §5 — Gentle Light: 30 from every body on both sides", () => {
  it("both boards heal, Active and Bench, and an undamaged body files nothing", () => {
    let state = table("me04-035", [[P, 1]], FILLER, [FILLER], [FILLER]);
    state = setDamage(setDamage(state, "p1", 50), "p2", 20);
    state = setBenchDamage(setBenchDamage(state, "p1", 0, 10), "p2", 0, 0);
    const result = mustApply(state, attack(0));
    expect(result.state.players.p1.active?.damage).toBe(20);
    expect(result.state.players.p1.bench[0]?.damage).toBe(0);
    expect(result.state.players.p2.active?.damage).toBe(0);
    expect(result.state.players.p2.bench[0]?.damage).toBe(0);
    expect(of(result.events, "HEALED").map((e) => [e.seat, e.amount])).toEqual([
      ["p1", 30],
      ["p1", 10],
      ["p2", 20],
    ]);
  });

  // R-GLT1 is UNRULED (progress.md NEXT): this pins the reading as built, `healEachAll` asking no shield.
  // Picnic Basket is a Trainer and never meets an attack shield, so it is no precedent for this.
  it("R-GLT1: an effects shield on the opponent's body does not refuse the heal", () => {
    const state = setDamage(table("me04-035", [[P, 1]], "fix-unaware"), "p2", 40);
    const result = mustApply(state, attack(0));
    expect(result.state.players.p2.active?.damage).toBe(10);
    expect(of(result.events, "ATTACK_EFFECT_PREVENTED")).toEqual([]);
  });
});

describe("D615 §6 — Nitpick: the opponent's hand into their deck, then 4 cards", () => {
  it("the opponent shuffles and draws 4; the attacker's hand is untouched", () => {
    let state = table("30th-094", [["fix-energy", 1]]);
    state = handFromDeck(handFromDeck(state, "p2", TRAINER, 2), "p1", TRAINER, 1);
    const p2Total = state.players.p2.hand.length + state.players.p2.deck.length;
    const result = mustApply(state, attack(0));
    expect(of(result.events, "HAND_SHUFFLED_INTO_DECK").map((e) => [e.seat, e.count])).toEqual([["p2", 2]]);
    expect(result.state.players.p1.hand).toHaveLength(1);
    // The turn passes to p2 and they draw for it: 4 off Nitpick, 1 for the turn.
    expect(result.state.players.p2.hand.length + result.state.players.p2.deck.length).toBe(p2Total);
    expect(result.state.players.p2.hand.length).toBeGreaterThanOrEqual(4);
    const drawn = of(result.events, "CARDS_DRAWN").filter((e) => e.seat === "p2");
    expect(drawn.map((e) => [e.uids.length, e.reason])).toEqual([
      [4, "effect"],
      [1, "turnStart"],
    ]);
  });

  it("an empty opponent hand still draws 4", () => {
    const result = mustApply(table("30th-094", [["fix-energy", 1]]), attack(0));
    expect(of(result.events, "HAND_SHUFFLED_INTO_DECK").map((e) => [e.seat, e.count])).toEqual([["p2", 0]]);
    expect(of(result.events, "CARDS_DRAWN").filter((e) => e.seat === "p2")[0]?.uids).toHaveLength(4);
  });
});

describe("D615 §7 — Flames of Revival: up to 3 Basic Pokémon from the discard onto the Bench", () => {
  it("only the Basic Pokémon in the pile are offered, at most 3", () => {
    let state = table("me04-010", [[R, 1]]);
    state = discardFromDeck(discardFromDeck(discardFromDeck(state, "p1", BASIC, 4), "p1", STAGE1, 1), "p1", TRAINER, 1);
    const parked = mustApply(state, attack(0)).state;
    const prompt = cardsPrompt(parked);
    expect(ids(parked, prompt.candidates)).toEqual([BASIC, BASIC, BASIC, BASIC]);
    expect(prompt.max).toBe(3);
    const result = answerCards(parked, prompt.candidates.slice(0, 3));
    expect(topIds(result.state, "p1")).toEqual(["me04-010", BASIC, BASIC, BASIC]);
    expect(ids(result.state, result.state.players.p1.discard).filter((id) => id === BASIC)).toHaveLength(1);
  });

  it("an empty pile is a whiff: no prompt, nothing benched", () => {
    const result = mustApply(table("me04-010", [[R, 1]]), attack(0));
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(result.state.players.p1.bench).toEqual([]);
  });
});

describe("D615 §8 — Miraculous Shine: every evolved opponent body, the card into their hand", () => {
  const board = () => {
    let state = table("30th-069", [[P, 1]], BASIC, [BASIC, BASIC, FILLER]);
    state = evolveBySurgery(evolveBySurgery(state, "p2", "active", STAGE1), "p2", 1, STAGE1);
    return state;
  };

  it("both evolved bodies devolve; both Stage 1 cards land in p2's hand; no shuffle", () => {
    const state = board();
    const deckBefore = state.players.p2.deck;
    const result = mustApply(state, attack(0));
    expect(of(result.events, "POKEMON_DEVOLVED").map((e) => [e.seat, ids(result.state, [e.from])[0], e.zone])).toEqual([
      ["p2", STAGE1, "hand"],
      ["p2", STAGE1, "hand"],
    ]);
    expect(result.state.players.p2.active?.stack).toHaveLength(1);
    expect(result.state.players.p2.bench.map((b) => b.stack.length)).toEqual([1, 1, 1]);
    // p2 draws for the next turn, so the Stage 1 cards are counted in the hand, not the whole hand.
    expect(ids(result.state, result.state.players.p2.hand).filter((id) => id === STAGE1)).toHaveLength(2);
    expect(of(result.events, "SHUFFLE").filter((e) => e.seat === "p2")).toEqual([]);
    // p2's deck order is untouched but for the one card p2 draws for its turn.
    expect(result.state.players.p2.deck).toEqual(deckBefore.slice(1));
  });

  it("a shielded evolved body is skipped (§11), the rest still devolve", () => {
    let state = table("30th-069", [[P, 1]], BASIC, [BASIC]);
    state = evolveBySurgery(evolveBySurgery(state, "p2", "active", "fix-unaware"), "p2", 0, STAGE1);
    const result = mustApply(state, attack(0));
    expect(of(result.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    expect(result.state.players.p2.active?.stack).toHaveLength(2);
    expect(result.state.players.p2.bench[0]?.stack).toHaveLength(1);
  });

  it("devolving below the damage Knocks Out", () => {
    const state = setDamage(board(), "p2", 70);
    const result = mustApply(state, attack(0));
    expect(of(result.events, "KNOCKED_OUT").map((e) => [e.seat, ids(result.state, [e.uid])[0]])).toEqual([
      ["p2", BASIC],
    ]);
  });

  // 🛑 D615 review B1 — the KO cause is asked against the STARTING board, after the whole sweep, as in
  // `devolveEach`: the Ludicolo's devolve takes Vibrant Dance's +40 off the Stage 1 in EITHER order.
  /** TEST SURGERY — one `fix-energy` uid in `seat`'s deck re-bound to `card`, its face added to the pool. */
  const relabel = (state: GameState, seat: Seat, card: Card): GameState => {
    const uid = state.players[seat].deck.find((u) => state.cardIdByUid[u] === "fix-energy");
    if (uid === undefined) throw new Error(`${seat} deck has no fix-energy`);
    return {
      ...state,
      cardIdByUid: { ...state.cardIdByUid, [uid]: card.id },
      cardPool: { ...state.cardPool, [card.id]: card },
    };
  };
  const auraBoard = (ludicoloAt: number, stage1At: number, damage: number) => {
    let state = relabel(table("30th-069", [[P, 1]], FILLER, [BASIC, BASIC]), "p2", LUDICOLO);
    state = evolveBySurgery(evolveBySurgery(state, "p2", ludicoloAt, AURA), "p2", stage1At, STAGE1);
    return setBenchDamage(state, "p2", stage1At, damage);
  };

  it("an HP aura lost mid-sweep: the Knock Out is by the effect in either board order", () => {
    // Ludicolo first: the Stage 1 (90 + 40, 100 damage) is already lethal when its own turn comes.
    // Stage 1 first: it survives its own devolve (60 + 40, 70 damage) and dies when the aura goes.
    for (const [ludicoloAt, stage1At, damage] of [
      [0, 1, 100],
      [1, 0, 70],
    ] as const) {
      const before = auraBoard(ludicoloAt, stage1At, damage);
      const result = mustApply(before, attack(0));
      expect(of(result.events, "POKEMON_DEVOLVED")).toHaveLength(2);
      expect(of(result.events, "KNOCKED_OUT").map((e) => [e.seat, ids(result.state, [e.uid])[0]])).toEqual([
        ["p2", BASIC],
      ]);
      expect(result.state.lastKoMarks.p2.map((m) => m.byAttack)).toEqual([false]);
    }
  });

  it("the attacker's own evolved body is not touched", () => {
    let state = table("30th-069", [[P, 1]], BASIC, [], [BASIC]);
    state = evolveBySurgery(state, "p1", 0, STAGE1);
    const result = mustApply(state, attack(0));
    expect(of(result.events, "POKEMON_DEVOLVED")).toEqual([]);
    expect(result.state.players.p1.bench[0]?.stack).toHaveLength(2);
  });
});

describe("D615 §9 — Cold Cyclone: a {W} Energy from this Pokémon to a Benched Pokémon", () => {
  it("only the Water Energy is movable, onto the chosen Benched body", () => {
    const state = table("me02.5-053", [[W, 1], [R, 1]], FILLER, [], [FILLER, BASIC]);
    const parked = mustApply(state, attack(0)).state;
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "moveEnergy") {
      throw new Error(`expected a moveEnergy park, got ${parked.phase.kind}`);
    }
    const prompt = parked.phase.prompt;
    expect(ids(parked, prompt.movable.map((m) => m.uid))).toEqual([W]);
    expect(prompt.max).toBe(1);
    // D615 review M1 — the family's recorded approximation (D443, `moveFloor`): the printed "Move a {W}
    // Energy" is offered DECLINABLE — no `min` — like every non-"all" `moveEnergy` max.
    expect(prompt.min).toBeUndefined();
    const pick = prompt.movable[0]?.uid as string;
    const result = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: pick, dest: { seat: "p1", spot: { spot: "bench", index: 1 } } }] },
    } as GameAction);
    expect(ids(result.state, result.state.players.p1.bench[1]?.energy ?? [])).toEqual([W]);
    expect(ids(result.state, result.state.players.p1.active?.energy ?? [])).toEqual([R]);
    expect(result.state.players.p2.active?.damage).toBe(90);
  });

  it("no Water Energy attached: nothing to move, the damage still lands", () => {
    const state = table("me02.5-053", [[R, 1]], FILLER, [], [FILLER]);
    const result = mustApply(state, attack(0));
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(result.state.players.p1.bench[0]?.energy).toEqual([]);
    expect(result.state.players.p2.active?.damage).toBe(90);
  });
});

describe("D615 §10 — the version", () => {
  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.528.0");
  });
});
