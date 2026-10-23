import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, conditionHolds, conditionNote, programFor } from "./index";
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  deckOf,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setPrizes,
  trainerCard,
  types,
  driveSetup,
} from "./testFixtures";

const LACEY_TEXT =
  "Shuffle your hand into your deck. Then, draw 4 cards. If your opponent has 3 or fewer Prize cards remaining, draw 8 cards instead.";
const HYPE_TEXT =
  "Draw 2 cards. If your opponent has 3 or fewer Prize cards remaining, draw 2 more cards.";

const LACEY_IDS = ["sv07-139", "sv07-166", "sv07-172", "sv08.5-114", "sv08.5-175"] as const;
const HYPE_IDS = ["sv10-163", "sv10-220"] as const;
const BRIAR_IDS = ["sv07-132", "sv07-163", "sv07-171", "sv08.5-100"] as const;

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(LACEY_IDS.map((id) => [id, trainerCard(id, "Supporter", LACEY_TEXT)])),
  ...Object.fromEntries(HYPE_IDS.map((id) => [id, trainerCard(id, "Supporter", HYPE_TEXT)])),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

// Deep enough that Lacey's 8-draw is never deck-limited, and both real ids of
// each card are in it so a reprint is driven and not merely asserted equal.
const DECK = deckOf({
  "fix-basic-1": 8,
  "sv07-139": 4,
  "sv08.5-175": 2,
  "sv10-163": 4,
  "sv10-220": 2,
  "fix-energy": 40,
});

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

/** P1 to move on turn 3 — past §4's going-first Supporter restriction, which
    matters because BOTH landed rows are Supporters. */
function board(seed: number): GameState {
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  return state;
}

/** A board where P2 (the opponent) has `oppPrizes` Prize cards REMAINING and P1
    has `ownPrizes` — deliberately different, so every assertion below is also a
    seat test. */
function withPrizes(seed: number, oppPrizes: number, ownPrizes: number): GameState {
  return setPrizes(setPrizes(board(seed), "p2", oppPrizes), "p1", ownPrizes);
}

function handCount(state: GameState, seat: Seat): number {
  return state.players[seat].hand.length;
}

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Put `cardId` into P1's hand and play it. */
function play(state: GameState, cardId: string): { state: GameState; events: GameEvent[] } {
  const withCard = handFromDeck(state, "p1", cardId, 1);
  const uid = handUid(withCard, "p1", cardId);
  return mustApply(withCard, { type: "playTrainer", seat: "p1", uid });
}

/** The two rows' gate, as authored — read off the registry rather than restated,
    so a registry edit cannot drift from the claims below. */
function gateOf(cardId: string): BoardCondition {
  const program = programFor(cardId);
  const ops = program?.trainer ?? [];
  for (const op of ops) if (op.op === "conditionGate") return op.cond;
  throw new Error(`${cardId} has no conditionGate`);
}

describe("D207 — `opponentPrizesRemaining` was ALREADY THERE", () => {
  it("is folded by conditionHolds today, at every arity the pool prints", () => {
    const state = withPrizes(21, 3, 5);
    expect(conditionHolds(state, "p1", { kind: "opponentPrizesRemaining", counts: [3] })).toBe(
      true,
    );
    expect(conditionHolds(state, "p1", { kind: "opponentPrizesRemaining", counts: [2, 4] })).toBe(
      false,
    );
    expect(
      conditionHolds(state, "p1", { kind: "opponentPrizesRemaining", counts: [2, 3, 4] }),
    ).toBe(true);
    // …and it is SEAT-RELATIVE, which is the whole content of "opponent": read
    // from p2, the number in question is P1's 5.
    expect(conditionHolds(state, "p2", { kind: "opponentPrizesRemaining", counts: [5] })).toBe(
      true,
    );
    expect(conditionHolds(state, "p2", { kind: "opponentPrizesRemaining", counts: [3] })).toBe(
      false,
    );
  });

  it("set MEMBERSHIP, not a threshold — 3 reads FALSE between two true values", () => {
    const twoFour: BoardCondition = { kind: "opponentPrizesRemaining", counts: [2, 4] };
    expect(conditionHolds(withPrizes(21, 2, 6), "p1", twoFour)).toBe(true);
    expect(conditionHolds(withPrizes(21, 3, 6), "p1", twoFour)).toBe(false);
    expect(conditionHolds(withPrizes(21, 4, 6), "p1", twoFour)).toBe(true);
  });
});

// ── 2. The gates as authored ─────────────────────────────────────────────────

describe("D207 — the authored gate is `[0, 1, 2, 3]` on both rows", () => {
  it("enumerates '3 or fewer' exactly, and 4 is outside it", () => {
    for (const id of [...LACEY_IDS, ...HYPE_IDS]) {
      expect(gateOf(id)).toEqual({ kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3] });
    }
    const gate = gateOf("sv07-139");
    expect(conditionHolds(withPrizes(22, 3, 6), "p1", gate)).toBe(true);
    expect(conditionHolds(withPrizes(22, 4, 6), "p1", gate)).toBe(false);
  });

  it("includes 0 for exactness — pinned where it is OBSERVABLE, not where it is not", () => {
    expect(conditionHolds(withPrizes(22, 0, 6), "p1", gateOf("sv10-163"))).toBe(true);
  });

  it("remaining, NEVER taken — asserted at the two counts where the two disagree", () => {
    const gate = gateOf("sv07-139");
    //   remaining 2 (taken 4): the card fires; a taken-reader would NOT.
    expect(conditionHolds(withPrizes(23, 2, 6), "p1", gate)).toBe(true);
    //   remaining 4 (taken 2): the card does NOT fire; a taken-reader WOULD.
    expect(conditionHolds(withPrizes(23, 4, 6), "p1", gate)).toBe(false);
    // And the same two points driven end to end, so the claim is about the CARD
    // and not only about the predicate.
    expect(handCount(play(withPrizes(23, 2, 6), "sv07-139").state, "p1")).toBe(8);
    expect(handCount(play(withPrizes(23, 4, 6), "sv07-139").state, "p1")).toBe(4);
  });
});

// ── 3. Lacey — the `otherwise` arm, driven ───────────────────────────────────

describe("D207 — Lacey (the printed 'instead' is a genuine if/ELSE)", () => {
  it("shuffles and draws 4 when the opponent still has 5 Prizes left", () => {
    const state = handFromDeck(withPrizes(24, 5, 6), "p1", "fix-energy", 3);
    expect(handCount(state, "p1")).toBeGreaterThan(8);
    const played = play(state, "sv07-139");
    expect(handCount(played.state, "p1")).toBe(4);
  });

  it("shuffles and draws 8 INSTEAD when the opponent is down to 3 or fewer", () => {
    const played = play(withPrizes(24, 3, 6), "sv07-139");
    expect(handCount(played.state, "p1")).toBe(8);
  });

  it("EXACTLY ONE arm runs — one shuffle event, not two", () => {
    for (const [oppPrizes, expected] of [
      [3, 8],
      [5, 4],
    ] as const) {
      const played = play(withPrizes(25, oppPrizes, 6), "sv07-139");
      expect(findAll(played.events, "HAND_SHUFFLED_INTO_DECK")).toHaveLength(1);
      expect(findAll(played.events, "CARDS_DRAWN")).toHaveLength(1);
      expect(findAll(played.events, "CARDS_DRAWN")[0]?.uids).toHaveLength(expected);
    }
  });

  it("the seats are not crossed — P1's OWN Prize count never moves the gate", () => {
    expect(handCount(play(withPrizes(26, 5, 2), "sv07-139").state, "p1")).toBe(4);
    //   opponent 2 / own 5 → bonus (a crossed reader would give 4).
    expect(handCount(play(withPrizes(26, 2, 5), "sv07-139").state, "p1")).toBe(8);
  });

  it("the branches are not swapped — MANY Prizes left is the SMALL draw", () => {
    // The author's mistake is putting the 8 in `otherwise`. At the extremes:
    expect(handCount(play(withPrizes(27, 6, 6), "sv07-139").state, "p1")).toBe(4);
    expect(handCount(play(withPrizes(27, 1, 6), "sv07-139").state, "p1")).toBe(8);
  });

  it("emits NO event for the gate itself — a public condition is not news", () => {
    const played = play(withPrizes(28, 2, 6), "sv07-139");
    expect(types(played.events)).toEqual([
      "TRAINER_PLAYED",
      "HAND_SHUFFLED_INTO_DECK",
      "CARDS_DRAWN",
    ]);
  });

  it("all five printings are one program object, and the reprint is DRIVEN", () => {
    const first = programFor(LACEY_IDS[0]);
    expect(first).toBeDefined();
    for (const id of LACEY_IDS) expect(programFor(id)).toBe(first);
    // Not merely identical by reference: a second real id played through the
    // engine, because `programFor` being shared is not the same claim as the
    // reprint being PLAYABLE (it must also be in the pool and pass §7.2).
    expect(handCount(play(withPrizes(29, 2, 6), "sv08.5-175").state, "p1")).toBe(8);
  });
});

// ── 4. Emcee's Hype — the one-armed gate ─────────────────────────────────────

describe("D207 — Emcee's Hype ('2 MORE' is additive where Lacey's 'instead' replaces)", () => {
  it("draws exactly 2 with the opponent at 4 Prizes remaining", () => {
    const state = withPrizes(31, 4, 6);
    const before = handCount(state, "p1");
    const played = play(state, "sv10-163");
    // +1 for the Hype put into hand, −1 for playing it, +2 drawn.
    expect(handCount(played.state, "p1")).toBe(before + 2);
    expect(findAll(played.events, "CARDS_DRAWN")).toHaveLength(1);
  });

  it("draws 2 MORE (4 total, as two separate draws) at 3 or fewer", () => {
    const state = withPrizes(31, 3, 6);
    const before = handCount(state, "p1");
    const played = play(state, "sv10-163");
    expect(handCount(played.state, "p1")).toBe(before + 4);
    // Two ops, not one merged count of 4 — the log reads as the card does.
    expect(findAll(played.events, "CARDS_DRAWN").map((d) => d.uids.length)).toEqual([2, 2]);
  });

  it("never SHUFFLES — the two rows share a gate and nothing else", () => {
    const state = handFromDeck(withPrizes(32, 2, 6), "p1", "fix-energy", 3);
    const before = handCount(state, "p1");
    const played = play(state, "sv10-163");
    expect(findAll(played.events, "HAND_SHUFFLED_INTO_DECK")).toHaveLength(0);
    expect(handCount(played.state, "p1")).toBe(before + 4);
  });

  it("the seats are not crossed here either", () => {
    const many = withPrizes(33, 5, 2);
    expect(handCount(play(many, "sv10-163").state, "p1")).toBe(handCount(many, "p1") + 2);
    const few = withPrizes(33, 2, 5);
    expect(handCount(play(few, "sv10-163").state, "p1")).toBe(handCount(few, "p1") + 4);
  });

  it("both printings are one program, and the reprint is DRIVEN", () => {
    const first = programFor(HYPE_IDS[0]);
    expect(first).toBeDefined();
    for (const id of HYPE_IDS) expect(programFor(id)).toBe(first);
    const state = withPrizes(34, 1, 6);
    expect(handCount(play(state, "sv10-220").state, "p1")).toBe(handCount(state, "p1") + 4);
  });
});

// ── 5. What did NOT land, and what turns each flag red ────────────────────────

describe("D207 → D568 — Briar was UNBUILT; the guard fired, and the datum it asked for exists", () => {
  it("D568 — ONE program on all four printings, with the gate at [2] and the Tera attacker filter", () => {
    const first = programFor(BRIAR_IDS[0]);
    expect(first).toBeDefined();
    for (const id of BRIAR_IDS) expect(programFor(id)).toBe(first);
    expect(first?.trainerPlayableIf).toEqual({ kind: "opponentPrizesRemaining", counts: [2] });
    expect(first?.supporterKoPrizeBonus).toEqual({
      amount: 1,
      attacker: { kind: "bannerPokemon", banner: "Tera" },
    });
  });

  it("but its GATE is free — the refusal is the SECOND sentence, priced honestly", () => {
    const gate: BoardCondition = { kind: "opponentPrizesRemaining", counts: [2] };
    expect(conditionHolds(withPrizes(35, 2, 6), "p1", gate)).toBe(true);
    expect(conditionHolds(withPrizes(35, 3, 6), "p1", gate)).toBe(false);
    // …and the printed clause round-trips through `conditionNote` verbatim, which
    // is what a `trainerPlayableIf` would surface in the HUD.
    expect(conditionNote(gate)).toBe("your opponent has exactly 2 Prize cards remaining");
  });
});

describe("D207 — `conditionNote` and the '3 or fewer' wording, flagged not papered", () => {
  it("would MISREPORT this slice's gate — and is never asked, because these are conditionGates", () => {
    expect(conditionNote(gateOf("sv07-139"))).toBe(
      "your opponent has exactly 0, 1, 2, or 3 Prize cards remaining",
    );
    for (const id of [...LACEY_IDS, ...HYPE_IDS]) {
      expect(programFor(id)?.trainerPlayableIf).toBeUndefined();
    }
  });
});

// ── 6. Persistence ───────────────────────────────────────────────────────────

describe("D207 — MATCH_RECORD_VERSION stays 12, derived rather than assumed", () => {
  it("NEITHER row parks, so nothing new reaches `GameState.phase`", () => {
    for (const [id, oppPrizes] of [
      ["sv07-139", 2],
      ["sv07-139", 5],
      ["sv10-163", 2],
      ["sv10-163", 5],
    ] as const) {
      const played = play(withPrizes(36, oppPrizes, 6), id);
      expect(played.state.phase.kind).toBe("turn:action");
    }
    expect(gateOf("sv07-139").kind).toBe("opponentPrizesRemaining");
  });
});
