import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import {
  deriveAttackDamageBonus,
  deriveAttackEffect,
  deriveAttackRequirement,
  splitAttackGateClause,
  timingGateFromAttackText,
} from "./effects";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  battler,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  specialEnergy,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D593 — WP07: MORE `me` CLAUSE ROWS AND THE "FADE OUT" OBJECTS ──
//
// 9 printed attack texts / 15 `me` printings. Seven clause rows on shipped members (five bonus,
// two "does nothing") plus Facade on the ONE new member `yourActiveBurnedOrPoisoned`; Cutting
// Riposte as the eighth `ATTACK_GATE_CLAUSES` row (`alternateCostIf` at {D}); and Lillie's
// Comfey's "Fade Out" op keyed on Drifblim, Meowth ex ×3 and Emolga under their printed attack
// names. Every id and text off the LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`),
// 2026-10-08, `legal_standard = 1`; no id was referenced in the tree before this slice except
// as D582's NOT-aliased "Fade Out" rows. No `me` row is a fixture, so the printed bytes are
// carried HERE and §1 pins each against the committed `me` corpus.

const MASTERS_PUNCH = "If any of your Benched Pancham have any damage counters on them, this attack does 120 more damage.";
const HORRIFYING_REVENGE =
  "If any of your Hop's Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 100 more damage.";
const UPPER_SPARK = "If this Pokémon evolved from Magneton during this turn, this attack does 120 more damage.";
const CUTTING_RIPOSTE = "If this Pokémon has any damage counters on it, this attack can be used for {D}.";
const GIGA_RAILGUN = "If this Pokémon has no Voltaic {L} Energy attached, this attack does nothing.";
const FACADE = "If this Pokémon is Burned or Poisoned, this attack does 100 more damage.";
const SPIKY_ROLLING = "If this Pokémon used Spiky Rolling during your last turn, this attack does 80 more damage.";
const BRAIN_CRUSH = "If your opponent's Active Pokémon isn't Confused, this attack does nothing.";
const FADE_OUT = "Put this Pokémon and all attached cards into your hand.";

/** [text, the `me` printing ids that print it]. */
const SENTENCES: readonly (readonly [string, readonly string[]])[] = [
  [MASTERS_PUNCH, ["me02.5-140"]],
  [HORRIFYING_REVENGE, ["me02.5-096", "me02.5-237"]],
  [UPPER_SPARK, ["me01-047"]],
  [CUTTING_RIPOSTE, ["me01-085"]],
  [GIGA_RAILGUN, ["me05-026"]],
  [FACADE, ["me02.5-170", "me02.5-249"]],
  [SPIKY_ROLLING, ["me02.5-149"]],
  [BRAIN_CRUSH, ["me05-052"]],
  [FADE_OUT, ["mep-006", "me03-062", "me03-107", "me03-121", "me04-030"]],
];

describe("D593 §1 — the texts: 9 attack sentences / 15 printings", () => {
  it("each sentence is a row of the committed `me` corpus at its printing count, and none is printed in legal `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, ids] of SENTENCES) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      expect(sv.has(text), text).toBe(text === FADE_OUT);
    }
    expect(SENTENCES.flatMap(([, ids]) => ids)).toHaveLength(15);
    expect(new Set(SENTENCES.flatMap(([, ids]) => ids)).size).toBe(15);
  });

  it("the seven clause sentences resolve through a reader; Cutting Riposte through the gate splitter", () => {
    for (const text of [MASTERS_PUNCH, HORRIFYING_REVENGE, UPPER_SPARK, GIGA_RAILGUN, FACADE, SPIKY_ROLLING, BRAIN_CRUSH]) {
      expect(resolvedByAnyReader(text), text).toBe(true);
    }
    expect(resolvedByAnyReader(CUTTING_RIPOSTE)).toBe(false);
    expect(splitAttackGateClause(CUTTING_RIPOSTE)).toEqual({ clause: CUTTING_RIPOSTE, body: "" });
    // "Fade Out" stays a registry-only sentence: the five printings are keyed by id (§8).
    expect(resolvedByAnyReader(FADE_OUT)).toBe(false);
  });

  it("the near misses stay unbuilt: no row is a template", () => {
    for (const near of [
      "If any of your Benched Pangoro have any damage counters on them, this attack does 120 more damage.",
      "If any of your Marnie's Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 100 more damage.",
      "If this Pokémon evolved from Magnemite during this turn, this attack does 120 more damage.",
      "If this Pokémon is Burned, this attack does 100 more damage.",
      "If this Pokémon is Burned or Confused, this attack does 100 more damage.",
      "If this Pokémon used Stun Needle during your last turn, this attack does 80 more damage.",
      "If this Pokémon has no Magnetic {M} Energy attached, this attack does nothing.",
      "If your opponent's Active Pokémon isn't Asleep, this attack does nothing.",
    ]) {
      expect(resolvedByAnyReader(near), near).toBe(false);
    }
    expect(splitAttackGateClause("If this Pokémon has any damage counters on it, this attack can be used for {P}.")).toBeNull();
  });

  it("the eighth gate row is disjoint from the seven: neither end of it carries another row, and two in one string trip the splitter", () => {
    const seven = [
      "If you go second, you can't use this attack during your first turn.",
      "If you go first, you can use this attack during your first turn.",
      "You can use this attack only if you go second, and only during your first turn.",
      "You can use this attack only if this Pokémon used Rollout during your last turn.",
      "If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.",
      "If this Pokémon has any damage counters on it, this attack can be used for {F}.",
      "If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost.",
    ];
    for (const row of seven) {
      expect(splitAttackGateClause(row)?.body, row).toBe("");
      expect(CUTTING_RIPOSTE.startsWith(`${row} `) || CUTTING_RIPOSTE.endsWith(` ${row}`), row).toBe(false);
      expect(row.startsWith(`${CUTTING_RIPOSTE} `) || row.endsWith(` ${CUTTING_RIPOSTE}`), row).toBe(false);
      expect(splitAttackGateClause(`${CUTTING_RIPOSTE} ${row}`), row).toBeNull();
    }
    expect(new Set([...seven, CUTTING_RIPOSTE]).size).toBe(8);
  });
});

describe("D593 §2 — the readings: shipped members at the printed parameters", () => {
  const bonus = (text: string) => {
    const read = deriveAttackDamageBonus(text);
    return read?.count.kind === "boardCondition" ? [read.per, read.count.cond] : read;
  };

  it("the five bonus rows", () => {
    expect(bonus(MASTERS_PUNCH)).toEqual([120, { kind: "yourBenchNamedDamaged", name: "Pancham" }]);
    expect(bonus(HORRIFYING_REVENGE)).toEqual([
      100,
      { kind: "yourPokemonKoedOnOpponentsLastTurn", owner: "Hop", byAttack: true },
    ]);
    expect(bonus(UPPER_SPARK)).toEqual([120, { kind: "yourActiveEvolvedFromThisTurn", name: "Magneton" }]);
    expect(bonus(FACADE)).toEqual([100, { kind: "yourActiveBurnedOrPoisoned" }]);
    expect(bonus(SPIKY_ROLLING)).toEqual([80, { kind: "yourActiveUsedAttackLastTurn", attack: "Spiky Rolling" }]);
    // The U+2019 spelling of Hop's possessive reads the same (D136/D137).
    expect(deriveAttackDamageBonus(HORRIFYING_REVENGE.replace("Hop's", "Hop’s"))).toEqual(
      deriveAttackDamageBonus(HORRIFYING_REVENGE),
    );
  });

  it("the two requirement rows: the skeleton owns the negation", () => {
    expect(deriveAttackRequirement(GIGA_RAILGUN)).toEqual({
      kind: "yourActiveHasNamedEnergyAttached",
      name: "Voltaic Lightning Energy",
    });
    expect(deriveAttackRequirement(BRAIN_CRUSH)).toEqual({ kind: "opponentActiveConfused" });
  });

  it("Cutting Riposte: `alternateCostIf` `yourActiveDamaged` at {D} — the {F} row's gate at the printed type", () => {
    expect(timingGateFromAttackText(CUTTING_RIPOSTE)).toEqual({
      kind: "alternateCostIf",
      condition: { kind: "yourActiveDamaged" },
      cost: ["Darkness"],
    });
    const fighting = "If this Pokémon has any damage counters on it, this attack can be used for {F}.";
    expect(timingGateFromAttackText(fighting)).toEqual({
      kind: "alternateCostIf",
      condition: { kind: "yourActiveDamaged" },
      cost: ["Fighting"],
    });
  });

  it("the new member's note drops the pronoun, as `yourActivePoisoned`'s does", () => {
    expect(conditionNote({ kind: "yourActiveBurnedOrPoisoned" })).toBe("your Active Pokémon is Burned or Poisoned");
  });
});

// ── ON A BOARD: each row against a control on the other side of it ──

const FILLER = "d593-filler";
const PANCHAM = "d593-pancham";
const OTHER = "d593-other";
const MAGNETON = "d593-magneton";
const VOLTAIC = "me05-084";
const L = "d593-lightning";
const D = "d593-darkness";
const P = "d593-psychic";
const M = "d593-metal";

const mon = (id: string, name: string, hp: number, type: string, attacks: Card["attacks"], extra: Partial<Card> = {}) =>
  battler(id, { name, hp, types: [type], retreat: 2, attacks, ...extra });

const LOCAL: Record<string, Card> = {
  "me02.5-140": mon(
    "me02.5-140",
    "Pangoro",
    140,
    "Darkness",
    [
      { cost: ["Darkness"], name: "Corkscrew Punch", damage: 40 },
      { cost: ["Darkness", "Darkness", "Colorless"], name: "Master's Punch", damage: "80+", effect: MASTERS_PUNCH },
    ],
    { stage: "Stage1", evolveFrom: "Pancham" },
  ),
  "me02.5-096": mon(
    "me02.5-096",
    "Hop's Trevenant",
    140,
    "Psychic",
    [
      { cost: ["Colorless"], name: "Horrifying Revenge", damage: "30+", effect: HORRIFYING_REVENGE },
      {
        cost: ["Psychic", "Colorless", "Colorless"],
        name: "Corner",
        damage: 90,
        effect: "During your opponent's next turn, the Defending Pokémon can't retreat.",
      },
    ],
    { stage: "Stage1", evolveFrom: "Hop's Phantump" },
  ),
  "me01-047": mon(
    "me01-047",
    "Magnezone",
    160,
    "Lightning",
    [
      { cost: ["Lightning"], name: "Upper Spark", damage: "50+", effect: UPPER_SPARK },
      {
        cost: ["Lightning", "Lightning"],
        name: "Flashing Bolt",
        damage: 160,
        effect: "During your next turn, this Pokémon can't use Flashing Bolt.",
      },
    ],
    { stage: "Stage2", evolveFrom: "Magneton" },
  ),
  "me01-085": mon(
    "me01-085",
    "Crawdaunt",
    130,
    "Darkness",
    [
      { cost: ["Colorless"], name: "Vise Grip", damage: 30 },
      { cost: ["Darkness", "Darkness", "Colorless"], name: "Cutting Riposte", damage: 130, effect: CUTTING_RIPOSTE },
    ],
    { stage: "Stage1", evolveFrom: "Corphish" },
  ),
  "me05-026": mon(
    "me05-026",
    "Vikavolt",
    160,
    "Lightning",
    [
      {
        cost: ["Lightning"],
        name: "Quick Dive",
        effect:
          "This attack does 50 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
      { cost: ["Lightning", "Lightning"], name: "Giga Railgun", damage: 260, effect: GIGA_RAILGUN },
    ],
    { stage: "Stage2", evolveFrom: "Charjabug" },
  ),
  "me02.5-170": mon(
    "me02.5-170",
    "Larry's Staraptor",
    150,
    "Colorless",
    [
      { cost: ["Colorless"], name: "Facade", damage: "60+", effect: FACADE },
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Feathery Strike",
        damage: 150,
        effect:
          "Discard 2 Energy from this Pokémon, and this attack also does 50 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ],
    { stage: "Stage2", evolveFrom: "Larry's Staravia" },
  ),
  "me02.5-149": mon(
    "me02.5-149",
    "Togedemaru ex",
    190,
    "Metal",
    [
      {
        cost: ["Metal"],
        name: "Stun Needle",
        damage: 20,
        effect: "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.",
      },
      { cost: ["Metal", "Colorless"], name: "Spiky Rolling", damage: "80+", effect: SPIKY_ROLLING },
    ],
    { suffix: "ex" } as Partial<Card>,
  ),
  "me05-052": mon(
    "me05-052",
    "Malamar",
    120,
    "Darkness",
    [
      { cost: ["Darkness"], name: "Perplex", effect: "Your opponent's Active Pokémon is now Confused." },
      { cost: ["Darkness"], name: "Brain Crush", damage: 130, effect: BRAIN_CRUSH },
    ],
    { stage: "Stage1", evolveFrom: "Inkay" },
  ),
  "mep-006": mon(
    "mep-006",
    "Drifblim",
    110,
    "Psychic",
    [
      { cost: ["Psychic"], name: "Disruptive Wind", effect: "Your opponent's Active Pokémon is now Confused." },
      { cost: ["Psychic", "Psychic"], name: "Balloon Return", damage: 110, effect: FADE_OUT },
    ],
    { stage: "Stage1", evolveFrom: "Drifloon" },
  ),
  "me03-062": mon(
    "me03-062",
    "Meowth ex",
    170,
    "Colorless",
    [{ cost: ["Colorless", "Colorless", "Colorless"], name: "Tuck Tail", damage: 60, effect: FADE_OUT }],
    {
      suffix: "ex",
      abilities: [
        {
          type: "Ability",
          name: "Last-Ditch Catch",
          effect:
            "Once during your turn, when you play this Pokémon from your hand onto your Bench, you may use this Ability. Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck. You can't use more than 1 Ability that has \"Last-Ditch\" in its name each turn.",
        },
      ],
    } as Partial<Card>,
  ),
  "me04-030": mon("me04-030", "Emolga", 70, "Lightning", [
    {
      cost: ["Colorless"],
      name: "Minor Errand-Running",
      effect:
        "Search your deck for up to 2 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    },
    { cost: ["Lightning"], name: "Sky Return", damage: 30, effect: FADE_OUT },
  ]),
  // The catalog face exactly as tcgdex hands it (D583): a Special Energy tagged "Normal".
  [VOLTAIC]: {
    ...specialEnergy(
      VOLTAIC,
      "Voltaic Lightning Energy",
      "As long as this card is attached to a Pokémon, it provides {L} Energy.\n\nAttacks used by the {L} Pokémon this card is attached to do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
    ),
    energyType: "Normal",
  },
  [FILLER]: mon(FILLER, "D593 Filler", 400, "Colorless", [{ cost: ["Colorless"], name: "Tap", damage: 10 }]),
  [PANCHAM]: mon(PANCHAM, "Pancham", 70, "Fighting", [{ cost: ["Colorless"], name: "Tap", damage: 10 }]),
  [OTHER]: mon(OTHER, "Inkay", 70, "Darkness", [{ cost: ["Colorless"], name: "Tap", damage: 10 }]),
  [MAGNETON]: mon(MAGNETON, "Magneton", 90, "Lightning", [{ cost: ["Colorless"], name: "Tap", damage: 10 }], {
    stage: "Stage1",
    evolveFrom: "Magnemite",
  }),
  [L]: typedEnergy(L, "Lightning"),
  [D]: typedEnergy(D, "Darkness"),
  [P]: typedEnergy(P, "Psychic"),
  [M]: typedEnergy(M, "Metal"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  "me02.5-140": 1,
  "me02.5-096": 1,
  "me01-047": 1,
  "me01-085": 1,
  "me05-026": 1,
  "me02.5-170": 1,
  "me02.5-149": 1,
  "me05-052": 1,
  "mep-006": 1,
  "me03-062": 1,
  "me04-030": 1,
  [VOLTAIC]: 2,
  [FILLER]: 14,
  [PANCHAM]: 2,
  [OTHER]: 2,
  [MAGNETON]: 1,
  [L]: 7,
  [D]: 7,
  [P]: 4,
  [M]: 4,
  "fix-energy": 6,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own turn (P2 went first and passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 5933, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** P1's Active is `attacker` with `energy` attached and one Filler benched; P2's Active is a Filler
    with one Filler benched. Every id the board pulls is taken out of the Prizes first. */
function table(attacker: string, energy: readonly (readonly [string, number])[]): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const) {
    state = clearBench(setActiveFromDeck(state, s, FILLER), s);
    state = unprize(state, s, [attacker, FILLER, PANCHAM, OTHER, MAGNETON, VOLTAIC, ...energy.map(([e]) => e)]);
  }
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  for (const [id, n] of energy) state = attachFromDeck(state, "p1", id, n);
  state = benchFromDeck(state, "p1", FILLER);
  state = clearBench(state, "p2");
  return benchFromDeck(state, "p2", FILLER);
}

type Active = NonNullable<GameState["players"]["p1"]["active"]>;
/** TEST SURGERY — `seat`'s Active rewritten by `edit`. */
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

describe("D593 §3 — Master's Punch: +120 when a Benched Pancham has damage counters", () => {
  const punch = (benched: string, damage: number) => {
    let state = benchFromDeck(table("me02.5-140", [[D, 3]]), "p1", benched);
    const bench = state.players.p1.bench.map((b) =>
      state.cardIdByUid[b.stack[0] ?? ""] === benched ? { ...b, damage } : b,
    );
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench } } };
    return state;
  };

  it("a damaged Benched Pancham: 80 + 120; an undamaged one: 80", () => {
    expect(dealt(punch(PANCHAM, 10), 1)).toBe(200);
    expect(dealt(punch(PANCHAM, 0), 1)).toBe(80);
  });

  it("a damaged Benched Pokémon of another name pays nothing", () => {
    expect(dealt(punch(OTHER, 30), 1)).toBe(80);
  });
});

describe("D593 §4 — Horrifying Revenge: +100 when a Hop's Pokémon was Knocked Out by an attack last turn", () => {
  const revenge = (name: string, byAttack: boolean, turnsAgo = 1) => {
    const state = table("me02.5-096", [["fix-energy", 1]]);
    return {
      ...state,
      lastKoTurn: { ...state.lastKoTurn, p1: state.turn - turnsAgo },
      lastKoMarks: { ...state.lastKoMarks, p1: [{ uid: "d593-gone", name, byAttack }] },
    };
  };

  it("a Hop's Pokémon Knocked Out by an attack on the opponent's last turn: 30 + 100", () => {
    expect(dealt(revenge("Hop's Wooloo", true), 0)).toBe(130);
  });

  it("the controls: another owner, a Checkup Knock Out, and an older Knock Out each pay nothing", () => {
    expect(dealt(revenge("Ethan's Pinsir", true), 0)).toBe(30);
    expect(dealt(revenge("Hop's Wooloo", false), 0)).toBe(30);
    expect(dealt(revenge("Hop's Wooloo", true, 3), 0)).toBe(30);
  });
});

describe("D593 §5 — Upper Spark: +120 when this Pokémon evolved from Magneton this turn", () => {
  const spark = (evolvedTurnOffset: number | null, beneath: string) => {
    const state = table("me01-047", [[L, 1]]);
    const uid = state.players.p1.deck.find((u) => state.cardIdByUid[u] === beneath);
    if (uid === undefined) throw new Error(`no ${beneath} in the deck`);
    const pulled = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, deck: state.players.p1.deck.filter((u) => u !== uid) } },
    };
    return withActive(pulled, "p1", (a) => ({
      ...a,
      stack: [uid, ...a.stack],
      evolvedTurn: evolvedTurnOffset === null ? null : state.turn - evolvedTurnOffset,
    }));
  };

  it("evolved from Magneton this turn: 50 + 120; on an earlier turn: 50", () => {
    expect(dealt(spark(0, MAGNETON), 0)).toBe(170);
    expect(dealt(spark(2, MAGNETON), 0)).toBe(50);
  });

  it("evolved this turn from a card of another name: 50", () => {
    expect(dealt(spark(0, OTHER), 0)).toBe(50);
  });
});

describe("D593 §6 — Facade on the new `yourActiveBurnedOrPoisoned`", () => {
  const facade = (conditions: Partial<Active["conditions"]>) =>
    withActive(table("me02.5-170", [["fix-energy", 1]]), "p1", (a) => ({
      ...a,
      conditions: { ...a.conditions, ...conditions },
    }));

  it("Burned: 60 + 100; Poisoned: 60 + 100; both: 60 + 100", () => {
    expect(dealt(facade({ burned: true }), 0)).toBe(160);
    expect(dealt(facade({ poisonDamage: 10 }), 0)).toBe(160);
    expect(dealt(facade({ burned: true, poisonDamage: 10 }), 0)).toBe(160);
  });

  it("the other Special Conditions and a clean Active pay nothing", () => {
    expect(dealt(facade({ rotation: "confused" }), 0)).toBe(60);
    expect(dealt(facade({}), 0)).toBe(60);
  });

  it("the member reads the CALLER's Active: a Burned or Poisoned opponent does not satisfy it", () => {
    const cond = { kind: "yourActiveBurnedOrPoisoned" } as const;
    const base = table("me02.5-170", [["fix-energy", 1]]);
    const theirs = withActive(base, "p2", (a) => ({ ...a, conditions: { ...a.conditions, burned: true, poisonDamage: 10 } }));
    expect(conditionHolds(theirs, "p1", cond)).toBe(false);
    expect(conditionHolds(theirs, "p2", cond)).toBe(true);
    for (const rotation of ["asleep", "paralyzed", "confused"] as const) {
      const state = withActive(base, "p1", (a) => ({ ...a, conditions: { ...a.conditions, rotation } }));
      expect(conditionHolds(state, "p1", cond), rotation).toBe(false);
    }
    const empty = { ...base, players: { ...base.players, p1: { ...base.players.p1, active: null } } };
    expect(conditionHolds(empty, "p1", cond)).toBe(false);
  });
});

describe("D593 §7 — Spiky Rolling: +80 when this Pokémon used Spiky Rolling during your last turn", () => {
  it("played out: 80, the opponent passes, then 80 + 80", () => {
    const first = mustApply(table("me02.5-149", [[M, 2]]), attack(1));
    expect(of(first.events, "DAMAGE_DEALT")[0]?.dealt).toBe(80);
    const back = must(applyAction(first.state, { type: "endTurn", seat: "p2" }));
    expect(of(mustApply(back, attack(1)).events, "DAMAGE_DEALT")[0]?.dealt).toBe(160);
  });

  it("the controls: Stun Needle last turn, or Spiky Rolling two turns back, pays nothing", () => {
    const at = (name: string, turnsAgo: number) => {
      const state = table("me02.5-149", [[M, 2]]);
      return withActive(state, "p1", (a) => ({ ...a, usedAttack: { name, turn: state.turn - turnsAgo } }));
    };
    expect(dealt(at("Spiky Rolling", 2), 1)).toBe(160);
    expect(dealt(at("Stun Needle", 2), 1)).toBe(80);
    expect(dealt(at("Spiky Rolling", 4), 1)).toBe(80);
  });
});

describe("D593 §8 — Giga Railgun: does nothing without a Voltaic Lightning Energy attached", () => {
  it("with Voltaic Lightning Energy attached: 260 (🆕🆕🆕 D604 (D539): \"260\" is WITHDRAWN as the dealt figure — the Voltaic is a built Energy since D604, +20 on its {L} holder's attacks to the Active: 280)", () => {
    // 🆕🆕🆕 D604 — Vikavolt is {L}, so its Voltaic adds 20 before W/R (typedSpecialEnergyMeD604.test.ts).
    expect(dealt(table("me05-026", [[L, 2], [VOLTAIC, 1]]), 1)).toBe(280);
  });

  it("Basic {L} only: nothing is dealt", () => {
    expect(nothing(table("me05-026", [[L, 3]]), 1)).toEqual([]);
  });
});

describe("D593 §9 — Brain Crush: does nothing unless the opponent's Active is Confused", () => {
  it("played out: Perplex, the opponent passes, then 130", () => {
    const first = mustApply(table("me05-052", [[D, 1]]), attack(0));
    expect(first.state.players.p2.active?.conditions.rotation).toBe("confused");
    const back = must(applyAction(first.state, { type: "endTurn", seat: "p2" }));
    expect(of(mustApply(back, attack(1)).events, "DAMAGE_DEALT")[0]?.dealt).toBe(130);
  });

  it("a clean or Asleep defender: nothing is dealt", () => {
    const base = table("me05-052", [[D, 1]]);
    expect(nothing(base, 1)).toEqual([]);
    const asleep = withActive(base, "p2", (a) => ({ ...a, conditions: { ...a.conditions, rotation: "asleep" } }));
    expect(nothing(asleep, 1)).toEqual([]);
  });
});

describe("D593 §10 — Cutting Riposte: payable for {D} while this Pokémon has damage counters", () => {
  const riposte = (energy: readonly (readonly [string, number])[], damage: number) =>
    withActive(table("me01-085", energy), "p1", (a) => ({ ...a, damage }));

  it("damaged with a single {D}: 130", () => {
    expect(dealt(riposte([[D, 1]], 10), 1)).toBe(130);
  });

  it("undamaged with a single {D}: refused (the printed {D}{D}{C} is charged)", () => {
    const result = applyAction(riposte([[D, 1]], 0), attack(1));
    expect(result.ok).toBe(false);
  });

  it("never stricter than printed: damaged with {D}{D}{C} it still attacks", () => {
    expect(dealt(riposte([[D, 2], ["fix-energy", 1]], 10), 1)).toBe(130);
  });
});

describe("D593 §11 — \"Fade Out\" under three printed names", () => {
  const BOUNCE = [{ op: "returnSelf", dest: "hand" }];

  it("three NEW attack-only objects, each at its printed index; the other index keeps deriving", () => {
    expect(programFor("mep-006")).toEqual({ attack: { 1: BOUNCE } });
    expect(programFor("me04-030")).toEqual({ attack: { 1: BOUNCE } });
    expect(programFor("me03-062")).toEqual({ attack: { 0: BOUNCE } });
    expect(programFor("me03-107")).toBe(programFor("me03-062"));
    expect(programFor("me03-121")).toBe(programFor("me03-062"));
    // Distinct objects, and none is Lillie's Comfey's (which carries index 0 too).
    const objects = new Set([programFor("mep-006"), programFor("me04-030"), programFor("me03-062"), programFor("sv09-068")]);
    expect(objects.size).toBe(4);
    expect(programFor("sv09-068")?.attack?.[1]).toEqual(BOUNCE);
    // Drifblim's and Emolga's index 0 stay on the reader.
    expect(deriveAttackEffect("Your opponent's Active Pokémon is now Confused.")).not.toBeNull();
    expect(
      deriveAttackEffect(
        "Search your deck for up to 2 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
      ),
    ).not.toBeNull();
    // No "you may": compulsory, so no `optional` wrapper (the D313 Comfey reading).
    expect(FADE_OUT.includes("may")).toBe(false);
    // Meowth ex's Ability is NOT built by this key.
    expect(programFor("me03-062")?.abilities).toBeUndefined();
  });

  const bounce = (id: string, index: number, energy: readonly (readonly [string, number])[], damage: number) => {
    const state = table(id, energy);
    const attached = state.players.p1.active?.energy ?? [];
    const result = mustApply(state, attack(index));
    expect(of(result.events, "DAMAGE_DEALT")[0]?.dealt, id).toBe(damage);
    expect(of(result.events, "POKEMON_RETURNED")[0]?.dest, id).toBe("hand");
    expect(result.state.phase.kind, id).not.toBe("effect:choose");
    const hand = result.state.players.p1.hand.map((u) => result.state.cardIdByUid[u]);
    expect(hand, id).toContain(id);
    for (const uid of attached) expect(result.state.players.p1.hand, id).toContain(uid);
    expect(result.state.cardIdByUid[result.state.players.p1.active?.stack[0] ?? ""], id).toBe(FILLER);
    expect(of(result.events, "KNOCKED_OUT"), id).toEqual([]);
  };

  it("Balloon Return: 110, then Drifblim and its Energy go to the hand and the Bench is promoted", () => {
    bounce("mep-006", 1, [[P, 2]], 110);
  });

  it("Tuck Tail: 60, the same", () => {
    bounce("me03-062", 0, [["fix-energy", 2], [D, 1]], 60);
  });

  it("Sky Return: 30, the same", () => {
    bounce("me04-030", 1, [[L, 1]], 30);
  });
});

describe("D593 §12 — the version", () => {
  it("is built at engine 0.508.0", () => {
    expect(engineVersion).toBe("0.508.0");
  });
});
