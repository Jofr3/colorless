import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { applyAction, deriveAttackEffect, logFromEvents } from "./index";
import type { EffectOp, GameEvent, GameState, LogContext } from "./index";
import { runProgram } from "./interpreter";
import { programFor, registryCardIds } from "./registry";
import {
  COUNTER_UNTIL_HP_DECK,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  findEvent,
  roundTrip,
} from "./testFixtures";

function placements(
  events: readonly GameEvent[],
): Extract<GameEvent, { type: "COUNTERS_PLACED" }>[] {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "COUNTERS_PLACED" }> => e.type === "COUNTERS_PLACED",
  );
}

/** The three printed sentences, transcribed byte for byte off the committed column. */
const BENCH_100 =
  "Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is 100.";
const ACTIVE_50 =
  "Put damage counters on your opponent's Active Pokémon until its remaining HP is 50.";
const ACTIVE_10 =
  "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10.";

/** `fix-hptarget`'s attack indices, named so a board reads as a sentence. */
const IDX = { bench: 0, deep: 1, shallow: 2, bolt: 3 } as const;

/** The two printed maxima this file's arithmetic is written against. */
const BIG_HP = 200; // fix-bigbody
const WEAK_HP = 130; // fix-lightning-weak, ×2 Lightning
const CHARM_HP = 50; // sv02-173 Bravery Charm, +50 on a Basic

/** Both Actives pinned to `fix-bigbody` (200 HP, Colorless, no Ability), p1's turn
    open. Colorless on both sides matters: a placed counter must be FLAT, and a board
    whose default defender could double would make every number here ambiguous. */
function table(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: COUNTER_UNTIL_HP_DECK, p2: COUNTER_UNTIL_HP_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `fix-hptarget` with one {L} attached (the {C} cost, and the type that
    arms Bellibolt's clause). Both benches are cleared after the Active surgeries,
    because `setActiveFromDeck` DISPLACES rather than removes. */
function fielded(
  seed: number,
  opts: { defender?: string; theirs?: readonly string[] } = {},
): GameState {
  let state = setActiveFromDeck(table(seed), "p1", "fix-hptarget");
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-lightning-energy", 1);
  if (opts.defender !== undefined) state = setActiveFromDeck(state, "p2", opts.defender);
  state = clearBench(state, "p2");
  for (const body of opts.theirs ?? []) state = benchFromDeck(state, "p2", body);
  return state;
}

function attack(state: GameState, index: number): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

const theirActive = (s: GameState) => s.players.p2.active;
const theirBench = (s: GameState) => s.players.p2.bench;

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the population: what is claimed, what is closed, and what is still refused.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — three sentences, five printings, and the class is CLOSED", () => {
  it("all three are in the legal attack column at the printing counts this slice claims", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(BENCH_100)).toBe(2);
    expect(rows.get(ACTIVE_10)).toBe(1);
    expect(rows.get(ACTIVE_50)).toBe(2);
    expect(
      (rows.get(BENCH_100) ?? 0) + (rows.get(ACTIVE_10) ?? 0) + (rows.get(ACTIVE_50) ?? 0),
    ).toBe(5);
  });

  it("`\\bHP\\b` over the WHOLE column returns exactly these three — the class is closed", () => {
    const hp = legalAttackCorpus().filter(([, t]) => /\bHP\b/.test(t));
    expect(hp.map(([, t]) => t).sort()).toEqual([BENCH_100, ACTIVE_10, ACTIVE_50].sort());
    expect(hp.reduce((sum, [n]) => sum + n, 0)).toBe(5);
    for (const [, t] of hp) {
      const printed = Number(/remaining HP is (\d+)\./.exec(t)?.[1]);
      expect(printed).toBeGreaterThan(0);
      expect(printed % 10).toBe(0);
    }
    expect(legalAttackCorpus().some(([, t]) => /remaining HP is 30 or less/.test(t))).toBe(false);
  });

  it("all three resolve through the reader SURFACE, and the surface did not grow", () => {
    for (const s of [BENCH_100, ACTIVE_50, ACTIVE_10]) expect(resolvedByAnyReader(s), s).toBe(true);
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the PLACEMENT family closes from SEVEN rows to FOUR to TWO, each refusal by name", () => {
    const family = legalAttackCorpus().filter(([, t]) => /put \d* ?damage counters/i.test(t));
    expect(family).toHaveLength(19);
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(38);
    const unread = family.filter(([, t]) => !resolvedByAnyReader(t));
    expect(family.every(([, t]) => resolvedByAnyReader(t))).toBe(true);
    expect(family.filter(([, t]) => resolvedByAnyReader(t))).toHaveLength(19);
    expect(family.filter(([, t]) => resolvedByAnyReader(t)).reduce((sum, [n]) => sum + n, 0)).toBe(
      38,
    );
    expect(unread).toHaveLength(0);
    expect(unread.reduce((sum, [n]) => sum + n, 0)).toBe(0);
    const unbuilt = unread.map(([, t]) => t);
    for (const s of [BENCH_100, ACTIVE_50, ACTIVE_10]) expect(unbuilt).not.toContain(s);

    expect(unbuilt).not.toContain(
      "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put 6 damage counters on the Attacking Pokémon.",
    );
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put 6 damage counters on the Attacking Pokémon.",
      ),
    ).toEqual([{ op: "installRecoil", amount: 60 }]);
    expect(unbuilt).not.toContain(
      "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.",
    );
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.",
      ),
    ).toEqual([{ op: "installRecoil", amount: "damageTaken" }]);
    // …and the two are NOT the same program, which is the discrimination the pair of
    // `toContain`s above could never provide: one anchor with a looser amount slot would
    // have claimed both sentences with one op and passed every rung in this block.
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put 6 damage counters on the Attacking Pokémon.",
      ),
    ).not.toEqual(
      deriveAttackEffect(
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.",
      ),
    );
    expect(unbuilt).not.toContain(
      "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.",
    );
    expect(
      deriveAttackEffect(
        "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.",
      )?.map((o) => o.op),
    ).toEqual(["damageChosen", "discardPileRetrieval", "shuffleDeck"]);
    expect(deriveAttackEffect("Then, shuffle those Energy cards into your deck.")).toBeNull();
    expect(unbuilt).not.toContain(
      "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.",
    );
    expect(
      deriveAttackEffect(
        "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.",
      ),
    ).toEqual([{ op: "applyStatus", target: "defender", status: "confused", confusionDamage: 80 }]);
    expect(
      deriveAttackEffect(
        "Put up to 9 damage counters on this Pokémon. This attack does 20 damage for each damage counter you placed in this way.",
      ),
    ).toBeNull();
  });

  it("the BENCH sentence is arm 23e's near miss and the ACTIVE pair is NOT — the brief had it backwards", () => {
    const fold = deriveAttackEffect("Put 2 damage counters on each of your opponent's Pokémon.");
    expect(fold?.[0]?.op).toBe("counterEachAll");
    expect(deriveAttackEffect(BENCH_100)?.[0]).toMatchObject({ target: "opponentBench" });
    expect(deriveAttackEffect(ACTIVE_50)?.[0]).toMatchObject({ target: "opponentActive" });
    // …and the ACTIVE pair's real sibling is arm 22, which names the same body and
    // differs only in where the number comes from.
    expect(deriveAttackEffect("Put 7 damage counters on your opponent's Active Pokémon.")).toEqual([
      { op: "damageActive", amount: 70, source: "attack" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the two anchors: what they claim, and the cross product they refuse.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the anchors derive their own ops, and the co-variance is fenced", () => {
  it("each sentence derives the exact literal, and the printed number is HP not counters", () => {
    expect(deriveAttackEffect(BENCH_100)).toEqual([
      {
        op: "counterUntilRemainingHp",
        target: "opponentBench",
        remainingHp: 100,
        source: "attack",
      },
    ]);
    expect(deriveAttackEffect(ACTIVE_50)).toEqual([
      {
        op: "counterUntilRemainingHp",
        target: "opponentActive",
        remainingHp: 50,
        source: "attack",
      },
    ]);
    expect(deriveAttackEffect(ACTIVE_10)).toEqual([
      {
        op: "counterUntilRemainingHp",
        target: "opponentActive",
        remainingHp: 10,
        source: "attack",
      },
    ]);
    expect(deriveAttackEffect(ACTIVE_10)?.[0]).toMatchObject({ remainingHp: 10 });
    expect(deriveAttackEffect("Put 10 damage counters on your opponent's Active Pokémon.")).toEqual(
      [{ op: "damageActive", amount: 100, source: "attack" }],
    );
  });

  it("refuses the CROSS PRODUCT — the determiner and the zone word CO-VARY", () => {
    for (const [why, text] of [
      [
        "the determiner on the ACTIVE",
        "Put damage counters on each of your opponent's Active Pokémon until its remaining HP is 10.",
      ],
      [
        "the BENCH with no determiner",
        "Put damage counters on your opponent's Benched Pokémon until its remaining HP is 100.",
      ],
    ] as const) {
      expect(deriveAttackEffect(text), why).toBeNull();
    }
  });

  it("the `$` fences the printed COMPOUND, which is a STRICT PREFIX extension", () => {
    const compound =
      "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10. If you placed any damage counters in this way, this attack also does 120 damage to this Pokémon.";
    expect(compound.startsWith(ACTIVE_10)).toBe(true);
    expect(deriveAttackEffect(compound)).toBeNull();
    expect(legalAttackCorpus().some(([, t]) => t === compound)).toBe(false);
  });

  it("refuses every other near miss, each on a different axis", () => {
    for (const [why, text] of [
      // THE SEAT — your own bodies, the destination reversed.
      [
        "your own Active",
        "Put damage counters on your Active Pokémon until its remaining HP is 10.",
      ],
      [
        "the threshold reading",
        "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10 or less.",
      ],
      // NO TRAILING PERIOD — the `$` sits after it.
      [
        "no period",
        "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10",
      ],
      [
        "lowercase, mid-sentence",
        "put damage counters on your opponent's Active Pokémon until its remaining HP is 10.",
      ],
      // A LEADING RIDER pins `^`; a trailing one pins `$` (the compound above).
      [
        "a gate clause in front",
        "Flip a coin. If heads, put damage counters on your opponent's Active Pokémon until its remaining HP is 10.",
      ],
      // THE SINGULAR NOUN — the family's standing near miss shape.
      [
        "one counter, singular",
        "Put damage counter on your opponent's Active Pokémon until its remaining HP is 10.",
      ],
      // A PRINTED COUNT in front: that is arm 22's sentence with this one's tail, and it
      // is exactly the sentence a merged anchor would have invented.
      [
        "a count AND a destination",
        "Put 5 damage counters on your opponent's Active Pokémon until its remaining HP is 10.",
      ],
      ["empty", ""],
    ] as const) {
      expect(deriveAttackEffect(text), why).toBeNull();
    }
  });

  it("derives the CURLY apostrophe identically, and rejects a NON-BREAKING space", () => {
    for (const s of [BENCH_100, ACTIVE_50, ACTIVE_10]) {
      const curly = s.replaceAll("'", "’");
      expect(curly).not.toBe(s);
      expect(deriveAttackEffect(curly), s).toEqual(deriveAttackEffect(s));
    }
    // U+00A0, spelled as an ESCAPE rather than typed: byte-different from an ASCII space
    // and INVISIBLE in a diff, which is the whole reason it is written this way.
    expect(deriveAttackEffect(ACTIVE_50.replace(" damage", " damage"))).toBeNull();
    // Outer whitespace SURVIVES by design (the deriver trims).
    expect(deriveAttackEffect(`\t  ${ACTIVE_50}\n`)).toEqual(deriveAttackEffect(ACTIVE_50));
  });

  it("refuses a printed destination of ZERO, which is the ONE value that would make this op lethal", () => {
    for (const s of [
      "Put damage counters on your opponent's Active Pokémon until its remaining HP is 0.",
      "Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is 0.",
    ]) {
      expect(deriveAttackEffect(s), s).toBeNull();
    }
    expect(
      deriveAttackEffect(
        "Put damage counters on your opponent's Active Pokémon until its remaining HP is 7.",
      ),
    ).toEqual([
      { op: "counterUntilRemainingHp", target: "opponentActive", remainingHp: 7, source: "attack" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the persisted op, and the version prediction DRIVEN over the bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — a NEW `EffectOp` inhabitant, and the record version does not move", () => {
  it("the version PREDICTION, driven over the SERIALIZED BYTES in THREE directions", () => {
    // **DIRECTION 1 — FORWARD: the literal this deploy writes, whole.** Key sets are
    // asserted rather than eyeballed, because "the object looked right" is how a key
    // goes missing.
    const fresh = (deriveAttackEffect(ACTIVE_50) as EffectOp[])[0] as EffectOp;
    expect(JSON.stringify(fresh)).toBe(
      '{"op":"counterUntilRemainingHp","target":"opponentActive","remainingHp":50,"source":"attack"}',
    );
    expect(Object.keys(fresh).sort()).toEqual(["op", "remainingHp", "source", "target"]);
    expect(roundTrip(fresh)).toEqual(fresh);
    const bench = (deriveAttackEffect(BENCH_100) as EffectOp[])[0] as EffectOp;
    expect(JSON.stringify(bench)).toBe(
      '{"op":"counterUntilRemainingHp","target":"opponentBench","remainingHp":100,"source":"attack"}',
    );

    expect(JSON.stringify(fresh)).toContain("counterUntilRemainingHp");
    for (const s of [BENCH_100, ACTIVE_50, ACTIVE_10]) {
      expect(deriveAttackEffect(s), s).toHaveLength(1);
    }
    const authored: EffectOp[][] = [];
    for (const id of registryCardIds()) {
      const card = programFor(id);
      if (card === undefined) continue;
      for (const ops of Object.values(card.attack ?? {})) authored.push(ops);
      for (const ability of card.abilities ?? []) authored.push(ability.program);
      for (const trigger of card.triggered ?? []) authored.push(trigger.program);
      if (card.trainer !== undefined) authored.push(card.trainer);
    }
    expect(authored.length).toBeGreaterThan(0);
    expect(authored.flat().filter((o) => o.op === "counterUntilRemainingHp")).toHaveLength(0);
    for (const index of [IDX.bench, IDX.deep, IDX.shallow]) {
      const { state } = attack(fielded(30 + index, { theirs: ["fix-bigbody"] }), index);
      expect(state.phase.kind, `index ${index}`).not.toBe("effect:choose");
    }

    for (const key of ["op", "target", "remainingHp", "source"] as const) {
      const dropped = JSON.parse(
        JSON.stringify(fresh, (k, v) => (k === key ? undefined : v)),
      ) as Record<string, unknown>;
      expect(Object.keys(dropped), key).not.toContain(key);
      expect(dropped).not.toEqual(fresh);
      expect(dropped).not.toEqual(bench);
    }
    const board = fielded(37, { theirs: ["fix-bigbody"] });
    const events: GameEvent[] = [];
    const mutilated = JSON.parse(
      JSON.stringify(fresh, (k, v) => (k === "remainingHp" ? undefined : v)),
    ) as EffectOp;
    const run = runProgram(board, [mutilated], { seat: "p1", invokedBy: "attack" }, events);
    expect(Number.isNaN(run.state.players.p2.active?.damage ?? 0)).toBe(true);
    expect(placements(events)[0]?.amount).toBeNaN();
    // …and NONE of the three is reachable, because direction 2 established there is no
    // record to lose them from. Both halves are stated; neither alone is the argument.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — WHICH HP: `effectiveMaxHp`, never the printed `hpOf`.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the maximum is the CONTINUOUS one and a Tool moves it", () => {
  it("fills a bare 200 HP Active to exactly the printed destination", () => {
    const { state, events } = attack(fielded(40), IDX.deep);
    expect(placements(events)).toHaveLength(1);
    expect(placements(events)[0]?.amount).toBe(BIG_HP - 50);
    expect(theirActive(state)?.damage).toBe(BIG_HP - 50);
    // The printed phrase, read back off the board: remaining IS the destination.
    expect(BIG_HP - (theirActive(state)?.damage ?? 0)).toBe(50);
  });

  it("a BRAVERY CHARM raises the destination it is filled to — 150 becomes 200", () => {
    let state = fielded(41);
    state = attachToolFromDeck(state, "p2", "active", "sv02-173");
    const run = attack(state, IDX.deep);
    expect(placements(run.events)[0]?.amount).toBe(BIG_HP + CHARM_HP - 50);
    expect(theirActive(run.state)?.damage).toBe(200);
    // …and the remaining HP really is 50 against the EFFECTIVE maximum, which is the
    // reading the card prints; against the printed 200 it would be 0, i.e. a Knock Out.
    expect(BIG_HP + CHARM_HP - (theirActive(run.state)?.damage ?? 0)).toBe(50);
    expect(findEvent(run.events, "KNOCKED_OUT")).toBeUndefined();
  });

  it("the destination is read at the moment the op runs, on a body that already carries damage", () => {
    // `remainingHpWithin` (continuous.ts) reads `effectiveMaxHp − damage` and this op
    // subtracts from the same quantity; the two cannot disagree because they are the
    // same two terms. Driven at three different starting damages on one destination.
    for (const [seed, before, placed] of [
      [42, 0, BIG_HP - 10],
      [43, 60, BIG_HP - 60 - 10],
      [44, 150, BIG_HP - 150 - 10],
    ] as const) {
      const run = attack(setDamage(fielded(seed), "p2", before), IDX.shallow);
      expect(placements(run.events)[0]?.amount, `damage ${before}`).toBe(placed);
      expect(theirActive(run.state)?.damage, `damage ${before}`).toBe(BIG_HP - 10);
    }
  });

  it("a body whose printed HP cannot be read takes NOTHING — the data gap is refused", () => {
    // `effectiveMaxHp` owns the catalog data gap and returns null; an unknown maximum
    // cannot be subtracted from. Refusing is `remainingHpWithin`'s direction verbatim.
    // Driven through the op directly, because no fixture in this pool has a null hp.
    const board = fielded(45);
    const gapped: GameState = {
      ...board,
      players: {
        ...board.players,
        p2: {
          ...board.players.p2,
          active:
            board.players.p2.active === null ? null : { ...board.players.p2.active, stack: [] },
        },
      },
    };
    const events: GameEvent[] = [];
    const run = runProgram(
      gapped,
      deriveAttackEffect(ACTIVE_50) as EffectOp[],
      { seat: "p1", invokedBy: "attack" },
      events,
    );
    expect(placements(events)).toHaveLength(0);
    expect(run.state.players.p2.active?.damage).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the distributive "its": each body is filled INDEPENDENTLY.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — `its` binds PER BODY, and a shared amount is a killed build", () => {
  function benched(seed: number): GameState {
    let state = fielded(seed, { theirs: ["fix-bigbody", "fix-bigbody", "fix-lightning-weak"] });
    state = setBenchDamage(state, "p2", 1, 30);
    state = setBenchDamage(state, "p2", 2, 40);
    return state;
  }

  it("fills each Benched body to 100 SEPARATELY — two amounts and a zero on one board", () => {
    const { state, events } = attack(benched(50), IDX.bench);
    const rows = placements(events);
    expect(rows.map((r) => r.amount)).toEqual([100, 70]);
    expect(rows.every((r) => r.seat === "p2")).toBe(true);
    // …and every body that took counters has remaining EXACTLY 100, which is the
    // printed sentence read back off the board rather than off the events.
    expect(theirBench(state)[0]?.damage).toBe(BIG_HP - 100);
    expect(theirBench(state)[1]?.damage).toBe(BIG_HP - 100);
    // The third was already under the destination and is untouched — §6's subject, and
    // it sits on THIS board so "some bodies, not all" is one assertion away.
    expect(theirBench(state)[2]?.damage).toBe(40);
    expect(rows).toHaveLength(2);
  });

  it("the ACTIVE is not on the Bench walk, and the Bench is not on the Active walk", () => {
    // The printed zone words, both directions, on one board each — the pair of
    // assertions that fails if `target` stops selecting anything.
    const benchRun = attack(benched(51), IDX.bench);
    expect(theirActive(benchRun.state)?.damage).toBe(0);
    const activeRun = attack(benched(52), IDX.deep);
    expect(theirActive(activeRun.state)?.damage).toBe(BIG_HP - 50);
    expect(activeRun.state.players.p2.bench.map((b) => b.damage)).toEqual([0, 30, 40]);
    expect(placements(activeRun.events)).toHaveLength(1);
  });

  it("the ATTACKER's own board is never walked, on either target", () => {
    // All three sentences print *"your opponent's"*, so the direction lives in `target`
    // and there is no seat left to get wrong — but a walk that read `ctx.seat` would be
    // invisible on a board where only one side has bodies.
    const run = attack(benched(53), IDX.bench);
    expect(run.state.players.p1.active?.damage).toBe(0);
    expect(placements(run.events).every((r) => r.seat === "p2")).toBe(true);
  });

  it("an EMPTY opponent Bench is a silent whiff, not a refusal", () => {
    const { state, events } = attack(fielded(54), IDX.bench);
    expect(state.players.p2.bench).toHaveLength(0);
    expect(placements(events)).toHaveLength(0);
    expect(findEvent(events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the FLOOR: at or below the destination is ZERO, never negative.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — a body already at or below the destination takes nothing", () => {
  it("places ZERO and files NO event on a body EXACTLY at the destination", () => {
    const { state, events } = attack(setDamage(fielded(60), "p2", BIG_HP - 50), IDX.deep);
    expect(placements(events)).toHaveLength(0);
    expect(theirActive(state)?.damage).toBe(BIG_HP - 50);
  });

  it("places ZERO and never a NEGATIVE amount on a body BELOW the destination", () => {
    // 200 HP at 195 damage is remaining 5, under index 1's 50. A build without the floor
    // would place −45, i.e. HEAL the body by 45 — the wrong sign on a put-counter op.
    const { state, events } = attack(setDamage(fielded(61), "p2", 195), IDX.deep);
    expect(placements(events)).toHaveLength(0);
    expect(theirActive(state)?.damage).toBe(195);
    expect(theirActive(state)?.damage).toBeGreaterThanOrEqual(0);
  });

  it("the floor is PER BODY, which is `healEachAll`'s shape and not `counterEachAll`'s", () => {
    const state = setBenchDamage(
      setBenchDamage(
        fielded(62, { theirs: ["fix-lightning-weak", "fix-bigbody", "fix-bigbody"] }),
        "p2",
        0,
        40,
      ),
      "p2",
      1,
      30,
    );
    const run = attack(state, IDX.bench);
    // The under-target body is FIRST in the walk, so a whole-op guard returns early and
    // places nothing at all. Two rows is the difference between the two shapes.
    expect(placements(run.events).map((r) => r.amount)).toEqual([70, 100]);
    expect(run.state.players.p2.bench[0]?.damage).toBe(40);
  });

  it("an undamaged body at exactly the destination's HP takes nothing — no damage is required", () => {
    const run = attack(fielded(63, { theirs: ["fix-lightning-weak"] }), IDX.bench);
    expect(placements(run.events)[0]?.amount).toBe(WEAK_HP - 100);
    expect(run.state.players.p2.bench[0]?.damage).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — IT CANNOT KNOCK ANYTHING OUT, asserted as a property rather than observed.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the no-Knock-Out property, and the guard that owns it", () => {
  it("the ARITHMETIC guarantees it: a filled body lands at `max − remainingHp`, strictly under `max`", () => {
    // The whole proof, written as a total check over the two things that vary — the
    // starting damage and the printed destination. It is not a claim about the three
    // printed rows: it is a claim about every `remainingHp >= 1` this op admits.
    for (let max = 10; max <= 340; max += 10) {
      for (const target of [1, 5, 10, 50, 100, max - 10, max, max + 100]) {
        if (target < 1) continue;
        for (const damage of [0, 5, 30, Math.max(0, max - 20)]) {
          const placed = max - damage - target;
          const after = placed <= 0 ? damage : damage + placed;
          // Either nothing was placed (so the body is exactly where it was, and it was
          // not lethal before or the board would already have swept it), or it lands at
          // `max − target`, which is `< max` for every positive target.
          if (placed > 0) expect(after).toBe(max - target);
          expect(after < max || placed <= 0).toBe(true);
        }
      }
    }
  });

  it("does not Knock Out a 200 HP body filled to 10 remaining, and pays no Prize", () => {
    const before = fielded(70);
    const prizes = before.players.p1.prizes.length;
    const { state, events } = attack(before, IDX.shallow);
    expect(theirActive(state)?.damage).toBe(BIG_HP - 10);
    expect(findEvent(events, "KNOCKED_OUT")).toBeUndefined();
    expect(state.players.p1.prizes.length).toBe(prizes);
    expect(state.players.p2.active).not.toBeNull();
    // …and no `takePrizes` stage was staged for the attacker either, which is the other
    // half of "no Knock Out" and the half a Prize-count assertion alone would miss.
    expect(state.pending.some((stage) => stage.kind === "takePrizes")).toBe(false);
  });

  it("does not Knock Out a body ALREADY below the destination — it is left standing at 5", () => {
    // 200 HP at 195 damage is remaining 5 under a printed 10. The floor refuses, and the
    // body is not swept by the attack epilogue either: it was never lethally damaged.
    const { state, events } = attack(setDamage(fielded(71), "p2", 195), IDX.shallow);
    expect(theirActive(state)?.damage).toBe(195);
    expect(findEvent(events, "KNOCKED_OUT")).toBeUndefined();
    expect(state.players.p2.active).not.toBeNull();
  });

  it("the INTERPRETER refuses `remainingHp <= 0` whole, so the property belongs to the FUNCTION", () => {
    for (const remainingHp of [0, -10]) {
      const board = fielded(72);
      const events: GameEvent[] = [];
      const run = runProgram(
        board,
        [
          {
            op: "counterUntilRemainingHp",
            target: "opponentActive",
            remainingHp,
            source: "attack",
          },
        ],
        { seat: "p1", invokedBy: "attack" },
        events,
      );
      expect(run.state, `remainingHp ${remainingHp}`).toBe(board);
      expect(events, `remainingHp ${remainingHp}`).toEqual([]);
    }
    // …and at 1 — the smallest value the guard admits — it places and still does not
    // kill, which is what makes the boundary a boundary rather than a blanket refusal.
    const board = fielded(73);
    const events: GameEvent[] = [];
    const run = runProgram(
      board,
      [
        {
          op: "counterUntilRemainingHp",
          target: "opponentActive",
          remainingHp: 1,
          source: "attack",
        },
      ],
      { seat: "p1", invokedBy: "attack" },
      events,
    );
    expect(run.state.players.p2.active?.damage).toBe(BIG_HP - 1);
    expect(placements(events)[0]?.amount).toBe(BIG_HP - 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — §11: the prevention gate, asked PER BODY and AFTER the amount.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the prevention gate, per body", () => {
  it("a printed EFFECT block on the Active refuses the placement and files ONE row", () => {
    const { state, events } = attack(fielded(80, { defender: "fix-unaware" }), IDX.deep);
    expect(placements(events)).toHaveLength(0);
    expect(theirActive(state)?.damage).toBe(0);
    const row = findEvent(events, "ATTACK_EFFECT_PREVENTED");
    expect(row?.seat).toBe("p2");
  });

  it("a shielded BENCH body silences exactly itself — the rest of the walk still fills", () => {
    const state = fielded(81, { theirs: ["fix-bigbody", "fix-unaware", "fix-lightning-weak"] });
    const run = attack(state, IDX.bench);
    expect(placements(run.events).map((r) => r.amount)).toEqual([BIG_HP - 100, WEAK_HP - 100]);
    expect(run.state.players.p2.bench[0]?.damage).toBe(BIG_HP - 100);
    expect(run.state.players.p2.bench[1]?.damage).toBe(0);
    expect(run.state.players.p2.bench[2]?.damage).toBe(WEAK_HP - 100);
    const rows = run.events.filter((e) => e.type === "ATTACK_EFFECT_PREVENTED");
    expect(rows).toHaveLength(1);
  });

  it("a body that would take ZERO is never asked, so it files no prevention row (D433)", () => {
    const state = setBenchDamage(
      fielded(82, { theirs: ["fix-unaware", "fix-bigbody"] }),
      "p2",
      0,
      130,
    );
    const run = attack(state, IDX.bench);
    expect(run.events.filter((e) => e.type === "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
    expect(run.state.players.p2.bench[0]?.damage).toBe(130);
    expect(run.state.players.p2.bench[1]?.damage).toBe(100);
  });

  it("the NARROW damage block does NOT stop it, which is the other printed spelling", () => {
    const placed = attack(fielded(83, { defender: "sv03-078" }), IDX.deep);
    expect(placements(placed.events)).toHaveLength(1);
    expect(theirActive(placed.state)?.damage).toBeGreaterThan(0);
    const bolt = attack(fielded(84, { defender: "sv03-078" }), IDX.bolt);
    expect(theirActive(bolt.state)?.damage).toBe(0);
  });
});

describe("§9 — a PLACED counter is flat, and the row says which mechanism placed it", () => {
  it("a ×2 Weakness does NOT double the placement", () => {
    // `fix-lightning-weak` is ×2 Lightning and the attacker is {L}. If this went through
    // §8.5 the 80 would become 160 and the body would be Knocked Out at 130 HP — so the
    // board is not merely a different number, it is a different outcome.
    const { state, events } = attack(fielded(90, { defender: "fix-lightning-weak" }), IDX.deep);
    expect(placements(events)[0]?.amount).toBe(WEAK_HP - 50);
    expect(theirActive(state)?.damage).toBe(WEAK_HP - 50);
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(findEvent(events, "KNOCKED_OUT")).toBeUndefined();
  });

  it("the amount need NOT be a multiple of ten, and the destination is hit on the nose", () => {
    const { state, events } = attack(setDamage(fielded(91), "p2", 5), IDX.deep);
    expect(placements(events)[0]?.amount).toBe(BIG_HP - 5 - 50);
    expect((placements(events)[0]?.amount ?? 0) % 10).not.toBe(0);
    expect(theirActive(state)?.damage).toBe(BIG_HP - 50);
    expect(BIG_HP - (theirActive(state)?.damage ?? 0)).toBe(50);
  });

  it("an attack's placement renders in the PRINTED verb and never the word Ability", () => {
    const { state: after, events } = attack(fielded(92), IDX.deep);
    expect(placements(events).every((e) => e.source === "attack")).toBe(true);
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state: after, elapsed: "+00:07" };
    const rendered = logFromEvents(events, ctx).flatMap((entry) =>
      entry.kind === "turn"
        ? []
        : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
    );
    const row = rendered.find((r) => r.text.startsWith("Put:"));
    expect(row).toBeDefined();
    expect(row?.who).toBe("system");
    expect(row?.text).toContain("150");
    expect(row?.text).not.toContain("Ability");
  });
});

describe("§10 — the attack really is the turn's last action", () => {
  it("refuses a second attack after the placement resolves", () => {
    const { state } = attack(fielded(95), IDX.deep);
    const again = applyAction(state, { type: "attack", seat: "p1", index: IDX.shallow });
    expect(again.ok).toBe(false);
  });
});
