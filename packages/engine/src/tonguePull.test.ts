import manifest from "../package.json" with { type: "json" };
import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion, programFor } from "./index";
import type { GameState, Seat } from "./index";
import type { EffectContext } from "./interpreter";
import { runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  handFromDeck,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";
import { BENCH_MAX, otherSeat } from "./types";

// D297 — "UP TO N" OUT OF THE OPPONENT'S REVEALED HAND, AND THE ROW THAT FOUR
// HANDOFFS PRICED AT THREE BLOCKERS AND HAS ONE AND A HALF.
//
// THE SENTENCE. *"Your opponent reveals their hand. Put up to 2 Basic Pokémon you
// find there onto your opponent's Bench."* — Lickitung, TWO Standard-legal
// printings, `sv05-124` and `sv05-180`, whose `attacks_json` is BYTE-IDENTICAL
// (remote D1 `luminous`, re-queried 2026-08-09 in one flat `WHERE id IN (…)`:
// both `legal_standard = 1`, both regulation mark **H**, both **Basic**, both
// carrying Tongue Pull at **attack index 0** with cost **{C}** and "Strength"
// {C}{C}{C} for 50 at index 1, and both blobs 236 bytes of identical text).
// ⚠️ **AND THAT IS THE WHOLE POPULATION OF THE PHRASE**: `instr(attacks_json,
// 'you find there onto your opponent') > 0` over all 3,786 rows returns exactly
// these two.
//
// ── WHAT WAS PRICED, AND WHAT THE BODIES ACTUALLY SAID ──────────────────────
//
// The row carried THREE named blockers into this slice. One was real, one was
// real for the wrong reason, and one had already evaporated:
//
//   · **THE COUNT.** Real. The park was hard-coded `min: 1, max: 1`, so "up to 2"
//     could not be expressed. → `bottomFromOpponentHand.upTo`.
//   · **THE INTERCHANGEABLE COLLAPSE.** Real, and 🛑 **THE DOUBT RAISED AGAINST IT
//     WAS THE THING THAT WAS WRONG.** The handoff flagged its own claim as most
//     likely mistaken — *"`cardIdentity` keys a Pokémon on the catalog `id`, so
//     two DIFFERENT Basics never collapsed and the cap may not be load-bearing at
//     all"* — and every word of the mechanism is TRUE while the conclusion is
//     FALSE. **DRIVEN, both boards, before a line was written** (the pair of tests
//     in §3 below): two DIFFERENT Basics offer 2 candidates with or without the
//     cap, and TWO COPIES OF ONE PRINTED BASIC offered exactly **1** — so the
//     second copy could never reach the Bench, and the same board ALSO tripped the
//     one-candidate auto-resolve and benched a card without asking. **THE CAP IS
//     LOAD-BEARING ON THE BOARD THE DOUBT DID NOT NAME.**
//   · **THE DECLINE.** Already there: `chooseCards` has carried `min: 0` since the
//     search family and four live sites print "up to" through it.
//
// 🛑 **THE ONE DESIGN CALL, AND IT IS THE SHARPEST LINE IN THE DIFF:** the
// `candidates.length === 1` AUTO-RESOLVE is now conditional on `upTo` being
// ABSENT. Under a printed "up to" the two answers are "a card moves" and "nothing
// moves", which are not the same state, so the M1 no-choice rule does not reach
// them and a lone candidate must still be ASKED.
//
// ⚠️ **AND NOTHING WENT RED WHEN THAT LINE CHANGED, WHICH IS CORRECT AND WAS
// FORECAST AS THE OPPOSITE.** The handoff wrote *"predict that deletion REDDENS an
// existing suite … if nothing goes red, you have made it conditional on the wrong
// thing."* The reasoning inverts: the five printings without `upTo` keep the
// shortcut BY CONSTRUCTION, so a correct conditional reddens nothing and only a
// DELETION would have. The three suites that did redden are the deriver census
// ones, and they reddened on the new anchor.
//
// ── WHAT THIS ROW COSTS ──────────────────────────────────────────────────────
//
// ONE optional op field (`upTo`), ONE regex, ONE deriver arm, ONE `cap` in the
// offer, ONE conditional on the auto-resolve and ONE printed note form. **NO new
// op, NO new prompt kind, NO new choice kind, NO new event, NO new error code, NO
// `GameState` field and NO registry row** — `packages/schema`, `redact.ts` and
// `src/` take ZERO for the FOURTH slice running, and because the row is
// DERIVER-ONLY, `raw.length` and the non-attack pool move by ZERO (D296's third
// rule).

const TONGUE_PULL_TEXT =
  "Your opponent reveals their hand. Put up to 2 Basic Pokémon you find there onto your opponent's Bench.";

/** The two printings as ONE fixture body, because the catalog blobs are one blob.
    ⚠️ THE HOST IS A BASIC AND ITS HP IS IRRELEVANT TO THE FILTER — the filter reads
    the cards in the OPPONENT's hand — but Lickitung is printed Basic and a fixture
    that quietly evolved it would make the attack unreachable for a reason nothing
    in this file is about. */
function lickitung(id: string): Card {
  return battler(id, {
    name: "Lickitung",
    hp: 90,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      { cost: ["Colorless"], name: "Tongue Pull", effect: TONGUE_PULL_TEXT },
      { cost: ["Colorless", "Colorless", "Colorless"], name: "Strength", damage: 50 },
    ],
  });
}

/** A Stage 1 in the opponent's HAND — the fixture pool's Evolutions are all in
    play or over the HP bar, and without one the `basicPokemon` filter's stage
    conjunct is never the reason anything is refused. */
function handStage1(id: string): Card {
  return { ...battler(id, { hp: 60, retreat: 1 }), stage: "Stage1", evolveFrom: "fix-basic-1" };
}

const LOCAL_CARDS: Record<string, Card> = {
  "sv05-124": lickitung("sv05-124"),
  "sv05-180": lickitung("sv05-180"),
  "pull-stage1": handStage1("pull-stage1"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The THIRTEENTH seeded deck (D270's rule: a seeded suite gets its OWN deck).
    `fix-victim` is stocked EIGHT deep because the whole cap argument needs two
    copies of ONE printed Basic in one hand, and `fix-basic-1` is a SECOND printed
    Basic so "two of one" and "one of two" are different boards here. */
const PULL_DECK = deckOf({
  "sv05-124": 4,
  "sv05-180": 4,
  "fix-victim": 8,
  "fix-basic-1": 12,
  "pull-stage1": 4,
  "fix-item": 4,
  "fix-energy": 24,
});

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: PULL_DECK, p2: PULL_DECK }, cardPool: POOL });
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

/** Every uid in the seat's hand goes back under their deck. */
function emptyHand(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, hand: [], deck: [...side.deck, ...side.hand] },
    },
  };
}

/** `seat` has Lickitung ACTIVE and one other body benched; the OPPONENT's hand
    holds exactly `hand` (an id/count table, because the point of this row is how
    many COPIES of one id sit there), and their Bench holds `benched`.
    ⚠️ THE ACTOR'S BENCH BODY IS LOAD-BEARING — §14.2 makes an empty Bench a LOSS
    the moment the Active leaves, and a `gameOver` board proves nothing. */
function board(
  seed: number,
  hand: readonly (readonly [string, number])[],
  benched: readonly string[] = [],
  activeId = "sv05-124",
): GameState {
  // p2 goes FIRST and ends their turn, so p1's attack is on turn 2 — §4 refuses a
  // going-first attack on turn 1 and the whole file drives the printed ATTACK.
  let state = localSetup(seed, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", activeId);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", "fix-basic-1");
  const victim = otherSeat("p1");
  state = clearBench(state, victim);
  for (const id of benched) state = benchFromDeck(state, victim, id);
  state = emptyHand(state, victim);
  for (const [id, n] of hand) state = handFromDeck(state, victim, id, n);
  return state;
}

/** `runProgram` with the two out-parameters this file does not want to thread —
    the OP-LEVEL driver, used where no printed card produces the op (the
    attribution controls in §2 and the without-cap arm in §3). `runProgram` hands
    back a `RunResult`; it does NOT install the phase, which `settleProgram` does
    for the action path below. */
function runOps(state: GameState, ops: readonly EffectOp[], seat: Seat) {
  const events: GameEvent[] = [];
  const ctx: EffectContext = { seat, sourceUid: state.players[seat].active?.stack[0] ?? "" };
  const out = runProgram(state, ops, ctx, events);
  return { out, events, state: out.state, parked: out.kind === "parked" };
}

/** The `chooseCards` prompt out of a `RunResult`, or a loud throw. */
function promptOf(run: ReturnType<typeof runOps>) {
  if (run.out.kind !== "parked" || run.out.prompt.kind !== "chooseCards") {
    throw new Error(`expected a chooseCards park, got ${run.out.kind}`);
  }
  return run.out.prompt;
}

/** The parked `chooseCards` prompt on a real PHASE, or a loud throw. */
function cardsPrompt(state: GameState) {
  const phase = state.phase;
  if (phase.kind !== "effect:choose" || phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected a chooseCards park, got ${phase.kind}`);
  }
  return phase.prompt;
}

/** A board with Lickitung Active, ONE {C} attached and Tongue Pull DECLARED —
    the phase is whatever the printed attack left behind (a park, or the turn
    again when the offer was empty). Every behavioural test below drives THIS,
    because the op under test is the one the DERIVER built off the card text. */
function pull(
  seed: number,
  hand: readonly (readonly [string, number])[],
  benched: readonly string[] = [],
  activeId = "sv05-124",
): GameState {
  const state = board(seed, hand, benched, activeId);
  // {C} — one Energy of any type pays the printed cost.
  const paid = attachFromDeck(state, "p1", "fix-energy", 1);
  return mustApply(paid, { type: "attack", seat: "p1", index: 0 }).state;
}

function benchIds(state: GameState, seat: Seat): string[] {
  return state.players[seat].bench.map(
    (p) => state.cardIdByUid[p.stack[p.stack.length - 1] ?? ""] ?? "?",
  );
}

/** The op the DERIVER produces for the printed sentence — used as the subject of
    every behavioural test below, so the two halves of the row cannot drift. */
const TONGUE_PULL_OPS: readonly EffectOp[] = [
  { op: "bottomFromOpponentHand", filter: { kind: "basicPokemon" }, dest: "bench", upTo: 2 },
];

const SEEDS = [7, 19, 52, 88, 101] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE DERIVER — one anchor, one sentence, two printings.
// ─────────────────────────────────────────────────────────────────────────────

describe("D297 — the printed sentence, as ops", () => {
  it("derives to ONE op with `upTo: 2`, a bare `basicPokemon` filter and the bench dest", () => {
    expect(deriveAttackEffect(TONGUE_PULL_TEXT)).toEqual(TONGUE_PULL_OPS);
  });

  it("🛑 NO `maxHp` RIDER — Mandibuzz's 70 is Mandibuzz's word, not this sentence's", () => {
    // D135: an absent field means what the sentence means. The two cards share an
    // op, a destination and a source zone and differ in exactly this, so a filter
    // copied across would silently refuse every Basic over 70 HP that Lickitung
    // plainly reaches.
    const ops = deriveAttackEffect(TONGUE_PULL_TEXT);
    const first = ops?.[0];
    if (first === undefined || first.op !== "bottomFromOpponentHand") throw new Error("no op");
    expect(first.filter).toEqual({ kind: "basicPokemon" });
    expect(first.filter?.kind === "basicPokemon" ? first.filter.maxHp : "n/a").toBeUndefined();
  });

  it("BOTH catalog printings carry the SAME text, so ONE anchor reads both", () => {
    for (const id of ["sv05-124", "sv05-180"]) {
      const attacks = POOL[id]?.attacks ?? [];
      expect(attacks[0]?.name, id).toBe("Tongue Pull");
      expect(attacks[0]?.effect, id).toBe(TONGUE_PULL_TEXT);
      // The printed cost and index, re-queried rather than assumed: the handoff
      // before last predicted "NOT index 0" and was wrong.
      expect(attacks[0]?.cost, id).toEqual(["Colorless"]);
      expect(attacks[1]?.name, id).toBe("Strength");
      expect(deriveAttackEffect(attacks[0]?.effect ?? ""), id).toEqual(TONGUE_PULL_OPS);
    }
  });

  it("🛑 authors NO registry row — the column moves by a DERIVER arm alone", () => {
    // D296's third rule, asserted rather than promised: a deriver-only row writes
    // no registry entry, so `raw.length` and the non-attack pool move by ZERO.
    for (const id of ["sv05-124", "sv05-180"]) {
      expect(programFor(id), id).toBeUndefined();
    }
  });

  it("reads the U+2019 spelling identically — and NO printing of it exists", () => {
    // D137's class, and the reason the anchor spells `['’]`. The catalog sweep
    // returns zero curly rows for this sentence, so the witness is CONSTRUCTED and
    // labelled as such (D228/D231).
    const curly = TONGUE_PULL_TEXT.replaceAll("'", "’");
    expect(curly).not.toBe(TONGUE_PULL_TEXT);
    expect(deriveAttackEffect(curly)).toEqual(TONGUE_PULL_OPS);
  });

  it("anchors WHOLE — a leading or trailing clause is refused, both directions", () => {
    expect(deriveAttackEffect(`If heads, ${TONGUE_PULL_TEXT}`)).toBeNull();
    expect(deriveAttackEffect(`${TONGUE_PULL_TEXT} Draw a card.`)).toBeNull();
  });

  it("🛑 the printed number is a CAPTURE with a guard, not a welded 2", () => {
    // Both ends of the guard, and the guard's ceiling is the BENCH's (§4) rather
    // than the attach family's 10 — this number sizes a Bench.
    for (const n of [1, 2, 3, BENCH_MAX]) {
      const text = TONGUE_PULL_TEXT.replace("up to 2", `up to ${n}`);
      expect(deriveAttackEffect(text), `up to ${n}`).toEqual([
        { op: "bottomFromOpponentHand", filter: { kind: "basicPokemon" }, dest: "bench", upTo: n },
      ]);
    }
    // A printed 0 would derive to a park nobody can answer; a printed 6 asks for
    // more bodies than a Bench holds. Both land on the loud skipped path.
    expect(deriveAttackEffect(TONGUE_PULL_TEXT.replace("up to 2", "up to 0"))).toBeNull();
    expect(
      deriveAttackEffect(TONGUE_PULL_TEXT.replace("up to 2", `up to ${BENCH_MAX + 1}`)),
    ).toBeNull();
  });

  it("🛑 the NEIGHBOURING sentence in the same family is still a DIFFERENT anchor", () => {
    // The punctuation argument, driven: Ortega/Purrloin's joined clause and this
    // one are two patterns, and neither reads the other's string.
    const joined =
      "Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck.";
    expect(deriveAttackEffect(joined)).toEqual([{ op: "bottomFromOpponentHand" }]);
    // The imperative form with the OTHER family's destination is nobody's sentence.
    expect(
      deriveAttackEffect("Your opponent reveals their hand. Put up to 2 Basic Pokémon you find there onto your Bench."),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE ATTRIBUTION CONTROL — the unmarked op still means what it meant.
// ─────────────────────────────────────────────────────────────────────────────

describe("the ABSENT `upTo` is the M5 op, unchanged in every respect", () => {
  it("🛑 a lone candidate with NO `upTo` still AUTO-RESOLVES — the shortcut survives", () => {
    // The half of the conditional that must not move: five legal printings print a
    // compulsory single pick, and one candidate there really is no decision.
    const state = board(SEEDS[0], [["fix-victim", 1]]);
    const out = runOps(state, [{ op: "bottomFromOpponentHand" }], "p1");
    expect(out.parked).toBe(false);
    expect(out.state.players.p2.hand).toEqual([]);
    expect(out.events.some((e) => e.type === "CARD_TO_BOTTOM_OF_DECK")).toBe(true);
  });

  it("🛑 and its park is still `min: 1, max: 1` when two classes are offered", () => {
    const state = board(SEEDS[1], [
      ["fix-victim", 1],
      ["fix-basic-1", 1],
    ]);
    const run = runOps(state, [{ op: "bottomFromOpponentHand" }], "p1");
    expect(run.parked).toBe(true);
    const prompt = promptOf(run);
    expect([prompt.min, prompt.max]).toEqual([1, 1]);
  });

  it("`dest: \"bench\"` with NO `upTo` is D294's Mandibuzz, byte for byte", () => {
    const state = board(SEEDS[2], [["fix-victim", 1]]);
    const out = runOps(state, [{ op: "bottomFromOpponentHand", dest: "bench" }], "p1");
    expect(out.parked).toBe(false);
    expect(benchIds(out.state, "p2")).toEqual(["fix-victim"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE CAP — the flagged doubt, DRIVEN on BOTH boards.
// ─────────────────────────────────────────────────────────────────────────────

describe("the interchangeable collapse, on the board the doubt did not name", () => {
  it("🛑 TWO COPIES OF ONE PRINTED BASIC offer TWO candidates under `upTo: 2`", () => {
    // THE WHOLE ARGUMENT. Before this slice the same board offered ONE — measured,
    // not inferred — because `cardIdentity` keys a Pokémon on its catalog `id` and
    // both copies wear the same key. A hand of two Ralts is an ordinary hand.
    const state = pull(SEEDS[0], [["fix-victim", 2]]);
    const prompt = cardsPrompt(state);
    expect(prompt.candidates).toHaveLength(2);
    expect(prompt.candidates.map((u) => state.cardIdByUid[u])).toEqual(["fix-victim", "fix-victim"]);
  });

  it("🛑 and BOTH of them can actually land — the second copy is reachable", () => {
    const state = pull(SEEDS[0], [["fix-victim", 2]]);
    const uids = cardsPrompt(state).candidates;
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [...uids] },
    }).state;
    expect(benchIds(done, "p2")).toEqual(["fix-victim", "fix-victim"]);
    // ⚠️ The hand is not EMPTY — resolving ends the turn and p2 draws — so the
    // assertion is on the UIDS that left, which is the fact this test is about.
    for (const uid of uids) expect(done.players.p2.hand).not.toContain(uid);
  });

  it("⚠️ TWO DIFFERENT BASICS offer two candidates WITH OR WITHOUT the cap — the fixture the doubt used shows NOTHING", () => {
    // The control that makes the test above worth writing. This is the board the
    // handoff reasoned from, and on it the cap is genuinely invisible: the classes
    // differ, so nothing was ever collapsed. A slice that priced the cap off this
    // fixture alone would have concluded it was dead code.
    const twoKinds = [
      ["fix-victim", 1],
      ["fix-basic-1", 1],
    ] as const;
    const withCap = pull(SEEDS[1], twoKinds);
    const withoutCap = runOps(
      board(SEEDS[1], twoKinds),
      [{ op: "bottomFromOpponentHand", filter: { kind: "basicPokemon" }, dest: "bench" }],
      "p1",
    );
    expect(cardsPrompt(withCap).candidates).toHaveLength(2);
    expect(promptOf(withoutCap).candidates).toHaveLength(2);
  });

  it("the cap is `upTo` and NOT unbounded — THREE copies still offer only TWO", () => {
    // `interchangeableCandidates`' rule exactly: keep as many as the pick could
    // possibly want, and no more. A third identical copy is a third spelling of an
    // answer already on the table.
    const state = pull(SEEDS[2], [["fix-victim", 3]]);
    expect(cardsPrompt(state).candidates).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE DECLINE — "up to" means the controller may say no.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed \"up to\" is declinable, and a LONE candidate is still asked", () => {
  it("🛑 ONE candidate under `upTo` PARKS — the auto-resolve does not fire", () => {
    // The sharpest line in the diff. Under the old arm this board resolved inline
    // and put a Basic on the opponent's Bench with nobody asked.
    const state = pull(SEEDS[3], [["fix-victim", 1]]);
    const prompt = cardsPrompt(state);
    expect(prompt.candidates).toHaveLength(1);
    expect(prompt.min).toBe(0);
  });

  it("🛑 and answering with NO cards leaves the board untouched", () => {
    const state = pull(SEEDS[3], [["fix-victim", 1]]);
    const offered = cardsPrompt(state).candidates[0];
    if (offered === undefined) throw new Error("empty offer");
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    }).state;
    expect(done.players.p2.bench).toEqual([]);
    // The declined card is STILL IN HAND — the whole point of a decline, and the
    // assertion is on the uid rather than the count because the turn ends here and
    // p2 draws for it.
    expect(done.players.p2.hand).toContain(offered);
  });

  it("taking ONE of two offered is a legal answer too — `min: 0`, `max: 2`", () => {
    const state = pull(SEEDS[4], [
      ["fix-victim", 1],
      ["fix-basic-1", 1],
    ]);
    const prompt = cardsPrompt(state);
    expect([prompt.min, prompt.max]).toEqual([0, 2]);
    const first = prompt.candidates[0];
    if (first === undefined) throw new Error("empty offer");
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [first] },
    }).state;
    expect(done.players.p2.bench).toHaveLength(1);
    expect(done.players.p2.hand).not.toContain(first);
    const other = prompt.candidates[1];
    if (other === undefined) throw new Error("expected two candidates");
    expect(done.players.p2.hand).toContain(other);
  });

  it("an EMPTY match still whiffs silently — the reveal happened, the pick did not", () => {
    // A hand with no Basic at all: the reveal rides the action, the offer is empty
    // and there is nothing to decline. The whiff is NOT the decline.
    const state = pull(SEEDS[0], [
      ["fix-item", 2],
      ["pull-stage1", 1],
    ]);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p2.bench).toEqual([]);
    // Nothing left the hand. (The count is 4, not 3: the attack ended the turn and
    // p2 drew — which is exactly why every hand assertion in this file names uids.)
    expect(
      state.players.p2.hand.filter((u) => state.cardIdByUid[u] === "fix-item"),
    ).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE FILTER and THE BENCH CEILING.
// ─────────────────────────────────────────────────────────────────────────────

describe("the filter reads the OPPONENT's hand, and the Bench caps the ask", () => {
  it("a Stage 1 in hand is refused by the STAGE — the noun is 'Basic Pokémon'", () => {
    const state = pull(SEEDS[1], [
      ["pull-stage1", 1],
      ["fix-victim", 1],
    ]);
    expect(cardsPrompt(state).candidates.map((u) => state.cardIdByUid[u])).toEqual(["fix-victim"]);
  });

  it("🛑 a bench with ONE slot left asks for at most ONE, not two", () => {
    // searchDeck's and discardPileRetrieval's clamp, taken at the same place and
    // for the same reason: never ask a question whose second answer cannot land.
    const benched = ["fix-basic-1", "fix-basic-1", "fix-basic-1", "fix-basic-1"];
    const state = pull(SEEDS[2], [["fix-victim", 2]], benched);
    expect(state.players.p2.bench).toHaveLength(BENCH_MAX - 1);
    const prompt = cardsPrompt(state);
    expect(prompt.max).toBe(1);
    expect(prompt.min).toBe(0);
  });

  it("a FULL opponent bench offers nothing at all — D294's whiff, unchanged", () => {
    const full = ["fix-basic-1", "fix-basic-1", "fix-basic-1", "fix-basic-1", "fix-basic-1"];
    const state = pull(SEEDS[3], [["fix-victim", 2]], full);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p2.bench).toHaveLength(BENCH_MAX);
    expect(
      state.players.p2.hand.filter((u) => state.cardIdByUid[u] === "fix-victim").length,
    ).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE PROMPT NOTE — a round trip to the printed text.
// ─────────────────────────────────────────────────────────────────────────────

describe("the prompt note is the CARD's sentence, character for character", () => {
  it("🛑 the note round-trips to the catalog string", () => {
    // The check `effects.ts` cannot run and this file can: the note is built from
    // the op's fields and the filter's PLURAL noun, and it lands exactly on the
    // text the anchor above matches. A drift in either would show up here.
    const state = pull(SEEDS[4], [["fix-victim", 2]]);
    expect(cardsPrompt(state).note).toBe(TONGUE_PULL_TEXT);
  });

  it("and the unmarked op's note is still Mandibuzz's SINGULAR joined clause", () => {
    const state = board(SEEDS[4], [
      ["fix-victim", 1],
      ["fix-basic-1", 1],
    ]);
    const run = runOps(
      state,
      [{ op: "bottomFromOpponentHand", filter: { kind: "basicPokemon" }, dest: "bench" }],
      "p1",
    );
    expect(promptOf(run).note).toBe(
      "Your opponent reveals their hand, and you put a Basic Pokémon you find there onto your opponent's Bench.",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. END TO END — the printed attack, declared and paid for.
// ─────────────────────────────────────────────────────────────────────────────

describe("Tongue Pull as an ATTACK, from the action down", () => {
  it("🛑 the attack at INDEX 0 parks the choose — {C} is the whole cost", () => {
    const prompt = cardsPrompt(pull(SEEDS[0], [["fix-victim", 2]]));
    expect(prompt.candidates).toHaveLength(2);
    expect([prompt.min, prompt.max]).toEqual([0, 2]);
    expect(prompt.dest).toBe("bench");
  });

  it("resolving it benches BOTH copies on the OPPONENT's side of the table", () => {
    const parked = pull(SEEDS[0], [["fix-victim", 2]]);
    const uids = cardsPrompt(parked).candidates;
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [...uids] },
    }).state;
    expect(benchIds(done, "p2")).toEqual(["fix-victim", "fix-victim"]);
    // The ACTOR's own bench is untouched — the destination crosses a seat, which
    // is the one thing about this op a reader of its NAME cannot know.
    expect(benchIds(done, "p1")).toEqual(["fix-basic-1"]);
  });

  it("the SECOND printing plays identically — one sentence, two ids", () => {
    // The reprint is not a second authoring, and here it is not even a second
    // registry object: both ids reach the same anchor through their own text.
    const a = cardsPrompt(pull(SEEDS[1], [["fix-victim", 2]], [], "sv05-124"));
    const b = cardsPrompt(pull(SEEDS[1], [["fix-victim", 2]], [], "sv05-180"));
    expect(b.note).toBe(a.note);
    expect(b.candidates).toHaveLength(a.candidates.length);
    expect([b.min, b.max]).toEqual([a.min, a.max]);
  });

  it("🛑 the SECOND attack on the same body is plain damage — index 1 is untouched", () => {
    // `Strength` costs {C}{C}{C} and prints no effect, so it cannot reach this
    // row's code at all. Asserted off the fixture rather than the engine, because
    // the point is that the printed body carries TWO attacks and only one is ours.
    const attacks = POOL["sv05-124"]?.attacks ?? [];
    expect(attacks).toHaveLength(2);
    expect(attacks[1]?.effect).toBeUndefined();
    expect(attacks[1]?.damage).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. MATCH_RECORD_VERSION — the NO-BUMP, driven in BOTH directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("MATCH_RECORD_VERSION stays 16 — and it is DRIVEN, not asserted", () => {
  function parked(): GameState {
    return pull(SEEDS[0], [["fix-victim", 2]]);
  }

  it("🛑 the persisted continuation's op carries EXACTLY these keys", () => {
    // THE LITERAL KEY ANCHOR (D279's pairing rule): a diff between two boards from
    // ONE build is blind to "every op grew a key", because the key sits on both
    // sides. This names them, and the list has grown by exactly ONE (`upTo`)
    // against D294's `["dest", "filter", "op"]`.
    const phase = parked().phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const revived = JSON.parse(JSON.stringify(phase)) as {
      cont: { pendingOp: EffectOp; rest: EffectOp[] };
    };
    expect(Object.keys(revived.cont.pendingOp).sort()).toEqual(["dest", "filter", "op", "upTo"]);
    expect(revived.cont.rest).toEqual([]);
  });

  it("🛑 FORWARD: a version-16 record with NO `upTo` replays as the mandatory single pick", () => {
    // The direction the repo's rule actually tests — "can the PREVIOUS deploy's
    // RECORD hold the new TYPE". An old continuation has no `upTo`; this build
    // reads `undefined`; `undefined` IS the exactly-one compulsory pick the old
    // record was written under, auto-resolve and all.
    const state = board(SEEDS[1], [["fix-victim", 2]]);
    const run = runOps(state, [{ op: "bottomFromOpponentHand", dest: "bench" }], "p1");
    expect(run.parked).toBe(false);
    expect(run.state.players.p2.bench).toHaveLength(1);
    expect(run.state.players.p2.hand).toHaveLength(1);
  });

  it("🛑 BACKWARD: the parked prompt round-trips through JSON unchanged", () => {
    const before = parked();
    const revived = JSON.parse(JSON.stringify(before)) as GameState;
    expect(revived.phase).toEqual(before.phase);
    const uids = cardsPrompt(revived).candidates;
    const done = mustApply(revived, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [...uids] },
    }).state;
    expect(done.players.p2.bench).toHaveLength(2);
  });

  it("no `GameState` field, no new `GameEvent` TYPE, no new error code", () => {
    // What moved: ONE optional field on ONE existing op, which an old continuation
    // cannot carry and does not need. The prompt shape is unchanged — `min`/`max`
    // have been on `chooseCards` since the search family.
    const state = pull(SEEDS[0], [["fix-victim", 2]]);
    const keys = Object.keys(state).sort();
    expect(keys).toContain("phase");
    expect(keys).not.toContain("benchPuts");
    const prompt = cardsPrompt(state);
    expect(Object.keys(prompt).sort()).toEqual(["candidates", "dest", "kind", "max", "min", "note"]);
  });
});

describe("the engine version", () => {
  it("moved PAST 0.207.0 with the new op field, and the two files agree", () => {
    // BEHAVIOUR moved inside `packages/engine` (an op field, an anchor, a deriver
    // arm, a park's bounds and the note), so the number moves. The manifest and
    // the exported constant are asserted TOGETHER — the tie IS the assertion, and
    // either drifting alone is the defect (D275). 🛑 THIS FILE NOW OWNS THE
    // LITERAL; `aquaWash.test.ts` kept the tie and the direction when it handed it
    // over, which is the same handoff it received from `chillTeaserToy.test.ts`.
    // 🆕 D298 moved it again (0.208.0 → 0.209.0), so this suite now asserts the
    // TIE and the DIRECTION rather than re-stating a literal that belongs to
    // whichever slice bumped it last. `legacyEnergy.test.ts` carries the literal —
    // the same hand-off this file received from `aquaWash.test.ts`.
    expect(manifest.version).toBe(engineVersion);
    expect(manifest.version).not.toBe("0.207.0");
    expect(manifest.version).not.toBe("0.208.0");
  });
});
