import type { Card } from "@luminous/schema";
import type {
  AttackerClass,
  HandPlayClass,
  PokemonPlayAct,
  StampedPlayLockKey,
} from "./effects";
import type { DrawReason, GameEvent, StatusName } from "./events";
import type { EffectContinuation, EffectPrompt } from "./interpreter";

// The whole GameState is a plain JSON-safe value — no classes, no Date, no
// functions — so snapshots serialize, replay and structurally share. Nothing
// in the engine ever mutates a state it was given; reducers build the next
// state out of spreads over the old one.

export type Seat = "p1" | "p2";

/** Seat labels are NOT turn order — the coin-flip winner chooses who goes
    first (rules §3.3), recorded in `GameState.firstPlayer`. */
export const SEATS: readonly Seat[] = ["p1", "p2"];

export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

// Rule constants (docs/reference/ptcg-rules.md §2–§3).
export const DECK_SIZE = 60;
export const HAND_SIZE = 7;
export const PRIZE_COUNT = 6;
export const BENCH_MAX = 5;

/** §12/§13.1 — the HP a Poisoned Pokémon takes at each Checkup unless the
    inflicting effect raised it ("put N damage counters … instead of 1"). */
export const DEFAULT_POISON_DAMAGE = 10;

/** 🆕🆕 §8 step 3 (D501) — the HP a Confused Pokémon places on ITSELF when the
    attack flip comes up tails, unless the inflicting effect raised it
    ("Put N damage counters instead of 3 on that Pokémon for this Special
    Condition."). `DEFAULT_POISON_DAMAGE`'s twin, and the printed default is a
    RULE constant rather than a per-card fact: the rulebook's 3 counters, ×10
    (§12: one counter = 10 HP). Both printed "instead of" sentences in the legal
    column state the engine's own default back to it — Poison's `instead of 1`
    against `DEFAULT_POISON_DAMAGE`, Confusion's `instead of 3` against this one
    — which is why both anchors spell the default LITERALLY rather than capturing
    it (a printed `instead of 5` would be a card misstating the rule, and
    refusing it keeps the sentence on the loud ATTACK_EFFECT_SKIPPED path). */
export const DEFAULT_CONFUSION_DAMAGE = 30;

/** §12 condition shape: {Asleep, Paralyzed, Confused} are mutually exclusive
    (one card rotation — applying one REPLACES the others), Poisoned/Burned
    coexist with each other and with the rotation. Set by M3's attack effects
    (effects.ts), ticked by the Pokémon Checkup (flow.ts runCheckup). Poison
    carries its counter amount rather than a bool because §12/§13.1 let
    effects raise it ("Poisoned; put 2 damage counters instead of 1").

    🆕🆕 **D501 — `confusionDamage` IS THE SECOND RAISED-AMOUNT FIELD HERE, AND IT
    IS NOT `poisonDamage`'s SHAPE.** `poisonDamage` doubles as Poison's own FLAG
    (`presentStatuses` reads `> 0`, so 0 means "not Poisoned"); Confusion's flag is
    `rotation === "confused"`, a different field, so this one is a PURE AMOUNT with
    a printed default and **0 is not a sentinel here**. It is read at exactly one
    site — attack.ts's §8 step-3 flip — and only when the rotation is `confused`,
    so a value left standing on a cured body is never consulted; `applyStatus`
    rewrites it on every confusion, which is what keeps a raised amount from
    surviving a cure into the next application (driven in
    `confusionDamage.test.ts` §4 rather than asserted).

    🛑 **REQUIRED, AND THE BUMP IS OWED — 29 → 30.** See
    `MATCH_RECORD_VERSION`'s own block for the argument; the short form is that
    this address is inside `MatchRecord.state` and the two shipped `satisfies
    SpecialConditions` guards (redact.ts `copyConditions`, projection.ts
    `battleStateOf`) exist so that an added engine field is a COMPILE ERROR rather
    than a silent drop — and an OPTIONAL key defeats both of them silently. */
export interface SpecialConditions {
  rotation: "none" | "asleep" | "paralyzed" | "confused";
  /** Damage placed on it at each Checkup while Poisoned; 0 = not Poisoned. */
  poisonDamage: number;
  burned: boolean;
  /** 🆕🆕 D501 — HP this Pokémon places on itself when the §8 step-3 Confusion
      flip misses; `DEFAULT_CONFUSION_DAMAGE` unless the inflicting effect raised
      it. Meaningful only while `rotation === "confused"`. */
  confusionDamage: number;
}

export function noConditions(): SpecialConditions {
  return {
    rotation: "none",
    poisonDamage: 0,
    burned: false,
    // 🆕🆕 D501 — the DEFAULT, not a zero. This function is the whole CLEAR
    // (retreat, evolve, benching, the "recovers from all Special Conditions"
    // op), so a cured body must go back to the rulebook's 3 counters rather than
    // to a value no printing means.
    confusionDamage: DEFAULT_CONFUSION_DAMAGE,
  };
}

/** §12 — Asleep and Paralyzed are the rotation states that prevent both
    attacking (§8) and retreating (§11); Confused restricts neither gate.
    The action handlers keep their own distinct error codes/messages. */
export function isImmobilized(conditions: SpecialConditions): boolean {
  return conditions.rotation === "asleep" || conditions.rotation === "paralyzed";
}

/** The conditions present, in the event vocabulary — the stable order
    (rotation, then poisoned, then burned) that a "benched"/"evolved"/switched
    STATUS_CLEARED lists. Shared by retreat + evolve (turn.ts) and the effect
    switch (interpreter.ts) so the ordering can't drift between them. */
export function presentStatuses(conditions: SpecialConditions): StatusName[] {
  const statuses: StatusName[] = [];
  if (conditions.rotation !== "none") statuses.push(conditions.rotation);
  if (conditions.poisonDamage > 0) statuses.push("poisoned");
  if (conditions.burned) statuses.push("burned");
  return statuses;
}

/** §11/§15.B — an attack-installed BLOCK on one Pokémon, with the printed
    DURATION baked in as a turn STAMP. The printed sentences are

      "Flip a coin. If heads, during your opponent's next turn, prevent all
       damage FROM AND EFFECTS OF attacks done to this Pokémon."   (11 printings)
      "Flip a coin. If heads, during your opponent's next turn, prevent all
       damage done to this Pokémon by attacks."                    ( 2 printings)
      "During your opponent's next turn, prevent all damage done to this
       Pokémon by attacks from Basic Pokémon."                     ( 3 printings)

    and the differences between them are exactly the two optional fields below:
    `effects` widens WHAT is refused, `fromClass` narrows WHOSE attacks are
    refused at all. BOTH of the first two refuse damage; only the first refuses
    the rest of what an attack does to the body; only the third asks anything
    about the attacker.

    ⚠️ A TURN STAMP, NOT A FLAG — D124's decision, taken again for a reason of its
    own. `turn` is the ONE turn number on which the block is live: the installing
    attack runs during turn N and ends it (§5.3), so the opponent's next turn is
    turn N + 1 and that is what gets stamped. The block then expires BY ARITHMETIC
    (`turn === state.turn` stops holding) with no turn-boundary clear anywhere —
    which matters more here than it did at D124, because the §13.4 paralysis clock
    D112 reused for `retreatBlocked` is the WRONG clock for this shape. That clear
    fires for the seat whose turn just ENDED, and this block sits on the
    INSTALLER's own Pokémon rather than on the defender's: the very first Checkup
    after the attack has `endedSeat === the holder's seat`, so a paralysis-clock
    clear would lift the block one whole turn early, before its window ever opens.
    A stamp has no such mirror to get backwards.

    NOT a §12 Special Condition, for `retreatBlocked`'s reasons verbatim: no
    Checkup tick, no status chip, no `StatusName`, and it never crosses the wire
    (`RedactedConditions`/`BattleConditions` pin that shape field by field). What
    it DOES share with `retreatBlocked` is the early ending: it is an effect of an
    ATTACK, so it ends the moment the Pokémon leaves the Active Spot or evolves
    (§10) — see `clearOnLeavingActive` (turn.ts), `switchInto` (interpreter.ts)
    and `placeEvolution` (turn.ts). A Knocked Out holder takes it out of play with
    the rest of the stack.

    ONE INSTALLATION PER RECORD, and the window is part of the installation:
    a durated effect whose window is a DIFFERENT turn (Ninetales
    sv03-029/-199 "Nine-Tailed Dance" — "During YOUR next turn, this Pokémon can't
    attack", i.e. turn N + 2) cannot share this `turn` and gets its own stamped
    field. What it DOES inherit is everything else: the stamp convention, the
    three early-clear sites, and the read-through-continuous.ts shape. That field
    landed at D143 (`InPlayPokemon.attackLockedTurn` below) and the forecast held
    exactly: nothing here changed, and the two windows coexist on ONE body. */
export interface AttackBlock {
  /** The single turn number this block is live on (the installing turn + 1). */
  turn: number;
  /** Whether it also refuses the EFFECTS of attacks and not only their damage —
      the printed words "from and effects of". The catalog prints the parenthetical
      that settles the reading on Bronzong sv03-145: **"(Damage is not an effect.)"**
      So the two halves are disjoint, and a placed damage COUNTER — which this
      engine has ruled is not attack damage since `damageActive` (D138/D139) — falls
      entirely on the effects side. */
  effects: boolean;
  /** §11 (D146) — the printed ATTACKER-CLASS filter: present exactly when the
      sentence narrows the block to attacks "from {class} Pokémon", ABSENT when
      the block refuses every attacker (D135's absent-key rule, and the same
      polarity `effects` is under — the printed words are what ADD the key, and a
      producer that forgets one blocks differently rather than wrongly).

      ⚠️ IT IS EVALUATED AT THE READ SITES, NOT HERE, and that is the same split
      `PassiveEffects.preventDamageFromExV` is already under (continuous.ts): the
      ATTACKER is not knowable at install time — the block is written on the
      installer's own body during the installer's own turn, and the Pokémon it
      will refuse has not declared anything yet — so the record stores the printed
      TOKEN and `attackBlockOf` resolves it against the attacker each read.

      ⚠️ A CLOSED VOCABULARY, AND EVERY MEMBER IS ONE THE POOL PRINTS A READABLE
      DATUM FOR. The pool prints FOUR class phrases on this sentence, and the
      split is between a datum and a BANNER rather than between easy and hard:
      *"Basic"* (1 legal — Dipplin sv07-013) and *"Basic non-{C}"* (7 legal —
      Terapagos ex "Crown Opal") are BOTH answerable, because `stage` and `types`
      are catalog columns; *"Ancient"* (1, Iron Moth sv06.5-009) is not, because
      the Ancient/Future banner is printed on the card FACE and appears in NO
      field of the persisted catalog and NONE of tcgdex's own card model (checked
      upstream against Roaring Moon ex sv04-124, the canonical Ancient print — it
      serves `suffix: "ex"` for a rule box and nothing at all for the banner). So
      the Ancient sentence has no reader because it has no DATUM, and it stays
      LOUD rather than being answered by a hand-authored species list — the
      species is not even the right key, since the SAME species is printed both
      with the banner (sv04+) and without it (Great Tusk ex sv01-123). The fourth,
      Miraidon sv08-069's *"each of your Future Pokémon … from Pokémon ex"*, is
      refused by its TARGET rather than by its class (effects.ts
      `PREVENT_DAMAGE_FROM_CLASS`).

      ⚠️ IT IS AN `AttackerClass` RECORD RATHER THAN A STRING, AND THAT IS D239's
      whole edit here. `stage` stays a one-member closed vocabulary so
      `attackerMatchesClass` (continuous.ts) keeps its EXHAUSTIVE switch — a
      second stage word cannot be added without the compiler demanding the
      predicate that reads it — while the printed *"non-{X}"* exclusion rides an
      OPTIONAL key on the same record instead of multiplying the vocabulary by
      the eleven-code type wheel. effects.ts `AttackerClass` carries the two
      arguments for that shape.

      🛑 THE SHAPE CHANGE IS WHY `MATCH_RECORD_VERSION` WENT 12 → 13. D146's
      records persist `fromClass: "Basic"`, a string the new type does not
      describe at all; unlike D146's own *addition* of an optional key (which left
      every older record a valid inhabitant — see apps/api match.ts), this is a
      TYPE the old value fails, so the old record is retired rather than read
      benignly. D124's rule, third application. */
  fromClass?: AttackerClass;
  /** §8.5/§11 (D240) — the printed DAMAGE CAP: present exactly when the sentence
      narrows the block to attacks whose damage is *"{N} or less"*, ABSENT when the
      block refuses an attack of any size (D135's absent-key rule, and the same
      polarity `effects` and `fromClass` are under — the printed words are what ADD
      the key).

      "During your opponent's next turn, prevent all damage done to this Pokémon
       by attacks if that damage is 40 or less."        (2 legal — sv10.5w-046/-127)
      "…if that damage is 60 or less."                  (1 legal — sv09-002)

      ⚠️ IT IS THE THIRD FIELD ON THIS RECORD AND THE FIRST ONE THAT IS A NUMBER,
      and it narrows on an axis neither of the other two touches: `effects` widens
      WHAT is refused, `fromClass` narrows WHOSE attack is refused, `maxDamage`
      narrows HOW BIG an attack may be and still be refused. All three are read at
      the read sites rather than at install time, for `fromClass`'s reason exactly
      — none of the three facts is knowable when the block is written onto the
      installer's own body.

      ⚠️ IT IS AN UPPER BOUND, AND THE NAME SAYS THE DIRECTION ON PURPOSE. The pool
      prints the OPPOSITE polarity too — Drednaw `sv07-044`, *"…if that damage is
      200 **or more**"* — but it prints it as an always-on ABILITY, so it is a
      `passivesOf` catalog aura and not an installation at all, and it could not
      ride this record even if the comparator were stored. effects.ts
      `PREVENT_DAMAGE_UP_TO_CAP` captures the comparator token anyway and REFUSES
      anything but *"or less"*, so the direction is a checked fact rather than a
      silent assumption.

      ⚠️ THE NUMBER IT IS COMPARED AGAINST IS THE ONE THAT WOULD ACTUALLY BE
      PLACED — post-Weakness, post-Resistance, post-reduction, floored at 0 —
      which is D240's rules reading and is written out in full at
      continuous.ts `attackBlockOf`, the one place that comparison happens.

      ⚠️ NO `MATCH_RECORD_VERSION` BUMP. This is a key ADDED, so every record the
      previous deploy persisted is still an inhabitant of the new type with the
      key absent, and absent means exactly what those records already meant (no
      cap). That is D146's own no-bump case verbatim — and the contrast with D239,
      which RETYPED `fromClass` and did owe a bump, is the whole test: not "did a
      field change" but "can the previous deploy's RECORD hold the new TYPE". */
  maxDamage?: number;
}

/** §8.5/§11 (D147) — an attack-installed DAMAGE REDUCTION on one Pokémon, with
    the printed DURATION baked in as a turn STAMP exactly as `AttackBlock` above
    bakes its own. The printed sentences are

      "During your opponent's next turn, this Pokémon takes {20|30|50} less
       damage from attacks (after applying Weakness and Resistance)."  (12)
      "Discard all Energy from this Pokémon. During your opponent's next turn,
       this Pokémon takes 100 less damage from attacks (after applying Weakness
       and Resistance)."                                               ( 2)

    ⚠️ IT IS A THIRD PARALLEL STAMPED FIELD RATHER THAN A GENERALISED RECORD, AND
    THE VERDICT WAS RE-DERIVED RATHER THAN INHERITED (D143 deferred the call to
    this slice; D147's entry in decisions.md carries the whole argument). The
    short form: D143 predicted this reading would be the first to genuinely SHARE
    a read path with `attackBlock`, which is what a union pays for. It does share
    the four damage SITES — but sharing a SITE is not sharing a QUESTION. Each
    site still asks two independent things at two different steps of §8.5 ("by
    how much is this reduced?" is subtracted; "is it prevented outright?"
    supersedes), so a discriminated union would not shorten one read; it would
    replace a field access the compiler checks with a list search it cannot.

    ⚠️ AND THE DECIDING FACT IS THAT THIS IS NOT A NEW READING AT ALL. The pool
    prints this exact sentence MINUS its four-word duration prefix as an
    always-on Ability on FOUR printings — Bouffalant sv03-174 "Bouffer" (20),
    Stonjourner sv01-121 "Exoskeleton" (20), Copperajah ex sv02-150/-245 "Bronze
    Body" (30) — and all four have been simulated since 0.x as
    `PassiveEffects.damageReductionAfterWR`, read at the same four damage sites.
    So this field is a SOURCE feeding a number the engine already computes, not a
    second channel: the four read sites SUM it into `passivesOf`'s aggregate and
    nothing else about the pipeline moves. One reading, one implementation
    (D131), across the catalog/state boundary.

    It is kept OUT of `passivesOf` itself for two reasons, both structural rather
    than stylistic: that function is documented as the CATALOG scan (printed
    passives + attached Tools), which is the distinction `attackBlockOf`'s doc
    block draws between an aura and an installation; and it SUPPRESSES a holder's
    own printed passive under a §9 Ability-lock aura, which an attack-installed
    effect must be immune to — an installation is not an Ability. Summing at the
    sites keeps that immunity structural instead of positional.

    THE WINDOW IS `state.turn + 1` — the same number `AttackBlock.turn` carries
    (both print "During your OPPONENT's next turn"), and the reason this is still
    a separate record rather than a field inside `AttackBlock`: that record's
    whole meaning at five read sites is "damage is PREVENTED", and its filter
    (`fromClass`) is folded into `attackBlockOf` so a non-matching attacker makes
    the read return null. A reduction living inside it would either prevent
    everything or vanish for the attackers the filter refuses. Same window, two
    different answers.

    Everything else is INHERITED from `AttackBlock` unchanged: the stamp
    convention, the read-through-continuous.ts shape (`installedReductionOf`),
    the three §10 early clears, and D124's no-defensive-`undefined` rule at the
    reader. */
export interface DamageReduction {
  /** The single turn number this reduction is live on (the installing turn + 1). */
  turn: number;
  /** HP subtracted from attack damage AFTER Weakness and Resistance — the
      printed parenthetical, and the whole of why the number is stored rather
      than applied. §8.5's order makes the two placements observably different:
      Weakness is MULTIPLICATIVE, so a 90 Metal hit into a ×2 Metal body carrying
      100 of this is `90 × 2 − 100 = 80`, while the same numbers subtracted first
      clamp to `max(0, 90 − 100) × 2 = 0` — the difference between taking 80 and
      being immune. (Resistance and this number are both additive and commute, so
      the parenthetical only ever bites on WEAKNESS; the suite drives that.)

      Four amounts are printed — 20, 30, 50 and 100 — and they are ONE capture in
      the anchor rather than four rows, because the varying token is a NUMBER and
      a number is closed by its type (D120's precondition met, unlike the open
      consequent vocabularies that get one anchor each). */
  amount: number;
}

/** 🆕🆕 §13 (D434, GENERALISED AT D435) — a DELAYED EFFECT scheduled onto one
    Pokémon by an attack, with the printed clock baked in as a turn STAMP exactly as
    `AttackBlock`, `DamageReduction` and `AttackDamageDebuff` bake theirs. The family
    is THREE printed sentences / SIX legal printings, ONE clock and THREE payloads,
    and D435 closes it:

      "At the end of your opponent's next turn, put 9 damage counters on the
       Defending Pokémon."                                       (3)   D434 counters
      "At the end of your opponent's next turn, discard the Defending Pokémon and
       all attached cards."                                      (1)   D435 discard
      "Discard all Energy from this Pokémon. At the end of your opponent's next
       turn, the Defending Pokémon will be Knocked Out."          (2)   D435 knockOut

    🛑 **THE DISCARD AND THE KNOCK OUT ARE NOT THE SAME PAYLOAD, AND THE DIFFERENCE
    IS A PRIZE CARD.** §8.1 (`docs/reference/ptcg-rules.md`) defines a Knock Out as
    *"damage ≥ its current HP"* and says *"the player **who KO'd** the Pokémon takes
    prize card(s)"* — the prize is owed BY the Knock Out and by nothing else. Row 53
    prints *discard*, which removes the body to its owner's discard pile with no
    Knock Out anywhere in the sentence, so **no Prize is taken**; row 113 prints
    *"will be Knocked Out"*, so one is. Both remove the body, both empty the Active
    Spot, both owe a promotion — and the only board difference is the prize row.
    They would collapse into one "remove the body" payload in any implementation that
    reasoned from the board instead of from the sentence, which is why they are two
    members here rather than one with a flag. `delayedCounters.test.ts` §12 drives the
    two on ONE axis: same board, same clock, one Prize taken and one not.

    ⚠️ **THE ENGINE ALREADY HELD BOTH HALVES OF THE DISTINCTION AND THEY AGREE WITH
    THE RULE.** `returnSelf` with `dest: "discard"` (D313, Revavroom ex `sv06.5-015`/
    `-081` — *"Discard this Pokémon and all attached cards."*) removes a body to the
    discard pile, emits `POKEMON_RETURNED` and stages **no** `takePrizes`; `knockOut`
    (flow.ts) stages one. The two payloads below reach exactly those two shipped
    seams, so neither invents a prize rule.

    🛑 **IT IS THE FIRST FACT IN THIS ENGINE THAT SCHEDULES WORK RATHER THAN
    GATING IT, AND THAT IS THE WHOLE OF WHY IT IS A NEW SHAPE.** Every other
    durated record on `InPlayPokemon` is READ by code that was going to run anyway
    — §8.5 asks `installedReductionOf` while it is already computing a hit, §11
    asks `retreatLocked` while it is already validating a retreat. Nothing reads
    this one. A stamp alone is INERT: the §13 Checkup has to go looking for it,
    which is why the mechanism is a stamp PLUS a firing site (flow.ts `runCheckup`)
    and why either half alone is a build that resolves and does nothing.

    ⚠️ A RECORD AND NOT A BARE STAMP, WHICH IS `damageReduction`'s SHAPE RATHER
    THAN `noWeaknessTurn`'s — and the deciding question is D432's, asked again
    rather than inherited: does the printed sentence carry anything besides a
    clock? It carries an AMOUNT (9 counters), and the amount is a `(\d+)` capture
    in the anchor rather than a literal, so the record has to hold it. That is the
    one axis on which this field differs from the bar D432 built.

    🛑 **AND THE RECORD HAVING A SECOND KEY DOES *NOT* BUY D421's OPTIONAL ROAD —
    THIS IS THE FINDING, AND IT SHARPENS D432's RULE RATHER THAN APPLYING IT.**
    D421's mitigation is *choose the REST of the record so that losing the key is
    detectable*, and the rest it means is the rest that ALREADY EXISTS in the
    records a previous deploy wrote. Both keys here arrive in the SAME deploy, so
    they cannot witness each other's loss: a v27 record has no `scheduledCounters`
    at all, not a `scheduledCounters` missing one key. **A "rest" must be OLD, not
    merely PLURAL.** (The field was called `scheduledCounters` at D434 and is
    `scheduledEffect` from D435; the historical names are kept in this paragraph
    because a provenance note that renames itself stops being one.)

    🛑 **AND A RECORD-VALUED FIELD FAILS DIFFERENTLY FROM D432's BARE STAMP, WHICH
    WAS MEASURED RATHER THAN ASSUMED — THIS PARAGRAPH FIRST CLAIMED THE BENIGN SOFT
    LANDING AND WAS WRONG (D425: correct it in place and say so).** A missing
    `noWeaknessTurn` reads as `undefined === state.turn`, i.e. FALSE, and the bar
    silently stops existing. A missing `scheduledCounters` reads as
    `undefined !== null`, and `scheduledCountersDue`'s very next comparison
    dereferences `.turn` — so a v27 record does not lose a rule on this deploy, **it
    dies at the next turn boundary**, because every Checkup calls that reader on the
    ended seat's Active. The reader carries no defensive `=== undefined` arm on
    purpose: `attackBlockOf` and `installedReductionOf` (continuous.ts) are the two
    shipped record-valued fields and both say in their own comments that the
    absent-key arm is `MATCH_RECORD_VERSION`'s job, not theirs. So the field is
    REQUIRED and the constant goes 27 → 28 — for a SHARPER reason than D432's rather
    than the same one. An OPTIONAL key would have forced the tolerant reader, and
    THAT is where the loss becomes D124's benign soft landing: both roads driven side
    by side in `delayedCounters.test.ts` §8.

    🛑🆕🆕 **D435 — AND THIS TIME D421's PRECONDITION IS GENUINELY MET, THE OPTIONAL
    ROAD IS GENUINELY AVAILABLE, AND IT IS STILL REFUSED. THE RULE IS NOT "REQUIRED
    ALWAYS"; IT IS "MEASURE WHAT THE LOSS DEGRADES INTO".** D435 turns this record
    into a DISCRIMINATED UNION, which is a new REQUIRED key (`kind`) plus a RENAME of
    the type, the field (`scheduledCounters` → `scheduledEffect`) and the reader
    (`scheduledCountersDue` → `scheduledEffectDue`). Either half alone moves
    `MATCH_RECORD_VERSION` (D359: *"a WIDENING is free and a RENAME is not"*; D386: a
    new required key on a persisted structure), so **28 → 29**, and the two reasons
    are independent rather than one argument counted twice.

    The optional road was priced properly rather than dismissed, because the two
    refusals this run already recorded do NOT reach it:

      · D432's rule — *a record with no rest must be required* — does not apply.
        This record HAS a rest.
      · D434's sharpening — *a rest must be OLD, not merely PLURAL* — is, for the
        first time, SATISFIED. `{turn, amount}` were both written by the v28 deploy,
        so a v28 record IS a `scheduledEffect` missing exactly one key, which is
        precisely the shape D421's mitigation is written for. **A `kind?: "counters"`
        defaulting to counters would have kept every v28 byte string meaning what it
        meant, and would have cost no bump.**

    🛑 **IT IS REFUSED ON D421's OWN CRITERION, APPLIED RATHER THAN COPIED (D425).**
    The criterion is *choose the rest of the record so that LOSING the key is
    DETECTABLE*. Measure what losing it actually does here: a v29-authored
    `{turn, kind: "discard"}` that drops its `kind` reads as the counters member with
    `amount === undefined`, the Checkup computes `damage + undefined` → **`NaN`**, and
    `isLethallyDamaged` answers `NaN >= hp` → **false**. The body is not discarded, is
    not Knocked Out, cannot ever be Knocked Out again, and the board looks entirely
    normal. That is neither D124's benign soft landing nor a loud failure — it is
    silent CORRUPTION, which is strictly the worst of the three, and it is driven in
    `delayedCounters.test.ts` §8 rather than argued.

    So the sequence now has three entries and they are three different reasons:
    D432 *no rest*, D434 *rest not old*, **D435 *rest old, optional available, and the
    degradation is NaN rather than a soft landing***. */
export type ScheduledEffect =
  /** The COUNTER placement (D434, corpus row 54). `amount` is HP, i.e. the printed
      COUNTER COUNT × 10 (§12's one-counter-is-10 conversion, `DEFENDER_POISON_N`'s
      `poisonDamage` convention verbatim). Stored in HP rather than in counters so
      the Checkup's placement is `damage + amount` with no second unit conversion —
      the same reason `DamageReduction.amount` and `SpecialConditions.poisonDamage`
      are both HP. */
  | { turn: number; kind: "counters"; amount: number }
  /** 🆕🆕 The DISCARD (D435, corpus row 53) — the body and everything attached to
      it leave play for their OWNER's discard pile, and **no Prize is taken**. No
      payload beyond the clock: the printed sentence names no amount, no filter and
      no narrowing. */
  | { turn: number; kind: "discard" }
  /** 🆕🆕 The KNOCK OUT (D435, corpus row 113's tail) — §8.1 in full, **including
      the Prize**. Payload-free for the same reason the discard is. */
  | { turn: number; kind: "knockOut" };

/** §8.5/§11 (D149) — an attack-installed ATTACK-DAMAGE DEBUFF on one Pokémon,
    with the printed DURATION baked in as a turn STAMP exactly as `AttackBlock`
    and `DamageReduction` above bake theirs. The printed sentences are

      "During your opponent's next turn, the Defending Pokémon's attacks do
       {20|30} less damage (before applying Weakness and Resistance)."   (3)
      "During your opponent's next turn, attacks used by the Defending Pokémon
       do 100 less damage (before applying Weakness and Resistance)."    (2)

    ⚠️ IT IS `DamageReduction`'s MIRROR ON BOTH AXES AT ONCE, AND THAT IS THE
    WHOLE SLICE. That record is installed on the ATTACKER's own body and read at
    the DEFENDER's step (subtracted AFTER Weakness and Resistance, from what the
    holder TAKES). This one is installed on the DEFENDER's body and read at the
    ATTACKER's step (subtracted BEFORE Weakness and Resistance, from what the
    holder DEALS). Same `{ turn, amount }` shape, same window, same three §10
    clears, opposite body and opposite step — and the printed sentences are told
    apart by ONE WORD inside the parenthetical.

    ⚠️ SO THE PARENTHETICAL IS NOT DECORATION, IT IS THE TAXONOMY. The pool prints
    "N less damage" 31 times across two mechanisms (D147's census, re-run for this
    slice): twenty printings say "(after applying Weakness and Resistance)" and
    are D147's/`passivesOf`'s incoming reduction, five say "(before …)" and are
    this. A reader keying on the verb phrase would have shipped five attacks
    backwards, which is why both anchors carry the parenthetical inside `^…$`.

    ⚠️ IT IS A FOURTH PARALLEL STAMPED FIELD, AND THAT IS D147's ANSWER RE-RUN
    RATHER THAN INHERITED. §D147 declined the `attackBlock` generalisation and
    named three triggers for re-opening it: a printing that REMOVES the effects of
    attacks (the pool has none — re-censused here), a projection that must SHOW
    the durated riders as a LIST (none crosses the wire; this field does not
    either), and a FIFTH stamped field. This is the fourth, which §D147 explicitly
    said is NOT the trigger. And the deciding fact holds here in the same form it
    held there: the number this field feeds is one the read sites already compute
    — `attackerPreWRBonus`'s total (interpreter.ts) has been a pre-W/R adjustment
    to an attacker's output since Vitality Band — so there is no read path to
    unify, only a term to subtract.

    ⚠️ AND IT IS A SECOND TERM RATHER THAN A SIGNED BONUS. Folding the debuff into
    `attackerPreWRBonus`'s return would have been one line and zero call-site diff,
    and it is REFUSED on three grounds that are all observable rather than
    stylistic: (1) `DAMAGE_DEALT.bonus` is a REPORTED field documented as "flat HP
    the attacker's continuous effects ADDED", emitted only when positive, so a
    signed number would silently drop a −100 from the row and from the log a player
    reads; (2) that function is `passivesOf`'s fold — the CATALOG scan, suppressed
    under a §9 Ability-lock aura — and an attack INSTALLATION must be immune to
    that suppression, which is D147's own structural reason for keeping
    `installedReductionOf` out of `passivesOf`, read on the other side of the
    table; and (3) the debuff is the only one of the two that can drive the
    subtotal NEGATIVE, so it owns a clamp the bonus has never needed. Three
    reasons, and any one of them alone would decide it.

    Everything else is INHERITED from `DamageReduction` unchanged: the stamp
    convention, the read-through-continuous.ts shape
    (`installedAttackDebuffOf`), the `Math.max` merge, the three §10 early clears,
    and D124's no-defensive-`undefined` rule at the reader. */
export interface AttackDamageDebuff {
  /** The single turn number this debuff is live on (the installing turn + 1 —
      the VICTIM's own next turn, since declaring an attack ends the turn). */
  turn: number;
  /** HP subtracted from every damage this Pokémon's attacks do, BEFORE Weakness
      and Resistance — the printed parenthetical, and the whole of why the number
      is stored rather than applied.

      §8.5's order makes the two placements observably different, and in the
      OPPOSITE direction from `DamageReduction.amount`: Weakness is
      MULTIPLICATIVE, so a printed 120 Water hit into a ×2 Water body from an
      attacker carrying 100 of this is `max(0, 120 − 100) × 2 = 40`, while the
      same numbers subtracted after the modifiers give `120 × 2 − 100 = 140` —
      the difference between a chip and a near-lethal. (Resistance and this number
      are both additive and commute, so the parenthetical only ever bites on
      WEAKNESS; the suite drives both.)

      ⚠️ NO ACTIVE-SPOT SCOPE, AND THE CENSUS IS THE ARGUMENT. Every pre-W/R
      printing in the pool that ADDS damage names its target — Vitality Band,
      Defiance Band, Choice Belt, Practice Studio, Binding Mochi, Kingambit,
      Galvantula, Okidogi, Moltres/Articuno/Zapdos all say "to your opponent's
      Active Pokémon" — and NEITHER of the two sentences that SUBTRACT says
      anything of the kind. So this number comes off every damage the holder's
      attack does, the Bench included, where `damageBonusBeforeWR` correctly does
      not reach. Four read sites, the same four `installedReductionOf` is read at.

      Two amounts are printed — 20 and 30 on one anchor, 100 on the other — and
      each anchor carries ONE capture rather than a row per amount, the varying
      token being a NUMBER and therefore closed by its type (D120's precondition,
      met exactly as D147 met it). */
  amount: number;
}

/** §9/§11 (D152, WIDENED D456) — an attack-installed REACTIVE RECOIL on one
    Pokémon, with the printed DURATION baked in as a turn STAMP exactly as
    `AttackBlock`, `DamageReduction` and `AttackDamageDebuff` above bake theirs.
    THREE printed sentences, **8 legal printings**, measured off
    `legalAttackCorpus()`:

      "During your opponent's next turn, if this Pokémon is damaged by an attack
       (even if it is Knocked Out), put 8 damage counters on the Attacking
       Pokémon."                                            (corpus line 178, 5)
      "…(even if this Pokémon is Knocked Out), put 6 damage
       counters…"                                           (corpus line 179, 1)
      "…(even if this Pokémon is Knocked Out), put damage counters on the
       Attacking Pokémon equal to the damage done to this
       Pokémon."                                            (corpus line 180, 2)

    🛑 **THE HEADER HERE USED TO SAY "One printed sentence, two printings … put 10
    damage counters … Lycanroc ex sv02-117 / sv02-241 'Scary Fangs'".** That is the
    phantom sentence D454 found; D455 corrected the copy in `interpreter.ts` and
    reported *"corrected in place"*, and this was one of six live copies it did not
    reach. The card ids are stated as UNRESOLVED rather than repaired (D425 — this
    checkout has no D1), because ids quoted against a sentence that does not exist
    cannot be trusted to name the printings of the one that does.

    ⚠️ IT IS `DamageReduction`'s SIBLING ON EVERY AXIS BUT THE READ SITE, and that
    is the whole shape of the slice. Same holder ("this Pokémon" — the installer's
    own Active), same `state.turn + 1` window (the sentence prints "During your
    opponent's next turn" and declaring an attack ENDS the turn, §5.3), same
    `{ turn, amount }` record, same three §10 clears, same `Math.max` merge. What
    differs is WHICH number it feeds: that one is subtracted at §8.5 step 5, this
    one is ADDED at the §9 reactive recoil (attack.ts), the site that already sums
    `passivesOf().damageAttacker`.

    ⚠️ AND THAT MAKES IT THE THIRD FIELD IN THE FAMILY WHOSE READ IS A SUM ACROSS
    THE CATALOG/STATE BOUNDARY, which is the fact the generalisation argument turns
    on (decisions.md D152). The pool prints this exact mechanism MINUS its duration
    on four always-on printings — Cacnea sv01-005 / Cacturne sv01-006
    "Counterattack Quills" (3 counters), Stunfisk sv03-112 "Custom Trap" (5,
    `requiresTool`) and Rocky Helmet sv01-193 (2, a Pokémon TOOL) — all simulated
    since 0.x as `PassiveEffects.damageAttacker` and folded by `passivesOf`. So
    this field is a SOURCE feeding a number the engine already computes, not a
    second channel: the ONE read site sums it into that fold and nothing else about
    §9 moves. One reading, one implementation (D131).

    It is kept OUT of `passivesOf` for `installedReductionOf`'s TWO REASONS
    VERBATIM: that function is the CATALOG scan (printed passives + attached
    Tools), which is the aura/installation distinction `attackBlockOf`'s doc block
    draws; and it SUPPRESSES a holder's own printed passive under a §9
    Ability-lock aura, which an attack INSTALLATION must be immune to — an
    installation is not an Ability. Summing at the site keeps that immunity a
    property of where the number comes from.

    ⚠️ AND THE SUM IS OBSERVABLE ON A BOARD THE CARDS THEMSELVES BUILD: a Lycanroc
    ex carrying this 100 and wearing Rocky Helmet retaliates for 120 in ONE
    `COUNTERS_PLACED` row labelled `"counterattack"` — D141's judgement re-run with
    a THIRD provenance (an attack) in the sum it said no label could name. No new
    `COUNTERS_PLACED` member, which is the test of whether D141's axis was right. */
export interface InstalledRecoil {
  /** The single turn number this recoil is live on (the installing turn + 1). */
  turn: number;
  /** The GUARANTEED FLOOR in HP put on the Attacking Pokémon when the holder is
      damaged — the printed COUNTERS × 10, converted once at the deriver
      (effects.ts) so every reader downstream speaks the engine's one damage unit.

      ⚠️ THE PRINTED CLAUSE "(even if {it|this Pokémon} is Knocked Out)" NEEDS NO
      FIELD, and saying so is the point: the §9 site already runs BEFORE
      finishAttack's §8.1 both-board sweep, so a lethal retaliation from a body that
      was itself KO'd is the behaviour the always-on printings have had since 0.x.
      The duration is the only thing this sentence adds to the four already read.

      🆕🆕 **D456 — IT IS A FLOOR RATHER THAN "THE AMOUNT" SINCE THE UNPRINTED
      MEMBER LANDED**, and for the flat printings the two readings are the same
      number. See `ofDamageTaken` below. */
  amount: number;
  /** 🆕🆕 D456 — present and `true` iff this record was installed by corpus line 180,
      *"…put damage counters on the Attacking Pokémon equal to the damage done to
      this Pokémon."* (**2 legal printings**). The recoil then answers
      `Math.max(amount, <the damage this hit just did to the holder>)` instead of
      `amount`, resolved at the ONE read site (`installedRecoilOf`, continuous.ts)
      from that site's own `dealt` local.

      🛑 **OPTIONAL, AND `MATCH_RECORD_VERSION` STAYS 29 — BUT NOT ON THE
      REACHABILITY ARGUMENT THE LAST THREE SLICES USED.** That argument (*"an
      `EffectOp` reaches storage only through a park"*) does not apply here at all:
      `InPlayPokemon.installedRecoil` is a `GameState` field and is persisted
      DIRECTLY. The argument that does apply is `match.ts`'s own discriminator —
      *"does the OLD byte string still mean what it meant"* — and it does: a v29
      record's `{turn, amount}` carries no `ofDamageTaken`, absence reads as the flat
      family, and the flat family is what a v29 writer meant by those bytes. A
      WIDENING is free; a RENAME and a new REQUIRED key are not.

      🛑 **AND THE OPTIONAL ROAD IS TAKEN ON D421's CRITERION APPLIED RATHER THAN
      COPIED (D425).** The criterion is *choose the REST of the record so that LOSING
      the key is DETECTABLE*. Losing it here leaves `{turn, amount: 0}` — and a flat
      install can never author that, because the deriver's `counters >= 1` guard is
      the only producer of a flat `installRecoil` in the engine. So the loss does not
      degrade into a plausible neighbouring record the way D435's dropped `kind` did
      (`damage + undefined` → `NaN` → a body that can never be Knocked Out again); it
      degrades into a shape that is unauthorable by the surviving path, visible in the
      bytes, and inert on the board. Driven in `installedRecoil.test.ts` §7 over the
      serialized bytes in three directions, LOSS included, rather than argued.

      ⚠️ **`true` RATHER THAN `boolean`, so `false` is not a second spelling of
      absent** — the field has exactly two inhabitants and `undefined` is one of them.

      ⚠️ **THE RECORD DOES NOT TAKE THE OP's STRING.** `EffectOp`'s
      `installRecoil.amount` is `number | "damageTaken"` (effects.ts, `heal`'s D427
      widening at a second address); this record keeps `amount: number` and carries
      the channel as a separate flag. A persisted `amount: "damageTaken"` would be a
      STRING in the numeric field that `attack.ts` SUMS with `passivesOf().
      damageAttacker`, so a deploy that did not know the inhabitant would compute
      `20 + "damageTaken"` → `"20damageTaken"` → `> 0` false, and would silently drop
      the ALWAYS-ON Rocky Helmet share as well as the installed one. Two surfaces, two
      spellings, and the reason is written here so a successor does not "unify" them. */
  ofDamageTaken?: true;
}

/** §8/§11 (D154) — an attack-installed PER-ATTACK lock on one Pokémon, with the
    printed DURATION baked in as a turn STAMP exactly as the four records above
    bake theirs. One printed sentence, six printings in the local D1:

      "During your next turn, this Pokémon can't use {AttackName}."      (6)

    — Munkidori ex sv06.5-037/-083/-091 "Dirty Headbutt" (INDEX 0), Lucario
    sv01-114 "Accelerating Stab" (INDEX 1), Skarmory sv03-142 "Slashing Steel"
    (INDEX 1) and Greedent ex sv03-179 "Slip 'n' Roll" (INDEX 1). ONE MORE
    printing is fielded but uncatalogued — Radiant Blastoise swsh10.5-018
    "Torrential Cannon" (INDEX 0) is in `FIXTURE_POOL` and the local D1 holds no
    swsh10.5 SET AT ALL (see the census in effects.ts), so it is read by this
    anchor and cannot be verified by query.

    ⚠️ IT IS THE FIRST DURATED RECORD IN THE FAMILY THAT IS NOT A BARE NUMBER,
    AND THAT IS THE WHOLE SLICE. `AttackBlock` carries flags, the other three
    carry an AMOUNT — a quantity every read site folds into arithmetic it was
    already doing. This one carries an ADDRESS: "which attack" is not a number
    that can be summed with anything, and its three read sites COMPARE it rather
    than adding it.

    ⚠️ AND SINCE D165 THE BODY HOLDS A **LIST** OF THEM RATHER THAN ONE, BECAUSE
    THE FIELD HAS TWO WRITERS AND A SLOT HAS ONE SEAT. That is the whole of D165
    and it is written up at `InPlayPokemon.lockedAttacks` below; the RECORD in this
    block did not move a byte. What moved is the multiplicity, and the reason is
    that `preventAttackUse` (D154, `state.turn + 2`) and `lockDefenderAttack`
    (D157, `state.turn + 1`) can stamp the SAME turn from ADJACENT turns onto the
    SAME body, and a single slot silently kept the later write.

    ⚠️ IT CANNOT SHARE `attackLockedTurn`, WHICH IS THE SAME WINDOW ON THE SAME
    BODY WRITTEN BY THE SAME KIND OF SENTENCE — and saying so is the point of this
    block, because that is the widening a reader will reach for first. Both stamp
    the HOLDER's own next turn (`state.turn + 2`, D143's number), both are shed by
    the same three §10 clears, and one `{ turn, attackIndex? }` record with the key
    ABSENT meaning "the whole Pokémon" is exactly D135's absent-key shape. It is
    refused because the two are REACHABLE TOGETHER and mean different things: a
    Skarmory that self-locks "Slashing Steel" on turn 3 (stamp 5) and is then
    locked WHOLE by an opponent's Eiscue ex on turn 4 (stamp 5, D148's defender
    arm) carries both facts on turn 5, and one record could hold only the later
    write. A merge rule ("absent wins, it is strictly stronger") would be a rule
    about which of two printed sentences was declared last — the exact thing D147
    refused when it kept `damageReduction` out of `AttackBlock.turn`.

    ⚠️ AND D165 IS THAT PARAGRAPH COMING TRUE ONE FIELD TO THE LEFT. The argument
    above — "REACHABLE TOGETHER … one record could hold only the later write" —
    was written to refuse a merge ACROSS two fields and was never asked of the
    field it was written on. `lockedAttack` acquired a SECOND writer at D157 and
    the identical collision was live from that commit: two per-attack bars, on one
    body, on one turn, in one slot. The repo had already written down the argument
    that condemned it, which is the most transferable thing about the defect —
    **the test is not "do these two records mean the same thing" but "how many
    writers does this slot have, and can any two of them stamp the same turn".**

    THE WINDOW IS `state.turn + 2`, D143's number and not D142's: the sentence
    prints "During YOUR next turn" and declaring an attack ENDS the turn (§5.3),
    so the turn after the installing one is the opponent's and the one after THAT
    is the holder's own. A `+ 1` stamp would be live only on a turn the holder
    could not have acted on anyway, which is the failure mode D143 wrote down —
    it deletes the drawback the card is balanced around and nothing looks wrong.

    Everything else is INHERITED from `AttackBlock` unchanged: the stamp
    convention, the read-through-continuous.ts shape (`lockedAttackIndexes`), the
    three §10 early clears, and D124's no-defensive-`undefined` rule at the
    reader. */
export interface LockedAttack {
  /** The single turn number this lock is live on — the installing turn + 2 when
      `preventAttackUse` wrote it (the HOLDER's own next turn, since declaring an
      attack ends the turn) and + 1 when `lockDefenderAttack` did (the VICTIM's
      next turn, which is the turn immediately after). Two writers, two offsets,
      one number — which is exactly how two entries come to share it (D165).

      🆕🆕 **D421 — AND WHEN `until` IS SET THIS NUMBER IS PROVENANCE AND NOTHING
      ELSE: it is the INSTALLING turn, and no reader compares it.** The rider
      short-circuits every read of this field — `lockedAttackIndexes` answers the
      entry whatever the turn is, and `addLockedAttack`'s prune and its idempotence
      key both branch away from it — so there is no window for a number to name.
      It stays REQUIRED rather than becoming optional for `healedTurn`'s reason at
      the other address (match.ts): a key the writer never wrote is not a key with
      a default, and an optional `turn` would make every existing reader ask
      "absent, or genuinely unknown?" about a fact the model always has.

      ⚠️ **THE INSTALL TURN AND NOT `+ 2`, DELIBERATELY, AND THE GROUND IS THAT A
      WRONG DEGRADATION IS WORSE THAN A LOUD ONE.** Stamping `state.turn + 2` would
      make a build that DROPPED the rider degrade silently into D154's next-turn
      lock — a real bar, on a real turn, that simply stops one turn later than the
      card says. Stamping the install turn makes the same build produce a bar
      stamped for a turn its holder has already spent (declaring ENDS the turn,
      §5.3), so it never bites at all and a board says so on the very next turn.
      The rider is the fact; the stamp is the audit trail. */
  turn: number;
  /** WHICH attack is barred, as an index into the stack-top card's `attacks`.

      ⚠️ AN INDEX RATHER THAN THE PRINTED NAME, AND THE TWO READ SITES DECIDE IT.
      The printed sentence names a PROPER NOUN and the op carries that noun
      verbatim (effects.ts) — but every consumer of this record asks the question
      per INDEX: `attack.ts`'s §8 gate compares it against `action.index`, and
      both payability projections (`redactedAttacksOf`, GameHud) build their rows
      by `attacks.map((attack, index) => …)`. Resolving the name ONCE, at the
      install, is the same call D152's deriver made for its unit conversion: the
      translation happens at the site that reads the printed token, so no consumer
      downstream has to know the sentence named anything.

      ⚠️ THE INDEX IS NOT CONSTANT ACROSS THE FAMILY — 0 on the three Munkidori ex
      printings (whose card has ONE attack) and 1 on Lucario, Skarmory and Greedent
      ex — which is why the resolution is a lookup and not a literal. A build that
      assumed either number would bar the wrong attack on four of the six
      printings, and on Munkidori ex it would be right for the wrong reason. */
  attackIndex: number;
  /** 🆕🆕 **D421 — the DURATION, when the printed one is not a clock.** Present
      only for *"This Pokémon can't use Blaze Blitz again until it leaves the
      Active Spot."* (Gouging Fire ex sv05-038/-188/-204/-214, svp-144 — **5 legal
      printings, one card in five rarities**), where the bar has no expiry at all
      and is lifted by §10 instead. ABSENT means D154/D157's next-turn window,
      which is what every entry written before this slice means (D135's absent-key
      rule) — so this is a WIDENING and `MATCH_RECORD_VERSION` does not move.

      🛑 **AND IT IS AN OPTIONAL KEY RATHER THAN A NEW `InPlayPokemon` FIELD,
      WHICH IS D408's CRITERION EVALUATED RATHER THAN QUOTED.** That slice's rule
      is that a fact needing MORE THAN THREE off-Active clear sites has outgrown a
      sentence and wants a state slice of its own. This one needs exactly THREE —
      `clearOnLeavingActive` (turn.ts), `switchInto` (interpreter.ts) and
      `evolveOnto` (types.ts) — and it needs them BY ALREADY BEING ON THEM: all
      three shed `lockedAttacks: []` unconditionally, so the whole of *"until it
      leaves the Active Spot"* is machinery this field already owns. A new field
      would have had to be added to the same three literals to say the same thing.

      ⚠️ **AND `markers` IS THE ROUTE THAT LOOKS RIGHT AND IS WRONG** (D414's
      precedent, checked rather than copied): that bag is cleared at `evolveOnto`
      ONLY, so a bar carried there would survive a RETREAT — the counterplay the
      printed sentence is entirely about. Wrong-with-no-failure, which is the
      outcome this family refuses.

      A `"leavesActive"` STRING rather than `true`, for the op's reason verbatim
      (effects.ts): the axis is a DURATION and a second one is a printing away,
      while a boolean would have to be renamed to admit it. */
  until?: "leavesActive";
}

/** §8.5/§11 (D155) — an attack-installed PER-ATTACK DAMAGE BUFF on one Pokémon,
    with the printed DURATION baked in as a turn STAMP exactly as the five records
    above bake theirs. One printed sentence, ONE printing in the local D1:

      "During your next turn, this Pokémon's {AttackName} attack does 100 more
       damage (before applying Weakness and Resistance)."                 (1)

    — Seismitoad sv03-052 "Echoed Voice" ({W}{W}, printed 120, attack INDEX 0,
    its card's ONLY attack). The census is in effects.ts on the anchor; the
    populations are named there because D154 found that the local D1 holds five
    sets and `FIXTURE_POOL` fields cards from a sixth.

    ⚠️ IT IS `LockedAttack`'s RECORD WITH AN AMOUNT BESIDE THE ADDRESS, AND THAT
    IS EXACTLY WHY IT IS A SECOND FIELD RATHER THAN A KEY ON THE FIRST. D154 built
    `{ turn, attackIndex }` on the same body with the same `state.turn + 2` stamp
    and the same three §10 clears; this is `{ turn, attackIndex, amount }`. D131's
    widen-don't-add test asks whether stripping the new key yields the previous
    record BYTE FOR BYTE, and here it does — which is why the refusal cannot rest
    on the SHAPE and has to rest on what the readers do with it:

      • `lockedAttackIndex` is read by `attack.ts`'s §8 gate, which REFUSES the
        declaration whose index it returns. A shared field would hand that gate an
        index the holder is being paid to use, so a Seismitoad that bought +100 on
        "Echoed Voice" could no longer declare it. The two records mean OPPOSITE
        things at the same address, and the gate cannot tell them apart without a
        discriminator — which is a union whose read sites would then DISPATCH, the
        one thing §D152/§D154 declined to buy;
      • driven rather than argued: the suite installs both records on one board and
        asserts the barred attack is refused while the boosted one resolves at
        +100, and a build that merged them fails on the refusal.

    They CANNOT be live together off any printing — the pool prints the bar on four
    cards and the buff on one, and a body installs at most one per turn — so D154's
    own reachability ground (two facts, one record, one write) is NOT available
    here. The ground is the READ, not the write, which is the axis this family had
    not yet been separated on.

    THE WINDOW IS `state.turn + 2`, `LockedAttack`'s number and D143's: the
    sentence prints "During YOUR next turn" and declaring an attack ENDS the turn
    (§5.3), so the turn after the installing one is the opponent's and the one
    after THAT is the holder's own.

    Everything else is INHERITED unchanged: the stamp convention, the
    read-through-continuous.ts shape (`boostedAttackDamage`), the three §10 early
    clears, and D124's no-defensive-`undefined` rule at the reader. */
export interface BoostedAttack {
  /** The single turn number this buff is live on (the installing turn + 2 — the
      HOLDER's own next turn, since declaring an attack ends the turn). */
  turn: number;
  /** WHICH attack is boosted, as an index into the stack-top card's `attacks` —
      `LockedAttack.attackIndex`'s twin, resolved from the printed proper noun at
      the install by the SAME helper (interpreter.ts `printedAttackIndex`), so the
      apostrophe fold D137 requires is written once for both ops. */
  attackIndex: number;
  /** HP added to that attack's damage BEFORE Weakness and Resistance — the
      printed parenthetical, and the whole of why the number is stored rather than
      applied.

      §8.5's order makes the two placements observably different, and in
      `AttackDamageDebuff.amount`'s direction rather than `DamageReduction`'s:
      Weakness is MULTIPLICATIVE, so a printed 120 Water hit carrying 100 of this
      into a ×2 Water body is `(120 + 100) × 2 = 440`, while the same numbers
      added after the modifiers give `120 × 2 + 100 = 340`. (Resistance and this
      number are both additive and commute, so the parenthetical only ever bites on
      WEAKNESS; the suite drives both.)

      ⚠️ NO CLAMP, WHICH IS THE ONE ARITHMETIC DIFFERENCE FROM D149's MIRROR. That
      number is the only pre-W/R term that can drive the subtotal NEGATIVE and it
      owns a `Math.max(0, …)` for it; this one only ever adds, so it needs none —
      and it is REPORTED in the row's existing `bonus` field for that reason among
      others (events.ts).

      ONE amount is printed and it is still a capture rather than a literal, the
      varying token being a NUMBER and therefore closed by its type (D120's
      precondition, met exactly as D147/D149/D152 met it). */
  amount: number;
}

/** 🆕🆕 §8 (D394) — WHICH attack this Pokémon last USED, and on WHICH turn. Two
    printed sentences, ONE legal printing each, and they differ only in the attack
    they name:

      "If this Pokémon used Form Ranks during your last turn, this attack does
       90 more damage."                                                      (1)
      "If this Pokémon used Pervasive Gas during your last turn, this attack does
       120 more damage."                                                     (1)

    — Falinks `sv07-088` "All-Out Attack" ({C}{C}, `30+`, index 1 of TWO, naming
    its own index 0) and Weezing `sv09-092` "Crazy Blast" ({D}{C}, `50+`, index 1
    of TWO, naming its own index 0).

    🛑 **A NAME AND NOT AN INDEX, WHICH IS `LockedAttack`'s ANSWER INVERTED AND FOR
    `LockedAttack`'s OWN REASON.** D154 stored an INDEX because every consumer of
    that record asks per index (the §8 gate compares `action.index`, both payability
    projections build rows by `attacks.map`), and the printed proper noun was
    resolved ONCE at the install. This record's only consumer is
    `conditionHolds`, which compares against a printed clause key that is a NAME —
    so the same rule ("translate at the site that reads the printed token") lands on
    the other side. **An index would also be the WRONG FACT here**: the record
    outlives the turn it was written on, and a body that evolves between the two
    turns renumbers its own attacks.

    ⚠️ **ONE SLOT IS ENOUGH, AND THAT IS AN ARGUMENT ABOUT THE WRITERS AND NOT A
    SIMPLIFICATION** (D165's test: *how many writers does this slot have, and can
    any two of them stamp the same turn*). This slot has exactly ONE writer —
    `finishAttack` (flow.ts) — and declaring an attack ENDS the turn (§5.3), so a
    body can write it at most once per turn and never twice for one turn. The
    printed window is *"your last turn"*, and the attack a body used on its last
    turn is by construction the most recent one it used at the moment the question
    is asked, so nothing an older entry could answer is ever asked.

    THE TURN IS THE TURN THE ATTACK WAS DECLARED ON — `state.turn` as read inside
    `finishAttack`, which runs BEFORE `turnTail` and therefore still inside the
    attacking turn. Measured across a Knock Out PARK (both the attack-epilogue one
    and the Checkup one), where the counter holds at the ending turn's value for the
    whole prize/promotion sequence. */
export interface UsedAttack {
  /** The PRINTED attack name, byte for byte off the catalog — the token the
      clause key carries. */
  name: string;
  /** The turn number the attack was declared on. */
  turn: number;
}

/** An in-play Pokémon is a stack of physical cards, not one card (§1.2):
    the top uid defines its identity (name, HP, retreat cost, …); damage,
    energy and tools persist through evolution (M4). */
export interface InPlayPokemon {
  /** Card uids, bottom → top. */
  stack: string[];
  /** Attached Energy uids. */
  energy: string[];
  /** Attached Pokémon Tool uids (the attach flow lands with trainers, M4). */
  tools: string[];
  /** HP of damage taken (counters × 10). Placed by attacks from M2 on. */
  damage: number;
  conditions: SpecialConditions;
  /** §11 — an attack effect is holding this Pokémon in place ("During your
      opponent's next turn, the Defending Pokémon can't retreat."). NOT a §12
      Special Condition, which is why it does not live in `conditions`: it has
      no Checkup tick, renders no status chip, does not block ATTACKING, and
      never crosses the wire (`RedactedConditions`/`BattleConditions` pin that
      shape field-by-field — redact.ts `copyConditions`). It shares only the
      §13.4 paralysis LIFETIME: set by the attacker, cleared at the Checkup that
      ends the blocked player's own next turn (flow.ts), and dropped early
      wherever an effect of an attack ends — leaving the Active Spot or evolving.

      🛑 D412 — THIS FIELD IS NOW THE OPPONENT-SIDE HALF AND ONLY THAT, AND THE
      NARROWING IS LOAD-BEARING RATHER THAN COSMETIC. `preventRetreat`'s `"self"`
      arm writes `retreatLockedTurn` below instead, because the paralysis clock
      this field rides CANNOT express a self-installed window: flow.ts clears it
      for `endedSeat`, an attack ENDS the installer's turn (§5.3), so the very
      first Checkup after a self-lock would lift it before its window opened.
      That is not a hypothetical — flow.ts's own clear comment says a block
      applied by the ended seat's own attack "would lift a turn early", and
      guarded the claim with "which no print in the pool can do (the deriver's
      only two shapes both target the DEFENDER)". D412 built a third shape, and
      kept that parenthesis TRUE by construction rather than by luck: no arm
      writes this field for the installer's own seat. ⚠️ **READ THE FACT THROUGH
      `retreatLocked` (continuous.ts), NEVER THIS FIELD DIRECTLY** — there are two
      fields and one question, and a read site that names only one of them is the
      D222 defect (a hand-spelled test over members a helper already unifies). */
  retreatBlocked: boolean;
  /** §11 (D412) — the SELF-installed retreat lock ("During your next turn, this
      Pokémon can't retreat." — 3 legal printings, all of them the tail of a
      `"Heal {N} damage from this Pokémon."` compound), or `null` when none is
      installed. The turn number on which the lock is LIVE, exactly
      `attackLockedTurn`'s shape one field family over.

      ⚠️ A STAMP AND NOT A SECOND BOOLEAN, WHICH IS THE WHOLE REASON THIS FIELD
      EXISTS RATHER THAN A `target` ON THE OP. `state.turn + 2` — the installer's
      OWN next turn, one full round away, which is `attackLockedTurn`'s self-arm
      number and no other field's; the four sibling records that stamp `+ 1` are
      all windows on the OPPONENT's turn. It expires BY ARITHMETIC (`=== state.turn`
      stops holding) with no turn-boundary clear anywhere, so unlike
      `retreatBlocked` it has no `endedSeat` mirror to get backwards.

      ⚠️ NO `…_ENDED` EVENT, and that is this engine's stated convention for a
      stamp rather than an omission: `attackLockedTurn`, `attackBlock`,
      `damageReduction` and `installedRecoil` all say it in the same words — a
      turn stamp expires by arithmetic, so there is no boundary walk to announce
      it from and nothing to announce. `retreatBlocked` is the ONE §11 rider that
      does emit one, because it is the one implemented as boolean-plus-clear.

      THE THREE §10 EARLY CLEARS ARE THE SAME THREE the rest of this family takes
      (`clearOnLeavingActive` in turn.ts, `switchInto` in interpreter.ts,
      `evolveOnto` below), with the SELF-side reachability story: the window is
      the holder's own next turn, so retreating, being Switched out and evolving
      are all lines of play the holder can take INSIDE it — its own escape from a
      drawback it chose to pay, which is D148's agency argument on the self side. */
  retreatLockedTurn: number | null;
  /** §11 — the attack-installed damage/effect block on this Pokémon (see
      `AttackBlock` above), or `null` when none has been installed. Only LIVE
      while its `turn` is the current one; read through `attackBlockOf`
      (continuous.ts) rather than by touching this field, so no read site can
      forget the turn comparison. */
  attackBlock: AttackBlock | null;
  /** §8/§11 — the turn number on which this Pokémon MAY NOT ATTACK, or `null`
      when no such lock has been installed. The printed sentences are

        "During your next turn, this Pokémon can't attack."          (20 printings)
        "Put {N} damage counters on 1 of your opponent's Pokémon.
         During your next turn, this Pokémon can't attack."          ( 2 printings)
        "Discard an Energy from this Pokémon. During your opponent's
         next turn, the Defending Pokémon can't attack."             ( 3 printings)
        "If the Defending Pokémon is a Basic Pokémon, it can't attack
         during your opponent's next turn."                          ( 1 printing )

      and this field is the whole of all four riders. Read through `attackLocked`
      (continuous.ts) rather than by touching it, so no read site can forget the
      turn comparison — the same contract `attackBlock` above is under.

      ⚠️ ONE FIELD FOR BOTH DIRECTIONS, AND THAT IS D148's FINDING RATHER THAN AN
      ECONOMY. The two OPPONENT-side printings install this on the DEFENDER's body,
      and they cost the STATE nothing at all: "on which turn may this Pokémon not
      attack" is one question about one body, and which player's attack wrote the
      answer is a fact about the OP (`preventAttack.target`), not about the record.
      So the op grew a field and `InPlayPokemon` did not — which is also why
      `MATCH_RECORD_VERSION` did not move for the first durated slice in four.

      ⚠️ `state.turn + 2` ON THE SELF ARM AND `+ 1` ON THE DEFENDER ARM, AND THAT
      IS ONE RULE RATHER THAN TWO. The window is always *the locked Pokémon's
      controller's NEXT turn*; declaring an attack ENDS the turn (§5.3), so the
      turn after the installing one is the opponent's and the one after that is the
      installer's own. The printed wordings differ ("during YOUR next turn" /
      "during your OPPONENT's next turn") for exactly that reason. The stamp is
      therefore DERIVED from the op's `target` at the one install site and is never
      carried beside it.

      ⚠️ IT STILL CANNOT SHARE `attackBlock.turn`. Same body, same install site,
      same three early clears, two DIFFERENT NUMBERS on the self arm — so one
      `turn` field could hold at most one of them, and a `{ turn, effects,
      cantAttack }` record would be a single window pretending to describe two. The
      two are stamped and read independently, and a suite case installs both on one
      Pokémon and drives the pair of windows apart turn by turn
      (attackLock.test.ts). The DEFENDER arm shares D142's number, which is what
      makes this field's coexistence with `attackBlock` a fact about the QUESTION
      rather than about the arithmetic (D147's "sharing a site is not sharing a
      question", read on the other axis).

      ⚠️ TWO INSTALLS ON ONE BODY ARE NOW REACHABLE, AND THE STAMPS ARE MONOTONE.
      Before D148 a re-install was always at least two turns later by construction;
      now a Pokémon can lock itself with its own attack AND be locked by the
      opponent's. Every install writes its holder's next turn measured from the
      install, and installs are ordered in time, so a later install never writes an
      EARLIER turn than the one it replaces — which is why the later stamp simply
      wins and there is nothing to `Math.max`. The sharp case is that a self-lock
      stamped N + 2 and a defender-lock installed on turn N + 1 are the SAME
      number, so the second install is silent (D142's idempotence answer).

      NOT a §12 Special Condition, for `retreatBlocked`'s and `attackBlock`'s
      reasons verbatim: no Checkup tick, no status chip, no `StatusName`, and it
      never crosses the wire as a field (`redactedAttacksOf` folds it into the
      `playable` boolean each attack already carries — redact.ts, exactly as D112
      folded the retreat block into `can`).

      ⚠️ ITS LIFETIME TABLE IS D142's WITH THE REACHABILITY INVERTED, because this
      lock gates the HOLDER's own action during the HOLDER's own turn — and that
      stays true on the DEFENDER arm, which is the whole point: the window there is
      the victim's own next turn too:
        • leaving the Active Spot (§10) ends it, and here BOTH halves are
          reachable on the holder's own turn — retreat it, or let the opponent's
          Boss's Orders drag it out — where D142's evolve clear was unreachable by
          construction;
        • EVOLVING (§10) ends it, and that is the famous playable line rather than
          a written-anyway rule: a locked Pokémon that evolves may attack the same
          turn, because §10 sheds the effects of ATTACKS;
        • a Knocked Out holder takes it out of play with the rest of the stack,
          and the promoted body is a different Pokémon carrying no lock — which on
          the defender arm is a LIVE line rather than a corner, since Eiscue ex's
          printed 160 lands on the very body it locks;
        • installed twice, the later stamp wins — there is nothing to accumulate,
          the stamps are monotone (above), and a stale stamp answers nothing rather
          than being cleared.

      ⚠️ AND WHO ENDS IT EARLY IS NOW THE THING THAT DIFFERS BETWEEN THE ARMS.
      On the self arm all three routes are the holder's OWN escape from a drawback
      it chose to pay. On the defender arm they are the VICTIM's counterplay
      against an effect imposed on them — same three sites, same three clears,
      opposite agency: "the Defending Pokémon" is the body that was Active when the
      attack resolved (§8 step 5), so retreating it, switching it or evolving it
      all leave the window with nothing to bite. That is the printed reading and
      not a leniency: §10 sheds the effects of ATTACKS, and this is one. */
  attackLockedTurn: number | null;
  /** §8.5/§11 (D147) — the attack-installed DAMAGE REDUCTION on this Pokémon
      (see `DamageReduction` above), or `null` when none has been installed. Read
      through `installedReductionOf` (continuous.ts) rather than by touching this
      field, so no read site can forget the turn comparison — the same contract
      `attackBlock` and `attackLockedTurn` above are under.

      ⚠️ `state.turn + 1`, THE SAME NUMBER `attackBlock` STAMPS — which is what
      makes it the opposite case to `attackLockedTurn`. That field is a separate
      one because its window is a DIFFERENT turn (`+ 2`) and one `turn` could
      hold at most one of them; this one is separate despite sharing the window,
      because it answers a different question at the same four sites (subtract a
      number vs supersede the result) and `attackBlockOf` already resolves an
      attacker-class filter that has no meaning here.

      THE THREE §10 EARLY CLEARS ARE THE SAME THREE, with D142's reachability
      story rather than D143's: leaving the Active Spot is REACHABLE inside the
      window (a Boss's Orders played by the opponent on the very turn the
      reduction is live drags the body off the spot and the protection goes with
      it), while EVOLVING is unreachable by construction (installing ends the
      turn, the window is the opponent's, and nobody evolves on someone else's
      turn) and is written anyway, pinned by a surgery. A Knocked Out holder takes
      it out of play with the rest of the stack. */
  damageReduction: DamageReduction | null;
  /** 🆕🆕 §8.5/§11 (D432) — the turn on which an attack-installed *"During your
      opponent's next turn, this Pokémon has no Weakness."* bar is live on this
      Pokémon (the installing turn + 1), or `null` when none has been installed.
      Read through `installedNoWeakness` (continuous.ts) rather than by touching
      this field, so no read site can forget the turn comparison — the same
      contract the four fields above are under.

      ⚠️ A BARE STAMP AND NOT A RECORD, WHICH IS `attackLockedTurn`'s AND
      `retreatLockedTurn`'s SHAPE RATHER THAN `damageReduction`'s. The printed
      sentence carries no amount, no attacker filter and no type narrowing — it
      removes a STEP rather than moving a number — so the only fact to store is
      *when*. A `{ turn }` record would be a one-key object whose absence and
      whose staleness are two spellings of the same answer.

      🛑 **AND THAT IS ALSO WHY IT IS REQUIRED RATHER THAN OPTIONAL, AND WHY THIS
      SLICE BUMPS `MATCH_RECORD_VERSION` 26 → 27.** D421's rule for an optional
      key is *choose the rest of the record so that LOSING the key is
      detectable* — and here there IS no rest of the record. A dropped
      `noWeaknessTurn?: number` degrades into exactly the pre-D432 board: the bar
      silently never bites, which is the benign soft landing D124 refused for
      `promotedTurn`, D142 for `attackBlock`, D143 for `attackLockedTurn`, D147
      for `damageReduction` and D412 for `retreatLockedTurn`. A required key makes
      every body in a v26 record the wrong TYPE, which is the whole trigger. See
      `MATCH_RECORD_VERSION` (apps/api/src/lobby/match.ts) for the retirement.

      ⚠️ `state.turn + 1`, `damageReduction`'s AND `installedRecoil`'s PAIR OF
      ANSWERS: the sentence prints "During your OPPONENT's next turn" and "this
      Pokémon", so the window is the opponent's (declaring an attack ends the
      turn, §5.3) and the holder is the installer's own Active.

      THE THREE §10 EARLY CLEARS ARE THE SAME THREE, with `damageReduction`'s
      reachability story verbatim: leaving the Active Spot is REACHABLE inside the
      window (a Boss's Orders played by the opponent on the very turn the bar is
      live drags the body off the spot and the bar goes with it), while EVOLVING
      is unreachable by construction (installing ends the turn, the window is the
      opponent's, and nobody evolves on someone else's turn) and is written anyway
      — §10 sheds the effects of ATTACKS and this is one. A Knocked Out holder
      takes it out of play with the rest of the stack. All three literals are
      pinned STRUCTURALLY (`noWeaknessBar.test.ts`), off the field rather than off
      a number, because the number is unobservable after the body has left the
      Active Spot: §8.5 applies Weakness only to the Active. */
  noWeaknessTurn: number | null;
  /** 🆕🆕 §13 (D434, RENAMED AND GENERALISED AT D435) — the DELAYED EFFECT an
      attack scheduled onto this Pokémon (see `ScheduledEffect` above), or `null`
      when none has been scheduled. ONE clock, THREE payloads: counters (D434),
      a discard with NO Prize and a Knock Out WITH one (both D435). Read through
      `scheduledEffectDue` below rather than by touching this field, so no read site
      can forget the turn comparison — the same contract every durated field above
      is under.

      ⚠️ **ONE APPOINTMENT PER BODY, WHICH IS A MODEL LIMITATION AND IS STATED AS
      ONE.** The field holds a single record, so two schedules landing on one body
      for one turn cannot both be kept. Two counter schedules merge by `Math.max`
      (D434's answer, unchanged); a schedule of a DIFFERENT kind REPLACES whatever
      stood there. Both are unreachable off any printing — it takes two attacks in
      one turn, and no card prints two of these — so both are constructed and pinned
      rather than trusted (`delayedCounters.test.ts` §10).

      🛑 **THE ONE FIELD IN THIS SET WHOSE §10 CLEARS ARE THE *NORMAL* CASE RATHER
      THAN THE THEORETICAL ONE, AND IT INVERTS THE REACHABILITY STORY EVERY
      NEIGHBOUR ABOVE TELLS.** `damageReduction`, `noWeaknessTurn` and
      `installedRecoil` all have their window on the OPPONENT's turn, so their
      holder's controller cannot retreat or evolve inside it and their clears are
      written for the rule rather than for a board. This record is installed on the
      OPPONENT's Active and fires at the end of the OPPONENT's own next turn — so
      for the whole of its window the body's own controller is the player taking
      actions. **RETREAT, a Switch (`switchInto`) and EVOLVING are all live lines of
      play inside the window, and all three are the victim's counterplay**: §10
      sheds the effects of attacks, so walking the Defending Pokémon off the Active
      Spot — or evolving it — is how a player answers this attack. That is the
      printed ruling for the family (the Knock-Out twin of this sentence is refused
      the same way) and it is DRIVEN on all four literals rather than argued.

      ⚠️ THE FOURTH LITERAL, `devolveEach` (D433), IS THE ONE UNREACHABLE CLEAR AND
      IS WRITTEN ANYWAY. Devolution arrives only as an opponent's attack effect, and
      inside this record's window the opponent is the seat that installed it —
      whose turn it is not. So no legal sequence devolves a scheduled body before it
      fires. It joins the eleven bars that literal already sheds because §10 sheds
      the effects of ATTACKS and this is one, and because D433's own rule says the
      four literals AGREE about the durated set and disagree only about `markers`.

      ⚠️ NO POST-FIRE CLEAR, AND THAT IS DELIBERATE. The stamp expires by
      arithmetic (`ScheduledEffect.turn`), which is `attackLockedTurn`'s and
      `koByEffect`'s rule: a spent schedule sits on the body reading as "no
      schedule" for the rest of the game, and there is no boundary write anybody can
      forget, run twice, or run on the wrong side of the Checkup. The §11 retreat
      flag one field family over is the engine's ONE boundary-walked rider and it is
      a boolean; this one is a number, so it does not need to be.

      PUBLIC, AND NO PROJECTION READS IT TODAY — both halves stated, because only
      the second is a measurement. 🆕🆕 **RE-MEASURED AT D435 AFTER THE RENAME, WHICH
      IS THE ONE EDIT THAT COULD HAVE INVALIDATED IT** (a rename cannot break a reader
      that does not exist, but the measurement was of the OLD name and would have read
      as a stale claim otherwise): `grep -rn "scheduledEffect\|ScheduledEffect" src/
      apps/ packages/ scripts/` (D412's procedure) returns **zero hits in `src/` and
      zero in `packages/schema`**, and outside `packages/engine/src` only the
      `MATCH_RECORD_VERSION` doc block and its test in `apps/api/src/lobby/` plus the
      mutant corpus — all of them PROSE or anchors, none of them readers (D430: grep
      the structural spelling, not the substring). `redact.ts` and `packages/schema`
      build their own per-body shapes and carry no durated field at all, so nothing
      about this record reaches a client. Were one ever added, it
      would leak nothing: the attack that scheduled it resolved in front of both
      players and both can count turns (`handPlayLockedTurn`'s note, one interface
      over). */
  scheduledEffect: ScheduledEffect | null;
  /** §8.5/§11 (D149) — the attack-installed ATTACK-DAMAGE DEBUFF on this Pokémon
      (see `AttackDamageDebuff` above), or `null` when none has been installed.
      Read through `installedAttackDebuffOf` (continuous.ts) rather than by
      touching this field, so no read site can forget the turn comparison — the
      same contract the three fields above are under.

      ⚠️ `state.turn + 1`, LIKE `attackBlock` AND `damageReduction` — AND IT IS
      WRITTEN ONTO THE OPPONENT'S BODY, WHICH IS WHAT MAKES IT THE ONLY ONE OF THE
      FOUR THE INSTALLER NEVER HOLDS. The printed sentence says "During your
      opponent's next turn", declaring an attack ENDS the turn (§5.3), so the turn
      after the installing one is the victim's — and the victim is the holder. So
      the number is D142's and the HOLDER is D148's `target: "defender"` arm's:
      this field is the first in the family whose stamp and whose body come from
      two different precedents.

      ⚠️ IT CANNOT SHARE `damageReduction`, WHICH IS THE SAME `{ turn, amount }`
      SHAPE ON THE SAME BODY — and saying so is the point of this block, because
      the two records are structurally identical and semantically opposite. That
      one is subtracted from what this Pokémon TAKES, after Weakness and
      Resistance; this one from what it DEALS, before them. The printed sentences
      differ in exactly one word inside the parenthetical ("after"/"before"), and
      a single field would be a number whose meaning depended on who wrote it. A
      body can carry BOTH at once — its own "takes 30 less" and the opponent's
      "your attacks do 20 less" are two different turns' installs that can be live
      together — and the suite drives that exchange.

      THE THREE §10 EARLY CLEARS ARE THE SAME THREE, and the reachability story is
      D148's rather than D147's: the window is the HOLDER's own next turn, so
      retreating, being Switched out and evolving are all lines of play the holder
      can take INSIDE it. That makes them COUNTERPLAY against an imposed effect
      (the agency D148 inverted), and it is the FIFTH distinct reachability story
      on what are now five §10-cleared fields — which is why the clear-set is
      swept rather than listed. A Knocked Out holder takes it out of play with the
      rest of the stack, and the promoted body carries nothing. */
  attackDamageDebuff: AttackDamageDebuff | null;
  /** §9/§11 (D152) — the attack-installed REACTIVE RECOIL on this Pokémon (see
      `InstalledRecoil` above), or `null` when none has been installed. Read
      through `installedRecoilOf` (continuous.ts) rather than by touching this
      field, so no read site can forget the turn comparison — the same contract
      the four fields above are under.

      ⚠️ `state.turn + 1` ON THE INSTALLER'S OWN BODY, which is `damageReduction`'s
      pair of answers exactly and NOT `attackDamageDebuff`'s: the sentence prints
      "During your opponent's next turn" and "this Pokémon", so the window is the
      opponent's and the holder is the actor. It is the FIFTH stamped field, and
      §D147's count trigger for the `attackBlock` union therefore FIRES — the
      re-derivation is in decisions.md D152 and the verdict is still DECLINE, on a
      ground that retires counting as a trigger: this field's only read is a
      SUM into a number the catalog already contributes to, so there is no read
      path to unify. What earns the union is a member the read site must DISPATCH
      on (the per-attack lock's `{ turn, attackIndex }`), not a fifth number.

      THE THREE §10 EARLY CLEARS ARE THE SAME THREE, with `damageReduction`'s
      reachability story rather than `attackDamageDebuff`'s: leaving the Active
      Spot is REACHABLE inside the window (a Boss's Orders played by the opponent
      on the very turn the recoil is armed drags the body off the spot and the
      trap goes with it), while EVOLVING is unreachable by construction
      (installing ends the turn, the window is the opponent's, and nobody evolves
      on someone else's turn) and is written anyway, pinned by a surgery. A
      Knocked Out holder takes it out of play with the rest of the stack — and
      that is NOT the printed "(even if it is Knocked Out)", which is about the
      hit that is being resolved right now and is answered by §9's ordering. */
  installedRecoil: InstalledRecoil | null;
  /** §8/§11 (D154, MULTIPLICITY at D165) — EVERY attack-installed PER-ATTACK lock
      on this Pokémon (see `LockedAttack` above), newest last, `[]` when none has
      been installed. Read through `lockedAttackIndexes` (continuous.ts) rather
      than by touching this field, so no read site can forget the turn comparison
      — the same contract the five fields above are under.

      ⚠️ IT IS A LIST BECAUSE IT HAS **TWO WRITERS**, AND THAT IS THE WHOLE OF
      D165. `preventAttackUse` (D154, self-side, `state.turn + 2`) and
      `lockDefenderAttack` (D157, opponent-side, `state.turn + 1`) both write this
      field, and stamping from ADJACENT turns lands them on the SAME number: a
      Skarmory sv03-142 that bars its own "Slashing Steel" on turn 3 stamps 5, and
      an Oranguru sv02-094 that bars its "Peck" on turn 4 stamps 5 too. As ONE
      slot the second write DELETED the first, and the §8 gate then let the holder
      use the very attack its own card bars — with the `ATTACK_LOCKED` row for it
      still standing in the log. `/code-review` found it over D154–D164; the board
      is `lockedAttackMerge.test.ts`'s first case.

      ⚠️ A SECOND FIELD WAS PRICED AND REFUSED, AND THE GROUND IS THAT ITS BOUND
      IS NOT PROVABLE. "One slot for the self-side bar, one for the imposed one"
      fixes today's collision and pushes the same defect out by exactly one
      writer: nothing in the type, the ops or the registry says a per-attack bar
      may have at most two sources, and the census that looks like a bound (8 rows
      / 6 names self-side, 2 opponent-side — §D154/§D157, both CLOSED) is a fact
      about the 2026-08-03 catalog rather than about this shape. D150's rule is
      that this repo does not accept an assumed bound. A list has no bound to
      assume, and both fields would have cost the same `MATCH_RECORD_VERSION` bump
      and the same enumeration at the read sites anyway.

      ⚠️ AND IT IS THE ENUMERATING CALLER §D147/§D152/§D154/§D157 EACH FORECAST,
      ARRIVING FROM THE DIRECTION NONE OF THEM WATCHED. Those four declined a
      collection over the durated riders because *every read site knew which rider
      it wanted before it looked* — which was true, and is still true of the
      RIDER KINDS. What changed is the MULTIPLICITY of one kind: with two bars
      live, `redactedAttacksOf` and `GameHud` must grey EVERY barred row and
      neither knows in advance which, so both now ask MEMBERSHIP of a set they
      receive whole. That is an enumeration, and it is why this field earns a list
      while the `attackBlock` union does NOT re-open: nothing here DISPATCHES on a
      member's kind, because every member of this list means one thing.

      ⚠️ D155's REFUSAL IS UNTOUCHED AND IS SHARPENED BY THE LIST. `boostedAttack`
      stays its own field because its consumer PAYS the index this one's REFUSES;
      the list makes that a property of the CONTAINER rather than of a record —
      every entry here is an address the §8 gate refuses, so an entry that had to
      be paid would be exactly the defect D155 declined to build.

      ⚠️ `state.turn + 2`, WHICH IS `attackLockedTurn`'s SELF-ARM NUMBER AND NO
      OTHER FIELD'S. Four of the five records above stamp `+ 1` (the window is the
      opponent's); this sentence prints "During YOUR next turn", so the window is
      the holder's own and the number is D143's. That the two lock fields agree on
      the number is exactly why they cannot share a record — see `LockedAttack`.

      ⚠️ AND IT IS THE FIRST DURATED FIELD IN THE FAMILY THAT GATES AN ACTION AND
      REACHES A WIRE PROJECTION, which is a premise §D147's trigger (b) had never
      met (D149 and D152 both recorded "crosses no wire, changes no projection,
      gates no ACTION"). What crosses is still not a RECORD: `redactedAttacksOf`
      folds this fact into the per-attack `playable` boolean the wire already
      carries, exactly as D143 folded the whole-Pokémon lock into `banned` and
      D112 folded the retreat block into `can`. So the premise fires and the
      trigger does not — the argument is in decisions.md D154.

      THE THREE §10 EARLY CLEARS ARE THE SAME THREE, with `attackLockedTurn`'s
      reachability story rather than `damageReduction`'s, because the window is the
      HOLDER's own next turn: retreating, being Switched out and evolving are all
      lines of play the holder can take INSIDE it, and all three are its own escape
      from a drawback it chose to pay (D148's agency, on the self side). A Knocked
      Out holder takes it out of play with the rest of the stack, and the promoted
      body carries nothing.

      ⚠️ THE §10 CLEARS SHED THE WHOLE LIST (`[]`) AND NOT ONE ENTRY, because §10
      sheds *the effects of attacks* — all of them — when a body evolves or leaves
      the Active Spot. PER-ENTRY expiry is the other axis and it lives at the
      READER: an entry whose `turn` has passed stops answering without anyone
      clearing it, and a WRITE prunes entries strictly in the past so the list
      cannot grow across a long match. Two rules, two places, and they are
      independent — a body that never leaves the Active Spot still ends every turn
      with at most the bars stamped for turns it has not reached.

      EMPTY-ARRAY-MEANS-NONE, WHICH IS `markers`'s CONVENTION AND NOT THE SIX
      SIBLINGS' `=== null` ONE. The sibling convention exists so a reader cannot
      forget the `undefined` case (D124); an array required to be present answers
      the same requirement, and `[] | null` would have been two spellings of
      "none" for one fact. */
  lockedAttacks: LockedAttack[];
  /** §8.5/§11 (D155) — the attack-installed PER-ATTACK DAMAGE BUFF on this
      Pokémon (see `BoostedAttack` above), or `null` when none has been installed.
      Read through `boostedAttackDamage` (continuous.ts) rather than by touching
      this field, so no read site can forget the turn comparison — the same
      contract the six fields above are under.

      ⚠️ `state.turn + 2` AND AN ATTACK INDEX, WHICH IS `lockedAttack`'s PAIR OF
      ANSWERS EXACTLY — same window, same body, same address, same three clears.
      It is the SEVENTH stamped field and the first whose separation from an
      existing one rests on what the READERS do rather than on the record's shape
      or on two facts colliding: `lockedAttackIndex`'s consumer refuses the index
      it returns and this one's pays a bonus for it, so one field would make the §8
      gate bar the very attack the card bought (see `BoostedAttack`).

      IT GATES NO ACTION AND REACHES NO WIRE PROJECTION, and that is checked
      rather than assumed: `redactedAttacksOf` and `GameHud` publish the attack's
      PRINTED `damage` string straight off the catalog, which no pre-W/R
      adjustment has ever moved (Vitality Band, Choice Belt, Defiance Band,
      Practice Studio and Binding Mochi are all invisible there too). Showing this
      one alone would report a single source of a number the panel does not claim
      to compute. So unlike `lockedAttack` it owes neither projection.

      THE THREE §10 EARLY CLEARS ARE THE SAME THREE, with `lockedAttack`'s
      reachability story verbatim because it is the same window on the same body:
      retreating, being Switched out and evolving are all lines of play the holder
      can take INSIDE it, and all three throw away a bonus it chose to buy rather
      than escaping a drawback (D148's agency, inverted once more). A Knocked Out
      holder takes it out of play with the rest of the stack, and the promoted body
      carries nothing. */
  boostedAttack: BoostedAttack | null;
  /** Effect markers ("can't attack next turn", …) — M3+. */
  markers: string[];
  /** Turn it entered play; 0 = during setup. M2's evolution timing ("not the
      turn it came into play", §10) reads this — the separate "no evolving on
      your own first turn" rule is a turn/firstPlayer check, not this field. */
  turnPlayed: number;
  /** The turn this Pokémon last moved from the BENCH into the Active Spot, or
      `null` if it never has (it was placed Active at setup, or has only ever
      been Benched). Distinct from `turnPlayed`, which records when the CARD
      entered play, not when the Pokémon changed zone.

      It is a turn STAMP, not a flag, and that is the whole design: "moved to
      the Active Spot **this turn**" is `promotedTurn === state.turn`, so the
      fact expires by arithmetic and there is no turn-boundary clear to forget.
      It also needs no seat/ownership proof (contrast `allowances`, which is a
      single bag owned by whoever's turn it is — D123): the stamp is on the
      Pokémon, which already knows whose it is, and the turn counter is global,
      so a KO-promotion made during the OPPONENT's turn reads FALSE on the
      controller's next turn without anyone asking who moved it.

      Written by every bench→Active route: `retreat` and `switchInto`
      (Switch/Escape Rope, Boss's Orders, Jet Energy) in turn.ts/interpreter.ts,
      and `resolvePromotion` after a Knock Out in flow.ts. Survives evolution —
      `placeEvolution` spreads it through, because evolving does not un-move a
      Pokémon (§10 sheds the effects of ATTACKS, and this is neither). */
  promotedTurn: number | null;
  /** 🆕🆕 **D386 — the turn this Pokémon was last HEALED, or `null` if it never
      has been.** Maractus `sv10.5b-008`/`-093` "Lively Needles" ({G}, `20+`):
      *"If this Pokémon was healed during this turn, this attack does 100 more
      damage."* — the last 2-printing clause in the bonus residue, deferred seven
      times on exactly the cost this field is.

      🛑 **A TURN STAMP AT `promotedTurn`'s ADDRESS, AND FOR D124's THREE REASONS
      UNCHANGED.** (1) NO TURN-BOUNDARY CLEAR: *"during this turn"* is
      `healedTurn === state.turn`, so the fact expires by arithmetic and no
      `startTurn` walk can forget it. (2) NO SEAT GUARD: the stamp is on the
      Pokémon, which already knows whose it is, and `state.turn` is global — so a
      heal made during the OPPONENT's turn (Picnic Basket heals both boards) reads
      FALSE once the controller's own turn begins, which is what the printed
      sentence means. (3) It SURVIVES EVOLUTION and every zone move for the same
      reason `promotedTurn` does: `placeEvolution`, `retreat` and `switchInto` all
      spread the whole body, and §10 sheds the effects of ATTACKS — having been
      healed is a fact about the turn, not an effect on the card.

      ⚠️ **THE PRINTED SUBJECT IS "this Pokémon", WHICH IS WHY IT IS NOT A
      PER-SEAT FLAG.** A `PlayerSide.healedThisTurn` boolean answers *"did this
      SEAT heal anything this turn"*, and the two come apart on an ordinary board:
      heal a BENCHED body with a Potion, then attack with an untouched Active. It
      is also not a `GameState` uid SET — that spelling is correct about the
      subject and wrong about the clock, because a set carries no turn number and
      so needs the very boundary clear this shape does without. ⚠️ **AND THE
      COMPILER DID NOT SEPARATE THE THREE**: all three cost exactly 1 file / 1 site
      under `tsc -b --force` (measured, D386) — D385's `prizes` measurement
      separates a WIDENING from a SHAPE CHANGE, not three widenings from each
      other, so this one is settled by the printed subject and by the clock.

      🛑 **WRITTEN AT EVERY SITE THAT FILES A `HEALED` EVENT, THROUGH THE ONE
      HELPER `healedBody` (interpreter.ts), SO THE EVENT AND THE STAMP CANNOT
      DISAGREE** (D222's rule: two readers of one fact become one helper). That
      includes `moveCountersFromBench`, whose source body the engine has filed as
      HEALED since D138 — the alternative reading (a counter MOVE is not a heal)
      would have to move the EVENT too, and changing one without the other is what
      this helper exists to prevent. */
  healedTurn: number | null;
  /** 🆕🆕 **D393 — the turn this Pokémon last EVOLVED, or `null` if it never has.**
      Gholdengo `sv08-131` "Strike It Rich" ({M}, `30+`): *"If this Pokémon evolved
      from Gimmighoul during this turn, this attack does 90 more damage."* and Misty's
      Starmie `sv10-047` "Abrupt Flash" ({W}, `60+`): *"If this Pokémon evolved from
      Misty's Staryu during this turn, this attack does 80 more damage."* — the bonus
      residue's only PAIR on one mechanism, and the two printings that make this field
      worth a `MATCH_RECORD_VERSION` bump between them rather than one at a time.

      🛑 **A TURN STAMP AT `healedTurn`'s ADDRESS, AND FOR D124's THREE REASONS A
      THIRD TIME.** (1) NO TURN-BOUNDARY CLEAR: *"during this turn"* is
      `evolvedTurn === state.turn`, so the fact expires by arithmetic. (2) NO SEAT
      GUARD: the stamp is on the Pokémon and `state.turn` is global, so an evolution
      made on somebody else's turn reads FALSE once the asker's own turn begins.
      (3) It SURVIVES every zone move, because `retreat` and `switchInto` spread the
      whole body — and unlike the two stamps above it does not have to survive
      EVOLUTION, since §10 forbids a second evolution on the turn of the first.

      🛑 **AND THE NAME IS NOT STORED BESIDE IT, WHICH IS THE HALF THAT MAKES THIS
      ONE FIELD RATHER THAN TWO.** The printed clause names the PRE-EVOLUTION card,
      and `evolveOnto` appends rather than replaces (`stack: [...from.stack,
      evolutionUid]`), so the card evolved FROM is always the entry one below the
      stack TOP. Storing the name would be a second spelling of a fact the stack
      already holds, and the two could disagree; `conditionHolds` reads the stack.

      ⚠️ **THE PRINTED SUBJECT IS "this Pokémon", WHICH IS WHY IT IS NOT A `GameState`
      RECORD.** A per-seat `Record<Seat, …>` answers *"did this SEAT evolve something
      from Gimmighoul this turn"*, and the two come apart on an ordinary board: evolve
      a BENCHED body and attack with an untouched Active. ⚠️ **AND THE COMPILER DID
      NOT SEPARATE THEM** — measured at this head under `tsc -b --force`, a REQUIRED
      field here costs 1 file / 1 site (`makeInPlay`) and a REQUIRED `GameState` field
      costs 1 file / 1 site (`setup.ts`), the same tie D386 measured. The printed
      subject decides it, not the arithmetic. */
  evolvedTurn: number | null;
  /** 🆕🆕 **D394 — the attack this Pokémon last USED and the turn it used it, or
      `null` if it has never attacked** (see `UsedAttack` above). Falinks
      `sv07-088` "All-Out Attack" ({C}{C}, `30+`): *"If this Pokémon used Form
      Ranks during your last turn, this attack does 90 more damage."* and Weezing
      `sv09-092` "Crazy Blast" ({D}{C}, `50+`): *"If this Pokémon used Pervasive
      Gas during your last turn, this attack does 120 more damage."* — the bonus
      residue's last PAIR on one mechanism, and the two printings that make this
      field worth a `MATCH_RECORD_VERSION` bump between them rather than one at a
      time.

      🛑 **A TURN STAMP AT `evolvedTurn`'s ADDRESS AND FOR D124's THREE REASONS A
      FOURTH TIME**, but on a DIFFERENT window, which is the whole of what is new
      here. (1) NO TURN-BOUNDARY CLEAR: *"during your last turn"* is
      `turn === state.turn - 2`, so the fact expires by arithmetic. (2) NO SEAT
      GUARD: the stamp is on the Pokémon and `state.turn` is global. (3) It
      SURVIVES every zone move, because `retreat` and `switchInto` spread the whole
      body — and it MUST, since the printing this field exists for is asked on a
      LATER turn than the one it was written on, so a body that retreated and came
      back is exactly the board the clause is about.

      🛑 **THE WINDOW IS `state.turn - 2`, D143's NUMBER REFLECTED, AND IT WAS
      MEASURED RATHER THAN ASSUMED.** `preventAttackUse` and `BoostedAttack` both
      stamp *"during your next turn"* as `state.turn + 2` because declaring an
      attack ends the turn and the turn after the declaring one is the opponent's;
      *"during your last turn"* is that same claim read backwards. The measurement
      that settles it is a KO PARK: `turnTail` queues exactly ONE `startTurn` and
      the KO's prize/promotion stages are spliced in FRONT of it, so a Knock Out —
      from the attack epilogue OR from the Checkup — holds `state.turn` at the
      ending turn's value for the whole interrupt and the counter still advances by
      exactly 2 between a seat's consecutive turns. **A `- 1` would be the
      opponent's clock and would read a stamp no body of this seat can carry.**

      ⚠️ **AND THE PARITY DOES THE SEAT CHECK FOR FREE.** `state.turn - 2` has the
      same parity as `state.turn`, and a body is only ever stamped on a turn its own
      controller held (the §8 gate refuses an attack from the seat that does not
      hold `turn:action`). So evaluated OFF-TURN for the non-turn seat the
      comparison is FALSE by construction — an honest FALSE rather than a borrowed
      TRUE, `yourFirstTurn`'s property arrived at by arithmetic instead of by
      operand choice.

      ⚠️ **THE PRINTED SUBJECT IS "this Pokémon", WHICH IS WHY IT IS NOT A
      `GameState` RECORD** — and this row is the one place where a per-seat record
      had real precedent, since `lastKoTurn` answers the other closed-window
      question that way. It fails on an ordinary board: use Pervasive Gas with the
      Active, retreat it, and attack with a SECOND Weezing off the Bench. A seat
      record answers *"did this SEAT use Pervasive Gas last turn"* → TRUE and pays
      the +120 to a body that has never attacked. ⚠️ **AND THE COMPILER DID NOT
      SEPARATE THEM, FOR THE THIRD CONSECUTIVE SLICE AT THIS ADDRESS** — measured
      at this head under `tsc -b --force`, a REQUIRED field here costs 1 file / 1
      site (`makeInPlay`) and a REQUIRED `GameState` record costs 1 file / 1 site
      (`setup.ts`). The printed subject decides it, not the arithmetic. */
  usedAttack: UsedAttack | null;
}

/** 🆕🆕 §13 (D434, GENERALISED AT D435) — the delayed effect a body owes RIGHT NOW,
    or `null` when it owes nothing. The ONE reader of
    `InPlayPokemon.scheduledEffect`, and the whole of that field's arithmetic:
    the writer records the turn at whose END the effect fires, so the printed
    question is one `===` and the Checkup does not have to know who installed it or
    when.

    🛑 **IT RETURNS THE RECORD AND NOT A NUMBER, WHICH IS THE ONE SHAPE CHANGE D435
    MAKES TO D434's READER — AND IT RETIRES D434's `null`-RATHER-THAN-`0` ARGUMENT
    RATHER THAN KEEPING IT AS PROSE.** D434 returned `number | null` and spent a
    paragraph on why `null` is not `0` (a scheduled placement of zero would be
    indistinguishable from nothing due). With three payloads the caller has to
    branch on `kind` anyway, so the reader hands back the whole appointment and the
    ambiguity it was avoiding cannot be expressed: a `ScheduledEffect` is never
    falsy, and the `discard` and `knockOut` members carry no number at all. The
    deriver's `>= 1` guard still forbids a printed 0 at the ARM, which is where D434
    put it and where it belongs.

    FALSE-EQUIVALENT on every turn but the stamped one, BY CONSTRUCTION and with no
    clear site anywhere: a stamp for a turn already gone by can never equal
    `state.turn` again (turns only increase), so a spent schedule is inert without
    anybody sweeping it up. `null` is never a turn number, so an unscheduled body
    answers `null` too. */
export function scheduledEffectDue(pokemon: InPlayPokemon, turn: number): ScheduledEffect | null {
  const scheduled = pokemon.scheduledEffect;
  return scheduled !== null && scheduled.turn === turn ? scheduled : null;
}

export function makeInPlay(uid: string, turnPlayed: number): InPlayPokemon {
  return {
    stack: [uid],
    energy: [],
    tools: [],
    damage: 0,
    conditions: noConditions(),
    retreatBlocked: false,
    // Nothing has attacked with it yet — a card entering play carries no
    // effect of an attack (§10's carry-over rule read from the other end).
    attackBlock: null,
    // …and no attack of its own has locked it either (D143). Same reading of
    // §10's carry-over rule from the other end as the line above.
    attackLockedTurn: null,
    // …nor has one locked its RETREAT for its own next turn (D412). This is the
    // ONE site the compiler forces for a new required field — the other three
    // constructors spread an existing body, so a missing §10 clear there is
    // silent. See `retreatLocked` (continuous.ts) for why the fact has two
    // fields and one reader.
    retreatLockedTurn: null,
    // …and no attack has installed a durated damage reduction on it either
    // (D147). Same reading of §10's carry-over rule from the other end as the
    // two lines above.
    damageReduction: null,
    // 🆕🆕 …and no attack has removed its Weakness for the opponent's
    // next turn either (D432). Same reading of §10's carry-over rule from the
    // other end as the three lines above, and this is the SECOND site the compiler
    // forces for a new required field — `retreatLockedTurn`'s note above says the
    // other three constructors spread an existing body, so a missing §10 clear
    // there is silent. `noWeaknessBar.test.ts` drives all three structurally.
    noWeaknessTurn: null,
    // 🆕🆕 …and no attack has SCHEDULED damage counters onto it for the end of a
    // turn either (D434). §10's carry-over rule read from the other end for the
    // seventh time, and this is the THIRD site the compiler forces for a new
    // required field — `retreatLockedTurn`'s note above still holds for the four
    // that spread an existing body. `delayedCounters.test.ts` drives all four
    // literals plus this one structurally.
    scheduledEffect: null,
    // …and no attack has WEAKENED its own attacks either (D149) — the mirror of
    // the line above, on the other side of the §8.5 pipeline. Same reading of
    // §10's carry-over rule from the other end as the three lines above.
    attackDamageDebuff: null,
    // …and no attack has armed a durated recoil on it either (D152) — the
    // reduction's sibling on the §9 side of the pipeline. Same reading of §10's
    // carry-over rule from the other end as the four lines above.
    installedRecoil: null,
    // …and NO attack of anybody's has barred one of its attacks either (D154, a
    // LIST since D165 because the field has two writers). Same reading of §10's
    // carry-over rule from the other end as the five lines above, in the one
    // spelling on this list that is `[]` rather than `null`.
    lockedAttacks: [],
    // …and no attack of its own has BOUGHT one of its attacks a bonus either
    // (D155) — the per-attack bar's opposite verb at the same address. Same
    // reading of §10's carry-over rule from the other end as the six lines above.
    boostedAttack: null,
    markers: [],
    turnPlayed,
    // Never moved: a card entering play arrives from the HAND (or a deck
    // search), never from the Bench. The three bench→Active routes stamp it.
    promotedTurn: null,
    // …and nothing has healed it either: a card entering play carries no damage,
    // so there is nothing to remove. The seven `HEALED` sites stamp it (D386).
    healedTurn: null,
    // …and it has not evolved either: a card entering play arrives as itself, from
    // the hand or a deck search, and the ONE placement that is an evolution
    // (`evolveOnto`, below) builds its body by SPREAD and never through here (D393).
    evolvedTurn: null,
    // …and it has not attacked either: a card entering play has never been the
    // Attacking Pokémon, and `finishAttack` (flow.ts) is the one writer (D394).
    usedAttack: null,
  };
}

export interface PlayerSide {
  /** Card uids; index 0 is the top of the deck. */
  deck: string[];
  hand: string[];
  /** Order preserved (§2 — the discard pile is ordered and public). */
  discard: string[];
  /** Face-down prize uids, 6 at setup (§3.8). Taken on KOs from M2 on. */
  prizes: string[];
  active: InPlayPokemon | null;
  /** Dense (no empty slots), capped at BENCH_MAX. */
  bench: InPlayPokemon[];
  /** Setup mulligan count — drives the opponent's compensation draw. */
  mulligans: number;
}

/** Where an action points on the actor's own board. */
export type PokemonTarget = { spot: "active" } | { spot: "bench"; index: number };

/** §7.3 — the single SHARED Stadium zone: at most one Stadium is in play for
    both players. `owner` is the seat that played it — a replaced Stadium goes
    to its OWNER's discard pile, and future "each player may…" Stadium effects
    key their wording off it. */
export interface StadiumInPlay {
  uid: string;
  owner: Seat;
}

/** The §14 conditions in their precedence order: prizes taken (§14.1), the
    opponent out of Pokémon (§14.2), deck-out at the draw (§14.3). */
/** Why a game ended. The first three are the §14 RULES conditions, evaluated by
    `evaluateWin`. `conceded` is the fourth and only non-rules one: a player gave
    the game up. It is deliberately ONE reason for both ways that happens — the
    player pressed concede, or an online player vanished and their abandonment
    timer ran out (P4 3c-ii) — because to the opponent they are the same event,
    a forfeit, and the engine has no business knowing about sockets. */
export type GameOverReason = "prizesTaken" | "noPokemon" | "deckOut" | "conceded";

/** §14 — how a finished game ended. A win names the condition met; a TIE is
    the simultaneous case (both players met one at the same instant), with
    `reasons` naming each seat's. Official play breaks a tie with a
    sudden-death game — the engine surfaces the tie and leaves playing that
    out to the host (deferred; see evaluateWin in flow.ts). */
export type GameOutcome =
  | { result: "win"; winner: Seat; reason: GameOverReason }
  | { result: "tie"; reasons: Record<Seat, GameOverReason> };

/** Per-turn allowances (§5.2 caps, §15.J), reset by startTurn. They live on
    GameState rather than on the turn:action phase so a mid-turn interrupt
    phase (KO prize picks / promotions, effect:choose searches) can replace the
    phase without destroying them. */
export interface TurnAllowances {
  energyAttached: boolean;
  retreated: boolean;
  /** §7.2 — at most one Supporter per turn. */
  supporterPlayed: boolean;
  /** §7.3 — at most one Stadium play per turn. */
  stadiumPlayed: boolean;
  /** §7.3 — the shared Stadium's "once during each player's turn" activated
      ability (Artazon / Mesagoza / Town Store). A plain bool, not a per-uid list
      like `abilitiesUsed`: there is exactly one shared Stadium and only the
      turn's own player may use it, so one flag per turn suffices — and because
      allowances reset every turn (freshAllowances), it re-arms for the
      opponent's turn, which is precisely what "each player's turn" means. */
  stadiumAbilityUsed: boolean;
  /** §9/§15.J — once-per-turn Ability uses. A list, not a bool: several Pokémon
      may each use a once-per-turn Ability in the same turn. Reset each turn, so a
      plain array clears cleanly.

      The key is built by `abilityUsedKey` (cardplay.ts) and by NOTHING ELSE —
      never spell it here or in a HUD. Its DEFAULT form is `${uid}:${ability}`,
      per BODY; an Ability whose printed second sentence widens the scope to the
      NAME ("You can't use more than 1 Flip the Script Ability each turn",
      Fezandipiti ex) keys as `*:${ability}` instead, so every copy in play
      collides into one entry. Both live in this one array because the two scopes
      are the same RULE at different widths, and a uid can never be `*`.

      No seat dimension, for the same reason `stadiumAbilityUsed` needs none:
      only the turn's own player may use an Ability, and `freshAllowances()`
      re-arms the bag at every `startTurn`. */
  abilitiesUsed: string[];
}

export function freshAllowances(): TurnAllowances {
  return {
    energyAttached: false,
    retreated: false,
    supporterPlayed: false,
    stadiumPlayed: false,
    stadiumAbilityUsed: false,
    abilitiesUsed: [],
  };
}

/** The staged turn tail. endTurn — and attack, which ends the turn through
    the same tail (§5.3) — seed this queue; `advance` (flow.ts) drains it
    stage by stage, PARKING on an interrupt phase whenever a stage needs a
    player decision (which prize, which promotion) and resuming from the head
    once the deciding action lands. This un-fuses M1's TURN_ENDED → checkup →
    startTurn single reduction: every stage boundary is a legal place for the
    game to wait. */
export type PendingStage =
  /** §8.1 — the KOing seat picks `count` face-down prizes (clamped to what
      is left when processed; forced picks auto-resolve). */
  | { kind: "takePrizes"; seat: Seat; count: number }
  /** §8.1 — the KO'd seat promotes from the bench; an empty bench at this
      point is the §14.2 loss. */
  | { kind: "promote"; seat: Seat }
  | { kind: "endTurn"; seat: Seat }
  /** The Pokémon Checkup (§13) — `seat` is the player whose turn just ended,
      which the §13.4 paralysis recovery keys on. Its KOs park on the same
      ko:* interrupts the attack KOs use. */
  | { kind: "checkup"; seat: Seat }
  /** Hand the turn BACK to `seat` after a mid-turn Knock Out (M4) — an evolve
      that drops a charmed Basic below its new stage's HP, or a future
      spread/snipe ability. Unlike an attack KO (which ends the turn) or a
      Checkup KO (between turns), the actor keeps playing once the KO's
      prize/promotion decisions settle: this stage restores their turn:action
      phase. Always the tail of a mid-turn KO's stages, so nothing follows it. */
  | { kind: "resumeTurn"; seat: Seat }
  /** §9 (M4) — run the on-KO triggered Ability of the just-Knocked-Out `uid`
      (owned by `seat`). Fires DURING the opponent's turn, mid-KO-sweep: its
      program runs through the shared interpreter and may PARK on a decision
      (effect:choose with `resumeTail`), after which the KO sweep RESUMES
      draining the remaining prize/promotion stages behind it. Queued by
      collectKnockOuts (flow.ts) after the prize stages, before the promotions.
      `uid`'s card left play, but cardIdByUid → programFor still resolves it. */
  | { kind: "koTrigger"; seat: Seat; uid: string }
  /** §9 — run the `onDamagedByAttack` reactive Ability of the Active `uid` that a
      main-hit attack just DAMAGED (Armarouge "Scorching Armor" Burns the attacker;
      Klawf ex "Counterattacking Pincer" discards an Energy from the attacker).
      Fires DURING the OPPONENT's turn, so — like koTrigger — its program runs under
      `seat` (the DAMAGED player, NOT the turn owner) and may PARK on a decision
      (effect:choose with `resumeTail`), after which draining RESUMES the
      attackEpilogue queued behind it. Seeded by attack.ts only when the damaged
      Active carries such an Ability, AFTER the attack's own effect program and
      BEFORE finishAttack's §8.1 sweep, so "even if this Pokémon is Knocked Out" is
      free. `uid`'s card is re-looked-up (it is still the Active unless the effect
      program moved it), so the "in the Active Spot" clause holds at run time. */
  | { kind: "damagedTrigger"; seat: Seat; uid: string }
  /** §8.1 (D171) — run the `onAllyActiveKnockOut` program of a POKÉMON TOOL
      attached to one of `seat`'s SURVIVING Pokémon, because `seat`'s Active is
      about to be Knocked Out by the opponent's attack (Exp. Share sv01-174
      rescues a Basic Energy off the dying body onto the Tool's own holder).

      ⚠️ NO `uid`, AND THAT ABSENCE IS THE DESIGN — the one stage in this union
      that names NEITHER the body that acts NOR the body it is about. Both are
      RE-READ at run time off `seat`'s live board (flow.ts `runKoToolTrigger`):
      the subject is whatever is in the Active Spot then, because the printed
      sentence is present-tense about the spot ("when your ACTIVE Pokémon is
      Knocked Out") rather than about a Pokémon someone pointed at earlier; and
      the bearer is found by scanning every attached Tool (triggers.ts
      `koToolTriggersOf`). Remembering either would be a second opinion that can
      disagree with the sweep two stages later — `koRecoilOf`'s rule, one stage
      out. It is also why the seat is the whole payload: `attackEpilogue` carries
      exactly one seat for the same reason (it re-reads both boards).

      Seeded by attack.ts BETWEEN the damagedTrigger and the attackEpilogue —
      which is the only window that exists: `koRecoilOf` is earlier but cannot
      PARK, and every `koTrigger` is later than `knockOut`, which has already
      discarded the Energy this sentence moves. Like the two triggers above it
      runs under `seat` (the DAMAGED, non-turn player, who is the one choosing)
      and folds through settleProgram with `resumeTail`, so a park resumes the
      attackEpilogue queued behind it. Seeded on TOOL PRESENCE at damage time but
      conditioned on LETHALITY, which is knowable only after the attack's own
      effect program — so the run-time re-check is the `damagedByAttackAbility`
      idiom ("re-derive the printed clause where it is answerable"), and it is the
      difference between this stage and a `koTrigger`. */
  | { kind: "koToolTrigger"; seat: Seat }
  /** §8.1 + §5.3 — the attack's EPILOGUE: sweep BOTH boards for Knock Outs
      (finishAttack owns the [defender, attacker] order + the §14 tie), then end
      `seat`'s (the attacker's) turn through the staged tail. Seeded BEFORE the
      attack's effect program runs and drained by `advance` (flow.ts
      finishAttack), which is what lets that program PARK: a parked attack effect
      leaves this stage sitting in `pending`, and settleProgram's `resumeTail`
      fold resumes draining it once the decision lands. An attack with no effect
      program never queues it (finishAttack runs inline), so the stage exists only
      while an effect is mid-resolution. No `koedSeat`: the sweep reads both boards
      off the post-effect state, so the KO'd seats need not be predeclared.

      ⚠️ `uid` IS REQUIRED, AND IT IS THE ONE THING IN THIS UNION THAT MUST **NOT**
      BE RE-READ OFF THE LIVE BOARD (D189) — the exact inverse of `koToolTrigger`
      two members up, whose seat-only payload is deliberate for the opposite
      reason. It names the ATTACKING POKÉMON, the body that declared this attack,
      captured at declaration in `attack.ts` and carried here unchanged. Until
      D189 `finishAttack` re-derived it as `players[seat].active`, which was sound
      only while nothing between the §8.5 hit and this stage could swap that
      seat's Active — an accident of the registry (`switchActive` lived in one
      `trainer:` program no attack could invoke) rather than a rule, and swept as
      such by `vengefulPunch.test.ts`. The moment an attack derives a self-switch
      ("Switch this Pokémon with 1 of your Benched Pokémon."), the spot holds the
      body that was just PROMOTED and the §8.1 KO-conditioned recoil (Vengeful
      Punch sv03-197) would put its counters there. "The Attacking Pokémon" is a
      fact about WHICH BODY ATTACKED, not about which body is standing in the
      spot when the epilogue runs — so it is REMEMBERED, and `koRecoilOf`'s
      "never hold a second opinion" rule is not violated because there is no
      other opinion to hold: nothing else in the engine can answer it after the
      program ran.

      REQUIRED rather than optional, deliberately: an optional field would read
      back on an old record as "fall back to the Active", i.e. exactly the bug,
      and would leave the defect one absent key away forever. That is D124's
      refusal of the soft landing, and it is what makes this stage cost
      `MATCH_RECORD_VERSION` 11 → 12.

      🆕🆕 **`attack` IS REQUIRED FOR THE SAME REASON AND IS THE SAME KIND OF FACT
      (D394)** — the PRINTED NAME of the attack that was declared, captured beside
      `uid` at the one site that knows it and carried across a park unchanged.
      `finishAttack` stamps `InPlayPokemon.usedAttack` with it, and this stage is
      the ONE of the five routes into that function on which the name cannot be
      re-derived: the top card's `attacks[index]` is gone from scope, and the body
      may by then have self-switched or been shuffled away entirely. It is D189's
      argument about `uid` with the subject changed from "which body" to "which
      attack", and it costs `MATCH_RECORD_VERSION` 24 → 25 alongside
      `InPlayPokemon.usedAttack` itself. */
  | { kind: "attackEpilogue"; seat: Seat; uid: string; attack: string }
  | { kind: "startTurn"; seat: Seat };

// The phase is the discriminant every action is validated against: mandatory
// steps auto-resolve inside the reducer, so a distinct phase only exists
// where some player owes a decision (locked design: choices are actions).
export type Phase =
  | { kind: "setup:chooseFirst"; coinWinner: Seat }
  /** Mulligan compensation (§3.5): each player may draw 1 card per OPPONENT
      mulligan — mulliganing yourself does not forfeit it, so BOTH seats can
      be owed at once. `owed` is per seat (0 = nothing to decide); `decided`
      tracks who has answered. Seats owed 0 are pre-decided, and a phase where
      nobody is owed is never entered at all. */
  | { kind: "setup:drawExtra"; owed: Record<Seat, number>; decided: Record<Seat, boolean> }
  | { kind: "setup:place"; ready: Record<Seat, boolean> }
  // Per-turn allowances live on GameState.allowances (NOT here) so the ko:*
  // interrupts below can replace the phase mid-turn without destroying them.
  | { kind: "turn:action"; seat: Seat }
  /** KO resolution interrupt (§8.1): the KOing player picks `count` of their
      own face-down prizes. Forced picks (count = prizes left) never park. */
  | { kind: "ko:takePrizes"; seat: Seat; count: number }
  /** KO resolution interrupt (§8.1): the KO'd player promotes a benched
      Pokémon. A lone benched Pokémon auto-promotes; an empty bench is the
      §14.2 loss (resolved before this phase is ever entered). */
  | { kind: "ko:promote"; seat: Seat }
  /** Mid-effect decision interrupt (§15.E/G): a Trainer or Ability the acting
      `seat` played parked on a choice (which card to search up, which Pokémon
      to gust/switch/heal). `prompt` is the legal options; `cont` is the JSON
      continuation the resolveEffect action replays. Effects in scope normally
      run during the controller's own turn, so resolving returns to their
      turn:action — no tail interaction (interpreter.ts).

      `resumeTail` marks the two parks that are instead mid-TAIL, where finishing
      the program must keep draining `pending` rather than fold back to a turn
      (flow.ts settleProgram):
        • an on-KO triggered Ability (§9, M4 slice 9), which parks MID-KO-SWEEP
          during the OPPONENT's turn — `seat` is then the KO'd player, NOT the
          turn owner, so the projection reads the turn owner separately
          (koParkActiveSeat);
        • a reactive `onDamagedByAttack` Ability (§9 — Klawf ex "Counterattacking
          Pincer", the damagedTrigger stage), which likewise parks during the
          OPPONENT's turn with `seat` the DAMAGED player and the attackEpilogue
          queued behind it — the SAME shape as the on-KO trigger, read the same way;
        • an ATTACK's effect program (§8 step 4), which parks with the
          attackEpilogue stage queued behind it — here `seat` IS the turn owner
          (the attacker), and draining the tail runs the KO sweep + turn end.
      Both are read the same way by resolveEffect; only the projection needs to
      tell them apart. */
  | {
      kind: "effect:choose";
      seat: Seat;
      /** The seat that must ANSWER this prompt, when it is not `seat` — the
          opponent's printed "may" (opponentMayDraw, Ortega). Absent for every
          controller-answered park (i.e. all of them before D52), so old phases
          serialize byte-identically. `seat` keeps meaning the program's
          CONTROLLER throughout: the turn is still theirs, the fold returns to
          their turn:action, and the projection's activeSeat reads it — only
          resolveEffect's who-may-answer check and the projection's waitingSeat
          read this instead. */
      answerer?: Seat;
      prompt: EffectPrompt;
      cont: EffectContinuation;
      resumeTail?: true;
      /** The Ability that parked here ENDS the controller's turn on completion
          (Koraidon "Dino Cry"). Threaded through re-parks and read by
          resolveEffect → settleProgram (flow.ts): the finished program seeds the
          turn tail instead of returning to turn:action. Mutually exclusive with
          `resumeTail` (an on-KO trigger runs on the opponent's turn). */
      endsTurn?: true;
    }
  | { kind: "gameOver"; outcome: GameOutcome };

/** The in-turn phase, narrowed — the shape every turn action is gated on. */
export type TurnPhase = Extract<Phase, { kind: "turn:action" }>;

/** No hand-play lock live on either seat — `createGame`'s initialiser, written
    once here rather than spelled at the literal (the `freshAllowances` idiom).
    Every class present with `null`; see `GameState.handPlayLockedTurn`. */
export function freshHandPlayLocks(): Record<Seat, Record<StampedPlayLockKey, number | null>> {
  return {
    p1: { Item: null, Supporter: null, evolve: null },
    p2: { Item: null, Supporter: null, evolve: null },
  };
}

export interface GameState {
  /** mulberry32 state (signed int32) — every shuffle/flip advances it. */
  rngState: number;
  /** 1-based turn counter; 0 while in setup. Odd turns belong to firstPlayer. */
  turn: number;
  /** Chosen by the coin winner; null only during setup:chooseFirst. */
  firstPlayer: Seat | null;
  phase: Phase;
  /** Per-turn allowance flags — see TurnAllowances. */
  allowances: TurnAllowances;
  /** The staged turn-tail queue — see PendingStage. Empty except while a
      tail is mid-resolution (parked on a ko:* interrupt). */
  pending: PendingStage[];
  /** §7.3 — the one shared Stadium in play, or null. Its continuous effects
      (continuous.ts) apply to BOTH players while it sits here. */
  stadium: StadiumInPlay | null;
  players: Record<Seat, PlayerSide>;
  /** The TURN NUMBER during which this seat most recently had one of its own
      Pokémon Knocked Out — `null` while none ever has been. `GameState`'s ONLY
      piece of turn HISTORY: every other datum on this structure is the board as
      it stands, and this one exists because a printed sentence asks about a window
      that has already closed (*"if any of your Pokémon were Knocked Out during
      your opponent's last turn"* — Unfair Stamp sv06-165, Hassel sv06-151/-205).

      ⚠️ **IT IS NO LONGER THE ENGINE'S ONLY ONE, AND THIS LINE USED TO SAY IT WAS
      (D394).** `InPlayPokemon.usedAttack` is a second closed-window record, on the
      BODY rather than on the board, read as `turn === state.turn - 2` where this
      one is read as `turn === state.turn - 1`. The two windows are one counter
      step apart for a reason worth keeping: this field's question is about the
      OPPONENT's last turn and that one's is about YOUR OWN, and turns strictly
      alternate. **A CLAIM OF UNIQUENESS IS A CLAIM ABOUT THE WHOLE ENGINE AND
      ROTS SILENTLY** — nothing mechanical checks a doc block.

      🛑 **A STAMP, NOT A TALLY, AND THAT IS WHY NOTHING CLEARS IT.** The obvious
      shape is a per-turn counter plus a snapshot of the previous turn, which
      needs TWO fields and a write at the turn boundary that can be forgotten,
      run twice, or run on the wrong side of the Checkup. Recording the turn
      NUMBER instead makes the rolling window fall out of arithmetic: turns
      strictly alternate (`turnTail` queues `startTurn(otherSeat(seat))` and
      `startTurn` does `turn + 1`), so turn `n − 1` belongs to the opponent of
      whoever owns turn `n` BY CONSTRUCTION, and the printed question is exactly
      `lastKoTurn[you] === state.turn - 1`. There is no clear, no reset, no
      double-count, and a stale value can never be mistaken for a fresh one.
      `null` rather than `0` because turn 1 would otherwise read `0 === 0` and
      answer TRUE on a board where nothing has ever been Knocked Out.

      ⚠️ WRITTEN AT EXACTLY ONE SITE — `knockOut` (flow.ts), which is the sole
      funnel every Knock Out passes through (both `KNOCKED_OUT` emit sites are
      inside it) and is therefore the only place that cannot be bypassed by the
      attack epilogue, the Checkup or the mid-turn KO path. It is deliberately
      NOT written where a turn ENDS: a Checkup KO happens while `state.turn` is
      still the ending turn, which is what the printed sentence means by "during"
      that turn, and reading the counter at the KO gets that right for free.

      PUBLIC — both players watched the Knock Out happen and both can count
      turns, so a `BoardCondition` reading it keeps that union's public-state
      invariant. It is per-SEAT and names the side that LOST the Pokémon (the
      sentence's "your Pokémon"), not the side that scored the KO. */
  lastKoTurn: Record<Seat, number | null>;
  /** 🆕 §8.1 (D326) — WHICH Pokémon this seat lost on the turn `lastKoTurn`
      stamps, and HOW. `lastKoTurn` answers *when* a seat last lost a Pokémon and
      D271 recorded that it deliberately never answers *which*; two printed
      sentences narrow the KO SET itself and cannot be read off the turn number:

        · *"any of your **Team Rocket's** Pokémon were Knocked Out during your
          opponent's last turn"* — Team Rocket's Archer `sv10-170`/`-223`, an
          OWNER prefix on the set;
        · *"any of your Pokémon were Knocked Out **by damage from an attack**
          during your opponent's last turn"* — Iron Leaves `sv06-019`, Revavroom
          `sv06-125`, Alolan Marowak `sv09-057`, Terrakion `sv10.5w-054`/`-135`,
          a CAUSE narrowing; and Ethan's Pinsir `sv10-001` prints BOTH at once,
          which is what proves `owner` is an open parameter and not a Team
          Rocket special case.

      🛑 **A CO-STAMPED LIST, NOT A SECOND CLOCK — THE WINDOW IS STILL
      `lastKoTurn`'s ARITHMETIC.** This list carries no turn of its own. It is
      restarted when a Knock Out lands on a turn later than the one already
      stamped and appended to otherwise, so the "which turn do these belong to"
      question has exactly one answer and it is the neighbouring field's. That
      keeps D271's best property: **there is still no boundary write**, nothing
      clears this at end of turn, and a stale list cannot be mistaken for a fresh
      one because the reader (`koedMarksOnOpponentsLastTurn`) refuses to look at
      it at all unless `lastKoTurn` already says the window is open.

      ⚠️ **AND THE APPEND IS KEYED ON `uid` SO IT STAYS IDEMPOTENT.** D271 could
      be careless here because writing the same turn number twice is the same
      value; a LIST is not so lucky, and `collectKnockOuts` calls `knockOut`
      SPECULATIVELY on a throwaway state for the §14 tie probe and then again for
      real. Appending only a uid not already present makes the second write a
      no-op exactly as the stamp's is.

      PUBLIC, for `lastKoTurn`'s reason twice over: both players watched the
      Knock Out and both saw which body it was. Per-SEAT and naming the side that
      LOST the Pokémon. */
  lastKoMarks: Record<Seat, readonly KnockOutMark[]>;
  /** §7.1/§7.2 (D283) — the TURN NUMBER during which this seat may not play
      cards of the named class from its hand, imposed by an OPPONENT'S ATTACK
      ("Your opponent can't play any Supporter cards from their hand during their
      next turn." — Scream Tail ex sv06-094/-197; "During your opponent's next
      turn, they can't play any Item cards from their hand." — Galvantula ex
      sv07-051/-159/-168, Budew sv08.5-004, Frillish sv10.5w-044/-126).
      `null` while no lock is live for that class on that seat.

      🛑 **A `GameState` FIELD AND NOT A DERIVED READ, AND THE TEST IS D275's.**
      `isFirstTurnOf` refused a field because both its operands were already on
      the state and could not drift. This one has NO operands: the lock is
      installed by an attack that has ALREADY RESOLVED, and §5.3 ends the turn
      immediately after — so by the time the barred seat reaches for a Supporter,
      nothing on the board says the attack ever happened. The attacking body is
      not evidence either (it prints two attacks and the state records neither
      which was used nor that it hit), and `TurnAllowances` cannot hold it
      because `freshAllowances()` wipes the bag at every `startTurn`, which is
      exactly the boundary this window has to cross. **The arithmetic does not
      exist, so the field is the cheapest honest shape.**

      🛑 **A STAMP, NOT A FLAG, WHICH IS `lastKoTurn`'s SHAPE FOR THE OPPOSITE
      REASON.** That field records a turn that has PASSED; this one records a
      turn that is COMING. Both make the window fall out of arithmetic rather
      than out of a clear: the writer stamps `state.turn + 1` (turns strictly
      alternate, so the turn after the attacker's IS the printed "their next
      turn"), the reader asks `=== state.turn`, and a stamp for a turn that has
      gone by can never be mistaken for a live one. There is no clear, no reset
      and no double-count — a boolean would need one at the turn boundary and
      could be forgotten, run twice, or run on the wrong side of the Checkup.

      ⚠️ PER-SEAT AND PER-CLASS, both because the printed sentences vary on both
      axes: two of the eight printings bar Supporters and six bar Items, and a
      single "locked" stamp would let a Budew bar the Supporter the sentence does
      not mention. The class key is `Card.trainerType`'s own vocabulary
      (`StampedHandPlayClass`), so no read site has to translate.

      🆕 🛑 **KEYED BY `StampedPlayLockKey` SINCE D285, AND THE THIRD KEY IS AN
      ACT RATHER THAN A CARD CLASS.** Bronzong `sv05-069` "Evolution Jammer"
      prints the same window (*"During your opponent's next turn"*) on the same
      writer with the same `state.turn + 1` arithmetic, and bars *"any Pokémon
      from their hand **to evolve** their Pokémon"* — an ACT, not a
      `Card.trainerType`. **THE FIELD IS WIDENED AND THE QUESTIONS ARE NOT**: a
      second `pokemonPlayLockedTurn` record would duplicate the window, the
      writer, the arithmetic and this §10 non-clear invariant so that a reader
      could tell apart two things no reader asks about, and it would be a SECOND
      required `GameState` field where widening this one adds a key. The two
      surfaces still ask two questions — `handPlayBarred` takes a class,
      `pokemonPlayBarred` takes an act AND a card (Arbok narrows the noun) — and
      those live in `continuous.ts`, not here.

      🛑 **KEYED BY `StampedHandPlayClass`, NOT BY `HandPlayClass` — AND THAT
      IS THE WHOLE REASON D284 MOVED NO VERSION.** D284 widened the QUESTION's
      vocabulary with `"Tool"` (Jellicent ex's *"Item cards or Pokémon Tool
      cards"*), and the reflex would have been to widen this record with it. It
      is deliberately NOT widened: no printed ATTACK stamps a Tool bar, so the
      third key would be dead state on every persisted board, and adding it would
      have turned a zero-byte slice into a `MATCH_RECORD_VERSION` question for a
      key nothing could ever set. **A SOURCE THAT PERSISTS AND A SOURCE THAT DOES
      NOT ARE TWO VOCABULARIES; ONLY THE PERSISTING ONE IS A RECORD KEY.** D285's
      `"bench"` act is turned away at the same door and for the same measured
      reason: only the CONTINUOUS source (Arbok) reaches a bench placement.

      ⚠️ EVERY CLASS IS PRESENT WITH `null`, not `Partial<Record<…>>`: an absent
      key and a null stamp would be two spellings of "no lock", and the total
      record is what makes `handPlayBarred`'s single comparison exhaustive.

      PUBLIC — the attack that installed it resolved in front of both players and
      both can count turns, so a wire projection reading it leaks nothing. */
  handPlayLockedTurn: Record<Seat, Record<StampedPlayLockKey, number | null>>;
  /** 🆕 §8.1 (D298) — the printed ONCE-PER-GAME effects this seat has already
      spent, keyed by the EFFECT's name rather than by a card id or a uid
      (`KoPrizeReduction.oncePerGame`). Empty on a fresh board and it only ever
      grows: *"can't be applied more than once **per game**"* names a window with
      no closing edge, so unlike every other stamp on this interface there is
      nothing to clear and no arithmetic to get right.

      🛑 **A LATCH, NOT A STAMP — WHICH IS THE FIRST TIME THIS INTERFACE HAS
      NEEDED ONE, AND IT IS WHY THE SHAPE IS A LIST OF STRINGS.** `lastKoTurn` and
      `handPlayLockedTurn` both record a TURN NUMBER so a rolling window falls out
      of arithmetic; a per-GAME cap has no window, so a turn number would be a
      number nobody compares. The honest datum is set membership, and the members
      are printed EFFECTS: `sv06-167` and its `fix-legacy-energy` demonstrator are
      two printings of ONE effect and must share one latch, which a card-id key
      would get wrong on the day a reprint lands.

      🛑 **AND IT IS A `GameState` FIELD RATHER THAN A DERIVED READ, WHICH IS
      D275's QUESTION ASKED AND ANSWERED RATHER THAN SKIPPED.** `isFirstTurnOf`
      refused a field because both its operands were already on the board and
      could not drift. This one has NO operands whatsoever: when the reduction
      applies, the Legacy Energy leaves play with its holder into the discard pile,
      and a card sitting in the discard pile is byte-identical whether it was
      spent, discarded by a Giacomo, or never attached at all. `TurnAllowances`
      cannot hold it either — `freshAllowances()` wipes that bag at every
      `startTurn`, and this window crosses every turn boundary in the game. **The
      arithmetic does not exist, so the field is the cheapest honest shape.**

      ⚠️ PER-SEAT, because the sentence says *"your* Legacy Energy": both players
      may spend their own copy, and a shared latch would let one player's Knock Out
      consume the other's cap. PUBLIC — the reduction happens in front of both
      players and `PRIZE_REDUCED` names it in the log — so a wire projection
      reading it leaks nothing. */
  oncePerGameSpent: Record<Seat, string[]>;
  /** uid → catalog card id; fixed for the whole game at createGame. */
  cardIdByUid: Record<string, string>;
  /** The slice of the injected pool the two decks actually use. Carried in
      the state so applyAction stays a pure (state, action) pair and
      snapshots are self-contained/replayable. */
  cardPool: Record<string, Card>;
}

export function withSide(state: GameState, seat: Seat, side: PlayerSide): GameState {
  return { ...state, players: { ...state.players, [seat]: side } };
}

/** withSide, one level deeper: replace a seat's Active Pokémon — the shape
    every per-Active update (checkup ticks, status application, healing)
    spells out otherwise. */
export function withActive(state: GameState, seat: Seat, active: InPlayPokemon): GameState {
  return withSide(state, seat, { ...state.players[seat], active });
}

/** Prizes a seat has TAKEN — `PRIZE_COUNT − what remains in their pile`. Each
    player draws from their OWN Prizes on a KO (§8.1), so a shrinking pile IS the
    taken count. The count-scaling attack readers scale by the OPPONENT's taken
    Prizes (Charizard ex "Burning Darkness", Pecharunt ex / Annihilape, Wo-Chien ex
    "Covetous Ivy"), read at declaration before this attack's own KO awards one. */
export function takenPrizes(state: GameState, seat: Seat): number {
  return PRIZE_COUNT - state.players[seat].prizes.length;
}

/** §8.1 — did `seat` have any of its own Pokémon Knocked Out during the turn
    immediately before this one, i.e. during their OPPONENT'S last turn? The one
    reader of `GameState.lastKoTurn`, and the whole of the arithmetic that field's
    stamp-not-a-tally shape buys: turns strictly alternate, so "the turn before
    mine" IS "my opponent's last turn" and no seat comparison is needed.

    FALSE on turn 0/1 by construction (`null` never equals a turn number, and
    `turn - 1` is 0 or −1, which no `startTurn` ever produced), so the first
    player's first turn cannot bootstrap a gate off an empty history. */
export function koedDuringOpponentsLastTurn(state: GameState, seat: Seat): boolean {
  const stamped = state.lastKoTurn[seat];
  return stamped !== null && stamped === state.turn - 1;
}

/** 🆕🆕 §8 (D394) — did `pokemon` use the attack printed as `attack` during the
    turn BEFORE the one before this, i.e. during its controller's LAST turn?

    A NAMED HELPER for `koedDuringOpponentsLastTurn`'s reason exactly: the `- 2` is
    a claim about the TURN MACHINERY (turns strictly alternate, so the turn two
    steps back is the same seat's) rather than about the `BoardCondition`
    vocabulary, and D131 says one reading gets one implementation. It is the
    mirror of the `state.turn + 2` that `preventAttackUse` and `BoostedAttack`
    already stamp for *"during your next turn"*, arrived at from the other end.

    FALSE on turns 1 and 2 by construction (`null` never equals a turn number, and
    `turn - 2` is 0 or −1, which no `startTurn` ever produced), so no attacker can
    bootstrap the bonus out of an empty history. FALSE for the non-turn seat too,
    by PARITY rather than by a guard: `state.turn - 2` shares the current turn's
    parity and a body is only stamped on turns its own controller held. */
export function usedAttackOnYourLastTurn(
  state: GameState,
  pokemon: InPlayPokemon,
  attack: string,
): boolean {
  const used = pokemon.usedAttack;
  return used !== null && used.name === attack && used.turn === state.turn - 2;
}

/** 🆕 D326 — ONE Pokémon this seat lost, co-stamped with `GameState.lastKoTurn`.

    `name` is the PRINTED CARD NAME of the body that left play, which is exactly
    and only what an owner prefix is a test on: `CardFilter.ownerPokemon` is
    `card.name.startsWith(`${owner}'s `)` and nothing else, so storing the name
    keeps ONE spelling of "a Team Rocket's Pokémon" across the two files instead
    of resolving the subgroup at the write site and freezing the answer.

    `byAttack` is the CAUSE, and it is not a new discrimination: it is the
    `attackerSeat` that `collectKnockOuts` has taken since D164, which is passed
    by `finishAttack` alone and deliberately omitted by the Checkup and the
    mid-turn sweep. ⚠️ **THAT MAKES IT "KNOCKED OUT WHILE THE ATTACK RESOLVED",
    WHICH IS THE READING D164 ALREADY MADE FOR MUNKIDORI ex's *"by an attack from
    your opponent's Pokémon"*** — damage counters placed by the attack's own
    effect are inside it, Checkup poison and a mid-turn Ability KO are outside.
    Inheriting that judgement rather than re-making it is the point: the two
    printed phrases are one family, and a second reading of "by an attack" would
    be free to drift from the first. */
export type KnockOutMark = { uid: string; name: string; byAttack: boolean };

/** 🆕🆕 D414 — the marker a NON-DAMAGE Knock Out stamps on the body it dooms, and
    the reason it carries the turn.

    🛑 **UNTIL D414 THE DEFENDER'S BOARD COULD ONLY GO LETHAL BY DAMAGE, AND TWO
    SHIPPED MECHANISMS ARE BUILT ON THAT.** `collectKnockOuts`'s `byAttack` mark is
    read by four built sentences / six printings of *"Knocked Out **by damage** from
    an attack"*, and `koRecoilOf` below discharges Vengeful Punch's printed *"by
    damage"* **by placement rather than by a flag** — its own comment says so:
    *"a body can only be lethal on the defender's board here because this attack
    put it there"*. `knockOutDefender` makes that sentence false, so it says so in
    the state rather than leaving two correct-by-accident premises to rot.

    ⚠️ **A `markers` STRING RATHER THAN A FIELD, AND THAT IS WHAT KEEPS
    `MATCH_RECORD_VERSION` AT 26.** `InPlayPokemon.markers` is already `string[]`,
    already initialised at every constructor and already persisted; adding a VALUE
    is a widening (D125), where a new required field is a bump (D394, D412).

    ⚠️ **IT CARRIES THE TURN, AND THE BOARD THAT WOULD JUSTIFY THAT DOES NOT
    CURRENTLY EXIST — WHICH IS SAID HERE RATHER THAN LEFT AS A FALSE REASON.** This
    doc block first claimed the stamp was needed because Glimmora's "Shattering
    Crystal" denies a Knock Out and would leave a live, lethally-damaged body
    carrying a stale marker. **THAT CLAIM WAS MEASURED AND IS WRONG TWICE OVER**:
    Shattering Crystal denies the *Prize* and the Knock Out happens for real
    (`planPrizes`' own comment says so), and §11 is asked BEFORE the stamp is
    written, so a refused effect leaves no marker at all (driven, not argued).

    So the turn is **defensive**, against a position nothing in this catalog can
    currently build, and it is kept for two honest reasons rather than the invented
    one: it costs one template literal, and it makes the marker expire BY ARITHMETIC
    — no clear site anywhere, and therefore no second place to forget one, which is
    `attackLockedTurn`'s rule applied to a string. The expiry is driven at BOTH
    readers in both directions on surgically-placed markers, so the arithmetic is
    guarded even though the board that needs it is not printed. **A mechanism kept
    for a stated cheap reason is fine; a mechanism kept for a reason that turns out
    to be false is how this repo loses track of what is load-bearing.** */
export function koByEffectMarker(turn: number): string {
  return `koByEffect:${turn}`;
}

/** 🆕 §8.1 (D326) — the Pokémon `seat` lost during their OPPONENT'S last turn,
    or an EMPTY list when that window is not open. The one reader of
    `GameState.lastKoMarks`, and it reads `lastKoTurn` FIRST: the list carries no
    turn of its own, so the window question is answered by the neighbouring
    field's arithmetic and this function cannot disagree with
    `koedDuringOpponentsLastTurn` about whether anything happened.

    🛑 **EMPTY AND NOT `null` ON A CLOSED WINDOW**, so every caller narrows by
    `.some(...)` over a list that is already correct for the window rather than
    remembering to ask the turn question again — the "which" narrowings are then
    a filter on this and can never be TRUE on a turn where the bare gate is
    FALSE. */
export function koedMarksOnOpponentsLastTurn(
  state: GameState,
  seat: Seat,
): readonly KnockOutMark[] {
  return koedDuringOpponentsLastTurn(state, seat) ? state.lastKoMarks[seat] : [];
}

/** §7.1/§7.2 (D283) — the STAMPED half of `handPlayBarred`: is `seat` barred
    from playing `klass` cards from hand during the turn now in progress by an
    opponent's ATTACK? The ONE reader of `GameState.handPlayLockedTurn`, and the
    whole of the arithmetic that field's stamp-not-a-flag shape buys: the writer
    records the turn the bar APPLIES to, so the printed question is one `===` and
    no seat comparison is needed.

    FALSE on every turn but the stamped one, by construction — a stamp for a turn
    that has already gone by reads as "no lock" without anyone clearing it, so
    the field cannot leak a bar into a later turn and there is no reset to forget.
    FALSE on a `null` too, since `null` is never a turn number and `startTurn`
    never produced 0.

    🆕 ⚠️ **NOT EXPORTED, AND NOT THE QUESTION ANY READ SITE ASKS (D284).** Until
    D284 this WAS the whole question and it was called at three sites; the
    continuous ABILITY source (Tyranitar `sv09-095`, Jellicent ex
    `sv10.5w-045`/`-160`/`-168`) is a SECOND source of the identical bar, so the
    exported reader moved to `continuous.ts` — where `programFor` and
    `disabledAbilityUids` are reachable and this module's `types.ts` position in
    the import graph is not — and ORs the two. **WIDENED, NOT PARALLELED**: a
    second predicate OR'd at each of the read sites is D223's finding waiting to
    happen again, and the compiler cannot notice a site that forgot one of two.
    This half stays here beside the field it reads, private, so the stamp's
    arithmetic still has exactly one home. */
function stampedPlayLockBarred(state: GameState, seat: Seat, key: StampedPlayLockKey): boolean {
  return state.handPlayLockedTurn[seat][key] === state.turn;
}

/** The stamped half, read for a class the STAMP may not be able to name — the
    one place `HandPlayClass`'s NON-PERSISTING members have to be turned away, and
    they are turned away by the TYPE rather than by a string compare a reader
    could get wrong. `"Tool"` (D284) and `"Stadium"` (D287) are both absent from
    `handPlayLockedTurn` by construction (see the field's note), so the honest
    answer for either is "no stamp", not `undefined`.

    🆕 🛑 **THIS SEAM IS WHY D287 COST ZERO PERSISTED BYTES, AND THE COMPILER IS
    WHAT SAID SO — FIRST, BEFORE A TEST RAN.** Adding `"Stadium"` to
    `HandPlayClass` made THIS LINE the only thing `tsc -b` complained about:
    *`'"Stadium"' is not assignable to 'StampedPlayLockKey'`*. ⚠️ **ONE LINE, NOT
    THREE CALL SITES** — the error is printed three times because three projects
    build this file, and a count read off the console rather than off the code
    would have priced the seam at 3x. **A NEW QUESTION-CLASS CANNOT REACH THE
    PERSISTED RECORD BY ACCIDENT: it has to be turned away HERE, on purpose, or
    the build does not compile.** A type split that makes the compiler ask the
    `MATCH_RECORD_VERSION` question for you.

    ⚠️ EXPORTED FOR `continuous.ts` ONLY. `handPlayBarred` there is the reader
    every SITE calls; this is the seam between the two modules. */
export function stampedBarFor(state: GameState, seat: Seat, klass: HandPlayClass): boolean {
  return klass === "Tool" || klass === "Stadium"
    ? false
    : stampedPlayLockBarred(state, seat, klass);
}

/** §10 (D285) — the stamped half read for a POKÉMON-SURFACE act, and
    `stampedBarFor`'s exact twin one surface over: `"bench"` is the act no printed
    ATTACK can stamp (only Arbok's continuous passive reaches it), so it is turned
    away by the TYPE rather than by a string compare a reader could get wrong, and
    the honest answer for it is "no stamp" rather than `undefined`.

    ⚠️ EXPORTED FOR `continuous.ts` ONLY, exactly like `stampedBarFor`.
    `pokemonPlayBarred` there is the reader every SITE calls; this is the seam. */
export function stampedActBarFor(state: GameState, seat: Seat, act: PokemonPlayAct): boolean {
  return act === "bench" ? false : stampedPlayLockBarred(state, seat, act);
}

/** §4 — is the turn now in progress `seat`'s OWN FIRST turn? The per-seat turn
    ORDINAL, and the whole of it: `turn` is 1-based and turns strictly alternate
    with the odd ones belonging to `firstPlayer` (`phaseViewOf`, the one
    exhaustive reading of turn ownership), so the going-first seat's first turn
    is turn **1** and the other seat's is turn **2**. There is no third case.

    🛑 **A DERIVED READ, NOT A `GameState` FIELD, AND THAT IS THE WHOLE PRICE OF
    THE "first turn" VOCABULARY.** D271 added `lastKoTurn` because the turn a
    seat lost a Pokémon is HISTORY the board does not otherwise keep — no
    arithmetic over the live state can recover it. This question is the opposite:
    both operands are already on `GameState` and neither can drift, so the field
    would be a cached copy of a subtraction, needing a write site, an
    initialiser, a `MATCH_RECORD_VERSION` question and a way to be wrong.
    **Price the field against the arithmetic before adding the field.**

    ⚠️ WRITTEN ONCE AND CALLED FOUR TIMES, WHICH IS WHY IT IS HERE AT ALL. The
    expression was copied verbatim at THREE sites before this function existed
    (`turn.ts evolve`, `cardplay.ts rareCandy` and `rareCandyOptions` — §4's
    evolve ban, twice over, plus its affordance mirror), and D275's printed gate
    (`BoardCondition.yourFirstTurn`, Fan Rotom's "Once during your FIRST turn")
    would have been a fourth. Four copies of one rule is four chances for the §4
    ban and the printed Ability gate to disagree about what "first turn" means;
    this repo's answer to that is one reading, one implementation (D131).

    ⚠️ NO `firstPlayer !== null` GUARD, AND THE ABSENCE IS DELIBERATE. `null`
    only occurs during `setup:chooseFirst`, where `turn` is still **0**; a null
    takes the `? 2` branch and `0 === 2` is FALSE, which is the answer the
    sentence wants ("your first turn" has not begun). A spelled-out guard would
    be a conjunct no board can make false — a line that cannot go red. */
export function isFirstTurnOf(state: GameState, seat: Seat): boolean {
  return state.turn === (seat === state.firstPlayer ? 1 : 2);
}

/** Remove one card uid from a zone array (uids are unique by construction). */
export function without(zone: readonly string[], uid: string): string[] {
  return zone.filter((entry) => entry !== uid);
}

/** EVERY card uid this in-play Pokémon is made of, in §2's pile order:
    evolution stack bottom→top, then attached Energy, then attached Tools.

    🆕 **D299 — EXTRACTED FROM `discardFromStack`'s `"all"` ARM, WHICH IS THE
    HONEST SHAPE AND NOT THE ONE THE HANDOFF PREDICTED.** D298 re-typed Illumise
    `sv06-010`'s four-slice refusal as *"a missing COMPOSITION — the teardown it
    needs is `discardFromStack(…, "all")`"*, and flagged that very claim as its
    most-likely-wrong one. It is wrong, and its own stated doubt is why: that
    function APPENDS TO `side.discard` inside itself, so a shuffle-into-deck
    caller cannot reuse it without either an arity change or a destination
    parameter — on a helper whose NAME says discard, for a caller that discards
    nothing. **The reusable part was never the move; it was this one line**, the
    definition of "and all attached cards".

    ⚠️ **AND THE GREP THAT SETTLED IT CUT THE OTHER WAY TOO.** D298 measured
    *"8 references across 4 files"* and priced a defaulted parameter against
    that. The 8 are: THREE overload signatures of the one function, TWO mentions
    inside doc comments (flow.ts, index.ts) and **THREE real call sites** — two
    KO branches and the retreat cost. **Not one of them wants a destination other
    than the discard pile**, which is an argument AGAINST the parameter rather
    than for it: a field with one user and a name that contradicts it. A grep
    COUNT is not a call-site count, and the difference here is 8 against 3. */
export function stackUids(pokemon: InPlayPokemon): string[] {
  return [...pokemon.stack, ...pokemon.energy, ...pokemon.tools];
}

/** The one "cards leave play for the discard pile" move — §11 retreat costs,
    §8.1 KO cleanup and M4's DiscardEnergy op all funnel through here rather
    than hand-rolling the same zone transfer. Strips `uids` ("all" = the whole
    stack: evolution cards bottom→top, then energy, then tools — §2 keeps the
    pile ordered) off the Pokémon and appends them to the side's discard.
    Returns the stripped Pokémon (null when the entire stack left play) —
    where whatever remains goes (bench, Active, nowhere) stays the caller's
    business. */
export function discardFromStack(
  side: PlayerSide,
  pokemon: InPlayPokemon,
  uids: "all",
): { side: PlayerSide; pokemon: null; discarded: string[] };
export function discardFromStack(
  side: PlayerSide,
  pokemon: InPlayPokemon,
  uids: ReadonlySet<string>,
): { side: PlayerSide; pokemon: InPlayPokemon; discarded: string[] };
export function discardFromStack(
  side: PlayerSide,
  pokemon: InPlayPokemon,
  uids: "all" | ReadonlySet<string>,
): { side: PlayerSide; pokemon: InPlayPokemon | null; discarded: string[] } {
  const everything = stackUids(pokemon);
  const discarded = uids === "all" ? everything : everything.filter((uid) => uids.has(uid));
  const next = { ...side, discard: [...side.discard, ...discarded] };
  if (uids === "all") return { side: next, pokemon: null, discarded };
  const keep = (uid: string) => !uids.has(uid);
  return {
    side: next,
    pokemon: {
      ...pokemon,
      stack: pokemon.stack.filter(keep),
      energy: pokemon.energy.filter(keep),
      tools: pokemon.tools.filter(keep),
    },
    discarded,
  };
}

/** 🆕 **D307 — the §10 evolution placement WITHOUT its two consequences**: the stack top is
    replaced, §10's carry-over and clears are applied, and `POKEMON_EVOLVED` (plus
    a `STATUS_CLEARED` when there was something to clear) is appended. Returns the
    new state AND the body it produced, because the caller that owns the KO tail
    needs the very object it just built and re-reading the board for it would be a
    second way to answer one question.

    🛑 **THE SPLIT IS A RETURN-TYPE FACT, NOT A TIDY-UP.** `placeEvolution` (turn.ts)
    is this function plus `resolveMidTurnKnockOuts` / `runBoardTrigger`, and those
    two are exactly what made "an `EffectOp` cannot evolve" true for five slices.
    Nothing about §10 lives on either side of the line that the other side needs:
    the carry-over rules are all HERE, so the deck route cannot drift away from
    the hand route by forgetting one. */
export function evolveOnto(
  state: GameState,
  seat: Seat,
  target: PokemonTarget,
  benchIndex: number,
  from: InPlayPokemon,
  fromUid: string,
  evolutionUid: string,
  events: GameEvent[],
): { state: GameState; evolved: InPlayPokemon } {
  const evolved: InPlayPokemon = {
    ...from,
    stack: [...from.stack, evolutionUid],
    conditions: noConditions(),
    // §10 — evolving sheds the effects of attacks too, not just conditions. That
    // covers the retreat block and, since D142, the attack-installed damage
    // block. The second one is UNREACHABLE and deliberately written anyway: the
    // block is installed by an attack, an attack ends the turn (§5.3), and its
    // window is the opponent's next turn — during which the holder's controller
    // cannot evolve anything — so no legal sequence puts an evolution between the
    // install and the expiry. The rule belongs with the concept rather than with
    // the sequences that can currently reach it (the same call the retreat block
    // made one line up), and a state surgery pins it.
    retreatBlocked: false,
    attackBlock: null,
    // …and, since D143, the attack-installed LOCK — the one §10 clear on this line
    // that is not only reachable but is a PLAYED LINE: the lock's window is the
    // holder's own next turn, so evolving the locked Pokémon on that turn frees it
    // to attack immediately. That is the inverse of the block above, whose window
    // belongs to the opponent and which therefore no evolution can ever meet.
    //
    // D148 — and since the lock can now be written by the OPPONENT's attack ("…the
    // Defending Pokémon can't attack."), this line is also the VICTIM's chief
    // counterplay rather than only the holder's escape from its own drawback. The
    // reachability is identical (the window is the locked player's own next turn
    // either way); the AGENCY is not, and evolving out of an imposed lock is the
    // sharpest of the three routes because it costs no Energy and no allowance.
    // Driven end to end on a printed line (Alomomola → fix-mola-stage1).
    attackLockedTurn: null,
    // …and D412's self-installed RETREAT lock, whose story here is the lock's
    // rather than the block's, for the same reason and by the same arithmetic:
    // the window is the HOLDER's own next turn, so evolving out of it is a line
    // the holder can actually take, and it is the holder's own escape from a
    // drawback its own attack chose to pay.
    retreatLockedTurn: null,
    // …and, since D147, the attack-installed DAMAGE REDUCTION — the same
    // reachability story as the block two lines up rather than the lock's, and
    // for the same arithmetic: its window is the OPPONENT's next turn, during
    // which the holder's controller cannot evolve anything, so no legal sequence
    // puts an evolution between the install and the expiry. Written anyway (§10
    // sheds the effects of ATTACKS and this is one) and pinned by a surgery.
    damageReduction: null,
    // 🆕🆕 …and, since D432, the attack-installed NO-WEAKNESS bar — the
    // reduction's story one line up verbatim, and for the same arithmetic: its
    // window is the OPPONENT's next turn, during which the holder's controller
    // cannot evolve anything, so no legal sequence puts an evolution between the
    // install and the expiry. Written anyway (§10 sheds the effects of ATTACKS and
    // this is one) and pinned STRUCTURALLY rather than by a number.
    noWeaknessTurn: null,
    // 🆕🆕 …and, since D434 (all three payloads since D435), the SCHEDULED DELAYED
    // EFFECT — and this literal is
    // the one place in the set where that field's story is the OPPOSITE of the bar
    // directly above it. The bar's window is the opponent's turn, so nobody can
    // evolve inside it and the clear is written for the rule. The schedule's window
    // IS the holder's own turn, so evolving the Defending Pokémon before the end of
    // it is a legal, cheap and printed-ruling-correct answer to the attack — the
    // FIRST field on this literal whose evolve clear is a played line rather than a
    // theoretical one. Driven end to end in `delayedCounters.test.ts` — and D435
    // drives it for the DISCARD and the KNOCK OUT payloads too, on the same literal:
    // evolving the Defending Pokémon is how a player answers a scheduled Knock Out,
    // which is the same printed counterplay at a much higher stake.
    scheduledEffect: null,
    // …and, since D149, the attack-installed ATTACK-DAMAGE DEBUFF — whose story
    // here is the LOCK's rather than the reduction's, and that is the whole
    // difference between the two mirrors: the debuff's window is the HOLDER's own
    // next turn, so evolving the debuffed Pokémon on that turn frees its attacks
    // to hit full. A PLAYED LINE, driven end to end, and the victim's cheapest
    // counterplay against an effect they did not choose (D148's agency, on the
    // number instead of the lock).
    attackDamageDebuff: null,
    // …and, since D152, the attack-armed RECOIL — the reduction's story two lines
    // up rather than the debuff's, and for the same arithmetic: its window is the
    // OPPONENT's next turn, during which the holder's controller cannot evolve
    // anything, so no legal sequence puts an evolution between the arming and the
    // expiry. Written anyway (§10 sheds the effects of ATTACKS and this is one)
    // and pinned by a surgery.
    installedRecoil: null,
    // …and, since D154, the attack-installed PER-ATTACK lock — whose story here is
    // the LOCK's two lines up and not the reduction's, for the same reason it
    // shares that lock's number: the window is the HOLDER's own next turn, so
    // evolving the barred Pokémon on that turn frees the barred attack
    // immediately. A PLAYED LINE, driven end to end (Skarmory → fix-skarm-stage1),
    // and the sharpest of the three routes because it costs no Energy and no
    // allowance. Since D165 it sheds a LIST, and the WHOLE list — §10 sheds the
    // effects of attacks, all of them, and an evolution that freed one bar while
    // keeping another would be the defect this slice fixed wearing a clear.
    lockedAttacks: [],
    // …and, since D155, the attack-installed PER-ATTACK BUFF — the same window on
    // the same body as the line above, so the same PLAYED LINE, and the only entry
    // on this list a player must be careful NOT to take: evolving the boosted
    // Pokémon inside the window throws the bonus away. §10 sheds the effects of
    // ATTACKS whether or not the holder wanted this one shed.
    boostedAttack: null,
    markers: [],
    turnPlayed: state.turn,
    // 🆕🆕 D393 — the evolution stamp, and this is the ENGINE'S ONLY WRITE SITE:
    // every route that places an evolution — `evolve` and `rareCandy` through
    // `placeEvolution` (turn.ts), and all four `evolveFromDeck*` ops through this
    // function directly — comes here, so the hand route and the deck route cannot
    // disagree about it any more than they can about the §10 clears above.
    //
    // ⚠️ IT IS THE ONE FIELD ON THIS LITERAL THAT IS NOT A CLEAR. Everything above
    // is §10 shedding an effect; this RECORDS that the shedding happened, which is
    // the fact the printed clause asks about. `turnPlayed` one line up cannot answer
    // it: the two are equal here and differ on every body that was PLAYED this turn
    // without evolving, which is the ordinary board Gholdengo's +90 must miss.
    evolvedTurn: state.turn,
  };
  const side = state.players[seat];
  const updated: PlayerSide =
    target.spot === "active"
      ? { ...side, active: evolved }
      : { ...side, bench: side.bench.map((p, i) => (i === benchIndex ? evolved : p)) };
  events.push({
    type: "POKEMON_EVOLVED",
    seat,
    from: fromUid,
    to: evolutionUid,
    // Copied: the action object belongs to the caller (events.ts).
    target: { ...target },
  });
  // §10/§12 — evolving removed the Pokémon's Special Conditions. Announced only
  // when there was something to remove; `uid` is the NEW top (see events.ts).
  const cleared = presentStatuses(from.conditions);
  if (cleared.length > 0) {
    events.push({
      type: "STATUS_CLEARED",
      seat,
      uid: evolutionUid,
      statuses: cleared,
      reason: "evolved",
    });
  }
  return { state: withSide(state, seat, updated), evolved };
}

/** Move up to `count` cards deck-top → hand and record a CARDS_DRAWN event.
    Callers that care about deck-out (the turn draw, §14.3) check emptiness
    themselves — this helper just draws what is there.

    🆕🆕 **D487 — `from` NAMES THE END, AND IT IS ONE HELPER RATHER THAN TWO.**
    *"Draw 3 cards from the bottom of your deck."* is the only printed draw in the
    attack column that names a source (`EffectOp.drawCards.from`), and the obvious
    alternative — a second `drawFromBottom` beside this one — is refused for D222's
    reason: the short-draw arithmetic, the empty-deck early return, the event and the
    `withSide` write are ONE fact about drawing, and two copies of it can disagree
    the day one of them is fixed. The parameter is OPTIONAL and defaults to `"top"`,
    so all nine existing call sites are byte-unchanged.

    ⚠️ **THE SHORT DRAW IS THE SAME ARITHMETIC AT BOTH ENDS, AND THAT IS THE
    INTERESTING PROPERTY RATHER THAN A CONVENIENCE.** `Math.max(0, deck.length −
    count)` is the cut in both directions; on a deck of `count` or fewer it is 0, the
    slice is the WHOLE deck, and the two ends take **the same cards in the same
    order**. So a shallow deck cannot tell a bottom draw from a top one — an
    extensional identity, not a board this file happens not to write — and any suite
    that means to separate them must deal a deck STRICTLY DEEPER than the count. */
export function drawToHand(
  state: GameState,
  seat: Seat,
  count: number,
  reason: DrawReason,
  events: GameEvent[],
  from: "top" | "bottom" = "top",
): GameState {
  if (count <= 0) return state;
  const side = state.players[seat];
  // The cut: everything above it stays, everything at or after it is drawn when the
  // draw comes off the bottom; the mirror image when it comes off the top.
  const cut = Math.max(0, side.deck.length - count);
  const drawn = from === "bottom" ? side.deck.slice(cut) : side.deck.slice(0, count);
  if (drawn.length === 0) return state;
  events.push({ type: "CARDS_DRAWN", seat, uids: drawn, reason });
  return withSide(state, seat, {
    ...side,
    deck: from === "bottom" ? side.deck.slice(0, cut) : side.deck.slice(count),
    // DECK ORDER, both ends — the bottom three enter the hand in the order they lay
    // in the deck, not bottom-most first. A representation choice (a hand is an
    // unordered zone and no printed rule distinguishes the two), but `CARDS_DRAWN`
    // and the redacted hand both carry an order, so it is pinned rather than left to
    // drift; see `drawCards`' doc block in effects.ts.
    hand: [...side.hand, ...drawn],
  });
}
