import { describe, expect, it } from "vitest";
import type { Card } from "@colorless/schema";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { countAttachedEnergy, providedEnergy } from "./continuous";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackCopy,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
  optionalCostBoostProgram,
} from "./effects";
import { conditionHolds, conditionNote } from "./interpreter";
import { applyAction, createGame } from "./index";
import type { BoardCondition, EffectOp, GameEvent, GameState, PokemonRef, Seat } from "./index";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  types,
  must,
  firstBasicInHand,
  findEvent,
} from "./testFixtures";

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackDiscardScaledBoost,
];

const TORRENTIAL =
  "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const PRIZE_FLIP =
  "You may turn 1 of your face-down Prize cards face up. If you do, this attack does 80 more damage. (That Prize card remains face up for the rest of the game.)";
const CRUSHING_PRESS =
  "You may discard a Stadium in play. If you do, this attack does 140 more damage.";

const FAMILY = /^You may .*If you do,/;

const TORRENT = "fix-torrent";
const BODY = "fix-bigbody";
const WATER = "fix-water-energy";
const COLORLESS = "fix-energy";
const NEO_UPPER = "fix-neo-upper-energy";
const NEO_STAGE2 = "fix-neo-stage2";

const FOUR = "fix-d383-four";
const FOUR_TEXT =
  "You may shuffle 4 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const LOCAL_CARDS: Record<string, Card> = {
  [FOUR]: battler(FOUR, {
    hp: 210,
    types: ["Water"],
    attacks: [
      {
        cost: ["Water", "Colorless", "Colorless"],
        name: "Torrential Pump",
        damage: 100,
        effect: FOUR_TEXT,
      },
    ],
  }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [TORRENT]: 4,
  [FOUR]: 4,
  [NEO_STAGE2]: 2,
  [NEO_UPPER]: 2,
  [WATER]: 6,
  [COLORLESS]: 10,
  [BODY]: 32,
});

const SEEDS = [8101, 8117, 8133] as const;

function apply(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result;
}

/** Setup driven over the LOCAL pool, P2 going first. */
function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** TEST SURGERY, the local twin of `attachFromDeck`: the shared helper takes ONE
    card id, and every board here needs a MIX (the printed cost is {W}{C}{C}). */
function fuel(state: GameState, seat: Seat, cardId: string, count: number): GameState {
  const side = state.players[seat];
  if (side.active === null) throw new Error(`${seat} has no Active`);
  const uids = side.deck.filter((uid) => state.cardIdByUid[uid] === cardId).slice(0, count);
  if (uids.length < count) throw new Error(`${seat} deck has ${uids.length} ${cardId}`);
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((uid) => !taken.has(uid)),
        active: { ...side.active, energy: [...side.active.energy, ...uids] },
      },
    },
  };
}

function board(
  seed: number,
  opts: { attacker?: string; colorless?: number; bench?: number } = {},
): GameState {
  let state = localSetup(seed);
  state = setActiveFromDeck(state, "p2", BODY);
  state = clearBench(state, "p2");
  for (let i = 0; i < (opts.bench ?? 1); i += 1) state = benchFromDeck(state, "p2", BODY);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", opts.attacker ?? TORRENT);
  state = clearBench(state, "p1");
  state = fuel(state, "p1", WATER, 1);
  return fuel(state, "p1", COLORLESS, opts.colorless ?? 2);
}

const attack = (state: GameState) => apply(state, { type: "attack", seat: "p1", index: 0 });
const say = (state: GameState, yes: boolean) =>
  apply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } });
function findAll<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

describe("§1 — the price, MEASURED IN REFUSED SENTENCES, before and after", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the family's refused half goes 2 sentences / 7 printings → 1 / 2", () => {
    const family = corpus().filter(([, s]) => FAMILY.test(s));
    expect([family.length, units(family)]).toEqual([7, 14]);
    const refused = family.filter(([, s]) => !resolvedByAnyReader(s));
    expect([refused.length, units(refused)]).toEqual([0, 0]);
    expect(refused.map(([, s]) => s)).toEqual([]);
    expect(resolvedByAnyReader(PRIZE_FLIP)).toBe(true);
    const before = family.filter(
      ([, s]) => s === TORRENTIAL || s === PRIZE_FLIP || !resolvedByAnyReader(s),
    );
    expect([before.length, units(before)]).toEqual([2, 7]);
  });

  it("the sentence carries FIVE printings on ONE record, and the census is asked TWICE", () => {
    const rows = corpus().filter(([, s]) => s === TORRENTIAL);
    expect([rows.length, units(rows)]).toEqual([1, 5]);
    const anyCount = corpus().filter(([, s]) =>
      /shuffle \d+ Energy attached to this Pokémon into your deck/.test(s),
    );
    expect(anyCount.map(([, s]) => s)).toEqual([TORRENTIAL]);
    const flat = corpus().filter(([, s]) =>
      /^This attack also does \d+ damage to 1 of your opponent's Benched Pokémon\.( |$)/.test(s),
    );
    expect([flat.length, units(flat)]).toEqual([3, 17]);
    for (const [, s] of flat) {
      expect(deriveAttackEffect(s), s).not.toBeNull();
      expect(deriveAttackOptionalCostBoost(s), s).toBeNull();
    }
  });
});

describe("§2 — both halves dispatched, and every refusal driven from OUTSIDE the population", () => {
  it("the printed sentence reads as a precondition, TWO cost ops and a dispatched payoff", () => {
    expect(deriveAttackOptionalCostBoost(TORRENTIAL)).toEqual({
      cond: { kind: "yourActiveEnergyAtLeast", count: 3 },
      ops: [
        {
          op: "discardEnergy",
          from: "yourActive",
          filter: { kind: "anyEnergy" },
          count: 3,
          to: "deck",
        },
        { op: "shuffleDeck" },
      ],
      payoff: { kind: "benchSnipe", amount: 120, count: 1 },
    });
  });

  it("the COST's digit is CAPTURED and the BODY, the ZONE and the VERB are anchored", () => {
    // Synthetic on purpose — no card prints any of these, which is the whole point of
    // driving a refusal from outside the population.
    const at = (cost: string) =>
      deriveAttackOptionalCostBoost(`You may ${cost}. If you do, this attack does 30 more damage.`);
    // The capture: a different digit is a different `count` AND a different gate.
    expect(at("shuffle 5 Energy attached to this Pokémon into your deck")).toMatchObject({
      cond: { kind: "yourActiveEnergyAtLeast", count: 5 },
      ops: [{ op: "discardEnergy", count: 5, to: "deck" }, { op: "shuffleDeck" }],
    });
    // …and a printed 0 charges nothing, which would make the gate vacuously true and
    // the confirm a free question. The guard every captured amount in effects.ts has.
    expect(at("shuffle 0 Energy attached to this Pokémon into your deck")).toBeNull();
    // The BODY: `yourActive` is the printed "this Pokémon" (§8), so the opponent's is
    // a different op and a different member and is refused rather than re-seated.
    expect(
      at("shuffle 3 Energy attached to your opponent's Active Pokémon into your deck"),
    ).toBeNull();
    // The ZONE: the pile is `discardEnergy`'s DEFAULT and would need no field at all,
    // which is exactly why an unanchored verb here would be free.
    expect(at("shuffle 3 Energy attached to this Pokémon into your discard pile")).toBeNull();
    expect(at("Shuffle 3 Energy attached to this Pokémon into your deck")).toBeNull();
  });

  it("the PAYOFF's zone word is anchored, and the amount and count are CAPTURED", () => {
    const then = (payoff: string) =>
      deriveAttackOptionalCostBoost(`You may discard a Stadium in play. If you do, ${payoff}`);
    expect(
      then("this attack also does 90 damage to 1 of your opponent's Benched Pokémon."),
    ).toEqual({
      cond: { kind: "stadiumInPlay" },
      ops: [{ op: "discardStadium" }],
      payoff: { kind: "benchSnipe", amount: 90, count: 1 },
    });
    // "Pokémon" without "Benched" is `opponentAny` — a DIFFERENT op, where a hit on
    // the Active takes Weakness and Resistance (§8.5).
    expect(then("this attack also does 90 damage to 1 of your opponent's Pokémon.")).toBeNull();
    // "each of" is `spreadDamage`, not `damageChosen`.
    expect(
      then("this attack also does 90 damage to each of your opponent's Benched Pokémon."),
    ).toBeNull();
    expect(
      then("this attack also does 90 damage to 2 of your opponent's Benched Pokémon."),
    ).toEqual({
      cond: { kind: "stadiumInPlay" },
      ops: [{ op: "discardStadium" }],
      payoff: { kind: "benchSnipe", amount: 90, count: 2 },
    });
    // …and a printed 0-COUNT is refused by the same `>= 1` guard the amount carries.
    expect(
      then("this attack also does 90 damage to 0 of your opponent's Benched Pokémon."),
    ).toBeNull();
    // A printed 0 buys nothing, on the second payoff exactly as on the first.
    expect(
      then("this attack also does 0 damage to 1 of your opponent's Benched Pokémon."),
    ).toBeNull();
  });

  it("the OTHER NINE readers refuse it, which is what makes ten readers one answer", () => {
    for (const read of READERS) {
      if (read === deriveAttackOptionalCostBoost) continue;
      expect(read(TORRENTIAL), read.name).toBeNull();
    }
    expect(
      deriveAttackEffect(
        "This attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 120,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
    expect(deriveAttackOptionalCostBoost(`Draw a card. ${TORRENTIAL}`)).toBeNull();
    expect(deriveAttackOptionalCostBoost(`${TORRENTIAL} Draw a card.`)).toBeNull();
  });
});

describe("§3 — `yourActiveEnergyAtLeast`: CARDS on ONE body, and the three near misses", () => {
  const AT_LEAST = (count: number): BoardCondition => ({ kind: "yourActiveEnergyAtLeast", count });

  it("counts CARDS on the attacker's own body, and `>=` is a FLOOR", () => {
    for (const colorless of [0, 1, 2, 3]) {
      const state = board(SEEDS[0], { colorless });
      const cards = 1 + colorless;
      for (const want of [1, 2, 3, 4, 5]) {
        expect(conditionHolds(state, "p1", AT_LEAST(want)), `${cards} vs ${want}`).toBe(
          cards >= want,
        );
      }
    }
  });

  it("CARDS AND NOT UNITS — a multi-unit Special counts ONE", () => {
    let state = board(SEEDS[0], { colorless: 0 });
    state = setActiveFromDeck(state, "p1", NEO_STAGE2);
    state = fuel(state, "p1", NEO_UPPER, 1);
    state = fuel(state, "p1", WATER, 1);
    const active = state.players.p1.active;
    if (active === null) throw new Error("expected P1's Active");
    expect(countAttachedEnergy(state, active, null)).toBe(2);
    // The ATTRIBUTION CONTROL: the units really are three on this board, so the
    // assertion below is about the reading and not about an empty holder.
    expect(providedEnergy(state, active)).toHaveLength(3);
    expect(conditionHolds(state, "p1", AT_LEAST(3))).toBe(false);
    expect(conditionHolds(state, "p1", AT_LEAST(2))).toBe(true);
  });

  it("FALSE with an empty Active Spot — an absent body is not a body holding zero", () => {
    const state = board(SEEDS[0]);
    const empty: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: null } },
    };
    expect(conditionHolds(empty, "p1", AT_LEAST(1))).toBe(false);
    // …and at a count of 0 too, which is the branch a `>= count` with no null guard
    // would answer TRUE on: `0 >= 0` is true and there is no Pokémon.
    expect(conditionHolds(empty, "p1", AT_LEAST(0))).toBe(false);
  });

  it("the THREE near misses computed BESIDE it, on boards where they disagree", () => {
    let state = board(SEEDS[0], { colorless: 1 }); // {W} + {C} on the Active = 2 cards
    state = benchFromDeck(state, "p1", BODY);
    const benched = state.players.p1.bench[0];
    if (benched === undefined) throw new Error("expected P1's Bench");
    const spare = state.players.p1.deck.filter((uid) => state.cardIdByUid[uid] === WATER)[0];
    if (spare === undefined) throw new Error("expected a spare {W} in the deck");
    const withBench: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          deck: state.players.p1.deck.filter((uid) => uid !== spare),
          bench: [{ ...benched, energy: [...benched.energy, spare] }],
        },
      },
    };
    // THE NEW MEMBER: the BODY, so the benched {C} is invisible — 2, not 3.
    expect(conditionHolds(withBench, "p1", AT_LEAST(3))).toBe(false);
    expect(
      conditionHolds(withBench, "p1", {
        kind: "yourEnergyInPlayAtLeast",
        energy: "Water",
        count: 2,
      }),
    ).toBe(true);
    expect(
      conditionHolds(withBench, "p1", { kind: "yourActiveHasEnergyAttached", energy: "Water" }),
    ).toBe(true);
    expect(conditionHolds(withBench, "p1", { kind: "activeEnergyCountsEqual" })).toBe(false);
    expect(conditionHolds(withBench, "p1", AT_LEAST(2))).toBe(true);
  });

  it("the note is a reject pill built from the parameter, and names the BODY", () => {
    expect(conditionNote(AT_LEAST(3))).toBe("your Active Pokémon has 3 or more Energy attached");
    expect(conditionNote(AT_LEAST(5))).toBe("your Active Pokémon has 5 or more Energy attached");
  });
});

describe("§4 — the program: ONE gate, ONE confirm, and NO decline arm on either", () => {
  const reading = () => {
    const parsed = deriveAttackOptionalCostBoost(TORRENTIAL);
    if (parsed === null) throw new Error("expected the reading");
    return parsed;
  };

  it("pins the assembly byte-for-byte: cost, shuffle, snipe — and the base stays OUT", () => {
    const expected: EffectOp[] = [
      {
        op: "conditionGate",
        cond: { kind: "yourActiveEnergyAtLeast", count: 3 },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          {
            op: "optional",
            note: TORRENTIAL,
            // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
            then: [
              {
                op: "discardEnergy",
                from: "yourActive",
                filter: { kind: "anyEnergy" },
                count: 3,
                to: "deck",
              },
              { op: "shuffleDeck" },
              {
                op: "damageChosen",
                target: "opponentBench",
                amount: 120,
                count: 1,
                source: "attack",
                deals: true,
              },
            ],
          },
        ],
      },
    ];
    expect(optionalCostBoostProgram(reading(), 100, TORRENTIAL)).toEqual(expected);
  });

  it("the base is IGNORED by this arm — every printed base assembles the same program", () => {
    const at = (base: number) => optionalCostBoostProgram(reading(), base, TORRENTIAL);
    for (const base of [0, 30, 100, 250]) expect(at(base)).toEqual(at(100));
    // …and the CONTROL that makes that mean something: the other payoff DOES vary.
    const press = deriveAttackOptionalCostBoost(CRUSHING_PRESS);
    if (press === null) throw new Error("expected D381's reading");
    expect(optionalCostBoostProgram(press, 30, CRUSHING_PRESS)).not.toEqual(
      optionalCostBoostProgram(press, 140, CRUSHING_PRESS),
    );
  });

  it("NEITHER gate carries an `otherwise`, which is the INVERSE of D381's shape", () => {
    const gate = optionalCostBoostProgram(reading(), 100, TORRENTIAL)[0];
    if (gate === undefined || gate.op !== "conditionGate") throw new Error("expected the gate");
    expect(gate.otherwise).toBeUndefined();
    const ask = gate.then[0];
    if (ask === undefined || ask.op !== "optional") throw new Error("expected the confirm");
    expect(ask.otherwise).toBeUndefined();
    expect(Object.hasOwn(ask, "otherwise")).toBe(false);
    // The confirm's note is the WHOLE printed sentence: the player is agreeing to the
    // COST as much as to the damage.
    expect(ask.note).toBe(TORRENTIAL);
    const press = deriveAttackOptionalCostBoost(CRUSHING_PRESS);
    if (press === null) throw new Error("expected D381's reading");
    const other = optionalCostBoostProgram(press, 140, CRUSHING_PRESS)[0];
    if (other === undefined || other.op !== "conditionGate") throw new Error("expected the gate");
    expect(other.otherwise).toEqual([{ op: "damageDefender", amount: 140 }]);
  });
});

describe("§5 — the board: the Energy reaches the DECK, and the snipe is a SECOND hit", () => {
  it.each(SEEDS)("seed %i — YES: 3 Energy to the deck, a SHUFFLE, and 100 + 120", (seed) => {
    const before = board(seed, { bench: 1 });
    const attacker = before.players.p1.active;
    if (attacker === null) throw new Error("expected P1's Active");
    expect(attacker.energy).toHaveLength(3);
    const deckBefore = before.players.p1.deck.length;
    const pileBefore = before.players.p1.discard.length;

    const parked = attack(before);
    expect(findEvent(parked.events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p2",
      base: 100,
      dealt: 100,
    });
    expect(types(parked.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(parked.state.phase.kind).toBe("effect:choose");
    expect(findEvent(parked.events, "EFFECT_PENDING")).toEqual({
      type: "EFFECT_PENDING",
      seat: "p1",
      note: TORRENTIAL,
    });

    const done = say(parked.state, true);
    expect(done.state.players.p1.active?.energy).toEqual([]);
    expect(done.state.players.p1.deck).toHaveLength(deckBefore + 3);
    expect(done.state.players.p1.discard).toHaveLength(pileBefore);
    for (const uid of attacker.energy) expect(done.state.players.p1.deck).toContain(uid);
    // …and the printed VERB, which is its own op: the deck was randomised in the open.
    expect(findEvent(done.events, "SHUFFLE")?.seat).toBe("p1");
    const moved = findEvent(done.events, "ENERGY_DISCARDED");
    expect(moved).toMatchObject({ seat: "p1", actor: "p1", to: "deck" });
    expect(moved?.uids).toHaveLength(3);
    expect(types(done.events)).not.toContain("COUNTERS_PLACED");
    expect(findEvent(done.events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p2",
      base: 120,
      weakness: null,
      dealt: 120,
    });
    expect(done.state.players.p2.active?.damage).toBe(100);
    expect(done.state.players.p2.bench[0]?.damage).toBe(120);
    expect(done.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it.each(SEEDS)(
    "seed %i — the SHUFFLE is SPENT: `rngState` advances on the yes and stands still on the no",
    (seed) => {
      const parked = attack(board(seed, { bench: 1 }));
      expect(parked.state.phase.kind).toBe("effect:choose");

      const yes = say(parked.state, true);
      expect(types(yes.events)).toContain("SHUFFLE");
      expect(yes.state.rngState).not.toBe(parked.state.rngState);

      const no = say(parked.state, false);
      expect(types(no.events)).not.toContain("SHUFFLE");
      expect(no.state.rngState).toBe(parked.state.rngState);
    },
  );

  it.each(SEEDS)("seed %i — TWO hits and never one: the rows are 100 and 120", (seed) => {
    const parked = attack(board(seed, { bench: 1 }));
    expect(findAll(parked.events, "DAMAGE_DEALT").map((d) => d.base)).toEqual([100]);
    const done = say(parked.state, true);
    expect(findAll(done.events, "DAMAGE_DEALT").map((d) => d.base)).toEqual([120]);
  });

  it.each(SEEDS)(
    "seed %i — NO: nothing moves, nothing is sniped, and the 100 still lands",
    (seed) => {
      const before = board(seed, { bench: 1 });
      const attacker = before.players.p1.active;
      if (attacker === null) throw new Error("expected P1's Active");
      const deckBefore = before.players.p1.deck.length;
      const parked = attack(before);
      expect(findAll(parked.events, "DAMAGE_DEALT").map((d) => d.base)).toEqual([100]);
      const done = say(parked.state, false);
      expect(done.state.players.p1.active?.energy).toEqual(attacker.energy);
      expect(done.state.players.p1.deck).toHaveLength(deckBefore);
      expect(types(done.events)).not.toContain("SHUFFLE");
      expect(types(done.events)).not.toContain("ENERGY_DISCARDED");
      expect(done.state.players.p2.bench[0]?.damage).toBe(0);
      expect(findAll(done.events, "DAMAGE_DEALT")).toHaveLength(0);
      expect(done.state.players.p2.active?.damage).toBe(100);
    },
  );

  it.each(SEEDS)(
    "seed %i — an EMPTY opponent Bench: the offer is still asked, and whiffs",
    (seed) => {
      const parked = attack(board(seed, { bench: 0 }));
      expect(parked.state.phase.kind).toBe("effect:choose");
      const done = say(parked.state, true);
      expect(done.state.players.p1.active?.energy).toEqual([]);
      expect(types(done.events)).toContain("SHUFFLE");
      expect(findAll(done.events, "DAMAGE_DEALT")).toHaveLength(0);
      expect(done.state.players.p2.active?.damage).toBe(100);
    },
  );
});

describe("§6 — the gate, and the TWO consecutive parks inside one confirm", () => {
  it.each(SEEDS)(
    "seed %i — an UNPAYABLE cost is never offered, and the 100 still lands",
    (seed) => {
      const before = board(seed, { attacker: FOUR, bench: 1 });
      expect(before.players.p1.active?.energy).toHaveLength(3);
      expect(conditionHolds(before, "p1", { kind: "yourActiveEnergyAtLeast", count: 4 })).toBe(
        false,
      );
      const done = attack(before);
      expect(done.state.phase.kind).not.toBe("effect:choose");
      expect(types(done.events)).not.toContain("EFFECT_PENDING");
      expect(types(done.events)).not.toContain("ENERGY_DISCARDED");
      expect(types(done.events)).not.toContain("SHUFFLE");
      expect(types(done.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(findAll(done.events, "DAMAGE_DEALT")).toHaveLength(1);
      expect(done.state.players.p2.active?.damage).toBe(100);
      expect(done.state.players.p2.bench[0]?.damage).toBe(0);
      expect(attack(board(seed, { bench: 1 })).state.phase.kind).toBe("effect:choose");
    },
  );

  it.each(SEEDS)(
    "seed %i — the cost PARKS on a 4-Energy body, then the snipe parks again",
    (seed) => {
      const before = board(seed, { colorless: 3, bench: 2 });
      expect(before.players.p1.active?.energy).toHaveLength(4);
      const parked = attack(before);
      const afterYes = say(parked.state, true);

      if (afterYes.state.phase.kind !== "effect:choose")
        throw new Error("expected the discard park");
      const pick = afterYes.state.phase.prompt;
      if (pick.kind !== "discardEnergy") throw new Error("expected a discardEnergy prompt");
      expect(pick.note).toBe("Shuffle 3 Energy attached to this Pokémon into your deck.");
      expect(pick.scope).toEqual({ kind: "total", count: 3 });
      // FOUR offers and not two: `interchangeableCandidates` keeps `count` copies per
      // class, and the printed count is 3 — so all three identical {C} survive beside
      // the {W}, because a pick of three could want all of them.
      expect(pick.discardable).toHaveLength(4);
      const chosen = before.players.p1.active?.energy.slice(0, 3) ?? [];
      const afterPick = apply(afterYes.state, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "discardEnergy", uids: chosen },
      });

      // …and then the SECOND park, on a Bench of two.
      if (afterPick.state.phase.kind !== "effect:choose")
        throw new Error("expected the snipe park");
      const snipe = afterPick.state.phase.prompt;
      if (snipe.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
      expect(snipe.max).toBe(1);
      expect(snipe.note).toContain("120 damage");
      const done = apply(afterPick.state, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemonMulti", refs: [snipe.candidates[0] as PokemonRef] },
      });
      // ONE Energy stayed on the body — the printed 3, not "all".
      expect(done.state.players.p1.active?.energy).toHaveLength(1);
      expect(done.state.players.p2.bench[0]?.damage).toBe(120);
      expect(done.state.players.p2.bench[1]?.damage).toBe(0);
      expect(done.state.players.p2.active?.damage).toBe(100);
    },
  );
});
