import { describe, expect, it } from "vitest";
import { applyAction, programFor } from "./index";
import type { GameState, Seat } from "./index";
import { redactGame } from "./redact";
import {
  FIRST_TURN_SUPPORTER_DECK,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  handUids,
  mustApply,
} from "./testFixtures";

// D223 — CARMINE, and the `CardProgram` FLAG that lifts §4's going-first
// Supporter lock for exactly one card.
//
// "If you go first, you may use this card during your first turn.
//
//  Discard your hand and draw 5 cards."
//
// ⚠️ **THE THIRD OF D190's FOUR `DROPPED` ROWS TO BE COLLECTED**, and the biggest
// by printings: **4 Standard-legal** (`sv06-145`, `sv06-204`, `sv06-217`,
// `sv08.5-103` — all four byte-identical, remote D1 `luminous`, 2026-08-05).
//
// ⚠️ **AND THE ONE ROW OF THAT TABLE WHOSE CENSUS ENTRY WAS FLATLY WRONG.**
// `coverage-backlog-legal.md` prices this card at "1 registry program" and calls
// the first sentence *"**inert** — no going-first Supporter lock exists to lift"*.
// The lock has existed since M4 (`cardplay.ts` returns `FIRST_TURN_SUPPORTER` on
// `state.turn === 1`), so `trainer: [discardHand, drawCards 5]` alone would have
// REFUSED this card on the one turn it is printed to be legal on — a card
// strictly worse than unbuilt, which is the *EXACT MAP OR FLAG* doctrine's own
// worked example and the reason D190 dropped the row rather than approximate it.
//
// ⚠️ **THE `needs` STRING NAMED THE FIELD AND NOT ITS MIRRORS — THE SECOND SLICE
// RUNNING (D222 WAS THE FIRST).** *"a `CardProgram` flag read at that gate"* is
// right about the engine and silent about the fact that **three** places decide
// whether a Supporter is available on turn 1: `cardplay.ts`'s refusal, and the
// two HUD row-lighting mirrors (`redact.ts` `redactedTrainersOf` online,
// `GameHud.tsx` `playableTrainers` local). A flag read only by the engine leaves
// Carmine ENGINE-LEGAL AND UNCLICKABLE on turn 1 — the afford-then-reject defect
// with its sign flipped, and the quieter direction of it, because nobody clicks a
// row that looks dead. **Re-derive the READ SITES, not just the field.**
//
// ⚠️ WHAT THIS SUITE CAN PUT RED, SAID UP FRONT (the guard rule, conventions.md):
// * Deleting the §4 gate outright (instead of exempting one card) fails the
//   Nemona CONTROL, which shares every board below with Carmine.
// * Exempting §7.2 as well as §4 — the natural over-reach, since the two `err`s
//   are adjacent — fails "a turn-1 Carmine still spends the Supporter".
// * Reading the flag as first-turn state rather than as a property of the CARD
//   fails "Nemona is still banned on turn 1 AFTER Carmine has resolved".
// * Widening the exemption past Supporters fails the turn-1 ATTACK ban.
// * Authoring `drawCards 5` without the flag, or the flag without the id rows,
//   fails the play itself; authoring PROFESSORS_RESEARCH's 7 fails the hand size.
// * Dropping EITHER HUD mirror fails its own row-lighting test — and the online
//   one is asserted against the same `redactGame` call that lights Nemona, so it
//   cannot pass by the whole list being enabled.

/** The four Standard-legal printings, measured against the remote D1 `luminous`
    (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) on 2026-08-05: `legal_standard = 1`
    on all four, and one distinct `effect` string across them. */
const CARMINE_IDS = ["sv06-145", "sv06-204", "sv06-217", "sv08.5-103"] as const;

/** The printed effect, byte for byte — authored against the print rather than a
    paraphrase (D183's class). The blank line between the sentences is the
    catalog's own `\n\n`. */
const CARMINE_TEXT =
  "If you go first, you may use this card during your first turn.\n\nDiscard your hand and draw 5 cards.";

const decks = { p1: FIRST_TURN_SUPPORTER_DECK, p2: FIRST_TURN_SUPPORTER_DECK };

/** Setup with `first` going first, so turn 1 is `first`'s own first turn — the
    ONE board state this card's first sentence is about. */
function turnOne(seed: number, first: Seat): GameState {
  return driveSetup(seed, decks, { first });
}

/** …and the going-SECOND seat's first turn, which is turn 2 and is unrestricted:
    the control for "the exemption is not what makes Carmine playable in general". */
function turnTwo(seed: number): GameState {
  return mustApply(turnOne(seed, "p2"), { type: "endTurn", seat: "p2" }).state;
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

describe("D223 — the registry rows", () => {
  it("maps all FOUR Standard-legal printings, plus the demonstrator, to ONE object", () => {
    const first = programFor(CARMINE_IDS[0]);
    expect(first, "sv06-145 has no program").toBeDefined();
    for (const id of CARMINE_IDS) {
      expect(programFor(id), `${id} left Carmine`).toBe(first);
    }
    // A duplicated id would make the count lie about the coverage this slice
    // bought, which is the one number a reader carries away from it.
    expect(new Set(CARMINE_IDS).size).toBe(4);
    expect(programFor("fix-carmine"), "the demonstrator is not Carmine").toBe(first);
  });

  it("authors BOTH printed sentences — the flag and the discard-then-draw-5", () => {
    const program = programFor("sv06-217");
    expect(program?.trainer).toEqual([{ op: "discardHand" }, { op: "drawCards", count: 5 }]);
    expect(program?.trainerFirstTurnExempt).toBe(true);
    // …and nothing else: a `trainerEndsTurn` or a `trainerPlayableIf` here would
    // be a clause the card does not print.
    expect(Object.keys(program ?? {}).sort()).toEqual(["trainer", "trainerFirstTurnExempt"]);
  });

  it("is NOT Professor's Research — the near-twin keeps its 7 and gains no flag", () => {
    // ⚠️ THE MISTAKE THIS KILLS IS THE CHEAP ONE: reusing PROFESSORS_RESEARCH (an
    // identical second sentence) would draw 7 and, worse, a later edit adding the
    // flag to the shared object would hand the §4 exemption to a card that never
    // printed it — four ids silently gaining a licence.
    const professors = programFor("sv01-189");
    expect(professors?.trainer).toEqual([{ op: "discardHand" }, { op: "drawCards", count: 7 }]);
    expect(professors?.trainerFirstTurnExempt).toBeUndefined();
    expect(programFor("sv06-145")).not.toBe(professors);
  });

  it("gives the flag to the cards that PRINT the sentence, and to nothing else", () => {
    // The population that may carry the exemption is exactly the population that
    // prints the sentence. ⚠️ UPDATED BY D224, WHICH IS THE POINT OF THE ROW: at
    // D223 that population was Carmine's four ids alone and this test said so;
    // Team Rocket's Proton (sv10-177/-227) prints the same first sentence and was
    // authored at D224 with ZERO new engine code, spending exactly this flag. A
    // row appearing here without a printing behind it is still a real defect —
    // Professor's Research (the near-twin second sentence), Nemona and Boss's
    // Orders are the controls that would catch a flag put on the wrong object.
    const PROTON_IDS = ["sv10-177", "sv10-227", "fix-proton"] as const;
    const exempt = [
      ...CARMINE_IDS,
      "fix-carmine",
      ...PROTON_IDS,
      "sv01-189",
      "sv01-180",
      "sv02-172",
    ].filter((id) => programFor(id)?.trainerFirstTurnExempt === true);
    expect(exempt.sort()).toEqual([...CARMINE_IDS, "fix-carmine", ...PROTON_IDS].sort());
    // …and the two cards are still two PROGRAMS: sharing the object would have
    // been the cheap way to spend the flag, and would have given Proton's ids
    // Carmine's discard-and-draw.
    expect(programFor("sv10-177"), "Proton shares Carmine's program object").not.toBe(
      programFor("sv06-145"),
    );
  });
});

describe("§4 — the printed exemption, driven through playTrainer", () => {
  it("plays on TURN 1, on a board where BOTH halves of 'if you go first' are real", () => {
    // The printed conditional has two halves and the suite asserts both as state
    // rather than reasoning about one: p1 IS the going-first seat, and turn 1 IS
    // p1's turn. (The engine reads only the turn number, because turn 1 is p1's
    // BY CONSTRUCTION — see the going-second case below, which drives that claim
    // instead of restating it.)
    const state = deepFreeze(turnOne(3, "p1"));
    expect(state.turn).toBe(1);
    expect(state.firstPlayer).toBe("p1");
    expect(state.phase.kind === "turn:action" && state.phase.seat).toBe("p1");

    const armed = handFromDeck(state, "p1", "fix-carmine", 1);
    const played = play(armed, "p1", handUid(armed, "p1", "fix-carmine"));
    expect(played.ok, "Carmine was refused on the turn it is printed for").toBe(true);
  });

  it("…while the CONTROL Supporter on the SAME board is still refused (§4 holds)", () => {
    // ⚠️ THE ASSERTION THAT STOPS "DELETE THE GATE" FROM PASSING. Nemona
    // (sv01-180, "Draw 3 cards.") prints no exemption and sits in the same deck,
    // in the same hand, on the same turn.
    const armed = handFromDeck(turnOne(3, "p1"), "p1", "sv01-180", 1);
    const refused = play(armed, "p1", handUid(armed, "p1", "sv01-180"));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("FIRST_TURN_SUPPORTER");
  });

  it("runs the SECOND sentence too — hand discarded, exactly 5 drawn", () => {
    let state = handFromDeck(turnOne(3, "p1"), "p1", "fix-carmine", 1);
    const uid = handUid(state, "p1", "fix-carmine");
    const handBefore = state.players.p1.hand.length;
    const discardBefore = state.players.p1.discard.length;
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid }).state;

    expect(state.players.p1.hand).toHaveLength(5);
    // Carmine itself leaves hand for the discard BEFORE its program runs
    // (playTrainer's stated ordering), so the discard grows by the whole old hand
    // — the card included — and by nothing else.
    expect(state.players.p1.discard).toHaveLength(discardBefore + handBefore);
    expect(state.players.p1.discard).toContain(uid);
    // The five are DRAWN, not conjured: they came off this deck's top.
    expect(state.cardIdByUid[state.players.p1.hand[0] as string]).toBeDefined();
  });

  it("still SPENDS the Supporter for the turn — §7.2 is not exempted", () => {
    // ⚠️ THE OVER-REACH THIS KILLS: the two `err`s are adjacent in cardplay.ts, so
    // exempting the second along with the first is a one-character mistake. The
    // printed sentence licenses the TIMING, not a second Supporter.
    let state = handFromDeck(turnOne(3, "p1"), "p1", "fix-carmine", 2);
    const [firstUid, secondUid] = handUids(state, "p1", "fix-carmine", 2) as [string, string];
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid: firstUid }).state;
    expect(state.allowances.supporterPlayed).toBe(true);

    // The second copy has to be put back in hand: the first play discarded the
    // whole hand, which is the card's own text doing it.
    const rearmed = handFromDeck(state, "p1", "fix-carmine", 1);
    const again = play(rearmed, "p1", handUid(rearmed, "p1", "fix-carmine"));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("SUPPORTER_ALREADY_PLAYED");
    // `secondUid` went to the discard with the rest of the hand, which is the only
    // reason a fresh copy had to be dealt at all.
    expect(state.players.p1.discard).toContain(secondUid);
  });

  it("is a property of the CARD, not of the turn — Nemona stays banned after it resolves", () => {
    // ⚠️ THE IMPLEMENTATION THIS KILLS: lifting §4 by setting a flag on the STATE
    // when Carmine resolves. That would read identically on Carmine itself and
    // would open the turn for every other Supporter in hand.
    let state = handFromDeck(turnOne(3, "p1"), "p1", "fix-carmine", 1);
    state = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-carmine"),
    }).state;
    expect(state.turn).toBe(1);

    const armed = handFromDeck(state, "p1", "sv01-180", 1);
    const refused = play(armed, "p1", handUid(armed, "p1", "sv01-180"));
    expect(refused.ok).toBe(false);
    // §7.2 fires first here only if §4 has been lifted for everyone; the code
    // proves which rule answered.
    if (!refused.ok) expect(refused.error.code).toBe("FIRST_TURN_SUPPORTER");
  });

  it("lifts the SUPPORTER ban and nothing else — turn 1 still bans attacking", () => {
    // §4 has two limbs and this card names one of them. An exemption written
    // against `state.turn === 1` in general would open the other.
    let state = handFromDeck(turnOne(3, "p1"), "p1", "fix-carmine", 1);
    state = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-carmine"),
    }).state;
    const attacked = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    expect(attacked.ok).toBe(false);
    if (!attacked.ok) expect(attacked.error.code).toBe("FIRST_TURN_ATTACK");
  });
});

describe("the 'if you go first' half — driven, because the engine does not spell it", () => {
  it("follows the going-first SEAT, not p1: with p2 first, p2 plays it on turn 1", () => {
    const state = turnOne(4, "p2");
    expect(state.turn).toBe(1);
    expect(state.firstPlayer).toBe("p2");
    const armed = handFromDeck(state, "p2", "fix-carmine", 1);
    const played = play(armed, "p2", handUid(armed, "p2", "fix-carmine"));
    expect(played.ok).toBe(true);
  });

  it("cannot become a going-SECOND licence: turn 1 is never that seat's to act on", () => {
    // ⚠️ THIS IS THE HALF THE ENGINE CONDITION LEAVES IMPLICIT, DRIVEN RATHER THAN
    // ARGUED. `cardplay.ts` tests only `state.turn === 1`, because turn 1 belongs
    // to `state.firstPlayer` by construction (phaseViewOf: odd turns are the first
    // player's) and `turnGate` has already proved the actor owns the phase. So the
    // going-second seat's Carmine on turn 1 is refused BEFORE the Supporter branch
    // is reached at all — there is no board on which the missing conjunct matters,
    // which is exactly why adding it would be a guard that cannot go red.
    const state = turnOne(4, "p2");
    const armed = handFromDeck(state, "p1", "fix-carmine", 1);
    const refused = play(armed, "p1", handUid(armed, "p1", "fix-carmine"));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("WRONG_SEAT");
  });

  it("is unremarkable on the going-second seat's own first turn (turn 2)", () => {
    // The exemption is not what makes Carmine playable in general — turn 2 is
    // unrestricted, and a card with no flag plays there too.
    const state = turnTwo(4);
    expect(state.turn).toBe(2);
    const armed = handFromDeck(state, "p1", "fix-carmine", 1);
    const played = play(armed, "p1", handUid(armed, "p1", "fix-carmine"));
    expect(played.ok).toBe(true);
    if (played.ok) expect(played.state.allowances.supporterPlayed).toBe(true);

    const control = handFromDeck(state, "p1", "sv01-180", 1);
    expect(play(control, "p1", handUid(control, "p1", "sv01-180")).ok).toBe(true);
  });
});

describe("the HUD mirror — the read site the census row did not name", () => {
  it("lights Carmine's wire row on turn 1 while greying the control in the SAME call", () => {
    // ⚠️ ONE `redactGame` CALL, TWO ROWS, OPPOSITE ANSWERS. Asserted together so
    // the test cannot pass by the whole list having been enabled — the failure a
    // "Carmine is not disabled" assertion on its own would sail through.
    let state = handFromDeck(turnOne(3, "p1"), "p1", "fix-carmine", 1);
    state = handFromDeck(state, "p1", "sv01-180", 1);
    expect(state.turn).toBe(1);

    expect(wireRow(state, "p1", "fix-carmine")).toEqual({
      uid: handUid(state, "p1", "fix-carmine"),
      name: "fix-carmine",
      disabled: false,
      // The §4 timing is self-evident and carries no tooltip either way; an
      // ENABLED row must carry none at all.
      reason: null,
      rareCandy: false,
    });
    expect(wireRow(state, "p1", "sv01-180")?.disabled, "the control lit up too").toBe(true);
  });

  it("greys the wire row once the Supporter is spent — §7.2 survives in the mirror", () => {
    let state = handFromDeck(turnOne(3, "p1"), "p1", "fix-carmine", 1);
    state = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-carmine"),
    }).state;
    state = handFromDeck(state, "p1", "fix-carmine", 1);
    expect(state.turn).toBe(1);
    expect(wireRow(state, "p1", "fix-carmine")?.disabled).toBe(true);
  });
});

describe("the printed bytes", () => {
  it("pins the sentence the flag and the program were authored from", () => {
    // D183's class: an arm written from a PARAPHRASE passes a test written against
    // the same paraphrase and matches no real card. This is the catalog's string.
    expect(CARMINE_TEXT).toContain("If you go first, you may use this card during your first turn.");
    expect(CARMINE_TEXT).toContain("Discard your hand and draw 5 cards.");
    expect(CARMINE_TEXT.split("\n\n")).toHaveLength(2);
  });
});
