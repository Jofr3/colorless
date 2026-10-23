import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { installedRecoilOf, passivesOf } from "./continuous";
import { deriveAttackEffect } from "./effects";
import { applyAction, programFor } from "./index";
import { registryCardIds } from "./registry";
import { runProgram } from "./interpreter";
import type { GameEvent, GameState, Seat } from "./index";
import type { InstalledRecoil } from "./types";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  INSTALLED_RECOIL_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
} from "./testFixtures";

const SCARY_FANGS =
  "During your opponent's next turn, if this Pokémon is damaged by an attack (even if it is Knocked Out), put 10 damage counters on the Attacking Pokémon.";
/** The printed COUNTERS, and the HP they are worth. The conversion happens once,
    at the deriver; every consumer downstream speaks HP. */
const COUNTERS = 10;
const ARMED_HP = COUNTERS * 10;
const COMEUPPANCE =
  "During your opponent's next turn, if this Pokémon is damaged by an attack (even if it is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.";
const COMEUPPANCE_PRINTED = COMEUPPANCE.replace(
  "(even if it is Knocked Out)",
  "(even if this Pokémon is Knocked Out)",
);
const SIX_COUNTERS =
  "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put 6 damage counters on the Attacking Pokémon.";
const SELF_INSTALLED_RECOIL_REFUSES_IT =
  typeof (deriveAttackEffect(COMEUPPANCE)?.[0] as { amount?: unknown } | undefined)?.amount !==
  "number";
const HELMET = programFor("sv01-193")?.passive?.damageAttacker?.amount ?? 0;
/** …and Cacnea's, the always-on ABILITY control. */
const QUILLS = programFor("sv01-005")?.passive?.damageAttacker?.amount ?? 0;

const SEED = 13;

const PROBE_TAKEN = 9999;

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. The
    ARMER goes on P1's Active with the {F}{C}{C} "Scary Fangs" costs. */
function ready(): GameState {
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: INSTALLED_RECOIL_DECK, p2: INSTALLED_RECOIL_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", "sv02-117");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = attachFromDeck(state, "p1", "fix-fighting-energy", 1);
  return attachFromDeck(state, "p1", "fix-energy", 2);
}

function armed(): GameState {
  const { state, events } = mustApply(ready(), { type: "attack", seat: "p1", index: 1 });
  const row = findEvent(events, "RECOIL_ARMED");
  if (row === undefined) throw new Error("Scary Fangs did not arm a recoil");
  if (row.amount !== ARMED_HP) throw new Error(`armed ${String(row.amount)}`);
  return state;
}

/** The declaration every read-site case is: put `attacker` on P2's Active with the
    energy it needs and swing into the armed body. */
function swing(
  state: GameState,
  attacker: string,
  energy: { id: string; count: number }[],
  index = 0,
) {
  let next = setActiveFromDeck(state, "p2", attacker);
  for (const { id, count } of energy) next = attachFromDeck(next, "p2", id, count);
  return mustApply(next, { type: "attack", seat: "p2", index });
}

/** fix-attacker's "Bite" — {C}, 30, no effect. The plain P2 swing. */
const BITE = [{ id: "fix-energy", count: 1 }] as const;

/** The seat's Active, or a thrown error — so a board that lost its Active fails
    HERE rather than passing an assertion vacuously. */
function mustActive(state: GameState, seat: Seat) {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return active;
}

/** Attach a Tool from a seat's deck onto that seat's Active. */
function equip(state: GameState, seat: Seat, toolId: string): GameState {
  const withCard = handFromDeck(state, seat, toolId, 1);
  const uid = handUid(withCard, seat, toolId);
  const done = mustApply(withCard, {
    type: "attachTool",
    seat,
    uid,
    target: { spot: "active" },
  }).state;
  expect(done.players[seat].active?.tools).toContain(uid);
  return done;
}

/** Damage written straight onto a seat's Active — for the boards a 260 HP ex
    cannot be brought to in one printed swing. */
function withDamage(state: GameState, seat: Seat, damage: number): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to damage");
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, active: { ...active, damage } } },
  };
}

function withRecoil(state: GameState, seat: Seat, amount: number, turn = state.turn): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to stamp");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...active, installedRecoil: { turn, amount } } },
    },
  };
}

function withRawRecoil(state: GameState, seat: Seat, record: InstalledRecoil): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to stamp");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...active, installedRecoil: record } },
    },
  };
}

function withBlock(state: GameState, seat: Seat, turn: number): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to shield");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...active, attackBlock: { turn, effects: true } } },
    },
  };
}

function withReduction(state: GameState, seat: Seat, amount: number, turn = state.turn): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to stamp");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...active, damageReduction: { turn, amount } } },
    },
  };
}

function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:14" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

describe("the printed datum — re-queried per printing, not inherited", () => {
  it("carries Lycanroc ex's NAME, its attack INDEX and its effect string verbatim", () => {
    const card = FIXTURE_POOL["sv02-117"];
    expect(card?.name).toBe("Lycanroc ex");
    expect(card?.hp).toBe(260);
    expect(card?.stage).toBe("Stage1");
    expect(card?.evolveFrom).toBe("Rockruff");
    expect(card?.types).toEqual(["Fighting"]);
    expect(card?.retreat).toBe(2);
    expect(card?.weaknesses).toEqual([{ type: "Grass", value: "×2" }]);
    expect(card?.abilities ?? null).toBeNull();
    expect(card?.resistances ?? null).toBeNull();
    expect(card?.attacks?.[1]).toEqual({
      cost: ["Fighting", "Colorless", "Colorless"],
      name: "Scary Fangs",
      damage: 140,
      effect: SCARY_FANGS,
    });
    expect(card?.attacks?.[0]).toEqual({ cost: ["Fighting"], name: "Rock Throw", damage: 40 });
  });

  it("derives to ONE op, with the COUNTERS converted to HP exactly once", () => {
    expect(deriveAttackEffect(SCARY_FANGS)).toEqual([{ op: "installRecoil", amount: ARMED_HP }]);
    expect(QUILLS).toBe(30); // 3 printed counters, stored as HP
    expect(ARMED_HP).toBe(100);
    expect(programFor("sv02-117")).toBeUndefined();
  });

  it("D456 — CLAIMS the neighbouring sentence, which differs only in its amount SLOT", () => {
    expect(SELF_INSTALLED_RECOIL_REFUSES_IT).toBe(true);
    expect(deriveAttackEffect(COMEUPPANCE)).toEqual([
      { op: "installRecoil", amount: "damageTaken" },
    ]);
    expect(programFor("sv02-143")).toBeUndefined();
    expect(
      deriveAttackEffect(
        "If the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, put 4 damage counters on the Attacking Pokémon.",
      ),
    ).toBeNull();
    expect(programFor("sv03-197")?.attack).toBeUndefined();
    expect(programFor("sv03-197")?.passive).toEqual({ damageAttackerOnKo: { amount: 40 } });
  });

  it("does NOT derive the always-on spelling — the duration is the whole difference", () => {
    expect(
      deriveAttackEffect(
        "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 3 damage counters on the Attacking Pokémon.",
      ),
    ).toBeNull();
    expect(programFor("sv01-005")?.passive?.damageAttacker).toEqual({ amount: QUILLS });
  });
});

describe("arming it — the stamp, the window and the row", () => {
  it("stamps the ARMER's own Active for the OPPONENT's next turn, and hits for 140", () => {
    const before = ready();
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: 1 });
    expect(state.players.p1.active?.installedRecoil).toEqual({
      turn: before.turn + 1,
      amount: ARMED_HP,
    });
    expect(state.turn).toBe(before.turn + 1); // …and that turn is now
    // It is an ATTACK, so the printed 140 still lands.
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(140);
    // Nothing on the DEFENDER: "this Pokémon" is the actor's own.
    expect(state.players.p2.active?.installedRecoil).toBeNull();
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.rngState).toBe(before.rngState);
  });

  it("emits RECOIL_ARMED under the ARMER's own seat, in printed order", () => {
    const { state, events } = mustApply(ready(), { type: "attack", seat: "p1", index: 1 });
    expect(findEvent(events, "RECOIL_ARMED")).toEqual({
      type: "RECOIL_ARMED",
      seat: "p1",
      uid: activeUid(state, "p1"),
      amount: ARMED_HP,
    });
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "RECOIL_ARMED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
  });

  it("reads the printed words back to the ARMER, in HP and in the mechanism's name", () => {
    const { state, events } = mustApply(ready(), { type: "attack", seat: "p1", index: 1 });
    const rows = render(events, state).filter((r) => r.text.includes("counterattack"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.who).toBe("p1");
    expect(rows[0]?.text).toBe(
      "Lycanroc ex will counterattack for 100 damage during your opponent's next turn",
    );
    expect(rows[0]?.text).not.toContain("10 damage counters");
    expect(rows[0]?.text).toContain("counterattack");
  });

  it("MERGES by MAX when armed twice in one window, and says nothing when it need not", () => {
    const state = ready();
    const events: GameEvent[] = [];
    const result = runProgram(
      state,
      [
        { op: "installRecoil", amount: 40 },
        { op: "installRecoil", amount: ARMED_HP },
        { op: "installRecoil", amount: 60 },
      ],
      { seat: "p1", invokedBy: "attack" },
      events,
    );
    expect(result.state.players.p1.active?.installedRecoil).toEqual({
      turn: state.turn + 1,
      amount: ARMED_HP,
    });
    expect(findAll(events, "RECOIL_ARMED").map((r) => r.amount)).toEqual([40, ARMED_HP]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The read site: the SUM, and the label that survives it.
// ─────────────────────────────────────────────────────────────────────────────

describe("the §9 SUM — the armed stamp beside the catalog fold, in ONE row", () => {
  it("retaliates across the TURN BOUNDARY, end to end off two printed declarations", () => {
    const state = armed();
    expect(installedRecoilOf(state, mustActive(state, "p1"), PROBE_TAKEN)).toBe(ARMED_HP);
    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p1", dealt: 30 });
    expect(findEvent(events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p2",
      uid: activeUid(done, "p2"),
      amount: ARMED_HP,
      source: "counterattack",
    });
    expect(done.players.p2.active?.damage).toBe(ARMED_HP);
    // The armed body took only the Bite.
    expect(done.players.p1.active?.damage).toBe(30);
  });

  it("SUMS with an attached TOOL on the same body — 100 + 20 in ONE row of 120", () => {
    let state = ready();
    state = equip(state, "p1", "sv01-193");
    state = mustApply(state, { type: "attack", seat: "p1", index: 1 }).state;
    expect(passivesOf(state, mustActive(state, "p1")).damageAttacker).toBe(HELMET);

    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);
    const placed = findAll(events, "COUNTERS_PLACED");
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ amount: ARMED_HP + HELMET, source: "counterattack" });
    // Read from the two authored numbers rather than written as 120, so the
    // arithmetic is asserted rather than the constant.
    expect(ARMED_HP + HELMET).toBe(120);
    // …and 120 is EXACTLY fix-attacker's printed HP, so the attacker is gone from
    // the Active Spot by the time the dust settles — which is the next case.
    expect(types(events)).toContain("KNOCKED_OUT");
    expect(done.players.p2.active).toBeNull();
  });

  it("…and the LOG says one thing, because the number no longer has one source", () => {
    let state = ready();
    state = equip(state, "p1", "sv01-193");
    state = mustApply(state, { type: "attack", seat: "p1", index: 1 }).state;
    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);
    const rows = render(events, done).filter((r) => r.text.startsWith("Counterattack:"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.who).toBe("system");
    expect(rows[0]?.text).toBe("Counterattack: 120 damage to fix-attacker");
    // Neither the card nor the attack that supplied the HP appears, and neither
    // could: the number is their sum.
    expect(rows[0]?.text).not.toContain("Rocky Helmet");
    expect(rows[0]?.text).not.toContain("Scary Fangs");
    expect(rows[0]?.text).not.toContain("Ability");
  });

  it("kills the attacker on the summed number, and the KO is prized to the ARMER", () => {
    let state = ready();
    state = equip(state, "p1", "sv01-193");
    state = mustApply(state, { type: "attack", seat: "p1", index: 1 }).state;
    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);
    expect(types(events)).toContain("KNOCKED_OUT");
    expect(findEvent(events, "KNOCKED_OUT")?.seat).toBe("p2");
    expect(done.phase.kind).toBe("ko:takePrizes");
  });

  it("the ALWAYS-ON control: the same clause without a duration is the same number", () => {
    // Cacnea's Counterattack Quills is this sentence minus its four-word prefix,
    // read out of the registry and folded by `passivesOf`. Driven on the same
    // board so the two halves are shown to be the SAME mechanism at the SAME site.
    const state = must(
      applyAction(
        driveSetup(SEED, { p1: INSTALLED_RECOIL_DECK, p2: INSTALLED_RECOIL_DECK }, { first: "p2" }),
        { type: "endTurn", seat: "p2" },
      ),
    );
    let fielded = setActiveFromDeck(state, "p1", "sv01-005");
    fielded = must(applyAction(fielded, { type: "endTurn", seat: "p1" }));
    const { events } = swing(fielded, "fix-attacker", [...BITE]);
    expect(findEvent(events, "COUNTERS_PLACED")).toMatchObject({
      amount: QUILLS,
      source: "counterattack",
    });
  });

  it("survives a §9 ABILITY-LOCK that would silence the catalog half", () => {
    let state = armed();
    // A body with no printed passive of its own — so the catalog half is 0 and the
    // whole retaliation is the installation's, which is the claim.
    expect(passivesOf(state, mustActive(state, "p1")).damageAttacker).toBe(0);
    expect(installedRecoilOf(state, mustActive(state, "p1"), PROBE_TAKEN)).toBe(ARMED_HP);
    state = withRecoil(state, "p1", ARMED_HP, state.turn + 5);
    expect(installedRecoilOf(state, mustActive(state, "p1"), PROBE_TAKEN)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The guard: `dealt > 0`, driven from BOTH sides.
// ─────────────────────────────────────────────────────────────────────────────

describe("the `dealt > 0` boundary — D149's cases, which this must not break", () => {
  it("an attack with NO PRINTED DAMAGE draws nothing, and the stamp SURVIVES it", () => {
    // The OUTER gate, reachable off a printed line: Pikachu's "Growl" (idx 0) has
    // no printed damage at all, so §8.5's branch is never entered and no
    // COUNTERS_PLACED can exist. The trap is untouched, not spent.
    const state = armed();
    const { state: done, events } = swing(state, "sv02-062", [{ id: "fix-energy", count: 1 }], 0);
    expect(findAll(events, "DAMAGE_DEALT")).toHaveLength(0);
    expect(findAll(events, "COUNTERS_PLACED")).toHaveLength(0);
    expect(done.players.p1.active?.installedRecoil).toEqual({
      turn: state.turn,
      amount: ARMED_HP,
    });
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("a hit CLAMPED TO 0 inside the branch draws nothing either — a row, no counters", () => {
    let state = armed();
    state = withReduction(state, "p1", 200, state.turn);
    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.dealt).toBe(0);
    expect(row?.reduction).toBe(200);
    expect(findAll(events, "COUNTERS_PLACED")).toHaveLength(0);
    expect(done.players.p2.active?.damage).toBe(0);
    // …and the trap is still armed, so "a clamped zero is not an attack that did
    // damage" is a statement about THIS hit rather than about the window.
    expect(done.players.p1.active?.installedRecoil?.amount).toBe(ARMED_HP);
  });

  it("…and 1 HP through the same shield is enough — the boundary, from the other side", () => {
    // A two-sided pin. Drop the shield to 29 and the same Bite deals 1, which is
    // `dealt > 0` and draws the FULL retaliation: the recoil is not proportional to
    // the hit, which is the whole difference from Mabosstiff's unread sentence.
    let state = armed();
    state = withReduction(state, "p1", 29, state.turn);
    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(1);
    expect(findEvent(events, "COUNTERS_PLACED")?.amount).toBe(ARMED_HP);
    expect(done.players.p2.active?.damage).toBe(ARMED_HP);
  });

  it("fires EVEN IF THE HOLDER IS KNOCKED OUT — the printed clause, with no field", () => {
    let state = clearBench(armed(), "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    state = withDamage(state, "p1", 250);
    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);
    expect(types(events)).toContain("KNOCKED_OUT");
    // The recoil landed anyway, and it landed BEFORE the KO sweep.
    const order = types(events);
    expect(order.indexOf("COUNTERS_PLACED")).toBeGreaterThan(-1);
    expect(order.indexOf("COUNTERS_PLACED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    expect(done.players.p2.active?.damage).toBe(ARMED_HP);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The lifetime: the window's end, and the three §10 clears.
// ─────────────────────────────────────────────────────────────────────────────

describe("the lifetime — one turn, and the three §10 early endings", () => {
  it("expires by ARITHMETIC when the window passes, with nobody clearing it", () => {
    let state = armed();
    state = must(applyAction(state, { type: "endTurn", seat: "p2" })); // back to P1
    const stamp = state.players.p1.active?.installedRecoil;
    expect(stamp).not.toBeNull();
    expect(installedRecoilOf(state, mustActive(state, "p1"), PROBE_TAKEN)).toBe(0); // …and answers 0
    state = mustApply(state, { type: "attack", seat: "p1", index: 0 }).state; // Rock Throw
    // The record is STILL there, untouched, and still silent.
    expect(state.players.p1.active?.installedRecoil).toEqual(stamp);
    const { events } = swing(state, "fix-attacker", [...BITE]);
    expect(findAll(events, "COUNTERS_PLACED")).toHaveLength(0);
  });

  it("ends when the Pokémon leaves the Active Spot — a Boss's Orders INSIDE the window", () => {
    let state = armed();
    const armedUid = activeUid(state, "p1");
    expect(state.players.p1.bench.length).toBeGreaterThan(0);
    state = handFromDeck(state, "p2", "sv02-172", 1);
    const gusted = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-172"),
    });
    let next = gusted.state;
    if (next.phase.kind === "effect:choose") {
      next = must(
        applyAction(next, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    const benchIndex = next.players.p1.bench.findIndex((p) => p.stack.includes(armedUid ?? ""));
    expect(benchIndex).toBeGreaterThanOrEqual(0);
    expect(next.players.p1.bench[benchIndex]?.installedRecoil).toBeNull();
    expect(types(gusted.events)).not.toContain("RECOIL_ARMED");
    // And it is GONE rather than merely unread — the promoted body draws nothing.
    const { events } = swing(next, "fix-attacker", [...BITE]);
    expect(findAll(events, "COUNTERS_PLACED")).toHaveLength(0);
  });

  it("ends on EVOLVING — unreachable by construction, written anyway", () => {
    let state = armed();
    state = must(applyAction(state, { type: "endTurn", seat: "p2" })); // hand the turn back
    state = setActiveFromDeck(state, "p1", "sv01-048"); // Alomomola, a real pre-evolution
    state = withRecoil(state, "p1", ARMED_HP, state.turn);
    expect(state.players.p1.active?.installedRecoil).toEqual({
      turn: state.turn,
      amount: ARMED_HP,
    });
    state = handFromDeck(state, "p1", "fix-mola-stage1", 1);
    const { state: done, events } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "fix-mola-stage1"),
      target: { spot: "active" },
    });
    expect(types(events)).toContain("POKEMON_EVOLVED");
    expect(done.players.p1.active?.installedRecoil).toBeNull();
    // Silent, like every §10 clear in this family.
    expect(types(events)).not.toContain("RECOIL_ARMED");
  });

  it("leaves play with a KNOCKED OUT holder — the promoted body carries nothing", () => {
    let state = clearBench(armed(), "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    state = withDamage(state, "p1", 250);
    const { state: done } = swing(state, "fix-attacker", [...BITE]);
    let next = done;
    expect(next.phase.kind).toBe("ko:takePrizes");
    // TWO prizes: Lycanroc ex has a rule box (§8.1's prize value, D-era).
    next = must(applyAction(next, { type: "takePrizes", seat: "p2", prizeIndices: [0, 1] }));
    if (next.phase.kind === "ko:promote") {
      next = must(applyAction(next, { type: "promote", seat: "p1", benchIndex: 0 }));
    }
    expect(next.players.p1.active?.installedRecoil).toBeNull();
  });
});

function armScaled(state: GameState): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const result = runProgram(
    state,
    [{ op: "installRecoil", amount: "damageTaken" }],
    { seat: "p1", invokedBy: "attack" },
    events,
  );
  return { state: result.state, events };
}

/** …and then hand the turn over, so the stamp's window is NOW. */
function intoWindow(state: GameState): GameState {
  return must(applyAction(state, { type: "endTurn", seat: "p1" }));
}

describe("D456 §1 — the datum, and the family CLOSED over the corpus", () => {
  it("`Attacking Pokémon` over all 640 sentences returns THREE rows — and none is a ten", () => {
    const family = legalAttackCorpus().filter(([, t]) => /Attacking Pokémon/.test(t));
    expect(family).toHaveLength(3);
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(8);
    expect(family.map(([n, t]) => [n, /put (\d+) damage counters/.exec(t)?.[1] ?? "—"])).toEqual([
      [5, "8"],
      [1, "6"],
      [2, "—"],
    ]);
    expect(family.some(([, t]) => t.includes("10 damage counters"))).toBe(false);
    // …and ALL THREE now resolve, so the ATTACK column's half of this family is CLOSED.
    for (const [, t] of family) expect(resolvedByAnyReader(t), t).toBe(true);
    expect(attackReaderSurface()).toHaveLength(14); // no fourteenth reader
  });

  it("the parenthetical varies BY PRINTING, which is why the alternation is not invented", () => {
    const family = legalAttackCorpus()
      .map(([, t]) => t)
      .filter((t) => /Attacking Pokémon/.test(t));
    const spellings = new Set(
      family.map((t) => /\(even if ([^)]*) is Knocked Out\)/.exec(t)?.[1] ?? "?"),
    );
    expect([...spellings].sort()).toEqual(["it", "this Pokémon"]);
    const eight = family.find((t) => t.includes("8 damage counters")) as string;
    const six = family.find((t) => t.includes("6 damage counters")) as string;
    expect(eight.replace("even if it is", "even if this Pokémon is").replace(" 8 ", " 6 ")).toBe(
      six,
    );
  });

  it("both new sentences derive, to the SAME op and to DIFFERENT amounts", () => {
    expect(deriveAttackEffect(SIX_COUNTERS)).toEqual([{ op: "installRecoil", amount: 60 }]);
    expect(deriveAttackEffect(COMEUPPANCE_PRINTED)).toEqual([
      { op: "installRecoil", amount: "damageTaken" },
    ]);
    expect(deriveAttackEffect(SIX_COUNTERS)?.[0]?.op).toBe(
      deriveAttackEffect(COMEUPPANCE_PRINTED)?.[0]?.op,
    );
    expect(deriveAttackEffect(SIX_COUNTERS)).not.toEqual(deriveAttackEffect(COMEUPPANCE_PRINTED));
    expect(
      deriveAttackEffect(
        "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 3 damage counters on the Attacking Pokémon.",
      ),
    ).toBeNull();
    // …as is the same sentence with the DURATION but a different window.
    expect(
      deriveAttackEffect(
        "During your next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put 6 damage counters on the Attacking Pokémon.",
      ),
    ).toBeNull();
  });
});

describe("D456 §2 — the record, the row and the merge", () => {
  it("stores a FLOOR of 0 with the flag, and says so in words rather than in a 0", () => {
    const before = ready();
    const { state, events } = armScaled(before);
    expect(state.players.p1.active?.installedRecoil).toEqual({
      turn: before.turn + 1,
      amount: 0,
      ofDamageTaken: true,
    });
    expect(Object.keys(state.players.p1.active?.installedRecoil ?? {})).toEqual([
      "turn",
      "amount",
      "ofDamageTaken",
    ]);
    expect(findEvent(events, "RECOIL_ARMED")).toEqual({
      type: "RECOIL_ARMED",
      seat: "p1",
      uid: activeUid(state, "p1"),
      amount: 0,
      ofDamageTaken: true,
    });
    const rows = render(events, state).filter((r) => r.text.includes("counterattack"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.who).toBe("p1");
    expect(rows[0]?.text).toBe(
      "Lycanroc ex will counterattack for the damage it takes during your opponent's next turn",
    );
    expect(rows[0]?.text).not.toContain("for 0 damage");
    const flat = mustApply(ready(), { type: "attack", seat: "p1", index: 1 });
    expect(
      render(flat.events, flat.state).find((r) => r.text.includes("counterattack"))?.text,
    ).toBe("Lycanroc ex will counterattack for 100 damage during your opponent's next turn");
  });

  it("MERGES the two inhabitants: the flag STICKS and the flat amount is the FLOOR", () => {
    const state = ready();
    const events: GameEvent[] = [];
    const result = runProgram(
      state,
      [
        { op: "installRecoil", amount: 40 },
        { op: "installRecoil", amount: "damageTaken" },
        { op: "installRecoil", amount: 20 },
      ],
      { seat: "p1", invokedBy: "attack" },
      events,
    );
    expect(result.state.players.p1.active?.installedRecoil).toEqual({
      turn: state.turn + 1,
      amount: 40,
      ofDamageTaken: true,
    });
    expect(
      findAll(events, "RECOIL_ARMED").map((r) => [r.amount, r.ofDamageTaken ?? false]),
    ).toEqual([
      [40, false],
      [40, true],
    ]);
    const live = intoWindow(result.state);
    expect(installedRecoilOf(live, mustActive(live, "p1"), 20)).toBe(40);
    // …while a 90 hit retaliates for 90, which is the whole point of the flag.
    expect(installedRecoilOf(live, mustActive(live, "p1"), 90)).toBe(90);
    // …and OUTSIDE the window it answers 0 whatever the hit was, floor and flag alike.
    expect(installedRecoilOf(result.state, mustActive(result.state, "p1"), 90)).toBe(0);
  });

  it("a SPENT stamp does not lend its flag to the next install — the stale-record read", () => {
    let state = ready();
    state = armScaled(state).state; // line 180: {turn: T+1, amount: 0, ofDamageTaken}
    const spent = state.players.p1.active?.installedRecoil;
    expect(spent).toEqual({ turn: state.turn + 1, amount: 0, ofDamageTaken: true });
    // …a full round later the stamp is SPENT and still on the body.
    state = intoWindow(state);
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.players.p1.active?.installedRecoil).toEqual(spent);
    expect(installedRecoilOf(state, mustActive(state, "p1"), 999)).toBe(0);
    // …and a FLAT install now must produce a FLAT record, with no inherited flag.
    const events: GameEvent[] = [];
    const again = runProgram(
      state,
      [{ op: "installRecoil", amount: 60 }],
      { seat: "p1", invokedBy: "attack" },
      events,
    );
    expect(again.state.players.p1.active?.installedRecoil).toEqual({
      turn: state.turn + 1,
      amount: 60,
    });
    expect(findEvent(events, "RECOIL_ARMED")?.ofDamageTaken).toBeUndefined();
    const live = intoWindow(again.state);
    expect(installedRecoilOf(live, mustActive(live, "p1"), 999)).toBe(60);
    expect(
      runProgram(
        ready(),
        [
          { op: "installRecoil", amount: "damageTaken" },
          { op: "installRecoil", amount: 60 },
        ],
        { seat: "p1", invokedBy: "attack" },
        [],
      ).state.players.p1.active?.installedRecoil,
    ).toEqual({ turn: ready().turn + 1, amount: 60, ofDamageTaken: true });
  });
});

describe("D456 §3 — the §9 read: the amount IS the hit", () => {
  it("retaliates for exactly what the hit did — TWO different attacks, ONE trap", () => {
    const state = intoWindow(armScaled(ready()).state);
    // "Bite" — a flat 30 into a 260 HP body.
    const bite = swing(state, "fix-attacker", [...BITE]);
    expect(findEvent(bite.events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(findEvent(bite.events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p2",
      uid: activeUid(bite.state, "p2"),
      amount: 30,
      source: "counterattack",
    });
    expect(bite.state.players.p2.active?.damage).toBe(30);
    // …and "Rage", whose damage SCALES off counters already on the attacker, so the same
    // trap answers a different number on the same board. A fixed amount cannot do this,
    // which is what makes the pair a real discrimination rather than one board twice.
    let raging = setActiveFromDeck(state, "p2", "fix-attacker");
    raging = attachFromDeck(raging, "p2", "fix-energy", 1);
    raging = withDamage(raging, "p2", 60);
    const rage = mustApply(raging, { type: "attack", seat: "p2", index: 3 });
    expect(findEvent(rage.events, "DAMAGE_DEALT")?.dealt).toBe(70); // 10 + 10 × 6 counters
    expect(findEvent(rage.events, "COUNTERS_PLACED")?.amount).toBe(70);
    for (const r of [bite, rage]) {
      expect(findEvent(r.events, "COUNTERS_PLACED")?.amount).toBe(
        findEvent(r.events, "DAMAGE_DEALT")?.dealt,
      );
    }
  });

  it("SUMS with the always-on fold, in ONE row — the channel joins D141's judgement", () => {
    let state = equip(ready(), "p1", "sv01-193");
    state = intoWindow(armScaled(state).state);
    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);
    expect(findAll(events, "COUNTERS_PLACED")).toHaveLength(1);
    expect(findEvent(events, "COUNTERS_PLACED")?.amount).toBe(30 + HELMET);
    expect(findEvent(events, "COUNTERS_PLACED")?.source).toBe("counterattack");
    expect(done.players.p2.active?.damage).toBe(30 + HELMET);
    const rows = render(events, done).filter((r) => r.text.includes("Counterattack"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.who).toBe("system");
    expect(rows[0]?.text).toBe(`Counterattack: ${String(30 + HELMET)} damage to fix-attacker`);
  });

  it("the `dealt > 0` boundary — a PREVENTED hit arms nothing and the stamp SURVIVES", () => {
    // The channel's zero case is the read site's own gate and needs no `>= 1` guard on
    // the op (the flat arm has one because a printed 0 is a real sentence to refuse; a
    // channel has no printed number to refuse). "Growl" prints no damage at all.
    const state = intoWindow(armScaled(ready()).state);
    let growling = setActiveFromDeck(state, "p2", "sv02-062");
    growling = attachFromDeck(growling, "p2", "fix-lightning-energy", 1);
    const window = state.turn;
    const { state: done, events } = mustApply(growling, { type: "attack", seat: "p2", index: 0 });
    expect(findAll(events, "COUNTERS_PLACED")).toHaveLength(0);
    expect(done.turn).toBe(window + 1);
    expect(done.players.p1.active?.installedRecoil).toEqual({
      turn: window,
      amount: 0,
      ofDamageTaken: true,
    });
  });
});

describe("D456 §4 — the four questions the printed clause raises", () => {
  it("Q1 — fires from a body being REMOVED in the same step, for the LETHAL hit's own damage", () => {
    let state = clearBench(ready(), "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    state = withDamage(state, "p1", 250); // 260 HP; a 30 Bite is lethal
    const { state: done, events } = swing(intoWindow(armScaled(state).state), "fix-attacker", [
      ...BITE,
    ]);
    const order = types(events);
    expect(order).toContain("KNOCKED_OUT");
    expect(order.indexOf("COUNTERS_PLACED")).toBeGreaterThan(-1);
    expect(order.indexOf("COUNTERS_PLACED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    expect(findEvent(events, "COUNTERS_PLACED")?.amount).toBe(30);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(done.players.p2.active?.damage).toBe(30);
  });

  it("Q2 — 'the Attacking Pokémon' is the body that dealt it, on the OTHER seat", () => {
    const state = intoWindow(armScaled(ready()).state);
    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);
    const placed = findEvent(events, "COUNTERS_PLACED");
    expect(placed?.seat).toBe("p2");
    expect(placed?.uid).toBe(activeUid(done, "p2"));
    expect(placed?.uid).not.toBe(activeUid(done, "p1"));
    // …and the armer takes nothing: this is not a mirror, it is a cross-table placement.
    expect(done.players.p1.active?.damage).toBe(30);
    expect(render(events, done).find((r) => r.text.includes("Counterattack"))?.who).toBe("system");
    expect(types(events).slice(0, 3)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "COUNTERS_PLACED",
    ]);
  });

  it("Q3 — counters are NOT damage: no Weakness, no Resistance, and no §11 ask", () => {
    const state = intoWindow(armScaled(ready()).state);
    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);
    const attacker = FIXTURE_POOL["fix-attacker"];
    expect(attacker?.weaknesses ?? null).toBeNull(); // …so this board cannot show it, and says so
    expect(findEvent(events, "COUNTERS_PLACED")?.amount).toBe(30);
    expect(findAll(events, "DAMAGE_DEALT")).toHaveLength(1);
    expect(findEvent(events, "DAMAGE_DEALT")?.seat).toBe("p1");
    expect(findAll(events, "COUNTERS_PLACED")).toHaveLength(1);
    const shielded = withBlock(state, "p2", state.turn + 1);
    const guarded = swing(shielded, "fix-attacker", [...BITE]);
    expect(findEvent(guarded.events, "COUNTERS_PLACED")?.amount).toBe(30);
    expect(findAll(guarded.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
    expect(done.players.p2.active?.damage).toBe(30);
  });

  it("Q4 — it CAN kill, the Prize IS paid, and the cause marker is NOT stamped", () => {
    // A 120 HP attacker already carrying 60 uses "Rage" for 70 and retaliates into its
    // own death: 60 + 70 = 130 ≥ 120. §9 runs before §8.1, so the sweep collects it.
    let state = intoWindow(armScaled(ready()).state);
    state = setActiveFromDeck(state, "p2", "fix-attacker");
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = withDamage(state, "p2", 60);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p2", index: 3 });
    expect(findEvent(events, "COUNTERS_PLACED")?.amount).toBe(70);
    expect(findEvent(events, "KNOCKED_OUT")?.seat).toBe("p2");
    expect(findEvent(events, "PRIZES_OWED")).toEqual({ type: "PRIZES_OWED", seat: "p1", count: 1 });
    expect(done.phase.kind).toBe("ko:takePrizes");
    const survivor = swing(intoWindow(armScaled(ready()).state), "fix-attacker", [...BITE]);
    expect(survivor.state.players.p2.active?.damage).toBe(30);
    expect(survivor.state.players.p2.active?.markers).toEqual([]);
    expect(survivor.state.players.p2.active?.markers.some((m) => m.startsWith("koByEffect"))).toBe(
      false,
    );
  });
});

describe("D456 §5 — `MATCH_RECORD_VERSION` 29, driven over the SERIALIZED BYTES", () => {
  it("the version PREDICTION in THREE directions, LOSS included", () => {
    const before = ready();
    const armed = armScaled(before).state;
    const record = armed.players.p1.active?.installedRecoil;
    expect(record).toEqual({ turn: before.turn + 1, amount: 0, ofDamageTaken: true });

    const inWindow = intoWindow(armed);
    expect(inWindow.turn).toBe(before.turn + 1);
    const v29 = JSON.parse(`{"turn":${String(before.turn + 1)},"amount":100}`) as InstalledRecoil;
    const legacy = withRawRecoil(inWindow, "p1", v29);
    expect(installedRecoilOf(legacy, mustActive(legacy, "p1"), 0)).toBe(100);
    expect(installedRecoilOf(legacy, mustActive(legacy, "p1"), 999)).toBe(100);
    expect(Object.keys(v29)).toEqual(["turn", "amount"]);

    const wire = JSON.stringify(armed.players.p1.active?.installedRecoil);
    expect(wire).toBe(`{"turn":${String(before.turn + 1)},"amount":0,"ofDamageTaken":true}`);
    expect(wire).not.toContain('damageTaken":"');
    expect(JSON.stringify(armed)).not.toContain('"amount":"damageTaken"');
    const round = JSON.parse(wire) as InstalledRecoil;
    const revived = withRawRecoil(inWindow, "p1", round);
    expect(installedRecoilOf(revived, mustActive(revived, "p1"), 45)).toBe(45);
    expect(installedRecoilOf(revived, mustActive(revived, "p1"), 0)).toBe(0);

    const lost = JSON.parse(
      JSON.stringify(round, (k, v) => (k === "ofDamageTaken" ? undefined : v)),
    ) as InstalledRecoil;
    expect(Object.keys(lost)).toEqual(["turn", "amount"]);
    const degraded = withRawRecoil(inWindow, "p1", lost);
    expect(installedRecoilOf(degraded, mustActive(degraded, "p1"), 999)).toBe(0);
    const quiet = swing(degraded, "fix-attacker", [...BITE]);
    expect(findAll(quiet.events, "COUNTERS_PLACED")).toHaveLength(0);
    const flatAmounts: number[] = [];
    for (const [, text] of legalAttackCorpus()) {
      for (const op of deriveAttackEffect(text) ?? []) {
        if (op.op === "installRecoil" && typeof op.amount === "number") flatAmounts.push(op.amount);
      }
    }
    expect(flatAmounts.length).toBeGreaterThan(0);
    expect(flatAmounts.every((n) => n >= 10)).toBe(true);
    for (const id of registryCardIds()) {
      const card = programFor(id);
      if (card === undefined) continue;
      const programs = [
        ...Object.values(card.attack ?? {}),
        ...(card.abilities ?? []).map((a) => a.program),
        ...(card.triggered ?? []).map((t) => t.program),
        ...(card.trainer === undefined ? [] : [card.trainer]),
      ];
      for (const op of programs.flat()) expect(op.op, id).not.toBe("installRecoil");
    }
  });
});
