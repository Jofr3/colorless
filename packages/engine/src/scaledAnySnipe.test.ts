import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackCoinFlip, deriveAttackDamageSuppression } from "./effects";
import { applyAction, deriveAttackEffect } from "./index";
import type { EffectOp, GameState, PokemonRef } from "./index";
import {
  SCALED_SNIPE_DECK,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  findEvent,
} from "./testFixtures";

/** The two printed sentences, transcribed byte for byte off the committed column. */
const SCALED_20 =
  "This attack does 20 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const SCALED_30 =
  "This attack does 30 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const PLAIN_20 =
  "This attack does 20 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** `fix-scaledsnipe`'s attack indices, named so a board reads as a sentence. */
const IDX = { scaled20: 0, scaled30: 1, plain20: 2, bothRiders: 3 } as const;

/** Setup with BOTH Actives pinned to fix-lightning-weak (×2 Lightning, 130 HP, empty
    Bench — a deterministic {L}-weak Defender), then open P1's turn 2. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: SCALED_SNIPE_DECK, p2: SCALED_SNIPE_DECK },
    { first: "p2", active: { p1: "fix-lightning-weak", p2: "fix-lightning-weak" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `fix-scaledsnipe` carrying `energy` {L} Energy CARDS and `plain` Colorless
    ones; P2 keeps its fix-lightning-weak Active and its Bench holds exactly `benched`. */
function scaled(
  seed: number,
  opts: { energy: number; plain?: number; benched?: readonly string[] },
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-scaledsnipe");
  state = attachFromDeck(state, "p1", "fix-lightning-energy", opts.energy);
  if (opts.plain !== undefined) state = attachFromDeck(state, "p1", "fix-energy", opts.plain);
  for (const body of opts.benched ?? []) state = benchFromDeck(state, "p2", body);
  return state;
}

describe("§1 — the two printed sentences, and what they cost the residue", () => {
  it("both are in the legal attack column at the printing counts this slice claims", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(SCALED_20)).toBe(2);
    expect(rows.get(SCALED_30)).toBe(1);
    expect(rows.get(PLAIN_20)).toBe(1);
  });

  it("all three resolve through the reader SURFACE, and the surface did not grow", () => {
    for (const s of [SCALED_20, SCALED_30, PLAIN_20]) expect(resolvedByAnyReader(s), s).toBe(true);
  });

  it("the scaled family is CLOSED at these two, and the rest is refused BY NAME", () => {
    const family = legalAttackCorpus().filter(
      // /i on the head, because ONE member spells it "For each …" at the start of the
      // sentence — a case-sensitive `includes` reports NINE and silently drops it.
      ([, t]) => /for each/i.test(t) && t.includes("damage to "),
    );
    expect(family).toHaveLength(10);
    const unbuilt = family.filter(([, t]) => !resolvedByAnyReader(t)).map(([, t]) => t);
    expect(unbuilt).toHaveLength(1);
    const OPPONENT_BENCH_TAILS =
      "Your opponent flips a coin for each of their Benched Pokémon. This attack does 80 damage to your opponent's Active Pokémon for each tails. This attack's damage isn't affected by Weakness or Resistance.";
    expect(family.map(([, t]) => t)).toContain(OPPONENT_BENCH_TAILS);
    expect(unbuilt).not.toContain(OPPONENT_BENCH_TAILS);
    expect(deriveAttackCoinFlip(OPPONENT_BENCH_TAILS)).toEqual({
      kind: "opponentPerTails",
      flips: { kind: "opponentBench" },
      per: 80,
    });
    expect(deriveAttackDamageSuppression(OPPONENT_BENCH_TAILS)).toEqual({
      weakness: true,
      resistance: true,
    });
    expect(deriveAttackEffect(OPPONENT_BENCH_TAILS)).toBeNull();
    const NAMED_BODIES_COMPOUND =
      "This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    expect(family.map(([, t]) => t)).toContain(NAMED_BODIES_COMPOUND);
    expect(unbuilt).not.toContain(NAMED_BODIES_COMPOUND);
    const namedOp = (deriveAttackEffect(NAMED_BODIES_COMPOUND) ?? [])[0];
    expect(namedOp?.op).toBe("damageChosen");
    expect((namedOp as { target?: string } | undefined)?.target).toBe("yourAny");
    expect((namedOp as { count?: unknown } | undefined)?.count).toBe("all");
    const SELF_RECOIL_SCALED =
      "This Pokémon also does 10 damage to itself for each damage counter on it.";
    expect(family.map(([, t]) => t)).toContain(SELF_RECOIL_SCALED);
    expect(unbuilt).not.toContain(SELF_RECOIL_SCALED);
    // …and the op it derives to is the one that says it was never this family's: a
    // `damageSelf` on the ATTACKER, with no `target`, no `count` and no arity.
    expect(deriveAttackEffect(SELF_RECOIL_SCALED)).toEqual([
      { op: "damageSelf", amount: 10, perDamageCounterOnSelf: true },
    ]);
    const HAND_SCALED_SNIPE =
      "Discard up to 3 Energy cards from your hand. This attack does 60 damage to 1 of your opponent's Pokémon for each Energy card you discarded in this way. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    expect(family.map(([, t]) => t)).toContain(HAND_SCALED_SNIPE);
    expect(unbuilt).not.toContain(HAND_SCALED_SNIPE);
    expect(deriveAttackEffect(HAND_SCALED_SNIPE)).toEqual([
      {
        op: "payFromHand",
        count: "any",
        cap: 3,
        to: "discard",
        filter: { kind: "anyEnergy" },
        recordAs: "discarded",
      },
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 60,
        count: 1,
        source: "attack",
        deals: true,
        perRecorded: "discarded",
      },
    ]);
    const TARGET_COUNTER_SNIPE =
      "This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    expect(family.map(([, t]) => t)).toContain(TARGET_COUNTER_SNIPE);
    expect(unbuilt).not.toContain(TARGET_COUNTER_SNIPE);
    expect(deriveAttackEffect(TARGET_COUNTER_SNIPE)).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 20,
        count: 1,
        source: "attack",
        deals: true,
        perDamageCounterOnTarget: true,
      },
    ]);
    expect(
      deriveAttackEffect(
        "This attack does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
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
    const SPREAD_SCALED =
      "This attack also does 10 damage to each of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    expect(family.map(([, t]) => t)).toContain(SPREAD_SCALED);
    expect(unbuilt).not.toContain(SPREAD_SCALED);
    expect(deriveAttackEffect(SPREAD_SCALED)).toEqual([
      { op: "spreadDamage", target: "opponentBench", amount: 10, perTakenPrize: true },
    ]);
    expect(
      deriveAttackEffect(
        "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([{ op: "spreadDamage", target: "opponentBench", amount: 10 }]);
    const COUNTER_SCALED =
      "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.";
    const COUNTER_PLAIN = "Put 2 damage counters on 1 of your opponent's Pokémon.";
    const rows2 = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows2.get(COUNTER_SCALED)).toBe(3);
    expect(rows2.get(COUNTER_PLAIN)).toBe(1);
    expect(resolvedByAnyReader(COUNTER_SCALED)).toBe(true);
    expect(deriveAttackEffect(COUNTER_SCALED)).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 20,
        count: 1,
        source: "attack",
        perDiscardPileCard: { kind: "basicEnergy", energyType: "Grass" },
      },
      {
        op: "discardPileRetrieval",
        filter: { kind: "basicEnergy", energyType: "Grass" },
        dest: "deck",
        max: "all",
      },
      { op: "shuffleDeck" },
    ]);
    expect(deriveAttackEffect(COUNTER_SCALED)).not.toEqual(deriveAttackEffect(COUNTER_PLAIN));
    expect(deriveAttackEffect(COUNTER_PLAIN)?.[0]).not.toHaveProperty("perDiscardPileCard");
    expect(resolvedByAnyReader(COUNTER_PLAIN)).toBe(true);
    expect(deriveAttackEffect(COUNTER_PLAIN)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 20, count: 1, source: "attack" },
    ]);
    expect(
      deriveAttackEffect(
        "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile.",
      ),
    ).toBeNull();
    expect(deriveAttackEffect("Then, shuffle those Energy cards into your deck.")).toBeNull();
    const PICK_WITH_REPLACEMENT =
      "Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance.";
    expect(family.map(([, t]) => t)).toContain(PICK_WITH_REPLACEMENT);
    expect(unbuilt).not.toContain(PICK_WITH_REPLACEMENT);
    const SIX = deriveAttackEffect(PICK_WITH_REPLACEMENT);
    expect(SIX).toHaveLength(6);
    expect(new Set((SIX ?? []).map((op) => JSON.stringify(op))).size).toBe(1);
    expect(SIX?.[0]).toEqual({
      op: "damageChosen",
      target: "opponentAny",
      amount: 20,
      count: 1,
      source: "attack",
      deals: true,
      ignoreWR: true,
      wrOnly: true,
    });
    expect(Object.keys(SIX?.[0] ?? {}).sort()).toEqual([
      "amount",
      "count",
      "deals",
      "ignoreWR",
      "op",
      "source",
      "target",
      "wrOnly",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reader, and the group shift the widening forced.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — `deriveAttackEffect` reads the count clause as one op rider", () => {
  it("reads both printed amounts as a count-1 opponentAny snipe with `perEnergyOnSelf`", () => {
    expect(deriveAttackEffect(SCALED_20)).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 20,
        count: 1,
        source: "attack",
        deals: true,
        perEnergyOnSelf: true,
      },
    ]);
    expect(deriveAttackEffect(SCALED_30)).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 30,
        count: 1,
        source: "attack",
        deals: true,
        perEnergyOnSelf: true,
      },
    ]);
  });

  it("the ONE-AXIS control: deleting the clause gives the shipped BARE op, unchanged", () => {
    expect(deriveAttackEffect(PLAIN_20)).toEqual([
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

  it("the group shift did NOT lose `ignoreWR` — Umbreon and both count-2 spellings", () => {
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
    // the count-2 spelling with the plural number word — group 5's agreement test
    expect(
      deriveAttackEffect(
        "This attack does 30 damage to 2 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on those Pokémon.",
      ),
    ).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 30,
        count: 2,
        source: "attack",
        deals: true,
        ignoreWR: true,
      },
    ]);
    // …and the DISAGREEING spelling is still refused, which is the half a shifted index
    // would break silently in the other direction (the guard reading `undefined`).
    expect(
      deriveAttackEffect(
        "This attack does 30 damage to 2 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.",
      ),
    ).toBeNull();
  });

  it("the UNPRINTED PAIR is refused LOUDLY rather than resolved on one rider", () => {
    expect(
      deriveAttackEffect(
        "This attack does 20 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. This attack's damage isn't affected by Weakness or Resistance.",
      ),
    ).toBeNull();
    // …and the measurement behind that refusal, run over the whole column rather than
    // asserted: no printed sentence spells both clauses.
    const both = legalAttackCorpus().filter(
      ([, t]) =>
        t.includes("for each Energy attached to this Pokémon") &&
        t.includes("isn't affected by Weakness or Resistance"),
    );
    expect(both).toHaveLength(0);
  });

  it("the near-misses, each the resolving sentence with ONE token changed", () => {
    const pairs: readonly (readonly [string, string, string])[] = [
      // a printed 0 amount buys nothing, the shipped guard, unmoved by the new group
      ["a printed 0 amount", SCALED_20.replace("does 20", "does 0"), SCALED_20],
      // a printed 0 arity parks nobody — the second positivity guard, also unmoved
      ["a printed 0 arity", SCALED_20.replace("to 1 of", "to 0 of"), SCALED_20],
      [
        "the board-wide zone",
        SCALED_20.replace("attached to this Pokémon", "attached to all of your Pokémon"),
        SCALED_20,
      ],
      // the clause rides the OPPONENT-side noun only; "your Pokémon" is a different
      // target the anchor has never claimed, and the clause does not smuggle it in
      [
        "an own-side target noun",
        SCALED_20.replace("your opponent's Pokémon", "your Pokémon"),
        SCALED_20,
      ],
      // the lookalike é falls off the path silently, this family's standing reason
      ["a lookalike `Pokemon`", SCALED_20.replace(/Pokémon/g, "Pokemon"), SCALED_20],
      // no leading `This attack`: a mid-sentence clause must not reach this path
      ["a mid-sentence clause", `Flip a coin. ${SCALED_20}`, SCALED_20],
    ];
    for (const [why, refused, admitted] of pairs) {
      expect(deriveAttackEffect(refused), `REFUSED: ${why}`).toBeNull();
      expect(deriveAttackEffect(admitted), `ADMITTED beside ${why}`).not.toBeNull();
    }
    expect(
      deriveAttackEffect(SCALED_20.replace("for each Energy", "for each {L} Energy"))?.[0],
    ).toMatchObject({
      perTypedEnergyOnSelf: "Lightning",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the widening, and the version prediction DRIVEN over the bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — a new optional rider on a PERSISTED op, and the record version does not move", () => {
  it("the version PREDICTION, driven over the SERIALIZED BYTES in both directions", () => {
    const preSlice = [
      '{"op":"damageChosen","target":"opponentAny","amount":20,"count":1,"source":"attack","deals":true}',
      '{"op":"damageChosen","target":"opponentBench","amount":40,"count":1,"source":"attack","deals":true,"perTakenPrize":true}',
    ];
    for (const bytes of preSlice) {
      const revived = JSON.parse(bytes) as EffectOp;
      expect(JSON.stringify(revived)).toBe(bytes); // no key gained, none lost, order kept
    }
    expect(JSON.parse(preSlice[0] as string)).toEqual(deriveAttackEffect(PLAIN_20)?.[0]);
    expect(
      deriveAttackEffect(
        "This attack does 40 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken.",
      )?.[0],
    ).toEqual(JSON.parse(preSlice[1] as string));

    const fresh = deriveAttackEffect(SCALED_20)?.[0];
    expect(JSON.stringify(fresh)).toBe(
      '{"op":"damageChosen","target":"opponentAny","amount":20,"count":1,"source":"attack","deals":true,"perEnergyOnSelf":true}',
    );
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(fresh);

    const dropped = JSON.parse(
      JSON.stringify(fresh, (k, v) => (k === "perEnergyOnSelf" ? undefined : v)),
    ) as EffectOp;
    expect(dropped).toEqual(deriveAttackEffect(PLAIN_20)?.[0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the board: the fold is real, and §8.5 is NOT skipped.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the amount scales, and every step the unscaled snipe honours is honoured", () => {
  it("the multiplier is the ATTACHED ENERGY COUNT — 1 → 20, 3 → 60, on one sentence", () => {
    // The lone Active is the only candidate, so the count-1 snipe auto-takes and the
    // number in DAMAGE_DEALT is the whole measurement. ×2 Lightning doubles it, so the
    // pair below reads 40 and 120 — and the RATIO is 3, which is the fold.
    const one = mustApply(scaled(1, { energy: 1 }), {
      type: "attack",
      seat: "p1",
      index: IDX.scaled20,
    });
    expect(findEvent(one.events, "DAMAGE_DEALT")).toMatchObject({ base: 20, dealt: 40 });
    const three = mustApply(scaled(2, { energy: 3 }), {
      type: "attack",
      seat: "p1",
      index: IDX.scaled20,
    });
    expect(findEvent(three.events, "DAMAGE_DEALT")).toMatchObject({ base: 60, dealt: 120 });
    expect(three.state.players.p2.active?.damage).toBe(120);
    // …and the PRINTED 30 on the same board is 30 × 3 = 90, doubled to 180: a second
    // amount so the multiplication is not confusable with a hard-coded 60.
    const heavy = mustApply(scaled(3, { energy: 3 }), {
      type: "attack",
      seat: "p1",
      index: IDX.scaled30,
    });
    expect(findEvent(heavy.events, "DAMAGE_DEALT")).toMatchObject({ base: 90, dealt: 180 });
    const mixed = mustApply(scaled(11, { energy: 2, plain: 1 }), {
      type: "attack",
      seat: "p1",
      index: IDX.scaled20,
    });
    expect(findEvent(mixed.events, "DAMAGE_DEALT")).toMatchObject({ base: 60, dealt: 120 });
  });

  it("the CONTROL on the same body does NOT scale — index 2 stays at the printed 20", () => {
    const { events } = mustApply(scaled(4, { energy: 3 }), {
      type: "attack",
      seat: "p1",
      index: IDX.plain20,
    });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 20, dealt: 40 });
  });

  it("§8.5 IS RUN ON THE ACTIVE PICK AND NOT ON THE BENCH PICK — one op, one board", () => {
    const state = scaled(5, { energy: 3, benched: ["fix-lightning-weak"] });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: IDX.scaled20 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.candidates[0]).toMatchObject({ seat: "p2", spot: { spot: "active" } });
    expect(prompt.candidates[1]).toMatchObject({ seat: "p2", spot: { spot: "bench", index: 0 } });
    expect(prompt.note).toContain("60 damage each");
    expect(prompt.note).toContain("of your opponent's Pokémon");
    // the BENCH pick — flat, W/R absent by construction (§8.5)
    const benchHit = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    expect(findEvent(benchHit.events, "DAMAGE_DEALT")).toMatchObject({
      base: 60,
      weakness: null,
      resistance: null,
      dealt: 60,
    });
    expect(benchHit.state.players.p2.bench[0]?.damage).toBe(60);
    expect(benchHit.state.players.p2.active?.damage).toBe(0);
    // the ACTIVE pick on the SAME parked board — the full §8.5 pipeline, 60 × 2
    const activeHit = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(findEvent(activeHit.events, "DAMAGE_DEALT")).toMatchObject({
      base: 60,
      weakness: { op: "multiply", amount: 2 },
      dealt: 120,
    });
    expect(activeHit.state.players.p2.bench[0]?.damage).toBe(0);
  });

  it("the fold is re-run at the PICK and agrees with the one the prompt quoted", () => {
    const state = scaled(6, { energy: 3, benched: ["fix-lightning-weak"] });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: IDX.scaled20 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.note).toContain("60 damage each");
    // …and the op that rode the park carries the rider, which is the persisted half
    if (parked.phase.cont === undefined) throw new Error("expected a continuation");
    expect(parked.phase.cont.pendingOp).toMatchObject({
      op: "damageChosen",
      amount: 20,
      perEnergyOnSelf: true,
    });
    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 60, dealt: 60 });
  });

  it("the ATTACKER's own pre-W/R bonus still lands INSIDE the fold's result", () => {
    let state = scaled(7, { energy: 2 });
    state = handFromDeck(state, "p1", "sv01-197", 1);
    const band = handUid(state, "p1", "sv01-197");
    state = must(
      applyAction(state, { type: "attachTool", seat: "p1", uid: band, target: { spot: "active" } }),
    );
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: IDX.scaled20 });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      base: 40,
      bonus: 10,
      weakness: { op: "multiply", amount: 2 },
      dealt: 100,
    });
  });

  it("the UNPRINTED PAIR on the same body reaches the loud skip path, not a board", () => {
    // index 3 carries the count clause AND the W/R tail. The reader refuses it, so the
    // attack resolves with no program at all — the control that says §2's refusal is
    // the READER's and not an accident of the anchor's position in the arm list.
    const { events, state: done } = mustApply(scaled(8, { energy: 3 }), {
      type: "attack",
      seat: "p1",
      index: IDX.bothRiders,
    });
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeDefined();
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("never mutates the state it was given (purity — through the scaled active arm)", () => {
    const state = scaled(9, { energy: 3 });
    deepFreeze(state);
    expect(() =>
      applyAction(state, { type: "attack", seat: "p1", index: IDX.scaled20 }),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — ZERO, and what is actually reachable.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — a zero multiplier, and the honest reachability answer", () => {
  it("the 0 doctrine is SHARED with `perTakenPrize` and is NOT a candidate question", () => {
    const { events } = mustApply(scaled(10, { energy: 1 }), {
      type: "attack",
      seat: "p1",
      index: IDX.scaled20,
    });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 20 });
    // …and the guard the doctrine rests on is the one Covetous Ivy already exercises
    // at zero taken Prizes, which is a REACHABLE zero and is pinned in its own suite.
    // The two riders reach the identical `amount <= 0` line; nothing here re-tests it.
    expect(
      deriveAttackEffect(
        "This attack does 40 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken.",
      )?.[0],
    ).toMatchObject({ perTakenPrize: true });
  });
});
