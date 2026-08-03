import {
  ANY_ENERGY,
  cardOfUid,
  energyProvidesOf,
  hpOf,
  isBasicPokemon,
  isSpecialEnergy,
  pokemonSuffixOf,
  retreatCostOf,
  topCardOf,
  topUid,
} from "./cards";
import type { PokemonSuffix } from "./cards";
import type { BasicEnergyType, Card } from "@luminous/schema";
import type { BoardCondition } from "./effects";
import type { PassiveEffects, StadiumEffects } from "./registry";
import { programFor } from "./registry";
import type { AttackBlock, GameState, InPlayPokemon, Seat } from "./types";
import { SEATS, otherSeat } from "./types";

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
      if (auras.some(({ aura, sourceSeat }) => auraSuppresses(aura, sourceSeat, targetSeat, target, top)))
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
    its TOP card's printed passive (Bouffalant "Bouffer") and every attached
    Tool (§7.4) — summed, since each source is its own card effect. The
    Basic-only hpBonus (Bravery Charm) counts only while the top card is a
    Basic: evolving the holder ends it even though the Tool stays attached. A
    Pokémon under an Ability-lock aura (§9 disableAbilities) contributes nothing
    from its own printed passive — that passive IS an Ability — but its attached
    Tools (not Abilities) keep working. */
export function passivesOf(
  state: GameState,
  pokemon: InPlayPokemon,
): {
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
  hpBonus: number;
  /** §9 reactive recoil placed on the ATTACKER when this Pokémon is damaged by
      an attack while Active (Counterattack Quills / Custom Trap) — summed HP.
      `requiresTool` is evaluated HERE against the holder's board (this function
      has the Pokémon), so the attack.ts read site stays a plain number. */
  damageAttacker: number;
  /** §8.5 full damage PREVENTION when the attacker is an ex/V (Mimikyu
      "Safeguard"). The attacker's rule-box class is known only at the read sites,
      so this aggregation just reports whether the holder carries the aura; the
      sites gate it on `isExOrV(attacker)`. */
  preventDamageFromExV: boolean;
} {
  const top = topCardOf(state, pokemon);
  // A locked Pokémon's own printed passive (an Ability) is suppressed; its Tools
  // are not Abilities and keep contributing. The lock aura itself is read by
  // disabledAbilityUids straight off the passive, never here, so this never
  // recurses (disableAbilities carries no field this aggregation consumes).
  const holderUid = topUid(pokemon);
  const disabled = holderUid !== undefined && disabledAbilityUids(state).has(holderUid);
  const sources: (PassiveEffects | undefined)[] = [
    disabled || top === undefined ? undefined : programFor(top.id)?.passive,
    ...pokemon.tools.map((uid) => {
      const id = state.cardIdByUid[uid];
      return id === undefined ? undefined : programFor(id)?.passive;
    }),
  ];
  const isBasic = top !== undefined && isBasicPokemon(top);
  const hasTool = pokemon.tools.length > 0;
  let damageReductionAfterWR = 0;
  let damageBonusBeforeWR = 0;
  let hpBonus = 0;
  let damageAttacker = 0;
  let preventDamageFromExV = false;
  const conditionalDamageBonusBeforeWR: { amount: number; cond: BoardCondition }[] = [];
  const targetConditionalDamageBonusBeforeWR: {
    amount: number;
    targetSuffix: PokemonSuffix;
  }[] = [];
  for (const passive of sources) {
    if (passive === undefined) continue;
    damageReductionAfterWR += passive.damageReductionAfterWR ?? 0;
    damageBonusBeforeWR += passive.damageBonusBeforeWR ?? 0;
    if (passive.damageBonusBeforeWRIf !== undefined)
      conditionalDamageBonusBeforeWR.push(passive.damageBonusBeforeWRIf);
    if (passive.damageBonusBeforeWRIfTarget !== undefined)
      targetConditionalDamageBonusBeforeWR.push(passive.damageBonusBeforeWRIfTarget);
    if (isBasic) hpBonus += passive.basicHpBonus ?? 0;
    if (passive.damageAttacker !== undefined && (passive.damageAttacker.requiresTool !== true || hasTool))
      damageAttacker += passive.damageAttacker.amount;
    if (passive.preventDamageFromExV === true) preventDamageFromExV = true;
  }
  return {
    damageReductionAfterWR,
    damageBonusBeforeWR,
    conditionalDamageBonusBeforeWR,
    targetConditionalDamageBonusBeforeWR,
    hpBonus,
    damageAttacker,
    preventDamageFromExV,
  };
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
    polarity `effects` was chosen under (types.ts `AttackBlock`). */
export function attackBlockOf(
  state: GameState,
  pokemon: InPlayPokemon,
  attacker: Card | undefined,
): AttackBlock | null {
  // No defensive `=== undefined` arm: the field is REQUIRED, and a record
  // written before it existed is retired by MATCH_RECORD_VERSION rather than
  // read benignly here — which is the whole reason that constant was bumped
  // (D124's rule, and its argument against exactly this kind of soft landing).
  const block = pokemon.attackBlock;
  if (block === null || block.turn !== state.turn) return null;
  // The unfiltered reading — every printing D142 mapped, and the ABSENT key that
  // makes an older persisted block read back as exactly what it used to mean.
  if (block.fromClass === undefined) return block;
  return attacker !== undefined && attackerMatchesClass(attacker, block.fromClass) ? block : null;
}

/** Does `attacker` belong to the printed CLASS a filtered block names? The whole
    of D146's predicate, and deliberately an EXHAUSTIVE `switch` over a one-member
    union rather than an `if`: the union (`AttackBlock["fromClass"]`) is the closed
    vocabulary D120 requires of a token that varies, and this switch is what makes
    "closed" a compiler fact instead of a comment — widen the union and tsc
    demands the arm that reads the new member.

    `Basic` is `isBasicPokemon` VERBATIM (cards.ts), the same reuse D107's
    `isExOrV` is under at the sites beside this one: the printed phrase "attacks
    from Basic Pokémon" is the same claim the setup placement and the bench play
    make about a card in hand, and a second reading of "Basic" would be a second
    chance to disagree with §3.6/§5.2 about what one is. Note it is read off the
    ATTACKER's TOP card (its current identity, §1.2) — a Basic that has evolved is
    a Stage 1 and its attacks are no longer refused, which is what the printed
    word means and is why the call sites pass a resolved top card rather than a
    stack. */
function attackerMatchesClass(
  attacker: Card,
  cls: NonNullable<AttackBlock["fromClass"]>,
): boolean {
  switch (cls) {
    case "Basic":
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
export function installedRecoilOf(state: GameState, pokemon: InPlayPokemon): number {
  // No defensive `=== undefined` arm, for `attackBlockOf`'s reason above: the
  // field is REQUIRED and a record written before it existed is retired by
  // MATCH_RECORD_VERSION rather than read benignly here (D124's rule).
  const installed = pokemon.installedRecoil;
  return installed === null || installed.turn !== state.turn ? 0 : installed.amount;
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

/** §8/§11 (D154) — WHICH of `pokemon`'s attacks is barred right now ("During your
    next turn, this Pokémon can't use {AttackName}."), as an index into the
    stack-top card's `attacks`, or `null` when none is. The ONE read of
    `InPlayPokemon.lockedAttack`, and `attackLocked`'s sibling one function up in
    every respect except its return type: the field holds a turn STAMP beside the
    address, so the bar is live iff that stamp is the turn now being played, and a
    bar whose window has passed stops answering without anyone having cleared it.

    ⚠️ IT RETURNS THE INDEX RATHER THAN A PREDICATE, AND THAT IS THE ONE PLACE
    THIS FAMILY'S READER SHAPE HAD TO MOVE. `attackLocked` returns a boolean
    because there is ONE fact and nothing to carry (D104's minimal shape); here the
    fact IS an address, and every caller has a candidate index in hand and wants to
    know whether it is the barred one. Returning `boolean` from a
    `(state, pokemon, index)` signature would have been the other shape and is
    refused for one observable reason: `redactedAttacksOf` and GameHud both build
    their rows by mapping over the whole `attacks` array, so a per-index predicate
    would be called once per attack and re-read the same field N times, while the
    §8 gate would call it once — three sites, two access patterns, one field. An
    index answers both in one read.

    ⚠️ AND THIS IS THE FIELD THAT ANSWERS §D152's SHAPE TRIGGER, WITH A "NO".
    D152 retired the count trigger for the `attackBlock` union and replaced it with
    *a member the read site must DISPATCH on rather than SUM* — naming this record's
    `{ turn, attackIndex }` as the case. It is genuinely not a sum: the three
    callers COMPARE the index. But no site DISPATCHES either, and that is the
    difference a union would have to pay for. Every read site in this family knows
    which rider it wants BEFORE it looks — this function is the only reader of this
    field and it asks for exactly one kind — so a union would turn a checked field
    access into a `find` over a list whose other members it must then discard. The
    trigger that would earn it is a caller that receives a rider whose KIND it does
    not know, i.e. an ENUMERATION; §D147's trigger (a) (a printing that REMOVES the
    effects of attacks) is still the only forecast producer of one, and the pool
    still prints none. Full argument in decisions.md D154.

    NO PROVENANCE CHANNEL, for `attackLocked`'s reason verbatim: it is read from
    `attack.ts`'s §8 gate and from the two payability projections, all of which are
    by construction about declaring an ATTACK, so there is exactly one kind of
    thing it can refuse and nothing to disambiguate. */
export function lockedAttackIndex(state: GameState, pokemon: InPlayPokemon): number | null {
  // No defensive `=== undefined` arm, for `attackBlockOf`'s reason two functions
  // up: the field is REQUIRED and a record written before it existed is retired
  // by MATCH_RECORD_VERSION rather than read benignly here (D124's rule).
  const locked = pokemon.lockedAttack;
  return locked === null || locked.turn !== state.turn ? null : locked.attackIndex;
}

/** §8.1 max HP as the KO check and the HUD must read it: the printed hp plus
    any continuous bonus (Bravery Charm). A null printed hp is the catalog
    data gap (cards.ts hpOf) and STAYS null — a bonus on top of unknown HP is
    still unknown, and a data gap never KOs. */
export function effectiveMaxHp(state: GameState, pokemon: InPlayPokemon): number | null {
  const top = topCardOf(state, pokemon);
  const hp = top === undefined ? null : hpOf(top);
  if (hp === null) return hp;
  const { hpBonus } = passivesOf(state, pokemon);
  return hp + hpBonus;
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
  return pokemon.energy.flatMap((uid) => unitsOf(state, uid, specialUids));
}

/** The units ONE attached Energy provides, on the Pokémon it is attached to —
    the per-card half of `providedEnergy` above, split out so the `providesEnergy`
    CardFilter (interpreter.ts) reads provision through the SAME code the §8.2
    cost matcher does. Two readers of one rule: an Energy that can pay a {L} cost
    is exactly an Energy a "discard a {L} Energy" effect may take, and letting
    those two drift would let a Kilowattrel pay {L} with a card the very same
    attack then refuses to discard. */
export function unitsProvidedBy(state: GameState, pokemon: InPlayPokemon, uid: string): string[] {
  return unitsOf(state, uid, specialEnergyUids(state, pokemon));
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
  energy: BasicEnergyType | "special",
): boolean {
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
  energy: BasicEnergyType | "special" | null,
): number {
  if (energy === null) return pokemon.energy.length;
  if (energy === "special") return specialEnergyUids(state, pokemon).length;
  return pokemon.energy.filter((uid) => providesEnergyType(state, pokemon, uid, energy)).length;
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
    pile" / "in your hand"). An empty board counts 0. */
export function countEnergyInPlay(
  state: GameState,
  seat: Seat,
  energy: BasicEnergyType | "special",
): number {
  const side = state.players[seat];
  const holders = side.active === null ? side.bench : [side.active, ...side.bench];
  let total = 0;
  for (const holder of holders) {
    total +=
      energy === "special"
        ? specialEnergyUids(state, holder).length
        : holder.energy.filter((uid) => providesEnergyType(state, holder, uid, energy)).length;
  }
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

function unitsOf(state: GameState, uid: string, specialUids: readonly string[]): string[] {
  const card = cardOfUid(state, uid);
  if (card === undefined) return ["Colorless"]; // unresolved uid — the conservative unit
  const program = programFor(card.id)?.energy;
  // Basic energy → its type; an unauthored special energy → Colorless.
  if (program === undefined) return [energyProvidesOf(card)];
  const demote = program.demoteWithOtherSpecial;
  return demote !== undefined && specialUids.some((other) => other !== uid)
    ? [...demote]
    : [...program.provides];
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
    satisfies the clause. */
export function hasFreeRetreatAura(state: GameState, pokemon: InPlayPokemon): boolean {
  const uid = topUid(pokemon);
  if (uid === undefined) return false;
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
    `disabledAbilityUids` (§9) like every non-lock Ability surface. */
export function opposingRetreatSurcharge(state: GameState, pokemon: InPlayPokemon): number {
  const uid = topUid(pokemon);
  if (uid === undefined) return 0;
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
      const amount =
        top === undefined ? undefined : programFor(top.id)?.passive?.opponentActiveRetreatSurcharge;
      if (amount === undefined) continue;
      const sourceUid = topUid(source);
      if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) continue;
      added += amount;
    }
    return added;
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
    const amount = top === undefined ? undefined : programFor(top.id)?.passive?.opponentActiveAttackDebuff;
    if (amount === undefined) return 0;
    const sourceUid = topUid(source);
    if (sourceUid !== undefined && disabledAbilityUids(state).has(sourceUid)) return 0; // §9
    return amount;
  }
  return 0;
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
    is exactly why the floor is applied to the sum rather than per term. */
export function effectiveRetreatCost(state: GameState, pokemon: InPlayPokemon): number {
  const top = topCardOf(state, pokemon);
  if (top === undefined) return 0;
  if (hasFreeRetreatAura(state, pokemon) || hasFreeRetreatSelf(state, pokemon)) return 0;
  const printed = retreatCostOf(top);
  return Math.max(
    0,
    printed + stadiumRetreatDelta(state, top) + opposingRetreatSurcharge(state, pokemon),
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

/** §8.2 attack cost under the in-play Stadium's continuous effects: Pokémon
    League Headquarters adds {C} per surcharge point to every Basic's attacks
    (a Colorless slot — any energy pays it, §6.4). Returns the printed cost
    array itself when nothing applies, a fresh copy when something does. */
export function effectiveAttackCost(
  state: GameState,
  pokemon: InPlayPokemon,
  cost: readonly string[],
): readonly string[] {
  const top = topCardOf(state, pokemon);
  if (top === undefined || !isBasicPokemon(top)) return cost;
  const surcharge = stadiumEffectsOf(state)?.basicAttackCostSurcharge ?? 0;
  if (surcharge <= 0) return cost;
  return [...cost, ...Array.from({ length: surcharge }, () => "Colorless")];
}
