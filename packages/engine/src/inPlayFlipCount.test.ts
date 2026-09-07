import type { Card } from "@luminous/schema";
import manifest from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { countPokemonInPlay } from "./interpreter";
import { flipCoin } from "./rng";
import type { CoinFace } from "./rng";
import { FIXTURE_POOL, basicEnergy, battler, deckOf, itemTrainer } from "./testFixtures";
import { makeInPlay } from "./types";

// 0.371.0 → 0.372.0 — 🆕🆕 D474: THE BOARD-COUNTED COIN FLIP OVER **BODIES**.
//
// ── THE PRINTED SENTENCE ─────────────────────────────────────────────────────
//   `censusAttackCorpus.ts` FILE LINE 233 — "Flip a coin for each {D} Pokémon you
//     have in play. This attack does 60 damage for each heads."   **2 printings**
//
// — 1 sentence / 2 Standard-legal printings, ONE anchor, ONE new `AttackFlipCount`
// member, ONE arm in `deriveAttackCoinFlip` and ONE arm in `attack.ts`'s `takeFlips`.
//
// 🛑 **THE SECOND BOARD FACT THE COIN FAMILY COUNTS BY.** D128 taught the family to
// read its flip count off the board rather than off the text, and every printing it
// could reach counts self-attached ENERGY. This one counts BODIES — Active + Bench,
// stack tops only, own side — through `countPokemonInPlay`, the walk the three
// `DamageCountSource.pokemonInPlay` anchors already fold over. Nothing about the
// consequent moves: the fold, the loop, the event sequence and the dropped printed
// base are all D127's.
//
// ── WHY IT IS A FOURTH MEMBER AND NOT A FIELD (D440, READ RATHER THAN COPIED) ──
// *Nullary or asymmetric payload ⇒ two members; identical payload ⇒ one member with
// the discriminator as a field.* `attachedEnergy` carries an ENERGY filter
// (`BasicEnergyType | "special" | null`, read by PROVISION when typed and by CARD
// when null) and this carries a `CardFilter` over BODIES — asymmetric, so two
// members. §2 pins that both members are still reachable and that they answer
// DIFFERENT numbers on one board.
//
// ── 🛑 THE `switch` IN `takeFlips`, AND THE MEASUREMENT THAT PAID FOR IT ───────
// `takeFlips` read the union as an early return plus a TERNARY. The work order said a
// member lacking `energy` would be a TYPE ERROR rather than a silent fall-through and
// flagged that as verified on an ISOMORPHIC REPRODUCTION only. **Re-run on the real
// file** — the fourth member added and nothing else changed — `bunx tsc -b` answers
// TS2339 at `count.energy`, three times. So the ternary really was loud.
//
// **It was loud for a reason that does not generalise, which is why the `switch` is
// owed anyway.** What refused was the FIELD ACCESS, not the discriminator: a member
// carrying an `energy` field of a compatible type would satisfy `count.energy` and
// fall SILENTLY into the self-attached reading. D222/D447: a total `switch` is the
// only thing that sees a new union member.
//
// 🆕🆕🛑 **D475 CORRECTS THE PREDICTION THIS PARAGRAPH USED TO CARRY.** It named
// corpus file line 231 — *"for each Energy attached to both Active Pokémon"* — as
// *"exactly that"* member. D475 built it and the member is **NULLARY**
// (`{ kind: "bothActivesEnergy" }`), because the printed sentence carries no type
// filter, so the old ternary would have answered TS2339 for it as well. Measured on
// the real file: with the ternary restored and `pokemonInPlay` peeled off the `:`
// branch, `tsc` names `{ kind: "bothActivesEnergy"; }` in the TS2339 text. **The rule
// stands, the forecast did not** — see `attack.ts`'s `takeFlips` block, corrected in
// place at the same commit.
//
// ── WHY THE ANCHOR SPELLS BOTH ENDS OUT (D472, MEASURED OVER ALL 640 ROWS) ────
// §1 runs FIVE widenings against the committed column rather than describing them,
// and **every one claims the identical 1 sentence / 2 printings**. A wider anchor
// that claims the same rows is pure risk. Because no widening admits a new ROW, none
// admits a new OP either — so D473's describer question has an empty subject here,
// which is stated rather than skipped.
//
// ── WHAT IS NOT NEW ──────────────────────────────────────────────────────────
// ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, prompt fields, events,
// error codes, `AttackCoinFlip`/`BoardCondition`/`CardFilter`/`DamageCountSource`
// members, clause-table rows, registry rows, `packages/schema` bytes, `redact.ts`
// bytes or `FIXTURE_POOL` ids. The reader surface stays 13. §6 is the
// `MATCH_RECORD_VERSION` argument, and it is the FIRST of D473's three shapes.

/** THE SENTENCE, byte for byte off `legalAttackCorpus()` — §1 asserts that. */
const PRINTED =
  "Flip a coin for each {D} Pokémon you have in play. This attack does 60 damage for each heads.";

/** The SHIPPED sibling this anchor must stay structurally disjoint from (D128, corpus
    file line 232, 1 printing). Both patterns are `^…$` and share the trailing run
    `. This attack does N damage for each heads.`; the mandatory bytes immediately
    before it disagree, so no string reaches both. */
const SIBLING_ENERGY =
  "Flip a coin for each Energy attached to this Pokémon. This attack does 80 damage for each heads.";

/** The THIRD member of the printed `Flip a coin for each …` family (corpus file line
    231, 1 printing) — and it is NOT this member's business. It counts ENERGY on two
    bodies, which no widening of a BODY count can reach. 🆕🆕 **D475 BUILT IT, on its
    OWN anchor and its OWN nullary `bothActivesEnergy` member — which is what this
    file predicted and is the reason the rung below was RE-POINTED rather than
    deleted (D418/D438): the claim that survives is *"`pokemonInPlay` did not widen to
    take it"*, and that is strictly stronger than the `toBeNull` it replaces.** */
const SIBLING_BOTH_ACTIVES =
  "Flip a coin for each Energy attached to both Active Pokémon. This attack does 60 damage for each heads.";

/** Every reader `censusAtHead.test.ts` sweeps with, so a sentence this file calls
    "unread" is unread by the WHOLE engine and not by the one reader it is about.
    ⚠️ SPLICED BEFORE THE LAST ENTRY RATHER THAN APPENDED where it ever grows, D419's
    rule — mutant `find` strings quote an array's last entries plus its closing `];`. */
const READERS: readonly ((t: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackDiscardScaledBoost,
];

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

describe("D474 §1 — the sentence, measured live over the legal column", () => {
  it("🛑 the hand-kept READERS list IS the module's reader surface, and it is 13", () => {
    // D417/D419's guard: a hand-kept copy of a module-derived surface cannot go red,
    // it can only go quiet, so the DIFF and the COUNT are pinned separately.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("is really in the column, ONCE, at TWO printings", () => {
    // The attribution control (D183/D456): without it every rung below could be green
    // against a paraphrase no card prints. The PRINTING COUNT is asserted too,
    // because it is what tells a file line from an array index in one look (D448).
    const rows = legalAttackCorpus().filter(([, s]) => s === PRINTED);
    expect([rows.length, units(rows)]).toEqual([1, 2]);
  });

  it("🛑 the whole `Flip a coin for each` family is THREE rows, and D475 read the last", () => {
    // D448's rule: write the "cannot see" sentence as a QUERY YOU RAN. The loosest
    // shape that can hold this mechanism is the leading clause itself.
    const family = legalAttackCorpus().filter(([, s]) => /Flip a coin for each/.test(s));
    expect(family.map(([, s]) => s).sort()).toEqual(
      [PRINTED, SIBLING_ENERGY, SIBLING_BOTH_ACTIVES].sort(),
    );
    expect([family.length, units(family)]).toEqual([3, 4]);
    // 🆕🆕 D475 — all THREE now read, and each through a DIFFERENT `AttackFlipCount`
    // member. Re-pointed onto the three derived VALUES rather than relaxed to three
    // `not.toBeNull()`s, because "each row is claimed" is true under a build where one
    // anchor swallowed its neighbour and the members collapsed (D438/D449).
    expect(deriveAttackCoinFlip(PRINTED)?.kind).toBe("perHeads");
    const members = [PRINTED, SIBLING_ENERGY, SIBLING_BOTH_ACTIVES].map((s) => {
      const read = deriveAttackCoinFlip(s);
      return read !== null && "flips" in read ? read.flips.kind : null;
    });
    expect(members).toEqual(["pokemonInPlay", "attachedEnergy", "bothActivesEnergy"]);
  });

  it("🛑 `deriveAttackCoinFlip` is its ONLY reader — the other TWELVE refuse it", () => {
    expect(deriveAttackCoinFlip(PRINTED)).not.toBeNull();
    for (const read of READERS) {
      if (read === deriveAttackCoinFlip) continue;
      expect(read(PRINTED), read.name).toBeNull();
    }
    // …and no splitter composes it either, so the whole-sentence anchor is the only
    // route in and the RAW and RESIDUE summands move together (D444/D457).
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
  });

  it("🛑 D464's COMPOUND route contributes nothing — no row is this sentence plus a tail", () => {
    // Building a sentence builds every `⟨it⟩. ⟨claimed tail⟩` compound with it, through
    // a path that is neither the anchor nor the arm. Measured over the whole column
    // rather than asserted: no row has this sentence as a prefix.
    const compounds = legalAttackCorpus().filter(
      ([, s]) => s !== PRINTED && s.startsWith(PRINTED),
    );
    expect(compounds).toEqual([]);
  });

  it("🛑 EVERY widening claims the IDENTICAL 1 sentence / 2 printings — pure RISK", () => {
    // D472's rule, at its third address, RUN rather than described. Five loosenings,
    // one axis each; every one of them buys nothing and every one costs a wrong
    // program or a wrong referent.
    const widenings: Record<string, RegExp> = {
      // …drop `you have`: `{D} Pokémon you have` becomes the captured noun on any
      // "in play" spelling, including an opponent-side one the print never carries.
      seat: /^Flip a coin for each ([^.]+) in play\. This attack does (\d+) damage for each heads\.$/,
      // …open the consequent: the count clause stops being pinned to a per-heads fold.
      consequent: /^Flip a coin for each ([^.]+) you have in play\. (.+)$/,
      // …admit `more`: a KEPT printed base rather than a dropped one, which is a
      // different member (`bonusOnHeads`) and a different damage on every board.
      more: /^Flip a coin for each ([^.]+) you have in play\. This attack does (\d+) (?:more )?damage for each heads\.$/,
      // …drop the `^`.
      caret: /Flip a coin for each ([^.]+) you have in play\. This attack does (\d+) damage for each heads\.$/,
      // …drop the `\.$`.
      dollar: /^Flip a coin for each ([^.]+) you have in play\. This attack does (\d+) damage for each heads\./,
      // …and open the noun across a sentence boundary.
      noun: /^Flip a coin for each (.+) you have in play\. This attack does (\d+) damage for each heads\.$/,
    };
    for (const [name, re] of Object.entries(widenings)) {
      const claimed = legalAttackCorpus().filter(([, s]) => re.test(s));
      expect([claimed.length, units(claimed)], name).toEqual([1, 2]);
      expect(claimed[0]?.[1], name).toBe(PRINTED);
    }
  });

  it("🛑 STRUCTURAL disjointness from `ATTACK_COIN_PER_ENERGY`, driven BOTH ways", () => {
    // D468's second kind of `equivalent`: both patterns are `^…$` and disagree on a
    // mandatory run of bytes at the same position, so no string can match both and NO
    // GUARD EXISTS — correctly none, since one would be unkillable by construction
    // (D467). Driven from each side rather than argued.
    expect(deriveAttackCoinFlip(SIBLING_ENERGY)).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: null },
      per: 80,
    });
    expect(deriveAttackCoinFlip(PRINTED)).toEqual({
      kind: "perHeads",
      flips: { kind: "pokemonInPlay", filter: { kind: "typedPokemon", pokemonType: "Darkness" } },
      per: 60,
    });
    // The two derived programs are DIFFERENT (D449: an inequality of derived programs
    // is strictly stronger than a `toBeNull`, and cannot go green by accident).
    expect(deriveAttackCoinFlip(PRINTED)).not.toEqual(deriveAttackCoinFlip(SIBLING_ENERGY));
    // …and the CROSSINGS — each sentence's head against the other's tail — reach
    // neither pattern, which is the byte-level claim spelled as a rung.
    for (const crossed of [
      "Flip a coin for each Energy attached to this Pokémon you have in play. This attack does 60 damage for each heads.",
      "Flip a coin for each {D} Pokémon you have in play attached to this Pokémon. This attack does 60 damage for each heads.",
    ]) {
      expect(deriveAttackCoinFlip(crossed), crossed).toBeNull();
    }
  });

  it("🛑 file line 231 is D475's row and NOT this member's — `pokemonInPlay` did not widen", () => {
    // 🆕🆕 **RE-POINTED, NOT FLIPPED (D438/D418).** The old rung said
    // `resolvedByAnyReader === false` — a thirteen-way refusal that D475 makes false.
    // Relaxing it to `=== true` would discard all thirteen refusals at once, which is
    // how D436 disarmed D368's tripwire and produced this run's only GAP. So the
    // replacement NAMES THE OWNER by value and KEEPS the other twelve refusals and
    // both splitters, which is strictly stronger than either boolean.
    expect(resolvedByAnyReader(SIBLING_BOTH_ACTIVES)).toBe(true);
    expect(deriveAttackCoinFlip(SIBLING_BOTH_ACTIVES)).toEqual({
      kind: "perHeads",
      flips: { kind: "bothActivesEnergy" },
      per: 60,
    });
    for (const read of READERS) {
      if (read === deriveAttackCoinFlip) continue;
      expect(read(SIBLING_BOTH_ACTIVES), read.name).toBeNull();
    }
    expect(splitAttackTrailingClause(SIBLING_BOTH_ACTIVES)).toBeNull();
    expect(splitAttackGateClause(SIBLING_BOTH_ACTIVES)).toBeNull();
    // 🛑 **THE DISCRIMINATION THE OLD CLAIM CARRIED, KEPT ON A NEW SUBJECT (D444).**
    // What the `toBeNull` really pinned was *"no widening of a BODY count reaches an
    // ENERGY count"*. That survives POSITIVELY and by VALUE: 231 derives through a
    // member of its OWN, so a build in which `ATTACK_COIN_PER_BODY_IN_PLAY` had been
    // loosened to swallow 231 reddens here — it would answer `pokemonInPlay` — where
    // the old boolean could not have told that build from the real one. The two
    // programs are UNEQUAL, which is D449's strictly-stronger form of a `toBeNull`.
    expect(deriveAttackCoinFlip(SIBLING_BOTH_ACTIVES)).not.toEqual(deriveAttackCoinFlip(PRINTED));
    expect(deriveAttackCoinFlip(SIBLING_BOTH_ACTIVES)).not.toEqual(
      deriveAttackCoinFlip(SIBLING_ENERGY),
    );
  });
});

describe("D474 §2 — the derived value, and every refusal pinned on ONE printed byte", () => {
  it("resolves `{D}` through the SHARED body vocabulary, not a local table", () => {
    // `inPlayBodyFilter` is the one place this file resolves a printed body noun, so
    // "which bodies does this noun name" keeps ONE answer across two unions (D159).
    // Both notations, because that map carries both since D367.
    expect(deriveAttackCoinFlip(PRINTED)).toEqual({
      kind: "perHeads",
      flips: { kind: "pokemonInPlay", filter: { kind: "typedPokemon", pokemonType: "Darkness" } },
      per: 60,
    });
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Darkness Pokémon you have in play. This attack does 60 damage for each heads.",
      ),
    ).toEqual(deriveAttackCoinFlip(PRINTED));
    // …the OWNER-prefixed noun and the bare noun reach the same vocabulary's other
    // two branches, which is what makes the anchor a member of the family rather than
    // a one-sentence literal.
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Team Rocket's Pokémon you have in play. This attack does 60 damage for each heads.",
      ),
    ).toEqual({
      kind: "perHeads",
      flips: { kind: "pokemonInPlay", filter: { kind: "ownerPokemon", owner: "Team Rocket" } },
      per: 60,
    });
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Pokémon you have in play. This attack does 60 damage for each heads.",
      ),
    ).toEqual({
      kind: "perHeads",
      flips: { kind: "pokemonInPlay", filter: { kind: "anyPokemon" } },
      per: 60,
    });
  });

  it("🛑 an UNRESOLVABLE noun stays LOUD — the map refuses, and the anchor does not", () => {
    // D440's rule: a capture would claim "Ancient Pokémon", a banner NO `cardSchema`
    // column classifies, and ship a filter that counts 0 on every board forever while
    // `BUILT.attack` stepped for it. The closed map is what keeps that refusal honest.
    // ⚠️ The ADMISSION is the line directly above, one axis away (D424).
    for (const noun of ["Ancient", "Future", "Tera", "Stage 9", "banana"]) {
      expect(
        deriveAttackCoinFlip(
          `Flip a coin for each ${noun} Pokémon you have in play. This attack does 60 damage for each heads.`,
        ),
        noun,
      ).toBeNull();
    }
  });

  it("a printed 0 stays LOUD, and 1 does not — the family's `per >= 1` guard", () => {
    // A printed zero would spend a flip, and an `rngState` step, to add nothing.
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each {D} Pokémon you have in play. This attack does 0 damage for each heads.",
      ),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each {D} Pokémon you have in play. This attack does 1 damage for each heads.",
      ),
    ).toEqual({
      kind: "perHeads",
      flips: { kind: "pokemonInPlay", filter: { kind: "typedPokemon", pokemonType: "Darkness" } },
      per: 1,
    });
  });

  it("🛑 each near-miss differs on ONE axis and each is refused for THAT axis", () => {
    // D399/D427: a near-miss differing on more than one axis says nothing about
    // either. THE POSITIVE CONTROL FIRST, so "refuses everything" is excluded.
    expect(deriveAttackCoinFlip(PRINTED)).not.toBeNull();
    for (const text of [
      // …the SEAT alone: the printed subject is "you have".
      "Flip a coin for each {D} Pokémon your opponent has in play. This attack does 60 damage for each heads.",
      // …the ZONE alone: the Bench is not "in play".
      "Flip a coin for each {D} Pokémon you have on your Bench. This attack does 60 damage for each heads.",
      // …the ADJECTIVE alone: "more" KEEPS the printed base, which is a different
      // member (`bonusOnHeads`) and a different number on every board.
      "Flip a coin for each {D} Pokémon you have in play. This attack does 60 more damage for each heads.",
      // …the FACE alone: nothing in the column folds on tails.
      "Flip a coin for each {D} Pokémon you have in play. This attack does 60 damage for each tails.",
      // …the COUNTED THING alone: Energy is the SHIPPED member's question.
      "Flip a coin for each {D} Energy you have in play. This attack does 60 damage for each heads.",
      // …the VERB alone: a printed flip count is `ATTACK_COIN_MULTI`'s shape.
      "Flip 3 coins for each {D} Pokémon you have in play. This attack does 60 damage for each heads.",
    ]) {
      expect(deriveAttackCoinFlip(text), text).toBeNull();
    }
  });

  it("the anchor is WHOLE-SENTENCE — leading text, trailing text, case and the period", () => {
    // ⚠️ D452's rule: a "leading text pins `^`" probe must vary ONLY the anchor, so the
    // prefix ENDS a sentence and the family's capital `F` is preserved.
    for (const text of [
      `This attack does 30 damage. ${PRINTED}`,
      `${PRINTED} Then, discard a card.`,
      PRINTED.toLowerCase(),
      PRINTED.toUpperCase(),
      PRINTED.slice(0, -1),
    ]) {
      expect(deriveAttackCoinFlip(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE BOARD. A file-local `cardPool` (D414/D452), so no `FIXTURE_POOL` id is added
// and `opponentResistanceBonus.test.ts`'s eleven-deep id ladder takes a ZERO term.
//
// 🛑 THE SETUP HELPERS BELOW ARE DELIBERATELY NOT BYTE-COPIES of `handCostDraw.test.ts`'s
// (D442/D446/D448: a new line that is a distant neighbour's twin breaks a mutant row
// nobody touched). Where the shape is forced, the locals are named for THIS file's
// subject.
// ─────────────────────────────────────────────────────────────────────────────

/** The attacker that prints the sentence, and it is {D} ITSELF — so its own body is
    one of the things it counts, which is the whole difference between
    `countPokemonInPlay` and the Bench-only walk sitting eight lines above it in
    `attack.ts`. */
const DARK_ATTACKER = "d474-dark-attacker";
/** The SAME printed sentence on a body that is NOT {D}, so a board can hold zero
    matches at all. Without it the count can never be zero, because the attacker is
    always in play. */
const PLAIN_ATTACKER = "d474-plain-attacker";
const DARK_BODY = "d474-dark-body";
const WATER_BODY = "d474-water-body";
/** 900 HP: the largest damage any wrong reading on this board can produce is
    60 × 7 = 420, so no swept seed can end on a Knock Out and park the turn on a
    promotion. Every case here is about the flip COUNT, never about §8.1. */
const DARK_WALL = "d474-dark-wall";
const ENERGY_CARD = "d474-energy";
const ITEM_CARD = "d474-item";

/** The printed attack, spelled ONCE so the two attackers cannot drift apart: the
    whole point of `PLAIN_ATTACKER` is that it differs from `DARK_ATTACKER` in its
    `types` and in nothing else. `damage: "60×"` is the printed marker `perHeads`
    consumes, so the dropped base is DECLARED rather than silently discarded
    (`attack.ts`'s modifier-simulated check). */
const ATTACK: NonNullable<Card["attacks"]>[number] = {
  cost: ["Colorless"],
  name: "Shadow Tally",
  effect: PRINTED,
  damage: "60×",
};

const LOCAL_CARDS: Record<string, Card> = {
  [DARK_ATTACKER]: battler(DARK_ATTACKER, {
    name: "D474 Dark Attacker",
    hp: 200,
    retreat: 1,
    types: ["Darkness"],
    attacks: [{ ...ATTACK }, { cost: ["Colorless"], name: "Flat Tap", damage: "10" }],
  }),
  [PLAIN_ATTACKER]: battler(PLAIN_ATTACKER, {
    name: "D474 Plain Attacker",
    hp: 200,
    retreat: 1,
    types: ["Water"],
    attacks: [{ ...ATTACK }, { cost: ["Colorless"], name: "Flat Tap", damage: "10" }],
  }),
  [DARK_BODY]: battler(DARK_BODY, { name: "D474 Dark Body", hp: 90, types: ["Darkness"] }),
  [WATER_BODY]: battler(WATER_BODY, { name: "D474 Water Body", hp: 90, types: ["Water"] }),
  [DARK_WALL]: battler(DARK_WALL, {
    name: "D474 Dark Wall",
    hp: 900,
    retreat: 1,
    types: ["Darkness"],
    attacks: [{ cost: ["Colorless"], name: "Nudge", damage: "10" }],
  }),
  [ENERGY_CARD]: basicEnergy(ENERGY_CARD),
  [ITEM_CARD]: itemTrainer(ITEM_CARD),
};

const CARD_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** SIXTY cards, and every count is a floor derived from the boards below rather
    than a round number: setup removes 13 (seven dealt, six prized) before any
    surgery runs, so each id must have enough copies left in the DECK on every swept
    seed. The largest simultaneous demand is 7 Water (2 on P1's Bench + 5 on P2's)
    and 7 Energy (the attacker's pile in §3). */
const LOCAL_DECK = deckOf({
  [DARK_ATTACKER]: 5,
  [PLAIN_ATTACKER]: 5,
  [DARK_BODY]: 8,
  [WATER_BODY]: 15,
  [DARK_WALL]: 5,
  [ENERGY_CARD]: 20,
  [ITEM_CARD]: 2,
});

/** The attack index the whole board half of this file drives, named so a fixture
    gaining an attack moves ONE constant rather than every case (D442). */
const TALLY_INDEX = 0;

function ok(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}

function step(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const outcome = applyAction(state, action);
  if (!outcome.ok) {
    throw new Error(`${action.type} rejected: ${outcome.error.code}: ${outcome.error.message}`);
  }
  return { state: outcome.state, events: [...outcome.events] };
}

function openingBasic(state: GameState, side: Seat): string {
  const uid = state.players[side].hand.find((held) => {
    const card = CARD_POOL[state.cardIdByUid[held] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`${side} was dealt no Basic`);
  return uid;
}

/** Setup driven against the LOCAL pool, then P2's turn ended so P1 is on
    `turn:action` and may attack (§4). */
function opened(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: LOCAL_DECK, p2: LOCAL_DECK }, cardPool: CARD_POOL });
  if (!created.ok) throw new Error(`createGame: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = ok(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const drawing = state.phase;
    const owed = (["p1", "p2"] as const).find((s) => !drawing.decided[s]);
    if (owed === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = ok(applyAction(state, { type: "setupDrawExtra", seat: owed, count: drawing.owed[owed] }));
  }
  for (const side of ["p1", "p2"] as const) {
    state = ok(applyAction(state, { type: "setupPlaceActive", seat: side, uid: openingBasic(state, side) }));
  }
  for (const side of ["p1", "p2"] as const) state = ok(applyAction(state, { type: "setupReady", seat: side }));
  return step(state, { type: "endTurn", seat: "p2" }).state;
}

/** Field `cardId` from the seat's deck into the Active Spot, displacing whatever is
    there onto the Bench. Surgery, because a swept seed cannot be relied on to deal a
    particular card. */
function toActive(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((held) => state.cardIdByUid[held] === cardId);
  if (uid === undefined) throw new Error(`${seat}'s deck has no ${cardId}`);
  const displaced = side.active === null ? side.bench : [...side.bench, side.active];
  if (displaced.length > 5) throw new Error("no Bench room to displace the Active");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, deck: side.deck.filter((u) => u !== uid), active: makeInPlay(uid, state.turn), bench: displaced },
    },
  };
}

/** Empty the seat's Bench, so every board below states its OWN bench exactly rather
    than inheriting whatever setup happened to place. */
function clearBench(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  return { ...state, players: { ...state.players, [seat]: { ...side, bench: [] } } };
}

/** Put `count` copies of `cardId` from the seat's deck onto its Bench. */
function toBench(state: GameState, seat: Seat, cardId: string, count: number): GameState {
  let next = state;
  for (let placed = 0; placed < count; placed += 1) {
    const side = next.players[seat];
    const uid = side.deck.find((held) => next.cardIdByUid[held] === cardId);
    if (uid === undefined) throw new Error(`${seat}'s deck ran out of ${cardId}`);
    if (side.bench.length >= 5) throw new Error("Bench full");
    next = {
      ...next,
      players: {
        ...next.players,
        [seat]: {
          ...side,
          deck: side.deck.filter((u) => u !== uid),
          bench: [...side.bench, makeInPlay(uid, next.turn)],
        },
      },
    };
  }
  return next;
}

/** Attach `count` Energy from the seat's deck onto its Active. SEVEN of them on the
    attacker, deliberately: it is the number `attachedEnergy` would answer, and it must
    not collide with any body count this board can produce (§3). */
function attach(state: GameState, seat: Seat, count: number): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error(`${seat} has no Active`);
  const uids = side.deck.filter((held) => state.cardIdByUid[held] === ENERGY_CARD).slice(0, count);
  if (uids.length < count) throw new Error(`${seat}'s deck has fewer than ${count} Energy`);
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((held) => !taken.has(held)),
        active: { ...active, energy: [...active.energy, ...uids] },
      },
    },
  };
}

/** THE DISCRIMINATING BOARD, and every number on it is chosen so that six plausible
    readings answer six DIFFERENT values (§3 measures all six against the real
    machinery rather than asserting them in this comment):

      P1  Active  DARK_ATTACKER  ({D})        Bench  2 × {D} + 2 × {W}   Energy 7
      P2  Active  DARK_WALL      ({D}, 900hp) Bench  5 × {W}

    own in-play {D}  = 3   ← CORRECT
    own in-play all  = 5   ← the filter dropped
    own Bench   {D}  = 2   ← `benchBodies` instead of `countPokemonInPlay`
    own Bench   all  = 4   ← both
    foe in-play {D}  = 1   ← the seat crossed
    foe in-play all  = 6   ← the seat crossed AND the filter dropped
    Energy on Active = 7   ← the neighbouring `attachedEnergy` member emitted instead */
function discriminating(seed: number): GameState {
  let state = opened(seed);
  state = clearBench(toActive(state, "p1", DARK_ATTACKER), "p1");
  state = toBench(state, "p1", DARK_BODY, 2);
  state = toBench(state, "p1", WATER_BODY, 2);
  state = attach(state, "p1", 7);
  state = clearBench(toActive(state, "p2", DARK_WALL), "p2");
  return toBench(state, "p2", WATER_BODY, 5);
}

/** The ZERO-MATCH board: the attacker is {W}, its Bench is {W}, and the OPPONENT's
    board is stacked with {D} — so a build that dropped the filter, crossed the seat
    or read the Bench would all flip at least once and this one flips not at all. */
function zeroMatch(seed: number): GameState {
  let state = opened(seed);
  state = clearBench(toActive(state, "p1", PLAIN_ATTACKER), "p1");
  state = toBench(state, "p1", WATER_BODY, 3);
  state = attach(state, "p1", 2);
  state = clearBench(toActive(state, "p2", DARK_WALL), "p2");
  return toBench(state, "p2", DARK_BODY, 4);
}

/** The ONE-MATCH board: the {D} attacker alone, no {D} anywhere else on its side.
    Exactly one flip, which is what makes an ALL-TAILS outcome findable by sweeping. */
function oneMatch(seed: number): GameState {
  let state = opened(seed);
  state = clearBench(toActive(state, "p1", DARK_ATTACKER), "p1");
  state = toBench(state, "p1", WATER_BODY, 3);
  state = attach(state, "p1", 2);
  state = clearBench(toActive(state, "p2", DARK_WALL), "p2");
  return toBench(state, "p2", WATER_BODY, 2);
}

const swing = { type: "attack", seat: "p1", index: TALLY_INDEX } as const;

function rowsOf<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

const kinds = (events: readonly GameEvent[]): string[] => events.map((e) => e.type);

/** The heads count off the emitted rows — every damage assertion is stated against
    what the engine REPORTED doing, and §5 separately proves the report is honest. */
function headsOf(events: readonly GameEvent[]): number {
  return rowsOf(events, "ATTACK_EFFECT_COIN_FLIP").filter((e) => e.result === "heads").length;
}

/** Take `count` flips by hand off `rng`, returning the faces IN ORDER and the state
    they leave behind. `count === 0` is a REAL call here, not a degenerate one: it
    returns the input unchanged, which is exactly the zero board's claim. */
function foldByHand(rng: number, count: number): [faces: CoinFace[], next: number] {
  const faces: CoinFace[] = [];
  let cursor = rng;
  for (let taken = 0; taken < count; taken += 1) {
    const [face, next] = flipCoin(cursor);
    faces.push(face);
    cursor = next;
  }
  return [faces, cursor];
}

/** Every body in play on a side, tops only — the population §3 measures its six
    candidate readings over. */
function inPlayDarkness(state: GameState, seat: Seat): number {
  return countPokemonInPlay(state, seat, { kind: "typedPokemon", pokemonType: "Darkness" });
}
function inPlayAll(state: GameState, seat: Seat): number {
  return countPokemonInPlay(state, seat, { kind: "anyPokemon" });
}
function benchOnly(state: GameState, seat: Seat, darkOnly: boolean): number {
  return state.players[seat].bench.filter((body) => {
    if (body === null) return false;
    const card = CARD_POOL[state.cardIdByUid[body.stack.at(-1) ?? ""] ?? ""];
    return !darkOnly || (card?.types ?? []).includes("Darkness");
  }).length;
}

/** How many seeds each sweep runs. MEASURED on THIS deck rather than inherited from
    a sibling suite (D206: never inherit a suite figure from prose). Sweeping 0..23,
    the FIRST seed reaching each outcome is:

      THREE flips (§3's discriminating board): 1 head → seed 0, 2 → seed 1,
        3 → seed 2, 0 → seed 10. The all-tails triple is a 1-in-8 draw, which is
        what sets the number.
      ONE flip (§4's one-match board): tails → seed 0, heads → seed 2.

    ALL FOUR by seed 10, and 24 — D126's and D127's established bound for this
    family — is comfortably past it. ⚠️ Every case that uses it ASSERTS it saw every
    outcome rather than trusting the loop, so a deck edit that narrows the sweep
    reddens here instead of quietly testing one face. */
const SEEDS = 24;

describe("D474 §3 — the board, where six plausible readings answer six DIFFERENT numbers", () => {
  it("🛑 the six candidate readings are 3 / 5 / 2 / 4 / 1 / 6 and 7 — MEASURED, not asserted in a comment", () => {
    // D439/D472: every wrong value must be measured by handing each real alternative
    // to the real machinery over the real board. A signature whose values were written
    // into a comment is arithmetic, not evidence.
    const state = discriminating(0);
    const readings = [
      inPlayDarkness(state, "p1"), // CORRECT
      inPlayAll(state, "p1"), // the filter dropped
      benchOnly(state, "p1", true), // `benchBodies` instead
      benchOnly(state, "p1", false), // both
      inPlayDarkness(state, "p2"), // the seat crossed
      inPlayAll(state, "p2"), // the seat crossed and the filter dropped
      state.players.p1.active?.energy.length ?? -1, // the neighbouring member emitted
    ];
    expect(readings).toEqual([3, 5, 2, 4, 1, 6, 7]);
    // …and they are PAIRWISE DISTINCT, which is the property that makes the flip-row
    // count a discriminator at all. Asserted as a set size so a future board edit that
    // collides two of them reddens here rather than silently weakening every case below.
    expect(new Set(readings).size).toBe(readings.length);
  });

  it("🛑 flips EXACTLY THREE times, on every swept seed, and never 5 / 2 / 4 / 1 / 6 / 7", () => {
    const seenHeads = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const state = discriminating(seed);
      const { state: done, events } = step(state, swing);
      const flips = rowsOf(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips, `seed ${seed}`).toHaveLength(3);
      for (const flip of flips) expect(flip.seat).toBe("p1"); // the ATTACKER flips
      const heads = headsOf(events);
      seenHeads.add(heads);
      expect(done.players.p2.active?.damage ?? 0, `seed ${seed}`).toBe(60 * heads);
      // The totals only a WRONG count could produce, named as absences.
      for (const wrong of [5, 2, 4, 1, 6, 7]) {
        expect(flips.length, `seed ${seed} / ${wrong}`).not.toBe(wrong);
      }
      // …and the printed base never leaks: three heads is 180, not 240.
      expect(done.players.p2.active?.damage ?? 0).not.toBe(60 * heads + 60);
      expect(kinds(events)).not.toContain("KNOCKED_OUT");
      expect(kinds(events)).toContain("TURN_ENDED");
    }
    // EVERY outcome of the three flips was reached — asserted, not assumed.
    expect([...seenHeads].sort()).toEqual([0, 1, 2, 3]);
  });

  it("the ACTIVE is counted — the same card, the same text, one Bench body fewer", () => {
    // The one thing that separates `countPokemonInPlay` from the Bench-only walk eight
    // lines above it in `attack.ts`. Removing a Bench {D} takes the count to 2; the
    // Bench-only reading would have said 1, and the two boards would be the SAME
    // number under it (2 → 1 and 1 → 1 is not a thing, so this is the honest form:
    // the count moves by exactly one with the Bench and stays > 0 with an empty one).
    const full = discriminating(0);
    expect(rowsOf(step(full, swing).events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(3);
    const bare = oneMatch(0);
    expect(inPlayDarkness(bare, "p1")).toBe(1);
    expect(benchOnly(bare, "p1", true)).toBe(0);
    // …an EMPTY-Bench-of-{D} board still flips ONCE, which the Bench-only reading
    // cannot produce at all.
    expect(rowsOf(step(bare, swing).events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
  });

  it("leaves the card's OTHER attack alone — a flat 10, no flips, base KEPT", () => {
    // The control for every "the coin reader did not touch this" claim: the same card,
    // the same board, no flip rows and no dropped base.
    const { state: done, events } = step(discriminating(0), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    expect(rowsOf(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(done.players.p2.active?.damage ?? 0).toBe(10);
  });
});

describe("D474 §4 — ZERO FLIPS and ALL TAILS deal the same damage and are NOT the same fact", () => {
  it("🛑 ZERO MATCHES takes NO flip, spends NO rng step, deals nothing, and is not LOUD", () => {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const state = zeroMatch(seed);
      // The board really is the one described — without this the case could pass on a
      // board that simply failed to place anything.
      expect(inPlayDarkness(state, "p1"), `seed ${seed}`).toBe(0);
      expect(inPlayAll(state, "p1"), `seed ${seed}`).toBe(4);
      expect(inPlayDarkness(state, "p2"), `seed ${seed}`).toBe(5);
      const before = state.rngState;
      const { state: done, events } = step(state, swing);
      expect(rowsOf(events, "ATTACK_EFFECT_COIN_FLIP"), `seed ${seed}`).toHaveLength(0);
      expect(done.players.p2.active?.damage ?? 0, `seed ${seed}`).toBe(0);
      expect(rowsOf(events, "DAMAGE_DEALT"), `seed ${seed}`).toHaveLength(0);
      // 🛑 THE CONTROL THAT SEPARATES THIS FROM SILENCE-FOR-ANOTHER-REASON. A zero
      // count is a RESOLVED attack, not a refused one: no `ATTACK_EFFECT_SKIPPED`, no
      // rejected action, and the turn really ended.
      expect(kinds(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(kinds(events)).toContain("TURN_ENDED");
      expect(kinds(events)).toContain("ATTACK_DECLARED");
      // …and the generator STOOD STILL, which is the byte no board assertion can see
      // (D455: a resource that is consumed and written back is invisible to any
      // assertion about ONE use).
      expect(done.rngState, `seed ${seed}`).toBe(before);
    }
  });

  it("🛑 ALL TAILS deals the same ZERO and is a DIFFERENT fact — one flip row, one rng step", () => {
    // The pair is the claim. Same damage, same absent `DAMAGE_DEALT` row, and two
    // things that differ: the flip ROW COUNT and the rngState.
    const tailsSeeds: number[] = [];
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const state = oneMatch(seed);
      const before = state.rngState;
      const { state: done, events } = step(state, swing);
      const flips = rowsOf(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips, `seed ${seed}`).toHaveLength(1);
      // …the generator MOVED, on every seed, heads or tails — the flip was really taken.
      expect(done.rngState, `seed ${seed}`).not.toBe(before);
      expect(done.rngState, `seed ${seed}`).toBe(foldByHand(before, 1)[1]);
      if (flips[0]?.result !== "tails") continue;
      tailsSeeds.push(seed);
      expect(done.players.p2.active?.damage ?? 0, `seed ${seed}`).toBe(0);
      expect(rowsOf(events, "DAMAGE_DEALT"), `seed ${seed}`).toHaveLength(0);
      expect(kinds(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
    // An all-tails board was really reached — the case is not vacuously green.
    expect(tailsSeeds.length).toBeGreaterThan(0);
  });
});

describe("D474 §5 — the rngState account: exactly `count` steps, no more and no fewer", () => {
  it("recomputes the whole flip sequence by hand, in order, on every swept seed", () => {
    // D455's shape: dropping the write-back leaves the board identical and the
    // generator frozen, so the next flip replays the same face. Only a comparison
    // ACROSS the consumption can see it.
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const state = discriminating(seed);
      const [faces, after] = foldByHand(state.rngState, 3);
      const { state: done, events } = step(state, swing);
      expect(
        rowsOf(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result),
        `seed ${seed}`,
      ).toEqual(faces);
      expect(done.rngState, `seed ${seed}`).toBe(after);
      // …and NOT the state four or two flips would have left, which is what an
      // off-by-one loop bound produces.
      expect(done.rngState, `seed ${seed}`).not.toBe(foldByHand(state.rngState, 4)[1]);
      expect(done.rngState, `seed ${seed}`).not.toBe(foldByHand(state.rngState, 2)[1]);
    }
  });

  it("emits NO loud row on ANY outcome, on ANY count, including ZERO", () => {
    // `modifierSimulated`: the sentence is READ, so the engine must never flag it.
    for (let seed = 0; seed < SEEDS; seed += 1) {
      for (const build of [discriminating, oneMatch, zeroMatch]) {
        const { events } = step(build(seed), swing);
        expect(rowsOf(events, "ATTACK_EFFECT_SKIPPED"), `${build.name} / ${seed}`).toHaveLength(0);
      }
    }
  });
});

describe("D474 §6 — `MATCH_RECORD_VERSION` stays 29, and this is D473's FIRST argument", () => {
  it("🛑 `AttackFlipCount` has NO CARRIER AT ALL — it is never serialised anywhere", () => {
    // ⚠️ D473's rule: a rule that turns on PERSISTENCE must be applied at an address
    // that persists, and the three arguments this repo uses are different. This is the
    // FIRST — *no carrier at all* — and NOT D473's own (*a byte string a v29 deploy
    // already writes*), because there is no byte here in either direction.
    //
    // `deriveAttackCoinFlip`'s value is a LOCAL `const` inside `attack()`, consumed by
    // `takeFlips` in the same tick and thrown away; it is not an `EffectOp`, so it
    // never reaches `phase.cont.pendingOp` or its `rest`, and it is in no `GameState`
    // field. Driven rather than argued: the whole serialized state after a swing that
    // FIRED and after one that WHIFFED contains neither the union's name nor the new
    // member's.
    for (const build of [discriminating, zeroMatch]) {
      const { state: done } = step(build(0), swing);
      const wire = JSON.stringify(done);
      expect(wire, build.name).not.toContain("pokemonInPlay");
      expect(wire, build.name).not.toContain("attachedEnergy");
      expect(wire, build.name).not.toContain("perHeads");
      // …and no continuation was written at all, on either board.
      expect(done.phase.kind, build.name).not.toBe("effect:choose");
    }
  });

  it("engineVersion is 0.379.0 and `manifest.version` agrees", () => {
    // D460's FOURTH class of version-tax site is the `it()` TITLE, so this one names
    // both halves and BOTH are asserted — a title that reports a claim the body does
    // not make is worse than a stale doc block, because the run log then says a
    // version the suite never checked.
    expect(engineVersion).toBe("0.379.0");
    expect(manifest.version).toBe("0.379.0");
    expect(manifest.version).toBe(engineVersion);
  });
});
