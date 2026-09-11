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
} from "./testFixtures";

// 0.119.0 → 0.120.0 — the DISCRETE `recovers from all Special Conditions` family
// (P3-M5 long tail, D177). ONE new op (`clearStatus`), TWO entry points:
//
//   "This Pokémon recovers from all Special Conditions."
//        (Gardevoir ex sv01-086 / -228 / -245 "Miracle Force" — an ATTACK)
//   "Once during your turn, you may use this Ability. Your Active Pokémon
//    recovers from all Special Conditions."
//        (Blissey sv01-145 "Busybody Nurse" — an activated ABILITY)
//
// ⚠️ FOUR PRINTINGS / TWO SENTENCES, AND BOTH NUMBERS WERE RE-DERIVED RATHER THAN
// INHERITED (D174 measured them in passing; this slice re-ran the query). See
// `THE CENSUS` below for the SQL, the scope, and the FIFTH row the wider verb
// turned up that is NOT this family.
//
// ⚠️ HOW THIS FAMILY WAS MISSED FOR FIFTEEN DECISIONS, WHICH IS THE FINDING THIS
// FILE EXISTS TO KEEP: **A CENSUS IS ONLY AS WIDE AS ITS VERBS.** Every sweep of
// the §12 family since D159 matched "can't be affected" / "can't be {condition}".
// The COLUMN coverage was right — all three text columns, D172's own rule — and
// the PREDICATE was short by one `LIKE '%recovers from%'`, which returns four
// printings nobody had counted. Column coverage is the axis this repo learned to
// check; verb coverage is the one it had not.
//
// WHAT IS ACTUALLY NEW HERE, and why this is not therapeuticEnergy.test.ts with a
// Pokémon:
//   • THE FIRST DISCRETE CLEAR THE ENGINE HAS EVER HAD FROM A PROGRAM. Before
//     this, every §12 clear was either a PLACEMENT (`noConditions()` on retreat /
//     evolve / switch) or a CHECKUP step. `clearStatus` is neither: it is an op an
//     attack or an Ability RUNS, at a moment the printed text names.
//   • IT IS THE OPPOSITE SIGN OF THE ONLY OTHER §12 WRITER. `applyStatus` has been
//     the engine's single writer of a condition since M3; this is its inverse, and
//     the two now sit side by side in the interpreter with the same resolution,
//     the same early returns and opposite directions.
//   • THE TWO HALVES ANSWER §9 DIFFERENTLY. An Ability-lock aura kills Busybody
//     Nurse and cannot touch Miracle Force — one op, one seat resolution, two
//     verdicts — which is the sharpest available statement that the SUPPRESSION
//     question belongs to the entry point and not to the op.
//   • THE ATTACK HALF CANNOT REACH TWO OF THE FIVE CONDITIONS IT NAMES, and that
//     is a property of §8 rather than of this slice (`THE UNREACHABLE HALF`).

/** The two printed sentences, byte-for-byte off the local D1 rows. */
const MIRACLE_FORCE = "This Pokémon recovers from all Special Conditions.";
const BUSYBODY_NURSE =
  "Once during your turn, you may use this Ability. Your Active Pokémon recovers from all Special Conditions.";

/** The FIFTH row `%recovers from%` returns, and it is NOT this family: the
    CONTINUOUS, NAMED-SET recovery D174 built as `PassiveEffects.statusRecovery`.
    Pinned here as a string so the next census greps the repo and finds the
    distinction already drawn (D171's Corviknight move). */
const THERAPEUTIC_ENERGY =
  "The Pokémon this card is attached to recovers from being Asleep, Confused, or Paralyzed and can't be affected by those Special Conditions.";

/** ⚠️ AND THE SIXTH, WHICH IS THE NEAR-MISS THE WIDENED VERB ACTUALLY FOUND. Muk
    sv01-127 "Poison Sacs" is the NEGATIVE form of this sentence — a modifier on
    §10's evolution clear, carrying no op and no moment of its own — and it is
    DELIBERATELY NOT BUILT (see effects.ts `SELF_RECOVERS_ALL`). Named rather than
    left, so a future census counts it once instead of rediscovering it. */
const POISON_SACS =
  "Your opponent's Poisoned Pokémon don't recover from that Special Condition when they evolve or devolve.";

/** The three printings of the ATTACK half. All three carry BYTE-IDENTICAL text,
    which is why one anchored deriver arm covers the family and only ONE of them
    (the base printing) has a registry row — and that row is for a different
    Ability entirely (`Psychic Embrace`). */
const GARDEVOIR_PRINTINGS = ["sv01-086", "sv01-228", "sv01-245"] as const;

/** The five §12 conditions, in the `presentStatuses` order. "All Special
    Conditions" is the printed quantifier over exactly this closed union — which
    is why the op carries no `statuses` field where `statusRecovery` must. */
const ALL_STATUSES: StatusName[] = ["asleep", "confused", "paralyzed", "poisoned", "burned"];

const SEED = 5;
const ACTIVE: PokemonTarget = { spot: "active" };

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

/** Every attacker this suite declares, with the printed INDEX read off the local
    D1 per printing (D144's rule). The `fix-statuser` indices are the fixture's
    own, verified against its `attacks` array. */
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
  return attachFromDeck(attachFromDeck(state, seat, "fix-psychic-energy", 2), seat, "fix-energy", 1);
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

/** The bench slot holding `cardId`, as a target. NEVER a hard-coded index: this
    pool's boards are built by surgery that pushes the setup starter onto the bench
    first, so "bench[0]" means whatever `driveSetup` happened to place — the exact
    wrong-index habit D173 spent a slice unwinding. `nth` picks among duplicates. */
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

// ─────────────────────────────────────────────────────────────────────────────
// THE CENSUS — re-derived, not inherited.
// ─────────────────────────────────────────────────────────────────────────────

describe("THE CENSUS", () => {
  // Local D1, 978 cards / 6 sets (sv01 258 / sv02 279 / sv03 230 / sv06.5 99 /
  // sve 24 / swsh10.5 88), 2026-08-04, over ALL THREE text columns:
  //
  //   select id, name from cards
  //    where lower(coalesce(effect,'')) like '%recovers from%'
  //       or lower(coalesce(abilities_json,'')) like '%recovers from%'
  //       or lower(coalesce(attacks_json,'')) like '%recovers from%';
  //   -- 5 rows: sv01-086 / sv01-228 / sv01-245 Gardevoir ex, sv01-145 Blissey,
  //   --         sv02-193 Therapeutic Energy
  //
  // FOUR of the five are this family (2 sentences); the fifth is D174's
  // CONTINUOUS, named-set recovery. Eight other spellings of the verb — "is
  // cured", "cured of", "removes all Special", "heal all Special", "no longer
  // affected", "recovered from", "is now cured", "recover from" outside Muk's
  // negative — return ZERO new rows, and `%special condition%` adds only three
  // unrelated readers (Vivillon sv01-010 inflicts one, Sableye sv02-136 scales
  // damage off one, Muk sv01-127 modifies the evolution clear). The family is
  // CLOSED at four printings on this catalog.
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
    expect(deriveAttackEffect(BUSYBODY_NURSE)).toBeNull(); // the ABILITY half — registry, not deriver
    // A mid-sentence clause and a lowercase subject: both are what `^This` plus
    // the absence of /i buys, and both are latent rather than live (no catalog row
    // prints either today), which is exactly when a guard is worth pinning.
    expect(deriveAttackEffect(`Discard an Energy from this Pokémon. ${MIRACLE_FORCE}`)).toBeNull();
    expect(deriveAttackEffect("this Pokémon recovers from all Special Conditions.")).toBeNull();
    expect(deriveAttackEffect("This Pokémon recovers from all Special Conditions")).toBeNull();
  });

  it("FIXTURE_POOL swept SEPARATELY: exactly four ids print the family's sentence", () => {
    // D172's rule — the pool is its own population, and a census that reads only
    // the catalog cannot see a fixture that carries a clause the card does not
    // (or, as this family found out at D174, a fixture that DROPS one it does).
    const carriers = Object.entries(FIXTURE_POOL)
      .filter(([, card]) => (card.attacks ?? []).some((a) => a.effect === MIRACLE_FORCE))
      .map(([id]) => id)
      .sort();
    expect(carriers).toEqual([...GARDEVOIR_PRINTINGS]);
    // …plus the one whose sentence is in the registry rather than on the card.
    expect(Object.keys(FIXTURE_POOL)).toContain("sv01-145");
  });

  it("ONE registry row for the whole family — the ATTACK half needs none", () => {
    // Blissey is the only card here `programFor` has to answer for. All three
    // Gardevoir printings DO have a registry row, and it is for `Psychic Embrace`
    // — proof that the attack half rides the deriver rather than that row.
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
    const cleared = find(done.events, "STATUS_CLEARED");
    expect(cleared).toMatchObject({ seat: "p1", statuses: ["poisoned", "burned"], reason: "recovered" });
    // The recovery is a RIDER, not a replacement: the attack's own damage is
    // untouched by it (fix-titan is 340 HP, so nothing dies and the number shows).
    expect(find(done.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 190 });
    expect(done.state.players.p2.active?.damage).toBe(190);
  });

  it("recovers from Confusion — on the HEADS branch of the §8 confusion check", () => {
    const seed = seedFlipping("heads", (s) => gardevoir({ rotation: "confused" }, { seed: s }));
    const done = swing(gardevoir({ rotation: "confused" }, { seed }), "miracleForce");
    expect(find(done.events, "CONFUSION_CHECK")).toMatchObject({ result: "heads" });
    expect(conditionsOf(done.state, "p1")?.rotation).toBe("none");
    expect(find(done.events, "STATUS_CLEARED")).toMatchObject({ statuses: ["confused"] });
  });

  it("⚠️ TAILS: the attack does not resolve, so the recovery does not happen either", () => {
    // §8 step 3 returns before the effect program is even looked up. This is the
    // sharpest statement available that the recovery is an EFFECT OF THE ATTACK
    // and not a property of declaring it — a Confused Gardevoir cannot cure its
    // own Confusion by trying, which is the printed rule and a live footgun for
    // anyone tempted to run the clear at declaration time.
    const seed = seedFlipping("tails", (s) => gardevoir({ rotation: "confused" }, { seed: s }));
    const done = swing(gardevoir({ rotation: "confused" }, { seed }), "miracleForce");
    expect(find(done.events, "ATTACK_FAILED")).toMatchObject({ reason: "confusion" });
    expect(conditionsOf(done.state, "p1")?.rotation).toBe("confused");
    expect(find(done.events, "STATUS_CLEARED")).toBeUndefined();
    expect(done.state.players.p1.active?.damage).toBe(30); // the confusion self-hit
  });

  it("ALL THREE PRINTINGS recover, driven — not just the one with the registry row", () => {
    for (const printing of GARDEVOIR_PRINTINGS) {
      const state = gardevoir({ burned: true }, { printing });
      const done = swing(state, "miracleForce");
      expect(conditionsOf(done.state, "p1")?.burned, `${printing} must recover`).toBe(false);
      expect(find(done.events, "STATUS_CLEARED")).toMatchObject({
        statuses: ["burned"],
        reason: "recovered",
      });
    }
  });

  it("driven END TO END: the opponent's Toxic lands, the next attack recovers it", () => {
    // No `setConditions` anywhere on this path. p1 opens and passes, p2's "Toxic"
    // Poisons Gardevoir for 20/checkup, the Checkup ticks it once, and p1's own
    // Miracle Force takes it off — so the condition, its damage and its removal
    // are all the engine's, and the ONE thing surgery placed is the energy.
    let state = driveSetup(
      SEED,
      { p1: CLEAR_STATUS_DECK, p2: CLEAR_STATUS_DECK },
      { first: "p1" },
    );
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
    expect(find(done.events, "STATUS_CLEARED")).toMatchObject({
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
    expect(find(done.events, "STATUS_CLEARED")).toBeUndefined();
    expect(conditionsOf(done.state, "p1")).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
    // The sentence WAS read — a derived program ran and found nothing — so the
    // unsimulated-text row must not fire (D139's distinction).
    expect(find(done.events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("touches ONLY the attacker — the DEFENDER keeps every condition it has", () => {
    // `clearStatus` reads `ctx.seat`, and an attack program's ctx.seat is the
    // ATTACKER's. The printed subject is "This Pokémon"; a `target` field guessed
    // at from one reading is what this case exists to refuse.
    let state = gardevoir({ burned: true });
    state = setConditions(state, "p2", { rotation: "asleep", poisonDamage: 10, burned: true, confusionDamage: 30 });
    const done = swing(state, "miracleForce");
    expect(conditionsOf(done.state, "p1")?.burned).toBe(false);
    const theirs = conditionsOf(done.state, "p2");
    expect(theirs?.rotation).toBe("asleep");
    expect(theirs?.poisonDamage).toBe(10);
    expect(theirs?.burned).toBe(true);
    expect(findAll(done.events, "STATUS_CLEARED")).toHaveLength(1);
  });

  it("the ROW is the card's own verb, filed under the seat that OWNS the body", () => {
    const done = swing(gardevoir({ burned: true }), "miracleForce");
    const row = logRows(done.state, done.events).find((r) => r.text.includes("recovered"));
    expect(row?.who).toBe("p1");
    expect(row?.text).toContain("recovered from");
    // One vocabulary word for one printed verb: the CONTINUOUS half (sv02-193)
    // renders through the same log arm, which is D131's widen-don't-add rule
    // holding on the read side as well as the write side.
    expect(logLines(done.state, done.events).filter((l) => l.includes("recovered"))).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ THE UNREACHABLE HALF — what the ATTACK entry point structurally cannot do.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ the ATTACK half cannot reach TWO of the five conditions it names", () => {
  // "All Special Conditions" is five, and Miracle Force can only ever remove
  // THREE of them. Asleep and Paralyzed are the §12 rotation states that block
  // DECLARING an attack (§8), so a Gardevoir carrying either never gets to run
  // its own recovery. This is not a gap in the op — it is the rulebook — and it
  // is asserted rather than left in a comment because it is exactly the kind of
  // claim a later slice would otherwise "fix" by moving the clear earlier.
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
      expect(find(done.events, "STATUS_CLEARED")).toMatchObject({
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
    expect(find(done.events, "STATUS_CLEARED")).toMatchObject({
      seat: "p1",
      statuses: ["confused", "burned"],
      reason: "recovered",
    });
    expect(find(done.events, "ABILITY_USED")).toMatchObject({ ability: "Busybody Nurse" });
  });

  it('⚠️ works from the BENCH — the print says "your Active Pokémon", not "this Pokémon"', () => {
    // The SUBJECT of the recovery and the BEARER of the Ability are two different
    // bodies (Exp. Share's shape, D171). `activeOnly: false` is what carries that,
    // and getting it wrong would have silently required Blissey to be the very
    // Pokémon it is meant to nurse — a card that could never do its own job.
    const state = blisseyBoard("bench", { poisonDamage: 10 });
    expect(state.players.p1.active?.stack).toBeDefined();
    const activeBefore = activeUid(state, "p1");
    const done = mustApply(state, nurse(benchSlot(state, "p1", "sv01-145")));
    expect(conditionsOf(done.state, "p1")?.poisonDamage).toBe(0);
    // The row names the ACTIVE (the body that recovered), not the bench Blissey.
    expect(find(done.events, "STATUS_CLEARED")?.uid).toBe(activeBefore);
    expect(find(done.events, "ABILITY_USED")?.uid).not.toBe(activeBefore);
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
    // `useAbility` refuses a program that could only whiff, and "the Active is
    // clean" is a public board fact of the Crushing Hammer shape. The gate is
    // deliberately NOT extended here (see the registry row): the printed sentence
    // names no precondition, exactly as Potion's does not. The use is legal, spends
    // the once-per-turn, and says nothing.
    const done = mustApply(blisseyBoard("active"), nurse());
    expect(find(done.events, "ABILITY_USED")).toBeDefined();
    expect(find(done.events, "STATUS_CLEARED")).toBeUndefined();
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
    expect(findAll(done.events, "STATUS_CLEARED")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE OP-REUSE DECISION — priced, then asserted.
// ─────────────────────────────────────────────────────────────────────────────

describe("the op does NOT reuse flow.ts `recoverStatuses`, and the board says why", () => {
  it("neither printing writes `statusRecovery` — there is no source for a sweep to read", () => {
    // `recoverStatuses` is driven off `passivesOf(...).statusRecovery`, a CATALOG
    // value contributed by a live CONTINUOUS source. Both bodies here fold to the
    // empty list, so a sweep over this board would clear nothing at all — and the
    // conditions come off anyway. That is reason (1) of the three: THE DRIVER IS
    // WRONG. Reusing the sweep would mean writing a synthetic passive onto the
    // board so a function could read it back off.
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
    // Reason (3): THE SET IS WRONG. `recoverStatuses` filters the present
    // conditions against the ones the SOURCE names — which is what makes a
    // Therapeutic Energy wake a body and leave its Burn ticking. "All Special
    // Conditions" names none, so `noConditions()` is the whole clear, and passing
    // an all-five list into a filter designed to narrow is a filter written to be
    // inert. Driven with a rotation state, Poison AND Burn on one body at once,
    // which is the maximum §12 can hold (one rotation slot).
    const done = mustApply(
      blisseyBoard("active", { rotation: "asleep", poisonDamage: 30, burned: true, confusionDamage: 30 }),
      nurse(),
    );
    expect(find(done.events, "STATUS_CLEARED")?.statuses).toEqual([
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
    // `recoverStatuses` is a two-seat board sweep restoring a board-wide
    // invariant. This op is one body named by the printed subject. Both halves are
    // asserted above to leave the opponent alone; here the claim is made about the
    // op's own shape — a single STATUS_CLEARED, whichever entry point ran it.
    let state = blisseyBoard("active", { burned: true });
    state = setConditions(state, "p2", { burned: true });
    expect(findAll(mustApply(state, nurse()).events, "STATUS_CLEARED")).toHaveLength(1);
  });

  it("ONE vocabulary word for one printed verb — both halves say `recovered`", () => {
    // What IS shared with the continuous half, and deliberately: the `reason`. The
    // card says "recovers" in both mouths, log.ts renders one row for both, and a
    // second reason would have been a second rendering of the same word (D131).
    const fromAttack = find(swing(gardevoir({ burned: true }), "miracleForce").events, "STATUS_CLEARED");
    const fromAbility = find(mustApply(blisseyBoard("active", { burned: true }), nurse()).events, "STATUS_CLEARED");
    expect(fromAttack?.reason).toBe("recovered");
    expect(fromAbility?.reason).toBe("recovered");
    // …and it is the reason D174 introduced, not a sixth one invented here.
    expect(["benched", "evolved", "wokeUp", "burnCured", "paralysisEnded"]).not.toContain(
      fromAttack?.reason,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — one op, two entry points, TWO ANSWERS to the Ability lock.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — the lock reaches the ABILITY half and cannot touch the ATTACK half", () => {
  it("⚠️ a live Klefki kills Gardevoir's Ability and leaves its ATTACK's recovery intact", () => {
    // The sharpest board this family can build, because it is ONE body: under a
    // live "Mischievous Lock" the very same Gardevoir ex is refused `Psychic
    // Embrace` (§9) and still recovers through `Miracle Force`. An attack is not
    // an Ability, so the suppression question belongs to the ENTRY POINT and not
    // to `clearStatus` — which is why no §9 check appears in the op at all.
    let state = gardevoir({ burned: true });
    state = setActiveFromDeck(state, "p2", "sv01-096"); // Klefki Active — the aura is Active-only
    expectErr(
      state,
      { type: "useAbility", seat: "p1", target: ACTIVE, abilityName: "Psychic Embrace" },
      "ABILITY_DISABLED",
    );
    const done = swing(state, "miracleForce");
    expect(conditionsOf(done.state, "p1")?.burned).toBe(false);
    expect(find(done.events, "STATUS_CLEARED")).toMatchObject({ reason: "recovered" });
  });

  it("…and it kills Busybody Nurse, which is the same seam with the other verdict", () => {
    // ⚠️ REACHABLE HERE BECAUSE THE FIXTURE IS A BASIC. Klefki's lock is
    // stage-gated ("Basic Pokémon"), and the printed Blissey is a Stage 1; this
    // pool simplifies every body to a Basic (declared in the fixture's doc block
    // and in `catalogManifest.test.ts`). So what this case measures is that the
    // ABILITY half rides the EXISTING §9 seam with nothing written for it — a
    // property of `useAbility`, which is stage-blind — and NOT a claim that a real
    // Klefki can lock a real Blissey. The case above needs no such caveat.
    let state = blisseyBoard("active", { burned: true });
    state = setActiveFromDeck(state, "p2", "sv01-096");
    expectErr(state, nurse(), "ABILITY_DISABLED");
    expect(conditionsOf(state, "p1")?.burned).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The structural questions (D124 / D142 / D150 / D155 / D159 / D169).
// ─────────────────────────────────────────────────────────────────────────────

describe("the structural questions", () => {
  it("PARK? NO. PERSIST? NO — MATCH_RECORD_VERSION stays 11", () => {
    // D124's test is DIRECTIONAL (D171): can the PREVIOUS deploy's RECORD hold the
    // shape the new code expects? A NEW OP is the case that usually forces a bump,
    // because a parked program lives inside `GameState.phase` — and this one CANNOT
    // park. `clearStatus` is synchronous, field-free and single-step: neither
    // producer wraps it in anything that parks (the attack derives it alone, the
    // Ability's program is exactly `[{ op: "clearStatus" }]`), so no record written
    // by the previous deploy can hold it and no record this deploy writes can
    // either. Nothing else reaches `GameState`: the op writes `conditions`, which
    // has held the same three keys since M1, and `STATUS_CLEARED` rides `GameEvent`,
    // which `MatchRecord` does not store (it stores the RENDERED log). The `reason`
    // union did not even widen — "recovered" already existed (D174).
    const done = mustApply(blisseyBoard("active", { burned: true }), nurse());
    const active = done.state.players.p1.active;
    if (active === null) throw new Error("no Active");
    // 🆕🆕🆕 D501 — `confusionDamage` is the FIRST key added to `SpecialConditions`
    // since P3-M3; the rung is widened rather than relaxed, so it still reddens on a
    // sixth key. `MATCH_RECORD_VERSION` 29 -> 30.
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
    // No `target`: both printed subjects resolve to `ctx.seat`'s Active. No
    // `statuses`: "all Special Conditions" is the printed quantifier over the
    // closed union, and the ONE printing in this catalog that names a SUBSET is a
    // different (continuous) mechanism with its own field. The day a printing says
    // "your opponent's Active Pokémon recovers…" is the day the field is warranted,
    // with two readings in hand rather than one guessed at.
    expect(deriveAttackEffect(MIRACLE_FORCE)).toEqual([{ op: "clearStatus" }]);
    expect(Object.keys((deriveAttackEffect(MIRACLE_FORCE) ?? [])[0] ?? {})).toEqual(["op"]);
    expect(ALL_STATUSES).toHaveLength(5);
  });

  it("§11: NOT gated by a defender's block — the op touches only the attacker", () => {
    // `attackEffectRefused` refuses effects done TO the body carrying a "prevent
    // all damage from and effects of attacks" block. This op touches the ATTACKER's
    // own Active, which is never that body (a block is live during its holder's
    // OPPONENT's turn, and `preventDamage` only ever installs on its own Active).
    // A gate here would ask the defender for permission to heal yourself.
    const state = gardevoir({ burned: true });
    expect(state.players.p1.active?.attackBlock).toBeNull();
    expect(conditionsOf(swing(state, "miracleForce").state, "p1")?.burned).toBe(false);
  });

  it("MECHANISM DID NOT EXIST — and the measurement is the ENTRY POINT, not the clear", () => {
    // D159's fourth question. The engine could already clear conditions (three
    // `noConditions()` placements and four Checkup steps) and could already
    // announce a "recovered" row (D174). What it had NEVER had is a PROGRAM that
    // clears: every clear before this was a placement or a phase step, reachable
    // only by moving a Pokémon or by ending a turn. The witness is that both new
    // producers are ops in an `EffectOp[]` — one derived, one authored.
    expect(deriveAttackEffect(MIRACLE_FORCE)).toEqual([{ op: "clearStatus" }]);
    expect(programFor("sv01-145")?.abilities?.[0]?.program).toEqual([{ op: "clearStatus" }]);
  });

  it("never mutates the input state (both entry points, frozen boards)", () => {
    const gard = gardevoir({ burned: true });
    expect(() => applyAction(deepFreeze(gard), { type: "attack", seat: "p1", index: 0 })).not.toThrow();
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
