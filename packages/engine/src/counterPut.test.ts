import { describe, expect, it } from "vitest";
import { deriveAttackEffect, programFor } from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  COUNTER_PUT_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

const SCALED_PILE_TWIN =
  "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.";

const CLAUSES = [
  { id: "sv02-097", card: "Mimikyu", attack: "Ghost Eye", index: 0, counters: 7, hp: 70 },
  { id: "sv03-098", card: "Polteageist", attack: "Pour Tea", index: 1, counters: 5, hp: 50 },
] as const;

function clauseText(counters: number): string {
  return `Put ${counters} damage counters on your opponent's Active Pokémon.`;
}

function putOp(hp: number): EffectOp {
  return { op: "damageActive", amount: hp, source: "attack" };
}

const NEAR_MISSES = [
  "Put up to 9 damage counters on this Pokémon. This attack does 20 damage for each damage counter you placed in this way.",
  "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10. If you placed any damage counters in this way, this attack also does 120 damage to this Pokémon.",
  "If your opponent's Active Pokémon has 4 or more damage counters on it, that Pokémon is Knocked Out.",
  "Put 1 damage counter on each of your opponent's Pokémon for each of your Maushold in play.",
  "Put 3 damage counters on each of your opponent's Benched Pokémon that has any damage counters on it.",
  "Once during your turn, if this Pokémon has any {D} Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon.",
  "Once during your turn, you may put 5 damage counters on this Pokémon. If you do, during this turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
] as const;

const REPOINTED_WITNESS_IDS = ["svp-089", "sv05-041"] as const;

const COUNTER_MOVE_CLAUSE =
  "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.";

const RSQUO = "’";

/** U+00A0. Byte-different from an ASCII space and INVISIBLE in a diff, which is
    exactly why the case names it instead of carrying it. */
const NBSP = " ";

const GHOST_EYE_INDEX = 0;
const GHOST_EYE_HP = 70;
/** Pour Tea is at INDEX 1 — index 0 is "Antique Collecting", the control. */
const ANTIQUE_COLLECTING_INDEX = 0;
const POUR_TEA_INDEX = 1;
const POUR_TEA_HP = 50;

/** The defender's damage BEFORE the placement, on the boards that measure an
    addition rather than a bare hit — so the assertion is `before + placed` and not
    just `placed`. Not a multiple of 70 or 50, so no sum is reachable two ways. */
const DEFENDER_HURT = 40;

/** fix-titan is 340 HP: 280 + GHOST_EYE_HP is exactly 350, so the placement is
    what tips it over. Written against the printed HP, not as a magic number. */
const TITAN_HP = 340;
const DEFENDER_NEARLY_DEAD = 280;

/** Both flat-placement bodies are 200 HP, which survives every reading a wrong
    build could produce (140 doubled, 40 resisted, 70 flat) — so those two cases
    measure the AMOUNT and never a promotion. */
const FLAT_DEFENDER_HP = 200;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function board(): GameState {
  let state = driveSetup(7, { p1: COUNTER_PUT_DECK, p2: COUNTER_PUT_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return clearBench(clearBench(state, "p1"), "p2");
}

/** Field Mimikyu as `seat`'s Active with two {P} attached — Ghost Eye's cost is
    {P}{C} and a Psychic Energy pays the {C} as any Energy does. It is a Basic, so
    the surgery is a convenience; the bench clear after it is not. */
function mimikyuActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, "sv02-097"), seat),
    seat,
    "fix-psychic-energy",
    2,
  );
}

function polteageistActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, "sv03-098"), seat),
    seat,
    "fix-psychic-energy",
    1,
  );
}

/** Declare `index` on `seat`, freezing the prior state first — the purity check
    every neighbouring suite runs, hoisted here because this file drives a dozen. */
function declare(
  state: GameState,
  index: number,
  seat: Seat = "p1",
): { state: GameState; events: GameEvent[] } {
  deepFreeze(state);
  return mustApply(state, { type: "attack", seat, index });
}

describe("the anchor — 2 printings, 2 clauses, one regex with one (\\d+) capture", () => {
  it("derives BOTH printed clauses, and the amount is HP rather than counters", () => {
    for (const { counters, hp } of CLAUSES) {
      expect(deriveAttackEffect(clauseText(counters))).toEqual([putOp(hp)]);
    }
    const ops = deriveAttackEffect(clauseText(7));
    expect(ops).toHaveLength(1);
    expect(Object.keys(ops?.[0] as object).sort()).toEqual(["amount", "op", "source"]);
    expect(CLAUSES).toHaveLength(2);
    expect(new Set(CLAUSES.map((c) => c.id)).size).toBe(2);
    expect(new Set(CLAUSES.map((c) => c.counters)).size).toBe(2);
  });

  it("CONVERTS counters → HP, and fails at a factor of ten in EITHER direction", () => {
    for (const { counters, hp } of CLAUSES) {
      const derived = deriveAttackEffect(clauseText(counters));
      expect(derived).toEqual([{ op: "damageActive", amount: counters * 10, source: "attack" }]);
      expect(derived).not.toEqual([{ op: "damageActive", amount: counters, source: "attack" }]);
      expect(derived).not.toEqual([
        { op: "damageActive", amount: counters * 100, source: "attack" },
      ]);
      expect(hp).toBe(counters * 10);
    }
    expect(deriveAttackEffect(clauseText(7))).not.toEqual(deriveAttackEffect(clauseText(5)));
    expect(deriveAttackEffect(clauseText(1))).toEqual([putOp(10)]);
    expect(deriveAttackEffect(clauseText(13))).toEqual([putOp(130)]);
  });

  it("is the SAME op the registry authors for Trevenant, differing only in `source`", () => {
    const authored = programFor("sv03-012")?.triggered?.[0];
    expect(authored?.name).toBe("Forest Miasma");
    expect(authored?.program).toEqual([{ op: "damageActive", amount: 10, source: "ability" }]);
    const authoredOp = authored?.program?.[0] as { op: string; amount: number; source: string };
    expect(deriveAttackEffect(clauseText(1))).toEqual([{ ...authoredOp, source: "attack" }]);
    expect(Object.keys(authoredOp).sort()).toEqual(
      Object.keys(deriveAttackEffect(clauseText(1))?.[0] as object).sort(),
    );
  });

  it("refuses the SEVEN real catalog rows that share its words", () => {
    for (const text of NEAR_MISSES) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    expect(deriveAttackEffect(NEAR_MISSES[1])).toBeNull();
    expect(deriveAttackEffect(NEAR_MISSES[0])).toBeNull();
    const abilities = NEAR_MISSES.filter((t) => t.startsWith("Once during your turn"));
    expect(abilities).toHaveLength(2);
    for (const ability of abilities) expect(deriveAttackEffect(ability), ability).toBeNull();
    const tailWitness = abilities.filter((t) => t.includes("attacks used by this Pokémon do"));
    expect(tailWitness).toHaveLength(1);
    expect(deriveAttackEffect(tailWitness[0] ?? "")).toBeNull();
    for (const fold of [
      "Put 2 damage counters on each of your opponent's Pokémon.",
      "Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it.",
    ]) {
      expect(deriveAttackEffect(fold), fold).not.toEqual(deriveAttackEffect(clauseText(2)));
      expect(deriveAttackEffect(fold)?.[0]?.op, fold).toBe("counterEachAll");
    }
    expect(deriveAttackEffect(clauseText(2))?.[0]?.op).toBe("damageActive");

    const HP_TARGET =
      "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10.";
    expect(deriveAttackEffect(HP_TARGET)).toEqual([
      {
        op: "counterUntilRemainingHp",
        target: "opponentActive",
        remainingHp: 10,
        source: "attack",
      },
    ]);
    expect(deriveAttackEffect(HP_TARGET)).not.toEqual(deriveAttackEffect(clauseText(1)));
    // …and the printed 10 is HP, NOT counters: `damageActive` at a printed 10 carries
    // `amount: 100` and the HP target carries `remainingHp: 10`. The two numbers read
    // the same on the page and mean different things, which is the whole §12 hazard.
    expect(deriveAttackEffect("Put 10 damage counters on your opponent's Active Pokémon.")).toEqual(
      [{ op: "damageActive", amount: 100, source: "attack" }],
    );

    expect(deriveAttackEffect(SCALED_PILE_TWIN)).not.toEqual(deriveAttackEffect(clauseText(2)));
    expect(deriveAttackEffect(SCALED_PILE_TWIN)?.map((o) => o.op)).toEqual([
      "damageChosen",
      "discardPileRetrieval",
      "shuffleDeck",
    ]);
    expect(NEAR_MISSES).toHaveLength(7);

    for (const id of REPOINTED_WITNESS_IDS) {
      expect(programFor(id)?.abilities?.[0]?.name, `${id} is the retired witness, now built`).toBe(
        "Torrential Heart",
      );
    }
  });

  it("pins how Ting-Lu ex's Bench PUT resolved — the note, then the fix", () => {
    expect(
      deriveAttackEffect("Put 2 damage counters on 1 of your opponent's Benched Pokémon."),
    ).toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 20, count: 1, source: "attack" },
    ]);
    expect(programFor("sv02-127")).toBeDefined();
    expect(programFor("sv02-127")?.attack).toBeUndefined();
    expect(programFor("sv02-015")?.abilities?.[0]?.program).toContainEqual(
      expect.objectContaining({ op: "damageChosen", target: "opponentBench", source: "ability" }),
    );
    expect(programFor("sv02-015")?.abilities?.[0]?.program?.[1]).not.toHaveProperty("deals");
  });

  it("stays disjoint from the SIBLING anchor in BOTH directions", () => {
    expect(deriveAttackEffect(COUNTER_MOVE_CLAUSE)).toEqual([{ op: "moveCountersToDefender" }]);
    expect(deriveAttackEffect(COUNTER_MOVE_CLAUSE)).not.toContainEqual(
      expect.objectContaining({ op: "damageActive" }),
    );
    expect(deriveAttackEffect(clauseText(7))).toEqual([putOp(GHOST_EYE_HP)]);
    expect(deriveAttackEffect(clauseText(7))).not.toContainEqual(
      expect.objectContaining({ op: "moveCountersToDefender" }),
    );
    // …and the two sentences really do differ only at the front, which is what makes
    // the disjointness a claim about the FIRST WORD rather than a coincidence of two
    // unrelated strings.
    expect(COUNTER_MOVE_CLAUSE.endsWith("to your opponent's Active Pokémon.")).toBe(true);
    expect(clauseText(7).endsWith("on your opponent's Active Pokémon.")).toBe(true);
  });

  it("refuses the anchor, punctuation, case and token rewrites — but trims outer space", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Put 7 damage counters on your opponent's Active Pokémon",
      // "!" for "." — the same one-character difference from the other side.
      "Put 7 damage counters on your opponent's Active Pokémon!",
      "put 7 damage counters on your opponent's Active Pokémon.",
      "Put 7 damage counter on your opponent's Active Pokémon.",
      // NO COUNT AT ALL — Alolan Raticate's opening, and the reading this anchor
      // must not invent a number for.
      "Put damage counters on your opponent's Active Pokémon.",
      "Put up to 7 damage counters on your opponent's Active Pokémon.",
      // A NON-INTEGER and a SIGNED count — `\d+` takes neither, and a placement of
      // -7 would HEAL the defender.
      "Put 7.5 damage counters on your opponent's Active Pokémon.",
      "Put -7 damage counters on your opponent's Active Pokémon.",
      "Put 7 damage counters on your opponent's Benched Pokémon.",
      "Put 7 damage counters on your Active Pokémon.",
      // THE SEAT, dropped. "your Active Pokémon" above is the controller's; this one
      // names no seat at all.
      "Put 7 damage counters on the Active Pokémon.",
      // A NON-BREAKING SPACE where an ASCII one is printed. Spelled as an ESCAPE,
      // not typed: byte-different from a space and INVISIBLE in a diff.
      `Put${NBSP}7 damage counters on your opponent's Active Pokémon.`,
      // An INTERIOR double space is not trimmable.
      "Put  7 damage counters on your opponent's Active Pokémon.",
      "Flip a coin. If heads, put 7 damage counters on your opponent's Active Pokémon.",
      "Put 7 damage counters on your opponent's Active Pokémon. This Pokémon is now Asleep.",
      // Empty.
      "",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), so this states which
    // drift is tolerated and which is not.
    expect(deriveAttackEffect(`\t  ${clauseText(7)}\n`)).toEqual([putOp(GHOST_EYE_HP)]);
  });

  it("D449 — the ANY-ZONE rewrite derives a DIFFERENT OP, which is the claim it always made", () => {
    const anyZone = "Put 7 damage counters on 1 of your opponent's Pokémon.";
    expect(deriveAttackEffect(anyZone)).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: GHOST_EYE_HP,
        count: 1,
        source: "attack",
      },
    ]);
    expect(deriveAttackEffect(anyZone)).not.toEqual(deriveAttackEffect(clauseText(7)));
    expect(deriveAttackEffect(anyZone)).not.toContainEqual(
      expect.objectContaining({ op: "damageActive" }),
    );
    // …and the AMOUNT agrees across the two anchors, so the inequality above is about
    // the TARGET and nothing else — the one-axis discipline this file already uses for
    // its `DEFENDER_PUT_CLAUSE` pair.
    expect(deriveAttackEffect(clauseText(7))).toEqual([putOp(GHOST_EYE_HP)]);
  });

  it("D450 — the EACH-OF rewrite derives a FOLD, which is the claim it always made", () => {
    const fold = "Put 7 damage counters on each of your opponent's Pokémon.";
    expect(deriveAttackEffect(fold)).toEqual([
      {
        op: "counterEachAll",
        amount: GHOST_EYE_HP,
        filter: { kind: "anyPokemon" },
        side: "opponent",
        source: "attack",
      },
    ]);
    expect(deriveAttackEffect(fold)).not.toEqual(deriveAttackEffect(clauseText(7)));
    expect(deriveAttackEffect(fold)).not.toContainEqual(
      expect.objectContaining({ op: "damageActive" }),
    );
    // …and the AMOUNT agrees across the two anchors, so the inequality is about the
    // TARGET alone — this file's standing one-axis discipline.
    expect(deriveAttackEffect(fold)?.[0]).toMatchObject({ amount: GHOST_EYE_HP });
  });

  it("refuses a printed ZERO but ACCEPTS the ungrammatical singular count", () => {
    expect(deriveAttackEffect(clauseText(0))).toBeNull();
    expect(deriveAttackEffect(clauseText(1))).toEqual([putOp(10)]);
    expect(deriveAttackEffect(clauseText(999))).toEqual([putOp(9990)]);
    // No CEILING either: the op only RAISES damage and the epilogue's sweep resolves
    // whatever it Knocks Out, so a malformed count KOs the defender and stops —
    // a legal board state rather than a runaway.
  });

  it("derives the CURLY apostrophe identically — D137's class, not D137's fold", () => {
    for (const { counters, hp } of CLAUSES) {
      const straight = clauseText(counters);
      const curly = straight.replaceAll("'", RSQUO);
      expect(curly).not.toBe(straight);
      expect(curly).toContain(RSQUO);
      expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(straight));
      expect(deriveAttackEffect(curly)).toEqual([putOp(hp)]);
    }
  });
});

describe("the fixtures' printed text — every claim on the resume point, checked", () => {
  it("pins Mimikyu sv02-097 — GHOST EYE, {P}{C}, 7 counters, and NO damage field", () => {
    // On the deriver path a one-character drift un-simulates the card with no other
    // failure anywhere, so the bytes get pinned here — and the resume point's four
    // catalog claims (id, attack NAME, amount, Energy cost) are exactly these bytes.
    const ghostEye = FIXTURE_POOL["sv02-097"]?.attacks?.[GHOST_EYE_INDEX];
    expect(ghostEye).toEqual({
      cost: ["Psychic", "Colorless"],
      name: "Ghost Eye",
      effect: clauseText(7),
    });
    expect(ghostEye?.damage).toBeUndefined();
    expect(deriveAttackEffect(ghostEye?.effect ?? "")).toEqual([putOp(GHOST_EYE_HP)]);
    expect(FIXTURE_POOL["sv02-097"]?.name).toBe("Mimikyu");
    expect(FIXTURE_POOL["sv02-097"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv02-097"]?.hp).toBe(70);
    // ONE attack only — a second one would make GHOST_EYE_INDEX a coincidence.
    expect(FIXTURE_POOL["sv02-097"]?.attacks).toHaveLength(1);
  });

  it("pins Polteageist sv03-098 — POUR TEA at INDEX 1, {P}, 5 counters, no damage", () => {
    const pourTea = FIXTURE_POOL["sv03-098"]?.attacks?.[POUR_TEA_INDEX];
    expect(pourTea).toEqual({
      cost: ["Psychic"],
      name: "Pour Tea",
      effect: clauseText(5),
    });
    expect(pourTea?.damage).toBeUndefined();
    expect(deriveAttackEffect(pourTea?.effect ?? "")).toEqual([putOp(POUR_TEA_HP)]);
    expect(FIXTURE_POOL["sv03-098"]?.stage).toBe("Stage1");
    expect(FIXTURE_POOL["sv03-098"]?.evolveFrom).toBe("Sinistea");
    expect(POUR_TEA_INDEX).toBe(1);
    expect(FIXTURE_POOL["sv03-098"]?.attacks?.[ANTIQUE_COLLECTING_INDEX]?.name).toBe(
      "Antique Collecting",
    );
  });

  it("keeps Polteageist's INDEX 0 loud — one card, the same first word, two fates", () => {
    const antique = FIXTURE_POOL["sv03-098"]?.attacks?.[ANTIQUE_COLLECTING_INDEX];
    expect(antique?.effect?.startsWith("Put ")).toBe(true);
    expect(deriveAttackEffect(antique?.effect ?? "")).toBeNull();
    expect(deriveAttackEffect(antique?.effect ?? "")).not.toEqual(
      deriveAttackEffect(clauseText(5)),
    );
  });

  it("costs ZERO registry ATTACK rows — and Mimikyu proves it the hard way", () => {
    for (const { id } of CLAUSES) {
      expect(programFor(id)?.attack).toBeUndefined();
    }
    expect(programFor("sv02-097")).toBeDefined();
    expect(programFor("sv02-097")?.passive).toEqual({ preventDamageFromExV: true });
    expect(programFor("sv03-098")).toBeUndefined();
  });
});

describe("end to end — the placement, at two counts and from both seats", () => {
  it("places SEVENTY on the defender for Mimikyu's printed SEVEN — in one action", () => {
    let state = mimikyuActive(board(), "p1");
    state = setDamage(state, "p2", DEFENDER_HURT);
    const defender = activeUid(state, "p2");
    const { state: done, events } = declare(state, GHOST_EYE_INDEX);

    expect(all(events, "COUNTERS_PLACED")).toEqual([
      {
        type: "COUNTERS_PLACED",
        seat: "p2",
        uid: defender,
        amount: GHOST_EYE_HP,
        source: "attack",
      },
    ]);
    expect(done.players.p2.active?.damage).toBe(DEFENDER_HURT + GHOST_EYE_HP);
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    // NO PARK — "your opponent's Active Pokémon" is not a choice, so the whole
    // declaration lands in ONE batch and the §5.3 tail runs behind it.
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "COUNTERS_PLACED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
    // The ATTACKER is untouched: this sentence has no cost and no recoil.
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("places FIFTY for Polteageist's printed FIVE — the conversion, not a constant", () => {
    let state = polteageistActive(board(), "p1");
    state = setDamage(state, "p2", DEFENDER_HURT);
    const defender = activeUid(state, "p2");
    const { state: done, events } = declare(state, POUR_TEA_INDEX);

    expect(all(events, "COUNTERS_PLACED")).toEqual([
      { type: "COUNTERS_PLACED", seat: "p2", uid: defender, amount: POUR_TEA_HP, source: "attack" },
    ]);
    expect(done.players.p2.active?.damage).toBe(DEFENDER_HURT + POUR_TEA_HP);
    expect(done.players.p2.active?.damage).not.toBe(DEFENDER_HURT + GHOST_EYE_HP);
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("runs from the OTHER SEAT too — the row's `seat` is derived, not hardcoded", () => {
    let state = board();
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = mimikyuActive(state, "p2");
    state = setDamage(state, "p1", DEFENDER_HURT);
    const defender = activeUid(state, "p1");
    const { state: done, events } = declare(state, GHOST_EYE_INDEX, "p2");

    expect(find(events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p1",
      uid: defender,
      amount: GHOST_EYE_HP,
      source: "attack",
    });
    expect(done.players.p1.active?.damage).toBe(DEFENDER_HURT + GHOST_EYE_HP);
    // …and the attacker's OWN side took nothing, which is the mirror of the p1 case
    // and the assertion a seat-swapped build fails.
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("consumes NO rng — no coin, no shuffle, nothing random in the sentence", () => {
    const state = mimikyuActive(board(), "p1");
    const { state: done } = declare(state, GHOST_EYE_INDEX);
    expect(done.rngState).toBe(state.rngState);
  });
});

describe("the placement is FLAT — from BOTH sides of §8.5", () => {
  it("skips WEAKNESS — a ×2 Psychic defender takes 70, not 140", () => {
    let state = mimikyuActive(board(), "p1");
    state = setActiveFromDeck(state, "p2", "fix-psychic-weak-big");
    state = clearBench(state, "p2");
    expect(FIXTURE_POOL["fix-psychic-weak-big"]?.weaknesses).toEqual([
      { type: "Psychic", value: "×2" },
    ]);
    expect(FIXTURE_POOL["sv02-097"]?.types).toEqual(["Psychic"]);

    const { state: done, events } = declare(state, GHOST_EYE_INDEX);
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(GHOST_EYE_HP);
    expect(done.players.p2.active?.damage).toBe(GHOST_EYE_HP);
    expect(done.players.p2.active?.damage).not.toBe(GHOST_EYE_HP * 2);
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    // The body survives BOTH readings, so this case measures the amount and never a
    // promotion.
    expect(FLAT_DEFENDER_HP).toBeGreaterThan(GHOST_EYE_HP * 2);
    expect(FIXTURE_POOL["fix-psychic-weak-big"]?.hp).toBe(FLAT_DEFENDER_HP);
  });

  it("skips RESISTANCE too — a Psychic −30 defender takes 70, not 40", () => {
    let state = mimikyuActive(board(), "p1");
    state = setActiveFromDeck(state, "p2", "fix-psychic-resist-big");
    state = clearBench(state, "p2");
    expect(FIXTURE_POOL["fix-psychic-resist-big"]?.resistances).toEqual([
      { type: "Psychic", value: "-30" },
    ]);
    expect(FIXTURE_POOL["fix-psychic-resist-big"]?.weaknesses).toBeNull();

    const { state: done, events } = declare(state, GHOST_EYE_INDEX);
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(GHOST_EYE_HP);
    expect(done.players.p2.active?.damage).toBe(GHOST_EYE_HP);
    expect(done.players.p2.active?.damage).not.toBe(GHOST_EYE_HP - 30);
    expect(types(events)).not.toContain("DAMAGE_DEALT");
  });
});

describe("the KNOCK OUT it can cause — the epilogue sweep, with no park in front of it", () => {
  it("KOs the defender INLINE — prize to the ATTACKER, and the turn does NOT end", () => {
    let state = mimikyuActive(board(), "p1");
    state = setDamage(state, "p2", DEFENDER_NEARLY_DEAD);
    state = benchFromDeck(state, "p2", "fix-titan"); // somebody to promote into
    const defender = activeUid(state, "p2");
    expect(DEFENDER_NEARLY_DEAD + GHOST_EYE_HP).toBeGreaterThanOrEqual(TITAN_HP);

    const { state: done, events } = declare(state, GHOST_EYE_INDEX);

    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "COUNTERS_PLACED",
      "KNOCKED_OUT",
      "PRIZES_OWED",
    ]);
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: defender });
    expect(find(events, "PRIZES_OWED")).toEqual({ type: "PRIZES_OWED", seat: "p1", count: 1 });
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    // …and the turn has NOT ended: the prize pick and the opponent's promotion are
    // both still in front of §5.3's tail.
    expect(types(events)).not.toContain("TURN_ENDED");
  });

  it("stops ONE point short and does not KO — the boundary, not just the crossing", () => {
    // The complement, and it is worth its own case: a build that swept on
    // "damage >= hp - 10" (a counters-vs-HP confusion in the KO check rather than in
    // the reader) passes the case above and Knocks this body out too.
    let state = mimikyuActive(board(), "p1");
    state = setDamage(state, "p2", TITAN_HP - GHOST_EYE_HP - 10);
    const { state: done, events } = declare(state, GHOST_EYE_INDEX);

    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(done.players.p2.active?.damage).toBe(TITAN_HP - 10);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });
});

describe("the log — an ATTACK's placement must not be labelled an Ability", () => {
  it("renders a SYSTEM row in the printed verb, and never the word Ability", () => {
    let state = mimikyuActive(board(), "p1");
    state = setDamage(state, "p2", DEFENDER_HURT);
    const { state: done, events } = declare(state, GHOST_EYE_INDEX);
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state: done, elapsed: "+00:11" };
    const rendered = logFromEvents(events, ctx).flatMap((entry) =>
      entry.kind === "turn"
        ? []
        : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
    );

    const placed = rendered.find((r) => r.text.startsWith("Put:"));
    expect(placed).toBeDefined();
    expect(placed?.who).toBe("system");
    expect(placed?.text).toContain(String(GHOST_EYE_HP));
    // THE LABEL A REUSED SOURCE MEMBER WOULD HAVE PRINTED. This is the assertion that
    // fails the moment somebody "simplifies" the field away.
    expect(placed?.text).not.toContain("Ability");
    const declared = rendered.find((r) => r.text.includes("Ghost Eye"));
    expect(declared?.who).toBe("p1");
    expect(rendered.indexOf(declared as (typeof rendered)[number])).toBeLessThan(
      rendered.indexOf(placed as (typeof rendered)[number]),
    );
  });

  it("still renders TREVENANT's placement as an Ability row — the other producer", () => {
    const authored = programFor("sv03-012")?.triggered?.[0]?.program?.[0];
    expect(authored).toEqual({ op: "damageActive", amount: 10, source: "ability" });
    const state = board();
    const uid = activeUid(state, "p2");
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:11" };
    const [entry] = logFromEvents(
      [{ type: "COUNTERS_PLACED", seat: "p2", uid, amount: 10, source: "ability" }],
      ctx,
    );
    const text = entry?.kind === "turn" ? "" : (entry?.segments.map((s) => s.text).join("") ?? "");
    expect(text.startsWith("Ability:")).toBe(true);
    expect(text.startsWith("Put:")).toBe(false);
  });
});
