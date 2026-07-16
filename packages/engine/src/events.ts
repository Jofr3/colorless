import type { DamageModifier } from "./cards";
import type { CoinFace } from "./rng";
import type { GameOutcome, PokemonTarget, Seat } from "./types";

// GameEvents are the animation and wire contract (simulator.md): semantic
// "what happened" facts, never "how to render" instructions. Every state
// change the reducer makes is described by the events it returns alongside.
// M1 events are full-information — hidden-info filtering is P4's job.
//
// Payload arrays are always COPIES, never the state's own arrays or the
// caller's action arrays: an event is a value handed to consumers (animators,
// the P4 broadcast, a persisted log), and a consumer that sorts or splices one
// must not be able to reach back into game state or into a retained snapshot.

/** Why cards moved deck → hand; lets the UI animate each draw differently. */
export type DrawReason = "opening" | "mulligan" | "compensation" | "turnStart";

export type GameEvent =
  | { type: "SHUFFLE"; seat: Seat }
  | { type: "COIN_FLIP"; result: CoinFace; winner: Seat }
  | { type: "FIRST_PLAYER_CHOSEN"; first: Seat; chosenBy: Seat }
  | { type: "CARDS_DRAWN"; seat: Seat; uids: string[]; reason: DrawReason }
  /** A hand with no Basic Pokémon, shown before it is shuffled back (§3.5). */
  | { type: "MULLIGAN_REVEALED"; seat: Seat; hand: string[] }
  /** Setup placement — face-down until SETUP_REVEALED. */
  | { type: "POKEMON_PLACED"; seat: Seat; uid: string; spot: "active" | "bench" }
  /** In-turn Basic played to the bench (§5.2). */
  | { type: "POKEMON_BENCHED"; seat: Seat; uid: string }
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
      The bench stays dense, so the swap re-indexes it: the promoted Pokémon
      vacates `promotedFrom` (everything after it slides down one) and the
      retreater lands at `benchedTo`. Both indices are in the payload so an
      animator — or a P4 client addressing the bench positionally — never has
      to re-derive the reducer's compaction rule. `discardedEnergy` lists the
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
  /** `seat`'s Active declared its printed attack `attack` (index into the
      top card's attacks); `uid` is the attacker's top card. */
  | { type: "ATTACK_DECLARED"; seat: Seat; uid: string; attack: string; index: number }
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
  /** Attack damage landing on the Defending Pokémon with the §8.5 math
      spelled out for the animator: base → weakness → resistance, floored at
      0. `weakness`/`resistance` are the PARSED printed modifiers as applied
      (modern weakness multiplies ×2, the old-era prints add +20, resistance
      subtracts — cards.ts DamageModifier); null = did not apply.
      `seat`/`uid` name the DEFENDER (the seat owns the uid, as everywhere),
      `dealt` what this attack added and `damage` the defender's cumulative
      total after. */
  | {
      type: "DAMAGE_DEALT";
      seat: Seat;
      uid: string;
      base: number;
      weakness: DamageModifier | null;
      resistance: DamageModifier | null;
      dealt: number;
      damage: number;
    }
  /** §8.1 — `seat`'s `uid` was Knocked Out: the whole stack (evolution
      cards, energy, tools) left play for `seat`'s discard; `discarded` lists
      every uid that moved, in pile order. */
  | { type: "KNOCKED_OUT"; seat: Seat; uid: string; discarded: string[] }
  /** `seat` owes a prize pick (which face-down cards, §8.1) — announced when
      the game parks on ko:takePrizes so an event-only client never hangs on
      an unseen prompt. Forced picks resolve straight to PRIZES_TAKEN. */
  | { type: "PRIZES_OWED"; seat: Seat; count: number }
  /** `seat` took face-down prizes into hand. `indices` are the slots picked
      (the prize row compacts like the bench); full-information like every M1
      event — hiding the uids from the opponent is P4's filter. */
  | { type: "PRIZES_TAKEN"; seat: Seat; uids: string[]; indices: number[]; remaining: number }
  /** `seat` must promote a benched Pokémon into the empty Active spot
      (§8.1) — the ko:promote prompt twin of PRIZES_OWED. */
  | { type: "PROMOTION_REQUIRED"; seat: Seat }
  /** `uid` (top of its stack) moved bench → Active; the bench compacts the
      same way RETREATED describes. */
  | { type: "POKEMON_PROMOTED"; seat: Seat; uid: string; benchIndex: number }
  | { type: "TURN_ENDED"; turn: number; seat: Seat }
  | { type: "GAME_OVER"; outcome: GameOutcome };
