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
  OPPONENT_COUNTER_MULTIPLY_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
  findEvent,
  roundTrip,
} from "./testFixtures";

const DAMAGE_BEAT =
  "This attack does 20 damage for each damage counter on your opponent's Active Pokémon.";
const SECOND_BITE =
  "This attack does 10 more damage for each damage counter on your opponent's Active Pokémon.";
const BALLOON_BLAST = "This attack does 20 damage for each damage counter on this Pokémon.";
const UNPRINTED_PENALTY =
  "This attack does 20 less damage for each damage counter on your opponent's Active Pokémon.";

const SEED = 11;

const ATTACKERS = {
  glalie: { card: "fix-glalie", index: 0, energy: [{ id: "fix-water-energy", count: 1 }] }, // "Damage Beat" ({W}, "20×")
  "glalie-headbutt": {
    card: "fix-glalie",
    index: 1,
    energy: [
      { id: "fix-water-energy", count: 1 },
      { id: "fix-energy", count: 2 },
    ],
  }, // "Crazy Headbutt" ({W}{C}{C}, 140, a live discardEnergy)
  flapple: { card: "fix-flapple", index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // "Acidic Spit" ({C}, "20×")
  "flapple-dive": {
    card: "fix-flapple",
    index: 1,
    energy: [
      { id: "fix-grass-energy", count: 1 },
      { id: "fix-fire-energy", count: 1 },
    ],
  }, // "Speed Dive" ({G}{R}, 70, NO effect key)
  dedenne: {
    card: "sv01-095",
    index: 0,
    energy: [
      { id: "fix-psychic-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ],
  },
} as const;

type Attacker = keyof typeof ATTACKERS;

function board(attacker: Attacker, defender: string, counters = 0, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: OPPONENT_COUNTER_MULTIPLY_DECK, p2: OPPONENT_COUNTER_MULTIPLY_DECK },
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
  state = clearBench(state, opener);
  return counters === 0 ? state : setDamage(state, opener, counters * 10);
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

describe("§1 — the printed data, transcribed rather than recognised", () => {
  it("carries Glalie sv06-052's WHOLE printed attack list verbatim", () => {
    expect(FIXTURE_POOL["fix-glalie"]).toMatchObject({
      category: "Pokemon",
      stage: "Stage1",
      evolveFrom: "Snorunt",
      hp: 120,
      types: ["Water"],
      retreat: 2,
      weaknesses: [{ type: "Metal", value: "×2" }],
    });
    expect(FIXTURE_POOL["fix-glalie"]?.resistances ?? null).toBeNull();
    expect(FIXTURE_POOL["fix-glalie"]?.abilities ?? null).toBeNull();
    expect(FIXTURE_POOL["fix-glalie"]?.attacks).toEqual([
      { cost: ["Water"], name: "Damage Beat", effect: DAMAGE_BEAT, damage: "20×" },
      {
        cost: ["Water", "Colorless", "Colorless"],
        name: "Crazy Headbutt",
        effect: "Discard an Energy from this Pokémon.",
        damage: 140,
      },
    ]);
  });

  it("…and Flapple sv08-139's, whose index 1 carries NO effect key at all", () => {
    expect(FIXTURE_POOL["fix-flapple"]).toMatchObject({
      category: "Pokemon",
      stage: "Stage1",
      evolveFrom: "Applin",
      hp: 80,
      types: ["Dragon"],
      retreat: 1,
    });
    expect(FIXTURE_POOL["fix-flapple"]?.weaknesses ?? null).toBeNull();
    expect(FIXTURE_POOL["fix-flapple"]?.resistances ?? null).toBeNull();
    expect(FIXTURE_POOL["fix-flapple"]?.attacks).toEqual([
      { cost: ["Colorless"], name: "Acidic Spit", effect: DAMAGE_BEAT, damage: "20×" },
      { cost: ["Grass", "Fire"], name: "Speed Dive", damage: 70 },
    ]);
  });

  it("ONE SENTENCE ON TWO CARDS — asserted as an IDENTITY, not as two literals", () => {
    const glalie = FIXTURE_POOL["fix-glalie"]?.attacks?.[0]?.effect;
    const flapple = FIXTURE_POOL["fix-flapple"]?.attacks?.[0]?.effect;
    expect(glalie).toBe(flapple);
    expect(glalie).toBe(DAMAGE_BEAT);
    // …and the bytes the family's anchors turn on, hex-verified rather than
    // eyeballed: an ASCII possessive and a real é.
    expect(DAMAGE_BEAT).toContain("opponent's");
    expect(DAMAGE_BEAT).not.toContain("’");
    expect(DAMAGE_BEAT).toContain("Pokémon");
  });

  it("AUTHORS nothing — both printings are read off the TEXT", () => {
    for (const id of ["fix-glalie", "fix-flapple"] as const) {
      expect(programFor(id)).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reader.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — deriveAttackDamageMultiplier gains ONE arm on an OLD count source", () => {
  it("reads the printed sentence as `damageCountersOnOpponentActive`", () => {
    expect(deriveAttackDamageMultiplier(DAMAGE_BEAT)).toEqual({
      per: 20,
      count: { kind: "damageCountersOnOpponentActive" },
    });
  });

  it("the `(\\d+)` CAPTURE IS SPANNED BY ONE PRINTED AMOUNT TODAY, and that is SAID", () => {
    expect(deriveAttackDamageMultiplier(DAMAGE_BEAT.replace(" 20 ", " 70 "))).toEqual({
      per: 70,
      count: { kind: "damageCountersOnOpponentActive" },
    });
  });

  it("KEEPS every older count source — a new arm, not a reordering", () => {
    // The arm was inserted FOURTH to mirror `deriveAttackDamageBonus`'s order. A
    // `return` placed past the three arms above it would strand them silently,
    // because those sentences are exercised by different suites entirely.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 20 damage for each damage counter on this Pokémon.",
      ),
    ).toEqual({ per: 20, count: { kind: "damageCountersOnSelf" } });
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
    // …and the arms placed AFTER the new one, which is the half a bad insertion
    // point breaks rather than the half above it.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 10 damage for each damage counter on all of your Benched Pokémon.",
      ),
    ).toEqual({ per: 10, count: { kind: "damageCountersOnYourBench" } });
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each of your opponent's Benched Pokémon.",
      ),
    ).toEqual({ per: 30, count: { kind: "opponentBenchCount" } });
  });

  it("REFUSES THE ADDITIVE SIBLING, and the additive reader refuses this one", () => {
    expect(
      `This attack does 10 more damage for each damage counter on your opponent's Active Pokémon.`,
    ).toBe(SECOND_BITE);
    for (const per of [10, 30, 40, 50]) {
      const more = `This attack does ${per} more damage for each damage counter on your opponent's Active Pokémon.`;
      expect(deriveAttackDamageMultiplier(more), more).toBeNull();
      expect(deriveAttackDamageBonus(more), more).toEqual({
        per,
        count: { kind: "damageCountersOnOpponentActive" },
      });
    }
    expect(deriveAttackDamageBonus(DAMAGE_BEAT)).toBeNull();
    expect(deriveAttackDamagePenalty(DAMAGE_BEAT)).toBeNull();
  });

  it("is DISJOINT from the SELF-side twin on the same fold, in both directions", () => {
    expect(deriveAttackDamageMultiplier(BALLOON_BLAST)).toEqual({
      per: 20,
      count: { kind: "damageCountersOnSelf" },
    });
    expect(deriveAttackDamageMultiplier(DAMAGE_BEAT)?.count.kind).toBe(
      "damageCountersOnOpponentActive",
    );
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
    expect(deriveAttackEffect(DAMAGE_BEAT)).toBeNull();
  });

  it("refuses a printed 0, and every near-miss the anchor exists for", () => {
    // The zero guard every arm in both families carries: 20 × 0 units and 0 × N
    // units are different facts, and a printed 0 must stay LOUD rather than claim a
    // simulated sentence that can never do anything.
    expect(deriveAttackDamageMultiplier(DAMAGE_BEAT.replace(" 20 ", " 0 "))).toBeNull();
    for (const near of [
      // a lowercased first word
      DAMAGE_BEAT.replace("This", "this"),
      // no trailing period
      DAMAGE_BEAT.slice(0, -1),
      // leading text
      `Flip a coin. ${DAMAGE_BEAT}`,
      // trailing text
      `${DAMAGE_BEAT} Discard an Energy from this Pokémon.`,
      // a real Pokémon with a lookalike é would fall off the path silently
      DAMAGE_BEAT.replace("Pokémon", "Pokemon"),
      // the "less" spelling of THIS count source — ZERO rows in all three columns
      // of the remote D1, so it is an absence, and it is refused
      // because a SIGN is a FOLD and this reader owns only one
      UNPRINTED_PENALTY,
      // the BENCH-wide neighbour — the opponent's Bench counted as COUNTERS is
      // printed NOWHERE (same run, same three columns), and the sentence
      // `BENCH_COUNTER_MULTIPLY` really does read names YOUR Bench with an "all of"
      "This attack does 20 damage for each damage counter on your opponent's Benched Pokémon.",
      // the possessive dropped: "your opponent" is not a body
      DAMAGE_BEAT.replace("opponent's Active", "opponent Active"),
    ]) {
      expect(deriveAttackDamageMultiplier(near), near).toBeNull();
    }
  });

  it("THE 'less' SPELLING IS AN ABSENCE ON ALL THREE READERS — re-measured, not inherited", () => {
    expect(deriveAttackDamageMultiplier(UNPRINTED_PENALTY)).toBeNull();
    expect(deriveAttackDamageBonus(UNPRINTED_PENALTY)).toBeNull();
    expect(deriveAttackDamagePenalty(UNPRINTED_PENALTY)).toBeNull();
    expect(
      deriveAttackDamagePenalty(
        "This attack does 20 less damage for each damage counter on this Pokémon.",
      ),
    ).toEqual({ per: 20, count: { kind: "damageCountersOnSelf" } });
  });
});

describe("§3 — the census, discovered from the population", () => {
  it("is exactly TWO fixture attacks on this count source at this fold", () => {
    const found: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const multiply = deriveAttackDamageMultiplier(attack.effect ?? "");
        if (multiply?.count.kind === "damageCountersOnOpponentActive") {
          found.push(`${id}[${index}] ${attack.name}`);
        }
      }
    }
    expect(found.sort()).toEqual(["fix-flapple[0] Acidic Spit", "fix-glalie[0] Damage Beat"]);
  });

  it("…and D168's ADDITIVE producers are asserted beside them, UNMOVED", () => {
    const by = (read: (text: string) => { count: { kind: string } } | null): string[] => {
      const found: string[] = [];
      for (const [id, card] of Object.entries(FIXTURE_POOL)) {
        for (const [index, attack] of (card.attacks ?? []).entries()) {
          if (read(attack.effect ?? "")?.count.kind === "damageCountersOnOpponentActive") {
            found.push(`${id}[${index}]`);
          }
        }
      }
      return found.sort();
    };
    expect(by(deriveAttackDamageBonus)).toEqual(["sv01-095[0]", "sv03-086[0]", "sv06.5-025[0]"]);
    expect(by(deriveAttackDamageMultiplier)).toEqual(["fix-flapple[0]", "fix-glalie[0]"]);
    expect(by(deriveAttackDamagePenalty)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the fold: `per × counters` IS the damage and the printed base is DROPPED.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — per × the DEFENDER's counters as the WHOLE damage", () => {
  it("does 20 PER COUNTER for Glalie, and the printed 20 does NOT also land", () => {
    // 3 counters × 20 = 60, reported as base 0 / scaled 60. Were the printed "20×"
    // base kept (folded like the additive twin) it would be 80 — one board tells the
    // two folds apart, on a count source both of them read.
    const { state: after, events } = swing(board("glalie", "fix-titan", 3), "glalie");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 60, dealt: 60 });
    expect(after.players.p2.active?.damage).toBe(90); // the 30 it already had, plus 60
  });

  it("…and the SAME sentence on the SECOND card, at a different cost and type", () => {
    // Flapple pays {C} where Glalie pays {W}, is Dragon where Glalie is Water, and
    // has 80 HP where Glalie has 120 — so a reader keyed on anything but the TEXT
    // passes one of these two and fails the other.
    const { events } = swing(board("flapple", "fix-titan", 3), "flapple");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 60, dealt: 60 });
  });

  it("scales LINEARLY off the counter ladder — 1, 3 and 10 counters, one body", () => {
    for (const [counters, dealt] of [
      [1, 20],
      [3, 60],
      [10, 200],
    ] as const) {
      expect(
        findEvent(swing(board("glalie", "fix-titan", counters), "glalie").events, "DAMAGE_DEALT")
          ?.dealt,
      ).toBe(dealt);
    }
  });

  it("AT ZERO COUNTERS THERE IS NO `DAMAGE_DEALT` AT ALL — and that is CORRECT", () => {
    const { state: after, events } = swing(board("glalie", "fix-titan"), "glalie");
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(findEvent(events, "KNOCKED_OUT")).toBeUndefined();
    expect(after.players.p2.active?.damage).toBe(0);
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    // The attack was USED: the turn passed to the opponent.
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });

  it("counts the DEFENDER's counters, never the attacker's", () => {
    let state = board("glalie", "fix-titan");
    state = setDamage(state, "p1", 100); // 10 counters on the ATTACKER, 0 on the defender
    const { state: after, events } = swing(state, "glalie");
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(after.players.p2.active?.damage).toBe(0);
    expect(after.players.p1.active?.damage).toBe(100);
  });

  it("reads the counters at DECLARATION, so this attack cannot bootstrap its own", () => {
    // The site every member of the family counts at, and the one that MATTERS most
    // on this member: the counters are on the body this attack is about to damage,
    // so a mid-pipeline re-read would see the 60 it just dealt and score 180.
    const { state: after, events } = swing(board("glalie", "fix-titan", 3), "glalie");
    expect(findEvent(events, "DAMAGE_DEALT")?.scaled).toBe(60);
    expect(after.players.p2.active?.damage).toBe(90);
  });

  it("leaves index 1 ALONE when it carries NO effect — Flapple's Speed Dive", () => {
    // "Speed Dive" has no `effect` key at all. A fold keyed on the CARD rather than
    // on the declared attack's text would turn this printed 70 into 20 × 3.
    const { events } = swing(board("flapple-dive", "fix-titan", 3), "flapple-dive");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 70, dealt: 70 });
    expect(findEvent(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("…and Glalie's index 1 keeps its OWN, DIFFERENT live mechanism intact", () => {
    const before = board("glalie-headbutt", "fix-titan", 3);
    expect(before.players.p1.active?.energy).toHaveLength(3);
    const { state: after, events } = swing(before, "glalie-headbutt");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 140, dealt: 140 });
    expect(findEvent(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
    expect(after.phase.kind).toBe("effect:choose");
    expect(after.players.p1.active?.energy).toHaveLength(3);
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("BOTH FOLDS ON ONE COUNT SOURCE, ONE COUNTER TOTAL, ONE BOARD", () => {
    const at5 = (attacker: Attacker) =>
      findEvent(swing(board(attacker, "fix-titan", 5), attacker).events, "DAMAGE_DEALT");
    expect(at5("glalie")).toMatchObject({ base: 0, scaled: 100, dealt: 100 });
    expect(at5("dedenne")).toMatchObject({ base: 30, scaled: 50, dealt: 80 });
    expect(at5("glalie")?.debuff).toBeUndefined();
    expect(at5("dedenne")?.debuff).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the ORDER: the whole damage is folded BEFORE Weakness.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the fold lands BEFORE Weakness, and there is no base underneath it", () => {
  it("doubles the SCALED number, not a printed base that is not there", () => {
    const { state: after, events } = swing(board("glalie", "fix-water-weak", 3), "glalie");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 0, scaled: 60, dealt: 120 });
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(after.players.p2.active?.damage).toBe(150);
    expect(findEvent(events, "KNOCKED_OUT")).toBeUndefined();
  });

  it("…and the oracle is derived from the ROW's OWN fields", () => {
    const row = findEvent(
      swing(board("glalie", "fix-water-weak", 3), "glalie").events,
      "DAMAGE_DEALT",
    );
    if (row === undefined) throw new Error("no damage row");
    const raw = row.base + (row.scaled ?? 0) + (row.bonus ?? 0);
    expect(row.weakness).not.toBeNull();
    expect(raw * 2).toBe(row.dealt);
    // The base is REPORTED as 0 rather than merely unused — the drop is visible in
    // the record, which is what a replaying client reads.
    expect(row.base).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — VOICE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the crumb, rendered under BOTH seats and READ", () => {
  it("renders the WHOLE damage as ` · scaled +60` off a base of 0", () => {
    const { state: after, events } = swing(board("glalie", "fix-water-weak", 3), "glalie");
    const row = rendered(after, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p1");
    expect(row?.text).toBe("dealt 120 damage to fix-water-weak · scaled +60 · weakness ×2");
  });

  it("renders the SAME sequence when the attacking seat is p2", () => {
    // `DAMAGE_DEALT.seat` owns the DAMAGED Pokémon and log.ts renders the line under
    // `otherSeat(seat)` — a hardcoded seat would look right on exactly one of these.
    const { state: after, events } = swing(
      board("glalie", "fix-water-weak", 3, "p2"),
      "glalie",
      "p2",
    );
    const row = rendered(after, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p2");
    expect(row?.text).toBe("dealt 120 damage to fix-water-weak · scaled +60 · weakness ×2");
  });

  it("says nothing at all against a PRISTINE Active — there is no row to speak", () => {
    const { state: after, events } = swing(board("glalie", "fix-titan"), "glalie");
    expect(rendered(after, events).some((r) => r.text.startsWith("dealt "))).toBe(false);
    expect(rendered(after, events).some((r) => r.text.includes("not simulated"))).toBe(false);
  });

  it("AND THE PRINTED TEXT STOPS BEING FLAGGED — on both cards", () => {
    for (const attacker of ["glalie", "flapple"] as const) {
      expect(
        findEvent(swing(board(attacker, "fix-titan", 3), attacker).events, "ATTACK_EFFECT_SKIPPED"),
      ).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the structural answers, and the persisted question.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the structural answers", () => {
  it("`MATCH_RECORD_VERSION` STAYS 26, and it is DRIVEN rather than reasoned", () => {
    const live = board("glalie", "fix-titan", 3);
    const persisted = roundTrip(live);
    const liveRow = findEvent(swing(live, "glalie").events, "DAMAGE_DEALT");
    const replayedRow = findEvent(swing(persisted, "glalie").events, "DAMAGE_DEALT");
    expect(replayedRow).toEqual(liveRow);
    expect(replayedRow).toMatchObject({ base: 0, scaled: 60, dealt: 60 });
    const active = live.players.p1.active;
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

  it("…and the EVENT this fold emits is key-for-key a SHIPPED sentence's event", () => {
    const mine = findEvent(swing(board("glalie", "fix-titan", 3), "glalie").events, "DAMAGE_DEALT");
    const shipped = findEvent(
      swing(board("dedenne", "fix-titan", 3), "dedenne").events,
      "DAMAGE_DEALT",
    );
    if (mine === undefined || shipped === undefined) throw new Error("no damage row");
    expect(Object.keys(mine).sort()).toEqual(Object.keys(shipped).sort());
  });

  it("GATES NO ACTION — the attack is still offered when it would deal 0", () => {
    const state = board("glalie", "fix-titan"); // pristine defender → 0 damage
    const view = redactGame(state, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    expect(view.attacks[0]).toMatchObject({ index: 0, name: "Damage Beat", playable: true });
    expect(applyAction(state, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
  });

  it("never mutates the state it was given (purity)", () => {
    const state = board("glalie", "fix-titan", 3);
    deepFreeze(state);
    expect(() => applyAction(state, { type: "attack", seat: "p1", index: 0 })).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — the cast, and the deck is 60.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the cast", () => {
  it("the deck is 60 cards and the pool holds every id in it", () => {
    expect(OPPONENT_COUNTER_MULTIPLY_DECK).toHaveLength(60);
    for (const id of new Set(OPPONENT_COUNTER_MULTIPLY_DECK)) {
      expect(FIXTURE_POOL[id], id).toBeDefined();
    }
  });

  it("NEITHER BODY EXISTED BEFORE THIS SLICE, and no neighbour could stand in", () => {
    const bare: string[] = [];
    const adjectived: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const text = attack.effect ?? "";
        if (!text.includes("damage counter on your opponent's Active Pokémon")) continue;
        (text.includes(" more damage") || text.includes(" less damage") ? adjectived : bare).push(
          `${id}[${index}]`,
        );
      }
    }
    expect(bare.sort()).toEqual(["fix-flapple[0]", "fix-glalie[0]"]);
    expect(adjectived.sort()).toEqual(["sv01-095[0]", "sv03-086[0]", "sv06.5-025[0]"]);
  });
});
