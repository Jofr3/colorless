import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, programFor } from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handToDeck,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  types,
  findEvent,
  driveSetup,
} from "./testFixtures";

const RIPENING_IDS = ["sv07-014", "sv07-156", "sv07-167", "sv08.5-011"] as const;

const RIPENING_TEXT =
  "Once during your turn, you may attach a Basic {G} Energy card from your hand to 1 of your Pokémon. If you attached Energy to a Pokémon in this way, heal 30 damage from that Pokémon.";

const LOCAL_CARDS: Record<string, Card> = {
  "fix-ripening": battler("fix-ripening", {
    name: "fix-ripening",
    types: ["Grass"],
    hp: 330,
    retreat: 2,
    abilities: [{ type: "Ability", name: "Ripening Charge", effect: RIPENING_TEXT }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "fix-ripening": 4,
  "fix-bramble": 4,
  "fix-titan": 4,
  "fix-bigbody": 16, // 200 HP dominant Basic — mulligan-free setup
  "fix-grass-energy": 16,
  "fix-energy": 16,
});

const useRipening = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "active" },
  abilityName: "Ripening Charge",
} as const;

const useRipeningFromBench = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "bench", index: 0 },
  abilityName: "Ripening Charge",
} as const;

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

/** Setup, then open P1's turn (P2 went first and passed). */
function board(seed: number): GameState {
  return mustApply(localSetup(seed, "p2"), { type: "endTurn", seat: "p2" }).state;
}

/** Exactly `count` Basic {G} Energy in P1's hand — the opening hand is dealt from
    a shuffled deck, so it is emptied of them FIRST and then dealt back. */
function grassInHand(state: GameState, count: number): GameState {
  const cleared = handToDeck(state, "p1", "fix-grass-energy");
  return count === 0 ? cleared : handFromDeck(cleared, "p1", "fix-grass-energy", count);
}

function grassUidsInHand(state: GameState): string[] {
  return state.players.p1.hand.filter((uid) => state.cardIdByUid[uid] === "fix-grass-energy");
}

/** The standard board for this suite: `fix-ripening` Active, ONE benched
    `fix-bramble`, one {G} in hand. Two eligible bodies, so the op PARKS. */
function twoBodyBoard(seed: number): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-ripening");
  state = benchFromDeck(clearBench(state, "p1"), "p1", "fix-bramble");
  return grassInHand(state, 1);
}

const ACTIVE_REF = { seat: "p1", spot: { spot: "active" } } as const;
const BENCH_0_REF = { seat: "p1", spot: { spot: "bench", index: 0 } } as const;

/** Answer the park with `ref`. Throws if the state is not parked — a case that
    stopped parking must fail loudly rather than skip its own assertions. */
function pick(state: GameState, ref: typeof ACTIVE_REF | typeof BENCH_0_REF) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  return mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } });
}

describe("D249 — the registry rows", () => {
  it("maps all FOUR Standard-legal printings, plus the demonstrator, to ONE object", () => {
    const first = programFor(RIPENING_IDS[0]);
    expect(first, "sv07-014 has no program").toBeDefined();
    for (const id of RIPENING_IDS) {
      expect(programFor(id), `${id} left Ripening Charge`).toBe(first);
    }
    expect(new Set(RIPENING_IDS).size).toBe(4);
    expect(programFor("fix-ripening"), "the demonstrator is not Ripening Charge").toBe(first);
  });

  it("authors the program EXACTLY — one op, the heal rider, and NO record slot", () => {
    expect(programFor("sv07-014")?.abilities).toEqual([
      {
        name: "Ripening Charge",
        oncePerTurn: true,
        // No Active clause in the sentence, so a benched Hydrapple ex charges
        // (driven below, from the Bench).
        activeOnly: false,
        program: [
          {
            op: "attachEnergyFrom",
            source: "hand",
            energyType: "Grass",
            healTarget: 30,
          },
        ],
      },
    ]);
  });

  it("carries NEITHER `toSelf` NOR `recordAs` — the two fields the near-twin needs and this one must not have", () => {
    const op = programFor("sv07-014")?.abilities?.[0]?.program?.[0];
    expect(op?.op).toBe("attachEnergyFrom");
    expect(op, "Ripening Charge gained a self target").not.toHaveProperty("toSelf");
    expect(op, "Ripening Charge gained a record slot").not.toHaveProperty("recordAs");
    expect(programFor("sv07-014")?.abilities?.[0]?.program).toHaveLength(1);
  });

  it("does NOT share an object with Teal Dance, and leaves Teal Dance's own fields alone", () => {
    expect(programFor("sv07-014")).not.toBe(programFor("svp-166"));
    const teal = programFor("svp-166")?.abilities?.[0]?.program?.[0];
    expect(teal, "Teal Dance gained a heal").not.toHaveProperty("healTarget");
    expect(teal).toHaveProperty("toSelf", true);
  });
});

describe("Ripening Charge — driven through the real engine", () => {
  it("PARKS on which of your Pokémon to feed — the printed '1 of your Pokémon' is a question", () => {
    // The precondition that makes this test discriminate from Teal Dance's: TWO
    // eligible bodies, and neither is named by the print.
    let state = twoBodyBoard(1);
    state = benchFromDeck(state, "p1", "fix-titan");
    deepFreeze(state);

    const { state: parked } = mustApply(state, useRipening);
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(parked.phase.prompt.kind).toBe("choosePokemon");
    // THREE rows, and the third is the Colorless titan: the print narrows the
    // destination by OWNER only, so a non-{G} body is a legal place to put a {G}.
    if (parked.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(parked.phase.prompt.candidates).toHaveLength(3);
    expect(parked.phase.prompt.candidates.every((c) => c.seat === "p1")).toBe(true);
  });

  it("attaches to the CHOSEN Benched body and heals 30 from IT — not from the source, not from the Active", () => {
    let state = twoBodyBoard(2);
    state = setDamage(state, "p1", 70);
    state = setBenchDamage(state, "p1", 0, 50);
    const [grass] = grassUidsInHand(state);
    deepFreeze(state);

    const { state: parked } = mustApply(state, useRipening);
    const { state: after, events } = pick(parked, BENCH_0_REF);

    expect(after.phase.kind).toBe("turn:action");
    expect(findEvent(events, "ENERGY_ATTACHED")).toMatchObject({
      seat: "p1",
      uid: grass,
      target: { spot: "bench", index: 0 },
    });
    expect(after.players.p1.bench[0]?.energy).toEqual([grass]);
    expect(after.players.p1.bench[0]?.damage).toBe(20);
    // The SOURCE is the Active here and it was NOT healed — "that Pokémon" is the
    // one just fed, which is the whole reason this is not `healChosen`.
    expect(after.players.p1.active?.damage).toBe(70);
    expect(after.players.p1.active?.energy).toEqual([]);
    expect(after.players.p1.hand).not.toContain(grass);
  });

  it("heals the ACTIVE when the Active is the pick — the same op, the other answer", () => {
    let state = twoBodyBoard(3);
    state = setDamage(state, "p1", 100);
    state = setBenchDamage(state, "p1", 0, 100);
    deepFreeze(state);

    const { state: parked } = mustApply(state, useRipening);
    const { state: after } = pick(parked, ACTIVE_REF);
    expect(after.players.p1.active?.damage).toBe(70);
    expect(after.players.p1.bench[0]?.damage).toBe(100);
  });

  it("heals EXACTLY 30, not all — the printed number, and the clamp below it", () => {
    let state = twoBodyBoard(4);
    state = setDamage(state, "p1", 50);
    deepFreeze(state);

    const { state: parked } = mustApply(state, useRipening);
    const { state: after, events } = pick(parked, ACTIVE_REF);
    expect(after.players.p1.active?.damage).toBe(20);
    expect(findEvent(events, "HEALED")).toMatchObject({ seat: "p1", amount: 30 });

    // …and the clamp on the other side: 10 damage heals 10, not 30 into negative.
    let low = twoBodyBoard(4);
    low = setDamage(low, "p1", 10);
    const { state: lowAfter, events: lowEvents } = pick(
      mustApply(low, useRipening).state,
      ACTIVE_REF,
    );
    expect(lowAfter.players.p1.active?.damage).toBe(0);
    expect(findEvent(lowEvents, "HEALED")).toMatchObject({ amount: 10 });
  });

  it("still ATTACHES to an UNDAMAGED body, and emits no HEALED — the attach is not conditional on the heal", () => {
    // The heal is the CONSEQUENT. An undamaged pick is the ordinary use of this
    // card (charge a fresh attacker) and must not be refused or made a no-op.
    const state = twoBodyBoard(5);
    expect(state.players.p1.active?.damage).toBe(0);
    deepFreeze(state);

    const { state: parked } = mustApply(state, useRipening);
    const { state: after, events } = pick(parked, ACTIVE_REF);
    expect(after.players.p1.active?.energy).toHaveLength(1);
    expect(findEvent(events, "HEALED")).toBeUndefined();
  });

  it("the heal comes AFTER the attach — 'in this way' is an order, not a coincidence", () => {
    let state = twoBodyBoard(6);
    state = setDamage(state, "p1", 60);
    deepFreeze(state);

    const { events } = pick(mustApply(state, useRipening).state, ACTIVE_REF);
    const order = types(events);
    expect(order.indexOf("ENERGY_ATTACHED")).toBeLessThan(order.indexOf("HEALED"));
  });

  it("works from the BENCH and can feed the ACTIVE — no Active clause on either end", () => {
    // The mirror of Teal Dance's bench case, and the pin that this is NOT a self
    // attach: the host is benched and the destination is the Active.
    let state = setActiveFromDeck(board(7), "p1", "fix-bramble");
    state = benchFromDeck(clearBench(state, "p1"), "p1", "fix-ripening");
    state = grassInHand(state, 1);
    state = setDamage(state, "p1", 40);
    const [grass] = grassUidsInHand(state);
    deepFreeze(state);

    const { state: parked } = mustApply(state, useRipeningFromBench);
    const { state: after, events } = pick(parked, ACTIVE_REF);
    expect(findEvent(events, "ENERGY_ATTACHED")).toMatchObject({
      uid: grass,
      target: { spot: "active" },
    });
    expect(after.players.p1.active?.energy).toEqual([grass]);
    expect(after.players.p1.active?.damage).toBe(10);
    expect(after.players.p1.bench[0]?.energy).toEqual([]);
  });

  it("is REFUSED with no Basic {G} in hand — `programPlayable` gates the attach, so the heal is never had for free", () => {
    let state = twoBodyBoard(8);
    state = grassInHand(state, 0);
    // A hand FULL of Energy that is not Basic {G}: the refusal is about the TYPE,
    // not about an empty hand.
    state = handFromDeck(state, "p1", "fix-energy", 3);
    state = setDamage(state, "p1", 100);
    deepFreeze(state);

    const refused = applyAction(state, useRipening);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("is ONCE PER TURN — and the stamp is keyed by BODY, so a SECOND copy still charges", () => {
    let state = twoBodyBoard(9);
    state = benchFromDeck(state, "p1", "fix-ripening");
    state = grassInHand(state, 3);
    deepFreeze(state);

    const { state: once } = pick(mustApply(state, useRipening).state, ACTIVE_REF);
    const again = applyAction(once, useRipening);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("ABILITY_ALREADY_USED");

    // The SECOND copy, on Bench 1, is a different uid and is still available.
    const second = {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 1 },
      abilityName: "Ripening Charge",
    } as const;
    const { state: twice } = pick(mustApply(once, second).state, ACTIVE_REF);
    expect(twice.players.p1.active?.energy).toHaveLength(2);
    // …and the {G} that is left proves the first refusal was the FLAG and not the
    // source running dry.
    expect(grassUidsInHand(twice)).toHaveLength(1);
  });

  it("does NOT spend the turn's §6.3 manual attach — the Ability's own effect is not the allowance", () => {
    // The rule that makes this card worth playing, and the one a naive build
    // gets wrong by routing through the manual-attach path.
    const state = twoBodyBoard(10);
    const before = state.allowances.energyAttached;
    deepFreeze(state);
    const { state: after } = pick(mustApply(state, useRipening).state, ACTIVE_REF);
    expect(after.allowances.energyAttached).toBe(before);
  });
});
