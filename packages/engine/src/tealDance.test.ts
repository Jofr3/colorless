import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  battler,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  handFromDeck,
  handToDeck,
  must,
  mustApply,
  setActiveFromDeck,
  benchFromDeck,
  types,
} from "./testFixtures";

// D221 — TEAL DANCE (Teal Mask Ogerpon ex), and the TWO FIELDS D190 REFUSED TO
// BUILD IT WITHOUT.
//
// "Once during your turn, you may attach a Basic {G} Energy card from your hand
// to this Pokémon. If you attached Energy to a Pokémon in this way, draw a card."
//
// ⚠️ **THE TOP ROW OF THE RANKED BACKLOG, AND THE FIRST TIME A CENSUS'S "ZERO
// ENGINE CODE" PRICE HAS BEEN PAID TWICE.**
// `docs/reference/coverage-backlog-legal.md` (D219) ranks this **8 Standard-legal
// printings for "1 registry program, aliased 8 ways. Zero engine code."** — the
// best printings-per-edit row left in the file. D190 took it as a Tier-1
// candidate, **DROPPED it**, and named the exact two pieces the census had
// asserted rather than measured (`registryOnlyPrograms.test.ts`'s `DROPPED`):
//
//   1. **A SELF TARGET.** The op's target riders were `targetType` / `basicOnly`
//      / `ownerPokemon` / `benchOnly`, and every one of them picks out a CLASS of
//      the controller's own Pokémon. On a board with two {G} bodies —
//      `fix-bramble` beside the Ogerpon below — `targetType: "Grass"` offers BOTH
//      and lets the player attach to the wrong one. "This Pokémon" is a UID
//      question, and `ctx.sourceUid` is the only thing that answers it.
//   2. **A `recordAs` SLOT.** The op recorded NOTHING, so the §9.2 `recordGate`
//      the second sentence needs had nothing to read.
//
// Both landed here, both on `attachEnergyFrom`, and `toSelf` is deliberately the
// SAME field name and the SAME reader (`sourceRef`) `attachFromDeck.toSelf`
// already used for Pawmot's "Electrogenesis" — one spelling of "this Pokémon"
// across both attach routes rather than two that can drift.
//
// ⚠️ WHAT THIS SUITE CAN AND CANNOT PUT RED, SAID UP FRONT (the guard rule):
// * Replacing `sourceRef(state, ctx)` with `attachEnergyTargets(...)` — the
//   pre-D221 line, and the mistake an author actually makes — turns the boards
//   below RED TWICE: they hold TWO eligible bodies, so the op would PARK instead
//   of resolving, and the bench test would attach to the wrong one.
// * Deleting the `recordMoved` call turns the draw off: the gate reads an empty
//   slot and the card does half of what it prints.
// * The gate's FALSE arm is NOT reachable from the action path, and that is
//   asserted rather than asserted around — `programPlayable` refuses the
//   activation outright when no Basic {G} is in hand (`NO_LEGAL_TARGET`), which
//   is the only way the attach can whiff. ⚠️ SO NO BOARD BELOW DISTINGUISHES THE
//   GATED DRAW FROM AN UNCONDITIONAL ONE: hoisting the draw out of the gate is
//   killed by the DECLARATION snapshot (the exact-authoring test) and by nothing
//   else. That mutant was written as a declared `equivalent` SURVIVOR, the
//   harness returned STALE-SURVIVOR, and the row now stands as killed with the
//   caveat attached — a verdict that says nothing about behaviour.

/** The eight Standard-legal printings, from `coverage-backlog-legal.md`'s own
    enumeration (D219, measured against the remote D1 on 2026-08-04). */
const TEAL_DANCE_IDS = [
  "svp-166",
  "sv06-025",
  "sv06-190",
  "sv06-211",
  "sv06-221",
  "sv08.5-012",
  "sv08.5-145",
  "sv08.5-177",
] as const;

/** The printed sentence, byte for byte — authored against the print rather than
    against a paraphrase (D183's class). */
const TEAL_DANCE_TEXT =
  "Once during your turn, you may attach a Basic {G} Energy card from your hand to this Pokémon. If you attached Energy to a Pokémon in this way, draw a card.";

// ── The demonstrator pool. `fix-tealdance` is a SYNTHETIC body carrying the real
//    program: a fixture id naming a real printing must appear in
//    `catalogManifest.ts`, which is generated off a local sqlite this clone does
//    not have and which measures a 978-row / 6-set catalog holding none of
//    `svp` / `sv06` / `sv08.5` anyway. D190's idiom, D190's reason. ──

const LOCAL_CARDS: Record<string, Card> = {
  /** fix-tealdance — a {G} Basic with the activated Ability and nothing else.
      No attacks: it is only ever asked to feed itself. */
  "fix-tealdance": battler("fix-tealdance", {
    name: "fix-tealdance",
    types: ["Grass"],
    hp: 210,
    retreat: 2,
    abilities: [{ type: "Ability", name: "Teal Dance", effect: TEAL_DANCE_TEXT }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** ⚠️ `fix-bramble` IS THE LOAD-BEARING FIXTURE HERE AND IT IS REUSED, NOT
    WRITTEN — the FIXTURE_POOL sweep first (D196). It is a {G} Basic with no
    Ability of its own, which is exactly the second eligible body a CLASS rider
    would have offered and a UID target must not. */
const DECK = deckOf({
  "fix-tealdance": 4,
  "fix-bramble": 4,
  "fix-bigbody": 20, // 200 HP dominant Basic — mulligan-free setup
  "fix-grass-energy": 16,
  "fix-energy": 16,
});

const useTealDance = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "active" },
  abilityName: "Teal Dance",
} as const;

const useTealDanceFromBench = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "bench", index: 0 },
  abilityName: "Teal Dance",
} as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** `driveSetup` against the LOCAL pool — `testFixtures.ts`'s own closes over
    `FIXTURE_POOL`, and `createGame` takes its `cardPool` as a PARAMETER, which is
    how a demonstrator stays local to one suite. */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }));
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

describe("D221 — the registry rows", () => {
  it("maps all EIGHT Standard-legal printings, plus the demonstrator, to ONE object", () => {
    const first = programFor(TEAL_DANCE_IDS[0]);
    expect(first, "svp-166 has no program").toBeDefined();
    for (const id of TEAL_DANCE_IDS) {
      expect(programFor(id), `${id} left Teal Dance`).toBe(first);
    }
    // A duplicated id in the list would make the count lie about the coverage
    // this slice bought, which is the ONE number a reader carries away from it.
    expect(new Set(TEAL_DANCE_IDS).size).toBe(8);
    expect(programFor("fix-tealdance"), "the demonstrator is not Teal Dance").toBe(first);
  });

  it("authors the program EXACTLY — the self target, the slot, and the gated draw", () => {
    expect(programFor("sv06-025")?.abilities).toEqual([
      {
        name: "Teal Dance",
        // The printed "Once during your turn" — Baxcalibur's "As often as you
        // like" is the same op with this false, one word apart in the print.
        oncePerTurn: true,
        // No Active clause in the sentence, so a benched Ogerpon feeds itself
        // (driven below, from the Bench).
        activeOnly: false,
        program: [
          {
            op: "attachEnergyFrom",
            source: "hand",
            energyType: "Grass",
            toSelf: true,
            recordAs: "moved",
          },
          {
            op: "recordGate",
            slot: "moved",
            // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
            then: [{ op: "drawCards", count: 1 }],
          },
        ],
      },
    ]);
  });

  it("does NOT share an object with the attach-from-hand neighbours, and leaves them unmarked", () => {
    // ⚠️ THE MISTAKE AN AUTHOR ACTUALLY MAKES: Quaquaval's "Energy Carnival" and
    // Baxcalibur's "Super Cold" are the same op from the same zone, and the
    // reprint idiom says byte-identical text SHARES the object. These sentences
    // are NOT byte-identical — a type, a self target and a second sentence apart
    // — so sharing would silently move two other cards.
    expect(programFor("sv06-025")).not.toBe(programFor("sv01-054"));
    expect(programFor("sv06-025")).not.toBe(programFor("sv02-060"));
    // And the new fields are NOT on them: "1 of your Pokémon" is a CHOICE, and a
    // `toSelf` leaked onto either would silently delete it.
    for (const neighbour of ["sv01-054", "sv02-060"]) {
      const op = programFor(neighbour)?.abilities?.[0]?.program?.[0];
      expect(op?.op, `${neighbour} is not an attachEnergyFrom row`).toBe("attachEnergyFrom");
      expect(op, `${neighbour} gained a self target`).not.toHaveProperty("toSelf");
      expect(op, `${neighbour} gained a record slot`).not.toHaveProperty("recordAs");
    }
  });
});

describe("Teal Dance — driven through the real engine", () => {
  it("attaches to THIS Pokémon and asks NOTHING, on a board holding a second {G} body", () => {
    // The precondition that makes this test discriminate: a CLASS rider would
    // have offered two rows here, and the op would have parked.
    expect(POOL["fix-bramble"]?.types).toContain("Grass");
    expect(POOL["fix-tealdance"]?.types).toContain("Grass");

    // `setActiveFromDeck` DISPLACES the seated Active onto the Bench, so the
    // Bench is emptied after it: bench[0] must be the {G} body this test is about
    // and not whichever Basic the setup happened to seat (D213's class — a row
    // that reads right for the wrong reason).
    let state = setActiveFromDeck(board(1), "p1", "fix-tealdance");
    state = benchFromDeck(clearBench(state, "p1"), "p1", "fix-bramble");
    state = grassInHand(state, 1);
    const [grass] = grassUidsInHand(state);
    deepFreeze(state);

    const { state: after, events } = mustApply(state, useTealDance);
    // No prompt: one target, so `parkOrForce` forces it.
    expect(after.phase.kind).toBe("turn:action");
    expect(find(events, "ENERGY_ATTACHED")).toMatchObject({
      seat: "p1",
      uid: grass,
      target: { spot: "active" },
    });
    expect(after.players.p1.active?.energy).toEqual([grass]);
    // The other {G} body got nothing — the whole point of the UID target.
    expect(after.players.p1.bench[0]?.energy).toEqual([]);
    expect(after.players.p1.hand).not.toContain(grass);
  });

  it("feeds ITSELF from the BENCH — the sentence carries no Active clause", () => {
    // The strongest form of the self-pin: the Ability's host is NOT the Active,
    // and the Active is itself a legal {G} target. A class rider would offer both
    // and default nothing; `ctx.sourceUid` names the bench index.
    let state = setActiveFromDeck(board(2), "p1", "fix-bramble");
    state = benchFromDeck(clearBench(state, "p1"), "p1", "fix-tealdance");
    state = grassInHand(state, 1);
    const [grass] = grassUidsInHand(state);
    deepFreeze(state);

    const { state: after, events } = mustApply(state, useTealDanceFromBench);
    expect(after.phase.kind).toBe("turn:action");
    expect(find(events, "ENERGY_ATTACHED")).toMatchObject({
      seat: "p1",
      uid: grass,
      target: { spot: "bench", index: 0 },
    });
    expect(after.players.p1.bench[0]?.energy).toEqual([grass]);
    expect(after.players.p1.active?.energy).toEqual([]);
  });

  it("draws exactly ONE card, AFTER the attach — the §9.2 record is what the gate reads", () => {
    let state = setActiveFromDeck(board(3), "p1", "fix-tealdance");
    state = grassInHand(state, 1);
    const deckBefore = state.players.p1.deck.length;
    const handBefore = state.players.p1.hand.length;
    deepFreeze(state);

    const { state: after, events } = mustApply(state, useTealDance);
    const drawn = find(events, "CARDS_DRAWN");
    expect(drawn?.uids).toHaveLength(1);
    // ORDER, not merely presence: the draw is the attach's consequent, and a
    // program that drew first would read the slot before anything filed it.
    const order = types(events);
    expect(order.indexOf("ENERGY_ATTACHED")).toBeLessThan(order.indexOf("CARDS_DRAWN"));
    expect(after.players.p1.deck).toHaveLength(deckBefore - 1);
    // One {G} left the hand, one card came back: the size is unchanged and the
    // CONTENTS are not, which is why both are asserted.
    expect(after.players.p1.hand).toHaveLength(handBefore);
    expect(after.players.p1.hand).toContain(drawn?.uids[0]);
    expect(grassUidsInHand(after)).toHaveLength(0);
  });

  it("is REFUSED with no Basic {G} in hand — so the gate's FALSE arm is unreachable, and the draw can never be had for free", () => {
    // ⚠️ THIS IS THE UNREACHABILITY PROOF, not a nicety. `programPlayable`
    // refuses the activation when the source zone holds no matching Energy, and
    // that is the ONLY way this attach can whiff — which is why hoisting the
    // draw out of the gate is an EQUIVALENT mutant and is declared as one rather
    // than tested around (D205's rule).
    let state = setActiveFromDeck(board(4), "p1", "fix-tealdance");
    state = grassInHand(state, 0);
    // A hand FULL of Energy that is not Basic {G}: the refusal is about the TYPE,
    // not about an empty hand.
    state = handFromDeck(state, "p1", "fix-energy", 3);
    expect(state.players.p1.hand.length).toBeGreaterThan(3);
    deepFreeze(state);

    const refused = applyAction(state, useTealDance);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("is ONCE PER TURN — the printed 'Once during your turn'", () => {
    let state = setActiveFromDeck(board(5), "p1", "fix-tealdance");
    state = grassInHand(state, 2);
    const { state: used } = mustApply(state, useTealDance);
    const again = applyAction(used, useTealDance);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("ABILITY_ALREADY_USED");
    // The second {G} is still in hand: the refusal is the flag, not the source.
    expect(grassUidsInHand(used)).toHaveLength(1);
  });
});
