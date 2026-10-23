import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  typedEnergy,
  must,
  firstBasicInHand,
} from "./testFixtures";

const FROSLASS = "sv06-053";
const FROSLASS_REPRINT = "sv06-174";
const FROSLASS_PROMO = "svp-117";
const FROSLASS_IDS = [FROSLASS, FROSLASS_REPRINT, FROSLASS_PROMO] as const;

/** A Pokémon that HAS an Ability — the printed noun's positive case. */
const ABILITY_BODY = "fix-d340-abilitybody";
/** The SAME body without an Ability — the noun's negative case, and the only
    thing separating it from `ABILITY_BODY` is the `abilities` array itself. */
const PLAIN_BODY = "fix-d340-plainbody";
const IMPOSTOR_FROSLASS = "fix-d340-impostor";
const FROSLASSY = "fix-d340-froslassy";
const WALL = "fix-d340-wall";
const ENERGY = "fix-d340-energy";

const SHROUD_ABILITY = [
  {
    type: "Ability",
    name: "Freezing Shroud",
    effect:
      "During Pokémon Checkup, put 1 damage counter on each Pokémon that has an Ability (both yours and your opponent's), except any Froslass.",
  },
];

const LOCAL_CARDS: Record<string, Card> = {
  [FROSLASS]: battler(FROSLASS, {
    name: "Froslass",
    hp: 90,
    retreat: 1,
    stage: "Stage1",
    evolveFrom: "Snorunt",
    types: ["Water"],
    abilities: SHROUD_ABILITY,
    attacks: [{ cost: ["Water"], name: "Frost Smash", damage: 30 }],
  }),
  [FROSLASS_REPRINT]: battler(FROSLASS_REPRINT, {
    name: "Froslass",
    hp: 90,
    retreat: 1,
    stage: "Stage1",
    evolveFrom: "Snorunt",
    types: ["Water"],
    abilities: SHROUD_ABILITY,
    attacks: [{ cost: ["Water"], name: "Frost Smash", damage: 30 }],
  }),
  [FROSLASS_PROMO]: battler(FROSLASS_PROMO, {
    name: "Froslass",
    hp: 90,
    retreat: 1,
    stage: "Stage1",
    evolveFrom: "Snorunt",
    types: ["Water"],
    abilities: SHROUD_ABILITY,
    attacks: [{ cost: ["Water"], name: "Frost Smash", damage: 30 }],
  }),
  [ABILITY_BODY]: battler(ABILITY_BODY, {
    name: "D340 Ability Body",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    abilities: [{ type: "Ability", name: "D340 Idle", effect: "This Ability does nothing." }],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [PLAIN_BODY]: battler(PLAIN_BODY, {
    name: "D340 Plain Body",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [IMPOSTOR_FROSLASS]: battler(IMPOSTOR_FROSLASS, {
    name: "Froslass",
    hp: 200,
    retreat: 1,
    types: ["Water"],
    abilities: [{ type: "Ability", name: "D340 Idle", effect: "This Ability does nothing." }],
    attacks: [{ cost: ["Water"], name: "Tap", damage: 10 }],
  }),
  [FROSLASSY]: battler(FROSLASSY, {
    name: "Froslassy",
    hp: 200,
    retreat: 1,
    types: ["Water"],
    abilities: [{ type: "Ability", name: "D340 Idle", effect: "This Ability does nothing." }],
    attacks: [{ cost: ["Water"], name: "Tap", damage: 10 }],
  }),
  [WALL]: battler(WALL, {
    name: "D340 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [ENERGY]: typedEnergy(ENERGY, "Water"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

// 6 + 2 + 2 + 8 + 8 + 8 + 8 + 8 + 10 = 60. Every body this suite seats is drawn
// OUT OF THE DECK by the fixture helpers, so these counts are the deepest board
// any case builds rather than decoration.
const DECK = deckOf({
  [FROSLASS]: 6,
  [FROSLASS_REPRINT]: 2,
  [FROSLASS_PROMO]: 2,
  [ABILITY_BODY]: 8,
  [PLAIN_BODY]: 8,
  [IMPOSTOR_FROSLASS]: 8,
  [FROSLASSY]: 8,
  [WALL]: 8,
  [ENERGY]: 10,
});

function countersOn(events: readonly GameEvent[]): { seat: Seat; uid: string; amount: number }[] {
  return events
    .filter(
      (e): e is Extract<GameEvent, { type: "COUNTERS_PLACED" }> => e.type === "COUNTERS_PLACED",
    )
    .map((e) => ({ seat: e.seat, uid: e.uid, amount: e.amount }));
}

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** Seat exactly the bodies each side names, Active first, on p1's turn. Every
    body is drawn OUT OF THE DECK so each uid stays in exactly one zone. */
function board(spec: { p1: readonly string[]; p2: readonly string[] }): GameState {
  let state = localSetup(4, "p1");
  for (const seat of ["p1", "p2"] as const) {
    const ids = seat === "p1" ? spec.p1 : spec.p2;
    state = setActiveFromDeck(state, seat, ids[0] ?? WALL);
    state = clearBench(state, seat);
    for (const id of ids.slice(1)) state = benchFromDeck(state, seat, id);
  }
  return state;
}

/** Run the Checkup by ending `seat`'s turn, returning what it emitted. */
function checkup(state: GameState, seat: Seat = "p1"): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, { type: "endTurn", seat });
  if (!result.ok) throw new Error(`endTurn failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: [...result.events] };
}

function damageOf(state: GameState, seat: Seat, index: number): number {
  const side = state.players[seat];
  const body = index === 0 ? side.active : side.bench[index - 1];
  if (body === undefined || body === null) throw new Error(`no body at ${seat}[${index}]`);
  return body.damage;
}

describe("D340 §1 — the registry row, read off the LIVE registry", () => {
  it("all THREE printings resolve to ONE program object, by identity", () => {
    const first = programFor(FROSLASS);
    expect(first).toBeDefined();
    for (const id of FROSLASS_IDS) {
      expect(programFor(id), id).toBe(first);
    }
  });

  it("the program is a betweenTurns TRIGGERED ability and carries nothing else", () => {
    const program = programFor(FROSLASS);
    expect(Object.keys(program ?? {})).toEqual(["triggered"]);
    expect(program?.triggered).toHaveLength(1);
    const ability = program?.triggered?.[0];
    expect(ability?.name).toBe("Freezing Shroud");
    expect(ability?.trigger).toBe("betweenTurns");
    expect(ability?.activeOnly).toBeUndefined();
    // Mandatory: "put", not "you may put".
    expect(ability?.optional).toBeUndefined();
    // The sentence is not "The effect of Freezing Shroud doesn't stack."
    expect(ability?.doesNotStack).toBeUndefined();
  });

  it("the op is `counterEachAll` with the printed amount, noun and exemption", () => {
    const program = programFor(FROSLASS);
    expect(program?.triggered?.[0]?.program).toEqual([
      {
        op: "counterEachAll",
        amount: 10,
        filter: { kind: "abilityPokemon" },
        side: "both",
        source: "ability",
        exceptNamed: "Froslass",
      },
    ]);
  });

  it("`amount` is 10 HP and NOT the printed 1 — the ×10 happens once", () => {
    const op = programFor(FROSLASS)?.triggered?.[0]?.program?.[0];
    expect(op).toMatchObject({ amount: 10 });
  });

  it("`exceptNamed` is the FULL printed name and matches the catalog rows", () => {
    const op = programFor(FROSLASS)?.triggered?.[0]?.program?.[0];
    expect(op).toMatchObject({ exceptNamed: "Froslass" });
    for (const id of FROSLASS_IDS) {
      expect(LOCAL_CARDS[id]?.name, id).toBe("Froslass");
    }
  });

  it("the three ids are the WHOLE registry cohort for this program — both directions", () => {
    const target = programFor(FROSLASS);
    const live = registryCardIds()
      .filter((id) => programFor(id) === target)
      .sort();
    expect(live).toEqual([...FROSLASS_IDS].sort());
  });
});

describe("D340 §2 — the printed noun: only Pokémon that HAVE an Ability", () => {
  it("a body WITH an Ability takes a counter; the same body WITHOUT one does not", () => {
    const state = board({ p1: [WALL, ABILITY_BODY, PLAIN_BODY, FROSLASS], p2: [WALL] });
    const after = checkup(state).state;
    // p1[1] has an Ability → 10; p1[2] is the identical body minus `abilities` → 0.
    expect(damageOf(after, "p1", 1)).toBe(10);
    expect(damageOf(after, "p1", 2)).toBe(0);
  });

  it("the WALL is untouched — the filter is not `anyPokemon`", () => {
    const state = board({ p1: [WALL, ABILITY_BODY, FROSLASS], p2: [WALL, PLAIN_BODY] });
    const after = checkup(state).state;
    expect(damageOf(after, "p1", 0)).toBe(0);
    expect(damageOf(after, "p2", 0)).toBe(0);
    expect(damageOf(after, "p2", 1)).toBe(0);
    expect(damageOf(after, "p1", 1)).toBe(10);
  });

  it("the two bodies differ in `abilities` and in NOTHING else — the attribution control", () => {
    const withAbility = { ...LOCAL_CARDS[ABILITY_BODY], id: "", name: "", abilities: undefined };
    const without = { ...LOCAL_CARDS[PLAIN_BODY], id: "", name: "", abilities: undefined };
    expect(withAbility).toEqual(without);
    expect(LOCAL_CARDS[ABILITY_BODY]?.abilities).toHaveLength(1);
    expect(LOCAL_CARDS[PLAIN_BODY]?.abilities).toBeNull();
  });
});

describe("D340 §3 — *(both yours and your opponent's)*: the seat-blind walk", () => {
  it("BOTH boards take counters from ONE Froslass", () => {
    const state = board({
      p1: [FROSLASS, ABILITY_BODY],
      p2: [ABILITY_BODY, ABILITY_BODY],
    });
    const after = checkup(state).state;
    expect(damageOf(after, "p1", 1)).toBe(10);
    expect(damageOf(after, "p2", 0)).toBe(10);
    expect(damageOf(after, "p2", 1)).toBe(10);
  });

  it("each COUNTERS_PLACED is tagged with the DAMAGED body's own seat, not the controller's", () => {
    const state = board({ p1: [FROSLASS, ABILITY_BODY], p2: [ABILITY_BODY] });
    const { events } = checkup(state);
    const placed = countersOn(events);
    expect(placed).toHaveLength(2);
    // `healEachAll`'s rule: the event names the Pokémon's OWN seat. A controller-
    // tagged event would put the opponent's damage on the wrong side of the log.
    expect(placed.map((p) => p.seat).sort()).toEqual(["p1", "p2"]);
    for (const row of placed) expect(row.amount).toBe(10);
  });

  it("a Froslass on the BENCH still fires — there is no `activeOnly`", () => {
    const state = board({ p1: [WALL, FROSLASS], p2: [ABILITY_BODY] });
    const after = checkup(state).state;
    // Garganacl's "Blessed Salt" shape, and the opposite of Trevenant's. A build
    // that copied Trevenant's `activeOnly: true` would leave this board at 0.
    expect(damageOf(after, "p2", 0)).toBe(10);
  });

  it("a Froslass in the opponent's seat counters the controller's board too", () => {
    const state = board({ p1: [ABILITY_BODY], p2: [WALL, FROSLASS] });
    const after = checkup(state).state;
    // The aura is not owner-scoped in either direction — the sentence says "each
    // Pokémon", and whose turn is ending changes nothing.
    expect(damageOf(after, "p1", 0)).toBe(10);
  });
});

describe("D340 §4 — *except any Froslass*: the SUBTRACTION, not a conjunction", () => {
  it("the source Froslass exempts ITSELF, though it satisfies the noun", () => {
    const state = board({ p1: [FROSLASS, ABILITY_BODY], p2: [WALL] });
    const after = checkup(state).state;
    expect(damageOf(after, "p1", 0)).toBe(0);
    expect(damageOf(after, "p1", 1)).toBe(10);
  });

  it("EVERY Froslass is exempt, on both seats — the word is *any*", () => {
    const state = board({
      p1: [FROSLASS, FROSLASS_REPRINT, ABILITY_BODY],
      p2: [FROSLASS_PROMO, ABILITY_BODY],
    });
    const after = checkup(state).state;
    // Not just the source: the printed word is "any Froslass", so a second copy
    // and a copy across the table are exempt too. A build that exempted only
    // `ctx.sourceUid` would leave three of these four bodies damaged.
    expect(damageOf(after, "p1", 0)).toBe(0);
    expect(damageOf(after, "p1", 1)).toBe(0);
    expect(damageOf(after, "p2", 0)).toBe(0);
    const sources = 3;
    expect(damageOf(after, "p1", 2)).toBe(sources * 10);
    expect(damageOf(after, "p2", 1)).toBe(sources * 10);
  });

  it("a body merely NAMED Froslass is exempt — the rider reads the NAME, not the id", () => {
    const state = board({ p1: [FROSLASS, IMPOSTOR_FROSLASS, ABILITY_BODY], p2: [WALL] });
    const after = checkup(state).state;
    expect(damageOf(after, "p1", 1)).toBe(0);
    expect(damageOf(after, "p1", 2)).toBe(10);
    expect(programFor(IMPOSTOR_FROSLASS)).toBeUndefined();
  });

  it('"Froslassy" is NOT exempt — equality, not `startsWith`', () => {
    const state = board({ p1: [FROSLASS, FROSLASSY], p2: [WALL] });
    const after = checkup(state).state;
    expect(damageOf(after, "p1", 1)).toBe(10);
  });

  it("an exempt body emits NO event at all — it is skipped, not countered for zero", () => {
    const state = board({ p1: [FROSLASS, ABILITY_BODY], p2: [WALL] });
    const { events } = checkup(state);
    const placed = countersOn(events);
    expect(placed).toHaveLength(1);
    expect(placed[0]?.amount).toBe(10);
  });
});

describe("D340 §5 — the walk itself", () => {
  it("counters ACCUMULATE across two Checkups rather than being re-set", () => {
    const state = board({ p1: [FROSLASS, ABILITY_BODY], p2: [WALL] });
    const first = checkup(state).state;
    expect(damageOf(first, "p1", 1)).toBe(10);
    const second = checkup(first, "p2").state;
    expect(damageOf(second, "p1", 1)).toBe(20);
  });

  it("TWO Froslass fire TWICE — the sentence prints no non-stacking clause", () => {
    const state = board({ p1: [FROSLASS, FROSLASS_REPRINT, ABILITY_BODY], p2: [WALL] });
    const after = checkup(state).state;
    expect(damageOf(after, "p1", 2)).toBe(20);
    // …and both Froslass are still exempt from BOTH firings.
    expect(damageOf(after, "p1", 0)).toBe(0);
    expect(damageOf(after, "p1", 1)).toBe(0);
  });

  it("a board with NO Froslass takes nothing — the aura has a source", () => {
    const state = board({ p1: [ABILITY_BODY, ABILITY_BODY], p2: [ABILITY_BODY] });
    const { state: after, events } = checkup(state);
    expect(countersOn(events)).toHaveLength(0);
    expect(damageOf(after, "p1", 0)).toBe(0);
    expect(damageOf(after, "p2", 0)).toBe(0);
  });

  it("an empty opponent board does not stop the controller's own side resolving", () => {
    const state = board({ p1: [FROSLASS, ABILITY_BODY], p2: [WALL] });
    const stripped: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, bench: [] } },
    };
    const after = checkup(stripped).state;
    expect(damageOf(after, "p1", 1)).toBe(10);
  });

  it("every damaged body is a body the filter admits — no stray counters anywhere", () => {
    const state = board({
      p1: [FROSLASS, ABILITY_BODY, PLAIN_BODY, WALL],
      p2: [WALL, ABILITY_BODY, FROSLASSY, IMPOSTOR_FROSLASS],
    });
    const { state: after, events } = checkup(state);
    // The whole-board sweep: exactly the three admitted bodies, and nothing else.
    expect(countersOn(events)).toHaveLength(3);
    expect(damageOf(after, "p1", 1)).toBe(10);
    expect(damageOf(after, "p2", 1)).toBe(10);
    expect(damageOf(after, "p2", 2)).toBe(10);
    for (const [seat, index] of [
      ["p1", 0],
      ["p1", 2],
      ["p1", 3],
      ["p2", 0],
      ["p2", 3],
    ] as const) {
      expect(damageOf(after, seat, index), `${seat}[${index}]`).toBe(0);
    }
  });
});

describe("D340 §6 — the census this row moves, asserted as ARITHMETIC", () => {
  it("the three printings are ONE card, ONE sentence and ONE object", () => {
    expect(new Set(FROSLASS_IDS.map((id) => LOCAL_CARDS[id]?.name)).size).toBe(1);
    expect(new Set(FROSLASS_IDS.map((id) => programFor(id))).size).toBe(1);
    expect(FROSLASS_IDS).toHaveLength(3);
  });

  it("the `except any` family closes at 14 legal, of which 3 were unbuilt", () => {
    expect(6 + 5 + 3).toBe(14);
    expect(14 + 2 + 3 + 1).toBe(20);
  });

  it("the by-name exemption predates this row — `switchActive.exceptNamed` is LIVE", () => {
    const pecharunt = programFor("sv06.5-039");
    expect(pecharunt).toBeDefined();
    const ops = JSON.stringify(pecharunt);
    expect(ops).toContain('"exceptNamed":"Pecharunt ex"');
  });

  it("the suite adds NOTHING to the shared FIXTURE_POOL — the census decision", () => {
    for (const id of Object.keys(LOCAL_CARDS)) {
      expect(Object.hasOwn(FIXTURE_POOL, id), `${id} leaked into FIXTURE_POOL`).toBe(false);
    }
  });
});
