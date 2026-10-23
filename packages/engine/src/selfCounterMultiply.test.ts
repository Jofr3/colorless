import { describe, expect, it } from "vitest";
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
  SELF_COUNTER_MULTIPLY_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
  findEvent,
} from "./testFixtures";

/** The two printed sentences, byte-for-byte off the local D1 rows (2026-08-03,
    978 rows / 6 sets). */
const BALLOON_BLAST = "This attack does 30 damage for each damage counter on this Pokémon.";
const RAGING_SWING = "This attack does 50 damage for each damage counter on this Pokémon.";
const RAGING_HORNS = "This attack does 10 more damage for each damage counter on this Pokémon.";
const SWEEPING_TACKLE = "This attack does 20 less damage for each damage counter on this Pokémon.";

const SEED = 7;

const ATTACKERS = {
  drifloon: { card: "sv01-089", index: 1, energy: [{ id: "fix-psychic-energy", count: 2 }] }, // "Balloon Blast" ({P}{P}, "30×")
  "drifloon-gust": { card: "sv01-089", index: 0, energy: [{ id: "fix-energy", count: 2 }] }, // "Gust" ({C}{C}, 10, NO effect key)
  onix: {
    card: "swsh10.5-036",
    index: 1,
    energy: [
      { id: "fix-fighting-energy", count: 2 },
      { id: "fix-energy", count: 2 },
    ],
  }, // "Raging Swing" ({F}{F}{C}{C}, "50×")
  "onix-tomb": { card: "swsh10.5-036", index: 0, energy: [{ id: "fix-energy", count: 3 }] }, // "Rock Tomb" ({C}{C}{C}, 50, a live preventRetreat)
  cetitan: {
    card: "sv01-060",
    index: 1,
    energy: [
      { id: "fix-water-energy", count: 1 },
      { id: "fix-energy", count: 2 },
    ],
  }, // "Sweeping Tackle" ({W}{C}{C}, "200-", 20 LESS per counter)
  rage: { card: "fix-attacker", index: 3, energy: [{ id: "fix-energy", count: 1 }] }, // "Rage" ({C}, "10+", 10 MORE per counter)
} as const;

type Attacker = keyof typeof ATTACKERS;

function board(attacker: Attacker, defender: string, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: SELF_COUNTER_MULTIPLY_DECK, p2: SELF_COUNTER_MULTIPLY_DECK },
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
// The data: two fixtures that did not exist, transcribed rather than bent.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed data — re-queried, not recognised", () => {
  it("carries Drifloon sv01-089's WHOLE printed attack list verbatim", () => {
    expect(FIXTURE_POOL["sv01-089"]).toMatchObject({
      name: "Drifloon",
      category: "Pokemon",
      stage: "Basic",
      hp: 70,
      types: ["Psychic"],
      retreat: 1,
      weaknesses: [{ type: "Darkness", value: "×2" }],
      // Carried because it is PRINTED, and it is why every board below measures
      // against a defender that has none.
      resistances: [{ type: "Fighting", value: "-30" }],
    });
    expect(FIXTURE_POOL["sv01-089"]?.attacks).toEqual([
      { cost: ["Colorless", "Colorless"], name: "Gust", damage: 10 },
      {
        cost: ["Psychic", "Psychic"],
        name: "Balloon Blast",
        effect: BALLOON_BLAST,
        damage: "30×",
      },
    ]);
    expect(FIXTURE_POOL["sv01-089"]?.abilities ?? null).toBeNull();
  });

  it("…and Onix swsh10.5-036's, whose index 0 is a DIFFERENT live mechanism", () => {
    expect(FIXTURE_POOL["swsh10.5-036"]).toMatchObject({
      name: "Onix",
      category: "Pokemon",
      stage: "Basic",
      hp: 120,
      types: ["Fighting"],
      retreat: 4,
      weaknesses: [{ type: "Grass", value: "×2" }],
    });
    expect(FIXTURE_POOL["swsh10.5-036"]?.resistances ?? null).toBeNull();
    expect(FIXTURE_POOL["swsh10.5-036"]?.attacks).toEqual([
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Rock Tomb",
        effect: "During your opponent's next turn, the Defending Pokémon can't retreat.",
        damage: 50,
      },
      {
        cost: ["Fighting", "Fighting", "Colorless", "Colorless"],
        name: "Raging Swing",
        effect: RAGING_SWING,
        damage: "50×",
      },
    ]);
  });

  it("NEITHER BODY EXISTED BEFORE THIS SLICE, and no neighbour could stand in", () => {
    const bare: string[] = [];
    const adjectived: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const text = attack.effect ?? "";
        if (!text.includes("damage counter on this Pokémon")) continue;
        (text.includes(" more damage") || text.includes(" less damage") ? adjectived : bare).push(
          `${id}[${index}]`,
        );
      }
    }
    expect(bare.sort()).toEqual(["sv01-089[1]", "swsh10.5-036[1]"]);
    expect(adjectived.sort()).toEqual(
      [
        "fix-attacker[3]",
        "fix-attacker[4]",
        "sv01-032[0]",
        "sv01-060[1]",
        "sv02-037[1]",
        "sv02-028[0]",
        "sv03-161[0]",
      ].sort(),
    );
  });

  it("AUTHORS nothing — both printings are read off the TEXT", () => {
    for (const id of ["sv01-089", "swsh10.5-036"] as const) {
      expect(programFor(id)).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The reader.
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveAttackDamageMultiplier — one regex, two amounts, an OLD count source", () => {
  it("reads BOTH printed sentences as `damageCountersOnSelf`", () => {
    expect(deriveAttackDamageMultiplier(BALLOON_BLAST)).toEqual({
      per: 30,
      count: { kind: "damageCountersOnSelf" },
    });
    expect(deriveAttackDamageMultiplier(RAGING_SWING)).toEqual({
      per: 50,
      count: { kind: "damageCountersOnSelf" },
    });
  });

  it("KEEPS its two older count sources — a third arm, not a replacement", () => {
    // The arm was placed FIRST in the reader to mirror `deriveAttackDamageBonus`;
    // a `return` reordered past the Prize/Retreat arms would strand them silently,
    // because those sentences are exercised by a different suite entirely.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 60 damage for each Prize card your opponent has taken.",
      ),
    ).toEqual({ per: 60, count: { kind: "opponentPrizesTaken" } });
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 50 damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
      ),
    ).toEqual({ per: 50, count: { kind: "opponentActiveRetreatCost" } });
  });

  it("is DISJOINT from its two adjectived siblings in BOTH directions", () => {
    expect(deriveAttackDamageMultiplier(RAGING_HORNS)).toBeNull();
    expect(deriveAttackDamageMultiplier(SWEEPING_TACKLE)).toBeNull();
    expect(deriveAttackDamageBonus(BALLOON_BLAST)).toBeNull();
    expect(deriveAttackDamageBonus(RAGING_SWING)).toBeNull();
    expect(deriveAttackDamagePenalty(BALLOON_BLAST)).toBeNull();
    expect(deriveAttackDamagePenalty(RAGING_SWING)).toBeNull();
    // …and both twins still read, unchanged, on the same count source.
    expect(deriveAttackDamageBonus(RAGING_HORNS)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnSelf" },
    });
    expect(deriveAttackDamagePenalty(SWEEPING_TACKLE)).toEqual({
      per: 20,
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
    for (const text of [BALLOON_BLAST, RAGING_SWING]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("refuses a printed 0, and every near-miss the anchors exist for", () => {
    // The zero guard every arm in this family carries: 30 × 0 units and 0 × N units
    // are different facts, and a printed 0 must stay LOUD rather than claim a
    // simulated sentence that can never do anything.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 0 damage for each damage counter on this Pokémon.",
      ),
    ).toBeNull();
    for (const near of [
      // a lowercased first word
      "this attack does 30 damage for each damage counter on this Pokémon.",
      // no trailing period
      "This attack does 30 damage for each damage counter on this Pokémon",
      // leading text
      "Flip a coin. This attack does 30 damage for each damage counter on this Pokémon.",
      // trailing text
      "This attack does 30 damage for each damage counter on this Pokémon. Discard an Energy from this Pokémon.",
      "This attack does 30 damage for each damage counter on your Benched Pokémon.",
      // a real Pokémon with a lookalike é would fall off the path silently
      "This attack does 30 damage for each damage counter on this Pokemon.",
    ]) {
      expect(deriveAttackDamageMultiplier(near)).toBeNull();
    }
  });

  it("the DEFENDER-side twin is READ — and it must land on the OTHER count member", () => {
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each damage counter on your opponent's Active Pokémon.",
      ),
    ).toEqual({ per: 30, count: { kind: "damageCountersOnOpponentActive" } });
    // …and the self-side sentence still lands on the self-side member, which is the
    // control that stops the line above passing because arm one stopped matching.
    expect(deriveAttackDamageMultiplier(BALLOON_BLAST)).toEqual({
      per: 30,
      count: { kind: "damageCountersOnSelf" },
    });
  });
});

describe("the census — discovered from the population, not enumerated", () => {
  it("is exactly TWO fixture attacks on this count source, and they are the two printings", () => {
    const found: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const multiply = deriveAttackDamageMultiplier(attack.effect ?? "");
        if (multiply?.count.kind === "damageCountersOnSelf") {
          found.push(`${id}[${index}] ${attack.name}`);
        }
      }
    }
    expect(found.sort()).toEqual(["sv01-089[1] Balloon Blast", "swsh10.5-036[1] Raging Swing"]);
  });

  it("…and the OTHER TWO ADJECTIVES' producers are asserted beside them", () => {
    const by = (read: (text: string) => { count: { kind: string } } | null): string[] => {
      const found: string[] = [];
      for (const [id, card] of Object.entries(FIXTURE_POOL)) {
        for (const [index, attack] of (card.attacks ?? []).entries()) {
          if (read(attack.effect ?? "")?.count.kind === "damageCountersOnSelf") {
            found.push(`${id}[${index}]`);
          }
        }
      }
      return found.sort();
    };
    expect(by(deriveAttackDamageBonus)).toEqual([
      "fix-attacker[3]",
      "fix-attacker[4]",
      "sv01-032[0]",
      "sv02-028[0]",
      "sv03-161[0]",
    ]);
    expect(by(deriveAttackDamagePenalty)).toEqual(["sv01-060[1]", "sv02-037[1]"]);
    expect(by(deriveAttackDamageMultiplier)).toEqual(["sv01-089[1]", "swsh10.5-036[1]"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The fold: `per × count` IS the damage and the printed base is DROPPED.
// ─────────────────────────────────────────────────────────────────────────────

describe("the fold — per × counters as the WHOLE damage, printed base dropped", () => {
  it("does 30 PER COUNTER for Drifloon, and the printed 30 does NOT also land", () => {
    // 3 counters × 30 = 90, reported as base 0 / scaled 90. Were the printed "30×"
    // base kept (folded like the additive family) it would be 120 — one board tells
    // the two folds apart.
    let state = board("drifloon", "fix-titan");
    state = setDamage(state, "p1", 30); // 3 damage counters
    const { state: after, events } = swing(state, "drifloon");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 90, dealt: 90 });
    expect(after.players.p2.active?.damage).toBe(90);
  });

  it("…and 50 PER COUNTER for Onix, off ONE regex", () => {
    let state = board("onix", "fix-titan");
    state = setDamage(state, "p1", 60); // 6 damage counters
    const { events } = swing(state, "onix");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 300, dealt: 300 });
  });

  it("scales LINEARLY off the counter ladder — 1, 3 and 6 counters, one body", () => {
    // Three points on one line pin `Math.floor(damage / 10) * per`: a fold that
    // counted HP rather than COUNTERS, or that clamped, or that read a constant,
    // agrees with at most one of them.
    for (const [damage, dealt] of [
      [10, 30],
      [30, 90],
      [60, 180],
    ] as const) {
      let state = board("drifloon", "fix-titan");
      state = setDamage(state, "p1", damage);
      expect(findEvent(swing(state, "drifloon").events, "DAMAGE_DEALT")?.dealt).toBe(dealt);
    }
  });

  it("AT ZERO COUNTERS THERE IS NO `DAMAGE_DEALT` AT ALL — and that is CORRECT", () => {
    const { state: after, events } = swing(board("drifloon", "fix-titan"), "drifloon");
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(findEvent(events, "KNOCKED_OUT")).toBeUndefined();
    expect(after.players.p2.active?.damage).toBe(0);
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    // The attack was USED: the turn passed to the opponent.
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });

  it("counts the ATTACKER's counters, never the defender's", () => {
    // The count source is `damageCountersOnSelf` and "self" is the attacking body.
    // A reader that took the target's damage would deal 450 here AND would pass
    // every zero-counter case above.
    let state = board("drifloon", "fix-titan");
    state = setDamage(state, "p2", 150);
    const { events } = swing(state, "drifloon");
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(swing(state, "drifloon").state.players.p2.active?.damage).toBe(150);
  });

  it("reads the counters at DECLARATION, so this attack cannot bootstrap its own", () => {
    // The same site every other member of the family counts at. Drifloon takes no
    // recoil, so the honest statement is about the DEFENDER's counters not feeding
    // back: a mid-pipeline re-read would see the 90 it just dealt.
    let state = board("drifloon", "fix-titan");
    state = setDamage(state, "p1", 30);
    const { state: after, events } = swing(state, "drifloon");
    expect(findEvent(events, "DAMAGE_DEALT")?.scaled).toBe(90);
    expect(after.players.p1.active?.damage).toBe(30);
  });

  it("leaves index 0 ALONE — a sibling attack does not inherit the clause", () => {
    // "Gust" carries no `effect` key at all. A fold keyed on the CARD rather than
    // on the declared attack's text would turn this printed 10 into 90.
    let state = board("drifloon-gust", "fix-titan");
    state = setDamage(state, "p1", 30);
    const { events } = swing(state, "drifloon-gust");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 10, dealt: 10 });
    expect(findEvent(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("…and Onix's index 0 keeps its OWN, DIFFERENT mechanism intact", () => {
    let state = board("onix-tomb", "fix-titan");
    state = setDamage(state, "p1", 60);
    const { state: after, events } = swing(state, "onix-tomb");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 50, dealt: 50 });
    expect(findEvent(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
    expect(after.players.p2.active?.retreatBlocked).toBe(true);
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The ORDER, and the three adjectives on ONE board.
// ─────────────────────────────────────────────────────────────────────────────

describe("the ORDER — the whole damage is folded BEFORE Weakness", () => {
  it("doubles the SCALED number, not a printed base that is not there", () => {
    let state = board("drifloon", "fix-psychic-weak");
    state = setDamage(state, "p1", 30);
    const { state: after, events } = swing(state, "drifloon");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 0, scaled: 90, dealt: 180 });
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(after.players.p2.active?.damage).toBe(180);
    expect(findEvent(events, "KNOCKED_OUT")).toBeUndefined();
  });

  it("…and the oracle is derived from the ROW's OWN fields", () => {
    let state = board("drifloon", "fix-psychic-weak");
    state = setDamage(state, "p1", 30);
    const row = findEvent(swing(state, "drifloon").events, "DAMAGE_DEALT");
    if (row === undefined) throw new Error("no damage row");
    const raw = row.base + (row.scaled ?? 0) + (row.bonus ?? 0);
    expect(row.weakness).not.toBeNull();
    expect(raw * 2).toBe(row.dealt);
    // The base is REPORTED as 0 rather than merely unused — the drop is visible in
    // the record, which is what a replaying client reads.
    expect(row.base).toBe(0);
  });

  it("ALL THREE ADJECTIVES, ONE COUNT SOURCE, ONE COUNTER TOTAL, ONE BOARD", () => {
    const at3 = (attacker: Attacker) => {
      let state = board(attacker, "fix-titan");
      state = setDamage(state, "p1", 30);
      return findEvent(swing(state, attacker).events, "DAMAGE_DEALT");
    };
    expect(at3("rage")).toMatchObject({ base: 10, scaled: 30, dealt: 40 });
    expect(at3("drifloon")).toMatchObject({ base: 0, scaled: 90, dealt: 90 });
    expect(at3("cetitan")).toMatchObject({ base: 200, debuff: 60, dealt: 140 });
    expect(at3("rage")?.debuff).toBeUndefined();
    expect(at3("drifloon")?.debuff).toBeUndefined();
    expect(at3("cetitan")?.scaled).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE.
// ─────────────────────────────────────────────────────────────────────────────

describe("VOICE — the crumb, rendered under BOTH seats and READ", () => {
  it("renders the WHOLE damage as ` · scaled +90` off a base of 0", () => {
    let state = board("drifloon", "fix-psychic-weak");
    state = setDamage(state, "p1", 30);
    const { state: after, events } = swing(state, "drifloon");
    const row = rendered(after, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p1");
    expect(row?.text).toBe("dealt 180 damage to fix-psychic-weak · scaled +90 · weakness ×2");
  });

  it("renders the SAME sequence when the attacking seat is p2", () => {
    // `DAMAGE_DEALT.seat` owns the DAMAGED Pokémon and log.ts renders the line under
    // `otherSeat(seat)` — a hardcoded seat would look right on exactly one of these.
    let state = board("drifloon", "fix-psychic-weak", "p2");
    state = setDamage(state, "p2", 30);
    const { state: after, events } = swing(state, "drifloon", "p2");
    const row = rendered(after, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p2");
    expect(row?.text).toBe("dealt 180 damage to fix-psychic-weak · scaled +90 · weakness ×2");
  });

  it("says nothing at all at zero counters — there is no row to speak", () => {
    const { state: after, events } = swing(board("drifloon", "fix-titan"), "drifloon");
    expect(rendered(after, events).some((r) => r.text.startsWith("dealt "))).toBe(false);
    expect(rendered(after, events).some((r) => r.text.includes("not simulated"))).toBe(false);
  });

  it("AND THE PRINTED TEXT STOPS BEING FLAGGED — both halves of it", () => {
    for (const attacker of ["drifloon", "onix"] as const) {
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
  it("PERSIST: NOTHING was written to `InPlayPokemon`, so MATCH_RECORD_VERSION stays 11", () => {
    const active = board("drifloon", "fix-titan").players.p1.active;
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
    const state = board("drifloon", "fix-titan"); // 0 counters → 0 damage
    const view = redactGame(state, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    expect(view.attacks[1]).toMatchObject({ index: 1, name: "Balloon Blast", playable: true });
    expect(applyAction(state, { type: "attack", seat: "p1", index: 1 }).ok).toBe(true);
  });

  it("never mutates the state it was given (purity)", () => {
    let state = board("onix", "fix-titan");
    state = setDamage(state, "p1", 60);
    deepFreeze(state);
    expect(() => applyAction(state, { type: "attack", seat: "p1", index: 1 })).not.toThrow();
  });
});
