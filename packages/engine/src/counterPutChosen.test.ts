import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { applyAction, deriveAttackEffect } from "./index";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import {
  COUNTER_PUT_CHOSEN_DECK,
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

/** The two printed sentences, transcribed byte for byte off the committed column. */
const BARE = "Put 2 damage counters on 1 of your opponent's Pokémon.";
const CHOSEN = "Choose 2 of your opponent's Pokémon and put 3 damage counters on each of them.";
const COMPOUND =
  "Put 9 damage counters on 1 of your opponent's Pokémon. During your next turn, this Pokémon can't attack.";
const BENCH_SIBLING = "Put 2 damage counters on 1 of your opponent's Benched Pokémon.";
const ACTIVE_SIBLING = "Put 2 damage counters on your opponent's Active Pokémon.";
/** The `deals: true` twin at the SAME amount and the SAME candidate set: the shipped
    any-target snipe. It is the attribution control §4 rests on. */
const DEALS_CONTROL =
  "This attack does 20 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** `fix-counterput`'s attack indices, named so a board reads as a sentence. */
const IDX = { bare: 0, chosen: 1, control: 2 } as const;

/** Both Actives pinned to `fix-lightning-weak` (×2 Lightning, 130 HP), P1's turn open. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: COUNTER_PUT_CHOSEN_DECK, p2: COUNTER_PUT_CHOSEN_DECK },
    { first: "p2", active: { p1: "fix-lightning-weak", p2: "fix-lightning-weak" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function fielded(
  seed: number,
  opts: { defender?: string; bench?: readonly string[] } = {},
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-counterput");
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-lightning-energy", 1);
  if (opts.defender !== undefined) {
    state = setActiveFromDeck(state, "p2", opts.defender);
  }
  state = clearBench(state, "p2");
  for (const body of opts.bench ?? []) state = benchFromDeck(state, "p2", body);
  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the population: what is claimed, and every refusal by name.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the two printed sentences, and what the placement family still refuses", () => {
  it("both are in the legal attack column at the printing counts this slice claims", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(BARE)).toBe(1);
    expect(rows.get(CHOSEN)).toBe(1);
    expect(rows.has(COMPOUND)).toBe(false);
    expect(rows.has(BENCH_SIBLING)).toBe(false);
  });

  it("both resolve through the reader SURFACE, and the surface did not grow", () => {
    for (const s of [BARE, CHOSEN]) expect(resolvedByAnyReader(s), s).toBe(true);
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the PLACEMENT family, now CLOSED — the positive, and every departure by name", () => {
    const family = legalAttackCorpus().filter(([, t]) => /put \d* ?damage counters/i.test(t));
    expect(family).toHaveLength(19);
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(38);
    const unbuilt = family.filter(([, t]) => !resolvedByAnyReader(t)).map(([, t]) => t);
    expect(family.every(([, t]) => resolvedByAnyReader(t))).toBe(true);
    expect(family.filter(([, t]) => resolvedByAnyReader(t))).toHaveLength(19);
    expect(family.filter(([, t]) => resolvedByAnyReader(t)).reduce((sum, [n]) => sum + n, 0)).toBe(
      38,
    );
    expect(unbuilt).toHaveLength(0);
    expect(family.filter(([, t]) => !resolvedByAnyReader(t)).reduce((sum, [n]) => sum + n, 0)).toBe(
      0,
    );

    const SCALED_TWIN =
      "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.";
    expect(unbuilt).not.toContain(SCALED_TWIN);
    expect(deriveAttackEffect(SCALED_TWIN)?.map((o) => o.op)).toEqual([
      "damageChosen",
      "discardPileRetrieval",
      "shuffleDeck",
    ]);
    // …and it is NOT this section's own program: the head shares `BARE`'s first eight
    // words, so the inequality is what a reader widened past the count clause reddens on.
    expect(deriveAttackEffect(SCALED_TWIN)).not.toEqual(deriveAttackEffect(BARE));
    // the head alone and the tail alone are BOTH unread — so even a collapsed rider
    // leaves the sentence unclaimed, because a whole-sentence anchor must read both.
    expect(
      deriveAttackEffect(
        "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile.",
      ),
    ).toBeNull();
    expect(deriveAttackEffect("Then, shuffle those Energy cards into your deck.")).toBeNull();
    expect(deriveAttackEffect("Shuffle those Energy cards into your deck.")).toBeNull();

    expect(unbuilt).not.toContain("Put 2 damage counters on each of your opponent's Pokémon.");
    expect(
      deriveAttackEffect("Put 2 damage counters on each of your opponent's Pokémon."),
    ).not.toEqual(deriveAttackEffect(BARE));
    expect(unbuilt).not.toContain(
      "Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it.",
    );
    expect(unbuilt).not.toContain(
      "Put 6 damage counters on each Pokémon that has an Ability (both yours and your opponent's).",
    );
    for (const s of [
      "Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is 100.",
      "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10.",
      "Put damage counters on your opponent's Active Pokémon until its remaining HP is 50.",
    ]) {
      expect(unbuilt, s).not.toContain(s);
      expect(deriveAttackEffect(s)?.[0]?.op, s).toBe("counterUntilRemainingHp");
    }
    expect(deriveAttackEffect(BARE)).not.toEqual(
      deriveAttackEffect(
        "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10.",
      ),
    );
    expect(unbuilt).not.toContain(
      "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.",
    );
    expect(
      deriveAttackEffect(
        "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.",
      ),
    ).toEqual([{ op: "applyStatus", target: "defender", status: "confused", confusionDamage: 80 }]);
    const bounded = legalAttackCorpus().filter(([, t]) => /put up to \d+ damage counters/i.test(t));
    expect(bounded).toHaveLength(1);
    expect(bounded[0]?.[0]).toBe(1);
    expect(resolvedByAnyReader(bounded[0]?.[1] as string)).toBe(false);
    for (const [text, program] of [
      [
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put 6 damage counters on the Attacking Pokémon.",
        [{ op: "installRecoil", amount: 60 }],
      ],
      [
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.",
        [{ op: "installRecoil", amount: "damageTaken" }],
      ],
    ] as const) {
      expect(unbuilt, text).not.toContain(text);
      // …and they are NOT this file's op, which is the claim the bullet was ever making
      // and the one the `toContain` could not survive the sentences being claimed.
      expect(deriveAttackEffect(text), text).toEqual(program);
      expect(deriveAttackEffect(text), text).not.toEqual(deriveAttackEffect(BARE));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the readers, and the four anchors that share this noun phrase.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — two arms, and the prefix that is the whole safety property", () => {
  it("reads the BARE sentence as a count-1 opponentAny PLACEMENT", () => {
    expect(deriveAttackEffect(BARE)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 20, count: 1, source: "attack" },
    ]);
  });

  it("reads the CHOOSE-FIRST sentence as the same op at the printed arity", () => {
    expect(deriveAttackEffect(CHOSEN)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 30, count: 2, source: "attack" },
    ]);
  });

  it("the COMPOUND still derives TWO ops — the new anchor is not a prefix of it", () => {
    expect(COMPOUND.startsWith(BARE.replace("2 damage", "9 damage"))).toBe(true);
    expect(deriveAttackEffect(COMPOUND)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 90, count: 1, source: "attack" },
      { op: "preventAttack" },
    ]);
    expect(deriveAttackEffect("Put 9 damage counters on 1 of your opponent's Pokémon.")).toEqual([
      (deriveAttackEffect(COMPOUND) as EffectOp[])[0],
    ]);
  });

  it("the four anchors on this noun phrase stay DISJOINT, each keeping its own op", () => {
    // One noun phrase, four readings, and the difference between each pair is a single
    // printed token. A looser pattern anywhere here collapses two of them silently.
    expect(deriveAttackEffect(ACTIVE_SIBLING)).toEqual([
      { op: "damageActive", amount: 20, source: "attack" },
    ]);
    expect(deriveAttackEffect(BENCH_SIBLING)).toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 20, count: 1, source: "attack" },
    ]);
    expect(deriveAttackEffect(BARE)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 20, count: 1, source: "attack" },
    ]);
    // the DISTRIBUTION (arm 23a) — N ops of 1 counter each, and it is the one that
    // shares this anchor's zone word while meaning something else entirely
    expect(
      deriveAttackEffect("Put 2 damage counters on your opponent's Pokémon in any way you like."),
    ).toHaveLength(2);
    // and the pairwise INEQUALITIES, which is what a shared-prefix family owes: none of
    // the four derives to any other's program.
    const programs = [ACTIVE_SIBLING, BENCH_SIBLING, BARE, CHOSEN].map((s) =>
      JSON.stringify(deriveAttackEffect(s)),
    );
    expect(new Set(programs).size).toBe(4);
  });

  it("refuses the near misses, each the resolving sentence with ONE token changed", () => {
    const NBSP = " ";
    for (const [why, text] of [
      // A printed 0 AMOUNT would park a real pick that places nothing.
      ["a printed 0 amount", "Put 0 damage counters on 1 of your opponent's Pokémon."],
      // A printed 0 ARITY would park a prompt asking for nothing.
      [
        "a printed 0 arity",
        "Choose 0 of your opponent's Pokémon and put 3 damage counters on each of them.",
      ],
      [
        "a printed 0 amount, choose-first",
        "Choose 2 of your opponent's Pokémon and put 0 damage counters on each of them.",
      ],
      // THE SEAT, dropped — the catastrophic miss: `target` has no own-side member for
      // the ANY zone, so a reader that lost "opponent's" could not even be expressed.
      ["the seat dropped", "Put 2 damage counters on 1 of your Pokémon."],
      [
        "the seat dropped, choose-first",
        "Choose 2 of your Pokémon and put 3 damage counters on each of them.",
      ],
      [
        "the zone word, choose-first",
        "Choose 2 of your opponent's Benched Pokémon and put 3 damage counters on each of them.",
      ],
      // "up to", a BOUNDED count — the op's `count` is EXACT by its own doc block.
      ["an up-to arity", "Put up to 2 damage counters on 1 of your opponent's Pokémon."],
      ["a lowercase verb", "put 2 damage counters on 1 of your opponent's Pokémon."],
      [
        "a lowercase verb, choose-first",
        "choose 2 of your opponent's Pokémon and put 3 damage counters on each of them.",
      ],
      // NO TRAILING PERIOD and a "!" — the `$` from both sides.
      ["no trailing period", "Put 2 damage counters on 1 of your opponent's Pokémon"],
      ["an exclamation", "Put 2 damage counters on 1 of your opponent's Pokémon!"],
      [
        "a leading flip",
        "Flip a coin. If heads, put 2 damage counters on 1 of your opponent's Pokémon.",
      ],
      // A TRAILING sentence the engine has never seen — the `$`'s reason for existing.
      [
        "an unknown remainder",
        "Put 2 damage counters on 1 of your opponent's Pokémon. Draw a card.",
      ],
      // NON-INTEGER and SIGNED counts — `\d+` takes neither, and a -2 would HEAL.
      ["a fractional amount", "Put 2.5 damage counters on 1 of your opponent's Pokémon."],
      ["a signed amount", "Put -2 damage counters on 1 of your opponent's Pokémon."],
      ["the singular noun", "Put 2 damage counter on 1 of your opponent's Pokémon."],
      // A NON-BREAKING SPACE, spelled as an escape: byte-different and invisible in a diff.
      ["a non-breaking space", `Put${NBSP}2 damage counters on 1 of your opponent's Pokémon.`],
      // An INTERIOR double space is not trimmable.
      ["an interior double space", "Put  2 damage counters on 1 of your opponent's Pokémon."],
      // The lookalike `Pokemon`.
      ["a lookalike Pokemon", "Put 2 damage counters on 1 of your opponent's Pokemon."],
      // The choose-first spelling with its JOIN re-worded — "and put" is the hinge.
      [
        "a reworded join",
        "Choose 2 of your opponent's Pokémon, then put 3 damage counters on each of them.",
      ],
      // …and its TAIL re-worded: "on each of them" is what makes the arity a fan-out.
      ["a reworded tail", "Choose 2 of your opponent's Pokémon and put 3 damage counters on them."],
      [
        "a bench shuffle",
        "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck. If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.",
      ],
      ["empty", ""],
    ] as const) {
      expect(deriveAttackEffect(text), why).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), so this states which
    // drift is tolerated and which is not.
    expect(deriveAttackEffect(`\t  ${BARE}\n`)).toEqual(deriveAttackEffect(BARE));
    expect(deriveAttackEffect(`\t  ${CHOSEN}\n`)).toEqual(deriveAttackEffect(CHOSEN));
  });

  it("D535 — corpus line 81 is BUILT, and it is THESE arms that must not claim it", () => {
    const PICK_WITH_REPLACEMENT =
      "Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance.";
    const ops = deriveAttackEffect(PICK_WITH_REPLACEMENT);
    expect(ops).toHaveLength(6);
    expect(ops?.[0]).toEqual({
      op: "damageChosen",
      target: "opponentAny",
      amount: 20,
      count: 1,
      source: "attack",
      deals: true,
      ignoreWR: true,
      wrOnly: true,
    });
    expect((ops ?? []).every((op) => (op as { deals?: true }).deals === true)).toBe(true);
    for (const text of [BARE, CHOSEN]) {
      const mine = deriveAttackEffect(text) ?? [];
      expect(
        mine.every((op) => (op as { deals?: true }).deals === undefined),
        text,
      ).toBe(true);
    }
    expect(legalAttackCorpus().filter(([, s]) => s === PICK_WITH_REPLACEMENT)).toEqual([
      [2, PICK_WITH_REPLACEMENT],
    ]);
  });

  it("D537 — corpus line 84 is BUILT, and it is THESE arms that must not claim it", () => {
    const KEEP_THREE =
      "Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck.";
    expect(deriveAttackEffect(KEEP_THREE)).toEqual([{ op: "returnBenchedRest", keep: 3 }]);
    expect((deriveAttackEffect(KEEP_THREE) ?? []).every((op) => op.op !== "damageChosen")).toBe(
      true,
    );
    for (const text of [BARE, CHOSEN]) {
      const mine = deriveAttackEffect(text) ?? [];
      expect(
        mine.every((op) => op.op === "damageChosen"),
        text,
      ).toBe(true);
    }
    expect(legalAttackCorpus().filter(([, s]) => s === KEEP_THREE)).toEqual([[2, KEEP_THREE]]);
  });

  it("D537 — the `toBeNull` table above is NOT VACUOUS: it still carries FOUR rows, MEASURED", () => {
    const REMAINING: readonly string[] = [
      "Choose 2 of your opponent's Pokémon, then put 3 damage counters on each of them.",
      "Choose 2 of your opponent's Pokémon and put 3 damage counters on them.",
      "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck. If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.",
      "",
    ];
    expect(REMAINING).toHaveLength(4);
    for (const text of REMAINING) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("derives the CURLY apostrophe identically on both new arms", () => {
    for (const s of [BARE, CHOSEN]) {
      const curly = s.replaceAll("'", "’");
      expect(curly).not.toBe(s);
      expect(deriveAttackEffect(curly), s).toEqual(deriveAttackEffect(s));
    }
  });

  it("accepts the unprinted counts, which is a claim about the GAME and not the INGEST", () => {
    expect(deriveAttackEffect("Put 1 damage counters on 1 of your opponent's Pokémon.")).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 10, count: 1, source: "attack" },
    ]);
    expect(
      deriveAttackEffect(
        "Choose 3 of your opponent's Pokémon and put 1 damage counters on each of them.",
      ),
    ).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 10, count: 3, source: "attack" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the persisted op, and the version prediction DRIVEN over the bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — a new PRODUCER of a shipped literal, and the record version does not move", () => {
  it("the version PREDICTION, driven over the SERIALIZED BYTES in THREE directions", () => {
    const fresh = deriveAttackEffect(BARE)?.[0] as EffectOp;
    expect(JSON.stringify(fresh)).toBe(
      '{"op":"damageChosen","target":"opponentAny","amount":20,"count":1,"source":"attack"}',
    );
    expect(Object.keys(fresh).sort()).toEqual(["amount", "count", "op", "source", "target"]);
    const shipped = (deriveAttackEffect(COMPOUND) as EffectOp[])[0] as EffectOp;
    expect(Object.keys(shipped).sort()).toEqual(Object.keys(fresh).sort());
    expect(roundTrip(fresh)).toEqual(fresh);

    // **DIRECTION 2 — BACKWARD. Every byte string a v29 deploy could have written still
    // resumes to exactly what its writer meant.** Three of them, spanning the two other
    // `target` members and both riders, revived and re-serialised unchanged.
    for (const bytes of [
      '{"op":"damageChosen","target":"opponentAny","amount":90,"count":1,"source":"attack"}',
      '{"op":"damageChosen","target":"opponentBench","amount":20,"count":1,"source":"attack"}',
      '{"op":"damageChosen","target":"opponentAny","amount":20,"count":1,"source":"attack","deals":true}',
    ]) {
      const revived = JSON.parse(bytes) as EffectOp;
      expect(JSON.stringify(revived)).toBe(bytes); // no key gained, none lost, order kept
    }
    // …and the first of those three IS the compound's stored op, so the backward claim is
    // about a record this engine really writes rather than a string typed here.
    expect(
      JSON.parse(
        '{"op":"damageChosen","target":"opponentAny","amount":90,"count":1,"source":"attack"}',
      ),
    ).toEqual(shipped);

    for (const key of ["op", "target", "amount", "count", "source"] as const) {
      const dropped = JSON.parse(
        JSON.stringify(fresh, (k, v) => (k === key ? undefined : v)),
      ) as Record<string, unknown>;
      expect(Object.keys(dropped)).not.toContain(key);
      expect(dropped).not.toEqual(fresh);
    }
    expect(JSON.stringify(deriveAttackEffect(CHOSEN)?.[0])).toBe(
      '{"op":"damageChosen","target":"opponentAny","amount":30,"count":2,"source":"attack"}',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the board: a placed counter is NOT damage, and the park is the op's own.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the placement is FLAT, and the control on the same body is not", () => {
  it("20 on a ×2 Lightning ACTIVE — and the CONTROL reads 40 on that same body", () => {
    const put = mustApply(fielded(1), { type: "attack", seat: "p1", index: IDX.bare });
    expect(findEvent(put.events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p2",
      amount: 20,
      source: "attack",
    });
    expect(findEvent(put.events, "DAMAGE_DEALT")).toBeUndefined();
    expect(put.state.players.p2.active?.damage).toBe(20);

    expect(deriveAttackEffect(DEALS_CONTROL)).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 20,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
    const control = mustApply(fielded(1), { type: "attack", seat: "p1", index: IDX.control });
    expect(findEvent(control.events, "DAMAGE_DEALT")).toMatchObject({
      base: 20,
      weakness: { op: "multiply", amount: 2 },
      dealt: 40,
    });
    expect(findEvent(control.events, "COUNTERS_PLACED")).toBeUndefined();
    expect(control.state.players.p2.active?.damage).toBe(40);
  });

  it("the EVENT is the reading: COUNTERS_PLACED carries `source`, DAMAGE_DEALT does not", () => {
    const { events } = mustApply(fielded(2), { type: "attack", seat: "p1", index: IDX.bare });
    const row = findEvent(events, "COUNTERS_PLACED");
    expect(row?.source).toBe("attack");
    expect(row?.source).not.toBe("ability");
  });

  it("a LONE Active FORCES the pick; a Bench makes it a real park", () => {
    const forced = mustApply(fielded(3), { type: "attack", seat: "p1", index: IDX.bare });
    expect(forced.state.phase.kind).not.toBe("effect:choose");
    expect(forced.state.players.p2.active?.damage).toBe(20);

    const { state: parked } = mustApply(fielded(3, { bench: ["fix-lightning-weak"] }), {
      type: "attack",
      seat: "p1",
      index: IDX.bare,
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    // the ACTIVE LEADS the candidate list (`oppAnyRefs`' order), so a forced board reads
    // naturally and the two spots are told apart here rather than assumed
    expect(prompt.candidates).toHaveLength(2);
    expect(prompt.candidates[0]).toMatchObject({ seat: "p2", spot: { spot: "active" } });
    expect(prompt.candidates[1]).toMatchObject({ seat: "p2", spot: { spot: "bench", index: 0 } });
    expect(prompt).toMatchObject({ min: 1, max: 1, declinable: false });
    // THE CAPTION QUOTES THE CARD, in counters and not HP — `snipeNote` divides by ten
    // on the placement path, and the zone word is dropped because `opponentAny` offers
    // the Active too.
    expect(prompt.note).toBe("Choose 1 of your opponent's Pokémon (2 damage counters each).");

    // BOTH picks on the SAME parked board, and both are FLAT: the Active takes 20 and
    // not 40, the Bench takes 20 with no W/R by construction (§8.5).
    const active = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(active.state.players.p2.active?.damage).toBe(20);
    expect(active.state.players.p2.bench[0]?.damage).toBe(0);
    const bench = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    expect(bench.state.players.p2.bench[0]?.damage).toBe(20);
    expect(bench.state.players.p2.active?.damage).toBe(0);
  });

  it("the CHOOSE-FIRST arity is TWO bodies at 3 counters each — a real 2-of-3 pick", () => {
    // The first `opponentAny` PLACEMENT at an arity above one, and the board that makes
    // the two captures distinguishable: 2 bodies × 30 HP, never 3 × 20.
    const { state: parked } = mustApply(
      fielded(4, { bench: ["fix-lightning-weak", "fix-lightning-weak"] }),
      { type: "attack", seat: "p1", index: IDX.chosen },
    );
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.candidates).toHaveLength(3);
    expect(prompt).toMatchObject({ min: 2, max: 2, declinable: false });
    expect(prompt.note).toBe("Choose 2 of your opponent's Pokémon (3 damage counters each).");
    // the pick spans the ACTIVE and a BENCH body in ONE answer — `placeSnipe`'s two arms
    // firing off one ref list, which no shipped producer of this op had ever reached
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "pokemonMulti",
        refs: [prompt.candidates[0] as PokemonRef, prompt.candidates[2] as PokemonRef],
      },
    });
    expect(done.state.players.p2.active?.damage).toBe(30); // FLAT on the ×2 body
    expect(done.state.players.p2.bench[1]?.damage).toBe(30);
    expect(done.state.players.p2.bench[0]?.damage).toBe(0);
    expect(done.events.filter((e) => e.type === "COUNTERS_PLACED")).toHaveLength(2);
  });

  it("§8.6 — a board with FEWER bodies than the printed arity takes them all, unprompted", () => {
    const { state, events } = mustApply(fielded(5, { bench: ["fix-lightning-weak"] }), {
      type: "attack",
      seat: "p1",
      index: IDX.chosen,
    });
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(events.filter((e) => e.type === "COUNTERS_PLACED")).toHaveLength(2);
    expect(state.players.p2.active?.damage).toBe(30);
    expect(state.players.p2.bench[0]?.damage).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — §11: which of the two printed shields refuses a PLACED counter.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the prevention gate, on the axis the two printed spellings actually divide", () => {
  it("the EFFECTS shield REFUSES the placement — and the DAMAGE shield does not", () => {
    const shielded = mustApply(fielded(6, { defender: "fix-unaware" }), {
      type: "attack",
      seat: "p1",
      index: IDX.bare,
    });
    expect(findEvent(shielded.events, "ATTACK_EFFECT_PREVENTED")).toMatchObject({ seat: "p2" });
    expect(findEvent(shielded.events, "COUNTERS_PLACED")).toBeUndefined();
    expect(shielded.state.players.p2.active?.damage).toBe(0);
    // …and the SAME shield does NOT stop the `deals` control, because that one IS damage
    // and this sentence's own parenthetical says damage is not an effect.
    const shieldedControl = mustApply(fielded(6, { defender: "fix-unaware" }), {
      type: "attack",
      seat: "p1",
      index: IDX.control,
    });
    expect(findEvent(shieldedControl.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 20 });
    expect(shieldedControl.state.players.p2.active?.damage).toBe(20);

    // `sv03-078` Bellibolt — "Prevent all DAMAGE done to this Pokémon by attacks from
    // your opponent's {L} Pokémon." The attacker is {L}, so the clause is ARMED: it
    // prevents the control outright and must not touch the placement.
    const damageShield = mustApply(fielded(7, { defender: "sv03-078" }), {
      type: "attack",
      seat: "p1",
      index: IDX.bare,
    });
    expect(findEvent(damageShield.events, "COUNTERS_PLACED")).toMatchObject({ amount: 20 });
    expect(findEvent(damageShield.events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
    expect(damageShield.state.players.p2.active?.damage).toBe(20);
    const damageShieldControl = mustApply(fielded(7, { defender: "sv03-078" }), {
      type: "attack",
      seat: "p1",
      index: IDX.control,
    });
    expect(findEvent(damageShieldControl.events, "DAMAGE_DEALT")).toMatchObject({
      prevented: true,
      dealt: 0,
    });
    expect(damageShieldControl.state.players.p2.active?.damage).toBe(0);
  });

  it("the refusal is at the ACTIVE arm, which is `damageActive` REUSED rather than re-implemented", () => {
    const viaSpot = mustApply(fielded(8, { defender: "fix-unaware" }), {
      type: "attack",
      seat: "p1",
      index: IDX.bare,
    });
    expect(viaSpot.events.map((e) => e.type)).toContain("ATTACK_EFFECT_PREVENTED");
    const { state: parked } = mustApply(
      fielded(8, { defender: "fix-unaware", bench: ["fix-unaware"] }),
      { type: "attack", seat: "p1", index: IDX.bare },
    );
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    // the shielded BENCH body is still OFFERED — the funnel answers "which bodies does
    // the card name", not "which may be touched right now"
    expect(prompt.candidates).toHaveLength(2);
    const onBench = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    expect(onBench.state.players.p2.bench[0]?.damage).toBe(0);
    expect(findEvent(onBench.events, "ATTACK_EFFECT_PREVENTED")).toMatchObject({ seat: "p2" });
    expect(findEvent(onBench.events, "COUNTERS_PLACED")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the Knock Out: the Prize is paid, and the cause is DAMAGE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — a lethal placement Knocks Out, pays a Prize, and counts as damage", () => {
  it("the placement KOs the Active and the attacker is owed a Prize", () => {
    const state = setDamage(fielded(9), "p2", 120); // 130 HP at 120 → 20 is exactly lethal
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: IDX.bare,
    });
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "COUNTERS_PLACED",
      "KNOCKED_OUT",
      "PRIZES_OWED",
    ]);
    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    expect(findEvent(events, "PRIZES_OWED")).toMatchObject({ seat: "p1", count: 1 });
    // …and the flow really stops on the Prize rather than ending the turn through it
    expect(after.phase.kind).toBe("ko:takePrizes");
  });

  it("the KO is BY DAMAGE, and Vengeful Punch is where D414's marker is observable", () => {
    let state = fielded(10);
    state = attachToolFromDeck(state, "p2", "active", "sv03-197");
    state = setDamage(state, "p2", 120);
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: IDX.bare,
    });
    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    // 4 damage counters = 40 HP, back onto the ATTACKER
    expect(after.players.p1.active?.damage).toBe(40);
    expect(events.filter((e) => e.type === "COUNTERS_PLACED")).toHaveLength(2);
  });

  it("a BENCH body finished off by the choose-first pick KOs and prizes too", () => {
    // The same claim through the OTHER arm and the OTHER zone, because a mid-turn bench
    // KO is a different seam from the Active one (no promotion is queued).
    let state = fielded(11, { bench: ["fix-lightning-weak", "fix-lightning-weak"] });
    state = setBenchDamage(state, "p2", 0, 100); // 130 HP at 100 → 30 is exactly lethal
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: IDX.chosen });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: after, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "pokemonMulti",
        refs: [prompt.candidates[1] as PokemonRef, prompt.candidates[2] as PokemonRef],
      },
    });
    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    expect(findEvent(events, "PRIZES_OWED")).toMatchObject({ seat: "p1", count: 1 });
    // the SURVIVING pick keeps its 30, so the KO did not swallow the other placement
    expect(after.players.p2.bench.map((b) => b.damage)).toEqual([30]);
  });
});

/** Event type names in order — a local spelling of `testFixtures`' `types`, kept here
    so this file's one ordering claim reads beside the assertion that uses it. */
function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

describe("§7 — the attack really is the turn's last action", () => {
  it("refuses a second attack after the placement resolves", () => {
    const { state } = mustApply(fielded(12), { type: "attack", seat: "p1", index: IDX.bare });
    const again = applyAction(state, { type: "attack", seat: "p1", index: IDX.bare });
    expect(again.ok).toBe(false);
  });
});
