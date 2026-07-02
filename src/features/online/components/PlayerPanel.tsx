import { CheckCircleIcon, SpinnerIcon, UserIcon } from "../../../components/icons";
import { FOCUS_RING_INSET, GLASS_ACCENT_BUTTON, GLASS_NEUTRAL_BUTTON } from "../../../lib/glass";
import { CardBackStack } from "../../decks/CardBackStack";
import type { PlayerState } from "../net/types";
import { type Side, SIDE_STYLES } from "../theme";

// One seat in the versus layout: an avatar + (editable, for you) name, the deck
// they've chosen, and their ready state. The local player is blue, the opponent
// red — echoing the background glow. It renders three ways: an empty seat
// (opponent hasn't joined), a filled seat still choosing, and a locked-in seat.

const BUTTON_LAYOUT =
  "inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold";

const READY_BUTTON_CLASS = `${BUTTON_LAYOUT} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent/80 disabled:active:scale-100 ${GLASS_ACCENT_BUTTON}`;

const UNREADY_BUTTON_CLASS = `${BUTTON_LAYOUT} ${GLASS_NEUTRAL_BUTTON}`;

/** The small card-back cover for a chosen deck (or a dashed placeholder). */
function DeckCover({ deckName, placeholder }: { deckName: string | null; placeholder?: string }) {
  if (!deckName) {
    return (
      <div className="flex aspect-[5/7] w-16 shrink-0 items-center justify-center rounded-[7px] border border-dashed border-white/15 bg-white/[0.02] p-1 text-center text-[10px] leading-tight text-white/35">
        {placeholder ?? "No deck"}
      </div>
    );
  }
  return (
    <div className="w-16 shrink-0">
      <CardBackStack />
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
  onRename,
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
  /** Self-only: commit a new display name. */
  onRename?: (name: string) => void;
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
    <section
      className={`flex flex-col gap-4 rounded-3xl p-5 backdrop-blur-md transition-shadow ${styles.wash} ring-1 ring-inset ${
        ready ? styles.ring : "ring-white/10"
      }`}
    >
      {/* Identity row. */}
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06] ring-1 ring-inset ring-white/10 ${styles.accent}`}
        >
          <UserIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ConnectionDot side={side} connected={player.connected} />
            <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-white/40">
              {isSelf ? "You" : "Opponent"}
            </span>
          </div>
          {isSelf && onRename ? (
            <input
              key={player.id}
              defaultValue={player.name}
              aria-label="Your name"
              maxLength={24}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              onBlur={(e) => {
                // Uncontrolled input with a stable key: reflect the resolved value
                // back into the DOM so an empty/whitespace entry that falls back to
                // the old name doesn't leave the field visually blank.
                const next = e.currentTarget.value.trim() || player.name;
                e.currentTarget.value = next;
                onRename(next);
              }}
              className="mt-0.5 -mx-1 w-full min-w-0 truncate rounded-md bg-transparent px-1 text-base font-semibold text-white outline-none transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/40"
            />
          ) : (
            <p className="mt-0.5 truncate text-base font-semibold text-white">{player.name}</p>
          )}
        </div>
      </div>

      {/* Deck row — shown only for yourself; the opponent's deck stays hidden,
          so you only see whether they're ready. Before readying, the whole row
          is the picker trigger: a single persistent <button> that survives the
          no-deck→deck change so the native <dialog>'s focus restoration returns
          here after a pick (a swapped-out trigger would drop focus to <body>). */}
      {isSelf &&
        (onPickDeck && !ready ? (
          <button
            type="button"
            onClick={onPickDeck}
            className={`-m-1 flex items-center gap-3 rounded-2xl p-1 text-left transition-colors hover:bg-white/[0.04] ${FOCUS_RING_INSET}`}
          >
            <DeckCover deckName={player.deckName} placeholder="Pick" />
            <div className="min-w-0 flex-1">
              {player.deckName ? (
                <>
                  <p className="truncate text-sm font-semibold text-white/90">{player.deckName}</p>
                  <p className="mt-0.5 text-xs font-medium text-white/50">Change deck</p>
                </>
              ) : (
                <p className="text-sm font-medium text-white/70">Choose a deck</p>
              )}
            </div>
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <DeckCover deckName={player.deckName} placeholder="No deck" />
            <div className="min-w-0 flex-1">
              {player.deckName ? (
                <p className="truncate text-sm font-semibold text-white/90">{player.deckName}</p>
              ) : (
                <p className="text-sm text-white/40">No deck</p>
              )}
            </div>
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
