// Pure-logic suite (node env): the GameEvent → log formatter over real
// engine games (fixtures + the public API), plus the viewer mapping. The
// hidden-info rules matter as much as the wording: draws and prize takes are
// counts only, face-down placements are never named.

import { describe, expect, it } from "vitest";
import type { GameEvent, GameState, Seat } from "@luminous/engine";
import { topCardOf } from "@luminous/engine";
import {
  ATTACK_DISCARD_DECK,
  ATTACK_PARK_DECK,
  BOARD_CONDITION_DECK,
  DISCARD_ENERGY_DECK,
  HAND_REFRESH_DECK,
  MIXED_DECK,
  REVEAL_BOTTOM_DECK,
  SPECIAL_ENERGY_DECK,
  STADIUM_TOOL_DECK,
  attachBenchFromDeck,
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
  types,
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
    // M4 slice 6 — a between-turns Ability counter (Trevenant) is a system row.
    expect(line({ type: "COUNTERS_PLACED", seat: "p1", uid, amount: 10, source: "ability" })).toEqual(
      { text: `Ability: 10 damage to ${name}`, who: "system" },
    );
  });

  it("names a triggered Ability firing on its own (M4 slice 6)", () => {
    const { uid, name } = settled;
    expect(line({ type: "ABILITY_TRIGGERED", seat: "p1", uid, ability: "Blessed Salt" })).toEqual({
      text: `${name}'s Blessed Salt activated`,
      who: "p1",
    });
  });

  it("counts a printed hand-discard cost without naming the cards (M5 payFromHand)", () => {
    // Count only — the cards came out of a hidden HAND (the HAND_DISCARDED rule),
    // even though they land in the public discard pile. Both plurals pinned.
    expect(line({ type: "HAND_COST_PAID", seat: "p1", uids: ["u1"], to: "discard" })).toEqual({
      text: "discarded 1 card from their hand to pay a cost",
      who: "p1",
    });
    expect(line({ type: "HAND_COST_PAID", seat: "p1", uids: ["u1", "u2"], to: "discard" })).toEqual({
      text: "discarded 2 cards from their hand to pay a cost",
      who: "p1",
    });
  });

  it("says PUT UNDER THE DECK for a cost paid there (M5 Dendra) — still count only", () => {
    // Same event, same count-only rule, different VERB — and the verb is the only
    // thing that distinguishes a payment both players can read afterwards (the
    // discard pile) from one nobody ever sees again (under the deck).
    expect(line({ type: "HAND_COST_PAID", seat: "p1", uids: ["u1"], to: "deckBottom" })).toEqual({
      text: "put 1 card from their hand on the bottom of their deck",
      who: "p1",
    });
    expect(
      line({ type: "HAND_COST_PAID", seat: "p2", uids: ["u1", "u2"], to: "deckBottom" }),
    ).toEqual({
      text: "put 2 cards from their hand on the bottom of their deck",
      who: "p2",
    });
  });

  it("names an on-KO Ability's coin flip and its prize denial (M4 slice 9)", () => {
    const { uid, name } = settled;
    expect(
      line({ type: "ABILITY_COIN_FLIP", seat: "p1", uid, ability: "Shattering Crystal", result: "heads" }),
    ).toEqual({ text: `${name} flipped heads for Shattering Crystal`, who: "p1" });
    // The prize denial is a system row (the flip above named the Ability).
    expect(line({ type: "PRIZE_PREVENTED", seat: "p1", uid })).toEqual({
      text: `${name} — no Prize card is taken for it`,
      who: "system",
    });
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
    // seat = the actor on the effect gate flip (attack OR Trainer, M5).
    expect(line({ type: "ATTACK_EFFECT_COIN_FLIP", seat: "p1", result: "heads" })).toEqual({
      text: "flipped heads for the effect",
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

describe("logFromEvents — lookAtTopN (M5): DECK_TOP_REVEALED", () => {
  it("logs an honest 'looked at the top' count-only row (singular + plural)", () => {
    // Count-only, so a bare game state suffices — the row never resolves names.
    const { state } = mustCreate(1);
    const one: GameEvent = { type: "DECK_TOP_REVEALED", seat: "p1", uids: ["p1#0"] };
    const many: GameEvent = { type: "DECK_TOP_REVEALED", seat: "p1", uids: ["p1#0", "p1#1"] };
    expect(texts(logFromEvents([one], ctx(state)))).toEqual([
      "looked at the top of their deck — put 1 card in hand",
    ]);
    expect(texts(logFromEvents([many], ctx(state)))).toEqual([
      "looked at the top of their deck — put 2 cards in hand",
    ]);
  });
});

describe("logFromEvents — attachFromTop (M5): DECK_TOP_DISCARDED", () => {
  it("logs a count-only 'discarded looked-at cards' row (singular + plural)", () => {
    // The sibling of DECK_TOP_REVEALED, and count-only for the same reason — the
    // discard pile is public, so what the row has to carry is that the look COST
    // something (Hydreigon "Tri Howl": "Discard the other cards").
    const { state } = mustCreate(1);
    const line = (event: GameEvent) => {
      const entry = logFromEvents([event], ctx(state))[0];
      if (entry === undefined || entry.kind !== "action") throw new Error("expected an action row");
      return { text: textOf(entry), who: entry.who };
    };
    // The SEAT rides the assertion, not just the text: the row belongs to the
    // player whose deck was discarded from, and "infer the actor from the other
    // seat" is a bug this log has already shipped once (see ENERGY_DISCARDED).
    expect(line({ type: "DECK_TOP_DISCARDED", seat: "p2", uids: ["p2#0"] })).toEqual({
      text: "discarded 1 looked-at card from the top of their deck",
      who: "p2",
    });
    expect(line({ type: "DECK_TOP_DISCARDED", seat: "p1", uids: ["p1#0", "p1#1"] })).toEqual({
      text: "discarded 2 looked-at cards from the top of their deck",
      who: "p1",
    });
  });
});

describe("logFromEvents — handRefresh (M5): HAND_SHUFFLED_INTO_DECK / HAND_TO_BOTTOM_OF_DECK", () => {
  it("logs a count-only 'shuffled their hand into their deck' row (singular + plural)", () => {
    // Count-only, so a bare game state suffices — the row never resolves names,
    // so it stays hidden even for the opponent's hand (Judge).
    const { state } = mustCreate(1);
    const one: GameEvent = { type: "HAND_SHUFFLED_INTO_DECK", seat: "p1", count: 1 };
    const many: GameEvent = { type: "HAND_SHUFFLED_INTO_DECK", seat: "p2", count: 4 };
    expect(texts(logFromEvents([one], ctx(state)))).toEqual([
      "shuffled their hand (1 card) into their deck",
    ]);
    expect(texts(logFromEvents([many], ctx(state)))).toEqual([
      "shuffled their hand (4 cards) into their deck",
    ]);
  });

  it("logs the BOTTOM placement as its own count-only row (Iono), 0 included", () => {
    // The other placement in the family: the DESTINATION differs (under the deck,
    // whose order survives), but the hand is still shuffled — the row has to say
    // both, or a player who saw that hand would think its order is known. Count-only
    // too — Iono reaches the opponent's hand.
    const { state } = mustCreate(1);
    const one: GameEvent = { type: "HAND_TO_BOTTOM_OF_DECK", seat: "p1", count: 1 };
    const many: GameEvent = { type: "HAND_TO_BOTTOM_OF_DECK", seat: "p2", count: 5 };
    const none: GameEvent = { type: "HAND_TO_BOTTOM_OF_DECK", seat: "p2", count: 0 };
    expect(texts(logFromEvents([one], ctx(state)))).toEqual([
      "shuffled their hand (1 card) and put it on the bottom of their deck",
    ]);
    expect(texts(logFromEvents([many], ctx(state)))).toEqual([
      "shuffled their hand (5 cards) and put it on the bottom of their deck",
    ]);
    expect(texts(logFromEvents([none], ctx(state)))).toEqual([
      "shuffled their hand (0 cards) and put it on the bottom of their deck",
    ]);
  });

  it("pins the REAL Iono batch: both placements, THEN both draws, all count-only", () => {
    // The engine moves every affected hand before anyone draws (the "if either
    // player" gate needs it), so the rows group rather than alternate. Driven
    // through playTrainer, not synthesized, so the order is the real one.
    let state = driveSetup(9, { p1: HAND_REFRESH_DECK, p2: HAND_REFRESH_DECK }, { first: "p2" });
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state; // P1's turn 2
    state = handFromDeck(state, "p1", "sv02-185", 1);
    state = setPrizes(state, "p1", 2); // asymmetric: each draws their OWN count
    state = setPrizes(state, "p2", 6);
    const uid = handUid(state, "p1", "sv02-185");
    const { state: after, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    expect(texts(logFromEvents(events, ctx(after)))).toEqual([
      "played sv02-185",
      "shuffled their hand (7 cards) and put it on the bottom of their deck",
      "shuffled their hand (7 cards) and put it on the bottom of their deck",
      "drew 2 cards",
      "drew 6 cards",
    ]);
    // No row names a card that went under a deck or came off one — Iono reaches
    // the opponent's hand, so every row here has to stay a bare count.
    const who = logFromEvents(events, ctx(after)).map((e) => (e.kind === "turn" ? null : e.who));
    expect(who).toEqual(["p1", "p1", "p2", "p1", "p2"]);
  });
});

describe("logFromEvents — reveal-and-bottom (M5): HAND_REVEALED / CARD_TO_BOTTOM_OF_DECK", () => {
  it("pins the REAL Ortega batch — the reveal NAMES cards, and the bottomed card is named too", () => {
    // The one hand row in the file that is not count-only, and the contrast
    // that justifies it sits two rows above in the Iono test: a hand SHUFFLED
    // under a deck stays hidden, a hand REVEALED does not. Driven through
    // playTrainer + resolveEffect, so the order is the real one.
    let state = driveSetup(20260722, { p1: REVEAL_BOTTOM_DECK, p2: REVEAL_BOTTOM_DECK }, { first: "p2" });
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state; // P1's turn 2
    // P2's hand, exactly: two classes so the pick is a real question.
    const p2Side = state.players.p2;
    state = {
      ...state,
      players: {
        ...state.players,
        p2: { ...p2Side, hand: [], deck: [...p2Side.deck, ...p2Side.hand] },
      },
    };
    state = handFromDeck(state, "p2", "fix-item", 1);
    state = handFromDeck(state, "p2", "sv01-105", 1); // Greavard — a distinct name
    state = handFromDeck(state, "p1", "sv03-190", 1); // Ortega
    const uid = handUid(state, "p1", "sv03-190");

    const { state: parked, events: played } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid,
    });
    expect(texts(logFromEvents(played, ctx(parked)))).toEqual([
      "played sv03-190",
      "revealed their hand: fix-item, Greavard",
    ]);
    // The reveal is filed under the seat whose hand it is, not the actor —
    // the row above it already named the cause.
    expect(logFromEvents(played, ctx(parked)).map((e) => (e.kind === "turn" ? null : e.who))).toEqual(
      ["p1", "p2"],
    );

    const picked = handUid(parked, "p2", "sv01-105");
    const { state: after, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [picked] },
    });
    // Named, and the OWNER named outright: the `who` chip is viewer-relative,
    // so a mirror match would otherwise print an identical row from both seats.
    expect(texts(logFromEvents(events, ctx(after)))).toEqual([
      "put Greavard on the bottom of Tide's deck",
    ]);
    // Filed under the ACTOR (whose card did it), the ENERGY_DISCARDED rule.
    expect(logFromEvents(events, ctx(after)).map((e) => (e.kind === "turn" ? null : e.who))).toEqual([
      "p1",
    ]);
  });

  it("says so plainly when the revealed hand is empty", () => {
    // Reachable through Greavard's attack (which is not gated on the hand), and
    // an honest zero rather than a silent skip — the HAND_DISCARDED "(0 cards)"
    // precedent.
    const { state } = mustCreate(1);
    const empty: GameEvent = { type: "HAND_REVEALED", seat: "p2", uids: [] };
    expect(texts(logFromEvents([empty], ctx(state)))).toEqual(["revealed their hand — no cards"]);
  });

  it("folds repeats into ×N rather than stuttering the same name", () => {
    // A revealed hand is the first batch that routinely holds several copies of
    // one card, and a run of identical names reads as a stutter rather than a
    // quantity (countedNames' rule, arriving here from the discard rows).
    let state = driveSetup(20260722, { p1: REVEAL_BOTTOM_DECK, p2: REVEAL_BOTTOM_DECK }, { first: "p2" });
    const side = state.players.p2;
    state = {
      ...state,
      players: {
        ...state.players,
        p2: { ...side, hand: [], deck: [...side.deck, ...side.hand] },
      },
    };
    state = handFromDeck(state, "p2", "fix-item", 2);
    const dupes: GameEvent = { type: "HAND_REVEALED", seat: "p2", uids: state.players.p2.hand };
    expect(texts(logFromEvents([dupes], ctx(state)))).toEqual(["revealed their hand: fix-item ×2"]);
  });
});

describe("logFromEvents — moveEnergy (M5): ENERGY_MOVED", () => {
  it("names the source and destination Pokémon (both stay put — no compaction)", () => {
    let state = driveSetup(7, { p1: SPECIAL_ENERGY_DECK, p2: SPECIAL_ENERGY_DECK }, { first: "p2" });
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state; // P1's turn 2
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
    state = benchFromDeck(state, "p1", "fix-victim"); // a distinctly-named destination at index 0
    const moved: GameEvent = {
      type: "ENERGY_MOVED",
      seat: "p1",
      uids: ["p1#0", "p1#1"],
      from: { spot: "active" },
      to: { spot: "bench", index: 0 },
    };
    // The Pokémon don't move, so both targets resolve off the post-state.
    expect(texts(logFromEvents([moved], ctx(state)))).toEqual([
      "moved 2 energy from fix-attacker to fix-victim",
    ]);
  });
});

describe("logFromEvents — discardEnergy (M5): ENERGY_DISCARDED", () => {
  /** P1's turn 2 on the discardEnergy deck (P2 went first and passed). */
  function p1Turn2(seed: number): GameState {
    const state = driveSetup(
      seed,
      { p1: DISCARD_ENERGY_DECK, p2: DISCARD_ENERGY_DECK },
      { first: "p2" },
    );
    return mustApply(state, { type: "endTurn", seat: "p2" }).state;
  }

  it("attributes the row to the CONTROLLER, not the seat that owns the Energy", () => {
    // `seat` on the event names the victim (DAMAGE_DEALT's convention) and
    // `actor` the controller, which is what the row files under — a row filed
    // under p2 would read as if the opponent discarded their own Energy.
    let state = p1Turn2(1);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const energy = state.players.p2.active?.energy[0] as string;
    const victim = topCardOf(state, state.players.p2.active as never)?.name as string;
    const withCard = handFromDeck(state, "p1", "fix-hammer", 1);
    const uid = handUid(withCard, "p1", "fix-hammer");
    const { state: after, events } = mustApply(withCard, { type: "playTrainer", seat: "p1", uid });

    expect(types(events)).toEqual(["TRAINER_PLAYED", "ENERGY_DISCARDED"]);
    const rows = logFromEvents(events, ctx(after));
    expect(texts(rows)).toEqual([
      "played fix-hammer",
      `discarded fix-energy from Tide's ${victim}`,
    ]);
    expect(rows.map((e) => (e.kind === "turn" ? null : e.who))).toEqual(["p1", "p1"]);
    // The card named really is the one that left the board.
    expect(after.players.p2.discard).toContain(energy);
  });

  it("Giacomo's sweep logs ONE row per affected Pokémon, each naming its host", () => {
    let state = p1Turn2(7);
    state = benchFromDeck(state, "p2", "fix-basic-2");
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = attachBenchFromDeck(state, "p2", 0, "fix-special-2", 1);
    const activeName = topCardOf(state, state.players.p2.active as never)?.name as string;
    const withCard = handFromDeck(state, "p1", "sv02-182", 1);
    const uid = handUid(withCard, "p1", "sv02-182");
    const { state: after, events } = mustApply(withCard, { type: "playTrainer", seat: "p1", uid });

    expect(texts(logFromEvents(events, ctx(after)))).toEqual([
      "played sv02-182",
      `discarded fix-special from Tide's ${activeName}`,
      "discarded fix-special-2 from Tide's fix-basic-2",
    ]);
  });

  it("an ABILITY-origin discard (Mawile) is still the controller's row", () => {
    // The other origin: the row above is an ABILITY_TRIGGERED, not a
    // TRAINER_PLAYED — the attribution must not depend on which one it was.
    let state = p1Turn2(3);
    state = attachFromDeck(state, "p2", "fix-special", 1);
    const victim = topCardOf(state, state.players.p2.active as never)?.name as string;
    const withCard = handFromDeck(state, "p1", "sv03-143", 1);
    const uid = handUid(withCard, "p1", "sv03-143");
    const { state: after, events } = mustApply(withCard, {
      type: "playBasicToBench",
      seat: "p1",
      uid,
    });

    expect(types(events)).toEqual(["POKEMON_BENCHED", "ABILITY_TRIGGERED", "ENERGY_DISCARDED"]);
    const rows = logFromEvents(events, ctx(after));
    expect(texts(rows)).toEqual([
      "benched Mawile",
      "Mawile's Special Eater activated",
      `discarded fix-special from Tide's ${victim}`,
    ]);
    expect(rows.map((e) => (e.kind === "turn" ? null : e.who))).toEqual(["p1", "p1", "p1"]);
  });

  it("a SELF-discard attack cost files under the attacker — victim and actor agree", () => {
    // The case the old "read it off the other seat" rule got backwards: Paldean
    // Tauros' Blaze Dash discards from ITS OWN Active, so `event.seat` is p1 and
    // the row must stay p1. Inferring the actor would have filed it under p2.
    let state = driveSetup(
      5,
      { p1: ATTACK_PARK_DECK, p2: ATTACK_PARK_DECK },
      { first: "p2" },
    );
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "sv02-028");
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = attachFromDeck(state, "p1", "fix-fire-energy", 3);
    const attacker = topCardOf(state, state.players.p1.active as never)?.name as string;

    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    // Three identical prints collapse to one candidate, so the discard resolves
    // inside the attack — no park, one batch.
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "ENERGY_DISCARDED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    const rows = logFromEvents(events, ctx(after));
    // Named by OWNER: "Ember's" (p1) here vs "Tide's" on every hammer row above —
    // the disambiguation a mirror match needs. ONE Energy came off (scope "one"),
    // even though three were attached, so no "×N".
    expect(texts(rows)).toContain(`discarded Fire Energy from Ember's ${attacker}`);
    const discardRow = rows.find(
      (e) => e.kind === "action" && e.segments.some((s) => s.text === "discarded "),
    ) as SeatLogEntry & { kind: "action" };
    expect(discardRow.who).toBe("p1");
  });

  it("a count:'all' batch names EVERY card it discarded, repeats folded into ×N", () => {
    // The first ENERGY_DISCARDED that can carry more than one uid — every earlier
    // producer took exactly one Energy per affected Pokémon. A row that renders
    // only the first card would under-report an attack that stripped three.
    let state = driveSetup(6, { p1: ATTACK_PARK_DECK, p2: ATTACK_PARK_DECK }, { first: "p2" });
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "fix-alldiscard");
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = attachFromDeck(state, "p1", "fix-fire-energy", 2);
    state = attachFromDeck(state, "p1", "fix-energy", 1);

    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const discarded = events.find((e) => e.type === "ENERGY_DISCARDED");
    if (discarded?.type !== "ENERGY_DISCARDED") throw new Error("expected ENERGY_DISCARDED");
    expect(discarded.uids).toHaveLength(3); // one event, three cards

    expect(texts(logFromEvents(events, ctx(after)))).toContain(
      "discarded Fire Energy ×2, fix-energy from Ember's fix-alldiscard",
    );
  });

  it("names a defender the same attack KNOCKED OUT — the host is a uid, not a slot", () => {
    // The regression the attack twins introduced: §8 resolves the whole attack
    // before the §8.1 KO check, so Pincurchin strips Energy off a defender that
    // is Knocked Out in the SAME batch. Re-reading the host from its spot finds
    // an empty Active and prints "Tide's the Active spot" — so the event carries
    // the host UID, which stays resolvable through cardIdByUid forever.
    let state = driveSetup(
      5,
      { p1: ATTACK_DISCARD_DECK, p2: ATTACK_DISCARD_DECK },
      { first: "p2" },
    );
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "sv02-072"); // Pincurchin — 70 damage
    state = setActiveFromDeck(state, "p2", "fix-victim"); // 30 HP — Knocked Out
    state = attachFromDeck(state, "p1", "fix-lightning-energy", 3);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = attachFromDeck(state, "p2", "fix-special", 1);

    const parked = mustApply(state, { type: "attack", seat: "p1", index: 0 }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    const pick = parked.phase.prompt.discardable[0]?.uid as string;
    const { state: after, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });

    expect(types(events).slice(0, 2)).toEqual(["ENERGY_DISCARDED", "KNOCKED_OUT"]);
    expect(after.players.p2.active).toBeNull(); // the slot the old code read
    expect(texts(logFromEvents(events, ctx(after)))).toContain(
      "discarded fix-energy from Tide's fix-victim",
    );
  });

  it("the row is seat-keyed, so a viewer flip re-reads it as the OPPONENT's", () => {
    // The log outlives the hot-seat flip: the same entry must read "you" to the
    // controller and "opponent" to the victim, never the other way round.
    let state = p1Turn2(1);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const withCard = handFromDeck(state, "p1", "fix-hammer", 1);
    const uid = handUid(withCard, "p1", "fix-hammer");
    const { state: after, events } = mustApply(withCard, { type: "playTrainer", seat: "p1", uid });
    const rows = logFromEvents(events, ctx(after));

    expect(viewLogEntries(rows, "p1").map((e) => (e.kind === "turn" ? null : e.who))).toEqual([
      "you",
      "you",
    ]);
    expect(viewLogEntries(rows, "p2").map((e) => (e.kind === "turn" ? null : e.who))).toEqual([
      "opponent",
      "opponent",
    ]);
  });

  it("names the Energy with the ENERGY tone and the host with STRONG", () => {
    // Both names sit next to each other in one row; rendering them identically
    // (GameLog tints `energy` sky, `strong` white) would make the line unreadable.
    let state = p1Turn2(1);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const withCard = handFromDeck(state, "p1", "fix-hammer", 1);
    const uid = handUid(withCard, "p1", "fix-hammer");
    const { state: after, events } = mustApply(withCard, { type: "playTrainer", seat: "p1", uid });
    const discardRow = logFromEvents(events, ctx(after))[1] as SeatLogEntry & { kind: "action" };

    expect(discardRow.segments.map((s) => [s.text, s.tone ?? "default"])).toEqual([
      ["discarded ", "default"],
      ["fix-energy", "energy"],
      [" from ", "default"],
      [expect.any(String), "strong"],
    ]);
  });
});

describe("board-condition cards — the log rides existing rows (M5 board conditions)", () => {
  /** P1's turn 2 on the board-condition deck (P2 went first and passed). */
  function p1Turn2(seed: number): GameState {
    const state = driveSetup(seed, { p1: BOARD_CONDITION_DECK, p2: BOARD_CONDITION_DECK }, { first: "p2" });
    return mustApply(state, { type: "endTurn", seat: "p2" }).state;
  }
  function playFrom(state: GameState, cardId: string) {
    const withCard = handFromDeck(state, "p1", cardId, 1);
    const uid = handUid(withCard, "p1", cardId);
    return mustApply(withCard, { type: "playTrainer", seat: "p1", uid });
  }

  it("pins Falkner's TWO draw rows — the gate is silent, the draws are not", () => {
    // The gate itself emits nothing (a board condition is public — unlike a coin
    // flip, which does get a row). The bonus draw is a SECOND drawCards op, so it
    // shows as its own row; this is what the registry's two-op authoring buys, and
    // merging them into one computed count would silently change the log.
    let state = p1Turn2(3);
    state = handFromDeck(state, "p1", "sv01-167", 1); // Beach Court
    const court = handUid(state, "p1", "sv01-167");
    state = mustApply(state, { type: "playTrainer", seat: "p1", uid: court }).state;
    const { state: after, events } = playFrom(state, "sv02-180");

    expect(texts(logFromEvents(events, ctx(after)))).toEqual([
      "played sv02-180",
      "drew 2 cards",
      "drew 2 cards",
    ]);
    // No coin-flip row and no bespoke "condition met" row — nothing announces the
    // branch, because both players can read the Stadium zone off the board.
    expect(types(events)).toEqual(["TRAINER_PLAYED", "CARDS_DRAWN", "CARDS_DRAWN"]);
  });

  it("Falkner with NO Stadium logs one draw row", () => {
    const { state: after, events } = playFrom(p1Turn2(3), "sv02-180");
    expect(texts(logFromEvents(events, ctx(after)))).toEqual(["played sv02-180", "drew 2 cards"]);
  });

  it("a Grusha into an already-full hand logs the PLAY only — no 'drew 0 cards' row", () => {
    // drawUntilHandSize no-ops at count ≤ 0, so the Supporter is spent with a
    // single row. Honest (the hand size is public and visibly unchanged) and the
    // deliberate choice over a misleading zero-count draw row.
    let state = p1Turn2(3);
    const side = state.players.p1;
    // Energy on the Active → the draw-to-5 arm; keep a hand of 5 so it draws none.
    const energy = side.deck.find((u) => state.cardIdByUid[u] === "fix-energy") as string;
    if (side.active === null) throw new Error("expected an Active");
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...side,
          deck: side.deck.filter((u) => u !== energy),
          active: { ...side.active, energy: [...side.active.energy, energy] },
          hand: side.hand.slice(0, 5),
          discard: [...side.discard, ...side.hand.slice(5)],
        },
      },
    };
    const { state: after, events } = playFrom(state, "sv02-184");
    expect(texts(logFromEvents(events, ctx(after)))).toEqual(["played sv02-184"]);
  });
});
