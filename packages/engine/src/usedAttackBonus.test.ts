import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackDamageBonus } from "./effects";
import type { BoardCondition, GameAction, GameState, PendingStage, Seat } from "./index";
import { applyAction } from "./index";
import { conditionHolds, conditionNote } from "./boardCondition";
import {
  FIXTURE_POOL,
  USED_ATTACK_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setConditions,
} from "./testFixtures";

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

const FALINKS =
  "If this Pokémon used Form Ranks during your last turn, this attack does 90 more damage.";
const FALINKS_CLAUSE = "this Pokémon used Form Ranks during your last turn";
const WEEZING =
  "If this Pokémon used Pervasive Gas during your last turn, this attack does 120 more damage.";
const WEEZING_CLAUSE = "this Pokémon used Pervasive Gas during your last turn";

const ROLLOUT = "You can use this attack only if this Pokémon used Rollout during your last turn.";
const ANGELITE =
  "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck. If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.";
const ANCIENT =
  "If 1 of your other Ancient Pokémon used an attack during your last turn, this attack does 150 more damage.";

const FORM_RANKS: BoardCondition = {
  kind: "yourActiveUsedAttackLastTurn",
  attack: "Form Ranks",
};
const PERVASIVE_GAS: BoardCondition = {
  kind: "yourActiveUsedAttackLastTurn",
  attack: "Pervasive Gas",
};

// ── boards ─────────────────────────────────────────────────────────────────────

function step(state: GameState, action: GameAction): GameState {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}`);
  return result.state;
}

function drain(state: GameState): GameState {
  let next = state;
  for (let guard = 0; guard < 10; guard += 1) {
    const phase = next.phase;
    if (phase.kind === "effect:choose") {
      next = step(next, {
        type: "resolveEffect",
        seat: phase.seat,
        choice: { kind: "cards", uids: [] },
      });
      continue;
    }
    if (phase.kind === "ko:takePrizes") {
      next = step(next, {
        type: "takePrizes",
        seat: phase.seat,
        prizeIndices: Array.from({ length: phase.count }, (_, index) => index),
      });
      continue;
    }
    if (phase.kind === "ko:promote") {
      next = step(next, { type: "promote", seat: phase.seat, benchIndex: 0 });
      continue;
    }
    return next;
  }
  throw new Error("drain did not settle");
}

function ready(
  seed: number,
  opts: { active: string; defender?: string; defenderBench?: readonly string[] },
): GameState {
  let state = driveSetup(seed, { p1: USED_ATTACK_DECK, p2: USED_ATTACK_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", opts.active);
  state = setActiveFromDeck(state, "p2", opts.defender ?? "fix-titan");
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of opts.defenderBench ?? []) state = benchFromDeck(state, "p2", id);
  state = attachFromDeck(state, "p1", "fix-dark-energy", 3);
  return attachFromDeck(state, "p1", "fix-energy", 3);
}

function attack(state: GameState, index: number): { dealt: number; state: GameState } {
  const after = mustApply(state, { type: "attack", seat: "p1", index });
  const row = after.events.find((event) => event.type === "DAMAGE_DEALT") as
    | { dealt?: number }
    | undefined;
  return { dealt: row?.dealt ?? 0, state: drain(after.state) };
}

/** Hand the turn back to P1 from the board `attack` left behind (P1's attack
    already ended P1's turn, so this is P2's pass and nothing else). */
function backToP1(state: GameState): GameState {
  return drain(mustApply(state, { type: "endTurn", seat: "p2" }).state);
}

const activeOf = (state: GameState, seat: Seat) => state.players[seat].active;

// ────────────────────────────────────────────────────────────────────────────
describe("§1 — the price, RE-DERIVED off the corpus rather than inherited", () => {
  it("the PAIR is real, is worth 2 printings, and both reached the SKELETON all along", () => {
    for (const [sentence, clause, amount] of [
      [FALINKS, FALINKS_CLAUSE, "90"],
      [WEEZING, WEEZING_CLAUSE, "120"],
    ] as const) {
      expect(corpus().filter(([, s]) => s === sentence)).toHaveLength(1);
      expect(units(corpus().filter(([, s]) => s === sentence))).toBe(1);
      // Both were refused at the CLAUSE, not at the skeleton: the bonus pattern
      // always matched and always captured the printed amount.
      expect(BONUS.test(sentence)).toBe(true);
      expect(BONUS.exec(sentence)?.[1]).toBe(clause);
      expect(BONUS.exec(sentence)?.[2]).toBe(amount);
    }
    const pair = corpus().filter(([, s]) => s === FALINKS || s === WEEZING);
    expect(pair).toHaveLength(2);
    expect(units(pair)).toBe(2);
    expect(new Set(pair.map(([, s]) => BONUS.exec(s)?.[2]))).toEqual(new Set(["90", "120"]));
  });

  it("the `during your last turn` family is 5 sentences / 7 units: Rollout and Angelite are off the readers, Ancient resolves on one", () => {
    const family = corpus().filter(([, s]) => s.includes("during your last turn"));
    expect(family).toHaveLength(5);
    expect(units(family)).toBe(7);
    expect(new Set(family.map(([, s]) => s))).toEqual(
      new Set([FALINKS, WEEZING, ROLLOUT, ANGELITE, ANCIENT]),
    );
    for (const sentence of [ROLLOUT, ANGELITE]) {
      expect(resolvedByAnyReader(sentence), sentence).toBe(false);
    }
    expect(resolvedByAnyReader(ANCIENT), ANCIENT).toBe(true);
    expect(BONUS.test(ROLLOUT.trim())).toBe(false);
    expect(BONUS.test(ANGELITE.trim())).toBe(false);
    expect(BONUS.test(ANCIENT.trim())).toBe(true);
    expect(BONUS.exec(ANCIENT.trim())?.[1]).toBe(
      "1 of your other Ancient Pokémon used an attack during your last turn",
    );
    expect(units(corpus().filter(([, s]) => s === ROLLOUT))).toBe(1);
    expect(units(corpus().filter(([, s]) => s === ANGELITE))).toBe(3);
    expect(units(corpus().filter(([, s]) => s === ANCIENT))).toBe(1);
  });

  it("the residue steps by exactly TWO sentences and TWO printings", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 9 / 12 could not tell "the two rows landed" from "a reader broke".
    expect(refused.some(([, s]) => s === FALINKS)).toBe(false);
    expect(refused.some(([, s]) => s === WEEZING)).toBe(false);
    expect(resolvedByAnyReader(FALINKS)).toBe(true);
    expect(resolvedByAnyReader(WEEZING)).toBe(true);
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

// ────────────────────────────────────────────────────────────────────────────
describe("§2 — the SHAPE questions, measured on the running code rather than argued", () => {
  it("ONE member serves BOTH printings — the pair shares a `kind` and differs in `attack`", () => {
    expect(deriveAttackDamageBonus(FALINKS)).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: FORM_RANKS },
    });
    expect(deriveAttackDamageBonus(WEEZING)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: PERVASIVE_GAS },
    });
    expect(FORM_RANKS.kind).toBe(PERVASIVE_GAS.kind);
  });

  it("the payload field is `attack` and NOT `name` — D392's rule, applied to a NEIGHBOUR", () => {
    expect(Object.keys(FORM_RANKS).sort()).toEqual(["attack", "kind"]);
    expect("name" in FORM_RANKS).toBe(false);
    const neighbour: BoardCondition = {
      kind: "yourActiveEvolvedFromThisTurn",
      name: "Gimmighoul",
    };
    expect(Object.keys(neighbour).sort()).toEqual(["kind", "name"]);
  });

  it("the note takes a SLOT, not a second SENTENCE — and round-trips to BOTH keys", () => {
    expect(conditionNote(FORM_RANKS)).toBe(
      "your Active Pokémon used Form Ranks during your last turn",
    );
    expect(conditionNote(PERVASIVE_GAS)).toBe(
      "your Active Pokémon used Pervasive Gas during your last turn",
    );
    expect(conditionNote(FORM_RANKS).replace("your Active Pokémon", "this Pokémon")).toBe(
      FALINKS_CLAUSE,
    );
    expect(conditionNote(PERVASIVE_GAS).replace("your Active Pokémon", "this Pokémon")).toBe(
      WEEZING_CLAUSE,
    );
    // The round trip through the table, at the PRINTED clause rather than the note.
    expect(
      deriveAttackDamageBonus(`If ${FALINKS_CLAUSE}, this attack does 90 more damage.`)?.count,
    ).toEqual({ kind: "boardCondition", cond: FORM_RANKS });
    expect(
      deriveAttackDamageBonus(`If ${WEEZING_CLAUSE}, this attack does 120 more damage.`)?.count,
    ).toEqual({ kind: "boardCondition", cond: PERVASIVE_GAS });
  });

  it("TWO LITERAL ROWS AND NO SIXTH TEMPLATE — an unprinted attack resolves to NOTHING", () => {
    for (const name of ["Surf Back", "Rollout", "form ranks", "Form Rank", "Pervasive gas"]) {
      const invented = `If this Pokémon used ${name} during your last turn, this attack does 90 more damage.`;
      expect(resolvedByAnyReader(invented), name).toBe(false);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§3 — the two printed cards, on boards, at the printed numbers", () => {
  it("Falinks: 30 with no history, 120 the turn after Form Ranks", () => {
    // FALSE — nothing has attacked yet, so `usedAttack` is null and the printed base
    // stands alone. This is the case that goes red if the arm ever answers TRUE off
    // a null record.
    const flat = ready(1, { active: "fix-alloutattack" });
    expect(conditionHolds(flat, "p1", FORM_RANKS)).toBe(false);
    expect(attack(flat, 1).dealt).toBe(30);
    // TRUE — spend a whole turn on "Form Ranks" (index 0, which deals NOTHING at
    // all), hand the turn over, and come back: 30 + 90.
    const armed = backToP1(attack(ready(1, { active: "fix-alloutattack" }), 0).state);
    expect(conditionHolds(armed, "p1", FORM_RANKS)).toBe(true);
    expect(attack(armed, 1).dealt).toBe(120);
  });

  it("Weezing: 50 with no history, 170 the turn after Pervasive Gas", () => {
    const flat = ready(2, { active: "fix-crazyblast" });
    expect(conditionHolds(flat, "p1", PERVASIVE_GAS)).toBe(false);
    expect(attack(flat, 1).dealt).toBe(50);
    const armed = backToP1(attack(ready(2, { active: "fix-crazyblast" }), 0).state);
    expect(conditionHolds(armed, "p1", PERVASIVE_GAS)).toBe(true);
    expect(attack(armed, 1).dealt).toBe(170);
  });

  it("THE CROSS-CONTROL: each armed board leaves the OTHER card's clause FALSE", () => {
    const falinks = backToP1(attack(ready(3, { active: "fix-alloutattack" }), 0).state);
    expect(conditionHolds(falinks, "p1", FORM_RANKS)).toBe(true);
    expect(conditionHolds(falinks, "p1", PERVASIVE_GAS)).toBe(false);
    const weezing = backToP1(attack(ready(3, { active: "fix-crazyblast" }), 0).state);
    expect(conditionHolds(weezing, "p1", PERVASIVE_GAS)).toBe(true);
    expect(conditionHolds(weezing, "p1", FORM_RANKS)).toBe(false);
  });

  it("THE CLOCK: the stamp stops paying two turns later, with no clear", () => {
    let state = backToP1(attack(ready(4, { active: "fix-crazyblast" }), 0).state);
    const stamped = activeOf(state, "p1")?.usedAttack;
    expect(stamped).toEqual({ name: "Pervasive Gas", turn: state.turn - 2 });
    expect(conditionHolds(state, "p1", PERVASIVE_GAS)).toBe(true);
    // …round the table once more and ask again. The STAMP is untouched and the
    // ANSWER has changed, which is the difference between an expiring fact and a
    // cleared one.
    for (const seat of ["p1", "p2"] as const) {
      state = drain(mustApply(state, { type: "endTurn", seat }).state);
    }
    expect(activeOf(state, "p1")?.usedAttack).toEqual(stamped);
    expect(conditionHolds(state, "p1", PERVASIVE_GAS)).toBe(false);
    expect(attack(state, 1).dealt).toBe(50);
  });

  it("the stamp is SEAT-BLIND, and OFF-TURN it is FALSE by PARITY rather than by a guard", () => {
    const armed = backToP1(attack(ready(5, { active: "fix-crazyblast" }), 0).state);
    expect(conditionHolds(armed, "p1", PERVASIVE_GAS)).toBe(true);
    expect(conditionHolds(armed, "p2", PERVASIVE_GAS)).toBe(false);
    expect(activeOf(armed, "p2")?.usedAttack).toBeNull();
    // …and asked DURING P2's turn, when `state.turn - 2` names a turn P1 never held,
    // P1's own true fact reads FALSE. Recorded as the arm's honest limit rather than
    // hidden: nothing printed asks this member off-turn.
    const offTurn = drain(mustApply(armed, { type: "endTurn", seat: "p1" }).state);
    expect(offTurn.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    expect(activeOf(offTurn, "p1")?.usedAttack).toEqual({
      name: "Pervasive Gas",
      turn: offTurn.turn - 3,
    });
    expect(conditionHolds(offTurn, "p1", PERVASIVE_GAS)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§4 — the board that REFUTES a per-seat record, driven rather than argued", () => {
  it("a SECOND Weezing does not inherit the first one's attack history", () => {
    const used = backToP1(attack(ready(6, { active: "fix-crazyblast" }), 0).state);
    const swapped = attachFromDeck(
      attachFromDeck(setActiveFromDeck(used, "p1", "fix-crazyblast"), "p1", "fix-dark-energy", 3),
      "p1",
      "fix-energy",
      3,
    );
    // The SEAT did use Pervasive Gas, on its last turn, and the body that did it is
    // still in play carrying the proof…
    expect(swapped.players.p1.bench.at(-1)?.usedAttack).toEqual({
      name: "Pervasive Gas",
      turn: swapped.turn - 2,
    });
    // …and the Active did not, so the clause is FALSE and the attack does its base.
    expect(activeOf(swapped, "p1")?.usedAttack).toBeNull();
    expect(conditionHolds(swapped, "p1", PERVASIVE_GAS)).toBe(false);
    expect(attack(swapped, 1).dealt).toBe(50);
  });

  it("the stamp SURVIVES the zone move, which a per-seat record could not express", () => {
    const used = backToP1(attack(ready(7, { active: "fix-crazyblast" }), 0).state);
    const benched = setActiveFromDeck(used, "p1", "fix-titan").players.p1.bench.at(-1);
    expect(benched?.usedAttack).toEqual({ name: "Pervasive Gas", turn: used.turn - 2 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§5 — THE CLOCK, MEASURED ACROSS A KNOCK OUT PARK", () => {
  it("an ATTACK-epilogue KO holds the counter at the ending turn — and Δ is still 2", () => {
    const board = ready(8, {
      active: "fix-crazyblast",
      defender: "fix-victim", // 30 HP — "Pervasive Gas"'s printed 30 is exactly lethal
      defenderBench: ["fix-titan"],
    });
    const declaredAt = board.turn;
    const parked = step(board, { type: "attack", seat: "p1", index: 0 });
    // The park is REAL and it is where the printed KO sequence puts it: the prize and
    // promotion stages sit in FRONT of the turn tail, so `startTurn` has not run.
    expect(parked.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p1" });
    expect(parked.pending.map((stage: PendingStage) => stage.kind)).toEqual([
      "takePrizes",
      "promote",
      "endTurn",
      "checkup",
      "startTurn",
    ]);
    expect(parked.turn).toBe(declaredAt);
    const settled = drain(parked);
    expect(activeOf(settled, "p1")?.usedAttack).toEqual({
      name: "Pervasive Gas",
      turn: declaredAt,
    });
    // …and P1's next turn is exactly TWO counter steps on, KO and all.
    const next = backToP1(settled);
    expect(next.turn).toBe(declaredAt + 2);
    expect(conditionHolds(next, "p1", PERVASIVE_GAS)).toBe(true);
    expect(attack(next, 1).dealt).toBe(170);
  });

  it("a CHECKUP KO parks BETWEEN the turns and does not insert a step either", () => {
    const used = attack(ready(9, { active: "fix-crazyblast", defenderBench: ["fix-titan"] }), 0);
    const declaredAt = used.state.turn - 1;
    // Poison the far seat lethally, then end P2's turn: the Checkup tick KOs.
    const poisoned = setConditions(used.state, "p2", { poisonDamage: 400 });
    const parked = mustApply(poisoned, { type: "endTurn", seat: "p2" }).state;
    expect(parked.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p1" });
    expect(parked.pending.map((stage: PendingStage) => stage.kind)).toEqual([
      "takePrizes",
      "promote",
      "startTurn",
    ]);
    // The counter is still on the ENDING turn while the park is open…
    expect(parked.turn).toBe(declaredAt + 1);
    // …and one `startTurn` later P1 is back, exactly two steps from where it attacked.
    const next = drain(parked);
    expect(next.turn).toBe(declaredAt + 2);
    expect(next.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
    expect(conditionHolds(next, "p1", PERVASIVE_GAS)).toBe(true);
    expect(attack(next, 1).dealt).toBe(170);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§6 — the WRITE SITE: the read is at the front of the declaration, the write at the back", () => {
  it("this attack does NOT clobber its own antecedent — the bonus pays AND the stamp moves", () => {
    const armed = backToP1(attack(ready(10, { active: "fix-crazyblast" }), 0).state);
    expect(activeOf(armed, "p1")?.usedAttack).toEqual({
      name: "Pervasive Gas",
      turn: armed.turn - 2,
    });
    const after = attack(armed, 1);
    expect(after.dealt).toBe(170);
    expect(activeOf(after.state, "p1")?.usedAttack).toEqual({
      name: "Crazy Blast",
      turn: armed.turn,
    });
  });

  it("a PARKED attack still stamps, and the stage is what carries the name across the park", () => {
    const board = ready(11, { active: "fix-alloutattack" });
    const parked = step(board, { type: "attack", seat: "p1", index: 0 });
    expect(parked.phase.kind).toBe("effect:choose");
    expect(parked.pending).toEqual([
      {
        kind: "attackEpilogue",
        seat: "p1",
        uid: parked.players.p1.active?.stack.at(-1),
        attack: "Form Ranks",
      },
    ]);
    // Nothing is stamped WHILE it is parked — the write is in `finishAttack`, which
    // the epilogue stage has not reached yet.
    expect(activeOf(parked, "p1")?.usedAttack).toBeNull();
    const settled = drain(parked);
    expect(activeOf(settled, "p1")?.usedAttack).toEqual({
      name: "Form Ranks",
      turn: board.turn,
    });
  });

  it("`finishAttack` is the definition of USED — a cancelled attack still counts", () => {
    const board = ready(12, { active: "fix-alloutattack" });
    const after = attack(board, 0);
    expect(activeOf(after.state, "p1")?.usedAttack).toEqual({
      name: "Form Ranks",
      turn: board.turn,
    });
    expect(after.dealt).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§7 — the fixtures and the persisted shape", () => {
  it("the two fixtures carry the printed bytes, BOTH attacks and their indexes", () => {
    const falinks = FIXTURE_POOL["fix-alloutattack"];
    expect(falinks?.name).toBe("Falinks");
    expect(falinks?.stage).toBe("Basic");
    expect(falinks?.hp).toBe(110);
    expect(falinks?.attacks).toHaveLength(2);
    expect(falinks?.attacks?.[0]?.name).toBe("Form Ranks");
    expect(falinks?.attacks?.[0]?.damage).toBeUndefined();
    expect(falinks?.attacks?.[1]?.name).toBe("All-Out Attack");
    expect(falinks?.attacks?.[1]?.damage).toBe("30+");
    expect(falinks?.attacks?.[1]?.effect).toBe(FALINKS);
    const weezing = FIXTURE_POOL["fix-crazyblast"];
    expect(weezing?.name).toBe("Weezing");
    expect(weezing?.stage).toBe("Stage1");
    expect(weezing?.evolveFrom).toBe("Koffing");
    expect(weezing?.hp).toBe(130);
    expect(weezing?.attacks?.[0]?.name).toBe("Pervasive Gas");
    expect(weezing?.attacks?.[0]?.damage).toBe(30);
    expect(weezing?.attacks?.[1]?.name).toBe("Crazy Blast");
    expect(weezing?.attacks?.[1]?.damage).toBe("50+");
    expect(weezing?.attacks?.[1]?.effect).toBe(WEEZING);
    expect(FALINKS_CLAUSE).toContain(falinks?.attacks?.[0]?.name ?? "");
    expect(WEEZING_CLAUSE).toContain(weezing?.attacks?.[0]?.name ?? "");
    expect(FORM_RANKS.kind === "yourActiveUsedAttackLastTurn" && FORM_RANKS.attack).toBe(
      falinks?.attacks?.[0]?.name,
    );
    expect(PERVASIVE_GAS.kind === "yourActiveUsedAttackLastTurn" && PERVASIVE_GAS.attack).toBe(
      weezing?.attacks?.[0]?.name,
    );
  });

  it("`usedAttack` is REQUIRED and every in-play body carries it — half of the 24 → 25 case", () => {
    const state = ready(13, { active: "fix-crazyblast", defenderBench: ["fix-titan"] });
    const bodies = (["p1", "p2"] as const).flatMap((seat) => [
      state.players[seat].active,
      ...state.players[seat].bench,
    ]);
    expect(bodies.length).toBeGreaterThanOrEqual(3);
    for (const body of bodies) {
      expect(body === null || "usedAttack" in body).toBe(true);
      expect(body?.usedAttack ?? null).toBeNull();
    }
  });

  it("the `attackEpilogue` stage's `attack` is REQUIRED — the OTHER half of 24 → 25", () => {
    const parked = step(ready(14, { active: "fix-alloutattack" }), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    const epilogue = parked.pending.find((stage: PendingStage) => stage.kind === "attackEpilogue");
    expect(epilogue).toBeDefined();
    expect(epilogue && "attack" in epilogue && epilogue.attack).toBe("Form Ranks");
  });
});
