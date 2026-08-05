import { type ReactNode, useEffect, useId, useRef } from "react";
import {
  FOCUS_RING,
  GLASS_DIALOG_GHOST_BUTTON,
  GLASS_DIALOG_PANEL,
  SOLID_PRIMARY_BUTTON,
} from "../../../lib/glass";
import "../online.css";

// A reusable confirmation modal, following the simulator's ConfirmLeaveDialog
// pattern: a native <dialog> driven by `open` so showModal() renders it in the
// top layer with focus trapping, Escape-to-dismiss and focus restoration for
// free. `danger` styles the confirm button (and icon) as a destructive action.

const CONFIRM_PRIMARY_CLASS = `px-4 py-2 ${SOLID_PRIMARY_BUTTON}`;

const CONFIRM_DANGER_CLASS = `cursor-pointer rounded-full bg-[#dc3b56] px-4 py-2 text-sm font-semibold text-white ring-1 ring-inset ring-white/20 transition-all motion-reduce:transition-none hover:bg-[#e6465f] active:scale-95 ${FOCUS_RING}`;

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  icon,
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /** Optional glyph shown in the header circle. */
  icon?: ReactNode;
  /** Style the confirm button + icon as a destructive action. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

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
      aria-describedby={descriptionId}
      onClose={onCancel}
      onClick={(event) => {
        // A click on the dialog element itself landed on the ::backdrop — cancel.
        if (event.target === dialogRef.current) onCancel();
      }}
      className="online-dialog m-auto border-0 bg-transparent p-0 text-white"
    >
      <div className={`w-[min(22rem,calc(100vw-2.5rem))] ${GLASS_DIALOG_PANEL}`}>
        {icon && (
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-full ring-1 ring-inset ${
              danger
                ? "bg-[#ff3456]/12 text-[#ff9aad] ring-[#ff4d6a]/30"
                : "bg-white/[0.06] text-white/80 ring-white/10"
            }`}
          >
            {icon}
          </div>
        )}
        <h2 id={titleId} className={`text-lg font-semibold text-white${icon ? " mt-4" : ""}`}>
          {title}
        </h2>
        <p id={descriptionId} className="mt-1.5 text-sm leading-relaxed text-white/55">
          {message}
        </p>
        <div className="mt-6 flex justify-end gap-2.5">
          {/* showModal() moves focus here (first focusable) — the safe default. */}
          <button type="button" onClick={onCancel} className={GLASS_DIALOG_GHOST_BUTTON}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={danger ? CONFIRM_DANGER_CLASS : CONFIRM_PRIMARY_CLASS}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
