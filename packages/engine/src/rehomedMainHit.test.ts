import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handUid,
  handFromDeck,
  setActiveFromDeck,
  setDamage,
  typedEnergy,
} from "./testFixtures";

// ── THE RE-HOMED MAIN HIT AND THE TWO §9 REACTIONS IT USED TO WALK PAST ──────
//
// 🛑 A REVIEW-FIX DRIVER, NOT A SLICE. D316 (`optional`) and D317 (`conditionGate`
// / `coinFlipGate`) both MOVE an attack's whole main hit INTO the effect program:
// their readers force `scaledBase` to 0 and re-home the printed base — on BOTH
// gate arms — into a `damageDefender` nested inside the gate they build. That is
// the right design for the ARITHMETIC (§8.5 is applied once, to the number the
// answer decided — those two suites drive it on a −30 Resistance board), and it
// silently took the two §9 REACTIONS out of the sequence with it, because both
// were seeded inside `attack.ts`'s `if (scaledBase + scaledTotal > 0)` block:
//
//   • the `damageAttacker` RECOIL — Rocky Helmet sv01-193 (2 counters = 20 HP),
//     Counterattack Quills, Custom Trap, and D152's installed half; and
//   • the `onDamagedByAttack` TRIGGER stage — Armarouge sv03-044 "Scorching
//     Armor", Klawf ex sv03-120 "Counterattacking Pincer".
//
// Neither is conditioned on WHICH CODE PATH routed the damage. Both printed
// sentences say "is damaged by an attack", and a re-homed hit is damage from an
// attack: it runs the identical §8.5 pipeline, emits the identical `DAMAGE_DEALT`
// row and can Knock the body Out. So the seeding belongs at the DAMAGE, and the
// repair puts it at `snipeActive` — the interpreter's one funnel for §8.5 attack
// damage to the opponent's ACTIVE (`placeSnipe` handles the Bench and only the
// Bench, and neither reaction is a Bench reaction).
//
// ⚠️ THE CONTROL IS ON THE SAME BOARD AND IN THE SAME SUITE (§1): Gurdurr's OTHER
// attack is a plain flat hit that never leaves `attack.ts`, and it fires both
// reactions before and after the repair. A driver whose only boards are the
// broken ones cannot tell "the reaction is wired" from "the fixture is wrong".
//
// ⚠️ AND `sv03-044` IS RE-PRINTED LOCALLY AT 400 HP, SAID OUT LOUD (D243's rule).
// `FIXTURE_POOL`'s Armarouge is the real 120, which every board below would Knock
// Out on the first hit — a lethal board proves "even if it is Knocked Out" and
// hides the arithmetic. The Ability, the type and the Basic stage are the real
// print; only the HP is local, and §5 keeps the lethal reading too.

/** D316 — "You may do {N} more damage. If you do, …" (the `optional` gate). */
const GURDURR = "sv06-104";
/** D317 — "…this attack does {N} more damage, and {consequent}" (`conditionGate`). */
const OGERPON = "sv06-040";
/** D317's other decider — the same sentence behind a coin (`coinFlipGate`). */
const FLORAGATO = "sv09-017";
/** The `onDamagedByAttack` holder (§9) — Scorching Armor Burns the attacker. */
const ARMAROUGE = "sv03-044";
/** The `damageAttacker` TOOL (§9) — 2 counters = 20 HP onto the attacker. */
const HELMET = "sv01-193";

const EVOLVED = "fix-rmh-evolved";
const FILLER = "fix-rmh-filler";
const FIRE = "fix-rmh-fire";
const FIGHT = "fix-rmh-fight";
const GRASS = "fix-rmh-grass";

const GURDURR_TEXT =
  "You may do 30 more damage. If you do, this Pokémon also does 30 damage to itself.";
const OGERPON_TEXT =
  "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 140 more damage, and discard all Energy from this Pokémon.";
const FLORAGATO_TEXT =
  "Flip a coin. If heads, this attack does 30 more damage, and heal 30 damage from this Pokémon.";

/** The LOCAL pool (D275's idiom) — the four real ids live HERE, so no `fix-*`
    demonstrator and no `CATALOG_MANIFEST` row is owed. The three attackers are
    transcribed from D316's and D317's own suites unchanged; `sv03-044` is the
    declared HP re-print described in the header. */
const LOCAL_CARDS: Record<string, Card> = {
  [GURDURR]: battler(GURDURR, {
    name: "Gurdurr",
    hp: 140,
    stage: "Stage1",
    evolveFrom: "Timburr",
    retreat: 2,
    types: ["Fighting"],
    attacks: [
      // The CONTROL attack — a flat printed hit that never leaves `attack.ts`.
      { cost: ["Fighting"], name: "Knuckle Punch", damage: 20 },
      {
        cost: ["Fighting", "Colorless", "Colorless"],
        name: "Superpower",
        damage: "50+",
        effect: GURDURR_TEXT,
      },
    ],
  }),
  [OGERPON]: battler(OGERPON, {
    name: "Hearthflame Mask Ogerpon ex",
    hp: 210,
    stage: "Basic",
    retreat: 1,
    types: ["Fire"],
    attacks: [
      { cost: ["Fire"], name: "Ember", damage: 10 },
      {
        cost: ["Fire", "Fire", "Fire"],
        name: "Dynamic Blaze",
        effect: OGERPON_TEXT,
        damage: "140+",
      },
    ],
  }),
  [FLORAGATO]: battler(FLORAGATO, {
    name: "Floragato",
    hp: 90,
    stage: "Stage1",
    evolveFrom: "Sprigatito",
    retreat: 1,
    types: ["Grass"],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Magical Leaf", effect: FLORAGATO_TEXT, damage: "30+" },
    ],
  }),
  /** ⚠️ 400 HP AND NOT THE PRINTED 120 — the header says why, and §5 drives the
      lethal reading the real number would force on every board. Everything else
      is `FIXTURE_POOL`'s Armarouge verbatim: Fire, Basic, "Scorching Armor". */
  [ARMAROUGE]: battler(ARMAROUGE, {
    name: "Armarouge",
    types: ["Fire"],
    hp: 400,
    abilities: [
      { type: "Ability", name: "Scorching Armor", effect: "…the Attacking Pokémon is now Burned." },
    ],
  }),
  /** The POSITIVE side of Ogerpon's gate — `opponentActiveIsEvolution` reads
      `evolveFrom` (D105), so this body takes the YES arm while Armarouge (a
      Basic) takes the NO arm. It carries no Ability, so it drives the RECOIL
      half alone, which is the half a Tool can grant to anything. */
  [EVOLVED]: battler(EVOLVED, {
    name: "Rehomed Evolved Wall",
    types: ["Colorless"],
    hp: 400,
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
  }),
  [FILLER]: battler(FILLER, { name: "Rehomed Filler", types: ["Colorless"], hp: 60 }),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [FIGHT]: typedEnergy(FIGHT, "Fighting"),
  [GRASS]: typedEnergy(GRASS, "Grass"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [GURDURR]: 4,
  [OGERPON]: 4,
  [FLORAGATO]: 4,
  [ARMAROUGE]: 4,
  [EVOLVED]: 4,
  [FILLER]: 4,
  [HELMET]: 4,
  [FIRE]: 12,
  [FIGHT]: 12,
  [GRASS]: 8,
});

/** Two seeds for every deterministic board — nothing below rests on one shuffle
    (D270); the coin gate sweeps eight. */
const SEEDS = [4021, 4099] as const;
const COIN_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
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

/** TEST SURGERY — `count` Energy of one printed type onto p1's Active. */
function fuel(state: GameState, energyId: string, count: number): GameState {
  const side = state.players.p1;
  const body = side.active;
  if (body === null) throw new Error("p1 has no Active");
  const energy = side.deck.filter((u) => state.cardIdByUid[u] === energyId).slice(0, count);
  if (energy.length < count) throw new Error(`deck lacks ${count} × ${energyId}`);
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        active: { ...body, energy: [...body.energy, ...energy] },
        deck: side.deck.filter((u) => !energy.includes(u)),
      },
    },
  };
}

/** A board on p1's turn: `defender` standing opposite wearing Rocky Helmet (P2
    goes first, so the Tool is attached by a REAL `attachTool` action rather than
    by surgery), and `attacker` Active with `energy × count` on it. */
function board(opts: {
  attacker: string;
  energy: string;
  count: number;
  defender: string;
  helmet?: boolean;
  seed?: number;
}): GameState {
  let state = localSetup(opts.seed ?? SEEDS[0]);
  state = setActiveFromDeck(state, "p2", opts.defender);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", FILLER);
  if (opts.helmet !== false) {
    state = handFromDeck(state, "p2", HELMET, 1);
    state = must(
      applyAction(state, {
        type: "attachTool",
        seat: "p2",
        uid: handUid(state, "p2", HELMET),
        target: { spot: "active" },
      }),
    );
    expect(state.players.p2.active?.tools).toHaveLength(1);
  }
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", opts.attacker);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", FILLER);
  state = benchFromDeck(state, "p1", FILLER);
  return fuel(state, opts.energy, opts.count);
}

const PUNCH = { type: "attack", seat: "p1", index: 0 } as const;
const SUPERPOWER = { type: "attack", seat: "p1", index: 1 } as const;
const BLAZE = { type: "attack", seat: "p1", index: 1 } as const;
const LEAF = { type: "attack", seat: "p1", index: 0 } as const;
const YES = { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } } as const;
const NO = { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: false } } as const;

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function count(events: readonly GameEvent[], type: GameEvent["type"]): number {
  return events.filter((e) => e.type === type).length;
}

/** The §9 recoil row — labelled by MECHANISM (`"counterattack"`, D141), which is
    what tells it from a snipe's `COUNTERS_PLACED`. */
function recoil(events: readonly GameEvent[]) {
  return events.find((e) => e.type === "COUNTERS_PLACED" && e.source === "counterattack");
}

/** The §9 trigger's two rows — the Ability announcement and the Burn it lands on
    the ATTACKER's seat. */
function burned(events: readonly GameEvent[]): boolean {
  return (
    events.some((e) => e.type === "ABILITY_TRIGGERED" && e.ability === "Scorching Armor") &&
    events.some((e) => e.type === "STATUS_APPLIED" && e.seat === "p1" && e.status === "burned")
  );
}

/** Both reactions, asserted together — they share a seeding site and they shared
    the defect, so a board that drives one and not the other would leave half of
    the repair unpinned. */
function expectBothReactions(events: readonly GameEvent[], where: string): void {
  expect(recoil(events), `${where}: Rocky Helmet's recoil`).toMatchObject({
    seat: "p1",
    amount: 20,
    source: "counterattack",
  });
  expect(burned(events), `${where}: Scorching Armor's Burn`).toBe(true);
}

// ────────────────────────────────────────────────────────────────────────────
describe("§1 — THE CONTROL: a flat printed hit fires both §9 reactions", () => {
  for (const seed of SEEDS) {
    it(`Knuckle Punch (20, no effect text) recoils AND Burns (seed ${seed})`, () => {
      // The attribution control (D214's rule): this attack's damage is folded by
      // `attack.ts` itself, so it exercises the SAME fixture wiring — the Tool,
      // the Ability, the seats — through the path that was never broken. If this
      // board is green and the re-homed ones are red, the fixture is not the
      // suspect.
      const state = board({
        attacker: GURDURR,
        energy: FIGHT,
        count: 3,
        defender: ARMAROUGE,
        seed,
      });
      const { events } = must2(applyAction(state, PUNCH));
      expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 20 });
      expectBothReactions(events, "flat hit");
    });
  }
});

function must2(result: ReturnType<typeof applyAction>): {
  state: GameState;
  events: readonly GameEvent[];
} {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

// ────────────────────────────────────────────────────────────────────────────
describe("§2 — D316's `optional` gate: BOTH arms are damage from an attack", () => {
  for (const seed of SEEDS) {
    it(`the ACCEPTED arm (80) recoils AND Burns (seed ${seed})`, () => {
      const state = board({
        attacker: GURDURR,
        energy: FIGHT,
        count: 3,
        defender: ARMAROUGE,
        seed,
      });
      const parked = must2(applyAction(state, SUPERPOWER));
      // The whole hit is inside the gate — nothing has landed yet.
      expect(count(parked.events, "DAMAGE_DEALT")).toBe(0);
      const done = must2(applyAction(parked.state, YES));
      expect(find(done.events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 80 });
      expectBothReactions(done.events, "optional YES");
    });

    it(`the DECLINED arm (50) recoils AND Burns (seed ${seed})`, () => {
      const state = board({
        attacker: GURDURR,
        energy: FIGHT,
        count: 3,
        defender: ARMAROUGE,
        seed,
      });
      const parked = must2(applyAction(state, SUPERPOWER));
      const done = must2(applyAction(parked.state, NO));
      expect(find(done.events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 50 });
      expectBothReactions(done.events, "optional NO");
    });
  }

  it("🛑 the recoil lands ONCE, not once per gate arm", () => {
    const state = board({ attacker: GURDURR, energy: FIGHT, count: 3, defender: ARMAROUGE });
    const done = must2(applyAction(must2(applyAction(state, SUPERPOWER)).state, YES));
    expect(
      done.events.filter((e) => e.type === "COUNTERS_PLACED" && e.source === "counterattack"),
    ).toHaveLength(1);
    expect(
      done.events.filter((e) => e.type === "ABILITY_TRIGGERED" && e.ability === "Scorching Armor"),
    ).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("§3 — D317's `conditionGate`: both sides of the board condition", () => {
  for (const seed of SEEDS) {
    it(`the NO arm (140, a Basic defender) recoils AND Burns (seed ${seed})`, () => {
      // Armarouge is a Basic, so `opponentActiveIsEvolution` is FALSE and the
      // gate's `otherwise` arm deals the bare printed base — the arm D317's own
      // doc block calls out as the one that "did not exist before".
      const state = board({ attacker: OGERPON, energy: FIRE, count: 3, defender: ARMAROUGE, seed });
      const { events } = must2(applyAction(state, BLAZE));
      expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 140 });
      expectBothReactions(events, "conditionGate NO");
    });

    it(`the YES arm (280, an Evolution defender) recoils (seed ${seed})`, () => {
      // The Evolution body carries no Ability, so this board drives the RECOIL
      // half alone — which is exactly the half a Tool can grant to any body.
      const state = board({ attacker: OGERPON, energy: FIRE, count: 3, defender: EVOLVED, seed });
      const { events } = must2(applyAction(state, BLAZE));
      expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 280 });
      expect(recoil(events), "conditionGate YES: Rocky Helmet's recoil").toMatchObject({
        seat: "p1",
        amount: 20,
      });
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
describe("§4 — D317's `coinFlipGate`: both faces of one flip", () => {
  function leaf(seed: number) {
    const state = board({ attacker: FLORAGATO, energy: GRASS, count: 2, defender: ARMAROUGE, seed });
    const { events } = must2(applyAction(state, LEAF));
    return {
      face: find(events, "ATTACK_EFFECT_COIN_FLIP")?.result,
      dealt: find(events, "DAMAGE_DEALT")?.dealt,
      events,
    };
  }

  it("🛑 BOTH faces are reached across the seed sweep — neither arm is dead", () => {
    expect(new Set(COIN_SEEDS.map((seed) => leaf(seed).face))).toEqual(
      new Set(["heads", "tails"]),
    );
  });

  for (const seed of COIN_SEEDS) {
    it(`the flip's arm recoils AND Burns (seed ${seed})`, () => {
      const run = leaf(seed);
      expect(run.dealt, `seed ${seed} ${run.face}`).toBe(run.face === "heads" ? 60 : 30);
      expectBothReactions(run.events, `coinFlipGate ${run.face}`);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
describe("§5 — 'even if this Pokémon is Knocked Out' survives the re-homing too", () => {
  for (const seed of SEEDS) {
    it(`🛑 a LETHAL re-homed hit still recoils and still Burns, before the §8.1 sweep (seed ${seed})`, () => {
      // Armarouge pre-damaged to 380 of its (local) 400: the gate's NO arm alone
      // is 140, so this hit is lethal on the deterministic board. Both reactions
      // are seeded at the DAMAGE and the sweep is the `attackEpilogue` queued
      // behind them, so the dying holder still answers — which is the whole of
      // what the printed parenthetical buys, carried across the re-homing.
      let state = board({ attacker: OGERPON, energy: FIRE, count: 3, defender: ARMAROUGE, seed });
      state = setDamage(state, "p2", 380);
      const { events } = must2(applyAction(state, BLAZE));
      expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 140 });
      expectBothReactions(events, "lethal conditionGate NO");
      expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
      const order = events.map((e) => e.type);
      expect(order.indexOf("STATUS_APPLIED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
describe("§6 — the boundary: no damage, no reaction", () => {
  it("a PREVENTED-to-zero board is not 'damaged by an attack'", () => {
    // The Helmet holder is the 60 HP filler with no shield, so the honest
    // boundary here is the one the engine already owns: an attack that puts the
    // defender's `dealt` at 0 seeds nothing. Ogerpon's Ember into a defender with
    // no Helmet at all is the negative control for the fixture, and the
    // no-Helmet/no-Ability board is the negative control for the reaction.
    const state = board({
      attacker: OGERPON,
      energy: FIRE,
      count: 3,
      defender: EVOLVED,
      helmet: false,
    });
    const { events } = must2(applyAction(state, BLAZE));
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 280 });
    expect(recoil(events)).toBeUndefined();
    expect(burned(events)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("🆕🆕 §6 (D456) — the INSTALLED half of the recoil, through this same funnel", () => {
  // 🛑 **THIS SECTION EXISTS BECAUSE A MUTANT HAD NOWHERE TO DIE.** The header of
  // this file lists *"D152's installed half"* among the reactions the re-homed hit
  // used to walk past — and every board in §2–§5 drives the CATALOG half (Rocky
  // Helmet's flat 20) and no board anywhere drove the INSTALLED one through this
  // funnel. That was invisible while `installedRecoilOf` took two arguments and
  // returned a constant; D456 gave it a third (the hit that triggers it), and the
  // mutant *"the interpreter's funnel passes 0"* would have SURVIVED the whole
  // suite. **A row on one call site is not coverage of the function** — D455's
  // finding about `shuffleDeck`, one function over and one slice later.
  //
  // ⚠️ THE RECORD IS WRITTEN BY SURGERY, and that is a smaller claim than §2–§5's:
  // it drives the READ site, not the install. The install is driven end to end in
  // `installedRecoil.test.ts`, where the armer is a real declaration. What only this
  // file can drive is the re-homed route, because the three re-homing cards live in
  // ITS deck and adding one to a shared `*_DECK` would reshuffle every seeded board
  // in the suite that owns it (D412's rule).
  function armScaledOn(state: GameState, seat: Seat): GameState {
    const side = state.players[seat];
    const body = side.active;
    if (body === null) throw new Error(`${seat} has no Active`);
    return {
      ...state,
      players: {
        ...state.players,
        [seat]: {
          ...side,
          active: {
            ...body,
            installedRecoil: { turn: state.turn, amount: 0, ofDamageTaken: true },
          },
        },
      },
    };
  }

  for (const [label, defender, expected] of [
    ["the NO arm, a Basic defender", ARMAROUGE, 140],
    ["the YES arm, an Evolution defender", EVOLVED, 280],
  ] as const) {
    it(`${label} — the retaliation is the RE-HOMED hit's own number`, () => {
      const state = armScaledOn(
        board({ attacker: OGERPON, energy: FIRE, count: 3, defender }),
        "p2",
      );
      const { events } = must2(applyAction(state, BLAZE));
      expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: expected });
      // The installed half is the hit itself; Rocky Helmet's 20 is summed into the
      // same row, exactly as it is at `attack.ts`'s site (D141: ONE row, MECHANISM
      // label, no provenance surviving the addition).
      expect(recoil(events), label).toMatchObject({ seat: "p1", amount: expected + 20 });
      // ⚠️ COUNTED BY `source`, NOT BY TYPE. The Armarouge board also Burns the
      // attacker, and the Burn's Checkup files its own `COUNTERS_PLACED` at the turn
      // boundary — so a bare type count says 2 on one board and 1 on the other and
      // would be measuring the Ability rather than the recoil.
      expect(
        events.filter((e) => e.type === "COUNTERS_PLACED" && e.source === "counterattack"),
        label,
      ).toHaveLength(1);
    });
  }

  it("🛑 the CONTROL on the same axis — a FLAT installed record is unmoved by the hit", () => {
    // D424's rule: an assertion that the amount FOLLOWS the hit is worth nothing
    // without one showing it does not follow when the record does not say so. Same
    // board, same 280, a flat 50 record.
    let state = board({ attacker: OGERPON, energy: FIRE, count: 3, defender: EVOLVED });
    const side = state.players.p2;
    const body = side.active;
    if (body === null) throw new Error("p2 has no Active");
    state = {
      ...state,
      players: {
        ...state.players,
        p2: { ...side, active: { ...body, installedRecoil: { turn: state.turn, amount: 50 } } },
      },
    };
    const { events } = must2(applyAction(state, BLAZE));
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 280 });
    expect(recoil(events)).toMatchObject({ seat: "p1", amount: 50 + 20 });
  });
});
