import { describe, expect, it } from "vitest";
import { applyDamageModifier } from "./cards";
import type { DamageModifier } from "./cards";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackEffect,
} from "./effects";
import { applyAction, programFor, redactGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  OPPONENT_COUNTER_DECK,
  attachFromDeck,
  clearBench,
  driveSetup,
  expectErr,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
  findEvent,
} from "./testFixtures";

/** The two printed sentences, byte-for-byte off the local D1 rows (2026-08-03,
    978 rows / 6 sets). The possessive is ASCII U+0027 and the é in `Pokémon` is
    U+00E9 — hex-verified on the rows, not eyeballed. */
const SECOND_BITE =
  "This attack does 10 more damage for each damage counter on your opponent's Active Pokémon.";
const MAD_BITE =
  "This attack does 30 more damage for each damage counter on your opponent's Active Pokémon.";
/** The SELF-side twin, printed on seven catalog rows and read since M2 — the
    sentence whose only difference from `SECOND_BITE` is the body it counts, and
    which must keep landing on the OTHER count member. */
const RAGING_HORNS = "This attack does 10 more damage for each damage counter on this Pokémon.";
const BURNING_VOICE = "This attack does 10 less damage for each damage counter on this Pokémon.";
/** The self-side MULTIPLY twin (Drifloon sv01-089, Onix swsh10.5-036) — printed,
    unread, and refused here by the same literal tail. */
const BALLOON_BLAST = "This attack does 30 damage for each damage counter on this Pokémon.";
const UNPRINTED_AMOUNT_ON_A_PRINTED_SHAPE =
  "This attack does 30 damage for each damage counter on your opponent's Active Pokémon.";
const DAMAGE_BEAT =
  "This attack does 20 damage for each damage counter on your opponent's Active Pokémon.";

const SEED = 5;

const ATTACKERS = {
  dedenne: {
    card: "sv01-095",
    index: 0,
    energy: [
      { id: "fix-psychic-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ],
  }, // "Second Bite" ({P}{C}, "30+", 10 more per counter on the DEFENDER)
  espeon: { card: "sv03-086", index: 0, energy: [{ id: "fix-psychic-energy", count: 1 }] }, // "Psychic Assault" ({P}, "30+"): the SAME sentence, second card
  "espeon-bolt": {
    card: "sv03-086",
    index: 1,
    energy: [
      { id: "fix-psychic-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ],
  }, // "Psy Bolt" ({P}{C}, 60): the sibling attack that must NOT inherit the clause
  ursaluna: {
    card: "sv06.5-025",
    index: 0,
    energy: [
      { id: "fix-fighting-energy", count: 2 },
      { id: "fix-energy", count: 1 },
    ],
  }, // "Mad Bite" ({F}{F}{C}, "100+", 30 more per counter)
} as const;

type Attacker = keyof typeof ATTACKERS;

function board(attacker: Attacker, defender: string, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: OPPONENT_COUNTER_DECK, p2: OPPONENT_COUNTER_DECK }, { first: opener }),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, ATTACKERS[attacker].card);
  state = clearBench(state, by);
  for (const { id, count } of ATTACKERS[attacker].energy) {
    state = attachFromDeck(state, by, id, count);
  }
  state = setActiveFromDeck(state, opener, defender);
  return clearBench(state, opener);
}

/** …with `counters × 10` damage already on the DEFENDING Active, which is the
    board this whole family is only observable on. */
function damaged(attacker: Attacker, defender: string, counters: number, by: Seat = "p1") {
  const opener = by === "p1" ? "p2" : "p1";
  return setDamage(board(attacker, defender, by), opener, counters * 10);
}

function swing(state: GameState, attacker: Attacker, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKERS[attacker].index });
}

function clearActive(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) return state;
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        active: null,
        discard: [...side.discard, ...active.stack, ...active.energy, ...active.tools],
      },
    },
  };
}

/** The rendered log, flattened to `{ who, text }` — the shape the neighbouring
    suites read a sequence in. */
function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The data: three catalog rows, re-queried rather than recognised.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed data — three fresh fixtures, whole", () => {
  it("carries Dedenne sv01-095's WHOLE printed card", () => {
    expect(FIXTURE_POOL["sv01-095"]).toMatchObject({
      name: "Dedenne",
      category: "Pokemon",
      stage: "Basic",
      hp: 70,
      types: ["Psychic"],
      retreat: 1,
      weaknesses: [{ type: "Metal", value: "×2" }],
    });
    expect(FIXTURE_POOL["sv01-095"]?.attacks).toEqual([
      {
        cost: ["Psychic", "Colorless"],
        name: "Second Bite",
        effect: SECOND_BITE,
        damage: "30+",
      },
    ]);
    expect(FIXTURE_POOL["sv01-095"]?.abilities ?? null).toBeNull();
    expect(FIXTURE_POOL["sv01-095"]?.resistances ?? null).toBeNull();
  });

  it("…Espeon sv03-086's, INCLUDING the sibling attack and the Resistance", () => {
    expect(FIXTURE_POOL["sv03-086"]).toMatchObject({
      name: "Espeon",
      stage: "Stage1",
      evolveFrom: "Eevee",
      hp: 110,
      types: ["Psychic"],
      retreat: 1,
      weaknesses: [{ type: "Darkness", value: "×2" }],
      resistances: [{ type: "Fighting", value: "-30" }],
    });
    expect(FIXTURE_POOL["sv03-086"]?.attacks).toEqual([
      { cost: ["Psychic"], name: "Psychic Assault", effect: SECOND_BITE, damage: "30+" },
      {
        cost: ["Psychic", "Colorless"],
        name: "Psy Bolt",
        effect: "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.",
        damage: 60,
      },
    ]);
    expect(FIXTURE_POOL["sv03-086"]?.abilities ?? null).toBeNull();
  });

  it("…and Bloodmoon Ursaluna sv06.5-025's, Ability and all", () => {
    expect(FIXTURE_POOL["sv06.5-025"]).toMatchObject({
      name: "Bloodmoon Ursaluna",
      stage: "Basic",
      hp: 150,
      types: ["Fighting"],
      retreat: 4,
      weaknesses: [{ type: "Grass", value: "×2" }],
    });
    expect(FIXTURE_POOL["sv06.5-025"]?.attacks).toEqual([
      {
        cost: ["Fighting", "Fighting", "Colorless"],
        name: "Mad Bite",
        effect: MAD_BITE,
        damage: "100+",
      },
    ]);
    expect(FIXTURE_POOL["sv06.5-025"]?.abilities).toEqual([
      {
        type: "Ability",
        name: "Battle-Hardened",
        effect:
          "When you play this Pokémon from your hand onto your Bench during your turn, you may attach up to 2 Basic {F} Energy cards from your hand to this Pokémon.",
      },
    ]);
  });

  it("TWO OF THE THREE PRINT THE SAME SENTENCE, BYTE FOR BYTE", () => {
    const dedenne = FIXTURE_POOL["sv01-095"]?.attacks?.[0]?.effect;
    const espeon = FIXTURE_POOL["sv03-086"]?.attacks?.[0]?.effect;
    expect(dedenne).toBe(espeon);
    expect(dedenne).toBe(SECOND_BITE);
    // …and the third differs in exactly one number.
    expect(MAD_BITE).toBe(SECOND_BITE.replace(" 10 ", " 30 "));
  });

  it("AUTHORS no ATTACK — all three printings are read off the TEXT", () => {
    for (const id of ["sv01-095", "sv03-086", "sv06.5-025"] as const) {
      expect(programFor(id)?.attack, `${id} grew a registry attack`).toBeUndefined();
      expect(programFor(id)?.passive, `${id} grew a registry passive`).toBeUndefined();
    }
    expect(programFor("sv01-095")).toBeUndefined();
    expect(programFor("sv03-086")).toBeUndefined();
    expect(programFor("sv06.5-025")?.triggered?.[0]?.name).toBe("Battle-Hardened");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The reader.
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveAttackDamageBonus — one regex, two amounts, a fifth count member", () => {
  it("reads BOTH printed sentences as damageCountersOnOpponentActive", () => {
    expect(deriveAttackDamageBonus(SECOND_BITE)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnOpponentActive" },
    });
    expect(deriveAttackDamageBonus(MAD_BITE)).toEqual({
      per: 30,
      count: { kind: "damageCountersOnOpponentActive" },
    });
    // Not hard-coded to either printed amount — the per-counter number is captured.
    expect(deriveAttackDamageBonus(SECOND_BITE.replace(" 10 ", " 70 "))).toEqual({
      per: 70,
      count: { kind: "damageCountersOnOpponentActive" },
    });
  });

  it("IS DISJOINT FROM THE SELF-COUNTER PATTERNS IN BOTH DIRECTIONS", () => {
    expect(deriveAttackDamageBonus(RAGING_HORNS)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnSelf" },
    });
    expect(deriveAttackDamagePenalty(SECOND_BITE)).toBeNull();
    expect(deriveAttackDamagePenalty(MAD_BITE)).toBeNull();
    expect(deriveAttackDamageBonus(BURNING_VOICE)).toBeNull();
    expect(deriveAttackDamageBonus(BALLOON_BLAST)).toBeNull();
    expect(deriveAttackDamageMultiplier(SECOND_BITE)).toBeNull();
    expect(deriveAttackDamageMultiplier(MAD_BITE)).toBeNull();
    // …and the self-side reader still answers its own sentence with its own member,
    // which is the half a shared-tail regex would have broken invisibly.
    expect(deriveAttackDamagePenalty(BURNING_VOICE)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnSelf" },
    });
  });

  it("AT MOST ONE of the three readers answers ANY attack in the pool", () => {
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        const text = attack.effect ?? "";
        const answers = [
          deriveAttackDamageBonus(text),
          deriveAttackDamageMultiplier(text),
          deriveAttackDamagePenalty(text),
        ].filter((x) => x !== null).length;
        expect(answers, `${id} ${attack.name}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("STAYS LOUD as an op — the sentence derives no post-damage program", () => {
    for (const text of [SECOND_BITE, MAD_BITE]) expect(deriveAttackEffect(text)).toBeNull();
  });

  it("refuses a printed 0, and every near-miss the anchors exist for", () => {
    // The zero guard every arm in this family carries: a 0 adds nothing, so it must
    // stay LOUD rather than claim a simulated sentence that does nothing.
    expect(deriveAttackDamageBonus(SECOND_BITE.replace(" 10 ", " 0 "))).toBeNull();
    for (const near of [
      // a lowercased first word
      SECOND_BITE.replace("This", "this"),
      // no trailing period
      SECOND_BITE.slice(0, -1),
      // leading text
      `Flip a coin. ${SECOND_BITE}`,
      // trailing text
      `${SECOND_BITE} Discard an Energy from this Pokémon.`,
      // a real Pokémon with a lookalike é would fall off the path silently
      SECOND_BITE.replace("Pokémon", "Pokemon"),
      SECOND_BITE.replace(" more ", " less "),
      "This attack does 10 more damage for each damage counter on your opponent's Benched Pokémon.",
      "During Pokémon Checkup, if this Pokémon is in the Active Spot, put 1 damage counter on your opponent's Active Pokémon.",
    ]) {
      expect(deriveAttackDamageBonus(near)).toBeNull();
    }
  });

  it("the MULTIPLY twin of THIS family IS PRINTED and IS READ — D423 retired the absence", () => {
    expect(deriveAttackDamageMultiplier(DAMAGE_BEAT)).toEqual({
      per: 20,
      count: { kind: "damageCountersOnOpponentActive" },
    });
    expect(deriveAttackDamageBonus(DAMAGE_BEAT)).toBeNull();
    expect(deriveAttackDamagePenalty(DAMAGE_BEAT)).toBeNull();
    expect(deriveAttackEffect(DAMAGE_BEAT)).toBeNull();
    expect(deriveAttackDamageBonus(SECOND_BITE)?.per).toBe(10);
    expect(deriveAttackDamageMultiplier(SECOND_BITE)).toBeNull();
  });

  it("…and an amount NOTHING prints is still claimed by the arm — a parser is not a list", () => {
    expect(deriveAttackDamageMultiplier(UNPRINTED_AMOUNT_ON_A_PRINTED_SHAPE)).toEqual({
      per: 30,
      count: { kind: "damageCountersOnOpponentActive" },
    });
  });
});

describe("the census — discovered from the population, not enumerated", () => {
  it("is exactly THREE fixture attacks, and they are the family", () => {
    const found: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const bonus = deriveAttackDamageBonus(attack.effect ?? "");
        if (bonus?.count.kind === "damageCountersOnOpponentActive") {
          found.push(`${id}[${index}] ${attack.name}`);
        }
      }
    }
    expect(found.sort()).toEqual([
      "sv01-095[0] Second Bite",
      "sv03-086[0] Psychic Assault",
      "sv06.5-025[0] Mad Bite",
    ]);
  });

  it("…and the SELF-side twin's producers are asserted beside them, unmoved", () => {
    const found: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const bonus = deriveAttackDamageBonus(attack.effect ?? "");
        if (bonus?.count.kind === "damageCountersOnSelf") found.push(`${id}[${index}]`);
      }
    }
    expect(found.sort()).toEqual([
      "fix-attacker[3]",
      "fix-attacker[4]",
      "sv01-032[0]",
      "sv02-028[0]",
      "sv03-161[0]",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The fold — ADDITIVE, so the printed base is KEPT.
// ─────────────────────────────────────────────────────────────────────────────

describe("the fold — the printed base is KEPT and `per × counters` is added to it", () => {
  it("ADDS NOTHING against a PRISTINE Active, and the printed base lands whole", () => {
    for (const [attacker, base] of [
      ["dedenne", 30],
      ["espeon", 30],
      ["ursaluna", 100],
    ] as const) {
      const { state, events } = swing(board(attacker, "fix-titan"), attacker);
      const row = findEvent(events, "DAMAGE_DEALT");
      expect(row, attacker).toMatchObject({ base, dealt: base });
      expect(row?.scaled, attacker).toBeUndefined();
      expect(state.players.p2.active?.damage, attacker).toBe(base);
    }
  });

  it("adds 10 PER COUNTER for Dedenne…", () => {
    const { events } = swing(damaged("dedenne", "fix-titan", 3), "dedenne");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 30, scaled: 30, dealt: 60 });
  });

  it("…the SAME 10 for Espeon, off the SAME sentence on a different card…", () => {
    const { events } = swing(damaged("espeon", "fix-titan", 3), "espeon");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 30, scaled: 30, dealt: 60 });
  });

  it("…and 30 PER COUNTER for Bloodmoon Ursaluna, off ONE regex", () => {
    const { events } = swing(damaged("ursaluna", "fix-titan", 3), "ursaluna");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 100, scaled: 90, dealt: 190 });
  });

  it("scales LINEARLY, and the oracle is re-derived from the row's own fields", () => {
    for (const counters of [0, 1, 2, 5, 6]) {
      const row = findEvent(
        swing(damaged("ursaluna", "fix-titan", counters), "ursaluna").events,
        "DAMAGE_DEALT",
      );
      if (row === undefined) throw new Error("no damage row");
      expect(row.scaled ?? 0, `${counters} counters`).toBe(30 * counters);
      expect(row.dealt, `${counters} counters`).toBe(row.base + (row.scaled ?? 0));
    }
  });

  it("COUNTS THE DEFENDER'S COUNTERS, NEVER THE ATTACKER'S", () => {
    let state = board("ursaluna", "fix-titan");
    state = setDamage(state, "p1", 90);
    const { events } = swing(state, "ursaluna");
    expect(findEvent(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(100);
  });

  it("…and BOTH bodies damaged still scores only the DEFENDER's", () => {
    // The separating board: 9 counters on the attacker, 3 on the defender. Self
    // would be 270, the sum would be 360, the right answer is 90.
    let state = damaged("ursaluna", "fix-titan", 3);
    state = setDamage(state, "p1", 90);
    expect(findEvent(swing(state, "ursaluna").events, "DAMAGE_DEALT")).toMatchObject({
      base: 100,
      scaled: 90,
      dealt: 190,
    });
  });

  it("READS THE COUNT AT DECLARATION — this attack cannot bootstrap its own bonus", () => {
    const { state, events } = swing(board("dedenne", "fix-titan"), "dedenne");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 30, dealt: 30 });
    expect(state.players.p2.active?.damage).toBe(30);
    // …and the very next declaration against that same total does score it.
    expect(
      findEvent(swing(damaged("dedenne", "fix-titan", 3), "dedenne").events, "DAMAGE_DEALT")?.dealt,
    ).toBe(60);
  });

  it("leaves index 1 ALONE — a sibling attack does not inherit the clause", () => {
    // Espeon's "Psy Bolt" is a plain 60 with a coin-flip status rider. A fold keyed
    // on the CARD rather than on the declared attack's text would add 30 to it.
    const { events } = swing(damaged("espeon-bolt", "fix-titan", 3), "espeon-bolt");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 60, dealt: 60 });
    expect(row?.scaled).toBeUndefined();
    // …and its own printed text is still simulated, so nothing went loud either.
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("runs identically from the OTHER seat", () => {
    // Nothing in the arm is p1-shaped: `defenderSeat` is the attacker's opposite,
    // and a hard-coded seat would look right on exactly one of these two.
    const { events } = swing(damaged("ursaluna", "fix-titan", 3, "p2"), "ursaluna", "p2");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 100, scaled: 90, dealt: 190 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The null Active — the arm's guard, and why it is unreachable.
// ─────────────────────────────────────────────────────────────────────────────

describe("the null-Active branch — total rather than covering a case", () => {
  it("CANNOT BE REACHED THROUGH `attack`: the gate refuses first, with NO_TARGET", () => {
    const empty = clearActive(damaged("ursaluna", "fix-titan", 3), "p2");
    expect(empty.players.p2.active).toBeNull();
    expectErr(empty, { type: "attack", seat: "p1", index: 0 }, "NO_TARGET");
  });

  it("…and the same board with the Active restored scores normally", () => {
    // The control, so the case above is refused for the reason claimed and not
    // because the board was broken by the surgery.
    expect(
      findEvent(swing(damaged("ursaluna", "fix-titan", 3), "ursaluna").events, "DAMAGE_DEALT"),
    ).toMatchObject({ base: 100, scaled: 90, dealt: 190 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The ORDER, mutated rather than assumed.
// ─────────────────────────────────────────────────────────────────────────────

describe("the ORDER — BEFORE Weakness, and the KO moves with the number", () => {
  it("adds before the ×2, and the right order KOs a body the reversed one does not", () => {
    const { state, events } = swing(damaged("ursaluna", "sv03-066", 2), "ursaluna");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 100, scaled: 60, dealt: 320 });
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(findEvent(events, "KNOCKED_OUT")).toBeDefined();
    expect(state.players.p2.active).toBeNull();
  });

  it("…and the oracle is derived from the ROW's OWN fields, in both placements", () => {
    // One counter fewer, so the body survives and the two placements are two live
    // numbers rather than a KO and a number.
    const row = findEvent(
      swing(damaged("ursaluna", "sv03-066", 1), "ursaluna").events,
      "DAMAGE_DEALT",
    );
    if (row === undefined) throw new Error("no damage row");
    const weakness: DamageModifier | null = row.weakness;
    const before = applyDamageModifier(row.base + (row.scaled ?? 0), weakness);
    const after = applyDamageModifier(row.base, weakness) + (row.scaled ?? 0);
    expect(before).toBe(row.dealt);
    expect(after).not.toBe(row.dealt);
    expect([before, after]).toEqual([260, 230]);
  });

  it("a RESISTANCE cannot witness the order, and the board says so instead", () => {
    const clean = findEvent(
      swing(board("ursaluna", "sv03-086"), "ursaluna").events,
      "DAMAGE_DEALT",
    );
    expect(clean).toMatchObject({ base: 100, dealt: 70 });
    expect(clean?.scaled).toBeUndefined();
    expect(clean?.resistance).toEqual({ op: "subtract", amount: 30 });

    const { state, events } = swing(damaged("ursaluna", "sv03-086", 1), "ursaluna");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 100, scaled: 30, dealt: 100 });
    expect(findEvent(events, "KNOCKED_OUT")).toBeDefined();
    expect(state.players.p2.active).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE.
// ─────────────────────────────────────────────────────────────────────────────

describe("VOICE — the existing `scaled` crumb, rendered under BOTH seats and READ", () => {
  it("reads `· scaled +90` under the ATTACKER's name", () => {
    const { state, events } = swing(damaged("ursaluna", "fix-titan", 3), "ursaluna");
    const row = rendered(state, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p1");
    expect(row?.text).toBe("dealt 190 damage to fix-titan · scaled +90");
  });

  it("renders the SAME sequence when the attacking seat is p2", () => {
    const { state, events } = swing(damaged("ursaluna", "fix-titan", 3, "p2"), "ursaluna", "p2");
    const row = rendered(state, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p2");
    expect(row?.text).toBe("dealt 190 damage to fix-titan · scaled +90");
  });

  it("says nothing at all when the defender is pristine", () => {
    const { state, events } = swing(board("ursaluna", "fix-titan"), "ursaluna");
    const row = rendered(state, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.text).toBe("dealt 100 damage to fix-titan");
  });

  it("AND THE PRINTED TEXT STOPS BEING FLAGGED — all three printings, both terms", () => {
    for (const attacker of ["dedenne", "espeon", "ursaluna"] as const) {
      const { events } = swing(damaged(attacker, "fix-titan", 3), attacker);
      expect(findEvent(events, "ATTACK_EFFECT_SKIPPED"), attacker).toBeUndefined();
    }
    for (const attacker of ["dedenne", "espeon", "ursaluna"] as const) {
      expect(
        findEvent(swing(board(attacker, "fix-titan"), attacker).events, "ATTACK_EFFECT_SKIPPED"),
        attacker,
      ).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The structural answers.
// ─────────────────────────────────────────────────────────────────────────────

describe("the structural answers", () => {
  it("PERSIST: NOTHING was written to `InPlayPokemon`, so MATCH_RECORD_VERSION stays 11", () => {
    const active = board("ursaluna", "fix-titan").players.p1.active;
    if (active === null) throw new Error("no Active");
    expect(Object.keys(active).sort()).toEqual(
      [
        "attackBlock",
        "attackDamageDebuff",
        "attackDamageTaken",
        "attackFlipLockTurn",
        "attackLockedTurn",
        "attackTwoFlipLockTurn",
        "benchedTurn",
        "boostedAttack",
        "conditions",
        "costTaxTurn",
        "damage",
        "damageReduction",
        "damageVulnerability",
        "energy",
        "evolvedTurn",
        "handAttachMark",
        "healedTurn",
        "installedRecoil",
        "koBounty",
        "lockedAttacks",
        "markers",
        "noWeaknessTurn",
        "promotedTurn",
        "retreatBlocked",
        "retreatLockedTurn",
        "scheduledEffect",
        "stack",
        "tools",
        "turnPlayed",
        "usedAttack",
        "weaknessRetype",
      ].sort(),
    );
  });

  it("GATES NO ACTION — the attack is still offered against a pristine Active", () => {
    const state = board("espeon", "fix-titan");
    const view = redactGame(state, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    expect(view.attacks[0]).toMatchObject({ index: 0, name: "Psychic Assault", playable: true });
    expect(applyAction(state, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
  });
});
