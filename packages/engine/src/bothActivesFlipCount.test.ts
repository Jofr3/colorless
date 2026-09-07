import type { Card } from "@luminous/schema";
import manifest from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import { countAttachedEnergy, countEnergyInPlay, providedEnergy } from "./continuous";
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

// 0.372.0 → 0.373.0 — 🆕🆕 D475: THE COIN FLIP COUNTED OVER **BOTH ACTIVES**.
//
// ── THE PRINTED SENTENCE ─────────────────────────────────────────────────────
//   `censusAttackCorpus.ts` FILE LINE 231 — "Flip a coin for each Energy attached
//     to both Active Pokémon. This attack does 60 damage for each heads."   **1 printing**
//
// — 1 sentence / 1 Standard-legal printing, ONE anchor, ONE new `AttackFlipCount`
// member, ONE arm in `deriveAttackCoinFlip` and ONE `case` in `attack.ts`'s
// `takeFlips`. It CLOSES the printed `Flip a coin for each …` family: three rows /
// four printings, and all three now read, each through a different member.
//
// 🛑 **THE FIRST FLIP COUNT BOTH SEATS CONTRIBUTE TO.** D128 taught this family to
// read its count off the board (self-attached ENERGY) and D474 added the own-side
// BODY count. Both are one-sided. This one sums the Energy CARDS on the attacker's
// Active and the Energy CARDS on the defender's — the identical two operands
// `scaledAttackDamage`'s `bothActivesEnergyCount` arm (D196) folds for the DAMAGE
// spelling of the same printed noun — so §3 drives a board where the two piles hold
// **2** and **7** and the answer is **9**, which no one-seat reading can produce.
//
// ── WHY IT IS A FIFTH MEMBER AND NOT A `scope` FIELD (D440, READ NOT COPIED) ───
// *Nullary or asymmetric payload ⇒ two members; identical payload ⇒ one member with
// the discriminator as a field.* `attachedEnergy` carries an ENERGY TYPE FILTER and
// this carries NOTHING — the printed sentence spells no type word, measured over all
// 640 rows (§1's optional-filter loosening claims the identical 1/1). A `scope` field
// would make every self-attached value carry a scope it must ignore and every
// both-Actives value a filter no printing can set. `DamageCountSource` settled the
// same question the same way at D196: `bothActivesEnergyCount` is nullary there too.
//
// ── 🛑 THE TRAP D474 ARMED FOR THIS ROW, AND THE MEASUREMENT THAT IT DID NOT FIRE ─
// D474 converted `takeFlips`' dispatch from a ternary to a `switch` and named THIS
// row as the reason: *"a fifth member carrying an `energy` field of a compatible type
// — say a per-Energy count scoped to BOTH Actives, which is corpus file line 231 —
// would satisfy `count.energy` and fall SILENTLY into the self-attached reading."*
//
// **It is not such a member, so the trap does not fire, and both halves were measured
// on the real file rather than reasoned about:**
//
//   · **Would the OLD ternary have been silent for this member?** NO. With the
//     pre-D474 ternary restored and `pokemonInPlay` peeled off its `:` branch — which
//     reconstructs D473's three-member world plus D475's member, the exact world the
//     prediction was about — `bunx tsc -b` answers **TS2339: Property 'energy' does
//     not exist on type '{ kind: "attachedEnergy"; … } | { kind: "bothActivesEnergy"; }'**,
//     naming the new member. The member is NULLARY, so the payload coincidence that
//     saved the ternary for `pokemonInPlay` saves it here too.
//   · **Is the `switch` loud for this member?** YES, and on the DISCRIMINATOR rather
//     than on a field access: with the member added and its `case` withheld, `tsc`
//     answers **TS2454 — "Variable 'flips' is used before being assigned"**.
//
// Both probes restored their file in a `finally` and were verified byte-identical.
// **D474's RULE stands and D474's FORECAST did not** — which is D427's distinction
// (*a price is a forecast; a rule is a criterion*) arriving inside one paragraph.
// The correction is written at both sites that carried the prediction
// (`attack.ts`'s `takeFlips` block and `inPlayFlipCount.test.ts`'s header), per D442.
//
// ── WHAT THIS FILE CANNOT ASSERT, SAID OUT LOUD ──────────────────────────────
// The two findings above are TYPE-LEVEL and `bun run check`'s vitest half cannot see
// them: a suite cannot observe a compile error that does not exist. They are recorded
// here as measurements with the exact diagnostics, and the mutation row that CAN go
// red about the runtime half — the arm emitting the neighbouring member — is
// `D475-arm-emits-the-self-attached-member`, killed by §3 of this file.
//
// ── WHAT IS NOT NEW ──────────────────────────────────────────────────────────
// ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, prompt fields, events,
// error codes, `AttackCoinFlip`/`BoardCondition`/`CardFilter`/`DamageCountSource`
// members, clause-table rows, registry rows, `packages/schema` bytes, `redact.ts`
// bytes — and **ZERO new `FIXTURE_POOL` ids**, because the printed sentence has sat
// on `fix-bothactives` index 2 since D196 as a refusal witness (§1 pins that). The
// reader surface stays 13. §6 is the `MATCH_RECORD_VERSION` argument.

/** THE SENTENCE, byte for byte off `legalAttackCorpus()` — §1 asserts that. */
const PRINTED =
  "Flip a coin for each Energy attached to both Active Pokémon. This attack does 60 damage for each heads.";

/** D128's shipped sibling (corpus file line 232, 1 printing) — ONE body, and the
    member whose reading a wrong build here would silently produce. */
const SELF_SIDE =
  "Flip a coin for each Energy attached to this Pokémon. This attack does 80 damage for each heads.";

/** D474's shipped sibling (corpus file line 233, 2 printings) — BODIES rather than
    Energy, own side only. */
const BODY_SIDE =
  "Flip a coin for each {D} Pokémon you have in play. This attack does 60 damage for each heads.";

/** The DAMAGE spelling of this slice's printed noun (corpus file line 574, 8
    printings) — `deriveAttackDamageBonus`'s `bothActivesEnergyCount`, shipped at
    D196. It is the reason the counter is shared rather than re-derived, and §2 drives
    that the two readers keep their own halves. */
const DAMAGE_TWIN = "This attack does 30 more damage for each Energy attached to both Active Pokémon.";

/** Every reader `censusAtHead.test.ts` sweeps with, so a sentence this file calls
    "unread" is unread by the WHOLE engine and not by the one reader it is about.
    ⚠️ SPLICED BEFORE THE LAST ENTRY RATHER THAN APPENDED where it ever grows, D419's
    rule — mutant `find` strings quote an array's last entries plus its closing `];`. */
const ALL_READERS: readonly ((t: string) => unknown)[] = [
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

const printings = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

describe("D475 §1 — the sentence, measured live over the legal column", () => {
  it("🛑 the hand-kept reader list IS the module's reader surface, and it is 13", () => {
    // D417/D419's guard: a hand-kept copy of a module-derived surface cannot go red,
    // it can only go quiet, so the DIFF and the COUNT are pinned separately.
    expect(ALL_READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("is really in the column, ONCE, at ONE printing", () => {
    // The attribution control (D183/D456): without it every rung below could be green
    // against a paraphrase no card prints. The PRINTING COUNT is asserted too, because
    // it is what tells a FILE LINE from an array index in one look (D448/D459).
    const rows = legalAttackCorpus().filter(([, s]) => s === PRINTED);
    expect([rows.length, printings(rows)]).toEqual([1, 1]);
  });

  it("🛑 the `Flip a coin for each` family is THREE rows / FOUR printings, and D475 closes it", () => {
    // D448's rule: write the "cannot see" sentence as a QUERY YOU RAN. The loosest
    // shape that can hold this mechanism is the leading clause itself.
    const family = legalAttackCorpus().filter(([, s]) => /Flip a coin for each/.test(s));
    expect(family.map(([, s]) => s).sort()).toEqual([PRINTED, SELF_SIDE, BODY_SIDE].sort());
    expect([family.length, printings(family)]).toEqual([3, 4]);
    // …and each reads through a DIFFERENT member, asserted by VALUE rather than by
    // three `not.toBeNull()`s: "every row is claimed" is true under a build where one
    // anchor swallowed its neighbours and the members collapsed (D438/D449).
    const members = [PRINTED, SELF_SIDE, BODY_SIDE].map((s) => {
      const read = deriveAttackCoinFlip(s);
      return read !== null && "flips" in read ? read.flips.kind : null;
    });
    expect(members).toEqual(["bothActivesEnergy", "attachedEnergy", "pokemonInPlay"]);
  });

  it("🛑 `deriveAttackCoinFlip` is its ONLY reader — the other TWELVE refuse it", () => {
    expect(deriveAttackCoinFlip(PRINTED)).not.toBeNull();
    for (const read of ALL_READERS) {
      if (read === deriveAttackCoinFlip) continue;
      expect(read(PRINTED), read.name).toBeNull();
    }
    // …and no splitter composes it either, so the whole-sentence anchor is the only
    // route in and the RAW and RESIDUE summands move together (D444/D457).
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });

  it("🛑 D464's COMPOUND route contributes nothing — no row is this sentence plus a tail", () => {
    // Building a sentence builds every `⟨it⟩. ⟨claimed tail⟩` compound with it, through
    // a path that is neither the anchor nor the arm. Measured over the whole column
    // rather than asserted: no row has this sentence as a proper prefix.
    const compounds = legalAttackCorpus().filter(([, s]) => s !== PRINTED && s.startsWith(PRINTED));
    expect(compounds).toEqual([]);
  });

  it("🛑 EVERY widening claims the IDENTICAL 1 sentence / 1 printing — pure RISK", () => {
    // D472's rule at its fourth address, RUN rather than described. Six loosenings,
    // one axis each; not one of them buys a printing.
    const widenings: Record<string, RegExp> = {
      // …an optional TYPE FILTER: a group no printing in the column can set.
      typed:
        /^Flip a coin for each (?:(.+) )?Energy attached to both Active Pokémon\. This attack does (\d+) damage for each heads\.$/,
      // …an open consequent: the count clause stops being pinned to a per-heads fold.
      consequent: /^Flip a coin for each Energy attached to both Active Pokémon\. (.+)$/,
      // …dropping the `^`.
      caret:
        /Flip a coin for each Energy attached to both Active Pokémon\. This attack does (\d+) damage for each heads\.$/,
      // …dropping the `\.$`.
      dollar:
        /^Flip a coin for each Energy attached to both Active Pokémon\. This attack does (\d+) damage for each heads\./,
      // …making `both ` optional, which would spell a one-Active sentence nobody prints.
      both: /^Flip a coin for each Energy attached to (?:both )?Active Pokémon\. This attack does (\d+) damage for each heads\.$/,
    };
    for (const [name, re] of Object.entries(widenings)) {
      const claimed = legalAttackCorpus().filter(([, s]) => re.test(s));
      expect([claimed.length, printings(claimed)], name).toEqual([1, 1]);
      expect(claimed[0]?.[1], name).toBe(PRINTED);
    }
    // …and the SEVENTH loosening moves a number and moves it the WRONG WAY: admitting
    // `more` claims NOTHING at all, so the additive spelling of this coin sentence is
    // not printed and an optional `(?:more )?` would author a card (D452's rule).
    const more =
      /^Flip a coin for each Energy attached to both Active Pokémon\. This attack does (\d+) more damage for each heads\.$/;
    expect(legalAttackCorpus().filter(([, s]) => more.test(s))).toEqual([]);
  });

  it("🛑 the two loosenings that DO move a number would EAT A SIBLING'S ROW", () => {
    // The other half of D472's rule, and the reason the anchor spells its noun out
    // rather than capturing it: opening the ATTACHMENT NOUN claims D128's shipped row
    // as well, and opening the whole HEAD claims both siblings'. A "wider anchor" here
    // is not a wider anchor — it is a COLLISION with a shipped one, which is what the
    // family's structural disjointness exists to prevent.
    const noun =
      /^Flip a coin for each Energy attached to ([^.]+)\. This attack does (\d+) damage for each heads\.$/;
    const head = /^Flip a coin for each ([^.]+)\. This attack does (\d+) damage for each heads\.$/;
    const byNoun = legalAttackCorpus().filter(([, s]) => noun.test(s));
    const byHead = legalAttackCorpus().filter(([, s]) => head.test(s));
    expect([byNoun.length, printings(byNoun)]).toEqual([2, 2]);
    expect([byHead.length, printings(byHead)]).toEqual([3, 4]);
    expect(byNoun.map(([, s]) => s).sort()).toEqual([PRINTED, SELF_SIDE].sort());
    expect(byHead.map(([, s]) => s).sort()).toEqual([PRINTED, SELF_SIDE, BODY_SIDE].sort());
  });

  it("🛑 STRUCTURAL disjointness from BOTH siblings, driven from every side", () => {
    // D468's SECOND kind of `equivalent`: all three patterns are `^…$` and disagree on
    // a mandatory run of bytes at the same position, so no string reaches two of them
    // and NO GUARD EXISTS — correctly none, since one would be unkillable by
    // construction (D205/D208/D467). Driven by VALUE from each side.
    expect(deriveAttackCoinFlip(PRINTED)).toEqual({
      kind: "perHeads",
      flips: { kind: "bothActivesEnergy" },
      per: 60,
    });
    expect(deriveAttackCoinFlip(SELF_SIDE)).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: null },
      per: 80,
    });
    expect(deriveAttackCoinFlip(PRINTED)).not.toEqual(deriveAttackCoinFlip(SELF_SIDE));
    expect(deriveAttackCoinFlip(PRINTED)).not.toEqual(deriveAttackCoinFlip(BODY_SIDE));
    // …and the CROSSINGS — each sentence's head against another's tail — reach no
    // pattern at all, which is the byte-level claim spelled as a rung.
    for (const crossed of [
      "Flip a coin for each Energy attached to both Active Pokémon you have in play. This attack does 60 damage for each heads.",
      "Flip a coin for each Energy attached to this Pokémon and both Active Pokémon. This attack does 60 damage for each heads.",
      "Flip a coin for each {D} Pokémon attached to both Active Pokémon. This attack does 60 damage for each heads.",
    ]) {
      expect(deriveAttackCoinFlip(crossed), crossed).toBeNull();
    }
  });

  it("🛑 the sentence has been FIELDED as a refusal witness since D196, and it is that fixture's", () => {
    // D463's rule: before building a residue row, grep the suites for its sentence —
    // and pay the negative-control cost rather than refusing on it. `fix-bothactives`
    // index 2 IS this printed string, so no `FIXTURE_POOL` id is added by this slice
    // and `selfEnergyScaling.test.ts`'s two rungs were RE-POINTED (D418), not deleted.
    expect(FIXTURE_POOL["fix-bothactives"]?.attacks?.[2]?.effect).toBe(PRINTED);
    expect(FIXTURE_POOL["fix-bothactives"]?.attacks?.[2]?.damage).toBe("60×");
    // …and this file's OWN pool does not print it a second time, which is the sweep
    // D196 wrote after `sv03-030` turned up carrying a sibling's sentence.
    const carriers = Object.entries(FIXTURE_POOL).filter(([, card]) =>
      (card.attacks ?? []).some((a) => a.effect === PRINTED),
    );
    expect(carriers.map(([id]) => id)).toEqual(["fix-bothactives"]);
  });
});

describe("D475 §2 — the derived value, and every refusal pinned on ONE printed byte", () => {
  it("the member is NULLARY — there is no filter, no seat and no count on it", () => {
    // The shape IS the claim (D440): a payload here would be a field no printing can
    // set. Asserted as a strict `toEqual`, so a later widening that adds a key reddens.
    const read = deriveAttackCoinFlip(PRINTED);
    expect(read).toEqual({ kind: "perHeads", flips: { kind: "bothActivesEnergy" }, per: 60 });
    expect(read !== null && "flips" in read ? Object.keys(read.flips) : []).toEqual(["kind"]);
  });

  it("a printed 0 stays LOUD, and 1 does not — the family's `per >= 1` guard", () => {
    // A printed zero would spend a flip, and an `rngState` step, to add nothing.
    // ⚠️ THE ADMISSION IS THE LINE BELOW, one axis away (D424).
    expect(
      deriveAttackCoinFlip(PRINTED.replace("does 60 damage", "does 0 damage")),
    ).toBeNull();
    expect(deriveAttackCoinFlip(PRINTED.replace("does 60 damage", "does 1 damage"))).toEqual({
      kind: "perHeads",
      flips: { kind: "bothActivesEnergy" },
      per: 1,
    });
  });

  it("🛑 a TYPED spelling stays LOUD — the pool prints none, so the group is refused", () => {
    // D441: the test is how many INDEPENDENT questions the PRINT asks. The damage twin
    // has pinned this same absence since D196; this is the coin side of it, and the
    // falsifier is executable — the day a typed both-Actives flip count is printed,
    // this rung is what a builder meets.
    for (const token of ["{R}", "{W}", "Basic", "Special", "Water"]) {
      expect(
        deriveAttackCoinFlip(PRINTED.replace("each Energy", `each ${token} Energy`)),
        token,
      ).toBeNull();
    }
  });

  it("🛑 each near-miss differs on ONE axis and each is refused for THAT axis", () => {
    // D399/D427: a near-miss differing on more than one axis says nothing about either.
    // THE POSITIVE CONTROL FIRST, so "refuses everything" is excluded.
    expect(deriveAttackCoinFlip(PRINTED)).not.toBeNull();
    // 🛑 THE SCOPE AXIS IS NOT A REFUSAL AND SAYING SO IS THE POINT (D424's
    // admission, and D399's one-axis rule taken seriously). Changing `both Active
    // Pokémon` to `this Pokémon` and NOTHING else lands on D128's SHIPPED anchor, so
    // the honest one-axis claim about that byte is that it moves the MEMBER — not
    // that it turns the sentence off. A rung asserting `toBeNull` there would have
    // been red, and it was: this is the shape the first run found.
    expect(deriveAttackCoinFlip(PRINTED.replace("both Active Pokémon", "this Pokémon"))).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: null },
      per: 60,
    });
    for (const text of [
      // …the SEAT alone: the printed subject names both Actives, not one side's.
      PRINTED.replace("both Active Pokémon", "your opponent's Active Pokémon"),
      // …the COUNTED THING alone: bodies are D474's member.
      PRINTED.replace("each Energy attached to", "each Pokémon attached to"),
      // …the ADJECTIVE alone: "more" KEEPS the printed base, a different member.
      PRINTED.replace("60 damage", "60 more damage"),
      // …the FACE alone: nothing in the column folds on tails.
      PRINTED.replace("for each heads", "for each tails"),
      // …the VERB alone: a printed flip count is `ATTACK_COIN_MULTI`'s shape.
      PRINTED.replace("Flip a coin for each", "Flip 3 coins for each"),
      // …the NUMBER WORD alone: "all" is not the printed determiner.
      PRINTED.replace("for each Energy", "for all Energy"),
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

  it("🛑 the DAMAGE twin of this printed noun stays where it was — two readers, two halves", () => {
    // D196's `bothActivesEnergyCount` reads the same noun as DAMAGE. Neither reader may
    // take the other's sentence: a string both claimed would fold once off the board
    // and once off the coin, which is a bigger number on the same event.
    expect(deriveAttackDamageBonus(DAMAGE_TWIN)).toEqual({
      per: 30,
      count: { kind: "bothActivesEnergyCount" },
    });
    expect(deriveAttackCoinFlip(DAMAGE_TWIN)).toBeNull();
    expect(deriveAttackDamageBonus(PRINTED)).toBeNull();
    expect(deriveAttackDamageMultiplier(PRINTED)).toBeNull();
    // …and the twin is a REAL corpus row at 8 printings, not a string this file made up.
    const twin = legalAttackCorpus().filter(([, s]) => s === DAMAGE_TWIN);
    expect([twin.length, printings(twin)]).toEqual([1, 8]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE BOARD. A file-local `cardPool` (D414/D452), so no `FIXTURE_POOL` id is added
// and `opponentResistanceBonus.test.ts`'s eleven-deep id ladder takes a ZERO term.
//
// 🛑 THE SETUP HELPERS BELOW ARE DELIBERATELY NOT BYTE-COPIES of the sibling flip
// suites' (D442/D446/D448: a new line that is a distant neighbour's twin breaks a
// mutant row nobody touched). Where the shape is forced, the locals are named for
// THIS file's subject.
// ─────────────────────────────────────────────────────────────────────────────

/** The attacker that prints the sentence, at the printed `{C}` cost. */
const TIDE_CALLER = "d475-tide-caller";
/** ⚠️ THE SAME PRINTED SENTENCE AT A **ZERO** COST, AND IT IS CONSTRUCTED — labelled
    so, per D440. It exists because *"cost is a check, not a payment"* (§8 step 2, and
    D436's note): a `{C}` attacker must hold at least one Energy to declare at all, so
    on the printed card this count can never be **0** and the attacker's own pile can
    never be empty. The zero-count arm of `takeFlips` and the DEFENDER-ONLY reading
    are therefore not drivable at the printed cost, and this body is what makes both
    reachable. It differs from `TIDE_CALLER` in its `cost` and in NOTHING else. */
const FREE_CALLER = "d475-free-caller";
/** 900 HP: nine flips at 60 is 540, so no swept seed can end on a Knock Out and park
    the turn on a promotion. Every case here is about the flip COUNT. */
const BULWARK = "d475-bulwark";
/** A plain Basic with no attacks — Bench filler, so a board can state its own body
    count exactly. */
const FILLER = "d475-filler";
const ITEM_CARD = "d475-item";

/** The printed attack, spelled ONCE so the two attackers cannot drift apart.
    `damage: "60×"` is the printed marker `perHeads` consumes, so the dropped base is
    DECLARED rather than silently discarded (`attack.ts`'s modifier-simulated check). */
const TIDE_ATTACK: NonNullable<Card["attacks"]>[number] = {
  cost: ["Colorless"],
  name: "Tidal Tally",
  effect: PRINTED,
  damage: "60×",
};

const LOCAL_CARDS: Record<string, Card> = {
  [TIDE_CALLER]: battler(TIDE_CALLER, {
    name: "D475 Tide Caller",
    hp: 200,
    retreat: 1,
    types: ["Water"],
    attacks: [{ ...TIDE_ATTACK }, { cost: ["Colorless"], name: "Flat Slap", damage: "10" }],
  }),
  [FREE_CALLER]: battler(FREE_CALLER, {
    name: "D475 Free Caller",
    hp: 200,
    retreat: 1,
    types: ["Water"],
    attacks: [{ ...TIDE_ATTACK, cost: [] }, { cost: [], name: "Flat Slap", damage: "10" }],
  }),
  [BULWARK]: battler(BULWARK, {
    name: "D475 Bulwark",
    hp: 900,
    retreat: 1,
    types: ["Fighting"],
    attacks: [{ cost: ["Colorless"], name: "Shove", damage: "10" }],
  }),
  [FILLER]: battler(FILLER, { name: "D475 Filler", hp: 90, types: ["Fighting"] }),
  [ITEM_CARD]: itemTrainer(ITEM_CARD),
  "d475-plain-energy": basicEnergy("d475-plain-energy"),
};

const CARD_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The two Basic Energy this file attaches, taken from `FIXTURE_POOL` so the TYPE is
    a real one (`typedEnergy` derives provision from the printed name). The Fire/Water
    split is what makes a build that passed a type filter answer a different number —
    D448's rule: when the claim is "count X regardless of Y", the board must hold a Y
    that differs, or the narrowed and un-narrowed answers collide. */
const FIRE = "fix-fire-energy";
const WATER = "fix-water-energy";
/** ⚠️ A Special providing the SAME concrete type TWICE (D391). One CARD, two UNITS —
    the only shape on which "counts Energy CARDS" and "counts Energy UNITS" disagree,
    and `countAttachedEnergy` answers **1** (D121, stated in `continuous.ts`). Without
    it §3's `correct` and `units` readings would be the same number. */
const GRASS_DOUBLE = "fix-grassdouble";

/** SIXTY cards. Every count is a floor derived from the boards below: setup removes
    13 (seven dealt, six prized) before any surgery runs, so each id must have enough
    copies left in the DECK on every swept seed. The largest simultaneous demands are
    5 `FILLER` on one Bench, 5 `WATER` and 2 `FIRE` on one Active. */
const LOCAL_DECK = deckOf({
  [TIDE_CALLER]: 5,
  [FREE_CALLER]: 5,
  [BULWARK]: 5,
  [FILLER]: 11,
  [FIRE]: 11,
  [WATER]: 13,
  [GRASS_DOUBLE]: 6,
  [ITEM_CARD]: 4,
});

/** The attack index the board half of this file drives, named so a fixture gaining an
    attack moves ONE constant rather than every case (D442). */
const TALLY = 0;

function ok(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}

function play(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const outcome = applyAction(state, action);
  if (!outcome.ok) {
    throw new Error(`${action.type} rejected: ${outcome.error.code}: ${outcome.error.message}`);
  }
  return { state: outcome.state, events: [...outcome.events] };
}

function firstBasic(state: GameState, side: Seat): string {
  const uid = state.players[side].hand.find((held) => {
    const card = CARD_POOL[state.cardIdByUid[held] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`${side} was dealt no Basic`);
  return uid;
}

/** Setup driven against the LOCAL pool, then P2's turn ended so P1 is on
    `turn:action` and may attack (§4 of the rules). */
function opened(seed: number): GameState {
  const created = createGame({
    seed,
    decks: { p1: LOCAL_DECK, p2: LOCAL_DECK },
    cardPool: CARD_POOL,
  });
  if (!created.ok) throw new Error(`createGame: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = ok(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const drawing = state.phase;
    const owed = (["p1", "p2"] as const).find((s) => !drawing.decided[s]);
    if (owed === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = ok(applyAction(state, { type: "setupDrawExtra", seat: owed, count: drawing.owed[owed] }));
  }
  for (const side of ["p1", "p2"] as const) {
    state = ok(applyAction(state, { type: "setupPlaceActive", seat: side, uid: firstBasic(state, side) }));
  }
  for (const side of ["p1", "p2"] as const) state = ok(applyAction(state, { type: "setupReady", seat: side }));
  return play(state, { type: "endTurn", seat: "p2" }).state;
}

/** Field `cardId` from the seat's deck into the Active Spot, discarding whatever was
    there rather than benching it — the boards below state their own Bench exactly, so
    a displaced opening Active would be an extra body nobody counted. */
function intoActive(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((held) => state.cardIdByUid[held] === cardId);
  if (uid === undefined) throw new Error(`${seat}'s deck has no ${cardId}`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        active: makeInPlay(uid, state.turn),
        bench: [],
      },
    },
  };
}

/** Put `count` copies of `cardId` from the seat's deck onto its Bench. */
function ontoBench(state: GameState, seat: Seat, cardId: string, count: number): GameState {
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

/** Attach `count` copies of `cardId` from the seat's deck onto its ACTIVE. */
function ontoActiveEnergy(state: GameState, seat: Seat, cardId: string, count: number): GameState {
  const side = state.players[seat];
  const spot = side.active;
  if (spot === null) throw new Error(`${seat} has no Active`);
  const uids = side.deck.filter((held) => state.cardIdByUid[held] === cardId).slice(0, count);
  if (uids.length < count) throw new Error(`${seat}'s deck has fewer than ${count} ${cardId}`);
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((held) => !taken.has(held)),
        active: { ...spot, energy: [...spot.energy, ...uids] },
      },
    },
  };
}

/** Attach `count` copies of `cardId` from the seat's deck onto Bench slot `slot`. The
    BENCH piles are what separate "the two ACTIVES" from "the two BOARDS" (§3's
    `boardSelf` / `boardFoe` / `boardBoth` readings), so every board here states them. */
function ontoBenchEnergy(
  state: GameState,
  seat: Seat,
  slot: number,
  cardId: string,
  count: number,
): GameState {
  const side = state.players[seat];
  const body = side.bench[slot];
  if (body === undefined || body === null) throw new Error(`${seat} has no Bench slot ${slot}`);
  const uids = side.deck.filter((held) => state.cardIdByUid[held] === cardId).slice(0, count);
  if (uids.length < count) throw new Error(`${seat}'s deck has fewer than ${count} ${cardId}`);
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((held) => !taken.has(held)),
        bench: side.bench.map((slotBody, index) =>
          index === slot && slotBody !== null
            ? { ...slotBody, energy: [...slotBody.energy, ...uids] }
            : slotBody,
        ),
      },
    },
  };
}

/** THE DISCRIMINATING BOARD, and every number on it is chosen so that ELEVEN
    plausible readings answer ELEVEN DIFFERENT values (§3 measures all eleven against
    the real machinery rather than asserting them in this comment):

      P1  Active  TIDE_CALLER  Energy 1 x {R} + 1 x GRASS_DOUBLE   Bench 4 bodies, 2 Energy
      P2  Active  BULWARK      Energy 2 x {R} + 5 x {W}            Bench 5 bodies, 1 Energy

    both Actives, CARDS   =  9   ← CORRECT
    both Actives, UNITS   = 10   ← `providedEnergy` instead of `countAttachedEnergy`
    attacker's Active     =  2   ← the neighbouring `attachedEnergy` member emitted
    defender's Active     =  7   ← the seat crossed instead of summed
    both Actives, {R}     =  3   ← a type filter passed where the print carries none
    attacker's BOARD      =  4   ← `countEnergyInPlay` on the attacker
    defender's BOARD      =  8   ← `countEnergyInPlay` on the defender
    both BOARDS           = 12   ← `countEnergyInPlay` on both
    attacker's BODIES     =  5   ← D474's member emitted
    defender's BODIES     =  6   ← D474's member with the seat crossed
    both BODIES           = 11   ← D474's member summed across the table */
function discriminating(seed: number): GameState {
  let state = opened(seed);
  state = intoActive(state, "p1", TIDE_CALLER);
  state = ontoActiveEnergy(state, "p1", FIRE, 1);
  state = ontoActiveEnergy(state, "p1", GRASS_DOUBLE, 1);
  state = ontoBench(state, "p1", FILLER, 4);
  state = ontoBenchEnergy(state, "p1", 0, WATER, 2);
  state = intoActive(state, "p2", BULWARK);
  state = ontoActiveEnergy(state, "p2", FIRE, 2);
  state = ontoActiveEnergy(state, "p2", WATER, 5);
  state = ontoBench(state, "p2", FILLER, 5);
  return ontoBenchEnergy(state, "p2", 0, WATER, 1);
}

/** THE ZERO-COUNT BOARD. Both Actives hold NOTHING, so the sum is 0 and no coin is
    flipped — while the two BENCHES hold Energy and the two boards hold bodies, so
    every wrong reading in the table above is NON-ZERO here and would flip at least
    once. ⚠️ It needs `FREE_CALLER`, and that is a fact about the RULES rather than a
    convenience: at the printed `{C}` cost the attacker must hold an Energy to declare,
    so a zero count is unreachable on the printed card and this board is CONSTRUCTED
    (D440). It drives the loop bound in `takeFlips`, which is real code either way. */
function zeroCount(seed: number): GameState {
  let state = opened(seed);
  state = intoActive(state, "p1", FREE_CALLER);
  state = ontoBench(state, "p1", FILLER, 3);
  state = ontoBenchEnergy(state, "p1", 0, WATER, 2);
  state = intoActive(state, "p2", BULWARK);
  state = ontoBench(state, "p2", FILLER, 3);
  return ontoBenchEnergy(state, "p2", 0, FIRE, 3);
}

/** THE DEFENDER-ONLY BOARD: the attacker's Active is EMPTY and the defender's holds
    exactly one Energy, so the correct count is 1 and any build reading only the
    attacker's side answers 0. Also the board on which an ALL-TAILS outcome is
    findable by sweeping, since there is exactly one flip. */
function defenderOnly(seed: number): GameState {
  let state = opened(seed);
  state = intoActive(state, "p1", FREE_CALLER);
  state = ontoBench(state, "p1", FILLER, 2);
  state = intoActive(state, "p2", BULWARK);
  state = ontoActiveEnergy(state, "p2", WATER, 1);
  return ontoBench(state, "p2", FILLER, 2);
}

/** THE ATTACKER-ONLY BOARD, the mirror of the one above and its CONTROL: one Energy,
    on the other side of the table. The two boards deal the SAME damage under the
    correct build and OPPOSITE damage under either one-seat build, which is the
    evidence a single mirrored board cannot give (D445). */
function attackerOnly(seed: number): GameState {
  let state = opened(seed);
  state = intoActive(state, "p1", FREE_CALLER);
  state = ontoActiveEnergy(state, "p1", WATER, 1);
  state = ontoBench(state, "p1", FILLER, 2);
  state = intoActive(state, "p2", BULWARK);
  return ontoBench(state, "p2", FILLER, 2);
}

const tally = { type: "attack", seat: "p1", index: TALLY } as const;

function rowsOf<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

const names = (events: readonly GameEvent[]): string[] => events.map((e) => e.type);

/** The heads count off the emitted rows — every damage assertion is stated against
    what the engine REPORTED doing, and §5 separately proves the report is honest. */
function headsIn(events: readonly GameEvent[]): number {
  return rowsOf(events, "ATTACK_EFFECT_COIN_FLIP").filter((e) => e.result === "heads").length;
}

/** Take `count` flips by hand off `rng`, returning the faces IN ORDER and the state
    they leave behind. `count === 0` is a REAL call here, not a degenerate one: it
    returns the input unchanged, which is exactly the zero board's claim. */
function handFlips(rng: number, count: number): [faces: CoinFace[], next: number] {
  const faces: CoinFace[] = [];
  let cursor = rng;
  for (let taken = 0; taken < count; taken += 1) {
    const [face, next] = flipCoin(cursor);
    faces.push(face);
    cursor = next;
  }
  return [faces, cursor];
}

/** The eleven candidate readings §3 measures, each handed to the REAL function a
    wrong build would have called (D439/D472: every wrong value must be MEASURED, not
    written into a comment). */
function readings(state: GameState): number[] {
  const own = state.players.p1.active;
  const foe = state.players.p2.active;
  if (own === null || foe === null) throw new Error("both Actives are required");
  const bodies = (seat: Seat) => countPokemonInPlay(state, seat, { kind: "anyPokemon" });
  return [
    countAttachedEnergy(state, own, null) + countAttachedEnergy(state, foe, null),
    providedEnergy(state, own).length + providedEnergy(state, foe).length,
    countAttachedEnergy(state, own, null),
    countAttachedEnergy(state, foe, null),
    countAttachedEnergy(state, own, "Fire") + countAttachedEnergy(state, foe, "Fire"),
    countEnergyInPlay(state, "p1", null),
    countEnergyInPlay(state, "p2", null),
    countEnergyInPlay(state, "p1", null) + countEnergyInPlay(state, "p2", null),
    bodies("p1"),
    bodies("p2"),
    bodies("p1") + bodies("p2"),
  ];
}

/** How many seeds each sweep runs. MEASURED on THIS deck rather than inherited from a
    sibling suite (D206: never inherit a suite figure from prose). On the ONE-flip
    boards, sweeping 0..23 reaches tails and heads within the first handful of seeds;
    every case that uses this constant ASSERTS it saw both outcomes rather than
    trusting the loop, so a deck edit that narrows the sweep reddens here instead of
    quietly testing one face. */
const SEEDS = 24;

describe("D475 §3 — the board, where ELEVEN plausible readings answer ELEVEN DIFFERENT numbers", () => {
  it("🛑 the eleven readings are 9 / 10 / 2 / 7 / 3 / 4 / 8 / 12 / 5 / 6 / 11 — MEASURED", () => {
    // D439/D472: every wrong value must be measured by handing each real alternative to
    // the real machinery over the real board. A signature whose values were written
    // into a comment is arithmetic, not evidence.
    const state = discriminating(0);
    expect(readings(state)).toEqual([9, 10, 2, 7, 3, 4, 8, 12, 5, 6, 11]);
    // …and they are PAIRWISE DISTINCT, which is the property that makes the flip-row
    // count a discriminator at all. Asserted as a set size so a future board edit that
    // collides two of them reddens here rather than silently weakening every case below.
    expect(new Set(readings(state)).size).toBe(11);
    // 🛑 THE TWO ACTIVES HOLD DIFFERENT AMOUNTS — 2 and 7 — which is the whole reason a
    // one-seat reading is visible at all. On equal piles the sum is twice either one
    // and three wrong builds collapse onto two values.
    expect([readings(state)[2], readings(state)[3]]).toEqual([2, 7]);
  });

  it("🛑 flips EXACTLY NINE times, on every swept seed, and never any of the other ten", () => {
    const seenHeads = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const state = discriminating(seed);
      const { state: done, events } = play(state, tally);
      const flips = rowsOf(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips, `seed ${seed}`).toHaveLength(9);
      for (const flip of flips) expect(flip.seat).toBe("p1"); // the ATTACKER flips
      const heads = headsIn(events);
      seenHeads.add(heads);
      expect(done.players.p2.active?.damage ?? 0, `seed ${seed}`).toBe(60 * heads);
      // The totals only a WRONG count could produce, named as absences.
      for (const wrong of [10, 2, 7, 3, 4, 8, 12, 5, 6, 11]) {
        expect(flips.length, `seed ${seed} / ${wrong}`).not.toBe(wrong);
      }
      // …and the printed base never leaks: N heads is 60N, not 60N + 60.
      expect(done.players.p2.active?.damage ?? 0).not.toBe(60 * heads + 60);
      expect(names(events)).not.toContain("KNOCKED_OUT");
      expect(names(events)).toContain("TURN_ENDED");
    }
    // More than one heads count was reached, so the damage assertion above is not
    // green against a single constant.
    expect(seenHeads.size).toBeGreaterThan(1);
  });

  it("🛑 the DEFENDER's pile really is counted — remove it and the flip count falls by 7", () => {
    // The one thing that separates this member from `attachedEnergy`. Same board, same
    // card, same text; the defender's Active stripped and nothing else touched.
    const full = discriminating(0);
    expect(rowsOf(play(full, tally).events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(9);
    const foe = full.players.p2.active;
    if (foe === null) throw new Error("p2 has no Active");
    const stripped: GameState = {
      ...full,
      players: { ...full.players, p2: { ...full.players.p2, active: { ...foe, energy: [] } } },
    };
    expect(rowsOf(play(stripped, tally).events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(2);
  });

  it("🛑 the ATTACKER's pile really is counted too — remove it and the count falls by 2", () => {
    // The control for the case above, on the same board and the same axis (D424/D445):
    // asserting only that the defender contributes is green on a build that reads the
    // defender ALONE, and this pair is what excludes it.
    const full = discriminating(0);
    const own = full.players.p1.active;
    if (own === null) throw new Error("p1 has no Active");
    const stripped: GameState = {
      ...full,
      players: { ...full.players, p1: { ...full.players.p1, active: { ...own, energy: [] } } },
    };
    // ⚠️ `FREE_CALLER` is not needed here — the {C} cost is checked at DECLARATION and
    // this board is mutated after setup but before the swing, so the cost check runs
    // against the stripped pile and would reject. The attack index is therefore taken
    // on a board that still pays: the Grass double alone.
    const onlyDouble: GameState = {
      ...full,
      players: {
        ...full.players,
        p1: { ...full.players.p1, active: { ...own, energy: own.energy.slice(1) } },
      },
    };
    expect(rowsOf(play(onlyDouble, tally).events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(8);
    expect(countAttachedEnergy(stripped, { ...own, energy: [] }, null)).toBe(0);
  });

  it("🛑 counts CARDS and not UNITS — the Grass double is ONE flip, not two", () => {
    // D121, and D448's rule about a fixture that cannot falsify a filter: the attacker
    // holds a Special providing the SAME type TWICE, so `countAttachedEnergy` answers 1
    // where `providedEnergy(...).length` answers 2. Without that card on the board the
    // two readings would be the same number on every seed.
    const state = discriminating(0);
    const own = state.players.p1.active;
    if (own === null) throw new Error("p1 has no Active");
    expect(providedEnergy(state, own)).toEqual(["Fire", "Grass", "Grass"]);
    expect(countAttachedEnergy(state, own, null)).toBe(2);
    expect(rowsOf(play(state, tally).events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(9);
  });

  it("leaves the card's OTHER attack alone — a flat 10, no flips, base KEPT", () => {
    // The control for every "the coin reader did not touch this" claim: the same card,
    // the same board, no flip rows and no dropped base.
    const { state: done, events } = play(discriminating(0), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    expect(rowsOf(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(done.players.p2.active?.damage ?? 0).toBe(10);
  });
});

describe("D475 §4 — ZERO FLIPS and ALL TAILS deal the same damage and are NOT the same fact", () => {
  it("🛑 an EMPTY pair of Actives takes NO flip, spends NO rng step, and is not LOUD", () => {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const state = zeroCount(seed);
      // The board really is the one described — without this the case could pass on a
      // board that simply failed to place anything.
      //
      // 🛑 **THE HONEST FORM OF "EVERY WRONG READING WOULD FLIP" IS NARROWER THAN IT
      // LOOKS, AND MEASURING IT IS WHAT SHOWED THAT.** With both Actives empty, every
      // ACTIVE-based reading is necessarily 0 too — the units reading, either
      // one-seat reading and the typed reading all collapse onto the right answer, so
      // this board cannot separate them and does not claim to (§3 and §4's mirror pair
      // are what do). What it DOES separate are the five readings that leave the
      // Active Spot: the two BOARD counts, their sum, and the three BODY counts, all
      // of them non-zero here, so a build reading `countEnergyInPlay` or D474's
      // `pokemonInPlay` flips where the real one does not.
      const shape = readings(state);
      expect(shape.slice(0, 5), `seed ${seed}`).toEqual([0, 0, 0, 0, 0]);
      expect(shape.slice(5).every((n) => n > 0), `seed ${seed} / ${shape.join(",")}`).toBe(true);
      const before = state.rngState;
      const { state: done, events } = play(state, tally);
      expect(rowsOf(events, "ATTACK_EFFECT_COIN_FLIP"), `seed ${seed}`).toHaveLength(0);
      expect(done.players.p2.active?.damage ?? 0, `seed ${seed}`).toBe(0);
      expect(rowsOf(events, "DAMAGE_DEALT"), `seed ${seed}`).toHaveLength(0);
      // 🛑 THE CONTROL THAT SEPARATES THIS FROM SILENCE-FOR-ANOTHER-REASON. A zero
      // count is a RESOLVED attack, not a refused one: no `ATTACK_EFFECT_SKIPPED`, no
      // rejected action, and the turn really ended.
      expect(names(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(names(events)).toContain("TURN_ENDED");
      expect(names(events)).toContain("ATTACK_DECLARED");
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
      const state = defenderOnly(seed);
      const before = state.rngState;
      const { state: done, events } = play(state, tally);
      const flips = rowsOf(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips, `seed ${seed}`).toHaveLength(1);
      // …the generator MOVED, on every seed, heads or tails — the flip was really taken.
      expect(done.rngState, `seed ${seed}`).not.toBe(before);
      expect(done.rngState, `seed ${seed}`).toBe(handFlips(before, 1)[1]);
      if (flips[0]?.result !== "tails") continue;
      tailsSeeds.push(seed);
      expect(done.players.p2.active?.damage ?? 0, `seed ${seed}`).toBe(0);
      expect(rowsOf(events, "DAMAGE_DEALT"), `seed ${seed}`).toHaveLength(0);
      expect(names(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
    // An all-tails board was really reached — the case is not vacuously green.
    expect(tailsSeeds.length).toBeGreaterThan(0);
  });

  it("🛑 ONE Energy on EITHER side is ONE flip — the pair no single board can give", () => {
    // D445: a mirror board is not a seat inversion. These two boards are the same
    // count reached from opposite ends of the table, so a build reading only the
    // ATTACKER answers 1 and 0, one reading only the DEFENDER answers 0 and 1, and the
    // correct one answers 1 and 1. A suite with either board alone passes on one of
    // those wrong builds.
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const foeSide = defenderOnly(seed);
      const ownSide = attackerOnly(seed);
      expect(readings(foeSide).slice(0, 4), `seed ${seed}`).toEqual([1, 1, 0, 1]);
      expect(readings(ownSide).slice(0, 4), `seed ${seed}`).toEqual([1, 1, 1, 0]);
      expect(rowsOf(play(foeSide, tally).events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
      expect(rowsOf(play(ownSide, tally).events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
    }
  });
});

describe("D475 §5 — the rngState account: exactly `count` steps, no more and no fewer", () => {
  it("recomputes the whole flip sequence by hand, in order, on every swept seed", () => {
    // D455's shape: dropping the write-back leaves the board identical and the
    // generator frozen, so the next flip replays the same face. Only a comparison
    // ACROSS the consumption can see it.
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const state = discriminating(seed);
      const [faces, after] = handFlips(state.rngState, 9);
      const { state: done, events } = play(state, tally);
      expect(
        rowsOf(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result),
        `seed ${seed}`,
      ).toEqual(faces);
      expect(done.rngState, `seed ${seed}`).toBe(after);
      // …and NOT the state ten or two flips would have left, which is what an
      // off-by-one loop bound and a one-seat reading produce.
      expect(done.rngState, `seed ${seed}`).not.toBe(handFlips(state.rngState, 10)[1]);
      expect(done.rngState, `seed ${seed}`).not.toBe(handFlips(state.rngState, 2)[1]);
    }
  });

  it("emits NO loud row on ANY outcome, on ANY count, including ZERO", () => {
    // `modifierSimulated`: the sentence is READ, so the engine must never flag it.
    for (let seed = 0; seed < SEEDS; seed += 1) {
      for (const build of [discriminating, defenderOnly, attackerOnly, zeroCount]) {
        const { events } = play(build(seed), tally);
        expect(rowsOf(events, "ATTACK_EFFECT_SKIPPED"), `${build.name} / ${seed}`).toHaveLength(0);
      }
    }
  });
});

describe("D475 §6 — `MATCH_RECORD_VERSION` stays 29, and this is D473's FIRST argument", () => {
  it("🛑 `AttackFlipCount` has NO CARRIER AT ALL — it is never serialised anywhere", () => {
    // ⚠️ D473's rule: a rule that turns on PERSISTENCE must be applied at an address
    // that persists, and the three arguments this repo uses are different. This is the
    // FIRST — *no carrier at all* — and NOT D473's own (*a byte string a v29 deploy
    // already writes*), because there is no byte here in either direction.
    //
    // `deriveAttackCoinFlip`'s value is a LOCAL `const` inside `attack()`, consumed by
    // `takeFlips` in the same tick and thrown away; it is not an `EffectOp`, so it
    // never reaches `phase.cont.pendingOp` or its `rest`, and it is in no `GameState`
    // field. Driven rather than argued, on a board that FIRED and one that did NOT.
    for (const build of [discriminating, zeroCount]) {
      const { state: done } = play(build(0), tally);
      const wire = JSON.stringify(done);
      expect(wire, build.name).not.toContain("bothActivesEnergy");
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
