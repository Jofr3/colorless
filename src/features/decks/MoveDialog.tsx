import { useEffect, useId, useRef } from "react";
import { FOCUS_RING_INSET, GLASS_DIALOG_GHOST_BUTTON, GLASS_DIALOG_PANEL } from "../../lib/glass";
import type { MoveDestination } from "./tree";

// Keyboard-accessible "Move to…" picker. Dragging a tile into a folder is the
// only other way to move it, so this is the keyboard path. Uses a native
// <dialog> + showModal() (like BackToMenu) for free focus trapping, Escape, and
// focus restoration; it renders in the top layer above the grid.

const DESTINATION_BUTTON_CLASS = `w-full cursor-pointer rounded-lg bg-white/[0.04] px-3 py-2 text-left text-sm text-white/80 ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/[0.08] hover:text-white ${FOCUS_RING_INSET}`;

const CANCEL_BUTTON_CLASS = GLASS_DIALOG_GHOST_BUTTON;

export function MoveDialog({
  open,
  itemName,
  destinations,
  onSelect,
  onClose,
}: {
  open: boolean;
  itemName: string;
  destinations: MoveDestination[];
  onSelect: (folderId: string | null) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the native <dialog> handles Escape-to-dismiss; this onClick only adds backdrop click-to-cancel for pointer users.
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className="leave-dialog m-auto border-0 bg-transparent p-0 text-white"
    >
      <div className={`w-[min(24rem,calc(100vw-2.5rem))] ${GLASS_DIALOG_PANEL}`}>
        <h2 id={titleId} className="text-lg font-semibold text-white">
          Move “{itemName}” to…
        </h2>
        {destinations.length > 0 ? (
          <ul className="mt-4 flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {destinations.map((destination) => (
              <li key={destination.id ?? "@root"}>
                <button
                  type="button"
                  onClick={() => onSelect(destination.id)}
                  className={DESTINATION_BUTTON_CLASS}
                >
                  {destination.label}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-white/55">
            There's nowhere to move this right now.
          </p>
        )}
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} className={CANCEL_BUTTON_CLASS}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
