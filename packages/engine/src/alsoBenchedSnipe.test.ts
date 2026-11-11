import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { applyAction, deriveAttackEffect } from "./index";
import type { GameState, PokemonRef } from "./index";
import {
  ALSO_SNIPE_DECK,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
  findEvents,
} from "./testFixtures";

/** Setup with BOTH Actives pinned to fix-bigbody (200 HP, empty Bench — so the
    Defender survives the main hit and the Bench holds only what a test places),
    then open P1's turn 2 (P2 went first) — P1's first unrestricted turn. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: ALSO_SNIPE_DECK, p2: ALSO_SNIPE_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `attacker` (displacing its fix-bigbody to its own Bench) with `energy`
    Lightning attached; P2 keeps its fix-bigbody Defender and its Bench holds exactly
    `benched` (index 0 first, the rider's targets). */
function alsoSnipe(
  seed: number,
  opts: { attacker: string; energy: number; benched: readonly string[] },
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", opts.attacker);
  state = attachFromDeck(state, "p1", "fix-lightning-energy", opts.energy);
  for (const body of opts.benched) state = benchFromDeck(state, "p2", body);
  return state;
}

describe("deriveAttackEffect — the flat benched-snipe rider ('also does N to M Benched')", () => {
  it("reads the rider as a count-1 deals snipe with NO perTakenPrize (a fixed N)", () => {
    expect(
      deriveAttackEffect(
        "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 30,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
  });

  it("the W/R clarifier tail is OPTIONAL, and the amount is CAPTURED (10, 60)", () => {
    expect(
      deriveAttackEffect(
        "This attack also does 10 damage to 1 of your opponent's Benched Pokémon.",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 10,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
    expect(
      deriveAttackEffect(
        "This attack also does 60 damage to 1 of your opponent's Benched Pokémon.",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 60,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
  });

  it("REFUSES the near-misses — Flamigo's gate, 'YOUR', a 0 amount and a 0 count", () => {
    for (const text of [
      "If Flamigo is on your Bench, this attack also does 60 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "This attack also does 0 damage to 1 of your opponent's Benched Pokémon.",
      "This attack also does 20 damage to 0 of your opponent's Benched Pokémon.",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("D447 — the two spellings this anchor STOPPED refusing, with the SIDE asserted", () => {
    expect(
      deriveAttackEffect(
        "This attack also does 20 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "yourBench",
        amount: 20,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
    expect(
      deriveAttackEffect(
        "This attack also does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 20,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
    // · the "also" axis — the BARE wording derives to the SAME op as the "also" one,
    //   which is the whole argument for dropping the word (`SPREAD_EACH_BENCH`'s).
    expect(
      deriveAttackEffect("This attack does 20 damage to 1 of your opponent's Benched Pokémon."),
    ).toEqual(
      deriveAttackEffect(
        "This attack also does 20 damage to 1 of your opponent's Benched Pokémon.",
      ),
    );
    expect(
      deriveAttackEffect(
        "This attack does 40 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken.",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 40,
        count: 1,
        source: "attack",
        deals: true,
        perTakenPrize: true,
      },
    ]);
  });

  it("D399 — '2 of' is a COUNT-2 snipe now, and both printings come off the corpus", () => {
    const twos = legalAttackCorpus().filter(([, s]) =>
      /^This attack also does \d+ damage to 2 of your opponent's Benched Pokémon\./.test(s),
    );
    expect(twos).toHaveLength(2);
    expect(twos.reduce((sum, [n]) => sum + n, 0)).toBe(4);
    expect(new Set(twos.map(([, s]) => deriveAttackEffect(s)?.length))).toEqual(new Set([1]));
    for (const [, s] of twos) {
      const amount = Number(/does (\d+) damage/.exec(s)?.[1]);
      expect(deriveAttackEffect(s), s).toEqual([
        {
          op: "damageChosen",
          target: "opponentBench",
          amount,
          count: 2,
          source: "attack",
          deals: true,
        },
      ]);
    }
    expect(
      deriveAttackEffect(
        "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 30,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
  });

  it("hands the 'each of' also-rider to the SPREAD op, not this single-target snipe", () => {
    expect(
      deriveAttackEffect(
        "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([{ op: "spreadDamage", target: "opponentBench", amount: 10 }]);
  });

  it("does not COLLIDE with Covetous Ivy's Prize-scaled clause — that keeps its perTakenPrize", () => {
    expect(
      deriveAttackEffect(
        "This attack does 60 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken.",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 60,
        count: 1,
        source: "attack",
        deals: true,
        perTakenPrize: true,
      },
    ]);
  });
});

describe("the rider fires — main hit to the Defender, N to 1 chosen Benched", () => {
  it("Miraidon 'Lightning Laser': 90 to the Defender, then parks to snipe 30 on a Benched", () => {
    const state = alsoSnipe(1, {
      attacker: "sv01-080",
      energy: 3,
      benched: ["fix-bigbody", "fix-bigbody"], // 2 → a real count-1 choice
    });
    const { state: parked, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    // The main hit landed FIRST (§8 printed order), on the Defender.
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", base: 90, dealt: 90 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // …then the rider asks WHICH Benched Pokémon.
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.max).toBe(1);
    expect(prompt.unit).toBeUndefined();
    expect(prompt.note).toContain("30 damage");
    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    // The rider is DAMAGE_DEALT (not a counter), flat, on the chosen Benched.
    expect(types(e2)).not.toContain("COUNTERS_PLACED");
    expect(findEvent(e2, "DAMAGE_DEALT")).toMatchObject({
      seat: "p2",
      base: 30,
      weakness: null,
      dealt: 30,
    });
    expect(done.players.p2.active?.damage).toBe(90);
    expect(done.players.p2.bench[0]?.damage).toBe(30);
    expect(done.players.p2.bench[1]?.damage).toBe(0);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("auto-takes the rider on a Bench of exactly 1 — both hits in one action", () => {
    const state = alsoSnipe(2, { attacker: "sv01-080", energy: 3, benched: ["fix-bigbody"] });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    const dealt = findEvents(events, "DAMAGE_DEALT");
    expect(dealt.map((d) => d.base).sort((a, b) => a - b)).toEqual([30, 90]);
    expect(done.players.p2.active?.damage).toBe(90);
    expect(done.players.p2.bench[0]?.damage).toBe(30);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("captures the amount, not a literal 30 — Tadbulb's rider is 10 (main 20)", () => {
    const state = alsoSnipe(3, { attacker: "sv03-076", energy: 2, benched: ["fix-bigbody"] });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const dealt = findEvents(events, "DAMAGE_DEALT");
    expect(dealt.map((d) => d.base).sort((a, b) => a - b)).toEqual([10, 20]);
    expect(done.players.p2.bench[0]?.damage).toBe(10);
  });

  it("the main hit still lands when the opponent has no Bench — the rider just whiffs", () => {
    const state = alsoSnipe(4, { attacker: "sv01-080", energy: 3, benched: [] });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 90, dealt: 90 });
    expect(findEvents(events, "DAMAGE_DEALT")).toHaveLength(1); // main only, no rider
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("the rider KOs a lethally-hit Benched Pokémon through the attack epilogue", () => {
    // fix-victim (30 HP) benched: Miraidon's 30 rider is lethal. The KO is swept by
    // finishAttack, p1 takes a Prize, then the turn ends.
    const state = alsoSnipe(5, { attacker: "sv01-080", energy: 3, benched: ["fix-victim"] });
    const victimUid = benchTopUid(state, "p2", 0);
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(findEvent(events, "KNOCKED_OUT")?.uid).toBe(victimUid);
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    const { state: done } = mustApply(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.players.p1.prizes).toHaveLength(5);
    expect(done.players.p2.bench).toHaveLength(0);
  });

  it("never mutates the state it was given (purity — through the auto-take rider)", () => {
    const state = alsoSnipe(6, { attacker: "sv01-080", energy: 3, benched: ["fix-bigbody"] });
    deepFreeze(state);
    expect(() => applyAction(state, { type: "attack", seat: "p1", index: 1 })).not.toThrow();
  });
});
