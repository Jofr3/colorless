import type { Card } from "@luminous/schema";
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

/** §12 condition shape: {Asleep, Paralyzed, Confused} are mutually exclusive
    (one card rotation — applying one REPLACES the others), Poisoned/Burned
    coexist with each other and with the rotation. Set by M3's attack effects
    (effects.ts), ticked by the Pokémon Checkup (flow.ts runCheckup). Poison
    carries its counter amount rather than a bool because §12/§13.1 let
    effects raise it ("Poisoned; put 2 damage counters instead of 1"). */
export interface SpecialConditions {
  rotation: "none" | "asleep" | "paralyzed" | "confused";
  /** Damage placed on it at each Checkup while Poisoned; 0 = not Poisoned. */
  poisonDamage: number;
  burned: boolean;
}

export function noConditions(): SpecialConditions {
  return { rotation: "none", poisonDamage: 0, burned: false };
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
  /** Effect markers ("can't attack next turn", …) — M3+. */
  markers: string[];
  /** Turn it entered play; 0 = during setup. M2's evolution timing ("not the
      turn it came into play", §10) reads this — the separate "no evolving on
      your own first turn" rule is a turn/firstPlayer check, not this field. */
  turnPlayed: number;
}

export function makeInPlay(uid: string, turnPlayed: number): InPlayPokemon {
  return {
    stack: [uid],
    energy: [],
    tools: [],
    damage: 0,
    conditions: noConditions(),
    markers: [],
    turnPlayed,
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
export type GameOverReason = "prizesTaken" | "noPokemon" | "deckOut";

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
  /** §9/§15.J — per-Pokémon once-per-turn Ability uses, `${uid}:${ability}`.
      A list, not a bool: several Pokémon may each use a once-per-turn Ability
      in the same turn. Reset each turn, so a plain array clears cleanly. */
  abilitiesUsed: string[];
}

export function freshAllowances(): TurnAllowances {
  return {
    energyAttached: false,
    retreated: false,
    supporterPlayed: false,
    stadiumPlayed: false,
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
  /** §8.1 + §5.3 — the attack's EPILOGUE: sweep BOTH boards for Knock Outs
      (finishAttack owns the [defender, attacker] order + the §14 tie), then end
      `seat`'s (the attacker's) turn through the staged tail. Seeded BEFORE the
      attack's effect program runs and drained by `advance` (flow.ts
      finishAttack), which is what lets that program PARK: a parked attack effect
      leaves this stage sitting in `pending`, and settleProgram's `resumeTail`
      fold resumes draining it once the decision lands. An attack with no effect
      program never queues it (finishAttack runs inline), so the stage exists only
      while an effect is mid-resolution. No `koedSeat`: the sweep reads both boards
      off the post-effect state, so the KO'd seats need not be predeclared. */
  | { kind: "attackEpilogue"; seat: Seat }
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

/** Remove one card uid from a zone array (uids are unique by construction). */
export function without(zone: readonly string[], uid: string): string[] {
  return zone.filter((entry) => entry !== uid);
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
  const everything = [...pokemon.stack, ...pokemon.energy, ...pokemon.tools];
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

/** Move up to `count` cards deck-top → hand and record a CARDS_DRAWN event.
    Callers that care about deck-out (the turn draw, §14.3) check emptiness
    themselves — this helper just draws what is there. */
export function drawToHand(
  state: GameState,
  seat: Seat,
  count: number,
  reason: DrawReason,
  events: GameEvent[],
): GameState {
  if (count <= 0) return state;
  const side = state.players[seat];
  const drawn = side.deck.slice(0, count);
  if (drawn.length === 0) return state;
  events.push({ type: "CARDS_DRAWN", seat, uids: drawn, reason });
  return withSide(state, seat, {
    ...side,
    deck: side.deck.slice(count),
    hand: [...side.hand, ...drawn],
  });
}
