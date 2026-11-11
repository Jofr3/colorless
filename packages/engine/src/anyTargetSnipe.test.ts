import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { applyAction, deriveAttackEffect } from "./index";
import type { GameState, PokemonRef } from "./index";
import {
  ANY_SNIPE_DECK,
  COST_SNIPE_DECK,
  FEINT_DECK,
  TWIN_SNIPE_DECK,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
  mustDerive,
  findEvents,
} from "./testFixtures";

/** Setup with BOTH Actives pinned to fix-lightning-weak (×2 Lightning, 130 HP, empty
    Bench — a deterministic Defender that is the W/R target), then open P1's turn 2. */
function board(seed: number, deck: string[] = ANY_SNIPE_DECK): GameState {
  const state = driveSetup(
    seed,
    { p1: deck, p2: deck },
    { first: "p2", active: { p1: "fix-lightning-weak", p2: "fix-lightning-weak" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `attacker` with `energy` attached; P2 keeps its fix-lightning-weak
    Active and its Bench holds exactly `benched`. */
function anySnipe(
  seed: number,
  opts: { attacker: string; energy: number; benched: readonly string[] },
  deck: string[] = ANY_SNIPE_DECK,
): GameState {
  let state = setActiveFromDeck(board(seed, deck), "p1", opts.attacker);
  state = attachFromDeck(state, "p1", "fix-lightning-energy", opts.energy);
  for (const body of opts.benched) state = benchFromDeck(state, "p2", body);
  return state;
}

describe("deriveAttackEffect — the any-target snipe ('does N to 1 of your opponent's Pokémon')", () => {
  it("reads it as a count-1 deals damageChosen with target opponentAny", () => {
    expect(
      deriveAttackEffect(
        "This attack does 20 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 20,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
  });

  it("the W/R clarifier tail is OPTIONAL, and the amount is CAPTURED (100)", () => {
    expect(
      deriveAttackEffect("This attack does 100 damage to 1 of your opponent's Pokémon."),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 100,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
  });

  it("reads Umbreon 'Feint Attack' as an ignoreWR snipe — both the SV and bare wordings", () => {
    expect(
      deriveAttackEffect(
        "This attack does 50 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 50,
        count: 1,
        source: "attack",
        deals: true,
        ignoreWR: true,
      },
    ]);
    expect(
      deriveAttackEffect(
        "This attack does 50 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance.",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 50,
        count: 1,
        source: "attack",
        deals: true,
        ignoreWR: true,
        wrOnly: true,
      },
    ]);
  });

  it("REFUSES the other 'to 1 … Pokémon' shapes — a discard cost, a coin flip, a 0", () => {
    for (const text of [
      // Pawmot ex "Levin Strike" — a leading discard cost, off `^This attack does`.
      "Discard 2 {L} Energy from this Pokémon. This attack does 220 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      // Magikarp "Jump" — a leading coin flip.
      "Flip a coin. If heads, this attack does 10 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      // A printed 0.
      "This attack does 0 damage to 1 of your opponent's Pokémon.",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("does not COLLIDE with the BENCHED snipes — those name the zone and keep opponentBench", () => {
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
});

describe("the any-target snipe — W/R applies on the Active, never on the Bench", () => {
  it("snipes the ACTIVE and DOUBLES for its Weakness (§8.5) — Rotom's 20 → 40", () => {
    // p2's only Pokémon is its fix-lightning-weak Active (empty Bench), so the count-1
    // snipe auto-takes it. Rotom is Lightning, the Active is ×2 Lightning → 20 × 2 = 40.
    const state = anySnipe(1, { attacker: "sv01-069", energy: 1, benched: [] });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p2",
      base: 20,
      weakness: { op: "multiply", amount: 2 },
      dealt: 40,
    });
    expect(done.players.p2.active?.damage).toBe(40);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("snipes the SAME weak body on the BENCH and stays FLAT — 20, no Weakness", () => {
    // The discriminating half: the identical ×2 Lightning body, Benched, takes the
    // printed 20 (§8.5 — W/R never apply to Bench). The Active is left untouched.
    const state = anySnipe(2, { attacker: "sv01-069", energy: 1, benched: ["fix-lightning-weak"] });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    // The Active is a candidate too (opponentAny), leading the Bench.
    expect(prompt.candidates[0]).toMatchObject({ seat: "p2", spot: { spot: "active" } });
    expect(prompt.candidates[1]).toMatchObject({ seat: "p2", spot: { spot: "bench", index: 0 } });
    expect(prompt.note).toContain("of your opponent's Pokémon"); // not "Benched Pokémon"
    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    expect(findEvent(e2, "DAMAGE_DEALT")).toMatchObject({ base: 20, weakness: null, dealt: 20 });
    expect(done.players.p2.bench[0]?.damage).toBe(20);
    expect(done.players.p2.active?.damage).toBe(0); // the Active was NOT the pick
  });

  it("a non-weak Active takes the FLAT amount — Fezandipiti's Darkness 100, no double", () => {
    // Fezandipiti is Darkness; the Active is ×2 Lightning, NOT Darkness — so no
    // Weakness fires and 100 lands flat (210 HP body attacking a 130 HP one survives).
    // Pins the amount ≠ Rotom's 20 and that Weakness only fires on a real match.
    const state = anySnipe(3, { attacker: "sv06.5-038", energy: 3, benched: [] });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      base: 100,
      weakness: null,
      dealt: 100,
    });
    expect(done.players.p2.active?.damage).toBe(100);
  });

  it("KOs a sniped Benched Pokémon through the attack epilogue, then ends the turn", () => {
    // Fezandipiti's 100 on a benched fix-victim (30 HP) is lethal; the KO is swept by
    // finishAttack, p1 takes a Prize, the turn ends.
    const state = anySnipe(4, { attacker: "sv06.5-038", energy: 3, benched: ["fix-victim"] });
    const victimUid = benchTopUid(state, "p2", 0);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: after, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] }, // the benched victim
    });
    expect(findEvent(events, "KNOCKED_OUT")?.uid).toBe(victimUid);
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    const { state: done } = mustApply(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.players.p1.prizes).toHaveLength(5);
    expect(done.players.p2.bench).toHaveLength(0);
  });

  it("adds the attacker's pre-W/R bonus on the Active — Vitality Band's +10, INSIDE Weakness", () => {
    // Vitality Band ("+10 to your opponent's Active, before W/R") DOES apply to an
    // Active snipe: (20 + 10) × 2 = 60, the bonus landing inside the weakness multiply
    // exactly as attack.ts's main hit — where a Benched target would never get it.
    let state = anySnipe(6, { attacker: "sv01-069", energy: 1, benched: [] });
    state = handFromDeck(state, "p1", "sv01-197", 1);
    const band = handUid(state, "p1", "sv01-197");
    state = must(
      applyAction(state, { type: "attachTool", seat: "p1", uid: band, target: { spot: "active" } }),
    );
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      base: 20,
      bonus: 10,
      weakness: { op: "multiply", amount: 2 },
      dealt: 60, // (20 + 10) × 2, NOT 20×2 + 10 = 50
    });
  });

  it("never mutates the state it was given (purity — through the active-snipe W/R arm)", () => {
    const state = anySnipe(5, { attacker: "sv01-069", energy: 1, benched: [] });
    deepFreeze(state);
    expect(() => applyAction(state, { type: "attack", seat: "p1", index: 0 })).not.toThrow();
  });
});

describe("Umbreon 'Feint Attack' — the ignoreWR snipe skips W/R and effects on the target", () => {
  it("ignores Weakness on the Active — a {L} Feint on a {L}-weak body stays FLAT at 50, not 100", () => {
    // fix-feint is Lightning, the Active is ×2 Lightning: an ordinary snipe (Rotom
    // above) DOUBLES on the Active, but Feint Attack's ignoreWR nulls the Weakness, so
    // the printed 50 lands flat. The count-1 snipe auto-takes the lone Active.
    const state = anySnipe(1, { attacker: "fix-feint", energy: 1, benched: [] }, FEINT_DECK);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p2",
      base: 50,
      weakness: null,
      resistance: null,
      dealt: 50, // NOT 50 × 2 = 100
    });
    expect(done.players.p2.active?.damage).toBe(50);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("still adds the ATTACKER's own bonus — Vitality Band's +10 lands, but FLAT (50 + 10 = 60)", () => {
    let state = anySnipe(6, { attacker: "fix-feint", energy: 1, benched: [] }, FEINT_DECK);
    state = handFromDeck(state, "p1", "sv01-197", 1);
    const band = handUid(state, "p1", "sv01-197");
    state = must(
      applyAction(state, { type: "attachTool", seat: "p1", uid: band, target: { spot: "active" } }),
    );
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      base: 50,
      bonus: 10,
      weakness: null,
      dealt: 60, // 50 + 10, the bonus NOT multiplied (Weakness is off)
    });
  });

  it("ignores a reduction passive on the target — a benched Bouffalant takes the full 50, not 30", () => {
    // sv03-174's "Bouffer" (−20 after W/R) reduces Covetous Ivy's benched snipe (60 →
    // 40); Feint Attack's "not affected by any effects on that Pokémon" reaches the
    // Bench arm too, so the −20 is skipped and the full 50 lands.
    const state = anySnipe(
      2,
      { attacker: "fix-feint", energy: 1, benched: ["sv03-174"] },
      FEINT_DECK,
    );
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.candidates[1]).toMatchObject({ seat: "p2", spot: { spot: "bench", index: 0 } });
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      base: 50,
      weakness: null,
      dealt: 50,
    });
    expect(done.players.p2.bench[0]?.damage).toBe(50); // the −20 Bouffer was ignored
    expect(done.players.p2.active?.damage).toBe(0); // the Active was NOT the pick
  });
});

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

const FLAT_TWO =
  "This attack does 50 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const FEINT_TWO =
  "This attack does 50 damage to 2 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on those Pokémon.";

const TWIN_FLAT: Record<string, unknown> = {
  op: "damageChosen",
  target: "opponentAny",
  amount: 50,
  count: 2,
  source: "attack",
  deals: true,
};

/** P1 fields `attacker` off TWIN_SNIPE_DECK with one {L} attached; P2 keeps its
    fix-lightning-weak Active and its Bench holds exactly `benched`. */
function twin(seed: number, attacker: string, benched: readonly string[]): GameState {
  return anySnipe(seed, { attacker, energy: 1, benched }, TWIN_SNIPE_DECK);
}

describe("§1 — D400's price and its SHAPE question, both measured off the corpus", () => {
  it("the arity is worth 2 sentences / 9 printings, and both were refused by a LITERAL", () => {
    // The rung `conditionalBenchSnipe.test.ts` §1 handed over, re-derived here rather
    // than inherited — and this is where it now lives, since the sentences resolve.
    const anyTwos = corpus().filter(([, t]) =>
      /^This attack does \d+ damage to [2-9] of your opponent's Pokémon\./.test(t),
    );
    expect(anyTwos).toHaveLength(2);
    expect(units(anyTwos)).toBe(9);
    expect(anyTwos.map(([, t]) => t).sort()).toEqual([FLAT_TWO, FEINT_TWO].sort());
    for (const [, t] of anyTwos) expect(deriveAttackEffect(t), t).not.toBeNull();
    expect(units(corpus().filter(([, t]) => t === FLAT_TWO))).toBe(3);
    expect(units(corpus().filter(([, t]) => t === FEINT_TWO))).toBe(6);
  });

  it("the tail's number: *those* at count 2 on 6 printings, *that* on ZERO", () => {
    const tailed = corpus().filter(([, t]) => /any effects on th(?:at|ose) Pokémon/.test(t));
    expect(tailed).toHaveLength(1);
    expect(units(tailed)).toBe(6);
    expect(tailed[0]?.[1]).toBe(FEINT_TWO);
    const bare = corpus().filter(
      ([, t]) =>
        t ===
        "This attack does 70 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance.",
    );
    expect(units(bare)).toBe(2);
  });

  it("what DOES decide it: 19 sentences / 43 printings agree, and ONE switches mid-sentence", () => {
    const singular = corpus().filter(([, t]) => /\bthat Pokémon\b/.test(t));
    const plural = corpus().filter(([, t]) => /\bthose Pokémon\b/.test(t));
    expect([singular.length, units(singular)]).toEqual([15, 32]);
    expect([plural.length, units(plural)]).toEqual([4, 12]);
    const both = corpus().filter(([, t]) => /that Pokémon/.test(t) && /those Pokémon/.test(t));
    expect(both).toHaveLength(1);
    expect(both[0]?.[1]).toContain("For each of those Pokémon");
    expect(both[0]?.[1]).toContain("evolves from that Pokémon");
    // …and nothing prints a plural referent beside "that Pokémon" on THIS skeleton,
    // which is the counterexample that would falsify the rule where it is enforced.
    expect(
      corpus().filter(([, t]) =>
        /^This attack does \d+ damage to [2-9] of your opponent's Pokémon\..*on that Pokémon/.test(
          t,
        ),
      ),
    ).toEqual([]);
  });

  it("RE-POINTED AT D401 — the COMPOUND count-≠-1 family was NAMED here, and D401 built it", () => {
    const compounds = corpus().filter(([, t]) =>
      /^Discard .* This attack does \d+ damage to [2-9] of your opponent's Pokémon\./.test(t),
    );
    expect(compounds).toHaveLength(2);
    expect(units(compounds)).toBe(4);
    for (const [, t] of compounds) expect(deriveAttackEffect(t), t).not.toBeNull();
    for (const [, t] of compounds) {
      expect(deriveAttackEffect(t), t).toHaveLength(2);
      const bare = t.replace(/^Discard [^.]+\. /, "");
      expect(deriveAttackEffect(bare), bare).toHaveLength(1);
    }
  });
});

describe("§2 — the READING: one capture, and the tail's number must AGREE with it", () => {
  it("both printed sentences derive, and the count is READ rather than remembered", () => {
    expect(deriveAttackEffect(FLAT_TWO)).toEqual([TWIN_FLAT]);
    expect(deriveAttackEffect(FEINT_TWO)).toEqual([{ ...TWIN_FLAT, ignoreWR: true }]);
    expect(
      deriveAttackEffect(
        "This attack does 35 damage to 4 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([{ ...TWIN_FLAT, amount: 35, count: 4 }]);
  });

  it("the count-1 spellings are UNMOVED — the capture widened the anchor, it did not re-aim it", () => {
    expect(
      deriveAttackEffect(
        "This attack does 20 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([{ ...TWIN_FLAT, amount: 20, count: 1 }]);
    expect(
      deriveAttackEffect(
        "This attack does 50 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.",
      ),
    ).toEqual([{ ...TWIN_FLAT, count: 1, ignoreWR: true }]);
  });

  it("a DISAGREEING number word is refused, and the flip is ONE WORD from a resolving sentence", () => {
    const singularAtTwo =
      "This attack does 50 damage to 2 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.";
    const pluralAtOne =
      "This attack does 50 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on those Pokémon.";
    expect(deriveAttackEffect(singularAtTwo)).toBeNull();
    expect(deriveAttackEffect(pluralAtOne)).toBeNull();
    // The one-word controls: flip *that*→*those* at 2 and *those*→*that* at 1 and both
    // resolve. Neither refusal above can therefore be blamed on any other byte.
    expect(singularAtTwo.replace("on that Pokémon", "on those Pokémon")).toBe(FEINT_TWO);
    expect(
      deriveAttackEffect(singularAtTwo.replace("on that Pokémon", "on those Pokémon")),
    ).toEqual([{ ...TWIN_FLAT, ignoreWR: true }]);
    expect(deriveAttackEffect(pluralAtOne.replace("on those Pokémon", "on that Pokémon"))).toEqual([
      { ...TWIN_FLAT, count: 1, ignoreWR: true },
    ]);
    // …and neither refused sentence is printed, which is what makes the refusal free.
    for (const t of [singularAtTwo, pluralAtOne])
      expect(corpus().some(([, c]) => c === t)).toBe(false);
  });

  it("the anchor's TERMINATOR: a COMPOUND that BEGINS with the printed sentence is refused", () => {
    for (const text of [
      "This attack does 50 damage to 2 of your opponent's Pokémon. Discard an Energy from this Pokémon.",
      `${FLAT_TWO} Discard an Energy from this Pokémon.`,
      `${FEINT_TWO} Discard an Energy from this Pokémon.`,
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    // …and all three PREFIXES resolve on their own, which is what makes the refusals
    // above the terminator's rather than some other byte's.
    expect(
      deriveAttackEffect("This attack does 50 damage to 2 of your opponent's Pokémon."),
    ).not.toBeNull();
    expect(deriveAttackEffect(FLAT_TWO)).not.toBeNull();
    expect(deriveAttackEffect(FEINT_TWO)).not.toBeNull();
  });

  it("a printed 0 in EITHER position stays on the loud path", () => {
    for (const text of [
      "This attack does 0 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "This attack does 50 damage to 0 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("the fixtures' printed bytes ARE the corpus's — neither can drift off the column", () => {
    expect(corpus().some(([, t]) => t === FLAT_TWO)).toBe(true);
    expect(corpus().some(([, t]) => t === FEINT_TWO)).toBe(true);
  });
});

describe("§3 — count 2 on a real board: the Active/Bench split, twice, with W/R on and off", () => {
  it("parks for EXACTLY 2 of 3 and the unchosen body is the control that makes 2 mean 2", () => {
    const state = twin(4000, "fix-twinsnipe", ["fix-lightning-weak", "sv03-174"]);
    const { state: parked, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect([prompt.min, prompt.max]).toEqual([2, 2]);
    expect(prompt.candidates).toHaveLength(3);
    expect(prompt.candidates[0]).toMatchObject({ seat: "p2", spot: { spot: "active" } });
    expect(prompt.declinable).toBe(false);
    expect(prompt.note).toBe("Choose 2 of your opponent's Pokémon (50 damage each).");
    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      // The Active AND the benched Bouffalant — one pick per zone, which is the only
      // shape in which `opponentAny` at count 2 differs from either zone's own op.
      choice: {
        kind: "pokemonMulti",
        refs: [prompt.candidates[0] as PokemonRef, prompt.candidates[2] as PokemonRef],
      },
    });
    const dealt = findEvents(e2, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(2);
    // The ACTIVE pick goes through §8.5 — a {L} attacker into a ×2 Lightning body.
    expect(dealt[0]).toMatchObject({
      base: 50,
      weakness: { op: "multiply", amount: 2 },
      dealt: 100,
    });
    // The BENCHED pick is flat, and Bouffalant's −20 "Bouffer" DOES bite: 50 → 30.
    expect(dealt[1]).toMatchObject({ base: 50, weakness: null, dealt: 30 });
    expect(done.players.p2.active?.damage).toBe(100);
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([0, 30]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("the SAME two picks under `ignoreWR`: 100 → 50 on the Active, 30 → 50 on the Bench", () => {
    const state = twin(4001, "fix-twinfeint", ["fix-lightning-weak", "sv03-174"]);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "pokemonMulti",
        refs: [prompt.candidates[0] as PokemonRef, prompt.candidates[2] as PokemonRef],
      },
    });
    const dealt = findEvents(events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(2);
    expect(dealt[0]).toMatchObject({ base: 50, weakness: null, resistance: null, dealt: 50 });
    expect(dealt[1]).toMatchObject({ base: 50, weakness: null, dealt: 50 });
    expect(done.players.p2.active?.damage).toBe(50);
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([0, 50]);
  });

  it("the two picks must be DISTINCT — 100 on one body is the arity's silent failure", () => {
    const parked = mustApply(twin(4002, "fix-twinsnipe", ["fix-lightning-weak", "sv03-174"]), {
      type: "attack",
      seat: "p1",
      index: 0,
    }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const one = prompt.candidates[1] as PokemonRef;
    for (const refs of [[one, one], [one], []]) {
      expect(
        applyAction(parked, {
          type: "resolveEffect",
          seat: "p1",
          choice: { kind: "pokemonMulti", refs },
        }).ok,
      ).toBe(false);
    }
  });

  it("exactly 2 candidates AUTO-TAKES both — no decision is left, so no prompt", () => {
    const { state: done, events } = mustApply(twin(4003, "fix-twinsnipe", ["sv03-174"]), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.players.p2.active?.damage).toBe(100); // ×2 Lightning
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([30]); // 50 − 20 Bouffer
  });

  it("a BARE Active is §8.6's 'do as much as you can' — one hit, not a refusal", () => {
    // `opponentAny` can never offer zero candidates (the Active is always there during
    // an attack), so this is the arity's floor: the printed 2 clamps to 1.
    const { state: done, events } = mustApply(twin(4004, "fix-twinfeint", []), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(findEvents(events, "DAMAGE_DEALT")).toHaveLength(1);
    expect(done.players.p2.active?.damage).toBe(50); // ignoreWR — not 100
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("never mutates the state it was given (purity — through the count-2 auto-take arm)", () => {
    const state = twin(4005, "fix-twinsnipe", ["sv03-174"]);
    deepFreeze(state);
    expect(() => applyAction(state, { type: "attack", seat: "p1", index: 0 })).not.toThrow();
  });
});

const COST_TWO =
  "Discard 2 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const ALL_THREE =
  "Discard all Energy from this Pokémon. This attack does 110 damage to 3 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const ALL_ONE =
  "Discard all Energy from this Pokémon. This attack does 120 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const ALL_ONE_COMMA =
  "Discard all Energy from this Pokémon, and this attack does 120 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const COMPOUNDS = [COST_TWO, ALL_THREE, ALL_ONE, ALL_ONE_COMMA] as const;

const DISCARD_ALL = {
  op: "discardEnergy",
  from: "yourActive",
  filter: { kind: "anyEnergy" },
  count: "all",
} as const;

/** Both setup Actives pin to the NEUTRAL 200 HP body unless a rung asks otherwise,
    so a 110 or a 120 lands flat and no KO tail rides along with the sequence. */
function costBoard(seed: number, p2Active = "fix-bigbody"): GameState {
  const state = driveSetup(
    seed,
    { p1: COST_SNIPE_DECK, p2: COST_SNIPE_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: p2Active } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `attacker` with `energy` attached; P2 keeps its pinned Active and its
    Bench holds exactly `benched`. */
function costSnipe(
  seed: number,
  opts: {
    attacker: string;
    energy: readonly { id: string; count: number }[];
    benched: readonly string[];
    p2Active?: string;
  },
): GameState {
  let state = setActiveFromDeck(costBoard(seed, opts.p2Active), "p1", opts.attacker);
  for (const e of opts.energy) state = attachFromDeck(state, "p1", e.id, e.count);
  for (const body of opts.benched) state = benchFromDeck(state, "p2", body);
  return state;
}

describe("§4 — D401's price, and the SHAPE question settled from the catalog", () => {
  it("the compound family is 4 sentences / 7 printings, and this anchor reads exactly them", () => {
    const family = corpus().filter(([, t]) => COMPOUNDS.includes(t as (typeof COMPOUNDS)[number]));
    expect(family).toHaveLength(4);
    expect(units(family)).toBe(7);
    for (const t of COMPOUNDS)
      expect(
        corpus().some(([, c]) => c === t),
        t,
      ).toBe(true);
    const reads = corpus().filter(([, t]) => {
      const ops = deriveAttackEffect(t);
      return (
        ops !== null &&
        ops.length === 2 &&
        ops[0]?.op === "discardEnergy" &&
        ops[1]?.op === "damageChosen"
      );
    });
    expect(reads).toHaveLength(8);
    expect(units(reads)).toBe(13);
    const aimedAnywhere = reads.filter(([, t]) => {
      const snipe = mustDerive(deriveAttackEffect, t)[1];
      return snipe?.op === "damageChosen" && snipe.target === "opponentAny";
    });
    expect(aimedAnywhere.map(([, t]) => t).sort()).toEqual([...COMPOUNDS].sort());
    expect(units(aimedAnywhere)).toBe(7);
    const aimedAtTheBench = reads.filter(([, t]) => {
      const snipe = mustDerive(deriveAttackEffect, t)[1];
      return snipe?.op === "damageChosen" && snipe.target === "opponentBench";
    });
    expect(aimedAtTheBench).toHaveLength(4);
    expect(units(aimedAtTheBench)).toBe(6);
    expect(aimedAnywhere.length + aimedAtTheBench.length).toBe(reads.length);
  });

  it("THE SHAPE QUESTION: the printed JOIN is 3 sentences on `. ` and 1 on `, and `", () => {
    const period = corpus().filter(
      ([, t]) =>
        /Pokémon\. This attack does/.test(t) && COMPOUNDS.includes(t as (typeof COMPOUNDS)[number]),
    );
    const comma = corpus().filter(
      ([, t]) =>
        /Pokémon, and this attack does/.test(t) &&
        COMPOUNDS.includes(t as (typeof COMPOUNDS)[number]),
    );
    expect([period.length, units(period)]).toEqual([3, 6]);
    expect([comma.length, units(comma)]).toEqual([1, 1]);
    expect(ALL_ONE_COMMA.replace("Pokémon, and this", "Pokémon. This")).toBe(ALL_ONE);
    expect(deriveAttackEffect(ALL_ONE_COMMA)).toEqual(deriveAttackEffect(ALL_ONE));
  });

  it("AND THE W/R TAIL IS NOT ADMITTED, BECAUSE THIS SKELETON PRINTS IT ZERO TIMES", () => {
    const tailed = corpus().filter(
      ([, t]) => /^Discard /.test(t) && /isn't affected by Weakness or Resistance/.test(t),
    );
    expect(tailed).toEqual([]);
    const wr =
      "Discard all Energy from this Pokémon. This attack does 120 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance.";
    expect(deriveAttackEffect(wr)).toBeNull();
    expect(
      deriveAttackEffect(
        wr.replace(
          / This attack's damage.*$/,
          " (Don't apply Weakness and Resistance for Benched Pokémon.)",
        ),
      ),
    ).toEqual(deriveAttackEffect(ALL_ONE));
  });

  it("the DISCARD quantifier is `all` or a digit, and `an` is printed ZERO times here", () => {
    const all = corpus().filter(
      ([, t]) =>
        /^Discard all Energy/.test(t) && COMPOUNDS.includes(t as (typeof COMPOUNDS)[number]),
    );
    const numeric = corpus().filter(
      ([, t]) =>
        /^Discard \d+ Energy/.test(t) && COMPOUNDS.includes(t as (typeof COMPOUNDS)[number]),
    );
    expect([all.length, units(all)]).toEqual([3, 4]);
    expect([numeric.length, units(numeric)]).toEqual([1, 3]);
    // The "an" spelling `SELF_DISCARD_ONE` reads on its own is not in the alternation,
    // and the column is why: no compound prints it. The near-miss is one word from a
    // resolving sentence, so nothing but the alternation can be refusing it.
    const an = ALL_ONE.replace("Discard all Energy", "Discard an Energy");
    expect(deriveAttackEffect(an)).toBeNull();
    expect(corpus().some(([, t]) => t === an)).toBe(false);
    expect(deriveAttackEffect(ALL_ONE)).not.toBeNull();
  });
});

describe("§5 — the READING: two ops in printed order, and each half is the bare anchor's own", () => {
  it("all four printed sentences derive, and the numbers are READ rather than remembered", () => {
    expect(deriveAttackEffect(COST_TWO)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: 2 },
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 120,
        count: 2,
        source: "attack",
        deals: true,
      },
    ]);
    expect(deriveAttackEffect(ALL_THREE)).toEqual([
      DISCARD_ALL,
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 110,
        count: 3,
        source: "attack",
        deals: true,
      },
    ]);
    expect(deriveAttackEffect(ALL_ONE)).toEqual([
      DISCARD_ALL,
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 120,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
    expect(deriveAttackEffect(ALL_ONE_COMMA)).toEqual(deriveAttackEffect(ALL_ONE));
    expect(
      deriveAttackEffect(
        "Discard 4 Energy from this Pokémon. This attack does 35 damage to 5 of your opponent's Pokémon.",
      ),
    ).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: 4 },
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 35,
        count: 5,
        source: "attack",
        deals: true,
      },
    ]);
  });

  it("D132's INVENTORY RULE: each half is BYTE-IDENTICAL to the bare anchor's own output", () => {
    // The whole claim of a compound anchor is that it buys a JOIN and nothing else. If
    // either half drifted from the reading the standalone sentence already has, this
    // arm would be a second, quieter implementation of an op that already ships.
    const compound = mustDerive(deriveAttackEffect, COST_TWO);
    expect(compound[0]).toEqual(
      mustDerive(deriveAttackEffect, "Discard 2 Energy from this Pokémon.")[0],
    );
    expect(compound[1]).toEqual(
      mustDerive(
        deriveAttackEffect,
        "This attack does 120 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      )[0],
    );
    const all = mustDerive(deriveAttackEffect, ALL_THREE);
    expect(all[0]).toEqual(
      mustDerive(deriveAttackEffect, "Discard all Energy from this Pokémon.")[0],
    );
    expect(all[1]).toEqual(
      mustDerive(
        deriveAttackEffect,
        "This attack does 110 damage to 3 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      )[0],
    );
  });

  it("a printed 0 in ANY of the THREE positions stays LOUD, each against its own twin", () => {
    for (const [bad, good] of [
      [
        "Discard 0 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon.",
        "Discard 2 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon.",
      ],
      [
        "Discard 2 Energy from this Pokémon. This attack does 0 damage to 2 of your opponent's Pokémon.",
        "Discard 2 Energy from this Pokémon. This attack does 1 damage to 2 of your opponent's Pokémon.",
      ],
      [
        "Discard 2 Energy from this Pokémon. This attack does 120 damage to 0 of your opponent's Pokémon.",
        "Discard 2 Energy from this Pokémon. This attack does 120 damage to 1 of your opponent's Pokémon.",
      ],
    ] as const) {
      expect(deriveAttackEffect(bad), bad).toBeNull();
      expect(deriveAttackEffect(good), good).not.toBeNull();
    }
  });

  it("the printed NEAR-MISSES of the same family are all refused, and every one is real", () => {
    for (const text of [
      "Discard up to 3 Energy cards from your hand. This attack does 60 damage to 1 of your opponent's Pokémon for each Energy card you discarded in this way. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]) {
      const program = mustDerive(deriveAttackEffect, text);
      expect(program, text).toHaveLength(2);
      expect(program[0]?.op, text).toBe("payFromHand");
      expect(program[0], text).toMatchObject({ count: "any", cap: 3, recordAs: "discarded" });
      const snipe = program[1];
      if (snipe?.op !== "damageChosen") throw new Error(`not a damageChosen: ${text}`);
      expect(snipe.perRecorded, text).toBe("discarded");
      expect(
        corpus().some(([, t]) => t === text),
        text,
      ).toBe(true);
    }
    for (const text of [
      "Discard all Energy from this Pokémon, and this attack does 210 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]) {
      const program = mustDerive(deriveAttackEffect, text);
      expect(program, text).toHaveLength(2);
      expect(program[0]?.op, text).toBe("discardEnergy");
      const snipe = program[1];
      if (snipe?.op !== "damageChosen") throw new Error(`not a damageChosen: ${text}`);
      expect(snipe.target, text).toBe("opponentBench");
      expect(snipe.filter, text).toEqual({ kind: "suffixPokemon", suffix: "ex" });
      expect(
        corpus().some(([, t]) => t === text),
        text,
      ).toBe(true);
    }
    for (const text of [
      "Discard 2 Energy from this Pokémon. This attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "Discard all Energy from this Pokémon, and this attack also does 90 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "Discard all {R} Energy from this Pokémon, and this attack does 180 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]) {
      const program = mustDerive(deriveAttackEffect, text);
      expect(program, text).toHaveLength(2);
      expect(program[0]?.op, text).toBe("discardEnergy");
      const snipe = program[1];
      if (snipe?.op !== "damageChosen") throw new Error(`not a damageChosen: ${text}`);
      expect(snipe.target, text).toBe("opponentBench");
      expect(
        corpus().some(([, t]) => t === text),
        text,
      ).toBe(true);
    }
    const typed =
      "Discard 2 {L} Energy from this Pokémon. This attack does 220 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    expect(deriveAttackEffect(typed)).toBeNull();
    expect(corpus().some(([, t]) => t === typed)).toBe(false);
    // …and it is refused by the TYPE token alone: strip the `{L}` and it resolves.
    expect(deriveAttackEffect(typed.replace("2 {L} Energy", "2 Energy"))).not.toBeNull();
  });

  it("the anchor's TERMINATOR: a compound that BEGINS with a printed compound is refused", () => {
    for (const text of [
      "Discard 2 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon. Your opponent's Active Pokémon is now Paralyzed.",
      `${COST_TWO} Your opponent's Active Pokémon is now Paralyzed.`,
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    expect(
      deriveAttackEffect(
        "Discard 2 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon.",
      ),
    ).not.toBeNull();
    expect(deriveAttackEffect(COST_TWO)).not.toBeNull();
  });

  it("the three BARE anchors are UNMOVED — this slice added a reader, it did not re-aim one", () => {
    expect(deriveAttackEffect("Discard all Energy from this Pokémon.")).toEqual([DISCARD_ALL]);
    expect(deriveAttackEffect("Discard 2 Energy from this Pokémon.")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: 2 },
    ]);
    expect(deriveAttackEffect("Discard an Energy from this Pokémon.")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
    ]);
    expect(
      deriveAttackEffect(
        "This attack does 120 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 120,
        count: 2,
        source: "attack",
        deals: true,
      },
    ]);
  });
});

describe("§6 — the board: ONE attack, TWO parks, in printed order", () => {
  it("the COST parks FIRST and no damage has been dealt yet", () => {
    // Three Energy in TWO distinguishable prints: "which 2 of these 3 go" is a real
    // decision, which is the only reason the first half parks at all.
    const state = costSnipe(4100, {
      attacker: "fix-costsnipe",
      energy: [
        { id: "fix-lightning-energy", count: 2 },
        { id: "fix-energy", count: 1 },
      ],
      benched: ["fix-lightning-weak", "fix-lightning-weak"],
    });
    const { state: parked, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).toContain("EFFECT_PENDING");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.seat).toBe("p1");
    expect(parked.phase.resumeTail).toBe(true);
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(parked.phase.prompt.scope).toEqual({ kind: "total", count: 2 });
    expect(parked.phase.prompt.discardable).toHaveLength(3);
    // …and the epilogue is QUEUED behind it, not run.
    expect(parked.pending).toHaveLength(1);
    expect(parked.pending[0]?.kind).toBe("attackEpilogue");
    expect(types(events)).not.toContain("TURN_ENDED");
  });

  it("resolving the cost PARKS AGAIN for the targets — the second question of one sentence pair", () => {
    const state = costSnipe(4101, {
      attacker: "fix-costsnipe",
      energy: [
        { id: "fix-lightning-energy", count: 2 },
        { id: "fix-energy", count: 1 },
      ],
      benched: ["fix-lightning-weak", "fix-lightning-weak"],
    });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    const picks = parked.phase.prompt.discardable.slice(0, 2).map((c) => c.uid);
    const { state: second, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: picks },
    });
    expect(findEvent(events, "ENERGY_DISCARDED")?.uids).toEqual(picks);
    expect(findEvent(events, "ENERGY_DISCARDED")?.actor).toBe("p1");
    for (const uid of picks) expect(second.players.p1.discard).toContain(uid);
    expect(second.players.p1.active?.energy).toHaveLength(1);
    // …and the turn did NOT end, because `rest` still held the second op.
    expect(types(events)).not.toContain("TURN_ENDED");
    if (second.phase.kind !== "effect:choose") throw new Error("expected a SECOND effect:choose");
    if (second.phase.prompt.kind !== "choosePokemonMulti") {
      throw new Error("expected choosePokemonMulti");
    }
    expect([second.phase.prompt.min, second.phase.prompt.max]).toEqual([2, 2]);
    expect(second.phase.prompt.candidates).toHaveLength(3);
    // Still nothing damaged: the second question has been ASKED, not answered.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(second.players.p2.active?.damage).toBe(0);
  });

  it("answering BOTH runs the whole sentence pair, and ENERGY_DISCARDED precedes DAMAGE_DEALT", () => {
    const state = costSnipe(4102, {
      attacker: "fix-costsnipe",
      energy: [
        { id: "fix-lightning-energy", count: 2 },
        { id: "fix-energy", count: 1 },
      ],
      benched: ["fix-lightning-weak", "fix-lightning-weak"],
    });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    const { state: second, events: e1 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "discardEnergy",
        uids: parked.phase.prompt.discardable.slice(0, 2).map((c) => c.uid),
      },
    });
    if (second.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (second.phase.prompt.kind !== "choosePokemonMulti") {
      throw new Error("expected choosePokemonMulti");
    }
    const targets = second.phase.prompt.candidates;
    const { state: done, events: e2 } = mustApply(second, {
      type: "resolveEffect",
      seat: "p1",
      // The Active AND one Bench — the pair in which `opponentAny` at count 2 differs
      // from either zone's own op, driven THROUGH the cost.
      choice: {
        kind: "pokemonMulti",
        refs: [targets[0] as PokemonRef, targets[1] as PokemonRef],
      },
    });
    const dealt = findEvents(e2, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(2);
    // fix-bigbody is a neutral 200 HP Active and the Bench never takes W/R, so both
    // hits are the printed 120 and nothing is Knocked Out.
    for (const row of dealt) expect(row).toMatchObject({ base: 120, weakness: null, dealt: 120 });
    expect(done.players.p2.active?.damage).toBe(120);
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([120, 0]);
    expect(types(e1)).toEqual(["ENERGY_DISCARDED", "EFFECT_PENDING"]);
    expect(types(e2).indexOf("DAMAGE_DEALT")).toBeGreaterThanOrEqual(0);
    expect(types(e2)).not.toContain("ENERGY_DISCARDED");
    // …and only THEN the epilogue drained.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
    expect(done.players.p1.active?.energy).toHaveLength(1);
  });

  it("the ZERO-PARK control: the SAME anchor, the same two ops, and no prompt at all", () => {
    const state = costSnipe(4103, {
      attacker: "fix-allsnipe",
      energy: [
        { id: "fix-lightning-energy", count: 2 },
        { id: "fix-energy", count: 1 },
      ],
      benched: ["fix-lightning-weak", "fix-lightning-weak"],
    });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // All three Energy went, including the one that was surplus to the {C} cost.
    expect(findEvent(events, "ENERGY_DISCARDED")?.uids).toHaveLength(3);
    expect(done.players.p1.active?.energy ?? []).toHaveLength(0);
    const dealt = findEvents(events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(3);
    for (const row of dealt) expect(row).toMatchObject({ base: 110, dealt: 110 });
    expect(done.players.p2.active?.damage).toBe(110);
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([110, 110]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("§8.5 STILL RUNS through the compound's second op — and the KO waits for BOTH parks", () => {
    const state = costSnipe(4104, {
      attacker: "fix-costsnipe",
      energy: [
        { id: "fix-lightning-energy", count: 2 },
        { id: "fix-energy", count: 1 },
      ],
      benched: ["fix-lightning-weak", "fix-bigbody"],
      p2Active: "fix-lightning-weak",
    });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    const { state: second } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "discardEnergy",
        uids: parked.phase.prompt.discardable.slice(0, 2).map((c) => c.uid),
      },
    });
    if (second.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (second.phase.prompt.kind !== "choosePokemonMulti") {
      throw new Error("expected choosePokemonMulti");
    }
    const targets = second.phase.prompt.candidates;
    const { state: after, events } = mustApply(second, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "pokemonMulti",
        refs: [targets[0] as PokemonRef, targets[1] as PokemonRef],
      },
    });
    const dealt = findEvents(events, "DAMAGE_DEALT");
    expect(dealt[0]).toMatchObject({
      base: 120,
      weakness: { op: "multiply", amount: 2 },
      dealt: 240,
    });
    expect(dealt[1]).toMatchObject({ base: 120, weakness: null, dealt: 120 });
    expect(findEvent(events, "KNOCKED_OUT")).toBeDefined();
    if (after.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
  });

  it("never mutates the state it was given (purity — through the two-park compound)", () => {
    const state = costSnipe(4105, {
      attacker: "fix-costsnipe",
      energy: [
        { id: "fix-lightning-energy", count: 2 },
        { id: "fix-energy", count: 1 },
      ],
      benched: ["fix-lightning-weak", "fix-lightning-weak"],
    });
    deepFreeze(state);
    expect(() => applyAction(state, { type: "attack", seat: "p1", index: 0 })).not.toThrow();
  });
});
