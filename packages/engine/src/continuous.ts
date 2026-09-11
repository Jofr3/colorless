import {
  ANY_ENERGY,
  attacksOf,
  cardOfUid,
  energyProvidesOf,
  hasRuleBox,
  hpOf,
  isBasicPokemon,
  isEvolutionPokemon,
  isExOrV,
  isSpecialEnergy,
  isStage2Pokemon,
  matchesFilter,
  pokemonSuffixOf,
  retreatCostOf,
  topCardOf,
  topUid,
} from "./cards";
import type { PokemonSuffix, PreventedAttackerClass } from "./cards";
import type { BasicEnergyType, Card } from "@luminous/schema";
import type {
  AttackerClass,
  BoardCondition,
  CardFilter,
  HandPlayClass,
  PokemonPlayAct,
  PokemonType,
} from "./effects";
// 🆕🆕 D444 — the ONE value import this file takes from `effects.ts`: the second
// producer behind `attackGateOf` below. No cycle — `effects.ts` takes nothing from
// this file, and its only edge back to `registry.ts` is type-only.
import { timingGateFromAttackText } from "./effects";
import type { GameEvent, StatusName } from "./events";
import { flipCoin } from "./rng";
import type {
  AttackTimingGate,
  KoPrizeReduction,
  MaxHpScale,
  PassiveEffects,
  StadiumEffects,
} from "./registry";
import { programFor } from "./registry";
import type { AttackBlock, GameState, InPlayPokemon, Seat } from "./types";
import { SEATS, otherSeat, stampedActBarFor, stampedBarFor, takenPrizes } from "./types";

// The continuous-modifier pipeline (M4 slice 3): the one place the always-on
// effects of the shared Stadium (§7.3) and of attached Tools / printed
// passives (§7.4/§9) are aggregated and applied to a rule read. Cards.ts
// stays a pure catalog-accessor module — everything here reads STATE (which
// Stadium is out, which Tools are attached) on top of the catalog, so the
// action handlers (turn.ts retreat, attack.ts costs/damage, flow.ts KO check)
// and the web HUD all ask the same questions of the same module and cannot
// drift. Every function is pure and total: a missing card or program simply
// contributes nothing.

/** The in-play Stadium's authored continuous effects, or undefined when no
    Stadium is out (or the one out has no registry row — unreachable through
    playTrainer, which refuses to play an unauthored Stadium). */
/** §8.1 (D324) — the floor `effectiveMaxHp` clamps to. It exists so the "never
    non-positive" property a DELETED branch in `koSurvivalClamp` rests on is
    asserted by a line of code rather than by the historical accident that every
    HP term used to be an addend. 10 rather than 1: HP is printed and dealt in
    tens throughout the game, so a body clamped here would still be a legal
    one-counter kill rather than an unreachable fraction. Unreachable in the legal
    pool (min Stage-2 HP is 120 against a single -30 print) and DECLARED — D257's
    precedent for a bound that must be right without being drivable. */
const MIN_EFFECTIVE_MAX_HP = 10;

export function stadiumEffectsOf(state: GameState): StadiumEffects | undefined {
  if (state.stadium === null) return undefined;
  const id = state.cardIdByUid[state.stadium.uid];
  return id === undefined ? undefined : programFor(id)?.stadium;
}

/** §9 — the top uids of every in-play Pokémon whose Abilities are currently
    suppressed by a continuous Ability-lock AURA (Klefki "Mischievous Lock" /
    Spiritomb "Fettered in Misfortune" / Ting-Lu ex "Cursed Land"). A single
    UNGATED pass over both boards: each lock is read straight off its source's
    printed passive (never through the gated ability-read sites, so a lock cannot
    turn itself — or, deliberately, another lock — off), and its target predicate
    is then evaluated against every in-play Pokémon. The four ability read sites
    (useAbility, passivesOf, triggersOf, the HUD redactor) consult the returned
    Set by top uid. Empty when no lock is in play, so every board without one is
    byte-identically unaffected.

    KNOWN LIMITATION (documented follow-up, not this slice): a lock does not
    disable ANOTHER lock's source — the aura-disables-aura fixpoint (e.g. an Active
    Ting-Lu ex opposite a damaged Klefki, which by the rules should switch
    Mischievous Lock off) resolves as if both auras stay on. The three cards in
    scope never mute a NON-lock ability of another lock's source, so this only
    bites lock-vs-lock, which needs a fixpoint pass rather than one ungated read. */
export function disabledAbilityUids(state: GameState): Set<string> {
  const disabled = new Set<string>();
  // Collect the live auras first (ungated), each tagged with its source's seat.
  const auras: { aura: NonNullable<PassiveEffects["disableAbilities"]>; sourceSeat: Seat }[] = [];
  for (const seat of SEATS) {
    const side = state.players[seat];
    const holders = side.active === null ? side.bench : [side.active, ...side.bench];
    for (const holder of holders) {
      const top = topCardOf(state, holder);
      if (top === undefined) continue;
      const aura = programFor(top.id)?.passive?.disableAbilities;
      if (aura === undefined) continue;
      if (aura.requiresActive === true && holder !== side.active) continue;
      auras.push({ aura, sourceSeat: seat });
    }
  }
  if (auras.length === 0) return disabled;
  // Then evaluate each aura's target predicate against every in-play Pokémon.
  for (const targetSeat of SEATS) {
    const side = state.players[targetSeat];
    const targets = side.active === null ? side.bench : [side.active, ...side.bench];
    for (const target of targets) {
      const top = topCardOf(state, target);
      const uid = topUid(target);
      if (top === undefined || uid === undefined) continue;
      if (
        auras.some(({ aura, sourceSeat }) =>
          auraSuppresses(aura, sourceSeat, targetSeat, target, top),
        )
      )
        disabled.add(uid);
    }
  }
  return disabled;
}

/** Does `aura` (emitted by `sourceSeat`) suppress the Abilities of the in-play
    Pokémon `target` (top card `top`, on `targetSeat`)? Each field is an
    independent narrowing predicate; a target passes only when every stated clause
    holds and no exemption applies. */
function auraSuppresses(
  aura: NonNullable<PassiveEffects["disableAbilities"]>,
  sourceSeat: Seat,
  targetSeat: Seat,
  target: InPlayPokemon,
  top: Card,
): boolean {
  if (aura.side === "opponent" && targetSeat === sourceSeat) return false;
  if (aura.stage === "Basic" && !isBasicPokemon(top)) return false;
  if (aura.suffix !== undefined && pokemonSuffixOf(top) !== aura.suffix) return false;
  if (aura.requiresDamage === true && target.damage <= 0) return false;
  if (aura.exemptSuffix !== undefined && pokemonSuffixOf(top) === aura.exemptSuffix) return false;
  if (
    aura.exemptAbilityNamed !== undefined &&
    (top.abilities ?? []).some((a) => a.name === aura.exemptAbilityNamed)
  )
    return false;
  return true;
}

/** §8.5 — does `seat` currently have a live "Your Pokémon in play have no
    Weakness" aura (Florges "Blooming Garden")? A source is any of the seat's OWN
    in-play Pokémon — Active or Bench, since the printed Ability carries no "in the
    Active Spot" clause — whose TOP card's passive sets `removeWeakness`, provided
    that source's own Ability is not itself suppressed by a §9 lock (a damaged
    Florges opposite Ting-Lu ex "Cursed Land" loses the aura — Florges is a Stage 2,
    not ex — so this joins the `disabledAbilityUids` checklist every non-lock
    Ability surface must). The two Weakness read sites (attack.ts main hit,
    interpreter.ts snipeActive) call this on the DEFENDER's seat to null its
    Weakness before the pipeline; Resistance is untouched. Cheap on the common
    path: the lock scan runs only once a `removeWeakness` source is found, so a
    board with no Florges pays nothing. */
export function seatRemovesWeakness(state: GameState, seat: Seat): boolean {
  const side = state.players[seat];
  const holders = side.active === null ? side.bench : [side.active, ...side.bench];
  for (const holder of holders) {
    const top = topCardOf(state, holder);
    if (top === undefined || programFor(top.id)?.passive?.removeWeakness !== true) continue;
    const uid = topUid(holder);
    if (uid !== undefined && disabledAbilityUids(state).has(uid)) continue;
    return true;
  }
  return false;
}

/** Every continuous modifier affecting one in-play Pokémon, aggregated from
    its TOP card's printed passive (Bouffalant "Bouffer"), every attached
    Tool (§7.4) and — since D174 — every attached ENERGY (§6.1, Therapeutic
    Energy sv02-193) — summed, since each source is its own card effect. The
    Basic-only hpBonus (Bravery Charm) counts only while the top card is a
    Basic: evolving the holder ends it even though the Tool stays attached. A
    Pokémon under an Ability-lock aura (§9 disableAbilities) contributes nothing
    from its own printed passive — that passive IS an Ability — but its attached
    Tools (not Abilities) and its attached Energy (not Abilities either) keep
    working. */
export function passivesOf(
  state: GameState,
  pokemon: InPlayPokemon,
): {
  /** §8.5 post-W/R reduction, summed over the holder's own printed passive and
      every attached Tool — and, since D161, over the TYPE-GATED Tool printing
      beside them (Rock Chestplate `sv01-192`, "The {F} Pokémon this card is
      attached to takes 30 less damage…"). That gate names the HOLDER, which is
      the body this fold already has, so it is resolved HERE against
      `top.types` — `basicHpBonus`'s placement — and the four read sites take a
      ZERO diff. Contrast `preventDamageFromTypes` below, whose gate names the
      ATTACKER and therefore cannot be resolved anywhere but a read site. */
  damageReductionAfterWR: number;
  damageBonusBeforeWR: number;
  /** Pre-W/R bonuses gated on a board condition (Defiance Band), collected RAW
      and UNEVALUATED: the condition is seat-relative and this aggregation has no
      seat, so the two pre-W/R read sites fold them via `conditionHolds`
      (interpreter.ts `attackerPreWRBonus`). Kept out of `damageBonusBeforeWR` so
      the defender-reduction / HP reads, which never look at either, can't be
      accidentally credited an attacker's conditional bonus. */
  conditionalDamageBonusBeforeWR: { amount: number; cond: BoardCondition }[];
  /** Pre-W/R bonuses gated on the DEFENDER's rule-box suffix (Choice Belt),
      collected RAW like the board-condition list above: the defender is not a
      seat and this aggregation has none, so the read sites fold them via
      `pokemonSuffixOf(defenderCard)` in `attackerPreWRBonus`. */
  targetConditionalDamageBonusBeforeWR: { amount: number; targetSuffix: PokemonSuffix }[];
  /** §8/§9 (D242) — the always-on ATTACK GATES the holder's own printed Abilities
      impose on it ("This Pokémon can't attack unless you have 4 or more Team
      Rocket's Pokémon in play"), collected RAW and UNEVALUATED for
      `conditionalDamageBonusBeforeWR`'s reason verbatim: the condition is
      seat-relative and this aggregation has no seat, so the payability sites fold
      them through `attackBarredByAbility` (interpreter.ts).

      ⚠️ A LIST FOR A FIELD THAT IS A SCALAR ON `PassiveEffects`, which is this
      fold's standing shape rule (registry.ts: *"a type must COLLECT, because two
      sources can name one"*) and here is not hypothetical — the holder's printed
      passive, four Tools and any attached Energy all reach `sources`, so two
      gates on one body is expressible even though no legal printing carries a
      second one today. */
  cantAttackUnless: BoardCondition[];
  /** §4 (D277) — the holder's own printed Ability LICENSES it to attack on the
      going-first player's first turn ("Debut Performance"). A boolean OR and not
      a list, unlike the gate above it: two sources naming it say the same thing
      and there is no provenance a read site could use — the §4 ban is lifted or
      it is not, and no message names the Ability. Evaluated HERE rather than at
      the read sites because, unlike `cantAttackUnless`, it carries no
      seat-relative condition to fold. */
  attackFirstTurnExempt: boolean;
  /** §4/§10 (D278; SPLIT FROM ITS ZONE GATE and turned into a LIST by D279) —
      the LIVE licences on this body to EVOLVE EARLY: on your first turn, AND on
      the turn it came into play. Two printed sentences carry it:

        • Eevee `sv08-143`/`sv08.5-074`/`svp-173` "Boosted Evolution" —
          *"**As long as this Pokémon is in the Active Spot**, it can evolve
          during your first turn or the turn you play it."*
        • Karrablast `sv10.5b-009`/`-094` and Shelmet `sv10.5w-008`/`-093`
          "Stimulated Evolution" — *"**If you have Shelmet in play**, this
          Pokémon can evolve during your first turn or the turn you play it."*
          (each names the OTHER body; 4 printings, 2 sentences).

      🛑 **THE TWO ANTECEDENTS ARE ANSWERED IN TWO DIFFERENT PLACES, AND THAT IS
      THE WHOLE SHAPE OF THIS FIELD.** Eevee's clause is about THIS BODY'S ZONE,
      which the fold can answer (it already computes `onBench`), so entries only
      appear here once it holds. Karrablast's is about the SEAT'S BOARD, and
      `passivesOf` HAS NO SEAT — so it is collected RAW and evaluated at the read
      site, `cantAttackUnless`/`attackBarredByAbility` (interpreter.ts) verbatim.

      🛑 **AND THE ZONE GATE MUST NOT BE APPLIED TO THE PARTNER-GATED FOUR.**
      D278 welded `&& !onBench` into the fold line because its only printing said
      "Active Spot"; Karrablast and Shelmet print NO such clause, and reusing that
      line would give them a restriction the card does not print. **That failure
      is SILENT IN THE OPPOSITE DIRECTION FROM D278's** — it REFUSES legal boards
      rather than allowing illegal ones, so no "the licence works" assertion made
      on an Active body can see it. A BENCHED Karrablast is the only board that
      can, and there is one in `stimulatedEvolution.test.ts` and a mutant on it.

      Entry values: `undefined` is *"nothing further to check"* (Eevee, whose one
      clause the fold consumed); a `BoardCondition` is the seat-relative
      remainder. A LIST rather than a boolean because two sources can name it
      (registry.ts's rule) and the read is an OR — see `evolveEarlyLicensed`
      (interpreter.ts), the ONE place that folds it. */
  evolveEarlyExempt: (BoardCondition | undefined)[];
  hpBonus: number;
  /** §9 reactive recoil placed on the ATTACKER when this Pokémon is damaged by
      an attack while Active (Counterattack Quills / Custom Trap) — summed HP.
      `requiresTool` is evaluated HERE against the holder's board (this function
      has the Pokémon), so the attack.ts read site stays a plain number. */
  damageAttacker: number;
  /** §8.1 recoil placed on the ATTACKER when this Pokémon is KNOCKED OUT by
      damage from an opponent's attack (Vengeful Punch sv03-197) — summed HP, and
      a SECOND number rather than a term of the one above because the two read
      sites refuse each other's condition (registry.ts `damageAttackerOnKo`).
      Read once per sweep by flow.ts `koRecoilOf`, which supplies the "is Knocked
      Out" half; this aggregation only answers "what would this body pay". */
  damageAttackerOnKo: number;
  /** §8.5 full damage PREVENTION when the attacker is an ex/V (Mimikyu
      "Safeguard"). The attacker's rule-box class is known only at the read sites,
      so this aggregation just reports whether the holder carries the aura; the
      sites gate it on `isExOrV(attacker)`. */
  preventDamageFromExV: boolean;
  /** §8.5 full damage PREVENTION when the ATTACKER is a Pokémon of one of these
      printed types (Dachsbun sv01-099 "Well-Baked Body" `{R}`, Bellibolt
      sv03-078/-201 "Insulator" `{L}`) — `preventDamageFromExV`'s twin one field
      up, with the gate reading `Card.types` instead of the rule-box name parse.

      A LIST rather than a scalar, and that is the one shape decision this field
      makes. Every source in the fold above (the holder's own passive plus each
      attached Tool) contributes independently, so a scalar could only be
      last-wins — silently dropping a real prevention on a board with two sources.
      No such board exists in the pool today (no Tool prints the sentence and no
      card prints two), which is precisely why it has to be the aggregation's
      shape rather than a fact anyone remembers: `conditionalDamageBonusBeforeWR`
      three fields up is the same optional-scalar-collected-to-a-list idiom for
      the same reason. Empty on every board with no such holder, so the read sites
      pay one `.some` over nothing. */
  preventDamageFromTypes: PokemonType[];
  /** §8.5 (D251) full damage PREVENTION when the ATTACKER is a Pokémon that HAS an
      Ability (Cornerstone Mask Ogerpon ex `sv06-112`/`-199`/`-215`,
      `sv08.5-058`/`-160` "Cornerstone Stance" — 5 legal
      printings on ONE sentence, "Prevent all damage from attacks done to this
      Pokémon by your opponent's Pokémon that have an Ability."). The THIRD member
      of the attacker-property prevent family and the second read off an INGESTED
      column: the gate is `cards.ts hasPrintedAbility`, i.e. `Card.abilities` is
      non-empty.

      ⚠️ A BOOLEAN AND NOT A LIST, AND THE TWO NEIGHBOURS ABOVE ARE THE ARGUMENT
      RATHER THAN A PRECEDENT TO PICK FROM. `preventDamageFromExV` is a boolean and
      `preventDamageFromTypes` is a list, and they differ for one reason: the type
      gate is PARAMETERISED — each source names a VALUE, so a scalar fold could only
      be last-wins and would silently drop a real prevention. This gate carries NO
      parameter, so an OR over N sources is LOSSLESS: two holders' worth of "prevent
      damage from Ability-havers" is the same predicate as one. **The unit of
      STORAGE is decided by the write sites (this repo's standing rule), and the
      question a valueless predicate asks its writers is not "how many" but "can two
      of you disagree" — these cannot.** The fold's source set (the holder's own
      passive PLUS every Tool PLUS every Energy) is therefore not the deciding fact
      here, though it is the deciding fact one field up.

      ⚠️ AND THE SENTENCE'S 2-PRINTING NEIGHBOUR IS NOT A WRITER OF THIS FIELD.
      `sv10.5b-023`/`-107` print "…by your opponent's Pokémon that have any Special
      Energy attached" — the SAME axis with a different attribute — but their
      sentence reads "prevent all damage FROM AND EFFECTS OF attacks", and the
      effects half is a rule this pipeline does not have. Measured, not assumed: the
      `%prevent all damage%` sweep over `abilities_json` with `legal_standard = 1`
      (remote D1 `luminous`, 2026-08-07) returns 9 sentences and FIVE of them carry
      "from and effects of". A field that took an attacker-predicate KIND would have
      made that twin look one enum member away when it is a whole second rule away.

      Like both neighbours it modifies only its HOLDER, so it rides `passivesOf` (and
      is §9-suppressible — this printing IS an Ability — and nulled by `ignoreWR` at
      the two snipe arms), and the ATTACKER is known only at the four read sites. No
      "in the Active Spot" clause on the sentence, so it protects a benched holder. */
  preventDamageFromHasAbility: boolean;
  /** §8.5/§11 (D252) — the FOURTH attacker-property prevent, and THE FIRST ONE THAT
      CARRIES THE EFFECTS HALF. Carracosta "Mighty Shell" (`sv10.5b-023`/`-107`, 2
      legal printings on ONE sentence): *"Prevent all damage from AND EFFECTS OF
      attacks done to this Pokémon by your opponent's Pokémon that have any Special
      Energy attached."*

      ⚠️ **THE NAME SPELLS BOTH HALVES ON PURPOSE, AND THAT IS THE WHOLE
      DISCRIMINATOR FROM ITS THREE SIBLINGS.** `preventDamageFromExV`,
      `preventDamageFromTypes` and `preventDamageFromHasAbility` are the NARROW
      printed spelling: they stop damage and nothing else, so a Poison, a forced
      switch or a discard still lands on a body carrying one. This one is the WIDE
      spelling, so it is read at FIVE sites rather than four — the same four damage
      arms plus interpreter.ts `attackEffectRefused`, which is the one funnel every
      attack-borne EFFECT already passes through (eight call sites, one gate). A
      field that only spelled the damage half would have been indistinguishable from
      `preventDamageFromHasAbility` and would have silently dropped the half the
      printed sentence is longer for.

      ⚠️ **THE ATTACKER PREDICATE IS A BOARD READ, NOT A CARD READ, AND THAT IS WHY
      IT IS NOT IN `cards.ts`.** D251's `hasPrintedAbility` takes a `Card` and no
      `GameState` deliberately — "have an Ability" is a fact about the printing.
      "have any Special Energy attached" is a fact about the BOARD, so the predicate
      is `attackerHasSpecialEnergy` in THIS file, beside `preventsAttackerType`, and
      it takes the attacker's `InPlayPokemon` rather than its `Card`. All five read
      sites already had that body in hand (attack.ts's `active`, the interpreter's
      `attackerTop?.active` / `attacker?.active`), which is the measured reason the
      widening costs no signature change anywhere.

      A BOOLEAN, by the standing rule its two siblings settled: the gate names no
      VALUE, so an OR over N sources is lossless and two writers cannot disagree.
      Like all three it modifies only its HOLDER, rides `passivesOf` (so it is
      §9-suppressible — this printing IS an Ability — and nulled by `ignoreWR` at the
      two snipe arms). No "in the Active Spot" clause, so the DAMAGE half protects a
      benched holder; the EFFECTS half is Active-scoped because
      `attackEffectRefused` resolves `state.players[seat].active` and every op that
      consults it aims at an Active. That asymmetry is the FUNNEL's shape, not this
      field's. */
  preventDamageAndEffectsFromSpecialEnergy: boolean;
  /** §8.5 + §11 (D253) — the WIDE prevention again, this time with NO attacker
      property at all and a HOLDER-ZONE gate instead. Poltchageist `sv06-020`/
      `sv06-171` and Sinistcha `sv10-048`: *"As long as this Pokémon is on your
      Bench, prevent all damage from and effects of attacks from your opponent's
      Pokémon done to this Pokémon."*

      ⚠️ **ALREADY GATED WHEN YOU READ IT — THE ZONE CLAUSE IS RESOLVED HERE, IN
      THE FOLD, AND THAT WAS SETTLED BY READING THIS FUNCTION'S SIGNATURE RATHER
      THAN BY ANALOGY.** The handoff predicted the gate could not live here
      "because `passivesOf` takes a body and not a spot". It takes a body AND a
      `GameState`, and locating a body needs exactly those two — which is not a
      guess either: `benchShieldedFromDamage` at the bottom of this file has been
      doing that scan by top uid since D159. So `isOnBench(state, pokemon)` folds
      the clause at the same place `basicHpBonus` folds its STAGE clause and
      `damageReductionAfterWRIfType` folds its TYPE clause, and the five read
      sites get a BARE boolean with no predicate call beside it.

      ⚠️ **THAT IS THE WHOLE DIFFERENCE FROM ITS FOUR SIBLINGS ABOVE, AND IT IS
      D161's LINE VERBATIM: A GATE THAT NAMES THE *HOLDER* IS RESOLVED IN THE
      FOLD; A GATE THAT NAMES THE *ATTACKER* CANNOT BE RESOLVED ANYWHERE BUT A
      READ SITE.** `preventDamageFromTypes`, `preventDamageFromHasAbility` and
      `preventDamageAndEffectsFromSpecialEnergy` all name the attacker and all
      three pay a predicate call at every site. This one names only where its own
      body is standing, so it pays none.

      ⚠️ **THREE OF THE FIVE READ SITES ARE STRUCTURALLY DEAD FOR THIS FIELD, AND
      THEY ARE READ ANYWAY — the arms are TOTAL, not case-covering.** `attack.ts`'s
      main hit and `interpreter.ts snipeActive` both damage `…active` (§8: an
      attack's named target is an Active), and `attackEffectRefused` resolves
      `state.players[seat].active` too — so this field is FALSE at all three by
      construction, and the two that can ever be true are the BENCH arms, spread
      and `placeSnipe`. Written at all five because the deadness is a fact about
      today's op set and not a rule: the day an op aims an effect at a benched
      body, the guard is already where it must be. The MUTANTS are authored only
      at the two live arms, because a mutant at a dead one could not be killed.

      A BOOLEAN, by the standing rule its four siblings settled: the gate names no
      VALUE, so an OR over N sources is lossless and two writers cannot disagree.
      A SEPARATE field from the line above rather than a rider on it — merging
      them would hand Carracosta's two printings a protection that needs no
      Special Energy, and hand these three one that needs one. §9-suppressible
      like every flag in this loop (all three printings ARE Abilities) and nulled
      by `ignoreWR` at the snipe arm with its siblings. */
  preventDamageAndEffectsWhileBenched: boolean;
  /** §11 (D259) — does this Pokémon refuse the effects of an Item or Supporter the
      OPPONENT plays? Fraxure `sv06.5-045`/`-077` "Unnerve" and Cetitan ex
      `sv10-065`/`-210` "Snow Camouflage", 4 legal printings on one sentence.

      ⚠️ THE FIRST FLAG IN THIS FOLD WHOSE SOURCE IS NOT AN ATTACK, and therefore
      the first with NOTHING in the §8.5 pipeline reading it: its one read site is
      `interpreter.ts effectRefused`, on the TRAINER channel that slice widened the
      funnel to carry. The printed sentence has no damage half, so a damage site
      that consulted this flag would be inventing one.

      ⚠️ AND IT IS THE FIRST FLAG IN THIS FOLD WHOSE READ SITE CAN SEE A BENCHED
      BODY. `preventDamageAndEffectsWhileBenched` resolves its zone clause HERE
      because that clause is about the holder; this sentence prints no zone clause
      at all, so a benched Fraxure and an Active one answer identically and the
      fold has nothing to resolve. What changed is the READER — a Trainer aims at
      bodies an attack cannot. */
  preventTrainerEffects: boolean;
  /** §11 (D260) — does this Pokémon refuse the EFFECTS of an opponent's attack,
      with no damage half at all? Skeledirge `sv08-031` "Unaware", 1 legal
      printing: *"Prevent all effects of attacks used by your opponent's Pokémon
      done to this Pokémon. (Damage is not an effect.)"*

      ⚠️ `preventTrainerEffects` ONE LINE UP WITH THE CHANNEL SWAPPED, and it is
      a SECOND field rather than a rider for that field's own reason inverted:
      merged, Skeledirge would refuse a Crushing Hammer it does not print, and
      Fraxure would refuse an attack's Poison it does not print. Two disjoint
      antecedents on two consequents are two fields (D252's rule).

      ⚠️ AND NOTHING IN THE §8.5 PIPELINE MAY READ IT — the printed parenthetical
      *"(Damage is not an effect.)"* is the sentence saying so, and it is the one
      thing separating this flag from `preventDamageAndEffectsWhileBenched` two
      lines up. Its ONE read site is `interpreter.ts effectRefused`'s attack
      channel. NO zone clause is printed, so unlike D253's twin the fold has
      nothing to resolve and a benched holder answers exactly as an Active one. */
  preventAttackEffects: boolean;
  /** §8.5 (D255) — the printed RULE-BOX CLASSES an attacker must belong to for this
      Pokémon's prevention aura to stop its damage. The SIXTH member of the prevent
      family, and the second whose gate is PARAMETERISED (`preventDamageFromTypes`,
      D159, is the first). Two Standard-legal sentences, 5 printings:

        { suffix: "ex" }                   Sylveon `sv08.5-040` "Safeguard",
                                           Crustle `sv10-012`/`-186` "Mysterious
                                           Rock Inn" — 3 printings;
        { suffix: "ex", stage: "basic" }   Farigiraf ex `sv05-108`/`-194`
                                           "Armor Tail" — 2 printings.

      ⚠️ **A LIST AND NOT A BOOLEAN, AND THE THREE FIELDS ABOVE ARE THE ARGUMENT
      RATHER THAN A PRECEDENT TO PICK FROM.** D251 settled the rule: the unit of
      STORAGE is decided by the WRITE SITES, and the question a gate asks its writers
      is not "how many" but "can two of you disagree". `preventDamageFromHasAbility`
      and `preventDamageAndEffectsFromSpecialEnergy` name no VALUE, so an OR over N
      sources is lossless and both are flags. THESE TWO SENTENCES DISAGREE — one
      names Basic ex, the other any ex — so a scalar fold could only be last-wins and
      would silently drop a real prevention the day two sources land on one body.

      🛑 **AND NO BOARD THE CATALOG CAN BUILD OBSERVES THAT DIFFERENCE TODAY, WHICH
      IS `preventDamageFromTypes`' HOLE VERBATIM AND WAS MIS-STATED HERE FIRST.** The
      original draft argued the list from the POOL — "one Farigiraf ex and one
      Sylveon on the same Bench is a legal deck" — which is true and irrelevant: this
      function folds PER BODY, so two holders are two folds of one element each. Two
      entries on ONE body needs two SOURCES on one body, and `sources` is the
      holder's own passive plus its Tools plus its Energies, none of which writes
      this field. **The mutation harness is what caught the substitution** (`D255-
      fold-last-wins` survived and is now a declared `unreachable-population` row).
      🆕 **A SHAPE CLAIM ABOUT A FOLD IS A CLAIM ABOUT ITS SOURCE SET, NEVER ABOUT
      THE POOL'S PRINTINGS.** The field stays a LIST for D159's reason exactly: the
      unit of storage is decided by the WRITE SITES, and a valued gate must collect
      as the aggregation's SHAPE rather than because someone remembers that no Tool
      prints the sentence yet.

      ⚠️ **AND IT IS A LIST OF RECORDS, WHICH IS WHERE IT STOPS RESEMBLING
      `preventDamageFromTypes`.** A `PokemonType` is one printed token; a rule-box
      class is TWO printed axes (suffix and stage), and `cards.ts
      PreventedAttackerClass` carries the cross-product argument `AttackerClass` made
      at D239. NOT de-duplicated — the read is a `.some` over a predicate, which
      cannot tell a repeated entry from a single one, and a `Set` of records would
      not de-duplicate by VALUE anyway (D131's "one collection type per membership
      question").

      Like every member of the family it modifies only its HOLDER, so it rides this
      fold (§9-suppressible — all five printings ARE Abilities — and nulled by
      `ignoreWR` at the two snipe arms), and the ATTACKER is known only at the FOUR
      damage read sites, which resolve it through `cards.ts preventsAttackerClass`.
      FOUR and not five: the printed sentences say "prevent all damage", not "from
      and effects of", so `attackEffectRefused` is deliberately not widened. Empty on
      every board with no such holder, so the read sites pay one `.some` over
      nothing. */
  preventDamageFromAttackerClasses: PreventedAttackerClass[];
  /** §8.5 (D257) — full damage PREVENTION when the damage that would ACTUALLY be
      placed is this number OR MORE. Drednaw `sv07-044` "Impervious Shell",
      **1 legal printing on ONE sentence**:

        "Prevent all damage done to this Pokémon by attacks from your opponent's
         Pokémon if that damage is 200 or more."

      ⚠️ **THE FIRST GATE IN THIS FAMILY WHOSE SUBJECT IS THE *NUMBER* RATHER THAN A
      BODY.** Every one of the seven prevents above it is a fact about a CARD (a
      suffix, a type, an Ability, a class) or about a BOARD (an attachment, a zone);
      this one is a fact about the arithmetic of §8.5 itself. That is why it is the
      only member that could not have been priced by asking "what does the read site
      know about the attacker" — it needs the number the read site is about to
      place, which is why D240's `wouldDeal` hoist is the whole reason this row is
      cheap.

      🛑 **A NUMBER, SO THE FOLD IS A `Math.min` AND NOT AN OR.** D159's standing
      rule: a gate that names a VALUE cannot be collapsed to a boolean without
      losing which value. Two sources on one body with thresholds 200 and 150 are
      NOT the same as either alone — the LOWER threshold shields strictly more, so
      the min is the aggregation that keeps both readings true. ⚠️ **UNREACHABLE ON
      any board the catalog can build today** (one printing, and no Tool or Energy
      writes this field), so the direction is argued from the WRITE SITES rather
      than from an observable board, and the mutant that installs `Math.max` is
      declared `unreachable-population` rather than faked — D255's rule, applied
      deliberately rather than after the harness caught it.

      `undefined` — not `Infinity` — is the "no such aura" value, so the read sites
      spell an explicit presence check through `preventedByDamageThreshold` instead
      of comparing against a sentinel that would silently shield a 0-damage hit if
      the fold ever produced one.

      ⚠️ THE THRESHOLD IS INCLUSIVE (`>=`): the print says *"200 **or more**"*, which
      is the exact polarity `effects.ts PREVENT_DAMAGE_UP_TO_CAP` REFUSES on the
      attack side (D240) — and this row is why that refusal was written. Read at the
      FOUR damage sites and NOT at `attackEffectRefused`, for D240's reason verbatim:
      an EFFECT has no damage for a threshold to be about. */
  preventDamageAtOrAbove: number | undefined;
  /** §8.5 (D258) — the COIN-FLIP damage shields live on this body, each already
      GATED and each carrying the Ability name its flip must be announced under.
      Fezandipiti `sv06-096`/`sv06.5-073`/`sv08.5-045` "Adrena-Pheromone" and Kecleon
      `sv08-150`/`sv08-213` "Expert Hider" — **5 legal printings on TWO sentences**,
      backlog row 15-C.

      🛑 **THE ONE FIELD THIS FOLD RETURNS WHOSE READ IS NOT A PURE FUNCTION OF THE
      BOARD.** Every prevention above it answers yes or no from the state; this one
      answers *"draw a coin and find out"*, which is why the read sites do not consume
      it directly — they call `coinFlipShieldPrevents` below, the family's FIRST
      FUNNEL, which owns the RNG step and the `ABILITY_COIN_FLIP` row together.

      ⚠️ **ALREADY GATED WHEN YOU READ IT** — D253's line for the third slice running.
      Fezandipiti's *"has any {D} Energy attached"* names the HOLDER's attachments, and
      this function has the body AND the state, so `hasAttachedEnergy` resolves it HERE
      (where `damageAttacker`'s `requiresTool` is resolved) and the entries that come
      out are unconditional. An entry in this list means *"flip for this body now"*.

      ⚠️ **A LIST, AND FOR A REASON THE FAMILY HAS NOT USED BEFORE.** Its siblings
      collect when the gate names a VALUE (`preventDamageFromTypes`,
      `preventDamageFromAttackerClasses`) and flag when it names none
      (`preventDamageFromHasAbility`). This gate names none either — but two sources
      print two separate *"flip a coin"* instructions, so an OR over N would silently
      draw ONE coin where the printed rules draw two, and the number of RNG steps a
      board consumes is observable in every subsequent shuffle. **The question a
      valueless predicate asks its writers is "can two of you disagree"; these agree
      about the ANSWER and disagree about the COST.** UNREACHABLE today (no Tool or
      Energy writes the field, and no printing carries it twice), so the per-entry
      flip is declared in the corpus rather than faked.

      NOT de-duplicated, and `preventDamageFromAttackerClasses`' reason applies with
      an extra edge: two identical entries are two Abilities and therefore two coins,
      so collapsing them would be wrong even if the records matched byte for byte.
      §9-suppressible with the rest of the family — all five printings are Abilities,
      and a suppressed holder must draw NO coin, which the `sources[0]` drop gives
      for free. */
  preventDamageOnCoinFlip: { ability: string }[];
  /** 🆕 §8.1 (D298) — every CAUSE-CONDITIONED PRIZE REDUCTION an ATTACHED card on
      this body prints (Lillie's Pearl `sv09-151`, a Tool; Legacy Energy `sv06-167`,
      a Special Energy). RAW and UNEVALUATED, exactly as `cantAttackUnless` and
      `conditionalDamageBonusBeforeWR` are: every rider on the entry
      (`requiresInPlay`, `requiresHolderOwner`, `oncePerGame`) is a question about a
      SEAT or about the GAME, and this aggregation has neither — it has one body.
      The read site is flow.ts `planPrizes`, which has both.

      A LIST, and NOT summed into a scalar `by`, for the reason spelled on the
      interface field: the two printings carry DIFFERENT riders, so one body wearing
      both must offer the read site two separately-answerable entries. UNREACHABLE
      as a pair on any legal board today (a Tool and an Energy are different slots,
      so it is expressible), which is exactly why the corpus carries a row for it
      rather than an argument.

      ⚠️ §9 IS ANSWERED BY THE `sources` ORDER AND NOT BY THIS LINE. Both writers
      are attached cards — a Tool and an Energy, neither an Ability — so both sit
      past the `disabled` term and a Klefki aura cannot silence either. The holder's
      OWN printed passive can reach this field too (nothing forbids it) and would be
      dropped under a lock, which is the correct answer for an Ability and is why
      the collection lives in this loop rather than at the read site. */
  koPrizeReductions: KoPrizeReduction[];
  /** §12 (D172) — the Special Conditions this Pokémon CANNOT be given (Dachsbun
      sv01-099 "This Pokémon can't be Burned."; Pachirisu sv01-068/-208 "This
      Pokémon can't be Paralyzed."; Therapeutic Energy sv02-193 "…can't be affected
      by those Special Conditions" — Asleep, Confused, Paralyzed). The ONE field
      this aggregation returns that no damage site reads: its single consumer is
      interpreter.ts `applyStatus`, which is the engine's only writer of a §12
      condition.

      A LIST for `preventDamageFromTypes`' reason one field up, and the reason is
      the SOURCE SET rather than the printings: this fold runs over the holder's own
      passive PLUS every attached Tool PLUS (D174) every attached Energy, so several
      sources naming several conditions is a shape the aggregation must be able to
      report. ⚠️ Since D174 the INTERFACE field is a list too — the Energy printing
      names three — so this is a flat SPREAD rather than a push. NOT de-duplicated —
      the read is `.includes`, which cannot tell a repeated entry from a single one,
      and a `Set` here would be a second collection type for one membership question
      (D131).

      ⚠️ IT RIDES THIS FOLD PRECISELY SO THE §9 ANSWER IS NOT WRITTEN TWICE, AND
      SINCE D174 THE ANSWER HAS TWO SIGNS. The two Pokémon printings are ABILITIES,
      so a §9 lock over the holder must switch their immunity off and let the status
      land; the Energy printing is NOT an Ability, so a lock must leave it alone.
      Both happen HERE, in the one `disabled` drop the `sources` array makes on its
      FIRST element only. A build that read the catalog row directly at `applyStatus`
      would be one line shorter and would get BOTH signs wrong at once — this
      family's sharpest available defect, and the mutation pass drives it. */
  statusImmunities: StatusName[];
  /** §12 RECOVERY (D174) — the Special Conditions a live effect CLEARS from this
      body ("The Pokémon this card is attached to RECOVERS FROM BEING Asleep,
      Confused, or Paralyzed…", Therapeutic Energy sv02-193). Its single consumer is
      flow.ts `recoverStatuses`.

      ⚠️ IT IS THE FIELD THAT MADE THIS FOLD'S ANSWER TIME-DEPENDENT, and it is a
      separate list from `statusImmunities` above because the printings are separate
      clauses: the two Pokémon in this family refuse a condition and never clear one.
      Reported RAW (a list of tokens, not a decision) for the same reason
      `conditionalDamageBonusBeforeWR` is: the aggregation has no events array and
      must never write, so the site that owns the board does the clearing. */
  statusRecovery: StatusName[];
  /** §8.5 (D192) — does damage from attacks used by THIS Pokémon ignore "any
      effects on your opponent's Active Pokémon"? (Walking Wake ex "Azure Seas",
      6 printings / 6 Standard-legal.)

      ⚠️ THE ONLY FIELD THIS FOLD RETURNS THAT IS READ OFF THE **ATTACKER**. Every
      other boolean here answers a question about the body being HIT; this one
      answers a question about the body SWINGING, which is why attack.ts gained an
      attacker-side `passivesOf` read (through `attackerSuppressesTargetEffects`
      below) rather than another term on the `defenderPassives` it already had.
      It rides this fold and not a dedicated board scan because it modifies its
      HOLDER and nothing else — and because the §9 `disabled` drop above is
      load-bearing rather than incidental: "Azure Seas" is an Ability, and an
      Ability-lock must switch it off. */
  suppressTargetEffectsOnAttack: boolean;
  /** §8.1 (D208) — does this Pokémon refuse a Knock Out that would land on it at
      FULL HP, surviving on 10 HP instead? (Pikachu ex "Resolute Heart", Crustle
      "Sturdy" — 7 printings / 7 Standard-legal.)

      ⚠️ THE ONLY FIELD THIS FOLD RETURNS THAT IS NOT READ INSIDE THE §8.5 DAMAGE
      PIPELINE — it is read at the WRITE that ends it. Every prevention and
      reduction beside it bites BEFORE the number lands (they change `dealt`);
      this one lets the full number be computed and then clamps the TOTAL the
      board stores, because the printed sentence is about the resulting HP and not
      about the damage. It rides this fold rather than a direct read off `top` for
      `suppressTargetEffectsOnAttack`'s reason one field up, and the reason is
      just as load-bearing: both printings are ABILITIES, so a §9 lock must switch
      the survival off — which the `disabled` drop already does.

      Consumed ONLY by `koSurvivalClamp` below, which is the single read site;
      the four damage writers call that helper and never this flag, so "has full
      HP", "would be Knocked Out" and "becomes 10" cannot drift apart across
      them. */
  survivesKoAtFullHp: boolean;
} {
  const top = topCardOf(state, pokemon);
  // A locked Pokémon's own printed passive (an Ability) is suppressed; its Tools
  // are not Abilities and keep contributing. The lock aura itself is read by
  // disabledAbilityUids straight off the passive, never here, so this never
  // recurses (disableAbilities carries no field this aggregation consumes).
  const holderUid = topUid(pokemon);
  const disabled = holderUid !== undefined && disabledAbilityUids(state).has(holderUid);
  // ⚠️ THREE SOURCE CLASSES SINCE D174, AND THE THIRD IS THE ONE THAT IS NOT AN
  // ABILITY *AND* NOT A TOOL. `sources` was [the top card's printed passive, ...the
  // Tools'] from M4 until D174 added [...the attached ENERGY's]. Only the FIRST
  // element takes the §9 `disabled` drop, so the exemption the Energy needs is the
  // one the Tools have always had — and it is exempt because an Energy is not an
  // Ability, which is the same reason with a different noun rather than a new rule.
  //
  // ⚠️ EVERY FIELD BELOW SILENTLY GAINED AN ATTACHED-ENERGY CONTRIBUTOR THE DAY
  // THAT LINE LANDED, SO EVERY ONE WAS RE-READ. The audit, field by field over the
  // TWELVE `PassiveEffects` fields this loop READS (D174; they fold to the ELEVEN
  // keys the `return` below carries — `damageReductionAfterWRIfType` sums into
  // `damageReductionAfterWR` and `basicHpBonus` into `hpBonus`, so the two counts
  // are different questions and this one is "what can an Energy write". The TWELVE
  // fields NOT folded here — `disableAbilities`, `seatDamageReductionAfterWR`,
  // `seatDamageBonusBeforeWR` (D243, the newest and the one that makes this an
  // ENUMERATION rather than a count: it is a pre-W/R BONUS sitting one line from
  // three fields of that name that ARE folded, and the difference is the printed
  // subject, not the step), `removeWeakness`, `preventBenchDamageWhileActive`,
  // `noRetreatCostAura`, the six retreat/attack-cost aura fields — are read by
  // their own board scans off
  // `programFor(top.id)?.passive` and are UNREACHABLE from an Energy, which is what
  // bounds this audit to twelve rather than the interface's full twenty-three):
  //
  //   damageReductionAfterWR       reachable ✔ correct — "the Pokémon this card is
  //                                attached to takes N less damage" is a real Energy
  //                                sentence shape; the §8.5 sites sum sources and an
  //                                Energy is a source. No writer in this pool.
  //   damageReductionAfterWRIfType reachable ✔ correct — the gate names the HOLDER's
  //                                types, resolved below off `top.types`, which does
  //                                not care which card carried the number.
  //   damageBonusBeforeWR          reachable ✔ correct — same argument, other sign.
  //   damageBonusBeforeWRIf        reachable ✔ correct — collected RAW and evaluated
  //                                at the read sites; the source class is invisible
  //                                to a BoardCondition.
  //   damageBonusBeforeWRIfTarget  reachable ✔ correct — likewise, gated on the
  //                                DEFENDER's suffix at the read sites.
  //   basicHpBonus (→ hpBonus)     reachable ⚠️ AND THE ONE TO SAY OUT LOUD: it is
  //                                gated on `isBasic`, a fact about the HOLDER, so an
  //                                Energy-borne +HP would end on evolution exactly as
  //                                Bravery Charm's does. That is the right reading of
  //                                "the BASIC Pokémon this card is attached to" and
  //                                the WRONG one for an Energy printing that said
  //                                only "this Pokémon" — such a printing must use a
  //                                stage-free field, not this one. No writer today.
  //   damageAttacker               reachable ⚠️ its `requiresTool` rider reads
  //                                `pokemon.tools.length`, which is a fact about the
  //                                BOARD and not about the source, so an Energy
  //                                writing it would ask "does this body hold a Tool"
  //                                — coherent, but a printing meaning "…while this
  //                                ENERGY is attached" would need its own rider. No
  //                                writer today; named so it is not discovered later.
  //   damageAttackerOnKo           reachable ✔ correct — summed, source-blind.
  //   preventDamageFromExV         reachable ✔ correct — a boolean OR.
  //   preventDamageFromTypes       reachable ✔ correct — a list, source-blind.
  //   preventDamageFromHasAbility  reachable ✔ correct — a boolean OR (D251),
  //                                source-blind, `preventDamageFromExV`'s shape.
  //                                No Tool or Energy writer today; a Tool printing
  //                                the sentence would correctly SURVIVE a §9 lock,
  //                                and the five real printings are Abilities that
  //                                must not.
  //   preventDamageAndEffects…     reachable ✔ correct — a boolean OR (D252), the
  //     …FromSpecialEnergy         line above's shape with the EFFECTS half added.
  //                                Source-blind for the same reason, and its Tool /
  //                                Energy reachability answers the same way: an
  //                                attached source would correctly survive a §9
  //                                lock, and the two real printings are Abilities
  //                                that must not. ⚠️ AN ENERGY WRITER WOULD BE
  //                                COHERENT BUT SELF-REFERENTIAL — the gate reads
  //                                the ATTACKER's Special Energy, never the
  //                                holder's, so a Special Energy printing this
  //                                sentence would not fold into its own predicate.
  //                                No writer today.
  //   preventDamageFromAttacker…   reachable ✔ correct — a PUSH (D255), source-blind,
  //     …Classes                   `preventDamageFromTypes`' shape and not the three
  //                                flags': the gate names a VALUE and the pool prints
  //                                two of them, so sources must COLLECT. Its §9 answer
  //                                is the flags' answer verbatim — all five real
  //                                printings are Abilities and a lock must silence
  //                                them — and a Tool or Energy writer would correctly
  //                                SURVIVE a lock. No such writer today.
  //   preventDamageAtOrAbove       reachable ✔ correct — a `Math.min` (D257), and the
  //                                FIRST NUMERIC fold in this family. Neither a flag
  //                                nor a push: the gate names a VALUE, so a boolean
  //                                loses it, and two thresholds on one body have a
  //                                single correct answer (the LOWER one shields more)
  //                                rather than a set, so a list would push the choice
  //                                out to four read sites. §9-suppressible for the
  //                                flags' reason — the one real printing IS an
  //                                Ability — and a Tool or Energy writer would
  //                                correctly SURVIVE a lock. No such writer today,
  //                                which is exactly why the min is UNREACHABLE and is
  //                                DECLARED rather than driven.
  //   statusImmunities             reachable ✔ THE POINT — sv02-193 writes it.
  //   statusRecovery               reachable ✔ THE POINT — sv02-193 writes it.
  //
  // ⚠️ THE AUDIT'S ONE REAL BEHAVIOUR CHANGE IS THAT THERE IS NONE, AND THAT IS A
  // MEASUREMENT RATHER THAN A HOPE: `sv02-193` is the only card in the registry with
  // an `energy.passive` at all, so every other body's fold is byte-identical. The
  // claim is asserted over the whole registry in therapeuticEnergy.test.ts rather
  // than left here, because a second Energy row added without a re-reading is
  // exactly the drift this comment cannot catch.
  //
  // ⚠️ D192 ADDS A THIRTEENTH READ FIELD, AUDITED ON ARRIVAL rather than left for
  // the next reader of this block (the counts above are D174's population and are
  // left standing; this is the delta):
  //
  //   suppressTargetEffectsOnAttack reachable ✔ correct — a boolean OR,
  //                                source-blind, `preventDamageFromExV`'s shape
  //                                exactly. ⚠️ AND ITS §9 ANSWER MATTERS IN THE
  //                                DIRECTION THE ENERGY EXEMPTION DOES NOT: the one
  //                                real writer is an ABILITY (Walking Wake ex
  //                                "Azure Seas"), so a lock over the holder MUST
  //                                switch it off — which the `disabled` drop on
  //                                `sources[0]` already does, and which is the
  //                                whole reason this field rides the fold instead
  //                                of being read straight off `top` at the attack.ts
  //                                site. An Energy printing of the same sentence
  //                                would correctly survive a lock. None today.
  //
  // ⚠️ D324 ADDS A FOURTEENTH READ FIELD, AUDITED ON ARRIVAL like D192's, and it
  // is the ONE ENTRY IN THIS AUDIT THAT THE AUDIT ITSELF ORDERED:
  //
  //   hpBonus                      reachable ✔ correct — a stage-free summand, and
  //                                the printing `basicHpBonus`'s own audit line
  //                                above says out loud must exist ("a printing that
  //                                said only 'this Pokémon' must use a stage-free
  //                                field, not this one"). Hero's Cape sv05-152 is
  //                                that printing and Cynthia's Power Weight
  //                                sv10-162 is it with an owner clause. ⚠️ AN
  //                                ENERGY WRITER WOULD BE COHERENT AND IS THE
  //                                DIFFERENCE FROM THE LINE ABOVE: a Special Energy
  //                                printing "+HP" would keep its bonus across an
  //                                evolution, which is the RIGHT reading of a
  //                                stage-free sentence and the reason the two
  //                                fields are two. No Energy writer today; both
  //                                writers are Tools, so a §9 lock leaves both
  //                                standing — correctly, a Tool is not an Ability.
  //                                ⚠️ AND ITS `beneficiary` FILTER READS `top`, the
  //                                HOLDER's card, so it is `holderTypes`' axis with
  //                                a CardFilter instead of a type — an unreadable
  //                                top card fails it and gets LESS HP, never more.
  //
  // ⚠️ D325 ADDS A FIFTEENTH READ FIELD AND ONE NEW GATE ON THE FOURTEENTH,
  // AUDITED ON ARRIVAL like D192's and D324's:
  //
  //   hpBonus.requiresEnergyType   reachable ✔ correct — and it is the FIRST gate
  //                                in this loop that asks about the holder's
  //                                ATTACHED CARDS rather than about its stack.
  //                                `isBasic` is STAGE, `holderTypes` is TYPE,
  //                                `onBench` is SPOT; this is ENERGY, a fourth
  //                                axis. ⚠️ AN ENERGY-BORNE WRITER WOULD BE
  //                                COHERENT AND SLIGHTLY UNCOMFORTABLE: a Special
  //                                Energy printing "if this Pokémon has any {D}
  //                                attached, +100 HP" could gate on ITSELF. It
  //                                would still be right (it IS attached), but it
  //                                is worth having said out loud before such a
  //                                printing arrives. None today — the one writer
  //                                is an Ability, Okidogi, so a §9 lock takes the
  //                                +100 off through the `sources[0]` drop.
  //   hpBonusPer                   reachable ✔ correct — and the source class is
  //                                MORE than invisible to it, it is the arithmetic
  //                                itself: an Energy-borne `attachedEnergy` scale
  //                                would count the very card that carried it,
  //                                which is coherent (again, it IS attached) and
  //                                is exactly the reading "for each {F} Energy
  //                                attached to it" demands. Both writers are
  //                                Abilities today, so both take the §9 drop.
  //                                ⚠️ AND IT IS THE FIRST FOLDED FIELD WHOSE
  //                                EVALUATION READS A **SEAT** — `seatOfPokemon`,
  //                                for the opponent's taken Prizes. That is a new
  //                                shape for this loop and not a new source class:
  //                                the seat is derived from the body it was handed,
  //                                never passed in, so the fold stays callable from
  //                                every read site that has only an InPlayPokemon.
  //
  // 🛑 NOTE WHAT IS *NOT* HERE. D324's OTHER two HP fields — `seatHpBonus` (the
  // Ludicolo aura) and `StadiumEffects.hpDelta` — are UNREACHABLE from this loop by
  // construction: one is a fact about a DIFFERENT body and one is not on a card in
  // play at all. They join the twelve unfolded fields listed at the top of this
  // block and are read by their own scans, which is the same boundary
  // `seatDamageReductionAfterWR` sits on and not a new one.
  const sources: (PassiveEffects | undefined)[] = [
    disabled || top === undefined ? undefined : programFor(top.id)?.passive,
    ...pokemon.tools.map((uid) => {
      const id = state.cardIdByUid[uid];
      return id === undefined ? undefined : programFor(id)?.passive;
    }),
    ...pokemon.energy.map((uid) => {
      const id = state.cardIdByUid[uid];
      return id === undefined ? undefined : programFor(id)?.energy?.passive;
    }),
  ];
  const isBasic = top !== undefined && isBasicPokemon(top);
  // D161 — the HOLDER's printed types, for Rock Chestplate's "{F} Pokémon this
  // card is attached to" gate. Read from the TOP card, so an evolution that
  // changes the line's type ends the reduction with the Tool still attached —
  // `isBasic` one line up, on the other axis of the same printed idiom.
  const holderTypes = top?.types ?? [];
  // D253 — the HOLDER's ZONE, for Poltchageist's "As long as this Pokémon is on
  // your Bench" gate. Bound HERE with `isBasic` and `holderTypes`, the fold's two
  // other holder-shaped gates, because it is the same kind of clause on a third
  // axis: STAGE, TYPE, and now SPOT. Live-read like both of them — a promotion out
  // of the Bench (a KO, a Switch, a retreat) ends the prevention on the spot,
  // because nothing is stamped and every read site passes the CURRENT state.
  const onBench = isOnBench(state, pokemon);
  const hasTool = pokemon.tools.length > 0;
  let damageReductionAfterWR = 0;
  let damageBonusBeforeWR = 0;
  let hpBonus = 0;
  let damageAttacker = 0;
  let damageAttackerOnKo = 0;
  let preventDamageFromExV = false;
  let preventDamageFromHasAbility = false;
  let preventDamageAndEffectsFromSpecialEnergy = false;
  let preventDamageAndEffectsWhileBenched = false;
  let preventTrainerEffects = false;
  let preventAttackEffects = false;
  let suppressTargetEffectsOnAttack = false;
  let survivesKoAtFullHp = false;
  // D257 — the DAMAGE THRESHOLD, and the family's first NUMERIC accumulator.
  // `undefined` is the "no such aura" value rather than `Infinity`, so the read
  // sites cannot mistake "shields nothing" for "shields at an absurd number".
  let preventDamageAtOrAbove: number | undefined;
  const preventDamageFromTypes: PokemonType[] = [];
  const preventDamageFromAttackerClasses: PreventedAttackerClass[] = [];
  // D258 — the COIN-FLIP shields, collected with their Ability names because a fold
  // destroys provenance and `ABILITY_COIN_FLIP` has to name one.
  const preventDamageOnCoinFlip: { ability: string }[] = [];
  const koPrizeReductions: KoPrizeReduction[] = [];
  const statusImmunities: StatusName[] = [];
  const statusRecovery: StatusName[] = [];
  const conditionalDamageBonusBeforeWR: { amount: number; cond: BoardCondition }[] = [];
  const targetConditionalDamageBonusBeforeWR: {
    amount: number;
    targetSuffix: PokemonSuffix;
  }[] = [];
  const cantAttackUnless: BoardCondition[] = [];
  let attackFirstTurnExempt = false;
  const evolveEarlyExempt: (BoardCondition | undefined)[] = [];
  for (const passive of sources) {
    if (passive === undefined) continue;
    damageReductionAfterWR += passive.damageReductionAfterWR ?? 0;
    // D161 — the same number, gated on the holder's own printed type. SUMMED into
    // the ungated total rather than reported separately: it is the identical
    // sentence at the identical §8.5 step, so splitting it would give the read
    // sites two channels for one reading (D131).
    const typed = passive.damageReductionAfterWRIfType;
    if (typed !== undefined && holderTypes.includes(typed.type)) {
      damageReductionAfterWR += typed.amount;
    }
    damageBonusBeforeWR += passive.damageBonusBeforeWR ?? 0;
    if (passive.damageBonusBeforeWRIf !== undefined)
      conditionalDamageBonusBeforeWR.push(passive.damageBonusBeforeWRIf);
    if (passive.damageBonusBeforeWRIfTarget !== undefined)
      targetConditionalDamageBonusBeforeWR.push(passive.damageBonusBeforeWRIfTarget);
    if (isBasic) hpBonus += passive.basicHpBonus ?? 0;
    // D324 — the STAGE-FREE twin of the line above, summed into the SAME
    // accumulator and gated separately. Hero's Cape prints "the Pokémon this card
    // is attached to" with no stage clause, so it must NOT take `isBasic`;
    // Cynthia's Power Weight prints an owner instead of a stage, so it takes
    // `beneficiary` against the holder's top card. One number, two gates, because
    // the read site asks one question ("what is this body's max HP") and D131 says
    // it must not be handed two channels to add up itself.
    // D325 — and the THIRD gate on the same one number: Okidogi's "If this Pokémon
    // has any {D} Energy attached". `hasAttachedEnergy` and not
    // `countAttachedEnergy`, because the printed word is "any" — see the field.
    // This function holds the body AND the state, so the energy question resolves
    // HERE exactly as `preventDamageOnCoinFlip.requiresEnergyType`'s does below,
    // rather than being collected raw for a read site to ask later.
    const stageFree = passive.hpBonus;
    if (
      stageFree !== undefined &&
      (stageFree.beneficiary === undefined || matchesFilter(top, stageFree.beneficiary)) &&
      (stageFree.requiresEnergyType === undefined ||
        hasAttachedEnergy(state, pokemon, stageFree.requiresEnergyType))
    ) {
      hpBonus += stageFree.amount;
    }
    // D325 — the SCALED twin, summed into the SAME accumulator as the two flat
    // gates above for D131's reason (one question, one channel). `amount × count`,
    // and the count is 0 on an empty board, so this can only ever ADD — the D324
    // `Math.max` floor in `effectiveMaxHp` is not weakened by it and Gravity
    // Mountain stays the engine's only subtrahend.
    const scaled = passive.hpBonusPer;
    if (scaled !== undefined) hpBonus += scaled.amount * maxHpScaleCount(state, pokemon, scaled.scale);
    if (
      passive.damageAttacker !== undefined &&
      (passive.damageAttacker.requiresTool !== true || hasTool)
    )
      damageAttacker += passive.damageAttacker.amount;
    // No `requiresTool` twin: the one printing IS a Tool, and an unread gate is
    // the D156 defect. It rides the SAME Ability-lock rule as its sibling by
    // sitting in this loop — a §9 lock suppresses a holder's own printed passive
    // and never an attached Tool's, so Vengeful Punch keeps working under Klefki.
    damageAttackerOnKo += passive.damageAttackerOnKo?.amount ?? 0;
    if (passive.preventDamageFromExV === true) preventDamageFromExV = true;
    if (passive.preventDamageFromType !== undefined)
      preventDamageFromTypes.push(passive.preventDamageFromType);
    // D251 — the attacker-HAS-AN-ABILITY prevent, a boolean OR exactly like
    // `preventDamageFromExV` two lines up and NOT a push like the line between
    // them: the gate names no value, so an OR is lossless (the interface field
    // argues it). In this loop for the §9 reason every flag in it is here for —
    // all five printings ARE Abilities, so Klefki's lock must switch the
    // prevention off, and reading `programFor(top.id)` straight off `top` at the
    // four damage sites would be shorter and would get that wrong silently.
    if (passive.preventDamageFromHasAbility === true) preventDamageFromHasAbility = true;
    // D252 — the WIDE spelling of the line above: same boolean OR, same §9 answer
    // (both printings ARE Abilities, so Klefki's lock must switch the prevention
    // off), and the only difference is that the flag is read at FIVE sites rather
    // than four. It is NOT derived from the line above and the line above is not
    // derived from it: an engine that treated "prevent all damage" as implying
    // "and effects of" would give every one of D251's five printings a protection
    // its text does not print, which is the sharpest observable claim this field
    // makes.
    if (passive.preventDamageAndEffectsFromSpecialEnergy === true)
      preventDamageAndEffectsFromSpecialEnergy = true;
    // D253 — the same WIDE spelling with the attacker property dropped and a zone
    // clause added, and the `&& onBench` is the entire edit the zone clause costs
    // anywhere in the engine. `isBasic`'s shape one screen up, not
    // `preventsAttackerType`'s: the antecedent is about THIS body, so it is
    // answerable with what this fold already holds, and answering it here is what
    // keeps the five read sites free of a predicate call.
    if (passive.preventDamageAndEffectsWhileBenched === true && onBench)
      preventDamageAndEffectsWhileBenched = true;
    // D259 — the TRAINER-borne shield, and a BARE OR with no antecedent to resolve,
    // which is the whole difference from the line directly above. That sentence
    // prints "As long as this Pokémon is on your Bench"; this one prints no zone
    // clause, no attacker clause and no magnitude, so there is nothing for the fold
    // to answer beyond "does some live source on this body grant it". In this loop
    // rather than read off `top` at the read site for the §9 reason: all four
    // printings ARE Abilities, so Klefki's lock must switch the refusal off and let
    // the Crushing Hammer through.
    if (passive.preventTrainerEffects === true) preventTrainerEffects = true;
    // D260 — the ATTACK-borne twin of the line directly above, and a BARE OR for
    // that line's reason verbatim: no zone clause, no attacker clause, no
    // magnitude. In this loop rather than read off `top` at the read site because
    // the printing IS an Ability and Klefki's lock must let the Poison land.
    if (passive.preventAttackEffects === true) preventAttackEffects = true;
    // D255 — the attacker's printed RULE-BOX CLASS, and the FIRST PUSH in this
    // family since D159's type list. A push and not an OR because the gate names a
    // VALUE and this pool prints TWO of them ("Pokémon ex" and "Basic Pokémon ex"),
    // so two sources on one board can genuinely disagree and a scalar fold would be
    // last-wins — `preventDamageFromType` three lines up, verbatim, and the reason
    // the interface field is a list. In this loop for the §9 reason every entry in
    // it is here for: all five printings ARE Abilities, so Klefki's lock must
    // switch the prevention off, and reading `programFor(top.id)` straight off
    // `top` at the four damage sites would be shorter and would get that wrong
    // silently.
    if (passive.preventDamageFromAttackerClass !== undefined)
      preventDamageFromAttackerClasses.push(passive.preventDamageFromAttackerClass);
    // D257 — the DAMAGE THRESHOLD, and the ONLY line in this loop that is neither an
    // OR, a push nor a sum. `Math.min` because the field names a VALUE and the two
    // readings a scalar could take are not equivalent: a lower threshold shields
    // STRICTLY MORE damage, so keeping the minimum is the only fold under which
    // "this body is shielded at 150" and "this body is shielded at 200" are both
    // still true afterwards. A push would have been the D255 answer and is wrong
    // here for a reason worth stating: two `PreventedAttackerClass` entries describe
    // two DISJOINT attacker sets and both must be tested, where two thresholds
    // describe two NESTED damage sets and only the wider one can ever matter.
    // ⚠️ UNREACHABLE — no board this catalog can build gives one body two writers of
    // this field, so `min` and `max` and last-wins all agree today. Declared in the
    // corpus (`D257-threshold-fold-max`) rather than faked with a fixture no
    // printing justifies, which is D130's standing precedent and D255's lesson.
    // In THIS loop, not read off `top`, for `preventDamageFromExV`'s §9 reason: the
    // one real printing IS a Pokémon Ability, so Klefki's lock must switch it off.
    if (passive.preventDamageAtOrAbove !== undefined)
      preventDamageAtOrAbove =
        preventDamageAtOrAbove === undefined
          ? passive.preventDamageAtOrAbove
          : Math.min(preventDamageAtOrAbove, passive.preventDamageAtOrAbove);
    // D258 — the COIN-FLIP shield, and the ONE line in this loop that RESOLVES a
    // printed conjunct instead of just copying a value. `requiresEnergyType` is
    // Fezandipiti's "has any {D} Energy attached", a fact about the HOLDER, and this
    // is where a holder gate folds (D253) — `damageAttacker`'s `requiresTool` two
    // screens up is the same idiom on the same argument. ABSENT means Kecleon's
    // antecedent-free sentence, so the `??` is not a default but the other printing.
    //
    // ⚠️ PUSHED, NOT OR'd: two sources are two printed "flip a coin" instructions and
    // therefore two RNG steps. In THIS loop rather than read off `top` for
    // `preventDamageFromExV`'s §9 reason, which bites harder here than anywhere else
    // in the family — a locked holder must draw NO coin, or the lock changes every
    // subsequent draw in the game rather than just this one prevention.
    if (
      passive.preventDamageOnCoinFlip !== undefined &&
      (passive.preventDamageOnCoinFlip.requiresEnergyType === undefined ||
        hasAttachedEnergy(state, pokemon, passive.preventDamageOnCoinFlip.requiresEnergyType))
    )
      preventDamageOnCoinFlip.push({ ability: passive.preventDamageOnCoinFlip.ability });
    // 🆕 D298 — the §8.1 attached PRIZE REDUCTION, pushed RAW. The line directly
    // above resolves its own rider here (`requiresEnergyType` is a question about
    // THIS body, which the fold holds); this one resolves NONE of its three,
    // because every one of them is a question about the SEAT (`requiresInPlay`),
    // about the HOLDER'S NAME (`requiresHolderOwner`, which the fold could answer
    // but the read site must anyway pair with the attack-cause clause) or about
    // the GAME (`oncePerGame`). `cantAttackUnless`' rule verbatim: what this
    // aggregation cannot answer, it must not pretend to.
    if (passive.onKoPrizeReduction !== undefined)
      koPrizeReductions.push(passive.onKoPrizeReduction);
    // D172 — the §12 immunity, collected exactly like the line above it and for
    // the same reason. It is in THIS loop rather than beside `top` because that
    // is what buys the §9 gate: `sources` has already dropped the holder's own
    // passive if it is locked, and has already kept every Tool's — and, since
    // D174, every attached Energy's. A SPREAD rather than a push since D174: the
    // interface field became a list the day a printing named three conditions.
    if (passive.statusImmunities !== undefined) statusImmunities.push(...passive.statusImmunities);
    // D174 — the §12 RECOVERY, the immunity's printed twin on the one card that
    // prints both. Same loop, same §9 answer, and deliberately NOT derived from the
    // line above: two of this family's three sentences refuse without recovering.
    if (passive.statusRecovery !== undefined) statusRecovery.push(...passive.statusRecovery);
    // D192 — the ATTACKER-side suppression, a boolean OR exactly like
    // `preventDamageFromExV` eight lines up. In this loop rather than read off
    // `top` for that field's reason AND for one of its own: the §9 drop is what
    // makes an Ability-lock silence "Azure Seas", and a build that read the
    // catalog row directly at the attack.ts site would be shorter and would get
    // that wrong silently.
    if (passive.suppressTargetEffectsOnAttack === true) suppressTargetEffectsOnAttack = true;
    // D208 — the §8.1 KO-survival flag, a boolean OR exactly like the line above
    // it and `preventDamageFromExV` before that. In this loop for BOTH of that
    // field's reasons: the §9 drop on `sources[0]` is what makes an Ability-lock
    // silence "Resolute Heart" / "Sturdy" (both printings ARE Abilities), and a
    // build that read the catalog row straight off `top` at the four damage-write
    // sites would be shorter and would get that wrong silently.
    //
    // ⚠️ ITS TOOL AND ENERGY REACHABILITY IS THE AUDIT'S ANSWER, NOT AN ACCIDENT.
    // An attached source correctly SURVIVES a lock (a Tool is not an Ability), and
    // Survival Brace sv06-164 is a real printing of exactly this sentence on a
    // TOOL — so the field is already shaped for the twin. What stops that card
    // being authored today is its SECOND sentence ("Then, discard this card."),
    // not this fold. No Tool or Energy writer in the registry today.
    if (passive.survivesKoAtFullHp === true) survivesKoAtFullHp = true;
    // D242 — the §8 attack GATE, collected RAW exactly like the two conditional
    // damage-bonus lists above it, and IN THIS LOOP for `survivesKoAtFullHp`'s
    // reason: the §9 drop on `sources[0]` is what makes Klefki's Ability-lock
    // silence "Power Saver" and hand the Mewtwo its attack back. Reading the
    // catalog row off `top` at the payability sites would be shorter and would
    // get that wrong silently.
    if (passive.cantAttackUnless !== undefined) cantAttackUnless.push(passive.cantAttackUnless);
    // D277 — the §4 attack LICENCE, the mirror image of the gate one line up and
    // in this loop for the same reason: the §9 drop on `sources[0]` is what makes
    // Klefki's Ability-lock silence "Debut Performance" and hand the §4 ban back.
    // A boolean OR rather than a push, like `survivesKoAtFullHp` above — the read
    // sites want a yes/no and no message names the source.
    if (passive.attackFirstTurnExempt === true) attackFirstTurnExempt = true;
    // D278/D279 — the §4/§10 EVOLVE licence: `cantAttackUnless`'s COLLECT-RAW
    // shape (four lines up) rather than `attackFirstTurnExempt`'s boolean OR,
    // because the two printings that carry it gate on two DIFFERENT KINDS of
    // antecedent and only one of them is answerable here.
    //
    // `activeOnly` is Eevee's *"As long as this Pokémon is in the Active Spot"*,
    // and it is `preventDamageAndEffectsWhileBenched`'s `&& onBench` (D253) with
    // the sign flipped — the antecedent names THIS body, and the fold already
    // computes `onBench` for D253, so answering it here costs one conjunct.
    // 🛑 IT IS A PER-PRINTING FLAG AND NOT A PROPERTY OF THE FIELD: Karrablast
    // and Shelmet print NO Active-Spot clause, and a build that kept D278's
    // unconditional `&& !onBench` would REFUSE a benched Karrablast the card
    // licenses — silent, because it fails by being too strict.
    //
    // `ifInPlay` is *"If you have Shelmet in play"* and is NOT answered here:
    // `passivesOf` has no seat and that clause is seat-relative, so it is lifted
    // into a `BoardCondition` and folded by `evolveEarlyLicensed` (interpreter.ts)
    // where `conditionHolds` lives — `cantAttackUnless`'s split verbatim.
    //
    // ⚠️ `!onBench` IS "ACTIVE" ONLY FOR A BODY THAT IS IN PLAY, AND THAT IS THE
    // ONE DIRECTION THIS LINE DIFFERS FROM D253's. `isOnBench` answers FALSE for
    // a body with no resolvable top uid — the conservative direction there
    // (protect LESS), the permissive one here (license MORE). It cannot
    // over-grant regardless: the licence rides `sources[0]`, which is the TOP
    // CARD's own program, so a body with no top card contributes no passive at
    // all and the list is empty before the zone is ever consulted.
    //
    // In this loop for `attackFirstTurnExempt`'s §9 reason: the licence IS a
    // printed Ability, so Klefki's Ability-lock must silence it and hand BOTH
    // bans back.
    const licence = passive.evolveEarlyExempt;
    if (licence !== undefined && (licence.activeOnly !== true || !onBench)) {
      evolveEarlyExempt.push(
        licence.ifInPlay === undefined
          ? undefined
          : { kind: "yourNamedPokemonInPlay", name: licence.ifInPlay },
      );
    }
  }
  return {
    damageReductionAfterWR,
    damageBonusBeforeWR,
    conditionalDamageBonusBeforeWR,
    targetConditionalDamageBonusBeforeWR,
    cantAttackUnless,
    attackFirstTurnExempt,
    evolveEarlyExempt,
    hpBonus,
    damageAttacker,
    damageAttackerOnKo,
    preventDamageFromExV,
    preventDamageFromTypes,
    preventDamageFromHasAbility,
    preventDamageAndEffectsFromSpecialEnergy,
    preventDamageAndEffectsWhileBenched,
    preventTrainerEffects,
    preventAttackEffects,
    preventDamageFromAttackerClasses,
    preventDamageAtOrAbove,
    preventDamageOnCoinFlip,
    koPrizeReductions,
    statusImmunities,
    statusRecovery,
    suppressTargetEffectsOnAttack,
    survivesKoAtFullHp,
  };
}

/** §8.1 KO SURVIVAL — the HP `remaining` a clamped body is left with. The printed
    number, converted once, here, where the family's other printed constants are
    (`damageAttackerOnKo`'s counters are converted at the registry row for the same
    reason): "its remaining HP becomes 10". */
const KO_SURVIVAL_REMAINING_HP = 10;

/** §8.1 THE KO-SURVIVAL CLAMP — the new `damage` total for `pokemon` when it has
    FULL HP, carries the survival passive, and `dealt` HP of ATTACK DAMAGE would
    Knock it Out; `null` when the clamp does not fire and the caller must write its
    ordinary `pokemon.damage + dealt`.

    "If this Pokémon has full HP and would be Knocked Out by damage from an attack,
    it is not Knocked Out, and its remaining HP becomes 10." — Pikachu ex "Resolute
    Heart", Crustle "Sturdy" (7 printings, 7 Standard-legal; registry.ts
    `KO_SURVIVAL`).

    ⚠️ IT IS A CLAMP AT THE DAMAGE WRITE AND NOT A FIFTH KO-DETECTION SITE, WHICH
    IS THE WHOLE SLICE. The antecedent "has full HP" is a fact about the PRE-damage
    board, and it is unanswerable anywhere downstream: flow.ts's ONE lethality test
    `isLethallyDamaged` reads `pokemon.damage`, which by then ALREADY INCLUDES the
    hit, and every one of its call sites — `lethalRefs`, `collectKnockOuts`,
    `koRecoilOf`, turn.ts's post-evolution check — is post-damage, as are all four
    of the engine's KO/post-KO detection sites (`onKnockOutTrigger`, `triggersOf`,
    `passivesOf`'s sweep readers, `koToolTriggersOf`). D199's remainder row filed
    this as a hook on that sweep; the sweep is precisely where the datum has been
    destroyed. Read instead at the four §8.5 DAMAGE WRITES — attack.ts's main hit
    and interpreter.ts's `spreadDamage`, `placeSnipe`'s `deals` arm and
    `snipeActive` — where the pre-hit value is still in scope, this needs NO new
    detection site. D171 bought the fourth at a high price; this slice buys none.

    ⚠️ AND THAT PLACEMENT IS WHAT MAKES EVERY DOWNSTREAM COLLISION ANSWER ITSELF.
    Once the clamped total is on the board, the survivor simply IS NOT lethally
    damaged, so: `lethalRefs` does not list it, `collectKnockOuts` emits no
    `KNOCKED_OUT` and stages no `takePrizes`, no `ko:` park is queued, and
    `koRecoilOf`'s `doomed` set — taken from `lethalRefs` itself — excludes it, so a
    Vengeful Punch on the survivor stays silent because NO KO OCCURRED. None of
    those four sites is touched by this slice; they are correct by construction.
    What deliberately still fires is `damageAttacker` (Rocky Helmet / Counterattack
    Quills), gated on `dealt > 0` — the attack really did deal its damage — which is
    why this helper clamps the STORED TOTAL and never `dealt` itself.

    ⚠️ "DAMAGE FROM AN ATTACK" IS THE ENGINE'S STANDING BOUNDARY, INHERITED RATHER
    THAN REDRAWN. A PLACED COUNTER IS NOT DAMAGE (D138/D139/D142; the catalog prints
    the rule on Bronzong sv03-145), so no `COUNTERS_PLACED` writer calls this: not
    the put-counter snipe, not `counterPut`, not the counter MOVE, not `damageSelf`,
    and NOT the Checkup's poison and burn (flow.ts). A full-HP survivor finished by
    poison at the Checkup dies for real, and the suite drives that rather than
    assuming it.

    THE THREE REFUSALS, in the order they are checked and each for its own reason:
      • `pokemon.damage !== 0` — THE PRINTED ANTECEDENT. Full HP means no damage
        counters at all; one counter and the body dies normally.
      • no `survivesKoAtFullHp` — read through `passivesOf`, so a §9 Ability-lock
        over the holder switches it off (both printings are Abilities).
      • `hp === null` — the catalog data gap, which `effectiveMaxHp` owns and which
        NEVER KOs (flow.ts `isLethallyDamaged` says the same), so again there is no
        KO to refuse.
    The lethality test itself is `damage + dealt >= hp`, `isLethallyDamaged`'s
    comparison verbatim — `>=` and not `>`, because an EXACTLY lethal hit is the
    common case and the whole point of the card. The two predicates cannot be
    shared as code (flow.ts imports this module, so the arrow cannot reverse), so
    the suite asserts they agree instead.

    `effectiveMaxHp` and NOT the printed `hpOf`: a Bravery Charm on the holder
    raises both the bar it must clear AND the HP it is left holding, and reading the
    raw printed number would get both wrong on the same board.

    ⚠️ THERE IS DELIBERATELY NO `dealt <= 0` GUARD, AND ITS ABSENCE IS A MEASUREMENT
    RATHER THAN AN OVERSIGHT. One was written, and mutation testing found it
    UNKILLABLE — because it is provably dead: reaching the lethality test at all
    requires `pokemon.damage === 0`, and `effectiveMaxHp` never returns a non-positive
    number (a non-positive printed hp is the data gap and returns `null` one line
    up), so `0 + dealt >= hp >= 1` can only hold for `dealt >= 1`. A prevented or
    zero hit is therefore already refused by the comparison below, on exactly the
    right ground — "this would not have Knocked anything Out" — rather than by a
    second rule saying the same thing less precisely. Removed rather than tested
    around, which is D205's precedent for an unreachable branch. The BEHAVIOUR is
    still asserted (koSurvival.test.ts drives `dealt` of 0 and −10); what is gone is
    a comparison no input could distinguish. */
export function koSurvivalClamp(
  state: GameState,
  pokemon: InPlayPokemon,
  dealt: number,
): number | null {
  if (pokemon.damage !== 0) return null;
  if (!passivesOf(state, pokemon).survivesKoAtFullHp) return null;
  const hp = effectiveMaxHp(state, pokemon);
  if (hp === null) return null;
  if (pokemon.damage + dealt < hp) return null;
  // "its remaining HP becomes 10" — the damage total that leaves exactly that much
  // standing. Floored, so a printing with 10 HP or less lands at 0 rather than
  // negative damage; no such body exists in the pool and the floor is not load-
  // bearing, it is `Math.max(0, …)` for the reason every other write site has one.
  return Math.max(0, hp - KO_SURVIVAL_REMAINING_HP);
}

/** §8.5 (D159) — does `attacker` belong to one of the printed TYPES a holder's
    prevention aura names? The resolution half of `passivesOf`'s
    `preventDamageFromTypes`, and `attackerMatchesClass`'s sibling two functions
    down: the same "the gate is a fact about the ATTACKER, so it can only be
    answered where the attacker is known" split D146 made for `AttackBlock`, and
    D107's `isExOrV` made before that.

    The read is `Card.types.includes`, the SAME reading Weakness and Resistance
    make two lines later in the pipeline and the same one `opponentActiveHasType`
    makes (interpreter.ts `conditionHolds`) — reused rather than restated, so
    "your opponent's {R} Pokémon" cannot come to mean something different from
    what the §8.5 modifiers mean by a Fire Pokémon. `types` is an ARRAY and dual
    types are a real printing, so the two lists are intersected rather than
    compared; every Pokémon row in the local pool carries exactly one.

    NOT an exhaustive switch, unlike `attackerMatchesClass` — that predicate's
    vocabulary is an ENGINE union whose members each need a hand-written reading,
    where this one's is a CATALOG value that reads itself. There is nothing tsc
    could demand of a new member.

    `undefined` (no resolvable attacking card) is FALSE, the conservative direction
    `attackBlockOf` chose for a filtered block: an unreadable attacker protects
    LESS rather than more. It is structurally unreachable for a declared attack
    (attacks come from the Active) and answered anyway, for the reason the Bench
    arms of the damage sites are guarded — these reads must be TOTAL. */
export function preventsAttackerType(
  types: readonly PokemonType[],
  attacker: Card | undefined,
): boolean {
  if (types.length === 0 || attacker === undefined) return false;
  const printed = attacker.types ?? [];
  return types.some((type) => printed.includes(type));
}

/** §8.5 (D257) — is the damage about to be placed BIG ENOUGH to trip the holder's
    printed threshold? The resolution half of `passivesOf`'s
    `preventDamageAtOrAbove`, and `preventsAttackerType`'s sibling one function up
    on a third axis: that one is answered against the ATTACKER, D252's against the
    BOARD, and this one against the NUMBER.

    Drednaw `sv07-044` "Impervious Shell", **1 Standard-legal ABILITY printing**:

      "Prevent all damage done to this Pokémon by attacks from your opponent's
       Pokémon if that damage is 200 or more."

    ⚠️ **A FUNCTION AND NOT AN INLINE COMPARISON, EVEN THOUGH IT IS ONE OPERATOR.**
    The four damage sites must agree on TWO things a `>=` written out four times
    would let them drift on: that the threshold is INCLUSIVE, and that an ABSENT
    threshold shields nothing. `preventsAttackerType`'s empty-list guard is the same
    line of defence one axis over, and D240's whole argument for threading the
    amount into `attackBlockOf` rather than answering it beside each call is this
    argument for the installed channel. One reading of one printed clause (D131).

    🛑 **WHICH NUMBER — SETTLED AT D240, RE-STATED HERE, NOT RE-DECIDED.** *"That
    damage"* is the damage that would ACTUALLY be placed: post-Weakness,
    post-Resistance, post-reduction, floored at 0. The sentence prints no
    parenthetical, so the reading comes from §8.5's step list, where prevention and
    reduction share ONE step. The evidence against is on record beside
    `attackBlockOf` (two simultaneous final modifiers are player-ordered in the
    paper game). Every call site passes D240's own `wouldDeal` binding, so the two
    channels — the INSTALLED cap and this catalog AURA — read the identical number
    by construction rather than by agreement, which is the point of hoisting it.
    ⚠️ **AND THE COMPARATOR IS `>=`, NOT `>`** — the print says *"200 or more"*, so
    an exactly-200 hit IS prevented. That boundary is a driven case and a mutant.

    ⚠️ It takes the NUMBER and the THRESHOLD and nothing else — no `state`, no
    `Card`, no `InPlayPokemon`. It is in this file rather than `cards.ts` for the
    reason that classification rule actually says: `cards.ts` is where a pure CARD
    read goes, and this is not a card read at all. It sits beside the fold that
    produces its first argument. */
export function preventedByDamageThreshold(threshold: number | undefined, damage: number): boolean {
  return threshold !== undefined && damage >= threshold;
}

/** §8.5 (D258) — **THE COIN-FLIP SHIELD, AND THE FIRST FUNNEL THIS PREVENTION FAMILY
    HAS EVER HAD.** Does a *"If … damaged by an attack, flip a coin. If heads, prevent
    that damage."* aura on `pokemon` stop `damage`? Returns the answer AND the
    advanced `rngState`, and pushes one `ABILITY_COIN_FLIP` row per coin drawn.

    🛑 **IT IS A FUNNEL AND NOT FOUR DISJUNCTS, WHICH IS THE OPPOSITE OF WHAT D257 —
    ONE SLICE EARLIER, IN THIS EXACT SPOT — COULD DO.** A pure gate can be a term in
    an `||` chain at four sites and cost four lines; a gate that CONSUMES RNG cannot,
    because the four sites would then have to agree, in four places, on when a coin is
    drawn, how many are drawn, what the event says and where the advanced state goes.
    Four readers of one rule is this repo's standing hazard (D131), and here it is not
    a drift risk but a determinism bug: a replay that draws a different NUMBER of
    coins diverges on every shuffle afterwards, not just on this prevention.

    🛑 **`damage` IS THE PRINTED ANTECEDENT, NOT A PERFORMANCE GUARD.** *"If any damage
    is done to this Pokémon by attacks"* / *"and is damaged by an attack"* — a body
    whose damage is already 0 is not damaged, so NO coin is drawn. Callers pass 0 when
    a sibling aura, a Stadium, a bench shield or `ignoreWR`/`suppressTargetEffects`
    has already settled it, which collapses every "don't flip" reason into one number
    and is why this takes an amount rather than three booleans. ⚠️ That also fixes the
    ORDER: this is the LAST term of every site's prevention, because a coin drawn for
    damage something else already stopped is a coin the printed rules never draw.

    ⚠️ **ONE COIN PER ENTRY, IN ORDER, AND ALL OF THEM EVEN AFTER A HEADS.** Two
    shields on one body are two printed *"flip a coin"* instructions with the same
    antecedent, so both fire; the damage is prevented if ANY came up heads. Unreachable
    today and declared in the corpus (`D258-flip-first-only`) rather than faked.

    ⚠️ **`seat` IS PASSED, NOT DERIVED.** It is the seat that OWNS the damaged body —
    `ABILITY_COIN_FLIP`'s contract — and all four sites already hold it (`defenderSeat`
    at the main hit, `opponent` at the three interpreter arms), so deriving it here by
    scanning both boards for the uid would be a second answer to a question the caller
    cannot get wrong. A body with no top card cannot be damaged and draws nothing.

    ⚠️ **NO NEW EVENT AND NO `MATCH_RECORD_VERSION` MOVE.** `ABILITY_COIN_FLIP` has
    existed since Glimmora's on-KO flip (flow.ts) with exactly this shape — seat, uid,
    ability, face — and `rngState` has been a persisted `GameState` field since M1. The
    record's SHAPE is untouched, which is D146's no-bump case and not D239's retype;
    `expertHider.test.ts` drives it as a REPLAY rather than asserting it in prose.

    ⚠️ THIS IS THE ONLY FUNCTION IN THIS FILE THAT WRITES EVENTS, and it is here
    because it is where its own first argument comes from and because attack.ts and
    interpreter.ts cannot import each other (attack.ts imports the interpreter). It is
    NOT part of `passivesOf`, which must stay a pure aggregation — the split is the
    same one `statusRecovery` describes: the fold reports, the caller acts. */
export function coinFlipShieldPrevents(
  state: GameState,
  pokemon: InPlayPokemon,
  seat: Seat,
  damage: number,
  events: GameEvent[],
): [prevented: boolean, rngState: number] {
  if (damage <= 0) return [false, state.rngState];
  const uid = topUid(pokemon);
  if (uid === undefined) return [false, state.rngState];
  const shields = passivesOf(state, pokemon).preventDamageOnCoinFlip;
  let rngState = state.rngState;
  let prevented = false;
  for (const shield of shields) {
    const [face, next] = flipCoin(rngState);
    rngState = next;
    events.push({ type: "ABILITY_COIN_FLIP", seat, uid, ability: shield.ability, result: face });
    if (face === "heads") prevented = true;
  }
  return [prevented, rngState];
}

/** §8.5/§11 (D252) — does the ATTACKING body have any Special Energy attached? The
    resolution half of `passivesOf`'s `preventDamageAndEffectsFromSpecialEnergy`,
    and `preventsAttackerType`'s sibling one function up: same split (the gate is a
    fact about the attacker, so it can only be answered where the attacker is
    known), different SUBJECT.

    ⚠️ **IT TAKES AN `InPlayPokemon` AND NOT A `Card`, WHICH IS THE ONE THING THAT
    MAKES IT DIFFERENT FROM EVERY OTHER MEMBER OF THIS FAMILY.** `isExOrV` parses a
    name, `preventsAttackerType` reads `Card.types`, `hasPrintedAbility` (D251)
    reads `Card.abilities` — three CARD reads answerable off the catalog row alone.
    "have any Special Energy attached" is answerable only off the BOARD, so this one
    needs `state` and the body. That is also why it lives in this file and not in
    `cards.ts` beside its three siblings: `cards.ts` deliberately knows nothing
    about `GameState`.

    The membership question is delegated to `hasAttachedEnergy(state, pokemon,
    "special")` rather than restated, so "has any Special Energy attached" here is
    the SAME predicate that answers D118's printed "If this Pokémon has any Special
    Energy attached" clause and the same one `countEnergyInPlay` counts — one
    reading of one printed noun, per D131. In particular an Energy the engine has
    not authored a program for is still SPECIAL if its catalog row says so
    (`isSpecialEnergy` is a card-class read, not a registry read), so the gate does
    not quietly narrow to the Special Energy this build happens to implement.

    `undefined` (no resolvable attacking body) is FALSE — `preventsAttackerType`'s
    conservative direction verbatim: an unreadable attacker protects LESS rather
    than more. Structurally unreachable for a declared attack and answered anyway,
    because these reads must be TOTAL rather than case-covering. */
export function attackerHasSpecialEnergy(
  state: GameState,
  attacker: InPlayPokemon | undefined,
): boolean {
  return attacker !== undefined && hasAttachedEnergy(state, attacker, "special");
}

/** §2.2 (D253) — is `pokemon` standing on a BENCH right now? The HOLDER-ZONE
    predicate behind Poltchageist `sv06-020`/`-171` and Sinistcha `sv10-048`'s
    *"As long as this Pokémon is on your Bench, …"*, and the engine's first read of
    a body's SPOT that is not already holding the spot.

    ⚠️ **SEAT-BLIND ON PURPOSE, AND THE PRINTED WORD "YOUR" IS WHY IT COSTS
    NOTHING.** The clause says "your Bench" from the holder's own point of view, so
    the only bench a body can be on is its OWN side's — a Pokémon is never on the
    opponent's bench. Scanning BOTH sides is therefore not a widening, it is how
    the seat gets DERIVED without any caller passing one, which is
    `benchShieldedFromDamage`'s answer verbatim (D159) and the single reason
    `passivesOf` needed no signature change to fold the gate.

    Identity is TOP UID, the same key every member of the aura-scan family uses:
    `InPlayPokemon` is rebuilt by value on every damage step, so `===` would answer
    FALSE for the very body the caller just handed us one line after it took a hit.
    A body with no top uid is not on a bench for our purposes — the conservative
    direction, protecting LESS rather than more, exactly like
    `attackerHasSpecialEnergy`'s `undefined`.

    ⚠️ NOT a §9 gate and deliberately so: this answers WHERE a body is, which no
    Ability-lock can change. The §9 answer for the printings that consult it is
    made once, upstream, by `passivesOf`'s `disabled` drop on `sources[0]` — so a
    locked Poltchageist is still ON the bench and simply contributes no passive. */
export function isOnBench(state: GameState, pokemon: InPlayPokemon): boolean {
  const uid = topUid(pokemon);
  if (uid === undefined) return false;
  return SEATS.some((seat) => state.players[seat].bench.some((benched) => topUid(benched) === uid));
}

/** §11/§15.B — the LIVE attack-installed block on `pokemon`, or null. The ONE
    read of `InPlayPokemon.attackBlock`, and the whole of what "during your
    opponent's next turn" means at a read site: the field holds a turn STAMP, so
    the block is live iff that stamp is the turn now being played, and a block
    whose window has passed simply stops answering without anyone having cleared
    it (D124's rule; types.ts `AttackBlock` says why the D112 paralysis clock is
    the wrong clock for this direction).

    It lives HERE, in the aura-scan family, for the reason the module header
    gives: `attack.ts`'s §8.5 main hit, three interpreter damage sites and every
    defender-relative effect op must ask the same question of the same code or
    they drift — and `passivesOf`'s `preventDamageFromExV` (Mimikyu "Safeguard"),
    the UNDURATED aura this is the durated twin of, is read at exactly those
    sites. The difference between the two is worth stating: Safeguard is a printed
    ABILITY on the holder's card, so it is read out of the CATALOG and is gated on
    the ATTACKER's rule box; this is an INSTALLATION written onto the board, so it
    is read out of STATE and is gated on the TURN.

    ⚠️ IT DOES NOT ANSWER "is this effect an ATTACK's?" — that fact belongs to the
    INVOCATION, not to the target, and it rides `EffectContext.invokedBy`
    (interpreter.ts). Every call site pairs the two, because a block that stopped
    an Ability or a Trainer would refuse Crushing Hammer and Boss's Orders on a
    board where the printed sentence says nothing at all. The turn stamp already
    kills the largest class of false positives on its own — a block is live only
    during the holder's OPPONENT's turn, so nothing the HOLDER does can ever be
    refused by it — but a Trainer the opponent plays on that same turn lands
    squarely inside the window, which is why the provenance check is real work
    rather than a belt to the stamp's braces.

    ⚠️ `attacker` IS REQUIRED RATHER THAN OPTIONAL, AND THAT IS THE WHOLE OF
    D146's STRUCTURAL CONTRIBUTION. `AttackBlock.fromClass` narrows a block to
    attacks "from Basic Pokémon", and the class is a fact about the ATTACKER, so
    the filter can only be resolved where the attacker is known — i.e. at the read
    sites, exactly as `passivesOf`'s `preventDamageFromExV` is resolved at the
    same four sites by `isExOrV(attacker)`. Folding it INTO this function rather
    than beside it is what keeps "the ONE read of `InPlayPokemon.attackBlock`"
    true: a read site cannot honour the turn stamp and forget the filter, because
    there is no way to ask the first question without answering the second. A
    parameter that is REQUIRED but nullable is the enforcement — a new site must
    produce an attacker or say `undefined` on purpose.

    `undefined` (no resolvable attacking card — structurally impossible for a
    declared attack, since attacks come from the Active) FAILS a filtered block
    and passes an unfiltered one. That is the conservative direction on both: an
    unfiltered block is the pre-D146 behaviour byte for byte, and a filtered block
    whose class cannot be checked protects LESS rather than more, which is the
    polarity `effects` was chosen under (types.ts `AttackBlock`).

    ⚠️ `damage` IS THE FOURTH PARAMETER AND IT IS D240's WHOLE STRUCTURAL CHOICE,
    TAKEN THE SAME WAY D146 TOOK THE THIRD. `AttackBlock.maxDamage` narrows a block
    to attacks "if that damage is 40 or less", and the amount is a fact about the
    ATTACK rather than about the block, so — exactly like the class — it can only
    be resolved at the read sites. It is folded INTO this function rather than
    answered beside it for D146's reason word for word: that is what keeps "the ONE
    read of `InPlayPokemon.attackBlock`" true, because a site cannot ask about the
    turn stamp without also answering the class AND the cap. The alternative
    considered and rejected was a second exported predicate over the returned
    record; it would have let a fifth site honour the stamp and forget the cap,
    which is the drift the single-read contract exists to stop. REQUIRED but
    nullable, again as the enforcement — a new site must produce a number or say
    `undefined` on purpose.

    🛑 WHICH NUMBER, AND THE ANSWER IS "THE ONE THAT WOULD ACTUALLY BE PLACED".
    The printed sentence carries NO parenthetical — unlike `damageReduction`'s
    "(after applying Weakness and Resistance)", which is why D147 never had to
    argue this — so the reading comes from §8.5's own step list
    (`docs/reference/ptcg-rules.md`): base (+pre-W/R modifiers) → ×Weakness →
    −Resistance → **± final modifiers, and that ONE step is where damage reduction,
    "prevent all damage" and every other final modifier all live together**. A cap
    is a condition on the damage the attack is doing, and at the moment the
    prevention is applied the damage being done is the post-W/R total minus every
    reduction, floored at 0. So the callers pass `Math.max(0, afterWR - reduction)`
    — the number one line later becomes `dealt` — and NOT the base and NOT the
    bare post-W/R figure.
    ⚠️ THIS IS AN EXPLICITLY FLAGGED READING, NOT A CITED RULING. The evidence FOR:
    the rules doc puts prevention and reduction in one step, the three §8.5 sites
    already SUM `damageReductionOf` with `passivesOf` before this question is
    asked, and "that damage" most naturally names the damage about to be placed.
    The evidence AGAINST: real-world ordering between two simultaneous final
    modifiers is chosen by the affected player, so a board with a 60-damage attack,
    a −30 reduction and a 40-cap is observably different under the other order
    (0 here, 30 there) and no printed text settles it. It is pinned by a named test
    so that a future ruling moves ONE line and fails ONE assertion.

    `undefined` (no readable amount — the `attackEffectRefused` path, where the
    question is an EFFECT and there is no damage for the cap to be about) FAILS a
    capped block and passes an uncapped one. Conservative on both, and the same
    polarity as the class arm: a block whose cap cannot be checked protects LESS
    rather than more. ⚠️ Note the direction is the opposite one from the DERIVER's,
    where an unreadable cap must refuse to derive at all — a DROPPED cap key would
    install a strictly WIDER block than the card prints. Same field, two failure
    directions, because a missing key and a missing number are different facts. */
export function attackBlockOf(
  state: GameState,
  pokemon: InPlayPokemon,
  attacker: Card | undefined,
  damage: number | undefined,
): AttackBlock | null {
  // No defensive `=== undefined` arm: the field is REQUIRED, and a record
  // written before it existed is retired by MATCH_RECORD_VERSION rather than
  // read benignly here — which is the whole reason that constant was bumped
  // (D124's rule, and its argument against exactly this kind of soft landing).
  const block = pokemon.attackBlock;
  if (block === null || block.turn !== state.turn) return null;
  // D240 — the CAP, checked before the class for no reason but reading order:
  // the two narrowings are independent conjuncts and no printing carries both.
  // `<=` is the printed "or less", inclusive: a 40-cap refuses a 40 and lets a 41
  // through. An ABSENT key is no cap at all, which is what every record persisted
  // before this field existed already meant.
  if (block.maxDamage !== undefined && !(damage !== undefined && damage <= block.maxDamage)) {
    return null;
  }
  // The unfiltered reading — every printing D142 mapped, and the ABSENT key that
  // makes an older persisted block read back as exactly what it used to mean.
  if (block.fromClass === undefined) return block;
  return attacker !== undefined && attackerMatchesClass(attacker, block.fromClass) ? block : null;
}

/** Does `attacker` belong to the printed CLASS a filtered block names? The whole
    of D146's predicate, widened at D239 to the printed *"non-{X}"* exclusion —
    and still ONE spelling of each printed conjunct, which is the reason
    `AttackerClass` is a record (effects.ts carries the argument).

    THE STAGE WORD STAYS AN EXHAUSTIVE `switch` over a one-member union rather
    than an `if`: `AttackerClass["stage"]` is the closed vocabulary D120 requires
    of a token that varies, and this switch is what makes "closed" a compiler fact
    instead of a comment — widen it and tsc demands the arm that reads the new
    member. `basic` is `isBasicPokemon` VERBATIM (cards.ts), the same reuse D107's
    `isExOrV` is under at the sites beside this one: the printed phrase "attacks
    from Basic Pokémon" is the same claim the setup placement and the bench play
    make about a card in hand, and a second reading of "Basic" would be a second
    chance to disagree with §3.6/§5.2 about what one is. Note it is read off the
    ATTACKER's TOP card (its current identity, §1.2) — a Basic that has evolved is
    a Stage 1 and its attacks are no longer refused, which is what the printed
    word means and is why the call sites pass a resolved top card rather than a
    stack.

    ⚠️ THE EXCLUSION IS `types.includes(…)` AND NOT `types[0] === …`, which is
    `matchesFilter`'s `typedPokemon` read one file over and the same reason: the
    catalog column is an ARRAY. No dual-type Pokémon is Standard-legal today
    (measured: zero rows with `json_array_length(types_json) > 1`), so the
    difference is unobservable off any printing and is driven by a declared
    SYNTHETIC probe instead — the `fix-attacker` "Fury" precedent. An equality
    read would drop a dual-typed body silently the day one is ingested.

    ⚠️ AND IT IS A NEGATION, SO ITS FAILURE DIRECTION IS THE DANGEROUS ONE: an
    exclusion that stopped answering makes the block WIDER than the card prints
    (Terapagos ex would start refusing the Colorless Basics its own sentence lets
    through), where every other conservative default in this family protects LESS.
    That is why an unresolvable code refuses to derive at all rather than dropping
    the key (effects.ts arm 19c). */
function attackerMatchesClass(attacker: Card, cls: NonNullable<AttackBlock["fromClass"]>): boolean {
  if (!attackerMatchesStage(attacker, cls.stage)) return false;
  return cls.excludingType === undefined || !(attacker.types ?? []).includes(cls.excludingType);
}

/** The stage conjunct alone, split out so the `switch` can be the whole BODY of a
    `boolean` function: that is what makes exhaustiveness a compiler fact (a new
    `stage` member leaves the function with a code path returning `undefined`).
    Folded inline it would merely fall out of the switch and answer `true`, which
    is the silent-widening failure this family must not have. */
function attackerMatchesStage(attacker: Card, stage: AttackerClass["stage"]): boolean {
  switch (stage) {
    case "basic":
      return isBasicPokemon(attacker);
  }
}

/** §8.5/§11 (D147) — the HP an attack-installed DAMAGE REDUCTION takes off any
    attack damage aimed at `pokemon` right now, or 0. The ONE read of
    `InPlayPokemon.damageReduction`, and `attackBlockOf`'s sibling in the one
    respect that matters: the field holds a turn STAMP, so the reduction is live
    iff that stamp is the turn now being played, and a reduction whose window has
    passed simply stops answering without anyone having cleared it.

    ⚠️ IT RETURNS A NUMBER TO BE SUMMED, NOT A RECORD TO BE INSPECTED, and that
    is the whole shape of the slice. The printed sentence —

      "During your opponent's next turn, this Pokémon takes {N} less damage from
       attacks (after applying Weakness and Resistance)."

    — is byte-identical to a sentence FOUR printings already print as an always-on
    Ability, minus the four-word duration prefix: Bouffalant sv03-174 "Bouffer"
    (20), Stonjourner sv01-121 "Exoskeleton" (20) and Copperajah ex sv02-150/-245
    "Bronze Body" (30), all simulated since 0.x as
    `PassiveEffects.damageReductionAfterWR` and aggregated by `passivesOf` one
    function up. So the four damage sites ADD this to that number rather than
    consulting a second channel: same step of §8.5, same clamp, same
    `ignoreWR` bypass. One reading, one implementation (D131), read across the
    catalog/state boundary rather than within one side of it.

    ⚠️ IT IS NOT FOLDED INTO `passivesOf`, and the two reasons are structural.
    That function is the CATALOG scan — a printed passive plus attached Tools —
    which is exactly the aura/installation distinction `attackBlockOf`'s doc block
    draws one function down; and it SUPPRESSES a holder's own printed passive
    under a §9 Ability-lock aura, which an attack-installed effect must be immune
    to, because an installation is not an Ability. Summing at the sites keeps that
    immunity a property of where the number comes from rather than of where the
    suppression happens to be written.

    IT NEEDS NO PROVENANCE CHANNEL, for D143's generalisation rather than by
    accident: a durated effect owes an `EffectContext.invokedBy` only when it
    gates an OP that a Trainer or an Ability could also reach. This one is summed
    into a number that the ALWAYS-ON printings already contribute to at the same
    four sites with no such check — so adding one here would make the SAME printed
    words mean two different things depending on whether they carry a duration.
    (Checked rather than assumed: all three interpreter damage sites are
    attack-only in this pool. `spreadDamage`, `snipeActive` and `placeSnipe`'s
    `deals` arm have no Ability producer — every registry `damageChosen` is
    `opponentBench` without `deals`, and `damageActive` places flat counters that
    no reduction touches at all.) */
export function installedReductionOf(state: GameState, pokemon: InPlayPokemon): number {
  // No defensive `=== undefined` arm, for `attackBlockOf`'s reason above: the
  // field is REQUIRED and a record written before it existed is retired by
  // MATCH_RECORD_VERSION rather than read benignly here (D124's rule).
  const installed = pokemon.damageReduction;
  return installed === null || installed.turn !== state.turn ? 0 : installed.amount;
}

/** 🆕🆕 §8.5/§11 (D432) — does `pokemon` currently carry an attack-installed
    *"During your opponent's next turn, this Pokémon has no Weakness."* bar? The
    ONE read of `InPlayPokemon.noWeaknessTurn`, and `installedReductionOf`'s
    sibling in the one respect that matters: the field holds a turn STAMP, so the
    bar is live iff that stamp is the turn now being played, and a bar whose window
    has passed simply stops answering without anyone having cleared it (D124's
    rule).

    ⚠️ **IT IS THE THIRD WEAKNESS-NULLING SHAPE AND IT SHARES NEITHER STORE WITH
    THE OTHER TWO.** The two Weakness read sites (attack.ts's main hit,
    interpreter.ts's `snipeActive`) already carried two null paths before this one:

    | | store | scope | clock |
    |---|---|---|---|
    | `AttackDamageSuppression.weakness` (D192) | a PARSE of the declared attack | the attacker's own sentence | one declaration |
    | `seatRemovesWeakness` (D161) | a CATALOG fold over a seat's bodies | seat-wide, either zone | none — an aura |
    | this (D432) | a STAMP on one `InPlayPokemon` | that one body | one turn |

    This repo's standing rule is *the read site is shared, the storage is not*, and
    here the third store is forced twice over rather than chosen. Widening D192's
    boolean is impossible: it is derived from the sentence the ATTACKER declared
    this instant and is discarded when the attack ends, so it has nowhere to keep a
    turn and no body to keep it on. Widening the AURA is worse than impossible — it
    is a §9 category error: `seatRemovesWeakness` folds printed Abilities and is
    switched OFF by an Ability-lock (Ting-Lu ex "Cursed Land"), while an
    attack-INSTALLED effect must be immune to that suppression, which is D147's own
    structural reason for keeping `installedReductionOf` out of `passivesOf`.

    Cheap on the common path: one field read and one integer compare, no scan. */
export function installedNoWeakness(state: GameState, pokemon: InPlayPokemon): boolean {
  // No defensive `=== undefined` arm, for `installedReductionOf`'s reason above:
  // the field is REQUIRED and a record written before it existed is retired by
  // MATCH_RECORD_VERSION (26 -> 27 at D432) rather than read benignly here.
  return pokemon.noWeaknessTurn === state.turn;
}

/** §8.5/§11 (D149) — the HP an attack-installed ATTACK-DAMAGE DEBUFF takes off
    every damage `pokemon`'s own attack does right now, or 0. The ONE read of
    `InPlayPokemon.attackDamageDebuff`, and `installedReductionOf`'s MIRROR ON
    BOTH AXES AT ONCE — which is the whole shape of the slice:

    | | `installedReductionOf` (D147) | this (D149) |
    |---|---|---|
    | Installed on | the ATTACKER's own Active | the DEFENDER's Active |
    | Asked about  | the body TAKING damage    | the body DEALING it   |
    | Where in §8.5| AFTER Weakness/Resistance | BEFORE them           |
    | Printed word | "(after applying …)"      | "(before applying …)" |

    Everything else is identical, deliberately: the field holds a turn STAMP, so
    the debuff is live iff that stamp is the turn now being played, and one whose
    window has passed simply stops answering without anyone having cleared it
    (D124's rule).

    ⚠️ IT IS SUBTRACTED BESIDE `attackerPreWRBonus`, NOT FOLDED INTO IT, and the
    reasons are the ones types.ts `AttackDamageDebuff` sets out: the bonus is a
    REPORTED positive field, that function is `passivesOf`'s §9-suppressible
    CATALOG fold, and only the debuff can drive the pre-W/R subtotal negative. So
    the read sites spell `preWR = max(0, base + bonus − debuff)` and report the
    two numbers in two fields of the same `DAMAGE_DEALT` row.

    ⚠️ IT IS KEPT OUT OF `passivesOf` FOR `installedReductionOf`'s TWO REASONS
    VERBATIM: that function is the CATALOG scan (printed passives + attached
    Tools), which is the aura/installation distinction `attackBlockOf`'s doc block
    draws; and it SUPPRESSES a holder's own printed passive under a §9
    Ability-lock aura, which an attack INSTALLATION must be immune to. Reading it
    here keeps that immunity a property of where the number comes from.

    IT LEAVES ROOM FOR THE ALWAYS-ON MEMBER RATHER THAN CLOSING OVER IT. The pool
    prints one Ability on this exact mechanism — Entei sv03-030 "Pressure": "As
    long as this Pokémon is in the Active Spot, attacks used by your opponent's
    Active Pokémon do 20 less damage (before applying Weakness and Resistance)."
    — and it is deliberately NOT this slice, because it is a CROSS-BOARD aura with
    an Active clause on BOTH ends (`opposingRetreatBlocked`'s shape, one screen
    up), not a stamp. When it lands it becomes a sibling scan summed beside this
    call at the same four sites, exactly as `passivesOf`'s catalog half is summed
    beside `installedReductionOf`. Nothing here has to move for that.

    IT NEEDS NO PROVENANCE CHANNEL, for `installedReductionOf`'s reason: the
    number is subtracted at damage sites that are attack-only in this pool (D147
    checked all three interpreter ones and the finding is unchanged), and the
    always-on printing of the same sentence would contribute at the same sites
    with no such check. */
export function installedAttackDebuffOf(state: GameState, pokemon: InPlayPokemon): number {
  // No defensive `=== undefined` arm, for `attackBlockOf`'s reason above: the
  // field is REQUIRED and a record written before it existed is retired by
  // MATCH_RECORD_VERSION rather than read benignly here (D124's rule).
  const installed = pokemon.attackDamageDebuff;
  return installed === null || installed.turn !== state.turn ? 0 : installed.amount;
}

/** §9/§11 (D152) — the HP an attack-installed REACTIVE RECOIL puts on whatever
    damages `pokemon` right now, or 0. The ONE read of
    `InPlayPokemon.installedRecoil`, and `installedReductionOf`'s SIBLING on every
    axis but the read SITE:

    | | `installedReductionOf` (D147) | this (D152) |
    |---|---|---|
    | Installed on | the installer's own Active | the installer's own Active |
    | Window       | `state.turn + 1`           | `state.turn + 1`            |
    | Read at      | §8.5 step 5, SUBTRACTED    | §9 recoil, ADDED            |
    | Catalog twin | `damageReductionAfterWR`   | `damageAttacker`            |

    Everything else is identical, deliberately: the field holds a turn STAMP, so
    the recoil is armed iff that stamp is the turn now being played, and one whose
    window has passed simply stops answering without anyone having cleared it
    (D124's rule).

    🆕🆕 **D456 — IT TAKES `damageTaken`, THE HIT THAT IS TRIGGERING IT.** Corpus line
    180 (*"…put damage counters on the Attacking Pokémon equal to the damage done to
    this Pokémon."*, **2 legal printings**) declines to print its amount, so the
    number is the §8.5 figure of the hit currently landing on `pokemon`. Both call
    sites already have it as a local named `dealt` — `attack.ts`'s §9 block gates on
    `dealt > 0` two lines above the call, and `interpreter.ts`'s `reactToAttackDamage`
    is only reached from a `dealt > 0` arm — so **NOTHING IS RECORDED AND NOTHING IS
    CARRIED**. D451 refused this sentence on the ground that its quantity *"is a
    HISTORY of what happened during the opponent's turn — it needs a durated watcher
    and a recorded figure, neither of which this op has"*. That refusal was exact
    about `counterUntilRemainingHp` and does not survive at THIS address: the durated
    watcher is `InstalledRecoil` and has existed since D152, and the figure never
    becomes a history because the read happens in the same expression that computes
    it. **The parameter is REQUIRED rather than optional for D425's reason** — an
    optional one would let a third call site forget it and silently retaliate for the
    floor.

    ⚠️ IT RETURNS A NUMBER TO BE SUMMED, NOT A RECORD TO BE INSPECTED, and the
    number it is summed into is one FOUR always-on printings already feed. Cacnea
    sv01-005 / Cacturne sv01-006 "Counterattack Quills" (3 counters), Stunfisk
    sv03-112 "Custom Trap" (5, `requiresTool`) and Rocky Helmet sv01-193 (2, a
    TOOL) print this mechanism with the four-word duration prefix removed and the
    "if this Pokémon is damaged" clause spelled as an Active-Spot condition; all
    four are `PassiveEffects.damageAttacker`, folded by `passivesOf`. So attack.ts
    ADDS this to that fold rather than consulting a second channel: same site, same
    `dealt > 0` gate, same `"counterattack"` label, ONE event.

    ⚠️ IT IS NOT FOLDED INTO `passivesOf`, for `installedReductionOf`'s TWO
    STRUCTURAL REASONS VERBATIM. That function is the CATALOG scan — a printed
    passive plus attached Tools — which is the aura/installation distinction
    `attackBlockOf`'s doc block draws; and it SUPPRESSES a holder's own printed
    passive under a §9 Ability-lock aura, which an attack-installed effect must be
    immune to, because an installation is not an Ability. Summing at the site keeps
    that immunity a property of where the number comes from. ⚠️ AND HERE THAT
    IMMUNITY IS SHARPER THAN ANYWHERE ELSE IN THE FAMILY, because the fold it is
    summed with is the ONE `passivesOf` member a lock can zero while leaving a Tool
    behind: a locked Lycanroc ex wearing Rocky Helmet still retaliates for the
    installed 100 plus the Tool's 20, and only a printed Ability's share is lost.

    IT NEEDS NO PROVENANCE CHANNEL, for `installedReductionOf`'s reason: the number
    is summed at a site the ALWAYS-ON printings already contribute to with no such
    check, so adding one would make the SAME printed words mean two different
    things depending on whether they carry a duration. (Checked rather than
    assumed: the §9 recoil site is in `attack.ts` and is reached only by an attack
    — no Ability or Trainer path damages an Active through it.) */
export function installedRecoilOf(
  state: GameState,
  pokemon: InPlayPokemon,
  damageTaken: number,
): number {
  // No defensive `=== undefined` arm, for `attackBlockOf`'s reason above: the
  // field is REQUIRED and a record written before it existed is retired by
  // MATCH_RECORD_VERSION rather than read benignly here (D124's rule).
  const installed = pokemon.installedRecoil;
  if (installed === null || installed.turn !== state.turn) return 0;
  // 🆕🆕 D456 — the UNPRINTED amount, resolved here and nowhere else. `Math.max` and
  // not a bare `damageTaken`: `amount` is the record's FLOOR, so a body carrying both
  // printings in one window never retaliates for less than the flat one promised —
  // which is `installRecoil`'s own `Math.max` merge rule stated at the read end. A
  // record installed by line 180 alone carries floor 0, so the max is the hit.
  return installed.ofDamageTaken === true
    ? Math.max(installed.amount, damageTaken)
    : installed.amount;
}

/** §8/§11 (D143) — is `pokemon` under an attack-installed SELF-LOCK right now
    ("During your next turn, this Pokémon can't attack.")? The ONE read of
    `InPlayPokemon.attackLockedTurn`, and `attackBlockOf`'s sibling in every
    respect that matters: the field holds a turn STAMP, so the lock is live iff
    that stamp is the turn now being played, and a lock whose window has passed
    stops answering without anyone having cleared it.

    ⚠️ IT IS THE OTHER HALF OF THE PAIR, NOT A COPY. `attackBlockOf` answers a
    question about what may be done TO the holder during the OPPONENT's turn
    (stamp N + 1); this answers what the holder may do ITSELF during its OWN next
    turn (stamp N + 2). The two stamps are different numbers written by different
    ops on the same body, which is exactly why they are two fields (types.ts).

    IT NEEDS NO PROVENANCE CHANNEL, which is the sharpest structural difference
    from D142. That block had to ask `EffectContext.invokedBy` because "effects of
    ATTACKS" is a claim about what INVOKED the effect and the target cannot answer
    it. This one is read from `attack.ts`'s §8 gate and from the HUD's payability
    projection — both of which are, by construction, about declaring an ATTACK —
    so there is exactly one kind of thing it can refuse and nothing to disambiguate.

    Returns a plain boolean rather than the stamp: there is one fact here and no
    `effects`-shaped rider to carry, so a record would be a field-of-one (D104's
    minimal shape).

    ⚠️ AND THE SECOND READING LANDED WITHOUT MOVING THIS FUNCTION AT ALL (D148).
    D143 forecast it here: "a second reading — the pool prints an opponent-side
    'the Defending Pokémon can't attack' on 4 printings — would earn the OP a
    `target` field, not this reader a return type". That is exactly what happened.
    The field went on `preventAttack`, the stamp is derived from it at the install
    site, and every read of the fact — this function, `attack.ts`'s §8 gate,
    `redactedAttacksOf` and GameHud — is byte-identical to what it was at 0.92.0,
    because the QUESTION ("may this body attack on this turn?") never depended on
    who wrote the answer. A reader that had carried the direction would have had to
    ask a second one here, on both sides of the table, forever. */
export function attackLocked(state: GameState, pokemon: InPlayPokemon): boolean {
  // No defensive `=== undefined` arm, for `attackBlockOf`'s reason one function
  // up: the field is REQUIRED and an older record is retired by
  // MATCH_RECORD_VERSION rather than read benignly here.
  return pokemon.attackLockedTurn === state.turn;
}

/** §11 (D412) — is `pokemon` held in place right now by an ATTACK EFFECT, from
    either direction? `attackLocked`'s twin one function up, and the ONE reader of
    a fact that lives in two fields.

    🛑 TWO FIELDS AND ONE QUESTION, WHICH IS EXACTLY WHY THIS FUNCTION EXISTS. The
    imposed lock (`retreatBlocked`, opponent-side, D112's paralysis clock) and the
    self-installed one (`retreatLockedTurn`, D412's stamp) answer the same question
    — *may this body retreat?* — and NOTHING about a call site distinguishes them:
    the §11 gate in turn.ts and `redactedRetreatOf` in redact.ts each want the
    disjunction and neither wants to know which half said yes. Spelled inline at
    both sites they would be two hand-written disjunctions over the same pair, and
    the day a THIRD source of the fact arrives one of them silently keeps answering
    the old question — D222's defect verbatim, whose recorded remedy is *route them
    through the one helper instead*.

    ⚠️ THE TWO HALVES ARE NOT REDUNDANT AND ONE CANNOT SUBSUME THE OTHER: they
    carry DIFFERENT CLOCKS on purpose. `retreatBlocked` is cleared at the Checkup
    that ends the blocked player's turn, which is the right lifetime for a window
    on somebody ELSE's turn and the wrong one for a window on your own; the stamp
    expires by arithmetic, which is the only shape that survives an attack ending
    the installer's own turn. Both can be live on one body at once — the opponent
    locked you last turn and your own attack locked you for next turn — and the
    disjunction is what makes that board answer correctly.

    NOT folded into `effectiveRetreatCost`: a block is not a cost, which is
    `opposingRetreatBlocked`'s rule one file over and is why the retreat gate asks
    three separate questions rather than adding to one number. */
export function retreatLocked(state: GameState, pokemon: InPlayPokemon): boolean {
  return pokemon.retreatBlocked || pokemon.retreatLockedTurn === state.turn;
}

/** §4 (D277) — is `pokemon` FORBIDDEN from attacking right now by the first-turn
    ban? True on turn 1 unless the body's own printed Ability licenses it ("Debut
    Performance", Meloetta ex `sv10.5b-044`/`-159`/`-167`).

    🛑 **THE WHOLE POINT IS THAT THE EXPRESSION IS SPELLED ONCE.** `state.turn === 1`
    had THREE readers before this slice — `attack`'s §8 gate, `redactedAttacksOf`'s
    `banned` and GameHud's `firstTurnBan` — each a literal comparison, and a
    licence that reached two of them would have been a live bug in the third with
    no type error to announce it. This is `attackLocked`'s rule applied one line
    over: one question, one function, three call sites that cannot drift.

    ⚠️ **`state.turn === 1` AND NOT `isFirstTurnOf(state, seat)`, WHICH IS NOT THE
    SAME PREDICATE AND MUST NOT BE UNIFIED WITH IT.** §4 bans the going-FIRST
    player from attacking on their first turn ONLY; the going-second seat's first
    turn is turn 2 and is unrestricted. `isFirstTurnOf` is true on turn 2 for that
    seat, so calling it here would invent a ban the rules do not print. The
    §4 EVOLVE ban is the other way round (it binds both seats) and correctly uses
    `isFirstTurnOf` — two rules, two readers, and the fact that they share a
    section number is not a reason to share a predicate (D131 read forwards).

    ⚠️ TAKES NO SEAT. The ban is a fact about the TURN NUMBER and the licence a
    fact about the BODY, and `attack`'s turn gate has already proved the actor
    owns the turn — so there is nothing seat-relative left to ask, unlike
    `attackBarredByAbility` one file over whose condition needs one. */
export function firstTurnAttackBanned(
  state: GameState,
  pokemon: InPlayPokemon,
  index: number,
): boolean {
  if (state.turn !== 1) return false;
  // Through `passivesOf` rather than off `top` directly: the licence is a printed
  // ABILITY, so a §9 Ability-lock (Klefki `sv01-096`) must silence it and hand the
  // ban back. Reading the catalog row here would be shorter and would get that
  // wrong silently — `cantAttackUnless`'s rule, mirrored.
  if (passivesOf(state, pokemon).attackFirstTurnExempt) return false;
  // …and, since D281, the PER-INDEX licence the same §4 ban can carry ("If you go
  // first, you can use THIS ATTACK during your first turn." — Volbeat `sv06-009`,
  // Exeggcute `sv08-001`/`-192`).
  //
  // 🛑 **THE INDEX WIDENED THIS PREDICATE RATHER THAN GROWING A SECOND ONE BESIDE
  // IT, AND THE THREE PAYABILITY PROJECTIONS ARE THE WHOLE REASON.** This
  // function's own doc block above exists because `state.turn === 1` was a literal
  // at three sites and a licence reaching two of them would be a live bug in the
  // third. A per-index licence answered by a NEW reader would have re-created
  // exactly that: `attack.ts` would consult both, and the two projections would
  // each have to remember to. One question, one function — now with the address
  // the question is asked about.
  //
  // ⚠️ **AND IT IS READ OFF THE TOP CARD, NOT THROUGH `passivesOf`, WHICH IS THE
  // INVERSE OF THE LINE ABOVE.** §9 locks ABILITIES. The Meloetta ex licence one
  // line up is printed as an Ability and a Klefki must take it away; Volbeat's is
  // printed as ATTACK TEXT and no §9 lock in the game touches it. Two licences for
  // one ban, suppressible on different terms — driven under a live lock rather
  // than argued.
  return attackGateOf(state, pokemon, index)?.kind !== "firstTurnExempt";
}

/** §4/§8 (D281) — the printed TIMING clause `pokemon`'s stack-top card puts on
    the attack at `index`, or undefined when it prints none. The ONE read of
    `CardProgram.attackGate`, shared by `firstTurnAttackBanned` one function up
    (the `firstTurnExempt` arm) and `attackTimingBlocked` in interpreter.ts (the
    two condition arms) — `cantAttackUnless`'s split verbatim, and for its reason:
    the condition arms are SEAT-RELATIVE and this file has no seat.

    🛑 **OFF `topCardOf` AND DELIBERATELY NOT THROUGH `passivesOf`.** Every clause
    in this field is printed as ATTACK TEXT, and §9 Ability-locks silence
    ABILITIES — so a Klefki `sv01-096` must NOT hand Terapagos ex its barred
    "Unified Beatdown" back, and must NOT take Volbeat's licence away. That is the
    exact opposite of the rule `attackFirstTurnExempt` follows one field over in
    `PassiveEffects`, which is why it is stated here rather than inferred: the two
    fields answer the same §4 question and are suppressible on opposite terms.

    ⚠️ TOTAL AND INDEX-BLIND. A body with no registry row, no `attackGate`, or a
    gate at a different index gets `undefined` — the index is a plain record
    lookup, so a non-integer or out-of-range address simply prints no clause
    rather than throwing, and the §8 gate's own `BAD_ATTACK_INDEX` check still
    owns the complaint about a bogus address.

    🆕🆕 **D444 — `registry ?? derived`, AND THE ORDER IS `attack.ts`'s VERBATIM.**
    The registry row wins and the derivation is never asked (D8's precedence, spelled
    `authored ?? derived` at the `CardProgram.attack` seam); a body with no row falls
    through to `timingGateFromAttackText` over the printed effect text of the attack AT
    THIS INDEX. **Before this slice the second half was missing and the failure was
    SILENT**: a body printing Terapagos ex's clause byte for byte with no registry row
    could declare the attack on exactly the turn the card forbids it, because
    `attackGateOf` had only one producer and it was keyed by card id. Every other
    unread sentence in this engine fails LOUD; this one deleted a printed rule.

    🛑 **THE ADDRESS IS THE PRINTED TEXT AT `index`, WHICH IS WHY THE INDEX KEY IS
    STILL MEANINGFUL WITH NO ROW TO KEY OFF.** A derived gate has no registry entry,
    so the question "what is it keyed by" has to be answered from somewhere — and the
    answer is that `attacksOf(top)[index]` IS the key: the clause is read off the very
    attack it governs. That makes the leak this design invites unconstructible rather
    than merely untested. **Volbeat `sv06-009` is the board**: its idx 0 "Quick Sign"
    prints the licence and its idx 1 "Coordinated Strike" prints no effect text at all,
    so the derivation answers `undefined` at idx 1 by construction — a per-BODY read
    (`Object.values(...)[0]`, or a flag) is the defect D281 named and the derivation
    cannot express it. `derivedAttackGate.test.ts` §4 drives both indices on an
    UNREGISTERED twin of that card, where the registry cannot be masking the answer.

    ⚠️ **AND IT IS STILL READ OFF `topCardOf` AND NOT THROUGH `passivesOf`** — the
    §9 argument above is unchanged by the new producer, and is in fact stronger for
    it: the derivation reads printed ATTACK text, which no Ability-lock touches. */
export function attackGateOf(
  state: GameState,
  pokemon: InPlayPokemon,
  index: number,
): AttackTimingGate | undefined {
  const top = topCardOf(state, pokemon);
  if (top === undefined) return undefined;
  const authored = programFor(top.id)?.attackGate?.[index];
  return authored ?? timingGateFromAttackText(attacksOf(top)[index]?.effect);
}

/** §8/§11 (D154; PLURAL since D165) — WHICH of `pokemon`'s attacks are barred
    right now ("During your next turn, this Pokémon can't use {AttackName}." and
    its opponent-side twin), as indices into the stack-top card's `attacks`, in
    install order, EMPTY when none is. The ONE read of
    `InPlayPokemon.lockedAttacks`, and `attackLocked`'s sibling one function up in
    every respect except its return type: each entry holds a turn STAMP beside the
    address, so a bar is live iff that stamp is the turn now being played, and a
    bar whose window has passed stops answering without anyone having cleared it.

    🆕🆕 **D421 — …UNLESS THE ENTRY CARRIES `until: "leavesActive"`, IN WHICH CASE
    THERE IS NO WINDOW AND THE READER SAYS SO.** *"This Pokémon can't use Blaze
    Blitz again until it leaves the Active Spot."* (5 legal printings) is the first
    entry in this list whose duration is a BOARD EVENT rather than a number, and
    the whole of that reading lives in the two clauses of the filter below: the
    rider answers unconditionally, and everything without one keeps the turn
    comparison it has had since D154. **The bar is ended by the §10 clears and by
    nothing else** — which is why it costs no new clear site: all three literals
    already shed this list whole.

    ⚠️ IT RETURNS THE INDICES RATHER THAN A PREDICATE, AND THAT IS THE ONE PLACE
    THIS FAMILY'S READER SHAPE HAD TO MOVE. `attackLocked` returns a boolean
    because there is ONE fact and nothing to carry (D104's minimal shape); here the
    fact IS a set of addresses, and every caller has a candidate index in hand and
    wants to know whether it is among them. A `(state, pokemon, index) => boolean`
    signature would have been the other shape and is refused for one observable
    reason: `redactedAttacksOf` and GameHud both build their rows by mapping over
    the whole `attacks` array, so a per-index predicate would be called once per
    attack and re-read the same field N times, while the §8 gate would call it
    once — three sites, two access patterns, one field. One read of the set
    answers both.

    ⚠️ THE PLURAL IS D165's, AND IT IS THE ENUMERATING CALLER §D152/§D154/§D157
    FORECAST — ARRIVING FROM THE DIRECTION NONE OF THEM WATCHED. D152 retired the
    count trigger for the `attackBlock` union and replaced it with *a member the
    read site must DISPATCH on rather than SUM*, naming this record; D154 and D157
    each declined on the ground that no site ENUMERATES, every reader knowing
    which rider it wanted before it looked. That was true of the rider KINDS and
    is still true — nothing here dispatches, because every entry in this list
    means exactly one thing. What was NOT true, from D157's commit onward, is that
    one body could carry only one of them: the field has TWO writers whose stamps
    collide from adjacent turns (types.ts `InPlayPokemon.lockedAttacks`), so both
    payability projections must now mark EVERY barred row and neither knows in
    advance which. **A collection is earned by a MULTIPLICITY the read site must
    enumerate just as much as by a UNION it must dispatch on — and only the second
    of those was ever being watched for.** The `attackBlock` union stays declined.

    NO PROVENANCE CHANNEL, for `attackLocked`'s reason verbatim: it is read from
    `attack.ts`'s §8 gate and from the two payability projections, all of which are
    by construction about declaring an ATTACK, so there is exactly one kind of
    thing it can refuse and nothing to disambiguate. Which OP wrote an entry is
    likewise absent and stays absent — D157's answer at the address, unchanged by
    the list: the reader refuses the index whoever wrote it. */
export function lockedAttackIndexes(state: GameState, pokemon: InPlayPokemon): number[] {
  // No defensive `=== undefined` arm, for `attackBlockOf`'s reason two functions
  // up: the field is REQUIRED and a record written before it existed is retired
  // by MATCH_RECORD_VERSION rather than read benignly here (D124's rule).
  // 🆕🆕 D421 — …and the entry that has NO window answers on every turn. *"This
  // Pokémon can't use Blaze Blitz again until it leaves the Active Spot."* (5
  // legal printings, Gouging Fire ex) installs `until: "leavesActive"`, whose
  // whole content is that the turn comparison beside it must not be asked: the
  // bar ends when §10 sheds the LIST, and the three clears that do it are the
  // same three every field on this body is already on. The `turn` such an entry
  // carries is the INSTALL turn and is provenance only (types.ts `LockedAttack`),
  // so a build that dropped this clause would compare a number naming a turn its
  // holder has already spent — a bar that never bites once, rather than one that
  // bites for the wrong length.
  return pokemon.lockedAttacks
    .filter((locked) => locked.until === "leavesActive" || locked.turn === state.turn)
    .map((locked) => locked.attackIndex);
}

/** §8.5/§11 (D155) — the HP an attack-installed PER-ATTACK BUFF adds to the
    damage `pokemon`'s attack at `index` does right now, or 0. The ONE read of
    `InPlayPokemon.boostedAttack`, and `lockedAttackIndex`'s twin one function up
    on every axis but the RETURN and the arity:

    | | `lockedAttackIndex` (D154) | this (D155) |
    |---|---|---|
    | Record   | `{ turn, attackIndex }`   | `{ turn, attackIndex, amount }` |
    | Window   | `state.turn + 2`          | `state.turn + 2`               |
    | Asks     | WHICH attack is barred    | HOW MUCH this attack gains     |
    | Read by  | the §8 gate + 2 projections | the §8.5 main hit, once      |

    ⚠️ IT TAKES THE INDEX AND RETURNS THE NUMBER, WHICH IS D154's SHAPE ARGUMENT
    RUN AND ANSWERED THE OTHER WAY — and that inversion is the reason the two
    readers are two functions rather than one generic. That one returns an INDEX
    because two of its three callers build rows by mapping over the whole `attacks`
    array, so a per-index predicate would re-read one field N times. This one has
    exactly ONE caller, which already holds the declared index and wants a number
    to add; returning `{ index, amount } | null` would make that caller compare an
    index the reader could have compared itself. Same field shape, opposite access
    pattern, opposite signature — decided by the call sites both times.

    ⚠️ ONE READ SITE, AND THE BOUNDARY IS THE ADDRESS RATHER THAN A CHOICE. D149's
    debuff reaches all FOUR pre-W/R sites because it is a fact about a BODY; this
    is a fact about a DECLARATION, and only `attack.ts`'s main hit knows which
    attack was declared — `EffectContext` carries `seat`, `sourceUid` and
    `invokedBy` and no index, so the interpreter's three damage sites (`snipeActive`,
    `spreadDamage`, `placeSnipe`'s `deals` arm) structurally cannot ask. Unreachable
    today rather than merely unbuilt: the one printing's boosted attack does its
    whole damage through the printed `damage` field and derives no damage-dealing
    op at all. A printing that boosts an attack whose damage comes from an OP would
    earn `EffectContext` an attack index — written down here so the next reader
    does not have to re-derive why the count differs from D149's.

    ⚠️ IT IS SUMMED INTO `attackerPreWRBonus`'s NUMBER AT THE SITE AND NOT FOLDED
    INTO THAT FUNCTION, which is D149's reason (2) read from the other side of the
    table: that function folds `passivesOf`, the CATALOG scan, which a §9
    Ability-lock aura SUPPRESSES — and an attack INSTALLATION must be immune to
    that suppression. D149's other two grounds are silent here (a buff is
    positive, so the REPORTED field does not drop it, and it can never drive the
    subtotal negative), so the immunity is the whole of the argument and the row
    reports the two sources in ONE field (events.ts `DAMAGE_DEALT.bonus`). */
export function boostedAttackDamage(
  state: GameState,
  pokemon: InPlayPokemon,
  index: number,
): number {
  // No defensive `=== undefined` arm, for `attackBlockOf`'s reason above: the
  // field is REQUIRED and a record written before it existed is retired by
  // MATCH_RECORD_VERSION rather than read benignly here (D124's rule).
  const boost = pokemon.boostedAttack;
  return boost === null || boost.turn !== state.turn || boost.attackIndex !== index
    ? 0
    : boost.amount;
}

/** §8.5 (D192) — does `pokemon` ATTACK through "any effects on your opponent's
    Active Pokémon"? Walking Wake ex "Azure Seas" ("Damage from attacks used by
    this Pokémon isn't affected by any effects on your opponent's Active
    Pokémon."), 6 printings / 6 Standard-legal, the whole ability half of the
    main-hit suppression family.

    A ONE-LINE DELEGATION TO `passivesOf`, and it exists as a named function for
    `boostedAttackDamage`'s reason one block up: attack.ts's §8.5 block reads
    `passivesOf(next, defender)` and nothing else off the fold, so an inline
    `passivesOf(next, active).suppressTargetEffectsOnAttack` at the read site would
    put two differently-addressed folds one screen apart under names that differ by
    one argument. `boostedAttackDamage` and `installedAttackDebuffOf` are the two
    existing attacker-side reads this joins, and it is the FIRST of the three that
    is a CATALOG fact rather than a stamp on the attacker's record — which is
    exactly why it is the one that a §9 Ability-lock can switch off.

    ⚠️ IT ANSWERS ONLY THE ABILITY HALF. The printed ATTACK sentence of the same
    rule (15 legal printings) is parsed per declaration by
    `deriveAttackDamageSuppression` and never reaches this function; the two meet
    at ONE `||` in attack.ts. Sharing the read site and not the storage is the
    standing rule, and here it is load-bearing rather than tidy: this half is
    §9-suppressible and the attack half is not (an Ability-lock silences Abilities
    and has nothing to say about attack text). */
export function attackerSuppressesTargetEffects(state: GameState, pokemon: InPlayPokemon): boolean {
  return passivesOf(state, pokemon).suppressTargetEffectsOnAttack;
}

/** §8.1 (D324) — the total max HP `pokemon`'s OWN SIDE grants it through a
    SEAT-WIDE aura Ability: Ludicolo `sv09-037` *"All of your Pokémon in play get
    +40 HP. The effect of Vibrant Dance doesn't stack."* One legal printing, and
    the SIXTH and LAST of the `doesNotStack` Abilities — the family the registry's
    own doc-block has tracked since D243 is CLOSED by this function.

    THE TWELFTH MEMBER OF THE AURA-SCAN FAMILY (`disabledAbilityUids` /
    `seatRemovesWeakness` / `hasFreeRetreatAura` / `opposingRetreatSurcharge` /
    `opposingRetreatBlocked` / `hasFreeRetreatSelf` / `opposingAttackDebuff` /
    `benchShieldedFromDamage` / `seatDamageReduction` / `seatKoPrizeBonuses` /
    `alliedRetreatDiscount` / this), and structurally it is `seatDamageReduction`
    with `scope: "all"` fixed and every rider dropped: the printed sentence carries
    no beneficiary, no source zone and no other-named clause, so the ONLY clauses
    are membership, §9 and the cap.

    🛑 THE SOURCE IS INSIDE THE SET IT PAYS, AND THAT IS PRINTED RATHER THAN
    CHOSEN. *"All of your Pokémon in play"* includes the Ludicolo saying it, so a
    lone Ludicolo is at printed HP + 40 — there is no `othersOnly` scope here and a
    build that copied Feint Attack's exclusion would silently under-pay the one
    board this card is actually played on.

    🛑 THE CAP IS A `Math.max` LEDGER KEYED ON THE PRINTED ABILITY NAME, which is
    `seatDamageReduction`'s ledger and deliberately NOT `seatKoPrizeBonuses`' entry
    Set: an HP bonus is arithmetic, so "the largest single contribution wins" is
    the whole meaning of *"doesn't stack"*, where a coin flip is not an amount and
    had to cap the ENTRY instead. Two Ludicolo therefore give +40 and not +80,
    while a Ludicolo beside a differently-named non-stacking HP aura would give
    both — two DIFFERENT non-stacking effects still stack with each other.

    §9 through `disabledAbilityUids`: Vibrant Dance IS an Ability, so a Klefki
    lock over the Ludicolo takes the +40 off every body on its side at once —
    including bodies that Klefki's own stage clause could never reach. That is the
    sharpest observable difference between this function and `stadiumHpDelta`
    directly below, which sums into the same number and answers a lock the other
    way. */
export function seatMaxHpBonus(state: GameState, pokemon: InPlayPokemon): number {
  const uid = topUid(pokemon);
  if (uid === undefined) return 0;
  for (const seat of SEATS) {
    const side = state.players[seat];
    const holders = side.active === null ? side.bench : [side.active, ...side.bench];
    // The TARGET clause: "ALL of your Pokémon in play" — Active and Bench alike,
    // so membership on this side is the whole of it.
    if (!holders.some((holder) => topUid(holder) === uid)) continue;
    let bonus = 0;
    const capped = new Map<string, number>();
    for (const holder of holders) {
      const top = topCardOf(state, holder);
      const aura = top === undefined ? undefined : programFor(top.id)?.passive?.seatHpBonus;
      if (aura === undefined) continue;
      const sourceUid = topUid(holder);
      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue; // §9
      if (aura.noStack !== true) {
        bonus += aura.amount;
        continue;
      }
      capped.set(aura.ability, Math.max(capped.get(aura.ability) ?? 0, aura.amount));
    }
    for (const amount of capped.values()) bonus += amount;
    return bonus; // this is the Pokémon's own side — no other side can raise it
  }
  return 0;
}

/** §7.3/§8.1 (D324) — the in-play Stadium's ± to `top`'s max HP: Lively Stadium
    `sv08-180` *"Each Basic Pokémon in play (both yours and your opponent's) gets
    +30 HP"* and Gravity Mountain `sv08-177`/`sv08-250` *"Each Stage 2 Pokémon in
    play (both yours and your opponent's) gets -30 HP"*.

    `stadiumRetreatDelta`'s shape one seam over, with its ONE structural difference
    stated rather than inherited: that function early-returns on a non-Basic
    because BOTH its prints are Basic-only, and this one cannot, because its two
    prints name DIFFERENT stages. So the stage lives on the ROW (D260's test — a
    second printing of this mechanism needs a different value, therefore the value
    is catalog data) and the arm selects the predicate, which is exactly the move
    `preventDamageAtOrAbove`'s neighbour at line 2275 already makes for the same
    pair of stage nouns.

    NO SEAT, NO §9 — `stadiumPreventsDamage`'s two reasons verbatim: *"both yours
    and your opponent's"* leaves no side to derive, and a Stadium is not an Ability,
    so an Ability-lock that silences `seatMaxHpBonus` one function up leaves this
    running. A Klefki, a Ludicolo and a Gravity Mountain on one board is the
    three-way witness. */
function stadiumHpDelta(state: GameState, top: Card): number {
  const delta = stadiumEffectsOf(state)?.hpDelta;
  if (delta === undefined) return 0;
  const matches = delta.stage === "basic" ? isBasicPokemon : isStage2Pokemon;
  return matches(top) ? delta.amount : 0;
}

/** §8.1 max HP as the KO check and the HUD must read it: the printed hp plus
    every continuous ± in force — the body's OWN sources (Bravery Charm's
    Basic-only `basicHpBonus`, Hero's Cape's stage-free `hpBonus`, folded by
    `passivesOf`), its SIDE's aura Abilities (Ludicolo's Vibrant Dance) and the
    shared Stadium (Lively Stadium, Gravity Mountain). A null printed hp is the
    catalog data gap (cards.ts hpOf) and STAYS null — a bonus on top of unknown HP
    is still unknown, and a data gap never KOs.

    🛑 **THE `Math.max` IS THE D205 INVARIANT MADE EXPLICIT, AND D324 IS THE SLICE
    THAT MADE IT NECESSARY.** This function's return has been documented as never
    non-positive since D205, and a branch was DELETED on the strength of it:
    `koSurvivalClamp` carries no `dealt <= 0` guard because reaching its lethality
    test needs `pokemon.damage === 0` and `0 + dealt >= hp >= 1` then forces
    `dealt >= 1`. Until now that held for free — every term was an ADDEND. Gravity
    Mountain is the first subtrahend in the engine, so the invariant is now
    maintained by an explicit floor instead of by the absence of a minus sign.
    ⚠️ **THE FLOOR IS UNREACHABLE IN THE LEGAL POOL AND IS DECLARED RATHER THAN
    DRIVEN** (D257's precedent for exactly this): the MINIMUM printed HP over all
    **169** Standard-legal Stage 2 Pokémon is **120**, and only a Stage 2 can be
    subtracted from, so the one negative sentence bottoms out at 90. It is written
    anyway because the alternative is a deleted branch elsewhere resting on a
    property no line of code asserts. */
export function effectiveMaxHp(state: GameState, pokemon: InPlayPokemon): number | null {
  const top = topCardOf(state, pokemon);
  // Two early returns where D205 had one ternary, and the split is a TYPE fact
  // rather than a behaviour change: `stadiumHpDelta` needs the CARD, and TS
  // cannot back-narrow `top` from a null test on a value derived from it. The
  // answers are unchanged — an unreadable body and a data-gap HP both return null.
  if (top === undefined) return null;
  const hp = hpOf(top);
  if (hp === null) return null;
  const { hpBonus } = passivesOf(state, pokemon);
  return Math.max(
    MIN_EFFECTIVE_MAX_HP,
    hp + hpBonus + seatMaxHpBonus(state, pokemon) + stadiumHpDelta(state, top),
  );
}

/** The one "damage ≥ max HP" Knock Out test (§8.1/§13), reading the CONTINUOUS
    max HP directly above (printed + Tool bonuses — Bravery Charm) and owning the
    null-hp rule: a missing/non-positive printed hp is a catalog data gap, and a data
    gap never KOs (cards.ts hpOf via `effectiveMaxHp`).

    🆕🆕 **D433 MOVED IT HERE FROM `flow.ts`, AND THE MOVE IS A PLACEMENT FIX
    RATHER THAN A REFACTOR.** It is `effectiveMaxHp`'s comparator and reads nothing
    else — no stage, no event, no seat — so its home was never the turn-tail module.
    The move is forced by a real caller: `devolveEach` (interpreter.ts) must ask
    whether a body was ALREADY lethal before it shortens the stack, and interpreter.ts
    cannot import flow.ts (flow.ts takes `runProgram` from it). The alternative was to
    re-spell `damage >= effectiveMaxHp` at the op, which is the two-readings-of-one-
    question defect this repo keeps paying for (D131/D222) — and it would be exactly
    the reading that must NOT drift, because the marker it decides is read by
    `lethalRefs`' own sweep two stages later.

    ⚠️ `flow.ts` RE-EXPORTS IT so every existing import path still resolves; there is
    still exactly ONE definition. */
export function isLethallyDamaged(state: GameState, pokemon: InPlayPokemon): boolean {
  const hp = effectiveMaxHp(state, pokemon);
  return hp !== null && pokemon.damage >= hp;
}

/** 🆕 **D349 — THE PRINTED *"N HP or less **remaining**"* AS ONE PREDICATE, FOR
    ALL THREE OF ITS SUBJECTS.** *Remaining HP* is `effectiveMaxHp − damage`, and
    the catalog prints the threshold about three different bodies: the ability's
    own HOST (`AbilityProgram.remainingHpAtMost`, D310 — Pidove `sv05-133`), a
    GUST candidate (`gust.remainingHpAtMost` — Ledian `svp-133`/`sv07-003`/
    `sv07-144` "Glittering Star Pattern") and a HEAL candidate
    (`healChosen.remainingHpAtMost` — Bianca's Devotion `sv05-142`/`-197`/`-209`).
    **The SUBJECT is named by the op the field sits on; the PREDICATE is this
    function, once.** Hand-spelling it a second time is the shape D222 paid for
    and D310's own doc refused across its three readers.

    🛑 **THE MAXIMUM IS `effectiveMaxHp` AND NOT THE PRINTED `hpOf`** — D310's
    call, kept verbatim because it is a fact about the phrase and not about the
    subject: a Bravery Charm (+50) lifts a body out of the window it would
    otherwise sit in, and Gravity Mountain lowers one into it.

    ⚠️ **A `null` MAXIMUM FAILS RATHER THAN PASSES.** `effectiveMaxHp` owns the
    catalog data gap, and an unknown maximum cannot be SHOWN to satisfy a printed
    threshold. Refusing is the safe direction at every one of the three subjects:
    on the host gate it declines a click the resolution would have to honour, and
    on the two candidate scans it keeps a body the card cannot read out of a
    prompt the card is supposed to be narrowing.

    ⚠️ **UNDAMAGED IS NOT EXCLUDED.** A body printed at 30 HP with no damage has
    30 remaining and IS inside a `30`-window — the printed clause says nothing
    about damage, and `healChosen`'s own doc (D135) already refuses to invent a
    damaged restriction the sentence does not carry. */
export function remainingHpWithin(
  state: GameState,
  pokemon: InPlayPokemon,
  atMost: number,
): boolean {
  const max = effectiveMaxHp(state, pokemon);
  if (max === null) return false;
  return max - pokemon.damage <= atMost;
}

/** §6.3/§6.4 — the flat list of energy UNITS a Pokémon's attached energies
    provide toward attack costs, evaluated per energy under its rules text:
    - a basic energy provides its one type (cards.ts energyProvidesOf);
    - an AUTHORED special energy provides its EnergyProgram's units (a concrete
      type, or ANY_ENERGY for a wildcard, and multi-unit is allowed — Double
      Turbo-likes), with Luminous's "{C} instead if another Special Energy is
      attached" evaluated against the holder's OTHER energies;
    - an UNAUTHORED special energy falls back to one Colorless (energyProvidesOf),
      so it stays playable rather than rejecting.
    The one provision read site: attack.ts's §8.2 cost check and the HUD's
    payability preview both call it, so they cannot drift (the D18 duplication
    is gone). costMet (attack.ts) consumes this flat list. */
export function providedEnergy(state: GameState, pokemon: InPlayPokemon): string[] {
  // Which attached energies are Special — for Luminous's "any OTHER Special
  // Energy attached" condition. Resolved once against the live board, then
  // shared by every unit lookup below (the condition is about the HOLDER, so it
  // is the same question for all of them).
  const specialUids = specialEnergyUids(state, pokemon);
  return pokemon.energy.flatMap((uid) => unitsOf(state, pokemon, uid, specialUids));
}

/** The units ONE attached Energy provides, on the Pokémon it is attached to —
    the per-card half of `providedEnergy` above, split out so the `providesEnergy`
    CardFilter (interpreter.ts) reads provision through the SAME code the §8.2
    cost matcher does. Two readers of one rule: an Energy that can pay a {L} cost
    is exactly an Energy a "discard a {L} Energy" effect may take, and letting
    those two drift would let a Kilowattrel pay {L} with a card the very same
    attack then refuses to discard. */
export function unitsProvidedBy(state: GameState, pokemon: InPlayPokemon, uid: string): string[] {
  return unitsOf(state, pokemon, uid, specialEnergyUids(state, pokemon));
}

/** Does `uid`, attached to `pokemon`, provide `energyType` (§6.3)? The
    `providesEnergy` filter's predicate.

    A WILDCARD provider matches every type: Luminous Energy "provides every type
    of Energy but only 1 at a time", so it IS a {L} Energy for a card that asks
    for one — the same ANY_ENERGY unit costMet lets fill any typed slot. And
    because provision is read on the HOST, the answer genuinely moves with the
    board: that same Luminous provides only {C} once another Special Energy joins
    it, and stops being a {L} Energy at all. */
export function providesEnergyType(
  state: GameState,
  pokemon: InPlayPokemon,
  uid: string,
  energyType: string,
): boolean {
  const units = unitsProvidedBy(state, pokemon, uid);
  return units.includes(energyType) || units.includes(ANY_ENERGY);
}

/** Does `pokemon` have ANY attached Energy of `energy` (§6.3)? The predicate
    behind the printed "If this Pokémon has any {R} / Special Energy attached"
    clause (D118's `yourActiveHasEnergyAttached`), and it lives HERE, beside the
    provision code, for the reason `unitsProvidedBy` gives one docblock up: the
    reading must not drift from what pays a cost.

    A TYPE is read through `providesEnergyType`, i.e. by PROVISION rather than by
    the printed name — so a wildcard Luminous Energy is a {R} Energy for as long
    as it provides every type, and stops being one the moment a second Special
    demotes it to {C}. That is the same answer §8.2's cost check gives, which is
    the point: an Energy that can pay a {R} cost is exactly an Energy a "has any
    {R} Energy attached" clause counts.

    `"special"` is the CARD CLASS, not a type, so it reads `isSpecialEnergy`
    directly — the same list Luminous's own "any other Special Energy attached"
    condition is evaluated against, one function down. */
export function hasAttachedEnergy(
  state: GameState,
  pokemon: InPlayPokemon,
  energy: BasicEnergyType | "special" | "basic",
): boolean {
  // 🆕🆕 D500 — the OTHER card class, inserted ABOVE its complement so a reader meets
  // the pair together. No printing spells *"has any Basic Energy attached"*; the value
  // arrives because the clause resolves through the shared token map (D118).
  if (energy === "basic") return basicEnergyUids(state, pokemon).length > 0;
  if (energy === "special") return specialEnergyUids(state, pokemon).length > 0;
  return pokemon.energy.some((uid) => providesEnergyType(state, pokemon, uid, energy));
}

/** How many Energy CARDS are attached to `pokemon` (§6.3), optionally narrowed to
    one type? `hasAttachedEnergy` counted rather than tested — the predicate behind
    D128's "Flip a coin for each [{X}] Energy attached to this Pokémon."

    It is not written as `hasAttachedEnergy`'s implementation (that one keeps its
    `.some`, which short-circuits on the first hit) but it must give the same answer
    on the same board, which is why the two sit together: a FILTERED count reads by
    PROVISION through `providesEnergyType`, the D118 rule, so an Energy that can pay
    a `{R}` cost is exactly an Energy a `{R}` sentence counts.

    `energy: null` — the UNFILTERED reading, and a genuinely different tally rather
    than a filter that matches everything. "Each Energy attached to this Pokémon"
    counts attached Energy CARDS, so a Special Energy demoted to providing only {C}
    is still one Energy here, and a wildcard providing every type is still exactly
    one. CARDS not units, for the same reason `countEnergyInPlay` gives below: one
    Energy card is one Energy however many units it provides. */
export function countAttachedEnergy(
  state: GameState,
  pokemon: InPlayPokemon,
  energy: BasicEnergyType | "special" | "basic" | null,
): number {
  if (energy === null) return pokemon.energy.length;
  // 🆕🆕 D500 — the printed CATEGORY `Basic`, and it sits between the unfiltered arm
  // and its complement because those are the two readings it is most easily confused
  // with: `null` counts a Special too, `"special"` counts ONLY the Special, and this
  // one counts everything neither of them does. A board holding both tells all three
  // apart, which is `basicEnergyScaling.test.ts` §2's whole job.
  if (energy === "basic") return basicEnergyUids(state, pokemon).length;
  if (energy === "special") return specialEnergyUids(state, pokemon).length;
  return pokemon.energy.filter((uid) => providesEnergyType(state, pokemon, uid, energy)).length;
}

/** §8.1 (D325) — WHICH SEAT has `pokemon` in play, or undefined when nothing on
    either board carries its uid (an unreadable stack, or a body already gone).

    It exists because `passivesOf` is handed a body and no seat, and
    `MaxHpScale.opponentPrizesTaken` is the fold's FIRST question whose answer is
    about a SIDE rather than about the body. Every other holder gate in that loop
    — `isBasic`, `holderTypes`, `onBench`, `requiresEnergyType` — is answerable
    from the stack alone.

    ⚠️ IT IS `isOnBench`'s SCAN WITH THE ANSWER KEPT INSTEAD OF THROWN AWAY, and
    the two are deliberately not merged: that one asks about a SPOT and this asks
    about a SIDE, and a body in the Active Spot must answer `false` to the first
    and a real seat to this one. `undefined` (never `"a"`) is the missing answer,
    so a caller cannot silently read the wrong side's Prizes. */
function seatOfPokemon(state: GameState, pokemon: InPlayPokemon): Seat | undefined {
  const uid = topUid(pokemon);
  if (uid === undefined) return undefined;
  return SEATS.find((seat) => {
    const side = state.players[seat];
    const holders = side.active === null ? side.bench : [side.active, ...side.bench];
    return holders.some((holder) => topUid(holder) === uid);
  });
}

/** §8.1 (D325) — the multiplicand of a `PassiveEffects.hpBonusPer`: how many of
    the counted thing the live board holds for `pokemon`. Never negative, so the
    grant it scales is always an ADDEND (registry.ts `MaxHpScale` argues it).

    Both arms DELEGATE rather than count: `countAttachedEnergy` is §6.3's reading
    of "Energy attached to it" and `takenPrizes` is §8.1's reading of "Prize card
    your opponent has taken", so a max-HP sentence and a damage sentence quoting
    the same printed noun cannot come apart. An unresolvable seat answers 0 —
    `matchesFilter`'s conservative direction throughout this file, and here it
    means an unplaceable body gets LESS HP, never more. */
function maxHpScaleCount(state: GameState, pokemon: InPlayPokemon, scale: MaxHpScale): number {
  switch (scale.kind) {
    case "attachedEnergy":
      return countAttachedEnergy(state, pokemon, scale.energyType);
    case "opponentPrizesTaken": {
      const seat = seatOfPokemon(state, pokemon);
      return seat === undefined ? 0 : takenPrizes(state, otherSeat(seat));
    }
  }
}

/** How many Energy CARDS of `energy` are in play on `seat`'s side (§6.3)? The
    board-wide sibling of `hasAttachedEnergy` above, and the predicate behind
    Absol sv06.5-030 "Darkfall" ("If you have at least 3 {D} Energy in play, …").
    It lives here, next to its sibling, so the two readings of the SAME printed
    noun cannot drift: "a {D} Energy" means the same card whether the sentence
    scopes it to one Pokémon or to the whole board.

    Two things this deliberately is, both forced by the printed text:

    - **CARDS, not units of provision.** The sentence counts Energy, and one
      Energy card is one Energy however many units it provides — a Special that
      pays for two {D} is still a single card here. `.filter(…).length` per
      holder, never a sum of `unitsProvidedBy`.
    - **PROVISION, not the printed name**, exactly as `hasAttachedEnergy` reads
      it (D118): a wildcard Luminous attached to one of your Pokémon counts
      toward `{D}` for as long as it provides every type, and stops the moment a
      second Special demotes it to {C}. Provision is computed on the HOST, so
      this must ask per holder rather than once per uid.

    "In play" is Active + Bench and nothing else — the discard pile, the hand and
    the deck are not in play, and the pool's own usage of the phrase is
    consistently field-scoped (cards that mean otherwise print "in your discard
    pile" / "in your hand"). An empty board counts 0.

    ⚠️ `energy: null` IS THE UNFILTERED READING (D193) — every attached card on the
    side, whatever it provides — and it is the SAME widening `countAttachedEnergy`
    above already carries, arriving here for the same reason: the pool prints the
    board-scoped noun both ways ("…for each Energy attached to all of your
    opponent's Pokémon." alongside "…for each {R} Energy attached to all of your
    opponent's Pokémon."), so the per-body counter and the board-wide one must
    admit the same three answers or the two readings of one printed noun drift
    apart. It is a WIDENING and not a shape change: every existing caller passes a
    concrete type or `"special"` and none can observe the new arm.

    🆕🆕 **D470 — AND THE HOLDER LIST IS OPTIONALLY NARROWED BY A `CardFilter`, WHICH
    IS THE SAME KIND OF WIDENING ONE PARAGRAPH UP AND ARRIVES FOR THE SAME REASON.**
    The column prints the board-scoped noun with a SUBGROUP in it — *"…for each {L}
    Energy attached to all of your Iono's Pokémon."* (`censusAttackCorpus.ts` file line
    558, 1 legal printing) — so the zone and the SET OF BODIES IN IT are two questions,
    and answering the second in the caller would mean a second walk of Active + Bench
    living beside this one. `undefined` is EVERY body, so this function's THREE shipped
    callers — `attack.ts`'s `energyOnOpponent` and `energyOnSelf` board arms and
    `interpreter.ts`'s `yourEnergyInPlayAtLeast` — pass three arguments, are
    byte-identical, and cannot observe the new parameter.

    🛑 **THE READ IS THE TOP CARD (§1.2), NOT THE BOTTOM OF THE STACK**, which is
    `benchBodies`' own reading in attack.ts and is a real line of play rather than
    symmetry: an owner-prefixed Basic that has been evolved into a body WITHOUT the
    prefix has stopped being one of *"your Iono's Pokémon"*, and the §10 evolve is what
    makes that observable. `matchesFilter` takes `Card | undefined` and answers false
    for a missing card, so an unresolvable uid is counted OUT rather than throwing.

    ⚠️ **THE FILTER IS ASKED PER HOLDER AND BEFORE THE PROVISION QUESTION, NEVER PER
    UID.** It names BODIES, not Energy cards — the `basicEnergy`/`toolCard` members of
    the same union name cards, and handing one of those in here would ask whether the
    Pokémon is a Basic Energy card and count 0 forever. Stated because the two
    vocabularies share a type. */
export function countEnergyInPlay(
  state: GameState,
  seat: Seat,
  energy: BasicEnergyType | "special" | "basic" | null,
  filter?: CardFilter,
): number {
  const side = state.players[seat];
  const holders = side.active === null ? side.bench : [side.active, ...side.bench];
  let total = 0;
  for (const holder of holders) {
    if (filter !== undefined && !matchesFilter(topCardOf(state, holder), filter)) continue;
    if (energy === null) {
      total += holder.energy.length;
      continue;
    }
    // 🆕🆕 D500 — the printed CATEGORY, delegating to the same `basicEnergyUids` the
    // per-body counter above calls, so the board-wide and per-body readings of one
    // printed noun cannot drift (this function's own standing reason).
    //
    // 🛑 **IT IS ITS OWN `continue` RATHER THAN A THIRD LIMB OF THE TERNARY BELOW**,
    // which is deliberate on D470's two counts one parameter up: the ternary stays
    // byte-identical, so the corpus rows anchored on it keep their `find` and every
    // declared survivor in this file is preserved by D469's pure-addition argument.
    //
    // ⚠️ **AND THE `filter` ABOVE IS A DIFFERENT VOCABULARY POINTED AT DIFFERENT
    // OBJECTS.** That one names BODIES and is asked per HOLDER; this names CARDS and
    // is asked per UID. Handing `{kind: "basicEnergy"}` to the `filter` parameter
    // would ask whether the POKÉMON is a Basic Energy card and count 0 forever — the
    // hazard this function's own doc block names — which is why the card category
    // rides the `energy` value and not the body filter.
    if (energy === "basic") {
      total += basicEnergyUids(state, holder).length;
      continue;
    }
    total +=
      energy === "special"
        ? specialEnergyUids(state, holder).length
        : holder.energy.filter((uid) => providesEnergyType(state, holder, uid, energy)).length;
  }
  return total;
}

/** 🆕 **D406 — HOW MANY POKÉMON TOOLS ARE ATTACHED TO EVERYTHING `seat` HAS IN
    PLAY**, the TOOL sibling of `countEnergyInPlay` directly above and placed
    beside it for that function's own stated reason: the two read the SAME printed
    noun — *"attached to all of your Pokémon"* / *"attached to all of your
    opponent's Pokémon"* — and two spellings of one scope are exactly what drifts.
    "In play" is Active + Bench and nothing else; an empty board counts 0.

    CARDS, and there is nothing else it could be. The Energy counter has to say so
    out loud because one Energy card can provide two units; a Tool provides
    nothing, so `tools.length` per holder is the whole arithmetic and no provision
    question exists. Every uid in that array reached it through `attachTool`
    (cardplay.ts), which has already refused anything whose `trainerType` is not
    "Tool" — the same argument `yourActiveHasToolAttached` makes for its length
    test one abstraction down.

    ⚠️ **NOT BOUNDED AT ONE PER BODY.** §7.4's one-Tool-per-Pokémon cap is an
    ATTACH-GATE rule and Revavroom ex `sv03-156`'s "Tune-Up" raises it to 4, so
    this sums the arrays rather than counting the bodies that have one — which is
    the difference between this and a `tools.length > 0` tally, and the difference
    is observable on any board where one Pokémon wears two. */
export function countToolsInPlay(state: GameState, seat: Seat): number {
  const side = state.players[seat];
  const holders = side.active === null ? side.bench : [side.active, ...side.bench];
  let total = 0;
  for (const holder of holders) total += holder.tools.length;
  return total;
}

/** 🆕🆕 **D469 — HOW MANY DAMAGE COUNTERS ARE ON EVERYTHING `seat` HAS IN PLAY**
    (§6.3 + §12), the third sibling of `countEnergyInPlay` / `countToolsInPlay` and
    placed beside them for their own stated reason: *"all of your opponent's
    Pokémon"* is the SAME printed scope those two already read at the other end of
    the table, and D159 says one question gets one answer. "In play" is Active +
    Bench and nothing else — the discard pile, the hand and the deck hold no
    counters at all — and an empty board counts 0.

    🛑 **FLOORED PER BODY AND SUMMED AFTER THE FLOOR, NOT SUMMED AND THEN FLOORED**,
    which is `damageCountersOnYourBench`'s arithmetic in attack.ts and is a genuinely
    different number: two bodies carrying 15 damage each are 1 + 1 = **2** counters
    here and would be `floor(30/10)` = **3** the other way round. One counter is 10 HP
    (§12) and `InPlayPokemon.damage` is HP-of-damage-taken, so the per-body floor is
    what keeps a stray non-multiple — a mid-effect state, a test board — from rounding
    its way into a neighbour's slot. `opponentBoardCounterScaling.test.ts` §3 drives
    exactly that board rather than asserting the shape.

    ⚠️ **SEAT-AGNOSTIC, and the CALLER picks the end of the swing.** The one shipped
    caller passes `defenderSeat` because its printed word is *"your OPPONENT's"*; the
    function itself names no side, exactly as its two neighbours do not, so the day a
    *"…on all of your Pokémon"* counter sentence prints there is nothing to widen. */
export function countDamageCountersInPlay(state: GameState, seat: Seat): number {
  const side = state.players[seat];
  const holders = side.active === null ? side.bench : [side.active, ...side.bench];
  let total = 0;
  for (const holder of holders) total += Math.floor(holder.damage / 10);
  return total;
}

/** The attached Energy that are SPECIAL — the context Luminous's "any other
    Special Energy attached" clause is evaluated against. */
function specialEnergyUids(state: GameState, pokemon: InPlayPokemon): string[] {
  return pokemon.energy.filter((uid) => {
    const card = cardOfUid(state, uid);
    return card !== undefined && isSpecialEnergy(card);
  });
}

/** 🆕🆕 **D500 — WHICH ATTACHED UIDS ARE *BASIC* ENERGY CARDS (§6.1), the EXACT
    COMPLEMENT of `specialEnergyUids` directly above and placed beside it for that
    function's own reason: the two answer one printed distinction and must not drift.**
    The printed noun is *"Basic Energy"* — Blissey `censusAttackCorpus.ts` file line
    580, *"This attack does 40 damage for each Basic Energy attached to this
    Pokémon."*, 1 legal printing.

    🛑 **IT DELEGATES TO `matchesFilter`'s `basicEnergy` ARM RATHER THAN RE-SPELLING
    THE PREDICATE, AND THAT IS D159 AT A NOUN THAT ALREADY HAD AN ANSWER.** The same
    printed words are read on a DIFFERENT count source — *"for each Basic Energy card
    in your opponent's discard pile."* resolves to
    `{kind: "cardsInDiscardPile", filter: {kind: "basicEnergy"}}` — so the question
    *"is this card a Basic Energy card"* was already answered in `cards.ts`, and a
    second `card.energyType === "Normal"` here would be two readers of one noun, free
    to disagree. What the two count sources do NOT share is the VOCABULARY that
    reaches them: a discard-pile count is narrowed by a `CardFilter` over cards, while
    an attached count is narrowed by the energy-token value this function serves. One
    predicate, two spellings of the route to it.

    ⚠️ **CARDS, AND NOT "PROVIDES A BASIC TYPE" — THE TWO ARE DIFFERENT NUMBERS ON A
    BOARD THIS REPO ALREADY FIELDS.** `fix-blend` is a Special Energy whose
    `EnergyProgram` provides `["Fire", "Water"]`, so `providesEnergyType(…, "Water")`
    is TRUE of it while it is not a Basic Energy card at all; and `fix-energy` is a
    Basic Energy whose name does not parse, so it provides only Colorless and no typed
    reading counts it. A build that spelled this arm as *"provides some member of
    `BASIC_ENERGY_TYPES`"* is wrong in BOTH directions at once, and
    `basicEnergyScaling.test.ts` §2 drives exactly that board.

    ⚠️ **`matchesFilter` TAKES `Card | undefined` AND ANSWERS FALSE FOR A MISSING
    CARD**, so an unresolvable uid is counted OUT rather than throwing — the sibling's
    conservative direction, and this file's throughout. */
function basicEnergyUids(state: GameState, pokemon: InPlayPokemon): string[] {
  return pokemon.energy.filter((uid) => matchesFilter(cardOfUid(state, uid), BASIC_ENERGY_CARD));
}

/** The one `CardFilter` value `basicEnergyUids` asks with, hoisted to a module
    constant so the allocation does not sit inside a `.filter` callback and so the
    noun has exactly one spelling in this file. */
const BASIC_ENERGY_CARD: CardFilter = { kind: "basicEnergy" };

/** The units ONE attached energy provides ON `pokemon` — the whole of §6.3/§6.4's
    per-card reading, and the single funnel `providedEnergy` and `unitsProvidedBy`
    both go through.

    ⚠️ D262 WIDENED THIS TO TAKE THE **HOLDER**, and that is the row's only real
    cost. Until Neo Upper Energy every provision rule was answerable from the CARD
    plus a list of sibling Special uids; a conditional keyed to the holder's
    printed STAGE is not. Both call sites already held an `InPlayPokemon`
    (`providedEnergy(state, pokemon)` and `unitsProvidedBy(state, pokemon, uid)`),
    so this is a signature widening and not a plumbing job — grepped before the row
    was promised, because that is the difference between a two-file row and a
    four-file one.

    ⚠️ THE TWO CONDITIONAL ARMS ARE READ IN FIELD ORDER AND THAT ORDER IS
    UNOBSERVABLE. `demoteWithOtherSpecial` (Luminous `sv02-191`) and
    `promoteOnHolderStage` (Neo Upper `sv05-162`, 🆕 Prism `sv10.5b-086`) are the
    only two, and NO printing in this pool carries both — the whole Special Energy
    column was censused at D261, re-derived at D262 and re-queried at D300. If one
    ever does, the printed sentence will say which wins and this comment becomes a
    decision instead of an observation.

    🆕 ⚠️ D300 — THE STAGE ARM NOW DISPATCHES ON A **VALUE**, WHICH IS WHY THE
    PREDICATE IS PICKED HERE RATHER THAN BRANCHED AROUND. Two printings carry the
    field with opposite stage words (Stage 2 promotes to TWO wildcards, Basic to
    ONE), so the arm selects `isBasicPokemon` or `isStage2Pokemon` and runs ONE
    return. A third stage word costs a case in that ternary and nothing else. 🛑
    THE FAILURE THIS SHAPE EXISTS TO MAKE IMPOSSIBLE is a Basic-gated provision
    firing on a Stage 2 holder (or the reverse): the two predicates are DISJOINT on
    every card in the pool, so the wrong one is not a near-miss, it is silence on
    one board and a wildcard on the other. Both directions are driven in
    `prismEnergy.test.ts` and both are in the mutation corpus.

    🛑 EVERY ARM IS LIVE-READ, NOT STAMPED. The holder's top card is resolved on
    each call, so evolving a Stage 1 into a Stage 2 with a Neo Upper already
    attached upgrades its provision in the same breath — exactly as attaching a
    second Special demotes a Luminous already sitting there. 🆕 Prism runs that
    claim in the OTHER direction: evolving a Basic into a Stage 1 with a Prism
    attached DEMOTES it, mid-game, and `prismEnergy.test.ts` drives the evolve.

    🆕 🛑 D302 — THE STAGE ARM IS NOW A **CONJUNCTION**, AND THE TWO EXTRA TERMS
    ARE READ HERE RATHER THAN THROUGH `conditionHolds` BECAUSE THEY STRUCTURALLY
    CANNOT BE. Reversal Energy `sv04-266` gates the same promotion on THREE terms
    — the holder is an Evolution, the holder has no Rule Box, and YOU have more
    Prize cards remaining than your opponent. The third is verbatim
    `BoardCondition.morePrizesThanOpponent`, whose clause table already maps this
    card's printed words, and it is STILL not reused: `conditionHolds` lives in
    interpreter.ts, which imports THIS file, so a `BoardCondition` read from a
    continuous scan closes an import cycle. That is `noRetreatCostSelf`'s recorded
    reason (registry.ts) applied a second time, and it is why the field carries
    bespoke optional flags instead of a condition.

    ⚠️ THE SEAT IS **DERIVED, NOT PASSED**, WHICH KEEPS ALL THREE EXPORTED
    SIGNATURES UNTOUCHED. `providedEnergy` / `unitsProvidedBy` / `providesEnergyType`
    hand us an `InPlayPokemon` and no seat, and their callers (attack.ts's §8.2
    cost check, the HUD preview, interpreter.ts's `providesEnergy` filter) would
    all have had to grow one. `hasFreeRetreatAura` in this same file already
    derives a seat by matching the holder's TOP uid against each side's own
    `active`/`bench`, and this reuses that trick verbatim — a prize comparison is
    seat-relative, so getting the seat wrong inverts the answer rather than
    softening it.

    🛑 THE POLARITY IS THE ONE THING THAT CAN GO SILENTLY WRONG. "More Prize cards
    REMAINING" means you have TAKEN FEWER — you are BEHIND — so the comparison is
    `>` on `prizes.length`, matching `conditionHolds`'s arm byte for byte. A build
    that read it as "ahead" is green on every board where the prize counts are
    equal (the promotion is off either way) and wrong on every board that matters;
    `reversalEnergy.test.ts` drives BOTH sides of the comparison and the mutation
    corpus carries the flip. */
/** 🆕 D302 — §14/§3.8: does the side that CONTROLS `pokemon` have strictly more
    Prize cards REMAINING than its opponent? Reversal Energy `sv04-266`'s first
    printed term, read here rather than through
    `BoardCondition.morePrizesThanOpponent` because `conditionHolds` lives in
    interpreter.ts and interpreter.ts imports this file (see `unitsOf`).

    🛑 THE COMPARISON IS BYTE-FOR-BYTE `conditionHolds`'s ARM — `prizes.length >`
    the other seat's — so the two readings of one printed clause cannot drift, and
    "more REMAINING" is BEHIND on Prizes taken. `takenPrizes` is the complement and
    would invert the operator, which is exactly the silent bug the sibling test
    drives both sides of.

    ⚠️ THE SEAT IS DERIVED BY TOP UID, `hasFreeRetreatAura`'s trick in this same
    file: the caller always hands us one of a side's own `active`/`bench` entries,
    so the side holding it is the controller. An empty stack (no top uid) cannot be
    matched to a seat and answers FALSE — the conservative reading, since an
    unresolvable holder must not promote. */
function holderSideLeadsOnPrizesRemaining(state: GameState, pokemon: InPlayPokemon): boolean {
  const uid = topUid(pokemon);
  if (uid === undefined) return false;
  for (const seat of SEATS) {
    const side = state.players[seat];
    const holders = side.active === null ? side.bench : [side.active, ...side.bench];
    if (!holders.some((holder) => topUid(holder) === uid)) continue;
    return side.prizes.length > state.players[otherSeat(seat)].prizes.length;
  }
  return false;
}

function unitsOf(
  state: GameState,
  pokemon: InPlayPokemon,
  uid: string,
  specialUids: readonly string[],
): string[] {
  const card = cardOfUid(state, uid);
  if (card === undefined) return ["Colorless"]; // unresolved uid — the conservative unit
  const program = programFor(card.id)?.energy;
  // Basic energy → its type; an unauthored special energy → Colorless.
  if (program === undefined) return [energyProvidesOf(card)];
  const demote = program.demoteWithOtherSpecial;
  if (demote !== undefined && specialUids.some((other) => other !== uid)) return [...demote];
  const promote = program.promoteOnHolderStage;
  if (promote !== undefined) {
    // The printed stage word lives on the holder's TOP card (§1.2 — a Pokémon's
    // identity is its top card), which is what makes this read move with an evolve.
    const top = topCardOf(state, pokemon);
    const matches =
      promote.stage === "Basic"
        ? isBasicPokemon
        : promote.stage === "Stage2"
          ? isStage2Pokemon
          : isEvolutionPokemon;
    if (
      top !== undefined &&
      matches(top) &&
      // D302 — the riders NARROW the stage gate; absent means ungated, so Neo
      // Upper and Prism reach the same `return` they always did.
      (promote.noRuleBox !== true || !hasRuleBox(top)) &&
      (promote.whileMorePrizesRemaining !== true || holderSideLeadsOnPrizesRemaining(state, pokemon))
    )
      return [...promote.units];
  }
  return [...program.provides];
}

/** §11 — is `pokemon`'s Retreat Cost currently zeroed by an own-board "no
    Retreat Cost" aura (Clefable ex "Lunar Zone")? The per-TARGET cousin of
    `seatRemovesWeakness`: the aura reaches other Pokémon, so it is read through a
    dedicated scan rather than `passivesOf`, but its printed clause ("…that have
    {P} Energy attached") is evaluated against each target rather than once per
    seat, so this takes the Pokémon.

    The seat is derived rather than passed: the aura is OWN-BOARD, so we find the
    side holding `pokemon` (by top uid — the caller always hands us one of that
    side's own `active`/`bench` entries) and look for a source only there, which
    keeps `effectiveRetreatCost`'s signature — and its three call sites (turn.ts
    retreat, redact.ts, the web HUD) — untouched. A source is any of that side's
    in-play Pokémon (Active or Bench, no "in the Active Spot" clause) whose TOP
    card's passive sets `noRetreatCostAura`, provided that source is not itself
    §9-locked (the `disabledAbilityUids` checklist every non-lock Ability surface
    must consult). The energy clause is a PROVISION read (`providesEnergyType`),
    so a wildcard Luminous Energy satisfies {P} exactly as it would pay a {P}
    cost. Self-inclusive: the source's own Retreat Cost is freed too, iff it
    satisfies the clause.

    🆕 D267 — THE STAGE CLAUSE IS THE SECOND PER-TARGET PREDICATE, AND IT IS
    ABOUT THE TARGET AND NOT THE HOLDER. Latias ex "Skyliner" prints "Your Basic
    Pokémon in play have no Retreat Cost", so the narrowing sits beside
    `requiresEnergyType` — read off `targetTop`, the TOP card of the body being
    asked about, never off `top` (the holder's card, which is in scope right
    there and is the mistake this loop invites). It is hoisted out of the holder
    loop because it does not vary with the holder. An ABSENT `stage` means
    UNGATED, so Lunar Zone still frees an EVOLUTION carrying {P}; the read is
    `isBasicPokemon` on the top card, which is why an evolve takes the freedom
    away in the same breath. */
export function hasFreeRetreatAura(state: GameState, pokemon: InPlayPokemon): boolean {
  const uid = topUid(pokemon);
  if (uid === undefined) return false;
  const targetTop = topCardOf(state, pokemon);
  for (const seat of SEATS) {
    const side = state.players[seat];
    const holders = side.active === null ? side.bench : [side.active, ...side.bench];
    if (!holders.some((holder) => topUid(holder) === uid)) continue;
    for (const holder of holders) {
      const top = topCardOf(state, holder);
      const aura = top === undefined ? undefined : programFor(top.id)?.passive?.noRetreatCostAura;
      if (aura === undefined) continue;
      const sourceUid = topUid(holder);
      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue;
      if (aura.stage === "Basic" && (targetTop === undefined || !isBasicPokemon(targetTop)))
        continue;
      const required = aura.requiresEnergyType;
      if (
        required !== undefined &&
        !pokemon.energy.some((energyUid) => providesEnergyType(state, pokemon, energyUid, required))
      )
        continue;
      return true;
    }
    return false; // this is the Pokémon's own side — no other side can free it
  }
  return false;
}

/** §11 — the {C} ADDED to `pokemon`'s Retreat Cost by the OPPOSING side's
    continuous auras (Spidops ex "Trap Territory": "Your opponent's Active
    Pokémon's Retreat Cost is {C} more"). The cross-board, delta-returning mirror
    of `hasFreeRetreatAura`, and it shares that scan's derived-seat trick: the
    caller hands us one of a side's own `active`/`bench` entries, so we find that
    side by top uid and then read the OTHER one — which is what keeps
    `effectiveRetreatCost`'s signature, and all four of its call sites, untouched.

    The two Active clauses are NOT symmetric, and the printed text is the whole
    reason: "your opponent's ACTIVE Pokémon's Retreat Cost" scopes the TARGET, so
    a benched target is never surcharged — but nothing scopes the SOURCE, so a
    Spidops ex imposes it from the Bench as readily as from the Active Spot
    (contrast `damageAttacker`, whose Active clause is on the holder). Sources
    are SUMMED: two Spidops ex in play are {C}{C} more, and each is gated through
    `disabledAbilityUids` (§9) like every non-lock Ability surface.

    🆕 D322 — THE TARGET NARROWING. Ariados sv06-005 "Big Net" prints "Your
    opponent's Active EVOLUTION Pokémon's Retreat Cost is {C} more", so a source
    may carry a `target` CardFilter and then contributes nothing against a BASIC
    Active. It is matched against `targetTop` — the TOP card of the body being
    asked about, hoisted out of the source loop because it does not vary with the
    source — and never against the source's own card, which is in scope inside
    that loop and is the mistake this shape invites: Ariados is a Stage 1, so a
    source-side read is green on every board where the surcharge is imposed at
    all. This is `seatDamageBonusBeforeWR`'s D245 `target` rider verbatim, down to
    the `matchesFilter` call and the `evolutionPokemon` member — the same printed
    noun phrase on the damage seam. An ABSENT rider is UNGATED, which is Trap
    Territory's bare sentence, and the two can be live at once: a Spidops ex and
    an Ariados facing a Basic Active sum to {C}, facing an Evolution to {C}{C}. */
export function opposingRetreatSurcharge(state: GameState, pokemon: InPlayPokemon): number {
  const uid = topUid(pokemon);
  if (uid === undefined) return 0;
  const targetTop = topCardOf(state, pokemon);
  for (const seat of SEATS) {
    const side = state.players[seat];
    // The TARGET clause: only the side's Active is surcharged, so a benched
    // holder of this uid is out even though it belongs to this side.
    if (side.active === null || topUid(side.active) !== uid) continue;
    const foes = state.players[otherSeat(seat)];
    const sources = foes.active === null ? foes.bench : [foes.active, ...foes.bench];
    let added = 0;
    for (const source of sources) {
      const top = topCardOf(state, source);
      const aura =
        top === undefined ? undefined : programFor(top.id)?.passive?.opponentActiveRetreatSurcharge;
      if (aura === undefined) continue;
      const sourceUid = topUid(source);
      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue;
      if (aura.target !== undefined && !matchesFilter(targetTop, aura.target)) continue;
      added += aura.amount;
    }
    return added;
  }
  return 0;
}

/** §11 — the {C} SUBTRACTED from `pokemon`'s Retreat Cost by its OWN side's
    continuous auras (Toedscruel sv09-089 "Secret Forest Path": "As long as this
    Pokémon is on your Bench, your Active Pokémon's Retreat Cost is {C}{C} less").
    The TWELFTH member of the aura-scan family and the SIGN-FLIPPED, OWN-SIDE
    mirror of `opposingRetreatSurcharge` directly above: same derived-seat trick
    (the caller hands us one of a side's own `active`/`bench` entries, so we find
    that side by top uid), same Active TARGET clause, same §9 gate, same SUM over
    sources — and then it reads the side it found rather than the other one, which
    is the entire difference and is why the two are separate scans rather than one
    signed fold.

    THE RETURN IS A NON-NEGATIVE DISCOUNT, not a signed delta, and
    `effectiveRetreatCost` SUBTRACTS it — `stadiumRetreatDelta`'s `added -
    discount` idiom one level up. It is deliberately NOT a set-to-zero: two
    printed tiers meet on this seam and only `noRetreatCostAura`/`noRetreatCostSelf`
    zero the cost outright, so a lone Toedscruel leaves a {C}{C}{C} Active at {C}
    and a second one takes it to nothing THROUGH THE SUM's single floor.

    `sourceOnBench` is the printed "As long as this Pokémon is on your Bench",
    answered by `isOnBench` (D253, seat-blind, so the scan needs no seat it does
    not already have). It gates the SOURCE while the sentence's object scopes the
    TARGET, and on this printing the two zones are DISJOINT — promoting the
    Toedscruel ends the discount for the body it displaces, and the Toedscruel can
    never be its own beneficiary. */
export function alliedRetreatDiscount(state: GameState, pokemon: InPlayPokemon): number {
  const uid = topUid(pokemon);
  if (uid === undefined) return 0;
  for (const seat of SEATS) {
    const side = state.players[seat];
    // The TARGET clause: "your Active Pokémon's Retreat Cost", so a benched
    // holder of this uid is out even though it belongs to this side.
    if (side.active === null || topUid(side.active) !== uid) continue;
    const sources = [side.active, ...side.bench];
    let discount = 0;
    for (const source of sources) {
      const top = topCardOf(state, source);
      const aura = top === undefined ? undefined : programFor(top.id)?.passive?.ownActiveRetreatDiscount;
      if (aura === undefined) continue;
      const sourceUid = topUid(source);
      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue;
      if (aura.sourceOnBench === true && !isOnBench(state, source)) continue;
      discount += aura.amount;
    }
    return discount;
  }
  return 0;
}

/** §11 — is `pokemon` currently held in place by an OPPOSING continuous Ability
    (Snorlax "Block": "As long as this Pokémon is in the Active Spot, your
    opponent's Active Pokémon can't retreat")? The fifth member of the aura-scan
    family (`disabledAbilityUids` / `seatRemovesWeakness` / `hasFreeRetreatAura` /
    `opposingRetreatSurcharge`) and the BOOLEAN cross-board twin of the last of
    those: same derived-seat trick — the caller hands us one of a side's own
    `active`/`bench` entries, so we find that side by top uid and read the OTHER
    one — and the same §9 gate through `disabledAbilityUids`.

    Where the twins part is the Active clauses, and the printed text is the whole
    reason. "Your opponent's Active Pokémon's Retreat Cost is {C} more" scopes only
    the TARGET, so a benched Spidops ex still surcharges; this print OPENS with "As
    long as this Pokémon is in the Active Spot", which scopes the SOURCE as well.
    Both ends are Active here, so the source list is the opponent's Active ALONE
    (a benched Snorlax blocks nothing) and a benched target reads false — which it
    would anyway, a benched Pokémon having no retreat to refuse.

    Read at the RETREAT GATE (turn.ts, mirrored by redact.ts and the web HUD), NOT
    folded into `effectiveRetreatCost`: a block is not a cost. The cost of a
    blocked Active is exactly its printed/modified cost — there is simply no legal
    retreat to spend it on. */
export function opposingRetreatBlocked(state: GameState, pokemon: InPlayPokemon): boolean {
  const uid = topUid(pokemon);
  if (uid === undefined) return false;
  for (const seat of SEATS) {
    const side = state.players[seat];
    // The TARGET clause: only this side's Active is blocked, so a benched holder
    // of this uid is out even though it belongs to this side.
    if (side.active === null || topUid(side.active) !== uid) continue;
    // The SOURCE clause: the opponent's Active Spot and nowhere else.
    const source = state.players[otherSeat(seat)].active;
    if (source === null) return false;
    const top = topCardOf(state, source);
    if (top === undefined || programFor(top.id)?.passive?.preventOpponentActiveRetreat !== true) {
      return false;
    }
    const sourceUid = topUid(source);
    if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) return false;
    return true;
  }
  return false;
}

/** §8.5 (D151) — the HP an OPPOSING continuous Ability takes off every damage
    `pokemon`'s own attack does right now, before Weakness and Resistance (Entei
    sv03-030 "Pressure": "As long as this Pokémon is in the Active Spot, attacks
    used by your opponent's Active Pokémon do 20 less damage (before applying
    Weakness and Resistance)"). The ALWAYS-ON half of D149's attacker-side debuff,
    SUMMED beside `installedAttackDebuffOf` at the same four sites — same printed
    sentence, same step, two sources, one number, which is exactly how
    `passivesOf().damageReductionAfterWR` and `installedReductionOf` already split
    D147's sentence one screen up.

    ⚠️ IT IS `opposingRetreatBlocked`'s SHAPE AND NOT `passivesOf`'s, and that was
    the whole reason D149 scoped it out. `passivesOf` reads the HOLDER's own
    catalog row; this fact belongs to the holder's OPPONENT, so no field on that
    fold could ever have answered it. So it is the SEVENTH member of the aura-scan
    family (`disabledAbilityUids` / `seatRemovesWeakness` / `hasFreeRetreatAura` /
    `opposingRetreatSurcharge` / `opposingRetreatBlocked` / `hasFreeRetreatSelf`)
    and it inherits that family's three answers verbatim rather than inventing new
    ones:
      • the DERIVED SEAT — the caller hands us one of a side's own `active`/`bench`
        entries, so we find that side by top uid and read the OTHER one, which is
        what keeps all four read sites' signatures untouched;
      • BOTH ACTIVE CLAUSES ENFORCED BY THE SCAN, no `activeOnly` field. "As long
        as this Pokémon is in the Active Spot" scopes the SOURCE (a benched Entei
        does nothing — contrast `opposingRetreatSurcharge`, whose print scopes only
        the target) and "your opponent's ACTIVE Pokémon" scopes the TARGET (a
        benched attacker reads 0, which it would anyway, a benched Pokémon having
        no attack to weaken). Both ends are therefore live-read: a Boss's Orders, a
        retreat, or a KO-and-promotion that moves EITHER body out of the Active
        Spot ends the aura on the spot, because every read site passes the CURRENT
        state and nothing is stamped anywhere;
      • the §9 GATE through `disabledAbilityUids`, like every non-lock Ability
        surface. This is the sharpest line between the two halves of the number:
        the aura is an ABILITY and a live Ability-lock silences it, where D149's
        `attackDamageDebuff` is an attack INSTALLATION written onto a record and no
        lock can reach it. That asymmetry is DRIVEN on one board in
        pressureAura.test.ts (a damaged Entei under Ting-Lu ex "Cursed Land" stops
        reducing while the stamp on the same attacker keeps doing so), and it is
        the reason this could never have been a `PassiveEffects` field read through
        the D149 stamp's own reader.

    Returns a NUMBER rather than a boolean, unlike `opposingRetreatBlocked`: the
    print carries an amount. It does NOT sum over a source list, unlike
    `opposingRetreatSurcharge` — the source clause is the opponent's Active ALONE,
    so there is exactly one candidate and a loop would describe a board that cannot
    exist. */
export function opposingAttackDebuff(state: GameState, pokemon: InPlayPokemon): number {
  const uid = topUid(pokemon);
  if (uid === undefined) return 0;
  for (const seat of SEATS) {
    const side = state.players[seat];
    // The TARGET clause: only this side's Active is weakened, so a benched holder
    // of this uid is out even though it belongs to this side.
    if (side.active === null || topUid(side.active) !== uid) continue;
    // The SOURCE clause: the opponent's Active Spot and nowhere else.
    const source = state.players[otherSeat(seat)].active;
    if (source === null) return 0;
    const top = topCardOf(state, source);
    const amount =
      top === undefined ? undefined : programFor(top.id)?.passive?.opponentActiveAttackDebuff;
    if (amount === undefined) return 0;
    const sourceUid = topUid(source);
    if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) return 0; // §9
    return amount;
  }
  return 0;
}

/** §8.5 (D159, widened D254 and D256) — is `pokemon` a BENCHED body shielded from
    all attack damage by one of its OWN side's Pokémon? THREE printed sentences
    now, and the pair that arrived first is the whole reason this function has a
    `scope`:

      • Thundurus sv03-070 "Adverse Weather" — "As long as this Pokémon is in the
        Active Spot, prevent all damage done to your Benched Pokémon by attacks
        from your opponent's Pokémon" (`preventBenchDamageWhileActive`, 1 legal
        printing);
      • Rabsca sv05-024 "Spherical Shield" — "Prevent all damage from and effects
        of attacks from your opponent's Pokémon done to your Benched Pokémon."
        (`preventBenchDamageAndEffects`, 1 legal printing);
      • Shaymin sv10-010/-185 "Flower Curtain" — "Prevent all damage done to your
        Benched Pokémon that don't have a Rule Box by attacks from your opponent's
        Pokémon." (`preventBenchDamageNoRuleBox`, 2 legal printings, D256).

    ⚠️ **D256 IS A THIRD FIELD AND NOT A RIDER ON EITHER OF THE FIRST TWO**, and
    the reason is that its three clauses take one answer from EACH of them and add
    one nobody had printed. It has Rabsca's SOURCE clause (absent), Thundurus's
    HALF (damage only — no effects), and a TARGET clause NEITHER prints ("…that
    don't have a Rule Box"). Two disjoint antecedents on one consequent are two
    fields (D252/D253's rule); three clause-vectors that pairwise disagree are
    three. Merging it into `preventBenchDamageAndEffects` would hand Shaymin a
    status immunity it does not print AND strip the Rule-Box conjunct from the one
    printing that has it.

    ⚠️ **THE TARGET CONJUNCT IS EVALUATED ONCE, OUTSIDE THE SOURCE LOOP, BECAUSE IT
    IS A PROPERTY OF THE DAMAGED BODY AND OF NO SOURCE.** `hasRuleBox` NEGATED, the
    same `cards.ts` predicate `stadiumPreventsDamage` reads on the same seam — and
    that Stadium (Neutralization Zone sv06.5-060, D159) is the only other place in
    the engine where a rule box decides whether attack damage LANDS. The printed
    parenthetical "(Pokémon ex, Pokémon V, etc. have Rule Boxes.)" is REMINDER TEXT
    describing that predicate and encodes no rule of its own; nothing reads it.

    The EIGHTH member of the aura-scan family, and the FIRST that is SAME-SEAT
    CROSS-BODY: `passivesOf` folds the holder's own row, `opposingAttackDebuff` and
    `opposingRetreatBlocked` reach across the table — this one reaches from a side's
    own bodies to that same side's Bench, which is a body `passivesOf` could never
    have been asked about.

    ⚠️ **D254 WIDENED THIS SCAN RATHER THAN ADDING A SECOND ONE, AND THAT WAS THE
    WHOLE SAVING.** The handoff priced Rabsca at four new read-site disjuncts plus a
    new scan. This function was ALREADY the sole funnel at all four damage arms, so
    the second sentence costs the read sites ONE ARGUMENT and no new disjunct —
    the standing "look for an existing sole FUNNEL before adding N parallel gates"
    rule, paying at a site where the funnel had been in place for ninety-five
    slices.

    ⚠️ **WHAT THE TWO SENTENCES SHARE IS THE *TARGET* CLAUSE AND NOTHING ELSE.**
    Both say "your Benched Pokémon". Thundurus scopes its SOURCE to the Active
    Spot; Rabsca scopes its source not at all, so a benched Rabsca shields itself
    and this scan's source set CONTAINS its target set for the first time. That is
    `seatDamageReduction`'s condition, and it is why `scope` is here: a sniped
    Rabsca loses its own shield under Feint Attack, a sniped teammate keeps it.
    ⚠️ **D256 ARRIVES AT THE SAME CONDITION BY A DIFFERENT ROUTE AND NEEDS NO NEW
    ARGUMENT FOR IT.** Shaymin prints no source clause either, so a benched Shaymin
    is inside its own target set **iff it has no Rule Box** — and Shaymin sv10-010
    is a plain Pokémon, so it is. `scope` was already required and `benchShieldGranted`
    already applies it per SOURCE for every field uniformly, so the third field
    inherits the right answer instead of a defaulted one. That uniformity was
    written at D254 explicitly so a third field could not get it wrong by omission,
    and D256 is the slice that collected on it.
    Answered per BOARD rather than per SITE — the two earlier answers in this
    family (D151/D159) were constant per site only because no source could be its
    own target.

    It inherits the family's three answers verbatim rather than inventing new ones:
      • the DERIVED SEAT — the caller hands us one of a side's own `active`/`bench`
        entries, so we find that side by top uid and read only THAT side (not the
        other one, which is the single line that makes this member same-seat). That
        is what keeps all four damage sites' signatures untouched but for `scope`;
      • EVERY CLAUSE ENFORCED BY THE SCAN, no `activeOnly` field on either row.
        Both ends are live-read: a Boss's Orders, a retreat or a KO-and-promotion
        that moves either body ends the shield on the spot, because nothing is
        stamped and every site passes the CURRENT state;
      • the §9 GATE through `disabledAbilityUids`, like every non-lock Ability
        surface — and D254 moves it PER SOURCE rather than per scan, because the
        second sentence can have several sources at once and a lock on one must
        not silence the rest. Thundurus and Rabsca are both reachable (a BASIC and
        a STAGE 1), so an Active Klefki "Mischievous Lock" really does silence
        either and the Bench is exposed again (D113's rule: the reachability
        follows the SOURCE's stage).

    ⚠️ NEITHER SENTENCE FILTERS AN ATTACKER, WHICH IS WHY THIS IS A SCAN AND NOT A
    `preventDamageFrom…` REFINEMENT. §D146's census grouped Thundurus's sentence
    with Dachsbun's and Bellibolt's on the shared string "by attacks from"; its
    object is "your opponent's Pokémon" — every attacker there is, and Rabsca's
    object is the same. The narrowing is entirely on the PROTECTED side, so this
    takes no `attacker` argument at all, and a signature that took one would be
    documenting a filter neither card prints.

    ⚠️ **SOURCES ARE FIRST-MATCH, NOT SUMMED**, unlike `seatDamageReduction` and
    `seatPreWRDamageBonus`: the answer is a BOOLEAN, so a second source cannot add
    anything a first has not already said. That is `preventDamageAndEffects…`'s
    standing rule — a gate that names no VALUE is lossless under OR — and it is why
    two Rabsca in play need no `noStack` reasoning. */
function benchShieldGranted(
  state: GameState,
  source: InPlayPokemon,
  field:
    | "preventBenchDamageWhileActive"
    | "preventBenchDamageAndEffects"
    | "preventBenchDamageNoRuleBox",
  targetUid: string,
  scope: BenchShieldScope,
): boolean {
  const sourceUid = topUid(source);
  // Feint Attack, per SOURCE rather than per site — the D254 line. A source that
  // IS the damaged body is granting an effect "on that Pokémon"; a teammate is
  // not. Vacuous for `preventBenchDamageWhileActive` (its source is an Active and
  // its target a benched body, so the uids can never match) and load-bearing for
  // the two fields below it. Read uniformly so a third field cannot inherit the
  // wrong answer by omission — which is exactly what D256's field then did.
  if (scope === "othersOnly" && sourceUid === targetUid) return false;
  const top = topCardOf(state, source);
  if (top === undefined || programFor(top.id)?.passive?.[field] !== true) return false;
  if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) return false; // §9
  return true;
}

/** Whether the damaged body's OWN contribution to a bench shield counts, which is
    D151's Feint Attack reading ("this attack's damage isn't affected by … any
    other effects on that Pokémon"). `seatDamageReduction`'s parameter, verbatim
    and for its reason: REQUIRED rather than defaulted, so a new read site must say
    which it means instead of inheriting whichever answer was cheaper to write. */
type BenchShieldScope = "all" | "othersOnly";

function benchShieldScan(
  state: GameState,
  pokemon: InPlayPokemon,
  half: "damage" | "effects",
  scope: BenchShieldScope,
): boolean {
  const uid = topUid(pokemon);
  if (uid === undefined) return false;
  // D256 — Shaymin's EXTRA target conjunct, evaluated ONCE on the damaged body
  // because it is a property of that body alone and of no source. `undefined` (an
  // unresolvable top card) counts as HAVING a Rule Box, i.e. NOT shielded, which
  // is `stadiumPreventsDamage`'s conservative direction (`top !== undefined &&
  // !hasRuleBox(top)`) written the other way round.
  const targetTop = topCardOf(state, pokemon);
  const targetHasRuleBox = targetTop === undefined || hasRuleBox(targetTop);
  for (const seat of SEATS) {
    const side = state.players[seat];
    // The TARGET clause, and it is the ONE thing all three printings share: "your
    // BENCHED Pokémon". An Active holder of this uid is out either way.
    if (!side.bench.some((benched) => topUid(benched) === uid)) continue;
    // Thundurus's SOURCE clause: this side's OWN Active Spot and nowhere else —
    // and the DAMAGE half only, because its sentence prints no effects half at
    // all. A widening that let this field reach the effects site would hand
    // Thundurus a status immunity it does not print.
    if (
      half === "damage" &&
      side.active !== null &&
      benchShieldGranted(state, side.active, "preventBenchDamageWhileActive", uid, scope)
    ) {
      return true;
    }
    // Rabsca's SOURCE clause: there isn't one. Every body this side has in play
    // grants it, Active and Bench alike, INCLUDING the damaged body itself —
    // which is why `scope` exists and why an empty Active Spot is no longer a
    // reason to bail out of the scan (it was, while the only source was an
    // Active; that early `return false` was a correct reading of ONE sentence and
    // a bug waiting for the second).
    const holders = side.active === null ? side.bench : [side.active, ...side.bench];
    for (const holder of holders) {
      if (benchShieldGranted(state, holder, "preventBenchDamageAndEffects", uid, scope))
        return true;
      // Shaymin's SOURCE clause is Rabsca's — absent — so it shares that loop
      // rather than getting one of its own. It departs on the two clauses that ARE
      // printed differently, and both are enforced right here:
      //   • the DAMAGE half only ("Prevent all damage done to…", no effects half),
      //     which is Thundurus's answer above and not Rabsca's;
      //   • the NARROWED TARGET ("…that don't have a Rule Box"), the first target
      //     conjunct any member of this family has printed beyond "your Benched".
      if (
        half === "damage" &&
        !targetHasRuleBox &&
        benchShieldGranted(state, holder, "preventBenchDamageNoRuleBox", uid, scope)
      ) {
        return true;
      }
    }
    return false; // this is the Pokémon's own side — no other side can shield it
  }
  return false;
}

export function benchShieldedFromDamage(
  state: GameState,
  pokemon: InPlayPokemon,
  scope: BenchShieldScope,
): boolean {
  return benchShieldScan(state, pokemon, "damage", scope);
}

/** §11 (D254) — is `pokemon` a BENCHED body whose own side refuses attack EFFECTS
    done to it? The other half of Rabsca's one sentence, and the half
    `preventBenchDamageWhileActive` has no share in.

    NO `scope`, and that is a printed distinction rather than an omission: Feint
    Attack scopes "this attack's DAMAGE", so it has nothing to say about a Poison,
    a discard or a forced switch. The one site that calls this passes no opinion
    because there is none to pass.

    🛑 **STRUCTURALLY DEAD AT ITS ONLY READ SITE TODAY, AND WRITTEN ANYWAY.**
    `attackEffectRefused` resolves `state.players[seat].active`, and every op that
    consults that funnel aims at an Active — so the TARGET clause this scan shares
    with its damage twin is false there on every board this engine can reach.
    Guarded for TOTALITY, not for coverage, and carrying NO mutant: an unkillable
    mutant is a corpus defect rather than coverage (D253's rule, second
    application). The day an op aims an effect at a benched body, the refusal is
    already where it belongs. */
export function benchShieldedFromEffects(state: GameState, pokemon: InPlayPokemon): boolean {
  return benchShieldScan(state, pokemon, "effects", "all");
}

/** §11 (D259) — does `seat` have a live "Wide Wall" up, i.e. does EVERY one of that
    seat's Pokémon refuse the effects of a SUPPORTER the opponent plays? Rhyperior
    `sv07-076` "Wide Wall", 1 legal printing:

      "As long as this Pokémon is in the Active Spot, whenever your opponent plays
       a Supporter card from their hand, prevent all effects of that card done to
       all of your Pokémon."

    ⚠️ **IT TAKES A SEAT AND NOT A POKÉMON, WHICH IS THE WHOLE REASON IT IS NOT
    `benchShieldedFromEffects`.** That scan's target clause names a ZONE ("your
    Benched Pokémon"), so it has to be asked per body and has to locate the body's
    side first. This one's target clause names the SIDE and nothing else — "all of
    your Pokémon", Active and Bench alike, INCLUDING Rhyperior itself — so the
    answer is a property of the seat and no `scope` argument is expressible: there
    is no reading under which the source's own body is excluded from its own aura.

    ⚠️ **AND THE SOURCE CLAUSE COLLAPSES THE LOOP TO ONE READ.** "As long as this
    Pokémon is in the Active Spot" means only `side.active` can grant it, so unlike
    `hasFreeRetreatAura` (whose source is any body in play) there is no holder loop
    at all — one Active, one flag, one §9 check. A benched Rhyperior grants nothing,
    which is the observable direction the fixture drives.

    §9-suppressible per SOURCE (`disabledAbilityUids`) like every printed Ability in
    this family: Klefki's lock takes the wall down and the Boss's Orders lands. */
export function seatShieldedFromSupporterEffects(state: GameState, seat: Seat): boolean {
  const active = state.players[seat].active;
  if (active === null) return false;
  const top = topCardOf(state, active);
  if (top === undefined || programFor(top.id)?.passive?.preventSupporterEffectsWhileActive !== true)
    return false;
  const sourceUid = topUid(active);
  return sourceUid === undefined || !disabledAbilityUids(state).has(sourceUid); // §9
}

/** §7.1/§7.4 (D284) — is `seat` barred from playing `klass` cards from hand by
    the OPPONENT'S Active Pokémon right now? Tyranitar `sv09-095` "Daunting Gaze"
    (Item) and Jellicent ex `sv10.5w-045`/`-160`/`-168` "Oceanic Curse" (Item +
    Tool), 4 legal printings.

    🛑 **THE PERSPECTIVE FLIP IS THE ONLY ARITHMETIC HERE, AND IT IS WHY THIS
    TAKES A SEAT RATHER THAN A BODY.** The sentence is printed on the BARRING
    body and reads *"**your opponent** can't play…"*, so the seat that cannot
    play is `otherSeat` of the seat whose Active holds the passive. Asked from
    the barred seat's side — the side every read site is already standing on —
    the flip happens once, here, instead of at each of the four call sites.

    ⚠️ **`seatShieldedFromSupporterEffects`'s SHAPE VERBATIM, INCLUDING WHY IT IS
    A SCAN AND NOT A `passivesOf` FOLD**: that fold takes an `InPlayPokemon` and
    no seat, and this rule's object is the OTHER seat's hand, which no per-body
    fold can name. The source clause *"As long as this Pokémon is in the Active
    Spot"* collapses the holder loop to ONE read — a benched Jellicent bars
    nothing, which is the observable direction the fixtures drive.

    §9-suppressible per SOURCE: both printings are printed Pokémon Abilities, so
    Klefki's lock takes the bar down and the Item lands. */
function handPlayBarredByOpponentActive(
  state: GameState,
  seat: Seat,
  klass: HandPlayClass,
): boolean {
  const barrier = state.players[otherSeat(seat)].active;
  if (barrier === null) return false;
  const top = topCardOf(state, barrier);
  if (top === undefined) return false;
  const classes = programFor(top.id)?.passive?.preventOpponentHandPlay;
  if (classes === undefined || !classes.includes(klass)) return false;
  const sourceUid = topUid(barrier);
  return sourceUid === undefined || !disabledAbilityUids(state).has(sourceUid); // §9
}

/** Is this card an ACE SPEC? (D291) — the engine-side ACE SPEC classifier, the
    mechanism D284 named as missing and Genesect `sv06.5-040` waited seven slices
    for.

    🛑 **A DERIVED READ OVER `Card.rarity`, NOT A NEW `Card` FIELD AND NOT A
    PERSISTED FLAG.** The catalog already carries the label and the engine already
    carries the catalog's `Card`, so the rule needs a PREDICATE, not a byte.

    ⚠️ **THE SUBSTRING TEST IS COPIED, NOT INVENTED**, and copying it is the
    point: `src/features/builder/cards.ts`'s `isAceSpec` has enforced the deck
    validator's one-per-deck ACE SPEC rule off this exact expression since P2. Two
    readings of one label in one repo would be a disagreement no board could show
    you — the engine would let you PLAY a card the builder would not let you DECK.
    ⚠️ **AND IT IS NOT `=== "ACE SPEC Rare"` EVEN THOUGH THE CATALOG IS
    SINGLE-VALUED TODAY.** Remote D1 `luminous`, 2026-08-08: `rarity LIKE '%ACE
    SPEC%'` returns **33 rows under exactly one distinct string**, so the equality
    test would be correct and the substring test is correct for a longer time —
    older fixture spellings and any future "ACE SPEC …" variant read the same.

    `undefined`/`null` rarity is FALSE, which is `handPlayBarred`'s conservative
    direction and what every engine fixture card carries. */
export function isAceSpec(card: Card | undefined): boolean {
  return (card?.rarity ?? "").includes("ACE SPEC");
}

/** §7.1/§7.4 (D291) — is `seat` barred from playing ACE SPEC cards from hand by
    an OPPONENT'S body with a Pokémon Tool attached? Genesect `sv06.5-040` "ACE
    Nullifier", **1 legal printing**.

    🛑 **THE HOLDER LOOP DOES NOT COLLAPSE HERE, AND THAT IS THE WHOLE REASON
    THIS IS NOT `handPlayBarredByOpponentActive` WITH ONE MORE TERM.** Every other
    member of this family prints *"As long as this Pokémon is in the Active
    Spot"*, which means only `side.active` can grant it and the scan is one read.
    This sentence prints *"If this Pokémon has a Pokémon Tool attached"* — a
    HOLDER-STATE clause with NO zone in it — so a BENCHED Genesect wearing a Tool
    bars exactly as hard as an Active one, and the loop must walk Active AND
    Bench. **A WINDOW IS NOT A PREDICATE YOU CAN WIDEN** (D283), read from the
    other side: this window is WIDER than the family's and the difference is a
    whole loop.

    ⚠️ **`tools.length > 0` AND NOT `=== 1`**, D122's finding reused: §7.4 caps a
    Pokémon at one Tool, but the cap is enforced at `attachTool`'s GATE and
    Revavroom ex `sv03-156`'s "Tune-Up" raises it to 4. **A RULE ENFORCED AT A
    GATE IS NOT AN INVARIANT OF THE STATE THE GATE WRITES INTO.**

    §9-suppressible per SOURCE, and per source is load-bearing rather than
    decorative here: with a holder LOOP, Klefki silencing the Active Genesect must
    not silence a second one on the Bench. */
function aceSpecPlayBarredByOpponentBody(state: GameState, seat: Seat): boolean {
  // (the classifier is asked by `aceSpecPlayBarred` below, never here — this
  // half answers about the BOARD alone, so the two terms can be read apart.)
  const foes = state.players[otherSeat(seat)];
  const holders = foes.active === null ? foes.bench : [foes.active, ...foes.bench];
  const silenced = disabledAbilityUids(state);
  for (const holder of holders) {
    const top = topCardOf(state, holder);
    if (top === undefined) continue;
    if (programFor(top.id)?.passive?.preventOpponentAceSpecPlayWhileToolAttached !== true) continue;
    if (holder.tools.length === 0) continue; // the printed window
    const sourceUid = topUid(holder);
    if (sourceUid === undefined || !silenced.has(sourceUid)) return true; // §9
  }
  return false;
}

/** §6.2/§7.1/§7.4 (D292) — is `seat` barred from playing THIS card out of hand
    **because of its RARITY**, with no class word in the question at all?
    Genesect `sv06.5-040` "ACE Nullifier", 1 legal printing, and the reader the
    ENERGY surface asks.

    🛑 **EXTRACTED OUT OF `handPlayBarred`, NOT PARALLELED BESIDE IT.** This is
    literally the third arm of that disjunction, lifted so a caller that has NO
    `HandPlayClass` to offer can still ask it. `handPlayBarred` now CALLS this —
    there is exactly ONE copy of the rarity term in the engine, so a fourth
    rarity-keyed source later is one line HERE and zero at either funnel.

    🛑 **AND THIS IS WHY THE ENERGY SURFACE IS NOT `klass: HandPlayClass | null`.**
    Widening the class parameter would have made `null` a legal argument at all
    SEVEN existing call sites — every one of which has a real class — and a caller
    that passed `null` by accident would silently lose the stamped AND the
    class-continuous terms while still type-checking. That is `handPlayBarred`'s
    own `card?:` argument (D291) with the sign flipped. **AN EXTRACTION CANNOT
    LOSE A TERM; A WIDENED PARAMETER CAN.** The D285 precedent points the same
    way for a different reason (arities differ), but the arities here do NOT
    differ — only the vocabulary does, and that is what makes this an extraction
    rather than a twin.

    ⚠️ **`undefined` IS FALSE**, `isAceSpec`'s conservative direction: an
    unresolvable card is not barred here, and every caller rejects it on its own
    line first. */
export function aceSpecPlayBarred(state: GameState, seat: Seat, card: Card | undefined): boolean {
  return isAceSpec(card) && aceSpecPlayBarredByOpponentBody(state, seat);
}

/** §7.1/§7.2/§7.4 (D283 + D284 + D291) — may `seat` play a `klass` card out of
    hand at all right now? **THE ONE READER EVERY SITE ASKS**, and the whole point
    of it being one: an imposed hand-play bar has THREE sources with nothing in common
    but their consequence — a turn-scoped STAMP written by a resolved attack
    (`GameState.handPlayLockedTurn`, D283), a CONTINUOUS passive read off the
    opponent's Active (`PassiveEffects.preventOpponentHandPlay`, D284) and, since
    D291, a CONTINUOUS passive read off ANY of the opponent's bodies that asks
    about the card's RARITY rather than its class
    (`preventOpponentAceSpecPlayWhileToolAttached`) — and the read sites care
    about none of them.

    🛑 **WIDENED RATHER THAN PARALLELED, WHICH IS D223's FINDING SPENT INSTEAD OF
    RE-LEARNED.** D283 wired three sites to one predicate; a second predicate
    OR'd beside it at each of them would be five ORs (D287 added a site) that
    the compiler cannot audit — a site that forgot one term still type-checks and
    still looks right, and the failure is the silent one where a card is offered
    and then refused, or greyed and legal. **D291 IS THE PAYOFF AND ALSO THE
    TEST**: a THIRD source landed as ONE line here, and the only reason it cost
    anything at all elsewhere is the `card` argument below.

    🛑 **`card` IS REQUIRED AND NOT OPTIONAL, AND THAT IS THE ENTIRE SAFETY
    ARGUMENT FOR THE D291 ARM.** The rarity source needs the card being played;
    the two class sources do not. A `card?:` parameter would let every existing
    call site keep compiling while silently losing the ACE SPEC term — the exact
    "site that forgot one term still type-checks" failure this doc block was
    written about, arriving through the fix for it. Making it required turned
    `tsc -b` into the audit: every caller had to be visited, and `undefined` is a
    legal VALUE that a caller must type out (`rareCandyOptions` does, because Rare
    Candy is an Item and no Rare Candy printing is an ACE SPEC).

    ⚠️ **THERE ARE SEVEN CALLERS — COUNTED, NOT ESTIMATED**: `cardplay.ts`'s
    `playTrainer` (Item/Supporter), `playStadium` (Stadium), `attachTool` (Tool),
    the `rareCandy` ACTION gate (Item) and `rareCandyOptions` (Item, the option
    enumerator behind BOTH mirrors' `rareCandyPlayable`), plus `redact.ts`'s
    `redactedTrainersOf` and `GameHud.tsx`'s `playableTrainers`. ⚠️ The Rare Candy
    pair is TWO sites and not one: the gate refuses the play, the enumerator stops
    OFFERING targets, and D286 measured that greying the row alone would not have
    done the second. ⚠️ The two MIRRORS list no Tool row at all (Tools attach
    by drag), so they ask only the Trainer classes they show — that is a property
    of what those lists SHOW, not a term they are missing. **AND THE ACE SPEC ARM
    REACHES THEM FOR FREE**: both compute `barred` from the card they already
    hold, so an ACE SPEC Item greys itself on both transports with no new field on
    the wire — `RedactedCard` carries no `rarity` and does not need to, because
    `redactedTrainersOf` runs SERVER-side over the full `Card`.

    ⚠️ **HOMED HERE AND NOT IN `types.ts` FOR AN IMPORT-GRAPH REASON, NOT A
    TASTE ONE**: the passive half needs `programFor` (registry.ts) and
    `disabledAbilityUids`, and `registry.ts` already imports `types.ts`, so the
    reader cannot live beside the field it reads. The stamp's arithmetic stayed
    behind (`stampedBarFor`), so neither half moved out of the module that owns
    it. */
export function handPlayBarred(
  state: GameState,
  seat: Seat,
  klass: HandPlayClass,
  card: Card | undefined,
): boolean {
  return (
    stampedBarFor(state, seat, klass) ||
    handPlayBarredByOpponentActive(state, seat, klass) ||
    // 🆕 D292 — the rarity arm is now `aceSpecPlayBarred` (above) rather than
    // spelled inline: the ENERGY surface asks that half WITHOUT a class word, and
    // two copies of one disjunct is exactly the drift this funnel exists to stop.
    aceSpecPlayBarred(state, seat, card)
  );
}

/** §7.5/§10 (D285) — the CONTINUOUS half of the POKÉMON-surface bar, and
    `handPlayBarredByOpponentActive`'s shape one surface over with ONE addition:
    the noun this sentence bars is NARROWED, so the predicate needs the CARD.

    ⚠️ **THE TWO FILTERS ARE READ IN THE PRINTED ORDER AND THE SECOND ONE IS A
    SUBTRACTION.** *"any Pokémon that has an Ability … except for Team Rocket's
    Pokémon"* — `only` must HOLD and `except` must NOT, so a Team Rocket's body
    with an Ability escapes a bar it satisfies the first clause of. An `&&` of
    both would bar it; the fixtures drive that exact body. Both riders are ABSENT
    by default (D135's absent-key rule), so a future printing of the bare noun
    costs no field. */
function pokemonPlayBarredByOpponentActive(
  state: GameState,
  seat: Seat,
  act: PokemonPlayAct,
  card: Card | undefined,
): boolean {
  const barrier = state.players[otherSeat(seat)].active;
  if (barrier === null) return false;
  const top = topCardOf(state, barrier);
  if (top === undefined) return false;
  const bar = programFor(top.id)?.passive?.preventOpponentPokemonPlay;
  if (bar === undefined || !bar.acts.includes(act)) return false;
  if (bar.only !== undefined && !matchesFilter(card, bar.only)) return false;
  if (bar.except !== undefined && matchesFilter(card, bar.except)) return false;
  const sourceUid = topUid(barrier);
  return sourceUid === undefined || !disabledAbilityUids(state).has(sourceUid); // §9
}

/** §7.5/§10 (D285) — may `seat` play `card` out of hand by `act` right now?
    **THE ONE READER BOTH POKÉMON-SURFACE GATES ASK**, and `handPlayBarred`'s twin
    rather than its widening — the two questions have different ARITIES, because
    a Trainer bar names a whole class and this one narrows the noun card by card.

    🛑 **A SECOND FUNNEL AND NOT A SECOND PREDICATE AT EACH SITE**, which is
    D223's finding spent rather than re-learned for the third slice running: both
    sources are OR'd here, so `turn.ts`'s two gates did not have to know there are
    two, and a THIRD source later is one line in this file and zero anywhere else.

    ⚠️ **THE `card` IS THE ONE BEING PLAYED, NOT THE ONE BEING PLAYED ONTO.** On
    the evolve act that distinction is the whole rule: Arbok bars the EVOLUTION
    card leaving hand, so a plain Bulbasaur evolving into an Ability-bearing
    Ivysaur is barred and an Ability-bearing Basic evolving into a plain Stage 1
    is not. `undefined` (an unresolvable card) is FALSE — `handPlayBarred`'s
    conservative direction, and the callers reject an unknown card on their own
    lines anyway.

    ⚠️ **THE STAMPED SOURCE IGNORES `card` AND THAT IS PRINTED, NOT ELIDED.**
    Bronzong's sentence bars *"any Pokémon"* with no narrowing at all, so
    `stampedActBarFor` takes no card; a stamp that had to be filtered would mean
    the record carried a noun phrase, which is what `only`/`except` exist to keep
    out of it. */
export function pokemonPlayBarred(
  state: GameState,
  seat: Seat,
  act: PokemonPlayAct,
  card: Card | undefined,
): boolean {
  return (
    stampedActBarFor(state, seat, act) ||
    pokemonPlayBarredByOpponentActive(state, seat, act, card)
  );
}

/** §11 (D260) — is `pokemon` a member of a printed SUBGROUP that its own side is
    shielding from the effects of attacks? Team Rocket's Articuno `sv10-051`
    "Repelling Veil", 1 legal printing:

      "Prevent all effects of attacks used by your opponent's Pokémon done to your
       Basic Team Rocket's Pokémon. (Existing effects are not removed. Damage is
       not an effect.)"

    ⚠️ **IT IS THE THIRD SHAPE IN THIS FAMILY AND NOT A CASE OF EITHER EXISTING
    ONE, WHICH IS THE ONE PLACEMENT QUESTION THE ROW HAD TO SETTLE BY READING
    SIGNATURES.** `passivesOf` folds PER BODY and takes no seat, so a rule about
    bodies the holder is not cannot ride it (that is `preventAttackEffects`, the
    sibling sentence, one field over). `benchShieldedFromEffects` is the right
    ARITY but the wrong TARGET CLAUSE: its loop requires the shielded body to be
    on the BENCH (`side.bench.some(…)`), and this noun phrase carries no zone word
    at all, so an ACTIVE Team Rocket's Meowth is shielded too. And
    `seatShieldedFromSupporterEffects` takes a SEAT, which cannot express a
    narrowing that is answered per BODY. Hence a fourth member of the aura-scan
    family with the DERIVED SEAT and the per-SOURCE §9 gate inherited verbatim,
    and a `CardFilter` where its neighbours have a hardcoded conjunct.

    ⚠️ **THE FILTER IS DATA AND `matchesFilter` ANSWERS IT — ZERO NEW PREDICATES.**
    The printed *"Basic Team Rocket's"* is a STAGE word conjoined with an OWNER
    PREFIX, which is `matchesFilter`'s `ownerPokemon` arm exactly
    (`{ owner, stage }`, D200's prefix and D245's stage word). An unresolvable top
    card is NOT shielded — `matchesFilter(undefined, …)` is false by its own first
    line, which is `benchShieldScan`'s conservative direction with nothing extra
    written to get it.

    ⚠️ **NO `scope`, AND IT IS UNEXPRESSIBLE RATHER THAN OMITTED.** D254's argument
    scopes a source OUT of its own aura for Feint Attack's sake; that reading is
    about DAMAGE, and this sentence has no damage half. The holder is moreover a
    printed member of its own group (`sv10-051` is a `stage = "Basic"` card named
    `Team Rocket's Articuno`), so a self-excluding reading would contradict the
    print.

    SOURCES ARE FIRST-MATCH: the answer is a BOOLEAN, so a second source cannot add
    what a first has already said (`benchShieldScan`'s standing rule). §9-
    suppressible PER SOURCE, so a lock on one Articuno leaves a second one's aura
    standing. */
export function groupShieldedFromAttackEffects(state: GameState, pokemon: InPlayPokemon): boolean {
  const uid = topUid(pokemon);
  if (uid === undefined) return false;
  const targetTop = topCardOf(state, pokemon);
  for (const seat of SEATS) {
    const side = state.players[seat];
    // The DERIVED SEAT, `benchShieldScan`'s answer: the caller hands us one of a
    // side's own entries, so find that side and read ONLY it. The target clause
    // says "YOUR … Pokémon", so no other side's aura can reach this body.
    const bodies = side.active === null ? side.bench : [side.active, ...side.bench];
    if (!bodies.some((body) => topUid(body) === uid)) continue;
    for (const holder of bodies) {
      const top = topCardOf(state, holder);
      if (top === undefined) continue;
      const filter = programFor(top.id)?.passive?.preventAttackEffectsForGroup;
      if (filter === undefined) continue;
      const sourceUid = topUid(holder);
      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue; // §9
      if (matchesFilter(targetTop, filter)) return true;
    }
    return false; // this is the Pokémon's own side — no other side can shield it
  }
  return false;
}

/** §8.5 (D161) — the HP an OWN-SIDE seat-wide continuous Ability takes off any
    attack damage aimed at `pokemon` right now, AFTER Weakness and Resistance
    (Hariyama sv02-113 "Arm Thrust Practice": "All of your Pokémon take 10 less
    damage from attacks from your opponent's Pokémon (after applying Weakness and
    Resistance)"). SUMMED at the four damage sites beside
    `passivesOf().damageReductionAfterWR` and `installedReductionOf` — one printed
    sentence, one §8.5 step, now THREE sources and still one number, which is the
    split D147 made across the catalog/state boundary widened by one more source
    rather than a fourth channel.

    ⚠️ IT IS `hasFreeRetreatAura`'s SHAPE AND NOT `benchShieldedFromDamage`'s, AND
    THE PRINTED CLAUSES ARE THE WHOLE REASON. Thundurus scopes its SOURCE ("As long
    as this Pokémon is in the Active Spot") and its TARGET ("your BENCHED
    Pokémon"). This sentence scopes NEITHER: a benched Hariyama grants the aura and
    an Active one does, and every one of the seat's Pokémon receives it INCLUDING
    Hariyama itself. Drop the Bench clause from `benchShieldedFromDamage` and you
    still have an Active-only source; what is left once BOTH clauses go is
    `hasFreeRetreatAura` — the per-target own-board scan whose printing ("All of
    your Pokémon that have {P} Energy attached…") opens with the same three words.
    The NINTH member of the aura-scan family (`disabledAbilityUids` /
    `seatRemovesWeakness` / `hasFreeRetreatAura` / `opposingRetreatSurcharge` /
    `opposingRetreatBlocked` / `hasFreeRetreatSelf` / `opposingAttackDebuff` /
    `benchShieldedFromDamage` / this), inheriting its three answers verbatim: the
    DERIVED SEAT (find the side holding this top uid and look for sources only
    there, which keeps all four read sites' signatures untouched), BOTH clauses
    ENFORCED BY THE SCAN rather than by an `activeOnly` field, and the §9 gate
    through `disabledAbilityUids` — this is a printed Pokémon Ability, so only a
    TOP card grants it and a lock silences it.

    SOURCES ARE SUMMED, `opposingRetreatSurcharge`'s answer and not
    `opposingAttackDebuff`'s: two Hariyama in play are two printed effects on a
    board this pool can actually reach (a deck may run four), where D151's source
    clause named the opponent's Active ALONE and a loop would have described a
    board that cannot exist. A first-match scan would silently drop the second.

    ⚠️ `scope` IS REQUIRED, AND IT IS THE ONE THING IN THIS FAMILY THAT ANSWERS PER
    BOARD RATHER THAN PER SITE. Feint Attack's "not affected … by any effects on
    that Pokémon" nulls an aura whose SOURCE is the damaged body and leaves one
    whose source is another body (D151's reading, D159's re-run). Every earlier
    member answered the same way at every site because its source could never BE
    its target — Entei sits in the opponent's Active Spot, Thundurus shields only
    the Bench it is not on. This aura is SELF-INCLUSIVE, so its source set CONTAINS
    its target set, and one printed attack can hit either: a sniped Hariyama has
    the effect on itself and is nulled ("othersOnly"), a sniped TEAMMATE does not
    and the 10 stands ("all"). The parameter is required rather than defaulted for
    D146's reason — a new read site must say which it means instead of inheriting
    whichever answer happened to be cheaper to write.

    🆕 **D321 — FOUR RIDERS ARRIVED WITH THE FIELD'S SECOND AND THIRD SENTENCES
    AND NOT ONE OF THEM REACHED A READ SITE.** Steven's Carbink `sv10-086` "Stone
    Palace" (1 legal printing) and Bouffalant `sv07-119`/`svp-136` "Curly Wall"
    (2) narrow Hariyama's bare sentence in three different places and cap it in a
    fourth, and all four answers are already in this function's hands:

      • BENEFICIARY — "all of your **Steven's** Pokémon" / "all of your **Basic
        {C}** Pokémon" is matched against the body being DAMAGED, which is the
        argument this function opens with. ⚠️ It narrows the TARGET, where
        `seatPreWRDamageBonus`'s identically-named rider narrows the ATTACKER; the
        two fields sit on opposite ends of the damage step and the printed subject
        of "take less" is what the word means here.
      • SOURCE ZONE — "As long as this Pokémon is on your **Bench**" is
        `isOnBench(state, holder)`, D253's predicate, defined in this file for
        Poltchageist's holder-zone gate and seat-blind by construction, so it needs
        no seat this loop does not have. It gates the SOURCE and never the target.
      • "1 OTHER <name> IN PLAY" — the only rider in the family that EXCLUDES the
        source. `BoardCondition.yourNamedPokemonInPlay` would be satisfied by the
        Bouffalant printing the sentence, so a lone Bouffalant would pay 60 where
        the print says 0; `conditionHolds` takes a seat and no uid, and this loop
        is the one place that has the uid.
      • `noStack` — `seatPreWRDamageBonus`'s `capped` ledger, keyed by printed
        Ability name for its reason (two different non-stacking auras still stack
        with each other).

    🛑 **AND THE TWO BOUFFALANT RIDERS ARE EACH OTHER'S CONTROL ON THE ONLY BOARD
    THE CARD IS PLAYED ON.** A second Bouffalant makes the antecedent true for
    BOTH bodies at once, so summing pays 120 and the cap pays 60 — neither rider
    is observable without the other, and one Bouffalant pays nothing at all. */
export function seatDamageReduction(
  state: GameState,
  pokemon: InPlayPokemon,
  scope: "all" | "othersOnly",
): number {
  const uid = topUid(pokemon);
  if (uid === undefined) return 0;
  // D321 — the DAMAGED body's own card, read once. It is what the `beneficiary`
  // clause is matched against and it is the only card in this function that is
  // NOT a source: "all of your Steven's Pokémon TAKE 30 less" narrows who is
  // being hit, where the identically-named rider on the pre-W/R sibling field
  // narrows who is attacking. `undefined` fails every filter, `matchesFilter`'s
  // own conservative direction — an unreadable body is shielded LESS, not more.
  const damagedCard = topCardOf(state, pokemon);
  for (const seat of SEATS) {
    const side = state.players[seat];
    const holders = side.active === null ? side.bench : [side.active, ...side.bench];
    // The TARGET clause: "ALL of your Pokémon" — every body on this side, Active
    // and Bench alike, so membership is the whole of it.
    if (!holders.some((holder) => topUid(holder) === uid)) continue;
    let taken = 0;
    // D321 — the `noStack` ledger, `seatPreWRDamageBonus`'s `capped` Map verbatim:
    // printed Ability name → the largest single contribution seen for it, summed
    // in at the end so a capped key and an uncapped one coexist without either
    // reading the other's rule.
    const capped = new Map<string, number>();
    for (const holder of holders) {
      const sourceUid = topUid(holder);
      // Feint Attack: the damaged body's OWN contribution is an effect on that
      // Pokémon and is the only part of this aura the clause reaches.
      if (scope === "othersOnly" && sourceUid === uid) continue;
      const top = topCardOf(state, holder);
      const aura =
        top === undefined ? undefined : programFor(top.id)?.passive?.seatDamageReductionAfterWR;
      if (aura === undefined) continue;
      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue; // §9
      // The BENEFICIARY clause, on the DAMAGED body and on nothing else. On both
      // narrowed printings the source is itself inside the set it pays, so a
      // build that asked this of `top` instead would be green on every board this
      // pool can build and would still encode the wrong sentence.
      if (aura.beneficiary !== undefined && !matchesFilter(damagedCard, aura.beneficiary)) continue;
      // The SOURCE-ZONE clause — Steven's Carbink's "As long as this Pokémon is on
      // your Bench". It gates where the SOURCE stands and says nothing about the
      // target, so a benched Carbink shields the Active and stops shielding
      // anything the moment it is promoted.
      if (aura.sourceOnBench === true && !isOnBench(state, holder)) continue;
      // The "1 OTHER <name> in play" clause — Bouffalant's, and the one rider that
      // excludes the source itself. Compared by TOP UID because `InPlayPokemon` is
      // rebuilt by value on every damage step, and scanned over THIS side's
      // holders because the printed possessive is "you have".
      const otherNamed = aura.otherNamedInPlay;
      if (
        otherNamed !== undefined &&
        !holders.some(
          (other) =>
            topUid(other) !== sourceUid &&
            matchesFilter(topCardOf(state, other), { kind: "byName", name: otherNamed }),
        )
      ) {
        continue;
      }
      if (aura.noStack === undefined) {
        taken += aura.amount;
        continue;
      }
      capped.set(aura.noStack, Math.max(capped.get(aura.noStack) ?? 0, aura.amount));
    }
    for (const amount of capped.values()) taken += amount;
    return taken; // this is the Pokémon's own side — no other side can shield it
  }
  return 0;
}

/** §8.5 (D243) — the total pre-W/R damage bonus `seat`'s own SEAT-WIDE aura
    Abilities grant to an attack used by `attackerCard`: "Attacks used by your
    [Cynthia's|Hop's] Pokémon do {N} more damage to your opponent's Active Pokémon
    (before applying Weakness and Resistance)". Seven legal printings on three
    sentences (Serperior ex "Regal Cheer" ×3 bare, Cynthia's Roserade "Cheer On to
    Glory" ×2, Hop's Snorlax "Extra Helpings" ×2).

    THE TENTH MEMBER OF THE AURA-SCAN FAMILY (`disabledAbilityUids` /
    `seatRemovesWeakness` / `hasFreeRetreatAura` / `opposingRetreatSurcharge` /
    `opposingRetreatBlocked` / `hasFreeRetreatSelf` / `opposingAttackDebuff` /
    `benchShieldedFromDamage` / `seatDamageReduction` / this), and Hariyama's mirror
    image: same source set (any of the seat's own in-play bodies, Active and Bench
    alike, self-inclusive), same §9 gate, one step earlier in §8.5 and on the other
    sign. It inherits two of that scan's three answers verbatim and DEPARTS on the
    third, each for a printed reason:

      • SOURCES ARE SUMMED — `opposingRetreatSurcharge`'s and `seatDamageReduction`'s
        answer. Four Serperior ex is a legal deck and two in play are two printed
        Abilities; a first-match scan would silently drop the second.
        ⚠️ EXCEPT WHERE THE PRINT SAYS OTHERWISE, which is `noStack` and is the one
        thing in this family no earlier member has needed. "The effect of Extra
        Helpings doesn't stack." caps a KEY (the printed Ability name) at its
        largest single contribution, so two Hop's Snorlax are 30 and a Snorlax
        beside a Roserade is 60. Keyed by NAME and not by a boolean: two different
        non-stacking auras on one board are two different printed effects and each
        stacks with the other.
      • THE SEAT IS PASSED, NOT DERIVED. Every scan above finds the side holding a
        top uid because its callers only have an `InPlayPokemon`; both callers here
        reach it through `attackerPreWRBonus`, which already TAKES the attacking
        seat (a `BoardCondition` is relative to it). `seatRemovesWeakness` is the
        precedent — a seat-taking member of the same family — and deriving one that
        is already in scope would be a second way to answer a settled question.
      • NO `scope` PARAMETER, AND FEINT ATTACK IS THE REASON RATHER THAN AN
        OVERSIGHT. D151's reading nulls "any effects on THAT Pokémon", the body
        being DAMAGED. This aura is an effect on the ATTACKING side and lands on
        the attacker's number — which is precisely why `snipeActive` already KEEPS
        `attackerPreWRBonus` under `ignoreWR` and subtracts only the debuff. The
        `scope` argument `seatDamageReduction` requires exists because its source
        set contains its TARGET set; this one's source set contains its
        BENEFICIARY set, and a beneficiary is not a target.

    `beneficiary` is the printed narrowing on WHOSE ATTACKS get the bonus and is
    matched against `attackerCard` ONLY — never against the source. On all four
    owner-prefixed printings the source is itself a member of the subgroup, so a
    scan that filtered both would be green on every board this pool can build and
    would still encode the wrong sentence. `undefined` (no resolvable attacking
    card) fails every filter, `stadiumPreventsDamage`'s conservative direction. */
export function seatPreWRDamageBonus(
  state: GameState,
  seat: Seat,
  attackerCard: Card | undefined,
  /** D245 — the DEFENDER's card, for the `target` rider (Carracosta "Primal
      Knowledge": *"…do 30 more damage to your opponent's Active **Evolution**
      Pokémon"*). OPTIONAL, and the default is what makes every pre-D245 caller
      byte-identical: an aura with no `target` never reads it, and an aura WITH
      one fails on `undefined` — `beneficiary`'s conservative direction, one line
      down, applied to the other end of the attack. */
  defenderCard?: Card,
): number {
  const side = state.players[seat];
  const holders = side.active === null ? side.bench : [side.active, ...side.bench];
  let total = 0;
  // The `noStack` ledger: printed Ability name → the largest single contribution
  // seen for it. Summed in at the end so a capped key and an uncapped one can
  // coexist on one board without either reading the other's rule.
  const capped = new Map<string, number>();
  for (const holder of holders) {
    const top = topCardOf(state, holder);
    const aura =
      top === undefined ? undefined : programFor(top.id)?.passive?.seatDamageBonusBeforeWR;
    if (aura === undefined) continue;
    const sourceUid = topUid(holder);
    if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue; // §9
    // The BENEFICIARY clause, on the attacker and on nothing else.
    if (aura.beneficiary !== undefined && !matchesFilter(attackerCard, aura.beneficiary)) continue;
    // D245 — the TARGET clause, on the defender and on nothing else. The two
    // riders are independent by construction: no printing carries both, and a
    // build that read one against the other's card would be green on all four
    // owner-prefixed boards (where the attacker is the subgroup) and wrong.
    if (aura.target !== undefined && !matchesFilter(defenderCard, aura.target)) continue;
    if (aura.noStack === undefined) {
      total += aura.amount;
      continue;
    }
    capped.set(aura.noStack, Math.max(capped.get(aura.noStack) ?? 0, aura.amount));
  }
  for (const amount of capped.values()) total += amount;
  return total;
}

/** 🆕 §8.1 (D323) — the SEAT-WIDE **PRIZE BONUS** auras on `seat` that fire for
    the Knock Out of `koCard` (Togekiss `sv08-072` "Wonder Kiss", Hydreigon ex
    `sv10.5w-067`/`-161`/`-169` "Greedy Eater"). `seat` is the PRIZE-TAKING side —
    `otherSeat(ref.seat)` at the one call site — because both sentences are printed
    in the second person about the OPPONENT's dying Pokémon.

    **THE ELEVENTH MEMBER OF THE AURA-SCAN FAMILY** (`disabledAbilityUids` /
    `seatRemovesWeakness` / `hasFreeRetreatAura` / `opposingRetreatSurcharge` /
    `opposingRetreatBlocked` / `hasFreeRetreatSelf` / `opposingAttackDebuff` /
    `benchShieldedFromDamage` / `seatDamageReduction` / `seatPreWRDamageBonus` /
    this), and the FIRST one that is not on the damage pipeline at all.

    🛑 **IT RETURNS THE MATCHING AURAS RATHER THAN A NUMBER, AND THE COIN FLIP IS
    THE REASON.** Every sibling above answers with an `amount` because its whole
    contribution is arithmetic. Wonder Kiss's contribution is *conditional on rng*
    and owes the log an `ABILITY_TRIGGERED` / `ABILITY_COIN_FLIP` pair naming the
    body that flipped — so this scan resolves the BOARD questions (which is all it
    can answer without a state thread) and hands `planPrizes` the survivors, which
    is the only function in the engine allowed to advance the rng on this seam.
    A scan that flipped here would have to return a state, and `continuous.ts` is
    the pure-read half of the engine by construction.

    The clauses, each refused separately and each driven:

      • **`koSpot: "active"`** — Wonder Kiss's *"your opponent's **Active**
        Pokémon"*. Compared against the KO'd seat's Active uid on the PRE-KO state,
        which is what `planPrizes` runs on. ⚠️ Not vacuous: the Checkup and
        mid-turn sweeps pass full boards, so a benched body reaches this scan.
      • **`koTarget`** — Greedy Eater's *"Basic Pokémon"*, matched against the
        DYING card. `undefined` fails every filter (`matchesFilter`'s conservative
        direction, as everywhere in this file) — an unreadable corpse pays no bonus.
      • **`byThisPokemonsAttack`** — Greedy Eater's *"an attack used by **this**
        Pokémon"*. The HOLDER's top uid must equal `attackerUid`, which is
        `undefined` on the Checkup and mid-turn paths and refuses the clause there.
      • **§9** — a `disableAbilities` lock silences the aura like every other
        Ability surface. ⚠️ **AND IT IS OBSERVABLE HERE, WHICH D322 LEARNED THE
        HARD WAY**: the excuse *"no lock in the pool reaches this source"* is a
        claim about the LOCK POPULATION, and Ting-Lu ex `sv02-127` "Cursed Land"
        carries no stage clause at all.
      • **`noStack`** — the printed *"The effect of Wonder Kiss doesn't stack."*
        Keyed on `ability` (the printed name, which this field carries because the
        log needs it), so two Togekiss yield ONE entry and two DIFFERENT capped
        auras would still yield two. ⚠️ **IT CAPS THE ENTRY, NOT THE AMOUNT** —
        which is a stronger statement than the two damage auras' ledger and is
        what the sentence means here: the second Togekiss must not FLIP either, or
        every later coin in the game is drawn from a different rng position. */
export function seatKoPrizeBonuses(
  state: GameState,
  seat: Seat,
  /** The DYING body's top card, for the `koTarget` filter. */
  koCard: Card | undefined,
  /** Was the dying body its seat's ACTIVE, on the pre-KO state? */
  koWasActive: boolean,
  /** The attacking body's uid — `undefined` on the Checkup and mid-turn sweeps. */
  attackerUid: string | undefined,
): { uid: string; bonus: NonNullable<PassiveEffects["koPrizeBonus"]> }[] {
  const side = state.players[seat];
  const holders = side.active === null ? side.bench : [side.active, ...side.bench];
  const entries: { uid: string; bonus: NonNullable<PassiveEffects["koPrizeBonus"]> }[] = [];
  // The `noStack` ledger. It records the ABILITY NAMES already admitted, and the
  // FIRST holder to satisfy every clause is the one that keeps the entry — a
  // largest-wins ledger like the damage auras' would be arithmetic on a set of
  // effects that are not all arithmetic (a flip is not an amount).
  const capped = new Set<string>();
  for (const holder of holders) {
    const top = topCardOf(state, holder);
    const bonus = top === undefined ? undefined : programFor(top.id)?.passive?.koPrizeBonus;
    if (bonus === undefined) continue;
    const sourceUid = topUid(holder);
    if (sourceUid === undefined) continue;
    if (disabledAbilityUids(state).has(sourceUid)) continue; // §9
    if (bonus.koSpot === "active" && !koWasActive) continue;
    if (bonus.koTarget !== undefined && !matchesFilter(koCard, bonus.koTarget)) continue;
    if (bonus.byThisPokemonsAttack === true && sourceUid !== attackerUid) continue;
    if (bonus.noStack === true) {
      if (capped.has(bonus.ability)) continue;
      capped.add(bonus.ability);
    }
    entries.push({ uid: sourceUid, bonus });
  }
  return entries;
}

/** §7.3/§8.5 (D159) — does the in-play STADIUM prevent all attack damage from
    `attacker` to `pokemon` (Neutralization Zone sv06.5-060: "Prevent all damage
    done to Pokémon that don't have a Rule Box (both yours and your opponent's) by
    attacks from the opponent's Pokémon ex and Pokémon V")? The first Stadium read
    on the damage pipeline — `stadiumRetreatDelta` and `effectiveAttackCost` are
    its only siblings and both sit on a COST seam.

    ⚠️ IT IS THE ONE MEMBER OF THIS SLICE THAT IS NOT AN ABILITY, AND THREE THINGS
    FOLLOW FROM THAT ALONE:
      • NO SEAT IS DERIVED. Every aura scan above finds the side holding a uid so
        "your opponent" can be resolved; this print says "both yours and your
        opponent's", so there is no side to find. It is the only prevention in the
        engine that can fire for the player who played the card AND against them
        on the same board;
      • NO §9 GATE. `disabledAbilityUids` suppresses ABILITIES, and a Stadium is
        not one. A Klefki that silences Thundurus one function up leaves this
        untouched, which is the sharpest observable difference between the two;
      • NOT NULLED BY `ignoreWR`. Feint Attack's clause scopes "any effects on that
        Pokémon" — a Stadium is an effect on the shared zone and on no Pokémon at
        all, so it survives where the holder-side preventions do not.

    THE TWO FILTERS ARE THE ENGINE'S EXISTING PREDICATES, on opposite ends of the
    attack: `hasRuleBox` NEGATED on the body being hit (the suffix families ∪ the
    "Radiant " prefix — Artazon's `noRuleBox` search filter, and what the card's own
    reminder text describes) and `isExOrV` on the body hitting it (D107's, narrower
    than `hasRuleBox`: no VMAX/VSTAR/GX). The asymmetry is PRINTED, not chosen — the
    protected side is filtered by rule box, the attacking side by the ex/V pair —
    and a VMAX attacker under this Stadium is the single board that separates the
    two predicates.

    "THE OPPONENT'S Pokémon ex and Pokémon V" needs no seat check: all four callers
    are attack-damage sites aimed at the DEFENDING side, so the attacker is always
    the protected Pokémon's opponent by construction. A `damageSelf` recoil, the one
    way a Pokémon damages its own side, routes through none of them.

    `undefined` (no resolvable attacking card) is FALSE, `preventsAttackerType`'s
    conservative direction verbatim. */
export function stadiumPreventsDamage(
  state: GameState,
  pokemon: InPlayPokemon,
  attacker: Card | undefined,
): boolean {
  if (stadiumEffectsOf(state)?.preventDamageToNoRuleBoxFromExV !== true) return false;
  if (attacker === undefined || !isExOrV(attacker)) return false;
  const top = topCardOf(state, pokemon);
  return top !== undefined && !hasRuleBox(top);
}

/** §11 — is `pokemon`'s Retreat Cost zeroed by its OWN printed passive (Wimpod
    swsh10.5-025 "Punk Out": "If your opponent has any Pokémon V in play, this
    Pokémon has no Retreat Cost")? The SIXTH member of the aura-scan family
    (`disabledAbilityUids` / `seatRemovesWeakness` / `hasFreeRetreatAura` /
    `opposingRetreatSurcharge` / `opposingRetreatBlocked`) and the first that is
    SELF-ONLY: it reads the HOLDER's own passive and merely LOOKS across the table
    to evaluate the condition, so unlike `hasFreeRetreatAura` beside it it never
    touches another Pokémon's cost. The seat is DERIVED exactly as its five
    siblings derive theirs — find the side holding this top uid — purely so "your
    opponent" can be resolved, which is what keeps `effectiveRetreatCost`'s
    signature and ALL FOUR of its readers (turn.ts retreat, redact.ts, attack.ts's
    cost reader, the web HUD) untouched.

    "IN PLAY" MEANS ACTIVE + BENCH. There is no Active clause anywhere in the
    sentence — neither on the holder nor on the opposing V — so a BENCHED opposing
    Pokémon V satisfies it just as an Active one does, and reading it as
    Active-only would be silent. The suffix match is `pokemonSuffixOf`, which
    tests " VMAX"/" VSTAR" before the bare " V", so "Pokémon V" excludes VMAX and
    VSTAR by construction — precisely what the print means.

    The §9 gate is a POSITIVE here: Wimpod is a BASIC, so an Active Klefki
    sv01-096 "Mischievous Lock" really does silence Punk Out and the printed cost
    snaps back (the family's second assertable §9 positive after D113's Snorlax,
    and per D113's rule the reachability follows the SOURCE's stage — here the
    source and the beneficiary are the same card). Deliberately reads only the TOP
    CARD's passive and not attached Tools, unlike `passivesOf`: no Tool in the
    ingested pool grants free retreat, and a future one (Air Balloon) would fold
    the tool list in HERE — un-§9-gated, a Tool being no Ability. */
export function hasFreeRetreatSelf(state: GameState, pokemon: InPlayPokemon): boolean {
  const top = topCardOf(state, pokemon);
  const uid = topUid(pokemon);
  if (top === undefined || uid === undefined) return false;
  const self = programFor(top.id)?.passive?.noRetreatCostSelf;
  if (self === undefined) return false;
  if (disabledAbilityUids(state).has(uid)) return false; // §9
  // 🆕 D322 — Melt Away's HOLDER-side antecedent ("If this Pokémon has no Energy
  // attached"). Read live off the body this scan already holds, and counting
  // ATTACHED CARDS rather than provided units: one Luminous Energy is one
  // attached Energy however many types it pays for.
  if (self.requiresNoEnergyAttached === true && pokemon.energy.length > 0) return false;
  const required = self.requiresOpponentSuffixInPlay;
  if (required === undefined) return true;
  for (const seat of SEATS) {
    const side = state.players[seat];
    const holders = side.active === null ? side.bench : [side.active, ...side.bench];
    if (!holders.some((holder) => topUid(holder) === uid)) continue;
    const foe = state.players[otherSeat(seat)];
    const foeHolders = foe.active === null ? foe.bench : [foe.active, ...foe.bench];
    return foeHolders.some((holder) => {
      const card = topCardOf(state, holder);
      return card !== undefined && pokemonSuffixOf(card) === required;
    });
  }
  return false;
}

/** §11 retreat cost under the continuous effects in play. A "no Retreat Cost"
    effect sets it to zero outright, which is why that tier is read FIRST — a
    set-to-zero beats every ± delta, and it is stage-agnostic where the Stadium
    ones are Basic-only. That tier now has TWO members, an own-board AURA (Lunar
    Zone, which frees every teammate satisfying its clause) and a SELF-only
    conditional (Punk Out, which frees nobody but its holder); either one alone
    zeroes the cost. Otherwise the printed cost is summed with every delta and
    floored ONCE at a free retreat: the in-play Stadium's ±
    Basic deltas (Beach Court's discount subtracts, Calamitous Wasteland's
    surcharge adds, skipping the type its print exempts) plus the opposing side's
    `opponentActiveRetreatSurcharge` auras. Only one Stadium is ever in play
    (§7.3) so its two deltas never actually meet — they are summed anyway so the
    fold stays honest if that changes — but a Stadium and an aura DO meet, which
    is exactly why the floor is applied to the sum rather than per term.

    🆕 D322 — THE FOURTH TERM, and the first NEGATIVE one that is not a Stadium.
    `alliedRetreatDiscount` is Toedscruel's own-side "{C}{C} less", subtracted
    inside the same `Math.max(0, …)` — which is the whole reason it is a term and
    not a tier: a lone Toedscruel facing a Spidops ex leaves a {C}{C}{C} Active at
    {C}{C}, and only the SUM knows that. ⚠️ **AND THE FLOOR IS STILL APPLIED
    ONCE**: three sources on a {C} Active clamp at zero rather than going negative
    and paying an opposing surcharge back out of it. */
export function effectiveRetreatCost(state: GameState, pokemon: InPlayPokemon): number {
  const top = topCardOf(state, pokemon);
  if (top === undefined) return 0;
  if (hasFreeRetreatAura(state, pokemon) || hasFreeRetreatSelf(state, pokemon)) return 0;
  const printed = retreatCostOf(top);
  return Math.max(
    0,
    printed +
      stadiumRetreatDelta(state, top) +
      opposingRetreatSurcharge(state, pokemon) -
      alliedRetreatDiscount(state, pokemon),
  );
}

/** The in-play Stadium's ± contribution to one Pokémon's Retreat Cost. Both
    prints on this seam are Basic-only, so a non-Basic (and a board with no
    Stadium) contributes nothing — note that this is a zero TERM, not the early
    return it used to be: the cross-board auras are stage-agnostic and must still
    reach a Stage 1/2 Active. */
function stadiumRetreatDelta(state: GameState, top: Card): number {
  if (!isBasicPokemon(top)) return 0;
  const stadium = stadiumEffectsOf(state);
  const discount = stadium?.basicRetreatDiscount ?? 0;
  const surcharge = stadium?.basicRetreatSurcharge;
  const exempt =
    surcharge?.excludesType !== undefined && (top.types ?? []).includes(surcharge.excludesType);
  const added = surcharge === undefined || exempt ? 0 : surcharge.amount;
  return added - discount;
}

/** §8.2 — the {C} ADDED to every attack `pokemon` uses by an OPPOSING continuous
    Ability (Seismitoad sv03-052 "Quaking Zone": "As long as this Pokémon is in the
    Active Spot, attacks used by your opponent's Active Pokémon cost {C} more").
    The TENTH member of the aura-scan family and `opposingAttackDebuff`'s twin four
    functions up — the printed sentences differ in exactly one predicate ("do 20
    less damage" / "cost {C} more"), so this is that scan with one field name
    changed, and every one of its three answers is inherited rather than reinvented:
      • the DERIVED SEAT — `effectiveAttackCost` takes no seat, so we find the side
        holding this top uid and read the OTHER one. That is what keeps that
        function's signature, and all THREE of its readers (attack.ts's §8.2
        payability gate, redact.ts's `playable` projection, the web HUD's
        `costMet`), untouched;
      • BOTH ACTIVE CLAUSES ENFORCED BY THE SCAN, no `activeOnly` field. "As long as
        this Pokémon is in the Active Spot" scopes the SOURCE (a benched Seismitoad
        surcharges nothing — contrast `opposingRetreatSurcharge`, whose print scopes
        only the target) and "your opponent's ACTIVE Pokémon" scopes the TARGET.
        Both ends are live-read: a Boss's Orders, a retreat or a KO-and-promotion
        that moves EITHER body out of the Active Spot ends the surcharge on the
        spot, because every read site passes the CURRENT state and nothing is
        stamped;
      • the §9 GATE through `disabledAbilityUids`. Seismitoad is a STAGE 2, so the
        family's usual Klefki witness cannot reach it (D113's rule — the
        reachability follows the SOURCE's stage) and the assertable lock is Ting-Lu
        ex "Cursed Land" against a DAMAGED Seismitoad.

    Does NOT sum over a source list, for `opposingAttackDebuff`'s reason verbatim:
    the source clause is the opponent's Active ALONE, so there is exactly one
    candidate and a loop would describe a board that cannot exist.

    ⚠️ STAGE-AGNOSTIC ON BOTH ENDS, and that is the one line this scan does NOT
    share with the Stadium sitting on the same seam. League HQ prints "each BASIC
    Pokémon in play"; this prints no stage at all — and its own holder is a Stage 2,
    so a fold that kept the Basic test as an early return would have switched this
    aura off for every non-Basic Active it is aimed at. See `effectiveAttackCost`. */
export function opposingAttackCostSurcharge(state: GameState, pokemon: InPlayPokemon): number {
  const uid = topUid(pokemon);
  if (uid === undefined) return 0;
  for (const seat of SEATS) {
    const side = state.players[seat];
    // The TARGET clause: only this side's Active is surcharged, so a benched holder
    // of this uid is out even though it belongs to this side.
    if (side.active === null || topUid(side.active) !== uid) continue;
    // The SOURCE clause: the opponent's Active Spot and nowhere else.
    const source = state.players[otherSeat(seat)].active;
    if (source === null) return 0;
    const top = topCardOf(state, source);
    const amount =
      top === undefined
        ? undefined
        : programFor(top.id)?.passive?.opponentActiveAttackCostSurcharge;
    if (amount === undefined) return 0;
    const sourceUid = topUid(source);
    if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) return 0; // §9
    return amount;
  }
  return 0;
}

/** §8.2 — the {C} SUBTRACTED from every attack `pokemon` uses by its OWN printed
    passive (Radiant Charizard swsh10.5-011 "Excited Heart": "This Pokémon's attacks
    cost Colorless less for each Prize card your opponent has taken"). The
    ELEVENTH member of the aura-scan family, and the SECOND that is SELF-ONLY: like
    `hasFreeRetreatSelf` it reads the HOLDER's own passive and merely LOOKS across
    the table to evaluate its count, so unlike the surcharge above it never touches
    another Pokémon's cost. The seat is DERIVED exactly as its ten siblings derive
    theirs — find the side holding this top uid — purely so "your opponent" can be
    resolved, which is what keeps `effectiveAttackCost`'s signature and all THREE of
    its readers untouched.

    THE COUNT IS `takenPrizes` ON THE HOLDER'S OPPONENT, the function attack.ts
    already calls for the identical printed phrase ("for each Prize card your
    opponent has taken" — the `opponentPrizesTaken` damage-bonus count kind). Six
    minus their remaining pile, read live: it grows the moment they take a Prize and
    it is never stamped anywhere.

    THERE IS NO ACTIVE CLAUSE IN THE SENTENCE, on either end, so the scan enforces
    none — a benched Radiant Charizard's attacks would cost less too, if a benched
    Pokémon could attack. (Contrast the two Active clauses one function up, both of
    which are printed.)

    The §9 gate is a POSITIVE here: Radiant Charizard is a BASIC, so an Active
    Klefki sv01-096 "Mischievous Lock" really does silence Excited Heart and the
    printed {R}{C}{C}{C}{C} snaps back — the family's third assertable §9 positive
    after D113's Snorlax and D114's Wimpod. Reads only the TOP CARD's passive and
    not attached Tools, `hasFreeRetreatSelf`'s reading: no Tool in the pool discounts
    an attack cost, and a future one would fold in HERE, un-§9-gated. */
export function selfAttackCostDiscount(state: GameState, pokemon: InPlayPokemon): number {
  const top = topCardOf(state, pokemon);
  const uid = topUid(pokemon);
  if (top === undefined || uid === undefined) return 0;
  const passive = programFor(top.id)?.passive;
  const perPrize = passive?.attackCostDiscountPerOpponentPrize;
  const perNamed = passive?.attackCostDiscountPerNamedInDiscard;
  const perBenched = passive?.attackCostDiscountPerOpponentBenched;
  if (perPrize === undefined && perNamed === undefined && perBenched === undefined) return 0;
  if (disabledAbilityUids(state).has(uid)) return 0; // §9
  for (const seat of SEATS) {
    const side = state.players[seat];
    const holders = side.active === null ? side.bench : [side.active, ...side.bench];
    if (!holders.some((holder) => topUid(holder) === uid)) continue;
    let discount = 0;
    if (perPrize !== undefined) discount += perPrize * takenPrizes(state, otherSeat(seat));
    if (perNamed !== undefined) discount += perNamed.amount * namedInDiscard(state, seat, perNamed.name);
    if (perBenched !== undefined) discount += perBenched * state.players[otherSeat(seat)].bench.length;
    return discount;
  }
  return 0;
}

/** 🆕 **D327** — how many cards named `name` sit in `seat`'s discard pile, for
    `selfAttackCostDiscount`'s Food Prep summand (*"for each Kofu card in your
    discard pile"*).

    ⚠️ **BY PRINTED NAME, NOT BY ID.** Kofu has TWO Standard-legal printings
    (`sv07-138`/`sv07-165`), and the sentence says "each Kofu card" — so a discard
    holding one of each counts TWO, and an id test would count one. This is the
    same reading `CardFilter`'s `names` member already takes of a printed card
    name everywhere else in the engine.

    ⚠️ **`discard` IS A uid LIST, SO EVERY ENTRY IS RESOLVED THROUGH THE POOL** and
    an unresolvable uid contributes nothing rather than throwing — the totality
    rule every function in this module keeps. */
function namedInDiscard(state: GameState, seat: Seat, name: string): number {
  let count = 0;
  for (const uid of state.players[seat].discard) {
    if (cardOfUid(state, uid)?.name === name) count += 1;
  }
  return count;
}

/** §8.2 attack cost under every continuous cost effect in play. THREE sources,
    TWO SIGNS, one array:
      • the in-play STADIUM's `basicAttackCostSurcharge` (Pokémon League
        Headquarters), which adds {C} per surcharge point to every BASIC's attacks;
      • the OPPOSING side's `opposingAttackCostSurcharge` aura (Seismitoad "Quaking
        Zone"), which adds {C} to the attacks of the Active it faces, at any stage;
      • the holder's OWN `selfAttackCostDiscount` (Radiant Charizard "Excited
        Heart"), which SUBTRACTS {C} per Prize its opponent has taken.
    Every symbol moved is a COLORLESS slot — any energy pays it, §6.4 — which is
    what lets one array carry both signs: `costMet` (attack.ts) buckets the literal
    string "Colorless" separately from every typed symbol, so appending one adds a
    generic slot and removing one takes a generic slot away. A discount never
    touches a typed symbol; the print says "cost Colorless less" and means it.

    ⚠️ THE TWO DIRECTIONS ARE SUMMED INTO ONE NET DELTA AND ARE NEVER ONE FIELD.
    `stadiumRetreatDelta`'s `added - discount` idiom, one seam over, and the reason
    is the same trap D163 hit: a `<= 0` early return on a field that must also carry
    a discount reads a real discount as "nothing applies". The netting is EXACT
    rather than convenient — appending N Colorless and then removing M of them
    leaves `max(0, printedColorless + N - M)` generic slots, which is what applying
    the net delta directly produces — so no board separates the two orders.

    ⚠️ NO FLOOR IS OWED, and this is the sharpest structural difference from
    `effectiveRetreatCost`, which needs its `Math.max(0, …)`. That seam's cost is a
    NUMBER and can be driven negative; this seam's cost is an ARRAY OF SYMBOLS, and
    a removal loop can only remove symbols that are present. A 6-Prize discount
    against a printed {W}{W} leaves {W}{W} — the structure floors itself.

    ⚠️ THE BASIC TEST IS A PER-TERM GATE, NOT THIS FUNCTION'S EARLY RETURN, and that
    is a behaviour change to the Stadium's own neighbourhood rather than a
    refactor. Only League HQ's sentence prints "each Basic Pokémon in play"; the two
    Ability sources print no stage at all, and Seismitoad is itself a Stage 2 — a
    surviving `!isBasicPokemon(top)` early return would have silently switched the
    surcharge off for every Stage 1/2 Active it is aimed at. `stadiumRetreatDelta`
    made exactly this move when the first stage-agnostic aura reached the retreat
    seam ("a zero TERM, not the early return it used to be").

    Returns the printed cost array ITSELF when the net delta is zero, a fresh copy
    when it is not — `redactedAttacksOf` and the HUDs rely on the cheap identity on
    the overwhelmingly common board with no cost modifier in play. */
export function effectiveAttackCost(
  state: GameState,
  pokemon: InPlayPokemon,
  cost: readonly string[],
): readonly string[] {
  const top = topCardOf(state, pokemon);
  if (top === undefined) return cost;
  const stadium = isBasicPokemon(top)
    ? (stadiumEffectsOf(state)?.basicAttackCostSurcharge ?? 0)
    : 0;
  const added = stadium + opposingAttackCostSurcharge(state, pokemon);
  const net = added - selfAttackCostDiscount(state, pokemon);
  if (net === 0) return cost;
  if (net > 0) return [...cost, ...Array.from({ length: net }, () => "Colorless")];
  // The discount, applied from the END of the printed cost so the symbols the
  // player still owes read left-to-right as the card prints them. Self-flooring:
  // `remaining` simply runs out of Colorless to spend itself on.
  let remaining = -net;
  const kept: string[] = [];
  for (const symbol of [...cost].reverse()) {
    if (remaining > 0 && symbol === "Colorless") {
      remaining--;
      continue;
    }
    kept.push(symbol);
  }
  return kept.reverse();
}
