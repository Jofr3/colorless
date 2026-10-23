import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import {
  deriveAttackEffect,
  deriveAttackRequirement,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import type { GameAction, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { applyAction, createGame } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  discardFromDeck,
  mustApply,
  setActiveFromDeck,
  setConditions,
  typedEnergy,
  must,
} from "./testFixtures";

const CLARIFIER = " (Don't apply Weakness and Resistance for Benched Pokémon.)";
const BUGS_CANNON = `This attack does 20 damage to 1 of your opponent's Pokémon for each {G} Energy attached to this Pokémon.${CLARIFIER}`;
const HYDRO_JET = `This attack does 30 damage to 1 of your opponent's Pokémon for each {W} Energy attached to this Pokémon.${CLARIFIER}`;
const LIGHTNING_CRASH = `Discard all {L} Energy from this Pokémon, and this attack does 90 damage to 1 of your opponent's Pokémon.${CLARIFIER}`;
const TAR_CANNON = `This attack does 140 damage to 1 of your opponent's Pokémon. If you don't have 10 or more Basic {F} Energy cards in your discard pile, this attack does nothing.${CLARIFIER}`;
const CHILLING_WINGS = `This attack does 20 damage to each of your opponent's Pokémon.${CLARIFIER} Your opponent's Active Pokémon is now Asleep.`;
const KABOOM_NEEDLES = `This attack does 50 damage to each of your opponent's Pokémon.${CLARIFIER} This Pokémon also does 130 damage to itself.`;
const ASSASSINS_MAGIC =
  "If your opponent's Active Pokémon is affected by a Special Condition, place 6 damage counters on 1 of your opponent's Benched Pokémon.";
const PSYSPEAR = `If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack also does 120 damage to 1 of your opponent's Benched Pokémon.${CLARIFIER}`;

const SENTENCES: readonly (readonly [string, string])[] = [
  [BUGS_CANNON, "me02-008"],
  [HYDRO_JET, "me05-014"],
  [LIGHTNING_CRASH, "30th-051"],
  [TAR_CANNON, "me02.5-120"],
  [CHILLING_WINGS, "me01-043"],
  [KABOOM_NEEDLES, "30th-104"],
  [ASSASSINS_MAGIC, "me02.5-086"],
];

describe("D629 §1 — the texts", () => {
  it("7 sentences / 7 printings, each a row of the committed `me` corpus, none printed in legal `sv`, each now built", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, id] of SENTENCES) {
      expect([id, me.get(text)]).toEqual([id, 1]);
      expect(sv.has(text), id).toBe(false);
      expect(programFor(id), id).toBeUndefined();
      const composed = text === CHILLING_WINGS || text === KABOOM_NEEDLES;
      expect([id, resolvedByAnyReader(text)]).toEqual([id, !composed]);
      expect([id, splitAttackTrailingClause(text) !== null]).toEqual([id, composed]);
    }
  });

  it("Psyspear ~~stays unbuilt, named: no reader~~, no composition, no key ( D645 (D539): WITHDRAWN — reader-built at D645, `lastOneOffsMeD645.test.ts`)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    expect(me.get(PSYSPEAR)).toBe(1);
    expect(resolvedByAnyReader(PSYSPEAR)).toBe(true);
    expect(splitAttackTrailingClause(PSYSPEAR)).toBeNull();
    expect(programFor("me04-032")).toBeUndefined();
  });
});

describe("D629 §2 — the readings", () => {
  it("Bug's Cannon / Hydro Jet: the typed per-Energy snipe; the untyped sentence keeps `perEnergyOnSelf`", () => {
    const typed = (amount: number, type: string) => [
      {
        op: "damageChosen",
        target: "opponentAny",
        amount,
        count: 1,
        source: "attack",
        deals: true,
        perTypedEnergyOnSelf: type,
      },
    ];
    expect(deriveAttackEffect(BUGS_CANNON)).toEqual(typed(20, "Grass"));
    expect(deriveAttackEffect(HYDRO_JET)).toEqual(typed(30, "Water"));
    expect(deriveAttackEffect(BUGS_CANNON.replace("{G} ", ""))).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 20,
        count: 1,
        source: "attack",
        deals: true,
        perEnergyOnSelf: true,
      },
    ]);
    // The clarifier is optional; {C} is no Basic type; a printed 0 stays loud.
    expect(deriveAttackEffect(BUGS_CANNON.replace(CLARIFIER, ""))).toEqual(typed(20, "Grass"));
    expect(deriveAttackEffect(BUGS_CANNON.replace("{G}", "{C}"))).toBeNull();
    expect(deriveAttackEffect(BUGS_CANNON.replace("does 20", "does 0"))).toBeNull();
  });

  it("Lightning Crash: discard every {L}-providing Energy, then 90 to 1 of the opponent's Pokémon", () => {
    expect(deriveAttackEffect(LIGHTNING_CRASH)).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType: "Lightning" },
        count: "all",
      },
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 90,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
    expect(deriveAttackEffect(LIGHTNING_CRASH.replace("{L}", "{C}"))).toBeNull();
    expect(deriveAttackEffect(LIGHTNING_CRASH.replace("does 90", "does 0"))).toBeNull();
  });

  it("Tar Cannon: the second-sentence requirement and its body; the effect reader refuses the whole", () => {
    expect(deriveAttackEffect(TAR_CANNON)).toBeNull();
    expect(deriveAttackRequirement(TAR_CANNON)).toEqual({
      kind: "yourBasicEnergyInDiscardAtLeast",
      energy: "Fighting",
      count: 10,
    });
    const split = splitAttackRequirementClause(TAR_CANNON);
    expect(split).toEqual({
      clause:
        "If you don't have 10 or more Basic {F} Energy cards in your discard pile, this attack does nothing.",
      body: `This attack does 140 damage to 1 of your opponent's Pokémon.${CLARIFIER}`,
    });
    expect(deriveAttackEffect(split?.body ?? "")).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 140,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
    // An unmapped clause keeps the whole string loud; without the clarifier the body is the bare sentence.
    const unmapped = TAR_CANNON.replace("10 or more", "9 or more");
    expect(deriveAttackRequirement(unmapped)).toBeNull();
    expect(splitAttackRequirementClause(unmapped)).toBeNull();
    expect(splitAttackRequirementClause(TAR_CANNON.replace(CLARIFIER, ""))?.body).toBe(
      "This attack does 140 damage to 1 of your opponent's Pokémon.",
    );
  });

  it("Chilling Wings / Kaboom Needles: the head keeps the clarifier, the tail is the sentence after it", () => {
    const head = (amount: number) =>
      `This attack does ${String(amount)} damage to each of your opponent's Pokémon.${CLARIFIER}`;
    expect(splitAttackTrailingClause(CHILLING_WINGS)).toEqual({
      head: head(20),
      tail: "Your opponent's Active Pokémon is now Asleep.",
    });
    expect(splitAttackTrailingClause(KABOOM_NEEDLES)).toEqual({
      head: head(50),
      tail: "This Pokémon also does 130 damage to itself.",
    });
    expect(deriveAttackEffect(head(20))).toEqual([
      { op: "damageDefender", amount: 20 },
      { op: "spreadDamage", target: "opponentBench", amount: 20 },
    ]);
    expect(deriveAttackEffect("This Pokémon also does 130 damage to itself.")).toEqual([
      { op: "damageSelf", amount: 130 },
    ]);
    // An unread tail keeps the compound whole and loud.
    expect(
      splitAttackTrailingClause(CHILLING_WINGS.replace("is now Asleep", "is now Sleepy")),
    ).toBeNull();
  });

  it("Assassin's Magic: the Benched placement inside the clause-table gate", () => {
    expect(deriveAttackEffect(ASSASSINS_MAGIC)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveHasSpecialCondition" },
        then: [
          { op: "damageChosen", target: "opponentBench", amount: 60, count: 1, source: "attack" },
        ],
      },
    ]);
    expect(
      deriveAttackEffect(ASSASSINS_MAGIC.replace("affected by a Special Condition", "a Pokémon")),
    ).toBeNull();
    expect(deriveAttackEffect(ASSASSINS_MAGIC.replace("place 6", "place 0"))).toBeNull();
  });
});

// ── ON A BOARD ──

const FILLER = "d629-filler";
const TARGET_G = "d629-weak-to-grass";
const TARGET_W = "d629-weak-to-water";
const G = "d629-grass";
const W = "d629-water";
const L = "d629-lightning";
const F = "d629-fighting";
const M = "d629-metal";
const P = "d629-psychic";

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
  "me02-008": mon("me02-008", "Genesect", 120, "Grass", [
    { cost: ["Grass"], name: "Bug's Cannon", effect: BUGS_CANNON },
    { cost: ["Grass", "Grass", "Colorless"], name: "Speed Attack", damage: 110 },
  ]),
  "me05-014": mon(
    "me05-014",
    "Seaking",
    110,
    "Water",
    [{ cost: ["Colorless", "Colorless", "Colorless"], name: "Hydro Jet", effect: HYDRO_JET }],
    { stage: "Stage1", evolveFrom: "Goldeen" },
  ),
  "30th-051": mon("30th-051", "Pikachu", 70, "Lightning", [
    {
      cost: ["Lightning", "Lightning", "Lightning"],
      name: "Lightning Crash",
      effect: LIGHTNING_CRASH,
    },
  ]),
  "me02.5-120": mon(
    "me02.5-120",
    "Coalossal",
    180,
    "Fighting",
    [
      { cost: ["Fighting"], name: "Tar Cannon", effect: TAR_CANNON },
      {
        cost: ["Fighting", "Colorless", "Colorless", "Colorless"],
        name: "Bulky Bump",
        damage: 220,
        effect: "Discard 3 Energy from this Pokémon.",
      },
    ],
    { stage: "Stage2", evolveFrom: "Carkol" },
  ),
  "me01-043": mon(
    "me01-043",
    "Frosmoth",
    110,
    "Water",
    [{ cost: ["Water"], name: "Chilling Wings", effect: CHILLING_WINGS }],
    { stage: "Stage1", evolveFrom: "Snom" },
  ),
  "30th-104": mon(
    "30th-104",
    "Ferrothorn",
    130,
    "Metal",
    [
      { cost: ["Colorless", "Colorless"], name: "Spike Sting", damage: 50 },
      { cost: ["Metal", "Metal"], name: "Kaboom Needles", effect: KABOOM_NEEDLES },
    ],
    { stage: "Stage1", evolveFrom: "Ferroseed" },
  ),
  "me02.5-086": mon(
    "me02.5-086",
    "Mismagius",
    110,
    "Psychic",
    [
      {
        cost: ["Psychic", "Colorless"],
        name: "Assassin's Magic",
        damage: 60,
        effect: ASSASSINS_MAGIC,
      },
    ],
    { stage: "Stage1", evolveFrom: "Misdreavus" },
  ),
  [FILLER]: mon(FILLER, "D629 Filler", 400, "Colorless", TAP),
  [TARGET_G]: mon(TARGET_G, "D629 Leaf Target", 400, "Water", TAP, {
    weaknesses: [{ type: "Grass", value: "×2" }],
  }),
  [TARGET_W]: mon(TARGET_W, "D629 Tide Target", 400, "Fire", TAP, {
    weaknesses: [{ type: "Water", value: "×2" }],
  }),
  [G]: typedEnergy(G, "Grass"),
  [W]: typedEnergy(W, "Water"),
  [L]: typedEnergy(L, "Lightning"),
  [F]: typedEnergy(F, "Fighting"),
  [M]: typedEnergy(M, "Metal"),
  [P]: typedEnergy(P, "Psychic"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  "me02-008": 1,
  "me05-014": 1,
  "30th-051": 1,
  "me02.5-120": 1,
  "me01-043": 1,
  "30th-104": 1,
  "me02.5-086": 1,
  [FILLER]: 8,
  [TARGET_G]: 2,
  [TARGET_W]: 2,
  [G]: 3,
  [W]: 3,
  [L]: 3,
  [F]: 12,
  [M]: 2,
  [P]: 2,
  "fix-energy": 16,
});
const BOARD_IDS = new Set(Object.keys(LOCAL).filter((id) => id !== FILLER));

/** Setup, then P1's own FIRST turn (P2 went first and passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6291, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** TEST SURGERY — every Prize whose id is a board id swapped with a non-board deck card. */
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

/** P1's Active is `attacker` with `energy` (and a Filler on the Bench); P2's Active is `defender` with `bench`. */
function table(
  attacker: string,
  energy: readonly (readonly [string, number])[],
  defender: string = FILLER,
  bench: readonly string[] = [],
): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const)
    state = unprize(clearBench(setActiveFromDeck(state, s, FILLER), s), s);
  state = benchFromDeck(clearBench(setActiveFromDeck(state, "p1", attacker), "p1"), "p1", FILLER);
  for (const [id, n] of energy) state = attachFromDeck(state, "p1", id, n);
  state = clearBench(setActiveFromDeck(state, "p2", defender), "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  return state;
}

const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const ACTIVE: PokemonRef = { seat: "p2", spot: { spot: "active" } };
const bench = (index: number): PokemonRef => ({ seat: "p2", spot: { spot: "bench", index } });
const pick = (state: GameState, refs: readonly PokemonRef[]) =>
  mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [...refs] },
  } as GameAction);
const damageOf = (state: GameState) => [
  state.players.p2.active?.damage ?? -1,
  ...state.players.p2.bench.map((b) => b.damage),
];
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);

function parkedMulti(state: GameState) {
  if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "choosePokemonMulti") {
    throw new Error(`expected a pokemonMulti park, got ${state.phase.kind}`);
  }
  return state.phase.prompt;
}

describe("D629 §3 — the typed per-Energy snipe on a board", () => {
  it("Bug's Cannon: 2 {G} of 3 Energy → 40 per pick; the {G}-weak Active takes Weakness (80)", () => {
    const parked = mustApply(
      table(
        "me02-008",
        [
          [G, 2],
          ["fix-energy", 1],
        ],
        TARGET_G,
        [FILLER],
      ),
      attack(0),
    ).state;
    const prompt = parkedMulti(parked);
    expect([prompt.min, prompt.max, prompt.candidates.length]).toEqual([1, 1, 2]);
    expect(prompt.note).toBe("Choose 1 of your opponent's Pokémon (40 damage each).");
    expect(damageOf(pick(parked, [ACTIVE]).state)).toEqual([80, 0]);
    expect(damageOf(pick(parked, [bench(0)]).state)).toEqual([0, 40]);
  });

  it("Hydro Jet: 2 {W} of 3 Energy → 60 to the Benched pick", () => {
    const parked = mustApply(
      table(
        "me05-014",
        [
          [W, 2],
          ["fix-energy", 1],
        ],
        FILLER,
        [TARGET_W],
      ),
      attack(0),
    ).state;
    expect(parkedMulti(parked).note).toBe("Choose 1 of your opponent's Pokémon (60 damage each).");
    expect(damageOf(pick(parked, [bench(0)]).state)).toEqual([0, 60]);
  });

  it("Hydro Jet with no {W} Energy: 0, no park and no damage", () => {
    const result = mustApply(table("me05-014", [["fix-energy", 3]], FILLER, [FILLER]), attack(0));
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(damageOf(result.state)).toEqual([0, 0]);
  });
});

describe("D629 §4 — Lightning Crash on a board", () => {
  it("the {L} Energy go first (the other Energy stays), then 90 to the pick", () => {
    const parked = mustApply(
      table(
        "30th-051",
        [
          [L, 3],
          ["fix-energy", 1],
        ],
        FILLER,
        [FILLER],
      ),
      attack(0),
    ).state;
    expect(ids(parked, parked.players.p1.active?.energy ?? [])).toEqual(["fix-energy"]);
    expect(ids(parked, parked.players.p1.discard)).toEqual([L, L, L]);
    expect(damageOf(pick(parked, [bench(0)]).state)).toEqual([0, 90]);
  });
});

describe("D629 §5 — Tar Cannon's requirement on a board", () => {
  it("10 Basic {F} Energy cards in the discard pile: the snipe resolves (140 to the pick)", () => {
    const state = discardFromDeck(table("me02.5-120", [[F, 1]], FILLER, [FILLER]), "p1", F, 10);
    const parked = mustApply(state, attack(0));
    expect(of(parked.events, "ATTACK_FAILED")).toEqual([]);
    expect(damageOf(pick(parked.state, [bench(0)]).state)).toEqual([0, 140]);
  });

  it("9 of them: the attack does nothing — ATTACK_FAILED (requirement), no park, no damage", () => {
    const state = discardFromDeck(table("me02.5-120", [[F, 1]], FILLER, [FILLER]), "p1", F, 9);
    const result = mustApply(state, attack(0));
    expect(of(result.events, "ATTACK_FAILED").map((e) => e.reason)).toEqual(["requirement"]);
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(damageOf(result.state)).toEqual([0, 0]);
  });
});

describe("D629 §6 — the two compounds on a board", () => {
  it("Chilling Wings: 20 to each (the {W}-weak Active 40), then the Active is Asleep", () => {
    const result = mustApply(table("me01-043", [[W, 1]], TARGET_W, [FILLER, FILLER]), attack(0));
    expect(damageOf(result.state)).toEqual([40, 20, 20]);
    // The status lands after the spread (the Checkup's coin may wake it before the next turn).
    const order = result.events
      .filter((e) => e.type === "DAMAGE_DEALT" || e.type === "STATUS_APPLIED")
      .map((e) => e.type);
    expect(order[order.length - 1]).toBe("STATUS_APPLIED");
    expect(of(result.events, "STATUS_APPLIED")).toMatchObject([{ seat: "p2", status: "asleep" }]);
    expect(of(result.events, "ATTACK_EFFECT_SKIPPED")).toEqual([]);
  });

  it("Kaboom Needles: 50 to each, then 130 to itself — Ferrothorn is Knocked Out", () => {
    const result = mustApply(table("30th-104", [[M, 2]], FILLER, [FILLER]), attack(1));
    expect(damageOf(result.state)).toEqual([50, 50]);
    expect(ids(result.state, result.state.players.p1.discard)).toContain("30th-104");
    expect(of(result.events, "ATTACK_EFFECT_SKIPPED")).toEqual([]);
  });
});

describe("D629 §7 — Assassin's Magic on a board", () => {
  it("a Confused Active: 60 to it, then 6 counters on the Benched pick", () => {
    const state = setConditions(
      table(
        "me02.5-086",
        [
          [P, 1],
          ["fix-energy", 1],
        ],
        FILLER,
        [FILLER, FILLER],
      ),
      "p2",
      { rotation: "confused" },
    );
    const parked = mustApply(state, attack(0)).state;
    expect(parkedMulti(parked).candidates).toEqual([bench(0), bench(1)]);
    expect(damageOf(pick(parked, [bench(1)]).state)).toEqual([60, 0, 60]);
  });

  it("no Special Condition: the 60 only, no park", () => {
    const result = mustApply(
      table(
        "me02.5-086",
        [
          [P, 1],
          ["fix-energy", 1],
        ],
        FILLER,
        [FILLER],
      ),
      attack(0),
    );
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(damageOf(result.state)).toEqual([60, 0]);
  });
});
