import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import { effectiveAttackCost, effectiveRetreatCost, installedCostTaxOf } from "./continuous";
import * as effectsModule from "./effects";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion, redactGame } from "./index";
import type { GameState, InPlayPokemon, PlayerSide, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.433.0 → 0.434.0 — D549 (A), THE COST TAX:
//
//   "During your opponent's next turn, attacks used by the Defending Pokémon cost {C}
//    more, and its Retreat Cost is {C} more."
//
// `censusAttackCorpus.ts` FILE LINE 171 (leading count column 1): 1 sentence / 1 legal
// printing — census class SUBST-19 at SUBMAX=12 before this slice. Claimed WHOLE by
// `deriveAttackEffect` through ONE new anchor (`DEFENDER_COSTS_TAXED`, one `['’]` slot,
// `{C}` escaped, no capture) and ONE new arm (26f) emitting ONE new nullary op,
// `taxDefender`. The installer stamps `InPlayPokemon.costTaxTurn = T+1` on the
// OPPONENT's Active; ONE reader, `installedCostTaxOf`, is folded at BOTH cost seams
// (`effectiveAttackCost`'s `added`, `effectiveRetreatCost`'s sum).
//
// ⚠️ NO CATALOG, REGISTRY OR FIXTURE ID PRINTS THE SENTENCE ON THIS CHECKOUT, AND THAT
// WAS MEASURED (D425, `git grep`). Every board rides file-local DECLARED `d549-*`
// demonstrators in their OWN 60-card deck (D270); the real card is UNMEASURED.
//
// Sections: §1 the derivation · §2 the install · §3 the window, on both costs · §4 the
// free-retreat tier keeps precedence (R3) · §5 the retreat-COUNTING reads inherit it ·
// §6 the §10 clears · §7 §11 · §8 idempotence · §9 the projections · §10 the log ·
// §11 the v33 bytes and the v32 reject.

const S171 =
  "During your opponent's next turn, attacks used by the Defending Pokémon cost {C} more, and its Retreat Cost is {C} more.";
const P171: readonly EffectOp[] = [{ op: "taxDefender" }];

const TAX = 0; // {C}, 10 — the installer (:171)
const COUNT = 1; // {C}, 50 per {C} in the opponent's Active's Retreat Cost (attack.ts)
const THRESHOLD = 2; // {C}, 10 + 110 if that Retreat Cost is {C}{C} or more (interpreter.ts)
const JAB = 0; // the victim's {C} attack

const LOCAL_CARDS: Record<string, Card> = {
  "d549-taxer": battler("d549-taxer", {
    types: ["Colorless"],
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Tax", damage: 10, effect: S171 },
      {
        cost: ["Colorless"],
        name: "Count",
        effect:
          "This attack does 50 damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
      },
      {
        cost: ["Colorless"],
        name: "Threshold",
        damage: 10,
        effect:
          "If the Retreat Cost of your opponent's Active Pokémon is {C}{C} or more, this attack does 110 more damage.",
      },
    ],
  }),
  "d549-victim": battler("d549-victim", {
    types: ["Fighting"],
    hp: 400,
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Jab", damage: 20 }],
  }),
  "d549-victim-evolved": battler("d549-victim-evolved", {
    types: ["Fighting"],
    stage: "Stage1",
    evolveFrom: "d549-victim",
    hp: 400,
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Jab", damage: 20 }],
  }),
  "d549-bench": battler("d549-bench", { types: ["Fighting"], hp: 300, retreat: 1 }),
  /** The FREE-RETREAT source (R3): the registry's `fix-skyliner` program ("Your Basic
      Pokémon in play have no Retreat Cost."), declared here as `legalNonAttackPrograms`
      declares it, because `FIXTURE_POOL` carries no card for that id. */
  "fix-skyliner": battler("fix-skyliner", {
    name: "fix-skyliner",
    hp: 210,
    retreat: 2,
    types: ["Psychic"],
    abilities: [
      { type: "Ability", name: "Skyliner", effect: "Your Basic Pokémon in play have no Retreat Cost." },
    ],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  "d549-taxer": 4,
  "d549-victim": 4,
  "d549-victim-evolved": 2,
  "d549-bench": 6,
  "fix-skyliner": 2,
  "sv01-194": 4, // Switch — the victim's own switch clear
  "fix-mist-energy": 2, // the §11 shield
  "fix-energy": 36,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };
const SEED = 20260949;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function body(pokemon: InPlayPokemon | null | undefined): InPlayPokemon {
  if (pokemon === null || pokemon === undefined) throw new Error("expected a Pokémon");
  return pokemon;
}

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** P1's turn 3: P1 fields the taxer with one Energy; P2 fields `victim` with ONE Energy
    (so a taxed {C} attack is unpayable and a taxed Retreat Cost of 2 is unaffordable)
    and one benched body. */
function ready(opts: { victim?: string } = {}): GameState {
  const { victim = "d549-victim" } = opts;
  let state = localSetup(SEED);
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "d549-taxer");
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = benchFromDeck(state, "p1", "d549-bench");
  state = setActiveFromDeck(state, "p2", victim);
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p2", "fix-energy", 1);
  state = benchFromDeck(state, "p2", "d549-bench");
  return state;
}

const attack = (state: GameState, index: number, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index });

const pass = (state: GameState, seat: Seat): GameState =>
  must(applyAction(state, { type: "endTurn", seat }));

/** `ready`, then Tax DECLARED on turn 3 — returns P2's turn 4, THE window. */
function installed(opts: Parameters<typeof ready>[0] = {}) {
  const start = ready(opts);
  const { state, events } = attack(start, TAX);
  if (find(events, "COST_TAX_APPLIED") === undefined) throw new Error("Tax installed nothing");
  return { start, state, events };
}

function runAs(state: GameState, seat: Seat, program: readonly EffectOp[], events: GameEvent[]) {
  const result = runProgram(state, program, { seat, invokedBy: "attack" }, events);
  if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
  return result.state;
}

function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

function withP2Active(state: GameState, patch: Partial<InPlayPokemon>): GameState {
  const active = body(state.players.p2.active);
  return {
    ...state,
    players: { ...state.players, p2: { ...state.players.p2, active: { ...active, ...patch } } },
  };
}

/** P2 attaches one more Energy from its deck to its Active, by the ACTION (its turn's
    one attachment), so the taxed {C}{C} becomes payable. */
function p2AttachesOne(state: GameState): GameState {
  const withCard = handFromDeck(state, "p2", "fix-energy", 1);
  return mustApply(withCard, {
    type: "attachEnergy",
    seat: "p2",
    uid: handUid(withCard, "p2", "fix-energy"),
    target: { spot: "active" },
  }).state;
}

const refusal = (state: GameState, seat: Seat, index: number): string | null => {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? null : result.error.code;
};

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the derivation.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the anchor claims the row WHOLE, and only it", () => {
  it("derives ONE nullary op, `taxDefender`", () => {
    expect(deriveAttackEffect(S171)).toEqual(P171);
  });

  it("the corpus row derives off the committed bytes, and it is the ONLY such row", () => {
    const hits = legalAttackCorpus().filter(([, text]) =>
      (deriveAttackEffect(text) ?? []).some((op) => op.op === "taxDefender"),
    );
    expect(hits).toEqual([[1, S171]]);
  });

  it("claimed by EXACTLY ONE of the 13 readers (`deriveAttackEffect`), so the census counts it once", () => {
    expect(resolvedByAnyReader(S171)).toBe(true);
    const claimants = attackReaderSurface().filter((name) => {
      const read = (effectsModule as unknown as Record<string, (t: string) => unknown>)[name];
      return (read?.(S171) ?? null) !== null;
    });
    expect(claimants).toEqual(["deriveAttackEffect"]);
    expect(attackReaderSurface()).toHaveLength(14 /* 🆕🆕🆕 D573: 13 → 14, + deriveAttackCopy */);
  });

  it("the ONE apostrophe slot is U+0027 in the corpus, and the U+2019 twin derives the same op", () => {
    expect([...S171].flatMap((c, i) => (c === "'" ? [i] : []))).toEqual([20]);
    expect(deriveAttackEffect(S171.replace("'", "’"))).toEqual(P171);
  });

  it("refuses every single-axis near-miss", () => {
    const misses = [
      S171.replace("your opponent's next turn", "your next turn"),
      S171.replace("the Defending Pokémon", "this Pokémon"),
      S171.replace("cost {C} more", "cost {C}{C} more"),
      S171.replace("Retreat Cost is {C} more", "Retreat Cost is {C} less"),
      S171.replace(", and its Retreat Cost is {C} more", ""),
      S171.replace("{C}", "C"),
      // …and the anchor is `^…$`: a sentence in front of it or behind it is not this row.
      `Draw a card. ${S171}`,
      `${S171} Draw a card.`,
    ];
    for (const text of misses) {
      expect((deriveAttackEffect(text) ?? []).some((op) => op.op === "taxDefender"), text).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the install.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the install stamps `T+1` on the DEFENDER", () => {
  it("stamps the victim's own next turn onto P2's Active, with a row filed under P2", () => {
    const { start, state, events } = installed();
    expect(start.turn).toBe(3);
    expect(state.turn).toBe(4);
    expect(body(state.players.p2.active).costTaxTurn).toBe(4);
    expect(body(state.players.p1.active).costTaxTurn).toBeNull();
    expect(find(events, "COST_TAX_APPLIED")).toEqual({
      type: "COST_TAX_APPLIED",
      seat: "p2",
      uid: activeUid(start, "p2"),
    });
    // …and NOT an ATTACK_LOCKED row: the body is not locked (D421).
    expect(find(events, "ATTACK_LOCKED")).toBeUndefined();
  });

  it("never parks and consumes no rng", () => {
    const start = ready();
    const after = runAs(start, "p1", P171, []);
    expect(after.rngState).toBe(start.rngState);
    expect(body(after.players.p2.active).costTaxTurn).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — live on T+1 only, on BOTH costs.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — dead before, live on T+1, dead after — on the attack cost AND the Retreat Cost", () => {
  it("the reader answers 0 / 1 / 0 across turns 3, 4 and 5", () => {
    const start = ready();
    expect(installedCostTaxOf(start, body(start.players.p2.active))).toBe(0);
    const window = installed().state;
    expect(installedCostTaxOf(window, body(window.players.p2.active))).toBe(1);
    const after = pass(window, "p2");
    expect(after.turn).toBe(5);
    expect(installedCostTaxOf(after, body(after.players.p2.active))).toBe(0);
  });

  it("🛑 the attack cost: {C} becomes {C}{C}, so one Energy cannot pay Jab — and two can", () => {
    const window = installed().state;
    const victim = body(window.players.p2.active);
    expect(effectiveAttackCost(window, victim, ["Colorless"])).toEqual(["Colorless", "Colorless"]);
    expect(refusal(window, "p2", JAB)).toBe("ATTACK_COST_UNMET");
    const paid = p2AttachesOne(window);
    expect(body(paid.players.p2.active).energy).toHaveLength(2);
    expect(refusal(paid, "p2", JAB)).toBeNull();
  });

  it("🛑 the Retreat Cost: 1 becomes 2 — one Energy is a mismatch, two retreat", () => {
    const window = installed().state;
    const victim = body(window.players.p2.active);
    expect(effectiveRetreatCost(window, victim)).toBe(2);
    const one = applyAction(window, {
      type: "retreat",
      seat: "p2",
      discardEnergy: victim.energy.slice(0, 1),
      promoteBenchIndex: 0,
    });
    expect(one.ok ? null : one.error.code).toBe("RETREAT_COST_MISMATCH");
    const paid = p2AttachesOne(window);
    const retreated = mustApply(paid, {
      type: "retreat",
      seat: "p2",
      discardEnergy: body(paid.players.p2.active).energy.slice(0, 2),
      promoteBenchIndex: 0,
    });
    expect(retreated.state.players.p2.active?.stack).not.toContain(victim.stack[0]);
  });

  it("dead at T+3: the victim's NEXT own turn pays the printed {C} and the printed 1", () => {
    const later = pass(pass(installed().state, "p2"), "p1");
    expect(later.turn).toBe(6);
    const victim = body(later.players.p2.active);
    expect(victim.costTaxTurn).toBe(4);
    expect(effectiveAttackCost(later, victim, ["Colorless"])).toEqual(["Colorless"]);
    expect(effectiveRetreatCost(later, victim)).toBe(1);
    expect(refusal(later, "p2", JAB)).toBeNull();
  });

  it("the untaxed control pays the printed costs on the same board", () => {
    const control = pass(ready(), "p1");
    expect(control.turn).toBe(4);
    expect(effectiveRetreatCost(control, body(control.players.p2.active))).toBe(1);
    expect(refusal(control, "p2", JAB)).toBeNull();
  });

  it("the INSTALLER's own costs are untouched", () => {
    const window = installed().state;
    expect(effectiveAttackCost(window, body(window.players.p1.active), ["Colorless"])).toEqual([
      "Colorless",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — R3: the free-retreat tier keeps precedence.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — R3: a free-retreat effect still zeroes the taxed Retreat Cost", () => {
  it("a benched Skyliner frees the taxed Basic outright — the tax is a TERM, not a tier", () => {
    const window = benchFromDeck(installed().state, "p2", "fix-skyliner");
    expect(effectiveRetreatCost(window, body(window.players.p2.active))).toBe(0);
    // …and the attack cost is still taxed: the free tier is a RETREAT rule only.
    expect(effectiveAttackCost(window, body(window.players.p2.active), ["Colorless"])).toEqual([
      "Colorless",
      "Colorless",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the retreat-COUNTING reads inherit the surcharge.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — both retreat-counting reads see the TAXED Retreat Cost (constructed)", () => {
  // CONSTRUCTED: the tax's window is the HOLDER's own turn, and these reads are made by
  // the holder's OPPONENT when it attacks — so no played line puts the two together.
  // The rung pins that the reads go through `effectiveRetreatCost` and therefore
  // inherit the term with no byte of their own (R3).
  it("`attack.ts`'s per-{C} count and the interpreter's {C}{C}-or-more condition both move", () => {
    const start = ready();
    const taxed = withP2Active(start, { costTaxTurn: start.turn });
    expect(effectiveRetreatCost(taxed, body(taxed.players.p2.active))).toBe(2);
    expect(find(attack(taxed, COUNT).events, "DAMAGE_DEALT")?.dealt).toBe(100);
    expect(find(attack(start, COUNT).events, "DAMAGE_DEALT")?.dealt).toBe(50);
    expect(find(attack(taxed, THRESHOLD).events, "DAMAGE_DEALT")?.dealt).toBe(120);
    expect(find(attack(start, THRESHOLD).events, "DAMAGE_DEALT")?.dealt).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the §10 clears (R2), each the VICTIM's line on its own turn or a forced one.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — retreat, a Switch, evolution, a forced switch and devolution each clear it", () => {
  function benchedCarrier(state: GameState, uid: string): InPlayPokemon {
    expect(state.players.p2.active?.stack.includes(uid)).toBe(false);
    const benched = state.players.p2.bench.find((p) => p.stack.includes(uid));
    expect(benched).toBeDefined();
    return body(benched);
  }

  it("RETREAT on turn 4 (played, paying the TAXED 2): the benched body carries nothing", () => {
    const window = p2AttachesOne(installed().state);
    const uid = activeUid(window, "p2");
    const { state } = mustApply(window, {
      type: "retreat",
      seat: "p2",
      discardEnergy: body(window.players.p2.active).energy.slice(0, 2),
      promoteBenchIndex: 0,
    });
    expect(benchedCarrier(state, uid).costTaxTurn).toBeNull();
  });

  it("SWITCH on turn 4 (the victim's Item): the switched-out body carries nothing", () => {
    const at = installed().state;
    const victim = at.players.p2.hand.some((u) => at.cardIdByUid[u] === "sv01-194")
      ? at
      : handFromDeck(at, "p2", "sv01-194", 1);
    const uid = activeUid(victim, "p2");
    let state = mustApply(victim, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(victim, "p2", "sv01-194"),
    }).state;
    if (state.phase.kind === "effect:choose") {
      state = must(
        applyAction(state, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    expect(benchedCarrier(state, uid).costTaxTurn).toBeNull();
  });

  it("EVOLVE on turn 4: the evolved card pays the printed {C}", () => {
    const victim = handFromDeck(installed().state, "p2", "d549-victim-evolved", 1);
    const { state } = mustApply(victim, {
      type: "evolve",
      seat: "p2",
      uid: handUid(victim, "p2", "d549-victim-evolved"),
      target: { spot: "active" },
    });
    expect(body(state.players.p2.active).costTaxTurn).toBeNull();
    expect(refusal(state, "p2", JAB)).toBeNull();
  });

  it("FORCED switch (`switchInto` through a gust — constructed)", () => {
    const window = installed().state;
    const uid = activeUid(window, "p2");
    const state = runAs(window, "p1", [{ op: "gust" }], []);
    expect(benchedCarrier(state, uid).costTaxTurn).toBeNull();
  });

  it("DEVOLVE (`devolvedBodyOf`) sheds it too", () => {
    let state = pass(ready(), "p1");
    state = handFromDeck(state, "p2", "d549-victim-evolved", 1);
    state = mustApply(state, {
      type: "evolve",
      seat: "p2",
      uid: handUid(state, "p2", "d549-victim-evolved"),
      target: { spot: "active" },
    }).state;
    state = pass(state, "p2");
    state = runAs(state, "p1", P171, []);
    expect(body(state.players.p2.active).costTaxTurn).toBe(6);
    state = runAs(state, "p1", [{ op: "devolveEach" }], []);
    const devolved = body(state.players.p2.active);
    expect(state.cardIdByUid[devolved.stack.at(-1) ?? ""]).toBe("d549-victim");
    expect(devolved.costTaxTurn).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — §11.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — a §11 shield refuses the install, and is asked FIRST", () => {
  it("Mist Energy on the Defending Pokémon: refused, announced, nothing written", () => {
    const start = attachFromDeck(ready(), "p2", "fix-mist-energy", 1);
    const { state, events } = attack(start, TAX);
    expect(find(events, "ATTACK_EFFECT_PREVENTED")?.seat).toBe("p2");
    expect(find(events, "COST_TAX_APPLIED")).toBeUndefined();
    expect(body(state.players.p2.active).costTaxTurn).toBeNull();
  });

  it("…and a shielded body ALREADY taxed for the window still announces the refusal", () => {
    const start = attachFromDeck(ready(), "p2", "fix-mist-energy", 1);
    const taxed = withP2Active(start, { costTaxTurn: start.turn + 1 });
    const events: GameEvent[] = [];
    runAs(taxed, "p1", P171, events);
    expect(find(events, "ATTACK_EFFECT_PREVENTED")?.seat).toBe("p2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — idempotence.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — a same-window re-install is silent; a stale stamp is replaced", () => {
  it("installing twice writes one row", () => {
    const first: GameEvent[] = [];
    const once = runAs(ready(), "p1", P171, first);
    expect(first.map((e) => e.type)).toEqual(["COST_TAX_APPLIED"]);
    const second: GameEvent[] = [];
    const twice = runAs(once, "p1", P171, second);
    expect(second).toEqual([]);
    expect(body(twice.players.p2.active).costTaxTurn).toBe(4);
  });

  it("a stamp from an EARLIER window is overwritten with a row", () => {
    const stale = withP2Active(ready(), { costTaxTurn: 1 });
    const events: GameEvent[] = [];
    const after = runAs(stale, "p1", P171, events);
    expect(body(after.players.p2.active).costTaxTurn).toBe(4);
    expect(events.map((e) => e.type)).toEqual(["COST_TAX_APPLIED"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — the projections read the same fold (redact.ts takes zero bytes).
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — the victim's panel shows the taxed costs", () => {
  it("Jab is not playable on one Energy and publishes `effectiveCost`; Retreat asks 2", () => {
    const window = installed().state;
    const phase = redactGame(window, "p2").phase;
    if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
    expect(phase.attacks[JAB]?.playable).toBe(false);
    expect(phase.attacks[JAB]?.cost).toEqual(["Colorless"]);
    expect(phase.attacks[JAB]?.effectiveCost).toEqual(["Colorless", "Colorless"]);
    expect(phase.retreat).toEqual({ cost: 2, can: false });
    const paid = redactGame(p2AttachesOne(window), "p2").phase;
    if (paid.kind !== "turn:action") throw new Error("expected turn:action");
    expect(paid.attacks[JAB]?.playable).toBe(true);
    expect(paid.retreat).toEqual({ cost: 2, can: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — the log.
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 — the install row names both costs, in the victim's voice", () => {
  it("renders under P2, 'next turn' true (the holder's own), and no brace code", () => {
    const { state, events } = installed();
    expect(render(events, state)).toContainEqual({
      who: "p2",
      text: "d549-victim's attacks and Retreat Cost each need 1 more Colorless Energy next turn",
    });
    expect(render(events, state).some((r) => r.text.includes("{C}"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §11 — `MATCH_RECORD_VERSION` 32 → 33.
// ─────────────────────────────────────────────────────────────────────────────

describe("§11 — the v33 bytes round-trip, and a v32-shaped state is why the version moved (D549)", () => {
  it("🛑 v33: the stamp is in the serialized state, and a JSON round-trip still taxes", () => {
    const window = installed().state;
    const bytes = JSON.stringify(window);
    expect(bytes.includes('"costTaxTurn":4')).toBe(true);
    const revived = JSON.parse(bytes) as GameState;
    expect(refusal(revived, "p2", JAB)).toBe("ATTACK_COST_UNMET");
  });

  it("⚠️ a v32-shaped BODY (the key genuinely ABSENT) reads the tax as 0 — the silent soft landing", () => {
    const revived = JSON.parse(JSON.stringify(installed().state)) as GameState;
    const target = body(revived.players.p2.active) as Partial<InPlayPokemon>;
    // biome-ignore lint/performance/noDelete: the key must be genuinely ABSENT, which is what a v32 record looks like (D124).
    delete target.costTaxTurn;
    expect("costTaxTurn" in target).toBe(false);
    // `undefined === 4` is false: the printed surcharge silently never lands (D124's
    // plausible wrong board) — one of the two reasons the version moved.
    expect(installedCostTaxOf(revived, body(revived.players.p2.active))).toBe(0);
  });

  it("🛑 a v32-shaped STATE (no `sideAttackLock` on either side) THROWS on the declaration and the projection", () => {
    const revived = JSON.parse(JSON.stringify(installed().state)) as GameState;
    for (const seat of ["p1", "p2"] as const) {
      const side = revived.players[seat] as Partial<PlayerSide>;
      // biome-ignore lint/performance/noDelete: the key must be genuinely ABSENT (D124).
      delete side.sideAttackLock;
    }
    expect(() => applyAction(revived, { type: "attack", seat: "p2", index: JAB })).toThrow(TypeError);
    expect(() => redactGame(revived, "p2")).toThrow(TypeError);
  });

  it("the engine version stepped to 0.457.0 in BOTH places", () => {
    expect(engineVersion).toBe("0.457.0");
    expect(manifest.version).toBe("0.457.0");
  });
});
