import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import {
  deriveAttackCancelRequirement,
  deriveAttackDamageBonus,
  deriveAttackEffect,
  deriveAttackRequirement,
  splitAttackCancelClause,
} from "./effects";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  setPrizes,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D586 — WP03: ROWS ON EXISTING CONDITION MEMBERS ──
//
// 9 printed texts / 19 `me` units (17 printings): eight attack sentences claimed by shipped
// readers through one new anchor and seven clause-table rows, plus Carbink's "Double Type" on
// a {F}{P} copy of Scovillain ex's `typesInPlay` program. Every id and text measured on the
// LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-07, `legal_standard = 1`; no
// id was referenced anywhere in the tree before this slice. No `me` row is a fixture, so the
// printed bytes are carried HERE and §1 pins each against the committed `me` corpus.

const ABYSS_EYE = "If your opponent's Active Pokémon is affected by a Special Condition, it is Knocked Out.";
const LIMIT_BREAK = "If your opponent has 3 or fewer Prize cards remaining, this attack does 90 more damage.";
const COUNTER_JEWEL = "If your opponent has 2 or fewer Prize cards remaining, this attack does 100 more damage.";
const ELECTRO_FALL = "If you have at least 4 {L} Energy in play, this attack does 90 more damage.";
const FLARE_FALL = "If you have at least 4 {R} Energy in play, this attack does 90 more damage.";
const CRYSTAL_FALL = "If you have at least 4 {W} Energy in play, this attack does 90 more damage.";
const SEVENTH_KICK = "If you don't have exactly 7 cards in your hand, this attack does nothing.";
const INFERNAL_SLASH =
  "Discard 4 Basic {R} Energy cards from your hand. If you can't discard 4 cards in this way, this attack does nothing.";
const DOUBLE_TYPE_TEXT = "As long as this Pokémon is in play, it is {F} and {P} type.";

/** [text, the `me` printing ids that print it]. */
const SENTENCES: readonly (readonly [string, readonly string[]])[] = [
  [ABYSS_EYE, ["mep-090", "me05-048", "me05-101", "me05-116", "me05-120"]],
  [LIMIT_BREAK, ["mep-015", "me02-045", "me02-100"]],
  [COUNTER_JEWEL, ["me02.5-117", "me02.5-242"]],
  [ELECTRO_FALL, ["me01-048"]],
  [FLARE_FALL, ["me02.5-025"]],
  [CRYSTAL_FALL, ["me02-026"]],
  [SEVENTH_KICK, ["me02.5-104", "me02.5-241"]],
  [INFERNAL_SLASH, ["mep-014", "me02-020"]],
];
const CARBINK = ["me02.5-117", "me02.5-242"] as const;

describe("D586 §1 — the texts: 8 attack sentences / 17 printings, plus Carbink's Ability", () => {
  it("each sentence is a row of the committed `me` corpus at its printing count, and none is printed in `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, ids] of SENTENCES) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      expect(sv.has(text), text).toBe(false);
    }
    expect(SENTENCES.flatMap(([, ids]) => ids)).toHaveLength(17);
    expect(new Set(SENTENCES.flatMap(([, ids]) => ids)).size).toBe(17);
  });

  it("every sentence now resolves through a reader", () => {
    for (const [text] of SENTENCES) expect(resolvedByAnyReader(text), text).toBe(true);
  });

  it("the near miss stays unbuilt: Abyss Eye's clause with a damage-counter consequent is not claimed", () => {
    const near =
      "If your opponent's Active Pokémon is affected by a Special Condition, place 6 damage counters on 1 of your opponent's Benched Pokémon.";
    expect(meAttackCorpus().some(([, text]) => text === near)).toBe(true);
    expect(resolvedByAnyReader(near)).toBe(false);
  });
});

describe("D586 §2 — the readings: shipped members at the printed parameters", () => {
  it("Abyss Eye: `conditionGate` on `opponentActiveHasSpecialCondition` around `knockOutDefender`", () => {
    expect(deriveAttackEffect(ABYSS_EYE)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveHasSpecialCondition" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "knockOutDefender" }],
      },
    ]);
    // The U+2019 spelling of the possessive reads the same (D136/D137).
    expect(deriveAttackEffect(ABYSS_EYE.replace("'", "’"))).toEqual(deriveAttackEffect(ABYSS_EYE));
  });

  it("the Prize rows: \"N or fewer\" enumerated from 0 (D367's spelling)", () => {
    expect(deriveAttackDamageBonus(LIMIT_BREAK)).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: { kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3] } },
    });
    expect(deriveAttackDamageBonus(COUNTER_JEWEL)).toEqual({
      per: 100,
      count: { kind: "boardCondition", cond: { kind: "opponentPrizesRemaining", counts: [0, 1, 2] } },
    });
  });

  it("the three \"Fall\" rows: `yourEnergyInPlayAtLeast` 4 at the printed type", () => {
    const cond = (text: string) => {
      const bonus = deriveAttackDamageBonus(text);
      return bonus?.count.kind === "boardCondition" ? [bonus.per, bonus.count.cond] : bonus;
    };
    expect(cond(ELECTRO_FALL)).toEqual([90, { kind: "yourEnergyInPlayAtLeast", energy: "Lightning", count: 4 }]);
    expect(cond(FLARE_FALL)).toEqual([90, { kind: "yourEnergyInPlayAtLeast", energy: "Fire", count: 4 }]);
    expect(cond(CRYSTAL_FALL)).toEqual([90, { kind: "yourEnergyInPlayAtLeast", energy: "Water", count: 4 }]);
  });

  it("the template D119/D494 refused stays refused: a one-slot pattern would claim exactly the four literal rows", () => {
    const template = /^If you have at least (\d+) \{([A-Z])\} Energy in play, /;
    const claimed = [...legalAttackCorpus(), ...meAttackCorpus()].filter(([, text]) => template.test(text));
    expect(claimed.map(([, text]) => text).sort()).toEqual(
      [
        "If you have at least 3 {D} Energy in play, this attack does 50 more damage.",
        ELECTRO_FALL,
        FLARE_FALL,
        CRYSTAL_FALL,
      ].sort(),
    );
    for (const [, text] of claimed) expect(resolvedByAnyReader(text), text).toBe(true);
  });

  it("Seventh Kick: the requirement is `yourHandExactly` 7 (the skeleton owns the \"don't\")", () => {
    expect(deriveAttackRequirement(SEVENTH_KICK)).toEqual({ kind: "yourHandExactly", count: 7 });
  });

  it("Infernal Slash: the head is arm 6f's `payFromHand`, the cancel is 4 Basic {R} in hand", () => {
    expect(splitAttackCancelClause(INFERNAL_SLASH)?.head).toBe("Discard 4 Basic {R} Energy cards from your hand.");
    expect(deriveAttackEffect("Discard 4 Basic {R} Energy cards from your hand.")).toEqual([
      { op: "payFromHand", count: 4, to: "discard", filter: { kind: "basicEnergy", energyType: "Fire" } },
    ]);
    expect(deriveAttackCancelRequirement(INFERNAL_SLASH)).toEqual({
      kind: "yourBasicEnergyInHandAtLeast",
      energy: "Fire",
      count: 4,
    });
  });

  it("Carbink ×2: ONE object, Scovillain's `typesInPlay` at {F}{P}, no attack key (Counter Jewel derives)", () => {
    expect(programFor(CARBINK[0])).toEqual({ passive: { typesInPlay: ["Fighting", "Psychic"] } });
    expect(programFor(CARBINK[1])).toBe(programFor(CARBINK[0]));
    expect(programFor("sv08-037")).toEqual({ passive: { typesInPlay: ["Grass", "Fire"] } });
    expect(programFor(CARBINK[0])).not.toBe(programFor("sv08-037"));
    // The face: Scovillain's sentence with the printed pair swapped.
    const scovillain = "As long as this Pokémon is in play, it is {G} and {R} type.";
    expect(scovillain.replace("{G} and {R}", "{F} and {P}")).toBe(DOUBLE_TYPE_TEXT);
  });
});

// ── ON A BOARD: each row against a control on the other side of its threshold ──

const FILLER = "d586-filler";
const PSY_WEAK = "d586-psy-weak";
const L = "d586-lightning";
const R = "d586-fire";
const W = "d586-water";
const D = "d586-darkness";
const F = "d586-fighting";
const P = "d586-psychic";

const mon = (id: string, name: string, hp: number, type: string, attacks: Card["attacks"], extra: Partial<Card> = {}) =>
  battler(id, { name, hp, types: [type], retreat: 2, attacks, ...extra });

const LOCAL: Record<string, Card> = {
  "mep-090": mon(
    "mep-090",
    "Mega Darkrai ex",
    280,
    "Darkness",
    [
      {
        cost: ["Darkness", "Darkness"],
        name: "Dusk Raid",
        damage: "110+",
        effect: "If your Benched Pokémon have any damage counters on them, this attack does 110 more damage.",
      },
      { cost: ["Darkness", "Darkness", "Darkness"], name: "Abyss Eye", effect: ABYSS_EYE },
    ],
    { suffix: "ex" } as Partial<Card>,
  ),
  "mep-015": mon("mep-015", "Zacian", 130, "Psychic", [
    { cost: ["Psychic", "Colorless"], name: "Limit Break", damage: "50+", effect: LIMIT_BREAK },
  ]),
  "me02.5-117": mon(
    "me02.5-117",
    "Carbink",
    90,
    "Fighting",
    [{ cost: ["Fighting", "Fighting", "Colorless"], name: "Counter Jewel", damage: "70+", effect: COUNTER_JEWEL }],
    { abilities: [{ type: "Ability", name: "Double Type", effect: DOUBLE_TYPE_TEXT }] },
  ),
  "me01-048": mon("me01-048", "Raikou", 120, "Lightning", [
    { cost: ["Lightning", "Lightning"], name: "Electro Fall", damage: "30+", effect: ELECTRO_FALL },
  ]),
  "me02.5-025": mon("me02.5-025", "Entei", 140, "Fire", [
    { cost: ["Fire", "Fire"], name: "Flare Fall", damage: "30+", effect: FLARE_FALL },
  ]),
  "me02-026": mon("me02-026", "Suicune", 130, "Water", [
    { cost: ["Water", "Water"], name: "Crystal Fall", damage: "30+", effect: CRYSTAL_FALL },
  ]),
  "me02.5-104": mon(
    "me02.5-104",
    "Medicham",
    120,
    "Fighting",
    [{ cost: ["Fighting"], name: "Seventh Kick", damage: 150, effect: SEVENTH_KICK }],
    { stage: "Stage1", evolveFrom: "Meditite" },
  ),
  "mep-014": mon(
    "mep-014",
    "Ceruledge",
    140,
    "Fire",
    [{ cost: ["Fire"], name: "Infernal Slash", damage: 220, effect: INFERNAL_SLASH }],
    { stage: "Stage1", evolveFrom: "Charcadet" },
  ),
  [FILLER]: mon(FILLER, "D586 Filler", 400, "Colorless", [{ cost: ["Colorless"], name: "Tap", damage: 10 }]),
  [PSY_WEAK]: mon(PSY_WEAK, "D586 Psychic-weak", 400, "Colorless", [{ cost: ["Colorless"], name: "Tap", damage: 10 }], {
    weaknesses: [{ type: "Psychic", value: "×2" }],
  }),
  [L]: typedEnergy(L, "Lightning"),
  [R]: typedEnergy(R, "Fire"),
  [W]: typedEnergy(W, "Water"),
  [D]: typedEnergy(D, "Darkness"),
  [F]: typedEnergy(F, "Fighting"),
  [P]: typedEnergy(P, "Psychic"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  "mep-090": 1,
  "mep-015": 1,
  "me02.5-117": 1,
  "me01-048": 1,
  "me02.5-025": 1,
  "me02-026": 1,
  "me02.5-104": 1,
  "mep-014": 1,
  [FILLER]: 12,
  [PSY_WEAK]: 2,
  [L]: 6,
  [R]: 10,
  [W]: 6,
  [D]: 4,
  [F]: 4,
  [P]: 2,
  "fix-energy": 6,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own turn (P2 went first and passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 5863, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** TEST SURGERY — every copy of `id` that sits in `seat`'s Prizes swapped with a deck card. */
function unprize(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  let deck = [...side.deck];
  const prizes = side.prizes.map((u) => {
    if (state.cardIdByUid[u] !== id) return u;
    const swap = deck.find((d) => state.cardIdByUid[d] !== id);
    if (swap === undefined) throw new Error("no swap card");
    deck = [...deck.filter((d) => d !== swap), u];
    return swap;
  });
  return { ...state, players: { ...state.players, [seat]: { ...side, prizes, deck } } };
}

/** P1's Active is `attacker` with `energy` attached; P2's Active is `defender` with one Filler benched.
    The setup Actives go back to the decks first (a Filler takes the spot), so any Basic can be pulled. */
function table(attacker: string, energy: readonly (readonly [string, number])[], defender = FILLER): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const) {
    state = clearBench(setActiveFromDeck(state, s, FILLER), s);
    for (const id of [attacker, defender, FILLER]) state = unprize(state, s, id);
  }
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  for (const [id, n] of energy) state = attachFromDeck(state, "p1", id, n);
  state = clearBench(setActiveFromDeck(state, "p2", defender), "p2");
  return benchFromDeck(state, "p2", FILLER);
}

/** `seat`'s hand set to `ids` pulled from its deck, then topped up to `n` cards off the deck. */
function handOf(state: GameState, seat: Seat, n: number, ids: readonly string[] = []): GameState {
  const side = state.players[seat];
  let deck = [...side.hand, ...side.deck];
  const hand: string[] = [];
  for (const id of ids) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`${seat} deck has no more ${id}`);
    hand.push(uid);
    deck = deck.filter((u) => u !== uid);
  }
  while (hand.length < n) {
    const uid = deck.find((u) => !ids.includes(state.cardIdByUid[u] ?? ""));
    if (uid === undefined) throw new Error("deck ran out");
    hand.push(uid);
    deck = deck.filter((u) => u !== uid);
  }
  return { ...state, players: { ...state.players, [seat]: { ...side, hand, deck } } };
}

const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const dealt = (state: GameState, index = 0) => of(mustApply(state, attack(index)).events, "DAMAGE_DEALT")[0]?.dealt;

describe("D586 §3 — Abyss Eye: a defender affected by any Special Condition is Knocked Out", () => {
  const eye = (conditions: Partial<NonNullable<GameState["players"]["p2"]["active"]>["conditions"]>) => {
    const state = table("mep-090", [[D, 3]]);
    const active = state.players.p2.active;
    if (active === null) throw new Error("no p2 Active");
    const next = { ...active, conditions: { ...active.conditions, ...conditions } };
    return { ...state, players: { ...state.players, p2: { ...state.players.p2, active: next } } };
  };
  const knockedOut = (state: GameState) =>
    of(mustApply(state, attack(1)).events, "KNOCKED_OUT").map((e) => [e.seat, state.cardIdByUid[e.uid]]);

  it("each of the five conditions alone knocks the defender out", () => {
    for (const c of [
      { rotation: "asleep" as const },
      { rotation: "paralyzed" as const },
      { rotation: "confused" as const },
      { poisonDamage: 10 },
      { burned: true },
    ]) {
      expect(knockedOut(eye(c)), JSON.stringify(c)).toEqual([["p2", FILLER]]);
    }
  });

  it("a defender with no Special Condition is untouched (the gate, not a bare Knock Out)", () => {
    const result = mustApply(eye({}), attack(1));
    expect(of(result.events, "KNOCKED_OUT")).toEqual([]);
    expect(result.state.players.p2.active?.damage).toBe(0);
  });
});

describe("D586 §4 — the Prize rows: +90 at 3 or fewer (Zacian), +100 at 2 or fewer (Carbink)", () => {
  it("Limit Break: 50 + 90 at 3 and at 1 of the opponent's Prizes; 50 at 4 and at 6", () => {
    const zacian = (prizes: number) => setPrizes(table("mep-015", [[P, 1], ["fix-energy", 1]]), "p2", prizes);
    expect([3, 1, 4, 6].map((n) => dealt(zacian(n)))).toEqual([140, 140, 50, 50]);
  });

  it("the threshold reads the OPPONENT's Prizes, not yours", () => {
    const state = setPrizes(table("mep-015", [[P, 1], ["fix-energy", 1]]), "p1", 2);
    expect(dealt(state)).toBe(50);
  });

  it("Counter Jewel: 70 + 100 at 2 of the opponent's Prizes; 70 at 3", () => {
    const carbink = (prizes: number) =>
      setPrizes(table("me02.5-117", [[F, 2], ["fix-energy", 1]]), "p2", prizes);
    expect([2, 1, 3, 6].map((n) => dealt(carbink(n)))).toEqual([170, 170, 70, 70]);
  });
});

describe("D586 §5 — Double Type: Carbink is {F} and {P} in play (Scovillain's program, D578)", () => {
  it("its {F} attack hits a Psychic-weak defender for Weakness: 70 × 2", () => {
    expect(dealt(table("me02.5-117", [[F, 2], ["fix-energy", 1]], PSY_WEAK))).toBe(140);
  });

  it("the controls: no Weakness on the defender gives 70; Zacian's printed {P} hits the same defender for Weakness", () => {
    expect(dealt(table("me02.5-117", [[F, 2], ["fix-energy", 1]], FILLER))).toBe(70);
    expect(dealt(table("mep-015", [[P, 1], ["fix-energy", 1]], PSY_WEAK))).toBe(100);
  });
});

describe("D586 §6 — the three \"Fall\" attacks: +90 with at least 4 Energy of the printed type in play", () => {
  const fall = (id: string, own: string, n: number, benched = 0) => {
    let state = table(id, [[own, n]]);
    if (benched > 0) state = attachBenchFromDeck(benchFromDeck(state, "p1", FILLER), "p1", 0, own, benched);
    return state;
  };

  it("4 on the Active: 30 + 90; 3: 30 — each at its own type", () => {
    expect([dealt(fall("me01-048", L, 4)), dealt(fall("me01-048", L, 3))]).toEqual([120, 30]);
    expect([dealt(fall("me02.5-025", R, 4)), dealt(fall("me02.5-025", R, 3))]).toEqual([120, 30]);
    expect([dealt(fall("me02-026", W, 4)), dealt(fall("me02-026", W, 3))]).toEqual([120, 30]);
  });

  it("\"in play\" counts the Bench: 2 on the Active and 2 on a benched body reach 4", () => {
    expect(dealt(fall("me01-048", L, 2, 2))).toBe(120);
    expect(dealt(fall("me01-048", L, 2, 1))).toBe(30);
  });

  it("another type does not count: Raikou with {L}{L} and two {R} stays at 30", () => {
    expect(dealt(table("me01-048", [[L, 2], [R, 2]]))).toBe(30);
  });
});

describe("D586 §7 — Seventh Kick: does nothing unless your hand is exactly 7 cards", () => {
  const kick = (n: number) => handOf(table("me02.5-104", [[F, 1]]), "p1", n);

  it("7 cards: 150; 6 or 8: nothing", () => {
    expect(dealt(kick(7))).toBe(150);
    expect(of(mustApply(kick(6), attack(0)).events, "DAMAGE_DEALT")).toEqual([]);
    expect(of(mustApply(kick(8), attack(0)).events, "DAMAGE_DEALT")).toEqual([]);
  });

  it("the OPPONENT's hand of 7 does not count", () => {
    const state = handOf(kick(5), "p2", 7);
    expect(of(mustApply(state, attack(0)).events, "DAMAGE_DEALT")).toEqual([]);
  });
});

describe("D586 §8 — Infernal Slash: discard 4 Basic {R} from hand, or the attack does nothing", () => {
  const slash = (fire: number, other = 0) =>
    handOf(table("mep-014", [[R, 1]]), "p1", fire + other, [...Array(fire).fill(R), ...Array(other).fill(W)]);

  it("4 Basic {R} in hand: all four discarded and 220 dealt", () => {
    const result = mustApply(slash(4, 1), attack(0));
    expect(of(result.events, "DAMAGE_DEALT")[0]?.dealt).toBe(220);
    const discard = result.state.players.p1.discard.map((u) => result.state.cardIdByUid[u]);
    expect(discard.filter((id) => id === R)).toHaveLength(4);
    expect(result.state.players.p1.hand.map((u) => result.state.cardIdByUid[u])).toEqual([W]);
  });

  it("3 Basic {R} (and other Energy) in hand: nothing is dealt and nothing is discarded", () => {
    const result = mustApply(slash(3, 2), attack(0));
    expect(of(result.events, "DAMAGE_DEALT")).toEqual([]);
    expect(result.state.players.p1.hand).toHaveLength(5);
    expect(result.state.players.p1.discard.map((u) => result.state.cardIdByUid[u])).not.toContain(R);
  });
});

describe("D586 §9 — the version", () => {
  it("is built at engine 0.510.0", () => {
    expect(engineVersion).toBe("0.510.0");
  });
});
