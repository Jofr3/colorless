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
// prompt crosses ONLY to the seat that must answer it (redactedPromptOf) — for a
// hidden-candidate prompt (chooseCards/attachCards) that carries the revealed
// deck-card identities, so the answerer gate is the hidden-info barrier there.
//
// SPECTATORS (P4 3c-vii): `redactGame(state, side, true)` is the view for someone
// with no seat, watching from `side` of the table. It is the same snapshot with
// three things taken away — BOTH hands, BOTH sides' setup placements, and every
// actor affordance (the turn:action lists, the effect prompt). The threat model is
// not a stranger: it is a PLAYER opening a spectator view of their own match to
// read the other hand, so "a spectator sees strictly less than either player"
// is the property, and the sides are treated symmetrically. Note the actor lists
// name cards in a HAND, so withholding the hand without withholding them would
// leak exactly what was hidden — hence one `actor = null` gate rather than a
// field-by-field decision that a future affordance could miss.

import type {
  RedactedAbility,
  RedactedAttack,
  RedactedCard,
  RedactedDiscardScope,
  RedactedEffectPrompt,
  RedactedGame,
  RedactedInPlay,
  RedactedOutcome,
  RedactedPhase,
  RedactedPokemonRef,
  RedactedRareCandyOption,
  RedactedRetreat,
  RedactedSide,
  RedactedTrainer,
  Viewer,
} from "@luminous/schema";
import { EMPTY_CARD_ID, EMPTY_CARD_NAME, HIDDEN_CARD_ID, HIDDEN_CARD_NAME } from "@luminous/schema";
import { costMet } from "./attack";
import { programPlayable, rareCandyOptions } from "./cardplay";
import { attacksOf, cardOfUid, topCardOf, topUid } from "./cards";
import {
  effectiveAttackCost,
  effectiveMaxHp,
  effectiveRetreatCost,
  providedEnergy,
} from "./continuous";
import type { DiscardScope, EffectPrompt, PokemonRef } from "./interpreter";
import { conditionHolds, conditionNote, handCostAction, handCostUnmet } from "./interpreter";
import { inSetup, phaseViewOf } from "./phaseView";
import { programFor } from "./registry";
import type {
  GameOutcome,
  GameState,
  InPlayPokemon,
  Phase,
  PokemonTarget,
  Seat,
  SpecialConditions,
} from "./types";
import { isImmobilized, otherSeat } from "./types";

/** Redact `state` for `viewerSeat`: same state + seat in, structurally-equal
    snapshot out. Pure — nothing aliases the input state.

    `spectating` builds the SEATLESS view instead (3c-vii): `viewerSeat` then only
    picks which side of the table is rendered as "you", and that side's hand,
    setup placements and turn affordances are withheld exactly as the opposite
    side's already were. Everything a spectator sees, both players can already
    see. */
export function redactGame(state: GameState, viewerSeat: Seat, spectating = false): RedactedGame {
  const opponentSeat = otherSeat(viewerSeat);
  const view = phaseViewOf(state, viewerSeat);
  // Setup placements are face-down until both players ready, so the opponent's
  // in-play stacks (battle rows included) redact until then. The viewer's own
  // placements stay face-up — they placed them. A SPECTATOR placed nothing, so
  // the same setup gate applies to BOTH sides for them.
  const setup = inSetup(state);
  return {
    seat: viewerSeat,
    turn: state.turn,
    phase: redactPhase(state, viewerSeat, spectating),
    board: {
      // §7.3 — the one shared Stadium, public to both viewers.
      stadium: state.stadium === null ? null : redactedCardOf(state, state.stadium.uid),
      you: redactedSideOf(state, viewerSeat, {
        faceUpHand: !spectating,
        faceUpInPlay: spectating ? !setup : true,
      }),
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
    the effect:choose prompt goes ONLY to the seat that must answer it
    (`redactedPromptOf`), null for every other viewer. */
function redactPhase(state: GameState, viewerSeat: Seat, spectating: boolean): RedactedPhase {
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
    case "turn:action": {
      // turn:action's actor is phase.seat (phaseView) — only they get an attack
      // list, a retreat option, an ability/trainer list and the Rare Candy
      // pairings; the opponent's view of the same phase carries none (empty
      // attacks/abilities/trainers/rareCandy, null retreat).
      //
      // A SPECTATOR has NO actor: `null` can never equal a seat, so every helper
      // below withholds through the guard it already had. One gate rather than
      // five `spectating ? [] : …` — which is the point, because the affordance
      // added HERE next must be withheld by default, not by remembering to. It is
      // load-bearing beyond neatness: the trainer/ability lists name cards in the
      // actor's HAND, so leaking them to a spectator would leak the hand the
      // board redaction just hid.
      const actor = spectating ? null : phase.seat;
      return {
        kind: "turn:action",
        attacks: redactedAttacksOf(state, viewerSeat, actor),
        retreat: redactedRetreatOf(state, viewerSeat, actor),
        abilities: redactedAbilitiesOf(state, viewerSeat, actor),
        trainers: redactedTrainersOf(state, viewerSeat, actor),
        rareCandy: redactedRareCandyOf(state, viewerSeat, actor),
      };
    }
    case "ko:takePrizes":
      return { kind: "ko:takePrizes", count: phase.count };
    case "ko:promote":
      return { kind: "ko:promote" };
    case "effect:choose":
      // A prompt's candidates can be the answerer's own deck cards; nobody who
      // cannot ANSWER it may see it, and a spectator never can.
      return {
        kind: "effect:choose",
        prompt: spectating ? null : redactedPromptOf(state, phase, viewerSeat),
      };
    case "gameOver":
      return { kind: "gameOver" };
  }
}

/** The redacted mid-effect prompt for `viewerSeat` — non-null ONLY for the seat
    that must ANSWER it: `phase.answerer ?? phase.seat` (the non-controller for
    opponentMayDraw — Ortega — else the controller). Every other viewer gets
    null. This gate is the hidden-information barrier: a prompt's candidates can
    be the controller's own deck cards (a search) or a "look at the top N", so
    the raw prompt must never reach the other side of the wire.

    This is STRICTER than `phaseViewOf`'s local `withheld` (phaseView.ts), and
    deliberately: that hot-seat projection only withholds an EXPLICIT-answerer
    park (`answerer !== undefined && !== viewer`), leaving a controller-answered
    prompt's `pendingDecision` present for BOTH viewers — harmless there because
    one device shows one viewer and the HUD gates on `waitingOn === "you"`. The
    wire has no such gate: it physically delivers the payload to a client, so a
    controller-answered prompt must go to the CONTROLLER ALONE. The two coincide
    exactly when `answerer` is set — ALWAYS for `mayDraw` — so a mayDraw park
    round-trips to the local projection for BOTH viewers. The public-ref
    (2b-iii-b) and hidden-candidate (2b-iii-c) families are CONTROLLER-answered, so
    `answerer` is undefined and this gate is strictly stricter than `phaseViewOf`'s
    (which keeps the prompt for both): such a park round-trips for the ANSWERER's
    view only, not the opponent's — the round-trip pin is scoped accordingly, and
    this gate stays as-is (tightening the projection instead would be the wrong
    direction — the wire is the barrier, and for a deck search it is the ONLY thing
    keeping the revealed deck-card identities off the opponent's snapshot).

    Every prompt kind now has an online dialog (2b-iii-a/b/c), so for the answerer
    this always returns a non-null redacted prompt; null is now ONLY the
    answerer-gate result. */
function redactedPromptOf(
  state: GameState,
  phase: Extract<Phase, { kind: "effect:choose" }>,
  viewerSeat: Seat,
): RedactedEffectPrompt | null {
  const answerer = phase.answerer ?? phase.seat;
  if (answerer !== viewerSeat) return null;
  return redactPrompt(state, phase.prompt);
}

/** Map the engine's full `EffectPrompt` to the neutral wire shape — the answerer
    has already been established, so this only decides what identity crosses.
    Three families: `mayDraw` (count + note, no references — 2b-iii-a); the
    PUBLIC-REF family (choosePokemon / choosePokemonMulti / moveEnergy /
    discardEnergy — 2b-iii-b), whose candidates are all in-play `PokemonRef`s and
    attached-Energy uids ALREADY public on the redacted board (fresh ref/scope
    copies, no card resolution); and the HIDDEN-CANDIDATE family (chooseCards /
    attachCards — 2b-iii-c), whose candidates are the controller's own deck/top/
    hand/discard cards — the deck ones hidden until this effect REVEALS them — so
    each candidate uid is resolved to a `RedactedCard` (identity keyed by that
    uid, which the answer dispatches back). That resolution goes to the answerer
    ALONE (the gate above), which is what keeps a deck uid off the opponent's
    wire. The switch stays EXHAUSTIVE so a new engine prompt kind is a compile
    error here, not a silent null. Every branch builds FRESH objects (the
    ref/scope copies and redactedCardOf), so nothing aliases the input state — the
    redactor's purity contract, like copyConditions. */
function redactPrompt(state: GameState, prompt: EffectPrompt): RedactedEffectPrompt {
  switch (prompt.kind) {
    case "mayDraw":
      return { kind: "mayDraw", count: prompt.count, note: prompt.note };
    case "choosePokemon":
      return {
        kind: "choosePokemon",
        candidates: prompt.candidates.map(redactedRefOf),
        note: prompt.note,
      };
    case "choosePokemonMulti":
      return {
        kind: "choosePokemonMulti",
        candidates: prompt.candidates.map(redactedRefOf),
        min: prompt.min,
        max: prompt.max,
        declinable: prompt.declinable,
        note: prompt.note,
      };
    case "moveEnergy":
      return {
        kind: "moveEnergy",
        movable: prompt.movable.map(redactedOfferOf),
        destinations: prompt.destinations.map(redactedRefOf),
        max: prompt.max,
        note: prompt.note,
      };
    case "discardEnergy":
      return {
        kind: "discardEnergy",
        discardable: prompt.discardable.map(redactedOfferOf),
        scope: redactedScopeOf(prompt.scope),
        note: prompt.note,
      };
    case "chooseCards":
      return {
        kind: "chooseCards",
        // The reveal: each candidate uid resolved to its identity (the deck
        // cards this search turned face-up), keyed by the uid the answer sends.
        candidates: prompt.candidates.map((uid) => redactedCardOf(state, uid)),
        min: prompt.min,
        max: prompt.max,
        dest: prompt.dest,
        note: prompt.note,
      };
    case "attachCards":
      return {
        kind: "attachCards",
        candidates: prompt.candidates.map((uid) => redactedCardOf(state, uid)),
        targets: prompt.targets.map(redactedRefOf),
        max: prompt.max,
        // Absent = "in any way you like" (no per-target cap); passed through as
        // undefined, which the wire drops and the schema's optional accepts.
        maxPerTarget: prompt.maxPerTarget,
        note: prompt.note,
      };
  }
}

/** A fresh copy of an engine `PokemonRef` for the wire — never an alias into
    game state (the redactor's no-alias purity contract). The `seat` is ABSOLUTE;
    see `RedactedPokemonRef` for why that is not a leak. Rebuilding `spot`
    explicitly (rather than spreading) makes an added `PokemonTarget` field a
    compile error here rather than a silent alias. */
function redactedRefOf(ref: PokemonRef): RedactedPokemonRef {
  return {
    seat: ref.seat,
    spot:
      ref.spot.spot === "active" ? { spot: "active" } : { spot: "bench", index: ref.spot.index },
  };
}

/** A fresh copy of one offered Energy (uid + its host ref) for the wire. */
function redactedOfferOf(offer: { uid: string; from: PokemonRef }): {
  uid: string;
  from: RedactedPokemonRef;
} {
  return { uid: offer.uid, from: redactedRefOf(offer.from) };
}

/** A fresh copy of a `DiscardScope` — a `satisfies` pins that a new arm is a
    compile error rather than a silent drop. */
function redactedScopeOf(scope: DiscardScope): RedactedDiscardScope {
  return (
    scope.kind === "total" ? { kind: "total", count: scope.count } : { kind: "each" }
  ) satisfies DiscardScope;
}

/** The acting viewer's Active's attacks with server-computed payability, for the
    online turn HUD — the opponent's view of the same turn gets [] (only the turn
    owner may attack). Mirrors GameHud's TurnPanel `disabled` on the full state
    the wire deliberately withholds: §8.2 payability under the Stadium's
    continuous cost effects (effectiveAttackCost + providedEnergy), the §4
    first-turn ban, and the §12 immobilize gate — folded into one `playable`
    boolean so the client needs no engine logic. Own Active only (public), so no
    hidden information leaves the DO. */
function redactedAttacksOf(
  state: GameState,
  viewerSeat: Seat,
  turnSeat: Seat | null,
): RedactedAttack[] {
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
function redactedRetreatOf(
  state: GameState,
  viewerSeat: Seat,
  turnSeat: Seat | null,
): RedactedRetreat | null {
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

/** The acting viewer's activated Abilities with server-computed playability, for
    the online turn HUD (increment 3b) — [] for the opponent (only the turn owner
    may use one). Mirrors GameHud's `usableAbilities` on the full state the wire
    withholds: it walks the viewer's OWN Active + Bench, enumerates each stack-top
    card's activated `abilities` (never passive/triggered), and folds the §9
    Active-only gate, the §9/§15.J once-per-turn `abilitiesUsed` flag, the §7.5
    hand cost (`handCostUnmet` — reads the OWN hand) and the would-only-whiff
    `programPlayable` gate into ONE `disabled` boolean, EXACTLY as the local Ability
    row — so the client needs no engine logic. Everything read is the viewer's own
    public board + own hand, and it is emitted only to the actor, so nothing hidden
    leaves the DO. `target` is a fresh seatless `PokemonTarget` literal (no alias
    into state — the redactor's purity contract) the `useAbility` action dispatches
    back verbatim. */
function redactedAbilitiesOf(
  state: GameState,
  viewerSeat: Seat,
  turnSeat: Seat | null,
): RedactedAbility[] {
  if (viewerSeat !== turnSeat) return [];
  const side = state.players[viewerSeat];
  const out: RedactedAbility[] = [];
  const consider = (pokemon: InPlayPokemon | null, target: PokemonTarget) => {
    if (pokemon === null) return;
    const uid = topUid(pokemon);
    const card = uid === undefined ? undefined : cardOfUid(state, uid);
    if (uid === undefined || card === undefined) return;
    for (const ability of programFor(card.id)?.abilities ?? []) {
      // No excludeUid: an Ability's card is on the BOARD, not the hand it pays out
      // of (which is why none of these cards prints the Trainer's "other").
      const costUnmet = handCostUnmet(state, viewerSeat, ability.program);
      const noTarget = !programPlayable(state, ability.program, viewerSeat);
      const disabled =
        (ability.activeOnly && target.spot !== "active") ||
        (ability.oncePerTurn &&
          state.allowances.abilitiesUsed.includes(`${uid}:${ability.name}`)) ||
        costUnmet !== null ||
        noTarget;
      const where = target.spot === "active" ? "Active" : `Bench ${target.index + 1}`;
      out.push({
        // A FRESH target per row (never the shared `consider` param — a card with
        // two activated abilities would otherwise alias one literal across both
        // rows), rebuilt explicitly like redactedRefOf — the redactor's no-alias
        // purity contract.
        target:
          target.spot === "active" ? { spot: "active" } : { spot: "bench", index: target.index },
        abilityName: ability.name,
        // Disambiguates two copies of the same card carrying the same Ability
        // (Skwovet ×2) by its board position, exactly as the local list does.
        label: `${ability.name} · ${card.name} (${where})`,
        disabled,
        // The printed clause a greyed row shows; null when enabled or the disable
        // is self-evident (Active-only / already-used), matching the local row.
        reason:
          costUnmet !== null
            ? `Only if you ${handCostAction(costUnmet, false)}`
            : noTarget
              ? "No legal target"
              : null,
      });
    }
  };
  consider(side.active, { spot: "active" });
  side.bench.forEach((pokemon, index) => consider(pokemon, { spot: "bench", index }));
  return out;
}

/** The acting viewer's non-Stadium Trainers (Items/Supporters + Rare Candy)
    playable from their OWN hand, with server-computed playability, for the online
    turn HUD (3b) — [] for the opponent. Mirrors GameHud's `playableTrainers` on
    the full state the wire withholds, deduped to one entry per distinct card,
    EXCLUDING only STADIUMS: they play by the board DRAG (the 2a moveToAction path
    — offered here too would double the affordance). (Tools are drag gestures too,
    and fall out on `program.trainer === undefined`.) RARE CANDY is included and
    FLAGGED (3b-ii): it evolves rather than running a program, so its row opens the
    two-step dialog fed by `redactedRareCandyOf` and answers with the `rareCandy`
    action — but it is still a hand Trainer, so it belongs in this list, exactly as
    the local HUD has it. `disabled` folds the §4 first-turn Supporter ban + §7.2
    one-per-turn, the printed `trainerPlayableIf` board gate (`conditionHolds` reads
    prize counts + the Stadium OWNER the wire withholds), the §7.5 hand cost
    (`handCostUnmet`, the played uid excluded — the printed "OTHER cards"), the
    would-only-whiff `programPlayable` gate and — for Rare Candy alone — the §7.1
    "is there a legal pairing" gate into ONE boolean, EXACTLY as the local Trainer
    row. Every input is the viewer's own hand + public counts/boards, emitted only
    to the actor, so nothing hidden leaves the DO. `uid` (already on the viewer's
    own face-up hand) is what the `playTrainer` / `rareCandy` action dispatches
    back. */
function redactedTrainersOf(
  state: GameState,
  viewerSeat: Seat,
  turnSeat: Seat | null,
): RedactedTrainer[] {
  if (viewerSeat !== turnSeat) return [];
  const side = state.players[viewerSeat];
  // §7.1 legality (a Basic in play + a matching Stage 2 in hand + timing) is the
  // engine's — greying Rare Candy out before the reject. Computed LAZILY (its
  // cardPool scan is only worth paying when a Rare Candy is actually in hand),
  // the local list's own shape.
  let candyOptions: number | null = null;
  const rareCandyPlayable = (): boolean => {
    if (candyOptions === null) candyOptions = rareCandyOptions(state, viewerSeat).length;
    return candyOptions > 0;
  };
  const seen = new Set<string>();
  const out: RedactedTrainer[] = [];
  for (const uid of side.hand) {
    const card = cardOfUid(state, uid);
    if (card === undefined || card.category !== "Trainer" || seen.has(card.id)) continue;
    const program = programFor(card.id);
    if (program === undefined) continue;
    const isRareCandy = program.rareCandy === true;
    // Stadiums play by the board DRAG, not a button here.
    if (card.trainerType === "Stadium") continue;
    // No Item/Supporter play path (a Tool, or an unauthored Trainer) — not offered;
    // the coverage strategy surfaces it as "not simulated" on attempt. Rare Candy
    // is exempt: it is a marker program (`{rareCandy: true}`) with no `trainer`
    // ops, since the `rareCandy` action evolves instead of running one.
    if (!isRareCandy && program.trainer === undefined) continue;
    seen.add(card.id);
    const isSupporter = card.trainerType === "Supporter";
    // The three Item/Supporter gates are scoped OFF Rare Candy exactly as the local
    // list scopes them: cardplay.ts reads `trainerPlayableIf` / the hand cost / the
    // whiff predicate only in playTrainer's Item/Supporter branch, and the
    // `rareCandy` action consults none of them — greying on one here would disagree
    // with the engine.
    const gated = isRareCandy ? undefined : program.trainerPlayableIf;
    const gateUnmet = gated !== undefined && !conditionHolds(state, viewerSeat, gated);
    const costUnmet = isRareCandy
      ? null
      : handCostUnmet(state, viewerSeat, program.trainer ?? [], uid);
    const noTarget = !isRareCandy && !programPlayable(state, program.trainer ?? [], viewerSeat);
    const disabled =
      gateUnmet ||
      costUnmet !== null ||
      noTarget ||
      (isRareCandy
        ? !rareCandyPlayable()
        : isSupporter && (state.turn === 1 || state.allowances.supporterPlayed));
    out.push({
      uid,
      name: card.name,
      disabled,
      // The printed/engine clause a greyed row shows; null when enabled or the
      // disable is self-evident (the §4/§7.2 timing, and — like the local row —
      // Rare Candy's no-legal-pairing, which the empty dialog would only restate),
      // matching the local row.
      reason:
        gateUnmet && gated !== undefined
          ? `Only if ${conditionNote(gated)}`
          : costUnmet !== null
            ? `Only if you ${handCostAction(costUnmet, true)}`
            : noTarget
              ? "No legal target"
              : null,
      rareCandy: isRareCandy,
    });
  }
  return out;
}

/** The acting viewer's legal Rare Candy pairings (§7.1) — what the online Rare
    Candy dialog offers behind the `rareCandy`-flagged Trainer row (increment
    3b-ii) — [] for the opponent, who never plays one. The legality is the
    ENGINE's: `rareCandyOptions` already folds the §4 first-turn ban, the
    Basic-in-play + came-into-play-this-turn checks and the Basic→Stage 1→Stage 2
    chain bridge (a cardPool scan the wire could not carry), so this only maps its
    result to the wire shape and resolves the two display names. Everything named
    is the actor's OWN in-play stack top + OWN hand — face-up to this viewer
    already, and emitted to them alone — so nothing hidden leaves the DO. The
    `target` literal is rebuilt fresh (never the option's own object) to keep the
    redactor's no-alias purity contract, as `redactedRefOf` does. */
function redactedRareCandyOf(
  state: GameState,
  viewerSeat: Seat,
  turnSeat: Seat | null,
): RedactedRareCandyOption[] {
  if (viewerSeat !== turnSeat) return [];
  return rareCandyOptions(state, viewerSeat).map((option) => ({
    target:
      option.target.spot === "active"
        ? { spot: "active" }
        : { spot: "bench", index: option.target.index },
    basicUid: option.basicUid,
    basicName: cardOfUid(state, option.basicUid)?.name ?? option.basicUid,
    stage2: option.stage2Uids.map((uid) => ({
      uid,
      name: cardOfUid(state, uid)?.name ?? uid,
    })),
  }));
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
    return {
      id: uid,
      cardId,
      name: cardId,
      category: "Trainer",
      trainerType: null,
      hasImage: false,
    };
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
