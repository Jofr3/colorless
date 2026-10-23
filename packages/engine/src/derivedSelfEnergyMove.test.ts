import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { deriveAttackCoinFlip, deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import { applyAction } from "./index";
import {
  FIXTURE_POOL,
  SELF_ENERGY_MOVE_DECK,
  activeUid,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const CLAUSES = [
  {
    text: "Move an Energy from this Pokémon to 1 of your Benched Pokémon.",
    program: [
      { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1, route: "selfToBench" },
    ] as EffectOp[],
    note: "Move an Energy from this Pokémon to 1 of your Benched Pokémon.",
    printings: 13,
    legalPrintings: 8,
  },
  {
    text: "Move 3 Energy from this Pokémon to 1 of your Benched Pokémon.",
    program: [
      { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 3, route: "selfToBench" },
    ] as EffectOp[],
    note: "Move up to 3 Energy from this Pokémon to 1 of your Benched Pokémon.",
    printings: 3,
    legalPrintings: 3,
  },
  {
    text: "Move a Basic Energy from this Pokémon to 1 of your Benched Pokémon.",
    program: [
      { op: "moveEnergy", filter: { kind: "basicEnergy" }, max: 1, route: "selfToBench" },
    ] as EffectOp[],
    note: "Move a Basic Energy from this Pokémon to 1 of your Benched Pokémon.",
    printings: 2,
    legalPrintings: 2,
  },
] as const;

const ANY = 0;
const THREE = 1;
const BASIC = 2;

const COLLECTED_AT_D441 = [
  ["Move all Energy from this Pokémon to 1 of your Benched Pokémon.", 2],
] as const;

const COLLECTED_AT_D442 = [
  ["Move all Energy from this Pokémon to your Benched Pokémon in any way you like.", 1],
] as const;

const TYPED_NEAR_MISS = "Move 2 {D} Energy from this Pokémon to 1 of your Benched Pokémon.";

const VOLT_CYCLONE = 14;
const JET_CYCLONE = 15;
const HURRICANE = 16;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: SELF_ENERGY_MOVE_DECK, p2: SELF_ENERGY_MOVE_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function ready(
  seed: number,
  {
    basics = 1,
    specials = 0,
    ownBench = 2,
  }: { basics?: number; specials?: number; ownBench?: number },
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  if (basics > 0) state = attachFromDeck(state, "p1", "fix-energy", basics);
  if (specials > 0) state = attachFromDeck(state, "p1", "fix-special", specials);
  state = clearBench(state, "p1");
  for (let i = 0; i < ownBench; i++) state = benchFromDeck(state, "p1", "fix-basic-1");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The parked `moveEnergy` prompt an attack produced, narrowed. */
function parkedMove(state: GameState): {
  movable: readonly { uid: string; from: PokemonRef }[];
  destinations: readonly PokemonRef[];
  max: number;
  note?: string;
} {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "moveEnergy") throw new Error(`expected moveEnergy, got ${prompt.kind}`);
  return prompt;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHORS
// ─────────────────────────────────────────────────────────────────────────────

describe("the two anchors — three printed sentences, one new route value", () => {
  it("derives each printed sentence to its program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up: 13 of the family's 16 legal printings, across 3 sentences", () => {
    expect(CLAUSES).toHaveLength(3);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(13);
    expect(CLAUSES[ANY].legalPrintings).toBe(8);
    expect(CLAUSES[THREE].legalPrintings).toBe(3);
    expect(CLAUSES[BASIC].legalPrintings).toBe(2);
    expect(COLLECTED_AT_D441.reduce((sum, [, legal]) => sum + legal, 0)).toBe(2);
    expect(COLLECTED_AT_D442.reduce((sum, [, legal]) => sum + legal, 0)).toBe(1);
    for (const [text] of COLLECTED_AT_D441) {
      expect(deriveAttackEffect(text), text).toEqual([
        { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: "all", route: "selfToBench" },
      ]);
    }
    for (const [text] of COLLECTED_AT_D442) {
      expect(deriveAttackEffect(text), text).toEqual([
        {
          op: "moveEnergy",
          filter: { kind: "anyEnergy" },
          max: "all",
          route: "selfToBench",
          anyDest: true,
        },
      ]);
    }
    expect(
      CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0) +
        COLLECTED_AT_D441.reduce((sum, [, legal]) => sum + legal, 0) +
        COLLECTED_AT_D442.reduce((sum, [, legal]) => sum + legal, 0),
    ).toBe(16);
  });

  it("REFUSES the TYPED sibling — the family's one real near miss", () => {
    expect(deriveAttackEffect(TYPED_NEAR_MISS)).toBeNull();
    // …and the shape that WOULD have swallowed it is named, so a future widening
    // has to walk past this line: the noun is bare, and the number is a `\d+`
    // directly in front of it.
    expect(TYPED_NEAR_MISS).toContain("{D} Energy from this Pokémon");
    expect(
      deriveAttackEffect("Move 2 Energy from this Pokémon to 1 of your Benched Pokémon."),
    ).toEqual([{ op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 2, route: "selfToBench" }]);
  });

  it("the numeric and article forms are ONE anchor, and the missing group IS max 1", () => {
    const [one] = deriveAttackEffect(CLAUSES[ANY].text) ?? [];
    const [three] = deriveAttackEffect(CLAUSES[THREE].text) ?? [];
    expect(one).toEqual({ ...three, max: 1 });
    expect(three).toEqual({ ...one, max: 3 });
    // …and a number the catalog does not print today rides the same arm, which is
    // the whole reason the count is captured rather than alternated over 1 and 3.
    expect(
      deriveAttackEffect("Move 12 Energy from this Pokémon to 1 of your Benched Pokémon."),
    ).toEqual([{ op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 12, route: "selfToBench" }]);
  });

  it("the BASIC arm differs by its filter and by nothing else", () => {
    const [any] = deriveAttackEffect(CLAUSES[ANY].text) ?? [];
    const [basic] = deriveAttackEffect(CLAUSES[BASIC].text) ?? [];
    expect(basic).toEqual({ ...any, filter: { kind: "basicEnergy" } });
    // …which is the one word that differs in print, too.
    expect(CLAUSES[BASIC].text).toBe(CLAUSES[ANY].text.replace("an Energy", "a Basic Energy"));
  });

  it("carries NO new op and NO new op field — one `route` value is the whole cost", () => {
    for (const { program } of CLAUSES) {
      expect(program.map((o) => o.op)).toEqual(["moveEnergy"]);
      const [op] = program;
      expect(op?.op === "moveEnergy" ? op.route : undefined).toBe("selfToBench");
      expect(op?.op === "moveEnergy" ? Object.keys(op).sort() : []).toEqual([
        "filter",
        "max",
        "op",
        "route",
      ]);
    }
  });

  it("refuses the anchor, punctuation and case rewrites", () => {
    const bare = CLAUSES[ANY].text;
    const rewrites = [
      // A leading clause — the shape a `$`-only build eats.
      `Draw a card. ${bare}`,
      `${bare} Your opponent draws a card.`,
      // Case, both ends.
      bare.replace("Move", "move"),
      bare.replace("Benched", "benched"),
      // The trailing period.
      bare.slice(0, -1),
      // The DIRECTION reversed, which is the whole content of the route and is
      // also a real printed shape (Armarouge's Ability, `benchToActive`).
      "Move an Energy from 1 of your Benched Pokémon to this Pokémon.",
      // The FREE route's printed sentence — Energy Switch, a Trainer, whose
      // program is authored in the registry and must not be derived off text.
      "Move a Basic Energy from 1 of your Pokémon to another of your Pokémon.",
      // The opponent's board, which no member of this family reaches.
      "Move an Energy from this Pokémon to 1 of your opponent's Benched Pokémon.",
      // A COUNTER move, one noun away and a different op entirely.
      "Move all damage counters from this Pokémon to 1 of your Benched Pokémon.",
    ];
    for (const text of rewrites) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("hands no clause to the coin reader, and carries no apostrophe to curl", () => {
    for (const { text } of CLAUSES) expect(deriveAttackCoinFlip(text), text).toBeNull();
    for (const { text } of CLAUSES) {
      expect(text.includes("'"), text).toBe(false);
      expect(text.includes("’"), text).toBe(false);
    }
  });
});

describe("PROVENANCE — the demonstrator carries all three sentences at 14-16", () => {
  it("fields the family at indices 14-16, appended and not inserted", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    expect(attacks).toHaveLength(73);
    expect(attacks[VOLT_CYCLONE]?.effect).toBe(CLAUSES[ANY].text);
    expect(attacks[JET_CYCLONE]?.effect).toBe(CLAUSES[THREE].text);
    expect(attacks[HURRICANE]?.effect).toBe(CLAUSES[BASIC].text);
    // The indices the sibling suites address by constant did not move.
    expect(attacks[2]?.effect).toBe(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    );
    expect(attacks[13]?.effect).toBe(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 30 damage to the new Active Pokémon.",
    );
  });

  it("NO printed base damage on any of the three — stated, because it is a CHOICE", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    for (const index of [VOLT_CYCLONE, JET_CYCLONE, HURRICANE]) {
      expect(attacks[index]?.damage, `index ${index}`).toBeUndefined();
    }
    // …and the neighbouring index that DOES print a number still does, so this is
    // an assertion about these three rows and not about the fixture at large.
    expect(attacks[3]?.damage).toBe(60);
  });
});

describe("end to end — off the ATTACKER, onto the attacker's OWN Bench", () => {
  it("parks offering the ATTACKER's Energy and the controller's own Bench", () => {
    const state = ready(11, { basics: 2, ownBench: 2 });
    const attacker = activeUid(state, "p1");
    deepFreeze(state);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: VOLT_CYCLONE });

    const prompt = parkedMove(parked);
    expect(parked.phase.kind === "effect:choose" ? parked.phase.seat : undefined).toBe("p1");
    expect(prompt.movable).toHaveLength(2);
    for (const m of prompt.movable) {
      expect(m.from).toEqual({ seat: "p1", spot: { spot: "active" } });
    }
    expect(prompt.movable.map((m) => m.uid).sort()).toEqual(
      [...(parked.players.p1.active?.energy ?? [])].sort(),
    );
    expect(prompt.destinations).toHaveLength(2);
    for (const d of prompt.destinations) {
      expect(d.seat).toBe("p1");
      expect(d.spot.spot).toBe("bench");
    }
    expect(prompt.max).toBe(1);
    expect(prompt.note).toBe(CLAUSES[ANY].note);
    // Nothing has moved yet, and the attacker is still where it was.
    expect(activeUid(parked, "p1")).toBe(attacker);
    expect(parked.players.p1.active?.energy).toHaveLength(2);
  });

  it("the MIRROR route on the SAME board offers the two sets INVERTED", () => {
    const state = ready(11, { basics: 2, ownBench: 2 });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: VOLT_CYCLONE });
    const mine = parkedMove(parked);

    const mirror: EffectOp[] = [
      { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1, route: "benchToActive" },
    ];
    expect(programPlayable(state, mirror, "p1")).toBe(false);
    expect(programPlayable(state, CLAUSES[ANY].program, "p1")).toBe(true);
    // …and with the Energy on a BENCHED body instead, the verdicts swap. Neither
    // route can be quietly substituted for the other on any board.
    const flipped = attachBenchFromDeck(
      {
        ...state,
        players: {
          ...state.players,
          p1: {
            ...state.players.p1,
            active:
              state.players.p1.active === null ? null : { ...state.players.p1.active, energy: [] },
          },
        },
      },
      "p1",
      0,
      "fix-energy",
      1,
    );
    expect(programPlayable(flipped, mirror, "p1")).toBe(true);
    expect(programPlayable(flipped, CLAUSES[ANY].program, "p1")).toBe(false);
    // The destination sets are disjoint too, which is the other half of "mirror".
    expect(mine.destinations.some((d) => d.spot.spot === "active")).toBe(false);
  });

  it("an Energy on a BENCHED body is NOT movable — the source is the attacker", () => {
    let state = ready(12, { basics: 1, ownBench: 2 });
    state = attachBenchFromDeck(state, "p1", 0, "fix-energy", 2);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: VOLT_CYCLONE });
    const prompt = parkedMove(parked);
    const benchEnergy = new Set(parked.players.p1.bench[0]?.energy ?? []);
    expect(benchEnergy.size).toBe(2);
    expect(prompt.movable).toHaveLength(1);
    expect(benchEnergy.has(prompt.movable[0]?.uid ?? "")).toBe(false);
  });

  it("the answer MOVES it: off the Active, onto the chosen benched body", () => {
    const state = ready(13, { basics: 2, ownBench: 2 });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: VOLT_CYCLONE });
    const prompt = parkedMove(parked);
    const moved = prompt.movable[0]?.uid as string;
    const dest = prompt.destinations[1] as PokemonRef;

    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: moved, dest }] },
    });
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p1.active?.energy).not.toContain(moved);
    expect(done.state.players.p1.bench[1]?.energy).toContain(moved);
    expect(done.state.players.p1.bench[0]?.energy).not.toContain(moved);
    // The event names both ends, and the seat is the ATTACKER's on both.
    const rows = all(done.events, "ENERGY_MOVED");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      seat: "p1",
      uids: [moved],
      from: { spot: "active" },
      to: { spot: "bench", index: 1 },
    });
    expect(done.state.players.p2.active).toEqual(parked.players.p2.active);
    expect(done.state.players.p2.bench).toEqual(parked.players.p2.bench);
    expect(done.state.players.p2.discard).toEqual(parked.players.p2.discard);
  });

  it("DECLINES: an empty pick is a legal answer and moves nothing", () => {
    // The family's standing "up to" semantics, inherited rather than invented —
    // and the reason the prompt for "Move 3 Energy" reads "up to 3".
    const state = ready(14, { basics: 2, ownBench: 2 });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: VOLT_CYCLONE });
    expect(parkedMove(parked).movable.length).toBeGreaterThan(0);
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [] },
    });
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(all(done.events, "ENERGY_MOVED")).toHaveLength(0);
    expect(done.state.players.p1.active?.energy).toHaveLength(2);
  });

  it("A LONE benched body is still a park — ONE destination is enough on this route", () => {
    const state = ready(17, { basics: 1, ownBench: 1 });
    expect(state.players.p1.bench).toHaveLength(1);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: VOLT_CYCLONE });
    const prompt = parkedMove(parked);
    expect(prompt.destinations).toHaveLength(1);
    expect(prompt.destinations[0]).toEqual({ seat: "p1", spot: { spot: "bench", index: 0 } });
    // …and it is answerable, not merely offered.
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: [
          { uid: prompt.movable[0]?.uid as string, dest: prompt.destinations[0] as PokemonRef },
        ],
      },
    });
    expect(done.state.players.p1.bench[0]?.energy).toHaveLength(1);
  });

  it("AN EMPTY OWN BENCH is a whiff, not a refusal — §8 declares against the COST", () => {
    const state = ready(15, { basics: 2, ownBench: 0 });
    expect(state.players.p1.bench).toHaveLength(0);
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: VOLT_CYCLONE,
    });
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ENERGY_MOVED")).toHaveLength(0);
    expect(after.players.p1.active?.energy).toHaveLength(2);
    // …and the turn moved on, which is what "the attack was used" means.
    expect(after.phase.kind).toBe("turn:action");
  });

  it("NO ENERGY on the attacker is UNREACHABLE through an attack, and says so", () => {
    const state = ready(16, { basics: 0, ownBench: 2 });
    expect(state.players.p1.active?.energy ?? []).toHaveLength(0);
    const refused = applyAction(state, { type: "attack", seat: "p1", index: VOLT_CYCLONE });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false ? refused.error.code : undefined).toBe("ATTACK_COST_UNMET");
    // The op's own no-op ending is therefore only observable through the gate,
    // which reads the identical `moveEndpoints` — see the last describe below.
    expect(programPlayable(state, CLAUSES[ANY].program, "p1")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE OTHER TWO ARMS — the count, and the filter
// ─────────────────────────────────────────────────────────────────────────────

describe("the numeric arm — `max` is the printed count, and it is a CEILING", () => {
  it("offers up to 3 and moves all three onto one body", () => {
    const state = ready(21, { basics: 4, ownBench: 2 });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: JET_CYCLONE });
    const prompt = parkedMove(parked);
    expect(prompt.max).toBe(3);
    expect(prompt.note).toBe(CLAUSES[THREE].note);
    expect(prompt.movable).toHaveLength(4);
    const picks = prompt.movable.slice(0, 3).map((m) => m.uid);
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: picks.map((uid) => ({ uid, dest: prompt.destinations[0] as PokemonRef })),
      },
    });
    expect(done.state.players.p1.active?.energy).toHaveLength(1);
    expect(done.state.players.p1.bench[0]?.energy).toEqual(picks);
    // ONE event, not three: every pick shares the one source, which is what the
    // single-source coupling buys and what `ENERGY_MOVED`'s doc promises.
    expect(all(done.events, "ENERGY_MOVED")).toHaveLength(1);
  });

  it("refuses a FOURTH pick, and the one-Energy arm refuses a second", () => {
    const state = ready(22, { basics: 4, ownBench: 2 });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: JET_CYCLONE });
    const prompt = parkedMove(parked);
    const tooMany = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: prompt.movable
          .map((m) => m.uid)
          .map((uid) => ({ uid, dest: prompt.destinations[0] as PokemonRef })),
      },
    });
    expect(tooMany.ok).toBe(false);
    expect(tooMany.ok === false ? tooMany.error.code : undefined).toBe("BAD_EFFECT_CHOICE");

    // …and the article arm's ceiling is 1, which is the alternation's other half
    // observed on a board rather than on a derived object.
    const { state: single } = mustApply(ready(22, { basics: 4, ownBench: 2 }), {
      type: "attack",
      seat: "p1",
      index: VOLT_CYCLONE,
    });
    const singlePrompt = parkedMove(single);
    expect(singlePrompt.max).toBe(1);
    const pair = applyAction(single, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: singlePrompt.movable
          .slice(0, 2)
          .map((m) => m.uid)
          .map((uid) => ({ uid, dest: singlePrompt.destinations[0] as PokemonRef })),
      },
    });
    expect(pair.ok).toBe(false);
  });

  it("moving onto the Active is refused — the destination set says so first", () => {
    const state = ready(23, { basics: 2, ownBench: 2 });
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: VOLT_CYCLONE });
    const prompt = parkedMove(parked);
    const onto = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: [
          { uid: prompt.movable[0]?.uid as string, dest: { seat: "p1", spot: { spot: "active" } } },
        ],
      },
    });
    expect(onto.ok).toBe(false);
    // The message is the DESTINATION one, not the self-move one — because on this
    // route the Active was never offered, where on the free route it is offered
    // and then rejected per pick. Two different refusals for the same board.
    expect(onto.ok === false ? onto.error.message : undefined).toContain("legal destination");
    // …and so is the opponent's Bench, which is the seat control on the wire.
    const across = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: [
          {
            uid: prompt.movable[0]?.uid as string,
            dest: { seat: "p2", spot: { spot: "bench", index: 0 } },
          },
        ],
      },
    });
    expect(across.ok).toBe(false);
  });
});

describe("the BASIC arm — the filter, on a board that can tell the difference", () => {
  it("offers only the Basic Energy, where the ANY arm offers both", () => {
    const state = ready(31, { basics: 1, specials: 1, ownBench: 2 });
    expect(state.players.p1.active?.energy).toHaveLength(2);

    const { state: filtered } = mustApply(state, { type: "attack", seat: "p1", index: HURRICANE });
    const basicPrompt = parkedMove(filtered);
    expect(basicPrompt.note).toBe(CLAUSES[BASIC].note);
    expect(basicPrompt.movable).toHaveLength(1);
    const basicUid = basicPrompt.movable[0]?.uid as string;
    expect(filtered.cardIdByUid[basicUid]).toBe("fix-energy");

    const { state: unfiltered } = mustApply(ready(31, { basics: 1, specials: 1, ownBench: 2 }), {
      type: "attack",
      seat: "p1",
      index: VOLT_CYCLONE,
    });
    const anyPrompt = parkedMove(unfiltered);
    expect(anyPrompt.movable).toHaveLength(2);
    expect(anyPrompt.movable.map((m) => unfiltered.cardIdByUid[m.uid]).sort()).toEqual([
      "fix-energy",
      "fix-special",
    ]);
  });

  it("a Special-only attacker makes the BASIC arm a whiff and the ANY arm a park", () => {
    // The same discrimination from the other side, and the sharper one: the arm
    // does not merely offer less, it offers NOTHING, so the attack resolves having
    // moved no Energy while its unfiltered sibling parks on the identical board.
    const state = ready(32, { basics: 0, specials: 2, ownBench: 2 });
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: HURRICANE,
    });
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ENERGY_MOVED")).toHaveLength(0);

    const { state: parked } = mustApply(ready(32, { basics: 0, specials: 2, ownBench: 2 }), {
      type: "attack",
      seat: "p1",
      index: VOLT_CYCLONE,
    });
    expect(parkedMove(parked).movable).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE GATE — which this family does NOT reach, said out loud
// ─────────────────────────────────────────────────────────────────────────────

describe("programPlayable — the gate and the op read the SAME endpoints", () => {
  it("agrees with the park on every board: no source, no destination, or both", () => {
    const both = ready(41, { basics: 1, ownBench: 2 });
    const noBench = ready(42, { basics: 1, ownBench: 0 });
    const noEnergy = ready(43, { basics: 0, ownBench: 2 });
    expect(programPlayable(both, CLAUSES[ANY].program, "p1")).toBe(true);
    expect(programPlayable(noBench, CLAUSES[ANY].program, "p1")).toBe(false);
    expect(programPlayable(noEnergy, CLAUSES[ANY].program, "p1")).toBe(false);
    // …and the filtered arm refuses a board the unfiltered one accepts.
    const specialOnly = ready(44, { basics: 0, specials: 1, ownBench: 2 });
    expect(programPlayable(specialOnly, CLAUSES[ANY].program, "p1")).toBe(true);
    expect(programPlayable(specialOnly, CLAUSES[BASIC].program, "p1")).toBe(false);
  });

  it("NO NEW `programPlayable` ARM WAS OWED, and that is a MEASURED result ( D587: true of Samurott; Repel `me01-126` then owed the top-level arm)", () => {
    const samurott: EffectOp[] = [
      { op: "switchActive", recordAs: "moved" },
      { op: "recordGate", slot: "moved", then: [{ op: "opponentSwitchOut" }] },
    ];
    // An empty own Bench: the antecedent cannot happen, so the Ability is refused
    // — by `switchActive`'s existing arm, with no `opponentSwitchOut` arm involved.
    const noBench = ready(45, { basics: 1, ownBench: 0 });
    expect(programPlayable(noBench, samurott, "p1")).toBe(false);
    // An own Bench and an EMPTY opponent Bench: the card does the first half of
    // what it prints, so it stays playable — which is exactly what a speculative
    // `opponentSwitchOut` arm would have broken.
    let state = ready(46, { basics: 1, ownBench: 2 });
    state = clearBench(state, "p2");
    expect(state.players.p2.bench).toHaveLength(0);
    expect(programPlayable(state, samurott, "p1")).toBe(true);
    expect(programPlayable(state, [{ op: "opponentSwitchOut" }], "p1")).toBe(false);
  });
});
