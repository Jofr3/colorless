import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackRequirement,
} from "./effects";
import type { BoardCondition, GameState } from "./index";
import { conditionHolds, conditionNote } from "./boardCondition";
import {
  BENCH_NAME_SUBSTRING_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

const TAKEN =
  'If a Pokémon that has "Nidoking" in its name is on your Bench, this attack does 120 more damage.';
const TAKEN_CLAUSE = 'a Pokémon that has "Nidoking" in its name is on your Bench';

const SUBSTRING: BoardCondition = { kind: "yourBenchHasNameContaining", fragment: "Nidoking" };
/** …and the EQUALITY member one line up in the union, at the same printed token.
    Every board below is asked BOTH, because the finding is where they disagree. */
const EQUALITY: BoardCondition = { kind: "yourBenchHasNamed", name: "Nidoking" };

// ── boards ─────────────────────────────────────────────────────────────────────

function ready(seed: number, bench: readonly string[] = []): GameState {
  let state = driveSetup(
    seed,
    { p1: BENCH_NAME_SUBSTRING_DECK, p2: BENCH_NAME_SUBSTRING_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p1", "fix-loveimpact");
  state = attachFromDeck(state, "p1", "fix-dark-energy", 2);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  return state;
}

/** …the same board handed to P1 with the turn already passed. P1 went SECOND, so
    this turn carries no §4 attack restriction. */
function armed(seed: number, bench: readonly string[] = []): GameState {
  return mustApply(ready(seed, bench), { type: "endTurn", seat: "p2" }).state;
}

/** Attack at `index` — **0** is the printed "Love Impact" and **1** the printed
    control "Mega Kick" — and report the damage actually dealt. */
function damageDealt(state: GameState, index = 0): number {
  const after = mustApply(state, { type: "attack", seat: "p1", index });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

describe("§1 — the price, RE-DERIVED off the corpus rather than inherited", () => {
  it("the sentence is real, is worth ONE printing, and reached the SKELETON all along", () => {
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
    // It was refused at the CLAUSE, not at the skeleton: the bonus pattern always
    // matched it and always captured the printed 120.
    expect(BONUS.test(TAKEN)).toBe(true);
    expect(BONUS.exec(TAKEN)?.[2]).toBe("120");
    expect(BONUS.exec(TAKEN)?.[1]).toBe(TAKEN_CLAUSE);
    const clauseRows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TAKEN_CLAUSE);
    expect(clauseRows).toHaveLength(1);
    expect(units(clauseRows)).toBe(1);
  });

  it("it is the ONLY printed SUBSTRING name read, which is why the ROW is not short", () => {
    const named = corpus().filter(([, s]) => s.includes(" in its name"));
    expect(named).toHaveLength(3);
    // …and the THIRD is refused by the quoting itself: it spells TWO names in one
    // clause (`"Koffing" or "Weezing"`), which no single-fragment predicate can hold,
    // so even the narrower phrase pattern is a family of two.
    const phrase = corpus().filter(([, s]) => /has "[^"]+" in its name/.test(s));
    expect(phrase).toHaveLength(2);
    const shaped = phrase.filter(([, s]) => BONUS.test(s.trim()));
    expect(shaped).toHaveLength(1);
    expect(shaped[0]?.[1]).toBe(TAKEN);
    const TR_PILE =
      'This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your discard pile.';
    const KOFFING =
      'This attack does 40 damage for each Pokémon in play that has "Koffing" or "Weezing" in its name (both yours and your opponent\'s).';
    expect(named.map(([, s]) => s).sort()).toEqual([KOFFING, TAKEN, TR_PILE].sort());
    expect(resolvedByAnyReader(TR_PILE)).toBe(true);
    expect(resolvedByAnyReader(KOFFING)).toBe(true);
    expect(JSON.stringify(deriveAttackDamageMultiplier(TR_PILE))).toContain(
      "supporterNameContaining",
    );
    expect(JSON.stringify(deriveAttackDamageMultiplier(KOFFING))).toContain(
      "pokemonNameContaining",
    );
    expect(deriveAttackDamageMultiplier(TAKEN)).toBeNull();
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
    const whole = corpus().filter(([, s]) => / is on your Bench, this attack does /.test(s));
    expect(whole.length).toBeGreaterThanOrEqual(4);
  });

  it("the residue steps by exactly this ONE sentence and ONE printing", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
    expect([refused.length, units(refused)]).toEqual([0, 0]);
    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    expect(byClause.size).toBe(0);
    expect([...byClause.values()].filter((n) => n === 1)).toHaveLength(0);
    expect([...byClause.values()].filter((n) => n === 5)).toHaveLength(0);
    expect([...byClause.values()].filter((n) => n === 2)).toHaveLength(0);
  });
});

describe("§2 — the SHAPE question, measured on the running code rather than argued", () => {
  it("the note needs a second SENTENCE, not a second SLOT — D391's rule failing to transfer", () => {
    expect(conditionNote(EQUALITY)).toBe("Nidoking is on your Bench");
    expect(conditionNote(SUBSTRING)).toBe(TAKEN_CLAUSE);
    expect(conditionNote(SUBSTRING).startsWith("Nidoking")).toBe(false);
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(SUBSTRING)}, this attack does 120 more damage.`)
        ?.count,
    ).toEqual({ kind: "boardCondition", cond: SUBSTRING });
    const mightyena: BoardCondition = { kind: "yourBenchHasNamed", name: "Mightyena" };
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(mightyena)}, this attack does 90 more damage.`)
        ?.count,
    ).toEqual({ kind: "boardCondition", cond: mightyena });
  });

  it("the shipped member is UNTOUCHED — a second member edits zero of its sites", () => {
    for (const [name, amount] of [
      ["Durant", 20],
      ["Illumise", 60],
      ["Mightyena", 90],
    ] as const) {
      expect(
        deriveAttackDamageBonus(
          `If ${name} is on your Bench, this attack does ${String(amount)} more damage.`,
        )?.count,
        name,
      ).toEqual({ kind: "boardCondition", cond: { kind: "yourBenchHasNamed", name } });
    }
    expect(
      deriveAttackDamageBonus(
        "If Beldum and Metang are on your Bench, this attack does 150 more damage.",
      )?.count,
    ).toEqual({
      kind: "boardCondition",
      cond: {
        kind: "allOf",
        conditions: [
          { kind: "yourBenchHasNamed", name: "Beldum" },
          { kind: "yourBenchHasNamed", name: "Metang" },
        ],
      },
    });
  });

  it("the two members carry DISJOINT payload keys, which is the compiler property's shadow", () => {
    expect(Object.keys(SUBSTRING).sort()).toEqual(["fragment", "kind"]);
    expect(Object.keys(EQUALITY).sort()).toEqual(["kind", "name"]);
    expect(Object.keys(SUBSTRING)).not.toContain("name");
    expect(Object.keys(EQUALITY)).not.toContain("fragment");
    // …and neither member grew a `match` discriminator, which is the refused shape
    // named directly so a successor cannot re-add it without failing here.
    expect(JSON.stringify(SUBSTRING)).not.toContain("match");
    expect(JSON.stringify(EQUALITY)).not.toContain("match");
  });

  it("buys BOTH reader arms — a new member is exactly two, and nothing else moved", () => {
    const state = ready(4820);
    expect(typeof conditionHolds(state, "p1", SUBSTRING)).toBe("boolean");
    expect(conditionNote(SUBSTRING)).not.toBe("");
  });
});

describe("§3 — the boards: the equality read and the PREFIX read, both refuted", () => {
  it("'Team Rocket's Nidoking ex' arms the printed clause and FAILS the shipped equality", () => {
    const board = armed(4821, ["fix-trnidoking"]);
    expect(FIXTURE_POOL["fix-trnidoking"]?.name).toBe("Team Rocket's Nidoking ex");
    expect(conditionHolds(board, "p1", SUBSTRING)).toBe(true);
    expect(conditionHolds(board, "p1", EQUALITY)).toBe(false);
    expect(damageDealt(board)).toBe(180);
  });

  it("…and a PREFIX reading fails on that same board — the possessive is load-bearing", () => {
    const name = FIXTURE_POOL["fix-trnidoking"]?.name ?? "";
    expect(name.includes("Nidoking")).toBe(true);
    expect(name.startsWith("Nidoking")).toBe(false);
    expect(name.indexOf("Nidoking")).toBeGreaterThan(0);
    expect(name === "Nidoking").toBe(false);
  });

  it("the EXACT name is where the two readings AGREE — so the member is a WIDENING", () => {
    // The control that stops the substring arm being "a different question": on a body
    // named exactly the fragment, both members are true and the damage is the same.
    const board = armed(4822, ["fix-nidoking"]);
    expect(FIXTURE_POOL["fix-nidoking"]?.name).toBe("Nidoking");
    expect(conditionHolds(board, "p1", SUBSTRING)).toBe(true);
    expect(conditionHolds(board, "p1", EQUALITY)).toBe(true);
    expect(damageDealt(board)).toBe(180);
  });

  it("an EMPTY Bench is false, and the attacker cannot arm its own clause", () => {
    const alone = armed(4823);
    expect(alone.players.p1.bench).toHaveLength(0);
    expect(conditionHolds(alone, "p1", SUBSTRING)).toBe(false);
    expect(damageDealt(alone)).toBe(60);
    // …a SECOND copy of the attacker on the Bench still does not arm it.
    const twin = armed(4824, ["fix-loveimpact"]);
    expect(FIXTURE_POOL["fix-loveimpact"]?.name).toBe("Team Rocket's Nidoqueen");
    expect(conditionHolds(twin, "p1", SUBSTRING)).toBe(false);
    expect(damageDealt(twin)).toBe(60);
  });

  it("a nameless filler is false, and the read is BENCH-ONLY on the OWN seat", () => {
    const filler = armed(4825, ["fix-benchfiller"]);
    expect(conditionHolds(filler, "p1", SUBSTRING)).toBe(false);
    expect(damageDealt(filler)).toBe(60);
    // The seat: P1's clause never reads P2's Bench. Same body, other side.
    const across = benchFromDeck(armed(4826), "p2", "fix-trnidoking");
    expect(conditionHolds(across, "p1", SUBSTRING)).toBe(false);
    expect(conditionHolds(across, "p2", SUBSTRING)).toBe(true);
    // The zone: the same body in the ACTIVE SPOT does not satisfy "on your Bench",
    // which is `yourBenchHasNamed`'s rule inherited verbatim.
    let active = ready(4827);
    active = setActiveFromDeck(active, "p1", "fix-trnidoking");
    active = clearBench(active, "p1");
    expect(active.players.p1.bench).toHaveLength(0);
    expect(conditionHolds(active, "p1", SUBSTRING)).toBe(false);
  });

  it("the CONTROL attack at index 1 is unconditional — the bonus is on index 0 alone", () => {
    // "Mega Kick" ({D}{D}, 130) carries no clause, so the same armed board deals its
    // printed damage either way. That is what makes the 60/180 pair attributable to
    // the clause rather than to the board.
    expect(damageDealt(armed(4828, ["fix-trnidoking"]), 1)).toBe(130);
    expect(damageDealt(armed(4829), 1)).toBe(130);
  });
});

describe("§4 — a LITERAL row, and the printed bytes it is keyed on", () => {
  it("the sentence resolves to the new member at the printed 120", () => {
    expect(deriveAttackDamageBonus(TAKEN)?.count).toEqual({
      kind: "boardCondition",
      cond: SUBSTRING,
    });
    expect(deriveAttackDamageBonus(TAKEN)?.per).toBe(120);
  });

  it("the quotation marks are ASCII U+0022 and are LOAD-BEARING in the key", () => {
    const printed = corpus().find(([, s]) => s === TAKEN)?.[1] ?? "";
    expect(printed).toContain('"Nidoking"');
    expect(printed).not.toContain("“");
    expect(printed).not.toContain("”");
    expect(printed.indexOf('"')).toBe(TAKEN.indexOf('"'));
    // …and the curly spelling of the same sentence resolves to NOTHING.
    expect(deriveAttackDamageBonus(TAKEN.replace(/"([^"]+)"/, "“$1”"))).toBeNull();
  });

  it("no template was bought — a DIFFERENT quoted name in the same frame is refused", () => {
    for (const other of ["Nidoqueen", "Pikachu", "constructor", ""]) {
      expect(
        deriveAttackDamageBonus(
          `If a Pokémon that has "${other}" in its name is on your Bench, this attack does 120 more damage.`,
        ),
        other,
      ).toBeNull();
    }
    expect(
      deriveAttackDamageBonus("If Nidoking is on your Bench, this attack does 120 more damage."),
    ).toBeNull();
  });

  it("keeps the two CONSEQUENTS disjoint, and the anchors whole-sentence at both ends", () => {
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    expect(deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does nothing.`)).toBeNull();
    // Lowercase `if` — the skeleton has no /i.
    expect(
      deriveAttackDamageBonus(`if ${TAKEN_CLAUSE}, this attack does 120 more damage.`),
    ).toBeNull();
    // No trailing period is not the whole sentence.
    expect(
      deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does 120 more damage`),
    ).toBeNull();
    // Leading text pins `^`.
    expect(
      deriveAttackDamageBonus(`Flip a coin. If ${TAKEN_CLAUSE}, this attack does 120 more damage.`),
    ).toBeNull();
    // A printed 0 adds nothing — the guard every arm in this family carries.
    expect(
      deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does 0 more damage.`),
    ).toBeNull();
  });
});
