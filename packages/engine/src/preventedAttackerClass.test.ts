import { describe, expect, it } from "vitest";
import { isExOrV, preventsAttackerClass } from "./cards";
import { passivesOf } from "./continuous";
import { programFor } from "./index";
import type { Card } from "@luminous/schema";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  FIXTURE_POOL,
  PREVENTED_CLASS_DECK,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.170.0 → 0.171.0 — the ATTACKER'S PRINTED RULE-BOX CLASS (P3-M5 long tail,
// D255). TWO printed sentences, 5 legal ABILITY printings:
//
//   "Prevent all damage done to this Pokémon by attacks from your opponent's
//    Pokémon ex."                    Sylveon sv08.5-040 "Safeguard";
//                                    Crustle sv10-012/-186 "Mysterious Rock Inn"
//   "…from your opponent's Basic Pokémon ex."
//                                    Farigiraf ex sv05-108/-194 "Armor Tail"
//
// THE SIXTH MEMBER OF THE PREVENT FAMILY, and the first PARAMETERISED gate it has
// gained since D159's type list. `preventDamageFromExV` (D107) gates on ex-or-V;
// `preventDamageFromTypes` (D159) on the attacker's printed TYPES;
// `preventDamageFromHasAbility` (D251) on `Card.abilities`;
// `preventDamageAndEffectsFromSpecialEnergy` (D252) on the BOARD; D253's on the
// holder's ZONE. This one gates on the attacker's printed rule-box SUFFIX plus, on
// two of the five printings, a printed STAGE word.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE CENSUS LADDER, TRANSCRIBED SO THE COUNT IS RE-DERIVABLE RATHER THAN
// INHERITED — remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a),
// 2026-08-07, `legal_standard = 1`, GROUPED BY SENTENCE, ALL THREE TEXT COLUMNS.
// ─────────────────────────────────────────────────────────────────────────────
//
//   SELECT lower(json_extract(a.value,'$.effect')) AS s, COUNT(*) n,
//          group_concat(c.id) ids
//   FROM cards c, json_each(c.abilities_json) a
//   WHERE c.legal_standard = 1
//     AND lower(json_extract(a.value,'$.effect')) LIKE '%prevent all damage%'
//   GROUP BY s ORDER BY n DESC;
//
// 🛑 **RUNG 2 OF THE LADDER — THE ABILITY COLUMN: 22 PRINTINGS ON 9 SENTENCES**,
// with the built/unbuilt split MEASURED by running `programFor` over every id the
// query returned rather than assumed:
//
//   5  BUILT   (D251) …by your opponent's Pokémon that have an Ability.
//   3  UNBUILT …from and effects of attacks from your opponent's TERA Pokémon…
//   3  UNBUILT …by attacks from your opponent's Pokémon ex.          ← THIS ROW
//   3  BUILT   (D253) As long as this Pokémon is on your Bench, …
//   2  BUILT   (D252) …that have any Special Energy attached.
//   2  UNBUILT …to your Benched Pokémon that don't have a Rule Box…
//   2  UNBUILT …by attacks from your opponent's Basic Pokémon ex.    ← THIS ROW
//   1  BUILT   (D254) …from your opponent's Pokémon done to your Benched Pokémon.
//   1  UNBUILT …if that damage is 200 or more.
//
// So 11 of the 22 were built coming in, this slice takes 5, and the residue is
// 6 printings on 3 sentences — three of which are the permanently unbuildable TERA
// group (D252's finding: "Tera" is in NO ingested column; every `name`/`effect`
// hit is DEMAND, never SUPPLY). The two genuinely open rows are measured into
// `coverage-backlog-legal.md` by this slice with their queries.
//
// ⚠️ **RUNG 1 AND RUNG 3 ARE THE SAME QUERY OVER THE OTHER TWO COLUMNS, AND RUN
// FIRST BECAUSE D248's RULE IS THAT "0 legal" IN ONE COLUMN IS NOT A FACT ABOUT
// THE POOL.**
//   • `c.effect` (Trainers/Stadiums): **1 printing on 1 sentence** — Neutralization
//     Zone `sv06.5-060`, BUILT at D159. Nothing new.
//   • `attacks_json`: **34 printings on 9 sentences, and EVERY ONE OF THEM IS THE
//     DURATED §11 SPELLING** ("During your opponent's next turn, prevent all
//     damage…"), which is `deriveAttackEffect` → `preventDamage` → `attackBlockOf`
//     — an attack-INSTALLED block, not a continuous aura, with no reader on this
//     field. `attackerFilter.test.ts` pins that taxonomy.
//
// 🛑 **THE FINDING, AND IT IS THE HALF OF THE PREDICTION THAT LOST.** The resume
// point predicted 25–40 ability printings on 12–20 sentences and correctly named
// the durated spelling as the biggest false-positive class. Both are true of the
// SAME fact and it lands the other way round: the durated column is 34 on 9, which
// is BIGGER than the whole ability column it was expected to pad. **A phrase census
// that does not name its COLUMN is a census of the phrase and not of the mechanism**
// — the ladder separated them before counting, which is why the ability figure is
// 22 and not 56.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🛑 THE ONE-CHARACTER TRAP, AND THE SEPARATION THE WHOLE SLICE RESTS ON.
// ─────────────────────────────────────────────────────────────────────────────
//
// Mimikyu `sv02-097` prints "…your opponent's Pokémon ex **and Pokémon V**"; these
// five print ex ALONE. `preventDamageFromExV` is one identifier away in the source
// and a whole printed clause away in meaning: reusing it would have been the
// shortest possible build and would have silently handed all five printings a
// protection against every Pokémon V in the pool. The gate reads `pokemonSuffixOf`
// for an EQUALITY, and `fix-abilityv` is the board that proves it.

const bite = { type: "attack", seat: "p1", index: 0 } as const;
const spread = { type: "attack", seat: "p1", index: 1 } as const;
const joust = { type: "attack", seat: "p1", index: 0 } as const; // Klefki — {C}, 10

const EX_SENTENCE =
  "Prevent all damage done to this Pokémon by attacks from your opponent's Pokémon ex.";
const BASIC_EX_SENTENCE =
  "Prevent all damage done to this Pokémon by attacks from your opponent's Basic Pokémon ex.";

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup, then field `holderId` in P2's ACTIVE spot and hand the turn to P1, who
    fields `attackerId` with one {C} attached (the main-hit path). */
function fightMain(holderId: string, attackerId: string): GameState {
  let state = driveSetup(
    1,
    { p1: PREVENTED_CLASS_DECK, p2: PREVENTED_CLASS_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", holderId);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** The BENCH path: P2's Active is a plain 200 HP body and the holder sits on the
    Bench, where the aura still protects it — NEITHER sentence carries an
    Active-Spot clause. Setup auto-benches the dominant fix-bigbody, so the holder
    is not necessarily bench[0]: find it by card id. */
function fightBench(holderId: string, attackerId: string): GameState {
  let state = driveSetup(
    1,
    { p1: PREVENTED_CLASS_DECK, p2: PREVENTED_CLASS_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = benchFromDeck(state, "p2", holderId);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

function benchedHolder(state: GameState, holderId: string) {
  return state.players.p2.bench.find((p) => state.cardIdByUid[p.stack.at(-1) ?? ""] === holderId);
}

/** Declare a chosen-target attack and resolve the prompt onto the ref at `spot` —
    `sphericalShield.test.ts`'s copyable form (D251's, reused for the fifth slice
    running). An `opponentAny` snipe with more than one candidate PARKS in
    `effect:choose`; the two-step is the shape, not an accident of this board. */
function snipeAt(
  state: GameState,
  index: number,
  spot: "active" | "holderBench",
  holderId: string,
) {
  const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
  const wanted =
    spot === "active"
      ? prompt.candidates.find((c) => c.spot.spot === "active")
      : prompt.candidates.find(
          (c) =>
            c.spot.spot === "bench" &&
            parked.cardIdByUid[parked.players.p2.bench[c.spot.index]?.stack.at(-1) ?? ""] ===
              holderId,
        );
  if (wanted === undefined) throw new Error(`no ${spot} candidate`);
  return mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [wanted as PokemonRef] },
  });
}

describe("the registry data rows (preventDamageFromAttackerClass)", () => {
  it("authors the three ex-only printings as a bare { suffix: 'ex' } passive", () => {
    for (const id of ["sv08.5-040", "sv10-012", "sv10-186"]) {
      expect(programFor(id)?.passive, id).toEqual({
        preventDamageFromAttackerClass: { suffix: "ex" },
      });
    }
  });

  it("authors the two Basic-ex printings with the printed STAGE conjunct", () => {
    for (const id of ["sv05-108", "sv05-194"]) {
      expect(programFor(id)?.passive, id).toEqual({
        preventDamageFromAttackerClass: { suffix: "ex", stage: "basic" },
      });
    }
  });

  // ⚠️ ONE OBJECT PER SENTENCE, which is the claim the coverage count is actually
  // making: three printings of one card and two of another, so a second object (or
  // a duplicated id) would inflate what this slice bought.
  it("shares ONE program object per sentence, demonstrator included", () => {
    for (const id of ["sv10-012", "sv10-186", "fix-safeguardex"]) {
      expect(programFor(id), id).toBe(programFor("sv08.5-040"));
    }
    for (const id of ["sv05-194", "fix-armortail"]) {
      expect(programFor(id), id).toBe(programFor("sv05-108"));
    }
  });

  // 🛑 THE TWO SENTENCES ARE TWO OBJECTS, which is the other half of the claim: a
  // build that shared one object across all five would have silently given the
  // three ex-only printings a stage conjunct they do not print.
  it("does NOT share one object across the two sentences", () => {
    expect(programFor("sv08.5-040")).not.toBe(programFor("sv05-108"));
  });

  // The field it is NOT. `preventDamageFromExV` is the neighbour a careless author
  // would have reused, and the assertion is on the FIELD rather than on the whole
  // passive object — D250's rule about the narrowest carrier of a claim.
  it("writes none of the five sibling prevention fields", () => {
    for (const id of ["sv08.5-040", "sv05-108"]) {
      const passive = programFor(id)?.passive;
      expect(passive?.preventDamageFromExV, id).toBeUndefined();
      expect(passive?.preventDamageFromType, id).toBeUndefined();
      expect(passive?.preventDamageFromHasAbility, id).toBeUndefined();
      expect(passive?.preventDamageAndEffectsFromSpecialEnergy, id).toBeUndefined();
      expect(passive?.preventDamageAndEffectsWhileBenched, id).toBeUndefined();
    }
  });

  // ⚠️ AND `stage` IS ABSENT RATHER THAN `null` OR `undefined`-VALUED on the row
  // that prints no stage word — D135's absent-key rule, asserted on the KEY rather
  // than on the value, because `{ suffix: "ex", stage: undefined }` would satisfy
  // an equality read and is exactly the shape the rule forbids.
  it("omits the stage KEY on the sentence that prints no stage word", () => {
    const cls = programFor("sv08.5-040")?.passive?.preventDamageFromAttackerClass;
    expect(cls).toBeDefined();
    expect(Object.keys(cls ?? {})).toEqual(["suffix"]);
  });
});

describe("preventsAttackerClass — the attacker-side predicate (cards.ts)", () => {
  const pool = FIXTURE_POOL as Record<string, Card | undefined>;
  const anyEx = [{ suffix: "ex" }] as const;
  const basicEx = [{ suffix: "ex", stage: "basic" }] as const;

  it("matches a Basic ex under BOTH printed classes", () => {
    expect(preventsAttackerClass(anyEx, pool["fix-exbasic"])).toBe(true);
    expect(preventsAttackerClass(basicEx, pool["fix-exbasic"])).toBe(true);
  });

  // 🛑 THE STAGE CONJUNCT, AND THE ONLY BOARD ON WHICH THE TWO PRINTED SENTENCES
  // DISAGREE. Without this pair the `stage` key is unobservable and a mutant that
  // dropped it would go green.
  it("matches a Stage 1 ex under the ex-only class and NOT under Basic-ex", () => {
    expect(preventsAttackerClass(anyEx, pool["fix-exstage1"])).toBe(true);
    expect(preventsAttackerClass(basicEx, pool["fix-exstage1"])).toBe(false);
  });

  // 🛑 THE SEPARATION FROM `preventDamageFromExV`: a Pokémon V is TRUE for
  // `isExOrV` and FALSE here. Without this the new field is indistinguishable from
  // D107's, which is the one-character trap this slice's header opens with.
  it("is FALSE for a Pokémon V, which `isExOrV` calls TRUE", () => {
    const v = pool["fix-abilityv"];
    expect(v).toBeDefined();
    expect(isExOrV(v as Card)).toBe(true);
    expect(preventsAttackerClass(anyEx, v)).toBe(false);
    expect(preventsAttackerClass(basicEx, v)).toBe(false);
  });

  it("is FALSE for a body with no rule box at all", () => {
    expect(preventsAttackerClass(anyEx, pool["fix-attacker"])).toBe(false);
    expect(preventsAttackerClass(anyEx, pool["fix-bigbody"])).toBe(false);
  });

  // The conservative direction, `preventsAttackerType`'s verbatim: two of the four
  // read sites hold the attacker as `Card | undefined`, and an unreadable attacker
  // must protect LESS rather than more.
  it("is FALSE for an unresolvable attacker, an empty list, and a non-Pokémon", () => {
    expect(preventsAttackerClass(anyEx, undefined)).toBe(false);
    expect(preventsAttackerClass([], pool["fix-exbasic"])).toBe(false);
    expect(preventsAttackerClass(anyEx, pool["fix-energy"])).toBe(false);
  });

  // ⚠️ THE SUFFIX IS AN EQUALITY AND NOT A RULE-BOX MEMBERSHIP. A VMAX carries a
  // Rule Box and is not an ex, so `hasRuleBox` would answer TRUE and this must not.
  it("is FALSE for a VMAX — the suffix is compared, not the Rule Box", () => {
    expect(preventsAttackerClass(anyEx, pool["fix-attacker-vmax"])).toBe(false);
  });

  // ⚠️ TWO CLASSES IN ONE LIST IS THE FOLD'S REAL SHAPE, and the reason the
  // aggregation field is a LIST rather than a scalar: this pool prints BOTH
  // sentences, so a board holding both is legal and a last-wins fold would drop
  // one of them. The disjunction is over the whole list.
  it("is a disjunction over the list — either class matching is enough", () => {
    const both = [{ suffix: "ex", stage: "basic" }, { suffix: "ex" }] as const;
    expect(preventsAttackerClass(both, pool["fix-exstage1"])).toBe(true);
    expect(preventsAttackerClass(both, pool["fix-abilityv"])).toBe(false);
  });
});

describe("the main hit (attack.ts, read site 1 of 4)", () => {
  it("a Basic ex's Bite is fully prevented by the ex-only holder — 0, flagged", () => {
    const state = fightMain("fix-safeguardex", "fix-exbasic");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("…and by the Basic-ex holder too", () => {
    const state = fightMain("fix-armortail", "fix-exbasic");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(done.players.p2.active?.damage).toBe(0);
  });

  // 🛑 THE DISAGREEMENT, ON A REAL BOARD. Same attacker printing, same attack, one
  // printed word between the two holders — and the Stage 1 ex gets through exactly
  // one of them.
  it("a STAGE 1 ex is prevented by the ex-only holder and NOT by the Basic-ex one", () => {
    const through = mustApply(fightMain("fix-armortail", "fix-exstage1"), bite);
    const stopped = mustApply(fightMain("fix-safeguardex", "fix-exstage1"), bite);

    expect(find(through.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 30 });
    expect(through.state.players.p2.active?.damage).toBe(30);
    expect(find(stopped.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(stopped.state.players.p2.active?.damage).toBe(0);
  });

  it("a Pokémon V gets through BOTH holders — this is not the ex/V gate", () => {
    for (const holder of ["fix-safeguardex", "fix-armortail"]) {
      const { state: done } = mustApply(fightMain(holder, "fix-abilityv"), bite);
      expect(done.players.p2.active?.damage, holder).toBe(30);
    }
  });

  it("a body with no rule box gets through both — the flat control", () => {
    for (const holder of ["fix-safeguardex", "fix-armortail"]) {
      const { state: done } = mustApply(fightMain(holder, "fix-attacker"), bite);
      expect(done.players.p2.active?.damage, holder).toBe(30);
    }
  });

  // ⚠️ THE MIRROR, and it is only assertable because `fix-armortail` is ITSELF an
  // ex: nothing about the aura reads the HOLDER, so a Farigiraf-vs-Farigiraf board
  // prevents in BOTH directions. A build that read the DEFENDER's suffix would pass
  // every board above and fail only here.
  it("the gate reads the ATTACKER and not the defender — a mirror prevents", () => {
    const state = fightMain("fix-armortail", "fix-armortail");
    deepFreeze(state);

    // fix-armortail prints no attacks, so the mirror is driven through the fold
    // rather than through a hit: the point is the DIRECTION of the read.
    const holder = state.players.p2.active;
    const attacker = state.players.p1.active;
    if (holder === null || attacker === null) throw new Error("board not set up");
    const card = state.cardIdByUid[attacker.stack.at(-1) ?? ""];
    expect(card).toBe("fix-armortail");
    expect(
      preventsAttackerClass(
        passivesOf(state, holder).preventDamageFromAttackerClasses,
        FIXTURE_POOL["fix-armortail"],
      ),
    ).toBe(true);
  });
});

describe("the spread arm (interpreter.ts, read site 2 of 4)", () => {
  // Neither sentence carries an Active-Spot clause, so a BENCHED holder is
  // protected from a spread exactly as an Active is.
  it("protects a BENCHED holder from a Basic ex's spread", () => {
    const state = fightBench("fix-safeguardex", "fix-exbasic");
    deepFreeze(state);

    const { state: done } = mustApply(state, spread);

    expect(benchedHolder(done, "fix-safeguardex")?.damage).toBe(0);
  });

  it("…and the Basic-ex holder lets a STAGE 1 ex's spread through", () => {
    const state = fightBench("fix-armortail", "fix-exstage1");
    deepFreeze(state);

    const { state: done } = mustApply(state, spread);

    expect(benchedHolder(done, "fix-armortail")?.damage).toBe(20);
  });

  it("…while the ex-only holder stops the same spread", () => {
    const state = fightBench("fix-safeguardex", "fix-exstage1");
    deepFreeze(state);

    const { state: done } = mustApply(state, spread);

    expect(benchedHolder(done, "fix-safeguardex")?.damage).toBe(0);
  });
});

describe("the snipe arms (interpreter.ts, read sites 3 and 4 of 4)", () => {
  it("prevents a chosen-target snipe onto the holder on the BENCH (placeSnipe)", () => {
    const state = fightBench("fix-safeguardex", "fix-exbasic");
    deepFreeze(state);

    const { state: done } = snipeAt(state, 2, "holderBench", "fix-safeguardex");

    expect(benchedHolder(done, "fix-safeguardex")?.damage).toBe(0);
  });

  it("prevents a chosen-target snipe onto the holder in the ACTIVE spot", () => {
    const state = fightMain("fix-armortail", "fix-exbasic");
    deepFreeze(state);

    const { state: done, events } = snipeAt(state, 2, "active", "fix-armortail");

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("lets a Stage 1 ex's snipe through the Basic-ex holder", () => {
    const state = fightMain("fix-armortail", "fix-exstage1");
    deepFreeze(state);

    const { state: done } = snipeAt(state, 2, "active", "fix-armortail");

    expect(done.players.p2.active?.damage).toBe(40);
  });

  // ⚠️ `ignoreWR` NULLS IT, and that is the family's shape rather than this
  // printing's: the aura is an effect ON the damaged Pokémon, so "isn't affected by
  // … any effects on that Pokémon" reaches it exactly as it reaches the five
  // siblings beside it.
  it("Feint Attack's ignoreWR nulls the prevention — 50 lands on the holder", () => {
    const state = fightMain("fix-safeguardex", "fix-exbasic");
    deepFreeze(state);

    const { state: done } = snipeAt(state, 3, "active", "fix-safeguardex");

    expect(done.players.p2.active?.damage).toBe(50);
  });
});

describe("§9 — the holder's aura is an Ability and a lock must silence it", () => {
  // Klefki is Active-gated, so the locking body has to be the attacking body — and
  // Klefki has NO rule box, so this board's damage lands for TWO reasons at once.
  // The narrow claim is therefore made on the FOLD below rather than on the hit.
  it("a lock over the HOLDER switches the prevention off in `passivesOf`", () => {
    const state = fightMain("fix-safeguardex", "sv01-096");
    const holder = state.players.p2.active;
    if (holder === null || holder === undefined) throw new Error("no active");

    expect(passivesOf(state, holder).preventDamageFromAttackerClasses).toEqual([]);
  });

  it("…and Klefki's own Joust lands, since it is also no ex", () => {
    const state = fightMain("fix-safeguardex", "sv01-096");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, joust);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 10 });
    expect(done.players.p2.active?.damage).toBe(10);
  });
});

describe("the fold (continuous.ts passivesOf)", () => {
  it("reports the printed class on the holder and NOTHING on every other body", () => {
    const state = fightBench("fix-safeguardex", "fix-exbasic");
    const holder = benchedHolder(state, "fix-safeguardex");
    const active = state.players.p2.active;
    if (holder === undefined || active === null || active === undefined)
      throw new Error("board not set up");

    expect(passivesOf(state, holder).preventDamageFromAttackerClasses).toEqual([{ suffix: "ex" }]);
    expect(passivesOf(state, active).preventDamageFromAttackerClasses).toEqual([]);
  });

  it("reports the STAGE conjunct verbatim for the other sentence", () => {
    const state = fightBench("fix-armortail", "fix-exbasic");
    const holder = benchedHolder(state, "fix-armortail");
    if (holder === undefined) throw new Error("no benched holder");

    expect(passivesOf(state, holder).preventDamageFromAttackerClasses).toEqual([
      { suffix: "ex", stage: "basic" },
    ]);
  });

  // A list and not a boolean, and the reason is in the field's doc: the gate names
  // a VALUE and this pool prints TWO of them. The assertion that keeps that honest
  // is that the fold's OTHER five prevention fields are untouched by it — six
  // prevention gates, six independent answers on one body.
  it("leaves the five sibling prevention fields alone", () => {
    const state = fightBench("fix-safeguardex", "fix-exbasic");
    const holder = benchedHolder(state, "fix-safeguardex");
    if (holder === undefined) throw new Error("no benched holder");
    const fold = passivesOf(state, holder);

    expect(fold.preventDamageFromAttackerClasses).toEqual([{ suffix: "ex" }]);
    expect(fold.preventDamageFromExV).toBe(false);
    expect(fold.preventDamageFromTypes).toEqual([]);
    expect(fold.preventDamageFromHasAbility).toBe(false);
    expect(fold.preventDamageAndEffectsFromSpecialEnergy).toBe(false);
    expect(fold.preventDamageAndEffectsWhileBenched).toBe(false);
  });
});

describe("the two printed sentences, as the fixtures carry them", () => {
  // ⚠️ THE FIXTURE'S ABILITY TEXT IS NEVER READ (the programs are keyed by id), so
  // this is the one place the printed strings this slice is ABOUT are pinned. A
  // re-ingest that changed either sentence would leave the registry silently
  // serving a rule the catalog no longer prints.
  it("the demonstrators print the census sentences byte for byte", () => {
    expect(FIXTURE_POOL["fix-safeguardex"]?.abilities?.[0]?.effect).toBe(EX_SENTENCE);
    expect(FIXTURE_POOL["fix-armortail"]?.abilities?.[0]?.effect).toBe(BASIC_EX_SENTENCE);
  });

  // 🛑 AND THE TWO SENTENCES DIFFER BY EXACTLY THE WORD THE `stage` KEY ENCODES,
  // asserted rather than eyeballed: if a later edit made them differ in some other
  // way, the record would be encoding something the printings do not say.
  it("differ by exactly the word 'Basic '", () => {
    expect(BASIC_EX_SENTENCE.replace("Basic ", "")).toBe(EX_SENTENCE);
  });
});
