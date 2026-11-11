import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { splitAttackGateClause } from "./effects";
import type { GameEvent, GameState, Seat } from "./index";
import { applyAction, attackGateOf, programFor, redactGame } from "./index";
import { attackTimingBlocked, attackTimingNote } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  setActiveFromDeck,
  must,
  activeOf,
  driveSetup,
} from "./testFixtures";

const ROLLOUT_GATE =
  "You can use this attack only if this Pokémon used Rollout during your last turn.";

const MILTANK = "sv08.5-081";
const UNGATED_TWIN = "fix-moomoo-ungated";

const NEAR_MISS_TWIN = "fix-moomoo-near-miss";

const NEAR_MISS_GATE =
  "You can use this attack only if this Pokémon used Nuzzle during your last turn.";

function miltank(id: string): Card {
  return battler(id, {
    name: "Miltank",
    hp: 130,
    retreat: 2,
    types: ["Colorless"],
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      { cost: ["Colorless"], name: "Rollout", damage: 20 },
      {
        cost: ["Colorless", "Colorless"],
        name: "Moomoo Rolling",
        damage: 100,
        effect: ROLLOUT_GATE,
      },
    ],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  [MILTANK]: miltank(MILTANK),
  [UNGATED_TWIN]: miltank(UNGATED_TWIN),
  [NEAR_MISS_TWIN]: battler(NEAR_MISS_TWIN, {
    name: "Miltank",
    hp: 130,
    retreat: 2,
    types: ["Colorless"],
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      { cost: ["Colorless"], name: "Rollout", damage: 20 },
      {
        cost: ["Colorless", "Colorless"],
        name: "Moomoo Rolling",
        damage: 100,
        effect: NEAR_MISS_GATE,
      },
    ],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const ROLLOUT_DECK = deckOf({
  [MILTANK]: 4,
  [UNGATED_TWIN]: 4,
  [NEAR_MISS_TWIN]: 4,
  "sv01-096": 2, // Klefki — the §9 Ability-lock control
  "fix-titan": 8,
  "fix-basic-1": 8,
  "fix-energy": 30, // Basic {C} — pays both printed costs
});

const SEEDS = [5011, 5021, 5023, 5039] as const;

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: ROLLOUT_DECK, p2: ROLLOUT_DECK }, { pool: POOL, first });
}

function board(seed: number, first: Seat, seat: Seat, activeId: string): GameState {
  const other = seat === "p1" ? "p2" : "p1";
  let state = localSetup(seed, first);
  state = setActiveFromDeck(state, seat, activeId);
  state = clearBench(state, seat);
  state = benchFromDeck(state, seat, "fix-basic-1");
  state = setActiveFromDeck(state, other, "fix-titan");
  state = clearBench(state, other);
  state = benchFromDeck(state, other, "fix-basic-1");
  return attachFromDeck(state, seat, "fix-energy", 2);
}

function passTurns(state: GameState, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

function untilTurnOf(state: GameState, seat: Seat, minTurn = 3): GameState {
  let next = state;
  for (let i = 0; i < 12; i += 1) {
    if (next.phase.kind === "turn:action" && next.phase.seat === seat && next.turn >= minTurn) {
      return next;
    }
    next = passTurns(next, 1);
  }
  throw new Error(`never reached ${seat}'s turn at or after ${minTurn}`);
}

/** Declare `index` and report the error CODE, or "OK". Every gate assertion goes
    through this, so a green "the gate refuses" line can never be a refusal for the
    wrong reason (an unpaid cost, a §4 ban, a bad index). */
function declare(state: GameState, seat: Seat, index: number): string {
  const result = applyAction(deepFreeze(state), { type: "attack", seat, index });
  return result.ok ? "OK" : result.error.code;
}

function declareEvents(state: GameState, seat: Seat, index: number): readonly GameEvent[] {
  const result = applyAction(state, { type: "attack", seat, index });
  if (!result.ok) throw new Error(`attack rejected: ${result.error.code} ${result.error.message}`);
  return result.events;
}

function wirePlayable(state: GameState, seat: Seat, index: number): boolean | undefined {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.attacks.find((a) => a.index === index)?.playable;
}

/** Use "Rollout" (idx 0) on `seat`'s turn, then wind the board back round to
    `seat` — the board the gate is printed for. */
function afterRollout(seed: number, first: Seat, seat: Seat, activeId: string): GameState {
  const start = untilTurnOf(board(seed, first, seat, activeId), seat);
  const after = must(applyAction(start, { type: "attack", seat, index: 0 }));
  return untilTurnOf(after, seat, start.turn + 1);
}

describe("D395 §1 — the census, and the per-INDEX claim checked against the printing", () => {
  it("the corpus holds the sentence ONCE, and no reader resolves it whole", () => {
    const rows = legalAttackCorpus().filter(([, text]) => text === ROLLOUT_GATE);
    expect(rows.length).toBe(1);
    expect(rows.reduce((sum, [units]) => sum + units, 0)).toBe(1);
    expect(resolvedByAnyReader(ROLLOUT_GATE)).toBe(false);
    const skeleton = legalAttackCorpus().filter(([, text]) =>
      text.startsWith("You can use this attack only if"),
    );
    expect(skeleton.length).toBe(3);
    expect(skeleton.reduce((sum, [units]) => sum + units, 0)).toBe(4);
  });

  it("the registry row is at index 1 and carries D394's member UNCHANGED", () => {
    const gate = programFor(MILTANK)?.attackGate;
    expect(gate).toBeDefined();
    expect(Object.keys(gate ?? {})).toEqual(["1"]);
    expect(gate?.[1]).toEqual({
      kind: "onlyIf",
      condition: { kind: "yourActiveUsedAttackLastTurn", attack: "Rollout" },
    });
    expect(Object.keys(programFor(MILTANK) ?? {})).toEqual(["attackGate"]);
  });

  it("the gated attack really IS index 1, and the attack its clause NAMES is index 0", () => {
    const attacks = POOL[MILTANK]?.attacks ?? [];
    expect(attacks).toHaveLength(2);
    expect(attacks[0]?.name).toBe("Rollout");
    expect(attacks[0]?.effect).toBeUndefined();
    expect(attacks[1]?.name).toBe("Moomoo Rolling");
    expect(attacks[1]?.effect).toBe(ROLLOUT_GATE);
    expect(ROLLOUT_GATE).toContain(` ${attacks[0]?.name} `);
  });

  it("`attackGateOf` answers index 1 and NOT index 0 — total, and index-keyed", () => {
    const state = board(SEEDS[0], "p1", "p1", MILTANK);
    const body = activeOf(state, "p1");
    expect(attackGateOf(state, body, 1)).toBeDefined();
    expect(attackGateOf(state, body, 0)).toBeUndefined();
    expect(attackGateOf(state, body, 99)).toBeUndefined();
    expect(attackGateOf(state, body, -1)).toBeUndefined();
  });

  it("D444 — the UNREGISTERED twin derives the SAME gate, and the NEAR-MISS derives none", () => {
    const registered = board(SEEDS[0], "p1", "p1", MILTANK);
    const twin = board(SEEDS[0], "p1", "p1", UNGATED_TWIN);
    const nearMiss = board(SEEDS[0], "p1", "p1", NEAR_MISS_TWIN);

    expect(programFor(MILTANK)?.attackGate?.[1]).toBeDefined();
    expect(programFor(UNGATED_TWIN)).toBeUndefined();
    expect(programFor(NEAR_MISS_TWIN)).toBeUndefined();

    // ② THE AGREEMENT, by VALUE and not by "defined": a derivation that answered
    // some other gate would satisfy `toBeDefined()` and bar the wrong turn.
    const authored = attackGateOf(registered, activeOf(registered, "p1"), 1);
    expect(authored).toEqual({
      kind: "onlyIf",
      condition: { kind: "yourActiveUsedAttackLastTurn", attack: "Rollout" },
    });
    expect(attackGateOf(twin, activeOf(twin, "p1"), 1)).toEqual(authored);

    expect(splitAttackGateClause(NEAR_MISS_GATE)).toBeNull();
    expect(attackGateOf(nearMiss, activeOf(nearMiss, "p1"), 1)).toBeUndefined();

    expect(attackGateOf(twin, activeOf(twin, "p1"), 0)).toBeUndefined();
    expect(attackGateOf(twin, activeOf(twin, "p1"), 99)).toBeUndefined();
    expect(attackGateOf(twin, activeOf(twin, "p1"), -1)).toBeUndefined();
  });
});

describe("D395 §2 — the board an INDEX-BLIND read locks out of the game", () => {
  it("idx 0 'Rollout' is LIVE on the very board where idx 1 is barred", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        for (const seed of SEEDS) {
          const state = untilTurnOf(board(seed, first, seat, MILTANK), seat);
          expect(declare(state, seat, 1), `${seed} ${first} ${seat}`).toBe("ATTACK_PREVENTED");
          expect(declare(state, seat, 0), `${seed} ${first} ${seat}`).toBe("OK");
        }
      }
    }
  });

  it("and the WIRE greys exactly one of the two rows — the per-index projection", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        const state = untilTurnOf(board(SEEDS[0], first, seat, MILTANK), seat);
        expect(wirePlayable(state, seat, 0), `${first} ${seat}`).toBe(true);
        expect(wirePlayable(state, seat, 1), `${first} ${seat}`).toBe(false);
      }
    }
  });

  it("the refusal NAMES the printed clause in the printed polarity", () => {
    const state = untilTurnOf(board(SEEDS[0], "p1", "p1", MILTANK), "p1");
    const result = applyAction(state, { type: "attack", seat: "p1", index: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the gate to refuse");
    expect(result.error.message).toContain("Moomoo Rolling");
    expect(result.error.message).toContain(
      "it can only be used if your Active Pokémon used Rollout during your last turn",
    );
    const gate = attackTimingBlocked(state, "p1", activeOf(state, "p1"), 1);
    expect(gate).toBeDefined();
    expect(gate === undefined ? "" : attackTimingNote(gate)).toBe(
      "it can only be used if your Active Pokémon used Rollout during your last turn",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The gate OPENS, and the window's BACK EDGE closes it again.
// ─────────────────────────────────────────────────────────────────────────────

describe("D395 §3 — the window, driven at both edges", () => {
  it("opens on the turn AFTER Rollout, from both seats and under both assignments", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        for (const seed of SEEDS) {
          const state = afterRollout(seed, first, seat, MILTANK);
          expect(declare(state, seat, 1), `${seed} ${first} ${seat}`).toBe("OK");
          expect(wirePlayable(state, seat, 1), `${seed} ${first} ${seat}`).toBe(true);
        }
      }
    }
  });

  it("CLOSES again one of the player's own turns later — the back edge", () => {
    // The board a "has ever used Rollout" build gets wrong, and every assertion
    // above is green on that build. The printed word is "LAST turn": one own turn
    // further on, the record is two of the player's turns old and the gate bites.
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        const opened = afterRollout(SEEDS[0], first, seat, MILTANK);
        const later = untilTurnOf(opened, seat, opened.turn + 1);
        expect(declare(later, seat, 1), `${first} ${seat}`).toBe("ATTACK_PREVENTED");
        // …and the way back is the printed one: use Rollout again.
        const reopened = untilTurnOf(
          must(applyAction(later, { type: "attack", seat, index: 0 })),
          seat,
          later.turn + 1,
        );
        expect(declare(reopened, seat, 1), `${first} ${seat}`).toBe("OK");
      }
    }
  });

  it("the opened attack really deals its printed 100 — a gate is not a program", () => {
    const state = afterRollout(SEEDS[0], "p1", "p1", MILTANK);
    const before = activeOf(state, "p2").damage;
    const next = must(applyAction(state, { type: "attack", seat: "p1", index: 1 }));
    // `fix-titan` is 340 HP and takes 20 from the Rollout that opened the window,
    // so the total after this hit is 120 and nothing has been Knocked Out.
    expect(before).toBe(20);
    expect(activeOf(next, "p2").damage).toBe(120);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. §9 does not reach this field, and both projections agree per index.
// ─────────────────────────────────────────────────────────────────────────────

describe("D395 §4 — the §9 rule, and the payability mirrors", () => {
  it("a live Klefki Ability-lock changes NOTHING on either side of the gate", () => {
    for (const seat of ["p1", "p2"] as const) {
      const other = seat === "p1" ? "p2" : "p1";
      const barred = untilTurnOf(board(SEEDS[0], "p1", seat, MILTANK), seat);
      const opened = afterRollout(SEEDS[0], "p1", seat, MILTANK);
      for (const [label, state] of [
        ["barred", barred],
        ["opened", opened],
      ] as const) {
        const locked = benchFromDeck(state, other, "sv01-096");
        // The lock is really live on this board — without this line the two
        // answers agree because nothing is suppressed anywhere.
        expect(locked.players[other].bench.length, label).toBeGreaterThan(
          state.players[other].bench.length,
        );
        expect(declare(locked, seat, 1), `${seat} ${label}`).toBe(declare(state, seat, 1));
        expect(declare(locked, seat, 0), `${seat} ${label}`).toBe(declare(state, seat, 0));
      }
    }
  });

  it("the ENGINE gate and the WIRE projection agree on every row, seat and seed", () => {
    let compared = 0;
    let legalRows = 0;
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        for (const seed of SEEDS) {
          for (const state of [
            untilTurnOf(board(seed, first, seat, MILTANK), seat),
            afterRollout(seed, first, seat, MILTANK),
          ]) {
            for (const index of [0, 1]) {
              const accepted = declare(state, seat, index) === "OK";
              expect(wirePlayable(state, seat, index), `${seed} ${first} ${seat} ${index}`).toBe(
                accepted,
              );
              compared += 1;
              if (accepted) legalRows += 1;
            }
          }
        }
      }
    }
    expect(compared).toBe(64);
    expect(legalRows).toBeGreaterThan(0);
    expect(legalRows).toBeLessThan(compared);
  });
});

describe("D395 §5 — the clause-only split and the report it silences", () => {
  it('`splitAttackGateClause` answers `{clause, body: ""}` — a MATCH, not a miss', () => {
    expect(splitAttackGateClause(ROLLOUT_GATE)).toEqual({ clause: ROLLOUT_GATE, body: "" });
    expect(splitAttackGateClause(`Draw a card. ${ROLLOUT_GATE}`)).toEqual({
      clause: ROLLOUT_GATE,
      body: "Draw a card.",
    });
    // MID-SENTENCE, both ways: neither a leading nor a trailing match, because neither
    // boundary is there.
    expect(splitAttackGateClause(`Draw a card. ${ROLLOUT_GATE} Then, draw a card.`)).toBeNull();
    expect(splitAttackGateClause(`Draw a card.${ROLLOUT_GATE}`)).toBeNull();
    expect(splitAttackGateClause(`${ROLLOUT_GATE}x`)).toBeNull();
    expect(splitAttackGateClause(`Draw ${ROLLOUT_GATE}`)).toEqual({
      clause: ROLLOUT_GATE,
      body: "Draw",
    });
    expect(splitAttackGateClause(`${ROLLOUT_GATE} x`)).toEqual({ clause: ROLLOUT_GATE, body: "x" });
    expect(splitAttackGateClause("")).toBeNull();
  });

  it("the gated declaration reports NO unsimulated effect — and the TWIN does", () => {
    const gated = afterRollout(SEEDS[0], "p1", "p1", MILTANK);
    const skipped = declareEvents(gated, "p1", 1).filter((e) => e.type === "ATTACK_EFFECT_SKIPPED");
    expect(skipped).toEqual([]);

    const nearMiss = untilTurnOf(board(SEEDS[0], "p1", "p1", NEAR_MISS_TWIN), "p1");
    const nearMissSkipped = declareEvents(nearMiss, "p1", 1).filter(
      (e) => e.type === "ATTACK_EFFECT_SKIPPED",
    );
    expect(nearMissSkipped).toHaveLength(1);
    expect(nearMissSkipped[0]).toMatchObject({ effect: NEAR_MISS_GATE, damageModifier: null });

    // …and the twin, on the same board, emits NONE — the payoff stated beside the
    // control rather than in place of it.
    const twin = untilTurnOf(afterRollout(SEEDS[0], "p1", "p1", UNGATED_TWIN), "p1");
    expect(declareEvents(twin, "p1", 1).filter((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toEqual(
      [],
    );
  });

  it("D444 — the UNREGISTERED twin is BARRED, and the near-miss is not", () => {
    for (const seat of ["p1", "p2"] as const) {
      const barred = untilTurnOf(board(SEEDS[0], "p1", seat, UNGATED_TWIN), seat);
      expect(declare(barred, seat, 1), seat).toBe("ATTACK_PREVENTED");
      expect(wirePlayable(barred, seat, 1), seat).toBe(false);
      const opened = afterRollout(SEEDS[0], "p1", seat, UNGATED_TWIN);
      expect(declare(opened, seat, 1), seat).toBe("OK");
      expect(wirePlayable(opened, seat, 1), seat).toBe(true);

      // THE CONTROL: one token off the table and the declaration seam sees nothing
      // at all — no gate, no bar, on the same board that bars the twin.
      const nearMiss = untilTurnOf(board(SEEDS[0], "p1", seat, NEAR_MISS_TWIN), seat);
      expect(declare(nearMiss, seat, 1), seat).toBe("OK");
      expect(wirePlayable(nearMiss, seat, 1), seat).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. `MATCH_RECORD_VERSION` — the question asked, and the answer driven.
// ─────────────────────────────────────────────────────────────────────────────

describe("D395 §6 — MATCH_RECORD_VERSION stays 25, and the reason is measured", () => {
  it("the slice persists NOTHING — the row is a catalog fact re-read every time", () => {
    const gate = programFor(MILTANK)?.attackGate?.[1];
    expect(JSON.stringify(gate ?? {}).includes('"op":')).toBe(false);
    expect(gate).toEqual({
      kind: "onlyIf",
      condition: { kind: "yourActiveUsedAttackLastTurn", attack: "Rollout" },
    });
    // ③ and the split is a pure function of printed text, so a resumed record
    //    re-derives the same answer from the same catalog bytes.
    expect(splitAttackGateClause(ROLLOUT_GATE)).toEqual(splitAttackGateClause(ROLLOUT_GATE));
  });

  it("no `fix-*` demonstrator reached the shared pool — the census control", () => {
    expect(FIXTURE_POOL[MILTANK]).toBeUndefined();
    expect(FIXTURE_POOL[UNGATED_TWIN]).toBeUndefined();
    expect(programFor(UNGATED_TWIN)).toBeUndefined();
  });
});
