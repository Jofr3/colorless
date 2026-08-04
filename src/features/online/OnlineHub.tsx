import { isValidLobbyCode, LOBBY_CODE_LENGTH, normalizeLobbyCode } from "@luminous/schema";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppBackdrop } from "../../components/AppBackdrop";
import { HomeButton } from "../../components/HomeButton";
import { PlusIcon, SpinnerIcon } from "../../components/icons";
import { apiUrl } from "../../lib/apiOrigin";
import {
  ERROR_TEXT,
  GLASS_ACCENT_BUTTON,
  GLASS_NEUTRAL_BUTTON,
  GLASS_PANEL,
} from "../../lib/glass";
import { probeLobby } from "./net/probe";
import { clearIdentity, stakeIdentity } from "./net/session";

// The online entry point (/lobby): create a private lobby (get a code) or join
// an existing one with a code. Creating asks the server to mint the code
// (POST /lobby — the lobby now lives in a Durable Object, so the code must
// name a real instance) and routes straight into the room; joining connects
// *here* first (a spinner in place) and only navigates once the server has
// seated us, so a bad code surfaces as an inline error instead of bouncing
// through a separate "joining…"/"not found" page.

const BUTTON_LAYOUT =
  "inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";

const PRIMARY_BUTTON_CLASS = `${BUTTON_LAYOUT} ${GLASS_ACCENT_BUTTON}`;

const SECONDARY_BUTTON_CLASS = `${BUTTON_LAYOUT} ${GLASS_NEUTRAL_BUTTON}`;

const PANEL_CLASS = `flex flex-col gap-4 rounded-3xl p-5 ${GLASS_PANEL}`;

// The join input's invalid ring, derived from the shared error red (glass.ts).
const ERROR_RING = "ring-2 ring-[#ff8a9b]/60";

export function OnlineHub() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const probeRef = useRef<ReturnType<typeof probeLobby> | null>(null);
  useEffect(() => {
    // Re-arm on setup (not just via the initializer) so StrictMode's mount→
    // unmount→remount in dev leaves the flag true, not stuck false from the
    // first cleanup.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      probeRef.current?.cancel();
    };
  }, []);

  const createLobby = async () => {
    if (creating || joining) return;
    setCreateError(null);
    setCreating(true);
    try {
      const res = await fetch(apiUrl("/lobby"), { method: "POST" });
      if (!res.ok) throw new Error(`create failed: ${res.status}`);
      const body = (await res.json()) as { code?: unknown };
      const code = typeof body.code === "string" && isValidLobbyCode(body.code) ? body.code : null;
      if (code === null) throw new Error("malformed create response");
      if (!mountedRef.current) return;
      stakeIdentity(code, "host");
      navigate(`/lobby/${code}`, { state: { role: "host" } });
    } catch {
      if (!mountedRef.current) return;
      setCreating(false);
      setCreateError("Couldn't reach the lobby server. Try again in a moment.");
    }
  };

  const joinLobby = async () => {
    if (joining) return;
    const code = normalizeLobbyCode(joinCode);
    if (!isValidLobbyCode(code)) {
      setError(`Enter the full ${LOBBY_CODE_LENGTH}-character code.`);
      return;
    }
    setError(null);
    setJoining(true);

    // Stake the identity up front so the probe and the room use the SAME player
    // id — the room then resumes the seat the probe just secured.
    const identity = stakeIdentity(code, "guest");
    const probe = probeLobby(code, identity.playerId, identity.name);
    probeRef.current = probe;
    const outcome = await probe.promise;
    probeRef.current = null;
    if (!mountedRef.current) return;

    if (outcome === "joined") {
      navigate(`/lobby/${code}`, { state: { role: "guest" } });
      return;
    }
    // No seat taken — drop the staked identity so a retry starts clean.
    clearIdentity(code);
    setJoining(false);
    setError(outcome === "full" ? "That lobby is already full." : "No open lobby with that code.");
  };

  return (
    <AppBackdrop>
      <HomeButton />
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
        <h1 className="sr-only">Online</h1>

        <section className={PANEL_CLASS}>
          <div>
            <h2 className="text-base font-semibold text-white/90">Create a lobby</h2>
            <p className="mt-0.5 text-sm text-muted">
              Get a code to share, then wait for your opponent to join.
            </p>
          </div>
          <button
            type="button"
            onClick={createLobby}
            disabled={joining || creating}
            className={PRIMARY_BUTTON_CLASS}
          >
            {creating ? (
              <>
                <SpinnerIcon className="h-4 w-4 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <PlusIcon className="h-4 w-4" />
                Create private lobby
              </>
            )}
          </button>
          {createError && (
            <p className={`text-sm ${ERROR_TEXT}`} role="alert">
              {createError}
            </p>
          )}
        </section>

        <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-white/30">
          <span className="h-px flex-1 bg-white/10" />
          or
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <form
          className={PANEL_CLASS}
          onSubmit={(e) => {
            e.preventDefault();
            joinLobby();
          }}
        >
          <div>
            <h2 className="text-base font-semibold text-white/90">Join a lobby</h2>
            <p className="mt-0.5 text-sm text-muted">Enter the code your opponent shared.</p>
          </div>
          <input
            value={joinCode}
            onChange={(e) => {
              setJoinCode(normalizeLobbyCode(e.target.value));
              if (error) setError(null);
            }}
            disabled={joining}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="CODE"
            aria-label="Lobby code"
            aria-invalid={error !== null}
            maxLength={LOBBY_CODE_LENGTH}
            className={`w-full rounded-2xl bg-white/[0.06] px-4 py-3 text-center font-mono text-2xl font-bold uppercase tracking-[0.3em] text-white placeholder:text-white/25 placeholder:tracking-[0.3em] ring-1 ring-inset ring-white/10 outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-60 ${
              error ? ERROR_RING : ""
            }`}
          />
          {error && (
            <p className={`text-sm ${ERROR_TEXT}`} role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={joining || joinCode.length !== LOBBY_CODE_LENGTH}
            className={SECONDARY_BUTTON_CLASS}
          >
            {joining ? (
              <>
                <SpinnerIcon className="h-4 w-4 animate-spin" />
                Joining…
              </>
            ) : (
              "Join"
            )}
          </button>
        </form>
      </main>
    </AppBackdrop>
  );
}
