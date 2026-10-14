import { prepareSandbox, SandboxSetupError } from "./prepareSandbox";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { LocalGameSetup } from "../game/useLocalGame";
import {
  ERROR_TEXT,
  FOCUS_RING_INSET,
  GLASS_ACCENT_BUTTON,
  GLASS_GHOST_BUTTON,
} from "../../lib/glass";
import { useAuth } from "../auth/AuthProvider";
import { CardBackStack } from "../decks/CardBackStack";
import { DeckPickerDialog } from "../online/components/DeckPickerDialog";
import type { DeckChoice } from "../online/net/useLobby";
import { SIDE_STYLES } from "../online/theme";
import type { PlayerId } from "./types";

const SLOTS = [
  { owner: "you", label: "Player 1", side: "blue" },
  { owner: "opponent", label: "Player 2", side: "red" },
] as const;

export function SandboxSetup({ onStart }: { onStart: (setup: LocalGameSetup) => void }) {
  const { status } = useAuth();
  const [decks, setDecks] = useState<Record<PlayerId, DeckChoice | null>>({
    you: null,
    opponent: null,
  });
  const [picking, setPicking] = useState<PlayerId | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") setDecks({ you: null, opponent: null });
  }, [status]);

  async function start() {
    if (!decks.you || !decks.opponent || starting) return;
    setStarting(true);
    setError(null);
    try {
      onStart(await prepareSandbox([decks.you.id, decks.opponent.id]));
    } catch (error) {
      setError(
        error instanceof SandboxSetupError
          ? error.message
          : "Couldn't load the decks from the server — try again.",
      );
    } finally {
      setStarting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col items-center justify-center px-6 py-12 text-white">
      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
        {SLOTS.map(({ owner, label, side }) => (
          <section
            key={owner}
            aria-label={label}
            className={`flex flex-col items-center gap-4 rounded-3xl p-5 ring-1 ring-inset ring-white/10 backdrop-blur-md ${SIDE_STYLES[side].wash}`}
          >
            <h2 className={`text-base font-semibold ${SIDE_STYLES[side].accent}`}>{label}</h2>
            <button
              type="button"
              aria-label={`${decks[owner] ? "Change" : "Choose"} deck for ${label}`}
              aria-haspopup="dialog"
              disabled={starting}
              onClick={() => setPicking(owner)}
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl p-2 disabled:cursor-default disabled:opacity-50 ${FOCUS_RING_INSET}`}
            >
              {decks[owner] ? (
                <div className="w-36 pb-5">
                  <CardBackStack
                    tone={side}
                    label={
                      <span className="block truncate text-left text-xs font-semibold">
                        {decks[owner].name}
                      </span>
                    }
                  />
                </div>
              ) : (
                <span className="flex aspect-[5/7] w-36 items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/[0.02] p-3 text-sm text-white/70">
                  Choose a deck
                </span>
              )}
              {decks[owner] && <span className="text-xs text-white/50">Click to change deck</span>}
            </button>
          </section>
        ))}
      </div>
      {error && (
        <p role="alert" className={`mt-4 text-sm ${ERROR_TEXT}`}>
          {error}
        </p>
      )}
      <div className="mt-6 flex w-full items-center justify-between">
        <Link to="/" className={`rounded-full px-4 py-2 text-sm ${GLASS_GHOST_BUTTON}`}>
          Back
        </Link>
        <button
          type="button"
          disabled={!decks.you || !decks.opponent || starting || status !== "authenticated"}
          onClick={() => void start()}
          className={`cursor-pointer rounded-full px-5 py-2 text-sm font-semibold disabled:cursor-default disabled:opacity-50 ${GLASS_ACCENT_BUTTON}`}
        >
          {starting ? "Preparing…" : "Start game"}
        </button>
      </div>
      <DeckPickerDialog
        open={picking !== null}
        title={`Choose a deck for ${picking === "opponent" ? "Player 2" : "Player 1"}`}
        tone={picking === "opponent" ? "red" : "blue"}
        selectedDeckId={picking === null ? null : (decks[picking]?.id ?? null)}
        onSelect={(deck) => {
          if (picking === null) return;
          setDecks((current) => ({ ...current, [picking]: deck }));
          setError(null);
          setPicking(null);
        }}
        onCancel={() => setPicking(null)}
      />
    </main>
  );
}
