import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { BoardCondition, EffectOp } from "./effects";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
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
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameState, Seat } from "./index";
import { conditionHolds, conditionNote, resumeProgram, runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  attachFromDeck,
  basicEnergy,
  battler,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  trainerCard,
  types,
} from "./testFixtures";

// 🆕🆕🆕 D486 — THE GATED INCREMENT ON THE OPPONENT'S HAND DISCARD.
//
//   file line 668 (1 printing)  "Your opponent discards a card from their hand. If this
//                                Pokémon evolved from Salandit during this turn, your
//                                opponent discards 2 more cards."
//
// 1 sentence / 1 legal printing over `legalAttackCorpus()`'s 640. The carrier id is
// UNRESOLVED and stated as such rather than invented — this checkout has no D1 (D425's
// standing limitation, and D393's rule that no card id is ever guessed).
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🛑 **BUILD STATE WAS SETTLED FIRST, WITH THE ORACLE THIS SURFACE ACTUALLY HAS**
// (D480/D482). For an ATTACK sentence `programFor` is not the oracle —
// `refusedPrintings.ts`'s limit 1 says so in writing and the table carries no `"attack"`
// surface at all. The oracle is the THIRTEEN readers off `attackReaderSurface()`, run
// programmatically against the printed string at this slice's parent commit: **13 / 13
// null**, all four splitters null, the row surviving every census subtraction. §2 re-runs
// that measurement against the shipped build, where exactly ONE reader claims it.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🛑 **D479's AUDIT PRICED THIS ROW AND THE PRICE WAS WRONG IN ITS REPAIR SITE.** D479
// wrote: *"`yourActiveEvolvedFromThisTurn` exists; the Salandit row is 'one consequent
// away' — this is a PRICE, not an expressibility refusal."* The EXPRESSIBILITY half is
// right and was re-verified by opening the declaration (effects.ts, the `BoardCondition`
// union). **The "one consequent away" half names the wrong file.** It is D393's own
// phrasing inherited forward, and it points at `deriveAttackBonusConsequent`, whose
// reading carries a REQUIRED `bonus: number` — this sentence prints no damage at all, so
// a consequent skeleton there would have been authoring a card rather than reading one.
// The row is spelled by `deriveAttackEffect` instead, through a COMPOSITION of ops that
// all shipped. **A refusal can name a true blocker and still be wrong about which file
// pays** — D479's own REASON-ONLY class, one field over. Both stale copies of the
// sentence (effects.ts's clause-table paragraph and this file's two predecessors) are
// corrected in place and dated rather than deleted (D178/D442/D466).
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🛑 **THE COMPOSITION QUESTION WAS DRIVEN BEFORE ANYTHING WAS PRICED (D482), AND THE
// ANSWER IS THAT NOTHING NEW WAS NEEDED.** Everything the sentence names already ships:
//   · `opponentDiscardsFromHand { count }` — D426's opponent-answered hand discard, and
//     the head sentence has derived to it since D426;
//   · `conditionGate { cond, then }` — the deterministic gate `deriveAttackEffect` arm
//     6c-bis already assembles, spliced by `runProgram` so an op inside a branch can
//     still park;
//   · `yourActiveEvolvedFromThisTurn { name }` — D393's `BoardCondition` member, whose
//     printed clause is read from a printed sentence today through the SHARED
//     `CONDITIONAL_DAMAGE_CLAUSES` table and `boardConditionForClause`.
// **So the price is ONE anchor, ONE `deriveAttackEffect` arm and ONE literal clause row:
// ZERO new op members, op fields, op values, `BoardCondition` members, readers (surface
// still 13), prompts, choice kinds, events, error codes, `GameState` fields, registry
// rows, `FIXTURE_POOL` ids (file-local `cardPool`, D414), `redact.ts` bytes,
// `interpreter.ts` bytes or `packages/schema` bytes.**
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🛑 **AND THE COUNTERWEIGHT WAS APPLIED: TWO PROGRAMS SPELL THIS SENTENCE AND THEY
// AGREE ON EVERY BOARD'S CARD COUNT** (D483/D485). The sibling is
// `[conditionGate { then: [discard 3], otherwise: [discard 1] }]`, and the agreement is
// ARITHMETIC rather than accidental: `min(1,H) + min(2, H − min(1,H)) === min(3,H)` for
// every hand size `H`, so **no board can separate them by cards discarded**. They
// separate on the PARK, and — D485-ii again — **the collision board is the SMALLEST
// one**: at a hand of 0 or 1 the two are byte-identical and neither asks anything.
// **They diverge at a TWO-card hand**, where this program parks (*"Discard a card from
// your hand."*, 1 of 2) and then forces the last card, and the sibling discards both
// with no question at all. §5 DRIVES both programs on both hand sizes rather than
// arguing them, and asserts the collision as well as the divergence.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🛑 **THE ROW IS `COMPOUND-head`, SO D466's RULE APPLIED — AND IT CAME OUT D485's WAY.**
// `splitAttackTrailingClause` wants the sentence unclaimed, the HEAD claimed and the TAIL
// claimed by `deriveAttackEffect`; the first two already held, so **a tail-only arm would
// have freed this row through the splitter with no compound anchor at all** — cheaper
// than what shipped. Refused, because *"2 MORE"* is an ANAPHOR whose antecedent is the
// head's discard, and a standalone tail arm has no way to ask whether anything was
// discarded. §7 drives both halves of that refusal, and it is armed by
// `D486-tail-only-anchor-loses-the-antecedent`.
//
// SEED-FREE: no op in this program consumes RNG. The one seed feeds setup's shuffle, and
// every board rebuilds the hand under test outright.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The printed sentence, byte for byte off `legalAttackCorpus()` (§1 asserts it, so a
    re-ingest disagrees with this line rather than with a number). */
const COMPOUND =
  "Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards.";
/** Its two halves at the one printed period. The HEAD has been claimed since D426; the
    TAIL is claimed by nobody, and §7 is the argument for keeping it that way. */
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
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
    then: [{ op: "opponentDiscardsFromHand", count: 2 }],
  },
];

/** 🛑 **THE SIBLING COMPOSITION, KEPT AS A VALUE SO §5 CAN RUN IT.** Not a mutant and not
    a straw man — it is the other program a builder would plausibly ship for this
    sentence, and it is right about every card count. Keeping it executable is what makes
    §5 a MEASUREMENT of where the two differ rather than a preference (D485-iii). */
const SIBLING: readonly EffectOp[] = [
  {
    op: "conditionGate",
    cond: SALANDIT,
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
    then: [{ op: "opponentDiscardsFromHand", count: 3 }],
    otherwise: [{ op: "opponentDiscardsFromHand", count: 1 }],
  },
];

/** The thirteen live readers, hand-kept and diffed against the module surface in §2 —
    D419's guard, in the shape thirty files carry it. */
const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackBonusConsequent,
];

const SEED = 20260908;

// ── The board (D414: a file-local `cardPool`, no `FIXTURE_POOL` id). ──────────────────
const GATED_DISCARD = 0;
const NO_EFFECT_AT_ALL = 1;

/** `d486-*` keys with no catalog row behind them (D425).

    🛑 **THE PRE-EVOLUTION NAMES ARE THE PRINTED BYTES AND THAT IS LOAD-BEARING** (D183 /
    D393's possessive toll): `conditionHolds` compares the card one below the top of the
    stack to `cond.name` byte for byte, so a demonstrator whose Basic is called anything
    but `Salandit` matches no printed sentence at all.

    🛑 **AND THE CROSS-CONTROL IS A SECOND STAGE 1 PRINTING THE SAME SENTENCE**, evolving
    from a DIFFERENT Basic. That is the only board on which the NAME test is observable
    separately from the TURN test (D393's §3 cross-control, borrowed): a build that read
    the evolution stamp and ignored `cond.name` pays this card's increment too. */
const CARDS: Record<string, Card> = {
  /** The attacker. Index 0 prints the compound; index 1 prints NO effect text at all,
      which is §6's control separating *the program ran and found nothing* from *no
      program ran* — two silences that look identical in a hand count.
      ⚠️ **NO PRINTED DAMAGE ON INDEX 0**: both ops park, and a base-damage Knock Out
      would put a promotion prompt in front of the `effect:choose` phase every case
      below reads (`opponentHandDiscard.test.ts`'s declared divergence, for its reason). */
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
  /** Five distinct hand cards. They are DISTINCT ids rather than five copies of one so
      that every "which cards left the hand" assertion below is a set difference rather
      than a count — a build that discarded the right NUMBER of the wrong cards would be
      invisible against five identical cards. */
  "d486-h1": trainerCard("d486-h1", "Item", "The first test hand card."),
  "d486-h2": trainerCard("d486-h2", "Item", "The second test hand card."),
  "d486-h3": trainerCard("d486-h3", "Supporter", "The third test hand card."),
  "d486-h4": trainerCard("d486-h4", "Stadium", "The fourth test hand card."),
  "d486-h5": trainerCard("d486-h5", "Tool", "The fifth test hand card."),
  "d486-nrg": basicEnergy("d486-nrg"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...CARDS };

/** Its own deck (D270/D412), 60 counted before the first run:
    8+8+4+4+8+4+4+4+4+4+8. */
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

/** 🛑 **THE LOAD-BEARING HAND, AND ITS SIZE IS COMPUTED IN §5 RATHER THAN CHOSEN.** Five
    cards is the smallest hand on which the five candidate readings answer five DISTINCT
    (gate-true, gate-false) PAIRS: four is the floor (the *"2 more" read as the total*
    reading answers 4 and needs somewhere to put the fourth card), and five leaves a
    remainder on both boards so *"the hand emptied"* can never stand in for *"the right
    number left"*. */
const HAND_5 = ["d486-h1", "d486-h2", "d486-h3", "d486-h4", "d486-h5"] as const;
/** The collision hand of §5's second half: TWO cards, where this program and the sibling
    diverge on the park. */
const HAND_2 = ["d486-h1", "d486-h2"] as const;
/** ONE card — the board on which the two are byte-identical and neither asks. */
const HAND_1 = ["d486-h1"] as const;

function openTable(first: Seat): GameState {
  const created = createGame({ seed: SEED, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let table = created.state;
  if (table.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  table = must(
    applyAction(table, { type: "chooseFirstPlayer", seat: table.phase.coinWinner, first }),
  );
  while (table.phase.kind === "setup:drawExtra") {
    const drawing = table.phase;
    const owing = (["p1", "p2"] as const).find((s) => !drawing.decided[s]);
    if (owing === undefined) throw new Error("setup:drawExtra with every seat decided");
    table = must(
      applyAction(table, { type: "setupDrawExtra", seat: owing, count: drawing.owed[owing] }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(
      applyAction(table, { type: "setupPlaceActive", seat, uid: firstBasicInHand(table, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(applyAction(table, { type: "setupReady", seat }));
  }
  return table;
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

/** p1 owns the turn with `to` Active and `oppHand` in p2's hand.

    ⚠️ **BOTH benches are cleared and BOTH hands are rebuilt** — every figure below is a
    population over a hand, so a card the setup shuffle happened to deal would move an
    answer silently. p1's own hand is loaded on purpose: it is the board on which a
    SEAT-inverted build is observable at all (§4). */
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

/** 🛑 **RUN A PROGRAM TO COMPLETION, ANSWERING EVERY PARK WITH THE FIRST `min`
    CANDIDATES, AND REPORT HOW MANY TIMES IT ASKED.** The park count is the whole of §5's
    second half: this program and its sibling agree on every card count, so the only
    observable difference is how many questions the opponent is made to answer. */
function drive(
  state: GameState,
  program: readonly EffectOp[],
  seat: Seat = "p1",
): { state: GameState; parks: number; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let result = runProgram(deepFreeze(state), program, { seat }, events);
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

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE CENSUS, MEASURED OVER THE POPULATION (D423)
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the sentence and the two families it lands in, measured not quoted", () => {
  it("the printed sentence is IN the legal attack column at exactly 1 printing", () => {
    const row = corpus().find(([, sentence]) => sentence === COMPOUND);
    expect(row).toBeDefined();
    expect(row?.[0]).toBe(1);
  });

  it("🛑 the GATED-INCREMENT family is TWO sentences / THREE printings, and the other is Ancient", () => {
    // ⚠️ THE PATTERN, PUBLISHED SO ITS EDGES ARE VISIBLE (D424/D425): every corpus row
    // whose text carries a printed `N more card(s)`. What it CANNOT see: an increment
    // spelled without the word *more* ("discard that many cards again"), and one whose
    // noun is not *card* at all. Zero such rows exist in this column today.
    const family = corpus().filter(([, s]) => /\d+ more cards?\b/.test(s));
    expect(family.map(([n, s]) => `${n} ${s}`).sort()).toEqual(
      [
        "1 Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards.",
        "2 Discard the top card of your opponent's deck. If you played an Ancient Supporter card from your hand during this turn, discard 3 more cards in this way.",
      ].sort(),
    );
    expect(units(family)).toBe(3);
    // 🛑 **THE SIBLING IS WHY §7's ANAPHOR ARGUMENT IS A MEASUREMENT AND NOT A HUNCH:
    // THE FAMILY MARKS ITS OWN BACKWARD REFERENCE IN PRINT.** The other row spells the
    // increment *"discard 3 more cards **in this way**"* — the §9.2 anaphor this engine
    // reads as `recordGate` — which is the same *"more than WHAT"* dependency written
    // down where a reader can see it. It stays unbuilt for three separate reasons (the
    // `Ancient` banner, a deck-mill head this column does not read, and that `in this
    // way`), asserted here so this slice's share of the family is named rather than
    // implied.
    const sibling = family.find(([, s]) => s !== COMPOUND);
    expect(sibling?.[1]).toContain("in this way");
    expect(sibling?.[1]).toContain("Ancient");
    expect(resolvedByAnyReader(sibling?.[1] ?? "")).toBe(false);
  });

  it("🛑 the `evolved from` family is THREE sentences and ALL THREE are now read", () => {
    // D393 built two of the three and recorded the third as refused *"by its consequent"*.
    // This slice takes the third, so the family closes — measured through the live
    // readers, not asserted from a handoff.
    const family = corpus().filter(([, s]) => s.includes("evolved from"));
    expect(family).toHaveLength(3);
    expect(units(family)).toBe(3);
    expect(family.filter(([, s]) => resolvedByAnyReader(s))).toHaveLength(3);
    // …and exactly ONE of the three is this slice's, which is what says the other two
    // still arrive through the reader D393 built them for.
    expect(family.filter(([, s]) => s === COMPOUND)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — BUILD STATE, WITH THE RIGHT ORACLE (D480/D482)
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the oracle, and what exactly one of thirteen readers claims", () => {
  it("🆕 the hand-kept READERS list IS the module's reader surface, and it is THIRTEEN", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    // Pinned separately from the diff: a diff alone stays green when a slice deletes a
    // reader from the module and from this list in the SAME commit (D419).
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 exactly ONE of the thirteen claims the compound, and it is `deriveAttackEffect`", () => {
    // The oracle this slice used, re-run against the shipped build. At the parent commit
    // this was 13 / 13 null; the ONLY change is the reader named below.
    const claimers = READERS.filter((read) => read(COMPOUND) !== null).map((read) => read.name);
    expect(claimers).toEqual(["deriveAttackEffect"]);
    expect(resolvedByAnyReader(COMPOUND)).toBe(true);
  });

  it("🛑 the TAIL is still claimed by NOBODY — the anchor is the WHOLE sentence", () => {
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

  it("🛑 the FIRST op is byte-identical to the HEAD's own reading, not a re-typed literal", () => {
    // 🛑 **THE COMPOSITION CLAIM, MADE EXECUTABLE.** The whole argument for two ops in
    // printed order rather than one op under a gate is that the compound's reading
    // CONTAINS the standalone's reading. That is checked here against the reader rather
    // than against this file's copy of it (D479's capture rule: justify a value against
    // a shipped program, never against a re-typed number) — and it is exactly the
    // property the sibling in §5 does not have.
    expect(deriveAttackEffect(COMPOUND)?.slice(0, 1)).toEqual(deriveAttackEffect(HEAD));
  });

  it("🛑 the gate's condition comes from the SHARED clause table, at the printed name", () => {
    const gate = deriveAttackEffect(COMPOUND)?.[1];
    expect(gate).toMatchObject({ op: "conditionGate", cond: SALANDIT });
    // The same clause under the OTHER outer skeleton resolves to the same member, which
    // is what says the table is shared rather than copied. This sentence is not printed
    // by any card — measured at 0 rows over all 640 — and it is asked here precisely
    // because a table row is a claim about vocabulary, not about one printing.
    expect(deriveAttackDamageBonus(`If ${CLAUSE}, this attack does 30 more damage.`)).toEqual({
      per: 30,
      count: { kind: "boardCondition", cond: SALANDIT },
    });
    expect(corpus().filter(([, s]) => s.includes(CLAUSE) && s !== COMPOUND)).toHaveLength(0);
  });

  it("🛑 an UNMAPPED clause falls through to null and stays LOUD", () => {
    // `CONDITIONAL_DAMAGE_CLAUSES`' standing rule. A build that defaulted an unknown
    // clause to *true* would pay this increment off every printing that ever prints one.
    expect(
      deriveAttackEffect(
        "Your opponent discards a card from their hand. If this Pokémon evolved from Rayquaza during this turn, your opponent discards 2 more cards.",
      ),
    ).toBeNull();
  });

  it("🛑 a printed ZERO increment derives to nothing at all", () => {
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
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "conditionGate", cond: SALANDIT, then: [{ op: "opponentDiscardsFromHand", count: 4 }] },
    ]);
  });

  it("🛑 the two anchors are DISJOINT by construction, and both still read", () => {
    // The plain anchor ends at `\.$` immediately after *their hand*, so it cannot claim
    // the compound; the compound anchor requires a second sentence, so it cannot claim
    // the standalone. Asserted rather than trusted — this is the ordering hazard a future
    // arm added beside these two could fail to have.
    expect(deriveAttackEffect("Your opponent discards 2 cards from their hand.")).toEqual([
      { op: "opponentDiscardsFromHand", count: 2 },
    ]);
    expect(deriveAttackEffect(HEAD)).toEqual([{ op: "opponentDiscardsFromHand", count: 1 }]);
    expect(deriveAttackEffect(COMPOUND)).toEqual(PROGRAM);
  });

  it("reads the sentence OFF THE DEMONSTRATOR, not off this file's copy", () => {
    // D183's rule: an arm written from a paraphrase passes a test written against the
    // same paraphrase and matches no real card.
    const attacks = CARDS["d486-salazzle"]?.attacks ?? [];
    expect(attacks[GATED_DISCARD]?.effect).toBe(COMPOUND);
    expect(attacks[GATED_DISCARD]?.damage).toBeUndefined();
    expect(attacks[NO_EFFECT_AT_ALL]?.effect).toBeUndefined();
    expect(deriveAttackEffect(attacks[GATED_DISCARD]?.effect ?? "")).toEqual(PROGRAM);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE GATE, DRIVEN ON BOARDS THAT DIFFER IN EXACTLY ONE AXIS (D484)
// ─────────────────────────────────────────────────────────────────────────────

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

  it("🛑 GATE FALSE — the NAME axis: evolved this turn, from the WRONG Basic", () => {
    // One axis: the evolution HAPPENED and it happened THIS turn, so the stamp is true
    // and only `cond.name` says no. A build that read the stamp alone pays here.
    const state = ready({ from: "d486-grubbin", to: "d486-crossling" });
    expect(state.players.p1.active?.evolvedTurn).toBe(state.turn);
    expect(conditionHolds(state, "p1", SALANDIT)).toBe(false);
    expect(discarded(state, drive(state, PROGRAM).state)).toBe(1);
  });

  it("🛑 GATE FALSE — the TURN axis: evolved from Salandit, but a round ago", () => {
    // One axis from the TRUE case: the same bodies, the same names, the same stack —
    // and the attack is declared a full round later. A build that dropped the turn test
    // pays this increment forever after the evolution.
    const state = ready({ from: "d486-salandit", to: "d486-salazzle", rounds: 1 });
    expect(state.players.p1.active?.evolvedTurn).not.toBeNull();
    expect(state.players.p1.active?.evolvedTurn).not.toBe(state.turn);
    expect(conditionHolds(state, "p1", SALANDIT)).toBe(false);
    expect(discarded(state, drive(state, PROGRAM).state)).toBe(1);
  });

  it("🛑 the CONTROLLER's own hand is untouched on both boards", () => {
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

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE LOAD-BEARING BOARDS, COMPUTED BEFORE THEY ARE ASSERTED (D482/D485)
// ─────────────────────────────────────────────────────────────────────────────

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
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
    [{ op: "conditionGate", cond: SALANDIT, then: [{ op: "opponentDiscardsFromHand", count: 2 }] }],
  ],
  [
    '"2 more" read as the TOTAL — one, then three',
    [
      { op: "opponentDiscardsFromHand", count: 1 },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "conditionGate", cond: SALANDIT, then: [{ op: "opponentDiscardsFromHand", count: 3 }] },
    ],
  ],
  [
    "the gate INVERTED — the increment on the false arm",
    [
      { op: "opponentDiscardsFromHand", count: 1 },
      {
        op: "conditionGate",
        cond: SALANDIT,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [],
        otherwise: [{ op: "opponentDiscardsFromHand", count: 2 }],
      },
    ],
  ],
];

/** The park-count difference (shipped − sibling) over §5's twelve boards, in the order
    they are driven: gate-true hands of 0..5, then gate-false hands of 0..5. */
const PARK_GAP = [0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0];

describe("§5 — five candidate readings, and the sibling that no card count can separate", () => {
  it("🛑 the five readings answer five DISTINCT (gate-true, gate-false) PAIRS on a five-card hand", () => {
    // 🛑 **D482's ARITHMETIC-COINCIDENCE CLASS, WHOSE SYMPTOM IS A CONTROL PASSING.** The
    // answers are DRIVEN off the boards below, never typed — and the PAIR is the unit,
    // because no single board separates all five: on the gate-TRUE board *correct* and
    // *gate dropped* both answer 3, and on the gate-FALSE board *correct* and *"2 more"
    // as the total* both answer 1. **Either board alone would have made half this file
    // vacuous.**
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
    // ⚠️ **AND THE TWO COLLISIONS ARE ASSERTED RATHER THAN DESCRIBED** (D485-iii: assert
    // the near-misses, so the fixture's composition is a measurement and not a
    // preference). A successor who shrinks either board reddens here.
    expect(new Set(pairs.map(([onTrue]) => onTrue)).size).toBe(4);
    expect(new Set(pairs.map(([, onFalse]) => onFalse)).size).toBe(3);
  });

  it("🛑 THE FOUR-CARD FLOOR: a THREE-card hand collapses two of the five readings", () => {
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

  it("🛑 THE SIBLING COMPOSITION AGREES ON EVERY CARD COUNT — the counts cannot choose", () => {
    // `min(1,H) + min(2, H − min(1,H)) === min(3,H)` for every H, so this is arithmetic
    // rather than luck. Driven across every hand size a board can field, on BOTH gate
    // boards, because a claim about "every board" is worth exactly the boards it is run
    // on (D472).
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
    // TWELVE boards — six hand sizes on each gate board — and the two programs agree on
    // every one of them. The literal is written out so a build that made BOTH wrong in
    // the same direction still reddens (an equality between two measured lists is
    // satisfiable by two identically-broken programs; a literal is not).
    expect(mine).toEqual([0, 1, 2, 3, 3, 3, 0, 1, 1, 1, 1, 1]);
    expect(theirs).toEqual(mine);
    // 🛑 **AND THE PARKS DO NOT AGREE**, which is the only column that can choose between
    // them. The gap is written out per board so the SHAPE of the divergence is pinned and
    // not just its existence: it opens on the gate-TRUE board the moment the hand holds
    // two cards, and it is zero on every gate-FALSE board, where both programs run a
    // single one-card discard.
    expect(parkGap).toEqual(PARK_GAP);
  });

  it("🛑 THE COLLISION BOARD IS THE SMALLEST ONE, AND THE DIVERGENCE IS AT TWO CARDS", () => {
    // 🛑 **D485-ii, at its second address: the near-miss degenerates on the board a suite
    // reaches for first.** With ONE card in the opponent's hand the two programs are
    // byte-identical AND neither asks anything — "I tested the simple case" is exactly
    // the habit that would have hidden the choice. They diverge at TWO.
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
    // The EVENT column tells the same story from the other side: two rows against one.
    // ⚠️ `EFFECT_PENDING` is absent from BOTH lists and that is not an omission — it is
    // filed by `settleProgram` (flow.ts) when a park becomes a PHASE, and this helper
    // drives `runProgram`/`resumeProgram` directly. §8 reaches the phase for real.
    expect(types(mineTwo.events)).toEqual(["FORCED_HAND_DISCARD", "FORCED_HAND_DISCARD"]);
    expect(types(theirsTwo.events)).toEqual(["FORCED_HAND_DISCARD"]);
  });

  it("🛑 on a FIVE-card hand the shipped program asks TWICE, in the printed voices", () => {
    // The captions are the ANSWERER's voice (D426's rule, and `opponentDiscardNote`'s
    // doc): the card says *"YOUR OPPONENT discards…"* and the player reading these
    // dialogs IS that opponent. This is the first program in the engine to put that
    // helper on screen twice in one attack, so both counts are read.
    const state = ready({ from: "d486-salandit", to: "d486-salazzle" });
    const notes: string[] = [];
    let result = runProgram(deepFreeze(state), PROGRAM, { seat: "p1" }, []);
    while (result.kind === "parked") {
      const prompt = result.prompt;
      if (prompt.kind !== "chooseCards") throw new Error("expected a chooseCards prompt");
      notes.push(prompt.note ?? "");
      // ⚠️ THE ANSWERER IS THE HAND'S OWNER ON BOTH PARKS, not only on the first.
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
      // §8.6's do-as-much-as-you-can ending: an empty hand takes zero, and zero is a
      // silent no-op — no event, because the attack row already said it happened.
      expect(types(after.events)).toEqual([]);
      expect(after.state).toBe(state);
    }
  });

  it("🛑 THE CONTROL: the SAME attacker's other attack files nothing for a DIFFERENT reason", () => {
    // *The program ran and found nothing* and *no program ran at all* look identical in a
    // hand count, and this is the rung that separates them. Index 1 prints no effect text,
    // so no program exists; index 0 on an empty hand runs a real program that moves
    // nothing. Both leave the hand at zero.
    const attacks = CARDS["d486-salazzle"]?.attacks ?? [];
    expect(deriveAttackEffect(attacks[NO_EFFECT_AT_ALL]?.effect ?? "")).toBeNull();
    // ⚠️ **THE ZONE READ HERE IS THE DISCARD PILE AND NOT THE HAND**, deliberately: an
    // attack ENDS the turn, so the other seat draws before this assertion can be made and
    // a hand count would be measuring the draw step. The discard pile only moves if this
    // program moved it.
    const state = ready({ from: "d486-salandit", to: "d486-salazzle", oppHand: [] });
    const plain = mustApply(state, { type: "attack", seat: "p1", index: NO_EFFECT_AT_ALL });
    expect(idsIn(plain.state, "p2", "discard")).toEqual(idsIn(state, "p2", "discard"));
    expect(types(plain.events)).toContain("DAMAGE_DEALT");
    // …and the gated attack on the same empty hand deals NO damage and still resolves.
    const gated = mustApply(state, { type: "attack", seat: "p1", index: GATED_DISCARD });
    expect(gated.state.phase.kind).not.toBe("effect:choose");
    expect(types(gated.events)).not.toContain("FORCED_HAND_DISCARD");
  });

  it("🛑 THE CONTROL FROM THE OTHER SIDE: a LOADED hand on the plain attack moves nothing", () => {
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

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE CHEAPER BUILD THAT WAS DRIVEN AND REFUSED (D466 / D485-i)
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the tail-only arm the splitter would have accepted, and why it is refused", () => {
  it("🛑 the splitter's HEAD condition and its BREAK both hold — only the tail reader is missing", () => {
    // 🛑 **DRIVEN, NOT ARGUED.** `splitAttackTrailingClause` wants three things: the whole
    // string unclaimed, the HEAD claimed by some reader, and the TAIL claimed by
    // `deriveAttackEffect`. The head condition is asserted directly; the BREAK is proved
    // by handing the splitter the same head with a tail that IS claimed, and watching it
    // compose. So at the parent commit the only unmet condition was the tail — which is
    // exactly what a tail-only arm would have supplied.
    expect(deriveAttackEffect(HEAD)).not.toBeNull();
    const composable = `${HEAD} Your opponent's Active Pokémon is now Asleep.`;
    expect(splitAttackTrailingClause(composable)).toEqual({
      head: HEAD,
      tail: "Your opponent's Active Pokémon is now Asleep.",
    });
  });

  it("🛑 THE REFUSAL: `2 more` is an ANAPHOR, and a tail arm would compose it behind ANY head", () => {
    // The board this refusal is about does not exist in the catalog, which is the point:
    // a reader is a claim about every string of its shape, not about the one printing that
    // motivated it. A standalone tail arm has no way to ask whether anything was
    // discarded, so `splitAttackTrailingClause` would happily weld it to a status head and
    // discard two cards *more than nothing*.
    const stray = `Your opponent's Active Pokémon is now Asleep. ${TAIL}`;
    expect(deriveAttackEffect(stray)).toBeNull();
    expect(splitAttackTrailingClause(stray)).toBeNull();
    expect(splitAttackGateClause(stray)).toBeNull();
    expect(resolvedByAnyReader(stray)).toBe(false);
    // …and the same for a DRAW head, D485's own counterexample shape.
    const drawHead = `Draw 3 cards. ${TAIL}`;
    expect(deriveAttackEffect(drawHead)).toBeNull();
    expect(splitAttackTrailingClause(drawHead)).toBeNull();
  });

  it("🛑 the compound is claimed WHOLE, so the splitter never sees it — its shadow refusal", () => {
    // ⚠️ **A RUNG THAT WAS GREEN BEFORE THIS SLICE AND IS GREEN NOW FOR A DIFFERENT
    // REASON**, named rather than left to rot: before, the splitter refused this string at
    // its TAIL condition; now it refuses at its FIRST — `claimedByAnyReader` is true, and
    // a string a reader claims whole is that reader's. Both splitters that serve
    // unresolved sentences are driven (D425: the requirement and cancel splitters serve
    // zero).
    expect(resolvedByAnyReader(COMPOUND)).toBe(true);
    expect(splitAttackTrailingClause(COMPOUND)).toBeNull();
    expect(splitAttackGateClause(COMPOUND)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE PERSISTED SHAPE: `MATCH_RECORD_VERSION` STAYS 29, DRIVEN
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — what this program can put into a persisted `phase.cont`", () => {
  it("🛑 the park's continuation carries a `conditionGate` — a NEW COMBINATION of OLD members", () => {
    // 🛑 **THE ARGUMENT IS DRIVEN RATHER THAN QUOTED (D463).** The only address an
    // `EffectOp` reaches inside a `MatchRecord` is `state.phase.cont` on an
    // `effect:choose` phase. This program's FIRST op parks, so the gate — and with it a
    // `yourActiveEvolvedFromThisTurn` condition — lands in `cont` for the first time in
    // this engine's history: at HEAD that member reached only `deriveAttackDamageBonus`'s
    // damage fold, which is not an op and is never persisted.
    //
    // **It is still 29, and the reason is that nothing in the serialized ALPHABET grew.**
    // `conditionGate` has been an `EffectOp` member since long before v29 and
    // `yourActiveEvolvedFromThisTurn` has been a `BoardCondition` member since D393
    // (v23 → v24, whose bump paid for the `InPlayPokemon.evolvedTurn` field this gate
    // reads). A v29 reader parses this `cont` by the union it already has and evaluates
    // it by the arm it already ships. **A new COMBINATION of shipped members is not a
    // schema change; a new member, field or value would be.** This slice adds none of
    // the three — which is the cheap side of the D486 work order's warning that a new op
    // FIELD on a persisted op is the costly one.
    const state = ready({ from: "d486-salandit", to: "d486-salazzle" });
    const parked = mustApply(state, { type: "attack", seat: "p1", index: GATED_DISCARD });
    if (parked.state.phase.kind !== "effect:choose") throw new Error("expected the discard park");
    expect(parked.state.phase.answerer).toBe("p2");
    const rest = parked.state.phase.cont.rest;
    expect(rest).toEqual([
      {
        op: "conditionGate",
        cond: SALANDIT,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "opponentDiscardsFromHand", count: 2 }],
      },
    ]);
  });

  it("🛑 the whole parked state ROUND-TRIPS through JSON and resolves identically", () => {
    // The bytes, not the shape: serialize the parked state, parse it back, answer the
    // park on the REVIVED state, and require the same board. A version bump would be owed
    // if this could not be done with a v29 reader's types.
    const state = ready({ from: "d486-salandit", to: "d486-salazzle" });
    const parked = mustApply(state, { type: "attack", seat: "p1", index: GATED_DISCARD }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the discard park");
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
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

// ─────────────────────────────────────────────────────────────────────────────
// §9 — THE DESCRIBER OBLIGATION, FOLLOWED DOWN THE CALL PATH (D478)
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — every describer this program reaches, asked on the load-bearing board", () => {
  it("🛑 `conditionNote` renders the printed clause with its pronoun resolved", () => {
    // The clause table's key and the note differ by exactly one resolved pronoun (D116),
    // and the NAME rides the parameter — so the third row on this member is legible with
    // no third string.
    expect(conditionNote(SALANDIT)).toBe(
      "your Active Pokémon evolved from Salandit during this turn",
    );
    expect(conditionNote(SALANDIT).replace("your Active Pokémon", "this Pokémon")).toBe(CLAUSE);
  });

  it("🛑 the gate itself files NO event, and the discards file one row EACH", () => {
    // `conditionGate` announces nothing by design — the condition is public, so unlike a
    // coin flip it tells the opponent nothing they cannot see. The two discards are the
    // only rows, and they are the SAME describer (`FORCED_HAND_DISCARD`) reached twice,
    // which is what this program does that no shipped program did before.
    const state = ready({ from: "d486-salandit", to: "d486-salazzle" });
    const after = drive(state, PROGRAM);
    expect(types(after.events)).toEqual(["FORCED_HAND_DISCARD", "FORCED_HAND_DISCARD"]);
    // …and on the gate-FALSE board there is exactly ONE.
    const cold = ready({ from: null, to: "d486-salazzle" });
    expect(types(drive(cold, PROGRAM).events)).toEqual(["FORCED_HAND_DISCARD"]);
    // ⚠️ `EFFECT_PENDING` belongs to the PHASE and not to the program (flow.ts's
    // `settleProgram`), so it is asserted where the phase exists — §8 — rather than
    // here, where `runProgram` is driven directly.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — THE VERSION PINS
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 — the version, and what it is owed for", () => {
  it("engineVersion is 0.400.0 and the bump is owed for BEHAVIOUR", () => {
    // A sentence that derived to `null` derives to a two-op program. No new op, no new
    // field and no new interpreter byte — but `deriveAttackEffect` answers differently on
    // a printed string, which is behaviour, so the bump is owed. ⚠️ **A slice that adds
    // ZERO mechanism still owes it**: the tax is on what the engine DOES, not on how much
    // of it is new.
    expect(engineVersion).toBe("0.400.0");
    expect(manifest.version).toBe(engineVersion);
  });
});
