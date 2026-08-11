import { describe, expect, it } from "vitest";
import type { BoardCondition } from "./effects";
import { cardOfUid } from "./cards";
import { applyAction, programFor } from "./index";
import { registryCardIds } from "./registry";
import type { GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  deckOf,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  walkProgram,
} from "./testFixtures";

// D280 — THE `BoardCondition` COMBINATOR (`allOf`), THE `youGoSecond` LEAF, AND
// CALL BELL — THE ONE STANDARD-LEGAL PRINTING THAT SPENDS BOTH.
//
// "You can use this card only if you go second, and only during your first turn.
//
//  Search your deck for a Supporter card, reveal it, and put it into your hand.
//  Then, shuffle your deck."                                (Item, `sv08-165`)
//
// 🛑 **THE CENSUS THIS SLICE CAME OUT OF, AND WHAT IT DID *NOT* FIND.** Remote D1
// `luminous` (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`), 2026-08-08, all THREE text
// columns, the six going-order spellings ("go/goes/went first/second"), pool-wide
// and then at `legal_standard = 1`:
//
//   **24 legal printings on 9 names** (31 rows pool-wide; the 7 rotated are
//   Bombirdier ex ×2, Cryogonal, Parasol Lady ×3, Spearow). And they are NOT one
//   family — they are SIX printed shapes on two polarities:
//
//   | printed shape                                              | n  | verdict          |
//   |------------------------------------------------------------|----|------------------|
//   | "If you go first, you may use this card during your first…" | 6  | BUILT (D223/224) |
//   | "If you go first, this Pokémon can use attacks during…"     | 3  | BUILT (D277)     |
//   | "If you go first, you can use this attack during…"          | 3  | per-INDEX, unbuilt|
//   | "…only if you go second, and only during your first turn."  | 5  | THIS SLICE ×1    |
//   | "If you go second, you can't use this attack during…"       | 7  | per-INDEX, unbuilt|
//
//   6 + 3 + 3 + 5 + 7 = **24**. ⚠️ **THE INHERITED "12 LEGAL PRINTINGS" FOR THIS
//   ROW REPRODUCES EXACTLY — BUT ONLY AS THE *UNBUILT* SUBSET, AND IT IS NOT ONE
//   MECHANISM.** 24 legal − 9 already built (Carmine ×4, Team Rocket's Proton ×2,
//   Meloetta ex ×3) − 3 booked to the separate per-attack-index row (Volbeat,
//   Exeggcute ×2) = **12**: Terapagos ex ×7, Illumise, Scream Tail ex ×2, Call
//   Bell, Chill Teaser Toy. The COUNT held and the COMPOSITION split — 5 positive
//   conjunctions against 7 NEGATED ones.
//
// 🛑 **EVERY "IF YOU GO FIRST" PRINTING IN THE POOL IS A §4-BAN LICENCE WHOSE
// CLAUSE IS DESCRIPTIVE**, which is why `youGoSecond` is a BARE TAG and not a
// parameterised `{ order }`. Turn 1 is the going-first player's turn by
// construction, so the going-second seat can never reach the bans those 12
// sentences lift, and D223/D277 both recorded that argument before this slice
// arrived. An `order: "first"` value would be a value the pool cannot ask for.
//
// 🛑 **AND THE ELEVEN REFUSALS ARE NAMED, EACH WITH THE MECHANISM IT WANTS.**
//   • ✅ Chill Teaser Toy `sv08-166` — the SAME gate, the same `allOf`, and it was
//     refused on its BODY: *"Put an Energy attached to 1 of your opponent's
//     Pokémon into their hand."* 🆕 **BUILT AT D295** as one optional field,
//     `discardEnergy.to = "hand"` — and D280's typed blocker turned out to be the
//     build order: it said *"`discardEnergy` discards"*, and the fix was to let
//     that op say where. ⚠️ **D280 CALLED THIS "THE HONEST COST OF THE SLICE" —
//     the combinator reached 2 printings and only 1 could be played. IT NOW
//     REACHES 2 AND BOTH PLAY**, and the combinator itself did not move a byte:
//     a partial build priced as a board fact is a work item somebody can finish.
//   • Illumise `sv06-010`, Scream Tail ex `sv06-094`/`-197` — the same printed
//     conjunction, on *"this **attack**"*. `cantAttackUnless` is a PER-BODY field
//     and all three bodies carry **TWO** attacks (measured, not assumed:
//     `json_array_length(attacks_json)` = 2 on each), so it would gate the wrong
//     one. D277 priced the per-INDEX field and it is still not built.
//   • Terapagos ex `sv07-128`/`-170`/`-173`/`sv08.5-092`/`-169`/`-180`/`svp-165`
//     — *"If you go second, you **can't** use this attack during your first
//     turn."* Two attacks likewise, and the polarity is NEGATIVE: it wants a
//     per-index BAN, the mirror of Volbeat's per-index licence.
//
// ⚠️ WHAT THIS SUITE CAN PUT RED, SAID UP FRONT (the guard rule, conventions.md):
// * Building `youGoSecond` as `isFirstTurnOf` / `state.turn === 2` fails the
//   SEAT-ASSIGNMENT sweep, which asks the predicate on turns 1-6 from BOTH seats
//   under BOTH assignments — 24 answers, of which the two builds agree on 2.
// * Folding `allOf` with `.some` instead of `.every` fails the two one-conjunct-
//   only boards (turn 1 as the going-FIRST seat; turn 4 as the going-second seat).
// * Dropping EITHER conjunct from the registry row fails one of those same two.
// * Dropping the gate entirely fails both, plus the reject-message test.
// * `conditionNote` joining with anything but " and " fails the exact-string test,
//   which asserts the JOINED sentence and not the two halves.
// * Dropping the HUD mirror fails the wire row-lighting test, which reads the same
//   `redactGame` call that lights the CONTROL Item on the very same board.

/** The one Standard-legal printing, measured against the remote D1 `luminous`
    on 2026-08-08: `legal_standard = 1`, `trainer_type = 'Item'`, and **no
    reprint** — the whole going-order census returned this id once. */
const CALL_BELL_ID = "sv08-165";

/** The printed effect, byte for byte — authored against the print rather than a
    paraphrase (D183's class). The blank line between the sentences is the
    catalog's own `\n\n`. */
const CALL_BELL_TEXT =
  "You can use this card only if you go second, and only during your first turn.\n\nSearch your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck.";

/** The two printed conjuncts, as the registry authors them. */
const CALL_BELL_GATE: BoardCondition = {
  kind: "allOf",
  conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }],
};

/** ⚠️ **A DECK WITH A CONTROL ITEM IN IT.** `fix-callbell` prints the gate; the
    control is `sv01-172` (Energy Search, *"Search your deck for a Basic Energy
    card, reveal it, and put it into your hand"*) — an ITEM that prints NO gate and
    is playable on every board below, because the deck is deep in Basic Energy and
    `programPlayable`'s would-only-whiff gate therefore never fires. It shares
    every board with Call Bell, so a suite that passed by the play gate having been
    deleted would light the wrong row, and one that passed by ALL Items being dead
    would fail the control. Nemona (`sv01-180`) is the Supporter the printed search
    is meant to find, and the rest of the deck is deliberately NOT a Supporter — the
    candidate list is the filter's unit test. Deep on `fix-bigbody` so setup never
    mulligans at an arbitrary seed. */
const CALL_BELL_DECK = deckOf({
  "fix-callbell": 4,
  "sv01-172": 4, // Energy Search — the ungated Item, the CONTROL
  "sv01-180": 4, // Nemona — the Supporter the search is printed to find
  "fix-bigbody": 20,
  "fix-energy": 28,
});

const decks = { p1: CALL_BELL_DECK, p2: CALL_BELL_DECK };

/** Setup with `first` going first. Turn 1 is `first`'s own first turn. */
function turnOne(seed: number, first: Seat): GameState {
  return driveSetup(seed, decks, { first });
}

/** Walk the clock `n` turns from `state`, passing each time — fanCall.test.ts's
    `passTurns` idiom, because every claim this suite makes is per-SEAT and
    per-TURN and a one-turn board is vacuous on both. */
function passTurns(state: GameState, n: number): GameState {
  let next = state;
  for (let i = 0; i < n; i++) {
    const seat = next.turn % 2 === 1 ? next.firstPlayer : otherOf(next.firstPlayer);
    if (seat === null) throw new Error("no first player");
    next = mustApply(next, { type: "endTurn", seat }).state;
  }
  return next;
}

function otherOf(seat: Seat | null): Seat | null {
  return seat === null ? null : seat === "p1" ? "p2" : "p1";
}

function play(state: GameState, seat: Seat, uid: string) {
  return applyAction(state, { type: "playTrainer", seat, uid });
}

/** The wire trainer row for `cardId` in the acting viewer's turn:action phase —
    the ONLINE HUD's row-lighting, read through the engine's own redactor. */
function wireRow(state: GameState, seat: Seat, cardId: string) {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.trainers.find((t) => t.name === cardId);
}

describe("D280 — the registry row", () => {
  it("maps the ONE Standard-legal printing, plus the demonstrator, to ONE object", () => {
    const program = programFor(CALL_BELL_ID);
    expect(program, `${CALL_BELL_ID} has no program`).toBeDefined();
    expect(programFor("fix-callbell"), "the demonstrator is not Call Bell").toBe(program);
    // ⚠️ AND IT IS NOT A REPRINT FAMILY — the census returned this id once, so a
    // second id appearing here later is a claim about the catalog and needs its
    // own query. (D279's lesson from the other direction: a reprint idiom applied
    // where the pool prints TWO sentences ships a self-satisfying gate.)
    // 🆕 D295 — Chill Teaser Toy `sv08-166` is now BUILT, and the assertion is
    // REWRITTEN rather than deleted: the claim this line always carried is "not
    // an alias of Call Bell", and that claim is still true and now stronger,
    // because the two programs exist SIDE BY SIDE with the SAME gate and
    // DIFFERENT bodies. A `toBeUndefined()` could only ever say "absent"; this
    // says "present and distinct", which is what the original sentence meant.
    const chill = programFor("sv08-166");
    expect(chill, "Chill Teaser Toy is BUILT at D295").toBeDefined();
    expect(chill, "…and it is NOT aliased to Call Bell").not.toBe(program);
    expect(chill?.trainer, "…its body is its own").not.toEqual(program?.trainer);
    // The GATE, though, is shared byte-for-byte — the combinator's SECOND
    // consumer, which is the fact D280 wrote this row hoping for.
    expect(chill?.trainerPlayableIf).toEqual(program?.trainerPlayableIf);
  });

  it("authors BOTH printed sentences — the allOf gate and the search-then-shuffle", () => {
    const program = programFor(CALL_BELL_ID);
    expect(program?.trainerPlayableIf).toEqual(CALL_BELL_GATE);
    expect(program?.trainer).toEqual([
      { op: "searchDeck", filter: { kind: "supporter" }, dest: "hand", max: 1, reveal: true },
      { op: "shuffleDeck" },
    ]);
    // …and nothing else. ⚠️ `trainerFirstTurnExempt` here would be the natural
    // over-reach — the card's first sentence NAMES a first turn — and it would be
    // wrong twice over: §4's ban is on SUPPORTERS and Call Bell is an Item, and the
    // turn it licenses is the going-FIRST player's.
    expect(Object.keys(program ?? {}).sort()).toEqual(["trainer", "trainerPlayableIf"]);
  });

  it("carries the printed BYTES on the demonstrator, so the gate is checkable in-file", () => {
    // D183's class: an arm authored from a paraphrase passes a test written
    // against the same paraphrase and matches no real card.
    expect(FIXTURE_POOL["fix-callbell"]?.effect).toBe(CALL_BELL_TEXT);
    expect(FIXTURE_POOL["fix-callbell"]?.trainerType).toBe("Item");
  });

  it("gives the allOf gate to the card that PRINTS it, and to nothing else", () => {
    // The population that may carry the combinator is the population that prints
    // a conjunction. Fighting Au Lait is the CONTROL: the other `trainerPlayableIf`
    // card, whose gate is a single bare member and must stay one.
    const gated = ["sv08-165", "fix-callbell"];
    for (const id of gated) {
      expect(programFor(id)?.trainerPlayableIf?.kind, id).toBe("allOf");
    }
    expect(programFor("sv02-181")?.trainerPlayableIf).toEqual({ kind: "morePrizesThanOpponent" });
    expect(programFor("sv01-172")?.trainerPlayableIf, "Energy Search prints no gate").toBeUndefined();
  });
});

describe("D280 — `youGoSecond` is a SEAT ASSIGNMENT, not a turn", () => {
  // 🛑 THE SWEEP THAT SEPARATES THE TWO BUILDS. `isFirstTurnOf` and
  // `state.turn === 2` both AGREE with the right answer on the ONE board Call
  // Bell is played on, which is why a wrong build is green on every natural
  // "the card works" assertion. Asked from BOTH seats on SIX turns under BOTH
  // assignments, they disagree everywhere else.
  const COND: BoardCondition = { kind: "youGoSecond" };

  for (const first of ["p1", "p2"] as const) {
    it(`answers per SEAT and never per turn — ${first} goes first`, () => {
      let state = turnOne(7, first);
      const second = otherOf(first) as Seat;
      for (let turn = 1; turn <= 6; turn++) {
        expect(state.turn, "the clock walked").toBe(turn);
        // The going-SECOND seat: true on every single turn, first to last.
        expect(conditionHolds(state, second, COND), `${second}@${turn}`).toBe(true);
        // The going-FIRST seat: false on every single turn.
        expect(conditionHolds(state, first, COND), `${first}@${turn}`).toBe(false);
        state = passTurns(state, 1);
      }
    });
  }

  it("is FALSE for both seats before the flip is resolved — `firstPlayer` is null", () => {
    // ⚠️ THE GUARD THAT IS EASY TO DROP: `state.firstPlayer !== seat` alone reads
    // TRUE for BOTH seats when `firstPlayer` is null, because `null !== "p1"` and
    // `null !== "p2"` are both true. Before the flip nobody goes second.
    const preFlip = { ...turnOne(7, "p1"), firstPlayer: null } as GameState;
    expect(conditionHolds(preFlip, "p1", COND)).toBe(false);
    expect(conditionHolds(preFlip, "p2", COND)).toBe(false);
  });

  it("is NOT `yourFirstTurn`, and the two DISAGREE on half of 12 sampled boards", () => {
    // The measurement behind the doc block's claim, made rather than asserted.
    let state = turnOne(3, "p1");
    let agree = 0;
    let total = 0;
    for (let turn = 1; turn <= 6; turn++) {
      for (const seat of ["p1", "p2"] as const) {
        total++;
        const a = conditionHolds(state, seat, COND);
        const b = conditionHolds(state, seat, { kind: "yourFirstTurn" });
        if (a === b) agree++;
      }
      state = passTurns(state, 1);
    }
    expect(total).toBe(12);
    // 🛑 THE NUMBER, NOT "they differ somewhere" — a `toBeGreaterThan(0)` here
    // would stay green on a build where they differed on ONE board, which is
    // exactly what `state.turn === 2` would give. The arithmetic, spelled out so
    // a future reader can re-derive it rather than trust it: p1 (went first) has
    // `youGoSecond` FALSE on all 6 turns and `yourFirstTurn` TRUE only on turn 1,
    // so they agree on turns 2-6 = **5**; p2 has `youGoSecond` TRUE on all 6 and
    // `yourFirstTurn` TRUE only on turn 2, so they agree on turn 2 = **1**.
    // 5 + 1 = **6 of 12**, and the SIX disagreements are the boards a build that
    // confused the two would get wrong.
    expect(agree).toBe(6);
  });
});

describe("D280 — `allOf` folds with EVERY, and both conjuncts are load-bearing", () => {
  it("is TRUE only on the going-second seat's own first turn — turn 2", () => {
    let state = turnOne(11, "p1");
    const results: string[] = [];
    for (let turn = 1; turn <= 5; turn++) {
      for (const seat of ["p1", "p2"] as const) {
        if (conditionHolds(state, seat, CALL_BELL_GATE)) results.push(`${seat}@${turn}`);
      }
      state = passTurns(state, 1);
    }
    // Exactly ONE board in ten. ⚠️ Asserted as the LIST and not as a count: a
    // build that answered on the wrong seat would keep the count at 1.
    expect(results).toEqual(["p2@2"]);
  });

  it("goes FALSE when EITHER conjunct alone would go true — the .some / dropped-conjunct catch", () => {
    // Board A: turn 1, the going-FIRST seat. `yourFirstTurn` TRUE, `youGoSecond`
    // FALSE. A `.some` fold, or a registry row that dropped `youGoSecond`,
    // passes here; `.every` refuses.
    const a = turnOne(11, "p1");
    expect(conditionHolds(a, "p1", { kind: "yourFirstTurn" })).toBe(true);
    expect(conditionHolds(a, "p1", { kind: "youGoSecond" })).toBe(false);
    expect(conditionHolds(a, "p1", CALL_BELL_GATE)).toBe(false);

    // Board B: turn 4, the going-SECOND seat. `youGoSecond` TRUE,
    // `yourFirstTurn` FALSE. A `.some` fold, or a row that dropped
    // `yourFirstTurn`, passes here; `.every` refuses.
    const b = passTurns(turnOne(11, "p1"), 3);
    expect(b.turn).toBe(4);
    expect(conditionHolds(b, "p2", { kind: "youGoSecond" })).toBe(true);
    expect(conditionHolds(b, "p2", { kind: "yourFirstTurn" })).toBe(false);
    expect(conditionHolds(b, "p2", CALL_BELL_GATE)).toBe(false);
  });

  it("folds an arity-3 conjunction, and one false member is enough to refuse it", () => {
    // The tuple type leaves arity open (the Simisage triple is three conjuncts and
    // 0-legal), so the fold is driven at 3 even though no printing is authored at
    // 3 — a recursion arm that is only ever run at arity 2 is an arm nobody tests.
    const state = passTurns(turnOne(11, "p2"), 1); // turn 2 — p1 goes second
    const three: BoardCondition = {
      kind: "allOf",
      conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }, { kind: "handSizesEqual" }],
    };
    const handsEqual = conditionHolds(state, "p1", { kind: "handSizesEqual" });
    expect(conditionHolds(state, "p1", three)).toBe(handsEqual);
    // …and with a member that is definitely false on this board, the whole thing is.
    expect(
      conditionHolds(state, "p1", {
        kind: "allOf",
        conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }, { kind: "yourBenchDamaged" }],
      }),
    ).toBe(false);
  });

  it("NESTS, because the type allows it and no reader flattens", () => {
    const state = passTurns(turnOne(11, "p2"), 1); // turn 2 — p1 goes second
    const nested: BoardCondition = {
      kind: "allOf",
      conditions: [
        { kind: "youGoSecond" },
        { kind: "allOf", conditions: [{ kind: "yourFirstTurn" }, { kind: "youGoSecond" }] },
      ],
    };
    expect(conditionHolds(state, "p1", nested)).toBe(true);
    expect(conditionHolds(state, "p2", nested)).toBe(false);
  });
});

describe("D280 — `conditionNote` joins the fragments, and the JOINED string is the assertion", () => {
  it("round-trips the leaf verbatim", () => {
    expect(conditionNote({ kind: "youGoSecond" })).toBe("you go second");
  });

  it("joins with ' and ' — the WHOLE sentence, not the two halves", () => {
    // ⚠️ ASSERTED AS ONE STRING ON PURPOSE. Asserting the two halves separately
    // and `toContain`-ing them would stay green on a join that dropped a member,
    // reordered them, or used ", " — which is precisely the arm this slice added.
    expect(conditionNote(CALL_BELL_GATE)).toBe("you go second and it is your first turn");
  });

  it("does NOT round-trip to the printed bytes, and that is recorded rather than hidden", () => {
    // The printed sentence is "You can use this card only if you go second, and
    // only during your first turn." — the conjunction is ", and only", whose
    // second "only" belongs to the sentence's scaffolding. `cardplay.ts` supplies
    // one "only" of its own in the wrapper. The note is READABLE and TRUE and is
    // not the print; this pins that so the next author does not "fix" it into a
    // shape the wrapper double-negates.
    expect(CALL_BELL_TEXT.startsWith("You can use this card only if ")).toBe(true);
    expect(CALL_BELL_TEXT).not.toContain(conditionNote(CALL_BELL_GATE));
  });

  it("joins at arity 3 with the same word — no Oxford comma, and no printing asks for one", () => {
    expect(
      conditionNote({
        kind: "allOf",
        conditions: [
          { kind: "youGoSecond" },
          { kind: "yourFirstTurn" },
          { kind: "handSizesEqual" },
        ],
      }),
    ).toBe(
      "you go second and it is your first turn and you have the same number of cards in your hand as your opponent",
    );
  });
});

describe("D280 — Call Bell on a real board", () => {
  it("PLAYS on the going-second seat's first turn and fetches a Supporter", () => {
    const start = passTurns(turnOne(5, "p1"), 1); // turn 2 — p2's own first turn
    expect(start.turn).toBe(2);
    const armed = handFromDeck(start, "p2", "fix-callbell", 1);
    const uid = handUid(armed, "p2", "fix-callbell");
    const parked = mustApply(armed, { type: "playTrainer", seat: "p2", uid }).state;
    expect(parked.phase.kind, "the search parks on a card choice").toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("no park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("no card prompt");
    // ⚠️ THE CANDIDATE LIST IS THE FILTER'S UNIT TEST (D275's idiom): every
    // candidate must be the Supporter, and the deck is deliberately full of
    // Items, Pokémon and Energy that must NOT be offered.
    const names = new Set(prompt.candidates.map((u) => cardOfUid(parked, u)?.id ?? "?"));
    expect([...names]).toEqual(["sv01-180"]);
    const resolved = mustApply(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: prompt.candidates.slice(0, 1) },
    }).state;
    expect(
      resolved.players.p2.hand.filter((u) => cardOfUid(resolved, u)?.id === "sv01-180"),
    ).toHaveLength(1);
  });

  it("is REFUSED on the going-first seat's first turn — with the JOINED note in the message", () => {
    const start = turnOne(5, "p1"); // turn 1 — p1's own first turn, p1 went first
    const armed = handFromDeck(start, "p1", "fix-callbell", 1);
    const uid = handUid(armed, "p1", "fix-callbell");
    const result = play(deepFreeze(armed), "p1", uid);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("PLAY_CONDITION_NOT_MET");
    // The reject NAMES the whole conjunction, which is the combinator's user-
    // visible payoff and the reason `conditionNote` needed an arm at all.
    expect(result.error.message).toBe(
      // ⚠️ THE FIXTURE's NAME IS ITS ID (`trainerCard` names a synthetic row after
      // its id), so the wrapper reads "fix-callbell"; the REAL `sv08-165` reads
      // "Call Bell". The load-bearing half is everything after "only be used if",
      // which is `conditionNote`'s JOINED output and the thing this slice added.
      "fix-callbell can only be used if you go second and it is your first turn",
    );
  });

  it("is REFUSED on the going-second seat's LATER turns — the second conjunct alone", () => {
    const later = passTurns(turnOne(5, "p1"), 3); // turn 4 — p2's SECOND turn
    expect(later.turn).toBe(4);
    const armed = handFromDeck(later, "p2", "fix-callbell", 1);
    const uid = handUid(armed, "p2", "fix-callbell");
    const result = play(deepFreeze(armed), "p2", uid);
    expect(result.ok, "turn 4 is not p2's first turn").toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("PLAY_CONDITION_NOT_MET");
  });

  it("the CONTROL Item plays on every one of those boards — the gate is the card's, not the turn's", () => {
    // ⚠️ WITHOUT THIS, "Call Bell is refused on turn 1" would pass just as
    // happily on an engine that refused every Item on turn 1, which is the exact
    // shape of vacuous guard conventions.md's D214 note is about.
    for (const [state, seat] of [
      [turnOne(5, "p1"), "p1"],
      [passTurns(turnOne(5, "p1"), 3), "p2"],
    ] as const) {
      const armed = handFromDeck(state, seat, "sv01-172", 1);
      const uid = handUid(armed, seat, "sv01-172");
      expect(play(deepFreeze(armed), seat, uid).ok, `Energy Search @${state.turn}`).toBe(true);
    }
  });

  it("lights the WIRE row only where the engine accepts it — the online HUD mirror", () => {
    // The same `redactGame` call lights the CONTROL on both boards, so this
    // cannot pass by the whole trainer list being disabled.
    const good = handFromDeck(passTurns(turnOne(5, "p1"), 1), "p2", "fix-callbell", 1);
    const goodWithControl = handFromDeck(good, "p2", "sv01-172", 1);
    expect(wireRow(goodWithControl, "p2", "fix-callbell")?.disabled).toBe(false);
    expect(wireRow(goodWithControl, "p2", "sv01-172")?.disabled).toBe(false);

    const bad = handFromDeck(turnOne(5, "p1"), "p1", "fix-callbell", 1);
    const badWithControl = handFromDeck(bad, "p1", "sv01-172", 1);
    expect(wireRow(badWithControl, "p1", "fix-callbell")?.disabled).toBe(true);
    expect(wireRow(badWithControl, "p1", "sv01-172")?.disabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `MATCH_RECORD_VERSION` — the question the handoff raised, DRIVEN BOTH WAYS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D280 — MATCH_RECORD_VERSION stays 14, and the reachability claim is MEASURED", () => {
  it("NO `conditionGate` in the whole registry carries an `allOf` — the persisted-op reachability sweep", () => {
    // 🛑 THIS IS THE HALF THAT ACTUALLY DECIDES THE CONSTANT, AND IT IS THE HALF
    // THE HANDOFF NAMED. `pendingOp.op` is a PERSISTED literal riding
    // `GameState.phase.cont` into the match record (effects.ts's
    // `moveCountersChosen` block says so in as many words), and `conditionGate`
    // carries a whole `BoardCondition` in its `cond`. So the question is NOT
    // "does Call Bell park" — it is **"can an `allOf` reach a stored
    // continuation from anywhere"**, and the answer is structural: the union's
    // new member is authored at exactly one site in the repo, and that site is a
    // `trainerPlayableIf`, which is read BEFORE the card leaves hand and never
    // enters a continuation.
    //
    // ⚠️ **DISCOVERED, NOT TRANSCRIBED** (clauseApostrophe.test.ts's shape): the
    // sweep walks EVERY registry program through `walkProgram` — the structural
    // walker D276 installed precisely so a new branch carrier cannot fall out of
    // an enumerated list — and collects every `conditionGate`'s condition. It
    // reddens the day anybody authors an `allOf` under a gate, which is the one
    // edit that would make this constant move.
    const gateConds: BoardCondition[] = [];
    let programsWalked = 0;
    for (const id of registryCardIds()) {
      const program = programFor(id);
      if (program === undefined) continue;
      programsWalked++;
      const ops = [
        ...walkProgram(program.trainer ?? []),
        ...Object.values(program.attack ?? {}).flatMap((ops) => walkProgram(ops)),
        ...(program.abilities ?? []).flatMap((a) => walkProgram(a.program)),
      ];
      for (const op of ops) if (op.op === "conditionGate") gateConds.push(op.cond);
    }
    // The ATTRIBUTION CONTROL: the sweep really did find gates, so "no `allOf`"
    // is an answer rather than an empty population — without this the assertion
    // below would pass just as happily on a broken walk that reached nothing
    // (conventions.md's "a guard that under-reports looks like a guard with
    // nothing to report").
    expect(programsWalked).toBeGreaterThan(300);
    expect(gateConds.length).toBeGreaterThan(0);
    expect(gateConds.filter((c) => c.kind === "allOf")).toEqual([]);
    // …and the same for the ABILITY play gate, the other stored-adjacent seat.
    const abilityGates = registryCardIds()
      .flatMap((id) => programFor(id)?.abilities ?? [])
      .map((a) => a.playableIf)
      .filter((c): c is BoardCondition => c !== undefined);
    expect(abilityGates.length).toBeGreaterThan(0);
    expect(abilityGates.filter((c) => c.kind === "allOf")).toEqual([]);
  });

  it("a gated Call Bell writes exactly the keys the CONTROL Item writes — a DIFF with an ANCHOR", () => {
    // The replay half. Both boards come from the SAME build, so the diff alone is
    // a HALF-GUARD (D279's lesson): it catches "the gated path writes something
    // extra" and is blind to "every state grew a key". The literal key list beside
    // it is the other half, and it reddens the day any top-level `GameState` key
    // is added by anybody for any reason.
    const start = passTurns(turnOne(5, "p1"), 1); // turn 2 — p2's own first turn
    const viaGate = (() => {
      const armed = handFromDeck(start, "p2", "fix-callbell", 1);
      const uid = handUid(armed, "p2", "fix-callbell");
      const parked = mustApply(armed, { type: "playTrainer", seat: "p2", uid }).state;
      if (parked.phase.kind !== "effect:choose") throw new Error("no park");
      const prompt = parked.phase.prompt;
      if (prompt.kind !== "chooseCards") throw new Error("no card prompt");
      return mustApply(parked, {
        type: "resolveEffect",
        seat: "p2",
        choice: { kind: "cards", uids: prompt.candidates.slice(0, 1) },
      }).state;
    })();
    const viaControl = (() => {
      const armed = handFromDeck(start, "p2", "sv01-172", 1);
      const uid = handUid(armed, "p2", "sv01-172");
      const parked = mustApply(armed, { type: "playTrainer", seat: "p2", uid }).state;
      if (parked.phase.kind !== "effect:choose") throw new Error("no park");
      const prompt = parked.phase.prompt;
      if (prompt.kind !== "chooseCards") throw new Error("no card prompt");
      return mustApply(parked, {
        type: "resolveEffect",
        seat: "p2",
        choice: { kind: "cards", uids: prompt.candidates.slice(0, 1) },
      }).state;
    })();
    expect(Object.keys(viaGate).sort()).toEqual(Object.keys(viaControl).sort());
    expect(Object.keys(viaGate).sort()).toEqual([
      "allowances",
      "cardIdByUid",
      "cardPool",
      "firstPlayer",
      // 🆕 D283 — `handPlayLockedTurn`, the turn-scoped imposed hand-play bar.
      // Sorted BEFORE `lastKoTurn`: this literal is compared against a `.sort()`ed
      // key list, so its ORDER is load-bearing where the two sibling anchors'
      // (attackIndexGate, benchBodySelfScaling) sort their own literal too.
      "handPlayLockedTurn",
      "lastKoMarks",
      "lastKoTurn",
      "oncePerGameSpent",
      "pending",
      "phase",
      "players",
      "rngState",
      "stadium",
      "turn",
    ]);
    // 🛑 AND THE GATED PLAY RESOLVES TO NOTHING PARKED. A play gate is read
    // before the card leaves hand; the park in the middle is the SEARCH's, and it
    // carries a `chooseCards` prompt and no condition at all.
    expect(viaGate.phase.kind).toBe("turn:action");
    expect(viaGate.phase).not.toHaveProperty("cont");
  });
});
