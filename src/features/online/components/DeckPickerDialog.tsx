import { useEffect, useId, useRef } from "react";
import { FolderIcon } from "../../../components/icons";
import { ScrollArea } from "../../../components/ScrollArea";
import {
  GLASS_DIALOG_GHOST_BUTTON,
  GLASS_DIALOG_PANEL,
  FOCUS_RING_INSET,
} from "../../../lib/glass";
import { CardBackStack } from "../../decks/CardBackStack";
import { SEED_DECKS, SEED_FOLDERS, type Deck } from "../../decks/data";
import type { DeckChoice } from "../net/useLobby";

// A native <dialog> deck picker, matching the simulator's ConfirmLeaveDialog
// pattern (showModal ⇒ top-layer render, focus trap, Escape-to-close for free).
// It lists the player's deck library — the same seed decks the /decks page and
// builder use — as a grid of card-back covers; picking one hands it back and
// closes.

const folderNameById = new Map(SEED_FOLDERS.map((folder) => [folder.id, folder.name]));

function DeckOption({
  deck,
  selected,
  onSelect,
}: {
  deck: Deck;
  selected: boolean;
  onSelect: () => void;
}) {
  const folderName = deck.folderId ? folderNameById.get(deck.folderId) : null;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`group relative flex flex-col rounded-2xl p-1.5 text-left transition-colors ${FOCUS_RING_INSET} ${
        selected ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"
      }`}
    >
      <div className="relative">
        <CardBackStack
          label={
            <span className="block truncate text-xs font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
              {deck.name}
            </span>
          }
        />
        {selected && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[7px] ring-2 ring-inset ring-accent"
          />
        )}
      </div>
      <div className="mt-2 min-w-0 px-1">
        <p className="truncate text-sm font-medium text-white/85">{deck.name}</p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-white/45">
          {folderName && (
            <>
              <FolderIcon className="h-3 w-3 shrink-0" fill="currentColor" />
              <span className="truncate">{folderName}</span>
              <span aria-hidden>·</span>
            </>
          )}
          {deck.cardCount === 0 ? "Empty" : `${deck.cardCount} cards`}
        </p>
      </div>
    </button>
  );
}

export function DeckPickerDialog({
  open,
  selectedDeckId,
  onSelect,
  onCancel,
}: {
  open: boolean;
  selectedDeckId: string | null;
  onSelect: (deck: DeckChoice) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the native <dialog> handles Escape; this onClick only adds backdrop click-to-cancel for pointer users.
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onCancel}
      onClick={(event) => {
        if (event.target === dialogRef.current) onCancel();
      }}
      className="leave-dialog m-auto border-0 bg-transparent p-0 text-white"
    >
      <div
        className={`flex max-h-[80vh] w-[min(40rem,calc(100vw-2.5rem))] flex-col ${GLASS_DIALOG_PANEL}`}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold text-white">
            Choose your deck
          </h2>
          <button type="button" onClick={onCancel} className={GLASS_DIALOG_GHOST_BUTTON}>
            Cancel
          </button>
        </div>
        <ScrollArea className="-mx-2 mt-4 px-2" trackTop={8} trackBottom={8}>
          <div className="grid grid-cols-2 gap-2 pb-1 sm:grid-cols-3 md:grid-cols-4">
            {SEED_DECKS.map((deck) => (
              <DeckOption
                key={deck.id}
                deck={deck}
                selected={deck.id === selectedDeckId}
                onSelect={() => onSelect({ id: deck.id, name: deck.name })}
              />
            ))}
          </div>
        </ScrollArea>
      </div>
    </dialog>
  );
}
