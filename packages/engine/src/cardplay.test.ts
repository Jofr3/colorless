import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  ABILITY_DECK,
  TRAINER_DECK,
  activeUid,
  attachFromDeck,
  benchTopUid,
  deckOf,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

// M4 slice 2 — Trainers (§7), Abilities (§9) and the resumable effect
// interpreter (§15.E/G) that both drive through. The suite exercises every
// archetype in the representative registry plus the mid-effect parking, the
// per-turn caps, and the never-throw wire checks on the new actions.

/** Setup then open P1's turn 2: with P2 going first, ending P2's turn 1 puts P1
    on their (unrestricted-for-order) first turn — no going-first Supporter /
    attack ban, so Trainers play freely. */
function p1Turn2(seed: number, decks: { p1: string[]; p2: string[] }): GameState {
  const state = driveSetup(seed, decks, { first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

const both = { p1: TRAINER_DECK, p2: TRAINER_DECK };

describe("playTrainer — Supporters (§7.2)", () => {
  it("Professor's Research discards the hand and draws 7", () => {
    let state = p1Turn2(1, both);
    state = handFromDeck(state, "p1", "sv01-189", 1);
    const uid = handUid(state, "p1", "sv01-189");
    const handBefore = state.players.p1.hand.length;
    const { state: next, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(types(events)).toContain("TRAINER_PLAYED");
    expect(types(events)).toContain("HAND_DISCARDED");
    const drawn = find(events, "CARDS_DRAWN");
    expect(drawn?.reason).toBe("effect");
    expect(drawn?.uids).toHaveLength(7);
    expect(next.players.p1.hand).toHaveLength(7);
    // The whole prior hand (minus the played Research itself) went to discard.
    expect(next.players.p1.discard).toContain(uid);
    expect(next.players.p1.discard.length).toBeGreaterThanOrEqual(handBefore);
    expect(next.allowances.supporterPlayed).toBe(true);
    // Not an attack — the turn does not end.
    expect(next.phase.kind).toBe("turn:action");
  });

  it("a second Supporter in the same turn is rejected (§7.2)", () => {
    let state = p1Turn2(1, both);
    state = handFromDeck(state, "p1", "sv01-189", 2);
    const [a, b] = state.players.p1.hand.filter((u) => state.cardIdByUid[u] === "sv01-189");
    state = must(applyAction(state, { type: "playTrainer", seat: "p1", uid: a as string }));
    // Research shuffled a fresh hand, but our second copy is drawn back? Not
    // reliably — play a KNOWN second supporter uid we still hold if present,
    // else assert the allowance blocks ANY supporter.
    state = handFromDeck(state, "p1", "sv02-172", 1);
    const boss = handUid(state, "p1", "sv02-172");
    expectErr(state, { type: "playTrainer", seat: "p1", uid: boss }, "SUPPORTER_ALREADY_PLAYED");
    void b;
  });

  it("the going-first player cannot play a Supporter on turn 1 (§4)", () => {
    let state = driveSetup(1, both, { first: "p1" });
    state = handFromDeck(state, "p1", "sv01-189", 1);
    const uid = handUid(state, "p1", "sv01-189");
    expect(state.turn).toBe(1);
    expectErr(state, { type: "playTrainer", seat: "p1", uid }, "FIRST_TURN_SUPPORTER");
  });
});

describe("playTrainer — Items are unbounded (§7.1)", () => {
  it("two Nest Balls in one turn both resolve (no Supporter cap)", () => {
    let state = p1Turn2(1, both);
    state = handFromDeck(state, "p1", "sv01-181", 2);
    const balls = state.players.p1.hand.filter((u) => state.cardIdByUid[u] === "sv01-181");
    // First Nest Ball parks on the search — resolve it, then play the second.
    state = must(applyAction(state, { type: "playTrainer", seat: "p1", uid: balls[0] as string }));
    expect(state.phase.kind).toBe("effect:choose");
    // Decline the search (take 0) — still legal, still shuffles.
    state = must(applyAction(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [] } }));
    expect(state.phase.kind).toBe("turn:action");
    // Second one is fine — Items have no per-turn cap.
    const r = applyAction(state, { type: "playTrainer", seat: "p1", uid: balls[1] as string });
    expect(r.ok).toBe(true);
  });
});

describe("Nest Ball — search deck → Bench, then shuffle (§15.E)", () => {
  it("parks on the card choice, benches the picked Basic, and shuffles", () => {
    let state = p1Turn2(1, both);
    state = handFromDeck(state, "p1", "sv01-181", 1);
    const uid = handUid(state, "p1", "sv01-181");
    const benchBefore = state.players.p1.bench.length;
    const { state: parked, events: e1 } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(parked.phase.kind).toBe("effect:choose");
    expect(types(e1)).toContain("EFFECT_PENDING");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.dest).toBe("bench");
    expect(prompt.max).toBe(1);
    // Every candidate is a Basic Pokémon still in the deck.
    const pick = prompt.candidates[0] as string;
    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [pick] },
    });
    const searched = find(e2, "DECK_SEARCHED");
    expect(searched?.dest).toBe("bench");
    expect(searched?.uids).toEqual([pick]);
    expect(types(e2)).toContain("SHUFFLE");
    expect(done.players.p1.bench.length).toBe(benchBefore + 1);
    expect(benchTopUid(done, "p1", done.players.p1.bench.length - 1)).toBe(pick);
    expect(done.players.p1.deck).not.toContain(pick);
    expect(done.phase.kind).toBe("turn:action");
  });
});

describe("Energy Search — search deck → hand (§15.E)", () => {
  it("moves a chosen Basic Energy into hand and shuffles", () => {
    let state = p1Turn2(1, both);
    state = handFromDeck(state, "p1", "sv01-172", 1);
    const uid = handUid(state, "p1", "sv01-172");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.dest).toBe("hand");
    const pick = prompt.candidates[0] as string;
    const handBefore = parked.players.p1.hand.length;
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [pick] },
    });
    expect(find(done ? events : events, "DECK_SEARCHED")?.dest).toBe("hand");
    expect(done.players.p1.hand).toContain(pick);
    expect(done.players.p1.hand.length).toBe(handBefore + 1);
  });
});

describe("Boss's Orders — gust the opponent's Active (§15.G)", () => {
  it("parks on the opponent-bench choice, then switches their Active", () => {
    // Give P2 two benched Basics so the gust must be chosen (≥2 = park).
    let state = p1Turn2(2, both);
    // Bench two Basics for P2 from their hand on P1's turn — surgery instead:
    state = benchTwoBasics(state, "p2");
    state = handFromDeck(state, "p1", "sv02-172", 1);
    const uid = handUid(state, "p1", "sv02-172");
    const oppActiveBefore = activeUid(state, "p2");
    const { state: parked, events: e1 } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(parked.phase.kind).toBe("effect:choose");
    expect(types(e1)).toContain("TRAINER_PLAYED");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    // Every candidate is one of P2's benched Pokémon.
    expect(prompt.candidates.every((c) => c.seat === "p2" && c.spot.spot === "bench")).toBe(true);
    const chosen = prompt.candidates[0];
    if (chosen === undefined || chosen.spot.spot !== "bench") throw new Error("no bench candidate");
    const chosenUid = benchTopUid(parked, "p2", chosen.spot.index);
    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: chosen },
    });
    const switched = find(e2, "POKEMON_SWITCHED");
    expect(switched?.seat).toBe("p2");
    expect(switched?.nowActive).toBe(chosenUid);
    expect(activeUid(done, "p2")).toBe(chosenUid);
    // The gusted-out Pokémon is now benched, and it is P1 still acting.
    expect(done.players.p2.bench.some((p) => p.stack.includes(oppActiveBefore))).toBe(true);
    expect(done.phase.kind).toBe("turn:action");
    if (done.phase.kind === "turn:action") expect(done.phase.seat).toBe("p1");
  });

  it("is rejected when the opponent has no Bench (NO_LEGAL_TARGET)", () => {
    const state0 = p1Turn2(2, both);
    const state = handFromDeck(state0, "p1", "sv02-172", 1);
    const uid = handUid(state, "p1", "sv02-172");
    // P2 has only an Active (setup placed no bench) — nothing to gust.
    expect(state.players.p2.bench.length).toBe(0);
    expectErr(state, { type: "playTrainer", seat: "p1", uid }, "NO_LEGAL_TARGET");
  });

  it("a lone benched target auto-resolves without parking", () => {
    let state = p1Turn2(2, both);
    state = benchOneBasic(state, "p2");
    state = handFromDeck(state, "p1", "sv02-172", 1);
    const uid = handUid(state, "p1", "sv02-172");
    const target = benchTopUid(state, "p2", 0);
    const { state: done, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(done.phase.kind).toBe("turn:action"); // no park — forced
    expect(find(events, "POKEMON_SWITCHED")?.nowActive).toBe(target);
    expect(activeUid(done, "p2")).toBe(target);
  });
});

describe("Switch — swap your own Active (§15.G)", () => {
  it("clears the switched-out Active's Special Conditions (§12)", () => {
    let state = p1Turn2(2, both);
    state = benchOneBasic(state, "p1");
    // Put the Active to sleep, then Switch it out — benching cures it.
    const active = state.players.p1.active;
    if (active === null) throw new Error("no active");
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, active: { ...active, conditions: { ...active.conditions, rotation: "asleep" } } },
      },
    };
    state = handFromDeck(state, "p1", "sv01-194", 1);
    const uid = handUid(state, "p1", "sv01-194");
    const wasActive = activeUid(state, "p1");
    const target = benchTopUid(state, "p1", 0);
    const { state: done, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(find(done ? events : events, "POKEMON_SWITCHED")?.nowActive).toBe(target);
    const cleared = find(events, "STATUS_CLEARED");
    expect(cleared?.reason).toBe("benched");
    expect(cleared?.statuses).toContain("asleep");
    expect(activeUid(done, "p1")).toBe(target);
    expect(done.players.p1.bench.some((p) => p.stack.includes(wasActive))).toBe(true);
  });

  it("is rejected with no Bench (NO_LEGAL_TARGET)", () => {
    const state = handFromDeck(p1Turn2(2, both), "p1", "sv01-194", 1);
    const uid = handUid(state, "p1", "sv01-194");
    expect(state.players.p1.bench.length).toBe(0);
    expectErr(state, { type: "playTrainer", seat: "p1", uid }, "NO_LEGAL_TARGET");
  });
});

describe("Potion — heal a chosen Pokémon (§15.B)", () => {
  it("heals the Active (clamped to its damage) when it is the only Pokémon", () => {
    let state = p1Turn2(2, both);
    state = setDamage(state, "p1", 50);
    state = handFromDeck(state, "p1", "sv01-188", 1);
    const uid = handUid(state, "p1", "sv01-188");
    // Only the Active in play → forced target, no park.
    const { state: done, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(done.phase.kind).toBe("turn:action");
    expect(find(events, "HEALED")?.amount).toBe(30);
    expect(done.players.p1.active?.damage).toBe(20);
  });

  it("parks on the target choice when a Bench Pokémon is also in play", () => {
    let state = p1Turn2(2, both);
    state = setDamage(state, "p1", 50);
    state = benchOneBasic(state, "p1");
    state = handFromDeck(state, "p1", "sv01-188", 1);
    const uid = handUid(state, "p1", "sv01-188");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    const activeRef = prompt.candidates.find((c) => c.spot.spot === "active");
    if (activeRef === undefined) throw new Error("active not offered");
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: activeRef },
    });
    expect(done.players.p1.active?.damage).toBe(20);
  });
});

describe("Abilities — activated (Chien-Pao ex, Shivery Chill §9)", () => {
  it("searches up to 2 Water Energy to hand, does not end the turn, once per turn", () => {
    let state = p1Turn2(3, { p1: ABILITY_DECK, p2: ABILITY_DECK });
    state = setActiveFromDeck(state, "p1", "sv02-061");
    const uid = activeUid(state, "p1");
    const { state: parked, events: e1 } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Shivery Chill",
    });
    expect(find(e1, "ABILITY_USED")?.ability).toBe("Shivery Chill");
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.max).toBe(2);
    expect(prompt.min).toBe(0); // the printed "up to" — declinable
    // REGRESSION (engine 0.26.0): this is the card that shipped the searchNote
    // plural bug. `searchNote` used to keep its own singular-only noun table
    // beside the shared one, so it prefixed the count onto an ARTICLE and this
    // read "Search your deck for up to 2 a Basic Water Energy into your hand."
    // It survived because nothing asserted any search note; now something does.
    expect(prompt.note).toBe("Search your deck for up to 2 Basic Water Energy cards into your hand.");
    const pick = prompt.candidates.slice(0, 2);
    const handBefore = parked.players.p1.hand.length;
    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: pick },
    });
    expect(find(e2, "DECK_SEARCHED")?.uids).toEqual(pick);
    expect(done.players.p1.hand.length).toBe(handBefore + 2);
    expect(done.phase.kind).toBe("turn:action"); // abilities do NOT end the turn
    // Once per turn — a second use is rejected.
    expectErr(done, { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Shivery Chill" }, "ABILITY_ALREADY_USED");
    void uid;
  });

  it("is Active-only — rejected from the Bench (§9)", () => {
    let state = p1Turn2(3, { p1: ABILITY_DECK, p2: ABILITY_DECK });
    state = handFromDeck(state, "p1", "sv02-061", 1);
    const benchUid = handUid(state, "p1", "sv02-061");
    state = must(applyAction(state, { type: "playBasicToBench", seat: "p1", uid: benchUid }));
    const index = state.players.p1.bench.findIndex((p) => p.stack.includes(benchUid));
    expectErr(
      state,
      { type: "useAbility", seat: "p1", target: { spot: "bench", index }, abilityName: "Shivery Chill" },
      "ABILITY_ACTIVE_ONLY",
    );
  });

  it("rejects an unknown Ability name (NO_SUCH_ABILITY)", () => {
    let state = p1Turn2(3, { p1: ABILITY_DECK, p2: ABILITY_DECK });
    state = setActiveFromDeck(state, "p1", "sv02-061");
    expectErr(
      state,
      { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Nope" },
      "NO_SUCH_ABILITY",
    );
  });
});

describe("Abilities — passive (Bouffalant, Bouffer §15.B)", () => {
  it("reduces damage by 20 AFTER Weakness/Resistance, floored at 0", () => {
    // P1 (fire) attacks P2's Bouffalant Active with Bite (30) → 30 − 20 = 10.
    const p1Deck = deckOf({ "fix-attacker": 4, "fix-basic-1": 16, "fix-fire-energy": 40 });
    let state = driveSetup(4, { p1: p1Deck, p2: ABILITY_DECK }, { first: "p2" });
    state = must(applyAction(state, { type: "endTurn", seat: "p2" })); // P1 turn 2
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = setActiveFromDeck(state, "p2", "sv03-174");
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 }); // Bite [C] 30
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt?.base).toBe(30);
    expect(dealt?.reduction).toBe(20);
    expect(dealt?.dealt).toBe(10);
  });
});

describe("resolveEffect — wire safety (never throw)", () => {
  function parkedNestBall(): GameState {
    let state = p1Turn2(1, both);
    state = handFromDeck(state, "p1", "sv01-181", 1);
    const uid = handUid(state, "p1", "sv01-181");
    return must(applyAction(state, { type: "playTrainer", seat: "p1", uid }));
  }

  it("rejects a card not among the search candidates (BAD_EFFECT_CHOICE)", () => {
    const state = parkedNestBall();
    expectErr(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: ["not-a-uid"] } }, "BAD_EFFECT_CHOICE");
  });

  it("rejects more picks than the max (BAD_EFFECT_CHOICE)", () => {
    const state = parkedNestBall();
    if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "chooseCards") throw new Error("setup");
    const two = state.phase.prompt.candidates.slice(0, 2);
    if (two.length < 2) throw new Error("need 2 candidates");
    expectErr(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: two } }, "BAD_EFFECT_CHOICE");
  });

  it("rejects the wrong choice kind (BAD_EFFECT_CHOICE)", () => {
    const state = parkedNestBall();
    expectErr(
      state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "active" } } } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("rejects the wrong seat (WRONG_SEAT)", () => {
    const state = parkedNestBall();
    expectErr(state, { type: "resolveEffect", seat: "p2", choice: { kind: "cards", uids: [] } }, "WRONG_SEAT");
  });

  it("rejects resolveEffect when no effect is parked (BAD_PHASE)", () => {
    const state = p1Turn2(1, both);
    expectErr(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [] } }, "BAD_PHASE");
  });
});

describe("playTrainer / useAbility — validation", () => {
  it("rejects a non-Trainer card (NOT_A_TRAINER)", () => {
    const state = p1Turn2(1, both);
    const basicUid = state.players.p1.hand.find((u) => state.cardIdByUid[u] === "fix-basic-1");
    if (basicUid === undefined) throw new Error("no basic in hand");
    expectErr(state, { type: "playTrainer", seat: "p1", uid: basicUid }, "NOT_A_TRAINER");
  });

  it("rejects an unauthored Stadium (TRAINER_NOT_SIMULATED)", () => {
    let state = p1Turn2(1, { p1: deckOf({ "fix-basic-1": 24, "fix-stadium": 4, "fix-energy": 32 }), p2: TRAINER_DECK });
    state = handFromDeck(state, "p1", "fix-stadium", 1);
    const uid = handUid(state, "p1", "fix-stadium");
    expectErr(state, { type: "playTrainer", seat: "p1", uid }, "TRAINER_NOT_SIMULATED");
  });

  it("rejects an unauthored Trainer (TRAINER_NOT_SIMULATED)", () => {
    let state = p1Turn2(1, { p1: deckOf({ "fix-basic-1": 24, "fix-item": 4, "fix-energy": 32 }), p2: TRAINER_DECK });
    state = handFromDeck(state, "p1", "fix-item", 1);
    const uid = handUid(state, "p1", "fix-item");
    expectErr(state, { type: "playTrainer", seat: "p1", uid }, "TRAINER_NOT_SIMULATED");
  });

  it("rejects a card not in hand (CARD_NOT_IN_HAND)", () => {
    const state = p1Turn2(1, both);
    expectErr(state, { type: "playTrainer", seat: "p1", uid: "p1#999" }, "CARD_NOT_IN_HAND");
  });

  it("useAbility with a garbled target rejects (BAD_TARGET), never throws", () => {
    const state = p1Turn2(3, { p1: ABILITY_DECK, p2: ABILITY_DECK });
    const result = applyAction(state, {
      type: "useAbility",
      seat: "p1",
      // biome-ignore lint/suspicious/noExplicitAny: wire-shape probe
      target: null as any,
      abilityName: "Shivery Chill",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BAD_TARGET");
  });
});

describe("purity — a frozen state is never mutated", () => {
  it("playTrainer builds a new state without touching the old", () => {
    let state = p1Turn2(1, both);
    state = handFromDeck(state, "p1", "sv01-189", 1);
    const uid = handUid(state, "p1", "sv01-189");
    deepFreeze(state);
    expect(() => applyAction(state, { type: "playTrainer", seat: "p1", uid })).not.toThrow();
  });
});

// ── local surgery: bench Basics for a seat mid-turn (Boss's Orders needs the
//    opponent to have benched Pokémon; the setup benches none by default). ──

function benchTwoBasics(state: GameState, seat: Seat): GameState {
  return benchN(state, seat, 2);
}
function benchOneBasic(state: GameState, seat: Seat): GameState {
  return benchN(state, seat, 1);
}
function benchN(state: GameState, seat: Seat, n: number): GameState {
  const side = state.players[seat];
  const uids = side.deck.filter((u) => state.cardIdByUid[u] === "fix-basic-1").slice(0, n);
  if (uids.length < n) throw new Error(`${seat} deck lacks ${n} fix-basic-1`);
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => !taken.has(u)),
        bench: [...side.bench, ...uids.map((u) => ({ stack: [u], energy: [], tools: [], damage: 0, conditions: { rotation: "none" as const, poisonDamage: 0, burned: false, confusionDamage: 30 }, retreatBlocked: false, markers: [], turnPlayed: 0, promotedTurn: null }))],
      },
    },
  };
}
