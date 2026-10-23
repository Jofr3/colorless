import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, programFor } from "./index";
import type { EffectPrompt, GameEvent, GameState, PokemonRef } from "./index";
import { registryCardIds } from "./registry";
import {
  completeSetup,
  FIXTURE_POOL,
  battler,
  deckOf,
  specialEnergy,
  trainerCard,
  typedEnergy,
  must,
} from "./testFixtures";

const ENERGY_COIN = "sv10.5b-081";

const MAGEARNA = "sv09-107";

const ENERGY_COIN_TEXT =
  "Flip 2 coins. If both of them are heads, search your deck for a Basic Energy " +
  "card and attach it to 1 of your Pokémon. Then, shuffle your deck.";

const BODY = "d355-body"; // the Active — a plain Basic, no program, no types claim
const BENCHED = "d355-benched"; // a second target, so "1 of your Pokémon" is a CHOICE
const WATER = "d355-water-energy"; // Basic Energy — the filter is UNQUALIFIED,
const FIRE = "d355-fire-energy"; // …so TWO different types must both be offered
const SPECIAL = "d355-special-energy"; // a SPECIAL Energy — must never be offered
const FILLER = "d355-filler"; // a Pokémon in the deck — must never be offered

const LOCAL_CARDS: Record<string, Card> = {
  [ENERGY_COIN]: trainerCard(ENERGY_COIN, "Item", ENERGY_COIN_TEXT),
  [BODY]: battler(BODY, { name: "D355 Body", hp: 70, types: ["Water"] }),
  [BENCHED]: battler(BENCHED, { name: "D355 Benched", hp: 80, types: ["Fire"] }),
  [WATER]: typedEnergy(WATER, "Water"),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [SPECIAL]: specialEnergy(SPECIAL, "D355 Special Energy"),
  [FILLER]: battler(FILLER, { name: "D355 Filler", hp: 60, types: ["Colorless"] }),
};

const POOL: Record<string, Card> = { ...LOCAL_CARDS };

const DECK = deckOf({
  [ENERGY_COIN]: 4,
  [BODY]: 12,
  [BENCHED]: 8,
  [WATER]: 8,
  [FIRE]: 8,
  [SPECIAL]: 8,
  [FILLER]: 12,
});

const ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const BENCH_0: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }),
  );
  state = completeSetup(state);
  return state;
}

function board(seed: number, deck: readonly string[]): GameState {
  const state = localSetup(seed);
  const side = state.players.p1;
  const rest = [...side.deck, ...side.hand];
  const take = (cardId: string): string => {
    const uid = rest.find((u) => state.cardIdByUid[u] === cardId);
    if (uid === undefined) throw new Error(`p1 has no ${cardId}`);
    rest.splice(rest.indexOf(uid), 1);
    return uid;
  };
  const coin = take(ENERGY_COIN);
  const activeUid = take(BODY);
  const benchUid = take(BENCHED);
  const deckUids = deck.map(take);
  const blank = side.active;
  if (blank === null) throw new Error("setup left p1 with no Active");
  const body = (uid: string) => ({ ...blank, stack: [uid], damage: 0, energy: [], tools: [] });
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        hand: [coin],
        deck: deckUids,
        active: body(activeUid),
        bench: [body(benchUid)],
      },
    },
  };
}

function play(state: GameState): { state: GameState; events: GameEvent[] } {
  const uid = state.players.p1.hand[0];
  if (uid === undefined) throw new Error("p1 holds nothing");
  const result = applyAction(state, { type: "playTrainer", seat: "p1", uid });
  if (!result.ok) throw new Error(`playTrainer failed: ${result.error.code}`);
  return { state: result.state, events: result.events };
}

function facesOf(events: readonly GameEvent[]): string[] {
  return events
    .filter(
      (e): e is Extract<GameEvent, { type: "ATTACK_EFFECT_COIN_FLIP" }> =>
        e.type === "ATTACK_EFFECT_COIN_FLIP",
    )
    .map((e) => e.result);
}

function typesOf(events: readonly GameEvent[]): string[] {
  return events.map((e) => e.type);
}

function promptOf(state: GameState): Extract<EffectPrompt, { kind: "attachCards" }> {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "attachCards") {
    throw new Error(`expected attachCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

function attach(
  state: GameState,
  assignments: { uid: string; to: PokemonRef }[],
): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "attachCards", assignments },
  });
  if (!result.ok) throw new Error(`resolveEffect failed: ${result.error.code}`);
  return { state: result.state, events: result.events };
}

/** The card NAMES of the Energy on a body, so an assertion reads as the print
    does rather than as a uid list. */
function energyNamesOn(state: GameState, ref: PokemonRef): string[] {
  const side = state.players[ref.seat];
  const spot = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  return (spot?.energy ?? []).map((uid) => POOL[state.cardIdByUid[uid] ?? ""]?.name ?? "?");
}

const SEEDS = Array.from({ length: 220 }, (_, i) => i + 1);
const DEFAULT_DECK = [WATER, FIRE, SPECIAL, FILLER];

// ── 1. THE COUNT IS THE PRINTED COUNT, AND EVERY FLIP IS ANNOUNCED ───────────

describe("D355 §1 — `coins` is how many coins the sentence prints", () => {
  it("files EXACTLY TWO coin rows on every board — not one, and not a verdict", () => {
    const widths = new Set<number>();
    for (const seed of SEEDS) {
      const { events } = play(board(seed, DEFAULT_DECK));
      const faces = facesOf(events);
      widths.add(faces.length);
      for (const face of faces) expect(["heads", "tails"]).toContain(face);
      expect(
        events.filter((e) => e.type === "ATTACK_EFFECT_COIN_FLIP").every((e) => e.seat === "p1"),
      ).toBe(true);
    }
    expect([...widths]).toEqual([2]);
  });
});

// ── 2. ALL-HEADS, AND THE TWO MIXED PAIRS THAT ARE THE WHOLE POINT ───────────

describe("D355 §2 — the branch runs IFF the coins are unanimous on heads", () => {
  it("the four face pairs, each driven — and the coverage asserted BEFORE the verdict", () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const state = board(seed, DEFAULT_DECK);
      const { state: after, events } = play(state);
      const faces = facesOf(events);
      seen.add(faces.join("-"));
      const allHeads = faces.every((f) => f === "heads");
      // The gate's ONLY observable: did the search happen? `attachFromDeck` parks,
      // so an all-heads board is in `effect:choose` and every other board is not.
      expect(after.phase.kind === "effect:choose").toBe(allHeads);
      // …and the shuffle rides the same arm (§5 states this as its own claim).
      expect(typesOf(events).includes("SHUFFLE")).toBe(false);
    }
    expect(seen).toEqual(new Set(["heads-heads", "heads-tails", "tails-heads", "tails-tails"]));
  });

  it("HEADS-then-TAILS whiffs — the witness against reading only the FIRST coin", () => {
    const board_ = firstBoardWithFaces(["heads", "tails"]);
    expect(board_.state.phase.kind).not.toBe("effect:choose");
    expect(typesOf(board_.events)).not.toContain("SHUFFLE");
  });

  it("TAILS-then-HEADS whiffs — the witness against reading only the LAST coin", () => {
    const board_ = firstBoardWithFaces(["tails", "heads"]);
    expect(board_.state.phase.kind).not.toBe("effect:choose");
    expect(typesOf(board_.events)).not.toContain("SHUFFLE");
  });

  it("TAILS-TAILS whiffs too — unanimity alone is not the clause", () => {
    const board_ = firstBoardWithFaces(["tails", "tails"]);
    expect(board_.state.phase.kind).not.toBe("effect:choose");
  });

  it("HEADS-HEADS parks on the attach — driven to the Energy actually landing", () => {
    const board_ = firstBoardWithFaces(["heads", "heads"]);
    const prompt = promptOf(board_.state);
    const pick = prompt.candidates[0] as string;
    const { state: done } = attach(board_.state, [{ uid: pick, to: ACTIVE }]);
    expect(energyNamesOn(done, ACTIVE)).toHaveLength(1);
  });
});

/** The FIRST seed in `SEEDS` whose program filed exactly `faces` — so every case
    above is driven on a real board rather than on a stubbed event list, and the
    seed is a RESULT rather than a constant somebody has to keep true. */
function firstBoardWithFaces(faces: readonly string[]): {
  state: GameState;
  events: GameEvent[];
} {
  for (const seed of SEEDS) {
    const played = play(board(seed, DEFAULT_DECK));
    if (facesOf(played.events).join("-") === faces.join("-")) return played;
  }
  throw new Error(`no seed in SEEDS produced ${faces.join("-")}`);
}

// ── 3. THE ONE-COIN FORM IS UNCHANGED, AND IT IS DRIVEN ──────────────────────

describe("D355 §3 — absent `coins` is ONE coin, byte for byte", () => {
  it("every gate authored before this slice still takes exactly one flip", () => {
    for (const id of ["sv01-185", "sv01-178"]) {
      expect(programFor(id)).toBeDefined();
    }
    const program = programFor("sv01-185");
    const gate = program?.trainer?.[0];
    expect(gate?.op).toBe("coinFlipGate");
    expect(gate !== undefined && "coins" in gate).toBe(false);
  });

  it("this card's authored row spells `coins: 2` and nothing else new", () => {
    const program = programFor(ENERGY_COIN);
    expect(program).toBeDefined();
    const gate = program?.trainer?.[0];
    expect(gate).toEqual({
      op: "coinFlipGate",
      coins: 2,
      then: [
        { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 1 },
        { op: "shuffleDeck" },
      ],
    });
    // …and the whole program is that ONE gate: no second sentence, no trailing op.
    expect(program?.trainer).toHaveLength(1);
  });
});

// ── 4. THE ATTACH HALF — ALREADY BUILT, AND PINNED SO IT STAYS THAT WAY ──────

describe("D355 §4 — 'a Basic Energy card' to '1 of your Pokémon'", () => {
  it("offers BOTH Basic Energy types and neither the Special nor the Pokémon", () => {
    // The filter is UNQUALIFIED — "a Basic Energy card", no type named — so a build
    // that copied X-Boot's `energyType` rider from one door down is red here. The
    // Special Energy and the Pokémon in the same deck are the negative half.
    const board_ = firstBoardWithFaces(["heads", "heads"]);
    const prompt = promptOf(board_.state);
    const names = prompt.candidates
      .map((uid) => POOL[board_.state.cardIdByUid[uid] ?? ""]?.name ?? "?")
      .sort();
    expect(names).toEqual(["Fire Energy", "Water Energy"]);
  });

  it("attaches at most ONE, and the ACTIVE is an eligible target", () => {
    // "attach **it** to **1** of your Pokémon" — `max: 1` and NO target rider, so
    // the Active is in the set (a `benchOnly` copied from a neighbour is red here)
    // and the benched body is too.
    const board_ = firstBoardWithFaces(["heads", "heads"]);
    const prompt = promptOf(board_.state);
    expect(prompt.max).toBe(1);
    expect(prompt.targets).toEqual([ACTIVE, BENCH_0]);
  });

  it("the Energy lands on the BENCHED body when that is the answer", () => {
    const board_ = firstBoardWithFaces(["heads", "heads"]);
    const prompt = promptOf(board_.state);
    const pick = prompt.candidates[0] as string;
    const { state: done, events } = attach(board_.state, [{ uid: pick, to: BENCH_0 }]);
    expect(energyNamesOn(done, BENCH_0)).toHaveLength(1);
    expect(energyNamesOn(done, ACTIVE)).toEqual([]);
    expect(typesOf(events)).toContain("SHUFFLE");
  });

  it("a deck holding NO Basic Energy is a live path — it whiffs into the shuffle", () => {
    // `attachFromDeck` has NO `programPlayable` gate, by its own doc: the card
    // prints "Then, shuffle your deck", a clause that always resolves, so "no
    // eligible card" is never "no effect" (ruling/284). The Item is still spent.
    for (const seed of SEEDS) {
      const played = play(board(seed, [SPECIAL, FILLER]));
      if (facesOf(played.events).join("-") !== "heads-heads") continue;
      expect(played.state.phase.kind).not.toBe("effect:choose");
      expect(typesOf(played.events)).toContain("SHUFFLE");
      return;
    }
    throw new Error("no seed in SEEDS produced heads-heads");
  });
});

// ── 5. THE SHUFFLE IS INSIDE THE GATE — POKÉ BALL'S RULING, DRIVEN ───────────

describe("D355 §5 — a losing flip does not touch the deck", () => {
  it("NO shuffle row on any board that is not all-heads", () => {
    let losing = 0;
    for (const seed of SEEDS) {
      const { state: after, events } = play(board(seed, DEFAULT_DECK));
      if (facesOf(events).join("-") === "heads-heads") continue;
      losing += 1;
      expect(typesOf(events)).not.toContain("SHUFFLE");
      expect(after.players.p1.deck).toEqual(board(seed, DEFAULT_DECK).players.p1.deck);
    }
    expect(losing).toBeGreaterThan(0);
  });
});

describe("D355 §6 — the pool and the registry keys", () => {
  it("Energy Coin and Magearna are registry keys", () => {
    const raw = registryCardIds();
    expect(raw).toContain(ENERGY_COIN);
    expect(raw).toContain(MAGEARNA);
  });

  it("the +1 on `raw.length` is EXACTLY this one id — the ONLY real id here", () => {
    const keys = new Set(registryCardIds());
    expect(keys.has(ENERGY_COIN)).toBe(true);
    expect(registryCardIds().filter((id) => id === ENERGY_COIN).length).toBe(1);
    for (const id of Object.keys(LOCAL_CARDS)) {
      if (id === ENERGY_COIN) continue;
      expect(keys.has(id)).toBe(false);
    }
  });

  it("nothing this suite defines reached `FIXTURE_POOL` — asserted by ID", () => {
    for (const id of Object.keys(LOCAL_CARDS)) {
      expect(FIXTURE_POOL[id]).toBeUndefined();
    }
  });
});

describe("D355 §7 — what row 10's closure leaves behind", () => {
  it("ROW 10 IS CLOSED — both halves of it are now built", () => {
    expect(programFor("sv10-145")).toBeDefined();
    expect(programFor(ENERGY_COIN)).toBeDefined();
  });

  it("row 12's ability half is BUILT — this negative is SPENT", () => {
    expect(programFor("sv09-107")).toBeDefined();
  });

  it("the LIVE residue is now ONE, and row 9's three are not it", () => {
    for (const id of ["sv05-158"]) {
      expect(programFor(id)?.trainer?.[0]).toEqual({
        op: "attachFromDiscard",
        filter: { kind: "basicEnergy" },
        max: 1,
        targetBanner: "Future",
        each: true,
      });
    }
    for (const id of ["sv07-135", "sv08.5-110"]) {
      expect(programFor(id)?.trainer?.[0]?.op).toBe("attachFromDiscard");
    }
    expect(programFor("sv06.5-063")?.triggered?.[0]?.trigger).toBe("atEndOfYourTurnInActive");
  });
});
