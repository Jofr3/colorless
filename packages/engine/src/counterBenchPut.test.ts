import { describe, expect, it } from "vitest";
import { deriveAttackEffect, programFor } from "./index";
// `applyAction` is imported as a TYPE only: the illegal-choice case builds a
// deliberately malformed action and casts it through `Parameters<typeof applyAction>[1]`
// so the cast is anchored on the real signature rather than on `any`.
import type {
  EffectOp,
  GameAction,
  GameEvent,
  GameState,
  PokemonRef,
  Seat,
  applyAction,
} from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  COUNTER_BENCH_PUT_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deepFreeze,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  types,
} from "./testFixtures";

const CLAUSE = "Put 2 damage counters on 1 of your opponent's Benched Pokémon.";

const PRINTINGS = ["sv02-127", "sv02-243", "sv02-263", "sv02-275"] as const;

const LAND_SCOOP_INDEX = 0;
const LAND_SCOOP_COUNTERS = 2;
const LAND_SCOOP_HP = 20;
/** The printed `damage` field, which rides the attack itself and not the program. */
const LAND_SCOOP_DAMAGE = 150;

function clauseText(counters: number): string {
  return `Put ${counters} damage counters on 1 of your opponent's Benched Pokémon.`;
}

function putOp(hp: number): EffectOp {
  return { op: "damageChosen", target: "opponentBench", amount: hp, count: 1, source: "attack" };
}

const WINDOWED_FOLD =
  "Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it.";
const NEAR_MISSES = [
  "Put 3 damage counters on each of your opponent's Benched Pokémon that has any damage counters on it.",
  "Put up to 12 damage counters on this Pokémon. This attack does 20 damage for each damage counter you placed in this way.",
  "Put 1 damage counter on each of your opponent's Pokémon for each of your Maushold in play.",
  "You must discard a Basic {G} Energy card from your hand in order to use this Ability. Once during your turn, you may put 3 damage counters on 1 of your opponent's Benched Pokémon.",
  "You must discard a Water Energy card from your hand in order to use this Ability. Once during your turn, you may put 2 damage counters on 1 of your opponent's Benched Pokémon.",
] as const;

const BENCH_HP_TARGET =
  "Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is 100.";
const ACTIVE_HP_TARGET =
  "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10.";

const DEFENDER_PUT_CLAUSE = "Put 7 damage counters on your opponent's Active Pokémon.";

const TARGET_COUNTER_SNIPE =
  "This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const SCALED_PILE_TWIN =
  "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.";

/** U+2019, spelled as an ESCAPE rather than typed. */
const RSQUO = "\u2019";
/** U+00A0 — byte-different from an ASCII space and INVISIBLE in a diff, which is
    exactly why it is written as an ESCAPE. A typed one silently degrades to a
    plain space in an editor and the case then asserts nothing. */
const NBSP = "\u00A0";

/** fix-titan is 340 HP, so it absorbs the printed 150 without the epilogue
    sweeping the Defender out from under a bench assertion. */
const TITAN_HP = 340;
/** Not a multiple of 20 or 150, so no sum below is reachable two ways. */
const BENCH_HURT = 30;

const P1_ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const P2_ACTIVE: PokemonRef = { seat: "p2", spot: { spot: "active" } };
const P2_BENCH_0: PokemonRef = { seat: "p2", spot: { spot: "bench", index: 0 } };
const P2_BENCH_1: PokemonRef = { seat: "p2", spot: { spot: "bench", index: 1 } };

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function board(): GameState {
  let state = driveSetup(
    11,
    { p1: COUNTER_BENCH_PUT_DECK, p2: COUNTER_BENCH_PUT_DECK },
    { first: "p2" },
  );
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return clearBench(clearBench(state, "p1"), "p2");
}

/** Field Ting-Lu ex as `seat`'s Active with three {F} attached — Land Scoop's
    printed cost. A Basic, so the surgery is a convenience; the bench clear after
    it is not. */
function tingLuActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, "sv02-127"), seat),
    seat,
    "fix-fighting-energy",
    3,
  );
}

/** Populate `seat`'s Bench from the deck, in order. */
function bench(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  return ids.reduce((next, id) => benchFromDeck(next, seat, id), state);
}

/** Declare Land Scoop on `seat`, freezing the prior state first — the purity check
    every neighbouring suite runs, hoisted because this file drives a dozen. */
function declare(state: GameState, seat: Seat = "p1"): { state: GameState; events: GameEvent[] } {
  deepFreeze(state);
  return mustApply(state, { type: "attack", seat, index: LAND_SCOOP_INDEX });
}

/** The parked `choosePokemonMulti` prompt, narrowed — a state that did NOT park
    fails here rather than three assertions later. */
function multiPrompt(state: GameState): {
  candidates: PokemonRef[];
  min: number;
  max: number;
  declinable: boolean;
  note: string;
} {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "choosePokemonMulti") {
    throw new Error(`expected choosePokemonMulti, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

/** The answer to the park: a SET of one, since `damageChosen` uses the multi
    prompt even at `count: 1` (the shape is a set, dispatched in one go). */
function pick(ref: PokemonRef, seat: Seat = "p1"): GameAction {
  return { type: "resolveEffect", seat, choice: { kind: "pokemonMulti", refs: [ref] } };
}

describe("the anchor — 4 printings, 1 clause, one regex with one (\\d+) capture", () => {
  it("derives the printed clause, and the amount is HP rather than counters", () => {
    expect(deriveAttackEffect(CLAUSE)).toEqual([putOp(LAND_SCOOP_HP)]);
    const ops = deriveAttackEffect(CLAUSE);
    expect(ops).toHaveLength(1);
    expect(Object.keys(ops?.[0] as object).sort()).toEqual([
      "amount",
      "count",
      "op",
      "source",
      "target",
    ]);
    expect(ops?.[0]).not.toHaveProperty("deals");
    expect(ops?.[0]).not.toHaveProperty("ignoreWR");
    expect(ops?.[0]).not.toHaveProperty("perTakenPrize");
    expect(ops?.[0]).not.toHaveProperty("optional");
  });

  it("CONVERTS counters → HP, and fails at a factor of ten in EITHER direction", () => {
    const derived = deriveAttackEffect(CLAUSE);
    expect(derived).toEqual([putOp(LAND_SCOOP_COUNTERS * 10)]);
    expect(derived).not.toEqual([putOp(LAND_SCOOP_COUNTERS)]);
    expect(derived).not.toEqual([putOp(LAND_SCOOP_COUNTERS * 100)]);
    expect(LAND_SCOOP_HP).toBe(LAND_SCOOP_COUNTERS * 10);
    expect(deriveAttackEffect(clauseText(1))).toEqual([putOp(10)]);
    expect(deriveAttackEffect(clauseText(13))).toEqual([putOp(130)]);
    expect(deriveAttackEffect(clauseText(1))).not.toEqual(deriveAttackEffect(clauseText(13)));
  });

  it("is the SAME op Meowscarada ex's registry row authors — D132's inventory rule", () => {
    const authored = programFor("sv02-015")?.abilities?.[0];
    expect(authored?.name).toBe("Bouquet Magic");
    expect(authored?.program?.[1]).toEqual({
      op: "damageChosen",
      target: "opponentBench",
      amount: 30,
      count: 1,
      source: "ability",
    });
    const authoredOp = authored?.program?.[1] as Record<string, unknown>;
    expect(deriveAttackEffect(CLAUSE)).toEqual([
      { ...authoredOp, amount: LAND_SCOOP_HP, source: "attack" },
    ]);
    expect(Object.keys(authoredOp).sort()).toEqual(
      Object.keys(deriveAttackEffect(CLAUSE)?.[0] as object).sort(),
    );
    expect(authoredOp.source).toBe("ability");
    expect((deriveAttackEffect(CLAUSE)?.[0] as Record<string, unknown>).source).toBe("attack");
  });

  it("refuses the FIVE real catalog rows that share its words — and the TWO MAPPED ones keep their OWN programs", () => {
    for (const text of NEAR_MISSES) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    expect(deriveAttackEffect(TARGET_COUNTER_SNIPE)).not.toEqual(deriveAttackEffect(CLAUSE));
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
    expect(deriveAttackEffect(TARGET_COUNTER_SNIPE)).not.toContainEqual(
      expect.objectContaining({ source: "ability" }),
    );
    expect(deriveAttackEffect(CLAUSE)?.[0]).not.toHaveProperty("perDamageCounterOnTarget");
    expect(deriveAttackEffect(SCALED_PILE_TWIN)).not.toEqual(deriveAttackEffect(CLAUSE));
    expect(deriveAttackEffect(SCALED_PILE_TWIN)?.map((o) => o.op)).toEqual([
      "damageChosen",
      "discardPileRetrieval",
      "shuffleDeck",
    ]);
    expect((deriveAttackEffect(CLAUSE)?.[0] as Record<string, unknown>).target).toBe(
      "opponentBench",
    );
    expect((deriveAttackEffect(SCALED_PILE_TWIN)?.[0] as Record<string, unknown>).target).toBe(
      "opponentAny",
    );
    expect(deriveAttackEffect(CLAUSE)?.[0]).not.toHaveProperty("perDiscardPileCard");
    expect(NEAR_MISSES).toHaveLength(5);
    for (const ability of NEAR_MISSES.filter((t) => t.startsWith("You must discard"))) {
      expect(deriveAttackEffect(ability), ability).toBeNull();
    }
    expect(NEAR_MISSES.filter((t) => t.startsWith("You must discard"))).toHaveLength(2);
    // Vespiquen ex's is the nearest by ZONE — same Bench, same verb, a per-target
    // filter and "each of" instead of "1 of".
    expect(deriveAttackEffect(NEAR_MISSES[0])).toBeNull();

    expect(deriveAttackEffect(WINDOWED_FOLD)).not.toEqual(deriveAttackEffect(CLAUSE));
    expect(deriveAttackEffect(WINDOWED_FOLD)?.[0]?.op).toBe("counterEachAll");
    expect(deriveAttackEffect(CLAUSE)?.[0]?.op).toBe("damageChosen");

    expect(deriveAttackEffect(BENCH_HP_TARGET)).not.toEqual(deriveAttackEffect(CLAUSE));
    expect(deriveAttackEffect(BENCH_HP_TARGET)?.[0]?.op).toBe("counterUntilRemainingHp");
    expect(deriveAttackEffect(ACTIVE_HP_TARGET)?.[0]?.op).toBe("counterUntilRemainingHp");
    // …and the two HP targets are told apart by their TARGET and by nothing else,
    // which is what makes this anchor's zone word load-bearing one file over.
    expect(deriveAttackEffect(BENCH_HP_TARGET)).not.toEqual(deriveAttackEffect(ACTIVE_HP_TARGET));
  });

  it("stays disjoint from the SIBLING anchor in BOTH directions", () => {
    expect(deriveAttackEffect(DEFENDER_PUT_CLAUSE)).toEqual([
      { op: "damageActive", amount: 70, source: "attack" },
    ]);
    expect(deriveAttackEffect(DEFENDER_PUT_CLAUSE)).not.toContainEqual(
      expect.objectContaining({ op: "damageChosen" }),
    );
    expect(deriveAttackEffect(CLAUSE)).toEqual([putOp(LAND_SCOOP_HP)]);
    expect(deriveAttackEffect(CLAUSE)).not.toContainEqual(
      expect.objectContaining({ op: "damageActive" }),
    );
    // …and the two really do share their opening, which is what makes the
    // disjointness a claim about the TARGET rather than a coincidence.
    expect(DEFENDER_PUT_CLAUSE.startsWith("Put ")).toBe(true);
    expect(CLAUSE.startsWith("Put ")).toBe(true);
    expect(DEFENDER_PUT_CLAUSE.endsWith(" Pokémon.")).toBe(true);
    expect(CLAUSE.endsWith(" Pokémon.")).toBe(true);
  });

  it("refuses the anchor, punctuation, case and token rewrites — but trims outer space", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Put 2 damage counters on 1 of your opponent's Benched Pokémon",
      // "!" for "." — the same one-character difference from the other side.
      "Put 2 damage counters on 1 of your opponent's Benched Pokémon!",
      "put 2 damage counters on 1 of your opponent's Benched Pokémon.",
      "Put 2 damage counter on 1 of your opponent's Benched Pokémon.",
      // NO COUNT AT ALL — the shape whose amount is read off the target.
      "Put damage counters on 1 of your opponent's Benched Pokémon.",
      // "up to", a BOUNDED count. The op's `count` is EXACT by its own doc block, so
      // a reader that swallowed the words would place the maximum for a card that
      // prints a choice.
      "Put up to 2 damage counters on 1 of your opponent's Benched Pokémon.",
      // A NON-INTEGER and a SIGNED count — `\d+` takes neither, and a placement of
      // -20 would HEAL the target.
      "Put 2.5 damage counters on 1 of your opponent's Benched Pokémon.",
      "Put -2 damage counters on 1 of your opponent's Benched Pokémon.",
      "Put 2 damage counters on 1 of your Benched Pokémon.",
      "Put 2 damage counters on each of your opponent's Benched Pokémon.",
      "Put 2 damage counters on your opponent's Benched Pokémon.",
      // THE COUNT OF TARGETS. "2 of" is a different pick and the op's `count` field
      // would have to carry it; the anchor spells the literal "1 of".
      "Put 2 damage counters on 2 of your opponent's Benched Pokémon.",
      // A NON-BREAKING SPACE where an ASCII one is printed. Spelled as an ESCAPE.
      `Put${NBSP}2 damage counters on 1 of your opponent's Benched Pokémon.`,
      // An INTERIOR double space is not trimmable.
      "Put  2 damage counters on 1 of your opponent's Benched Pokémon.",
      "Flip a coin. If heads, put 2 damage counters on 1 of your opponent's Benched Pokémon.",
      "Put 2 damage counters on 1 of your opponent's Benched Pokémon. During your next turn, this Pokémon can't attack.",
      // Empty.
      "",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), so this states which
    // drift is tolerated and which is not.
    expect(deriveAttackEffect(`\t  ${CLAUSE}\n`)).toEqual([putOp(LAND_SCOOP_HP)]);
  });

  it("D449 — dropping the word Benched gives the ANY-ZONE op, not this one and not null", () => {
    const anyZone = CLAUSE.replace(" Benched", "");
    expect(anyZone).not.toBe(CLAUSE);
    expect(deriveAttackEffect(anyZone)).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: LAND_SCOOP_HP,
        count: 1,
        source: "attack",
      },
    ]);
    expect(deriveAttackEffect(CLAUSE)).toEqual([putOp(LAND_SCOOP_HP)]);
    expect(deriveAttackEffect(anyZone)).not.toEqual(deriveAttackEffect(CLAUSE));
  });

  it("refuses a printed ZERO but ACCEPTS the ungrammatical singular count", () => {
    // A printed "Put 0 damage counters" is not a real card and here it is WORSE than
    // a silent no-op: it would PARK the attacker on a choice with no possible
    // outcome. It stays on the loud ATTACK_EFFECT_SKIPPED path.
    expect(deriveAttackEffect(clauseText(0))).toBeNull();
    expect(deriveAttackEffect(clauseText(1))).toEqual([putOp(10)]);
    expect(deriveAttackEffect(clauseText(999))).toEqual([putOp(9990)]);
  });

  it("derives the CURLY apostrophe identically — and there is exactly ONE slot", () => {
    const curly = CLAUSE.replaceAll("'", RSQUO);
    expect(curly).not.toBe(CLAUSE);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(CLAUSE));
    expect(deriveAttackEffect(curly)).toEqual([putOp(LAND_SCOOP_HP)]);
    expect(CLAUSE.split("'")).toHaveLength(2);
    expect(curly.split(RSQUO)).toHaveLength(2);
    expect(CLAUSE).toContain("your opponent's");
  });
});

describe("the guard, ASSERTED rather than relied on — no derived op says 'ability'", () => {
  it("sweeps EVERY op the deriver produces from the whole fixture pool", () => {
    const sourced: { id: string; op: string; source: string }[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        for (const op of deriveAttackEffect(attack.effect ?? "") ?? []) {
          const source = (op as { source?: unknown }).source;
          if (typeof source === "string") sourced.push({ id, op: op.op, source });
        }
      }
    }
    // The sweep found something — otherwise the loop below asserts nothing, which
    // is the failure mode a "no bad rows" test has by construction.
    expect(sourced.length).toBeGreaterThan(0);
    const PROVENANCE_SOURCE = new Set([
      "damageActive",
      "damageChosen",
      "counterEachAll",
      "counterUntilRemainingHp",
    ]);
    const ZONE_SOURCE = new Set(["attachEnergyFrom"]);
    for (const row of sourced) {
      expect(
        PROVENANCE_SOURCE.has(row.op) || ZONE_SOURCE.has(row.op),
        `${row.id} derived ${row.op} with an UNCLASSIFIED \`source\` — is it a provenance or a zone?`,
      ).toBe(true);
    }
    for (const row of sourced.filter((r) => PROVENANCE_SOURCE.has(r.op))) {
      expect(row.source, `${row.id} derived ${row.op} as ${row.source}`).toBe("attack");
    }
    for (const row of sourced.filter((r) => ZONE_SOURCE.has(r.op))) {
      expect(["hand", "discard"], `${row.id} derived ${row.op} as ${row.source}`).toContain(
        row.source,
      );
    }
    // Every op that carries the field is actually represented, so the sweep is not
    // silently covering one of them only.
    expect(new Set(sourced.map((r) => r.op))).toEqual(
      new Set([...PROVENANCE_SOURCE, ...ZONE_SOURCE]),
    );
  });

  it("and every AUTHORED counter placement still says 'ability' — both values reach it", () => {
    const rows = [
      { id: "sv01-118", name: "Flying Entry", index: 0 },
      { id: "sv02-015", name: "Bouquet Magic", index: 1 },
      { id: "swsh10.5-018", name: "Pump Shot", index: 1 },
    ] as const;
    for (const { id, index } of rows) {
      const program =
        programFor(id)?.abilities?.[0]?.program ?? programFor(id)?.triggered?.[0]?.program;
      const op = program?.[index] as Record<string, unknown> | undefined;
      expect(op?.op, id).toBe("damageChosen");
      expect(op?.source, id).toBe("ability");
      // …and none of them sets `deals`, which is what puts them on the counter path
      // in the first place — the guard's other half, stated rather than assumed.
      expect(op).not.toHaveProperty("deals");
    }
  });

  it("answers the OTHER half of the question — spreadDamage and damageSelf are NOT exposed", () => {
    const spread = deriveAttackEffect(
      "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    );
    expect(spread).toEqual([{ op: "spreadDamage", target: "opponentBench", amount: 10 }]);
    expect(spread?.[0]).not.toHaveProperty("source");
    const recoil = deriveAttackEffect("This Pokémon also does 30 damage to itself.");
    expect(recoil).toEqual([{ op: "damageSelf", amount: 30 }]);
    expect(recoil?.[0]).not.toHaveProperty("source");
  });
});

describe("the fixture's printed text — every claim on the resume point, checked", () => {
  it("pins Ting-Lu ex sv02-127 — LAND SCOOP, {F}{F}{F}, 2 counters, printed 150", () => {
    const landScoop = FIXTURE_POOL["sv02-127"]?.attacks?.[LAND_SCOOP_INDEX];
    expect(landScoop).toEqual({
      cost: ["Fighting", "Fighting", "Fighting"],
      name: "Land Scoop",
      effect: CLAUSE,
      damage: LAND_SCOOP_DAMAGE,
    });
    expect(deriveAttackEffect(landScoop?.effect ?? "")).toEqual([putOp(LAND_SCOOP_HP)]);
    expect(landScoop?.damage).toBe(LAND_SCOOP_DAMAGE);
    expect(FIXTURE_POOL["sv02-127"]?.name).toBe("Ting-Lu ex");
    expect(FIXTURE_POOL["sv02-127"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv02-127"]?.hp).toBe(240);
    expect(FIXTURE_POOL["sv02-127"]?.types).toEqual(["Fighting"]);
    expect(FIXTURE_POOL["sv02-127"]?.attacks).toHaveLength(1);
    expect(LAND_SCOOP_INDEX).toBe(0);
  });

  it("costs ZERO registry ATTACK rows, on all FOUR printings", () => {
    for (const id of PRINTINGS) {
      expect(programFor(id)?.attack, id).toBeUndefined();
    }
    for (const id of PRINTINGS) {
      expect(programFor(id)?.passive, id).toEqual({
        disableAbilities: {
          side: "opponent",
          requiresDamage: true,
          requiresActive: true,
          exemptSuffix: "ex",
        },
      });
    }
    expect(new Set(PRINTINGS.map((id) => programFor(id)))).toHaveProperty("size", 1);
  });
});

describe("end to end — D125's tail: the 150, then the pick, then the placement", () => {
  it("hits the Defender for 150 FIRST, then PARKS on which Benched body", () => {
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    const defender = activeUid(state, "p2");
    const { state: parked, events } = declare(state);

    expect(types(events)).toEqual(["ATTACK_DECLARED", "DAMAGE_DEALT", "EFFECT_PENDING"]);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p2",
      uid: defender,
      base: LAND_SCOOP_DAMAGE,
      dealt: LAND_SCOOP_DAMAGE,
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(parked.players.p2.active?.damage).toBe(LAND_SCOOP_DAMAGE);

    // THE PROMPT: exactly one, mandatory, over the OPPONENT's Bench only. The
    // printed "1 of" is a floor as well as a ceiling — no "up to" anywhere on this
    // card — so min and max are both 1 and the pick is not declinable.
    const prompt = multiPrompt(parked);
    expect(prompt.min).toBe(1);
    expect(prompt.max).toBe(1);
    expect(prompt.declinable).toBe(false);
    expect(prompt.candidates).toEqual([P2_BENCH_0, P2_BENCH_1]);
    expect(prompt.candidates).not.toContainEqual(P2_ACTIVE);
    expect(prompt.candidates).not.toContainEqual(P1_ACTIVE);
    // The heading quotes the printed unit back — COUNTERS, not the HP the op
    // carries — so a player never reads the internal number.
    expect(prompt.note).toBe(
      "Choose 1 of your opponent's Benched Pokémon (2 damage counters each).",
    );

    // …and the pick lands 20 on the chosen body and nothing on the other.
    const chosen = benchTopUid(parked, "p2", 0);
    const { state: done, events: resolved } = mustApply(parked, pick(P2_BENCH_0));
    expect(all(resolved, "COUNTERS_PLACED")).toEqual([
      { type: "COUNTERS_PLACED", seat: "p2", uid: chosen, amount: LAND_SCOOP_HP, source: "attack" },
    ]);
    expect(done.players.p2.bench[0]?.damage).toBe(LAND_SCOOP_HP);
    expect(done.players.p2.bench[1]?.damage).toBe(0);
    expect(types(resolved)).not.toContain("DAMAGE_DEALT");
    expect(types(resolved)).toEqual([
      "COUNTERS_PLACED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
    // The ATTACKER is untouched — this sentence has no cost and no recoil.
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("adds onto EXISTING damage rather than setting it", () => {
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    state = setBenchDamage(state, "p2", 1, BENCH_HURT);
    const { state: parked } = declare(state);
    const { state: done } = mustApply(parked, pick(P2_BENCH_1));
    expect(done.players.p2.bench[1]?.damage).toBe(BENCH_HURT + LAND_SCOOP_HP);
    expect(done.players.p2.bench[1]?.damage).not.toBe(LAND_SCOOP_HP);
  });

  it("FORCES a single benched body — one action, no prompt at all", () => {
    // §8.6 "do as much as you can", and the M1 no-choice doctrine: a mandatory pick
    // over exactly `count` candidates has no decision left in it, so it auto-takes.
    // The whole declaration is then ONE event batch.
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["fix-titan"]);
    const only = benchTopUid(state, "p2", 0);
    const { state: done, events } = declare(state);

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "COUNTERS_PLACED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(find(events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p2",
      uid: only,
      amount: LAND_SCOOP_HP,
      source: "attack",
    });
    expect(done.players.p2.bench[0]?.damage).toBe(LAND_SCOOP_HP);
  });

  it("an EMPTY opponent Bench is a silent WHIFF, and NOT an ATTACK_EFFECT_SKIPPED", () => {
    const state = tingLuActive(board(), "p1");
    expect(state.players.p2.bench).toHaveLength(0);
    const { state: done, events } = declare(state);

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(LAND_SCOOP_DAMAGE);
    expect(done.players.p2.active?.damage).toBe(LAND_SCOOP_DAMAGE);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("runs from the OTHER SEAT too — the row's `seat` is derived, not hardcoded", () => {
    // Every case above attacks from p1, so a build that wrote "p2" into the
    // placement passes all of them.
    let state = board();
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = tingLuActive(state, "p2");
    state = bench(state, "p1", ["fix-titan", "fix-titan"]);
    const { state: parked, events } = declare(state, "p2");

    expect(multiPrompt(parked).candidates).toEqual([
      { seat: "p1", spot: { spot: "bench", index: 0 } },
      { seat: "p1", spot: { spot: "bench", index: 1 } },
    ]);
    expect(find(events, "DAMAGE_DEALT")?.seat).toBe("p1");
    const chosen = benchTopUid(parked, "p1", 1);
    const { state: done, events: resolved } = mustApply(
      parked,
      pick({ seat: "p1", spot: { spot: "bench", index: 1 } }, "p2"),
    );
    expect(find(resolved, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p1",
      uid: chosen,
      amount: LAND_SCOOP_HP,
      source: "attack",
    });
    // …and the attacker's OWN side took nothing.
    expect(done.players.p2.active?.damage).toBe(0);
    expect(done.players.p2.bench.every((p) => p.damage === 0)).toBe(true);
  });

  it("consumes NO rng across the whole park-and-resolve round trip", () => {
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    const { state: parked } = declare(state);
    expect(parked.rngState).toBe(state.rngState);
    const { state: done } = mustApply(parked, pick(P2_BENCH_0));
    expect(done.rngState).toBe(state.rngState);
  });

  it("REJECTS every illegal pick — own board, the Active, an index past the end", () => {
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p1", ["fix-titan"]);
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    const { state: parked } = declare(state);
    const resolve = (choice: unknown) =>
      ({ type: "resolveEffect", seat: "p1", choice }) as Parameters<typeof applyAction>[1];

    // THE ATTACKER'S OWN BENCH — a real Pokémon on the wrong side, and the exact
    // miss the "opponent's" rewrite in the anchor case is about.
    expectErr(
      parked,
      resolve({ kind: "pokemonMulti", refs: [{ seat: "p1", spot: { spot: "bench", index: 0 } }] }),
      "BAD_EFFECT_CHOICE",
    );
    expectErr(parked, resolve({ kind: "pokemonMulti", refs: [P2_ACTIVE] }), "BAD_EFFECT_CHOICE");
    expectErr(parked, resolve({ kind: "pokemonMulti", refs: [P1_ACTIVE] }), "BAD_EFFECT_CHOICE");
    // AN INDEX PAST THE END — p2 has exactly two benched bodies.
    expectErr(
      parked,
      resolve({ kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "bench", index: 2 } }] }),
      "BAD_EFFECT_CHOICE",
    );
    // TWO REFS for a pick of one — `min === max === 1`, so a superset is not an
    // answer either.
    expectErr(
      parked,
      resolve({ kind: "pokemonMulti", refs: [P2_BENCH_0, P2_BENCH_1] }),
      "BAD_EFFECT_CHOICE",
    );
    // NONE — the pick is mandatory (no printed "up to", no printed "you may"), so
    // the empty set is not the legal decline it is for Hawlucha.
    expectErr(parked, resolve({ kind: "pokemonMulti", refs: [] }), "BAD_EFFECT_CHOICE");
    // And the single-pick shape does not answer a multi prompt.
    expectErr(parked, resolve({ kind: "pokemon", ref: P2_BENCH_0 }), "BAD_EFFECT_CHOICE");
    // The park survived every refusal — a rejected action changes nothing.
    expect(parked.phase.kind).toBe("effect:choose");
  });
});

describe("the placement is FLAT — three benched modifiers it must skip", () => {
  it("skips WEAKNESS — a ×2 FIGHTING body takes 20, not 40", () => {
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["fix-fighting-weak"]);
    expect(FIXTURE_POOL["fix-fighting-weak"]?.weaknesses).toEqual([
      { type: "Fighting", value: "×2" },
    ]);
    expect(FIXTURE_POOL["sv02-127"]?.types).toEqual(["Fighting"]);

    const { state: done, events } = declare(state);
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(LAND_SCOOP_HP);
    expect(done.players.p2.bench[0]?.damage).toBe(LAND_SCOOP_HP);
    expect(done.players.p2.bench[0]?.damage).not.toBe(LAND_SCOOP_HP * 2);
    // The 200 HP body survives every reading a wrong build could produce, so this
    // case measures the AMOUNT and never a promotion.
    expect(FIXTURE_POOL["fix-fighting-weak"]?.hp).toBe(200);
  });

  it("skips the REDUCTION passive — Bouffalant takes 20, not 0", () => {
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["sv03-174"]);
    expect(programFor("sv03-174")?.passive).toEqual({ damageReductionAfterWR: 20 });
    const target = benchTopUid(state, "p2", 0);

    const { state: done, events } = declare(state);
    expect(all(events, "COUNTERS_PLACED")).toEqual([
      { type: "COUNTERS_PLACED", seat: "p2", uid: target, amount: LAND_SCOOP_HP, source: "attack" },
    ]);
    expect(done.players.p2.bench[0]?.damage).toBe(LAND_SCOOP_HP);
    expect(done.players.p2.bench[0]?.damage).not.toBe(0);
    expect(all(events, "DAMAGE_DEALT").map((d) => d.uid)).not.toContain(target);
  });

  it("skips the ex/V PREVENTION — Safeguard does NOT stop it, and the attacker IS an ex", () => {
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["sv02-097"]);
    expect(programFor("sv02-097")?.passive).toEqual({ preventDamageFromExV: true });
    expect(FIXTURE_POOL["sv02-127"]?.name).toContain(" ex");
    const guarded = benchTopUid(state, "p2", 0);

    const { state: done, events } = declare(state);
    expect(find(events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p2",
      uid: guarded,
      amount: LAND_SCOOP_HP,
      source: "attack",
    });
    expect(done.players.p2.bench[0]?.damage).toBe(LAND_SCOOP_HP);
    expect(all(events, "DAMAGE_DEALT").every((d) => d.prevented === undefined)).toBe(true);
    expect(all(events, "DAMAGE_DEALT").map((d) => d.uid)).not.toContain(guarded);
  });
});

describe("the KNOCK OUTs it can cause — the epilogue sweep, behind the park", () => {
  it("KOs the benched pick AFTER the choice lands — prize to the ATTACKER", () => {
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    state = setBenchDamage(state, "p2", 0, TITAN_HP - LAND_SCOOP_HP);
    const doomed = benchTopUid(state, "p2", 0);

    const { state: parked, events } = declare(state);
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(parked.pending.length).toBeGreaterThan(0);

    const { state: after, events: resolved } = mustApply(parked, pick(P2_BENCH_0));
    expect(types(resolved)).toEqual(["COUNTERS_PLACED", "KNOCKED_OUT", "PRIZES_OWED"]);
    expect(find(resolved, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: doomed });
    // THE PRIZE IS OWED TO THE ATTACKER — the seat that declared, not the seat that
    // owns the Knocked Out body. fix-titan carries no rule box, so it is exactly
    // one, and WHICH prize card is a decision, so the resolution stops here.
    expect(find(resolved, "PRIZES_OWED")).toEqual({ type: "PRIZES_OWED", seat: "p1", count: 1 });
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    expect(types(resolved)).not.toContain("TURN_ENDED");
    // …and taking the prize drains the rest of the tail.
    const { state: done } = mustApply(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(done.players.p1.prizes).toHaveLength(5);
    expect(done.players.p2.bench).toHaveLength(1);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("stops ONE point short and does not KO — the boundary, not just the crossing", () => {
    // The complement: a build that swept on "damage >= hp - 10" (a counters-vs-HP
    // confusion in the KO check rather than in the reader) Knocks this body out too.
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["fix-titan"]);
    state = setBenchDamage(state, "p2", 0, TITAN_HP - LAND_SCOOP_HP - 10);
    const { state: done, events } = declare(state);

    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(done.players.p2.bench[0]?.damage).toBe(TITAN_HP - 10);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("sweeps BOTH boards' Knock Outs at once — the 150's and the placement's", () => {
    let state = tingLuActive(board(), "p1");
    state = setDamage(state, "p2", TITAN_HP - LAND_SCOOP_DAMAGE);
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    state = setBenchDamage(state, "p2", 1, TITAN_HP - LAND_SCOOP_HP);
    const defender = activeUid(state, "p2");
    const doomed = benchTopUid(state, "p2", 1);

    const { state: parked, events } = declare(state);
    // The Defender is already lethally hit, and the KO still waits for the pick.
    expect(find(events, "DAMAGE_DEALT")?.damage).toBe(TITAN_HP);
    expect(types(events)).not.toContain("KNOCKED_OUT");

    const { state: after, events: resolved } = mustApply(parked, pick(P2_BENCH_1));
    // BOTH Knock Outs land in ONE sweep, in ONE batch — the sharpest statement
    // that the placement joins the attack's tail rather than running as its own
    // event.
    expect(all(resolved, "KNOCKED_OUT").map((k) => k.uid)).toEqual([defender, doomed]);
    expect(after.players.p2.active).toBeNull();
    expect(after.players.p2.bench).toHaveLength(1);
    expect(all(resolved, "PRIZES_OWED")).toEqual([{ type: "PRIZES_OWED", seat: "p1", count: 1 }]);
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const { state: mid } = mustApply(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(mid.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const { state: done } = mustApply(mid, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(done.players.p1.prizes).toHaveLength(4);
  });
});

describe("the log — an ATTACK's bench placement must not be labelled an Ability", () => {
  it("renders a SYSTEM row in the printed verb, and never the word Ability", () => {
    let state = tingLuActive(board(), "p1");
    state = bench(state, "p2", ["fix-titan"]);
    const { state: done, events } = declare(state);
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state: done, elapsed: "+00:14" };
    const rendered = logFromEvents(events, ctx).flatMap((entry) =>
      entry.kind === "turn"
        ? []
        : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
    );

    const placed = rendered.find((r) => r.text.startsWith("Put:"));
    expect(placed).toBeDefined();
    expect(placed?.who).toBe("system");
    expect(placed?.text).toContain(String(LAND_SCOOP_HP));
    // THE LABEL THE HARDCODED STRING WOULD HAVE PRINTED. This is the assertion that
    // fails the moment somebody "simplifies" the field away or restores the literal.
    expect(placed?.text).not.toContain("Ability");
    const declared = rendered.find((r) => r.text.includes("Land Scoop"));
    expect(declared?.who).toBe("p1");
    expect(rendered.indexOf(declared as (typeof rendered)[number])).toBeLessThan(
      rendered.indexOf(placed as (typeof rendered)[number]),
    );
    expect(rendered.some((r) => r.text.includes(String(LAND_SCOOP_DAMAGE)))).toBe(true);
  });

  it("still renders MEOWSCARADA's placement as an Ability row — the other producer", () => {
    const authored = programFor("sv02-015")?.abilities?.[0]?.program?.[1] as {
      source: "ability" | "attack";
    };
    expect(authored.source).toBe("ability");
    const state = board();
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:14" };
    const uid = benchTopUid(bench(state, "p2", ["fix-titan"]), "p2", 0);
    const rows = logFromEvents(
      [
        {
          type: "COUNTERS_PLACED",
          seat: "p2",
          uid,
          amount: 30,
          source: authored.source,
        },
      ],
      { ...ctx, state: bench(state, "p2", ["fix-titan"]) },
    ).flatMap((entry) =>
      entry.kind === "turn"
        ? []
        : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
    );
    expect(rows[0]?.who).toBe("system");
    expect(rows[0]?.text.startsWith("Ability: ")).toBe(true);
    expect(rows[0]?.text).not.toContain("Put:");
  });
});
