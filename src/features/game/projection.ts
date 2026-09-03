// Engine → playmat projection (P3, alongside M1). The engine's GameState is
// deliberately not the playmat's BoardState — zones hold card uids resolved
// through cardIdByUid → cardPool — so this pure adapter builds the CardModel
// view the playmat renders. It is PER-VIEWER: the same hidden-information
// rule P4's server-side filter will apply. What each viewer sees:
//
//   - their own hand face-up; the opponent's hand as anonymous face-down
//     backs (count only — no card identity anywhere, not even in ids);
//   - BOTH prize sets as counts only (prizes are face-down in the real game);
//   - decks as counts; discard piles fully public (§2 — ordered and public);
//   - in-play Pokémon (active/bench) public once setup is over, with their
//     attached cards and their battle state (`CardModel.battle` — damage/max
//     HP and the §12 special conditions all sit face-up on the table).
//     DURING the setup:* phases (§3 — placements stay face-down until both
//     players ready; the engine emits SETUP_REVEALED only then) the
//     OPPONENT's active/bench project as anonymous positional backs with no
//     `battle` (a battle row would leak the printed HP); the viewer's OWN
//     placements stay face-up.
//
// Public cards keep the engine uid as CardModel.id — the Pixi layer keys its
// views off that id, so a card animates as ONE object as it moves between
// zones across successive projections (hand → bench, hand → attached, …).
//
// Built on the M1 zone surface plus M2's phases. Everything phase-derived
// (activePlayer / waitingOn / pendingDecision / outcome) comes out of ONE
// exhaustive switch over the Phase union, so a future engine phase is a
// compile error here rather than a silently wrong guess — M1's defensive
// turn-parity fallback named the wrong seat exactly when ko:promote parked.

import type {
  GameOutcome,
  GameOverReason,
  GameState,
  InPlayPokemon,
  PendingDecision,
  PokemonRef,
  Seat,
  SpecialConditions,
} from "@luminous/engine";
import { cardOfUid, effectiveMaxHp, inSetup, otherSeat, phaseViewOf, topUid } from "@luminous/engine";
import type {
  CardCategory,
  RedactedGame,
  RedactedInPlay,
  RedactedPokemonRef,
  RedactedSide,
} from "@luminous/schema";
import { cardImageUrl } from "../../lib/api";
import type {
  BattleConditions,
  BattleState,
  BoardState,
  CardModel,
  CardType,
  PlayerBoard,
  PlayerId,
} from "../playmat/types";

// The hidden/empty sentinels live in @luminous/schema (the wire redactor and
// this projection share them); re-exported here for the existing importers.
export { EMPTY_CARD_ID, EMPTY_CARD_NAME, HIDDEN_CARD_ID, HIDDEN_CARD_NAME } from "@luminous/schema";
import { EMPTY_CARD_ID, EMPTY_CARD_NAME, HIDDEN_CARD_ID, HIDDEN_CARD_NAME } from "@luminous/schema";

/** The zones BoardState cannot carry: deck size and the public discard. */
export interface ProjectedPiles {
  /** Cards left in the deck — contents hidden, only the count is visible. */
  deckCount: number;
  /** The discard pile, fully public, oldest → newest (engine order). */
  discard: CardModel[];
}

// PendingDecision (the parked KO/effect interrupt) now lives in @luminous/engine
// (phaseView.ts) — shared with the P4 wire redactor — and is imported above.

/** The engine's GameOutcome with seats mapped into the viewer's vocabulary. */
export type ProjectedOutcome =
  | { result: "win"; winner: PlayerId; reason: GameOverReason }
  | { result: "tie"; reasons: Record<PlayerId, GameOverReason> };

/** Why the game ended, as the one-line explanation both game-over surfaces show
    under the result — the local `GameHud` overlay and the online `OnlineMatch`
    one. Shared rather than restated per surface (the D60/D62/D63 rule is about
    MARKUP, which the two genuinely differ in; this is a shape-neutral string map,
    the `EnergyDots` case) so the two screens can't disagree about what just
    happened. A total `Record`, replacing ternary chains whose final `else` would
    have rendered a NEW reason as "the deck ran out" — an unhandled reason is now
    a compile error. The engine's `GAME_OVER_REASONS` (log.ts) is the same
    information in the log's clause-shaped voice; kept separate because these are
    full sentences and because the playmat imports no engine strings.

    Phrased with NO possessive — "no Pokémon left", not "THE OPPONENT has no
    Pokémon left" — because the same line is shown to BOTH players. The earlier
    winner-centric wording read as a lie to the loser (a browser run caught the
    conceding player being told "The opponent forfeited."), and it was already
    ambiguous on the local hot-seat overlay, which belongs to neither player. Each
    overlay's TITLE already names who won, so the detail only has to say what
    happened. */
export const GAME_OVER_DETAIL: Record<GameOverReason, string> = {
  prizesTaken: "All prize cards taken.",
  noPokemon: "No Pokémon left in play.",
  deckOut: "No cards left to draw.",
  conceded: "The match was forfeited.",
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
  return {
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
      ? side.hand.map((uid) => cardModelOf(state, uid))
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
    // Count only — prizes are face-down for BOTH players (§3.8), so no uid or
    // catalog id of a prize card may appear anywhere in the projection.
    prizesRemaining: side.prizes.length,
  };
}

function pilesOf(state: GameState, seat: Seat): ProjectedPiles {
  const side = state.players[seat];
  return {
    deckCount: side.deck.length,
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
  const { rotation, poisonDamage, burned } = pokemon.conditions;
  // Mutual-assignability pin, both directions: `satisfies` = the rebuilt
  // copy is still a COMPLETE SpecialConditions (an added engine field errors
  // here); the annotation = it is an exact BattleConditions (playmat-side
  // drift errors here).
  const conditions: BattleConditions = {
    rotation,
    poisonDamage,
    burned,
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
// @luminous/engine (phaseView.ts), shared with the P4 wire redactor; phaseViewOf
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

// --- The wire adapter: RedactedGame → GameProjection (P4 online) -------------
//
// A REDACTED game already crossed the wire from the authoritative server, which
// applied every hidden-information rule via `redactGame` (packages/engine). So
// this is a pure, mechanical map into the SAME GameProjection shape the local
// projectGameState produces — the only work left is the client-side rendering
// concerns the engine deliberately left off the wire: the asset URL (built from
// `cardId` here, keeping the scheme client-side) and the playmat's CardType
// vocabulary (derived from category + trainerType). No redaction decisions live
// here; the board arrives already redacted, and it is viewer-relative
// ("you"/"opponent"), so it renders with perspective "you" like the local one.

/** Adapt a server-redacted match snapshot into the playmat's GameProjection.
    Pure; the read-only online board (features/online) feeds the result to
    PlaymatView exactly as LocalMatch feeds projectGameState's. */
export function projectionFromRedacted(game: RedactedGame): GameProjection {
  return {
    board: {
      stadium: game.board.stadium === null ? null : cardModelFromRedacted(game.board.stadium),
      you: playerBoardFromRedacted(game.board.you),
      opponent: playerBoardFromRedacted(game.board.opponent),
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
  };
}

function playerBoardFromRedacted(side: RedactedSide): PlayerBoard {
  return {
    hand: side.hand.map(cardModelFromRedacted),
    active: side.active === null ? null : cardModelFromRedacted(side.active),
    bench: side.bench.map(cardModelFromRedacted),
    prizesRemaining: side.prizesRemaining,
  };
}

function pilesFromRedacted(side: RedactedSide): ProjectedPiles {
  return {
    deckCount: side.deckCount,
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

/** The parked KO/effect interrupt, derived from the redacted phase. The ko
    parks carry only counts and map through faithfully. The mid-effect prompt
    now crosses the wire redacted and answerer-only (2b-iii): reconstructed here
    into the SAME `PendingDecision.effectChoose` the local `phaseViewOf`
    produces, so a wire round-trip reproduces it exactly — but only for a prompt
    kind whose online dialog has landed (mayDraw + the public-ref family); a
    withheld or not-yet-redacted prompt (the non-answerer, or chooseCards/
    attachCards) is null on the wire and maps to null here, exactly as
    `phaseViewOf` withholds it. Every non-parked phase is null. */
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

/** Rebuild the engine `PendingDecision.effectChoose` from a redacted wire
    prompt (2b-iii). Exhaustive on the redacted union (every arm now), so a new
    wire arm is a "not all paths return" compile error here rather than a silently
    dropped decision. The public-ref arms carry the engine's own `PokemonRef`s
    (absolute seats) + uids verbatim; the hidden-candidate arms (chooseCards /
    attachCards) carry a `RedactedCard` per candidate whose `id` IS the engine uid
    the engine prompt held — so `candidates.map((c) => c.id)` recovers the exact
    `string[]` and this rebuilds the full `EffectPrompt` field-for-field, keeping
    the answerer's-view round-trip equal to the local projection. */
function effectDecisionFromPrompt(
  prompt: NonNullable<Extract<RedactedGame["phase"], { kind: "effect:choose" }>["prompt"]>,
): PendingDecision {
  switch (prompt.kind) {
    case "mayDraw":
      return {
        kind: "effectChoose",
        prompt: { kind: "mayDraw", count: prompt.count, note: prompt.note },
      };
    case "confirm":
      // The printed "you may" — the whole prompt is its sentence, so the
      // round-trip is the identity and the engine prompt rebuilds field for
      // field, like every arm here.
      return { kind: "effectChoose", prompt: { kind: "confirm", note: prompt.note } };
    case "choosePokemon":
      return {
        kind: "effectChoose",
        prompt: {
          kind: "choosePokemon",
          candidates: prompt.candidates.map(refFromWire),
          // 🆕 D358/D359 — carried, and by a CONDITIONAL SPREAD like every optional
          // field in this file. Dropping it here would rebuild a park with a
          // printed ceiling as a MANDATORY one, and the dialog on the far side of
          // this projection would silently stop offering both the decline and
          // every middle quantity — the round-trip is the identity or it is a
          // lie, which is what every other arm here is asserting by rebuilding
          // field for field. **THIS IS THE SITE D358's OWN PRICE DID NOT NAME**:
          // it counted the engine and the wire and forgot the way back.
          ...(prompt.upTo === undefined ? {} : { upTo: prompt.upTo }),
          note: prompt.note,
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
          // 🆕 D441 — the floor rides the rebuild for the rider's reason, verbatim:
          // this promise is EXACT reproduction, so a `min` dropped here silently
          // re-grants a decline the print refuses. Spread, so a prompt without a
          // floor rebuilds to the byte-identical object it always did.
          ...(prompt.min === undefined ? {} : { min: prompt.min }),
          // D226 — the THIRD moveEnergy read site, and the one the work order did
          // not name: this rebuild promises to reproduce `phaseViewOf`'s decision
          // EXACTLY, so a rider dropped here silently re-imposes the single-source
          // coupling on the round-tripped prompt. Spread, so a prompt without the
          // rider rebuilds to the byte-identical object it always did.
          ...(prompt.anySource === undefined ? {} : { anySource: prompt.anySource }),
          // 🆕 D442 — the FOURTH moveEnergy read site takes the destination-side
          // rider on the same promise: this rebuild reproduces `phaseViewOf`'s
          // decision EXACTLY, so a rider dropped here silently re-imposes the
          // single-destination coupling on the round-tripped prompt. Spread, so a
          // prompt without it rebuilds to the byte-identical object it always did.
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
          scope:
            prompt.scope.kind === "total"
              ? { kind: "total", count: prompt.scope.count }
              : { kind: "each" },
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
          // 🆕 D457 — `maxPerTarget`'s dual, spread for the identical reason: the
          // engine omits it unless the card prints "1 of your Pokémon".
          ...(prompt.oneTarget !== undefined ? { oneTarget: prompt.oneTarget } : {}),
          note: prompt.note,
        },
      };
    // 🆕 D341 — put the looked-at cards back IN ANY ORDER. A HIDDEN-CANDIDATE arm
    // like the two above it, so it recovers the engine uids from the revealed
    // `RedactedCard`s (`id === uid`) rather than rebuilding a public shape.
    //
    // 🛑 THE `map` IS ORDER-PRESERVING AND THAT IS THE ONLY THING THIS ARM HAS TO
    // GET RIGHT. `candidates` arrives in the deck order the prompt was built in
    // (index 0 = the top) and that order is the state the player is reordering
    // FROM — a projection that sorted, grouped or de-duplicated would silently
    // change the question. It is also why there is no `min`/`max` to carry: the
    // answer is a permutation of the whole array, so the array IS the bounds.
    case "orderCards":
      return {
        kind: "effectChoose",
        prompt: {
          kind: "orderCards",
          candidates: prompt.candidates.map((c) => c.id),
          note: prompt.note,
        },
      };
    // D157 — the opponent-side per-attack lock's pick. The wire arm is the engine
    // arm field-for-field (an index and a server-resolved label, both public), so
    // the round trip is a rebuild rather than a recovery: nothing here has to
    // recover a uid from a `RedactedCard` the way the two hidden-candidate arms do.
    case "chooseAttack":
      return {
        kind: "effectChoose",
        prompt: {
          kind: "chooseAttack",
          candidates: prompt.candidates.map((c) => ({ index: c.index, name: c.name })),
          note: prompt.note,
        },
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
