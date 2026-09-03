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
} from "./testFixtures";

// 0.103.1 → 0.104.0 — Vengeful Punch sv03-197 (P3-M5 long tail, D158), the §9
// recoil family's LAST always-on printing and its SECOND Pokémon Tool:
//
//   "If the Pokémon this card is attached to is Knocked Out by damage from an
//    attack from your opponent's Pokémon, put 4 damage counters on the Attacking
//    Pokémon."                                     (Trainer / Tool, `effect`)
//
// ⚠️ THE CENSUS IS THIS SESSION'S OWN QUERY, and it is run over TWO POPULATIONS
// because since D156 they are not the same one. Against the local D1 (2026-08-03,
// 890 rows / 5 sets — sv01 258, sv02 279, sv03 230, sv06.5 99, sve 24)
// "…damage counters on the Attacking Pokémon" returns the SAME EIGHT rows D152
// found: Cacnea sv01-005 / Cacturne sv01-006 / Stunfisk sv03-112 (Abilities),
// Rocky Helmet sv01-193 / Vengeful Punch sv03-197 (Tools), Lycanroc ex
// sv02-117/-241 / Mabosstiff sv02-143 (attacks). Against `FIXTURE_POOL` swept
// SEPARATELY (278 entries, of which 12 are `swsh10.5` cards the D1 no longer
// holds — D156) the same needle returns five, all of them a subset of the eight,
// and NO `swsh10.5` fixture carries the clause. So the two populations agree and
// this printing is the family's last always-on member.
//
// ⚠️ AND THE KO CONDITION IS ITS OWN QUERY, because that — not the recoil — is
// the shape that needed a new read site. "Knocked Out by damage from an attack"
// returns SIX D1 rows across all three text columns, and only this one is a
// recoil: Exp. Share sv01-174 (a Tool, moves Energy), Lucario sv01-114 (an attack
// damage bonus), and Munkidori ex sv06.5-037/-083/-091 (an Ability that denies a
// Prize). The last three are the structural NEIGHBOURS worth knowing about — the
// same antecedent, a different consequent — so the sweep this slice adds is the
// site that family will read at when it lands.
//
// ⚠️ AND SEE D160/D162 — BOTH OF THE ABOVE. The 890 / 5 is the OUTAGE-WINDOW
// catalog and is left standing as the population this slice actually queried; D160
// re-ingested `swsh10.5` (978 rows / 6 sets) and D162 re-ran BOTH censuses against
// the restored catalog — the recoil needle still returns EIGHT rows and the KO
// antecedent still SIX, the restored set contributing ZERO to either. Both floors
// above are also TOTALS.
//
// ⚠️ IT IS ROCKY HELMET'S SIBLING, NOT ITS MIRROR, AND THE READ SITES ARE WHY.
// Same mechanism, same `COUNTERS_PLACED source: "counterattack"` row, same
// "the Tool IS the source" (no `requiresTool`). The differences are two, and each
// one is a refusal:
//
//   • Rocky Helmet pays on `dealt > 0` and REFUSES a KO its damage did not cause;
//     this card pays on the KO and REFUSES mere damage. Neither can be an arm of
//     the other's field without firing where the other must not (D155's rule).
//   • Rocky Helmet prints "is in the Active Spot" and this card DOES NOT, so this
//     one's scan covers the whole board and a BENCHED holder retaliates.
//
// ⚠️ THE ORDER IS THE WHOLE SLICE, and it is one decision: the counters are placed
// BEFORE `collectKnockOuts` reads the board, so the holder's KO and any KO the
// recoil itself causes are ONE simultaneous batch (§8.1's own model). Placing them
// inside the sweep — where the printed "if … is Knocked Out" would read in printed
// order — would put them down after `lethalRefs` had already decided who dies, and
// a lethal retaliation would miss the batch and with it the §14 tie guard. Every
// claim in that paragraph is DRIVEN below, including both ways it can be wrong.

/** The printed sentence, byte-for-byte off the local D1 row (2026-08-03). */
const VENGEFUL_PUNCH =
  "If the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, put 4 damage counters on the Attacking Pokémon.";
/** The printed COUNTERS and the HP they are worth. The conversion happens once,
    at the registry row — where this family's four other always-on printings have
    always done it (Cacnea's 3 counters are stored `{ amount: 30 }`). */
const PUNCH_COUNTERS = 4;
const PUNCH_HP = PUNCH_COUNTERS * 10;
/** Rocky Helmet's, for the two-sites board. */
const HELMET_HP = 20;

const bite = { type: "attack", seat: "p1", index: 0 } as const; // Bite — {C}, 30, no effect
const yawn = { type: "attack", seat: "p1", index: 2 } as const; // Yawn — no damage, a status
const spread = { type: "attack", seat: "p1", index: 0 } as const; // Spread Shot — 30 + 20/bench
/** D189 — `fix-trainerops` idx 8: "Spin Turn" ({C}, 10, "Switch this Pokémon with
    1 of your Benched Pokémon."). The one attack in the pool that DAMAGES and then
    moves its own actor, which is what the addressing cases below need. */
const SPIN_TURN = 8;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

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
function render(
  events: GameEvent[],
  state: GameState,
): { who: string; text: string }[] {
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
  let state = driveSetup(seed, { p1: VENGEFUL_PUNCH_DECK, p2: VENGEFUL_PUNCH_DECK }, { first: "p2" });
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
    // 4 damage counters = 40 HP; unconditional once attached — the Tool IS the
    // source, so (unlike Custom Trap) no `requiresTool` gate, exactly as Rocky
    // Helmet has none. The whole registry row is this one field.
    expect(programFor("sv03-197")?.passive).toEqual({ damageAttackerOnKo: { amount: PUNCH_HP } });
    expect(PUNCH_HP).toBe(40);
    expect(PUNCH_COUNTERS).toBe(4);
  });

  it("the fixture's effect string is the D1 row, character for character", () => {
    // ⚠️ RE-QUERIED 2026-08-03 rather than trusted: D152 checked this id, name,
    // `trainerType` and effect and reported them correct, and the standing rule
    // says a predecessor's own finding is exactly as unverified as anything else.
    // It held — see the header for the full list of what was and was not wrong.
    expect(FIXTURE_POOL["sv03-197"]?.effect).toBe(VENGEFUL_PUNCH);
    expect(FIXTURE_POOL["sv03-197"]?.trainerType).toBe("Tool");
    expect(FIXTURE_POOL["sv03-197"]?.category).toBe("Trainer");
    // The GENERATED manifest is an independent second reading of the same row —
    // it comes from the sqlite, not from this file — so the NAME is checked by a
    // path that cannot inherit a typo from the fixture.
    expect(CATALOG_MANIFEST.printed["sv03-197"]?.name).toBe("Vengeful Punch");
    // A Trainer, so no printed attack and no printed Ability — asserted as
    // ABSENCES (D151's rule after 40 pool fixtures turned out to be missing one).
    expect(CATALOG_MANIFEST.printed["sv03-197"]?.attacks).toEqual([]);
    expect(CATALOG_MANIFEST.printed["sv03-197"]?.abilities).toEqual([]);
  });

  it("the sentence is a TRAINER's and never derives as an attack effect", () => {
    // The family's OTHER two members derive from attack text (D152). This one is
    // read out of the registry like Rocky Helmet, and feeding its sentence to the
    // attack deriver must stay null — a prefix-happy regex that accepted it would
    // install a Tool's permanent recoil as a one-turn stamp.
    expect(deriveAttackEffect(VENGEFUL_PUNCH)).toBeNull();
  });

  it("does NOT collide with Rocky Helmet's sentence, which differs by two clauses", () => {
    // The neighbouring printing, kept apart on purpose: it prints "is in the
    // Active Spot" and "is damaged by" where this one prints neither, and the two
    // land on DIFFERENT fields read at DIFFERENT sites.
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

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 30 });
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1", // the seat that OWNS the damaged Pokémon — the attacker's
      amount: PUNCH_HP,
      source: "counterattack", // ⚠️ NO NEW `source` MEMBER — D141's axis, fifth printing
    });
    expect(attackerDamage(done)).toBe(PUNCH_HP); // 120 HP fix-attacker survives at 40
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: holder });
    // A plain body — P1 takes its 1 Prize.
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });

  it("⚠️ the holder SURVIVING the very same hit pays NOTHING — the refusal Rocky Helmet cannot make", () => {
    // THE case that forces a second field. Identical board minus the pre-damage:
    // Bite's 30 lands on a 120 HP body, which survives, so the printed antecedent
    // ("is Knocked Out") is false and no counter is placed. Rocky Helmet on this
    // exact board pays its 20 — the two Tools are not two amounts of one effect.
    const state = equip(2, { tool: "sv03-197" });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 30 });
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

    expect(find(events, "COUNTERS_PLACED")).toMatchObject({
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
    expect(find(events, "STATUS_APPLIED")).toBeDefined(); // Yawn DID resolve
    expect(done.players.p2.active?.damage).toBe(100); // still one hit from lethal
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The clause that is NOT printed — the whole reason the scan is board-wide.
// ─────────────────────────────────────────────────────────────────────────────

describe("no 'in the Active Spot' clause — a BENCHED holder retaliates", () => {
  it("a bench SNIPE that KOs the holder draws the full 40", () => {
    // ⚠️ THE SHARPEST DIFFERENCE FROM ROCKY HELMET, and it is a printed one:
    // sv01-193 says "is in the Active Spot" and sv03-197 does not. Spread Shot
    // puts 20 on each benched body; the holder is pre-damaged to 110 of its 120,
    // so the SNIPE — not the main hit — is what Knocks it Out.
    const state = equip(5, {
      holder: "fix-bigbody", // 200 HP Active, unarmed: it survives the 30 and pays nothing
      attacker: "fix-sniper",
      bench: [{ id: "fix-wall", tool: "sv03-197", damage: 110 }],
    });
    const benched = state.players.p2.bench[0]?.stack.at(-1) ?? "";
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    // The snipe KO'd the BENCHED holder…
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: benched });
    // …and the recoil landed anyway, because no clause confines it to the Active.
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1",
      amount: PUNCH_HP,
      source: "counterattack",
    });
    expect(attackerDamage(done)).toBe(PUNCH_HP);
    expect(done.players.p2.active?.damage).toBe(30); // the Active took the main hit and lived
  });

  it("Rocky Helmet on the BENCH pays nothing on the same snipe — the clause it does print", () => {
    // The control, and it is the printed asymmetry rather than an engine quirk:
    // Rocky Helmet's recoil is read at the §8.5 MAIN HIT (attack.ts), which only
    // the Active defender reaches, so a benched Rocky Helmet is inert. Both Tools
    // sit on the bench here; only one of them answers.
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

// ─────────────────────────────────────────────────────────────────────────────
// The SUM — D141's judgement, on the fifth printing.
// ─────────────────────────────────────────────────────────────────────────────

describe("two holders, one row — and two SITES, two rows", () => {
  it("a spread KOing TWO holders puts 80 on the attacker in ONE row", () => {
    // Each Tool prints its own sentence, so the amounts add — and the row that
    // carries them has ONE `source` slot, which is D141's whole argument for the
    // MECHANISM axis re-run on this printing. §7.4 allows one Tool per Pokémon,
    // so this board needs two BODIES and is entirely legal.
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
    expect(rows).toHaveLength(1); // ONE row…
    expect(rows[0]).toMatchObject({ seat: "p1", amount: 2 * PUNCH_HP, source: "counterattack" });
    expect(attackerDamage(done)).toBe(80); // …carrying both holders' 40
  });

  it("⚠️ only the holders that DIED pay — a surviving holder beside a dying one adds nothing", () => {
    // ⚠️ THE WITNESS FOR THE PER-BODY LETHAL CHECK, and it exists because a
    // mutation SURVIVED without it. Every other board in this file has either no
    // lethal body (where `koRecoilOf` short-circuits before it looks at anyone) or
    // ALL of its holders dying — so deleting the per-body `doomed.has(uid)` test
    // and paying for every holder on a board where ANYTHING died failed nothing.
    //
    // This is the only shape that separates them: TWO Vengeful Punch holders, one
    // Knocked Out by the main hit and one that takes the snipe and lives. The
    // truth is 40. The mutant says 80.
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
    // ⚠️ THE BOARD THAT SHOWS THE SITES ARE GENUINELY DIFFERENT. The Active wears
    // Rocky Helmet and merely takes damage (200 HP, survives) — it pays 20 at
    // attack.ts's §9. A benched body wears Vengeful Punch and is Knocked Out — it
    // pays 40 at flow.ts's §8.1 sweep. Two rows, in site order, under the SAME
    // `source` member: the label covers both, which is what D141 staked.
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
    expect(attackerDamage(done)).toBe(HELMET_HP + PUNCH_HP); // 60 in total
    // …and the §9 row really is first: the damage-conditioned site runs during the
    // attack, the KO-conditioned one in its epilogue.
    const order = types(events);
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("COUNTERS_PLACED"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ THE ORDERING — the whole risk of this slice, driven from every side.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ ORDER — the recoil is placed BEFORE the sweep reads the board", () => {
  it("the row order is COUNTERS_PLACED then KNOCKED_OUT — this family's existing narration", () => {
    // The printed condition is announced AFTER its consequence, and that is the
    // order rockyHelmet.test.ts has pinned since 0.57.0 for "even if it is Knocked
    // Out". A KO-conditioned member joining the family reads the same way, which
    // is consistency rather than a wart introduced here.
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

  it("⚠️ MUTUAL KO — a LETHAL recoil KOs the attacker in the SAME batch, and both prize", () => {
    // THE case the ordering exists for. The attacker is pre-damaged to 90 of its
    // 120, so the 40 recoil is lethal. Because the counters are placed before
    // `collectKnockOuts` reads the board, `lethalRefs` sees BOTH bodies and the
    // batch is simultaneous — §8.1's "if multiple Pokémon are KO'd simultaneously
    // … the attacking player takes prizes for the opponent's KO'd Pokémon".
    //
    // Moving the placement after the sweep leaves the attacker standing at 130
    // damage on a 120 HP body — a lethally-damaged Pokémon in play, which is not
    // a state this engine may reach.
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

  it("⚠️ the recoil's OWN KO is swept in the SAME pass — there is no second pass to cascade into", () => {
    // The cascade question, answered by construction rather than by a rule: the
    // counters land before the one sweep this attack gets, so a KO they cause is
    // in that sweep's batch. There is no state in which the engine has placed
    // these counters and not yet resolved what they did.
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
    // The other side of the same boundary: 79 damage + 40 = 119 on a 120 HP body
    // is one HP short, so only the defender's board is hit and the §14 tie guard
    // is never consulted. The recoil is FLAT, not proportional — it does not care
    // how nearly it killed.
    const state = equip(13, { tool: "sv03-197", holderDamage: 100, attackerDamage: 79 });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(attackerDamage(done)).toBe(119);
    expect(done.players.p1.active).not.toBeNull();
  });

  it("⚠️ the SIMULTANEOUS batch reaches the §14 TIE — both boards emptied at once", () => {
    // The strongest consequence of placing before the sweep, and the one an
    // after-the-sweep placement could not produce at all: when the holder is the
    // defender's last Pokémon and the recoil takes the attacker's last, BOTH
    // players lose at the same instant. `collectKnockOuts`' speculative tie guard
    // owns that, and it can only see it because both KOs are in ONE batch.
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
    expect(find(events, "GAME_OVER")?.outcome).toMatchObject({
      result: "tie",
      reasons: { p1: "noPokemon", p2: "noPokemon" },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ THE GUARD — three printed conditions, each discharged by the SITE.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ GUARD — 'by damage from an attack from your OPPONENT'S Pokémon'", () => {
  it("a POISON Knock Out at the Checkup does not fire it — 'by an attack'", () => {
    // The Checkup calls `collectKnockOuts` directly and never comes through
    // `finishAttack`, so a KO this Tool must ignore cannot reach the read site.
    // The holder is poisoned and one tick from lethal; the turn ends, §13 places
    // the poison counter, and the body dies with no recoil.
    let state = equip(31, { tool: "sv03-197", holderDamage: 110 });
    state = setConditions(state, "p2", { poisonDamage: 10 });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, { type: "endTurn", seat: "p1" });

    // The poison DID kill it (and says so in its own voice)…
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ seat: "p2", source: "poison" });
    expect(types(events)).toContain("KNOCKED_OUT");
    // …and the Tool paid nothing: no `counterattack` row anywhere.
    expect(recoils(events)).toEqual([]);
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("a holder on the ATTACKER'S OWN board pays nothing — 'from your OPPONENT'S Pokémon'", () => {
    // ⚠️ THE POSSESSIVE, DRIVEN ON A LEGAL BOARD. P1's attacker wears Vengeful
    // Punch and is Knocked Out during this very attack — by the DEFENDER's Rocky
    // Helmet recoil, which is not an attack from anyone's Pokémon and certainly
    // not from the holder's opponent. Only `otherSeat(attackerSeat)` is scanned,
    // so the 40 is never owed. The Rocky Helmet 20 that killed it is the only
    // recoil row on the board.
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
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p1", uid: attacker });
    expect(done.players.p2.active?.damage).toBe(30); // the holder survived its own hit
  });

  it("a holder that was never damaged by THIS attack cannot be lethal — 'by damage'", () => {
    // The third condition, and it is the one the site discharges most quietly: a
    // body can only be lethal on the defender's board at this sweep because this
    // attack put it there. Pre-existing damage that was ALREADY lethal is
    // impossible — it would have been swept when it landed — so a holder standing
    // at 110 of 120 through an attack that never touches it stays standing.
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

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ THE ADDRESSING SWEEP — asserted, not assumed.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ the Attacking Pokémon is a UID the epilogue CARRIES — D189 paid the price", () => {
  it("an attack program CAN now move its own actor off the spot — the sweep's premise is RETIRED", () => {
    // ⚠️ THIS CASE USED TO ASSERT THE OPPOSITE, AND THE INVERSION IS THE POINT.
    // Until D189 it read `expect(inAttacks.has("switchActive")).toBe(false)` and
    // said, in a comment kept verbatim below, exactly what would have to happen
    // the day it went red:
    //
    //     "The day this line goes red the fix is NOT to widen the sweep: it is to
    //      hand `finishAttack` the attacker's uid, which costs a required field on
    //      the `attackEpilogue` stage and therefore a MATCH_RECORD_VERSION bump."
    //
    // D189 turned it red — by deriving "Switch this Pokémon with 1 of your Benched
    // Pokémon." — and then did THAT and not something else. `finishAttack`'s
    // signature takes `attackerUid`, `PendingStage.attackEpilogue` carries a
    // REQUIRED `uid`, and `MATCH_RECORD_VERSION` went 11 → 12. What is left here
    // is the same sweep with its verdict inverted, plus (below) the board that
    // shows the addressing surviving the move — because an invariant that has been
    // deliberately broken must not leave a green test still claiming it holds.
    //
    // The sweep mirrors preventBlock.test.ts's `attackOpKinds` deliberately, so
    // the two agree about what "every attack op" means: BOTH sources an attack has
    // — the DERIVED program off printed text and the registry's authored `attack`
    // map — descended through every gate that can nest ops.
    //
    // ⚠️ WHAT THIS SWEEP DOES NOT TRAVERSE, said rather than left to be found: it
    // walks `FIXTURE_POOL`, so a registry program whose id has no fixture is
    // invisible to it — the same blind spot preventBlock.test.ts's own TOTAL
    // classification table has, which is what makes that table a SECOND and
    // independent enforcement (its `switchActive` row is now a classification AND
    // a driven probe, added by the same slice).
    // 🆕 D276 — THROUGH THE SHARED `walkProgram`, so "descended through every gate
    // that can nest ops" is now TRUE rather than aspirational: the hand-rolled
    // recursion this replaces named three gates and missed `optional`, under which
    // `fix-trainerops`'s tenth attack hides an `opponentSwitchOut` this very set
    // was meant to enumerate.
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

    expect(inAttacks.size).toBeGreaterThan(10); // the sweep found real programs
    // ⚠️ THE INVERSION. `switchActive` is now reachable from ATTACK text, which is
    // precisely the condition the old assertion existed to detect.
    expect(inAttacks.has("switchActive")).toBe(true);
    // …and it arrives from the DERIVER rather than from a registry row, which is
    // the half that made the old sweep necessary: an authored program is written
    // by someone who read this file, a derived one appears the moment a regex is
    // added. Both spellings derive, bare and coin-gated.
    expect(deriveAttackEffect("Switch this Pokémon with 1 of your Benched Pokémon.")).toEqual([
      { op: "switchActive" },
    ]);
    expect(
      deriveAttackEffect(
        "Flip a coin. If heads, switch this Pokémon with 1 of your Benched Pokémon.",
      ),
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
    ).toEqual([{ op: "coinFlipGate", then: [{ op: "switchActive" }] }]);
    // The Trainer seam it came from is untouched — the op is now on BOTH seams,
    // which is the whole shape of D189 (a reader, not a new primitive).
    expect(inTrainers.has("switchActive")).toBe(true);
    expect(programFor("sv01-194")?.trainer).toEqual([{ op: "switchActive" }]);
  });

  it("⚠️ THE DEFECT BOARD: the attacker self-switches and the 40 STILL lands on IT, not on the promoted body", () => {
    // ⚠️ THE CASE D181 PREDICTED IN PROSE AND REFUSED TO MAKE REACHABLE. P1 attacks
    // with "Spin Turn" ({C}, 10, "Switch this Pokémon with 1 of your Benched
    // Pokémon."): the 10 Knocks Out P2's Vengeful Punch holder, the attack's own
    // effect program then swaps P1's attacker onto its own Bench, and only THEN
    // does the epilogue place the Tool's 4 counters.
    //
    // A build that reads `players[attackerSeat].active` here — which is what this
    // engine did until D189 — puts the 40 on the body that was just PROMOTED into
    // the spot, a Pokémon that never attacked and that the printed sentence says
    // nothing about. The two bodies are asserted SEPARATELY and in both
    // directions, so the case cannot pass by the counters merely existing.
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
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    // …the switch happened: the body that ATTACKED is on P1's Bench now, and the
    // body standing in the spot is the one that was benched.
    expect(done.players.p1.active?.stack.at(-1)).toBe(benchUid);
    expect(done.players.p1.bench[0]?.stack.at(-1)).toBe(attackerUid);
    // …and the 40 went with the ATTACKER, onto the Bench.
    const rows = recoils(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seat: "p1", uid: attackerUid, amount: PUNCH_HP });
    expect(done.players.p1.bench[0]?.damage).toBe(PUNCH_HP);
    // ⚠️ AND THE PROMOTED BODY IS CLEAN — the assertion the old addressing fails.
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("⚠️ ORDERING WITNESS: a LETHAL recoil after a self-switch KOs on the BENCH, so P1 is never asked to promote", () => {
    // ⚠️ A WITNESS THAT DOES NOT COMMUTE, which is what an ordering claim owes.
    // The claim is "the attack's effect program runs BEFORE the §8.1 epilogue".
    // The previous case shows WHICH BODY takes the counters; this one shows that
    // the two orders differ in the SHAPE OF THE TURN TAIL, which no amount of
    // uid-following could paper over.
    //
    // P1's attacker is at 90 of 120 and takes the 40 → 130, lethal. Because the
    // switch already happened it dies ON THE BENCH: P1's Active is the promoted
    // survivor, so P1 owes NO promotion. Run the epilogue first instead and the
    // attacker dies in the ACTIVE SPOT, which forces a `promote` stage for P1 and
    // a ko:promote interrupt — a different pending queue and a different phase.
    // Both boards are legal and they disagree observably, so the order is proved
    // rather than asserted.
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
    // ⚠️ THE NON-COMMUTING HALF: P1 is never asked to promote, because P1's Active
    // is alive. Only P2 (whose Active died) is. Under the other order P1's Active
    // would be the corpse and this queue would carry a second promotion.
    const promotes = done.pending.filter((s) => s.kind === "promote");
    expect(promotes.map((s) => s.seat)).not.toContain("p1");
    if (done.phase.kind === "ko:promote") expect(done.phase.seat).toBe("p2");
    expect(
      done.players.p1.active?.stack.at(-1) === benchUid || done.phase.kind === "ko:promote",
    ).toBe(true);
  });

  it("the epilogue STAGE carries the attacker's uid across a park — the repair, structurally", () => {
    // The field itself, read off a real parked board rather than off the type. The
    // self-switch parks whenever P1 has ≥ 2 Benched bodies (`parkOrForce`), and the
    // stage sitting behind that park is what `finishAttack` will be handed when the
    // pick lands — so this is the persisted shape the MATCH_RECORD_VERSION bump
    // (11 → 12) was paid for.
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
      // 🆕 D394 — and the ATTACK beside it, captured at the same instant and for the
      // same reason: `finishAttack` cannot re-derive either one after a park.
      attack: "Spin Turn",
    });
    // …and it is the ATTACKER's uid, not the spot's — the two are still the same
    // body here (the switch has not resolved yet), which is exactly why this case
    // asserts the DECLARED uid rather than reading the Active back.
    expect(attackerUid).toBe(find(mustApply(state, { type: "attack", seat: "p1", index: SPIN_TURN }).events, "ATTACK_DECLARED")?.uid);
  });

  it("⚠️ PINNED ABSENCE: only the STAGE path can see a moved actor — the other four are equivalent", () => {
    // ⚠️ AN EQUIVALENT MUTANT, RECORDED RATHER THAN HIDDEN. `finishAttack` has
    // FIVE call sites and the uid is load-bearing on exactly ONE. `attack.ts`'s
    // four DIRECT calls (confusion tails, the D125 requirement gate, cancel-on-
    // tails, and the no-effect-program tail) all sit strictly BEFORE any effect
    // program runs, so the declared attacker is still the Active at each of them
    // and re-reading the spot there is behaviour-identical — MEASURED at D189 by
    // mutating one of them, which failed nothing across the whole suite.
    //
    // The standing rule says an absence like that is PINNED rather than covered by
    // a case that passes while asserting nothing. So this pins the structural
    // reason instead of faking a witness: an attack can only move its own actor
    // through its EFFECT PROGRAM, and an attack with an effect program NEVER takes
    // a direct call — `attack.ts` queues the `attackEpilogue` stage and hands the
    // program to `settleProgram` with `resumeTail`. Every self-switching printing
    // therefore reaches the epilogue through the stage, which is the site that
    // carries the uid.
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
    // The event names WHICH Pokémon took the counters, and it is the attacker's
    // stack top — the same uid the ATTACK_DECLARED row carries.
    const state = equip(18, { tool: "sv03-197", holderDamage: 100 });
    const attacker = state.players.p1.active?.stack.at(-1) ?? "";
    deepFreeze(state);

    const { events } = mustApply(state, bite);

    expect(find(events, "COUNTERS_PLACED")?.uid).toBe(attacker);
    expect(find(events, "ATTACK_DECLARED")?.uid).toBe(attacker);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ THE VOICE — rendered under BOTH seats and READ.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ VOICE — the row is SYSTEM-voiced, and the alternative was read", () => {
  it("renders as a system row, never under the attacker's name", () => {
    // ⚠️ D141's REASON, RE-ASKED FOR A KO-CONDITIONED ROW AND UNCHANGED. `seat` on
    // COUNTERS_PLACED owns the DAMAGED Pokémon — here the ATTACKER — while the
    // causer is the defender's dying holder. Rows render after their seat's name,
    // so an active-voice row under `seat` would read as the attacker damaging
    // itself: the mirror of D136's finding 1. The KO condition changes WHO caused
    // it not at all; it only changes when.
    const state = equip(19, { tool: "sv03-197", holderDamage: 100 });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);
    const rendered = render(events, done);
    const row = rendered.find((r) => r.text.startsWith("Counterattack:"));

    expect(row).toBeDefined();
    expect(row?.who).toBe("system");
    expect(row?.text).toBe("Counterattack: 40 damage to fix-attacker");
    // ⚠️ AND THE ALTERNATIVE WAS RENDERED AND READ RATHER THAN ARGUED AWAY. Under
    // `seat` the very same row reads "P1 — Counterattack: 40 damage to
    // fix-attacker", crediting the player whose Pokémon just dealt the killing
    // blow with putting damage on their OWN attacker. The effect belongs to P2,
    // whose Pokémon died; naming either seat is wrong, which is what leaves
    // "system" as the only honest voice.
    expect(rendered.every((r) => !(r.who === "p1" && r.text.includes("Counterattack")))).toBe(true);
    expect(rendered.every((r) => !(r.who === "p2" && r.text.includes("Counterattack")))).toBe(true);
  });

  it("both seats are shown the same row — the recoil hides nothing", () => {
    const state = equip(20, { tool: "sv03-197", holderDamage: 100 });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);
    // `logFromEvents` renders ONE seat-tagged stream; the `who` on each row is
    // what a client uses to place it, so "both seats see it" is the claim that
    // the row is tagged `system` rather than owned by either player.
    const rows = render(events, done).map((r) => `${r.who}|${r.text}`);

    expect(rows).toContain("system|Counterattack: 40 damage to fix-attacker");
    expect(rows.filter((r) => r.includes("Counterattack"))).toHaveLength(1);
  });

  it("it does NOT read like the attacker's own recoil, which uses this event too", () => {
    // `COUNTERS_PLACED` also carries `source: "self"` for an attack damaging
    // ITSELF (Skeledirge "Blazing Shout") — the opposite direction, rendered in
    // the attacker's own voice. The two must not collide, and the mechanism label
    // is what keeps them apart.
    const state = equip(21, { tool: "sv03-197", holderDamage: 100 });
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);
    const row = render(events, done).find((r) => r.text.startsWith("Counterattack:"));

    expect(row?.text).not.toContain("itself");
    expect(row?.who).not.toBe("p1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The family census, as an assertion.
// ─────────────────────────────────────────────────────────────────────────────

describe("the §9 recoil family, closed on its always-on half", () => {
  it("all five always-on printings are authored, and none needed a new `source`", () => {
    // Cacnea / Cacturne / Stunfisk (Abilities), Rocky Helmet / Vengeful Punch
    // (Tools). Every one of them produces `source: "counterattack"` — three kinds
    // of card, two read sites, ONE member, which is the test D141 set for its own
    // judgement and the fifth consecutive printing to pass it.
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
    // 🛑 **THIS RUNG WAS A REFUSAL WITH AN EXECUTABLE FALSIFIER, AND THE FALSIFIER HAD
    // BEEN TRUE FOR ~29 SLICES BEFORE ANYBODY CHECKED IT (D413's rule, re-paid).** It
    // read: *"what it needs is the damage-dealt CHANNEL … which does not exist. Do it
    // AFTER that channel, never before."* **`EffectContext.dealt` and `heal.amount:
    // "dealt"` landed at D427.** The channel this rung was waiting for existed, was
    // named, and the rung went on saying it did not — which is exactly the shape D422
    // measured at ~195 decisions and D413 at a whole population.
    //
    // ⚠️ **AND THE PRICE THIS RUNG QUOTED WAS THE WRONG PRICE ANYWAY.** D456 did not use
    // `EffectContext` at all: the §9 recoil site has the figure as a LOCAL (`dealt`, the
    // one its own `dealt > 0` gate reads), so the cost was ONE required parameter on
    // `installedRecoilOf` — not a channel, not a record, not a version bump. **A refusal
    // that names a PRICE hands its successor a number to inherit instead of measure**
    // (D427's "mark a price AS a price"), and this one over-quoted by a whole mechanism.
    //
    // ⚠️ **THE STRING IT ASSERTED WAS ALSO A PARAPHRASE**: it spelled *"(even if **it**
    // is Knocked Out)"* and corpus line 180 prints *"(even if **this Pokémon** is)"*.
    // Both are asserted below, the printed one first.
    // 🆕 And the WARNING it gave was correct and was heeded: *"a prefix-happy anchor
    // would ship a 0-HP trap under a card that prints a real one."* D456 used a SECOND
    // whole-sentence anchor with no capture rather than loosening the first.
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
    // The same antecedent this slice built a read site for — "…is Knocked Out by
    // damage from an attack from your opponent's Pokémon" — is printed on three
    // more D1 rows with a different consequent: Munkidori ex sv06.5-037/-083/-091
    // "Oh No You Don't" denies a Prize instead of placing counters. It is the next
    // consumer of the §8.1 sweep and is NOT taken here; the pin exists so the day
    // it lands, this file notices that the site was already built for it.
    expect(programFor("sv06.5-037")?.passive?.damageAttackerOnKo).toBeUndefined();
    expect(programFor("sv06.5-083")?.passive?.damageAttackerOnKo).toBeUndefined();
    expect(programFor("sv06.5-091")?.passive?.damageAttackerOnKo).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What this slice did NOT change.
// ─────────────────────────────────────────────────────────────────────────────

describe("the blast radius, asserted as absences", () => {
  it("adds NO EffectOp — so the §11 classification table is untouched", () => {
    // The whole slice is a `PassiveEffects` field plus a read site. `preventBlock`
    // .test.ts's table is TOTAL over the ops an attack can derive, and an op this
    // slice does not add cannot owe it a verdict. Stated rather than assumed: the
    // sweep there discovers ops off `programFor(id).attack`, and this registry row
    // has no `attack` key at all.
    expect(programFor("sv03-197")?.attack).toBeUndefined();
    expect(Object.keys(programFor("sv03-197") ?? {})).toEqual(["passive"]);
  });

  it("gates NO action — every declaration stays legal beside an armed holder", () => {
    // The field is read once, in the attack epilogue. It cannot refuse an attack,
    // a retreat or a Tool attachment, so it owes `redact.ts`'s `redactedAttacksOf`
    // and `GameHud` nothing. Driven: the attacker declares and resolves normally
    // against a holder that is one hit from paying 40.
    const state = equip(22, { tool: "sv03-197", holderDamage: 100 });
    deepFreeze(state);

    const result = mustApply(state, bite);
    expect(find(result.events, "ATTACK_DECLARED")).toBeDefined();
    expect(types(result.events)).not.toContain("ATTACK_FAILED");
  });

  it("touches no persisted shape — `PassiveEffects` is CATALOG, not state", () => {
    // ⚠️ THE PARK-OR-PERSIST ANSWER, ASSERTED. D124's trigger is a REQUIRED key on
    // `InPlayPokemon`; this slice adds none. `damageAttackerOnKo` lives on the
    // registry's `PassiveEffects`, which is derived from the card id on every
    // read — nothing about it is written into a match record, so a record from the
    // previous deploy describes this build's bodies exactly. Hence no
    // MATCH_RECORD_VERSION bump. The absence is pinned the only way a test can:
    // an in-play body carries no field of this name.
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
