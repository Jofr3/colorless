import { describe, expect, it } from "vitest";
import { deriveAttackEffect, programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  HAIL_BLADE_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

const HAIL_BLADE_TEXT =
  "You may discard any amount of {W} Energy from your Pokémon. This attack does 60 damage for each card you discarded in this way.";

const attack = { type: "attack", seat: "p1", index: 0 } as const;

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

/** Setup then open P1's turn 2 (P2 went first and passed) — P1 goes second, so
    their first turn carries no §4 attack restriction. */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: HAIL_BLADE_DECK, p2: HAIL_BLADE_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function hailBlade(
  seed: number,
  opts: { energy: number; defender?: string; colorless?: number },
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "sv02-061");
  state = attachFromDeck(state, "p1", "fix-water-energy", opts.energy);
  if (opts.colorless !== undefined) {
    state = attachFromDeck(state, "p1", "fix-energy", opts.colorless);
  }
  return setActiveFromDeck(state, "p2", opts.defender ?? "fix-bigbody");
}

/** The parked discardEnergy prompt, or a loud failure. */
function discardPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
  return state.phase.prompt;
}

function activeEnergy(state: GameState, seat: "p1" | "p2"): string[] {
  return [...(state.players[seat].active?.energy ?? [])];
}

describe("Chien-Pao ex 'Hail Blade' — the REGISTRY-authored attack", () => {
  it("is authored in the registry, and the deriver now AGREES with it op for op", () => {
    const AUTHORED = [
      {
        op: "discardEnergy",
        from: "yours",
        filter: { kind: "providesEnergy", energyType: "Water" },
        count: "any",
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 60, count: "discarded" },
    ];
    expect(programFor("sv02-061")?.attack?.[0]).toEqual(AUTHORED);
    expect(deriveAttackEffect(HAIL_BLADE_TEXT)).toEqual(AUTHORED);
    // …and the registry is what RUNS, which is the half of the old comment that
    // stayed true: `attack.ts` reads `programFor(id)?.attack?.[index]` before it
    // ever asks the deriver, so this card's board did not move by one byte.
    expect(programFor("sv02-061")?.attack?.[0]).toEqual(deriveAttackEffect(HAIL_BLADE_TEXT));
  });

  it("every printed sv02-061 id carries it — the reprints are the same card", () => {
    for (const id of ["sv02-061", "sv02-236", "sv02-261", "sv02-274"]) {
      expect(programFor(id)?.attack?.[0]).toBeDefined();
    }
  });
});

describe("Hail Blade — the upTo park over the attacker's WHOLE board", () => {
  it("offers every {W} on Active AND Bench, never a non-{W}, and always parks", () => {
    let state = hailBlade(1, { energy: 3, colorless: 1 });
    state = benchFromDeck(state, "p1", "sv02-061");
    const benchIndex = state.players.p1.bench.length - 1;
    state = attachBenchFromDeck(state, "p1", benchIndex, "fix-water-energy", 2);
    const activeWater = activeEnergy(state, "p1").slice(0, 3);
    const benchWater = [...(state.players.p1.bench[benchIndex]?.energy ?? [])];
    const colorless = activeEnergy(state, "p1")[3] as string;
    deepFreeze(state);

    const { state: parked, events } = mustApply(state, attack);

    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("unreachable");
    expect(parked.phase.seat).toBe("p1"); // the ATTACKER decides
    expect(parked.phase.resumeTail).toBe(true);
    const prompt = discardPrompt(parked);
    // The printed sentence, reproduced: "any amount of" is the `"any"` caption.
    expect(prompt.note).toBe("Discard any amount of Water Energy from your Pokémon.");
    // DECLINABLE: 0..all, so the max is the whole offer — not an exact count.
    expect(prompt.scope).toEqual({ kind: "upTo", max: 5 });
    expect(prompt.discardable.map((d) => d.uid)).toEqual([...activeWater, ...benchWater]);
    expect(prompt.discardable.map((d) => d.from)).toEqual([
      { seat: "p1", spot: { spot: "active" } },
      { seat: "p1", spot: { spot: "active" } },
      { seat: "p1", spot: { spot: "active" } },
      { seat: "p1", spot: { spot: "bench", index: benchIndex } },
      { seat: "p1", spot: { spot: "bench", index: benchIndex } },
    ]);
    expect(prompt.discardable.map((d) => d.uid)).not.toContain(colorless);
    // NOTHING has been dealt yet: the printed "60×" base is suppressed, so the
    // whole attack's damage waits behind the choice.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("TURN_ENDED");
  });
});

describe("Hail Blade — 60 damage for each card discarded in this way", () => {
  it("discards 3 and deals 60 × 3 = 180 to the DEFENDER", () => {
    const state = hailBlade(2, { energy: 3 });
    const before = activeEnergy(state, "p1");
    deepFreeze(state);
    const { state: parked } = mustApply(state, attack);
    const picks = discardPrompt(parked).discardable.map((d) => d.uid);
    expect(picks).toEqual(before);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: picks },
    });

    // The discard is a SELF discard: victim and actor are the same seat, unlike
    // the hammer family where they are opposite.
    const discarded = find(events, "ENERGY_DISCARDED");
    expect(discarded).toMatchObject({ seat: "p1", actor: "p1", uids: picks });
    expect(discarded?.from).toEqual({ spot: "active" });
    expect(activeEnergy(done, "p1")).toEqual([]);
    for (const uid of picks) expect(done.players.p1.discard).toContain(uid);
    // …and only then the damage the count feeds: 60 × 3, through snipeActive.
    const damage = find(events, "DAMAGE_DEALT");
    expect(damage).toMatchObject({ seat: "p2", base: 180, dealt: 180, damage: 180 });
    expect(damage?.weakness).toBeNull(); // fix-bigbody is neutral to {W}
    expect(done.players.p2.active?.damage).toBe(180);
    // The record read happens AFTER the discard — the op order is the printed
    // sentence order, and the tail the epilogue held comes last.
    expect(types(events)).toEqual([
      "ENERGY_DISCARDED",
      "DAMAGE_DEALT",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
  });

  it("discarding ONE deals 60 — the count is what scales, not the board", () => {
    const state = hailBlade(3, { energy: 4 });
    const { state: parked } = mustApply(state, attack);
    const picks = discardPrompt(parked).discardable.map((d) => d.uid);
    expect(picks).toHaveLength(4); // four offered…

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [picks[0] as string] }, // …one taken
    });

    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(60);
    expect(done.players.p2.active?.damage).toBe(60);
    expect(activeEnergy(done, "p1")).toHaveLength(3); // the other three stay attached
  });

  it("NEVER flags ATTACK_EFFECT_SKIPPED — the '60×' modifier IS simulated", () => {
    // The program deals the main damage, so BOTH the effect text and the printed
    // "×" modifier are simulated; an unflagged coverage gap here would be a lie.
    const state = hailBlade(4, { energy: 2 });
    const { state: parked, events: declared } = mustApply(state, attack);
    const picks = discardPrompt(parked).discardable.map((d) => d.uid);
    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: picks },
    });
    expect(types(declared)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("Hail Blade — the decline, and the suppressed printed base", () => {
  it("declining (an empty pick) discards nothing and deals ZERO", () => {
    // "You may" is real: the one discard in the family with a decline. And the
    // printed "60×" base never lands on its own — 60 × 0 is the whole damage, so
    // a declined Hail Blade is an attack that does nothing at all.
    const state = hailBlade(5, { energy: 2 });
    const before = activeEnergy(state, "p1");
    const { state: parked, events: declared } = mustApply(state, attack);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [] },
    });

    expect(types(declared)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(done.players.p2.active?.damage).toBe(0);
    expect(activeEnergy(done, "p1")).toEqual(before); // every {W} still attached
    expect(done.players.p1.discard).toEqual([]);
    // The turn still ends — the attack HAPPENED, it just chose to do nothing.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });
});

describe("Hail Blade — the whole own board is fuel", () => {
  it("counts a BENCHED Chien-Pao's {W}, leaving the Active's cost Energy on", () => {
    // The printed "from your Pokémon": the two {W} paying the attack's own cost
    // stay attached while the Bench pays the damage. `from: "yours"` is what makes
    // this legal — `yourActive` would never have offered them.
    let state = hailBlade(6, { energy: 2 });
    state = benchFromDeck(state, "p1", "sv02-061");
    const benchIndex = state.players.p1.bench.length - 1;
    state = attachBenchFromDeck(state, "p1", benchIndex, "fix-water-energy", 2);
    const activeWater = activeEnergy(state, "p1");
    const benchWater = [...(state.players.p1.bench[benchIndex]?.energy ?? [])];

    const { state: parked } = mustApply(state, attack);
    expect(discardPrompt(parked).scope).toEqual({ kind: "upTo", max: 4 });

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: benchWater },
    });

    // ENERGY_DISCARDED is emitted PER affected Pokémon, so a bench-only pick
    // names the bench spot and nothing else.
    const discarded = findAll(events, "ENERGY_DISCARDED");
    expect(discarded).toHaveLength(1);
    expect(discarded[0]).toMatchObject({ seat: "p1", actor: "p1", uids: benchWater });
    expect(discarded[0]?.from).toEqual({ spot: "bench", index: benchIndex });
    expect(done.players.p1.bench[benchIndex]?.energy).toEqual([]);
    expect(activeEnergy(done, "p1")).toEqual(activeWater); // the cost is not spent
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(120); // 60 × 2
  });
});

describe("Hail Blade — genuine attack damage, not flat counters (§8.5)", () => {
  it("DOUBLES off the defender's Water Weakness — 60 × 1 × 2 = 120", () => {
    // The whole point of routing `damageDefender` through snipeActive: Chien-Pao
    // is a {W} attacker, so a ×2 Water defender takes double. A flat put-counters
    // model would have dealt 60 here.
    const state = hailBlade(7, { energy: 2, defender: "fix-water-weak" });
    const { state: parked } = mustApply(state, attack);
    const picks = discardPrompt(parked).discardable.map((d) => d.uid);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [picks[0] as string] },
    });

    const damage = find(events, "DAMAGE_DEALT");
    expect(damage).toMatchObject({ seat: "p2", base: 60, dealt: 120 });
    expect(damage?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(done.players.p2.active?.damage).toBe(120); // 200 HP — survives, no KO
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("the KO it causes owes the defender's rule box — 2 Prizes for an ex (D93)", () => {
    // Chien-Pao ex vs Chien-Pao ex: 220 HP pre-damaged to 100, so 60 × 2 = 120 is
    // lethal. The KO is swept by the ATTACK EPILOGUE after the park resolves —
    // program-emitted damage KOs exactly like the pre-program pipeline's does.
    let state = hailBlade(8, { energy: 2, defender: "sv02-061" });
    state = setDamage(state, "p2", 100);
    const koed = state.players.p2.active?.stack.at(-1) ?? "";
    const { state: parked } = mustApply(state, attack);
    const picks = discardPrompt(parked).discardable.map((d) => d.uid);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: picks },
    });

    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(120);
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: koed });
    // "ex" is a 2-Prize rule box (§8.1), and the Prizes are taken before the
    // promotion refills the board.
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 2 });
    expect(done.pending.map((s) => s.kind)).toEqual([
      "takePrizes",
      "promote",
      "endTurn",
      "checkup",
      "startTurn",
    ]);
  });
});
