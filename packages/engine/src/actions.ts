import type { GameEvent } from "./events";
import type { EffectChoice } from "./interpreter";
import type { GameState, PokemonTarget, Seat } from "./types";

// Player-decision actions. Everything with no choice in it (mulligan
// redraws, prize setting, the turn-start draw) auto-resolves inside the
// reducer; everything with a choice is one of these, validated against
// state.phase and the acting seat.

export interface ChooseFirstPlayerAction {
  type: "chooseFirstPlayer";
  /** The acting seat — must be the coin-flip winner. */
  seat: Seat;
  /** Who takes the first turn; the winner may pick either seat (§3.3). */
  first: Seat;
}

export interface SetupDrawExtraAction {
  type: "setupDrawExtra";
  seat: Seat;
  /** Mulligan-compensation cards to draw, 0 ≤ count ≤ owed ("may draw up to"). */
  count: number;
}

export interface SetupPlaceActiveAction {
  type: "setupPlaceActive";
  seat: Seat;
  /** A Basic Pokémon uid from the actor's hand. */
  uid: string;
}

export interface SetupPlaceBenchAction {
  type: "setupPlaceBench";
  seat: Seat;
  uid: string;
}

export interface SetupReadyAction {
  type: "setupReady";
  seat: Seat;
}

export interface AttachEnergyAction {
  type: "attachEnergy";
  seat: Seat;
  /** An Energy uid from the actor's hand. */
  uid: string;
  target: PokemonTarget;
}

export interface PlayBasicToBenchAction {
  type: "playBasicToBench";
  seat: Seat;
  uid: string;
}

export interface EvolveAction {
  type: "evolve";
  seat: Seat;
  /** An Evolution Pokémon uid from the actor's hand (its `evolveFrom` names
      the card it goes on top of, §10). */
  uid: string;
  /** Which of the actor's own in-play Pokémon to evolve (Active or Bench). */
  target: PokemonTarget;
}

export interface RareCandyAction {
  type: "rareCandy";
  seat: Seat;
  /** The Rare Candy Item uid from the actor's hand (§7.1). */
  uid: string;
  /** Which of the actor's own in-play Basic Pokémon to evolve (Active or
      Bench) — Rare Candy skips the Stage 1. */
  target: PokemonTarget;
  /** The Stage 2 Pokémon uid from the actor's hand to place on the Basic (its
      evolution line must trace through a Stage 1 back to the target's name). */
  evolutionUid: string;
}

/** Give up the game (P4 3c-ii). Not a §14 rules condition — a player's own
    choice, or the server acting for one who abandoned an online match — so unlike
    every other action it is legal in ANY phase but `gameOver`: you can concede on
    your opponent's turn, mid-effect, or while a KO interrupt is parked. That
    totality is the point: it is the ONE action that can always end a match that
    is otherwise stuck. */
export interface ConcedeAction {
  type: "concede";
  seat: Seat;
}

export interface RetreatAction {
  type: "retreat";
  seat: Seat;
  /** Exactly which attached energy uids pay the cost — the count must equal
      the top card's retreat cost (§11; any energy pays, cost is Colorless). */
  discardEnergy: string[];
  /** Bench index of the Pokémon promoted to Active. */
  promoteBenchIndex: number;
}

export interface AttackAction {
  type: "attack";
  seat: Seat;
  /** Index into the Active's printed attacks (the top card defines them,
      §1.2). Runtime-checked — integer, in range — like every wire value. */
  index: number;
}

export interface TakePrizesAction {
  type: "takePrizes";
  seat: Seat;
  /** Exactly `count` (from the ko:takePrizes phase) distinct indices into
      the actor's own face-down prize row — the KOing player picks which of
      THEIR prizes to reveal into hand (§8.1). */
  prizeIndices: number[];
}

export interface PromoteAction {
  type: "promote";
  seat: Seat;
  /** Bench index of the Pokémon promoted into the empty Active spot (§8.1). */
  benchIndex: number;
}

export interface PlayTrainerAction {
  type: "playTrainer";
  seat: Seat;
  /** A Trainer uid from the actor's hand (Item §7.1 / Supporter §7.2 /
      Stadium §7.3 — Tools attach through attachTool instead). */
  uid: string;
}

export interface AttachToolAction {
  type: "attachTool";
  seat: Seat;
  /** A Pokémon Tool uid from the actor's hand (§7.4). */
  uid: string;
  /** Which of the actor's own in-play Pokémon wears it (one Tool each). */
  target: PokemonTarget;
}

export interface UseAbilityAction {
  type: "useAbility";
  seat: Seat;
  /** Which of the actor's own in-play Pokémon carries the Ability. */
  target: PokemonTarget;
  /** The Ability's printed name (a card may have more than one). */
  abilityName: string;
}

export interface UseStadiumAbilityAction {
  type: "useStadiumAbility";
  seat: Seat;
}

export interface ResolveEffectAction {
  type: "resolveEffect";
  seat: Seat;
  /** The controller's answer to the parked effect:choose prompt — cards for a
      search, a Pokémon ref for a switch/gust/heal (validated vs the prompt). */
  choice: EffectChoice;
}

export interface EndTurnAction {
  type: "endTurn";
  seat: Seat;
}

export type GameAction =
  | ChooseFirstPlayerAction
  | SetupDrawExtraAction
  | SetupPlaceActiveAction
  | SetupPlaceBenchAction
  | SetupReadyAction
  | AttachEnergyAction
  | PlayBasicToBenchAction
  | EvolveAction
  | RareCandyAction
  | ConcedeAction
  | RetreatAction
  | AttackAction
  | PlayTrainerAction
  | AttachToolAction
  | UseAbilityAction
  | UseStadiumAbilityAction
  | ResolveEffectAction
  | TakePrizesAction
  | PromoteAction
  | EndTurnAction;

export type ErrorCode =
  | "GAME_OVER"
  /** The action's `type` or `seat` is not one the engine knows. Unreachable
      through the typed API; the P4 server decodes actions off the wire. */
  | "UNKNOWN_ACTION"
  | "UNKNOWN_SEAT"
  | "BAD_PHASE"
  | "WRONG_SEAT"
  | "UNKNOWN_CARD"
  | "CARD_NOT_IN_HAND"
  | "NOT_A_BASIC_POKEMON"
  /** §10 — the played card is a Basic / non-Pokémon (no `evolveFrom`), so it
      cannot be placed on top of an in-play Pokémon as an evolution. */
  | "NOT_AN_EVOLUTION"
  /** §10 — the evolution's `evolveFrom` does not name the target's current
      top card, so it does not evolve from it. */
  | "EVOLVE_MISMATCH"
  /** §10 — the target came into play (or was itself evolved) this turn; a
      Pokémon evolves at most once per turn and never the turn it arrived. */
  | "EVOLVE_TOO_SOON"
  /** §4/§10 — neither player may evolve on their own first turn (shared by
      evolve and Rare Candy). */
  | "FIRST_TURN_EVOLVE"
  /** §7.1 — Rare Candy: the chosen hand card is not a Stage 2 whose evolution
      line traces (through its Stage 1) back to the chosen Basic Pokémon. */
  | "RARE_CANDY_NO_STAGE2"
  | "NOT_AN_ENERGY"
  | "NO_TARGET"
  | "BENCH_FULL"
  | "BENCH_EMPTY"
  | "BAD_BENCH_INDEX"
  /** attachEnergy's `target` failed the wire shape check (null / not an
      object / an unknown `spot`). */
  | "BAD_TARGET"
  | "BAD_EXTRA_COUNT"
  | "ACTIVE_ALREADY_PLACED"
  | "ACTIVE_NOT_PLACED"
  | "ALREADY_READY"
  | "ENERGY_ALREADY_ATTACHED"
  | "ENERGY_NOT_ATTACHED"
  | "RETREAT_COST_MISMATCH"
  | "ALREADY_RETREATED"
  /** §4 — the going-first player may not attack on turn 1. */
  | "FIRST_TURN_ATTACK"
  | "BAD_ATTACK_INDEX"
  | "ATTACK_COST_UNMET"
  // — M4 Trainer / Ability plays (§7/§9). —
  /** playTrainer on a non-Trainer card. */
  | "NOT_A_TRAINER"
  /** attachTool on a card that is not a Pokémon Tool (§7.4). */
  | "NOT_A_TOOL"
  /** A trainerType the engine has no play path for (a null/garbled catalog
      row; Tools go through attachTool, not playTrainer). */
  | "TRAINER_TYPE_UNSUPPORTED"
  /** The Trainer has no authored program (registry.ts) — unsimulated, so it
      cannot be played rather than played as a no-op (coverage strategy). */
  | "TRAINER_NOT_SIMULATED"
  /** §7.3 — one Stadium play per turn. */
  | "STADIUM_ALREADY_PLAYED"
  /** §7.3 — a Stadium with the same name as the one in play cannot be
      played (no self-replacing to reset it). */
  | "STADIUM_SAME_NAME"
  /** §7.4 — the target Pokémon already wears a Tool (one each). */
  | "TOOL_ALREADY_ATTACHED"
  /** §7.2 — one Supporter per turn. */
  | "SUPPORTER_ALREADY_PLAYED"
  /** §4 — the going-first player may not play a Supporter on turn 1. */
  | "FIRST_TURN_SUPPORTER"
  /** §7.1/§7.2 (D283) — an OPPONENT'S attack barred this class of card from this
      seat's hand for exactly this turn (Scream Tail ex's Supporter bar,
      Galvantula ex / Budew / Frillish's Item bar). Distinct from the two codes
      above: those are the player's own §4/§7.2 limits, this one was imposed, and
      a player who cannot tell them apart cannot tell which of their cards is
      dead for the turn (types.ts `handPlayLockedTurn`). */
  | "HAND_PLAY_BLOCKED"
  /** The play has no legal target (gust with no opponent Bench, Switch with no
      Bench) — a card that would do nothing cannot be played. */
  | "NO_LEGAL_TARGET"
  /** The card's PRINTED "You can use this card only if <condition>" gate is not
      met (Fighting Au Lait without a Prize lead). Checked before the card leaves
      hand, so a rejected play costs the player nothing. Distinct from
      NO_LEGAL_TARGET, which is the engine's would-only-whiff judgement rather
      than a rule printed on the card. */
  | "PLAY_CONDITION_NOT_MET"
  /** useAbility naming an Ability this Pokémon does not have (or none authored). */
  | "NO_SUCH_ABILITY"
  /** §9 — the Ability may only be used from the Active Spot. */
  | "ABILITY_ACTIVE_ONLY"
  /** §9 — a continuous Ability-lock aura (Klefki / Spiritomb / Ting-Lu ex) has
      turned this Pokémon's Abilities off. */
  | "ABILITY_DISABLED"
  /** §9/§15.J — this Pokémon already used a once-per-turn Ability this turn. */
  | "ABILITY_ALREADY_USED"
  /** §9 — the Ability's activation cost cannot be paid (Meowscarada's "Bouquet
      Magic" needs a Basic {G} Energy in hand to discard). */
  | "ABILITY_COST_UNMET"
  /** §9 — the Ability's PRINTED board gate is not met (Fezandipiti ex's "Once
      during your turn, IF ANY OF YOUR POKÉMON WERE KNOCKED OUT DURING YOUR
      OPPONENT'S LAST TURN, you may draw 3 cards"). The Ability-surface sibling of
      `PLAY_CONDITION_NOT_MET`, which is the same rule printed on a TRAINER — one
      `BoardCondition` and one `conditionHolds`, two codes, because the two
      surfaces reject through different actions and a client that greys an Ability
      row must not have to guess which of them it is looking at. Distinct from
      NO_LEGAL_TARGET for the same reason the Trainer code is: this is a rule
      printed on the card, not the engine's would-only-whiff judgement. */
  | "ABILITY_CONDITION_NOT_MET"
  /** §7.3 — useStadiumAbility with no Stadium in play, or a Stadium that has no
      activated ability (Beach Court / League HQ are continuous-only). */
  | "STADIUM_ABILITY_UNAVAILABLE"
  /** §7.3 — the shared Stadium's "once during each player's turn" ability was
      already used this turn. */
  | "STADIUM_ABILITY_ALREADY_USED"
  /** resolveEffect's choice does not match the parked prompt (bad uid/ref/count). */
  | "BAD_EFFECT_CHOICE"
  /** §12 — an Asleep or Paralyzed Active cannot attack. (Confusion does not
      block declaring — it flips at resolution, attack.ts.) */
  | "STATUS_PREVENTS_ATTACK"
  /** §8/§11 — an attack effect is stopping the Active from attacking ("During
      your next turn, this Pokémon can't attack."). `RETREAT_PREVENTED`'s exact
      mirror, and distinct from STATUS_PREVENTS_ATTACK for the same reason that
      one is distinct from STATUS_PREVENTS_RETREAT: this is not a §12 condition,
      it shows no status chip, and it expires by a turn STAMP rather than by a
      Checkup recovery (types.ts `attackLockedTurn`). */
  | "ATTACK_PREVENTED"
  /** §11/§12 — an Asleep or Paralyzed Active cannot retreat. */
  | "STATUS_PREVENTS_RETREAT"
  /** §11 — an attack effect is holding the Active in place ("During your
      opponent's next turn, the Defending Pokémon can't retreat."). Distinct
      from STATUS_PREVENTS_RETREAT: not a §12 condition, and it clears at the
      Checkup ending this player's own turn rather than by a flip. */
  | "RETREAT_PREVENTED"
  | "BAD_PRIZE_COUNT"
  | "BAD_PRIZE_INDEX"
  /** A parked ko:* phase that disagrees with the head pending stage —
      unreachable through the engine's own transitions (parking writes both
      together); a crafted or corrupted snapshot (attack.ts). */
  | "PHASE_DESYNC"
  // createGame rejections. They live in the SAME union as the action codes so
  // a host (the P4 Worker above all) has one `switch (error.code)` to write,
  // not two disjoint ones over two identical-looking envelopes.
  | "BAD_DECK_SIZE"
  | "UNKNOWN_CARD_ID"
  | "NO_BASIC_POKEMON";

export interface EngineError {
  code: ErrorCode;
  message: string;
}

/** Illegal actions NEVER throw and NEVER mutate — they come back as
    ok:false with a stable code (the authoritative P4 server keys off it). */
export type ApplyResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: EngineError };

export function ok(state: GameState, events: GameEvent[]): ApplyResult {
  return { ok: true, state, events };
}

export function err(code: ErrorCode, message: string): ApplyResult {
  return { ok: false, error: { code, message } };
}
