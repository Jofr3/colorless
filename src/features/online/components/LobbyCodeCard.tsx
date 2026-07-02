import { useEffect, useRef, useState } from "react";
import { CheckIcon, ClipboardIcon, XIcon } from "../../../components/icons";
import { GLASS_GHOST_BUTTON, GLASS_PANEL } from "../../../lib/glass";

// The join code, shown large and legible in the waiting room, with one-tap copy
// for the code itself and for a full invite link. Copy feedback flips the button
// to a checkmark briefly, or to a "Copy failed" state when the Clipboard API is
// unavailable (e.g. a non-secure origin) so the button never appears dead.

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type CopyState = "idle" | "copied" | "failed";

function CopyButton({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const onClick = async () => {
    const ok = await copyText(value);
    setState(ok ? "copied" : "failed");
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState("idle"), 1600);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium ${GLASS_GHOST_BUTTON}`}
    >
      {state === "copied" ? (
        <>
          <CheckIcon className="h-4 w-4" />
          Copied
        </>
      ) : state === "failed" ? (
        <>
          <XIcon className="h-4 w-4" />
          Copy failed
        </>
      ) : (
        <>
          <ClipboardIcon className="h-4 w-4" />
          {label}
        </>
      )}
    </button>
  );
}

export function LobbyCodeCard({ code }: { code: string }) {
  const inviteLink = `${window.location.origin}/lobby/${code}`;
  return (
    <div className={`flex flex-col items-center gap-4 rounded-3xl p-6 text-center ${GLASS_PANEL}`}>
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-white/40">
        Lobby code
      </p>
      {/* The display glyphs carry the letter-spacing, so a screen reader would
          read them as a run; a visually-hidden, space-separated copy gives it a
          reliable letter-by-letter reading instead (aria-label on a bare <p> is
          a name-prohibited role and unreliably announced). */}
      <p
        aria-hidden
        className="font-mono text-5xl font-bold tracking-[0.3em] text-white [text-shadow:0_2px_12px_rgba(0,0,0,0.5)]"
      >
        {code}
      </p>
      <span className="sr-only">Lobby code: {code.split("").join(" ")}</span>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <CopyButton label="Copy code" value={code} />
        <CopyButton label="Copy invite link" value={inviteLink} />
      </div>
    </div>
  );
}
