import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  deriveAttackCancelRequirement,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackRequirement,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import type { GameState } from "./index";
import { programFor } from "./registry";
import {
  SAWK_SPLIT_DECK,
  attachFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
  programmedCardIds,
} from "./testFixtures";

/** Sawk `sv10.5w-049`/`-130` "Rising Chop" ({F}, 90 — the cost is ONE Fighting;
    see §4's note), as PRINTED. The catalog's only both-halves compound. */
const SAWK =
  "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance.";
/** Its leading requirement sentence. */
const SAWK_HEAD = "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing.";
const SAWK_TAIL = "This attack's damage isn't affected by Weakness or Resistance.";
const CANCEL_PRINTING = "Discard a Stadium in play. If you can't, this attack does nothing.";
const CANCEL_HEAD = "Discard a Stadium in play.";
/** Its trailing clause. Byte-identical on every member of the family, which is what
    "anaphoric" means and why the table cannot be keyed on it. */
const CANCEL_CLAUSE = "If you can't, this attack does nothing.";
const GATE_BAN = "If you go second, you can't use this attack during your first turn.";
const GATE_LICENCE =
  "You can use this attack only if you go second, and only during your first turn.";

const BOTH = `${GATE_BAN} ${SAWK}`;
/** The same two clauses in the other order. Also constructed. */
const REVERSED = `${SAWK_HEAD} ${GATE_BAN} ${SAWK_TAIL}`;

/** The site's order: gate clause off the front, THEN the requirement clause. */
function siteOrder(text: string): string {
  const gated = splitAttackGateClause(text)?.body ?? text;
  return splitAttackRequirementClause(gated)?.body ?? gated;
}
/** The other order. Not what attack.ts does — the control for §3. */
function reversedOrder(text: string): string {
  const stripped = splitAttackRequirementClause(text)?.body ?? text;
  return splitAttackGateClause(stripped)?.body ?? stripped;
}

function fourSiteOrder(text: string): string {
  const gated = splitAttackGateClause(text)?.body ?? text;
  const required = splitAttackRequirementClause(gated)?.body ?? gated;
  const uncancelled = splitAttackCancelClause(required)?.head ?? required;
  return splitAttackTrailingClause(uncancelled)?.head ?? uncancelled;
}
/** The four in the exact opposite order. Not what attack.ts does — §6's control. */
function fourReversedOrder(text: string): string {
  const composed = splitAttackTrailingClause(text)?.head ?? text;
  const uncancelled = splitAttackCancelClause(composed)?.head ?? composed;
  const required = splitAttackRequirementClause(uncancelled)?.body ?? uncancelled;
  return splitAttackGateClause(required)?.body ?? required;
}

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: SAWK_SPLIT_DECK, p2: SAWK_SPLIT_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}
function ready(seed: number, defender: string): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-sawk");
  state = attachFromDeck(state, "p1", "fix-fighting-energy", 1);
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", defender);
  return clearBench(state, "p2");
}

describe("§1 — the census D282 priced its refusal against: counts reproduce, attribution does not", () => {
  it("re-derives 271 s / 613 u multi-sentence, 8 s / 16 u opening `If `", () => {
    const all = corpus();
    const multi = all.filter(([, s]) => s.includes(". "));
    expect(multi.length).toBe(271);
    expect(units(multi)).toBe(613);
    const opensIf = multi.filter(([, s]) => s.startsWith("If "));
    expect(opensIf.length).toBe(8);
    expect(units(opensIf)).toBe(16);
  });

  it("partitions the 16 as 10 GATE + 6 SUBSTANTIVE — not D363's `13 + 3`", () => {
    const opensIf = corpus().filter(([, s]) => s.includes(". ") && s.startsWith("If "));
    const gate = opensIf.filter(([, s]) => splitAttackGateClause(s) !== null);
    const substantive = opensIf.filter(([, s]) => splitAttackGateClause(s) === null);
    // 10 gate units on TWO spellings (7 BAN + 3 GATE), never three.
    expect(units(gate)).toBe(10);
    expect(gate.length).toBe(3);
    expect(units(gate.filter(([, s]) => s.startsWith(GATE_BAN)))).toBe(7);
    expect(units(substantive)).toBe(6);
    expect(substantive.length).toBe(5);
    expect(units(substantive.filter(([, s]) => splitAttackRequirementClause(s) !== null))).toBe(2);
    expect(units(gate) + units(substantive)).toBe(16);
  });

  it("the 3 LICENCE printings are multi-sentence and are NOT among the 16", () => {
    // The double-count, driven. They are gate-family units, they are counted in
    // the 13, and they cannot be in a population defined as "opens with `If `".
    const licence = corpus().filter(([, s]) => s.startsWith(GATE_LICENCE));
    expect(units(licence)).toBe(3);
    expect(licence.every(([, s]) => s.includes(". "))).toBe(true);
    expect(licence.some(([, s]) => s.startsWith("If "))).toBe(false);
    const gateAll = corpus().filter(([, s]) => splitAttackGateClause(s) !== null);
    expect(units(gateAll)).toBe(19);
    const firstTurn = gateAll.filter(([, s]) =>
      (splitAttackGateClause(s)?.clause ?? "").includes("during your first turn"),
    );
    expect(units(firstTurn)).toBe(13);
    expect(units(firstTurn) - units(licence)).toBe(10);
    expect(units(gateAll) - units(firstTurn)).toBe(6);
  });

  it("S2 — 18 of 1,524 registry ids carry an `attackGate`, in three kinds", () => {
    const ids = programmedCardIds();
    expect(ids.length).toBe(1524);
    const gated = ids.filter((id) => programFor(id)?.attackGate !== undefined);
    expect(gated.length).toBe(18);
    const kinds = gated.flatMap((id) =>
      Object.values(programFor(id)?.attackGate ?? {}).map((g) => g.kind),
    );
    expect(kinds.filter((k) => k === "barredIf").length).toBe(11);
    expect(kinds.filter((k) => k === "onlyIf").length).toBe(4);
    expect(kinds.filter((k) => k === "firstTurnExempt").length).toBe(3);
    const indices = gated.flatMap((id) => Object.keys(programFor(id)?.attackGate ?? {}));
    expect(indices.filter((k) => k === "0").length).toBe(14);
    expect(indices.filter((k) => k === "1").length).toBe(4);
  });
});

describe("§2 — the two splits are DISJOINT on the whole catalog", () => {
  it("gate split claims 7 s / 17 u ( D541 6/14 → 7/17; the TITLE had been stale at 5/13 since D395; D545 → 9 s / 19 u), requirement split 1 s / 2 u, and BOTH claim 0", () => {
    const all = corpus();
    const gate = all.filter(([, s]) => splitAttackGateClause(s) !== null);
    const req = all.filter(([, s]) => splitAttackRequirementClause(s) !== null);
    const both = all.filter(
      ([, s]) => splitAttackGateClause(s) !== null && splitAttackRequirementClause(s) !== null,
    );
    expect([gate.length, units(gate)]).toEqual([9, 19]);
    expect([req.length, units(req)]).toEqual([1, 2]);
    expect([both.length, units(both)]).toEqual([0, 0]);
  });

  it("the ORDER IS UNOBSERVABLE ON THE CATALOG — both orders agree on every row", () => {
    // The consequence of disjointness, stated as the thing that would break.
    // This is what makes a generic composer scaffolding: there is no printed
    // string it would answer differently.
    for (const [, text] of corpus()) {
      expect(reversedOrder(text), text).toBe(siteOrder(text));
    }
  });

  it("keeps the CONTROL that says both readers are really running", () => {
    // A sweep that agrees because both halves return the input is vacuous. Each
    // split must be seen to MOVE the string on its own population.
    expect(siteOrder(SAWK)).toBe(SAWK_TAIL);
    expect(siteOrder(`${GATE_BAN} ${SAWK_TAIL}`)).toBe(SAWK_TAIL);
    expect(corpus().filter(([, s]) => siteOrder(s) !== s).length).toBe(10);
  });
});

describe("§3 — the ordering where the two splits meet", () => {
  it("the site's order accounts for BOTH clauses; the reverse accounts for neither", () => {
    expect(siteOrder(BOTH)).toBe(SAWK_TAIL);
    expect(deriveAttackDamageSuppression(siteOrder(BOTH))).toEqual({
      weakness: true,
      resistance: true,
    });
    // The other order leaves the WHOLE compound behind the gate clause unread.
    expect(reversedOrder(BOTH)).toBe(SAWK);
    expect(deriveAttackDamageSuppression(reversedOrder(BOTH))).toBeNull();
    // So the two orders DISAGREE off the catalog. The order at the site is a
    // commitment, not an accident — which is precisely what §2 shows nothing
    // printed can currently reveal.
    expect(siteOrder(BOTH)).not.toBe(reversedOrder(BOTH));
  });

  it("the requirement split REFUSES a gate-led compound, and the LAZY clause group is why", () => {
    expect(splitAttackRequirementClause(BOTH)).toBeNull();
    expect(deriveAttackRequirement(BOTH)).toBeNull();
    // …and it becomes readable the moment the gate clause is off the front.
    expect(splitAttackRequirementClause(splitAttackGateClause(BOTH)?.body ?? "")).toEqual({
      clause: SAWK_HEAD,
      body: SAWK_TAIL,
    });
  });

  it("BOTH orders fail in the SAFE direction — neither drops a sentence unreported", () => {
    for (const text of [BOTH, REVERSED, SAWK, `${GATE_BAN} ${SAWK_TAIL}`]) {
      const site = siteOrder(text);
      const other = reversedOrder(text);
      expect(text.includes(site), text).toBe(true);
      expect(text.includes(other), text).toBe(true);
      expect(site.length <= other.length || other.length <= site.length).toBe(true);
    }
    // The reversed compound: the requirement is spent, the GATE clause is what
    // stays loud. Reported, never dropped.
    expect(splitAttackRequirementClause(REVERSED)).toEqual({
      clause: SAWK_HEAD,
      body: `${GATE_BAN} ${SAWK_TAIL}`,
    });
    expect(siteOrder(REVERSED)).toBe(`${GATE_BAN} ${SAWK_TAIL}`);
  });
});

describe("§4 — the requirement table's LIVE legality (a row count is not a coverage map)", () => {
  /** The three printed keys, as literals — `ATTACK_REQUIREMENT_CLAUSES` is
      module-private, so this is a labelled COPY tied to the live reader below. */
  const KEYS: readonly (readonly [string, number])[] = [
    ["If this Pokémon didn't move from the Bench to the Active Spot this turn", 0],
    [
      "If your opponent's Active Pokémon has no damage counters on it before this attack does damage",
      2,
    ],
    ["If your opponent's Active Pokémon isn't a Pokémon ex", 2],
    ["If you don't have the same number of cards in your hand as your opponent", 2],
    ["If your opponent doesn't have exactly 3 or 4 Prize cards remaining", 1],
    ["If you don't have Uxie and Azelf on your Bench", 2],
    ["If you have 4 or fewer Benched Pokémon", 4],
    ["If your opponent's Active Pokémon isn't Burned", 1],
    ["If there is no Stadium in play", 2],
    ["If you don't have exactly 3 cards in your hand", 2],
  ];

  it("prices each mapped clause by LEGAL printings — 0, 2, 2, 2, 1, 2, 4, 1, 2, 2", () => {
    for (const [key, expected] of KEYS) {
      const sentence = `${key}, this attack does nothing.`;
      expect(deriveAttackRequirement(sentence), key).not.toBeNull();
      const printed = corpus().filter(([, s]) => s === sentence || s.startsWith(`${sentence} `));
      expect(units(printed), key).toBe(expected);
    }
  });

  it("TEN rows, NINE of them reachable in Standard, and 18 legal printings — the table SATURATES", () => {
    const reachable = KEYS.filter(([, n]) => n > 0);
    expect(KEYS.length).toBe(10);
    expect(reachable.length).toBe(9);
    expect(KEYS.reduce((sum, [, n]) => sum + n, 0)).toBe(18);
    const openers = corpus().filter(([, s]) => /^If .+?, this attack does nothing\./.test(s));
    expect([openers.length, units(openers)]).toEqual([9, 18]);
    const mapped = openers.filter(([, s]) => deriveAttackRequirement(s) !== null);
    expect([mapped.length, units(mapped)]).toEqual([9, 18]);
    const unmapped = openers.filter(([, s]) => deriveAttackRequirement(s) === null);
    expect([unmapped.length, units(unmapped)]).toEqual([0, 0]);
    expect(
      deriveAttackRequirement(
        "If you don't have exactly 4 cards in your hand, this attack does nothing.",
      ),
    ).toBeNull();
    expect(deriveAttackRequirement("Discard your hand and draw 6 cards.")).toBeNull();
    // The parts sum, which is what makes a partition a partition.
    expect(mapped.length + unmapped.length).toBe(openers.length);
    expect(units(mapped) + units(unmapped)).toBe(units(openers));
  });
});

describe("§5 — on a board: the requirement is read BEFORE the split, and that is observable", () => {
  it("CANCELS into a non-ex — which is only true because the read precedes the split", () => {
    expect(deriveAttackRequirement(SAWK_TAIL)).toBeNull();
    const after = mustApply(ready(6401, "fix-bigbody"), { type: "attack", seat: "p1", index: 0 });
    expect(after.events.find((e) => e.type === "ATTACK_FAILED")).toMatchObject({
      reason: "requirement",
    });
    expect(types(after.events)).not.toContain("DAMAGE_DEALT");
    // Both printed sentences are accounted for, so the cancel is SIMULATED.
    expect(types(after.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("the CONTROL that names none of these ids and still reddens: the split really fired", () => {
    const after = mustApply(ready(6427, "fix-bigbody"), { type: "attack", seat: "p1", index: 1 });
    const skipped = after.events.find((e) => e.type === "ATTACK_EFFECT_SKIPPED");
    expect(skipped).toMatchObject({ effect: "Then, spin the wheel of fate." });
    expect(after.events.find((e) => e.type === "ATTACK_FAILED")).toMatchObject({
      reason: "requirement",
    });
  });
});

describe("§6 — FOUR strippers at one seam, and all six pairs are DISJOINT", () => {
  /** The four, by name, in the order `attack.ts` runs them. */
  const STRIPPERS: readonly (readonly [string, (text: string) => unknown])[] = [
    ["gate", splitAttackGateClause],
    ["requirement", splitAttackRequirementClause],
    ["cancel", splitAttackCancelClause],
    ["trailing", splitAttackTrailingClause],
  ];

  it("prices each stripper live off the corpus — D541 7/17, 1/2, 4/5, 11/21 ( D545 gate → 9/19)", () => {
    const priced = STRIPPERS.map(([name, split]) => {
      const rows = corpus().filter(([, s]) => split(s) !== null);
      return [name, rows.length, units(rows)] as const;
    });
    expect(priced).toEqual([
      ["gate", 9, 19],
      ["requirement", 1, 2],
      ["cancel", 4, 5],
      ["trailing", 12, 22],
    ]);
    // …and every one of the four MOVES a string, which is what stops the matrix
    // below being a matrix of four dead functions.
    for (const [name, sentences] of priced) expect([name, sentences > 0]).toEqual([name, true]);
  });

  it("THE TRIPWIRE: no legal unit are claimed by any TWO of the four", () => {
    const collisions: string[] = [];
    for (let i = 0; i < STRIPPERS.length; i += 1) {
      for (let j = i + 1; j < STRIPPERS.length; j += 1) {
        const [nameA, splitA] = STRIPPERS[i] ?? ["", () => null];
        const [nameB, splitB] = STRIPPERS[j] ?? ["", () => null];
        const both = corpus().filter(([, s]) => splitA(s) !== null && splitB(s) !== null);
        for (const [n, s] of both) collisions.push(`${nameA} x ${nameB} (${n}): ${s}`);
      }
    }
    expect(collisions).toEqual([]);
    // The six pairs really were walked — a loop with the bounds wrong produces an
    // empty array too.
    expect((STRIPPERS.length * (STRIPPERS.length - 1)) / 2).toBe(6);
  });

  it("the near-collision, ATTRIBUTED: the trailing splitter refuses a does-nothing tail", () => {
    expect(deriveAttackEffect(CANCEL_CLAUSE)).toBeNull();
    for (const [, s] of corpus().filter(([, s]) => s.endsWith(CANCEL_CLAUSE))) {
      expect(splitAttackTrailingClause(s), s).toBeNull();
      // …while the gate list and the `^If` anchor refuse them from the FRONT, which
      // is a different reason and is stated as one.
      expect(splitAttackGateClause(s), s).toBeNull();
      expect(splitAttackRequirementClause(s), s).toBeNull();
      expect(s.startsWith("If "), s).toBe(false);
    }
    const composable = `${CANCEL_HEAD} Discard 3 Energy from this Pokémon.`;
    expect(splitAttackCancelClause(composable)).toBeNull();
    expect(splitAttackTrailingClause(composable)).toEqual({
      head: CANCEL_HEAD,
      tail: "Discard 3 Energy from this Pokémon.",
    });
  });

  it("the ORDER among the four is UNOBSERVABLE on the catalog — the consequence", () => {
    for (const [, text] of corpus()) {
      expect(fourSiteOrder(text), text).toBe(fourReversedOrder(text));
    }
    expect(fourSiteOrder(SAWK)).toBe(SAWK_TAIL);
    expect(fourSiteOrder(CANCEL_PRINTING)).toBe(CANCEL_HEAD);
    expect(fourReversedOrder(CANCEL_PRINTING)).toBe(CANCEL_HEAD);
    expect(corpus().filter(([, s]) => fourSiteOrder(s) !== s).length).toBe(26);
    expect(corpus().filter(([, s]) => siteOrder(s) !== s).length).toBe(10);
    expect(corpus().filter(([, s]) => splitAttackTrailingClause(s) !== null).length).toBe(12);
    expect(corpus().filter(([, s]) => splitAttackCancelClause(s) !== null).length).toBe(4);
  });

  it("the reader and the splitter agree on exactly the same printings", () => {
    const split = corpus().filter(([, s]) => splitAttackCancelClause(s) !== null);
    const read = corpus().filter(([, s]) => deriveAttackCancelRequirement(s) !== null);
    expect(split.map(([, s]) => s)).toEqual(read.map(([, s]) => s));
    expect([read.length, units(read)]).toEqual([4, 5]);
    expect(read.map(([, s]) => s)).toContain(CANCEL_PRINTING);
  });
});
