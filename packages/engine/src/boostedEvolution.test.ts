import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { rareCandyOptions } from "./cardplay";
import { passivesOf } from "./continuous";
import { evolveEarlyLicensed } from "./boardCondition";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, programFor } from "./index";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  setActiveFromDeck,
  must,
  activeOf,
  driveSetup,
} from "./testFixtures";

const BOOSTED_EVOLUTION_TEXT =
  "As long as this Pokémon is in the Active Spot, it can evolve during your first turn or the turn you play it.";

const RECKLESS_CHARGE_TEXT = "This Pokémon also does 10 damage to itself.";

const BOOSTED_IDS = ["sv08-143", "sv08.5-074", "svp-173"] as const;

function eevee(id: string): Card {
  return battler(id, {
    name: "Eevee",
    hp: 50,
    retreat: 1,
    types: ["Colorless"],
    abilities: [{ type: "Ability", name: "Boosted Evolution", effect: BOOSTED_EVOLUTION_TEXT }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Reckless Charge",
        damage: 30,
        effect: RECKLESS_CHARGE_TEXT,
      },
    ],
  });
}

const UNLICENSED = "fix-plain-eevee";

/** The Stage 1 that evolves from Eevee — a LOCAL fixture, because the point is
    the TIMING rule and not any particular Eeveelution. */
const STAGE1 = "fix-eeveelution";
const STAGE2 = "fix-eeveestage2";

const LOCAL_CARDS: Record<string, Card> = {
  "sv08-143": eevee("sv08-143"),
  "sv08.5-074": eevee("sv08.5-074"),
  "svp-173": eevee("svp-173"),
  [UNLICENSED]: battler(UNLICENSED, {
    name: "Eevee",
    hp: 50,
    retreat: 1,
    types: ["Colorless"],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Reckless Charge",
        damage: 30,
        effect: RECKLESS_CHARGE_TEXT,
      },
    ],
  }),
  [STAGE1]: battler(STAGE1, {
    name: "Eeveelution",
    stage: "Stage1",
    evolveFrom: "Eevee",
    hp: 110,
    types: ["Colorless"],
  }),
  [STAGE2]: battler(STAGE2, {
    name: "Eeveelution Prime",
    stage: "Stage2",
    evolveFrom: "Eeveelution",
    hp: 170,
    types: ["Colorless"],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const EEVEE_DECK = deckOf({
  "sv08-143": 4,
  "sv08.5-074": 4,
  "svp-173": 4,
  [UNLICENSED]: 4,
  [STAGE1]: 8,
  [STAGE2]: 4,
  "sv01-191": 4, // Rare Candy — the REFUSED site, driven off a local chain
  "sv01-096": 2, // Klefki — the §9 Ability-lock control
  "fix-basic-1": 4,
  "fix-energy": 22,
});

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: EEVEE_DECK, p2: EEVEE_DECK }, { pool: POOL, first });
}

function board(seed: number, first: Seat, seat: Seat, activeId: string, stage1 = 1): GameState {
  let state = localSetup(seed, first);
  state = setActiveFromDeck(state, seat, activeId);
  state = clearBench(state, seat);
  state = benchFromDeck(state, seat, "fix-basic-1");
  return handFromDeck(state, seat, STAGE1, stage1);
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

function stampPlayedThisTurn(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  if (side.active === null) throw new Error(`${seat} has no Active`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...side.active, turnPlayed: state.turn } },
    },
  };
}

function evolveActive(seat: Seat, uid: string) {
  return { type: "evolve", seat, uid, target: { spot: "active" } } as const;
}

const SEEDS = [7, 23, 41, 66, 90] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. The registry rows — the printed sentence, as data.
// ─────────────────────────────────────────────────────────────────────────────

describe("Eevee 'Boosted Evolution' — the three printings as registry data", () => {
  it("all THREE ids resolve to ONE program that is the licence and nothing else", () => {
    for (const id of BOOSTED_IDS) {
      expect(programFor(id), id).toEqual({ passive: { evolveEarlyExempt: { activeOnly: true } } });
      expect(programFor(id)?.abilities, id).toBeUndefined();
      expect(programFor(id)?.attack, id).toBeUndefined();
      // …and NOT either of the two neighbouring first-turn flags, which is the
      // claim the registry's three adjacent rows make and one edit could break.
      expect(programFor(id)?.passive?.attackFirstTurnExempt, id).toBeUndefined();
      expect(programFor(id)?.trainerFirstTurnExempt, id).toBeUndefined();
    }
    // All three share ONE object (D8's reprint rule).
    expect(new Set(BOOSTED_IDS.map((id) => programFor(id))).size).toBe(1);
  });

  it("the fixtures carry the printed bytes VERBATIM — every scalar, not just the read ones", () => {
    for (const id of BOOSTED_IDS) {
      expect(POOL[id]?.abilities?.[0]?.effect, id).toBe(BOOSTED_EVOLUTION_TEXT);
      expect(POOL[id]?.abilities?.[0]?.name, id).toBe("Boosted Evolution");
      expect(POOL[id]?.name, id).toBe("Eevee");
      expect(POOL[id]?.hp, id).toBe(50);
      expect(POOL[id]?.retreat, id).toBe(1);
      expect(POOL[id]?.stage, id).toBe("Basic");
      expect(POOL[id]?.evolveFrom, id).toBeNull();
      expect(POOL[id]?.types, id).toEqual(["Colorless"]);
      // ONE attack, at its printed index, with its printed cost/damage/effect.
      expect(POOL[id]?.attacks?.length, id).toBe(1);
      expect(POOL[id]?.attacks?.[0]?.name, id).toBe("Reckless Charge");
      expect(POOL[id]?.attacks?.[0]?.damage, id).toBe(30);
      expect(POOL[id]?.attacks?.[0]?.cost, id).toEqual(["Colorless", "Colorless"]);
      expect(POOL[id]?.attacks?.[0]?.effect, id).toBe(RECKLESS_CHARGE_TEXT);
    }
    expect(POOL[UNLICENSED]?.abilities ?? []).toEqual([]);
    expect(POOL[UNLICENSED]?.name).toBe(POOL["sv08-143"]?.name);
    expect(POOL[UNLICENSED]?.hp).toBe(POOL["sv08-143"]?.hp);
    expect(POOL[UNLICENSED]?.stage).toBe(POOL["sv08-143"]?.stage);
    expect(POOL[UNLICENSED]?.types).toEqual(POOL["sv08-143"]?.types);
    // …and the chain the whole suite rests on really links.
    expect(POOL[STAGE1]?.evolveFrom).toBe("Eevee");
    expect(POOL[STAGE2]?.evolveFrom).toBe(POOL[STAGE1]?.name);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The fold — `passivesOf`, its ZONE gate, and the §9 channel it rides.
// ─────────────────────────────────────────────────────────────────────────────

describe("D278 — `evolveEarlyExempt` in the passivesOf fold", () => {
  it("carries ONE UNCONDITIONAL entry for a licensed ACTIVE and NONE for one without", () => {
    const licensed = board(SEEDS[0], "p1", "p1", "sv08-143");
    expect(passivesOf(licensed, activeOf(licensed, "p1")).evolveEarlyExempt).toEqual([undefined]);
    const plain = board(SEEDS[0], "p1", "p1", UNLICENSED);
    expect(passivesOf(plain, activeOf(plain, "p1")).evolveEarlyExempt).toEqual([]);
  });

  it("is EMPTY on the BENCH — the printed 'As long as this Pokémon is in the Active Spot'", () => {
    let state = board(SEEDS[1], "p2", "p2", UNLICENSED);
    state = benchFromDeck(state, "p2", "sv08.5-074");
    const benched = benchAt(state, "p2", state.players.p2.bench.length - 1);
    expect(passivesOf(state, benched).evolveEarlyExempt).toEqual([]);
    // …and the control: the identical card IS licensed once it is the Active.
    const active = board(SEEDS[1], "p2", "p2", "sv08.5-074");
    expect(passivesOf(active, activeOf(active, "p2")).evolveEarlyExempt).toEqual([undefined]);
  });

  it("a LIST and not a boolean — D279's shape, and why the change was forced", () => {
    const licensed = board(SEEDS[2], "p1", "p1", "svp-173");
    expect(Array.isArray(passivesOf(licensed, activeOf(licensed, "p1")).evolveEarlyExempt)).toBe(
      true,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The predicate — `evolveEarlyLicensed`, the ONE read five ban lines share.
// ─────────────────────────────────────────────────────────────────────────────

describe("D278 — `evolveEarlyLicensed`, the extracted §4/§10 read", () => {
  it("licenses the Eevee and refuses the control — under BOTH going-order assignments", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        const licensed = board(SEEDS[0], first, seat, "sv08-143");
        expect(
          evolveEarlyLicensed(licensed, seat, activeOf(licensed, seat)),
          `${first}/${seat}`,
        ).toBe(true);
        const plain = board(SEEDS[0], first, seat, UNLICENSED);
        expect(evolveEarlyLicensed(plain, seat, activeOf(plain, seat)), `${first}/${seat}`).toBe(
          false,
        );
      }
    }
  });

  it("a §9 ABILITY-LOCK SILENCES THE LICENCE AND HANDS BOTH BANS BACK", () => {
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      let state = board(SEEDS[1], first, first, "svp-173");
      // The control FIRST: without the lock the same board is licensed.
      expect(evolveEarlyLicensed(state, first, activeOf(state, first)), `${first}`).toBe(true);
      state = setActiveFromDeck(state, second, "sv01-096");
      expect(evolveEarlyLicensed(state, first, activeOf(state, first)), `${first}`).toBe(false);
      // …and the ban is really handed back at the handler, not only at the read.
      const uid = handUidOf(state, first, STAGE1);
      const result = applyAction(state, evolveActive(first, uid));
      expect(result.ok, `${first}`).toBe(false);
      if (result.ok) throw new Error("expected a refusal");
      expect(result.error.code, `${first}`).toBe("FIRST_TURN_EVOLVE");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. BAN 1 — §4's first-turn evolve ban, DRIVEN, both directions, every seed.
// ─────────────────────────────────────────────────────────────────────────────

describe("D278 — BAN 1 (§4/§10 first turn) and its licence, through `evolve`", () => {
  it("REFUSES an unlicensed first-turn evolve with FIRST_TURN_EVOLVE — BOTH seats", () => {
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const second = first === "p1" ? "p2" : "p1";
        const t1 = board(seed, first, first, UNLICENSED);
        expect(t1.turn, `${seed}/${first}`).toBe(1);
        const r1 = applyAction(t1, evolveActive(first, handUidOf(t1, first, STAGE1)));
        expect(r1.ok, `${seed}/${first}`).toBe(false);
        if (r1.ok) throw new Error("expected a refusal");
        expect(r1.error.code, `${seed}/${first}`).toBe("FIRST_TURN_EVOLVE");

        const t2 = passTurns(board(seed, first, second, UNLICENSED), 1);
        expect(t2.turn, `${seed}/${first}`).toBe(2);
        const r2 = applyAction(t2, evolveActive(second, handUidOf(t2, second, STAGE1)));
        expect(r2.ok, `${seed}/${first}`).toBe(false);
        if (r2.ok) throw new Error("expected a refusal");
        expect(r2.error.code, `${seed}/${first}`).toBe("FIRST_TURN_EVOLVE");
      }
    }
  });

  it("ALLOWS the licensed first-turn evolve, and the Stage 1 really lands on the stack", () => {
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const state = board(seed, first, first, "sv08-143");
        const uid = handUidOf(state, first, STAGE1);
        const result = applyAction(state, evolveActive(first, uid));
        expect(result.ok, `${seed}/${first}`).toBe(true);
        if (!result.ok) throw new Error(result.error.code);
        const active = activeOf(result.state, first);
        expect(active.stack[active.stack.length - 1], `${seed}/${first}`).toBe(uid);
        expect(evolveEarlyLicensed(result.state, first, active), `${seed}/${first}`).toBe(false);
      }
    }
  });

  it("the ban still binds the OTHER seat's licensed body — the licence is per-BODY", () => {
    // A licensed Eevee on p2's board does not license p1's evolve, and vice versa:
    // the read takes the TARGET, so there is no seat-wide channel to leak through.
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      let state = board(SEEDS[3], first, first, UNLICENSED);
      state = setActiveFromDeck(state, second, "sv08-143");
      const result = applyAction(state, evolveActive(first, handUidOf(state, first, STAGE1)));
      expect(result.ok, `${first}`).toBe(false);
      if (result.ok) throw new Error("expected a refusal");
      expect(result.error.code, `${first}`).toBe("FIRST_TURN_EVOLVE");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. BAN 2 — "or the turn you play it". THE CASE THAT SEPARATES THE TWO BUILDS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D278 — BAN 2 (§10 came into play this turn), the half turn 1 cannot show", () => {
  it("REFUSES an unlicensed body played THIS turn with EVOLVE_TOO_SOON, on a LATER turn", () => {
    for (const first of ["p1", "p2"] as const) {
      // Turn 3 — nobody's first turn, so BAN 1 is silent and only BAN 2 can speak.
      const state = stampPlayedThisTurn(
        passTurns(board(SEEDS[0], first, first, UNLICENSED), 2),
        first,
      );
      expect(state.turn, `${first}`).toBe(3);
      expect(activeOf(state, first).turnPlayed, `${first}`).toBe(3);
      const result = applyAction(state, evolveActive(first, handUidOf(state, first, STAGE1)));
      expect(result.ok, `${first}`).toBe(false);
      if (result.ok) throw new Error("expected a refusal");
      expect(result.error.code, `${first}`).toBe("EVOLVE_TOO_SOON");
    }
  });

  it("ALLOWS the LICENSED body played THIS turn — the clause a one-ban build drops", () => {
    for (const first of ["p1", "p2"] as const) {
      const state = stampPlayedThisTurn(
        passTurns(board(SEEDS[0], first, first, "sv08-143"), 2),
        first,
      );
      expect(state.turn, `${first}`).toBe(3);
      expect(activeOf(state, first).turnPlayed, `${first}`).toBe(3);
      const uid = handUidOf(state, first, STAGE1);
      const result = applyAction(state, evolveActive(first, uid));
      expect(result.ok, `${first}`).toBe(true);
      if (!result.ok) throw new Error(result.error.code);
      const active = activeOf(result.state, first);
      expect(active.stack[active.stack.length - 1], `${first}`).toBe(uid);
    }
  });

  it("BOTH bans fire at once on turn 1 for a body played turn 1, and ONE licence lifts BOTH", () => {
    // The board where the two bans OVERLAP — the going-first seat's turn 1 with a
    // body stamped this turn. The control reports BAN 1 (it is checked first); the
    // licensed body evolves anyway, which is only possible if BOTH were lifted.
    for (const first of ["p1", "p2"] as const) {
      const plain = stampPlayedThisTurn(board(SEEDS[4], first, first, UNLICENSED), first);
      expect(plain.turn, `${first}`).toBe(1);
      expect(activeOf(plain, first).turnPlayed, `${first}`).toBe(1);
      const r = applyAction(plain, evolveActive(first, handUidOf(plain, first, STAGE1)));
      expect(r.ok, `${first}`).toBe(false);
      if (r.ok) throw new Error("expected a refusal");
      expect(r.error.code, `${first}`).toBe("FIRST_TURN_EVOLVE");

      const licensed = stampPlayedThisTurn(board(SEEDS[4], first, first, "sv08.5-074"), first);
      expect(
        applyAction(licensed, evolveActive(first, handUidOf(licensed, first, STAGE1))).ok,
      ).toBe(true);
    }
  });

  it("does NOT license a BENCHED body played this turn — the Active-Spot clause, at the handler", () => {
    // The fold's zone gate, driven through `evolve` rather than through
    // `passivesOf`: the same licensed card, on the bench, played this turn, on a
    // turn that is nobody's first. Ban 2 stands.
    let state = passTurns(board(SEEDS[2], "p1", "p1", UNLICENSED), 2);
    state = benchFromDeck(state, "p1", "sv08-143");
    const index = state.players.p1.bench.length - 1;
    const side = state.players.p1;
    const bench = [...side.bench];
    const benched = benchAt(state, "p1", index);
    bench[index] = { ...benched, turnPlayed: state.turn };
    state = { ...state, players: { ...state.players, p1: { ...side, bench } } };
    const result = applyAction(state, {
      type: "evolve",
      seat: "p1",
      uid: handUidOf(state, "p1", STAGE1),
      target: { spot: "bench", index },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("EVOLVE_TOO_SOON");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE OTHER THREE BAN LINES — `rareCandy` and its HUD projection.
// ─────────────────────────────────────────────────────────────────────────────

describe("D278 — the licence DOES NOT reach the Rare Candy sites (§7.1)", () => {
  function candyBoard(seed: number, first: Seat, seat: Seat, activeId: string): GameState {
    let state = board(seed, first, seat, activeId);
    state = handFromDeck(state, seat, "sv01-191", 1);
    return handFromDeck(state, seat, STAGE2, 1);
  }

  function candyAction(state: GameState, seat: Seat) {
    return {
      type: "rareCandy",
      seat,
      uid: handUidOf(state, seat, "sv01-191"),
      evolutionUid: handUidOf(state, seat, STAGE2),
      target: { spot: "active" },
    } as const;
  }

  it("REFUSES a first-turn Rare Candy on a LICENSED Eevee — the card's OWN restriction", () => {
    for (const first of ["p1", "p2"] as const) {
      const licensed = candyBoard(SEEDS[0], first, first, "sv08-143");
      // The control FIRST: the very same body IS licensed for a plain `evolve` on
      // this very board, so the refusal below is about the CARD and not the body.
      expect(evolveEarlyLicensed(licensed, first, activeOf(licensed, first)), `${first}`).toBe(
        true,
      );
      expect(
        applyAction(licensed, evolveActive(first, handUidOf(licensed, first, STAGE1))).ok,
      ).toBe(true);
      const refused = applyAction(licensed, candyAction(licensed, first));
      expect(refused.ok, `${first}`).toBe(false);
      if (refused.ok) throw new Error("expected a refusal");
      expect(refused.error.code, `${first}`).toBe("FIRST_TURN_EVOLVE");
    }
  });

  it("REFUSES Rare Candy on a LICENSED body played THIS turn, on a later turn too", () => {
    // Ban 2's half of the same decision: the licence lifts it at `evolve` on this
    // exact board (asserted first, so this is a difference between SITES and not
    // between boards) and does not lift it here.
    for (const first of ["p1", "p2"] as const) {
      const state = stampPlayedThisTurn(
        passTurns(candyBoard(SEEDS[1], first, first, "svp-173"), 2),
        first,
      );
      expect(state.turn, `${first}`).toBe(3);
      expect(applyAction(state, evolveActive(first, handUidOf(state, first, STAGE1))).ok).toBe(
        true,
      );
      const refused = applyAction(state, candyAction(state, first));
      expect(refused.ok, `${first}`).toBe(false);
      if (refused.ok) throw new Error("expected a refusal");
      expect(refused.error.code, `${first}`).toBe("EVOLVE_TOO_SOON");
    }
  });

  it("`rareCandyOptions` MIRRORS the handler — no option on turn 1, licensed or not", () => {
    for (const first of ["p1", "p2"] as const) {
      const plain = candyBoard(SEEDS[2], first, first, UNLICENSED);
      expect(rareCandyOptions(plain, first), `${first}`).toEqual([]);
      const licensed = candyBoard(SEEDS[2], first, first, "sv08-143");
      expect(rareCandyOptions(licensed, first), `${first}`).toEqual([]);
    }
  });

  it("…and OFFERS the option once BOTH bans are genuinely clear — the non-vacuous control", () => {
    const state = passTurns(candyBoard(SEEDS[3], "p1", "p1", "sv08-143"), 2);
    expect(state.turn).toBe(3);
    const options = rareCandyOptions(state, "p1");
    expect(options.length).toBe(1);
    expect(options[0]?.target).toEqual({ spot: "active" });
    expect(options[0]?.stage2Uids).toContain(handUidOf(state, "p1", STAGE2));
    for (const uid of options[0]?.stage2Uids ?? []) {
      expect(state.cardIdByUid[uid]).toBe(STAGE2);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. THE LICENCE IS NOT A GENERAL PERMIT — the sweep that bounds it.
// ─────────────────────────────────────────────────────────────────────────────

describe("D278 — what the licence does NOT do", () => {
  it("leaves the §10 EVOLVE_MISMATCH rule alone — it lifts TIMING and nothing else", () => {
    // A licensed Eevee still cannot be evolved by a card that does not evolve
    // FROM it. The licence widens WHEN, never WHAT — a build that returned early
    // on `licensed` would pass every timing case above and fail here.
    const state = board(SEEDS[0], "p1", "p1", "sv08-143");
    const wrong = handFromDeck(state, "p1", STAGE2, 1);
    const result = applyAction(wrong, evolveActive("p1", handUidOf(wrong, "p1", STAGE2)));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("EVOLVE_MISMATCH");
  });

  it("does not license the seat's OTHER bodies — an unlicensed bench body is still too soon", () => {
    let state = passTurns(board(SEEDS[1], "p1", "p1", "sv08-143"), 2);
    state = benchFromDeck(state, "p1", UNLICENSED);
    const index = state.players.p1.bench.length - 1;
    const side = state.players.p1;
    const bench = [...side.bench];
    const benched = benchAt(state, "p1", index);
    bench[index] = { ...benched, turnPlayed: state.turn };
    state = { ...state, players: { ...state.players, p1: { ...side, bench } } };
    const result = applyAction(state, {
      type: "evolve",
      seat: "p1",
      uid: handUidOf(state, "p1", STAGE1),
      target: { spot: "bench", index },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("EVOLVE_TOO_SOON");
  });

  it("still refuses a body that already evolved this turn — ban 2's OTHER rule survives", () => {
    const state = board(SEEDS[0], "p1", "p1", "sv08-143", 2);
    const first = handUidOf(state, "p1", STAGE1);
    const evolved = must(applyAction(state, evolveActive("p1", first)));
    const second = state.players.p1.hand.filter((h) => state.cardIdByUid[h] === STAGE1)[1];
    if (second === undefined) throw new Error("expected a second Stage 1 in hand");
    const result = applyAction(evolved, evolveActive("p1", second));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    // EVOLVE_MISMATCH, not EVOLVE_TOO_SOON: the top card is now the Stage 1, and
    // nothing in this deck evolves from it. Recorded as what it IS rather than as
    // what the rule is named — the second evolve is refused either way.
    expect(result.error.code).toBe("EVOLVE_MISMATCH");
  });
});
