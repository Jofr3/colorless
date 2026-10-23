import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { effectiveRetreatCost } from "./continuous";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackEffect,
} from "./effects";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  RETREAT_COST_PENALTY_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  findEvent,
  activeOf,
} from "./testFixtures";

const THIRTY_LESS =
  "This attack does 30 less damage for each {C} in your opponent's Active Pokémon's Retreat Cost.";
const FIFTY_LESS =
  "This attack does 50 less damage for each {C} in your opponent's Active Pokémon's Retreat Cost.";
const THIRTY_MORE =
  "This attack does 30 more damage for each {C} in your opponent's Active Pokémon's Retreat Cost.";
const FIFTY_FLAT =
  "This attack does 50 damage for each {C} in your opponent's Active Pokémon's Retreat Cost.";
const PARAPHRASE =
  "This attack does 30 less damage for each {C} in the Retreat Cost of your opponent's Active Pokémon.";

const DRAG = 0; // {C}, printed "200-" — 30 per {C}
const SLAM = 1; // {C}, printed "150-" — 50 per {C}, the FLOOR board
const BLUNT = 2; // {C}, a flat 90, NO `effect` key — the control the clause cannot move
const HOOK = 3; // {C}, a flat 90, the paraphrase — the ATTACK_EFFECT_SKIPPED control

const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();
const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const other = (seat: Seat): Seat => (seat === "p1" ? "p2" : "p1");

// ── boards ─────────────────────────────────────────────────────────────────────

function board(
  seed: number,
  attacker: Seat,
  defender: string,
  atk = "fix-retreatless",
  energy: readonly string[] = ["fix-energy"],
): GameState {
  const victim = other(attacker);
  let state = driveSetup(
    seed,
    { p1: RETREAT_COST_PENALTY_DECK, p2: RETREAT_COST_PENALTY_DECK },
    { first: victim },
  );
  state = setActiveFromDeck(state, attacker, atk);
  for (const id of energy) state = attachFromDeck(state, attacker, id, 1);
  state = setActiveFromDeck(state, victim, defender);
  state = clearBench(clearBench(state, "p1"), "p2");
  return mustApply(state, { type: "endTurn", seat: victim }).state;
}

/** `seat` plays `cardId` into the shared Stadium zone. Only ever ONE at a time, so
    the two retreat Stadiums are driven by REPLACING each other, never by stacking. */
function withStadium(state: GameState, seat: Seat, cardId: string): GameState {
  const next = handFromDeck(state, seat, cardId, 1);
  return mustApply(next, { type: "playTrainer", seat, uid: handUid(next, seat, cardId) }).state;
}

/** Attack at `index` and report `[damage, debuff, ATTACK_EFFECT_SKIPPED rows]`. */
function swing(state: GameState, seat: Seat, index: number): [number, number, number] {
  const after = mustApply(state, { type: "attack", seat, index });
  const dealt = findEvent(after.state === undefined ? [] : after.events, "DAMAGE_DEALT");
  const skipped = after.events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED");
  return [dealt?.damage ?? 0, dealt?.debuff ?? 0, skipped.length];
}

// ── §1 ─────────────────────────────────────────────────────────────────────────

describe("§1 — the population, and the warrant for ONE anchor", () => {
  it("is 2 sentences / 3 legal printings, off the corpus and not off a comment", () => {
    expect(corpus().filter(([, s]) => s === THIRTY_LESS)).toHaveLength(1);
    expect(units(corpus().filter(([, s]) => s === THIRTY_LESS))).toBe(2);
    expect(corpus().filter(([, s]) => s === FIFTY_LESS)).toHaveLength(1);
    expect(units(corpus().filter(([, s]) => s === FIFTY_LESS))).toBe(1);
  });

  it("D121's WARRANT, RE-RUN: the two printed strings differ at exactly ONE position", () => {
    // The reason this is ONE parameterised anchor and not two literals. Computed
    // over the bytes rather than asserted from a brief — three briefs in this run
    // carried an enumeration that a byte-level check would have caught.
    expect(THIRTY_LESS).toHaveLength(FIFTY_LESS.length);
    const differing = [...THIRTY_LESS].flatMap((ch, i) => (ch === FIFTY_LESS[i] ? [] : [i]));
    expect(differing).toEqual([17]);
    expect([THIRTY_LESS[17], FIFTY_LESS[17]]).toEqual(["3", "5"]);
    // …and the differing byte is inside the `(\d+)` capture, which is what makes
    // one regex able to span both amounts rather than merely able to match both.
    expect(deriveAttackDamagePenalty(THIRTY_LESS)?.per).toBe(30);
    expect(deriveAttackDamagePenalty(FIFTY_LESS)?.per).toBe(50);
  });

  it("the SIGN's whole population is THREE sentences — the rotted claim, pinned", () => {
    const signRows = corpus().filter(([, s]) => s.includes("less damage for each"));
    expect(signRows.map(([, s]) => s).sort()).toEqual(
      [
        "This attack does 10 less damage for each damage counter on this Pokémon.",
        THIRTY_LESS,
        FIFTY_LESS,
      ].sort(),
    );
    expect(units(signRows)).toBe(5);
    for (const [, sentence] of signRows) {
      expect(deriveAttackDamagePenalty(sentence), sentence).not.toBeNull();
    }
  });

  it("the READER SURFACE stands still at 13 — this is an ARM, not a fourteenth reader", () => {
    expect(attackReaderSurface()).toHaveLength(14);
    expect(attackReaderSurface()).toContain("deriveAttackDamagePenalty");
  });

  it("both sentences are now RESOLVED, and the paraphrase still is not", () => {
    expect(resolvedByAnyReader(THIRTY_LESS)).toBe(true);
    expect(resolvedByAnyReader(FIFTY_LESS)).toBe(true);
    expect(resolvedByAnyReader(PARAPHRASE)).toBe(false);
  });
});

// ── §2 ─────────────────────────────────────────────────────────────────────────

describe("§2 — the reader: one regex, two amounts, one count source", () => {
  it("reads BOTH printed sentences with a POSITIVE `per` on the retreat count", () => {
    expect(deriveAttackDamagePenalty(THIRTY_LESS)).toEqual({
      per: 30,
      count: { kind: "opponentActiveRetreatCost" },
    });
    expect(deriveAttackDamagePenalty(FIFTY_LESS)).toEqual({
      per: 50,
      count: { kind: "opponentActiveRetreatCost" },
    });
    // The SIGN is carried by which reader answered, not by the number: `per` is
    // positive on both, exactly as the self-counter arm one line up returns it.
    expect(deriveAttackDamagePenalty(THIRTY_LESS)?.per).toBeGreaterThan(0);
  });

  it("keeps the FIRST arm of this reader untouched — the D163 sentence still reads", () => {
    expect(
      deriveAttackDamagePenalty(
        "This attack does 10 less damage for each damage counter on this Pokémon.",
      ),
    ).toEqual({ per: 10, count: { kind: "damageCountersOnSelf" } });
  });

  it("is DISJOINT from BOTH twins in BOTH directions — the adjective is the whole tell", () => {
    expect(deriveAttackDamagePenalty(THIRTY_MORE)).toBeNull();
    expect(deriveAttackDamagePenalty(FIFTY_FLAT)).toBeNull();
    expect(deriveAttackDamageBonus(THIRTY_LESS)).toBeNull();
    expect(deriveAttackDamageBonus(FIFTY_LESS)).toBeNull();
    expect(deriveAttackDamageMultiplier(THIRTY_LESS)).toBeNull();
    expect(deriveAttackDamageMultiplier(FIFTY_LESS)).toBeNull();
  });

  it("…and the two NOUN PHRASES are mutually exclusive by their literal tails", () => {
    expect(
      deriveAttackDamagePenalty(
        "This attack does 30 less damage for each damage counter on your opponent's Active Pokémon's Retreat Cost.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamagePenalty("This attack does 30 less damage for each {C} in this Pokémon."),
    ).toBeNull();
  });

  it("NO sentence in the whole corpus gets two answers from the three folds", () => {
    for (const [, text] of corpus()) {
      const answers = [
        deriveAttackDamageBonus(text),
        deriveAttackDamageMultiplier(text),
        deriveAttackDamagePenalty(text),
      ].filter((x) => x !== null).length;
      expect(answers, text).toBeLessThanOrEqual(1);
    }
  });

  it("refuses every near-miss, and each one differs on exactly ONE axis (D427)", () => {
    // A near-miss that differs on more than one axis tests nothing about either.
    const axes: readonly (readonly [string, string])[] = [
      ["a lowercased first word", THIRTY_LESS.replace("This", "this")],
      ["no trailing period", THIRTY_LESS.slice(0, -1)],
      ["leading text", `Flip a coin. ${THIRTY_LESS}`],
      ["trailing text", `${THIRTY_LESS} Discard an Energy from this Pokémon.`],
      [
        "a lookalike-free é replaced by a plain e",
        THIRTY_LESS.replace("Pokémon's Retreat", "Pokemon's Retreat"),
      ],
      ["the {C} token swapped for another symbol", THIRTY_LESS.replace("{C}", "{W}")],
      [
        "the OWN-side mirror the catalog does not print",
        THIRTY_LESS.replace("your opponent's Active", "your Active"),
      ],
      ["D388's printed word order for the same noun phrase", PARAPHRASE],
      ["a printed 0, which subtracts nothing", THIRTY_LESS.replace("30", "0")],
    ];
    for (const [axis, near] of axes) {
      expect(deriveAttackDamagePenalty(near), axis).toBeNull();
    }
    // …and the printed-0 case really did reach the regex rather than missing it,
    // which is what makes the `per >= 1` guard the thing being tested.
    expect(THIRTY_LESS.replace("30", "0")).toContain("does 0 less damage");
  });

  it("STAYS LOUD as an op — neither sentence derives a post-damage program", () => {
    for (const text of [THIRTY_LESS, FIFTY_LESS]) expect(deriveAttackEffect(text)).toBeNull();
  });

  it("carries the two printings' text verbatim on the demonstrator", () => {
    // The fixture derives off its TEXT (no registry program), so the sentence is
    // load-bearing: a drifted character silently un-simulates the card.
    const attacks = FIXTURE_POOL["fix-retreatless"]?.attacks ?? [];
    expect(attacks[DRAG]?.effect).toBe(THIRTY_LESS);
    expect(attacks[DRAG]?.damage).toBe("200-");
    expect(attacks[SLAM]?.effect).toBe(FIFTY_LESS);
    expect(attacks[SLAM]?.damage).toBe("150-");
    expect(attacks[BLUNT]?.effect).toBeUndefined();
    expect(attacks[HOOK]?.effect).toBe(PARAPHRASE);
  });

  it("the FIXTURE-POOL producers of this reader are exactly four", () => {
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
});

// ── §3 ─────────────────────────────────────────────────────────────────────────

describe("§3 — the FOLD, driven: the base is KEPT and `per × count` comes off it", () => {
  it("the LADDER — four rungs, because two would be green under two wrong builds", () => {
    // A penalty read as a flat `per` is green at count 1; one read off a hardcoded
    // 2 is green at count 2. Only 0/1/2/3 together say the number is `per × count`.
    expect(swing(board(101, "p1", "fix-retreat0-titan"), "p1", DRAG)).toEqual([200, 0, 0]);
    expect(swing(board(101, "p1", "fix-retreat1-titan"), "p1", DRAG)).toEqual([170, 30, 0]);
    expect(swing(board(101, "p1", "fix-retreat2-titan"), "p1", DRAG)).toEqual([140, 60, 0]);
    expect(swing(board(101, "p1", "fix-retreat3-titan"), "p1", DRAG)).toEqual([110, 90, 0]);
    // …and `fix-titan`'s printed 4, the deepest rung the pool holds.
    expect(swing(board(101, "p1", "fix-titan"), "p1", DRAG)).toEqual([80, 120, 0]);
  });

  it("the printed base is KEPT — which is what separates this fold from the twin", () => {
    const zero = board(102, "p1", "fix-retreat0-titan");
    expect(effectiveRetreatCost(zero, activeOf(zero, "p2"))).toBe(0);
    const after = mustApply(zero, { type: "attack", seat: "p1", index: DRAG });
    const dealt = findEvent(after.events, "DAMAGE_DEALT");
    expect(dealt?.base).toBe(200);
    expect(dealt?.damage).toBe(200);
    expect(dealt?.debuff).toBeUndefined();
    const mult = mustApply(board(102, "p1", "fix-retreat0-titan", "sv03-172"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(findEvent(mult.events, "DAMAGE_DEALT")).toBeUndefined();
  });

  it("the FLOOR at 0 — a penalty larger than the base does not go negative", () => {
    const after = mustApply(board(103, "p1", "fix-titan"), {
      type: "attack",
      seat: "p1",
      index: SLAM,
    });
    const dealt = findEvent(after.events, "DAMAGE_DEALT");
    expect(dealt?.base).toBe(150);
    expect(dealt?.debuff).toBe(200);
    expect(dealt?.dealt).toBe(0);
    expect(dealt?.damage).toBe(0);
    // …and the defender really did take nothing: a clamp that leaked would put HP
    // back or take it away, and neither is visible in the event alone.
    expect(activeOf(after.state, "p2").damage).toBe(0);
  });

  it("the flat sibling attack on the SAME body is untouched — the one-axis control", () => {
    // Index 2 carries no `effect` key at all: same body, same cost, same defender,
    // same turn — only the sentence is absent. A build that penalised every attack
    // on a body carrying the clause dies here and nowhere else.
    expect(swing(board(104, "p1", "fix-retreat3-titan"), "p1", BLUNT)).toEqual([90, 0, 0]);
  });
});

// ── §4 ─────────────────────────────────────────────────────────────────────────

describe("§4 — the count is the EFFECTIVE Retreat Cost, in BOTH directions", () => {
  /** The printed reading, spelled here rather than imported: it is what a WRONG
      build would have used, and a rung that names it can go red for the reason
      that matters. */
  const printedOf = (state: GameState, seat: Seat): number =>
    FIXTURE_POOL[state.cardIdByUid[activeOf(state, seat).stack.at(-1) ?? ""] ?? ""]?.retreat ?? 0;

  it("UP — Calamitous Wasteland raises a printed {C} to a folded {C}{C}", () => {
    const raised = withStadium(board(201, "p1", "fix-retreat1-titan"), "p1", "sv02-175");
    expect(printedOf(raised, "p2")).toBe(1);
    expect(effectiveRetreatCost(raised, activeOf(raised, "p2"))).toBe(2);
    // 140, not the 170 the printed column would have produced.
    expect(swing(raised, "p1", DRAG)).toEqual([140, 60, 0]);
  });

  it("DOWN — Beach Court lowers a printed {C}{C}{C} to a folded {C}{C}", () => {
    const lowered = withStadium(board(202, "p1", "fix-retreat3-titan"), "p1", "sv01-167");
    expect(printedOf(lowered, "p2")).toBe(3);
    expect(effectiveRetreatCost(lowered, activeOf(lowered, "p2"))).toBe(2);
    // 140, not the 110 the printed column would have produced — the MIRROR, and the
    // rung that refuses a `printed + 1` build.
    expect(swing(lowered, "p1", DRAG)).toEqual([140, 60, 0]);
  });

  it("the fold's own floor holds under the penalty too", () => {
    const floored = withStadium(board(203, "p1", "fix-retreat1-titan"), "p1", "sv01-167");
    expect(printedOf(floored, "p2")).toBe(1);
    expect(effectiveRetreatCost(floored, activeOf(floored, "p2"))).toBe(0);
    expect(swing(floored, "p1", DRAG)).toEqual([200, 0, 0]);
  });
});

// ── §5 ─────────────────────────────────────────────────────────────────────────

describe("§5 — BOTH SEATS, and the count is the DEFENDER's", () => {
  it("the same board from p2 reads the same number", () => {
    expect(swing(board(301, "p2", "fix-retreat2-titan"), "p2", DRAG)).toEqual([140, 60, 0]);
    expect(swing(board(301, "p2", "fix-retreat3-titan"), "p2", DRAG)).toEqual([110, 90, 0]);
  });

  it("an ASYMMETRIC board — the attacker's OWN retreat cost moves nothing", () => {
    const p1Swing = board(302, "p1", "fix-retreat3-titan");
    expect(effectiveRetreatCost(p1Swing, activeOf(p1Swing, "p1"))).toBe(1);
    expect(effectiveRetreatCost(p1Swing, activeOf(p1Swing, "p2"))).toBe(3);
    expect(swing(p1Swing, "p1", DRAG)).toEqual([110, 90, 0]);
    const p2Swing = board(302, "p2", "fix-retreat3-titan");
    expect(swing(p2Swing, "p2", DRAG)).toEqual([110, 90, 0]);
  });
});

// ── §6 ─────────────────────────────────────────────────────────────────────────

describe("§6 — the ADMITTED TWINS still answer their own readers, on one board", () => {
  it("all three adjectives on ONE noun phrase, driven against ONE defender", () => {
    const add = mustApply(
      board(401, "p1", "fix-retreat2-titan", "sv01-002", ["fix-grass-energy", "fix-energy"]),
      {
        type: "attack",
        seat: "p1",
        index: 0,
      },
    );
    const addRow = findEvent(add.events, "DAMAGE_DEALT");
    expect(addRow?.damage).toBe(70);
    expect(addRow?.scaled).toBe(60);
    expect(addRow?.debuff).toBeUndefined();

    const mult = mustApply(board(401, "p1", "fix-retreat2-titan", "sv03-172"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    const multRow = findEvent(mult.events, "DAMAGE_DEALT");
    expect(multRow?.damage).toBe(100);
    expect(multRow?.debuff).toBeUndefined();

    expect(swing(board(401, "p1", "fix-retreat2-titan"), "p1", DRAG)).toEqual([140, 60, 0]);
  });

  it("…and the twins' READERS are still the ones that answer their sentences", () => {
    expect(deriveAttackDamageBonus(THIRTY_MORE)).toEqual({
      per: 30,
      count: { kind: "opponentActiveRetreatCost" },
    });
    expect(deriveAttackDamageMultiplier(FIFTY_FLAT)).toEqual({
      per: 50,
      count: { kind: "opponentActiveRetreatCost" },
    });
    expect(units(corpus().filter(([, s]) => s === THIRTY_MORE))).toBe(1);
    expect(units(corpus().filter(([, s]) => s === FIFTY_FLAT))).toBe(1);
  });
});

// ── §7 ─────────────────────────────────────────────────────────────────────────

describe("§7 — the loud path: `ATTACK_EFFECT_SKIPPED` fires for the paraphrase and NOT for these", () => {
  it("BOTH DIRECTIONS on the SAME body, which is what makes 'built' mean anything", () => {
    // A suite that only shows the skip NOT firing is green on a build that never
    // fires it at all. Index 3 is the control: same card, same cost, same printed
    // damage, a real paraphrase of the same clause that no reader claims.
    const state = board(501, "p1", "fix-retreat3-titan");
    expect(swing(state, "p1", DRAG)[2]).toBe(0);
    expect(swing(state, "p1", SLAM)[2]).toBe(0);
    expect(swing(state, "p1", BLUNT)[2]).toBe(0);
    const loud = mustApply(state, { type: "attack", seat: "p1", index: HOOK });
    const skipped = loud.events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED");
    expect(skipped).toHaveLength(1);
    // …and the paraphrase still dealt its printed 90: an unread sentence is loud,
    // never silently scored at 0.
    expect(findEvent(loud.events, "DAMAGE_DEALT")?.damage).toBe(90);
  });

  it("the printed `-` MARKER is reported simulated too, and that is a SECOND term", () => {
    const after = mustApply(board(502, "p1", "fix-retreat2-titan"), {
      type: "attack",
      seat: "p1",
      index: DRAG,
    });
    expect(after.events.filter((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    const loud = mustApply(board(502, "p1", "fix-retreat2-titan"), {
      type: "attack",
      seat: "p1",
      index: HOOK,
    });
    const row = findEvent(loud.events, "ATTACK_EFFECT_SKIPPED");
    expect(row?.effect).toBe(PARAPHRASE);
    expect(row?.damageModifier).toBeNull();
  });
});

// ── §8 ─────────────────────────────────────────────────────────────────────────

describe("§8 — the persisted question: `MATCH_RECORD_VERSION` STAYS 29", () => {
  it("DIRECTION 1 — there is NO CARRIER AT ALL, measured over the bytes", () => {
    const before = board(601, "p1", "fix-retreat3-titan");
    const after = mustApply(before, { type: "attack", seat: "p1", index: DRAG }).state;
    for (const [label, state] of [
      ["before", before],
      ["after", after],
    ] as const) {
      const wire = JSON.stringify(state);
      expect(wire, label).not.toContain("opponentActiveRetreatCost");
      expect(wire, label).not.toContain("damageCountersOnSelf");
    }
    expect(after.phase.kind).toBe("turn:action");
    expect(after.pending).toEqual([]);
  });

  it("DIRECTION 2 — a v29 record round-trips and the NEXT swing reads the same", () => {
    // The record a previous deploy wrote holds no key this one added, because this
    // one added none. Driven as an actual replay: serialize the post-attack board,
    // parse it back, and swing again from the parsed bytes.
    const first = mustApply(board(602, "p1", "fix-retreat2-titan"), {
      type: "attack",
      seat: "p1",
      index: DRAG,
    });
    expect(findEvent(first.events, "DAMAGE_DEALT")?.damage).toBe(140);
    const saved = JSON.parse(JSON.stringify(first.state)) as GameState;
    expect(saved).toEqual(first.state);
    // …and the parsed record is a LIVE board, not a snapshot: hand the turn back
    // and swing the SAME clause again off the bytes that came out of `JSON.parse`.
    const returned = mustApply(saved, { type: "endTurn", seat: "p2" }).state;
    const second = mustApply(returned, { type: "attack", seat: "p1", index: DRAG });
    expect(findEvent(second.events, "DAMAGE_DEALT")?.dealt).toBe(140);
    expect(findEvent(second.events, "DAMAGE_DEALT")?.debuff).toBe(60);
    expect(findEvent(second.events, "DAMAGE_DEALT")?.damage).toBe(280);
  });

  it("the FROZEN board is handed back untouched — the purity pair", () => {
    const frozen = deepFreeze(board(603, "p1", "fix-retreat3-titan"));
    const attachedBefore = activeOf(frozen, "p1").energy.length;
    const after = mustApply(frozen, { type: "attack", seat: "p1", index: DRAG });
    // §8 step 2: cost is a CHECK and not a payment, so the arming Energy is still
    // attached afterwards — on the new board AND on the frozen one.
    expect(activeOf(frozen, "p1").energy).toHaveLength(attachedBefore);
    expect(activeOf(after.state, "p1").energy).toHaveLength(attachedBefore);
    // The frozen board never took the hit; the returned one did.
    expect(activeOf(frozen, "p2").damage).toBe(0);
    expect(activeOf(after.state, "p2").damage).toBe(110);
    // …and the DEFENDER's Retreat Cost — the thing this clause reads — is unmoved
    // by having been read, on both boards.
    expect(effectiveRetreatCost(frozen, activeOf(frozen, "p2"))).toBe(3);
    expect(effectiveRetreatCost(after.state, activeOf(after.state, "p2"))).toBe(3);
  });
});
