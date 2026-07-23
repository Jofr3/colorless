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

/** One of the viewer's Active's printed attacks, with server-computed
    payability — the online turn HUD (increment 2b) renders a button per entry
    without ever reading the full state the local HUD does (attacksOf / costMet /
    providedEnergy over the raw board). `playable` folds §8.2 payability (under
    the Stadium's continuous cost effects), the §4 first-turn attack ban and the
    §12 immobilize gate exactly as the local TurnPanel's `disabled` — so the
    client needs no engine logic to know what it may attack with. `cost` is the
    PRINTED cost (for the energy dots); `damage` the printed display string (a
    number or a "60+"/"20×" modifier), null when the attack prints no damage.
    Only the viewer's OWN Active's attacks ever appear (their own public table
    facts), and only while it is their `turn:action`. */
export const redactedAttackSchema = z.object({
  /** Index into the Active's printed attacks — the `attack` action's discriminant. */
  index: z.number(),
  name: z.string(),
  cost: z.array(z.string()),
  damage: z.string().nullable(),
  playable: z.boolean(),
});
export type RedactedAttack = z.infer<typeof redactedAttackSchema>;

/** The viewer's OWN retreat option, server-computed for the online turn HUD
    (increment 2b-ii) — like `RedactedAttack`, the client renders the control
    without reading the full state the local TurnPanel does (`effectiveRetreatCost`
    + the §11/§12 gates over the raw board). `cost` is the CONTINUOUS retreat cost
    (§7.3 discounts — the number of attached energies the retreat must discard);
    `can` folds the §12 immobilize gate, the once-per-turn retreated allowance, a
    non-empty Bench (something to promote to) and enough attached energy into ONE
    boolean, EXACTLY the local TurnPanel's `canRetreat` — so the client needs no
    engine logic. The energies to discard and the Bench to promote to are already
    on the public board (the viewer's own attachments + Bench). Only the viewer's
    OWN `turn:action` carries it — null for the non-acting viewer, who never
    retreats. */
export const redactedRetreatSchema = z.object({
  cost: z.number(),
  can: z.boolean(),
});
export type RedactedRetreat = z.infer<typeof redactedRetreatSchema>;

/** The redacted mid-effect prompt (§15.E/G) the answering client renders a
    dialog for — the engine's full `EffectPrompt` mapped to the neutral wire
    shape, exactly as `RedactedGame` does for the board (P4 increment 2b-iii).
    It rides `effect:choose` (below) NULLABLE and is populated ONLY for the seat
    that must answer it (`phase.answerer ?? phase.seat`) — every other viewer
    gets null. That answerer gate is the whole point: a prompt's candidates are
    built from the CONTROLLER's private zones (a deck search's uids, a "look at
    the top N"), so the raw prompt must never reach the other side of the wire.
    `redactedPromptOf` (redact.ts) is STRICTER than `phaseViewOf`'s hot-seat
    `withheld` — the wire delivers a payload to one client, so a controller-
    answered prompt goes to the CONTROLLER ALONE, where the local projection may
    keep it in both viewers' (never-rendered) `pendingDecision`. The two coincide
    exactly when `answerer` is set, which is ALWAYS for `mayDraw`, so a mayDraw
    park still round-trips to the local projection (see redact.ts for the full
    reasoning).

    A DISCRIMINATED UNION on `kind`, mirroring `EffectPrompt`'s arms — but only
    the arm(s) whose online dialog exists so far. **2b-iii-a lands `mayDraw`
    alone** (Ortega's "your opponent may draw a card"): a pure yes/no with a
    `count` + a `note` that speaks to the answerer, and NO card/Pokémon
    references, so it needs no board-relative identity resolution — the ideal
    first arm because it is also the ONE prompt whose answerer is the
    non-controller, which is what makes the answerer gate load-bearing. The
    remaining arms (the public-ref choosePokemon/moveEnergy/discardEnergy family,
    then the hidden-candidate chooseCards/attachCards family that needs
    server-side `RedactedCard` resolution) land in later 2b-iii slices, and
    `resolveEffect` stays off the DO allowlist until every arm is dialoged. */
export const redactedEffectPromptSchema = z.discriminatedUnion("kind", [
  /** A yes/no owed by the ANSWERER (the non-controller): draw `count`, or
      decline. `note` addresses that answerer ("You may draw a card."). No card
      identity crosses — the whole decision is the `count`. */
  z.object({ kind: z.literal("mayDraw"), count: z.number(), note: z.string() }),
]);
export type RedactedEffectPrompt = z.infer<typeof redactedEffectPromptSchema>;

/** The redacted engine `Phase` — the discriminant the client routes ACTIONS
    on (P4 increment 2). Carries the kind plus only the non-sensitive fields the
    acting client needs: setup:drawExtra the RECIPIENT's own owed compensation
    count, setup:place the viewer-relative ready flags, turn:action the viewer's
    OWN attack options (empty for the non-acting viewer) and retreat option (null
    for it), the ko interrupts their counts. The mid-effect `effect:choose`
    carries the redacted `prompt` (above) NULLABLE — non-null only for the seat
    that must answer it, so the controller's private candidates never reach the
    other viewer; null both for the non-answerer AND for a prompt kind whose
    online dialog has not landed yet (only `mayDraw` so far).
    `activePlayer`/`waitingOn` (server-computed via phaseViewOf, which reads the
    pending queue) still say WHO acts; this says WHAT kind. */
export const redactedPhaseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("setup:chooseFirst") }),
  z.object({ kind: z.literal("setup:drawExtra"), owed: z.number() }),
  z.object({
    kind: z.literal("setup:place"),
    ready: z.object({ you: z.boolean(), opponent: z.boolean() }),
  }),
  z.object({
    kind: z.literal("turn:action"),
    attacks: z.array(redactedAttackSchema),
    retreat: redactedRetreatSchema.nullable(),
  }),
  z.object({ kind: z.literal("ko:takePrizes"), count: z.number() }),
  z.object({ kind: z.literal("ko:promote") }),
  z.object({ kind: z.literal("effect:choose"), prompt: redactedEffectPromptSchema.nullable() }),
  z.object({ kind: z.literal("gameOver") }),
]);
export type RedactedPhase = z.infer<typeof redactedPhaseSchema>;

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

/** A game action as it crosses the wire FROM a client (P4 increment 2). The
    engine's `GameAction` is a large discriminated union it keeps as the single
    source of truth; a full Zod mirror here would duplicate it, so the wire
    schema is deliberately LOOSE — an object with a string `type`, all other
    fields preserved (`z.looseObject`) — because the DO does NOT trust it: it
    OVERWRITES `seat` with the socket's own bound seat and hands the action to
    `applyAction`, whose never-throw totality (D14 — the wire's bogus type/seat
    must not throw) is the real validator. A strict object would instead be a
    bug (it would strip the action's uid/target), hence the loose object. */
export const wireActionSchema = z.looseObject({ type: z.string() });
export type WireAction = z.infer<typeof wireActionSchema>;

/** A whole redacted game as one viewer sees it — the `{kind:"match"}` payload. */
export const redactedGameSchema = z.object({
  /** The recipient's own absolute seat — binds their actions (the DO ignores a
      client-claimed seat and uses the socket's, but the client routes on this). */
  seat: matchSeatSchema,
  /** 1-based turn counter; 0 while still in setup. */
  turn: z.number(),
  /** The redacted phase — WHAT kind of action the game is waiting for. */
  phase: redactedPhaseSchema,
  board: redactedBoardSchema,
  /** The turn owner from this viewer's perspective; null in setup, between
      turns (a Checkup-origin KO park) and once the game is over. */
  activePlayer: viewerSchema.nullable(),
  /** Who must act right now; null once the game is over. */
  waitingOn: viewerSchema.nullable(),
  outcome: redactedOutcomeSchema.nullable(),
});
export type RedactedGame = z.infer<typeof redactedGameSchema>;
