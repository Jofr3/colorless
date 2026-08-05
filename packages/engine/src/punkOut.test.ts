import { describe, expect, it } from "vitest";
import {
  disabledAbilityUids,
  effectiveRetreatCost,
  hasFreeRetreatSelf,
  pokemonSuffixOf,
  programFor,
  redactGame,
  topCardOf,
} from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import {
  FIXTURE_POOL,
  PUNK_OUT_DECK,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.64.0 → 0.65.0 — Wimpod swsh10.5-025 "Punk Out" (P3-M5 long tail, D114): "If
// your opponent has any Pokémon V in play, this Pokémon has no Retreat Cost."
//
// The TENTH and last open print on the retreat-COST seam, which closes at 10/10
// within the ingested pool. What it turns on:
//
//   • a SELF-only set-to-zero with a CROSS-BOARD predicate — a shape with no
//     precedent. Every retreat modifier before it either reached OTHER Pokémon
//     through a dedicated aura scan (Lunar Zone D108, Trap Territory D111) or
//     modified its holder through the seat-free `passivesOf` fold. This one
//     modifies only its holder yet must look across the table, so it gets the
//     sixth aura-family scan, `hasFreeRetreatSelf`, which reads the HOLDER's own
//     passive and derives the seat purely so "your opponent" resolves — leaving
//     `effectiveRetreatCost`'s signature and all FOUR of its readers untouched;
//   • "in play" is Active + BENCH: no clause in the sentence scopes either end to
//     the Active Spot, so a benched opposing V frees Wimpod just as an Active one
//     does. Getting that wrong would be silent;
//   • "Pokémon V" is LITERAL — `pokemonSuffixOf` matches " VMAX"/" VSTAR" before
//     the bare " V" — so a VMAX or an ex across the table frees nothing;
//   • and Wimpod is a BASIC, so this is the aura family's SECOND assertable §9
//     POSITIVE (after D113's Snorlax): an Active Klefki's "Mischievous Lock"
//     really does silence Punk Out and the printed 3 snaps back.

const ABILITY_TEXT =
  "If your opponent has any Pokémon V in play, this Pokémon has no Retreat Cost.";

/** Every in-play Pokémon of `seat` — Active + Bench, which is exactly the scope
    the printed "in play" carries at both ends. */
function inPlay(state: GameState, seat: Seat): InPlayPokemon[] {
  const side = state.players[seat];
  return side.active === null ? side.bench : [side.active, ...side.bench];
}

/** `seat`'s in-play Pokémon V — the predicate's witnesses. Every "no V in play"
    control below asserts this is EMPTY, so an unlucky auto-benched starter fails
    the test loudly instead of passing it vacuously. */
function vInPlay(state: GameState, seat: Seat): InPlayPokemon[] {
  return inPlay(state, seat).filter((pokemon) => {
    const card = topCardOf(state, pokemon);
    return card !== undefined && pokemonSuffixOf(card) === "V";
  });
}

/** Setup on P1's open turn with BOTH Active spots pinned to a neutral 200 HP
    fix-bigbody, and BOTH boards asserted V-free. Pinning keeps the controls
    seed-independent — PUNK_OUT_DECK carries the holder, a V, a VMAX, an ex and a
    Klefki, any of which the mulligan-free starter could otherwise be, and each
    would silently arm (or silence) the very predicate under test. Each displaced
    starter lands on its own bench, which is what a retreat then promotes. */
function board(seed: number): GameState {
  let state = driveSetup(seed, { p1: PUNK_OUT_DECK, p2: PUNK_OUT_DECK }, { first: "p1" });
  state = setActiveFromDeck(state, "p1", "fix-bigbody");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  for (const seat of ["p1", "p2"] as const) {
    if (vInPlay(state, seat).length > 0) throw new Error(`seed ${seed} opened a V on ${seat}`);
  }
  return state;
}

/** `seat`'s Active — the holder every cost assertion below reads. */
function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return active;
}

/** The body `benchFromDeck` just appended to `seat`'s bench, VERIFIED to be
    `cardId` rather than trusted by slot: every bench here already holds the
    starter the Active surgery displaced, and PUNK_OUT_DECK runs several copies of
    each body — so a bare index could read a same-named neighbour instead. */
function justBenched(state: GameState, seat: Seat, cardId: string): InPlayPokemon {
  const benched = state.players[seat].bench.at(-1);
  if (benched === undefined) throw new Error(`${seat} has an empty bench`);
  const id = state.cardIdByUid[benched.stack.at(-1) ?? ""];
  if (id !== cardId) throw new Error(`${seat}'s bench tip is ${id}, expected ${cardId}`);
  return benched;
}

/** P1's redacted retreat option — it rides the turn:action phase, and only the
    turn owner gets one. */
function retreatOnWire(state: GameState) {
  const phase = redactGame(state, "p1").phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.retreat;
}

describe("Punk Out — the registry data row (noRetreatCostSelf)", () => {
  it("authors swsh10.5-025 as a V-gated noRetreatCostSelf passive", () => {
    expect(programFor("swsh10.5-025")?.passive).toEqual({
      noRetreatCostSelf: { requiresOpponentSuffixInPlay: "V" },
    });
  });

  it("is the ONLY row carrying the field — the census claim", () => {
    // REGISTRY itself is not exported, so the sweep runs over every id the engine
    // can field (FIXTURE_POOL) plus the other NINE rows the local D1's
    // `%retreat cost%` census returns: the two Stadiums, the four readers and the
    // three Spidops ex printings. Wimpod is the tenth and the only self-only one.
    const seam = [
      "sv01-002",
      "sv01-019",
      "sv01-167",
      "sv01-223",
      "sv01-243",
      "sv02-175",
      "sv03-047",
      "sv03-082",
      "sv03-172",
    ];
    const carriers = [...new Set([...Object.keys(FIXTURE_POOL), ...seam])].filter(
      (id) => programFor(id)?.passive?.noRetreatCostSelf !== undefined,
    );
    expect(carriers).toEqual(["swsh10.5-025"]);
  });

  it("keeps the fixture's printed row verbatim", () => {
    const card = FIXTURE_POOL["swsh10.5-025"];
    expect(card?.abilities?.[0]).toEqual({
      type: "Ability",
      name: "Punk Out",
      effect: ABILITY_TEXT,
    });
    expect(card?.attacks?.[0]).toEqual({ cost: ["Water"], name: "Gnaw", damage: 10 });
    expect(card?.hp).toBe(70);
    expect(card?.retreat).toBe(3);
    expect(card?.stage).toBe("Basic");
    expect(card?.types).toEqual(["Water"]);
    expect(card?.weaknesses).toEqual([{ type: "Lightning", value: "×2" }]);
    // The byte facts: this sentence carries NO apostrophe of either kind (the
    // pool's cleanest verbatim guard), and its "Pokémon" is a real U+00E9 é.
    expect(ABILITY_TEXT).not.toContain("'");
    expect(ABILITY_TEXT).not.toContain("’");
    expect(ABILITY_TEXT).toContain("Pokémon");
  });
});

describe("Punk Out — the cross-board predicate", () => {
  it("with no Pokémon V opposite, the printed 3 stands", () => {
    const state = setActiveFromDeck(board(1), "p1", "swsh10.5-025");
    expect(vInPlay(state, "p2")).toHaveLength(0);
    expect(hasFreeRetreatSelf(state, activeOf(state, "p1"))).toBe(false);
    expect(effectiveRetreatCost(state, activeOf(state, "p1"))).toBe(3);
  });

  it("an opposing ACTIVE Pokémon V zeroes it", () => {
    let state = setActiveFromDeck(board(2), "p1", "swsh10.5-025");
    state = setActiveFromDeck(state, "p2", "fix-attacker-v");
    expect(hasFreeRetreatSelf(state, activeOf(state, "p1"))).toBe(true);
    expect(effectiveRetreatCost(state, activeOf(state, "p1"))).toBe(0);
  });

  it("an opposing BENCHED Pokémon V zeroes it too — 'in play' is not Active-only", () => {
    // The sentence carries no Active clause at either end, so the Bench counts.
    let state = setActiveFromDeck(board(3), "p1", "swsh10.5-025");
    state = benchFromDeck(state, "p2", "fix-attacker-v");
    // Located by card id, never by slot — the bench already holds the starter the
    // Active surgery displaced. The V is BENCHED and the Active is not one, so
    // nothing here can pass through an Active-only reading.
    justBenched(state, "p2", "fix-attacker-v");
    const opposing = topCardOf(state, activeOf(state, "p2"));
    expect(opposing === undefined ? null : pokemonSuffixOf(opposing)).not.toBe("V");
    expect(vInPlay(state, "p2")).toHaveLength(1);
    expect(effectiveRetreatCost(state, activeOf(state, "p1"))).toBe(0);
  });

  it("is YOUR OPPONENT's board — a V on Wimpod's own side frees nothing", () => {
    // Both directions off one board: the same printing, benched on either side.
    const own = benchFromDeck(
      setActiveFromDeck(board(4), "p1", "swsh10.5-025"),
      "p1",
      "fix-attacker-v",
    );
    expect(vInPlay(own, "p1")).toHaveLength(1);
    expect(vInPlay(own, "p2")).toHaveLength(0);
    expect(effectiveRetreatCost(own, activeOf(own, "p1"))).toBe(3);

    const opposite = benchFromDeck(
      setActiveFromDeck(board(4), "p1", "swsh10.5-025"),
      "p2",
      "fix-attacker-v",
    );
    expect(effectiveRetreatCost(opposite, activeOf(opposite, "p1"))).toBe(0);
  });

  it("is seat-agnostic — the whole thing mirrored onto P2's board", () => {
    // The scan derives the holder's seat, so nothing about it is P1-shaped.
    const bare = setActiveFromDeck(board(5), "p2", "swsh10.5-025");
    expect(vInPlay(bare, "p1")).toHaveLength(0);
    expect(effectiveRetreatCost(bare, activeOf(bare, "p2"))).toBe(3);

    const armed = benchFromDeck(bare, "p1", "fix-attacker-v");
    expect(hasFreeRetreatSelf(armed, activeOf(armed, "p2"))).toBe(true);
    expect(effectiveRetreatCost(armed, activeOf(armed, "p2"))).toBe(0);
  });

  it("reads 'Pokémon V' literally — a VMAX opposite is not one", () => {
    let state = setActiveFromDeck(board(6), "p1", "swsh10.5-025");
    state = setActiveFromDeck(state, "p2", "fix-attacker-vmax");
    expect(pokemonSuffixOf(FIXTURE_POOL["fix-attacker-vmax"] as never)).toBe("VMAX");
    expect(vInPlay(state, "p2")).toHaveLength(0);
    expect(effectiveRetreatCost(state, activeOf(state, "p1"))).toBe(3);
  });

  it("reads 'Pokémon V' literally — an ex opposite is not one either", () => {
    let state = setActiveFromDeck(board(7), "p1", "swsh10.5-025");
    state = setActiveFromDeck(state, "p2", "fix-attacker-ex");
    expect(vInPlay(state, "p2")).toHaveLength(0);
    expect(effectiveRetreatCost(state, activeOf(state, "p1"))).toBe(3);
  });
});

describe("Punk Out — SELF-only, not an aura", () => {
  it("frees its holder and NOBODY else on the same board", () => {
    // The test that would catch modelling this as `noRetreatCostAura`: on the very
    // board where Wimpod reads 0, its teammate still owes its printed 2.
    let state = setActiveFromDeck(board(8), "p1", "swsh10.5-025");
    state = setActiveFromDeck(state, "p2", "fix-attacker-v");
    state = benchFromDeck(state, "p1", "fix-retreat2");
    const teammate = justBenched(state, "p1", "fix-retreat2");

    expect(effectiveRetreatCost(state, activeOf(state, "p1"))).toBe(0);
    expect(hasFreeRetreatSelf(state, teammate)).toBe(false);
    expect(effectiveRetreatCost(state, teammate)).toBe(2);
  });
});

describe("Punk Out — the §9 ability lock", () => {
  it("an Active Klefki silences it — the family's SECOND positive", () => {
    // "Mischievous Lock" narrows to BASIC Pokémon on BOTH sides while Klefki is
    // Active. Wimpod is a Basic, so unlike Stage 1 Clefable ex (D108) and Spidops
    // ex (D111) it really is reachable — and here the silenced source IS the
    // beneficiary, the passive being self-only.
    let locked = setActiveFromDeck(board(9), "p1", "sv01-096");
    locked = benchFromDeck(locked, "p1", "swsh10.5-025");
    const wimpod = justBenched(locked, "p1", "swsh10.5-025");
    locked = setActiveFromDeck(locked, "p2", "fix-attacker-v");
    const wimpodUid = wimpod.stack.at(-1) ?? "";
    expect(disabledAbilityUids(locked).has(wimpodUid)).toBe(true);
    expect(hasFreeRetreatSelf(locked, wimpod)).toBe(false);
    expect(effectiveRetreatCost(locked, wimpod)).toBe(3);

    // The control: the same board with no Klefki in the Active Spot.
    let unlocked = benchFromDeck(board(9), "p1", "swsh10.5-025");
    const free = justBenched(unlocked, "p1", "swsh10.5-025");
    unlocked = setActiveFromDeck(unlocked, "p2", "fix-attacker-v");
    expect(disabledAbilityUids(unlocked).has(free.stack.at(-1) ?? "")).toBe(false);
    expect(effectiveRetreatCost(unlocked, free)).toBe(0);
  });
});

describe("Punk Out — a set-to-zero, read before the Stadium deltas", () => {
  it("beats Beach Court's ± Basic discount", () => {
    let state = setActiveFromDeck(board(10), "p1", "swsh10.5-025");
    state = handFromDeck(state, "p1", "sv01-167", 1);
    state = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "sv01-167"),
    }).state;
    expect(state.stadium).not.toBeNull();

    // Beach Court alone: the Basic holder pays 3 − 1 = 2.
    expect(vInPlay(state, "p2")).toHaveLength(0);
    expect(effectiveRetreatCost(state, activeOf(state, "p1"))).toBe(2);

    // With a V across the table the set-to-zero wins outright — it is read first.
    const freed = setActiveFromDeck(state, "p2", "fix-attacker-v");
    expect(effectiveRetreatCost(freed, activeOf(freed, "p1"))).toBe(0);
  });
});

describe("Punk Out — the §11 retreat gate", () => {
  it("a freed Wimpod retreats for nothing, keeping its Energy attached", () => {
    let state = attachFromDeck(
      setActiveFromDeck(board(11), "p1", "swsh10.5-025"),
      "p1",
      "fix-energy",
      2,
    );
    state = setActiveFromDeck(state, "p2", "fix-attacker-v");
    const retreating = activeOf(state, "p1").stack.at(-1);
    const energy = activeOf(state, "p1").energy;
    deepFreeze(state);

    const { state: done, events } = mustApply(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy: [],
      promoteBenchIndex: 0,
    });

    expect(types(events)).toContain("RETREATED");
    // The {C} rode along on the retreating Pokémon — nothing was paid.
    const benched = done.players.p1.bench.find((p) => p.stack.at(-1) === retreating);
    expect(benched?.energy).toEqual(energy);
    expect(done.players.p1.discard).toEqual(state.players.p1.discard);
  });

  it("without the V opposite the same free retreat is rejected (RETREAT_COST_MISMATCH)", () => {
    const state = attachFromDeck(
      setActiveFromDeck(board(12), "p1", "swsh10.5-025"),
      "p1",
      "fix-energy",
      2,
    );
    expect(vInPlay(state, "p2")).toHaveLength(0);
    expectErr(
      state,
      { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 },
      "RETREAT_COST_MISMATCH",
    );
  });

  it("shows on the wire as the modified cost — no new field", () => {
    // RedactedRetreat stays { cost, can }: the 3 the holder cannot afford with two
    // {C} attached becomes a 0 it trivially can.
    const bare = attachFromDeck(
      setActiveFromDeck(board(13), "p1", "swsh10.5-025"),
      "p1",
      "fix-energy",
      2,
    );
    expect(vInPlay(bare, "p2")).toHaveLength(0);
    expect(retreatOnWire(bare)).toEqual({ cost: 3, can: false });

    const freed = setActiveFromDeck(bare, "p2", "fix-attacker-v");
    expect(retreatOnWire(freed)).toEqual({ cost: 0, can: true });
  });
});
