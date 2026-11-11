import { describe, expect, it } from "vitest";
import type { EffectOp } from "./effectTypes";
import { applyAction, programFor } from "./index";
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
  findEvent,
  roundTrip,
} from "./testFixtures";

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

  it("the GATE is Call Bell's, byte for byte — the combinator's SECOND consumer", () => {
    expect(programFor("sv08-166")?.trainerPlayableIf).toEqual(
      programFor("sv08-165")?.trainerPlayableIf,
    );
  });

  it("but the BODIES differ — it is not an alias and not a reprint", () => {
    expect(programFor("sv08-166")?.trainer).not.toEqual(programFor("sv08-165")?.trainer);
    expect(programFor("sv08-166")).not.toBe(programFor("sv08-165"));
  });

  it("it is an ITEM, so it carries a `trainer` program and NO passive", () => {
    const program = programFor("sv08-166");
    expect(program?.trainer).toBeDefined();
    expect(program?.passive).toBeUndefined();
    expect(program?.attack).toBeUndefined();
    expect(program?.triggered).toBeUndefined();
  });

  it("no §4 SUPPORTER exemption rides this row — the ban's antecedent is false twice", () => {
    expect(programFor("sv08-166")?.passive).toBeUndefined();
    expect(programFor("sv08-165")?.passive).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE GATE, DRIVEN — all four boards the `allOf` distinguishes.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed gate — both conjuncts are load-bearing on a real board", () => {
  it("TURN 2, the seat that went SECOND — the one board where both hold", () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    expect(state.turn).toBe(2);
    expect(mustPlay(state, "p1", "fix-chillteaser").ok).toBe(true);
  });

  it("TURN 1 refuses — `yourFirstTurn` holds, `youGoSecond` does not", () => {
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

  it("TURN 4 refuses — `youGoSecond` holds, `yourFirstTurn` does not", () => {
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

  it("A REFUSED PLAY COSTS NOTHING — the card stays in hand and no Energy moves", () => {
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
  it("the UNMARKED op discards: the pile grows and the hand does not", () => {
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

  it("and its EVENT carries no `to` at all — the byte-identical old row", () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const { events } = mustPlay(state, "p1", "fix-hammer");
    const row = findEvent(events, "ENERGY_DISCARDED");
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

  it("its PROMPT still says 'Discard' — the caption is the destination's, not the arm's", () => {
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
  it("the Energy leaves the opponent's Active and enters the OPPONENT'S hand", () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const uid = activeEnergy(state, "p2")[0] as string;
    const handBefore = state.players.p2.hand.length;

    const { state: done } = mustPlay(state, "p1", "fix-chillteaser");

    expect(activeEnergy(done, "p2")).toEqual([]);
    expect(done.players.p2.hand).toContain(uid);
    expect(done.players.p2.hand.length).toBe(handBefore + 1);
  });

  it("NOT the actor's hand — the mirror that separates a zone from a seat", () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const uid = activeEnergy(state, "p2")[0] as string;
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

  it("NOT the pile — neither seat's discard gains the Energy", () => {
    let state = turnTwo(SEEDS[1]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const uid = activeEnergy(state, "p2")[0] as string;
    const p2PileBefore = state.players.p2.discard.length;

    const { state: done } = mustPlay(state, "p1", "fix-chillteaser");

    expect(done.players.p2.discard).not.toContain(uid);
    expect(done.players.p2.discard.length).toBe(p2PileBefore);
    expect(done.players.p1.discard).not.toContain(uid);
  });

  it("the uid is in EXACTLY ONE zone afterwards — no duplication across zones", () => {
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

  it("it reaches a BENCHED Pokémon too — `opponentChosen` names a SET", () => {
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

  it("and the caption is not merely different — it never says 'Discard'", () => {
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

  it("the park has NO decline — the sentence does not say 'you may'", () => {
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

  it("an EMPTY opponent board refuses the play — the would-only-whiff gate", () => {
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

  it("the ACTOR's own attached Energy is never a candidate", () => {
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

describe("the event and the log row", () => {
  it('ENERGY_DISCARDED carries `to: "hand"`, with seat = the VICTIM and actor = the player', () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const uid = activeEnergy(state, "p2")[0] as string;
    const { events } = mustPlay(state, "p1", "fix-chillteaser");
    const row = findEvent(events, "ENERGY_DISCARDED");
    expect(row?.to).toBe("hand");
    expect(row?.seat).toBe("p2");
    expect(row?.actor).toBe("p1");
    expect(row?.uids).toEqual([uid]);
  });

  it("no NEW event TYPE was invented for the destination", () => {
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

  it("the CONTROL's log row is unchanged — it still says 'discarded'", () => {
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const { state: done, events } = mustPlay(state, "p1", "fix-hammer");
    const text = logText(done, events);
    expect(text).toContain("discarded");
    expect(text).not.toContain("into Gary's hand");
  });

  it("the row names the OWNER outright, so a mirror match cannot print it twice", () => {
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

  it("the persisted continuation's op carries EXACTLY these keys", () => {
    const phase = parked().phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const revived = JSON.parse(JSON.stringify(phase)) as {
      cont: { pendingOp: EffectOp; rest: EffectOp[] };
    };
    expect(Object.keys(revived.cont.pendingOp).sort()).toEqual(["filter", "from", "op", "to"]);
    expect(revived.cont.rest).toEqual([]);
  });

  it("FORWARD: a version-16 continuation with NO `to` replays as the DISCARD PILE", () => {
    // The direction the repo's rule actually tests — "can the PREVIOUS deploy's
    // RECORD hold the new TYPE". An old continuation has no `to`; this build
    // reads `undefined`; `undefined` IS the pile that record was written under.
    let state = turnTwo(SEEDS[0]);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachFromDeck(state, "p2", "fix-special-2", 1);
    const old = mustPlay(state, "p1", "fix-hammer").state;
    const revived = roundTrip(old);
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

  it("BACKWARD: a record written HERE round-trips through JSON and resolves the same", () => {
    const before = parked();
    const revived = roundTrip(before);
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
    const state = turnTwo(SEEDS[0]);
    const keys = Object.keys(state).sort();
    expect(keys).toContain("phase");
    expect(keys).not.toContain("energyReturns");
  });
});

describe("what this slice REFUSED and why", () => {
  it("Illumise `sv06-010` still carries its GATE and NO body", () => {
    const program = programFor("sv06-010");
    expect(program?.attackGate?.[0]).toBeDefined();
    expect(program?.attack).toBeUndefined();
  });

  it("the `opponentEach` arm cannot carry `to` — unrepresentable, not undocumented", () => {
    // Giacomo's sweep. No printed sweep returns Energy to a hand, so the pairing
    // is made UNSPELLABLE (`to?: never`) rather than silently ignored — `count`'s
    // own rule on the same arm.
    const sweep = programFor("sv02-182")?.trainer?.[0];
    expect(sweep).toMatchObject({ op: "discardEnergy", from: "opponentEach" });
    expect((sweep as { to?: unknown }).to).toBeUndefined();
  });

  it("no `to` reaches an OWN-BOARD arm — the caption would have to invent text", () => {
    for (const id of ["sv01-168", "sv03-143"]) {
      const ops = programFor(id);
      expect(ops, id).toBeDefined();
    }
    const hammer = programFor("fix-hammer")?.trainer?.[0];
    expect((hammer as { to?: unknown }).to).toBeUndefined();
  });
});
