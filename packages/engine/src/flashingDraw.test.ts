import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, programFor, programPlayable } from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// D222 — FLASHING DRAW (Iono's Kilowattrel), and the `from: "self"` MEMBER
// D190 REFUSED TO BUILD IT WITHOUT — plus the `programPlayable` parameter that
// turned out to be the larger half of the price.
//
// "You must discard a Basic {L} Energy from this Pokémon in order to use this
// Ability. Once during your turn, you may draw cards until you have 6 cards in
// your hand."
//
// ⚠️ **THE SECOND OF D190's FOUR `DROPPED` ROWS TO BE COLLECTED**, row 3 of
// `docs/reference/coverage-backlog-legal.md`'s ranked table, and the second
// consecutive slice in which that table's `needs` string matched the landed diff.
// The exact piece it named:
//
//   **A `from: "self"` MEMBER ON `discardEnergy`.** The members that existed were
//   `opponentActive` / `opponentChosen` / `yourActive` / `yours` (+ the
//   `opponentEach` sweep), and `yourActive` means "this Pokémon" only inside an
//   ATTACK, where §8 makes the actor the Active. This sentence is an ABILITY's
//   and carries NO Active clause, so with `yourActive` a BENCHED Kilowattrel
//   would pay its cost off whichever body happened to be Active — and would be
//   USABLE while holding no {L} of its own.
//
// ⚠️ **AND THE PIECE THE RESUME POINT TOLD THIS SLICE TO PRICE FIRST, WHICH WAS
// RIGHT TO INSIST: `programPlayable` COULD NOT ASK THE QUESTION.** "You MUST
// discard … IN ORDER TO USE this Ability" is a COST, not a target — so the gate
// has to answer "does THIS body hold a matching Energy", and it took no
// `sourceUid`. D221's `attachEnergyFrom.toSelf` needed no such change ONLY
// because its un-narrowed target set always contains the host; a discard's does
// not. The parameter is optional, and its ABSENCE is a fact rather than a
// default: a Trainer has no "this Pokémon", so a `self` op in one is refused.
//
// ⚠️ WHAT THIS SUITE CAN PUT RED, SAID UP FRONT (the guard rule, conventions.md):
// * Authoring `from: "yourActive"` instead — the exact narrowing D190 refused —
//   fails the two BENCH tests: the discard comes off the Active, and a benched
//   host holding no {L} is allowed to activate off the Active's.
// * Dropping the `sourceUid` argument at `useAbility`'s gate (or inside
//   `discardEnergyPlayable`) fails "REFUSED when THIS body holds no {L} but the
//   Active does" — the board is deliberately built so the two answers differ.
// * Swapping `drawUntilHandSize` for `drawCards` fails BOTH draw tests in
//   opposite directions (a short hand under-draws, a full hand over-draws).
// * Widening the filter to `anyEnergy` fails "a {C} on the host does not pay it".
// * Every board below holds Basic {L} Energy on TWO different Pokémon, so no
//   assertion here can pass by there being only one thing to take.

/** The three Standard-legal printings, from `registryOnlyPrograms.test.ts`'s own
    `DROPPED` enumeration (D190, measured against the remote D1 on 2026-08-04). */
const FLASHING_DRAW_IDS = ["svp-182", "sv09-055", "sv09-163"] as const;

/** The printed sentence, byte for byte — authored against the print rather than
    against a paraphrase (D183's class). */
const FLASHING_DRAW_TEXT =
  "You must discard a Basic {L} Energy from this Pokémon in order to use this Ability. Once during your turn, you may draw cards until you have 6 cards in your hand.";

// ── The demonstrator pool. `fix-flashingdraw` is a SYNTHETIC body carrying the
//    real program: a fixture id naming a real printing must appear in
//    `catalogManifest.ts`, which is generated off a local sqlite this clone does
//    not have and which holds none of `svp` / `sv09` anyway. D190's idiom. ──

const LOCAL_CARDS: Record<string, Card> = {
  /** fix-flashingdraw — a {L} Basic with the activated Ability and nothing else.
      No attacks: it is only ever asked to pay its own cost. */
  "fix-flashingdraw": battler("fix-flashingdraw", {
    name: "fix-flashingdraw",
    types: ["Lightning"],
    hp: 120,
    retreat: 1,
    abilities: [{ type: "Ability", name: "Flashing Draw", effect: FLASHING_DRAW_TEXT }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** ⚠️ `fix-lightning-1` IS THE LOAD-BEARING FIXTURE HERE AND IT IS REUSED, NOT
    WRITTEN — the FIXTURE_POOL sweep first (D196). It is a {L} Basic with no
    Ability of its own: the OTHER body that can hold a Basic {L} Energy, which is
    exactly what `yourActive` would have taken the cost off. */
const DECK = deckOf({
  "fix-flashingdraw": 4,
  "fix-lightning-1": 4,
  "fix-bigbody": 20, // 200 HP dominant Basic — mulligan-free setup
  "fix-lightning-energy": 16,
  "fix-energy": 16,
});

const useFlashingDraw = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "active" },
  abilityName: "Flashing Draw",
} as const;

const useFlashingDrawFromBench = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "bench", index: 0 },
  abilityName: "Flashing Draw",
} as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** `driveSetup` against the LOCAL pool — `testFixtures.ts`'s own closes over
    `FIXTURE_POOL`, and `createGame` takes its `cardPool` as a PARAMETER. */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** Setup, then open P1's turn (P2 went first and passed). */
function board(seed: number): GameState {
  return mustApply(localSetup(seed, "p2"), { type: "endTurn", seat: "p2" }).state;
}

/** P1's hand cut to exactly `size` cards, the surplus returned to the deck — the
    one board variable this Ability reads, and the opening hand's size is a
    property of the SEED rather than of the card. Legal-shaped (every uid stays in
    exactly one zone), like every other helper in `testFixtures.ts`. */
function handSize(state: GameState, size: number): GameState {
  const side = state.players.p1;
  if (side.hand.length < size) throw new Error(`p1 holds ${side.hand.length}, needed ${size}`);
  return {
    ...state,
    players: {
      ...state.players,
      p1: { ...side, hand: side.hand.slice(0, size), deck: [...side.deck, ...side.hand.slice(size)] },
    },
  };
}

/** The Ability's authored program, read off the registry rather than retyped —
    so the `programPlayable` probes below cannot drift from what the card runs. */
function flashingDrawProgram(): readonly EffectOp[] {
  const program = programFor("svp-182")?.abilities?.[0]?.program;
  if (program === undefined) throw new Error("Flashing Draw has no program");
  return program;
}

describe("D222 — the registry rows", () => {
  it("maps all THREE Standard-legal printings, plus the demonstrator, to ONE object", () => {
    const first = programFor(FLASHING_DRAW_IDS[0]);
    expect(first, "svp-182 has no program").toBeDefined();
    for (const id of FLASHING_DRAW_IDS) {
      expect(programFor(id), `${id} left Flashing Draw`).toBe(first);
    }
    // A duplicated id would make the count lie about the coverage this slice
    // bought, which is the ONE number a reader carries away from it.
    expect(new Set(FLASHING_DRAW_IDS).size).toBe(3);
    expect(programFor("fix-flashingdraw"), "the demonstrator is not Flashing Draw").toBe(first);
  });

  it("authors the program EXACTLY — the self discard, the {L} filter, and the draw-to-6", () => {
    expect(programFor("sv09-055")?.abilities).toEqual([
      {
        name: "Flashing Draw",
        // The printed "Once during your turn".
        oncePerTurn: true,
        // No Active clause in the sentence, so a benched Kilowattrel pays its own
        // cost from the Bench (driven below).
        activeOnly: false,
        program: [
          {
            op: "discardEnergy",
            from: "self",
            filter: { kind: "basicEnergy", energyType: "Lightning" },
          },
          { op: "drawUntilHandSize", size: 6 },
        ],
      },
    ]);
    // `count` is ABSENT, which is the printed singular "a Basic {L} Energy" —
    // D104's minimal shape, and the field a copy of Corviknight's "Discard 2"
    // would have brought along.
    expect(programFor("sv09-055")?.abilities?.[0]?.program?.[0]).not.toHaveProperty("count");
  });

  it("does NOT share an object with the cost-then-draw twin, and leaves the neighbours unmarked", () => {
    // ⚠️ THE MISTAKE AN AUTHOR ACTUALLY MAKES: N's Zoroark ex's "Trade" (D190,
    // and the same set) is the same SHAPE — a once-per-turn Ability whose first
    // op is a cost and whose second is a draw — and the reprint idiom says
    // byte-identical text SHARES the object. These sentences are not
    // byte-identical (a different cost zone, a different draw op), so sharing
    // would silently move another card.
    expect(programFor("svp-182")).not.toBe(programFor("sv09-098"));
    // Trade still pays out of the HAND and still draws a FIXED two.
    expect(programFor("sv09-098")?.abilities?.[0]?.program).toEqual([
      { op: "payFromHand", count: 1, to: "discard" },
      { op: "drawCards", count: 2 },
    ]);
    // And `from: "self"` has not leaked onto the discards that print another
    // subject: Giacomo sweeps the OPPONENT's board, Mawile takes off their
    // Active. A `self` on either would delete the card's whole point.
    expect(programFor("sv02-182")?.trainer?.[0]).toMatchObject({
      op: "discardEnergy",
      from: "opponentEach",
    });
    expect(programFor("sv03-143")?.triggered?.[0]?.program?.[0]).toMatchObject({
      op: "discardEnergy",
      from: "opponentActive",
    });
  });
});

describe("Flashing Draw — driven through the real engine", () => {
  it("pays off THIS Pokémon from the BENCH, on a board whose ACTIVE also holds a Basic {L}", () => {
    // ⚠️ THE TEST THAT KILLS `yourActive`, AND THE REASON D190 DROPPED THE ROW.
    // The Active is a {L} body carrying a Basic {L} Energy, so the wrong member
    // has something to take and would take it silently.
    let state = setActiveFromDeck(board(1), "p1", "fix-lightning-1");
    state = benchFromDeck(clearBench(state, "p1"), "p1", "fix-flashingdraw");
    state = attachFromDeck(state, "p1", "fix-lightning-energy", 1);
    state = attachBenchFromDeck(state, "p1", 0, "fix-lightning-energy", 1);
    const activeEnergy = state.players.p1.active?.energy ?? [];
    const hostEnergy = state.players.p1.bench[0]?.energy ?? [];
    expect(activeEnergy).toHaveLength(1);
    expect(hostEnergy).toHaveLength(1);
    deepFreeze(state);

    const { state: after, events } = mustApply(state, useFlashingDrawFromBench);
    // Nothing is asked: one matching Energy on the host, so the pick is forced.
    expect(after.phase.kind).toBe("turn:action");
    expect(find(events, "ENERGY_DISCARDED")).toMatchObject({
      seat: "p1",
      actor: "p1",
      uids: hostEnergy,
      from: { spot: "bench", index: 0 },
    });
    // The host paid; the Active kept every card it had.
    expect(after.players.p1.bench[0]?.energy).toEqual([]);
    expect(after.players.p1.active?.energy).toEqual(activeEnergy);
    // Own board, own pile — the cards are the controller's.
    expect(after.players.p1.discard).toContain(hostEnergy[0]);
    expect(after.players.p2.discard).not.toContain(hostEnergy[0]);
  });

  it("is REFUSED when THIS body holds no {L} and the ACTIVE does — the printed cost, asked of the right Pokémon", () => {
    // ⚠️ THE `sourceUid` PROOF. Both readings of "this Pokémon" have an answer on
    // this board and they DISAGREE: the host holds nothing, the Active holds a
    // Basic {L}. A gate that dropped the uid would light this row and let the
    // benched Kilowattrel spend another Pokémon's Energy.
    let state = setActiveFromDeck(board(2), "p1", "fix-lightning-1");
    state = benchFromDeck(clearBench(state, "p1"), "p1", "fix-flashingdraw");
    state = attachFromDeck(state, "p1", "fix-lightning-energy", 2);
    expect(state.players.p1.active?.energy).toHaveLength(2);
    expect(state.players.p1.bench[0]?.energy).toEqual([]);
    deepFreeze(state);

    const refused = applyAction(state, useFlashingDrawFromBench);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("NO_LEGAL_TARGET");

    // …and the SAME board with one {L} moved onto the host is fine, so the
    // refusal above is the cost and not an unusable Ability (the attribution
    // control — a check whose subject is shared needs one, conventions.md).
    const armed = attachBenchFromDeck(state, "p1", 0, "fix-lightning-energy", 1);
    expect(applyAction(armed, useFlashingDrawFromBench).ok).toBe(true);
  });

  it("a {C} Energy on the host does NOT pay it — the filter is a Basic {L}", () => {
    let state = setActiveFromDeck(board(3), "p1", "fix-flashingdraw");
    state = benchFromDeck(clearBench(state, "p1"), "p1", "fix-lightning-1");
    // Colorless on the host, Lightning on the OTHER body: both halves of the
    // predicate are exercised by one board.
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    state = attachBenchFromDeck(state, "p1", 0, "fix-lightning-energy", 1);
    deepFreeze(state);

    const refused = applyAction(state, useFlashingDraw);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("takes exactly ONE Energy off a host holding two, then draws UNTIL the hand is 6", () => {
    let state = setActiveFromDeck(board(4), "p1", "fix-flashingdraw");
    state = benchFromDeck(clearBench(state, "p1"), "p1", "fix-lightning-1");
    state = attachFromDeck(state, "p1", "fix-lightning-energy", 2);
    state = attachBenchFromDeck(state, "p1", 0, "fix-lightning-energy", 1);
    state = handSize(state, 2);
    const deckBefore = state.players.p1.deck.length;
    deepFreeze(state);

    const { state: after, events } = mustApply(state, useFlashingDraw);
    // ONE, not both: `count` is absent, and two Basic {L} on one host are
    // interchangeable, so the pick is forced rather than parked.
    expect(find(events, "ENERGY_DISCARDED")?.uids).toHaveLength(1);
    expect(after.players.p1.active?.energy).toHaveLength(1);
    // FOUR drawn to reach six — the number is a consequence of the hand, which is
    // exactly what separates `drawUntilHandSize` from `drawCards`.
    expect(find(events, "CARDS_DRAWN")?.uids).toHaveLength(4);
    expect(after.players.p1.hand).toHaveLength(6);
    expect(after.players.p1.deck).toHaveLength(deckBefore - 4);
    // ORDER: the cost is the first op, so it is paid before anything it buys.
    const order = types(events);
    expect(order.indexOf("ENERGY_DISCARDED")).toBeLessThan(order.indexOf("CARDS_DRAWN"));
  });

  it("NEVER TRIMS — a hand of 7 draws nothing and the cost is STILL paid", () => {
    // The other direction of the same op, and the printed reading: the sentence
    // names a target hand SIZE, so a bigger hand is already past it. The cost is
    // a cost — "you must discard … in order to use this Ability" — so it is not
    // refunded, and the gate deliberately does not refuse on hand size (a draw is
    // "playable enough"; refusing would invent a clause the card does not print).
    let state = setActiveFromDeck(board(5), "p1", "fix-flashingdraw");
    state = benchFromDeck(clearBench(state, "p1"), "p1", "fix-lightning-1");
    state = attachFromDeck(state, "p1", "fix-lightning-energy", 1);
    state = attachBenchFromDeck(state, "p1", 0, "fix-lightning-energy", 1);
    state = handSize(state, 7);
    const deckBefore = state.players.p1.deck.length;
    deepFreeze(state);

    const { state: after, events } = mustApply(state, useFlashingDraw);
    expect(types(events)).not.toContain("CARDS_DRAWN");
    expect(after.players.p1.hand).toHaveLength(7);
    expect(after.players.p1.deck).toHaveLength(deckBefore);
    // Paid anyway.
    expect(after.players.p1.active?.energy).toEqual([]);
    expect(after.players.p1.discard).toHaveLength(1);
  });

  it("is ONCE PER TURN — the printed 'Once during your turn'", () => {
    let state = setActiveFromDeck(board(6), "p1", "fix-flashingdraw");
    state = benchFromDeck(clearBench(state, "p1"), "p1", "fix-lightning-1");
    state = attachFromDeck(state, "p1", "fix-lightning-energy", 2);
    state = handSize(state, 2);
    const { state: used } = mustApply(state, useFlashingDraw);
    const again = applyAction(used, useFlashingDraw);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("ABILITY_ALREADY_USED");
    // The second {L} is still attached: the refusal is the flag, not the cost.
    expect(used.players.p1.active?.energy).toHaveLength(1);
  });
});

describe("the `programPlayable` gate itself — `sourceUid` is an ANSWER, not a default", () => {
  it("says NO with no source uid, on a board covered in Basic {L} Energy", () => {
    // ⚠️ THE CLAIM THE OPTIONAL PARAMETER RESTS ON. A Trainer program authored
    // with `from: "self"` has no "this Pokémon", and the safe answer for a COST
    // is "unpayable" — not "fall back to the Active", which is precisely the
    // narrowing D190 refused. Driven against the REAL program, not a retyped one.
    let state = setActiveFromDeck(board(7), "p1", "fix-flashingdraw");
    state = benchFromDeck(clearBench(state, "p1"), "p1", "fix-lightning-1");
    state = attachFromDeck(state, "p1", "fix-lightning-energy", 2);
    state = attachBenchFromDeck(state, "p1", 0, "fix-lightning-energy", 2);
    deepFreeze(state);

    const program = flashingDrawProgram();
    expect(programPlayable(state, program, "p1")).toBe(false);
    // The very same board, same program, WITH the host's uid: true. So the false
    // above is about the missing uid and not about the board.
    const host = state.players.p1.active?.stack.at(-1);
    expect(host).toBeDefined();
    expect(programPlayable(state, program, "p1", host)).toBe(true);
  });

  it("answers about the NAMED body — the same board is true for one uid and false for the other", () => {
    // The sharpest form: ONE state, ONE program, two uids, two answers. Nothing
    // about the zone changed, which is what makes this a per-body predicate
    // rather than a per-board one.
    let state = setActiveFromDeck(board(8), "p1", "fix-flashingdraw");
    state = benchFromDeck(clearBench(state, "p1"), "p1", "fix-lightning-1");
    state = attachBenchFromDeck(state, "p1", 0, "fix-lightning-energy", 1);
    deepFreeze(state);

    const program = flashingDrawProgram();
    const active = state.players.p1.active?.stack.at(-1);
    const benched = state.players.p1.bench[0]?.stack.at(-1);
    expect(programPlayable(state, program, "p1", benched)).toBe(true);
    expect(programPlayable(state, program, "p1", active)).toBe(false);
    // And a uid that is on nobody's board answers false rather than throwing —
    // `sourceRef` returns an empty list for a host that has been evolved over,
    // bounced or Knocked Out, and an empty candidate set is an unpayable cost.
    expect(programPlayable(state, program, "p1", "no-such-uid")).toBe(false);
  });
});
