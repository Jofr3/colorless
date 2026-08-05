import type { PlayerState } from "@luminous/schema";
import { CheckCircleIcon, SpinnerIcon, XIcon } from "../../../components/icons";
import { PlayerAvatar } from "../../../components/PlayerAvatar";
import { FOCUS_RING_INSET, GLASS_ACCENT_BUTTON, GLASS_NEUTRAL_BUTTON } from "../../../lib/glass";
import { CardBackStack } from "../../decks/CardBackStack";
import { type Side, SIDE_STYLES } from "../theme";

// One seat in the versus layout: an avatar + name, the deck
// they've chosen, and their ready state. The local player is blue, the opponent
// red — echoing the background glow. It renders three ways: an empty seat
// (opponent hasn't joined), a filled seat still choosing, and a locked-in seat.

const BUTTON_LAYOUT =
  "inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold";

const READY_BUTTON_CLASS = `${BUTTON_LAYOUT} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent/80 disabled:active:scale-100 ${GLASS_ACCENT_BUTTON}`;

const UNREADY_BUTTON_CLASS = `${BUTTON_LAYOUT} ${GLASS_NEUTRAL_BUTTON}`;

/** The self panel's deck cover: a chosen deck's card back with its name printed
    inside the card (as on the decks page and the deck picker), or a large dashed
    outline that both prompts and labels the pick. Centered by its container. */
function DeckCover({ deckName, placeholder }: { deckName: string | null; placeholder: string }) {
  if (!deckName) {
    return (
      <div className="flex aspect-[5/7] w-36 items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/[0.02] p-3 text-center text-sm font-medium text-white/70 transition-colors motion-reduce:transition-none hover:border-white/40 hover:text-white/90">
        {placeholder}
      </div>
    );
  }
  return (
    // pb reserves the space the pile's peeking bottom edges overhang below the
    // card box, so whatever sits below (the hint, the ready button) clears it.
    <div className="w-36 pb-5">
      <CardBackStack
        label={
          // text-left: the trigger is a <button>, which defaults to centered text
          // — the decks page renders this name in a <div>, so left-aligned.
          <span className="block truncate text-left text-xs font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
            {deckName}
          </span>
        }
      />
    </div>
  );
}

function ConnectionDot({ side, connected }: { side: Side; connected: boolean }) {
  return (
    <span
      aria-hidden
      className={`h-2 w-2 shrink-0 rounded-full ${connected ? SIDE_STYLES[side].dot : "bg-white/25"}`}
    />
  );
}

export function PlayerPanel({
  side,
  player,
  isSelf,
  emptyLabel = "Waiting for opponent…",
  onPickDeck,
  onToggleReady,
  onKick,
}: {
  side: Side;
  /** The seat's occupant, or null for an empty (unjoined) seat. */
  player: PlayerState | null;
  isSelf: boolean;
  /** Text shown in an empty opponent seat. */
  emptyLabel?: string;
  /** Self-only: open the deck picker. */
  onPickDeck?: () => void;
  /** Self-only: toggle your ready state. */
  onToggleReady?: () => void;
  /** Host viewing the opponent: remove them from the lobby. */
  onKick?: () => void;
}) {
  const styles = SIDE_STYLES[side];
  const ready = player?.ready ?? false;

  // An empty opponent seat: just the "waiting" affordance.
  if (!player) {
    return (
      <section
        aria-label={emptyLabel}
        className={`flex flex-col items-center justify-center gap-3 rounded-3xl p-6 text-center ${styles.wash} ring-1 ring-inset ring-white/10 backdrop-blur-md`}
      >
        <SpinnerIcon className="h-7 w-7 animate-spin text-white/30" />
        <p className="text-sm font-medium text-white/45">{emptyLabel}</p>
      </section>
    );
  }

  return (
    // The border stays constant whether or not the player is ready — the ready
    // state reads from the "Ready" / "Cancel ready" row below, not the panel edge.
    <section
      className={`flex flex-col gap-4 rounded-3xl p-5 backdrop-blur-md ${styles.wash} ring-1 ring-inset ring-white/10`}
    >
      {/* Identity row. */}
      <div className="flex items-center gap-3">
        <PlayerAvatar name={player.name} seed={player.avatarSeed} className="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ConnectionDot side={side} connected={player.connected} />
            <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-white/40">
              {isSelf ? "You" : "Opponent"}
            </span>
          </div>
          <p className="mt-0.5 truncate text-base font-semibold text-white">{player.name}</p>
        </div>
        {onKick && (
          <button
            type="button"
            onClick={onKick}
            aria-haspopup="dialog"
            aria-label={`Remove ${player.name} from the lobby`}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-white/45 ring-1 ring-inset ring-white/10 transition-colors motion-reduce:transition-none hover:bg-[#ff3456]/10 hover:text-[#ff9aad] hover:ring-[#ff4d6a]/40 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50"
          >
            <XIcon className="h-3.5 w-3.5" />
            Kick
          </button>
        )}
      </div>

      {/* Deck — shown only for yourself; the opponent's stays hidden, so you only
          see whether they're ready. A big centered cover: before readying the
          whole thing is the picker trigger, a single persistent <button> that
          survives the no-deck→deck change so the native <dialog>'s focus
          restoration returns here after a pick (a swapped-out trigger would drop
          focus to <body>). */}
      {isSelf &&
        (onPickDeck && !ready ? (
          <button
            type="button"
            onClick={onPickDeck}
            className={`flex cursor-pointer flex-col items-center gap-2 self-center rounded-2xl p-2 ${FOCUS_RING_INSET}`}
          >
            <DeckCover deckName={player.deckName} placeholder="Choose a deck" />
            {player.deckName && (
              <p className="text-xs font-medium text-white/50">Click to change deck</p>
            )}
          </button>
        ) : (
          <div className="self-center">
            <DeckCover deckName={player.deckName} placeholder="No deck" />
          </div>
        ))}

      {/* Ready row. */}
      {isSelf ? (
        <button
          type="button"
          onClick={onToggleReady}
          disabled={!player.deckId}
          aria-pressed={ready}
          className={ready ? UNREADY_BUTTON_CLASS : READY_BUTTON_CLASS}
        >
          {ready ? (
            "Cancel ready"
          ) : (
            <>
              <CheckCircleIcon className="h-4 w-4" />
              Ready up
            </>
          )}
        </button>
      ) : (
        <div
          className={`flex items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold ${
            ready ? `${styles.accent} bg-white/[0.04]` : "text-white/40"
          }`}
        >
          {ready ? (
            <>
              <CheckCircleIcon className="h-4 w-4" />
              Ready
            </>
          ) : (
            <>
              <SpinnerIcon className="h-4 w-4 animate-spin" />
              Not ready
            </>
          )}
        </div>
      )}
    </section>
  );
}
