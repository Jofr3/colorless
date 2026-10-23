import { describe, expect, it } from "vitest";
import { deriveAttackEffect, programFor } from "./index";
// `applyAction` is imported as a TYPE only: the illegal-choice case builds a
// deliberately malformed action and casts it through `Parameters<typeof applyAction>[1]`
// so the cast is anchored on the real signature rather than on `any`.
import type { GameEvent, GameState, PokemonRef, Seat, applyAction } from "./index";
import {
  CHOSEN_HEAL_DECK,
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

const CLAUSES = [
  {
    text: "Heal 20 damage from 1 of your Pokémon.",
    op: { op: "healChosen", amount: 20 },
    // Nacli sv02-121 / -220 "Salt Coating" — one attack in two rarities, and the
    // fixture this suite drives for the any-zone reading.
    printings: 2,
  },
  {
    text: "Heal 30 damage from 1 of your Pokémon.",
    op: { op: "healChosen", amount: 30 },
    // Smoliv sv01-021 "Nutrients". Also, byte for byte, Potion's authored program —
    // see the op-identity case below.
    printings: 1,
  },
  {
    text: "Heal 60 damage from 1 of your Pokémon.",
    op: { op: "healChosen", amount: 60 },
    // Vespiquen ex sv03-096 / -212 "Healing Pheromone".
    printings: 2,
  },
  {
    text: "Heal 20 damage from 1 of your Benched Pokémon.",
    op: { op: "healChosen", amount: 20, zone: "bench" },
    // Combee sv03-008 "Share".
    printings: 1,
  },
  {
    text: "Heal 30 damage from 1 of your Benched Pokémon.",
    op: { op: "healChosen", amount: 30, zone: "bench" },
    // Chansey swsh10.5-051 "Delicious Egg".
    printings: 1,
  },
  {
    text: "Heal 60 damage from 1 of your Benched Pokémon.",
    op: { op: "healChosen", amount: 60, zone: "bench" },
    // Tropius sv01-007 "Fresh-Picked Fruit" — the fixture this suite drives for the
    // bench-only reading.
    printings: 1,
  },
  {
    text: "Heal all damage from 1 of your Benched Pokémon.",
    op: { op: "healChosen", amount: "all", zone: "bench" },
    printings: 2,
  },
] as const;

const CENSUS_IDS = [
  "sv02-121", // Nacli
  "sv02-220", // Nacli (Illustration rare)
  "sv01-021", // Smoliv
  "sv03-096", // Vespiquen ex
  "sv03-212", // Vespiquen ex (Ultra Rare)
  "sv03-008", // Combee
  "swsh10.5-051", // Chansey
  "sv01-007", // Tropius
  "swsh10.5-052", // Blissey
  "sv03-021", // Arboliva
] as const;

const REAL_NEAR_MISSES = [
  "Heal 100 damage from 1 of your Benched Ancient Pokémon.",
  "Choose up to 2 of your Pokémon and heal 50 damage from each of them.",
  "Heal 30 damage from each Pokémon (both yours and your opponent's).",
  "Flip a coin. If heads, this attack does 30 more damage, and heal 30 damage from this Pokémon.",
] as const;

const NBSP = "\u00a0";

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

/** The parked `choosePokemon` prompt, narrowed — every end-to-end case below reads
    `candidates` and `note` off it, and a state that did NOT park fails here with the
    reason rather than three lines later on an undefined. */
function choosePrompt(state: GameState): { candidates: PokemonRef[]; note: string } {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "choosePokemon") {
    throw new Error(`expected choosePokemon, got ${state.phase.prompt.kind}`);
  }
  return { candidates: state.phase.prompt.candidates, note: state.phase.prompt.note };
}

const SALT_COATING_INDEX = 0;
const TACKLE_INDEX = 1;
const FRESH_PICKED_INDEX = 0;
const RAZOR_LEAF_INDEX = 1;
const WHOLE_HEAL_INDEX = 0;

/** The three printed heals and the two controls' damage. The heals are three
    different values on purpose: a hardcoded amount anywhere downstream of the deriver
    cannot satisfy more than one of them. */
const SALT_COATING_HEAL = 20;
const TACKLE_DAMAGE = 30;
const FRESH_PICKED_HEAL = 60;
const RAZOR_LEAF_DAMAGE = 50;

const ATTACKER_HURT = 50;

const BENCH_HURT = 80;

/** LESS than Salt Coating's printed 20 — the clamped body, where the heal lands at 0
    and must not go negative or spend the difference elsewhere. */
const BENCH_BARELY_HURT = 10;

const BENCH_WRECKED = 300;

const ACTIVE_REF = { seat: "p1", spot: { spot: "active" } } as const;
const BENCH_0 = { seat: "p1", spot: { spot: "bench", index: 0 } } as const;
const BENCH_1 = { seat: "p1", spot: { spot: "bench", index: 1 } } as const;

function board(): GameState {
  let state = driveSetup(7, { p1: CHOSEN_HEAL_DECK, p2: CHOSEN_HEAL_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return clearBench(clearBench(state, "p1"), "p2");
}

function attacker(
  state: GameState,
  seat: Seat,
  cardId: string,
  energyId: string,
  damage: number,
): GameState {
  const fielded = attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, cardId), seat),
    seat,
    energyId,
    1,
  );
  return setDamage(fielded, seat, damage);
}

function nacliActive(state: GameState, seat: Seat, damage: number): GameState {
  return attacker(state, seat, "sv02-121", "fix-fighting-energy", damage);
}

function tropiusActive(state: GameState, seat: Seat, damage: number): GameState {
  return attacker(state, seat, "sv01-007", "fix-grass-energy", damage);
}

function allHealActive(state: GameState, seat: Seat, damage: number): GameState {
  return attacker(state, seat, "fix-allheal", "fix-energy", damage);
}

function benchTitans(state: GameState, seat: Seat, damages: number[]): GameState {
  let next = state;
  for (const damage of damages) {
    next = benchFromDeck(next, seat, "fix-titan");
    next = setBenchDamage(next, seat, next.players[seat].bench.length - 1, damage);
  }
  return next;
}

/** Declare `index` on P1, freezing the prior state first — the purity check every
    neighbouring suite runs, hoisted here because this file drives twenty of them. */
function declare(state: GameState, index: number): { state: GameState; events: GameEvent[] } {
  deepFreeze(state);
  return mustApply(state, { type: "attack", seat: "p1", index });
}

describe("the anchor — 10 printings, 7 clauses, one regex with two captures", () => {
  it("derives all SEVEN distinct clauses the pool prints, to the same single op", () => {
    for (const { text, op } of CLAUSES) {
      expect(deriveAttackEffect(text)).toEqual([op]);
    }
    expect(CLAUSES).toHaveLength(7);
    expect(CLAUSES.reduce((n, c) => n + c.printings, 0)).toBe(10);
    expect(CENSUS_IDS).toHaveLength(10);
    // No two rows share a sentence — a duplicated `text` would make the loop above
    // pass while covering one clause.
    expect(new Set(CLAUSES.map((c) => c.text)).size).toBe(CLAUSES.length);
    for (const { text } of CLAUSES) {
      const ops = deriveAttackEffect(text);
      expect(ops).toHaveLength(1);
      expect(ops?.[0]).toMatchObject({ op: "healChosen" });
    }
    const bench = CLAUSES.filter((c) => c.text.includes("Benched"));
    expect(bench).toHaveLength(4);
    expect(bench.reduce((n, c) => n + c.printings, 0)).toBe(5);
    expect(CLAUSES.length - bench.length).toBe(3);
  });

  it("OMITS the zone key entirely on the any-zone reading — absent, not undefined", () => {
    for (const { text } of CLAUSES.filter((c) => !c.text.includes("Benched"))) {
      const op = deriveAttackEffect(text)?.[0] as object;
      expect(Object.hasOwn(op, "zone")).toBe(false);
    }
    // …and it IS present, with the one legal value, on the other reading.
    for (const { text } of CLAUSES.filter((c) => c.text.includes("Benched"))) {
      const op = deriveAttackEffect(text)?.[0] as object;
      expect(Object.hasOwn(op, "zone")).toBe(true);
      expect(op).toMatchObject({ zone: "bench" });
    }
  });

  it("emits the SAME op POTION's authored row carries — one action, two readers", () => {
    expect(deriveAttackEffect("Heal 30 damage from 1 of your Pokémon.")).toEqual(
      programFor("sv01-188")?.trainer,
    );
    expect(deriveAttackEffect("Heal all damage from 1 of your Pokémon.")).toEqual(
      programFor("sv01-023")?.triggered?.[0]?.program,
    );
  });

  it("accepts the UNPRINTED cross product — 'all' with no zone — on purpose", () => {
    expect(deriveAttackEffect("Heal all damage from 1 of your Pokémon.")).toEqual([
      { op: "healChosen", amount: "all" },
    ]);
    expect(
      Object.hasOwn(
        deriveAttackEffect("Heal all damage from 1 of your Pokémon.")?.[0] as object,
        "zone",
      ),
    ).toBe(false);
    // The other three unprinted numeric cross products come free from the same
    // alternation, and are worth one line for the same reason: they are the regex's
    // shape, not a list of cards.
    expect(deriveAttackEffect("Heal 20 damage from 1 of your Benched Pokémon.")).toEqual([
      { op: "healChosen", amount: 20, zone: "bench" },
    ]);
    expect(deriveAttackEffect("Heal 90 damage from 1 of your Pokémon.")).toEqual([
      { op: "healChosen", amount: 90 },
    ]);
  });

  it("refuses a printed ZERO — the guard every arm of this reader carries", () => {
    expect(deriveAttackEffect("Heal 0 damage from 1 of your Pokémon.")).toBeNull();
    expect(deriveAttackEffect("Heal 0 damage from 1 of your Benched Pokémon.")).toBeNull();
    // "all" is EXEMPT BY CONSTRUCTION rather than by an extra test: it is not a
    // number and cannot be zero. It whiffs only on an undamaged pick, silently.
    expect(deriveAttackEffect("Heal all damage from 1 of your Benched Pokémon.")).toEqual([
      { op: "healChosen", amount: "all", zone: "bench" },
    ]);
    // No CEILING, by contrast, and deliberately so: the interpreter CLAMPS to the
    // damage actually present, so a malformed large amount heals the pick to full
    // and stops. That is a legal board state, not a runaway.
    expect(deriveAttackEffect("Heal 999 damage from 1 of your Pokémon.")).toEqual([
      { op: "healChosen", amount: 999 },
    ]);
  });

  it("refuses the FOUR real catalog rows that share its words — one of them re-pointed at D427", () => {
    for (const text of REAL_NEAR_MISSES) {
      if (text === REAL_NEAR_MISSES[2]) continue;
      expect(deriveAttackEffect(text)).toBeNull();
    }
    expect(deriveAttackEffect(REAL_NEAR_MISSES[1])).toBeNull();
    expect(programFor("sv02-187")?.trainer).toEqual([{ op: "healChosen", amount: 50, upTo: 2 }]);
    expect(deriveAttackEffect(REAL_NEAR_MISSES[2])).toEqual([{ op: "healEachAll", amount: 30 }]);
  });

  it("leaves the two NEIGHBOURING heal anchors their own strings — a SHAPE claim", () => {
    expect(deriveAttackEffect("Heal 20 damage from each of your Pokémon.")).toEqual([
      { op: "healEach", amount: 20 },
    ]);
    expect(deriveAttackEffect("Heal 30 damage from this Pokémon.")).toEqual([
      { op: "heal", target: "self", amount: 30 },
    ]);
    for (const text of [
      "Heal 20 damage from each of your Pokémon.",
      "Heal 30 damage from this Pokémon.",
    ]) {
      expect(deriveAttackEffect(text)).not.toContainEqual(
        expect.objectContaining({ op: "healChosen" }),
      );
    }
    // And in the other direction: this arm's own clause is not a board heal.
    expect(deriveAttackEffect("Heal 20 damage from 1 of your Pokémon.")).not.toEqual(
      deriveAttackEffect("Heal 20 damage from each of your Pokémon."),
    );
  });

  it("refuses the anchor, punctuation and case rewrites — but trims outer space", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Heal 20 damage from 1 of your Pokémon",
      "Heal 60 damage from 1 of your Benched Pokémon",
      // "!" for "." — the same one-character difference from the other side.
      "Heal 20 damage from 1 of your Pokémon!",
      // A LOWERCASE first word. Half of what keeps a mid-sentence clause off this
      // path (Saguaro's and Floette's tails are exactly that clause), and the reason
      // no /i flag is on this regex.
      "heal 20 damage from 1 of your Pokémon.",
      "heal 60 damage from 1 of your Benched Pokémon.",
      `Heal${NBSP}20 damage from 1 of your Pokémon.`,
      `Heal 60 damage from 1 of your${NBSP}Benched Pokémon.`,
      // An INTERIOR double space is not trimmable.
      "Heal  20 damage from 1 of your Pokémon.",
      // THE COUNT. "1" is the printed quantifier and the reason the op is the
      // single-pick arm; "2 of your Pokémon" is Saguaro's shape (`upTo`), which this
      // arm cannot express and must not silently narrow to one.
      "Heal 20 damage from 2 of your Pokémon.",
      "Heal 20 damage from 1 of your opponent's Pokémon.",
      "Heal 20 damage from 1 of your opponent's Benched Pokémon.",
      // THE OTHER ZONE WORD. "Active" is a real printed word elsewhere in the pool
      // and would be a THIRD reading; nothing prints it in this family, and a reader
      // that guessed would be inventing a candidate set.
      "Heal 20 damage from 1 of your Active Pokémon.",
      // ARTICLE DRIFT. "1 of" is the printed form; "one of" and a bare "your" are
      // text the ingest has never produced.
      "Heal 20 damage from one of your Pokémon.",
      "Heal 20 damage from your Pokémon.",
      "Flip a coin. If heads, heal 20 damage from 1 of your Pokémon.",
      "If this Pokémon is Burned, heal 20 damage from 1 of your Pokémon.",
      "Heal 20 damage from 1 of your Pokémon. This Pokémon is now Asleep.",
      "Heal all damage from 1 of your Benched Pokémon. Then, shuffle your deck.",
      // COUNTERS, not HP. "Remove N damage counters" is the older wording for the
      // same idea and a different arithmetic (§12: one counter = 10 HP); nothing in
      // this pool prints it, and a reader that guessed would be off by a factor of 10.
      "Remove 2 damage counters from 1 of your Pokémon.",
      // Empty.
      "",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), so this pair states
    // which drift is tolerated and which is not — and it is stated on BOTH readings,
    // because the trim happens before the one regex either of them runs through.
    expect(deriveAttackEffect("\t  Heal 20 damage from 1 of your Pokémon.\n")).toEqual([
      { op: "healChosen", amount: 20 },
    ]);
    expect(deriveAttackEffect("\nHeal all damage from 1 of your Benched Pokémon. \t")).toEqual([
      { op: "healChosen", amount: "all", zone: "bench" },
    ]);
  });
});

describe("the fixtures' printed text — the sentence is load-bearing", () => {
  it("matches FIXTURE_POOL char-for-char for Nacli sv02-121 (any zone, 20)", () => {
    // On the deriver path a one-character drift un-simulates the card with no other
    // failure anywhere, so the bytes get pinned here.
    const saltCoating = FIXTURE_POOL["sv02-121"]?.attacks?.[SALT_COATING_INDEX];
    expect(saltCoating).toEqual({
      cost: ["Fighting"],
      name: "Salt Coating",
      effect: "Heal 20 damage from 1 of your Pokémon.",
    });
    expect(saltCoating?.damage).toBeUndefined();
    expect(deriveAttackEffect(saltCoating?.effect ?? "")).toEqual([
      { op: "healChosen", amount: SALT_COATING_HEAL },
    ]);
    expect(FIXTURE_POOL["sv02-121"]?.name).toBe("Nacli");
    expect(FIXTURE_POOL["sv02-121"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv02-121"]?.hp).toBe(70);
    expect(FIXTURE_POOL["sv02-121"]?.abilities).toBeNull();
    // The index-1 control: real printed damage, no effect text at all.
    const tackle = FIXTURE_POOL["sv02-121"]?.attacks?.[TACKLE_INDEX];
    expect(tackle).toEqual({
      cost: ["Fighting", "Fighting"],
      name: "Tackle",
      damage: TACKLE_DAMAGE,
    });
    expect(tackle?.effect).toBeUndefined();
  });

  it("matches FIXTURE_POOL char-for-char for Tropius sv01-007 (BENCH only, 60)", () => {
    const freshPicked = FIXTURE_POOL["sv01-007"]?.attacks?.[FRESH_PICKED_INDEX];
    expect(freshPicked).toEqual({
      cost: ["Grass"],
      name: "Fresh-Picked Fruit",
      effect: "Heal 60 damage from 1 of your Benched Pokémon.",
    });
    expect(freshPicked?.damage).toBeUndefined();
    // The ONE printed word that separates the two readings, and it lands in a field.
    expect(deriveAttackEffect(freshPicked?.effect ?? "")).toEqual([
      { op: "healChosen", amount: FRESH_PICKED_HEAL, zone: "bench" },
    ]);
    expect(FIXTURE_POOL["sv01-007"]?.name).toBe("Tropius");
    expect(FIXTURE_POOL["sv01-007"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv01-007"]?.hp).toBe(100);
    expect(FIXTURE_POOL["sv01-007"]?.abilities).toBeNull();
    const razorLeaf = FIXTURE_POOL["sv01-007"]?.attacks?.[RAZOR_LEAF_INDEX];
    expect(razorLeaf).toEqual({
      cost: ["Grass", "Colorless"],
      name: "Razor Leaf",
      damage: RAZOR_LEAF_DAMAGE,
    });
    expect(razorLeaf?.effect).toBeUndefined();
    // A DIFFERENT N from Nacli's, which is the point of fielding two: a hardcoded 20
    // anywhere downstream of the deriver would satisfy every Salt Coating case in
    // this file and fail on the bench-only board.
    expect(FRESH_PICKED_HEAL).not.toBe(SALT_COATING_HEAL);
  });

  it("carries the REAL 'all' sentence on an INVENTED body — and says which is which", () => {
    const wholeHeal = FIXTURE_POOL["fix-allheal"]?.attacks?.[WHOLE_HEAL_INDEX];
    expect(wholeHeal?.effect).toBe("Heal all damage from 1 of your Benched Pokémon.");
    // THE STRING IS REAL — asserted against the clause table rather than restated,
    // so the two cannot drift apart.
    expect(CLAUSES[6].text).toBe(wholeHeal?.effect);
    expect(CLAUSES[6].printings).toBe(2);
    expect(deriveAttackEffect(wholeHeal?.effect ?? "")).toEqual([
      { op: "healChosen", amount: "all", zone: "bench" },
    ]);
    // THE BODY IS INVENTED, and a Basic, which is the whole reason it exists.
    expect(FIXTURE_POOL["fix-allheal"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["fix-allheal"]?.evolveFrom).toBeNull();
    expect(wholeHeal?.damage).toBeUndefined();
    expect(CENSUS_IDS).toContain("swsh10.5-052");
    expect(CENSUS_IDS).toContain("sv03-021");
  });

  it("costs ZERO registry rows — all TEN printings simulate off their printed text", () => {
    for (const id of CENSUS_IDS) {
      expect(programFor(id)?.attack).toBeUndefined();
    }
    expect(programFor("sv03-021")).toBeUndefined();
    expect(programFor("sv01-023")?.attack).toBeUndefined();
    expect(programFor("sv01-023")?.triggered?.[0]?.program).toEqual([
      { op: "healChosen", amount: "all" },
    ]);
  });
});

describe("end to end — Nacli 'Salt Coating' (heal 20, ANY zone, NO printed damage)", () => {
  it("PARKS on a damaged board — and the attack epilogue WAITS behind the question", () => {
    let state = nacliActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT, BENCH_BARELY_HURT]);
    const { state: parked, events } = declare(state, SALT_COATING_INDEX);

    expect(types(events)).toContain("EFFECT_PENDING");
    expect(find(events, "EFFECT_PENDING")?.seat).toBe("p1");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.seat).toBe("p1"); // the ATTACKER decides
    expect(parked.phase.resumeTail).toBe(true);
    // The attacker is the program's "this Pokémon" — the context names it by uid,
    // even though nothing in this op reads it. (It would matter to a rider.)
    expect(parked.phase.cont.ctx.sourceUid).toBe(find(events, "ATTACK_DECLARED")?.uid);

    const prompt = choosePrompt(parked);
    expect(prompt.candidates).toEqual([ACTIVE_REF, BENCH_0, BENCH_1]);
    expect(prompt.note).toBe("Heal which of your Pokémon?");

    // NOTHING HAS MOVED YET, on either half. No heal, and — the regression the
    // `resumeTail` machinery exists to prevent — no turn end either: the epilogue is
    // QUEUED, so the §8.1 KO sweep and §5.3's turn end are still ahead of the answer.
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(types(events)).not.toContain("TURN_ENDED");
    expect(parked.pending).toEqual([
      {
        kind: "attackEpilogue",
        seat: "p1",
        uid: find(events, "ATTACK_DECLARED")?.uid,
        attack: find(events, "ATTACK_DECLARED")?.attack,
      },
    ]);
    expect(parked.players.p1.active?.damage).toBe(ATTACKER_HURT);
    expect(parked.players.p1.bench[0]?.damage).toBe(BENCH_HURT);
    // And no printed damage anywhere: the heal is the whole declaration.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(parked.players.p2.active?.damage).toBe(0);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("resolving a BENCH pick heals it, and ONLY THEN ends the turn — the ORDER", () => {
    let state = nacliActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT, BENCH_BARELY_HURT]);
    const target = benchTopUid(state, "p1", 0);
    const attackerUid = activeUid(state, "p1");
    const { state: parked } = declare(state, SALT_COATING_INDEX);
    deepFreeze(parked);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: BENCH_0 },
    });

    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: target, amount: SALT_COATING_HEAL },
    ]);
    expect(done.players.p1.bench[0]?.damage).toBe(BENCH_HURT - SALT_COATING_HEAL);
    // ONE pick, so the OTHER two bodies are untouched — including the attacker,
    // which was offered and not taken.
    expect(done.players.p1.active?.damage).toBe(ATTACKER_HURT);
    expect(done.players.p1.bench[1]?.damage).toBe(BENCH_BARELY_HURT);
    expect(all(events, "HEALED").map((e) => e.uid)).not.toContain(attackerUid);

    // …and only THEN the §5.3 tail ran, in one batch. The ORDER is the assertion:
    // a build that ended the turn at the park and applied the heal afterwards would
    // produce both rows and the wrong game.
    expect(types(events)).toEqual(["HEALED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(types(events).indexOf("HEALED")).toBeLessThan(types(events).indexOf("TURN_ENDED"));
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
  });

  it("offers the ATTACKER ITSELF — and picking it heals the body that just declared", () => {
    let state = nacliActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT]);
    const attackerUid = activeUid(state, "p1");
    const { state: parked } = declare(state, SALT_COATING_INDEX);
    expect(choosePrompt(parked).candidates).toContainEqual(ACTIVE_REF);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: ACTIVE_REF },
    });
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: attackerUid, amount: SALT_COATING_HEAL },
    ]);
    expect(done.players.p1.active?.damage).toBe(ATTACKER_HURT - SALT_COATING_HEAL);
    // The bench body was offered and declined — it keeps every point of its damage.
    expect(done.players.p1.bench[0]?.damage).toBe(BENCH_HURT);
  });

  it("FORCES the lone Active with an empty bench — one action, no prompt at all", () => {
    // `parkOrForce`'s middle case: exactly one candidate is not a decision, so it is
    // applied INLINE and the whole declaration resolves in a single action. A build
    // that parked here would stop the game to ask a question with one answer.
    const state = nacliActive(board(), "p1", ATTACKER_HURT);
    expect(state.players.p1.bench).toHaveLength(0);
    const attackerUid = activeUid(state, "p1");
    const { state: done, events } = declare(state, SALT_COATING_INDEX);

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
    // HEALED and TURN_ENDED in the SAME batch — the park's absence, stated as the
    // shape of one event log rather than as a missing phase.
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "HEALED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(find(events, "HEALED")).toEqual({
      type: "HEALED",
      seat: "p1",
      uid: attackerUid,
      amount: SALT_COATING_HEAL,
    });
    expect(done.players.p1.active?.damage).toBe(ATTACKER_HURT - SALT_COATING_HEAL);
  });

  it("CLAMPS to the damage present — 10 damage takes 10 of a printed 20", () => {
    let state = nacliActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_BARELY_HURT]);
    const target = benchTopUid(state, "p1", 0);
    const { state: parked } = declare(state, SALT_COATING_INDEX);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: BENCH_0 },
    });
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: target, amount: BENCH_BARELY_HURT },
    ]);
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    expect(BENCH_BARELY_HURT).toBeLessThan(SALT_COATING_HEAL);
  });

  it("WHIFFS SILENTLY on an UNDAMAGED pick — no row, and still not SKIPPED", () => {
    let state = nacliActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [0]);
    const { state: parked, events: attackEvents } = declare(state, SALT_COATING_INDEX);
    expect(choosePrompt(parked).candidates).toEqual([ACTIVE_REF, BENCH_0]);
    expect(types(attackEvents)).not.toContain("ATTACK_EFFECT_SKIPPED");

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: BENCH_0 },
    });
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    // The damaged Active it declined is still damaged — the whiff took the pick, not
    // "whatever was healable".
    expect(done.players.p1.active?.damage).toBe(ATTACKER_HURT);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).toEqual(["TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
  });

  it("REJECTS an illegal pick — the opponent's board, and a bench index out of range", () => {
    // "your Pokémon" is a seat scope and `candidates` is the whole legality rule, so
    // both refusals come from the same membership test. Neither is hypothetical on a
    // wire: an index is a number a client computes, and a seat is a field it fills in.
    let state = nacliActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT]);
    state = setDamage(state, "p2", BENCH_HURT);
    const { state: parked } = declare(state, SALT_COATING_INDEX);
    const resolve = (choice: unknown) =>
      ({ type: "resolveEffect", seat: "p1", choice }) as Parameters<typeof applyAction>[1];

    // THE OPPONENT'S ACTIVE — damaged, so a build that dropped the seat check would
    // heal it and look like it worked.
    expectErr(
      parked,
      resolve({ kind: "pokemon", ref: { seat: "p2", spot: { spot: "active" } } }),
      "BAD_EFFECT_CHOICE",
    );
    // A BENCH INDEX PAST THE END. p1 has exactly one benched body, so index 1 names
    // nothing at all.
    expectErr(parked, resolve({ kind: "pokemon", ref: BENCH_1 }), "BAD_EFFECT_CHOICE");
    // And the multi-pick shape does not answer a single prompt (the `upTo` arm's
    // choice kind, which the SAME op emits for Saguaro).
    expectErr(parked, resolve({ kind: "pokemonMulti", refs: [BENCH_0] }), "BAD_EFFECT_CHOICE");
    // A rejection leaves the park exactly where it was — the question is still open.
    expect(parked.phase.kind).toBe("effect:choose");
  });

  it("consumes NO rng across the WHOLE resolution — park and resolve alike", () => {
    let state = nacliActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT]);
    const { state: parked } = declare(state, SALT_COATING_INDEX);
    expect(parked.rngState).toBe(state.rngState);
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: BENCH_0 },
    });
    expect(done.rngState).toBe(state.rngState);
  });

  it("the parked state survives a JSON round-trip and resolves identically (D14)", () => {
    let state = nacliActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT, BENCH_BARELY_HURT]);
    const { state: parked } = declare(state, SALT_COATING_INDEX);
    const rehydrated = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(rehydrated).toEqual(parked);
    const answer = {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: BENCH_1 },
    } as const;
    const a = mustApply(parked, answer);
    const b = mustApply(rehydrated, answer);
    expect(b.state).toEqual(a.state);
    expect(b.events).toEqual(a.events);
  });
});

describe("end to end — Tropius 'Fresh-Picked Fruit' (heal 60, BENCH only)", () => {
  it("EXCLUDES the damaged Active from the candidates AND says so in the heading", () => {
    let state = tropiusActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT, BENCH_BARELY_HURT]);
    const target = benchTopUid(state, "p1", 0);
    const { state: parked } = declare(state, FRESH_PICKED_INDEX);

    const prompt = choosePrompt(parked);
    expect(prompt.candidates).toEqual([BENCH_0, BENCH_1]);
    expect(prompt.candidates).not.toContainEqual(ACTIVE_REF);
    for (const ref of prompt.candidates) {
      expect(ref.spot.spot).toBe("bench");
    }
    expect(prompt.note).toBe("Heal which of your Benched Pokémon?");
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref: ACTIVE_REF } },
      "BAD_EFFECT_CHOICE",
    );

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: BENCH_0 },
    });
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: target, amount: FRESH_PICKED_HEAL },
    ]);
    expect(done.players.p1.bench[0]?.damage).toBe(BENCH_HURT - FRESH_PICKED_HEAL);
    // AND THE ACTIVE'S DAMAGE IS UNCHANGED — the other half of the exclusion, taken
    // from the board rather than from the prompt.
    expect(done.players.p1.active?.damage).toBe(ATTACKER_HURT);
    expect(types(events)).toEqual(["HEALED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
  });

  it("WHIFFS SILENTLY on an EMPTY bench — no park, no row, and still SIMULATED", () => {
    const state = tropiusActive(board(), "p1", ATTACKER_HURT);
    expect(state.players.p1.bench).toHaveLength(0);
    const { state: done, events } = declare(state, FRESH_PICKED_INDEX);

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
    // The DAMAGED Active is still damaged: an empty bench is not a licence to fall
    // back on the any-zone reading.
    expect(done.players.p1.active?.damage).toBe(ATTACKER_HURT);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).toEqual(["ATTACK_DECLARED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
  });

  it("FORCES a single benched body — no prompt, even with a damaged Active in play", () => {
    let state = tropiusActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT]);
    const target = benchTopUid(state, "p1", 0);
    const { state: done, events } = declare(state, FRESH_PICKED_INDEX);

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(find(events, "HEALED")).toEqual({
      type: "HEALED",
      seat: "p1",
      uid: target,
      amount: FRESH_PICKED_HEAL,
    });
    expect(done.players.p1.bench[0]?.damage).toBe(BENCH_HURT - FRESH_PICKED_HEAL);
    expect(done.players.p1.active?.damage).toBe(ATTACKER_HURT);
  });
});

describe("end to end — the 'all' amount (fix-allheal, Blissey/Arboliva's sentence)", () => {
  it("clears the pick's ENTIRE damage while the Active's is untouched", () => {
    let state = allHealActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_WRECKED, BENCH_BARELY_HURT]);
    const target = benchTopUid(state, "p1", 0);
    const { state: parked } = declare(state, WHOLE_HEAL_INDEX);

    const prompt = choosePrompt(parked);
    expect(prompt.candidates).toEqual([BENCH_0, BENCH_1]);
    expect(prompt.note).toBe("Heal which of your Benched Pokémon?");

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: BENCH_0 },
    });
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: target, amount: BENCH_WRECKED },
    ]);
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    // ONE pick: the other benched body and the Active both keep every point.
    expect(done.players.p1.bench[1]?.damage).toBe(BENCH_BARELY_HURT);
    expect(done.players.p1.active?.damage).toBe(ATTACKER_HURT);
    expect(types(events)).toEqual(["HEALED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
  });
});
