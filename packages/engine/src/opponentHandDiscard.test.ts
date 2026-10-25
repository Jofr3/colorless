import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { phaseViewOf } from "./phaseView";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  OPPONENT_HAND_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
} from "./testFixtures";

const CLAUSES = [
  {
    text: "Your opponent discards 2 cards from their hand.",
    ops: [{ op: "opponentDiscardsFromHand", count: 2 }],
    legalPrintings: 4,
    index: 61,
  },
  {
    text: "Your opponent discards a card from their hand.",
    ops: [{ op: "opponentDiscardsFromHand", count: 1 }],
    legalPrintings: 2,
    index: 62,
  },
] as const satisfies readonly {
  text: string;
  ops: readonly EffectOp[];
  legalPrintings: number;
  index: number;
}[];

const DEFERRED: readonly (readonly [string, string, number])[] = [];

const BUILT_ELSEWHERE: readonly (readonly [string, string, number])[] = [
  [
    "Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.",
    'D542 — this mechanism with a DIFFERENT DESTINATION (§15.E deck, plus a shuffle): the op\'s `to?: "deck"` plus a trailing `shuffleDeck { whose: "opponent" }`, as a COMPOSITION of two shipped ops. The reason it sat in `DEFERRED` — *the op prints no `to` field, and D231\'s unkillable-singleton rule is what kept it off* — was true in every clause and EXPIRED rather than rotted: this printing is the second reachable value. Driven in `opponentHandShuffle.test.ts`',
    1,
  ],
  [
    "Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards.",
    'D486 — the gated increment: this file\'s own head op, then a `conditionGate` on `yourActiveEvolvedFromThisTurn { name: "Salandit" }` over a second `opponentDiscardsFromHand`. ZERO new mechanism; driven in `evolvedDiscardCompound.test.ts`',
    1,
  ],
  [
    "Discard a card from your hand. If you do, your opponent discards a card from their hand.",
    "D515 — D473's printed `Discard a card from your hand. If you do, …` family, third member: `payFromHand` then a §9.2 `recordGate` over this file's own head op. The blocker was never the anchor (D473 measured that) but `describeBranch`, which had no phrase for the op and so degraded the park's caption to the bare cost; driven in `handCostOpponentDiscard.test.ts`",
    1,
  ],
];

const HAND_PURGE = 61; // the printed 2
const HAND_PINCH = 62; // the printed 1
const KNOCK_OFF = 26; // the RANDOM sibling — the who-chooses control

const SEED = 20260827;

const OPP_HAND = ["fix-item", "fix-tool", "fix-gatedsup", "fix-stadium", "fix-energy"] as const;

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

const other = (seat: Seat): Seat => (seat === "p1" ? "p2" : "p1");

function board(attacker: Seat, seed: number): GameState {
  const opponent = other(attacker);
  const state = driveSetup(
    seed,
    { p1: OPPONENT_HAND_DECK, p2: OPPONENT_HAND_DECK },
    { first: opponent },
  );
  return mustApply(state, { type: "endTurn", seat: opponent }).state;
}

/** Rebuild `seat`'s HAND outright (`opponentHandFamily.test.ts`'s `withHand`,
    needed here for the same reason — the opponent's hand IS the zone under
    test, and the boards below have to field it at an exact size). */
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

/** `attacker` fields `fix-trainerops` with one {C} attached and an empty Bench;
    the other seat fields a body of its own and holds exactly `hand`. */
function ready(hand: readonly string[] = OPP_HAND, attacker: Seat = "p1", seed = SEED): GameState {
  const opponent = other(attacker);
  let state = setActiveFromDeck(board(attacker, seed), attacker, "fix-trainerops");
  state = attachFromDeck(state, attacker, "fix-energy", 1);
  state = clearBench(state, attacker);
  state = setActiveFromDeck(state, opponent, "fix-basic-1");
  return withHand(state, opponent, hand);
}

const attack = (state: GameState, index: number, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index });

/** The parked prompt, narrowed. Throws rather than returning null so a board
    that FORCED instead of parking names itself at the call site. */
function parkedPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected the discard park");
  const prompt = state.phase.prompt;
  if (prompt.kind !== "chooseCards") throw new Error("expected a chooseCards prompt");
  return prompt;
}

function familyRow(state: GameState, events: GameEvent[], needle: string): string {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  const row = logFromEvents(events, ctx).find(
    (r) => r.kind === "action" && r.segments.some((s) => s.text.includes(needle)),
  );
  if (row === undefined || row.kind !== "action") throw new Error(`no row mentioning ${needle}`);
  return row.segments.map((s) => s.text).join("");
}

describe("§1 — the census, measured over the corpus rather than quoted", () => {
  it("both sentences are IN the legal attack column, at 4 and 2 printings", () => {
    const corpus = legalAttackCorpus();
    for (const clause of CLAUSES) {
      const row = corpus.find(([, sentence]) => sentence === clause.text);
      expect(row, clause.text).toBeDefined();
      expect(row?.[0], clause.text).toBe(clause.legalPrintings);
    }
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(6);
    expect(CLAUSES.map((c) => c.legalPrintings)).toEqual([4, 2]);
  });

  it("the WHOLE opponent-side hand-discard family is these two plus THREE, and no more", () => {
    const corpus = legalAttackCorpus();
    const mentionsAHand = corpus.filter(([, s]) => /their hand|opponent's hand/i.test(s));
    // The sweep is WIDE — if this shrank to five the narrowing below would be
    // asserting nothing.
    expect(mentionsAHand.length).toBeGreaterThan(20);
    const family = mentionsAHand
      .filter(([, s]) => /^Your opponent (?:discards|chooses)|your opponent discards/.test(s))
      .map(([, s]) => s)
      .sort();
    expect(family).toEqual(
      [
        ...CLAUSES.map((c) => c.text),
        ...DEFERRED.map(([s]) => s),
        ...BUILT_ELSEWHERE.map(([s]) => s),
      ].sort(),
    );
    // …and the three lists are DISJOINT, which is what makes the union above a partition
    // rather than a coincidence that happens to have the right length.
    expect(new Set(family).size).toBe(family.length);
    for (const [sentence] of BUILT_ELSEWHERE) {
      expect(deriveAttackEffect(sentence)).not.toBeNull();
    }
    expect(corpus.filter(([, s]) => /into (?:the|their) discard pile/i.test(s))).toEqual([]);
  });

  it("this slice takes 2 of the 5, and the other 3 are ALL built elsewhere now", () => {
    expect(DEFERRED).toHaveLength(0);
    for (const [sentence] of DEFERRED) expect(deriveAttackEffect(sentence)).toBeNull();
    for (const [sentence] of BUILT_ELSEWHERE) expect(deriveAttackEffect(sentence)).not.toBeNull();
    expect(DEFERRED.reduce((sum, [, , n]) => sum + n, 0)).toBe(0);
    expect(DEFERRED.reduce((sum, [, , n]) => sum + n, 0) + 9).toBe(9);
    expect(
      CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0) +
        BUILT_ELSEWHERE.reduce((sum, [, , n]) => sum + n, 0) +
        DEFERRED.reduce((sum, [, , n]) => sum + n, 0),
    ).toBe(9);
  });

  it("NEITHER COMPOUND COMPOSES FOR FREE — measured AFTER the arm landed", () => {
    const SALANDIT =
      "Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards.";
    const IF_YOU_DO = BUILT_ELSEWHERE[2]?.[0] as string;
    expect(deriveAttackEffect("Your opponent discards a card from their hand.")).not.toBeNull();
    expect(
      deriveAttackEffect(
        "If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect("If you do, your opponent discards a card from their hand."),
    ).toBeNull();
    const UNREAD =
      "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.";
    expect(legalAttackCorpus().some(([, s]) => s === UNREAD)).toBe(true);
    expect(resolvedByAnyReader(UNREAD)).toBe(false);
    expect(splitAttackTrailingClause(UNREAD)).toBeNull();
    expect(splitAttackGateClause(UNREAD)).toBeNull();
    // …and BOTH built compounds at the OTHER condition: RESOLVED, and therefore never
    // offered to a splitter at all.
    for (const built of [SALANDIT, IF_YOU_DO]) {
      expect(resolvedByAnyReader(built), built).toBe(true);
      expect(splitAttackTrailingClause(built), built).toBeNull();
      expect(splitAttackGateClause(built), built).toBeNull();
    }
  });

  it("NO APOSTROPHE ON EITHER SENTENCE, so the BEARING census stands still", () => {
    for (const clause of CLAUSES) {
      expect(clause.text).not.toContain("'");
      expect(clause.text).not.toContain("’");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE DERIVER: one template, two printed counts, and what it REFUSES
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — deriveAttackEffect over both printed counts", () => {
  for (const clause of CLAUSES) {
    it(`derives ${JSON.stringify(clause.text)}`, () => {
      expect(deriveAttackEffect(clause.text)).toEqual(clause.ops);
    });
  }

  it("reads the sentences OFF THE FIXTURE, not off this file's copies", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    for (const clause of CLAUSES) {
      expect(attacks[clause.index]?.effect).toBe(clause.text);
      expect(deriveAttackEffect(attacks[clause.index]?.effect ?? "")).toEqual(clause.ops);
      expect(attacks[clause.index]?.damage).toBeUndefined();
    }
  });

  it("THE ABSENT GROUP IS THE ARTICLE, and the singular is 1 rather than a default", () => {
    expect(deriveAttackEffect("Your opponent discards a card from their hand.")).toEqual([
      { op: "opponentDiscardsFromHand", count: 1 },
    ]);
    // …and the numeric branch at the ONE printed number, plus an unprinted one to
    // prove the capture is a capture and not a second literal.
    expect(deriveAttackEffect("Your opponent discards 2 cards from their hand.")).toEqual([
      { op: "opponentDiscardsFromHand", count: 2 },
    ]);
    expect(deriveAttackEffect("Your opponent discards 3 cards from their hand.")).toEqual([
      { op: "opponentDiscardsFromHand", count: 3 },
    ]);
  });

  it("REFUSES a printed count of ZERO — and ADMITS its neighbour (D424's control)", () => {
    // The refusal rung. `count >= 1` is the guard every numeric arm in this file
    // carries: a "discards 0 cards" sentence would derive to an attack that
    // reports a simulated effect and moves nothing.
    expect(deriveAttackEffect("Your opponent discards 0 cards from their hand.")).toBeNull();
    expect(deriveAttackEffect("Your opponent discards 1 cards from their hand.")).toEqual([
      { op: "opponentDiscardsFromHand", count: 1 },
    ]);
  });

  it("anchors WHOLE — a leading or a trailing clause is refused, both directions", () => {
    for (const clause of CLAUSES) {
      const lowered = `${clause.text[0]?.toLowerCase()}${clause.text.slice(1)}`;
      expect(deriveAttackEffect(`If heads, ${lowered}`)).toBeNull();
      expect(deriveAttackEffect(`${clause.text} Draw a card.`)).toBeNull();
    }
  });

  it("THE WHO-CHOOSES CONTROL: the RANDOM sibling still routes to its own op", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    expect(attacks[KNOCK_OFF]?.effect).toBe("Discard a random card from your opponent's hand.");
    expect(deriveAttackEffect(attacks[KNOCK_OFF]?.effect ?? "")).toEqual([
      { op: "randomFromOpponentHand", to: "discard" },
    ]);
    expect(deriveAttackEffect(CLAUSES[1].text)).toEqual([
      { op: "opponentDiscardsFromHand", count: 1 },
    ]);
    // …driven, not merely derived: the random one NEVER parks and this one does,
    // on the identical board.
    const state = ready(OPP_HAND);
    expect(attack(state, KNOCK_OFF).state.phase.kind).toBe("turn:action");
    expect(attack(state, HAND_PINCH).state.phase.kind).toBe("effect:choose");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE PARK LANDS ON THE OPPONENT AS ANSWERER
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the answerer is the OPPONENT, not the actor", () => {
  it("files the park under the CONTROLLER and the answer under the OWNER", () => {
    const { state: parked, events } = attack(deepFreeze(ready()), HAND_PURGE);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the park");
    expect(parked.phase.seat).toBe("p1"); // the controller — the program's owner
    expect(parked.phase.answerer).toBe("p2"); // …but the hand's owner answers
    // The announcement rides the same seat, off `result.decider` rather than off
    // the controller (flow.ts).
    expect(findEvent(events, "EFFECT_PENDING")?.seat).toBe("p2");
    expect(findEvent(events, "EFFECT_PENDING")?.note).toBe("Discard 2 cards from your hand.");
  });

  it("the caption is in the ANSWERER's VOICE, not the printed sentence", () => {
    expect(parkedPrompt(attack(ready(), HAND_PURGE).state).note).toBe(
      "Discard 2 cards from your hand.",
    );
    expect(parkedPrompt(attack(ready(), HAND_PINCH).state).note).toBe(
      "Discard a card from your hand.",
    );
    // …and neither caption is the printed sentence, which is the whole claim.
    for (const clause of CLAUSES) {
      expect(parkedPrompt(attack(ready(), clause.index).state).note).not.toBe(clause.text);
    }
  });

  it("offers the WHOLE hand as an exact MANDATORY pick — no collapse, no decline", () => {
    const state = ready();
    const oppHand = [...state.players.p2.hand];
    const prompt = parkedPrompt(attack(state, HAND_PURGE).state);
    // Every card is on offer, in hand order — no interchangeable collapse, because
    // the answerer owns this hand and is looking at it.
    expect(prompt.candidates).toEqual(oppHand);
    expect(prompt.min).toBe(2);
    expect(prompt.max).toBe(2);
    expect(prompt.dest).toBe("discard");
    expect(prompt.candidates.length).toBeGreaterThan(prompt.min);
  });

  it("the CONTROLLER's answer is REFUSED, and the OWNER's is accepted", () => {
    // The `answerer` gate in `cardplay.ts`, driven from both chairs on one board.
    // The refusal alone would pass against a build that refused everyone.
    const state = ready();
    const { state: parked } = attack(state, HAND_PURGE);
    const uids = parkedPrompt(parked).candidates.slice(0, 2);
    const bad = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [...uids] },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("WRONG_SEAT");
    // …and the CONTROL on the same park: the owner's identical answer lands.
    const good = applyAction(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: [...uids] },
    });
    expect(good.ok).toBe(true);
  });

  it("the TURN does not move — `activeSeat` stays the attacker for both viewers", () => {
    const { state: parked } = attack(ready(), HAND_PURGE);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the park");
    expect(parked.phase.resumeTail).toBe(true);
    for (const viewer of ["p1", "p2"] as const) {
      const view = phaseViewOf(parked, viewer);
      expect(view.activeSeat, viewer).toBe("p1");
      expect(view.waitingSeat, viewer).toBe("p2");
    }
    // …and the local projection WITHHOLDS the decision from the actor while
    // handing it to the owner — the hot-seat half of §4's wire claim.
    expect(phaseViewOf(parked, "p1").pendingDecision).toBeNull();
    expect(phaseViewOf(parked, "p2").pendingDecision?.kind).toBe("effectChoose");
  });
});

describe("§4 — the hidden hand stays hidden, before / during / after the park", () => {
  const quoted = (uids: readonly string[]) => uids.map((u) => `"${u}"`);

  it("the ACTOR's wire snapshot carries NO prompt and NONE of the uids", () => {
    const state = ready();
    const oppHand = [...state.players.p2.hand];
    const { state: parked } = attack(state, HAND_PURGE);
    const view = redactGame(parked, "p1");
    if (view.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(view.phase.prompt).toBeNull();
    const wire = JSON.stringify(view);
    for (const needle of quoted(oppHand)) expect(wire).not.toContain(needle);
    // …and the opponent's hand is still five face-down backs with POSITIONAL ids:
    // no engine uid, no catalog id, no name.
    expect(view.board.opponent.hand).toHaveLength(oppHand.length);
    for (const card of view.board.opponent.hand) {
      expect(card.id).toMatch(/^opponent-hand-\d+$/);
      expect(card.cardId).toBe("hidden");
    }
  });

  it("…and the OWNER's snapshot carries the prompt WITH full identities", () => {
    // The control, without which the case above passes against a redactor that
    // withheld the prompt from everybody — which is a soft-lock, not a fix.
    const state = ready();
    const oppHand = [...state.players.p2.hand];
    const { state: parked } = attack(state, HAND_PURGE);
    const view = redactGame(parked, "p2");
    if (view.phase.kind !== "effect:choose" || view.phase.prompt?.kind !== "chooseCards") {
      throw new Error("expected a chooseCards prompt");
    }
    // Keyed by the engine uid the answer dispatches back, in offer order…
    expect(view.phase.prompt.candidates.map((c) => c.id)).toEqual(oppHand);
    // …and resolved to real cards, not backs.
    for (const card of view.phase.prompt.candidates) {
      expect(card.cardId).not.toBe("hidden");
      expect(card.name).not.toBe("Card");
    }
    expect(view.phase.prompt.min).toBe(2);
    expect(view.phase.prompt.max).toBe(2);
    expect(view.phase.prompt.dest).toBe("discard");
  });

  it("a SPECTATOR gets nothing from either chair", () => {
    const state = ready();
    const oppHand = [...state.players.p2.hand];
    const { state: parked } = attack(state, HAND_PURGE);
    for (const viewer of ["p1", "p2"] as const) {
      const view = redactGame(parked, viewer, true);
      if (view.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
      expect(view.phase.prompt, viewer).toBeNull();
      const wire = JSON.stringify(view);
      for (const needle of quoted(oppHand))
        expect(wire, `${viewer}/${needle}`).not.toContain(needle);
    }
  });

  it("BEFORE the attack the actor cannot see the hand either — the attribution control", () => {
    const state = ready();
    const oppHand = [...state.players.p2.hand];
    const wire = JSON.stringify(redactGame(state, "p1"));
    for (const needle of quoted(oppHand)) expect(wire).not.toContain(needle);
  });

  it("AFTER the answer, exactly the DISCARDED cards become public — and no others", () => {
    const state = ready();
    const oppHand = [...state.players.p2.hand];
    const { state: parked } = attack(state, HAND_PURGE);
    const picked = [oppHand[1] as string, oppHand[3] as string];
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: picked },
    });
    const view = redactGame(done, "p1");
    // The two chosen cards are in the opponent's discard, by identity.
    expect(view.board.opponent.discard.map((c) => c.id)).toEqual(picked);
    for (const card of view.board.opponent.discard) expect(card.cardId).not.toBe("hidden");
    // The three that stayed are STILL invisible — asserted uid by uid.
    const wire = JSON.stringify(view);
    for (const uid of oppHand.filter((u) => !picked.includes(u))) {
      expect(wire, uid).not.toContain(`"${uid}"`);
    }
    for (const card of view.board.opponent.hand) expect(card.cardId).toBe("hidden");
  });

  it("the LOG says HOW MANY and never WHICH, from both seats", () => {
    const state = ready();
    const oppHand = [...state.players.p2.hand];
    const { state: parked } = attack(state, HAND_PURGE);
    const picked = [oppHand[0] as string, oppHand[2] as string];
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: picked },
    });
    const row = familyRow(done, events, "from their hand");
    expect(row).toBe("discarded 2 cards from their hand");
    for (const uid of oppHand) expect(row).not.toContain(uid);
    for (const id of OPP_HAND) expect(row).not.toContain(id);
    const ctx: LogContext = { names: NAMES, state: done, elapsed: formatElapsed(0) };
    const entry = logFromEvents(events, ctx).find(
      (r) => r.kind === "action" && r.segments.some((s) => s.text.includes("from their hand")),
    );
    expect(entry?.kind === "action" ? entry.who : null).toBe("p2");
    // …and the SINGULAR, which is a different string and would otherwise be
    // asserted by nothing.
    const one = attack(ready(["fix-item"]), HAND_PINCH);
    expect(familyRow(one.state, one.events, "from their hand")).toBe(
      "discarded 1 card from their hand",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE CARDS LEAVE THE RIGHT HAND FOR THE RIGHT PILE
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — which cards moved, out of whose hand, into whose pile", () => {
  it("moves exactly the CHOSEN cards, opponent hand → opponent discard", () => {
    const state = ready();
    const oppHand = [...state.players.p2.hand];
    const { state: parked } = attack(deepFreeze(state), HAND_PURGE);
    const picked = [oppHand[4] as string, oppHand[0] as string];
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: picked },
    });
    // The event names the OWNER and the cards, in the order they were answered.
    expect(findEvent(events, "FORCED_HAND_DISCARD")).toEqual({
      type: "FORCED_HAND_DISCARD",
      seat: "p2",
      uids: picked,
    });
    // The pile: appended in pile order, on the OWNER's side.
    expect(done.players.p2.discard).toEqual(picked);
    expect(done.players.p1.discard).toEqual(state.players.p1.discard);
    expect(done.players.p1.hand).toEqual(state.players.p1.hand);
    // Card conservation on the hand: `oppHand` minus the two, plus P2's own
    // turn-start draw (the attack ended P1's turn).
    expect(done.players.p2.hand.slice(0, oppHand.length - 2)).toEqual(
      oppHand.filter((u) => !picked.includes(u)),
    );
    // …and the turn actually finished rather than parking again.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("the picked cards leave by IDENTITY, not by position — a middle pick", () => {
    const state = ready();
    const oppHand = [...state.players.p2.hand];
    const { state: parked } = attack(state, HAND_PURGE);
    const picked = [oppHand[1] as string, oppHand[2] as string];
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: picked },
    });
    expect(done.players.p2.discard).toEqual(picked);
    expect(done.players.p2.hand).not.toContain(picked[0]);
    expect(done.players.p2.hand).not.toContain(picked[1]);
    expect(done.players.p2.hand.slice(0, 3)).toEqual([oppHand[0], oppHand[3], oppHand[4]]);
  });

  it("the interpreter's apply arm re-derives the OWNER from `ctx`, not from the answer", () => {
    for (const attacker of ["p1", "p2"] as const) {
      const victim = other(attacker);
      const state = ready(OPP_HAND, attacker);
      const hand = [...state.players[victim].hand];
      const { state: parked } = attack(state, HAND_PURGE, attacker);
      if (parked.phase.kind !== "effect:choose") throw new Error("expected the park");
      expect(parked.phase.cont.ctx.seat, attacker).toBe(attacker);
      const picked = [hand[0] as string, hand[1] as string];
      const { state: done, events } = mustApply(parked, {
        type: "resolveEffect",
        seat: victim,
        choice: { kind: "cards", uids: picked },
      });
      expect(findEvent(events, "FORCED_HAND_DISCARD")?.seat, attacker).toBe(victim);
      expect(done.players[victim].discard, attacker).toEqual(picked);
      expect(done.players[attacker].discard, attacker).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE SHORT BOARDS. §8.6 — do as much as you can.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — fewer than N, exactly N, and the empty hand", () => {
  it("EXACTLY N is FORCED — the M1 no-choice rule, no park, both seats", () => {
    for (const attacker of ["p1", "p2"] as const) {
      const victim = other(attacker);
      const state = ready(["fix-item", "fix-tool"], attacker);
      const hand = [...state.players[victim].hand];
      const attackerHand = [...state.players[attacker].hand];
      const { state: done, events } = attack(state, HAND_PURGE, attacker);
      expect(done.phase.kind, attacker).not.toBe("effect:choose");
      expect(findEvent(events, "FORCED_HAND_DISCARD"), attacker).toEqual({
        type: "FORCED_HAND_DISCARD",
        seat: victim,
        uids: hand,
      });
      expect(done.players[victim].discard, attacker).toEqual(hand);
      expect(done.players[attacker].hand, attacker).toEqual(attackerHand);
      expect(done.players[attacker].discard, attacker).toEqual([]);
    }
  });

  it("FEWER than N is the SAME BRANCH and a DIFFERENT DECISION — the whole hand goes", () => {
    const state = ready(["fix-stadium"]);
    const held = state.players.p2.hand[0] as string;
    const { state: done, events } = attack(deepFreeze(state), HAND_PURGE);
    expect(findEvent(events, "FORCED_HAND_DISCARD")?.uids).toEqual([held]);
    expect(done.players.p2.discard).toEqual([held]);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("ATTACK_FAILED");
    // …and the count in the LOG is the count that MOVED, not the printed one.
    expect(familyRow(done, events, "from their hand")).toBe("discarded 1 card from their hand");
  });

  it("an EMPTY hand is a SILENT NO-OP — no event, no park, no state change", () => {
    for (const count of [1, 2]) {
      const state = ready([]);
      const events: GameEvent[] = [];
      const result = runProgram(
        deepFreeze(state),
        [{ op: "opponentDiscardsFromHand", count }],
        { seat: "p1" },
        {},
        events,
      );
      if (result.kind !== "done") throw new Error("an empty hand must not park");
      expect(events, `count ${count}`).toEqual([]);
      // The IDENTITY, not merely "the hand is still empty" — a build that
      // rebuilt the side object would pass a zone-by-zone comparison.
      expect(result.state, `count ${count}`).toBe(state);
    }
    for (const index of [HAND_PURGE, HAND_PINCH]) {
      const { state: done, events } = attack(ready([]), index);
      expect(types(events)).not.toContain("FORCED_HAND_DISCARD");
      expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    }
  });

  it("MORE than N parks, at every hand size above the printed count", () => {
    // The other side of the boundary, swept rather than sampled: the forced arm
    // must swallow `M <= count` and nothing more. Read as a TABLE of hand size →
    // parked, so an off-by-one in either direction names its size.
    const sizes = [0, 1, 2, 3, 4, 5] as const;
    const parkedAt = sizes.map((n) => {
      const { state: done } = attack(ready(OPP_HAND.slice(0, n)), HAND_PURGE);
      return done.phase.kind === "effect:choose";
    });
    expect(parkedAt).toEqual([false, false, false, true, true, true]);
    // …and the printed ONE moves the boundary by exactly one, which is the whole
    // observable content of the `count` field on this path.
    const parkedAtOne = sizes.map((n) => {
      const { state: done } = attack(ready(OPP_HAND.slice(0, n)), HAND_PINCH);
      return done.phase.kind === "effect:choose";
    });
    expect(parkedAtOne).toEqual([false, false, true, true, true, true]);
  });

  it("the park's FLOOR is true by construction — `min` is never unanswerable", () => {
    for (const n of [3, 4, 5]) {
      const prompt = parkedPrompt(attack(ready(OPP_HAND.slice(0, n)), HAND_PURGE).state);
      expect(prompt.min, `${n}`).toBe(2);
      expect(prompt.max, `${n}`).toBe(2);
      expect(prompt.candidates.length, `${n}`).toBe(n);
      expect(prompt.candidates.length, `${n}`).toBeGreaterThanOrEqual(prompt.min);
    }
  });
});

describe("§7 — the sentences are CLAIMED, from either chair", () => {
  it("neither printing falls to ATTACK_EFFECT_SKIPPED, on either seat", () => {
    // The loud path is what an unread sentence takes, so its absence is what
    // "the arm claims this string" means as behaviour rather than as a
    // derivation. Both counts × both chairs × a parking and a forced board.
    for (const attacker of ["p1", "p2"] as const) {
      for (const index of [HAND_PURGE, HAND_PINCH]) {
        for (const hand of [OPP_HAND, ["fix-item"]]) {
          const { events } = attack(ready(hand, attacker), index, attacker);
          expect(types(events), `${attacker}/${index}`).not.toContain("ATTACK_EFFECT_SKIPPED");
          expect(types(events), `${attacker}/${index}`).toContain("ATTACK_DECLARED");
        }
      }
    }
  });

  it("`programPlayable` owes NO whiff gate — and the CONTROL says the gate still bites", () => {
    const empty = ready([]);
    for (const count of [1, 2]) {
      expect(programPlayable(empty, [{ op: "opponentDiscardsFromHand", count }], "p1")).toBe(true);
    }
    expect(programPlayable(empty, [{ op: "bottomFromOpponentHand" }], "p1")).toBe(false);
    // …and the attack is declarable into an empty hand regardless, which is the
    // other half of the point.
    expect(attack(empty, HAND_PURGE).state.phase.kind).toBe("turn:action");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — PURITY, THE PERSISTED QUESTION, AND THE VERSION
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the structural answers", () => {
  it("never mutates the board it is handed — the frozen pair, parked and forced", () => {
    // Both endings, because they are two different code paths through one op and
    // only the forced one writes state inside `stepOp`.
    for (const hand of [OPP_HAND, ["fix-item", "fix-tool"]]) {
      const frozen = deepFreeze(ready(hand));
      const snapshot = JSON.stringify(frozen);
      expect(attack(frozen, HAND_PURGE).state).not.toBe(frozen);
      expect(JSON.stringify(frozen), hand.length.toString()).toBe(snapshot);
    }
    // …and the RESUMED half, which writes through `answerOp` rather than
    // `stepOp` and is the path a frozen-state mutation would actually reach.
    const state = ready();
    const { state: parked } = attack(state, HAND_PURGE);
    const frozen = deepFreeze(parked);
    const snapshot = JSON.stringify(frozen);
    const picked = parkedPrompt(frozen).candidates.slice(0, 2);
    expect(() =>
      applyAction(frozen, {
        type: "resolveEffect",
        seat: "p2",
        choice: { kind: "cards", uids: [...picked] },
      }),
    ).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  it("`MATCH_RECORD_VERSION` STAYS 26 — DRIVEN BOTH DIRECTIONS, not reasoned", () => {
    const state = ready();
    const { state: parked } = attack(state, HAND_PURGE);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the park");

    // FORWARD: the serialized park is byte-identical to the live one.
    const roundTrip = JSON.parse(JSON.stringify(parked)) as GameState;
    if (roundTrip.phase.kind !== "effect:choose") throw new Error("lost the phase");
    expect(JSON.stringify(roundTrip.phase)).toBe(JSON.stringify(parked.phase));

    // THE ANCHOR: the exact keys the persisted op carries, listed LITERALLY, so
    // "every op grew a key" cannot hide inside a same-tree diff (aquaWash's rule).
    const pending = (roundTrip.phase.cont as { pendingOp?: unknown }).pendingOp as Record<
      string,
      unknown
    >;
    expect(Object.keys(pending).sort()).toEqual(["count", "op"]);
    expect(pending.op).toBe("opponentDiscardsFromHand");
    expect(pending.count).toBe(2);
    // …and the phase's own key set, because `answerer` is the OTHER thing this
    // park writes into the record. It is an OPTIONAL key that Ortega has been
    // writing since M5 — a shipped shape, not a new one.
    expect(Object.keys(roundTrip.phase).sort()).toEqual([
      "answerer",
      "cont",
      "kind",
      "prompt",
      "resumeTail",
      "seat",
    ]);

    // BACKWARD: the rehydrated record answers, and reaches the same board the
    // live one does — including the same events.
    const picked = parkedPrompt(parked).candidates.slice(0, 2);
    const answer: GameAction = {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: [...picked] },
    };
    const fromRecord = mustApply(roundTrip, answer);
    const live = mustApply(parked, answer);
    expect(fromRecord.events).toEqual(live.events);
    expect(fromRecord.state.players.p2.discard).toEqual(live.state.players.p2.discard);
    expect(fromRecord.state.players.p2.hand).toEqual(live.state.players.p2.hand);
    expect(fromRecord.state.phase).toEqual(live.state.phase);
  });
});
