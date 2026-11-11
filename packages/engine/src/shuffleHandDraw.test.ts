import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, ATTACK_READERS } from "./effects";
import type { GameState } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  HAND_DRAW_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  handToDeck,
  mustApply,
  setActiveFromDeck,
  trimDeckTo,
  types,
  findEvent,
} from "./testFixtures";

const attack = { type: "attack", seat: "p1", index: 0 } as const;

const READERS = ATTACK_READERS.map(({ read }) => read);

const PRINTED = "Shuffle your hand into your deck. Then, draw 6 cards.";

const DERIVED_COUNT =
  "Shuffle your hand into your deck. Then, draw a card for each card in your opponent's hand.";

const SIBLING = "Discard your hand and draw 6 cards.";

const UNREAD_COUNT_SOURCE =
  "Shuffle your hand into your deck. Then, draw a card for each card in your hand.";

/** THE PROGRAM, spelled once and reused, so a case cannot pass against a hand-copied
    literal that has drifted from what the file means by it. */
const program = (count: number) => [
  { op: "handRefresh", who: "you", draw: { kind: "fixed", count } },
];

const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, transcribed rather than recognised.
// ─────────────────────────────────────────────────────────────────────────────

describe("D479 §1 — the printed data, measured live over the legal column", () => {
  it("the sentence is the CORPUS's bytes at ONE printing, and so is its near-miss", () => {
    const rows = new Map(legalAttackCorpus().map(([n, text]) => [text, n]));
    expect(rows.get(PRINTED)).toBe(1);
    expect(rows.get(DERIVED_COUNT)).toBe(1);
    expect(rows.get(SIBLING)).toBe(7);
    expect([1, units(legalAttackCorpus().filter(([, s]) => s === PRINTED))]).toEqual([1, 1]);
    expect(PRINTED.includes("é")).toBe(false);
    expect(DERIVED_COUNT.includes("opponent's")).toBe(true);
    expect(DERIVED_COUNT.includes("opponent’s")).toBe(false);
    expect(DERIVED_COUNT.codePointAt(DERIVED_COUNT.indexOf("'"))).toBe(0x0027);
  });

  it("the column prints ONE count for this skeleton, and it is 6", () => {
    const family = legalAttackCorpus().filter(([, s]) =>
      /^Shuffle your hand into your deck\. Then, draw /.test(s),
    );
    expect(family.map(([, s]) => s).sort()).toEqual([DERIVED_COUNT, PRINTED].sort());
    expect(units(family)).toBe(2);
  });

  it("D479 — the sentence is now RESOLVED, and by exactly one reader", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(deriveAttackEffect(PRINTED)).toEqual(program(6));
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(PRINTED), read.name).toBeNull();
    }
    expect(resolvedByAnyReader(DERIVED_COUNT)).toBe(true);
    expect(deriveAttackEffect(DERIVED_COUNT)).toEqual([
      { op: "handRefresh", who: "you", draw: { kind: "opponentHandSize" } },
    ]);
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(DERIVED_COUNT), read.name).toBeNull();
    }
    // …and the two programs are the SAME op with the SAME seat and differ in `draw` only.
    const near = deriveAttackEffect(DERIVED_COUNT);
    const base = deriveAttackEffect(PRINTED);
    expect(near).toHaveLength(1);
    expect(base).toHaveLength(1);
    expect({ ...near?.[0], draw: null }).toEqual({ ...base?.[0], draw: null });
    expect(near).not.toEqual(base);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reading, and why the count is CAPTURED.
// ─────────────────────────────────────────────────────────────────────────────

describe("D479 §2 — the program, read against the TRAINER column's hand-authored rows", () => {
  it("the count is a printed PARAMETER, and `registry.ts` is the evidence", () => {
    expect(deriveAttackEffect("Shuffle your hand into your deck. Then, draw 5 cards.")).toEqual(
      programFor("sv01-198")?.trainer,
    );
    expect(deriveAttackEffect("Shuffle your hand into your deck. Then, draw 8 cards.")).toEqual(
      programFor("sv01-177")?.trainer,
    );
    // …and the two really are DIFFERENT programs, so the pair above is not one assertion
    // written twice.
    expect(programFor("sv01-198")?.trainer).not.toEqual(programFor("sv01-177")?.trainer);
    expect(programFor("sv01-177")?.trainerEndsTurn).toBe(true);
    expect(programFor("sv01-198")?.trainerEndsTurn).toBeUndefined();
  });

  it("a printed 0 stays LOUD, and 1 does not", () => {
    expect(deriveAttackEffect("Shuffle your hand into your deck. Then, draw 0 cards.")).toBeNull();
    expect(deriveAttackEffect("Shuffle your hand into your deck. Then, draw 1 cards.")).toEqual(
      program(1),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the refusals, each pinned on ONE printed byte.
// ─────────────────────────────────────────────────────────────────────────────

describe("D479 §3 — the refusals, each pinned on ONE printed byte", () => {
  it("the VERB refuses BOTH WAYS, and that is the disjointness stated as behaviour", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(program(6));
    expect(deriveAttackEffect(SIBLING)).not.toEqual(program(6));
    expect(deriveAttackEffect(SIBLING)).toEqual([
      { op: "discardHand" },
      { op: "drawCards", count: 6 },
    ]);
    expect(PRINTED.startsWith("Shuffle ")).toBe(true);
    expect(SIBLING.startsWith("Discard ")).toBe(true);
  });

  it("the COUNT, the SEAT, the DESTINATION and the JOIN refuse INDEPENDENTLY", () => {
    expect(deriveAttackEffect(DERIVED_COUNT)).not.toEqual(program(6));
    expect(deriveAttackEffect(DERIVED_COUNT)?.[0]).toMatchObject({
      draw: { kind: "opponentHandSize" },
    });
    expect(
      deriveAttackEffect(
        "Shuffle your hand into your deck. Then, draw a card for each card in your hand.",
      ),
    ).toBeNull();
    // …the SEAT alone: the printed subject is "your", and `who: "opponent"` /
    // `who: "both"` are the op's other two values. Neither spelling is printed in the
    // attack column, and admitting either would empty a hand this sentence never names.
    expect(
      deriveAttackEffect("Shuffle your opponent's hand into their deck. Then, draw 6 cards."),
    ).toBeNull();
    expect(
      deriveAttackEffect("Each player shuffles their hand into their deck. Then, draw 6 cards."),
    ).toBeNull();
    expect(
      deriveAttackEffect("Shuffle their hand into their deck. Then, draw 6 cards."),
    ).toBeNull();
    expect(deriveAttackEffect("Shuffle your hand into their deck. Then, draw 6 cards.")).toBeNull();
    // …the DESTINATION alone: `toBottom` is Iono's placement and a DIFFERENT program
    // (the deck's order survives). The sentence that prints it is a Supporter's, not an
    // attack's, and this arm must not answer it.
    expect(
      deriveAttackEffect(
        "Shuffle your hand and put it on the bottom of your deck. Then, draw 6 cards.",
      ),
    ).toBeNull();
    expect(deriveAttackEffect("Shuffle your hand into your deck and draw 6 cards.")).toBeNull();
  });

  it("the anchor is WHOLE-SENTENCE — a leading or trailing clause is refused", () => {
    for (const text of [
      `Draw a card. ${PRINTED}`,
      `${PRINTED} Your turn ends.`,
      `${PRINTED} If you do, this attack does 60 more damage.`,
      // Case is load-bearing: no reader in `effects.ts` carries an `/i`.
      PRINTED.toLowerCase(),
      PRINTED.toUpperCase(),
      // The trailing period is required — the failure mode this repo names first,
      // because a regex written from a paraphrase matches no real card.
      "Shuffle your hand into your deck. Then, draw 6 cards",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });
});

function withEffect(state: GameState, effect: string): GameState {
  const card = state.cardPool["fix-handdraw"];
  if (card === undefined) throw new Error("no fix-handdraw in pool");
  const attacks = card.attacks ?? [];
  const first = attacks[0];
  if (first === undefined) throw new Error("fix-handdraw has no attack 0");
  return {
    ...state,
    cardPool: {
      ...state.cardPool,
      "fix-handdraw": { ...card, attacks: [{ ...first, effect }, ...attacks.slice(1)] },
    },
  };
}

function fielded(seed: number, effect: string = PRINTED): GameState {
  const opened = mustApply(
    driveSetup(seed, { p1: HAND_DRAW_DECK, p2: HAND_DRAW_DECK }, { first: "p2" }),
    { type: "endTurn", seat: "p2" },
  ).state;
  let state = setActiveFromDeck(opened, "p1", "fix-handdraw");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return withEffect(state, effect);
}

/** Every card id `HAND_DRAW_DECK` prints, so "empty the hand" is a statement about the
    deck list rather than about one seed's draw. */
const DECK_IDS = ["fix-handdraw", "fix-bigbody", "fix-item", "fix-energy"] as const;

/** TEST SURGERY, composed from the shipped helper: return P1's whole hand to the bottom
    of their deck. */
function emptyHand(state: GameState): GameState {
  let next = state;
  for (const id of DECK_IDS) next = handToDeck(next, "p1", id);
  return next;
}

const sorted = (uids: readonly string[]) => [...uids].sort();

describe("D479 §4 — WHICH PILE, read off UIDS because a count cannot see it", () => {
  it("the old hand ends in the DECK and NOT in the discard — the whole difference from arm 44", () => {
    const state = fielded(1);
    const before = state.players.p1;
    const oldHand = [...before.hand];
    const oldDeck = [...before.deck];
    const oldDiscard = [...before.discard];
    expect(oldHand.length).toBeGreaterThan(0);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, attack);

    expect(types(events)).not.toContain("HAND_DISCARDED");
    expect(done.players.p1.discard).toEqual(oldDiscard);
    for (const uid of oldHand) expect(done.players.p1.discard).not.toContain(uid);
    // …and every one of them is in the deck OR back in the hand (the shuffle can deal a
    // card straight back), which is exactly "it went into the deck and then six came
    // off it".
    for (const uid of oldHand) {
      expect([...done.players.p1.deck, ...done.players.p1.hand]).toContain(uid);
    }
    expect(sorted([...done.players.p1.hand, ...done.players.p1.deck])).toEqual(
      sorted([...oldHand, ...oldDeck]),
    );
    expect(done.players.p1.hand).toHaveLength(6);
    expect(done.players.p1.deck).toHaveLength(oldHand.length + oldDeck.length - 6);
  });

  it("the EVENT is the shuffle's and not the discard's, and it is COUNT-ONLY", () => {
    const state = fielded(2);
    const handCount = state.players.p1.hand.length;
    const { events } = mustApply(state, attack);
    expect(findEvent(events, "HAND_SHUFFLED_INTO_DECK")).toMatchObject({
      seat: "p1",
      count: handCount,
    });
    expect(types(events)).not.toContain("HAND_DISCARDED");
    expect(types(events)).not.toContain("HAND_TO_BOTTOM_OF_DECK");
    expect(findEvent(events, "CARDS_DRAWN")).toMatchObject({ seat: "p1", reason: "effect" });
    expect(findEvent(events, "CARDS_DRAWN")?.uids).toHaveLength(6);
  });

  it("the op runs at the attack's TAIL, after the damage, and the printed BASE is KEPT", () => {
    const state = fielded(3);
    const { state: done, events } = mustApply(state, attack);
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "HAND_SHUFFLED_INTO_DECK",
      "CARDS_DRAWN",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(done.players.p2.active?.damage).toBe(30);
  });

  it("neither half of `ATTACK_EFFECT_SKIPPED` fires, and nothing parks", () => {
    const state = fielded(4);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, attack);
    expect(types(events)).toContain("ATTACK_DECLARED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(done.phase.kind).not.toBe("effect:choose");
  });
});

describe('D479 §5 — the SEAT: `who: "you"` is the printed subject, not a default', () => {
  it("the OPPONENT's hand, deck and discard are BYTE-UNCHANGED", () => {
    const state = fielded(5);
    const before = state.players.p2;
    const oldHand = [...before.hand];
    const oldDeck = [...before.deck];
    const oldDiscard = [...before.discard];
    expect(oldHand.length).toBeGreaterThan(0);
    const { state: done, events } = mustApply(state, attack);
    for (const uid of oldHand) expect(done.players.p2.hand).toContain(uid);
    expect(done.players.p2.hand).toHaveLength(oldHand.length + 1);
    // …and P2's deck lost exactly that ONE card off its TOP and was never reshuffled:
    // the tail is byte-identical, which a shuffle could not leave.
    expect(done.players.p2.deck).toEqual(oldDeck.slice(1));
    expect(done.players.p2.discard).toEqual(oldDiscard);
    expect(
      events.filter((e) => e.type === "HAND_SHUFFLED_INTO_DECK" && e.seat === "p2"),
    ).toHaveLength(0);
    expect(
      events.filter((e) => e.type === "CARDS_DRAWN" && e.seat === "p2" && e.reason === "effect"),
    ).toHaveLength(0);
  });
});

describe("D479 §6 — the falsifiers, driven rather than argued", () => {
  it("FALSIFIER 1 — an EMPTY hand still reshuffles and still draws SIX", () => {
    const state = emptyHand(fielded(6));
    expect(state.players.p1.hand).toEqual([]);
    const oldDeck = [...state.players.p1.deck];
    const { state: done, events } = mustApply(state, attack);
    expect(findEvent(events, "HAND_SHUFFLED_INTO_DECK")).toMatchObject({ seat: "p1", count: 0 });
    expect(done.players.p1.hand).toHaveLength(6);
    expect(sorted([...done.players.p1.hand, ...done.players.p1.deck])).toEqual(sorted(oldDeck));
  });

  it("FALSIFIER 2 — a SHORT pile draws what is there and costs no rule", () => {
    const state = trimDeckTo(emptyHand(fielded(7)), "p1", 4);
    expect(state.players.p1.hand).toEqual([]);
    const pile = [...state.players.p1.deck];
    expect(pile).toHaveLength(4);
    const { state: done, events } = mustApply(state, attack);
    expect(findEvent(events, "CARDS_DRAWN")?.uids).toHaveLength(4);
    expect(sorted(done.players.p1.hand)).toEqual(sorted(pile));
    expect(done.players.p1.deck).toEqual([]);
    // §14.3's deck-out is checked at the DRAW, not here — so the board is NOT over.
    expect(done.phase.kind).not.toBe("gameOver");
  });

  it("ZERO-MATCH BOARD — the near-miss on the SAME body is SILENT, and loudly so", () => {
    const state = fielded(8, UNREAD_COUNT_SOURCE);
    const before = state.players.p1;
    const oldHand = [...before.hand];
    const oldDeck = [...before.deck];
    const { state: done, events } = mustApply(state, attack);
    // The damage still lands — the attack RESOLVED; it is the EFFECT that is unread.
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    // …and the engine says so out loud rather than resolving quietly.
    expect(types(events)).toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("HAND_SHUFFLED_INTO_DECK");
    expect(types(events)).not.toContain("HAND_DISCARDED");
    // Every zone is where it was.
    expect(done.players.p1.hand).toEqual(oldHand);
    expect(done.players.p1.deck).toEqual(oldDeck);
  });
});

describe("D479 §7 — what this slice did NOT buy, measured", () => {
  it("`FIXTURE_POOL` is BYTE-UNCHANGED — the demonstrator is a per-board clone", () => {
    expect(FIXTURE_POOL["fix-handdraw"]?.attacks).toEqual([
      { cost: ["Colorless"], name: "Hand Refresh", damage: "30", effect: SIBLING },
    ]);
  });
});
