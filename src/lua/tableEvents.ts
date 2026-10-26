import type { GameAction, PokemonRef, Seat } from "@colorless/engine";
import type { RedactedGame, SeatLogEntry } from "@colorless/schema";

export interface CoinFlips {
  title: string;
  flips: { result: "heads" | "tails"; player: string; seat: Seat }[];
}

/** One-shot table effects of the last accepted change, read once by the simulator. */
export interface TableEvents {
  knockedOut: readonly string[];
  /** Seats whose deck or hand was shuffled. */
  shuffled: readonly Seat[];
  coin: CoinFlips | null;
  /** The Adrena-Brain source just picked, so its destination menu keeps it raised. */
  counterSource?: PokemonRef;
}

export const NO_EVENTS: TableEvents = { knockedOut: [], shuffled: [], coin: null };

/** Remove once no live match predates log cues: their rows carry only the rendered text. */
const LEGACY_SHUFFLE = /shuffled their (deck|hand)/;
const LEGACY_BOTTOM = /bottom of their deck/;

/** The table effects of the log rows one change appended, read off their cues. */
export function eventsFromLog(
  entries: readonly SeatLogEntry[],
  nameOf: (seat: Seat) => string,
): Omit<TableEvents, "counterSource"> {
  const knockedOut: string[] = [];
  const shuffled = new Set<Seat>();
  const flips: CoinFlips["flips"] = [];
  let title = "Coin flip";
  let titled = false;
  for (const e of entries) {
    if (e.kind !== "action") continue;
    if (e.playedTrainer && !titled) {
      title = e.playedTrainer.name;
      titled = true;
    }
    if (e.cues === undefined) {
      const text = e.segments.map((s) => s.text).join("");
      if (e.who !== "system" && LEGACY_SHUFFLE.test(text) && !LEGACY_BOTTOM.test(text))
        shuffled.add(e.who);
      continue;
    }
    for (const cue of e.cues) {
      if (cue.kind === "knockOut") knockedOut.push(cue.uid);
      else if (cue.kind === "shuffle") shuffled.add(cue.seat);
      else flips.push({ result: cue.face, player: nameOf(cue.seat), seat: cue.seat });
    }
  }
  return {
    knockedOut,
    shuffled: [...shuffled],
    coin: flips.length > 0 ? { title, flips } : null,
  };
}

/** The damage-counter source a player just picked, so its destination menu keeps it raised. */
export function counterSourcePicked(
  view: RedactedGame | null,
  action: GameAction,
): PokemonRef | undefined {
  const p = view?.phase;
  const transfer =
    p?.kind === "effect:choose" && p.prompt?.kind === "choosePokemon"
      ? p.prompt.counterTransfer
      : undefined;
  return transfer &&
    !transfer.from &&
    action.type === "resolveEffect" &&
    action.choice.kind === "pokemon"
    ? action.choice.ref
    : undefined;
}

/** The decision the table takes for the player: the mulligan bonus draw and a Prize take. */
export function autoStepFor(v: RedactedGame): GameAction | null {
  if (v.waitingOn !== "you" || v.outcome) return null;
  const p = v.phase;
  if (p.kind === "setup:drawExtra") return { type: "setupDrawExtra", seat: v.seat, count: p.owed };
  if (p.kind !== "ko:takePrizes") return null;
  const left = v.board.you.prizesRemaining;
  return {
    type: "takePrizes",
    seat: v.seat,
    prizeIndices: Array.from({ length: p.count }, (_, i) => left - 1 - i),
  };
}
