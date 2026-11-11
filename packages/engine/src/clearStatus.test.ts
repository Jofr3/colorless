import { describe, expect, it } from "vitest";
import { passivesOf } from "./continuous";
import { deriveAttackEffect } from "./effects";
import { applyAction, programFor } from "./index";
import type { CoinFace, GameEvent, GameState, PokemonTarget, Seat, StatusName } from "./index";
import { type LogContext, logFromEvents } from "./log";
import { flipCoin } from "./rng";
import {
  CLEAR_STATUS_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
  findEvent,
  findEvents,
} from "./testFixtures";

/** The two printed sentences, byte-for-byte off the local D1 rows. */
const MIRACLE_FORCE = "This Pokémon recovers from all Special Conditions.";
const BUSYBODY_NURSE =
  "Once during your turn, you may use this Ability. Your Active Pokémon recovers from all Special Conditions.";

const THERAPEUTIC_ENERGY =
  "The Pokémon this card is attached to recovers from being Asleep, Confused, or Paralyzed and can't be affected by those Special Conditions.";

const POISON_SACS =
  "Your opponent's Poisoned Pokémon don't recover from that Special Condition when they evolve or devolve.";

const GARDEVOIR_PRINTINGS = ["sv01-086", "sv01-228", "sv01-245"] as const;

/** The five §12 conditions, in the `presentStatuses` order. "All Special
    Conditions" is the printed quantifier over exactly this closed union — which
    is why the op carries no `statuses` field where `statusRecovery` must. */
const ALL_STATUSES: StatusName[] = ["asleep", "confused", "paralyzed", "poisoned", "burned"];

const SEED = 5;
const ACTIVE: PokemonTarget = { spot: "active" };

const ATTACKS = {
  hypnosis: { card: "fix-statuser", index: 0 }, // → the DEFENDER is Asleep
  confuseRay: { card: "fix-statuser", index: 1 }, // → the DEFENDER is Confused
  numbingBolt: { card: "fix-statuser", index: 2 }, // flip → Paralyzed, 10
  toxic: { card: "fix-statuser", index: 5 }, // → Poisoned (20/checkup)
  miracleForce: { card: "sv01-086", index: 0 }, // {P}{P}{C}, 190, + the recovery
} as const;

/** p2 opens and passes, so p1 plays turn 2 with no §4 first-turn restriction.
    Both bodies are placed by surgery — every claim in this file is about the
    board in front of the op, never about how it was reached. */
function board(mine: string, theirs = "fix-titan", seed = SEED): GameState {
  let state = mustApply(
    driveSetup(seed, { p1: CLEAR_STATUS_DECK, p2: CLEAR_STATUS_DECK }, { first: "p2" }),
    { type: "endTurn", seat: "p2" },
  ).state;
  state = setActiveFromDeck(state, "p1", mine);
  state = setActiveFromDeck(state, "p2", theirs);
  return state;
}

/** {P}{P}{C} onto the seat's Active — Miracle Force's printed cost, and the only
    typed cost anything in `CLEAR_STATUS_DECK` can pay. */
function energised(state: GameState, seat: Seat = "p1"): GameState {
  return attachFromDeck(
    attachFromDeck(state, seat, "fix-psychic-energy", 2),
    seat,
    "fix-energy",
    1,
  );
}

/** A Gardevoir ex on turn, energised, with `conditions` already on it. */
function gardevoir(
  conditions: Parameters<typeof setConditions>[2] = {},
  opts: { printing?: string; seed?: number; theirs?: string } = {},
): GameState {
  const state = energised(
    board(opts.printing ?? "sv01-086", opts.theirs ?? "fix-titan", opts.seed ?? SEED),
  );
  return setConditions(state, "p1", conditions);
}

function swing(state: GameState, attack: keyof typeof ATTACKS, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKS[attack].index });
}

function nurse(target: PokemonTarget = ACTIVE, seat: Seat = "p1") {
  return { type: "useAbility", seat, target, abilityName: "Busybody Nurse" } as const;
}

/** A board where p1's ACTIVE is Blissey (the simple half) or where Blissey sits on
    the BENCH behind a different Active (the half the printed subject demands). */
function blisseyBoard(
  where: "active" | "bench",
  conditions: Parameters<typeof setConditions>[2] = {},
  seed = SEED,
): GameState {
  let state = board(where === "active" ? "sv01-145" : "fix-bigbody", "fix-titan", seed);
  if (where === "bench") state = benchFromDeck(state, "p1", "sv01-145");
  return setConditions(state, "p1", conditions);
}

function conditionsOf(state: GameState, seat: Seat) {
  return state.players[seat].active?.conditions;
}

function benchSlot(state: GameState, seat: Seat, cardId: string, nth = 0): PokemonTarget {
  const hits = state.players[seat].bench.flatMap((pokemon, index) => {
    const top = pokemon.stack[pokemon.stack.length - 1];
    return top !== undefined && state.cardIdByUid[top] === cardId ? [index] : [];
  });
  const index = hits[nth];
  if (index === undefined) throw new Error(`${seat} has no bench ${cardId} #${nth}`);
  return { spot: "bench", index };
}

function nextFace(state: GameState): CoinFace {
  return flipCoin(state.rngState)[0];
}

/** The first seed at or after `from` whose board will flip `want` — the confusion
    check (§8 step 3) is the first rng consumer on the attack path, so the board's
    NEXT flip is the one the declaration will take. */
function seedFlipping(want: CoinFace, make: (seed: number) => GameState, from = SEED): number {
  for (let seed = from; seed < from + 120; seed += 1) {
    if (nextFace(make(seed)) === want) return seed;
  }
  throw new Error(`no seed in [${from}, ${from + 120}) flips ${want}`);
}

function logRows(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "P1", p2: "P2" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

function logLines(state: GameState, events: GameEvent[]): string[] {
  return logRows(state, events).map((row) => row.text);
}

describe("THE CENSUS", () => {
  it("all four printings are in the pool, and each carries the family's sentence VERBATIM", () => {
    for (const id of GARDEVOIR_PRINTINGS) {
      const attacks = FIXTURE_POOL[id]?.attacks ?? [];
      expect(attacks[0]?.name, `${id} must print Miracle Force at index 0`).toBe("Miracle Force");
      expect(attacks[0]?.effect).toBe(MIRACLE_FORCE);
    }
    // The ABILITY half's sentence lives in the REGISTRY (the card's `abilities`
    // array is inert once `programFor` keys on the id), so the pool carries the
    // BODY and the registry carries the RULE — asserted from both ends.
    expect(FIXTURE_POOL["sv01-145"]?.name).toBe("Blissey");
    expect(programFor("sv01-145")?.abilities?.[0]?.name).toBe("Busybody Nurse");
  });

  it("the three ATTACK printings are BYTE-IDENTICAL — which is why one arm covers them", () => {
    // The deriver is TEXT-keyed, not id-keyed, so a reprint whose text drifted by
    // one character would silently fall off the derived path and become an
    // unsimulated attack. Nothing else in the repo can see that; this can.
    const texts = new Set(GARDEVOIR_PRINTINGS.map((id) => FIXTURE_POOL[id]?.attacks?.[0]?.effect));
    expect([...texts]).toEqual([MIRACLE_FORCE]);
    const costs = new Set(
      GARDEVOIR_PRINTINGS.map((id) => (FIXTURE_POOL[id]?.attacks?.[0]?.cost ?? []).join("/")),
    );
    expect([...costs]).toEqual(["Psychic/Psychic/Colorless"]);
    const damage = new Set(GARDEVOIR_PRINTINGS.map((id) => FIXTURE_POOL[id]?.attacks?.[0]?.damage));
    expect([...damage]).toEqual([190]);
  });

  it("derives to ONE op with no fields — the whole instruction is its name", () => {
    expect(deriveAttackEffect(MIRACLE_FORCE)).toEqual([{ op: "clearStatus" }]);
    // Leading/trailing whitespace is the deriver's one tolerance (its own contract).
    expect(deriveAttackEffect(`  ${MIRACLE_FORCE}  `)).toEqual([{ op: "clearStatus" }]);
  });

  it("REFUSES the neighbours — and every refusal below is a real catalog row", () => {
    // The three sentences that share the verb and mean different things, plus the
    // shapes the anchoring exists to keep out. A `%recovers from%` LIKE would have
    // matched all three; `^…$` matches exactly one.
    expect(deriveAttackEffect(THERAPEUTIC_ENERGY)).toBeNull(); // continuous, NAMED set
    expect(deriveAttackEffect(POISON_SACS)).toBeNull(); // the NEGATIVE form
    expect(deriveAttackEffect(BUSYBODY_NURSE)).toBeNull();
    expect(deriveAttackEffect(`Discard an Energy from this Pokémon. ${MIRACLE_FORCE}`)).toBeNull();
    expect(deriveAttackEffect("this Pokémon recovers from all Special Conditions.")).toBeNull();
    expect(deriveAttackEffect("This Pokémon recovers from all Special Conditions")).toBeNull();
  });

  it("FIXTURE_POOL swept SEPARATELY: exactly four ids print the family's sentence", () => {
    const carriers = Object.entries(FIXTURE_POOL)
      .filter(([, card]) => (card.attacks ?? []).some((a) => a.effect === MIRACLE_FORCE))
      .map(([id]) => id)
      .sort();
    expect(carriers).toEqual([...GARDEVOIR_PRINTINGS]);
    // …plus the one whose sentence is in the registry rather than on the card.
    expect(Object.keys(FIXTURE_POOL)).toContain("sv01-145");
  });

  it("ONE registry row for the whole family — the ATTACK half needs none", () => {
    expect(programFor("sv01-145")?.abilities).toHaveLength(1);
    for (const id of GARDEVOIR_PRINTINGS) {
      expect(programFor(id)?.attack).toBeUndefined();
      expect((programFor(id)?.abilities ?? []).map((a) => a.name)).toEqual(["Psychic Embrace"]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE ATTACK HALF — Gardevoir ex "Miracle Force", driven on a live board.
// ─────────────────────────────────────────────────────────────────────────────

describe("the ATTACK half — Miracle Force", () => {
  it("recovers from Poisoned AND Burned in ONE row, and the 190 still lands", () => {
    const state = gardevoir({ poisonDamage: 10, burned: true });
    const done = swing(state, "miracleForce");
    expect(conditionsOf(done.state, "p1")).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
    const cleared = findEvent(done.events, "STATUS_CLEARED");
    expect(cleared).toMatchObject({
      seat: "p1",
      statuses: ["poisoned", "burned"],
      reason: "recovered",
    });
    // The recovery is a RIDER, not a replacement: the attack's own damage is
    // untouched by it (fix-titan is 340 HP, so nothing dies and the number shows).
    expect(findEvent(done.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 190 });
    expect(done.state.players.p2.active?.damage).toBe(190);
  });

  it("recovers from Confusion — on the HEADS branch of the §8 confusion check", () => {
    const seed = seedFlipping("heads", (s) => gardevoir({ rotation: "confused" }, { seed: s }));
    const done = swing(gardevoir({ rotation: "confused" }, { seed }), "miracleForce");
    expect(findEvent(done.events, "CONFUSION_CHECK")).toMatchObject({ result: "heads" });
    expect(conditionsOf(done.state, "p1")?.rotation).toBe("none");
    expect(findEvent(done.events, "STATUS_CLEARED")).toMatchObject({ statuses: ["confused"] });
  });

  it("TAILS: the attack does not resolve, so the recovery does not happen either", () => {
    const seed = seedFlipping("tails", (s) => gardevoir({ rotation: "confused" }, { seed: s }));
    const done = swing(gardevoir({ rotation: "confused" }, { seed }), "miracleForce");
    expect(findEvent(done.events, "ATTACK_FAILED")).toMatchObject({ reason: "confusion" });
    expect(conditionsOf(done.state, "p1")?.rotation).toBe("confused");
    expect(findEvent(done.events, "STATUS_CLEARED")).toBeUndefined();
    expect(done.state.players.p1.active?.damage).toBe(30); // the confusion self-hit
  });

  it("ALL THREE PRINTINGS recover, driven — not just the one with the registry row", () => {
    for (const printing of GARDEVOIR_PRINTINGS) {
      const state = gardevoir({ burned: true }, { printing });
      const done = swing(state, "miracleForce");
      expect(conditionsOf(done.state, "p1")?.burned, `${printing} must recover`).toBe(false);
      expect(findEvent(done.events, "STATUS_CLEARED")).toMatchObject({
        statuses: ["burned"],
        reason: "recovered",
      });
    }
  });

  it("driven END TO END: the opponent's Toxic lands, the next attack recovers it", () => {
    let state = driveSetup(SEED, { p1: CLEAR_STATUS_DECK, p2: CLEAR_STATUS_DECK }, { first: "p1" });
    state = setActiveFromDeck(state, "p1", "sv01-086");
    state = energised(state, "p1");
    state = setActiveFromDeck(state, "p2", "fix-statuser");
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    const poisoned = swing(state, "toxic", "p2");
    expect(conditionsOf(poisoned.state, "p1")?.poisonDamage).toBe(20);
    // The Checkup between the turns placed the poison's own 20.
    expect(poisoned.state.players.p1.active?.damage).toBe(20);
    // A 340 HP body opposite, so the 190 cannot end the turn in a KO stage and the
    // case measures the recovery rather than the sweep behind it.
    const armed = setActiveFromDeck(poisoned.state, "p2", "fix-titan");
    const done = swing(armed, "miracleForce");
    expect(findEvent(done.events, "STATUS_CLEARED")).toMatchObject({
      seat: "p1",
      statuses: ["poisoned"],
      reason: "recovered",
    });
    expect(conditionsOf(done.state, "p1")?.poisonDamage).toBe(0);
    // …and the poison it recovered from does NOT tick at the Checkup that follows.
    expect(done.state.players.p1.active?.damage).toBe(20);
  });

  it("SILENT on a clean body — no row, no board change, and NOT an effect-skipped", () => {
    const done = swing(gardevoir(), "miracleForce");
    expect(findEvent(done.events, "STATUS_CLEARED")).toBeUndefined();
    expect(conditionsOf(done.state, "p1")).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
    expect(findEvent(done.events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("touches ONLY the attacker — the DEFENDER keeps every condition it has", () => {
    // `clearStatus` reads `ctx.seat`, and an attack program's ctx.seat is the
    // ATTACKER's. The printed subject is "This Pokémon"; a `target` field guessed
    // at from one reading is what this case exists to refuse.
    let state = gardevoir({ burned: true });
    state = setConditions(state, "p2", {
      rotation: "asleep",
      poisonDamage: 10,
      burned: true,
      confusionDamage: 30,
    });
    const done = swing(state, "miracleForce");
    expect(conditionsOf(done.state, "p1")?.burned).toBe(false);
    const theirs = conditionsOf(done.state, "p2");
    expect(theirs?.rotation).toBe("asleep");
    expect(theirs?.poisonDamage).toBe(10);
    expect(theirs?.burned).toBe(true);
    expect(findEvents(done.events, "STATUS_CLEARED")).toHaveLength(1);
  });

  it("the ROW is the card's own verb, filed under the seat that OWNS the body", () => {
    const done = swing(gardevoir({ burned: true }), "miracleForce");
    const row = logRows(done.state, done.events).find((r) => r.text.includes("recovered"));
    expect(row?.who).toBe("p1");
    expect(row?.text).toContain("recovered from");
    expect(logLines(done.state, done.events).filter((l) => l.includes("recovered"))).toHaveLength(
      1,
    );
  });
});

describe("the ATTACK half cannot reach TWO of the five conditions it names", () => {
  for (const rotation of ["asleep", "paralyzed"] as const) {
    it(`refuses the declaration while ${rotation} — the recovery never runs`, () => {
      const state = gardevoir({ rotation });
      const rejected = applyAction(state, { type: "attack", seat: "p1", index: 0 });
      expect(rejected.ok).toBe(false);
      expect(conditionsOf(state, "p1")?.rotation).toBe(rotation);
    });
  }

  it("…and the ABILITY half reaches BOTH, which is why the family needed two entry points", () => {
    for (const rotation of ["asleep", "paralyzed"] as const) {
      const state = blisseyBoard("active", { rotation });
      const done = mustApply(state, nurse());
      expect(conditionsOf(done.state, "p1")?.rotation).toBe("none");
      expect(findEvent(done.events, "STATUS_CLEARED")).toMatchObject({
        statuses: [rotation],
        reason: "recovered",
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE ABILITY HALF — Blissey "Busybody Nurse".
// ─────────────────────────────────────────────────────────────────────────────

describe("the ABILITY half — Busybody Nurse", () => {
  it("recovers the controller's Active from every condition on it", () => {
    const done = mustApply(blisseyBoard("active", { rotation: "confused", burned: true }), nurse());
    expect(conditionsOf(done.state, "p1")).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
    expect(findEvent(done.events, "STATUS_CLEARED")).toMatchObject({
      seat: "p1",
      statuses: ["confused", "burned"],
      reason: "recovered",
    });
    expect(findEvent(done.events, "ABILITY_USED")).toMatchObject({ ability: "Busybody Nurse" });
  });

  it('works from the BENCH — the print says "your Active Pokémon", not "this Pokémon"', () => {
    const state = blisseyBoard("bench", { poisonDamage: 10 });
    expect(state.players.p1.active?.stack).toBeDefined();
    const activeBefore = activeUid(state, "p1");
    const done = mustApply(state, nurse(benchSlot(state, "p1", "sv01-145")));
    expect(conditionsOf(done.state, "p1")?.poisonDamage).toBe(0);
    expect(findEvent(done.events, "STATUS_CLEARED")?.uid).toBe(activeBefore);
    expect(findEvent(done.events, "ABILITY_USED")?.uid).not.toBe(activeBefore);
  });

  it("ONCE per turn, per BODY — a second Blissey on the same board still nurses", () => {
    let state = blisseyBoard("active", { burned: true });
    state = benchFromDeck(state, "p1", "sv01-145"); // a SECOND Blissey
    const first = mustApply(state, nurse());
    expect(conditionsOf(first.state, "p1")?.burned).toBe(false);
    // The same body, again: refused by the printed "Once during your turn".
    expectErr(first.state, nurse(), "ABILITY_ALREADY_USED");
    // A DIFFERENT body: the allowance is keyed `uid:name`, so it has its own use.
    const armed = setConditions(first.state, "p1", { rotation: "asleep" });
    const second = mustApply(armed, nurse(benchSlot(armed, "p1", "sv01-145")));
    expect(conditionsOf(second.state, "p1")?.rotation).toBe("none");
  });

  it("USABLE with nothing to recover from — the Potion doctrine, and it is a CHOICE", () => {
    const done = mustApply(blisseyBoard("active"), nurse());
    expect(findEvent(done.events, "ABILITY_USED")).toBeDefined();
    expect(findEvent(done.events, "STATUS_CLEARED")).toBeUndefined();
    expectErr(done.state, nurse(), "ABILITY_ALREADY_USED");
  });

  it("costs no energy, ends no turn, and never parks", () => {
    const state = blisseyBoard("active", { rotation: "paralyzed" });
    const done = mustApply(state, nurse());
    expect(done.state.phase.kind).toBe("turn:action"); // still p1's turn, no prompt
    if (done.state.phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(done.state.phase.seat).toBe("p1");
    expect(done.state.players.p1.active?.energy).toEqual(state.players.p1.active?.energy);
  });

  it("only the CONTROLLER's Active — the opponent's conditions are none of its business", () => {
    let state = blisseyBoard("active", { burned: true });
    state = setConditions(state, "p2", { rotation: "asleep", burned: true });
    const done = mustApply(state, nurse());
    expect(conditionsOf(done.state, "p1")?.burned).toBe(false);
    expect(conditionsOf(done.state, "p2")).toMatchObject({ rotation: "asleep", burned: true });
    expect(findEvents(done.events, "STATUS_CLEARED")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE OP-REUSE DECISION — priced, then asserted.
// ─────────────────────────────────────────────────────────────────────────────

describe("the op does NOT reuse flow.ts `recoverStatuses`, and the board says why", () => {
  it("neither printing writes `statusRecovery` — there is no source for a sweep to read", () => {
    const gard = gardevoir({ burned: true });
    const bliss = blisseyBoard("active", { burned: true });
    for (const state of [gard, bliss]) {
      const active = state.players.p1.active;
      if (active === null) throw new Error("no Active");
      expect(passivesOf(state, active).statusRecovery).toEqual([]);
    }
    expect(conditionsOf(swing(gard, "miracleForce").state, "p1")?.burned).toBe(false);
    expect(conditionsOf(mustApply(bliss, nurse()).state, "p1")?.burned).toBe(false);
  });

  it("the clear is TOTAL, where the continuous half is PER-CONDITION", () => {
    const done = mustApply(
      blisseyBoard("active", {
        rotation: "asleep",
        poisonDamage: 30,
        burned: true,
        confusionDamage: 30,
      }),
      nurse(),
    );
    expect(findEvent(done.events, "STATUS_CLEARED")?.statuses).toEqual([
      "asleep",
      "poisoned",
      "burned",
    ]);
    expect(conditionsOf(done.state, "p1")).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
  });

  it("ONE seat, not two — reason (2), THE SCOPE IS WRONG, stated on a board", () => {
    let state = blisseyBoard("active", { burned: true });
    state = setConditions(state, "p2", { burned: true });
    expect(findEvents(mustApply(state, nurse()).events, "STATUS_CLEARED")).toHaveLength(1);
  });

  it("ONE vocabulary word for one printed verb — both halves say `recovered`", () => {
    const fromAttack = findEvent(
      swing(gardevoir({ burned: true }), "miracleForce").events,
      "STATUS_CLEARED",
    );
    const fromAbility = findEvent(
      mustApply(blisseyBoard("active", { burned: true }), nurse()).events,
      "STATUS_CLEARED",
    );
    expect(fromAttack?.reason).toBe("recovered");
    expect(fromAbility?.reason).toBe("recovered");
    expect(["benched", "evolved", "wokeUp", "burnCured", "paralysisEnded"]).not.toContain(
      fromAttack?.reason,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — one op, two entry points, TWO ANSWERS to the Ability lock.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — the lock reaches the ABILITY half and cannot touch the ATTACK half", () => {
  it("a live Klefki kills Gardevoir's Ability and leaves its ATTACK's recovery intact", () => {
    let state = gardevoir({ burned: true });
    state = setActiveFromDeck(state, "p2", "sv01-096"); // Klefki Active — the aura is Active-only
    expectErr(
      state,
      { type: "useAbility", seat: "p1", target: ACTIVE, abilityName: "Psychic Embrace" },
      "ABILITY_DISABLED",
    );
    const done = swing(state, "miracleForce");
    expect(conditionsOf(done.state, "p1")?.burned).toBe(false);
    expect(findEvent(done.events, "STATUS_CLEARED")).toMatchObject({ reason: "recovered" });
  });

  it("…and it kills Busybody Nurse, which is the same seam with the other verdict", () => {
    let state = blisseyBoard("active", { burned: true });
    state = setActiveFromDeck(state, "p2", "sv01-096");
    expectErr(state, nurse(), "ABILITY_DISABLED");
    expect(conditionsOf(state, "p1")?.burned).toBe(true);
  });
});

describe("the structural questions", () => {
  it("PARK? NO. PERSIST? NO — MATCH_RECORD_VERSION stays 11", () => {
    const done = mustApply(blisseyBoard("active", { burned: true }), nurse());
    const active = done.state.players.p1.active;
    if (active === null) throw new Error("no Active");
    expect(Object.keys(active.conditions).sort()).toEqual([
      "burned",
      "confusionDamage",
      "poisonDamage",
      "rotation",
    ]);
    expect(Object.keys(active)).not.toContain("statusRecovery");
    expect(programFor("sv01-145")?.abilities?.[0]?.program).toEqual([{ op: "clearStatus" }]);
  });

  it("the op is FIELD-FREE, and that is D104's minimal shape rather than an oversight", () => {
    expect(deriveAttackEffect(MIRACLE_FORCE)).toEqual([{ op: "clearStatus" }]);
    expect(Object.keys((deriveAttackEffect(MIRACLE_FORCE) ?? [])[0] ?? {})).toEqual(["op"]);
    expect(ALL_STATUSES).toHaveLength(5);
  });

  it("§11: NOT gated by a defender's block — the op touches only the attacker", () => {
    const state = gardevoir({ burned: true });
    expect(state.players.p1.active?.attackBlock).toBeNull();
    expect(conditionsOf(swing(state, "miracleForce").state, "p1")?.burned).toBe(false);
  });

  it("MECHANISM DID NOT EXIST — and the measurement is the ENTRY POINT, not the clear", () => {
    expect(deriveAttackEffect(MIRACLE_FORCE)).toEqual([{ op: "clearStatus" }]);
    expect(programFor("sv01-145")?.abilities?.[0]?.program).toEqual([{ op: "clearStatus" }]);
  });

  it("never mutates the input state (both entry points, frozen boards)", () => {
    const gard = gardevoir({ burned: true });
    expect(() =>
      applyAction(deepFreeze(gard), { type: "attack", seat: "p1", index: 0 }),
    ).not.toThrow();
    const bliss = blisseyBoard("active", { burned: true });
    expect(() => applyAction(deepFreeze(bliss), nurse())).not.toThrow();
  });
});

describe("the boards stay legal", () => {
  it("keeps every uid in exactly one zone across a recovery from both entry points", () => {
    const count = (s: GameState, seat: Seat): number => {
      const side = s.players[seat];
      return (
        side.deck.length +
        side.hand.length +
        side.discard.length +
        side.prizes.length +
        (side.active === null ? 0 : side.active.stack.length + side.active.energy.length) +
        side.bench.reduce((n, p) => n + p.stack.length + p.energy.length, 0)
      );
    };
    const gard = gardevoir({ burned: true, poisonDamage: 10 });
    const afterAttack = swing(gard, "miracleForce").state;
    const bliss = blisseyBoard("bench", { burned: true });
    const afterAbility = mustApply(bliss, nurse(benchSlot(bliss, "p1", "sv01-145"))).state;
    for (const seat of ["p1", "p2"] as const) {
      expect(count(afterAttack, seat)).toBe(count(gard, seat));
      expect(count(afterAbility, seat)).toBe(count(bliss, seat));
    }
  });

  it("a recovery on a DAMAGED body leaves the damage exactly where it was", () => {
    // §12 and §8 are different ledgers: recovering from Poison removes the
    // CONDITION, never the counters it already placed. The engine has no site that
    // could confuse them, which is precisely why the claim is cheap to pin.
    let state = blisseyBoard("active", { poisonDamage: 20, burned: true });
    state = setDamage(state, "p1", 70);
    const done = mustApply(state, nurse());
    expect(done.state.players.p1.active?.damage).toBe(70);
    expect(conditionsOf(done.state, "p1")?.poisonDamage).toBe(0);
  });
});
