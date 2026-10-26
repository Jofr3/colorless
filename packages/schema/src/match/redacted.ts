// The per-viewer redacted snapshot built by `redactGame`. The opponent's hand is a count of backs,
// face-down prizes and decks are counts, and opponent setup placements are anonymous; discard and
// face-up prizes are public. It is viewer-relative so a payload never carries both sides' hidden
// zones. Types are inferred from the Zod schema.

import * as z from "zod";
import { cardCategorySchema } from "../catalog/card";

/** Viewer-relative player id. Structurally the web playmat's `PlayerId`, kept
    independent here so schema imports no web types. */
export const viewerSchema = z.enum(["you", "opponent"]);
export type Viewer = z.infer<typeof viewerSchema>;

/** The recipient's own absolute seat — mirrors the engine's `Seat`. Not a leak
    (you always know which seat you are); forward-useful for binding actions. */
export const matchSeatSchema = z.enum(["p1", "p2"]);
export type MatchSeat = z.infer<typeof matchSeatSchema>;

/**
 * Mirrors the engine `GameOverReason`. `conceded` covers both conceding and an online abandon
 * timeout; `cardEffect` is a card's printed win. Adding a value requires deploying the client
 * first.
 */
export const redactedGameOverReasonSchema = z.enum([
  "prizesTaken",
  "noPokemon",
  "deckOut",
  "conceded",
  "cardEffect",
]);
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
  /**
   * Damage a Confused Pokémon places on itself when the attack flip misses; 30 unless the
   * inflicting effect raised it. Meaningful only while `rotation === "confused"`.
   */
  confusionDamage: z.number(),
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

/**
 * A card as it crosses the wire. A public card is keyed by its engine uid; a hidden card carries a
 * positional id (never the uid) and the `hidden` sentinel, an empty slot the `empty` sentinel.
 * `hasImage` says whether scan art exists.
 */
export const redactedCardSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  name: z.string(),
  category: cardCategorySchema,
  /** Trainer subtype (drives the Tool/Stadium/Item distinction); null off-Trainer. */
  trainerType: z.string().nullable(),
  /** Printed Pokémon stage for placement previews; omitted on hidden cards. */
  stage: z.string().nullable().optional(),
  /** Legal evolution hosts for an own hand card; absent on hidden cards. */
  evolutionTargetIds: z.array(z.string()).optional(),
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

/** A face-up prize: its slot in the prize row and the card, which is public. */
export const redactedFaceUpPrizeSchema = z.object({
  index: z.number(),
  card: redactedCardSchema,
});
export type RedactedFaceUpPrize = z.infer<typeof redactedFaceUpPrizeSchema>;

/**
 * One player's redacted side. Own hand face up, opponent's as a count of backs; prizes and deck are
 * counts; discard and face-up prizes are public.
 */
export const redactedSideSchema = z.object({
  hand: z.array(redactedCardSchema),
  active: redactedInPlaySchema.nullable(),
  bench: z.array(redactedInPlaySchema),
  prizesRemaining: z.number(),
  /**
   * Face-up slots of this side's prize row, in row order; `[]` when none. Face-down prizes cross
   * only as the count.
   */
  faceUpPrizes: z.array(redactedFaceUpPrizeSchema),
  deckCount: z.number(),
  /** Public bonus card count; cleared when this player draws the cards. */
  mulliganCount: z.number().int().nonnegative().optional(),
  discard: z.array(redactedCardSchema),
  /** This side's Bench limit when a card widens it; absent at the usual 5. */
  benchLimit: z.number().int().positive().optional(),
});
export type RedactedSide = z.infer<typeof redactedSideSchema>;

export const redactedBoardSchema = z.object({
  /** §7.3 — the one shared Stadium, public to both viewers. */
  stadium: redactedCardSchema.nullable(),
  you: redactedSideSchema,
  opponent: redactedSideSchema,
});
export type RedactedBoard = z.infer<typeof redactedBoardSchema>;

/**
 * One row of the viewer's Active's attack menu (printed attacks, then Memory Dive rows, then an
 * attached Technical Machine's) with server-computed `playable`. `cost` is the cost printed on the
 * row's own card; `damage` is the printed display string or null. Only the viewer's own Active,
 * during their `turn:action`.
 */
export const redactedAttackSchema = z.object({
  /**
   * Index into the Active's attack menu (`attackMenuOf`); printed attacks come first at their
   * printed index. The `attack` action's discriminant.
   */
  index: z.number(),
  name: z.string(),
  /** The PRINTED cost — the symbols on the card face, unchanged since increment 2b
      and deliberately still meaning exactly that. See `effectiveCost` below. */
  cost: z.array(z.string()),
  /**
   * The cost the §8.2 gate actually charges, present only when it differs from the printed `cost`;
   * render `effectiveCost ?? cost`. A sibling field so `cost` keeps meaning the printed cost.
   */
  effectiveCost: z.array(z.string()).optional(),
  damage: z.string().nullable(),
  playable: z.boolean(),
});
export type RedactedAttack = z.infer<typeof redactedAttackSchema>;

/**
 * The viewer's own retreat option. `cost` is the continuous retreat cost; `can` folds every retreat
 * gate into one boolean. Null for the non-acting viewer.
 */
export const redactedRetreatSchema = z.object({
  cost: z.number(),
  can: z.boolean(),
});
export type RedactedRetreat = z.infer<typeof redactedRetreatSchema>;

/** A seatless in-play spot on the acting viewer's OWN side — the wire mirror of
    the engine's `PokemonTarget` (which is exactly `RedactedPokemonRef.spot`, kept
    a standalone union here rather than shared to keep that ref's discriminated
    inference untouched). The `useAbility` action (increment 3b) dispatches one back
    VERBATIM: an Ability is always on the actor's own board, so no seat is carried
    (the DO rebinds the acting seat regardless). */
export const redactedPokemonTargetSchema = z.discriminatedUnion("spot", [
  z.object({ spot: z.literal("active") }),
  z.object({ spot: z.literal("bench"), index: z.number() }),
]);
export type RedactedPokemonTarget = z.infer<typeof redactedPokemonTargetSchema>;

/**
 * An activated Ability on the acting viewer's own Pokémon. `disabled` folds every gate; `reason` is
 * the tooltip for a greyed row (null when enabled or self-evident); `target` is dispatched back
 * verbatim; `label` disambiguates copies. [] for the non-acting viewer.
 */
export const redactedAbilitySchema = z.object({
  target: redactedPokemonTargetSchema,
  abilityName: z.string(),
  label: z.string(),
  disabled: z.boolean(),
  reason: z.string().nullable(),
});
export type RedactedAbility = z.infer<typeof redactedAbilitySchema>;

/**
 * A Trainer playable from the acting viewer's hand (Item, Supporter, Stadium or Rare Candy).
 * `disabled` folds every gate; `reason` is the tooltip for a greyed row. A Rare Candy row
 * (`rareCandy`) opens a pairing dialog instead of dispatching `playTrainer`. [] for the non-acting
 * viewer.
 */
export const redactedTrainerSchema = z.object({
  uid: z.string(),
  name: z.string(),
  disabled: z.boolean(),
  reason: z.string().nullable(),
  /** Rare Candy (§7.1) — the row opens the Rare Candy dialog (the phase's
      `rareCandy` pairings) rather than dispatching `playTrainer`, mirroring the
      local `TrainerOption.rareCandy`. `disabled` already folds "no legal pairing
      right now", so a lit row always has at least one option to show. */
  rareCandy: z.boolean(),
});
export type RedactedTrainer = z.infer<typeof redactedTrainerSchema>;

/**
 * One legal Rare Candy pairing (a Basic in play, a Stage 2 in hand) from the engine's
 * `rareCandyOptions`; the handler still re-validates. Names are display strings for cards already
 * face up to this viewer.
 */
export const redactedRareCandyOptionSchema = z.object({
  target: redactedPokemonTargetSchema,
  basicUid: z.string(),
  basicName: z.string(),
  /** The matching Stage 2 cards in the actor's own hand — `uid` is what the
      action's `evolutionUid` dispatches back. Never empty (the engine only
      offers a Basic that has one). */
  stage2: z.array(z.object({ uid: z.string(), name: z.string() })),
});
export type RedactedRareCandyOption = z.infer<typeof redactedRareCandyOptionSchema>;

/**
 * §7.3: the shared Stadium's once-per-turn activated ability. Null for the non-acting viewer, with
 * no Stadium in play, or for a continuous-only Stadium. `disabled` folds the engine's gate; `label`
 * is the Stadium's name.
 */
export const redactedStadiumAbilitySchema = z.object({
  label: z.string(),
  disabled: z.boolean(),
  reason: z.string().nullable(),
});
export type RedactedStadiumAbility = z.infer<typeof redactedStadiumAbilitySchema>;

/**
 * An own in-play body whose top card may be discarded from play now (an Antique Fossil). `target`
 * is dispatched back verbatim to `discardFromPlay`. [] outside the acting viewer's main phase.
 */
export const redactedDiscardableSchema = z.object({
  target: redactedPokemonTargetSchema,
  label: z.string(),
});
export type RedactedDiscardable = z.infer<typeof redactedDiscardableSchema>;

/**
 * Wire mirror of `PokemonRef`. `seat` is absolute, not viewer-relative, so refs round-trip to the
 * engine and back verbatim; not a leak, since in-play Pokémon are public.
 */
export const redactedPokemonRefSchema = z.object({
  seat: matchSeatSchema,
  spot: z.discriminatedUnion("spot", [
    z.object({ spot: z.literal("active") }),
    z.object({ spot: z.literal("bench"), index: z.number() }),
  ]),
});
export type RedactedPokemonRef = z.infer<typeof redactedPokemonRefSchema>;

/**
 * How many cards a discard prompt asks for: `total` is exactly `count` uids, `each` is one per
 * offered host, `upTo` is 0 to `max` (declinable). `max` rather than `count` because it is a
 * ceiling.
 */
export const redactedDiscardScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("total"), count: z.number() }),
  z.object({ kind: z.literal("each") }),
  z.object({ kind: z.literal("upTo"), max: z.number() }),
]);
export type RedactedDiscardScope = z.infer<typeof redactedDiscardScopeSchema>;

/** One offered Energy — an attached uid paired with the Pokémon it sits on —
    shared by `moveEnergy` (movable) and `discardEnergy` (discardable). The uid
    is a public attached-Energy uid on `from`'s in-play stack, so the client
    resolves its display name off the board it already has. */
export const redactedEnergyOfferSchema = z.object({
  uid: z.string(),
  from: redactedPokemonRefSchema,
});
export type RedactedEnergyOffer = z.infer<typeof redactedEnergyOfferSchema>;

/**
 * The redacted mid-effect prompt, sent only to the seat that answers it (`phase.answerer ??
 * phase.seat`), because candidates can come from the answerer's private zones. Public-ref arms
 * carry board refs; hidden-candidate arms carry a resolved `RedactedCard` per candidate.
 */
export const redactedEffectPromptSchema = z.discriminatedUnion("kind", [
  /** A yes/no owed by the ANSWERER (the non-controller): draw `count`, or
      decline. `note` addresses that answerer ("You may draw a card."). No card
      identity crosses — the whole decision is the `count`. */
  z.object({ kind: z.literal("mayDraw"), count: z.number(), note: z.string() }),
  /**
   * Tyme: the answerer guesses the HP of the Pokémon the controller named. Only the name crosses
   * before the reveal. Answered with `{ kind: "hpGuess", hp }`.
   */
  z.object({ kind: z.literal("guessHp"), name: z.string(), note: z.string() }),
  /**
   * A printed "You may …", answered yes/no by the controller. Optional `labels` caption the two
   * buttons of a printed "Choose 1:"; it must be declared because `z.object` strips unknown keys.
   */
  z.object({
    kind: z.literal("confirm"),
    note: z.string(),
    labels: z.object({ yes: z.string(), no: z.string() }).optional(),
    cards: z.object({ yes: redactedCardSchema, no: redactedCardSchema.optional() }).optional(),
    targets: z.array(redactedPokemonRefSchema).optional(),
  }),
  /**
   * Put the looked-at cards back in any order. Candidates arrive in current deck order and the
   * answer is a permutation with index 0 as the new top, so clients must not sort them. `alt`
   * captions a printed second option and makes an empty answer legal.
   */
  z.object({
    kind: z.literal("orderCards"),
    candidates: z.array(redactedCardSchema),
    note: z.string(),
    alt: z.string().optional(),
  }),
  /**
   * Pick one in-play Pokémon. Optional `upTo` is a ceiling on how much the pick takes, down to
   * none; absent means mandatory exactly one. `takeVerb` captions the quantity rows; absent reads
   * "attach".
   */
  z.object({
    kind: z.literal("choosePokemon"),
    candidates: z.array(redactedPokemonRefSchema),
    upTo: z.number().int().positive().optional(),
    takeVerb: z.enum(["move", "put"]).optional(),
    /** Public Adrena-Brain targeting context; absent on other Pokémon choices. */
    counterTransfer: z
      .object({
        upTo: z.number().int().positive(),
        abilitySourceUid: z.string().optional(),
        from: redactedPokemonRefSchema.optional(),
      })
      .optional(),
    note: z.string(),
  }),
  /** Pick `min`..`max` in-play Pokémon — the multi-target snipe. `declinable`
      is the separate printed "you may" (an all-or-nothing empty pick as a second
      legal answer); `min: 0` is the printed "up to". Mirrors the engine arm
      field-for-field so the dialog reads the same bounds the local HUD does. */
  z.object({
    kind: z.literal("choosePokemonMulti"),
    candidates: z.array(redactedPokemonRefSchema),
    min: z.number(),
    max: z.number(),
    declinable: z.boolean(),
    /** Each pick receives damage counters rather than damage; absent otherwise. */
    unit: z.literal("counters").optional(),
    note: z.string(),
  }),
  /**
   * Move up to `max` Energy from one source to one destination; declinable. `anySource` lets the
   * answer take from several hosts. `min` is the printed floor; `min === max` fixes the quantity.
   */
  z.object({
    kind: z.literal("moveEnergy"),
    movable: z.array(redactedEnergyOfferSchema),
    destinations: z.array(redactedPokemonRefSchema),
    max: z.number(),
    min: z.number().int().nonnegative().optional(),
    anySource: z.literal(true).optional(),
    anyDest: z.literal(true).optional(),
    note: z.string(),
  }),
  /** Discard Energy off the board (Crushing Hammer / Giacomo / a §8 self-discard
      cost). `discardable` pairs each takeable Energy uid with its host — the
      opponent's, or the viewer's own Active; `scope` says how many to pick.
      MANDATORY — no decline. Every candidate is Energy face-up on the table. */
  z.object({
    kind: z.literal("discardEnergy"),
    discardable: z.array(redactedEnergyOfferSchema),
    scope: redactedDiscardScopeSchema,
    note: z.string(),
  }),
  /**
   * Discard up to N Pokémon Tools from the opponent's board. Reuses the Energy offer schema (uid
   * plus host); scope is always `upTo`, so the answer may be empty.
   */
  z.object({
    kind: z.literal("discardTools"),
    discardable: z.array(redactedEnergyOfferSchema),
    scope: redactedDiscardScopeSchema,
    note: z.string(),
  }),
  /**
   * Pick `min`..`max` cards. Candidates carry full identity because deck cards are hidden until
   * revealed. `min` 0 means "up to". `dest` is the engine's word for where picks go ("evolve" means
   * onto the asking Pokémon, "deckTop" back on top of the deck). Controller-only.
   */
  z.object({
    kind: z.literal("chooseCards"),
    candidates: z.array(redactedCardSchema),
    min: z.number(),
    max: z.number(),
    // "attach": a searched Tool attached to the searching Pokémon. "swap": a discard-pile card
    // switched in for an in-play top card. "name": a card named, which moves nowhere. "use": a
    // Supporter's effect used from the opponent's revealed hand. "reveal": cards revealed and kept
    // in hand. Each new value requires deploying the client first.
    dest: z.enum([
      "bench",
      "hand",
      "deck",
      "deckBottom",
      "deckTop",
      "discard",
      "evolve",
      "attach",
      "swap",
      "name",
      "use",
      "reveal",
    ]),
    /**
     * Per-kind caps ("a Pokémon and a Trainer card"): each entry caps picks from its `uids`, while
     * `max` stays the total. Absent means the total is the only cap.
     */
    caps: z.array(z.object({ uids: z.array(z.string()), max: z.number() })).optional(),
    /**
     * Disjunctive caps ("up to 2 Basic Pokémon or 1 Evolution Pokémon"): an answer must lie wholly
     * in one entry's `uids` within that entry's `max`.
     */
    capsAnyOf: z.array(z.object({ uids: z.array(z.string()), max: z.number() })).optional(),
    note: z.string(),
  }),
  /**
   * Attach deck cards onto the controller's own Pokémon. `maxPerTarget` caps per target;
   * `oneTarget` (literal true) requires every card to go to the same target. Declinable;
   * controller-only.
   */
  z.object({
    kind: z.literal("attachCards"),
    candidates: z.array(redactedCardSchema),
    targets: z.array(redactedPokemonRefSchema),
    max: z.number(),
    maxPerTarget: z.number().optional(),
    oneTarget: z.literal(true).optional(),
    note: z.string(),
  }),
  /**
   * Pick one of another Pokémon's printed attacks to bar it next turn. Carries a resolved `name`
   * because an attack index cannot be resolved against the redacted board. Mandatory; never empty
   * or a singleton.
   */
  z.object({
    kind: z.literal("chooseAttack"),
    candidates: z.array(z.object({ index: z.number(), name: z.string() })),
    note: z.string(),
  }),
  /**
   * Pick one face-down prize slot to turn face up. `indices` address a prize row whose shape is
   * public. Mandatory; never empty or a singleton.
   */
  z.object({
    kind: z.literal("choosePrize"),
    indices: z.array(z.number()),
    note: z.string(),
  }),
]);
export type RedactedEffectPrompt = z.infer<typeof redactedEffectPromptSchema>;

/**
 * The redacted engine `Phase` the client routes actions on, carrying only non-sensitive fields. The
 * `effect:choose` prompt is non-null only for the answering seat.
 */
export const redactedPhaseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("setup:chooseFirst") }),
  z.object({ kind: z.literal("setup:drawExtra"), owed: z.number() }),
  z.object({
    kind: z.literal("setup:place"),
    ready: z.object({ you: z.boolean(), opponent: z.boolean() }),
    stage: z.enum(["opening", "bonus"]).optional(),
    /** Only the viewer's bonus card uids; never the opponent's hidden hand. */
    bonusCards: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal("turn:action"),
    attacks: z.array(redactedAttackSchema),
    retreat: redactedRetreatSchema.nullable(),
    /**
     * The acting viewer's activated Abilities and hand Trainers with server-folded playability; []
     * for the non-acting viewer.
     */
    abilities: z.array(redactedAbilitySchema),
    trainers: z.array(redactedTrainerSchema),
    /** The legal Rare Candy pairings behind the `rareCandy`-flagged Trainer row
        (increment 3b-ii); [] for the non-acting viewer, and [] when no pairing is
        legal (which is exactly when that row is `disabled`). On the PHASE rather
        than the row because the pairings do not depend on WHICH copy of Rare
        Candy is played — the row supplies the `uid`, this supplies the rest —
        matching the local HUD, where the dialog calls `rareCandyOptions` itself. */
    rareCandy: z.array(redactedRareCandyOptionSchema),
    /**
     * §7.3: the shared Stadium's activated ability; null for the non-acting viewer, with no
     * Stadium, or for a continuous-only Stadium.
     */
    stadiumAbility: redactedStadiumAbilitySchema.nullable(),
    /**
     * The actor's own bodies whose top card may be discarded from play; [] for the non-acting
     * viewer. Required, so deploy the server first.
     */
    discardable: z.array(redactedDiscardableSchema),
    /**
     * Set inside an attack-again window (Festival Lead), where only `attack` and `endTurn` are
     * legal; absent otherwise. Optional, so either side may deploy first.
     */
    attackAgain: z.literal(true).optional(),
  }),
  z.object({ kind: z.literal("ko:takePrizes"), count: z.number() }),
  z.object({ kind: z.literal("ko:promote") }),
  z.object({
    kind: z.literal("effect:choose"),
    prompt: redactedEffectPromptSchema.nullable(),
    /** What invoked the parked effect; a new value requires deploying the client first. */
    invokedBy: z.enum(["attack", "item", "supporter", "ability"]).optional(),
    /** The invoking Ability's name, when its Pokémon has exactly one. */
    abilityName: z.string().optional(),
  }),
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
    reasons: z.object({
      you: redactedGameOverReasonSchema,
      opponent: redactedGameOverReasonSchema,
    }),
  }),
]);
export type RedactedOutcome = z.infer<typeof redactedOutcomeSchema>;

/**
 * A client action, deliberately loose (`z.looseObject`): the DO overwrites `seat`, and
 * `applyAction`, which never throws, is the real validator. A strict object would strip the
 * action's fields.
 */
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
  /**
   * The turn owner's per-turn allowances, public to both viewers; absent in setup. Optional, so
   * either side may deploy first.
   */
  allowances: z
    .object({ energy: z.boolean(), supporter: z.boolean(), retreated: z.boolean() })
    .optional(),
});
export type RedactedGame = z.infer<typeof redactedGameSchema>;
