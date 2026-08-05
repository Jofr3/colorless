import { describe, expect, it } from "vitest";
import { applyAction, effectiveMaxHp, effectiveRetreatCost, programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  CHOICE_DECK,
  DEFIANCE_DECK,
  STADIUM_TOOL_DECK,
  activeUid,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
  setPrizes,
  types,
} from "./testFixtures";

// M4 slice 3 — the persistent-zone Trainers: the shared Stadium zone (§7.3)
// with its replace/same-name/one-per-turn rules, Pokémon Tool attachment
// (§7.4), and the CONTINUOUS effects both feed into the pipeline
// (continuous.ts): Beach Court's retreat discount, League HQ's attack-cost
// surcharge, Vitality Band's pre-W/R damage bonus, Bravery Charm's Basic HP
// bonus — plus the KO/evolution interactions of a card that stays in play.

/** Setup then open P1's turn 2 (P2 went first, passed) — no §4 restrictions
    apply to P1's play. */
function p1Turn2(seed: number): GameState {
  const state = driveSetup(seed, { p1: STADIUM_TOOL_DECK, p2: STADIUM_TOOL_DECK }, { first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}


describe("playTrainer — Stadiums (§7.3)", () => {
  it("moves the card into the shared zone, not the discard", () => {
    let state = p1Turn2(1);
    state = handFromDeck(state, "p1", "sv01-167", 1);
    const uid = handUid(state, "p1", "sv01-167");
    const { state: next, events } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(next.stadium).toEqual({ uid, owner: "p1" });
    expect(next.players.p1.hand).not.toContain(uid);
    expect(next.players.p1.discard).not.toContain(uid);
    expect(next.allowances.stadiumPlayed).toBe(true);
    const played = find(events, "TRAINER_PLAYED");
    expect(played?.trainerType).toBe("Stadium");
    // Playing a Stadium is not an attack — the turn continues.
    expect(next.phase.kind).toBe("turn:action");
  });

  it("is allowed on the going-first player's turn 1 (§4 bans only Supporters and attacking)", () => {
    // p1 goes first: turn 1 is theirs.
    let state = driveSetup(2, { p1: STADIUM_TOOL_DECK, p2: STADIUM_TOOL_DECK }, { first: "p1" });
    state = handFromDeck(state, "p1", "sv01-167", 1);
    const uid = handUid(state, "p1", "sv01-167");
    const { state: next } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(next.stadium?.uid).toBe(uid);
  });

  it("rejects a second Stadium play in the same turn (§7.3)", () => {
    let state = p1Turn2(1);
    state = handFromDeck(state, "p1", "sv01-167", 1);
    const first = handUid(state, "p1", "sv01-167");
    state = must(applyAction(state, { type: "playTrainer", seat: "p1", uid: first }));
    state = handFromDeck(state, "p1", "sv03-192", 1);
    const second = handUid(state, "p1", "sv03-192");
    expectErr(state, { type: "playTrainer", seat: "p1", uid: second }, "STADIUM_ALREADY_PLAYED");
  });

  it("rejects a same-named Stadium while one is in play (§7.3)", () => {
    let state = p1Turn2(1);
    state = handFromDeck(state, "p1", "sv01-167", 1);
    const first = handUid(state, "p1", "sv01-167");
    state = must(applyAction(state, { type: "playTrainer", seat: "p1", uid: first }));
    // Two turns pass; p1 tries a SECOND Beach Court copy on their next turn.
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = handFromDeck(state, "p1", "sv01-167", 1);
    const second = handUid(state, "p1", "sv01-167");
    expectErr(state, { type: "playTrainer", seat: "p1", uid: second }, "STADIUM_SAME_NAME");
  });

  it("a different-named Stadium replaces it — the old one to its OWNER's discard", () => {
    let state = p1Turn2(1);
    state = handFromDeck(state, "p1", "sv01-167", 1);
    const beachCourt = handUid(state, "p1", "sv01-167");
    state = must(applyAction(state, { type: "playTrainer", seat: "p1", uid: beachCourt }));
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    // P2's turn: League HQ replaces P1's Beach Court.
    state = handFromDeck(state, "p2", "sv03-192", 1);
    const leagueHq = handUid(state, "p2", "sv03-192");
    const { state: next, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: leagueHq,
    });
    expect(next.stadium).toEqual({ uid: leagueHq, owner: "p2" });
    expect(next.players.p1.discard).toContain(beachCourt);
    expect(next.players.p2.discard).not.toContain(beachCourt);
    const discarded = find(events, "STADIUM_DISCARDED");
    expect(discarded).toEqual({ type: "STADIUM_DISCARDED", seat: "p1", uid: beachCourt });
    expect(types(events)).toEqual(["TRAINER_PLAYED", "STADIUM_DISCARDED"]);
  });
});

describe("Beach Court — Basic retreat discount (continuous, both players)", () => {
  it("a Basic with retreat 1 retreats free while it is in play — for either seat", () => {
    // fix-attacker retreat 1 as both Actives.
    let state = p1Turn2(3);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = setActiveFromDeck(state, "p2", "fix-attacker");
    // Without the Stadium the free retreat is a cost mismatch.
    expectErr(
      state,
      { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 },
      "RETREAT_COST_MISMATCH",
    );
    state = handFromDeck(state, "p1", "sv01-167", 1);
    const uid = handUid(state, "p1", "sv01-167");
    state = must(applyAction(state, { type: "playTrainer", seat: "p1", uid }));
    const { state: afterRetreat, events } = mustApply(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy: [],
      promoteBenchIndex: 0,
    });
    expect(find(events, "RETREATED")?.discardedEnergy).toEqual([]);
    // The discount is CONTINUOUS and SHARED: the opponent's Basic also
    // retreats free on their own turn.
    let p2State = must(applyAction(afterRetreat, { type: "endTurn", seat: "p1" }));
    expect(p2State.phase.kind).toBe("turn:action");
    p2State = must(
      applyAction(p2State, { type: "retreat", seat: "p2", discardEnergy: [], promoteBenchIndex: 0 }),
    );
    expect(p2State.players.p2.bench.length).toBeGreaterThan(0);
  });

  it("does not discount a non-Basic (effectiveRetreatCost)", () => {
    let state = p1Turn2(3);
    state = handFromDeck(state, "p1", "sv01-167", 1);
    const uid = handUid(state, "p1", "sv01-167");
    state = must(applyAction(state, { type: "playTrainer", seat: "p1", uid }));
    // A Stage 1 stack (test surgery puts the evolution card straight into
    // play — legal-shaped for reading costs).
    state = setActiveFromDeck(state, "p1", "fix-stage1");
    const active = state.players.p1.active;
    expect(active).not.toBeNull();
    if (active === null) throw new Error("unreachable");
    // fix-stage1 prints retreat 2 and is not a Basic — no discount.
    expect(effectiveRetreatCost(state, active)).toBe(2);
  });
});

describe("Pokémon League Headquarters — Basic attack-cost surcharge", () => {
  it("an exactly-paid Basic attack becomes unpayable, one more energy re-pays it", () => {
    let state = p1Turn2(4);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = setActiveFromDeck(state, "p2", "fix-wall");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = handFromDeck(state, "p1", "sv03-192", 1);
    const uid = handUid(state, "p1", "sv03-192");
    state = must(applyAction(state, { type: "playTrainer", seat: "p1", uid }));
    // Bite costs [C]; 1 energy paid it before, the surcharge asks [C, C].
    expectErr(state, { type: "attack", seat: "p1", index: 0 }, "ATTACK_COST_UNMET");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });
});

describe("attachTool (§7.4)", () => {
  it("attaches from hand to the Active — no allowance consumed, uncapped per turn", () => {
    let state = p1Turn2(5);
    // Displacing the Active benches it — a second Pokémon for the second Tool.
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    state = handFromDeck(state, "p1", "sv01-197", 1);
    const band = handUid(state, "p1", "sv01-197");
    const { state: next, events } = mustApply(state, {
      type: "attachTool",
      seat: "p1",
      uid: band,
      target: { spot: "active" },
    });
    expect(next.players.p1.active?.tools).toEqual([band]);
    expect(next.players.p1.hand).not.toContain(band);
    expect(next.allowances.energyAttached).toBe(false);
    expect(find(events, "TOOL_ATTACHED")).toEqual({
      type: "TOOL_ATTACHED",
      seat: "p1",
      uid: band,
      target: { spot: "active" },
    });
    // A SECOND Tool the same turn is fine — on a different Pokémon.
    expect(next.players.p1.bench.length).toBeGreaterThan(0);
    const state2 = handFromDeck(next, "p1", "sv02-173", 1);
    const charm = handUid(state2, "p1", "sv02-173");
    const { state: after } = mustApply(state2, {
      type: "attachTool",
      seat: "p1",
      uid: charm,
      target: { spot: "bench", index: 0 },
    });
    expect(after.players.p1.bench[0]?.tools).toEqual([charm]);
  });

  it("one Tool per Pokémon (§7.4)", () => {
    let state = p1Turn2(5);
    state = handFromDeck(state, "p1", "sv01-197", 1);
    const band = handUid(state, "p1", "sv01-197");
    state = must(
      applyAction(state, { type: "attachTool", seat: "p1", uid: band, target: { spot: "active" } }),
    );
    state = handFromDeck(state, "p1", "sv02-173", 1);
    const charm = handUid(state, "p1", "sv02-173");
    expectErr(
      state,
      { type: "attachTool", seat: "p1", uid: charm, target: { spot: "active" } },
      "TOOL_ALREADY_ATTACHED",
    );
  });

  it("rejects non-Tools, unauthored Tools and bad wire targets", () => {
    let state = p1Turn2(5);
    // An Energy card is not a Tool.
    const energy = handUid(state, "p1", "fix-energy");
    expectErr(
      state,
      { type: "attachTool", seat: "p1", uid: energy, target: { spot: "active" } },
      "NOT_A_TOOL",
    );
    // Unauthored Tool: loud, not a do-nothing attachment.
    state = handFromDeck(state, "p1", "fix-tool", 1);
    const dud = handUid(state, "p1", "fix-tool");
    expectErr(
      state,
      { type: "attachTool", seat: "p1", uid: dud, target: { spot: "active" } },
      "TRAINER_NOT_SIMULATED",
    );
    // Wire shapes: null target; a string bench index; an empty slot.
    state = handFromDeck(state, "p1", "sv01-197", 1);
    const band = handUid(state, "p1", "sv01-197");
    expectErr(
      state,
      {
        type: "attachTool",
        seat: "p1",
        uid: band,
        target: null as unknown as { spot: "active" },
      },
      "BAD_TARGET",
    );
    expectErr(
      state,
      {
        type: "attachTool",
        seat: "p1",
        uid: band,
        target: { spot: "bench", index: "0" as unknown as number },
      },
      "BAD_BENCH_INDEX",
    );
    expectErr(
      state,
      { type: "attachTool", seat: "p1", uid: band, target: { spot: "bench", index: 4 } },
      "BAD_BENCH_INDEX",
    );
    // And a Tool routed through playTrainer is redirected, not played.
    expectErr(state, { type: "playTrainer", seat: "p1", uid: band }, "TRAINER_TYPE_UNSUPPORTED");
  });
});

describe("Vitality Band — +10 damage before Weakness/Resistance", () => {
  it("adds to the base, and Weakness doubles the SUM", () => {
    let state = p1Turn2(6);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = setActiveFromDeck(state, "p2", "fix-wall");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = handFromDeck(state, "p1", "sv01-197", 1);
    const band = handUid(state, "p1", "sv01-197");
    state = must(
      applyAction(state, { type: "attachTool", seat: "p1", uid: band, target: { spot: "active" } }),
    );
    // Plain wall: 30 + 10 = 40.
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt?.base).toBe(30);
    expect(dealt?.bonus).toBe(10);
    expect(dealt?.dealt).toBe(40);
  });

  it("(30 + 10) × 2 = 80 against a Fire-weak defender — the before-W/R pin", () => {
    let state = p1Turn2(6);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = setActiveFromDeck(state, "p2", "fix-weak");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = handFromDeck(state, "p1", "sv01-197", 1);
    const band = handUid(state, "p1", "sv01-197");
    state = must(
      applyAction(state, { type: "attachTool", seat: "p1", uid: band, target: { spot: "active" } }),
    );
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const dealt = find(events, "DAMAGE_DEALT");
    // A wrong after-W/R bonus would read 30 × 2 + 10 = 70.
    expect(dealt?.dealt).toBe(80);
  });
});

describe("Defiance Band — a CONDITIONAL +30 before W/R (D40's third consumer)", () => {
  /** DEFIANCE_DECK (not STADIUM_TOOL_DECK) so this suite never perturbs the
      shared deck's fragile opening-hand seeds. Opens P1's turn 2 (P2 passed). */
  function defTurn2(seed: number): GameState {
    const state = driveSetup(seed, { p1: DEFIANCE_DECK, p2: DEFIANCE_DECK }, { first: "p2" });
    return must(applyAction(state, { type: "endTurn", seat: "p2" }));
  }

  /** Attacker + Defiance Band attached, ready to attack. `p2Prizes` sets the
      opponent's remaining Prizes: 6 (level) leaves the condition FALSE, 4 (P2
      ahead on prizes taken) makes P1 BEHIND, so `morePrizesThanOpponent` holds. */
  function armed(defenderId: string, p2Prizes: number): GameState {
    let state = defTurn2(6);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = setActiveFromDeck(state, "p2", defenderId);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = handFromDeck(state, "p1", "sv01-169", 1);
    const band = handUid(state, "p1", "sv01-169");
    state = must(
      applyAction(state, { type: "attachTool", seat: "p1", uid: band, target: { spot: "active" } }),
    );
    return setPrizes(state, "p2", p2Prizes);
  }

  it("is registered as a conditional pre-W/R bonus keyed on morePrizesThanOpponent", () => {
    expect(programFor("sv01-169")?.passive?.damageBonusBeforeWRIf).toEqual({
      amount: 30,
      cond: { kind: "morePrizesThanOpponent" },
    });
  });

  it("adds 30 while the holder is BEHIND on prizes (P1 6 vs P2 4)", () => {
    const state = armed("fix-wall", 4);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt?.base).toBe(30);
    expect(dealt?.bonus).toBe(30); // 30 + 30 = 60
    expect(dealt?.dealt).toBe(60);
  });

  it("adds NOTHING when the prize counts are level (the condition is strict)", () => {
    const state = armed("fix-wall", 6);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt?.base).toBe(30);
    expect(dealt?.bonus).toBeUndefined(); // no bonus row emitted
    expect(dealt?.dealt).toBe(30);
  });

  it("(30 + 30) × 2 = 120 against a Fire-weak defender — the before-W/R pin", () => {
    const state = armed("fix-weak", 4);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const dealt = find(events, "DAMAGE_DEALT");
    // A wrong after-W/R bonus would read 30 × 2 + 30 = 90.
    expect(dealt?.dealt).toBe(120);
  });
});

describe("Choice Belt — a TARGET-gated +30 before W/R (the DEFENDER's suffix)", () => {
  /** CHOICE_DECK (not STADIUM_TOOL_DECK), the DEFIANCE_DECK reasoning again:
      the shared 60 is fixed-size, so swapping a card into it reshuffles every
      seed and breaks the fragile opening-hand tests. Opens P1's turn 2. */
  function choiceTurn2(seed: number): GameState {
    const state = driveSetup(seed, { p1: CHOICE_DECK, p2: CHOICE_DECK }, { first: "p2" });
    return must(applyAction(state, { type: "endTurn", seat: "p2" }));
  }

  /** P1's fix-attacker wearing Choice Belt and energised for Bite ([C] 30),
      facing `defenderId` as P2's Active. Unlike Defiance Band there is no board
      state to set: the gate reads the defender, so the defender IS the input. */
  function armed(defenderId: string): GameState {
    let state = choiceTurn2(6);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = setActiveFromDeck(state, "p2", defenderId);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = handFromDeck(state, "p1", "sv02-176", 1);
    const belt = handUid(state, "p1", "sv02-176");
    return must(
      applyAction(state, { type: "attachTool", seat: "p1", uid: belt, target: { spot: "active" } }),
    );
  }

  it("is registered as a target-conditional pre-W/R bonus keyed on the V suffix", () => {
    expect(programFor("sv02-176")?.passive?.damageBonusBeforeWRIfTarget).toEqual({
      amount: 30,
      targetSuffix: "V",
    });
  });

  it("adds 30 against a defending Pokémon V", () => {
    const { events } = mustApply(armed("fix-pokemon-v"), { type: "attack", seat: "p1", index: 0 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt?.base).toBe(30);
    expect(dealt?.bonus).toBe(30); // 30 + 30 = 60
    expect(dealt?.dealt).toBe(60);
  });

  it("adds NOTHING against a plain Pokémon — the gate reads the DEFENDER, not the holder", () => {
    const { events } = mustApply(armed("fix-wall"), { type: "attack", seat: "p1", index: 0 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt?.base).toBe(30);
    expect(dealt?.bonus).toBeUndefined(); // no bonus row emitted
    expect(dealt?.dealt).toBe(30);
  });

  it("adds NOTHING against a Pokémon VMAX — 'V' is matched literally", () => {
    // The whole point of reading the suffix as a whole marker: a VMAX's name
    // ends in "VMAX", never " V", and Choice Belt does not boost against it.
    const { events } = mustApply(armed("fix-pokemon-vmax"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt?.bonus).toBeUndefined();
    expect(dealt?.dealt).toBe(30);
  });

  it("(30 + 30) × 2 = 120 against a Fire-weak V — the before-W/R pin", () => {
    const { events } = mustApply(armed("fix-pokemon-v-weak"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    const dealt = find(events, "DAMAGE_DEALT");
    // A wrong after-W/R fold would read 30 × 2 + 30 = 90.
    expect(dealt?.dealt).toBe(120);
  });
});

describe("Bravery Charm — +50 HP while the holder's top card is a Basic", () => {
  it("raises effectiveMaxHp and turns a lethal hit survivable", () => {
    let state = p1Turn2(7);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = setActiveFromDeck(state, "p2", "fix-victim"); // 30 HP — Bite OHKOs it bare
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = handFromDeck(state, "p2", "sv02-173", 1);
    const charm = handUid(state, "p2", "sv02-173");
    state = must(
      applyAction(state, { type: "attachTool", seat: "p2", uid: charm, target: { spot: "active" } }),
    );
    const charmed = state.players.p2.active;
    if (charmed === null) throw new Error("unreachable");
    expect(effectiveMaxHp(state, charmed)).toBe(80);
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // 30 damage on an 80-effective-HP victim: alive.
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(after.players.p2.active?.damage).toBe(30);
  });

  it("stops applying when the holder evolves (top card no longer Basic), Tool carried", () => {
    let state = p1Turn2(7);
    state = setActiveFromDeck(state, "p1", "fix-basic-1"); // 60 HP Basic
    state = handFromDeck(state, "p1", "sv02-173", 1);
    const charm = handUid(state, "p1", "sv02-173");
    state = must(
      applyAction(state, { type: "attachTool", seat: "p1", uid: charm, target: { spot: "active" } }),
    );
    const basic = state.players.p1.active;
    if (basic === null) throw new Error("unreachable");
    expect(effectiveMaxHp(state, basic)).toBe(110);
    // Two turns later the Basic may evolve (fix-stage1: 90 HP).
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = handFromDeck(state, "p1", "fix-stage1", 1);
    const stage1 = handUid(state, "p1", "fix-stage1");
    state = must(
      applyAction(state, { type: "evolve", seat: "p1", uid: stage1, target: { spot: "active" } }),
    );
    const evolved = state.players.p1.active;
    if (evolved === null) throw new Error("unreachable");
    expect(evolved.tools).toEqual([charm]); // §10 carry-over
    expect(effectiveMaxHp(state, evolved)).toBe(90); // printed only
  });

  it("evolving a charmed Basic below the new stage's HP Knocks it Out mid-turn (§8.1)", () => {
    // A Bravery Charm's +50 is Basic-only, so evolving drops it — the one way
    // evolution can LOWER effective max HP. A charmed Basic damaged into the
    // window (survivable at +50, lethal at the printed stage HP) is Knocked Out
    // the instant it evolves (§8.1) — a MID-TURN KO that resumes the actor's
    // turn (M4 slice 4 closed the former Active-only/turn-ending gap). Uses the
    // BENCH, which the Checkup would never have cleaned up.
    let state = p1Turn2(7);
    state = setActiveFromDeck(state, "p1", "fix-basic-1"); // 60 HP Basic
    state = handFromDeck(state, "p1", "sv02-173", 1);
    const charm = handUid(state, "p1", "sv02-173");
    state = must(
      applyAction(state, { type: "attachTool", seat: "p1", uid: charm, target: { spot: "active" } }),
    );
    // Displace to the bench (a second Basic promotes), carrying the charm, then
    // put 90 damage on it — survivable at 110 effective, lethal vs fix-stage1's
    // printed 90.
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    const benched = state.players.p1.bench.findIndex((p) => p.tools.includes(charm));
    expect(benched).toBeGreaterThanOrEqual(0);
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          bench: state.players.p1.bench.map((p, i) => (i === benched ? { ...p, damage: 90 } : p)),
        },
      },
    };
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    // The Checkup left the charmed Basic alone — 90 damage < its 110 effective
    // HP while still a Basic.
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = handFromDeck(state, "p1", "fix-stage1", 1);
    const stage1 = handUid(state, "p1", "fix-stage1");
    const benchBefore = state.players.p1.bench.length;
    const { state: after, events } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: stage1,
      target: { spot: "bench", index: benched },
    });
    // Evolved to fix-stage1 (90 HP), the carried 90 damage is now lethal → the
    // Pokémon is Knocked Out and leaves the bench, its whole stack (the charm
    // included) to p1's discard.
    const ko = find(events, "KNOCKED_OUT");
    expect(ko).toMatchObject({ seat: "p1", uid: stage1 });
    expect(ko?.discarded).toContain(charm);
    expect(after.players.p1.discard).toContain(charm);
    expect(after.players.p1.discard).toContain(stage1);
    expect(after.players.p1.bench.length).toBe(benchBefore - 1);
    expect(after.players.p1.bench.some((p) => p.tools.includes(charm))).toBe(false);
    // A p1 Pokémon was KO'd, so p2 takes the prize — mid-p1's-turn, with p1's
    // turn queued to RESUME behind the interrupt (the new §8.1 flow shape).
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    expect(after.pending.map((s) => s.kind)).toEqual(["takePrizes", "resumeTurn"]);
    // Resolving the prize hands the turn BACK to p1 (turn:action) — the turn
    // counter never moved.
    const resumed = must(applyAction(after, { type: "takePrizes", seat: "p2", prizeIndices: [0] }));
    expect(resumed.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(resumed.turn).toBe(after.turn);
  });

  it("the KO'd stack discards its Tool with it (§8.1)", () => {
    let state = p1Turn2(8);
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = setActiveFromDeck(state, "p2", "fix-victim");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = handFromDeck(state, "p2", "sv02-173", 1);
    const charm = handUid(state, "p2", "sv02-173");
    state = must(
      applyAction(state, { type: "attachTool", seat: "p2", uid: charm, target: { spot: "active" } }),
    );
    // 60 pre-damage + Bite's 30 ≥ the charmed 80 → a KO after all.
    state = setDamage(state, "p2", 60);
    const victim = activeUid(state, "p2");
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const ko = find(events, "KNOCKED_OUT");
    expect(ko?.discarded).toContain(charm);
    expect(ko?.discarded).toContain(victim);
    expect(after.players.p2.discard).toContain(charm);
  });
});

describe("purity", () => {
  it("playTrainer (Stadium) and attachTool never mutate their input state", () => {
    let state = p1Turn2(9);
    state = handFromDeck(state, "p1", "sv01-167", 1);
    const stadium = handUid(state, "p1", "sv01-167");
    state = handFromDeck(state, "p1", "sv01-197", 1);
    const band = handUid(state, "p1", "sv01-197");
    deepFreeze(state);
    must(applyAction(state, { type: "playTrainer", seat: "p1", uid: stadium }));
    must(
      applyAction(state, { type: "attachTool", seat: "p1", uid: band, target: { spot: "active" } }),
    );
    // Rejections must not mutate either.
    expectErr(
      state,
      { type: "attachTool", seat: "p1", uid: stadium, target: { spot: "active" } },
      "NOT_A_TOOL",
    );
  });
});
