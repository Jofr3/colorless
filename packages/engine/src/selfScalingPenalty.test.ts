import { describe, expect, it } from "vitest";
import { applyDamageModifier } from "./cards";
import type { DamageModifier } from "./cards";
import { disabledAbilityUids } from "./continuous";
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
  SELF_SCALING_PENALTY_DECK,
  activeUid,
  attachFromDeck,
  attachToolFromDeck,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
  findEvent,
} from "./testFixtures";

/** The two printed sentences, byte-for-byte off the local D1 rows. */
const BURNING_VOICE = "This attack does 10 less damage for each damage counter on this Pokémon.";
const SWEEPING_TACKLE = "This attack does 20 less damage for each damage counter on this Pokémon.";
const RAGING_HORNS = "This attack does 10 more damage for each damage counter on this Pokémon.";
const BALLOON_BLAST = "This attack does 30 damage for each damage counter on this Pokémon.";

const SEED = 5;

const ATTACKERS = {
  cetitan: {
    card: "sv01-060",
    index: 1,
    energy: [
      { id: "fix-water-energy", count: 1 },
      { id: "fix-energy", count: 2 },
    ],
  }, // "Sweeping Tackle" ({W}{C}{C}, "200-", 20 less per counter)
  "cetitan-hammer": { card: "sv01-060", index: 0, energy: [{ id: "fix-energy", count: 2 }] }, // "Hammer In" ({C}{C}, 50, NO effect key)
  skeledirge: { card: "sv02-037", index: 1, energy: [{ id: "fix-fire-energy", count: 2 }] }, // "Burning Voice" ({R}{R}, "270-", 10 less per counter)
  "skeledirge-song": { card: "sv02-037", index: 0, energy: [{ id: "fix-fire-energy", count: 1 }] }, // "Vitality Song" ({R}, 50, board heal)
  rage: { card: "fix-attacker", index: 3, energy: [{ id: "fix-energy", count: 1 }] }, // "Rage" ({C}, "10+", 10 MORE per counter)
  fury: { card: "fix-attacker", index: 4, energy: [{ id: "fix-energy", count: 1 }] }, // "Fury" ({C}, no base, 20 MORE per counter)
} as const;

type Attacker = keyof typeof ATTACKERS;

function board(attacker: Attacker, defender: string, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: SELF_SCALING_PENALTY_DECK, p2: SELF_SCALING_PENALTY_DECK },
        { first: opener },
      ),
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

function swing(state: GameState, attacker: Attacker, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKERS[attacker].index });
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
// The data: the catalog rows and the two Cetitans.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed data — re-queried, not recognised", () => {
  it("carries Cetitan sv01-060's WHOLE printed attack list verbatim", () => {
    expect(FIXTURE_POOL["sv01-060"]).toMatchObject({
      name: "Cetitan",
      category: "Pokemon",
      stage: "Stage1",
      evolveFrom: "Cetoddle",
      hp: 180,
      types: ["Water"],
      retreat: 3,
      weaknesses: [{ type: "Metal", value: "×2" }],
    });
    expect(FIXTURE_POOL["sv01-060"]?.attacks).toEqual([
      { cost: ["Colorless", "Colorless"], name: "Hammer In", damage: 50 },
      {
        cost: ["Water", "Colorless", "Colorless"],
        name: "Sweeping Tackle",
        effect: SWEEPING_TACKLE,
        damage: "200-",
      },
    ]);
    expect(FIXTURE_POOL["sv01-060"]?.abilities ?? null).toBeNull();
  });

  it("…and Skeledirge ex sv02-037's, which was ALREADY COMPLETE and already carried the sentence", () => {
    expect(FIXTURE_POOL["sv02-037"]?.attacks).toEqual([
      {
        cost: ["Fire"],
        name: "Vitality Song",
        effect: "Heal 30 damage from each of your Pokémon.",
        damage: 50,
      },
      { cost: ["Fire", "Fire"], name: "Burning Voice", effect: BURNING_VOICE, damage: "270-" },
    ]);
  });

  it("THE TWO CETITANS DIFFER IN NOTHING BUT THEIR ATTACKS", () => {
    const [a, b] = [FIXTURE_POOL["sv01-060"], FIXTURE_POOL["sv02-055"]];
    for (const field of ["name", "hp", "stage", "evolveFrom", "retreat"] as const) {
      expect(a?.[field]).toEqual(b?.[field]);
    }
    expect(a?.types).toEqual(b?.types);
    expect(a?.weaknesses).toEqual(b?.weaknesses);
    expect(a?.attacks?.map((x) => x.name)).toEqual(["Hammer In", "Sweeping Tackle"]);
    expect(b?.attacks?.map((x) => x.name)).toEqual(["Icicle Missile", "Special Horn"]);
  });

  it("AUTHORS nothing — both printings are read off the TEXT", () => {
    for (const id of ["sv01-060", "sv02-037"] as const) {
      expect(programFor(id)).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The reader.
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveAttackDamagePenalty — one regex, two amounts", () => {
  it("reads BOTH printed sentences with a POSITIVE `per`", () => {
    expect(deriveAttackDamagePenalty(SWEEPING_TACKLE)).toEqual({
      per: 20,
      count: { kind: "damageCountersOnSelf" },
    });
    expect(deriveAttackDamagePenalty(BURNING_VOICE)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnSelf" },
    });
  });

  it("is DISJOINT from its two siblings in both directions", () => {
    expect(deriveAttackDamagePenalty(RAGING_HORNS)).toBeNull();
    expect(deriveAttackDamagePenalty(BALLOON_BLAST)).toBeNull();
    expect(deriveAttackDamageBonus(SWEEPING_TACKLE)).toBeNull();
    expect(deriveAttackDamageBonus(BURNING_VOICE)).toBeNull();
    expect(deriveAttackDamageMultiplier(SWEEPING_TACKLE)).toBeNull();
    expect(deriveAttackDamageMultiplier(BURNING_VOICE)).toBeNull();
    // …and the "more" twin still reads, unchanged, on the same count source.
    expect(deriveAttackDamageBonus(RAGING_HORNS)).toEqual({
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

  it("the multiply twin on the same count source is the MULTIPLY reader's (D167)", () => {
    expect(deriveAttackDamageMultiplier(BALLOON_BLAST)).toEqual({
      per: 30,
      count: { kind: "damageCountersOnSelf" },
    });
    expect(deriveAttackDamagePenalty(BALLOON_BLAST)).toBeNull();
    expect(deriveAttackDamageBonus(BALLOON_BLAST)).toBeNull();
    expect(deriveAttackEffect(BALLOON_BLAST)).toBeNull();
  });

  it("STAYS LOUD as an op — the sentence derives no post-damage program", () => {
    for (const text of [SWEEPING_TACKLE, BURNING_VOICE]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("refuses a printed 0, and every near-miss the anchors exist for", () => {
    // The zero guard every arm in this family carries: a 0 subtracts nothing, so it
    // must stay LOUD rather than claim a simulated sentence that does nothing.
    expect(
      deriveAttackDamagePenalty(
        "This attack does 0 less damage for each damage counter on this Pokémon.",
      ),
    ).toBeNull();
    for (const near of [
      // a lowercased first word
      "this attack does 20 less damage for each damage counter on this Pokémon.",
      // no trailing period
      "This attack does 20 less damage for each damage counter on this Pokémon",
      // leading text
      "Flip a coin. This attack does 20 less damage for each damage counter on this Pokémon.",
      // trailing text
      "This attack does 20 less damage for each damage counter on this Pokémon. Discard an Energy from this Pokémon.",
      "This attack does 20 less damage for each damage counter on your opponent's Active Pokémon.",
      // a real Pokémon with a lookalike é would fall off the path silently
      "This attack does 20 less damage for each damage counter on this Pokemon.",
    ]) {
      expect(deriveAttackDamagePenalty(near)).toBeNull();
    }
  });
});

describe("the census — discovered from the population, not enumerated", () => {
  it("D438 — is exactly FOUR fixture attacks, on TWO count sources", () => {
    const found: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const read = deriveAttackDamagePenalty(attack.effect ?? "");
        if (read !== null) found.push(`${id}[${index}] ${read.count.kind}`);
      }
    }
    expect(found.sort()).toEqual([
      "fix-retreatless[0] opponentActiveRetreatCost",
      "fix-retreatless[1] opponentActiveRetreatCost",
      "sv01-060[1] damageCountersOnSelf",
      "sv02-037[1] damageCountersOnSelf",
    ]);
  });

  it("…and the SIGN-FLIPPED TWIN's producers are asserted beside them", () => {
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
// The fold.
// ─────────────────────────────────────────────────────────────────────────────

describe("the fold — the printed base is KEPT and `per × counters` comes off it", () => {
  it("subtracts NOTHING at zero counters, and the base lands whole", () => {
    // "200-" parses to base 200 with a "-" marker, and at zero counters the attack
    // really does its printed number — which is what makes the marker a marker.
    const { state, events } = swing(board("cetitan", "fix-titan"), "cetitan");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 200, dealt: 200 });
    expect(findEvent(events, "DAMAGE_DEALT")?.debuff).toBeUndefined();
    expect(state.players.p2.active?.damage).toBe(200);
  });

  it("subtracts 20 PER COUNTER for Cetitan…", () => {
    let state = board("cetitan", "fix-titan");
    state = setDamage(state, "p1", 30); // 3 damage counters
    const { events } = swing(state, "cetitan");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 200, debuff: 60, dealt: 140 });
  });

  it("…and 10 PER COUNTER for Skeledirge ex, off ONE regex", () => {
    let state = board("skeledirge", "fix-titan");
    state = setDamage(state, "p1", 100); // 10 damage counters
    const { events } = swing(state, "skeledirge");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 270, debuff: 100, dealt: 170 });
  });

  it("counts the ATTACKER's counters, never the defender's", () => {
    // The count source is `damageCountersOnSelf` and "self" is the attacking body.
    // A reader that took the target's damage would be right about nothing and would
    // pass every zero-counter case above.
    let state = board("cetitan", "fix-titan");
    state = setDamage(state, "p2", 150);
    const { events } = swing(state, "cetitan");
    expect(findEvent(events, "DAMAGE_DEALT")?.debuff).toBeUndefined();
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(200);
  });

  it("reads the counters at DECLARATION, so a body healed to zero pays nothing", () => {
    // The same site every other member of the family counts at — this attack's own
    // result cannot bootstrap the number it reads, and neither can a heal that has
    // not happened.
    let state = board("skeledirge-song", "fix-titan");
    state = setDamage(state, "p1", 100);
    // "Vitality Song" heals 30 from the whole own board AFTER its 50 lands, so the
    // attacker is at 70 when the next declaration reads it.
    const healed = swing(state, "skeledirge-song").state;
    expect(healed.players.p1.active?.damage).toBe(70);
  });

  it("leaves index 0 ALONE — a sibling attack does not inherit the clause", () => {
    // "Hammer In" carries no `effect` key at all. A fold keyed on the CARD rather
    // than on the declared attack's text would take 60 off this too.
    let state = board("cetitan-hammer", "fix-titan");
    state = setDamage(state, "p1", 30);
    const { events } = swing(state, "cetitan-hammer");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 50, dealt: 50 });
    expect(findEvent(events, "DAMAGE_DEALT")?.debuff).toBeUndefined();
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("the SIGN-FLIPPED TWIN still ADDS, on the same board and the same count", () => {
    let state = board("rage", "fix-titan");
    state = setDamage(state, "p1", 30);
    expect(findEvent(swing(state, "rage").events, "DAMAGE_DEALT")).toMatchObject({
      base: 10,
      scaled: 30,
      dealt: 40,
    });
    let fury = board("fury", "fix-titan");
    fury = setDamage(fury, "p1", 30);
    const furyRow = findEvent(swing(fury, "fury").events, "DAMAGE_DEALT");
    expect(furyRow).toMatchObject({ base: 0, scaled: 60, dealt: 60 });
    expect(furyRow?.debuff).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The clamp.
// ─────────────────────────────────────────────────────────────────────────────

describe("the clamp — inherited, taken over the WHOLE pre-W/R sum", () => {
  it("floors at 0 when the penalty reaches the base, and STILL emits the row", () => {
    let state = board("cetitan", "fix-titan");
    state = setDamage(state, "p1", 100); // 10 counters × 20 = 200
    const { events } = swing(state, "cetitan");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 200, debuff: 200, dealt: 0 });
    expect(row?.prevented).toBeUndefined();
  });

  it("THE CLAMP IS ON THE SUM, NOT PER TERM — a Vitality Band cannot survive it", () => {
    let state = board("cetitan", "sv02-037");
    state = setDamage(state, "p1", 150);
    state = attachToolFromDeck(state, "p1", "active", "sv01-197");
    const { events } = swing(state, "cetitan");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 200, debuff: 300, dealt: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")?.bonus).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The ORDER, mutated rather than assumed.
// ─────────────────────────────────────────────────────────────────────────────

describe("the ORDER — BEFORE Weakness, and the oracle is re-driven from the row", () => {
  it("subtracts before the ×2, and the reversed order KOs a body the right one does not", () => {
    let state = board("cetitan", "sv02-037");
    state = setDamage(state, "p1", 30);
    const { state: after, events } = swing(state, "cetitan");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 200, debuff: 60, dealt: 280 });
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(after.players.p2.active?.damage).toBe(280);
    expect(findEvent(events, "KNOCKED_OUT")).toBeUndefined();
  });

  it("…and the oracle is derived from the ROW's OWN fields, in both placements", () => {
    let state = board("cetitan", "sv02-037");
    state = setDamage(state, "p1", 30);
    const row = findEvent(swing(state, "cetitan").events, "DAMAGE_DEALT");
    if (row === undefined) throw new Error("no damage row");
    const weakness: DamageModifier | null = row.weakness;
    const raw = row.base + (row.scaled ?? 0) + (row.bonus ?? 0);
    const before = applyDamageModifier(Math.max(0, raw - (row.debuff ?? 0)), weakness);
    const after = Math.max(0, applyDamageModifier(raw, weakness) - (row.debuff ?? 0));
    expect(before).toBe(row.dealt);
    expect(after).not.toBe(row.dealt);
    expect([before, after]).toEqual([280, 340]);
  });

  it("commutes with the pre-W/R BONUS, which is what summing into one term means", () => {
    let state = board("cetitan", "sv02-037");
    state = setDamage(state, "p1", 30);
    state = attachToolFromDeck(state, "p1", "active", "sv01-197");
    const { events } = swing(state, "cetitan");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      base: 200,
      bonus: 10,
      debuff: 60,
      dealt: 300,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// One field, three sources.
// ─────────────────────────────────────────────────────────────────────────────

describe("`debuff` — the third source on a field that already summed two", () => {
  it("SUMS with Entei's always-on Pressure into ONE number", () => {
    let state = board("cetitan", "sv03-030");
    state = setDamage(state, "p1", 30);
    const { events } = swing(state, "cetitan");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 200, debuff: 80, dealt: 240 });
  });

  it("…with BOTH halves of that sum separated on their own boards", () => {
    // Pressure alone: 20. The penalty alone: 60. Neither control can be produced by
    // an implementation that reported only one of the two sources.
    const pressureOnly = findEvent(
      swing(board("cetitan", "sv03-030"), "cetitan").events,
      "DAMAGE_DEALT",
    );
    expect(pressureOnly).toMatchObject({ debuff: 20, dealt: 360 });
    let penaltyOnly = board("cetitan", "fix-titan");
    penaltyOnly = setDamage(penaltyOnly, "p1", 30);
    expect(findEvent(swing(penaltyOnly, "cetitan").events, "DAMAGE_DEALT")).toMatchObject({
      debuff: 60,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 and ignoreWR.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 and `ignoreWR` — where this printing sits on both axes", () => {
  it("AN ABILITY-LOCK REACHES THE VERY BODY AND STILL CANNOT TOUCH THE NUMBER", () => {
    let state = board("cetitan", "sv02-127");
    state = setDamage(state, "p1", 30);
    expect(disabledAbilityUids(state).has(activeUid(state, "p1"))).toBe(true);
    const { events } = swing(state, "cetitan");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 200, debuff: 60, dealt: 140 });
  });

  it("`ignoreWR` cannot reach it either, and the reason is STRUCTURAL", () => {
    expect(deriveAttackEffect(SWEEPING_TACKLE)).toBeNull();
    expect(deriveAttackEffect(BURNING_VOICE)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE.
// ─────────────────────────────────────────────────────────────────────────────

describe("VOICE — the crumb, rendered under BOTH seats and READ", () => {
  it("reads `· weakened −60` under the ATTACKER's name, and the row is filed under the defender", () => {
    let state = board("cetitan", "sv03-030");
    state = setDamage(state, "p1", 30);
    const { state: after, events } = swing(state, "cetitan");
    const row = rendered(after, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p1");
    expect(row?.text).toBe("dealt 240 damage to Entei · weakened −80 · weakness ×2");
  });

  it("renders the SAME sequence when the attacking seat is p2", () => {
    let state = board("cetitan", "sv03-030", "p2");
    state = setDamage(state, "p2", 30);
    const { state: after, events } = swing(state, "cetitan", "p2");
    const row = rendered(after, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p2");
    expect(row?.text).toBe("dealt 240 damage to Entei · weakened −80 · weakness ×2");
  });

  it("says nothing at all when the penalty is 0", () => {
    const { state: after, events } = swing(board("cetitan", "fix-titan"), "cetitan");
    const row = rendered(after, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.text).toBe("dealt 200 damage to fix-titan");
  });

  it("AND THE PRINTED TEXT STOPS BEING FLAGGED — both halves of it", () => {
    for (const attacker of ["cetitan", "skeledirge"] as const) {
      let state = board(attacker, "fix-titan");
      state = setDamage(state, "p1", 30);
      expect(findEvent(swing(state, attacker).events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The structural answers.
// ─────────────────────────────────────────────────────────────────────────────

describe("the structural answers", () => {
  it("PERSIST: NOTHING was written to `InPlayPokemon`, so MATCH_RECORD_VERSION stays 10", () => {
    const active = board("cetitan", "fix-titan").players.p1.active;
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

  it("GATES NO ACTION — the attack is still offered when it would deal 0", () => {
    let state = board("cetitan", "fix-titan");
    state = setDamage(state, "p1", 150);
    const view = redactGame(state, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    expect(view.attacks[1]).toMatchObject({ index: 1, name: "Sweeping Tackle", playable: true });
    expect(applyAction(state, { type: "attack", seat: "p1", index: 1 }).ok).toBe(true);
  });
});
