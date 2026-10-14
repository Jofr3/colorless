import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GameAction, GameState, PokemonRef, Seat } from "@luminous/engine";
import type { RedactedGame } from "@luminous/schema";
import type { BoardState, CardModel, CardSelection } from "../playmat/types";
import { GLASS_PANEL, GLASS_NEUTRAL_BUTTON } from "../../lib/glass";

export const ADRENA_BRAIN_HOLD_MS = 1000;
export const ADRENA_BRAIN_SHAKE_MS = 400;

interface AdrenaBrainDecision {
  candidates: PokemonRef[];
  upTo: number;
  abilitySourceUid?: string;
  from?: PokemonRef;
}

export function adrenaBrainDecision(game: GameState | RedactedGame): AdrenaBrainDecision | null {
  const phase = game.phase;
  if (phase.kind !== "effect:choose" || phase.prompt?.kind !== "choosePokemon") return null;
  if ("cont" in phase) {
    const op = phase.cont.pendingOp;
    if (op.op !== "moveCountersToOpponentChosen") return null;
    return {
      candidates: phase.prompt.candidates,
      upTo: op.upTo,
      abilitySourceUid: phase.cont.ctx.sourceUid,
      ...(op.from === undefined ? {} : { from: { seat: phase.seat, spot: op.from } }),
    };
  }
  const transfer = phase.prompt.counterTransfer;
  return transfer === undefined ? null : { candidates: phase.prompt.candidates, ...transfer };
}

function cardForRef(board: BoardState, seat: Seat, ref: PokemonRef): CardModel | null {
  const side = board[ref.seat === seat ? "you" : "opponent"];
  return ref.spot.spot === "active" ? side.active : (side.bench[ref.spot.index] ?? null);
}

/** Keep the engine's source and destination questions, but answer them on the board.
 * A forced engine source still gets an explicit player click and selection feedback.
 */
export function useAdrenaBrain({
  decision,
  board,
  seat,
  dispatch,
}: {
  decision: AdrenaBrainDecision | null;
  board: BoardState;
  seat: Seat;
  dispatch: (action: GameAction) => void;
}) {
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [take, setTake] = useState(3);
  const [phase, setPhase] = useState<CardSelection["phase"]>("choose");
  const [resolvedSelection, setResolvedSelection] = useState<{
    ids: string[];
    count: number;
    abilityCardId?: string;
  } | null>(null);
  const locked = useRef(false);
  const source =
    sourceId === null
      ? null
      : ([board.you.active, ...board.you.bench].find((card) => card?.id === sourceId) ?? null);
  const sourceSelected =
    source !== null &&
    (decision?.from === undefined || cardForRef(board, seat, decision.from)?.id === sourceId);
  const choosingSource = !sourceSelected;
  const max = Math.min(decision?.upTo ?? 3, Math.floor((source?.battle?.damage ?? 0) / 10));
  const count = resolvedSelection?.count ?? Math.min(take, max);
  const refs =
    decision === null
      ? []
      : choosingSource && decision.from !== undefined
        ? [decision.from]
        : choosingSource
          ? decision.candidates
          : decision.from === undefined
            ? []
            : decision.candidates;
  const candidates = refs.flatMap((ref) => {
    const card = cardForRef(board, seat, ref);
    return card === null ? [] : [card];
  });

  // Begin the shake in the same paint as the accepted counter update. Online,
  // keep the cards selected while waiting for the server's authoritative state.
  useLayoutEffect(() => {
    if (decision !== null) return;
    if (phase === "submitted") {
      setPhase("shake");
      return;
    }
    if (phase === "shake") return;
    setSourceId(null);
    setTargetId(null);
    setResolvedSelection(null);
    locked.current = false;
  }, [decision, phase]);

  // Any new engine/server decision cancels the old timers. In particular, a
  // leave, concede or history change must never dispatch a delayed stale answer.
  useEffect(() => {
    if (
      decision === null ||
      !sourceSelected ||
      sourceId === null ||
      targetId === null ||
      phase !== "hold"
    )
      return;
    const timer = setTimeout(() => {
      const ref = decision.candidates.find(
        (candidate) => cardForRef(board, seat, candidate)?.id === targetId,
      );
      if (ref !== undefined) {
        setResolvedSelection({
          ids: [sourceId, targetId],
          count,
          abilityCardId: decision.abilitySourceUid,
        });
        setPhase("submitted");
        dispatch({ type: "resolveEffect", seat, choice: { kind: "pokemon", ref, take: count } });
      }
    }, ADRENA_BRAIN_HOLD_MS);
    return () => clearTimeout(timer);
  }, [decision, board, seat, dispatch, phase, sourceSelected, sourceId, targetId, count]);

  useEffect(() => {
    if (phase !== "shake") return;
    const timer = setTimeout(() => {
      setSourceId(null);
      setTargetId(null);
      setResolvedSelection(null);
      setPhase("choose");
      locked.current = false;
    }, ADRENA_BRAIN_SHAKE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const selection: CardSelection | undefined =
    decision === null && resolvedSelection === null
      ? undefined
      : {
          candidates: phase === "choose" ? candidates : [],
          selectedIds:
            resolvedSelection?.ids ??
            [sourceSelected ? sourceId : null, targetId].filter((id): id is string => id !== null),
          phase,
          count,
          abilityCardId: decision?.abilitySourceUid ?? resolvedSelection?.abilityCardId,
          onSelect: (id) => {
            if (decision === null || locked.current || phase !== "choose") return;
            const ref = refs.find((candidate) => cardForRef(board, seat, candidate)?.id === id);
            if (ref === undefined) return;
            if (choosingSource) {
              setSourceId(id);
              const card = cardForRef(board, seat, ref);
              setTake(Math.min(decision.upTo, Math.floor((card?.battle?.damage ?? 0) / 10)));
              if (decision.from === undefined) {
                dispatch({ type: "resolveEffect", seat, choice: { kind: "pokemon", ref } });
              }
            } else {
              locked.current = true;
              setTargetId(id);
              setPhase("hold");
            }
          },
        };

  const controls =
    selection === undefined ? null : (
      <section
        aria-label="Adrena-Brain"
        className={`adrena-brain-controls absolute bottom-4 left-1/2 z-[80] flex w-max max-w-[calc(100%-32px)] -translate-x-1/2 flex-col items-center gap-2 rounded-2xl px-5 py-3 ${GLASS_PANEL}`}
      >
        <p className="text-sm font-semibold text-white" aria-live="polite">
          {phase !== "choose"
            ? `Moving ${count} damage counter${count === 1 ? "" : "s"}…`
            : choosingSource
              ? "Adrena-Brain: select one of your Pokémon with damage counters."
              : "Select an opponent’s Pokémon to receive the counters."}
        </p>
        {!choosingSource && phase === "choose" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/70">Move</span>
            {Array.from({ length: max }, (_, index) => index + 1).map((amount) => (
              <button
                key={amount}
                type="button"
                aria-label={`Move ${amount} damage counter${amount === 1 ? "" : "s"}`}
                aria-pressed={count === amount}
                onClick={() => setTake(amount)}
                className={`h-8 w-8 cursor-pointer rounded-full text-sm font-semibold ${GLASS_NEUTRAL_BUTTON} ${count === amount ? "ring-2 ring-violet-300" : ""}`}
              >
                {amount}
              </button>
            ))}
            <span className="text-xs text-white/70">counter{count === 1 ? "" : "s"}</span>
            <button
              type="button"
              className="ml-3 text-xs text-white/60 hover:text-white"
              onClick={() => {
                if (locked.current) return;
                locked.current = true;
                dispatch({ type: "resolveEffect", seat, choice: { kind: "pokemon" } });
              }}
            >
              Move none
            </button>
          </div>
        )}
      </section>
    );
  return { selection, controls };
}
