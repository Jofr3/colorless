import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { EffectOp } from "./effects";
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
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { resumeProgram, runProgram } from "./interpreter";
import {
  completeSetup,
  FIXTURE_POOL,
  battler,
  basicEnergy,
  deckOf,
  itemTrainer,
  types,
  must,
} from "./testFixtures";
import { makeInPlay } from "./types";

const DRAW2 = "Discard a card from your hand. If you do, draw 2 cards.";
const DRAW3 = "Discard a card from your hand. If you do, draw 3 cards.";

const SIBLING_BUILT_AT_D515 =
  "Discard a card from your hand. If you do, your opponent discards a card from their hand.";

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
const program = (drawn: number): EffectOp[] => [
  { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
  // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
  { op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: drawn }] },
];

describe("D473 §1 — the two sentences, measured live over the legal column", () => {
  it("the hand-kept READERS list IS the module's reader surface, and it is 13", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("both are really in the column, ONCE each, at ONE printing each", () => {
    for (const text of [DRAW2, DRAW3]) {
      const rows = legalAttackCorpus().filter(([, s]) => s === text);
      expect([rows.length, units(rows)], text).toEqual([1, 1]);
    }
  });

  it("the ANCHOR's whole reach is 2 sentences / 2 printings, measured", () => {
    const anchored = legalAttackCorpus().filter(([, s]) =>
      /^Discard a card from your hand\. If you do, draw (\d+) cards\.$/.test(s),
    );
    expect([anchored.length, units(anchored)]).toEqual([2, 2]);
    expect(anchored.map(([, s]) => s).sort()).toEqual([DRAW2, DRAW3].sort());
  });

  it("`deriveAttackEffect` is their ONLY reader — the other TWELVE refuse both", () => {
    for (const text of [DRAW2, DRAW3]) {
      expect(deriveAttackEffect(text), text).not.toBeNull();
      for (const read of READERS) {
        if (read === deriveAttackEffect) continue;
        expect(read(text), `${read.name} / ${text}`).toBeNull();
      }
      expect(splitAttackGateClause(text), text).toBeNull();
      expect(splitAttackRequirementClause(text), text).toBeNull();
      expect(splitAttackCancelClause(text), text).toBeNull();
      expect(splitAttackTrailingClause(text), text).toBeNull();
    }
  });

  it("WIDENING THE HEAD claims the IDENTICAL rows, so the generality is pure RISK", () => {
    const wide = legalAttackCorpus().filter(([, s]) =>
      /^Discard (.+) from your hand\. If you do, draw (\d+) cards\.$/.test(s),
    );
    expect([wide.length, units(wide)]).toEqual([2, 2]);
    expect(wide.map(([, s]) => s).sort()).toEqual([DRAW2, DRAW3].sort());
    expect(
      deriveAttackEffect(
        "Discard a Basic {G} Energy card from your hand. If you do, draw 2 cards.",
      ),
    ).toBeNull();
  });

  it("WIDENING THE CONSEQUENT claims a THIRD row, and THIS anchor still must not", () => {
    const wide = legalAttackCorpus().filter(([, s]) =>
      /^Discard a card from your hand\. If you do, (.+)\.$/.test(s),
    );
    expect([wide.length, units(wide)]).toEqual([3, 3]);
    expect(wide.map(([, s]) => s).sort()).toEqual([DRAW2, DRAW3, SIBLING_BUILT_AT_D515].sort());
    const byThisAnchor = legalAttackCorpus().filter(([, s]) => {
      const derived = deriveAttackEffect(s);
      if (derived === null || derived.length !== 2) return false;
      const gate = derived[1];
      return gate?.op === "recordGate" && gate.then[0]?.op === "drawCards";
    });
    expect(byThisAnchor.map(([, s]) => s).sort()).toEqual([DRAW2, DRAW3].sort());
    expect(byThisAnchor.map(([, s]) => s)).not.toContain(SIBLING_BUILT_AT_D515);
    expect(resolvedByAnyReader(SIBLING_BUILT_AT_D515)).toBe(true);
    expect(deriveAttackEffect(SIBLING_BUILT_AT_D515)).toEqual([
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "recordGate", slot: "paid", then: [{ op: "opponentDiscardsFromHand", count: 1 }] },
    ]);
  });
});

describe("D473 §2 — the program, and every refusal pinned on ONE printed byte", () => {
  it("derives THREE SHIPPED OPS in printed order, with the count captured", () => {
    expect(deriveAttackEffect(DRAW2)).toEqual(program(2));
    expect(deriveAttackEffect(DRAW3)).toEqual(program(3));
    expect(deriveAttackEffect(DRAW2)).not.toEqual(deriveAttackEffect(DRAW3));
  });

  it("the GATE's slot is the PAYMENT's slot — the two halves cannot drift apart", () => {
    const [cost, gate] = deriveAttackEffect(DRAW2) as EffectOp[];
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

  it("a printed 0 stays LOUD, and 1 does not", () => {
    expect(
      deriveAttackEffect("Discard a card from your hand. If you do, draw 0 cards."),
    ).toBeNull();
    expect(deriveAttackEffect("Discard a card from your hand. If you do, draw 1 cards.")).toEqual(
      program(1),
    );
  });

  it("each near-miss differs on ONE axis and each is refused for THAT axis", () => {
    expect(deriveAttackEffect(DRAW2)).not.toBeNull();
    for (const text of [
      "Discard a card from your hand. If you can't, draw 2 cards.",
      // …the QUANTIFIER alone: a plural cost is a different payment.
      "Discard 2 cards from your hand. If you do, draw 2 cards.",
      // …the SEAT alone: the printed subject is "your hand".
      "Discard a card from your opponent's hand. If you do, draw 2 cards.",
      // …the ARTICLE alone on the consequent: nothing prints the singular here, and
      // the anchor's `(\d+) cards` is what refuses it.
      "Discard a card from your hand. If you do, draw a card.",
      // …the ZONE alone: the deck is not the hand.
      "Discard a card from your deck. If you do, draw 2 cards.",
      // …the JOINER alone: "and" is not the §9.2 gate, and a build that read it as
      // one would draw on an empty hand.
      "Discard a card from your hand and draw 2 cards.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("the anchor is WHOLE-SENTENCE — leading text, trailing text, case and the period", () => {
    for (const text of [
      `Draw a card. ${DRAW2}`,
      `${DRAW2} Then, shuffle your deck.`,
      DRAW2.toLowerCase(),
      DRAW2.toUpperCase(),
      "Discard a card from your hand. If you do, draw 2 cards",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });
});

const DRAWER = "d473-drawer";
const DRAWER3 = "d473-drawer3";
const WALL = "d473-wall";
const ENERGY = "d473-energy";
const ITEM = "d473-item";

const LOCAL_CARDS: Record<string, Card> = {
  [DRAWER]: battler(DRAWER, {
    name: "D473 Drawer",
    hp: 120,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Restock", effect: DRAW2, damage: 30 }],
  }),
  [DRAWER3]: battler(DRAWER3, {
    name: "D473 Drawer Three",
    hp: 120,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Restock Plus", effect: DRAW3, damage: 30 }],
  }),
  // 330 HP so the flat 30 can never Knock Out, and no KO sweep can land between the
  // payment and the draw and re-order the events this file reads.
  [WALL]: battler(WALL, {
    name: "D473 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [ENERGY]: basicEnergy(ENERGY),
  [ITEM]: itemTrainer(ITEM),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({ [DRAWER]: 8, [DRAWER3]: 8, [WALL]: 8, [ENERGY]: 20, [ITEM]: 16 });

function mustStep(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  }
  return { state: result.state, events: [...result.events] };
}

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  state = completeSetup(state);
  return state;
}

/** TEST SURGERY: put `cardId` from the deck into the named spot. The fixture
    helpers key on `FIXTURE_POOL`, so this is the local equivalent. */
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

function handOf(state: GameState, count: number): GameState {
  const side = state.players.p1;
  const pool = [...side.deck, ...side.hand];
  const taken = pool.slice(pool.length - count);
  const deck = pool.slice(0, pool.length - count);
  return { ...state, players: { ...state.players, p1: { ...side, hand: taken, deck } } };
}

/** P1 on turn:action with `attacker` Active, funded, P2 behind the 330 HP wall. */
function fielded(seed: number, attacker: string): GameState {
  let state = localSetup(seed, "p2");
  state = mustStep(state, { type: "endTurn", seat: "p2" }).state;
  state = place(state, "p1", attacker, "active");
  state = fund(state, "p1");
  return place(state, "p2", WALL, "active");
}

const attack = { type: "attack", seat: "p1", index: 0 } as const;

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** THE ZONE TRIPLE this file reads every wrong implementation off. */
function zones(state: GameState): [hand: number, discard: number, deck: number] {
  const side = state.players.p1;
  return [side.hand.length, side.discard.length, side.deck.length];
}

function settle(state: GameState, ops: EffectOp[]): GameState {
  const events: GameEvent[] = [];
  let result = runProgram(state, ops, { seat: "p1" }, events);
  while (result.kind === "parked") {
    const prompt = result.prompt;
    if (prompt.kind !== "chooseCards") throw new Error(`unexpected park: ${prompt.kind}`);
    result = resumeProgram(
      result.state,
      result.cont,
      { kind: "cards", uids: prompt.candidates.slice(0, prompt.min) },
      events,
    );
  }
  return result.state;
}

describe("D473 §3 — the discriminating board: EIGHT readings, EIGHT different answers", () => {
  /** The alternatives, each a program a careless author would really write, run
      through the REAL interpreter on the REAL board. No arithmetic in a comment. */
  const CANDIDATES: Record<string, EffectOp[]> = {
    correct: program(2),
    // The SIBLING's count — a capture read off the wrong group, or a literal.
    siblingCount: program(3),
    // The gate DELETED: the draw runs whatever the payment did. Indistinguishable
    // here and separated by §4's empty hand, which is why §4 exists.
    gateDropped: [
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      { op: "drawCards", count: 2 },
    ],
    // The payment PLURALISED — the shape every other `payFromHand` producer in the
    // engine carries (Ultra Ball, SER and Kofu all pay 2).
    paysTwo: [
      { op: "payFromHand", count: 2, to: "discard", recordAs: "paid" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: 2 }] },
    ],
    // The DESTINATION crossed — Dendra's `deckBottom`, the sibling value on the very
    // field this arm sets, and the discard pile is what tells them apart.
    toDeckBottom: [
      { op: "payFromHand", count: 1, to: "deckBottom", recordAs: "paid" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: 2 }] },
    ],
    wholeHand: [{ op: "discardHand" }, { op: "drawCards", count: 2 }],
    // The gate reading ANOTHER slot: it compiles, it derives, and it never fires.
    wrongSlot: [
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "recordGate", slot: "moved", then: [{ op: "drawCards", count: 2 }] },
    ],
    // The payment filing NOTHING: same shape, same gate, and the draw is dead.
    noRecordAs: [
      { op: "payFromHand", count: 1, to: "discard" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: 2 }] },
    ],
  };

  it("seven of the eight answer a DIFFERENT zone triple on ONE board", () => {
    const state = handOf(fielded(1, DRAWER), 4);
    expect(zones(state)).toEqual([4, 0, state.players.p1.deck.length]);
    const answers = Object.fromEntries(
      Object.entries(CANDIDATES).map(([name, ops]) => [name, zones(settle(state, ops))]),
    );
    const deck = state.players.p1.deck.length;
    expect(answers).toEqual({
      correct: [5, 1, deck - 2],
      siblingCount: [6, 1, deck - 3],
      gateDropped: [5, 1, deck - 2],
      paysTwo: [4, 2, deck - 2],
      toDeckBottom: [5, 0, deck - 2 + 1],
      wholeHand: [2, 4, deck - 2],
      wrongSlot: [3, 1, deck],
      noRecordAs: [3, 1, deck],
    });
    const distinct = new Set(Object.values(answers).map((a) => a.join("/")));
    expect(distinct.size).toBe(6);
  });

  it("the UIDS say the ORDER, which no count can see (D404's rule)", () => {
    // Under the swapped program every op still runs, HAND_COST_PAID still fires and
    // the hand still ends at five — so a count-based assertion is green on the defect.
    // These two sets are disjoint by construction and the swap makes them overlap.
    const state = handOf(fielded(2, DRAWER), 4);
    const before = state.players.p1;
    const oldHand = [...before.hand];
    const topTwo = before.deck.slice(0, 2);
    expect(oldHand).toHaveLength(4);
    expect(topTwo).toHaveLength(2);

    const { state: done, events } = mustStep(state, attack);
    // The park is answered below; the pre-park events already name the payment.
    const paid = find(events, "HAND_COST_PAID");
    expect(paid).toBeUndefined(); // …because a 4-card hand PARKS. §5 owns that path.
    const phase = done.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const chosen = oldHand[0] as string;
    const { state: settled, events: rest } = mustStep(done, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [chosen] },
    });
    expect(find(rest, "HAND_COST_PAID")).toMatchObject({ seat: "p1", uids: [chosen] });
    expect(find(rest, "CARDS_DRAWN")).toMatchObject({ seat: "p1", uids: topTwo, reason: "effect" });
    // The discarded card is the OLD hand's, and NEITHER drawn card is in the discard.
    expect(settled.players.p1.discard).toEqual([chosen]);
    for (const uid of topTwo) expect(settled.players.p1.discard).not.toContain(uid);
    // …and the hand is the three kept plus the two drawn, in that arrangement.
    expect(settled.players.p1.hand.sort()).toEqual(
      [...oldHand.filter((u) => u !== chosen), ...topTwo].sort(),
    );
  });

  it("the printed BASE is KEPT — neither op is a `damageDefender`", () => {
    // `programDamage` is `program?.some(step => step.op === "damageDefender")`, so it
    // is FALSE here and the printed 30 survives the pipeline. A reading that claimed
    // the base would silently delete a 30-damage attack.
    const state = handOf(fielded(3, DRAWER), 1);
    const { state: done, events } = mustStep(state, attack);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(done.players.p2.active?.damage).toBe(30);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(1);
  });
});

describe("D473 §4 — the ZERO-MATCH board, with the controls that say WHY it is silent", () => {
  it("an EMPTY hand discards nothing and draws nothing — and this is the rung the gate exists for", () => {
    const state = handOf(fielded(4, DRAWER), 0);
    expect(zones(state)[0]).toBe(0);
    const deckBefore = state.players.p1.deck.length;
    const { state: done, events } = mustStep(state, attack);
    expect(zones(done)).toEqual([0, 0, deckBefore]);
    expect(find(events, "CARDS_DRAWN")?.reason).not.toBe("effect");
    expect(find(events, "HAND_COST_PAID")).toBeUndefined();
    // …and the CONTROL that says the silence is the PRINTED one: the same board with
    // ONE card in hand pays it and draws two.
    const one = handOf(fielded(4, DRAWER), 1);
    const done1 = mustStep(one, attack).state;
    expect(zones(done1)[0]).toBe(2);
  });

  it("the empty board is silent for the SENTENCE's reason, not because the sentence is unread", () => {
    const { events } = mustStep(handOf(fielded(5, DRAWER), 0), attack);
    expect(events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toEqual([]);
    // …and the attack itself resolved: the damage landed and the turn ended, so this
    // is a withheld CONSEQUENT and not a cancelled attack (which is what a printed
    // "If you can't, this attack does nothing." would have produced).
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
  });

  it("the SIBLING count is driven on a board of its own, so the capture is not a constant", () => {
    // A suite that only ever drives `draw 2` is green on an arm that ignores the
    // capture and returns 2 forever. One card in hand, so the payment is forced and
    // the whole thing resolves inline.
    const state = handOf(fielded(6, DRAWER3), 1);
    const { state: done, events } = mustStep(state, attack);
    expect(find(events, "CARDS_DRAWN")).toMatchObject({ seat: "p1", reason: "effect" });
    expect(find(events, "CARDS_DRAWN")?.uids).toHaveLength(3);
    expect(zones(done)[0]).toBe(3);
  });
});

describe("D473 §5 — the PARK, the FORCED path, and the caption the engine already had", () => {
  it("a hand of ONE is FORCED and resolves inline; a hand of TWO PARKS", () => {
    const forced = mustStep(handOf(fielded(7, DRAWER), 1), attack).state;
    expect(forced.phase.kind).not.toBe("effect:choose");
    const parked = mustStep(handOf(fielded(7, DRAWER), 2), attack).state;
    expect(parked.phase.kind).toBe("effect:choose");
  });

  it("the park's CAPTION is the whole printed sentence, byte for byte", () => {
    const parked = mustStep(handOf(fielded(8, DRAWER), 3), attack).state;
    const phase = parked.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(phase.prompt.kind).toBe("chooseCards");
    if (phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(phase.prompt.note).toBe(DRAW2);
    // …the pick is MANDATORY and exact, which is the printed cost's own shape.
    expect([phase.prompt.min, phase.prompt.max]).toEqual([1, 1]);
    expect(phase.prompt.dest).toBe("discard");
    expect(phase.prompt.candidates.sort()).toEqual([...parked.players.p1.hand].sort());
    // …and the SIBLING captions its own number, so the caption reads the program.
    const parked3 = mustStep(handOf(fielded(8, DRAWER3), 3), attack).state;
    const phase3 = parked3.phase;
    if (phase3.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(phase3.prompt.kind === "chooseCards" ? phase3.prompt.note : "").toBe(DRAW3);
  });

  it("an empty answer is REFUSED — there is no decline behind a printed cost", () => {
    const parked = mustStep(handOf(fielded(9, DRAWER), 3), attack).state;
    const rejected = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(rejected.ok).toBe(false);
    // …and a card that is not in the hand is refused too, on the same park.
    const alien = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [parked.players.p1.deck[0] as string] },
    });
    expect(alien.ok).toBe(false);
  });
});

describe("D473 §6 — `MATCH_RECORD_VERSION` stays 29, and the argument is DRIVEN", () => {
  it("the SERIALIZED ALPHABET: every byte this arm can write, a v29 deploy could write", () => {
    const emitted = JSON.stringify(deriveAttackEffect(DRAW2));
    expect(emitted).toBe(
      '[{"op":"payFromHand","count":1,"to":"discard","recordAs":"paid"},{"op":"recordGate","slot":"paid","then":[{"op":"drawCards","count":2}]}]',
    );
    // …and the persisted continuation really does hold exactly that, driven rather
    // than argued: the park's `pendingOp` is the payment and its `rest` is the gate.
    const parked = mustStep(handOf(fielded(10, DRAWER), 3), attack).state;
    const phase = parked.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(JSON.parse(JSON.stringify(phase.cont.pendingOp))).toEqual(program(2)[0]);
    expect(JSON.parse(JSON.stringify(phase.cont.rest))).toEqual([program(2)[1]]);
  });

  it("the LOSS direction, driven: a truncated `rest` degrades into a DIFFERENT board", () => {
    const parked = mustStep(handOf(fielded(11, DRAWER), 3), attack).state;
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
    expect(zones(whole)[0]).toBe(4);
    expect(zones(lost)[0]).toBe(2);
    expect(zones(whole)).not.toEqual(zones(lost));
  });
});
