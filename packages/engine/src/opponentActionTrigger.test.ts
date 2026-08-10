import type { Card } from "@luminous/schema";
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
} from "./testFixtures";

// D319 — THE OPPONENT-ACTION TRIGGER: A SCAN DIRECTION, NOT A TIMING.
//
// THE TWO SENTENCES, transcribed off the remote D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) on 2026-08-10 rather than copied from
// a census bullet — D318's cheapest habit, and the reason the third bullet below
// says something the handoff did not:
//
//   "Whenever your opponent plays a Pokémon from their hand to evolve 1 of their
//    Pokémon, put 4 damage counters on that Pokémon. The effect of Darkest
//    Impulse doesn't stack."
//        — Team Rocket's Ampharos `sv10-074` "Darkest Impulse", 1 legal printing,
//          Stage 2, evolves from Team Rocket's Flaaffy.
//   "Whenever your opponent attaches an Energy card from their hand to 1 of their
//    Pokémon, put 2 damage counters on that Pokémon."
//        — Gengar ex `sv05-104`/`-193` "Gnawing Curse", 2 legal printings.
//
// ── THE FAMILY BOUNDARY, RE-RUN AT MULTIPLE WIDTHS AND FROM BOTH SIDES ───────
//
// 🛑 **THE HANDOFF PRICED THE ATTACH VERB AT ZERO AND IT IS TWO LEGAL PRINTINGS.**
// It named Minun `sv04-061`/`-194` "Buddy Pulse" (`legal_standard = 0`) as the
// rotated twin that made this a FAMILY, and it is — but Buddy Pulse is *"If you
// have Plusle in play,"* + **Gnawing Curse** + the stacking clause, and the
// LEGAL member of that pair is Gengar ex, which no handoff had ever named.
// **A price can be right about a family and wrong about which of its members is
// standing** (D316's finding, arriving from the cheaper direction).
//
// The census, remote D1, all 3,786 rows, one row per column (D283's
// compound-SELECT limit), `SUM(legal_standard)` alongside:
//
//     predicate                                    attacks  abilities  effect
//     instr(col, "Whenever your opponent")            0        8 (8)      0
//     instr(col, "your opponent plays a Pokémon")     0        1 (1)      0
//     instr(col, "on that Pokémon")                  15 (7)   11 (3)     1 (0)
//     instr(col, "1 of their Pokémon")                —        5 (3)      —
//     instr(col, "Each time your opponent")           —        0          —
//     instr(col, "When your opponent")                —        1 (1)      —
//
// ⚠️ **THE ANTECEDENT SIDE IS WIDER THAN THE FAMILY AND THE CONSEQUENT SIDE IS
// EXACTLY IT.** All EIGHT `"Whenever your opponent"` rows are legal, and five of
// them are two other mechanisms: Magcargo `sv05-029` "Lava Zone" (*"…Active
// Pokémon moves to the Bench during their turn, their new Active Pokémon is now
// Burned"* — a third verb with a Special Condition consequent, and the only one
// of the eight whose subject is not a card played from hand) and the ALREADY
// BUILT Trainer-shield pair Fraxure `sv06.5-045`/`-077` + Cetitan ex
// `sv10-065`/`-210`, which are `preventDamage` passives and not triggers at all.
// The `"on that Pokémon"` reading returns the three legal printings this file
// builds and nothing else — the other eight rows are Gardevoir ex ×6 (a
// SELF-inflicted counter on your own attach, no opponent in the sentence) and
// Minun ×2. **So the family is 2 of 2 legal sentences / 3 of 3 legal printings,
// and it CLOSES here.**
//
// ── WHY IT IS A DIRECTION AND NOT A SEVENTH TIMING ──────────────────────────
//
// `TriggerTiming` already spells both MOMENTS these sentences watch — an evolve
// (`onEvolve`, since M4 slice 6) and, after this slice, an attach
// (`onEnergyAttach`). What no member of it spells is WHOSE action, because every
// timing before D319 is a property of the body the event happened TO and is
// found by reading that body's own top card. These two are printed on a card
// across the table. So `opponentAction` rides the ABILITY, `triggersOf`
// partitions on it, and `runWatchedTriggers` sweeps the other seat's board.
//
// ── THE FOUR WAYS A BUILD OF THIS PASSES A SUITE IT SHOULD FAIL ─────────────
//
// ⚠️ **A DIRECTION-BLIND SCAN PUTS FOUR COUNTERS ON THE AMPHAROS ITSELF.** It is
// a Stage 2 carrying an `onEvolve` row, so the SELF scan finds it the moment its
// own controller evolves Flaaffy into it. §3 drives exactly that play.
//
// ⚠️ **A SCAN HUNG ON `evolveOnto` FIRES ON A DECK-SOURCED EVOLVE**, which the
// printed *"from their hand"* forbids. §4 evolves out of the DECK on the same
// board and requires zero counters.
//
// ⚠️ **A `doesNotStack` READ AS A DEFAULT IS GREEN ON AMPHAROS AND WRONG ON
// GENGAR.** Gnawing Curse does not print the clause. §7 puts two of each on one
// board and requires 4 counters from the pair that stacks and 4 (not 8) from the
// pair that does not — the two rows are each other's control.
//
// ⚠️ **A SUBJECT KEYED ON THE ACTION'S TARGET IS WRONG THE MOMENT JET ENERGY
// SWITCHES THE BODY.** §8 attaches Jet Energy `sv02-190` to a BENCHED Pokémon,
// which promotes it, and requires the counters to follow the body.

// ─────────────────────────────────────────────────────────────────────────────
// The printed strings, byte-exact off the D1 rows.
// ─────────────────────────────────────────────────────────────────────────────

const DARKEST_IMPULSE_TEXT =
  "Whenever your opponent plays a Pokémon from their hand to evolve 1 of their Pokémon, put 4 damage counters on that Pokémon. The effect of Darkest Impulse doesn't stack.";
const GNAWING_CURSE_TEXT =
  "Whenever your opponent attaches an Energy card from their hand to 1 of their Pokémon, put 2 damage counters on that Pokémon.";
/** The ROTATED spelling, pinned so the family's boundary stays checkable: it is
    Gnawing Curse with a board condition in front and the stacking clause behind,
    and `legal_standard = 0` is the only reason it is not a row. */
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
/** A Stage 1 with LESS effective HP than the Basic it evolves from — §8.1's
    "a Bravery Charm's Basic-only +50 dropping off" board, built out of printed HP
    instead of a Tool so it needs no second mechanism. Evolving onto a body already
    carrying 50 damage Knocks it Out ON PLACEMENT, which is the one board on which
    the order of the two KO checks in `placeEvolution` is observable. */
const FRAIL = "fix-watch-frail";

// ── the local pool (FIXTURE_POOL is left untouched — D275's idiom, and neither
// `sv05` nor `sv10` is one of `catalogManifest`'s six manifest sets) ──────────

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

/** This suite's own seeded deck (D270's rule). */
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

/** Three seeds, so nothing below rests on one shuffle (D270). */
const SEEDS = [8311, 8317, 8329] as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

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

/** `watcher` holds `watcherIds` (Active first, then Bench); the ACTOR holds a
    plain Basic Active and a plain Basic on the Bench, with the Stage 1 and an
    Energy in hand.

    ⚠️ THE ACTOR'S BENCH BODY IS LOAD-BEARING TWICE — §14.2 makes an empty Bench a
    LOSS the moment an Active leaves, and `benchFromDeck` stamps `turnPlayed: 0`,
    which is what keeps §10's "came into play this turn" ban off every evolve
    below. A refusal here must be the rule under test. */
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
    .filter((e): e is { type: "ABILITY_TRIGGERED"; ability: string } => e.type === "ABILITY_TRIGGERED")
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
    // ⚠️ NOT `optional` — the printed sentence has no "you may", and this is the
    // one trigger in the registry whose consequent is a DOWNSIDE for the seat
    // being asked, so the auto-fire note's "every representative is pure upside"
    // must not be read as covering it.
    expect(impulse?.optional).toBeUndefined();

    const curse = programFor(GENGAR)?.triggered?.[0];
    expect(curse?.name).toBe("Gnawing Curse");
    expect(curse?.trigger).toBe("onEnergyAttach");
    expect(curse?.opponentAction).toBe(true);
    // 🛑 THE ABSENCE IS THE CLAIM — Gnawing Curse does not print the clause, and
    // §7 drives what that costs the board.
    expect(curse?.doesNotStack).toBeUndefined();
    expect(curse?.program).toEqual([{ op: "damageSubject", amount: 20 }]);
    // The reprint is the SAME row object, keyed twice (D313's idiom).
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
      // And the Ampharos really is in play and really does carry the row — so the
      // zero above is a refusal and not a board that never held the card.
      expect(result.state.cardIdByUid[result.state.players.p1.bench[1]?.stack.at(-1) ?? ""]).toBe(
        AMPHAROS,
      );
    }
  });

  it("§4 a DECK-sourced evolve does not fire it — the printed 'from their hand'", () => {
    for (const seed of SEEDS) {
      // The actor's Active is a Digger whose text-derived attack evolves a body out
      // of the DECK. That route calls `evolveOnto` directly, one rung below
      // `placeEvolution`, so the source-zone clause is answered by WHERE the scan
      // sits — this rung is what says so.
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
      // §8.1 — the sweep stages the Prize as a DECISION (the watcher picks), so it
      // is the PHASE that is asserted rather than a prize count that has not moved
      // yet: the seat being asked is the one whose Ability placed the counters, and
      // the actor's turn is queued to resume behind it.
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
      // \u{1F6D1} THE ROW THIS RUNG EXISTS FOR IS `D306-evolve-ko-reads-the-pre-evolution-body`,
      // AND D319's OWN ADDITION IS WHAT BROKE IT. `placeEvolution` has carried a
      // §8.1 check since D306 — evolution can LOWER effective max HP, so a
      // carried-damage body can die the instant it evolves — and D319 put a SECOND
      // KO sweep after the opponent scan. The second one catches the same lethal
      // body, so the first one's absence stopped being observable as a KO and the
      // pre-existing mutant SURVIVED the full sweep. **An addition broke a row it
      // never touched** (D317's finding, from a third direction).
      //
      // What still separates them is what the printed rules separate: a Pokémon
      // Knocked Out ON PLACEMENT has left play, so the opponent's trigger has
      // nothing to put counters on and must not fire at all. That is asserted
      // here, on a board that has a watcher — which is what the two-check order
      // means and what no KO-outcome assertion can see.
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
      // §3's twin on the other verb, and it is not a formality: the two halves are
      // gated by ONE field on ONE partition, so a build that read the direction in
      // the evolve scan and forgot it in the attach scan is green on everything
      // above. The Gengar's own seat attaches an Energy to its own Bench.
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
