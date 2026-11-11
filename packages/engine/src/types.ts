import type { Card } from "@colorless/schema";
import type { Banner } from "./banners";
import type {
  AttackerClass,
  CardFilter,
  HandPlayClass,
  PokemonPlayAct,
  PokemonType,
  StampedPlayLockKey,
} from "./effectTypes";
import type { DrawReason, GameEvent, StatusName } from "./events";
import type { EffectContinuation, EffectPrompt } from "./effectPrompt";
import type { AbilityProgram } from "./programTypes";
import type { RngState } from "./rng";

// The whole GameState is a plain JSON-safe value — no classes, no Date, no
// functions — so snapshots serialize, replay and structurally share. Nothing
// in the engine ever mutates a state it was given; reducers build the next
// state out of spreads over the old one.

export type Seat = "p1" | "p2";

/** Seat labels are NOT turn order — the coin-flip winner chooses who goes
    first (rules §3.3), recorded in `GameState.firstPlayer`. */
export const SEATS: readonly Seat[] = ["p1", "p2"];

export function isSeat(value: unknown): value is Seat {
  return value === "p1" || value === "p2";
}

export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** `seat` itself, or its opponent when the op's seat field names the other side. */
export function relativeSeat(seat: Seat, opponent: boolean): Seat {
  return opponent ? otherSeat(seat) : seat;
}

// Rule constants (docs/reference/ptcg-rules.md §2–§3).
/**
 * The seat whose turn number `state.turn` is: odd turns belong to firstPlayer. Null before the
 * first turn. At the Checkup it is still the ended turn's owner.
 */
export function turnOwnerOf(state: GameState): Seat | null {
  if (state.turn < 1 || state.firstPlayer === null) return null;
  return state.turn % 2 === 1 ? state.firstPlayer : otherSeat(state.firstPlayer);
}

export const DECK_SIZE = 60;
export const HAND_SIZE = 7;
export const PRIZE_COUNT = 6;
export const BENCH_MAX = 5;
/**
 * §7.3: the largest Bench any card can grant (Area Zero Underdepths: 8). `BENCH_MAX` stays the
 * rule; the live per-seat limit is `benchLimitOf`. This bounds what a ref may address, never what a
 * seat may hold.
 */
export const BENCH_CEILING = 8;

/** §12: one damage counter is 10 HP. */
export const HP_PER_COUNTER = 10;

export function damageCountersOn(pokemon: InPlayPokemon): number {
  return Math.floor(pokemon.damage / HP_PER_COUNTER);
}

/** §13.1: the HP a Burned Pokémon takes at each Checkup (2 counters). */
export const BURN_DAMAGE = 20;

/** §12/§13.1 — the HP a Poisoned Pokémon takes at each Checkup unless the
    inflicting effect raised it ("put N damage counters … instead of 1"). */
export const DEFAULT_POISON_DAMAGE = 10;

/**
 * §8 step 3: HP a Confused Pokémon places on itself when the attack flip is tails, unless the
 * inflicting effect raised it (3 counters).
 */
export const DEFAULT_CONFUSION_DAMAGE = 30;

/**
 * §12: Asleep, Paralyzed and Confused are mutually exclusive (applying one replaces the others);
 * Poisoned and Burned coexist with each other and with them. Poison stores its counter amount,
 * which effects can raise; 0 means not Poisoned. `confusionDamage` is a pure amount, meaningful
 * only while Confused, and rewritten on every application.
 */
export interface SpecialConditions {
  rotation: "none" | "asleep" | "paralyzed" | "confused";
  /** Damage placed on it at each Checkup while Poisoned; 0 = not Poisoned. */
  poisonDamage: number;
  burned: boolean;
  /**
   * HP this Pokémon places on itself when the Confusion flip misses; meaningful only while
   * `rotation === "confused"`.
   */
  confusionDamage: number;
}

export function noConditions(): SpecialConditions {
  return {
    rotation: "none",
    poisonDamage: 0,
    burned: false,
    // Reset to the default, not zero, since a cured body must go back to the rulebook's 3 counters.
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
    switch (ops/board.ts) so the ordering can't drift between them. */
export function presentStatuses(conditions: SpecialConditions): StatusName[] {
  const statuses: StatusName[] = [];
  if (conditions.rotation !== "none") statuses.push(conditions.rotation);
  if (conditions.poisonDamage > 0) statuses.push("poisoned");
  if (conditions.burned) statuses.push("burned");
  return statuses;
}

/**
 * §11: an attack-installed block on one Pokémon. `effects` widens what is refused; `fromClass`
 * narrows whose attacks are refused. `turn` is the one turn the block is live on, so it expires by
 * arithmetic with no clear. Not a Special Condition; it ends when the Pokémon leaves the Active
 * Spot or evolves (§10).
 */
export interface AttackBlock {
  /** The single turn number this block is live on (the installing turn + 1). */
  turn: number;
  /**
   * Also refuses the effects of attacks, not only their damage ("from and effects of"). Damage is
   * not an effect, and placed damage counters count as effects.
   */
  effects: boolean;
  /**
   * The printed attacker-class filter ("from {class} Pokémon"); absent when every attacker is
   * refused. Resolved against the attacker at read time, since the attacker is unknown at install.
   */
  fromClass?: AttackerClass;
  /**
   * The printed damage cap ("if that damage is N or less"); absent when any size is refused.
   * Compared against the damage that would actually be placed, after Weakness, Resistance and
   * reductions.
   */
  maxDamage?: number;
}

/**
 * §8.5: an attack-installed damage reduction on one Pokémon for the opponent's next turn ("takes N
 * less damage … after applying Weakness and Resistance"). Summed at the damage sites with the
 * `passivesOf` reduction, but kept out of `passivesOf` because an installation must be immune to §9
 * Ability locks.
 */
export interface DamageReduction {
  /** The single turn number this reduction is live on (the installing turn + 1). */
  turn: number;
  /** HP subtracted from attack damage after Weakness and Resistance. */
  amount: number;
  /**
   * The printed attacker class ("from Evolution Pokémon"); absent when every attack is reduced. An
   * unreadable attacker gets no reduction.
   */
  fromClass?: AttackerClass;
}

/**
 * The damage attacks dealt one Pokémon on one turn, for "if this Pokémon was damaged by an attack
 * during your opponent's last turn" effects.
 */
export interface AttackDamageTaken {
  /** The turn the damage was dealt on. */
  turn: number;
  /**
   * The `dealt` of the damage events, not lowered when a survival effect leaves fewer counters on
   * the body.
   */
  amount: number;
}

/**
 * The Prize cards one seat took on its own turn, for Okidogi "Settle the Score". Written by
 * `resolveTakePrizes`.
 */
export interface PrizesTakenOnTurn {
  /** The turn the Prizes were taken on. */
  turn: number;
  /** How many Prize cards the seat took on that turn. */
  count: number;
}

/**
 * §13: a delayed effect scheduled onto one Pokémon by an attack, fired by the Checkup at the end of
 * the opponent's next turn. Discard and Knock Out are separate payloads because only a Knock Out
 * awards a Prize (§8.1). Required rather than optional: a missing `kind` would read as counters
 * with an undefined amount and silently make the body un-KO-able.
 */
export type ScheduledEffect =
  /** Damage counters to place, in HP (counters × 10). */
  | { turn: number; kind: "counters"; amount: number }
  /** Discards the body and its attachments to its owner's discard pile; no Prize is taken. */
  | { turn: number; kind: "discard" }
  /** Knocks the body out (§8.1), including the Prize. */
  | { turn: number; kind: "knockOut" };

/**
 * §8.5: an attack-installed debuff on the Defending Pokémon's attacks ("do N less damage before
 * applying Weakness and Resistance"). Kept separate from `attackerPreWRBonus` because the bonus is
 * reported only when positive, is suppressed by Ability locks, and never needs a clamp at zero.
 */
export interface AttackDamageDebuff {
  /**
   * The single turn this debuff is live on: the installing turn + 1, the victim's own next turn.
   */
  turn: number;
  /**
   * HP subtracted from this Pokémon's attack damage before Weakness and Resistance. Applies to
   * every target, the Bench included, since the printed sentences name none.
   */
  amount: number;
}

/**
 * §8.5: an attack-installed next-turn vulnerability ("takes 50 more damage … after applying
 * Weakness and Resistance"), added where installed reductions are subtracted. Stamped for the
 * installer's next turn, so the holder can retreat or switch out of it.
 */
export interface DamageVulnerability {
  /** The single turn this is live on: the installing turn + 2, the installer's own next turn. */
  turn: number;
  /** HP ADDED to every attack's damage to this Pokémon AFTER Weakness and
      Resistance — the printed parenthetical. On a ×2 Weakness body the two
      placements differ: a 60 hit plus 50 is `60 × 2 + 50 = 170` here and would
      be `(60 + 50) × 2 = 220` pre-W/R (driven, `damageVulnerability.test.ts`). */
  amount: number;
}

/**
 * §8.5: an attack-installed Weakness retype ("the Defending Pokémon's Weakness is now {C}"); the
 * printed amount is kept. Stamped for the installer's next turn, the only turn a Weakness step can
 * reach the body.
 */
export interface WeaknessRetype {
  /** The single turn number the retype is live on — the installing turn + 2. */
  turn: number;
  /** The type the body's Weakness now names. */
  type: string;
  /**
   * Pikachu "Overwriting Bolt": the printed Weakness entries are replaced by one ×2 entry, so a
   * body with no Weakness gains one. Absent keeps the printed amount.
   */
  asTimesTwo?: true;
}

/**
 * §8.1: an attack-installed Knock Out bounty ("if the Defending Pokémon is Knocked Out, take 2 more
 * Prize cards"), read only by `koPrizeBonus`. Stamped for the installer's next turn, so the holder
 * can retreat or switch out of it.
 */
export interface KoBounty {
  /** The single turn this bounty is live on — the installing turn + 2, the INSTALLER's
      own next turn. A Knock Out of the holder at ANY point of that turn pays it (R1:
      any cause), EXCEPT in the Checkup that ends it (flow.ts's `checkup` flag). */
  turn: number;
  /** Prize cards ADDED to the holder's face value when it is Knocked Out in the window —
      the printed "2 more". */
  amount: number;
}

/**
 * §8: an attack-installed attack lock on a player's whole side for one turn. On the side rather
 * than a body because the printed reminder covers Pokémon that come into play later.
 */
export interface SideAttackLock {
  /** The single turn this lock is live on — `+ 2` for the self form (the installer's
      own next turn), `+ 1` for the opponent form (the opponent's next turn). */
  turn: number;
  /** `null` — EVERY Pokémon on the side is locked ("your Pokémon can't attack"). A number — only a body
      with AT MOST that many Energy CARDS attached is locked ("2 or less Energy attached"),
      counted LIVE at each declaration through `countAttachedEnergy(…, null)` (R4):
      attaching a third Energy unlocks the body on the same turn. */
  maxEnergy: number | null;
}

/**
 * §8.5: a side-wide post-Weakness damage reduction for the opponent's next turn (Jasmine's Gaze,
 * Iron Defender). On the side so it covers Pokémon that come into play later; not shed by
 * switching. Entries are summed.
 */
export interface SideDamageReduction {
  /** The single turn this reduction is live on — the installer's opponent's next turn. */
  turn: number;
  /** HP subtracted after Weakness and Resistance (the printed 30). */
  amount: number;
  /**
   * The printed holder type ("all of your {M} Pokémon"); absent means every Pokémon on the side.
   */
  pokemonType?: PokemonType;
}

/**
 * §11: a side-wide, class-filtered next-turn damage block (Miraidon "C.O.D.E.: Protect"). `banner`
 * is read live off the damaged body. The effect ends if the source leaves the Active Spot: cleared
 * on `switchInto` and re-checked at read time, since a read-time check alone would revive it after
 * a gust and re-promotion. A second install overwrites.
 */
export interface SideAttackBlock {
  /** The single turn this block is live on — the installer's opponent's next turn. */
  turn: number;
  /** The installing body's top-card uid (the printed "this Pokémon" of the terminator). */
  sourceUid: string;
  /** The printed defender banner ("each of your Future Pokémon"). */
  banner: Banner;
  /** The printed attacker class ("by attacks from Pokémon ex"). */
  fromClass: AttackerClass;
}

/**
 * §11: a Supporter-installed next-turn shield on one chosen body (Acerola's Mischief), keyed by its
 * base uid. It is not an attack effect, so it follows the Pokémon through switching and evolution
 * and ends only when it leaves play. A second install overwrites.
 */
export interface ChosenAttackShield {
  /** The single turn this shield is live on — the installer's opponent's next turn. */
  turn: number;
  /** The chosen body's BASE card uid (`stack[0]`), stable through evolution and devolution. */
  uid: string;
  /** The printed attacker class ("by your opponent's Pokémon ex"). */
  fromClass: AttackerClass;
}

/**
 * §11: a Supporter-installed next-turn retreat lock on the opponent's Poisoned Pokémon (Roxie's
 * Performance), checked against live conditions. Retreat only; switch effects ignore it. A second
 * install overwrites.
 */
export interface SideRetreatLock {
  /** The single turn this lock is live on — the installer's opponent's next turn. */
  turn: number;
  /** The printed Special Condition a body must have to be locked ("their Poisoned Pokémon"). */
  status: "poisoned";
}

/**
 * §6.2: the Defending Pokémon's next-turn hand-attach mark, live on the victim's own turn. `barred`
 * refuses Energy attached from hand (Glimmora); `endsTurn` ends the turn after such an attach
 * (Hypno); `tripped` carries that through an effect's hand attach to `settleProgram`. A second
 * install merges; shed by §10 like other attack effects.
 */
export interface HandAttachMark {
  /** The single turn this mark is live on — the installer's opponent's next turn. */
  turn: number;
  barred: boolean;
  endsTurn: boolean;
  tripped: boolean;
  /**
   * Damage counters placed per Energy card attached from the victim's hand (Pachirisu "Electrified
   * Incisors"); 0 when the mark prints none. A second install sums.
   */
  counters: number;
}

/**
 * §9: an attack-installed reactive recoil for the opponent's next turn ("if this Pokémon is damaged
 * by an attack, put N damage counters on the Attacking Pokémon"). Added to
 * `passivesOf().damageAttacker` at the recoil site, but kept out of `passivesOf` so Ability locks
 * do not suppress it.
 */
export interface InstalledRecoil {
  /** The single turn number this recoil is live on (the installing turn + 1). */
  turn: number;
  /**
   * The minimum HP placed on the Attacking Pokémon, in HP. "Even if this Pokémon is Knocked Out"
   * needs no field because the recoil runs before the KO sweep.
   */
  amount: number;
  /**
   * Set when the recoil equals the damage done to this Pokémon: it is then `Math.max(amount, damage
   * dealt)`. Kept as a separate flag rather than a string in `amount`, since `amount` is summed
   * numerically.
   */
  ofDamageTaken?: true;
}

/**
 * §8: an attack-installed lock on one specific attack ("During your next turn, this Pokémon can't
 * use {AttackName}"). The body holds a list because two writers can stamp the same turn. Kept
 * separate from `attackLockedTurn` because both can hold on one body at once.
 */
export interface LockedAttack {
  /**
   * The single turn this lock is live on. When `until` is set it is the installing turn and no
   * reader compares it.
   */
  turn: number;
  /**
   * Which printed attack is barred, as an index into the top card's `attacks`, resolved from the
   * printed name at install. Borrowed attack rows are barred by `attackName` instead.
   */
  attackIndex: number;
  /**
   * How long the bar lasts when it is not a next-turn window: `"leavesActive"` means it holds until
   * the Pokémon leaves the Active Spot (Gouging Fire ex "Blaze Blitz"). Absent means the next-turn
   * window.
   */
  until?: "leavesActive";
  /**
   * The barred attack's printed name, set only for a borrowed attack (Memory Dive or Technical
   * Machine) that the holder does not print. Such entries have `attackIndex: -1` and are matched by
   * name via `lockedAttackNames`, because the attack menu can change between reads.
   */
  attackName?: string;
}

/**
 * An attack-installed damage buff on one Pokémon for its owner's next turn (§8.5): either extra
 * damage before Weakness and Resistance, or a replacement base damage (`base`). Kept separate from
 * `LockedAttack` because the §8 gate refuses a locked index while a boosted one must stay usable.
 */
export interface BoostedAttack {
  /**
   * The single turn this buff is live on: the installing turn + 2 for an attack (the holder's next
   * turn), or the installing turn itself for a "during this turn" Ability.
   */
  turn: number;
  /**
   * Which attack is boosted, as an index into the stack-top card's `attacks`, or `null` for every
   * attack.
   */
  attackIndex: number | null;
  /**
   * Damage added before Weakness and Resistance, so it is multiplied by Weakness (§8.5). Never
   * negative, so it needs no clamp. A base-set record stores 0 here.
   */
  amount: number;
  /**
   * The printed base damage that replaces the attack's base for the window ("…attack's base damage
   * is 240"); Weakness and Resistance still apply after it. Present only on a base-set record. A
   * second install on the same attack keeps the larger `amount` and `base`.
   */
  base?: number;
}

/**
 * The attack this Pokémon last used and the turn it used it, for "If this Pokémon used X during
 * your last turn" (§8). Stored by name rather than index because the body may evolve and renumber
 * its attacks before the record is read.
 */
export interface UsedAttack {
  /** The PRINTED attack name, byte for byte off the catalog — the token the
      clause key carries. */
  name: string;
  /** The turn number the attack was declared on. */
  turn: number;
}

/** An in-play Pokémon is a stack of physical cards, not one card (§1.2):
    the top uid defines its identity (name, HP, retreat cost, …); damage,
    energy and tools persist through evolution. */
export interface InPlayPokemon {
  /** Card uids, bottom → top. */
  stack: string[];
  /** Attached Energy uids. */
  energy: string[];
  /** Attached Pokémon Tool uids. */
  tools: string[];
  /** HP of damage taken (counters × 10). */
  damage: number;
  conditions: SpecialConditions;
  /**
   * §11: an attack effect stops this Pokémon retreating during the opponent's next turn. Not a
   * Special Condition. Only the opponent-installed lock lives here; the self-installed one is
   * `retreatLockedTurn`, so always read through `retreatLocked`.
   */
  retreatBlocked: boolean;
  /**
   * §11: the turn on which a self-installed "During your next turn, this Pokémon can't retreat"
   * lock is live (installing turn + 2), or `null`. Expires by turn comparison, so nothing clears it
   * at a turn boundary.
   */
  retreatLockedTurn: number | null;
  /** §11 — the attack-installed damage/effect block on this Pokémon (see
      `AttackBlock` above), or `null` when none has been installed. Only LIVE
      while its `turn` is the current one; read through `attackBlockOf`
      (continuous.ts) rather than by touching this field, so no read site can
      forget the turn comparison. */
  attackBlock: AttackBlock | null;
  /**
   * §8/§11: the turn on which this Pokémon may not attack, or `null`. Stamped `state.turn + 2` for
   * a self-lock and `+ 1` for a lock on the Defending Pokémon, so the window is always its
   * controller's next turn. Read through `attackLocked`. §10 clears it when the Pokémon leaves the
   * Active Spot or evolves.
   */
  attackLockedTurn: number | null;
  /**
   * §8/§11: the turn on which a flip-to-attack lock is live ("if tails, that attack doesn't
   * happen"), or `null`. Separate from `attackLockedTurn` because the attack stays legal to declare
   * and the coin is flipped at declaration. Read through `attackFlipLocked`.
   */
  attackFlipLockTurn: number | null;
  /**
   * §8/§11: the two-coin flip-to-attack lock (Octillery "Jet of Ink"), stamped `state.turn + 1`.
   * Kept separate from `attackFlipLockTurn` so that two live locks add their coins.
   */
  attackTwoFlipLockTurn: number | null;
  /**
   * §8.5/§11: the attack-installed damage reduction on this Pokémon, or `null`. Read through
   * `installedReductionOf`.
   */
  damageReduction: DamageReduction | null;
  /**
   * §8.5/§11: the turn on which "During your opponent's next turn, this Pokémon has no Weakness" is
   * live (installing turn + 1), or `null`. Read through `installedNoWeakness`.
   */
  noWeaknessTurn: number | null;
  /**
   * §13: the delayed effect an attack scheduled onto this Pokémon, or `null`. Read through
   * `scheduledEffectDue`. Holds one record: two counter schedules merge by max, and a schedule of a
   * different kind replaces the old one. §10 clears it when the body leaves the Active Spot or
   * evolves.
   */
  scheduledEffect: ScheduledEffect | null;
  /**
   * §8.5/§11: the attack-installed debuff on the damage this Pokémon's attacks deal, or `null`.
   * Read through `installedAttackDebuffOf`. Unlike `damageReduction`, it applies before Weakness
   * and Resistance.
   */
  attackDamageDebuff: AttackDamageDebuff | null;
  /**
   * §8.5/§11: the attack-installed next-turn vulnerability on this Pokémon, or `null`. Read through
   * `installedVulnerabilityOf`.
   */
  damageVulnerability: DamageVulnerability | null;
  /**
   * §8.5/§11: the attack-installed Weakness retype on this Pokémon, or `null`. Read through
   * `installedWeaknessRetypeOf` and `installedWeaknessRewriteOf`.
   */
  weaknessRetype: WeaknessRetype | null;
  /**
   * §8.2/§11: the turn on which an attack-installed cost tax is live (attacks and Retreat cost {C}
   * more), or `null`. Read through `installedCostTaxOf` for both attack and retreat costs.
   */
  costTaxTurn: number | null;
  /**
   * §8.1/§11: the attack-installed Knock Out bounty on this Pokémon, or `null`. Read only by
   * flow.ts `koPrizeBonus` on the pre-KO board, when this body was the Active and the KO is not
   * from the Checkup.
   */
  koBounty: KoBounty | null;
  /** §6.2/§11: the next-turn hand-attach mark on this Pokémon, or `null`. */
  handAttachMark: HandAttachMark | null;
  /**
   * §9/§11: the attack-installed reactive recoil on this Pokémon, or `null`. Read through
   * `installedRecoilOf`.
   */
  installedRecoil: InstalledRecoil | null;
  /**
   * §8/§11: every attack-installed per-attack lock on this Pokémon, newest last. A list because
   * both the self-side and the opponent-side bars can stamp the same turn. Read through
   * `lockedAttackIndexes`. §10 clears the whole list; expired entries stop answering at the reader
   * and are pruned on write.
   */
  lockedAttacks: LockedAttack[];
  /**
   * §8.5/§11: the per-attack damage buff on this Pokémon, or `null`. Read through
   * `boostedAttackDamage` and `boostedAttackBase`.
   */
  boostedAttack: BoostedAttack | null;
  /** Effect markers ("can't attack next turn", …). */
  markers: string[];
  /** Turn it entered play; 0 = during setup. The evolution timing ("not the
      turn it came into play", §10) reads this — the separate "no evolving on
      your own first turn" rule is a turn/firstPlayer check, not this field. */
  turnPlayed: number;
  /**
   * The turn this Pokémon last moved from the Bench into the Active Spot, or `null` if it never
   * has. A turn stamp, so "moved this turn" is `promotedTurn === state.turn` and needs no clear.
   * Survives evolution.
   */
  promotedTurn: number | null;
  /**
   * The turn this Pokémon last moved from the Active Spot to the Bench, or `null` if it never has;
   * the mirror of `promotedTurn`.
   */
  benchedTurn: number | null;
  /**
   * The turn this Pokémon was last healed, or `null`, for "If this Pokémon was healed during this
   * turn". Written through `healedBody` wherever a `HEALED` event is filed, so the two cannot
   * disagree.
   */
  healedTurn: number | null;
  /**
   * The turn this Pokémon last evolved, or `null`, for "If this Pokémon evolved from X during this
   * turn". The pre-evolution is read from the stack, so its name is not stored.
   */
  evolvedTurn: number | null;
  /**
   * The attack this Pokémon last used and when, or `null`. "During your last turn" is `turn ===
   * state.turn - 2`.
   */
  usedAttack: UsedAttack | null;
  /**
   * §8.5: the damage attacks dealt this Pokémon on the most recent turn they dealt any, or `null`.
   * A fact about the body, not an attack effect, so §10 does not clear it.
   */
  attackDamageTaken: AttackDamageTaken | null;
}

/**
 * §8.5: `pokemon` with `dealt` attack damage recorded for `turn`, added to a record for the same
 * turn or replacing an older one. `dealt <= 0` records nothing.
 */
export function withAttackDamageTaken(
  pokemon: InPlayPokemon,
  turn: number,
  dealt: number,
): InPlayPokemon {
  if (dealt <= 0) return pokemon;
  const record = pokemon.attackDamageTaken;
  const amount = record !== null && record.turn === turn ? record.amount + dealt : dealt;
  return { ...pokemon, attackDamageTaken: { turn, amount } };
}

/** §8.5: the damage attacks dealt `pokemon` during the previous turn, or 0. */
export function attackDamageTakenLastTurn(state: GameState, pokemon: InPlayPokemon): number {
  const record = pokemon.attackDamageTaken;
  return record !== null && record.turn === state.turn - 1 ? record.amount : 0;
}

/** §8.1: the Prize cards `seat` took during the previous turn, or 0. */
export function prizesTakenOnLastTurn(state: GameState, seat: Seat): number {
  const record = state.players[seat].prizesTakenOnTurn;
  return record !== null && record.turn === state.turn - 1 ? record.count : 0;
}

/**
 * §13: the delayed effect `pokemon` owes on this turn, or `null`. Its stamp is the turn at whose
 * end it fires, so a spent schedule never matches again.
 */
export function scheduledEffectDue(pokemon: InPlayPokemon, turn: number): ScheduledEffect | null {
  const scheduled = pokemon.scheduledEffect;
  return scheduled !== null && scheduled.turn === turn ? scheduled : null;
}

/** Per-body effect fields that §10 sheds when a Pokémon evolves, devolves or leaves the Active Spot. */
type AttackEffectField =
  | "retreatBlocked"
  | "attackBlock"
  | "attackLockedTurn"
  | "attackFlipLockTurn"
  | "attackTwoFlipLockTurn"
  | "retreatLockedTurn"
  | "damageReduction"
  | "noWeaknessTurn"
  | "scheduledEffect"
  | "attackDamageDebuff"
  | "damageVulnerability"
  | "weaknessRetype"
  | "costTaxTurn"
  | "koBounty"
  | "handAttachMark"
  | "installedRecoil"
  | "lockedAttacks"
  | "boostedAttack";

/**
 * The cleared value of every §10 effect field: what a card entering play carries and what
 * evolving, devolving or leaving the Active Spot resets. Spread it so each caller adds only its
 * own extras (conditions, markers, turn stamps).
 */
export function clearedAttackEffects(): Pick<InPlayPokemon, AttackEffectField> {
  return {
    retreatBlocked: false,
    attackBlock: null,
    attackLockedTurn: null,
    attackFlipLockTurn: null,
    attackTwoFlipLockTurn: null,
    retreatLockedTurn: null,
    damageReduction: null,
    noWeaknessTurn: null,
    scheduledEffect: null,
    attackDamageDebuff: null,
    damageVulnerability: null,
    weaknessRetype: null,
    costTaxTurn: null,
    koBounty: null,
    handAttachMark: null,
    installedRecoil: null,
    lockedAttacks: [],
    boostedAttack: null,
  };
}

/** Side-wide effects an attack, ability or Trainer installs on a seat. */
type SideInstallField =
  | "sideAttackLock"
  | "sideDamageReduction"
  | "sideAttackBlock"
  | "chosenAttackShield"
  | "sideRetreatLock"
  | "trainerFlipLockTurn";

/** The empty value of every side-wide install: what a seat starts the game with. */
export function clearedSideInstalls(): Pick<PlayerSide, SideInstallField> {
  return {
    sideAttackLock: null,
    sideDamageReduction: [],
    sideAttackBlock: null,
    chosenAttackShield: null,
    sideRetreatLock: null,
    trainerFlipLockTurn: null,
  };
}

export function makeInPlay(uid: string, turnPlayed: number): InPlayPokemon {
  return {
    stack: [uid],
    energy: [],
    tools: [],
    damage: 0,
    conditions: noConditions(),
    // A card entering play carries no effect of an attack.
    ...clearedAttackEffects(),
    markers: [],
    turnPlayed,
    // Never moved: a card entering play arrives from the HAND (or a deck
    // search), never from the Bench. The three bench→Active routes stamp it.
    promotedTurn: null,
    benchedTurn: null,
    healedTurn: null,
    evolvedTurn: null,
    usedAttack: null,
    attackDamageTaken: null,
  };
}

export interface PlayerSide {
  /** Card uids; index 0 is the top of the deck. */
  deck: string[];
  hand: string[];
  /** Order preserved (§2 — the discard pile is ordered and public). */
  discard: string[];
  /** Prize uids, 6 at setup (§3.8). Some may be face up; see `faceUpPrizes`. */
  prizes: string[];
  /**
   * Uids of this seat's prizes turned face up, oldest first. Stored as uids because taking prizes
   * compacts `prizes`. Always a subset of `prizes`, and face-up prizes still count as prizes.
   */
  faceUpPrizes: string[];
  /**
   * §8/§11: the side-wide attack lock on this seat's Pokémon, or `null`. Read through
   * `attackLocked`. Not cleared by §10; expires by turn comparison.
   */
  sideAttackLock: SideAttackLock | null;
  /**
   * §8.5: the side-wide next-turn damage reductions on this seat's Pokémon. Several installs in one
   * turn stack, and every live entry is summed by `seatDamageReduction`.
   */
  sideDamageReduction: readonly SideDamageReduction[];
  /**
   * §8.1: the Prize cards this seat took on the most recent of its own turns on which it took any,
   * or `null`. A take on the opponent's turn is not recorded.
   */
  prizesTakenOnTurn: PrizesTakenOnTurn | null;
  /**
   * §11: the side-wide damage block on this seat's Future Pokémon (Miraidon "C.O.D.E.: Protect"),
   * or `null`. Cleared when the source leaves the Active Spot.
   */
  sideAttackBlock: SideAttackBlock | null;
  /** §11: Acerola's Mischief's shield on one chosen Pokémon of this seat, or `null`. */
  chosenAttackShield: ChosenAttackShield | null;
  /** §11: Roxie's Performance's retreat lock on this seat's Poisoned Pokémon, or `null`. */
  sideRetreatLock: SideRetreatLock | null;
  /**
   * §7: the turn on which this seat's Trainer plays from hand are flip-locked (Seismitoad "Quaking
   * Fist": on tails the card is discarded instead), or `null`.
   */
  trainerFlipLockTurn: number | null;
  active: InPlayPokemon | null;
  /** Dense (no empty slots). The size cap is `benchLimitOf`, not always `BENCH_MAX`. */
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

/**
 * Why a game ended. The first three are the §14 rules conditions in precedence order, evaluated by
 * `evaluateWin`. `conceded` covers both a concession and an online player's abandonment timer
 * running out. `cardEffect` is a card's printed win, written only by the `winGame` op.
 */
export type GameOverReason = "prizesTaken" | "noPokemon" | "deckOut" | "conceded" | "cardEffect";

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
  /**
   * §9: once-per-turn Ability uses this turn. Keys are built only by `abilityUsedKey`:
   * `${uid}:${ability}` per body, or `*:${ability}` when the card limits the Ability by name across
   * all copies.
   */
  abilitiesUsed: string[];
  /**
   * §8.5: this-turn side-wide pre-Weakness/Resistance bonuses the turn's player installed (e.g.
   * Black Belt's Training). Entries are summed. This bag describes only the turn's owner, so the
   * reader pays an entry only when the attacking seat is the turn's seat.
   */
  sideAttackBonuses: SideAttackBonus[];
  /**
   * §7.2: the uid of the Supporter the turn's player played from hand this turn, or `null`. Set
   * together with `supporterPlayed`. Describes only the turn's owner.
   */
  supporterPlayedUid: string | null;
  /**
   * §7.2/§5.3: Amarys's end-of-turn hand discard threshold, or `null` when none is pending. Checked
   * at end of turn before the Checkup; the hand is discarded if it holds at least this many cards.
   */
  endOfTurnHandDiscard: number | null;
  /**
   * §5.3/§8: the uid of the turn owner's Active that may declare a second attack this turn
   * (Festival Lead), or `null`. While set, only `attack` and `endTurn` are allowed.
   */
  attackAgainUid: string | null;
}

/**
 * §8.5: one this-turn side-wide bonus: `amount` added before Weakness and Resistance to an attack
 * by any of the turn player's Pokémon whose defender matches `target`.
 */
export interface SideAttackBonus {
  amount: number;
  target: CardFilter;
  /** §8.5: the attacker filter, matched on the attacking card. Absent means every attacker. */
  attacker?: CardFilter;
}

export function freshAllowances(): TurnAllowances {
  return {
    energyAttached: false,
    retreated: false,
    supporterPlayed: false,
    stadiumPlayed: false,
    stadiumAbilityUsed: false,
    abilitiesUsed: [],
    sideAttackBonuses: [],
    supporterPlayedUid: null,
    endOfTurnHandDiscard: null,
    attackAgainUid: null,
  };
}

/** The `${uid}:${ability.name}` sentinel a `"sharedByName"` Ability keys on
    INSTEAD of its own uid, so every copy of the card on a board collides into one
    entry. Safe as a sentinel because a uid is `` `${seat}#${index}` `` (setup.ts)
    and can never be `*` — the two key spaces are disjoint by construction. */
const SHARED_ABILITY_UID = "*";

/**
 * The key for the §9 once-per-turn Ability limit, shared by every reader and writer of
 * `allowances.abilitiesUsed`. `"sharedByName"` (Fezandipiti ex's "Flip the Script") drops the uid;
 * every other Ability keeps it.
 */
export function abilityUsedKey(
  uid: string,
  // Takes only the two fields it reads, so triggered abilities with `oncePerTurn` can key through
  // it too.
  ability: Pick<AbilityProgram, "name"> & { oncePerTurn?: AbilityProgram["oncePerTurn"] },
): string {
  const keyUid = ability.oncePerTurn === "sharedByName" ? SHARED_ABILITY_UID : uid;
  return `${keyUid}:${ability.name}`;
}

/**
 * The once-per-turn key Backtrack Badge spends on `allowances.abilitiesUsed` (`abilityUsedKey`'s
 * shape, on the Tool's uid).
 */
export function coinRedoKey(toolUid: string, name: string): string {
  return `${toolUid}:${name}`;
}

/** Has the once-per-turn `key` been spent this turn? */
export function abilityUsedThisTurn(state: GameState, key: string): boolean {
  return state.allowances.abilitiesUsed.includes(key);
}

/** Spends the once-per-turn `key` for the rest of the turn. */
export function spendAbilityUse(state: GameState, key: string): GameState {
  return {
    ...state,
    allowances: {
      ...state.allowances,
      abilitiesUsed: [...state.allowances.abilitiesUsed, key],
    },
  };
}

/**
 * The staged turn tail. `endTurn` and `attack` seed this queue; `advance` (flow.ts) drains it stage
 * by stage, parking whenever a stage needs a player decision and resuming once the action lands. A
 * first attack that opens the Festival Lead attack-again window queues `resumeTurn` instead.
 */
export type PendingStage =
  /**
   * §8.1: the KOing seat picks `count` prizes (clamped to what is left; forced picks auto-resolve).
   * Face-up prizes are picked like any other.
   */
  | { kind: "takePrizes"; seat: Seat; count: number }
  /**
   * §8.1: shuffle `seat`'s whole hand into their deck (Gholdengo "Celebration"). Queued directly
   * behind its `takePrizes` stage so the Prizes just taken go with the hand. Never parks.
   */
  | { kind: "shuffleHandIntoDeck"; seat: Seat }
  /** §8.1 — the KO'd seat promotes from the bench; an empty bench at this
      point is the §14.2 loss. */
  | { kind: "promote"; seat: Seat }
  /**
   * `toolsDone` is set only by this stage: it queues one `endTurnToolTrigger` per Powerglass ahead
   * of a copy of itself with `toolsDone: true`, so the copy ends the turn instead of seeding again.
   */
  | { kind: "endTurn"; seat: Seat; toolsDone?: true }
  /**
   * §5.3: run the end-of-turn program of the Pokémon Tool `toolUid` on `seat`'s Active
   * (Powerglass). Can park; the program runs with the holder's top uid as `sourceUid`, because "it"
   * must resolve to the Pokémon, not the Tool.
   */
  | { kind: "endTurnToolTrigger"; seat: Seat; toolUid: string }
  /** The Pokémon Checkup (§13) — `seat` is the player whose turn just ended,
      which the §13.4 paralysis recovery keys on. Its KOs park on the same
      ko:* interrupts the attack KOs use. */
  | { kind: "checkup"; seat: Seat }
  /**
   * Hand the turn back to `seat` after a mid-turn Knock Out, once its prize and promotion decisions
   * settle. Also queued after the first attack of a Festival Lead attack-again window. Always the
   * last of its stages.
   */
  | { kind: "resumeTurn"; seat: Seat }
  /**
   * §9: run the on-KO triggered Ability of the Knocked Out `uid` (owned by `seat`), or, when
   * `toolUid` is set, the on-KO program of that Tool attached to it. Runs during the opponent's
   * turn and may park; queued after the prize stages and before the promotions.
   */
  | { kind: "koTrigger"; seat: Seat; uid: string; toolUid?: string }
  /**
   * §9: run the `onDamagedByAttack` reaction of the damaged Active `uid` (an Ability, or an
   * attached Tool's uid). Runs under `seat`, the damaged player, and may park. Queued after the
   * attack's effect program and before the §8.1 KO sweep.
   */
  | { kind: "damagedTrigger"; seat: Seat; uid: string }
  /**
   * §8.1: run the program that reacts to `seat`'s Active about to be Knocked Out by an attack (a
   * Tool on a surviving or dying Pokémon, or the Active's own Ability). Carries no uid on purpose:
   * the Active and the bearer are re-read from the live board when the stage runs.
   */
  | { kind: "koToolTrigger"; seat: Seat }
  /**
   * §8.1 + §5.3: the attack's epilogue: sweep both boards for Knock Outs, then end `seat`'s turn
   * through the staged tail. Queued before the attack's effect program so the program can park.
   * `uid` and `attack` are the attacking body and the declared attack's printed name, captured at
   * declaration because the Active may have changed by the time this runs.
   */
  | {
      kind: "attackEpilogue";
      seat: Seat;
      uid: string;
      attack: string;
      /**
       * §6.1: Boomerang Energy uids this attack's own program discarded off the attacker;
       * re-attached when the stage drains, before `finishAttack`.
       */
      boomerang?: string[];
    }
  /**
   * §7.3: Area Zero Underdepths trim: `seat` has more Benched Pokémon than `benchLimitOf` allows,
   * so it discards Benched Pokémon (no Knock Out, no Prize) until it has 5. The excess is re-read
   * when the stage drains, and the bench owner chooses.
   */
  | { kind: "benchTrim"; seat: Seat }
  /**
   * §7.4: Rotom ex "Multi Adapter" went away, so `seat` must discard Tools until each Pokémon is
   * within `toolCapOf`. The excess is re-read when the stage drains, and the owner chooses.
   */
  | { kind: "toolTrim"; seat: Seat }
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
  | {
      kind: "setup:drawExtra";
      owed: Record<Seat, number>;
      decided: Record<Seat, boolean>;
      /** The cards each seat drew here, which the bonus Bench step may place. */
      bonusCards: Record<Seat, string[]>;
    }
  | {
      kind: "setup:place";
      ready: Record<Seat, boolean>;
      stage: "opening" | "bonus";
      bonusCards?: Record<Seat, string[]>;
    }
  // Per-turn allowances live on GameState.allowances (NOT here) so the ko:*
  // interrupts below can replace the phase mid-turn without destroying them.
  | { kind: "turn:action"; seat: Seat }
  /**
   * KO resolution interrupt (§8.1): the KOing player picks `count` of their own prizes, face-up
   * ones included. Forced picks never park.
   */
  | { kind: "ko:takePrizes"; seat: Seat; count: number }
  /** KO resolution interrupt (§8.1): the KO'd player promotes a benched
      Pokémon. A lone benched Pokémon auto-promotes; an empty bench is the
      §14.2 loss (resolved before this phase is ever entered). */
  | { kind: "ko:promote"; seat: Seat }
  /**
   * Mid-effect decision interrupt (§15.E/G): a program parked on a choice. `prompt` is the legal
   * options; `cont` is the continuation the resolveEffect action replays. `resumeTail` marks parks
   * inside the turn tail (on-KO and on-damaged triggers, which run on the opponent's turn, and
   * attack effect programs), where finishing must keep draining `pending`.
   */
  | {
      kind: "effect:choose";
      seat: Seat;
      /**
       * The seat that must answer this prompt when it is not `seat` (an opponent's printed "may").
       * `seat` stays the program's controller; only the who-may-answer check and the projection's
       * waiting seat read this.
       */
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

/** No hand-play lock live on either seat — `createGame`'s initialiser, written
    once here rather than spelled at the literal (the `freshAllowances` idiom).
    Every class present with `null`; see `GameState.handPlayLockedTurn`. */
export function freshHandPlayLocks(): Record<Seat, Record<StampedPlayLockKey, number | null>> {
  return {
    p1: { Item: null, Supporter: null, Stadium: null, evolve: null },
    p2: { Item: null, Supporter: null, Stadium: null, evolve: null },
  };
}

export interface GameState {
  /** The generator's state — every shuffle/flip advances it. A ChaCha20 state in every new
      game, a legacy mulberry32 int32 in older saves and numeric-seed
      fixtures (rng.ts). Secret: redaction never copies it. */
  rngState: RngState;
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
  /**
   * The turn on which this seat most recently had one of its Pokémon Knocked Out during the
   * opponent's turn, or `null`. Read as `=== state.turn - 1` for "during your opponent's last
   * turn". Written only in `knockOut` (flow.ts); a KO on the seat's own turn is not stamped, since
   * it would overwrite the opponent's-turn stamp. `null`, not 0, so turn 1 does not match.
   */
  lastKoTurn: Record<Seat, number | null>;
  /**
   * §8.1: which Pokémon this seat lost on the turn `lastKoTurn` stamps, and how. Has no turn of its
   * own: restarted when a KO lands on a later turn, appended otherwise, and keyed on uid because
   * `collectKnockOuts` also calls `knockOut` speculatively.
   */
  lastKoMarks: Record<Seat, readonly KnockOutMark[]>;
  /**
   * Which of this seat's Pokémon used an attack this turn and on its previous turn, for Koraidon
   * "Unrelenting Onslaught". Kept on the seat so it outlives the body: a Pokémon that attacked and
   * then left play still counts. Pruned to the last two of the seat's turns.
   */
  recentAttackers: Record<Seat, readonly RecentAttacker[]>;
  /**
   * §7.1/§7.2: per seat and per class, the turn on which that seat may not play that kind of card
   * from hand (or evolve) because of an opponent's attack, or `null`. A stamp of `state.turn + 1`,
   * so it expires by turn comparison.
   */
  handPlayLockedTurn: Record<Seat, Record<StampedPlayLockKey, number | null>>;
  /**
   * §8.1: the once-per-game effects this seat has already used, keyed by effect name so reprints
   * share one entry. Only ever grows.
   */
  oncePerGameSpent: Record<Seat, string[]>;
  /** uid → catalog card id; fixed for the whole game at createGame. */
  cardIdByUid: Record<string, string>;
  /** The slice of the injected pool the two decks actually use. Carried in
      the state so applyAction stays a pure (state, action) pair and
      snapshots are self-contained/replayable. */
  cardPool: Record<string, Card>;
}

/** The seat that answers a parked prompt: the filed answerer, else the controller. */
export function answererOf(phase: Extract<Phase, { kind: "effect:choose" }>): Seat {
  return phase.answerer ?? phase.seat;
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

/** The body at a spot; an empty Active spot and a vacant bench index both read as undefined. */
export function bodyAt(side: PlayerSide, target: PokemonTarget): InPlayPokemon | undefined {
  return target.spot === "active" ? (side.active ?? undefined) : side.bench[target.index];
}

export function pokemonAt(
  state: GameState,
  seat: Seat,
  target: PokemonTarget,
): InPlayPokemon | undefined {
  return bodyAt(state.players[seat], target);
}

/** The side's Pokémon in play, Active first. */
export function inPlayOf(side: PlayerSide): InPlayPokemon[] {
  return side.active === null ? side.bench : [side.active, ...side.bench];
}

/** Prizes a seat has TAKEN — `PRIZE_COUNT − what remains in their pile`. Each
    player draws from their OWN Prizes on a KO (§8.1), so a shrinking pile IS the
    taken count. The count-scaling attack readers scale by the OPPONENT's taken
    Prizes (Charizard ex "Burning Darkness", Pecharunt ex / Annihilape, Wo-Chien ex
    "Covetous Ivy"), read at declaration before this attack's own KO awards one. */
export function takenPrizes(state: GameState, seat: Seat): number {
  return PRIZE_COUNT - state.players[seat].prizes.length;
}

/**
 * §8.1: did `seat` have any of its own Pokémon Knocked Out during the previous turn, i.e. its
 * opponent's last turn? False on turns 0 and 1.
 */
export function koedDuringOpponentsLastTurn(state: GameState, seat: Seat): boolean {
  const stamped = state.lastKoTurn[seat];
  return stamped !== null && stamped === state.turn - 1;
}

/**
 * §8: did `pokemon` use the attack named `attack` during its controller's last turn (`state.turn -
 * 2`)? False for the non-turn seat by parity.
 */
export function usedAttackOnYourLastTurn(
  state: GameState,
  pokemon: InPlayPokemon,
  attack: string,
): boolean {
  const used = pokemon.usedAttack;
  return used !== null && used.name === attack && used.turn === state.turn - 2;
}

/**
 * One Pokémon this seat lost, recorded with `GameState.lastKoTurn`. `name` is the printed card
 * name, which owner-prefix filters test. `byAttack` means it was Knocked Out while an attack
 * resolved, including by counters the attack placed.
 */
export type KnockOutMark = { uid: string; name: string; byAttack: boolean };

/**
 * One entry of `GameState.recentAttackers`: the attacking body's top uid and the turn it attacked
 * on.
 */
export type RecentAttacker = { turn: number; uid: string };

/**
 * The marker a non-damage Knock Out stamps on the body it dooms, so readers of "Knocked Out by
 * damage" can tell it apart. Carries the turn so the marker expires by turn comparison without a
 * clear.
 */
export function koByEffectMarker(turn: number): string {
  return `koByEffect:${turn}`;
}

/**
 * §8.1: the Pokémon `seat` lost during its opponent's last turn, or an empty list when that window
 * is not open. Checks `lastKoTurn` first, so it cannot disagree with `koedDuringOpponentsLastTurn`.
 */
export function koedMarksOnOpponentsLastTurn(
  state: GameState,
  seat: Seat,
): readonly KnockOutMark[] {
  return koedDuringOpponentsLastTurn(state, seat) ? state.lastKoMarks[seat] : [];
}

/**
 * §7.1/§7.2: the attack-stamped half of `handPlayBarred`: is `seat` barred from `key` during the
 * current turn? `continuous.ts` combines it with the Ability-based source.
 */
function stampedPlayLockBarred(state: GameState, seat: Seat, key: StampedPlayLockKey): boolean {
  return state.handPlayLockedTurn[seat][key] === state.turn;
}

/**
 * The stamped half read for a hand-play class. Classes that no attack can stamp are rejected by the
 * type and answer no stamp. Exported for `continuous.ts` only.
 */
export function stampedBarFor(state: GameState, seat: Seat, klass: HandPlayClass): boolean {
  // No attack stamps a Tool bar.
  return klass === "Tool" ? false : stampedPlayLockBarred(state, seat, klass);
}

/**
 * §10: the stamped half read for a Pokémon-play act. `"bench"` cannot be stamped by an attack, so
 * it answers no stamp. Exported for `continuous.ts` only.
 */
export function stampedActBarFor(state: GameState, seat: Seat, act: PokemonPlayAct): boolean {
  return act === "bench" ? false : stampedPlayLockBarred(state, seat, act);
}

/**
 * §4: is the current turn `seat`'s own first turn? Odd turns belong to `firstPlayer`, so that is
 * turn 1 for the first player and turn 2 for the other. With `firstPlayer` null the turn is 0, so
 * the answer is false without a guard.
 */
export function isFirstTurnOf(state: GameState, seat: Seat): boolean {
  return state.turn === (seat === state.firstPlayer ? 1 : 2);
}

/** Remove one card uid from a zone array (uids are unique by construction). */
export function without(zone: readonly string[], uid: string): string[] {
  return zone.filter((entry) => entry !== uid);
}

/**
 * Every card uid this in-play Pokémon is made of, in §2's pile order: evolution stack bottom to
 * top, then attached Energy, then attached Tools.
 */
export function stackUids(pokemon: InPlayPokemon): string[] {
  return [...pokemon.stack, ...pokemon.energy, ...pokemon.tools];
}

/** The one "cards leave play for the discard pile" move — §11 retreat costs,
    §8.1 KO cleanup and the DiscardEnergy op all funnel through here rather
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

/** The body an evolution lands on: where it is, and its current top card's uid. */
export interface EvolutionHost {
  seat: Seat;
  target: PokemonTarget;
  body: InPlayPokemon;
  bodyUid: string;
}

/**
 * §10 evolution placement without the Knock Out and board-trigger follow-up: replaces the stack
 * top, applies §10's carry-over and clears, and appends `POKEMON_EVOLVED`. Returns the new state
 * and the new body.
 */
export function evolveOnto(
  state: GameState,
  host: EvolutionHost,
  evolutionUid: string,
  /** Special Conditions the new top keeps (e.g. Confused under Dizzying Valley); §12 clears the rest. */
  kept: SpecialConditions,
  events: GameEvent[],
): { state: GameState; evolved: InPlayPokemon } {
  const { seat, target, body: from, bodyUid: fromUid } = host;
  const evolved: InPlayPokemon = {
    ...from,
    stack: [...from.stack, evolutionUid],
    conditions: kept,
    // §10: evolving sheds every effect of an attack, beneficial ones included, so a locked Pokémon
    // can evolve and attack and a scheduled delayed effect is cancelled.
    ...clearedAttackEffects(),
    markers: [],
    turnPlayed: state.turn,
    // Records that this Pokémon evolved this turn. This is the only write site, shared by every
    // evolution route; `turnPlayed` cannot answer this because it also matches Pokémon played this
    // turn without evolving.
    evolvedTurn: state.turn,
  };
  const side = state.players[seat];
  const updated: PlayerSide =
    target.spot === "active"
      ? { ...side, active: evolved }
      : { ...side, bench: side.bench.map((p, i) => (i === target.index ? evolved : p)) };
  events.push({
    type: "POKEMON_EVOLVED",
    seat,
    from: fromUid,
    to: evolutionUid,
    // Copied: the action object belongs to the caller (events.ts).
    target: { ...target },
  });
  // §10/§12: evolving removed the Pokémon's Special Conditions, less any the new top keeps.
  // Announced only when something was removed; `uid` is the new top.
  const cleared = presentStatuses(from.conditions).filter(
    (status) => !presentStatuses(kept).includes(status),
  );
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

/**
 * Moves up to `count` cards from the `from` end of the deck to hand and
 * records CARDS_DRAWN. Callers that care about deck-out check emptiness themselves. On a deck no
 * deeper than `count`, top and bottom draws take the same cards in the same order.
 */
export function drawToHand(
  state: GameState,
  seat: Seat,
  count: number,
  reason: DrawReason,
  from: "top" | "bottom",
  events: GameEvent[],
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
