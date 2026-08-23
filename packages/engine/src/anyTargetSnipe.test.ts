import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { applyAction, deriveAttackEffect } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  ANY_SNIPE_DECK,
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

  it("⚠️ the COMPOUND count-≠-1 family is NAMED, not discovered — 2 sentences / 4 printings stay unbuilt", () => {
    // Both lead with a discard, so they are off the `^This attack does` anchor and a
    // count capture alone cannot move them. Recorded here so the next census
    // arithmetic is not surprised by a residue that did not shrink as far as the
    // "count ≠ 1" phrasing suggests it should.
    const compounds = corpus().filter(
      ([, t]) =>
        /^Discard .* This attack does \d+ damage to [2-9] of your opponent's Pokémon\./.test(t),
    );
    expect(compounds).toHaveLength(2);
    expect(units(compounds)).toBe(4);
    for (const [, t] of compounds) expect(deriveAttackEffect(t), t).toBeNull();
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
