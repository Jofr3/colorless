import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { passivesOf } from "./continuous";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, createGame, programFor } from "./index";
import { conditionHolds, conditionNote, evolveEarlyLicensed } from "./interpreter";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  setActiveFromDeck,
  must,
  firstBasicInHand,
  activeOf,
} from "./testFixtures";

const STIMULATED_TEXT_KARRABLAST =
  "If you have Shelmet in play, this Pokémon can evolve during your first turn or the turn you play it.";
const STIMULATED_TEXT_SHELMET =
  "If you have Karrablast in play, this Pokémon can evolve during your first turn or the turn you play it.";

const KARRABLAST_IDS = ["sv10.5b-009", "sv10.5b-094"] as const;
const SHELMET_IDS = ["sv10.5w-008", "sv10.5w-093"] as const;
const ALL_IDS = [...KARRABLAST_IDS, ...SHELMET_IDS] as const;

function licensed(id: string, name: "Karrablast" | "Shelmet"): Card {
  return battler(id, {
    name,
    hp: 70,
    retreat: 1,
    types: ["Grass"],
    abilities: [
      {
        type: "Ability",
        name: "Stimulated Evolution",
        effect: name === "Karrablast" ? STIMULATED_TEXT_KARRABLAST : STIMULATED_TEXT_SHELMET,
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Horn Attack", damage: 10 }],
  });
}

const PLAIN_KARRABLAST = "fix-plain-karrablast";
const PLAIN_SHELMET = "fix-plain-shelmet";
/** A third name that is neither partner — the negative control for the gate's
    NAME, without which "the gate holds" cannot be told from "the gate is true
    whenever anything is benched". */
const BYSTANDER = "fix-bystander-basic";

const ESCAVALIER = "fix-escavalier";
const ACCELGOR = "fix-accelgor";

const LOCAL_CARDS: Record<string, Card> = {
  "sv10.5b-009": licensed("sv10.5b-009", "Karrablast"),
  "sv10.5b-094": licensed("sv10.5b-094", "Karrablast"),
  "sv10.5w-008": licensed("sv10.5w-008", "Shelmet"),
  "sv10.5w-093": licensed("sv10.5w-093", "Shelmet"),
  [PLAIN_KARRABLAST]: battler(PLAIN_KARRABLAST, {
    name: "Karrablast",
    hp: 70,
    retreat: 1,
    types: ["Grass"],
    attacks: [{ cost: ["Colorless"], name: "Horn Attack", damage: 10 }],
  }),
  [PLAIN_SHELMET]: battler(PLAIN_SHELMET, {
    name: "Shelmet",
    hp: 70,
    retreat: 1,
    types: ["Grass"],
    attacks: [{ cost: ["Colorless"], name: "Headbutt Bounce", damage: 10 }],
  }),
  [BYSTANDER]: battler(BYSTANDER, {
    name: "Bystander",
    hp: 60,
    retreat: 1,
    types: ["Grass"],
    attacks: [{ cost: ["Colorless"], name: "Tackle", damage: 10 }],
  }),
  "sv08-143": battler("sv08-143", {
    name: "Eevee",
    hp: 70,
    retreat: 1,
    types: ["Colorless"],
    abilities: [
      {
        type: "Ability",
        name: "Boosted Evolution",
        effect:
          "As long as this Pokémon is in the Active Spot, it can evolve during your first turn or the turn you play it.",
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Tackle", damage: 10 }],
  }),
  [ESCAVALIER]: battler(ESCAVALIER, {
    name: "Escavalier",
    stage: "Stage1",
    evolveFrom: "Karrablast",
    hp: 130,
    types: ["Metal"],
  }),
  [ACCELGOR]: battler(ACCELGOR, {
    name: "Accelgor",
    stage: "Stage1",
    evolveFrom: "Shelmet",
    hp: 110,
    types: ["Grass"],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const BUG_DECK = deckOf({
  "sv10.5b-009": 4,
  "sv10.5b-094": 2,
  "sv10.5w-008": 4,
  "sv10.5w-093": 2,
  [PLAIN_KARRABLAST]: 4,
  [PLAIN_SHELMET]: 4,
  [BYSTANDER]: 4,
  [ESCAVALIER]: 6,
  [ACCELGOR]: 6,
  "sv01-096": 2, // Klefki — the §9 Ability-lock control
  "sv08-143": 2,
  "sv02-119": 2, // Falinks — the `yourBenchHasNamed` control (§7)
  "fix-basic-1": 4,
  "fix-energy": 14,
});

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: BUG_DECK, p2: BUG_DECK }, cardPool: POOL });
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

function board(
  seed: number,
  first: Seat,
  seat: Seat,
  activeId: string,
  bench: readonly string[],
  stage1: string = ESCAVALIER,
  stage1Count = 1,
): GameState {
  const foe: Seat = seat === "p1" ? "p2" : "p1";
  let state = localSetup(seed, first);
  state = setActiveFromDeck(state, foe, BYSTANDER);
  state = clearBench(state, foe);
  state = benchFromDeck(state, foe, "fix-basic-1");
  state = setActiveFromDeck(state, seat, activeId);
  state = clearBench(state, seat);
  for (const id of bench) state = benchFromDeck(state, seat, id);
  return handFromDeck(state, seat, stage1, stage1Count);
}

function benchAt(state: GameState, seat: Seat, index: number): InPlayPokemon {
  const pokemon = state.players[seat].bench[index];
  if (pokemon === undefined) throw new Error(`${seat} has no bench[${String(index)}]`);
  return pokemon;
}

function handUidOf(state: GameState, seat: Seat, cardId: string): string {
  const uid = state.players[seat].hand.find((h) => state.cardIdByUid[h] === cardId);
  if (uid === undefined) throw new Error(`${seat} has no ${cardId} in hand`);
  return uid;
}

function passTurns(state: GameState, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

function stampPlayedThisTurn(state: GameState, seat: Seat, index: number | "active"): GameState {
  const side = state.players[seat];
  if (index === "active") {
    if (side.active === null) throw new Error(`${seat} has no Active`);
    return {
      ...state,
      players: {
        ...state.players,
        [seat]: { ...side, active: { ...side.active, turnPlayed: state.turn } },
      },
    };
  }
  const body = side.bench[index];
  if (body === undefined) throw new Error(`${seat} has no bench[${String(index)}]`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        bench: side.bench.map((b, i) => (i === index ? { ...body, turnPlayed: state.turn } : b)),
      },
    },
  };
}

function evolveAt(seat: Seat, uid: string, index: number | "active") {
  return {
    type: "evolve",
    seat,
    uid,
    target: index === "active" ? { spot: "active" as const } : { spot: "bench" as const, index },
  } as const;
}

const SEEDS = [11, 29, 53, 71, 97] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. The registry rows — TWO sentences, TWO objects, and NO zone key.
// ─────────────────────────────────────────────────────────────────────────────

describe("D279 — 'Stimulated Evolution' as registry data", () => {
  it("all FOUR ids resolve to a licence and to nothing else", () => {
    for (const id of ALL_IDS) {
      expect(programFor(id), id).toEqual({
        passive: {
          evolveEarlyExempt: {
            ifInPlay: KARRABLAST_IDS.includes(id as (typeof KARRABLAST_IDS)[number])
              ? "Shelmet"
              : "Karrablast",
          },
        },
      });
      expect(programFor(id)?.abilities, id).toBeUndefined();
      expect(programFor(id)?.attack, id).toBeUndefined();
      // …and NOT either of the two neighbouring first-turn flags.
      expect(programFor(id)?.passive?.attackFirstTurnExempt, id).toBeUndefined();
      expect(programFor(id)?.trainerFirstTurnExempt, id).toBeUndefined();
    }
  });

  it("carries NO `activeOnly` — the clause the printed text does NOT have", () => {
    for (const id of ALL_IDS) {
      expect(programFor(id)?.passive?.evolveEarlyExempt?.activeOnly, id).toBeUndefined();
    }
    expect(programFor("sv08-143")?.passive?.evolveEarlyExempt?.activeOnly).toBe(true);
    expect(programFor("sv08-143")?.passive?.evolveEarlyExempt?.ifInPlay).toBeUndefined();
  });

  it("TWO objects, not one — the reprint idiom applies WITHIN each pair only", () => {
    expect(programFor("sv10.5b-094")).toBe(programFor("sv10.5b-009"));
    expect(programFor("sv10.5w-093")).toBe(programFor("sv10.5w-008"));
    expect(programFor("sv10.5w-008")).not.toBe(programFor("sv10.5b-009"));
    // …and the gates really are each other's, not each body's own.
    expect(programFor("sv10.5b-009")?.passive?.evolveEarlyExempt?.ifInPlay).toBe("Shelmet");
    expect(programFor("sv10.5w-008")?.passive?.evolveEarlyExempt?.ifInPlay).toBe("Karrablast");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The vocabulary member — `yourNamedPokemonInPlay`, ACTIVE + BENCH.
// ─────────────────────────────────────────────────────────────────────────────

describe("D279 — `yourNamedPokemonInPlay`", () => {
  const SHELMET_IN_PLAY = { kind: "yourNamedPokemonInPlay", name: "Shelmet" } as const;

  it("holds for a BENCHED partner and for an ACTIVE one — both zones, one member", () => {
    for (const seat of ["p1", "p2"] as const) {
      const benched = board(SEEDS[0], "p1", seat, PLAIN_KARRABLAST, [PLAIN_SHELMET, BYSTANDER]);
      expect(conditionHolds(benched, seat, SHELMET_IN_PLAY), `bench/${seat}`).toBe(true);
      const active = board(SEEDS[0], "p1", seat, PLAIN_SHELMET, [BYSTANDER, "fix-basic-1"]);
      expect(conditionHolds(active, seat, SHELMET_IN_PLAY), `active/${seat}`).toBe(true);
      expect(
        conditionHolds(active, seat, { kind: "yourBenchHasNamed", name: "Shelmet" }),
        `bench-only-control/${seat}`,
      ).toBe(false);
    }
  });

  it("is FALSE with no partner, and FALSE for a name nobody carries", () => {
    for (const seat of ["p1", "p2"] as const) {
      const none = board(SEEDS[1], "p2", seat, PLAIN_KARRABLAST, [BYSTANDER, "fix-basic-1"]);
      expect(conditionHolds(none, seat, SHELMET_IN_PLAY), `none/${seat}`).toBe(false);
      // The NAME control: without it "the gate holds" cannot be told from "the
      // gate is true whenever anything is in play".
      const partnered = board(SEEDS[1], "p2", seat, PLAIN_KARRABLAST, [PLAIN_SHELMET]);
      expect(
        conditionHolds(partnered, seat, { kind: "yourNamedPokemonInPlay", name: "Accelgor" }),
        `wrong-name/${seat}`,
      ).toBe(false);
    }
  });

  it("is SEAT-RELATIVE — the opponent's Shelmet does NOT satisfy YOUR clause", () => {
    // "If **you** have Shelmet in play." This is the fact that forced the seat
    // parameter onto `evolveEarlyLicensed`, and a fold-resolved build could not
    // have made it at all: `passivesOf` has no seat.
    for (const seat of ["p1", "p2"] as const) {
      const foe = seat === "p1" ? "p2" : "p1";
      let state = board(SEEDS[2], "p1", seat, PLAIN_KARRABLAST, [BYSTANDER, "fix-basic-1"]);
      state = clearBench(state, foe);
      state = benchFromDeck(state, foe, PLAIN_SHELMET);
      state = benchFromDeck(state, foe, "fix-basic-1");
      expect(conditionHolds(state, seat, SHELMET_IN_PLAY), `mine/${seat}`).toBe(false);
      // …and the control from the other side: the SAME board answers TRUE for the
      // seat that actually owns the Shelmet, so this is a seat split rather than a
      // board with no Shelmet on it.
      expect(conditionHolds(state, foe, SHELMET_IN_PLAY), `theirs/${seat}`).toBe(true);
    }
  });

  it("reads the STACK TOP — an evolved Shelmet stops being a Shelmet (§1.2)", () => {
    const first: Seat = "p1";
    let state = board(SEEDS[3], first, first, PLAIN_KARRABLAST, [PLAIN_SHELMET, BYSTANDER]);
    state = handFromDeck(state, first, ACCELGOR, 1);
    state = passTurns(state, 2); // clear the first-turn ban so the evolve is legal
    expect(conditionHolds(state, first, SHELMET_IN_PLAY), "before").toBe(true);
    const evolved = must(applyAction(state, evolveAt(first, handUidOf(state, first, ACCELGOR), 0)));
    const body = benchAt(evolved, first, 0);
    expect(evolved.cardIdByUid[body.stack[body.stack.length - 1] ?? ""]).toBe(ACCELGOR);
    expect(conditionHolds(evolved, first, SHELMET_IN_PLAY), "after").toBe(false);
  });

  it("`conditionNote` round-trips to the printed clause", () => {
    expect(conditionNote({ kind: "yourNamedPokemonInPlay", name: "Shelmet" })).toBe(
      "you have Shelmet in play",
    );
    expect(conditionNote({ kind: "yourBenchHasNamed", name: "Shelmet" })).toBe(
      "Shelmet is on your Bench",
    );
  });
});

describe("D279 — the zone gate is PER-PRINTING, not a property of the field", () => {
  it("carries the partner CONDITION unresolved — the fold does not answer it", () => {
    const state = board(SEEDS[0], "p1", "p1", "sv10.5b-009", [PLAIN_SHELMET, BYSTANDER]);
    // `toEqual` on the WHOLE list: a probe like `.length > 0` stays green on a
    // fold that pushed `undefined` (which would license unconditionally).
    expect(passivesOf(state, activeOf(state, "p1")).evolveEarlyExempt).toEqual([
      { kind: "yourNamedPokemonInPlay", name: "Shelmet" },
    ]);
    // The attribution control: the plain body pushes nothing at all.
    const plain = board(SEEDS[0], "p1", "p1", PLAIN_KARRABLAST, [PLAIN_SHELMET, BYSTANDER]);
    expect(passivesOf(plain, activeOf(plain, "p1")).evolveEarlyExempt).toEqual([]);
  });

  it("a BENCHED Karrablast STILL carries the licence — D278's zone gate REUSED would refuse it", () => {
    for (const seat of ["p1", "p2"] as const) {
      let state = board(SEEDS[1], "p1", seat, PLAIN_SHELMET, [BYSTANDER]);
      state = benchFromDeck(state, seat, "sv10.5b-009");
      const benched = benchAt(state, seat, state.players[seat].bench.length - 1);
      expect(passivesOf(state, benched).evolveEarlyExempt, `${seat}`).toEqual([
        { kind: "yourNamedPokemonInPlay", name: "Shelmet" },
      ]);
      let eevee = board(SEEDS[1], "p1", seat, PLAIN_SHELMET, [BYSTANDER]);
      eevee = benchFromDeck(eevee, seat, "sv08-143");
      expect(
        passivesOf(eevee, benchAt(eevee, seat, eevee.players[seat].bench.length - 1))
          .evolveEarlyExempt,
        `eevee/${seat}`,
      ).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The predicate — `evolveEarlyLicensed`, now with a SEAT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D279 — `evolveEarlyLicensed` and the partner gate", () => {
  it("licenses with the partner and refuses without — BOTH seats, BOTH going orders", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        const withPartner = board(SEEDS[0], first, seat, "sv10.5b-009", [PLAIN_SHELMET, BYSTANDER]);
        expect(
          evolveEarlyLicensed(withPartner, seat, activeOf(withPartner, seat)),
          `with/${first}/${seat}`,
        ).toBe(true);
        const alone = board(SEEDS[0], first, seat, "sv10.5b-009", [BYSTANDER, "fix-basic-1"]);
        expect(
          evolveEarlyLicensed(alone, seat, activeOf(alone, seat)),
          `alone/${first}/${seat}`,
        ).toBe(false);
      }
    }
  });

  it("the OPPONENT's Shelmet does not license YOUR Karrablast", () => {
    // The seat parameter, driven through the predicate rather than only through
    // `conditionHolds`. A build that passed the BODY's own side would be green on
    // every board where both seats happen to run the partner.
    for (const seat of ["p1", "p2"] as const) {
      const foe = seat === "p1" ? "p2" : "p1";
      let state = board(SEEDS[2], "p1", seat, "sv10.5b-009", [BYSTANDER, "fix-basic-1"]);
      state = clearBench(state, foe);
      state = benchFromDeck(state, foe, PLAIN_SHELMET);
      state = benchFromDeck(state, foe, "fix-basic-1");
      expect(evolveEarlyLicensed(state, seat, activeOf(state, seat)), `${seat}`).toBe(false);
    }
  });

  it("a §9 ABILITY-LOCK SILENCES THE LICENCE AND HANDS BOTH BANS BACK", () => {
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      let state = board(
        SEEDS[1],
        first,
        first,
        "sv10.5w-008",
        [PLAIN_KARRABLAST, BYSTANDER],
        ACCELGOR,
      );
      expect(evolveEarlyLicensed(state, first, activeOf(state, first)), `control/${first}`).toBe(
        true,
      );
      state = setActiveFromDeck(state, second, "sv01-096");
      expect(evolveEarlyLicensed(state, first, activeOf(state, first)), `locked/${first}`).toBe(
        false,
      );
      expect(
        conditionHolds(state, first, { kind: "yourNamedPokemonInPlay", name: "Karrablast" }),
        `partner-unaffected/${first}`,
      ).toBe(true);
      // …and the ban is really handed back at the handler, not only at the read.
      const result = applyAction(
        state,
        evolveAt(first, handUidOf(state, first, ACCELGOR), "active"),
      );
      expect(result.ok, `${first}`).toBe(false);
      if (result.ok) throw new Error("expected a refusal");
      expect(result.error.code, `${first}`).toBe("FIRST_TURN_EVOLVE");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The handler — BOTH bans, on BOTH zones.
// ─────────────────────────────────────────────────────────────────────────────

describe("D279 — `evolve` under the partner licence", () => {
  it("ALLOWS the licensed FIRST-TURN evolve, and the Stage 1 really lands", () => {
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const state = board(seed, first, first, "sv10.5b-009", [PLAIN_SHELMET, BYSTANDER]);
        const uid = handUidOf(state, first, ESCAVALIER);
        const result = applyAction(state, evolveAt(first, uid, "active"));
        expect(result.ok, `${seed}/${first}`).toBe(true);
        if (!result.ok) throw new Error(result.error.code);
        const active = activeOf(result.state, first);
        expect(active.stack[active.stack.length - 1], `${seed}/${first}`).toBe(uid);
      }
    }
  });

  it("REFUSES the same first-turn evolve with no partner — FIRST_TURN_EVOLVE", () => {
    // The attribution control for every `ok` above: without it they all pass on a
    // build that deleted §4/§10 outright.
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const state = board(seed, first, first, "sv10.5b-009", [BYSTANDER, "fix-basic-1"]);
        const result = applyAction(
          state,
          evolveAt(first, handUidOf(state, first, ESCAVALIER), "active"),
        );
        expect(result.ok, `${seed}/${first}`).toBe(false);
        if (result.ok) throw new Error("expected a refusal");
        expect(result.error.code, `${seed}/${first}`).toBe("FIRST_TURN_EVOLVE");
      }
    }
  });

  it("ALLOWS a BENCHED licensed body to evolve on turn 1 — the trap, at the HANDLER", () => {
    for (const first of ["p1", "p2"] as const) {
      let state = board(first === "p1" ? SEEDS[3] : SEEDS[4], first, first, PLAIN_SHELMET, [
        BYSTANDER,
      ]);
      state = benchFromDeck(state, first, "sv10.5b-009");
      const index = state.players[first].bench.length - 1;
      const uid = handUidOf(state, first, ESCAVALIER);
      const result = applyAction(state, evolveAt(first, uid, index));
      expect(result.ok, `${first}`).toBe(true);
      if (!result.ok) throw new Error(result.error.code);
      const body = benchAt(result.state, first, index);
      expect(body.stack[body.stack.length - 1], `${first}`).toBe(uid);
    }
  });

  it("LIFTS BAN 2 TOO — a body played THIS turn, on a LATER turn", () => {
    for (const first of ["p1", "p2"] as const) {
      let state = board(
        SEEDS[2],
        first,
        first,
        "sv10.5w-008",
        [PLAIN_KARRABLAST, BYSTANDER],
        ACCELGOR,
      );
      state = passTurns(state, 2);
      state = stampPlayedThisTurn(state, first, "active");
      const uid = handUidOf(state, first, ACCELGOR);
      const result = applyAction(state, evolveAt(first, uid, "active"));
      expect(result.ok, `${first}`).toBe(true);
      if (!result.ok) throw new Error(result.error.code);
      const active = activeOf(result.state, first);
      expect(active.stack[active.stack.length - 1], `${first}`).toBe(uid);
    }
  });

  it("REFUSES ban 2 without the partner — EVOLVE_TOO_SOON, the code that proves it was ban 2", () => {
    for (const first of ["p1", "p2"] as const) {
      let state = board(
        SEEDS[2],
        first,
        first,
        "sv10.5w-008",
        [BYSTANDER, "fix-basic-1"],
        ACCELGOR,
      );
      state = passTurns(state, 2);
      state = stampPlayedThisTurn(state, first, "active");
      const result = applyAction(
        state,
        evolveAt(first, handUidOf(state, first, ACCELGOR), "active"),
      );
      expect(result.ok, `${first}`).toBe(false);
      if (result.ok) throw new Error("expected a refusal");
      expect(result.error.code, `${first}`).toBe("EVOLVE_TOO_SOON");
    }
  });

  it("the licence is LIVE — evolving the PARTNER away ends it mid-turn", () => {
    // The gate reads the stack TOP, so a Shelmet that became an Accelgor stops
    // licensing its Karrablast — and this is the board that proves the read is
    // recomputed rather than latched at setup.
    for (const first of ["p1", "p2"] as const) {
      let state = board(SEEDS[0], first, first, "sv10.5b-009", [PLAIN_SHELMET, BYSTANDER]);
      state = handFromDeck(state, first, ACCELGOR, 1);
      expect(evolveEarlyLicensed(state, first, activeOf(state, first)), `before/${first}`).toBe(
        true,
      );
      state = passTurns(state, 2);
      state = must(applyAction(state, evolveAt(first, handUidOf(state, first, ACCELGOR), 0)));
      expect(evolveEarlyLicensed(state, first, activeOf(state, first)), `after/${first}`).toBe(
        false,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. `MATCH_RECORD_VERSION` — the DERIVATION, and the direction that IS drivable.
// ─────────────────────────────────────────────────────────────────────────────

describe("D279 — MATCH_RECORD_VERSION stays 14, and the claim is MEASURED", () => {
  it("a LICENSED evolve writes exactly the keys an ordinary one writes — a DIFF, not a claim", () => {
    const first: Seat = "p1";
    const licensedBoard = board(SEEDS[0], first, first, "sv10.5b-009", [PLAIN_SHELMET, BYSTANDER]);
    const viaLicence = must(
      applyAction(
        licensedBoard,
        evolveAt(first, handUidOf(licensedBoard, first, ESCAVALIER), "active"),
      ),
    );
    let plainBoard = board(SEEDS[0], first, first, PLAIN_KARRABLAST, [BYSTANDER, "fix-basic-1"]);
    plainBoard = passTurns(plainBoard, 2);
    const viaRules = must(
      applyAction(plainBoard, evolveAt(first, handUidOf(plainBoard, first, ESCAVALIER), "active")),
    );
    const PERSISTED_BODY_KEYS = [
      "attackBlock",
      "attackDamageDebuff",
      "attackDamageTaken",
      "attackFlipLockTurn",
      "attackLockedTurn",
      "attackTwoFlipLockTurn",
      "benchedTurn",
      "boostedAttack",
      "conditions",
      "costTaxTurn",
      "damage",
      "damageReduction",
      "damageVulnerability",
      "energy",
      "evolvedTurn",
      "handAttachMark",
      "healedTurn",
      "installedRecoil",
      "koBounty",
      "lockedAttacks",
      "markers",
      "noWeaknessTurn",
      "promotedTurn",
      "retreatBlocked",
      "retreatLockedTurn",
      "scheduledEffect",
      "stack",
      "tools",
      "turnPlayed",
      "usedAttack",
      "weaknessRetype",
    ];
    expect(Object.keys(activeOf(viaLicence, first)).sort()).toEqual(PERSISTED_BODY_KEYS);
    expect(Object.keys(activeOf(viaLicence, first)).sort()).toEqual(
      Object.keys(activeOf(viaRules, first)).sort(),
    );
    // …and the top-level `GameState` keys, since a licence that had needed a
    // board-level field would show up here and nowhere else.
    expect(Object.keys(viaLicence).sort()).toEqual(Object.keys(viaRules).sort());
    expect(viaLicence.phase.kind).toBe("turn:action");
    expect(viaLicence.phase).not.toHaveProperty("cont");
  });
});

describe("D279 — `yourBenchHasNamed` is UNCHANGED, and Falinks sv02-119 is why", () => {
  it("still refuses the Active Spot — the printing that depends on it being narrow", () => {
    for (const seat of ["p1", "p2"] as const) {
      const state = board(SEEDS[4], "p1", seat, "sv02-119", [BYSTANDER, "fix-basic-1"]);
      expect(
        conditionHolds(state, seat, { kind: "yourBenchHasNamed", name: "Falinks" }),
        `active-only/${seat}`,
      ).toBe(false);
      expect(
        conditionHolds(state, seat, { kind: "yourNamedPokemonInPlay", name: "Falinks" }),
        `in-play/${seat}`,
      ).toBe(true);
    }
  });

  it("still holds for a BENCHED Falinks — the member did not lose anything either", () => {
    for (const seat of ["p1", "p2"] as const) {
      const state = board(SEEDS[4], "p1", seat, PLAIN_KARRABLAST, ["sv02-119", BYSTANDER]);
      expect(
        conditionHolds(state, seat, { kind: "yourBenchHasNamed", name: "Falinks" }),
        `${seat}`,
      ).toBe(true);
    }
  });
});
