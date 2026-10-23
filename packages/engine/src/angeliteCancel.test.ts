import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackCopy,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
  splitAttackGateClause,
} from "./effects";
import type { GameEvent, GameState, Seat } from "./index";
import {
  applyAction,
  attackGateOf,
  attackTimingBlocked,
  attackTimingNote,
  conditionNote,
  createGame,
  programFor,
  redactGame,
} from "./index";
import {
  completeSetup,
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
} from "./testFixtures";

const ANGELITE =
  "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck. If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.";

const ANGELITE_BODY =
  "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck.";

const ANGELITE_CLAUSE =
  "If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.";

const MAGICAL_CHARM =
  "During your opponent's next turn, attacks used by the Defending Pokémon do 100 less damage (before applying Weakness and Resistance).";

const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackBonusConsequent,
];

const SYLVEON = "sv08-086";
const SYLVEON_PRE = "sv08.5-041";
const SYLVEON_SIR = "sv08.5-156";

const UNGATED_TWIN = "fix-angelite-ungated";

function sylveon(id: string): Card {
  return battler(id, {
    name: "Sylveon ex",
    hp: 270,
    stage: "Stage1",
    evolveFrom: "Eevee",
    retreat: 2,
    types: ["Psychic"],
    weaknesses: [{ type: "Metal", value: "×2" }],
    attacks: [
      {
        cost: ["Psychic", "Colorless", "Colorless"],
        name: "Magical Charm",
        damage: 160,
        effect: MAGICAL_CHARM,
      },
      {
        cost: ["Water", "Lightning", "Psychic"],
        name: "Angelite",
        effect: ANGELITE,
      },
    ],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  [SYLVEON]: sylveon(SYLVEON),
  [UNGATED_TWIN]: sylveon(UNGATED_TWIN),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const ANGELITE_DECK = deckOf({
  [SYLVEON]: 8,
  [UNGATED_TWIN]: 6,
  "sv01-096": 2, // Klefki — the §9 Ability-lock control
  "fix-titan": 6,
  "fix-basic-1": 6,
  "fix-water-energy": 11,
  "fix-lightning-energy": 11,
  "fix-psychic-energy": 10,
});

const SEEDS = [6011, 6029, 6037, 6047] as const;

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: ANGELITE_DECK, p2: ANGELITE_DECK },
    cardPool: POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  state = completeSetup(state);
  return state;
}

/** Give the seat's Active one {W}, one {L} and one {P} — enough for BOTH printed
    costs, so a refusal below can only ever be a GATE. */
function payBoth(state: GameState, seat: Seat): GameState {
  let next = attachFromDeck(state, seat, "fix-water-energy", 1);
  next = attachFromDeck(next, seat, "fix-lightning-energy", 1);
  return attachFromDeck(next, seat, "fix-psychic-energy", 1);
}

/** `seat`'s Active is `activeId` with the three Energies attached, a body behind it
    on the Bench (§14.2 makes an empty Bench a LOSS the moment the Active leaves)
    and `fix-titan` opposite. */
function board(seed: number, first: Seat, seat: Seat, activeId: string): GameState {
  const other = seat === "p1" ? "p2" : "p1";
  let state = localSetup(seed, first);
  state = setActiveFromDeck(state, seat, activeId);
  state = clearBench(state, seat);
  state = benchFromDeck(state, seat, "fix-basic-1");
  state = setActiveFromDeck(state, other, "fix-titan");
  state = clearBench(state, other);
  state = benchFromDeck(state, other, "fix-basic-1");
  return payBoth(state, seat);
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
    through this, so a green "the cancel refuses" line can never be a refusal for
    the wrong reason (an unpaid cost, a §4 ban, a bad index). */
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

function settleAngelitePark(state: GameState, seat: Seat): GameState {
  if (state.phase.kind !== "effect:choose") return state;
  const prompt = state.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error(`unexpected prompt ${prompt.kind}`);
  return must(
    applyAction(state, {
      type: "resolveEffect",
      seat,
      choice: { kind: "pokemonMulti", refs: [...prompt.candidates].slice(0, prompt.min) },
    }),
  );
}

/** Use "Angelite" (idx 1) on `seat`'s turn, then wind the board back round to
    `seat` — the board the cancel is printed for. */
function afterAngelite(seed: number, first: Seat, seat: Seat, activeId: string): GameState {
  const start = untilTurnOf(board(seed, first, seat, activeId), seat);
  const after = settleAngelitePark(
    must(applyAction(start, { type: "attack", seat, index: 1 })),
    seat,
  );
  return untilTurnOf(after, seat, start.turn + 1);
}

describe("D396 §1 — the corpus, the consequent it shares with Terapagos, and the split that buys THREE (D541)", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the corpus holds the sentence ONCE at THREE printings, and no reader takes it", () => {
    const rows = legalAttackCorpus().filter(([, text]) => text === ANGELITE);
    expect(rows.length).toBe(1);
    expect(rows.reduce((sum, [units]) => sum + units, 0)).toBe(3);
    expect(resolvedByAnyReader(ANGELITE)).toBe(false);
  });

  it("the CONSEQUENT is `barredIf`'s, in the passive voice — both spellings measured", () => {
    const passive = legalAttackCorpus().filter(([, t]) => t.includes("this attack can't be used"));
    expect(passive.length).toBe(1);
    expect(passive.reduce((sum, [units]) => sum + units, 0)).toBe(3);
    const active = legalAttackCorpus().filter(([, t]) => t.includes("you can't use this attack"));
    expect(active.length).toBe(1);
    expect(active.reduce((sum, [units]) => sum + units, 0)).toBe(7);
    // …and the two really are disjoint sentences, so the 3 and the 7 do not overlap.
    expect(passive[0]?.[1]).not.toBe(active[0]?.[1]);
    const family = legalAttackCorpus().filter(([, t]) => t.includes("during your last turn"));
    expect(family.length).toBe(5);
    expect(family.reduce((sum, [units]) => sum + units, 0)).toBe(7);
  });

  it("D541 — THE SPLIT IS AUTHORED AFTER ALL, and this rung is INVERTED rather than deleted", () => {
    expect(splitAttackGateClause(ANGELITE)).toEqual({
      clause: ANGELITE_CLAUSE,
      body: ANGELITE_BODY,
    });
    // ② …and what it hands the readers is a body ONE of them now claims — the
    //    reversal, stated as an equality rather than as a boolean so that a build
    //    which resolved it to the WRONG op is not green here.
    expect(resolvedByAnyReader(ANGELITE_BODY)).toBe(true);
    expect(deriveAttackEffect(ANGELITE_BODY)).toEqual([{ op: "returnBenchedChosen", count: 2 }]);
    // ③ THE BODY CARRIES NO CLAUSE OF ITS OWN — unmoved, and the one assertion in
    //    this rung that did NOT invert. It is what says the split is idempotent:
    //    splitting the body again answers `null`, so nothing can be stripped twice.
    expect(splitAttackGateClause(ANGELITE_BODY)).toBeNull();
    expect(resolvedByAnyReader(MAGICAL_CHARM)).toBe(true);
    expect(deriveAttackEffect(MAGICAL_CHARM)).toEqual([
      { op: "weakenDefenderAttacks", amount: 100 },
    ]);
    const gated = legalAttackCorpus().filter(([, t]) => splitAttackGateClause(t) !== null);
    expect(gated.length).toBe(9);
    expect(gated.reduce((sum, [units]) => sum + units, 0)).toBe(19);
    expect(gated.some(([, t]) => t === ANGELITE)).toBe(true);
    expect(resolvedByAnyReader(ANGELITE)).toBe(false);
  });

  it("THREE ids, ONE program object, and the gate is at index 1 — D281's reprint idiom", () => {
    const program = programFor(SYLVEON);
    expect(program).toBeDefined();
    expect(programFor(SYLVEON_PRE)).toBe(program);
    expect(programFor(SYLVEON_SIR)).toBe(program);
    expect(Object.keys(program ?? {})).toEqual(["attackGate"]);
    expect(Object.keys(program?.attackGate ?? {})).toEqual(["1"]);
    expect(program?.attackGate?.[1]).toEqual({
      kind: "barredIf",
      condition: { kind: "yourPokemonUsedAttackLastTurn", attack: "Angelite" },
    });
  });

  it("the clause NAMES the attack it is printed ON — the self-barring geometry", () => {
    const attacks = POOL[SYLVEON]?.attacks ?? [];
    expect(attacks).toHaveLength(2);
    expect(attacks[0]?.name).toBe("Magical Charm");
    expect(attacks[0]?.damage).toBe(160);
    expect(attacks[0]?.effect).toBe(MAGICAL_CHARM);
    expect(attacks[1]?.name).toBe("Angelite");
    expect(attacks[1]?.damage).toBeUndefined();
    expect(attacks[1]?.effect).toBe(ANGELITE);
    const gated = programFor(SYLVEON)?.attackGate?.[1];
    const named = gated?.kind === "barredIf" ? gated.condition : undefined;
    expect(named?.kind === "yourPokemonUsedAttackLastTurn" && named.attack).toBe(attacks[1]?.name);
  });

  it("`attackGateOf` answers index 1 and NOT index 0 — total, and index-keyed", () => {
    const state = board(SEEDS[0], "p1", "p1", SYLVEON);
    const body = activeOf(state, "p1");
    expect(attackGateOf(state, body, 1)).toBeDefined();
    expect(attackGateOf(state, body, 0)).toBeUndefined();
    expect(attackGateOf(state, body, 99)).toBeUndefined();
    expect(attackGateOf(state, body, -1)).toBeUndefined();
    const twin = board(SEEDS[0], "p1", "p1", UNGATED_TWIN);
    expect(programFor(UNGATED_TWIN)).toBeUndefined();
    expect(attackGateOf(twin, activeOf(twin, "p1"), 1)).toEqual({
      kind: "barredIf",
      condition: { kind: "yourPokemonUsedAttackLastTurn", attack: "Angelite" },
    });
    expect(attackGateOf(twin, activeOf(twin, "p1"), 0)).toBeUndefined();
    expect(attackGateOf(twin, activeOf(twin, "p1"), 1)).toEqual(
      programFor(SYLVEON)?.attackGate?.[1],
    );
  });
});

describe("D396 §2 — the row an INDEX-BLIND read confiscates", () => {
  it("idx 0 'Magical Charm' is LIVE on the very board where idx 1 is cancelled", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        for (const seed of SEEDS) {
          const state = afterAngelite(seed, first, seat, SYLVEON);
          expect(declare(state, seat, 1), `${seed} ${first} ${seat}`).toBe("ATTACK_PREVENTED");
          expect(declare(state, seat, 0), `${seed} ${first} ${seat}`).toBe("OK");
        }
      }
    }
  });

  it("…and a row authored at index 0 is the OTHER defect — both rows must stay live fresh", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        for (const seed of SEEDS) {
          const state = untilTurnOf(board(seed, first, seat, SYLVEON), seat);
          expect(declare(state, seat, 0), `${seed} ${first} ${seat}`).toBe("OK");
          expect(declare(state, seat, 1), `${seed} ${first} ${seat}`).toBe("OK");
        }
      }
    }
  });

  it("and the WIRE greys exactly one of the two rows — the per-index projection", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        const state = afterAngelite(SEEDS[0], first, seat, SYLVEON);
        expect(wirePlayable(state, seat, 0), `${first} ${seat}`).toBe(true);
        expect(wirePlayable(state, seat, 1), `${first} ${seat}`).toBe(false);
      }
    }
  });

  it("the refusal NAMES the printed clause in the printed polarity", () => {
    const state = afterAngelite(SEEDS[0], "p1", "p1", SYLVEON);
    const result = applyAction(state, { type: "attack", seat: "p1", index: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the cancel to refuse");
    expect(result.error.message).toContain("Angelite");
    expect(result.error.message).toContain(
      "it cannot be used while 1 of your Pokémon used Angelite during your last turn",
    );
    const gate = attackTimingBlocked(state, "p1", activeOf(state, "p1"), 1);
    expect(gate).toBeDefined();
    expect(gate === undefined ? "" : attackTimingNote(gate)).toBe(
      "it cannot be used while 1 of your Pokémon used Angelite during your last turn",
    );
    expect(conditionNote({ kind: "yourPokemonUsedAttackLastTurn", attack: "Angelite" })).toBe(
      "1 of your Pokémon used Angelite during your last turn",
    );
    expect(ANGELITE).toContain(
      `If ${conditionNote({ kind: "yourPokemonUsedAttackLastTurn", attack: "Angelite" })},`,
    );
    // …and it is NOT the sibling's note, which is what a `zone?` field defaulting
    // to the Active would have printed on this very board.
    expect(conditionNote({ kind: "yourActiveUsedAttackLastTurn", attack: "Angelite" })).toBe(
      "your Active Pokémon used Angelite during your last turn",
    );
  });
});

describe("D396 §3 — '1 of your Pokémon' is Active PLUS Bench, driven on the board that separates them", () => {
  it("the ACTIVE case, from both seats and under both assignments — the easy half", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        for (const seed of SEEDS) {
          const state = afterAngelite(seed, first, seat, SYLVEON);
          expect(declare(state, seat, 1), `${seed} ${first} ${seat}`).toBe("ATTACK_PREVENTED");
          expect(wirePlayable(state, seat, 1), `${seed} ${first} ${seat}`).toBe(false);
        }
      }
    }
  });

  it("THE BENCH CASE — a SECOND Sylveon ex is cancelled by the FIRST one's history", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        for (const seed of SEEDS) {
          const used = afterAngelite(seed, first, seat, SYLVEON);
          // The surgery displaces the stamped body onto the Bench and promotes a
          // FRESH copy — so the only thing carrying the history is a benched body.
          const swapped = payBoth(setActiveFromDeck(used, seat, SYLVEON), seat);
          const promoted = activeOf(swapped, seat);
          expect(promoted.usedAttack, `${seed} ${first} ${seat}`).toBeNull();
          expect(
            swapped.players[seat].bench.some((p) => p.usedAttack?.name === "Angelite"),
            `${seed} ${first} ${seat}`,
          ).toBe(true);
          expect(declare(swapped, seat, 1), `${seed} ${first} ${seat}`).toBe("ATTACK_PREVENTED");
          expect(wirePlayable(swapped, seat, 1), `${seed} ${first} ${seat}`).toBe(false);
          // …and index 0 is STILL live on that board, so the bench term widened the
          // condition and not the gate's reach.
          expect(declare(swapped, seat, 0), `${seed} ${first} ${seat}`).toBe("OK");
        }
      }
    }
  });

  it("…and the same board reached through a REAL retreat, not surgery", () => {
    // The board above is built with `setActiveFromDeck`, which is test surgery. This
    // one is built out of printed rules only — a §11 retreat paying the printed cost
    // of 2 — so the case is reachable in an actual game and not merely in a fixture.
    for (const seat of ["p1", "p2"] as const) {
      const start = untilTurnOf(board(SEEDS[0], "p1", seat, SYLVEON), seat);
      const withBench = benchFromDeck(start, seat, SYLVEON);
      const attacked = settleAngelitePark(
        must(applyAction(withBench, { type: "attack", seat, index: 1 })),
        seat,
      );
      const back = untilTurnOf(attacked, seat, start.turn + 1);
      const paying = activeOf(back, seat).energy.slice(0, 2);
      expect(paying, seat).toHaveLength(2);
      const benchIndex = back.players[seat].bench.findIndex(
        (p) => back.cardIdByUid[p.stack[p.stack.length - 1] ?? ""] === SYLVEON,
      );
      expect(benchIndex, seat).toBeGreaterThanOrEqual(0);
      const retreated = must(
        applyAction(back, {
          type: "retreat",
          seat,
          discardEnergy: [...paying],
          promoteBenchIndex: benchIndex,
        }),
      );
      const ready = payBoth(retreated, seat);
      expect(activeOf(ready, seat).usedAttack, seat).toBeNull();
      expect(declare(ready, seat, 1), seat).toBe("ATTACK_PREVENTED");
      expect(declare(ready, seat, 0), seat).toBe("OK");
    }
  });

  it("the window has a BACK EDGE — one more of your own turns and the cancel lifts", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        const used = afterAngelite(SEEDS[0], first, seat, SYLVEON);
        const later = untilTurnOf(used, seat, used.turn + 1);
        expect(declare(later, seat, 1), `${first} ${seat}`).toBe("OK");
        const swapped = payBoth(setActiveFromDeck(used, seat, SYLVEON), seat);
        const swappedLater = untilTurnOf(swapped, seat, swapped.turn + 1);
        expect(declare(swappedLater, seat, 1), `${first} ${seat}`).toBe("OK");
      }
    }
  });

  it("the OPPONENT's Angelite does not cancel yours — the possessive is read", () => {
    // "1 of YOUR Pokémon". A seat-blind walk is green on every board above, because
    // every one of them stamps the asking seat's own body.
    for (const seat of ["p1", "p2"] as const) {
      const other = seat === "p1" ? "p2" : "p1";
      // The opponent gets the Sylveon ex and uses Angelite; the asking seat's own
      // board has never used it.
      let state = localSetup(SEEDS[0], "p1");
      state = setActiveFromDeck(state, other, SYLVEON);
      state = clearBench(state, other);
      state = benchFromDeck(state, other, "fix-basic-1");
      state = setActiveFromDeck(state, seat, SYLVEON);
      state = clearBench(state, seat);
      state = benchFromDeck(state, seat, "fix-basic-1");
      state = payBoth(state, other);
      const theirTurn = untilTurnOf(state, other);
      const afterTheirs = settleAngelitePark(
        must(applyAction(theirTurn, { type: "attack", seat: other, index: 1 })),
        other,
      );
      const mine = payBoth(untilTurnOf(afterTheirs, seat, theirTurn.turn), seat);
      expect(afterTheirs.players[other].active?.usedAttack?.name, seat).toBe("Angelite");
      expect(declare(mine, seat, 1), seat).toBe("OK");
    }
  });

  it("a DIFFERENT attack's history does not cancel Angelite — the NAME is read", () => {
    // Drop the name test and "Magical Charm" cancels "Angelite". Both halves of the
    // helper are load-bearing and they fail on different boards; this is the other.
    for (const seat of ["p1", "p2"] as const) {
      const start = untilTurnOf(board(SEEDS[0], "p1", seat, SYLVEON), seat);
      const charmed = must(applyAction(start, { type: "attack", seat, index: 0 }));
      const back = payBoth(untilTurnOf(charmed, seat, start.turn + 1), seat);
      expect(activeOf(back, seat).usedAttack?.name, seat).toBe("Magical Charm");
      expect(declare(back, seat, 1), seat).toBe("OK");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. §9 does not reach this field, and both projections agree per index.
// ─────────────────────────────────────────────────────────────────────────────

describe("D396 §4 — the §9 rule, and the payability mirrors", () => {
  it("a live Klefki Ability-lock changes NOTHING on either side of the cancel", () => {
    // The INVERSE of `PassiveEffects.attackFirstTurnExempt`'s rule: §9 locks
    // ABILITIES, and every clause in `attackGate` is printed as ATTACK text. Driven
    // under a live lock rather than argued.
    for (const seat of ["p1", "p2"] as const) {
      const other = seat === "p1" ? "p2" : "p1";
      const fresh = untilTurnOf(board(SEEDS[0], "p1", seat, SYLVEON), seat);
      const cancelled = afterAngelite(SEEDS[0], "p1", seat, SYLVEON);
      for (const [label, state] of [
        ["fresh", fresh],
        ["cancelled", cancelled],
      ] as const) {
        const locked = benchFromDeck(state, other, "sv01-096");
        // The lock is really live on this board — without this line the two answers
        // agree because nothing is suppressed anywhere.
        expect(locked.players[other].bench.length, label).toBeGreaterThan(
          state.players[other].bench.length,
        );
        expect(declare(locked, seat, 1), `${seat} ${label}`).toBe(declare(state, seat, 1));
        expect(declare(locked, seat, 0), `${seat} ${label}`).toBe(declare(state, seat, 0));
      }
    }
  });

  it("the ENGINE gate and the WIRE projection agree on every row, seat and seed", () => {
    // Swept for AGREEMENT rather than asserted on either side alone — the failure
    // direction of a projection that drifts is the quiet one.
    let compared = 0;
    let legalRows = 0;
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        for (const seed of SEEDS) {
          for (const state of [
            untilTurnOf(board(seed, first, seat, SYLVEON), seat),
            afterAngelite(seed, first, seat, SYLVEON),
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

describe("D396 §5 — the report, which is the SAME on the gated body and on the twin", () => {
  it("D541 — the declaration reports NOTHING now, and the IDENTITY between the two bodies SURVIVES", () => {
    const gated = untilTurnOf(board(SEEDS[0], "p1", "p1", SYLVEON), "p1");
    const gatedSkipped = declareEvents(gated, "p1", 1).filter(
      (e) => e.type === "ATTACK_EFFECT_SKIPPED",
    );
    expect(gatedSkipped).toHaveLength(0);

    const twin = untilTurnOf(board(SEEDS[0], "p1", "p1", UNGATED_TWIN), "p1");
    const twinSkipped = declareEvents(twin, "p1", 1).filter(
      (e) => e.type === "ATTACK_EFFECT_SKIPPED",
    );
    expect(twinSkipped).toHaveLength(0);
    expect(splitAttackGateClause(ANGELITE)?.body).toBe(ANGELITE_BODY);
    expect(deriveAttackEffect(ANGELITE_BODY)).toEqual([{ op: "returnBenchedChosen", count: 2 }]);
  });

  it("D541 — the twin is CANCELLED TOO now, because the printed TEXT gates it (INVERTED)", () => {
    for (const seat of ["p1", "p2"] as const) {
      const state = afterAngelite(SEEDS[0], "p1", seat, UNGATED_TWIN);
      expect(declare(state, seat, 1), seat).toBe("ATTACK_PREVENTED");
      expect(wirePlayable(state, seat, 1), seat).toBe(false);
      // …and index 0 is STILL live on the very same board, so what moved is the
      // clause→gate table and not the gate's reach.
      expect(declare(state, seat, 0), seat).toBe("OK");
    }
  });

  it("index 0 really resolves its printed op on this card — a gate is not a program", () => {
    const state = untilTurnOf(board(SEEDS[0], "p1", "p1", SYLVEON), "p1");
    const before = activeOf(state, "p2").damage;
    const next = must(applyAction(state, { type: "attack", seat: "p1", index: 0 }));
    expect(before).toBe(0);
    expect(activeOf(next, "p2").damage).toBe(160);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. `MATCH_RECORD_VERSION` — the question asked of all three halves.
// ─────────────────────────────────────────────────────────────────────────────

describe("D396 §6 — MATCH_RECORD_VERSION stays 25, and the reason is measured", () => {
  it("the slice persists NOTHING a v25 record could be missing", () => {
    const gate = programFor(SYLVEON)?.attackGate?.[1];
    expect(JSON.stringify(gate ?? {}).includes('"op":')).toBe(false);
    // ② the member is a WIDENING no v25 record can contain, because the only card
    //    that authors it is this one and it is authored in the registry — a catalog
    //    fact re-derived from the board on every read, never written into a record;
    expect(gate).toEqual({
      kind: "barredIf",
      condition: { kind: "yourPokemonUsedAttackLastTurn", attack: "Angelite" },
    });
    const state = afterAngelite(SEEDS[0], "p1", "p1", SYLVEON);
    expect(activeOf(state, "p1").usedAttack).toEqual({ name: "Angelite", turn: state.turn - 2 });
    for (const body of state.players.p1.bench) {
      expect(Object.hasOwn(body, "usedAttack")).toBe(true);
    }
  });

  it("no `fix-*` demonstrator reached the shared pool — the census control", () => {
    for (const id of [SYLVEON, SYLVEON_PRE, SYLVEON_SIR, UNGATED_TWIN]) {
      expect(FIXTURE_POOL[id], id).toBeUndefined();
    }
    expect(programFor(UNGATED_TWIN)).toBeUndefined();
  });
});
