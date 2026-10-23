import { describe, expect, it } from "vitest";
import { applyAction, disabledAbilityUids, programFor } from "./index";
import { registryCardIds } from "./registry";
import type { GameState } from "./index";
import { redactGame } from "./redact";
import {
  ABILITY_LOCK_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  types,
  findEvent,
} from "./testFixtures";

const attack0 = { type: "attack", seat: "p1", index: 0 } as const;

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: ABILITY_LOCK_DECK, p2: ABILITY_LOCK_DECK }, { first: "p2" });
  for (const seat of ["p1", "p2"] as const) {
    const opened = state.cardIdByUid[activeUid(state, seat)];
    if (opened !== "fix-bigbody") {
      throw new Error(`seed ${seed}: ${seat} opened on ${opened}, not the neutral fix-bigbody`);
    }
  }
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

describe("disableAbilities — the registry row", () => {
  it("authors Klefki, Spiritomb and all four Ting-Lu ex prints (and nobody else)", () => {
    expect(programFor("sv01-096")?.passive?.disableAbilities).toEqual({
      stage: "Basic",
      side: "both",
      requiresActive: true,
      exemptAbilityNamed: "Mischievous Lock",
    });
    expect(programFor("sv02-089")?.passive?.disableAbilities).toEqual({
      stage: "Basic",
      suffix: "V",
      side: "both",
    });
    for (const id of ["sv02-127", "sv02-243", "sv02-263", "sv02-275"]) {
      expect(programFor(id)?.passive?.disableAbilities).toEqual({
        side: "opponent",
        requiresDamage: true,
        requiresActive: true,
        exemptSuffix: "ex",
      });
    }
    // Two Spiritomb exist in the pool: sv01-129 (Taunt / Doom Decree) has no
    // Ability at all and must NOT carry the lock.
    expect(programFor("sv01-129")?.passive?.disableAbilities).toBeUndefined();
    expect(
      registryCardIds()
        .filter((id) => programFor(id)?.passive?.disableAbilities !== undefined)
        .sort(),
    ).toEqual(
      [
        "sv01-096",
        "sv02-089",
        "sv02-127",
        "sv02-243",
        "sv02-263",
        "sv02-275",
        "sv05-078",
        "sv08.5-043",
        "svp-097",
        "sv08-107",
        "sv06-077",
        "sv06-196",
        "sv08.5-032",
        "me02.5-039",
        "me02.5-040",
        "me02.5-226",
        "mep-007",
        "mep-008",
      ].sort(),
    );
  });
});

describe("disabledAbilityUids — the aura scan", () => {
  it("is empty on a board with no lock in play", () => {
    // The no-op guarantee: every board the whole rest of the engine plays on is
    // byte-identically unaffected, ability-holders included.
    let state = benchFromDeck(board(3), "p1", "sv03-174"); // Bouffalant — a passive
    state = setActiveFromDeck(state, "p2", "sv02-061"); // Chien-Pao ex — an activated one
    expect(disabledAbilityUids(state)).toEqual(new Set());
  });

  it("Klefki locks every Basic on BOTH boards, skipping non-Basics and itself", () => {
    let state = setActiveFromDeck(board(3), "p1", "sv01-096"); // P1 bench: [fix-bigbody]
    state = benchFromDeck(state, "p1", "sv03-174"); // …[fix-bigbody, Bouffalant]
    state = setActiveFromDeck(state, "p2", "sv03-044"); // Armarouge, P2 bench: [fix-bigbody]
    state = benchFromDeck(state, "p2", "fix-stage1"); // …[fix-bigbody, a Stage 1]

    const locked = disabledAbilityUids(state);

    expect(locked).toEqual(
      new Set([
        benchTopUid(state, "p1", 0), // P1's own displaced fix-bigbody — "both yours…"
        benchTopUid(state, "p1", 1), // …and Bouffalant, also its controller's
        activeUid(state, "p2"), // "…and your opponent's"
        benchTopUid(state, "p2", 0),
      ]),
    );
    // "except for Mischievous Lock" — matched on the target card's printed Ability
    // NAME, so Klefki never turns itself off.
    expect(locked.has(activeUid(state, "p1"))).toBe(false);
    // "Basic Pokémon in play" — a Stage 1 is out of the target set entirely.
    expect(locked.has(benchTopUid(state, "p2", 1))).toBe(false);
  });

  it("Klefki's aura goes dark from the Bench (the Active-Spot clause)", () => {
    let state = benchFromDeck(board(21), "p1", "sv01-096");
    state = setActiveFromDeck(state, "p2", "sv03-044");
    expect(disabledAbilityUids(state)).toEqual(new Set());
  });

  it("a mirror match leaves BOTH Klefki's locks on (each exempts the other)", () => {
    let state = setActiveFromDeck(board(24), "p1", "sv01-096");
    state = setActiveFromDeck(state, "p2", "sv01-096");

    const locked = disabledAbilityUids(state);

    // The exemption is by ability NAME, not by identity, so the opposing Klefki —
    // a Basic, squarely in the target set — keeps Mischievous Lock too…
    expect(locked.has(activeUid(state, "p1"))).toBe(false);
    expect(locked.has(activeUid(state, "p2"))).toBe(false);
    // …and both auras are live, so each side's displaced body is locked twice over.
    expect(locked).toEqual(new Set([benchTopUid(state, "p1", 0), benchTopUid(state, "p2", 0)]));
  });

  it("Spiritomb locks Basic V on both boards FROM THE BENCH, and misses VMAX", () => {
    let state = benchFromDeck(board(27), "p1", "sv02-089"); // P1 bench: [Spiritomb]
    state = setActiveFromDeck(state, "p1", "fix-pokemon-v"); // …[Spiritomb, fix-bigbody]
    state = setActiveFromDeck(state, "p2", "fix-pokemon-vmax"); // P2 bench: [fix-bigbody]
    state = benchFromDeck(state, "p2", "fix-pokemon-v"); // …[fix-bigbody, a V]

    const locked = disabledAbilityUids(state);

    // No "in the Active Spot" clause on this one — a BENCHED Spiritomb locks, and
    // the target set is exactly the Basic Vs on both boards.
    expect(locked).toEqual(new Set([activeUid(state, "p1"), benchTopUid(state, "p2", 1)]));
    // "V" is a printed-suffix match, not a prefix one: a VMAX is a near-miss.
    expect(locked.has(activeUid(state, "p2"))).toBe(false);
    // Spiritomb is a Basic but not a V, so it is not its own target either.
    expect(locked.has(benchTopUid(state, "p1", 0))).toBe(false);
  });

  it("Ting-Lu ex locks only the opponent's DAMAGED non-ex Pokémon", () => {
    let state = setActiveFromDeck(board(35), "p1", "sv02-127"); // P1 bench: [fix-bigbody]
    state = setBenchDamage(state, "p1", 0, 30); // the source's OWN damaged body
    state = setActiveFromDeck(state, "p2", "sv03-174"); // Bouffalant, P2 bench: [fix-bigbody]
    state = setDamage(state, "p2", 20); // "…that have any damage counters on them"
    state = benchFromDeck(state, "p2", "sv02-150"); // …[fix-bigbody, Copperajah ex]
    state = setBenchDamage(state, "p2", 1, 40); // a DAMAGED ex — the exemption

    const locked = disabledAbilityUids(state);

    expect(locked).toEqual(new Set([activeUid(state, "p2")]));
    // "your opponent's Pokémon" — the source's own damaged bench is untouched.
    expect(locked.has(benchTopUid(state, "p1", 0))).toBe(false);
    // "that have any damage counters on them" — an undamaged opponent is fine.
    expect(locked.has(benchTopUid(state, "p2", 0))).toBe(false);
    // "except for Pokémon ex" — damaged, opposing, and still keeps its Ability.
    expect(locked.has(benchTopUid(state, "p2", 1))).toBe(false);
  });

  it("Ting-Lu ex's aura goes dark from the Bench (the Active-Spot clause)", () => {
    let state = benchFromDeck(board(37), "p1", "sv02-127");
    state = setActiveFromDeck(state, "p2", "sv03-174");
    state = setDamage(state, "p2", 20);
    expect(disabledAbilityUids(state)).toEqual(new Set());
  });

  it("D571 — a locked lock STOPS locking (the stratified pass, R-LK2): Klefki silences Ting-Lu ex, so Cursed Land is OFF", () => {
    let state = setActiveFromDeck(board(38), "p1", "sv01-096"); // P1 bench: [fix-bigbody]
    state = benchFromDeck(state, "p1", "fix-stage1"); // …[fix-bigbody, a Stage 1]
    state = setBenchDamage(state, "p1", 1, 10);
    state = setActiveFromDeck(state, "p2", "sv02-127");

    const locked = disabledAbilityUids(state);

    expect(locked.has(activeUid(state, "p2"))).toBe(true); // Klefki DOES lock Ting-Lu ex
    expect(locked.has(benchTopUid(state, "p1", 1))).toBe(false);
  });

  it("D571 — the DAMAGED-Klefki board is a MUTUAL cycle (R-LK2): Ting-Lu ex and Klefki silence each other, and BOTH locks stay ON", () => {
    let state = setActiveFromDeck(board(38), "p1", "sv01-096"); // P1 bench: [fix-bigbody]
    state = benchFromDeck(state, "p1", "fix-stage1"); // …[fix-bigbody, a Stage 1]
    state = setBenchDamage(state, "p1", 1, 10);
    state = setDamage(state, "p1", 10); // the DAMAGED Klefki — inside Cursed Land's reach
    state = setActiveFromDeck(state, "p2", "sv02-127");

    const locked = disabledAbilityUids(state);

    expect(locked.has(activeUid(state, "p2"))).toBe(true); // Mischievous Lock ON: Ting-Lu ex silenced
    expect(locked.has(activeUid(state, "p1"))).toBe(true); // Cursed Land ON: the damaged Klefki silenced
    expect(locked.has(benchTopUid(state, "p1", 1))).toBe(true); // …and Cursed Land still reaches the damaged Stage 1
    // The whole Set: Klefki's lock also takes both boards' Basic fix-bigbody — exactly the
    // ungated one-pass answer, because a cycle changes nothing (Mischievous Lock stays on).
    expect(locked).toEqual(
      new Set([
        activeUid(state, "p1"),
        benchTopUid(state, "p1", 0),
        benchTopUid(state, "p1", 1),
        activeUid(state, "p2"),
        benchTopUid(state, "p2", 0),
      ]),
    );
  });
});

describe("the ACTIVATED read site (§9 useAbility)", () => {
  it("rejects with ABILITY_DISABLED — checked BEFORE the Active-only gate", () => {
    // A benched Chien-Pao ex is doubly unusable: Shivery Chill is Active-only AND
    // Klefki has locked it. The lock is reported, so the player is told the real
    // reason rather than an incidental one.
    let state = setActiveFromDeck(board(42), "p1", "sv01-096");
    state = benchFromDeck(state, "p1", "sv02-061"); // bench: [fix-bigbody, Chien-Pao ex]
    expectErr(
      state,
      {
        type: "useAbility",
        seat: "p1",
        target: { spot: "bench", index: 1 },
        abilityName: "Shivery Chill",
      },
      "ABILITY_DISABLED",
    );
  });

  it("…and the same call falls back to ABILITY_ACTIVE_ONLY with no lock in play", () => {
    const state = benchFromDeck(board(42), "p1", "sv02-061"); // bench: [Chien-Pao ex]
    expectErr(
      state,
      {
        type: "useAbility",
        seat: "p1",
        target: { spot: "bench", index: 0 },
        abilityName: "Shivery Chill",
      },
      "ABILITY_ACTIVE_ONLY",
    );
  });

  it("Cursed Land locks the opponent's Ability the instant it takes a counter", () => {
    let state = setActiveFromDeck(board(51), "p1", "sv02-105"); // P1's Active Tinkaton
    state = setActiveFromDeck(state, "p2", "sv02-127"); // Ting-Lu ex across the table
    const use = {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Gather Materials",
    } as const;

    // Undamaged: outside Cursed Land's target set, so the Ability runs (it parks on
    // its "discard a card" cost — accepted is all this asserts).
    expect(applyAction(state, use).ok).toBe(true);
    // One counter is all "any damage counters on them" asks for.
    expectErr(setDamage(state, "p1", 10), use, "ABILITY_DISABLED");
  });
});

describe("the PASSIVE read site (continuous.ts passivesOf)", () => {
  it("suppresses the defender's Bouffer — the whole printed 10 lands", () => {
    let state = setActiveFromDeck(board(35), "p1", "sv01-096"); // Klefki attacks…
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = setActiveFromDeck(state, "p2", "sv03-174"); // …a Basic whose passive is off

    const { events } = mustApply(state, attack0);

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 10 });

    // Joust's own baseline, so "10" above is the FULL printed number and not a
    // reduced one that happens to land on it.
    let plain = setActiveFromDeck(board(35), "p1", "sv01-096");
    plain = attachFromDeck(plain, "p1", "fix-energy", 1);
    plain = setActiveFromDeck(plain, "p2", "fix-bigbody"); // no passive at all
    expect(findEvent(mustApply(plain, attack0).events, "DAMAGE_DEALT")).toMatchObject({
      dealt: 10,
    });
  });

  it("…while the SAME Bouffalant takes 20 off an attacker with no lock in play", () => {
    let state = setActiveFromDeck(board(35), "p1", "fix-attacker"); // Bite ({C}, 30), no aura
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = setActiveFromDeck(state, "p2", "sv03-174");

    const { events } = mustApply(state, attack0);

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 10 });

    let plain = setActiveFromDeck(board(35), "p1", "fix-attacker");
    plain = attachFromDeck(plain, "p1", "fix-energy", 1);
    plain = setActiveFromDeck(plain, "p2", "fix-bigbody");
    expect(findEvent(mustApply(plain, attack0).events, "DAMAGE_DEALT")).toMatchObject({
      dealt: 30,
    });
  });

  it("leaves a locked Pokémon's attached TOOL working (a Tool is not an Ability)", () => {
    // The other half of the passive site: `passivesOf` drops only the TOP CARD's
    // printed passive, because that one is an Ability — the Tool sources beside it
    // are §7.4 card effects and keep contributing.
    let state = setActiveFromDeck(board(55), "p1", "fix-attacker");
    state = handFromDeck(state, "p1", "sv01-197", 1);
    const band = handUid(state, "p1", "sv01-197");
    state = mustApply(state, {
      type: "attachTool",
      seat: "p1",
      uid: band,
      target: { spot: "active" },
    }).state;
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = setActiveFromDeck(state, "p2", "sv01-096"); // Klefki — locks Basics both sides

    expect(disabledAbilityUids(state).has(activeUid(state, "p1"))).toBe(true);

    const { events } = mustApply(state, attack0);

    // Bite's 30 + Vitality Band's 10: the attacker is locked, its Tool is not.
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 40 });
  });
});

describe("the TRIGGERED read site (triggers.ts triggersOf)", () => {
  it("suppresses Armarouge's onDamagedByAttack trigger — the attacker is not Burned", () => {
    let state = setActiveFromDeck(board(57), "p1", "sv01-096");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = setActiveFromDeck(state, "p2", "sv03-044");

    const { state: done, events } = mustApply(state, attack0);

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 10 });
    // …and the reaction never fires.
    expect(types(events)).not.toContain("ABILITY_TRIGGERED");
    expect(done.players.p1.active?.conditions.burned).toBeFalsy();
  });

  it("…while an unlocked Armarouge Burns the attacker that hit it", () => {
    let state = setActiveFromDeck(board(57), "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = setActiveFromDeck(state, "p2", "sv03-044");

    const { events } = mustApply(state, attack0);

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 30 });
    expect(findEvent(events, "ABILITY_TRIGGERED")).toMatchObject({
      seat: "p2",
      ability: "Scorching Armor",
    });
    expect(findEvent(events, "STATUS_APPLIED")).toMatchObject({ seat: "p1", status: "burned" });
  });
});

describe("the HUD read site (redact.ts)", () => {
  it("greys a locked Ability row, mirroring the engine's reject", () => {
    let state = setActiveFromDeck(board(58), "p1", "sv02-061");
    state = setActiveFromDeck(state, "p2", "sv01-096"); // the aura reaches across

    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");

    // Disabled with NO reason string — the lock is self-evident on the board, like
    // the Active-only and already-used greyings beside it.
    expect(phase.abilities).toEqual([
      {
        target: { spot: "active" },
        abilityName: "Shivery Chill",
        label: "Shivery Chill · Chien-Pao ex (Active)",
        disabled: true,
        reason: null,
      },
    ]);
  });

  it("…and leaves the identical row enabled with no lock in play", () => {
    const state = setActiveFromDeck(board(58), "p1", "sv02-061");

    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");

    expect(phase.abilities).toEqual([
      {
        target: { spot: "active" },
        abilityName: "Shivery Chill",
        label: "Shivery Chill · Chien-Pao ex (Active)",
        disabled: false,
        reason: null,
      },
    ]);
  });
});
