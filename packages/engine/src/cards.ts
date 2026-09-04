import { BASIC_ENERGY_TYPES } from "@luminous/schema";
import type { Attack, Card } from "@luminous/schema";
import type { ApplyResult } from "./actions";
import { err } from "./actions";
// TYPE-ONLY, and it must stay that way: effects.ts imports no engine module at
// runtime (only `import type { StatusName } from "./events"`), and events.ts in
// turn imports `type { DamageModifier }` back from here — so the cycle
// cards → effects → events → cards exists in the TYPE graph and is erased
// wholesale by `import type`. A value import along any of those three edges
// would make it a real one.
import type { CardFilter } from "./effects";
import type { GameState, InPlayPokemon, Seat } from "./types";

// The engine reads catalog data only through these accessors, so the exact
// Card surface it depends on (category, stage, retreat, hp, attacks,
// weakness/resistance, the energy name) stays one small, auditable module.

export function cardOfUid(state: GameState, uid: string): Card | undefined {
  const id = state.cardIdByUid[uid];
  return id === undefined ? undefined : state.cardPool[id];
}

/** `stage` uses the tcgdex vocabulary ("Basic" | "Stage1" | "Stage2" | …). */
export function isBasicPokemon(card: Card): boolean {
  return card.category === "Pokemon" && card.stage === "Basic";
}

/** 🆕 D387 — is `card` a **Stage 1** Pokémon (§10)? The predicate behind Paldean
    Tauros `sv08-018` "Spirited Tackle"'s antecedent: *"If your opponent's Active
    Pokémon is a **Stage 1** Pokémon, this attack does 90 more damage."*

    🛑 IT IS THE ROW BELOW WITH ONE PRINTED WORD CHANGED, AND THE ARGUMENT FOR
    WRITING IT AT ALL IS D262's OWN, ONE STAGE DOWN. `isEvolutionPokemon` two rows
    below is `evolveFromOf(card) !== null` — "any Evolution" — which a Stage 2, a
    VSTAR and a VMAX satisfy exactly as a Stage 1 does, so it cannot be NARROWED
    into this by a rider and reaching for it would score Paldean Tauros's +90
    against every evolved defender in the game. The printed adjective names ONE
    word, and one word is what this reads.

    ⚠️ IT READS THE PRINTED `stage` STRING FOR `isStage2Pokemon`'s REASON, and the
    same VSTAR case decides it: the catalog's `stage` vocabulary is
    `Basic | Stage1 | Stage2 | VSTAR | VMAX`, so a body that a CHAIN COUNT would
    call "one evolution deep" is not necessarily a Stage 1 and the printed word is
    the only datum that answers the sentence.

    ⚠️ AND IT IS A **CARD** READ, WHICH IS WHY IT LIVES HERE beside its sibling.
    The board read (whose Active, which seat) stays in `interpreter.ts`, which
    resolves the TOP card (§1.2 — a Basic that has evolved IS a Stage 1 now) and
    hands it here. */
export function isStage1Pokemon(card: Card): boolean {
  return card.category === "Pokemon" && card.stage === "Stage1";
}

/** D262 — is `card` a **Stage 2** Pokémon (§10)? The predicate behind Neo Upper
    Energy `sv05-162`'s antecedent: *"If this card is attached to a Stage 2
    Pokémon, this card provides every type of Energy but provides only 2 Energy at
    a time."*

    🛑 IT IS A NEW PREDICATE AND NOT A REUSE, WHICH WAS CHECKED BEFORE IT WAS
    WRITTEN. `matchesFilter` (effects.ts / interpreter.ts) carries a `stage`
    vocabulary (D245), but that vocabulary is `"basic"` and its else-arm is
    `evolveFromOf(card) !== null` — i.e. "any Evolution". It cannot express Stage 2
    and never could: a Stage 1 satisfies it exactly as a Stage 2 does. A build that
    reached for it would promote Neo Upper on a Stage 1 holder, which is the one
    mistake this sentence invites.

    ⚠️ IT READS THE PRINTED `stage` STRING RATHER THAN COUNTING THE EVOLUTION
    CHAIN, which is `isBasicPokemon`'s reading one row up, and it matters here: the
    catalog's `stage` vocabulary is `Basic | Stage1 | Stage2 | VSTAR | VMAX`
    (queried, remote D1 `luminous`, 2026-08-07), so a **VSTAR** — which sits two
    evolutions deep and would pass a chain count — is NOT a Stage 2 and correctly
    does not promote. The printed word is the datum the sentence names.

    ⚠️ AND IT IS A **CARD** READ, WHICH IS WHY IT LIVES HERE. Provision is computed
    on the HOLDER (continuous.ts `unitsOf`), but the question this answers is about
    one card's printed stage word, not about the board — so the board read stays in
    `continuous.ts`, which resolves the holder's TOP card and hands it here. */
export function isStage2Pokemon(card: Card): boolean {
  return card.category === "Pokemon" && card.stage === "Stage2";
}

/** The NAME of the Pokémon this card evolves from (§10 — the evolution goes
    on top of an in-play Pokémon whose top card has this name), or null when
    the card is a Basic / non-Pokémon and therefore evolves nothing. This is
    the discriminant for "is this an Evolution card": a non-null result. The
    `stage` field is not consulted — `evolveFrom` is the operative datum, and
    it is the one the ingest persists per catalog row. */
export function evolveFromOf(card: Card): string | null {
  return card.category === "Pokemon" ? (card.evolveFrom ?? null) : null;
}

/** 🆕 D302 — is `card` an **Evolution** Pokémon (§10)? The third predicate behind
    `EnergyProgram.promoteOnHolderStage`'s stage value, and Reversal Energy
    `sv04-266`'s antecedent: *"if this card is attached to an Evolution Pokémon
    that doesn't have a Rule Box…"*.

    🛑 IT IS `evolveFromOf` NEGATED-NULL AND DELIBERATELY **NOT** `!isBasicPokemon`,
    which is the one way this predicate can be written wrong. `isBasicPokemon`
    returns false for every TRAINER, ENERGY and unresolved row as well as for
    Evolutions, so its negation calls a Basic Energy card an Evolution Pokémon.
    That never bites at `unitsOf`'s call site (the holder is always a Pokémon), and
    it would bite the first time anything else asked — so the predicate is written
    to be true only of what it names, matching the doc block one row up which has
    called a non-null `evolveFrom` "the discriminant for 'is this an Evolution
    card'" since M4.

    ⚠️ AND IT IS THE **CHAIN** DATUM RATHER THAN THE PRINTED `stage` WORD, which is
    the opposite choice from `isStage2Pokemon` directly below and is right for the
    opposite reason. That predicate names ONE printed word, so it must read the
    printed word (a VSTAR sits two evolutions deep and is not a Stage 2). This one
    names the whole class ABOVE Basic, and the catalog's `stage` vocabulary is
    `Basic | Stage1 | Stage2 | VSTAR | VMAX` — so a `stage`-keyed reading would
    need four values kept in sync with the ingest, while `evolveFrom` is one datum
    that is non-null on exactly the four. A VMAX therefore IS an Evolution here,
    which is the printed reading; Reversal excludes it through `noRuleBox` (a
    SEPARATE term), never through this one. */
export function isEvolutionPokemon(card: Card): boolean {
  return evolveFromOf(card) !== null;
}

/** Basic and Special energy both occupy the one attach per turn (§6.3). */
export function isEnergyCard(card: Card): boolean {
  return card.category === "Energy";
}

/** A Special Energy (§6.1) — the catalog tags them `energyType: "Special"`
    (basic energies are "Normal"). Special energies carry rules text (provision,
    on-attach effects, holder conditions), authored in the registry
    (registry.ts EnergyProgram); an unauthored one degrades to a plain
    Colorless provider (continuous.ts providedEnergy) rather than a loud reject,
    since an energy always provides SOMETHING. */
export function isSpecialEnergy(card: Card): boolean {
  return card.category === "Energy" && card.energyType === "Special";
}

/** The provided-unit token for "any one type of Energy" (§6.4) — a WILDCARD
    that can pay any single typed OR Colorless cost symbol (Luminous Energy's
    "provides every type of Energy but only 1 at a time"). Distinct from
    "Colorless" as a PROVIDED unit, which pays only Colorless slots. No basic
    energy type is named this, so it is a safe sentinel in a provided list
    (costMet in attack.ts is the only reader). */
export const ANY_ENERGY = "Any";

/** Printed retreat cost; null (nothing printed / non-Pokémon) = free (§11). */
export function retreatCostOf(card: Card): number {
  return card.retreat ?? 0;
}

/** Printed max HP. Null is a DATA GAP (non-Pokémon / a bad row), not "0 HP":
    the KO check skips rather than insta-KOs — like retreatCostOf's null, the
    real fix belongs at ingest. A non-positive printed value is the same gap
    (schema/ingest let 0 through), so it reads as null too: any hp the KO
    check sees is > 0. */
export function hpOf(card: Card): number | null {
  return card.hp !== null && card.hp > 0 ? card.hp : null;
}

/** Printed attacks; [] for Trainers/Energy and attackless Pokémon. */
export function attacksOf(card: Card): readonly Attack[] {
  return card.attacks ?? [];
}

/** Prizes the KOing player takes for this Pokémon (§8.1): 3 for a VMAX, 2 for
    any other rule box (ex / V / VSTAR / GX), 1 for a plain Pokémon. The class is
    read off `pokemonSuffixOf` — the printed rule-box marker the NAME still
    carries after ingest drops tcgdex's `suffix` field — so no schema/ingest/DB
    change was needed to make an ex worth its two Prizes. The feared blast radius
    (the win condition + "almost every KO test") never landed: every existing KO
    test knocks out a plain body, so the whole suite stayed green; the new
    behaviour is pinned by prizeValue.test.ts (the KO→count wiring) and the unit
    cases in cards.test.ts. Both prize read sites clamp `count` to the Prizes that
    remain (flow.ts's takePrizes handler + the §14 tie-guard slice), so a 2-Prize
    KO with one Prize left takes the last one and wins rather than over-drawing. */
export function prizeValueOf(card: Card): number {
  const suffix = pokemonSuffixOf(card);
  if (suffix === null) return 1;
  return suffix === "VMAX" ? 3 : 2;
}

/** The printed rule-box SUFFIX of a Pokémon — the "V" / "VMAX" / "VSTAR" /
    "ex" / "GX" marker following the species name — or null for a plain Pokémon
    or a non-Pokémon. tcgdex drops its dedicated `suffix` field at ingest, but
    the marker is ALSO part of the card NAME (a Pokémon V is literally printed
    "<Species> V"), and the name IS persisted — so the datum survives, encoded
    in `name` rather than a lost column. Read LITERALLY: "V" does not match
    "VMAX"/"VSTAR" (each is its own suffix, none a space-then-"V"), which is
    exactly the distinction Choice Belt draws — "…Active Pokémon V" boosts a V,
    never a VMAX or VSTAR. The live catalog's Pokémon GO set (swsh10.5) IS an
    ingested prior-era set — it holds 13 Pokémon V, 2 VMAX and 5 VSTAR — so Choice
    Belt's gate is LIVE against those V, and Mewtwo VSTAR "Psy Purge" (swsh10.5-031)
    is the first authored VSTAR (D97). The SV-era sets alone hold none, which is
    why the gate lay dormant until swsh10.5 was ingested. */
export type PokemonSuffix = "ex" | "V" | "VMAX" | "VSTAR" | "GX";
export function pokemonSuffixOf(card: Card): PokemonSuffix | null {
  if (card.category !== "Pokemon") return null;
  const { name } = card;
  if (name.endsWith(" VMAX")) return "VMAX";
  if (name.endsWith(" VSTAR")) return "VSTAR";
  if (name.endsWith(" V")) return "V";
  if (name.endsWith(" ex")) return "ex";
  if (name.endsWith(" GX")) return "GX";
  return null;
}

/** Is this Pokémon an "ex" or a "V" — the two rule-box classes Mimikyu
    "Safeguard" prevents all damage from ("…your opponent's Pokémon ex and
    Pokémon V")? NOT VMAX/VSTAR/GX: the print names ex and V only, so this is
    narrower than `hasRuleBox` (which also matches VMAX/VSTAR/GX and Radiant).
    Read off the name-derived `pokemonSuffixOf`; non-Pokémon are always false. */
export function isExOrV(card: Card): boolean {
  const suffix = pokemonSuffixOf(card);
  return suffix === "ex" || suffix === "V";
}

/** §8.5 (D255) — the printed RULE-BOX CLASS an always-on prevention aura names of
    its ATTACKER, as a RECORD over the two axes the printed sentences actually
    vary. Two Standard-legal sentences inhabit it today (5 printings, measured over
    `abilities_json` with `legal_standard = 1` against the remote D1 `luminous`,
    2026-08-07, GROUPED BY SENTENCE):

      "…by attacks from your opponent's Pokémon ex."
        — Sylveon `sv08.5-040` "Safeguard", Crustle `sv10-012`/`-186`
          "Mysterious Rock Inn"  →  { suffix: "ex" }
      "…by attacks from your opponent's Basic Pokémon ex."
        — Farigiraf ex `sv05-108`/`-194` "Armor Tail"  →  { suffix: "ex",
          stage: "basic" }

    🛑 **A RECORD AND NOT A FLAT UNION, WHICH IS `AttackerClass`'s D239 ARGUMENT
    ARRIVING ON A SECOND FIELD** — and it is re-derived here rather than inherited,
    because the two vocabularies do not overlap (that one is `stage` + a printed
    *"non-{X}"* type exclusion; this one is `stage` + a printed rule-box SUFFIX).
    A flat `"ex" | "basicEx"` is the CROSS PRODUCT of the two printed axes: the day
    a *"Basic Pokémon V"* or a *"Stage 2 Pokémon ex"* sentence is ingested the union
    multiplies where the record merely gains a value, and each cross-product member
    would have to re-spell BOTH conjuncts in its own arm — two spellings of "Basic"
    that can disagree with §3.6/§5.2, which is exactly what `AttackerClass` refused.

    ⚠️ **`stage` IS ABSENT AND NOT `null` WHEN THE SENTENCE PRINTS NO STAGE WORD**
    (D135's absent-key rule), so `{ suffix: "ex" }` reads back as "an ex at ANY
    stage" — which is what Sylveon prints, and the direction that matters: a missing
    conjunct must WIDEN the class the sentence names, never narrow it.

    ⚠️ **AND `suffix` IS REQUIRED WHERE `stage` IS OPTIONAL, WHICH IS NOT
    SYMMETRY-FOR-ITS-OWN-SAKE.** A record with neither key would mean "prevent all
    damage from any attack at all", a rule no printing in this family states and one
    that must not be spellable by omission. Every sentence in the family names a
    rule-box class; only some of them name a stage. */
export interface PreventedAttackerClass {
  /** The printed rule-box SUFFIX ("…your opponent's Pokémon **ex**"), read through
      `pokemonSuffixOf`. Required — see above. */
  readonly suffix: PokemonSuffix;
  /** The printed STAGE word ("…your opponent's **Basic** Pokémon ex"), ABSENT when
      the sentence prints none. One member, and `switch`ed at the read rather than
      compared, for `attackerMatchesStage`'s reason (continuous.ts): that is what
      makes "closed vocabulary" a compiler fact instead of a comment. */
  readonly stage?: "basic";
}

/** §8.5 (D255) — does `attacker` belong to one of the printed rule-box CLASSES a
    holder's prevention aura names? The resolution half of `passivesOf`'s
    `preventDamageFromAttackerClasses`, and `preventsAttackerType`'s twin one column
    over (continuous.ts): the same "the gate is a fact about the ATTACKER, so it can
    only be answered where the attacker is known" split D107's `isExOrV` made first.

    ⚠️ **IT LIVES HERE AND ITS TWIN LIVES IN `continuous.ts`, AND THE SPLIT IS BY
    KIND RATHER THAN BY FAMILY.** `preventsAttackerType` reads `Card.types` against a
    `PokemonType` vocabulary effects.ts owns, and it sits beside the BOARD-reading
    `attackerHasSpecialEnergy` it was written with. This predicate reads NOTHING but
    the catalog row, through two functions that already live in this file
    (`pokemonSuffixOf` for the suffix, `isBasicPokemon` for the stage), and its
    vocabulary is owned here too — so placing it beside them costs zero imports and
    keeps the name parse and its one consumer in the same file. `hasPrintedAbility`
    (D251) is the direct precedent: a pure CARD read, in `cards.ts`.

    ⚠️ **THE STAGE CONJUNCT IS `isBasicPokemon` VERBATIM AND NOT A SECOND READING OF
    "Basic"** — `attackerMatchesStage`'s reason inherited: the printed phrase "Basic
    Pokémon ex" makes the same claim about a card that setup placement and the bench
    play make, and a second reading would be a second chance to disagree with
    §3.6/§5.2. Read off the attacker's TOP card (its current identity, §1.2), which
    is what the call sites already hold: a Basic ex that has evolved is a Stage 1 and
    Farigiraf's aura stops protecting against it, which is what the printed word
    means.

    ⚠️ **THE SUFFIX IS AN EQUALITY ON `pokemonSuffixOf` AND DELIBERATELY NOT
    `isExOrV`.** Mimikyu's sentence names ex AND V; these five name ex ALONE, so
    reusing `isExOrV` would silently widen all five printings to protect against
    every Pokémon V in the pool. The two are one character apart in the source and a
    whole printed clause apart in meaning, which is why this reads the SUFFIX rather
    than any existing rule-box predicate.

    `undefined` (no resolvable attacking card) is FALSE — `preventsAttackerType`'s
    conservative direction verbatim: an unreadable attacker protects LESS rather than
    more. Structurally unreachable for a declared attack (attacks come from the
    Active) and answered anyway, because these reads must be TOTAL. An EMPTY list is
    the common case (no such holder on the board) and short-circuits before any card
    read. */
export function preventsAttackerClass(
  classes: readonly PreventedAttackerClass[],
  attacker: Card | undefined,
): boolean {
  if (classes.length === 0 || attacker === undefined) return false;
  const suffix = pokemonSuffixOf(attacker);
  if (suffix === null) return false;
  return classes.some(
    (cls) =>
      cls.suffix === suffix && (cls.stage === undefined || matchesStage(attacker, cls.stage)),
  );
}

/** The stage conjunct alone, split out so the `switch` can be the whole BODY of a
    `boolean` function — continuous.ts `attackerMatchesStage`'s shape verbatim, and
    for its reason: that is what makes exhaustiveness a compiler fact (a new `stage`
    member leaves the function with a code path returning `undefined`). Folded inline
    it would merely fall out of the switch and answer `true`, which is the silent-
    WIDENING failure this family must not have. */
function matchesStage(
  attacker: Card,
  stage: NonNullable<PreventedAttackerClass["stage"]>,
): boolean {
  switch (stage) {
    case "basic":
      return isBasicPokemon(attacker);
  }
}

/** Does this Pokémon have a Rule Box (§ the reminder text Artazon prints:
    "Pokémon ex, Pokémon V, etc. have Rule Boxes.")? — the negated predicate of
    Artazon "Basic Pokémon that doesn't have a Rule Box". A Rule Box is the grey
    banner behind the rules text of the special-mechanic Pokémon: the suffix
    families (ex / V / VMAX / VSTAR / GX, off `pokemonSuffixOf`) PLUS Radiant
    Pokémon, whose marker is a NAME PREFIX ("Radiant Greninja") rather than a
    trailing suffix — the same name-encoded datum, read the other end. LIMITATION
    like `pokemonSuffixOf`: this is name-derived because tcgdex's structured
    markers are dropped at ingest, so any future Rule-Box family that is neither
    a known suffix nor the Radiant prefix would read as no-Rule-Box until named
    here (ACE SPEC is a Trainer subtype, so it never reaches this Pokémon-only
    check). Non-Pokémon are always false. */
export function hasRuleBox(card: Card): boolean {
  if (card.category !== "Pokemon") return false;
  return pokemonSuffixOf(card) !== null || card.name.startsWith("Radiant ");
}

/** Does this Pokémon HAVE an Ability — the gate the 5-printing attacker-property
    prevent names ("…by your opponent's Pokémon **that have an Ability**" —
    Cornerstone Mask Ogerpon ex "Cornerstone Stance", sv06-112/-199/-215 and
    sv08.5-058/-160)? `isExOrV`'s sibling one predicate over,
    and the contrast with it is the whole reason this is its own function rather
    than an inline `.length > 0` at four read sites: the rule-box classes are a NAME
    PARSE of a datum tcgdex drops at ingest, while "has an Ability" is an INGESTED
    COLUMN (`Card.abilities`, nullable array) — so this predicate cannot rot the way
    `pokemonSuffixOf` documents itself as able to.

    ⚠️ IT READS THE PRINTED CARD AND DELIBERATELY NOT THE BOARD, which is the one
    judgement it makes. A §9 Ability-lock (Klefki sv01-096 "Mischievous Lock")
    SUPPRESSES an Ability's effect; it does not remove the Ability from the card, and
    a Pokémon whose Ability has been turned off still *has* one. So this takes a
    `Card` and no `GameState`: there is nothing on the board it could correctly
    consult. Contrast `passivesOf`'s own §9 drop, which is about the HOLDER of the
    prevention (that one IS an Ability and a lock must silence it) — the two §9
    answers on this gate point opposite ways and that is not a contradiction.

    `undefined` (no resolvable attacking card) is FALSE — continuous.ts
    `preventsAttackerType`'s conservative direction verbatim, and the reason this
    takes an optional where `isExOrV` beside it does not: two of the four read sites
    hold the attacker as `Card | undefined`, so the narrowing would otherwise be
    spelled twice. NON-Pokémon are false through the same `abilities` read — a
    Trainer's catalog row carries `null` there. */
export function hasPrintedAbility(card: Card | undefined): boolean {
  return (card?.abilities ?? []).length > 0;
}

/** What one attached Energy card provides toward a cost (§6.3). Catalog
    basic energies carry no `types` — the NAME is the datum, and real prints
    spell it both ways: "Fire Energy" and "Basic Darkness Energy"
    (sv06.5-098). The vocabulary is the shared BASIC_ENERGY_TYPES (§6.1,
    @luminous/schema) — INGEST DEBT: provision should become Card data at
    ingest; until then the name parse lives here. Anything unparseable
    (a special energy's fancy name) conservatively provides 1 Colorless: it can
    pay colorless slots, never typed ones (§6.4). This is the FALLBACK for an
    UNAUTHORED special energy — an authored one provides through its registry
    EnergyProgram instead (continuous.ts providedEnergy). */
export function energyProvidesOf(card: Card): string {
  const named = /^(?:Basic )?(.+) Energy$/.exec(card.name)?.[1];
  if (
    card.energyType === "Normal" &&
    named !== undefined &&
    (BASIC_ENERGY_TYPES as readonly string[]).includes(named)
  ) {
    return named;
  }
  return "Colorless";
}

export function matchesFilter(card: Card | undefined, filter: CardFilter): boolean {
  if (card === undefined) return false;
  switch (filter.kind) {
    case "basicPokemon": {
      // `noRuleBox` (Artazon) drops the ex/V/…/Radiant Rule-Box Pokémon; a plain
      // `basicPokemon` (Nest Ball) takes any Basic.
      // D265 — `maxHp` is the printed HP THRESHOLD ("a Basic Pokémon with 70 HP
      // or less": Buddy-Buddy Poffin, Alomomola "Gentle Fin"). It reads the
      // PRINTED hp off the card, which is what makes it expressible here at all;
      // the "HP or less REMAINING" printings (Bianca's Devotion, Ledian) are a
      // board read of current HP and are unreachable from this function by
      // construction — `matchesFilter` is never handed an `InPlayPokemon`.
      //
      // ⚠️ THE NULL IS DECIDED HERE RATHER THAN BY THE COMPARISON. `hpOf` returns
      // null for a non-Pokémon and for a non-positive printed value (a data gap),
      // and `null <= 70` is TRUE in JavaScript — so `hpOf(card)! <= max` would
      // silently widen the noun to everything with no HP. An unknown HP does not
      // satisfy "70 HP or less", so a null is REFUSED. `isBasicPokemon` already
      // excludes the Trainers, which makes this a belt-and-braces guard on the
      // data gap alone rather than on the category — stated, because a reader who
      // assumes the category guard covers it will delete this one.
      const hp = hpOf(card);
      return (
        isBasicPokemon(card) &&
        (filter.noRuleBox !== true || !hasRuleBox(card)) &&
        (filter.maxHp === undefined || (hp !== null && hp <= filter.maxHp))
      );
    }
    case "anyPokemon":
      // D264 — `noRuleBox` (Lana's Aid) drops the ex/V/…/Radiant Rule-Box
      // Pokémon at ANY stage; a plain `anyPokemon` (Super Rod / Sacred Ash) takes
      // any Pokémon. The conjunct is `basicPokemon`'s BYTE FOR BYTE, minus that
      // member's stage question, which is the entire printed difference between
      // "a Basic Pokémon that doesn't have a Rule Box" and "Pokémon that don't
      // have a Rule Box".
      return card.category === "Pokemon" && (filter.noRuleBox !== true || !hasRuleBox(card));
    case "evolutionPokemon":
      // An Evolution Pokémon (Jacq) — one that evolves from another Pokémon.
      // `evolveFromOf` returns null for non-Pokémon and for a Basic, so a
      // non-null result is the exact complement of `basicPokemon`.
      return evolveFromOf(card) !== null;
    case "stagePokemon":
      // 🆕🆕 D466 — the printed STAGE ORDINAL ("your Stage 1 Pokémon in play",
      // "each Stage 2 Pokémon on your Bench"). DELEGATED to `isStage1Pokemon` /
      // `isStage2Pokemon` rather than spelled as `card.stage === filter.stage`,
      // which is D159's rule and those two functions' own: one reading of "Stage 1",
      // one implementation, so this arm and `opponentActiveIsStage1`
      // (interpreter.ts, D387) cannot drift about a card. Both helpers carry the
      // `category === "Pokemon"` conjunct, so a Trainer named "Stage 2" is false
      // through the same read rather than through a guard beside it.
      //
      // 🛑 IT IS DELIBERATELY **NOT** THE ARM ONE LINE UP NARROWED. A VSTAR and a
      // VMAX satisfy `evolveFromOf(card) !== null` and are NEITHER ordinal, which is
      // the whole reason this member exists; the printed word is the datum.
      //
      // A TERNARY rather than a nested `switch`: `stage` is closed at two values by
      // the union, so an `else` cannot be reached by a third and the exhaustiveness
      // question is answered one level up.
      return filter.stage === "Stage1" ? isStage1Pokemon(card) : isStage2Pokemon(card);
    case "typedPokemon": {
      // D238 — a Pokémon of a printed TYPE ("up to 3 {D} Pokémon", "a Basic {G}
      // Pokémon"). THREE conjuncts, and the middle one is the whole member:
      //   • `category === "Pokemon"` — the catalog gives a Trainer `types: null`
      //     today, but the `?? []` below is what makes that a fact about this
      //     predicate rather than about the ingest;
      //   • `types.includes(…)` and NOT `types[0] === …`: the column is an ARRAY
      //     and dual-type Pokémon are printed, so "{R} Pokémon" must admit a
      //     ["Fire","Grass"] body. An equality read would drop them silently;
      //   • the printed stage word when there is one — `isBasicPokemon`, the same
      //     discriminant the `basicPokemon` member carries, re-read here because
      //     "a Basic {G} Pokémon" is ONE noun phrase and not two.
      // ⚠️ D245 — the stage arm is now `ownerPokemon`'s BYTE FOR BYTE, and it was
      // the one that was wrong: D238 read `stage !== undefined` as "Basic",
      // because `"basic"` was the only value the type admitted. The printed
      // "Evolution {R} Pokémon" / "Evolution {M} Pokémon" (2 sentences, 4 legal
      // printings, measured at HEAD) is what the union was missing, and a
      // widening of the TYPE alone would have left this line silently answering
      // "is it Basic?" to a filter that says "evolution".
      // ⚠️ D275 — the FOURTH conjunct is D265's HP threshold ("up to 3 {C}
      // Pokémon with 100 HP or less": Fan Rotom "Fan Call"), and it is
      // `basicPokemon`'s line BYTE FOR BYTE twelve lines up — the same `hpOf`
      // call and the same NULL REFUSAL, because `null <= 100` is TRUE in
      // JavaScript and an unknown HP does not satisfy "100 HP or less". Reused
      // rather than re-derived so the two nouns can never disagree about a card
      // the catalog prints with a missing HP.
      const typedHp = hpOf(card);
      return (
        card.category === "Pokemon" &&
        (card.types ?? []).includes(filter.pokemonType) &&
        (filter.stage === undefined ||
          (filter.stage === "basic" ? isBasicPokemon(card) : evolveFromOf(card) !== null)) &&
        (filter.maxHp === undefined || (typedHp !== null && typedHp <= filter.maxHp))
      );
    }
    case "anyOf":
      // D245 — the union's first COMBINATOR ("your {G} Pokémon and {R} Pokémon").
      // `.some`, not `.every`: the printed "and" names a SET whose membership each
      // attacker is asked about one at a time, so a `{G}`-only body is in it. An
      // intersection reading would restrict the aura to dual-type Grass/Fire
      // bodies, of which the Standard pool holds none — a sentence that pays
      // nobody. An EMPTY list is therefore false, which is the right unit: it
      // names the empty set, exactly as `.some` says.
      return filter.filters.some((inner) => matchesFilter(card, inner));
    case "abilityPokemon":
      // D285 — a Pokémon that HAS an Ability (Team Rocket's Arbok "Potent
      // Glare"). ONE conjunct and no category test of its own: `hasPrintedAbility`
      // reads `Card.abilities`, which the catalog leaves null on every Trainer and
      // every Energy, so a non-Pokémon is false through the same read rather than
      // through a guard that could drift away from it. The PRINTED-card reading
      // (a §9 Ability lock silences an Ability; it does not remove it) is that
      // function's own documented judgement, inherited here rather than re-made.
      return hasPrintedAbility(card);
    case "attackNamePokemon":
      // 🆕🆕 D446 — a Pokémon that HAS a printed attack of that NAME ("your Pokémon
      // in play that has the Round attack"). ONE conjunct and no category test of
      // its own, which is `abilityPokemon`'s arm directly above BYTE FOR BYTE one
      // card field over: `attacksOf` reads `Card.attacks`, which the catalog leaves
      // null on every Trainer and every Energy, so a non-Pokémon is false through
      // the same read rather than through a guard that could drift away from it.
      //
      // ⚠️ `.some` AND AN EXACT `===`, AND BOTH ARE DELIBERATE. A card may print
      // two attacks and the sentence names ONE, so the question is membership and
      // not `attacks[0]`; and the comparison is `byName`'s exact equality rather
      // than a substring, because no member of this union does substring matching
      // at any width and the printed noun does not ask for one. A misspelled name
      // matches the empty set — a loud zero on every board, never a wrong card.
      return attacksOf(card).some((attack) => attack.name === filter.attack);
    case "suffixPokemon":
      // 🆕🆕 D446 — a Pokémon of a printed RULE-BOX CLASS ("your opponent's Pokémon
      // ex in play"). An EQUALITY on `pokemonSuffixOf` and deliberately NOT
      // `isExOrV`, which is D255's own call at the prevention aura re-read here:
      // `isExOrV` is the ex-OR-V disjunction, so reusing it for the bare "Pokémon
      // ex" noun would silently widen that sentence to count Pokémon V as well.
      // The pool prints the PAIR too, and the pair is spelled where it is printed —
      // as an `anyOf` of two suffixes (effects.ts `IN_PLAY_BODY_NOUNS`), which is
      // the combinator's stated purpose and keeps this arm a single equality.
      // `pokemonSuffixOf` returns null for a non-Pokémon, so the category question
      // is answered inside the read, exactly as it is one arm up.
      return pokemonSuffixOf(card) === filter.suffix;
    case "ownerPokemon":
      // An owner-prefixed subgroup Pokémon (Cynthia's Gabite "Champion's Call").
      // THREE conjuncts, and each one is load-bearing:
      //   • `category === "Pokemon"` — `Team Rocket's Energy` (sv10-182) carries
      //     the prefix and is not one, and the sentence that names the subgroup is
      //     printed on that very card;
      //   • the NAME PREFIX with its trailing space, matched exact-case (the
      //     `hasRuleBox` "Radiant " read, one field over);
      //   • the printed stage word when there is one — re-read here rather than
      //     delegated to the `basicPokemon` / `evolutionPokemon` members, which
      //     answer a different question about a different noun phrase.
      // `evolveFromOf(card) !== null` is `evolutionPokemon`'s own discriminant,
      // so "Evolution X's Pokémon" and "an Evolution Pokémon" agree by
      // construction on every card in the catalog.
      return (
        card.category === "Pokemon" &&
        card.name.startsWith(`${filter.owner}'s `) &&
        (filter.stage === undefined ||
          (filter.stage === "basic" ? isBasicPokemon(card) : evolveFromOf(card) !== null))
      );
    case "toolCard":
      // A Pokémon Tool card (Town Store) — the attachTool discriminant.
      return card.category === "Trainer" && card.trainerType === "Tool";
    case "basicEnergy":
      return (
        isEnergyCard(card) &&
        card.energyType === "Normal" &&
        (filter.energyType === undefined || energyProvidesOf(card) === filter.energyType)
      );
    case "byName":
      return card.name === filter.name;
    case "supporter":
      return card.category === "Trainer" && card.trainerType === "Supporter";
    case "item":
      // D231 — an Item Trainer, `supporter`'s arm one value over. ⚠️ A Pokémon
      // Tool is NOT one: since SM they are separate printed subtypes, and the
      // ingested column agrees (116 `Item` rows, 60 `Tool`, no row both).
      return card.category === "Trainer" && card.trainerType === "Item";
    case "stadium":
      // D231 — a Stadium Trainer (41 catalog rows); with `item` above, all four
      // printed Trainer subtypes are now spellable.
      return card.category === "Trainer" && card.trainerType === "Stadium";
    case "trainerCard":
      // D237 — the printed "a Trainer card" (Wailord sv08-087). ONE conjunct, and
      // the ABSENCE of a `trainerType` read is the whole point: this is the
      // category, not a disjunction of the four subtypes above, so a fifth
      // printed subtype is admitted the day it is ingested rather than silently
      // excluded. Strictly wider than each of `supporter` / `item` / `stadium` /
      // `toolCard`, and driven as such.
      return card.category === "Trainer";
    case "anyCard":
      // D231 — the printed uncategorised "a card" / "cards". TRUE for every real
      // card: the `card === undefined` guard at the top of this function is what
      // keeps a dangling uid out, so this arm means "any card" and not "any uid".
      return true;
    case "pokemonOrBasicEnergy":
      // A basic Energy is `energyType: "Normal"` (Special is excluded, matching
      // Super Rod's "Basic Energy"); a Pokémon is any category "Pokemon".
      return card.category === "Pokemon" || (isEnergyCard(card) && card.energyType === "Normal");
    case "anyEnergy":
      // Any Energy card — Basic OR Special (Poppy moves "up to 2 Energy").
      return isEnergyCard(card);
    case "specialEnergy":
      // A SPECIAL Energy only (Giacomo / Mawile) — the exact complement of
      // `basicEnergy` inside `anyEnergy`, off the catalog's own tag.
      return isSpecialEnergy(card);
    case "providesEnergy":
      // FALSE, always — and deliberately, not as a gap. This function scans
      // cards in a DECK, HAND or DISCARD PILE (searchDeck / lookAtTopN /
      // discardPileRetrieval), and provision is a while-ATTACHED property ("As
      // long as this card is attached to a Pokémon, it provides…"): a card in a
      // pile is attached to nothing and provides nothing. The in-play scanner
      // `matchesAttached` is where this filter is answered, with the host it
      // needs. So authoring `providesEnergy` into a pile-scanning op yields an
      // empty candidate set — a loud no-op, never a wrong card — where guessing
      // "a Basic Energy of that type" would silently take the wrong print
      // (Decidueye's "Basic {G} Energy card from your hand" is the row that
      // really wants `basicEnergy`, and it says CARD for exactly this reason).
      return false;
  }
}

export interface ParsedDamage {
  /** The numeric part — what M2 applies. */
  base: number;
  /** The printed marker ("+", "×", "?") when the number is not the whole
      story; the rest of that story is an M4 effect op (simulator.md: the
      damage field encodes an op). Null = the number IS the whole story. */
  modifier: string | null;
}

/** An attack's `damage` is a number, a marker string ("60+", "20×", "?"),
    or absent (pure-effect attacks). */
export function parseAttackDamage(damage: Attack["damage"]): ParsedDamage {
  if (damage === undefined) return { base: 0, modifier: null };
  if (typeof damage === "number") return { base: damage, modifier: null };
  // [\s\S] keeps the fallback TOTAL: an interior newline must still split as
  // (digits, marker-rest) and flag a modifier, not silently parse as 0.
  const parsed = /^(\d*)([\s\S]*)$/.exec(damage.trim());
  const digits = parsed?.[1] ?? "";
  const marker = (parsed?.[2] ?? "").trim();
  return { base: digits === "" ? 0 : Number(digits), modifier: marker === "" ? null : marker };
}

/** How a printed weakness/resistance value modifies attack damage (§8.5),
    kept structured so the DAMAGE_DEALT event can hand an animator the exact
    math: modern weakness multiplies ("×2"), older eras printed additive
    weakness ("+20" — e.g. dp5-4), resistance subtracts ("-30"/"−30"). */
export interface DamageModifier {
  op: "multiply" | "add" | "subtract";
  amount: number;
}

/** The shared weakness/resistance lookup: find the first entry naming any of
    the attacker's types and parse its printed value into an operation. A
    value matching NO printed format — genuinely unknown garble now that all
    three prints parse — falls back to the caller's modern-era default
    (×2 weakness / −30 resistance [current]). Null = no matching entry. */
function weakResModifier(
  attacker: Card,
  entries: Card["weaknesses"],
  fallback: DamageModifier,
): DamageModifier | null {
  const types = attacker.types ?? [];
  for (const entry of entries ?? []) {
    if (!types.includes(entry.type)) continue;
    const parsed = /^([×xX+\-−])(\d+)$/.exec(entry.value?.trim() ?? "");
    const amount = parsed?.[2] === undefined ? undefined : Number(parsed[2]);
    if (parsed === null || amount === undefined) return fallback;
    if (parsed[1] === "+") return { op: "add", amount };
    if (parsed[1] === "-" || parsed[1] === "−") return { op: "subtract", amount };
    return { op: "multiply", amount };
  }
  return null;
}

/** §8.5 Weakness: how the Defender's printed weakness modifies the damage
    when it names any of the attacker's types. Null = not weak. */
export function weaknessOf(attacker: Card, defender: Card): DamageModifier | null {
  return weakResModifier(attacker, defender.weaknesses, { op: "multiply", amount: 2 });
}

/** §8.5 Resistance: how the Defender's printed resistance modifies the
    damage when it names any of the attacker's types. Null = no resistance. */
export function resistanceOf(attacker: Card, defender: Card): DamageModifier | null {
  return weakResModifier(attacker, defender.resistances, { op: "subtract", amount: 30 });
}

/** Apply one parsed modifier at its §8.5 pipeline step. Flooring at 0 is the
    pipeline's job (attack.ts), not the modifier's. */
export function applyDamageModifier(damage: number, modifier: DamageModifier | null): number {
  if (modifier === null) return damage;
  switch (modifier.op) {
    case "multiply":
      return damage * modifier.amount;
    case "add":
      return damage + modifier.amount;
    case "subtract":
      return damage - modifier.amount;
  }
}

/** The top of the stack defines the Pokémon's identity (§1.2). Stacks are
    never empty, but indexing has to admit undefined. */
export function topUid(pokemon: InPlayPokemon): string | undefined {
  return pokemon.stack[pokemon.stack.length - 1];
}

export function topCardOf(state: GameState, pokemon: InPlayPokemon): Card | undefined {
  const uid = topUid(pokemon);
  return uid === undefined ? undefined : cardOfUid(state, uid);
}

/** A seat's Active with its stack-top uid and catalog card resolved in one
    go, or null when the spot is empty (or the stack/catalog has a gap —
    structurally impossible for engine-built states, but indexing has to
    admit it). The one helper for the `active === null ? undefined :
    topUid(active)` guard chain every Active-reading site was spelling out. */
export function activeTop(
  state: GameState,
  seat: Seat,
): { active: InPlayPokemon; uid: string; card: Card } | null {
  const active = state.players[seat].active;
  if (active === null) return null;
  const uid = topUid(active);
  if (uid === undefined) return null;
  const card = cardOfUid(state, uid);
  if (card === undefined) return null;
  return { active, uid, card };
}

/** The "a Basic Pokémon out of your own hand" check shared by the two setup
    placements and the in-turn bench play (§3.6–§3.7, §5.2). Returns the
    rejection, or null when the play is legal. M2's evolution play adds its
    own timing rules on top of the same hand/uid resolution. */
export function basicFromHandError(state: GameState, seat: Seat, uid: string): ApplyResult | null {
  if (!state.players[seat].hand.includes(uid)) {
    return err("CARD_NOT_IN_HAND", `${uid} is not in ${seat}'s hand`);
  }
  const card = cardOfUid(state, uid);
  if (card === undefined) {
    return err("UNKNOWN_CARD", `no catalog card for uid ${uid}`);
  }
  if (!isBasicPokemon(card)) {
    return err("NOT_A_BASIC_POKEMON", `${card.name} is not a Basic Pokémon`);
  }
  return null;
}
