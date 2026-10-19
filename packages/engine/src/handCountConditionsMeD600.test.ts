import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import type { BoardCondition } from "./effects";
import { deriveAttackDamageBonus, deriveAttackDamageMultiplier, deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  battler,
  clearBench,
  deckOf,
  discardFromDeck,
  handFromDeck,
  itemTrainer,
  mustApply,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D600 — WP14 + WP33b: THE HAND COUNT AND FIVE BONUS CONDITIONS ─────────────────────────
//
// 7 printed attack texts / 12 `me` printings. WP14: `DamageCountSource.cardsInYourHand` — Galarian
// Meowth "Treasure Rush" ×2 on the `×` fold, Alakazam "Powerful Hand" ×3 as `damageActive.per`.
// WP33b: five `CONDITIONAL_DAMAGE_CLAUSES` literal rows on five new `BoardCondition` members — Weavile
// (remaining HP), Carnivine (no Retreat Cost), Serperior ×2 (Rosa's Encouragement in your discard),
// Sableye (Stage 2 {D} on your Bench), Zarude ×2 (Shadowy {D} Energy on your Bench). Every id and
// text off the LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-08, `legal_standard = 1`;
// no id was referenced in the tree before this slice. Gholdengo "Celebration" ×2 stays dropped. [🆕🆕🆕 D640 (D539): BUILT at D640.]

const POWERFUL_HAND = "Place 2 damage counters on your opponent's Active Pokémon for each card in your hand.";
const TREASURE_RUSH = "This attack does 10 damage for each card in your hand.";
const RETALIATORY_CLAW = "If this Pokémon's remaining HP is 50 or less, this attack does 170 more damage.";
const CHOMP_WHOLE = "If your opponent's Active Pokémon has no Retreat Cost, this attack does 80 more damage.";
const SOLAR_COILING = "If Rosa's Encouragement is in your discard pile, this attack does 150 more damage.";
const COCKY_CLAW = "If you have any Stage 2 {D} Pokémon on your Bench, this attack does 70 more damage.";
const SHADOWY_WHIP = "If your Benched Pokémon have any Shadowy {D} Energy attached, this attack does 70 more damage.";
const CELEBRATION =
  "If you have exactly 30 cards in your hand, take 2 Prize cards. If you do, shuffle your hand into your deck.";

/** [attack text, the `me` printing ids that print it]. */
const SENTENCES: readonly (readonly [string, readonly string[]])[] = [
  [POWERFUL_HAND, ["me01-056", "mep-003", "mep-009"]],
  [TREASURE_RUSH, ["30th-101", "30th-141"]],
  [RETALIATORY_CLAW, ["mep-021"]],
  [CHOMP_WHOLE, ["me04-004"]],
  [SOLAR_COILING, ["mep-064", "me03-006"]],
  [COCKY_CLAW, ["me02-059"]],
  [SHADOWY_WHIP, ["mep-088", "me05-056"]],
];

describe("D600 §1 — the texts: 7 attack sentences / 12 printings", () => {
  it("each is a row of the committed `me` corpus at its printing count, none printed in legal `sv`, each now read", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, ids] of SENTENCES) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
    }
    expect(SENTENCES.flatMap(([, ids]) => ids)).toHaveLength(12);
  });

  it("the near misses stay unbuilt: every row is a literal, and Celebration stays dropped (🆕🆕🆕 D640 (D539): Celebration is built since D640)", () => {
    for (const near of [
      "This attack does 10 more damage for each card in your hand.",
      "Place 2 damage counters on 1 of your opponent's Pokémon for each card in your hand.",
      "If this Pokémon's remaining HP is 60 or less, this attack does 170 more damage.",
      "If your opponent's Active Pokémon has no Weakness, this attack does 80 more damage.",
      "If Rosa's Encouragement is in your opponent's discard pile, this attack does 150 more damage.",
      "If you have any Stage 1 {D} Pokémon on your Bench, this attack does 70 more damage.",
      "If your Benched Pokémon have any Shadowy {P} Energy attached, this attack does 70 more damage.",
    ]) {
      expect(resolvedByAnyReader(near), near).toBe(false);
    }
    expect(resolvedByAnyReader(CELEBRATION)).toBe(true); // 🆕🆕🆕 D640 — inverted: built
    expect(meAttackCorpus().find(([, text]) => text === CELEBRATION)?.[0]).toBe(2);
  });
});

describe("D600 §2 — the readings", () => {
  const bonus = (text: string) => {
    const read = deriveAttackDamageBonus(text);
    return read?.count.kind === "boardCondition" ? [read.per, read.count.cond] : read;
  };

  it("WP14: the fold and the per-card put", () => {
    expect(deriveAttackDamageMultiplier(TREASURE_RUSH)).toEqual({ per: 10, count: { kind: "cardsInYourHand" } });
    expect(deriveAttackEffect(POWERFUL_HAND)).toEqual([
      { op: "damageActive", amount: 20, source: "attack", per: { kind: "cardsInYourHand" } },
    ]);
    // The printed-zero guard on both anchors.
    expect(deriveAttackDamageMultiplier("This attack does 0 damage for each card in your hand.")).toBeNull();
    expect(
      deriveAttackEffect("Place 0 damage counters on your opponent's Active Pokémon for each card in your hand."),
    ).toBeNull();
    // The bare put is unchanged: no `per` key at all.
    expect(deriveAttackEffect("Place 3 damage counters on your opponent's Active Pokémon.")).toEqual([
      { op: "damageActive", amount: 30, source: "attack" },
    ]);
  });

  it("WP33b: the five bonus rows", () => {
    expect(bonus(RETALIATORY_CLAW)).toEqual([170, { kind: "yourActiveRemainingHpAtMost", hp: 50 }]);
    expect(bonus(CHOMP_WHOLE)).toEqual([80, { kind: "opponentActiveNoRetreatCost" }]);
    expect(bonus(SOLAR_COILING)).toEqual([150, { kind: "yourDiscardHasNamed", name: "Rosa's Encouragement" }]);
    expect(bonus(COCKY_CLAW)).toEqual([70, { kind: "yourBenchHasStage2OfType", type: "Darkness" }]);
    expect(bonus(SHADOWY_WHIP)).toEqual([
      70,
      { kind: "yourBenchHasNamedEnergyAttached", name: "Shadowy Darkness Energy" },
    ]);
  });

  it("the five notes", () => {
    const notes: [BoardCondition, string][] = [
      [{ kind: "yourActiveRemainingHpAtMost", hp: 50 }, "your Active Pokémon's remaining HP is 50 or less"],
      [{ kind: "opponentActiveNoRetreatCost" }, "your opponent's Active Pokémon has no Retreat Cost"],
      [{ kind: "yourDiscardHasNamed", name: "Rosa's Encouragement" }, "Rosa's Encouragement is in your discard pile"],
      [{ kind: "yourBenchHasStage2OfType", type: "Darkness" }, "you have any Stage 2 Darkness Pokémon on your Bench"],
      [
        { kind: "yourBenchHasNamedEnergyAttached", name: "Shadowy Darkness Energy" },
        "your Benched Pokémon have any Shadowy Darkness Energy attached",
      ],
    ];
    for (const [cond, note] of notes) expect(conditionNote(cond)).toBe(note);
  });
});

// ── ON A BOARD ──

const FILLER = "d600-filler";
/** A constructed attacker printing the BARE put (arm 22), for §3's no-`per` board. */
const PUTTER = "d600-putter";
const FREE = "d600-free-retreat";
const WEAK_P = "d600-weak-psychic";
const STAGE2_D = "d600-stage2-dark";
const STAGE1_D = "d600-stage1-dark";
const STAGE2_G = "d600-stage2-grass";
const ROSA = "me03-084";
const SHADOWY = "me05-083";
const D = "d600-darkness";
const P = "d600-psychic";
const G = "d600-grass";
const M = "d600-metal";

const mon = (id: string, name: string, hp: number, type: string, attacks: Card["attacks"], extra: Partial<Card> = {}) =>
  battler(id, { name, hp, types: [type], retreat: 2, attacks, ...extra });
const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];

const LOCAL: Record<string, Card> = {
  "me01-056": mon(
    "me01-056",
    "Alakazam",
    140,
    "Psychic",
    [{ cost: ["Psychic"], name: "Powerful Hand", effect: POWERFUL_HAND }],
    { stage: "Stage2", evolveFrom: "Kadabra" },
  ),
  "30th-101": mon("30th-101", "Galarian Meowth", 70, "Metal", [
    { cost: ["Colorless"], name: "Pay Day", damage: 10, effect: "Draw a card." },
    { cost: ["Metal"], name: "Treasure Rush", damage: "10×", effect: TREASURE_RUSH },
  ]),
  "mep-021": mon(
    "mep-021",
    "Weavile",
    90,
    "Darkness",
    [
      { cost: ["Darkness", "Darkness"], name: "Retaliatory Claw", damage: "20+", effect: RETALIATORY_CLAW },
      { cost: ["Darkness", "Darkness"], name: "Cut", damage: 60 },
    ],
    { stage: "Stage1", evolveFrom: "Sneasel" },
  ),
  "me04-004": mon("me04-004", "Carnivine", 110, "Grass", [
    { cost: ["Colorless", "Colorless", "Colorless"], name: "Chomp Whole", damage: "80+", effect: CHOMP_WHOLE },
  ]),
  "mep-064": mon(
    "mep-064",
    "Serperior",
    160,
    "Grass",
    [
      { cost: ["Grass"], name: "Regal Command", damage: "20×", effect: "This attack does 20 damage for each of your Pokémon in play." },
      { cost: ["Grass", "Grass", "Grass"], name: "Solar Coiling", damage: "100+", effect: SOLAR_COILING },
    ],
    { stage: "Stage2", evolveFrom: "Servine" },
  ),
  "me02-059": mon("me02-059", "Sableye", 80, "Darkness", [
    { cost: ["Darkness"], name: "Cocky Claw", damage: "20+", effect: COCKY_CLAW },
  ]),
  "mep-088": mon("mep-088", "Zarude", 130, "Darkness", [
    {
      cost: ["Darkness"],
      name: "Overhead Throw",
      damage: 30,
      effect:
        "This attack also does 30 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    },
    { cost: ["Darkness", "Darkness", "Darkness"], name: "Shadowy Whip", damage: "100+", effect: SHADOWY_WHIP },
  ]),
  [FILLER]: mon(FILLER, "D600 Filler", 400, "Colorless", TAP),
  [PUTTER]: mon(PUTTER, "D600 Putter", 100, "Psychic", [
    { cost: ["Psychic"], name: "Put", effect: "Place 3 damage counters on your opponent's Active Pokémon." },
  ]),
  [FREE]: mon(FREE, "D600 Free Retreat", 400, "Colorless", TAP, { retreat: 0 }),
  [WEAK_P]: mon(WEAK_P, "D600 Weak P", 400, "Colorless", TAP, { weaknesses: [{ type: "Psychic", value: "×2" }] }),
  [STAGE2_D]: mon(STAGE2_D, "D600 Stage 2 Dark", 160, "Darkness", TAP, { stage: "Stage2", evolveFrom: "X" }),
  [STAGE1_D]: mon(STAGE1_D, "D600 Stage 1 Dark", 120, "Darkness", TAP, { stage: "Stage1", evolveFrom: "Y" }),
  [STAGE2_G]: mon(STAGE2_G, "D600 Stage 2 Grass", 160, "Grass", TAP, { stage: "Stage2", evolveFrom: "Z" }),
  [ROSA]: { ...itemTrainer(ROSA), name: "Rosa's Encouragement", trainerType: "Supporter" },
  [SHADOWY]: { ...typedEnergy(SHADOWY, "Darkness"), name: "Shadowy Darkness Energy", energyType: "Special" },
  [D]: typedEnergy(D, "Darkness"),
  [P]: typedEnergy(P, "Psychic"),
  [G]: typedEnergy(G, "Grass"),
  [M]: typedEnergy(M, "Metal"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  "me01-056": 1,
  "30th-101": 1,
  "mep-021": 1,
  "me04-004": 1,
  "mep-064": 1,
  "me02-059": 1,
  "mep-088": 1,
  [FILLER]: 28,
  [FREE]: 1,
  [PUTTER]: 1,
  [WEAK_P]: 1,
  [STAGE2_D]: 1,
  [STAGE1_D]: 1,
  [STAGE2_G]: 1,
  [ROSA]: 1,
  [SHADOWY]: 1,
  [D]: 6,
  [P]: 2,
  [G]: 4,
  [M]: 2,
  "fix-energy": 3,
});
const BOARD_IDS = Object.keys(LOCAL).filter((id) => id !== FILLER);

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own FIRST turn (P2 went first and passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6000, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** TEST SURGERY — every Prize whose id is a board id (Filler aside) swapped with a non-board deck card. */
function unprize(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  const kept = new Set(BOARD_IDS);
  let deck = [...side.deck];
  const prizes = side.prizes.map((u) => {
    if (!kept.has(state.cardIdByUid[u] ?? "")) return u;
    const swap = deck.find((d) => !kept.has(state.cardIdByUid[d] ?? ""));
    if (swap === undefined) throw new Error("no swap card");
    deck = [...deck.filter((d) => d !== swap), u];
    return swap;
  });
  return { ...state, players: { ...state.players, [seat]: { ...side, prizes, deck } } };
}

/** P1's Active is `attacker` with `energy` attached; P2's Active is `defender`. Both Benches empty. */
function table(attacker: string, energy: readonly (readonly [string, number])[], defender = FILLER): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const) state = unprize(clearBench(setActiveFromDeck(state, s, FILLER), s), s);
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  for (const [id, n] of energy) state = attachFromDeck(state, "p1", id, n);
  return clearBench(setActiveFromDeck(state, "p2", defender), "p2");
}

type Active = NonNullable<GameState["players"]["p1"]["active"]>;
function withActive(state: GameState, seat: Seat, edit: (a: Active) => Active): GameState {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`no ${seat} Active`);
  return { ...state, players: { ...state.players, [seat]: { ...state.players[seat], active: edit(active) } } };
}
/** TEST SURGERY — attach `count` copies of `cardId` from the seat's deck to its LAST benched body. */
function attachToBench(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  const last = side.bench.length - 1;
  if (uid === undefined || last < 0) throw new Error(`cannot attach ${cardId}`);
  const bench = side.bench.map((b, i) => (i === last ? { ...b, energy: [...b.energy, uid] } : b));
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, deck: side.deck.filter((u) => u !== uid), bench } },
  };
}

const attack = (index: number, seat: Seat = "p1"): GameAction => ({ type: "attack", seat, index });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const dealt = (state: GameState, index: number) => of(mustApply(state, attack(index)).events, "DAMAGE_DEALT")[0]?.dealt;

describe("D600 §3 — Powerful Hand: 2 counters on the opponent's Active per card in YOUR hand", () => {
  const hand = (n: number, defender = FILLER) => handFromDeck(table("me01-056", [[P, 1]], defender), "p1", FILLER, n);

  it("3 cards: 6 counters placed (60 HP), no DAMAGE_DEALT; 1 card: 20", () => {
    const three = mustApply(hand(3), attack(0));
    expect(of(three.events, "COUNTERS_PLACED").map((e) => e.amount)).toEqual([60]);
    expect(of(three.events, "DAMAGE_DEALT")).toEqual([]);
    expect(three.state.players.p2.active?.damage).toBe(60);
    expect(mustApply(hand(1), attack(0)).state.players.p2.active?.damage).toBe(20);
  });

  it("an empty hand places nothing", () => {
    const empty = mustApply(hand(0), attack(0));
    expect(of(empty.events, "COUNTERS_PLACED")).toEqual([]);
    expect(empty.state.players.p2.active?.damage).toBe(0);
  });

  it("the bare put (no `per`) ignores the hand: 3 counters with 4 cards in hand", () => {
    const bare = handFromDeck(table(PUTTER, [[P, 1]]), "p1", FILLER, 4);
    expect(mustApply(bare, attack(0)).state.players.p2.active?.damage).toBe(30);
  });

  it("the OPPONENT's hand is not counted, and Weakness does not apply to placed counters", () => {
    const theirs = handFromDeck(hand(1), "p2", FILLER, 4);
    expect(mustApply(theirs, attack(0)).state.players.p2.active?.damage).toBe(20);
    expect(mustApply(hand(2, WEAK_P), attack(0)).state.players.p2.active?.damage).toBe(40);
  });
});

describe("D600 §4 — Treasure Rush: 10 damage per card in YOUR hand", () => {
  const hand = (n: number) => handFromDeck(table("30th-101", [[M, 1]]), "p1", FILLER, n);

  it("4 cards: 40; 1 card: 10; an empty hand: no DAMAGE_DEALT", () => {
    expect(dealt(hand(4), 1)).toBe(40);
    expect(dealt(hand(1), 1)).toBe(10);
    expect(of(mustApply(hand(0), attack(1)).events, "DAMAGE_DEALT")).toEqual([]);
  });

  it("the opponent's hand is not counted", () => {
    expect(dealt(handFromDeck(hand(2), "p2", FILLER, 5), 1)).toBe(20);
  });
});

describe("D600 §5 — Retaliatory Claw: +170 at 50 or less remaining HP", () => {
  const claw = (damage: number) => withActive(table("mep-021", [[D, 2]]), "p1", (a) => ({ ...a, damage }));

  it("90 HP: 40 damage (50 left) → 190; 30 damage (60 left) → 20", () => {
    expect(dealt(claw(40), 0)).toBe(190);
    expect(dealt(claw(80), 0)).toBe(190);
    expect(dealt(claw(30), 0)).toBe(20);
    expect(dealt(claw(0), 0)).toBe(20);
  });

  it("the member reads the CALLER's Active", () => {
    const cond = { kind: "yourActiveRemainingHpAtMost", hp: 50 } as const;
    const state = table("mep-021", [[D, 2]]);
    expect(conditionHolds(state, "p1", cond)).toBe(false);
    expect(conditionHolds(withActive(state, "p1", (a) => ({ ...a, damage: 40 })), "p1", cond)).toBe(true);
    // P2's Active is a 400-HP Filler: 350 left even at 50 damage.
    expect(conditionHolds(withActive(state, "p2", (a) => ({ ...a, damage: 50 })), "p2", cond)).toBe(false);
  });
});

describe("D600 §6 — Chomp Whole: +80 when the opponent's Active has no Retreat Cost", () => {
  it("a free-retreat defender: 160; a Retreat Cost of 2: 80", () => {
    expect(dealt(table("me04-004", [[G, 3]], FREE), 0)).toBe(160);
    expect(dealt(table("me04-004", [[G, 3]]), 0)).toBe(80);
  });

  it("reads the OPPONENT's Active, not the attacker's", () => {
    const cond = { kind: "opponentActiveNoRetreatCost" } as const;
    const state = table(FREE, [], FILLER);
    expect(conditionHolds(state, "p1", cond)).toBe(false);
    expect(conditionHolds(state, "p2", cond)).toBe(true);
  });
});

describe("D600 §7 — Solar Coiling: +150 with Rosa's Encouragement in YOUR discard pile", () => {
  const coil = () => table("mep-064", [[G, 3]]);

  it("in your discard: 250; nowhere: 100; in the opponent's discard only: 100", () => {
    expect(dealt(discardFromDeck(coil(), "p1", ROSA, 1), 1)).toBe(250);
    expect(dealt(coil(), 1)).toBe(100);
    expect(dealt(discardFromDeck(coil(), "p2", ROSA, 1), 1)).toBe(100);
  });

  it("another card in your discard does not satisfy it", () => {
    expect(dealt(discardFromDeck(coil(), "p1", FILLER, 2), 1)).toBe(100);
  });
});

describe("D600 §8 — Cocky Claw: +70 with a Stage 2 {D} Pokémon on your Bench", () => {
  const claw = (benched: string, seat: Seat = "p1") => benchFromDeck(table("me02-059", [[D, 1]]), seat, benched);

  it("a Benched Stage 2 {D}: 90; a Stage 1 {D}: 20; a Stage 2 {G}: 20", () => {
    expect(dealt(claw(STAGE2_D), 0)).toBe(90);
    expect(dealt(claw(STAGE1_D), 0)).toBe(20);
    expect(dealt(claw(STAGE2_G), 0)).toBe(20);
  });

  it("the opponent's Bench does not count, nor an empty Bench", () => {
    expect(dealt(claw(STAGE2_D, "p2"), 0)).toBe(20);
    expect(dealt(table("me02-059", [[D, 1]]), 0)).toBe(20);
  });
});

describe("D600 §9 — Shadowy Whip: +70 with Shadowy {D} Energy on one of your Benched Pokémon", () => {
  const whip = () => benchFromDeck(table("mep-088", [[D, 3]]), "p1", FILLER);

  it("Shadowy Darkness Energy on a Benched Pokémon: 170; a basic {D} there: 100; nothing: 100", () => {
    expect(dealt(attachToBench(whip(), "p1", SHADOWY), 1)).toBe(170);
    expect(dealt(attachToBench(whip(), "p1", D), 1)).toBe(100);
    expect(dealt(whip(), 1)).toBe(100);
  });

  it("on the attacking Active, or on the opponent's Bench: 100", () => {
    expect(dealt(attachFromDeck(whip(), "p1", SHADOWY, 1), 1)).toBe(100);
    expect(dealt(attachToBench(benchFromDeck(whip(), "p2", FILLER), "p2", SHADOWY), 1)).toBe(100);
  });
});

describe("D600 §10 — the version", () => {
  it("is built at engine 0.551.0", () => {
    expect(engineVersion).toBe("0.551.0");
  });
});
