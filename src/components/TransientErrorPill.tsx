// The floating "that didn't work" pill shared by the decks library (failed
// optimistic mutations) and the game page (engine-rejected actions): a glass
// capsule with the message and a dismiss button. Presentation only — each
// caller owns its trigger state and its expiry timer (the TTLs differ) and
// passes positioning through `className`.

import { ERROR_TEXT, GHOST_ICON_BUTTON } from "../lib/glass";
import { XIcon } from "./icons";

export function TransientErrorPill({
  message,
  nonce,
  onDismiss,
  className,
}: {
  message: string;
  /** Keys the role="alert" element, so a bumped nonce REMOUNTS it: an
      identical consecutive error re-announces to assistive tech (a live
      region whose text doesn't change announces nothing). Callers bump it
      once per occurrence. */
  nonce: number;
  onDismiss: () => void;
  /** Positioning only (fixed/absolute, offsets, z-index, the centering
      transform) — the one part the call sites legitimately differ on. */
  className: string;
}) {
  return (
    <div
      key={nonce}
      role="alert"
      className={`flex max-w-[calc(100vw-3rem)] items-center gap-2 rounded-full bg-[#16161f]/90 py-2 pl-4 pr-2 shadow-[0_12px_40px_rgba(0,0,0,0.5)] ring-1 ring-inset ring-white/10 backdrop-blur-xl ${className}`}
    >
      <span className={`min-w-0 truncate text-sm font-medium ${ERROR_TEXT}`}>{message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className={`flex h-7 w-7 shrink-0 ${GHOST_ICON_BUTTON}`}
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
