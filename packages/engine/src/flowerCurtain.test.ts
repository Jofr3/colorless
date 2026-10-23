import { describe, expect, it } from "vitest";
import { benchShieldedFromDamage, benchShieldedFromEffects } from "./continuous";
import { programFor } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  FIXTURE_POOL,
  FLOWER_CURTAIN_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const bite = { type: "attack", seat: "p1", index: 0 } as const; // {C}, 30 — the ACTIVE hit
const spread = { type: "attack", seat: "p1", index: 1 } as const; // 20 to each Benched
const yawn = { type: "attack", seat: "p1", index: 4 } as const; // Asleep — an effect op
const joust = { type: "attack", seat: "p1", index: 0 } as const; // Klefki — {C}, 10

const PEBBLE_TOSS = 2; // 40 to 1 of your opponent's Pokémon
const FEINT_ATTACK = 3; // 50 to 1, `ignoreWR` — the scope-observable arm

const SENTENCE =
  "Prevent all damage done to your Benched Pokémon that don't have a Rule Box by attacks from your opponent's Pokémon. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)";

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
  let state = driveSetup(1, { p1: FLOWER_CURTAIN_DECK, p2: FLOWER_CURTAIN_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-flowercurtain");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = benchFromDeck(state, "p2", "fix-exbasic");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

function holderActive(): GameState {
  let state = driveSetup(1, { p1: FLOWER_CURTAIN_DECK, p2: FLOWER_CURTAIN_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", "fix-flowercurtain");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = benchFromDeck(state, "p2", "fix-exbasic");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-shellcracker");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

function thundurusActive(): GameState {
  let state = driveSetup(1, { p1: FLOWER_CURTAIN_DECK, p2: FLOWER_CURTAIN_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", "sv03-070");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = benchFromDeck(state, "p2", "fix-exbasic");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-shellcracker");
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

describe("Flower Curtain — the registry data row", () => {
  it("authors BOTH printings as a bare preventBenchDamageNoRuleBox passive", () => {
    for (const id of ["sv10-010", "sv10-185"]) {
      expect(programFor(id)?.passive, id).toEqual({ preventBenchDamageNoRuleBox: true });
    }
  });

  it("is ONE program object shared by the two ids", () => {
    expect(programFor("sv10-185")).toBe(programFor("sv10-010"));
  });

  it("authors NO attack program on either printing", () => {
    for (const id of ["sv10-010", "sv10-185"]) {
      expect(programFor(id)?.attack, id).toBeUndefined();
    }
  });

  it("is a THIRD field, disjoint from both fields already on this scan", () => {
    const shaymin = programFor("sv10-010")?.passive;
    expect(shaymin?.preventBenchDamageAndEffects).toBeUndefined();
    expect(shaymin?.preventBenchDamageWhileActive).toBeUndefined();
    expect(programFor("sv03-070")?.passive?.preventBenchDamageNoRuleBox).toBeUndefined();
    expect(programFor("sv05-024")?.passive?.preventBenchDamageNoRuleBox).toBeUndefined();
  });

  it("does not touch D253's holder-zone field, and D253's does not touch this one", () => {
    expect(programFor("sv10-010")?.passive?.preventDamageAndEffectsWhileBenched).toBeUndefined();
    for (const id of ["sv06-020", "sv06-171", "sv10-048"]) {
      expect(programFor(id)?.passive?.preventBenchDamageNoRuleBox, id).toBeUndefined();
    }
  });

  it("authors nothing on the sibling prevention rows", () => {
    for (const id of ["sv02-097", "sv01-099", "sv07-038", "sv06.5-060", "sv08.5-040"]) {
      expect(programFor(id)?.passive?.preventBenchDamageNoRuleBox, id).toBeUndefined();
    }
  });

  it("has exactly ONE fixture demonstrator in the pool", () => {
    const holders = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventBenchDamageNoRuleBox === true,
    );
    expect(holders).toEqual(["fix-flowercurtain"]);
    expect(programFor("fix-flowercurtain")).toBe(programFor("sv10-010"));
  });
});

describe("benchShieldedFromDamage — the TARGET conjunct, which is the whole slice", () => {
  it("shields a benched body with NO Rule Box and REFUSES one with a Rule Box", () => {
    const state = holderBenched();
    const titan = onBench(state, "fix-titan");
    const ex = onBench(state, "fix-exbasic");
    if (titan === undefined || ex === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(true);
    expect(benchShieldedFromDamage(state, ex, "all")).toBe(false);
  });

  // The SELF-INCLUSIVE read, and it exists only because Shaymin has no Rule Box:
  // the holder is inside its own target set exactly when the conjunct admits it.
  it("a BENCHED holder shields ITSELF — it has no Rule Box either", () => {
    const state = holderBenched();
    const holder = onBench(state, "fix-flowercurtain");
    if (holder === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, holder, "all")).toBe(true);
  });

  it("an ACTIVE holder shields the same Bench — no source clause is printed", () => {
    const state = holderActive();
    const titan = onBench(state, "fix-titan");
    const ex = onBench(state, "fix-exbasic");
    if (titan === undefined || ex === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(true);
    expect(benchShieldedFromDamage(state, ex, "all")).toBe(false);
  });

  // The TARGET clause all three sentences share: "your BENCHED Pokémon". An Active
  // body is out whichever field is granting, and a Rule Box cannot change that.
  it("TARGET clause: an ACTIVE body is never shielded, Rule Box or not", () => {
    const state = holderActive();
    const active = state.players.p2.active;
    if (active === null) throw new Error("board");
    expect(benchShieldedFromDamage(state, active, "all")).toBe(false);
  });

  it("Thundurus's field still shields a benched Pokémon ex — the conjunct did NOT leak", () => {
    const state = thundurusActive();
    const titan = onBench(state, "fix-titan");
    const ex = onBench(state, "fix-exbasic");
    if (titan === undefined || ex === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(true);
    expect(benchShieldedFromDamage(state, ex, "all")).toBe(true);
  });

  it("scope 'othersOnly' drops the holder's own contribution and keeps its teammate's", () => {
    const state = holderBenched();
    const holder = onBench(state, "fix-flowercurtain");
    const titan = onBench(state, "fix-titan");
    if (holder === undefined || titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, holder, "othersOnly")).toBe(false);
    expect(benchShieldedFromDamage(state, titan, "othersOnly")).toBe(true);
  });

  // OWN-SIDE, the single line that separates this member from `opposingAttackDebuff`.
  it("is OWN-SIDE: the opponent's Bench is untouched by it", () => {
    let state = holderBenched();
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    const acrossTheTable = state.players.p1.bench[0];
    if (acrossTheTable === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, acrossTheTable, "all")).toBe(false);
  });

  it("an EMPTY Active Spot does not end the scan — a benched source still shields", () => {
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
    const state = thundurusActive();
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    const empty: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, active: null } },
    };
    expect(benchShieldedFromDamage(empty, titan, "all")).toBe(false);
  });
});

describe("the predicate is `hasRuleBox` and NOT the printed parenthetical", () => {
  it("a benched VMAX is REFUSED, where a literal reading of the bracket would shield it", () => {
    let state = holderBenched();
    state = benchFromDeck(state, "p2", "fix-attacker-vmax");
    const vmax = onBench(state, "fix-attacker-vmax");
    if (vmax === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, vmax, "all")).toBe(false);
  });

  it("the VMAX fixture really is named as one, which is what the read consults", () => {
    expect(FIXTURE_POOL["fix-attacker-vmax"]?.name?.endsWith(" VMAX")).toBe(true);
    expect(FIXTURE_POOL["fix-exbasic"]?.name?.endsWith(" ex")).toBe(true);
    expect(FIXTURE_POOL["fix-titan"]?.name?.endsWith(" ex")).toBe(false);
    expect(FIXTURE_POOL["fix-flowercurtain"]?.name?.endsWith(" ex")).toBe(false);
  });
});

describe("benchShieldedFromEffects — the half this sentence does NOT print", () => {
  it("Shaymin's field answers TRUE for damage and FALSE for effects", () => {
    const state = holderBenched();
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(true);
    expect(benchShieldedFromEffects(state, titan)).toBe(false);
  });

  it("…and it refuses the effects half for the holder itself too", () => {
    const state = holderBenched();
    const holder = onBench(state, "fix-flowercurtain");
    if (holder === undefined) throw new Error("board");
    expect(benchShieldedFromEffects(state, holder)).toBe(false);
  });
});

describe("the LIVE read sites — the two arms that reach a Bench", () => {
  it("spread: the splash is nulled on the two plain bodies and LANDS on the ex", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done, events } = mustApply(state, spread);

    expect(done.players.p2.active?.damage).toBe(30);
    expect(onBench(done, "fix-titan")?.damage).toBe(0);
    expect(onBench(done, "fix-flowercurtain")?.damage).toBe(0);
    expect(onBench(done, "fix-exbasic")?.damage).toBe(20);

    const dealt = events.filter((e) => e.type === "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1 + done.players.p2.bench.length);
    expect(dealt.filter((e) => e.prevented === true)).toHaveLength(2);
  });

  it("…and with NO holder on the Bench the same spread lands 20 on each", () => {
    const state = thundurusActive();
    const noHolder = setActiveFromDeck(state, "p2", "fix-bigbody");
    const { state: done } = mustApply(noHolder, spread);
    expect(onBench(done, "fix-titan")?.damage).toBe(20);
    expect(onBench(done, "fix-exbasic")?.damage).toBe(20);
  });

  it("placeSnipe: a benched teammate with no Rule Box is shielded", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, PEBBLE_TOSS, "fix-titan");
    expect(onBench(done, "fix-titan")?.damage).toBe(0);
  });

  it("placeSnipe: the benched HOLDER shields itself", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, PEBBLE_TOSS, "fix-flowercurtain");
    expect(onBench(done, "fix-flowercurtain")?.damage).toBe(0);
  });

  it("placeSnipe: the benched ex takes its 40 under the same holder", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, PEBBLE_TOSS, "fix-exbasic");
    expect(onBench(done, "fix-exbasic")?.damage).toBe(40);
  });
});

describe("Feint Attack — the ONE site where `scope` is observable", () => {
  it("a sniped HOLDER loses its own shield and takes the 50", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, FEINT_ATTACK, "fix-flowercurtain");
    expect(onBench(done, "fix-flowercurtain")?.damage).toBe(50);
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

  it("attackEffectRefused: the Active is put to Sleep, and no refusal is emitted", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done, events } = mustApply(state, yawn);
    expect(done.players.p2.active?.conditions.rotation).toBe("asleep");
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });
});

describe("§9 — a lock silences ONE source, not the scan", () => {
  /** Klefki Active on P1 (its "Mischievous Lock" is Active-gated and reaches across
      the table), with the holder and two teammates on P2's Bench. */
  function locked(): GameState {
    return holderBenched("sv01-096");
  }

  it("a locked holder shields nothing, and unlocking it restores the shield", () => {
    const state = locked();
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(false);

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

  it("the gate is per SOURCE: it is read once per holder, not once per scan", () => {
    let state = locked();
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
  it("the holder prints the sentence verbatim, parenthetical included, with NO attacks", () => {
    const holder = FIXTURE_POOL["fix-flowercurtain"];
    expect(holder?.abilities?.[0]?.effect).toBe(SENTENCE);
    expect(holder?.attacks ?? []).toHaveLength(0);
  });

  it("the deck is exactly 60", () => {
    expect(FLOWER_CURTAIN_DECK).toHaveLength(60);
  });

  it("the attacker's snipe indices are the ones this suite names", () => {
    const attacks = FIXTURE_POOL["fix-shellcracker"]?.attacks ?? [];
    expect(attacks[PEBBLE_TOSS]?.name).toBe("Pebble Toss");
    expect(attacks[FEINT_ATTACK]?.name).toBe("Feint Attack");
  });
});
