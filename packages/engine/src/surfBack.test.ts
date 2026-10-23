import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameState, Seat } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  setDamage,
  trainerCard,
  typedEnergy,
  must,
  firstBasicInHand,
  findEvent,
} from "./testFixtures";

const PRINTED = "You may shuffle this Pokémon and all attached cards into your deck.";

/** Index 0's, kept as the control for the index-precision claim. */
const IDX0_PRINTED =
  "If this Pokémon evolved from Gimmighoul during this turn, this attack does 90 more damage.";

const GHOLDENGO = "sv08-131";
const WALL = "fix-d312sb-wall";
const FILLER = "fix-d312sb-filler";
const ENERGY = "fix-d312sb-energy";
const TOOL = "fix-d312sb-tool";

/** Vengeful Punch — the real `sv03-197`, already in `FIXTURE_POOL` and already
    programmed, so §4's board is built out of shipped pieces. */
const VENGEFUL_PUNCH = "sv03-197";

const LOCAL_CARDS: Record<string, Card> = {
  [GHOLDENGO]: battler(GHOLDENGO, {
    name: "Gholdengo",
    hp: 130,
    stage: "Stage1",
    evolveFrom: "Gimmighoul",
    retreat: 2,
    types: ["Metal"],
    attacks: [
      { cost: ["Metal"], name: "Strike It Rich", damage: "30+", effect: IDX0_PRINTED },
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Surf Back",
        damage: 100,
        effect: PRINTED,
      },
    ],
  }),
  // 90 HP — dies to "Surf Back"'s 100 in one hit, which is the board §3 needs.
  [WALL]: battler(WALL, {
    name: "D312 Wall",
    hp: 90,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "D312 Filler",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [TOOL]: trainerCard(TOOL, "Tool", "Attach to 1 of your Pokémon."),
  [ENERGY]: typedEnergy(ENERGY, "Metal"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [GHOLDENGO]: 4,
  [WALL]: 8,
  [FILLER]: 8,
  [TOOL]: 2,
  [VENGEFUL_PUNCH]: 2,
  [ENERGY]: 36,
});

const SEEDS = [3129, 3137] as const;

function apply(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result;
}

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
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

/** TEST SURGERY — three Metal Energy onto p1's Active, enough for "Surf Back". */
function fuel(state: GameState): GameState {
  const side = state.players.p1;
  const body = side.active;
  if (body === null) throw new Error("p1 has no Active");
  const energy = side.deck.filter((u) => state.cardIdByUid[u] === ENERGY).slice(0, 3);
  if (energy.length < 3) throw new Error("deck lacks three energy");
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

/** A board with the Gholdengo Active for p1 on p1's turn, `bench` filler bodies
    behind it, and `defenderHp`-worth of Wall standing opposite. */
function board(opts: {
  bench: number;
  seed?: number;
  defender?: string;
  defenderDamage?: number;
  defenderTool?: string;
  p2Bench?: number;
}): GameState {
  let state = localSetup(opts.seed ?? SEEDS[0], "p2");
  state = setActiveFromDeck(state, "p2", opts.defender ?? WALL);
  state = clearBench(state, "p2");
  for (let i = 0; i < (opts.p2Bench ?? 1); i += 1) state = benchFromDeck(state, "p2", FILLER);
  if (opts.defenderTool !== undefined) {
    state = attachToolFromDeck(state, "p2", "active", opts.defenderTool);
  }
  if (opts.defenderDamage !== undefined) state = setDamage(state, "p2", opts.defenderDamage);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", GHOLDENGO);
  state = clearBench(state, "p1");
  for (let i = 0; i < opts.bench; i += 1) state = benchFromDeck(state, "p1", FILLER);
  return fuel(state);
}

const SURF_BACK = { type: "attack", seat: "p1", index: 1 } as const;
const YES = { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } } as const;
const NO = { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: false } } as const;

// ────────────────────────────────────────────────────────────────────────────
describe("D312 §1 — the print, the index-precision, and the `optional` that IS printed", () => {
  it("the fixture carries both printed sentences VERBATIM", () => {
    expect(POOL[GHOLDENGO]?.attacks?.[1]?.effect).toBe(PRINTED);
    expect(POOL[GHOLDENGO]?.attacks?.[1]?.name).toBe("Surf Back");
    expect(POOL[GHOLDENGO]?.attacks?.[1]?.damage).toBe(100);
    expect(POOL[GHOLDENGO]?.attacks?.[0]?.effect).toBe(IDX0_PRINTED);
  });

  it("the registry authors index 1 and index 0 STAYS UNSIMULATED", () => {
    const program = programFor(GHOLDENGO);
    expect(program?.attack?.[1]).toBeDefined();
    expect(program?.attack?.[0]).toBeUndefined();
    expect(Object.keys(program ?? {})).toEqual(["attack"]);
  });

  it("the program is an `optional` over the existing op — nothing new was authored", () => {
    expect(programFor(GHOLDENGO)?.attack?.[1]).toEqual([
      {
        op: "optional",
        note: PRINTED,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "returnSelf", dest: "deck" }],
      },
    ]);
  });

  it("the prompt note IS the printed sentence, byte for byte", () => {
    const program = programFor(GHOLDENGO)?.attack?.[1] ?? [];
    const head = program[0];
    expect(head?.op === "optional" && head.note).toBe(PRINTED);
  });

  it("the ABILITY printing of the same mechanism takes NO wrapper — the pair is the argument", () => {
    expect(programFor("sv06-080")?.abilities?.[0]?.program).toEqual([
      { op: "returnSelf", dest: "deck" },
    ]);
    expect(JSON.stringify(programFor("sv06-080"))).not.toContain("optional");
    expect(JSON.stringify(programFor(GHOLDENGO))).toContain("optional");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D312 §2 — the decision: the attack lands FIRST, then the printed 'you may'", () => {
  for (const seed of SEEDS) {
    it(`damage is dealt BEFORE the prompt, and a DECLINE keeps the body (seed ${seed})`, () => {
      const before = board({ bench: 2, seed, defender: FILLER });
      const { state: parked, events } = apply(before, SURF_BACK);

      expect(parked.players.p2.active?.damage).toBe(100);
      expect(parked.phase.kind).toBe("effect:choose");
      expect(findEvent(events, "EFFECT_PENDING")).toMatchObject({ seat: "p1", note: PRINTED });

      const { state: done } = apply(parked, NO);
      // Declined: the attacker is standing, with everything still attached.
      expect(done.cardIdByUid[done.players.p1.active?.stack.at(-1) ?? ""]).toBe(GHOLDENGO);
      expect(done.players.p1.active?.energy).toHaveLength(3);
      // …and the turn ended anyway (§5.3) — the decline is about the removal only.
      expect(done.phase).toMatchObject({ seat: "p2" });
    });
  }

  it("an ACCEPT shuffles the body and every attached card into the deck", () => {
    let state = board({ bench: 2, defender: FILLER });
    state = attachToolFromDeck(state, "p1", "active", TOOL);
    const body = state.players.p1.active;
    if (body === null) throw new Error("no Active");
    const stack = [...body.stack, ...body.energy, ...body.tools];
    expect(stack).toHaveLength(5); // the Gholdengo card, three Energy, one Tool
    const deckBefore = state.players.p1.deck.length;

    const { state: done, events } = apply(must(applyAction(state, SURF_BACK)), YES);

    const deck = new Set(done.players.p1.deck);
    for (const uid of stack) expect(deck.has(uid), uid).toBe(true);
    expect(done.players.p1.deck.length).toBeGreaterThanOrEqual(deckBefore + 5);
    const returned = findEvent(events, "POKEMON_RETURNED");
    expect(returned).toMatchObject({ seat: "p1", actor: "p1", dest: "deck" });
    expect(new Set(returned?.uids ?? [])).toEqual(new Set(stack));
  });

  it("the OPPONENT cannot answer the attacker's printed 'you may'", () => {
    const parked = must(applyAction(board({ bench: 2, defender: FILLER }), SURF_BACK));
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "confirm", yes: true },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("WRONG_SEAT");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D312 §3 — THE SEAM AT ITS SECOND SITE, and the ORDER that makes it §8.1", () => {
  it("the attacker's empty spot is promoted BEFORE the turn ends — the whole point", () => {
    const { state: done, events } = apply(
      must(applyAction(board({ bench: 2, defender: FILLER }), SURF_BACK)),
      YES,
    );
    expect(done.phase).toEqual({ kind: "ko:promote", seat: "p1" });
    expect(findEvent(events, "PROMOTION_REQUIRED")).toMatchObject({ seat: "p1" });
    expect(events.map((e) => e.type)).not.toContain("TURN_ENDED");
    expect(done.pending.some((s) => s.kind === "endTurn")).toBe(true);

    // Answering it drains the tail and hands over a board with a real Active.
    const after = must(applyAction(done, { type: "promote", seat: "p1", benchIndex: 0 }));
    expect(after.players.p1.active).not.toBeNull();
    expect(after.phase).toMatchObject({ seat: "p2" });
  });

  it("a Bench of ONE auto-resolves and the turn ends in ONE action", () => {
    const { state: done, events } = apply(
      must(applyAction(board({ bench: 1, defender: FILLER }), SURF_BACK)),
      YES,
    );
    // The M1 no-choice doctrine: no prompt, and the tail drained straight through.
    expect(events.map((e) => e.type)).not.toContain("PROMOTION_REQUIRED");
    expect(events.map((e) => e.type)).toContain("TURN_ENDED");
    expect(done.players.p1.active).not.toBeNull();
    expect(done.players.p1.bench).toHaveLength(0);
    expect(done.phase).toMatchObject({ seat: "p2" });
  });

  it("a Bench of NONE is the §14.2 loss — the attacker attacks itself out of the game", () => {
    const { state: done, events } = apply(
      must(applyAction(board({ bench: 0, defender: FILLER }), SURF_BACK)),
      YES,
    );
    expect(done.phase.kind).toBe("gameOver");
    expect(findEvent(events, "GAME_OVER")?.outcome).toMatchObject({ result: "win", winner: "p2" });
  });

  it("THE BOTH-SEATS BOARD: the defender is KO'd and the attacker removes ITSELF", () => {
    const { state: done, events } = apply(
      must(applyAction(board({ bench: 2, defender: WALL, p2Bench: 2 }), SURF_BACK)),
      YES,
    );
    // The Wall (90 HP) died to the 100.
    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    // EXACTLY ONE promotion per seat, and both are present.
    const promotes = done.pending.filter((s) => s.kind === "promote");
    expect(promotes.filter((s) => s.seat === "p1")).toHaveLength(1);
    expect(promotes.filter((s) => s.seat === "p2")).toHaveLength(1);
    expect(promotes).toHaveLength(2);
    // …and the PRIZE stage is in front of both (`collectKnockOuts` groups
    // prizes-first), which is the ordering the splice must not disturb.
    const kinds = done.pending.map((s) => s.kind);
    expect(kinds.indexOf("takePrizes")).toBeLessThan(kinds.indexOf("promote"));
    // …and the turn tail is behind ALL of them.
    expect(kinds.indexOf("promote")).toBeLessThan(kinds.indexOf("endTurn"));
  });

  it("a DECLINE owes NO promotion — the seam fires on the board and not on the op", () => {
    const { state: done, events } = apply(
      must(applyAction(board({ bench: 2, defender: FILLER }), SURF_BACK)),
      NO,
    );
    expect(events.map((e) => e.type)).not.toContain("PROMOTION_REQUIRED");
    expect(done.pending.filter((s) => s.kind === "promote")).toEqual([]);
    expect(done.players.p1.active).not.toBeNull();
  });

  it("an ORDINARY attack is untouched — the superset costs nothing", () => {
    const { state: done, events } = apply(board({ bench: 2, defender: FILLER }), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(events.map((e) => e.type)).not.toContain("PROMOTION_REQUIRED");
    expect(done.pending.filter((s) => s.kind === "promote")).toEqual([]);
    expect(events.map((e) => e.type)).toContain("TURN_ENDED");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D312 §4 — THE FALSIFIED DOC CLAIM, DRIVEN", () => {
  it("an attack CAN now discard its own actor mid-attack — the claim's premise is RETIRED", () => {
    const parked = must(applyAction(board({ bench: 2, defender: FILLER }), SURF_BACK));
    const attacker = parked.players.p1.active?.stack.at(-1) ?? "";
    expect(attacker).not.toBe("");
    const { state: done } = apply(parked, YES);
    // The uid `finishAttack` was handed as "the Attacking Pokémon" is in the DECK.
    expect(done.players.p1.deck).toContain(attacker);
    expect(done.players.p1.active?.stack.at(-1)).not.toBe(attacker);
    expect(done.players.p1.bench.some((b) => b.stack.includes(attacker))).toBe(false);
  });

  it("THE DEFECT BOARD: a Vengeful Punch is owed 4 counters and the attacker is GONE", () => {
    const state = board({ bench: 2, defender: WALL, defenderTool: VENGEFUL_PUNCH, p2Bench: 2 });
    const parked = must(applyAction(state, SURF_BACK));
    const attacker = parked.players.p1.active?.stack.at(-1) ?? "";
    const { state: done, events } = apply(parked, YES);

    // The antecedent HELD — the holder really was Knocked Out by this attack.
    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    const recoils = events.filter(
      (e) => e.type === "COUNTERS_PLACED" && e.source === "counterattack",
    );
    expect(recoils).toEqual([]);
    // The attacker is in the deck with no damage anywhere on it.
    expect(done.players.p1.deck).toContain(attacker);
  });

  it("…and the CONTROL: DECLINE the removal and the SAME 4 counters LAND", () => {
    const state = board({ bench: 2, defender: WALL, defenderTool: VENGEFUL_PUNCH, p2Bench: 2 });
    const parked = must(applyAction(state, SURF_BACK));
    const { state: done, events } = apply(parked, NO);

    expect(findEvent(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    const recoils = events.filter(
      (e) => e.type === "COUNTERS_PLACED" && e.source === "counterattack",
    );
    expect(recoils).toHaveLength(1);
    expect(recoils[0]).toMatchObject({ seat: "p1", amount: 40 });
    expect(done.players.p1.active?.damage).toBe(40);
  });
});
