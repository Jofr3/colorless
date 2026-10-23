import { describe, expect, it } from "vitest";
import { CATALOG_MANIFEST } from "./catalogManifest";
import { deriveAttackEffect, programFor } from "./index";
import type { EffectOp, GameEvent, GameState } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  VENGEFUL_PUNCH_DECK,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setConditions,
  setDamage,
  types,
  walkProgram,
  findEvent,
} from "./testFixtures";

const VENGEFUL_PUNCH =
  "If the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, put 4 damage counters on the Attacking Pokémon.";
const PUNCH_COUNTERS = 4;
const PUNCH_HP = PUNCH_COUNTERS * 10;
/** Rocky Helmet's, for the two-sites board. */
const HELMET_HP = 20;

const bite = { type: "attack", seat: "p1", index: 0 } as const; // Bite — {C}, 30, no effect
const yawn = { type: "attack", seat: "p1", index: 2 } as const; // Yawn — no damage, a status
const spread = { type: "attack", seat: "p1", index: 0 } as const;
const SPIN_TURN = 8;

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Every `COUNTERS_PLACED` the recoil family produces, in order. */
function recoils(events: GameEvent[]) {
  return all(events, "COUNTERS_PLACED").filter((e) => e.source === "counterattack");
}

function attackerDamage(state: GameState): number | undefined {
  return state.players.p1.active?.damage;
}

/** The rendered log a player actually reads — the same helper shape
    counterattack.test.ts uses, so the two suites' rows are comparable. */
function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:14" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

/** P2 (going first) fields `holder` and bolts `tool` onto it; the turn then
    passes to P1, who fields `attacker` with one {C} attached. The mirror of
    rockyHelmet.test.ts's `equip`, so the two suites' boards are comparable. */
function equip(
  seed: number,
  opts: {
    holder?: string;
    tool?: string;
    attacker?: string;
    bench?: { id: string; tool?: string; damage?: number }[];
    holderDamage?: number;
    attackerDamage?: number;
  } = {},
): GameState {
  const holderId = opts.holder ?? "fix-wall";
  let state = driveSetup(
    seed,
    { p1: VENGEFUL_PUNCH_DECK, p2: VENGEFUL_PUNCH_DECK },
    { first: "p2" },
  );
  // P2's turn — plant the holder, clear the setup bench, then build the exact one.
  state = setActiveFromDeck(state, "p2", holderId);
  state = { ...state, players: { ...state.players, p2: { ...state.players.p2, bench: [] } } };
  if (opts.tool !== undefined) state = attachToolFromDeck(state, "p2", "active", opts.tool);
  for (const [i, entry] of (opts.bench ?? []).entries()) {
    state = benchFromDeck(state, "p2", entry.id);
    if (entry.tool !== undefined) state = attachToolFromDeck(state, "p2", i, entry.tool);
    if (entry.damage !== undefined) state = setBenchDamage(state, "p2", i, entry.damage);
  }
  if (opts.holderDamage !== undefined) state = setDamage(state, "p2", opts.holderDamage);
  // Hand the turn to P1 and field the attacker.
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", opts.attacker ?? "fix-attacker");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  if (opts.attackerDamage !== undefined) state = setDamage(state, "p1", opts.attackerDamage);
  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// The printed datum — re-queried per claim, never inherited.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed datum — re-queried, not inherited", () => {
  it("authors sv03-197 as a 40 HP (4-counter) damageAttackerOnKo passive, no requiresTool", () => {
    expect(programFor("sv03-197")?.passive).toEqual({ damageAttackerOnKo: { amount: PUNCH_HP } });
    expect(PUNCH_HP).toBe(40);
    expect(PUNCH_COUNTERS).toBe(4);
  });

  it("the fixture's effect string is the D1 row, character for character", () => {
    expect(FIXTURE_POOL["sv03-197"]?.effect).toBe(VENGEFUL_PUNCH);
    expect(FIXTURE_POOL["sv03-197"]?.trainerType).toBe("Tool");
    expect(FIXTURE_POOL["sv03-197"]?.category).toBe("Trainer");
    expect(CATALOG_MANIFEST.printed["sv03-197"]?.name).toBe("Vengeful Punch");
    expect(CATALOG_MANIFEST.printed["sv03-197"]?.attacks).toEqual([]);
    expect(CATALOG_MANIFEST.printed["sv03-197"]?.abilities).toEqual([]);
  });

  it("the sentence is a TRAINER's and never derives as an attack effect", () => {
    expect(deriveAttackEffect(VENGEFUL_PUNCH)).toBeNull();
  });

  it("does NOT collide with Rocky Helmet's sentence, which differs by two clauses", () => {
    expect(programFor("sv01-193")?.passive).toEqual({ damageAttacker: { amount: HELMET_HP } });
    expect(programFor("sv03-197")?.passive).not.toHaveProperty("damageAttacker");
    expect(programFor("sv01-193")?.passive).not.toHaveProperty("damageAttackerOnKo");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The headline: the KO condition, both ways.
// ─────────────────────────────────────────────────────────────────────────────

describe("the KO condition — it pays on the Knock Out and on nothing less", () => {
  it("the holder is KO'd by Bite, and 40 lands on the Attacking Pokémon", () => {
    // fix-wall is 120 HP pre-damaged to 100; Bite's 30 makes 130 ≥ 120, so it is
    // Knocked Out — and the Tool's 4 counters go onto the attacker.
    const state = equip(1, { tool: "sv03-197", holderDamage: 100 });
    const holder = state.players.p2.active?.stack.at(-1) ?? "";
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 30 });
    expect(findEvent(events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1", // the seat that OWNS the damaged Pokémon — the attacker's
      amount: PUNCH_HP,
      source: "counterattack",
    });
    expect(attackerDamage(done)).toBe(PUNCH_HP); // 120 HP fix-attacker survives at 40
    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: holder });
    // A plain body — P1 takes its 1 Prize.
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });

  it("the holder SURVIVING the very same hit pays NOTHING — the refusal Rocky Helmet cannot make", () => {
    const state = equip(2, { tool: "sv03-197" });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 30 });
    expect(done.players.p2.active?.damage).toBe(30); // damaged, alive
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(attackerDamage(done)).toBe(0);
  });

  it("Rocky Helmet on that same board DOES pay — the two refusals are mutual", () => {
    // The control that makes the case above a claim about the CARDS rather than
    // about the board: swap the Tool and the identical hit produces a recoil.
    const state = equip(3, { tool: "sv01-193" });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(findEvent(events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1",
      amount: HELMET_HP,
      source: "counterattack",
    });
    expect(attackerDamage(done)).toBe(HELMET_HP);
    expect(types(events)).not.toContain("KNOCKED_OUT");
  });

  it("a 0-damage attack (Yawn) cannot KO, so nothing fires — the outer boundary", () => {
    // The §8.5 damage branch is never entered at all: no DAMAGE_DEALT, therefore
    // no lethal body, therefore no recoil. Reachable off a printed line rather
    // than constructed, so the trap survives unspent.
    const state = equip(4, { tool: "sv03-197", holderDamage: 100 });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, yawn);

    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(findEvent(events, "STATUS_APPLIED")).toBeDefined(); // Yawn DID resolve
    expect(done.players.p2.active?.damage).toBe(100); // still one hit from lethal
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The clause that is NOT printed — the whole reason the scan is board-wide.
// ─────────────────────────────────────────────────────────────────────────────

describe("no 'in the Active Spot' clause — a BENCHED holder retaliates", () => {
  it("a bench SNIPE that KOs the holder draws the full 40", () => {
    const state = equip(5, {
      holder: "fix-bigbody", // 200 HP Active, unarmed: it survives the 30 and pays nothing
      attacker: "fix-sniper",
      bench: [{ id: "fix-wall", tool: "sv03-197", damage: 110 }],
    });
    const benched = state.players.p2.bench[0]?.stack.at(-1) ?? "";
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    // The snipe KO'd the BENCHED holder…
    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: benched });
    // …and the recoil landed anyway, because no clause confines it to the Active.
    expect(findEvent(events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1",
      amount: PUNCH_HP,
      source: "counterattack",
    });
    expect(attackerDamage(done)).toBe(PUNCH_HP);
    expect(done.players.p2.active?.damage).toBe(30); // the Active took the main hit and lived
  });

  it("Rocky Helmet on the BENCH pays nothing on the same snipe — the clause it does print", () => {
    const state = equip(6, {
      holder: "fix-bigbody",
      attacker: "fix-sniper",
      bench: [{ id: "fix-wall", tool: "sv01-193", damage: 110 }],
    });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    expect(types(events)).toContain("KNOCKED_OUT"); // the benched holder still died
    expect(recoils(events)).toEqual([]); // …and paid nothing
    expect(attackerDamage(done)).toBe(0);
  });

  it("a benched holder the snipe does NOT kill pays nothing either", () => {
    // The condition is the KO, not the location: an undamaged 120 HP holder takes
    // the 20 and lives, so the antecedent is false on the bench exactly as it is
    // on the Active spot.
    const state = equip(7, {
      holder: "fix-bigbody",
      attacker: "fix-sniper",
      bench: [{ id: "fix-wall", tool: "sv03-197" }],
    });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    expect(done.players.p2.bench[0]?.damage).toBe(20);
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(recoils(events)).toEqual([]);
  });
});

describe("two holders, one row — and two SITES, two rows", () => {
  it("a spread KOing TWO holders puts 80 on the attacker in ONE row", () => {
    const state = equip(8, {
      holder: "fix-wall",
      tool: "sv03-197",
      holderDamage: 100, // 120 HP − the 30 main hit → KO
      attacker: "fix-sniper",
      bench: [
        { id: "fix-wall", tool: "sv03-197", damage: 110 }, // 120 HP − the 20 snipe → KO
        { id: "fix-titan" }, // 340 HP filler: a 20 snipe cannot KO it
      ],
    });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    expect(all(events, "KNOCKED_OUT")).toHaveLength(2);
    const rows = recoils(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seat: "p1", amount: 2 * PUNCH_HP, source: "counterattack" });
    expect(attackerDamage(done)).toBe(80); // …carrying both holders' 40
  });

  it("only the holders that DIED pay — a surviving holder beside a dying one adds nothing", () => {
    const state = equip(24, {
      holder: "fix-wall",
      tool: "sv03-197",
      holderDamage: 100, // 120 HP − the 30 main hit → KO
      attacker: "fix-sniper",
      bench: [{ id: "fix-wall", tool: "sv03-197" }], // undamaged: the 20 snipe leaves it at 20
    });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    expect(all(events, "KNOCKED_OUT")).toHaveLength(1); // only the Active died
    expect(done.players.p2.bench[0]?.damage).toBe(20); // …the benched holder lived
    const rows = recoils(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe(PUNCH_HP); // 40, NOT 80
    expect(attackerDamage(done)).toBe(PUNCH_HP);
  });

  it("Rocky Helmet + Vengeful Punch on two bodies = TWO rows, from TWO read sites", () => {
    const state = equip(9, {
      holder: "fix-bigbody",
      tool: "sv01-193",
      attacker: "fix-sniper",
      bench: [{ id: "fix-wall", tool: "sv03-197", damage: 110 }],
    });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    const rows = recoils(events);
    expect(rows.map((r) => r.amount)).toEqual([HELMET_HP, PUNCH_HP]);
    expect(rows.every((r) => r.source === "counterattack")).toBe(true);
    expect(attackerDamage(done)).toBe(HELMET_HP + PUNCH_HP);
    const order = types(events);
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("COUNTERS_PLACED"));
  });
});

describe("ORDER — the recoil is placed BEFORE the sweep reads the board", () => {
  it("the row order is COUNTERS_PLACED then KNOCKED_OUT — this family's existing narration", () => {
    const state = equip(10, { tool: "sv03-197", holderDamage: 100 });
    deepFreeze(state);

    const { events } = mustApply(state, bite);

    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "COUNTERS_PLACED",
      "KNOCKED_OUT",
      "PRIZES_OWED",
    ]);
  });

  it("MUTUAL KO — a LETHAL recoil KOs the attacker in the SAME batch, and both prize", () => {
    const state = equip(11, { tool: "sv03-197", holderDamage: 100, attackerDamage: 90 });
    const holder = state.players.p2.active?.stack.at(-1) ?? "";
    const attacker = state.players.p1.active?.stack.at(-1) ?? "";
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    const kos = all(events, "KNOCKED_OUT");
    expect(kos).toHaveLength(2);
    // The DEFENDER's board is swept first (flow.ts finishAttack's [defender,
    // attacker] order), so the holder's KO is announced before the attacker's…
    expect(kos[0]).toMatchObject({ seat: "p2", uid: holder });
    expect(kos[1]).toMatchObject({ seat: "p1", uid: attacker });
    // …and the recoil that CAUSED the second one precedes both.
    const order = types(events);
    expect(order.indexOf("COUNTERS_PLACED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    // Neither body is left in play, and nothing lethal survives the batch.
    expect(done.players.p1.active).toBeNull();
    expect(done.players.p2.active).toBeNull();
    // The attacking player takes their Prize first (§8.1), the defender's queued
    // behind it — the ordinary `otherSeat` rule, with the recoil's KO prizing to
    // the seat whose Tool caused it.
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    expect(done.pending.filter((s) => s.kind === "takePrizes")).toEqual([
      { kind: "takePrizes", seat: "p1", count: 1 },
      { kind: "takePrizes", seat: "p2", count: 1 },
    ]);
  });

  it("the recoil's OWN KO is swept in the SAME pass — there is no second pass to cascade into", () => {
    const state = equip(12, { tool: "sv03-197", holderDamage: 100, attackerDamage: 90 });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    // Exactly ONE COUNTERS_PLACED and exactly TWO KNOCKED_OUT, all inside this
    // action's event list — no stage is left pending that would sweep again.
    expect(recoils(events)).toHaveLength(1);
    expect(all(events, "KNOCKED_OUT")).toHaveLength(2);
    expect(done.pending.some((s) => s.kind === "attackEpilogue")).toBe(false);
  });

  it("an attacker the recoil does NOT kill is left standing, and the batch is one-sided", () => {
    const state = equip(13, { tool: "sv03-197", holderDamage: 100, attackerDamage: 79 });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(attackerDamage(done)).toBe(119);
    expect(done.players.p1.active).not.toBeNull();
  });

  it("the SIMULTANEOUS batch reaches the §14 TIE — both boards emptied at once", () => {
    let state = equip(14, { tool: "sv03-197", holderDamage: 100, attackerDamage: 90 });
    state = {
      ...state,
      players: {
        p1: { ...state.players.p1, bench: [] },
        p2: { ...state.players.p2, bench: [] },
      },
    };
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(all(events, "KNOCKED_OUT")).toHaveLength(2);
    expect(done.phase).toMatchObject({ kind: "gameOver" });
    expect(findEvent(events, "GAME_OVER")?.outcome).toMatchObject({
      result: "tie",
      reasons: { p1: "noPokemon", p2: "noPokemon" },
    });
  });
});

describe("GUARD — 'by damage from an attack from your OPPONENT'S Pokémon'", () => {
  it("a POISON Knock Out at the Checkup does not fire it — 'by an attack'", () => {
    let state = equip(31, { tool: "sv03-197", holderDamage: 110 });
    state = setConditions(state, "p2", { poisonDamage: 10 });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p1" });

    // The poison DID kill it (and says so in its own voice)…
    expect(findEvent(events, "COUNTERS_PLACED")).toMatchObject({ seat: "p2", source: "poison" });
    expect(types(events)).toContain("KNOCKED_OUT");
    expect(recoils(events)).toEqual([]);
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("a holder on the ATTACKER'S OWN board pays nothing — 'from your OPPONENT'S Pokémon'", () => {
    let state = equip(16, { holder: "fix-bigbody", tool: "sv01-193", attackerDamage: 100 });
    state = attachToolFromDeck(state, "p1", "active", "sv03-197");
    const attacker = state.players.p1.active?.stack.at(-1) ?? "";
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    const rows = recoils(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: HELMET_HP }); // …and NOT 20 + 40
    // The armed attacker really was Knocked Out — the antecedent's other half
    // held, so this case is about the possessive and nothing else.
    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p1", uid: attacker });
    expect(done.players.p2.active?.damage).toBe(30); // the holder survived its own hit
  });

  it("a holder that was never damaged by THIS attack cannot be lethal — 'by damage'", () => {
    const state = equip(17, {
      holder: "fix-bigbody",
      bench: [{ id: "fix-wall", tool: "sv03-197", damage: 110 }],
    });
    deepFreeze(state);

    // Bite reaches only the Active; the benched holder is untouched.
    const { state: done, events } = mustApply(state, bite);

    expect(done.players.p2.bench[0]?.damage).toBe(110); // still one hit short
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(recoils(events)).toEqual([]);
  });
});

describe("the Attacking Pokémon is a UID the epilogue CARRIES — D189 paid the price", () => {
  it("an attack program CAN now move its own actor off the spot — the sweep's premise is RETIRED", () => {
    const walk = (ops: readonly EffectOp[], into: Set<string>): Set<string> => {
      for (const op of walkProgram(ops)) into.add(op.op);
      return into;
    };
    const inAttacks = new Set<string>();
    const inTrainers = new Set<string>();
    for (const card of Object.values(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        const derived = attack.effect === undefined ? null : deriveAttackEffect(attack.effect);
        if (derived !== null) walk(derived, inAttacks);
      }
      const program = programFor(card.id);
      for (const ops of Object.values(program?.attack ?? {})) walk(ops, inAttacks);
      if (program?.trainer !== undefined) walk(program.trainer, inTrainers);
    }

    expect(inAttacks.size).toBeGreaterThan(10);
    expect(inAttacks.has("switchActive")).toBe(true);
    expect(deriveAttackEffect("Switch this Pokémon with 1 of your Benched Pokémon.")).toEqual([
      { op: "switchActive" },
    ]);
    expect(
      deriveAttackEffect(
        "Flip a coin. If heads, switch this Pokémon with 1 of your Benched Pokémon.",
      ),
    ).toEqual([{ op: "coinFlipGate", then: [{ op: "switchActive" }] }]);
    expect(inTrainers.has("switchActive")).toBe(true);
    expect(programFor("sv01-194")?.trainer).toEqual([{ op: "switchActive" }]);
  });

  it("THE DEFECT BOARD: the attacker self-switches and the 40 STILL lands on IT, not on the promoted body", () => {
    let state = equip(21, { tool: "sv03-197", holderDamage: 110, attacker: "fix-trainerops" });
    // EXACTLY ONE Benched body on P1, so `parkOrForce` FORCES the pick and the
    // whole attack resolves inline — the switch is a fact of the finished board
    // rather than a question, which is what lets this case assert the epilogue.
    state = benchFromDeck(clearBench(state, "p1"), "p1", "fix-titan");
    const attackerUid = state.players.p1.active?.stack.at(-1) ?? "";
    const benchUid = state.players.p1.bench[0]?.stack.at(-1) ?? "";
    expect(state.players.p1.bench).toHaveLength(1);
    expect(attackerUid).not.toBe("");
    expect(benchUid).not.toBe("");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPIN_TURN,
    });

    // The holder died to THIS attack's 10 (110 + 10 = 120 of 120)…
    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    // …the switch happened: the body that ATTACKED is on P1's Bench now, and the
    // body standing in the spot is the one that was benched.
    expect(done.players.p1.active?.stack.at(-1)).toBe(benchUid);
    expect(done.players.p1.bench[0]?.stack.at(-1)).toBe(attackerUid);
    // …and the 40 went with the ATTACKER, onto the Bench.
    const rows = recoils(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seat: "p1", uid: attackerUid, amount: PUNCH_HP });
    expect(done.players.p1.bench[0]?.damage).toBe(PUNCH_HP);
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("ORDERING WITNESS: a LETHAL recoil after a self-switch KOs on the BENCH, so P1 is never asked to promote", () => {
    let state = equip(22, {
      tool: "sv03-197",
      holderDamage: 110,
      attacker: "fix-trainerops",
      attackerDamage: 90,
    });
    state = benchFromDeck(clearBench(state, "p1"), "p1", "fix-titan");
    const attackerUid = state.players.p1.active?.stack.at(-1) ?? "";
    const benchUid = state.players.p1.bench[0]?.stack.at(-1) ?? "";
    expect(state.players.p1.bench).toHaveLength(1);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SPIN_TURN,
    });

    // BOTH bodies were Knocked Out — P2's holder by the 10, P1's attacker by the 40.
    const kos = all(events, "KNOCKED_OUT");
    expect(kos.map((k) => k.uid)).toContain(attackerUid);
    expect(kos.some((k) => k.seat === "p2")).toBe(true);
    // The attacker is gone from P1's Bench, and the PROMOTED body is still standing
    // in the Active Spot untouched — it was never the recoil's address.
    expect(done.players.p1.bench.some((p) => p.stack.at(-1) === attackerUid)).toBe(false);
    const promotes = done.pending.filter((s) => s.kind === "promote");
    expect(promotes.map((s) => s.seat)).not.toContain("p1");
    if (done.phase.kind === "ko:promote") expect(done.phase.seat).toBe("p2");
    expect(
      done.players.p1.active?.stack.at(-1) === benchUid || done.phase.kind === "ko:promote",
    ).toBe(true);
  });

  it("the epilogue STAGE carries the attacker's uid across a park — the repair, structurally", () => {
    let state = equip(23, { attacker: "fix-trainerops" });
    state = benchFromDeck(clearBench(state, "p1"), "p1", "fix-titan");
    state = benchFromDeck(state, "p1", "fix-wall");
    const attackerUid = state.players.p1.active?.stack.at(-1) ?? "";
    deepFreeze(state);

    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: SPIN_TURN });

    expect(parked.phase.kind).toBe("effect:choose");
    expect(parked.pending).toContainEqual({
      kind: "attackEpilogue",
      seat: "p1",
      uid: attackerUid,
      attack: "Spin Turn",
    });
    // …and it is the ATTACKER's uid, not the spot's — the two are still the same
    // body here (the switch has not resolved yet), which is exactly why this case
    // asserts the DECLARED uid rather than reading the Active back.
    expect(attackerUid).toBe(
      findEvent(
        mustApply(state, { type: "attack", seat: "p1", index: SPIN_TURN }).events,
        "ATTACK_DECLARED",
      )?.uid,
    );
  });

  it("PINNED ABSENCE: only the STAGE path can see a moved actor — the other four are equivalent", () => {
    const movers = Object.values(FIXTURE_POOL).flatMap((card) =>
      (card.attacks ?? []).filter((attack) => {
        const derived = attack.effect === undefined ? null : deriveAttackEffect(attack.effect);
        return (derived ?? []).some(
          (op) =>
            op.op === "switchActive" ||
            (op.op === "coinFlipGate" && op.then.some((inner) => inner.op === "switchActive")),
        );
      }),
    );
    // The pool really does field them, so the claim below is about something.
    expect(movers.length).toBeGreaterThanOrEqual(3);
    // …and every one of them HAS a program, i.e. takes the staged path by
    // construction. An attack with no program cannot move anything at all.
    for (const attack of movers) {
      expect(deriveAttackEffect(attack.effect ?? ""), attack.name).not.toBeNull();
    }
  });

  it("the recoil addresses the ATTACKER's body by uid in the row it emits", () => {
    const state = equip(18, { tool: "sv03-197", holderDamage: 100 });
    const attacker = state.players.p1.active?.stack.at(-1) ?? "";
    deepFreeze(state);

    const { events } = mustApply(state, bite);

    expect(findEvent(events, "COUNTERS_PLACED")?.uid).toBe(attacker);
    expect(findEvent(events, "ATTACK_DECLARED")?.uid).toBe(attacker);
  });
});

describe("VOICE — the row is SYSTEM-voiced, and the alternative was read", () => {
  it("renders as a system row, never under the attacker's name", () => {
    const state = equip(19, { tool: "sv03-197", holderDamage: 100 });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);
    const rendered = render(events, done);
    const row = rendered.find((r) => r.text.startsWith("Counterattack:"));

    expect(row).toBeDefined();
    expect(row?.who).toBe("system");
    expect(row?.text).toBe("Counterattack: 40 damage to fix-attacker");
    expect(rendered.every((r) => !(r.who === "p1" && r.text.includes("Counterattack")))).toBe(true);
    expect(rendered.every((r) => !(r.who === "p2" && r.text.includes("Counterattack")))).toBe(true);
  });

  it("both seats are shown the same row — the recoil hides nothing", () => {
    const state = equip(20, { tool: "sv03-197", holderDamage: 100 });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);
    const rows = render(events, done).map((r) => `${r.who}|${r.text}`);

    expect(rows).toContain("system|Counterattack: 40 damage to fix-attacker");
    expect(rows.filter((r) => r.includes("Counterattack"))).toHaveLength(1);
  });

  it("it does NOT read like the attacker's own recoil, which uses this event too", () => {
    const state = equip(21, { tool: "sv03-197", holderDamage: 100 });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);
    const row = render(events, done).find((r) => r.text.startsWith("Counterattack:"));

    expect(row?.text).not.toContain("itself");
    expect(row?.who).not.toBe("p1");
  });
});

describe("the §9 recoil family, closed on its always-on half", () => {
  it("all five always-on printings are authored, and none needed a new `source`", () => {
    expect(programFor("sv01-005")?.passive?.damageAttacker).toEqual({ amount: 30 });
    expect(programFor("sv01-006")?.passive?.damageAttacker).toEqual({ amount: 30 });
    expect(programFor("sv03-112")?.passive?.damageAttacker).toEqual({
      amount: 50,
      requiresTool: true,
    });
    expect(programFor("sv01-193")?.passive?.damageAttacker).toEqual({ amount: HELMET_HP });
    expect(programFor("sv03-197")?.passive?.damageAttackerOnKo).toEqual({ amount: PUNCH_HP });
  });

  it("the family's LAST printing — LANDED at D456, on the channel this rung named", () => {
    expect(programFor("sv02-143")).toBeUndefined();
    for (const text of [
      "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.",
      "During your opponent's next turn, if this Pokémon is damaged by an attack (even if it is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.",
    ]) {
      expect(deriveAttackEffect(text), text).toEqual([
        { op: "installRecoil", amount: "damageTaken" },
      ]);
    }
    // …and the always-on KO-conditioned Tool one screen up is STILL a different field,
    // which is this file's own claim and the control that keeps the rung discriminating.
    expect(programFor("sv03-197")?.passive?.damageAttacker).toBeUndefined();
    expect(programFor("sv03-197")?.passive?.damageAttackerOnKo).toEqual({ amount: PUNCH_HP });
  });

  it("the KO-condition NEIGHBOURS are a different consequent, and stay unmapped", () => {
    expect(programFor("sv06.5-037")?.passive?.damageAttackerOnKo).toBeUndefined();
    expect(programFor("sv06.5-083")?.passive?.damageAttackerOnKo).toBeUndefined();
    expect(programFor("sv06.5-091")?.passive?.damageAttackerOnKo).toBeUndefined();
  });
});

describe("the blast radius, asserted as absences", () => {
  it("adds NO EffectOp — so the §11 classification table is untouched", () => {
    expect(programFor("sv03-197")?.attack).toBeUndefined();
    expect(Object.keys(programFor("sv03-197") ?? {})).toEqual(["passive"]);
  });

  it("gates NO action — every declaration stays legal beside an armed holder", () => {
    const state = equip(22, { tool: "sv03-197", holderDamage: 100 });
    deepFreeze(state);

    const result = mustApply(state, bite);
    expect(findEvent(result.events, "ATTACK_DECLARED")).toBeDefined();
    expect(types(result.events)).not.toContain("ATTACK_FAILED");
  });

  it("touches no persisted shape — `PassiveEffects` is CATALOG, not state", () => {
    const state = equip(23, { tool: "sv03-197" });
    const holder = state.players.p2.active;

    expect(holder).not.toBeNull();
    expect(holder).not.toHaveProperty("damageAttackerOnKo");
    expect(holder).not.toHaveProperty("koRecoil");
    // …and the Tool is on the STACK, which is where the datum really lives: the
    // record persists a uid, and the effect is looked up from the card behind it.
    expect(holder?.tools).toHaveLength(1);
  });
});
