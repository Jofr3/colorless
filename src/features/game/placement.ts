// Drop-legality predicate for /play (the engine-driven game page). The mock
// sandbox's canPlace answers "is this a sensible tabletop move?" with no idea
// of phases; on /play legality belongs to the engine, so this factory builds
// the PHASE-AWARE gate the animation layer consults for drop-zone filtering,
// the live previews and the accept/reject release animation.
//
// THE CONTRACT — deliberately COARSE, gesture-class not legality simulation:
// the predicate rejects only drops that can NEVER succeed — moveToAction
// would translate them to null (nothing to dispatch, e.g. a hand reorder),
// or the routed action is structurally impossible from this board (attaching
// to an empty slot, a second setup Active, a sixth bench slot). Fine-grained
// legality — Basic-ness, the once-per-turn energy allowance, evolution
// timing (§4/§10), the name match and — 🆕 D292/D293 — the IMPOSED ACE SPEC
// hand-play bar (Genesect `sv06.5-040`, which refuses an ACE SPEC Energy or
// Tool attach outright) — stays with applyAction, whose
// rejection surfaces as the page's error pill: the pill should only ever name
// a rule the user actually gestured at. This keeps the predicate in LOCKSTEP
// with moveToAction: every drop it allows translates to a non-null action of
// the expected type, and every drop it rejects would have translated to null
// or to an action the engine deterministically refuses (placement.test.ts
// enumerates that pairing over real engine states — extend BOTH together;
// M4's evolve-by-drag now routes here, trainer plays are next).

import type { GameState, Phase, Seat } from "@luminous/engine";
import { benchLimitFor } from "../playmat/constants";
import type { PlacementPredicate } from "../playmat/utils/cardMovement";

/** The transport-agnostic slice of the phase the drop gate reads — a phase
    KIND, whether it is the viewer's own turn (`turn:action`), and whether the
    viewer has locked its setup placements (`setup:place`). Kept light so BOTH
    local play — which has the full `Phase` — and online play — which has only a
    redacted phase — build the SAME gate, in lockstep with moveToAction. */
export interface PlacementContext {
  phaseKind: Phase["kind"];
  isViewerTurn: boolean;
  isReady: boolean;
}

/** Local wrapper: derive the drop-gate context from the full engine state.
    `game` is the state the board was projected FROM, `viewerSeat` the seat it
    was projected FOR. Memoizing on [game.phase, viewerSeat] is enough. */
export function gamePlacementPredicate(game: GameState, viewerSeat: Seat): PlacementPredicate {
  const phase = game.phase;
  return placementPredicateFor({
    phaseKind: phase.kind,
    isViewerTurn: phase.kind === "turn:action" && phase.seat === viewerSeat,
    isReady: phase.kind === "setup:place" && phase.ready[viewerSeat],
  });
}

/** Build the /play drop gate from the transport-agnostic context. Occupancy +
    ownership come from the projected board the layer passes at call time (its
    own side is always "you"), so the context alone — no seat — closes it. */
export function placementPredicateFor(ctx: PlacementContext): PlacementPredicate {
  return (board, source, target, sourceType) => {
    // Every translatable move starts in the viewer's own hand and lands on
    // their own board — moveToAction's first gate, mirrored here so a drag
    // that would translate to null never shows a legal-drop affordance.
    // (Board-to-board drags — retreat, promotion — are dialog flows.) The
    // one shared exception, also mirrored: a Stadium aimed at the global
    // stadium slot (§7.3).
    if (source.owner !== "you" || source.zone !== "hand") return false;
    if (target.owner !== "you" && !(target.zone === "stadium" && target.owner === "global")) {
      return false;
    }
    // Hand → hand reorder: fine on the mock (its board owns hand order) but
    // rejected here — the ENGINE owns hand order and has no reorder action,
    // so previewing one would be a lie the projection immediately snaps back.
    if (target.zone === "hand") return false;

    switch (ctx.phaseKind) {
      case "setup:place": {
        // A seat that declared ready has locked its placements — nothing it
        // drops can ever apply (ALREADY_READY).
        if (ctx.isReady) return false;
        // §3.6–§3.7 place Pokémon. Basic-ness is the engine's call
        // (NOT_A_BASIC_POKEMON — a rule a Pokémon drop gestures at), but a
        // non-Pokémon can never be a Basic, so energies/trainers get no
        // placement affordance at all: canPlace's attach branch accepting a
        // setup energy → own occupied Pokémon was the confirmed bug here.
        if (sourceType !== "pokemon") return false;
        if (target.zone === "active") return board.you.active === null;
        if (target.zone === "bench") return board.you.bench.length < benchLimitFor(board);
        return false;
      }
      case "turn:action": {
        // Not this seat's turn — nothing translates. (A parked interrupt is
        // a different phase kind and falls through to the default below.)
        if (!ctx.isViewerTurn) return false;
        if (sourceType === "energy") {
          // attachEnergy needs an existing own Pokémon host. Occupancy is
          // structural (an empty slot can never host); whether THIS energy
          // may attach right now is the engine's — and 🆕 D293 measured that
          // TWO rules now live behind that deferral, not one: §6.2's
          // once-per-turn allowance AND the ACE SPEC bar D292 added to
          // `attachEnergy`. **THE GATE COULD NOT REFUSE THE SECOND EVEN IF IT
          // WANTED TO**: `PlacementContext` carries a phase kind, a turn bit
          // and a ready bit and no CARD IDENTITY at all, deliberately, so that
          // local and online build the same gate. Driven end to end
          // (`GameHud.aceSpecBar.dom.test.tsx` §3/§4), a barred ACE SPEC Energy
          // is OFFERED on both transports, translates to a real `attachEnergy`
          // and is refused `HAND_PLAY_BLOCKED` — afford-then-reject, and the
          // refusal costs the seat neither the card nor the allowance.
          if (target.zone === "active") return board.you.active?.type === "pokemon";
          if (target.zone === "bench") {
            // A whole-zone container drop carries no index → no host slot.
            if (target.index === undefined) return false;
            return board.you.bench[target.index]?.type === "pokemon";
          }
          return false;
        }
        if (sourceType === "pokemon") {
          // A Pokémon dropped ONTO an own occupant is an evolve gesture (§10):
          // the Active always hosts one, and a bench drop hosts one when the
          // indexed slot is occupied. Whether the card actually evolves from
          // that target (name match, timing) stays the engine's — the pill
          // then names a rule the drop gestured at. A bench drop on a free
          // slot is playBasicToBench (dense append; the index is cosmetic).
          if (target.zone === "active") return board.you.active?.type === "pokemon";
          if (target.zone !== "bench") return false;
          if (target.index !== undefined && board.you.bench[target.index]?.type === "pokemon") {
            return true; // evolve the benched Pokémon at this slot
          }
          return board.you.bench.length < benchLimitFor(board); // play a Basic
        }
        if (sourceType === "tool") {
          // attachTool needs an existing own Pokémon host — the energy-attach
          // affordance shape (§7.4). One-Tool-per-Pokémon is fine legality
          // and stays the engine's (the pill).
          if (target.zone === "active") return board.you.active?.type === "pokemon";
          if (target.zone === "bench") {
            if (target.index === undefined) return false;
            return board.you.bench[target.index]?.type === "pokemon";
          }
          return false;
        }
        if (sourceType === "stadium") {
          // A Stadium play aims at the shared slot (§7.3) — the global-owner
          // exception let through above. Same-name / once-per-turn stay the
          // engine's (the pill names the rule the drop gestured at).
          return target.zone === "stadium" && target.owner === "global";
        }
        // Non-Tool/Stadium Trainers stay button plays, not drags.
        return false;
      }
      // chooseFirst / drawExtra / ko:* interrupts / gameOver: decisions are
      // buttons and dialogs — no drop can translate to an action.
      default:
        return false;
    }
  };
}
