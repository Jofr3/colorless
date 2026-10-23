// The pure per-viewer game redactor: a client must never see the opponent's hand, deck order or
// prize contents. `redactGame(state, seat)` builds the `RedactedGame` snapshot for one viewer.

import type {
  RedactedAbility,
  RedactedAttack,
  RedactedCard,
  RedactedDiscardable,
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
  RedactedStadiumAbility,
  RedactedTrainer,
  Viewer,
} from "@colorless/schema";
import {
  EMPTY_CARD_ID,
  EMPTY_CARD_NAME,
  HIDDEN_CARD_ID,
  HIDDEN_CARD_NAME,
} from "@colorless/schema";
import { attackCostAt, costMet } from "./attack";
import { pendingMulligansOf } from "./mulligans";
import {
  abilityBodyGateClause,
  abilityBodyGateMet,
  abilityUsedKey,
  fossilPlayable,
  programPlayable,
  rareCandyOptions,
  stadiumPlayOverUnmet,
  stadiumSpentPlayLifted,
  trainerProgramPlayable,
} from "./cardplay";
import { cardOfUid, topCardOf, topUid } from "./cards";
import {
  attackLocked,
  attackMenuOf,
  disabledAbilityUids,
  effectiveMaxHp,
  effectiveRetreatCost,
  firstTurnAttackBanned,
  handPlayBarred,
  lockedAttackIndexes,
  lockedAttackNames,
  opposingRetreatBlocked,
  providedEnergy,
  retreatLocked,
} from "./continuous";
import type { DiscardScope, EffectPrompt, PokemonRef } from "./effectPrompt";
import {
  attackAgainBarred,
  attackBarredByAbility,
  attackTimingBlocked,
  conditionHolds,
  conditionNote,
} from "./boardCondition";
import { handCostAction } from "./promptText";
import { handCostUnmet } from "./ops/cards";
import { inSetup, phaseViewOf } from "./phaseView";
import { discardableTargets, evolutionTargetUids } from "./turn";
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
import { answererOf, bodyAt, isImmobilized, otherSeat } from "./types";

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
        ...(phase.stage === undefined ? {} : { stage: phase.stage }),
        ...(phase.bonusCards === undefined
          ? {}
          : { bonusCards: spectating ? [] : phase.bonusCards[viewerSeat] }),
      };
    case "turn:action": {
      // Only turn:action's actor gets attack, retreat, ability, trainer and Rare Candy options; the
      // opponent's view carries none.
      const actor = spectating ? null : phase.seat;
      // Inside Festival Lead's attack-again window only `attack` and `endTurn` are legal, so every
      // other affordance is withheld.
      const mainPhase = state.allowances.attackAgainUid === null ? actor : null;
      return {
        kind: "turn:action",
        attacks: redactedAttacksOf(state, viewerSeat, actor),
        retreat: redactedRetreatOf(state, viewerSeat, mainPhase),
        abilities: redactedAbilitiesOf(state, viewerSeat, mainPhase),
        trainers: redactedTrainersOf(state, viewerSeat, mainPhase),
        rareCandy: redactedRareCandyOf(state, viewerSeat, mainPhase),
        stadiumAbility: redactedStadiumAbilityOf(state, viewerSeat, mainPhase),
        discardable: redactedDiscardableOf(state, viewerSeat, mainPhase),
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

/**
 * The redacted mid-effect prompt, non-null only for the seat that must answer it (`phase.answerer
 * ?? phase.seat`). This is the hidden-information barrier: candidates come from the answerer's
 * private zones.
 */
function redactedPromptOf(
  state: GameState,
  phase: Extract<Phase, { kind: "effect:choose" }>,
  viewerSeat: Seat,
): RedactedEffectPrompt | null {
  const answerer = answererOf(phase);
  if (answerer !== viewerSeat) return null;
  const prompt = redactPrompt(state, phase.prompt);
  const op = phase.cont.pendingOp;
  // Public presentation metadata lets online clients target Adrena-Brain on the
  // board and recover the chosen source after reconnecting mid-ability.
  if (prompt.kind === "choosePokemon" && op.op === "moveCountersToOpponentChosen") {
    return {
      ...prompt,
      counterTransfer: {
        upTo: op.upTo,
        abilitySourceUid: phase.cont.ctx.sourceUid,
        ...(op.from === undefined
          ? {}
          : {
              from: redactedRefOf({ seat: phase.seat, spot: op.from }),
            }),
      },
    };
  }
  return prompt;
}

/**
 * Map the engine's `EffectPrompt` to the neutral wire shape, deciding only what identity crosses.
 */
function redactPrompt(state: GameState, prompt: EffectPrompt): RedactedEffectPrompt {
  switch (prompt.kind) {
    case "mayDraw":
      return { kind: "mayDraw", count: prompt.count, note: prompt.note };
    case "guessHp":
      // Tyme's guess goes to the opponent: the told name and the note, never the face-down card's
      // uid or HP.
      return { kind: "guessHp", name: prompt.name, note: prompt.note };
    case "confirm":
      // The printed "you may" (`optional`): no references and no count, the decision is the whole
      // sentence.
      return {
        kind: "confirm",
        note: prompt.note,
        ...(prompt.labels === undefined
          ? {}
          : { labels: { yes: prompt.labels.yes, no: prompt.labels.no } }),
        ...(prompt.cards === undefined
          ? {}
          : {
              cards: {
                yes: redactedCardOf(state, prompt.cards.yes),
                ...(prompt.cards.no === undefined
                  ? {}
                  : { no: redactedCardOf(state, prompt.cards.no) }),
              },
            }),
        ...(prompt.targets === undefined ? {} : { targets: prompt.targets.map(redactedRefOf) }),
      };
    case "orderCards":
      // The ordered window resolves to the answerer alone; these cards can come from the other
      // seat's deck, so this keeps the deck's owner from seeing their own top.
      return {
        kind: "orderCards",
        candidates: prompt.candidates.map((uid) => redactedCardOf(state, uid)),
        note: prompt.note,
        ...(prompt.alt === undefined ? {} : { alt: prompt.alt }),
      };
    case "choosePokemon":
      // Conditional spread: `upTo: undefined` is not the same wire value as no key, and mandatory
      // parks must keep their exact shape.
      return {
        kind: "choosePokemon",
        candidates: prompt.candidates.map(redactedRefOf),
        ...(prompt.upTo === undefined ? {} : { upTo: prompt.upTo }),
        note: prompt.note,
        ...(prompt.takeVerb === undefined ? {} : { takeVerb: prompt.takeVerb }),
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
        // The floor crosses because the online dialog and `validateChoice` read the wire prompt;
        // dropping it would let a remote player refuse a mandatory move.
        ...(prompt.min === undefined ? {} : { min: prompt.min }),
        // N's Plan's single-source coupling must cross: the online dialog and wire validator read
        // this object, not the op.
        ...(prompt.anySource === undefined ? {} : { anySource: prompt.anySource }),
        // The destination-side rider crosses for the same reason as the source-side one.
        ...(prompt.anyDest === undefined ? {} : { anyDest: prompt.anyDest }),
        note: prompt.note,
      };
    case "discardEnergy":
      return {
        kind: "discardEnergy",
        discardable: prompt.discardable.map(redactedOfferOf),
        scope: redactedScopeOf(prompt.scope),
        note: prompt.note,
      };
    case "discardTools":
      // A Tool on an in-play Pokémon is face up, so the wire carries the uid and host ref and the
      // client resolves the name from its board.
      return {
        kind: "discardTools",
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
        // Per-kind caps (Drayton), spread when present; fresh objects and arrays so the wire never
        // aliases game state.
        ...(prompt.caps === undefined
          ? {}
          : { caps: prompt.caps.map((cap) => ({ uids: [...cap.uids], max: cap.max })) }),
        // Disjunctive caps (Brock's Scouting), same rules as `caps`.
        ...(prompt.capsAnyOf === undefined
          ? {}
          : {
              capsAnyOf: prompt.capsAnyOf.map((entry) => ({
                uids: [...entry.uids],
                max: entry.max,
              })),
            }),
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
        // The printed "1 of your Pokémon", so the client does not offer a second body the server
        // would refuse. `true` or absent.
        oneTarget: prompt.oneTarget,
        note: prompt.note,
      };
    case "chooseAttack":
      // Attack candidates are public, but the wire has no board projection of attack rows, so the
      // server resolves a label.
      return {
        kind: "chooseAttack",
        candidates: prompt.candidates.map((c) => ({ index: c.index, name: c.name })),
        note: prompt.note,
      };
    case "choosePrize":
      // Indices only: every offered prize slot is face down, so no uid or card id crosses. Also
      // holds when parked over the opponent's row.
      return { kind: "choosePrize", indices: [...prompt.indices], note: prompt.note };
  }
}

/**
 * A fresh copy of a `PokemonRef` for the wire, never an alias into game state. The `seat` is
 * absolute; see `RedactedPokemonRef`.
 */
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

/**
 * A fresh copy of a `DiscardScope` for the wire, with a `never` floor so a new member is a compile
 * error rather than a silent drop.
 */
function redactedScopeOf(scope: DiscardScope): RedactedDiscardScope {
  switch (scope.kind) {
    case "total":
      return { kind: "total", count: scope.count };
    case "each":
      return { kind: "each" };
    case "upTo":
      // The CEILING crosses as a ceiling. Copied by value like every other branch
      // in this file — the redactor's no-alias purity contract — which here also
      // means the wire object and the engine prompt's own scope are never `===`.
      return { kind: "upTo", max: scope.max };
  }
  const unhandled: never = scope;
  throw new Error(`redactedScopeOf: unhandled discard scope ${(unhandled as DiscardScope).kind}`);
}

/**
 * The acting viewer's Active's attacks with server-computed payability for the online turn HUD; []
 * for the opponent.
 */
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
  // §4 turn 1 belongs to the going-first player; §12 asleep/paralyzed blocks attacking; §8/§11 an
  // attack-installed lock does too. All fold into `playable` since the client only needs to know it
  // cannot attack.
  const banned =
    isImmobilized(active.conditions) ||
    attackLocked(state, active) ||
    attackBarredByAbility(state, viewerSeat, active) !== undefined ||
    attackAgainBarred(state, viewerSeat, active);
  // The per-attack bar folds into `playable`, not `banned`, because `banned` applies to every row.
  const barred = lockedAttackIndexes(state, active);
  // Borrowed rows locked by name (`lockedAttackNames`) are greyed too.
  const barredNames = lockedAttackNames(state, active);
  // Rows follow `attackMenuOf`: printed attacks first (flat index = printed index), then Memory
  // Dive rows, then a Technical Machine's. `cost` is the cost printed on the row's own card.
  return attackMenuOf(state, viewerSeat, active).map(({ attack, origin, sourceIndex }, index) => {
    const printed = attack.cost ?? [];
    // §8.2/§7.3 the cost the gate charges, including Stadium surcharges, auras and discounts; used
    // for both `playable` and `effectiveCost` so they cannot disagree.
    const effective = attackCostAt(state, viewerSeat, active, index, provided);
    const modified =
      effective.length !== printed.length || effective.some((s, i) => s !== printed[i]);
    return {
      index,
      name: attack.name,
      cost: [...printed],
      ...(modified ? { effectiveCost: [...effective] } : {}),
      damage: attack.damage === undefined ? null : String(attack.damage),
      playable:
        !banned &&
        !(origin === "printed" && barred.includes(sourceIndex)) &&
        !barredNames.includes(attack.name) &&
        // §4 first-turn ban and its licences, asked per row because an attack-printed licence can
        // differ between rows of one card.
        !firstTurnAttackBanned(state, active, index) &&
        // §4/§8 the attack's printed timing clause, per row for the same reason.
        attackTimingBlocked(state, viewerSeat, active, index) === undefined &&
        costMet(effective, provided),
    };
  });
}

/**
 * The acting viewer's retreat option for the online turn HUD; null for the opponent. `can` folds
 * the immobilize and attack-applied retreat gates.
 */
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
    // `retreatLocked` covers the self-installed lock too, so the HUD never offers a retreat the §11
    // gate refuses.
    !retreatLocked(state, active) &&
    // §11 — the opposing CONTINUOUS Ability block (Snorlax "Block"), which rides
    // `can` for the same reason the attack-applied one does: no new wire field.
    !opposingRetreatBlocked(state, active) &&
    !state.allowances.retreated &&
    state.players[viewerSeat].bench.length > 0 &&
    active.energy.length >= cost;
  return { cost, can };
}

/**
 * The acting viewer's activated Abilities with server-computed playability for the online turn HUD;
 * [] for the opponent.
 */
function redactedAbilitiesOf(
  state: GameState,
  viewerSeat: Seat,
  turnSeat: Seat | null,
): RedactedAbility[] {
  if (viewerSeat !== turnSeat) return [];
  const side = state.players[viewerSeat];
  const out: RedactedAbility[] = [];
  // §9 — Pokémon under a continuous Ability-lock aura render their Ability rows
  // greyed, mirroring useAbility's ABILITY_DISABLED reject so the HUD never
  // offers a button the engine will refuse.
  const lockedUids = disabledAbilityUids(state);
  const consider = (pokemon: InPlayPokemon | null, target: PokemonTarget) => {
    if (pokemon === null) return;
    const uid = topUid(pokemon);
    const card = uid === undefined ? undefined : cardOfUid(state, uid);
    if (uid === undefined || card === undefined) return;
    for (const ability of programFor(card.id)?.abilities ?? []) {
      // No excludeUid: an Ability's card is on the BOARD, not the hand it pays out
      // of (which is why none of these cards prints the Trainer's "other").
      const costUnmet = handCostUnmet(state, viewerSeat, ability.program);
      // The body's `uid` is passed so gates that read "this Pokémon" have a referent.
      const noTarget = !programPlayable(state, ability.program, viewerSeat, uid);
      // §9 printed board gate (Fezandipiti ex); not evident from the board, so it carries a
      // `reason`.
      const gateUnmet =
        ability.playableIf !== undefined && !conditionHolds(state, viewerSeat, ability.playableIf);
      // §9 per-body gate through the shared `abilityBodyGateMet`, so the HUD and engine cannot
      // disagree.
      const bodyGateUnmet = !abilityBodyGateMet(state, ability, pokemon);
      const disabled =
        lockedUids.has(uid) ||
        (ability.activeOnly && target.spot !== "active") ||
        bodyGateUnmet ||
        (ability.benchOnly === true && target.spot !== "bench") ||
        // The KEY comes from `abilityUsedKey`, never spelled here: a
        // "sharedByName" Ability (Fezandipiti ex) keys on its name alone, and a
        // mirror that kept building `${uid}:` would leave the second copy's row
        // lit after the first copy spent the turn's one use.
        (ability.oncePerTurn &&
          state.allowances.abilitiesUsed.includes(abilityUsedKey(uid, ability))) ||
        gateUnmet ||
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
            : ability.playableIf !== undefined && gateUnmet
              ? `Only if ${conditionNote(ability.playableIf)}`
              : // Below the board gate, matching `useAbility`'s reject order so both name the same clause.
                bodyGateUnmet
                ? `Only if ${abilityBodyGateClause(ability) ?? "its printed condition holds"}`
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

/**
 * The acting viewer's playable hand Trainers (Items, Supporters, Rare Candy, Stadiums) for the
 * online turn HUD, deduped per card; [] for the opponent.
 */
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
  // §7.3 — the SHARED zone's current occupant NAME, for the same-name rule. Public
  // to both seats (`state.stadium` is on the wire already), and a NAME rather than
  // an id because different prints of one Stadium share it — `playStadium` compares
  // names, so this must too. Resolved once, outside the loop, exactly as the local
  // list has it.
  const inPlayStadium =
    state.stadium === null ? undefined : cardOfUid(state, state.stadium.uid)?.name;
  const seen = new Set<string>();
  const out: RedactedTrainer[] = [];
  for (const uid of side.hand) {
    const card = cardOfUid(state, uid);
    if (card === undefined || card.category !== "Trainer" || seen.has(card.id)) continue;
    const program = programFor(card.id);
    if (program === undefined) continue;
    const isRareCandy = program.rareCandy === true;
    const isStadium = card.trainerType === "Stadium";
    // No play path (Tool, unauthored Trainer or Stadium): not offered. Rare Candy and Antique
    // Fossils are exempt since they are marker programs with no `trainer` ops.
    const isFossil = program.playAsPokemon === true;
    if (
      !isRareCandy &&
      (isStadium ? program.stadium === undefined : program.trainer === undefined && !isFossil)
    ) {
      continue;
    }
    seen.add(card.id);
    const isSupporter = card.trainerType === "Supporter";
    // The Item/Supporter gates are not applied to Rare Candy, matching the engine's `rareCandy`
    // action.
    const gated = isRareCandy || isStadium ? undefined : program.trainerPlayableIf;
    const gateUnmet = gated !== undefined && !conditionHolds(state, viewerSeat, gated);
    const costUnmet =
      isRareCandy || isStadium
        ? null
        : handCostUnmet(state, viewerSeat, program.trainer ?? [], uid);
    // A fossil runs no program; its only gate is a free Bench slot.
    const noTarget =
      !isRareCandy &&
      !isStadium &&
      (isFossil
        ? !fossilPlayable(state, viewerSeat)
        : !trainerProgramPlayable(state, program.trainer ?? [], viewerSeat));
    // The §4 term carries the card's own first-turn exemption (`trainerFirstTurnExempt`), or this
    // would grey out a playable row.
    const klass = card.trainerType;
    const barred =
      !isRareCandy &&
      (klass === "Item" || klass === "Supporter" || klass === "Stadium") &&
      // The full catalog card is passed so the ACE SPEC rule is checked server-side without adding
      // `rarity` to `RedactedCard`.
      handPlayBarred(state, viewerSeat, klass, card);
    const disabled =
      gateUnmet ||
      costUnmet !== null ||
      noTarget ||
      barred ||
      (isRareCandy
        ? !rareCandyPlayable()
        : isSupporter
          ? (state.turn === 1 && program.trainerFirstTurnExempt !== true) ||
            state.allowances.supporterPlayed
          : // §7.3 Stadium rules: one Stadium play per turn, and the same name cannot replace itself.
            isStadium &&
            ((state.allowances.stadiumPlayed && !stadiumSpentPlayLifted(state, viewerSeat, card)) ||
              card.name === inPlayStadium ||
              stadiumPlayOverUnmet(state, card)));
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

/**
 * The acting viewer's legal Rare Candy pairings (§7.1), from the engine's `rareCandyOptions`; []
 * for the opponent.
 */
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

/**
 * §7.3 the shared Stadium's once-per-turn ability for the online turn HUD; null for the non-acting
 * viewer.
 */
function redactedStadiumAbilityOf(
  state: GameState,
  viewerSeat: Seat,
  turnSeat: Seat | null,
): RedactedStadiumAbility | null {
  if (viewerSeat !== turnSeat) return null;
  const stadium = state.stadium;
  if (stadium === null) return null;
  const card = cardOfUid(state, stadium.uid);
  const ability = card === undefined ? undefined : programFor(card.id)?.stadium?.ability;
  if (ability === undefined) return null;
  // The Stadium ability's printed gate, checked after the once-per-turn flag as in
  // `useStadiumAbility`.
  if (
    !state.allowances.stadiumAbilityUsed &&
    ability.playableIf !== undefined &&
    !conditionHolds(state, viewerSeat, ability.playableIf)
  ) {
    return {
      label: ability.label,
      disabled: true,
      reason: `Only if ${conditionNote(ability.playableIf)}`,
    };
  }
  const noTarget = !programPlayable(state, ability.program, viewerSeat);
  // The printed hand cost, with no `excludeUid` because the Stadium is not in the hand.
  const costUnmet = handCostUnmet(state, viewerSeat, ability.program);
  return {
    label: ability.label,
    disabled: state.allowances.stadiumAbilityUsed || noTarget || costUnmet !== null,
    // The printed clause a greyed row shows; null when enabled or the disable is
    // self-evident (already used this turn), matching the Ability/Trainer rows.
    reason: noTarget
      ? "No legal target"
      : costUnmet !== null
        ? `Only if you ${handCostAction(costUnmet, false)}`
        : null,
  };
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
      ? side.hand.map((uid) => {
          const card = redactedCardOf(state, uid);
          return card.category === "Pokemon"
            ? { ...card, evolutionTargetIds: evolutionTargetUids(state, seat, uid) }
            : card;
        })
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
    // Counts only: face-down prizes and deck cards never expose a uid or catalog id (§3.8). Face-up
    // prizes are public and ride `faceUpPrizes`.
    prizesRemaining: side.prizes.length,
    // `index` is the slot's position in the live row (as addressed by `takePrizes`/`choosePrize`),
    // derived from the stored uid because the row compacts on every take. Only face-up slots
    // appear.
    faceUpPrizes: side.prizes.flatMap((uid, index) =>
      side.faceUpPrizes.includes(uid) ? [{ index, card: redactedCardOf(state, uid) }] : [],
    ),
    deckCount: side.deck.length,
    mulliganCount: pendingMulligansOf(state, seat),
    // §2 — the discard pile is ordered and public.
    discard: side.discard.map((uid) => redactedCardOf(state, uid)),
  };
}

/**
 * The acting viewer's bodies whose Antique Fossil top card may be discarded from play now, read off
 * `discardableTargets`.
 */
function redactedDiscardableOf(
  state: GameState,
  viewerSeat: Seat,
  turnSeat: Seat | null,
): RedactedDiscardable[] {
  if (viewerSeat !== turnSeat) return [];
  const side = state.players[viewerSeat];
  return discardableTargets(state, viewerSeat).map((target) => {
    const body = bodyAt(side, target);
    const name = (body === undefined ? undefined : topCardOf(state, body)?.name) ?? "?";
    const where = target.spot === "active" ? "Active" : `Bench ${target.index + 1}`;
    return {
      target:
        target.spot === "active" ? { spot: "active" } : { spot: "bench", index: target.index },
      label: `${name} (${where})`,
    };
  });
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
    ...(card.category === "Pokemon" ? { stage: card.stage } : {}),
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
  const { rotation, poisonDamage, burned, confusionDamage } = conditions;
  return { rotation, poisonDamage, burned, confusionDamage } satisfies SpecialConditions;
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
