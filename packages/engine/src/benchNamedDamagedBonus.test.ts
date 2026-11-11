import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackDamageBonus, ATTACK_READERS } from "./effects";
import type { BoardCondition, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./boardCondition";
import {
  BENCH_NAMED_DAMAGED_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  handUid,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
} from "./testFixtures";

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

const READERS = ATTACK_READERS.map(({ read }) => read);

const TAKEN =
  "If any of your Benched Cubone have any damage counters on them, this attack does 120 more damage.";
const TAKEN_CLAUSE = "any of your Benched Cubone have any damage counters on them";

const SIBLING_SENTENCES = [
  "If your Benched Pokémon have any damage counters on them, this attack does 120 more damage.",
  "If your Benched Pokémon have any damage counters on them, this attack does 80 more damage.",
  "If your Benched Pokémon have any damage counters on them, this attack does 90 more damage.",
] as const;

/** The printed control on the SAME body — index 0, no clause, no printed damage. */
const GROWL =
  "During your opponent's next turn, attacks used by the Defending Pokémon do 40 less damage (before applying Weakness and Resistance).";

const NAMED: BoardCondition = { kind: "yourBenchNamedDamaged", name: "Cubone" };
const ANY: BoardCondition = { kind: "yourBenchDamaged" };
const HAS_NAMED: BoardCondition = { kind: "yourBenchHasNamed", name: "Cubone" };
const COMPOSED: BoardCondition = { kind: "allOf", conditions: [HAS_NAMED, ANY] };

// ── boards ─────────────────────────────────────────────────────────────────────

function ready(seed: number, bench: readonly string[] = []): GameState {
  let state = driveSetup(
    seed,
    { p1: BENCH_NAMED_DAMAGED_DECK, p2: BENCH_NAMED_DAMAGED_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p1", "fix-bonevengeance");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  // …plus the {F} that pays the index-0 control, so BOTH printed attacks are legal on
  // every board here and §6's index guard is live on all of them rather than on one.
  state = attachFromDeck(state, "p1", "fix-fighting-energy", 1);
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

/** …two turns further on, which is what §5 needs: §4/§10 bar evolving on a seat's
    FIRST turn, and `armed` hands back exactly that turn. */
function armedLater(seed: number, bench: readonly string[] = []): GameState {
  let state = mustApply(armed(seed, bench), { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  return state;
}

/** Attack at `index` — **1** is the printed "Bone Vengeance" and **0** the printed
    control "Growl" — and report the damage actually dealt. */
function damageDealt(state: GameState, index = 1): number {
  const after = mustApply(state, { type: "attack", seat: "p1", index });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

/** The seat's opposite, spelled once — every board below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
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

  it("the UNFILTERED sibling is 3 printings and was ALREADY built — the price is one filter", () => {
    const sibling = corpus().filter(([, s]) =>
      s.includes("your Benched Pokémon have any damage counters on them"),
    );
    expect(sibling).toHaveLength(3);
    expect(units(sibling)).toBe(3);
    for (const sentence of SIBLING_SENTENCES) {
      expect(
        corpus().some(([, s]) => s === sentence),
        sentence,
      ).toBe(true);
      expect(deriveAttackDamageBonus(sentence)?.count).toEqual({
        kind: "boardCondition",
        cond: ANY,
      });
    }
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

  it("a TEMPLATE is refused by the CORPUS, not by the count — the slot is not a name slot", () => {
    const slot = (needle: string): number => corpus().filter(([, s]) => s.includes(needle)).length;
    expect(slot("Benched Ancient Pokémon")).toBeGreaterThanOrEqual(1);
    expect(slot("Benched Team Rocket's Pokémon")).toBeGreaterThanOrEqual(1);
    expect(slot("Benched Cynthia's Pokémon")).toBeGreaterThanOrEqual(1);
    expect(slot("Benched {F} Pokémon")).toBeGreaterThanOrEqual(1);
    // …and under THIS skeleton the printed population is exactly one, so there is no
    // second name to generalise from either.
    const shaped = corpus().filter(([, s]) => /^If any of your Benched /.test(s));
    expect(shaped).toHaveLength(1);
    expect(shaped[0]?.[1]).toBe(TAKEN);
  });
});

describe("§2 — the SHAPE question, measured on the running code rather than argued", () => {
  it("the NOTE clause dissents — ONE interpolation slot — and it is recorded, not hidden", () => {
    expect(conditionNote(ANY)).toBe("1 of your Benched Pokémon has damage counters on it");
    expect(conditionNote(NAMED)).toBe("1 of your Benched Cubone has damage counters on it");
    const slotted = (name: string): string => `1 of your Benched ${name} has damage counters on it`;
    expect(conditionNote(NAMED)).toBe(slotted("Cubone"));
    expect(conditionNote(ANY)).toBe(slotted("Pokémon"));
    // …and the note is read off the BOARD, so it does NOT round-trip to the clause key
    // (the key is the printed plural). Asserted rather than left for a successor to
    // "fix" one into the other.
    expect(conditionNote(NAMED)).not.toBe(TAKEN_CLAUSE);
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(NAMED)}, this attack does 120 more damage.`),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(ANY)}, this attack does 120 more damage.`),
    ).toBeNull();
  });

  it("the shipped sibling is UNTOUCHED — a second member edits ZERO of its sites", () => {
    expect(conditionNote(ANY)).toBe("1 of your Benched Pokémon has damage counters on it");
    for (const sentence of SIBLING_SENTENCES) {
      expect(deriveAttackDamageBonus(sentence)?.count).toEqual({
        kind: "boardCondition",
        cond: ANY,
      });
    }
    expect(
      deriveAttackDamageBonus(
        "If all of your Benched Pokémon have at least 1 damage counter on them, this attack does 120 more damage.",
      )?.count,
    ).toEqual({ kind: "boardCondition", cond: { kind: "yourBenchAllDamaged" } });
  });

  it("the POLARITY argument, on a board: the unnarrowed read is a DIFFERENT answer", () => {
    const state = armed(3970, ["fix-benchfiller"]);
    const hurt = setBenchDamage(state, "p1", 0, 30);
    expect(conditionHolds(hurt, "p1", ANY)).toBe(true);
    expect(conditionHolds(hurt, "p1", NAMED)).toBe(false);
  });
});

describe("§3 — `allOf` IS THE WRONG TOOL, refuted on a board rather than in a comment", () => {
  it("an UNDAMAGED Cubone beside a DAMAGED filler satisfies the composition and NOT the clause", () => {
    // THE BOARD THE WHOLE MEMBER EXISTS FOR. Both halves hold — a benched Cubone
    // exists, and a benched body is damaged — but they hold of DIFFERENT bodies, and
    // the printed clause asks for one body that is both.
    let state = armed(3971, ["fix-cubone", "fix-benchfiller"]);
    state = setBenchDamage(state, "p1", 1, 30);
    expect(conditionHolds(state, "p1", HAS_NAMED)).toBe(true);
    expect(conditionHolds(state, "p1", ANY)).toBe(true);
    expect(conditionHolds(state, "p1", COMPOSED)).toBe(true);
    expect(conditionHolds(state, "p1", NAMED)).toBe(false);
    expect(damageDealt(state)).toBe(60);
  });

  it("move the counters onto the CUBONE and every reading agrees again", () => {
    let state = armed(3972, ["fix-cubone", "fix-benchfiller"]);
    state = setBenchDamage(state, "p1", 0, 10);
    expect(conditionHolds(state, "p1", NAMED)).toBe(true);
    expect(conditionHolds(state, "p1", COMPOSED)).toBe(true);
    expect(damageDealt(state)).toBe(180);
  });

  it("the member IMPLIES the unfiltered sibling on every board this suite builds", () => {
    // The invariant a narrowing owes: `∃p. named(p) ∧ damaged(p)` cannot hold where
    // `∃p. damaged(p)` does not. Swept over the boards, both seats, rather than argued.
    const benches: readonly (readonly string[])[] = [
      [],
      ["fix-cubone"],
      ["fix-benchfiller"],
      ["fix-cubone", "fix-benchfiller"],
      ["fix-benchfiller", "fix-cubone"],
      ["fix-cubone", "fix-cubone"],
    ];
    let seen = 0;
    for (const [i, bench] of benches.entries()) {
      const base = armed(3980 + i, bench);
      for (let index = 0; index < bench.length; index += 1) {
        for (const damage of [0, 10, 120]) {
          const state = setBenchDamage(base, "p1", index, damage);
          for (const seat of ["p1", "p2"] as const) {
            if (conditionHolds(state, seat, NAMED)) {
              expect(conditionHolds(state, seat, ANY), `${bench.join()}/${index}/${damage}`).toBe(
                true,
              );
              seen += 1;
            }
          }
        }
      }
    }
    // …and the sweep is not vacuous: some board in it actually satisfied the member.
    expect(seen).toBeGreaterThan(0);
  });
});

describe("§4 — the member on the board: seat, zone, empty set", () => {
  it("own seat only — the opponent's damaged Cubone pays nothing", () => {
    let state = armed(3990, ["fix-cubone"]);
    state = setBenchDamage(state, "p1", 0, 20);
    expect(conditionHolds(state, "p1", NAMED)).toBe(true);
    expect(conditionHolds(state, other("p1"), NAMED)).toBe(false);
  });

  it("BENCH only — a damaged Cubone in the ACTIVE Spot does not satisfy it", () => {
    // The printed word is "Benched", and `yourBenchDamaged` / `yourBenchHasNamed`
    // exclude the Active for the same reason. Built by putting the Cubone in the spot
    // rather than by asserting the arm's shape.
    let state = armed(3991);
    state = setActiveFromDeck(state, "p1", "fix-cubone");
    state = clearBench(state, "p1");
    const active = state.players.p1.active;
    expect(active).not.toBeNull();
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, active: active === null ? null : { ...active, damage: 50 } },
      },
    };
    expect(conditionHolds(state, "p1", { kind: "yourActiveDamaged" })).toBe(true);
    expect(conditionHolds(state, "p1", NAMED)).toBe(false);
  });

  it("an EMPTY Bench is FALSE, and a Cubone with NO counters is FALSE", () => {
    expect(conditionHolds(armed(3992), "p1", NAMED)).toBe(false);
    expect(conditionHolds(armed(3993, ["fix-cubone"]), "p1", NAMED)).toBe(false);
    // …and the empty-Bench FALSE is forced rather than chosen: `∃` over the empty set.
    expect(conditionHolds(armed(3992), "p1", ANY)).toBe(false);
  });

  it("the NAME is exact and un-normalised — a damaged non-Cubone is FALSE at any amount", () => {
    const base = armed(3994, ["fix-benchfiller"]);
    for (const damage of [10, 50, 120]) {
      expect(conditionHolds(setBenchDamage(base, "p1", 0, damage), "p1", NAMED), `${damage}`).toBe(
        false,
      );
    }
    // …and a member asked for a name nothing on the Bench carries is FALSE even where
    // the Cubone reading is TRUE, which is what makes `name` a real parameter.
    let cubone = armed(3995, ["fix-cubone"]);
    cubone = setBenchDamage(cubone, "p1", 0, 10);
    expect(conditionHolds(cubone, "p1", NAMED)).toBe(true);
    expect(conditionHolds(cubone, "p1", { kind: "yourBenchNamedDamaged", name: "Marowak" })).toBe(
      false,
    );
    expect(conditionHolds(cubone, "p1", { kind: "yourBenchNamedDamaged", name: "cubone" })).toBe(
      false,
    );
  });
});

describe("§5 — the §1.2 STACK read, which is this member's whole behaviour", () => {
  it("evolving the damaged Cubone into Marowak KEEPS the counters and LOSES the clause", () => {
    let state = armedLater(3996, ["fix-cubone"]);
    state = setBenchDamage(state, "p1", 0, 30);
    expect(conditionHolds(state, "p1", NAMED)).toBe(true);
    expect(conditionHolds(state, "p1", HAS_NAMED)).toBe(true);
    expect(conditionHolds(state, "p1", ANY)).toBe(true);

    state = handFromDeck(state, "p1", "fix-bonevengeance", 1);
    const evolved = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "fix-bonevengeance"),
      target: { spot: "bench", index: 0 },
    }).state;

    // The counters are still there…
    expect(evolved.players.p1.bench[0]?.damage).toBe(30);
    expect(conditionHolds(evolved, "p1", ANY)).toBe(true);
    // …and the name is not, so the clause has stopped holding.
    expect(conditionHolds(evolved, "p1", HAS_NAMED)).toBe(false);
    expect(conditionHolds(evolved, "p1", NAMED)).toBe(false);
    expect(damageDealt(evolved)).toBe(60);
  });
});

describe("§6 — the printing end to end, at the index it is actually printed at", () => {
  it("60 with no damaged Cubone, 180 with one — attributable to the CLAUSE", () => {
    expect(damageDealt(armed(3997, ["fix-cubone"]))).toBe(60);
    let hurt = armed(3998, ["fix-cubone"]);
    hurt = setBenchDamage(hurt, "p1", 0, 10);
    expect(damageDealt(hurt)).toBe(180);
  });

  it("the clause sits at INDEX 1 and the index-0 control carries none of it", () => {
    // The guard against a card-keyed rather than index-keyed read: "Growl" is on the
    // same body, has no printed damage and no bonus clause, so a bonus that leaked
    // across indices would show up here as a number.
    let hurt = armed(3999, ["fix-cubone"]);
    hurt = setBenchDamage(hurt, "p1", 0, 10);
    expect(damageDealt(hurt, 0)).toBe(0);
    // …and the control sentence is nothing this reader claims.
    expect(deriveAttackDamageBonus(GROWL)).toBeNull();
  });
});

describe("§7 — the clause table: three readings of one array, mutually unreachable", () => {
  it("each of the three printed clauses resolves to its OWN member and no other", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: NAMED },
    });
    expect(deriveAttackDamageBonus(SIBLING_SENTENCES[0])).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: ANY },
    });
    expect(
      deriveAttackDamageBonus(
        "If all of your Benched Pokémon have at least 1 damage counter on them, this attack does 120 more damage.",
      ),
    ).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: { kind: "yourBenchAllDamaged" } },
    });
  });

  it("no OTHER reader claims the sentence, so nothing was widened by accident", () => {
    for (const read of READERS) {
      if (read === deriveAttackDamageBonus) continue;
      expect(read(TAKEN), read.name).toBeNull();
    }
  });

  it("the key is a WHOLE clause: neither a shortened nor a lengthened spelling reaches it", () => {
    // Keys are whole printed clauses and never substrings, which is what keeps the
    // three bench rows apart. Each of these is one printed word from the real key and
    // every one must stay LOUD.
    const nearMisses = [
      "any of your Benched Cubone have damage counters on them",
      "any of your Benched Cubone has any damage counters on them",
      "your Benched Cubone have any damage counters on them",
      "any of your Benched Marowak have any damage counters on them",
      "any of your opponent's Benched Cubone have any damage counters on them",
    ];
    for (const clause of nearMisses) {
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does 120 more damage.`),
        clause,
      ).toBeNull();
    }
  });
});
