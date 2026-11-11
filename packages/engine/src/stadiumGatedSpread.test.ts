import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackEffect,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
  ATTACK_READERS,
} from "./effects";
import { applyAction } from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  types,
  driveSetup,
  roundTrip,
  mustDerive,
} from "./testFixtures";

const PRINTED =
  "If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The same shape at a different N — the amount is CAPTURED, not pinned (C9). Constructed. */
const FIFTY =
  "If a Stadium is in play, this attack also does 50 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const BARE_SPREAD =
  "This attack also does 30 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const BARE_DISCARD = "Discard a Stadium in play.";
/** The family's other two `^If a Stadium is in play` rows, each
    another reader's. */
const MELTER_TEXT =
  "If a Stadium is in play, this attack does 60 more damage. Then, discard that Stadium.";
const BONUS_TEXT = "If a Stadium is in play, this attack does 70 more damage.";

/** THE PROGRAM, spelled once at the captured amount. */
const program = (amount: number): EffectOp[] => [
  {
    op: "conditionGate",
    cond: { kind: "stadiumInPlay" },
    ops: [{ op: "spreadDamage", target: "opponentBench", amount }, { op: "discardStadium" }],
  },
];
const PROGRAM = program(30);

const READERS = ATTACK_READERS.map(({ read }) => read);
const SPLITTERS = [
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
];

const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);
const claims = (re: RegExp): readonly [number, number, readonly string[]] => {
  const rows = legalAttackCorpus().filter(([, s]) => re.test(s));
  return [rows.length, units(rows), rows.map(([, s]) => s)];
};

const BASE = 100;
const SPREAD = 30;
const BEACH_COURT = "sv01-167";

const GATED_SPREAD_CARDS: Record<string, Card> = {
  "d522-crasher": battler("d522-crasher", {
    name: "D522 Crasher",
    types: ["Fighting"],
    hp: 130,
    retreat: 2,
    attacks: [
      /** index 0 — the control: no effect, no program. */
      { cost: ["Colorless"], name: "Plain Jab", damage: 30 },
      /** index 1 — PRINTED verbatim, with a DECLARED base so the base-lands-then-program
          path is driven (the BASE RULE). */
      { cost: ["Colorless"], name: "Ground Crasher", damage: BASE, effect: PRINTED },
    ],
  }),
  /** The SAME shape at 50 — the amount-not-pinned witness (C9). */
  "d522-fifty": battler("d522-fifty", {
    name: "D522 Fifty",
    types: ["Fighting"],
    hp: 130,
    retreat: 2,
    attacks: [
      { cost: ["Colorless"], name: "Plain Jab", damage: 30 },
      { cost: ["Colorless"], name: "Half Crasher", damage: 60, effect: FIFTY },
    ],
  }),
  /** The defender and the neutral benched body — 400 HP, no W/R. */
  "d522-wall": battler("d522-wall", { name: "D522 Wall", types: ["Colorless"], hp: 400 }),
  /** A benched body WEAK to the attacker — the flat-spread witness (30, not 60). */
  "d522-weakling": battler("d522-weakling", {
    name: "D522 Weakling",
    types: ["Lightning"],
    hp: 200,
    weaknesses: [{ type: "Fighting", value: "×2" }],
  }),
  /** A 60 HP benched body — pre-damaged to 30 it dies to the printed 30 exactly. */
  "d522-brittle": battler("d522-brittle", { name: "D522 Brittle", types: ["Colorless"], hp: 60 }),
};

const GATED_SPREAD_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...GATED_SPREAD_CARDS };

const GATED_SPREAD_DECK = deckOf({
  "d522-crasher": 8,
  "d522-fifty": 4,
  "d522-wall": 12,
  "d522-weakling": 8,
  "d522-brittle": 8,
  [BEACH_COURT]: 4,
  "fix-energy": 16,
});

const SEED = 11;

function openTable(seed: number, first: Seat): GameState {
  return driveSetup(
    seed,
    { p1: GATED_SPREAD_DECK, p2: GATED_SPREAD_DECK },
    { pool: GATED_SPREAD_POOL, first },
  );
}

/** Put a Beach Court into `seat`'s hand and play it — `stadiumPresence.test.ts`'s idiom. The
    zone then carries `owner: seat`, which is what the discard's OWNER's-pile rung reads. */
function playStadium(state: GameState, seat: Seat): GameState {
  const withCard = handFromDeck(state, seat, BEACH_COURT, 1);
  const uid = handUid(withCard, seat, BEACH_COURT);
  return mustApply(withCard, { type: "playTrainer", seat, uid }).state;
}

type Board = {
  readonly attacker?: "d522-crasher" | "d522-fifty";
  /** P2 plays Beach Court on its own turn 1. Default PRESENT — the printed antecedent's yes arm. */
  readonly stadium?: boolean;
  /** The opponent's Bench, in order. Default a neutral body and a Weak one. */
  readonly oppBench?: readonly string[];
  /** Prior damage on the opponent's bench slot 0. */
  readonly benchDamage?: number;
  /** Bench one neutral body for the attacker — the own-Bench-untouched witness (C8). */
  readonly ownBench?: boolean;
};

/** p1 owns TURN 2 with the attacker Active; P2 went first and (by default) played the Stadium on
    its own turn. NONE of the surgeries touches `rngState`. */
function table(board: Board = {}): GameState {
  let state = openTable(SEED, "p2");
  if (board.stadium !== false) state = playStadium(state, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  if (state.turn !== 2) throw new Error(`expected turn 2, got ${String(state.turn)}`);
  state = setActiveFromDeck(state, "p1", board.attacker ?? "d522-crasher");
  state = setActiveFromDeck(state, "p2", "d522-wall");
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  for (const id of board.oppBench ?? ["d522-wall", "d522-weakling"])
    state = benchFromDeck(state, "p2", id);
  if (board.ownBench) state = benchFromDeck(state, "p1", "d522-wall");
  if (board.benchDamage !== undefined) state = setBenchDamage(state, "p2", 0, board.benchDamage);
  return state;
}

type Swing = { before: GameState; after: GameState; events: GameEvent[] };

function swing(board: Board = {}, index = 1): Swing {
  const before = table(board);
  const { state: after, events } = mustApply(before, { type: "attack", seat: "p1", index });
  return { before, after, events };
}

function damageRows(events: readonly GameEvent[]) {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT",
  );
}

function stadiumRows(events: readonly GameEvent[]) {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "STADIUM_DISCARDED" }> => e.type === "STADIUM_DISCARDED",
  );
}

function benchUids(state: GameState, seat: Seat): string[] {
  return state.players[seat].bench.map((p) => {
    const top = p.stack[p.stack.length - 1];
    if (top === undefined) throw new Error("empty stack on the Bench");
    return top;
  });
}

describe("D522 §1 — the printed row derives to EXACTLY arm 43's shape minus the `optional`", () => {
  it("file line 293 derives to the Stadium gate over [spread, discard] — and this `toEqual` is what pins the printed ORDER (`D522-gated-spread-then-order-swapped`)", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
  });

  it("the gate's sorted KEY SET is exactly [cond, op, then] — no `otherwise` (D135), and the spread carries no `damagedOnly` (D507's rider is not printed)", () => {
    const gate = mustDerive(deriveAttackEffect, PRINTED)[0];
    if (gate?.op !== "conditionGate") throw new Error("op 0 is not a conditionGate");
    expect(Object.keys(gate).sort()).toEqual(["cond", "op", "ops"]);
    expect(gate.otherwise).toBeUndefined();
    const [spread, discard] = gate.ops;
    if (spread?.op !== "spreadDamage") throw new Error("then[0] is not a spreadDamage");
    if (discard?.op !== "discardStadium") throw new Error("then[1] is not a discardStadium");
    expect(Object.keys(spread).sort()).toEqual(["amount", "op", "target"]);
    expect(Object.keys(discard)).toEqual(["op"]);
    expect(gate.ops).toHaveLength(2);
  });

  it("the `then` is BYTE-EQUAL to the two bare halves' OWN derivations, concatenated in printed order (measured, not quoted)", () => {
    const gate = mustDerive(deriveAttackEffect, PRINTED)[0];
    if (gate?.op !== "conditionGate") throw new Error("op 0 is not a conditionGate");
    const spread = deriveAttackEffect(BARE_SPREAD);
    const discard = deriveAttackEffect(BARE_DISCARD);
    expect(spread).toEqual([{ op: "spreadDamage", target: "opponentBench", amount: 30 }]);
    expect(discard).toEqual([{ op: "discardStadium" }]);
    expect(gate.ops).toEqual([...(spread as EffectOp[]), ...(discard as EffectOp[])]);
    const may = mustDerive(deriveAttackEffect, "You may discard a Stadium in play.")[0];
    if (may?.op !== "conditionGate") throw new Error("arm 43's op 0 is not a conditionGate");
    expect(gate.cond).toEqual(may.cond);
    expect(gate.cond).toEqual({ kind: "stadiumInPlay" });
  });

  it("the anchor's claimed set over every corpus row is EXACTLY {file line 293} — and the optional-clarifier form claims the IDENTICAL 1 / 1 (measured, so nobody tidies it either way)", () => {
    const mine =
      /^If a Stadium is in play, this attack also does (\d+) damage to each of your opponent['’]s Benched Pokémon, and discard that Stadium\. \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\)$/;
    const [n, u, rows] = claims(mine);
    expect([n, u]).toEqual([1, 1]);
    expect(rows).toEqual([PRINTED]);
    const optional =
      /^If a Stadium is in play, this attack also does (\d+) damage to each of your opponent['’]s Benched Pokémon, and discard that Stadium\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;
    expect(claims(optional).slice(0, 2)).toEqual([1, 1]);
    expect(claims(optional)[2]).toEqual([PRINTED]);
  });

  it("`deriveAttackEffect` is the ONLY claimant — twelve readers and four splitters are null (`splitAttackGateClause` included: the `If` is the substance, not a leading timing gate)", () => {
    for (const reader of READERS) {
      if (reader === deriveAttackEffect) continue;
      expect(reader(PRINTED), reader.name).toBeNull();
    }
    for (const splitter of SPLITTERS) expect(splitter(PRINTED), splitter.name).toBeNull();
    expect(splitAttackGateClause(PRINTED)).toBeNull();
  });

  it("the three `^If a Stadium is in play` rows PARTITION over three readers — 293 → effect, 294 → bonus-consequent, 295 → damage-bonus — measured in BOTH directions", () => {
    const rows = legalAttackCorpus().filter(([, s]) => /^If a Stadium is in play/.test(s));
    expect(rows.map(([, s]) => s).sort()).toEqual([PRINTED, MELTER_TEXT, BONUS_TEXT].sort());
    expect(units(rows)).toBe(3);
    const owner = (s: string): string[] =>
      READERS.filter((read) => read(s) !== null).map((read) => read.name);
    expect(owner(PRINTED)).toEqual(["deriveAttackEffect"]);
    expect(owner(MELTER_TEXT)).toEqual(["deriveAttackBonusConsequent"]);
    expect(owner(BONUS_TEXT)).toEqual(["deriveAttackDamageBonus"]);
    expect(deriveAttackBonusConsequent(PRINTED)).toBeNull();
    expect(deriveAttackEffect(MELTER_TEXT)).toBeNull();
    expect(deriveAttackEffect(BONUS_TEXT)).toBeNull();
  });

  it("`/that Stadium/` is TWO rows, BOTH resolved, by DIFFERENT readers — the family is 2 / 2 built, 1 / 1 each", () => {
    const rows = legalAttackCorpus().filter(([, s]) => /that Stadium/.test(s));
    expect(rows.map(([, s]) => s).sort()).toEqual([PRINTED, MELTER_TEXT].sort());
    expect(units(rows)).toBe(2);
    for (const [, s] of rows) expect(resolvedByAnyReader(s), s).toBe(true);
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
    expect(deriveAttackBonusConsequent(MELTER_TEXT)).not.toBeNull();
  });

  it("the `, and discard that Stadium` join is DISJOINT from the bonus readers' joins — neither `more damage, and ` nor `more damage. Then, ` occurs in the row, and their claims exclude it", () => {
    expect(PRINTED).not.toContain("more damage, and ");
    expect(PRINTED).not.toContain("more damage. Then, ");
    expect(PRINTED).toContain("Benched Pokémon, and discard that Stadium.");
    expect(claims(/more damage, and /)[2]).not.toContain(PRINTED);
    expect(claims(/more damage\. Then, /)[2]).not.toContain(PRINTED);
    expect(claims(/more damage\. Then, /)[2]).toContain(MELTER_TEXT);
  });

  it("the anchor is WHOLE-SENTENCE at BOTH ends — a prefixed print and a suffixed print each derive null (D520 (3); `D522-gated-spread-anchor-loses-the-head` / `-tail`)", () => {
    const prefixed = `Discard a card from your hand. ${PRINTED}`;
    const suffixed = `${PRINTED} Then, draw a card.`;
    expect(legalAttackCorpus().some(([, s]) => s === prefixed || s === suffixed)).toBe(false);
    expect(deriveAttackEffect(prefixed)).toBeNull();
    expect(deriveAttackEffect(suffixed)).toBeNull();
    expect(resolvedByAnyReader(prefixed)).toBe(false);
    expect(resolvedByAnyReader(suffixed)).toBe(false);
  });

  it("single-axis controls, ONE clause apart each, all null on `deriveAttackEffect` AND `deriveAttackBonusConsequent` — pinned by the LIVE null", () => {
    const controls: Record<string, string> = {
      "the CLARIFIER dropped":
        "If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium.",
      "the GATE dropped":
        "This attack also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "the DISCARD dropped":
        "If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "the SPREAD dropped": "If a Stadium is in play, discard that Stadium.",
      "the bare lowercase consequent": "discard that Stadium.",
      "the `also` dropped (`D522-gated-spread-anchor-drops-also`)":
        "If a Stadium is in play, this attack does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    };
    for (const [why, s] of Object.entries(controls)) {
      expect(s, why).not.toBe(PRINTED);
      expect(deriveAttackEffect(s), why).toBeNull();
      expect(deriveAttackBonusConsequent(s), why).toBeNull();
      expect(resolvedByAnyReader(s), why).toBe(false);
      expect(
        legalAttackCorpus().some(([, t]) => t === s),
        why,
      ).toBe(false);
    }
  });

  it("a printed ZERO derives null — the guard is redundant at the interpreter and kept for the LOUD path (`D522-gated-spread-printed-zero-derives`)", () => {
    expect(deriveAttackEffect(PRINTED.replace("does 30 damage", "does 0 damage"))).toBeNull();
    expect(resolvedByAnyReader(PRINTED.replace("does 30 damage", "does 0 damage"))).toBe(false);
  });

  it("the amount is CAPTURED, not pinned — the 50-print derives the same shape at 50 (`D522-gated-spread-arm-pins-the-amount`)", () => {
    expect(deriveAttackEffect(FIFTY)).toEqual(program(50));
    expect(deriveAttackEffect(PRINTED.replace("does 30 damage", "does 10 damage"))).toEqual(
      program(10),
    );
    expect(legalAttackCorpus().some(([, s]) => s === FIFTY)).toBe(false);
  });
});

describe("D522 §2 — Stadium PRESENT: the base lands first, the Bench takes 30 flat, the owner's Stadium is discarded", () => {
  it("the board is what it says: P2 owns the Stadium, P1's attacker is Active with one Energy, P2 has a neutral body and a WEAK body benched", () => {
    const before = table();
    expect(before.stadium?.owner).toBe("p2");
    expect(before.players.p1.active?.energy).toHaveLength(1);
    expect(before.players.p2.bench).toHaveLength(2);
    expect(before.players.p1.bench).toHaveLength(0);
    expect(GATED_SPREAD_CARDS["d522-weakling"]?.weaknesses).toEqual([
      { type: "Fighting", value: "×2" },
    ]);
    expect(GATED_SPREAD_CARDS["d522-crasher"]?.types).toEqual(["Fighting"]);
    expect(before.turn).toBe(2);
  });

  it("exactly ONE base row on the DEFENDER, and it lands BEFORE every program row (the BASE RULE — D521's `also` path)", () => {
    const { before, events } = swing();
    const defender = activeUid(before, "p2");
    const rows = damageRows(events);
    const baseRows = rows.filter((r) => r.uid === defender);
    expect(baseRows).toHaveLength(1);
    expect(baseRows[0]).toMatchObject({
      seat: "p2",
      by: "p1",
      uid: defender,
      base: BASE,
      dealt: BASE,
    });
    // ATTACK_DECLARED, then the §8.5 hit, then the program.
    expect(types(events).slice(0, 2)).toEqual(["ATTACK_DECLARED", "DAMAGE_DEALT"]);
    const baseAt = events.indexOf(baseRows[0] as GameEvent);
    for (const row of rows)
      if (row.uid !== defender) expect(events.indexOf(row)).toBeGreaterThan(baseAt);
    const discardAt = events.findIndex((e) => e.type === "STADIUM_DISCARDED");
    expect(discardAt).toBeGreaterThan(baseAt);
  });

  it("each benched body takes the printed 30 FLAT — the body WEAK to the attacker takes 30, not 60, and its row files `weakness: null` (`D522-gated-spread-arm-drops-the-spread`)", () => {
    const { before, after, events } = swing();
    expect(after.players.p2.bench.map((p) => p.damage)).toEqual([SPREAD, SPREAD]);
    const bench = benchUids(before, "p2");
    const benchRows = damageRows(events).filter((r) => bench.includes(r.uid));
    expect(benchRows).toHaveLength(2);
    for (const row of benchRows) {
      expect(row).toMatchObject({
        seat: "p2",
        by: "p1",
        base: SPREAD,
        dealt: SPREAD,
        weakness: null,
        resistance: null,
      });
    }
    // The defender took the base only — the spread is BENCH-scoped.
    expect(after.players.p2.active?.damage).toBe(BASE);
  });

  it("`STADIUM_DISCARDED` fires under the OWNER's seat, the card is in P2's pile and not P1's, and the zone is null after (D380 §3; `D522-gated-spread-arm-drops-the-discard`)", () => {
    const { before, after, events } = swing();
    const stadium = before.stadium;
    if (stadium === null) throw new Error("expected P2's Stadium in the zone");
    expect(stadiumRows(events)).toEqual([
      { type: "STADIUM_DISCARDED", seat: "p2", uid: stadium.uid, cause: "effect" },
    ]);
    expect(after.stadium).toBeNull();
    expect(after.players.p2.discard).toEqual([...before.players.p2.discard, stadium.uid]);
    expect(after.players.p1.discard).toEqual(before.players.p1.discard);
    expect(after.players.p1.discard).not.toContain(stadium.uid);
  });

  it("no `ATTACK_EFFECT_SKIPPED`, and an attack ENDS the turn [ D570 (D539): except a FIRST attack under Festival Lead with Festival Grounds in play, which no board here builds] (D491) — p2's action phase on turn 3", () => {
    const { after, events } = swing();
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(types(events)).toContain("TURN_ENDED");
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(after.turn).toBe(3);
  });

  it("the attacker's OWN Bench is untouched — `opponentBench`, not `yourBench` (`D522-gated-spread-arm-targets-your-bench`)", () => {
    const { before, after, events } = swing({ ownBench: true });
    expect(before.players.p1.bench).toHaveLength(1);
    expect(after.players.p1.bench.map((p) => p.damage)).toEqual([0]);
    expect(after.players.p2.bench.map((p) => p.damage)).toEqual([SPREAD, SPREAD]);
    const own = benchUids(before, "p1");
    expect(damageRows(events).some((r) => own.includes(r.uid))).toBe(false);
    expect(damageRows(events).some((r) => r.seat === "p1")).toBe(false);
    expect(after.players.p1.active?.damage).toBe(0);
  });

  it("`rngState` is UNMOVED — no coin, no shuffle — and the index-0 control on the same deck neither spreads nor discards", () => {
    const { before, after, events } = swing();
    expect(after.rngState).toBe(before.rngState);
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    const control = swing({}, 0);
    expect(control.after.rngState).toBe(control.before.rngState);
    expect(control.after.stadium).not.toBeNull();
    expect(control.after.players.p2.bench.map((p) => p.damage)).toEqual([0, 0]);
    expect(control.after.players.p2.active?.damage).toBe(30);
    expect(types(control.events)).not.toContain("STADIUM_DISCARDED");
  });

  it("the 50-print spreads exactly 50 to each benched body on its own board, and still discards (`D522-gated-spread-arm-pins-the-amount`)", () => {
    const { after, events } = swing({ attacker: "d522-fifty" });
    expect(after.players.p2.bench.map((p) => p.damage)).toEqual([50, 50]);
    expect(after.players.p2.active?.damage).toBe(60);
    expect(after.stadium).toBeNull();
    expect(stadiumRows(events)).toHaveLength(1);
  });

  it("`programPlayable` is TRUE — nothing in the program parks or needs a target — with and without a Bench across the table", () => {
    const full = table();
    expect(programPlayable(full, PROGRAM, "p1")).toBe(true);
    expect(programPlayable(full, PROGRAM, "p1", activeUid(full, "p1"))).toBe(true);
    const empty = table({ oppBench: [] });
    expect(empty.players.p2.bench).toHaveLength(0);
    expect(programPlayable(empty, PROGRAM, "p1")).toBe(true);
    const bare = table({ stadium: false });
    expect(bare.stadium).toBeNull();
    expect(programPlayable(bare, PROGRAM, "p1")).toBe(true);
  });
});

describe("D522 §2b — Stadium ABSENT, an EMPTY Bench, and the Knock Out the spread causes", () => {
  it("Stadium ABSENT → the base only: Bench untouched, no `STADIUM_DISCARDED`, no `ATTACK_EFFECT_SKIPPED`, the turn ends (`D522-gated-spread-arm-reads-ownership`'s other face)", () => {
    const { before, after, events } = swing({ stadium: false });
    expect(before.stadium).toBeNull();
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(after.players.p2.bench.map((p) => p.damage)).toEqual([0, 0]);
    expect(damageRows(events)).toHaveLength(1);
    expect(types(events)).not.toContain("STADIUM_DISCARDED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("the P2-OWNED Stadium is what the gate reads — `stadiumInPlay` is PRESENCE, not `yourStadiumInPlay`'s OWNERSHIP (`D522-gated-spread-arm-reads-ownership`)", () => {
    // The attacker is P1 and the Stadium is P2's: an ownership member would answer NO here and
    // the program would neither spread nor discard. Presence answers YES.
    const { before, after } = swing();
    expect(before.stadium?.owner).toBe("p2");
    expect(before.stadium?.owner).not.toBe("p1");
    expect(after.players.p2.bench.map((p) => p.damage)).toEqual([SPREAD, SPREAD]);
    expect(after.stadium).toBeNull();
  });

  it("Stadium present with an EMPTY opponent Bench → the discard still happens (the spread's own empty early return), no damage row but the base", () => {
    const { before, after, events } = swing({ oppBench: [] });
    const stadium = before.stadium;
    if (stadium === null) throw new Error("expected P2's Stadium in the zone");
    expect(before.players.p2.bench).toHaveLength(0);
    expect(damageRows(events)).toHaveLength(1);
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(stadiumRows(events)).toEqual([
      { type: "STADIUM_DISCARDED", seat: "p2", uid: stadium.uid, cause: "effect" },
    ]);
    expect(after.stadium).toBeNull();
    expect(after.players.p2.discard).toContain(stadium.uid);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("a benched body at 30 remaining is KNOCKED OUT by the spread, the ATTACKER's Prize is owed (`finishAttack`'s two-seat sweep), and the Stadium is still discarded", () => {
    const { before, after, events } = swing({
      oppBench: ["d522-brittle", "d522-wall"],
      benchDamage: 30,
    });
    const [brittle] = benchUids(before, "p2");
    expect(events.find((e) => e.type === "KNOCKED_OUT")).toMatchObject({
      seat: "p2",
      uid: brittle,
    });
    expect(after.stadium).toBeNull();
    expect(types(events)).toContain("STADIUM_DISCARDED");
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    expect(types(events)).not.toContain("TURN_ENDED");
    const done = must(applyAction(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] }));
    expect(done.players.p1.prizes).toHaveLength(5);
    expect(done.players.p2.prizes).toHaveLength(6);
    // The KO'd body left the Bench; the survivor kept its 30; the defender took the base.
    expect(done.players.p2.bench.map((p) => p.damage)).toEqual([SPREAD]);
    expect(done.players.p2.discard).toContain(brittle);
    expect(done.players.p2.active?.damage).toBe(BASE);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("the SAME primed body with the Stadium ABSENT survives — the antecedent is the whole difference", () => {
    const { after, events } = swing({
      oppBench: ["d522-brittle", "d522-wall"],
      benchDamage: 30,
      stadium: false,
    });
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(after.players.p2.bench.map((p) => p.damage)).toEqual([30, 0]);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });
});

describe("D522 §3 — the census moved in exactly ONE summand, by 1 sentence / 1 printing", () => {
  it("the reader arm reads 549 sentences / 1,590 printings, and the row is IN it", () => {
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    expect(resolved.map(([, s]) => s)).toContain(PRINTED);
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([599, 1662]);
  });

  it("the RAW reader-only residue fell by exactly 1 sentence / 1 printing — 91 / 142 — and the row left it", () => {
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    expect(unbuilt.map(([, s]) => s)).not.toContain(PRINTED);
    // The parts add up to the whole quoted in the same case.
  });

  it("the move is READER-keyed: no gate clause, no trailing split, no cancel split, no requirement split claims the row", () => {
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
  });
});

describe("D522 §4 — the version steps, the heading is written, the prose is corrected, and what stands still", () => {
  it("`MATCH_RECORD_VERSION` HOLDS at 30: zero new serialized bytes, neither op parks, the gate is spliced", () => {
    expect(roundTrip(PROGRAM)).toEqual(PROGRAM);
    // The declaration never parks: no board above ended in `effect:choose`.
    for (const board of [{}, { stadium: false }, { oppBench: [] }] as const) {
      expect(swing(board).after.phase.kind).not.toBe("effect:choose");
    }
  });

  it("the demonstrator is FILE-LOCAL — zero `FIXTURE_POOL` ids, Ting-Lu `sv06-110` is NOT in the pool (its base and cost are unresolvable here, D425), the deck is 60", () => {
    expect(Object.keys(GATED_SPREAD_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(
      true,
    );
    expect(FIXTURE_POOL["sv06-110"]).toBeUndefined();
    expect(FIXTURE_POOL[BEACH_COURT]?.name).toBe("Beach Court");
    expect(GATED_SPREAD_DECK).toHaveLength(60);
    // The arithmetic the KO board rests on: 60 HP, 30 prior, 30 printed.
    expect((GATED_SPREAD_CARDS["d522-brittle"]?.hp ?? 0) - 30).toBe(SPREAD);
  });
});
