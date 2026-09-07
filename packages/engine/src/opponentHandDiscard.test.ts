import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, engineVersion } from "./index";
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
} from "./testFixtures";

// 0.327.0 → 0.328.0 — 🆕🆕 D426, THE OPPONENT-CHOOSES HAND DISCARD.
//
// *"Your opponent discards 2 cards from their hand."* (**4 legal printings**) and
// *"Your opponent discards a card from their hand."* (**2**) — 2 sentences / **6
// legal printings**, measured over `legalAttackCorpus()`: the committed
// `legal_standard = 1` attack column, 640 sentences / 1,732 printings. §1 pins
// both figures on the POPULATION rather than on a specimen (D423).
//
// 🛑 **THE HEART OF THIS SLICE IS THE REDACTION, AND EVERY OTHER SECTION IS
// SUPPORT FOR IT.** This is the first park in the engine whose ANSWERER is not
// the controller AND whose candidates are HIDDEN CARD IDENTITIES.
//
// ⚠️ **IT IS THE THIRD `decider` PRODUCER, NOT THE SECOND, AND THE WRONG ORDINAL
// WAS INHERITED FROM TWO STALE DOC LINES RATHER THAN INVENTED** (D422: a stale
// claim is read as a measurement). `RunResult.decider`'s own doc said
// *"opponentMayDraw is the ONE producer"* and the `opponentMayDraw` case comment
// said *"the ONE park whose ANSWERER is the other seat"* — both false since
// **D227**, both corrected in this slice. Enumerated by reading `parkOrForce`'s
// call sites rather than by counting:
//   · `opponentMayDraw` (Ortega, M5) — a `mayDraw` prompt: a count and a caption,
//     NO CANDIDATES AT ALL;
//   · `opponentSwitchOut` (D227) — a `choosePokemon` prompt over the answerer's own
//     Bench, whose candidates are `PokemonRef`s ALREADY PUBLIC on the redacted board;
//   · this op — a `chooseCards` prompt over uids out of the answerer's HIDDEN HAND.
// So the ordinal was wrong and the substantive claim was not: neither predecessor
// puts a hidden identity behind the gate. The two shipped mechanisms cross here
// for the first time:
//
//   · the `decider` → `phase.answerer` route (interpreter.ts → flow.ts
//     `settleProgram` → `cardplay.ts`'s `resolveEffect` gate, `phaseView.ts`'s
//     `waitingSeat`, `redact.ts`'s `redactedPromptOf`);
//   · the hidden-candidate `chooseCards` resolution (`redactPrompt`), which turns
//     each candidate uid into a full `RedactedCard`.
//
// If the second ran without the first, the ATTACKER's own wire snapshot would
// carry a face-up list of the DEFENDER's hand — and, worse, the attacker could
// answer it. §4 drives BOTH halves from BOTH chairs and asserts the absence on
// the whole snapshot rather than on the prompt field alone.
//
// ⚠️ **THE CARRIER CARD IDS ARE UNRESOLVED AND ARE STATED AS SUCH RATHER THAN
// INVENTED (D425).** This checkout has no D1 — no local sqlite, no remote
// credentials — so the six printings behind these two sentences cannot be named.
// The SENTENCES and their PRINTING COUNTS are measurable off the committed corpus
// and are what §1 asserts. The fixture's two attack names ("Hand Purge", "Hand
// Pinch") are this repo's own words and carry no claim about any card.
//
// ⚠️ **THE PATTERN THIS FAMILY WAS ENUMERATED WITH, PUBLISHED SO ITS EDGES ARE
// VISIBLE (D424/D425).** The handoff's pattern was
// `/opponent discards|opponent chooses|discards? [0-9a-z]+ cards?/i`; this file
// re-ran the LOOSER `/their hand|opponent's hand/i` over all 640 sentences and
// read every one of the 30 hits — §1 asserts that sweep rather than describing
// it. What NEITHER pattern can see: a printing that names the discarding player
// by anything but the word *opponent*, or that spells the destination as *"puts
// … into the discard pile"*. Zero such rows exist in this column today; that is
// the edge, stated rather than assumed.
//
// SEED-FREE: this op consumes no RNG. The one seed below feeds `driveSetup`'s
// shuffle and nothing this file asserts depends on its value — every board
// rebuilds the hand under test outright.

/** The two printed sentences, byte for byte off `legalAttackCorpus()` (asserted
    in §1, so a re-ingest disagrees with a line of this file rather than with a
    number), with the program each derives to, its legal ATTACK-column printing
    count, and its index on the shared demonstrator. */
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

/** 🛑 THE THREE ROWS THE FAMILY SWEEP FINDS AND THIS SLICE DOES **NOT** TAKE,
    each with the reason it is a different slice. Measured after the arm landed
    (§1 re-runs the measurement live), because D424 gained a printing by asking
    exactly this question of the composition path and getting a yes.

    `[printed sentence, why it is left, legal printings]`. */
const DEFERRED: readonly (readonly [string, string, number])[] = [
  [
    "Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards.",
    "the TAIL is an evolution-history gate over a MORE-cards fold — `deriveAttackEffect` claims neither, so `splitAttackTrailingClause` refuses it however readable the head becomes",
    1,
  ],
  [
    "Discard a card from your hand. If you do, your opponent discards a card from their hand.",
    "an §9.2 *If you do* whose CONSEQUENT is this op — the tail clause is unread, and the head (a bare hand cost with no destination printed) is unread too",
    1,
  ],
  [
    "Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.",
    "this mechanism with a DIFFERENT DESTINATION (§15.E deck, plus a shuffle), and the op prints no `to` field — D231's unkillable-singleton rule is what kept it off",
    1,
  ],
];

// ── The board. `fix-trainerops` indices 61-62, appended by D426. ─────────────
const HAND_PURGE = 61; // the printed 2
const HAND_PINCH = 62; // the printed 1
const KNOCK_OFF = 26; // the RANDOM sibling — the who-chooses control

const SEED = 20260827;

/** Five DISTINCT ids. Distinctness is load-bearing twice over: the discarded
    uids are read back individually, and §4 asserts that NONE of them appears in
    the actor's snapshot — a hand of five copies of one card could not tell a leak
    of one from a leak of all five. */
const OPP_HAND = ["fix-item", "fix-tool", "fix-gatedsup", "fix-stadium", "fix-energy"] as const;

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

const other = (seat: Seat): Seat => (seat === "p1" ? "p2" : "p1");

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

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
function ready(
  hand: readonly string[] = OPP_HAND,
  attacker: Seat = "p1",
  seed = SEED,
): GameState {
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

/** The flattened text of the one action row a batch produced that mentions this
    family — the string a player actually reads. */
function familyRow(state: GameState, events: GameEvent[], needle: string): string {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  const row = logFromEvents(events, ctx).find(
    (r) => r.kind === "action" && r.segments.some((s) => s.text.includes(needle)),
  );
  if (row === undefined || row.kind !== "action") throw new Error(`no row mentioning ${needle}`);
  return row.segments.map((s) => s.text).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE CENSUS, PINNED ON THE POPULATION (D423)
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the census, measured over the corpus rather than quoted", () => {
  it("both sentences are IN the legal attack column, at 4 and 2 printings", () => {
    // The population, not a specimen: the corpus is queried for each sentence
    // and the printing count comes off the ROW, so a re-ingest that moves either
    // figure reddens here by name rather than leaving a prose count rotting.
    const corpus = legalAttackCorpus();
    for (const clause of CLAUSES) {
      const row = corpus.find(([, sentence]) => sentence === clause.text);
      expect(row, clause.text).toBeDefined();
      expect(row?.[0], clause.text).toBe(clause.legalPrintings);
    }
    // 4 + 2 = 6, as ARITHMETIC over the rows rather than as a written total, so a
    // re-census disagrees with a sentence rather than with a sum (D230's rule).
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(6);
    expect(CLAUSES.map((c) => c.legalPrintings)).toEqual([4, 2]);
  });

  it("🛑 the WHOLE opponent-side hand-discard family is these two plus THREE, and no more", () => {
    // ⚠️ THE PUBLISHED PATTERN, RE-RUN LOOSER THAN THE HANDOFF'S (D424/D425).
    // The brief enumerated with `/opponent discards|opponent chooses|discards?
    // [0-9a-z]+ cards?/i`. This sweeps `/their hand|opponent's hand/i` — every
    // sentence in the column that mentions either seat's hand at all, 30 rows —
    // and then narrows to the ones that MOVE a card out of the OPPONENT's hand to
    // a pile or a deck. That is a strictly wider net than the brief's, and it
    // returns the same five rows, which is the check.
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
      [...CLAUSES.map((c) => c.text), ...DEFERRED.map(([s]) => s)].sort(),
    );
    // ⚠️ THE EDGE, STATED: no printing in this column spells the destination as
    // "into the discard pile", and none names the discarder by anything but the
    // word "opponent". Both are asserted as ZERO on the population so the day one
    // is printed this file goes red instead of silently under-counting.
    expect(corpus.filter(([, s]) => /into (?:the|their) discard pile/i.test(s))).toEqual([]);
  });

  it("this slice takes 2 of the 5, and the other 3 are still refused WHOLE", () => {
    // D190b's exact-map-or-flag rule: every deferred row lands on the loud
    // ATTACK_EFFECT_SKIPPED path rather than deriving half of what it prints.
    for (const [sentence] of DEFERRED) expect(deriveAttackEffect(sentence)).toBeNull();
    // …and the three sum to 3 printings, so the family is 6 + 3 = 9 and this
    // slice's share is named rather than implied.
    expect(DEFERRED.reduce((sum, [, , n]) => sum + n, 0)).toBe(3);
    expect(DEFERRED.reduce((sum, [, , n]) => sum + n, 0) + 6).toBe(9);
  });

  it("🛑 NEITHER COMPOUND COMPOSES FOR FREE — measured AFTER the arm landed", () => {
    // D424 gained a printing exactly this way: an arm landed, and a compound
    // whose OTHER half was already read became admissible with no splitter
    // change at all. So the question is asked here rather than assumed, and the
    // answer this time is NO — `COMPOUND_ATTACK_UNITS` does not move.
    //
    // 🛑 THE REASON IS THE SPLITTER'S SECOND CONDITION, NOT ITS FIRST.
    // `splitAttackTrailingClause` requires the TAIL to be claimed by
    // `deriveAttackEffect` and the HEAD by SOME reader. This slice made a HEAD
    // readable (the Salandit compound opens with the bare printed sentence) and
    // a head is the half the splitter gives to the readers that were already
    // reading — it buys nothing on its own.
    const SALANDIT = DEFERRED[0]?.[0] as string;
    const IF_YOU_DO = DEFERRED[1]?.[0] as string;
    // The HEAD of the Salandit compound is now claimed — this is the thing the
    // slice actually changed, and it is asserted so the "no gain" verdict below
    // cannot be confused with "nothing moved at all".
    expect(deriveAttackEffect("Your opponent discards a card from their hand.")).not.toBeNull();
    // …and the TAILS are not, which is why neither compound composes.
    expect(
      deriveAttackEffect(
        "If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect("If you do, your opponent discards a card from their hand."),
    ).toBeNull();
    // Driven through the splitters themselves rather than inferred from their
    // conditions, and through BOTH of the two that serve unresolved sentences
    // (D425: the requirement and cancel splitters serve zero).
    for (const sentence of [SALANDIT, IF_YOU_DO]) {
      expect(splitAttackTrailingClause(sentence)).toBeNull();
      expect(splitAttackGateClause(sentence)).toBeNull();
      expect(resolvedByAnyReader(sentence)).toBe(false);
    }
  });

  it("⚠️ NO APOSTROPHE ON EITHER SENTENCE, so the BEARING census stands still", () => {
    // Both printings say *their hand* and never *your opponent's hand* — the
    // possessive this family's other anchors all carry — so there is no `['’]`
    // slot for a re-ingest to curl. `clauseApostrophe.test.ts`'s sweep moves on
    // FIXTURE additions as well as reader ones (D425), and this slice adds two
    // fixture sentences: the prediction that it does NOT move is asserted here
    // rather than left as prose.
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
    // D183's rule: an arm written from a paraphrase passes a test written against
    // the same paraphrase and matches no real card. The strings above are asserted
    // to be the demonstrator's printed bytes, at the indices §3-§7 attack.
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    for (const clause of CLAUSES) {
      expect(attacks[clause.index]?.effect).toBe(clause.text);
      expect(deriveAttackEffect(attacks[clause.index]?.effect ?? "")).toEqual(clause.ops);
      // NO printed base damage on either — the fixture's declared divergence,
      // asserted rather than described. Both sentences PARK, so a base-damage
      // Knock Out would put a promotion prompt in front of the very
      // `effect:choose` phase every case below reads.
      expect(attacks[clause.index]?.damage).toBeUndefined();
    }
  });

  it("🛑 THE ABSENT GROUP IS THE ARTICLE, and the singular is 1 rather than a default", () => {
    // `ATTACK_DRAW`'s reading. The two printed spellings are BOTH in the pool (4
    // and 2 printings), which is what makes this a template over a population of
    // two rather than a parameter warranted by one witness (D121).
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
    // ⚠️ AND THE CONTROL, WITHOUT WHICH THE RUNG IS A TAUTOLOGY: the reader still
    // says YES on the same axis one number up. A build that refused every numeric
    // spelling would pass the line above and fail this one.
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

  it("🛑 THE WHO-CHOOSES CONTROL: the RANDOM sibling still routes to its own op", () => {
    // The discriminator no census can see, and the reason the pair sits on ONE
    // body. Index 26 and index 62 are the same seat's hand, the same destination
    // and the same count of one; the only difference in the world is whether
    // anybody chooses. A build that routed either sentence to the other's op
    // moves the same card to the same pile and is wrong about the whole
    // mechanism — and every "the hand shrank" assertion in this repo would pass.
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
  it("🛑 files the park under the CONTROLLER and the answer under the OWNER", () => {
    const { state: parked, events } = attack(deepFreeze(ready()), HAND_PURGE);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the park");
    expect(parked.phase.seat).toBe("p1"); // the controller — the program's owner
    expect(parked.phase.answerer).toBe("p2"); // …but the hand's owner answers
    // The announcement rides the same seat, off `result.decider` rather than off
    // the controller (flow.ts).
    expect(find(events, "EFFECT_PENDING")?.seat).toBe("p2");
    expect(find(events, "EFFECT_PENDING")?.note).toBe("Discard 2 cards from your hand.");
  });

  it("🛑 the caption is in the ANSWERER's VOICE, not the printed sentence", () => {
    // The one place this family's round-trip rule is broken, and it is broken on
    // purpose: the card says *"YOUR OPPONENT discards 2 cards from their hand"*
    // and the player reading this dialog IS that opponent. A verbatim caption
    // would tell them to make someone else discard. `mayDrawNote` settled this at
    // the engine's only other opponent-answered park; this is that rule's second
    // use, and BOTH counts are read because a singular written as "1 card" would
    // pass a probe on the plural alone.
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
    // ⚠️ THE CANDIDATE COUNT IS THE THING THAT MAKES §4 MEAN ANYTHING (D416): a
    // board offering exactly `min` candidates auto-resolves and never parks, so a
    // suite whose boards all field the minimum tests the FORCED arm exclusively.
    // Five candidates for a pick of two is a real decision.
    expect(prompt.candidates.length).toBeGreaterThan(prompt.min);
  });

  it("🛑 the CONTROLLER's answer is REFUSED, and the OWNER's is accepted", () => {
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

  it("🛑 the TURN does not move — `activeSeat` stays the attacker for both viewers", () => {
    // `phaseViewOf`'s third way the deciding seat and the turn owner come apart,
    // and this park is the FIRST to reach it with `resumeTail` also set (an
    // attack's effect program parks with the epilogue queued). A board that
    // handed the answering seat the turn glow would be lying about whose turn it
    // is; a board that read the ACTIVE seat as the answerer would put the dialog
    // on the wrong screen.
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

// ─────────────────────────────────────────────────────────────────────────────
// §4 — 🛑 THE REDACTION. The actor never sees the opponent's card identities.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the hidden hand stays hidden, before / during / after the park", () => {
  /** Every uid in `hand`, in the JSON-quoted form the wire actually carries.
      Quoted because uids are `p2#4`-shaped and `p2#4` is a PREFIX of `p2#42` —
      a bare substring probe would report a leak that is not one, or miss one
      that is. */
  const quoted = (uids: readonly string[]) => uids.map((u) => `"${u}"`);

  it("🛑 the ACTOR's wire snapshot carries NO prompt and NONE of the uids", () => {
    // THE SAFETY PROPERTY OF THE WHOLE SLICE, and it is asserted on the SNAPSHOT
    // rather than on the prompt field: `redactedPromptOf` returning null proves
    // the gate ran, and nothing else. What matters is that no candidate uid
    // crosses the wire to the actor by ANY route.
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

  it("🛑 …and the OWNER's snapshot carries the prompt WITH full identities", () => {
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

  it("🛑 a SPECTATOR gets nothing from either chair", () => {
    // `redactPhase` nulls the prompt for a spectator before the answerer gate is
    // even consulted, and this park is the first where that matters on BOTH
    // sides: the answerer's own spectating projection must not open the hand
    // either, or a stream would show it.
    const state = ready();
    const oppHand = [...state.players.p2.hand];
    const { state: parked } = attack(state, HAND_PURGE);
    for (const viewer of ["p1", "p2"] as const) {
      const view = redactGame(parked, viewer, true);
      if (view.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
      expect(view.phase.prompt, viewer).toBeNull();
      const wire = JSON.stringify(view);
      for (const needle of quoted(oppHand)) expect(wire, `${viewer}/${needle}`).not.toContain(needle);
    }
  });

  it("BEFORE the attack the actor cannot see the hand either — the attribution control", () => {
    // ⚠️ D214's rule: a check whose subject is a shared artifact needs an
    // attribution control. `redactedSideOf` hides the opponent's hand
    // UNCONDITIONALLY, so "no uid in the actor's snapshot" is true on the board
    // BEFORE this op runs too — the case above would be green against a build
    // that never opened the hand and never closed it. What this pins is that the
    // baseline is the same, so the interesting claim is §4's LAST case: what
    // changes after the answer.
    const state = ready();
    const oppHand = [...state.players.p2.hand];
    const wire = JSON.stringify(redactGame(state, "p1"));
    for (const needle of quoted(oppHand)) expect(wire).not.toContain(needle);
  });

  it("🛑 AFTER the answer, exactly the DISCARDED cards become public — and no others", () => {
    // The §2 public pile is the channel, and it is the ONLY thing that changes.
    // This is the case that could not pass against a redactor that leaks (the
    // rest of the hand would show) NOR against one that hides everything (the
    // discarded pair would not).
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

  it("🛑 the LOG says HOW MANY and never WHICH, from both seats", () => {
    // `HAND_COST_PAID`'s convention — the row is about the zone the cards came
    // FROM. The identities become public by the BOARD (the case above), so a log
    // row naming them would be the second channel and the wrong one: it would
    // survive a shuffle-back the pile would not.
    // ⚠️ FILED UNDER THE DISCARDER. Every other cross-seat card move in `log.ts`
    // files under the ACTOR, because the actor chose and moved. Here the actor
    // chose NOTHING, so the active voice belongs to the owner — and the event
    // carries no `actor` for a consumer to derive one from (D425's
    // `DAMAGE_DEALT` defect, refused by construction).
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
    // The row's `who` chip is the OWNER, not the attacker.
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
    expect(find(events, "FORCED_HAND_DISCARD")).toEqual({
      type: "FORCED_HAND_DISCARD",
      seat: "p2",
      uids: picked,
    });
    // The pile: appended in pile order, on the OWNER's side.
    expect(done.players.p2.discard).toEqual(picked);
    // 🛑 THE ACTOR'S OWN ZONES DID NOT MOVE — a build that discarded to `ctx.seat`
    // would empty the attacker's pile-side instead, and every count assertion
    // above would still pass.
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
    // A build that took `hand.slice(0, 2)` and ignored the answer passes every
    // count assertion in this repo. Two interior positions, read back by uid.
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
    // `ctx.seat` is the CONTROLLER at the apply — `resolveEffect` hands
    // `phase.seat` to `settleProgram`, never the answerer — so the owner is
    // re-derived exactly as the park derived it. Driven bare through
    // `runProgram`/the phase rather than through an attack, from BOTH chairs, so
    // a build that read the seat off the answer instead is caught on the seat
    // where the two happen to differ.
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
      expect(find(events, "FORCED_HAND_DISCARD")?.seat, attacker).toBe(victim);
      expect(done.players[victim].discard, attacker).toEqual(picked);
      expect(done.players[attacker].discard, attacker).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE SHORT BOARDS. §8.6 — do as much as you can.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — fewer than N, exactly N, and the empty hand", () => {
  it("🛑 EXACTLY N is FORCED — the M1 no-choice rule, no park, both seats", () => {
    // At `M === count` the printed count is met and there is exactly ONE answer
    // to "which 2 of your 2", so nothing is asked. Driven from both chairs
    // because the forced arm is the one place `otherSeat(ctx.seat)` is spelled
    // twice in this op and a crossed copy would empty the ATTACKER's hand.
    for (const attacker of ["p1", "p2"] as const) {
      const victim = other(attacker);
      const state = ready(["fix-item", "fix-tool"], attacker);
      const hand = [...state.players[victim].hand];
      const attackerHand = [...state.players[attacker].hand];
      const { state: done, events } = attack(state, HAND_PURGE, attacker);
      expect(done.phase.kind, attacker).not.toBe("effect:choose");
      expect(find(events, "FORCED_HAND_DISCARD"), attacker).toEqual({
        type: "FORCED_HAND_DISCARD",
        seat: victim,
        uids: hand,
      });
      expect(done.players[victim].discard, attacker).toEqual(hand);
      expect(done.players[attacker].hand, attacker).toEqual(attackerHand);
      expect(done.players[attacker].discard, attacker).toEqual([]);
    }
  });

  it("🛑 FEWER than N is the SAME BRANCH and a DIFFERENT DECISION — the whole hand goes", () => {
    // ⚠️ TWO DECISIONS SHARING ONE LINE, and both are pinned because a decision
    // that is not pinned is indistinguishable from an oversight (D421). At
    // `M === count` the player has no choice; at `M < count` the player has no
    // choice AND the printed count CANNOT be met. §8.6 answers both — do as much
    // as you can — so the hand of one gives up its one card under a printed 2,
    // and the attack does not fail, park, or report a skip.
    const state = ready(["fix-stadium"]);
    const held = state.players.p2.hand[0] as string;
    const { state: done, events } = attack(deepFreeze(state), HAND_PURGE);
    expect(find(events, "FORCED_HAND_DISCARD")?.uids).toEqual([held]);
    expect(done.players.p2.discard).toEqual([held]);
    expect(done.phase.kind).not.toBe("effect:choose");
    // ⚠️ NOT a failure and NOT a skip: the printed 2 could not be met and the
    // card still did what it could.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("ATTACK_FAILED");
    // …and the count in the LOG is the count that MOVED, not the printed one.
    expect(familyRow(done, events, "from their hand")).toBe("discarded 1 card from their hand");
  });

  it("🛑 an EMPTY hand is a SILENT NO-OP — no event, no park, no state change", () => {
    // ⚠️ THE DECISION, WRITTEN DOWN AND DRIVEN: there is nothing to discard, so
    // nothing is announced (the ATTACK_DECLARED row above already said the attack
    // happened) and nothing is asked (there is no decision here for the M1 rule
    // to retire). This is `randomFromOpponentHand`'s empty-hand ending and
    // `payFromHandApply`'s `paid.length === 0` guard, arriving at one op from two
    // directions. A row announcing a discard of zero cards would describe
    // something that did not happen.
    for (const count of [1, 2]) {
      const state = ready([]);
      const events: GameEvent[] = [];
      const result = runProgram(
        deepFreeze(state),
        [{ op: "opponentDiscardsFromHand", count }],
        { seat: "p1" },
        events,
      );
      if (result.kind !== "done") throw new Error("an empty hand must not park");
      expect(events, `count ${count}`).toEqual([]);
      // The IDENTITY, not merely "the hand is still empty" — a build that
      // rebuilt the side object would pass a zone-by-zone comparison.
      expect(result.state, `count ${count}`).toBe(state);
    }
    // …and through a real attack, both printings: the turn simply ends.
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

  it("🛑 the park's FLOOR is true by construction — `min` is never unanswerable", () => {
    // Every board that could make `min: count` unanswerable was already swallowed
    // by the forced arm, so this op needs no `lookAtTopN`-style clamp. Asserted
    // over every parking hand size rather than argued: the offer is always at
    // least the floor, and the floor is always the PRINTED count.
    for (const n of [3, 4, 5]) {
      const prompt = parkedPrompt(attack(ready(OPP_HAND.slice(0, n)), HAND_PURGE).state);
      expect(prompt.min, `${n}`).toBe(2);
      expect(prompt.max, `${n}`).toBe(2);
      expect(prompt.candidates.length, `${n}`).toBe(n);
      expect(prompt.candidates.length, `${n}`).toBeGreaterThanOrEqual(prompt.min);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — BOTH PRINTINGS, BOTH SEATS, AND THE READ SITES THIS SLICE DOES NOT OWE
// ─────────────────────────────────────────────────────────────────────────────

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
    // The family's standing answer rather than an omission: that gate exists so a
    // CARD PLAY is not spent on a program that can only whiff, attacks never
    // consult it (§8 — the attack is already declared and paid for), and this op
    // has no registry row. `randomFromOpponentHand` has no line there either.
    // The condition that would reverse it: a Trainer or Ability printing this
    // sentence — zero exist in the `effect`/ability columns today.
    const empty = ready([]);
    for (const count of [1, 2]) {
      expect(programPlayable(empty, [{ op: "opponentDiscardsFromHand", count }], "p1")).toBe(true);
    }
    // ⚠️ AND THE CONTROL ON THE SAME BOARD, without which "true" could mean the
    // gate answers true for everything: the op that DOES carry an opponent-hand
    // gate refuses this very board.
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
    // …and the RESUMED half, which writes through `applyChoice` rather than
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

  it("🛑 `MATCH_RECORD_VERSION` STAYS 26 — DRIVEN BOTH DIRECTIONS, not reasoned", () => {
    // ⚠️ `MATCH_RECORD_VERSION` IS NOT EXPORTED FROM THIS PACKAGE (it lives in
    // `apps/api/src/lobby/match.ts`), so the claim is DRIVEN the way D421-D425
    // drove theirs. The bump trigger at this address is a PERSISTED structure
    // gaining or RENAMING a required field.
    //
    // 🛑 **AND THE UNION RULE ALONE WOULD NOT HAVE SETTLED IT, WHICH IS WHY THIS
    // CASE EXISTS.** Unlike D425's `spreadDamage`, THIS OP PARKS — so it reaches
    // `EffectContinuation.pendingOp`, which IS persisted inside
    // `MatchRecord.state.phase`. What makes the answer still 26 is that the op is
    // a NEW INHABITANT of the `EffectOp` union (D125's widening): a v26 record
    // cannot CONTAIN `{op:"opponentDiscardsFromHand"}` because no deploy that
    // wrote one could author it, and every inhabitant a v26 record does contain
    // still means what it meant. `decider` is not a new field either — it has been
    // an OPTIONAL member of `RunResult`/`Phase.answerer` with a shipped producer
    // (Ortega) since M5, and this slice adds a second producer to it.
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

  it("the engine version moved and the two spellings agree", () => {
    expect(engineVersion).toBe("0.379.0");
  });
});
