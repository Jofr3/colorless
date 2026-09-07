import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { applyAction, deriveAttackEffect } from "./index";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
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
} from "./testFixtures";

// 0.38.0 → 0.39.0 — the ANY-target snipe family.
//
// "This attack does N damage to 1 of your opponent's Pokémon. (Don't apply Weakness
// and Resistance for Benched Pokémon.)" is the WHOLE attack (no `damage` field) — a
// chosen hit on the Active OR a Bench. `damageChosen` gained `target: "opponentAny"`
// (candidates = the opponent's Active + Bench); `placeSnipe` an Active arm that runs
// the §8.5 W/R pipeline, because Weakness/Resistance apply ONLY to the Active — a
// Benched pick stays flat. Rotom sv01-069 "Linear Attack" (Lightning, 20) is the W/R
// witness: 40 on a {L}-weak ACTIVE, 20 on the SAME body Benched. Fezandipiti ex
// sv06.5-038 "Cruel Arrow" (Darkness, 100) is the big flat twin.
//
// 0.46.0 — the ignoreWR rider (Umbreon "Feint Attack" sv03-130): a second sentence,
// "This attack's damage isn't affected by Weakness or Resistance, or by any effects
// on that Pokémon.", sets `damageChosen.ignoreWR`, which nulls the target's W/R AND
// its reduction passive on both arms while keeping the attacker's own pre-W/R bonus.
// fix-feint (a synthetic {L} witness carrying the verbatim SV text) is the tester: on
// the {L}-weak Active the 50 stays FLAT (not doubled), and a benched Bouffalant's −20
// Bouffer is skipped.
//
// 0.305.0 → 0.306.0 — 🆕🆕 D401: THE SELF-DISCARD COST IN FRONT OF THE SNIPE (§4–§6 below).
//
// The compound family — 4 sentences / 7 printings — gets its OWN whole-sentence
// anchor, because `deriveAttackEffect` has no composition path and never has had one.
// The engine's first attack program to PARK TWICE on one printed sentence pair, and it
// cost no op, no field and no persisted version: `EffectContinuation.rest` has been an
// `EffectOp[]` since M5, so the queue already did this.
//
// 0.304.0 → 0.305.0 — 🆕🆕 D400: THE ARITY, AND THE TAIL'S NUMBER THAT AGREES WITH IT.
//
// `CHOSEN_ANY_TARGET` spelled the count as the literal `1` while the legal attack
// column printed 2 on TWO sentences worth NINE printings — the Benched-clarifier
// spelling at 3 and the W/R-tail spelling at 6, the latter being the largest single
// unresolved sentence in the residue at D399's head. Both are taken here by ONE
// capture, on the evidence D399 established one anchor over: `damageChosen.count` has
// been a plain `number` since M4 and nothing below the reader needed changing.
//
// 🛑 THE SHAPE QUESTION WAS SETTLED FROM THE COLUMN, AND THIS ANCHOR'S OWN PRINTINGS
// COULD NOT SETTLE IT. The 6-printing sentence spells *those* where Umbreon's tail
// spells *that*, so the choice was a `th(?:at|ose)` class (which resolves two
// sentences nobody prints) or ENFORCED AGREEMENT. The handoff's prediction — *that*
// only at count 1, *those* only at count ≥ 2 — HOLDS in the direction it can be
// tested and is VACUOUS in the other: this tail spells *that* on ZERO legal
// printings, the printed count-1 W/R sentence carrying the BARE form. §1 measures
// both cells and the column-wide fact that does decide it: 19 sentences / 43
// printings spell *that*/*those*, every referent agrees, and ONE sentence spells both
// — switching mid-sentence when the referent's number switches.
//
// 🛑 AND THE ENFORCEMENT IS DRIVEN BY A ONE-WORD FLIP IN BOTH DIRECTIONS, which is
// D399's finding applied before it could cost anything: a near-miss proves nothing
// about a guard it never reaches, so each refused sentence here is the RESOLVING one
// with a single word changed, and its unflipped twin is asserted to resolve in the
// same `it`.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

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
    ).toEqual([{ op: "damageChosen", target: "opponentAny", amount: 20, count: 1, source: "attack", deals: true }]);
  });

  it("the W/R clarifier tail is OPTIONAL, and the amount is CAPTURED (100)", () => {
    expect(
      deriveAttackEffect("This attack does 100 damage to 1 of your opponent's Pokémon."),
    ).toEqual([{ op: "damageChosen", target: "opponentAny", amount: 100, count: 1, source: "attack", deals: true }]);
  });

  it("reads Umbreon 'Feint Attack' as an ignoreWR snipe — both the SV and bare wordings", () => {
    // sv03-130 (Obsidian Flames), VERBATIM: the second sentence sets `ignoreWR`. The
    // "or by any effects on that Pokémon" clause is optional, so the bare classic
    // wording derives the SAME flag — this was a `toBeNull()` near-miss before 0.46.0.
    expect(
      deriveAttackEffect(
        "This attack does 50 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.",
      ),
    ).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 50, count: 1, source: "attack", deals: true, ignoreWR: true },
    ]);
    expect(
      deriveAttackEffect(
        "This attack does 50 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance.",
      ),
    ).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 50, count: 1, source: "attack", deals: true, ignoreWR: true },
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
    // "Benched Pokémon" is the opponentBench family (D57/D58); the any-target reader
    // names just "Pokémon", so it must not steal them — they stay a DIFFERENT target.
    expect(
      deriveAttackEffect(
        "This attack does 60 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken.",
      ),
    ).toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 60, count: 1, source: "attack", deals: true, perTakenPrize: true },
    ]);
    expect(
      deriveAttackEffect(
        "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([{ op: "damageChosen", target: "opponentBench", amount: 30, count: 1, source: "attack", deals: true }]);
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
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
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
    expect(find(e2, "DAMAGE_DEALT")).toMatchObject({ base: 20, weakness: null, dealt: 20 });
    expect(done.players.p2.bench[0]?.damage).toBe(20);
    expect(done.players.p2.active?.damage).toBe(0); // the Active was NOT the pick
  });

  it("a non-weak Active takes the FLAT amount — Fezandipiti's Darkness 100, no double", () => {
    // Fezandipiti is Darkness; the Active is ×2 Lightning, NOT Darkness — so no
    // Weakness fires and 100 lands flat (210 HP body attacking a 130 HP one survives).
    // Pins the amount ≠ Rotom's 20 and that Weakness only fires on a real match.
    const state = anySnipe(3, { attacker: "sv06.5-038", energy: 3, benched: [] });
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 100, weakness: null, dealt: 100 });
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
    expect(find(events, "KNOCKED_OUT")?.uid).toBe(victimUid);
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
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
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
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
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
    // "…or by any effects on that Pokémon" ignores effects on the TARGET, not the
    // attacker: Vitality Band (on fix-feint) still adds +10 before W/R — but with
    // Weakness nulled it lands flat, 50 + 10 = 60, where the ordinary snipe above
    // doubled the bonus inside Weakness ((20 + 10) × 2 = 60 for Rotom, coincidentally).
    let state = anySnipe(6, { attacker: "fix-feint", energy: 1, benched: [] }, FEINT_DECK);
    state = handFromDeck(state, "p1", "sv01-197", 1);
    const band = handUid(state, "p1", "sv01-197");
    state = must(
      applyAction(state, { type: "attachTool", seat: "p1", uid: band, target: { spot: "active" } }),
    );
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
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
    const state = anySnipe(2, { attacker: "fix-feint", energy: 1, benched: ["sv03-174"] }, FEINT_DECK);
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
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 50, weakness: null, dealt: 50 });
    expect(done.players.p2.bench[0]?.damage).toBe(50); // the −20 Bouffer was ignored
    expect(done.players.p2.active?.damage).toBe(0); // the Active was NOT the pick
  });
});

// ── 🆕🆕 D400 ──────────────────────────────────────────────────────────────────
//
// The count-2 half of the family: the price, the reading, the agreement rule and the
// board where `ignoreWR` and `count: 2` meet for the first time.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The two sentences this slice buys, byte-for-byte from the committed corpus. */
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

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** P1 fields `attacker` off TWIN_SNIPE_DECK with one {L} attached; P2 keeps its
    fix-lightning-weak Active and its Bench holds exactly `benched`. */
function twin(seed: number, attacker: string, benched: readonly string[]): GameState {
  return anySnipe(seed, { attacker, energy: 1, benched }, TWIN_SNIPE_DECK);
}

describe("§1 — D400's price and its SHAPE question, both measured off the corpus", () => {
  it("🛑 the arity is worth 2 sentences / 9 printings, and both were refused by a LITERAL", () => {
    // The rung `conditionalBenchSnipe.test.ts` §1 handed over, re-derived here rather
    // than inherited — and this is where it now lives, since the sentences resolve.
    const anyTwos = corpus().filter(([, t]) =>
      /^This attack does \d+ damage to [2-9] of your opponent's Pokémon\./.test(t),
    );
    expect(anyTwos).toHaveLength(2);
    expect(units(anyTwos)).toBe(9);
    expect(anyTwos.map(([, t]) => t).sort()).toEqual([FLAT_TWO, FEINT_TWO].sort());
    for (const [, t] of anyTwos) expect(deriveAttackEffect(t), t).not.toBeNull();
    // …and the split is 3 / 6, the W/R-tail spelling being the bigger half.
    expect(units(corpus().filter(([, t]) => t === FLAT_TWO))).toBe(3);
    expect(units(corpus().filter(([, t]) => t === FEINT_TWO))).toBe(6);
  });

  it("🛑 the tail's number: *those* at count 2 on 6 printings, *that* on ZERO", () => {
    // 🛑 THE HALF OF THE HANDOFF'S PREDICTION THAT IS VACUOUS, MEASURED RATHER THAN
    // ASSUMED. The prediction was "*that* only at count 1, *those* only at count ≥ 2".
    // The second half holds; the FIRST cell is EMPTY — this tail spells *that* on no
    // legal printing at all, because the count-1 W/R sentence the column does print
    // carries the BARE form. So the optional "or by any effects on that Pokémon"
    // clause the anchor has admitted since 0.46.0 serves zero legal printings, which
    // is why the agreement rule could not be settled from this tail.
    const tailed = corpus().filter(([, t]) => /any effects on th(?:at|ose) Pokémon/.test(t));
    expect(tailed).toHaveLength(1);
    expect(units(tailed)).toBe(6);
    expect(tailed[0]?.[1]).toBe(FEINT_TWO);
    // The count-1 W/R sentence that IS printed — the bare tail, 2 printings.
    const bare = corpus().filter(
      ([, t]) =>
        t ===
        "This attack does 70 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance.",
    );
    expect(units(bare)).toBe(2);
  });

  it("🛑 what DOES decide it: 19 sentences / 43 printings agree, and ONE switches mid-sentence", () => {
    // Agreement is a fact about the CATALOG rather than about this anchor, which is
    // what makes enforcing it a reading rather than an invention. Across the whole
    // 640-sentence legal attack column every printed "that Pokémon" has a SINGULAR
    // referent (a "1 of", an Active, or a distributive "for each of") and every
    // "those Pokémon" a PLURAL one (a "2 of", a "3 of", an "up to 2 of").
    const singular = corpus().filter(([, t]) => /\bthat Pokémon\b/.test(t));
    const plural = corpus().filter(([, t]) => /\bthose Pokémon\b/.test(t));
    expect([singular.length, units(singular)]).toEqual([15, 32]);
    expect([plural.length, units(plural)]).toEqual([4, 12]);
    // 🛑 THE SHARPEST DATUM IN THE SET IS THE ONE SENTENCE THAT SPELLS BOTH. The {D}
    // evolve search says "for each of THOSE Pokémon … evolves from THAT Pokémon" —
    // plural for the chosen set, singular for the member. The column does not merely
    // happen to agree; it SWITCHES spelling mid-sentence when the referent's number
    // switches, which is the difference between a coincidence and a rule.
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

  it("⚠️ RE-POINTED AT D401 — the COMPOUND count-≠-1 family was NAMED here, and D401 built it", () => {
    // ⚠️ **THE HANDOFF THIS RUNG WAS WRITTEN AS, SPENT ONE SLICE LATER.** D400 named
    // the two count-≠-1 compounds, asserted the population and asserted that a count
    // capture structurally could not move them — true then and true now: they are off
    // the `^This attack does` anchor and it is a SECOND anchor, not a wider first one,
    // that reads them. So the POPULATION half is unchanged and still guards the
    // arithmetic, while the resolution half is RE-POINTED rather than deleted (D399's
    // rule, third slice running).
    const compounds = corpus().filter(
      ([, t]) =>
        /^Discard .* This attack does \d+ damage to [2-9] of your opponent's Pokémon\./.test(t),
    );
    expect(compounds).toHaveLength(2);
    expect(units(compounds)).toBe(4);
    for (const [, t] of compounds) expect(deriveAttackEffect(t), t).not.toBeNull();
    // 🛑 AND THE THING THAT IS STILL REFUSED IS THE ONE THAT MATTERS: `CHOSEN_ANY_TARGET`
    // did NOT widen to reach them. Stripping the leading discard clause leaves a
    // sentence that reader resolves on its own — so if the two anchors had been merged
    // into a prefix match, the cost would silently vanish and this control would still
    // be green. It is the compound that must derive TWO ops, not one.
    for (const [, t] of compounds) {
      expect(deriveAttackEffect(t), t).toHaveLength(2);
      const bare = t.replace(/^Discard [^.]+\. /, "");
      expect(deriveAttackEffect(bare), bare).toHaveLength(1);
    }
  });
});

describe("§2 — the READING: one capture, and the tail's number must AGREE with it", () => {
  it("🛑 both printed sentences derive, and the count is READ rather than remembered", () => {
    expect(deriveAttackEffect(FLAT_TWO)).toEqual([TWIN_FLAT]);
    expect(deriveAttackEffect(FEINT_TWO)).toEqual([{ ...TWIN_FLAT, ignoreWR: true }]);
    // A count no printing carries, at an amount no printing carries — the guard
    // against a reader that memorised this slice's numbers instead of reading them.
    expect(
      deriveAttackEffect(
        "This attack does 35 damage to 4 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([{ ...TWIN_FLAT, amount: 35, count: 4 }]);
  });

  it("🛑 the count-1 spellings are UNMOVED — the capture widened the anchor, it did not re-aim it", () => {
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

  it("🛑 a DISAGREEING number word is refused, and the flip is ONE WORD from a resolving sentence", () => {
    // 🛑 D399's LESSON SPENT BEFORE IT COST ANYTHING: a near-miss the anchor refuses
    // one level down proves nothing about the guard wrapped around it. Each refusal
    // below is a sentence the PATTERN matches in full — every other byte is a printed
    // one — so the agreement comparison is the only thing that can be rejecting it,
    // and its unflipped twin is asserted to resolve in the same `it`.
    const singularAtTwo =
      "This attack does 50 damage to 2 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.";
    const pluralAtOne =
      "This attack does 50 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on those Pokémon.";
    expect(deriveAttackEffect(singularAtTwo)).toBeNull();
    expect(deriveAttackEffect(pluralAtOne)).toBeNull();
    // The one-word controls: flip *that*→*those* at 2 and *those*→*that* at 1 and both
    // resolve. Neither refusal above can therefore be blamed on any other byte.
    expect(singularAtTwo.replace("on that Pokémon", "on those Pokémon")).toBe(FEINT_TWO);
    expect(deriveAttackEffect(singularAtTwo.replace("on that Pokémon", "on those Pokémon"))).toEqual(
      [{ ...TWIN_FLAT, ignoreWR: true }],
    );
    expect(
      deriveAttackEffect(pluralAtOne.replace("on those Pokémon", "on that Pokémon")),
    ).toEqual([{ ...TWIN_FLAT, count: 1, ignoreWR: true }]);
    // …and neither refused sentence is printed, which is what makes the refusal free.
    for (const t of [singularAtTwo, pluralAtOne]) expect(corpus().some(([, c]) => c === t)).toBe(false);
  });

  it("🛑 the anchor's TERMINATOR: a COMPOUND that BEGINS with the printed sentence is refused", () => {
    // 🛑 D399's GAP, ARMED ONE ANCHOR OVER BEFORE IT COULD COST ANYTHING. Dropping the
    // `$` would turn this anchor into a PREFIX match, and it would LOOK LIKE A COVERAGE
    // WIN — a swallowed sentence leaves the unbuilt remainder and `BUILT.attack` rises.
    // The only string that can reach a whole-sentence terminator is one the pattern
    // matches ENTIRELY and that then keeps going, i.e. a COMPOUND; every other near-miss
    // in this file is refused further up, at `^This attack does` or at a literal inside
    // it, and so proves nothing about the `$`. Driven at THREE stopping points, because
    // the two optional groups are exactly where a prefix match would otherwise halt: the
    // bare opener, the Benched clarifier, and the W/R tail.
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

  it("🛑 a printed 0 in EITHER position stays on the loud path", () => {
    for (const text of [
      "This attack does 0 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "This attack does 50 damage to 0 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("🛑 the fixtures' printed bytes ARE the corpus's — neither can drift off the column", () => {
    // D183's rule: an arm written from a paraphrase passes a test written against the
    // same paraphrase and matches no real card. The card ids are unknown in this
    // container (no D1 credentials), so the corpus IS the provenance.
    expect(corpus().some(([, t]) => t === FLAT_TWO)).toBe(true);
    expect(corpus().some(([, t]) => t === FEINT_TWO)).toBe(true);
  });
});

describe("§3 — count 2 on a real board: the Active/Bench split, twice, with W/R on and off", () => {
  it("🛑 parks for EXACTLY 2 of 3 and the unchosen body is the control that makes 2 mean 2", () => {
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
    const dealt = findAll(e2, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(2);
    // The ACTIVE pick goes through §8.5 — a {L} attacker into a ×2 Lightning body.
    expect(dealt[0]).toMatchObject({ base: 50, weakness: { op: "multiply", amount: 2 }, dealt: 100 });
    // The BENCHED pick is flat, and Bouffalant's −20 "Bouffer" DOES bite: 50 → 30.
    expect(dealt[1]).toMatchObject({ base: 50, weakness: null, dealt: 30 });
    expect(done.players.p2.active?.damage).toBe(100);
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([0, 30]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 the SAME two picks under `ignoreWR`: 100 → 50 on the Active, 30 → 50 on the Bench", () => {
    // The combination no shipped program had — `{target: "opponentAny", count: 2}` WITH
    // the flag. Both halves of "isn't affected by Weakness or Resistance, or by any
    // effects on those Pokémon" are visible at once and they move in OPPOSITE
    // directions from the rung above: the Active loses its doubling, the Bench keeps
    // the 20 the reduction passive would have taken.
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
    const dealt = findAll(events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(2);
    expect(dealt[0]).toMatchObject({ base: 50, weakness: null, resistance: null, dealt: 50 });
    expect(dealt[1]).toMatchObject({ base: 50, weakness: null, dealt: 50 });
    expect(done.players.p2.active?.damage).toBe(50);
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([0, 50]);
  });

  it("🛑 the two picks must be DISTINCT — 100 on one body is the arity's silent failure", () => {
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
        applyAction(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemonMulti", refs } })
          .ok,
      ).toBe(false);
    }
  });

  it("🛑 exactly 2 candidates AUTO-TAKES both — no decision is left, so no prompt", () => {
    const { state: done, events } = mustApply(twin(4003, "fix-twinsnipe", ["sv03-174"]), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.players.p2.active?.damage).toBe(100); // ×2 Lightning
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([30]); // 50 − 20 Bouffer
  });

  it("🛑 a BARE Active is §8.6's 'do as much as you can' — one hit, not a refusal", () => {
    // `opponentAny` can never offer zero candidates (the Active is always there during
    // an attack), so this is the arity's floor: the printed 2 clamps to 1.
    const { state: done, events } = mustApply(twin(4004, "fix-twinfeint", []), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(findAll(events, "DAMAGE_DEALT")).toHaveLength(1);
    expect(done.players.p2.active?.damage).toBe(50); // ignoreWR — not 100
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("never mutates the state it was given (purity — through the count-2 auto-take arm)", () => {
    const state = twin(4005, "fix-twinsnipe", ["sv03-174"]);
    deepFreeze(state);
    expect(() => applyAction(state, { type: "attack", seat: "p1", index: 0 })).not.toThrow();
  });
});

// ── 🆕🆕 D401 ──────────────────────────────────────────────────────────────────
//
// The §8 SELF-DISCARD COST in front of the snipe: the compound family, the shape
// question the catalog answered, and the first attack program in this engine that
// parks TWICE on one sentence pair.

/** The four printed compounds, byte-for-byte from the committed corpus. */
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
  it("🛑 the compound family is 4 sentences / 7 printings, and this anchor reads exactly them", () => {
    // The population is measured from the committed column rather than inherited,
    // and it is measured with the SAME shape the anchor spells — so a widened or
    // narrowed regex moves this rung before it moves anything else.
    const family = corpus().filter(([, t]) => COMPOUNDS.includes(t as (typeof COMPOUNDS)[number]));
    expect(family).toHaveLength(4);
    expect(units(family)).toBe(7);
    for (const t of COMPOUNDS) expect(corpus().some(([, c]) => c === t), t).toBe(true);
    // …and nothing ELSE in the whole column derives to a self-discard followed by an
    // any-target snipe. The reach and the census are the same set, which is the
    // check D139 says a bare `(\d+)` cannot be trusted without.
    //
    // 🆕🆕🆕 **D477 — THIS IS A FILTER-BUILT POPULATION, AND IT GREW WITHOUT ANYONE
    // NAMING A SENTENCE (D465).** The predicate below asks only for the op PAIR, so
    // D477's bench twin joined it the moment that arm landed — three sentences nobody
    // typed into this file. The repair is NOT to add them to `COMPOUNDS`, which would
    // make this rung claim a family it is not about; it is to PARTITION the pair-shaped
    // set by the field that tells the two anchors apart, so the rung still goes red on
    // *"a reader widened past the zone word"* and is green only on *"D477 built the
    // bench twin"* — the two states the old `toEqual(COMPOUNDS)` could not distinguish
    // once either was possible (D418: after re-pointing, ask what the OLD claim caught).
    const reads = corpus().filter(([, t]) => {
      const ops = deriveAttackEffect(t);
      return (
        ops !== null &&
        ops.length === 2 &&
        ops[0]?.op === "discardEnergy" &&
        ops[1]?.op === "damageChosen"
      );
    });
    // 🆕🆕🆕 **D483 — IT GREW AGAIN, BY THE SAME MECHANISM AND WITHOUT ANYONE TYPING A
    // SENTENCE, WHICH IS THE SECOND CONSECUTIVE SLICE TO PROVE D477's PARAGRAPH ABOVE
    // RIGHT.** The predicate asks only for the op PAIR, so corpus file line 111 — *"…and
    // this attack does 210 damage to 1 of your opponent's Benched Pokémon **ex**."* —
    // joined it the moment `damageChosen.filter` landed. 7 → **8** sentences, 12 → **13**
    // printings, and the whole of the growth is on the BENCH side of the partition below,
    // which is exactly what the partition exists to say.
    expect(reads).toHaveLength(8);
    expect(units(reads)).toBe(13);
    const aimedAnywhere = reads.filter(([, t]) => {
      const snipe = (deriveAttackEffect(t) as EffectOp[])[1];
      return snipe?.op === "damageChosen" && snipe.target === "opponentAny";
    });
    expect(aimedAnywhere.map(([, t]) => t).sort()).toEqual([...COMPOUNDS].sort());
    expect(units(aimedAnywhere)).toBe(7);
    // The complement is D477's, and it is asserted by CARDINALITY here rather than by
    // sentence — `costBenchSnipe.test.ts` owns those three strings, and a second copy of
    // them here is a claim that rots in two places (D415).
    const aimedAtTheBench = reads.filter(([, t]) => {
      const snipe = (deriveAttackEffect(t) as EffectOp[])[1];
      return snipe?.op === "damageChosen" && snipe.target === "opponentBench";
    });
    // 🆕🆕🆕 D483 — 3 → **4** / 5 → **6**: `costBenchSnipe.test.ts` still owns the
    // strings, and this file still owns only the cardinality (D415).
    expect(aimedAtTheBench).toHaveLength(4);
    expect(units(aimedAtTheBench)).toBe(6);
    expect(aimedAnywhere.length + aimedAtTheBench.length).toBe(reads.length);
  });

  it("🛑 THE SHAPE QUESTION: the printed JOIN is 3 sentences on `. ` and 1 on `, and `", () => {
    // 🛑 THE `. `-ONLY READING WOULD HAVE REFUSED THE FOURTH ON A CONJUNCTION RATHER
    // THAN ON A MECHANISM — D399's "a refusal that expired on a literal". Measured:
    // the period join carries 3 sentences / 6 printings and the comma join 1 / 1, the
    // ops are identical across the split, and both spellings resolve.
    const period = corpus().filter(([, t]) => /Pokémon\. This attack does/.test(t) && COMPOUNDS.includes(t as (typeof COMPOUNDS)[number]));
    const comma = corpus().filter(([, t]) => /Pokémon, and this attack does/.test(t) && COMPOUNDS.includes(t as (typeof COMPOUNDS)[number]));
    expect([period.length, units(period)]).toEqual([3, 6]);
    expect([comma.length, units(comma)]).toEqual([1, 1]);
    // The two joins are ONE relation: rewriting the comma printing's join into the
    // period one gives a sentence the anchor reads to the very same program.
    expect(ALL_ONE_COMMA.replace("Pokémon, and this", "Pokémon. This")).toBe(ALL_ONE);
    expect(deriveAttackEffect(ALL_ONE_COMMA)).toEqual(deriveAttackEffect(ALL_ONE));
  });

  it("🛑 AND THE W/R TAIL IS NOT ADMITTED, BECAUSE THIS SKELETON PRINTS IT ZERO TIMES", () => {
    // `CHOSEN_ANY_TARGET`'s tail is a THREE-way optional; this one is TWO-way, and the
    // difference is the measured cell rather than a preference. Sharing a fragment
    // with that anchor would resolve a sentence nobody prints (D190b, and D382's own
    // refusal to widen its `. Then, ` join to the coin form for the identical reason).
    const tailed = corpus().filter(
      ([, t]) => /^Discard /.test(t) && /isn't affected by Weakness or Resistance/.test(t),
    );
    expect(tailed).toEqual([]);
    // …and the refusal is the TAIL's, not another byte's: the same sentence carrying
    // the printed clarifier instead resolves, one clause apart (D399).
    const wr =
      "Discard all Energy from this Pokémon. This attack does 120 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance.";
    expect(deriveAttackEffect(wr)).toBeNull();
    expect(
      deriveAttackEffect(wr.replace(/ This attack's damage.*$/, " (Don't apply Weakness and Resistance for Benched Pokémon.)")),
    ).toEqual(deriveAttackEffect(ALL_ONE));
  });

  it("🛑 the DISCARD quantifier is `all` or a digit, and `an` is printed ZERO times here", () => {
    const all = corpus().filter(([, t]) => /^Discard all Energy/.test(t) && COMPOUNDS.includes(t as (typeof COMPOUNDS)[number]));
    const numeric = corpus().filter(([, t]) => /^Discard \d+ Energy/.test(t) && COMPOUNDS.includes(t as (typeof COMPOUNDS)[number]));
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
  it("🛑 all four printed sentences derive, and the numbers are READ rather than remembered", () => {
    expect(deriveAttackEffect(COST_TWO)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: 2 },
      { op: "damageChosen", target: "opponentAny", amount: 120, count: 2, source: "attack", deals: true },
    ]);
    expect(deriveAttackEffect(ALL_THREE)).toEqual([
      DISCARD_ALL,
      { op: "damageChosen", target: "opponentAny", amount: 110, count: 3, source: "attack", deals: true },
    ]);
    expect(deriveAttackEffect(ALL_ONE)).toEqual([
      DISCARD_ALL,
      { op: "damageChosen", target: "opponentAny", amount: 120, count: 1, source: "attack", deals: true },
    ]);
    expect(deriveAttackEffect(ALL_ONE_COMMA)).toEqual(deriveAttackEffect(ALL_ONE));
    // Three numbers no printing carries, at once — the guard against a reader that
    // memorised this slice's amounts instead of capturing them.
    expect(
      deriveAttackEffect(
        "Discard 4 Energy from this Pokémon. This attack does 35 damage to 5 of your opponent's Pokémon.",
      ),
    ).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: 4 },
      { op: "damageChosen", target: "opponentAny", amount: 35, count: 5, source: "attack", deals: true },
    ]);
  });

  it("🛑 D132's INVENTORY RULE: each half is BYTE-IDENTICAL to the bare anchor's own output", () => {
    // The whole claim of a compound anchor is that it buys a JOIN and nothing else. If
    // either half drifted from the reading the standalone sentence already has, this
    // arm would be a second, quieter implementation of an op that already ships.
    const compound = deriveAttackEffect(COST_TWO) as EffectOp[];
    expect(compound[0]).toEqual(
      (deriveAttackEffect("Discard 2 Energy from this Pokémon.") as EffectOp[])[0],
    );
    expect(compound[1]).toEqual(
      (deriveAttackEffect(
        "This attack does 120 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ) as EffectOp[])[0],
    );
    const all = deriveAttackEffect(ALL_THREE) as EffectOp[];
    expect(all[0]).toEqual(
      (deriveAttackEffect("Discard all Energy from this Pokémon.") as EffectOp[])[0],
    );
    expect(all[1]).toEqual(
      (deriveAttackEffect(
        "This attack does 110 damage to 3 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ) as EffectOp[])[0],
    );
  });

  it("🛑 a printed 0 in ANY of the THREE positions stays LOUD, each against its own twin", () => {
    // Three separate positivity questions, asserted separately rather than as one —
    // and each refusal is ONE CHARACTER from a sentence that resolves in the same `it`,
    // so no other byte can be blamed for it (D399).
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

  it("🛑 the printed NEAR-MISSES of the same family are all refused, and every one is real", () => {
    // Every string here is a sentence the legal column actually prints beside this
    // one, so none of them is a straw refusal. Each owes a mechanism this arm does
    // not have: an `ex` filter on the candidate CLASS, or a discard from the HAND
    // with a scaling tail.
    //
    // 🆕🆕🆕 **D477 SPLIT THIS LIST BY REASON RATHER THAN SHORTENING IT (D441).** It
    // held FIVE strings under one sentence — *"a zone (`Benched`), a rider verb
    // (`also`), an `ex` filter, a typed discard, a discard from the HAND, or a
    // scaling tail"* — and three of the five were refused for the ZONE alone, which
    // `SELF_DISCARD_THEN_BENCH_SNIPE` now reads. ⚠️ **THE STATED REASON WAS NEVER
    // TRUE OF THE `also`**: `ALSO_BENCHED_SNIPE_BODY` has spelled `(?:also )?` since
    // D447, so that clause of the comment was a co-occurring token written down as a
    // blocker (D447's own rule, one family over).
    // 🆕🆕🆕 **D483 — THE `ex` ROW LEFT THIS LIST AND IS RE-POINTED RATHER THAN DELETED
    // (D438/D444/D477's own move one rung up).** It was the FIRST of the two strings
    // above and its refusal was *"an `ex` filter on the candidate CLASS"*; that filter
    // now ships as `damageChosen.filter`, so a bare `.not.toBeNull()` here would be TRUE
    // under the build this rung exists to forbid — an ANY-target anchor loosened to
    // swallow a Benched sentence. The claim is therefore the OP's `target`, which
    // discriminates the two arms BY VALUE, exactly as D477 re-pointed the three rows it
    // built. **The refusal that remains is a genuine one and it is the HAND discard with
    // a scaling tail**, which owes a `discardPileRetrieval`-shaped count this arm has no
    // slot for.
    for (const text of [
      "Discard up to 3 Energy cards from your hand. This attack does 60 damage to 1 of your opponent's Pokémon for each Energy card you discarded in this way. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
      expect(corpus().some(([, t]) => t === text), text).toBe(true);
    }
    for (const text of [
      "Discard all Energy from this Pokémon, and this attack does 210 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]) {
      const program = deriveAttackEffect(text) as EffectOp[];
      expect(program, text).toHaveLength(2);
      expect(program[0]?.op, text).toBe("discardEnergy");
      const snipe = program[1];
      if (snipe?.op !== "damageChosen") throw new Error(`not a damageChosen: ${text}`);
      expect(snipe.target, text).toBe("opponentBench");
      expect(snipe.filter, text).toEqual({ kind: "suffixPokemon", suffix: "ex" });
      expect(corpus().some(([, t]) => t === text), text).toBe(true);
    }
    // 🆕🆕🆕 **D477 — THE THREE THAT LEFT, RE-POINTED ONTO WHAT NOW OWNS THEM RATHER
    // THAN DELETED (D418/D438).** A bare `.not.toBeNull()` here would be TRUE under
    // the build this rung existed to forbid — an any-target anchor loosened to
    // swallow a Benched sentence — so the claim is the OP's `target`, which
    // discriminates the two arms by value. `opponentAny` is what a widened arm 9b
    // would answer; `opponentBench` is what arm 9b-bis answers, and no build can
    // give both.
    for (const text of [
      "Discard 2 Energy from this Pokémon. This attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "Discard all Energy from this Pokémon, and this attack also does 90 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "Discard all {R} Energy from this Pokémon, and this attack does 180 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]) {
      const program = deriveAttackEffect(text) as EffectOp[];
      expect(program, text).toHaveLength(2);
      expect(program[0]?.op, text).toBe("discardEnergy");
      const snipe = program[1];
      if (snipe?.op !== "damageChosen") throw new Error(`not a damageChosen: ${text}`);
      expect(snipe.target, text).toBe("opponentBench");
      expect(corpus().some(([, t]) => t === text), text).toBe(true);
    }
    // ⚠️ AND THE ONE NEAR-MISS THAT IS **NOT** IN THIS COLUMN, NAMED AS SUCH RATHER
    // THAN LEFT IN THE LIST ABOVE. Pawmot ex "Levin Strike"'s TYPED cost is the
    // refusal `attackPark.test.ts` and `providesEnergy.test.ts` have both carried
    // since M5, and it is the sentence this anchor comes closest to swallowing — but
    // it is `legal_standard = 0` today, so it has no printing in the population every
    // other line here is measured against. Asserting it as "real" would have been the
    // census version of a vacuous guard; asserting the refusal is still worth it,
    // because `TYPED_SELF_DISCARD` owns the sentence and this arm must not take it.
    const typed =
      "Discard 2 {L} Energy from this Pokémon. This attack does 220 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    expect(deriveAttackEffect(typed)).toBeNull();
    expect(corpus().some(([, t]) => t === typed)).toBe(false);
    // …and it is refused by the TYPE token alone: strip the `{L}` and it resolves.
    expect(deriveAttackEffect(typed.replace("2 {L} Energy", "2 Energy"))).not.toBeNull();
  });

  it("🛑 the anchor's TERMINATOR: a compound that BEGINS with a printed compound is refused", () => {
    // Dropping the `$` would turn this into a PREFIX match and it would LOOK LIKE A
    // COVERAGE WIN. The only strings that reach a whole-sentence terminator are ones
    // the pattern matches ENTIRELY and that then keep going; every other near-miss
    // above is refused further up. Driven at BOTH stopping points, because the
    // optional clarifier is exactly where a prefix match would otherwise halt.
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

  it("🛑 the three BARE anchors are UNMOVED — this slice added a reader, it did not re-aim one", () => {
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
      { op: "damageChosen", target: "opponentAny", amount: 120, count: 2, source: "attack", deals: true },
    ]);
  });
});

describe("§6 — the board: ONE attack, TWO parks, in printed order", () => {
  it("🛑 the COST parks FIRST and no damage has been dealt yet", () => {
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
    // 🛑 THE ORDER IS THE CLAIM. Nothing has been damaged: the snipe is the SECOND op
    // and it has not run. A build that emitted the two ops the other way round would
    // deal 120 twice here and ask for the Energy afterwards.
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

  it("🛑 resolving the cost PARKS AGAIN for the targets — the second question of one sentence pair", () => {
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
    // The cost was really PAID — two Energy left the attacker for its own pile, in
    // ONE batched row (the event carries `uids`, not one row per card).
    expect(find(events, "ENERGY_DISCARDED")?.uids).toEqual(picks);
    expect(find(events, "ENERGY_DISCARDED")?.actor).toBe("p1");
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

  it("🛑 answering BOTH runs the whole sentence pair, and ENERGY_DISCARDED precedes DAMAGE_DEALT", () => {
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
    const dealt = findAll(e2, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(2);
    // fix-bigbody is a neutral 200 HP Active and the Bench never takes W/R, so both
    // hits are the printed 120 and nothing is Knocked Out.
    for (const row of dealt) expect(row).toMatchObject({ base: 120, weakness: null, dealt: 120 });
    expect(done.players.p2.active?.damage).toBe(120);
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([120, 0]);
    // 🛑 THE PRINTED ORDER, READ OFF THE EVENT STREAM ACROSS TWO ACTIONS: every
    // ENERGY_DISCARDED happened in the FIRST resume and every DAMAGE_DEALT in the
    // second, which is what "in printed order" means once both halves can park.
    expect(types(e1)).toEqual(["ENERGY_DISCARDED", "EFFECT_PENDING"]);
    expect(types(e2).indexOf("DAMAGE_DEALT")).toBeGreaterThanOrEqual(0);
    expect(types(e2)).not.toContain("ENERGY_DISCARDED");
    // …and only THEN the epilogue drained.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
    expect(done.players.p1.active?.energy).toHaveLength(1);
  });

  it("🛑 the ZERO-PARK control: the SAME anchor, the same two ops, and no prompt at all", () => {
    // Kyurem's sentence: "all" has no decision in it, and a count-3 snipe against
    // exactly three opponent bodies auto-takes all three. So the program runs straight
    // through — which is what tells "this PROGRAM parks" apart from "this program's
    // OPERANDS park", and it is the arity's floor as well (§8.6).
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
    expect(find(events, "ENERGY_DISCARDED")?.uids).toHaveLength(3);
    expect(done.players.p1.active?.energy ?? []).toHaveLength(0);
    const dealt = findAll(events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(3);
    for (const row of dealt) expect(row).toMatchObject({ base: 110, dealt: 110 });
    expect(done.players.p2.active?.damage).toBe(110);
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([110, 110]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 §8.5 STILL RUNS through the compound's second op — and the KO waits for BOTH parks", () => {
    // The compound's snipe is byte-identical to the bare anchor's, so it must behave
    // identically: a {L} attacker into a ×2 Lightning ACTIVE doubles (120 → 240 on a
    // 130 HP body), and the KO is swept by the epilogue AFTER the second answer rather
    // than at the damage step. The Bench pick stays flat, which is the same §8.5 split
    // D400's rungs prove for the standalone sentence.
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
    const dealt = findAll(events, "DAMAGE_DEALT");
    expect(dealt[0]).toMatchObject({ base: 120, weakness: { op: "multiply", amount: 2 }, dealt: 240 });
    expect(dealt[1]).toMatchObject({ base: 120, weakness: null, dealt: 120 });
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
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
