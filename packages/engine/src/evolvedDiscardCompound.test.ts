import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { BoardCondition, EffectOp } from "./effectTypes";
import {
  deriveAttackDamageBonus,
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackTrailingClause,
  ATTACK_READERS,
} from "./effects";
import type { GameEvent } from "./events";
import { applyAction, engineVersion } from "./index";
import type { GameState, Seat } from "./index";
import { resumeProgram, runProgram } from "./interpreter";
import { conditionHolds, conditionNote } from "./boardCondition";
import {
  FIXTURE_POOL,
  attachFromDeck,
  basicEnergy,
  battler,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  trainerCard,
  types,
  driveSetup,
  roundTrip,
} from "./testFixtures";

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

const COMPOUND =
  "Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards.";
const HEAD = "Your opponent discards a card from their hand.";
const TAIL =
  "If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards.";
/** The clause the compound's gate half carries, as a key into the SHARED table. */
const CLAUSE = "this Pokémon evolved from Salandit during this turn";

const SALANDIT: BoardCondition = { kind: "yourActiveEvolvedFromThisTurn", name: "Salandit" };

/** The whole derived program, written out so §3 reads the arm against a value rather than
    against a re-typed expectation. */
const PROGRAM: readonly EffectOp[] = [
  { op: "opponentDiscardsFromHand", count: 1 },
  {
    op: "conditionGate",
    cond: SALANDIT,
    ops: [{ op: "opponentDiscardsFromHand", count: 2 }],
  },
];

const SIBLING: readonly EffectOp[] = [
  {
    op: "conditionGate",
    cond: SALANDIT,
    ops: [{ op: "opponentDiscardsFromHand", count: 3 }],
    otherwise: [{ op: "opponentDiscardsFromHand", count: 1 }],
  },
];

const READERS = ATTACK_READERS.map(({ read }) => read);

const SEED = 20260908;

const GATED_DISCARD = 0;
const NO_EFFECT_AT_ALL = 1;

const CARDS: Record<string, Card> = {
  "d486-salazzle": {
    ...battler("d486-salazzle", { name: "D486 Salazzle", hp: 130, types: ["Fire"] }),
    stage: "Stage1",
    evolveFrom: "Salandit",
    attacks: [
      { cost: ["Colorless"], name: "Gated Toxin", effect: COMPOUND },
      { cost: ["Colorless"], name: "Plain Swipe", damage: 30 },
    ],
  },
  /** The card the printed clause NAMES. */
  "d486-salandit": battler("d486-salandit", { name: "Salandit", hp: 70, types: ["Fire"] }),
  /** The NAME cross-control: the identical printed sentence on a body that evolves from
      something else, so the stamp is TRUE and the name is WRONG on the same board. */
  "d486-crossling": {
    ...battler("d486-crossling", { name: "D486 Crossling", hp: 130, types: ["Fire"] }),
    stage: "Stage1",
    evolveFrom: "Grubbin",
    attacks: [{ cost: ["Colorless"], name: "Gated Toxin", effect: COMPOUND }],
  },
  "d486-grubbin": battler("d486-grubbin", { name: "Grubbin", hp: 70, types: ["Fire"] }),
  /** The far seat. 340 HP and no attacks: nothing here Knocks it Out and nothing
      retaliates across the multi-turn boards §4 fields. */
  "d486-wall": battler("d486-wall", { name: "D486 Wall", types: ["Colorless"], hp: 340 }),
  "d486-h1": trainerCard("d486-h1", "Item", "The first test hand card."),
  "d486-h2": trainerCard("d486-h2", "Item", "The second test hand card."),
  "d486-h3": trainerCard("d486-h3", "Supporter", "The third test hand card."),
  "d486-h4": trainerCard("d486-h4", "Stadium", "The fourth test hand card."),
  "d486-h5": trainerCard("d486-h5", "Tool", "The fifth test hand card."),
  "d486-nrg": basicEnergy("d486-nrg"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...CARDS };

const DECK = deckOf({
  "d486-salazzle": 8,
  "d486-salandit": 8,
  "d486-crossling": 4,
  "d486-grubbin": 4,
  "d486-wall": 8,
  "d486-h1": 4,
  "d486-h2": 4,
  "d486-h3": 4,
  "d486-h4": 4,
  "d486-h5": 4,
  "d486-nrg": 8,
});

const HAND_5 = ["d486-h1", "d486-h2", "d486-h3", "d486-h4", "d486-h5"] as const;
/** The collision hand of §5's second half: TWO cards, where this program and the sibling
    diverge on the park. */
const HAND_2 = ["d486-h1", "d486-h2"] as const;
/** ONE card — the board on which the two are byte-identical and neither asks. */
const HAND_1 = ["d486-h1"] as const;

function openTable(first: Seat): GameState {
  return driveSetup(SEED, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

/** Rebuild `seat`'s HAND outright (`opponentHandDiscard.test.ts`'s `withHand`, needed here
    for its reason — the opponent's hand IS the zone under test, and every board below has
    to field it at an exact composition). */
function withHand(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  let next: GameState = {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, hand: [], deck: [...side.deck, ...side.hand] },
    },
  };
  for (const id of ids) next = handFromDeck(next, seat, id, 1);
  return next;
}

/** Play `cardId` out of p1's hand as an evolution onto the Active. */
function evolve(state: GameState, cardId: string): GameState {
  const withCard = handFromDeck(state, "p1", cardId, 1);
  return mustApply(withCard, {
    type: "evolve",
    seat: "p1",
    uid: handUid(withCard, "p1", cardId),
    target: { spot: "active" },
  }).state;
}

type Ready = {
  /** The Basic p1 starts from, or `null` for a Stage 1 placed straight into play. */
  readonly from?: string | null;
  /** The Stage 1 that ends up Active. */
  readonly to: string;
  /** How many whole rounds to let pass BETWEEN the evolution and the attack. `0` is the
      printed line of play; `1` is the STALE board, where the name is right and the turn
      is not. */
  readonly rounds?: number;
  readonly oppHand?: readonly string[];
};

function ready(opts: Ready): GameState {
  let state = openTable("p2");
  // Three `endTurn`s: §4/§10 refuses an evolution on a player's own first turn, so this
  // is the cheapest route to a turn on which the printed line of play is legal at all.
  for (const seat of ["p2", "p1", "p2"] as const) {
    state = mustApply(state, { type: "endTurn", seat }).state;
  }
  state = setActiveFromDeck(state, "p1", opts.from ?? opts.to);
  state = setActiveFromDeck(state, "p2", "d486-wall");
  state = clearBench(clearBench(state, "p1"), "p2");
  if (opts.from != null) state = evolve(state, opts.to);
  for (let round = 0; round < (opts.rounds ?? 0); round += 1) {
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  }
  state = attachFromDeck(state, "p1", "d486-nrg", 1);
  state = withHand(state, "p1", ["d486-h1", "d486-h2"]);
  return withHand(state, "p2", opts.oppHand ?? HAND_5);
}

/** The card id behind a uid, off the two persisted maps the state actually carries. */
function idOf(uid: string, state: GameState): string {
  const id = state.cardIdByUid[uid];
  if (id === undefined) throw new Error(`no card for uid ${uid}`);
  return id;
}

const idsIn = (state: GameState, seat: Seat, zone: "hand" | "discard"): string[] =>
  state.players[seat][zone].map((uid) => idOf(uid, state)).sort();

function drive(
  state: GameState,
  program: readonly EffectOp[],
  seat: Seat = "p1",
): { state: GameState; parks: number; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let result = runProgram(deepFreeze(state), program, { seat }, {}, events);
  let parks = 0;
  while (result.kind === "parked") {
    parks += 1;
    const prompt = result.prompt;
    if (prompt.kind !== "chooseCards") throw new Error(`unexpected prompt ${prompt.kind}`);
    result = resumeProgram(
      result.state,
      result.cont,
      { kind: "cards", uids: prompt.candidates.slice(0, prompt.min) },
      events,
    );
  }
  return { state: result.state, parks, events };
}

/** How many cards the run moved out of p2's hand. Derived from the board rather than from
    an event count, so a build that filed two rows for one discard cannot inflate it. */
const discarded = (before: GameState, after: GameState): number =>
  before.players.p2.hand.length - after.players.p2.hand.length;

describe("§1 — the sentence and the two families it lands in, measured not quoted", () => {
  it("the printed sentence is IN the legal attack column at exactly 1 printing", () => {
    const row = corpus().find(([, sentence]) => sentence === COMPOUND);
    expect(row).toBeDefined();
    expect(row?.[0]).toBe(1);
  });

  it("the GATED-INCREMENT family is TWO sentences / THREE printings, and the other is Ancient", () => {
    const family = corpus().filter(([, s]) => /\d+ more cards?\b/.test(s));
    expect(family.map(([n, s]) => `${n} ${s}`).sort()).toEqual(
      [
        "1 Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards.",
        "2 Discard the top card of your opponent's deck. If you played an Ancient Supporter card from your hand during this turn, discard 3 more cards in this way.",
      ].sort(),
    );
    expect(units(family)).toBe(3);
    const sibling = family.find(([, s]) => s !== COMPOUND);
    expect(sibling?.[1]).toContain("in this way");
    expect(sibling?.[1]).toContain("Ancient");
    expect(resolvedByAnyReader(sibling?.[1] ?? "")).toBe(false);
  });

  it("the `evolved from` family is THREE sentences and ALL THREE are now read", () => {
    const family = corpus().filter(([, s]) => s.includes("evolved from"));
    expect(family).toHaveLength(3);
    expect(units(family)).toBe(3);
    expect(family.filter(([, s]) => resolvedByAnyReader(s))).toHaveLength(3);
    expect(family.filter(([, s]) => s === COMPOUND)).toHaveLength(1);
  });
});

describe("§2 — the oracle, and what exactly one of thirteen readers claims", () => {
  it("exactly ONE of the thirteen claims the compound, and it is `deriveAttackEffect`", () => {
    const claimers = READERS.filter((read) => read(COMPOUND) !== null).map((read) => read.name);
    expect(claimers).toEqual(["deriveAttackEffect"]);
    expect(resolvedByAnyReader(COMPOUND)).toBe(true);
  });

  it("the TAIL is still claimed by NOBODY — the anchor is the WHOLE sentence", () => {
    // §7's subject, stated as a property of all thirteen rather than of one.
    expect(READERS.filter((read) => read(TAIL) !== null)).toHaveLength(0);
    expect(resolvedByAnyReader(TAIL)).toBe(false);
  });

  it("the HEAD still derives to the program it has derived to since D426", () => {
    expect(deriveAttackEffect(HEAD)).toEqual([{ op: "opponentDiscardsFromHand", count: 1 }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE ARM
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the derived program, and what the arm refuses", () => {
  it("the printed sentence derives to the discard AND the gated increment, in printed order", () => {
    expect(deriveAttackEffect(COMPOUND)).toEqual(PROGRAM);
  });

  it("the FIRST op is byte-identical to the HEAD's own reading, not a re-typed literal", () => {
    expect(deriveAttackEffect(COMPOUND)?.slice(0, 1)).toEqual(deriveAttackEffect(HEAD));
  });

  it("the gate's condition comes from the SHARED clause table, at the printed name", () => {
    const gate = deriveAttackEffect(COMPOUND)?.[1];
    expect(gate).toMatchObject({ op: "conditionGate", cond: SALANDIT });
    expect(deriveAttackDamageBonus(`If ${CLAUSE}, this attack does 30 more damage.`)).toEqual({
      per: 30,
      count: { kind: "boardCondition", cond: SALANDIT },
    });
    expect(corpus().filter(([, s]) => s.includes(CLAUSE) && s !== COMPOUND)).toHaveLength(0);
  });

  it("an UNMAPPED clause falls through to null and stays LOUD", () => {
    expect(
      deriveAttackEffect(
        "Your opponent discards a card from their hand. If this Pokémon evolved from Rayquaza during this turn, your opponent discards 2 more cards.",
      ),
    ).toBeNull();
  });

  it("a printed ZERO increment derives to nothing at all", () => {
    // The `>= 1` floor every numeric arm in this file carries. A `0` here would derive to
    // an attack that reports a simulated discard of nothing.
    expect(
      deriveAttackEffect(
        `Your opponent discards a card from their hand. If ${CLAUSE}, your opponent discards 0 more cards.`,
      ),
    ).toBeNull();
    // …and the floor is a FLOOR, not an equality: a bigger printed increment reads.
    expect(
      deriveAttackEffect(
        `Your opponent discards a card from their hand. If ${CLAUSE}, your opponent discards 4 more cards.`,
      ),
    ).toEqual([
      { op: "opponentDiscardsFromHand", count: 1 },
      { op: "conditionGate", cond: SALANDIT, ops: [{ op: "opponentDiscardsFromHand", count: 4 }] },
    ]);
  });

  it("the two anchors are DISJOINT by construction, and both still read", () => {
    expect(deriveAttackEffect("Your opponent discards 2 cards from their hand.")).toEqual([
      { op: "opponentDiscardsFromHand", count: 2 },
    ]);
    expect(deriveAttackEffect(HEAD)).toEqual([{ op: "opponentDiscardsFromHand", count: 1 }]);
    expect(deriveAttackEffect(COMPOUND)).toEqual(PROGRAM);
  });

  it("reads the sentence OFF THE DEMONSTRATOR, not off this file's copy", () => {
    const attacks = CARDS["d486-salazzle"]?.attacks ?? [];
    expect(attacks[GATED_DISCARD]?.effect).toBe(COMPOUND);
    expect(attacks[GATED_DISCARD]?.damage).toBeUndefined();
    expect(attacks[NO_EFFECT_AT_ALL]?.effect).toBeUndefined();
    expect(deriveAttackEffect(attacks[GATED_DISCARD]?.effect ?? "")).toEqual(PROGRAM);
  });
});

describe("§4 — the three ways the gate is false, one axis apart each", () => {
  it("GATE TRUE — evolved from Salandit this turn: THREE cards leave the opponent's hand", () => {
    const state = ready({ from: "d486-salandit", to: "d486-salazzle" });
    const after = drive(state, PROGRAM);
    expect(discarded(state, after.state)).toBe(3);
    // The cards that left are the ones that were OFFERED, not merely three of something.
    expect(idsIn(after.state, "p2", "discard")).toEqual(["d486-h1", "d486-h2", "d486-h3"].sort());
    expect(idsIn(after.state, "p2", "hand")).toEqual(["d486-h4", "d486-h5"].sort());
  });

  it("GATE FALSE — the STAGE 1 placed straight into play: exactly ONE card leaves", () => {
    // One axis from the case above: the same body, the same hand, the same turn — and no
    // evolution at all, so `evolvedTurn` is null.
    const state = ready({ from: null, to: "d486-salazzle" });
    expect(conditionHolds(state, "p1", SALANDIT)).toBe(false);
    const after = drive(state, PROGRAM);
    expect(discarded(state, after.state)).toBe(1);
  });

  it("GATE FALSE — the NAME axis: evolved this turn, from the WRONG Basic", () => {
    // One axis: the evolution HAPPENED and it happened THIS turn, so the stamp is true
    // and only `cond.name` says no. A build that read the stamp alone pays here.
    const state = ready({ from: "d486-grubbin", to: "d486-crossling" });
    expect(state.players.p1.active?.evolvedTurn).toBe(state.turn);
    expect(conditionHolds(state, "p1", SALANDIT)).toBe(false);
    expect(discarded(state, drive(state, PROGRAM).state)).toBe(1);
  });

  it("GATE FALSE — the TURN axis: evolved from Salandit, but a round ago", () => {
    // One axis from the TRUE case: the same bodies, the same names, the same stack —
    // and the attack is declared a full round later. A build that dropped the turn test
    // pays this increment forever after the evolution.
    const state = ready({ from: "d486-salandit", to: "d486-salazzle", rounds: 1 });
    expect(state.players.p1.active?.evolvedTurn).not.toBeNull();
    expect(state.players.p1.active?.evolvedTurn).not.toBe(state.turn);
    expect(conditionHolds(state, "p1", SALANDIT)).toBe(false);
    expect(discarded(state, drive(state, PROGRAM).state)).toBe(1);
  });

  it("the CONTROLLER's own hand is untouched on both boards", () => {
    // The seat axis, observable only because `ready` loads p1's hand. A build that read
    // `ctx.seat` instead of `otherSeat(ctx.seat)` would empty this hand and leave the
    // other one whole, and both halves are asserted.
    for (const from of ["d486-salandit", null]) {
      const state = ready({ from, to: "d486-salazzle" });
      const after = drive(state, PROGRAM);
      expect(idsIn(after.state, "p1", "hand")).toEqual(idsIn(state, "p1", "hand"));
      expect(idsIn(after.state, "p1", "discard")).toEqual(idsIn(state, "p1", "discard"));
    }
  });
});

/** The five programs a builder could plausibly ship for this sentence, INCLUDING the one
    that ships. Each is a whole program, so §5 measures them rather than describing them. */
const CANDIDATES: readonly (readonly [string, readonly EffectOp[]])[] = [
  ["correct — the head, then the gated increment", PROGRAM],
  [
    "the gate DROPPED — always three",
    [
      { op: "opponentDiscardsFromHand", count: 1 },
      { op: "opponentDiscardsFromHand", count: 2 },
    ],
  ],
  [
    "the HEAD dropped — the gated half alone",
    [{ op: "conditionGate", cond: SALANDIT, ops: [{ op: "opponentDiscardsFromHand", count: 2 }] }],
  ],
  [
    '"2 more" read as the TOTAL — one, then three',
    [
      { op: "opponentDiscardsFromHand", count: 1 },
      { op: "conditionGate", cond: SALANDIT, ops: [{ op: "opponentDiscardsFromHand", count: 3 }] },
    ],
  ],
  [
    "the gate INVERTED — the increment on the false arm",
    [
      { op: "opponentDiscardsFromHand", count: 1 },
      {
        op: "conditionGate",
        cond: SALANDIT,
        ops: [],
        otherwise: [{ op: "opponentDiscardsFromHand", count: 2 }],
      },
    ],
  ],
];

/** The park-count difference (shipped − sibling) over §5's twelve boards, in the order
    they are driven: gate-true hands of 0..5, then gate-false hands of 0..5. */
const PARK_GAP = [0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0];

describe("§5 — five candidate readings, and the sibling that no card count can separate", () => {
  it("the five readings answer five DISTINCT (gate-true, gate-false) PAIRS on a five-card hand", () => {
    const trueBoard = ready({ from: "d486-salandit", to: "d486-salazzle" });
    const falseBoard = ready({ from: null, to: "d486-salazzle" });
    const pairs = CANDIDATES.map(([, program]) => [
      discarded(trueBoard, drive(trueBoard, program).state),
      discarded(falseBoard, drive(falseBoard, program).state),
    ]);
    expect(pairs).toEqual([
      [3, 1], // correct
      [3, 3], // the gate dropped
      [2, 0], // the head dropped
      [4, 1], // "2 more" as the total
      [1, 3], // the gate inverted
    ]);
    expect(new Set(pairs.map((pair) => pair.join("/"))).size).toBe(CANDIDATES.length);
    expect(new Set(pairs.map(([onTrue]) => onTrue)).size).toBe(4);
    expect(new Set(pairs.map(([, onFalse]) => onFalse)).size).toBe(3);
  });

  it("THE FOUR-CARD FLOOR: a THREE-card hand collapses two of the five readings", () => {
    // Why the hand is five and not three. At `H = 3` the clamp swallows the difference
    // between *correct* and *"2 more" as the total* — both empty the hand — so the
    // reading that over-discards would have been invisible. Driven, not argued.
    const small = ready({
      from: "d486-salandit",
      to: "d486-salazzle",
      oppHand: HAND_5.slice(0, 3),
    });
    const onThree = CANDIDATES.map(([, program]) => discarded(small, drive(small, program).state));
    expect(onThree).toEqual([3, 3, 2, 3, 1]);
    expect(new Set(onThree).size).toBe(3);
  });

  it("THE SIBLING COMPOSITION AGREES ON EVERY CARD COUNT — the counts cannot choose", () => {
    const mine: number[] = [];
    const theirs: number[] = [];
    const parkGap: number[] = [];
    for (const from of ["d486-salandit", null]) {
      for (const size of [0, 1, 2, 3, 4, 5]) {
        const state = ready({ from, to: "d486-salazzle", oppHand: HAND_5.slice(0, size) });
        const a = drive(state, PROGRAM);
        const b = drive(state, SIBLING);
        mine.push(discarded(state, a.state));
        theirs.push(discarded(state, b.state));
        parkGap.push(a.parks - b.parks);
      }
    }
    expect(mine).toEqual([0, 1, 2, 3, 3, 3, 0, 1, 1, 1, 1, 1]);
    expect(theirs).toEqual(mine);
    expect(parkGap).toEqual(PARK_GAP);
  });

  it("THE COLLISION BOARD IS THE SMALLEST ONE, AND THE DIVERGENCE IS AT TWO CARDS", () => {
    const one = ready({ from: "d486-salandit", to: "d486-salazzle", oppHand: HAND_1 });
    const mineOne = drive(one, PROGRAM);
    const theirsOne = drive(one, SIBLING);
    expect(mineOne.parks).toBe(0);
    expect(theirsOne.parks).toBe(0);
    expect(idsIn(mineOne.state, "p2", "discard")).toEqual(idsIn(theirsOne.state, "p2", "discard"));
    expect(idsIn(mineOne.state, "p2", "hand")).toEqual(idsIn(theirsOne.state, "p2", "hand"));

    // …and at TWO the shipped program ASKS and the sibling does not. Same board, same
    // three cards discarded, one question against none — which is the whole of the
    // difference and the reason the choice had to be made from an argument.
    const two = ready({ from: "d486-salandit", to: "d486-salazzle", oppHand: HAND_2 });
    const mineTwo = drive(two, PROGRAM);
    const theirsTwo = drive(two, SIBLING);
    expect([mineTwo.parks, theirsTwo.parks]).toEqual([1, 0]);
    expect([discarded(two, mineTwo.state), discarded(two, theirsTwo.state)]).toEqual([2, 2]);
    expect(types(mineTwo.events)).toEqual(["FORCED_HAND_DISCARD", "FORCED_HAND_DISCARD"]);
    expect(types(theirsTwo.events)).toEqual(["FORCED_HAND_DISCARD"]);
  });

  it("on a FIVE-card hand the shipped program asks TWICE, in the printed voices", () => {
    const state = ready({ from: "d486-salandit", to: "d486-salazzle" });
    const notes: string[] = [];
    let result = runProgram(deepFreeze(state), PROGRAM, { seat: "p1" }, {}, []);
    while (result.kind === "parked") {
      const prompt = result.prompt;
      if (prompt.kind !== "chooseCards") throw new Error("expected a chooseCards prompt");
      notes.push(prompt.note ?? "");
      expect(result.decider).toBe("p2");
      expect([prompt.min, prompt.max]).toEqual([
        notes.length === 1 ? 1 : 2,
        notes.length === 1 ? 1 : 2,
      ]);
      result = resumeProgram(
        result.state,
        result.cont,
        { kind: "cards", uids: prompt.candidates.slice(0, prompt.min) },
        [],
      );
    }
    expect(notes).toEqual(["Discard a card from your hand.", "Discard 2 cards from your hand."]);
    // …and neither caption is the printed sentence, which is the claim the round-trip
    // rule is deliberately broken for.
    for (const note of notes) expect(note).not.toBe(COMPOUND);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE ZERO-MATCH BOARD, WITH ITS CONTROLS
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — an EMPTY opponent hand, and the two silences it has to separate", () => {
  it("discards nothing, asks nothing and files nothing — on BOTH gate boards", () => {
    for (const from of ["d486-salandit", null]) {
      const state = ready({ from, to: "d486-salazzle", oppHand: [] });
      const after = drive(state, PROGRAM);
      expect(after.parks).toBe(0);
      expect(discarded(state, after.state)).toBe(0);
      expect(types(after.events)).toEqual([]);
      expect(after.state).toBe(state);
    }
  });

  it("THE CONTROL: the SAME attacker's other attack files nothing for a DIFFERENT reason", () => {
    const attacks = CARDS["d486-salazzle"]?.attacks ?? [];
    expect(deriveAttackEffect(attacks[NO_EFFECT_AT_ALL]?.effect ?? "")).toBeNull();
    const state = ready({ from: "d486-salandit", to: "d486-salazzle", oppHand: [] });
    const plain = mustApply(state, { type: "attack", seat: "p1", index: NO_EFFECT_AT_ALL });
    expect(idsIn(plain.state, "p2", "discard")).toEqual(idsIn(state, "p2", "discard"));
    expect(types(plain.events)).toContain("DAMAGE_DEALT");
    // …and the gated attack on the same empty hand deals NO damage and still resolves.
    const gated = mustApply(state, { type: "attack", seat: "p1", index: GATED_DISCARD });
    expect(gated.state.phase.kind).not.toBe("effect:choose");
    expect(types(gated.events)).not.toContain("FORCED_HAND_DISCARD");
  });

  it("THE CONTROL FROM THE OTHER SIDE: a LOADED hand on the plain attack moves nothing", () => {
    // The mirror of the rung above, and the one that makes it mean something: the same
    // board, the same five cards, an attack with no effect text — nothing leaves. A build
    // whose discard fired off ATTACK_DECLARED rather than off this program would redden.
    const state = ready({ from: "d486-salandit", to: "d486-salazzle" });
    const plain = mustApply(state, { type: "attack", seat: "p1", index: NO_EFFECT_AT_ALL });
    // The DISCARD PILE again, for the rung above's reason — and the hand is checked for
    // the one thing the turn change CAN do to it, which is grow by the draw.
    expect(idsIn(plain.state, "p2", "discard")).toEqual(idsIn(state, "p2", "discard"));
    expect(plain.state.players.p2.hand.length).toBe(state.players.p2.hand.length + 1);
    expect(plain.state.phase.kind).not.toBe("effect:choose");
  });
});

describe("§7 — the tail-only arm the splitter would have accepted, and why it is refused", () => {
  it("the splitter's HEAD condition and its BREAK both hold — only the tail reader is missing", () => {
    expect(deriveAttackEffect(HEAD)).not.toBeNull();
    const composable = `${HEAD} Your opponent's Active Pokémon is now Asleep.`;
    expect(splitAttackTrailingClause(composable)).toEqual({
      head: HEAD,
      tail: "Your opponent's Active Pokémon is now Asleep.",
    });
  });

  it("THE REFUSAL: `2 more` is an ANAPHOR, and a tail arm would compose it behind ANY head", () => {
    const stray = `Your opponent's Active Pokémon is now Asleep. ${TAIL}`;
    expect(deriveAttackEffect(stray)).toBeNull();
    expect(splitAttackTrailingClause(stray)).toBeNull();
    expect(splitAttackGateClause(stray)).toBeNull();
    expect(resolvedByAnyReader(stray)).toBe(false);
    const drawHead = `Draw 3 cards. ${TAIL}`;
    expect(deriveAttackEffect(drawHead)).toBeNull();
    expect(splitAttackTrailingClause(drawHead)).toBeNull();
  });

  it("the compound is claimed WHOLE, so the splitter never sees it — its shadow refusal", () => {
    expect(resolvedByAnyReader(COMPOUND)).toBe(true);
    expect(splitAttackTrailingClause(COMPOUND)).toBeNull();
    expect(splitAttackGateClause(COMPOUND)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE PERSISTED SHAPE: `MATCH_RECORD_VERSION` STAYS 29, DRIVEN
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — what this program can put into a persisted `phase.cont`", () => {
  it("the park's continuation carries a `conditionGate` — a NEW COMBINATION of OLD members", () => {
    const state = ready({ from: "d486-salandit", to: "d486-salazzle" });
    const parked = mustApply(state, { type: "attack", seat: "p1", index: GATED_DISCARD });
    if (parked.state.phase.kind !== "effect:choose") throw new Error("expected the discard park");
    expect(parked.state.phase.answerer).toBe("p2");
    const rest = parked.state.phase.cont.rest;
    expect(rest).toEqual([
      {
        op: "conditionGate",
        cond: SALANDIT,
        ops: [{ op: "opponentDiscardsFromHand", count: 2 }],
      },
    ]);
  });

  it("the whole parked state ROUND-TRIPS through JSON and resolves identically", () => {
    // The bytes, not the shape: serialize the parked state, parse it back, answer the
    // park on the REVIVED state, and require the same board. A version bump would be owed
    // if this could not be done with a v29 reader's types.
    const state = ready({ from: "d486-salandit", to: "d486-salazzle" });
    const parked = mustApply(state, { type: "attack", seat: "p1", index: GATED_DISCARD }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the discard park");
    const revived = roundTrip(parked);
    expect(revived).toEqual(parked);
    const answer = (from: GameState): GameState => {
      let now = from;
      while (now.phase.kind === "effect:choose") {
        const phase = now.phase;
        if (phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
        now = must(
          applyAction(now, {
            type: "resolveEffect",
            seat: phase.answerer ?? phase.seat,
            choice: { kind: "cards", uids: phase.prompt.candidates.slice(0, phase.prompt.min) },
          }),
        );
      }
      return now;
    };
    expect(answer(revived)).toEqual(answer(parked));
    // THREE cards in the discard pile, and the hand is 5 − 3 + 1: the attack ended the
    // turn, so the answering seat has drawn by the time the board settles. The discard
    // pile is what this program moved; the hand is what the turn did.
    expect(answer(parked).players.p2.discard).toHaveLength(3);
    expect(answer(parked).players.p2.hand).toHaveLength(3);
  });
});

describe("§9 — every describer this program reaches, asked on the load-bearing board", () => {
  it("`conditionNote` renders the printed clause with its pronoun resolved", () => {
    expect(conditionNote(SALANDIT)).toBe(
      "your Active Pokémon evolved from Salandit during this turn",
    );
    expect(conditionNote(SALANDIT).replace("your Active Pokémon", "this Pokémon")).toBe(CLAUSE);
  });

  it("the gate itself files NO event, and the discards file one row EACH", () => {
    const state = ready({ from: "d486-salandit", to: "d486-salazzle" });
    const after = drive(state, PROGRAM);
    expect(types(after.events)).toEqual(["FORCED_HAND_DISCARD", "FORCED_HAND_DISCARD"]);
    // …and on the gate-FALSE board there is exactly ONE.
    const cold = ready({ from: null, to: "d486-salazzle" });
    expect(types(drive(cold, PROGRAM).events)).toEqual(["FORCED_HAND_DISCARD"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — THE VERSION PINS
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 — the version, and what it is owed for", () => {
  it("engineVersion is 0.555.0 and the bump is owed for BEHAVIOUR", () => {
    expect(manifest.version).toBe(engineVersion);
  });
});
