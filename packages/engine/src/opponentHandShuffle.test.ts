import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { EffectOp } from "./effects";
import {
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion, redactGame } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { runProgram } from "./interpreter";
import { phaseViewOf } from "./phaseView";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  handFromDeck,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 🆕🆕🆕 D542 — THE OPPONENT-CHOSEN HAND SHUFFLE, AND IT IS A COMPOSITION OF TWO
// SHIPPED OPS PLUS ONE OPTIONAL FIELD.
//
//   "Your opponent chooses 3 cards from their hand and shuffles those cards into
//    their deck."
//
// **1 sentence / 1 legal printing** — `censusAttackCorpus.ts` **file line 665**,
// `legalAttackCorpus()` index **612**, leading count column **1**.
//
// 🛑 **ONE PRINTING IS ONE PRINTING, AND THE CASE FOR THE ROW IS SAID AT THE TOP
// RATHER THAN LEFT TO BE READ OUT OF THE CENSUS DELTA.** What carries it is (a) the
// near-total REUSE — zero new `EffectOp` members, zero new `EffectPrompt` kinds,
// zero new `EffectChoice` members, zero new readers (`attackReaderSurface()` stays
// **13**), zero `packages/schema` bytes, zero projection arms, zero new dialog
// components; (b) an EXPIRED REFUSAL retired at the address that wrote it
// (`effects.ts`'s *"NO `to`"* paragraph, whose every clause is still true and which
// is simply no longer a refusal once a second value is printed); and (c) 🛑 **A REAL
// CLIENT-SIDE DEFECT THAT ARRIVES WITH THE OP AND IS FIXED IN THE SAME SLICE.**
//
// 🛑 **THE APP TIER DOES MOVE, AND THE DEFECT IS COMPILER-INVISIBLE.** The app reads
// the PROMPT, not the op. This build creates the engine's FIRST **MANDATORY**
// (`min === max === 3`) `chooseCards` park with `dest: "deck"` — every other
// producer of a `"deck"` pick (`discardPileRetrieval`) parks at `min: 0`, so the
// "up to" cell of the HUDs' Confirm-verb tables shipped live and the MANDATORY cell
// did not. `GameHud.tsx`'s `CHOOSE_CARDS_VERB` is a TOTAL RECORD over the `dest`
// union and its `deck.mandatory` cell already reads *"Shuffle"*, so the local HUD
// needed no byte. `OnlineHud.tsx`'s mandatory branch was a **TERNARY**
// (`dest === "deckBottom" ? "Put under deck" : "Discard"`), so this prompt rendered
// **"Discard 0/3"** under a heading promising a shuffle — `tsc` silent, every suite
// green. The irony was already in the tree: `GameHud.tsx` documents fixing EXACTLY
// this hole on the local HUD (*"A record keyed on the union goes red at `tsc` when a
// member is added; a ternary goes quiet"*) and the online client still had the
// ternary. §8 names the rung that can see it; the rung itself is
// `OnlineHud.chooseCardsVerb.dom.test.tsx`, because a dom assertion does not belong
// in an engine suite.
//
// 🛑 **THE ONE SITE THE COMPILER CANNOT SEE IS WHAT THIS SUITE EXISTS FOR.**
// `applyChoice`'s `switch` ends `default: return state;` (*"Synchronous ops never
// park, so never reach the choice path"*) — and here the deck route is not even an
// arm, it is a BRANCH INSIDE an arm. Delete it and the op still parks, still
// dialogs, still validates the answer, and then lands the three picked cards in the
// DISCARD PILE while the caption, the log row and the printed sentence all say deck.
// **MEASURED rather than argued** (D540's method): at this head, deleting that
// branch and running `bunx tsc -b --force` prints NOTHING and exits 0. §4 is the
// only rung that can see it, and it asserts the uids ON A BOARD — out of the hand,
// IN the owner's deck, and **NOT** in the owner's discard (D421).
//
// ⚠️ **AND THE FORCED ARM IS A SECOND INVISIBLE HALF, REACHED FROM THE OTHER SIDE.**
// The §8.6 *"do as much as you can"* path (`hand.length <= take`) never touches
// `applyChoice` at all, so a build that widened only the PARK passes every §4
// assertion and still sends a three-card hand to the discard. §5 drives it.
//
// ⚠️ **NO CARD ID RESOLVES FOR THIS SENTENCE ON THIS CHECKOUT AND THAT WAS
// MEASURED** — `git grep -nF` over the printed bytes returns SEVEN lines at HEAD
// (the corpus row, `opponentHandDiscard.test.ts:143`, and five `docs/progress.md`
// close-outs) and **no catalog row**; `registry.ts` and `catalogManifest.ts` both
// return zero. So this suite rides file-local DECLARED demonstrators `d542-*`
// (D425) in their OWN 60-card deck (D270).
// ⚠️ **AND THE INSTRUMENT IS NAMED, BECAUSE IT MISSED ONE.** That same one-line
// grep does NOT reach `effects.ts`'s family-sweep paragraph, which carried the
// claim *"…which is this mechanism with a DIFFERENT DESTINATION and is refused
// whole"* — the comment WRAPS the sentence across two `//` lines, so the bytes the
// grep keys on exist nowhere in that file. It was found by READING THE NEIGHBOURS
// of the anchor being edited (D540's rule) and re-pointed in place.

const SENTENCE =
  "Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.";

/** The four family siblings that ARE built at HEAD, byte for byte off
    `legalAttackCorpus()` (§1 asserts that rather than trusting these copies), with
    the program each derives to. §1 drives all five against all five. */
const FAMILY = [
  {
    text: "Your opponent discards 2 cards from their hand.",
    ops: [{ op: "opponentDiscardsFromHand", count: 2 }],
    printings: 4,
  },
  {
    text: "Your opponent discards a card from their hand.",
    ops: [{ op: "opponentDiscardsFromHand", count: 1 }],
    printings: 2,
  },
  {
    text: "Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards.",
    ops: [
      { op: "opponentDiscardsFromHand", count: 1 },
      {
        op: "conditionGate",
        cond: { kind: "yourActiveEvolvedFromThisTurn", name: "Salandit" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "opponentDiscardsFromHand", count: 2 }],
      },
    ],
    printings: 1,
  },
  {
    text: "Discard a card from your hand. If you do, your opponent discards a card from their hand.",
    ops: undefined, // shape asserted only as NON-null: it is D515's program, not this slice's
    printings: 1,
  },
] as const satisfies readonly {
  text: string;
  ops: readonly EffectOp[] | undefined;
  printings: number;
}[];

/** The program this slice's sentence derives to. TWO ops in printed order. */
const PROGRAM: readonly EffectOp[] = [
  { op: "opponentDiscardsFromHand", count: 3, to: "deck" },
  { op: "shuffleDeck", whose: "opponent" },
];

const SHUFFLE = 0; // {C}, no damage — the sentence
const PLAIN = 1; // {C}, no damage, NO effect — the one-axis control
const DISCARD_TWO = 2; // {C}, no damage — the BUILT sibling, same board, other destination

const LOCAL_CARDS: Record<string, Card> = {
  "d542-shuffler": battler("d542-shuffler", {
    types: ["Colorless"],
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Hand Reshuffle", effect: SENTENCE },
      { cost: ["Colorless"], name: "Plain Call" },
      { cost: ["Colorless"], name: "Hand Purge", effect: FAMILY[0].text },
    ],
  }),
  "d542-wall": battler("d542-wall", { types: ["Colorless"], hp: 300, retreat: 1 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** ⚠️ FIVE DISTINCT HAND CARDS, and the distinctness is load-bearing twice: §4 reads
    the moved uids back individually, and §3 asserts that NONE of them appears in the
    ACTOR's snapshot — a hand of five copies of one card could not tell a leak of one
    from a leak of all five. */
const HAND_IDS = ["fix-item", "fix-tool", "fix-gatedsup", "fix-stadium", "fix-energy"] as const;

/** Its OWN deck (D270): counted by the helper rather than in prose, because 60 is a
    `createGame` precondition and a miscount is a mulligan storm, not a red rung.
      • `d542-shuffler` — the demonstrator, three indices;
      • `d542-wall` — the opponent's body, which nothing here can Knock Out;
      • the five `HAND_IDS` fillers, which §3-§6 draw into the opponent's hand by id;
      • `fix-energy` — Colorless Basic: every printed cost in this deck is {C}. */
const SHUFFLE_DECK = deckOf({
  "d542-shuffler": 4,
  "d542-wall": 4,
  "fix-basic-1": 8,
  "fix-item": 8,
  "fix-tool": 8,
  "fix-gatedsup": 4,
  "fix-stadium": 4,
  "fix-energy": 20,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };
const SEED = 20260922;

const other = (seat: Seat): Seat => (seat === "p1" ? "p2" : "p1");

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: SHUFFLE_DECK, p2: SHUFFLE_DECK },
    cardPool: POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
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

/** Rebuild `seat`'s HAND outright — the opponent's hand IS the zone under test and
    every board below has to field it at an exact size. */
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

/** `attacker` fields `d542-shuffler` with an empty Bench; the other seat fields a
    body of its own and holds exactly `hand`. The attacker moves FIRST so the
    opponent's own first turn is behind us and the attack is legal. */
function ready(hand: readonly string[] = HAND_IDS, attacker: Seat = "p1", seed = SEED): GameState {
  const opponent = other(attacker);
  let state = localSetup(seed, attacker);
  state = mustApply(state, { type: "endTurn", seat: attacker }).state;
  state = mustApply(state, { type: "endTurn", seat: opponent }).state;
  state = setActiveFromDeck(state, attacker, "d542-shuffler");
  state = attachFromDeck(state, attacker, "fix-energy", 1);
  state = clearBench(state, attacker);
  state = setActiveFromDeck(state, opponent, "d542-wall");
  state = clearBench(state, opponent);
  return withHand(state, opponent, hand);
}

const attack = (state: GameState, index: number, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index });

/** The parked prompt, narrowed. Throws rather than returning null, so a board that
    FORCED instead of parking names itself at the call site (D424's live-axis rule). */
function parkedPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected the park, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "chooseCards") throw new Error("expected a chooseCards prompt");
  return prompt;
}

function answerWith(state: GameState, seat: Seat, uids: readonly string[]) {
  return mustApply(state, {
    type: "resolveEffect",
    seat,
    choice: { kind: "cards", uids: [...uids] },
  } satisfies GameAction);
}

/** ⚠️ **THE ATTACK ENDS THE TURN, SO THE HAND'S OWNER DRAWS EXACTLY ONE CARD
    BEFORE ANY POST-RESOLUTION ASSERTION RUNS — AND THAT DRAW COMES OFF THE DECK THE
    PICKED CARDS JUST ENTERED.** So *"the three cards are in the deck"* is not a
    board-observable statement after the fact: one of them may legitimately be back
    in hand. Every §4/§5 rung therefore asserts the PARTITION — each picked uid is
    in `deck ∪ hand`, none is in `discard`, and the DISCARD PILE IS PINNED
    UNCHANGED, which is precisely the zone the `applyChoice` mutant moves them to.
    Stated here once rather than re-derived at six call sites (D426's rule about a
    decision that is not pinned being indistinguishable from an oversight). */
function zones(state: GameState, seat: Seat) {
  const side = state.players[seat];
  return { hand: side.hand, deck: side.deck, discard: side.discard };
}

/** The flattened text of the one action row a batch produced that mentions `needle`
    — the string a player actually reads. */
function rowText(state: GameState, events: GameEvent[], needle: string): string {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  const row = logFromEvents(events, ctx).find(
    (r) => r.kind === "action" && r.segments.some((s) => s.text.includes(needle)),
  );
  if (row === undefined || row.kind !== "action") throw new Error(`no row mentioning ${needle}`);
  return row.segments.map((s) => s.text).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE READING: the anchor claims this row and REFUSES the four siblings, and
//      the two existing family anchors refuse this row. A five-by-five matrix
//      driven off the LIVE module (D541 §2's shape), plus the near-misses.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the anchor, driven against the whole printed family", () => {
  it("🛑 derives to TWO SHIPPED OPS in printed order — and `to` is the only new byte", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual(PROGRAM);
    // The destination is a FIELD and not a second op member: strip it and what is
    // left is byte-for-byte the shipped pre-D542 program for the discard printings.
    // This is D131's widen-don't-add test written as an assertion rather than as a
    // sentence, and it is the whole argument for `MATCH_RECORD_VERSION` holding (§9).
    const [head] = deriveAttackEffect(SENTENCE) ?? [];
    if (head === undefined || head.op !== "opponentDiscardsFromHand") throw new Error("no head op");
    const { to, ...withoutTo } = head;
    expect(to).toBe("deck");
    expect(withoutTo).toEqual({ op: "opponentDiscardsFromHand", count: 3 });
    // …and that stripped object is exactly what the SIBLING sentence derives to one
    // count over, so the claim is anchored on a shipped reading and not on a shape.
    expect(deriveAttackEffect("Your opponent discards 3 cards from their hand.")).toEqual([
      withoutTo,
    ]);
  });

  it("🛑 THE FIVE-BY-FIVE MATRIX — every family sentence lands on its OWN reading", () => {
    // ⚠️ The anchors are module-private, so the matrix is driven through the ONE
    // public funnel that reads them all (`deriveAttackEffect`) and every cell is a
    // measurement of which arm claimed the string. A build in which this slice's
    // anchor over-claimed a sibling, or in which a sibling's anchor swallowed this
    // row, moves a cell — which is what makes this a matrix rather than five
    // positive rungs. Arm ORDER is load-bearing and this is what asserts it.
    for (const sibling of FAMILY) {
      const got = deriveAttackEffect(sibling.text);
      expect(got, sibling.text).not.toBeNull();
      if (sibling.ops !== undefined) expect(got, sibling.text).toEqual(sibling.ops);
      // …and NONE of the four siblings derives to this slice's program.
      expect(got, sibling.text).not.toEqual(PROGRAM);
      // …nor does any of them carry the new field anywhere in its program.
      expect(JSON.stringify(got), sibling.text).not.toContain('"to":"deck"');
    }
    // …and the five sentences are five DISTINCT strings, without which the loop
    // above could be satisfied by one row repeated.
    expect(new Set([SENTENCE, ...FAMILY.map((f) => f.text)]).size).toBe(5);
  });

  it("the UNPREFIXED CONTROL (D424): the bare sentence is what the reader answers to", () => {
    // Without this the two near-miss rungs below are tautologies — a build that
    // refused every string in this family would pass both of them.
    expect(resolvedByAnyReader(SENTENCE)).toBe(true);
    expect(deriveAttackEffect(SENTENCE)).not.toBeNull();
  });

  it("🛑 `^` — A PREFIX THAT KEEPS THE CAPITAL is refused (D539(1a))", () => {
    // The caret rung, spelled so it cannot be satisfied by the tail's anchor: the
    // sentence is glued on WHOLE, capital and all, so the only thing refusing this
    // string is `^`. `D542-anchor-loses-its-caret` is the declared row.
    expect(deriveAttackEffect(`Flip a coin. ${SENTENCE}`)).toBeNull();
    expect(deriveAttackEffect(`If heads, ${SENTENCE}`)).toBeNull();
  });

  it("🛑 `$` — A TRAILING CLAUSE THAT KEEPS THE PERIOD is refused (D540(1a))", () => {
    // ⚠️ AND THIS IS A SEPARATE RUNG FROM THE ONE ABOVE FOR A SEPARATE REASON. A
    // trailing near-miss glued on with `slice(0, -1)` STRIPS the period the anchor's
    // tail demands, so the string refuses for a reason that has nothing to do with
    // `$` and a `$`-less pattern refuses it too. The killer KEEPS the period: with
    // `$` gone the anchor matches the PREFIX and the engine authors a program for a
    // card whose trailing clause it silently dropped.
    expect(deriveAttackEffect(`${SENTENCE} Then, draw a card.`)).toBeNull();
    expect(deriveAttackEffect(`${SENTENCE} Draw a card.`)).toBeNull();
    // …and the period-stripped spelling too, which refuses for the OTHER reason —
    // both are kept because they are two claims (D539/D540's two-reasons rule).
    expect(deriveAttackEffect(`${SENTENCE.slice(0, -1)} and draws a card.`)).toBeNull();
  });

  it("🛑 THE `3` IS A LITERAL, NOT A CAPTURE (D121's warrant, run not inherited)", () => {
    // This sweep varies no number: one printed sentence, one count. A capture here
    // would be a template over a population of one, which is what D231 refuses.
    // `D542-anchor-number-becomes-capture` is the declared row, and these are the
    // strings that kill it — every one of them is unprinted.
    for (const n of [1, 2, 4, 10]) {
      const spelled = SENTENCE.split(" chooses 3 cards ").join(` chooses ${n} cards `);
      expect(deriveAttackEffect(spelled), spelled).toBeNull();
    }
    // …and the CONTROL: the one printed number still derives, so the loop above
    // cannot be passed by a build that refused the whole sentence.
    expect(deriveAttackEffect(SENTENCE)).toEqual(PROGRAM);
  });

  it("⚠️ NO POSSESSIVE IS PRINTED, so NO `['’]` CLASS IS OWED (D137 does not reach it)", () => {
    // The sentence says *their hand* and *their deck* and never *your opponent's* —
    // so there is no apostrophe SLOT for a re-ingest to curl, and a class over a slot
    // no byte can occupy is a rule nothing can see. Read off the LIVE corpus row
    // rather than off this file's constant, so a re-ingest reddens HERE first.
    const row = legalAttackCorpus().find(([, s]) => s === SENTENCE);
    expect(row).toBeDefined();
    expect(row?.[1]).not.toContain("'");
    expect(row?.[1]).not.toContain("’");
    expect(row?.[1]).toContain("their hand");
    expect(row?.[1]).toContain("their deck");
  });

  it("the sentence is read OFF THE FIXTURE, not off this file's copy (D183)", () => {
    const attacks = POOL["d542-shuffler"]?.attacks ?? [];
    expect(attacks[SHUFFLE]?.effect).toBe(SENTENCE);
    expect(attacks[PLAIN]?.effect).toBeUndefined();
    expect(attacks[DISCARD_TWO]?.effect).toBe(FAMILY[0].text);
    // NO printed base damage on any index: the sentence PARKS, and a base-damage
    // Knock Out would put a promotion prompt in front of the very `effect:choose`
    // phase every board below reads.
    for (const index of [SHUFFLE, PLAIN, DISCARD_TWO]) {
      expect(attacks[index]?.damage, `index ${index}`).toBeUndefined();
    }
  });

  it("neither splitter claims it — the row leaves through the READER summand", () => {
    // Driven through the splitters themselves rather than inferred, and through both
    // of the two that serve unresolved sentences (D425).
    expect(splitAttackTrailingClause(SENTENCE)).toBeNull();
    expect(splitAttackGateClause(SENTENCE)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE CENSUS, driven off the module rather than retyped (D423/D230).
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the corpus figures, read off the population", () => {
  it("the row is IN the legal attack column at 1 printing, exactly once", () => {
    const corpus = legalAttackCorpus();
    expect(corpus.length).toBe(640);
    expect(corpus.reduce((sum, [n]) => sum + n, 0)).toBe(1732);
    const hits = corpus.filter(([, s]) => s === SENTENCE);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.[0]).toBe(1);
    expect(corpus.findIndex(([, s]) => s === SENTENCE)).toBe(612);
  });

  it("🛑 THE FAMILY IS FIVE ROWS / NINE PRINTINGS, AND ALL FIVE NOW RESOLVE", () => {
    // The published pattern (D424/D425), re-run WIDE and then narrowed, so the edges
    // of the net are visible rather than described. Before this slice four of the
    // five resolved; the family closes here.
    const corpus = legalAttackCorpus();
    const mentionsAHand = corpus.filter(([, s]) => /their hand|opponent's hand/i.test(s));
    expect(mentionsAHand.length).toBeGreaterThan(20);
    const family = mentionsAHand.filter(([, s]) =>
      /^Your opponent (?:discards|chooses)|your opponent discards/.test(s),
    );
    expect(family).toHaveLength(5);
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(9);
    for (const [, sentence] of family) {
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
    }
    // …and the five are exactly this slice's sentence plus the four in `FAMILY`,
    // which is what makes the closure a partition rather than a count.
    expect(family.map(([, s]) => s).sort()).toEqual([SENTENCE, ...FAMILY.map((f) => f.text)].sort());
    // The printing counts too, per row, off the ROW and not off this file.
    for (const sibling of FAMILY) {
      expect(family.find(([, s]) => s === sibling.text)?.[0], sibling.text).toBe(sibling.printings);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE PARK: the OWNER decides, the pick is MANDATORY and EXACT, the
//      destination is the DECK, and the ACTOR sees none of it.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the park, its decider and its redaction", () => {
  it("🛑 parks under the CONTROLLER with the OWNER as answerer", () => {
    const { state: parked, events } = attack(deepFreeze(ready()), SHUFFLE);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the park");
    expect(parked.phase.seat).toBe("p1");
    expect(parked.phase.answerer).toBe("p2");
    expect(find(events, "EFFECT_PENDING")?.seat).toBe("p2");
  });

  it("🛑 MANDATORY AND EXACT AT THREE, INTO THE DECK", () => {
    const state = ready();
    const oppHand = [...state.players.p2.hand];
    const prompt = parkedPrompt(attack(state, SHUFFLE).state);
    expect(prompt.min).toBe(3);
    expect(prompt.max).toBe(3);
    expect(prompt.dest).toBe("deck");
    // The WHOLE hand is the offer — no interchangeable collapse, because the
    // answerer owns this hand and is looking at it.
    expect(prompt.candidates).toEqual(oppHand);
    // ⚠️ WITHOUT THIS §4 MEANS NOTHING (D416): a board offering exactly `min`
    // candidates auto-resolves and never parks.
    expect(prompt.candidates.length).toBeGreaterThan(prompt.min);
  });

  it("🛑 THE CAPTION IS IN THE ANSWERER'S VOICE AND NAMES THE DECK", () => {
    // D426's rule: the player reading this dialog IS the opponent the card names, so
    // a verbatim caption would tell them to make someone else act. `D542-note-says-
    // discard` is the declared row — the answerer being told to DISCARD while the
    // engine shuffles is a lie no board and no type can catch.
    const note = parkedPrompt(attack(ready(), SHUFFLE).state).note;
    expect(note).toBe("Shuffle 3 cards from your hand into your deck.");
    expect(note).not.toContain("Discard");
    expect(note).not.toBe(SENTENCE);
    // …and the CONTROL on the same board: the sibling's caption still says discard,
    // so a build that renamed the verb everywhere fails here (two spellings kept).
    expect(parkedPrompt(attack(ready(), DISCARD_TWO).state).note).toBe(
      "Discard 2 cards from your hand.",
    );
  });

  it("🛑 `redactedPromptOf` sends the uids to the OWNER ALONE", () => {
    // Both halves, from both chairs. A build that dropped `decider` would hand the
    // CONTROLLER a face-up list of the opponent's hidden hand AND the choice.
    const state = ready();
    const oppHand = [...state.players.p2.hand];
    const { state: parked } = attack(state, SHUFFLE);
    const actorView = redactGame(parked, "p1");
    if (actorView.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(actorView.phase.prompt).toBeNull();
    const wire = JSON.stringify(actorView);
    for (const uid of oppHand) expect(wire).not.toContain(`"${uid}"`);
    // …and the OWNER's snapshot DOES carry the prompt, which is the control.
    const ownerView = redactGame(parked, "p2");
    if (ownerView.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(ownerView.phase.prompt?.kind).toBe("chooseCards");
    const ownerWire = JSON.stringify(ownerView);
    for (const uid of oppHand) expect(ownerWire).toContain(`"${uid}"`);
  });

  it("the CONTROLLER's answer is refused and the OWNER's is accepted", () => {
    const { state: parked } = attack(ready(), SHUFFLE);
    const uids = parkedPrompt(parked).candidates.slice(0, 3);
    const bad = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [...uids] },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("WRONG_SEAT");
    const good = applyAction(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: [...uids] },
    });
    expect(good.ok).toBe(true);
  });

  it("the TURN does not move — the attacker keeps the glow, the owner waits", () => {
    const { state: parked } = attack(ready(), SHUFFLE);
    for (const viewer of ["p1", "p2"] as const) {
      const view = phaseViewOf(parked, viewer);
      expect(view.activeSeat, viewer).toBe("p1");
      expect(view.waitingSeat, viewer).toBe("p2");
    }
    expect(phaseViewOf(parked, "p1").pendingDecision).toBeNull();
    expect(phaseViewOf(parked, "p2").pendingDecision?.kind).toBe("effectChoose");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🛑 §4 — THE ANSWER, ON A BOARD AND NOT ON A SHAPE (D421). This is the ONLY
//      section that can see `D542-apply-choice-drops-deck-branch`.
// ─────────────────────────────────────────────────────────────────────────────

describe("🛑 §4 — the picked cards land in the DECK and not in the discard", () => {
  it("🛑 OUT of the hand, IN the owner's DECK, NOT in the owner's discard", () => {
    const start = ready();
    const { state: parked } = attack(start, SHUFFLE);
    const picked = parkedPrompt(parked).candidates.slice(0, 3);
    const before = zones(parked, "p2");
    const { state } = answerWith(parked, "p2", picked);
    const after = zones(state, "p2");
    for (const uid of picked) {
      expect([...after.deck, ...after.hand], uid).toContain(uid);
      // 🛑 THE LINE THE SLICE EXISTS FOR. A build that dropped the `to === "deck"`
      // branch in `applyChoice` typechecks GREEN, parks, dialogs, validates the
      // answer and then puts these three uids HERE.
      expect(after.discard, uid).not.toContain(uid);
    }
    // …and the discard pile is not merely missing the picks, it is UNCHANGED — the
    // exact assertion the mutant moves.
    expect(after.discard).toEqual(before.discard);
    // THE ZONE ARITHMETIC, which is what turns the union above into a statement
    // about the DECK: three cards left the hand for the deck and the turn-end draw
    // took one back, so the deck is up 2 and the hand is the 2 leftovers plus 1.
    expect(after.deck.length).toBe(before.deck.length + 2);
    expect(after.hand).toHaveLength(3);
    // At most ONE picked card can be back in hand (the single draw); a build that
    // returned the picks to the hand instead of the deck fails here.
    expect(picked.filter((uid) => after.hand.includes(uid)).length).toBeLessThanOrEqual(1);
    // Nothing anywhere gained or lost a card.
    expect(after.deck.length + after.hand.length + after.discard.length).toBe(
      before.deck.length + before.hand.length + before.discard.length,
    );
  });

  it("🛑 THE EVENT NAMES THE DECK, AND IT IS FILED UNDER THE OWNER", () => {
    const { state: parked } = attack(ready(), SHUFFLE);
    const picked = parkedPrompt(parked).candidates.slice(0, 3);
    const { events } = answerWith(parked, "p2", picked);
    const row = find(events, "FORCED_HAND_DISCARD");
    expect(row?.seat).toBe("p2");
    expect(row?.to).toBe("deck");
    expect(row?.uids).toEqual([...picked]);
    // …and NO `actor` field, which is the whole of D426's voice argument and the
    // reason this event could be widened on DESTINATION rather than split on VOICE.
    expect(row === undefined ? true : "actor" in row).toBe(false);
  });

  it("the SIBLING on the same board still files the DISCARD arm — both spellings", () => {
    // The two-reasons rule: a build that made every `FORCED_HAND_DISCARD` a deck
    // move would pass the rung above and fail this one.
    const { state: parked } = attack(ready(), DISCARD_TWO);
    const picked = parkedPrompt(parked).candidates.slice(0, 2);
    const { state, events } = answerWith(parked, "p2", picked);
    const row = find(events, "FORCED_HAND_DISCARD");
    expect(row?.to).toBeUndefined();
    for (const uid of picked) {
      expect(state.players.p2.discard).toContain(uid);
      expect(state.players.p2.deck).not.toContain(uid);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — §8.6 SHORT BOARDS. The FORCED arm never reaches `applyChoice`, so a build
//      that widened only the PARK passes §4 and fails here.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the §8.6 short boards, on the arm §4 cannot reach", () => {
  it("an EMPTY hand moves no card and asks nothing — and the TAIL still runs", () => {
    // 🛑 **THE EMPTY-HAND BOARD IS WHERE THE COMPOSITION DIVERGES FROM THE PRINTED
    // SENTENCE, AND IT IS DRIVEN RATHER THAN LEFT SILENT.** The hand op is a silent
    // no-op (§8.6, and `randomFromOpponentHand`'s own empty-hand ending): no event,
    // no park, no card moved. But `shuffleDeck` is a SEPARATE OP in the program, so
    // the opponent's deck IS shuffled even though nothing went into it — where the
    // RANDOM twin, which owns its shuffle inside one op, spends no RNG at all on
    // this board.
    // ⚠️ **D342's RECORDED DECISION IS WHAT GOVERNS, AND IT WAS READ BEFORE THIS
    // WAS ACCEPTED** (`discardEnergy.to`'s doc block, verbatim): a destination that
    // also shuffles *"would buy the identical board and cost the day a card prints a
    // deck return with no shuffle"*, and *"would additionally make the op advance
    // `rngState` from inside a park"*. This op PARKS, so the second half is load-
    // bearing here in a way it is not for the random twin. **THE CONDITION THAT
    // WOULD REVERSE IT** (D422): a printing whose shuffle is conditional on cards
    // actually moving — at that point the tail needs a gate and this rung is the
    // one that changes.
    const start = ready([]);
    const { state, events } = attack(start, SHUFFLE);
    expect(state.phase.kind).toBe("turn:action");
    expect(types(events)).not.toContain("FORCED_HAND_DISCARD");
    // The tail ran, on the OPPONENT's deck, and nothing crossed a zone boundary but
    // the turn-end draw.
    expect(types(events)).toContain("SHUFFLE");
    expect(find(events, "SHUFFLE")?.seat).toBe("p2");
    expect(state.players.p2.hand).toHaveLength(1);
    expect(state.players.p2.deck.length).toBe(start.players.p2.deck.length - 1);
    expect(state.players.p2.discard).toEqual(start.players.p2.discard);
  });

  it("🛑 A HAND OF EXACTLY 3 IS FORCED — AND THE CARDS LAND IN THE DECK", () => {
    // `D542-forced-arm-still-discards` lives here and nowhere else.
    const start = ready(HAND_IDS.slice(0, 3));
    const hand = [...start.players.p2.hand];
    const before = zones(start, "p2");
    const { state, events } = attack(start, SHUFFLE);
    expect(state.phase.kind).toBe("turn:action"); // no question was asked
    expect(types(events)).not.toContain("EFFECT_PENDING");
    for (const uid of hand) {
      expect([...state.players.p2.deck, ...state.players.p2.hand], uid).toContain(uid);
      expect(state.players.p2.discard, uid).not.toContain(uid);
    }
    expect(state.players.p2.discard).toEqual(before.discard);
    // Three cards left the hand and the turn-end draw put one card back.
    expect(state.players.p2.hand).toHaveLength(1);
    expect(state.players.p2.deck.length).toBe(before.deck.length + 2);
    expect(find(events, "FORCED_HAND_DISCARD")?.to).toBe("deck");
  });

  it("🛑 A HAND OF FEWER THAN 3 DOES WHAT IT CAN — into the DECK", () => {
    // A SHORT hand and an EXACT hand are two decisions sharing one line: at 3 the
    // printed count is met and there is no choice; at 2 it CANNOT be met and the
    // card does what it can. Both are driven, because a decision that is not pinned
    // is indistinguishable from an oversight.
    const start = ready(HAND_IDS.slice(0, 2));
    const hand = [...start.players.p2.hand];
    const { state, events } = attack(start, SHUFFLE);
    expect(state.phase.kind).toBe("turn:action");
    expect(find(events, "FORCED_HAND_DISCARD")?.uids).toEqual(hand);
    expect(find(events, "FORCED_HAND_DISCARD")?.to).toBe("deck");
    for (const uid of hand) {
      expect([...state.players.p2.deck, ...state.players.p2.hand], uid).toContain(uid);
      expect(state.players.p2.discard, uid).not.toContain(uid);
    }
    expect(state.players.p2.discard).toEqual(start.players.p2.discard);
  });

  it("the SIBLING's short board still discards — the forced arm's two spellings", () => {
    const start = ready(HAND_IDS.slice(0, 2));
    const hand = [...start.players.p2.hand];
    const { state } = attack(start, DISCARD_TWO);
    for (const uid of hand) {
      expect(state.players.p2.discard, uid).toContain(uid);
      expect(state.players.p2.deck, uid).not.toContain(uid);
      expect(state.players.p2.hand, uid).not.toContain(uid);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE TAIL: `shuffleDeck { whose: "opponent" }` runs AFTER the answer.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the printed shuffle, and whose deck it reaches", () => {
  it("🛑 the SHUFFLE lands on the OPPONENT's deck and rngState moves", () => {
    // `D542-shuffle-tail-dropped`: without the tail the three picked cards stay where
    // `deckChosenFromHand` appended them — at the BOTTOM of the opponent's deck, in
    // pick order. (⚠️ This comment first said TOP and was the MIRROR of the code;
    // withdrawn here and at the row's own `what` and the helper's doc block, D539.
    // Index 0 is the TOP: every draw and mill cuts `deck.slice(0, n)`.) The defect is
    // real either way and does not depend on the end: `rngState` never moves, three
    // deck positions become KNOWN, and it is invisible to every membership assertion
    // in §4 — which is why the rung below reads the TAIL, the measured landing site.
    // `D542-shuffle-whose-dropped`: with `whose` gone the ATTACKER's deck is
    // shuffled instead — D534's recorded loss direction, one op over.
    const { state: parked } = attack(ready(), SHUFFLE);
    const picked = parkedPrompt(parked).candidates.slice(0, 3);
    const attackerDeckBefore = [...parked.players.p1.deck];
    const { state, events } = answerWith(parked, "p2", picked);
    const shuffles = events.filter((e) => e.type === "SHUFFLE");
    expect(shuffles).toHaveLength(1);
    expect(shuffles[0]).toEqual({ type: "SHUFFLE", seat: "p2" });
    expect(state.rngState).not.toEqual(parked.rngState);
    // The ATTACKER's deck is byte-identical — the half `whose` is for.
    expect(state.players.p1.deck).toEqual(attackerDeckBefore);
    // …and the picked cards are NOT sitting in pick order on the tail of the deck,
    // which is what a dropped shuffle would leave. Asserted as "the tail is not the
    // pick", so it is a statement about the shuffle and not about a seed.
    expect(state.players.p2.deck.slice(-3)).not.toEqual([...picked]);
  });

  it("the SHUFFLE runs AFTER the hand move, not before — one event per thing", () => {
    const { state: parked } = attack(ready(), SHUFFLE);
    const picked = parkedPrompt(parked).candidates.slice(0, 3);
    const { events } = answerWith(parked, "p2", picked);
    const order = types(events);
    expect(order.indexOf("FORCED_HAND_DISCARD")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("SHUFFLE")).toBeGreaterThan(order.indexOf("FORCED_HAND_DISCARD"));
  });

  it("the SIBLING emits NO shuffle at all — the tail belongs to this arm alone", () => {
    const { state: parked } = attack(ready(), DISCARD_TWO);
    const picked = parkedPrompt(parked).candidates.slice(0, 2);
    const { state, events } = answerWith(parked, "p2", picked);
    expect(types(events)).not.toContain("SHUFFLE");
    expect(state.rngState).toEqual(parked.rngState);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE LOG ROW: a COUNT, naming the DECK, and never the word discard.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the log row, both spellings", () => {
  it("🛑 the DECK arm speaks in COUNTS, names the deck, and does NOT say discard", () => {
    // `D542-log-row-says-discard`. The row must not say *discarded*, because a
    // player reading it would look for three cards in a pile that never received
    // them — and it must not say *shuffled* either, because the real SHUFFLE row
    // lands right after and one word secretly meaning two events is the thing
    // `events.ts` states the house rule against.
    const { state: parked } = attack(ready(), SHUFFLE);
    const picked = parkedPrompt(parked).candidates.slice(0, 3);
    const { state, events } = answerWith(parked, "p2", picked);
    const text = rowText(state, events, "from their hand");
    expect(text).toContain("put 3 cards from their hand into their deck");
    expect(text).not.toContain("discard");
    // A COUNT and not an identity list: no picked uid appears in the rendered row.
    for (const uid of picked) expect(text).not.toContain(uid);
  });

  it("the DISCARD arm still says discarded — both spellings kept", () => {
    const { state: parked } = attack(ready(), DISCARD_TWO);
    const picked = parkedPrompt(parked).candidates.slice(0, 2);
    const { state, events } = answerWith(parked, "p2", picked);
    const text = rowText(state, events, "from their hand");
    expect(text).toContain("discarded 2 cards from their hand");
    expect(text).not.toContain("into their deck");
  });

  it("the singular renders as ONE CARD on the deck arm too", () => {
    // The forced short board at a hand of one: the count is board-derived, so the
    // singular is reachable from print even though the printed count is 3.
    const start = ready(HAND_IDS.slice(0, 1));
    const { state, events } = attack(start, SHUFFLE);
    expect(rowText(state, events, "from their hand")).toContain(
      "put 1 card from their hand into their deck",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE CLIENT. The dom rung lives in `OnlineHud.chooseCardsVerb.dom.test.tsx`
//      (a dom assertion does not belong in an engine suite); what is asserted HERE
//      is the ENGINE-SIDE fact that rung keys on.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the prompt shape the HUDs' Confirm-verb tables read", () => {
  it("🛑 THE FIRST MANDATORY `dest: \"deck\"` PARK IN THIS ENGINE", () => {
    // This is the fact that turned two guessed HUD cells into live ones and exposed
    // the ONLINE ternary. It is asserted here so a future build that made this park
    // declinable (`min: 0`) reddens beside the dom rung rather than silently
    // retiring it — a rung whose premise moved is a rung that has stopped measuring.
    const prompt = parkedPrompt(attack(ready(), SHUFFLE).state);
    expect(prompt.dest).toBe("deck");
    expect(prompt.min).toBeGreaterThan(0);
    expect(prompt.min).toBe(prompt.max);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8b — THE DESCRIBER. `describeBranch` is USER-VISIBLE and the reader is not, so a
//      widening that stops at the reader is D515's own recorded defect one field over.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8b — the gate caption names the DECK, driven from a hand-built program", () => {
  /** The note on the §9.2 payment park for `[payFromHand, recordGate → ops]`. */
  const gatedNote = (inner: readonly EffectOp[]): string => {
    const board = ready();
    const result = runProgram(
      board,
      [
        { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        { op: "recordGate", slot: "paid", then: [...inner] },
      ],
      { seat: "p1" },
      [],
    );
    if (result.kind !== "parked") throw new Error("expected a park");
    if (result.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    return result.prompt.note;
  };

  it("🛑 THE DECK BRANCH SAYS DECK — and it is unreachable from print, so it is DRIVEN", () => {
    // ⚠️ **NO PRINTING COMPOSES A §9.2 GATE WITH THIS SENTENCE**, which is why the branch
    // exists at all: `drawCards`' stated reason one screen up in `interpreter.ts`, and
    // D455's correction to three false *"recorded as an equivalent mutant"* claims — a
    // line nothing executes is not covered by saying so. `D542-describe-branch-phrase-
    // unwidened` is the declared row and this is the only rung that can kill it.
    expect(gatedNote([{ op: "opponentDiscardsFromHand", count: 3, to: "deck" }])).toBe(
      "Discard a card from your hand. If you do, your opponent shuffles 3 cards from their hand into their deck.",
    );
    // …and the SINGULAR arm of the same branch, written for `drawCards`' reason and
    // driven for D455's.
    expect(gatedNote([{ op: "opponentDiscardsFromHand", count: 1, to: "deck" }])).toBe(
      "Discard a card from your hand. If you do, your opponent shuffles a card from their hand into their deck.",
    );
  });

  it("the DISCARD branch is UNMOVED — both spellings, on one board", () => {
    // The two-reasons rule: a build that rewrote the phrase for every destination
    // passes the rung above and fails this one.
    expect(gatedNote([{ op: "opponentDiscardsFromHand", count: 1 }])).toBe(
      "Discard a card from your hand. If you do, your opponent discards a card from their hand.",
    );
    expect(gatedNote([{ op: "opponentDiscardsFromHand", count: 3 }])).toBe(
      "Discard a card from your hand. If you do, your opponent discards 3 cards from their hand.",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🛑 §9 — `MATCH_RECORD_VERSION` STAYS 30, DRIVEN BOTH D450 DIRECTIONS OVER THE
//      SERIALIZED BYTES. This op PARKS, so a record really does hold the new
//      inhabitant and `"cont" in phase` is TRUE.
// ─────────────────────────────────────────────────────────────────────────────

describe("🛑 §9 — the persisted op, over the serialized bytes", () => {
  it("🛑 `\"cont\" in phase` IS TRUE and the new field IS in the bytes", () => {
    const { state } = attack(ready(), SHUFFLE);
    const phase = state.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect("cont" in phase).toBe(true);
    expect(JSON.stringify(state)).toContain('"op":"opponentDiscardsFromHand","count":3,"to":"deck"');
  });

  it("🛑 DIRECTION 1 — the parked program survives a JSON round trip and resolves", () => {
    const parked = attack(ready(), SHUFFLE).state;
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    const picked = parkedPrompt(revived).candidates.slice(0, 3);
    const { state, events } = answerWith(revived, "p2", picked);
    expect(find(events, "FORCED_HAND_DISCARD")?.to).toBe("deck");
    for (const uid of picked) expect(state.players.p2.deck).toContain(uid);
    expect(types(events)).toContain("SHUFFLE");
  });

  it("🛑 DIRECTION 2 — STRIP THE KEY AND A v30 RECORD MEANS WHAT IT ALWAYS MEANT", () => {
    // D131's widen-don't-add test, driven on the SERIALIZED bytes rather than argued
    // from the type's name (D427): the optional key is deleted from the record a v30
    // deploy could not have written, and what is left is a shipped pre-D542 program
    // that discards — same park, same answerer, same `chooseCards` inhabitant, and
    // the cards land in the PILE. The alphabet grew; nothing already in it changed.
    const parked = attack(ready(), SHUFFLE).state;
    const bytes = JSON.stringify(parked);
    expect(bytes).toContain('"count":3,"to":"deck"');
    const stripped = JSON.parse(bytes.split('"count":3,"to":"deck"').join('"count":3')) as GameState;
    // The park itself is unchanged in every field but `dest` — which is the prompt,
    // not the record, and is re-derived from the op on resume.
    const picked = parkedPrompt(stripped).candidates.slice(0, 3);
    const { state, events } = answerWith(stripped, "p2", picked);
    expect(find(events, "FORCED_HAND_DISCARD")?.to).toBeUndefined();
    for (const uid of picked) {
      expect(state.players.p2.discard, uid).toContain(uid);
      expect(state.players.p2.deck, uid).not.toContain(uid);
    }
    // …and the SHUFFLE tail still runs, because it is a SEPARATE op in the program
    // and not something the destination implies.
    expect(types(events)).toContain("SHUFFLE");
  });

  it("the FORCED board puts nothing new in the record at all — the carrier door", () => {
    const { state } = attack(ready(HAND_IDS.slice(0, 3)), SHUFFLE);
    expect("cont" in state.phase).toBe(false);
    expect(JSON.stringify(state)).not.toContain('"to":"deck"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — VERSION AND BYTE PINS.
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 — the version moved with the behaviour", () => {
  it("engineVersion", () => {
    expect(engineVersion).toBe("0.431.0");
  });

  it("the op is PURE — the parked board is not mutated by resolving it", () => {
    const parked = deepFreeze(attack(ready(), SHUFFLE).state);
    const snapshot = JSON.stringify(parked);
    const picked = parkedPrompt(parked).candidates.slice(0, 3);
    answerWith(parked, "p2", picked);
    expect(JSON.stringify(parked)).toBe(snapshot);
  });
});
