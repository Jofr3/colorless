import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { SpinnerIcon, UserIcon } from "../../components/icons";
import {
  CORNER_ACCOUNT_POSITION,
  CORNER_CONTROL_SHAPE,
  ERROR_TEXT,
  GLASS_DIALOG_GHOST_BUTTON,
  GLASS_HUD_BUTTON,
  GLASS_PANEL,
} from "../../lib/glass";
import { ApiError } from "../../lib/api";
import { useAuth } from "./AuthProvider";

// Round account control stacked directly above the bottom-right
// SettingsButton — same size, glass styling and inset, so the two read as
// one column of corner controls. Rendered once by RootLayout (hidden on
// /login and /register, where it's redundant).
//
// Anonymous → a Link into /login carrying `state.from` so a successful
// sign-in returns here. Authenticated → the user's initial; clicking opens
// a small glass popover with who you are + Sign out. While the mount-time
// session probe is still running it renders nothing — the control is
// position:fixed, so appearing late never shifts layout.

const CORNER_BUTTON = `${CORNER_ACCOUNT_POSITION} ${CORNER_CONTROL_SHAPE} ${GLASS_HUD_BUTTON}`;

export function AccountButton() {
  const { status, user, logout } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();

  // Close on click-outside and Escape while the popover is open. Escape
  // also puts focus back on the toggle so keyboard users aren't stranded.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (status === "loading") return null;

  if (status === "anonymous" || user === null) {
    return (
      <Link to="/login" state={{ from: pathname }} aria-label="Sign in" className={CORNER_BUTTON}>
        <UserIcon className="h-[18px] w-[18px]" />
      </Link>
    );
  }

  const label = user.displayName.trim() === "" ? user.email : user.displayName;
  const initial = label.slice(0, 1).toUpperCase();

  const handleSignOut = async () => {
    if (signingOut) return;
    setSignOutError(null);
    setSigningOut(true);
    try {
      // Success flips the provider to anonymous, which swaps this whole
      // control back to the "Sign in" link — no navigation, stays on page.
      await logout();
      setOpen(false);
    } catch (error) {
      setSignOutError(
        error instanceof ApiError
          ? "Sign out failed — try again."
          : "Couldn't reach the server — try again.",
      );
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div ref={containerRef} className={CORNER_ACCOUNT_POSITION}>
      <button
        ref={toggleRef}
        type="button"
        aria-label={`Account: ${label}`}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((prev) => !prev)}
        className={`${CORNER_CONTROL_SHAPE} text-sm font-semibold ${GLASS_HUD_BUTTON}`}
      >
        <span aria-hidden="true">{initial}</span>
      </button>

      {open && (
        <div
          id={popoverId}
          className={`absolute bottom-full right-0 mb-2 w-56 rounded-2xl p-3 ${GLASS_PANEL}`}
        >
          <p className="truncate text-sm font-semibold text-white/90">{label}</p>
          <p className="truncate text-xs text-white/45">{user.email}</p>
          <output className="block empty:hidden">
            {signOutError && <p className={`mt-2 text-xs ${ERROR_TEXT}`}>{signOutError}</p>}
          </output>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className={`mt-3 inline-flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${GLASS_DIALOG_GHOST_BUTTON}`}
          >
            {signingOut && <SpinnerIcon className="h-4 w-4 animate-spin" />}
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
