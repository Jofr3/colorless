import { describe, expect, it } from "vitest";
import { attackerHasSpecialEnergy, passivesOf } from "./continuous";
import { programFor } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  FIXTURE_POOL,
  MIGHTY_SHELL_DECK,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const bite = { type: "attack", seat: "p1", index: 0 } as const;
const spread = { type: "attack", seat: "p1", index: 1 } as const;
const yawn = { type: "attack", seat: "p1", index: 4 } as const;
const clutch = { type: "attack", seat: "p1", index: 5 } as const;
const joust = { type: "attack", seat: "p1", index: 0 } as const; // Klefki — {C}, 10

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

function fight(attackerId: string, energyId: string): GameState {
  let state = driveSetup(1, { p1: MIGHTY_SHELL_DECK, p2: MIGHTY_SHELL_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", "fix-mightyshell");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", energyId, 1);
}

function fightBench(energyId: string): GameState {
  let state = driveSetup(1, { p1: MIGHTY_SHELL_DECK, p2: MIGHTY_SHELL_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = benchFromDeck(state, "p2", "fix-mightyshell");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-shellcracker");
  return attachFromDeck(state, "p1", energyId, 1);
}

function benchedHolder(state: GameState) {
  return state.players.p2.bench.find(
    (p) => state.cardIdByUid[p.stack.at(-1) ?? ""] === "fix-mightyshell",
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
              "fix-mightyshell",
        );
  if (wanted === undefined) throw new Error(`no ${spot} candidate`);
  return mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [wanted as PokemonRef] },
  });
}

describe("Mighty Shell — the registry data row", () => {
  it("authors both printings as a bare preventDamageAndEffectsFromSpecialEnergy passive", () => {
    for (const id of ["sv10.5b-023", "sv10.5b-107"]) {
      expect(programFor(id)?.passive, id).toEqual({
        preventDamageAndEffectsFromSpecialEnergy: true,
      });
    }
  });

  it("shares ONE program object across both ids and the demonstrator", () => {
    const program = programFor("sv10.5b-023");
    for (const id of ["sv10.5b-107", "fix-mightyshell"]) {
      expect(programFor(id), id).toBe(program);
    }
  });

  it("writes none of the three sibling prevention fields", () => {
    const passive = programFor("sv10.5b-023")?.passive;
    expect(passive?.preventDamageFromExV).toBeUndefined();
    expect(passive?.preventDamageFromType).toBeUndefined();
    expect(passive?.preventDamageFromHasAbility).toBeUndefined();
  });

  it("D251's NARROW printings do not acquire the effects half", () => {
    for (const id of ["sv06-112", "sv06-199", "sv06-215", "sv08.5-058", "sv08.5-160"]) {
      expect(programFor(id)?.passive?.preventDamageAndEffectsFromSpecialEnergy, id).toBeUndefined();
    }
  });
});

describe("attackerHasSpecialEnergy — the attacker-side predicate (continuous.ts)", () => {
  it("is TRUE once an UNAUTHORED Special Energy is attached and FALSE before", () => {
    const bare = fight("fix-shellcracker", "fix-energy");
    const armed = fight("fix-shellcracker", "fix-special");

    expect(attackerHasSpecialEnergy(bare, bare.players.p1.active ?? undefined)).toBe(false);
    expect(attackerHasSpecialEnergy(armed, armed.players.p1.active ?? undefined)).toBe(true);
  });

  it("counts an AUTHORED Special (Luminous sv02-191) the same way", () => {
    const armed = fight("fix-shellcracker", "sv02-191");

    expect(attackerHasSpecialEnergy(armed, armed.players.p1.active ?? undefined)).toBe(true);
    expect(programFor("fix-special")).toBeUndefined();
  });

  // The conservative direction, `preventsAttackerType`'s verbatim: three of the
  // five read sites hold the attacking body as an optional.
  it("is FALSE for an unresolvable attacking body", () => {
    const state = fight("fix-shellcracker", "fix-special");

    expect(attackerHasSpecialEnergy(state, undefined)).toBe(false);
  });

  it("answers about the BODY and not the printing — same card, both answers", () => {
    const bare = fight("fix-shellcracker", "fix-energy");
    const armed = fight("fix-shellcracker", "fix-special");
    const id = (s: GameState) => s.cardIdByUid[s.players.p1.active?.stack.at(-1) ?? ""];

    expect(id(bare)).toBe(id(armed));
    expect(attackerHasSpecialEnergy(bare, bare.players.p1.active ?? undefined)).toBe(false);
    expect(attackerHasSpecialEnergy(armed, armed.players.p1.active ?? undefined)).toBe(true);
  });
});

describe("Mighty Shell — the main hit (attack.ts, read site 1 of 5)", () => {
  it("a Special-Energy attacker's Bite is fully prevented — 0 damage, flagged", () => {
    const state = fight("fix-shellcracker", "fix-special");
    deepFreeze(state);

    const { events } = mustApply(state, bite);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 0, prevented: true });
  });

  it("the SAME attacker holding a BASIC Energy deals full damage", () => {
    const state = fight("fix-shellcracker", "fix-energy");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 30 });
    expect(find(events, "DAMAGE_DEALT")?.prevented).toBeUndefined();
    expect(done.players.p2.active?.damage).toBe(30);
  });

  it("a Special Energy on the HOLDER does not prevent anything", () => {
    let state = driveSetup(1, { p1: MIGHTY_SHELL_DECK, p2: MIGHTY_SHELL_DECK }, { first: "p2" });
    state = setActiveFromDeck(state, "p2", "fix-mightyshell");
    state = attachFromDeck(state, "p2", "fix-special", 1);
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "fix-shellcracker");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    deepFreeze(state);

    const { events } = mustApply(state, bite);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 30 });
  });
});

describe("Mighty Shell — the spread and snipe arms (read sites 2, 3 and 4 of 5)", () => {
  // No Active-Spot clause on the sentence, so the DAMAGE half protects a BENCHED
  // holder too.
  it("prevents the benched holder's share of a spread", () => {
    const state = fightBench("fix-special");
    const uid = benchedHolder(state)?.stack.at(-1);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    expect(events.some((e) => e.type === "DAMAGE_DEALT" && e.uid === uid && e.dealt === 0)).toBe(
      true,
    );
    expect(benchedHolder(done)?.damage).toBe(0);
  });

  it("does NOT prevent the spread when the attacker holds only a Basic Energy", () => {
    const state = fightBench("fix-energy");
    deepFreeze(state);

    const { state: done } = mustApply(state, spread);

    expect(benchedHolder(done)?.damage).toBe(20);
  });

  it("prevents a chosen-target snipe onto the benched holder", () => {
    const state = fightBench("fix-special");
    deepFreeze(state);

    const { state: done } = snipeAt(state, 2, "holderBench");

    expect(benchedHolder(done)?.damage).toBe(0);
  });

  it("prevents a chosen-target snipe onto the holder in the ACTIVE spot", () => {
    const state = fight("fix-shellcracker", "fix-special");
    deepFreeze(state);

    const { state: done, events } = snipeAt(state, 2, "active");

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("Feint Attack's ignoreWR nulls the prevention — 50 lands on the holder", () => {
    const state = fight("fix-shellcracker", "fix-special");
    deepFreeze(state);

    const { state: done } = snipeAt(state, 3, "active");

    expect(done.players.p2.active?.damage).toBe(50);
  });
});

describe("Mighty Shell — the EFFECTS half (interpreter.ts attackEffectRefused, site 5 of 5)", () => {
  it("refuses an attack's STATUS and announces the refusal", () => {
    const state = fight("fix-shellcracker", "fix-special");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, yawn);

    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toMatchObject({ seat: "p2" });
    expect(types(events)).not.toContain("STATUS_APPLIED");
    expect(done.players.p2.active?.conditions?.rotation).toBe("none");
  });

  it("…and the SAME attack from a Basic-Energy attacker puts the holder to sleep", () => {
    const state = fight("fix-shellcracker", "fix-energy");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, yawn);

    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.conditions?.rotation).toBe("asleep");
  });

  it("refuses an attack's RETREAT LOCK too — the funnel, not the op", () => {
    const state = fight("fix-shellcracker", "fix-special");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, clutch);

    expect(types(events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(types(events)).not.toContain("RETREAT_BLOCKED");
    expect(done.players.p2.active?.retreatBlocked).toBe(false);
  });

  it("…and lets the retreat lock land when the attacker holds a Basic Energy", () => {
    const state = fight("fix-shellcracker", "fix-energy");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, clutch);

    expect(types(events)).toContain("RETREAT_BLOCKED");
    expect(done.players.p2.active?.retreatBlocked).toBe(true);
  });

  it("refuses damage AND effect from one attack — Yawn's 0 damage is not the point", () => {
    const state = fight("fix-shellcracker", "fix-special");
    deepFreeze(state);

    const bites = mustApply(state, bite);
    const yawns = mustApply(state, yawn);

    expect(find(bites.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(types(yawns.events)).toContain("ATTACK_EFFECT_PREVENTED");
  });
});

describe("Mighty Shell — §9, and it must switch BOTH halves", () => {
  // The HOLDER's aura IS an Ability, so a lock over it must switch the prevention
  // off. Klefki is Active-gated, so the locking body has to be the attacking body.
  it("a lock over the HOLDER switches the DAMAGE half off", () => {
    const state = fight("sv01-096", "fix-special");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, joust);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 10 });
    expect(done.players.p2.active?.damage).toBe(10);
  });

  it("…and `passivesOf` is where that answer is made", () => {
    const state = fight("sv01-096", "fix-special");
    const holder = state.players.p2.active;
    if (holder === null || holder === undefined) throw new Error("no active");

    expect(passivesOf(state, holder).preventDamageAndEffectsFromSpecialEnergy).toBe(false);
  });

  it("a lock over the HOLDER switches the EFFECTS half off as well", () => {
    let locked = driveSetup(1, { p1: MIGHTY_SHELL_DECK, p2: MIGHTY_SHELL_DECK }, { first: "p2" });
    locked = setActiveFromDeck(locked, "p2", "fix-mightyshell");
    locked = mustApply(locked, { type: "endTurn", seat: "p2" }).state;
    locked = setActiveFromDeck(locked, "p1", "sv01-096");
    locked = attachFromDeck(locked, "p1", "fix-special", 1);
    deepFreeze(locked);

    // Klefki's own attack carries no effect, so the EFFECTS half is read at the
    // fold rather than through an op here — the same value `attackEffectRefused`
    // consults, one function call earlier.
    const holder = locked.players.p2.active;
    if (holder === null || holder === undefined) throw new Error("no active");
    expect(passivesOf(locked, holder).preventDamageAndEffectsFromSpecialEnergy).toBe(false);

    const { events } = mustApply(locked, joust);
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });
});

describe("Mighty Shell — the fold (continuous.ts passivesOf)", () => {
  it("reports the flag on the holder and FALSE on every other body", () => {
    const state = fightBench("fix-special");
    const holder = benchedHolder(state);
    const active = state.players.p2.active;
    if (holder === undefined || active === null || active === undefined)
      throw new Error("board not set up");

    expect(passivesOf(state, holder).preventDamageAndEffectsFromSpecialEnergy).toBe(true);
    expect(passivesOf(state, active).preventDamageAndEffectsFromSpecialEnergy).toBe(false);
  });

  it("leaves the three sibling prevention fields alone", () => {
    const state = fightBench("fix-special");
    const holder = benchedHolder(state);
    if (holder === undefined) throw new Error("no benched holder");
    const fold = passivesOf(state, holder);

    expect(fold.preventDamageAndEffectsFromSpecialEnergy).toBe(true);
    expect(fold.preventDamageFromHasAbility).toBe(false);
    expect(fold.preventDamageFromExV).toBe(false);
    expect(fold.preventDamageFromTypes).toEqual([]);
  });

  it("does not consult the attacker — the flag is a fact about the HOLDER only", () => {
    const armed = fight("fix-shellcracker", "fix-special");
    const bare = fight("fix-shellcracker", "fix-energy");
    const a = armed.players.p2.active;
    const b = bare.players.p2.active;
    if (a === null || a === undefined || b === null || b === undefined)
      throw new Error("no active");

    expect(passivesOf(armed, a).preventDamageAndEffectsFromSpecialEnergy).toBe(true);
    expect(passivesOf(bare, b).preventDamageAndEffectsFromSpecialEnergy).toBe(true);
  });
});

describe("Mighty Shell — the fixture cast", () => {
  it("the demonstrator carries the printed sentence verbatim", () => {
    expect(FIXTURE_POOL["fix-mightyshell"]?.abilities?.[0]?.effect).toBe(
      "Prevent all damage from and effects of attacks done to this Pokémon by your opponent's Pokémon that have any Special Energy attached.",
    );
  });

  // The attacker's three negatives, asserted rather than assumed: no Ability, no
  // rule box, no printed type the holder is weak to. Without them a prevented
  // board could be some other gate's.
  it("the attacker arms none of the three sibling gates", () => {
    const attacker = FIXTURE_POOL["fix-shellcracker"];

    expect(attacker?.abilities ?? []).toEqual([]);
    expect(attacker?.name).toBe("fix-shellcracker");
    expect(FIXTURE_POOL["fix-mightyshell"]?.weaknesses ?? []).toEqual([]);
  });

  // All five read sites are reachable from ONE body, which is the property that
  // keeps "the attacker has a Special Energy" constant across all five.
  it("the attacker prints one attack per read site, six in all", () => {
    expect((FIXTURE_POOL["fix-shellcracker"]?.attacks ?? []).map((a) => a.name)).toEqual([
      "Bite",
      "Spread Shot",
      "Pebble Toss",
      "Feint Attack",
      "Yawn",
      "Clutch",
    ]);
  });
});
