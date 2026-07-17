// Pure-logic suite (node env): the GameEvent → log formatter over real
// engine games (fixtures + the public API), plus the viewer mapping. The
// hidden-info rules matter as much as the wording: draws and prize takes are
// counts only, face-down placements are never named.

import { describe, expect, it } from "vitest";
import type { GameEvent, GameState, Seat } from "@luminous/engine";
import {
  attachFromDeck,
  deckOf,
  driveSetup,
  handUid,
  mustApply,
  mustCreate,
  setPrizes,
} from "../../../packages/engine/src/testFixtures";
import {
  formatElapsed,
  logFromEvents,
  viewLogEntries,
  type LogContext,
  type SeatLogEntry,
} from "./logFromEvents";

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

function ctx(state: GameState): LogContext {
  return { names: NAMES, state, elapsed: "+00:07" };
}

/** Flatten one action row to its plain text. */
function textOf(entry: SeatLogEntry): string {
  if (entry.kind === "turn") return `— turn ${entry.turn} —`;
  return entry.segments.map((segment) => segment.text).join("");
}

function texts(entries: SeatLogEntry[]): string[] {
  return entries.map(textOf);
}

// KO drivers, mirroring projection.test.ts: seed 11 → no mulligans, p2's
// opening hand holds the bench copies.
const KO_SEED = 11;
const ATTACKER_DECK = deckOf({ "fix-attacker": 30, "fix-fire-energy": 20, "fix-water-energy": 10 });

function defenderDeck(id: string): string[] {
  return deckOf({ [id]: 40, "fix-water-energy": 20 });
}

/** p1's fix-attacker (one Fire attached) vs p2's `defenderId`, p1 turn 3. */
function matchup(defenderId: string, bench: number): GameState {
  let state = driveSetup(
    KO_SEED,
    { p1: ATTACKER_DECK, p2: defenderDeck(defenderId) },
    {
      first: "p1",
      active: { p1: "fix-attacker", p2: defenderId },
      bench: { p2: Array.from({ length: bench }, () => defenderId) },
    },
  );
  state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  return state;
}

describe("formatElapsed", () => {
  it("renders +MM:SS, clamped at zero", () => {
    expect(formatElapsed(0)).toBe("+00:00");
    expect(formatElapsed(134_000)).toBe("+02:14");
    expect(formatElapsed(-500)).toBe("+00:00");
  });
});

describe("logFromEvents — setup", () => {
  it("formats the creation events (shuffles + the coin flip)", () => {
    const { state, events } = mustCreate(170);
    const entries = logFromEvents(events, ctx(state));
    expect(texts(entries)).toEqual([
      "shuffled their deck",
      "shuffled their deck",
      expect.stringMatching(/^Coin flip: (heads|tails) — (Ember|Tide) wins the toss$/),
    ]);
    const coin = entries[2];
    expect(coin?.kind === "action" && coin.who).toBe("system");
  });

  it("formats first-player choice and counts-only opening draws", () => {
    const created = mustCreate(170);
    let state = created.state;
    if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected chooseFirst");
    const winner = state.phase.coinWinner;
    const applied = mustApply(state, { type: "chooseFirstPlayer", seat: winner, first: "p1" });
    state = applied.state;
    const entries = logFromEvents(applied.events, ctx(state));
    const lines = texts(entries);
    expect(lines[0]).toBe("Ember goes first");
    expect(lines).toContain("drew 7 cards");
    // Counts only: no engine uid appears anywhere in the log text.
    for (const line of lines) {
      expect(line).not.toMatch(/p[12]#\d+/);
    }
  });

  it("names in-turn bench plays but never face-down setup placements", () => {
    const state = driveSetup(170, undefined, { first: "p1" });
    const placed = logFromEvents(
      [{ type: "POKEMON_PLACED", seat: "p1", uid: "p1#0", spot: "active" }],
      ctx(state),
    );
    expect(texts(placed)).toEqual(["placed a face-down Active Pokémon"]);
    const benched = logFromEvents(
      [{ type: "POKEMON_BENCHED", seat: "p1", uid: handUid(state, "p1", "fix-basic-1") }],
      ctx(state),
    );
    expect(texts(benched)).toEqual(["benched fix-basic-1"]);
  });
});

describe("logFromEvents — turns", () => {
  it("formats energy attach with the host Pokémon's name", () => {
    const state = driveSetup(170, undefined, {
      first: "p1",
      active: { p1: "fix-basic-1", p2: "fix-basic-1" },
    });
    const uid = handUid(state, "p1", "fix-energy");
    const applied = mustApply(state, {
      type: "attachEnergy",
      seat: "p1",
      uid,
      target: { spot: "active" },
    });
    const entries = logFromEvents(applied.events, ctx(applied.state));
    expect(texts(entries)).toEqual(["attached fix-energy → fix-basic-1"]);
  });

  it("formats end of turn as: ended, turn divider, turn-start draw", () => {
    const state = driveSetup(170, undefined, { first: "p1" });
    const applied = mustApply(state, { type: "endTurn", seat: "p1" });
    const entries = logFromEvents(applied.events, ctx(applied.state));
    expect(texts(entries)).toEqual(["ended their turn", "— turn 2 —", "drew a card"]);
  });
});

describe("logFromEvents — attacks and KOs", () => {
  it("formats declared attack, weakness damage, the KO and the prize prompt", () => {
    const state = matchup("fix-weak", 2);
    const applied = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const entries = logFromEvents(applied.events, ctx(applied.state));
    const lines = texts(entries);
    expect(lines).toContain("fix-attacker used Bite");
    expect(lines).toContain("dealt 60 damage to fix-weak · weakness ×2");
    expect(lines).toContain("fix-weak was Knocked Out");
    expect(lines).toContain("takes 1 prize card");
    // The damage row reads from the ATTACKER's seat (the event names the
    // defender's).
    const damage = entries[lines.indexOf("dealt 60 damage to fix-weak · weakness ×2")];
    expect(damage?.kind === "action" && damage.who).toBe("p1");
  });

  it("flags a not-simulated attack effect as a system line", () => {
    const state = matchup("fix-wall", 1);
    // Rage ("10+") carries both a damage modifier and effect text.
    const applied = mustApply(state, { type: "attack", seat: "p1", index: 3 });
    const entries = logFromEvents(applied.events, ctx(applied.state));
    const lines = texts(entries);
    expect(lines).toContain('Rage — "+" damage and effect not simulated');
  });

  it("reports prize takes as counts only and the win with the deck name", () => {
    // One prize from victory: the KOing Bite force-takes the last prize and
    // the game ends before any promotion is prompted (§14.1).
    const state = setPrizes(matchup("fix-weak", 1), "p1", 1);
    const applied = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const entries = logFromEvents(applied.events, ctx(applied.state));
    const lines = texts(entries);
    expect(lines).toContain("took 1 prize card — 0 left");
    expect(lines).toContain("Ember wins — all prizes taken");
    for (const line of lines) {
      expect(line).not.toMatch(/p[12]#\d+/); // prize identities stay hidden
    }
  });
});

describe("logFromEvents — resilience and viewer mapping", () => {
  it("skips unknown future events instead of crashing", () => {
    const state = mustCreate(170).state;
    const entries = logFromEvents(
      [{ type: "SOMETHING_FROM_M5", payload: 1 } as unknown as GameEvent],
      ctx(state),
    );
    expect(entries).toEqual([]);
  });

  it("viewLogEntries maps seats into the current viewer's vocabulary", () => {
    const seatLog: SeatLogEntry[] = [
      { kind: "action", who: "p1", elapsed: "+00:01", segments: [{ text: "a" }] },
      { kind: "action", who: "p2", elapsed: "+00:02", segments: [{ text: "b" }] },
      { kind: "action", who: "system", elapsed: "+00:03", segments: [{ text: "c" }] },
      { kind: "turn", turn: 3 },
    ];
    expect(
      viewLogEntries(seatLog, "p1").map((e) => (e.kind === "action" ? e.who : e.turn)),
    ).toEqual(["you", "opponent", "system", 3]);
    expect(
      viewLogEntries(seatLog, "p2").map((e) => (e.kind === "action" ? e.who : e.turn)),
    ).toEqual(["opponent", "you", "system", 3]);
  });
});
