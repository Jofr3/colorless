// The authoritative, PURE, per-viewer game redactor (P4). The engine produces
// ONE full-information `GameState`; a client must never see the opponent's hand,
// deck order or prize contents (engine events.ts / setup.ts leave redaction to
// P4). `redactGame(state, seat)` builds the `RedactedGame` wire snapshot one
// viewer at a time — the lobby Durable Object runs it server-side, once per
// connected socket, so no full state ever crosses the network.
//
// It applies the SAME hidden-information rules the web app's playmat projection
// applies for hot-seat play (src/features/game/projection.ts), but produces the
// neutral `@luminous/schema` wire shape instead of playmat `CardModel`s: no
// image URLs (the client builds them from `cardId`), no engine imports on the
// far side. Phase derivation is shared with that projection through
// `phaseViewOf` (phaseView.ts); only the board redaction is restated here,
// against the wire shape.
//
// What crosses the wire per card: PUBLIC cards keep their engine uid as `id`
// (the animation layer tracks one object across zones) plus catalog identity;
// HIDDEN cards carry a POSITIONAL id and the `hidden` sentinel (never the uid —
// leaking it would let a client track a hidden card across zones); empty in-play
// slots the `empty` sentinel. Prizes/decks are counts; the mid-effect decision's
// prompt is dropped (increment 2 designs the redacted prompt).

import type {
  RedactedAttack,
  RedactedCard,
  RedactedGame,
  RedactedInPlay,
  RedactedOutcome,
  RedactedPhase,
  RedactedRetreat,
  RedactedSide,
  Viewer,
} from "@luminous/schema";
import { EMPTY_CARD_ID, EMPTY_CARD_NAME, HIDDEN_CARD_ID, HIDDEN_CARD_NAME } from "@luminous/schema";
import { costMet } from "./attack";
import { attacksOf, cardOfUid, topCardOf, topUid } from "./cards";
import { effectiveAttackCost, effectiveMaxHp, effectiveRetreatCost, providedEnergy } from "./continuous";
import { inSetup, phaseViewOf } from "./phaseView";
import type { GameOutcome, GameState, InPlayPokemon, Seat, SpecialConditions } from "./types";
import { isImmobilized, otherSeat } from "./types";

/** Redact `state` for `viewerSeat`: same state + seat in, structurally-equal
    snapshot out. Pure — nothing aliases the input state. */
export function redactGame(state: GameState, viewerSeat: Seat): RedactedGame {
  const opponentSeat = otherSeat(viewerSeat);
  const view = phaseViewOf(state, viewerSeat);
  // Setup placements are face-down until both players ready, so the opponent's
  // in-play stacks (battle rows included) redact until then. The viewer's own
  // placements stay face-up — they placed them.
  const setup = inSetup(state);
  return {
    seat: viewerSeat,
    turn: state.turn,
    phase: redactPhase(state, viewerSeat),
    board: {
      // §7.3 — the one shared Stadium, public to both viewers.
      stadium: state.stadium === null ? null : redactedCardOf(state, state.stadium.uid),
      you: redactedSideOf(state, viewerSeat, { faceUpHand: true, faceUpInPlay: true }),
      opponent: redactedSideOf(state, opponentSeat, { faceUpHand: false, faceUpInPlay: !setup }),
    },
    activePlayer: asViewer(view.activeSeat, viewerSeat),
    waitingOn: asViewer(view.waitingSeat, viewerSeat),
    outcome: view.outcome === null ? null : redactOutcome(view.outcome, viewerSeat),
  };
}

/** The redacted phase — the discriminant the client routes ACTIONS on. Carries
    the kind plus only non-sensitive fields (setup:drawExtra the viewer's OWN
    owed compensation count, setup:place the viewer-relative ready flags,
    turn:action the viewer's OWN attack options, the ko interrupts their counts);
    the effect:choose prompt is dropped. */
function redactPhase(state: GameState, viewerSeat: Seat): RedactedPhase {
  const phase = state.phase;
  switch (phase.kind) {
    case "setup:chooseFirst":
      return { kind: "setup:chooseFirst" };
    case "setup:drawExtra":
      return { kind: "setup:drawExtra", owed: phase.owed[viewerSeat] };
    case "setup:place":
      return {
        kind: "setup:place",
        ready: { you: phase.ready[viewerSeat], opponent: phase.ready[otherSeat(viewerSeat)] },
      };
    case "turn:action":
      // turn:action's actor is phase.seat (phaseView) — only they get an attack
      // list and a retreat option; the opponent's view of the same phase carries
      // neither (empty attacks, null retreat).
      return {
        kind: "turn:action",
        attacks: redactedAttacksOf(state, viewerSeat, phase.seat),
        retreat: redactedRetreatOf(state, viewerSeat, phase.seat),
      };
    case "ko:takePrizes":
      return { kind: "ko:takePrizes", count: phase.count };
    case "ko:promote":
      return { kind: "ko:promote" };
    case "effect:choose":
      return { kind: "effect:choose" };
    case "gameOver":
      return { kind: "gameOver" };
  }
}

/** The acting viewer's Active's attacks with server-computed payability, for the
    online turn HUD — the opponent's view of the same turn gets [] (only the turn
    owner may attack). Mirrors GameHud's TurnPanel `disabled` on the full state
    the wire deliberately withholds: §8.2 payability under the Stadium's
    continuous cost effects (effectiveAttackCost + providedEnergy), the §4
    first-turn ban, and the §12 immobilize gate — folded into one `playable`
    boolean so the client needs no engine logic. Own Active only (public), so no
    hidden information leaves the DO. */
function redactedAttacksOf(state: GameState, viewerSeat: Seat, turnSeat: Seat): RedactedAttack[] {
  if (viewerSeat !== turnSeat) return [];
  const active = state.players[viewerSeat].active;
  if (active === null) return [];
  const card = topCardOf(state, active);
  if (card === undefined) return [];
  const provided = providedEnergy(state, active);
  // §4 — turn 1 is by construction the going-first player's turn (the same
  // check the local TurnPanel makes); §12 asleep/paralyzed blocks attacking.
  const banned = state.turn === 1 || isImmobilized(active.conditions);
  return attacksOf(card).map((attack, index) => ({
    index,
    name: attack.name,
    cost: [...(attack.cost ?? [])],
    damage: attack.damage === undefined ? null : String(attack.damage),
    playable: !banned && costMet(effectiveAttackCost(state, active, attack.cost ?? []), provided),
  }));
}

/** The acting viewer's retreat option for the online turn HUD — null for the
    opponent (only the turn owner retreats). Mirrors GameHud's TurnPanel
    `canRetreat` on the full state the wire withholds: the CONTINUOUS retreat cost
    (§7.3 — Beach Court discounts Basics), and a `can` folding the §12 immobilize
    gate (asleep/paralyzed blocks retreating), the once-per-turn `retreated`
    allowance, a non-empty Bench (something to promote to) and enough attached
    energy to pay the cost. The energies to discard and the Bench are already on
    the public board, so nothing hidden leaves the DO. */
function redactedRetreatOf(state: GameState, viewerSeat: Seat, turnSeat: Seat): RedactedRetreat | null {
  if (viewerSeat !== turnSeat) return null;
  const active = state.players[viewerSeat].active;
  if (active === null) return null;
  const cost = effectiveRetreatCost(state, active);
  const can =
    !isImmobilized(active.conditions) &&
    !state.allowances.retreated &&
    state.players[viewerSeat].bench.length > 0 &&
    active.energy.length >= cost;
  return { cost, can };
}

/** How much of a side the viewer may see. The two redactions are independent:
    the opponent's HAND is always face-down, their IN-PLAY stacks only during
    setup. The viewer's own side is always fully face-up. */
interface SideVisibility {
  faceUpHand: boolean;
  faceUpInPlay: boolean;
}

function redactedSideOf(state: GameState, seat: Seat, visibility: SideVisibility): RedactedSide {
  const side = state.players[seat];
  return {
    hand: visibility.faceUpHand
      ? side.hand.map((uid) => redactedCardOf(state, uid))
      : hiddenHand(side.hand.length),
    active:
      side.active === null
        ? null
        : visibility.faceUpInPlay
          ? redactedInPlayOf(state, side.active)
          : hiddenInPlay("opponent-active-hidden"),
    // Index-stable: an (engine-impossible) empty stack projects as a slot
    // placeholder rather than vanishing — compacting the bench would desync
    // every index-addressed slot from the engine's.
    bench: visibility.faceUpInPlay
      ? side.bench.map(
          (pokemon, index) => redactedInPlayOf(state, pokemon) ?? emptySlot(seat, index),
        )
      : side.bench.map((_, index) => hiddenInPlay(`opponent-bench-${index}-hidden`)),
    // Counts only — prizes are face-down for BOTH players (§3.8), so no uid or
    // catalog id of a prize or deck card may appear anywhere.
    prizesRemaining: side.prizes.length,
    deckCount: side.deck.length,
    // §2 — the discard pile is ordered and public.
    discard: side.discard.map((uid) => redactedCardOf(state, uid)),
  };
}

/** A public card: full identity, keyed by its engine uid. Carries the raw
    category + trainerType (the client derives its render type from them) and
    `hasImage` (the client builds the asset URL from `cardId`). */
function redactedCardOf(state: GameState, uid: string): RedactedCard {
  const card = cardOfUid(state, uid);
  if (card === undefined) {
    // Unreachable in practice (createGame validates every deck id against the
    // pool), but the redactor stays total: an identity-only placeholder that
    // still animates under its uid. "Trainer" is the neutral category.
    const cardId = state.cardIdByUid[uid] ?? uid;
    return { id: uid, cardId, name: cardId, category: "Trainer", trainerType: null, hasImage: false };
  }
  return {
    id: uid,
    cardId: card.id,
    name: card.name,
    category: card.category,
    trainerType: card.trainerType,
    hasImage: card.image !== null,
  };
}

/** An in-play Pokémon's top card (§1.2) with its face-up battle row and
    attached energy/tools. Only in-play top cards carry `battle`, and only
    face-up ones — setup-phase hidden backs go through hiddenInPlay so redaction
    never leaks a printed HP. */
function redactedInPlayOf(state: GameState, pokemon: InPlayPokemon): RedactedInPlay | null {
  const uid = topUid(pokemon);
  if (uid === undefined) return null; // stacks are never empty, but stay total
  return {
    ...redactedCardOf(state, uid),
    battle: {
      damage: pokemon.damage,
      // The CONTINUOUS max HP (printed + Tool bonuses), the number the engine's
      // KO check reads; null stays the data gap.
      hp: effectiveMaxHp(state, pokemon),
      conditions: copyConditions(pokemon.conditions),
    },
    attached: {
      tools: pokemon.tools.map((toolUid) => redactedCardOf(state, toolUid)),
      energies: pokemon.energy.map((energyUid) => redactedCardOf(state, energyUid)),
    },
  };
}

/** A field-by-field COPY (never an alias) of the engine conditions — a consumer
    mutating a snapshot must not reach back into game state. The `satisfies`
    makes an added engine field a compile error here rather than a silent drop. */
function copyConditions(conditions: SpecialConditions): SpecialConditions {
  const { rotation, poisonDamage, burned } = conditions;
  return { rotation, poisonDamage, burned } satisfies SpecialConditions;
}

/** Face-down backs for the opponent's hand. Ids are positional
    (`opponent-hand-N`), NOT the engine uids: a uid is stable across zones, so
    leaking it here would let a client track a specific hidden card from the
    moment it was drawn — exactly what redaction must prevent. */
function hiddenHand(count: number): RedactedCard[] {
  return Array.from({ length: count }, (_, index) => hiddenCard(`opponent-hand-${index}`));
}

/** A face-down back for an opponent in-play stack during setup. Positional id,
    NOT the engine uid (same reason as hiddenHand). No battle row / attachments
    — a battle row would leak the printed HP. */
function hiddenInPlay(id: string): RedactedInPlay {
  return hiddenCard(id);
}

function hiddenCard(id: string): RedactedCard {
  return {
    id,
    cardId: HIDDEN_CARD_ID,
    name: HIDDEN_CARD_NAME,
    category: "Trainer", // neutral, mirrors the synthetic deck/prize backs
    trainerType: null,
    hasImage: false,
  };
}

/** The slot-holder for an (engine-impossible) empty in-play stack. Positional
    id like the hidden backs; a distinct `empty` sentinel because "empty" is NOT
    a face-down card — there is nothing there. */
function emptySlot(seat: Seat, index: number): RedactedCard {
  return {
    id: `${seat}-bench-${index}-empty`,
    cardId: EMPTY_CARD_ID,
    name: EMPTY_CARD_NAME,
    category: "Trainer",
    trainerType: null,
    hasImage: false,
  };
}

/** Engine seat → the viewer's vocabulary. */
function asViewer(seat: Seat | null, viewerSeat: Seat): Viewer | null {
  if (seat === null) return null;
  return seat === viewerSeat ? "you" : "opponent";
}

/** Viewer-map a finished game's outcome — fresh objects, nothing aliased. */
function redactOutcome(outcome: GameOutcome, viewerSeat: Seat): RedactedOutcome {
  if (outcome.result === "win") {
    return {
      result: "win",
      winner: outcome.winner === viewerSeat ? "you" : "opponent",
      reason: outcome.reason,
    };
  }
  return {
    result: "tie",
    reasons: {
      you: outcome.reasons[viewerSeat],
      opponent: outcome.reasons[otherSeat(viewerSeat)],
    },
  };
}
