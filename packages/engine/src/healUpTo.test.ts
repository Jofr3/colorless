import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  HEAL_UPTO_DECK,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  setBenchDamage,
  types,
} from "./testFixtures";

// M5 op-slice: healChosen's "up to N" arm — §9.1's min: 0 end, three slices
// deferred and landed by Saguaro (sv02-187/-255/-270, Supporter): "Choose up to
// 2 of your Pokémon and heal 50 damage from each of them." The park is the
// first choosePokemonMulti with min ≠ max: "up to" legalizes 0, 1 or 2, so a
// PARTIAL answer — which every earlier consumer of the prompt rejects — is a
// printed right here. The exact-1 single arm (Potion / Fighting Au Lait /
// Arboliva) is untouched and shares this board to prove it.

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
    unrestricted turn, so a Supporter is legal (§4). */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: HEAL_UPTO_DECK, p2: HEAL_UPTO_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** Every uid held anywhere on `seat`'s side, sorted — cards only ever MOVE
    between zones, so this multiset is invariant across a play. */
function seatUids(state: GameState, seat: Seat): string[] {
  const side = state.players[seat];
  const inPlay = [side.active, ...side.bench].flatMap((p) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
  );
  return [...side.deck, ...side.hand, ...side.discard, ...side.prizes, ...inPlay].sort();
}

/** TEST SURGERY: set the Active's damage directly — Saguaro's candidates
    include the Active, and setBenchDamage only reaches the Bench. */
function setActiveDamage(state: GameState, seat: Seat, damage: number): GameState {
  const side = state.players[seat];
  if (side.active === null) throw new Error(`${seat} has no Active`);
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, active: { ...side.active, damage } } },
  };
}

/** Put `cardId` in P1's hand and play it, returning the state + events. */
function play(state: GameState, cardId: string): { state: GameState; events: GameEvent[] } {
  const withCard = handFromDeck(state, "p1", cardId, 1);
  const uid = handUid(withCard, "p1", cardId);
  return mustApply(withCard, { type: "playTrainer", seat: "p1", uid });
}

const ACTIVE = { seat: "p1", spot: { spot: "active" } } as const;
const BENCH_0 = { seat: "p1", spot: { spot: "bench", index: 0 } } as const;
const BENCH_1 = { seat: "p1", spot: { spot: "bench", index: 1 } } as const;

describe("Saguaro — healChosen's 'up to 2' park (§9.1 min: 0)", () => {
  it("parks {min: 0, max: 2} over ALL your Pokémon — undamaged ones included, on an undamaged board", () => {
    // Deliberately NOTHING is damaged: the play is legal (healChosen has no
    // programPlayable branch — the Potion / Fighting Au Lait doctrine) and
    // every Pokémon is offered (the printed choose clause has no damaged
    // restriction; an undamaged pick heals 0 and emits nothing).
    let state = benchFromDeck(board(3), "p1", "fix-basic-1");
    state = benchFromDeck(state, "p1", "fix-basic-1"); // 3 in play
    const { state: parked, events } = play(state, "sv02-187");
    expect(types(events)).toContain("EFFECT_PENDING");
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.min).toBe(0);
    expect(prompt.max).toBe(2);
    // min: 0 IS the printed decline — the flag stays unset (the prompt doc).
    expect(prompt.declinable).toBe(false);
    expect(prompt.candidates).toEqual([ACTIVE, BENCH_0, BENCH_1]);
    // The heading is the printed sentence.
    expect(prompt.note).toBe("Choose up to 2 of your Pokémon and heal 50 damage from each of them.");
  });

  it("heals 50 from EACH of the two picks, and the played card is discarded", () => {
    let state = benchFromDeck(board(3), "p1", "fix-basic-1");
    state = setActiveDamage(state, "p1", 90);
    state = setBenchDamage(state, "p1", 0, 60);
    const withCard = handFromDeck(state, "p1", "sv02-187", 1);
    const before = seatUids(withCard, "p1");
    const uid = handUid(withCard, "p1", "sv02-187");
    const { state: parked } = mustApply(withCard, { type: "playTrainer", seat: "p1", uid });
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [ACTIVE, BENCH_0] },
    });
    const healed = findAll(events, "HEALED");
    expect(healed).toHaveLength(2);
    for (const h of healed) {
      expect(h.seat).toBe("p1");
      expect(h.amount).toBe(50);
    }
    expect(done.players.p1.active?.damage).toBe(40);
    expect(done.players.p1.bench[0]?.damage).toBe(10);
    expect(done.phase.kind).toBe("turn:action");
    // hand → discard; nothing created or destroyed.
    expect(done.players.p1.discard).toContain(uid);
    expect(seatUids(done, "p1")).toEqual(before);
  });

  it("a PARTIAL answer is legal — 1 of 2 is what 'up to' prints (no earlier consumer allows it)", () => {
    let state = benchFromDeck(board(3), "p1", "fix-basic-1");
    state = setBenchDamage(state, "p1", 0, 60);
    const { state: parked } = play(state, "sv02-187");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [BENCH_0] },
    });
    expect(findAll(events, "HEALED")).toHaveLength(1);
    expect(done.players.p1.bench[0]?.damage).toBe(10);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("the EMPTY answer is legal, heals nothing, and still spends the Supporter", () => {
    // 50, not more: an unhealed Pokémon still at lethal damage when the program
    // settles would be swept by the mid-turn KO check (fix-basic-1 has 60 HP).
    let state = benchFromDeck(board(3), "p1", "fix-basic-1");
    state = setBenchDamage(state, "p1", 0, 50);
    const { state: parked } = play(state, "sv02-187");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [] },
    });
    expect(findAll(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.bench[0]?.damage).toBe(50);
    expect(done.phase.kind).toBe("turn:action");
    // Taking none is a way to PLAY the card, not a way to unplay it: the §7.2
    // allowance is spent, so a second Supporter this turn is refused.
    const again = handFromDeck(done, "p1", "sv02-255", 1);
    const uid = handUid(again, "p1", "sv02-255");
    expectErr(again, { type: "playTrainer", seat: "p1", uid }, "SUPPORTER_ALREADY_PLAYED");
  });

  it("still PARKS with one Pokémon in play, the ask §8.6-clamped to 'up to 1'", () => {
    // The take-fewer right is a real decision over ANY non-empty board — a
    // mutant that auto-takes at candidates ≤ 2 (the mandatory-snipe branch)
    // would force-heal here instead of asking.
    const state = setActiveDamage(board(3), "p1", 90);
    const { state: parked } = play(state, "sv02-187");
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.min).toBe(0);
    expect(prompt.max).toBe(1);
    expect(prompt.note).toBe("Choose up to 1 of your Pokémon and heal 50 damage from each of them.");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [ACTIVE] },
    });
    expect(find(events, "HEALED")?.amount).toBe(50);
    expect(done.players.p1.active?.damage).toBe(40);
  });

  it("caps each heal at the damage present (30 damage heals 30, not 50)", () => {
    let state = benchFromDeck(board(3), "p1", "fix-basic-1");
    state = setActiveDamage(state, "p1", 30);
    state = setBenchDamage(state, "p1", 0, 50);
    const { state: parked } = play(state, "sv02-187");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [ACTIVE, BENCH_0] },
    });
    const healed = findAll(events, "HEALED");
    // The Active's heal caps at its 30; the benched one takes the full 50.
    expect(healed.map((h) => h.amount).sort()).toEqual([30, 50]);
    expect(done.players.p1.active?.damage).toBe(0);
    expect(done.players.p1.bench[0]?.damage).toBe(0);
  });

  it("an undamaged pick heals 0 and emits NOTHING — the damaged pick still heals", () => {
    let state = benchFromDeck(board(3), "p1", "fix-basic-1");
    state = benchFromDeck(state, "p1", "fix-basic-1");
    state = setBenchDamage(state, "p1", 0, 60); // bench 1 stays undamaged
    const { state: parked } = play(state, "sv02-187");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [BENCH_1, BENCH_0] },
    });
    const healed = findAll(events, "HEALED");
    expect(healed).toHaveLength(1);
    expect(healed[0]?.amount).toBe(50);
    expect(done.players.p1.bench[0]?.damage).toBe(10);
    expect(done.players.p1.bench[1]?.damage).toBe(0);
  });

  it("rejects too many, duplicates, the opponent's Pokémon, and a single-ref choice", () => {
    let state = benchFromDeck(board(3), "p1", "fix-basic-1");
    state = benchFromDeck(state, "p1", "fix-basic-1");
    const { state: parked } = play(state, "sv02-187");
    const resolve = (choice: unknown) =>
      ({ type: "resolveEffect", seat: "p1", choice }) as Parameters<typeof applyAction>[1];
    // Three refs: over the printed "up to 2".
    expectErr(parked, resolve({ kind: "pokemonMulti", refs: [ACTIVE, BENCH_0, BENCH_1] }), "BAD_EFFECT_CHOICE");
    // The same Pokémon twice is not two picks.
    expectErr(parked, resolve({ kind: "pokemonMulti", refs: [ACTIVE, ACTIVE] }), "BAD_EFFECT_CHOICE");
    // "your Pokémon" — the opponent's Active is not offered.
    expectErr(
      parked,
      resolve({ kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] }),
      "BAD_EFFECT_CHOICE",
    );
    // The single-pick shape does not answer a multi prompt.
    expectErr(parked, resolve({ kind: "pokemon", ref: ACTIVE }), "BAD_EFFECT_CHOICE");
  });

  it("lands on every print — sv02-255 and sv02-270 drive the same park by their own ids", () => {
    for (const id of ["sv02-255", "sv02-270"]) {
      let state = benchFromDeck(board(3), "p1", "fix-basic-1");
      state = setBenchDamage(state, "p1", 0, 60);
      const { state: parked } = play(state, id);
      expect(parked.phase.kind).toBe("effect:choose");
      if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
      expect(parked.phase.prompt.kind).toBe("choosePokemonMulti");
      const { state: done, events } = mustApply(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemonMulti", refs: [BENCH_0] },
      });
      expect(find(events, "HEALED")?.amount).toBe(50);
      expect(done.players.p1.bench[0]?.damage).toBe(10);
    }
  });

  it("leaves the single arm alone — Potion on the same 2-Pokémon board parks a choosePokemon", () => {
    let state = benchFromDeck(board(3), "p1", "fix-basic-1");
    state = setBenchDamage(state, "p1", 0, 60);
    const { state: parked } = play(state, "sv01-188");
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.prompt.kind).toBe("choosePokemon");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: BENCH_0 },
    });
    expect(find(events, "HEALED")?.amount).toBe(30);
    expect(done.players.p1.bench[0]?.damage).toBe(30);
  });
});

// ── Purity + the D14 wire contract ──────────────────────────────────────────

describe("healChosen 'up to' — purity and the JSON park", () => {
  it("does not mutate the frozen prior state, parking or resolving", () => {
    let state = benchFromDeck(board(3), "p1", "fix-basic-1");
    state = setBenchDamage(state, "p1", 0, 60);
    const withCard = handFromDeck(state, "p1", "sv02-187", 1);
    const uid = handUid(withCard, "p1", "sv02-187");
    deepFreeze(withCard);
    const parked = mustApply(withCard, { type: "playTrainer", seat: "p1", uid }).state;
    deepFreeze(parked);
    expect(() =>
      applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemonMulti", refs: [BENCH_0] },
      }),
    ).not.toThrow();
  });

  it("the parked state survives a JSON round-trip and resolves identically (D14)", () => {
    let state = benchFromDeck(board(3), "p1", "fix-basic-1");
    state = setActiveDamage(state, "p1", 90);
    state = setBenchDamage(state, "p1", 0, 60);
    const { state: parked } = play(state, "sv02-187");
    const rehydrated = JSON.parse(JSON.stringify(parked)) as GameState;
    const a = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [ACTIVE, BENCH_0] },
    });
    const b = mustApply(rehydrated, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [ACTIVE, BENCH_0] },
    });
    expect(b.state).toEqual(a.state);
    expect(b.events).toEqual(a.events);
  });
});
