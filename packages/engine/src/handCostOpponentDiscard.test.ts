import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { EffectOp } from "./effectTypes";
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
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction } from "./index";
import type { GameState, Seat } from "./index";
import { resumeProgram, runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  battler,
  basicEnergy,
  deckOf,
  itemTrainer,
  driveSetup,
  roundTrip,
  mustDerive,
} from "./testFixtures";
import { makeInPlay } from "./types";

const GATED_DISCARD =
  "Discard a card from your hand. If you do, your opponent discards a card from their hand.";

const DRAW2 = "Discard a card from your hand. If you do, draw 2 cards.";
const DRAW3 = "Discard a card from your hand. If you do, draw 3 cards.";
const BARE_ONE = "Your opponent discards a card from their hand.";
const BARE_TWO = "Your opponent discards 2 cards from their hand.";

const READERS: readonly ((t: string) => unknown)[] = [
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

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

/** The PROGRAM, spelled once so no case can pass against a hand-copied literal that
    has drifted from what this file means by it. */
const program = (discarded: number): EffectOp[] => [
  { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
  { op: "recordGate", slot: "paid", ops: [{ op: "opponentDiscardsFromHand", count: discarded }] },
];

describe("D515 §1 — the sentence, measured live over the legal column", () => {
  it("the hand-kept READERS list IS the module's reader surface, and it is 13", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the row is really in the column, ONCE, at ONE printing — and so are its four controls", () => {
    for (const [text, printings] of [
      [GATED_DISCARD, 1],
      [DRAW2, 1],
      [DRAW3, 1],
      [BARE_ONE, 2],
      [BARE_TWO, 4],
    ] as const) {
      const rows = legalAttackCorpus().filter(([, s]) => s === text);
      expect([rows.length, units(rows)], text).toEqual([1, printings]);
    }
  });

  it("the ANCHOR's whole reach is 1 sentence / 1 printing, measured", () => {
    const anchored = legalAttackCorpus().filter(([, s]) =>
      /^Discard a card from your hand\. If you do, your opponent discards a card from their hand\.$/.test(
        s,
      ),
    );
    expect([anchored.length, units(anchored)]).toEqual([1, 1]);
    expect(anchored.map(([, s]) => s)).toEqual([GATED_DISCARD]);
  });

  it("CAPTURING THE COUNT would claim the IDENTICAL row, so the group is pure RISK", () => {
    const wide = legalAttackCorpus().filter(([, s]) =>
      /^Discard a card from your hand\. If you do, your opponent discards (?:a card|\d+ cards) from their hand\.$/.test(
        s,
      ),
    );
    expect([wide.length, units(wide)]).toEqual([1, 1]);
    expect(wide.map(([, s]) => s)).toEqual([GATED_DISCARD]);
  });

  it("THE *PRINTED ZERO TIMES* MEASUREMENT THE FLIP TABLE OWES — the gated PLURAL", () => {
    const gatedPlural = legalAttackCorpus().filter(([, s]) =>
      /^Discard a card from your hand\. If you do, your opponent discards \d+ cards from their hand\.$/.test(
        s,
      ),
    );
    expect(gatedPlural).toEqual([]);
    expect(deriveAttackEffect(BARE_TWO)).toEqual([{ op: "opponentDiscardsFromHand", count: 2 }]);
  });

  it("`deriveAttackEffect` is its ONLY reader — the other TWELVE refuse it", () => {
    expect(deriveAttackEffect(GATED_DISCARD)).not.toBeNull();
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(GATED_DISCARD), read.name).toBeNull();
    }
    expect(splitAttackGateClause(GATED_DISCARD)).toBeNull();
    expect(splitAttackRequirementClause(GATED_DISCARD)).toBeNull();
    expect(splitAttackCancelClause(GATED_DISCARD)).toBeNull();
    expect(splitAttackTrailingClause(GATED_DISCARD)).toBeNull();
  });

  it("NEITHER HALF IS READ ALONE — the whole-sentence anchor is WARRANTED", () => {
    expect(resolvedByAnyReader("Discard a card from your hand.")).toBe(false);
    expect(resolvedByAnyReader("If you do, your opponent discards a card from their hand.")).toBe(
      false,
    );
    expect(resolvedByAnyReader(BARE_ONE)).toBe(true);
  });

  it("THE LATTICE: 16 DISTINCT points, and this arm claims EXACTLY ONE of them", () => {
    const OPENER = ["Discard a card from your hand.", "Draw 2 cards."] as const;
    const consequent = (op: 0 | 1, count: 0 | 1): string =>
      op === 0
        ? count === 0
          ? "your opponent discards a card from their hand"
          : "your opponent discards 2 cards from their hand"
        : count === 0
          ? "draw 1 cards"
          : "draw 2 cards";
    const points: string[] = [];
    for (const a of [0, 1] as const) {
      for (const g of [0, 1] as const) {
        for (const c of [0, 1] as const) {
          for (const n of [0, 1] as const) {
            const tail = consequent(c, n);
            points.push(
              g === 0
                ? `${OPENER[a]} If you do, ${tail}.`
                : `${OPENER[a]} ${tail.charAt(0).toUpperCase()}${tail.slice(1)}.`,
            );
          }
        }
      }
    }
    expect(points).toHaveLength(16);
    expect(new Set(points).size).toBe(16);
    // THE RIDER: the derived value this arm produces, not the regex that produces it.
    const mine = points.filter((s) => {
      const derived = deriveAttackEffect(s);
      if (derived === null || derived.length !== 2) return false;
      const [cost, gate] = derived;
      if (cost?.op !== "payFromHand" || gate?.op !== "recordGate") return false;
      return gate.ops.length === 1 && gate.ops[0]?.op === "opponentDiscardsFromHand";
    });
    expect(mine).toEqual([GATED_DISCARD]);
    expect(points.filter((s) => resolvedByAnyReader(s)).sort()).toEqual(
      [GATED_DISCARD, DRAW2, "Discard a card from your hand. If you do, draw 1 cards."].sort(),
    );
    const splitOnly = points.filter(
      (s) => !resolvedByAnyReader(s) && splitAttackTrailingClause(s) !== null,
    );
    expect(splitOnly.sort()).toEqual(
      [
        "Draw 2 cards. Your opponent discards a card from their hand.",
        "Draw 2 cards. Your opponent discards 2 cards from their hand.",
        "Draw 2 cards. Draw 1 cards.",
        "Draw 2 cards. Draw 2 cards.",
      ].sort(),
    );
  });
});

describe("D515 §2 — the program, and every refusal pinned on ONE printed byte", () => {
  it("derives THREE SHIPPED OPS in printed order, with the printed article as the count", () => {
    expect(deriveAttackEffect(GATED_DISCARD)).toEqual(program(1));
    expect(deriveAttackEffect(GATED_DISCARD)).not.toEqual(deriveAttackEffect(DRAW2));
  });

  it("the GATE's slot is the PAYMENT's slot — the two halves cannot drift apart", () => {
    const [cost, gate] = mustDerive(deriveAttackEffect, GATED_DISCARD);
    expect(cost?.op === "payFromHand" ? cost.recordAs : undefined).toBe("paid");
    expect(gate?.op === "recordGate" ? gate.slot : undefined).toBe("paid");
    expect(gate?.op === "recordGate" ? gate.slot : "gate").toBe(
      cost?.op === "payFromHand" ? cost.recordAs : "cost",
    );
    // …and the gate carries NO `otherwise` and NO `contains`: the printed sentence has
    // no "if you don't" branch and asks nothing about where the card LANDED.
    expect(gate?.op === "recordGate" ? gate.otherwise : "x").toBeUndefined();
    expect(gate?.op === "recordGate" ? gate.contains : "x").toBeUndefined();
  });

  it("each near-miss differs on ONE axis and each is refused for THAT axis", () => {
    expect(deriveAttackEffect(GATED_DISCARD)).not.toBeNull();
    for (const text of [
      "Discard a card from your hand. If you can't, your opponent discards a card from their hand.",
      // …the CONSEQUENT'S COUNT alone — the axis the lattice prices at 1 of 8.
      "Discard a card from your hand. If you do, your opponent discards 2 cards from their hand.",
      // …the COST'S QUANTIFIER alone: a plural payment is a different price.
      "Discard 2 cards from your hand. If you do, your opponent discards a card from their hand.",
      // …the COST'S NOUN alone: a filtered cost is not this arm's unfiltered payment.
      "Discard a Basic {G} Energy card from your hand. If you do, your opponent discards a card from their hand.",
      // …the CONSEQUENT'S ZONE alone: the deck is not the hand.
      "Discard a card from your hand. If you do, your opponent discards a card from their deck.",
      // …the CONSEQUENT'S SEAT alone: the print names the OTHER hand.
      "Discard a card from your hand. If you do, you discard a card from your hand.",
      // …the JOINER alone: "and" is not the §9.2 gate, and a build that read it as one
      // would make the opponent discard off a payment that never happened.
      "Discard a card from your hand and your opponent discards a card from their hand.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("the anchor is WHOLE-SENTENCE — leading text, trailing text, case and the period", () => {
    for (const text of [
      `Draw a card. ${GATED_DISCARD}`,
      `${GATED_DISCARD} Then, shuffle your deck.`,
      GATED_DISCARD.toLowerCase(),
      GATED_DISCARD.toUpperCase(),
      GATED_DISCARD.slice(0, -1),
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });
});

const SWAPPER = "d515-swapper";
const WALL = "d515-wall";
const ENERGY = "d515-energy";
const ITEM = "d515-item";

const LOCAL_CARDS: Record<string, Card> = {
  [SWAPPER]: battler(SWAPPER, {
    name: "D515 Swapper",
    hp: 120,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Trade Down", effect: GATED_DISCARD, damage: 30 }],
  }),
  // 330 HP so the flat 30 can never Knock Out, and no KO sweep can land between the
  // payment and the opponent's discard and re-order the events this file reads.
  [WALL]: battler(WALL, {
    name: "D515 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [ENERGY]: basicEnergy(ENERGY),
  [ITEM]: itemTrainer(ITEM),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({ [SWAPPER]: 8, [WALL]: 8, [ENERGY]: 20, [ITEM]: 24 });

function mustStep(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  }
  return { state: result.state, events: [...result.events] };
}

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

/** TEST SURGERY: put `cardId` from the deck into the named spot. */
function place(state: GameState, s: Seat, cardId: string, spot: "active" | "bench"): GameState {
  const side = state.players[s];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${cardId} not in ${s}'s deck`);
  const body = makeInPlay(uid, state.turn);
  const deck = side.deck.filter((u) => u !== uid);
  return {
    ...state,
    players: {
      ...state.players,
      [s]:
        spot === "active"
          ? { ...side, deck, active: body }
          : { ...side, deck, bench: [...side.bench, body] },
    },
  };
}

/** Attach one Energy from the deck onto the seat's Active — the printed {C} cost. */
function fund(state: GameState, s: Seat): GameState {
  const side = state.players[s];
  const active = side.active;
  if (active === null) throw new Error("no active to fund");
  const uid = side.deck.find((u) => state.cardIdByUid[u] === ENERGY);
  if (uid === undefined) throw new Error("no energy in deck");
  return {
    ...state,
    players: {
      ...state.players,
      [s]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        active: { ...active, energy: [...active.energy, uid] },
      },
    },
  };
}

function handOfIds(state: GameState, seat: Seat, cardIds: readonly string[]): GameState {
  const side = state.players[seat];
  let rest = [...side.deck, ...side.hand];
  const taken: string[] = [];
  for (const id of cardIds) {
    const uid = rest.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`${id} not available for ${seat}`);
    taken.push(uid);
    rest = rest.filter((u) => u !== uid);
  }
  return { ...state, players: { ...state.players, [seat]: { ...side, hand: taken, deck: rest } } };
}

/** A three-card hand of three DIFFERENT card ids — the smallest board on which both
    of this program's parks are real decisions. */
const THREE = [ENERGY, ITEM, WALL] as const;

/** P1 on turn:action with the Swapper Active, funded, P2 behind the 330 HP wall. */
function fielded(seed: number): GameState {
  let state = localSetup(seed, "p2");
  state = mustStep(state, { type: "endTurn", seat: "p2" }).state;
  state = place(state, "p1", SWAPPER, "active");
  state = fund(state, "p1");
  return place(state, "p2", WALL, "active");
}

const attack = { type: "attack", seat: "p1", index: 0 } as const;

/** Hand sizes for both seats, which is the pair every wrong reading shows up in. */
const hands = (state: GameState): [p1: number, p2: number] => [
  state.players.p1.hand.length,
  state.players.p2.hand.length,
];

describe("D515 §3 — the BOARD: two parks, two seats, and the gate between them", () => {
  it("the CONTROLLER parks first, and the caption is the whole printed sentence", () => {
    const parked = mustStep(
      handOfIds(handOfIds(fielded(8), "p1", THREE), "p2", THREE),
      attack,
    ).state;
    const phase = parked.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(phase.prompt.note).toBe(GATED_DISCARD);
    expect([phase.prompt.min, phase.prompt.max]).toEqual([1, 1]);
    expect(phase.prompt.dest).toBe("discard");
    expect(phase.seat).toBe("p1");
    expect(phase.answerer).toBeUndefined();
  });

  it("answering it hands the SECOND park to the OPPONENT, and the gate is why", () => {
    const parked = mustStep(
      handOfIds(handOfIds(fielded(12), "p1", THREE), "p2", THREE),
      attack,
    ).state;
    const first = parked.phase;
    if (first.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (first.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const paid = first.prompt.candidates[0] as string;
    const next = mustStep(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [paid] },
    }).state;
    const second = next.phase;
    if (second.kind !== "effect:choose") throw new Error("expected a SECOND effect:choose");
    if (second.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(second.seat).toBe("p1");
    expect(second.answerer).toBe("p2");
    expect(second.prompt.note).toBe("Discard a card from your hand.");
    expect([second.prompt.min, second.prompt.max]).toEqual([1, 1]);
    expect([...second.prompt.candidates].sort()).toEqual([...next.players.p2.hand].sort());
    // …the controller has already paid and the opponent has not, so mid-program the two
    // seats really are in different states.
    expect(hands(next)).toEqual([2, 3]);
    expect([next.players.p1.discard.length, next.players.p2.discard.length]).toEqual([1, 0]);
    // …and the controller may NOT answer the opponent's prompt. The `answerer` gate is
    // the whole of that refusal, so it is driven rather than inferred from the field.
    const stolen = applyAction(next, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [second.prompt.candidates[0] as string] },
    });
    expect(stolen.ok).toBe(false);
    // …now the OPPONENT answers and both discard piles hold exactly one card.
    const settled = mustStep(next, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: [second.prompt.candidates[0] as string] },
    }).state;
    expect([settled.players.p1.discard.length, settled.players.p2.discard.length]).toEqual([1, 1]);
  });

  it("AN EMPTY HAND BUYS NOTHING — the gate, not a cancel, is what makes this honest", () => {
    const empty = mustStep(handOfIds(handOfIds(fielded(13), "p1", []), "p2", THREE), attack).state;
    expect(empty.phase.kind).not.toBe("effect:choose");
    expect([empty.players.p1.discard.length, empty.players.p2.discard.length]).toEqual([0, 0]);
    expect(hands(empty)).toEqual([0, 4]);
    // …the CONTROL, one axis away: a hand of ONE is FORCED rather than parked (the M1
    // doctrine) and the opponent DOES lose a card — so the rung above is about the
    // EMPTY hand and not about the absence of a park.
    const forced = mustStep(
      handOfIds(handOfIds(fielded(13), "p1", [ENERGY]), "p2", [ITEM]),
      attack,
    ).state;
    expect(forced.phase.kind).not.toBe("effect:choose");
    expect([forced.players.p1.discard.length, forced.players.p2.discard.length]).toEqual([1, 1]);
  });

  it("an OPPONENT with an empty hand is a silent whiff, and the payment still happens", () => {
    // §8.6's "do as much as you can" at the far end of the program: `take === 0` is a
    // no-op with no event and no park. The card was still paid — which is the printed
    // order, and the reason the gate reads the PAYMENT rather than the discard.
    const settled = mustStep(
      handOfIds(handOfIds(fielded(14), "p1", [ENERGY]), "p2", []),
      attack,
    ).state;
    expect(settled.phase.kind).not.toBe("effect:choose");
    expect(settled.players.p1.discard).toHaveLength(1);
    expect(settled.players.p2.discard).toHaveLength(0);
  });
});

describe("D515 §4 — what the column now holds, measured rather than claimed", () => {
  /** Run `ops` for p1 and settle every park by paying the FIRST candidates offered. */
  function settle(state: GameState, ops: EffectOp[]): GameState {
    let result = runProgram(state, ops, { seat: "p1" }, {}, []);
    while (result.kind === "parked") {
      const prompt = result.prompt;
      if (prompt.kind !== "chooseCards") throw new Error(`unexpected park: ${prompt.kind}`);
      result = resumeProgram(
        result.state,
        result.cont,
        { kind: "cards", uids: prompt.candidates.slice(0, prompt.min) },
        [],
      );
    }
    return result.state;
  }

  it("EXACTLY ONE derived attack program parks for BOTH SEATS behind a §9.2 gate", () => {
    const crossSeatGated = legalAttackCorpus().filter(([, text]) => {
      const derived = deriveAttackEffect(text);
      if (derived === null) return false;
      return derived.some(
        (op) =>
          op.op === "recordGate" && op.ops.some((inner) => inner.op === "opponentDiscardsFromHand"),
      );
    });
    expect(crossSeatGated.map(([, s]) => s)).toEqual([GATED_DISCARD]);
    expect(units(crossSeatGated)).toBe(1);
  });

  it("the OTHER two members of the family are UNMOVED — this anchor claims neither", () => {
    expect(deriveAttackEffect(DRAW2)).toEqual([
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      { op: "recordGate", slot: "paid", ops: [{ op: "drawCards", count: 2 }] },
    ]);
    expect(deriveAttackEffect(DRAW3)).toEqual([
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      { op: "recordGate", slot: "paid", ops: [{ op: "drawCards", count: 3 }] },
    ]);
  });

  it("the PROGRAM and the SENTENCE agree on the board — the real interpreter, not a shape", () => {
    // The derived program run end to end against the hand-written one: if the anchor
    // ever derived a different program this diverges on cards moved rather than on JSON.
    const board = handOfIds(handOfIds(fielded(15), "p1", THREE), "p2", THREE);
    const viaSentence = settle(board, mustDerive(deriveAttackEffect, GATED_DISCARD));
    const viaProgram = settle(board, program(1));
    expect(hands(viaSentence)).toEqual([2, 2]);
    expect(hands(viaSentence)).toEqual(hands(viaProgram));
    // …and the WRONG reading — the gate dropped — is a DIFFERENT board on the one
    // input that separates them: an empty controller hand still costs the opponent.
    const emptyHanded = handOfIds(handOfIds(fielded(15), "p1", []), "p2", THREE);
    const gated = settle(emptyHanded, program(1));
    const ungated = settle(emptyHanded, [
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      { op: "opponentDiscardsFromHand", count: 1 },
    ]);
    expect(hands(gated)).toEqual([0, 3]);
    expect(hands(ungated)).toEqual([0, 2]);
    expect(hands(gated)).not.toEqual(hands(ungated));
  });
});

describe("D515 §5 — THE DESCRIBER, which is the blocker D473 named, driven BOTH WAYS", () => {
  it("an UNDESCRIBED gate branch degrades the caption to the BARE COST, byte for byte", () => {
    const board = handOfIds(handOfIds(fielded(16), "p1", THREE), "p2", THREE);
    const noteOf = (ops: EffectOp[]): string => {
      const result = runProgram(board, ops, { seat: "p1" }, {}, []);
      if (result.kind !== "parked") throw new Error("expected a park");
      if (result.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
      return result.prompt.note;
    };
    const bare = [{ op: "payFromHand", count: 1, to: "discard", recordAs: "paid" }] as EffectOp[];
    const undescribed = [
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      { op: "recordGate", slot: "paid", ops: [{ op: "revealOpponentHand" }] },
    ] as EffectOp[];
    expect(noteOf(undescribed)).toBe(noteOf(bare));
    expect(noteOf(undescribed)).toBe("Discard a card from your hand.");
    expect(noteOf(program(1))).toBe(GATED_DISCARD);
    expect(noteOf(program(1))).not.toBe(noteOf(bare));
  });

  it("the PLURAL branch is unreachable from any printing and is DRIVEN anyway", () => {
    const board = handOfIds(handOfIds(fielded(17), "p1", THREE), "p2", THREE);
    const result = runProgram(board, program(2), { seat: "p1" }, {}, []);
    if (result.kind !== "parked") throw new Error("expected a park");
    if (result.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(result.prompt.note).toBe(
      "Discard a card from your hand. If you do, your opponent discards 2 cards from their hand.",
    );
    // …and it really is a different string from the singular's, so the ternary has two
    // live answers rather than one written twice.
    expect(result.prompt.note).not.toBe(GATED_DISCARD);
  });
});

describe("D515 §6 — `MATCH_RECORD_VERSION` stays 30, and the argument is DRIVEN", () => {
  it("the SERIALIZED ALPHABET: every byte this arm can write, a v30 deploy could write", () => {
    const emitted = JSON.stringify(deriveAttackEffect(GATED_DISCARD));
    expect(emitted).toBe(
      '[{"op":"payFromHand","count":1,"to":"discard","recordAs":"paid"},{"op":"recordGate","slot":"paid","ops":[{"op":"opponentDiscardsFromHand","count":1}]}]',
    );
    const parked = mustStep(
      handOfIds(handOfIds(fielded(18), "p1", THREE), "p2", THREE),
      attack,
    ).state;
    const phase = parked.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(roundTrip(phase.cont.pendingOp)).toEqual(program(1)[0]);
    expect(roundTrip(phase.cont.rest)).toEqual([program(1)[1]]);
  });

  it("the LOSS direction, driven: a truncated `rest` degrades into a DIFFERENT board", () => {
    const parked = mustStep(
      handOfIds(handOfIds(fielded(19), "p1", THREE), "p2", THREE),
      attack,
    ).state;
    const phase = parked.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const chosen = parked.players.p1.hand[0] as string;
    const whole = mustStep(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [chosen] },
    }).state;
    const truncated: GameState = {
      ...parked,
      phase: { ...phase, cont: { ...phase.cont, rest: [] } },
    };
    const lost = mustStep(truncated, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [chosen] },
    }).state;
    expect(whole.phase.kind).toBe("effect:choose");
    expect(whole.phase.kind === "effect:choose" ? whole.phase.answerer : undefined).toBe("p2");
    expect(lost.phase.kind).not.toBe("effect:choose");
    expect([lost.players.p1.discard.length, lost.players.p2.discard.length]).toEqual([1, 0]);
    expect(hands(lost)).toEqual([2, 4]);
  });
});
