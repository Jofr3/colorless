import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackCopy,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
  splitAttackGateClause,
} from "./effects";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, programFor, redactGame, topUid } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  setActiveFromDeck,
  typedEnergy,
  must,
  findEvent,
  driveSetup,
} from "./testFixtures";

// ── the printed sentences, byte-for-byte off the D1 ─────────────────────────

const TERAPAGOS_TEXT =
  "If you go second, you can't use this attack during your first turn. This attack does 30 damage for each of your Benched Pokémon.";
const TERAPAGOS_BODY = "This attack does 30 damage for each of your Benched Pokémon.";
const VOLBEAT_TEXT =
  "If you go first, you can use this attack during your first turn. Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.";
const VOLBEAT_BODY =
  "Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.";
const ILLUMISE_TEXT =
  "You can use this attack only if you go second, and only during your first turn. Shuffle 1 of your opponent's Benched Pokémon and all attached cards into their deck.";
const ILLUMISE_BODY =
  "Shuffle 1 of your opponent's Benched Pokémon and all attached cards into their deck.";
const DIPPLIN_TEXT = "This attack does 20 damage for each of your Benched Pokémon.";
const TAPU_KOKO_TEXT = "This attack does 20 more damage for each of your Benched Pokémon.";
const NARROWED_NOUN =
  "This attack does 40 more damage for each of your Benched Pokémon that has any {G} Energy attached.";

const TERAPAGOS_IDS = [
  "sv07-128",
  "sv07-170",
  "sv07-173",
  "sv08.5-092",
  "sv08.5-169",
  "sv08.5-180",
  "svp-165",
] as const;

const UNGATED_TWIN = "fix-d282-ungated-twin";
const NEAR_MISS_TWIN = "fix-d444-near-miss-twin";
const NEAR_MISS_TEXT =
  "If you go second, you can't use this attack during your next turn. This attack does 30 damage for each of your Benched Pokémon.";
/** A plain benchable body, and the Basic the deck search may fetch. */
const FILLER = "fix-d282-filler";
const ENERGY = "fix-d282-energy";

function terapagos(id: string): Card {
  return battler(id, {
    name: "Terapagos ex",
    hp: 230,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Unified Beatdown",
        damage: "30×",
        effect: TERAPAGOS_TEXT,
      },
      { cost: ["Colorless", "Colorless"], name: "Crown Opal", damage: 180 },
    ],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(TERAPAGOS_IDS.map((id) => [id, terapagos(id)])),
  "sv06-009": battler("sv06-009", {
    name: "Volbeat",
    hp: 70,
    retreat: 1,
    types: ["Grass"],
    attacks: [
      { cost: ["Colorless"], name: "Quick Sign", effect: VOLBEAT_TEXT },
      { cost: ["Colorless", "Colorless"], name: "Coordinated Strike", damage: "20+" },
    ],
  }),
  "sv06-010": battler("sv06-010", {
    name: "Illumise",
    hp: 70,
    retreat: 1,
    types: ["Grass"],
    attacks: [{ cost: ["Colorless"], name: "Slowing Perfume", effect: ILLUMISE_TEXT }],
  }),
  "sv06-018": battler("sv06-018", {
    name: "Dipplin",
    hp: 80,
    retreat: 2,
    types: ["Grass"],
    attacks: [{ cost: ["Colorless"], name: "Do the Wave", damage: "20×", effect: DIPPLIN_TEXT }],
  }),
  "sv09-051": battler("sv09-051", {
    name: "Tapu Koko ex",
    hp: 200,
    retreat: 0,
    types: ["Lightning"],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Linked Lightning",
        damage: "60+",
        effect: TAPU_KOKO_TEXT,
      },
    ],
  }),
  [UNGATED_TWIN]: battler(UNGATED_TWIN, {
    name: "Ungated Twin",
    hp: 230,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Unified Beatdown",
        damage: "30×",
        effect: TERAPAGOS_TEXT,
      },
    ],
  }),
  [NEAR_MISS_TWIN]: battler(NEAR_MISS_TWIN, {
    name: "Near-Miss Twin",
    hp: 230,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Unified Beatdown",
        damage: "30×",
        effect: NEAR_MISS_TEXT,
      },
    ],
  }),
  [FILLER]: battler(FILLER, {
    name: "D282 Filler",
    hp: 60,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [ENERGY]: typedEnergy(ENERGY, "Colorless"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "sv07-128": 4,
  "sv07-170": 1,
  "sv07-173": 1,
  "sv08.5-092": 1,
  "sv08.5-169": 1,
  "sv08.5-180": 1,
  "svp-165": 1,
  "sv06-009": 4,
  "sv06-010": 2,
  "sv06-018": 4,
  "sv09-051": 4,
  [UNGATED_TWIN]: 4,
  [NEAR_MISS_TWIN]: 4,
  [FILLER]: 8,
  [ENERGY]: 20,
});

const SEEDS = [5171, 5179] as const;

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

function board(
  seed: number,
  first: Seat,
  seat: Seat,
  activeId: string,
  bench: number,
  foeBench = 0,
  passes = 2,
): GameState {
  const foe = seat === "p1" ? "p2" : "p1";
  let state = localSetup(seed, first);
  for (let i = 0; i < passes; i += 1) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  if (state.phase.kind !== "turn:action" || state.phase.seat !== seat) {
    throw new Error(`expected ${seat} to be on turn, got ${JSON.stringify(state.phase)}`);
  }
  state = setActiveFromDeck(state, seat, activeId);
  state = clearBench(state, seat);
  state = clearBench(state, foe);
  for (let i = 0; i < bench; i += 1) state = benchFromDeck(state, seat, FILLER);
  for (let i = 0; i < foeBench; i += 1) state = benchFromDeck(state, foe, FILLER);
  return attachFromDeck(state, seat, ENERGY, 2);
}

function swing(state: GameState, seat: Seat, index: number) {
  const result = applyAction(deepFreeze(state), { type: "attack", seat, index });
  if (!result.ok) throw new Error(`attack refused: ${result.error.code}`);
  return result;
}

describe("D282 §1 — the gate-clause census (LEADING, and since D541 TRAILING), re-derived at HEAD", () => {
  it("the corpus holds exactly 7 gate sentences / 17 printings ( D541 6/14 → 7/17; D545 → 9/19), and NO other leading clause", () => {
    const corpus = legalAttackCorpus();
    const gated = corpus.filter(([, text]) => splitAttackGateClause(text) !== null);
    expect(gated.length).toBe(9);
    expect(gated.reduce((sum, [units]) => sum + units, 0)).toBe(19);

    const leadingIf = corpus.filter(([, text]) => text.startsWith("If ") && text.includes(". "));
    expect(leadingIf.length).toBe(8);
    expect(leadingIf.reduce((sum, [units]) => sum + units, 0)).toBe(16);
    const substantive = leadingIf.filter(([, text]) => splitAttackGateClause(text) === null);
    expect(substantive.length).toBe(5);
    expect(substantive.reduce((sum, [units]) => sum + units, 0)).toBe(6);
  });

  it("the 13 `yourBenchCount` printings, and the two POOL-ONLY sentences that are not arms", () => {
    const corpus = new Map(legalAttackCorpus().map(([units, text]) => [text, units]));
    expect(corpus.get(TAPU_KOKO_TEXT)).toBe(3);
    expect(corpus.get(DIPPLIN_TEXT)).toBe(3);
    expect(corpus.get(TERAPAGOS_TEXT)).toBe(7);
    expect(corpus.get(NARROWED_NOUN)).toBeUndefined();
    expect(corpus.get("This attack does 10 more damage for each of your Benched Pokémon.")).toBe(
      undefined,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The two readers — the fold is the ADJECTIVE, the seat is the POSSESSIVE.
// ─────────────────────────────────────────────────────────────────────────────

describe("D282 §2 — `yourBenchCount` on both folds", () => {
  it("reads the attacker's own Bench on the ADDITIVE fold and on the `×` fold", () => {
    expect(deriveAttackDamageBonus(TAPU_KOKO_TEXT)).toEqual({
      per: 20,
      count: { kind: "yourBenchCount" },
    });
    expect(deriveAttackDamageMultiplier(DIPPLIN_TEXT)).toEqual({
      per: 20,
      count: { kind: "yourBenchCount" },
    });
  });

  it("THE POSSESSIVE IS THE WHOLE DISCRIMINATOR — the three Bench nouns stay apart", () => {
    // One word separates these three sentences and they must produce three
    // different members. A reader that dropped the possessive would collapse them.
    expect(
      deriveAttackDamageBonus(
        "This attack does 20 more damage for each of your opponent's Benched Pokémon.",
      ),
    ).toEqual({ per: 20, count: { kind: "opponentBenchCount" } });
    expect(
      deriveAttackDamageBonus(
        "This attack does 20 more damage for each Benched Pokémon (both yours and your opponent's).",
      ),
    ).toEqual({ per: 20, count: { kind: "bothSidesBenchCount" } });
    expect(deriveAttackDamageBonus(TAPU_KOKO_TEXT)).toEqual({
      per: 20,
      count: { kind: "yourBenchCount" },
    });
  });

  it("counts BODIES, never the counters on them — the near miss one arm over", () => {
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 20 damage for each damage counter on all of your Benched Pokémon.",
      ),
    ).toEqual({ per: 20, count: { kind: "damageCountersOnYourBench" } });
  });

  it("REFUSES the PREDICATE-narrowed noun (3 printed, 0 legal) and the anchors' near misses", () => {
    const read = (t: string) => deriveAttackDamageBonus(t) ?? deriveAttackDamageMultiplier(t);
    expect(read(NARROWED_NOUN)).toBeNull();
    for (const sentence of [TAPU_KOKO_TEXT, DIPPLIN_TEXT]) {
      expect(read(sentence.replace(/^This/, "this"))).toBeNull(); // lowercase
      expect(read(sentence.slice(0, -1))).toBeNull(); // no trailing period
      expect(read(`Flip a coin. If heads, ${sentence.toLowerCase()}`)).toBeNull(); // leading text
      expect(read(`${sentence} Then, shuffle your deck.`)).toBeNull(); // trailing text
    }
    expect(read(TERAPAGOS_TEXT)).toBeNull();
  });

  it("a printed 0 does nothing — the guard every arm in both families carries", () => {
    expect(
      deriveAttackDamageMultiplier("This attack does 0 damage for each of your Benched Pokémon."),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus("This attack does 0 more damage for each of your Benched Pokémon."),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The split anchor as a PURE function — three clauses, and nothing else.
// ─────────────────────────────────────────────────────────────────────────────

const ROLLOUT_GATE_TEXT =
  "You can use this attack only if this Pokémon used Rollout during your last turn.";

const TERAPAGOS_GATE = "If you go second, you can't use this attack during your first turn.";

describe("D282 §3 — splitAttackGateClause", () => {
  it("splits all three printed gate spellings and hands back BOTH halves", () => {
    expect(splitAttackGateClause(TERAPAGOS_TEXT)).toEqual({
      clause: "If you go second, you can't use this attack during your first turn.",
      body: TERAPAGOS_BODY,
    });
    expect(splitAttackGateClause(VOLBEAT_TEXT)).toEqual({
      clause: "If you go first, you can use this attack during your first turn.",
      body: VOLBEAT_BODY,
    });
    expect(splitAttackGateClause(ILLUMISE_TEXT)).toEqual({
      clause: "You can use this attack only if you go second, and only during your first turn.",
      body: ILLUMISE_BODY,
    });
  });

  it("SITS AT A SENTENCE BOUNDARY — mid-string is not a split, and EITHER end is", () => {
    // ① MID-STRING, body on both sides: neither boundary is there, at either end.
    expect(splitAttackGateClause(`Draw a card. ${TERAPAGOS_TEXT}`)).toBeNull();
    expect(splitAttackGateClause(`Draw a card. ${TERAPAGOS_GATE} Then, draw a card.`)).toBeNull();
    expect(splitAttackGateClause(`${TERAPAGOS_BODY} ${TERAPAGOS_GATE}`)).toEqual({
      clause: TERAPAGOS_GATE,
      body: TERAPAGOS_BODY,
    });
    // ③ …and the BOUNDARY is load-bearing at that end too: glued onto the previous
    //    sentence's period with no space, it is a substring and not a clause.
    expect(splitAttackGateClause(`${TERAPAGOS_BODY}${TERAPAGOS_GATE}`)).toBeNull();
    // ④ THE ATTRIBUTION CONTROLS, unchanged: a body alone and the empty string are
    //    not splits for reasons that have nothing to do with position.
    expect(splitAttackGateClause(TERAPAGOS_BODY)).toBeNull();
    expect(splitAttackGateClause(DIPPLIN_TEXT)).toBeNull();
    expect(splitAttackGateClause("")).toBeNull();
  });

  it("a clause with NO BODY behind it IS a split, and `body` is the empty string", () => {
    expect(splitAttackGateClause(ROLLOUT_GATE_TEXT)).toEqual({
      clause: ROLLOUT_GATE_TEXT,
      body: "",
    });
    expect(
      splitAttackGateClause("If you go first, you can use this attack during your first turn."),
    ).toEqual({
      clause: "If you go first, you can use this attack during your first turn.",
      body: "",
    });
    expect(
      splitAttackGateClause("If you go first, you can use this attack during your first turn.  "),
    ).toEqual({
      clause: "If you go first, you can use this attack during your first turn.",
      body: "",
    });
  });

  it("DOES NOT LOOSEN ANY READER — all TWELVE still refuse the WHOLE gated string", () => {
    const readers = [
      deriveAttackEffect,
      deriveAttackDamageBonus,
      deriveAttackDamagePenalty,
      deriveAttackDamageMultiplier,
      deriveAttackCoinFlip,
      deriveAttackRequirement,
      deriveAttackBonusConsequent,
      deriveAttackCancelRequirement,
      deriveAttackDiscardScaledBoost,
      deriveAttackOptionalBoost,
      deriveAttackOptionalCostBoost,
      deriveAttackPreDamage,
      deriveAttackCopy,
      deriveAttackDamageSuppression,
    ];
    expect(readers.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
    for (const text of [TERAPAGOS_TEXT, VOLBEAT_TEXT, ILLUMISE_TEXT]) {
      expect(resolvedByAnyReader(text), text).toBe(false);
      for (const read of readers) expect(read(text), text).toBeNull();
    }
    expect(deriveAttackDamageMultiplier(TERAPAGOS_BODY)).not.toBeNull();
    expect(deriveAttackEffect(VOLBEAT_BODY)).not.toBeNull();
    expect(deriveAttackEffect(ILLUMISE_BODY)).not.toBeNull();
  });
});

describe("D282 §4 — the split fires ONLY where the gate is already accounted for", () => {
  it("a NEAR-MISS clause keeps its whole string and stays LOUD — the split is a TABLE, not a pattern", () => {
    expect(programFor(NEAR_MISS_TWIN)).toBeUndefined();
    expect(splitAttackGateClause(NEAR_MISS_TEXT)).toBeNull();
    const state = board(SEEDS[0], "p1", "p1", NEAR_MISS_TWIN, 3);
    const { events } = swing(state, "p1", 0);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    // …and the engine SAYS SO, with the WHOLE printed compound in the report and
    // the unexplained "×" beside it.
    const skipped = findEvent(events, "ATTACK_EFFECT_SKIPPED");
    expect(skipped?.effect).toBe(NEAR_MISS_TEXT);
    expect(skipped?.damageModifier).toBe("×");
  });

  it("D444 — the UNGATED twin is now GATED off its own printed clause, with no registry row", () => {
    expect(programFor(UNGATED_TWIN)).toBeUndefined();
    const barred = board(SEEDS[0], "p1", "p2", UNGATED_TWIN, 3, 0, 1);
    expect(barred.turn).toBe(2);
    const refused = applyAction(deepFreeze(barred), { type: "attack", seat: "p2", index: 0 });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error.code).toBe("ATTACK_PREVENTED");
    // …and the REGISTERED twin answers identically on the identical board, which is
    // the agreement claim: `registry ?? derived` must not fork the behaviour.
    const registered = board(SEEDS[0], "p1", "p2", "sv07-128", 3, 0, 1);
    const refusedReal = applyAction(deepFreeze(registered), {
      type: "attack",
      seat: "p2",
      index: 0,
    });
    expect(refusedReal.ok).toBe(false);
    expect(refusedReal.ok === false && refusedReal.error.code).toBe("ATTACK_PREVENTED");
    const { events } = swing(board(SEEDS[0], "p1", "p1", UNGATED_TWIN, 3), "p1", 0);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(90);
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("…while the GATED printing of that same sentence resolves it", () => {
    // The pair, on the same seed and the same Bench. The ONLY difference is the
    // registry's `attackGate`, which is the precondition under test.
    expect(programFor("sv07-128")?.attackGate?.[0]).toBeDefined();
    const state = board(SEEDS[0], "p1", "p1", "sv07-128", 3);
    const { events } = swing(state, "p1", 0);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(90);
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The evaluator, on a board where the three Bench counts DISAGREE.
// ─────────────────────────────────────────────────────────────────────────────

describe("D282 §5 — the count, driven", () => {
  it("3 MINE / 1 THEIRS: the answer is 3 × 30, not 1 × 30 and not 4 × 30", () => {
    for (const seed of SEEDS) {
      const state = board(seed, "p1", "p1", "sv07-128", 3, 1);
      expect(findEvent(swing(state, "p1", 0).events, "DAMAGE_DEALT")?.dealt).toBe(90);
    }
  });

  it("the `×` fold DROPS the printed base — an empty Bench deals nothing at all", () => {
    const state = board(SEEDS[0], "p1", "p1", "sv07-128", 0);
    const { events } = swing(state, "p1", 0);
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("counts BODIES and never the counters on them", () => {
    let hurt = board(SEEDS[0], "p1", "p1", "sv07-128", 2);
    hurt = {
      ...hurt,
      players: {
        ...hurt.players,
        p1: { ...hurt.players.p1, bench: hurt.players.p1.bench.map((p) => ({ ...p, damage: 50 })) },
      },
    };
    const clean = board(SEEDS[0], "p1", "p1", "sv07-128", 2);
    expect(findEvent(swing(hurt, "p1", 0).events, "DAMAGE_DEALT")?.dealt).toBe(60);
    expect(findEvent(swing(clean, "p1", 0).events, "DAMAGE_DEALT")?.dealt).toBe(60);
  });

  it("the ADDITIVE fold KEEPS the printed base: 60 + 2 × 20 = 100 (Tapu Koko ex)", () => {
    const state = board(SEEDS[0], "p1", "p1", "sv09-051", 2, 3);
    const { events } = swing(state, "p1", 0);
    expect(findEvent(events, "DAMAGE_DEALT")?.scaled).toBe(40);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(100);
  });

  it("…and the un-gated `×` printing reads the same member: 3 × 20 (Dipplin)", () => {
    const state = board(SEEDS[1], "p1", "p1", "sv06-018", 3, 2);
    expect(findEvent(swing(state, "p1", 0).events, "DAMAGE_DEALT")?.dealt).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. The gate and the split, together — and the residue the split still reports.
// ─────────────────────────────────────────────────────────────────────────────

describe("D282 §6 — the gate still bites, and the unread bodies stay loud", () => {
  it("THE GATE IS UNTOUCHED: going second on turn 1, Terapagos is still BARRED", () => {
    const turn = board(SEEDS[0], "p1", "p2", "sv07-128", 3, 0, 1);
    expect(turn.turn).toBe(2);
    const refused = applyAction(deepFreeze(turn), { type: "attack", seat: "p2", index: 0 });
    expect(refused.ok).toBe(false);
    const phase = redactGame(turn, "p2").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action on the wire");
    expect(phase.attacks.find((a) => a.index === 0)?.playable).toBe(false);
  });

  it("VOLBEAT's licensed body RUNS — the search program the split unblocked", () => {
    const state = board(SEEDS[0], "p1", "p1", "sv06-009", 1, 0, 0);
    expect(state.turn).toBe(1);
    const { state: after, events } = swing(state, "p1", 0);
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(after.pending).not.toBeNull();
  });

  it("D299 — ILLUMISE's body is READ NOW, and the split is still what delivers it", () => {
    const empty = board(SEEDS[0], "p2", "p1", "sv06-010", 1, 0, 1);
    const { state: afterEmpty, events: emptyEvents } = swing(empty, "p1", 0);
    expect(findEvent(emptyEvents, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(findEvent(emptyEvents, "POKEMON_RETURNED")).toBeUndefined();
    expect(afterEmpty.players.p2.bench).toHaveLength(0);
    // `pending` is the PROMPT list and an empty array is "nothing to answer" —
    // the same shape §4's ungated twin asserts non-empty one describe up.
    expect(afterEmpty.pending).toHaveLength(0);

    // ② One body on their Bench — forced (a lone candidate is not a decision),
    // so the whole sentence resolves inside the attack.
    const one = board(SEEDS[0], "p2", "p1", "sv06-010", 1, 1, 1);
    const benchedUid = topUid(one.players.p2.bench[0] as InPlayPokemon) as string;
    const { state: after, events } = swing(one, "p1", 0);
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    const returned = findEvent(events, "POKEMON_RETURNED");
    expect(returned?.seat).toBe("p2");
    expect(returned?.actor).toBe("p1");
    expect(returned?.dest).toBe("deck");
    expect(after.players.p2.bench).toHaveLength(0);
    expect(returned?.uids).toEqual([benchedUid]);
    expect(one.players.p2.deck).not.toContain(benchedUid);
    expect(after.players.p2.deck).toContain(benchedUid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. MATCH_RECORD_VERSION — driven, not asserted.
// ─────────────────────────────────────────────────────────────────────────────

describe("D282 §7 — the persisted shape is untouched", () => {
  it("a scaled attack and a plain one write the SAME top-level keys, against a literal anchor", () => {
    const scaled = swing(board(SEEDS[0], "p1", "p1", "sv07-128", 3), "p1", 0).state;
    const plain = swing(board(SEEDS[0], "p1", "p1", FILLER, 3), "p1", 0).state;
    expect(Object.keys(scaled).sort()).toEqual(Object.keys(plain).sort());
    expect(Object.keys(scaled).sort()).toEqual(
      [
        "allowances",
        "cardIdByUid",
        "cardPool",
        "firstPlayer",
        "lastKoMarks",
        "lastKoTurn",
        "oncePerGameSpent",
        "handPlayLockedTurn",
        "pending",
        "phase",
        "players",
        "recentAttackers",
        "rngState",
        "stadium",
        "turn",
      ].sort(),
    );
  });

  it("NOTHING THIS SLICE ADDS CAN REACH A PERSISTED STRUCTURE — the source is a DERIVED value", () => {
    let programsWalked = 0;
    let gatesFound = 0;
    let countSourcesFound = 0;
    for (const id of Object.keys(POOL)) {
      const program = programFor(id);
      if (program === undefined) continue;
      programsWalked += 1;
      gatesFound += Object.keys(program.attackGate ?? {}).length;
      if (JSON.stringify(program).includes("yourBenchCount")) countSourcesFound += 1;
    }
    expect(programsWalked).toBeGreaterThan(0);
    expect(gatesFound).toBe(9); // the 7 Terapagos + Volbeat + Illumise in THIS pool
    expect(countSourcesFound).toBe(0);
    // …and the in-play stack carries no new field either.
    const scaled = swing(board(SEEDS[0], "p1", "p1", "sv07-128", 3), "p1", 0).state;
    const active = scaled.players.p1.active;
    expect(active).not.toBeNull();
    expect(Object.keys(active ?? {})).not.toContain("scaled");
  });
});
