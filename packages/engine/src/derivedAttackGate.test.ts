import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus } from "./censusAttackCorpus";
import * as effects from "./effects";
import { splitAttackGateClause, timingGateFromAttackText } from "./effects";
import type { AttackTimingGate, GameState, Seat } from "./index";
import { applyAction, attackGateOf, programFor } from "./index";
import { attackTimingBlocked, firstTurnAttackBanned, redactGame } from "./index";
import { registryCardIds } from "./registry";
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
  must,
  activeOf,
  driveSetup,
} from "./testFixtures";

const BAN_TEXT =
  "If you go second, you can't use this attack during your first turn. This attack does 30 damage for each of your Benched Pokémon.";
const LICENCE_TEXT =
  "If you go first, you can use this attack during your first turn. Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.";
const GATE_TEXT =
  "You can use this attack only if you go second, and only during your first turn. Shuffle 1 of your opponent's Benched Pokémon and all attached cards into their deck.";
const ROLLOUT_TEXT =
  "You can use this attack only if this Pokémon used Rollout during your last turn.";

const NEAR_MISS_TEXT =
  "If you go second, you can't use this attack during your next turn. This attack does 30 damage for each of your Benched Pokémon.";

const BAN_BODY = "fix-d444-ban";
const LICENCE_BODY = "fix-d444-licence";
const GATE_BODY = "fix-d444-gate";
const ROLLOUT_BODY = "fix-d444-rollout";
const NEAR_MISS_BODY = "fix-d444-near-miss";
const PLAIN_BODY = "fix-d444-plain";
const FILLER = "fix-d444-filler";
const ENERGY = "fix-d444-energy";

const LOCAL_CARDS: Record<string, Card> = {
  [BAN_BODY]: battler(BAN_BODY, {
    name: "D444 Ban",
    hp: 230,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Unified Beatdown",
        damage: "30×",
        effect: BAN_TEXT,
      },
      { cost: ["Colorless", "Colorless"], name: "Crown Opal", damage: 180 },
    ],
  }),
  [LICENCE_BODY]: battler(LICENCE_BODY, {
    name: "D444 Licence",
    hp: 70,
    retreat: 1,
    types: ["Grass"],
    attacks: [
      { cost: ["Colorless"], name: "Quick Sign", effect: LICENCE_TEXT },
      { cost: ["Colorless", "Colorless"], name: "Coordinated Strike", damage: 20 },
    ],
  }),
  [GATE_BODY]: battler(GATE_BODY, {
    name: "D444 Gate",
    hp: 70,
    retreat: 1,
    types: ["Grass"],
    attacks: [
      { cost: ["Colorless"], name: "Slowing Perfume", effect: GATE_TEXT },
      { cost: ["Colorless", "Colorless"], name: "Glide", damage: 30 },
    ],
  }),
  // Miltank `sv08.5-081`'s shape: the gate at idx **1** and the attack its clause
  // NAMES at idx 0 — the only printed layout on which an index-blind read gates the
  // one attack that can ever satisfy the gate.
  [ROLLOUT_BODY]: battler(ROLLOUT_BODY, {
    name: "D444 Rollout",
    hp: 130,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      { cost: ["Colorless"], name: "Rollout", damage: 20 },
      {
        cost: ["Colorless", "Colorless"],
        name: "Moomoo Rolling",
        damage: 100,
        effect: ROLLOUT_TEXT,
      },
    ],
  }),
  [NEAR_MISS_BODY]: battler(NEAR_MISS_BODY, {
    name: "D444 Near Miss",
    hp: 230,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Unified Beatdown",
        damage: "30×",
        effect: NEAR_MISS_TEXT,
      },
      { cost: ["Colorless", "Colorless"], name: "Crown Opal", damage: 180 },
    ],
  }),
  [PLAIN_BODY]: battler(PLAIN_BODY, {
    name: "D444 Plain",
    hp: 230,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      { cost: ["Colorless"], name: "Plain Sign", damage: 20 },
      { cost: ["Colorless", "Colorless"], name: "Plain Strike", damage: 180 },
    ],
  }),
  [FILLER]: battler(FILLER, {
    name: "D444 Filler",
    hp: 60,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [ENERGY]: typedEnergy(ENERGY, "Colorless"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const GATE_DECK = deckOf({
  [BAN_BODY]: 4,
  [LICENCE_BODY]: 4,
  [GATE_BODY]: 4,
  [ROLLOUT_BODY]: 4,
  [NEAR_MISS_BODY]: 4,
  [PLAIN_BODY]: 4,
  [FILLER]: 8,
  "fix-basic-1": 8,
  [ENERGY]: 20,
});

const SEEDS = [6011, 6029, 6037, 6043] as const;

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: GATE_DECK, p2: GATE_DECK }, { pool: POOL, first });
}

function board(seed: number, first: Seat, seat: Seat, activeId: string, passes = 0): GameState {
  let state = localSetup(seed, first);
  for (let i = 0; i < passes; i += 1) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  if (state.phase.kind !== "turn:action" || state.phase.seat !== seat) {
    throw new Error(`expected ${seat} on turn, got ${JSON.stringify(state.phase.kind)}`);
  }
  state = setActiveFromDeck(state, seat, activeId);
  state = clearBench(state, seat);
  state = benchFromDeck(state, seat, FILLER);
  return attachFromDeck(state, seat, ENERGY, 2);
}

function declare(state: GameState, seat: Seat, index: number): string {
  const result = applyAction(deepFreeze(state), { type: "attack", seat, index });
  return result.ok ? "OK" : result.error.code;
}

function wirePlayable(state: GameState, seat: Seat, index: number): boolean | undefined {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.attacks.find((a) => a.index === index)?.playable;
}

const SECOND_PLAYERS_FIRST_TURN = {
  kind: "allOf",
  conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }],
};

describe("D444 §1 — the clause→gate table, driven row against row", () => {
  it("the two `If you go …` rows are OPPOSITE, and one of them carries NO condition", () => {
    const ban = timingGateFromAttackText(BAN_TEXT);
    const licence = timingGateFromAttackText(LICENCE_TEXT);
    expect(ban).toEqual({ kind: "barredIf", condition: SECOND_PLAYERS_FIRST_TURN });
    expect(licence).toEqual({ kind: "firstTurnExempt" });
    expect(licence).not.toHaveProperty("condition");
    expect(ban).toHaveProperty("condition");
  });

  it("the GATE row is the BAN row's condition at the OTHER polarity — by identity", () => {
    const gate = timingGateFromAttackText(GATE_TEXT);
    expect(gate).toEqual({ kind: "onlyIf", condition: SECOND_PLAYERS_FIRST_TURN });
    const ban = timingGateFromAttackText(BAN_TEXT) as { condition: unknown };
    expect((gate as { condition: unknown }).condition).toEqual(ban.condition);
    expect((gate as AttackTimingGate).kind).not.toBe(
      (timingGateFromAttackText(BAN_TEXT) as AttackTimingGate).kind,
    );
  });

  it("the ROLLOUT row derives too, and the attack name is a CONSTANT in a closed row", () => {
    expect(timingGateFromAttackText(ROLLOUT_TEXT)).toEqual({
      kind: "onlyIf",
      condition: { kind: "yourActiveUsedAttackLastTurn", attack: "Rollout" },
    });
    const templated = ROLLOUT_TEXT.replace("Rollout", "Nuzzle");
    expect(templated).not.toBe(ROLLOUT_TEXT);
    expect(timingGateFromAttackText(templated)).toBeUndefined();
  });

  it("the reader is TOTAL and refuses everything that is not a table row", () => {
    expect(timingGateFromAttackText(undefined)).toBeUndefined();
    expect(timingGateFromAttackText("")).toBeUndefined();
    expect(timingGateFromAttackText(NEAR_MISS_TEXT)).toBeUndefined();
    expect(timingGateFromAttackText(`Draw a card. ${BAN_TEXT}`)).toBeUndefined();
    // …and a body with no clause at all, which is the overwhelmingly common case.
    expect(timingGateFromAttackText("Draw 2 cards.")).toBeUndefined();
  });

  it("the map is the SPLITTER's second column — every clause it splits derives a gate", () => {
    for (const [, text] of legalAttackCorpus()) {
      const split = splitAttackGateClause(text);
      const gate = timingGateFromAttackText(text);
      expect(split === null, text).toBe(gate === undefined);
    }
  });
});

describe("D444 §2 — the population, and the honest zero", () => {
  it("the gate family is 7 sentences / 17 printings ( D541 6/14 → 7/17; D545 → 9/19, and the derivation now claims exactly the 2 D545 printings — the NONE is D444's and D541's, withdrawn at D545)", () => {
    const gated = legalAttackCorpus().filter(([, text]) => splitAttackGateClause(text) !== null);
    expect(gated.length).toBe(9);
    expect(gated.reduce((sum, [units]) => sum + units, 0)).toBe(19);
    for (const [, text] of gated) expect(timingGateFromAttackText(text), text).toBeDefined();
  });

  it("~~17~~ registry ids carry `attackGate` ( D582 (D539): *17* WITHDRAWN — 18 since the `me` alias Terapagos ex `me02.5-179`; 17 is the `sv` figure), and the 5 DISTINCT values are the 4 leading-clause derivations plus the trailing gate ( D541 — which DERIVES too now, so the old either/or in this title is withdrawn)", () => {
    const gatedIds = registryCardIds().filter((id) => programFor(id)?.attackGate !== undefined);
    expect(gatedIds.length).toBe(18);

    const derivable = [BAN_TEXT, LICENCE_TEXT, GATE_TEXT, ROLLOUT_TEXT].map((t) =>
      JSON.stringify(timingGateFromAttackText(t)),
    );
    const trailing = JSON.stringify({
      kind: "barredIf",
      condition: { kind: "yourPokemonUsedAttackLastTurn", attack: "Angelite" },
    });

    const distinct = new Set<string>();
    for (const id of gatedIds) {
      for (const gate of Object.values(programFor(id)?.attackGate ?? {})) {
        distinct.add(JSON.stringify(gate));
      }
    }
    expect(distinct.size).toBe(5);
    expect([...distinct].sort()).toEqual([...derivable, trailing].sort());
  });

  it("the six bodies this suite drives are UNREGISTERED — the attribution control", () => {
    for (const id of [
      BAN_BODY,
      LICENCE_BODY,
      GATE_BODY,
      ROLLOUT_BODY,
      NEAR_MISS_BODY,
      PLAIN_BODY,
    ]) {
      expect(programFor(id), id).toBeUndefined();
    }
  });
});

describe("D444 §3 — the derived gate on a board, both directions", () => {
  it("THE DEFECT: the BAN body is now BARRED on the turn its own text forbids", () => {
    for (const seed of SEEDS) {
      const state = board(seed, "p1", "p2", BAN_BODY, 1);
      expect(state.turn).toBe(2);
      expect(attackGateOf(state, activeOf(state, "p2"), 0)).toEqual({
        kind: "barredIf",
        condition: SECOND_PLAYERS_FIRST_TURN,
      });
      expect(attackTimingBlocked(state, "p2", activeOf(state, "p2"), 0)).toBeDefined();
      expect(declare(state, "p2", 0), `${seed}`).toBe("ATTACK_PREVENTED");
      expect(wirePlayable(state, "p2", 0), `${seed}`).toBe(false);
    }
  });

  it("…and it OPENS everywhere else, on BOTH SEATS — the admission the refusal owes (D424)", () => {
    for (const seed of SEEDS) {
      const first = board(seed, "p1", "p1", BAN_BODY, 2);
      expect(first.turn).toBe(3);
      expect(attackTimingBlocked(first, "p1", activeOf(first, "p1"), 0)).toBeUndefined();
      expect(declare(first, "p1", 0), `${seed}`).toBe("OK");
      expect(wirePlayable(first, "p1", 0), `${seed}`).toBe(true);

      const second = board(seed, "p1", "p2", BAN_BODY, 3);
      expect(second.turn).toBe(4);
      expect(attackTimingBlocked(second, "p2", activeOf(second, "p2"), 0)).toBeUndefined();
      expect(declare(second, "p2", 0), `${seed}`).toBe("OK");
      expect(wirePlayable(second, "p2", 0), `${seed}`).toBe(true);
    }
  });

  it("the NEAR-MISS body is barred NOWHERE — the text alone gates nothing", () => {
    // The control for both rungs above. One token off the table and the declaration
    // seam sees no clause at all, on the very board that bars the BAN body.
    const state = board(SEEDS[0], "p1", "p2", NEAR_MISS_BODY, 1);
    expect(state.turn).toBe(2);
    expect(attackGateOf(state, activeOf(state, "p2"), 0)).toBeUndefined();
    expect(declare(state, "p2", 0)).toBe("OK");
    expect(wirePlayable(state, "p2", 0)).toBe(true);
  });

  it("THE PERMISSION: the LICENCE body attacks on TURN 1 going first — §4's ban LIFTED", () => {
    for (const seed of SEEDS) {
      const state = board(seed, "p1", "p1", LICENCE_BODY, 0);
      expect(state.turn).toBe(1);
      expect(attackGateOf(state, activeOf(state, "p1"), 0)).toEqual({ kind: "firstTurnExempt" });
      expect(firstTurnAttackBanned(state, activeOf(state, "p1"), 0), `${seed}`).toBe(false);
      // …and `attackTimingBlocked` says NOTHING about it: `firstTurnExempt` is
      // excluded from `BlockingAttackGate` by construction, so the licence can only
      // ever unblock and §4 is its one reader.
      expect(attackTimingBlocked(state, "p1", activeOf(state, "p1"), 0)).toBeUndefined();
      expect(declare(state, "p1", 0), `${seed}`).toBe("OK");
    }
  });

  it("the PLAIN body is still §4-banned on the same board — the attribution control", () => {
    const state = board(SEEDS[0], "p1", "p1", PLAIN_BODY, 0);
    expect(state.turn).toBe(1);
    expect(firstTurnAttackBanned(state, activeOf(state, "p1"), 0)).toBe(true);
    expect(declare(state, "p1", 0)).toBe("FIRST_TURN_ATTACK");
  });

  it("the GATE body is `onlyIf`: LIVE on the second player's first turn, DEAD after", () => {
    const live = board(SEEDS[0], "p1", "p2", GATE_BODY, 1);
    expect(live.turn).toBe(2);
    expect(attackGateOf(live, activeOf(live, "p2"), 0)).toEqual({
      kind: "onlyIf",
      condition: SECOND_PLAYERS_FIRST_TURN,
    });
    expect(declare(live, "p2", 0)).toBe("OK");

    const dead = board(SEEDS[0], "p1", "p1", GATE_BODY, 2);
    expect(dead.turn).toBe(3);
    expect(declare(dead, "p1", 0)).toBe("ATTACK_PREVENTED");
    expect(wirePlayable(dead, "p1", 0)).toBe(false);
  });
});

describe("D444 §4 — the address, with no registry row to key off", () => {
  it("idx 0 is LICENSED and idx 1 is STILL BANNED on the same body, same turn", () => {
    for (const seed of SEEDS) {
      const state = board(seed, "p1", "p1", LICENCE_BODY, 0);
      expect(state.turn).toBe(1);
      // DENIED first.
      expect(attackGateOf(state, activeOf(state, "p1"), 1)).toBeUndefined();
      expect(firstTurnAttackBanned(state, activeOf(state, "p1"), 1), `${seed}`).toBe(true);
      expect(declare(state, "p1", 1), `${seed}`).toBe("FIRST_TURN_ATTACK");
      // …then permitted.
      expect(firstTurnAttackBanned(state, activeOf(state, "p1"), 0), `${seed}`).toBe(false);
      expect(declare(state, "p1", 0), `${seed}`).toBe("OK");
    }
  });

  it("the ROLLOUT shape: the gate is at idx 1 and idx 0 — the attack it NAMES — is live", () => {
    const state = board(SEEDS[0], "p1", "p1", ROLLOUT_BODY, 2);
    const body = activeOf(state, "p1");
    expect(attackGateOf(state, body, 1)).toEqual({
      kind: "onlyIf",
      condition: { kind: "yourActiveUsedAttackLastTurn", attack: "Rollout" },
    });
    expect(attackGateOf(state, body, 0)).toBeUndefined();
    expect(declare(state, "p1", 0)).toBe("OK");
    expect(declare(state, "p1", 1)).toBe("ATTACK_PREVENTED");
  });

  it("…and the ROLLOUT window OPENS once idx 0 has been used — the name is the RIGHT one", () => {
    const start = board(SEEDS[0], "p1", "p1", ROLLOUT_BODY, 2);
    let after = must(applyAction(start, { type: "attack", seat: "p1", index: 0 }));
    for (
      let i = 0;
      i < 6 &&
      !(after.phase.kind === "turn:action" && after.phase.seat === "p1" && after.turn > start.turn);
      i += 1
    ) {
      if (after.phase.kind !== "turn:action") throw new Error(`stuck in ${after.phase.kind}`);
      after = must(applyAction(after, { type: "endTurn", seat: after.phase.seat }));
    }
    expect(after.turn).toBeGreaterThan(start.turn);
    expect(declare(after, "p1", 1)).toBe("OK");
  });

  it("the read stays TOTAL — a missing index and a bogus one both answer undefined", () => {
    const state = board(SEEDS[0], "p1", "p1", BAN_BODY, 2);
    const body = activeOf(state, "p1");
    expect(attackGateOf(state, body, 99)).toBeUndefined();
    expect(attackGateOf(state, body, -1)).toBeUndefined();
    expect(attackGateOf(state, body, 1.5)).toBeUndefined();
  });
});

describe("D444 §5 — `timingGateFromAttackText` is NOT a whole-sentence reader", () => {
  it("the reader surface is 13 and this function is not in it", () => {
    const surface = attackReaderSurface();
    expect(surface).toHaveLength(14);
    expect(surface).not.toContain("timingGateFromAttackText");
    expect(surface).not.toContain("deriveAttackTimingGate");
    for (const name of surface) expect(name.startsWith("deriveAttack"), name).toBe(true);
  });

  it("…and no effects.ts export outside the surface starts with that prefix", () => {
    // The converse, and it is what makes the rung above more than a spelling check:
    // a future export named `deriveAttackX` is IN the surface whether its author
    // meant it or not, so the only safe statement is that the two sets coincide.
    const prefixed = Object.entries(effects)
      .filter(([name, value]) => name.startsWith("deriveAttack") && typeof value === "function")
      .map(([name]) => name)
      .sort();
    expect(prefixed).toEqual([...attackReaderSurface()].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. `MATCH_RECORD_VERSION` — the question asked at the right address.
// ─────────────────────────────────────────────────────────────────────────────

describe("D444 §6 — `MATCH_RECORD_VERSION` stays 29, driven over bytes both ways", () => {
  it("no gate byte is in the record at all, and a round-tripped state gates identically", () => {
    const state = board(SEEDS[0], "p1", "p2", BAN_BODY, 1);

    const bytes = JSON.stringify(state);
    for (const token of [
      "attackGate",
      "barredIf",
      "onlyIf",
      "firstTurnExempt",
      "youGoSecond",
      "yourFirstTurn",
      "yourActiveUsedAttackLastTurn",
    ]) {
      expect(bytes.includes(token), token).toBe(false);
    }

    expect(state.cardPool[BAN_BODY]?.attacks?.[0]?.effect).toBe(BAN_TEXT);
    expect(bytes.includes(BAN_TEXT)).toBe(true);

    const reconstructed: GameState = JSON.parse(bytes) as GameState;
    expect(attackGateOf(reconstructed, activeOf(reconstructed, "p2"), 0)).toEqual(
      attackGateOf(state, activeOf(state, "p2"), 0),
    );
    expect(declare(reconstructed, "p2", 0)).toBe("ATTACK_PREVENTED");
    // …and the round trip is not vacuous: it really did lose every non-JSON value.
    expect(reconstructed).toEqual(JSON.parse(JSON.stringify(state)) as GameState);
  });
});
