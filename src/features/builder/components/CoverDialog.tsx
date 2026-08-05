import { useEffect, useId, useRef } from "react";
import { CardImage } from "../../../components/CardImage";
import { CheckIcon, ImageIcon, XIcon } from "../../../components/icons";
import { ScrollArea } from "../../../components/ScrollArea";
import { cardImageUrl } from "../../../lib/api";
import {
  FOCUS_RING_INSET,
  GHOST_ICON_BUTTON,
  GLASS_DIALOG_GHOST_BUTTON,
  GLASS_DIALOG_PANEL,
} from "../../../lib/glass";
import type { Deck } from "../deckMath";

// Which card fronts this deck in the library (P5-6 — the follow-up P5-3 left
// room for). The derived default is a heuristic ("the biggest Pokémon") and will
// sometimes pick the wall over the attacker beside it; here the owner overrules
// it, which is the only answer that is always right.
//
// AUTOMATIC IS AN EXPLICIT OPTION, not the absence of a choice, so going back to
// it is one click rather than a thing you cannot express. It leads the grid, and
// deliberately shows no card art: the default is a RULE, and drawing today's
// answer to it would read as "this card", which is exactly what it isn't.
//
// Picking applies immediately — like every other edit in this editor, it rides
// the debounced save — so the dialog needs no Save button, only a way out.

export interface CoverDialogProps {
  open: boolean;
  /** The deck's HYDRATED entries — the cards there is art to choose from. */
  deck: Deck;
  /** The owner's current pick, or null for the derived default. */
  chosenCoverCardId: string | null;
  /** Pin a card id, or null to go back to automatic. */
  onChoose: (cardId: string | null) => void;
  onClose: () => void;
}

const TILE_BASE =
  "relative block w-full overflow-hidden rounded-lg ring-1 ring-inset transition-all hover:scale-[1.03] active:scale-95 motion-reduce:transition-none";

export function CoverDialog({
  open,
  deck,
  chosenCoverCardId,
  onChoose,
  onClose,
}: CoverDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Native <dialog> driven by `open`, exactly like ImportExportDialog: focus
  // move-in, focus trapping, Escape and focus restoration for free.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // Only cards the catalog can draw: a cover with no scan is a blank rectangle,
  // and the server resolves such a pin back to the default anyway.
  const choices = deck.filter(({ card }) => card.hasImage);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the native <dialog> handles Escape; this onClick only adds backdrop click-to-dismiss for pointer users.
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // A click whose target is the dialog itself landed on the ::backdrop.
        if (e.target === dialogRef.current) onClose();
      }}
      className="m-auto border-0 bg-transparent p-0 text-white [&::backdrop]:bg-black/60 [&::backdrop]:backdrop-blur-sm"
    >
      <div className={`w-[min(34rem,calc(100vw-2rem))] ${GLASS_DIALOG_PANEL}`}>
        <div className="mb-1 flex items-center justify-between">
          <h2 id={titleId} className="text-base font-semibold text-white/90">
            Deck cover
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={`flex h-8 w-8 ${GHOST_ICON_BUTTON}`}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-xs text-white/55">
          The card that fronts this deck in your library.
        </p>

        <ScrollArea className="-mx-1 max-h-[22rem] px-1" fadeBottom={28} maskRadius={12}>
          <ul className="grid grid-cols-4 gap-2 py-1 sm:grid-cols-5">
            <li>
              <button
                type="button"
                onClick={() => onChoose(null)}
                aria-pressed={chosenCoverCardId === null}
                className={`flex aspect-[2.5/3.5] cursor-pointer flex-col items-center justify-center gap-1.5 bg-white/[0.05] px-1 text-center ${TILE_BASE} ${FOCUS_RING_INSET} ${
                  chosenCoverCardId === null
                    ? "ring-2 ring-accent"
                    : "ring-white/10 hover:bg-white/[0.09]"
                }`}
              >
                <ImageIcon className="h-5 w-5 text-white/55" />
                <span className="text-[11px] font-medium leading-tight text-white/70">
                  Automatic
                </span>
                {chosenCoverCardId === null && <SelectedTick />}
              </button>
            </li>

            {choices.map(({ card }) => {
              const chosen = card.cardId === chosenCoverCardId;
              return (
                <li key={card.cardId}>
                  <button
                    type="button"
                    onClick={() => onChoose(card.cardId)}
                    aria-pressed={chosen}
                    aria-label={`Use ${card.name} as the deck cover`}
                    className={`cursor-pointer ${TILE_BASE} ${FOCUS_RING_INSET} ${
                      chosen ? "ring-2 ring-accent" : "ring-white/10 hover:ring-white/30"
                    }`}
                  >
                    <div className="aspect-[2.5/3.5] w-full">
                      <CardImage
                        fill
                        imageUrl={cardImageUrl(card.cardId, "low")}
                        alt={card.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    {chosen && <SelectedTick />}
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>

        {choices.length === 0 && (
          <p className="py-6 text-center text-sm text-white/55">
            Add some cards and one of them can front this deck.
          </p>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className={GLASS_DIALOG_GHOST_BUTTON}
          >
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** The chosen tile's corner tick — aria-hidden, since the button already says
    so through `aria-pressed`. */
function SelectedTick() {
  return (
    <span
      aria-hidden
      className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-zinc-950 shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
    >
      <CheckIcon className="h-3 w-3" />
    </span>
  );
}
