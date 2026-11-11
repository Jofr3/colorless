import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
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
  BENCH_COUNTER_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  findEvent,
} from "./testFixtures";

const RAGING_CRASH =
  "This attack does 10 damage for each damage counter on all of your Benched Pokémon.";
const BALLOON_BLAST = "This attack does 30 damage for each damage counter on this Pokémon.";
/** The self-side ADDITIVE twin, already read (Paldean Tauros sv02-028). */
const RAGING_HORNS = "This attack does 10 more damage for each damage counter on this Pokémon.";
const BURNING_VOICE = "This attack does 10 less damage for each damage counter on this Pokémon.";
const SECOND_BITE =
  "This attack does 10 more damage for each damage counter on your opponent's Active Pokémon.";
/** Tyranitar's OWN index-1 sentence — a self-SPREAD naming the very same zone on
    the very same card, and UNSIMULATED. Krookodile sv01-117 prints it at 30, so
    the gap is a family absence rather than a one-card omission. */
const EARTHQUAKE =
  "This attack also does 20 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The near-miss that names the OTHER seat's Bench and counts BODIES rather than
    counters — printed four times in the catalog (Oinkologne ex sv01-158/-234
    "Maddening Scent", Tyranitar sv02-135/-222 "Rout"), and unread. */
const ROUT = "This attack does 30 more damage for each of your opponent's Benched Pokémon.";
const UNPRINTED_MORE =
  "This attack does 10 more damage for each damage counter on all of your Benched Pokémon.";
const UNPRINTED_LESS =
  "This attack does 10 less damage for each damage counter on all of your Benched Pokémon.";

const SEED = 5;

const ATTACKS = {
  crash: { index: 0, energy: [{ id: "fix-energy", count: 2 }] }, // "Raging Crash" ({C}{C}, "10×")
  earthquake: {
    index: 1,
    energy: [
      { id: "fix-darkness-energy", count: 2 },
      { id: "fix-energy", count: 2 },
    ],
  }, // "Earthquake" ({D}{D}{C}{C}, 180) — the UNSIMULATED sibling
} as const;

type Which = keyof typeof ATTACKS;

function board(defender: string, which: Which = "crash", by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: BENCH_COUNTER_DECK, p2: BENCH_COUNTER_DECK }, { first: opener }),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, "swsh10.5-043");
  state = clearBench(state, by);
  for (const { id, count } of ATTACKS[which].energy) {
    state = attachFromDeck(state, by, id, count);
  }
  state = setActiveFromDeck(state, opener, defender);
  return clearBench(state, opener);
}

/** …with one `fix-titan` per entry on the ATTACKER's Bench, carrying that many
    damage counters. `[2, 0, 5]` is three benched bodies at 20 / 0 / 50 damage. */
function withBench(state: GameState, counters: number[], by: Seat = "p1"): GameState {
  let next = state;
  for (const [index, count] of counters.entries()) {
    next = benchFromDeck(next, by, "fix-titan");
    next = setBenchDamage(next, by, index, count * 10);
  }
  return next;
}

/** The whole board in one call: Tyranitar Active, `counters` on the Bench behind
    it, `defender` across the table. */
function benched(
  defender: string,
  counters: number[],
  which: Which = "crash",
  by: Seat = "p1",
): GameState {
  return withBench(board(defender, which, by), counters, by);
}

function swing(state: GameState, which: Which = "crash", seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKS[which].index });
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

describe("the printed data — one fresh fixture, whole", () => {
  it("carries Tyranitar swsh10.5-043's WHOLE printed card", () => {
    expect(FIXTURE_POOL["swsh10.5-043"]).toMatchObject({
      name: "Tyranitar",
      category: "Pokemon",
      stage: "Stage2",
      evolveFrom: "Pupitar",
      hp: 180,
      types: ["Darkness"],
      retreat: 3,
      weaknesses: [{ type: "Grass", value: "×2" }],
    });
    expect(FIXTURE_POOL["swsh10.5-043"]?.attacks).toEqual([
      {
        cost: ["Colorless", "Colorless"],
        name: "Raging Crash",
        effect: RAGING_CRASH,
        damage: "10×",
      },
      {
        cost: ["Darkness", "Darkness", "Colorless", "Colorless"],
        name: "Earthquake",
        effect: EARTHQUAKE,
        damage: 180,
      },
    ]);
    expect(FIXTURE_POOL["swsh10.5-043"]?.abilities ?? null).toBeNull();
    expect(FIXTURE_POOL["swsh10.5-043"]?.resistances ?? null).toBeNull();
  });

  it("AUTHORS nothing — the printing is read off the TEXT", () => {
    expect(programFor("swsh10.5-043")).toBeUndefined();
  });

  it("D425 — index 1 was DECLARED-UNSIMULATED and is SIMULATED now, on the OWN side", () => {
    expect(deriveAttackEffect(EARTHQUAKE)).toEqual([
      { op: "spreadDamage", target: "yourBench", amount: 20 },
    ]);
    expect(deriveAttackDamageBonus(EARTHQUAKE)).toBeNull();
    expect(deriveAttackDamageMultiplier(EARTHQUAKE)).toBeNull();
    expect(deriveAttackDamagePenalty(EARTHQUAKE)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The reader.
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveAttackDamageMultiplier — a sixth count member on the SAME `×` fold", () => {
  it("reads the printed sentence as damageCountersOnYourBench", () => {
    expect(deriveAttackDamageMultiplier(RAGING_CRASH)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnYourBench" },
    });
  });

  it("captures the amount rather than hard-coding the one printed 10", () => {
    expect(deriveAttackDamageMultiplier(RAGING_CRASH.replace(" 10 ", " 40 "))).toEqual({
      per: 40,
      count: { kind: "damageCountersOnYourBench" },
    });
  });

  it("KEEPS its three older count sources — no arm was stranded", () => {
    expect(deriveAttackDamageMultiplier(BALLOON_BLAST)).toEqual({
      per: 30,
      count: { kind: "damageCountersOnSelf" },
    });
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

  it("IS DISJOINT FROM EVERY OTHER `damage counter` PATTERN, IN BOTH DIRECTIONS", () => {
    expect(deriveAttackDamageBonus(RAGING_CRASH)).toBeNull();
    expect(deriveAttackDamagePenalty(RAGING_CRASH)).toBeNull();
    expect(deriveAttackEffect(RAGING_CRASH)).toBeNull();
    // …and their sentences must not reach this member.
    expect(deriveAttackDamageMultiplier(RAGING_HORNS)).toBeNull();
    expect(deriveAttackDamageMultiplier(BURNING_VOICE)).toBeNull();
    expect(deriveAttackDamageMultiplier(SECOND_BITE)).toBeNull();
    // …and the readers that DO own those sentences still answer them, with the
    // members they always did — the half a shared-tail regex would break invisibly.
    expect(deriveAttackDamageBonus(RAGING_HORNS)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnSelf" },
    });
    expect(deriveAttackDamageBonus(SECOND_BITE)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnOpponentActive" },
    });
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

  it("refuses a printed 0, and every near-miss the anchors exist for", () => {
    // The zero guard every arm in this family carries: a 0 does nothing, so it must
    // stay LOUD rather than claim a simulated sentence that scores nothing.
    expect(deriveAttackDamageMultiplier(RAGING_CRASH.replace(" 10 ", " 0 "))).toBeNull();
    for (const near of [
      // a lowercased first word
      RAGING_CRASH.replace("This", "this"),
      // no trailing period
      RAGING_CRASH.slice(0, -1),
      // leading text
      `Flip a coin. ${RAGING_CRASH}`,
      // trailing text
      `${RAGING_CRASH} Discard an Energy from this Pokémon.`,
      // a lookalike é would fall off the path silently
      RAGING_CRASH.replace("Pokémon", "Pokemon"),
      // the OTHER seat's Bench — printed four times (Oinkologne ex, Tyranitar
      // sv02-135/-222) and counting BODIES rather than counters
      ROUT,
      // this card's OWN index-1 spread, which names the identical zone
      EARTHQUAKE,
      // "all of" dropped: a real re-ingest could not produce it, but a hand-edited
      // fixture could, and the anchor is what refuses it
      RAGING_CRASH.replace("on all of your", "on your"),
    ]) {
      expect(deriveAttackDamageMultiplier(near)).toBeNull();
    }
  });

  it("the `more` and `less` spellings of THIS source are ABSENCES, not unread printings", () => {
    for (const text of [UNPRINTED_MORE, UNPRINTED_LESS]) {
      expect(deriveAttackDamageBonus(text)).toBeNull();
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
      expect(deriveAttackDamagePenalty(text)).toBeNull();
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });
});

describe("the census — discovered from the population, not enumerated", () => {
  it("is exactly ONE fixture attack, and it is the family", () => {
    const found: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const scaling = deriveAttackDamageMultiplier(attack.effect ?? "");
        if (scaling?.count.kind === "damageCountersOnYourBench") {
          found.push(`${id}[${index}] ${attack.name}`);
        }
      }
    }
    expect(found).toEqual(["swsh10.5-043[0] Raging Crash", "fix-benchnoun[0] Static Tally"]);
    expect(
      legalAttackCorpus().filter(
        ([, text]) =>
          text ===
          "This attack does 10 damage for each damage counter on all of your Benched Pokémon.",
      ),
    ).toEqual([]);
  });

  it("…and the SELF-side multiply producers are asserted beside them, unmoved", () => {
    const found: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const scaling = deriveAttackDamageMultiplier(attack.effect ?? "");
        if (scaling?.count.kind === "damageCountersOnSelf") found.push(`${id}[${index}]`);
      }
    }
    expect(found.sort()).toEqual(["sv01-089[1]", "swsh10.5-036[1]"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The fold — MULTIPLY, so the printed base is DROPPED.
// ─────────────────────────────────────────────────────────────────────────────

describe("the fold — `per × (counters on YOUR Bench)` is the WHOLE damage", () => {
  it("scores 10 per counter, summed over the WHOLE Bench", () => {
    // 20 / 0 / 50 on three benched bodies is 2 + 0 + 5 = 7 counters → 70. The
    // unequal slots are the point: `bench[0]` alone reads 20, `bench.length × per`
    // reads 30, and only the sum reads 70.
    const { events } = swing(benched("fix-titan", [2, 0, 5]));
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 70, dealt: 70 });
  });

  it("DROPS THE PRINTED `10×` BASE — the marker is the per-unit, not a floor", () => {
    // The whole difference between this fold and the additive one. A base that
    // leaked would make every number here 10 too high, and would make the ZERO
    // board below deal 10 instead of nothing at all.
    const row = findEvent(swing(benched("fix-titan", [3])).events, "DAMAGE_DEALT");
    expect(row?.base).toBe(0);
    expect(row?.dealt).toBe(30);
    // …and the printed card really does carry a base the fold had to drop.
    expect(FIXTURE_POOL["swsh10.5-043"]?.attacks?.[0]?.damage).toBe("10×");
  });

  it("scales LINEARLY, and the oracle is re-derived from the row's own fields", () => {
    for (const counters of [1, 2, 4, 9]) {
      const row = findEvent(swing(benched("fix-titan", [counters])).events, "DAMAGE_DEALT");
      if (row === undefined) throw new Error("no damage row");
      expect(row.scaled ?? 0, `${counters} counters`).toBe(10 * counters);
      expect(row.dealt, `${counters} counters`).toBe(row.base + (row.scaled ?? 0));
    }
  });

  it("sums a FULL five-slot Bench, and the total can Knock the defender Out", () => {
    // Five bodies at ten counters each is 50 counters → 500, past fix-titan's 340.
    // The `×` fold has no printed ceiling, which is the reason this deck's defender
    // is the largest body in the pool.
    const { state, events } = swing(benched("fix-titan", [10, 10, 10, 10, 10]));
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 500, dealt: 500 });
    expect(findEvent(events, "KNOCKED_OUT")).toBeDefined();
    expect(state.players.p2.active).toBeNull();
  });

  it("floors each body's counters BEFORE summing", () => {
    let state = board("fix-titan");
    state = benchFromDeck(state, "p1", "fix-titan");
    state = setBenchDamage(state, "p1", 0, 25);
    state = benchFromDeck(state, "p1", "fix-titan");
    state = setBenchDamage(state, "p1", 1, 25);
    expect(findEvent(swing(state).events, "DAMAGE_DEALT")).toMatchObject({ scaled: 40, dealt: 40 });
  });

  it("runs identically from the OTHER seat", () => {
    // Nothing in the arm is p1-shaped, and a hard-coded seat would look right on
    // exactly one of these two.
    const { events } = swing(benched("fix-titan", [2, 0, 5], "crash", "p2"), "crash", "p2");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 70, dealt: 70 });
  });

  it("leaves index 1 ALONE — the sibling attack does not inherit the clause", () => {
    // "Earthquake" is a flat printed 180 whose own text the engine does not read. A
    // fold keyed on the CARD rather than on the declared attack's text would add 70
    // to it, or would drop its base to 0.
    const row = findEvent(
      swing(benched("fix-titan", [2, 0, 5], "earthquake"), "earthquake").events,
      "DAMAGE_DEALT",
    );
    expect(row).toMatchObject({ base: 180, dealt: 180 });
    expect(row?.scaled).toBeUndefined();
  });

  it("D425 — …and index 1 now does its OWN thing, which is the other half of the same claim", () => {
    const { events } = swing(benched("fix-titan", [2, 0, 5], "earthquake"), "earthquake");
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    const rows = events.filter((e) => e.type === "DAMAGE_DEALT");
    // The main hit on the DEFENDER's Active, flat and unscaled…
    expect(rows[0]).toMatchObject({ seat: "p2", base: 180, dealt: 180 });
    expect((rows[0] as { scaled?: number }).scaled).toBeUndefined();
    expect(rows.slice(1).map((r) => [r.seat, (r as { dealt: number }).dealt])).toEqual([
      ["p1", 20],
      ["p1", 20],
      ["p1", 20],
    ]);
  });
});

describe("THE ZONE — YOUR Bench, and nothing else on either board", () => {
  it("a PRISTINE Bench scores 0, and no DAMAGE_DEALT is emitted at all", () => {
    const { state, events } = swing(benched("fix-titan", [0, 0, 0]));
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(state.players.p2.active?.damage).toBe(0);
    expect(findEvent(events, "KNOCKED_OUT")).toBeUndefined();
    // …and the attack was still USED, so the turn passed to the opponent. This is
    // the half an early `return` would break, and the half a player would notice.
    expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });

  it("an EMPTY Bench scores 0 too — the same 0, for a different reason", () => {
    const state = board("fix-titan");
    expect(state.players.p1.bench).toHaveLength(0);
    const { state: after, events } = swing(state);
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });

  it("COUNTERS ON THE ATTACKER'S OWN ACTIVE DO NOT COUNT", () => {
    // The nearest wrong member: `damageCountersOnSelf` reads the attacking Active
    // and this one must not. Tyranitar carries 90 damage — 9 counters, which would
    // score 90 — and its Bench is pristine.
    const state = setDamage(benched("fix-titan", [0, 0]), "p1", 90);
    const { events } = swing(state);
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
  });

  it("COUNTERS ON THE OPPONENT'S ACTIVE DO NOT COUNT EITHER", () => {
    const state = setDamage(benched("fix-titan", [0, 0]), "p2", 70);
    const { events } = swing(state);
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
  });

  it("COUNTERS ON THE OPPONENT'S BENCH DO NOT COUNT — the SEAT is load-bearing", () => {
    let state = benched("fix-titan", []);
    state = withBench(state, [4, 4], "p2");
    expect(findEvent(swing(state).events, "DAMAGE_DEALT")).toBeUndefined();
  });

  it("THE SEPARATING BOARD — all four zones damaged, all four differently", () => {
    let state = benched("fix-titan", [1, 2]);
    state = setDamage(state, "p1", 90);
    state = setDamage(state, "p2", 50);
    state = withBench(state, [3, 4], "p2");
    const row = findEvent(swing(state).events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 0, scaled: 30 });
    expect(row?.dealt).toBe(30);
  });

  it("…and the SAME board read from p2 gives the SAME 30, with the zones swapped", () => {
    // The mirror of the case above. If the arm read `defenderSeat`, one of these two
    // would score 70 and the other 30, and each on its own would look right.
    let state = benched("fix-titan", [1, 2], "crash", "p2");
    state = setDamage(state, "p2", 90);
    state = setDamage(state, "p1", 50);
    state = withBench(state, [3, 4], "p1");
    expect(findEvent(swing(state, "crash", "p2").events, "DAMAGE_DEALT")).toMatchObject({
      base: 0,
      scaled: 30,
      dealt: 30,
    });
  });

  it("READS THE COUNT AT DECLARATION — this attack cannot bootstrap its own bonus", () => {
    const first = swing(benched("fix-titan", [2, 0, 5]));
    expect(findEvent(first.events, "DAMAGE_DEALT")?.dealt).toBe(70);
    expect(first.state.players.p1.bench.map((p) => p.damage)).toEqual([20, 0, 50]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The ORDER, and the honest limit of what this family can witness.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8.5 — the fold happens BEFORE Weakness, and the dropped base is visible THROUGH it", () => {
  it("doubles the folded total, not the printed base", () => {
    const { state, events } = swing(benched("fix-darkness-weak", [3, 3]));
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 0, scaled: 60, dealt: 120 });
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(state.players.p2.active?.damage).toBe(120);
  });

  it("AND THE ×2 CANNOT WITNESS AN ORDER HERE, WHICH IS SAID RATHER THAN FUDGED", () => {
    const scaled = 60;
    expect((0 + scaled) * 2).toBe(0 * 2 + scaled * 2);
    expect((100 + scaled) * 2).not.toBe(100 * 2 + scaled);
  });

  it("a ZERO Bench against the ×2 body still deals nothing at all", () => {
    // The Weakness has nothing to double. A base that leaked would deal 20 here,
    // which is the loudest form the same defect can take.
    const { events } = swing(benched("fix-darkness-weak", [0, 0]));
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE.
// ─────────────────────────────────────────────────────────────────────────────

describe("VOICE — the existing `scaled` crumb off a `base 0`, under BOTH seats", () => {
  it("reads `· scaled +70` under the ATTACKER's name", () => {
    const { state, events } = swing(benched("fix-titan", [2, 0, 5]));
    const row = rendered(state, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p1");
    expect(row?.text).toBe("dealt 70 damage to fix-titan · scaled +70");
  });

  it("renders the SAME sequence when the attacking seat is p2", () => {
    const { state, events } = swing(benched("fix-titan", [2, 0, 5], "crash", "p2"), "crash", "p2");
    const row = rendered(state, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p2");
    expect(row?.text).toBe("dealt 70 damage to fix-titan · scaled +70");
  });

  it("says nothing about damage at all when the Bench is pristine", () => {
    const { state, events } = swing(benched("fix-titan", [0, 0]));
    expect(rendered(state, events).find((r) => r.text.startsWith("dealt "))).toBeUndefined();
  });

  it("AND THE PRINTED TEXT STOPS BEING FLAGGED — on the scoring board AND the 0 one", () => {
    for (const counters of [[2, 0, 5], [0, 0], []]) {
      const { events } = swing(benched("fix-titan", counters));
      expect(findEvent(events, "ATTACK_EFFECT_SKIPPED"), `${counters}`).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The structural answers.
// ─────────────────────────────────────────────────────────────────────────────

describe("the structural answers", () => {
  it("PERSIST: NOTHING was written to `InPlayPokemon`, so MATCH_RECORD_VERSION stays 11", () => {
    const active = board("fix-titan").players.p1.active;
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
    const bench = withBench(board("fix-titan"), [3]).players.p1.bench[0];
    if (bench === undefined) throw new Error("no benched body");
    expect(Object.keys(bench).sort()).toEqual(Object.keys(active).sort());
  });

  it("GATES NO ACTION — the attack is still offered on a board where it deals 0", () => {
    const state = board("fix-titan");
    const view = redactGame(state, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    expect(view.attacks[0]).toMatchObject({ index: 0, name: "Raging Crash", playable: true });
    expect(applyAction(state, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
  });
});
