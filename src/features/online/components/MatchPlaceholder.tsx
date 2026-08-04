import type { PlayerState } from "@luminous/schema";
import { AppBackdrop } from "../../../components/AppBackdrop";
import { HomeButton } from "../../../components/HomeButton";
import { ArrowLeftIcon, SwordsIcon } from "../../../components/icons";
import { BACK_ARROW_ICON, GLASS_GHOST_BUTTON, GLASS_ICON_TILE } from "../../../lib/glass";
import { CardBackStack } from "../../decks/CardBackStack";
import { type Side, SIDE_STYLES } from "../theme";

// Stand-in for the real match. Both players are ready and the game "starts" —
// but actual online gameplay isn't built yet, so this shows the matchup and a
// coming-soon note. Swap this for the live board when it lands (the lobby's
// `in-game` phase is the hand-off point).

function MatchPlayer({ side, player }: { side: Side; player: PlayerState | null }) {
  return (
    <div className="flex w-32 flex-col items-center gap-3 text-center">
      <div className="w-20">
        <CardBackStack />
      </div>
      <div className="min-w-0">
        <p className={`truncate text-sm font-semibold ${SIDE_STYLES[side].accent}`}>
          {player?.name ?? "Opponent"}
        </p>
        <p className="mt-0.5 truncate text-xs text-white/45">{player?.deckName ?? "—"}</p>
      </div>
    </div>
  );
}

export function MatchPlaceholder({
  self,
  opponent,
  onLeave,
}: {
  self: PlayerState | null;
  opponent: PlayerState | null;
  onLeave: () => void;
}) {
  return (
    <AppBackdrop>
      <HomeButton />
      <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col items-center justify-center gap-8 px-6 py-12 text-center">
        <div className="flex items-center justify-center gap-6">
          <MatchPlayer side="blue" player={self} />
          <div className={`h-14 w-14 shrink-0 ${GLASS_ICON_TILE}`}>
            <SwordsIcon className="h-7 w-7" />
          </div>
          <MatchPlayer side="red" player={opponent} />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-white/90">The match is set</h1>
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted">
            Both players are ready. Live online gameplay is coming soon — this is where the battle
            will begin.
          </p>
        </div>
        <button
          type="button"
          onClick={onLeave}
          className={`group inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ${GLASS_GHOST_BUTTON}`}
        >
          <ArrowLeftIcon className={BACK_ARROW_ICON} />
          Leave match
        </button>
      </main>
    </AppBackdrop>
  );
}
