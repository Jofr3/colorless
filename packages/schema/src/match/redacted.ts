// The REDACTED game snapshot the authoritative match server (the lobby Durable
// Object, P4) broadcasts to each connected client. The engine produces one
// full-information `GameState`; redaction is explicitly P4's job (engine
// events.ts / setup.ts). `redactGame(state, seat)` (packages/engine) builds one
// of these PER VIEWER, applying the same hidden-information rules the web app's
// client-side playmat projection already applies for hot-seat play
// (src/features/game/projection.ts):
//
//   - the viewer's own hand face-up; the opponent's hand as a COUNT of
//     anonymous backs (no uid, no card id — a positional id only);
//   - BOTH prize sets as counts (§3.8 — face-down for both players);
//   - decks as counts; discard piles fully public (§2 — ordered and public);
//   - in-play Pokémon public once setup is over, with their battle row (damage /
//     max HP / §12 conditions) and attached energy/tools; DURING setup the
//     OPPONENT's placements are anonymous backs with no battle row (a battle row
//     would leak the printed HP).
//
// The type is VIEWER-RELATIVE ("you" / "opponent"), so a payload only ever
// carries the recipient's own full side plus the opponent's redacted side — no
// absolute-seat map that could be populated with both sides' hidden zones. The
// recipient's own `seat` (which they always know) rides along for the action
// binding P4 increment 2 needs.
//
// This module is the SINGLE SOURCE OF TRUTH for the shape: the Zod schema below
// defines it and the exported types are inferred from it (the catalog `Card`
// pattern), so the wire schema and the TS type cannot drift. The engine imports
// these types and builds objects matching them; the web client renders them.

import { z } from "zod";
import { cardCategorySchema } from "../catalog/card";

/** Viewer-relative player id. Structurally the web playmat's `PlayerId`, kept
    independent here so schema imports no web types. */
export const viewerSchema = z.enum(["you", "opponent"]);
export type Viewer = z.infer<typeof viewerSchema>;

/** The recipient's own absolute seat — mirrors the engine's `Seat`. Not a leak
    (you always know which seat you are); forward-useful for binding actions. */
export const matchSeatSchema = z.enum(["p1", "p2"]);
export type MatchSeat = z.infer<typeof matchSeatSchema>;

/** §14 end conditions — mirrors the engine's `GameOverReason`. */
export const redactedGameOverReasonSchema = z.enum(["prizesTaken", "noPokemon", "deckOut"]);
export type RedactedGameOverReason = z.infer<typeof redactedGameOverReasonSchema>;

/** The cardId a hidden (face-down) card carries instead of a catalog id, and
    the id for an (engine-impossible) empty in-play slot. Shared by the engine
    redactor and the web adapter so the sentinels can't drift. */
export const HIDDEN_CARD_ID = "hidden";
export const HIDDEN_CARD_NAME = "Face-down card";
export const EMPTY_CARD_ID = "empty";
export const EMPTY_CARD_NAME = "Empty slot";

/** §12 Special Conditions — mirrors the engine's `SpecialConditions`. */
export const redactedConditionsSchema = z.object({
  /** Asleep/Paralyzed/Confused are mutually exclusive; "none" = upright. */
  rotation: z.enum(["none", "asleep", "paralyzed", "confused"]),
  /** HP placed each Checkup while Poisoned; 0 = not Poisoned. */
  poisonDamage: z.number(),
  burned: z.boolean(),
});
export type RedactedConditions = z.infer<typeof redactedConditionsSchema>;

/** The public battle numbers of an in-play Pokémon's top card. `hp` is the
    CONTINUOUS max HP (printed + Tool bonuses), null on a catalog data gap. */
export const redactedBattleSchema = z.object({
  damage: z.number(),
  hp: z.number().nullable(),
  conditions: redactedConditionsSchema,
});
export type RedactedBattle = z.infer<typeof redactedBattleSchema>;

/** A card as it crosses the wire. A PUBLIC card carries its full identity keyed
    by the engine uid (`id`), so the animation layer tracks it as one object
    across zones. A HIDDEN card carries a POSITIONAL id (never the uid — leaking
    it would let a client track a hidden card across zones) and the `hidden`
    sentinel cardId; an empty in-play slot the `empty` sentinel. `hasImage` says
    whether the card has scan art — the client builds the asset URL from
    `cardId`, keeping the asset scheme on the client. Leaf cards only (hand,
    discard, attachments, stadium, hidden/empty placeholders): battle rows and
    attachments live on `RedactedInPlay`. */
export const redactedCardSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  name: z.string(),
  category: cardCategorySchema,
  /** Trainer subtype (drives the Tool/Stadium/Item distinction); null off-Trainer. */
  trainerType: z.string().nullable(),
  hasImage: z.boolean(),
});
export type RedactedCard = z.infer<typeof redactedCardSchema>;

/** An in-play Pokémon's TOP card: a `RedactedCard` plus, when face-up, its
    battle row and attached energy/tools. A face-down setup back / empty slot
    carries neither (both optional). */
export const redactedInPlaySchema = redactedCardSchema.extend({
  battle: redactedBattleSchema.optional(),
  attached: z
    .object({
      tools: z.array(redactedCardSchema),
      energies: z.array(redactedCardSchema),
    })
    .optional(),
});
export type RedactedInPlay = z.infer<typeof redactedInPlaySchema>;

/** One player's redacted side. Own side: hand face-up. Opponent: hand a count
    of backs, in-play redacted during setup. Prizes/deck are counts for both;
    discard is public for both. */
export const redactedSideSchema = z.object({
  hand: z.array(redactedCardSchema),
  active: redactedInPlaySchema.nullable(),
  bench: z.array(redactedInPlaySchema),
  prizesRemaining: z.number(),
  deckCount: z.number(),
  discard: z.array(redactedCardSchema),
});
export type RedactedSide = z.infer<typeof redactedSideSchema>;

export const redactedBoardSchema = z.object({
  /** §7.3 — the one shared Stadium, public to both viewers. */
  stadium: redactedCardSchema.nullable(),
  you: redactedSideSchema,
  opponent: redactedSideSchema,
});
export type RedactedBoard = z.infer<typeof redactedBoardSchema>;

/** The interrupt the game is parked on — COUNTS ONLY, never card identity. The
    mid-effect `effectChoose` carries no prompt this increment (the read-only
    board renders no decision; increment 2 designs the redacted prompt). */
export const redactedDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("takePrizes"), count: z.number() }),
  z.object({ kind: z.literal("promote") }),
  z.object({ kind: z.literal("effectChoose") }),
]);
export type RedactedDecision = z.infer<typeof redactedDecisionSchema>;

/** How a finished game ended, seats mapped into the viewer's vocabulary. */
export const redactedOutcomeSchema = z.discriminatedUnion("result", [
  z.object({
    result: z.literal("win"),
    winner: viewerSchema,
    reason: redactedGameOverReasonSchema,
  }),
  z.object({
    result: z.literal("tie"),
    reasons: z.object({ you: redactedGameOverReasonSchema, opponent: redactedGameOverReasonSchema }),
  }),
]);
export type RedactedOutcome = z.infer<typeof redactedOutcomeSchema>;

/** A whole redacted game as one viewer sees it — the `{kind:"match"}` payload. */
export const redactedGameSchema = z.object({
  /** The recipient's own absolute seat (not a leak; binds their actions in P4.2). */
  seat: matchSeatSchema,
  /** 1-based turn counter; 0 while still in setup. */
  turn: z.number(),
  board: redactedBoardSchema,
  /** The turn owner from this viewer's perspective; null in setup, between
      turns (a Checkup-origin KO park) and once the game is over. */
  activePlayer: viewerSchema.nullable(),
  /** Who must act right now; null once the game is over. */
  waitingOn: viewerSchema.nullable(),
  pendingDecision: redactedDecisionSchema.nullable(),
  outcome: redactedOutcomeSchema.nullable(),
});
export type RedactedGame = z.infer<typeof redactedGameSchema>;
