import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { countAttachedEnergy, providedEnergy } from "./continuous";
import { deriveAttackDamageBonus } from "./effects";
import type { BoardCondition, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./boardCondition";
import {
  FIXTURE_POOL,
  TYPED_ENERGY_THRESHOLD_DECK,
  attachBenchFromDeck,
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
  "If this Pokémon has 2 or more {G} Energy attached, this attack does 120 more damage.";
const TAKEN_CLAUSE = "this Pokémon has 2 or more {G} Energy attached";

const TRAP_CLAUSE =
  "this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost)";

const COND: BoardCondition = { kind: "yourActiveEnergyAtLeast", energy: "Grass", count: 2 };
const BARE: BoardCondition = { kind: "yourActiveEnergyAtLeast", count: 2 };
const ANY_GRASS: BoardCondition = { kind: "yourActiveHasEnergyAttached", energy: "Grass" };

// ── boards ─────────────────────────────────────────────────────────────────────

function ready(
  seed: number,
  attach: Readonly<Record<string, number>>,
  opts: { ownBench?: readonly string[]; opponentAttach?: Readonly<Record<string, number>> } = {},
): GameState {
  let state = driveSetup(
    seed,
    { p1: TYPED_ENERGY_THRESHOLD_DECK, p2: TYPED_ENERGY_THRESHOLD_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p1", "fix-frozenwood");
  for (const [id, n] of Object.entries(attach)) state = attachFromDeck(state, "p1", id, n);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  for (const [id, n] of Object.entries(opts.opponentAttach ?? {})) {
    state = attachFromDeck(state, "p2", id, n);
  }
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of opts.ownBench ?? []) state = benchFromDeck(state, "p1", id);
  return state;
}

/** …and the same board handed to P1 with the turn already passed. P1 went SECOND, so
    this turn carries no §4 attack restriction. */
function armed(
  seed: number,
  attach: Readonly<Record<string, number>>,
  opts: Parameters<typeof ready>[2] = {},
): GameState {
  return mustApply(ready(seed, attach, opts), { type: "endTurn", seat: "p2" }).state;
}

function damageDealt(state: GameState, index = 1): number {
  const after = mustApply(state, { type: "attack", seat: "p1", index });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

/** The attacker's own body, for the direct `countAttachedEnergy` probes. */
function activeOf(state: GameState, seat: Seat = "p1") {
  const body = state.players[seat].active;
  if (body === null) throw new Error(`${seat} has no Active Pokémon`);
  return body;
}

describe("§1 — the price, RE-DERIVED: the residue, the band and the shape of the step", () => {
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

  it("it is the ONLY printed threshold of its shape, which is why the ROW is not short", () => {
    const thresholds = corpus().filter(([, s]) => /\d+ or more \S+ Energy attached/.test(s));
    expect(thresholds).toHaveLength(1);
    expect(thresholds[0]?.[1]).toBe(TAKEN);
    expect(corpus().filter(([, s]) => /has \d+ or more Energy attached/.test(s))).toHaveLength(0);
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
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([]);
    expect([...byClause.values()].filter((n) => n === 1)).toHaveLength(0);
    expect(byClause.has(TAKEN_CLAUSE)).toBe(false);
    expect(byClause.get(TRAP_CLAUSE)).toBeUndefined();
    expect(units(corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TRAP_CLAUSE))).toBe(5);
    expect(
      deriveAttackDamageBonus(`If ${TRAP_CLAUSE}, this attack does 100 more damage.`)?.count,
    ).toEqual({ kind: "extraEnergyUnitsBeyondCost", extra: 2 });
  });
});

describe("§2 — THE SHAPE CHOICE: an OPTIONAL FIELD, driven rather than argued", () => {
  it("the UNNARROWED member is untouched — same answer, same note, byte for byte", () => {
    const board = armed(4111, { "fix-water-energy": 3, "fix-energy": 1 });
    expect(countAttachedEnergy(board, activeOf(board), null)).toBe(4);
    expect(conditionHolds(board, "p1", BARE)).toBe(true);
    expect(conditionNote(BARE)).toBe("your Active Pokémon has 2 or more Energy attached");
    expect(conditionNote({ kind: "yourActiveEnergyAtLeast", count: 3 })).toBe(
      "your Active Pokémon has 3 or more Energy attached",
    );
  });

  it("ABSENT MEANS UNNARROWED, and the narrowing is MONOTONE on every board here", () => {
    const boards: readonly Readonly<Record<string, number>>[] = [
      { "fix-water-energy": 3, "fix-energy": 1 },
      { "fix-water-energy": 3, "fix-grass-energy": 1 },
      { "fix-water-energy": 3, "fix-grass-energy": 2 },
      { "fix-water-energy": 3, "fix-grassdouble": 1 },
    ];
    let strictlyNarrower = 0;
    for (const [i, attach] of boards.entries()) {
      const board = armed(4120 + i, attach);
      const bare = conditionHolds(board, "p1", BARE);
      const typed = conditionHolds(board, "p1", COND);
      expect(bare || !typed, JSON.stringify(attach)).toBe(true);
      if (bare && !typed) strictlyNarrower += 1;
    }
    // …and it is not VACUOUSLY monotone: three of the four boards separate them, so a
    // filter that silently did nothing would fail this line rather than pass it.
    expect(strictlyNarrower).toBe(3);
  });

  it("the note gains a SLOT, not a sentence — all three spellings from one string", () => {
    expect(conditionNote(COND)).toBe("your Active Pokémon has 2 or more Grass Energy attached");
    expect(conditionNote({ kind: "yourActiveEnergyAtLeast", count: 4, energy: "Water" })).toBe(
      "your Active Pokémon has 4 or more Water Energy attached",
    );
    expect(conditionNote({ kind: "yourActiveEnergyAtLeast", count: 2, energy: "special" })).toBe(
      "your Active Pokémon has 2 or more Special Energy attached",
    );
    expect(conditionNote(COND)).not.toContain("{G}");
  });

  it("a `count: 1` narrowing WOULD restate the neighbour — and nothing prints it", () => {
    const boards: readonly Readonly<Record<string, number>>[] = [
      { "fix-water-energy": 3, "fix-energy": 1 },
      { "fix-water-energy": 3, "fix-grass-energy": 1 },
      { "fix-water-energy": 3, "fix-grass-energy": 2 },
    ];
    for (const attach of boards) {
      const board = armed(4130, attach);
      expect(conditionHolds(board, "p1", { ...COND, count: 1 })).toBe(
        conditionHolds(board, "p1", ANY_GRASS),
      );
    }
    expect(corpus().filter(([, s]) => /has 1 or more \S+ Energy attached/.test(s))).toHaveLength(0);
  });
});

describe("§3 — the clause DRIVES, and the UNFILTERED reading is unconditional", () => {
  it("120 bare, 240 boosted, and the printed control attack moves neither", () => {
    // The `120+` marker is real: the reader consumes the "+" and attack.ts drops the
    // printed base into the gate, so both halves of the assembly are exercised.
    expect(damageDealt(armed(4141, { "fix-water-energy": 3, "fix-grass-energy": 2 }))).toBe(240);
    expect(damageDealt(armed(4142, { "fix-water-energy": 3, "fix-energy": 1 }))).toBe(120);
    // "Lunge Out" ({C}{C}{C}, a flat 90) is the printed control at index 0 — the same
    // body, the same board, a number this clause cannot reach.
    expect(damageDealt(armed(4143, { "fix-water-energy": 3, "fix-grass-energy": 2 }), 0)).toBe(90);
    expect(damageDealt(armed(4144, { "fix-water-energy": 3, "fix-energy": 1 }), 0)).toBe(90);
  });

  it("THE ATTRIBUTION CONTROL: dropping the filter pays the +120 on EVERY board", () => {
    const cost = FIXTURE_POOL["fix-frozenwood"]?.attacks?.[1]?.cost ?? [];
    expect(cost).toEqual(["Water", "Water", "Water", "Colorless"]);
    expect(cost).not.toContain("Grass");
    const boards: readonly Readonly<Record<string, number>>[] = [
      { "fix-water-energy": 3, "fix-energy": 1 },
      { "fix-water-energy": 3, "fix-grass-energy": 1 },
      { "fix-water-energy": 4 },
    ];
    for (const [i, attach] of boards.entries()) {
      const board = armed(4150 + i, attach);
      expect(damageDealt(board), JSON.stringify(attach)).toBe(120);
      // …and the unfiltered reading is TRUE on it, so the filter is the whole answer.
      expect(conditionHolds(board, "p1", BARE), JSON.stringify(attach)).toBe(true);
      expect(conditionHolds(board, "p1", COND), JSON.stringify(attach)).toBe(false);
    }
  });

  it("the THRESHOLD is a FLOOR, swept at the printed value and both neighbours", () => {
    for (let grass = 0; grass <= 3; grass += 1) {
      const attach: Record<string, number> = { "fix-water-energy": 3 };
      if (grass > 0) attach["fix-grass-energy"] = grass;
      else attach["fix-energy"] = 1;
      const board = armed(4160 + grass, attach);
      expect(countAttachedEnergy(board, activeOf(board), "Grass"), `grass=${grass}`).toBe(grass);
      for (const count of [1, 2, 3]) {
        expect(
          conditionHolds(board, "p1", { ...COND, count }),
          `grass=${grass} count=${count}`,
        ).toBe(grass >= count);
      }
    }
  });

  it("an EMPTY Active Spot is FALSE, not a throw and not a body holding zero", () => {
    // The standing rule for every body-reading member in this union, and unreachable
    // from the attack path (§8 guarantees an Active) — so only a direct probe sees it.
    const board = armed(4170, { "fix-water-energy": 3, "fix-grass-energy": 2 });
    const empty: GameState = {
      ...board,
      players: { ...board.players, p1: { ...board.players.p1, active: null } },
    };
    expect(conditionHolds(empty, "p1", COND)).toBe(false);
    expect(conditionHolds(empty, "p1", BARE)).toBe(false);
    // …and at a count of 0 as well, which is where a `?? 0` slip would answer TRUE.
    expect(conditionHolds(empty, "p1", { ...COND, count: 0 })).toBe(false);
  });
});

describe("§4 — CARDS, not UNITS — and the fixture that can tell them apart", () => {
  it("`fix-grassdouble` provides TWO {G} units from ONE card, and it counts ONE", () => {
    const board = armed(4180, { "fix-water-energy": 3, "fix-grassdouble": 1 });
    const body = activeOf(board);
    expect(providedEnergy(board, body).filter((u) => u === "Grass")).toHaveLength(2);
    expect(countAttachedEnergy(board, body, "Grass")).toBe(1);
    expect(countAttachedEnergy(board, body, null)).toBe(4);
    expect(conditionHolds(board, "p1", COND)).toBe(false);
    expect(damageDealt(board)).toBe(120);
  });

  it("TWO of them DO arm it — two cards, four units, and the cards are what count", () => {
    const board = armed(4181, { "fix-water-energy": 3, "fix-grassdouble": 2 });
    const body = activeOf(board);
    expect(providedEnergy(board, body).filter((u) => u === "Grass")).toHaveLength(4);
    expect(countAttachedEnergy(board, body, "Grass")).toBe(2);
    expect(damageDealt(board)).toBe(240);
  });

  it("`fix-blend` could NOT have asked this question, which is why a new row exists", () => {
    expect(FIXTURE_POOL["fix-grassdouble"]?.energyType).toBe("Special");
    const board = armed(4182, { "fix-water-energy": 3, "fix-grassdouble": 1 });
    const provided = providedEnergy(board, activeOf(board));
    // ONE card, TWO identical units — the duplicate survives `providedEnergy`'s
    // `flatMap`, which is what makes the disagreement measurable at all.
    expect(new Set(provided.filter((u) => u === "Grass")).size).toBe(1);
    expect(provided.filter((u) => u === "Grass")).toHaveLength(2);
  });

  it("PROVISION, not the printed card class: a Special counts toward a typed clause", () => {
    const specials = armed(4183, { "fix-water-energy": 3, "fix-grassdouble": 2 });
    const basics = armed(4184, { "fix-water-energy": 3, "fix-grass-energy": 2 });
    expect(conditionHolds(specials, "p1", COND)).toBe(true);
    expect(conditionHolds(basics, "p1", COND)).toBe(true);
    // …and the WATER attachments never count, on either board, which is the filter
    // doing its one job.
    expect(countAttachedEnergy(specials, activeOf(specials), "Water")).toBe(3);
    expect(countAttachedEnergy(basics, activeOf(basics), "Water")).toBe(3);
  });
});

describe("§5 — the ROW, its refusals, and why it is not a sixth TEMPLATE", () => {
  it("maps the printed sentence onto the narrowed member at the printed 120", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: COND },
    });
  });

  it("the TEMPLATE beside it shares BOTH anchors and still claims nothing here", () => {
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon has any {G} Energy attached, this attack does 120 more damage.",
      ),
    ).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: ANY_GRASS },
    });
    // …and the template does NOT answer the digit shape, on the very code it owns.
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon has any 2 or more {G} Energy attached, this attack does 120 more damage.",
      ),
    ).toBe(null);
  });

  it("a ROW is keyed WHOLE: the same shape at another code or another count is refused", () => {
    for (const clause of [
      "this Pokémon has 2 or more {R} Energy attached",
      "this Pokémon has 3 or more {G} Energy attached",
      "this Pokémon has 2 or more Grass Energy attached",
      "this Pokémon has 2 or more {C} Energy attached",
    ]) {
      expect(
        corpus().some(([, s]) => BONUS.exec(s.trim())?.[1] === clause),
        clause,
      ).toBe(false);
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does 120 more damage.`),
        clause,
      ).toBe(null);
    }
  });

  it("keeps the outer sentence anchors, so the row cannot be reached from a fragment", () => {
    for (const text of [
      `if ${TAKEN_CLAUSE}, this attack does 120 more damage.`,
      `If ${TAKEN_CLAUSE}, this attack does 120 more damage`,
      `If ${TAKEN_CLAUSE}, this attack does 120 more damage. Then, draw a card.`,
      `Flip a coin. If ${TAKEN_CLAUSE}, this attack does 120 more damage.`,
    ]) {
      expect(deriveAttackDamageBonus(text), text).toBe(null);
    }
  });

  it("the note does NOT round-trip to the row's key, and the key is not the note", () => {
    expect(TAKEN_CLAUSE).toContain("{G}");
    expect(conditionNote(COND)).toBe("your Active Pokémon has 2 or more Grass Energy attached");
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(COND)}, this attack does 120 more damage.`),
    ).toBe(null);
  });
});

describe("§6 — the ZONE and the SEAT: your ACTIVE's own attachments, and nothing else", () => {
  it("Grass on your own BENCH does not arm it", () => {
    // The near miss the import list makes available: `countEnergyInPlay` is one
    // identifier away in interpreter.ts and would read the whole SIDE. Every board
    // with an empty Bench is green either way, so this rung fields one deliberately.
    let state = ready(
      4191,
      { "fix-water-energy": 3, "fix-energy": 1 },
      { ownBench: ["fix-titan"] },
    );
    state = attachBenchFromDeck(state, "p1", 0, "fix-grass-energy", 2);
    const board = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    expect(countAttachedEnergy(board, activeOf(board), "Grass")).toBe(0);
    expect(conditionHolds(board, "p1", COND)).toBe(false);
    expect(damageDealt(board)).toBe(120);
  });

  it("Grass across the table does not arm it either", () => {
    const board = armed(
      4192,
      { "fix-water-energy": 3, "fix-energy": 1 },
      { opponentAttach: { "fix-grass-energy": 2 } },
    );
    expect(countAttachedEnergy(board, activeOf(board, "p2"), "Grass")).toBe(2);
    expect(conditionHolds(board, "p1", COND)).toBe(false);
    expect(conditionHolds(board, "p2", COND)).toBe(true);
    expect(damageDealt(board)).toBe(120);
  });

  it("…and the member is SEAT-RELATIVE, told apart on ONE board from BOTH seats", () => {
    const board = armed(
      4193,
      { "fix-water-energy": 3, "fix-grass-energy": 2 },
      { opponentAttach: { "fix-energy": 2 } },
    );
    expect(conditionHolds(board, "p1", COND)).toBe(true);
    expect(conditionHolds(board, "p2", COND)).toBe(false);
  });
});
