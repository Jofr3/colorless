import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftIcon } from "../../../components/icons";
import {
  GLASS_DIALOG_GHOST_BUTTON,
  GLASS_DIALOG_PANEL,
  GLASS_HUD_BUTTON,
  SOLID_PRIMARY_BUTTON,
} from "../../../lib/glass";

const HOME_PATH = "/";

// Glass control styling shared with the rest of the playmat HUD
// (mirrors TurnHud's CIRCLE_BUTTON_BASE_CLASS and GameLog's toggle).
const BACK_BUTTON_CLASS = `absolute z-20 flex h-9 cursor-pointer items-center gap-1.5 rounded-full pl-2.5 pr-3.5 text-[13px] font-medium tracking-wide ${GLASS_HUD_BUTTON}`;

const DIALOG_GHOST_BUTTON_CLASS = GLASS_DIALOG_GHOST_BUTTON;

const DIALOG_PRIMARY_BUTTON_CLASS = `px-4 py-2 ${SOLID_PRIMARY_BUTTON}`;

/** What the Back button asks before it leaves. Overridable because the same
    control sits on two boards with different stakes: on the local /play page
    leaving costs an unsaved board, while in an ONLINE match it FORFEITS the game
    (P4 3c-iv — the DO concedes for a player who walks out), which the player must
    be told before they confirm. */
export type LeaveConfirmCopy = { title: string; message: string };

const LOCAL_LEAVE_COPY: LeaveConfirmCopy = {
  title: "Leave the simulator?",
  message: "You'll return to the main menu. The current board won't be saved.",
};

export function BackToMenu({ confirm = LOCAL_LEAVE_COPY }: { confirm?: LeaveConfirmCopy }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-haspopup="dialog"
        className={BACK_BUTTON_CLASS}
        style={{ top: 16, right: 16 }}
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back
      </button>
      <ConfirmLeaveDialog
        open={confirming}
        copy={confirm}
        onCancel={() => setConfirming(false)}
        onConfirm={() => navigate(HOME_PATH)}
      />
    </>
  );
}

function ConfirmLeaveDialog({
  open,
  copy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  copy: LeaveConfirmCopy;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  // Drive the native modal from React state so it renders in the top layer —
  // above the Pixi card canvas and every HUD layer — without needing a portal.
  // showModal() also gives us focus trapping, Escape-to-dismiss and focus
  // restoration for free.
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
      aria-describedby={descriptionId}
      onClose={onCancel}
      onClick={(event) => {
        // A click whose target is the dialog element itself landed on the
        // ::backdrop (inner content has its own targets) — treat it as cancel.
        if (event.target === dialogRef.current) onCancel();
      }}
      className="leave-dialog m-auto border-0 bg-transparent p-0 text-white"
    >
      <div className={`w-[min(22rem,calc(100vw-2.5rem))] ${GLASS_DIALOG_PANEL}`}>
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.06] text-white/80 ring-1 ring-inset ring-white/10">
          <ArrowLeftIcon className="h-5 w-5" />
        </div>
        <h2 id={titleId} className="mt-4 text-lg font-semibold text-white">
          {copy.title}
        </h2>
        <p id={descriptionId} className="mt-1.5 text-sm leading-relaxed text-white/55">
          {copy.message}
        </p>
        <div className="mt-6 flex justify-end gap-2.5">
          {/* showModal() moves focus here (first focusable) — the safe default. */}
          <button type="button" onClick={onCancel} className={DIALOG_GHOST_BUTTON_CLASS}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className={DIALOG_PRIMARY_BUTTON_CLASS}>
            Leave
          </button>
        </div>
      </div>
    </dialog>
  );
}
