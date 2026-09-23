import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { boostedAttackBase, boostedAttackDamage } from "./continuous";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, programFor } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { registryCardIds } from "./registry";
import { flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  attachToolFromDeck,
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
  setConditions,
  setDamage,
  types,
} from "./testFixtures";
import type { BoostedAttack } from "./types";

// 0.428.0 → 0.429.0 — D544, THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW:
//
//   "During your next turn, this Pokémon's Hyper Fang attack's base damage is 240."
//
// `censusAttackCorpus.ts` FILE LINE 166, leading count column 2: **1 sentence / 2
// legal printings** (Raticate — `imperviousShell.test.ts`'s rung-2 census names it).
// Claimed WHOLE by `deriveAttackEffect` through ONE new anchor
// (`SELF_ATTACK_BASE_SET`, two `['’]` slots) and ONE new arm (24b') that emits the
// SHIPPED `boostAttack` op with a `base: true` RIDER — not a new op and not a new
// `InPlayPokemon` field. The record is D155's `BoostedAttack` with an OPTIONAL
// `base?: number`; the installer writes `amount: 0` beside it, so the unedited
// additive reader pays +0 by construction, and ONE new reader
// (`boostedAttackBase`, continuous.ts) hands `attack.ts`'s one `parseAttackDamage`
// line the number that REPLACES the printed base.
//
// ⚠️ NO CATALOG OR REGISTRY ID CARRIES THIS SENTENCE ON THIS CHECKOUT, AND THAT WAS
// MEASURED (D425): `git grep -c "Hyper Fang"` over `registry.ts`,
// `catalogManifest.ts` and `testFixtures.ts` returns zero. So every board here rides
// file-local DECLARED `d544-*` demonstrators in their OWN 60-card deck (D270), and
// Hyper Fang's real printed damage is UNMEASURED — which is why the "×"-marker case
// (a multiply clause whose base is overridden) is NAMED AS UNREACHED and not
// asserted anywhere below.
//
// Sections: §1 the derivation · §2 the install and the record · §3 the board
// (W/R order, additive terms) · §4 the window · §5 §10 clears · §6 §9 and §11 ·
// §7 confusion · §8 the log row · §9 the fieldwise merge · §10 the serialized bytes.

const SENTENCE = "During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.";
const PROGRAM: readonly EffectOp[] = [
  { op: "boostAttack", attack: "Hyper Fang", amount: 240, base: true },
];
/** The LEGAL additive sentence at `censusAttackCorpus.ts:165` (Meloetta ex's Echoed
    Voice, "80 more" — NOT D155's Seismitoad `sv03-052`, which prints "100 more" and
    is a local-D1 printing), one of THREE additive neighbours at the same address. */
const ECHOED_VOICE =
  "During your next turn, this Pokémon's Echoed Voice attack does 80 more damage (before applying Weakness and Resistance).";

const CHARGE = 0; // {C}, 10 — the installer (the sentence)
const FANG = 1; // {C}{C}, printed 80 — the named attack
const NIBBLE = 2; // {C}, 20 — the other index, the address control
const PRINTED_FANG = 80;

const LOCAL_CARDS: Record<string, Card> = {
  /** ONE body carrying the installer AND the named attack with a PLAIN printed
      number, plus a third attack as the address control. */
  "d544-fang": battler("d544-fang", {
    types: ["Colorless"],
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Fang Charge", damage: 10, effect: SENTENCE },
      { cost: ["Colorless", "Colorless"], name: "Hyper Fang", damage: PRINTED_FANG },
      { cost: ["Colorless"], name: "Nibble", damage: 20 },
    ],
  }),
  /** The "+"-MARKER variant: the named attack prints "80+" and a SHIPPED scaling
      reader owns the marker, so the override has to reach the base a reading
      ADDS TO rather than a bare printed number. */
  "d544-fang-plus": battler("d544-fang-plus", {
    types: ["Colorless"],
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Fang Charge", damage: 10, effect: SENTENCE },
      {
        cost: ["Colorless", "Colorless"],
        name: "Hyper Fang",
        damage: "80+",
        effect: "This attack does 10 more damage for each damage counter on this Pokémon.",
      },
    ],
  }),
  /** Evolves from `d544-fang` and prints Hyper Fang at the SAME index, so a record
      that survived evolution would pay the new card — the failure a §10 clear rules
      out is "boosted somewhere else", not only "still boosted". */
  "d544-fang-evolved": battler("d544-fang-evolved", {
    types: ["Colorless"],
    stage: "Stage1",
    evolveFrom: "d544-fang",
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Fang Charge", damage: 10, effect: SENTENCE },
      { cost: ["Colorless", "Colorless"], name: "Hyper Fang", damage: PRINTED_FANG },
    ],
  }),
  "d544-wall": battler("d544-wall", { types: ["Fighting"], hp: 600, retreat: 1 }),
  "d544-weak": battler("d544-weak", {
    types: ["Fighting"],
    hp: 600,
    retreat: 1,
    weaknesses: [{ type: "Colorless", value: "×2" }],
  }),
  "d544-resist": battler("d544-resist", {
    types: ["Fighting"],
    hp: 600,
    retreat: 1,
    resistances: [{ type: "Colorless", value: "-30" }],
  }),
  "d544-bench": battler("d544-bench", { types: ["Fighting"], hp: 300, retreat: 1 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), counted by the helper because 60 is a `createGame`
    precondition. */
const FANG_DECK = deckOf({
  "d544-fang": 4,
  "d544-fang-plus": 2,
  "d544-fang-evolved": 2,
  "d544-wall": 4,
  "d544-weak": 2,
  "d544-resist": 2,
  "d544-bench": 4,
  "sv01-197": 2, // Vitality Band — an ADDITIVE pre-W/R Tool term
  "sv02-172": 2, // Boss's Orders — the forced switch
  "fix-booster-ability": 2, // a §9-suppressible printed +30
  "sv02-127": 2, // Ting-Lu ex — "Cursed Land", the §9 Ability lock
  "fix-mist-energy": 2, // the §11 shield
  "fix-water-energy": 2, // {W} for fix-booster-ability's "Hum"
  "fix-energy": 28,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };
const SEED = 20260924;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function must0(pokemon: InPlayPokemon | null): InPlayPokemon {
  if (pokemon === null) throw new Error("expected an Active Pokémon");
  return pokemon;
}

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: FANG_DECK, p2: FANG_DECK }, cardPool: POOL });
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

/** P1's turn 3 (both opening turns passed, so no §4 restriction): P1 fields
    `attacker` with three Colorless energy and one benched body, P2 fields
    `defender` alone. */
function ready(
  opts: { attacker?: string; defender?: string; benched?: boolean; seed?: number } = {},
): GameState {
  const { attacker = "d544-fang", defender = "d544-wall", benched = true, seed = SEED } = opts;
  let state = localSetup(seed);
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attacker);
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-energy", 3);
  if (benched) state = benchFromDeck(state, "p1", "d544-bench");
  state = setActiveFromDeck(state, "p2", defender);
  state = clearBench(state, "p2");
  return state;
}

const attack = (state: GameState, index: number, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index });

/** `ready`, then Fang Charge DECLARED — asserting the row landed so no case can
    assert a number against an install that never happened. Returns P2's turn. */
function installed(opts: Parameters<typeof ready>[0] = {}) {
  const start = ready(opts);
  const { state, events } = attack(start, CHARGE);
  const row = find(events, "ATTACK_BOOSTED");
  if (row === undefined) throw new Error("Fang Charge installed nothing");
  return { start, state, events, row };
}

/** One more turn on — the holder's own next turn, which IS the window. */
function inWindow(state: GameState): GameState {
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function runOne(state: GameState, program: readonly EffectOp[], events: GameEvent[]): GameState {
  const result = runProgram(state, program, { seat: "p1", invokedBy: "attack" }, events);
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

function withRawBoost(state: GameState, record: BoostedAttack | null): GameState {
  const active = must0(state.players.p1.active);
  return {
    ...state,
    players: { ...state.players, p1: { ...state.players.p1, active: { ...active, boostedAttack: record } } },
  };
}

/** Every `boostAttack` op anywhere inside `value`, walked DEEP so a gate's nested
    branch cannot hide one (the registry's programs nest). */
function boostOps(value: unknown, out: Extract<EffectOp, { op: "boostAttack" }>[] = []) {
  if (Array.isArray(value)) {
    for (const v of value) boostOps(v, out);
  } else if (typeof value === "object" && value !== null) {
    if ((value as { op?: unknown }).op === "boostAttack") {
      out.push(value as Extract<EffectOp, { op: "boostAttack" }>);
    }
    for (const v of Object.values(value)) boostOps(v, out);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the derivation.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the anchor claims the sentence WHOLE, and only it", () => {
  it("derives ONE op: the shipped `boostAttack` with the `base` rider", () => {
    expect(deriveAttackEffect(SENTENCE)).toStrictEqual(PROGRAM);
  });

  it("the corpus row itself derives, off the committed bytes (file line 166, 2 printings)", () => {
    const rows = legalAttackCorpus().filter(([, text]) => text === SENTENCE);
    expect(rows).toEqual([[2, SENTENCE]]);
    // …and it is the ONLY corpus row that derives a base-set op — the population is
    // one sentence, measured rather than assumed.
    const baseRows = legalAttackCorpus().filter(([, text]) =>
      boostOps(deriveAttackEffect(text)).some((op) => op.base === true),
    );
    expect(baseRows.map(([, text]) => text)).toEqual([SENTENCE]);
  });

  it("BOTH apostrophe slots take either spelling, independently", () => {
    const [a, b] = ["Pokémon's", "attack's"];
    for (const [pokemon, attackWord] of [
      [a, b],
      ["Pokémon’s", b],
      [a, "attack’s"],
      ["Pokémon’s", "attack’s"],
    ] as const) {
      const text = SENTENCE.replace(a, pokemon).replace(b, attackWord);
      expect(deriveAttackEffect(text), text).toStrictEqual(PROGRAM);
    }
  });

  it("the NAME capture is apostrophe-FOLDED (constructed — no printing curls one)", () => {
    const straight = SENTENCE.replace("Hyper Fang", "Slip 'n' Roll");
    const curly = straight.replaceAll("'", "’");
    expect(deriveAttackEffect(curly)).toStrictEqual([
      { op: "boostAttack", attack: "Slip 'n' Roll", amount: 240, base: true },
    ]);
  });

  it("stays LOUD on a zero, and refuses every near-miss", () => {
    for (const text of [
      // A printed ZERO would zero the attack and announce it — left loud.
      SENTENCE.replace("240", "0"),
      // The ADDITIVE verb without the parenthetical — a sentence no arm reads.
      "During your next turn, this Pokémon's Hyper Fang attack does 240 more damage.",
      // No period.
      SENTENCE.slice(0, -1),
      // Lowercase "during" — the mid-sentence form a gated printing would carry.
      `d${SENTENCE.slice(1)}`,
      // The OPPONENT's body.
      "During your opponent's next turn, the Defending Pokémon's Hyper Fang attack's base damage is 240.",
      // A leading clause no reader owns — the `^` is load-bearing.
      `Xyzzy. ${SENTENCE}`,
      // A trailing clause no reader owns — the `$` is load-bearing.
      `${SENTENCE} Xyzzy.`,
      // "base damage is N more" — not a set.
      "During your next turn, this Pokémon's Hyper Fang attack's base damage is 240 more.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("is DISJOINT from `SELF_ATTACK_BOOST` in both directions", () => {
    // The additive sentence derives WITHOUT the rider — `toStrictEqual`, so a
    // `base: undefined` key would fail too — and the base-set one WITH it.
    expect(deriveAttackEffect(ECHOED_VOICE)).toStrictEqual([
      { op: "boostAttack", attack: "Echoed Voice", amount: 80 },
    ]);
    expect(deriveAttackEffect(SENTENCE)).toStrictEqual(PROGRAM);
    // …and the two HYBRIDS — each anchor's head with the other's tail — are refused,
    // so neither anchor reaches into the other's sentence from either side.
    expect(
      deriveAttackEffect(
        "During your next turn, this Pokémon's Hyper Fang attack's base damage is 240 (before applying Weakness and Resistance).",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "During your next turn, this Pokémon's Echoed Voice attack's does 80 more damage (before applying Weakness and Resistance).",
      ),
    ).toBeNull();
    // Every additive corpus row derives with NO `base` key at all.
    let additive = 0;
    for (const [, text] of legalAttackCorpus()) {
      if (!text.includes("more damage (before applying")) continue;
      for (const op of boostOps(deriveAttackEffect(text))) {
        additive += 1;
        expect(Object.keys(op), text).not.toContain("base");
      }
    }
    // EXACT, not `> 0`: the prose that argues from this population (continuous.ts,
    // attack.ts, index.ts, types.ts, match.ts) counts THREE additive sentences.
    expect(additive).toBe(3);
  });

  it("the record's WHOLE legal population: FOUR sentences / 8 printings — three ADDITIVE, one BASE-SET", () => {
    // The measured census every "N sentences write this record" claim in the
    // engine's prose rests on (D539: a count is measured, never copied). Leading
    // count column, attack name, amount, and the rider.
    const rows: [number, string, number, boolean][] = [];
    for (const [count, text] of legalAttackCorpus()) {
      for (const op of boostOps(deriveAttackEffect(text))) {
        rows.push([count, op.attack, op.amount, op.base === true]);
      }
    }
    expect(rows).toEqual([
      [3, "Echoed Voice", 80, false],
      [2, "Hyper Fang", 240, true],
      [2, "Meteor Mash", 60, false],
      [1, "Tornado Rush", 100, false],
    ]);
    expect(rows.reduce((sum, [count]) => sum + count, 0)).toBe(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the install and the record.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the install writes `{ turn, attackIndex, amount: 0, base }`", () => {
  it("stamps the holder's own next turn, resolves the name, and names the mode on the row", () => {
    const { start, state, row } = installed();
    expect(start.turn).toBe(3);
    expect(row).toStrictEqual({
      type: "ATTACK_BOOSTED",
      seat: "p1",
      uid: activeUid(start, "p1"),
      attack: "Hyper Fang",
      amount: 240,
      base: true,
    });
    expect(state.players.p1.active?.boostedAttack).toStrictEqual({
      turn: 5,
      attackIndex: FANG,
      amount: 0,
      base: 240,
    });
    // …and NOT the per-attack BAR.
    expect(state.players.p1.active?.lockedAttacks).toEqual([]);
  });

  it("the ADDITIVE reader pays +0 on a base record — by construction, not by a branch", () => {
    const window = inWindow(installed().state);
    const body = must0(window.players.p1.active);
    expect(boostedAttackDamage(window, body, FANG)).toBe(0);
    expect(boostedAttackBase(window, body, FANG)).toBe(240);
  });

  it("never parks and consumes no rng", () => {
    const { start, state } = installed();
    expect(state.phase.kind).not.toBe("effect:choose");
    // Fang Charge flips nothing, so the cursor is where setup left it.
    expect(state.rngState).toBe(start.rngState);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the board: the override, THEN Weakness/Resistance, with additive terms on top.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — Hyper Fang does 240 instead of its printed 80, and §8.5 runs after it", () => {
  it("does 240 on the next own turn, and DAMAGE_DEALT.base reads 240", () => {
    const window = inWindow(installed().state);
    const { state, events } = attack(window, FANG);
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(240);
    expect(row?.bonus).toBeUndefined();
    expect(row?.dealt).toBe(240);
    expect(state.players.p2.active?.damage).toBe(240 + 10); // + the install turn's Fang Charge
  });

  it("the unboosted control does the PRINTED 80 on the same board", () => {
    const { events } = attack(ready(), FANG);
    expect(find(events, "DAMAGE_DEALT")?.base).toBe(PRINTED_FANG);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(PRINTED_FANG);
  });

  it("under ×2 Weakness it is 480 — the override THEN W/R, not 80 × 2 replaced", () => {
    const window = inWindow(installed({ defender: "d544-weak" }).state);
    const row = find(attack(window, FANG).events, "DAMAGE_DEALT");
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row?.base).toBe(240);
    expect(row?.dealt).toBe(480);
  });

  it("with Resistance it is 210", () => {
    const window = inWindow(installed({ defender: "d544-resist" }).state);
    const row = find(attack(window, FANG).events, "DAMAGE_DEALT");
    expect(row?.resistance).toEqual({ op: "subtract", amount: 30 });
    expect(row?.dealt).toBe(210);
  });

  it("an ADDITIVE pre-W/R term (Vitality Band) lands ON TOP of 240", () => {
    const start = attachToolFromDeck(ready(), "p1", "active", "sv01-197");
    const install = attack(start, CHARGE);
    expect(find(install.events, "ATTACK_BOOSTED")?.base).toBe(true);
    const row = find(attack(inWindow(install.state), FANG).events, "DAMAGE_DEALT");
    expect(row?.base).toBe(240);
    expect(row?.bonus).toBe(10);
    expect(row?.dealt).toBe(250);
  });

  it("an additive term AND Weakness: (240 + 10) × 2 = 500", () => {
    const start = attachToolFromDeck(ready({ defender: "d544-weak" }), "p1", "active", "sv01-197");
    const window = inWindow(attack(start, CHARGE).state);
    expect(find(attack(window, FANG).events, "DAMAGE_DEALT")?.dealt).toBe(500);
  });

  it("the '+'-marker variant: the override is the base the scaling reading ADDS TO", () => {
    // d544-fang-plus prints "80+" with "10 more damage for each damage counter on
    // this Pokémon"; three counters make the reading's term 30 either way, so the
    // base is the whole difference: 240 + 30 against the control's 80 + 30.
    const control = attack(setDamage(ready({ attacker: "d544-fang-plus" }), "p1", 30), FANG);
    expect(find(control.events, "DAMAGE_DEALT")?.dealt).toBe(80 + 30);

    const window = inWindow(installed({ attacker: "d544-fang-plus" }).state);
    const row = find(attack(setDamage(window, "p1", 30), FANG).events, "DAMAGE_DEALT");
    expect(row?.base).toBe(240);
    expect(row?.dealt).toBe(240 + 30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the window.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the window is the holder's own next turn, on ONE index", () => {
  it("is not live on the opponent's turn in between", () => {
    const { state } = installed();
    expect(state.turn).toBe(4);
    expect(boostedAttackBase(state, must0(state.players.p1.active), FANG)).toBeNull();
  });

  it("is not live on the turn after the window — the stamp simply stops answering", () => {
    let later = inWindow(installed().state);
    later = must(applyAction(later, { type: "endTurn", seat: "p1" }));
    later = must(applyAction(later, { type: "endTurn", seat: "p2" }));
    expect(later.turn).toBe(7);
    expect(later.players.p1.active?.boostedAttack?.base).toBe(240);
    expect(boostedAttackBase(later, must0(later.players.p1.active), FANG)).toBeNull();
    expect(find(attack(later, FANG).events, "DAMAGE_DEALT")?.dealt).toBe(PRINTED_FANG);
  });

  it("does not move a DIFFERENT attack on the same body in the same window", () => {
    const window = inWindow(installed().state);
    expect(boostedAttackBase(window, must0(window.players.p1.active), NIBBLE)).toBeNull();
    const row = find(attack(window, NIBBLE).events, "DAMAGE_DEALT");
    expect(row?.base).toBe(20);
    expect(row?.dealt).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — §10 sheds it: the three clears the record already rides.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — retreat, a forced switch and evolution each clear it", () => {
  it("RETREATING inside the window sheds it", () => {
    const window = inWindow(installed().state);
    const { state } = mustApply(window, {
      type: "retreat",
      seat: "p1",
      discardEnergy: must0(window.players.p1.active).energy.slice(0, 1),
      promoteBenchIndex: 0,
    });
    const wasActive = state.players.p1.bench.at(-1);
    expect(state.cardIdByUid[wasActive?.stack[0] ?? ""]).toBe("d544-fang");
    expect(wasActive?.boostedAttack ?? null).toBeNull();
  });

  it("a FORCED switch (Boss's Orders, the opponent's route) sheds it", () => {
    const state = handFromDeck(installed().state, "p2", "sv02-172", 1);
    const boostedUid = activeUid(state, "p1");
    let gusted = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-172"),
    }).state;
    if (gusted.phase.kind === "effect:choose") {
      gusted = must(
        applyAction(gusted, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    const benched = gusted.players.p1.bench.find((p) => p.stack.includes(boostedUid));
    expect(benched).toBeDefined();
    expect(benched?.boostedAttack ?? null).toBeNull();
  });

  it("EVOLVING sheds it — and the evolved card's own Hyper Fang does its printed 80", () => {
    const window = inWindow(installed().state);
    const held = handFromDeck(window, "p1", "d544-fang-evolved", 1);
    const { state: evolved } = mustApply(held, {
      type: "evolve",
      seat: "p1",
      uid: handUid(held, "p1", "d544-fang-evolved"),
      target: { spot: "active" },
    });
    expect(evolved.players.p1.active?.boostedAttack).toBeNull();
    // Same index, same name on the new card: a surviving record would pay 240 here.
    const row = find(attack(evolved, FANG).events, "DAMAGE_DEALT");
    expect(row?.base).toBe(PRINTED_FANG);
    expect(row?.dealt).toBe(PRINTED_FANG);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — §9 does not suppress it; §11 does not touch it.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — an INSTALLATION, not an Ability; a self-install, not an effect done to a body", () => {
  it("§9: an Ability-lock aura switches the printed +30 OFF and leaves the base override ON", () => {
    // `fix-booster-ability` prints a §9-SUPPRESSIBLE +30; Ting-Lu ex's Cursed Land
    // locks a DAMAGED non-ex Active. The override is constructed onto its "Hum"
    // (20) — the printed demonstrator has no Ability, and this is D155's board.
    let state = ready({ attacker: "fix-booster-ability", defender: "sv02-127" });
    state = attachFromDeck(state, "p1", "fix-water-energy", 1); // "Hum" costs {W}
    const armed = runOne(
      state,
      [{ op: "boostAttack", attack: "Hum", amount: 240, base: true }],
      [],
    );
    const window = inWindow(must(applyAction(armed, { type: "endTurn", seat: "p1" })));
    // UNDAMAGED: the Ability is live — the control that the aura is what moves.
    const free = find(attack(window, 0).events, "DAMAGE_DEALT");
    expect(free?.base).toBe(240);
    expect(free?.bonus).toBe(30);
    // DAMAGED: the printed Ability is suppressed; the override is untouched.
    const locked = find(attack(setDamage(window, "p1", 10), 0).events, "DAMAGE_DEALT");
    expect(locked?.base).toBe(240);
    expect(locked?.bonus).toBeUndefined();
  });

  it("§11: a shield on the DEFENDER does not stop the install, and files no refusal", () => {
    // preventBlock.test.ts classifies `boostAttack` `untouched`; this drives it.
    const start = attachFromDeck(ready(), "p2", "fix-mist-energy", 1);
    expect(must0(start.players.p2.active).energy.map((u) => start.cardIdByUid[u])).toContain(
      "fix-mist-energy",
    );
    const install = attack(start, CHARGE);
    expect(find(install.events, "ATTACK_BOOSTED")?.base).toBe(true);
    expect(find(install.events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
    expect(find(attack(inWindow(install.state), FANG).events, "DAMAGE_DEALT")?.dealt).toBe(240);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — confusion: the override sits AFTER the §8 step-3 flip.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — a confused holder: tails pays nothing, heads pays 240", () => {
  function withFace(state: GameState, face: "heads" | "tails"): GameState {
    for (let rngState = 1; rngState < 200; rngState++) {
      if (flipCoin(rngState)[0] === face) return { ...state, rngState };
    }
    throw new Error(`no ${face} state`);
  }

  it("TAILS: the attack does not resolve, so the override deals nothing", () => {
    const window = setConditions(inWindow(installed().state), "p1", { rotation: "confused" });
    const { state, events } = attack(withFace(window, "tails"), FANG);
    expect(find(events, "CONFUSION_CHECK")?.result).toBe("tails");
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(state.players.p2.active?.damage).toBe(10); // the install turn's Fang Charge only
  });

  it("HEADS: the attack resolves at 240", () => {
    const window = setConditions(inWindow(installed().state), "p1", { rotation: "confused" });
    const { events } = attack(withFace(window, "heads"), FANG);
    expect(find(events, "CONFUSION_CHECK")?.result).toBe("heads");
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(240);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — the log row.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the row says BASE DAMAGE, under both seats, and never 'more damage'", () => {
  it("renders the install and reads it back", () => {
    const { state, events } = installed();
    const rows = render(events, state);
    const row = rows.find((r) => r.text.includes("Hyper Fang"));
    expect(row).toEqual({
      who: "p1",
      text: "d544-fang's Hyper Fang's base damage is 240 next turn",
    });
    expect(rows.some((r) => r.text.includes("more damage"))).toBe(false);

    // The same event under the OTHER seat — seat-independent wording.
    const boosted = find(events, "ATTACK_BOOSTED");
    expect(render(boosted === undefined ? [] : [{ ...boosted, seat: "p2" }], state)).toEqual([
      { who: "p2", text: "d544-fang's Hyper Fang's base damage is 240 next turn" },
    ]);
  });

  it("the ADDITIVE row is unchanged — the branch keys on the rider alone", () => {
    const { state, events } = installed();
    const boosted = find(events, "ATTACK_BOOSTED");
    if (boosted === undefined) throw new Error("no row");
    const additive: GameEvent = {
      type: "ATTACK_BOOSTED",
      seat: "p1",
      uid: boosted.uid,
      attack: "Hyper Fang",
      amount: 30,
    };
    expect(render([additive], state)).toEqual([
      { who: "p1", text: "d544-fang's Hyper Fang does 30 more damage next turn" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — the merge, constructed (unreachable off any printing).
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — a second install on the SAME address merges FIELDWISE by max", () => {
  const BASE: EffectOp = { op: "boostAttack", attack: "Hyper Fang", amount: 240, base: true };
  const PLUS: EffectOp = { op: "boostAttack", attack: "Hyper Fang", amount: 30 };

  it("base THEN additive keeps both", () => {
    const events: GameEvent[] = [];
    let s = runOne(ready(), [BASE], events);
    s = runOne(s, [PLUS], events);
    expect(s.players.p1.active?.boostedAttack).toStrictEqual({
      turn: 5,
      attackIndex: FANG,
      amount: 30,
      base: 240,
    });
    expect(events.filter((e) => e.type === "ATTACK_BOOSTED")).toStrictEqual([
      { type: "ATTACK_BOOSTED", seat: "p1", uid: activeUid(s, "p1"), attack: "Hyper Fang", amount: 240, base: true },
      { type: "ATTACK_BOOSTED", seat: "p1", uid: activeUid(s, "p1"), attack: "Hyper Fang", amount: 30 },
    ]);
  });

  it("additive THEN base keeps both — the early return compares BOTH fields", () => {
    const events: GameEvent[] = [];
    let s = runOne(ready(), [PLUS], events);
    s = runOne(s, [BASE], events);
    expect(s.players.p1.active?.boostedAttack).toStrictEqual({
      turn: 5,
      attackIndex: FANG,
      amount: 30,
      base: 240,
    });
    expect(types(events)).toEqual(["ATTACK_BOOSTED", "ATTACK_BOOSTED"]);
    // The constructed COMPOSITE pays both: 240 + 30 on the window's hit.
    const window = inWindow(must(applyAction(s, { type: "endTurn", seat: "p1" })));
    const row = find(attack(window, FANG).events, "DAMAGE_DEALT");
    expect(row?.base).toBe(240);
    expect(row?.bonus).toBe(30);
    expect(row?.dealt).toBe(270);
  });

  it("a smaller or equal base is silent; a larger one wins", () => {
    let s = runOne(ready(), [BASE], []);
    const quiet: GameEvent[] = [];
    s = runOne(s, [{ ...BASE, amount: 200 }, BASE], quiet);
    expect(quiet).toEqual([]);
    expect(s.players.p1.active?.boostedAttack?.base).toBe(240);
    const loud: GameEvent[] = [];
    s = runOne(s, [{ ...BASE, amount: 300 }], loud);
    expect(find(loud, "ATTACK_BOOSTED")?.amount).toBe(300);
    expect(s.players.p1.active?.boostedAttack).toStrictEqual({
      turn: 5,
      attackIndex: FANG,
      amount: 0,
      base: 300,
    });
  });

  it("a DIFFERENT index replaces the record outright — no base survives the move", () => {
    let s = runOne(ready(), [BASE], []);
    s = runOne(s, [{ op: "boostAttack", attack: "Nibble", amount: 30 }], []);
    expect(s.players.p1.active?.boostedAttack).toStrictEqual({
      turn: 5,
      attackIndex: NIBBLE,
      amount: 30,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — MATCH_RECORD_VERSION stays 30, driven over SERIALIZED BYTES (D456's shape).
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 — `MATCH_RECORD_VERSION` STAYS 30, in three directions, LOSS included", () => {
  it("🛑 a v30 additive record reads unchanged, a v30 record carrying the optional `base` key round-trips, and a stripped one is inert", () => {
    // Every direction is read INSIDE the window, so the clock cannot answer for the
    // bytes (installedRecoil.test.ts §5's rule).
    const window = inWindow(installed().state);
    expect(window.turn).toBe(5);

    // DIRECTION 1 — BACKWARD: the literal bytes a v30 deploy wrote (additive only).
    const v30 = JSON.parse(`{"turn":5,"attackIndex":${String(FANG)},"amount":30}`) as BoostedAttack;
    expect(Object.keys(v30)).toEqual(["turn", "attackIndex", "amount"]);
    const legacy = withRawBoost(window, v30);
    expect(boostedAttackBase(legacy, must0(legacy.players.p1.active), FANG)).toBeNull();
    expect(boostedAttackDamage(legacy, must0(legacy.players.p1.active), FANG)).toBe(30);
    expect(find(attack(legacy, FANG).events, "DAMAGE_DEALT")?.dealt).toBe(PRINTED_FANG + 30);

    // DIRECTION 2 — FORWARD: the bytes this deploy writes, round-tripped.
    const wire = JSON.stringify(window.players.p1.active?.boostedAttack);
    expect(wire).toBe(`{"turn":5,"attackIndex":${String(FANG)},"amount":0,"base":240}`);
    const revived = withRawBoost(window, JSON.parse(wire) as BoostedAttack);
    expect(boostedAttackBase(revived, must0(revived.players.p1.active), FANG)).toBe(240);
    expect(find(attack(revived, FANG).events, "DAMAGE_DEALT")?.dealt).toBe(240);

    // DIRECTION 3 — LOSS: a build that drops `base` leaves `{turn, attackIndex,
    // amount: 0}` — INERT (+0, printed base), not corrupting.
    const lost = JSON.parse(
      JSON.stringify(JSON.parse(wire), (k, v) => (k === "base" ? undefined : v)),
    ) as BoostedAttack;
    expect(Object.keys(lost)).toEqual(["turn", "attackIndex", "amount"]);
    const degraded = withRawBoost(window, lost);
    expect(boostedAttackBase(degraded, must0(degraded.players.p1.active), FANG)).toBeNull();
    expect(boostedAttackDamage(degraded, must0(degraded.players.p1.active), FANG)).toBe(0);
    expect(find(attack(degraded, FANG).events, "DAMAGE_DEALT")?.dealt).toBe(PRINTED_FANG);
  });

  it("🛑 …and that residue is UNAUTHORABLE by the surviving path — every producer measured", () => {
    // `amount: 0` with no `base` is written by NO additive install: every corpus
    // row's additive `boostAttack` carries amount >= 1 (arm 24b's guard), and the
    // registry holds no `boostAttack` at all — walked DEEP, so a gate cannot hide one.
    const additive: number[] = [];
    for (const [, text] of legalAttackCorpus()) {
      for (const op of boostOps(deriveAttackEffect(text))) {
        if (op.base !== true) additive.push(op.amount);
      }
    }
    expect(additive).toEqual([80, 60, 100]);
    expect(additive.every((n) => n >= 1)).toBe(true);
    for (const id of registryCardIds()) {
      expect(boostOps(programFor(id)), id).toEqual([]);
    }
  });
});
