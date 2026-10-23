// Engine to playmat projection. Zones hold card uids resolved through `cardIdByUid` and `cardPool`,
// so this pure adapter builds the CardModel view per viewer, applying the hidden-information rules.

import type {
  DiscardScope,
  GameOutcome,
  GameOverReason,
  GameState,
  InPlayPokemon,
  PendingDecision,
  PokemonRef,
  Seat,
  SpecialConditions,
} from "@colorless/engine";
import {
  BENCH_MAX,
  benchLimitForIds,
  benchLimitOf,
  cardOfUid,
  effectiveMaxHp,
  evolutionTargetUids,
  inSetup,
  otherSeat,
  phaseViewOf,
  pendingMulligansOf,
  topUid,
} from "@colorless/engine";
import type {
  CardCategory,
  RedactedDiscardScope,
  RedactedGame,
  RedactedInPlay,
  RedactedPokemonRef,
  RedactedSide,
} from "@colorless/schema";
import { cardImageUrl } from "../lib/api";
import type {
  BattleConditions,
  BattleState,
  BoardState,
  CardModel,
  CardType,
  PlayerBoard,
  PlayerId,
} from "./board";

// The hidden/empty sentinels live in @colorless/schema (the wire redactor and
// this projection share them).
import {
  EMPTY_CARD_ID,
  EMPTY_CARD_NAME,
  HIDDEN_CARD_ID,
  HIDDEN_CARD_NAME,
} from "@colorless/schema";

/** The zones BoardState cannot carry: deck size and the public discard. */
export interface ProjectedPiles {
  /** Cards left in the deck — contents hidden, only the count is visible. */
  deckCount: number;
  /** Pending bonus cards this owner can draw from the opponent's mulligans. */
  mulliganCount?: number;
  /** The discard pile, fully public, oldest → newest (engine order). */
  discard: CardModel[];
}

// PendingDecision (the parked KO/effect interrupt) now lives in @colorless/engine
// (phaseView.ts) — shared with the P4 wire redactor — and is imported above.

/** The engine's GameOutcome with seats mapped into the viewer's vocabulary. */
export type ProjectedOutcome =
  | { result: "win"; winner: PlayerId; reason: GameOverReason }
  | { result: "tie"; reasons: Record<PlayerId, GameOverReason> };

/**
 * Why the game ended, as the one-line text both game-over surfaces show. A total `Record`, so an
 * unhandled reason is a compile error rather than a wrong message.
 */
export const GAME_OVER_DETAIL: Record<GameOverReason, string> = {
  prizesTaken: "All prize cards taken.",
  noPokemon: "No Pokémon left in play.",
  deckOut: "No cards left to draw.",
  conceded: "The match was forfeited.",
  // A card's printed win condition (N's Sigilyph "Victory Symbol").
  cardEffect: "A card's effect won the game.",
};

export interface GameProjection {
  /** Drop-in playmat board; `you` is always the viewer's seat. */
  board: BoardState;
  /** Deck counts + public discards, per side, keyed like the board. */
  piles: Record<PlayerId, ProjectedPiles>;
  /** 1-based turn counter; 0 while the game is still in setup. */
  turn: number;
  /** The TURN OWNER from the viewer's perspective. An ATTACK-origin ko:*
      park does not change it (the turn is still the attacker's); a
      CHECKUP-origin ko:* park sits BETWEEN turns, so it is null there —
      just as during setup (turn 0) and once the game is over. */
  activePlayer: PlayerId | null;
  /** Who must act RIGHT NOW: the turn owner in turn:action, the decision
      owner in setup and ko:* phases — ko:promote belongs to the KO'd seat,
      NOT the turn owner. Null once the game is over. */
  waitingOn: PlayerId | null;
  /** The KO interrupt the game is parked on; null in every other phase. */
  pendingDecision: PendingDecision | null;
  /** How the game ended, seats viewer-mapped; null while it is running. */
  outcome: ProjectedOutcome | null;
}

/** Project the engine state into what `viewerSeat` is allowed to see. Pure:
    same state + seat in, structurally-equal projection out. */
export function projectGameState(state: GameState, viewerSeat: Seat): GameProjection {
  const opponentSeat = otherSeat(viewerSeat);
  const view = phaseViewOf(state, viewerSeat);
  // Setup placements are face-down until both players ready, so the
  // opponent's in-play stacks (their battle rows included) redact until
  // then. The viewer's own placements stay face-up — they placed them.
  const setup = inSetup(state);
  return withEnergyChoice({
    board: {
      // §7.3 — the one shared Stadium, public to both viewers (played face-up
      // into a shared zone; there is nothing to redact).
      stadium: state.stadium === null ? null : cardModelOf(state, state.stadium.uid),
      you: playerBoardOf(state, viewerSeat, { faceUpHand: true, faceUpInPlay: true }),
      opponent: playerBoardOf(state, opponentSeat, { faceUpHand: false, faceUpInPlay: !setup }),
    },
    piles: {
      you: pilesOf(state, viewerSeat),
      opponent: pilesOf(state, opponentSeat),
    },
    turn: state.turn,
    activePlayer: asPlayerId(view.activeSeat, viewerSeat),
    waitingOn: asPlayerId(view.waitingSeat, viewerSeat),
    pendingDecision: view.pendingDecision,
    outcome: view.outcome === null ? null : outcomeFor(view.outcome, viewerSeat),
  });
}

function withEnergyChoice(projection: GameProjection): GameProjection {
  const decision = projection.pendingDecision;
  if (projection.waitingOn !== "you" || decision?.kind !== "effectChoose") return projection;
  const prompt = decision.prompt;
  if (prompt.kind !== "confirm" || prompt.cards === undefined || prompt.targets === undefined)
    return projection;
  const ids = [prompt.cards.yes, ...(prompt.cards.no === undefined ? [] : [prompt.cards.no])];
  const board = projection.board;
  return {
    ...projection,
    board: {
      ...board,
      energyChoice: {
        cards: ids.flatMap((id) => board.you.hand.filter((card) => card.id === id)),
        targets: prompt.targets.map((ref) => ({
          owner: "you",
          zone: ref.spot.spot,
          ...(ref.spot.spot === "bench" ? { index: ref.spot.index } : {}),
        })),
      },
      you: { ...board.you, hand: board.you.hand.filter((card) => !ids.includes(card.id)) },
    },
  };
}

/** How much of a side the viewer may see. The two redactions are
    independent: the opponent's HAND is always face-down, their IN-PLAY
    stacks only during setup (see hiddenInPlayModel). The viewer's own side
    is always fully face-up. */
interface SideVisibility {
  faceUpHand: boolean;
  faceUpInPlay: boolean;
}

function playerBoardOf(state: GameState, seat: Seat, visibility: SideVisibility): PlayerBoard {
  const side = state.players[seat];
  return {
    hand: visibility.faceUpHand
      ? side.hand.map((uid) => {
          const card = cardModelOf(state, uid);
          return card.type === "pokemon"
            ? { ...card, evolutionTargetIds: evolutionTargetUids(state, seat, uid) }
            : card;
        })
      : hiddenHand(side.hand.length),
    active:
      side.active === null
        ? null
        : visibility.faceUpInPlay
          ? inPlayModelOf(state, side.active)
          : hiddenInPlayModel("opponent-active-hidden"),
    // Index-stable: an (engine-impossible) empty stack projects as a slot
    // placeholder rather than vanishing — compacting the bench would desync
    // every index-addressed slot (promotions, drops) from the engine's.
    bench: visibility.faceUpInPlay
      ? side.bench.map(
          (pokemon, index) => inPlayModelOf(state, pokemon) ?? emptyStackModel(seat, index),
        )
      : side.bench.map((_, index) => hiddenInPlayModel(`opponent-bench-${index}-hidden`)),
    // Face-down prizes are hidden from both players (§3.8), so only the count is projected; face-up
    // prizes go in `faceUpPrizes`.
    prizesRemaining: side.prizes.length,
    // Same shape as the wire's `redactedSideOf`: only face-up slots, in row order, with `index` in
    // the live row (which compacts on every take).
    faceUpPrizes: side.prizes.flatMap((uid, index) =>
      side.faceUpPrizes.includes(uid) ? [{ index, card: cardModelOf(state, uid) }] : [],
    ),
    // Absent when the limit is the default 5.
    ...benchLimitField(benchLimitOf(state, seat)),
  };
}

/**
 * `PlayerBoard.benchLimit`, written only when it differs from `BENCH_MAX`; the playmat falls back
 * to 5 on its own.
 */
function benchLimitField(limit: number): { benchLimit?: number } {
  return limit === BENCH_MAX ? {} : { benchLimit: limit };
}

function pilesOf(state: GameState, seat: Seat): ProjectedPiles {
  const side = state.players[seat];
  return {
    deckCount: side.deck.length,
    mulliganCount: pendingMulligansOf(state, seat),
    discard: side.discard.map((uid) => cardModelOf(state, uid)),
  };
}

/** A public card: full identity, keyed by its engine uid. */
function cardModelOf(state: GameState, uid: string): CardModel {
  const card = cardOfUid(state, uid);
  if (card === undefined) {
    // Unreachable in practice (createGame validates every deck id against the
    // pool), but the adapter stays total: an identity-only placeholder that
    // still animates under its uid. "trainer" is the neutral type, the same
    // convention the animation layer uses for its synthetic backs.
    const cardId = state.cardIdByUid[uid] ?? uid;
    return { id: uid, cardId, name: cardId, type: "trainer" };
  }
  return {
    id: uid,
    cardId: card.id,
    name: card.name,
    type: cardTypeOf(card),
    ...(card.category === "Pokemon" ? { stage: card.stage } : {}),
    // `card.image` is the asset base path or null (no scan) — the URL itself
    // comes from the one existing helper so the scheme lives in one place.
    imageUrl: card.image === null ? undefined : cardImageUrl(card.id, "high"),
  };
}

/** An in-play Pokémon: the top of the stack defines its identity (§1.2);
    attached energy/tools ride along as face-up CardModels; its battle state
    (damage, max HP, §12 special conditions — all public table facts) rides
    on the model as `battle`. Only in-play top cards ever carry `battle`, and
    only face-up ones — the setup-phase hidden backs go through
    hiddenInPlayModel instead, so redaction never leaks a printed HP. The
    lower stack cards (evolution, M4) still have no projection surface. */
function inPlayModelOf(state: GameState, pokemon: InPlayPokemon): CardModel | null {
  const uid = topUid(pokemon);
  if (uid === undefined) return null; // stacks are never empty, but stay total
  return {
    ...cardModelOf(state, uid),
    battle: battleStateOf(state, pokemon),
    attached: {
      tools: pokemon.tools.map((toolUid) => cardModelOf(state, toolUid)),
      energies: pokemon.energy.map((energyUid) => cardModelOf(state, energyUid)),
    },
  };
}

/** The playmat-facing battle row: a field-by-field COPY (never an alias) of
    the engine values — a consumer mutating a projection must not reach back
    into game state. The playmat restates the engine's SpecialConditions as
    BattleConditions to stay engine-free; the copy alone would NOT pin that
    restatement (a field added to SpecialConditions would just be dropped
    here and silently never render), so the asserts below do. */
function battleStateOf(state: GameState, pokemon: InPlayPokemon): BattleState {
  const { rotation, poisonDamage, burned, confusionDamage } = pokemon.conditions;
  // Mutual-assignability pin, both directions: `satisfies` = the rebuilt
  // copy is still a COMPLETE SpecialConditions (an added engine field errors
  // here); the annotation = it is an exact BattleConditions (playmat-side
  // drift errors here).
  const conditions: BattleConditions = {
    rotation,
    poisonDamage,
    burned,
    confusionDamage,
  } satisfies SpecialConditions;
  return {
    damage: pokemon.damage,
    // The CONTINUOUS max HP (printed + Tool bonuses — Bravery Charm), the
    // same number the engine's KO check reads; null stays the data gap.
    hp: effectiveMaxHp(state, pokemon),
    conditions,
  };
}

/** The slot-holder projected for an empty in-play stack (see playerBoardOf).
    Positional id like the hidden-hand backs; a distinct cardId, because
    "empty" is NOT a face-down card — there is nothing there. "trainer" is
    the neutral placeholder type again. */
function emptyStackModel(seat: Seat, index: number): CardModel {
  return {
    id: `${seat}-bench-${index}-empty`,
    cardId: EMPTY_CARD_ID,
    name: EMPTY_CARD_NAME,
    type: "trainer",
  };
}

/** A face-down back for an opponent in-play stack during setup. Positional
    id, NOT the engine uid — leaking the uid would let a client match the
    stack against cards it later sees move (the same rule as hiddenHand).
    When SETUP_REVEALED flips the board public the model re-keys from this
    positional id to the real uid, so the reveal is a remount rather than a
    flip animation — the same accepted trade as the opponent-hand backs.
    Only opponent stacks ever redact, hence the fixed "opponent-" ids
    (mirroring hiddenHand). */
function hiddenInPlayModel(id: string): CardModel {
  return {
    id,
    cardId: HIDDEN_CARD_ID,
    name: HIDDEN_CARD_NAME,
    type: "trainer", // neutral, mirrors the synthetic deck/prize backs
  };
}

/** Face-down backs for the opponent's hand. Ids are positional (`opponent-
    hand-N`), NOT the engine uids: a uid is stable across zones, so leaking it
    here would let a client track a specific hidden card from the moment it
    was drawn — exactly what P4's filter must prevent. */
function hiddenHand(count: number): CardModel[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `opponent-hand-${index}`,
    cardId: HIDDEN_CARD_ID,
    name: HIDDEN_CARD_NAME,
    type: "trainer" as const, // neutral, mirrors the synthetic deck/prize backs
  }));
}

/** tcgdex category/trainerType → the playmat's CardType vocabulary. Takes just
    the two fields it reads, so both a full catalog `Card` and a wire
    `RedactedCard` feed it. */
function cardTypeOf(card: { category: CardCategory; trainerType: string | null }): CardType {
  switch (card.category) {
    case "Pokemon":
      return "pokemon";
    case "Energy":
      return "energy";
    case "Trainer":
      if (card.trainerType === "Tool") return "tool";
      if (card.trainerType === "Stadium") return "stadium";
      return "trainer";
  }
}

/** Engine seat → the viewer's vocabulary. */
function asPlayerId(seat: Seat | null, viewerSeat: Seat): PlayerId | null {
  if (seat === null) return null;
  return seat === viewerSeat ? "you" : "opponent";
}

// PhaseView + phaseViewOf (the exhaustive Phase→view switch) + its
// koParkActiveSeat/turnOwnerOf/preferViewer helpers now live in
// @colorless/engine (phaseView.ts), shared with the P4 wire redactor; phaseViewOf
// is imported above.

/** Viewer-map a finished game's outcome — fresh objects, nothing aliased
    from the engine state. */
function outcomeFor(outcome: GameOutcome, viewerSeat: Seat): ProjectedOutcome {
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

// The wire adapter: RedactedGame to GameProjection. The server already applied every
// hidden-information rule, so this is a mechanical map into the same shape `projectGameState`
// produces.

/** Adapt a server-redacted match snapshot into the playmat's GameProjection.
    Pure; the online table (src/lua/onlineTable.ts) feeds the result to the
    board exactly as the local table feeds projectGameState's. */
export function projectionFromRedacted(game: RedactedGame): GameProjection {
  const stadiumCardId = game.board.stadium?.cardId;
  return withEnergyChoice({
    board: {
      stadium: game.board.stadium === null ? null : cardModelFromRedacted(game.board.stadium),
      you: playerBoardFromRedacted(game.board.you, stadiumCardId),
      opponent: playerBoardFromRedacted(game.board.opponent, stadiumCardId),
    },
    piles: {
      you: pilesFromRedacted(game.board.you),
      opponent: pilesFromRedacted(game.board.opponent),
    },
    turn: game.turn,
    // The wire is viewer-relative already — Viewer ("you"/"opponent") IS the
    // playmat's PlayerId, so these pass straight through.
    activePlayer: game.activePlayer,
    waitingOn: game.waitingOn,
    pendingDecision: decisionFromPhase(game.phase),
    outcome:
      game.outcome === null
        ? null
        : game.outcome.result === "win"
          ? { result: "win", winner: game.outcome.winner, reason: game.outcome.reason }
          : { result: "tie", reasons: { ...game.outcome.reasons } },
  });
}

function playerBoardFromRedacted(
  side: RedactedSide,
  stadiumCardId: string | undefined,
): PlayerBoard {
  // The per-seat Bench limit from the wire's public card ids (the Stadium and this side's in-play
  // top cards).
  const inPlay = [...(side.active === null ? [] : [side.active]), ...side.bench].map(
    (card) => card.cardId,
  );
  return {
    hand: side.hand.map(cardModelFromRedacted),
    active: side.active === null ? null : cardModelFromRedacted(side.active),
    bench: side.bench.map(cardModelFromRedacted),
    prizesRemaining: side.prizesRemaining,
    // Rebuilt card by card so the round trip equals the local projection's `faceUpPrizes`.
    faceUpPrizes: side.faceUpPrizes.map((p) => ({
      index: p.index,
      card: cardModelFromRedacted(p.card),
    })),
    ...benchLimitField(benchLimitForIds(stadiumCardId, inPlay)),
  };
}

function pilesFromRedacted(side: RedactedSide): ProjectedPiles {
  return {
    deckCount: side.deckCount,
    mulliganCount: side.mulliganCount ?? 0,
    discard: side.discard.map(cardModelFromRedacted),
  };
}

/** A wire card → the playmat CardModel. Accepts leaf `RedactedCard`s too (their
    optional battle/attached are simply absent). The asset URL is built here from
    `cardId` + `hasImage`, so the scheme lives on the client, exactly as
    cardModelOf does for local play. */
function cardModelFromRedacted(card: RedactedInPlay): CardModel {
  const model: CardModel = {
    id: card.id,
    cardId: card.cardId,
    name: card.name,
    type: cardTypeOf(card),
    ...(card.stage !== undefined ? { stage: card.stage } : {}),
    ...(card.evolutionTargetIds !== undefined
      ? { evolutionTargetIds: [...card.evolutionTargetIds] }
      : {}),
  };
  if (card.hasImage) model.imageUrl = cardImageUrl(card.cardId, "high");
  if (card.attached !== undefined) {
    model.attached = {
      tools: card.attached.tools.map(cardModelFromRedacted),
      energies: card.attached.energies.map(cardModelFromRedacted),
    };
  }
  if (card.battle !== undefined) {
    model.battle = {
      damage: card.battle.damage,
      hp: card.battle.hp,
      conditions: { ...card.battle.conditions },
    };
  }
  return model;
}

/**
 * The parked KO or effect interrupt, derived from the redacted phase. The mid-effect prompt is
 * rebuilt into the same `PendingDecision.effectChoose` the local `phaseViewOf` produces.
 */
function decisionFromPhase(phase: RedactedGame["phase"]): PendingDecision | null {
  switch (phase.kind) {
    case "ko:takePrizes":
      return { kind: "takePrizes", count: phase.count };
    case "ko:promote":
      return { kind: "promote" };
    // The prompt is null on the wire when withheld from this viewer (the
    // non-answerer) or not-yet-redacted; a present one rebuilds the engine's
    // EffectPrompt so the round-trip reproduces phaseViewOf's decision exactly.
    case "effect:choose":
      return phase.prompt === null ? null : effectDecisionFromPrompt(phase.prompt);
    default:
      return null;
  }
}

/**
 * Rebuild the engine `PendingDecision.effectChoose` from a redacted wire prompt. Exhaustive, so a
 * new wire arm is a compile error here. Hidden-candidate arms carry a `RedactedCard` whose `id` is
 * the engine uid.
 */
function effectDecisionFromPrompt(
  prompt: NonNullable<Extract<RedactedGame["phase"], { kind: "effect:choose" }>["prompt"]>,
): PendingDecision {
  switch (prompt.kind) {
    case "mayDraw":
      return {
        kind: "effectChoose",
        prompt: { kind: "mayDraw", count: prompt.count, note: prompt.note },
      };
    case "guessHp":
      // Tyme's guess: the name and the note are the whole prompt.
      return {
        kind: "effectChoose",
        prompt: { kind: "guessHp", name: prompt.name, note: prompt.note },
      };
    case "confirm":
      // The printed "you may": the prompt is its sentence, so it rebuilds field for field. Optional
      // `labels` are spread conditionally; without them the dialog would show Yes / No instead of
      // the printed choices.
      return {
        kind: "effectChoose",
        prompt: {
          kind: "confirm",
          note: prompt.note,
          ...(prompt.labels === undefined
            ? {}
            : { labels: { yes: prompt.labels.yes, no: prompt.labels.no } }),
          ...(prompt.cards === undefined
            ? {}
            : {
                cards: {
                  yes: prompt.cards.yes.id,
                  ...(prompt.cards.no === undefined ? {} : { no: prompt.cards.no.id }),
                },
              }),
          ...(prompt.targets === undefined ? {} : { targets: prompt.targets.map(refFromWire) }),
        },
      };
    case "choosePokemon":
      return {
        kind: "effectChoose",
        prompt: {
          kind: "choosePokemon",
          candidates: prompt.candidates.map(refFromWire),
          // Spread conditionally: dropping it would rebuild a park with a printed ceiling as
          // mandatory, removing the decline and the middle quantities.
          ...(prompt.upTo === undefined ? {} : { upTo: prompt.upTo }),
          note: prompt.note,
          // The quantity picker's verb, spread conditionally like the other optional fields.
          ...(prompt.takeVerb === undefined ? {} : { takeVerb: prompt.takeVerb }),
        },
      };
    case "choosePokemonMulti":
      return {
        kind: "effectChoose",
        prompt: {
          kind: "choosePokemonMulti",
          candidates: prompt.candidates.map(refFromWire),
          min: prompt.min,
          max: prompt.max,
          declinable: prompt.declinable,
          note: prompt.note,
        },
      };
    case "moveEnergy":
      return {
        kind: "effectChoose",
        prompt: {
          kind: "moveEnergy",
          movable: prompt.movable.map((offer) => ({
            uid: offer.uid,
            from: refFromWire(offer.from),
          })),
          destinations: prompt.destinations.map(refFromWire),
          max: prompt.max,
          // Dropping `min` would re-allow a decline the card refuses.
          ...(prompt.min === undefined ? {} : { min: prompt.min }),
          // Dropping this rider would re-impose the single-source restriction on the rebuilt
          // prompt.
          ...(prompt.anySource === undefined ? {} : { anySource: prompt.anySource }),
          // Dropping this rider would re-impose the single-destination restriction on the rebuilt
          // prompt.
          ...(prompt.anyDest === undefined ? {} : { anyDest: prompt.anyDest }),
          note: prompt.note,
        },
      };
    case "discardEnergy":
      return {
        kind: "effectChoose",
        prompt: {
          kind: "discardEnergy",
          discardable: prompt.discardable.map((offer) => ({
            uid: offer.uid,
            from: refFromWire(offer.from),
          })),
          scope: scopeFromWire(prompt.scope),
          note: prompt.note,
        },
      };
    case "discardTools":
      // Uid and host ref verbatim, scope through `scopeFromWire`.
      return {
        kind: "effectChoose",
        prompt: {
          kind: "discardTools",
          discardable: prompt.discardable.map((offer) => ({
            uid: offer.uid,
            from: refFromWire(offer.from),
          })),
          scope: scopeFromWire(prompt.scope),
          note: prompt.note,
        },
      };
    case "chooseCards":
      return {
        kind: "effectChoose",
        prompt: {
          kind: "chooseCards",
          // Recover the engine uids from the revealed RedactedCards (id === uid).
          candidates: prompt.candidates.map((c) => c.id),
          min: prompt.min,
          max: prompt.max,
          dest: prompt.dest,
          // Absent stays absent (the engine arm omits it when one flat cap is the
          // whole story) — `maxPerTarget`'s spelling one prompt down.
          ...(prompt.caps !== undefined ? { caps: prompt.caps } : {}),
          // The disjunctive caps (Brock's Scouting); absent stays absent.
          ...(prompt.capsAnyOf !== undefined ? { capsAnyOf: prompt.capsAnyOf } : {}),
          note: prompt.note,
        },
      };
    case "attachCards":
      return {
        kind: "effectChoose",
        prompt: {
          kind: "attachCards",
          candidates: prompt.candidates.map((c) => c.id),
          targets: prompt.targets.map(refFromWire),
          max: prompt.max,
          // Absent stays absent (the engine arm omits it for "no per-target cap");
          // spreading avoids writing an explicit `maxPerTarget: undefined` key.
          ...(prompt.maxPerTarget !== undefined ? { maxPerTarget: prompt.maxPerTarget } : {}),
          // The engine omits this unless the card prints "1 of your Pokémon".
          ...(prompt.oneTarget !== undefined ? { oneTarget: prompt.oneTarget } : {}),
          note: prompt.note,
        },
      };
    // Put the looked-at cards back in any order. Recovers engine uids from the revealed
    // `RedactedCard`s (`id === uid`); the `map` must preserve the deck order the candidates arrive
    // in.
    case "orderCards":
      return {
        kind: "effectChoose",
        prompt: {
          kind: "orderCards",
          candidates: prompt.candidates.map((c) => c.id),
          note: prompt.note,
        },
      };
    // The opponent-side per-attack lock's pick. The wire arm matches the engine arm field for
    // field, so it is a plain rebuild.
    case "chooseAttack":
      return {
        kind: "effectChoose",
        prompt: {
          kind: "chooseAttack",
          candidates: prompt.candidates.map((c) => ({ index: c.index, name: c.name })),
          note: prompt.note,
        },
      };
    // Crescent Purge's pick: indices only, since every offered slot is face down.
    case "choosePrize":
      return {
        kind: "effectChoose",
        prompt: { kind: "choosePrize", indices: [...prompt.indices], note: prompt.note },
      };
  }
}

/** A wire `RedactedPokemonRef` → the engine `PokemonRef` it mirrors. Structurally
    identical (both absolute-seat, same spot union), rebuilt fresh field-for-field
    so an added spot field is a compile error rather than a silent alias. */
function refFromWire(ref: RedactedPokemonRef): PokemonRef {
  return {
    seat: ref.seat,
    spot:
      ref.spot.spot === "active" ? { spot: "active" } : { spot: "bench", index: ref.spot.index },
  };
}

/**
 * A wire `RedactedDiscardScope` to the engine `DiscardScope`, for `discardEnergy` and
 * `discardTools`. Must map `upTo` back to `upTo`; collapsing it to `each` is a hole no compiler
 * catches.
 */
function scopeFromWire(scope: RedactedDiscardScope): DiscardScope {
  switch (scope.kind) {
    case "total":
      return { kind: "total", count: scope.count };
    case "each":
      return { kind: "each" };
    case "upTo":
      return { kind: "upTo", max: scope.max };
  }
  const unhandled: never = scope;
  throw new Error(
    `projection: unhandled discard scope ${(unhandled as RedactedDiscardScope).kind}`,
  );
}
