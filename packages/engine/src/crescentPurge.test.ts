import type { Card } from "@colorless/schema";
import { redactedEffectPromptSchema, redactedSideSchema } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { EffectOp } from "./effects";
import {
  deriveAttackEffect,
  deriveAttackOptionalCostBoost,
  optionalCostBoostProgram,
} from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion, redactGame } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { conditionHolds, conditionNote, runProgram } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import {
  completeSetup,
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  expectErr,
  must,
  mustApply,
  setActiveFromDeck,
  setPrizes,
} from "./testFixtures";

// 🆕🆕🆕 D548 — CRESCENT PURGE: THE FACE-UP PRIZE, ON THE REAL CARD.
//
//   Cresselia `sv06.5-021` "Crescent Purge" ({P}{P}{P}, `80+`, attack INDEX 1 — index 0
//   is "Healing Pirouette", D133's own-board heal), `censusAttackCorpus.ts` **file line
//   664**, leading count column **2**:
//     "You may turn 1 of your face-down Prize cards face up. If you do, this attack does
//      80 more damage. (That Prize card remains face up for the rest of the game.)"
//   **1 sentence / 2 legal printings.**
//
// The LAST refused member of D381's reversed optional-cost family, refused since D381 for
// *"a `PlayerState` field"* — a type that does not exist in the engine (the engine's is
// `PlayerSide`; `PlayerState` is the LOBBY's seat type). What it actually cost:
//   · `PlayerSide.faceUpPrizes: string[]` — REQUIRED, uids, a subset of `prizes`
//     (`MATCH_RECORD_VERSION` 31 → 32, §11 below is the measurement);
//   · `optionalCostOps`' FIFTH row → `{cond: yourFaceDownPrizeRemains, ops:
//     [turnPrizeFaceUp]}`, and the printed reminder stripped as an optional exact suffix
//     behind that row only;
//   · the OWNER PICKS which prize (the D548 ruling): ≥2 face-down → park `choosePrize`
//     over the face-down INDICES; exactly 1 → inline; 0 → unreachable, silent no-op;
//   · `PRIZE_TURNED_FACE_UP`, whose log row NAMES the (now public) card;
//   · the wire: `RedactedSide.faceUpPrizes {index, card}[]` for every viewer.
//
// ⚠️ ON THE REAL CARD, IN A FILE-LOCAL 60-CARD DECK (D270): `sv06.5-021` is a
// `FIXTURE_POOL` row whose index-1 text matches the corpus byte for byte (§1 asserts it),
// so no demonstrator is declared. The deck's other cards are file-local: a 400-HP wall
// that survives two Purges, a 150-HP body that a paid Purge (160) Knocks Out and a
// declined one (80) does not, and two ENERGY tokens (`d548-secret` ×5, `d548-shown` ×1)
// that §9 stacks into the prize rows so "no face-down card id crosses the wire" is a
// claim about a string that CANNOT appear anywhere else.

const SENTENCE =
  "You may turn 1 of your face-down Prize cards face up. If you do, this attack does 80 more damage. (That Prize card remains face up for the rest of the game.)";
const BARE =
  "You may turn 1 of your face-down Prize cards face up. If you do, this attack does 80 more damage.";
const REMINDER = " (That Prize card remains face up for the rest of the game.)";
const CRESSELIA = "sv06.5-021";
const PURGE = 1; // attack index 1 — "Crescent Purge"

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string | readonly string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob(["../../../apps/api/src/lobby/match.ts"], { query: "?raw", import: "default", eager: true });
const raw = (suffix: string): string =>
  Object.entries(RAW).find(([k]) => k.endsWith(suffix))?.[1] ?? "";

const token = (id: string): Card =>
  ({ ...FIXTURE_POOL["fix-energy"], id, name: id }) as Card;

const LOCAL_CARDS: Record<string, Card> = {
  "d548-wall": battler("d548-wall", { types: ["Colorless"], hp: 400, retreat: 1 }),
  "d548-frail": battler("d548-frail", { types: ["Colorless"], hp: 150, retreat: 1 }),
  "d548-secret": token("d548-secret"),
  "d548-shown": token("d548-shown"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), counted by the helper: 60 is a `createGame` precondition. */
const PURGE_DECK = deckOf({
  [CRESSELIA]: 4,
  "d548-wall": 4,
  "d548-frail": 4,
  "fix-psychic-energy": 20,
  "d548-secret": 5,
  "d548-shown": 1,
  "fix-basic-1": 8,
  "fix-energy": 14,
});

const NAMES: Record<Seat, string> = { p1: "Luna", p2: "Sol" };
const SEED = 20260924;

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: PURGE_DECK, p2: PURGE_DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }),
  );
  state = completeSetup(state);
  return state;
}

/** Stack `seat`'s prize row so its cards are `ids`, in order — each wanted uid swapped in
    from wherever it sits (deck or hand), the displaced prize going to its old place. Card
    counts per zone are unchanged; only WHICH cards are prizes moves. */
function stackPrizes(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  const taken = new Set<string>();
  const wanted = ids.map((id) => {
    const uid = [...side.prizes, ...side.deck, ...side.hand].find(
      (u) => state.cardIdByUid[u] === id && !taken.has(u),
    );
    if (uid === undefined) throw new Error(`${seat} has no spare ${id}`);
    taken.add(uid);
    return uid;
  });
  const outgoing = side.prizes.filter((u) => !wanted.includes(u));
  const swap = new Map<string, string>();
  for (const u of wanted) if (!side.prizes.includes(u)) swap.set(u, outgoing.shift() as string);
  const back = (u: string) => swap.get(u) ?? u;
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, prizes: wanted, deck: side.deck.map(back), hand: side.hand.map(back) },
    },
  };
}

/** p1 fields Cresselia with {P}{P}{P} and an empty Bench; p2 fields `defender` Active
    and one benched `d548-wall` (so a Knock Out does not end the game on §14.2). p1 moves
    first, both first turns are behind us, and it is p1's turn: the attack is legal. */
function ready(
  opts: { defender?: string; prizes?: number; stacked?: boolean; seed?: number } = {},
): GameState {
  const { defender = "d548-wall", seed = SEED } = opts;
  let state = localSetup(seed);
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  if (opts.stacked === true) {
    const row = ["d548-secret", "d548-secret", "d548-secret", "d548-secret", "d548-shown", "d548-secret"];
    state = stackPrizes(state, "p1", row);
    state = stackPrizes(state, "p2", row);
  }
  state = setActiveFromDeck(state, "p1", CRESSELIA);
  state = attachFromDeck(state, "p1", "fix-psychic-energy", 3);
  state = clearBench(state, "p1");
  state = setActiveFromDeck(state, "p2", defender);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "d548-wall");
  if (opts.prizes !== undefined) state = setPrizes(state, "p1", opts.prizes);
  return state;
}

const purge = (state: GameState) => mustApply(state, { type: "attack", seat: "p1", index: PURGE });
const answer = (state: GameState, choice: GameAction & { type: "resolveEffect" }) =>
  mustApply(state, choice);
const confirm = (state: GameState, yes: boolean) =>
  answer(state, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } });
const pick = (state: GameState, index: number) =>
  answer(state, { type: "resolveEffect", seat: "p1", choice: { kind: "prize", index } });

function promptOf(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  return state.phase.prompt;
}

/** p2 ends its turn so p1 may attack again (the Cresselia and its Energy stay put). */
const nextP1Turn = (state: GameState) => mustApply(state, { type: "endTurn", seat: "p2" }).state;

const defenderDamage = (state: GameState) => state.players.p2.active?.damage;

function rowText(state: GameState, events: GameEvent[], needle: string): string {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  const row = logFromEvents(events, ctx).find(
    (r) => r.kind === "action" && r.segments.some((s) => s.text.includes(needle)),
  );
  if (row === undefined || row.kind !== "action") throw new Error(`no row mentioning ${needle}`);
  return row.segments.map((s) => s.text).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE READING: the fifth cost row, the reminder as an optional exact suffix.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the reading, on the real card's bytes", () => {
  it("the card's index-1 text IS the corpus row, byte for byte, at 2 legal printings", () => {
    expect(POOL[CRESSELIA]?.name).toBe("Cresselia");
    expect(POOL[CRESSELIA]?.attacks?.[PURGE]?.name).toBe("Crescent Purge");
    expect(POOL[CRESSELIA]?.attacks?.[PURGE]?.effect).toBe(SENTENCE);
    expect(POOL[CRESSELIA]?.attacks?.[PURGE]?.damage).toBe("80+");
    expect(legalAttackCorpus().filter(([, s]) => s === SENTENCE)).toEqual([[2, SENTENCE]]);
  });

  it("🛑 derives the gate, the op and the +80 — and the TENTH reader is the one that claims it", () => {
    expect(deriveAttackOptionalCostBoost(SENTENCE)).toEqual({
      cond: { kind: "yourFaceDownPrizeRemains" },
      ops: [{ op: "turnPrizeFaceUp" }],
      payoff: { kind: "moreDamage", bonus: 80 },
    });
    expect(resolvedByAnyReader(SENTENCE)).toBe(true);
    // Not `deriveAttackEffect`'s (boardHeal.test.ts's index-keyed control stays green).
    expect(deriveAttackEffect(SENTENCE)).toBeNull();
  });

  it("🛑 the PRINTED and the BARE spellings derive the SAME reading — the reminder is optional", () => {
    expect(SENTENCE).toBe(BARE.replace(/\.$/, `.${REMINDER}`));
    expect(deriveAttackOptionalCostBoost(BARE)).toEqual(deriveAttackOptionalCostBoost(SENTENCE));
  });

  it("🛑 the reminder behind ANY OTHER cost row refuses — it is stripped behind the face-up row only", () => {
    for (const cost of [
      "discard a Stadium in play",
      "discard your hand",
      "put all Energy attached to this Pokémon into your hand",
    ]) {
      const bare = `You may ${cost}. If you do, this attack does 80 more damage.`;
      expect(deriveAttackOptionalCostBoost(bare), bare).not.toBeNull();
      expect(deriveAttackOptionalCostBoost(`${bare}${REMINDER}`), cost).toBeNull();
    }
  });

  it("🛑 the nearest misses refuse: the wrong ZONE, the wrong COUNT, a mangled reminder", () => {
    // An OPPONENT's Prize — the one-axis side swap.
    expect(
      deriveAttackOptionalCostBoost(
        "You may turn 1 of your opponent's face-down Prize cards face up. If you do, this attack does 80 more damage.",
      ),
    ).toBeNull();
    // TWO Prizes — the count is fixed at the only printed value, not captured.
    expect(
      deriveAttackOptionalCostBoost(
        "You may turn 2 of your face-down Prize cards face up. If you do, this attack does 80 more damage.",
      ),
    ).toBeNull();
    // The reminder must be EXACT: a truncated one stays in the payoff and refuses.
    expect(
      deriveAttackOptionalCostBoost(`${BARE} (That Prize card remains face up.)`),
    ).toBeNull();
  });

  it("the program: conditionGate → optional → [turnPrizeFaceUp, hit 160], declines to hit 80", () => {
    const reading = deriveAttackOptionalCostBoost(SENTENCE);
    if (reading === null) throw new Error("expected a reading");
    const program = optionalCostBoostProgram(reading, 80, SENTENCE);
    expect(program).toHaveLength(1);
    const gate = program[0] as Extract<EffectOp, { op: "conditionGate" }>;
    expect(gate.op).toBe("conditionGate");
    expect(gate.cond).toEqual({ kind: "yourFaceDownPrizeRemains" });
    const ask = gate.then[0] as Extract<EffectOp, { op: "optional" }>;
    expect(ask.op).toBe("optional");
    expect(ask.note).toBe(SENTENCE);
    expect(ask.then[0]).toEqual({ op: "turnPrizeFaceUp" });
  });

  it("the gate's pill says what the board must hold", () => {
    expect(conditionNote({ kind: "yourFaceDownPrizeRemains" })).toBe(
      "you have at least 1 face-down Prize card",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2–§6 — ON A BOARD.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — ACCEPT, then PICK: 160, and exactly the picked slot turns", () => {
  it("🛑 a NON-FIRST pick flips THAT slot and no other (a first-slot auto-pick dies here)", () => {
    const start = ready();
    const prizesBefore = [...start.players.p1.prizes];
    expect(prizesBefore).toHaveLength(6);
    const asked = purge(start).state;
    expect(promptOf(asked)).toEqual({ kind: "confirm", note: SENTENCE });
    const offered = confirm(asked, true).state;
    // The OWNER picks: six face-down prizes, so the pick PARKS over their indices.
    expect(promptOf(offered)).toEqual({
      kind: "choosePrize",
      indices: [0, 1, 2, 3, 4, 5],
      note: "Choose 1 of your face-down Prize cards to turn face up.",
    });
    expect(defenderDamage(offered)).toBe(0); // the hit waits behind the pick
    const { state: done, events } = pick(offered, 3);
    expect(done.players.p1.faceUpPrizes).toEqual([prizesBefore[3]]);
    // Still a prize, at its own index: the row is untouched.
    expect(done.players.p1.prizes).toEqual(prizesBefore);
    expect(defenderDamage(done)).toBe(160);
    expect(all(events, "PRIZE_TURNED_FACE_UP")).toEqual([
      { type: "PRIZE_TURNED_FACE_UP", seat: "p1", index: 3, uid: prizesBefore[3] },
    ]);
    expect(done.players.p2.faceUpPrizes).toEqual([]);
  });

  it("the pick is the ONLY decision: picking slot 5 turns slot 5", () => {
    const start = ready();
    const done = pick(confirm(purge(start).state, true).state, 5).state;
    expect(done.players.p1.faceUpPrizes).toEqual([start.players.p1.prizes[5]]);
  });
});

describe("§3 — DECLINE pays the printed 80 and turns nothing", () => {
  it("🛑 no second park, no flip, no event", () => {
    const { state: done, events } = confirm(purge(ready()).state, false);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(defenderDamage(done)).toBe(80);
    expect(done.players.p1.faceUpPrizes).toEqual([]);
    expect(all(events, "PRIZE_TURNED_FACE_UP")).toEqual([]);
  });
});

describe("§4 — ONE face-down prize: accept turns it with NO second park", () => {
  it("🛑 the forced pick resolves inline (the no-choice doctrine)", () => {
    const start = ready({ prizes: 1 });
    const only = start.players.p1.prizes[0];
    const { state: done, events } = confirm(purge(start).state, true);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(done.players.p1.faceUpPrizes).toEqual([only]);
    expect(defenderDamage(done)).toBe(160);
    expect(all(events, "PRIZE_TURNED_FACE_UP")).toEqual([
      { type: "PRIZE_TURNED_FACE_UP", seat: "p1", index: 0, uid: only },
    ]);
  });

  it("…and on a two-prize row with one already face up, it turns the OTHER one inline", () => {
    let state = ready({ prizes: 2 });
    const [first, second] = state.players.p1.prizes;
    state = pick(confirm(purge(state).state, true).state, 1).state;
    expect(state.players.p1.faceUpPrizes).toEqual([second]);
    state = nextP1Turn(state);
    const { state: done } = confirm(purge(state).state, true);
    expect(done.phase.kind).not.toBe("effect:choose");
    // Ordered by WHEN each was turned, not by slot.
    expect(done.players.p1.faceUpPrizes).toEqual([second, first]);
  });
});

describe("§5 — an ALL-face-up row pays 80 with NO confirm (the gate)", () => {
  it("🛑 the gate is not vacuous: `prizes.length > 0` is true here and the offer must not be made", () => {
    let state = ready({ prizes: 1 });
    state = confirm(purge(state).state, true).state; // the one prize is now face up
    state = nextP1Turn(state);
    expect(state.players.p1.prizes).toHaveLength(1);
    expect(conditionHolds(state, "p1", { kind: "yourFaceDownPrizeRemains" })).toBe(false);
    const hpBefore = defenderDamage(state) ?? 0;
    const { state: done, events } = purge(state);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect((defenderDamage(done) ?? 0) - hpBefore).toBe(80);
    expect(all(events, "PRIZE_TURNED_FACE_UP")).toEqual([]);
  });
});

describe("§6 — two Purges on two turns: the second offers only what is still face down", () => {
  it("🛑 the turned slot leaves the offer", () => {
    let state = ready();
    const row = [...state.players.p1.prizes];
    state = pick(confirm(purge(state).state, true).state, 4).state;
    state = nextP1Turn(state);
    const offered = confirm(purge(state).state, true).state;
    expect(promptOf(offered)).toMatchObject({ kind: "choosePrize", indices: [0, 1, 2, 3, 5] });
    const done = pick(offered, 0).state;
    expect(done.players.p1.faceUpPrizes).toEqual([row[4], row[0]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE TAKE: face-up prizes are still prizes, and a taken one leaves the list.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — ko:takePrizes prunes a taken face-up prize and leaves the rest", () => {
  /** A paid Purge Knocks Out the 150-HP defender: the flip (slot `turn`), then the take. */
  function koWithFlip(turn: number): GameState {
    const offered = confirm(purge(ready({ defender: "d548-frail" })).state, true).state;
    const done = pick(offered, turn).state;
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    return done;
  }

  it("🛑 taking the FACE-UP slot prunes it out of `faceUpPrizes`", () => {
    const state = koWithFlip(2);
    const row = [...state.players.p1.prizes];
    const done = mustApply(state, { type: "takePrizes", seat: "p1", prizeIndices: [2] }).state;
    expect(done.players.p1.prizes).toEqual(row.filter((_, i) => i !== 2));
    expect(done.players.p1.hand).toContain(row[2]);
    expect(done.players.p1.faceUpPrizes).toEqual([]);
  });

  it("🛑 taking a FACE-DOWN slot leaves `faceUpPrizes` untouched (and the face-up index shifts)", () => {
    const state = koWithFlip(2);
    const row = [...state.players.p1.prizes];
    const done = mustApply(state, { type: "takePrizes", seat: "p1", prizeIndices: [0] }).state;
    expect(done.players.p1.faceUpPrizes).toEqual([row[2]]);
    // The uid is stable; its SLOT moved from 2 to 1, which is why the list holds uids.
    expect(done.players.p1.prizes.indexOf(row[2] as string)).toBe(1);
    expect(redactGame(done, "p1").board.you.faceUpPrizes.map((p) => p.index)).toEqual([1]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE WIRE: public for every viewer, and nothing face-down crosses.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — redact: the face-up card at its index, for p1, p2 and a spectator", () => {
  const flipped = () => pick(confirm(purge(ready({ stacked: true })).state, true).state, 4).state;

  it("🛑 every viewer sees the same face-up card at slot 4, and the count is unchanged", () => {
    const state = flipped();
    const shownUid = state.players.p1.prizes[4] as string;
    expect(state.cardIdByUid[shownUid]).toBe("d548-shown");
    const p1 = redactGame(state, "p1").board.you;
    const p2 = redactGame(state, "p2").board.opponent;
    const spectator = redactGame(state, "p1", true).board.you;
    for (const side of [p1, p2, spectator]) {
      expect(side.prizesRemaining).toBe(6);
      expect(side.faceUpPrizes).toHaveLength(1);
      expect(side.faceUpPrizes[0]?.index).toBe(4);
      expect(side.faceUpPrizes[0]?.card.cardId).toBe("d548-shown");
      expect(side.faceUpPrizes[0]?.card.id).toBe(shownUid);
      expect(redactedSideSchema.parse(side)).toEqual(side);
    }
    expect(redactGame(state, "p2").board.you.faceUpPrizes).toEqual([]);
  });

  it("🛑 no FACE-DOWN prize uid or card id appears anywhere in any viewer's JSON", () => {
    const state = flipped();
    const faceDown = (["p1", "p2"] as const).flatMap((seat) =>
      state.players[seat].prizes.filter((u) => !state.players[seat].faceUpPrizes.includes(u)),
    );
    expect(faceDown).toHaveLength(11);
    for (const view of [
      redactGame(state, "p1"),
      redactGame(state, "p2"),
      redactGame(state, "p1", true),
    ]) {
      const json = JSON.stringify(view);
      for (const uid of faceDown) expect(json.includes(`"${uid}"`), uid).toBe(false);
      // Every `d548-secret` in the game is a face-down prize, so the id cannot leak by
      // appearing anywhere else — and it does not appear at all.
      expect(json.includes("d548-secret")).toBe(false);
      expect(json.includes("d548-shown")).toBe(true);
    }
  });

  it("the choosePrize prompt crosses as INDICES only, to the answerer alone", () => {
    const offered = confirm(purge(ready({ stacked: true })).state, true).state;
    const mine = redactGame(offered, "p1").phase;
    expect(mine).toEqual({
      kind: "effect:choose",
      prompt: {
        kind: "choosePrize",
        indices: [0, 1, 2, 3, 4, 5],
        note: "Choose 1 of your face-down Prize cards to turn face up.",
      },
    });
    if (mine.kind === "effect:choose" && mine.prompt !== null) {
      expect(redactedEffectPromptSchema.parse(mine.prompt)).toEqual(mine.prompt);
    }
    expect(redactGame(offered, "p2").phase).toEqual({ kind: "effect:choose", prompt: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — §14: a face-up prize still counts.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — §14: face-up prizes still count, and taking the last one wins", () => {
  it("🛑 a flip leaves `prizesRemaining` and every prizes-remaining reading unchanged", () => {
    const start = ready();
    const done = pick(confirm(purge(start).state, true).state, 1).state;
    expect(done.players.p1.prizes).toHaveLength(6);
    expect(redactGame(done, "p1").board.you.prizesRemaining).toBe(6);
    // `yourPrizesRemaining` (D-era prizes-remaining member) reads the WHOLE row: 6 before,
    // 6 after, and it would read 5 if a flip were mistaken for a take.
    expect(conditionHolds(start, "p1", { kind: "yourPrizesRemaining", counts: [6] })).toBe(true);
    expect(conditionHolds(done, "p1", { kind: "yourPrizesRemaining", counts: [6] })).toBe(true);
    // …and the opponent's `morePrizesThanOpponent` reading is unmoved (6 vs 6).
    expect(conditionHolds(done, "p2", { kind: "morePrizesThanOpponent" })).toBe(false);
    expect(done.phase.kind).not.toBe("gameOver");
  });

  it("🛑 the LAST prize, turned face up by the Purge that KOs, is taken and WINS", () => {
    const start = ready({ prizes: 1, defender: "d548-frail" });
    const only = start.players.p1.prizes[0];
    const { state: done, events } = confirm(purge(start).state, true);
    expect(all(events, "PRIZE_TURNED_FACE_UP").map((e) => e.uid)).toEqual([only]);
    expect(all(events, "PRIZES_TAKEN").map((e) => e.uids)).toEqual([[only]]);
    expect(done.players.p1.prizes).toEqual([]);
    expect(done.players.p1.faceUpPrizes).toEqual([]);
    expect(done.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p1", reason: "prizesTaken" },
    });
  });

  it("…and the last prize taken FACE DOWN (two declined Purges, 80 + 80 into 150) wins the same way", () => {
    let state = ready({ prizes: 1, defender: "d548-frail" });
    const only = state.players.p1.prizes[0];
    state = confirm(purge(state).state, false).state; // 80 into 150: no Knock Out yet
    expect(defenderDamage(state)).toBe(80);
    state = nextP1Turn(state);
    const { state: done, events } = confirm(purge(state).state, false);
    expect(all(events, "PRIZE_TURNED_FACE_UP")).toEqual([]);
    expect(all(events, "PRIZES_TAKEN").map((e) => e.uids)).toEqual([[only]]);
    expect(done.players.p1.faceUpPrizes).toEqual([]);
    expect(done.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p1", reason: "prizesTaken" },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — THE LOG NAMES THE CARD.
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 — the log row names the turned card (it is public)", () => {
  it("🛑 'turned d548-shown face up (Prize 5)'", () => {
    const offered = confirm(purge(ready({ stacked: true })).state, true).state;
    const { state, events } = pick(offered, 4);
    expect(rowText(state, events, "face up")).toContain("turned d548-shown face up (Prize 5)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §11 — THE BUMP'S MEASUREMENT: a reconstructed v31 state THROWS.
// ─────────────────────────────────────────────────────────────────────────────

describe("§11 — MATCH_RECORD_VERSION 31 → 32: a v31 state without the key throws (🆕🆕🆕 this slice's bump; the record is v33 since D549; 34 since D552; 35 since D556; 36 since D564; 37 since D570; 38 since D575; 39 since D576; 40 since D577; 41 since D579; 42 since D583; 43 since D621; 44 since D630; 45 since D636; 46 since D637; 47 since D640; 48 since D643; 49 since D646 and still carries the field)", () => {
  const v31 = (state: GameState): GameState => {
    const strip = (seat: Seat) => {
      const { faceUpPrizes: _dropped, ...rest } = state.players[seat];
      return rest as unknown as GameState["players"][Seat];
    };
    return { ...state, players: { p1: strip("p1"), p2: strip("p2") } };
  };

  it("🛑 every projection throws (redactedSideOf reads the key for every prize)", () => {
    expect(() => redactGame(v31(ready()), "p1")).toThrow(TypeError);
    expect(() => redactGame(v31(ready()), "p2", true)).toThrow(TypeError);
  });

  it("🛑 every prize take throws (resolveTakePrizes prunes the key)", () => {
    const koed = confirm(purge(ready({ defender: "d548-frail" })).state, false).state;
    const next = confirm(purge(nextP1Turn(koed)).state, false).state;
    expect(next.phase.kind).toBe("ko:takePrizes");
    expect(() => applyAction(v31(next), { type: "takePrizes", seat: "p1", prizeIndices: [0] })).toThrow(
      TypeError,
    );
  });

  it("the constant is 49 (🆕🆕🆕 D646 stepped it 48 → 49; D643 stepped it 47 → 48; D640 stepped it 46 → 47; D637 stepped it 45 → 46; D636 stepped it 44 → 45; D630 stepped it 43 → 44; D621 stepped it 42 → 43; D583 stepped it 41 → 42; D579 stepped it 40 → 41; D577 stepped it 39 → 40; D576 stepped it 38 → 39; D575 stepped it 37 → 38; D570 stepped it 36 → 37; D564 stepped it 35 → 36; D556 stepped it 34 → 35; D552 stepped it 33 → 34; D549 stepped it 32 → 33; this slice's own bump was 31 → 32) and the engine is 0.555.0", () => {
    expect(raw("/match.ts")).toContain("export const MATCH_RECORD_VERSION = 49;");
    expect(engineVersion).toBe("0.555.0");
    expect(manifest.version).toBe("0.555.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12 — THE VALIDATOR, and the zero-face-down no-op.
// ─────────────────────────────────────────────────────────────────────────────

describe("§12 — validateChoice refuses out-of-range, face-up and multi-index answers", () => {
  const second = () => {
    let state = ready();
    state = pick(confirm(purge(state).state, true).state, 2).state;
    return confirm(purge(nextP1Turn(state)).state, true).state;
  };
  const refuse = (state: GameState, choice: unknown) =>
    expectErr(
      state,
      { type: "resolveEffect", seat: "p1", choice } as unknown as GameAction,
      "BAD_EFFECT_CHOICE",
    );

  it("🛑 an index the row does not have", () => {
    refuse(second(), { kind: "prize", index: 9 });
    refuse(second(), { kind: "prize", index: -1 });
  });

  it("🛑 a FACE-UP index — slot 2 is already turned and is not offered", () => {
    const state = second();
    expect(promptOf(state)).toMatchObject({ indices: [0, 1, 3, 4, 5] });
    refuse(state, { kind: "prize", index: 2 });
  });

  it("🛑 more than one index, a string, a fraction, or the wrong answer kind", () => {
    const state = second();
    refuse(state, { kind: "prize", index: [0, 1] });
    refuse(state, { kind: "prize", index: "0" });
    refuse(state, { kind: "prize", index: 0.5 });
    refuse(state, { kind: "attack", index: 0 });
  });

  it("ZERO face-down prizes: the op is an honest SILENT no-op (unreachable behind the gate)", () => {
    let state = ready({ prizes: 1 });
    state = confirm(purge(state).state, true).state;
    expect(conditionHolds(state, "p1", { kind: "yourFaceDownPrizeRemains" })).toBe(false);
    const events: GameEvent[] = [];
    const result = runProgram(state, [{ op: "turnPrizeFaceUp" }], { seat: "p1", invokedBy: "attack" }, events);
    expect(result.kind).toBe("done");
    expect(result.state).toBe(state);
    expect(events).toEqual([]);
  });
});
