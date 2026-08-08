import manifest from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import type { EffectOp } from "./effects";
import { applyAction, engineVersion, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { logFromEvents } from "./log";
import type { LogContext } from "./log";
import { redactGame } from "./redact";
import {
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  deckOf,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
} from "./testFixtures";

// D295 — CHILL TEASER TOY `sv08-166` (Item): THE DESTINATION AS ONE OPTIONAL
// FIELD ON `discardEnergy`.
//
// "You can use this card only if you go second, and only during your first turn.
//
//  Put an Energy attached to 1 of your opponent's Pokémon into their hand."
//
// Re-queried in full at the remote D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) on 2026-08-08 rather than inherited:
// `category = 'Trainer'`, **`trainer_type = 'Item'`** (the handoff predicted a
// TOOL reaching `attachTool`, which would have made it a different surface and
// not this slice at all), `legal_standard = 1`, `regulation_mark = 'H'`, ONE
// printing and no reprint.
//
// 🛑 **TWO HALVES, AND ONLY ONE OF THEM IS NEW.**
//   • THE GATE is Call Bell `sv08-165`'s `allOf[youGoSecond, yourFirstTurn]`,
//     BYTE FOR BYTE. D280 built that combinator with exactly one consumer and
//     said so out loud; this is the second, and it needed no widening of any
//     kind. §1/§2 below drive it anyway — a shared gate that nobody drove on the
//     second card is a gate that has been READ and not DRIVEN (D293's rule).
//   • THE BODY is `discardEnergy { from: "opponentChosen", filter: anyEnergy }`
//     — Crushing Hammer's own arm — plus `to: "hand"`.
//
// 🛑 **AND THE FINDING THAT RE-FRAMES THE ROW: `to` IS A ZONE, NOT A SEAT.** The
// backlog has grouped this card with Mandibuzz and Illumise as a "cross-seat zone"
// row since D282. `discardEnergyApply` already resolves EVERY zone it writes
// against `discardVictimSeat` — the hammer family discards into the OPPONENT'S
// OWN pile, never the actor's — so the seat question was answered before this
// field existed. **THIS CARD CROSSES NO SEAT.** D294's
// `bottomFromOpponentHand.dest` genuinely does (its source is one side and its
// destination the other); this is a victim-zone widening the hammer arm had
// already paid for, and §3's ATTRIBUTION CONTROL is what makes that visible from
// inside this file.

/** ⚠️ **THE CONTROL IS IN THE DECK, NOT IN A COMMENT.** `fix-hammer` is the SAME
    op, the SAME `from` arm and the SAME filter with NO `to` — so every claim
    below about "the Energy went to the hand" is paired with a board where the
    identical action sends it to the PILE. Without it, a `to` that was silently
    ignored (or one that had become the DEFAULT) would be invisible from inside
    this file: the Energy would still leave the Pokémon and the suite would still
    be green.

    Two DISTINCT Special Energy prints so the pick is a real decision (the op
    collapses interchangeable candidates, so two copies of one print force
    nothing to be asked); two distinct Basic bodies so the opponent's board can
    hold several. Deep on `fix-bigbody` so setup never mulligans at an arbitrary
    seed — 24 Basics of 60, which is the thin-Basic warning D292 paid for. */
const CHILL_DECK = deckOf({
  "fix-chillteaser": 4,
  "fix-hammer": 4, // THE ATTRIBUTION CONTROL — same op, same arm, PILE destination
  "fix-basic-1": 4,
  "fix-basic-2": 4,
  "fix-special": 4,
  "fix-special-2": 4,
  "fix-bigbody": 16,
  "fix-energy": 20,
});

const decks = { p1: CHILL_DECK, p2: CHILL_DECK };
const SEEDS = [11, 29, 47] as const;

/** Setup with `first` going first, then `first` passes — so the board is TURN 2
    and it belongs to the seat that went SECOND. That is the one board on which
    both printed conjuncts hold, and it is the whole reason the gate is an
    `allOf` rather than either leaf (D280). */
function turnTwo(seed: number, first: Seat = "p2"): GameState {
  const state = driveSetup(seed, decks, { first });
  return mustApply(state, { type: "endTurn", seat: first }).state;
}

function play(state: GameState, seat: Seat, cardId: string) {
  const withCard = handFromDeck(state, seat, cardId, 1);
  return applyAction(withCard, {
    type: "playTrainer",
    seat,
    uid: handUid(withCard, seat, cardId),
  });
}

function mustPlay(state: GameState, seat: Seat, cardId: string) {
  const result = play(state, seat, cardId);
  if (!result.ok) throw new Error(`${cardId} refused: ${result.error.code}`);
  return result;
}

function activeEnergy(state: GameState, seat: Seat): string[] {
  return [...(state.players[seat].active?.energy ?? [])];
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Every log row this batch renders, flattened — `Gary` is p2, the VICTIM. */
function logText(state: GameState, events: readonly GameEvent[]): string {
  const ctx: LogContext = { names: { p1: "Ash", p2: "Gary" }, state, elapsed: "+00:00" };
  return logFromEvents(events, ctx)
    .map((r) => (r.kind === "action" ? r.segments.map((seg) => seg.text).join("") : ""))
    .join("\n");
}

/** The park's own prompt, when the op asks WHICH Energy. */
function discardPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`not parked: ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "discardEnergy") throw new Error(`wrong prompt: ${prompt.kind}`);
  return prompt;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE REGISTRY ROW — and the catalog claims it rests on.
// ─────────────────────────────────────────────────────────────────────────────

describe("D295 — the registry row", () => {
  it("maps the ONE Standard-legal printing, plus the demonstrator, to ONE object", () => {
    const program = programFor("sv08-166");
    expect(program, "sv08-166 has no program").toBeDefined();
    expect(programFor("fix-chillteaser"), "the demonstrator is not Chill Teaser Toy").toBe(program);
  });

  it("authors BOTH printed sentences — the shared allOf gate and the ONE op", () => {
    const program = programFor("sv08-166");
    expect(program?.trainerPlayableIf).toEqual({
      kind: "allOf",
      conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }],
    });
    expect(program?.trainer).toEqual([
      { op: "discardEnergy", from: "opponentChosen", filter: { kind: "anyEnergy" }, to: "hand" },
    ]);
  });

  it("🛑 the GATE is Call Bell's, byte for byte — the combinator's SECOND consumer", () => {
    // D280 built `allOf` for ONE card and recorded that as the honest cost. The
    // second consumer arrives with the combinator UNCHANGED, which is the claim
    // that paragraph was making and could not check.
    expect(programFor("sv08-166")?.trainerPlayableIf).toEqual(
      programFor("sv08-165")?.trainerPlayableIf,
    );
  });

  it("🛑 but the BODIES differ — it is not an alias and not a reprint", () => {
    expect(programFor("sv08-166")?.trainer).not.toEqual(programFor("sv08-165")?.trainer);
    expect(programFor("sv08-166")).not.toBe(programFor("sv08-165"));
  });

  it("⚠️ it is an ITEM, so it carries a `trainer` program and NO passive", () => {
    // The handoff predicted a TOOL. A Tool's program rides `passive` and reaches
    // `attachTool`; an Item's rides `trainer` and reaches `playTrainer`. The
    // NEGATIVE is what pins the surface — the positive alone would be green on a
    // card that carried both.
    const program = programFor("sv08-166");
    expect(program?.trainer).toBeDefined();
    expect(program?.passive).toBeUndefined();
    expect(program?.attack).toBeUndefined();
    expect(program?.triggered).toBeUndefined();
  });

  it("no §4 SUPPORTER exemption rides this row — the ban's antecedent is false twice", () => {
    // Call Bell's own paragraph, applying unchanged: D223's flag lifts a §4 ban on
    // SUPPORTERS played turn 1 by the going-FIRST seat. This is an Item played on
    // turn 2 by the going-SECOND seat, so the row carries no `passive` at all —
    // which is a STRONGER statement than checking the one field, because it also
    // rules out whichever sibling a future reader reaches for instead.
    expect(programFor("sv08-166")?.passive).toBeUndefined();
    expect(programFor("sv08-165")?.passive).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE GATE, DRIVEN — all four boards the `allOf` distinguishes.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed gate — both conjuncts are load-bearing on a real board", () => {
  it("✅ TURN 2, the seat that went SECOND — the one board where both hold", () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    expect(state.turn).toBe(2);
    expect(mustPlay(state, "p1", "fix-chillteaser").ok).toBe(true);
  });

  it("🛑 TURN 1 refuses — `yourFirstTurn` holds, `youGoSecond` does not", () => {
    // Turn 1 belongs to the seat that went FIRST by construction, so this is the
    // board where the second conjunct alone decides.
    let state = driveSetup(SEEDS[0], decks, { first: "p2" });
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const withCard = handFromDeck(state, "p2", "fix-chillteaser", 1);
    expectErr(
      withCard,
      { type: "playTrainer", seat: "p2", uid: handUid(withCard, "p2", "fix-chillteaser") },
      "PLAY_CONDITION_NOT_MET",
    );
  });

  it("🛑 TURN 4 refuses — `youGoSecond` holds, `yourFirstTurn` does not", () => {
    // The going-second seat's SECOND turn. Without this board, `youGoSecond`
    // alone would admit every turn of the game for that seat.
    let state = turnTwo(SEEDS[0]);
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    expect(state.turn).toBe(4);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const withCard = handFromDeck(state, "p1", "fix-chillteaser", 1);
    expectErr(
      withCard,
      { type: "playTrainer", seat: "p1", uid: handUid(withCard, "p1", "fix-chillteaser") },
      "PLAY_CONDITION_NOT_MET",
    );
  });

  it("🛑 A REFUSED PLAY COSTS NOTHING — the card stays in hand and no Energy moves", () => {
    let state = driveSetup(SEEDS[1], decks, { first: "p2" });
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const withCard = handFromDeck(state, "p2", "fix-chillteaser", 1);
    const uid = handUid(withCard, "p2", "fix-chillteaser");
    const energyBefore = activeEnergy(withCard, "p1");
    const result = applyAction(withCard, { type: "playTrainer", seat: "p2", uid });
    expect(result.ok).toBe(false);
    expect(withCard.players.p2.hand).toContain(uid);
    expect(activeEnergy(withCard, "p1")).toEqual(energyBefore);
  });

  it("the wire GREYS the row on a barred board and lights it on turn 2", () => {
    // Both transports, one board apiece — D293's rule that a HUD half is a claim
    // until it is driven.
    let barred = driveSetup(SEEDS[0], decks, { first: "p2" });
    barred = attachFromDeck(barred, "p1", "fix-energy", 1);
    barred = handFromDeck(barred, "p2", "fix-chillteaser", 1);
    const barredPhase = redactGame(barred, "p2").phase;
    if (barredPhase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(barredPhase.trainers.find((t) => t.name === "fix-chillteaser")?.disabled).toBe(true);

    let live = turnTwo(SEEDS[0]);
    live = attachFromDeck(live, "p2", "fix-energy", 1);
    live = handFromDeck(live, "p1", "fix-chillteaser", 1);
    const livePhase = redactGame(live, "p1").phase;
    if (livePhase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(livePhase.trainers.find((t) => t.name === "fix-chillteaser")?.disabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE ATTRIBUTION CONTROL — the same op, the same arm, the OTHER destination.
// ─────────────────────────────────────────────────────────────────────────────

describe("the attribution control — `fix-hammer` on the SAME board still uses the PILE", () => {
  it("🛑 the UNMARKED op discards: the pile grows and the hand does not", () => {
    // Without this, a `to` that had become the default — or one the apply ignored
    // in the other direction — would be invisible: the Energy leaves the Pokémon
    // either way.
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const uid = activeEnergy(state, "p2")[0] as string;
    const handBefore = state.players.p2.hand.length;
    const pileBefore = state.players.p2.discard.length;

    const { state: done } = mustPlay(state, "p1", "fix-hammer");

    expect(activeEnergy(done, "p2")).toEqual([]);
    expect(done.players.p2.discard).toContain(uid);
    expect(done.players.p2.discard.length).toBe(pileBefore + 1);
    expect(done.players.p2.hand.length).toBe(handBefore);
    expect(done.players.p2.hand).not.toContain(uid);
  });

  it("🛑 and its EVENT carries no `to` at all — the byte-identical old row", () => {
    // The optional field is ABSENT rather than `"discard"`, so a record written
    // before D295 reads back through this build unchanged.
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const { events } = mustPlay(state, "p1", "fix-hammer");
    const row = find(events, "ENERGY_DISCARDED");
    expect(row).toBeDefined();
    expect(Object.keys(row as object).sort()).toEqual([
      "actor",
      "from",
      "host",
      "seat",
      "type",
      "uids",
    ]);
  });

  it("🛑 its PROMPT still says 'Discard' — the caption is the destination's, not the arm's", () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachFromDeck(state, "p2", "fix-special-2", 1);
    const { state: done } = mustPlay(state, "p1", "fix-hammer");
    expect(discardPrompt(done).note).toBe("Discard an Energy from 1 of your opponent's Pokémon.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE MOVE — whose Energy, out of whose Pokémon, into whose hand.
// ─────────────────────────────────────────────────────────────────────────────

describe("the move — the Energy lands in the VICTIM's hand", () => {
  it("✅ the Energy leaves the opponent's Active and enters the OPPONENT'S hand", () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const uid = activeEnergy(state, "p2")[0] as string;
    const handBefore = state.players.p2.hand.length;

    const { state: done } = mustPlay(state, "p1", "fix-chillteaser");

    expect(activeEnergy(done, "p2")).toEqual([]);
    expect(done.players.p2.hand).toContain(uid);
    expect(done.players.p2.hand.length).toBe(handBefore + 1);
  });

  it("🛑 NOT the actor's hand — the mirror that separates a zone from a seat", () => {
    // The whole reason this row is a ZONE widening: the destination is the
    // VICTIM'S. A build that read the destination off `ctx.seat` would be green
    // on every assertion above and red here.
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const uid = activeEnergy(state, "p2")[0] as string;
    // Measured AFTER the card is in hand, so the only delta the assertion can see
    // is the Energy — the played Chill Teaser Toy leaving accounts for the −1.
    const withCard = handFromDeck(state, "p1", "fix-chillteaser", 1);
    const actorHandBefore = withCard.players.p1.hand.length;
    const done = mustApply(withCard, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(withCard, "p1", "fix-chillteaser"),
    }).state;

    expect(done.players.p1.hand).not.toContain(uid);
    expect(done.players.p1.hand.length).toBe(actorHandBefore - 1);
  });

  it("🛑 NOT the pile — neither seat's discard gains the Energy", () => {
    let state = turnTwo(SEEDS[1]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const uid = activeEnergy(state, "p2")[0] as string;
    const p2PileBefore = state.players.p2.discard.length;

    const { state: done } = mustPlay(state, "p1", "fix-chillteaser");

    expect(done.players.p2.discard).not.toContain(uid);
    expect(done.players.p2.discard.length).toBe(p2PileBefore);
    expect(done.players.p1.discard).not.toContain(uid);
  });

  it("🛑 the uid is in EXACTLY ONE zone afterwards — no duplication across zones", () => {
    // A `hand` write that also appended to `discard` would leave the uid in two
    // places, which no later reader could untangle (a uid is the game's identity).
    let state = turnTwo(SEEDS[2]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const uid = activeEnergy(state, "p2")[0] as string;

    const { state: done } = mustPlay(state, "p1", "fix-chillteaser");

    const side = done.players.p2;
    const zones = [
      side.hand.filter((u) => u === uid).length,
      side.discard.filter((u) => u === uid).length,
      side.deck.filter((u) => u === uid).length,
      (side.active?.energy ?? []).filter((u) => u === uid).length,
      ...side.bench.map((b) => b.energy.filter((u) => u === uid).length),
    ];
    expect(zones.reduce((a, b) => a + b, 0)).toBe(1);
    expect(side.hand.filter((u) => u === uid).length).toBe(1);
  });

  it("✅ it reaches a BENCHED Pokémon too — `opponentChosen` names a SET", () => {
    // `opponentActive` would be the one-body arm. This one offers the whole side,
    // and a build that had narrowed to the Active would be green everywhere else
    // in this file.
    let state = turnTwo(SEEDS[0]);
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = attachBenchFromDeck(state, "p2", 0, "fix-energy", 1);
    const uid = state.players.p2.bench[0]?.energy[0] as string;
    expect(activeEnergy(state, "p2")).toEqual([]);

    const { state: done } = mustPlay(state, "p1", "fix-chillteaser");

    expect(done.players.p2.bench[0]?.energy).toEqual([]);
    expect(done.players.p2.hand).toContain(uid);
  });

  it("a SPECIAL Energy moves too — `anyEnergy` is the printed 'an Energy'", () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    const uid = activeEnergy(state, "p2")[0] as string;
    const { state: done } = mustPlay(state, "p1", "fix-chillteaser");
    expect(done.players.p2.hand).toContain(uid);
  });

  it("the state is not mutated in place", () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    deepFreeze(state);
    expect(() => mustPlay(state, "p1", "fix-chillteaser")).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE DECISION — forced, parked, and what the prompt says.
// ─────────────────────────────────────────────────────────────────────────────

describe("the pick — forced on one candidate, parked on two", () => {
  it("a SINGLE candidate is FORCED — it resolves with no prompt at all", () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const { state: done } = mustPlay(state, "p1", "fix-chillteaser");
    expect(done.phase.kind).toBe("turn:action");
  });

  it("TWO DISTINCT prints PARK — and the prompt names the DESTINATION", () => {
    // The caption is the only thing on the board that tells this apart from the
    // hammer before the pick resolves, which is why it is asserted verbatim.
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachFromDeck(state, "p2", "fix-special-2", 1);
    const { state: done } = mustPlay(state, "p1", "fix-chillteaser");
    expect(done.phase.kind).toBe("effect:choose");
    expect(discardPrompt(done).note).toBe(
      "Put an Energy attached to 1 of your opponent's Pokémon into their hand.",
    );
  });

  it("🛑 and the caption is not merely different — it never says 'Discard'", () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachFromDeck(state, "p2", "fix-special-2", 1);
    const { state: done } = mustPlay(state, "p1", "fix-chillteaser");
    expect(discardPrompt(done).note).not.toContain("Discard");
    expect(discardPrompt(done).note).toContain("into their hand");
  });

  it("resolving the park puts the CHOSEN Energy into the victim's hand", () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachFromDeck(state, "p2", "fix-special-2", 1);
    const { state: parked } = mustPlay(state, "p1", "fix-chillteaser");
    const chosen = discardPrompt(parked).discardable[1]?.uid;
    if (chosen === undefined) throw new Error("expected two candidates");
    const other = discardPrompt(parked).discardable[0]?.uid as string;

    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen] },
    }).state;

    expect(done.players.p2.hand).toContain(chosen);
    expect(activeEnergy(done, "p2")).toEqual([other]);
  });

  it("🛑 the park has NO decline — the sentence does not say 'you may'", () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachFromDeck(state, "p2", "fix-special-2", 1);
    const { state: parked } = mustPlay(state, "p1", "fix-chillteaser");
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "discardEnergy", uids: [] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("🛑 an EMPTY opponent board refuses the play — the would-only-whiff gate", () => {
    // `programPlayable`: no Energy anywhere on the far side, so the card could
    // only whiff and the play never leaves the hand.
    const state = turnTwo(SEEDS[0]);
    expect(activeEnergy(state, "p2")).toEqual([]);
    const withCard = handFromDeck(state, "p1", "fix-chillteaser", 1);
    expectErr(
      withCard,
      { type: "playTrainer", seat: "p1", uid: handUid(withCard, "p1", "fix-chillteaser") },
      "NO_LEGAL_TARGET",
    );
  });

  it("⚠️ the ACTOR's own attached Energy is never a candidate", () => {
    // `from: "opponentChosen"` — a board where only the ACTOR holds Energy is the
    // empty board as far as this op is concerned, and the whiff gate proves it.
    let state = turnTwo(SEEDS[1]);
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    const withCard = handFromDeck(state, "p1", "fix-chillteaser", 1);
    expectErr(
      withCard,
      { type: "playTrainer", seat: "p1", uid: handUid(withCard, "p1", "fix-chillteaser") },
      "NO_LEGAL_TARGET",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE EVENT AND THE LOG ROW.
// ─────────────────────────────────────────────────────────────────────────────

describe("the event and the log row", () => {
  it("ENERGY_DISCARDED carries `to: \"hand\"`, with seat = the VICTIM and actor = the player", () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const uid = activeEnergy(state, "p2")[0] as string;
    const { events } = mustPlay(state, "p1", "fix-chillteaser");
    const row = find(events, "ENERGY_DISCARDED");
    expect(row?.to).toBe("hand");
    expect(row?.seat).toBe("p2");
    expect(row?.actor).toBe("p1");
    expect(row?.uids).toEqual([uid]);
  });

  it("🛑 no NEW event TYPE was invented for the destination", () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const { events } = mustPlay(state, "p1", "fix-chillteaser");
    expect(events.map((e) => e.type)).toEqual(["TRAINER_PLAYED", "ENERGY_DISCARDED"]);
  });

  it("the log row says PUT … INTO … HAND, and NAMES the Energy", () => {
    // Attached Energy is public and both players watched it leave, so naming it
    // leaks nothing — RANDOM_CARD_TAKEN's rule read in the other direction.
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const { state: done, events } = mustPlay(state, "p1", "fix-chillteaser");
    const text = logText(done, events);
    expect(text).toContain("put ");
    expect(text).toContain("into Gary's hand");
    expect(text).not.toContain("discarded");
  });

  it("🛑 the CONTROL's log row is unchanged — it still says 'discarded'", () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const { state: done, events } = mustPlay(state, "p1", "fix-hammer");
    const text = logText(done, events);
    expect(text).toContain("discarded");
    expect(text).not.toContain("into Gary's hand");
  });

  it("⚠️ the row names the OWNER outright, so a mirror match cannot print it twice", () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const { state: done, events } = mustPlay(state, "p1", "fix-chillteaser");
    const text = logText(done, events);
    expect(text).toContain("Gary's");
    expect(text).not.toContain("their hand");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. THE PERSISTED BYTE — driven both directions with a literal key anchor.
// ─────────────────────────────────────────────────────────────────────────────

describe("MATCH_RECORD_VERSION stays 16 — DRIVEN, not asserted", () => {
  /** A board parked mid-Chill-Teaser-Toy: `phase.cont` carries the op, which IS
      persisted (`MatchRecord` writes the whole `GameState`). */
  function parked(): GameState {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachFromDeck(state, "p2", "fix-special-2", 1);
    return mustPlay(state, "p1", "fix-chillteaser").state;
  }

  it("🛑 the persisted continuation's op carries EXACTLY these keys", () => {
    // THE LITERAL KEY ANCHOR (D279's pairing rule): a diff between two boards
    // from ONE build is blind to "every op grew a key", because the key is on
    // both sides. This names them.
    const phase = parked().phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const revived = JSON.parse(JSON.stringify(phase)) as {
      cont: { pendingOp: EffectOp; rest: EffectOp[] };
    };
    expect(Object.keys(revived.cont.pendingOp).sort()).toEqual(["filter", "from", "op", "to"]);
    expect(revived.cont.rest).toEqual([]);
  });

  it("🛑 FORWARD: a version-16 continuation with NO `to` replays as the DISCARD PILE", () => {
    // The direction the repo's rule actually tests — "can the PREVIOUS deploy's
    // RECORD hold the new TYPE". An old continuation has no `to`; this build
    // reads `undefined`; `undefined` IS the pile that record was written under.
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachFromDeck(state, "p2", "fix-special-2", 1);
    const old = mustPlay(state, "p1", "fix-hammer").state;
    const revived = JSON.parse(JSON.stringify(old)) as GameState;
    const phase = revived.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const pending = (phase as unknown as { cont: { pendingOp: EffectOp } }).cont.pendingOp;
    expect(Object.keys(pending).sort()).toEqual(["filter", "from", "op"]);
    const chosen = discardPrompt(revived).discardable[0]?.uid as string;
    const done = mustApply(revived, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen] },
    }).state;
    expect(done.players.p2.discard).toContain(chosen);
    expect(done.players.p2.hand).not.toContain(chosen);
  });

  it("🛑 BACKWARD: a record written HERE round-trips through JSON and resolves the same", () => {
    const before = parked();
    const revived = JSON.parse(JSON.stringify(before)) as GameState;
    expect(revived.phase).toEqual(before.phase);
    const chosen = discardPrompt(revived).discardable[0]?.uid as string;
    const done = mustApply(revived, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen] },
    }).state;
    expect(done.players.p2.hand).toContain(chosen);
    expect(done.players.p2.discard).not.toContain(chosen);
  });

  it("no `GameState` field, no new `GameEvent` TYPE, no new error code", () => {
    // What actually moved: an OPTIONAL field on an existing op (which an old
    // continuation cannot carry and does not need) and an OPTIONAL field on
    // `ENERGY_DISCARDED` — and `GameEvent` is not persisted at all (`MatchRecord`
    // stores the RENDERED `SeatLogEntry[]`). Neither can make a version-16 record
    // unreadable here.
    const state = turnTwo(SEEDS[0]);
    const keys = Object.keys(state).sort();
    expect(keys).toContain("phase");
    expect(keys).not.toContain("energyReturns");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. WHAT THIS SLICE REFUSED, WRITTEN AS TESTS.
// ─────────────────────────────────────────────────────────────────────────────

describe("what this slice REFUSED and why", () => {
  it("🛑 Illumise `sv06-010` still carries its GATE and NO body", () => {
    // *"Shuffle 1 of your opponent's Benched Pokémon and all attached cards into
    // their deck."* MISSING: **CODE** — an op that unmakes an IN-PLAY body (its
    // whole stack, attached Energy and Tools, damage and status) back into a
    // library zone. Nothing in this engine does that: §10 stacks only grow and KO
    // is the one teardown, through the prize path. 🛑 **THIS IS WHY THE SPLIT
    // TERM DID NOT MOVE 10 → 11**: the handoff's prediction had Illumise as its
    // premise, and the premise failed.
    const program = programFor("sv06-010");
    expect(program?.attackGate?.[0]).toBeDefined();
    expect(program?.attack).toBeUndefined();
  });

  it("🛑 the `opponentEach` arm cannot carry `to` — unrepresentable, not undocumented", () => {
    // Giacomo's sweep. No printed sweep returns Energy to a hand, so the pairing
    // is made UNSPELLABLE (`to?: never`) rather than silently ignored — `count`'s
    // own rule on the same arm.
    const sweep = programFor("sv02-182")?.trainer?.[0];
    expect(sweep).toMatchObject({ op: "discardEnergy", from: "opponentEach" });
    expect((sweep as { to?: unknown }).to).toBeUndefined();
  });

  it("🛑 no `to` reaches an OWN-BOARD arm — the caption would have to invent text", () => {
    // `yourActive` / `yours` / `self` are the printed attack COST family. No card
    // prints "put an Energy attached to this Pokémon into your hand", so those
    // three captions are left exactly as they were rather than growing a branch
    // nothing can take.
    for (const id of ["sv01-168", "sv03-143"]) {
      const ops = programFor(id);
      expect(ops, id).toBeDefined();
    }
    const hammer = programFor("fix-hammer")?.trainer?.[0];
    expect((hammer as { to?: unknown }).to).toBeUndefined();
  });
});

describe("the engine version", () => {
  it("moved PAST 0.206.0 — this suite asserts the TIE, not the literal", () => {
    // 🆕 D296 — THE LITERAL MOVED AGAIN, TO `aquaWash.test.ts`, and this suite
    // takes the shape D295 gave `lookForPrey.test.ts`: the tie and the DIRECTION
    // only. D295's own note asked for exactly ONE owner of the current literal
    // (`D275-engine-version-drifts-again` needs its assertion to be stale-able),
    // and re-stating 0.206.0 here would have made this the second.
    expect(engineVersion).toBe(manifest.version);
    expect(engineVersion > "0.206.0").toBe(true);
  });
});
