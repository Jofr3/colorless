import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect, splitAttackGateClause } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, programFor } from "./index";
import type { GameState, Seat } from "./index";
import {
  completeSetup,
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
} from "./testFixtures";

const BARE =
  "Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.";
const GATED = `If you go first, you can use this attack during your first turn. ${BARE}`;
const COMPOUND =
  "Switch this Pokémon with 1 of your Benched Pokémon. If you do, search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.";
const OTHER_BODY: readonly string[] = [];
const MULTI_BODY =
  "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.";

const BODY_CHOICE =
  "Search your deck for a card that evolves from 1 of your Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.";

function eevee(id: string): Card {
  return battler(id, {
    name: "Eevee",
    hp: 50,
    retreat: 1,
    types: ["Colorless"],
    attacks: [
      { cost: ["Colorless"], name: "Ascension", effect: BARE },
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Quick Attack",
        damage: "20+",
        effect: "Flip a coin. If heads, this attack does 20 more damage.",
      },
    ],
  });
}

function exeggcute(id: string): Card {
  return battler(id, {
    name: "Exeggcute",
    hp: 30,
    retreat: 1,
    types: ["Grass"],
    attacks: [{ cost: ["Colorless"], name: "Precocious Evolution", effect: GATED }],
  });
}

function stage1From(id: string, from: string, hp: number): Card {
  return {
    ...battler(id, { hp, retreat: 1, types: ["Colorless"] }),
    stage: "Stage1",
    evolveFrom: from,
  };
}

const LOCAL_CARDS: Record<string, Card> = {
  "sv06-135": eevee("sv06-135"),
  "sv06-188": eevee("sv06-188"),
  "sv08-001": exeggcute("sv08-001"),
  "asc-vaporeon": stage1From("asc-vaporeon", "Eevee", 110),
  /** A frail Stage 1 off Eevee — 60 HP, so a Bravery Charm'd Eevee carrying 100
      damage survives as a Basic (50 + 50 = 110) and is Knocked Out the instant it
      evolves. `placeEvolution`'s own doc names exactly this reachability story. */
  "asc-frail": stage1From("asc-frail", "Eevee", 60),
  "asc-exeggutor": stage1From("asc-exeggutor", "Exeggcute", 120),
  /** Arboliva `sv01-023` "Enriching Oil" — the registry's on-evolve TRIGGER,
      re-pointed at Eevee so one board can play it BOTH ways. The program is the
      registry's (keyed by id); only the chain datum is local. */
  "sv01-023": { ...FIXTURE_POOL["sv01-023"], evolveFrom: "Eevee" } as Card,
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const ASCENSION_DECK = deckOf({
  "sv06-135": 4,
  "sv08-001": 4,
  "asc-vaporeon": 4,
  "asc-frail": 4,
  "asc-exeggutor": 4,
  "sv01-023": 4,
  "sv02-173": 4,
  "fix-basic-1": 8,
  "fix-energy": 24,
});

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: ASCENSION_DECK, p2: ASCENSION_DECK },
    cardPool: POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  state = completeSetup(state);
  return state;
}

/** TEST SURGERY — every copy of `cardId` leaves the seat's deck (to the bottom of
    the DISCARD, so the deck count is still honest about what is searchable). Used
    to build the WHIFF board and the single-candidate board. */
function stripDeck(state: GameState, seat: Seat, cardIds: readonly string[]): GameState {
  const side = state.players[seat];
  const drop = new Set(cardIds);
  const removed = side.deck.filter((uid) => drop.has(state.cardIdByUid[uid] ?? ""));
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((uid) => !drop.has(state.cardIdByUid[uid] ?? "")),
        discard: [...side.discard, ...removed],
      },
    },
  };
}

/** TEST SURGERY — all but ONE copy of `cardId` leaves the seat's deck, so the
    single-candidate park can be built without depending on how the shuffle
    distributed the four copies between deck, hand and prizes. */
function keepOneInDeck(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const copies = side.deck.filter((uid) => state.cardIdByUid[uid] === cardId);
  const drop = new Set(copies.slice(1));
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((uid) => !drop.has(uid)),
        discard: [...side.discard, ...copies.slice(1)],
      },
    },
  };
}

/** Pass whole turns until `turn`, leaving the actor in `turn:action`. */
function passTo(state: GameState, turn: number): GameState {
  let next = state;
  while (next.turn < turn) {
    if (next.phase.kind !== "turn:action") {
      throw new Error(`unexpected ${next.phase.kind} while passing to turn ${turn}`);
    }
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

/** p1 with `activeId` Active, ONE bench body (§14.2 — an empty Bench makes the
    Active's Knock Out a LOSS, and a `gameOver` board proves nothing) and one {C}
    attached. p2 goes FIRST and ends their turn, so p1 attacks on turn 2. */
function board(seed: number, activeId = "sv06-135"): GameState {
  let state = localSetup(seed, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", activeId);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", "fix-basic-1");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** Declare the printed attack at `index` and hand back whatever it left behind. */
function declare(state: GameState, index = 0): GameState {
  return mustApply(state, { type: "attack", seat: "p1", index }).state;
}

function cardsPrompt(state: GameState) {
  const phase = state.phase;
  if (phase.kind !== "effect:choose" || phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected a chooseCards park, got ${phase.kind}`);
  }
  return phase.prompt;
}

function resolve(state: GameState, uids: readonly string[]): GameState {
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids: [...uids] },
  }).state;
}

function topId(state: GameState, seat: Seat): string {
  const active = state.players[seat].active;
  if (active === undefined || active === null) throw new Error(`${seat} has no Active`);
  const uid = active.stack[active.stack.length - 1];
  return state.cardIdByUid[uid ?? ""] ?? "";
}

function candidateIds(state: GameState, uids: readonly string[]): string[] {
  return uids.map((uid) => state.cardIdByUid[uid] ?? "").sort();
}

describe("D307 §1 — the reader: ONE anchor, TWO summands, and three deliberate refusals", () => {
  it("the bare sentence derives to the two-op program, and NOTHING else is in it", () => {
    expect(deriveAttackEffect(BARE)).toEqual([{ op: "evolveFromDeck" }, { op: "shuffleDeck" }]);
  });

  it("the LICENSED printing is refused WHOLE and derives once the gate clause is split", () => {
    expect(deriveAttackEffect(GATED)).toBeNull();
    const split = splitAttackGateClause(GATED);
    expect(split?.body).toBe(BARE);
    expect(deriveAttackEffect(split?.body ?? "")).toEqual([
      { op: "evolveFromDeck" },
      { op: "shuffleDeck" },
    ]);
    expect(programFor("sv08-001")?.attackGate?.[0]).toEqual({ kind: "firstTurnExempt" });
  });

  it("the printed COMPOUND is refused — the anchor's `^…$` is load-bearing", () => {
    expect(deriveAttackEffect(COMPOUND)).toBeNull();
    expect(COMPOUND.includes(BARE.slice(1))).toBe(true);
    expect(COMPOUND.endsWith(BARE)).toBe(false);
  });

  it("the ONE remaining OTHER-BODY sentence is refused — this op names a pronoun", () => {
    for (const text of OTHER_BODY) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    expect(deriveAttackEffect(BODY_CHOICE)).toEqual([
      { op: "evolveFromDeckChosen" },
      { op: "shuffleDeck" },
    ]);
    expect(deriveAttackEffect(MULTI_BODY)).toEqual([
      { op: "evolveFromDeckEachChosen", max: 2, pokemonType: "Darkness" },
      { op: "shuffleDeck" },
    ]);
  });
});

describe("D307 §2 — the printed attack on a real board", () => {
  it("Ascension PARKS on the deck's evolutions, and only on them", () => {
    const parked = declare(board(11));
    const prompt = cardsPrompt(parked);
    expect(prompt.dest).toBe("evolve");
    // "Up to" — the printed decline, and the printed article: ONE card.
    expect(prompt.min).toBe(0);
    expect(prompt.max).toBe(1);
    expect(prompt.note).toContain("evolves from Eevee");
    // Exactly the deck cards whose `evolveFrom` is this body's top card NAME —
    // `asc-exeggutor` (off Exeggcute) is in the same deck and is NOT offered,
    // which is what makes the filter a measurement rather than "everything".
    expect(new Set(candidateIds(parked, prompt.candidates))).toEqual(
      new Set(["asc-vaporeon", "asc-frail", "sv01-023"]),
    );
  });

  it("resolving it EVOLVES the attacker, and the stack keeps its history", () => {
    const parked = declare(board(11));
    const pick = cardsPrompt(parked).candidates.find(
      (uid) => parked.cardIdByUid[uid] === "asc-vaporeon",
    );
    expect(pick).toBeDefined();
    const done = resolve(parked, [pick ?? ""]);
    expect(topId(done, "p1")).toBe("asc-vaporeon");
    expect(done.players.p1.active?.stack.length).toBe(2);
    // …and the card really left the deck rather than being copied out of it.
    expect(done.players.p1.deck).not.toContain(pick);
  });

  it("§10's carry-over comes with it — this is `placeEvolution`'s own body", () => {
    // The extraction (`types.ts evolveOnto`) is the SAME code the hand route runs,
    // so the deck route cannot drift by forgetting a clear. Energy and damage stay
    // on the stack; `turnPlayed` resets.
    let state = board(12);
    state = setDamage(state, "p1", 20);
    const parked = declare(state);
    const placedOn = parked.turn;
    const pick = cardsPrompt(parked).candidates.find(
      (uid) => parked.cardIdByUid[uid] === "asc-vaporeon",
    );
    const done = resolve(parked, [pick ?? ""]);
    const active = done.players.p1.active;
    expect(active?.damage).toBe(20);
    expect(active?.energy.length).toBe(1);
    // The turn the placement LANDED on, not `done.turn` — resolving the pick ends
    // the attacker's turn (§5.3), so the board has already moved on by the time
    // this is read. The stamp is what stops the new body evolving again.
    expect(active?.turnPlayed).toBe(placedOn);
    expect(active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
  });

  it("a POKEMON_EVOLVED event is filed, and no DECK_SEARCHED is", () => {
    const parked = declare(board(13));
    const pick = cardsPrompt(parked).candidates[0];
    const applied = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [pick ?? ""] },
    });
    const types = applied.events.map((event: GameEvent) => event.type);
    expect(types).toContain("POKEMON_EVOLVED");
    expect(types).not.toContain("DECK_SEARCHED");
  });

  it("the DECLINE and the WHIFF are both silent no-ops, and both still shuffle", () => {
    const declined = resolve(declare(board(14)), []);
    expect(topId(declined, "p1")).toBe("sv06-135");

    // The WHIFF: no card in the deck evolves from Eevee, so there is no park at
    // all — the op returns the state untouched and the attack runs on.
    let barren = board(15);
    barren = stripDeck(barren, "p1", ["asc-vaporeon", "asc-frail", "sv01-023"]);
    const after = declare(barren);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(topId(after, "p1")).toBe("sv06-135");
  });

  it("a SINGLE candidate still PARKS — the printed decline is not a no-choice", () => {
    // `searchDeck`'s doctrine, inherited deliberately: the M1 "a choice with no
    // choice in it is not a choice" rule does not reach an "up to", because
    // taking the card and taking nothing are two different states.
    let single = board(16);
    single = stripDeck(single, "p1", ["asc-frail", "sv01-023"]);
    single = keepOneInDeck(single, "p1", "asc-vaporeon");
    const parked = declare(single);
    expect(cardsPrompt(parked).candidates.length).toBe(1);
    expect(cardsPrompt(parked).min).toBe(0);
  });

  it("Exeggcute's LICENSED printing runs the same program through the split", () => {
    let state = board(17, "sv08-001");
    state = stripDeck(state, "p1", ["asc-vaporeon", "asc-frail", "sv01-023"]);
    const parked = declare(state);
    const prompt = cardsPrompt(parked);
    // Compared as a SET: how many copies are still in the deck depends on the
    // opening hand and the prizes, and the claim here is about WHICH card the
    // filter admits, not about how many of it the shuffle left behind.
    expect(new Set(candidateIds(parked, prompt.candidates))).toEqual(new Set(["asc-exeggutor"]));
    expect(prompt.candidates.length).toBeGreaterThan(0);
    const done = resolve(parked, [prompt.candidates[0] ?? ""]);
    expect(topId(done, "p1")).toBe("asc-exeggutor");
  });
});

describe("D307 §3 — the second attack, which a fragment-keyed census would not see", () => {
  it("Eevee's index 1 is Quick Attack and is NOT this program", () => {
    const parked = declare(attachFromDeck(board(18), "p1", "fix-energy", 2), 1);
    // The coin-flip attack resolves synchronously — no park, no evolution.
    expect(parked.phase.kind).not.toBe("effect:choose");
    expect(topId(parked, "p1")).toBe("sv06-135");
  });
});

describe("D307 §4 — the on-evolve TRIGGER: it must not fire from the deck, and DOES from hand", () => {
  it("the DECK route fires NO on-evolve trigger", () => {
    let state = board(19);
    state = stripDeck(state, "p1", ["asc-vaporeon", "asc-frail"]);
    state = setDamage(state, "p1", 20);
    const parked = declare(state);
    const prompt = cardsPrompt(parked);
    expect(candidateIds(parked, prompt.candidates).every((id) => id === "sv01-023")).toBe(true);
    const applied = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [prompt.candidates[0] ?? ""] },
    });
    expect(topId(applied.state, "p1")).toBe("sv01-023");
    expect(applied.events.map((event: GameEvent) => event.type)).not.toContain("ABILITY_TRIGGERED");
    // …and no second park: the whole program finished inside the attack.
    expect(applied.state.phase.kind).not.toBe("effect:choose");
  });

  it("THE ATTRIBUTION CONTROL — the SAME card from HAND on the SAME board DOES fire", () => {
    let state = passTo(board(19), 4);
    state = setDamage(state, "p1", 20);
    state = handFromDeck(state, "p1", "sv01-023", 1);
    const uid = handUid(state, "p1", "sv01-023");
    const applied = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid,
      target: { spot: "active" },
    });
    expect(topId(applied.state, "p1")).toBe("sv01-023");
    expect(applied.events.map((event: GameEvent) => event.type)).toContain("ABILITY_TRIGGERED");
  });
});

describe("D307 §5 — the LETHAL evolve: §8.1 sweeps it, and the attack still finishes", () => {
  it("an evolution that drops max HP below the carried damage is Knocked Out", () => {
    let state = board(20);
    state = handFromDeck(state, "p1", "sv02-173", 1);
    const charm = handUid(state, "p1", "sv02-173");
    state = mustApply(state, {
      type: "attachTool",
      seat: "p1",
      uid: charm,
      target: { spot: "active" },
    }).state;
    state = setDamage(state, "p1", 100);
    state = stripDeck(state, "p1", ["asc-vaporeon", "sv01-023"]);
    // The charmed Basic is ALIVE before the attack — the control that makes the
    // Knock Out below attributable to the EVOLUTION and not to the damage.
    expect(state.players.p1.active?.damage).toBe(100);
    const parked = declare(state);
    const prompt = cardsPrompt(parked);
    const done = resolve(parked, [prompt.candidates[0] ?? ""]);
    // A self-KO prizes to the DEFENDER, exactly as the confusion self-hit's does.
    expect(done.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p2" });
  });

  it("…and the trailing shuffleDeck still ran — the program was not abandoned", () => {
    // The other half of the doubt: a KO that happens MID-program must not stop the
    // ops behind it. The deck is shuffled after the pick, so the op AFTER the
    // lethal placement ran on a board holding a dead body and did not throw.
    let state = board(21);
    state = handFromDeck(state, "p1", "sv02-173", 1);
    const charm = handUid(state, "p1", "sv02-173");
    state = mustApply(state, {
      type: "attachTool",
      seat: "p1",
      uid: charm,
      target: { spot: "active" },
    }).state;
    state = setDamage(state, "p1", 100);
    state = stripDeck(state, "p1", ["asc-vaporeon", "sv01-023"]);
    const parked = declare(state);
    const before = [...parked.players.p1.deck];
    const applied = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [cardsPrompt(parked).candidates[0] ?? ""] },
    });
    expect(applied.events.map((event: GameEvent) => event.type)).toContain("SHUFFLE");
    // The deck is the same MULTISET minus the taken card, in a different order.
    expect(applied.state.players.p1.deck.length).toBe(before.length - 1);
  });
});

describe("D307 §6 — the persisted shape: the op and the dest reach the phase", () => {
  it("the parked continuation stores the new op, and the prompt the new dest", () => {
    const parked = declare(board(22));
    const phase = parked.phase;
    if (phase.kind !== "effect:choose") throw new Error(`expected a park, got ${phase.kind}`);
    expect(phase.cont.pendingOp).toEqual({ op: "evolveFromDeck" });
    expect(phase.cont.rest).toEqual([{ op: "shuffleDeck" }]);
    if (phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(phase.prompt.dest).toBe("evolve");
    // …and the whole phase is JSON, which is what makes the record replayable.
    expect(JSON.parse(JSON.stringify(phase)).cont.pendingOp.op).toBe("evolveFromDeck");
  });

  it("no `GameState` key moved — the literal anchor behind the recorded SKIP", () => {
    const parked = declare(board(24));
    expect(Object.keys(parked).sort()).toEqual([
      "allowances",
      "cardIdByUid",
      "cardPool",
      "firstPlayer",
      "handPlayLockedTurn",
      "lastKoMarks",
      "lastKoTurn",
      "oncePerGameSpent",
      "pending",
      "phase",
      "players",
      "recentAttackers",
      "rngState",
      "stadium",
      "turn",
    ]);
  });

  it("the wire REFUSES a card that is not on the offer", () => {
    // `validateChoice` reads the PROMPT, never the op — so a crafted frame naming
    // a deck card that does not evolve from this body is rejected before the
    // placement is reached.
    const parked = declare(board(23));
    const stranger = parked.players.p1.deck.find(
      (uid) => parked.cardIdByUid[uid] === "asc-exeggutor",
    );
    const rejected = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [stranger ?? ""] },
    });
    expect(rejected.ok).toBe(false);
  });
});
