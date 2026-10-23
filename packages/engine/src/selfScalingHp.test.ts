import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { effectiveMaxHp } from "./continuous";
import { applyAction, createGame, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setDamage,
  setPrizes,
  must,
  firstBasicInHand,
} from "./testFixtures";

const OKIDOGI = "sv06-111";
const OKIDOGI_R1 = "sv06.5-074";
const OKIDOGI_R2 = "sv08.5-057";
const CONKELDURR = "sv10.5b-049";
const CONKELDURR_R = "sv10.5b-127";
const BRAMBLE = "sv05-021";
const MAGCARGO = "sv05-029";

/** A plain 60-HP Basic with no Ability — the "nothing leaked" control on every
    board here, and the body `board()` defaults every unnamed spot to. */
const PLAIN = "fix-basic-1";
const DARK = "fix-dark-energy";
const DARK_ALT = "fix-dark-energy-alt";
const FIGHT = "fix-fighting-energy";
const FIGHT_ALT = "fix-fighting-energy-alt";
/** The WRONG type on each axis — a Conkeldurr that counted every attached card
    rather than its {F}, or an Okidogi gated on "any Energy", passes every board
    in this file without these. */
const WATER = "fix-water-energy";

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(
    [OKIDOGI, OKIDOGI_R1, OKIDOGI_R2].map((id) => [
      id,
      battler(id, {
        name: "Okidogi",
        hp: 130,
        retreat: 2,
        types: ["Fighting"],
        stage: "Basic",
        attacks: [{ cost: ["Fighting", "Fighting"], name: "Good Punch", damage: 70 }],
        abilities: [
          {
            type: "Ability",
            name: "Adrena-Power",
            effect:
              "If this Pokémon has any {D} Energy attached, it gets +100 HP, and the attacks it uses do 100 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
          },
        ],
      }),
    ]),
  ),
  ...Object.fromEntries(
    [CONKELDURR, CONKELDURR_R].map((id) => [
      id,
      battler(id, {
        name: "Conkeldurr",
        hp: 140,
        retreat: 3,
        types: ["Fighting"],
        stage: "Stage2",
        evolveFrom: "Gurdurr",
        attacks: [
          {
            cost: ["Fighting", "Colorless", "Colorless", "Colorless"],
            name: "Swing Around",
            damage: "100+",
            effect: "Flip 2 coins. This attack does 50 more damage for each heads.",
          },
        ],
        abilities: [
          {
            type: "Ability",
            name: "Craftsmanship",
            effect: "This Pokémon gets +40 HP for each {F} Energy attached to it.",
          },
        ],
      }),
    ]),
  ),
  [BRAMBLE]: battler(BRAMBLE, {
    name: "Brambleghast",
    hp: 100,
    retreat: 3,
    types: ["Grass"],
    stage: "Stage1",
    evolveFrom: "Bramblin",
    attacks: [
      {
        cost: ["Grass", "Colorless", "Colorless"],
        name: "Powerful Needles",
        damage: "80×",
        effect:
          "Flip a coin for each Energy attached to this Pokémon. This attack does 80 damage for each heads.",
      },
    ],
    abilities: [
      {
        type: "Ability",
        name: "Resilient Soul",
        effect: "This Pokémon gets +50 HP for each Prize card your opponent has taken.",
      },
    ],
  }),
  [MAGCARGO]: battler(MAGCARGO, {
    name: "Magcargo",
    hp: 120,
    retreat: 4,
    types: ["Fire"],
    stage: "Stage1",
    evolveFrom: "Slugma",
    attacks: [{ cost: ["Fire", "Colorless", "Colorless"], name: "Heat Blast", damage: 100 }],
    abilities: [
      {
        type: "Ability",
        name: "Lava Zone",
        effect:
          "Whenever your opponent's Active Pokémon moves to the Bench during their turn, their new Active Pokémon is now Burned.",
      },
    ],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const SCALE_DECK = deckOf({
  [OKIDOGI]: 4,
  [OKIDOGI_R1]: 2,
  [OKIDOGI_R2]: 2,
  [CONKELDURR]: 4,
  [CONKELDURR_R]: 2,
  [BRAMBLE]: 4,
  [MAGCARGO]: 4,
  [DARK]: 6,
  [DARK_ALT]: 4,
  [FIGHT]: 6,
  [FIGHT_ALT]: 4,
  [WATER]: 4,
  [PLAIN]: 8,
  "fix-energy": 6,
});

const SEEDS = [8201, 8207, 8219] as const;

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: SCALE_DECK, p2: SCALE_DECK }, cardPool: POOL });
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

/** P1 is the seat under test on every board here. The walk to turn 3 leaves P1
    to act, which is what lets §3 attach an Energy through the REAL action rather
    than only through surgery. */
function board(
  seed: number,
  opts: {
    p1Active?: string;
    p1Bench?: readonly string[];
    p2Active?: string;
    p2Bench?: readonly string[];
  } = {},
): GameState {
  let state = localSetup(seed);
  state = clearBench(setActiveFromDeck(state, "p1", opts.p1Active ?? PLAIN), "p1");
  for (const id of opts.p1Bench ?? [PLAIN]) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", opts.p2Active ?? PLAIN), "p2");
  for (const id of opts.p2Bench ?? [PLAIN]) state = benchFromDeck(state, "p2", id);
  for (let i = 0; i < 12; i += 1) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    if (state.phase.seat === "p1" && state.turn >= 3) break;
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  return state;
}

function activeMaxHp(state: GameState, seat: Seat): number | null {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return effectiveMaxHp(state, active);
}

function benchMaxHp(state: GameState, seat: Seat, index: number): number | null {
  const body = state.players[seat].bench[index];
  if (body === undefined) throw new Error(`${seat} has no bench[${index}]`);
  return effectiveMaxHp(state, body);
}

function discardEnergyFromActive(state: GameState, seat: Seat, count: number): GameState {
  const side = state.players[seat];
  if (side.active === null) throw new Error(`${seat} has no Active`);
  const dropped = side.active.energy.slice(0, count);
  if (dropped.length < count) throw new Error(`${seat}'s Active has ${dropped.length} Energy`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        active: { ...side.active, energy: side.active.energy.slice(count) },
        discard: [...side.discard, ...dropped],
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE THREE REGISTRY ROWS — and what each one is NOT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D325 §1 — the three registry rows", () => {
  it("Adrena-Power authors TWO clauses on ONE condition, and the damage half is an OLD field", () => {
    expect(programFor(OKIDOGI)?.passive).toEqual({
      hpBonus: { amount: 100, requiresEnergyType: "Darkness" },
      damageBonusBeforeWRIf: {
        amount: 100,
        cond: { kind: "yourActiveHasEnergyAttached", energy: "Darkness" },
      },
    });
    expect(programFor(OKIDOGI)?.passive?.damageBonusBeforeWRIf?.cond).toEqual({
      kind: "yourActiveHasEnergyAttached",
      energy: "Darkness",
    });
    expect(programFor(OKIDOGI)?.passive?.basicHpBonus).toBeUndefined();
    // NOT a `hpBonusPer`: "any" is a gate, not a multiplier. §4 drives it.
    expect(programFor(OKIDOGI)?.passive?.hpBonusPer).toBeUndefined();
    // NOT a `seatHpBonus`: "it gets" is the holder, not the side.
    expect(programFor(OKIDOGI)?.passive?.seatHpBonus).toBeUndefined();
  });

  it("Craftsmanship and Resilient Soul are ONE field over TWO scales", () => {
    expect(programFor(CONKELDURR)?.passive).toEqual({
      hpBonusPer: { amount: 40, scale: { kind: "attachedEnergy", energyType: "Fighting" } },
    });
    expect(programFor(BRAMBLE)?.passive).toEqual({
      hpBonusPer: { amount: 50, scale: { kind: "opponentPrizesTaken" } },
    });
    expect(programFor(BRAMBLE)?.passive?.hpBonusPer?.amount).toBe(50);
    expect(programFor(CONKELDURR)?.passive?.hpBonusPer?.scale).toEqual({
      kind: "attachedEnergy",
      energyType: "Fighting",
    });
    // NEITHER is a flat `hpBonus`, and neither carries a `requiresEnergyType`:
    // "for each" and "any" are different multipliers on the same board fact.
    expect(programFor(CONKELDURR)?.passive?.hpBonus).toBeUndefined();
    expect(programFor(BRAMBLE)?.passive?.hpBonus).toBeUndefined();
  });

  it("all six printings resolve, and the reprints SHARE one program object", () => {
    // Object identity, not deep equality: a reprint that had been re-authored
    // rather than aliased would pass `toEqual` and drift on the next edit.
    expect(programFor(OKIDOGI_R1)).toBe(programFor(OKIDOGI));
    expect(programFor(OKIDOGI_R2)).toBe(programFor(OKIDOGI));
    expect(programFor(CONKELDURR_R)).toBe(programFor(CONKELDURR));
    const printings = [OKIDOGI, OKIDOGI_R1, OKIDOGI_R2, CONKELDURR, CONKELDURR_R, BRAMBLE];
    expect(printings.every((id) => programFor(id)?.passive !== undefined)).toBe(true);
    expect(new Set(printings.map((id) => programFor(id))).size).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. OKIDOGI'S GATE — "ANY", not a count, and not the holder's printed type.
// ─────────────────────────────────────────────────────────────────────────────

describe("D325 §2 — Adrena-Power's +100 is GATED, not scaled", () => {
  it.each(SEEDS)("no {D} attached is +0, one {D} is the whole +100 (seed %i)", (seed) => {
    let state = board(seed, { p1Active: OKIDOGI });
    // The printed body, with nothing attached.
    expect(activeMaxHp(state, "p1")).toBe(130);
    // A {F} Energy on a {F} Pokémon changes NOTHING — the gate reads the ATTACHED
    // type and not the holder's. This is the assertion Okidogi's own type
    // mismatch exists to make.
    state = attachFromDeck(state, "p1", FIGHT, 2);
    expect(activeMaxHp(state, "p1")).toBe(130);
    state = attachFromDeck(state, "p1", WATER, 1);
    expect(activeMaxHp(state, "p1")).toBe(130);
    // One {D} and the whole grant lands.
    state = attachFromDeck(state, "p1", DARK, 1);
    expect(activeMaxHp(state, "p1")).toBe(230);
  });

  it.each(SEEDS)("FOUR {D} pay exactly the same +100 as one (seed %i)", (seed) => {
    let state = board(seed, { p1Active: OKIDOGI });
    state = attachFromDeck(state, "p1", DARK, 2);
    state = attachFromDeck(state, "p1", DARK_ALT, 2);
    expect(state.players.p1.active?.energy.length).toBe(4);
    expect(activeMaxHp(state, "p1")).toBe(230);
  });

  it.each(SEEDS)("the gate is per BODY — a benched Okidogi is on its own (seed %i)", (seed) => {
    let state = board(seed, { p1Active: OKIDOGI, p1Bench: [OKIDOGI_R1, PLAIN] });
    state = attachFromDeck(state, "p1", DARK, 1);
    expect(activeMaxHp(state, "p1")).toBe(230);
    // The reprint on the bench shares the PROGRAM and not the board fact.
    expect(benchMaxHp(state, "p1", 0)).toBe(130);
    // And nothing leaked onto the plain teammate — `hpBonus` is folded out of the
    // body's OWN sources, so an aura-shaped bug would show here first.
    expect(benchMaxHp(state, "p1", 1)).toBe(60);
    state = attachBenchFromDeck(state, "p1", 0, DARK_ALT, 1);
    expect(benchMaxHp(state, "p1", 0)).toBe(230);
    expect(benchMaxHp(state, "p1", 1)).toBe(60);
  });

  it.each(SEEDS)("the REAL attachEnergy action turns the grant on (seed %i)", (seed) => {
    let state = board(seed, { p1Active: OKIDOGI });
    expect(activeMaxHp(state, "p1")).toBe(130);
    state = handFromDeck(state, "p1", DARK, 1);
    state = must(
      applyAction(state, {
        type: "attachEnergy",
        seat: "p1",
        uid: handUid(state, "p1", DARK),
        target: { spot: "active" },
      }),
    );
    expect(activeMaxHp(state, "p1")).toBe(230);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. CONKELDURR'S MULTIPLIER — "for each", and it counts by PROVISION.
// ─────────────────────────────────────────────────────────────────────────────

describe("D325 §3 — Craftsmanship pays PER {F}", () => {
  it.each(SEEDS)("0/1/2/3 attached {F} give +0/+40/+80/+120 (seed %i)", (seed) => {
    let state = board(seed, { p1Active: CONKELDURR });
    expect(activeMaxHp(state, "p1")).toBe(140);
    state = attachFromDeck(state, "p1", FIGHT, 1);
    expect(activeMaxHp(state, "p1")).toBe(180);
    state = attachFromDeck(state, "p1", FIGHT, 1);
    expect(activeMaxHp(state, "p1")).toBe(220);
    state = attachFromDeck(state, "p1", FIGHT_ALT, 1);
    expect(activeMaxHp(state, "p1")).toBe(260);
  });

  it.each(SEEDS)("the WRONG type counts for nothing (seed %i)", (seed) => {
    // The control Okidogi cannot provide: a build that dropped `energyType` and
    // counted `pokemon.energy.length` would read 140 + 160 here.
    let state = board(seed, { p1Active: CONKELDURR });
    state = attachFromDeck(state, "p1", WATER, 2);
    state = attachFromDeck(state, "p1", DARK, 2);
    expect(state.players.p1.active?.energy.length).toBe(4);
    expect(activeMaxHp(state, "p1")).toBe(140);
    // And a single right one is still paid, on the same crowded body.
    state = attachFromDeck(state, "p1", FIGHT, 1);
    expect(activeMaxHp(state, "p1")).toBe(180);
  });

  it.each(SEEDS)("a plain Colorless-provider is NOT an {F} (seed %i)", (seed) => {
    // `countAttachedEnergy` counts by PROVISION (§6.3), so the discrimination
    // this makes is the same one `hasAttachedEnergy` makes and not a second
    // reading of the printed noun.
    let state = board(seed, { p1Active: CONKELDURR });
    state = attachFromDeck(state, "p1", "fix-energy", 3);
    expect(activeMaxHp(state, "p1")).toBe(140);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE TWO MULTIPLIERS AGAINST EACH OTHER — "any" vs "for each" on one board.
// ─────────────────────────────────────────────────────────────────────────────

describe("D325 §4 — 'any' and 'for each' on the same board", () => {
  it.each(SEEDS)("four Energy: Okidogi +100, Conkeldurr +160 (seed %i)", (seed) => {
    let state = board(seed, { p1Active: OKIDOGI, p1Bench: [CONKELDURR] });
    state = attachFromDeck(state, "p1", DARK, 2);
    state = attachFromDeck(state, "p1", DARK_ALT, 2);
    state = attachBenchFromDeck(state, "p1", 0, FIGHT, 2);
    state = attachBenchFromDeck(state, "p1", 0, FIGHT_ALT, 2);
    expect(activeMaxHp(state, "p1")).toBe(230);
    expect(benchMaxHp(state, "p1", 0)).toBe(300);
  });
});

describe("D325 §5 — Resilient Soul counts the OPPONENT's TAKEN Prizes", () => {
  it.each(SEEDS)("+0 at six remaining, +100 at four, +250 at one (seed %i)", (seed) => {
    let state = board(seed, { p1Active: BRAMBLE });
    expect(state.players.p2.prizes.length).toBe(6);
    expect(activeMaxHp(state, "p1")).toBe(100);
    state = setPrizes(state, "p2", 4);
    expect(activeMaxHp(state, "p1")).toBe(200);
    state = setPrizes(state, "p2", 1);
    expect(activeMaxHp(state, "p1")).toBe(350);
  });

  it.each(SEEDS)("it is the HOLDER's opponent, not a fixed seat (seed %i)", (seed) => {
    // The same printed sentence on both sides, resolved through `seatOfPokemon`.
    // A build that read `state.players.p2` (or the active seat) would give the two
    // Brambleghast the SAME answer; these two differ by 150.
    let state = board(seed, { p1Active: BRAMBLE, p2Active: BRAMBLE });
    state = setPrizes(state, "p1", 5);
    state = setPrizes(state, "p2", 2);
    // P1's Brambleghast reads P2's pile: 6 − 2 = 4 taken ⇒ +200.
    expect(activeMaxHp(state, "p1")).toBe(300);
    // P2's reads P1's: 6 − 5 = 1 taken ⇒ +50.
    expect(activeMaxHp(state, "p2")).toBe(150);
  });

  it.each(SEEDS)("a benched Brambleghast is paid the same (seed %i)", (seed) => {
    // `seatOfPokemon` is `isOnBench`'s scan with the answer KEPT, so a body in
    // either spot must resolve. A bench-blind seat lookup would return 0 here.
    let state = board(seed, { p1Active: PLAIN, p1Bench: [BRAMBLE, PLAIN] });
    state = setPrizes(state, "p2", 3);
    expect(benchMaxHp(state, "p1", 0)).toBe(250);
    expect(benchMaxHp(state, "p1", 1)).toBe(60);
    expect(activeMaxHp(state, "p1")).toBe(60);
  });
});

describe("D325 §6 — these grants can SHRINK, and one of them cannot", () => {
  it.each(SEEDS)("Okidogi's +100 is all-or-nothing on the LAST {D} (seed %i)", (seed) => {
    let state = board(seed, { p1Active: OKIDOGI });
    state = attachFromDeck(state, "p1", DARK, 2);
    expect(activeMaxHp(state, "p1")).toBe(230);
    // One of two {D} leaves: still "any", so still the whole +100.
    state = discardEnergyFromActive(state, "p1", 1);
    expect(activeMaxHp(state, "p1")).toBe(230);
    state = discardEnergyFromActive(state, "p1", 1);
    expect(activeMaxHp(state, "p1")).toBe(130);
  });

  it.each(SEEDS)("Conkeldurr falls FORTY AT A TIME (seed %i)", (seed) => {
    let state = board(seed, { p1Active: CONKELDURR });
    state = attachFromDeck(state, "p1", FIGHT, 3);
    expect(activeMaxHp(state, "p1")).toBe(260);
    state = discardEnergyFromActive(state, "p1", 1);
    expect(activeMaxHp(state, "p1")).toBe(220);
    state = discardEnergyFromActive(state, "p1", 2);
    expect(activeMaxHp(state, "p1")).toBe(140);
  });

  it.each(SEEDS)("the shrink can put damage AT OR ABOVE max HP (seed %i)", (seed) => {
    let state = board(seed, { p1Active: CONKELDURR });
    state = attachFromDeck(state, "p1", FIGHT, 3);
    state = setDamage(state, "p1", 200);
    // 200 damage against 260 max HP — alive, and comfortably so.
    expect(activeMaxHp(state, "p1")).toBe(260);
    expect(state.players.p1.active?.damage).toBe(200);
    state = discardEnergyFromActive(state, "p1", 2);
    expect(activeMaxHp(state, "p1")).toBe(180);
    expect(state.players.p1.active?.damage).toBe(200);
  });

  it.each(SEEDS)("a RETREAT pays the cost and Knocks the retreater Out (seed %i)", (seed) => {
    let state = board(seed, { p1Active: CONKELDURR, p1Bench: [PLAIN] });
    state = attachFromDeck(state, "p1", FIGHT, 3);
    state = setDamage(state, "p1", 200);
    expect(activeMaxHp(state, "p1")).toBe(260);
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    const result = applyAction(state, {
      type: "retreat",
      seat: "p1",
      promoteBenchIndex: 0,
      discardEnergy: active.energy.slice(0, 3),
    });
    if (!result.ok) throw new Error(`retreat failed: ${result.error.code}`);
    expect(result.events.some((e) => e.type === "RETREATED")).toBe(true);
    expect(result.events.some((e) => e.type === "KNOCKED_OUT" && e.seat === "p1")).toBe(true);
    // The opponent takes the prize; the actor keeps their turn once the KO's
    // decisions settle (`resumeTurn`, the mid-turn sweep's tail).
    expect(result.state.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p2" });
  });

  it.each(SEEDS)("…and a retreat that stays under the maximum sweeps nothing (seed %i)", (seed) => {
    let state = board(seed, { p1Active: CONKELDURR, p1Bench: [PLAIN] });
    state = attachFromDeck(state, "p1", FIGHT, 3);
    state = setDamage(state, "p1", 100);
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    const result = applyAction(state, {
      type: "retreat",
      seat: "p1",
      promoteBenchIndex: 0,
      discardEnergy: active.energy.slice(0, 3),
    });
    if (!result.ok) throw new Error(`retreat failed: ${result.error.code}`);
    expect(result.events.some((e) => e.type === "KNOCKED_OUT")).toBe(false);
    expect(result.state.phase.kind).toBe("turn:action");
    expect(benchMaxHp(result.state, "p1", result.state.players.p1.bench.length - 1)).toBe(140);
  });

  it.each(SEEDS)("Brambleghast's scale is MONOTONE and cannot do that (seed %i)", (seed) => {
    let state = board(seed, { p1Active: BRAMBLE });
    let previous = activeMaxHp(state, "p1") ?? 0;
    for (const remaining of [5, 4, 3, 2, 1, 0]) {
      state = setPrizes(state, "p2", remaining);
      const now = activeMaxHp(state, "p1") ?? 0;
      expect(now).toBeGreaterThan(previous);
      previous = now;
    }
    // Six taken is the ceiling the rules allow: 100 + 6 × 50.
    expect(previous).toBe(400);
  });
});

describe("D325 §7 — the invariants this slice was warned about", () => {
  it.each(SEEDS)(
    "every new term is an ADDEND — the sum never falls below the print (seed %i)",
    (seed) => {
      for (const id of [OKIDOGI, CONKELDURR, BRAMBLE]) {
        const printed = POOL[id]?.hp ?? 0;
        let state = board(seed, { p1Active: id });
        expect(activeMaxHp(state, "p1")).toBe(printed);
        state = attachFromDeck(state, "p1", WATER, 2);
        expect(activeMaxHp(state, "p1") ?? 0).toBeGreaterThanOrEqual(printed);
        state = attachFromDeck(state, "p1", DARK, 1);
        state = attachFromDeck(state, "p1", FIGHT, 1);
        expect(activeMaxHp(state, "p1") ?? 0).toBeGreaterThanOrEqual(printed);
        state = setPrizes(state, "p2", 0);
        expect(activeMaxHp(state, "p1") ?? 0).toBeGreaterThanOrEqual(printed);
      }
    },
  );

  it.each(SEEDS)("an EMPTY count adds exactly zero, never a floor (seed %i)", (seed) => {
    // The `amount × 0` case, stated separately from "no field at all": a build
    // that treated a zero count as "no grant" and one that treated it as
    // `amount` are both wrong, and only the first is green above.
    const state = board(seed, { p1Active: CONKELDURR, p1Bench: [BRAMBLE] });
    expect(activeMaxHp(state, "p1")).toBe(140);
    expect(benchMaxHp(state, "p1", 0)).toBe(100);
  });

  it.each(SEEDS)("a data-gap HP stays null under every scale (seed %i)", (seed) => {
    let state = board(seed, { p1Active: OKIDOGI });
    state = attachFromDeck(state, "p1", DARK, 1);
    expect(activeMaxHp(state, "p1")).toBe(230);
    const gapPool: Record<string, Card> = {
      ...POOL,
      [OKIDOGI]: battler(OKIDOGI, { ...POOL[OKIDOGI], hp: null } as Partial<Card>),
    };
    const gapped: GameState = { ...state, cardPool: gapPool };
    expect(activeMaxHp(gapped, "p1")).toBeNull();
  });
});

describe("D329 §8 — the retreat sweep runs BEHIND the Active→Bench trigger", () => {
  it.each(SEEDS)("the Ability fires BEFORE the Knock Out it does not cause (seed %i)", (seed) => {
    let state = board(seed, {
      p1Active: CONKELDURR,
      p1Bench: [PLAIN],
      p2Bench: [MAGCARGO], // the watcher, benched — the print carries no Active-Spot clause
    });
    state = attachFromDeck(state, "p1", FIGHT, 3);
    state = setDamage(state, "p1", 200);
    expect(activeMaxHp(state, "p1")).toBe(260);
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    const result = applyAction(state, {
      type: "retreat",
      seat: "p1",
      promoteBenchIndex: 0,
      discardEnergy: active.energy.slice(0, 3),
    });
    if (!result.ok) throw new Error(`retreat failed: ${result.error.code}`);
    const kinds = result.events.map((e) => e.type);
    const triggered = result.events.findIndex(
      (e) => e.type === "ABILITY_TRIGGERED" && e.ability === "Lava Zone",
    );
    const koed = kinds.indexOf("KNOCKED_OUT");
    expect(triggered).toBeGreaterThanOrEqual(0);
    expect(koed).toBeGreaterThanOrEqual(0);
    expect(triggered).toBeLessThan(koed);
  });

  it.each(SEEDS)("…and the trigger's consequent is a BURN on the NEW Active (seed %i)", (seed) => {
    let state = board(seed, {
      p1Active: CONKELDURR,
      p1Bench: [PLAIN],
      p2Bench: [MAGCARGO],
    });
    state = attachFromDeck(state, "p1", FIGHT, 3);
    state = setDamage(state, "p1", 200);
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    const result = applyAction(state, {
      type: "retreat",
      seat: "p1",
      promoteBenchIndex: 0,
      discardEnergy: active.energy.slice(0, 3),
    });
    if (!result.ok) throw new Error(`retreat failed: ${result.error.code}`);
    const burned = result.events.filter(
      (e): e is Extract<GameEvent, { type: "STATUS_APPLIED" }> => e.type === "STATUS_APPLIED",
    );
    expect(burned.map((e) => ({ seat: e.seat, status: e.status }))).toEqual([
      { seat: "p1", status: "burned" },
    ]);
    // The burn lands on the PROMOTED body, never on the one that left.
    const knockedOut = result.events.find(
      (e): e is Extract<GameEvent, { type: "KNOCKED_OUT" }> => e.type === "KNOCKED_OUT",
    );
    expect(knockedOut).toBeDefined();
    expect(burned[0]?.uid).not.toBe(knockedOut?.uid);
    // And no damage was placed by anything: the Knock Out is the COST's, whole.
    expect(result.events.some((e) => e.type === "COUNTERS_PLACED")).toBe(false);
  });

  it.each(SEEDS)("the control: no Magcargo, no trigger, same Knock Out (seed %i)", (seed) => {
    let state = board(seed, { p1Active: CONKELDURR, p1Bench: [PLAIN], p2Bench: [PLAIN] });
    state = attachFromDeck(state, "p1", FIGHT, 3);
    state = setDamage(state, "p1", 200);
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    const result = applyAction(state, {
      type: "retreat",
      seat: "p1",
      promoteBenchIndex: 0,
      discardEnergy: active.energy.slice(0, 3),
    });
    if (!result.ok) throw new Error(`retreat failed: ${result.error.code}`);
    expect(result.events.some((e) => e.type === "ABILITY_TRIGGERED")).toBe(false);
    expect(result.events.some((e) => e.type === "STATUS_APPLIED")).toBe(false);
    expect(result.events.some((e) => e.type === "KNOCKED_OUT" && e.seat === "p1")).toBe(true);
  });
});
