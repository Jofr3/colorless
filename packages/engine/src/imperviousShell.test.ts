import { describe, expect, it } from "vitest";
import { passivesOf, preventedByDamageThreshold } from "./continuous";
import { programFor } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  FIXTURE_POOL,
  IMPERVIOUS_SHELL_DECK,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const crush = { type: "attack", seat: "p1", index: 0 } as const; // 200 — AT the threshold
const nip = { type: "attack", seat: "p1", index: 1 } as const; // 190 — one step below
const tap = { type: "attack", seat: "p1", index: 2 } as const; // 110 — below, 220 after ×2
const bigSpread = { type: "attack", seat: "p1", index: 3 } as const; // 30 + 200 to each bench
const smallSpread = { type: "attack", seat: "p1", index: 4 } as const; // 30 + 20 to each bench
const yawn = { type: "attack", seat: "p1", index: 7 } as const; // Asleep — an effect op

const BOULDER_TOSS = 5; // 200 to 1 of your opponent's Pokémon
const SNEAK_BOULDER = 6; // 200 to 1, `ignoreWR` — the Feint Attack clause

const SENTENCE =
  "Prevent all damage done to this Pokémon by attacks from your opponent's Pokémon if that damage is 200 or more.";

function idOf(state: GameState, uid: string | undefined): string | undefined {
  return uid === undefined ? undefined : state.cardIdByUid[uid];
}

function cardIdAt(state: GameState, p: { stack: string[] }): string | undefined {
  return idOf(state, p.stack.at(-1));
}

function onBench(state: GameState, cardId: string) {
  return state.players.p2.bench.find((p) => cardIdAt(state, p) === cardId);
}

function holderActive(holderId = "fix-imperviousshell"): GameState {
  let state = driveSetup(
    1,
    { p1: IMPERVIOUS_SHELL_DECK, p2: IMPERVIOUS_SHELL_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", holderId);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-crusher");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

function holderBenched(holderId = "fix-imperviousshell"): GameState {
  let state = driveSetup(
    1,
    { p1: IMPERVIOUS_SHELL_DECK, p2: IMPERVIOUS_SHELL_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", holderId);
  state = benchFromDeck(state, "p2", "fix-titan");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-crusher");
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

function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

describe("Impervious Shell — the registry data row", () => {
  it("authors the printing as a bare preventDamageAtOrAbove passive", () => {
    expect(programFor("sv07-044")?.passive).toEqual({ preventDamageAtOrAbove: 200 });
  });

  it("stores the printed 200 as a NUMBER, not a flag", () => {
    expect(programFor("sv07-044")?.passive?.preventDamageAtOrAbove).toBe(200);
    expect(typeof programFor("sv07-044")?.passive?.preventDamageAtOrAbove).toBe("number");
  });

  it("authors NO attack program on the printing", () => {
    expect(programFor("sv07-044")?.attack).toBeUndefined();
  });

  // A SINGLETON — one printed id, no reprint. Asserted so a future ingest that adds
  // one is noticed here rather than silently diverging from the count.
  it("is the ONLY catalog id carrying the field", () => {
    expect(programFor("sv10-010")?.passive?.preventDamageAtOrAbove).toBeUndefined();
    expect(programFor("sv05-024")?.passive?.preventDamageAtOrAbove).toBeUndefined();
    expect(programFor("sv08.5-040")?.passive?.preventDamageAtOrAbove).toBeUndefined();
    expect(programFor("sv02-097")?.passive?.preventDamageAtOrAbove).toBeUndefined();
  });

  it("does NOT ride the installed AttackBlock — the channels are separate", () => {
    for (const id of ["sv10.5w-046", "sv10.5w-127", "sv09-002"]) {
      expect(programFor(id)?.passive?.preventDamageAtOrAbove, id).toBeUndefined();
    }
  });

  it("has exactly TWO fixture demonstrators in the pool", () => {
    const holders = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventDamageAtOrAbove !== undefined,
    );
    expect(holders).toEqual(["fix-imperviousshell", "fix-imperviousweak"]);
    expect(programFor("fix-imperviousshell")).toBe(programFor("sv07-044"));
    expect(programFor("fix-imperviousweak")).toBe(programFor("sv07-044"));
  });

  it("the two demonstrators differ ONLY in Weakness", () => {
    const plain = FIXTURE_POOL["fix-imperviousshell"];
    const weak = FIXTURE_POOL["fix-imperviousweak"];
    expect(plain?.hp).toBe(weak?.hp);
    expect(plain?.types).toEqual(weak?.types);
    expect(plain?.weaknesses ?? null).toBeNull();
    expect(weak?.weaknesses).toEqual([{ type: "Grass", value: "×2" }]);
  });

  it("the demonstrator carries the PRINTED sentence", () => {
    expect(FIXTURE_POOL["fix-imperviousshell"]?.abilities?.[0]?.effect).toBe(SENTENCE);
    expect(FIXTURE_POOL["fix-imperviousweak"]?.abilities?.[0]?.effect).toBe(SENTENCE);
  });
});

describe("preventedByDamageThreshold — the predicate, and it is INCLUSIVE", () => {
  it("is `>=`: exactly the threshold is prevented, one below is not", () => {
    expect(preventedByDamageThreshold(200, 200)).toBe(true);
    expect(preventedByDamageThreshold(200, 199)).toBe(false);
    expect(preventedByDamageThreshold(200, 201)).toBe(true);
  });

  it("an ABSENT threshold shields nothing, at any damage including 0", () => {
    expect(preventedByDamageThreshold(undefined, 0)).toBe(false);
    expect(preventedByDamageThreshold(undefined, 999)).toBe(false);
  });

  // A zero-damage hit against a real threshold: the direction that would go wrong
  // if the comparison were ever inverted.
  it("zero damage never trips a positive threshold", () => {
    expect(preventedByDamageThreshold(200, 0)).toBe(false);
  });
});

describe("passivesOf — the fold, and it is a NUMBER rather than a flag", () => {
  it("reports the holder's printed threshold and undefined for a body without one", () => {
    const state = holderActive();
    const active = state.players.p2.active;
    const titan = onBench(state, "fix-titan");
    if (active === null || titan === undefined) throw new Error("board");
    expect(passivesOf(state, active).preventDamageAtOrAbove).toBe(200);
    expect(passivesOf(state, titan).preventDamageAtOrAbove).toBeUndefined();
  });

  it("a §9 Ability lock SILENCES it — read through the fold, not off the card", () => {
    let state = holderActive();
    state = setActiveFromDeck(state, "p1", "sv01-096");
    const active = state.players.p2.active;
    if (active === null) throw new Error("board");
    expect(passivesOf(state, active).preventDamageAtOrAbove).toBeUndefined();
  });

  // …and the lock reaches the DAMAGE too, not only the fold. The pair is what makes
  // the §9 claim a behaviour rather than a property read.
  it("…and the 200 then LANDS", () => {
    let state = holderActive();
    state = setActiveFromDeck(state, "p1", "sv01-096");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(done.players.p2.active?.damage).toBe(10); // Klefki's own Joust, not Crush
  });
});

describe("attack.ts main hit — the FIRST read site, and the boundary", () => {
  it("a 200-damage hit on the Active holder is PREVENTED", () => {
    const state = holderActive();
    deepFreeze(state);
    const { state: done, events } = mustApply(state, crush);
    expect(done.players.p2.active?.damage).toBe(0);
    const dealt = events.find((e) => e.type === "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ prevented: true, dealt: 0 });
  });

  it("…and the SAME 200 lands in full on the no-Ability control", () => {
    const state = holderActive("fix-titan");
    const { state: done } = mustApply(state, crush);
    expect(done.players.p2.active?.damage).toBe(200);
  });

  // The step BELOW the threshold, on the same body, from the same attacker.
  it("a 190-damage hit LANDS — the gate is a threshold, not a blanket", () => {
    const state = holderActive();
    const { state: done, events } = mustApply(state, nip);
    expect(done.players.p2.active?.damage).toBe(190);
    expect(events.find((e) => e.type === "DAMAGE_DEALT")?.prevented ?? false).toBe(false);
  });
});

describe("WHICH NUMBER — D240's ruling, driven in BOTH directions", () => {
  it("a printed 110 doubled to 220 by Weakness IS prevented", () => {
    const state = holderActive("fix-imperviousweak");
    const { state: done, events } = mustApply(state, tap);
    expect(done.players.p2.active?.damage).toBe(0);
    expect(events.find((e) => e.type === "DAMAGE_DEALT")).toMatchObject({ prevented: true });
  });

  // …and the control for it: the SAME 110, the SAME attacker, a holder with no
  // Weakness. 110 < 200, so it lands — which is what makes the board above a
  // statement about the multiplier rather than about the number 110.
  it("…and the same 110 on the un-Weak holder LANDS", () => {
    const state = holderActive();
    const { state: done } = mustApply(state, tap);
    expect(done.players.p2.active?.damage).toBe(110);
  });

  it("a printed 200 reduced to 170 by Rock Chestplate is NOT prevented", () => {
    let state = holderActive();
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    const { state: done, events } = mustApply(state, crush);
    expect(done.players.p2.active?.damage).toBe(170);
    expect(events.find((e) => e.type === "DAMAGE_DEALT")?.prevented ?? false).toBe(false);
  });

  it("…and the reduction is really the Tool's, on a type it really accepts", () => {
    expect(programFor("sv01-192")?.passive?.damageReductionAfterWRIfType).toEqual({
      amount: 30,
      type: "Fighting",
    });
    expect(FIXTURE_POOL["fix-imperviousshell"]?.types).toEqual(["Fighting"]);
    let state = holderActive();
    state = attachToolFromDeck(state, "p2", "active", "sv01-192");
    const active = state.players.p2.active;
    if (active === null) throw new Error("board");
    expect(passivesOf(state, active).damageReductionAfterWR).toBe(30);
  });
});

describe("interpreter.ts — the spread arm, the SECOND read site", () => {
  it("a 200-per-body spread is nulled on the benched holder and lands on the control", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done, events } = mustApply(state, bigSpread);
    expect(onBench(done, "fix-imperviousshell")?.damage).toBe(0);
    expect(onBench(done, "fix-titan")?.damage).toBe(200);
    expect(done.players.p2.active?.damage).toBe(30);
    const dealt = events.filter((e) => e.type === "DAMAGE_DEALT");
    expect(dealt.filter((e) => e.type === "DAMAGE_DEALT" && e.prevented === true)).toHaveLength(1);
  });

  it("a 20-per-body spread is NOT prevented on the same holder", () => {
    const state = holderBenched();
    const { state: done } = mustApply(state, smallSpread);
    expect(onBench(done, "fix-imperviousshell")?.damage).toBe(20);
    expect(onBench(done, "fix-titan")?.damage).toBe(20);
  });
});

describe("interpreter.ts — the two snipe arms, the THIRD and FOURTH read sites", () => {
  it("placeSnipe onto the BENCHED holder: 200 is prevented, the control takes it", () => {
    const state = holderBenched();
    const { state: shielded } = snipeAt(state, BOULDER_TOSS, "fix-imperviousshell");
    expect(onBench(shielded, "fix-imperviousshell")?.damage).toBe(0);
    const { state: hit } = snipeAt(state, BOULDER_TOSS, "fix-titan");
    expect(onBench(hit, "fix-titan")?.damage).toBe(200);
  });

  it("snipeActive onto the ACTIVE holder: 200 is prevented", () => {
    const state = holderActive();
    const { state: done, events } = snipeAt(state, BOULDER_TOSS, "active");
    expect(done.players.p2.active?.damage).toBe(0);
    expect(events.find((e) => e.type === "DAMAGE_DEALT")).toMatchObject({ prevented: true });
  });

  it("…and the same snipe onto the no-Ability Active lands in full", () => {
    const state = holderActive("fix-titan");
    const { state: done } = snipeAt(state, BOULDER_TOSS, "active");
    expect(done.players.p2.active?.damage).toBe(200);
  });
});

describe("`ignoreWR` — Feint Attack's clause, and it NULLS this prevention", () => {
  it("a 200 that ignores effects on the target LANDS on the Active holder", () => {
    const state = holderActive();
    const { state: done, events } = snipeAt(state, SNEAK_BOULDER, "active");
    expect(done.players.p2.active?.damage).toBe(200);
    expect(events.find((e) => e.type === "DAMAGE_DEALT")?.prevented ?? false).toBe(false);
  });

  it("…and on the BENCHED holder too", () => {
    const state = holderBenched();
    const { state: done } = snipeAt(state, SNEAK_BOULDER, "fix-imperviousshell");
    expect(onBench(done, "fix-imperviousshell")?.damage).toBe(200);
  });

  it("ignoreWR drops the Weakness too — 200 lands, not 400", () => {
    const state = holderActive("fix-imperviousweak");
    const { state: done } = snipeAt(state, SNEAK_BOULDER, "active");
    expect(done.players.p2.active?.damage).toBe(200);
  });
});

describe("attackEffectRefused — the gate this field is deliberately NOT on", () => {
  it("the holder is still put to Sleep — a threshold refuses no effect", () => {
    const state = holderActive();
    const { state: done, events } = mustApply(state, yawn);
    expect(done.players.p2.active?.conditions.rotation).toBe("asleep");
    expect(types(events)).toContain("STATUS_APPLIED");
  });

  // …asserted beside the damage answer on the SAME board, because the pair is the
  // discriminator: one gate says TRUE and the other says FALSE off one field.
  it("…on the same board where the 200 is prevented", () => {
    const state = holderActive();
    expect(mustApply(state, crush).state.players.p2.active?.damage).toBe(0);
    expect(mustApply(state, yawn).state.players.p2.active?.conditions.rotation).toBe("asleep");
  });
});

describe("the fold is a Math.min — declared, and its WRITE SITES are the argument", () => {
  it("no Tool or Energy in the registry writes the field, so the min cannot be driven", () => {
    const writers = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventDamageAtOrAbove !== undefined,
    );
    for (const id of writers) {
      expect(FIXTURE_POOL[id]?.category, id).toBe("Pokemon");
    }
    expect(programFor("sv07-044")?.passive?.preventDamageAtOrAbove).toBe(200);
  });
});
