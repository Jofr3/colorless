import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { boostedAttackBase, boostedAttackDamage } from "./continuous";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, programFor } from "./index";
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
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
  types,
  findEvent,
  driveSetup,
} from "./testFixtures";
import type { BoostedAttack } from "./types";

const SENTENCE = "During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.";
const PROGRAM: readonly EffectOp[] = [
  { op: "boostAttack", attack: "Hyper Fang", amount: 240, base: true },
];
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

function must0(pokemon: InPlayPokemon | null): InPlayPokemon {
  if (pokemon === null) throw new Error("expected an Active Pokémon");
  return pokemon;
}

function localSetup(seed: number): GameState {
  return driveSetup(seed, { p1: FANG_DECK, p2: FANG_DECK }, { pool: POOL, first: "p1" });
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

function installed(opts: Parameters<typeof ready>[0] = {}) {
  const start = ready(opts);
  const { state, events } = attack(start, CHARGE);
  const row = findEvent(events, "ATTACK_BOOSTED");
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
    players: {
      ...state.players,
      p1: { ...state.players.p1, active: { ...active, boostedAttack: record } },
    },
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
    let additive = 0;
    for (const [, text] of legalAttackCorpus()) {
      for (const op of boostOps(deriveAttackEffect(text))) {
        if (op.base === true) continue;
        additive += 1;
        expect(Object.keys(op), text).not.toContain("base");
      }
    }
    expect(additive).toBe(5);
  });

  it("the record's WHOLE legal population: FOUR sentences / 8 printings — three ADDITIVE, one BASE-SET ( D546: SIX sentences / 10 printings — FIVE ADDITIVE, two of them ALL-ATTACKS, one BASE-SET)", () => {
    const rows: [number, string | null, number, boolean][] = [];
    for (const [count, text] of legalAttackCorpus()) {
      for (const op of boostOps(deriveAttackEffect(text))) {
        rows.push([count, op.attack, op.amount, op.base === true]);
      }
    }
    expect(rows).toEqual([
      [1, null, 100, false],
      [1, null, 120, false],
      [3, "Echoed Voice", 80, false],
      [2, "Hyper Fang", 240, true],
      [2, "Meteor Mash", 60, false],
      [1, "Tornado Rush", 100, false],
    ]);
    expect(rows.reduce((sum, [count]) => sum + count, 0)).toBe(10);
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
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(240);
    expect(row?.bonus).toBeUndefined();
    expect(row?.dealt).toBe(240);
    expect(state.players.p2.active?.damage).toBe(240 + 10); // + the install turn's Fang Charge
  });

  it("the unboosted control does the PRINTED 80 on the same board", () => {
    const { events } = attack(ready(), FANG);
    expect(findEvent(events, "DAMAGE_DEALT")?.base).toBe(PRINTED_FANG);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(PRINTED_FANG);
  });

  it("under ×2 Weakness it is 480 — the override THEN W/R, not 80 × 2 replaced", () => {
    const window = inWindow(installed({ defender: "d544-weak" }).state);
    const row = findEvent(attack(window, FANG).events, "DAMAGE_DEALT");
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row?.base).toBe(240);
    expect(row?.dealt).toBe(480);
  });

  it("with Resistance it is 210", () => {
    const window = inWindow(installed({ defender: "d544-resist" }).state);
    const row = findEvent(attack(window, FANG).events, "DAMAGE_DEALT");
    expect(row?.resistance).toEqual({ op: "subtract", amount: 30 });
    expect(row?.dealt).toBe(210);
  });

  it("an ADDITIVE pre-W/R term (Vitality Band) lands ON TOP of 240", () => {
    const start = attachToolFromDeck(ready(), "p1", "active", "sv01-197");
    const install = attack(start, CHARGE);
    expect(findEvent(install.events, "ATTACK_BOOSTED")?.base).toBe(true);
    const row = findEvent(attack(inWindow(install.state), FANG).events, "DAMAGE_DEALT");
    expect(row?.base).toBe(240);
    expect(row?.bonus).toBe(10);
    expect(row?.dealt).toBe(250);
  });

  it("an additive term AND Weakness: (240 + 10) × 2 = 500", () => {
    const start = attachToolFromDeck(ready({ defender: "d544-weak" }), "p1", "active", "sv01-197");
    const window = inWindow(attack(start, CHARGE).state);
    expect(findEvent(attack(window, FANG).events, "DAMAGE_DEALT")?.dealt).toBe(500);
  });

  it("the '+'-marker variant: the override is the base the scaling reading ADDS TO", () => {
    const control = attack(setDamage(ready({ attacker: "d544-fang-plus" }), "p1", 30), FANG);
    expect(findEvent(control.events, "DAMAGE_DEALT")?.dealt).toBe(80 + 30);

    const window = inWindow(installed({ attacker: "d544-fang-plus" }).state);
    const row = findEvent(attack(setDamage(window, "p1", 30), FANG).events, "DAMAGE_DEALT");
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
    expect(findEvent(attack(later, FANG).events, "DAMAGE_DEALT")?.dealt).toBe(PRINTED_FANG);
  });

  it("does not move a DIFFERENT attack on the same body in the same window", () => {
    const window = inWindow(installed().state);
    expect(boostedAttackBase(window, must0(window.players.p1.active), NIBBLE)).toBeNull();
    const row = findEvent(attack(window, NIBBLE).events, "DAMAGE_DEALT");
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
    const wasActive = state.players.p1.bench[0];
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
    const row = findEvent(attack(evolved, FANG).events, "DAMAGE_DEALT");
    expect(row?.base).toBe(PRINTED_FANG);
    expect(row?.dealt).toBe(PRINTED_FANG);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — §9 does not suppress it; §11 does not touch it.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — an INSTALLATION, not an Ability; a self-install, not an effect done to a body", () => {
  it("§9: an Ability-lock aura switches the printed +30 OFF and leaves the base override ON", () => {
    let state = ready({ attacker: "fix-booster-ability", defender: "sv02-127" });
    state = attachFromDeck(state, "p1", "fix-water-energy", 1); // "Hum" costs {W}
    const armed = runOne(
      state,
      [{ op: "boostAttack", attack: "Hum", amount: 240, base: true }],
      [],
    );
    const window = inWindow(must(applyAction(armed, { type: "endTurn", seat: "p1" })));
    // UNDAMAGED: the Ability is live — the control that the aura is what moves.
    const free = findEvent(attack(window, 0).events, "DAMAGE_DEALT");
    expect(free?.base).toBe(240);
    expect(free?.bonus).toBe(30);
    // DAMAGED: the printed Ability is suppressed; the override is untouched.
    const locked = findEvent(attack(setDamage(window, "p1", 10), 0).events, "DAMAGE_DEALT");
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
    expect(findEvent(install.events, "ATTACK_BOOSTED")?.base).toBe(true);
    expect(findEvent(install.events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
    expect(findEvent(attack(inWindow(install.state), FANG).events, "DAMAGE_DEALT")?.dealt).toBe(
      240,
    );
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
    expect(findEvent(events, "CONFUSION_CHECK")?.result).toBe("tails");
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(state.players.p2.active?.damage).toBe(10); // the install turn's Fang Charge only
  });

  it("HEADS: the attack resolves at 240", () => {
    const window = setConditions(inWindow(installed().state), "p1", { rotation: "confused" });
    const { events } = attack(withFace(window, "heads"), FANG);
    expect(findEvent(events, "CONFUSION_CHECK")?.result).toBe("heads");
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(240);
  });
});

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
    const boosted = findEvent(events, "ATTACK_BOOSTED");
    expect(render(boosted === undefined ? [] : [{ ...boosted, seat: "p2" }], state)).toEqual([
      { who: "p2", text: "d544-fang's Hyper Fang's base damage is 240 next turn" },
    ]);
  });

  it("the ADDITIVE row is unchanged — the branch keys on the rider alone", () => {
    const { state, events } = installed();
    const boosted = findEvent(events, "ATTACK_BOOSTED");
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
      {
        type: "ATTACK_BOOSTED",
        seat: "p1",
        uid: activeUid(s, "p1"),
        attack: "Hyper Fang",
        amount: 240,
        base: true,
      },
      {
        type: "ATTACK_BOOSTED",
        seat: "p1",
        uid: activeUid(s, "p1"),
        attack: "Hyper Fang",
        amount: 30,
      },
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
    const row = findEvent(attack(window, FANG).events, "DAMAGE_DEALT");
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
    expect(findEvent(loud, "ATTACK_BOOSTED")?.amount).toBe(300);
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

describe("§10 — `MATCH_RECORD_VERSION` STAYS 30, in three directions, LOSS included", () => {
  it("a v30 additive record reads unchanged, a v30 record carrying the optional `base` key round-trips, and a stripped one is inert", () => {
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
    expect(findEvent(attack(legacy, FANG).events, "DAMAGE_DEALT")?.dealt).toBe(PRINTED_FANG + 30);

    // DIRECTION 2 — FORWARD: the bytes this deploy writes, round-tripped.
    const wire = JSON.stringify(window.players.p1.active?.boostedAttack);
    expect(wire).toBe(`{"turn":5,"attackIndex":${String(FANG)},"amount":0,"base":240}`);
    const revived = withRawBoost(window, JSON.parse(wire) as BoostedAttack);
    expect(boostedAttackBase(revived, must0(revived.players.p1.active), FANG)).toBe(240);
    expect(findEvent(attack(revived, FANG).events, "DAMAGE_DEALT")?.dealt).toBe(240);

    // DIRECTION 3 — LOSS: a build that drops `base` leaves `{turn, attackIndex,
    // amount: 0}` — INERT (+0, printed base), not corrupting.
    const lost = JSON.parse(
      JSON.stringify(JSON.parse(wire), (k, v) => (k === "base" ? undefined : v)),
    ) as BoostedAttack;
    expect(Object.keys(lost)).toEqual(["turn", "attackIndex", "amount"]);
    const degraded = withRawBoost(window, lost);
    expect(boostedAttackBase(degraded, must0(degraded.players.p1.active), FANG)).toBeNull();
    expect(boostedAttackDamage(degraded, must0(degraded.players.p1.active), FANG)).toBe(0);
    expect(findEvent(attack(degraded, FANG).events, "DAMAGE_DEALT")?.dealt).toBe(PRINTED_FANG);
  });

  it("…and that residue is UNAUTHORABLE by the surviving path — every producer measured", () => {
    const additive: number[] = [];
    for (const [, text] of legalAttackCorpus()) {
      for (const op of boostOps(deriveAttackEffect(text))) {
        if (op.base !== true) additive.push(op.amount);
      }
    }
    expect(additive).toEqual([100, 120, 80, 60, 100]);
    expect(additive.every((n) => n >= 1)).toBe(true);
    const authored: [string, number][] = [];
    for (const id of registryCardIds()) {
      for (const op of boostOps(programFor(id))) authored.push([id, op.amount]);
    }
    expect(authored).toEqual([
      ["svp-089", 120],
      ["sv05-041", 120],
    ]);
  });
});
