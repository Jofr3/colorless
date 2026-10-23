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
  trainerCard,
  must,
  firstBasicInHand,
} from "./testFixtures";

const LEDIAN = "svp-133";
const LEDIAN_IDS = ["svp-133", "sv07-003", "sv07-144"] as const;
const LEDIAN_TEXT =
  "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may switch in 1 of your opponent's Benched Pokémon that has 90 HP or less remaining to the Active Spot.";

const BIANCA = "sv05-142";
const BIANCA_IDS = ["sv05-142", "sv05-197", "sv05-209"] as const;
const BIANCA_TEXT = "Heal all damage from 1 of your Pokémon that has 30 HP or less remaining.";

const LEDYBA = "fix-d349-ledyba";
/** 90 HP — the BOUNDARY body: undamaged, it sits exactly ON Ledian's window. */
const AT_90 = "fix-d349-at90";
/** 130 HP — outside both windows until it is damaged into one. */
const AT_130 = "fix-d349-at130";
/** 30 HP — the boundary body for Bianca's window, and the witness that an
    UNDAMAGED Pokémon is a candidate (it heals 0 and emits nothing). */
const AT_30 = "fix-d349-at30";
const ENERGY = "fix-energy";
/** Potion `sv01-188` — the UNNARROWED heal, and the control for §5. It is a real
    `FIXTURE_POOL` card already, so it enters this file through the pool rather
    than through `LOCAL_CARDS`: nothing is defined for it here. */
const POTION = "sv01-188";

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(
    LEDIAN_IDS.map((id) => [
      id,
      battler(id, {
        name: "Ledian",
        stage: "Stage1",
        evolveFrom: "Ledyba",
        hp: 90,
        retreat: 0,
        types: ["Grass"],
        abilities: [{ type: "Ability", name: "Glittering Star Pattern", effect: LEDIAN_TEXT }],
      }),
    ]),
  ),
  ...Object.fromEntries(BIANCA_IDS.map((id) => [id, trainerCard(id, "Supporter", BIANCA_TEXT)])),
  [LEDYBA]: battler(LEDYBA, { name: "Ledyba", hp: 60, types: ["Grass"] }),
  [AT_90]: battler(AT_90, { name: "D349 90HP", hp: 90, retreat: 1 }),
  [AT_130]: battler(AT_130, { name: "D349 130HP", hp: 130, retreat: 1 }),
  [AT_30]: battler(AT_30, { name: "D349 30HP", hp: 30, retreat: 1 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [LEDIAN]: 4,
  [LEDIAN_IDS[1]]: 4,
  [LEDIAN_IDS[2]]: 4,
  [BIANCA]: 4,
  [BIANCA_IDS[1]]: 4,
  [BIANCA_IDS[2]]: 4,
  [LEDYBA]: 8,
  [AT_90]: 8,
  [AT_130]: 8,
  [AT_30]: 8,
  [POTION]: 2,
  [ENERGY]: 2,
});

function apply(
  state: GameState,
  action: Parameters<typeof applyAction>[1],
): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function takeLoneGust(parked: { state: GameState; events: readonly GameEvent[] }): {
  state: GameState;
  events: readonly GameEvent[];
} {
  const { phase } = parked.state;
  if (phase.kind !== "effect:choose" || phase.prompt.kind !== "choosePokemon") {
    throw new Error(`expected the declinable gust park, got ${phase.kind}`);
  }
  expect(phase.prompt.upTo).toBe(1);
  expect(phase.prompt.candidates).toHaveLength(1);
  const ref = phase.prompt.candidates[0];
  const taken = apply(parked.state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemon", ref },
  });
  return { state: taken.state, events: [...parked.events, ...taken.events] };
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

/** TEST SURGERY — seat exactly the bodies each side names, Active first, on p1's
    turn (p2 went first and passed, so p1's turn is unrestricted). */
function board(spec: { p1: readonly string[]; p2: readonly string[] }, seed = 4): GameState {
  // Turn 3, not turn 1: §4/§10 refuse an evolution on a seat's FIRST turn, and
  // this file evolves. The turns are passed BEFORE the surgery so the bodies the
  // spec names are seated on the turn they are used.
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  for (const seat of ["p1", "p2"] as const) {
    const ids = seat === "p1" ? spec.p1 : spec.p2;
    state = setActive(state, seat, ids[0] ?? AT_130);
    state = clearBench(state, seat);
    for (const id of ids.slice(1)) state = benchFromDeck(state, seat, id);
  }
  return state;
}

/** TEST SURGERY — `setActiveFromDeck`'s job, written locally because the shared
    one is not re-exported under a name that also clears the previous Active's
    damage; this file needs the damage it sets to be the only damage on the board. */
function setActive(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat}'s deck has no ${cardId}`);
  const returned = side.active === null ? [] : side.active.stack;
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: [...side.deck.filter((u) => u !== uid), ...returned],
        active: { stack: [uid], damage: 0, energy: [], tools: [], conditions: [] },
      },
    },
  };
}

/** TEST SURGERY — put `damage` HP of damage on one body. Index 0 is the Active. */
function damage(state: GameState, seat: Seat, index: number, amount: number): GameState {
  const side = state.players[seat];
  if (index === 0) {
    if (side.active === null) throw new Error(`${seat} has no Active`);
    return {
      ...state,
      players: {
        ...state.players,
        [seat]: { ...side, active: { ...side.active, damage: amount } },
      },
    };
  }
  const body = side.bench[index - 1];
  if (body === undefined) throw new Error(`${seat} has no bench[${index - 1}]`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        bench: side.bench.map((b, i) => (i === index - 1 ? { ...b, damage: amount } : b)),
      },
    },
  };
}

/** TEST SURGERY — move one copy of `id` out of p1's deck and into their hand. */
function toHand(state: GameState, id: string): { state: GameState; uid: string } {
  const side = state.players.p1;
  const uid = side.deck.find((u) => state.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`p1's deck has no ${id}`);
  return {
    state: {
      ...state,
      players: {
        ...state.players,
        p1: { ...side, deck: side.deck.filter((u) => u !== uid), hand: [...side.hand, uid] },
      },
    },
    uid,
  };
}

function cardIdAt(state: GameState, seat: Seat, index: number): string {
  const side = state.players[seat];
  const body = index === 0 ? side.active : side.bench[index - 1];
  if (body === undefined || body === null) throw new Error(`no body at ${seat}[${index}]`);
  return state.cardIdByUid[body.stack.at(-1) ?? ""] ?? "";
}

describe("D349 §1 — the two registry rows, read off the LIVE registry", () => {
  it("Ledian's THREE printings resolve to ONE program object, by identity", () => {
    const first = programFor(LEDIAN);
    expect(first).toBeDefined();
    for (const id of LEDIAN_IDS) expect(programFor(id), id).toBe(first);
  });

  it("Bianca's Devotion's THREE printings resolve to ONE program object", () => {
    const first = programFor(BIANCA);
    expect(first).toBeDefined();
    for (const id of BIANCA_IDS) expect(programFor(id), id).toBe(first);
  });

  it("the two rows do NOT share an object — one CLAUSE is not one sentence", () => {
    expect(programFor(LEDIAN)).not.toBe(programFor(BIANCA));
    expect(programFor(LEDIAN)).not.toBe(programFor("sv09-136")); // Defiant Horn
    expect(programFor(BIANCA)).not.toBe(programFor("sv01-183")); // Potion
  });

  it("Ledian is an onEvolve TRIGGER carrying a single gust, and NO attack key", () => {
    const program = programFor(LEDIAN);
    expect(Object.keys(program ?? {})).toEqual(["triggered"]);
    const ability = program?.triggered?.[0];
    expect(program?.triggered).toHaveLength(1);
    expect(ability?.name).toBe("Glittering Star Pattern");
    expect(ability?.trigger).toBe("onEvolve");
    expect(ability?.program).toEqual([{ op: "gust", remainingHpAtMost: 90, optional: true }]);
  });

  it("Bianca's Devotion is ONE healChosen — no zone, no upTo, amount `all`", () => {
    const program = programFor(BIANCA);
    expect(Object.keys(program ?? {})).toEqual(["trainer"]);
    expect(program?.trainer).toEqual([{ op: "healChosen", amount: "all", remainingHpAtMost: 30 }]);
  });
});

describe("D349 §2 — Ledian: the window narrows the GUST candidates", () => {
  /** Evolve p1's Active Ledyba into Ledian and return whatever that produced. */
  function evolveIntoLedian(state: GameState): ReturnType<typeof apply> {
    const withCard = toHand(state, LEDIAN);
    return apply(withCard.state, {
      type: "evolve",
      seat: "p1",
      uid: withCard.uid,
      target: { spot: "active" },
    });
  }

  it("takes the 90-HP body and REFUSES the 130-HP one — the boundary is INCLUSIVE", () => {
    const start = board({ p1: [LEDYBA], p2: [AT_130, AT_90, AT_130] });
    const { state: done, events } = takeLoneGust(evolveIntoLedian(start));
    expect(done.phase.kind).toBe("turn:action");
    expect(events.map((e) => e.type)).toContain("POKEMON_SWITCHED");
    expect(cardIdAt(done, "p2", 0)).toBe(AT_90);
  });

  it("it is a BOARD read: 50 damage brings a 130-HP body INTO the window", () => {
    const start = damage(board({ p1: [LEDYBA], p2: [AT_130, AT_130, AT_130] }), "p2", 1, 50);
    const { state: done } = takeLoneGust(evolveIntoLedian(start));
    expect(done.phase.kind).toBe("turn:action");
    expect(cardIdAt(done, "p2", 0)).toBe(AT_130);
    // …and it is the DAMAGED one that came up: the body that was on bench[0] is
    // now Active carrying its 50, and the two full-HP 130s stayed put.
    expect(done.players.p2.active?.damage).toBe(50);
  });

  it("PARKS on two in-window bodies, and the CAPTION names the window", () => {
    const start = board({ p1: [LEDYBA], p2: [AT_130, AT_90, AT_90, AT_130] });
    const { state: parked } = evolveIntoLedian(start);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(parked.phase.prompt.candidates).toHaveLength(2);
    // A caption that named a set the validator does not offer is the dialog
    // contradicting itself — `gustTargetNoun`'s stated reason for existing.
    expect(parked.phase.prompt.note).toBe(
      "Gust up which of the opponent's Benched Pokémon that has 90 HP or less remaining?",
    );
    const pick = parked.phase.prompt.candidates[1];
    if (pick === undefined) throw new Error("no second candidate");
    const { state: done, events } = apply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: pick },
    });
    expect(events.map((e) => e.type)).toContain("POKEMON_SWITCHED");
    expect(cardIdAt(done, "p2", 0)).toBe(AT_90);
  });

  it("an EMPTY window parks nothing and costs nothing — the evolution still lands", () => {
    // Every opposing Benched body above the window: `parkOrForce` has no
    // candidates, so the whole trigger is a silent no-op. The point is that a
    // TRIGGER with an empty narrowed set does not strand the turn.
    const start = board({ p1: [LEDYBA], p2: [AT_130, AT_130, AT_130] });
    const { state: done, events } = evolveIntoLedian(start);
    expect(done.phase.kind).toBe("turn:action");
    expect(events.map((e) => e.type)).not.toContain("POKEMON_SWITCHED");
    expect(cardIdAt(done, "p1", 0)).toBe(LEDIAN);
    expect(cardIdAt(done, "p2", 0)).toBe(AT_130);
  });
});

describe("D349 §3 — Bianca's Devotion: the window narrows the HEAL candidates", () => {
  function playBianca(state: GameState): ReturnType<typeof apply> {
    const withCard = toHand(state, BIANCA);
    return apply(withCard.state, { type: "playTrainer", seat: "p1", uid: withCard.uid });
  }

  it("heals ALL damage from the one body inside the window, and refuses the rest", () => {
    const start = damage(board({ p1: [AT_130, AT_130, AT_130], p2: [AT_130] }), "p1", 0, 110);
    const { state: done, events } = playBianca(start);
    expect(done.phase.kind).toBe("turn:action");
    expect(events.filter((e) => e.type === "HEALED")).toHaveLength(1);
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("an UNDAMAGED body inside the window IS a candidate — it heals 0", () => {
    const start = board({ p1: [AT_130, AT_30], p2: [AT_130] });
    const { state: done, events } = playBianca(start);
    expect(done.phase.kind).toBe("turn:action");
    expect(events.filter((e) => e.type === "HEALED")).toHaveLength(0);
    expect(events.map((e) => e.type)).toContain("TRAINER_PLAYED");
  });

  it("PARKS on two in-window bodies, and the CAPTION names the window", () => {
    const start = board({ p1: [AT_130, AT_30, AT_30], p2: [AT_130] });
    const { state: parked } = playBianca(start);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    // The 130-HP ACTIVE is out and both 30-HP Benched bodies are in — the zone
    // word is ABSENT on this card, so the Active is excluded by the WINDOW alone.
    expect(parked.phase.prompt.candidates).toHaveLength(2);
    for (const c of parked.phase.prompt.candidates) expect(c.spot.spot).toBe("bench");
    expect(parked.phase.prompt.note).toBe(
      "Heal which of your Pokémon that has 30 HP or less remaining?",
    );
  });
});

describe("D349 §4 — the shared predicate, asserted as shared", () => {
  it("ONE board answers BOTH windows the same way — the arithmetic is not copied", () => {
    const seeded = board({ p1: [LEDYBA, AT_130], p2: [AT_130, AT_130, AT_130] });
    const both = damage(damage(seeded, "p1", 1, 110), "p2", 1, 110);

    // (a) the HEAL side: p1's Ledyba has 60 remaining (out) and the benched 130
    // has 20 (in), so the play forces onto the one body rather than parking.
    const withHeal = toHand(both, BIANCA);
    const healed = apply(withHeal.state, {
      type: "playTrainer",
      seat: "p1",
      uid: withHeal.uid,
    });
    expect(healed.state.phase.kind).toBe("turn:action");
    expect(healed.state.players.p1.bench[0]?.damage).toBe(0);

    const withLedian = toHand(both, LEDIAN);
    const gusted = takeLoneGust(
      apply(withLedian.state, {
        type: "evolve",
        seat: "p1",
        uid: withLedian.uid,
        target: { spot: "active" },
      }),
    );
    expect(gusted.state.phase.kind).toBe("turn:action");
    expect(gusted.events.map((e) => e.type)).toContain("POKEMON_SWITCHED");
    expect(gusted.state.players.p2.active?.damage).toBe(110);
  });

  it("the gust window is measured against the OPPONENT's body, not the actor's", () => {
    const start = board({ p1: [LEDYBA, LEDYBA], p2: [AT_130, AT_130] });
    const withCard = toHand(start, LEDIAN);
    const { state: done, events } = apply(withCard.state, {
      type: "evolve",
      seat: "p1",
      uid: withCard.uid,
      target: { spot: "active" },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(events.map((e) => e.type)).not.toContain("POKEMON_SWITCHED");
  });
});

describe("D349 §5 — `programPlayable`: the offer and the refusal cannot disagree", () => {
  it("the SUPPORTER is REFUSED when nothing is inside the window", () => {
    const start = board({ p1: [AT_130, AT_130], p2: [AT_130] });
    const withCard = toHand(start, BIANCA);
    const result = applyAction(withCard.state, {
      type: "playTrainer",
      seat: "p1",
      uid: withCard.uid,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the play to be refused");
    expect(result.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("…and the refused play costs the turn NOTHING — the Supporter is still there", () => {
    const start = board({ p1: [AT_130, AT_130], p2: [AT_130] });
    const withCard = toHand(start, BIANCA);
    const refused = applyAction(withCard.state, {
      type: "playTrainer",
      seat: "p1",
      uid: withCard.uid,
    });
    expect(refused.ok).toBe(false);
    // The SAME state now given a body inside the window plays the card, which is
    // what proves the refusal above was about the window and not about the turn.
    const rescued = damage(withCard.state, "p1", 0, 110);
    const played = applyAction(rescued, { type: "playTrainer", seat: "p1", uid: withCard.uid });
    expect(played.ok).toBe(true);
  });

  it("BEHAVIOUR-PRESERVING: an UNNARROWED heal is still playable on a full-HP board", () => {
    const start = board({ p1: [AT_130, AT_130], p2: [AT_130] });
    const withCard = toHand(start, POTION);
    const played = applyAction(withCard.state, {
      type: "playTrainer",
      seat: "p1",
      uid: withCard.uid,
    });
    expect(played.ok).toBe(true);
  });
});

describe("D349 §6 — the pool and the registry, asserted by id", () => {
  it("NOTHING this slice defines reached `FIXTURE_POOL`", () => {
    for (const id of [...LEDIAN_IDS, ...BIANCA_IDS, LEDYBA, AT_90, AT_130, AT_30]) {
      expect(Object.hasOwn(FIXTURE_POOL, id), `${id} leaked into FIXTURE_POOL`).toBe(false);
    }
  });

  it("the SIX ids are CONTIGUOUS registry keys, in order — the permanent half", () => {
    const raw = registryCardIds();
    const at = raw.indexOf(LEDIAN_IDS[0]);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(raw.slice(at, at + 6)).toEqual([...LEDIAN_IDS, ...BIANCA_IDS]);
  });

  it("all SIX real ids are registry keys, and none of the four demonstrators is", () => {
    const keys = new Set(registryCardIds());
    for (const id of [...LEDIAN_IDS, ...BIANCA_IDS]) expect(keys.has(id), id).toBe(true);
    for (const id of [LEDYBA, AT_90, AT_130, AT_30]) expect(keys.has(id), id).toBe(false);
  });
});
