import type { DamageModifier } from "./cards";
import type { Banner } from "./banners";
import type { AttackerClass, CardFilter, PokemonType, StampedPlayLockKey } from "./effectTypes";
import type { CoinFace } from "./rng";
import type { GameOutcome, PokemonTarget, ScheduledEffect, Seat } from "./types";

// GameEvents are semantic "what happened" facts, never rendering instructions; every state change
// the reducer makes is described by the events it returns. Payload arrays are always copies, never
// the state's or the action's own arrays, so a consumer that mutates one cannot reach back into
// game state.

/** Why cards moved deck → hand; lets the UI animate each draw differently.
    "effect" covers any Trainer/Ability draw (Professor's Research, §15.E). */
export type DrawReason = "opening" | "mulligan" | "compensation" | "turnStart" | "effect";

/** The §12 Special Conditions as event vocabulary. The state stores them
    structurally (SpecialConditions: rotation / poisonDamage / burned) — the
    events name them flat, one word per condition. */
export type StatusName = "asleep" | "paralyzed" | "confused" | "burned" | "poisoned";

export type GameEvent =
  | { type: "SHUFFLE"; seat: Seat }
  | { type: "COIN_FLIP"; result: CoinFace; winner: Seat }
  | { type: "FIRST_PLAYER_CHOSEN"; first: Seat; chosenBy: Seat }
  | { type: "CARDS_DRAWN"; seat: Seat; uids: string[]; reason: DrawReason }
  /** A hand with no Basic Pokémon, shown before it is shuffled back (§3.5). */
  | { type: "MULLIGAN_REVEALED"; seat: Seat; hand: string[] }
  /** Setup placement — face-down until SETUP_REVEALED. */
  | { type: "POKEMON_PLACED"; seat: Seat; uid: string; spot: "active" | "bench" }
  /**
   * A Basic played to the Bench (§5.2), or an Antique Fossil played as a Basic (filed right after
   * its `TRAINER_PLAYED`). `actor` is present when the other seat put it there from `seat`'s hand
   * (Mandibuzz "Look for Prey"); `seat` is the owner and the log files the row under the actor.
   */
  | { type: "POKEMON_BENCHED"; seat: Seat; uid: string; actor?: Seat }
  /** §10 — an Evolution card (`to`, now the stack top) was placed on top of
      the in-play Pokémon whose top card was `from`, at `target` on the
      actor's own board. Damage, Energy and Tools carry over (they stay on the
      stack); Special Conditions are removed — a separate STATUS_CLEARED with
      reason "evolved" lists any that were, exactly as retreat announces its
      "benched" clear. */
  | {
      type: "POKEMON_EVOLVED";
      seat: Seat;
      from: string;
      to: string;
      target: PokemonTarget;
    }
  /**
   * §10: the top Evolution card `from` came off `seat`'s in-play Pokémon, leaving `to` on top.
   * Damage, Energy and Tools stay; Special Conditions clear via a separate `STATUS_CLEARED` with
   * reason "devolved". `actor` is carried rather than derived because the devolving player is not
   * necessarily the opponent. `zone` absent means the card was shuffled into the deck (one
   * `SHUFFLE` per sweep); `"hand"` means it went to the hand with no shuffle.
   */
  | {
      type: "POKEMON_DEVOLVED";
      seat: Seat;
      actor: Seat;
      from: string;
      to: string;
      zone?: "hand";
    }
  /** The compensation decision resolving (§3.5) — fires even when the owed
      player declines, because the phase advances either way and an
      event-only consumer must not be left waiting on the prompt. */
  | { type: "COMPENSATION_DECIDED"; seat: Seat; drawn: number; owed: number }
  | { type: "PRIZES_SET"; seat: Seat; uids: string[] }
  | { type: "SETUP_READY"; seat: Seat }
  /** Both players ready: everything flips face-up (§3.9). The board is in
      the state, so the event needs no payload. */
  | { type: "SETUP_REVEALED" }
  | { type: "TURN_STARTED"; turn: number; seat: Seat }
  | { type: "ENERGY_ATTACHED"; seat: Seat; uid: string; target: PokemonTarget }
  /** `retreated`/`promoted` are the top uids of the two stacks that swapped.
      The bench stays dense: the retreater fills the promoted Pokémon's
      `promotedFrom` slot at `benchedTo`. Both indices are in the payload so an
      animator — or a P4 client addressing the bench positionally — never has
      to re-derive the reducer's placement rule. `discardedEnergy` lists the
      cost payment in the order the discard pile gained it (§2 — pile order,
      i.e. attachment order), NOT the order the action named them — the same
      contract as KNOCKED_OUT's `discarded`. */
  | {
      type: "RETREATED";
      seat: Seat;
      retreated: string;
      promoted: string;
      promotedFrom: number;
      benchedTo: number;
      discardedEnergy: string[];
    }
  /**
   * `seat`'s Active declared the attack at flat attack-menu index `index` (printed attacks first,
   * then ones granted by cards under the top or by a Tool); `attack` is that menu row's name and
   * `uid` the attacker's top card. `as` is the copied attack's name when a copy-attack resolved as
   * another Pokémon's attack; it is absent when the copy found or resolved nothing. `attack` stays
   * the copier's name.
   */
  | { type: "ATTACK_DECLARED"; seat: Seat; uid: string; attack: string; index: number; as?: string }
  /**
   * The second half of a resolve-time copy (Haughty Order / Seek Inspiration) resolved as attack
   * `as`. `ATTACK_DECLARED` went out before the reveal or mill, so the copied name rides here;
   * `attack` stays the copier's name. Never emitted on a decline, an empty find or tails.
   */
  | { type: "ATTACK_COPY_RESOLVED"; seat: Seat; uid: string; attack: string; as: string }
  /** The declared attack carries text (or a damage modifier like "60+") the
      engine does not simulate yet — that is M4's effect-op system. The
      numeric base damage still applied; consumers surface the skipped text
      rather than let it be silently guessed (simulator.md coverage
      strategy). */
  | {
      type: "ATTACK_EFFECT_SKIPPED";
      seat: Seat;
      attack: string;
      effect: string | null;
      damageModifier: string | null;
    }
  /**
   * Attack damage on a Pokémon with the §8.5 math spelled out: base, then Weakness, then
   * Resistance, floored at 0. `weakness`/`resistance` are the modifiers as applied, null when they
   * did not apply. `seat`/`uid` name the damaged body, `dealt` what this attack added and `damage`
   * the body's total after.
   */
  | {
      type: "DAMAGE_DEALT";
      seat: Seat;
      /**
       * The seat whose Pokémon dealt this damage (the attacker, or the controller of the Ability
       * that placed it). Not always `otherSeat(seat)`: an attack can damage its own Bench.
       */
      by: Seat;
      uid: string;
      base: number;
      /** HP the attack's own printed damage-scaling clause added to `base`
          BEFORE Weakness/Resistance (Paldean Tauros "Raging Horns" — 10 per
          damage counter on the attacker). Present only when it applied. Distinct
          from `bonus`, a CONTINUOUS effect (Vitality Band); both land at the same
          pre-W/R step. */
      scaled?: number;
      /**
       * Flat HP added before Weakness/Resistance, from always-on effects (Vitality Band and
       * similar) plus attack-installed next-turn buffs. Present only when it applied. One field per
       * step and direction, so it is not attributed per card.
       */
      bonus?: number;
      /**
       * Flat HP taken off the attacker's output before Weakness/Resistance: an installed debuff,
       * its always-on aura twin, or the attack's own "less damage for each damage counter" clause.
       * Present only when it took something off. A separate field rather than a negative `bonus`,
       * and a row may carry both this and `reduction`.
       */
      debuff?: number;
      weakness: DamageModifier | null;
      resistance: DamageModifier | null;
      /** Flat HP the defender's continuous effects removed AFTER Weakness/
          Resistance (Bouffalant "Bouffer", a defending Tool — §15.B).
          Present only when it actually reduced. */
      reduction?: number;
      /**
       * Flat HP added after Weakness/Resistance by an attack-installed next-turn vulnerability on
       * the damaged Pokémon. A separate field from `reduction`; a row may carry both. Present only
       * when it applied.
       */
      vulnerability?: number;
      /** True when the defender fully PREVENTED this attack's damage (Mimikyu
          "Safeguard" — all damage from an opponent's Pokémon ex/V), so `dealt` is
          0 for that reason rather than because the attack does no damage. Present
          only when a prevention actually fired. */
      prevented?: true;
      /**
       * True when a KO-survival effect fired: the full-HP clamp left the defender on 10 HP, or a
       * coin-flip survival saved it on heads. On such a row `damage` is not the previous total plus
       * `dealt`: `dealt` is the pipeline's real output and `damage` the clamped total.
       */
      survived?: true;
      dealt: number;
      damage: number;
    }
  // Special Conditions (§12) and the Checkup (§13): `seat` always owns the affected Pokémon. An
  // attack effect inflicted `status`. `poisonDamage` is present iff poisoned (damage per Checkup)
  // and `confusionDamage` iff confused (self-damage on a failed flip); the producer always writes
  // the rule default when the op does not raise it. A rotation status replaces any previous one
  // with no separate clear event.
  | {
      type: "STATUS_APPLIED";
      seat: Seat;
      uid: string;
      status: StatusName;
      poisonDamage?: number;
      confusionDamage?: number;
    }
  /**
   * §12: a Special Condition was refused by the target's own printed immunity. Fires instead of
   * `STATUS_APPLIED`, with the same `seat`/`uid` contract, and carries the refused `status` so the
   * row says which condition was blocked.
   */
  | { type: "STATUS_PREVENTED"; seat: Seat; uid: string; status: StatusName }
  /**
   * Conditions leaving a Pokémon; `statuses` lists every one actually removed. "benched", "evolved"
   * and "devolved" clear everything (for "evolved" `uid` is the new top card); Checkup recoveries
   * carry exactly one entry; "recovered" is a continuous effect clearing only the conditions it
   * names (Therapeutic Energy), so it may be a subset.
   */
  | {
      type: "STATUS_CLEARED";
      seat: Seat;
      uid: string;
      statuses: StatusName[];
      /**
       * "devolved" is separate from "evolved": §12 names the two events separately and the log
       * credits different players for them.
       */
      reason:
        | "benched"
        | "evolved"
        | "devolved"
        | "wokeUp"
        | "burnCured"
        | "paralysisEnded"
        | "recovered";
    }
  /** §11 — an attack effect locked `seat`'s Active in place ("During your
      opponent's next turn, the Defending Pokémon can't retreat."). Deliberately
      NOT a STATUS_APPLIED: the block is not one of the five §12 conditions, so it
      carries no `StatusName`, shows no status chip and does not gate attacking. */
  | { type: "RETREAT_BLOCKED"; seat: Seat; uid: string }
  /** The §11 retreat block expiring, at the Checkup that ends the blocked
      player's OWN next turn — the §13.4 paralysis lifetime, `seat` being the
      seat whose turn just ended. The block also ends early whenever an effect of
      an attack ends (the Pokémon leaves the Active Spot or evolves); those paths
      stay SILENT, announced by their own POKEMON_SWITCHED/RETREATED/
      POKEMON_EVOLVED row rather than a second one here. */
  | { type: "RETREAT_BLOCK_ENDED"; seat: Seat; uid: string }
  /**
   * §7.1/§7.2: an attack barred `seat` from playing `bars` from hand for their next turn; `seat` is
   * the barred player. No `uid`, because the bar is on the player and survives the Pokémon leaving
   * the Active Spot. No ended event: the turn stamp simply expires.
   */
  | { type: "HAND_PLAY_BLOCKED"; seat: Seat; bars: StampedPlayLockKey }
  /**
   * §11: an attack installed a damage block on its own Active; `seat` owns the shielded Pokémon.
   * `effects` means effects are blocked too. `fromClass` narrows it to a printed attacker class
   * (absent blocks every attacker) and `maxDamage` caps it ("if that damage is 40 or less"). No
   * ended event, and no row when a block fails to match: the turn stamp expires and the early
   * endings have their own rows.
   */
  | {
      type: "ATTACK_BLOCK_APPLIED";
      seat: Seat;
      uid: string;
      effects: boolean;
      fromClass?: AttackerClass;
      maxDamage?: number;
    }
  /**
   * §8/§11: an attack locked a Pokémon out of attacking on its controller's next turn; `seat` owns
   * the locked Pokémon, which may be the attacker's own or the defender. `attack` narrows it to one
   * named attack (absent locks all). `until: "leavesActive"` means it lasts until the body leaves
   * the Active Spot rather than one turn. `flip` means the declaration stays legal but needs a coin
   * (heads) to happen, with `coins: 2` when either of two tails fails it. No ended event.
   */
  | {
      type: "ATTACK_LOCKED";
      seat: Seat;
      uid: string;
      attack?: string;
      until?: "leavesActive";
      flip?: true;
      coins?: 2;
    }
  /**
   * §8.5/§11: an attack installed a next-turn damage reduction on its own Active; `amount` is the
   * merged HP subtracted after Weakness/Resistance. `seat` owns the protected Pokémon. No ended
   * event, and when it bites it is reported through `DAMAGE_DEALT.reduction`.
   */
  | {
      type: "DAMAGE_REDUCTION_APPLIED";
      seat: Seat;
      uid: string;
      amount: number;
      /** The printed attacker class (Metal Block); absent means every attacker. */
      fromClass?: AttackerClass;
    }
  /**
   * §8.5/§11: an attack gave the controller's own Active no Weakness during the opponent's next
   * turn. When it bites, `DAMAGE_DEALT.weakness` is null on that hit.
   */
  | { type: "WEAKNESS_REMOVED"; seat: Seat; uid: string }
  /**
   * §8.5/§11: an attack installed a next-turn debuff on the Defending Pokémon's attack damage
   * (before Weakness/Resistance); `amount` is the merged number. `seat` owns the debuffed Pokémon,
   * which is always the attacker's opponent, so the log must not reuse the installer-voiced "during
   * your opponent's next turn" wording. When it bites it is reported through `DAMAGE_DEALT.debuff`.
   */
  | { type: "ATTACK_DEBUFF_APPLIED"; seat: Seat; uid: string; amount: number }
  /**
   * §8.5/§11: an attack made the Defending Pokémon take more damage (after Weakness/Resistance)
   * during the installer's next turn. `seat` owns the exposed Pokémon and `amount` is the merged
   * number; the paying hit reports it in `DAMAGE_DEALT.vulnerability`.
   */
  | { type: "DAMAGE_VULNERABILITY_APPLIED"; seat: Seat; uid: string; amount: number }
  /**
   * §8.5/§11: an attack changed the Defending Pokémon's Weakness type until the end of the
   * installer's next turn. `seat` owns the marked Pokémon; `weaknessType` is the new type (not
   * `type`, which is the discriminator). `asTimesTwo`: Weakness applies as ×2 (Overwriting Bolt).
   */
  | { type: "WEAKNESS_RETYPED"; seat: Seat; uid: string; weaknessType: string; asTimesTwo?: true }
  /**
   * §8.2/§11: an attack made the Defending Pokémon's attacks and Retreat Cost cost {C} more during
   * its controller's next turn. `seat` owns the taxed Pokémon. A separate event from
   * `ATTACK_LOCKED`, since the body can still attack.
   */
  | { type: "COST_TAX_APPLIED"; seat: Seat; uid: string }
  /**
   * §8.1/§11: an attack set a bounty on the Defending Pokémon: if it is Knocked Out during the
   * installer's next turn, take `amount` more Prize cards. `seat` owns the marked Pokémon; the
   * Knock Out that pays it files `PRIZE_BONUS`.
   */
  | { type: "KO_BOUNTY_APPLIED"; seat: Seat; uid: string; amount: number }
  /**
   * §8/§11: an attack locked a whole side's attacks for that side's next turn; `seat` owns the
   * locked side. No `uid`, because the lock survives every body leaving play. `maxEnergy` is the
   * merged limit.
   */
  | { type: "SIDE_ATTACKS_LOCKED"; seat: Seat; maxEnergy: number | null }
  /**
   * §8.5: a Trainer installed a this-turn side-wide bonus before Weakness/Resistance (Black Belt's
   * Training). `seat` is the installer, whose attacks get it; no `uid`, since a Pokémon promoted
   * later gets it too. `target` is the printed defender filter. Emitted even when no matching
   * Pokémon is Active. `attacker` is the printed attacker filter; absent means every attacker.
   */
  | {
      type: "SIDE_ATTACKS_BOOSTED";
      seat: Seat;
      amount: number;
      target: CardFilter;
      attacker?: CardFilter;
    }
  /**
   * §8.5: a Supporter installed a side-wide damage reduction (after Weakness/Resistance) for the
   * opponent's next turn (Jasmine's Gaze). `seat` is the installer and the shielded side; no `uid`,
   * since a Pokémon that comes into play later is covered too.
   */
  | {
      type: "SIDE_DAMAGE_REDUCTION_INSTALLED";
      seat: Seat;
      amount: number;
      /** The printed holder type (Iron Defender); absent means every Pokémon. */
      pokemonType?: PokemonType;
    }
  /**
   * §11: Acerola's Mischief shielded `seat`'s chosen Pokémon `uid` from the damage and effects of
   * attacks by `fromClass` during the opponent's next turn.
   */
  | { type: "CHOSEN_ATTACK_SHIELD_INSTALLED"; seat: Seat; uid: string; fromClass: AttackerClass }
  /**
   * §11: Roxie's Performance stopped `seat`'s Poisoned Pokémon from retreating during that seat's
   * next turn.
   */
  | { type: "SIDE_RETREAT_LOCKED"; seat: Seat; status: "poisoned" }
  /**
   * §11: an attack installed a side-wide, class-filtered damage block on `seat`'s `banner` Pokémon
   * for the opponent's next turn (Miraidon "C.O.D.E.: Protect"). `uid` is the source Pokémon.
   */
  | {
      type: "SIDE_ATTACK_BLOCK_APPLIED";
      seat: Seat;
      uid: string;
      banner: Banner;
      fromClass: AttackerClass;
    }
  /**
   * §11: the side-wide block ended because its source `uid` left `seat`'s Active Spot ("If this
   * Pokémon is no longer your Active Pokémon, this effect ends.").
   */
  | { type: "SIDE_ATTACK_BLOCK_ENDED"; seat: Seat; uid: string }
  /**
   * §6.2/§11: the Defending Pokémon `uid` (owned by `seat`) was marked for `seat`'s next turn.
   * `barred`: Energy can't be attached to it from hand; `endsTurn`: attaching one from hand ends
   * the turn; `counters`: damage counters placed per Energy attached from hand (0 when none).
   * Carries the merged mark.
   */
  | {
      type: "HAND_ATTACH_MARKED";
      seat: Seat;
      uid: string;
      barred: boolean;
      endsTurn: boolean;
      counters: number;
    }
  /**
   * §7: `seat`'s Trainer plays from hand need a coin flip during its next turn (Seismitoad "Quaking
   * Fist"). `seat` owns the locked side.
   */
  | { type: "TRAINER_FLIP_LOCKED"; seat: Seat }
  /**
   * §7: the Quaking Fist coin `seat` flipped to play Trainer `uid`: heads, the play goes on; tails,
   * the card goes from hand to the discard pile instead.
   */
  | { type: "TRAINER_FLIP_LOCK_CHECK"; seat: Seat; uid: string; result: CoinFace }
  /**
   * §8: `seat` used Backtrack Badge `uid`: the `count` coins just flipped for the attack are
   * flipped again, with the new faces following as their own rows.
   */
  | { type: "COINS_REFLIPPED"; seat: Seat; uid: string; count: number }
  /**
   * `actor` looked at the face-down Prize card in slot `index` of `seat`'s row. Slot only: the log
   * goes to both seats, so naming the card would reveal it; the card reaches the looker through the
   * redacted prompt.
   */
  | { type: "PRIZE_LOOKED_AT"; seat: Seat; actor: Seat; index: number }
  /**
   * §5.3: a Supporter scheduled an end-of-turn hand discard if the hand has at least `atLeast`
   * cards (Amarys). The discard itself is a `HAND_DISCARDED` filed at end of turn.
   */
  | { type: "HAND_DISCARD_SCHEDULED"; seat: Seat; atLeast: number }
  /**
   * §5.3/§8: Festival Lead's attack-again window opened: `seat`'s Active `uid` may declare a second
   * attack this turn or end the turn. Filed after the first attack and any resulting Knock Out are
   * resolved, and only while that declaration is not barred.
   */
  | { type: "ATTACK_AGAIN_OFFERED"; seat: Seat; uid: string }
  /**
   * §13: an attack scheduled a delayed effect (counters, a discard or a Knock Out) onto `seat`'s
   * Active for the end of `scheduled.turn`; `seat` owns the scheduled Pokémon. When it fires it
   * appears as `COUNTERS_PLACED` (`source: "delayed"`), `POKEMON_RETURNED` to discard with no
   * prizes, or `KNOCKED_OUT` with prizes.
   */
  | { type: "EFFECT_SCHEDULED"; seat: Seat; uid: string; scheduled: ScheduledEffect }
  /**
   * §9/§11: an attack armed a next-turn recoil on its own Active: whatever damages it puts `amount`
   * HP of counters on the attacker (merged; HP, not counters). `ofDamageTaken` means the recoil
   * equals the damage taken, with `amount` as a floor. When it fires it is reported as
   * `COUNTERS_PLACED` with `source: "counterattack"`, which sums all recoil sources.
   */
  | { type: "RECOIL_ARMED"; seat: Seat; uid: string; amount: number; ofDamageTaken?: true }
  /**
   * §8.5/§11: an attack installed a damage buff for its own Pokémon; `amount` is the merged HP
   * added before Weakness/Resistance. `attack` names the boosted attack, or `null` when all attacks
   * are boosted. `base` means `amount` is a base-damage override rather than a bonus. `thisTurn`
   * means it applies this turn rather than next. `uid` is the boosted body, which may be the
   * Benched source. When it lands it shows in `DAMAGE_DEALT.bonus` (or `base`).
   */
  | {
      type: "ATTACK_BOOSTED";
      seat: Seat;
      uid: string;
      attack: string | null;
      amount: number;
      base?: true;
      thisTurn?: true;
    }
  /**
   * §11: an attack's effect was refused by a block on the Pokémon it was aimed at; one row per
   * refused op. `seat`/`uid` own the protected Pokémon. Prevented damage is reported by
   * `DAMAGE_DEALT.prevented` instead.
   */
  | { type: "ATTACK_EFFECT_PREVENTED"; seat: Seat; uid: string }
  /**
   * §11: a played Item or Supporter's effect was refused by the target's own Ability (Fraxure
   * "Unnerve", Rhyperior "Wide Wall"). `seat`/`uid` own the shielded body. A separate event from
   * `ATTACK_EFFECT_PREVENTED` because the log names the cause; `trainerType` says which kind was
   * refused.
   */
  | {
      type: "TRAINER_EFFECT_PREVENTED";
      seat: Seat;
      uid: string;
      trainerType: "item" | "supporter";
    }
  /**
   * §11: an effect of the opponent's Pokémon's Ability was refused by the shielded body's own
   * Ability (Mega Clefable ex "Luminous Wing").
   */
  | { type: "ABILITY_EFFECT_PREVENTED"; seat: Seat; uid: string }
  /**
   * Damage counters placed outside the §8.5 pipeline; `amount` is HP and Weakness/Resistance never
   * apply. `seat` owns the damaged Pokémon. `source` says what the log may honestly claim: "self"
   * is the attacker's recoil on itself, "moved" the destination half of a counter move, "attack" an
   * attack's direct placement, and "counterattack" the §9 reactive recoil, which can sum an Ability
   * and a Tool and so names a mechanism rather than a provenance.
   */
  | {
      type: "COUNTERS_PLACED";
      seat: Seat;
      uid: string;
      amount: number;
      source:
        | "poison"
        | "burn"
        | "confusion"
        | "ability"
        | "self"
        | "moved"
        | "attack"
        | "counterattack"
        // Counters an attack scheduled earlier, placed now by the §13 Checkup; distinct from
        // "attack" because it lands between turns.
        | "delayed"
        // Counters an Item put on a body (Team Rocket's Venture Bomb).
        | "trainer";
    }
  /** A §13 Checkup recovery flip for `seat`'s Active: burn's cure flip
      (§13.2) or asleep's wake flip (§13.3). Heads is followed by the
      matching STATUS_CLEARED; tails, the condition stays. */
  | { type: "CHECKUP_COIN_FLIP"; seat: Seat; status: "asleep" | "burned"; result: CoinFace }
  /** The §8 step-3 confusion flip for the declared attack — tails is
      followed by ATTACK_FAILED, heads by the normal resolution. */
  | { type: "CONFUSION_CHECK"; seat: Seat; uid: string; result: CoinFace }
  /**
   * §8: the coin for a flip-to-attack lock on the declared attack: tails is followed by
   * `ATTACK_FAILED` "flipLock", heads by normal resolution. `seat` is the declaring seat. Filed
   * only while the lock is live, and before any `CONFUSION_CHECK`, since effects that cancel an
   * attack apply before the Confusion check; on tails no Confusion check is filed.
   */
  | { type: "ATTACK_FLIP_LOCK_CHECK"; seat: Seat; uid: string; result: CoinFace }
  /**
   * The declared attack did not resolve: no damage to the defender and no effects. The turn still
   * ends, unless the Festival Lead attack-again window opens. "confusion": the §12 flip came up
   * tails and the self-damage follows as `COUNTERS_PLACED`. "requirement": the printed "If …, this
   * attack does nothing." condition held. "coinFlip": the printed "If tails, this attack does
   * nothing." came up tails, preceded by its coin row. "preDamage": the pre-damage act had nothing
   * to discard; no other row is filed.
   */
  | {
      type: "ATTACK_FAILED";
      seat: Seat;
      uid: string;
      /**
       * "flipLock": the flip-to-attack lock's coin came up tails; preceded by
       * `ATTACK_FLIP_LOCK_CHECK`.
       */
      reason: "confusion" | "requirement" | "coinFlip" | "preDamage" | "flipLock";
    }
  /**
   * Damage removed from one of `seat`'s in-play Pokémon (Active or Bench). `amount` is what
   * actually came off, never what was printed; never emitted at 0.
   */
  | { type: "HEALED"; seat: Seat; uid: string; amount: number }
  /**
   * An attack effect's own coin gate: heads runs the gated steps, tails skips them. `seat` is the
   * seat that flipped: the attacker, except when the printed text has the opponent flip.
   */
  | { type: "ATTACK_EFFECT_COIN_FLIP"; seat: Seat; result: CoinFace }
  /**
   * §8.1: `seat`'s `uid` was Knocked Out and its whole stack left play; `discarded` lists every uid
   * that reached the discard pile, in pile order. `toHand` lists cards that went to `seat`'s hand
   * instead (Huntail "Diver's Catch", Gengar "Infinite Shadow"); the two partition the stack.
   */
  | { type: "KNOCKED_OUT"; seat: Seat; uid: string; discarded: string[]; toHand?: string[] }
  /**
   * `seat` owes a §8.1 prize pick, announced when the game parks so an event-only client never
   * hangs on an unseen prompt; the pick may include face-up prizes. Forced picks resolve straight
   * to `PRIZES_TAKEN`.
   */
  | { type: "PRIZES_OWED"; seat: Seat; count: number }
  /**
   * `seat` took prizes into hand. `indices` are the slots picked (the row compacts like the Bench);
   * a slot may be a face-up one. The log stays count-only for every take.
   */
  | { type: "PRIZES_TAKEN"; seat: Seat; uids: string[]; indices: number[]; remaining: number }
  /**
   * `seat` turned the prize at slot `index` face up (Cresselia "Crescent Purge"). The card is
   * public from then on, so the log names it, while `PRIZES_TAKEN` stays count-only so face-up and
   * face-down takes look the same. `actor` is present only when someone else turned it (Team
   * Rocket's Bother-Bot).
   */
  | { type: "PRIZE_TURNED_FACE_UP"; seat: Seat; index: number; uid: string; actor?: Seat }
  /**
   * Redeemable Ticket: `seat`'s `count` prizes were shuffled under the deck and replaced by `count`
   * face-down cards from the top. No uids, since every card involved is hidden; `faceUpPrizes` is
   * emptied.
   */
  | { type: "PRIZES_CYCLED"; seat: Seat; count: number }
  /**
   * Team Rocket's Bother-Bot: in `seat`'s prize row, slot `index` held face-up `prizeUid` and now
   * holds `handUid` (revealed from `seat`'s hand), still face up; `prizeUid` went to `seat`'s hand.
   * `actor` is the controller. Both uids are public.
   */
  | {
      type: "PRIZE_SWITCHED_WITH_HAND";
      seat: Seat;
      actor: Seat;
      index: number;
      prizeUid: string;
      handUid: string;
    }
  /** `seat` must promote a benched Pokémon into the empty Active spot
      (§8.1) — the ko:promote prompt twin of PRIZES_OWED. */
  | { type: "PROMOTION_REQUIRED"; seat: Seat }
  /** `uid` (top of its stack) moved bench → Active; the vacated bench slot
      closes up. */
  | { type: "POKEMON_PROMOTED"; seat: Seat; uid: string; benchIndex: number }
  // Trainer and Ability plays (§7/§9) and the effect ops they run (§15). `seat` played Trainer
  // `uid` from hand. An Item or Supporter discards after its effect (an Antique Fossil lands on the
  // Bench instead, via `POKEMON_BENCHED`); a Stadium moves to the shared zone. Tools use
  // `TOOL_ATTACHED`.
  | { type: "TRAINER_PLAYED"; seat: Seat; uid: string; trainerType: string }
  /** §7.4 — `seat` attached the Pokémon Tool `uid` from hand to their own
      in-play Pokémon at `target`. It stays attached (rides the stack through
      evolution, discards with a KO'd stack) — there is no detach in scope. */
  | { type: "TOOL_ATTACHED"; seat: Seat; uid: string; target: PokemonTarget }
  /**
   * §7.4/§8: Pokémon Tools `uids` left `seat`'s Pokémon for `seat`'s own discard pile. `seat` is
   * the owner and `actor` the controller whose card caused it; the log files under the actor.
   * `host` is the stripped Pokémon's top-card uid, since a Knock Out in the same batch may empty
   * the spot (one row per host). Never emitted for empty `uids`.
   */
  | {
      type: "TOOLS_DISCARDED";
      seat: Seat;
      actor: Seat;
      uids: string[];
      host: string;
      /**
       * When this happened, which the log wording depends on: "preDamage" is the pre-damage hook
       * (pushed before `DAMAGE_DEALT`), "effect" the attack's program tail, "consumed" a consumable
       * Tool discarding itself after its effect, and "trimmed" the owner discarding down to the
       * Multi Adapter cap. Required, so a new producer cannot inherit another's wording silently.
       */
      when: "preDamage" | "effect" | "consumed" | "trimmed";
    }
  /**
   * §7.3: the Stadium `uid` left play for its owner `seat`'s discard pile. `cause` "replaced" is a
   * different-named Stadium played over it (its `TRAINER_PLAYED` is in the same batch); "effect" is
   * the `discardStadium` op, which leaves the zone empty.
   */
  | { type: "STADIUM_DISCARDED"; seat: Seat; uid: string; cause: "replaced" | "effect" }
  /**
   * §7.3: Area Zero Underdepths trim: `seat` discarded Benched Pokémon `uids` (top cards, in Bench
   * order) with every attached card (`discarded`) to get back to 5. No Knock Out and no Prize;
   * filed under the owner, who chose. Never emitted for an empty pick.
   */
  | { type: "BENCH_TRIMMED"; seat: Seat; uids: string[]; discarded: string[] }
  /**
   * Tyme: `seat` told the opponent the name of a Pokémon in their hand; the card stays face down.
   */
  | { type: "POKEMON_NAMED"; seat: Seat; name: string }
  /**
   * Tyme's reveal: `seat`'s named card `uid` has printed HP `hp` (null if none); the opponent
   * guessed `guess`, and `drawer` draws (the opponent when right, `seat` when wrong). Public, since
   * the card is revealed.
   */
  | {
      type: "HP_GUESSED";
      seat: Seat;
      uid: string;
      guess: number;
      hp: number | null;
      right: boolean;
      drawer: Seat;
    }
  /**
   * `seat` (the attacker) used the effect of Supporter `uid` as the attack's effect: from the
   * opponent's revealed hand (Mr. Mime "Look-Alike Show"; the card does not move), or, with
   * `milled`, one discarded from the top of its own deck (Ninetales "Supernatural Shapeshifter").
   */
  | { type: "SUPPORTER_EFFECT_USED"; seat: Seat; uid: string; milled?: true }
  /** `seat` used the Ability named `ability` on their in-play `uid`. */
  | { type: "ABILITY_USED"; seat: Seat; uid: string; ability: string }
  /** §7.3 — `seat` activated the shared Stadium's "once during each player's
      turn" ability (`uid` is the Stadium in the shared zone; `stadium` its name —
      Artazon / Mesagoza / Town Store). Its ops follow in the same batch (and may
      park on a deck-search choice), like ABILITY_USED. */
  | { type: "STADIUM_ABILITY_ACTIVATED"; seat: Seat; uid: string; stadium: string }
  /**
   * §7/§9: a printed hand cost was paid: `uids` left `seat`'s hand to make a play legal. Follows
   * the `TRAINER_PLAYED` or `ABILITY_USED` and precedes what the cost bought. `to` is where they
   * went: the public discard, or hidden under or on top of the deck; the log counts cards either
   * way.
   */
  | {
      type: "HAND_COST_PAID";
      seat: Seat;
      uids: string[];
      to: "discard" | "deckBottom" | "deckTop";
      /**
       * Evidence Gathering: the old top card of the deck, which went to the hand as the paid card
       * went on top. Hidden, so the log counts it.
       */
      took?: string[];
      /**
       * Set when an attack's program made the discard (Skarmory "Steel Cutter", Klefki "Stick 'n'
       * Draw"): it is the attack's effect, not a cost, so the log drops "to pay a cost".
       */
      effect?: true;
    }
  /** A TRIGGERED Ability fired automatically (§9): `seat`'s in-play `uid`
      reached its trigger condition — played to the Bench / evolved (during
      that seat's turn), the Pokémon Checkup (between turns), or being Knocked
      Out (during the OPPONENT's turn, mid-KO-sweep). Unlike ABILITY_USED it is
      not a player action; the ops it runs follow in the same batch (and may
      park on effect:choose for a board or on-KO trigger). */
  | { type: "ABILITY_TRIGGERED"; seat: Seat; uid: string; ability: string }
  /** §9 — a triggered Ability's own "flip a coin" resolving (Glimmora
      "Shattering Crystal", on Knock Out): `seat` owns `uid` (the Pokémon whose
      Ability flipped). Distinct from the attack/Checkup coin-flip events —
      those name their pipeline; this one names the Ability. */
  | { type: "ABILITY_COIN_FLIP"; seat: Seat; uid: string; ability: string; result: CoinFace }
  /** §8.1 — an on-KO Ability prevented the Prize card(s) for `seat`'s Knocked
      Out `uid` (Glimmora "Shattering Crystal" heads): the opponent takes NO
      prize for that Pokémon. Follows the ABILITY_COIN_FLIP row; the takePrizes
      stage for that KO is simply never queued. */
  | { type: "PRIZE_PREVENTED"; seat: Seat; uid: string }
  /**
   * §8.1: an on-KO Ability reduced the Prize cards for `seat`'s Knocked Out `uid` (Munkidori ex "Oh
   * No You Don't"). `by` is how many fewer and `count` what the opponent still takes. Separate from
   * `PRIZE_PREVENTED` because a reduction is not a denial. Follows the `ABILITY_TRIGGERED` row.
   */
  | { type: "PRIZE_REDUCED"; seat: Seat; uid: string; by: number; count: number }
  /**
   * A Prize bonus was added for `seat`'s Knocked Out `uid` (Wonder Kiss, Greedy Eater, a Knock Out
   * bounty, Briar). `seat` is the side that lost the Pokémon, as on PRIZE_REDUCED; `by` is the
   * extra Prizes and `count` the new total. Kept separate from PRIZE_REDUCED so the log can tell
   * which side's effect acted.
   */
  | { type: "PRIZE_BONUS"; seat: Seat; uid: string; by: number; count: number }
  /** The controller's whole hand went to the discard (Professor's Research). */
  | { type: "HAND_DISCARDED"; seat: Seat; uids: string[] }
  /**
   * `seat` moved `uids` from their own hand because the opponent's card told them to, either by
   * their own choice or by a printed predicate. Absent `to` means the discard pile; with `to:
   * "deck"` a real SHUFFLE row follows. The log renders this as a count, so `uids` must never be
   * shown client-side on the deck arm.
   */
  | { type: "FORCED_HAND_DISCARD"; seat: Seat; uids: string[]; to?: "deck" }
  /**
   * A deck search resolved: `uids` moved deck to `dest` (§15.E). `reveal` carries the printed
   * "reveal" clause and is the only thing that lets the log name the cards; without it the row is a
   * count. `"deckTop"` is always a count row because the cards land in a hidden zone.
   */
  | {
      type: "DECK_SEARCHED";
      seat: Seat;
      // `"discard"` (Brilliant Blender): the cards went to the searcher's public discard pile, so
      // the log names them.
      dest: "bench" | "hand" | "deckTop" | "discard";
      uids: string[];
      reveal?: true;
    }
  /**
   * A discard-pile retrieval resolved: `uids` moved discard to `dest` (hand, deck with a trailing
   * SHUFFLE, or Bench). The discard pile is public, so naming the cards leaks nothing. `played:
   * true` marks Caretaker shuffling itself into the deck instead of being discarded.
   */
  | {
      type: "DISCARD_RETRIEVED";
      seat: Seat;
      dest: "hand" | "deck" | "bench";
      uids: string[];
      played?: true;
    }
  /**
   * A look at the top N resolved: `uids` moved deck to `dest`, and the leftovers are shuffled back
   * by a trailing SHUFFLE. Whether the taken cards are shown to the opponent rides `reveal`. Fires
   * even when nothing was taken (`uids: []`), because the look itself is information the opponent
   * is owed. With `dest: "deck"` nothing moves: `uids` were revealed to both players and left in
   * the deck.
   */
  | {
      type: "DECK_TOP_REVEALED";
      seat: Seat;
      /**
       * Absent means the hand. `"deck"` means the cards were revealed and stayed in the deck (later
       * rows may still move some of them).
       */
      dest?: "bench" | "discard" | "deck";
      uids: string[];
      reveal?: true;
      /** Dusk Ball: the window was the bottom of the deck. Absent means the top. */
      from?: "bottom";
      /**
       * Accompanying Flute: `seat` is the deck's owner and `actor` the controller who looked.
       * Present only when the two differ.
       */
      actor?: Seat;
    }
  /**
   * `uids` went from the top of `seat`'s deck to `seat`'s discard pile, top first. A card belongs
   * here when it left the deck without anyone deciding about it (look leftovers, mills). `seat` is
   * the deck's owner and `actor` the player whose card did it; the log forks on `actor === seat`.
   * Fires only with at least one card.
   */
  | { type: "DECK_TOP_DISCARDED"; seat: Seat; actor: Seat; uids: string[] }
  /**
   * `seat` discarded `uids` off the bottom of their own deck (Flustered Leap). A separate event
   * because DECK_TOP_DISCARDED's caption names the top. Fires only with at least one card.
   */
  | { type: "DECK_BOTTOM_DISCARDED"; seat: Seat; uids: string[] }
  /**
   * An effect moved `uids` (Energy cards) between two of `seat`'s in-play Pokémon (§6). `seat`
   * names the board and `actor` the cause; the log forks on `actor === seat`. `fromUid` names the
   * source by uid because it may be Knocked Out in the same reduction, leaving `from` resolving to
   * the wrong Pokémon.
   */
  | {
      type: "ENERGY_MOVED";
      /** The board the Energy moved ON — both endpoints are this seat's. */
      seat: Seat;
      /** The seat whose card caused the move. */
      actor: Seat;
      uids: string[];
      from: PokemonTarget;
      fromUid?: string;
      to: PokemonTarget;
    }
  /**
   * An effect discarded `uids` (Energy cards) off `seat`'s in-play Pokémon at `from`. `seat` owns
   * the Pokémon; `actor` is the controller whose card caused it, which can be either seat. `host`
   * is the Pokémon's top-card uid, since `from` may be empty after a Knock Out in the same batch.
   */
  | {
      type: "ENERGY_DISCARDED";
      seat: Seat;
      actor: Seat;
      uids: string[];
      from: PokemonTarget;
      host: string;
      /**
       * Where the Energy went: absent is `seat`'s discard pile, `"hand"` their hand, `"deck"` their
       * deck (a SHUFFLE row follows). The row still names the cards because they were public on the
       * board when they moved.
       */
      to?: "hand" | "deck";
    }
  /**
   * `seat` shuffled its whole hand (`count` cards) into its deck, usually followed by a separate
   * CARDS_DRAWN. Count-only because the cards are hidden; `count` may be 0.
   */
  | { type: "HAND_SHUFFLED_INTO_DECK"; seat: Seat; count: number }
  /**
   * `seat` shuffled its whole hand (`count` cards) onto the bottom of its deck (Iono). The deck's
   * existing order is untouched. Count-only; `count` may be 0.
   */
  | { type: "HAND_TO_BOTTOM_OF_DECK"; seat: Seat; count: number }
  /**
   * `actor` looked at the top `count` cards of `seat`'s deck and set their order. Count-only so the
   * cards are never published to the other player. Fires even when `count` is 0 or no ordering
   * decision was needed.
   */
  | {
      type: "DECK_TOP_REORDERED";
      seat: Seat;
      actor: Seat;
      count: number;
      /** Absent means the deck's top; `"bottom"` is `reorderTop { from: "bottom" }` (Kofu). */
      end?: "bottom";
    }
  /**
   * `count` cards went from the top of `seat`'s deck to its bottom, shuffled (Deduction Kit).
   * Count-only, and not a SHUFFLE row: the rest of the deck's order is untouched.
   */
  | { type: "DECK_TOP_TO_BOTTOM"; seat: Seat; count: number }
  /** `seat` revealed its whole hand, so every uid is named. `uids` may be empty. */
  | { type: "HAND_REVEALED"; seat: Seat; uids: string[] }
  /**
   * `seat` revealed the `uids` it picked from its hand (Weaponized Swords). The cards stay in the
   * hand. Never emitted for an empty pick.
   */
  | { type: "HAND_CARDS_REVEALED"; seat: Seat; uids: string[] }
  /**
   * One card went from `seat`'s revealed hand to the bottom of `seat`'s deck, chosen by `actor`
   * (the other player). Named because the pick was made in the open.
   */
  | { type: "CARD_TO_BOTTOM_OF_DECK"; seat: Seat; uid: string; actor: Seat }
  /**
   * One card went from `seat`'s revealed hand into `seat`'s deck, chosen by `actor` (Snap
   * Inspection). A SHUFFLE row follows.
   */
  | { type: "HAND_CARD_SHUFFLED_INTO_DECK"; seat: Seat; uid: string; actor: Seat }
  /**
   * One card left `seat`'s hand at random, taken by `actor`, into `seat`'s discard pile or deck (a
   * SHUFFLE follows). Named on both routes: the discard pile is public, and the deck route prints
   * the card as revealed. One row per card; never emitted for an empty hand.
   */
  | { type: "RANDOM_CARD_TAKEN"; seat: Seat; uid: string; actor: Seat; to: "discard" | "deck" }
  /**
   * `actor` chose a random card from `seat`'s hand and `seat` revealed it; the card stayed in the
   * hand (Bother-Bot). Never emitted for an empty hand.
   */
  | { type: "RANDOM_CARD_REVEALED"; seat: Seat; uid: string; actor: Seat }
  /**
   * `actor` chose one card from `seat`'s revealed hand and put it in `seat`'s discard pile.
   * Separate from RANDOM_CARD_TAKEN and FORCED_HAND_DISCARD so the log can say who chose. Named
   * because the hand was revealed and the pick made in the open.
   */
  | { type: "CARD_DISCARDED_FROM_HAND"; seat: Seat; uid: string; actor: Seat }
  /** An effect switched `seat`'s Active with their benched `nowActive`
      (Switch / Boss's Orders gust): the old Active (`wasActive`) went to the
      bench from `fromBench`'s freed slot and landed at `toBench`; the bench
      compacts and the old Active is appended. Conditions cleared on the
      outgoing Active are a separate STATUS_CLEARED reason "benched".
      No energy is paid (not a retreat). */
  | {
      type: "POKEMON_SWITCHED";
      seat: Seat;
      wasActive: string;
      nowActive: string;
      fromBench: number;
      toBench: number;
    }
  /**
   * Palafin "Zero to Hero": `seat`'s body whose top card was `fromUid` now has `toUid` on top, in
   * place (attachments, damage and conditions stay), and `fromUid` went into the deck (a SHUFFLE
   * row follows). Not an evolution, so no evolve trigger fires.
   */
  | { type: "POKEMON_SWAPPED_FROM_DECK"; seat: Seat; fromUid: string; toUid: string }
  /**
   * Ogre's Mask: `seat`'s body whose top card was `fromUid` now has `toUid` from the discard pile
   * on top, in place, and `fromUid` went to the discard pile (no shuffle).
   */
  | { type: "POKEMON_SWAPPED_FROM_DISCARD"; seat: Seat; fromUid: string; toUid: string }
  | {
      type: "POKEMON_RETURNED";
      seat: Seat;
      uid: string;
      actor: Seat;
      /** `"deckTop"`: put on top of the deck with no shuffle. */
      dest: "deck" | "deckTop" | "hand" | "discard";
      uids: string[];
      attachmentsTo?: { dest: "discard"; uids: string[] };
    }
  /** `seat` must resolve a mid-effect decision (the effect:choose prompt) —
      the prompt twin of PRIZES_OWED, so an event-only client never hangs. */
  | { type: "EFFECT_PENDING"; seat: Seat; note: string }
  | { type: "TURN_ENDED"; turn: number; seat: Seat }
  | { type: "GAME_OVER"; outcome: GameOutcome };
