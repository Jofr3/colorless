import { describe, expect, it } from "vitest";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  DISCARD_ENERGY_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  types,
} from "./testFixtures";

// M5 op-slice: discardEnergy (§15 energy removal — the "hammer" family). One op
// takes Energy off the OPPONENT's board; `from` names both the eligible Pokémon
// and how many are hit, and all three arms land with a real printed card:
//   • opponentActive  — Mawile (sv03-143) "Special Eater", an onPlayToBench trigger;
//   • opponentChosen  — Crushing Hammer (sv01-168), behind a coin flip;
//   • opponentEach    — Giacomo (sv02-182), the sweep across their whole board.
// MANDATORY and exactly one Energy per affected Pokémon, so the only decision is
// WHICH: nothing matching is a no-op, a forced pick auto-resolves, and the park
// has NO decline. The fixture fix-hammer is the opponentChosen arm without the
// coin gate, so the park / forced pick / whiff gate are pinned without a seeded flip.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so a Supporter (Giacomo) is legal. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: DISCARD_ENERGY_DECK, p2: DISCARD_ENERGY_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function activeEnergy(state: GameState, seat: "p1" | "p2"): string[] {
  return [...(state.players[seat].active?.energy ?? [])];
}
function benchEnergy(state: GameState, seat: "p1" | "p2", index: number): string[] {
  return [...(state.players[seat].bench[index]?.energy ?? [])];
}

/** Play `cardId` from P1's hand (pulled out of their deck first) and return the
    result — the shared opening of almost every case below. */
function playFromHand(state: GameState, cardId: string) {
  const withCard = handFromDeck(state, "p1", cardId, 1);
  const uid = handUid(withCard, "p1", cardId);
  return mustApply(withCard, { type: "playTrainer", seat: "p1", uid });
}

describe("M5 op-slice — discardEnergy", () => {
  it("registry resolves a program for each authored id (incl. the Giacomo reprints)", () => {
    for (const id of ["sv01-168", "sv02-182", "sv02-252", "sv02-267", "sv03-143"]) {
      expect(programFor(id)).toBeDefined();
    }
  });

  // ── opponentChosen (Crushing Hammer / fix-hammer) ──

  it("a single candidate is FORCED — it discards with no prompt at all", () => {
    let state = board(1);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const energyUid = activeEnergy(state, "p2")[0] as string;
    const discardBefore = state.players.p2.discard.length;

    const { state: done, events } = playFromHand(state, "fix-hammer");

    expect(done.phase.kind).toBe("turn:action"); // never parked
    expect(activeEnergy(done, "p2")).toEqual([]);
    // The card goes to its OWNER's pile — the opponent's, not the controller's.
    expect(done.players.p2.discard).toContain(energyUid);
    expect(done.players.p2.discard.length).toBe(discardBefore + 1);
    expect(done.players.p1.discard).not.toContain(energyUid);
    // …and it lands on TOP of that pile (appended), the pile being ordered.
    expect(done.players.p2.discard.at(-1)).toBe(energyUid);
    const discarded = find(events, "ENERGY_DISCARDED");
    // `seat` is the VICTIM, `actor` the controller whose card did it — opposite
    // seats for a hammer, the SAME seat for the self-discard attack cost.
    expect(discarded).toMatchObject({ seat: "p2", actor: "p1", uids: [energyUid] });
    expect(discarded?.from).toEqual({ spot: "active" });
  });

  it("two copies of ONE print on one Pokémon are interchangeable — forced, not parked", () => {
    // The M1 doctrine applied to card identity: either copy leaves the identical
    // board and the identical discard pile, so there is nothing to ask. Contrast
    // the two-DISTINCT-print cases below, which do park.
    let state = board(20);
    state = attachFromDeck(state, "p2", "fix-energy", 2);
    const before = activeEnergy(state, "p2");

    const { state: done, events } = playFromHand(state, "fix-hammer");

    expect(done.phase.kind).toBe("turn:action"); // never parked
    expect(types(events)).not.toContain("EFFECT_PENDING");
    // Exactly ONE came off — "one" is still one, collapsing does not discard more.
    expect(activeEnergy(done, "p2")).toEqual([before[1]]);
    expect(done.players.p2.discard).toContain(before[0]);
  });

  it("identical prints on DIFFERENT Pokémon still park — the host is never fungible", () => {
    // The collapse keys on (host, card): which Pokémon loses the Energy is the
    // whole decision for a Crushing Hammer, so two identical Basic Energy on two
    // different bodies are two candidates, not one.
    let state = board(21);
    state = benchFromDeck(state, "p2", "fix-basic-2");
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = attachBenchFromDeck(state, "p2", 0, "fix-energy", 1);

    const { state: parked } = playFromHand(state, "fix-hammer");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(parked.phase.prompt.discardable.map((d) => d.from)).toEqual([
      { seat: "p2", spot: { spot: "active" } },
      { seat: "p2", spot: { spot: "bench", index: 0 } },
    ]);
  });

  it("parks on a real choice, offering EVERY Energy on the opponent's board (Active + Bench)", () => {
    let state = board(2);
    state = benchFromDeck(state, "p2", "fix-basic-2");
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = attachBenchFromDeck(state, "p2", 0, "fix-special", 1);
    const onActive = activeEnergy(state, "p2")[0] as string;
    const onBench = benchEnergy(state, "p2", 0)[0] as string;

    const { state: parked } = playFromHand(state, "fix-hammer");

    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    const prompt = parked.phase.prompt;
    expect(prompt.scope).toEqual({ kind: "total", count: 1 });
    expect(prompt.note).toBe("Discard an Energy from 1 of your opponent's Pokémon.");
    // anyEnergy admits both the basic and the Special, each tagged with its host.
    expect(prompt.discardable.map((d) => d.uid)).toEqual([onActive, onBench]);
    expect(prompt.discardable[0]?.from).toEqual({ seat: "p2", spot: { spot: "active" } });
    expect(prompt.discardable[1]?.from).toEqual({ seat: "p2", spot: { spot: "bench", index: 0 } });

    // Picking the BENCHED one takes it off the bench, leaving the Active untouched.
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [onBench] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(benchEnergy(done, "p2", 0)).toEqual([]);
    expect(activeEnergy(done, "p2")).toEqual([onActive]);
    expect(done.players.p2.discard).toContain(onBench);
    expect(find(events, "ENERGY_DISCARDED")?.from).toEqual({ spot: "bench", index: 0 });

    // A SECOND hammer (Items are unbounded) now has one candidate left — forced —
    // and the pile stays a pile: the newer card goes ON TOP of the older one.
    const before = [...done.players.p2.discard];
    const { state: twice } = playFromHand(done, "fix-hammer");
    expect(twice.players.p2.discard).toEqual([...before, onActive]);
  });

  it("offers the bench in INDEX order, and 'one' rejects a second Energy off a SECOND Pokémon", () => {
    // Two BENCHED holders and a bare Active — the board that tells the two bench
    // slots apart (a candidate list keyed only by "bench" would fuse them) and the
    // one where an over-long pick could otherwise slip past the per-Pokémon rule:
    // two uids off two DIFFERENT Pokémon break no "one Energy per Pokémon" check,
    // so only the exact count stops "1 of your opponent's Pokémon" taking two.
    let state = board(15);
    state = benchFromDeck(state, "p2", "fix-basic-2");
    state = benchFromDeck(state, "p2", "fix-basic-2");
    state = attachBenchFromDeck(state, "p2", 0, "fix-energy", 1);
    state = attachBenchFromDeck(state, "p2", 1, "fix-special", 1);
    const onBench0 = benchEnergy(state, "p2", 0)[0] as string;
    const onBench1 = benchEnergy(state, "p2", 1)[0] as string;

    const { state: parked } = playFromHand(state, "fix-hammer");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    const prompt = parked.phase.prompt;
    // The Active holds nothing, so both candidates are benched — bench 0 first.
    expect(prompt.discardable.map((d) => d.uid)).toEqual([onBench0, onBench1]);
    expect(prompt.discardable.map((d) => d.from)).toEqual([
      { seat: "p2", spot: { spot: "bench", index: 0 } },
      { seat: "p2", spot: { spot: "bench", index: 1 } },
    ]);

    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "discardEnergy", uids: [onBench0, onBench1] },
      },
      "BAD_EFFECT_CHOICE",
    );
    // The rejected wire answer changed nothing — both Energy are still attached.
    expect(benchEnergy(parked, "p2", 0)).toEqual([onBench0]);
    expect(benchEnergy(parked, "p2", 1)).toEqual([onBench1]);
  });

  it("is NOT declinable — an empty pick is rejected, unlike a search or a move", () => {
    let state = board(3);
    // Two DISTINCT prints — two copies of one card are interchangeable and would
    // auto-resolve (forcedDiscards' fungibility collapse), never reaching a park.
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    const { state: parked } = playFromHand(state, "fix-hammer");

    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "discardEnergy", uids: [] } },
      "BAD_EFFECT_CHOICE",
    );
    // …and two picks are equally wrong: "one" means exactly one.
    const both = activeEnergy(parked, "p2");
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "discardEnergy", uids: both } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("rejects an Energy that was never offered (a uid off the CONTROLLER's own board)", () => {
    let state = board(4);
    state = attachFromDeck(state, "p2", "fix-energy", 1); // two DISTINCT prints →
    state = attachFromDeck(state, "p2", "fix-special", 1); // a real choice → parks
    state = attachFromDeck(state, "p1", "fix-energy", 1); // the controller's own
    const mine = activeEnergy(state, "p1")[0] as string;

    const { state: parked } = playFromHand(state, "fix-hammer");
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "discardEnergy", uids: [mine] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("nothing on the opponent's board → the top-level play is rejected (whiff gate)", () => {
    const state = handFromDeck(board(5), "p1", "fix-hammer", 1);
    const uid = handUid(state, "p1", "fix-hammer");
    expectErr(state, { type: "playTrainer", seat: "p1", uid }, "NO_LEGAL_TARGET");
    // Rejected BEFORE the card leaves hand — the play costs nothing.
    expect(state.players.p1.hand).toContain(uid);
  });

  it("Crushing Hammer into an Energy-less board is REJECTED — the flip is not an effect", () => {
    // §7 "you cannot play a card if it has no valid target" (Compendium 906,
    // reconfirmed 2025-06-26). A coin gate has no `otherwise`, so its heads branch
    // is the only thing the card can do; a branch that could only whiff makes the
    // whole card unplayable, and the flip — procedure, not effect — cannot rescue
    // it. `programPlayable` therefore DESCENDS into `coinFlipGate.then`.
    const bare = handFromDeck(board(6), "p1", "sv01-168", 1);
    const bareUid = handUid(bare, "p1", "sv01-168");
    expectErr(bare, { type: "playTrainer", seat: "p1", uid: bareUid }, "NO_LEGAL_TARGET");
    // Rejected before anything happens — the card stays in hand and NO coin was
    // flipped (a burnt flip would also advance the rng for both players).
    expect(bare.players.p1.hand).toContain(bareUid);
    expect(applyAction(bare, { type: "playTrainer", seat: "p1", uid: bareUid }).ok).toBe(false);
  });

  it("Crushing Hammer: heads discards, tails does nothing", () => {
    // With exactly one Energy out there, a heads flip takes it and a tails does not
    // — seeds chosen so both faces are covered.
    const faces = new Map<string, { discarded: number; energyLeft: number }>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      let state = board(seed);
      state = attachFromDeck(state, "p2", "fix-energy", 1);
      const { state: after, events } = playFromHand(state, "sv01-168");
      const face = find(events, "ATTACK_EFFECT_COIN_FLIP")?.result as string;
      faces.set(face, {
        discarded: findAll(events, "ENERGY_DISCARDED").length,
        energyLeft: activeEnergy(after, "p2").length,
      });
    }
    expect(faces.get("heads")).toEqual({ discarded: 1, energyLeft: 0 });
    expect(faces.get("tails")).toEqual({ discarded: 0, energyLeft: 1 });
  });

  // ── opponentEach (Giacomo) ──

  it("Giacomo sweeps one Special Energy off EACH of the opponent's Pokémon, skipping the bare", () => {
    let state = board(7);
    state = benchFromDeck(state, "p2", "fix-basic-2"); // bench 0 — a Special
    state = benchFromDeck(state, "p2", "fix-basic-2"); // bench 1 — a BASIC only (skipped)
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachBenchFromDeck(state, "p2", 0, "fix-special-2", 1);
    state = attachBenchFromDeck(state, "p2", 1, "fix-energy", 1);
    const onActive = activeEnergy(state, "p2")[0] as string;
    const onBench0 = benchEnergy(state, "p2", 0)[0] as string;
    const onBench1 = benchEnergy(state, "p2", 1)[0] as string;

    // Every affected Pokémon holds exactly one match → forced, no prompt.
    const { state: done, events } = playFromHand(state, "sv02-182");
    expect(done.phase.kind).toBe("turn:action");
    expect(activeEnergy(done, "p2")).toEqual([]);
    expect(benchEnergy(done, "p2", 0)).toEqual([]);
    expect(benchEnergy(done, "p2", 1)).toEqual([onBench1]); // a basic Energy is not touched
    expect(done.players.p2.discard).toEqual(expect.arrayContaining([onActive, onBench0]));

    // ONE event per affected Pokémon, in board order (Active, then bench index).
    const rows = findAll(events, "ENERGY_DISCARDED");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ seat: "p2", uids: [onActive] });
    expect(rows[0]?.from).toEqual({ spot: "active" });
    expect(rows[1]).toMatchObject({ seat: "p2", uids: [onBench0] });
    expect(rows[1]?.from).toEqual({ spot: "bench", index: 0 });
    // Both land on top of the OWNER's pile, in that same board order.
    expect(done.players.p2.discard.slice(-2)).toEqual([onActive, onBench0]);
  });

  it("is still FORCED when TWO SEPARATE BENCHED Pokémon each hold exactly one match", () => {
    // The per-Pokémon grouping has to distinguish bench SLOTS: two benched holders
    // with one Special each are two forced picks, not one Pokémon holding two, so
    // this must auto-resolve. (Grouping benched Pokémon together would park here.)
    let state = board(16);
    state = benchFromDeck(state, "p2", "fix-basic-2");
    state = benchFromDeck(state, "p2", "fix-basic-2");
    state = attachFromDeck(state, "p2", "fix-energy", 1); // Active: a BASIC — skipped
    state = attachBenchFromDeck(state, "p2", 0, "fix-special", 1);
    state = attachBenchFromDeck(state, "p2", 1, "fix-special-2", 1);
    const onActive = activeEnergy(state, "p2")[0] as string;
    const onBench0 = benchEnergy(state, "p2", 0)[0] as string;
    const onBench1 = benchEnergy(state, "p2", 1)[0] as string;

    const { state: done, events } = playFromHand(state, "sv02-182");

    expect(done.phase.kind).toBe("turn:action"); // no prompt — every group is forced
    expect(activeEnergy(done, "p2")).toEqual([onActive]); // the basic is not a match
    expect(benchEnergy(done, "p2", 0)).toEqual([]);
    expect(benchEnergy(done, "p2", 1)).toEqual([]);
    const rows = findAll(events, "ENERGY_DISCARDED");
    expect(rows.map((r) => r.from)).toEqual([
      { spot: "bench", index: 0 },
      { spot: "bench", index: 1 },
    ]);
    expect(done.players.p2.discard.slice(-2)).toEqual([onBench0, onBench1]);
  });

  it("Giacomo asks NOTHING when a Pokémon carries two copies of ONE print — the 'each' cap is 1", () => {
    // The `each` arm's collapse cap: exactly ONE representative per (host, Energy)
    // class, because the answer for that Pokémon is one Energy no matter how many
    // it holds. Two copies of the SAME print are one question wearing two hats, so
    // the whole sweep auto-resolves. The sibling test below uses two DIFFERENT
    // prints, which is what makes it park — these two together are what pin the
    // cap at 1 rather than at the count.
    let state = board(11);
    state = benchFromDeck(state, "p2", "fix-basic-2");
    state = attachFromDeck(state, "p2", "fix-special", 1); // Active — one match
    state = attachBenchFromDeck(state, "p2", 0, "fix-special", 2); // bench 0 — two IDENTICAL
    const onActive = activeEnergy(state, "p2")[0] as string;
    const onBench = benchEnergy(state, "p2", 0);

    const { state: done, events } = playFromHand(state, "sv02-182");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.phase.kind).toBe("turn:action");
    // One off each Pokémon — and off the bench pair it is the first copy, the
    // whole pair never having been a choice.
    expect(activeEnergy(done, "p2")).toEqual([]);
    expect(benchEnergy(done, "p2", 0)).toEqual([onBench[1]]);
    expect(done.players.p2.discard).toEqual([onActive, onBench[0]]);
  });

  it("Giacomo parks only when a Pokémon carries TWO Special Energy, and takes exactly one each", () => {
    let state = board(8);
    state = benchFromDeck(state, "p2", "fix-basic-2");
    state = attachFromDeck(state, "p2", "fix-special", 1); // Active: forced
    state = attachBenchFromDeck(state, "p2", 0, "fix-special", 1);
    state = attachBenchFromDeck(state, "p2", 0, "fix-special-2", 1); // bench 0: a real choice
    const onActive = activeEnergy(state, "p2")[0] as string;
    const [benchA, benchB] = benchEnergy(state, "p2", 0);

    const { state: parked } = playFromHand(state, "sv02-182");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(parked.phase.prompt.scope).toEqual({ kind: "each" });
    expect(parked.phase.prompt.note).toBe(
      "Discard a Special Energy from each of your opponent's Pokémon.",
    );
    expect(parked.phase.prompt.discardable).toHaveLength(3);

    // Exactly one per Pokémon: the Active's forced pick plus ONE of the bench pair.
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [onActive, benchB as string] },
    });
    expect(activeEnergy(done, "p2")).toEqual([]);
    expect(benchEnergy(done, "p2", 0)).toEqual([benchA]); // the other survives
  });

  it("Giacomo rejects two Energy off the SAME Pokémon, and a pick that skips a Pokémon", () => {
    let state = board(9);
    state = benchFromDeck(state, "p2", "fix-basic-2");
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachBenchFromDeck(state, "p2", 0, "fix-special", 1);
    state = attachBenchFromDeck(state, "p2", 0, "fix-special-2", 1);
    const onActive = activeEnergy(state, "p2")[0] as string;
    const [benchA, benchB] = benchEnergy(state, "p2", 0);

    const { state: parked } = playFromHand(state, "sv02-182");
    // Both off the bench Pokémon — right COUNT (2), wrong distribution.
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "discardEnergy", uids: [benchA as string, benchB as string] },
      },
      "BAD_EFFECT_CHOICE",
    );
    // Only the Active's — "each" means none may be skipped.
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "discardEnergy", uids: [onActive] } },
      "BAD_EFFECT_CHOICE",
    );
    // The same uid twice makes the count right and the board wrong.
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "discardEnergy", uids: [onActive, onActive] },
      },
      "BAD_EFFECT_CHOICE",
    );
    // A hostile client's junk: non-string uids and a flood, neither of which may
    // reach the board (the count check fires first on the flood).
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "discardEnergy", uids: [onActive, 7] as unknown as string[] },
      },
      "BAD_EFFECT_CHOICE",
    );
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "discardEnergy", uids: new Array(5000).fill(onActive) },
      },
      "BAD_EFFECT_CHOICE",
    );
    // …and none of it moved a card: the board is exactly as the prompt found it.
    expect(activeEnergy(parked, "p2")).toEqual([onActive]);
    expect(benchEnergy(parked, "p2", 0)).toEqual([benchA, benchB]);
    expect(parked.players.p2.discard).toHaveLength(0);
  });

  it("Giacomo into a board with no Special Energy is rejected — the Supporter is NOT burned", () => {
    let state = board(10);
    state = attachFromDeck(state, "p2", "fix-energy", 2); // basics only
    state = handFromDeck(state, "p1", "sv02-182", 1);
    const uid = handUid(state, "p1", "sv02-182");

    expectErr(state, { type: "playTrainer", seat: "p1", uid }, "NO_LEGAL_TARGET");
    expect(state.players.p1.hand).toContain(uid);
    expect(state.allowances.supporterPlayed).toBe(false);
  });

  // ── opponentActive (Mawile "Special Eater") ──

  it("Mawile's on-bench trigger takes a Special Energy off the opponent's ACTIVE only", () => {
    let state = board(11);
    state = benchFromDeck(state, "p2", "fix-basic-2");
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachBenchFromDeck(state, "p2", 0, "fix-special", 1); // out of reach
    state = handFromDeck(state, "p1", "sv03-143", 1);
    const onActive = activeEnergy(state, "p2")[0] as string;
    const onBench = benchEnergy(state, "p2", 0)[0] as string;
    const uid = handUid(state, "p1", "sv03-143");

    const { state: done, events } = mustApply(state, {
      type: "playBasicToBench",
      seat: "p1",
      uid,
    });
    expect(done.phase.kind).toBe("turn:action"); // forced (one Special on the Active)
    expect(types(events)).toContain("ABILITY_TRIGGERED");
    expect(activeEnergy(done, "p2")).toEqual([]);
    expect(benchEnergy(done, "p2", 0)).toEqual([onBench]); // the Bench is never eligible
    expect(done.players.p2.discard).toContain(onActive);
  });

  it("Mawile PARKS when their Active holds two Special Energy — one pick, Active-only", () => {
    // The only board on which the opponentActive arm asks anything: "a Special
    // Energy" is one of two, so WHICH is a real question and the prompt is the
    // printed sentence. Scope stays "one" (never "each") — an Active is one Pokémon.
    let state = board(17);
    state = benchFromDeck(state, "p2", "fix-basic-2");
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachFromDeck(state, "p2", "fix-special-2", 1);
    state = attachBenchFromDeck(state, "p2", 0, "fix-special", 1); // out of reach
    state = handFromDeck(state, "p1", "sv03-143", 1);
    // Indexed + asserted like every other uid grab in this file — a destructure
    // types both as `string | undefined` (noUncheckedIndexedAccess), which the
    // `uids: string[]` choices below reject.
    const activeA = activeEnergy(state, "p2")[0] as string;
    const activeB = activeEnergy(state, "p2")[1] as string;
    const onBench = benchEnergy(state, "p2", 0)[0] as string;
    const uid = handUid(state, "p1", "sv03-143");

    const { state: parked } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(parked.phase.seat).toBe("p1"); // the CONTROLLER answers, not the victim
    expect(parked.phase.prompt.scope).toEqual({ kind: "total", count: 1 });
    expect(parked.phase.prompt.note).toBe(
      "Discard a Special Energy from your opponent's Active Pokémon.",
    );
    // Active-only: the benched Special is never offered.
    expect(parked.phase.prompt.discardable.map((d) => d.uid)).toEqual([activeA, activeB]);
    expect(parked.phase.prompt.discardable.every((d) => d.from.spot.spot === "active")).toBe(true);
    // The victim cannot answer their own loss.
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p2", choice: { kind: "discardEnergy", uids: [activeA] } },
      "WRONG_SEAT",
    );
    // A benched uid was never offered, even though it is a Special on their board.
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "discardEnergy", uids: [onBench] } },
      "BAD_EFFECT_CHOICE",
    );

    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [activeB] },
    });
    expect(activeEnergy(done, "p2")).toEqual([activeA]); // exactly one came off
    expect(benchEnergy(done, "p2", 0)).toEqual([onBench]);
  });

  it("Mawile with no Special Energy on their Active is a silent no-op (the trigger still fires)", () => {
    let state = board(12);
    state = attachFromDeck(state, "p2", "fix-energy", 2); // basics only
    state = handFromDeck(state, "p1", "sv03-143", 1);
    const uid = handUid(state, "p1", "sv03-143");

    const { state: done, events } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    expect(types(events)).toContain("ABILITY_TRIGGERED");
    expect(findAll(events, "ENERGY_DISCARDED")).toHaveLength(0);
    expect(activeEnergy(done, "p2")).toHaveLength(2);
    expect(done.phase.kind).toBe("turn:action");
  });

  // ── shared invariants ──

  it("conserves cards — the Energy leaves the board for exactly one discard pile", () => {
    let state = board(13);
    state = benchFromDeck(state, "p2", "fix-basic-2");
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachBenchFromDeck(state, "p2", 0, "fix-special-2", 1);
    const zoneTotal = (s: GameState): number =>
      (["p1", "p2"] as const).reduce((sum, seat) => {
        const side = s.players[seat];
        const onBoard = [side.active, ...side.bench].reduce(
          (n, p) => n + (p === null ? 0 : p.energy.length + p.stack.length + p.tools.length),
          0,
        );
        return (
          sum +
          side.hand.length +
          side.deck.length +
          side.discard.length +
          side.prizes.length +
          onBoard
        );
      }, 0);
    const before = zoneTotal(state);
    const { state: done } = playFromHand(state, "sv02-182");
    // +0: the two Energy moved board → discard, and Giacomo itself moved hand →
    // discard (handFromDeck moved it deck → hand before the play).
    expect(zoneTotal(done)).toBe(before);
  });

  it("never mutates the input state — the play AND the resolve (frozen boards)", () => {
    let state = board(14);
    state = attachFromDeck(state, "p2", "fix-energy", 1); // two DISTINCT prints → parks
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = handFromDeck(state, "p1", "fix-hammer", 1);
    const uid = handUid(state, "p1", "fix-hammer");
    expect(() =>
      applyAction(deepFreeze(state), { type: "playTrainer", seat: "p1", uid }),
    ).not.toThrow();

    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    const pick = parked.phase.prompt.discardable[0]?.uid as string;
    expect(() =>
      applyAction(deepFreeze(parked), {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "discardEnergy", uids: [pick] },
      }),
    ).not.toThrow();
  });
});
