import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { deriveAttackEffect, normaliseMeWording } from "./effects";
import type { GameAction, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { applyAction, createGame } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  typedEnergy,
  must,
  unprize,
} from "./testFixtures";

const TERMINAL_PERIOD =
  "If your opponent's Active Pokémon has exactly 6 damage counters on it, that Pokémon is Knocked Out.";
const BRING_DOWN =
  "Choose a Pokémon in play (yours or your opponent's) that has the least HP remaining, except for this Pokémon, and it is Knocked Out.";
const SNOW_COATING = "Double the number of damage counters on each of your opponent's Pokémon.";
const SNEAKY_PLACEMENT = "Place 1 damage counter on 1 of your opponent's Pokémon.";

const SENTENCES: readonly (readonly [string, readonly string[]])[] = [
  [TERMINAL_PERIOD, ["me01-086", "me01-161", "me01-180"]],
  [BRING_DOWN, ["me01-041", "me01-142", "mep-002"]],
  [SNOW_COATING, ["me02.5-051"]],
  [SNEAKY_PLACEMENT, ["me02-046"]],
];

const WP36_REST: readonly (readonly [string, readonly string[]])[] = [
  // a Knock Out SWEEP over every opponent body at or under an HP threshold (no op walks and KOs).
  [
    "Knock Out each of your opponent's Pokémon that has 50 HP or less remaining.",
    ["me03-053", "me03-105"],
  ],
  // a THIS-attack Prize bonus on a KO by its damage (`bountyDefender` is next-turn, Briar a Supporter).
  [
    "If your opponent's Pokémon is Knocked Out by damage from this attack, take 1 more Prize card.",
    ["30th-072"],
  ],
];

describe("D609 §1 — the texts", () => {
  it("4 sentences / 8 printings, each a row of the committed `me` corpus, none printed in legal `sv`, each now read", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, ids] of SENTENCES) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
      for (const id of ids) expect(programFor(id), id).toBeUndefined();
    }
    expect(SENTENCES.flatMap(([, ids]) => ids)).toHaveLength(8);
  });

  it("WP36's rest stays unbuilt: 2 texts / 3 printings, named ( D639: both BUILT — K3 + R1)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    for (const [text, ids] of WP36_REST) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      expect(resolvedByAnyReader(text), text).toBe(true);
      for (const id of ids) expect(programFor(id), id).toBeUndefined();
    }
  });
});

describe("D609 §2 — the readings", () => {
  it("Terminal Period: the counter gate in front of `knockOutDefender`, the count off the print", () => {
    expect(deriveAttackEffect(TERMINAL_PERIOD)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveDamageCountersExactly", count: 6 },
        then: [{ op: "knockOutDefender" }],
      },
    ]);
    expect(deriveAttackEffect(TERMINAL_PERIOD.replace("6", "4"))?.[0]).toMatchObject({
      cond: { kind: "opponentActiveDamageCountersExactly", count: 4 },
    });
    expect(deriveAttackEffect(TERMINAL_PERIOD.replace("6", "0"))).toBeNull();
    expect(deriveAttackEffect(`Draw a card. ${TERMINAL_PERIOD}`)).toBeNull();
    expect(deriveAttackEffect(`${TERMINAL_PERIOD} Draw a card.`)).toBeNull();
    expect(
      deriveAttackEffect(
        TERMINAL_PERIOD.replace(" that Pokémon is Knocked Out.", " it is Knocked Out."),
      ),
    ).toBeNull();
    expect(conditionNote({ kind: "opponentActiveDamageCountersExactly", count: 6 })).toBe(
      "your opponent's Active Pokémon has exactly 6 damage counters on it",
    );
  });

  it("Bring Down: one `knockOutChosen` over both sides with the least-HP rider", () => {
    expect(deriveAttackEffect(BRING_DOWN)).toEqual([
      { op: "knockOutChosen", target: "anyExceptSelf", leastHpRemaining: true },
    ]);
    expect(deriveAttackEffect(BRING_DOWN.replace(", except for this Pokémon", ""))).toBeNull();
    expect(deriveAttackEffect(BRING_DOWN.replace("(yours or your opponent's) ", ""))).toBeNull();
    expect(deriveAttackEffect(`${BRING_DOWN} Draw a card.`)).toBeNull();
  });

  it("Snow Coating: `counterEachAll` at 10 per counter on the opponent's side", () => {
    expect(deriveAttackEffect(SNOW_COATING)).toEqual([
      {
        op: "counterEachAll",
        amount: 10,
        filter: { kind: "anyPokemon" },
        side: "opponent",
        source: "attack",
        perDamageCounterOnTarget: true,
      },
    ]);
    expect(deriveAttackEffect(SNOW_COATING.replace("your opponent's", "your"))).toBeNull();
    expect(deriveAttackEffect(SNOW_COATING.replace("Double", "Triple"))).toBeNull();
    expect(deriveAttackEffect(`${SNOW_COATING} Draw a card.`)).toBeNull();
  });

  it("Sneaky Placement: the singular is D449's put at 1; the Active singular stays unread ( D627 (D539): built since D627)", () => {
    const one = [
      { op: "damageChosen", target: "opponentAny", amount: 10, count: 1, source: "attack" },
    ];
    expect(deriveAttackEffect(SNEAKY_PLACEMENT)).toEqual(one);
    expect(deriveAttackEffect("Put 1 damage counter on 1 of your opponent's Pokémon.")).toEqual(
      one,
    );
    expect(normaliseMeWording(SNEAKY_PLACEMENT)).toBe(
      "Put 1 damage counter on 1 of your opponent's Pokémon.",
    );
    // The plural reads as it always did (Swirlix `sv06-089`).
    expect(deriveAttackEffect("Put 2 damage counters on 1 of your opponent's Pokémon.")).toEqual([
      { ...one[0], amount: 20 },
    ]);
    expect(deriveAttackEffect("Place 1 damage counter on your opponent's Active Pokémon.")).toEqual(
      [{ op: "damageActive", amount: 10, source: "attack" }],
    );
    expect(deriveAttackEffect(SNEAKY_PLACEMENT.replace("1 damage", "0 damage"))).toBeNull();
    expect(deriveAttackEffect("Put 2 damage counter on 1 of your opponent's Pokémon.")).toBeNull();
    expect(
      normaliseMeWording("Then, place 1 damage counter on 1 of your opponent's Pokémon."),
    ).toBe("Then, place 1 damage counter on 1 of your opponent's Pokémon.");
  });

  it("the widened synonym is still the identity on every legal `sv` sentence", () => {
    for (const [, text] of legalAttackCorpus()) expect(normaliseMeWording(text), text).toBe(text);
  });
});

// ── ON A BOARD ──

const FILLER = "d609-filler";
const SMALL = "d609-small";
const WEAK = "d609-weak-to-darkness";
const W = "d609-water";
const D = "d609-darkness";
const P = "d609-psychic";

const mon = (
  id: string,
  name: string,
  hp: number,
  type: string,
  attacks: Card["attacks"],
  extra: Partial<Card> = {},
) => battler(id, { name, hp, types: [type], retreat: 2, attacks, ...extra });
const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];

const LOCAL: Record<string, Card> = {
  "me01-086": mon("me01-086", "Mega Absol ex", 280, "Darkness", [
    { cost: ["Darkness", "Colorless"], name: "Terminal Period", effect: TERMINAL_PERIOD },
  ]),
  "me01-041": mon(
    "me01-041",
    "Inteleon",
    150,
    "Water",
    [
      { cost: ["Water"], name: "Bring Down", effect: BRING_DOWN },
      {
        cost: ["Water"],
        name: "Water Shot",
        damage: 110,
        effect: "Discard an Energy from this Pokémon.",
      },
    ],
    { stage: "Stage2", evolveFrom: "Drizzile" },
  ),
  "me02.5-051": mon(
    "me02.5-051",
    "N's Vanilluxe",
    150,
    "Water",
    [{ cost: ["Colorless", "Colorless"], name: "Snow Coating", effect: SNOW_COATING }],
    { stage: "Stage2", evolveFrom: "N's Vanillish" },
  ),
  "me02-046": mon("me02-046", "Bramblin", 50, "Psychic", [
    { cost: ["Psychic"], name: "Sneaky Placement", effect: SNEAKY_PLACEMENT },
  ]),
  [FILLER]: mon(FILLER, "D609 Filler", 400, "Colorless", TAP),
  [SMALL]: mon(SMALL, "D609 Small", 60, "Colorless", TAP),
  [WEAK]: mon(WEAK, "D609 Weak", 400, "Psychic", TAP, {
    weaknesses: [{ type: "Water", value: "×2" }],
  }),
  [W]: typedEnergy(W, "Water"),
  [D]: typedEnergy(D, "Darkness"),
  [P]: typedEnergy(P, "Psychic"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  "me01-086": 1,
  "me01-041": 1,
  "me02.5-051": 1,
  "me02-046": 1,
  [FILLER]: 10,
  [SMALL]: 4,
  [WEAK]: 2,
  "fix-unaware": 2,
  [W]: 4,
  [D]: 4,
  [P]: 4,
  "fix-energy": 26,
});
const BOARD_IDS = new Set([...Object.keys(LOCAL).filter((id) => id !== FILLER), "fix-unaware"]);

/** Setup, then P1's own FIRST turn (P2 went first and passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6092, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find(
      (h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic",
    );
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const)
    state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    state = {
      ...state,
      players: { ...state.players, [s]: { ...side, hand: [], deck: [...side.deck, ...side.hand] } },
    };
  }
  return state;
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
  for (const s of ["p1", "p2"] as const)
    state = unprize(clearBench(setActiveFromDeck(state, s, FILLER), s), s, BOARD_IDS);
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  for (const [id, n] of energy) state = attachFromDeck(state, "p1", id, n);
  for (const id of ownBench) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", defender), "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  return state;
}

const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const ACTIVE: PokemonRef = { seat: "p2", spot: { spot: "active" } };
const bench = (index: number, seat: Seat = "p2"): PokemonRef => ({
  seat,
  spot: { spot: "bench", index },
});
const pick = (state: GameState, ref: PokemonRef) =>
  mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemon", ref },
  } as GameAction);
const damageOf = (state: GameState) => [
  state.players.p2.active?.damage ?? -1,
  ...state.players.p2.bench.map((b) => b.damage),
];
const koIds = (state: GameState, events: readonly GameEvent[]) =>
  of(events, "KNOCKED_OUT").map((e) => [e.seat, state.cardIdByUid[e.uid]]);

function parked(state: GameState) {
  if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "choosePokemon") {
    throw new Error(`expected a choosePokemon park, got ${state.phase.kind}`);
  }
  return state.phase.prompt;
}

describe("D609 §3 — Terminal Period: exactly 6 counters on the opponent's Active", () => {
  const swing = (damage: number, defender: string = FILLER) =>
    mustApply(setDamage(table("me01-086", [[D, 2]], defender), "p2", damage), attack(0));

  it("60 damage: the Defending Pokémon is Knocked Out", () => {
    const result = swing(60);
    expect(koIds(result.state, result.events)).toEqual([["p2", FILLER]]);
  });

  it("50 and 70: nothing happens", () => {
    for (const damage of [0, 50, 70]) {
      const result = swing(damage);
      expect(of(result.events, "KNOCKED_OUT"), String(damage)).toEqual([]);
      expect(result.state.players.p2.active?.damage).toBe(damage);
    }
  });

  it("the member reads the OPPONENT's Active; an effects shield refuses the Knock Out", () => {
    const cond = { kind: "opponentActiveDamageCountersExactly", count: 6 } as const;
    const state = setDamage(table("me01-086", [[D, 2]]), "p2", 60);
    expect(conditionHolds(state, "p1", cond)).toBe(true);
    expect(conditionHolds(state, "p2", cond)).toBe(false);
    const shielded = swing(60, "fix-unaware");
    expect(of(shielded.events, "KNOCKED_OUT")).toEqual([]);
    expect(of(shielded.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
  });
});

describe("D609 §4 — Bring Down: the least HP remaining, either side, never the attacker", () => {
  it("a lone least-HP body on the opponent's Bench is forced: it is Knocked Out, no prompt", () => {
    const result = mustApply(table("me01-041", [[W, 1]], FILLER, [FILLER, SMALL]), attack(0));
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(koIds(result.state, result.events)).toEqual([["p2", SMALL]]);
  });

  it("a tie parks on exactly the tied bodies, captioned with the printed sentence", () => {
    const state = setBenchDamage(
      table("me01-041", [[W, 1]], FILLER, [SMALL, FILLER, SMALL], [SMALL]),
      "p1",
      0,
      0,
    );
    const prompt = parked(mustApply(state, attack(0)).state);
    expect(prompt.candidates).toEqual([bench(0, "p1"), bench(0), bench(2)]);
    expect(prompt.note).toBe(BRING_DOWN);
    const result = pick(mustApply(state, attack(0)).state, bench(2));
    expect(koIds(result.state, result.events)).toEqual([["p2", SMALL]]);
  });

  it("YOUR OWN body can be the least: it is Knocked Out", () => {
    const state = setBenchDamage(
      table("me01-041", [[W, 1]], FILLER, [SMALL], [SMALL]),
      "p1",
      0,
      30,
    );
    const result = mustApply(state, attack(0));
    expect(koIds(result.state, result.events)).toEqual([["p1", SMALL]]);
  });

  it("the attacker is excluded even when it has the least HP remaining", () => {
    const state = setDamage(table("me01-041", [[W, 1]], FILLER, [SMALL]), "p1", 140);
    const result = mustApply(state, attack(0));
    expect(koIds(result.state, result.events)).toEqual([["p2", SMALL]]);
    expect(result.state.players.p1.active?.damage).toBe(140);
  });

  it("R-BD1: a shielded least-HP body is not replaced by the next one — nothing is Knocked Out", () => {
    const state = setBenchDamage(
      table("me01-041", [[W, 1]], FILLER, ["fix-unaware", SMALL]),
      "p2",
      0,
      200,
    );
    const result = mustApply(state, attack(0));
    expect(of(result.events, "KNOCKED_OUT")).toEqual([]);
    expect(of(result.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    expect(result.state.phase.kind).not.toBe("effect:choose");
  });
});

describe("D609 §5 — Snow Coating: each opponent body's counters doubled", () => {
  it("30 / 20 / 0 → 60 / 40 / 0: counters PLACED (no Weakness), none on an undamaged body", () => {
    let state = table("me02.5-051", [["fix-energy", 2]], WEAK, [FILLER, FILLER]);
    state = setBenchDamage(setDamage(state, "p2", 30), "p2", 0, 20);
    const result = mustApply(state, attack(0));
    expect(damageOf(result.state)).toEqual([60, 40, 0]);
    expect(of(result.events, "COUNTERS_PLACED").map((e) => e.amount)).toEqual([30, 20]);
    expect(of(result.events, "DAMAGE_DEALT")).toEqual([]);
  });

  it("an effects shield keeps its counters; the attacker's own side is untouched", () => {
    let state = table("me02.5-051", [["fix-energy", 2]], "fix-unaware", [FILLER]);
    state = setBenchDamage(setDamage(setDamage(state, "p2", 30), "p1", 40), "p2", 0, 10);
    const result = mustApply(state, attack(0));
    expect(damageOf(result.state)).toEqual([30, 20]);
    expect(of(result.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    expect(result.state.players.p1.active?.damage).toBe(40);
  });

  it("doubling to lethal Knocks Out", () => {
    const state = setDamage(table("me02.5-051", [["fix-energy", 2]], SMALL), "p2", 30);
    const result = mustApply(state, attack(0));
    expect(koIds(result.state, result.events)).toEqual([["p2", SMALL]]);
  });
});

describe("D609 §6 — Sneaky Placement: 1 counter on 1 of the opponent's Pokémon", () => {
  it("a lone Active is forced: 10 placed, no Weakness", () => {
    const result = mustApply(table("me02-046", [[P, 1]], WEAK), attack(0));
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(damageOf(result.state)).toEqual([10]);
    expect(of(result.events, "COUNTERS_PLACED").map((e) => e.amount)).toEqual([10]);
  });

  it("with a Bench, the pick parks and lands where chosen", () => {
    const state = mustApply(table("me02-046", [[P, 1]], FILLER, [FILLER]), attack(0)).state;
    if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "choosePokemonMulti") {
      throw new Error(`expected a pokemonMulti park, got ${state.phase.kind}`);
    }
    expect(state.phase.prompt.candidates).toEqual([ACTIVE, bench(0)]);
    const result = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [bench(0)] },
    } as GameAction);
    expect(damageOf(result.state)).toEqual([0, 10]);
  });
});
