import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effects from "./effects";
import {
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  deriveAttackOptionalCostBoost,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import type { EffectOp, GameEvent, GameState, PokemonRef, Seat } from "./index";
import {
  FILTERED_BENCH_SNIPE_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  types,
  findEvent,
  roundTrip,
} from "./testFixtures";

const PRINTED =
  "This attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const UNNARROWED =
  "This attack also does 60 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The printed clause, spelled once. */
const CLAUSE = " that has any damage counters on it";

const UNREAD_SIBLING =
  "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.";
const BUILT_COST_CLAUSE =
  "If this Pokémon has any damage counters on it, this attack can be used for {F}.";

const BUILT_FOUR_ZONE =
  "This attack does 50 damage to each Pokémon that has any damage counters on it (both yours and your opponent's), except for this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const BUILT_FORMER_SIBLING =
  "This attack does 50 damage for each of your Pokémon that has any damage counters on it.";

const PICKY = 0;
const BLUNT = 1; // {C}, 30 damage — the same rider UN-narrowed: the one-axis control
const IDLE = 2;

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const other = (seat: Seat): Seat => (seat === "p1" ? "p2" : "p1");

// ── boards ─────────────────────────────────────────────────────────────────────

/** A benched body to place: which card, and how much damage it walks in with. */
type Body = { id: string; damage: number };

function board(
  seed: number,
  attacker: Seat,
  bench: readonly Body[],
  defender = "fix-titan",
): GameState {
  const victim = other(attacker);
  let state = driveSetup(
    seed,
    { p1: FILTERED_BENCH_SNIPE_DECK, p2: FILTERED_BENCH_SNIPE_DECK },
    { first: victim },
  );
  state = setActiveFromDeck(state, attacker, "fix-filteredsnipe");
  state = attachFromDeck(state, attacker, "fix-energy", 1);
  state = setActiveFromDeck(state, victim, defender);
  state = clearBench(clearBench(state, "p1"), "p2");
  state = mustApply(state, { type: "endTurn", seat: victim }).state;
  bench.forEach((body, index) => {
    state = benchFromDeck(state, victim, body.id);
    state = setBenchDamage(state, victim, index, body.damage);
  });
  return state;
}

const benchDamage = (state: GameState, seat: Seat): number[] =>
  state.players[seat].bench.map((p) => p.damage);

// ── §1 ─────────────────────────────────────────────────────────────────────────

describe("§1 — the price and the family, re-derived off the corpus rather than quoted", () => {
  it("the reader surface is the MODULE's, and it did not grow", () => {
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the printed sentence is real, is worth THREE printings, and is now CLAIMED", () => {
    const row = corpus().filter(([, s]) => s === PRINTED);
    expect(row).toHaveLength(1);
    expect(units(row)).toBe(3);
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    // The control sentence is the printed one minus exactly the clause, asserted by
    // reconstruction rather than by eye — the whole suite's one-axis claim.
    expect(PRINTED.replace(CLAUSE, "")).toBe(UNNARROWED);
  });

  it("THE FAMILY: five sentences share the predicate, and this slice builds ONE", () => {
    const family = corpus().filter(([, s]) => /that ha[sv]e? any damage counters/i.test(s));
    expect(family).toHaveLength(5);
    expect(units(family)).toBe(7);
    const built = family.filter(([, s]) => resolvedByAnyReader(s));
    expect(built.map(([, s]) => s).sort()).toEqual(
      [
        PRINTED,
        "Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it.",
        "This attack also does 40 damage to each Benched Pokémon that has any damage counters on it (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)",
        BUILT_FORMER_SIBLING,
        BUILT_FOUR_ZONE,
      ].sort(),
    );
    expect(units(family.filter(([, s]) => !resolvedByAnyReader(s)))).toBe(0);
    expect(resolvedByAnyReader(BUILT_FOUR_ZONE)).toBe(true);
    expect(resolvedByAnyReader(BUILT_FORMER_SIBLING)).toBe(true);
    expect(deriveAttackDamageMultiplier(BUILT_FORMER_SIBLING)).toEqual({
      per: 50,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "anyPokemon" },
        damagedOnly: true,
      },
    });
    expect(family.map(([, s]) => s)).not.toContain(UNREAD_SIBLING);
    expect(corpus().filter(([, s]) => s === UNREAD_SIBLING)).toHaveLength(1);
    expect(corpus().find(([, s]) => s === UNREAD_SIBLING)?.[0]).toBe(1);
    expect(resolvedByAnyReader(UNREAD_SIBLING)).toBe(false);
    expect(splitAttackGateClause(UNREAD_SIBLING)).toBeNull();
    expect(splitAttackTrailingClause(UNREAD_SIBLING)).toBeNull();
    expect(splitAttackGateClause(BUILT_COST_CLAUSE)).toEqual({
      clause: BUILT_COST_CLAUSE,
      body: "",
    });
    expect(family.filter(([, s]) => !resolvedByAnyReader(s)).map(([, s]) => s)).toEqual([]);
  });

  it("the concept grepped the OTHER way: 13 sentences say 'any damage counters'", () => {
    const wide = corpus().filter(([, s]) => /any damage counters/i.test(s));
    expect(wide).toHaveLength(13);
    expect(units(wide)).toBe(17);
    const perBody = wide.filter(([, s]) => /that ha[sv]e? any damage counters/i.test(s));
    const gates = wide.filter(([, s]) => !/that ha[sv]e? any damage counters/i.test(s));
    expect(perBody).toHaveLength(5);
    expect(gates).toHaveLength(8);
    expect(gates.filter(([, s]) => resolvedByAnyReader(s))).toHaveLength(7);
    expect(gates.filter(([, s]) => !resolvedByAnyReader(s)).map(([, s]) => s)).toEqual([
      BUILT_COST_CLAUSE,
    ]);
    expect(
      gates.filter(([, s]) => {
        if (resolvedByAnyReader(s)) return false;
        const g = splitAttackGateClause(s);
        return !(g !== null && (g.body === "" || resolvedByAnyReader(g.body)));
      }),
    ).toEqual([]);
  });
});

// ── §2 ─────────────────────────────────────────────────────────────────────────

describe("§2 — the derivation, and the number agreement that keeps D399's rung true", () => {
  const NARROWED_OP: EffectOp = {
    op: "damageChosen",
    target: "opponentBench",
    amount: 60,
    count: 1,
    source: "attack",
    deals: true,
    damagedOnly: true,
  };

  it("the printed sentence derives the snipe PLUS `damagedOnly`, and nothing else", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual([NARROWED_OP]);
    // The optional W/R clarifier is the fragment's own group and does not change the
    // op — the same sentence without it reads identically.
    expect(
      deriveAttackEffect(
        PRINTED.replace(" (Don't apply Weakness and Resistance for Benched Pokémon.)", ""),
      ),
    ).toEqual([NARROWED_OP]);
  });

  it("the ONE-AXIS control: delete the clause and the SAME op comes back without the key", () => {
    const plain = deriveAttackEffect(UNNARROWED);
    expect(plain).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 60,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
    expect("damagedOnly" in (plain?.[0] as object)).toBe(false);
  });

  it("THE NUMBER MUST AGREE — a singular clause at count 2 is REFUSED, count 2 bare is READ", () => {
    const two =
      "This attack also does 60 damage to 2 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    expect(deriveAttackEffect(two)).toBeNull();
    expect(resolvedByAnyReader(two)).toBe(false);
    expect(deriveAttackEffect(two.replace(CLAUSE, ""))).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 60,
        count: 2,
        source: "attack",
        deals: true,
      },
    ]);
    // The plural spelling no card prints is refused too, and by a different mechanism
    // — the fragment simply does not contain it.
    expect(
      deriveAttackEffect(two.replace(CLAUSE, " that have any damage counters on them")),
    ).toBeNull();
  });

  it("EXACTLY ONE reader claims the sentence, and the other twelve are driven", () => {
    const readers = Object.entries(effects).filter(
      ([name, value]) => name.startsWith("deriveAttack") && typeof value === "function",
    ) as [string, (text: string) => unknown][];
    expect(readers).toHaveLength(14);
    const claiming = readers.filter(([, read]) => read(PRINTED) !== null).map(([name]) => name);
    expect(claiming).toEqual(["deriveAttackEffect"]);
    // The two SPLITTERS are not on that surface and are asked by name: the sentence
    // arrives whole, through the anchor, and composition never sees it.
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
  });

  it("the THIRD caller of the shared fragment REFUSES the narrowing rather than dropping it", () => {
    const cost = "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, ";
    const narrowed = `${cost}this attack also does 120 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)`;
    expect(deriveAttackOptionalCostBoost(narrowed)).toBeNull();
    expect(resolvedByAnyReader(narrowed)).toBe(false);
    const plain = deriveAttackOptionalCostBoost(narrowed.replace(CLAUSE, ""));
    expect(plain?.payoff).toEqual({ kind: "benchSnipe", amount: 120, count: 1 });
    expect(
      corpus().filter(([, s]) => /You may .*Benched Pokémon that has any damage counters/.test(s)),
    ).toEqual([]);
  });

  it("the GATED caller reads it too — one fragment, one reading, three callers", () => {
    const gated =
      "If your opponent's Active Pokémon already has any damage counters on it, this attack also does 30 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it.";
    expect(deriveAttackEffect(gated)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveDamaged" },
        then: [
          {
            op: "damageChosen",
            target: "opponentBench",
            amount: 30,
            count: 1,
            source: "attack",
            deals: true,
            damagedOnly: true,
          },
        ],
      },
    ]);
    expect(corpus().filter(([, s]) => s === gated)).toEqual([]);
  });
});

// ── §3 ─────────────────────────────────────────────────────────────────────────

describe("§3 — THE EMPTY FILTERED SET, against the board that would have parked", () => {
  const UNDAMAGED: Body[] = [
    { id: "fix-titan", damage: 0 },
    { id: "fix-titan", damage: 0 },
    { id: "fix-titan", damage: 0 },
  ];

  it("three UNDAMAGED benched bodies: the rider resolves and moves NOTHING", () => {
    const state = board(1, "p1", UNDAMAGED);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    // The main hit landed (§8 printed order, before the program).
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", base: 30, dealt: 30 });
    expect(done.players.p2.active?.damage).toBe(30);
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(findAll(events, "DAMAGE_DEALT")).toHaveLength(1);
    expect(benchDamage(done, "p2")).toEqual([0, 0, 0]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("THE ONE-AXIS CONTROL: the same board, the clause deleted, PARKS with three", () => {
    const state = board(1, "p1", UNDAMAGED);
    const { state: parked, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BLUNT,
    });
    expect(types(events)).toContain("EFFECT_PENDING");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.candidates).toHaveLength(3);
  });

  it("an EMPTY Bench and an all-undamaged Bench take the same ending", () => {
    // The narrowing does not invent a new arm — it moves boards INTO the one that was
    // already there. Driven so a build that special-cased the filter's empty set would
    // have to say why.
    const state = board(2, "p1", []);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findAll(events, "DAMAGE_DEALT")).toHaveLength(1);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });
});

// ── §4 ─────────────────────────────────────────────────────────────────────────

describe("§4 — FORCED AT ONE, where the unfiltered board would have parked", () => {
  const ONE_DAMAGED: Body[] = [
    { id: "fix-titan", damage: 0 },
    { id: "fix-titan", damage: 10 },
    { id: "fix-titan", damage: 0 },
  ];

  it("one damaged body among three: no prompt, and the 60 lands on IT alone", () => {
    // This is the case a build that filtered AFTER the arity decision gets wrong: it
    // would see three candidates, park, and ask a question the card does not pose.
    const state = board(3, "p1", ONE_DAMAGED);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // Two rows in one action: the main 30 on the Active, the rider's 60 on the Bench.
    const dealt = findAll(events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(2);
    expect(dealt[1]).toMatchObject({
      seat: "p2",
      base: 60,
      weakness: null,
      resistance: null,
      dealt: 60,
    });
    expect(benchDamage(done, "p2")).toEqual([0, 70, 0]);
    expect(done.players.p2.active?.damage).toBe(30);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("THE ONE-AXIS CONTROL: the same board, the clause deleted, PARKS", () => {
    const state = board(3, "p1", ONE_DAMAGED);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: BLUNT });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.candidates).toHaveLength(3);
  });

  it("the predicate is PRESENCE, not a counter COUNT — a 5-damage body is a candidate", () => {
    const state = board(4, "p1", [
      { id: "fix-titan", damage: 5 },
      { id: "fix-titan", damage: 0 },
    ]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(benchDamage(done, "p2")).toEqual([65, 0]);
  });
});

// ── §5 ─────────────────────────────────────────────────────────────────────────

describe("§5 — TWO OR MORE PARKS, and the offer is exactly the printed set", () => {
  const TWO_DAMAGED: Body[] = [
    { id: "fix-titan", damage: 20 },
    { id: "fix-titan", damage: 0 },
    { id: "fix-titan", damage: 30 },
  ];

  it("two damaged bodies among three: the prompt offers those TWO and names the clause", () => {
    const state = board(5, "p1", TWO_DAMAGED);
    const { state: parked, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: PICKY,
    });
    expect(types(events)).toContain("EFFECT_PENDING");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.min).toBe(1);
    expect(prompt.max).toBe(1);
    // THE OFFER IS THE PRINTED SET — indices 0 and 2, and NOT index 1.
    expect(prompt.candidates).toEqual([
      { seat: "p2", spot: { spot: "bench", index: 0 } },
      { seat: "p2", spot: { spot: "bench", index: 2 } },
    ]);
    // …and the CAPTION names the same set the validator will enforce, or the dialog
    // contradicts itself (`gustTargetNoun`'s stated rule).
    expect(prompt.note).toBe(
      "Choose 1 of your opponent's Benched Pokémon that has any damage counters on it (60 damage each).",
    );

    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    expect(types(e2)).not.toContain("COUNTERS_PLACED");
    expect(findAll(e2, "DAMAGE_DEALT")).toHaveLength(1);
    expect(benchDamage(done, "p2")).toEqual([20, 0, 90]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("THE UN-NARROWED CAPTION IS BYTE-IDENTICAL TO THE ONE THAT SHIPPED", () => {
    const state = board(5, "p1", TWO_DAMAGED);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: BLUNT });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.note).toBe("Choose 1 of your opponent's Benched Pokémon (60 damage each).");
    expect(prompt.candidates).toHaveLength(3);
  });

  it("an UNDAMAGED body is not on the offer, and the WIRE cannot reach it either", () => {
    const state = board(6, "p1", TWO_DAMAGED);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const undamaged: PokemonRef = { seat: "p2", spot: { spot: "bench", index: 1 } };
    expect(parked.phase.prompt.kind).toBe("choosePokemonMulti");
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "pokemonMulti", refs: [undamaged] } },
      "BAD_EFFECT_CHOICE",
    );
    // …and the ADMISSION on the same axis: a body that IS on the offer is accepted, so
    // the refusal above is about which body and not about the frame.
    const damaged: PokemonRef = { seat: "p2", spot: { spot: "bench", index: 0 } };
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [damaged] },
    });
    expect(benchDamage(done, "p2")).toEqual([80, 0, 30]);
  });
});

// ── §6 ─────────────────────────────────────────────────────────────────────────

describe("§6 — THE SHIELD IS ASKED AFTER THE NARROWING (D433)", () => {
  it("a SHIELDED UNDAMAGED body files NO row at all — it was never a candidate", () => {
    const state = board(7, "p1", [
      { id: "fix-teaparty", damage: 0 },
      { id: "fix-titan", damage: 10 },
    ]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    const shieldUid = done.players.p2.bench[0]?.stack[0];
    expect(shieldUid).toBeDefined();
    expect(findAll(events, "DAMAGE_DEALT").map((e) => e.uid)).not.toContain(shieldUid);
    expect(findAll(events, "DAMAGE_DEALT")).toHaveLength(2);
    expect(benchDamage(done, "p2")).toEqual([0, 70]);
  });

  it("THE ADMISSION: a SHIELDED DAMAGED body IS a candidate, and its refusal IS filed", () => {
    const state = board(8, "p1", [
      { id: "fix-teaparty", damage: 10 },
      { id: "fix-titan", damage: 0 },
    ]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    const shieldUid = done.players.p2.bench[0]?.stack[0];
    const rows = findAll(events, "DAMAGE_DEALT").filter((e) => e.uid === shieldUid);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ base: 60, dealt: 0, prevented: true });
    expect(benchDamage(done, "p2")).toEqual([10, 0]);
  });

  it("a shielded body still COUNTS toward the arity — it is refused, not removed", () => {
    const state = board(9, "p1", [
      { id: "fix-teaparty", damage: 10 },
      { id: "fix-titan", damage: 10 },
    ]);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.candidates).toHaveLength(2);
  });
});

// ── §7 ─────────────────────────────────────────────────────────────────────────

describe("§7 — Weakness is genuinely not applied, the far seat, and the loud path", () => {
  it("THE PARENTHETICAL IS THE RULE: a ×2-Weak benched body takes a flat 60", () => {
    const state = board(10, "p1", [
      { id: "fix-drainweak", damage: 10 },
      { id: "fix-drainwall", damage: 10 },
    ]);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: weak, events: weakEvents } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(findEvent(weakEvents, "DAMAGE_DEALT")).toMatchObject({
      base: 60,
      weakness: null,
      resistance: null,
      dealt: 60,
    });
    expect(benchDamage(weak, "p2")).toEqual([70, 10]);
  });

  it("THE ATTRIBUTION CONTROL: the SAME ×2 body in the ACTIVE spot takes DOUBLE", () => {
    const state = board(11, "p1", [], "fix-drainweak");
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      base: 30,
      weakness: { op: "multiply", amount: 2 },
      dealt: 60,
    });
    expect(done.players.p2.active?.damage).toBe(60);
  });

  it("THE FAR SEAT drives the identical shape — nothing here is p1-shaped", () => {
    const state = board(12, "p2", [
      { id: "fix-titan", damage: 0 },
      { id: "fix-titan", damage: 20 },
    ]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p2", index: PICKY });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    const dealt = findAll(events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(2);
    expect(dealt[1]).toMatchObject({ seat: "p1", by: "p2", base: 60, dealt: 60 });
    expect(benchDamage(done, "p1")).toEqual([0, 80]);
    expect(done.players.p1.active?.damage).toBe(30);
  });

  it("THE LOUD PATH IS STILL THERE, on the SAME body — index 2 is unread", () => {
    const state = board(13, "p1", [{ id: "fix-titan", damage: 10 }]);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: IDLE });
    expect(types(events)).toContain("ATTACK_EFFECT_SKIPPED");
    const { events: picky } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    expect(types(picky)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("the frozen board is not mutated — both endings, purity pair", () => {
    const empty = deepFreeze(board(14, "p1", [{ id: "fix-titan", damage: 0 }]));
    expect(() => mustApply(empty, { type: "attack", seat: "p1", index: PICKY })).not.toThrow();
    const forced = deepFreeze(board(15, "p1", [{ id: "fix-titan", damage: 10 }]));
    const { state: done } = mustApply(forced, { type: "attack", seat: "p1", index: PICKY });
    expect(benchDamage(forced, "p2")).toEqual([10]);
    expect(benchDamage(done, "p2")).toEqual([70]);
  });
});

// ── §8 ─────────────────────────────────────────────────────────────────────────

describe("§8 — the persisted question: `MATCH_RECORD_VERSION` STAYS 29", () => {
  function parked(): GameState {
    const state = board(16, "p1", [
      { id: "fix-titan", damage: 10 },
      { id: "fix-titan", damage: 20 },
    ]);
    const { state: p } = mustApply(state, { type: "attack", seat: "p1", index: PICKY });
    if (p.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    return roundTrip(p);
  }

  it("DIRECTION 1 — the op DOES ride `phase.cont.pendingOp`, so the question is real", () => {
    // `damageChosen` parks, and a parking op is persisted. The field is asserted to be
    // ON the wire rather than assumed absent, because "it isn't stored" is the claim a
    // careless no-bump argument rests on.
    const record = parked();
    if (record.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(record.phase.cont.pendingOp).toMatchObject({ op: "damageChosen", damagedOnly: true });
    // …and a v29 record round-trips and still resolves onto the chosen body.
    const prompt = record.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: done } = mustApply(record, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(benchDamage(done, "p2")).toEqual([70, 20]);
  });

  it("DIRECTION 2 — DELETING the key from a parked record changes NOTHING", () => {
    const record = parked();
    if (record.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const op = record.phase.cont.pendingOp as Record<string, unknown>;
    // biome-ignore lint/performance/noDelete: the key must be genuinely ABSENT — that is what a deploy which never knew it writes, and `= undefined` leaves it PRESENT.
    delete op.damagedOnly;
    expect("damagedOnly" in op).toBe(false);
    const prompt = record.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: done } = mustApply(record, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    // Byte-identical to DIRECTION 1's outcome.
    expect(benchDamage(done, "p2")).toEqual([70, 20]);
    expect(prompt.candidates).toHaveLength(2);
  });
});
