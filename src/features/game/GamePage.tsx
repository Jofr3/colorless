// /play — the local hot-seat game page (P3 wire-up): pregame deck selection
// → createGame → a PlaymatView rendered EXCLUSIVELY from projectGameState
// (D17: the board is derived, never mutated). Drags become engine actions
// through moveToAction; rejected actions leave the board untouched and
// surface as a transient error pill (D14: applyAction never throws).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { DeckSummary } from "@luminous/schema";
import { DECK_SIZE, createGame, isBasicPokemon, otherSeat } from "@luminous/engine";
import {
  ERROR_TEXT,
  GLASS_ACCENT_BUTTON,
  GLASS_GHOST_BUTTON,
  GLASS_INPUT,
  GLASS_PANEL,
} from "../../lib/glass";
import { ApiError, getDeck, listDecks } from "../../lib/api";
import { TransientErrorPill } from "../../components/TransientErrorPill";
import { useAuth } from "../auth/AuthProvider";
import { PlaymatView } from "../playmat";
import type { CardMoveRequest, TurnInfo } from "../playmat/types";
import { fetchCardPool } from "./cardPool";
import { DEMO_DECKS, expandDeck } from "./demoDecks";
import { GameHud } from "./GameHud";
import { moveToAction } from "./moveToAction";
import { gamePlacementPredicate } from "./placement";
import { useLocalGame, type LocalGameSetup } from "./useLocalGame";

export function GamePage() {
  const [setup, setSetup] = useState<LocalGameSetup | null>(null);
  return setup === null ? (
    <Pregame onStart={setSetup} />
  ) : (
    // Keying on startedAt makes "Play again" a genuinely fresh match: the
    // reducer state (game, log, viewer) re-initializes instead of leaking.
    <LocalMatch key={setup.startedAt} setup={setup} onPlayAgain={() => setSetup(null)} />
  );
}

// ---- Pregame: deck selection → createGame ------------------------------------

/** Slot selection encoding: built-in demo deck or a saved deck id. */
type SlotValue = `demo:${number}` | `deck:${string}`;

const SLOT_LABELS = ["Player 1", "Player 2"] as const;

async function resolveSlot(value: SlotValue): Promise<{ name: string; ids: string[] }> {
  if (value.startsWith("demo:")) {
    const deck = DEMO_DECKS[Number(value.slice(5))];
    if (deck === undefined) throw new Error(`unknown demo deck "${value}"`);
    return { name: deck.name, ids: [...deck.ids] };
  }
  const deck = await getDeck(value.slice(5));
  return { name: deck.name, ids: expandDeck(deck.cards) };
}

function Pregame({ onStart }: { onStart: (setup: LocalGameSetup) => void }) {
  const { status } = useAuth();
  const [saved, setSaved] = useState<DeckSummary[]>([]);
  const [slots, setSlots] = useState<[SlotValue, SlotValue]>(["demo:0", "demo:1"]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Saved decks appear as extra options when signed in; the demo decks keep
  // the page fully usable anonymously. A load failure just leaves the demo
  // list — no error surface needed at this point.
  useEffect(() => {
    if (status !== "authenticated") {
      setSaved([]);
      // A saved-deck selection is stale the moment the session dies — its
      // <option> just vanished with `saved`, and getDeck would only 401 at
      // Start — so those slots fall back to the demo defaults. Demo
      // selections survive untouched.
      setSlots(([first, second]) => [
        first.startsWith("deck:") ? "demo:0" : first,
        second.startsWith("deck:") ? "demo:1" : second,
      ]);
      return;
    }
    let alive = true;
    listDecks()
      .then((decks) => {
        if (alive) setSaved(decks);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [status]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const [p1, p2] = await Promise.all([resolveSlot(slots[0]), resolveSlot(slots[1])]);
      const { pool, missing } = await fetchCardPool([...p1.ids, ...p2.ids]);
      if (missing.length > 0) {
        setError(`These cards aren't in the catalog: ${missing.join(", ")}`);
        return;
      }
      // Friendly per-slot versions of createGame's own validation (saved
      // decks are NOT guaranteed legal — the builder saves work in progress).
      const sides: Array<{ label: string; deck: { name: string; ids: string[] } }> = [
        { label: SLOT_LABELS[0], deck: p1 },
        { label: SLOT_LABELS[1], deck: p2 },
      ];
      for (const { label, deck } of sides) {
        if (deck.ids.length !== DECK_SIZE) {
          setError(
            `${label} — "${deck.name}" has ${deck.ids.length} cards; a deck needs exactly ${DECK_SIZE}.`,
          );
          return;
        }
        const hasBasic = deck.ids.some((id) => {
          const card = pool[id];
          return card !== undefined && isBasicPokemon(card);
        });
        if (!hasBasic) {
          setError(`${label} — "${deck.name}" has no Basic Pokémon, so it can't start a game.`);
          return;
        }
      }
      const created = createGame({
        seed: Date.now(),
        decks: { p1: p1.ids, p2: p2.ids },
        cardPool: pool,
      });
      if (!created.ok) {
        // The per-slot checks above cover the known codes; this is the net.
        setError(`Couldn't start the game: ${created.error.message}`);
        return;
      }
      onStart({
        state: created.state,
        events: created.events,
        names: { p1: p1.name, p2: p2.name },
        startedAt: Date.now(),
      });
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? "Couldn't load the decks from the server — try again."
          : "Couldn't prepare the game — try again.",
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col items-center justify-center px-6 py-12 text-white">
      <h1 className="text-2xl font-bold">Local match</h1>
      <p className="mt-1.5 text-sm text-white/55">
        Two players, one screen — the board flips to whoever has to act.
      </p>
      <div className={`mt-8 w-full rounded-3xl p-6 ${GLASS_PANEL}`}>
        <div className="flex flex-col gap-5">
          {SLOT_LABELS.map((label, index) => (
            <label key={label} className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-white/55">
                {label}
              </span>
              <select
                value={slots[index]}
                onChange={(event) => {
                  const value = event.target.value as SlotValue;
                  setSlots((prev) => (index === 0 ? [value, prev[1]] : [prev[0], value]));
                }}
                className={`${GLASS_INPUT} cursor-pointer px-4 py-2.5 [&>optgroup]:bg-[#16161f] [&>option]:bg-[#16161f]`}
              >
                <optgroup label="Demo decks">
                  {DEMO_DECKS.map((deck, demoIndex) => (
                    <option key={deck.name} value={`demo:${demoIndex}`}>
                      {deck.name}
                    </option>
                  ))}
                </optgroup>
                {saved.length > 0 && (
                  <optgroup label="Your decks">
                    {saved.map((deck) => (
                      <option key={deck.id} value={`deck:${deck.id}`}>
                        {deck.name} ({deck.cardCount})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
          ))}
        </div>
        {error !== null && (
          <p role="alert" className={`mt-4 text-sm font-medium ${ERROR_TEXT}`}>
            {error}
          </p>
        )}
        <div className="mt-6 flex items-center justify-between">
          <Link
            to="/"
            className={`rounded-full px-4 py-2 text-sm font-medium ${GLASS_GHOST_BUTTON}`}
          >
            Back
          </Link>
          <button
            type="button"
            disabled={starting}
            onClick={() => void start()}
            className={`cursor-pointer rounded-full px-5 py-2 text-sm font-semibold disabled:cursor-default disabled:opacity-50 ${GLASS_ACCENT_BUTTON}`}
          >
            {starting ? "Preparing…" : "Start game"}
          </button>
        </div>
      </div>
    </main>
  );
}

// ---- The match ----------------------------------------------------------------

/** How long transient overlays linger (error pill, hot-seat flip banner). */
const ERROR_TTL_MS = 4000;
const FLIP_BANNER_TTL_MS = 1800;

/** Exported for the dom regression suite (LocalMatch.dom.test.tsx), which
    injects an engine-driven setup instead of walking the pregame flow. */
export function LocalMatch({
  setup,
  onPlayAgain,
}: {
  setup: LocalGameSetup;
  onPlayAgain: () => void;
}) {
  const { game, projection, viewerSeat, names, dispatch, logEntries, lastError } =
    useLocalGame(setup);

  // Drag → action. The engine stays the authority: a null translation
  // springs back silently, a rejected action shows the pill (nothing else
  // changes — the board is a pure projection of the accepted state).
  const phase = game.phase;
  const board = projection.board;
  const handleMoveCard = useCallback(
    (request: CardMoveRequest) => {
      const action = moveToAction(request, {
        phaseKind: phase.kind,
        isViewerTurn: phase.kind === "turn:action" && phase.seat === viewerSeat,
        viewerSeat,
        board,
      });
      if (action !== null) dispatch(action);
    },
    [phase, viewerSeat, board, dispatch],
  );

  // Drop affordances follow the same phase the translator routes by, so the
  // layer never previews a gesture-class moveToAction would null. The factory
  // reads only phase + seat (occupancy comes from the board at call time);
  // the layer snapshots the prop via ref, so this memo is tidiness, not
  // correctness.
  const placementPredicate = useMemo(
    () => gamePlacementPredicate(game, viewerSeat),
    [game, viewerSeat],
  );

  const passDisabled = !(projection.waitingOn === "you" && phase.kind === "turn:action");

  const turnInfo: TurnInfo = {
    turn: projection.turn,
    // During setup and the between-turns checkup-KO parks nobody owns a
    // turn — light up whoever must act instead (the prize picker/promoter).
    activePlayer: projection.activePlayer ?? projection.waitingOn ?? "you",
    youName: names[viewerSeat],
    opponentName: names[otherSeat(viewerSeat)],
  };

  // Hot-seat flip banner: announce whose decision the board now shows. Only
  // a nonce is state — the name renders from the live viewerSeat, so it can
  // never lag a flip by a frame. The ref guard keeps the initial mount (and
  // StrictMode's double-run of it) silent; a re-flip restarts the clock via
  // the effect cleanup.
  const [flipNonce, setFlipNonce] = useState<number | null>(null);
  const previousSeatRef = useRef(viewerSeat);
  useEffect(() => {
    if (previousSeatRef.current === viewerSeat) return;
    previousSeatRef.current = viewerSeat;
    setFlipNonce((prev) => (prev ?? 0) + 1);
    const timer = setTimeout(() => setFlipNonce(null), FLIP_BANNER_TTL_MS);
    return () => clearTimeout(timer);
  }, [viewerSeat]);

  // Transient pill for engine-rejected actions, DERIVED from the reducer's
  // lastError instead of mirrored into state: it hides once its nonce is
  // dismissed (button or TTL) and vanishes the moment an accepted action
  // clears lastError — which is also what flips the hot-seat viewer, so a
  // rejection can never ride across the handoff. The nonce keying remounts
  // the pill so an identical consecutive rejection re-announces (the /decks
  // precedent).
  const [dismissedNonce, setDismissedNonce] = useState<number | null>(null);
  const shownError = lastError !== null && lastError.nonce !== dismissedNonce ? lastError : null;
  useEffect(() => {
    if (lastError === null) return;
    const timer = setTimeout(() => setDismissedNonce(lastError.nonce), ERROR_TTL_MS);
    return () => clearTimeout(timer);
  }, [lastError]);

  return (
    <PlaymatView
      board={board}
      turn={turnInfo}
      perspective="you"
      // The projection re-bases so the viewer is always "you"; the glow still
      // flips per seat, exactly like the mock's per-turn flip.
      glowPerspective={viewerSeat === "p1" ? "you" : "opponent"}
      onMoveCard={handleMoveCard}
      placementPredicate={placementPredicate}
      passDisabled={passDisabled}
      passAnimationKey={projection.turn}
      logEntries={logEntries}
      piles={projection.piles}
    >
      <GameHud
        game={game}
        projection={projection}
        viewerSeat={viewerSeat}
        names={names}
        dispatch={dispatch}
        onPlayAgain={onPlayAgain}
      />
      {flipNonce !== null && (
        <div
          key={flipNonce}
          className="pointer-events-none absolute left-1/2 top-1/3 z-[82] -translate-x-1/2 rounded-full bg-[#16161f]/90 px-6 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.5)] ring-1 ring-inset ring-white/15 backdrop-blur-xl"
        >
          <output className="text-base font-semibold text-white">
            {names[viewerSeat]} — you're up
          </output>
        </div>
      )}
      {shownError !== null && (
        <TransientErrorPill
          message={shownError.message}
          nonce={shownError.nonce}
          onDismiss={() => setDismissedNonce(shownError.nonce)}
          className="absolute bottom-[calc(var(--hand-h)+12px)] left-1/2 z-[90] -translate-x-1/2"
        />
      )}
    </PlaymatView>
  );
}
