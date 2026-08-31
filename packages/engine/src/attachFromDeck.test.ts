import { describe, expect, it } from "vitest";
import type { EffectOp } from "./effects";
import { STATUS_WORD_OF } from "./effects";
import { applyAction } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import type { EffectPrompt, PokemonRef } from "./interpreter";
import { resumeProgram, runProgram } from "./interpreter";
import { programFor } from "./registry";
import {
  ATTACH_FROM_DECK_DECK,
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

// M5 op-slice: `attachFromDeck` — SEARCH your deck for Energy and attach it
// straight onto your own Pokémon. The deck-search sibling of `attachFromTop`
// (which reaches only a window on the deck's top), sharing its `attachCards` MAP
// prompt because the printed clause is the same one: several cards, several
// places, chosen together.
//
//   • CHARIZARD EX (sv03-125/-215/-223/-228) — "Infernal Reign": "When you play
//     this Pokémon from your hand to evolve 1 of your Pokémon during your turn,
//     you may search your deck for up to 3 Basic {R} Energy cards and attach them
//     to your Pokémon IN ANY WAY YOU LIKE. Then, shuffle your deck." The plain
//     arm: no target rider, no per-target cap, all three may land on one Pokémon.
//   • JANINE'S SECRET ART (sv06.5-059/-088, Supporter) — "Choose up to 2 of your
//     {D} Pokémon. FOR EACH OF THOSE POKÉMON, search your deck for a Basic {D}
//     Energy card and attach it to THAT Pokémon. Then, shuffle your deck. If you
//     attached Energy to your Active Pokémon IN THIS WAY, it is now Poisoned."
//     Three riders at once: `targetType` ({D} bodies only), `maxPerTarget: 1`
//     (one apiece, never both on one), and a §9.2 `recordGate` whose `contains`
//     narrowing asks not "did you attach anything" but "did anything land on your
//     ACTIVE".
//
// The two headline claims this file exists to pin:
//   1. the OFFER COLLAPSES interchangeable candidates (a real deck holds a dozen
//      Basic {D}, and a Basic keys on what it PROVIDES, not on its catalog id);
//   2. `contains: "yourActive"` is a NARROWING — attaching two Energy to the
//      Bench records two uids and still does not poison anything.

const SEED = 20260722;

const JANINE = "sv06.5-059";
const CHARIZARD = "sv03-125";
const DARK_ENERGY = "fix-dark-energy";
const DARK_ENERGY_ALT = "fix-dark-energy-alt";
const FIRE_ENERGY = "fix-fire-energy";
const DARK_BODY = "fix-dark-1";
const PLAIN_BODY = "fix-basic-1";
const STAGE1 = "fix-stage1";

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Every uid the seat holds anywhere, sorted. This op moves cards out of a
    HIDDEN zone onto the public board, which is where a duplicated or a vanished
    card would hide. */
function census(state: GameState, seat: Seat): string[] {
  const side = state.players[seat];
  const inPlay = [side.active, ...side.bench].flatMap((p) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
  );
  return [...side.deck, ...side.hand, ...side.discard, ...side.prizes, ...inPlay].sort();
}

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, and the only one on which a Supporter is legal (§4). */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: ATTACH_FROM_DECK_DECK, p2: ATTACH_FROM_DECK_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1's SECOND turn. §4 bans evolving on a player's first turn, so Charizard's
    onEvolve trigger is unreachable off `board()` alone. */
function laterBoard(seed = SEED): GameState {
  const state = mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1's board rebuilt from nothing: `activeId` in the Active spot, `benchIds`
    benched, everything setup dealt returned to the deck.
 *
 *  Every board in this file goes through here, because this whole slice is about
 *  WHICH Pokémon are eligible to receive an attach — and setup places whatever
 *  Basic it happens to deal, which in this pool is sometimes a {D} body. A
 *  suite that kept the dealt Active would ask a different question per seed, and
 *  the two riders under test (`targetType`, and the bare "your Pokémon") would
 *  both look right for the wrong reason. Legal-shaped: every uid stays in
 *  exactly one zone. */
function withBoard(state: GameState, activeId: string, benchIds: readonly string[]): GameState {
  const side = state.players.p1;
  const returned = [side.active, ...side.bench].flatMap((p) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
  );
  let next: GameState = {
    ...state,
    players: {
      ...state.players,
      p1: { ...side, active: null, bench: [], deck: [...side.deck, ...returned] },
    },
  };
  next = setActiveFromDeck(next, "p1", activeId);
  for (const id of benchIds) next = benchFromDeck(next, "p1", id);
  return next;
}

/** P1 with a single Colorless Active — the "no {D} Pokémon anywhere" board. */
function noDarkBoard(seed = SEED): GameState {
  return withBoard(board(seed), PLAIN_BODY, []);
}

/** Strip every copy of `cardId` out of p1's deck (to the discard, which no op
    here reads) — the "nothing to find" boards. */
function withoutInDeck(state: GameState, cardId: string): GameState {
  const side = state.players.p1;
  const gone = side.deck.filter((uid) => state.cardIdByUid[uid] === cardId);
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        deck: side.deck.filter((uid) => !gone.includes(uid)),
        discard: [...side.discard, ...gone],
      },
    },
  };
}

function promptOf(state: GameState): Extract<EffectPrompt, { kind: "attachCards" }> {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "attachCards") throw new Error("expected an attachCards prompt");
  return state.phase.prompt;
}

const ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const bench = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

function attach(state: GameState, assignments: { uid: string; to: PokemonRef }[]) {
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "attachCards", assignments },
  });
}

/** p1 with a {D} Active and `benched` more {D} bodies — Janine's board. */
function janineBoard(seed = SEED, benched = 1): GameState {
  const state = withBoard(board(seed), DARK_BODY, Array<string>(benched).fill(DARK_BODY));
  return handFromDeck(state, "p1", JANINE, 1);
}

function playJanine(state: GameState) {
  return mustApply(state, { type: "playTrainer", seat: "p1", uid: handUid(state, "p1", JANINE) });
}

const energyOn = (state: GameState, ref: PokemonRef): string[] => {
  const side = state.players[ref.seat];
  const pokemon = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  if (pokemon === undefined || pokemon === null) throw new Error("no Pokémon there");
  return pokemon.energy;
};

const poisoned = (state: GameState, seat: Seat): boolean => {
  const active = state.players[seat].active;
  return active !== null && active.conditions.poisonDamage > 0;
};

describe("Janine's Secret Art — the offer", () => {
  it("collapses interchangeable Basic {D} down to the printed max, ACROSS catalog prints", () => {
    const state = playJanine(janineBoard()).state;
    const prompt = promptOf(state);
    // The deck holds 12 Basic {D} across TWO prints; the pick can never want
    // more than 2, so exactly 2 rows are offered.
    expect(prompt.candidates).toHaveLength(2);
    expect(prompt.max).toBe(2);
    // Both survivors come from the FIRST print encountered in deck order — a
    // collapse keyed on the catalog id would have kept up to 2 of EACH print,
    // and this is the assertion that separates the two keys.
    const ids = prompt.candidates.map((uid) => state.cardIdByUid[uid]);
    expect(new Set(ids).size).toBe(1);
    expect([DARK_ENERGY, DARK_ENERGY_ALT]).toContain(ids[0]);
  });

  it("offers only {D} Pokémon as targets — the printed targetType", () => {
    // A {D} Active, a {D} bench slot, and a Colorless one the rider excludes.
    let state = withBoard(board(SEED), DARK_BODY, [DARK_BODY, PLAIN_BODY]);
    state = handFromDeck(state, "p1", JANINE, 1);
    const prompt = promptOf(playJanine(state).state);
    expect(prompt.targets).toEqual([ACTIVE, bench(0)]);
  });

  it("carries maxPerTarget: 1 and a note stating BOTH the attach and the poison", () => {
    const prompt = promptOf(playJanine(janineBoard()).state);
    expect(prompt.maxPerTarget).toBe(1);
    expect(prompt.note).toBe(
      "Search your deck for up to 2 Basic Darkness Energy cards and attach 1 to each of up to 2 of your Darkness Pokémon. If you attach one to your Active Pokémon, it is now Poisoned.",
    );
  });

  it("clamps max to the candidates actually there", () => {
    // One Basic {D} left in the whole deck: "up to 2" is a pick of one, and a
    // prompt saying 2 over a single row would invite a pick that does not exist.
    let state = withoutInDeck(janineBoard(), DARK_ENERGY_ALT);
    const side = state.players.p1;
    const darks = side.deck.filter((uid) => state.cardIdByUid[uid] === DARK_ENERGY);
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...side,
          deck: side.deck.filter((uid) => !darks.slice(1).includes(uid)),
          discard: [...side.discard, ...darks.slice(1)],
        },
      },
    };
    const prompt = promptOf(playJanine(state).state);
    expect(prompt.candidates).toHaveLength(1);
    expect(prompt.max).toBe(1);
  });
});

describe("Janine's Secret Art — the §9.2 poison clause", () => {
  it("poisons your own Active when an Energy lands there", () => {
    const played = playJanine(janineBoard());
    const prompt = promptOf(played.state);
    const done = attach(played.state, [{ uid: prompt.candidates[0] as string, to: ACTIVE }]);
    expect(poisoned(done.state, "p1")).toBe(true);
    const status = find(done.events, "STATUS_APPLIED");
    expect(status?.status).toBe("poisoned");
    expect(status?.seat).toBe("p1");
    expect(done.state.phase.kind).toBe("turn:action");
  });

  it("does NOT poison when both Energy go to the BENCH — the contains narrowing", () => {
    // The record is NOT empty here: two uids were filed. A gate testing only
    // "did anything move" would poison the Active for an attach it never got.
    const played = playJanine(janineBoard(SEED, 2));
    const prompt = promptOf(played.state);
    const done = attach(played.state, [
      { uid: prompt.candidates[0] as string, to: bench(0) },
      { uid: prompt.candidates[1] as string, to: bench(1) },
    ]);
    expect(energyOn(done.state, bench(0))).toHaveLength(1);
    expect(energyOn(done.state, bench(1))).toHaveLength(1);
    expect(poisoned(done.state, "p1")).toBe(false);
    expect(find(done.events, "STATUS_APPLIED")).toBeUndefined();
  });

  it("does not poison on a DECLINE, and still shuffles the deck", () => {
    const played = playJanine(janineBoard());
    const done = attach(played.state, []);
    expect(poisoned(done.state, "p1")).toBe(false);
    expect(energyOn(done.state, ACTIVE)).toHaveLength(0);
    // The printed "Then, shuffle your deck" is a trailing op and runs anyway.
    expect(types(done.events)).toContain("SHUFFLE");
  });

  it("poisons when the Active is among several, not only when it is alone", () => {
    const played = playJanine(janineBoard(SEED, 2));
    const prompt = promptOf(played.state);
    const done = attach(played.state, [
      { uid: prompt.candidates[0] as string, to: bench(0) },
      { uid: prompt.candidates[1] as string, to: ACTIVE },
    ]);
    expect(poisoned(done.state, "p1")).toBe(true);
  });
});

describe("Janine's Secret Art — the printed one-apiece rule", () => {
  it("rejects both Energy on ONE Pokémon", () => {
    const played = playJanine(janineBoard());
    const prompt = promptOf(played.state);
    expectErr(
      played.state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "attachCards",
          assignments: [
            { uid: prompt.candidates[0] as string, to: ACTIVE },
            { uid: prompt.candidates[1] as string, to: ACTIVE },
          ],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("allows one apiece on two distinct Pokémon", () => {
    const played = playJanine(janineBoard(SEED, 2));
    const prompt = promptOf(played.state);
    const done = attach(played.state, [
      { uid: prompt.candidates[0] as string, to: ACTIVE },
      { uid: prompt.candidates[1] as string, to: bench(0) },
    ]);
    expect(energyOn(done.state, ACTIVE)).toHaveLength(1);
    expect(energyOn(done.state, bench(0))).toHaveLength(1);
  });
});

describe("Charizard ex — Infernal Reign, the 'in any way you like' arm", () => {
  /** A board with fix-stage1 Active (what Charizard ex evolves from in this
      pool), placed a turn ago so the §10 timing allows evolving. */
  function charizardBoard(benched = 0): GameState {
    const state = withBoard(laterBoard(SEED), STAGE1, Array<string>(benched).fill(PLAIN_BODY));
    return handFromDeck(state, "p1", CHARIZARD, 1);
  }

  function evolveIntoCharizard(state: GameState) {
    return mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", CHARIZARD),
      target: { spot: "active" },
    });
  }

  it("fires on evolve and parks on up to 3 Basic {R} with NO per-target cap", () => {
    const evolved = evolveIntoCharizard(charizardBoard());
    expect(types(evolved.events)).toContain("ABILITY_TRIGGERED");
    const prompt = promptOf(evolved.state);
    expect(prompt.max).toBe(3);
    expect(prompt.maxPerTarget).toBeUndefined();
    expect(prompt.candidates).toHaveLength(3);
    expect(prompt.note).toBe(
      "Search your deck for up to 3 Basic Fire Energy cards and attach them to your Pokémon in any way you like.",
    );
    // No targetType rider: every own in-play Pokémon is a target.
    expect(prompt.targets).toEqual([ACTIVE]);
  });

  it("puts all three on ONE Pokémon — what 'in any way you like' means", () => {
    const evolved = evolveIntoCharizard(charizardBoard(1));
    const prompt = promptOf(evolved.state);
    const done = attach(
      evolved.state,
      prompt.candidates.map((uid) => ({ uid, to: ACTIVE })),
    );
    expect(energyOn(done.state, ACTIVE)).toHaveLength(3);
    expect(all(done.events, "ENERGY_ATTACHED")).toHaveLength(3);
    expect(done.state.phase.kind).toBe("turn:action");
  });

  it("spreads them across Pokémon just as freely", () => {
    const evolved = evolveIntoCharizard(charizardBoard(2));
    const prompt = promptOf(evolved.state);
    const done = attach(evolved.state, [
      { uid: prompt.candidates[0] as string, to: ACTIVE },
      { uid: prompt.candidates[1] as string, to: bench(0) },
      { uid: prompt.candidates[2] as string, to: bench(1) },
    ]);
    expect(energyOn(done.state, ACTIVE)).toHaveLength(1);
    expect(energyOn(done.state, bench(0))).toHaveLength(1);
    expect(energyOn(done.state, bench(1))).toHaveLength(1);
  });

  it("takes the Energy OUT of the deck and conserves every card", () => {
    const evolved = evolveIntoCharizard(charizardBoard());
    const before = census(evolved.state, "p1");
    const deckBefore = evolved.state.players.p1.deck.length;
    const prompt = promptOf(evolved.state);
    const done = attach(
      evolved.state,
      prompt.candidates.map((uid) => ({ uid, to: ACTIVE })),
    );
    expect(done.state.players.p1.deck).toHaveLength(deckBefore - 3);
    for (const uid of prompt.candidates) expect(done.state.players.p1.deck).not.toContain(uid);
    expect(census(done.state, "p1")).toEqual(before);
  });
});

describe("the empty paths — no gate, so every one of them is live", () => {
  it("no {D} Pokémon at all: Janine resolves to a bare deck shuffle", () => {
    // The recorded, deliberate cost of leaving this op ungated: a SUPPORTER
    // (§7.2 — one per turn) spent on a shuffle. See the op's doc.
    const state = handFromDeck(noDarkBoard(), "p1", JANINE, 1);
    const played = playJanine(state);
    expect(played.state.phase.kind).toBe("turn:action");
    expect(types(played.events)).toContain("SHUFFLE");
    expect(all(played.events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(poisoned(played.state, "p1")).toBe(false);
  });

  it("no Basic {D} left in the deck: same, and nothing is recorded", () => {
    let state = janineBoard();
    state = withoutInDeck(state, DARK_ENERGY);
    state = withoutInDeck(state, DARK_ENERGY_ALT);
    const played = playJanine(state);
    expect(played.state.phase.kind).toBe("turn:action");
    expect(all(played.events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(poisoned(played.state, "p1")).toBe(false);
  });

  it("the Trainer is still spent — playing it is legal, not a no-op rejection", () => {
    const state = handFromDeck(noDarkBoard(), "p1", JANINE, 1);
    const uid = handUid(state, "p1", JANINE);
    const played = playJanine(state);
    expect(played.state.players.p1.discard).toContain(uid);
    expect(played.state.allowances.supporterPlayed).toBe(true);
  });
});

describe("wire safety — validateChoice is the one gate, the apply is the belt", () => {
  it("rejects a card the offer does not hold (a deeper deck card)", () => {
    const played = playJanine(janineBoard());
    const prompt = promptOf(played.state);
    const notOffered = played.state.players.p1.deck.find(
      (uid) => !prompt.candidates.includes(uid) && played.state.cardIdByUid[uid] === FIRE_ENERGY,
    );
    expect(notOffered).toBeDefined();
    expectErr(
      played.state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "attachCards", assignments: [{ uid: notOffered as string, to: ACTIVE }] },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("rejects the same card twice", () => {
    const played = playJanine(janineBoard(SEED, 2));
    const prompt = promptOf(played.state);
    expectErr(
      played.state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "attachCards",
          assignments: [
            { uid: prompt.candidates[0] as string, to: ACTIVE },
            { uid: prompt.candidates[0] as string, to: bench(0) },
          ],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("rejects a target the prompt did not offer (the opponent's board)", () => {
    const played = playJanine(janineBoard());
    const prompt = promptOf(played.state);
    expectErr(
      played.state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "attachCards",
          assignments: [
            { uid: prompt.candidates[0] as string, to: { seat: "p2", spot: { spot: "active" } } },
          ],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("the apply SKIPS an out-of-range bench index rather than destroying the card", () => {
    // Driven through the interpreter directly: validateChoice would reject this,
    // so the only way to reach the apply's guard is to hand it the bad ref. Drop
    // the guard and the bench.map no-ops, the event fires, and the uid still
    // leaves the deck — a card deleted from the game.
    const played = playJanine(janineBoard());
    if (played.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const cont = played.state.phase.cont;
    const prompt = promptOf(played.state);
    const events: GameEvent[] = [];
    const result = resumeProgram(
      played.state,
      cont,
      {
        kind: "attachCards",
        assignments: [{ uid: prompt.candidates[0] as string, to: bench(9) }],
      },
      events,
    );
    expect(result.kind).toBe("done");
    expect(census(result.state, "p1")).toEqual(census(played.state, "p1"));
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(poisoned(result.state, "p1")).toBe(false);
  });

  it("a dropped uid is not recorded, so the poison clause does not fire for it", () => {
    // The uid is legal in the prompt but has left the deck by apply time (the
    // §9.2 rule: what was ATTACHED, not what was offered or picked).
    const played = playJanine(janineBoard());
    if (played.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = promptOf(played.state);
    const picked = prompt.candidates[0] as string;
    const side = played.state.players.p1;
    const doctored: GameState = {
      ...played.state,
      players: {
        ...played.state.players,
        p1: {
          ...side,
          deck: side.deck.filter((uid) => uid !== picked),
          discard: [...side.discard, picked],
        },
      },
    };
    const events: GameEvent[] = [];
    const result = resumeProgram(
      doctored,
      played.state.phase.cont,
      { kind: "attachCards", assignments: [{ uid: picked, to: ACTIVE }] },
      events,
    );
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(poisoned(result.state, "p1")).toBe(false);
  });
});

describe("the record CARRIES across a park — the mechanism, not just the storage", () => {
  // The §9.2 review's sharpest finding was that both shipped cards recorded and
  // read inside ONE runProgram, so `resumeProgram`'s record seeding could be
  // deleted with the suite green. Janine is the same shape. This drives a
  // program that records, then parks on a LATER op, so the gate can only be
  // answered from the record the CONTINUATION carried.
  const laterPark: EffectOp[] = [
    {
      op: "attachFromDeck",
      filter: { kind: "basicEnergy", energyType: "Darkness" },
      max: 1,
      recordAs: "moved",
    },
    // A second park, AFTER the recording one — this is what forces the record
    // through the continuation.
    { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "hand", max: 1 },
    {
      op: "recordGate",
      slot: "moved",
      contains: "yourActive",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      then: [{ op: "applyStatus", target: "self", status: "poisoned" }],
    },
  ];

  it("poisons only after the SECOND park resolves, off the carried record", () => {
    const state = janineBoard();
    const events: GameEvent[] = [];
    const first = runProgram(state, laterPark, { seat: "p1" }, events);
    if (first.kind !== "parked") throw new Error("expected the attach to park");
    const attachPrompt = first.prompt;
    if (attachPrompt.kind !== "attachCards") throw new Error("expected attachCards");

    const events2: GameEvent[] = [];
    const second = resumeProgram(
      first.state,
      first.cont,
      { kind: "attachCards", assignments: [{ uid: attachPrompt.candidates[0] as string, to: ACTIVE }] },
      events2,
    );
    if (second.kind !== "parked") throw new Error("expected the search to park");
    // Not poisoned yet — the gate is still behind the search.
    expect(poisoned(second.state, "p1")).toBe(false);
    // The record rode the continuation out of the first park and into this one.
    expect(second.cont.record?.moved).toHaveLength(1);

    // A host that persists state between actions round-trips it through JSON
    // (D14) — so the record has to survive serialization, not just object
    // identity.
    const wire = JSON.parse(JSON.stringify(second)) as typeof second;
    const events3: GameEvent[] = [];
    const third = resumeProgram(wire.state, wire.cont, { kind: "cards", uids: [] }, events3);
    expect(third.kind).toBe("done");
    expect(poisoned(third.state, "p1")).toBe(true);
    expect(find(events3, "STATUS_APPLIED")?.status).toBe("poisoned");
  });

  it("and does NOT poison when the carried record's card went to the Bench", () => {
    const state = janineBoard(SEED, 1);
    const events: GameEvent[] = [];
    const first = runProgram(state, laterPark, { seat: "p1" }, events);
    if (first.kind !== "parked" || first.prompt.kind !== "attachCards") {
      throw new Error("expected an attachCards park");
    }
    const second = resumeProgram(
      first.state,
      first.cont,
      { kind: "attachCards", assignments: [{ uid: first.prompt.candidates[0] as string, to: bench(0) }] },
      [],
    );
    if (second.kind !== "parked") throw new Error("expected the search to park");
    expect(second.cont.record?.moved).toHaveLength(1);
    const third = resumeProgram(second.state, second.cont, { kind: "cards", uids: [] }, []);
    expect(poisoned(third.state, "p1")).toBe(false);
  });
});

describe("purity and replay", () => {
  it("never mutates the state it is given", () => {
    const played = playJanine(janineBoard());
    const prompt = promptOf(played.state);
    const frozen = deepFreeze(played.state);
    const done = attach(frozen, [{ uid: prompt.candidates[0] as string, to: ACTIVE }]);
    expect(poisoned(done.state, "p1")).toBe(true);
    expect(poisoned(frozen, "p1")).toBe(false);
  });

  it("replays identically through a JSON round trip at the park", () => {
    const played = playJanine(janineBoard());
    const prompt = promptOf(played.state);
    const wire = JSON.parse(JSON.stringify(played.state)) as GameState;
    const direct = attach(played.state, [{ uid: prompt.candidates[0] as string, to: ACTIVE }]);
    const viaWire = attach(wire, [{ uid: prompt.candidates[0] as string, to: ACTIVE }]);
    expect(viaWire.state).toEqual(direct.state);
    expect(viaWire.events).toEqual(direct.events);
  });
});

describe("the catalog rows", () => {
  it("registers every print of both cards", () => {
    // Reprint ids were the §9.2 review's second finding: three of five could be
    // deleted with the suite green.
    for (const id of ["sv06.5-059", "sv06.5-088"]) {
      expect(programFor(id)?.trainer?.[0]?.op).toBe("attachFromDeck");
    }
    for (const id of ["sv03-125", "sv03-215", "sv03-223", "sv03-228"]) {
      expect(programFor(id)?.triggered?.[0]?.name).toBe("Infernal Reign");
    }
  });

  it("Janine's program is her three printed sentences, in order", () => {
    const program = programFor("sv06.5-059")?.trainer;
    expect(program?.map((op) => op.op)).toEqual(["attachFromDeck", "shuffleDeck", "recordGate"]);
    expect(program?.[0]).toMatchObject({
      filter: { kind: "basicEnergy", energyType: "Darkness" },
      max: 2,
      targetType: "Darkness",
      maxPerTarget: 1,
      recordAs: "moved",
    });
    expect(program?.[2]).toMatchObject({ slot: "moved", contains: "yourActive" });
  });

  it("STATUS_WORD_OF is the exact inverse of the printed status words", () => {
    // The prompt's "it is now Poisoned" reads through this table; the types
    // enforce completeness but not that each key maps to its OWN word.
    expect(STATUS_WORD_OF).toEqual({
      asleep: "Asleep",
      burned: "Burned",
      confused: "Confused",
      paralyzed: "Paralyzed",
      poisoned: "Poisoned",
    });
  });
});

describe("the opponent is untouched", () => {
  it("attaches only to the controller's board", () => {
    const played = playJanine(janineBoard());
    const prompt = promptOf(played.state);
    const before = census(played.state, "p2");
    const done = attach(played.state, [{ uid: prompt.candidates[0] as string, to: ACTIVE }]);
    expect(census(done.state, "p2")).toEqual(before);
    expect(poisoned(done.state, "p2")).toBe(false);
    expect(prompt.targets.every((t) => t.seat === "p1")).toBe(true);
  });

  it("rejects a resolveEffect from the seat that did not park", () => {
    const played = playJanine(janineBoard());
    const prompt = promptOf(played.state);
    const result = applyAction(played.state, {
      type: "resolveEffect",
      seat: "p2",
      choice: {
        kind: "attachCards",
        assignments: [{ uid: prompt.candidates[0] as string, to: ACTIVE }],
      },
    });
    expect(result.ok).toBe(false);
  });
});

// ── REVIEW ADDITIONS ────────────────────────────────────────────────────────
// Everything below came out of the adversarial review of this slice. Each block
// kills a mutation that survived the suite as first written, and its comment
// says WHICH claim it pins — a test whose subject is visible only in a mutation
// table is a test the next author deletes.

/** A card's interchangeable class, as `cardIdentity` computes it: the two
    Darkness prints collapse into one, and fix-special is not a Basic at all so
    no `basicEnergy` filter ever admits it. */
const CLASS_OF: Record<string, string> = {
  "fix-dark-energy": "Darkness",
  "fix-dark-energy-alt": "Darkness",
  "fix-fire-energy": "Fire",
  "fix-energy": "Colorless",
};

describe("the offer's CLAMP — invisible on both shipped cards, load-bearing anyway", () => {
  // Charizard and Janine both print a SINGLE-class filter ({R} only / {D} only),
  // and the collapse already caps a class at `max` — so for them
  // `candidates.length` never exceeds `max` and `Math.min(op.max,
  // candidates.length)` is indistinguishable from `candidates.length`. The cap is
  // PER CLASS, so the moment a filter admits several classes the offer is bigger
  // than the printed number and the clamp is the only thing keeping "up to 2" on
  // the prompt. Geeta ("up to 2 Basic Energy", deferred) is exactly that shape.
  const anyBasic: EffectOp[] = [{ op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 2 }];

  it("offers `max` per CLASS but still caps the pick at the printed max", () => {
    const state = janineBoard();
    const parked = runProgram(state, anyBasic, { seat: "p1" }, []);
    if (parked.kind !== "parked" || parked.prompt.kind !== "attachCards") {
      throw new Error("expected an attachCards park");
    }
    const classes = parked.prompt.candidates.map(
      (uid) => CLASS_OF[state.cardIdByUid[uid] as string] as string,
    );
    // Three interchangeable classes live in this deck ({D}, {R}, Colorless);
    // fix-special is a SPECIAL Energy and `basicEnergy` admits none of them.
    expect(new Set(classes)).toEqual(new Set(["Darkness", "Fire", "Colorless"]));
    for (const klass of ["Darkness", "Fire", "Colorless"]) {
      expect(classes.filter((c) => c === klass)).toHaveLength(2);
    }
    expect(parked.prompt.candidates).toHaveLength(6);
    // …and the printed "up to 2" survives the six rows.
    expect(parked.prompt.max).toBe(2);
  });
});

describe("the apply is the BELT — every guard in it, driven past the validator", () => {
  // `validateChoice` is the one gate (cardplay.ts), so none of these is reachable
  // through a well-formed `applyAction`; the apply's own doc nevertheless claims
  // each of them, and a claim with no test is how a guard gets deleted.
  function park(benched = 1) {
    const played = playJanine(janineBoard(SEED, benched));
    if (played.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    return { state: played.state, cont: played.state.phase.cont, prompt: promptOf(played.state) };
  }

  it("SKIPS a uid repeated across two assignments rather than attaching it twice", () => {
    // Drop the `attached.has(uid)` guard and the second entry attaches the SAME
    // physical card to a second Pokémon: `inDeck` is a snapshot, so it still says
    // yes, and the deck filter removes the uid once — one card, two places.
    const { state, cont, prompt } = park(1);
    const uid = prompt.candidates[0] as string;
    const before = census(state, "p1");
    const events: GameEvent[] = [];
    const result = resumeProgram(
      state,
      cont,
      {
        kind: "attachCards",
        assignments: [
          { uid, to: ACTIVE },
          { uid, to: bench(0) },
        ],
      },
      events,
    );
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(energyOn(result.state, ACTIVE)).toEqual([uid]);
    expect(energyOn(result.state, bench(0))).toHaveLength(0);
    expect(census(result.state, "p1")).toEqual(before);
  });

  it("SKIPS an assignment aimed at the opponent's seat", () => {
    // Without the `to.seat !== ctx.seat` guard the card lands on the CONTROLLER's
    // Active anyway — the apply reads `active`/`bench` off the controller's side
    // and never consults `to.seat` again — so the census stays conserved and only
    // the board and the event betray it.
    const { state, cont, prompt } = park(1);
    const uid = prompt.candidates[0] as string;
    const events: GameEvent[] = [];
    const result = resumeProgram(
      state,
      cont,
      { kind: "attachCards", assignments: [{ uid, to: { seat: "p2", spot: { spot: "active" } } }] },
      events,
    );
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(energyOn(result.state, ACTIVE)).toHaveLength(0);
    expect(result.state.players.p1.deck).toContain(uid);
    expect(census(result.state, "p2")).toEqual(census(state, "p2"));
  });

  it("SKIPS the Active slot when the Active is gone — applyAction never throws", () => {
    // The crafted-snapshot guard (attack.ts's rule, applied here): the parked
    // prompt still offers the Active, so `validateChoice` passes, and only the
    // apply's `active === null` check stands between a hostile snapshot and a
    // TypeError out of `applyAction` (the D14 contract).
    const { state, prompt } = park(1);
    const side = state.players.p1;
    const doctored: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...side, active: null, discard: [...side.discard, ...(side.active?.stack ?? [])] },
      },
    };
    const before = census(doctored, "p1");
    const result = applyAction(doctored, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "attachCards",
        assignments: [{ uid: prompt.candidates[0] as string, to: ACTIVE }],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(census(result.state, "p1")).toEqual(before);
  });

  it("names the REAL destination on every ENERGY_ATTACHED", () => {
    // The event is what a client animates off. The apply rebuilds the target
    // field by field (the §2 copy contract) — and a rebuild that always said
    // "active" would leave the board right and the replay wrong.
    const played = playJanine(janineBoard(SEED, 2));
    const prompt = promptOf(played.state);
    const done = attach(played.state, [
      { uid: prompt.candidates[0] as string, to: bench(1) },
      { uid: prompt.candidates[1] as string, to: ACTIVE },
    ]);
    const attached = all(done.events, "ENERGY_ATTACHED");
    expect(attached.map((e) => e.target)).toEqual([
      { spot: "bench", index: 1 },
      { spot: "active" },
    ]);
    expect(attached.every((e) => e.seat === "p1")).toBe(true);
  });
});

describe("the §9.2 record files what MOVED — read without the board narrowing", () => {
  // Janine's gate reads the BOARD (`contains: "yourActive"`), and that masks the
  // record's own contents: a uid filed but never attached is not on the Active
  // either, so a wrong record still gives the right answer. A PLAIN gate ("did
  // you do anything") reads the record and nothing else, and that is where "what
  // was ATTACHED, not what was picked" is actually observable.
  const plainGate: EffectOp[] = [
    {
      op: "attachFromDeck",
      filter: { kind: "basicEnergy", energyType: "Darkness" },
      max: 1,
      recordAs: "moved",
    },
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
    { op: "recordGate", slot: "moved", then: [{ op: "drawCards", count: 1 }] },
  ];

  function drivePlain(to: PokemonRef) {
    const first = runProgram(janineBoard(SEED, 1), plainGate, { seat: "p1" }, []);
    if (first.kind !== "parked" || first.prompt.kind !== "attachCards") {
      throw new Error("expected an attachCards park");
    }
    const result = resumeProgram(
      first.state,
      first.cont,
      {
        kind: "attachCards",
        assignments: [{ uid: first.prompt.candidates[0] as string, to }],
      },
      [],
    );
    return { before: first.state, after: result.state };
  }

  it("a PICKED-but-not-attached uid is not filed, so the plain gate stays shut", () => {
    // bench(9) does not exist: the apply skips it, nothing moves, the record is
    // empty — and "if you do" is false even though the player did answer.
    const { before, after } = drivePlain(bench(9));
    expect(after.players.p1.hand).toHaveLength(before.players.p1.hand.length);
  });

  it("…and an attach that DID land opens it", () => {
    const { before, after } = drivePlain(ACTIVE);
    expect(after.players.p1.hand).toHaveLength(before.players.p1.hand.length + 1);
  });

  it("a SKIPPED uid that is already on the Active cannot open the narrowed gate", () => {
    // The sharpest form of "what was ATTACHED, not what was picked". One
    // assignment lands on the BENCH (so the apply does not short-circuit) and a
    // second names an Energy ALREADY sitting on the Active — which the apply
    // skips, because it never left the deck. File the picks instead of the moves
    // and that second uid is both "filed" and "on the Active", and Janine
    // poisons herself for an attach she never made.
    const state = attachFromDeck(janineBoard(SEED, 1), "p1", DARK_ENERGY, 1);
    const alreadyOnActive = energyOn(state, ACTIVE)[0] as string;
    const gateProgram: EffectOp[] = [
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Darkness" },
        max: 2,
        recordAs: "moved",
      },
      {
        op: "recordGate",
        slot: "moved",
        contains: "yourActive",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "applyStatus", target: "self", status: "poisoned" }],
      },
    ];
    const first = runProgram(state, gateProgram, { seat: "p1" }, []);
    if (first.kind !== "parked" || first.prompt.kind !== "attachCards") {
      throw new Error("expected an attachCards park");
    }
    const result = resumeProgram(
      first.state,
      first.cont,
      {
        kind: "attachCards",
        assignments: [
          { uid: first.prompt.candidates[0] as string, to: bench(0) },
          { uid: alreadyOnActive, to: ACTIVE },
        ],
      },
      [],
    );
    expect(energyOn(result.state, bench(0))).toHaveLength(1);
    expect(energyOn(result.state, ACTIVE)).toEqual([alreadyOnActive]); // unchanged
    expect(poisoned(result.state, "p1")).toBe(false);
  });

  it("a WHIFFED attachFromDeck overwrites the slot instead of leaving a stale one", () => {
    // Two writers, one slot: the first attaches and files a uid, the second finds
    // no {M} Energy anywhere and must file an EMPTY answer — the rule
    // `discardPileRetrieval` states beside it. File nothing and the gate answers
    // for the FIRST op, which is the one shape §9.2 exists to forbid.
    const twoWriters: EffectOp[] = [
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Darkness" },
        max: 1,
        recordAs: "moved",
      },
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Metal" }, // nothing in this deck
        max: 1,
        recordAs: "moved",
      },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "recordGate", slot: "moved", then: [{ op: "drawCards", count: 1 }] },
    ];
    const first = runProgram(janineBoard(SEED, 1), twoWriters, { seat: "p1" }, []);
    if (first.kind !== "parked" || first.prompt.kind !== "attachCards") {
      throw new Error("expected an attachCards park");
    }
    const result = resumeProgram(
      first.state,
      first.cont,
      {
        kind: "attachCards",
        assignments: [{ uid: first.prompt.candidates[0] as string, to: ACTIVE }],
      },
      [],
    );
    expect(result.kind).toBe("done");
    // The first op DID move a card…
    expect(energyOn(result.state, ACTIVE)).toHaveLength(1);
    // …and the gate still reads the SECOND op, which moved none.
    expect(result.state.players.p1.hand).toHaveLength(first.state.players.p1.hand.length);
  });

  it("no Active at all is not 'it landed on the Active'", () => {
    const gate: EffectOp[] = [
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Darkness" },
        max: 1,
        recordAs: "moved",
      },
      {
        op: "recordGate",
        slot: "moved",
        contains: "yourActive",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "drawCards", count: 1 }],
      },
    ];
    const first = runProgram(janineBoard(SEED, 1), gate, { seat: "p1" }, []);
    if (first.kind !== "parked" || first.prompt.kind !== "attachCards") {
      throw new Error("expected an attachCards park");
    }
    const side = first.state.players.p1;
    const noActive: GameState = {
      ...first.state,
      players: {
        ...first.state.players,
        p1: { ...side, active: null, discard: [...side.discard, ...(side.active?.stack ?? [])] },
      },
    };
    const result = resumeProgram(
      noActive,
      first.cont,
      {
        kind: "attachCards",
        assignments: [{ uid: first.prompt.candidates[0] as string, to: bench(0) }],
      },
      [],
    );
    expect(result.state.players.p1.hand).toHaveLength(noActive.players.p1.hand.length);
  });
});

describe("the prompt note — the branches no shipped card reaches", () => {
  function noteOf(program: EffectOp[]): string {
    const parked = runProgram(janineBoard(), program, { seat: "p1" }, []);
    if (parked.kind !== "parked") throw new Error("expected a park");
    return parked.prompt.note;
  }
  const search = (extra: Record<string, unknown> = {}): EffectOp =>
    ({
      op: "attachFromDeck",
      filter: { kind: "basicEnergy", energyType: "Darkness" },
      max: 1,
      ...extra,
    }) as EffectOp;

  it("a max of ONE reads as a singular sentence, not 'up to 1 … cards'", () => {
    expect(noteOf([search()])).toBe(
      "Search your deck for a Basic Darkness Energy card and attach it to your Pokémon.",
    );
  });

  it("a per-target cap ABOVE one says the number, not a hard-coded '1'", () => {
    // `maxPerTarget` is typed `number` and Janine is the only consumer, at 1 —
    // so the plural arm is reachable only from here, and without this the whole
    // conditional collapses to the constant with the suite green.
    expect(noteOf([search({ max: 4, maxPerTarget: 2 })])).toBe(
      "Search your deck for up to 4 Basic Darkness Energy cards and attach up to 2 to each of up to 4 of your Pokémon.",
    );
  });

  it("spells the status the gate actually applies, not a hard-coded Poisoned", () => {
    expect(
      noteOf([
        search({ recordAs: "moved" }),
        {
          op: "recordGate",
          slot: "moved",
          contains: "yourActive",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [{ op: "applyStatus", target: "self", status: "burned" }],
        },
      ]),
    ).toBe(
      "Search your deck for a Basic Darkness Energy card and attach it to your Pokémon. If you attach one to your Active Pokémon, it is now Burned.",
    );
  });

  it("says NOTHING about a branch it has no phrase for — the defender arm", () => {
    // `applyStatus target: "defender"` belongs to an attack program, where no
    // §9.2 gate exists. Describing it here would put "it is now Poisoned" over a
    // prompt whose gate poisons the OPPONENT — half a consequence, which the
    // describer's whole design refuses.
    expect(
      noteOf([
        search({ recordAs: "moved" }),
        {
          op: "recordGate",
          slot: "moved",
          contains: "yourActive",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [{ op: "applyStatus", target: "defender", status: "poisoned" }],
        },
      ]),
    ).toBe("Search your deck for a Basic Darkness Energy card and attach it to your Pokémon.");
  });
});

describe("one eligible Pokémon: the printed 'up to 2' is a hard 1", () => {
  // §8.6 "do as much as you can", arriving from the TARGET side — with a single
  // {D} Pokémon in play, `maxPerTarget: 1` is what makes the second Energy
  // unattachable, and no rule is broken by that.
  //
  // THE PROMPT HAS TO SAY SO. `targets.length × maxPerTarget` is a real ceiling
  // and the offer is clamped to it, for the reason attachFromTop's own doc gives
  // for clamping to the candidate count: a prompt reading "up to 2" over a board
  // where 1 is the maximum has the dialog count "0/2" and invites a second pick
  // the validator then refuses. (An earlier draft of this suite asserted the
  // refusal by handing the validator `candidates[1]` — which after the clamp is
  // `undefined`, so it was rejected as "not an attachable card" and the test
  // passed while proving nothing. Hence the assertions on the OFFER below.)
  it("offers ONE row and a max of 1, not the printed 2", () => {
    const state = handFromDeck(withBoard(board(SEED), DARK_BODY, []), "p1", JANINE, 1);
    const prompt = promptOf(playJanine(state).state);
    expect(prompt.targets).toEqual([ACTIVE]);
    expect(prompt.max).toBe(1);
    expect(prompt.candidates).toHaveLength(1);
  });

  it("still takes its one, and the §9.2 gate still fires", () => {
    const state = handFromDeck(withBoard(board(SEED), DARK_BODY, []), "p1", JANINE, 1);
    const played = playJanine(state);
    const prompt = promptOf(played.state);
    const done = attach(played.state, [{ uid: prompt.candidates[0] as string, to: ACTIVE }]);
    expect(energyOn(done.state, ACTIVE)).toHaveLength(1);
    expect(poisoned(done.state, "p1")).toBe(true);
  });

  it("two eligible Pokémon lift the ceiling back to the printed 2", () => {
    // The other side of the same clamp — it must track the BOARD, not simply
    // pin Janine at 1 forever.
    const prompt = promptOf(playJanine(janineBoard(SEED, 1)).state);
    expect(prompt.targets).toHaveLength(2);
    expect(prompt.max).toBe(2);
    expect(prompt.candidates).toHaveLength(2);
  });

  it("Charizard's 'in any way you like' is NOT clamped by the target count", () => {
    // No per-target rule means one Pokémon can take every card, so a lone Active
    // still gets the full printed 3. The clamp must read the rider, not the
    // target count.
    let state = withBoard(laterBoard(SEED), STAGE1, []);
    state = handFromDeck(state, "p1", CHARIZARD, 1);
    const evolved = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", CHARIZARD),
      target: { spot: "active" },
    });
    const prompt = promptOf(evolved.state);
    expect(prompt.targets).toHaveLength(1);
    expect(prompt.max).toBe(3);
    expect(prompt.candidates).toHaveLength(3);
  });
});

describe('§9.2 `contains: "yourActive"` resolves on the LATER truth', () => {
  // THE REVIEW'S HEADLINE FINDING. The gate asks the BOARD, not the record, so it
  // answers "is a filed uid on the Active NOW" — which is the printed "you
  // attached Energy to your Active Pokémon in this way" only while nothing
  // between the two ops moves it. Three ops already in this vocabulary do:
  // `switchActive`, `moveEnergy` and `discardEnergy { from: "yourActive" }`. No
  // shipped program sequences any of them before this gate (Janine's is
  // attachFromDeck → shuffleDeck → recordGate, and shuffleDeck touches nothing
  // this reads), so nothing is wrong on the board today — these pin the
  // semantics so the next author meets them as a decision rather than a bug.
  const attachOp: EffectOp = {
    op: "attachFromDeck",
    filter: { kind: "basicEnergy", energyType: "Darkness" },
    max: 1,
    recordAs: "moved",
  };
  const gate: EffectOp = {
    op: "recordGate",
    slot: "moved",
    contains: "yourActive",
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
    then: [{ op: "applyStatus", target: "self", status: "poisoned" }],
  };

  function drive(program: EffectOp[], to: PokemonRef): GameState {
    const events: GameEvent[] = [];
    const first = runProgram(janineBoard(SEED, 1), program, { seat: "p1" }, events);
    if (first.kind !== "parked" || first.prompt.kind !== "attachCards") {
      throw new Error("expected an attachCards park");
    }
    let result = resumeProgram(
      first.state,
      first.cont,
      { kind: "attachCards", assignments: [{ uid: first.prompt.candidates[0] as string, to }] },
      events,
    );
    while (result.kind === "parked") {
      const p = result.prompt;
      if (p.kind === "moveEnergy") {
        result = resumeProgram(
          result.state,
          result.cont,
          {
            kind: "moveEnergy",
            picks: [
              { uid: p.movable[0]?.uid as string, dest: p.destinations[0] as PokemonRef },
            ],
          },
          events,
        );
      } else if (p.kind === "choosePokemon") {
        result = resumeProgram(
          result.state,
          result.cont,
          { kind: "pokemon", ref: p.candidates[0] as PokemonRef },
          events,
        );
      } else {
        throw new Error(`unexpected second park: ${p.kind}`);
      }
    }
    return result.state;
  }

  it("switchActive after the attach: it LANDED on the Active, and the gate says no", () => {
    expect(poisoned(drive([attachOp, { op: "switchActive" }, gate], ACTIVE), "p1")).toBe(false);
  });

  it("switchActive after the attach: it landed on the BENCH, and the gate says yes", () => {
    expect(poisoned(drive([attachOp, { op: "switchActive" }, gate], bench(0)), "p1")).toBe(true);
  });

  it("moveEnergy benchToActive after the attach: a bench landing, and the gate says yes", () => {
    const program: EffectOp[] = [
      attachOp,
      { op: "moveEnergy", filter: { kind: "basicEnergy" }, max: 1, route: "benchToActive" },
      gate,
    ];
    expect(poisoned(drive(program, bench(0)), "p1")).toBe(true);
  });

  it("discardEnergy off your own Active after the attach: an Active landing, gate says no", () => {
    const program: EffectOp[] = [
      attachOp,
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
      gate,
    ];
    expect(poisoned(drive(program, ACTIVE), "p1")).toBe(false);
  });
});

describe("wire safety — the hostile shapes applyAction must survive (D14)", () => {
  // `applyAction` never throws and never corrupts. The attachCards answer is the
  // only MAP-shaped one on the wire, so every entry is two unknowns.
  const HOSTILE = playJanine(janineBoard(SEED, 1)).state;
  const HOSTILE_PROMPT = promptOf(HOSTILE);
  const good = HOSTILE_PROMPT.candidates[0] as string;
  const at = (index: unknown) => ({ seat: "p1", spot: { spot: "bench", index } });
  const cases: [string, unknown][] = [
    ["a null choice", null],
    ["a number choice", 7],
    ["assignments as a string", { kind: "attachCards", assignments: "nope" }],
    ["a null entry", { kind: "attachCards", assignments: [null] }],
    ["a numeric entry", { kind: "attachCards", assignments: [3] }],
    ["a non-string uid", { kind: "attachCards", assignments: [{ uid: 5, to: ACTIVE }] }],
    ["a missing destination", { kind: "attachCards", assignments: [{ uid: good }] }],
    ["a null destination", { kind: "attachCards", assignments: [{ uid: good, to: null }] }],
    [
      "an unknown seat",
      {
        kind: "attachCards",
        assignments: [{ uid: good, to: { seat: "p3", spot: { spot: "active" } } }],
      },
    ],
    ["a bench index as a string", { kind: "attachCards", assignments: [{ uid: good, to: at("0") }] }],
    ["a bench index of 99", { kind: "attachCards", assignments: [{ uid: good, to: at(99) }] }],
    ["a fractional bench index", { kind: "attachCards", assignments: [{ uid: good, to: at(1.5) }] }],
    [
      "a card from the opponent's deck",
      { kind: "attachCards", assignments: [{ uid: HOSTILE.players.p2.deck[0], to: ACTIVE }] },
    ],
    [
      "a card from your own hand",
      { kind: "attachCards", assignments: [{ uid: HOSTILE.players.p1.hand[0], to: ACTIVE }] },
    ],
    [
      "fifty copies of one uid",
      { kind: "attachCards", assignments: Array(50).fill({ uid: good, to: ACTIVE }) },
    ],
  ];

  for (const [name, choice] of cases) {
    it(`rejects ${name} without throwing or losing a card`, () => {
      const before = census(HOSTILE, "p1");
      const result = applyAction(HOSTILE, {
        type: "resolveEffect",
        seat: "p1",
        choice,
      } as never);
      expect(result.ok).toBe(false);
      expect(census(HOSTILE, "p1")).toEqual(before);
    });
  }
});
