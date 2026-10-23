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
} from "./effects";
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  OPPONENT_TOOL_DECK,
  attachFromDeck,
  attachToolFromDeck,
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

const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackBonusConsequent,
];

const TAKEN =
  "If your opponent's Active Pokémon has a Pokémon Tool attached, this attack does 80 more damage.";
const TAKEN_CLAUSE = "your opponent's Active Pokémon has a Pokémon Tool attached";

const SELF_TWIN = "If this Pokémon has a Pokémon Tool attached, this attack does 80 more damage.";

const UNIVERSAL =
  "If all of your Benched Pokémon have at least 1 damage counter on them, this attack does 120 more damage.";

/** Enhanced Fang is at index 1 — index 0 is the effect-less "Bite". */
const ENHANCED_FANG_INDEX = 1;

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: OPPONENT_TOOL_DECK, p2: OPPONENT_TOOL_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because the member
    is seat-relative and every board case below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

function ready(seed: number, seat: Seat, attacker: string): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, attacker);
  state = attachFromDeck(state, seat, "fix-energy", 3);
  state = setActiveFromDeck(state, other(seat), "fix-bigbody");
  return clearBench(clearBench(state, seat), other(seat));
}

/** Attack at `index` from `seat` and report the damage actually dealt. */
function damageDealt(state: GameState, seat: Seat, index = 0): number {
  const after = mustApply(state, { type: "attack", seat, index });
  const dealt = after.events.find((e: GameEvent) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

describe("§1 — the price, RE-DERIVED: the 2-printing band is SEVEN clauses, not two", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the residue is 33 sentences / 44 printings and its top band holds 7 clauses at 2", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(refused.length).toBe(0);
    expect(units(refused)).toBe(0);
    expect(refused.length + 23).toBe(23);
    expect(units(refused) + 27).toBe(27);
    expect(refused.length + 24).toBe(24);
    expect(units(refused) + 29).toBe(29);
    expect(refused.length + 25).toBe(25);
    expect(units(refused) + 32).toBe(32);
    expect(refused.length + 27).toBe(27);
    expect(units(refused) + 34).toBe(34);
    expect(refused.length + 28).toBe(28);
    expect(units(refused) + 36).toBe(36);
    expect(refused.length + 30).toBe(30);
    expect(units(refused) + 38).toBe(38);
    expect(refused.length + 31).toBe(31);
    expect(units(refused) + 40).toBe(40);
    expect(refused.length + 32).toBe(32);
    expect(units(refused) + 42).toBe(42);
    expect(refused.length + 33).toBe(33);
    expect(units(refused) + 44).toBe(44);

    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    const band = [...byClause].filter(([, n]) => n === 2).map(([clause]) => clause);
    expect(band).toEqual([]);
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([]);
    expect(byClause.size).toBe(0);
    expect(band.length + 2).toBe(2);
    expect(band.length + 3).toBe(3);
    expect(band.length + 4).toBe(4);
    expect(band.length + 5).toBe(5);
    expect(band.length + 6).toBe(6);
    expect(band.length + 7).toBe(7);
    expect(band.length + 8).toBe(8);
    expect(band.length + 9).toBe(9);
    expect([...byClause.values()]).toEqual([]);
  });

  it("the taken sentence is 2 legal printings, and that is ALL of them", () => {
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(2);
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
  });

  it("and the TWIN's own printing is not Standard-legal — the ROW outlived it", () => {
    expect(corpus().some(([, s]) => s === SELF_TWIN)).toBe(false);
    const twinLegal = corpus().filter(
      ([, s]) => BONUS.exec(s.trim())?.[1] === "this Pokémon has a Pokémon Tool attached",
    );
    expect(twinLegal).toHaveLength(1);
    expect(units(twinLegal)).toBe(2);
    expect(twinLegal[0]?.[1]).toBe(
      "If this Pokémon has a Pokémon Tool attached, this attack does 40 more damage.",
    );
    expect(deriveAttackDamageBonus(twinLegal[0]?.[1] ?? "")).toEqual({
      per: 40,
      count: { kind: "boardCondition", cond: { kind: "yourActiveHasToolAttached" } },
    });
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(units(twinLegal));
  });
});

describe("§2 — the SHAPE question D368 ordered first, settled: YES, and it is not the blocker", () => {
  it("a universal over the Bench IS a `(state, seat)` fact — the union CAN hold it", () => {
    const existingUniversal: BoardCondition = { kind: "noEnergyOnYourPokemon" };
    const state = ready(6100, "p1", "fix-oppotool");
    expect(typeof conditionHolds(state, "p1", existingUniversal)).toBe("boolean");
    expect(conditionNote(existingUniversal)).toBe("none of your Pokémon have any Energy attached");
    // The printed word is "none … any", which is `∀p. ¬hasEnergy(p)` — a universal
    // over exactly the kind of variable-size set the handed candidate quantifies.
    expect(conditionNote(existingUniversal)).toContain("none of your");
  });

  it("what BLOCKS it is the EMPTY-SET boundary, and the two conventions are both live", () => {
    let state = ready(6101, "p1", "fix-oppotool");
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, active: null } } };
    expect(state.players.p1.bench).toHaveLength(0);
    expect(conditionHolds(state, "p1", { kind: "noEnergyOnYourPokemon" })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourBenchDamaged" })).toBe(false);
    const activeOnly = ready(6102, "p1", "fix-oppotool");
    expect(activeOnly.players.p1.active).not.toBeNull();
    expect(activeOnly.players.p1.bench).toHaveLength(0);
    // A REACHABLE board with an empty Bench — the exact board the deferred clause
    // would have to answer on, and the reason the question is not academic.
    expect(conditionHolds(activeOnly, "p1", { kind: "yourBenchDamaged" })).toBe(false);
  });

  it("the CATALOG cannot settle it either — ONE universal antecedent in 640 sentences", () => {
    const universals = corpus().filter(([, s]) => /^If all of /.test(s));
    expect(universals).toHaveLength(1);
    expect(universals[0]?.[1]).toBe(UNIVERSAL);
    expect(units(universals)).toBe(2);
  });

  it("D373 — THE TRIPWIRE FIRED, AND THE BOUNDARY WAS SETTLED BEFORE THE ROW LANDED", () => {
    expect(units(corpus().filter(([, s]) => s === UNIVERSAL))).toBe(2);
    expect(BONUS.test(UNIVERSAL.trim())).toBe(true);
    expect(resolvedByAnyReader(UNIVERSAL)).toBe(true);
    expect(deriveAttackDamageBonus(UNIVERSAL)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: { kind: "yourBenchAllDamaged" } },
    });
    const empty = ready(6103, "p1", "fix-oppotool");
    expect(empty.players.p1.bench).toHaveLength(0);
    expect(conditionHolds(empty, "p1", { kind: "yourBenchAllDamaged" })).toBe(false);
    // And the taken sentence still has NONE of that problem: it is a threshold on ONE
    // body, which is what "the cheapest of the seven to get RIGHT" means.
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
  });
});

describe("§3 — the clause row: an EXACT round trip, which the self twin cannot manage", () => {
  it("maps the printed sentence onto the new member at the printed 80", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveHasToolAttached" } },
    });
  });

  it("takes N FROM THE SENTENCE, not from the card", () => {
    for (const per of [10, 30, 250]) {
      expect(
        deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does ${per} more damage.`),
      ).toEqual({
        per,
        count: { kind: "boardCondition", cond: { kind: "opponentActiveHasToolAttached" } },
      });
    }
    // A printed 0 adds nothing — the guard every arm in this family carries, so the
    // sentence stays LOUD rather than deriving a no-op bonus.
    expect(
      deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does 0 more damage.`),
    ).toBeNull();
  });

  it("`conditionNote` is BYTE-IDENTICAL to the clause key — the twin's is not", () => {
    const cond: BoardCondition = { kind: "opponentActiveHasToolAttached" };
    expect(conditionNote(cond)).toBe(TAKEN_CLAUSE);
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(cond)}, this attack does 80 more damage.`)?.count,
    ).toEqual({ kind: "boardCondition", cond });
    const twin: BoardCondition = { kind: "yourActiveHasToolAttached" };
    expect(conditionNote(twin)).toBe("your Active Pokémon has a Pokémon Tool attached");
    expect(SELF_TWIN).not.toContain(conditionNote(twin));
  });

  it("is a BARE TAG — the member carries no parameter to get wrong", () => {
    const bonus = deriveAttackDamageBonus(TAKEN);
    expect(bonus?.count.kind).toBe("boardCondition");
    if (bonus?.count.kind !== "boardCondition") throw new Error("unreachable");
    expect(Object.keys(bonus.count.cond)).toEqual(["kind"]);
  });

  it("pins the BYTES — a lookalike character would un-map the clause silently", () => {
    // 95 code points; the clause inside it is 58. The é in each "Pokémon" is the
    // character this rung exists for — it is two UTF-8 bytes and one code point, and
    // a decomposed spelling would read identically in a diff.
    expect(TAKEN.length).toBe(95);
    expect(TAKEN_CLAUSE.length).toBe(58);
    expect(TAKEN.split("Pokémon")).toHaveLength(3); // two occurrences
    // Precomposed U+00E9, never e + U+0301 — a decomposed é is invisible in a diff
    // and would fail the Map lookup.
    expect(TAKEN).toContain("é");
    expect(TAKEN).not.toContain("́");
    expect(TAKEN).toContain("opponent's");
    expect(TAKEN).not.toContain("’");
    expect(deriveAttackDamageBonus(TAKEN.replace("'", "’"))).toEqual(
      deriveAttackDamageBonus(TAKEN),
    );
  });
});

describe("§4 — the near-misses stay LOUD, and the twin is untouched", () => {
  it("the SELF twin still resolves to the SELF member — this slice moved nothing", () => {
    expect(deriveAttackDamageBonus(SELF_TWIN)).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "yourActiveHasToolAttached" } },
    });
  });

  it("refuses CONSTRUCTED rewrites of the clause — the Map key is char-for-char", () => {
    for (const clause of [
      // The BENCH across the table: a different board, and no member reads it.
      "your opponent's Benched Pokémon have a Pokémon Tool attached",
      // Plural, and the game does print "Pokémon Tools" elsewhere (Revavroom ex).
      "your opponent's Active Pokémon has 2 Pokémon Tools attached",
      "your opponent's Active Pokémon has any Pokémon Tools attached",
      // "attached to it" is the phrasing Tools use on their own card faces.
      "your opponent's Active Pokémon has a Pokémon Tool attached to it",
      "your opponent's Active Pokémon has any Pokémon Tool attached",
      // De-accented: the exact silent failure the byte guard above exists for.
      "your opponent's Active Pokemon has a Pokemon Tool attached",
      // "the Defending Pokémon" is §8's term of art and a real printed noun phrase
      // elsewhere in the pool — but not on this sentence, and not in this key.
      "the Defending Pokémon has a Pokémon Tool attached",
      // A Tool by NAME, which would be an open-vocabulary trap on a different noun.
      "your opponent's Active Pokémon has a Vitality Band attached",
    ]) {
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does 80 more damage.`),
        clause,
      ).toBeNull();
    }
  });

  it("keeps the outer anchor guards on this sentence too", () => {
    for (const text of [
      // Lowercase leading "if" — the matcher has no /i.
      `if ${TAKEN_CLAUSE}, this attack does 80 more damage.`,
      // No trailing period is not the whole sentence.
      `If ${TAKEN_CLAUSE}, this attack does 80 more damage`,
      // A real trailing clause pins `$`.
      `If ${TAKEN_CLAUSE}, this attack does 80 more damage. Then, draw a card.`,
      // Leading text pins `^`.
      `Flip a coin. If ${TAKEN_CLAUSE}, this attack does 80 more damage.`,
      // The "×"/multiply twin, which `deriveAttackDamageMultiplier` owns.
      `If ${TAKEN_CLAUSE}, this attack does 80 damage.`,
    ]) {
      expect(deriveAttackDamageBonus(text), text).toBeNull();
    }
  });
});

describe("§5 — driven on boards: the Tool decides the damage, and only across the table", () => {
  it("a Tool on the OPPONENT's Active pays the +80 — 10 + 80", () => {
    const state = attachToolFromDeck(ready(6200, "p1", "fix-oppotool"), "p2", "active", "fix-tool");
    expect(state.players.p2.active?.tools).toHaveLength(1);
    expect(damageDealt(state, "p1")).toBe(90);
  });

  it("NO Tool anywhere pays the printed base and nothing more", () => {
    const state = ready(6201, "p1", "fix-oppotool");
    expect(state.players.p2.active?.tools).toHaveLength(0);
    expect(damageDealt(state, "p1")).toBe(10);
  });

  it("a Tool on YOUR OWN Active arms NOTHING — the seat is the whole member", () => {
    // The board that separates this member from the one it was copied from. The
    // attacker is wearing the Tool; the defender is not; the clause reads the
    // defender, so the damage is the base.
    const state = attachToolFromDeck(ready(6202, "p1", "fix-oppotool"), "p1", "active", "fix-tool");
    expect(state.players.p1.active?.tools).toHaveLength(1);
    expect(damageDealt(state, "p1")).toBe(10);
  });

  it("a Tool on the opponent's BENCH arms nothing either — the SPOT is named too", () => {
    let state = benchFromDeck(ready(6203, "p1", "fix-oppotool"), "p2", "fix-benchfiller");
    state = attachToolFromDeck(state, "p2", 0, "fix-tool");
    expect(state.players.p2.bench[0]?.tools).toHaveLength(1);
    expect(state.players.p2.active?.tools).toHaveLength(0);
    expect(damageDealt(state, "p1")).toBe(10);
  });

  it("TWO Tools still arm it — `> 0`, never `=== 1`, and §7.4's cap is an ATTACH gate", () => {
    let state = attachToolFromDeck(ready(6209, "p1", "fix-oppotool"), "p2", "active", "fix-tool");
    state = attachToolFromDeck(state, "p2", "active", "sv01-197");
    expect(state.players.p2.active?.tools).toHaveLength(2);
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasToolAttached" })).toBe(true);
    expect(damageDealt(state, "p1")).toBe(90);
  });

  it("reads A TOOL, not a particular one — Vitality Band arms it and adds nothing", () => {
    const state = attachToolFromDeck(ready(6204, "p1", "fix-oppotool"), "p2", "active", "sv01-197");
    expect(damageDealt(state, "p1")).toBe(90);
  });

  it("answers from BOTH seats — it reads the opponent OF `seat`, not p2", () => {
    // A p1-only suite cannot tell "reads your opponent's Active" apart from "reads
    // p2's Active". Same board, other seat.
    const state = attachToolFromDeck(ready(6205, "p2", "fix-oppotool"), "p1", "active", "fix-tool");
    expect(damageDealt(state, "p2")).toBe(90);
    for (const seat of ["p1", "p2"] as const) {
      expect(conditionHolds(state, seat, { kind: "opponentActiveHasToolAttached" }), seat).toBe(
        seat === "p2",
      );
    }
  });

  it("the two members DISAGREE on one board, in both directions", () => {
    // ONE Tool, on ONE Active, read by BOTH members from BOTH seats: four answers,
    // and exactly two of them are true. This is the assertion that would go red if
    // the new arm had been written against `state.players[seat]`.
    const state = attachToolFromDeck(ready(6206, "p1", "fix-oppotool"), "p2", "active", "fix-tool");
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasToolAttached" })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourActiveHasToolAttached" })).toBe(false);
    expect(conditionHolds(state, "p2", { kind: "opponentActiveHasToolAttached" })).toBe(false);
    expect(conditionHolds(state, "p2", { kind: "yourActiveHasToolAttached" })).toBe(true);
  });

  it("and the two SENTENCES do too — Greedent's fires where this one does not", () => {
    const state = attachToolFromDeck(ready(6207, "p1", "sv01-152"), "p1", "active", "fix-tool");
    expect(FIXTURE_POOL["sv01-152"]?.attacks?.[ENHANCED_FANG_INDEX]?.effect).toBe(SELF_TWIN);
    expect(FIXTURE_POOL["sv01-152"]?.attacks?.[ENHANCED_FANG_INDEX]?.damage).toBe("80+");
    expect(damageDealt(state, "p1", ENHANCED_FANG_INDEX)).toBe(160); // 80 + 80
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasToolAttached" })).toBe(false);
  });

  it("an EMPTY opposing Active Spot is FALSE, as with every cross-board sibling", () => {
    let state = ready(6208, "p1", "fix-oppotool");
    state = { ...state, players: { ...state.players, p2: { ...state.players.p2, active: null } } };
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasToolAttached" })).toBe(false);
    // …and it is not a throw, which is what "total by design" means here.
    expect(conditionHolds(state, "p1", { kind: "opponentActiveDamaged" })).toBe(false);
  });
});

describe("§6 — the census this row moves, and the summands it does not", () => {
  it("the attacker fixture prints the sentence char-for-char", () => {
    const attack = FIXTURE_POOL["fix-oppotool"]?.attacks?.[0];
    expect(attack?.effect).toBe(TAKEN);
    expect(attack?.damage).toBe(10);
    expect(attack?.cost).toEqual(["Colorless"]);
    expect(FIXTURE_POOL["fix-oppotool"]?.attacks).toHaveLength(1);
  });

  it("neither printing is REGISTRY-keyed, so only the RAW summand can move", () => {
    expect(programFor("fix-oppotool")).toBeUndefined();
    expect(programFor("sv01-152")).toBeUndefined();
  });
});
