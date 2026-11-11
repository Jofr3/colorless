import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader as readByAny } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackDamageBonus,
  deriveAttackEffect,
  deriveAttackRequirement,
} from "./effects";
import type { BoardCondition, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./boardCondition";
import {
  STADIUM_PRESENCE_DECK,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
} from "./testFixtures";

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The two consequent skeletons, as labelled COPIES — the readers' own patterns are
    module-private. Whole-sentence anchored at BOTH ends, like theirs. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;
const NOTHING = /^If (.+), this attack does nothing\.$/;

const MOUNTAIN_DROP = "If a Stadium is in play, this attack does 70 more damage.";
const ASSAULT_LANDING = "If there is no Stadium in play, this attack does nothing.";
const EARTHEN_POWER = "If you have a Stadium in play, this attack does 80 more damage.";

const PRESENCE_CLAUSE = "a Stadium is in play";
const NO_PRESENCE_CLAUSE = "there is no Stadium in play";
const OWNERSHIP_CLAUSE = "you have a Stadium in play";

const PRESENT: BoardCondition = { kind: "stadiumInPlay" };
const OWNED: BoardCondition = { kind: "yourStadiumInPlay" };

const CEILING = [] as const;
const TAKEN_BY_D380 = ["Discard a Stadium in play.", "You may discard a Stadium in play."] as const;
const DISCARD_OP = [] as readonly string[];

const TAKEN_SINCE = [
  "You may discard a Stadium in play. If you do, this attack does 140 more damage.",
  "If a Stadium is in play, this attack does 60 more damage. Then, discard that Stadium.",
  "Discard a Stadium in play. If you can't, this attack does nothing.",
  "If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)",
] as const;

// ── boards ─────────────────────────────────────────────────────────────────────

/** Put a Beach Court (`sv01-167`) into `seat`'s hand and play it — the shared §7.3
    zone then carries `owner: seat`, which is the ONLY thing the two members read
    differently. */
function playStadium(state: GameState, seat: Seat): GameState {
  const withCard = handFromDeck(state, seat, "sv01-167", 1);
  const uid = handUid(withCard, seat, "sv01-167");
  return mustApply(withCard, { type: "playTrainer", seat, uid }).state;
}

function board(seed: number, owner: Seat | null = null): GameState {
  let state = driveSetup(
    seed,
    { p1: STADIUM_PRESENCE_DECK, p2: STADIUM_PRESENCE_DECK },
    { first: "p2" },
  );
  if (owner === "p2") state = playStadium(state, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  if (owner === "p1") state = playStadium(state, "p1");
  state = setActiveFromDeck(state, "p1", "fix-bigbody");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return state;
}

/** `board`, handed over to P2. The member is seat-INDEPENDENT on its face, and a
    P1-only suite cannot tell "reads the zone" apart from "reads p1's Stadium" — so
    every board reading is taken from the far seat too. */
function boardP2(seed: number, owner: Seat | null = null): GameState {
  return mustApply(board(seed, owner), { type: "endTurn", seat: "p1" }).state;
}

/** Field `cardId` in `seat`'s Active Spot and pay `spec` onto it symbol-for-symbol.
    Must run in that order: `attachFromDeck` attaches to whatever is Active. */
function fielded(
  state: GameState,
  seat: Seat,
  cardId: string,
  spec: readonly (readonly [string, number])[],
): GameState {
  let next = setActiveFromDeck(state, seat, cardId);
  for (const [id, count] of spec) next = attachFromDeck(next, seat, id, count);
  return next;
}

/** Probopass's body, paid `{C}{C}{C}`. */
const mountainDrop = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "fix-mountaindrop", [["fix-energy", 3]]);

/** Fan Rotom's body, paid `{C}`. */
const assaultLanding = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "fix-assaultland", [["fix-energy", 1]]);

/** Palossand's body, paid `{P}{C}{C}` — the OWNERSHIP control. */
const earthenPower = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "sv02-096", [
    ["fix-psychic-energy", 1],
    ["fix-energy", 2],
  ]);

describe("§1 — the price, RE-DERIVED: a 2:3 step whose CANCEL half is the bigger half", () => {
  it("the bonus residue steps by exactly ONE sentence and ONE printing", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !readByAny(s));
    expect(refused.some(([, s]) => s === MOUNTAIN_DROP)).toBe(false);
    expect(refused.length).toBe(0);
    expect(units(refused)).toBe(0);
  });

  it("the CANCEL residue steps TWICE as far — and D379 took the ONE left behind it", () => {
    const refused = corpus().filter(([, s]) => NOTHING.test(s.trim()) && !readByAny(s));
    expect(refused.some(([, s]) => s === ASSAULT_LANDING)).toBe(false);
    expect(refused).toEqual([]);
  });

  it("TWO sentences, THREE legal printings — 1 under the bonus and 2 under the cancel", () => {
    const bonusRows = corpus().filter(([, s]) => s === MOUNTAIN_DROP);
    expect(bonusRows).toHaveLength(1);
    expect(units(bonusRows)).toBe(1);
    const cancelRows = corpus().filter(([, s]) => s === ASSAULT_LANDING);
    expect(cancelRows).toHaveLength(1);
    expect(units(cancelRows)).toBe(2);
    expect(units(cancelRows)).toBeGreaterThan(units(bonusRows));
    expect(units(bonusRows) + units(cancelRows)).toBe(3);
    expect(corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === PRESENCE_CLAUSE)).toHaveLength(
      1,
    );
    expect(
      corpus().filter(([, s]) => NOTHING.exec(s.trim())?.[1] === NO_PRESENCE_CLAUSE),
    ).toHaveLength(1);
  });

  it("the requirement table's reach goes 7 s / 14 p → 8 s / 16 p, and D379 SATURATED it", () => {
    const openers = corpus().filter(([, s]) => /^If .+?, this attack does nothing\./.test(s));
    expect([openers.length, units(openers)]).toEqual([9, 18]);
    const mapped = openers.filter(([, s]) => deriveAttackRequirement(s) !== null);
    expect([mapped.length, units(mapped)]).toEqual([9, 18]);
    expect(mapped.some(([, s]) => s === ASSAULT_LANDING)).toBe(true);
    const unmapped = openers.filter(([, s]) => deriveAttackRequirement(s) === null);
    expect([unmapped.length, units(unmapped)]).toEqual([0, 0]);
    // The parts sum, which is what makes a partition a partition.
    expect(mapped.length + unmapped.length).toBe(openers.length);
    expect(units(mapped) + units(unmapped)).toBe(units(openers));
  });

  it("THE CEILING IS PRICED AND LEFT — 'discard that Stadium' is a WHOLE OP at 8 printings", () => {
    for (const sentence of CEILING) {
      const rows = corpus().filter(([, s]) => s === sentence);
      expect(rows, sentence).toHaveLength(1);
      expect(units(rows), sentence).toBe(1);
      expect(readByAny(sentence), sentence).toBe(false);
    }
    expect(CEILING).toHaveLength(0);
    const tingLu = TAKEN_SINCE[TAKEN_SINCE.length - 1] ?? "";
    expect(tingLu).toContain(
      "also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium.",
    );
    expect(corpus().filter(([, s]) => s === tingLu)).toEqual([[1, tingLu]]);
    expect(readByAny(tingLu)).toBe(true);
    expect(deriveAttackEffect(tingLu)).not.toBeNull();
    expect(deriveAttackBonusConsequent(tingLu)).toBeNull();
    const builtRows = corpus().filter(([, s]) => (TAKEN_BY_D380 as readonly string[]).includes(s));
    expect([builtRows.length, units(builtRows)]).toEqual([2, 6]);
    for (const [, s] of builtRows) expect(readByAny(s), s).toBe(true);
    const opRows = corpus().filter(([, s]) => (DISCARD_OP as readonly string[]).includes(s));
    expect(opRows).toHaveLength(0);
    expect(units(opRows)).toBe(0);
    const sinceRows = corpus().filter(([, s]) => (TAKEN_SINCE as readonly string[]).includes(s));
    expect([sinceRows.length, units(sinceRows)]).toEqual([4, 5]);
    const sinceDiscardFamily = sinceRows.filter(([, s]) => /iscard a Stadium in play/.test(s));
    expect([sinceDiscardFamily.length, units(sinceDiscardFamily)]).toEqual([2, 3]);
    expect([
      builtRows.length + opRows.length + sinceDiscardFamily.length,
      units(builtRows) + units(opRows) + units(sinceDiscardFamily),
    ]).toEqual([4, 9]);
    for (const [, s] of opRows) expect(readByAny(s), s).toBe(false);
    for (const [, s] of sinceRows) expect(readByAny(s), s).toBe(true);
    const anyStadium = corpus().filter(([, s]) => s.includes("Stadium"));
    expect(anyStadium).toHaveLength(9);
    const taken = anyStadium.filter(([, s]) => s === MOUNTAIN_DROP || s === ASSAULT_LANDING);
    const searchRow = anyStadium.filter(([, s]) =>
      s.startsWith("Search your deck for a Stadium card"),
    );
    expect(taken).toHaveLength(2);
    expect(searchRow).toHaveLength(1);
    expect(
      taken.length +
        searchRow.length +
        CEILING.length +
        DISCARD_OP.length +
        TAKEN_BY_D380.length +
        TAKEN_SINCE.length,
    ).toBe(anyStadium.length);
    expect(corpus().filter(([, s]) => /stadium/i.test(s))).toHaveLength(anyStadium.length);
  });
});

describe("§2 — the two keys, the printed BYTES, and two tables that must not meet", () => {
  it("maps the printed BONUS sentence onto the new member at the printed amount", () => {
    expect(deriveAttackDamageBonus(MOUNTAIN_DROP)).toEqual({
      per: 70,
      count: { kind: "boardCondition", cond: { kind: "stadiumInPlay" } },
    });
  });

  it("maps the printed NEGATION onto the POSITIVE member — the skeleton owns the 'no'", () => {
    expect(deriveAttackRequirement(ASSAULT_LANDING)).toEqual({ kind: "stadiumInPlay" });
    const bonus = deriveAttackDamageBonus(MOUNTAIN_DROP);
    expect(deriveAttackRequirement(ASSAULT_LANDING)).toEqual(
      bonus?.count.kind === "boardCondition" ? bonus.count.cond : null,
    );
  });

  it("the OWNERSHIP sentence still maps to the OWNERSHIP member — the row was not re-pointed", () => {
    // The half of "this is not a rename" that lives in the tables. Palossand's printed
    // sentence must keep answering `yourStadiumInPlay`; if a successor "simplifies"
    // the two rows into one, this is the assertion that reddens.
    expect(deriveAttackDamageBonus(EARTHEN_POWER)).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "yourStadiumInPlay" } },
    });
    expect(deriveAttackDamageBonus(EARTHEN_POWER)).not.toEqual(
      deriveAttackDamageBonus(MOUNTAIN_DROP),
    );
  });

  it("the KEYS are the printed bytes, pinned by CODE-POINT COUNT", () => {
    expect(MOUNTAIN_DROP).toHaveLength(57);
    expect(ASSAULT_LANDING).toHaveLength(57);
    expect(PRESENCE_CLAUSE).toHaveLength(20);
    expect(NO_PRESENCE_CLAUSE).toHaveLength(27);
    expect(BONUS.exec(MOUNTAIN_DROP)?.[1]).toBe(PRESENCE_CLAUSE);
    expect(NOTHING.exec(ASSAULT_LANDING)?.[1]).toBe(NO_PRESENCE_CLAUSE);
    for (const key of [PRESENCE_CLAUSE, NO_PRESENCE_CLAUSE]) {
      expect(key, key).not.toContain("'");
      expect(key, key).not.toContain("’");
      expect(key, key).not.toContain("é");
    }
    expect(OWNERSHIP_CLAUSE).toHaveLength(26);
    expect(OWNERSHIP_CLAUSE.endsWith(PRESENCE_CLAUSE.replace(" is in play", ""))).toBe(false);
    expect(OWNERSHIP_CLAUSE).toContain("Stadium in play");
    expect(PRESENCE_CLAUSE).not.toContain("you");
    expect(NO_PRESENCE_CLAUSE).not.toContain("you");
  });

  it("the two TABLES cannot reach each other — D125's disjointness, both directions", () => {
    expect(deriveAttackRequirement(`If ${PRESENCE_CLAUSE}, this attack does nothing.`)).toBeNull();
    expect(
      deriveAttackDamageBonus(`If ${NO_PRESENCE_CLAUSE}, this attack does 70 more damage.`),
    ).toBeNull();
    expect(deriveAttackRequirement(`If ${OWNERSHIP_CLAUSE}, this attack does nothing.`)).toBeNull();
    expect(deriveAttackDamageBonus(MOUNTAIN_DROP)).not.toBeNull();
    expect(deriveAttackRequirement(ASSAULT_LANDING)).not.toBeNull();
  });

  it("refuses five constructed rewrites the catalog does not print", () => {
    // Every one of these reads like the printed sentence and is not it. A substring or
    // fuzzy lookup would take at least three.
    for (const clause of [
      "a Stadium card is in play",
      "there is a Stadium in play",
      "a Stadium is in play for either player",
      "your opponent has a Stadium in play",
      "there is no Stadium card in play",
    ]) {
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does 70 more damage.`),
        clause,
      ).toBe(null);
      expect(deriveAttackRequirement(`If ${clause}, this attack does nothing.`), clause).toBeNull();
    }
  });

  it("the reject fragment is the printed clause verbatim — nothing to re-seat", () => {
    expect(conditionNote(PRESENT)).toBe(PRESENCE_CLAUSE);
    expect(conditionNote(OWNED)).toBe(OWNERSHIP_CLAUSE);
    expect(conditionNote(PRESENT)).not.toBe(conditionNote(OWNED));
  });
});

describe("§3 — PRESENCE vs OWNERSHIP on the shared zone, read from BOTH seats", () => {
  it("an EMPTY zone is false for both members and both seats", () => {
    const empty = board(70);
    expect(empty.stadium).toBeNull();
    for (const seat of ["p1", "p2"] as const) {
      expect(conditionHolds(empty, seat, PRESENT), seat).toBe(false);
      expect(conditionHolds(empty, seat, OWNED), seat).toBe(false);
    }
  });

  it("with the OPPONENT's Stadium out the two members DISAGREE — the board this slice exists for", () => {
    const p2Owns = board(71, "p2");
    expect(p2Owns.stadium?.owner).toBe("p2");
    // Presence is TRUE for the seat that does not own it…
    expect(conditionHolds(p2Owns, "p1", PRESENT)).toBe(true);
    // …and ownership is FALSE for that same seat on that same state. One `toBe` apart,
    // and an arm that kept the owner test answers `false` on the line above.
    expect(conditionHolds(p2Owns, "p1", OWNED)).toBe(false);
    expect(conditionHolds(p2Owns, "p1", PRESENT)).not.toBe(conditionHolds(p2Owns, "p1", OWNED));
  });

  it("PRESENCE is SEAT-INDEPENDENT and OWNERSHIP is not — swept over all three zone states", () => {
    // §7.3's zone is a shared singleton, so two seats can disagree about WHOSE it is
    // and never about whether one is there. This is the first member in the union
    // whose answer does not depend on `seat`, and the sweep is what says so.
    const boards: readonly (readonly [string, GameState])[] = [
      ["empty", board(72)],
      ["p1 owns", board(73, "p1")],
      ["p2 owns", board(74, "p2")],
    ];
    let disagreements = 0;
    for (const [label, state] of boards) {
      expect(conditionHolds(state, "p1", PRESENT), label).toBe(
        conditionHolds(state, "p2", PRESENT),
      );
      expect(conditionHolds(state, "p1", PRESENT), label).toBe(state.stadium !== null);
      if (conditionHolds(state, "p1", OWNED) !== conditionHolds(state, "p2", OWNED)) {
        disagreements += 1;
      }
    }
    expect(disagreements).toBe(2);
  });

  it("the ownership member's own reading is unchanged — Falkner's fact still holds", () => {
    const p1Owns = board(75, "p1");
    expect(conditionHolds(p1Owns, "p1", OWNED)).toBe(true);
    expect(conditionHolds(p1Owns, "p2", OWNED)).toBe(false);
    const p2Owns = board(76, "p2");
    expect(conditionHolds(p2Owns, "p2", OWNED)).toBe(true);
    expect(conditionHolds(p2Owns, "p1", OWNED)).toBe(false);
  });
});

describe("§4 — the BONUS consequent on a board: 70 → 140, with Palossand as the control", () => {
  it("with an EMPTY zone the printed 70 stands — and nothing is flagged", () => {
    const state = mountainDrop(board(77));
    expect(state.stadium).toBeNull();
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // `effectSimulated` / `modifierSimulated` ride `scaling !== null`, not on the
    // clause holding, so a false clause is still a SIMULATED outcome.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = findEvent(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 70, dealt: 70 });
    // `scaled` is omitted at 0 — the clause genuinely added nothing.
    expect(dealt?.scaled).toBeUndefined();
  });

  it("adds the whole printed 70 off the ATTACKER's own Stadium", () => {
    const { events } = mustApply(mountainDrop(board(78, "p1")), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 70, scaled: 70, dealt: 140 });
  });

  it("adds it off the OPPONENT's Stadium too — and Palossand's +80 does NOT, on the same board", () => {
    const base = board(79, "p2");
    expect(base.stadium?.owner).toBe("p2");
    const boosted = mustApply(mountainDrop(base), { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(boosted.events, "DAMAGE_DEALT")).toMatchObject({
      base: 70,
      scaled: 70,
      dealt: 140,
    });
    const control = mustApply(earthenPower(base), { type: "attack", seat: "p1", index: 1 });
    const controlHit = findEvent(control.events, "DAMAGE_DEALT");
    expect(controlHit).toMatchObject({ base: 80, dealt: 80 });
    expect(controlHit?.scaled).toBeUndefined();
    // Neither is flagged: both sentences are read, they just answer differently.
    expect(types(boosted.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(control.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("scores the same from the FAR SEAT — the reading is not p1's", () => {
    const { events } = mustApply(mountainDrop(boardP2(80, "p1"), "p2"), {
      type: "attack",
      seat: "p2",
      index: 0,
    });
    // P1 owns the Stadium and P2 is attacking, so this is the mirror of the case
    // above: presence holds, and it holds for the seat that did not play it.
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 70, scaled: 70, dealt: 140 });
  });
});

describe("§5 — the CANCEL consequent on a board: the zone is the gate", () => {
  it("CANCELS with an EMPTY zone, and the turn still ends", () => {
    const state = assaultLanding(board(81));
    expect(state.stadium).toBeNull();
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toContain("ATTACK_FAILED");
    expect(findEvent(events, "ATTACK_FAILED")).toMatchObject({ reason: "requirement" });
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("RESOLVES off the attacker's own Stadium — the polarity, the right way round", () => {
    const { events } = mustApply(assaultLanding(board(82, "p1")), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("ATTACK_FAILED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 70, dealt: 70 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("RESOLVES off the OPPONENT's Stadium — the attack a `yourStadiumInPlay` row would have CANCELLED", () => {
    const base = board(83, "p2");
    expect(base.stadium?.owner).toBe("p2");
    expect(conditionHolds(base, "p1", OWNED)).toBe(false);
    const { events } = mustApply(assaultLanding(base), { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_FAILED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 70, dealt: 70 });
  });

  it("cancels and resolves identically from the FAR SEAT", () => {
    const empty = mustApply(assaultLanding(boardP2(84), "p2"), {
      type: "attack",
      seat: "p2",
      index: 0,
    });
    expect(findEvent(empty.events, "ATTACK_FAILED")).toMatchObject({ reason: "requirement" });
    const occupied = mustApply(assaultLanding(boardP2(85, "p1"), "p2"), {
      type: "attack",
      seat: "p2",
      index: 0,
    });
    expect(types(occupied.events)).not.toContain("ATTACK_FAILED");
    expect(findEvent(occupied.events, "DAMAGE_DEALT")).toMatchObject({ base: 70, dealt: 70 });
  });
});

describe("§6 — what this slice did NOT buy", () => {
  it("bought no Stadium-DISCARD op, and the sentences that need one stay LOUD — D522: NONE is left, both lists are asserted EMPTY", () => {
    expect(CEILING.length + DISCARD_OP.length).toBe(0);
    for (const sentence of [...CEILING, ...DISCARD_OP]) {
      expect(readByAny(sentence), sentence).toBe(false);
    }
    // …and the positive half, so this rung cannot go green by refusing everything.
    for (const sentence of [...TAKEN_BY_D380, ...TAKEN_SINCE]) {
      expect(readByAny(sentence), sentence).toBe(true);
    }
  });

  it("bought no second Stadium member — the union gained ONE kind and the old one is untouched", () => {
    expect(
      corpus().some(([, s]) => (BONUS.exec(s.trim())?.[1] ?? "").includes("opponent's Stadium")),
    ).toBe(false);
    expect(conditionHolds(board(86, "p2"), "p1", OWNED)).toBe(false);
  });

  it("bought no play GATE — this member reaches the board through printed ATTACK text only", () => {
    // `conditionNote` is the reject fragment for a play gate, and no card carries this
    // one as one today. Pinned directly (as `boardCondition.test.ts` pins the other
    // unreachable arms) so a typo in player-facing copy cannot ship unseen.
    expect(conditionNote(PRESENT)).toBe("a Stadium is in play");
  });
});
