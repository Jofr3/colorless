// Pure-logic suite (node env): the GameEvent → log formatter over real
// engine games (fixtures + the public API), plus the viewer mapping. The
// hidden-info rules matter as much as the wording: draws and prize takes are
// counts only, face-down placements are never named.

import { describe, expect, it } from "vitest";
import type { GameEvent, GameState, Seat } from "@luminous/engine";
import { topCardOf } from "@luminous/engine";
import {
  MIXED_DECK,
  SPECIAL_ENERGY_DECK,
  STADIUM_TOOL_DECK,
  attachFromDeck,
  benchFromDeck,
  deckOf,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  mustCreate,
  setActiveFromDeck,
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

describe("logFromEvents — evolution (M4)", () => {
  it("names the evolution from → to (both card names resolve)", () => {
    const state = driveSetup(170, undefined, {
      first: "p1",
      active: { p1: "fix-basic-1", p2: "fix-basic-1" },
    });
    const active = state.players.p1.active;
    if (active === null) throw new Error("expected an active");
    const from = active.stack[active.stack.length - 1] ?? "";
    // Any uid mapping to fix-stage1 resolves its name (cardName reads the pool,
    // not the zone) — MIXED_DECK carries copies.
    const to = Object.keys(state.cardIdByUid).find((u) => state.cardIdByUid[u] === "fix-stage1");
    if (to === undefined) throw new Error("expected a fix-stage1 uid in the game");
    const rows = logFromEvents(
      [{ type: "POKEMON_EVOLVED", seat: "p1", from, to, target: { spot: "active" } }],
      ctx(state),
    );
    expect(texts(rows)).toEqual(["evolved fix-basic-1 → fix-stage1"]);
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
    // Rage ("10+") carries both a damage modifier and an underived effect
    // text — the combined wording.
    const applied = mustApply(state, { type: "attack", seat: "p1", index: 3 });
    const entries = logFromEvents(applied.events, ctx(applied.state));
    const lines = texts(entries);
    expect(lines).toContain('Rage — "+" damage and effect not simulated');
  });

  it("words a skipped damage marker WITHOUT claiming the effect was skipped", () => {
    // Contract: effect null means the printed text DID derive and run (its
    // STATUS_APPLIED rows are real, elsewhere in the batch) — only the
    // damage marker went unsimulated, and the row must not say otherwise.
    const state = mustCreate(170).state;
    const entries = logFromEvents(
      [
        {
          type: "ATTACK_EFFECT_SKIPPED",
          seat: "p1",
          attack: "Torrent Rush",
          effect: null,
          damageModifier: "×",
        },
      ],
      ctx(state),
    );
    const lines = texts(entries);
    expect(lines).toEqual(['Torrent Rush — "×" damage not simulated']);
    expect(lines[0]).not.toContain("effect");
  });

  it("quotes the skipped sentence when only the effect went unsimulated", () => {
    const state = mustCreate(170).state;
    const entries = logFromEvents(
      [
        {
          type: "ATTACK_EFFECT_SKIPPED",
          seat: "p1",
          attack: "Tail Whip",
          effect: "The Defending Pokémon can't retreat during your opponent's next turn.",
          damageModifier: null,
        },
      ],
      ctx(state),
    );
    expect(texts(entries)).toEqual([
      "Tail Whip — effect \"The Defending Pokémon can't retreat during your opponent's next turn.\" not simulated",
    ]);
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

describe("logFromEvents — special conditions and the Checkup (M3)", () => {
  /** A settled board whose active uids the synthetic events can name: p1's
      Active is a real in-play stack, so cardName resolution is exercised. */
  function board(): { state: GameState; uid: string; name: string } {
    const state = driveSetup(170, undefined, {
      first: "p1",
      active: { p1: "fix-basic-1", p2: "fix-basic-1" },
    });
    const active = state.players.p1.active;
    if (active === null) throw new Error("expected an active");
    const uid = active.stack[active.stack.length - 1];
    if (uid === undefined) throw new Error("expected a stacked active");
    return { state, uid, name: "fix-basic-1" };
  }

  const settled = board();

  /** Format one synthetic event against the settled board. */
  function line(event: GameEvent): { text: string; who: Seat | "system" } {
    const entries = logFromEvents([event], ctx(settled.state));
    const entry = entries[0];
    if (entries.length !== 1 || entry === undefined || entry.kind !== "action") {
      throw new Error(`expected exactly one action row, got ${JSON.stringify(entries)}`);
    }
    return { text: textOf(entry), who: entry.who };
  }

  it("names statuses as they land, with raised poison spelled out", () => {
    const { uid, name } = settled;
    expect(line({ type: "STATUS_APPLIED", seat: "p1", uid, status: "asleep" })).toEqual({
      text: `${name} is now Asleep`,
      who: "p1",
    });
    // The default 10-per-Checkup poison stays implicit…
    expect(
      line({ type: "STATUS_APPLIED", seat: "p1", uid, status: "poisoned", poisonDamage: 10 }).text,
    ).toBe(`${name} is now Poisoned`);
    // …a raised amount ("2 counters instead of 1") is called out.
    expect(
      line({ type: "STATUS_APPLIED", seat: "p1", uid, status: "poisoned", poisonDamage: 20 }).text,
    ).toBe(`${name} is now Poisoned (20 damage per Checkup)`);
  });

  it("words each STATUS_CLEARED reason, listing every benched-away status", () => {
    const { uid, name } = settled;
    const cleared = (
      statuses: ("asleep" | "paralyzed" | "confused" | "burned" | "poisoned")[],
      reason: "benched" | "evolved" | "wokeUp" | "burnCured" | "paralysisEnded",
    ) => line({ type: "STATUS_CLEARED", seat: "p1", uid, statuses, reason }).text;
    expect(cleared(["asleep"], "wokeUp")).toBe(`${name} woke up`);
    expect(cleared(["burned"], "burnCured")).toBe(`${name}'s Burn was cured`);
    expect(cleared(["paralyzed"], "paralysisEnded")).toBe(`${name}'s Paralysis wore off`);
    expect(cleared(["confused", "poisoned", "burned"], "benched")).toBe(
      `${name} recovered from Confused, Poisoned, Burned`,
    );
    // §10 — evolving sheds every condition at once (uid is the NEW top card).
    expect(cleared(["asleep", "burned"], "evolved")).toBe(
      `${name} shed Asleep, Burned on evolving`,
    );
  });

  it("attributes Checkup ticks and the confusion self-hit to the system", () => {
    const { uid, name } = settled;
    const poison = line({
      type: "COUNTERS_PLACED",
      seat: "p1",
      uid,
      amount: 10,
      source: "poison",
    });
    expect(poison).toEqual({ text: `Poison: 10 damage to ${name}`, who: "system" });
    expect(
      line({ type: "COUNTERS_PLACED", seat: "p1", uid, amount: 20, source: "burn" }).text,
    ).toBe(`Burn: 20 damage to ${name}`);
    expect(
      line({ type: "COUNTERS_PLACED", seat: "p1", uid, amount: 30, source: "confusion" }).text,
    ).toBe(`Confusion: ${name} hit itself for 30`);
  });

  it("formats the recovery, confusion and effect coin flips", () => {
    const { uid, name } = settled;
    const checkup = line({
      type: "CHECKUP_COIN_FLIP",
      seat: "p2",
      status: "asleep",
      result: "heads",
    });
    expect(checkup).toEqual({ text: "Checkup — Asleep flip for Tide: heads", who: "system" });
    expect(
      line({ type: "CHECKUP_COIN_FLIP", seat: "p1", status: "burned", result: "tails" }).text,
    ).toBe("Checkup — Burned flip for Ember: tails");
    expect(line({ type: "CONFUSION_CHECK", seat: "p1", uid, result: "tails" })).toEqual({
      text: `${name} is Confused — flip: tails`,
      who: "p1",
    });
    // seat = the ATTACKER on the effect gate flip.
    expect(line({ type: "ATTACK_EFFECT_COIN_FLIP", seat: "p1", result: "heads" })).toEqual({
      text: "flipped heads for the attack effect",
      who: "p1",
    });
  });

  it("formats the failed attack and the heal", () => {
    const { uid, name } = settled;
    expect(line({ type: "ATTACK_FAILED", seat: "p1", uid, reason: "confusion" })).toEqual({
      text: `${name}'s attack failed — Confused`,
      who: "p1",
    });
    expect(line({ type: "HEALED", seat: "p1", uid, amount: 30 })).toEqual({
      text: `${name} healed 30 damage`,
      who: "p1",
    });
  });

  it("logs a real Hypnosis batch: attack, status, then the Checkup inside it", () => {
    // p2's fix-statuser puts p1's Active to sleep on turn 2; the same
    // action's batch then runs the Checkup, where the asleep Active flips.
    let state = driveSetup(
      170,
      { p1: MIXED_DECK, p2: deckOf({ "fix-statuser": 40, "fix-energy": 20 }) },
      { first: "p1", active: { p2: "fix-statuser" } },
    );
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    const p1Active = state.players.p1.active;
    if (p1Active === null) throw new Error("expected p1 active");
    const defender = topCardOf(state, p1Active)?.name ?? "?";

    const applied = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    const lines = texts(logFromEvents(applied.events, ctx(applied.state)));

    expect(lines).toContain("fix-statuser used Hypnosis");
    expect(lines).toContain(`${defender} is now Asleep`);
    const flip = lines.find((text) => text.startsWith("Checkup — Asleep flip for Ember: "));
    if (flip === undefined) throw new Error(`no checkup flip in ${JSON.stringify(lines)}`);
    // Heads wakes the Pokémon in the SAME batch; tails leaves it asleep.
    expect(lines.includes(`${defender} woke up`)).toBe(flip.endsWith("heads"));
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

describe("logFromEvents — the persistent zones (M4 slice 3)", () => {
  /** p1 on turn 2 (p2 first, passed) with the slice-3 cards pulled to hand. */
  function stadiumToolState(): GameState {
    let state = driveSetup(
      31,
      { p1: STADIUM_TOOL_DECK, p2: STADIUM_TOOL_DECK },
      { first: "p2" },
    );
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = handFromDeck(state, "p1", "sv01-167", 1);
    return handFromDeck(state, "p1", "sv01-197", 1);
  }

  it("names a Tool attach with its host, like an energy attach", () => {
    const state = stadiumToolState();
    const band = handUid(state, "p1", "sv01-197");
    const hostName = (() => {
      const active = state.players.p1.active;
      if (active === null) throw new Error("expected an Active");
      return topCardOf(state, active)?.name;
    })();
    const { state: next, events } = mustApply(state, {
      type: "attachTool",
      seat: "p1",
      uid: band,
      target: { spot: "active" },
    });
    const rows = texts(logFromEvents(events, ctx(next)));
    expect(rows).toContain(`attached sv01-197 → ${hostName}`);
  });

  it("logs a Stadium replacement: the play row, then the system replaced row", () => {
    let state = stadiumToolState();
    const beachCourt = handUid(state, "p1", "sv01-167");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid: beachCourt }).state;
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = handFromDeck(state, "p2", "sv03-192", 1);
    const leagueHq = handUid(state, "p2", "sv03-192");
    const { state: next, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: leagueHq,
    });
    const rows = logFromEvents(events, ctx(next));
    expect(texts(rows)).toEqual([
      "played Pokémon League Headquarters",
      "Beach Court left play — replaced",
    ]);
    expect(rows[1]?.kind === "action" && rows[1].who).toBe("system");
  });

  it("shows the Vitality Band boost in the damage math", () => {
    // fix-attacker (Bite [C] 30) + Vitality Band vs a plain no-weakness Basic
    // (fix-basic-1 — 8 copies, so the surgery finds one at any seed).
    let state = driveSetup(
      31,
      { p1: STADIUM_TOOL_DECK, p2: STADIUM_TOOL_DECK },
      { first: "p2" },
    );
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = setActiveFromDeck(state, "p2", "fix-basic-1");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = handFromDeck(state, "p1", "sv01-197", 1);
    const band = handUid(state, "p1", "sv01-197");
    state = mustApply(state, {
      type: "attachTool",
      seat: "p1",
      uid: band,
      target: { spot: "active" },
    }).state;
    const { state: next, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const rows = texts(logFromEvents(events, ctx(next)));
    expect(rows).toContain("dealt 40 damage to fix-basic-1 · boosted +10");
  });
});

describe("ENERGY_ATTACHED — host resolved by uid, robust to Jet's switch (§6.1)", () => {
  it("names the Pokémon the energy landed on even after Jet switches it Active", () => {
    let state = driveSetup(7, { p1: SPECIAL_ENERGY_DECK, p2: SPECIAL_ENERGY_DECK }, { first: "p2" });
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state; // P1's turn 2
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    // A single, distinctly-named benched Pokémon at index 0.
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
    state = benchFromDeck(state, "p1", "fix-victim");
    state = handFromDeck(state, "p1", "sv02-190", 1); // Jet
    const jet = handUid(state, "p1", "sv02-190");
    const { state: next, events } = mustApply(state, {
      type: "attachEnergy",
      seat: "p1",
      uid: jet,
      target: { spot: "bench", index: 0 },
    });
    const rows = texts(logFromEvents(events, ctx(next)));
    // The energy landed on fix-victim (now Active after the switch) — the old
    // index-based lookup would have named fix-attacker (now benched at index 0).
    expect(rows).toContain("attached Jet Energy → fix-victim");
    expect(rows.some((r) => r === "attached Jet Energy → fix-attacker")).toBe(false);
  });
});
