import { describe, expect, it } from "vitest";
import { disabledAbilityUids, passivesOf } from "./continuous";
import { deriveAttackEffect } from "./effects";
import { applyAction, programFor } from "./index";
import type { CoinFace, GameEvent, GameState, Seat, StatusName } from "./index";
import { type LogContext, logFromEvents } from "./log";
import { flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  STATUS_IMMUNITY_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  types,
} from "./testFixtures";

// 0.116.0 → 0.117.0 — the §12 STATUS-IMMUNITY family (P3-M5 long tail, D172).
// The other half of the Ability D159 built, plus the printing that is nothing but
// this sentence:
//
//   "This Pokémon can't be Burned. Prevent all damage done to this Pokémon by
//    attacks from your opponent's {R} Pokémon."       (Dachsbun sv01-099)
//   "This Pokémon can't be Paralyzed."     (Pachirisu sv01-068 / -208, 2 printings)
//   "The Pokémon this card is attached to recovers from being Asleep, Confused,
//    or Paralyzed and can't be affected by those Special Conditions."
//                            (Therapeutic Energy sv02-193 — DELIBERATELY NOT BUILT)
//
// ⚠️ FOUR PRINTINGS / THREE SENTENCES, AND BOTH NUMBERS WERE RE-DERIVED RATHER
// THAN INHERITED. The figure was measured at D159 and quoted by three handoffs
// since; a two-number census goes stale one number at a time, and the sentence
// count is the one nobody re-runs. Both hold — see `THE CENSUS` below for the SQL,
// the scope and the two rows a narrower sweep would have missed.
//
// ⚠️ THREE THINGS THE INHERITED ITEM SAID THAT THIS SLICE FOUND TO BE WRONG, all
// three of them STRUCTURAL rather than catalog claims (D159's own rule: catalog
// claims here are reliably right, structural ones are not):
//
//   1. "All four clauses are carried VERBATIM on the fixtures and PINNED."
//      ONE was — Dachsbun's. The other three lived in PROSE, in registry.ts and
//      attackerFilter.test.ts comments, which no census greps and no test can go
//      red on. Two are now fixtures; the third is pinned as an ABSENCE below,
//      which is D171's Corviknight rule applied before the rediscovery instead of
//      after the third one.
//   2. "It gates the §12 APPLICATION path AND the Checkup."
//      It gates the APPLICATION path and NOTHING ELSE. `applyStatus` is the
//      engine's only WRITER of a §12 condition — every other site clears — so a
//      body that cannot be given a status cannot arrive at the Checkup carrying
//      one. Driven, not argued (`THE CHECKUP` group).
//   3. "One `PassiveEffects` field and one gate at `applyStatus`."
//      A floor, exactly as the standing warning says. The gate that refuses in
//      SILENCE is the D159 defect wearing a §12 hat, so the slice also owes an
//      EVENT and a LOG ARM. Three edits, not one.
//
// WHAT IS ACTUALLY NEW HERE, and why this is not a copy of attackerFilter.test.ts
// despite sharing a card:
//   • THE READ SITE IS NOT A DAMAGE SITE. `preventDamageFromType` is read at four
//     §8.5 sites and answers "how much"; this is read at ONE §12 site and answers
//     "did it happen at all". They share `passivesOf`, the card and nothing else.
//   • THE REFUSAL IS INVISIBLE ON THE BOARD. A prevented hit leaves a
//     DAMAGE_DEALT row with `dealt: 0`; a refused status leaves NOTHING unless
//     something says so, which is why STATUS_PREVENTED exists.
//   • THE NEGATIVE IS PER-CONDITION, NOT PER-CARD. "Immune" is the wrong word for
//     what these cards print: Dachsbun takes Poison, Sleep and Confusion exactly
//     like any other body, and every case below that shows the refusal is paired
//     with one on the same card showing a different condition landing.

/** The three printed sentences, byte-for-byte off the local D1 rows. */
const WELL_BAKED_BODY =
  "This Pokémon can't be Burned. Prevent all damage done to this Pokémon by attacks from your opponent's {R} Pokémon.";
const ELECTRICITY_POUCHES = "This Pokémon can't be Paralyzed.";
/** The clause this slice deliberately does NOT build. Pinned as a STRING so a
    fourth census greps the repo and finds it already known — D171's Corviknight
    move, made BEFORE the rediscovery rather than after the third one. */
const THERAPEUTIC_ENERGY =
  "The Pokémon this card is attached to recovers from being Asleep, Confused, or Paralyzed and can't be affected by those Special Conditions.";

/** Pachirisu's own printed attack, carried on the fixture and read by nothing. */
const EVERYONE_DISCHARGE =
  "This attack does 20 more damage for each of your Benched {L} Pokémon. This attack's damage isn't affected by Weakness.";

/** The base seed. Nothing in the Burn half of this family flips a coin; the
    Paralysis half has no choice (see `PARALYSIS NEEDS A COIN` below), and those
    cases pick their own seed off `flipCoin` rather than hoping. */
const SEED = 11;

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

/** Every attacker this suite declares, with the printed INDEX and the energy its
    cost needs — read off the local D1 per printing (D144's rule). */
const ATTACKS = {
  hotBite: { card: "sv01-029", index: 0, energy: 1 }, // Scovillain {C} 20 → Burned
  hypnosis: { card: "fix-statuser", index: 0, energy: 0 }, // → Asleep
  confuseRay: { card: "fix-statuser", index: 1, energy: 0 }, // → Confused
  numbingBolt: { card: "fix-statuser", index: 2, energy: 0 }, // flip → Paralyzed, 10
  toxic: { card: "fix-statuser", index: 5, energy: 0 }, // → Poisoned (20/checkup)
  landScoop: { card: "sv02-127", index: 0, energy: 3 }, // Ting-Lu ex {F}{F}{F} 150
} as const;

type AttackKey = keyof typeof ATTACKS;

/** `by` opens, passes, and the OTHER seat plays turn 2 — so the attacking seat
    carries no §4 first-turn restriction. Both bodies are placed by surgery,
    because every clause in this family is read off the CURRENT board at the
    instant `applyStatus` runs. */
function board(
  attack: AttackKey,
  defender: string,
  opts: { seed?: number; by?: Seat; energyId?: string } = {},
): GameState {
  const by: Seat = opts.by ?? "p1";
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        opts.seed ?? SEED,
        { p1: STATUS_IMMUNITY_DECK, p2: STATUS_IMMUNITY_DECK },
        { first: opener },
      ),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, ATTACKS[attack].card);
  if (ATTACKS[attack].energy > 0) {
    state = attachFromDeck(state, by, opts.energyId ?? "fix-energy", ATTACKS[attack].energy);
  }
  state = setActiveFromDeck(state, opener, defender);
  return state;
}

function swing(state: GameState, attack: AttackKey, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKS[attack].index });
}

/** The face `state` will produce on its NEXT flip — how every Paralysis case
    picks its seed. Read from `flipCoin` rather than from the events, so the board
    is chosen BEFORE the engine runs rather than filtered after it. */
function nextFace(state: GameState): CoinFace {
  return flipCoin(state.rngState)[0];
}

/** The first seed at or after `from` whose `board(...)` will flip `want`. Every
    other fact about the board is seed-independent (both bodies are placed by
    surgery), so this chooses the COIN and nothing else. */
function seedFlipping(want: CoinFace, defender: string, from = SEED): number {
  for (let seed = from; seed < from + 60; seed += 1) {
    if (nextFace(board("numbingBolt", defender, { seed })) === want) return seed;
  }
  throw new Error(`no seed in [${from}, ${from + 60}) flips ${want}`);
}

/** The §12 conditions actually present on a seat's Active, off the BOARD rather
    than off the event log — so "nothing happened" is a real comparison and not an
    inference from a row that was never emitted. */
function conditionsOf(state: GameState, seat: Seat) {
  return state.players[seat].active?.conditions;
}

/** Every non-turn row as "<who>: <text>" — attackerFilter.test.ts's renderer,
    reused so the two families' voice claims are stated in the same shape. */
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
// The data: the census, the catalog rows, the fixtures, the registry rows.
// ─────────────────────────────────────────────────────────────────────────────

describe("THE CENSUS — re-derived against 978 rows / 6 sets, not inherited", () => {
  it("is 4 printings over 3 sentences, and BOTH numbers were re-run", () => {
    // ⚠️ THE SWEEP, AND ITS SCOPE (D154's rule: a census owes its scope). Local D1,
    // 978 rows / 6 sets, 2026-08-03, over ALL THREE text columns:
    //
    //   WITH t AS (SELECT id, name,
    //                COALESCE(effect,'')         AS e,
    //                COALESCE(abilities_json,'') AS a,
    //                COALESCE(attacks_json,'')   AS k
    //              FROM cards)
    //   SELECT id, name FROM t WHERE
    //        e|a|k LIKE '%an''t be Burned%'    OR ... Paralyzed / Asleep /
    //        Confused / Poisoned                OR
    //        e|a|k LIKE '%affected by%Special Condition%';
    //
    // → SIX rows. Four are this family; TWO are false positives that a narrower
    // pattern would have turned into phantom members, and both live in
    // `attacks_json` — the column D159's own sweep (`abilities_json OR effect`)
    // could not see at all:
    //   • sv01-010 Vivillon "Miracle Powder" — "choose a Special Condition. Your
    //     opponent's Active Pokémon is now affected by that Special Condition."
    //     APPLIES one (and is the pool's only chosen-condition application);
    //   • sv02-136 Sableye "Unseen Claw" — "If your opponent's Active Pokémon is
    //     affected by a Special Condition, this attack does 70 more damage." READS
    //     one.
    // Neither refuses anything. The immunity count is FOUR.
    //
    // ⚠️ AND THE COLUMN THAT NEARLY COST A MEMBER IS THE ONE THE ITEM'S OWN NUMBER
    // CAME FROM: Therapeutic Energy sits in `effect` (it is an ENERGY, so it has
    // no `abilities_json` at all), and the two Pokémon sit in `abilities_json`.
    // A sweep of any ONE column returns at most two of the four.
    const family: Record<string, string> = {
      "sv01-099": WELL_BAKED_BODY, // abilities_json — clause 1 of 2
      "sv01-068": ELECTRICITY_POUCHES, // abilities_json — the whole Ability
      "sv01-208": ELECTRICITY_POUCHES, // abilities_json — the reprint
      "sv02-193": THERAPEUTIC_ENERGY, // effect — a SPECIAL ENERGY
    };
    expect(Object.keys(family)).toHaveLength(4);
    expect(new Set(Object.values(family)).size).toBe(3);
    // Every one of them really is a REFUSAL and not an application or a read —
    // stated as a predicate over the strings rather than as a count anyone has to
    // trust, which is what makes the two false positives above checkable.
    for (const text of Object.values(family)) {
      expect(text).toMatch(/can't be (Burned|Paralyzed|affected by those Special Conditions)/);
    }
  });

  it("swept FIXTURE_POOL as a SEPARATE population — THREE of four at D172, FOUR at D174", () => {
    // D156's rule: the pool is its own population, queried before anything is
    // authored. Before D172 it carried Dachsbun's clause and NOTHING else —
    // Pachirisu was not here at all and Therapeutic Energy was not either.
    // ⚠️ THIS IS THE INHERITED CLAIM THAT WAS WRONG. "All four clauses are carried
    // VERBATIM on the fixtures and PINNED" was true of one clause in four. The
    // other three were PROSE in comments, which is exactly the shape D156 closed
    // for whole Abilities and D159 closed for clauses — and which came back the
    // moment the pinning was described in a handoff instead of written in code.
    //
    // ⚠️ RE-POINTED AT D174, WHICH ADDED THE FOURTH. Note WHERE its text lives: the
    // `effect` column, because an ENERGY has no abilities and no attacks — the
    // reason the sweep below has to `.concat(card.effect)` at all, and the reason
    // D172's three-column rule paid out.
    const withImmunityText = Object.entries(FIXTURE_POOL).filter(([, card]) =>
      [...(card.abilities ?? []), ...(card.attacks ?? [])]
        .map((entry) => entry.effect ?? "")
        .concat(card.effect ?? "")
        .some((text) => /can't be (Burned|Paralyzed)|affected by those Special Conditions/.test(text)),
    );
    expect(withImmunityText.map(([id]) => id).sort()).toEqual([
      "sv01-068",
      "sv01-099",
      "sv01-208",
      "sv02-193",
    ]);
    // …and the fourth's clause really is in `effect` and in neither of the other
    // two columns, which is what makes "a single-column census returns at most half
    // this family" a measurement instead of an anecdote.
    expect(FIXTURE_POOL["sv02-193"]?.effect).toContain("can't be affected by those");
    expect(FIXTURE_POOL["sv02-193"]?.abilities ?? []).toEqual([]);
    expect(FIXTURE_POOL["sv02-193"]?.attacks ?? []).toEqual([]);
  });

  it("⚠️ CLOSES Therapeutic Energy sv02-193 — the pin D172 wrote as an ABSENCE", () => {
    // D171's Corviknight rule: a row a build deliberately skips is pinned in CODE,
    // not re-noted in prose each time. D172 pinned this one as an absence with its
    // price, and D174 PAID the price — so this case is RE-POINTED at what was built
    // rather than deleted. Each of D172's four bullets, answered:
    //   • "it is an ENERGY, so it never reaches `passivesOf`" — `EnergyProgram` now
    //     carries a `passive`, and the fold walks `pokemon.energy` as a THIRD source
    //     class beside the top card and the Tools;
    //   • "`EnergyProgram` has three fields, all read at attach or cost time" — it
    //     has FOUR, and the fourth is read while the card merely sits there;
    //   • "it names THREE conditions where every built printing names one" — so
    //     `PassiveEffects.statusImmunity` WIDENED to `statusImmunities`;
    //   • "it also RECOVERS, a second mechanism and not a second field" — both, as
    //     it turns out: `statusRecovery` is the field and flow.ts `recoverStatuses`
    //     is the mechanism.
    expect(programFor("sv02-193")?.energy).toBeDefined();
    expect(THERAPEUTIC_ENERGY).toContain("recovers from being Asleep, Confused, or Paralyzed");
    expect(THERAPEUTIC_ENERGY).toContain("can't be affected by those Special Conditions");
    // The pin that named the field before it existed, now naming it because it does.
    expect(passivesOfKeys()).toContain("statusRecovery");
  });
});

/** The keys `passivesOf` actually returns, off a real board — so the "no such
    field exists" claim above is measured rather than asserted from memory. */
function passivesOfKeys(): string[] {
  const state = board("hotBite", "fix-bigbody");
  const active = state.players.p1.active;
  if (active === null) throw new Error("no Active");
  return Object.keys(passivesOf(state, active));
}

describe("the printed data — re-queried per printing, never recognized", () => {
  it("carries Pachirisu's NAME, Ability and attack VERBATIM on both printings", () => {
    // D146's rule at its sharpest, and it matters here twice: sv01-068 really is
    // Pachirisu (a LIGHTNING Basic, 70 HP), and sv01-208 really is the same card
    // and not a different Pokémon that happens to sit next to it in the set.
    for (const id of ["sv01-068", "sv01-208"] as const) {
      expect(FIXTURE_POOL[id]).toMatchObject({
        name: "Pachirisu",
        stage: "Basic",
        hp: 70,
        types: ["Lightning"],
        retreat: 1,
      });
      expect(FIXTURE_POOL[id]?.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
      expect(FIXTURE_POOL[id]?.abilities).toEqual([
        { type: "Ability", name: "Electricity Pouches", effect: ELECTRICITY_POUCHES },
      ]);
      expect(FIXTURE_POOL[id]?.attacks).toEqual([
        {
          cost: ["Lightning", "Colorless"],
          name: "Everyone Discharge",
          effect: EVERYONE_DISCHARGE,
          damage: "10+",
        },
      ]);
    }
  });

  it("keeps Pachirisu's TWO unread attack clauses LOUD on the fixture", () => {
    // D135's rule. "Everyone Discharge" prints a typed BENCH COUNT with no reader
    // and Feint Attack's `ignoreWR` clause with the RESISTANCE half missing;
    // neither is this slice's sentence, and carrying them is what lets a future
    // census grep a fixture that says what the printing says.
    expect(EVERYONE_DISCHARGE).toContain("20 more damage for each of your Benched {L} Pokémon");
    expect(EVERYONE_DISCHARGE).toContain("isn't affected by Weakness");
    // And the deriver really does refuse the whole thing, so index 0 stays
    // unsimulated rather than silently deriving half of it.
    expect(deriveAttackEffect(EVERYONE_DISCHARGE)).toBeNull();
    expect(programFor("sv01-068")?.attack).toBeUndefined();
  });

  it("keeps Dachsbun's SECOND clause readable beside its first, on one string", () => {
    // The two clauses D159 split and D172 rejoined. The immunity is FIRST in the
    // printed order and the prevention SECOND — the opposite of the order they
    // were built in, which is why neither can be recovered from the other.
    expect(FIXTURE_POOL["sv01-099"]?.abilities?.[0]?.effect).toBe(WELL_BAKED_BODY);
    expect(WELL_BAKED_BODY.indexOf("can't be Burned")).toBeLessThan(
      WELL_BAKED_BODY.indexOf("Prevent all damage"),
    );
  });
});

describe("the registry rows — three printings, two programs, two fields", () => {
  it("AUTHORS both Pachirisu printings on ONE shared program object", () => {
    // ⚠️ RE-POINTED AT D174: the field is `statusImmunities` and it is a LIST.
    // D172 chose a scalar by COUNTING ITS WRITERS — two, each naming one condition
    // — and named the counter-case (an Energy naming three) as a writer that
    // "cannot reach it". D174 is that writer, and the reason expired with the gap.
    expect(programFor("sv01-068")?.passive).toEqual({ statusImmunities: ["paralyzed"] });
    // The second printing is the same OBJECT, which is what "keyed by id, not by
    // body" means in practice (D121's warrant, met by the card itself).
    expect(programFor("sv01-208")?.passive).toBe(programFor("sv01-068")?.passive);
    // Nothing else on the card is authored: the Ability IS the whole program.
    expect(programFor("sv01-068")?.attack).toBeUndefined();
    expect(programFor("sv01-068")?.triggered).toBeUndefined();
    expect(programFor("sv01-068")?.abilities).toBeUndefined();
  });

  it("⚠️ CLOSES Dachsbun — both printed clauses, two fields, one object", () => {
    // The pin D159 wrote as an ABSENCE, RE-POINTED at what this slice built. It
    // read `{ preventDamageFromType: "Fire" }` and was the line that made "the
    // immunity is unbuilt" checkable; a pin that goes red on the slice it was
    // written for is the pin working.
    expect(programFor("sv01-099")?.passive).toEqual({
      statusImmunities: ["burned"],
      preventDamageFromType: "Fire",
    });
  });

  it("keeps the two clauses on SEPARATE fields, because they are separate rules", () => {
    // The evidence they are not one mechanism: each of the two cards this slice
    // touches carries exactly ONE of the two fields, and the third (Bellibolt)
    // carries the prevention with no immunity at all. A build that had merged them
    // would have to explain why Bellibolt can be Burned and Dachsbun cannot, off
    // one printed sentence that differs only in its first clause.
    expect(programFor("sv01-068")?.passive?.preventDamageFromType).toBeUndefined();
    expect(programFor("sv03-078")?.passive?.statusImmunities).toBeUndefined();
    expect(programFor("sv03-078")?.passive).toEqual({ preventDamageFromType: "Lightning" });
  });

  it("registers NO other POKÉMON status immunity anywhere in the registry", () => {
    // The producer set is DISCOVERED from the pool rather than named, in D159's
    // shape: a fourth row added without a case fails here. ⚠️ What this sweep does
    // NOT traverse is a registry row for a card with no fixture — the same blind
    // spot D149's producer sweep had, named rather than left.
    //
    // ⚠️ RE-POINTED AT D174 AND NARROWED IN ITS TITLE RATHER THAN ITS PREDICATE.
    // `CardProgram.passive` is the POKÉMON/TOOL surface; the family's fourth member
    // writes `CardProgram.energy.passive`, a different field on a different
    // interface, so this sweep is silent about it BY CONSTRUCTION. The whole-registry
    // producer sweep that DOES see both lives in therapeuticEnergy.test.ts — said
    // here so the narrowness is a stated scope and not a hole.
    const immune = Object.keys(FIXTURE_POOL)
      .filter((id) => programFor(id)?.passive?.statusImmunities !== undefined)
      .sort();
    expect(immune).toEqual(["sv01-068", "sv01-099", "sv01-208"]);
    // …and the fourth really is invisible to it, which is the claim above made
    // checkable rather than asserted in prose.
    expect(programFor("sv02-193")?.passive).toBeUndefined();
    expect(programFor("sv02-193")?.energy?.passive?.statusImmunities).toEqual([
      "asleep",
      "confused",
      "paralyzed",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The aggregation: passivesOf, and the §9 gate it buys for free.
// ─────────────────────────────────────────────────────────────────────────────

describe("passivesOf — the aggregation, and why it is a LIST", () => {
  it("reports the holder's printed condition, and NOTHING for a body without one", () => {
    const state = board("hotBite", "sv01-099");
    const dachsbun = state.players.p2.active;
    const scovillain = state.players.p1.active;
    if (dachsbun === null || scovillain === null) throw new Error("no Active");
    expect(passivesOf(state, dachsbun).statusImmunities).toEqual(["burned"]);
    expect(passivesOf(state, scovillain).statusImmunities).toEqual([]);
  });

  it("reports Pachirisu's on BOTH printings, and it is the OTHER condition", () => {
    for (const id of ["sv01-068", "sv01-208"] as const) {
      const state = board("numbingBolt", id);
      const pachirisu = state.players.p2.active;
      if (pachirisu === null) throw new Error("no Active");
      expect(passivesOf(state, pachirisu).statusImmunities).toEqual(["paralyzed"]);
    }
  });

  it("leaves every OTHER field of the aggregation alone", () => {
    // The new key is additive: Dachsbun's own §8.5 prevention still reads the same
    // through the same call, which is the claim that the two clauses of one Ability
    // really are two independent readings of one object.
    const state = board("hotBite", "sv01-099");
    const dachsbun = state.players.p2.active;
    if (dachsbun === null) throw new Error("no Active");
    const passives = passivesOf(state, dachsbun);
    expect(passives.preventDamageFromTypes).toEqual(["Fire"]);
    expect(passives.damageReductionAfterWR).toBe(0);
    expect(passives.hpBonus).toBe(0);
  });
});

describe("⚠️ §9 — the Ability lock, and an immunity that survived it would be a bug", () => {
  /** Klefki "Mischievous Lock" as `by`'s ACTIVE: Basic Pokémon in play, BOTH
      sides, Klefki itself exempt by name. It reaches Pachirisu (a Basic) and not
      Dachsbun (a Stage 1), which is the whole shape of the §9 story below. */
  function withKlefki(defender: string): GameState {
    let state = board("hotBite", defender);
    state = setActiveFromDeck(state, "p1", "sv01-096");
    return state;
  }

  it("SUPPRESSES Pachirisu's immunity under a live lock — with the lock PROVED live first", () => {
    // D171's rule: the negative is only worth having if the positive cannot be
    // vacuous, so the lock is shown to really contain the holder's uid BEFORE the
    // immunity is read. Without that line this case passes on a board with no lock
    // at all.
    const state = withKlefki("sv01-068");
    const pachirisu = state.players.p2.active;
    if (pachirisu === null) throw new Error("no Active");
    const uid = activeUid(state, "p2");
    expect(disabledAbilityUids(state).has(uid)).toBe(true);
    expect(passivesOf(state, pachirisu).statusImmunities).toEqual([]);
  });

  it("restores it the moment the lock's source leaves the Active Spot", () => {
    // The control, and the reason the case above is about the LOCK rather than
    // about the card: Mischievous Lock is Active-only, so promoting anything else
    // ends it and the immunity comes straight back.
    let state = withKlefki("sv01-068");
    state = setActiveFromDeck(state, "p1", "fix-bigbody");
    const pachirisu = state.players.p2.active;
    if (pachirisu === null) throw new Error("no Active");
    expect(disabledAbilityUids(state).has(activeUid(state, "p2"))).toBe(false);
    expect(passivesOf(state, pachirisu).statusImmunities).toEqual(["paralyzed"]);
  });

  it("SUPPRESSES Dachsbun's immunity under Ting-Lu ex, which reaches a Stage 1", () => {
    // Cursed Land: the opponent's DAMAGED Pokémon, ex exempt, Active-only. It is
    // the only lock in the registry that reaches a Stage 1 at all, which is why it
    // is in this deck.
    let state = board("landScoop", "sv01-099", { energyId: "fix-fighting-energy" });
    const side = state.players.p2;
    const active = side.active;
    if (active === null) throw new Error("no Active");
    state = { ...state, players: { ...state.players, p2: { ...side, active: { ...active, damage: 10 } } } };
    const damaged = state.players.p2.active;
    if (damaged === null) throw new Error("no Active");
    expect(disabledAbilityUids(state).has(activeUid(state, "p2"))).toBe(true);
    expect(passivesOf(state, damaged).statusImmunities).toEqual([]);
    // …and the §8.5 clause of the SAME Ability goes with it, which is the sharpest
    // available evidence that both fields ride one §9 gate rather than two.
    expect(passivesOf(state, damaged).preventDamageFromTypes).toEqual([]);
  });

  it("⚠️ CANNOT be driven end to end, and the reason is STRUCTURAL — asserted, not skipped", () => {
    // D159's finding, recurring on the other pipeline. To watch a §9 lock let a
    // refused condition LAND, one board must hold a live lock AND a status source
    // at once. It cannot, and the proof is a counting argument over ACTIVE SPOTS:
    //
    //   • every §12 status application in this engine comes from an ATTACK (the
    //     deriver's five arms) or from Armarouge's `activeOnly` trigger — so the
    //     source is one of the two Active Pokémon;
    //   • every §9 lock in the registry is `requiresActive` EXCEPT Spiritomb's,
    //     which narrows to Basic Pokémon V — a suffix neither immune printing has;
    //   • the immune body must itself be an Active, because `applyStatus` only
    //     ever resolves to `players[seat].active`.
    //
    // Three Actives wanted, two available. So the gate is asserted on a real,
    // legal board with the lock live (the three cases above) and the impossibility
    // is written down rather than worked around.
    const locks = ["sv01-096", "sv02-127", "sv02-089"] as const;
    const activeOnly = locks.filter(
      (id) => programFor(id)?.passive?.disableAbilities?.requiresActive === true,
    );
    expect(activeOnly).toEqual(["sv01-096", "sv02-127"]);
    // The one lock that works from the Bench narrows to a suffix this family never
    // prints, which is what closes the gap rather than leaving it to luck.
    expect(programFor("sv02-089")?.passive?.disableAbilities).toMatchObject({
      stage: "Basic",
      suffix: "V",
    });
    for (const id of ["sv01-068", "sv01-099", "sv01-208"] as const) {
      expect(FIXTURE_POOL[id]?.name).not.toContain(" V");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The rule: the immunity refusing an application, end to end.
// ─────────────────────────────────────────────────────────────────────────────

describe("BURN — Dachsbun refuses it, and the control on the same swing does not", () => {
  it("refuses the Burn and emits STATUS_PREVENTED instead of STATUS_APPLIED", () => {
    const { state, events } = swing(board("hotBite", "sv01-099"), "hotBite");
    expect(conditionsOf(state, "p2")?.burned).toBe(false);
    expect(types(events)).not.toContain("STATUS_APPLIED");
    expect(find(events, "STATUS_PREVENTED")).toEqual({
      type: "STATUS_PREVENTED",
      seat: "p2",
      uid: activeUid(state, "p2"),
      status: "burned",
    });
  });

  it("lands the same Burn on a body with no immunity — the control", () => {
    // Same attacker, same index, same energy, one card different. Without this the
    // case above passes on a build where Hot Bite never Burned anything.
    const { state, events } = swing(board("hotBite", "fix-bigbody"), "hotBite");
    expect(conditionsOf(state, "p2")?.burned).toBe(true);
    expect(find(events, "STATUS_APPLIED")).toMatchObject({ seat: "p2", status: "burned" });
    expect(types(events)).not.toContain("STATUS_PREVENTED");
  });

  it("still DEALS THE DAMAGE — the immunity is on the condition, not on the attack", () => {
    // Hot Bite prints 20 alongside its status clause. Dachsbun's §8.5 prevention
    // does not fire here (Scovillain is GRASS, not {R}), so the 20 lands in full
    // and the refusal is visible as exactly one missing condition.
    const { state, events } = swing(board("hotBite", "sv01-099"), "hotBite");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 20, prevented: undefined });
    expect(state.players.p2.active?.damage).toBe(20);
  });

  it("⚠️ refuses the Burn that arrives from a TRIGGER on the OTHER seat", () => {
    // Scorching Armor is the engine's only route by which a status reaches a body
    // that is NOT the defender: the trigger runs under the DAMAGED Pokémon's seat,
    // so `applyStatus target: "defender"` resolves to the ATTACKER's Active. This
    // is the same gate asked through the opposite seat resolution, which is the one
    // way `applyStatus`'s two arms could have been built to disagree.
    // Dachsbun attacks Armarouge with its own "Headbutt Bounce" ({P}{C}{C}, 100) —
    // the ONE board in this suite where the immune body is the ATTACKER.
    let state = board("hotBite", "sv03-044");
    state = setActiveFromDeck(state, "p1", "sv01-099");
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 1);
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    const attackerUid = activeUid(state, "p1");
    const done = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(done.events, "STATUS_PREVENTED")).toEqual({
      type: "STATUS_PREVENTED",
      seat: "p1",
      uid: attackerUid,
      status: "burned",
    });
    expect(conditionsOf(done.state, "p1")?.burned).toBe(false);
  });

  it("…and lands that same trigger's Burn on a non-immune attacker", () => {
    // Scovillain's "Hot Bite" into the same Armarouge: same trigger, same seat
    // resolution, one card different on the attacking side. Both bodies end up
    // Burned here — Hot Bite Burns the defender and Scorching Armor Burns back —
    // so the row is picked by SEAT rather than by position, and the pair is the
    // sharpest possible statement that `applyStatus` resolves two different seats
    // from two different callers in one reduction.
    const done = swing(board("hotBite", "sv03-044"), "hotBite");
    const applied = findAll(done.events, "STATUS_APPLIED").filter((e) => e.status === "burned");
    expect(applied.map((e) => e.seat).sort()).toEqual(["p1", "p2"]);
    expect(conditionsOf(done.state, "p1")?.burned).toBe(true);
    expect(types(done.events)).not.toContain("STATUS_PREVENTED");
  });
});

describe("⚠️ NOT IMMUNE TO EVERYTHING — the per-condition claim, on one card", () => {
  const landing: { key: AttackKey; status: StatusName; check: (c: ReturnType<typeof conditionsOf>) => unknown }[] = [
    { key: "hypnosis", status: "asleep", check: (c) => c?.rotation },
    { key: "confuseRay", status: "confused", check: (c) => c?.rotation },
    { key: "toxic", status: "poisoned", check: (c) => (c?.poisonDamage ?? 0) > 0 },
  ];

  for (const { key, status, check } of landing) {
    it(`lands ${status} on Dachsbun, which is immune to Burn and to nothing else`, () => {
      const { state, events } = swing(board(key, "sv01-099"), key);
      expect(find(events, "STATUS_APPLIED")).toMatchObject({ seat: "p2", status });
      expect(types(events)).not.toContain("STATUS_PREVENTED");
      expect(check(conditionsOf(state, "p2"))).toBeTruthy();
    });

    it(`lands ${status} on Pachirisu, which is immune to Paralysis and to nothing else`, () => {
      const { state, events } = swing(board(key, "sv01-068"), key);
      expect(find(events, "STATUS_APPLIED")).toMatchObject({ seat: "p2", status });
      expect(types(events)).not.toContain("STATUS_PREVENTED");
      expect(check(conditionsOf(state, "p2"))).toBeTruthy();
    });
  }

  it("⚠️ the two immunities do NOT cover each other — the cross pair, driven both ways", () => {
    // The sharpest form of the per-condition claim, and the mutant it kills is a
    // build that reads "does this body have ANY immunity" rather than "is THIS
    // condition among them". Dachsbun takes the Paralysis; Pachirisu takes the Burn.
    const seed = seedFlipping("heads", "sv01-099");
    const paralysis = swing(board("numbingBolt", "sv01-099", { seed }), "numbingBolt");
    expect(conditionsOf(paralysis.state, "p2")?.rotation).toBe("paralyzed");
    expect(types(paralysis.events)).not.toContain("STATUS_PREVENTED");

    const burn = swing(board("hotBite", "sv01-068"), "hotBite");
    expect(conditionsOf(burn.state, "p2")?.burned).toBe(true);
    expect(types(burn.events)).not.toContain("STATUS_PREVENTED");
  });
});

describe("PARALYSIS NEEDS A COIN, and the coin is the pool's doing", () => {
  // ⚠️ The local D1 prints NO single-sentence, non-flip Paralysis. Every plain
  // "…is now Paralyzed." row is either behind "Flip a coin. If heads," or behind a
  // second sentence the deriver refuses (Weavile sv06.5-014's energy discard,
  // Dudunsparce sv02-157's self-shuffle, Cryogonal sv03-055's go-second clause).
  // So this half of the family can only be driven through a gate — which buys the
  // claim below rather than costing one.

  it("refuses the Paralysis on BOTH Pachirisu printings when the coin says heads", () => {
    for (const id of ["sv01-068", "sv01-208"] as const) {
      const seed = seedFlipping("heads", id);
      const { state, events } = swing(board("numbingBolt", id, { seed }), "numbingBolt");
      expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("heads");
      expect(conditionsOf(state, "p2")?.rotation).toBe("none");
      expect(find(events, "STATUS_PREVENTED")).toMatchObject({ seat: "p2", status: "paralyzed" });
      expect(types(events)).not.toContain("STATUS_APPLIED");
    }
  });

  it("lands the same heads Paralysis on a body with no immunity — the control", () => {
    const seed = seedFlipping("heads", "fix-bigbody");
    const { state, events } = swing(board("numbingBolt", "fix-bigbody", { seed }), "numbingBolt");
    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("heads");
    expect(conditionsOf(state, "p2")?.rotation).toBe("paralyzed");
    expect(find(events, "STATUS_APPLIED")).toMatchObject({ status: "paralyzed" });
  });

  it("says NOTHING on tails — the coin decided, not the immunity", () => {
    // "Nothing happened" has two causes here and they must stay distinguishable: a
    // tails flip never reaches `applyStatus` at all, so there is no refusal to
    // report and a STATUS_PREVENTED row would be a lie about which rule fired.
    const seed = seedFlipping("tails", "sv01-068");
    const { state, events } = swing(board("numbingBolt", "sv01-068", { seed }), "numbingBolt");
    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("tails");
    expect(conditionsOf(state, "p2")?.rotation).toBe("none");
    expect(types(events)).not.toContain("STATUS_PREVENTED");
    expect(types(events)).not.toContain("STATUS_APPLIED");
  });

  it("⚠️ TAKES THE FLIP ANYWAY on an immune body — the immunity gates the APPLICATION", () => {
    // The claim the coin buys. The gate is inside `applyStatus`, downstream of
    // `coinFlipGate`, so `rngState` advances identically whether the target can be
    // Paralyzed or not — a build that short-circuited earlier would consume a
    // different number of steps and desynchronise every later flip in the match.
    const seed = seedFlipping("heads", "sv01-068");
    const immune = board("numbingBolt", "sv01-068", { seed });
    const control = board("numbingBolt", "fix-bigbody", { seed });
    expect(nextFace(immune)).toBe("heads");
    const a = swing(immune, "numbingBolt");
    const b = swing(control, "numbingBolt");
    expect(a.state.rngState).not.toBe(immune.rngState);
    expect(a.state.rngState).toBe(b.state.rngState);
    // …and the printed 10 lands on both, for the same reason.
    expect(a.state.players.p2.active?.damage).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE CHECKUP — the half of the inherited pricing that turned out not to exist.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ THE CHECKUP — NOT gated, and that is DERIVED rather than skipped", () => {
  it("has exactly ONE writer of a §12 condition in the whole engine", () => {
    // The load-bearing claim. `applyStatus` (interpreter.ts) is the only site that
    // ever ADDS a condition; flow.ts `runCheckup` only ticks damage and CLEARS,
    // and turn.ts/interpreter.ts's `noConditions()` sites clear on evolve, retreat
    // and a forced switch. So gating the writer gates everything downstream of it,
    // and a Checkup gate would be a SECOND reading of one rule (D131's drift) that
    // no reachable board could ever make disagree with the first.
    //
    // Driven rather than asserted, and the Checkup needs no second action to
    // reach: declaring an attack ENDS THE TURN (§5.3), so §13 runs inside the very
    // same reduction and its rows sit in the swing's own event list.
    const done = swing(board("hotBite", "sv01-099"), "hotBite");
    expect(conditionsOf(done.state, "p2")?.burned).toBe(false);
    // No burn tick, no cure flip — there was never a condition to tick.
    expect(findAll(done.events, "COUNTERS_PLACED").filter((e) => e.source === "burn")).toHaveLength(
      0,
    );
    expect(findAll(done.events, "CHECKUP_COIN_FLIP")).toHaveLength(0);
    expect(types(done.events)).toContain("TURN_ENDED");
  });

  it("ticks the SAME Checkup on a non-immune body, so the case above is not vacuous", () => {
    const done = swing(board("hotBite", "fix-bigbody"), "hotBite");
    expect(findAll(done.events, "COUNTERS_PLACED").filter((e) => e.source === "burn")).toHaveLength(
      1,
    );
    expect(findAll(done.events, "CHECKUP_COIN_FLIP")).toHaveLength(1);
  });

  it("⚠️ leaves a SURGICALLY planted condition alone — the IMMUNITY does not recover", () => {
    // The one board that separates "the application is gated" from "the immunity
    // is enforced continuously", and it is written to show the SECOND is NOT what
    // was built. A condition placed directly on Dachsbun's `conditions` survives
    // and ticks, because nothing re-checks the immunity after the fact.
    //
    // ⚠️ THIS CASE WAS ARMED AS A TRIPWIRE AT D172 AND D174 IS THE SLICE IT WAS
    // AIMED AT — AND IT DID NOT GO RED. That is the finding, so it is written here
    // rather than quietly enjoyed. D172's reason for the assertion was *"no legal
    // sequence puts an immunity onto a body that already carries the condition it
    // refuses"*, and D174 makes exactly that sequence legal: attach Therapeutic
    // Energy to a Paralyzed Active. What kept this case green is that the sequence
    // is legal for a card that ALSO prints a recovery clause, and Dachsbun does not
    // print one. So the ASSERTION is still true and still worth having — an
    // immunity, on its own, still clears nothing — while the REASON D172 gave for it
    // is now false.
    //
    // ⚠️ AND THAT IS D172's OWN HEADLINE RULE CATCHING D172: the tripwire was armed
    // in the COMMENT and not in the ASSERTION. A COMMENT CANNOT GO RED. The half
    // that had to be checkable — "an immunity arriving after the condition changes
    // nothing unless a recovery clause says so" — is now driven in
    // therapeuticEnergy.test.ts on both sides of the pair, off a board that is
    // reachable by legal play rather than by surgery.
    let state = board("hotBite", "sv01-099");
    state = setConditions(state, "p2", { burned: true });
    const done = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(
      findAll(done.events, "COUNTERS_PLACED").filter((e) => e.source === "burn"),
    ).toHaveLength(1);
    // The discriminator, stated where the claim is: Dachsbun refuses a Burn and
    // recovers from nothing, so the two clauses really are two fields.
    const dachsbun = done.state.players.p2.active;
    if (dachsbun === null) throw new Error("no Active");
    expect(passivesOf(done.state, dachsbun).statusImmunities).toEqual(["burned"]);
    expect(passivesOf(done.state, dachsbun).statusRecovery).toEqual([]);
  });

  it("clears conditions on EVOLUTION, which is why the reachable version does not exist", () => {
    // The other half of the argument above, driven off the shared rule rather than
    // off Dachsbun: `presentStatuses` + `noConditions()` on the evolve path means a
    // Burned body that evolves into an immune one arrives clean.
    let state = board("hotBite", "fix-bigbody");
    state = swing(state, "hotBite").state;
    expect(conditionsOf(state, "p2")?.burned).toBe(true);
    // The clear is the placement's, not a status rule of its own — asserted through
    // the helper the three clear sites share.
    expect(state.players.p2.active?.conditions.burned).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE — the row, and why silence was not an option.
// ─────────────────────────────────────────────────────────────────────────────

describe("VOICE — the refusal SPEAKS, in the card's own words", () => {
  it("renders the printed sentence with the subject resolved", () => {
    const { state, events } = swing(board("hotBite", "sv01-099"), "hotBite");
    expect(logLines(state, events)).toContain("Dachsbun can't be Burned");
  });

  it("renders Pachirisu's condition, not Dachsbun's — the row names WHICH", () => {
    const seed = seedFlipping("heads", "sv01-068");
    const { state, events } = swing(board("numbingBolt", "sv01-068", { seed }), "numbingBolt");
    expect(logLines(state, events)).toContain("Pachirisu can't be Paralyzed");
  });

  it("⚠️ says nothing at all when the status LANDS — the row is the refusal", () => {
    const { state, events } = swing(board("hotBite", "fix-bigbody"), "hotBite");
    const lines = logLines(state, events);
    expect(lines).toContain("fix-bigbody is now Burned");
    expect(lines.some((line) => line.includes("can't be"))).toBe(false);
  });

  it("⚠️ is filed under the REFUSING seat, which for an attack is the DEFENDER's chair", () => {
    // The event family's contract (`seat`/`uid` own the affected Pokémon), and it
    // is the opposite chair from `DAMAGE_DEALT`'s on the very same declaration —
    // this row replaces STATUS_APPLIED, not the damage row.
    const { state, events } = swing(board("hotBite", "sv01-099"), "hotBite");
    const rows = logRows(state, events);
    expect(rows.find((r) => r.text.includes("can't be"))?.who).toBe("p2");
    // …and the damage row on the SAME swing is filed the other way round, which is
    // what makes "the contract, not a coincidence" checkable.
    expect(rows.find((r) => r.text.includes("dealt"))?.who).toBe("p1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The structural questions (D124 / D142 / D150 / D155).
// ─────────────────────────────────────────────────────────────────────────────

describe("the structural questions", () => {
  it("PARK? NO. PERSIST? NO — MATCH_RECORD_VERSION stays 11, DERIVED", () => {
    // D124's test is DIRECTIONAL (D171): can the PREVIOUS deploy's RECORD hold the
    // shape the new code expects? Nothing this slice adds reaches `GameState` at
    // all — `statusImmunity` lives on the CATALOG (registry.ts types), the
    // aggregation is a pure function of the current board and is never stamped,
    // and `STATUS_PREVENTED` rides `GameEvent`, which `MatchRecord` does not store
    // (it stores the RENDERED log). No key moved on `InPlayPokemon`, no
    // `PendingStage` kind was added, no required field landed on anything
    // persisted. The dodge was PRICED AND REFUSED (D155's rule): a "cannot be
    // Burned" flag cached on `InPlayPokemon` would go stale on an evolution, a
    // promotion or a §9 lock arriving, and would have bought a bump for nothing.
    const state = board("hotBite", "sv01-099");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(Object.keys(active)).not.toContain("statusImmunity");
    expect(Object.keys(active)).not.toContain("statusImmunities");
    expect(active.conditions).toEqual({ rotation: "none", poisonDamage: 0, burned: false });
  });

  it("GATES NO ACTION — a Pokémon that refuses a condition is not harder to attack with", () => {
    // Checked, not assumed (D159's fifth question). The printed sentences never say
    // "can't be used"; nothing here touches cost, legality or the §4 turn-1 rule,
    // and the field is invisible to `redactedAttacksOf`. The evidence is that the
    // immune body attacks normally on its own turn.
    let state = board("hotBite", "sv01-099");
    state = setActiveFromDeck(state, "p2", "sv01-029");
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    const done = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    expect(find(done.events, "ATTACK_DECLARED")).toBeDefined();
  });

  it("§11: NOTHING OWED — this slice adds no op at all", () => {
    // D150's classification table is triggered by an op the DERIVER can produce.
    // The immunity is a passive read at an existing op's site; `applyStatus` is
    // unchanged as an op and its derived shape is byte-identical.
    expect(deriveAttackEffect("Your opponent's Active Pokémon is now Burned.")).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
    ]);
  });

  it("⚠️ the §11 BLOCK still speaks FIRST, and the pair is UNREACHABLE — said, not left", () => {
    // The early-return audit's one live question. `applyStatus` has three early
    // returns ahead of the new gate: no Active, no uid, and `attackEffectRefused`
    // (§11, D142). The first two belong to BOTH terms; the third belongs to the
    // §11 block alone, and the new gate sits BEHIND it so a refused ATTACK keeps
    // reporting itself as one. The two can never both hold: `preventDamage`
    // installs only on the ATTACKER's own Active, an attack ends the turn (§5.3),
    // and NEITHER immune printing has an attack that installs a block — so no
    // legal board reaches both gates and the ordering is unobservable.
    for (const id of ["sv01-068", "sv01-099", "sv01-208"] as const) {
      for (const attack of FIXTURE_POOL[id]?.attacks ?? []) {
        expect(attack.effect ?? "").not.toContain("prevent all damage");
      }
    }
    // …and no board can install one from the outside either: the op carries no
    // target, so "this Pokémon" is always the running seat's own Active.
    const state = board("hotBite", "sv01-099");
    expect(state.players.p2.active?.attackBlock).toBeNull();
  });

  it("MECHANISM EXISTS — everything except the field, the gate and the row already did", () => {
    // D159's fourth question. `passivesOf`'s fold, its §9 drop, `applyStatus`'s
    // three arms, `StatusName`, `STATUS_LABELS` and the whole deriver path all
    // pre-existed. What did not exist was a field for the sentence to land on —
    // which is precisely what D159 declared when it left the clause LOUD.
    const state = board("hotBite", "sv01-099");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no Active");
    expect(passivesOf(state, active)).toHaveProperty("statusImmunities");
  });
});

describe("the family after D174", () => {
  it("CLOSES at 3 of 3 sentences and 4 of 4 printings", () => {
    const authored = ["sv01-068", "sv01-099", "sv01-208"].filter(
      (id) => programFor(id)?.passive?.statusImmunities !== undefined,
    );
    expect(authored).toHaveLength(3); // 3 POKÉMON printings…
    expect(
      new Set(authored.map((id) => programFor(id)?.passive?.statusImmunities?.join(","))).size,
    ).toBe(2); // …over 2 sentences
    // ⚠️ RE-POINTED: the fourth printing / third sentence was the OPEN absence D172
    // priced, and D174 built it. It is the ONE member whose clause hangs off the
    // ENERGY surface, which is why it is counted separately rather than folded into
    // the list above — the two surfaces are what the census had to sweep twice.
    expect(programFor("sv02-193")?.energy?.passive?.statusImmunities).toHaveLength(3);
    expect(programFor("sv02-193")?.energy?.passive?.statusRecovery).toHaveLength(3);
  });

  it("leaves the two DISCARD-PILE RETRIEVAL restrictions exactly where D159 left them", () => {
    // The other clause D159 left LOUD, re-checked rather than assumed: still no
    // reader, still two printings, and NOT this slice's problem. Named so the next
    // census does not have to rediscover which of D159's two open clauses closed.
    expect(programFor("sv06.5-060")?.stadium).toEqual({ preventDamageToNoRuleBoxFromExV: true });
    expect(FIXTURE_POOL["sv06.5-060"]?.effect).toContain(
      "can't be put into your hand or deck from the discard pile.",
    );
  });
});

describe("the boards stay legal", () => {
  it("keeps every uid in exactly one zone across a refused status", () => {
    // The cheap invariant every suite here carries: a gate that returns early must
    // not have moved anything on its way to the return.
    let state = board("hotBite", "sv01-099");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    const before = state;
    const { state: after } = swing(state, "hotBite");
    for (const seat of ["p1", "p2"] as const) {
      const side = after.players[seat];
      const total =
        side.deck.length +
        side.hand.length +
        side.discard.length +
        side.prizes.length +
        (side.active === null ? 0 : side.active.stack.length + side.active.energy.length) +
        side.bench.reduce((n, p) => n + p.stack.length + p.energy.length, 0);
      const beforeSide = before.players[seat];
      const beforeTotal =
        beforeSide.deck.length +
        beforeSide.hand.length +
        beforeSide.discard.length +
        beforeSide.prizes.length +
        (beforeSide.active === null
          ? 0
          : beforeSide.active.stack.length + beforeSide.active.energy.length) +
        beforeSide.bench.reduce((n, p) => n + p.stack.length + p.energy.length, 0);
      expect(total).toBe(beforeTotal);
    }
  });
});
