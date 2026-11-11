import { describe, expect, it } from "vitest";
import { cardOfUid } from "./cards";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackDamageBonus } from "./effects";
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./boardCondition";
import {
  FIXTURE_POOL,
  TR_ENERGY_DECK,
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
  "If this Pokémon has any Team Rocket's Energy attached, this attack does 60 more damage.";
const TAKEN_CLAUSE = "this Pokémon has any Team Rocket's Energy attached";

/** THE PRINTED CARD NAME the member keys on, spelled ONCE and asserted against the
    fixture the boards actually attach — so a typo cannot be green on both sides. */
const TR_ENERGY = "Team Rocket's Energy";

const NAMED: BoardCondition = { kind: "yourActiveHasNamedEnergyAttached", name: TR_ENERGY };
const SPECIAL: BoardCondition = { kind: "yourActiveHasEnergyAttached", energy: "special" };

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: TR_ENERGY_DECK, p2: TR_ENERGY_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because the member
    is seat-relative on the face of it and every board below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

function ready(seed: number, seat: Seat = "p1"): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, "fix-trbonus");
  state = attachFromDeck(state, seat, "fix-energy", 1);
  state = setActiveFromDeck(state, other(seat), "fix-bigbody");
  return clearBench(clearBench(state, seat), other(seat));
}

/** Attack index 0 from `seat` and report the damage actually dealt. */
function damageDealt(state: GameState, seat: Seat = "p1"): number {
  const after = mustApply(state, { type: "attack", seat, index: 0 });
  const dealt = after.events.find((e: GameEvent) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

function prefixReading(state: GameState, seat: Seat): boolean {
  const active = state.players[seat].active;
  if (active === null) return false;
  return active.energy.some(
    (uid) => cardOfUid(state, uid)?.name.startsWith("Team Rocket's ") === true,
  );
}

/** The names the engine can actually SEE on `seat`'s Active's attached Energy, read
    through the engine's own accessor rather than off the fixture table — which is
    what makes §2 a measurement of the SUPPLY rather than of this file. */
function attachedNames(state: GameState, seat: Seat): string[] {
  const active = state.players[seat].active;
  if (active === null) return [];
  return active.energy.map((uid) => cardOfUid(state, uid)?.name ?? "<unresolved>");
}

describe("§1 — the price, RE-DERIVED: a 1:2 step and the band down to three", () => {
  it("the residue steps by exactly this ONE sentence and TWO printings", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(refused.length).toBe(0);
    expect(units(refused)).toBe(0);

    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    const band = [...byClause].filter(([, n]) => n === 2).map(([clause]) => clause);
    expect(band).toEqual([]);
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([]);
    expect(byClause.size).toBe(0);
    expect([...byClause.values()]).toEqual([]);
  });

  it("ONE sentence, TWO printings — and the CLAUSE is the whole population", () => {
    const records = corpus().filter(([, s]) => s === TAKEN);
    expect(records).toHaveLength(1);
    expect(units(records)).toBe(2);
    const clauseRows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TAKEN_CLAUSE);
    expect(clauseRows).toHaveLength(1);
    expect(units(clauseRows)).toBe(2);
    const mentions = corpus().filter(([, s]) => s.includes(TR_ENERGY));
    expect(mentions).toHaveLength(2);
    expect(mentions.filter(([, s]) => s === TAKEN)).toHaveLength(1);
    expect(units(mentions.filter(([, s]) => s !== TAKEN))).toBe(3);
  });
});

describe("§2 — D207's SUPPLY question, asked of the field and answered on a board", () => {
  it("the engine can SEE a `Card.name` on an ATTACHED Energy — read back live", () => {
    const armed = attachFromDeck(ready(7400), "p1", "fix-tr-energy", 1);
    expect(attachedNames(armed, "p1")).toEqual(["fix-energy", TR_ENERGY]);
    expect(FIXTURE_POOL["fix-tr-energy"]?.name).toBe(TR_ENERGY);
    expect(FIXTURE_POOL["fix-tr-energy"]?.category).toBe("Energy");
  });

  it("…and the clause DRIVES: +60 with it attached, nothing without", () => {
    // The member and the printed consequent, on a real declaration. 10 base, so the
    // bonus cannot be confused with it.
    const bare = ready(7401);
    expect(conditionHolds(bare, "p1", NAMED)).toBe(false);
    expect(damageDealt(bare)).toBe(10);

    const armed = attachFromDeck(ready(7402), "p1", "fix-tr-energy", 1);
    expect(conditionHolds(armed, "p1", NAMED)).toBe(true);
    expect(damageDealt(armed)).toBe(70);

    // Both seats, because "this Pokémon" resolves to YOUR Active and a p1-only suite
    // cannot tell that from "p1's Active".
    const armedP2 = attachFromDeck(ready(7403, "p2"), "p2", "fix-tr-energy", 1);
    expect(conditionHolds(armedP2, "p2", NAMED)).toBe(true);
    expect(damageDealt(armedP2, "p2")).toBe(70);
  });

  it("an EMPTY Active Spot is FALSE, not a throw", () => {
    // Every card-reading member in this union answers false with no Active, and the
    // arm's early return is what makes that true here rather than a crash inside
    // `.some`.
    const armed = attachFromDeck(ready(7404), "p1", "fix-tr-energy", 1);
    const vacated: GameState = {
      ...armed,
      players: { ...armed.players, p1: { ...armed.players.p1, active: null } },
    };
    expect(conditionHolds(vacated, "p1", NAMED)).toBe(false);
    expect(prefixReading(vacated, "p1")).toBe(false);
  });
});

describe("§3 — THE SHAPE CHOICE: one NAME, not the prefix — with its attribution control", () => {
  it("a `Team Rocket's ⟨X⟩ Energy` does NOT arm it, and the prefix reading WOULD", () => {
    const other = attachFromDeck(ready(7500), "p1", "fix-tr-other-energy", 1);
    expect(attachedNames(other, "p1")).toEqual(["fix-energy", "Team Rocket's Fix Energy"]);
    expect(prefixReading(other, "p1")).toBe(true);
    expect(conditionHolds(other, "p1", NAMED)).toBe(false);
    expect(damageDealt(other)).toBe(10);
  });

  it("…and that is the ONLY board where the member and the prefix reading differ", () => {
    for (const attachments of [
      [],
      ["fix-tr-energy"],
      ["fix-special"],
      ["fix-not-tr-energy"],
      ["fix-tr-energy", "fix-special"],
      ["fix-special", "fix-not-tr-energy"],
      ["fix-tr-energy", "fix-tr-energy"],
    ]) {
      let state = ready(7501);
      for (const id of attachments) state = attachFromDeck(state, "p1", id, 1);
      expect(conditionHolds(state, "p1", NAMED), attachments.join("+")).toBe(
        prefixReading(state, "p1"),
      );
    }
    // …and the invented card is where they disagree. Asserted last, so the sweep
    // above is a statement about the real pool rather than about the predicate.
    const other = attachFromDeck(ready(7502), "p1", "fix-tr-other-energy", 1);
    expect(conditionHolds(other, "p1", NAMED)).not.toBe(prefixReading(other, "p1"));
  });

  it("the prefix must be neither `includes` nor `endsWith`: 'Rival of …' is refused", () => {
    const rival = attachFromDeck(ready(7503), "p1", "fix-not-tr-energy", 1);
    expect(attachedNames(rival, "p1")).toEqual(["fix-energy", "Rival of Team Rocket's Energy"]);
    expect(conditionHolds(rival, "p1", NAMED)).toBe(false);
    expect(prefixReading(rival, "p1")).toBe(false);
    expect(damageDealt(rival)).toBe(10);
    // …and the real card on the SAME shape of board is TRUE, so the loop is about the
    // name and not about the attachment machinery.
    const real = attachFromDeck(ready(7504), "p1", "fix-tr-energy", 1);
    expect(conditionHolds(real, "p1", NAMED)).toBe(true);
  });

  it("a second, DIFFERENT Energy alongside it does not disarm it", () => {
    // `.some`, not `.every`: the printed word is "any". A board carrying the named
    // card plus two decoys is still TRUE, and the decoys alone are still FALSE.
    let both = attachFromDeck(ready(7505), "p1", "fix-special", 1);
    both = attachFromDeck(both, "p1", "fix-tr-energy", 1);
    both = attachFromDeck(both, "p1", "fix-not-tr-energy", 1);
    expect(both.players.p1.active?.energy).toHaveLength(4);
    expect(conditionHolds(both, "p1", NAMED)).toBe(true);
    expect(damageDealt(both)).toBe(70);

    let decoys = attachFromDeck(ready(7506), "p1", "fix-special", 1);
    decoys = attachFromDeck(decoys, "p1", "fix-not-tr-energy", 1);
    expect(conditionHolds(decoys, "p1", NAMED)).toBe(false);
    expect(damageDealt(decoys)).toBe(10);
  });
});

describe("§4 — the near miss: a NAME against a PROVISION, on one board", () => {
  it('a plain Special satisfies `energy: "special"` and NOT this member', () => {
    const special = attachFromDeck(ready(7600), "p1", "fix-special", 1);
    expect(conditionHolds(special, "p1", SPECIAL)).toBe(true);
    expect(conditionHolds(special, "p1", NAMED)).toBe(false);
    expect(damageDealt(special)).toBe(10);
  });

  it("…and `Team Rocket's Energy` satisfies BOTH, which is why the pair is a pair", () => {
    // The named card IS a Special, so the wider member is true of it too. A guard that
    // only ever saw this board could not tell the two members apart at all — which is
    // why the board above exists and is asserted first.
    const named = attachFromDeck(ready(7601), "p1", "fix-tr-energy", 1);
    expect(conditionHolds(named, "p1", SPECIAL)).toBe(true);
    expect(conditionHolds(named, "p1", NAMED)).toBe(true);
    expect(damageDealt(named)).toBe(70);
  });

  it("a BASIC Energy satisfies neither, and pays the cost all the same", () => {
    const bare = ready(7602);
    expect(attachedNames(bare, "p1")).toEqual(["fix-energy"]);
    expect(conditionHolds(bare, "p1", SPECIAL)).toBe(false);
    expect(conditionHolds(bare, "p1", NAMED)).toBe(false);
    expect(damageDealt(bare)).toBe(10);
  });
});

describe("§5 — the ZONE and the SEAT: your ACTIVE, and nothing else", () => {
  it("the same card on your BENCH does not arm it", () => {
    let benched = benchFromDeck(ready(7700), "p1", "fix-basic-1");
    benched = attachBenchFromDeck(benched, "p1", 0, "fix-tr-energy", 1);
    expect(benched.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(conditionHolds(benched, "p1", NAMED)).toBe(false);
    expect(prefixReading(benched, "p1")).toBe(false);
    expect(damageDealt(benched)).toBe(10);
    // …and moving it to the ACTIVE arms it, so the rung is about the ZONE rather than
    // about the attachment never having landed.
    const active = attachFromDeck(ready(7701), "p1", "fix-tr-energy", 1);
    expect(conditionHolds(active, "p1", NAMED)).toBe(true);
  });

  it("the same card across the table does not arm it", () => {
    // Seat-relative, and asserted from BOTH seats on one board: the opponent's Active
    // holding the named Energy makes THEIR reading true and yours false.
    const theirs = attachFromDeck(ready(7702), "p2", "fix-tr-energy", 1);
    expect(conditionHolds(theirs, "p1", NAMED)).toBe(false);
    expect(conditionHolds(theirs, "p2", NAMED)).toBe(true);
    expect(damageDealt(theirs)).toBe(10);
  });

  it("a Pokémon TOOL slot is a different array and cannot reach it", () => {
    const armed = attachFromDeck(ready(7703), "p1", "fix-tr-energy", 1);
    const active = armed.players.p1.active;
    if (active === null) throw new Error("p1 has no Active Pokémon");
    const asTool: GameState = {
      ...armed,
      players: {
        ...armed.players,
        p1: {
          ...armed.players.p1,
          active: { ...active, energy: active.energy.slice(0, 1), tools: active.energy.slice(1) },
        },
      },
    };
    expect(asTool.players.p1.active?.tools).toHaveLength(1);
    expect(conditionHolds(armed, "p1", NAMED)).toBe(true);
    expect(conditionHolds(asTool, "p1", NAMED)).toBe(false);
  });
});

describe("§6 — the clause row, D118's refusal, the note and D154's fold", () => {
  it("maps the printed sentence onto the new member at the printed 60", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 60,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasNamedEnergyAttached", name: TR_ENERGY },
      },
    });
  });

  it("the TEMPLATE beside it still owns the energy TOKENS, and claims no name", () => {
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon has any {R} Energy attached, this attack does 90 more damage.",
      ),
    ).toEqual({
      per: 90,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "Fire" },
      },
    });
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon has any Special Energy attached, this attack does 140 more damage.",
      ),
    ).toEqual({
      per: 140,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "special" },
      },
    });
  });

  it("D118: an UNPRINTED energy NAME in the same shape resolves to NOTHING", () => {
    for (const near of [
      "If this Pokémon has any Fixmon's Energy attached, this attack does 60 more damage.",
      "If this Pokémon has any Team Rocket's Fix Energy attached, this attack does 60 more damage.",
      "If this Pokémon has any Team Rocket's Pokémon attached, this attack does 60 more damage.",
      "If this Pokémon has any Team Rocket's Energy attached, this attack does 60 less damage.",
      "If your opponent's Active Pokémon has any Team Rocket's Energy attached, this attack does 60 more damage.",
    ]) {
      expect(resolvedByAnyReader(near), near).toBe(false);
    }
    // …and the taken sentence IS resolved, so the loop above is a statement about
    // those five strings rather than about the reader being asleep.
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
  });

  it("the note names the CARD whole, and does not round-trip to the printed bytes", () => {
    expect(conditionNote(NAMED)).toBe("your Active Pokémon has a Team Rocket's Energy attached");
    expect(conditionNote(NAMED)).not.toBe(TAKEN_CLAUSE);
    expect(conditionNote(NAMED)).not.toBe(conditionNote(SPECIAL));
    expect(
      conditionNote({ kind: "yourActiveHasNamedEnergyAttached", name: "Fixmon's Energy" }),
    ).toBe("your Active Pokémon has a Fixmon's Energy attached");
  });

  it("D154's fold, on BOTH sides: a curled SENTENCE and a curled CARD NAME", () => {
    const curled = TAKEN.replaceAll("'", "’");
    expect(curled).toContain("’");
    expect(curled).not.toBe(TAKEN);
    expect(deriveAttackDamageBonus(curled)).toEqual(deriveAttackDamageBonus(TAKEN));

    // …and the CARD side, on a board: the same fixture with its NAME curled in the
    // state's own card pool, which is where `cardOfUid` reads it from.
    const armed = attachFromDeck(ready(7800), "p1", "fix-tr-energy", 1);
    const printed = armed.cardPool["fix-tr-energy"];
    if (printed === undefined) throw new Error("fix-tr-energy is not in the card pool");
    const curledBoard: GameState = {
      ...armed,
      cardPool: {
        ...armed.cardPool,
        "fix-tr-energy": { ...printed, name: printed.name.replaceAll("'", "’") },
      },
    };
    expect(attachedNames(curledBoard, "p1")[1]).toContain("’");
    expect(conditionHolds(curledBoard, "p1", NAMED)).toBe(true);
    expect(damageDealt(curledBoard)).toBe(70);
    // The fold is a NORMALISATION and not a wildcard: a differently-punctuated name is
    // still refused, so the arm has not been widened into an approximate match.
    const wrong: GameState = {
      ...armed,
      cardPool: {
        ...armed.cardPool,
        "fix-tr-energy": { ...printed, name: "Team Rockets Energy" },
      },
    };
    expect(conditionHolds(wrong, "p1", NAMED)).toBe(false);
  });
});
