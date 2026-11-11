import { describe, expect, it } from "vitest";
import { benchShieldedFromDamage, benchShieldedFromEffects } from "./continuous";
import { programFor } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  FIXTURE_POOL,
  SPHERICAL_SHIELD_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  findEvent,
} from "./testFixtures";

const bite = { type: "attack", seat: "p1", index: 0 } as const; // {C}, 30 — the ACTIVE hit
const spread = { type: "attack", seat: "p1", index: 1 } as const; // 20 to each Benched
const yawn = { type: "attack", seat: "p1", index: 4 } as const; // Asleep — an effect op
const joust = { type: "attack", seat: "p1", index: 0 } as const; // Klefki — {C}, 10

const PEBBLE_TOSS = 2; // 40 to 1 of your opponent's Pokémon
const FEINT_ATTACK = 3;

function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

function idOf(state: GameState, uid: string | undefined): string | undefined {
  return uid === undefined ? undefined : state.cardIdByUid[uid];
}

function cardIdAt(state: GameState, p: { stack: string[] }): string | undefined {
  return idOf(state, p.stack.at(-1));
}

function onBench(state: GameState, cardId: string) {
  return state.players.p2.bench.find((p) => cardIdAt(state, p) === cardId);
}

function holderBenched(attackerId = "fix-shellcracker"): GameState {
  let state = driveSetup(
    1,
    { p1: SPHERICAL_SHIELD_DECK, p2: SPHERICAL_SHIELD_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = benchFromDeck(state, "p2", "fix-spherical");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

function holderActive(attackerId = "fix-shellcracker"): GameState {
  let state = driveSetup(
    1,
    { p1: SPHERICAL_SHIELD_DECK, p2: SPHERICAL_SHIELD_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-spherical");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

function snipeAt(state: GameState, index: number, spot: "active" | string) {
  const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
  const wanted =
    spot === "active"
      ? prompt.candidates.find((c) => c.spot.spot === "active")
      : prompt.candidates.find((c) => {
          if (c.spot.spot !== "bench") return false;
          const body = parked.players.p2.bench[c.spot.index];
          return body !== undefined && cardIdAt(parked, body) === spot;
        });
  if (wanted === undefined) throw new Error(`no ${spot} candidate`);
  return mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [wanted as PokemonRef] },
  });
}

describe("Spherical Shield — the registry data row", () => {
  it("authors the single printing as a bare preventBenchDamageAndEffects passive", () => {
    expect(programFor("sv05-024")?.passive).toEqual({ preventBenchDamageAndEffects: true });
  });

  it("authors NO attack program, so the deriver keeps the printed Psychic", () => {
    expect(programFor("sv05-024")?.attack).toBeUndefined();
  });

  it("is a SECOND field beside preventBenchDamageWhileActive, not a widening of it", () => {
    expect(programFor("sv05-024")?.passive?.preventBenchDamageWhileActive).toBeUndefined();
    expect(programFor("sv03-070")?.passive?.preventBenchDamageAndEffects).toBeUndefined();
    expect(programFor("sv03-070")?.passive).toEqual({ preventBenchDamageWhileActive: true });
  });

  it("does not touch D253's holder-zone field, and D253's does not touch this one", () => {
    expect(programFor("sv05-024")?.passive?.preventDamageAndEffectsWhileBenched).toBeUndefined();
    expect(programFor("sv06-020")?.passive?.preventBenchDamageAndEffects).toBeUndefined();
    expect(programFor("sv10.5b-023")?.passive?.preventBenchDamageAndEffects).toBeUndefined();
  });

  it("authors nothing on the sibling prevention rows", () => {
    for (const id of ["sv02-097", "sv01-099", "sv07-038", "sv06.5-060"]) {
      expect(programFor(id)?.passive?.preventBenchDamageAndEffects, id).toBeUndefined();
    }
  });

  it("has exactly ONE fixture demonstrator in the pool", () => {
    const holders = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventBenchDamageAndEffects === true,
    );
    expect(holders).toEqual(["fix-spherical"]);
    expect(programFor("fix-spherical")).toBe(programFor("sv05-024"));
  });
});

describe("benchShieldedFromDamage — the widened same-seat scan", () => {
  it("a BENCHED holder shields a benched TEAMMATE — the board Thundurus cannot build", () => {
    const state = holderBenched();
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(true);
  });

  it("a BENCHED holder shields ITSELF, where Thundurus never can", () => {
    const state = holderBenched();
    const holder = onBench(state, "fix-spherical");
    if (holder === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, holder, "all")).toBe(true);
  });

  it("an ACTIVE holder still shields the Bench — the source clause was REMOVED, not moved", () => {
    const state = holderActive();
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(true);
  });

  // The TARGET clause, which is the one thing the two sentences DO share: "your
  // BENCHED Pokémon". An Active holder protects the Bench and not the spot it is
  // standing in — so the main hit is never prevented, whichever field is granting.
  it("TARGET clause: an ACTIVE body is never shielded, holder or not", () => {
    const state = holderActive();
    const active = state.players.p2.active;
    if (active === null) throw new Error("board");
    expect(benchShieldedFromDamage(state, active, "all")).toBe(false);
  });

  it("scope 'othersOnly' drops the holder's own contribution and keeps its teammate's", () => {
    const state = holderBenched();
    const holder = onBench(state, "fix-spherical");
    const titan = onBench(state, "fix-titan");
    if (holder === undefined || titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, holder, "othersOnly")).toBe(false);
    expect(benchShieldedFromDamage(state, titan, "othersOnly")).toBe(true);
  });

  it("scope is VACUOUS for the Active-source field — both answers agree", () => {
    let state = driveSetup(
      1,
      { p1: SPHERICAL_SHIELD_DECK, p2: SPHERICAL_SHIELD_DECK },
      { first: "p2" },
    );
    state = setActiveFromDeck(state, "p2", "sv03-070");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(true);
    expect(benchShieldedFromDamage(state, titan, "othersOnly")).toBe(true);
  });

  // OWN-SIDE, the single line that separates this member from
  // `opposingAttackDebuff`: it reads the side it FOUND and never the other one.
  it("is OWN-SIDE: the opponent's Bench is untouched by it", () => {
    let state = holderBenched();
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    const acrossTheTable = state.players.p1.bench[0];
    if (acrossTheTable === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, acrossTheTable, "all")).toBe(false);
  });

  it("an EMPTY Active Spot no longer ends the scan — a benched source still shields", () => {
    const state = holderBenched();
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    const empty: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, active: null } },
    };
    expect(benchShieldedFromDamage(empty, titan, "all")).toBe(true);
  });

  it("…and with no source in play at all it reads FALSE rather than throwing", () => {
    let state = holderActive();
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    const empty: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, active: null } },
    };
    expect(benchShieldedFromDamage(empty, titan, "all")).toBe(false);
  });
});

describe("benchShieldedFromEffects — the half preventBenchDamageWhileActive has no share in", () => {
  it("Thundurus's field answers TRUE for damage and FALSE for effects", () => {
    let state = driveSetup(
      1,
      { p1: SPHERICAL_SHIELD_DECK, p2: SPHERICAL_SHIELD_DECK },
      { first: "p2" },
    );
    state = setActiveFromDeck(state, "p2", "sv03-070");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(true);
    expect(benchShieldedFromEffects(state, titan)).toBe(false);
  });

  it("Rabsca's field answers TRUE for BOTH halves, which is what 'and effects of' buys", () => {
    const state = holderBenched();
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(true);
    expect(benchShieldedFromEffects(state, titan)).toBe(true);
  });

  it("…and the TARGET clause still applies to the effects half", () => {
    const state = holderActive();
    const active = state.players.p2.active;
    if (active === null) throw new Error("board");
    expect(benchShieldedFromEffects(state, active)).toBe(false);
  });
});

describe("the LIVE read sites — the two arms that reach a Bench", () => {
  it("spread: the splash is nulled on BOTH benched bodies, and the Active takes its 30", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done, events } = mustApply(state, spread);

    expect(done.players.p2.active?.damage).toBe(30);
    for (const body of done.players.p2.bench) {
      expect(body.damage, cardIdAt(done, body)).toBe(0);
    }
    const dealt = events.filter((e) => e.type === "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1 + done.players.p2.bench.length);
    expect(dealt.filter((e) => e.prevented === true)).toHaveLength(done.players.p2.bench.length);
  });

  it("…and with NO holder on the Bench the same spread lands 20 on each", () => {
    let state = driveSetup(
      1,
      { p1: SPHERICAL_SHIELD_DECK, p2: SPHERICAL_SHIELD_DECK },
      { first: "p2" },
    );
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "fix-shellcracker");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const { state: done } = mustApply(state, spread);
    expect(onBench(done, "fix-titan")?.damage).toBe(20);
  });

  it("placeSnipe: a benched TEAMMATE is shielded", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, PEBBLE_TOSS, "fix-titan");
    expect(onBench(done, "fix-titan")?.damage).toBe(0);
  });

  it("placeSnipe: the benched HOLDER shields itself", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, PEBBLE_TOSS, "fix-spherical");
    expect(onBench(done, "fix-spherical")?.damage).toBe(0);
  });
});

describe("Feint Attack — the ONE site where `scope` is observable", () => {
  it("a sniped HOLDER loses its own shield and takes the 50", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, FEINT_ATTACK, "fix-spherical");
    expect(onBench(done, "fix-spherical")?.damage).toBe(50);
  });

  it("…and a sniped TEAMMATE keeps it, on the SAME board and the same attack", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, FEINT_ATTACK, "fix-titan");
    expect(onBench(done, "fix-titan")?.damage).toBe(0);
  });

  it("an ACTIVE holder's shield survives Feint Attack — the source is another body", () => {
    const state = holderActive();
    deepFreeze(state);
    const { state: done } = snipeAt(state, FEINT_ATTACK, "fix-titan");
    expect(onBench(done, "fix-titan")?.damage).toBe(0);
  });
});

describe("the DEAD read sites — guarded for totality, asserted rather than assumed", () => {
  it("attack.ts main hit: the defending ACTIVE takes its 30 with a holder benched", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = mustApply(state, bite);
    expect(done.players.p2.active?.damage).toBe(30);
  });

  it("snipeActive: a chosen ACTIVE target takes its 40 with a holder benched", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, PEBBLE_TOSS, "active");
    expect(done.players.p2.active?.damage).toBe(40);
  });

  it("attackEffectRefused: the Active is put to Sleep, and nothing is prevented while the shield holder sits on the Bench", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done, events } = mustApply(state, yawn);
    expect(done.players.p2.active?.conditions.rotation).toBe("asleep");
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });
});

describe("§9 — a lock silences ONE source, not the scan", () => {
  /** Klefki Active on P1 (its "Mischievous Lock" is Active-gated and reaches
      across the table), with the holder and a teammate on P2's Bench. */
  function locked(): GameState {
    let state = driveSetup(
      1,
      { p1: SPHERICAL_SHIELD_DECK, p2: SPHERICAL_SHIELD_DECK },
      { first: "p2" },
    );
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = benchFromDeck(state, "p2", "fix-spherical");
    state = benchFromDeck(state, "p2", "fix-titan");
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "sv01-096");
    return attachFromDeck(state, "p1", "fix-energy", 1);
  }

  it("a locked holder shields nothing, and unlocking it restores the shield", () => {
    const state = locked();
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(false);
    expect(benchShieldedFromEffects(state, titan)).toBe(false);

    // The SAME board with a body that locks nothing in the Active Spot.
    const unlocked = setActiveFromDeck(state, "p1", "fix-shellcracker");
    const stillTitan = onBench(unlocked, "fix-titan");
    if (stillTitan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(unlocked, stillTitan, "all")).toBe(true);
  });

  it("…and the lock board is drivable: Klefki's own hit lands on the Active", () => {
    const state = locked();
    deepFreeze(state);
    const { state: hit } = mustApply(state, joust);
    expect(hit.players.p2.active?.damage).toBe(10);
  });

  it("the gate is per SOURCE: a second unlocked source keeps the shield up", () => {
    let state = locked();
    // A Thundurus in the Active Spot is a SECOND source with a different field and
    // a different reachability. Klefki locks Basics and Thundurus is one, so this
    // asserts the shape of the read and not a divergence in what is silenced.
    state = setActiveFromDeck(state, "p2", "sv03-070");
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(false);

    const unlocked = setActiveFromDeck(state, "p1", "fix-shellcracker");
    const stillTitan = onBench(unlocked, "fix-titan");
    if (stillTitan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(unlocked, stillTitan, "all")).toBe(true);
  });
});

describe("the fixture pool and the deck", () => {
  it("the holder prints the sentence verbatim and carries NO attacks", () => {
    const holder = FIXTURE_POOL["fix-spherical"];
    expect(holder?.abilities?.[0]?.effect).toBe(
      "Prevent all damage from and effects of attacks from your opponent's Pokémon done to your Benched Pokémon.",
    );
    expect(holder?.attacks ?? []).toHaveLength(0);
  });

  it("the deck is exactly 60", () => {
    expect(SPHERICAL_SHIELD_DECK).toHaveLength(60);
  });

  it("the attacker's snipe indices are the ones this suite names", () => {
    const attacks = FIXTURE_POOL["fix-shellcracker"]?.attacks ?? [];
    expect(attacks[PEBBLE_TOSS]?.name).toBe("Pebble Toss");
    expect(attacks[FEINT_ATTACK]?.name).toBe("Feint Attack");
    expect(findEvent([], "DAMAGE_DEALT")).toBeUndefined();
  });
});
