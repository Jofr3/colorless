import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { disabledAbilityUids, passivesOf } from "./continuous";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageSuppression,
  deriveAttackRequirement,
  splitAttackRequirementClause,
} from "./effects";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { conditionHolds, conditionNote, evolveEarlyLicensed } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  battler,
  clearBench,
  deckOf,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D594 — WP33a: BONUS / REQUIREMENT ROWS ON SHIPPED CONDITION MEMBERS ──
//
// 6 printed texts / 10 `me` printings. Four attack clause rows on shipped members — Chi-Yu
// (`yourActiveDamageCountersAtLeast`, with D494's Weakness-only rider), Steelix (`yourPrizesRemaining`),
// Slowbro ×3 (`yourHandExactly` 0) and Solrock ×2 (`yourBenchHasNamed`, a "does nothing" row with
// Sawk's W/R companion) — plus two Ability keys on shipped passive fields: Luxio "Fighting Roar"
// (`evolveEarlyExempt` with the new `ifCondition` rider) and Chesnaught "Needly Armor"
// (`damageAttacker` with `perAttachedEnergy`). Every id and text off the LOCAL D1
// (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-08, `legal_standard = 1`; no id was referenced in
// the tree before this slice. No `me` row is a fixture, so the printed bytes are carried HERE.

const WHIRLING_ENVY =
  "If this Pokémon has 2 or more damage counters on it, this attack does 90 more damage. This attack's damage isn't affected by Weakness.";
const COSMIC_BEAM =
  "If you don't have Lunatone on your Bench, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance.";
const WELCOMING_TAIL = "If you have exactly 6 Prize cards remaining, this attack does 200 more damage.";
const ALL_OUT = "If you have no cards in your hand, this attack does 160 more damage.";
const FIGHTING_ROAR =
  "If your opponent's Active Pokémon is a Pokémon ex, this Pokémon can evolve during your first turn or the turn you play it.";
const NEEDLY_ARMOR =
  "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 3 damage counters on the Attacking Pokémon for each {G} Energy attached to this Pokémon.";

/** [attack text, the `me` printing ids that print it]. */
const SENTENCES: readonly (readonly [string, readonly string[]])[] = [
  [WHIRLING_ENVY, ["me05-059"]],
  [COSMIC_BEAM, ["me01-075", "me02.5-106"]],
  [WELCOMING_TAIL, ["me01-093", "me01-150"]],
  [ALL_OUT, ["mep-083", "me05-030", "me05-090"]],
];

describe("D594 §1 — the texts: 4 attack sentences / 8 printings, 2 Abilities / 2 printings", () => {
  it("each attack sentence is a row of the committed `me` corpus at its printing count, and none is printed in legal `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, ids] of SENTENCES) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
    }
    expect(SENTENCES.flatMap(([, ids]) => ids)).toHaveLength(8);
  });

  it("the near misses stay unbuilt: every row is a literal", () => {
    for (const near of [
      "If this Pokémon has 3 or more damage counters on it, this attack does 90 more damage. This attack's damage isn't affected by Weakness.",
      "If you don't have Solrock on your Bench, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance.",
      "If you have exactly 5 Prize cards remaining, this attack does 200 more damage.",
      "If your opponent has no cards in their hand, this attack does 160 more damage.",
    ]) {
      expect(resolvedByAnyReader(near), near).toBe(false);
    }
    // WP33a's two dropped texts (see decisions.md D594): no shipped member reads either.
    // [🆕🆕🆕 D600 (D539): WITHDRAWN, kept as written — WP33b builds both on two new members
    // (`yourActiveRemainingHpAtMost`, `opponentActiveNoRetreatCost`; handCountConditionsMeD600).]
    for (const dropped of [
      "If this Pokémon's remaining HP is 50 or less, this attack does 170 more damage.",
      "If your opponent's Active Pokémon has no Retreat Cost, this attack does 80 more damage.",
    ]) {
      expect(resolvedByAnyReader(dropped), dropped).toBe(true);
    }
  });
});

describe("D594 §2 — the readings: shipped members at the printed parameters", () => {
  const bonus = (text: string) => {
    const read = deriveAttackDamageBonus(text);
    return read?.count.kind === "boardCondition" ? [read.per, read.count.cond] : read;
  };

  it("the three bonus rows", () => {
    expect(bonus(WHIRLING_ENVY)).toEqual([90, { kind: "yourActiveDamageCountersAtLeast", count: 2 }]);
    expect(bonus(WELCOMING_TAIL)).toEqual([200, { kind: "yourPrizesRemaining", counts: [6] }]);
    expect(bonus(ALL_OUT)).toEqual([160, { kind: "yourHandExactly", count: 0 }]);
  });

  it("Whirling Envy's rider is Weakness ONLY; Cosmic Beam's companion is Weakness AND Resistance", () => {
    expect(deriveAttackDamageSuppression(WHIRLING_ENVY)).toEqual({ weakness: true });
    expect(deriveAttackRequirement(COSMIC_BEAM)).toEqual({ kind: "yourBenchHasNamed", name: "Lunatone" });
    expect(splitAttackRequirementClause(COSMIC_BEAM)).toEqual({
      clause: "If you don't have Lunatone on your Bench, this attack does nothing.",
      body: "This attack's damage isn't affected by Weakness or Resistance.",
    });
  });

  it("`yourHandExactly` 0 reads as the printed \"no cards\"; 1 and 7 are unchanged", () => {
    expect(conditionNote({ kind: "yourHandExactly", count: 0 })).toBe("you have no cards in your hand");
    expect(conditionNote({ kind: "yourHandExactly", count: 1 })).toBe("you have exactly 1 card in your hand");
    expect(conditionNote({ kind: "yourHandExactly", count: 7 })).toBe("you have exactly 7 cards in your hand");
  });

  it("the two Ability keys: shipped fields at the printed parameters", () => {
    expect(programFor("me03-027")).toEqual({
      passive: { evolveEarlyExempt: { ifCondition: { kind: "opponentActiveIsEx" } } },
    });
    expect(programFor("me04-007")).toEqual({
      passive: { damageAttacker: { amount: 30, perAttachedEnergy: "Grass" } },
    });
    // Fighting Roar prints no "Active Spot" clause, so no zone gate: driven on a BENCHED Luxio
    // in §7 (and by the `D594-roar-active-only` mutant). Needly Armor's per-{G} count: §8.
  });
});

// ── ON A BOARD ──

const FILLER = "d594-filler";
const FOE_EX = "d594-foe-ex";
const WEAK_D = "d594-weak-dark";
const RESIST_D = "d594-resist-dark";
const WEAK_F = "d594-weak-fighting";
const RESIST_F = "d594-resist-fighting";
const LUNATONE = "d594-lunatone";
const LUXRAY = "d594-luxray";
const SHINX = "d594-shinx";
/** A {C} attacker printing a legal bench spread (`censusAttackCorpus.ts`), for §8's benched Chesnaught. */
const SPREADER = "d594-spreader";
const SPREAD =
  "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** Flutter Mane — "Midnight Fluttering" (registry `MIDNIGHT_FLUTTERING`): the opposing Active has no Abilities. */
const FLUTTER = "sv05-078";
/** Ting-Lu ex (FIXTURE_POOL) — "Cursed Land": the opponent's damaged non-ex Pokémon have no Abilities. An ex. */
const TING_LU = "sv02-127";
const D = "d594-darkness";
const F = "d594-fighting";
const P = "d594-psychic";
const G = "d594-grass";
const LT = "d594-lightning";
/** Never on a board: the Prize swap's stock. */
const SPARE = "d594-spare";

const mon = (id: string, name: string, hp: number, type: string, attacks: Card["attacks"], extra: Partial<Card> = {}) =>
  battler(id, { name, hp, types: [type], retreat: 2, attacks, ...extra });
const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];

const LOCAL: Record<string, Card> = {
  "me05-059": mon("me05-059", "Chi-Yu", 90, "Darkness", [
    { cost: ["Darkness"], name: "Whirling Envy", damage: "20+", effect: WHIRLING_ENVY },
  ]),
  "me01-075": mon("me01-075", "Solrock", 110, "Fighting", [
    { cost: ["Fighting"], name: "Cosmic Beam", damage: 70, effect: COSMIC_BEAM },
  ]),
  "me01-093": mon(
    "me01-093",
    "Steelix",
    200,
    "Metal",
    [
      { cost: ["Colorless", "Colorless"], name: "Welcoming Tail", damage: "40+", effect: WELCOMING_TAIL },
      { cost: ["Metal", "Metal", "Colorless", "Colorless"], name: "Skull Bash", damage: 140 },
    ],
    { stage: "Stage1", evolveFrom: "Onix" },
  ),
  "mep-083": mon(
    "mep-083",
    "Slowbro",
    130,
    "Psychic",
    [
      { cost: ["Psychic"], name: "All Out", damage: "50+", effect: ALL_OUT },
      { cost: ["Colorless", "Colorless", "Colorless"], name: "Zen Headbutt", damage: 110 },
    ],
    { stage: "Stage1", evolveFrom: "Slowpoke" },
  ),
  "me03-027": mon(
    "me03-027",
    "Luxio",
    90,
    "Lightning",
    [{ cost: ["Lightning", "Colorless"], name: "Static Shock", damage: 40 }],
    {
      stage: "Stage1",
      evolveFrom: "Shinx",
      abilities: [{ type: "Ability", name: "Fighting Roar", effect: FIGHTING_ROAR }],
    } as Partial<Card>,
  ),
  "me04-007": mon(
    "me04-007",
    "Chesnaught",
    180,
    "Grass",
    [
      {
        cost: ["Grass", "Grass", "Colorless"],
        name: "Impound",
        damage: 160,
        effect: "During your opponent's next turn, the Defending Pokémon can't retreat.",
      },
    ],
    {
      stage: "Stage2",
      evolveFrom: "Quilladin",
      abilities: [{ type: "Ability", name: "Needly Armor", effect: NEEDLY_ARMOR }],
    } as Partial<Card>,
  ),
  [FILLER]: mon(FILLER, "D594 Filler", 400, "Colorless", TAP),
  [FOE_EX]: mon(FOE_EX, "D594 Foe ex", 400, "Colorless", TAP),
  [WEAK_D]: mon(WEAK_D, "D594 Weak D", 400, "Colorless", TAP, { weaknesses: [{ type: "Darkness", value: "×2" }] }),
  [RESIST_D]: mon(RESIST_D, "D594 Resist D", 400, "Colorless", TAP, { resistances: [{ type: "Darkness", value: "-30" }] }),
  [WEAK_F]: mon(WEAK_F, "D594 Weak F", 400, "Colorless", TAP, { weaknesses: [{ type: "Fighting", value: "×2" }] }),
  [RESIST_F]: mon(RESIST_F, "D594 Resist F", 400, "Colorless", TAP, { resistances: [{ type: "Fighting", value: "-30" }] }),
  [LUNATONE]: mon(LUNATONE, "Lunatone", 110, "Fighting", TAP),
  [LUXRAY]: mon(LUXRAY, "Luxray", 160, "Lightning", TAP, { stage: "Stage2", evolveFrom: "Luxio" }),
  [SHINX]: mon(SHINX, "Shinx", 60, "Lightning", TAP),
  [SPREADER]: mon(SPREADER, "D594 Spreader", 400, "Colorless", [
    { cost: ["Colorless"], name: "Spread", damage: 10, effect: SPREAD },
  ]),
  // The lock is keyed by id; the attack is a stand-in (Hex Hurl's counters are not under test here).
  [FLUTTER]: mon(FLUTTER, "Flutter Mane", 90, "Psychic", TAP, {
    abilities: [{ type: "Ability", name: "Midnight Fluttering", effect: "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering." }],
  } as Partial<Card>),
  [D]: typedEnergy(D, "Darkness"),
  [F]: typedEnergy(F, "Fighting"),
  [P]: typedEnergy(P, "Psychic"),
  [G]: typedEnergy(G, "Grass"),
  [LT]: typedEnergy(LT, "Lightning"),
  [SPARE]: typedEnergy(SPARE, "Metal"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  "me05-059": 1,
  "me01-075": 1,
  "me01-093": 1,
  "mep-083": 1,
  "me03-027": 2,
  "me04-007": 1,
  [FILLER]: 8,
  [FOE_EX]: 1,
  [WEAK_D]: 1,
  [RESIST_D]: 1,
  [WEAK_F]: 1,
  [RESIST_F]: 1,
  [LUNATONE]: 2,
  [LUXRAY]: 2,
  [SHINX]: 1,
  [SPREADER]: 1,
  [TING_LU]: 1,
  [FLUTTER]: 1,
  [D]: 4,
  [F]: 4,
  [P]: 4,
  [G]: 4,
  [LT]: 4,
  "fix-energy": 4,
  [SPARE]: 8,
});
const BOARD_IDS = [
  FILLER,
  FOE_EX,
  WEAK_D,
  RESIST_D,
  WEAK_F,
  RESIST_F,
  LUNATONE,
  LUXRAY,
  SHINX,
  SPREADER,
  TING_LU,
  D,
  F,
  P,
  G,
  LT,
  "fix-energy",
  ...Object.keys(LOCAL).filter((id) => !id.startsWith("d594-")),
  // (SPARE is deliberately absent.)
];

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own FIRST turn (P2 went first and passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 5944, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** TEST SURGERY — every Prize whose id is in `ids` swapped with a deck card whose id is not. */
function unprize(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  const kept = new Set(ids);
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

/** P1's Active is `attacker` with `energy` attached and one Filler benched; P2's Active is `defender`
    with one Filler benched. Every board id is taken out of the Prizes first (6 Prizes each remain). */
function table(attacker: string, energy: readonly (readonly [string, number])[], defender = FILLER): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const) {
    state = clearBench(setActiveFromDeck(state, s, FILLER), s);
    state = unprize(state, s, BOARD_IDS);
  }
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  for (const [id, n] of energy) state = attachFromDeck(state, "p1", id, n);
  state = benchFromDeck(state, "p1", FILLER);
  state = clearBench(setActiveFromDeck(state, "p2", defender), "p2");
  return benchFromDeck(state, "p2", FILLER);
}

type Active = NonNullable<GameState["players"]["p1"]["active"]>;
function withActive(state: GameState, seat: Seat, edit: (a: Active) => Active): GameState {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`no ${seat} Active`);
  return { ...state, players: { ...state.players, [seat]: { ...state.players[seat], active: edit(active) } } };
}

const attack = (index: number, seat: Seat = "p1"): GameAction => ({ type: "attack", seat, index });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const dealt = (state: GameState, index: number) => of(mustApply(state, attack(index)).events, "DAMAGE_DEALT")[0]?.dealt;
const nothing = (state: GameState, index: number) => of(mustApply(state, attack(index)).events, "DAMAGE_DEALT");

describe("D594 §3 — Whirling Envy: +90 at 2 or more damage counters; Weakness ignored, Resistance applied", () => {
  const envy = (damage: number, defender = FILLER) =>
    withActive(table("me05-059", [[D, 1]], defender), "p1", (a) => ({ ...a, damage }));

  it("2 counters: 20 + 90; 3 counters: 20 + 90; 1 counter or none: 20", () => {
    expect(dealt(envy(20), 0)).toBe(110);
    expect(dealt(envy(30), 0)).toBe(110);
    expect(dealt(envy(10), 0)).toBe(20);
    expect(dealt(envy(0), 0)).toBe(20);
  });

  it("a {D}-Weak defender takes 110, not 220; a {D}-Resistant one takes 110 − 30", () => {
    expect(dealt(envy(20, WEAK_D), 0)).toBe(110);
    expect(dealt(envy(0, WEAK_D), 0)).toBe(20);
    expect(dealt(envy(20, RESIST_D), 0)).toBe(80);
  });

  it("the member reads the CALLER's Active", () => {
    const cond = { kind: "yourActiveDamageCountersAtLeast", count: 2 } as const;
    const theirs = withActive(table("me05-059", [[D, 1]]), "p2", (a) => ({ ...a, damage: 50 }));
    expect(conditionHolds(theirs, "p1", cond)).toBe(false);
    expect(conditionHolds(theirs, "p2", cond)).toBe(true);
  });
});

describe("D594 §4 — Cosmic Beam: does nothing without a Benched Lunatone; W/R ignored", () => {
  const beam = (defender = FILLER) => table("me01-075", [[F, 1]], defender);

  it("a Benched Lunatone: 70, and 70 into a {F}-Weak or {F}-Resistant defender", () => {
    expect(dealt(benchFromDeck(beam(), "p1", LUNATONE), 0)).toBe(70);
    expect(dealt(benchFromDeck(beam(WEAK_F), "p1", LUNATONE), 0)).toBe(70);
    expect(dealt(benchFromDeck(beam(RESIST_F), "p1", LUNATONE), 0)).toBe(70);
  });

  it("no Lunatone, or only the opponent's: nothing is dealt", () => {
    expect(nothing(beam(), 0)).toEqual([]);
    expect(nothing(benchFromDeck(beam(), "p2", LUNATONE), 0)).toEqual([]);
  });
});

describe("D594 §5 — Welcoming Tail: +200 at exactly 6 Prize cards remaining", () => {
  it("6 Prizes: 40 + 200; 5 Prizes: 40", () => {
    const six = table("me01-093", [["fix-energy", 2]]);
    expect(six.players.p1.prizes).toHaveLength(6);
    expect(dealt(six, 0)).toBe(240);
    const p1 = six.players.p1;
    const five = { ...six, players: { ...six.players, p1: { ...p1, prizes: p1.prizes.slice(1), deck: [...p1.deck, ...p1.prizes.slice(0, 1)] } } };
    expect(dealt(five, 0)).toBe(40);
  });

  it("reads the attacker's own Prizes: the opponent at 5 changes nothing", () => {
    const six = table("me01-093", [["fix-energy", 2]]);
    const p2 = six.players.p2;
    const theirs = { ...six, players: { ...six.players, p2: { ...p2, prizes: p2.prizes.slice(1), deck: [...p2.deck, ...p2.prizes.slice(0, 1)] } } };
    expect(dealt(theirs, 0)).toBe(240);
  });
});

describe("D594 §6 — All Out: +160 with no cards in your hand", () => {
  it("an empty hand: 50 + 160; one card in hand: 50", () => {
    const empty = table("mep-083", [[P, 1]]);
    expect(empty.players.p1.hand).toEqual([]);
    expect(dealt(empty, 0)).toBe(210);
    expect(dealt(handFromDeck(empty, "p1", FILLER, 1), 0)).toBe(50);
  });

  it("the opponent's empty hand does not satisfy it", () => {
    const state = handFromDeck(table("mep-083", [[P, 1]]), "p1", FILLER, 1);
    expect(state.players.p2.hand).toEqual([]);
    expect(dealt(state, 0)).toBe(50);
  });
});

describe("D594 §7 — Fighting Roar: Luxio evolves early while the opponent's Active is a Pokémon ex", () => {
  const roar = (defender: string, zone: "active" | "bench") => {
    let state = table(zone === "active" ? "me03-027" : FILLER, [], defender);
    if (zone === "bench") state = benchFromDeck(state, "p1", "me03-027");
    return handFromDeck(state, "p1", LUXRAY, 1);
  };
  const evolve = (state: GameState, zone: "active" | "bench") => {
    const uid = state.players.p1.hand.find((h) => state.cardIdByUid[h] === LUXRAY);
    if (uid === undefined) throw new Error("no Luxray in hand");
    const target =
      zone === "active" ? ({ spot: "active" } as const) : ({ spot: "bench", index: state.players.p1.bench.length - 1 } as const);
    return applyAction(state, { type: "evolve", seat: "p1", uid, target });
  };

  it("P1's first turn, the opponent's Active an ex: the Active Luxio evolves", () => {
    const result = evolve(roar(FOE_EX, "active"), "active");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.state.cardIdByUid[result.state.players.p1.active?.stack.at(-1) ?? ""]).toBe(LUXRAY);
  });

  it("the same turn, a non-ex opponent's Active: refused (FIRST_TURN_EVOLVE)", () => {
    const result = evolve(roar(FILLER, "active"), "active");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("FIRST_TURN_EVOLVE");
  });

  it("no Active clause: a BENCHED Luxio is licensed too", () => {
    const result = evolve(roar(FOE_EX, "bench"), "bench");
    expect(result.ok).toBe(true);
  });

  it("a later turn, a Luxio benched THIS turn: licensed past EVOLVE_TOO_SOON only while the ex is Active", () => {
    // Surgery: turn 4 is P1's second turn (P2 went first), and the benched Luxio is stamped as
    // played on it — "the turn you play it", the half of the sentence a turn-1 board cannot show.
    const later = (defender: string): GameState => {
      const state = roar(defender, "bench");
      const last = state.players.p1.bench.length - 1;
      const bench = state.players.p1.bench.map((b, i) => (i === last ? { ...b, turnPlayed: 4 } : b));
      return { ...state, turn: 4, players: { ...state.players, p1: { ...state.players.p1, bench } } };
    };
    expect(evolve(later(FOE_EX), "bench").ok).toBe(true);
    const refused = evolve(later(FILLER), "bench");
    if (refused.ok) throw new Error("expected a refusal");
    expect(refused.error.code).toBe("EVOLVE_TOO_SOON");
  });

  it("the licence carries the shipped condition, read from the evolving player's seat", () => {
    const state = roar(FOE_EX, "active");
    const luxio = state.players.p1.active;
    if (luxio === null) throw new Error("no Luxio");
    expect(passivesOf(state, luxio).evolveEarlyExempt).toEqual([{ kind: "opponentActiveIsEx" }]);
    expect(evolveEarlyLicensed(state, "p1", luxio)).toBe(true);
    // P2 asking about its own opponent (P1's Active Luxio, not an ex) is false.
    expect(evolveEarlyLicensed(state, "p2", luxio)).toBe(false);
  });

  it("Shinx → Luxio → Luxray in ONE turn: the Luxio evolved INTO keeps the licence on top (only against an ex)", () => {
    // Fighting Roar's main real use, and the board that makes turn.ts' "twice in one turn" half
    // observable (D594's D539 note there): "the turn you play it" for an evolution card is the
    // turn it evolved. Surgery: turn 4 is P1's second turn, the Active Shinx a setup body.
    const chain = (defender: string): GameState => {
      const state = { ...table(SHINX, [], defender), turn: 4 };
      return handFromDeck(handFromDeck(state, "p1", "me03-027", 1), "p1", LUXRAY, 1);
    };
    const evolveActiveTo = (state: GameState, id: string) => {
      const uid = state.players.p1.hand.find((h) => state.cardIdByUid[h] === id);
      if (uid === undefined) throw new Error(`no ${id} in hand`);
      return applyAction(state, { type: "evolve", seat: "p1", uid, target: { spot: "active" } });
    };
    const top = (state: GameState) => state.cardIdByUid[state.players.p1.active?.stack.at(-1) ?? ""];
    for (const defender of [FOE_EX, FILLER]) {
      const luxio = must(evolveActiveTo(chain(defender), "me03-027"));
      expect(top(luxio)).toBe("me03-027");
      expect(luxio.players.p1.active?.turnPlayed).toBe(4);
      const result = evolveActiveTo(luxio, LUXRAY);
      if (defender === FOE_EX) {
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error.code);
        expect(top(result.state)).toBe(LUXRAY);
      } else {
        if (result.ok) throw new Error("expected a refusal");
        expect(result.error.code).toBe("EVOLVE_TOO_SOON");
      }
    }
  });

  it("§9: an Ability-lock silences the licence — Ting-Lu ex's Cursed Land on a DAMAGED Luxio", () => {
    // Ting-Lu ex is an ex, so the condition holds; Cursed Land darkens the opponent's damaged
    // non-ex bodies. The control first: the same board with an undamaged Luxio is licensed.
    const base = roar(TING_LU, "active");
    expect(evolve(base, "active").ok).toBe(true);
    const locked = withActive(base, "p1", (a) => ({ ...a, damage: 10 }));
    const luxio = locked.players.p1.active;
    if (luxio === null) throw new Error("no Luxio");
    expect(evolveEarlyLicensed(locked, "p1", luxio)).toBe(false);
    const refused = evolve(locked, "active");
    if (refused.ok) throw new Error("expected a refusal");
    expect(refused.error.code).toBe("FIRST_TURN_EVOLVE");
  });
});

describe("D594 §8 — Needly Armor: 3 damage counters on the Attacking Pokémon per {G} Energy", () => {
  const armor = (grass: number, extra: readonly (readonly [string, number])[] = []) => {
    let state = table(FILLER, [["fix-energy", 1]], "me04-007");
    // P2's Chesnaught: `grass` {G} and any extra Energy attached (surgery on P2's Active).
    state = attachFromDeck(state, "p2", G, grass);
    for (const [id, n] of extra) state = attachFromDeck(state, "p2", id, n);
    return mustApply(state, attack(0)).state.players.p1.active?.damage;
  };

  it("two {G}: 60 on the attacker; three: 90; none: 0", () => {
    expect(armor(2)).toBe(60);
    expect(armor(3)).toBe(90);
    expect(armor(0)).toBe(0);
  });

  it("a non-{G} Energy counts nothing", () => {
    expect(armor(1, [[D, 2]])).toBe(30);
  });

  it("\"even if this Pokémon is Knocked Out\": a lethal hit still pays 60 for two {G}", () => {
    let state = table(FILLER, [["fix-energy", 1]], "me04-007");
    state = withActive(attachFromDeck(state, "p2", G, 2), "p2", (a) => ({ ...a, damage: 170 }));
    const chesnaught = state.players.p2.active?.stack.at(-1);
    const { state: after, events } = mustApply(state, attack(0));
    expect(of(events, "KNOCKED_OUT").map((e) => e.uid)).toEqual([chesnaught]);
    expect(after.players.p1.active?.damage).toBe(60);
  });

  it("a BENCHED Chesnaught hit by a spread does not retaliate (today's Active-only read, its printed clause)", () => {
    // The control: the same attack into an ACTIVE Chesnaught with two {G} pays 60.
    const active = attachFromDeck(table(SPREADER, [["fix-energy", 1]], "me04-007"), "p2", G, 2);
    expect(mustApply(active, attack(0)).state.players.p1.active?.damage).toBe(60);
    // Displace it to the Bench (the Filler becomes P2's Active); the spread reaches it there.
    const benched = setActiveFromDeck(active, "p2", FILLER);
    const holder = benched.players.p2.bench.at(-1)?.stack.at(-1);
    expect(benched.cardIdByUid[holder ?? ""]).toBe("me04-007");
    const after = mustApply(benched, attack(0)).state;
    expect(after.players.p2.bench.find((b) => b.stack.at(-1) === holder)?.damage).toBe(10);
    expect(after.players.p1.active?.damage).toBe(0);
  });

  it("§9: Flutter Mane's Midnight Fluttering silences Needly Armor on the opposing Active", () => {
    const state = attachFromDeck(table(FLUTTER, [["fix-energy", 1]], "me04-007"), "p2", G, 2);
    expect(disabledAbilityUids(state).has(state.players.p2.active?.stack.at(-1) ?? "")).toBe(true);
    expect(mustApply(state, attack(0)).state.players.p1.active?.damage).toBe(0);
  });
});

describe("D594 §9 — the version", () => {
  it("is built at engine 0.522.0", () => {
    expect(engineVersion).toBe("0.522.0");
  });
});
