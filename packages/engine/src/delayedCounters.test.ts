import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import { applyAction, otherSeat, programFor } from "./index";
import type { EffectOp, GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
  types,
  findEvent,
  driveSetup,
  roundTrip,
} from "./testFixtures";
import { koByEffectMarker, scheduledEffectDue, withActive } from "./types";

const SENTENCE =
  "At the end of your opponent's next turn, put 9 damage counters on the Defending Pokémon.";
const SIBLING_DISCARD =
  "At the end of your opponent's next turn, discard the Defending Pokémon and all attached cards.";
const SIBLING_KO =
  "Discard all Energy from this Pokémon. At the end of your opponent's next turn, the Defending Pokémon will be Knocked Out.";
const SIBLING_KO_TAIL =
  "At the end of your opponent's next turn, the Defending Pokémon will be Knocked Out.";

const DELAY = 0;
const PLAIN = 1; // {C}, NO damage, NO effect — the ONE-AXIS control
const DISCARD = 2;
const POISON = 3; // {C}, NO damage, "…is now Poisoned." — the ordering board's other clock
const SMASH = 4; // {C}, 90 damage, NO effect — the ATTACK-KO control for the cause rung
const DEVOLVE = 5;
const DOOM = 6;
const COMPOUND = 7;
const NEAR_MISS = 8; // {C}, NO damage, a constructed unclaimed sentence — the loud witness

const NEAR_MISS_TEXT =
  "During your opponent's next turn, put 9 damage counters on the Defending Pokémon.";

const LOCAL_CARDS: Record<string, Card> = {
  "fix-doom": battler("fix-doom", {
    types: ["Colorless"],
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Doom Clock", effect: SENTENCE },
      { cost: ["Colorless"], name: "Plain Clock" },
      { cost: ["Colorless"], name: "Doom Sweep", effect: SIBLING_DISCARD },
      {
        cost: ["Colorless"],
        name: "Doom Venom",
        effect: "Your opponent's Active Pokémon is now Poisoned.",
      },
      { cost: ["Colorless"], name: "Doom Smash", damage: 90 },
      {
        cost: ["Colorless"],
        name: "Doom Regression",
        effect:
          "Devolve each of your opponent's evolved Pokémon by shuffling the highest Stage Evolution card on it into your opponent's deck.",
      },
      { cost: ["Colorless"], name: "Doom Sentence", effect: SIBLING_KO_TAIL },
      { cost: ["Colorless"], name: "Doom Purge", effect: SIBLING_KO },
      { cost: ["Colorless"], name: "Doom Miss", effect: NEAR_MISS_TEXT },
    ],
  }),
  /** 90 HP EXACTLY — nine counters is lethal to the digit, so the KO cannot be
      satisfied by an accidental extra source. No Weakness and no Resistance, so 90
      placed is 90 taken. */
  "fix-doomed": battler("fix-doomed", { types: ["Colorless"], hp: 90, retreat: 1 }),
  /** The Stage 1 the victim evolves into — §7's EVOLVE clear, which for this field
      is a played line rather than a theoretical one. */
  "fix-doomed-s1": battler("fix-doomed-s1", {
    types: ["Colorless"],
    hp: 160,
    retreat: 1,
    stage: "Stage1",
    evolveFrom: "fix-doomed",
  }),
  /** 300 HP — the NON-KO control, and the ordering board's body (it must survive
      90 delayed + 10 poison + 20 burn without the batch's KO sweep firing). */
  "fix-doom-tank": battler("fix-doom-tank", { types: ["Colorless"], hp: 300, retreat: 1 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DOOM_DECK = deckOf({
  "fix-doom": 8,
  "fix-doomed": 8,
  "fix-doomed-s1": 4,
  "fix-doom-tank": 6,
  "sv01-194": 4,
  "sv03-197": 4,
  "fix-mist-energy": 4,
  "fix-titan": 6,
  "fix-energy": 16,
});

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function count(events: GameEvent[], type: GameEvent["type"]): number {
  return events.filter((e) => e.type === type).length;
}

function body(pokemon: InPlayPokemon | null | undefined): InPlayPokemon {
  if (pokemon === null || pokemon === undefined) throw new Error("expected a Pokémon");
  return pokemon;
}

/** The stack-BOTTOM uid — the identity a body keeps across an evolution, and the
    uid every event in this suite names for an unevolved one. */
function baseUid(pokemon: InPlayPokemon | null | undefined): string {
  const uid = body(pokemon).stack[0];
  if (uid === undefined) throw new Error("expected a non-empty stack");
  return uid;
}

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DOOM_DECK, p2: DOOM_DECK }, { pool: POOL, first });
}

function armed(installer: Seat, victimCard = "fix-doomed", seed = 4): GameState {
  const victimSeat = otherSeat(installer);
  let state = localSetup(seed, victimSeat);
  state = mustApply(state, { type: "endTurn", seat: victimSeat }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, victimSeat, victimCard);
  state = setActiveFromDeck(state, installer, "fix-doom");
  state = attachFromDeck(state, installer, "fix-energy", 1);
  state = attachFromDeck(state, victimSeat, "fix-energy", 1);
  state = clearBench(state, victimSeat);
  return benchFromDeck(state, victimSeat, "fix-titan");
}

/** The installer declares `index` on turn 2 (which ENDS its turn, §5.3). */
function install(installer: Seat, index = DELAY, victimCard = "fix-doomed", seed = 4) {
  return mustApply(armed(installer, victimCard, seed), {
    type: "attack",
    seat: installer,
    index,
  });
}

/** The victim ends turn 3 — the Checkup that follows is the one the schedule names. */
function endVictimTurn(state: GameState, victimSeat: Seat) {
  expect(state.turn).toBe(3);
  return mustApply(state, { type: "endTurn", seat: victimSeat });
}

function poisonKoOnInstallersTurn() {
  return mustApply(setDamage(armed("p1"), "p2", 80), { type: "attack", seat: "p1", index: POISON });
}

/** Rendered log rows as `{ who, text }`, the idiom every sibling suite uses. */
function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ana", p2: "Ben" }, state, elapsed: "+00:14" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((seg) => seg.text).join("") }],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the sentence, the family, and what does NOT compose.
// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — one sentence, three printings, and the family read to its edges", () => {
  it("the corpus carries the sentence at 3 legal printings, off the live corpus", () => {
    const rows = legalAttackCorpus().filter(([, text]) => text === SENTENCE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(3);
  });

  it("the WHOLE family is three sentences / six printings — the loosest pattern, every hit read", () => {
    const hits = legalAttackCorpus().filter(([, text]) => /at the end of/i.test(text));
    expect(hits.map(([, text]) => text).sort()).toEqual(
      [SIBLING_DISCARD, SENTENCE, SIBLING_KO].sort(),
    );
    expect(hits.reduce((sum, [units]) => sum + units, 0)).toBe(6);
  });

  it("the LOOSER stem `/end of/i` catches a fourth row, and it is a DURATION, not a schedule", () => {
    const wider = legalAttackCorpus().filter(([, text]) => /end of/i.test(text));
    const extra = wider.map(([, text]) => text).filter((t) => !/at the end of/i.test(t));
    expect(extra).toEqual([
      "Until the end of your next turn, the Defending Pokémon's Weakness is now {C}. (The amount of Weakness doesn't change.)",
    ]);
  });

  it("D435 — all THREE payloads derive, and each to its OWN op", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual([{ op: "scheduleCounters", amount: 90 }]);
    expect(deriveAttackEffect(SIBLING_DISCARD)).toEqual([{ op: "scheduleDiscard" }]);
    expect(deriveAttackEffect(SIBLING_KO_TAIL)).toEqual([{ op: "scheduleKnockOut" }]);
    expect(resolvedByAnyReader(SENTENCE)).toBe(true);
    expect(resolvedByAnyReader(SIBLING_DISCARD)).toBe(true);
    expect(resolvedByAnyReader(SIBLING_KO_TAIL)).toBe(true);
    expect(resolvedByAnyReader(SIBLING_KO)).toBe(false);
  });

  it("ROW 113 COMPOSES — the split's exact halves, and the exact composed program", () => {
    expect(splitAttackTrailingClause(SIBLING_KO)).toEqual({
      head: "Discard all Energy from this Pokémon.",
      tail: SIBLING_KO_TAIL,
    });
    // …and each half on its own axis, so a failure names WHICH half moved.
    expect(deriveAttackEffect("Discard all Energy from this Pokémon.")).not.toBeNull();
    expect(deriveAttackEffect(SIBLING_KO_TAIL)).toEqual([{ op: "scheduleKnockOut" }]);
    const composed = install("p1", COMPOUND);
    expect(count(composed.events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    expect(body(composed.state.players.p1.active).energy).toEqual([]);
    expect(body(composed.state.players.p2.active).scheduledEffect).toEqual({
      turn: 3,
      kind: "knockOut",
    });
  });

  it("no gate clause hides inside the sentence either", () => {
    expect(splitAttackGateClause(SENTENCE)).toBeNull();
    expect(splitAttackTrailingClause(SENTENCE)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the anchor claims the sentence WHOLE, and each near-miss differs on ONE axis.
// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — the anchor's edges, one axis at a time", () => {
  it("the printed 9 is a CAPTURE — other counts derive, and 0 is refused", () => {
    expect(deriveAttackEffect(SENTENCE.replace("9 damage", "3 damage"))).toEqual([
      { op: "scheduleCounters", amount: 30 },
    ]);
    expect(deriveAttackEffect(SENTENCE.replace("9 damage", "12 damage"))).toEqual([
      { op: "scheduleCounters", amount: 120 },
    ]);
    expect(deriveAttackEffect(SENTENCE.replace("9 damage", "0 damage"))).toBeNull();
  });

  it("the possessive apostrophe is a CLASS — both bytes derive identically", () => {
    expect(SENTENCE.includes("opponent's")).toBe(true);
    expect(deriveAttackEffect(SENTENCE.replace("opponent's", "opponent’s"))).toEqual([
      { op: "scheduleCounters", amount: 90 },
    ]);
  });

  it("each near-miss differs on exactly ONE axis, and every one is refused", () => {
    const misses = [
      // the CLOCK: during, not at the end of
      SENTENCE.replace("At the end of your opponent's", "During your opponent's"),
      // the SEAT: your own next turn
      SENTENCE.replace("your opponent's next turn", "your next turn"),
      // the SUBJECT: this Pokémon, not the Defending one
      SENTENCE.replace("the Defending Pokémon", "this Pokémon"),
      // the PAYLOAD: heal, not put
      SENTENCE.replace("put 9 damage counters on", "heal 90 damage from"),
      // the UNIT: damage, not counters
      SENTENCE.replace("9 damage counters on", "90 damage to"),
    ];
    for (const text of misses) expect(deriveAttackEffect(text), text).toBeNull();
    // …and the ADMITTED control on the same axis, so the rung above cannot pass by
    // a reader that refuses everything.
    expect(deriveAttackEffect(SENTENCE)).not.toBeNull();
  });

  it("the anchor is whole-sentence — a prefix or a suffix is refused", () => {
    expect(deriveAttackEffect(`Draw a card. ${SENTENCE}`)).toBeNull();
    expect(deriveAttackEffect(`${SENTENCE} Draw a card.`)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — what the INSTALL writes, and what it announces.
// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — the schedule lands on the DEFENDING Pokémon with the opponent's turn stamped", () => {
  it("the record is `{ turn: state.turn + 1, amount: 90 }` on the DEFENDER's Active", () => {
    const { state, events } = install("p1");
    const scheduled = body(state.players.p2.active).scheduledEffect;
    expect(scheduled).toEqual({ turn: 3, kind: "counters", amount: 90 });
    // …and the INSTALLER's own body carries nothing: bare means the defender.
    expect(body(state.players.p1.active).scheduledEffect).toBeNull();
    const row = findEvent(events, "EFFECT_SCHEDULED");
    expect(row).toEqual({
      type: "EFFECT_SCHEDULED",
      seat: "p2",
      uid: baseUid(state.players.p2.active),
      scheduled: { turn: 3, kind: "counters", amount: 90 },
    });
  });

  it("the reader answers only on the stamped turn — driven in both directions", () => {
    const pokemon = body(install("p1").state.players.p2.active);
    expect(scheduledEffectDue(pokemon, 2)).toBeNull();
    expect(scheduledEffectDue(pokemon, 3)).toEqual({ turn: 3, kind: "counters", amount: 90 });
    expect(scheduledEffectDue(pokemon, 4)).toBeNull();
    // …and an unscheduled body answers `null` for every turn, which is what makes
    // "no schedule" and "a spent schedule" one answer at the read site.
    const fresh = body(armed("p1").players.p2.active);
    expect(fresh.scheduledEffect).toBeNull();
    expect(scheduledEffectDue(fresh, 3)).toBeNull();
  });

  it("the log row names the amount in HP and the turn from the VICTIM's side", () => {
    const { state, events } = install("p1");
    expect(render(events, state).find((r) => r.text.includes("scheduled"))).toEqual({
      who: "p2",
      text: "fix-doomed has 90 damage scheduled for the end of your next turn",
    });
  });

  it("no ATTACK_EFFECT_SKIPPED for any of the THREE payloads — and a near-miss IS skipped", () => {
    expect(count(install("p1").events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    expect(count(install("p2").events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    expect(count(install("p1", DISCARD).events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    expect(count(install("p1", DOOM).events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    const skipped = install("p1", NEAR_MISS);
    expect(count(skipped.events, "ATTACK_EFFECT_SKIPPED")).toBe(1);
    expect(findEvent(skipped.events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(NEAR_MISS_TEXT);
    expect(body(skipped.state.players.p2.active).scheduledEffect).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the FIRING: it survives the opponent's turn and lands at the end of it.
// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — the counters land at the end of the victim's own next turn", () => {
  for (const installer of ["p1", "p2"] as const) {
    const victim = otherSeat(installer);
    it(`both seats — ${installer} schedules, ${victim} takes 90 at the end of turn 3`, () => {
      const installed = install(installer, DELAY, "fix-doom-tank");
      // It SURVIVES the Checkup that ends the installing turn: the stamp is 3 and
      // that Checkup runs at turn 2. This is the off-by-one the shape invites.
      expect(body(installed.state.players[victim].active).damage).toBe(0);
      expect(body(installed.state.players[victim].active).scheduledEffect).toEqual({
        turn: 3,
        kind: "counters",
        amount: 90,
      });
      const fired = endVictimTurn(installed.state, victim);
      const placed = all(fired.events, "COUNTERS_PLACED").filter((e) => e.source === "delayed");
      expect(placed).toEqual([
        {
          type: "COUNTERS_PLACED",
          seat: victim,
          uid: baseUid(installed.state.players[victim].active),
          amount: 90,
          source: "delayed",
        },
      ]);
      expect(body(fired.state.players[victim].active).damage).toBe(90);
      expect(fired.state.turn).toBe(4);
    });
  }

  it("it fires ONCE — the turn after is silent, with no clear site anywhere", () => {
    const installer: Seat = "p1";
    const victim: Seat = "p2";
    const fired = endVictimTurn(install(installer, DELAY, "fix-doom-tank").state, victim);
    // The stamp is STILL on the body — nothing cleared it, which is the design
    // (`attackLockedTurn`'s rule: a stamp expires by arithmetic).
    expect(body(fired.state.players[victim].active).scheduledEffect).toEqual({
      turn: 3,
      kind: "counters",
      amount: 90,
    });
    expect(scheduledEffectDue(body(fired.state.players[victim].active), fired.state.turn)).toBe(
      null,
    );
    // Two more turn boundaries, and the damage total never moves again.
    let state = mustApply(fired.state, { type: "endTurn", seat: installer }).state;
    state = mustApply(state, { type: "endTurn", seat: victim }).state;
    expect(body(state.players[victim].active).damage).toBe(90);
  });

  it("the PLAIN control schedules nothing and the Checkup places nothing", () => {
    const installed = install("p1", PLAIN, "fix-doom-tank");
    expect(body(installed.state.players.p2.active).scheduledEffect).toBeNull();
    const fired = endVictimTurn(installed.state, "p2");
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
    expect(body(fired.state.players.p2.active).damage).toBe(0);
  });

  it("the log row is a SYSTEM row, like Poison — not the victim's own voice", () => {
    const installed = install("p1", DELAY, "fix-doom-tank");
    const fired = endVictimTurn(installed.state, "p2");
    expect(render(fired.events, fired.state).find((r) => r.text.startsWith("Delayed:"))).toEqual({
      who: "system",
      text: "Delayed: 90 damage to fix-doom-tank",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — ORDERING against the §13 condition steps.
// ─────────────────────────────────────────────────────────────────────────────
describe("§5 — a body that is Poisoned, Burned and Asleep takes the delayed counters FIRST", () => {
  function loaded(): GameState {
    const installed = install("p1", DELAY, "fix-doom-tank").state;
    return setConditions(installed, "p2", {
      poisonDamage: 10,
      burned: true,
      rotation: "asleep",
      confusionDamage: 30,
    });
  }

  it("the DELAYED row precedes poison, burn and the wake-up flip", () => {
    const fired = endVictimTurn(loaded(), "p2");
    const names = types(fired.events);
    const order = names.slice(names.indexOf("TURN_ENDED"));
    // The first four rows after the turn ends, in the engine's fixed §13 sequence
    // with the end-of-turn placement ahead of it.
    expect(order.slice(0, 5)).toEqual([
      "TURN_ENDED",
      "COUNTERS_PLACED",
      "COUNTERS_PLACED", // §13.1 Poison — "During Pokémon Checkup"
      "COUNTERS_PLACED", // §13.2 Burn
      "CHECKUP_COIN_FLIP", // §13.2's cure flip
    ]);
    expect(all(fired.events, "COUNTERS_PLACED").map((e) => [e.source, e.amount])).toEqual([
      ["delayed", 90],
      ["poison", 10],
      ["burn", 20],
    ]);
    // …and the board is the sum, which is the half the ordering canNOT change:
    // damage is additive and the KO sweep runs once, for the whole batch.
    expect(body(fired.state.players.p2.active).damage).toBe(120);
  });

  it("the ordering is a DECISION, and the control is the same board without the schedule", () => {
    const bare = setConditions(install("p1", PLAIN, "fix-doom-tank").state, "p2", {
      poisonDamage: 10,
      burned: true,
      rotation: "asleep",
      confusionDamage: 30,
    });
    const fired = mustApply(bare, { type: "endTurn", seat: "p2" });
    expect(all(fired.events, "COUNTERS_PLACED").map((e) => e.source)).toEqual(["poison", "burn"]);
    expect(body(fired.state.players.p2.active).damage).toBe(30);
  });

  it("§13.4's paralysis clear still keys on the ended seat, with the schedule in flight", () => {
    const paralyzed = setConditions(install("p1", DELAY, "fix-doom-tank").state, "p2", {
      rotation: "paralyzed",
    });
    const fired = endVictimTurn(paralyzed, "p2");
    expect(body(fired.state.players.p2.active).conditions.rotation).toBe("none");
    expect(body(fired.state.players.p2.active).damage).toBe(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the KNOCK OUT: the Prize, the promotion, and the CAUSE.
// ─────────────────────────────────────────────────────────────────────────────
describe("§6 — 90 counters onto a 90 HP body, between turns", () => {
  /** `fix-doomed` is 90 HP and the schedule is 90, so the placement is lethal to the
      digit — and it happens on the OPPONENT's turn, with no attack in flight. */
  function killed(installer: Seat = "p1") {
    const victim = otherSeat(installer);
    return { victim, fired: endVictimTurn(install(installer).state, victim) };
  }

  it("the body is Knocked Out by the Checkup's own sweep — no new KO machinery", () => {
    const { victim, fired } = killed();
    expect(findEvent(fired.events, "KNOCKED_OUT")?.seat).toBe(victim);
    expect(count(fired.events, "KNOCKED_OUT")).toBe(1);
    // The prize pick is OWED to the installer and PARKS — six prizes, one to take.
    expect(findEvent(fired.events, "PRIZES_OWED")).toEqual({
      type: "PRIZES_OWED",
      seat: "p1",
      count: 1,
    });
    expect(fired.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });

  it("the Prize goes to the INSTALLER and the victim promotes — both driven", () => {
    const { victim, fired } = killed();
    const taken = mustApply(fired.state, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    });
    expect(findEvent(taken.events, "PRIZES_TAKEN")?.seat).toBe("p1");
    expect(taken.state.players.p1.prizes).toHaveLength(5);
    // The lone benched `fix-titan` is a FORCED promotion and auto-resolves.
    expect(findEvent(taken.events, "POKEMON_PROMOTED")?.seat).toBe(victim);
    expect(taken.state.players[victim].bench).toHaveLength(0);
    expect(taken.state.cardIdByUid[baseUid(taken.state.players[victim].active)]).toBe("fix-titan");
    // …and the game moves on to the installer's turn, the Checkup having finished.
    expect(taken.state.turn).toBe(4);
    expect(taken.state.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("the NON-KO control differs on ONE axis — a 300 HP body takes the same 90 and lives", () => {
    const fired = endVictimTurn(install("p1", DELAY, "fix-doom-tank").state, "p2");
    expect(count(fired.events, "KNOCKED_OUT")).toBe(0);
    expect(body(fired.state.players.p2.active).damage).toBe(90);
  });

  it("THE CAUSE — `byAttack` is FALSE, which is attack-applied POISON's shipped answer", () => {
    const { victim, fired } = killed();
    expect(count(fired.events, "KNOCKED_OUT")).toBe(1);
    expect(fired.state.lastKoMarks[victim]).toEqual([]);
    expect(fired.state.lastKoTurn[victim]).toBeNull();

    const byPoison = poisonKoOnInstallersTurn();
    expect(findEvent(byPoison.events, "KNOCKED_OUT")?.seat).toBe("p2");
    expect(byPoison.state.lastKoTurn.p2).toBe(2);
    expect(byPoison.state.lastKoMarks.p2).toHaveLength(1);
    expect(byPoison.state.lastKoMarks.p2[0]?.byAttack).toBe(false);
  });

  it("NO `koByEffect` MARKER — this Knock Out really is BY DAMAGE", () => {
    const installed = install("p1", DELAY, "fix-doom-tank").state;
    const probed = withActive(installed, "p2", {
      ...body(installed.players.p2.active),
      markers: ["d434-probe"],
    });
    const fired = endVictimTurn(probed, "p2");
    const after = body(fired.state.players.p2.active);
    expect(after.damage).toBe(90);
    expect(after.markers).toEqual(["d434-probe"]);
    expect(after.markers.includes(koByEffectMarker(3))).toBe(false);
  });

  it("Vengeful Punch pays NOTHING — a Checkup KO is outside the attack, and the control differs on ONE axis", () => {
    const recoil = programFor("sv03-197")?.passive?.damageAttackerOnKo?.amount ?? 0;
    expect(recoil).toBeGreaterThan(0);

    // THE DELAYED KO: the Tool is on the doomed body, the body dies, and the
    // installer's Active takes nothing — `koRecoilOf` is called by `finishAttack`
    // alone and the Checkup never reaches it.
    const armedBoard = attachToolFromDeck(armed("p1"), "p2", "active", "sv03-197");
    const installed = mustApply(armedBoard, { type: "attack", seat: "p1", index: DELAY });
    const fired = endVictimTurn(installed.state, "p2");
    expect(count(fired.events, "KNOCKED_OUT")).toBe(1);
    expect(body(fired.state.players.p1.active).damage).toBe(0);

    const smashed = mustApply(armedBoard, { type: "attack", seat: "p1", index: SMASH });
    expect(count(smashed.events, "KNOCKED_OUT")).toBe(1);
    expect(body(smashed.state.players.p1.active).damage).toBe(recoil);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE BODY MAY NOT BE THERE: every absence case, decided and pinned.
// ─────────────────────────────────────────────────────────────────────────────
describe("§7 — the schedule DIES WITH THE BODY: four §10 literals plus the Knock Out", () => {
  /** Turn 3 is the victim's own turn, and every route below is legal on it — which
      is what makes this field's §10 clears the reachable case rather than the
      theoretical one every neighbour's are. */
  function inWindow(): GameState {
    const state = install("p1", DELAY, "fix-doom-tank").state;
    expect(state.turn).toBe(3);
    expect(body(state.players.p2.active).scheduledEffect).toEqual({
      turn: 3,
      kind: "counters",
      amount: 90,
    });
    return state;
  }

  function stampOf(pokemon: InPlayPokemon | undefined): unknown {
    if (pokemon === undefined) return "MISSING";
    return pokemon.scheduledEffect;
  }

  it("1. RETREAT (turn.ts `clearOnLeavingActive`) — and the Checkup then places NOTHING", () => {
    const state = inWindow();
    const uid = baseUid(state.players.p2.active);
    const retreated = must(
      applyAction(state, {
        type: "retreat",
        seat: "p2",
        discardEnergy: (state.players.p2.active?.energy ?? []).slice(0, 1),
        promoteBenchIndex: 0,
      }),
    );
    expect(stampOf(retreated.players.p2.bench.find((p) => p.stack.includes(uid)))).toBeNull();
    const fired = mustApply(retreated, { type: "endTurn", seat: "p2" });
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
    expect(body(fired.state.players.p2.active).damage).toBe(0);
    expect(body(fired.state.players.p2.bench.find((p) => p.stack.includes(uid))).damage).toBe(0);
  });

  it("2. FORCED SWITCH (interpreter.ts `switchInto`), via the Switch Item", () => {
    const state = handFromDeck(inWindow(), "p2", "sv01-194", 1);
    const uid = baseUid(state.players.p2.active);
    let switched = must(
      applyAction(state, {
        type: "playTrainer",
        seat: "p2",
        uid: handUid(state, "p2", "sv01-194"),
      }),
    );
    if (switched.phase.kind === "effect:choose") {
      switched = must(
        applyAction(switched, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    expect(stampOf(switched.players.p2.bench.find((p) => p.stack.includes(uid)))).toBeNull();
    const fired = mustApply(switched, { type: "endTurn", seat: "p2" });
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
  });

  it("3. EVOLVE (types.ts `evolveOnto`) — the first field here whose evolve clear is a PLAYED LINE", () => {
    const state = handFromDeck(install("p1", DELAY, "fix-doomed").state, "p2", "fix-doomed-s1", 1);
    expect(body(state.players.p2.active).scheduledEffect).toEqual({
      turn: 3,
      kind: "counters",
      amount: 90,
    });
    const evolved = must(
      applyAction(state, {
        type: "evolve",
        seat: "p2",
        uid: handUid(state, "p2", "fix-doomed-s1"),
        target: { spot: "active" },
      }),
    );
    expect(stampOf(evolved.players.p2.active ?? undefined)).toBeNull();
    const fired = mustApply(evolved, { type: "endTurn", seat: "p2" });
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
    expect(body(fired.state.players.p2.active).damage).toBe(0);
  });

  it("4. DEVOLVE (interpreter.ts `devolveEach`) — the clear is UNREACHABLE, and is driven anyway", () => {
    const evolvedBoard = handFromDeck(
      install("p1", DELAY, "fix-doomed").state,
      "p2",
      "fix-doomed-s1",
      1,
    );
    const evolved = must(
      applyAction(evolvedBoard, {
        type: "evolve",
        seat: "p2",
        uid: handUid(evolvedBoard, "p2", "fix-doomed-s1"),
        target: { spot: "active" },
      }),
    );
    // A schedule for a turn still in the future, on the now-EVOLVED body.
    const rescheduled = withActive(evolved, "p2", {
      ...body(evolved.players.p2.active),
      scheduledEffect: { turn: 5, kind: "counters", amount: 90 },
    });
    const p1Turn = mustApply(rescheduled, { type: "endTurn", seat: "p2" }).state;
    expect(p1Turn.turn).toBe(4);
    expect(body(p1Turn.players.p2.active).scheduledEffect).toEqual({
      turn: 5,
      kind: "counters",
      amount: 90,
    });
    const devolved = mustApply(p1Turn, { type: "attack", seat: "p1", index: DEVOLVE });
    expect(count(devolved.events, "POKEMON_DEVOLVED")).toBe(1);
    expect(stampOf(devolved.state.players.p2.active ?? undefined)).toBeNull();
    // …and the Checkup at the end of turn 5 places nothing, which is the claim the
    // field read alone cannot make.
    const fired = mustApply(devolved.state, { type: "endTurn", seat: "p2" });
    expect(fired.state.turn).toBe(6);
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
  });

  it("5. KNOCKED OUT before it fires — the schedule dies, and the PROMOTED body does not inherit it", () => {
    const pre = setConditions(setDamage(armed("p1"), "p2", 80), "p2", { poisonDamage: 10 });
    const attacked = mustApply(pre, { type: "attack", seat: "p1", index: DELAY });
    expect(findEvent(attacked.events, "EFFECT_SCHEDULED")?.scheduled.turn).toBe(3);
    expect(findEvent(attacked.events, "KNOCKED_OUT")?.seat).toBe("p2");
    const taken = mustApply(attacked.state, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    });
    expect(taken.state.turn).toBe(3);
    // The promoted body is a DIFFERENT Pokémon and carries no schedule — the fact
    // rode the BODY, not the spot.
    const promoted = body(taken.state.players.p2.active);
    expect(taken.state.cardIdByUid[baseUid(promoted)]).toBe("fix-titan");
    expect(promoted.scheduledEffect).toBeNull();
    const fired = mustApply(taken.state, { type: "endTurn", seat: "p2" });
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
    expect(body(fired.state.players.p2.active).damage).toBe(0);
  });

  it("6. A FRESH BODY carries none (types.ts `makeInPlay`)", () => {
    const fresh = armed("p1");
    expect(body(fresh.players.p1.active).scheduledEffect).toBeNull();
    expect(body(fresh.players.p2.active).scheduledEffect).toBeNull();
    expect(fresh.players.p2.bench.every((p) => p.scheduledEffect === null)).toBe(true);
  });
});

describe("§8 — the bump, and the soft landing it refuses", () => {
  function saved(): GameState {
    const state = install("p1", DELAY, "fix-doom-tank").state;
    expect(state.turn).toBe(3);
    return roundTrip(state);
  }

  it("DIRECTION 1 — a v29 record round-trips and the schedule STILL fires", () => {
    const record = saved();
    expect(body(record.players.p2.active).scheduledEffect).toEqual({
      turn: 3,
      kind: "counters",
      amount: 90,
    });
    const fired = mustApply(record, { type: "endTurn", seat: "p2" });
    expect(all(fired.events, "COUNTERS_PLACED").map((e) => e.source)).toEqual(["delayed"]);
    expect(body(fired.state.players.p2.active).damage).toBe(90);
  });

  it("DIRECTION 2 — a v28-SHAPED body is not a body this deploy can read AT ALL", () => {
    const legacy = saved();
    const victim = body(legacy.players.p2.active) as Omit<InPlayPokemon, "scheduledEffect"> & {
      scheduledEffect?: { turn: number; amount: number };
    };
    // The key must be genuinely ABSENT: an absent key, not one set to undefined, is what an
    // older record looks like. `= undefined` leaves it PRESENT, and that distinction is the one
    // this case exists to drive.
    delete victim.scheduledEffect;
    expect("scheduledEffect" in victim).toBe(false);

    expect(() => scheduledEffectDue(victim as unknown as InPlayPokemon, 3)).toThrow();
    expect(() => mustApply(legacy, { type: "endTurn", seat: "p2" })).toThrow();

    const live = body(saved().players.p2.active);
    expect(Object.keys(victim).sort()).not.toEqual(Object.keys(live).sort());
    expect(
      Object.keys(live)
        .sort()
        .filter((k) => !Object.keys(victim).includes(k)),
    ).toEqual(["scheduledEffect"]);
  });

  it("D435 — a v28 body carries `scheduledCounters`, and that key rescues NOTHING", () => {
    const legacy = saved();
    const victim = body(legacy.players.p2.active) as unknown as Record<string, unknown>;
    victim.scheduledCounters = victim.scheduledEffect;
    // The NEW key must be genuinely ABSENT — a v28 writer never wrote it.
    delete victim.scheduledEffect;
    expect("scheduledCounters" in victim).toBe(true);
    expect("scheduledEffect" in victim).toBe(false);
    // The old key is not read by anything on this deploy, so the board is exactly as
    // unreadable as DIRECTION 2's: `undefined !== null`, then `.turn`.
    expect(() => scheduledEffectDue(victim as unknown as InPlayPokemon, 3)).toThrow();
    expect(() => mustApply(legacy, { type: "endTurn", seat: "p2" })).toThrow();
  });

  it("D435 — DROPPING AN OPTIONAL `kind` YIELDS NaN DAMAGE AND AN UNKILLABLE BODY", () => {
    const tolerantKind = (scheduled: Record<string, unknown>): string =>
      typeof scheduled.kind === "string" ? scheduled.kind : "counters";
    // A v29 record for the DISCARD payload, with its discriminant lost in transit.
    const lost: Record<string, unknown> = { turn: 3 };
    expect(tolerantKind(lost)).toBe("counters");
    // …and the counters arm then reads an amount that is not there.
    const damage = 0 + (lost.amount as number);
    expect(Number.isNaN(damage)).toBe(true);
    expect(damage >= 90).toBe(false);
    expect(damage < 90).toBe(false);
    // …and the CONTROL on the same axis, so this rung cannot pass by a reader that
    // says "not lethal" about everything: a real record of the same kind IS lethal.
    const real = 0 + 90;
    expect(real >= 90).toBe(true);
    const shipped = install("p1", DISCARD).state;
    expect(body(shipped.players.p2.active).scheduledEffect).toEqual({
      turn: 3,
      kind: "discard",
    });
  });

  it("THE OPTIONAL-KEY ROAD WAS DRIVEN TOO, AND THE RECORD'S SECOND KEY DOES NOT SAVE IT", () => {
    const tolerant = (pokemon: InPlayPokemon, turn: number): number | null => {
      const scheduled = pokemon.scheduledEffect as
        | { turn: number; amount: number }
        | null
        | undefined;
      return scheduled != null && scheduled.turn === turn ? scheduled.amount : null;
    };
    const withKey = saved();
    const withoutKey = saved();
    const stripped = body(withoutKey.players.p2.active) as Omit<
      InPlayPokemon,
      "scheduledEffect"
    > & { scheduledEffect?: { turn: number; amount: number } };
    // The key must be genuinely ABSENT: an absent key, not one set to undefined, is what an
    // older record looks like. `= undefined` leaves it PRESENT, and that distinction is the one
    // this case exists to drive.
    delete stripped.scheduledEffect;
    expect(tolerant(body(withKey.players.p2.active), 3)).toBe(90);
    expect(tolerant(stripped as unknown as InPlayPokemon, 3)).toBeNull();
    const a = mustApply(withKey, { type: "endTurn", seat: "p2" });
    expect(body(a.state.players.p2.active).damage).toBe(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — §11: the schedule is an effect of an attack done TO the Defending Pokémon.
// ─────────────────────────────────────────────────────────────────────────────
describe("§9 — a §11 effects-block refuses the schedule, and the control is admitted", () => {
  it("Mist Energy's effects-only shield refuses it — one row, no record", () => {
    const shielded = attachFromDeck(armed("p1"), "p2", "fix-mist-energy", 1);
    const attacked = mustApply(shielded, { type: "attack", seat: "p1", index: DELAY });
    expect(count(attacked.events, "ATTACK_EFFECT_PREVENTED")).toBe(1);
    expect(count(attacked.events, "EFFECT_SCHEDULED")).toBe(0);
    expect(body(attacked.state.players.p2.active).scheduledEffect).toBeNull();
    const fired = endVictimTurn(attacked.state, "p2");
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
  });

  it("the ADMITTED control differs on ONE axis — the same board without the shield", () => {
    const attacked = install("p1");
    expect(count(attacked.events, "ATTACK_EFFECT_PREVENTED")).toBe(0);
    expect(count(attacked.events, "EFFECT_SCHEDULED")).toBe(1);
  });

  it("the gate is asked at the INSTALL, not at the firing — a block that arrives later does not save it", () => {
    const installed = install("p1", DELAY, "fix-doom-tank").state;
    const shieldedLate = attachFromDeck(installed, "p2", "fix-mist-energy", 1);
    const fired = endVictimTurn(shieldedLate, "p2");
    expect(all(fired.events, "COUNTERS_PLACED").map((e) => e.source)).toEqual(["delayed"]);
    expect(body(fired.state.players.p2.active).damage).toBe(90);
  });
});

describe("§10 — a second schedule in the same turn merges by MAX, not by sum", () => {
  it("the LARGER amount survives and fires; the sum never appears", () => {
    const installed = install("p1", DELAY, "fix-doom-tank").state;
    expect(body(installed.players.p2.active).scheduledEffect).toEqual({
      turn: 3,
      kind: "counters",
      amount: 90,
    });
    const bigger = withActive(installed, "p2", {
      ...body(installed.players.p2.active),
      scheduledEffect: { turn: 3, kind: "counters", amount: 120 },
    });
    expect(scheduledEffectDue(body(bigger.players.p2.active), 3)).toEqual({
      turn: 3,
      kind: "counters",
      amount: 120,
    });
    const fired = mustApply(bigger, { type: "endTurn", seat: "p2" });
    expect(body(fired.state.players.p2.active).damage).toBe(120);
    // …and NOT 210, which is what a summing merge would have produced.
    expect(body(fired.state.players.p2.active).damage).not.toBe(210);
  });

  it("two ops in ONE program: the second MERGES by max and announces only a change", () => {
    const base = armed("p1", "fix-doom-tank");
    const up: GameEvent[] = [];
    const raised = runProgram(
      base,
      [
        { op: "scheduleCounters", amount: 90 },
        { op: "scheduleCounters", amount: 120 },
      ],
      { seat: "p1" },
      {},
      up,
    );
    expect(body(raised.state.players.p2.active).scheduledEffect).toEqual({
      turn: 3,
      kind: "counters",
      amount: 120,
    });
    // …and NOT 210: the merge is `Math.max`, not a sum.
    expect(all(up, "EFFECT_SCHEDULED").map((e) => e.scheduled)).toEqual([
      { turn: 3, kind: "counters", amount: 90 },
      { turn: 3, kind: "counters", amount: 120 },
    ]);

    const down: GameEvent[] = [];
    const lowered = runProgram(
      base,
      [
        { op: "scheduleCounters", amount: 120 },
        { op: "scheduleCounters", amount: 90 },
      ],
      { seat: "p1" },
      {},
      down,
    );
    expect(body(lowered.state.players.p2.active).scheduledEffect).toEqual({
      turn: 3,
      kind: "counters",
      amount: 120,
    });
    expect(all(down, "EFFECT_SCHEDULED").map((e) => e.scheduled)).toEqual([
      { turn: 3, kind: "counters", amount: 120 },
    ]);
  });

  it("D435 — a DIFFERENT kind REPLACES, and it does so in both directions", () => {
    const base = armed("p1");
    const pairs: [EffectOp, EffectOp][] = [
      [{ op: "scheduleCounters", amount: 90 }, { op: "scheduleKnockOut" }],
      [{ op: "scheduleKnockOut" }, { op: "scheduleDiscard" }],
      [{ op: "scheduleDiscard" }, { op: "scheduleCounters", amount: 90 }],
    ];
    for (const [first, second] of pairs) {
      const events: GameEvent[] = [];
      const ran = runProgram(base, [first, second], { seat: "p1" }, {}, events);
      const expected =
        second.op === "scheduleCounters"
          ? { turn: 3, kind: "counters", amount: 90 }
          : second.op === "scheduleDiscard"
            ? { turn: 3, kind: "discard" }
            : { turn: 3, kind: "knockOut" };
      expect(body(ran.state.players.p2.active).scheduledEffect, second.op).toEqual(expected);
      // TWO rows, because the second op really did change the appointment — the
      // suppression is for a merge that says nothing new, not for a replacement.
      expect(all(events, "EFFECT_SCHEDULED"), second.op).toHaveLength(2);
    }
  });

  it("a schedule stamped for a LATER turn is untouched by the Checkup it is not for", () => {
    const installed = install("p1", DELAY, "fix-doom-tank").state;
    const later = withActive(installed, "p2", {
      ...body(installed.players.p2.active),
      scheduledEffect: { turn: 5, kind: "counters", amount: 90 },
    });
    const fired = mustApply(later, { type: "endTurn", seat: "p2" });
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
    expect(body(fired.state.players.p2.active).scheduledEffect).toEqual({
      turn: 5,
      kind: "counters",
      amount: 90,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §11 — purity: neither half mutates the board it was handed.
// ─────────────────────────────────────────────────────────────────────────────
describe("§11 — the install and the firing mutate nothing they were handed", () => {
  it("a deep-frozen board survives the install AND the Checkup that fires it", () => {
    const frozenArmed = deepFreeze(armed("p1", "fix-doom-tank"));
    const installed = mustApply(frozenArmed, { type: "attack", seat: "p1", index: DELAY });
    expect(body(frozenArmed.players.p2.active).scheduledEffect).toBeNull();
    expect(body(installed.state.players.p2.active).scheduledEffect).toEqual({
      turn: 3,
      kind: "counters",
      amount: 90,
    });

    const frozenScheduled = deepFreeze(installed.state);
    const fired = mustApply(frozenScheduled, { type: "endTurn", seat: "p2" });
    expect(body(frozenScheduled.players.p2.active).damage).toBe(0);
    expect(body(fired.state.players.p2.active).damage).toBe(90);
  });
});

describe("§12 — a discard takes NO Prize and a Knock Out takes ONE, on one axis", () => {
  it("THE ONE AXIS — same board, same clock: 6 prizes against 5", () => {
    const discarded = endVictimTurn(install("p1", DISCARD).state, "p2");
    const doomed = endVictimTurn(install("p1", DOOM).state, "p2");

    // The DISCARD: nothing is Knocked Out, nothing is owed, nobody parks on a prize.
    expect(count(discarded.events, "KNOCKED_OUT")).toBe(0);
    expect(count(discarded.events, "PRIZES_OWED")).toBe(0);
    expect(discarded.state.players.p1.prizes).toHaveLength(6);
    expect(discarded.state.players.p2.prizes).toHaveLength(6);

    // The KNOCK OUT: §8.1 in full, and the prize pick PARKS for the installer.
    expect(count(doomed.events, "KNOCKED_OUT")).toBe(1);
    expect(findEvent(doomed.events, "PRIZES_OWED")).toEqual({
      type: "PRIZES_OWED",
      seat: "p1",
      count: 1,
    });
    expect(doomed.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const taken = mustApply(doomed.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(taken.state.players.p1.prizes).toHaveLength(5);
    expect(taken.state.players.p2.prizes).toHaveLength(6);
  });

  it("…and EVERYTHING ELSE agrees: the same cards leave play into the same pile", () => {
    const discarded = endVictimTurn(install("p1", DISCARD).state, "p2");
    const doomed = endVictimTurn(install("p1", DOOM).state, "p2");
    const settled = mustApply(doomed.state, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    }).state;

    // The body and its Energy are in the VICTIM's discard pile on both boards, and
    // the installer's pile is untouched on both.
    const pile = (state: GameState) =>
      state.players.p2.discard.map((uid) => state.cardIdByUid[uid]).sort();
    expect(pile(discarded.state)).toEqual(["fix-doomed", "fix-energy"]);
    expect(pile(settled)).toEqual(pile(discarded.state));
    expect(discarded.state.players.p1.discard).toEqual([]);
    expect(settled.players.p1.discard).toEqual([]);

    // Both promote the lone benched `fix-titan`, and both hand the turn back.
    for (const state of [discarded.state, settled]) {
      expect(state.cardIdByUid[baseUid(state.players.p2.active)]).toBe("fix-titan");
      expect(state.players.p2.bench).toHaveLength(0);
      expect(state.turn).toBe(4);
      expect(state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    }
  });

  it("the KO-only facts are absent on the discard: no `lastKoTurn`, no `lastKoMarks`", () => {
    const discarded = endVictimTurn(install("p1", DISCARD).state, "p2");
    expect(discarded.state.lastKoTurn.p2).toBeNull();
    expect(discarded.state.lastKoMarks.p2).toEqual([]);
    const doomed = endVictimTurn(install("p1", DOOM).state, "p2");
    expect(count(discarded.events, "KNOCKED_OUT")).toBe(0);
    expect(count(doomed.events, "KNOCKED_OUT")).toBe(1);
    expect(doomed.state.lastKoTurn.p2).toBeNull();
    expect(doomed.state.lastKoMarks.p2).toEqual([]);
  });

  it("the two LOG rows do not read alike — the arming row names which one it is", () => {
    const discard = install("p1", DISCARD);
    const doom = install("p1", DOOM);
    expect(render(discard.events, discard.state).find((r) => r.text.includes("scheduled"))).toEqual(
      {
        who: "p2",
        text: "fix-doomed is scheduled to be discarded at the end of your next turn",
      },
    );
    expect(render(doom.events, doom.state).find((r) => r.text.includes("scheduled"))).toEqual({
      who: "p2",
      text: "fix-doomed is scheduled to be Knocked Out at the end of your next turn",
    });
  });
});

describe("§13 — the body and all attached cards, to their OWNER's discard pile", () => {
  it("the record is `{ turn: state.turn + 1, kind: 'discard' }` on the DEFENDER's Active", () => {
    const { state, events } = install("p1", DISCARD);
    expect(body(state.players.p2.active).scheduledEffect).toEqual({ turn: 3, kind: "discard" });
    expect(body(state.players.p1.active).scheduledEffect).toBeNull();
    expect(findEvent(events, "EFFECT_SCHEDULED")).toEqual({
      type: "EFFECT_SCHEDULED",
      seat: "p2",
      uid: baseUid(state.players.p2.active),
      scheduled: { turn: 3, kind: "discard" },
    });
  });

  for (const installer of ["p1", "p2"] as const) {
    const victim = otherSeat(installer);
    it(`both seats — ${installer} schedules, ${victim}'s Active is discarded at the end of turn 3`, () => {
      const installed = install(installer, DISCARD);
      // It SURVIVES the Checkup that ends the installing turn — the stamp is 3 and
      // that Checkup runs at turn 2, which is the off-by-one this shape invites.
      expect(installed.state.players[victim].active).not.toBeNull();
      const fired = endVictimTurn(installed.state, victim);
      expect(findEvent(fired.events, "POKEMON_RETURNED")).toEqual({
        type: "POKEMON_RETURNED",
        seat: victim,
        uid: baseUid(installed.state.players[victim].active),
        actor: installer,
        dest: "discard",
        uids: expect.any(Array),
      });
      expect(fired.state.turn).toBe(4);
    });
  }

  it("the WHOLE pile moves — evolution stack, Energy and Tool, in §2's order", () => {
    const withHand = handFromDeck(install("p1", DISCARD).state, "p2", "fix-doomed-s1", 1);
    const evolved = must(
      applyAction(withHand, {
        type: "evolve",
        seat: "p2",
        uid: handUid(withHand, "p2", "fix-doomed-s1"),
        target: { spot: "active" },
      }),
    );
    // Evolving CLEARED the schedule (§7 case 3), so it is re-installed for a later
    // turn on the now-two-card stack, with a second Energy and a Tool attached.
    const loaded = attachToolFromDeck(
      attachFromDeck(evolved, "p2", "fix-energy", 1),
      "p2",
      "active",
      "sv03-197",
    );
    const rescheduled = withActive(loaded, "p2", {
      ...body(loaded.players.p2.active),
      scheduledEffect: { turn: 5, kind: "discard" },
    });
    const victimBody = body(rescheduled.players.p2.active);
    expect(victimBody.stack).toHaveLength(2);
    expect(victimBody.energy).toHaveLength(2);
    expect(victimBody.tools).toHaveLength(1);
    const expected = [...victimBody.stack, ...victimBody.energy, ...victimBody.tools];

    const p1Turn = mustApply(rescheduled, { type: "endTurn", seat: "p2" }).state;
    expect(p1Turn.turn).toBe(4);
    const back = mustApply(p1Turn, { type: "endTurn", seat: "p1" }).state;
    expect(back.turn).toBe(5);
    const fired = mustApply(back, { type: "endTurn", seat: "p2" });

    expect(findEvent(fired.events, "POKEMON_RETURNED")?.uids).toEqual(expected);
    expect(fired.state.players.p2.discard.slice(-expected.length)).toEqual(expected);
    for (const uid of expected) expect(fired.state.players.p1.discard).not.toContain(uid);
    expect(fired.state.cardIdByUid[findEvent(fired.events, "POKEMON_RETURNED")?.uid ?? ""]).toBe(
      "fix-doomed-s1",
    );
  });

  it("the emptied Active Spot is refilled BEFORE the next turn starts", () => {
    const fired = endVictimTurn(install("p1", DISCARD).state, "p2");
    expect(findEvent(fired.events, "POKEMON_PROMOTED")?.seat).toBe("p2");
    expect(fired.state.players.p2.active).not.toBeNull();
    expect(fired.state.cardIdByUid[baseUid(fired.state.players.p2.active)]).toBe("fix-titan");
    expect(fired.state.players.p2.bench).toHaveLength(0);
    const names = types(fired.events);
    expect(names.indexOf("POKEMON_PROMOTED")).toBeLessThan(names.indexOf("TURN_STARTED"));
    expect(fired.state.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("…and with an EMPTY Bench the victim LOSES (§14.2), through the shipped stage", () => {
    // The promote stage is already total over the three boards it can meet; this is
    // the third of them, reached for the first time from a Checkup. Without the seam
    // above, this player would simply keep playing with no Active Pokémon.
    const noBench = clearBench(armed("p1"), "p2");
    const installed = mustApply(noBench, { type: "attack", seat: "p1", index: DISCARD }).state;
    const fired = mustApply(installed, { type: "endTurn", seat: "p2" });
    expect(findEvent(fired.events, "GAME_OVER")?.outcome).toEqual({
      result: "win",
      winner: "p1",
      reason: "noPokemon",
    });
    // …and NO Prize was taken on the way there, which is the §12 axis surviving into
    // the win condition.
    expect(count(fired.events, "PRIZES_OWED")).toBe(0);
    expect(fired.state.players.p1.prizes).toHaveLength(6);
  });

  it("a discarded body cannot be Poisoned — no poison row, and the CONTROL files one", () => {
    const poisoned = setConditions(install("p1", DISCARD).state, "p2", {
      poisonDamage: 10,
      burned: true,
    });
    const fired = endVictimTurn(poisoned, "p2");
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
    const names = types(fired.events);
    expect(names.slice(names.indexOf("TURN_ENDED"), names.indexOf("TURN_ENDED") + 2)).toEqual([
      "TURN_ENDED",
      "POKEMON_RETURNED",
    ]);
    const control = setConditions(install("p1", DELAY, "fix-doom-tank").state, "p2", {
      poisonDamage: 10,
      burned: true,
    });
    const firedControl = endVictimTurn(control, "p2");
    expect(all(firedControl.events, "COUNTERS_PLACED").map((e) => e.source)).toEqual([
      "delayed",
      "poison",
      "burn",
    ]);
  });

  it("§10 — RETREAT sheds it, and the Checkup that follows discards NOTHING", () => {
    const installed = install("p1", DISCARD).state;
    const retreated = must(
      applyAction(installed, {
        type: "retreat",
        seat: "p2",
        discardEnergy: (installed.players.p2.active?.energy ?? []).slice(0, 1),
        promoteBenchIndex: 0,
      }),
    );
    expect(body(retreated.players.p2.active).scheduledEffect).toBeNull();
    const fired = mustApply(retreated, { type: "endTurn", seat: "p2" });
    expect(count(fired.events, "POKEMON_RETURNED")).toBe(0);
    expect(fired.state.players.p2.active).not.toBeNull();
    expect(fired.state.players.p2.bench).toHaveLength(1);
  });

  it("§11 — a Mist Energy shield refuses it, and the ADMITTED control differs on ONE axis", () => {
    const shielded = attachFromDeck(armed("p1"), "p2", "fix-mist-energy", 1);
    const attacked = mustApply(shielded, { type: "attack", seat: "p1", index: DISCARD });
    expect(count(attacked.events, "ATTACK_EFFECT_PREVENTED")).toBe(1);
    expect(count(attacked.events, "EFFECT_SCHEDULED")).toBe(0);
    expect(body(attacked.state.players.p2.active).scheduledEffect).toBeNull();
    const fired = endVictimTurn(attacked.state, "p2");
    expect(count(fired.events, "POKEMON_RETURNED")).toBe(0);
    // …the same board without the shield.
    const admitted = install("p1", DISCARD);
    expect(count(admitted.events, "ATTACK_EFFECT_PREVENTED")).toBe(0);
    expect(count(admitted.events, "EFFECT_SCHEDULED")).toBe(1);
  });
});

describe("§14 — §8.1 in full, Prize included, and the cause re-derived", () => {
  it("the record is `{ turn: state.turn + 1, kind: 'knockOut' }` on the DEFENDER's Active", () => {
    const { state, events } = install("p1", DOOM);
    expect(body(state.players.p2.active).scheduledEffect).toEqual({ turn: 3, kind: "knockOut" });
    expect(body(state.players.p1.active).scheduledEffect).toBeNull();
    expect(findEvent(events, "EFFECT_SCHEDULED")).toEqual({
      type: "EFFECT_SCHEDULED",
      seat: "p2",
      uid: baseUid(state.players.p2.active),
      scheduled: { turn: 3, kind: "knockOut" },
    });
  });

  for (const installer of ["p1", "p2"] as const) {
    const victim = otherSeat(installer);
    it(`both seats — ${installer} schedules, ${victim}'s Active is Knocked Out at the end of turn 3`, () => {
      const installed = install(installer, DOOM);
      expect(installed.state.players[victim].active).not.toBeNull();
      const fired = endVictimTurn(installed.state, victim);
      expect(findEvent(fired.events, "KNOCKED_OUT")?.seat).toBe(victim);
      expect(fired.state.phase).toEqual({ kind: "ko:takePrizes", seat: installer, count: 1 });
      const taken = mustApply(fired.state, {
        type: "takePrizes",
        seat: installer,
        prizeIndices: [0],
      });
      expect(taken.state.players[installer].prizes).toHaveLength(5);
      expect(taken.state.cardIdByUid[baseUid(taken.state.players[victim].active)]).toBe(
        "fix-titan",
      );
      expect(taken.state.turn).toBe(4);
    });
  }

  it("THE KO IS NOT DAMAGE — a full-HP body dies with no `COUNTERS_PLACED` anywhere", () => {
    const installed = install("p1", DOOM, "fix-doom-tank").state;
    // 300 HP and ZERO damage: nothing this engine can place would be lethal here.
    expect(body(installed.players.p2.active).damage).toBe(0);
    const fired = endVictimTurn(installed, "p2");
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
    expect(count(fired.events, "DAMAGE_DEALT")).toBe(0);
    expect(count(fired.events, "KNOCKED_OUT")).toBe(1);
  });

  it("THE CAUSE — `byAttack` is FALSE, and the KO-by-damage readers see nothing", () => {
    const fired = endVictimTurn(install("p1", DOOM).state, "p2");
    expect(count(fired.events, "KNOCKED_OUT")).toBe(1);
    expect(fired.state.lastKoMarks.p2).toEqual([]);
    expect(fired.state.lastKoTurn.p2).toBeNull();
    const poisonKo = poisonKoOnInstallersTurn();
    expect(poisonKo.state.lastKoMarks.p2).toHaveLength(1);
    expect(poisonKo.state.lastKoMarks.p2[0]?.byAttack).toBe(false);
  });

  it("the KO-conditioned recoil pays 0, and the ATTACK control on one axis pays 40", () => {
    const recoil = programFor("sv03-197")?.passive?.damageAttackerOnKo?.amount ?? 0;
    expect(recoil).toBeGreaterThan(0);
    const armedTool = attachToolFromDeck(armed("p1"), "p2", "active", "sv03-197");
    const scheduled = mustApply(armedTool, { type: "attack", seat: "p1", index: DOOM }).state;
    const fired = endVictimTurn(scheduled, "p2");
    expect(count(fired.events, "KNOCKED_OUT")).toBe(1);
    expect(body(fired.state.players.p1.active).damage).toBe(0);
    // …and the control: the SAME Tool on the SAME body, Knocked Out by an attack.
    const smashed = mustApply(attachToolFromDeck(armed("p1"), "p2", "active", "sv03-197"), {
      type: "attack",
      seat: "p1",
      index: SMASH,
    });
    expect(count(smashed.events, "KNOCKED_OUT")).toBe(1);
    expect(body(smashed.state.players.p1.active).damage).toBe(recoil);
  });

  it("an ALREADY-LETHAL body is still collected, and still pays its Prize", () => {
    const installed = install("p1", DOOM).state;
    const dying = setDamage(installed, "p2", 90);
    const fired = endVictimTurn(dying, "p2");
    expect(count(fired.events, "KNOCKED_OUT")).toBe(1);
    expect(fired.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    expect(fired.state.lastKoMarks.p2).toEqual([]);
  });

  it("a DOOMED body is still there for §13.1 — Poison files its row, unlike the discard", () => {
    const poisoned = setConditions(install("p1", DOOM).state, "p2", { poisonDamage: 10 });
    const fired = endVictimTurn(poisoned, "p2");
    expect(all(fired.events, "COUNTERS_PLACED").map((e) => [e.source, e.amount])).toEqual([
      ["poison", 10],
    ]);
    expect(count(fired.events, "KNOCKED_OUT")).toBe(1);
  });

  it("…and with an EMPTY Bench the victim LOSES — the Prize is taken FIRST", () => {
    const noBench = clearBench(armed("p1"), "p2");
    const installed = mustApply(noBench, { type: "attack", seat: "p1", index: DOOM }).state;
    const fired = mustApply(installed, { type: "endTurn", seat: "p2" });
    // §8.1's prize pick comes before the promotion that cannot happen.
    expect(fired.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const taken = mustApply(fired.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(taken.state.players.p1.prizes).toHaveLength(5);
    expect(findEvent(taken.events, "GAME_OVER")?.outcome).toEqual({
      result: "win",
      winner: "p1",
      reason: "noPokemon",
    });
  });

  it("§10 — RETREAT sheds it, and the Checkup that follows Knocks NOTHING Out", () => {
    const installed = install("p1", DOOM).state;
    const retreated = must(
      applyAction(installed, {
        type: "retreat",
        seat: "p2",
        discardEnergy: (installed.players.p2.active?.energy ?? []).slice(0, 1),
        promoteBenchIndex: 0,
      }),
    );
    expect(body(retreated.players.p2.active).scheduledEffect).toBeNull();
    const fired = mustApply(retreated, { type: "endTurn", seat: "p2" });
    expect(count(fired.events, "KNOCKED_OUT")).toBe(0);
    expect(count(fired.events, "PRIZES_OWED")).toBe(0);
    expect(fired.state.players.p1.prizes).toHaveLength(6);
  });

  it("§11 — a Mist Energy shield refuses it, and the ADMITTED control differs on ONE axis", () => {
    const shielded = attachFromDeck(armed("p1"), "p2", "fix-mist-energy", 1);
    const attacked = mustApply(shielded, { type: "attack", seat: "p1", index: DOOM });
    expect(count(attacked.events, "ATTACK_EFFECT_PREVENTED")).toBe(1);
    expect(count(attacked.events, "EFFECT_SCHEDULED")).toBe(0);
    const fired = endVictimTurn(attacked.state, "p2");
    expect(count(fired.events, "KNOCKED_OUT")).toBe(0);
    const admitted = install("p1", DOOM);
    expect(count(admitted.events, "ATTACK_EFFECT_PREVENTED")).toBe(0);
    expect(count(admitted.events, "EFFECT_SCHEDULED")).toBe(1);
  });

  it("the PRINTED compound fires end to end — the head's discard AND the tail's KO", () => {
    const composed = install("p1", COMPOUND);
    expect(body(composed.state.players.p1.active).energy).toEqual([]);
    expect(body(composed.state.players.p2.active).scheduledEffect).toEqual({
      turn: 3,
      kind: "knockOut",
    });
    const fired = endVictimTurn(composed.state, "p2");
    expect(count(fired.events, "KNOCKED_OUT")).toBe(1);
    expect(fired.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });
});

describe("§15 — frozen boards, and a v29 record that round-trips", () => {
  /** Drain the ONE decision either payload can leave parked: the Knock Out's §8.1
      prize pick. The discard owes none, so this is the identity there — which is the
      §12 axis showing up as a helper rather than as a sentence. */
  const settle = (result: { state: GameState }): GameState =>
    result.state.phase.kind === "ko:takePrizes"
      ? mustApply(result.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] }).state
      : result.state;

  for (const [name, index] of [
    ["discard", DISCARD],
    ["knockOut", DOOM],
  ] as const) {
    it(`the ${name} install and its firing mutate nothing they were handed`, () => {
      const frozenArmed = deepFreeze(armed("p1"));
      const installed = mustApply(frozenArmed, { type: "attack", seat: "p1", index });
      expect(body(frozenArmed.players.p2.active).scheduledEffect).toBeNull();
      expect(body(installed.state.players.p2.active).scheduledEffect).toEqual({
        turn: 3,
        kind: name,
      });
      const frozenScheduled = deepFreeze(installed.state);
      const fired = mustApply(frozenScheduled, { type: "endTurn", seat: "p2" });
      // The FROZEN board still holds the appointment; the new one has spent it.
      expect(body(frozenScheduled.players.p2.active).scheduledEffect).toEqual({
        turn: 3,
        kind: name,
      });
      // The Knock-Out payload parks on §8.1's prize pick before it promotes, so the
      // spot is drained through that stage; the discard owes no prize and promotes
      // inside the same batch. Both end with `fix-titan` Active — one axis apart.
      const settled = settle(fired);
      expect(settled.players.p2.active).not.toBeNull();
      expect(settled.cardIdByUid[baseUid(settled.players.p2.active)]).toBe("fix-titan");
    });

    it(`a v29 record carrying a ${name} appointment round-trips and STILL fires`, () => {
      const record = roundTrip(install("p1", index).state);
      expect(body(record.players.p2.active).scheduledEffect).toEqual({ turn: 3, kind: name });
      const settled = settle(mustApply(record, { type: "endTurn", seat: "p2" }));
      expect(settled.players.p2.bench).toHaveLength(0);
      expect(settled.cardIdByUid[baseUid(settled.players.p2.active)]).toBe("fix-titan");
    });
  }
});
