import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackGateOf, attackTimingBlocked, firstTurnAttackBanned } from "./index";
import { applyAction, programFor, redactGame } from "./index";
import type { BoardCondition, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  setActiveFromDeck,
  typedEnergy,
  walkProgram,
  must,
  activeOf,
  driveSetup,
  programmedCardIds,
} from "./testFixtures";

const BAN_TEXT =
  "If you go second, you can't use this attack during your first turn. This attack does 30 damage for each of your Benched Pokémon.";
const GATE_TEXT_ILLUMISE =
  "You can use this attack only if you go second, and only during your first turn. Shuffle 1 of your opponent's Benched Pokémon and all attached cards into their deck.";
const GATE_TEXT_SCREAM =
  "You can use this attack only if you go second, and only during your first turn. Your opponent can't play any Supporter cards from their hand during their next turn.";
const LICENCE_TEXT_VOLBEAT =
  "If you go first, you can use this attack during your first turn. Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.";
const LICENCE_TEXT_EXEGGCUTE =
  "If you go first, you can use this attack during your first turn. Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.";

const BAN_IDS = [
  "sv07-128",
  "sv07-170",
  "sv07-173",
  "sv08.5-092",
  "sv08.5-169",
  "sv08.5-180",
  "svp-165",
] as const;
const GATE_IDS = ["sv06-010", "sv06-094", "sv06-197"] as const;
const LICENCE_IDS = ["sv06-009", "sv08-001", "sv08-192"] as const;
const ALL_IDS = [...BAN_IDS, ...GATE_IDS, ...LICENCE_IDS];

function terapagos(id: string): Card {
  return battler(id, {
    name: "Terapagos ex",
    hp: 230,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Unified Beatdown", effect: BAN_TEXT },
      { cost: ["Colorless", "Colorless"], name: "Crown Opal", damage: 180 },
    ],
  });
}

function screamTail(id: string): Card {
  return battler(id, {
    name: "Scream Tail ex",
    hp: 190,
    retreat: 1,
    types: ["Psychic"],
    attacks: [
      { cost: ["Colorless"], name: "Scream", effect: GATE_TEXT_SCREAM },
      { cost: ["Colorless", "Colorless"], name: "Crunch", damage: 120 },
    ],
  });
}

function exeggcute(id: string): Card {
  return battler(id, {
    name: "Exeggcute",
    hp: 30,
    retreat: 1,
    types: ["Grass"],
    attacks: [
      { cost: ["Colorless"], name: "Precocious Evolution", effect: LICENCE_TEXT_EXEGGCUTE },
    ],
  });
}

const UNGATED = "fix-ungated";

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(BAN_IDS.map((id) => [id, terapagos(id)])),
  "sv06-010": battler("sv06-010", {
    name: "Illumise",
    hp: 70,
    retreat: 1,
    types: ["Grass"],
    attacks: [
      { cost: ["Colorless"], name: "Slowing Perfume", effect: GATE_TEXT_ILLUMISE },
      { cost: ["Colorless", "Colorless"], name: "Glide", damage: 30 },
    ],
  }),
  "sv06-094": screamTail("sv06-094"),
  "sv06-197": screamTail("sv06-197"),
  "sv06-009": battler("sv06-009", {
    name: "Volbeat",
    hp: 70,
    retreat: 1,
    types: ["Grass"],
    attacks: [
      { cost: ["Colorless"], name: "Quick Sign", effect: LICENCE_TEXT_VOLBEAT },
      { cost: ["Colorless", "Colorless"], name: "Coordinated Strike", damage: 20 },
    ],
  }),
  "sv08-001": exeggcute("sv08-001"),
  "sv08-192": exeggcute("sv08-192"),
  [UNGATED]: battler(UNGATED, {
    name: "Ungated Control",
    hp: 230,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Plain Beatdown", damage: 30 },
      { cost: ["Colorless", "Colorless"], name: "Plain Opal", damage: 180 },
    ],
  }),
  "fix-gate-energy": typedEnergy("fix-gate-energy", "Colorless"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const GATE_DECK = deckOf({
  "sv07-128": 4,
  "sv07-170": 1,
  "sv07-173": 1,
  "sv08.5-092": 1,
  "sv08.5-169": 1,
  "sv08.5-180": 1,
  "svp-165": 1,
  "sv06-010": 4,
  "sv06-094": 1,
  "sv06-197": 1,
  "sv06-009": 4,
  "sv08-001": 2,
  "sv08-192": 2,
  [UNGATED]: 4,
  "sv01-096": 2, // Klefki — the §9 Ability-lock control
  "fix-basic-1": 4,
  "fix-gate-energy": 20,
  "fix-energy": 6,
});

const SEEDS = [4111, 4127, 4133, 4159] as const;

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: GATE_DECK, p2: GATE_DECK }, { pool: POOL, first });
}

function board(seed: number, first: Seat, seat: Seat, activeId: string): GameState {
  let state = localSetup(seed, first);
  state = setActiveFromDeck(state, seat, activeId);
  state = clearBench(state, seat);
  state = benchFromDeck(state, seat, "fix-basic-1");
  return attachFromDeck(state, seat, "fix-gate-energy", 2);
}

function passTurns(state: GameState, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

/** Declare `index` and report the error code, or "OK" when the engine accepted
    it. Every §8 assertion in this file goes through this so a green "the gate
    refuses" line can never be a refusal for the WRONG reason. */
function declare(state: GameState, seat: Seat, index: number): string {
  const result = applyAction(deepFreeze(state), { type: "attack", seat, index });
  return result.ok ? "OK" : result.error.code;
}

function wirePlayable(state: GameState, seat: Seat, index: number): boolean | undefined {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.attacks.find((a) => a.index === index)?.playable;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The catalog claim the whole field rests on — every gate is at INDEX 0.
// ─────────────────────────────────────────────────────────────────────────────

describe("D281 — the census, and the per-INDEX claim checked against the printings", () => {
  it("all 13 FIRST-TURN ids carry an `attackGate`, and every one of THOSE is at index 0", () => {
    for (const id of ALL_IDS) {
      const gate = programFor(id)?.attackGate;
      expect(gate, id).toBeDefined();
      expect(Object.keys(gate ?? {}), id).toEqual(["0"]);
    }
    expect(ALL_IDS.length).toBe(13);
  });

  it("the gated attack really IS index 0 on every fixture, and idx 1 exists on four of five", () => {
    const gatedText: Record<string, string> = {
      "sv07-128": BAN_TEXT,
      "sv06-010": GATE_TEXT_ILLUMISE,
      "sv06-094": GATE_TEXT_SCREAM,
      "sv06-009": LICENCE_TEXT_VOLBEAT,
      "sv08-001": LICENCE_TEXT_EXEGGCUTE,
    };
    for (const [id, text] of Object.entries(gatedText)) {
      const attacks = POOL[id]?.attacks ?? [];
      expect(attacks[0]?.effect, id).toBe(text);
      expect(
        attacks.slice(1).filter((a) => (a.effect ?? "").includes("first turn")),
        id,
      ).toEqual([]);
    }
    // Four of the five carry a SECOND attack that must not inherit the clause;
    // Exeggcute carries exactly ONE, which is why registry.ts argues the per-index
    // shape from the printed REFERENT ("this attack") and not from a body count.
    expect(POOL["sv07-128"]?.attacks).toHaveLength(2);
    expect(POOL["sv06-010"]?.attacks).toHaveLength(2);
    expect(POOL["sv06-094"]?.attacks).toHaveLength(2);
    expect(POOL["sv06-009"]?.attacks).toHaveLength(2);
    expect(POOL["sv08-001"]?.attacks).toHaveLength(1);
  });

  it("`attackGateOf` is TOTAL — an ungated body, a missing index and a bogus one all answer undefined", () => {
    const state = board(SEEDS[0], "p1", "p1", "sv07-128");
    const gated = activeOf(state, "p1");
    expect(attackGateOf(state, gated, 0)).toBeDefined();
    expect(attackGateOf(state, gated, 1)).toBeUndefined();
    expect(attackGateOf(state, gated, 99)).toBeUndefined();
    expect(attackGateOf(state, gated, -1)).toBeUndefined();
    const plain = board(SEEDS[0], "p1", "p1", UNGATED);
    expect(attackGateOf(plain, activeOf(plain, "p1"), 0)).toBeUndefined();
  });
});

describe("D281 — the per-INDEX LICENCE (Volbeat, Exeggcute)", () => {
  it("licenses idx 0 on turn 1 and leaves idx 1 BANNED — the board a per-BODY flag gets wrong", () => {
    for (const first of ["p1", "p2"] as const) {
      const state = board(SEEDS[0], first, first, "sv06-009");
      expect(state.turn, `${first}`).toBe(1);
      expect(declare(state, first, 0), `${first} idx0`).toBe("OK");
      expect(declare(state, first, 1), `${first} idx1`).toBe("FIRST_TURN_ATTACK");
      // …and the predicate says the same thing, per index.
      expect(firstTurnAttackBanned(state, activeOf(state, first), 0), `${first}`).toBe(false);
      expect(firstTurnAttackBanned(state, activeOf(state, first), 1), `${first}`).toBe(true);
    }
  });

  it("the CONTROL body is banned at BOTH indices on the same board — the licence is doing the work", () => {
    for (const first of ["p1", "p2"] as const) {
      const state = board(SEEDS[1], first, first, UNGATED);
      expect(declare(state, first, 0), `${first} idx0`).toBe("FIRST_TURN_ATTACK");
      expect(declare(state, first, 1), `${first} idx1`).toBe("FIRST_TURN_ATTACK");
    }
  });

  it("Exeggcute's ONE attack is licensed on turn 1 — the single-attack printing", () => {
    for (const id of ["sv08-001", "sv08-192"] as const) {
      for (const first of ["p1", "p2"] as const) {
        const state = board(SEEDS[2], first, first, id);
        expect(declare(state, first, 0), `${id}/${first}`).toBe("OK");
      }
    }
  });

  it("the licence changes NOTHING from turn 2 onward — it lifts a ban, it does not create one", () => {
    for (const activeId of ["sv06-009", UNGATED]) {
      for (const first of ["p1", "p2"] as const) {
        let state = board(SEEDS[3], first, first, activeId);
        for (let turn = 2; turn <= 5; turn += 1) {
          state = passTurns(state, 1);
          const seat = state.phase.kind === "turn:action" ? state.phase.seat : first;
          state = setActiveFromDeck(state, seat, activeId);
          state = clearBench(state, seat);
          state = benchFromDeck(state, seat, "fix-basic-1");
          state = attachFromDeck(state, seat, "fix-gate-energy", 2);
          expect(
            firstTurnAttackBanned(state, activeOf(state, seat), 0),
            `${activeId}@${turn}`,
          ).toBe(false);
          expect(
            firstTurnAttackBanned(state, activeOf(state, seat), 1),
            `${activeId}@${turn}`,
          ).toBe(false);
        }
      }
    }
  });
});

describe("D281 — `onlyIf` and `barredIf` are ONE condition at two signs", () => {
  it("Terapagos's `barredIf` and Illumise's `onlyIf` carry the IDENTICAL condition", () => {
    const ban = programFor("sv07-128")?.attackGate?.[0];
    const gate = programFor("sv06-010")?.attackGate?.[0];
    expect(ban?.kind).toBe("barredIf");
    expect(gate?.kind).toBe("onlyIf");
    const expected: BoardCondition = {
      kind: "allOf",
      conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }],
    };
    expect(ban?.kind === "barredIf" ? ban.condition : undefined).toEqual(expected);
    expect(gate?.kind === "onlyIf" ? gate.condition : undefined).toEqual(expected);
    expect(
      new Set(expected.kind === "allOf" ? expected.conditions.map((c) => c.kind) : []),
    ).toEqual(new Set(["youGoSecond", "yourFirstTurn"]));
  });

  it("on the ONE board the condition holds, they answer OPPOSITELY", () => {
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      let state = passTurns(localSetup(SEEDS[0], first), 1);
      expect(state.turn, `${first}`).toBe(2);
      // The BAN: barred on exactly this turn.
      let banBoard = setActiveFromDeck(state, second, "sv07-128");
      banBoard = clearBench(banBoard, second);
      banBoard = benchFromDeck(banBoard, second, "fix-basic-1");
      banBoard = attachFromDeck(banBoard, second, "fix-gate-energy", 2);
      expect(declare(banBoard, second, 0), `${first} ban idx0`).toBe("ATTACK_PREVENTED");
      // …and its OTHER attack is live on the same board, which is the whole
      // content of the field being per-index.
      expect(declare(banBoard, second, 1), `${first} ban idx1`).toBe("OK");
      // The GATE: usable on exactly this turn.
      let gateBoard = setActiveFromDeck(state, second, "sv06-010");
      gateBoard = clearBench(gateBoard, second);
      gateBoard = benchFromDeck(gateBoard, second, "fix-basic-1");
      gateBoard = attachFromDeck(gateBoard, second, "fix-gate-energy", 2);
      expect(declare(gateBoard, second, 0), `${first} gate idx0`).toBe("OK");
      state = banBoard;
    }
  });

  it("and on EVERY OTHER turn they swap — the gate closes and the ban lifts", () => {
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      // Turn 4: the going-second seat's SECOND turn. `yourFirstTurn` is false, so
      // the conjunction is false for both bodies.
      let state = passTurns(localSetup(SEEDS[1], first), 3);
      expect(state.turn, `${first}`).toBe(4);
      for (const [id, expected] of [
        ["sv07-128", "OK"],
        ["sv06-010", "ATTACK_PREVENTED"],
      ] as const) {
        let b = setActiveFromDeck(state, second, id);
        b = clearBench(b, second);
        b = benchFromDeck(b, second, "fix-basic-1");
        b = attachFromDeck(b, second, "fix-gate-energy", 2);
        expect(declare(b, second, 0), `${first}/${id}@4`).toBe(expected);
      }
      state = passTurns(state, 1);
    }
  });

  it("the GATE is closed for the going-FIRST seat at every moment — `youGoSecond` is a seat fact", () => {
    for (const first of ["p1", "p2"] as const) {
      let state = passTurns(localSetup(SEEDS[2], first), 2);
      expect(state.turn, `${first}`).toBe(3);
      state = setActiveFromDeck(state, first, "sv06-010");
      state = clearBench(state, first);
      state = benchFromDeck(state, first, "fix-basic-1");
      state = attachFromDeck(state, first, "fix-gate-energy", 2);
      expect(declare(state, first, 0), `${first} gate`).toBe("ATTACK_PREVENTED");
      // …and its idx 1 "Glide" is live, so the refusal is the CLAUSE and not the
      // body being unable to attack at all.
      expect(declare(state, first, 1), `${first} glide`).toBe("OK");
    }
  });

  it("on TURN 1 the going-first seat's gated attack is refused by §4 FIRST, and that ordering is deliberate", () => {
    for (const first of ["p1", "p2"] as const) {
      const state = board(SEEDS[3], first, first, "sv06-010");
      expect(state.turn, `${first}`).toBe(1);
      expect(declare(state, first, 0), `${first}`).toBe("FIRST_TURN_ATTACK");
    }
  });

  it("the §8 reject NAMES the printed clause, in the printed polarity", () => {
    const first = "p1" as const;
    const second = "p2" as const;
    let state = passTurns(localSetup(SEEDS[0], first), 1);
    let gateBoard = setActiveFromDeck(passTurns(state, 2), second, "sv06-010");
    gateBoard = clearBench(gateBoard, second);
    gateBoard = benchFromDeck(gateBoard, second, "fix-basic-1");
    gateBoard = attachFromDeck(gateBoard, second, "fix-gate-energy", 2);
    const gateResult = applyAction(gateBoard, { type: "attack", seat: second, index: 0 });
    expect(gateResult.ok).toBe(false);
    if (!gateResult.ok) {
      expect(gateResult.error.message).toContain("Slowing Perfume");
      expect(gateResult.error.message).toContain(
        "it can only be used if you go second and it is your first turn",
      );
    }
    let banBoard = setActiveFromDeck(state, second, "sv07-128");
    banBoard = clearBench(banBoard, second);
    banBoard = benchFromDeck(banBoard, second, "fix-basic-1");
    banBoard = attachFromDeck(banBoard, second, "fix-gate-energy", 2);
    const banResult = applyAction(banBoard, { type: "attack", seat: second, index: 0 });
    expect(banResult.ok).toBe(false);
    if (!banResult.ok) {
      expect(banResult.error.message).toContain("Unified Beatdown");
      expect(banResult.error.message).toContain(
        "it cannot be used while you go second and it is your first turn",
      );
    }
    state = banBoard;
  });
});

describe("D281 — a §9 Ability-lock does NOT touch a printed attack clause", () => {
  it("Klefki `sv01-096` leaves BOTH polarities and the licence answering identically", () => {
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      const base = passTurns(localSetup(SEEDS[0], first), 1);
      for (const [id, index, expected] of [
        ["sv07-128", 0, "ATTACK_PREVENTED"],
        ["sv06-010", 0, "OK"],
      ] as const) {
        let clean = setActiveFromDeck(base, second, id);
        clean = clearBench(clean, second);
        clean = benchFromDeck(clean, second, "fix-basic-1");
        clean = attachFromDeck(clean, second, "fix-gate-energy", 2);
        // The LOCK is live: Klefki sits on the OPPOSING Active, which is where
        // "Mischievous Lock" reads from.
        const locked = setActiveFromDeck(clean, first, "sv01-096");
        expect(declare(clean, second, index), `${first}/${id} clean`).toBe(expected);
        expect(declare(locked, second, index), `${first}/${id} locked`).toBe(expected);
        // …and the READER agrees, not only the action.
        expect(
          attackTimingBlocked(clean, second, activeOf(clean, second), index) !== undefined,
          `${first}/${id} reader clean`,
        ).toBe(expected !== "OK");
        expect(
          attackTimingBlocked(locked, second, activeOf(locked, second), index) !== undefined,
          `${first}/${id} reader locked`,
        ).toBe(expected !== "OK");
      }
      // …and the LICENCE, on turn 1, under the same lock.
      let licensed = board(SEEDS[0], first, first, "sv06-009");
      expect(declare(licensed, first, 0), `${first} licence clean`).toBe("OK");
      licensed = setActiveFromDeck(licensed, second, "sv01-096");
      expect(declare(licensed, first, 0), `${first} licence locked`).toBe("OK");
    }
  });

  it("the ATTRIBUTION CONTROL — the lock really is live in this pool", () => {
    const state = board(SEEDS[0], "p1", "p2", "sv01-096");
    expect(POOL["sv01-096"]?.abilities?.[0]?.name).toBe("Mischievous Lock");
    expect(activeOf(state, "p2").stack.length).toBeGreaterThan(0);
  });
});

describe("D281 — the engine gate and the wire projection agree row by row", () => {
  it("every (seed × assignment × body × row) pair agrees — the sweep D223's `needs` string missed", () => {
    let compared = 0;
    let disagreements = 0;
    let legalRows = 0;
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const second = first === "p1" ? "p2" : "p1";
        for (const turns of [0, 1, 2, 3]) {
          const base = passTurns(localSetup(seed, first), turns);
          if (base.phase.kind !== "turn:action") continue;
          const seat = base.phase.seat;
          for (const id of ["sv07-128", "sv06-010", "sv06-009", UNGATED]) {
            let state = setActiveFromDeck(base, seat, id);
            state = clearBench(state, seat);
            state = benchFromDeck(state, seat, "fix-basic-1");
            state = attachFromDeck(state, seat, "fix-gate-energy", 2);
            const rows = POOL[id]?.attacks?.length ?? 0;
            for (let index = 0; index < rows; index += 1) {
              const accepted = declare(state, seat, index) === "OK";
              const offered = wirePlayable(state, seat, index);
              compared += 1;
              if (accepted) legalRows += 1;
              if (offered !== accepted) disagreements += 1;
            }
          }
          expect(seat === first || seat === second).toBe(true);
        }
      }
    }
    expect(compared).toBe(256);
    expect(legalRows).toBeGreaterThan(0);
    expect(legalRows).toBeLessThan(compared);
    expect(disagreements).toBe(0);
  });

  it("the wire greys ONE row and leaves its sibling live — the per-index projection", () => {
    // The case a body-wide `banned` term gets wrong, asserted on the wire rather
    // than inferred from the engine: Terapagos's idx 0 is barred on the exact turn
    // its idx 1 is live.
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      let state = setActiveFromDeck(passTurns(localSetup(SEEDS[0], first), 1), second, "sv07-128");
      state = clearBench(state, second);
      state = benchFromDeck(state, second, "fix-basic-1");
      state = attachFromDeck(state, second, "fix-gate-energy", 2);
      expect(wirePlayable(state, second, 0), `${first}`).toBe(false);
      expect(wirePlayable(state, second, 1), `${first}`).toBe(true);
    }
    // …and the LICENCE's mirror image on turn 1: idx 0 offered, idx 1 greyed.
    for (const first of ["p1", "p2"] as const) {
      const state = board(SEEDS[0], first, first, "sv06-009");
      expect(wirePlayable(state, first, 0), `${first} licensed`).toBe(true);
      expect(wirePlayable(state, first, 1), `${first} banned`).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. `MATCH_RECORD_VERSION` — DRIVEN, BOTH HALVES.
// ─────────────────────────────────────────────────────────────────────────────

describe("D281 — MATCH_RECORD_VERSION stays 14, and the reachability claim is MEASURED", () => {
  it("NO registry program's `attackGate` carries an op — the persisted-op reachability sweep", () => {
    let gatesFound = 0;
    let opsInGates = 0;
    let programsWalked = 0;
    for (const id of programmedCardIds()) {
      const program = programFor(id);
      if (program === undefined) continue;
      programsWalked += 1;
      for (const gate of Object.values(program.attackGate ?? {})) {
        gatesFound += 1;
        const seen = JSON.stringify(gate);
        // A structural read rather than a `kind` switch: the point is that no
        // shape reachable from this value is an op, whatever the arms become.
        expect(seen.includes('"op":'), id).toBe(false);
        opsInGates += walkProgram((gate as unknown as { ops?: [] }).ops ?? []).length;
      }
    }
    // THE ATTRIBUTION CONTROLS: the sweep really walked programs and really found
    // gates, so "no ops" is an answer rather than an empty population.
    expect(programsWalked).toBeGreaterThan(300);
    expect(gatesFound).toBe(18);
    expect(opsInGates).toBe(0);
  });

  it("a gated REFUSAL and a licensed ACCEPTANCE both leave the persisted shape untouched", () => {
    const first = "p1" as const;
    const licensedBoard = board(SEEDS[0], first, first, "sv06-009");
    const plainBoard = board(SEEDS[0], first, first, UNGATED);
    const licensed = applyAction(licensedBoard, { type: "attack", seat: first, index: 0 });
    expect(licensed.ok).toBe(true);
    if (!licensed.ok) return;
    // The DIFF: an attack the new licence let through writes the same top-level
    // shape as the board it came from.
    expect(Object.keys(licensed.state).sort()).toEqual(Object.keys(plainBoard).sort());
    // The ANCHOR: a literal list, so a key added to EVERY board is caught too.
    expect(Object.keys(licensed.state).sort()).toEqual(
      [
        "allowances",
        "cardIdByUid",
        "cardPool",
        "firstPlayer",
        "lastKoMarks",
        "lastKoTurn",
        "oncePerGameSpent",
        "handPlayLockedTurn",
        "pending",
        "phase",
        "players",
        "recentAttackers",
        "rngState",
        "stadium",
        "turn",
      ].sort(),
    );
    // …and a REFUSED declaration returns the state UNCHANGED by identity, so the
    // gate cannot have written anything at all.
    const refused = applyAction(licensedBoard, { type: "attack", seat: first, index: 1 });
    expect(refused.ok).toBe(false);
    // The in-play stack the gate is read off carries no new field either.
    expect(Object.keys(activeOf(licensedBoard, first)).includes("attackGate")).toBe(false);
  });
});
