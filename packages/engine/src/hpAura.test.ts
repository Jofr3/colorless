import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { effectiveMaxHp, seatMaxHpBonus } from "./continuous";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  setPrizes,
  trainerCard,
  must,
  driveSetup,
} from "./testFixtures";

const LUDICOLO = "sv09-037";
const LIVELY = "sv08-180";
const GRAVITY = "sv08-177";
const GRAVITY_R = "sv08-250";
const CAPE = "sv05-152";
const WEIGHT = "sv10-162";
/** Bravery Charm — the Basic-ONLY +50, and the control that makes Hero's Cape's
    missing stage clause observable rather than merely declared. */
const CHARM = "sv02-173";
const TING_LU = "sv02-127";

/** A plain 60-HP Basic with no Ability — every "the aura reaches a teammate"
    assertion is about THIS body, so a bonus that leaked from its own card would
    be invisible. */
const TEAMMATE = "fix-basic-1";
/** A 90-HP Stage 1 evolving from `fix-basic-1` — the STAGE control that
    separates Bravery Charm from Hero's Cape across one evolution, and the body
    that proves Lively Stadium's Basic clause is read. */
const STAGE1 = "fix-stage1";
const TINY_STAGE2 = "fix-tiny-stage2";
const CYNTHIAS = "fix-cynthias-basic";

const LOCAL_CARDS: Record<string, Card> = {
  [LUDICOLO]: battler(LUDICOLO, {
    name: "Ludicolo",
    hp: 140,
    retreat: 2,
    types: ["Water"],
    stage: "Stage2",
    evolveFrom: "Lombre",
    attacks: [{ cost: ["Water", "Water", "Colorless"], name: "Hydro Splash", damage: 130 }],
    abilities: [
      {
        type: "Ability",
        name: "Vibrant Dance",
        effect:
          "All of your Pokémon in play get +40 HP. The effect of Vibrant Dance doesn't stack.",
      },
    ],
  }),
  [LIVELY]: trainerCard(
    LIVELY,
    "Stadium",
    "Each Basic Pokémon in play (both yours and your opponent's) gets +30 HP.",
  ),
  [GRAVITY]: trainerCard(
    GRAVITY,
    "Stadium",
    "Each Stage 2 Pokémon in play (both yours and your opponent's) gets -30 HP.",
  ),
  [GRAVITY_R]: trainerCard(
    GRAVITY_R,
    "Stadium",
    "Each Stage 2 Pokémon in play (both yours and your opponent's) gets -30 HP.",
  ),
  [CAPE]: trainerCard(CAPE, "Tool", "The Pokémon this card is attached to gets +100 HP."),
  [WEIGHT]: trainerCard(
    WEIGHT,
    "Tool",
    "The Cynthia's Pokémon this card is attached to gets +70 HP.",
  ),
  [TINY_STAGE2]: battler(TINY_STAGE2, {
    name: "Tiny Stage 2",
    hp: 20,
    stage: "Stage2",
    evolveFrom: "Nothing",
  }),
  [CYNTHIAS]: battler(CYNTHIAS, { name: "Cynthia's Tester", hp: 60 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const HP_DECK = deckOf({
  [LUDICOLO]: 4,
  [LIVELY]: 3,
  [GRAVITY]: 3,
  [GRAVITY_R]: 2,
  [CAPE]: 4,
  [WEIGHT]: 6,
  [CHARM]: 4,
  [TING_LU]: 3,
  [TINY_STAGE2]: 3,
  [CYNTHIAS]: 3,
  [TEAMMATE]: 8,
  [STAGE1]: 6,
  "fix-sniper": 4,
  "fix-energy": 7,
});

const SEEDS = [8101, 8111, 8117] as const;

function localSetup(seed: number): GameState {
  return driveSetup(seed, { p1: HP_DECK, p2: HP_DECK }, { pool: POOL, first: "p1" });
}

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
  state = clearBench(setActiveFromDeck(state, "p1", opts.p1Active ?? TEAMMATE), "p1");
  for (const id of opts.p1Bench ?? [TEAMMATE]) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", opts.p2Active ?? TEAMMATE), "p2");
  for (const id of opts.p2Bench ?? [TEAMMATE]) state = benchFromDeck(state, "p2", id);
  for (let i = 0; i < 12; i += 1) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    if (state.phase.seat === "p1" && state.turn >= 3) break;
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  return state;
}

function playStadium(state: GameState, seat: Seat, stadiumId: string): GameState {
  const next = handFromDeck(state, seat, stadiumId, 1);
  return must(
    applyAction(next, { type: "playTrainer", seat, uid: handUid(next, seat, stadiumId) }),
  );
}

/** `playStadium` with the EVENTS kept — §7's Knock-Out rows are the whole
    observation there, and the state-only helper above throws them away. */
function playStadiumWith(
  state: GameState,
  seat: Seat,
  stadiumId: string,
): { state: GameState; events: readonly GameEvent[] } {
  const next = handFromDeck(state, seat, stadiumId, 1);
  const result = applyAction(next, {
    type: "playTrainer",
    seat,
    uid: handUid(next, seat, stadiumId),
  });
  if (!result.ok) throw new Error(`playTrainer failed: ${result.error.code}`);
  return { state: result.state, events: result.events };
}

/** Attach `toolId` from `seat`'s hand to a spot — the same argument as
    `playStadium` one function up, on the other persistent zone. */
function attachTool(
  state: GameState,
  seat: Seat,
  toolId: string,
  target: { spot: "active" } | { spot: "bench"; index: number },
): GameState {
  const next = handFromDeck(state, seat, toolId, 1);
  return must(
    applyAction(next, { type: "attachTool", seat, uid: handUid(next, seat, toolId), target }),
  );
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

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE SIX REGISTRY ROWS — and what each one is NOT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D324 §1 — the six registry rows", () => {
  it("Vibrant Dance authors THREE clauses and deliberately not a fourth", () => {
    expect(programFor(LUDICOLO)?.passive).toEqual({
      seatHpBonus: { ability: "Vibrant Dance", amount: 40, noStack: true },
    });
    expect(programFor(LUDICOLO)?.passive?.seatHpBonus?.amount).toBe(40);
    // NOT a `hpBonus`: that field is folded out of the body's OWN sources, and
    // "all of your Pokémon in play" is a fact about a DIFFERENT body.
    expect(programFor(LUDICOLO)?.passive?.hpBonus).toBeUndefined();
    // NOT a `basicHpBonus`: the sentence prints no stage word at all, so a build
    // that reused Bravery Charm's field would have paid nothing to a Stage 1 or 2
    // teammate and been green on any board made only of Basics.
    expect(programFor(LUDICOLO)?.passive?.basicHpBonus).toBeUndefined();
    expect(programFor(LUDICOLO)?.triggered).toBeUndefined();
    expect(programFor(LUDICOLO)?.stadium).toBeUndefined();
  });

  it("the two Stadiums are ONE signed field, and the reprint SHARES the object", () => {
    expect(programFor(LIVELY)?.stadium).toEqual({ hpDelta: { amount: 30, stage: "basic" } });
    expect(programFor(GRAVITY)?.stadium).toEqual({ hpDelta: { amount: -30, stage: "stage2" } });
    expect(programFor(GRAVITY)?.stadium?.hpDelta?.amount).toBeLessThan(0);
    expect(programFor(LIVELY)?.stadium?.hpDelta?.amount).toBeGreaterThan(0);
    expect(programFor(LIVELY)?.stadium?.hpDelta?.stage).not.toBe(
      programFor(GRAVITY)?.stadium?.hpDelta?.stage,
    );
    expect(programFor(GRAVITY_R)).toBe(programFor(GRAVITY));
    // Neither is an Ability or a passive: no §9 gate can reach them (§6).
    expect(programFor(LIVELY)?.passive).toBeUndefined();
    expect(programFor(GRAVITY)?.passive).toBeUndefined();
  });

  it("the two Tools are STAGE-FREE, which is the whole of what separates them from Bravery Charm", () => {
    expect(programFor(CAPE)?.passive).toEqual({ hpBonus: { amount: 100 } });
    expect(programFor(WEIGHT)?.passive).toEqual({
      hpBonus: { amount: 70, beneficiary: { kind: "ownerPokemon", owner: "Cynthia" } },
    });
    expect(programFor(CAPE)?.passive?.basicHpBonus).toBeUndefined();
    expect(programFor(CHARM)?.passive).toEqual({ basicHpBonus: 50 });
    expect(programFor(CHARM)?.passive?.hpBonus).toBeUndefined();
    // Hero's Cape carries NO beneficiary — the sentence names no owner, and a
    // filter here would silently narrow a clause that narrows nothing.
    expect(programFor(CAPE)?.passive?.hpBonus?.beneficiary).toBeUndefined();
    // The owner is "Cynthia" and NOT "Cynthia's" — `matchesFilter`'s
    // `ownerPokemon` arm appends the possessive and the space itself.
    expect(programFor(WEIGHT)?.passive?.hpBonus?.beneficiary).toEqual({
      kind: "ownerPokemon",
      owner: "Cynthia",
    });
  });

  it("no OTHER card in the registry carries the three new fields — the closure claim", () => {
    const seatHolders: string[] = [];
    const toolHolders: string[] = [];
    const stadiumHolders: string[] = [];
    for (const id of Object.keys(POOL)) {
      const program = programFor(id);
      if (program?.passive?.seatHpBonus !== undefined) seatHolders.push(id);
      if (program?.passive?.hpBonus !== undefined) toolHolders.push(id);
      if (program?.stadium?.hpDelta !== undefined) stadiumHolders.push(id);
    }
    expect(seatHolders).toEqual([LUDICOLO]);
    expect(toolHolders.sort()).toEqual([CAPE, WEIGHT].sort());
    expect(stadiumHolders.sort()).toEqual([GRAVITY, LIVELY, GRAVITY_R].sort());
  });
});

describe("D324 §2 — Vibrant Dance: +40 to ALL of your Pokémon in play", () => {
  it.each(SEEDS)("raises the holder AND every teammate, and nothing opposite (seed %i)", (seed) => {
    const state = board(seed, {
      p1Active: LUDICOLO,
      p1Bench: [TEAMMATE, STAGE1],
      p2Active: TEAMMATE,
      p2Bench: [TEAMMATE],
    });
    expect(activeMaxHp(state, "p1")).toBe(180);
    // …and it is genuinely SEAT-WIDE rather than Active-only: the bench pays too,
    // at BOTH stages, which is what refuses a `basicHpBonus`-shaped build.
    expect(benchMaxHp(state, "p1", 0)).toBe(100); // fix-basic-1: 60 + 40
    expect(benchMaxHp(state, "p1", 1)).toBe(130); // fix-stage1: 90 + 40 — NOT Basic
    // The opponent is untouched — "YOUR Pokémon", and the scan returns on the
    // first side holding the uid.
    expect(activeMaxHp(state, "p2")).toBe(60);
    expect(benchMaxHp(state, "p2", 0)).toBe(60);
    // …and the scan itself says ZERO on that side, so the 60 above is a real
    // absence rather than a printed HP that happens to match.
    const p2Active = state.players.p2.active;
    if (p2Active === null) throw new Error("unreachable");
    expect(seatMaxHpBonus(state, p2Active)).toBe(0);
  });

  it("a BENCHED Ludicolo pays the whole side — the source's own spot is not a clause", () => {
    const state = board(SEEDS[0], {
      p1Active: TEAMMATE,
      p1Bench: [LUDICOLO, STAGE1],
      p2Active: TEAMMATE,
    });
    expect(activeMaxHp(state, "p1")).toBe(100);
    expect(benchMaxHp(state, "p1", 0)).toBe(180); // the Ludicolo itself
    expect(benchMaxHp(state, "p1", 1)).toBe(130);
    expect(activeMaxHp(state, "p2")).toBe(60);
  });

  it("no Ludicolo in play is ZERO and not a default — the scan's negative control", () => {
    const state = board(SEEDS[0], { p1Active: STAGE1, p1Bench: [TEAMMATE] });
    const active = state.players.p1.active;
    if (active === null) throw new Error("unreachable");
    expect(seatMaxHpBonus(state, active)).toBe(0);
    expect(activeMaxHp(state, "p1")).toBe(90); // printed only
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. "THE EFFECT OF VIBRANT DANCE DOESN'T STACK" — the sixth of six.
// ─────────────────────────────────────────────────────────────────────────────

describe("D324 §3 — the cap, and it is a LEDGER rather than a flag", () => {
  it.each(SEEDS)("TWO Ludicolo give +40 and not +80 (seed %i)", (seed) => {
    const state = board(seed, {
      p1Active: LUDICOLO,
      p1Bench: [LUDICOLO, TEAMMATE],
      p2Active: TEAMMATE,
    });
    expect(activeMaxHp(state, "p1")).toBe(180);
    expect(benchMaxHp(state, "p1", 0)).toBe(180);
    expect(benchMaxHp(state, "p1", 1)).toBe(100);
  });

  it("THREE Ludicolo is still +40 — the ledger is keyed, not decremented", () => {
    const state = board(SEEDS[0], {
      p1Active: LUDICOLO,
      p1Bench: [LUDICOLO, LUDICOLO, TEAMMATE],
    });
    expect(activeMaxHp(state, "p1")).toBe(180);
    expect(benchMaxHp(state, "p1", 2)).toBe(100);
  });

  it("the cap is keyed on the printed ABILITY NAME — the claim, stated as arithmetic", () => {
    expect(programFor(LUDICOLO)?.passive?.seatHpBonus?.ability).toBe("Vibrant Dance");
    expect(programFor(LUDICOLO)?.passive?.seatHpBonus?.noStack).toBe(true);
  });

  it("the *doesn't stack* row is CLOSED at SIX OF SIX", () => {
    expect(programFor("sv07-119")?.passive?.seatDamageReductionAfterWR?.noStack).toBe("Curly Wall");
    expect(programFor("svp-136")?.passive?.seatDamageReductionAfterWR?.noStack).toBe("Curly Wall");
    expect(programFor("sv10-086")?.passive?.seatDamageReductionAfterWR?.noStack).toBe(
      "Stone Palace",
    );
    expect(programFor("sv09-117")?.passive?.seatDamageBonusBeforeWR?.noStack).toBe(
      "Extra Helpings",
    );
    expect(programFor("svp-184")?.passive?.seatDamageBonusBeforeWR?.noStack).toBe("Extra Helpings");
    expect(programFor("sv10-074")?.triggered?.[0]?.doesNotStack).toBe(true);
    expect(programFor("sv08-072")?.passive?.koPrizeBonus?.noStack).toBe(true);
    expect(programFor(LUDICOLO)?.passive?.seatHpBonus?.noStack).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. §9 — an Ability-lock takes the aura off the WHOLE SIDE at once.
// ─────────────────────────────────────────────────────────────────────────────

describe("D324 §4 — the lock, and it reaches bodies the lock's own clause cannot", () => {
  it("Cursed Land over a DAMAGED ACTIVE Ludicolo removes +40 from the bench too", () => {
    let state = board(SEEDS[0], {
      p1Active: TING_LU,
      p2Active: LUDICOLO,
      p2Bench: [TEAMMATE, STAGE1],
    });
    // Undamaged: Cursed Land's `requiresDamage` rider refuses, so the aura stands.
    expect(activeMaxHp(state, "p2")).toBe(180);
    expect(benchMaxHp(state, "p2", 0)).toBe(100);
    state = setDamage(state, "p2", 10);
    expect(activeMaxHp(state, "p2")).toBe(140); // printed only
    expect(benchMaxHp(state, "p2", 0)).toBe(60);
    expect(benchMaxHp(state, "p2", 1)).toBe(90);
    // P1's own side is unaffected in both directions — the lock is one-way.
    expect(activeMaxHp(state, "p1")).toBe(POOL[TING_LU]?.hp ?? 0);
  });

  it("the gate is on the SOURCE's uid and not on the BENEFICIARY's", () => {
    let state = board(SEEDS[0], {
      p1Active: TING_LU,
      p2Active: TEAMMATE,
      p2Bench: [LUDICOLO],
    });
    state = setDamage(state, "p2", 10);
    expect(activeMaxHp(state, "p2")).toBe(100);
    expect(benchMaxHp(state, "p2", 0)).toBe(180);
    // …and damaging the SOURCE is what actually switches it off, at the same spot.
    state = setBenchDamage(state, "p2", 0, 10);
    expect(activeMaxHp(state, "p2")).toBe(60);
    expect(benchMaxHp(state, "p2", 0)).toBe(140);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE STADIUM — both sides, one stage, and the SIGN.
// ─────────────────────────────────────────────────────────────────────────────

describe("D324 §5 — Lively Stadium and Gravity Mountain are each other's control", () => {
  it.each(SEEDS)("Lively Stadium gives +30 to EVERY Basic, both sides (seed %i)", (seed) => {
    let state = board(seed, {
      p1Active: TEAMMATE,
      p1Bench: [STAGE1],
      p2Active: TEAMMATE,
      p2Bench: [STAGE1],
    });
    expect(activeMaxHp(state, "p1")).toBe(60);
    state = playStadium(state, "p1", LIVELY);
    expect(activeMaxHp(state, "p1")).toBe(90);
    expect(activeMaxHp(state, "p2")).toBe(90);
    // …and the STAGE clause is read: a Stage 1 gets nothing from a Basic-only
    // sentence, on either side.
    expect(benchMaxHp(state, "p1", 0)).toBe(90); // fix-stage1's printed 90, unchanged
    expect(benchMaxHp(state, "p2", 0)).toBe(90);
  });

  it.each(SEEDS)("Gravity Mountain takes 30 off every STAGE 2, both sides (seed %i)", (seed) => {
    let state = board(seed, {
      p1Active: LUDICOLO,
      p1Bench: [TEAMMATE],
      p2Active: LUDICOLO,
      p2Bench: [STAGE1],
    });
    // Both Ludicolo pay their OWN side, so the two Actives start level and the
    // Stadium's effect is the DELTA rather than the difference between them.
    expect(activeMaxHp(state, "p1")).toBe(180);
    expect(activeMaxHp(state, "p2")).toBe(180);
    state = playStadium(state, "p1", GRAVITY);
    expect(activeMaxHp(state, "p1")).toBe(150); // 140 + 40 aura − 30 stadium
    expect(activeMaxHp(state, "p2")).toBe(150);
    // A Basic and a Stage 1 are untouched by a Stage-2-only sentence — the STAGE
    // control that the sign alone could not provide.
    expect(benchMaxHp(state, "p1", 0)).toBe(100); // 60 + 40 aura, no stadium term
    expect(benchMaxHp(state, "p2", 0)).toBe(130); // 90 + 40 aura, no stadium term
  });

  it("the reprint behaves identically — 2 printings, 1 sentence, 1 object", () => {
    let state = board(SEEDS[0], { p1Active: LUDICOLO, p2Active: LUDICOLO });
    state = playStadium(state, "p1", GRAVITY_R);
    expect(activeMaxHp(state, "p1")).toBe(150);
    expect(activeMaxHp(state, "p2")).toBe(150);
  });

  it("replacing the Stadium replaces the term — nothing is stamped", () => {
    let state = board(SEEDS[0], { p1Active: TEAMMATE, p2Active: TEAMMATE });
    state = playStadium(state, "p1", LIVELY);
    expect(activeMaxHp(state, "p1")).toBe(90);
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = playStadium(state, "p1", GRAVITY);
    expect(activeMaxHp(state, "p1")).toBe(60); // Basic: the Stage-2 sentence says nothing
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE §9 ASYMMETRY — one board, two sources, opposite answers.
// ─────────────────────────────────────────────────────────────────────────────

describe("D324 §6 — a Stadium is not an Ability, and the lock proves it", () => {
  it("Cursed Land silences Vibrant Dance and leaves Gravity Mountain running", () => {
    let state = board(SEEDS[0], {
      p1Active: TING_LU,
      p2Active: LUDICOLO,
      p2Bench: [TEAMMATE],
    });
    state = playStadium(state, "p1", GRAVITY);
    expect(activeMaxHp(state, "p2")).toBe(150); // 140 + 40 − 30
    state = setDamage(state, "p2", 10);
    expect(activeMaxHp(state, "p2")).toBe(110); // 140 + 0 − 30
    expect(benchMaxHp(state, "p2", 0)).toBe(60); // the aura is gone from the bench too
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. THE TOOLS — and the evolution that separates them.
// ─────────────────────────────────────────────────────────────────────────────

describe("D324 §7 — Hero's Cape vs Bravery Charm across ONE evolution", () => {
  it("both pay a Basic; only Hero's Cape survives the evolution", () => {
    let state = board(SEEDS[0], { p1Active: TEAMMATE, p1Bench: [TEAMMATE] });
    state = attachTool(state, "p1", CHARM, { spot: "active" });
    state = attachTool(state, "p1", CAPE, { spot: "bench", index: 0 });
    expect(activeMaxHp(state, "p1")).toBe(110); // 60 + 50, Basic-only
    expect(benchMaxHp(state, "p1", 0)).toBe(160); // 60 + 100, stage-free
    // Evolve BOTH, carrying both Tools (§10).
    state = handFromDeck(state, "p1", STAGE1, 2);
    const [first, second] = state.players.p1.hand.filter(
      (uid) => state.cardIdByUid[uid] === STAGE1,
    );
    state = must(
      applyAction(state, {
        type: "evolve",
        seat: "p1",
        uid: first as string,
        target: { spot: "active" },
      }),
    );
    state = must(
      applyAction(state, {
        type: "evolve",
        seat: "p1",
        uid: second as string,
        target: { spot: "bench", index: 0 },
      }),
    );
    expect(state.players.p1.active?.tools.length).toBe(1);
    expect(activeMaxHp(state, "p1")).toBe(90); // fix-stage1 printed, Charm inert
    expect(benchMaxHp(state, "p1", 0)).toBe(190); // 90 + 100, Cape still paying
  });

  it("Cynthia's Power Weight reads the HOLDER's name — both directions", () => {
    let state = board(SEEDS[0], { p1Active: CYNTHIAS, p1Bench: [TEAMMATE] });
    state = attachTool(state, "p1", WEIGHT, { spot: "active" });
    state = attachTool(state, "p1", WEIGHT, { spot: "bench", index: 0 });
    // The POSITIVE case and its control differ in the NAME and in nothing else —
    // both 60-HP Basics, both holding the same Tool.
    expect(activeMaxHp(state, "p1")).toBe(130); // "Cynthia's Tester": 60 + 70
    expect(benchMaxHp(state, "p1", 0)).toBe(60); // "fix-basic-1": filtered out
  });

  it("a NON-lethal drop leaves the turn exactly where it was", () => {
    let state = board(SEEDS[0], { p1Active: LUDICOLO, p2Active: TEAMMATE });
    state = setDamage(state, "p1", 130); // 140 printed + 40 aura = 180: alive
    expect(activeMaxHp(state, "p1")).toBe(180);
    state = playStadium(state, "p1", GRAVITY);
    // 150 effective against 130 damage — still alive, so nothing is swept and the
    // actor is still in turn:action with the Stadium down.
    expect(activeMaxHp(state, "p1")).toBe(150);
    expect(state.players.p1.active?.damage).toBe(130);
    expect(state.phase.kind).toBe("turn:action");
  });

  it("a LETHAL drop Knocks the body Out ON THE PLAY, not at the next Checkup", () => {
    let state = board(SEEDS[0], { p1Active: LUDICOLO, p2Active: TEAMMATE });
    state = setDamage(state, "p1", 160);
    expect(activeMaxHp(state, "p1")).toBe(180);
    const played = playStadiumWith(state, "p1", GRAVITY);
    expect(played.events.some((e) => e.type === "KNOCKED_OUT" && e.seat === "p1")).toBe(true);
    // The KO's decisions interrupt the actor's own turn: the OPPONENT takes the
    // prize, and `resumeTurn` hands P1 back their turn:action afterwards.
    expect(played.state.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p2" });
  });

  it("the sweep covers BOTH boards — a Stadium's clause names both seats", () => {
    let state = board(SEEDS[0], { p1Active: TEAMMATE, p2Active: LUDICOLO, p2Bench: [TEAMMATE] });
    state = setDamage(state, "p2", 160); // 140 printed + its OWN 40 aura = 180: alive
    expect(activeMaxHp(state, "p2")).toBe(180);
    const played = playStadiumWith(state, "p1", GRAVITY);
    expect(played.events.some((e) => e.type === "KNOCKED_OUT" && e.seat === "p2")).toBe(true);
    expect(played.state.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p1" });
  });

  it("the KO CASCADES — killing the aura's SOURCE can kill its teammates", () => {
    let state = board(SEEDS[0], {
      p1Active: LUDICOLO,
      p1Bench: [TEAMMATE, TEAMMATE],
      p2Active: TEAMMATE,
    });
    state = setDamage(state, "p1", 160);
    state = setBenchDamage(state, "p1", 0, 70);
    expect(activeMaxHp(state, "p1")).toBe(180);
    expect(benchMaxHp(state, "p1", 0)).toBe(100); // alive while the aura pays
    const played = playStadiumWith(state, "p1", GRAVITY);
    const koed = played.events.filter((e) => e.type === "KNOCKED_OUT");
    expect(koed).toHaveLength(2);
    // Both Knock Outs are in the SAME batch, so P2 is owed TWO prize stages (one
    // per body, §8.1 grouping prizes-first) and parks on the first of them —
    // rather than one KO landing and a lethal body being left standing.
    expect(played.state.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    expect(played.state.players.p1.bench).toHaveLength(1);
    expect(benchMaxHp(played.state, "p1", 0)).toBe(60); // the aura is gone
  });

  it("…and a teammate that stays under its REDUCED maximum does not cascade", () => {
    let state = board(SEEDS[0], {
      p1Active: LUDICOLO,
      p1Bench: [TEAMMATE, TEAMMATE],
      p2Active: TEAMMATE,
    });
    state = setDamage(state, "p1", 160);
    state = setBenchDamage(state, "p1", 0, 50);
    const played = playStadiumWith(state, "p1", GRAVITY);
    expect(played.events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(1);
    expect(played.state.players.p1.bench).toHaveLength(2);
  });

  it("a REPLACEMENT sweeps too — the delta that leaves is a drop as well", () => {
    let state = board(SEEDS[0], { p1Active: TEAMMATE, p2Active: TEAMMATE });
    state = playStadium(state, "p1", LIVELY);
    expect(activeMaxHp(state, "p1")).toBe(90); // 60 printed + 30
    state = setDamage(state, "p1", 80);
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    const played = playStadiumWith(state, "p1", GRAVITY);
    expect(played.events.some((e) => e.type === "STADIUM_DISCARDED")).toBe(true);
    expect(played.events.some((e) => e.type === "KNOCKED_OUT" && e.seat === "p1")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. THE FLOOR — the invariant a DELETED branch depends on.
// ─────────────────────────────────────────────────────────────────────────────

describe("D324 §8 — effectiveMaxHp never returns a non-positive number", () => {
  it("a 20-HP Stage 2 under Gravity Mountain clamps to 10 rather than going negative", () => {
    let state = board(SEEDS[0], { p1Active: TINY_STAGE2, p2Active: TEAMMATE });
    expect(activeMaxHp(state, "p1")).toBe(20);
    state = playStadium(state, "p1", GRAVITY);
    expect(activeMaxHp(state, "p1")).toBe(10);
  });

  it("the aura lifts the same body back off the floor — the clamp is not a constant", () => {
    let state = board(SEEDS[0], { p1Active: TINY_STAGE2, p1Bench: [LUDICOLO] });
    state = playStadium(state, "p1", GRAVITY);
    expect(activeMaxHp(state, "p1")).toBe(30); // 20 + 40 − 30, above the floor
  });

  it("the floor is UNREACHABLE on a legal printing, and the fixture says so", () => {
    expect(POOL[TINY_STAGE2]?.hp).toBe(20);
    expect(POOL[TINY_STAGE2]?.stage).toBe("Stage2");
    expect(POOL[LUDICOLO]?.hp).toBe(140); // the smallest Stage 2 this file holds
  });

  it("BOTH data gaps stay null — and they are TWO early returns, not one", () => {
    const state = board(SEEDS[0], { p1Active: TEAMMATE });
    const active = state.players.p1.active;
    if (active === null) throw new Error("unreachable");
    const top = active.stack[active.stack.length - 1] as string;
    // GAP ONE — the uid resolves to no card at all. `topCardOf` returns undefined.
    const unresolvable: GameState = {
      ...state,
      cardIdByUid: { ...state.cardIdByUid, [top]: "fix-no-such-card" },
    };
    expect(effectiveMaxHp(unresolvable, active)).toBeNull();
    const nullHp: GameState = {
      ...state,
      cardIdByUid: { ...state.cardIdByUid, [top]: CAPE },
    };
    expect(POOL[CAPE]?.hp ?? null).toBeNull(); // the premise, asserted not assumed
    expect(effectiveMaxHp(nullHp, active)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. THE READ SITE — every term sums at ONE place, and the KO check sees it.
// ─────────────────────────────────────────────────────────────────────────────

describe("D324 §9 — the four sources sum, and a real KO reads the total", () => {
  it("aura + stadium + tool + printed, all on one Basic", () => {
    let state = board(SEEDS[0], { p1Active: TEAMMATE, p1Bench: [LUDICOLO] });
    expect(activeMaxHp(state, "p1")).toBe(100); // 60 + 40 aura
    state = playStadium(state, "p1", LIVELY);
    expect(activeMaxHp(state, "p1")).toBe(130); // + 30 stadium (Basic)
    state = attachTool(state, "p1", CAPE, { spot: "active" });
    expect(activeMaxHp(state, "p1")).toBe(230);
    const second = handFromDeck(state, "p1", CHARM, 1);
    const refused = applyAction(second, {
      type: "attachTool",
      seat: "p1",
      uid: handUid(second, "p1", CHARM),
      target: { spot: "active" },
    });
    expect(refused.ok).toBe(false);
  });

  it("the §8.1 KO check reads the RAISED maximum — a real attack, not a direct call", () => {
    let state = board(SEEDS[0], {
      p1Active: TEAMMATE,
      p2Active: TEAMMATE,
      p2Bench: [TEAMMATE, LUDICOLO],
    });
    // P2's bench Basic sits on a side fielding a Ludicolo: 100 effective, not 60.
    expect(benchMaxHp(state, "p2", 0)).toBe(100);
    state = setBenchDamage(state, "p2", 0, 70);
    // 70 damage on a 100 maximum: ALIVE. On the printed 60 it would already be
    // Knocked Out, and the §8.1 sweep is what says which reading the engine uses.
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.players.p2.bench[0]?.damage).toBe(70);
    expect(benchMaxHp(state, "p2", 0)).toBe(100);
  });
});

describe("D329 §10 — a cascade Knock Out is not 'by damage from an attack'", () => {
  function marks(state: GameState, seat: Seat): { name: string; byAttack: boolean }[] {
    return state.lastKoMarks[seat].map((m) => ({ name: m.name, byAttack: m.byAttack }));
  }

  it("the ATTACK's victim is marked `byAttack`, and the body its aura was holding up is NOT", () => {
    let state = board(SEEDS[0], {
      p1Active: "fix-sniper",
      p2Active: LUDICOLO,
      p2Bench: [TEAMMATE, TEAMMATE],
    });
    state = attachFromDeck(state, "p1", "fix-energy", 1); // pays Spread Shot {C}
    state = setDamage(state, "p2", 150);
    state = setBenchDamage(state, "p2", 0, 55);
    expect(activeMaxHp(state, "p2")).toBe(180);
    expect(benchMaxHp(state, "p2", 0)).toBe(100);
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    if (!result.ok) throw new Error(`attack failed: ${result.error.code}`);
    // THE PREMISE, ASSERTED: the cascade really happened, in ONE batch.
    expect(result.events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(2);
    expect(marks(result.state, "p2")).toEqual([
      { name: "Ludicolo", byAttack: true },
      { name: "fix-basic-1", byAttack: false },
    ]);
  });

  it("…and a MID-TURN cascade marks BOTH halves not-by-attack — the case that agrees", () => {
    let state = board(SEEDS[0], {
      p1Active: TEAMMATE,
      p2Active: LUDICOLO,
      p2Bench: [TEAMMATE, TEAMMATE],
    });
    state = setDamage(state, "p2", 160);
    state = setBenchDamage(state, "p2", 0, 70);
    const played = playStadiumWith(state, "p1", GRAVITY);
    expect(played.events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(2);
    expect(marks(played.state, "p2")).toEqual([
      { name: "Ludicolo", byAttack: false },
      { name: "fix-basic-1", byAttack: false },
    ]);
  });
});

/** Resolve every KO decision the way `checkup.test.ts` does, so what is asserted
    below is the outcome the RULES reach and not the first park on the way. */
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

describe("D329 §11 — the tie guard sees the WHOLE fixed point, not one pass", () => {
  it("both seats take their last Prize in ONE batch, and the second one is a CASCADE", () => {
    let state = board(SEEDS[0], {
      p1Active: LUDICOLO,
      p1Bench: [TEAMMATE, TEAMMATE],
      p2Active: TINY_STAGE2,
      p2Bench: [TEAMMATE],
    });
    state = setDamage(state, "p1", 150);
    state = setDamage(state, "p2", 10);
    state = setBenchDamage(state, "p1", 0, 70);
    state = setPrizes(setPrizes(state, "p1", 1), "p2", 2);
    expect(activeMaxHp(state, "p1")).toBe(180);
    expect(activeMaxHp(state, "p2")).toBe(20);
    expect(benchMaxHp(state, "p1", 0)).toBe(100);
    const played = playStadiumWith(state, "p1", GRAVITY);
    expect(played.events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(3);
    const done = settle(played.state);
    expect(done.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "tie", reasons: { p1: "prizesTaken", p2: "prizesTaken" } },
    });
  });

  it("…and a batch that empties only ONE row is still a win, on the same board", () => {
    let state = board(SEEDS[0], {
      p1Active: LUDICOLO,
      p1Bench: [TEAMMATE, TEAMMATE],
      p2Active: TINY_STAGE2,
      p2Bench: [TEAMMATE],
    });
    state = setDamage(state, "p1", 150);
    state = setDamage(state, "p2", 10);
    state = setBenchDamage(state, "p1", 0, 70);
    state = setPrizes(setPrizes(state, "p1", 1), "p2", 3);
    const played = playStadiumWith(state, "p1", GRAVITY);
    expect(played.events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(3);
    const done = settle(played.state);
    expect(done.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p1", reason: "prizesTaken" },
    });
  });
});
