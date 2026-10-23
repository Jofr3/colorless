import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, programFor } from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setDamage,
  must,
  firstBasicInHand,
} from "./testFixtures";

// ─────────────────────────────────────────────────────────────────────────────
// The printed strings, byte-exact off the D1 rows.
// ─────────────────────────────────────────────────────────────────────────────

const DARKEST_IMPULSE_TEXT =
  "Whenever your opponent plays a Pokémon from their hand to evolve 1 of their Pokémon, put 4 damage counters on that Pokémon. The effect of Darkest Impulse doesn't stack.";
const GNAWING_CURSE_TEXT =
  "Whenever your opponent attaches an Energy card from their hand to 1 of their Pokémon, put 2 damage counters on that Pokémon.";
const BUDDY_PULSE_TEXT =
  "If you have Plusle in play, whenever your opponent attaches an Energy card from their hand to 1 of their Pokémon, put 2 damage counters on that Pokémon. The effect of Buddy Pulse doesn't stack.";

const AMPHAROS = "sv10-074";
const GENGAR = "sv05-104";
const GENGAR_REPRINT = "sv05-193";
const JET = "sv02-190";
/** Team Rocket's Flaaffy — the body Ampharos evolves FROM, so §3 can make its own
    controller perform the very act the Ability watches. */
const FLAAFFY = "fix-tr-flaaffy";
/** The actor's Basic and its Stage 1 — the evolve the opponent watches. */
const BASIC = "fix-basic-1";
const STAGE1 = "fix-stage1";
/** A body with NO Ability at all: every "the trigger fired" line below passes
    just as happily on a build that put counters down on every evolve. */
const PLAIN = "fix-watch-plain";
/** The DECK-sourced evolve, §4's control — a text-derived attack, so the effect
    reaches `evolveOnto` one rung BELOW `placeEvolution` and the "from their hand"
    gate must hold without a line being written for it. */
const DIGGER = "fix-watch-digger";
const DIGGER_TEXT =
  "Search your deck for a card that evolves from 1 of your Pokémon and put it onto that Pokémon. Then, shuffle your deck.";
const FRAIL = "fix-watch-frail";

function ampharos(id: string): Card {
  return battler(id, {
    name: "Team Rocket's Ampharos",
    hp: 160,
    retreat: 2,
    types: ["Darkness"],
    stage: "Stage2",
    evolveFrom: "Team Rocket's Flaaffy",
    abilities: [{ type: "Ability", name: "Darkest Impulse", effect: DARKEST_IMPULSE_TEXT }],
  });
}

function gengar(id: string): Card {
  return battler(id, {
    name: "Gengar ex",
    hp: 310,
    retreat: 2,
    types: ["Psychic"],
    stage: "Stage2",
    evolveFrom: "Haunter",
    abilities: [{ type: "Ability", name: "Gnawing Curse", effect: GNAWING_CURSE_TEXT }],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  [AMPHAROS]: ampharos(AMPHAROS),
  [GENGAR]: gengar(GENGAR),
  [GENGAR_REPRINT]: gengar(GENGAR_REPRINT),
  [FLAAFFY]: battler(FLAAFFY, {
    name: "Team Rocket's Flaaffy",
    hp: 90,
    retreat: 1,
    types: ["Darkness"],
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
  }),
  [PLAIN]: battler(PLAIN, {
    name: "Plain Watcher",
    hp: 200,
    retreat: 1,
    types: ["Psychic"],
    attacks: [{ name: "Nothing At All", cost: ["Psychic"], damage: "30" }],
  }),
  [FRAIL]: battler(FRAIL, {
    name: "Frail Evolution",
    hp: 50,
    retreat: 1,
    types: ["Colorless"],
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
  }),
  [DIGGER]: battler(DIGGER, {
    name: "Digger",
    hp: 200,
    retreat: 1,
    types: ["Psychic"],
    attacks: [{ name: "Dig Up", cost: ["Psychic"], damage: "10", effect: DIGGER_TEXT }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const WATCH_DECK = deckOf({
  [AMPHAROS]: 4,
  [GENGAR]: 4,
  [GENGAR_REPRINT]: 4,
  [FLAAFFY]: 4,
  [PLAIN]: 4,
  [DIGGER]: 4,
  [STAGE1]: 4,
  [FRAIL]: 4,
  [JET]: 4,
  [BASIC]: 12,
  "fix-psychic-energy": 12,
});

const SEEDS = [8311, 8317, 8329] as const;

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: WATCH_DECK, p2: WATCH_DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

function board(seed: number, first: Seat, watcher: Seat, watcherIds: readonly string[]): GameState {
  let state = localSetup(seed, first);
  const actor = watcher === "p1" ? "p2" : "p1";
  state = setActiveFromDeck(state, watcher, watcherIds[0] ?? PLAIN);
  state = clearBench(state, watcher);
  state = benchFromDeck(state, watcher, BASIC);
  for (const id of watcherIds.slice(1)) state = benchFromDeck(state, watcher, id);
  state = setActiveFromDeck(state, actor, BASIC);
  state = clearBench(state, actor);
  state = benchFromDeck(state, actor, BASIC);
  state = handFromDeck(state, actor, STAGE1, 1);
  state = handFromDeck(state, actor, JET, 1);
  state = handFromDeck(state, actor, "fix-psychic-energy", 1);
  return state;
}

/** Walk the clock so `seat` moves on turn 3 or later — §4 bans an evolve on a
    seat's own first turn, so a suite that stopped earlier would read
    `FIRST_TURN_EVOLVE` everywhere and call it an absent trigger. */
function turnOf(state: GameState, seat: Seat): GameState {
  let next = state;
  for (let i = 0; i < 12; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    if (next.phase.seat === seat && next.turn >= 3) return next;
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

/** Evolve the actor's body at `spot` with `cardId` out of hand. */
function evolve(
  state: GameState,
  seat: Seat,
  cardId: string,
  spot: { spot: "active" } | { spot: "bench"; index: number },
): ReturnType<typeof applyAction> {
  return applyAction(deepFreeze(state), {
    type: "evolve",
    seat,
    uid: handUid(state, seat, cardId),
    target: spot,
  });
}

/** Attach `cardId` from the actor's hand onto `spot`. */
function attach(
  state: GameState,
  seat: Seat,
  cardId: string,
  spot: { spot: "active" } | { spot: "bench"; index: number },
): ReturnType<typeof applyAction> {
  return applyAction(deepFreeze(state), {
    type: "attachEnergy",
    seat,
    uid: handUid(state, seat, cardId),
    target: spot,
  });
}

function damageAt(state: GameState, seat: Seat, index: number | "active"): number {
  const side = state.players[seat];
  if (index === "active") return side.active?.damage ?? -1;
  return side.bench[index]?.damage ?? -1;
}

function triggeredNames(events: readonly { type: string }[]): string[] {
  return events
    .filter(
      (e): e is { type: "ABILITY_TRIGGERED"; ability: string } => e.type === "ABILITY_TRIGGERED",
    )
    .map((e) => e.ability);
}

describe("D319 — the opponent-action trigger", () => {
  it("§1 the two registry rows carry the sentence's clauses in three separate fields", () => {
    const impulse = programFor(AMPHAROS)?.triggered?.[0];
    expect(impulse?.name).toBe("Darkest Impulse");
    expect(impulse?.trigger).toBe("onEvolve");
    expect(impulse?.opponentAction).toBe(true);
    expect(impulse?.doesNotStack).toBe(true);
    expect(impulse?.program).toEqual([{ op: "damageSubject", amount: 40 }]);

    const curse = programFor(GENGAR)?.triggered?.[0];
    expect(curse?.name).toBe("Gnawing Curse");
    expect(curse?.trigger).toBe("onEnergyAttach");
    expect(curse?.opponentAction).toBe(true);
    expect(curse?.doesNotStack).toBeUndefined();
    expect(curse?.program).toEqual([{ op: "damageSubject", amount: 20 }]);
    expect(programFor(GENGAR_REPRINT)).toBe(programFor(GENGAR));

    // The counters differ and the direction does not — the whole difference
    // between the two printed sentences, asserted rather than described.
    expect(DARKEST_IMPULSE_TEXT).toContain("put 4 damage counters on that Pokémon");
    expect(GNAWING_CURSE_TEXT).toContain("put 2 damage counters on that Pokémon");
    expect(DARKEST_IMPULSE_TEXT).toContain("The effect of Darkest Impulse doesn't stack.");
    expect(GNAWING_CURSE_TEXT).not.toContain("doesn't stack");
    // The rotated member: Gnawing Curse with a gate in front and the clause behind.
    expect(BUDDY_PULSE_TEXT).toContain(
      "attaches an Energy card from their hand to 1 of their Pokémon, put 2 damage counters on that Pokémon.",
    );
    expect(BUDDY_PULSE_TEXT.startsWith("If you have Plusle in play,")).toBe(true);
  });

  it("§2 the evolve verb fires ACROSS THE TABLE, on the Bench and on the Active", () => {
    for (const seed of SEEDS) {
      for (const spot of ["active", "bench"] as const) {
        let state = board(seed, "p1", "p1", [AMPHAROS]);
        state = turnOf(state, "p2");
        const before = damageAt(state, "p2", spot === "active" ? "active" : 0);
        const result = evolve(
          state,
          "p2",
          STAGE1,
          spot === "active" ? { spot: "active" } : { spot: "bench", index: 0 },
        );
        expect(result.ok, `${seed}/${spot}`).toBe(true);
        if (!result.ok) return;
        expect(damageAt(result.state, "p2", spot === "active" ? "active" : 0)).toBe(before + 40);
        expect(triggeredNames(result.events)).toEqual(["Darkest Impulse"]);
        // The watcher's own board is untouched: the counters go across.
        expect(damageAt(result.state, "p1", "active")).toBe(0);
      }
    }
  });

  it("§2b a board with NO watcher places nothing — the CONTROL every §2 line needs", () => {
    for (const seed of SEEDS) {
      let state = board(seed, "p1", "p1", [PLAIN]);
      state = turnOf(state, "p2");
      const result = evolve(state, "p2", STAGE1, { spot: "bench", index: 0 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(damageAt(result.state, "p2", 0)).toBe(0);
      expect(triggeredNames(result.events)).toEqual([]);
    }
  });

  it("§3 the SELF scan does not fire it — Ampharos's own controller evolves into it", () => {
    for (const seed of SEEDS) {
      // The watcher's OWN Bench carries Team Rocket's Flaaffy, and Ampharos is in
      // the watcher's hand: the very act the Ability names, performed by the seat
      // that owns it. A direction-blind build puts 4 counters on the Ampharos.
      let state = board(seed, "p1", "p1", [PLAIN, FLAAFFY]);
      state = handFromDeck(state, "p1", AMPHAROS, 1);
      state = turnOf(state, "p1");
      const result = evolve(state, "p1", AMPHAROS, { spot: "bench", index: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(damageAt(result.state, "p1", 1)).toBe(0);
      expect(triggeredNames(result.events)).toEqual([]);
      expect(result.state.cardIdByUid[result.state.players.p1.bench[1]?.stack.at(-1) ?? ""]).toBe(
        AMPHAROS,
      );
    }
  });

  it("§4 a DECK-sourced evolve does not fire it — the printed 'from their hand'", () => {
    for (const seed of SEEDS) {
      let state = board(seed, "p1", "p1", [AMPHAROS]);
      state = setActiveFromDeck(state, "p2", DIGGER);
      state = turnOf(state, "p2");
      state = must(
        applyAction(state, {
          type: "attachEnergy",
          seat: "p2",
          uid: handUid(state, "p2", "fix-psychic-energy"),
          target: { spot: "active" },
        }),
      );
      const result = applyAction(deepFreeze(state), { type: "attack", seat: "p2", index: 0 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The bench body evolved out of the deck (or nothing did, on a deck with no
      // match) — either way NO counters, and no Darkest Impulse in the log.
      expect(triggeredNames(result.events)).not.toContain("Darkest Impulse");
      for (let i = 0; i < result.state.players.p2.bench.length; i += 1) {
        expect(damageAt(result.state, "p2", i)).toBe(0);
      }
    }
  });

  it("§5 four counters can KNOCK OUT the body that just evolved, mid-turn", () => {
    for (const seed of SEEDS) {
      let state = board(seed, "p1", "p1", [AMPHAROS]);
      state = turnOf(state, "p2");
      // `fix-stage1` is 90 HP and §10 carries damage over, so 50 + 40 is lethal —
      // and the §8.1 evolve-below-HP check ahead of the scan is NOT what fires
      // (50 < 90), which is the distinction this board exists to draw.
      state = setDamage(state, "p2", 50);
      const result = evolve(state, "p2", STAGE1, { spot: "active" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.events.some((e) => e.type === "KNOCKED_OUT")).toBe(true);
      expect(result.state.phase.kind).toBe("ko:takePrizes");
      if (result.state.phase.kind !== "ko:takePrizes") return;
      expect(result.state.phase.seat).toBe("p1");
      expect(result.state.pending.some((s) => s.kind === "resumeTurn")).toBe(true);
    }
  });

  it("§6 'doesn't stack' — two Ampharos are ONE firing", () => {
    for (const seed of SEEDS) {
      let state = board(seed, "p1", "p1", [AMPHAROS, AMPHAROS]);
      state = turnOf(state, "p2");
      const result = evolve(state, "p2", STAGE1, { spot: "bench", index: 0 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(damageAt(result.state, "p2", 0)).toBe(40);
      expect(triggeredNames(result.events)).toEqual(["Darkest Impulse"]);
    }
  });

  it("§7 the attach verb fires, and two Gengar ex STACK because the clause is absent", () => {
    for (const seed of SEEDS) {
      // One Gengar: 2 counters on the body the Energy landed on.
      let one = board(seed, "p1", "p1", [GENGAR]);
      one = turnOf(one, "p2");
      const single = attach(one, "p2", "fix-psychic-energy", { spot: "bench", index: 0 });
      expect(single.ok).toBe(true);
      if (!single.ok) return;
      expect(damageAt(single.state, "p2", 0)).toBe(20);
      expect(triggeredNames(single.events)).toEqual(["Gnawing Curse"]);

      // Two Gengar — the REPRINT is a different id and the SAME sentence, which is
      // exactly the board a `doesNotStack` read as a default gets wrong.
      let two = board(seed, "p1", "p1", [GENGAR, GENGAR_REPRINT]);
      two = turnOf(two, "p2");
      const pair = attach(two, "p2", "fix-psychic-energy", { spot: "bench", index: 0 });
      expect(pair.ok).toBe(true);
      if (!pair.ok) return;
      expect(damageAt(pair.state, "p2", 0)).toBe(40);
      expect(triggeredNames(pair.events)).toEqual(["Gnawing Curse", "Gnawing Curse"]);
    }
  });

  it("§8 the subject follows the BODY, not the bench index — Jet Energy", () => {
    for (const seed of SEEDS) {
      let state = board(seed, "p1", "p1", [GENGAR]);
      state = turnOf(state, "p2");
      const benchUid = state.players.p2.bench[0]?.stack.at(-1);
      const result = attach(state, "p2", JET, { spot: "bench", index: 0 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // §6.1 — Jet Energy promoted the benched body it landed on, so the bench
      // index now names a DIFFERENT Pokémon. The counters are on the body.
      expect(result.state.players.p2.active?.stack.at(-1)).toBe(benchUid);
      expect(damageAt(result.state, "p2", "active")).toBe(20);
      expect(damageAt(result.state, "p2", 0)).toBe(0);
    }
  });

  it("§5b a body Knocked Out BY EVOLVING is never watched — the ORDER of the two KO checks", () => {
    for (const seed of SEEDS) {
      let state = board(seed, "p1", "p1", [AMPHAROS]);
      state = handFromDeck(state, "p2", FRAIL, 1);
      state = turnOf(state, "p2");
      state = setDamage(state, "p2", 50);
      const result = evolve(state, "p2", FRAIL, { spot: "active" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.events.some((e) => e.type === "KNOCKED_OUT")).toBe(true);
      expect(triggeredNames(result.events)).not.toContain("Darkest Impulse");
      expect(triggeredNames(result.events)).toEqual([]);
      expect(result.state.phase.kind).toBe("ko:takePrizes");
    }
  });

  it("§9 the attach half's direction — a Gengar's OWN controller attaching fires nothing", () => {
    for (const seed of SEEDS) {
      let state = board(seed, "p1", "p1", [GENGAR]);
      state = handFromDeck(state, "p1", "fix-psychic-energy", 1);
      state = turnOf(state, "p1");
      const result = attach(state, "p1", "fix-psychic-energy", { spot: "bench", index: 0 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(damageAt(result.state, "p1", 0)).toBe(0);
      expect(damageAt(result.state, "p1", "active")).toBe(0);
      expect(triggeredNames(result.events)).toEqual([]);
    }
  });
});
