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

const CARMINE_IDS = ["sv06-145", "sv06-204", "sv06-217", "sv08.5-103"] as const;

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
    const professors = programFor("sv01-189");
    expect(professors?.trainer).toEqual([{ op: "discardHand" }, { op: "drawCards", count: 7 }]);
    expect(professors?.trainerFirstTurnExempt).toBeUndefined();
    expect(programFor("sv06-145")).not.toBe(professors);
  });

  it("gives the flag to the cards that PRINT the sentence, and to nothing else", () => {
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
    const state = deepFreeze(turnOne(3, "p1"));
    expect(state.turn).toBe(1);
    expect(state.firstPlayer).toBe("p1");
    expect(state.phase.kind === "turn:action" && state.phase.seat).toBe("p1");

    const armed = handFromDeck(state, "p1", "fix-carmine", 1);
    const played = play(armed, "p1", handUid(armed, "p1", "fix-carmine"));
    expect(played.ok, "Carmine was refused on the turn it is printed for").toBe(true);
  });

  it("…while the CONTROL Supporter on the SAME board is still refused (§4 holds)", () => {
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
    let state = handFromDeck(turnOne(3, "p1"), "p1", "fix-carmine", 1);
    state = handFromDeck(state, "p1", "sv01-180", 1);
    expect(state.turn).toBe(1);

    expect(wireRow(state, "p1", "fix-carmine")).toEqual({
      uid: handUid(state, "p1", "fix-carmine"),
      name: "fix-carmine",
      disabled: false,
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
    expect(CARMINE_TEXT).toContain(
      "If you go first, you may use this card during your first turn.",
    );
    expect(CARMINE_TEXT).toContain("Discard your hand and draw 5 cards.");
    expect(CARMINE_TEXT.split("\n\n")).toHaveLength(2);
  });
});
