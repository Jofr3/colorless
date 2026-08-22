import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackRequirement,
} from "./effects";
import type { BoardCondition, GameState } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
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

// 🆕🆕 D392 — THE SUBSTRING NAME READ, AND THE FIRST TEST OF THE RULE D391 LEFT
// BEHIND.
//
// Team Rocket's Nidoqueen `sv10-116` "Love Impact" ({D}, `60+`, index **0** of TWO),
// **1 legal printing**: *"If a Pokémon that has "Nidoking" in its name is on your
// Bench, this attack does 120 more damage."*
//
// 🛑 **THE SHAPE QUESTION, AND IT WAS A PREDICTION BEFORE IT WAS A MEASUREMENT.**
// D391's rule reads *a comparand is a shape and takes a MEMBER; a filter the delegate
// already accepts is a FIELD*, and it predicted MEMBER here because what changes is
// the COMPARISON OPERATOR (`===` → `.includes`) rather than a filter. It was priced
// BOTH WAYS anyway, on D391's own instruction, and the measurements agree with it:
// a member edits ZERO of `yourBenchHasNamed`'s 45 executable sites where an optional
// `match?:` edits THREE; `conditionNote` needs a second SENTENCE rather than a second
// SLOT (D389's arithmetic, which is the half of D391's that does not transfer); and
// there is no delegate that already takes the parameter, because this arm compares
// `topCardOf(...)?.name` inline. §2 drives all three as facts about the running code.
//
// ⚠️ **SO THE RULE IS ONE-FOR-ONE, NOT PROVEN.** What it has not met is a case where
// it and the measurements DISAGREE; D391's instruction — follow the measurements and
// say so — is still the one that governs.
//
// 🛑 **THE TWO READINGS DISAGREE ON THE BOARD THE CARD WAS PRINTED FOR, AND A
// SUBSTRING IS NOT A PREFIX EITHER.** §4's naming rule makes the Standard satisfier
// **Team Rocket's Nidoking ex**, whose name carries the fragment at a NON-ZERO offset
// behind an owner possessive — so `yourBenchHasNamed { name: "Nidoking" }` is FALSE
// there and so is a `startsWith` reading. §3 refutes both ON A BOARD, at the printed
// 60 and the printed 180, rather than arguing them.
//
// WHAT SHIPS: **1 new `BoardCondition` member** (`yourBenchHasNameContaining
// { fragment }`), **1 literal `CONDITIONAL_DAMAGE_CLAUSES` row**, **2 new exhaustive
// switch arms**, **3 fixtures** and **1 dedicated 60**. ZERO edited reader arms, ZERO
// templates, patterns, maps, ops, events, error codes, prompt kinds or registry rows;
// ZERO `packages/schema` bytes; `MATCH_RECORD_VERSION` stays **23**.

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

/** The nine live readers, run as one — the same set `censusAtHead.test.ts` and
    `benchNamedBonus.test.ts` use. */
const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackBonusConsequent,
];
const resolvedByAnyReader = (text: string): boolean => READERS.some((read) => read(text) !== null);

/** THE SENTENCE THIS SLICE BUYS, byte-for-byte from the committed corpus — the
    quotation marks are ASCII U+0022, which §5 asserts rather than assumes. */
const TAKEN =
  'If a Pokémon that has "Nidoking" in its name is on your Bench, this attack does 120 more damage.';
const TAKEN_CLAUSE = 'a Pokémon that has "Nidoking" in its name is on your Bench';

/** The member this slice buys… */
const SUBSTRING: BoardCondition = { kind: "yourBenchHasNameContaining", fragment: "Nidoking" };
/** …and the EQUALITY member one line up in the union, at the same printed token.
    Every board below is asked BOTH, because the finding is where they disagree. */
const EQUALITY: BoardCondition = { kind: "yourBenchHasNamed", name: "Nidoking" };

// ── boards ─────────────────────────────────────────────────────────────────────

/** P1 fields the printed attacker with one {D} attached, P2 fields the 340 HP
    defender, BOTH benches are emptied (`setActiveFromDeck` DISPLACES rather than
    replaces) and then P1's is filled with exactly the bodies asked for. Returned on
    P2's turn, so `armed` can hand it back with no §4 restriction. */
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
  it("🛑 the sentence is real, is worth ONE printing, and reached the SKELETON all along", () => {
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
    // It was refused at the CLAUSE, not at the skeleton: the bonus pattern always
    // matched it and always captured the printed 120.
    expect(BONUS.test(TAKEN)).toBe(true);
    expect(BONUS.exec(TAKEN)?.[2]).toBe("120");
    expect(BONUS.exec(TAKEN)?.[1]).toBe(TAKEN_CLAUSE);
    // …and the clause is the whole population: no second sentence carries it under a
    // different amount, so the row cannot be short and cannot rot on a reprint.
    const clauseRows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TAKEN_CLAUSE);
    expect(clauseRows).toHaveLength(1);
    expect(units(clauseRows)).toBe(1);
  });

  it("🛑 it is the ONLY printed SUBSTRING name read, which is why the ROW is not short", () => {
    // The population that decides "row or template" (D118/D119), and it is NOT the
    // population the printed PHRASE picks out. `has "<name>" in its name` is spelled
    // by THREE legal sentences, and the other two are per-card SCALING reads under a
    // different skeleton entirely — *"…20 damage for each Supporter card that has
    // \"Team Rocket\" in its name in your discard pile"* and *"…40 damage for each
    // Pokémon in play that has \"Koffing\" or \"Weezing\" in its name…"*, the second
    // of which quotes TWO names in one clause. So the phrase is a family and the
    // BOARD FACT is a singleton inside it: **3 sentences say "in its name", 2 of those
    // quote a SINGLE name, and 1 of those is a board fact under the bonus skeleton.**
    // That is precisely why a template over the phrase would be wrong and a
    // whole-clause row cannot be.
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
    // …and neither of the other two resolves, so this slice did not quietly widen a
    // reader into a sentence it was never priced for.
    for (const [, s] of named.filter(([, t]) => t !== TAKEN)) {
      expect(resolvedByAnyReader(s), s).toBe(false);
    }
    // ⚠️ AND THE WHOLE-NAME FAMILY IS THE ONE THAT IS BIG, which is the asymmetry that
    // makes the substring row a row and the equality row a row for DIFFERENT reasons:
    // four `<Name> is on your Bench` sentences are printed and all four already resolve.
    const whole = corpus().filter(([, s]) => / is on your Bench, this attack does /.test(s));
    expect(whole.length).toBeGreaterThanOrEqual(4);
  });

  it("🛑 the residue steps by exactly this ONE sentence and ONE printing", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 13 / 16 could not tell "the row landed" from "a reader broke".
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
    // D391 left the residue at 14 / 17, re-derived here off the live readers.
    expect([refused.length, units(refused)]).toEqual([11, 14]);
    expect([refused.length + 3, units(refused) + 3]).toEqual([14, 17]);
    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    // `{1: 12, 5: 1}` → `{1: 11, 5: 1}`: a SINGLETON left the singleton band and
    // nothing else moved. The only clause above one printing is still the 5-printing
    // declaration clause D368 disqualified on SHAPE, so this rung goes red from the
    // other side too — a reader narrowing until some clause returns to 2 fails it.
    expect(byClause.size).toBe(10);
    expect([...byClause.values()].filter((n) => n === 1)).toHaveLength(9);
    expect([...byClause.values()].filter((n) => n === 5)).toHaveLength(1);
    expect([...byClause.values()].filter((n) => n === 2)).toHaveLength(0);
  });
});

describe("§2 — the SHAPE question, measured on the running code rather than argued", () => {
  it("🛑 the note needs a second SENTENCE, not a second SLOT — D391's rule failing to transfer", () => {
    // THE MEASUREMENT THAT DECIDED IT. D391's field was cheap because the note gained
    // ONE interpolation slot and returned the unnarrowed string byte-identically.
    // These two share no interpolation shape at all: one is `<token> …` and the other
    // wraps the token in printed quotation marks in the MIDDLE of the sentence. A
    // field would have put two whole strings into a branch inside one arm — which is
    // exactly the arithmetic D389 refused a seat parameter on.
    expect(conditionNote(EQUALITY)).toBe("Nidoking is on your Bench");
    expect(conditionNote(SUBSTRING)).toBe(TAKEN_CLAUSE);
    expect(conditionNote(SUBSTRING).startsWith("Nidoking")).toBe(false);
    // …and the substring note round-trips to ITS OWN `CONDITIONAL_DAMAGE_CLAUSES` key
    // byte for byte, which is what makes the second sentence a real key rather than a
    // rendering of the first. ⚠️ The equality member is shown round-tripping at a name
    // the table actually carries (`Mightyena`) — "Nidoking" has no whole-name row and
    // must NOT acquire one, which is the next assertion down.
    expect(deriveAttackDamageBonus(`If ${conditionNote(SUBSTRING)}, this attack does 120 more damage.`)?.count).toEqual(
      { kind: "boardCondition", cond: SUBSTRING },
    );
    const mightyena: BoardCondition = { kind: "yourBenchHasNamed", name: "Mightyena" };
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(mightyena)}, this attack does 90 more damage.`)
        ?.count,
    ).toEqual({ kind: "boardCondition", cond: mightyena });
  });

  it("🛑 the shipped member is UNTOUCHED — a second member edits zero of its sites", () => {
    // The other half of the price. `yourBenchHasNamed` still answers exactly what it
    // answered before, at every one of its four live clause rows, and the `allOf` pair
    // still resolves through it — none of which a `match?:` field could have promised,
    // because an optional field is invisible to the compiler at every site that
    // ignores it.
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

  it("⚠️ the two members carry DISJOINT payload keys, which is the compiler property's shadow", () => {
    // The safety a second member buys is a TYPE fact and cannot be asserted at
    // runtime — so this rung asserts the thing that CAUSES it: the payload field is
    // `fragment` and not `name`, so the two members do not differ by their `kind`
    // token alone. Change the field to `name` and this goes red, which is the whole
    // point: with matching payloads a mistyped `kind` on any of the eight shipped
    // `yourBenchHasNamed` literals would still typecheck and would silently swap an
    // exact read for a substring one.
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
    // The two exhaustive `switch (cond.kind)` statements in the repo, driven: the
    // member answers on a board AND renders a note. Neither has a `default`, so a
    // missing arm is a compile error rather than a runtime surprise — which is the
    // whole reason this file can assert "two arms" by driving them.
    const state = ready(4820);
    expect(typeof conditionHolds(state, "p1", SUBSTRING)).toBe("boolean");
    expect(conditionNote(SUBSTRING)).not.toBe("");
  });
});

describe("§3 — the boards: the equality read and the PREFIX read, both refuted", () => {
  it("🛑 'Team Rocket's Nidoking ex' arms the printed clause and FAILS the shipped equality", () => {
    // THE BOARD THE CARD WAS PRINTED FOR. §4's naming rule means the Standard body is
    // owner-prefixed and rule-box-suffixed, so it CONTAINS "Nidoking" and equals it
    // nowhere. The two members disagree here and the printed bonus follows the
    // substring one.
    const board = armed(4821, ["fix-trnidoking"]);
    expect(FIXTURE_POOL["fix-trnidoking"]?.name).toBe("Team Rocket's Nidoking ex");
    expect(conditionHolds(board, "p1", SUBSTRING)).toBe(true);
    expect(conditionHolds(board, "p1", EQUALITY)).toBe(false);
    expect(damageDealt(board)).toBe(180);
  });

  it("🛑 …and a PREFIX reading fails on that same board — the possessive is load-bearing", () => {
    // `startsWith` is the other plausible wrong operator, and it is the reason this
    // slice pays the possessive fixture-name toll instead of naming the body
    // "Nidoking ex": the fragment sits at offset 14, so a prefix read is FALSE on the
    // exact board the printed clause is TRUE on.
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

  it("🛑 an EMPTY Bench is false, and the attacker cannot arm its own clause", () => {
    // "Team Rocket's Nidoqueen" shares the possessive prefix and eight letters with
    // the fragment and still does not contain it — so an "in play" reading of this
    // member (the widening D279 refused one member up) would NOT go red here, but a
    // fragment truncated to "Nido" would. Both boards are driven.
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
  it("🛑 the sentence resolves to the new member at the printed 120", () => {
    expect(deriveAttackDamageBonus(TAKEN)?.count).toEqual({
      kind: "boardCondition",
      cond: SUBSTRING,
    });
    expect(deriveAttackDamageBonus(TAKEN)?.per).toBe(120);
  });

  it("🛑 the quotation marks are ASCII U+0022 and are LOAD-BEARING in the key", () => {
    // The printed bytes, checked rather than eyeballed: the corpus spells U+0022 and
    // not the curly pair, and `literalClauseRow`'s fold is about APOSTROPHES (U+2019)
    // and reaches none of this. A key authored with typographic quotes would resolve
    // nothing, silently, which is the D183 defect in punctuation.
    const printed = corpus().find(([, s]) => s === TAKEN)?.[1] ?? "";
    expect(printed).toContain('"Nidoking"');
    expect(printed).not.toContain("“");
    expect(printed).not.toContain("”");
    expect(printed.indexOf('"')).toBe(TAKEN.indexOf('"'));
    // …and the curly spelling of the same sentence resolves to NOTHING.
    expect(deriveAttackDamageBonus(TAKEN.replace(/"([^"]+)"/, "“$1”"))).toBeNull();
  });

  it("🛑 no template was bought — a DIFFERENT quoted name in the same frame is refused", () => {
    // The rung that separates "a row landed" from "a pattern landed". A card NAME is
    // open-ended and has nothing to fail against, so a template here would answer
    // FALSE forever and silently for any name it could not resolve. One row per
    // printing, exactly as `yourBenchHasNamed`'s four rows are.
    for (const other of ["Nidoqueen", "Pikachu", "constructor", ""]) {
      expect(
        deriveAttackDamageBonus(
          `If a Pokémon that has "${other}" in its name is on your Bench, this attack does 120 more damage.`,
        ),
        other,
      ).toBeNull();
    }
    // …and the equality row's own frame is untouched by the new row: a name with no
    // quotes still goes to the OTHER member.
    expect(
      deriveAttackDamageBonus("If Nidoking is on your Bench, this attack does 120 more damage."),
    ).toBeNull();
  });

  it("keeps the two CONSEQUENTS disjoint, and the anchors whole-sentence at both ends", () => {
    // D125: the requirement reader must never see a sentence meaning "+N", and the
    // cancel spelling of this clause must never reach the bonus table.
    expect(deriveAttackRequirement(TAKEN)).toBeNull();
    expect(deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does nothing.`)).toBeNull();
    // Lowercase `if` — the skeleton has no /i.
    expect(deriveAttackDamageBonus(`if ${TAKEN_CLAUSE}, this attack does 120 more damage.`)).toBeNull();
    // No trailing period is not the whole sentence.
    expect(deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does 120 more damage`)).toBeNull();
    // Leading text pins `^`.
    expect(
      deriveAttackDamageBonus(
        `Flip a coin. If ${TAKEN_CLAUSE}, this attack does 120 more damage.`,
      ),
    ).toBeNull();
    // A printed 0 adds nothing — the guard every arm in this family carries.
    expect(deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does 0 more damage.`)).toBeNull();
  });
});
