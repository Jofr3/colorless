import { BASIC_ENERGY_TYPES, type Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import {
  deriveAttackCancelRequirement,
  deriveAttackEffect,
  splitAttackCancelClause,
} from "./effects";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import { conditionHolds, conditionNote } from "./boardCondition";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handToDeck,
  must,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
  driveSetup,
} from "./testFixtures";
import {
  koByEffectMarker,
  koedDuringOpponentsLastTurn,
  koedMarksOnOpponentsLastTurn,
} from "./types";

const BASIC_KO_TEXT = "If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out.";
const BOTH_KO_TEXT = "Both Active Pokémon are Knocked Out.";
const COIN_KO_TEXT =
  "This Pokémon does 100 damage to itself. Flip a coin. If heads, your opponent's Active Pokémon is Knocked Out.";
const SPECIAL_ENERGY_KO_TEXT =
  "If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out.";

const UNBUILT_TEXT = {
  delayedKo:
    "Discard all Energy from this Pokémon. At the end of your opponent's next turn, the Defending Pokémon will be Knocked Out.",
} as const;

const BUILT_BY_D420 = {
  handEnergyKo:
    "Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing.",
  head: "Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon.",
} as const;

const BUILT_BY_D416 = {
  sixCounters: "Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it.",
  flipBasicPick:
    "Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon.",
} as const;

const LOCAL_CARDS: Record<string, Card> = {
  "fix-kod": battler("fix-kod", {
    hp: 120,
    attacks: [
      { cost: ["Colorless"], name: "Basic Breaker", effect: BASIC_KO_TEXT },
      { cost: ["Colorless"], name: "Plain Bite", damage: 200 },
    ],
  }),
  /** The victim: a BASIC, 120 HP, no attacks of its own. 120 < 200 so Plain Bite
      Knocks it Out in one hit, and > 0 so nothing else on either board can. */
  "fix-kod-victim": battler("fix-kod-victim", { hp: 120 }),
  "fix-kod-stage1": battler("fix-kod-stage1", {
    hp: 120,
    stage: "Stage1",
    evolveFrom: "fix-kod-victim",
  }),
  /** …and the second non-Basic, because "not Basic" is a two-member set and one
      member passing says nothing about the other. */
  "fix-kod-stage2": battler("fix-kod-stage2", {
    hp: 120,
    stage: "Stage2",
    evolveFrom: "fix-kod-stage1",
  }),
  "fix-kod-special": battler("fix-kod-special", {
    hp: 120,
    attacks: [
      { cost: ["Colorless"], name: "Sharp Fang", effect: SPECIAL_ENERGY_KO_TEXT },
      { cost: ["Colorless"], name: "Plain Bite", damage: 200 },
    ],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const KO_DEFENDER_DECK = deckOf({
  "fix-kod": 4,
  "fix-kod-victim": 4,
  "fix-kod-stage1": 3,
  "fix-kod-stage2": 3,
  "sv03-197": 4,
  "sv03-004": 6,
  "fix-titan": 4,
  "fix-bigbody": 14,
  "fix-energy": 18,
});

const SPECIAL_KO_DECK = deckOf({
  "fix-kod-special": 4,
  "fix-kod-victim": 4,
  "fix-titan": 4,
  "fix-bigbody": 18,
  "fix-energy": 18,
  "sv02-190": 6,
  "fix-fire-energy": 6,
});

const BASIC_BREAKER = 0;
const PLAIN_BITE = 1;
/** `fix-kod-special`'s two indices — the same 0/1 control pair, named apart so a
    §7 board cannot be read as a §2 one. */
const SHARP_FANG = 0;
const SPECIAL_PLAIN_BITE = 1;

const OPPONENT_SPECIAL = {
  kind: "opponentActiveHasEnergyAttached",
  energy: "special",
} as const;

const BY_ATTACK = { kind: "yourPokemonKoedOnOpponentsLastTurn", byAttack: true } as const;

function localSetup(seed: number, first: Seat, deck: string[] = KO_DEFENDER_DECK): GameState {
  return driveSetup(seed, { p1: deck, p2: deck }, { pool: POOL, first });
}

function armed(seed: number, victim = "fix-kod-victim", opts: { tool?: string } = {}): GameState {
  let state = must(applyAction(localSetup(seed, "p2"), { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", "fix-kod");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", victim);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = benchFromDeck(state, "p2", "fix-bigbody");
  if (opts.tool !== undefined) state = attachToolFromDeck(state, "p2", "active", opts.tool);
  return state;
}

/** Walk the §8.1 stages a Knock Out queues — Prize, then promotion — and hand
    back the board on the seat-after turn. Mirrors `lastKoOwnerMark.test.ts`'s
    `settle`, so the two suites' post-KO boards are comparable. */
function settle(state: GameState): GameState {
  let next = state;
  for (let guard = 0; guard < 12; guard += 1) {
    if (next.phase.kind === "ko:takePrizes") {
      const { seat, count } = next.phase;
      next = must(
        applyAction(next, {
          type: "takePrizes",
          seat,
          prizeIndices: Array.from({ length: count }, (_, i) => i),
        }),
      );
      continue;
    }
    if (next.phase.kind === "ko:promote") {
      const seat = next.phase.seat;
      next = must(applyAction(next, { type: "promote", seat, benchIndex: 0 }));
      continue;
    }
    return next;
  }
  throw new Error("KO stages never settled");
}

/** One whole board: P1 attacks with `index`, the KO settles, the turn passes to
    P2 — the arrangement every `byAttack` reader is consulted on. */
function struck(
  seed: number,
  index: number,
  opts: { tool?: string } = {},
): { before: GameState; after: GameState; events: GameEvent[] } {
  const before = armed(seed, "fix-kod-victim", opts);
  const { state, events } = mustApply(before, { type: "attack", seat: "p1", index });
  return { before, after: settle(state), events };
}

describe("§1 the deriver — three sentences, four printings, one field-free op", () => {
  it("derives the Basic gate to `conditionGate` over `knockOutDefender`", () => {
    // Program EQUALITY rather than a non-null: an arm that emitted the op BARE —
    // dropping the gate — satisfies a non-null and unconditionally Knocks Out
    // every Active in the format, which is the loudest possible way to be wrong.
    expect(deriveAttackEffect(BASIC_KO_TEXT)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsBasic" },
        ops: [{ op: "knockOutDefender" }],
      },
    ]);
  });

  it("derives 'Both Active Pokémon are Knocked Out.' to TWO ops in printed order", () => {
    expect(deriveAttackEffect(BOTH_KO_TEXT)).toEqual([
      { op: "knockOutDefender" },
      { op: "knockOutSelf" },
    ]);
  });

  it("derives the self-damage-then-coin printing with the damage OUTSIDE the gate", () => {
    expect(deriveAttackEffect(COIN_KO_TEXT)).toEqual([
      { op: "damageSelf", amount: 100 },
      {
        op: "coinFlipGate",
        ops: [{ op: "knockOutDefender" }],
      },
    ]);
  });

  it("refuses the ONE sentence of the family that is STILL unbuilt — by name", () => {
    expect(Object.keys(UNBUILT_TEXT).length).toBeGreaterThan(0);
    for (const [name, text] of Object.entries(UNBUILT_TEXT)) {
      expect(deriveAttackEffect(text), `${name} stopped being refused`).toBeNull();
    }
    // The sentences that LEFT, asserted positively in the same breath — so "they are
    // no longer refused" is a claim about built programs and not about deleted lines.
    expect(deriveAttackEffect(SPECIAL_ENERGY_KO_TEXT)).not.toBeNull();
    for (const [name, text] of Object.entries(BUILT_BY_D416)) {
      expect(deriveAttackEffect(text), `${name} is not built`).not.toBeNull();
    }
  });

  it("D420's sentence is built THROUGH THE SPLIT, and the whole string is still refused", () => {
    expect(deriveAttackEffect(BUILT_BY_D420.handEnergyKo)).toBeNull();
    const split = splitAttackCancelClause(BUILT_BY_D420.handEnergyKo);
    expect(split?.head).toBe(BUILT_BY_D420.head);
    expect(deriveAttackCancelRequirement(BUILT_BY_D420.handEnergyKo)).toEqual({
      kind: "yourBasicEnergyInHandAtLeast",
      energy: "Grass",
      count: 6,
    });
    // …and the head is this op's fourth printed home: the COST first, then the Knock
    // Out, in printed order.
    expect(deriveAttackEffect(BUILT_BY_D420.head)).toEqual([
      {
        op: "payFromHand",
        count: 6,
        to: "discard",
        filter: { kind: "basicEnergy", energyType: "Grass" },
      },
      { op: "knockOutDefender" },
    ]);
    expect(deriveAttackEffect(BUILT_BY_D420.head)).not.toEqual([{ op: "knockOutDefender" }]);
  });

  it("is anchored end to end — all three, both ends", () => {
    // Leading text, a missing period and a lowercase opener each keep the attack on
    // the loud path rather than half-simulating it. Run over all three sentences,
    // because three anchors are three chances to forget a `^` or a `$`.
    for (const text of [BASIC_KO_TEXT, BOTH_KO_TEXT, COIN_KO_TEXT]) {
      expect(deriveAttackEffect(`Flip a coin. If heads, ${text}`)).toBeNull();
      expect(deriveAttackEffect(text.replace(/\.$/, ""))).toBeNull();
      expect(deriveAttackEffect(text.toLowerCase())).toBeNull();
      expect(deriveAttackEffect(`${text} Draw a card.`)).toBeNull();
    }
  });

  it("reads the printed self-damage rather than a constant, and refuses a printed 0", () => {
    expect(deriveAttackEffect(COIN_KO_TEXT.replace("100", "60"))).toEqual([
      { op: "damageSelf", amount: 60 },
      {
        op: "coinFlipGate",
        ops: [{ op: "knockOutDefender" }],
      },
    ]);
    // …and the `amount >= 1` guard every self-damage arm carries: a printed 0 is
    // not a cost, and deriving it would ship a silent no-op in front of a real KO.
    expect(deriveAttackEffect(COIN_KO_TEXT.replace("100", "0"))).toBeNull();
  });

  it("D202's family — both apostrophe spellings derive the SAME program", () => {
    for (const text of [BASIC_KO_TEXT, COIN_KO_TEXT]) {
      const curly = text.replace(/'/g, "’");
      expect(curly).not.toBe(text); // the substitution really happened
      expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(text));
      expect(deriveAttackEffect(curly)).not.toBeNull();
    }
    // The sibling family, on the SAME run, taking both — so this is a comparison
    // across two families rather than an assertion about one regex in isolation.
    expect(
      deriveAttackEffect("During your opponent’s next turn, the Defending Pokémon can’t retreat."),
    ).toEqual([{ op: "preventRetreat" }]);
    // `BOTH_KO_TEXT` carries no apostrophe at all, so it is unaffected either way —
    // named so the loop above is not read as covering it.
    expect(BOTH_KO_TEXT).not.toContain("'");
  });

  it("keeps the local fixture's printed text verbatim — the sentence IS the wiring", () => {
    // On the deriver path a one-character drift does not throw: it drops the card
    // onto ATTACK_EFFECT_SKIPPED with no other failure anywhere, so the bytes get
    // pinned. ASCII apostrophe, a real é.
    expect(LOCAL_CARDS["fix-kod"]?.attacks?.[0]).toEqual({
      cost: ["Colorless"],
      name: "Basic Breaker",
      effect: BASIC_KO_TEXT,
    });
    expect(BASIC_KO_TEXT).toContain("opponent's");
    expect(BASIC_KO_TEXT).toContain("Pokémon");
    expect(BASIC_KO_TEXT).not.toContain("’");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE KNOCK OUT ON A REAL BOARD, and the gate's negative half.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 the Knock Out — Prize, discard, KNOCKED_OUT, promotion", () => {
  it("Knocks Out the opponent's Basic Active and runs §8.1's whole sequence", () => {
    const before = armed(1);
    const victim = activeUid(before, "p2");
    deepFreeze(before);

    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: BASIC_BREAKER,
    });

    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: victim });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");

    // The Prize is PROMPTED rather than taken: a plain body is worth one.
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const prized = must(applyAction(state, { type: "takePrizes", seat: "p1", prizeIndices: [0] }));
    expect(prized.players.p1.prizes).toHaveLength(5);
    // …then the promotion, on the LOSING seat.
    expect(prized.phase).toEqual({ kind: "ko:promote", seat: "p2" });
    const promoted = must(applyAction(prized, { type: "promote", seat: "p2", benchIndex: 0 }));

    // The whole stack is in the discard and the spot is refilled off the bench.
    expect(promoted.players.p2.discard).toContain(victim);
    expect(promoted.players.p2.active?.stack).not.toContain(victim);
    expect(promoted.players.p2.bench).toHaveLength(1);
    // …and the turn passed, so nothing here is mid-attack.
    expect(promoted.phase.kind).toBe("turn:action");
    expect(promoted.turn).toBe(before.turn + 1);
  });

  it("the GATE declines against a Stage 1 Active — nothing is Knocked Out", () => {
    const before = armed(2, "fix-kod-stage1");
    const survivor = activeUid(before, "p2");
    deepFreeze(before);

    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: BASIC_BREAKER,
    });

    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.players.p2.active?.stack).toContain(survivor);
    // Not merely un-Knocked-Out — UNTOUCHED. The op marks lethal against
    // `effectiveMaxHp`, so a gate that fired and was then undone would still leave
    // 120 damage sitting on a 120 HP body.
    expect(state.players.p2.active?.damage).toBe(0);
    expect(state.players.p2.active?.markers).toEqual([]);
    // The attack RESOLVED — the gate answering "no" is not a skipped effect.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(state.phase.kind).toBe("turn:action");
    // …and the board went nowhere: no Prize moved on either seat.
    expect(state.players.p1.prizes).toHaveLength(6);
    expect(state.players.p2.prizes).toHaveLength(6);
  });

  it("…and against a Stage 2 Active too — 'not Basic' is a two-member set", () => {
    const before = armed(3, "fix-kod-stage2");
    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: BASIC_BREAKER,
    });
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.players.p2.active?.damage).toBe(0);
    expect(state.players.p2.active?.markers).toEqual([]);
  });

  it("the ORDINARY attack Knock Out on the same board still works — the pair is live", () => {
    // The control that stops §2 from being satisfiable by an attack that does
    // nothing at all: index 1 on the SAME card, same board, kills by damage.
    const before = armed(4);
    const victim = activeUid(before, "p2");
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: PLAIN_BITE });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 200 });
    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: victim });
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });

  it("a Stage 1 Active dies to the ORDINARY attack — the gate is about the OP, not the body", () => {
    const before = armed(5, "fix-kod-stage1");
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: PLAIN_BITE });
    expect(findEvent(events, "KNOCKED_OUT")).toBeDefined();
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });
});

describe("§3 `byAttack` — a non-damage Knock Out is NOT 'by damage from an attack'", () => {
  it("marks the effect Knock Out `byAttack: false`", () => {
    const { before, after } = struck(6, BASIC_BREAKER);
    const marks = after.lastKoMarks.p2;
    expect(marks).toHaveLength(1);
    expect(marks[0]?.byAttack).toBe(false);
    expect(marks[0]?.name).toBe("fix-kod-victim");
    expect(after.lastKoMarks.p1).toEqual([]);
    // …and the window is genuinely OPEN, so "byAttack is false" is a statement
    // about the cause rather than about an empty list nobody can see.
    expect(after.lastKoTurn.p2).toBe(before.turn);
    expect(koedDuringOpponentsLastTurn(after, "p2")).toBe(true);
    expect(koedMarksOnOpponentsLastTurn(after, "p2")).toHaveLength(1);
  });

  it("THE CONTROL — an ordinary damage Knock Out on the SAME board is `byAttack: true`", () => {
    const { after } = struck(6, PLAIN_BITE);
    const marks = after.lastKoMarks.p2;
    expect(marks).toHaveLength(1);
    expect(marks[0]?.byAttack).toBe(true);
    expect(marks[0]?.name).toBe("fix-kod-victim");
  });

  it("drives the READER — the revenge clause does not fire on an effect Knock Out", () => {
    const effectKo = struck(7, BASIC_BREAKER).after;
    const damageKo = struck(7, PLAIN_BITE).after;

    for (const state of [effectKo, damageKo]) {
      expect(koedDuringOpponentsLastTurn(state, "p2")).toBe(true);
    }
    expect(conditionHolds(damageKo, "p2", BY_ATTACK)).toBe(true);
    expect(conditionHolds(effectKo, "p2", BY_ATTACK)).toBe(false);
    expect(conditionHolds(damageKo, "p1", BY_ATTACK)).toBe(false);
    expect(conditionHolds(effectKo, "p1", BY_ATTACK)).toBe(false);
  });

  it("the mark is asked PER BODY — the old batch-level answer is not merely narrower", () => {
    const before = armed(8);
    const stale = staleMarked(before, "p2", before.turn - 1);
    const { state } = mustApply(stale, { type: "attack", seat: "p1", index: PLAIN_BITE });
    const after = settle(state);
    expect(after.lastKoMarks.p2[0]?.byAttack).toBe(true);
    expect(conditionHolds(after, "p2", BY_ATTACK)).toBe(true);
  });

  it("…and a CURRENT-turn marker on a damage Knock Out answers false — the marker decides", () => {
    const before = armed(9);
    const current = staleMarked(before, "p2", before.turn);
    const { state } = mustApply(current, { type: "attack", seat: "p1", index: PLAIN_BITE });
    const after = settle(state);
    expect(after.lastKoMarks.p2[0]?.byAttack).toBe(false);
    expect(conditionHolds(after, "p2", BY_ATTACK)).toBe(false);
  });
});

const PUNCH_HP = programFor("sv03-197")?.passive?.damageAttackerOnKo?.amount ?? 0;

describe("§4 Vengeful Punch — an effect Knock Out pays no recoil", () => {
  it("the holder Knocked Out by `knockOutDefender` deals NOTHING to the attacker", () => {
    const before = armed(10, "fix-kod-victim", { tool: "sv03-197" });
    expect(before.players.p2.active?.tools).toHaveLength(1); // the Tool is really on
    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: BASIC_BREAKER,
    });

    expect(findEvent(events, "KNOCKED_OUT")).toBeDefined(); // the KO really happened…
    expect(types(events)).not.toContain("COUNTERS_PLACED"); // …and paid nothing
    expect(state.players.p1.active?.damage).toBe(0);
  });

  it("THE CONTROL — the SAME holder Knocked Out by damage still pays its 40", () => {
    const before = armed(10, "fix-kod-victim", { tool: "sv03-197" });
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: PLAIN_BITE });

    expect(findEvent(events, "KNOCKED_OUT")).toBeDefined();
    expect(findEvent(events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1", // the seat that OWNS the damaged body — the ATTACKER's
      amount: PUNCH_HP,
      source: "counterattack",
    });
    expect(state.players.p1.active?.damage).toBe(PUNCH_HP);
    // …and the number itself, pinned ONCE so the constant above cannot quietly
    // become 0 (which would make every "paid nothing" case in this section pass).
    expect(PUNCH_HP).toBe(40);
  });

  it("a STALE marker does not excuse the recoil — the turn is read at this site too", () => {
    const board = armed(11, "fix-kod-victim", { tool: "sv03-197" });
    const before = staleMarked(board, "p2", board.turn - 1);
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: PLAIN_BITE });
    expect(findEvent(events, "COUNTERS_PLACED")).toMatchObject({ amount: PUNCH_HP });
    expect(state.players.p1.active?.damage).toBe(PUNCH_HP);
  });

  it("…and a CURRENT-turn marker suppresses it on the same damage hit", () => {
    // The inverse surgery, for the reason its §3 twin exists: without it the case
    // above passes against a site that reads no marker at all.
    const board = armed(12, "fix-kod-victim", { tool: "sv03-197" });
    const before = staleMarked(board, "p2", board.turn);
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: PLAIN_BITE });
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(state.players.p1.active?.damage).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE MARKER'S OWN RULES.
// ─────────────────────────────────────────────────────────────────────────────

function staleMarked(state: GameState, seat: Seat, turn: number): GameState {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...state.players[seat],
        active: { ...active, markers: [...active.markers, koByEffectMarker(turn)] },
      },
    },
  };
}

describe("§5 the marker — a turn STAMP, so a denied Knock Out cannot lie to the next one", () => {
  it("is `koByEffect:<turn>` and a different turn is a different string", () => {
    // The whole of the arithmetic, in one line, because the arithmetic IS the
    // expiry: there is no clear anywhere and no second place to forget one.
    expect(koByEffectMarker(0)).toBe("koByEffect:0");
    expect(koByEffectMarker(7)).toBe("koByEffect:7");
    expect(koByEffectMarker(7)).not.toBe(koByEffectMarker(8));
    expect(koByEffectMarker(3).startsWith("koByEffect:")).toBe(true);
  });

  it("the op WRITES the current turn's stamp onto the defender, and is idempotent", () => {
    const board = armed(13);
    const events: GameEvent[] = [];
    const result = runProgram(
      board,
      [{ op: "knockOutDefender" }],
      { seat: "p1", invokedBy: "attack" },
      {},
      events,
    );
    const doomed = result.state.players.p2.active;
    expect(doomed?.markers).toEqual([koByEffectMarker(board.turn)]);
    // …and lethal against `effectiveMaxHp` AS IT STANDS, which is what hands the
    // body to §8.1's existing sweep rather than to a second KO implementation.
    expect(doomed?.damage).toBe(120);
    const twice: GameEvent[] = [];
    const again = runProgram(
      result.state,
      [{ op: "knockOutDefender" }],
      { seat: "p1", invokedBy: "attack" },
      {},
      twice,
    );
    expect(again.state.players.p2.active?.markers).toEqual([koByEffectMarker(board.turn)]);
  });

  it("a STALE stamp does not suppress `byAttack` — asserted at both readers", () => {
    const before = armed(14, "fix-kod-victim", { tool: "sv03-197" });
    const stale = staleMarked(before, "p2", before.turn - 2);
    const { state } = mustApply(stale, { type: "attack", seat: "p1", index: PLAIN_BITE });
    expect(state.players.p1.active?.damage).toBe(PUNCH_HP); // `koRecoilOf` paid
    expect(settle(state).lastKoMarks.p2[0]?.byAttack).toBe(true); // `byAttackFor` marked
  });
});

const WIDE_HEADS_SEEDS: readonly number[] = [2, 3, 6, 7, 16, 18, 20, 22, 23];

const SHIELD_SEED = WIDE_HEADS_SEEDS[0] ?? 0;

function installWide(seed: number): { state: GameState; events: GameEvent[] } {
  let state = must(applyAction(localSetup(seed, "p1"), { type: "endTurn", seat: "p1" }));
  state = clearBench(state, "p2");
  state = handToDeck(state, "p2", "sv03-004");
  state = setActiveFromDeck(state, "p2", "sv03-004");
  state = attachFromDeck(state, "p2", "fix-energy", 1);
  return mustApply(state, { type: "attack", seat: "p2", index: 0 });
}

function shielded(seed: number): GameState {
  const installed = installWide(seed);
  if (findEvent(installed.events, "ATTACK_BLOCK_APPLIED") === undefined) {
    throw new Error(`seed ${seed} did not install a wide block (tails?)`);
  }
  let next = clearBench(installed.state, "p2");
  next = benchFromDeck(next, "p2", "fix-titan");
  next = benchFromDeck(next, "p2", "fix-bigbody");
  next = setActiveFromDeck(next, "p1", "fix-kod");
  next = clearBench(next, "p1");
  next = benchFromDeck(next, "p1", "fix-titan");
  return attachFromDeck(next, "p1", "fix-energy", 1);
}

describe("§6 §11 — a 'prevent all effects of attacks done to this Pokémon' block refuses it", () => {
  it("the HEADS seed table is measured, not inherited", () => {
    const measured: number[] = [];
    for (let seed = 1; seed <= 24; seed += 1) {
      if (findEvent(installWide(seed).events, "ATTACK_BLOCK_APPLIED") !== undefined)
        measured.push(seed);
    }
    expect(measured).toEqual([...WIDE_HEADS_SEEDS]);
    expect(WIDE_HEADS_SEEDS.length).toBeGreaterThan(0);
  });

  it("refuses the Knock Out, leaves the body ALIVE, and stamps NO marker", () => {
    const before = shielded(SHIELD_SEED);
    const survivor = activeUid(before, "p2");
    // Scyther is a BASIC, so the gate really does open — otherwise this case would
    // be measuring the gate rather than the block.
    expect(POOL["sv03-004"]?.stage).toBe("Basic");

    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: BASIC_BREAKER,
    });

    expect(findEvent(events, "ATTACK_EFFECT_PREVENTED")).toEqual({
      type: "ATTACK_EFFECT_PREVENTED",
      seat: "p2",
      uid: survivor,
    });
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.players.p2.active?.stack).toContain(survivor);
    expect(state.players.p2.active?.markers).toEqual([]);
    expect(state.players.p2.active?.damage).toBe(0);
  });

  it("THE CONTROL — the SAME board with the block removed loses the Scyther", () => {
    // Without this the case above is satisfied by a build that cannot Knock Out a
    // Scyther at all (its 80 HP, its Grass type, its being the installer). The
    // block is surgically stripped and nothing else moves.
    const shieldedBoard = shielded(SHIELD_SEED);
    expect(shieldedBoard.players.p2.active?.attackBlock).not.toBeNull();
    const bare: GameState = {
      ...shieldedBoard,
      players: {
        ...shieldedBoard.players,
        p2: {
          ...shieldedBoard.players.p2,
          active:
            shieldedBoard.players.p2.active === null
              ? null
              : { ...shieldedBoard.players.p2.active, attackBlock: null },
        },
      },
    };
    const { events } = mustApply(bare, { type: "attack", seat: "p1", index: BASIC_BREAKER });
    expect(findEvent(events, "KNOCKED_OUT")).toBeDefined();
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });
});

function clearActive(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) return state;
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        active: null,
        discard: [...side.discard, ...active.stack, ...active.energy, ...active.tools],
      },
    },
  };
}

function armedSpecial(seed: number, opts: { theirs?: string; mine?: string } = {}): GameState {
  let state = must(
    applyAction(localSetup(seed, "p2", SPECIAL_KO_DECK), { type: "endTurn", seat: "p2" }),
  );
  state = setActiveFromDeck(state, "p1", "fix-kod-special");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  if (opts.mine !== undefined) state = attachFromDeck(state, "p1", opts.mine, 1);
  state = setActiveFromDeck(state, "p2", "fix-kod-victim");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = benchFromDeck(state, "p2", "fix-bigbody");
  if (opts.theirs !== undefined) state = attachFromDeck(state, "p2", opts.theirs, 1);
  return state;
}

describe("§7.1 D415's deriver — arm 6a with the `cond` swapped and nothing else", () => {
  it("derives the printed sentence to `conditionGate` over `knockOutDefender`", () => {
    expect(deriveAttackEffect(SPECIAL_ENERGY_KO_TEXT)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveHasEnergyAttached", energy: "special" },
        ops: [{ op: "knockOutDefender" }],
      },
    ]);
  });

  it("differs from D414's Basic gate in the `cond` and in NOTHING else", () => {
    const basic = deriveAttackEffect(BASIC_KO_TEXT);
    const special = deriveAttackEffect(SPECIAL_ENERGY_KO_TEXT);
    for (const program of [basic, special]) {
      expect(program).toHaveLength(1);
      expect(program?.[0]).toMatchObject({
        op: "conditionGate",
        ops: [{ op: "knockOutDefender" }],
      });
    }
    expect(basic?.[0]).toMatchObject({ cond: { kind: "opponentActiveIsBasic" } });
    expect(special?.[0]).toMatchObject({ cond: OPPONENT_SPECIAL });
    // …and they are not the SAME program, so "one field apart" is a difference and
    // not an alias.
    expect(special).not.toEqual(basic);
  });

  it("D202's family — both apostrophe spellings derive the SAME program", () => {
    const curly = SPECIAL_ENERGY_KO_TEXT.replace(/'/g, "’");
    expect(curly).not.toBe(SPECIAL_ENERGY_KO_TEXT);
    expect(curly).toContain("opponent’s");
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(SPECIAL_ENERGY_KO_TEXT));
    expect(deriveAttackEffect(curly)).not.toBeNull();
  });

  it("is anchored end to end — leading text, a lost period and a lowercase opener", () => {
    // Three chances to forget a `^` or a `$`, and the failure mode of each is a
    // half-simulated attack rather than a loud one.
    expect(deriveAttackEffect(`Flip a coin. If heads, ${SPECIAL_ENERGY_KO_TEXT}`)).toBeNull();
    expect(deriveAttackEffect(SPECIAL_ENERGY_KO_TEXT.replace(/\.$/, ""))).toBeNull();
    expect(deriveAttackEffect(SPECIAL_ENERGY_KO_TEXT.toLowerCase())).toBeNull();
    expect(deriveAttackEffect(`${SPECIAL_ENERGY_KO_TEXT} Draw a card.`)).toBeNull();
    expect(
      deriveAttackEffect("If this Pokémon has any Special Energy attached, it is Knocked Out."),
    ).toBeNull();
  });

  it("keeps the local fixture's printed text verbatim — the sentence IS the wiring", () => {
    // A one-character drift does not throw on the deriver path: it drops the card
    // onto ATTACK_EFFECT_SKIPPED and every board in §7.2 stops Knocking anything
    // Out, with no other failure anywhere. ASCII apostrophe, a real é.
    expect(LOCAL_CARDS["fix-kod-special"]?.attacks?.[0]).toEqual({
      cost: ["Colorless"],
      name: "Sharp Fang",
      effect: SPECIAL_ENERGY_KO_TEXT,
    });
    expect(SPECIAL_ENERGY_KO_TEXT).toContain("opponent's");
    expect(SPECIAL_ENERGY_KO_TEXT).toContain("Pokémon");
    expect(SPECIAL_ENERGY_KO_TEXT).not.toContain("’");
  });
});

describe("§7.2 the member on a real board — the gate, both directions", () => {
  it("Knocks the opponent's Active Out when it holds a Special Energy", () => {
    const before = armedSpecial(20, { theirs: "sv02-190" });
    const victim = activeUid(before, "p2");
    // The Special really is on, and the member really does read it — stated before
    // the attack so a failing board below cannot be a fixture that never attached.
    expect(before.players.p2.active?.energy).toHaveLength(1);
    expect(conditionHolds(before, "p1", OPPONENT_SPECIAL)).toBe(true);
    deepFreeze(before);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: SHARP_FANG });

    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: victim });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const settled = settle(state);
    expect(settled.players.p1.prizes).toHaveLength(5);
    expect(settled.players.p2.discard).toContain(victim);
  });

  it("THE NEGATIVE CONTROL — a BASIC Energy on the same spot Knocks nothing Out", () => {
    const before = armedSpecial(21, { theirs: "fix-fire-energy" });
    const survivor = activeUid(before, "p2");
    // The Energy IS attached and IS read — by the typed reading of the very same
    // member, on the very same board. Without this pair the case would pass against
    // a fixture whose attachment silently never happened.
    expect(before.players.p2.active?.energy).toHaveLength(1);
    expect(
      conditionHolds(before, "p1", { kind: "opponentActiveHasEnergyAttached", energy: "Fire" }),
    ).toBe(true);
    expect(conditionHolds(before, "p1", OPPONENT_SPECIAL)).toBe(false);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: SHARP_FANG });

    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.players.p2.active?.stack).toContain(survivor);
    // Not merely un-Knocked-Out — UNTOUCHED. The op marks lethal against
    // `effectiveMaxHp`, so a gate that fired and was then undone would still leave
    // 120 damage and a `koByEffect:` marker sitting on a 120 HP body.
    expect(state.players.p2.active?.damage).toBe(0);
    expect(state.players.p2.active?.markers).toEqual([]);
    // The attack RESOLVED — a gate answering "no" is not a skipped effect.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(state.phase.kind).toBe("turn:action");
    expect(state.players.p1.prizes).toHaveLength(6);
    expect(state.players.p2.prizes).toHaveLength(6);
  });

  it("…and a BARE Active Spot with no Energy at all is refused too", () => {
    // "No Special" is a two-member set — a wrong-class Energy and no Energy — and
    // one member declining says nothing about the other.
    const before = armedSpecial(22);
    expect(before.players.p2.active?.energy).toEqual([]);
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: SHARP_FANG });
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.players.p2.active?.damage).toBe(0);
    expect(state.players.p2.active?.markers).toEqual([]);
  });

  it("the ORDINARY attack kills the SAME body on the SAME board — the pair is live", () => {
    const before = armedSpecial(21, { theirs: "fix-fire-energy" });
    const victim = activeUid(before, "p2");
    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: SPECIAL_PLAIN_BITE,
    });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 200 });
    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: victim });
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });
});

describe("§7.3 THE SEAT — the member reads the OPPONENT's Active, never the viewer's", () => {
  it("a Special on MY OWN Active Knocks nothing Out — the `otherSeat` mutant's board", () => {
    const before = armedSpecial(23, { mine: "sv02-190", theirs: "fix-fire-energy" });
    const survivor = activeUid(before, "p2");
    // The board really is the disagreeing one: MY Active holds a Special (plus the
    // {C} that pays the attack), THEIRS does not.
    expect(before.players.p1.active?.energy).toHaveLength(2);
    expect(
      conditionHolds(before, "p1", { kind: "yourActiveHasEnergyAttached", energy: "special" }),
    ).toBe(true);
    expect(conditionHolds(before, "p1", OPPONENT_SPECIAL)).toBe(false);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: SHARP_FANG });

    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.players.p2.active?.stack).toContain(survivor);
    expect(state.players.p2.active?.damage).toBe(0);
    expect(state.players.p2.active?.markers).toEqual([]);
    // …and the attacker is not Knocked Out either, which is the OTHER way a
    // seat-confused build could read: the gate names a body, and no body on either
    // board was named here.
    expect(state.players.p1.active?.damage).toBe(0);
    expect(state.players.p1.active?.markers).toEqual([]);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("the SAME board answers TRUE for the other seat — it is a mirror, not a constant", () => {
    const board = armedSpecial(23, { mine: "sv02-190", theirs: "fix-fire-energy" });
    expect(conditionHolds(board, "p1", OPPONENT_SPECIAL)).toBe(false);
    expect(conditionHolds(board, "p2", OPPONENT_SPECIAL)).toBe(true);
    for (const energy of ["special", "Fire"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        const other = seat === "p1" ? "p2" : "p1";
        expect(
          conditionHolds(board, seat, { kind: "opponentActiveHasEnergyAttached", energy }),
        ).toBe(conditionHolds(board, other, { kind: "yourActiveHasEnergyAttached", energy }));
      }
    }
    // …and the two members really do disagree from a single seat, so the loop above
    // is not comparing a value with itself.
    expect(conditionHolds(board, "p1", OPPONENT_SPECIAL)).not.toBe(
      conditionHolds(board, "p1", { kind: "yourActiveHasEnergyAttached", energy: "special" }),
    );
  });

  it("is a PURE read on a frozen board, from both seats", () => {
    const frozen = deepFreeze(armedSpecial(24, { mine: "sv02-190", theirs: "sv02-190" }));
    for (const seat of ["p1", "p2"] as const) {
      expect(() => conditionHolds(frozen, seat, OPPONENT_SPECIAL)).not.toThrow();
      expect(conditionHolds(frozen, seat, OPPONENT_SPECIAL)).toBe(true);
    }
  });
});

describe("§7.4 the contracts the member INHERITS from its self twin", () => {
  it("answers FALSE — not a throw — on an EMPTY Active Spot, both parameter shapes", () => {
    const armedBoard = armedSpecial(25, { theirs: "sv02-190" });
    expect(conditionHolds(armedBoard, "p1", OPPONENT_SPECIAL)).toBe(true); // …and it WAS true
    const empty = clearActive(armedBoard, "p2");
    expect(empty.players.p2.active).toBeNull();
    for (const energy of ["special", "Fire"] as const) {
      expect(() =>
        conditionHolds(empty, "p1", { kind: "opponentActiveHasEnergyAttached", energy }),
      ).not.toThrow();
      expect(conditionHolds(empty, "p1", { kind: "opponentActiveHasEnergyAttached", energy })).toBe(
        false,
      );
    }
    // The VIEWER's own spot being empty is a different board and must not answer
    // for the opponent's — the null check is on the seat the member reads.
    const mineEmpty = clearActive(armedBoard, "p1");
    expect(mineEmpty.players.p1.active).toBeNull();
    expect(conditionHolds(mineEmpty, "p1", OPPONENT_SPECIAL)).toBe(true);
  });

  it("reads by PROVISION and by CLASS — a Basic is never a Special, whatever it pays", () => {
    const jet = armedSpecial(26, { theirs: "sv02-190" });
    expect(conditionHolds(jet, "p1", OPPONENT_SPECIAL)).toBe(true);
    for (const energy of BASIC_ENERGY_TYPES) {
      expect(conditionHolds(jet, "p1", { kind: "opponentActiveHasEnergyAttached", energy })).toBe(
        false,
      );
    }
    const fire = armedSpecial(27, { theirs: "fix-fire-energy" });
    expect(
      conditionHolds(fire, "p1", { kind: "opponentActiveHasEnergyAttached", energy: "Fire" }),
    ).toBe(true);
    expect(conditionHolds(fire, "p1", OPPONENT_SPECIAL)).toBe(false);
    // …and the wrong TYPE is as false as no Energy at all.
    expect(
      conditionHolds(fire, "p1", { kind: "opponentActiveHasEnergyAttached", energy: "Lightning" }),
    ).toBe(false);
  });
});

describe("§7.5 `conditionNote` — the pill a HUD renders, and the twin it must not echo", () => {
  it("round-trips both parameter shapes, and NEITHER drops the possessive", () => {
    expect(conditionNote(OPPONENT_SPECIAL)).toBe(
      "your opponent's Active Pokémon has a Special Energy attached",
    );
    expect(conditionNote({ kind: "opponentActiveHasEnergyAttached", energy: "Fire" })).toBe(
      "your opponent's Active Pokémon has Fire Energy attached",
    );
    for (const energy of BASIC_ENERGY_TYPES) {
      const note = conditionNote({ kind: "opponentActiveHasEnergyAttached", energy });
      expect(note).toBe(`your opponent's Active Pokémon has ${energy} Energy attached`);
      expect(note).not.toContain("{");
      expect(note).toContain("your opponent's");
    }
  });

  it("DIFFERS from the self twin's note on every parameter — the seat is visible", () => {
    for (const energy of ["special", ...BASIC_ENERGY_TYPES] as const) {
      const mine = conditionNote({ kind: "yourActiveHasEnergyAttached", energy });
      const theirs = conditionNote({ kind: "opponentActiveHasEnergyAttached", energy });
      expect(theirs).not.toBe(mine);
      // …and the difference is exactly the possessive, not a re-voicing: the twin's
      // note is this one's tail.
      expect(theirs).toBe(`your opponent's ${mine.slice("your ".length)}`);
      expect(mine).not.toContain("opponent");
    }
  });
});
