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
/** Mirrors the engine `GameOverReason`. `conceded` covers BOTH ways a player
    can forfeit — pressing concede, or an online player abandoning the match
    until their timer runs out (P4 3c-ii) — because to the opponent they are the
    same event. */
export const redactedGameOverReasonSchema = z.enum([
  "prizesTaken",
  "noPokemon",
  "deckOut",
  "conceded",
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
    PRINTED cost, `effectiveCost` the cost the §8.2 gate actually charges when the
    two DIFFER (see below); `damage` the printed display string (a number or a
    "60+"/"20×" modifier), null when the attack prints no damage.
    Only the viewer's OWN Active's attacks ever appear (their own public table
    facts), and only while it is their `turn:action`. */
export const redactedAttackSchema = z.object({
  /** Index into the Active's printed attacks — the `attack` action's discriminant. */
  index: z.number(),
  name: z.string(),
  /** The PRINTED cost — the symbols on the card face, unchanged since increment 2b
      and deliberately still meaning exactly that. See `effectiveCost` below. */
  cost: z.array(z.string()),
  /** The cost the §8.2 gate ACTUALLY charges under every continuous cost effect in
      play (engine `effectiveAttackCost`), present ONLY when it differs from the
      printed `cost` above. Render this in preference to `cost` wherever the player
      sees energy dots: `effectiveCost ?? cost`.

      ⚠️ IT EXISTS BECAUSE `playable` AND `cost` WERE COMPUTED FROM DIFFERENT
      NUMBERS. `playable` has folded the EFFECTIVE cost since the seam was built,
      while the dots have always drawn the PRINTED one — a divergence that shipped
      unnoticed for as long as the only cost modifier in the pool was a SURCHARGE
      (Pokémon League Headquarters), where the failure is merely invisible: the
      button greys out and the dots do not say why. The first DISCOUNT (Radiant
      Charizard swsh10.5-011 "Excited Heart") inverts that into the worse direction
      — the button goes LIVE while the dots still show a cost the player has not
      paid — so the wire owes the effective number.

      ⚠️ A SIBLING FIELD RATHER THAN A WIDENED `cost`, WHICH IS THE DECISION AND NOT
      AN IMPLEMENTATION DETAIL. `cost`'s meaning as PRINTED is documented here,
      depended on by both HUDs and is the only thing on the wire that still says
      what the CARD says; silently changing what an existing field means is the kind
      of reversal this project requires a trail for. A sibling is additive,
      reversible, and strictly more informative — a client can render "was 5, now 3"
      from the pair, which no single field can express. (Contrast
      `RedactedRetreat.cost` below, which publishes the CONTINUOUS number under the
      plain name: there the printed retreat cost is not on the wire at all, so
      there was no second reading to preserve.)

      OPTIONAL, and emitted only on a board where a cost modifier is actually in
      play — which mirrors `effectiveAttackCost`'s own contract (it returns the
      printed array itself when nothing applies) and keeps the frame byte-identical
      on every board without one. Its presence therefore MEANS "this cost is
      modified", which is a fact a renderer may want and could not otherwise derive.
      No `MATCH_RECORD_VERSION` consequence: this is a wire projection rebuilt from
      `GameState` on every frame and is persisted nowhere. */
  effectiveCost: z.array(z.string()).optional(),
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

/** An activated Ability on one of the acting viewer's OWN in-play Pokémon, with
    server-computed playability — the online turn HUD (increment 3b) renders a
    button per entry without ever reading the full state the local HUD's
    `usableAbilities` does (§9 Active-only + the §9/§15.J once-per-turn flag + the
    §7.5 hand cost + the would-only-whiff `programPlayable` gate — over raw
    allowances, the own hand, both boards, and the Stadium's OWNER, none of which
    the wire carries whole). `disabled` folds ALL of those gates into ONE boolean
    EXACTLY as the local Ability row's `disabled` — so the client needs no engine
    logic. `reason` is the printed clause a GREYED row shows as its tooltip (a §7.5
    hand cost or "No legal target"), null when the row is enabled or the disable is
    self-evident (Active-only / already-used). `target` is the seatless
    `PokemonTarget` the `useAbility` action dispatches back verbatim; `abilityName`
    the printed name (a card may carry more than one); `label` the display string
    ("Name · Card (Active)"), which disambiguates two copies of the same card. Only
    the acting viewer's OWN abilities appear (their own public board + own hand
    cost — nothing hidden), and only while it is their `turn:action` — [] for the
    non-acting viewer, who cannot use an Ability. */
export const redactedAbilitySchema = z.object({
  target: redactedPokemonTargetSchema,
  abilityName: z.string(),
  label: z.string(),
  disabled: z.boolean(),
  reason: z.string().nullable(),
});
export type RedactedAbility = z.infer<typeof redactedAbilitySchema>;

/** A Trainer playable from the acting viewer's OWN hand — an Item, a Supporter,
    Rare Candy or 🆕 (D288) a STADIUM — with server-computed playability; the
    online turn HUD (increment 3b)
    renders a button per DISTINCT card without reading the full state the local
    HUD's `playableTrainers` does. `disabled` folds the §4 first-turn Supporter ban
    + §7.2 one-Supporter-per-turn, the printed `trainerPlayableIf` board gate
    (`conditionHolds` — reads prize counts + the Stadium OWNER the wire withholds),
    the §7.5 hand cost (`handCostUnmet`), and the would-only-whiff `programPlayable`
    gate into ONE boolean EXACTLY as the local Trainer row's `disabled`. `reason`
    is the printed/engine clause a GREYED row shows ("Only if …" / "No legal
    target"), null when enabled or self-evident (the §4/§7.2 timing, and — D288 —
    §7.3's once-per-turn allowance and same-name rule, which the board states).
    `uid` is the hand uid the `playTrainer` action dispatches back (already on the
    viewer's own face-up hand); `name` the display name.
    🆕 **STADIUMS ARE HERE FROM D288** — a Stadium row dispatches the SAME
    `playTrainer` action (which routes to `playStadium`), so the row cost no new
    field and no new action; its `disabled` folds the imposed hand-play bar
    (Copperajah `sv06.5-042`, D287) plus §7.3's own two mechanics. They remain
    DRAGGABLE onto the shared slot as well (the 2a `moveToAction` path) — the
    local HUD has offered both gestures all along, and this row is what brings the
    wire into line with it rather than a second affordance. RARE CANDY
    IS here (increment 3b-ii), flagged by `rareCandy`: it is the one row whose
    click OPENS A DIALOG (pick a Basic, then a Stage 2) instead of dispatching
    `playTrainer`, because it evolves rather than running a program — its pairings
    ride the phase's `rareCandy` list and its answer is the `rareCandy` action.
    Only the acting viewer's OWN hand appears, and only during their `turn:action`
    — [] for the non-acting viewer. */
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

/** One legal Rare Candy play (§7.1) the acting viewer's dialog may offer — the
    wire mirror of the engine's `RareCandyOption` (increment 3b-ii). Rare Candy
    evolves a Basic in play straight to a Stage 2 in hand, skipping the Stage 1,
    so the decision is a PAIR (which Basic, which Stage 2) the engine cannot
    express as an `effect:choose` prompt — it is its own two-step dialog, and this
    is what feeds it. The options come from the engine's own `rareCandyOptions`
    (the authority: it folds the §4 first-turn ban, the Basic-in-play and
    came-into-play-this-turn checks, and the Basic→Stage 1→Stage 2 chain bridge),
    so a listed pairing always resolves to a legal `rareCandy` action — which the
    handler still re-validates field by field.

    `target` is the seatless `PokemonTarget` the action dispatches back verbatim
    (the Basic is always on the actor's own board, so no seat is carried; the DO
    rebinds the acting seat). `basicUid`/`basicName` and each `stage2` entry name
    cards that are ALREADY face-up to this viewer (their own in-play stack top and
    their own hand), carried here as display strings for the same reason
    `RedactedTrainer` carries `name` — the panel family is wire-driven and looks
    nothing up. Only the acting viewer's OWN options appear, and only during their
    `turn:action` — [] for the non-acting viewer, who never plays a Trainer. */
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

/** §7.3 — the SHARED Stadium's "once during each player's turn" ACTIVATED
    ability, server-folded for the acting viewer's turn HUD (D210), which
    dispatches `{type:"useStadiumAbility", seat}` — the action carries NOTHING
    else, because there is exactly one Stadium and it takes no target.

    THE ONE OFFER ON `turn:action` THAT IS NEITHER A LIST NOR ON THE VIEWER'S OWN
    BOARD, hence a nullable single value rather than an array: `abilities` walks
    the actor's Active + Bench, and a Stadium is neither a Pokémon nor a target,
    so it can never appear there. `null` means "no row" — the non-acting viewer
    (and a spectator), no Stadium in play, or a CONTINUOUS-only Stadium (Beach
    Court, League HQ: real Stadiums with no activated ability at all).

    `disabled` folds the engine's own `useStadiumAbility` gate (cardplay.ts) —
    the per-turn `allowances.stadiumAbilityUsed` flag and the would-only-whiff
    `programPlayable` check, neither of which the client can see — into ONE
    boolean, EXACTLY as `RedactedAbility.disabled` does for a Pokémon's Ability.
    `reason` is the printed clause a GREYED row shows ("No legal target"), null
    when the row is enabled or the disable is self-evident (already used this
    turn). `label` is the Stadium's own name (`StadiumAbility.label` — "Levincia",
    "Spikemuth Gym"), the same string the STADIUM_ABILITY_ACTIVATED log row
    carries.

    The Stadium card itself is already PUBLIC on `board.stadium` for both viewers,
    so this adds no card identity to the wire — only the actor's affordance, which
    is withheld from the opponent for the reason every other `turn:action` offer
    is: it is derived from state (and, for a future gated program, private zones)
    that viewer has no business reading. */
export const redactedStadiumAbilitySchema = z.object({
  label: z.string(),
  disabled: z.boolean(),
  reason: z.string().nullable(),
});
export type RedactedStadiumAbility = z.infer<typeof redactedStadiumAbilitySchema>;

/** A specific in-play Pokémon a prompt refers to — the wire mirror of the
    engine's `PokemonRef`. Its `seat` is ABSOLUTE (p1/p2), NOT viewer-relative
    like the rest of RedactedGame, and deliberately: these refs must round-trip
    to the engine's own `PokemonRef` (so the reconstructed local decision equals
    the wire one) AND ride the dispatched `resolveEffect` choice back to the DO
    VERBATIM (the DO rebinds the ACTING seat, never a choice's target refs). Not
    a leak — every in-play Pokémon is public once setup is over, and the viewer
    already knows which absolute seat it is (`RedactedGame.seat`); the client
    resolves a ref to a board Pokémon by comparing `ref.seat` to that own seat. */
export const redactedPokemonRefSchema = z.object({
  seat: matchSeatSchema,
  spot: z.discriminatedUnion("spot", [
    z.object({ spot: z.literal("active") }),
    z.object({ spot: z.literal("bench"), index: z.number() }),
  ]),
});
export type RedactedPokemonRef = z.infer<typeof redactedPokemonRefSchema>;

/** How many Energy a `discardEnergy` prompt asks for — the wire mirror of the
    engine's `DiscardScope`: `total` = exactly `count` uids across the whole
    offer, `each` = exactly one uid from every distinct host Pokémon offered. */
export const redactedDiscardScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("total"), count: z.number() }),
  z.object({ kind: z.literal("each") }),
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

/** The redacted mid-effect prompt (§15.E/G) the answering client renders a
    dialog for — the engine's full `EffectPrompt` mapped to the neutral wire
    shape, exactly as `RedactedGame` does for the board (P4 increment 2b-iii).
    It rides `effect:choose` (below) NULLABLE and is populated ONLY for the seat
    that must answer it (`phase.answerer ?? phase.seat`) — every other viewer
    gets null. That answerer gate is the whole point: a prompt's candidates CAN
    be built from the ANSWERER's private zones (a deck search's uids, a "look at
    the top N", 🆕 D426's opponent-chosen HAND discard), so the raw prompt must
    never reach the other side of the wire. ⚠️ **"ANSWERER", NOT "CONTROLLER" —
    D426 CORRECTED THAT WORD HERE AND AT THREE OTHER SITES.** The two were the
    same seat for every hidden-candidate producer until this op parked one on the
    non-controller; the field's own `phase.answerer ?? phase.seat` spelling one
    line up was right the whole time. `redactedPromptOf` (redact.ts) is STRICTER than `phaseViewOf`'s
    hot-seat `withheld` — the wire delivers a payload to one client, so a
    controller-answered prompt goes to the CONTROLLER ALONE, where the local
    projection may keep it in both viewers' (never-rendered) `pendingDecision`.
    The two coincide exactly when `answerer` is set (ALWAYS for `mayDraw`); for
    a CONTROLLER-answered kind the wire is strictly stricter, so a park of one of
    those round-trips to the local projection for the ANSWERER's view only (see
    redact.ts for the full reasoning).

    A DISCRIMINATED UNION on `kind`, mirroring `EffectPrompt`'s arms — but only
    the arms whose online dialog exists so far. **2b-iii-a landed `mayDraw`**
    (Ortega's "your opponent may draw a card") — a pure yes/no with no card
    references, the arm that made the answerer gate load-bearing (its answerer is
    the non-controller). **2b-iii-b adds the PUBLIC-REF family**
    (choosePokemon / choosePokemonMulti / moveEnergy / discardEnergy): their
    candidates are all in-play `PokemonRef`s and attached-Energy uids, ALREADY on
    the public redacted board, so the wire carries the refs/uids and the client
    resolves display identity against the board — no hidden-card resolution.
    These are controller-answered. **2b-iii-c adds the HIDDEN-CANDIDATE family**
    (chooseCards / attachCards): their candidates are the CONTROLLER's own deck /
    looked-at-top / hand / discard cards — the deck ones HIDDEN even from the
    controller until the effect REVEALS them — so the wire carries a server-
    resolved **`RedactedCard` per candidate** (its identity, keyed by the engine
    uid the answer dispatches back), and it goes to the CONTROLLER ALONE via the
    same answerer gate. This is where that gate stops being a convenience and
    becomes the HIDDEN-INFO barrier: a deck uid must never appear in the
    opponent's snapshot (it doesn't — the opponent's prompt is null and their
    view of both decks is a count). With every arm now dialoged, `resolveEffect`
    goes ONTO the DO allowlist (the invariant). */
export const redactedEffectPromptSchema = z.discriminatedUnion("kind", [
  /** A yes/no owed by the ANSWERER (the non-controller): draw `count`, or
      decline. `note` addresses that answerer ("You may draw a card."). No card
      identity crosses — the whole decision is the `count`. */
  z.object({ kind: z.literal("mayDraw"), count: z.number(), note: z.string() }),
  /** The printed "**You may** …" (the engine's `optional` op), answered by the
      CONTROLLER — a bare yes/no whose "yes" splices the op's branch into the
      running program and whose "no" runs nothing. The smallest arm in this union
      and the only one carrying NO number and NO references at all: the `note` is
      the printed sentence and the answer is the whole content, so there is
      nothing for the server to resolve and nothing that could leak. A sibling of
      `mayDraw` rather than a widening of it — that arm's `count` is a printed
      number its dialog renders, and this prompt has none. */
  z.object({ kind: z.literal("confirm"), note: z.string() }),
  /** 🆕 D341 — PUT THE LOOKED-AT CARDS BACK IN ANY ORDER (Iron Valiant `sv05-080`
      "Calculation"; Team Rocket's Dottler `sv10-088` and Gothorita `sv10.5w-042`/
      `-125` "Fortunate Eye", which order the OPPONENT's deck). The ninth prompt
      kind, and the first whose answer is a SEQUENCE rather than a selection.

      **HIDDEN-ZONE FAMILY, and the strongest member of it.** `candidates` carry
      full identity (`RedactedCard`) for `chooseCards`'s reason — they are deck
      cards the effect turns face-up to one player — and on three of the four
      printings that player is not the deck's owner, so the answerer gate is doing
      real work rather than being a convenience. The deck's owner receives a
      count-only log row and no identities at all.

      **NO `min` AND NO `max`, unlike every other card-carrying arm here**: the
      answer is a permutation of the whole `candidates` array or it is invalid, so
      a floor and a ceiling could only ever be `candidates.length` twice over. The
      array ORDER is the answer's content — index 0 is the new top of the deck —
      and the order `candidates` arrives in is the deck order it is starting from,
      which is why a client must not sort it for display.

      🆕 **D344 — `alt` IS THE PRINTED SECOND ARM's CAPTION** (Deduction Kit
      `sv08-171`: *"…, or shuffle them and put them on the bottom of your
      deck"*), and its PRESENCE is what makes an EMPTY answer legal — the client
      renders it as a second button that dispatches `{kind:"orderCards", uids:
      []}`. OPTIONAL, so this is a widening (D125): every producer before D344
      omits it and parses identically, and no persisted record can hold one. */
  z.object({
    kind: z.literal("orderCards"),
    candidates: z.array(redactedCardSchema),
    note: z.string(),
    alt: z.string().optional(),
  }),
  /** Pick exactly one in-play Pokémon (switchActive / gust / healChosen) — and,
      where `upTo` carries a printed ceiling, say how many of the moved thing the
      pick takes, down to NONE. The candidates are public in-play refs.

      🆕🆕 **D359 — `upTo` IS THE PRINTED *"attach up to N"* AND IT REPLACES
      D358's `declinable`**, which was the same right at width one. Six sentences
      and 13 Standard-legal printings spell a ceiling above one (Ethan's Ho-Oh ex
      ×4, Bloodmoon Ursaluna ×2, Lycanroc ×2, Oricorio ×2, Regirock ex ×2,
      Kilowattrel ex ×1), and Archaludon ex ×3 / Magneton ×3 spell it at one. It
      has to CROSS: the dialog decides which quantities to offer at all, and
      `validateChoice` decides whether a ref-less or short answer is a printed
      right or a crafted frame refusing a mandatory effect. Neither of them can
      see the engine op, which is the same argument `moveEnergy`'s `anySource`
      makes three arms down.

      **OPTIONAL, and absent means MANDATORY EXACTLY-ONE** — the reading every
      park in this arm carried before the field existed — unlike
      `choosePokemonMulti`'s required boolean below. That is not a style
      difference: this prompt rides the persisted `effect:choose` phase, so a
      snapshot written by an earlier deploy must parse.

      🛑 **BUT PARSING IS NOT READING, AND THIS IS WHY `MATCH_RECORD_VERSION`
      MOVES 21 → 22 WHERE D358's WIDENING LEFT IT ALONE.** A v21 snapshot carries
      `declinable: true`, which this schema no longer names; it parses (the key is
      simply dropped) and then reads as `upTo === undefined`, i.e. MANDATORY — so
      a resumed match would refuse a decline the player was promised. A widening
      is safe because the old bytes still mean what they meant; a RENAME is not.
      D352 made exactly this call for `attachFromTop.discardRest` → `restTo`. */
  z.object({
    kind: z.literal("choosePokemon"),
    candidates: z.array(redactedPokemonRefSchema),
    upTo: z.number().int().positive().optional(),
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
    note: z.string(),
  }),
  /** Move up to `max` Energy from ONE source Pokémon to ONE destination (Energy
      Switch / Poppy). `movable` pairs each takeable Energy uid with its host;
      `destinations` are the eligible destinations. Declinable (move none).

      `anySource` (D226) is the printed plural — N's Plan's "Move up to 2 Energy
      from your Benched **Pokémon** to your Active Pokémon" — and lifts the ONE-
      source rule: the answer may take Energy off several of the offered hosts.
      OPTIONAL, and absent means the coupling every other printing carries, so a
      prompt written by a build that predates the rider round-trips unchanged.
      The dialog reads it to skip its source-picking STAGE, and `validateChoice`
      reads it to allow the answer; neither can see the engine op, which is why
      it crosses at all.

      🆕🆕 **D441 — `min` IS THE PRINTED FLOOR**, and it is what makes Castform's
      *"Move **all** Energy from this Pokémon to 1 of your Benched Pokémon."*
      answerable rather than merely offerable: `min === max` means the quantity is
      not a decision and only the destination is. Same split `chooseCards` has
      carried since M4 (0 = the printed "up to"; `min === max` = a mandatory exact),
      and the online dialog reads it to withhold "Move none" exactly as
      `validateChoice` reads it to refuse the empty answer.

      **OPTIONAL, AND — UNLIKE D359's `upTo` DIRECTLY ABOVE — THAT COSTS NO
      `MATCH_RECORD_VERSION` BUMP.** This prompt rides the persisted
      `effect:choose` phase, so a v29 snapshot can hold one; it carries no `min`,
      and no `min` meant DECLINABLE both before this field and after it. D359 bumped
      because absent came to mean MANDATORY where the old bytes meant declinable —
      the same shape pointing the other way. *"Does the old byte string still mean
      what it meant"* is the discriminator, and here it does. */
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
  /** Pick `min`..`max` cards (a deck search / discard retrieval / look-at-top /
      a §7.5 hand cost). `candidates` carry FULL identity (`RedactedCard`) because
      a deck-search candidate is HIDDEN until this effect reveals it — the server
      resolves each so the controller's dialog can name them without the full
      state; the answer dispatches back the `id` (engine uid) of each pick. `min`
      is the DECLINABLE split (0 = the printed "up to", `min === max === count` =
      a mandatory exact cost); `dest` is where the picks go (the ENGINE's word —
      "deck" is shuffled-in, "deckBottom" is under-the-deck, and D307's "evolve" is
      *onto the Pokémon that is asking* — the first member that names a BODY
      rather than a zone, and the reason it is a member rather than a reuse of
      "bench": the destination is the ENGINE's to state, and a client told "bench"
      about "put it onto this Pokémon to evolve it" would name the wrong place in
      its own words), and 🆕 D342's "deckTop" is *back on top of the deck they came
      out of* — the THIRD way into a deck beside "deck" (shuffled in) and
      "deckBottom" (underneath), split apart for that same reason: a client told
      "deck" about Ciphermaniac's Codebreaking would render "Shuffle" over a
      heading that says on top of your deck. Controller-only. */
  z.object({
    kind: z.literal("chooseCards"),
    candidates: z.array(redactedCardSchema),
    min: z.number(),
    max: z.number(),
    dest: z.enum(["bench", "hand", "deck", "deckBottom", "deckTop", "discard", "evolve"]),
    /** 🆕 D332 — PER-KIND CAPS over the same candidate list, the printed "a
        Pokémon **and** a Trainer card" (Drayton). `max` above stays the TOTAL;
        each entry caps how many picks may come out of ITS `uids`, which are the
        same `RedactedCard.id` keys the answer dispatches on. Absent on every
        other producer, where one filter and one cap are the whole story — so
        absent is not "uncapped", it is "the total IS the only cap".
        ⚠️ IT LEAKS NOTHING THE PROMPT DID NOT ALREADY GIVE: the ids are a
        PARTITION of `candidates`, which the controller has already been shown in
        full, and this arm goes to the controller alone. */
    caps: z.array(z.object({ uids: z.array(z.string()), max: z.number() })).optional(),
    note: z.string(),
  }),
  /** Attach cards out of the controller's DECK (top or search) onto their own
      Pokémon, "in any way you like" (Electric Generator / Charizard ex / Janine).
      `candidates` carry FULL identity (`RedactedCard`, same reason as chooseCards
      — they are hidden deck cards the effect reveals); `targets` are the eligible
      own in-play refs (public board); `max` is how many may attach; `maxPerTarget`
      caps per-target ("for each of those Pokémon"), absent = no per-target limit.
      🆕 `oneTarget` is that key's DUAL (D457) — the printed "attach them to
      **1 of** your Pokémon", where every card in the answer must name the SAME
      target; absent = "in any way you like", any split. A LITERAL `true` rather
      than a boolean, so absence is the only way to spell "no constraint": a
      `false` on the wire would be a second encoding of the same state, which is
      the optional-key rule this file keeps everywhere.
      DECLINABLE (attach none). The answer pairs each picked `id` with a target
      ref. Controller-only. */
  z.object({
    kind: z.literal("attachCards"),
    candidates: z.array(redactedCardSchema),
    targets: z.array(redactedPokemonRefSchema),
    max: z.number(),
    maxPerTarget: z.number().optional(),
    oneTarget: z.literal(true).optional(),
    note: z.string(),
  }),
  /** Pick exactly ONE of another Pokémon's printed ATTACKS, to bar it for that
      Pokémon's next turn (D157 — Medicham sv01-111 "Acu-Punch-Ture", Oranguru
      sv02-094 "Plotter's Command"). The eighth prompt kind, and the one that does
      not sit cleanly on either side of the split above.

      It belongs to the **PUBLIC-REF** family by its hidden-information reading:
      the candidates are the printed attacks of a FACE-UP opposing Active, which
      both players can read off the table, so the answerer gate is a convenience
      here (only one seat answers) and not the barrier it is for a deck search.
      Nothing is resolved out of a private zone.

      But unlike every other public-ref arm it carries a resolved **`name`**, and
      the reason is a gap in the wire rather than a reveal: a `PokemonRef` or an
      attached-Energy uid resolves against the redacted board the client already
      holds, and an attack INDEX resolves against nothing — `RedactedCard` carries
      no attack rows, and `RedactedAttack[]` is published for the viewer's OWN
      Active only. Without the label the dialog would render numbered buttons. So
      the two questions this union is organised by — *is the answerer gate
      load-bearing?* and *must the server resolve a label?* — are independent, and
      this is the first arm that answers NO to the first and YES to the second.

      `index` is the answer's whole content and is the engine's own addressing
      (the `attack` action's discriminant, the registry's `attack` key,
      `InPlayPokemon.lockedAttack.attackIndex`); the answer dispatches it back
      verbatim and `validateChoice` checks it against this offer. MANDATORY — the
      printed sentence is "Choose 1", with no "you may", so there is no decline
      and no bounds pair to carry. Never empty and never a singleton: the engine
      resolves both degenerate boards inline rather than parking. */
  z.object({
    kind: z.literal("chooseAttack"),
    candidates: z.array(z.object({ index: z.number(), name: z.string() })),
    note: z.string(),
  }),
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
    other viewer (null for the non-answerer). Every prompt kind is now dialoged
    (2b-iii-a/b/c), so the only reason it is null is the answerer gate.
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
    /** The acting viewer's own activated Abilities + hand Trainers (Items,
        Supporters, Rare Candy and — D288 — Stadiums), each with server-folded
        playability (increment 3b); [] for the non-acting
        viewer. Like `attacks`, they never enter the playmat projection, so the
        `projectionFromRedacted ≡ projectGameState` round-trip is untouched. */
    abilities: z.array(redactedAbilitySchema),
    trainers: z.array(redactedTrainerSchema),
    /** The legal Rare Candy pairings behind the `rareCandy`-flagged Trainer row
        (increment 3b-ii); [] for the non-acting viewer, and [] when no pairing is
        legal (which is exactly when that row is `disabled`). On the PHASE rather
        than the row because the pairings do not depend on WHICH copy of Rare
        Candy is played — the row supplies the `uid`, this supplies the rest —
        matching the local HUD, where the dialog calls `rareCandyOptions` itself. */
    rareCandy: z.array(redactedRareCandyOptionSchema),
    /** §7.3 — the shared Stadium's activated ability (D210); null for the
        non-acting viewer, when no Stadium is in play, and when the Stadium in
        play is continuous-only. A NULLABLE SINGLE rather than a list because
        there is exactly one shared Stadium and the action takes no target —
        which is also why it could not ride `abilities`, whose every entry names
        a Pokémon on the actor's own board. */
    stadiumAbility: redactedStadiumAbilitySchema.nullable(),
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
    reasons: z.object({
      you: redactedGameOverReasonSchema,
      opponent: redactedGameOverReasonSchema,
    }),
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
