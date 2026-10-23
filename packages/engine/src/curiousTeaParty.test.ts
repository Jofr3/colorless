import { describe, expect, it } from "vitest";
import { isOnBench, passivesOf } from "./continuous";
import { programFor } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  CURIOUS_TEA_PARTY_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  findEvent,
} from "./testFixtures";

const bite = { type: "attack", seat: "p1", index: 0 } as const; // {C}, 30 — the ACTIVE hit
const spread = { type: "attack", seat: "p1", index: 1 } as const; // 20 to each Benched
const yawn = { type: "attack", seat: "p1", index: 4 } as const; // Asleep — an effect op
const joust = { type: "attack", seat: "p1", index: 0 } as const;

function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

function benched(attackerId = "fix-shellcracker"): GameState {
  let state = driveSetup(
    1,
    { p1: CURIOUS_TEA_PARTY_DECK, p2: CURIOUS_TEA_PARTY_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = benchFromDeck(state, "p2", "fix-teaparty");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

function active(attackerId = "fix-shellcracker"): GameState {
  let state = driveSetup(
    1,
    { p1: CURIOUS_TEA_PARTY_DECK, p2: CURIOUS_TEA_PARTY_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-teaparty");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

function holderOnBench(state: GameState) {
  return state.players.p2.bench.find(
    (p) => state.cardIdByUid[p.stack.at(-1) ?? ""] === "fix-teaparty",
  );
}

function snipeAt(state: GameState, index: number, spot: "active" | "holderBench") {
  const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
  const wanted =
    spot === "active"
      ? prompt.candidates.find((c) => c.spot.spot === "active")
      : prompt.candidates.find(
          (c) =>
            c.spot.spot === "bench" &&
            parked.cardIdByUid[parked.players.p2.bench[c.spot.index]?.stack.at(-1) ?? ""] ===
              "fix-teaparty",
        );
  if (wanted === undefined) throw new Error(`no ${spot} candidate`);
  return mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [wanted as PokemonRef] },
  });
}

describe("Curious Tea Party — the registry data row", () => {
  it("authors all three printings as a bare preventDamageAndEffectsWhileBenched passive", () => {
    for (const id of ["sv06-020", "sv06-171", "sv10-048"]) {
      expect(programFor(id)?.passive, id).toEqual({
        preventDamageAndEffectsWhileBenched: true,
      });
    }
  });

  it("shares ONE program object across the line and its reprint", () => {
    expect(programFor("sv06-020")).toBe(programFor("sv06-171"));
    expect(programFor("sv06-020")).toBe(programFor("sv10-048"));
  });

  it("does not touch the Special-Energy field, and D252's does not touch this one", () => {
    expect(
      programFor("sv06-020")?.passive?.preventDamageAndEffectsFromSpecialEnergy,
    ).toBeUndefined();
    expect(programFor("sv10.5b-023")?.passive?.preventDamageAndEffectsWhileBenched).toBeUndefined();
  });

  it("authors nothing on the four sibling prevention rows", () => {
    for (const id of ["sv02-097", "sv01-099", "sv07-038"]) {
      expect(programFor(id)?.passive?.preventDamageAndEffectsWhileBenched, id).toBeUndefined();
    }
  });
});

describe("isOnBench — the holder-ZONE predicate (continuous.ts)", () => {
  it("answers TRUE for a benched body and FALSE for the same card in the Active spot", () => {
    const onBench = benched();
    const inActive = active();
    const holder = holderOnBench(onBench);
    const activeHolder = inActive.players.p2.active;
    if (holder === undefined || activeHolder === null || activeHolder === undefined)
      throw new Error("board not set up");

    expect(isOnBench(onBench, holder)).toBe(true);
    expect(isOnBench(inActive, activeHolder)).toBe(false);
  });

  // SEAT-BLIND on purpose: "your Bench" is the holder's own side by construction —
  // a Pokémon is never on the opponent's bench — so scanning both sides is how the
  // seat gets DERIVED without any caller passing one. Asserted from the OTHER seat.
  it("derives the seat rather than taking one — P1's own bench answers TRUE too", () => {
    const state = benched();
    const p1Benched = state.players.p1.bench[0];
    if (p1Benched === undefined) throw new Error("no p1 bench");

    expect(isOnBench(state, p1Benched)).toBe(true);
  });

  it("answers FALSE for a body that is not in play at all", () => {
    const state = benched();
    const holder = holderOnBench(state);
    if (holder === undefined) throw new Error("no benched holder");

    expect(isOnBench(state, { ...holder, stack: [] })).toBe(false);
  });

  it("matches by TOP UID, so a rebuilt-by-value copy still answers TRUE", () => {
    const state = benched();
    const holder = holderOnBench(state);
    if (holder === undefined) throw new Error("no benched holder");

    expect(isOnBench(state, { ...holder, damage: holder.damage + 10 })).toBe(true);
  });
});

describe("Curious Tea Party — the two LIVE read sites (spread and placeSnipe)", () => {
  it("prevents the benched holder's share of a spread", () => {
    const state = benched();
    const uid = holderOnBench(state)?.stack.at(-1);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    expect(events.some((e) => e.type === "DAMAGE_DEALT" && e.uid === uid && e.dealt === 0)).toBe(
      true,
    );
    expect(holderOnBench(done)?.damage).toBe(0);
  });

  it("…while the holder's BENCH NEIGHBOUR takes the full 20 from the same spread", () => {
    const state = benched();
    deepFreeze(state);

    const { state: done } = mustApply(state, spread);
    const neighbour = done.players.p2.bench.find(
      (p) => done.cardIdByUid[p.stack.at(-1) ?? ""] !== "fix-teaparty",
    );

    expect(neighbour?.damage).toBe(20);
  });

  it("prevents a chosen-target snipe onto the benched holder", () => {
    const state = benched();
    deepFreeze(state);

    const { state: done } = snipeAt(state, 2, "holderBench");

    expect(holderOnBench(done)?.damage).toBe(0);
  });

  it("Feint Attack's ignoreWR nulls the prevention — 50 lands on the benched holder", () => {
    const state = benched();
    deepFreeze(state);

    const { state: done } = snipeAt(state, 3, "holderBench");

    expect(holderOnBench(done)?.damage).toBe(50);
  });
});

describe("Curious Tea Party — the ACTIVE holder prevents NOTHING", () => {
  it("takes the main hit in full — attack.ts's site is DEAD for this field", () => {
    const state = active();
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 30 });
    expect(findEvent(events, "DAMAGE_DEALT")?.prevented).toBeUndefined();
    expect(done.players.p2.active?.damage).toBe(30);
  });

  it("takes a chosen-target snipe in full — snipeActive's site is DEAD too", () => {
    const state = active();
    deepFreeze(state);

    const { state: done } = snipeAt(state, 2, "active");

    expect(done.players.p2.active?.damage).toBe(40);
  });

  it("is put to Sleep — the EFFECTS half has no reachable board on this Active-aimed op ( D622 (D539): ~~today~~ — live at a gust or a put-counter Bench pick)", () => {
    const state = active();
    deepFreeze(state);

    const { state: done, events } = mustApply(state, yawn);

    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.conditions?.rotation).toBe("asleep");
  });

  // …and the same op with the holder on the BENCH also refuses nothing, because
  // Yawn names the Active. The two together are what make "unreachable" a claim
  // about the FUNNEL rather than about where this particular holder happened to be.
  it("…and a BENCHED holder is not reached by that op either — the funnel aims Active", () => {
    const state = benched();
    deepFreeze(state);

    const { state: done, events } = mustApply(state, yawn);

    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.conditions?.rotation).toBe("asleep");
    expect(holderOnBench(done)?.damage).toBe(0);
  });
});

describe("Curious Tea Party — the gate is LIVE-READ, not stamped", () => {
  it("the fold flips with the holder's SPOT and with nothing else", () => {
    const onBench = benched();
    const inActive = active();
    const holder = holderOnBench(onBench);
    const activeHolder = inActive.players.p2.active;
    if (holder === undefined || activeHolder === null || activeHolder === undefined)
      throw new Error("board not set up");

    expect(passivesOf(onBench, holder).preventDamageAndEffectsWhileBenched).toBe(true);
    expect(passivesOf(inActive, activeHolder).preventDamageAndEffectsWhileBenched).toBe(false);
  });

  it("reports FALSE on every OTHER body on the benched board", () => {
    const state = benched();
    const activeBody = state.players.p2.active;
    const neighbour = state.players.p2.bench.find(
      (p) => state.cardIdByUid[p.stack.at(-1) ?? ""] !== "fix-teaparty",
    );
    if (activeBody === null || activeBody === undefined || neighbour === undefined)
      throw new Error("board not set up");

    expect(passivesOf(state, activeBody).preventDamageAndEffectsWhileBenched).toBe(false);
    expect(passivesOf(state, neighbour).preventDamageAndEffectsWhileBenched).toBe(false);
  });

  it("leaves the four sibling prevention fields alone", () => {
    const state = benched();
    const holder = holderOnBench(state);
    if (holder === undefined) throw new Error("no benched holder");
    const fold = passivesOf(state, holder);

    expect(fold.preventDamageAndEffectsWhileBenched).toBe(true);
    expect(fold.preventDamageAndEffectsFromSpecialEnergy).toBe(false);
    expect(fold.preventDamageFromHasAbility).toBe(false);
    expect(fold.preventDamageFromExV).toBe(false);
    expect(fold.preventDamageFromTypes).toEqual([]);
  });

  it("does not consult the attacker's identity — the fold reads no attacker", () => {
    const shell = benched("fix-shellcracker");
    const titan = benched("fix-titan");
    const a = holderOnBench(shell);
    const b = holderOnBench(titan);
    if (a === undefined || b === undefined) throw new Error("no benched holder");

    expect(passivesOf(shell, a).preventDamageAndEffectsWhileBenched).toBe(true);
    expect(passivesOf(titan, b).preventDamageAndEffectsWhileBenched).toBe(true);
  });
});

describe("Curious Tea Party — §9, the lock over the holder", () => {
  it("a lock over the HOLDER switches the prevention off and the spread lands", () => {
    const state = benched("sv01-096");
    deepFreeze(state);
    const holder = holderOnBench(state);
    if (holder === undefined) throw new Error("no benched holder");

    expect(passivesOf(state, holder).preventDamageAndEffectsWhileBenched).toBe(false);

    // Klefki has no spread, so the §9 answer is asserted at the fold and then the
    // DAMAGE is driven with Klefki's own attack against the Active — which is the
    // dead site, so the assertion that matters is the fold's above.
    const { events } = mustApply(state, joust);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 10 });
  });

  it("…but `isOnBench` is NOT §9-gated — a locked body is still on the Bench", () => {
    const state = benched("sv01-096");
    const holder = holderOnBench(state);
    if (holder === undefined) throw new Error("no benched holder");

    expect(isOnBench(state, holder)).toBe(true);
    expect(passivesOf(state, holder).preventDamageAndEffectsWhileBenched).toBe(false);
  });
});

describe("Curious Tea Party — the fixture cast", () => {
  it("the demonstrator carries the printed sentence verbatim", () => {
    expect(FIXTURE_POOL["fix-teaparty"]?.abilities?.[0]?.effect).toBe(
      "As long as this Pokémon is on your Bench, prevent all damage from and effects of attacks from your opponent's Pokémon done to this Pokémon.",
    );
  });

  it("the reused attacker arms none of the four sibling gates", () => {
    const attacker = FIXTURE_POOL["fix-shellcracker"];

    expect(attacker?.abilities ?? []).toEqual([]);
    expect(attacker?.name).toBe("fix-shellcracker");
    expect(FIXTURE_POOL["fix-teaparty"]?.weaknesses ?? []).toEqual([]);
  });

  it("no board in this suite ever attaches a Special Energy", () => {
    const state = benched();
    const holder = holderOnBench(state);
    if (holder === undefined) throw new Error("no benched holder");
    const attached = state.players.p1.active?.energy ?? [];

    expect(attached).toHaveLength(1);
    expect(state.cardIdByUid[attached[0] ?? ""]).toBe("fix-energy");
    expect(passivesOf(state, holder).preventDamageAndEffectsFromSpecialEnergy).toBe(false);
  });
});
