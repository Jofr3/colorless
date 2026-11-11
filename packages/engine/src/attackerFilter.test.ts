import { describe, expect, it } from "vitest";
import {
  benchShieldedFromDamage,
  disabledAbilityUids,
  passivesOf,
  preventsAttackerType,
  stadiumPreventsDamage,
} from "./continuous";
import { deriveAttackEffect } from "./effects";
import { applyAction, programFor, stadiumEffectsOf } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  ATTACKER_FILTER_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  findEvent,
  findEvents,
} from "./testFixtures";

/** The four printed sentences, byte-for-byte off the local D1 rows. */
const WELL_BAKED_BODY =
  "This Pokémon can't be Burned. Prevent all damage done to this Pokémon by attacks from your opponent's {R} Pokémon.";
const INSULATOR =
  "Prevent all damage done to this Pokémon by attacks from your opponent's {L} Pokémon.";
const ADVERSE_WEATHER =
  "As long as this Pokémon is in the Active Spot, prevent all damage done to your Benched Pokémon by attacks from your opponent's Pokémon.";
const NEUTRALIZATION_ZONE =
  "Prevent all damage done to Pokémon that don't have a Rule Box (both yours and your opponent's) by attacks from the opponent's Pokémon ex and Pokémon V. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)\n\nThis card can't be put into your hand or deck from the discard pile.";

const SEED = 11;

const ATTACKERS = {
  "fix-attacker": { index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // FIRE "Bite" (30)
  "sv02-063": { index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // Pikachu ex — LIGHTNING "Pika Punch" (30)
  "fix-attacker-ex": { index: 1, energy: [{ id: "fix-energy", count: 1 }] }, // FIRE ex "Spread Shot" (30 + 20 each)
  "fix-attacker-ex-bite": { index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // the same body's idx-0 "Bite"
  "fix-attacker-vmax": { index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // FIRE VMAX "Bite" (30)
  "fix-sniper": { index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // FIRE "Spread Shot" (30 + 20 each)
  "fix-feint": { index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // LIGHTNING "Feint Attack" (50, ignoreWR)
  "sv06.5-038": { index: 0, energy: [{ id: "fix-energy", count: 3 }] }, // Fezandipiti ex — "Cruel Arrow" (opponentAny 100)
  "sv01-069": { index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // Rotom — "Linear Attack" (opponentAny 20)
  "sv02-127": { index: 0, energy: [{ id: "fix-fighting-energy", count: 3 }] }, // Ting-Lu ex — "Land Scoop" (150)
} as const;

/** The fixture id an ATTACKERS key names — the one key that is a second INDEX on
    a body already in the table rather than a card of its own. */
function cardOf(attacker: keyof typeof ATTACKERS): string {
  return attacker === "fix-attacker-ex-bite" ? "fix-attacker-ex" : attacker;
}

function board(attacker: keyof typeof ATTACKERS, defender: string, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: ATTACKER_FILTER_DECK, p2: ATTACKER_FILTER_DECK }, { first: opener }),
      {
        type: "endTurn",
        seat: opener,
      },
    ),
  );
  state = setActiveFromDeck(state, by, cardOf(attacker));
  for (const { id, count } of ATTACKERS[attacker].energy) {
    state = attachFromDeck(state, by, id, count);
  }
  state = setActiveFromDeck(state, opener, defender);
  return state;
}

function swing(state: GameState, attacker: keyof typeof ATTACKERS, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKERS[attacker].index });
}

/** Put Neutralization Zone into the shared zone from `seat`'s hand. It must be
    that seat's own turn to play a Trainer, which is why the Stadium cases that
    need the OTHER seat to swing play it first and hand the turn over. */
function withStadium(state: GameState, seat: Seat = "p1"): GameState {
  const next = handFromDeck(state, seat, "sv06.5-060", 1);
  return mustApply(next, { type: "playTrainer", seat, uid: handUid(next, seat, "sv06.5-060") })
    .state;
}

/** Put damage counters on a seat's Active — the switch that arms Ting-Lu ex's
    "Cursed Land" against it ("that have any damage counters on them"). */
function withDamage(state: GameState, seat: Seat, damage: number): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to damage");
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, active: { ...active, damage } } },
  };
}

/** The seat's benched body carrying `cardId` (found by card id, not by slot — a
    board built by successive Active surgeries does not put it at index 0). */
function benched(state: GameState, seat: Seat, cardId: string) {
  return state.players[seat].bench.find((p) => state.cardIdByUid[p.stack.at(-1) ?? ""] === cardId);
}

function rowFor(events: GameEvent[], uid: string | undefined) {
  return findEvents(events, "DAMAGE_DEALT").find((e) => e.uid === uid);
}

// ─────────────────────────────────────────────────────────────────────────────
// The data: the catalog rows, the fixtures, and the registry rows.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed data — re-queried, not inherited", () => {
  it("carries every NAME, printed Ability and printed attack verbatim", () => {
    expect(FIXTURE_POOL["sv01-099"]).toMatchObject({
      name: "Dachsbun",
      stage: "Stage1",
      evolveFrom: "Fidough",
      hp: 90,
      types: ["Psychic"],
      retreat: 1,
    });
    expect(FIXTURE_POOL["sv01-099"]?.abilities).toEqual([
      { type: "Ability", name: "Well-Baked Body", effect: WELL_BAKED_BODY },
    ]);
    expect(FIXTURE_POOL["sv01-099"]?.attacks).toEqual([
      { cost: ["Psychic", "Colorless", "Colorless"], name: "Headbutt Bounce", damage: 100 },
    ]);

    for (const id of ["sv03-078", "sv03-201"] as const) {
      expect(FIXTURE_POOL[id]).toMatchObject({
        name: "Bellibolt",
        stage: "Stage1",
        evolveFrom: "Tadbulb",
        hp: 140,
        types: ["Lightning"],
        retreat: 3,
      });
      expect(FIXTURE_POOL[id]?.abilities).toEqual([
        { type: "Ability", name: "Insulator", effect: INSULATOR },
      ]);
    }

    expect(FIXTURE_POOL["sv03-070"]).toMatchObject({
      name: "Thundurus",
      stage: "Basic",
      hp: 110,
      types: ["Lightning"],
      retreat: 2,
    });
    expect(FIXTURE_POOL["sv03-070"]?.abilities).toEqual([
      { type: "Ability", name: "Adverse Weather", effect: ADVERSE_WEATHER },
    ]);

    expect(FIXTURE_POOL["sv06.5-060"]).toMatchObject({
      name: "Neutralization Zone",
      category: "Trainer",
      trainerType: "Stadium",
      effect: NEUTRALIZATION_ZONE,
    });
  });

  it("ONE of the two LOUD clauses has since been BUILT — RE-POINTED, not deleted", () => {
    expect(FIXTURE_POOL["sv01-099"]?.abilities?.[0]?.effect).toContain("can't be Burned.");
    expect(FIXTURE_POOL["sv06.5-060"]?.effect).toContain(
      "can't be put into your hand or deck from the discard pile.",
    );
    expect(programFor("sv01-099")?.passive).toEqual({
      statusImmunities: ["burned"],
      preventDamageFromType: "Fire",
    });
    // The Stadium's second paragraph is still unread, and still has no field.
    expect(programFor("sv06.5-060")?.stadium).toEqual({ preventDamageToNoRuleBoxFromExV: true });
  });

  it("AUTHORS all five printings on THREE programs, and the reprint shares one", () => {
    expect(programFor("sv01-099")?.passive?.preventDamageFromType).toBe("Fire");
    expect(programFor("sv03-078")?.passive).toEqual({ preventDamageFromType: "Lightning" });
    expect(programFor("sv03-201")?.passive).toBe(programFor("sv03-078")?.passive);
    expect(programFor("sv03-070")?.passive).toEqual({ preventBenchDamageWhileActive: true });
    expect(programFor("sv06.5-060")?.stadium).toEqual({ preventDamageToNoRuleBoxFromExV: true });
    // No attack program on any of them: every sentence here is an ABILITY or a
    // Stadium, so nothing reaches the deriver at all.
    for (const id of ["sv01-099", "sv03-078", "sv03-201", "sv03-070", "sv06.5-060"] as const) {
      expect(programFor(id)?.attack).toBeUndefined();
    }
  });

  it("…and all four sentences STAY LOUD as attack text", () => {
    for (const text of [WELL_BAKED_BODY, INSULATOR, ADVERSE_WEATHER, NEUTRALIZATION_ZONE]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon.",
      ),
    ).toEqual([{ op: "preventDamage", fromClass: { stage: "basic" } }]);
  });

  it("is the WHOLE mapped set — the census, swept out of the pool rather than listed", () => {
    const typed = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventDamageFromType !== undefined,
    );
    expect(typed.sort()).toEqual(["sv01-099", "sv03-078", "sv03-201"]);
    const benchShield = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventBenchDamageWhileActive === true,
    );
    expect(benchShield).toEqual(["sv03-070"]);
    const seatBenchShield = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventBenchDamageAndEffects === true,
    );
    expect(seatBenchShield).toEqual(["fix-spherical"]);
    const noRuleBoxBenchShield = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventBenchDamageNoRuleBox === true,
    );
    expect(noRuleBoxBenchShield).toEqual(["fix-flowercurtain"]);
    const stadium = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.stadium?.preventDamageToNoRuleBoxFromExV === true,
    );
    expect(stadium).toEqual(["sv06.5-060"]);
    expect(programFor("sv02-097")?.passive).toEqual({ preventDamageFromExV: true });
    const suffixClass = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventDamageFromAttackerClass !== undefined,
    );
    expect(suffixClass.sort()).toEqual(["fix-armortail", "fix-safeguardex"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mechanism 1 — the ATTACKER's printed TYPE, on the holder's own body.
// ─────────────────────────────────────────────────────────────────────────────

describe("preventsAttackerType — the predicate", () => {
  it("reads Card.types, and is FALSE on an empty list or an unresolvable attacker", () => {
    const fire = FIXTURE_POOL["fix-attacker"];
    expect(preventsAttackerType(["Fire"], fire)).toBe(true);
    expect(preventsAttackerType(["Lightning"], fire)).toBe(false);
    // Totality on both degenerate arguments: no aura, and no attacking card.
    expect(preventsAttackerType([], fire)).toBe(false);
    expect(preventsAttackerType(["Fire"], undefined)).toBe(false);
  });

  it("`passivesOf` COLLECTS the token rather than folding it to a scalar", () => {
    const state = board("fix-attacker", "sv01-099");
    const dachsbun = state.players.p2.active;
    if (dachsbun === null) throw new Error("board");
    expect(passivesOf(state, dachsbun).preventDamageFromTypes).toEqual(["Fire"]);
    // A body with no such aura contributes an EMPTY list, not `undefined` — which
    // is what lets the read sites spell one `.some` with no null check.
    const attacker = state.players.p1.active;
    if (attacker === null) throw new Error("board");
    expect(passivesOf(state, attacker).preventDamageFromTypes).toEqual([]);
  });
});

describe("the type filter at the four damage sites", () => {
  it("main hit: a FIRE Bite into Dachsbun is nulled; a LIGHTNING one is not", () => {
    const matched = swing(board("fix-attacker", "sv01-099"), "fix-attacker");
    expect(findEvent(matched.events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p2",
      dealt: 0,
      prevented: true,
    });
    expect(matched.state.players.p2.active?.damage).toBe(0);

    // The NEGATIVE case is a printed card rather than a bespoke fixture: Pikachu
    // ex is Lightning, so Dachsbun's {R} clause declines and its own 30 lands.
    const missed = swing(board("sv02-063", "sv01-099"), "sv02-063");
    const row = findEvent(missed.events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ dealt: 30 });
    expect(row?.prevented).toBeUndefined();
  });

  it("…AND THE TWO PRINTINGS ARE EACH OTHER'S NEGATIVE CASE", () => {
    const matched = swing(board("sv02-063", "sv03-078"), "sv02-063");
    expect(findEvent(matched.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });

    const missed = swing(board("fix-attacker", "sv03-078"), "fix-attacker");
    expect(findEvent(missed.events, "DAMAGE_DEALT")?.prevented).toBeUndefined();
    expect(findEvent(missed.events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("the REPRINT behaves identically — the program is keyed by id", () => {
    const { events } = swing(board("sv02-063", "sv03-201"), "sv02-063");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
  });

  it("spreadDamage: it protects a BENCHED holder too (no Active-Spot clause)", () => {
    let state = board("fix-sniper", "fix-bigbody");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "sv01-099");
    state = benchFromDeck(state, "p2", "sv03-078");
    const dachsbunUid = benched(state, "p2", "sv01-099")?.stack.at(-1);
    const bellibolUid = benched(state, "p2", "sv03-078")?.stack.at(-1);

    const { events } = swing(state, "fix-sniper");
    expect(rowFor(events, dachsbunUid)).toMatchObject({ dealt: 0, prevented: true });
    expect(rowFor(events, bellibolUid)).toMatchObject({ dealt: 20 });
    expect(rowFor(events, bellibolUid)?.prevented).toBeUndefined();
    // …and the Active took its 30 the whole time, so nothing was prevented wholesale.
    expect(events.filter((e) => e.type === "DAMAGE_DEALT").length).toBe(3);
  });

  it("snipeActive: Rotom's LIGHTNING 20 into Bellibolt is nulled", () => {
    // P2's Bench is emptied so the count-1 `opponentAny` pick auto-takes the
    // Active rather than parking (anyTargetSnipe.test.ts's idiom).
    const { events } = swing(clearBench(board("sv01-069", "sv03-078"), "p2"), "sv01-069");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      base: 20,
      dealt: 0,
      prevented: true,
    });
  });

  it("placeSnipe `deals` arm: a benched Bellibolt is nulled, a benched Dachsbun is not", () => {
    // Rotom is LIGHTNING; the pick is a benched body, so this is the `deals` arm.
    let state = board("sv01-069", "fix-bigbody");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "sv03-078");
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const pick = prompt.candidates.find(
      (ref) => ref.seat === "p2" && ref.spot.spot === "bench" && ref.spot.index === 0,
    );
    if (pick === undefined) throw new Error("no benched candidate");
    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [pick] },
    });
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.uid).toBe(benchTopUid(parked, "p2", 0));
    expect(row).toMatchObject({ dealt: 0, prevented: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mechanism 2 — Thundurus: the Active shields its own Bench.
// ─────────────────────────────────────────────────────────────────────────────

describe("benchShieldedFromDamage — the same-seat cross-body scan", () => {
  /** Thundurus Active on P2 with `benchIds` behind it, and `attacker` on P1. */
  function shieldBoard(attacker: keyof typeof ATTACKERS, benchIds: string[]): GameState {
    let state = board(attacker, "sv03-070");
    state = clearBench(state, "p2");
    for (const id of benchIds) state = benchFromDeck(state, "p2", id);
    return state;
  }

  it("reads TRUE for a benched body behind an Active Thundurus, and FALSE for Thundurus itself", () => {
    const state = shieldBoard("fix-sniper", ["fix-titan"]);
    const bench = state.players.p2.bench[0];
    const active = state.players.p2.active;
    if (bench === undefined || active === null) throw new Error("board");
    expect(benchShieldedFromDamage(state, bench, "all")).toBe(true);
    // The TARGET clause reads "your BENCHED Pokémon", so the source does not
    // shield itself — which is also why the main hit below is never prevented.
    expect(benchShieldedFromDamage(state, active, "all")).toBe(false);
  });

  it("SOURCE clause: a BENCHED Thundurus shields nothing", () => {
    let state = board("fix-sniper", "fix-bigbody");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "sv03-070");
    state = benchFromDeck(state, "p2", "fix-titan");
    const titan = benched(state, "p2", "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(false);
  });

  it("it is OWN-SIDE: the opponent's Bench is untouched by it", () => {
    let state = shieldBoard("fix-sniper", ["fix-titan"]);
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    const acrossTheTable = state.players.p1.bench[0];
    if (acrossTheTable === undefined) throw new Error("board");
    // The single line that separates this member from `opposingAttackDebuff`: it
    // reads the side it FOUND, never the other one.
    expect(benchShieldedFromDamage(state, acrossTheTable, "all")).toBe(false);
  });

  it("an empty Active Spot reads FALSE rather than throwing", () => {
    const state = shieldBoard("fix-sniper", ["fix-titan"]);
    const bench = state.players.p2.bench[0];
    if (bench === undefined) throw new Error("board");
    const empty: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, active: null } },
    };
    expect(benchShieldedFromDamage(empty, bench, "all")).toBe(false);
  });

  it("spreadDamage: the splash is nulled on the Bench and the Active still takes its 30", () => {
    const state = shieldBoard("fix-sniper", ["fix-titan"]);
    const titanUid = state.players.p2.bench[0]?.stack.at(-1);
    const { state: done, events } = swing(state, "fix-sniper");
    // The main hit lands in full — Adverse Weather says nothing about its holder.
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 30 });
    expect(done.players.p2.active?.damage).toBe(30);
    // …and the 20 splash is nulled.
    expect(rowFor(events, titanUid)).toMatchObject({ dealt: 0, prevented: true });
    expect(done.players.p2.bench[0]?.damage).toBe(0);
  });

  it("…and with Thundurus BENCHED instead, the same swing lands the 20", () => {
    // The control that stops the case above passing for the wrong reason: the only
    // difference is which spot the source is in.
    let state = board("fix-sniper", "fix-bigbody");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "sv03-070");
    state = benchFromDeck(state, "p2", "fix-titan");
    const titanUid = benched(state, "p2", "fix-titan")?.stack.at(-1);
    const { events } = swing(state, "fix-sniper");
    expect(rowFor(events, titanUid)).toMatchObject({ dealt: 20 });
    expect(rowFor(events, titanUid)?.prevented).toBeUndefined();
  });

  it("it filters no attacker IDENTITY — an ex spread is nulled by the same shield", () => {
    const state = shieldBoard("fix-attacker-ex", ["fix-titan"]);
    const titanUid = state.players.p2.bench[0]?.stack.at(-1);
    const { events } = swing(state, "fix-attacker-ex");
    expect(rowFor(events, titanUid)).toMatchObject({ dealt: 0, prevented: true });
  });

  it("placeSnipe `deals` arm: a chosen benched pick is shielded too", () => {
    const state = shieldBoard("sv01-069", ["fix-titan"]);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const pick = prompt.candidates.find(
      (ref) => ref.seat === "p2" && ref.spot.spot === "bench" && ref.spot.index === 0,
    );
    if (pick === undefined) throw new Error("no benched candidate");
    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [pick] },
    });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mechanism 3 — the Stadium: both boards, two predicates, no seat.
// ─────────────────────────────────────────────────────────────────────────────

describe("Neutralization Zone — the Stadium", () => {
  it("is visible through stadiumEffectsOf once played into the shared zone", () => {
    const plain = board("fix-attacker-ex-bite", "fix-bigbody");
    expect(stadiumEffectsOf(plain)?.preventDamageToNoRuleBoxFromExV).toBeUndefined();
    const state = withStadium(plain);
    expect(state.stadium).not.toBeNull();
    expect(stadiumEffectsOf(state)?.preventDamageToNoRuleBoxFromExV).toBe(true);
  });

  it("main hit: an ex's Bite into a no-Rule-Box body is nulled", () => {
    const state = withStadium(board("fix-attacker-ex-bite", "fix-bigbody"));
    const { state: done, events } = swing(state, "fix-attacker-ex-bite");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("…and WITHOUT the Stadium the identical swing lands its 30", () => {
    const { events } = swing(board("fix-attacker-ex-bite", "fix-bigbody"), "fix-attacker-ex-bite");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 30 });
    expect(findEvent(events, "DAMAGE_DEALT")?.prevented).toBeUndefined();
  });

  it("TARGET filter: a defender WITH a Rule Box is not protected", () => {
    const state = withStadium(board("fix-attacker-ex-bite", "sv02-063"));
    const { events } = swing(state, "fix-attacker-ex-bite");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 30 });
    expect(findEvent(events, "DAMAGE_DEALT")?.prevented).toBeUndefined();
  });

  it("ATTACKER filter: a plain attacker is let through", () => {
    const state = withStadium(board("fix-attacker", "fix-bigbody"));
    const { events } = swing(state, "fix-attacker");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 30 });
  });

  it("A VMAX ATTACKER IS LET THROUGH — the board that separates the two predicates", () => {
    const state = withStadium(board("fix-attacker-vmax", "fix-bigbody"));
    const { events } = swing(state, "fix-attacker-vmax");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 30 });
    expect(findEvent(events, "DAMAGE_DEALT")?.prevented).toBeUndefined();
    // …and the scan says so directly, so the verdict is not an accident of the 30.
    const target = state.players.p2.active;
    if (target === null) throw new Error("board");
    expect(stadiumPreventsDamage(state, target, FIXTURE_POOL["fix-attacker-vmax"])).toBe(false);
    expect(stadiumPreventsDamage(state, target, FIXTURE_POOL["fix-attacker-ex"])).toBe(true);
  });

  it("IT PROTECTS BOTH BOARDS — AND STOPS THE SEAT THAT PLAYED IT", () => {
    const state = withStadium(board("fix-attacker-ex-bite", "fix-bigbody", "p2"), "p2");
    const { events } = swing(state, "fix-attacker-ex-bite", "p2");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p1",
      dealt: 0,
      prevented: true,
    });
  });

  it("spreadDamage: one swing, both verdicts on one Bench", () => {
    // fix-attacker-ex's "Spread Shot" hits the Active for 30 and each benched body
    // for 20. The Bench holds a no-Rule-Box body and a Pokémon ex, so the target
    // filter is read twice under one attacker with everything else held fixed.
    let state = board("fix-attacker-ex", "fix-bigbody");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    state = benchFromDeck(state, "p2", "sv02-063");
    const titanUid = benched(state, "p2", "fix-titan")?.stack.at(-1);
    const pikachuUid = benched(state, "p2", "sv02-063")?.stack.at(-1);
    const { events } = swing(withStadium(state), "fix-attacker-ex");
    expect(rowFor(events, titanUid)).toMatchObject({ dealt: 0, prevented: true });
    expect(rowFor(events, pikachuUid)).toMatchObject({ dealt: 20 });
    expect(rowFor(events, pikachuUid)?.prevented).toBeUndefined();
  });

  it("snipeActive: Fezandipiti ex's Cruel Arrow into a no-Rule-Box Active is nulled", () => {
    const state = withStadium(clearBench(board("sv06.5-038", "fix-bigbody"), "p2"));
    const { events } = swing(state, "sv06.5-038");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      base: 100,
      dealt: 0,
      prevented: true,
    });
  });

  it("placeSnipe `deals` arm: the same attacker's benched pick is nulled too", () => {
    let state = board("sv06.5-038", "sv02-063");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    const { state: parked } = mustApply(withStadium(state), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const pick = prompt.candidates.find(
      (ref) => ref.seat === "p2" && ref.spot.spot === "bench" && ref.spot.index === 0,
    );
    if (pick === undefined) throw new Error("no benched candidate");
    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [pick] },
    });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The ON-TARGET / OFF-TARGET split, driven against itself.
// ─────────────────────────────────────────────────────────────────────────────

describe("`ignoreWR` — the one clause that tells the three mechanisms apart", () => {
  it("ON-TARGET: Feint Attack goes THROUGH a benched Bellibolt's own {L} filter", () => {
    // fix-feint is LIGHTNING, so Insulator matches — and is nulled anyway, because
    // it is an effect on the very Pokémon the clause names.
    let state = board("fix-feint", "fix-bigbody");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "sv03-078");
    const { events } = pickBench(state);
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.prevented).toBeUndefined();
    expect(row?.dealt).toBe(50);
  });

  it("…and the control: the SAME body, the same attacker, WITHOUT the clause", () => {
    // Rotom is Lightning too and prints no `ignoreWR`, so the filter fires and the
    // 20 is nulled. Without this the case above could be passing because Insulator
    // was never live on that board at all.
    let state = board("sv01-069", "fix-bigbody");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "sv03-078");
    const { events } = pickBench(state);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
  });

  it("OFF-TARGET: the same Feint Attack is STOPPED DEAD by Thundurus's shield", () => {
    let state = board("fix-feint", "sv03-070");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    const { events } = pickBench(state);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
  });

  it("OFF-TARGET: and so is it by the Stadium, at snipeActive", () => {
    const state = withStadium(clearBench(board("fix-feint", "fix-bigbody"), "p2"));
    const target = state.players.p2.active;
    if (target === null) throw new Error("board");
    expect(stadiumPreventsDamage(state, target, FIXTURE_POOL["fix-feint"])).toBe(false); // not an ex
    expect(stadiumPreventsDamage(state, target, FIXTURE_POOL["sv06.5-038"])).toBe(true);
    // …and driven: Feint Attack's own 50 lands, because its attacker has no rule box.
    const { events } = swing(state, "fix-feint");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 50 });
  });

  /** Declare the `opponentAny` attack and take the pick at P2's bench[0]. */
  function pickBench(state: GameState) {
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const pick = prompt.candidates.find(
      (ref) => ref.seat === "p2" && ref.spot.spot === "bench" && ref.spot.index === 0,
    );
    if (pick === undefined) throw new Error("no benched candidate");
    return mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [pick] },
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — the Ability-lock reaches two of the three, and cannot reach the third.
// ─────────────────────────────────────────────────────────────────────────────

describe("THE §9 PAIR — a lock silences the ABILITIES and leaves the STADIUM standing", () => {
  it("the lock switches Dachsbun's own aura off — and the Stadium prevents anyway", () => {
    const armed = withStadium(board("sv02-127", "sv01-099"));
    const locked = withDamage(armed, "p2", 10);
    const dachsbunUid = activeUid(locked, "p2");
    expect(disabledAbilityUids(armed).has(dachsbunUid)).toBe(false); // undamaged: free
    expect(disabledAbilityUids(locked).has(dachsbunUid)).toBe(true); // damaged: silenced

    // The §9 POSITIVE, at the scan: the catalog fold reports nothing at all.
    const dachsbun = locked.players.p2.active;
    if (dachsbun === null) throw new Error("board");
    expect(passivesOf(armed, dachsbun).preventDamageFromTypes).toEqual(["Fire"]);
    expect(passivesOf(locked, dachsbun).preventDamageFromTypes).toEqual([]);

    // The §9 NEGATIVE, driven: the same lock cannot reach a Stadium, so Land
    // Scoop's 150 is still nulled on a body with no Rule Box.
    const { events } = swing(locked, "sv02-127");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      base: 150,
      dealt: 0,
      prevented: true,
    });
  });

  it("the Stadium is the ONLY difference — remove it and the locked body takes 150", () => {
    // The control that stops the case above passing for the wrong reason.
    const locked = withDamage(board("sv02-127", "sv01-099"), "p2", 10);
    const { events } = swing(locked, "sv02-127");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.prevented).toBeUndefined();
    expect(row?.dealt).toBe(150);
  });

  it("the lock reaches Thundurus's shield too, at the scan", () => {
    let state = withDamage(board("sv02-127", "sv03-070"), "p2", 10);
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    const titan = state.players.p2.bench[0];
    if (titan === undefined) throw new Error("board");
    expect(disabledAbilityUids(state).has(activeUid(state, "p2"))).toBe(true);
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(false);
    // …and with the damage removed the lock's own clause fails and the shield is back.
    const unlocked: GameState = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...state.players.p2,
          active:
            state.players.p2.active === null ? null : { ...state.players.p2.active, damage: 0 },
        },
      },
    };
    expect(benchShieldedFromDamage(unlocked, titan, "all")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Voice.
// ─────────────────────────────────────────────────────────────────────────────

describe("the log — rendered under BOTH seats and READ, not copied", () => {
  function render(
    state: GameState,
    events: GameEvent[],
    names: { p1: string; p2: string },
  ): string {
    const ctx: LogContext = { names, state, elapsed: "+00:11" };
    return logFromEvents(events, ctx)
      .flatMap((entry) =>
        entry.kind === "turn"
          ? []
          : [`${entry.who}: ${entry.segments.map((s) => s.text).join("")}`],
      )
      .join("\n");
  }

  it("THE FLAG HAS EXISTED SINCE 0.58.0 AND NOTHING RENDERED IT — it does now", () => {
    const { state, events } = swing(board("fix-attacker", "sv01-099"), "fix-attacker");
    const line = render(state, events, { p1: "Ember", p2: "Wren" });
    expect(line).toContain("dealt 0 damage to");
    expect(line).toContain("· prevented");
  });

  it("the row is filed under the ATTACKER's seat, and the wording is true there", () => {
    const { state, events } = swing(board("fix-attacker", "sv01-099"), "fix-attacker");
    const row = findEvent(events, "DAMAGE_DEALT");
    expect(row?.seat).toBe("p2");
    expect(render(state, events, { p1: "Ember", p2: "Wren" })).toContain(
      "p1: dealt 0 damage to Dachsbun · prevented",
    );
  });

  it("…and it reads identically with the seats swapped", () => {
    const state = withStadium(board("fix-attacker-ex-bite", "fix-bigbody", "p2"), "p2");
    const swung = swing(state, "fix-attacker-ex-bite", "p2");
    expect(findEvent(swung.events, "DAMAGE_DEALT")?.seat).toBe("p1");
    expect(render(swung.state, swung.events, { p1: "Ember", p2: "Wren" })).toContain(
      "p2: dealt 0 damage to fix-bigbody · prevented",
    );
  });

  it("a hit that was NOT prevented carries no crumb", () => {
    const { state, events } = swing(board("sv02-063", "sv01-099"), "sv02-063");
    expect(render(state, events, { p1: "Ember", p2: "Wren" })).not.toContain("· prevented");
  });

  it("the crumb sits LAST, after the reduction it supersedes", () => {
    // §8.5 order: the reduction is computed and reported, then the prevention nulls
    // the number outright. A reader reconstructing the pipeline sees both, in the
    // order the engine ran them — which is the whole reason the breadcrumbs exist.
    const segments = ["scaled", "boosted", "weakened", "reduced", "prevented"];
    const source = logFromEvents(
      [
        {
          type: "DAMAGE_DEALT",
          seat: "p2",
          by: "p1",
          uid: "u",
          base: 50,
          weakness: null,
          resistance: null,
          reduction: 20,
          prevented: true,
          dealt: 0,
          damage: 0,
        },
      ],
      {
        names: { p1: "Ember", p2: "Wren" },
        state: board("fix-attacker", "sv01-099"),
        elapsed: "+00:11",
      },
    )
      .flatMap((entry) => (entry.kind === "turn" ? [] : entry.segments.map((s) => s.text)))
      .join("");
    const order = segments.filter((word) => source.includes(word));
    expect(order).toEqual(["reduced", "prevented"]);
    expect(source.indexOf("reduced")).toBeLessThan(source.indexOf("prevented"));
  });
});
