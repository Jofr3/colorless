import { describe, expect, it } from "vitest";
import { SEATS, applyAction } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  TRIGGER_DECK,
  activeUid,
  benchFromDeck,
  benchTopUid,
  deepFreeze,
  driveSetup,
  firstBasicInHand,
  handFromDeck,
  handUid,
  handUids,
  must,
  mustApply,
  mustCreate,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  types,
} from "./testFixtures";

// M4 slice 6 — triggered Abilities (§9): the Abilities that FIRE on a game
// event rather than being player-activated. Three scan points:
//   • onPlayToBench — Flamigo "Insta-Flock" (search up to 3 Flamigo → hand);
//   • onEvolve — Arboliva "Enriching Oil" (heal all from 1 of your Pokémon);
//   • betweenTurns — Garganacl "Blessed Salt" (heal 20 from each of yours) and
//     Trevenant "Forest Miasma" (Active-only: 1 counter on the opp's Active).
// A board trigger parks on effect:choose like a Trainer and resumes to
// turn:action; the between-turns triggers are non-parking and run inside the
// Checkup, whose own KO sweep catches a lethal counter.

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

/** p1 (going first), both seats on TRIGGER_DECK with a fix-basic-1 Active,
    advanced to `turn` by passing (the intermediate Checkups are no-ops — the
    setup Actives carry no triggered Abilities). turn 1 is the returned state
    itself; turn 3 is p1's first evolve-legal turn. */
function triggerBoard(seed: number, turn = 1): GameState {
  let state = driveSetup(
    seed,
    { p1: TRIGGER_DECK, p2: TRIGGER_DECK },
    { first: "p1", active: { p1: "fix-basic-1", p2: "fix-basic-1" } },
  );
  while (state.turn < turn) {
    if (state.phase.kind !== "turn:action") {
      throw new Error(`unexpected ${state.phase.kind} while passing to turn ${turn}`);
    }
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  return state;
}

const SEED = 4;

// ── onPlayToBench — Flamigo "Insta-Flock" ───────────────────────────────────

describe("onPlayToBench — Flamigo's Insta-Flock (§9)", () => {
  it("fires on the bench play and parks on the deck search", () => {
    let state = triggerBoard(SEED);
    state = handFromDeck(state, "p1", "sv02-170", 1);
    const uid = handUid(state, "p1", "sv02-170");
    const { state: parked, events } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    // The bench play AND the trigger both landed in the one batch.
    expect(types(events)).toContain("POKEMON_BENCHED");
    expect(find(events, "ABILITY_TRIGGERED")?.ability).toBe("Insta-Flock");
    expect(types(events)).toContain("EFFECT_PENDING");
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.max).toBe(3);
    expect(prompt.dest).toBe("hand");
    // Every candidate is another Flamigo in the deck.
    for (const cand of prompt.candidates) {
      expect(parked.cardIdByUid[cand]).toBe("sv02-170");
    }
    // Take 2 → they move deck → hand and the deck shuffles; back to turn:action.
    const pick = prompt.candidates.slice(0, 2);
    const handBefore = parked.players.p1.hand.length;
    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: pick },
    });
    expect(find(e2, "DECK_SEARCHED")?.uids).toEqual(pick);
    expect(done.players.p1.hand.length).toBe(handBefore + 2);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("auto-fired but optional — the search may take none (§9 'you may')", () => {
    let state = triggerBoard(SEED);
    state = handFromDeck(state, "p1", "sv02-170", 1);
    const uid = handUid(state, "p1", "sv02-170");
    const { state: parked } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(done.phase.kind).toBe("turn:action");
    // Declining left the hand as it was after benching (only the Flamigo left).
    expect(done.players.p1.hand.length).toBe(parked.players.p1.hand.length);
  });

  it("whiffs harmlessly when the deck holds no other Flamigo (search finds none)", () => {
    let state = triggerBoard(SEED);
    // Pull EVERY Flamigo into hand, so none remains in the deck to search up.
    state = handFromDeck(state, "p1", "sv02-170", 6);
    const uid = handUids(state, "p1", "sv02-170", 1)[0] as string;
    const { state: done, events } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    // The Ability still triggered (auto-fired), the search found nothing, and
    // the trailing shuffle ran — no park, straight back to turn:action.
    expect(find(events, "ABILITY_TRIGGERED")?.ability).toBe("Insta-Flock");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).toContain("SHUFFLE");
    expect(done.phase.kind).toBe("turn:action");
  });

  it("a Basic with no triggered Ability benches normally (no trigger)", () => {
    let state = triggerBoard(SEED);
    state = handFromDeck(state, "p1", "fix-basic-1", 1);
    const uid = handUid(state, "p1", "fix-basic-1");
    const { state: done, events } = mustApply(state, { type: "playBasicToBench", seat: "p1", uid });
    expect(types(events)).toEqual(["POKEMON_BENCHED"]);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("does NOT fire on a setup placement (§9 — 'during your turn' only)", () => {
    // Drive setup only up to the placement phase (NOT ready) and bench a
    // Flamigo there: setup placement is a different handler and not a turn.
    let state = mustCreate(SEED, { p1: TRIGGER_DECK, p2: TRIGGER_DECK }).state;
    if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected chooseFirst");
    const winner = state.phase.coinWinner;
    state = must(applyAction(state, { type: "chooseFirstPlayer", seat: winner, first: winner }));
    while (state.phase.kind === "setup:drawExtra") {
      const phase = state.phase;
      const seat = SEATS.find((s) => !phase.decided[s]);
      if (seat === undefined) throw new Error("drawExtra with every seat decided");
      state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
    }
    state = must(applyAction(state, { type: "setupPlaceActive", seat: "p1", uid: firstBasicInHand(state, "p1") }));
    state = handFromDeck(state, "p1", "sv02-170", 1);
    const uid = handUid(state, "p1", "sv02-170");
    const { state: placed, events } = mustApply(state, { type: "setupPlaceBench", seat: "p1", uid });
    expect(types(events)).not.toContain("ABILITY_TRIGGERED");
    expect(placed.phase.kind).toBe("setup:place");
  });
});

// ── onEvolve — Arboliva "Enriching Oil" ─────────────────────────────────────

describe("onEvolve — Arboliva's Enriching Oil (§9)", () => {
  it("fires on the evolve and parks on the heal target (heal ALL)", () => {
    // p1 turn 3: fix-basic-1 Active (damaged) + a damaged benched fix-basic-1.
    let state = triggerBoard(SEED, 3);
    state = setDamage(state, "p1", 40); // the Active (→ Arboliva) carries 40
    state = benchFromDeck(state, "p1", "fix-basic-1");
    state = setBenchDamage(state, "p1", 0, 30);
    state = handFromDeck(state, "p1", "sv01-023", 1);
    const uid = handUid(state, "p1", "sv01-023");
    const { state: parked, events } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid,
      target: { spot: "active" },
    });
    expect(types(events)).toContain("POKEMON_EVOLVED");
    expect(find(events, "ABILITY_TRIGGERED")?.ability).toBe("Enriching Oil");
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    // Heal ALL from the benched one → its 30 damage clears entirely.
    const benchRef = prompt.candidates.find((c) => c.spot.spot === "bench");
    if (benchRef === undefined) throw new Error("bench not offered");
    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef },
    });
    expect(find(e2, "HEALED")?.amount).toBe(30);
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("auto-resolves the heal when only the evolved Pokémon is in play", () => {
    // No bench → the heal target is forced (Arboliva itself), no park.
    let state = triggerBoard(SEED, 3);
    state = setDamage(state, "p1", 50); // carried onto Arboliva
    state = handFromDeck(state, "p1", "sv01-023", 1);
    const uid = handUid(state, "p1", "sv01-023");
    const { state: done, events } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid,
      target: { spot: "active" },
    });
    expect(find(events, "ABILITY_TRIGGERED")?.ability).toBe("Enriching Oil");
    // Heal all → the carried 50 clears; no park.
    expect(find(events, "HEALED")?.amount).toBe(50);
    expect(done.players.p1.active?.damage).toBe(0);
    expect(done.phase.kind).toBe("turn:action");
  });
});

// ── betweenTurns — Garganacl "Blessed Salt" ─────────────────────────────────

describe("betweenTurns — Garganacl's Blessed Salt (§9/§13)", () => {
  it("heals 20 from EACH of the owner's Pokémon during the Checkup", () => {
    let state = triggerBoard(SEED);
    state = setActiveFromDeck(state, "p1", "sv02-123"); // Garganacl Active
    state = setDamage(state, "p1", 50);
    state = benchFromDeck(state, "p1", "fix-basic-1");
    state = setBenchDamage(state, "p1", 0, 30);
    const benched = benchTopUid(state, "p1", 0);
    const { state: after, events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(find(events, "ABILITY_TRIGGERED")?.ability).toBe("Blessed Salt");
    // One HEALED per healed Pokémon (Active + the benched one), 20 each.
    const heals = findAll(events, "HEALED").filter((h) => h.seat === "p1");
    expect(heals.map((h) => h.amount).sort()).toEqual([20, 20]);
    expect(after.players.p1.active?.damage).toBe(30); // 50 − 20
    const benchNow = after.players.p1.bench.find((p) => p.stack.includes(benched));
    expect(benchNow?.damage).toBe(10); // 30 − 20
  });

  it("heals even while Garganacl sits on the Bench (no Active-only gate)", () => {
    let state = triggerBoard(SEED);
    state = setDamage(state, "p1", 50); // the fix-basic-1 Active is damaged
    state = benchFromDeck(state, "p1", "sv02-123"); // Garganacl benched
    const { state: after, events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(find(events, "ABILITY_TRIGGERED")?.ability).toBe("Blessed Salt");
    expect(after.players.p1.active?.damage).toBe(30); // healed from the Bench
  });

  it("an undamaged board heals nothing (each heal clamps, no spurious event)", () => {
    let state = triggerBoard(SEED);
    state = setActiveFromDeck(state, "p1", "sv02-123");
    const { events } = mustApply(state, { type: "endTurn", seat: "p1" });
    // The Ability still triggered, but no Pokémon had damage to remove.
    expect(find(events, "ABILITY_TRIGGERED")?.ability).toBe("Blessed Salt");
    expect(findAll(events, "HEALED").filter((h) => h.seat === "p1")).toHaveLength(0);
  });
});

// ── betweenTurns — Trevenant "Forest Miasma" (Active-only, damage) ───────────

describe("betweenTurns — Trevenant's Forest Miasma (§9/§13)", () => {
  it("puts a counter on the opponent's Active during the Checkup", () => {
    let state = triggerBoard(SEED);
    state = setActiveFromDeck(state, "p1", "sv03-012"); // Trevenant Active
    const oppUid = activeUid(state, "p2");
    const { state: after, events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(find(events, "ABILITY_TRIGGERED")?.ability).toBe("Forest Miasma");
    const counter = find(events, "COUNTERS_PLACED");
    expect(counter?.source).toBe("ability");
    expect(counter?.seat).toBe("p2");
    expect(counter?.uid).toBe(oppUid);
    expect(counter?.amount).toBe(10);
    expect(after.players.p2.active?.damage).toBe(10);
  });

  it("places the FULL counter even on a Bouffer defender (counters ≠ attack damage)", () => {
    // Bouffalant's "Bouffer" reduces "damage from attacks" by 20 — a counter
    // PUT by an Ability is not attack damage, so Forest Miasma's 10 lands whole
    // (the poison/burn-tick rule; a reduction here would zero it out).
    let state = triggerBoard(SEED);
    state = setActiveFromDeck(state, "p1", "sv03-012"); // Trevenant Active
    state = setActiveFromDeck(state, "p2", "sv03-174"); // Bouffalant (Bouffer) Active
    const { state: after, events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(10);
    expect(after.players.p2.active?.damage).toBe(10);
  });

  it("does NOT fire from the Bench (Active-only)", () => {
    let state = triggerBoard(SEED);
    state = benchFromDeck(state, "p1", "sv03-012"); // Trevenant benched
    const { state: after, events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(types(events)).not.toContain("ABILITY_TRIGGERED");
    expect(after.players.p2.active?.damage).toBe(0);
  });

  it("KOs the opponent's Active when the counter is lethal (Checkup sweep)", () => {
    let state = triggerBoard(SEED);
    state = setActiveFromDeck(state, "p1", "sv03-012"); // Trevenant Active
    state = setActiveFromDeck(state, "p2", "fix-victim"); // 30 HP body
    state = setDamage(state, "p2", 20); // +10 counter = 30 = lethal
    const victimUid = activeUid(state, "p2");
    const { state: after, events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(victimUid);
    // The KO parks the Checkup on p1's prize pick (1 of 6 is a choice).
    expect(after.phase.kind).toBe("ko:takePrizes");
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    expect(after.phase.seat).toBe("p1");
  });
});

// ── Purity ──────────────────────────────────────────────────────────────────

describe("triggered Abilities — purity (never mutate the input)", () => {
  it("a board trigger does not mutate the frozen prior state", () => {
    let state = triggerBoard(SEED);
    state = handFromDeck(state, "p1", "sv02-170", 1);
    const uid = handUid(state, "p1", "sv02-170");
    deepFreeze(state);
    expect(() => applyAction(state, { type: "playBasicToBench", seat: "p1", uid })).not.toThrow();
  });

  it("a Checkup trigger does not mutate the frozen prior state", () => {
    let state = triggerBoard(SEED);
    state = setActiveFromDeck(state, "p1", "sv02-123");
    state = setDamage(state, "p1", 50);
    deepFreeze(state);
    expect(() => applyAction(state, { type: "endTurn", seat: "p1" })).not.toThrow();
  });
});
