import { isValidLobbyCode, type LobbySlot, normalizeLobbyCode } from "@luminous/schema";
import { type ReactNode, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AppBackdrop } from "../../components/AppBackdrop";
import { HomeButton } from "../../components/HomeButton";
import { ArrowLeftIcon, SpinnerIcon, SwordsIcon, UserIcon, XIcon } from "../../components/icons";
import { GLASS_GHOST_BUTTON, GLASS_ICON_TILE } from "../../lib/glass";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { DeckPickerDialog } from "./components/DeckPickerDialog";
import { LeaveButton } from "./components/LeaveButton";
import { LobbyCodeCard } from "./components/LobbyCodeCard";
import { MatchPlaceholder } from "./components/MatchPlaceholder";
import { OnlineMatch } from "./components/OnlineMatch";
import { PlayerPanel } from "./components/PlayerPanel";
import { StartCountdown } from "./components/StartCountdown";
import { useAuth } from "../auth/AuthProvider";
import { clearIdentity, resolveIdentity } from "./net/session";
import { COUNTDOWN_MS, type Lobby, useLobby } from "./net/useLobby";

// The lobby room (/lobby/:code): the create → join → ready → start flow rendered
// as a state machine over the authoritative snapshot. The opponent (red) sits
// on top and you (blue) on the bottom, mirroring the app's stacked blue/red
// background glow.

/** Safely read the role passed via navigation state (lost on refresh — the
    session identity is what restores it then). */
function readRoleHint(state: unknown): LobbySlot | null {
  if (typeof state === "object" && state !== null && "role" in state) {
    const role = (state as { role: unknown }).role;
    if (role === "host" || role === "guest") return role;
  }
  return null;
}

const GHOST_PILL_CLASS = `inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium ${GLASS_GHOST_BUTTON}`;

/** Centered single-message screen (invalid code, joining, errors). */
function InfoScreen({
  icon,
  title,
  message,
  actions,
}: {
  icon: ReactNode;
  title: string;
  message?: string;
  actions?: ReactNode;
}) {
  return (
    <AppBackdrop>
      <HomeButton />
      <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-6 text-center">
        <div className={`h-20 w-20 ${GLASS_ICON_TILE}`}>{icon}</div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-white/90">{title}</h1>
          {message && <p className="text-sm text-muted">{message}</p>}
        </div>
        {actions}
      </main>
    </AppBackdrop>
  );
}

/** The host's pre-join screen: the code to share while awaiting an opponent. */
function WaitingScreen({ code, onLeave }: { code: string; onLeave: () => void }) {
  return (
    <AppBackdrop>
      <HomeButton />
      <LeaveButton onClick={onLeave} />
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
        <LobbyCodeCard code={code} />
        <div className="flex items-center justify-center gap-2 text-sm text-white/50">
          <SpinnerIcon className="h-4 w-4 animate-spin" />
          Waiting for an opponent to join…
        </div>
      </main>
    </AppBackdrop>
  );
}

/** The heart of the room: both seats, deck picking and ready-up, with the
    countdown overlay once both lock in. */
function VersusScreen({ lobby, onLeave }: { lobby: Lobby; onLeave: () => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmingKick, setConfirmingKick] = useState(false);
  const { snapshot, self, opponent } = lobby;
  const canKick = lobby.role === "host" && opponent !== null;

  const selfReady = self?.ready ?? false;
  const opponentPresent = opponent?.connected ?? false;
  const countingDown = snapshot?.phase === "countdown" && snapshot.countdownStartedAt !== null;
  const status = !opponentPresent
    ? "Opponent disconnected — waiting to reconnect…"
    : !selfReady
      ? ""
      : opponent?.ready
        ? "Both ready — starting…"
        : "Waiting for your opponent to ready up…";

  return (
    <AppBackdrop>
      <HomeButton />
      <LeaveButton onClick={onLeave} />
      {/* While the countdown overlay is up, the board beneath is inert so a
          keyboard user can't tab onto controls they can no longer see (and, e.g.,
          cancel their own ready from behind the overlay). */}
      <main
        inert={countingDown}
        className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-4 px-6 py-16"
      >
        <PlayerPanel
          side="red"
          player={opponent}
          isSelf={false}
          onKick={canKick ? () => setConfirmingKick(true) : undefined}
        />

        <div className="flex items-center gap-3 py-1 text-white/30">
          <span className="h-px flex-1 bg-white/10" />
          <SwordsIcon className="h-5 w-5" />
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <PlayerPanel
          side="blue"
          player={self}
          isSelf
          onPickDeck={() => setPickerOpen(true)}
          onToggleReady={() => lobby.setReady(!selfReady)}
        />

        {status && (
          <output aria-live="polite" className="text-center text-sm text-white/45">
            {status}
          </output>
        )}

        {lobby.matchError && (
          <output
            aria-live="assertive"
            className="rounded-lg bg-rose-500/15 px-4 py-2 text-center text-sm text-rose-200 ring-1 ring-inset ring-rose-400/25"
          >
            Couldn't start the match — {lobby.matchError}
          </output>
        )}
      </main>

      <DeckPickerDialog
        open={pickerOpen}
        selectedDeckId={self?.deckId ?? null}
        onSelect={(deck) => {
          lobby.selectDeck(deck);
          setPickerOpen(false);
        }}
        onCancel={() => setPickerOpen(false)}
      />

      <ConfirmDialog
        open={confirmingKick}
        icon={<XIcon className="h-5 w-5" />}
        danger
        title={`Remove ${opponent?.name ?? "this player"}?`}
        message="They'll be removed from the lobby. They can rejoin with the code."
        confirmLabel="Remove"
        onConfirm={() => {
          lobby.kick();
          setConfirmingKick(false);
        }}
        onCancel={() => setConfirmingKick(false)}
      />

      {countingDown && snapshot?.countdownStartedAt !== null && snapshot && (
        <StartCountdown startedAt={snapshot.countdownStartedAt} durationMs={COUNTDOWN_MS} />
      )}
    </AppBackdrop>
  );
}

// The real room, mounted only for a valid code. Split from LobbyRoom so an
// invalid code never stakes an identity or opens a channel (both would happen
// here, before any guard, if this ran for every path). Keyed by code upstream so
// switching lobbies remounts and re-resolves cleanly.
function LobbyRoomInner({ code, hintedRole }: { code: string; hintedRole: LobbySlot | null }) {
  const navigate = useNavigate();

  // Resolve identity once per mount (a fresh visit stakes a new one; a refresh
  // restores it from the session). hintedRole only matters on that first resolve.
  const identity = useMemo(() => resolveIdentity(code, hintedRole), [code, hintedRole]);
  // Announce the ACCOUNT's name when we have one (P5). The server resolves it
  // again from the session and is the authority — this only spares the host the
  // half-second where their own seat reads "Player 4271" before the first
  // broadcast corrects it, since the waiting screen is seeded locally.
  const { user } = useAuth();
  const lobby = useLobby({
    code,
    role: identity.role,
    playerId: identity.playerId,
    name: user?.displayName.trim() || identity.name,
  });

  const leaveTo = (path: string) => {
    lobby.leave();
    clearIdentity(code);
    navigate(path);
  };

  const { snapshot, self, status } = lobby;

  // Refused a seat while a MATCH is running: the server feeds this client the
  // seatless board instead (P4 3c-vii-b), so the lobby link doubles as the
  // spectate link. Names come from the snapshot, which a spectator also receives;
  // the board renders from p1's side (SPECTATOR_SIDE), i.e. the host is "you".
  if (status === "spectating" && lobby.match !== null) {
    return (
      <OnlineMatch
        game={lobby.match}
        log={lobby.matchLog}
        youName={snapshot?.host.name ?? "Host"}
        opponentName={snapshot?.guest?.name ?? "Guest"}
        opponentAway={null}
        actionError={null}
        onAction={() => {}}
        onRematch={() => {}}
        spectating
      />
    );
  }

  if (status === "full" || status === "spectating") {
    return (
      <InfoScreen
        icon={<UserIcon className="h-9 w-9" />}
        title="Lobby is full"
        message={`Lobby ${code} already has two players. If they start a match, you'll be able to watch it from here.`}
        actions={
          <button type="button" onClick={() => leaveTo("/lobby")} className={GHOST_PILL_CLASS}>
            <ArrowLeftIcon className="h-4 w-4" />
            Back to online
          </button>
        }
      />
    );
  }

  if (status === "not-found") {
    return (
      <InfoScreen
        icon={<SwordsIcon className="h-9 w-9" />}
        title="Lobby not found"
        message={`No open lobby with the code ${code}. Ask for a fresh code, or create your own.`}
        actions={
          <button type="button" onClick={() => leaveTo("/lobby")} className={GHOST_PILL_CLASS}>
            <ArrowLeftIcon className="h-4 w-4" />
            Back to online
          </button>
        }
      />
    );
  }

  if (status === "kicked") {
    return (
      <InfoScreen
        icon={<XIcon className="h-9 w-9" />}
        title="Removed from the lobby"
        message="The host removed you from this lobby."
        actions={
          <button type="button" onClick={() => leaveTo("/lobby")} className={GHOST_PILL_CLASS}>
            <ArrowLeftIcon className="h-4 w-4" />
            Back to online
          </button>
        }
      />
    );
  }

  // Our seat isn't established yet — the guest is still handshaking, or the host
  // hasn't published its first snapshot.
  if (!snapshot || !self) {
    return (
      <InfoScreen
        icon={<SpinnerIcon className="h-9 w-9 animate-spin" />}
        title="Joining lobby…"
        message={`Connecting to lobby ${code}.`}
        actions={
          <button type="button" onClick={() => leaveTo("/lobby")} className={GHOST_PILL_CLASS}>
            <ArrowLeftIcon className="h-4 w-4" />
            Cancel
          </button>
        }
      />
    );
  }

  if (snapshot.phase === "in-game") {
    // Once the server broadcasts our redacted view, render the read-only board;
    // until it arrives (the flip → first `match` frame gap, or a load-failure
    // wedge), the placeholder stands in.
    if (lobby.match !== null) {
      return (
        <OnlineMatch
          game={lobby.match}
          log={lobby.matchLog}
          youName={self.name}
          opponentName={lobby.opponent?.name ?? "Opponent"}
          // Their lobby presence, straight off the snapshot (P4 3c-v): the board
          // itself says nothing about whether anyone is still there to play it.
          opponentAway={
            lobby.opponent !== null && !lobby.opponent.connected
              ? { forfeitAt: lobby.opponent.forfeitAt }
              : null
          }
          actionError={lobby.actionError}
          onAction={lobby.sendAction}
          onRematch={lobby.requestRematch}
        />
      );
    }
    return (
      <MatchPlaceholder self={lobby.self} opponent={lobby.opponent} onLeave={() => leaveTo("/")} />
    );
  }

  if (snapshot.phase === "waiting") {
    return <WaitingScreen code={code} onLeave={() => leaveTo("/lobby")} />;
  }

  return <VersusScreen lobby={lobby} onLeave={() => leaveTo("/lobby")} />;
}

export function LobbyRoom() {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
  const code = normalizeLobbyCode(params.code ?? "");

  if (!isValidLobbyCode(code)) {
    return (
      <InfoScreen
        icon={<SwordsIcon className="h-9 w-9" />}
        title="Invalid lobby code"
        message="That code doesn't look right. Head back and try again."
        actions={
          <button type="button" onClick={() => navigate("/lobby")} className={GHOST_PILL_CLASS}>
            <ArrowLeftIcon className="h-4 w-4" />
            Back to online
          </button>
        }
      />
    );
  }

  // Keyed by code so navigating between lobbies remounts the room and re-resolves
  // identity/state from scratch rather than reusing the prior lobby's.
  return <LobbyRoomInner key={code} code={code} hintedRole={readRoleHint(location.state)} />;
}
