import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  specialEnergy,
  typedEnergy,
  must,
  firstBasicInHand,
} from "./testFixtures";

const HEATMOR = "sv10.5w-019";
const HEATMOR_REPRINT = "sv10.5w-104";
const PRINTED =
  "Search your deck for up to 3 in any combination of {R} Pokémon and Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.";
const HEATMOR_IDX1_NAME = "Fire Claws";

const FIRE_BASIC = "fix-d338lc-fire-basic";
const FIRE_STAGE2 = "fix-d338lc-fire-stage2";
const FIRE_PREFIXED = "fix-d338lc-fire-prefixed";
const LIGHTNING_BASIC = "fix-d338lc-lightning-basic";
const FIRE_ENERGY = "fix-d338lc-fire-energy";
const GRASS_ENERGY = "fix-d338lc-grass-energy";
const SPECIAL = "fix-d338lc-special";
const WALL = "fix-d338lc-wall";
const FILLER = "fix-d338lc-filler";

const LOCAL_CARDS: Record<string, Card> = {
  [HEATMOR]: battler(HEATMOR, {
    name: "Heatmor",
    hp: 110,
    retreat: 2,
    types: ["Fire"],
    attacks: [
      { cost: ["Fire"], name: "Licking Catch", effect: PRINTED },
      { cost: ["Fire", "Fire"], name: HEATMOR_IDX1_NAME, damage: 60 },
    ],
  }),
  [HEATMOR_REPRINT]: battler(HEATMOR_REPRINT, {
    name: "Heatmor",
    hp: 110,
    retreat: 2,
    types: ["Fire"],
    attacks: [
      { cost: ["Fire"], name: "Licking Catch", effect: PRINTED },
      { cost: ["Fire", "Fire"], name: HEATMOR_IDX1_NAME, damage: 60 },
    ],
  }),
  [FIRE_BASIC]: battler(FIRE_BASIC, { name: "Litwick", types: ["Fire"], hp: 70 }),
  /** A {R} **STAGE 2**. **ADMITTED**, and it is the card that separates the printed
      *"{R} Pokémon"* from `stage: "basic"` — the rider a plausible build adds and
      the print does not carry (three other registry rows on this filter DO use it). */
  [FIRE_STAGE2]: battler(FIRE_STAGE2, {
    name: "Chandelure",
    stage: "Stage2",
    evolveFrom: "Lampent",
    types: ["Fire"],
    hp: 300,
  }),
  [FIRE_PREFIXED]: battler(FIRE_PREFIXED, {
    name: "Ethan's Cyndaquil",
    types: ["Fire"],
    hp: 70,
  }),
  [LIGHTNING_BASIC]: battler(LIGHTNING_BASIC, {
    name: "Ethan's Pichu",
    types: ["Lightning"],
    hp: 60,
  }),
  [FIRE_ENERGY]: typedEnergy(FIRE_ENERGY, "Fire"),
  [GRASS_ENERGY]: typedEnergy(GRASS_ENERGY, "Grass"),
  [SPECIAL]: specialEnergy(SPECIAL, "D338 Special Energy"),
  [WALL]: battler(WALL, {
    name: "D338 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "D338 Filler",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [HEATMOR]: 2,
  [HEATMOR_REPRINT]: 2,
  [FIRE_BASIC]: 4,
  [FIRE_STAGE2]: 2,
  [FIRE_PREFIXED]: 2,
  [LIGHTNING_BASIC]: 2,
  [FIRE_ENERGY]: 20,
  [GRASS_ENERGY]: 4,
  [SPECIAL]: 4,
  [WALL]: 4,
  [FILLER]: 14,
});

const ATTACK = { type: "attack", seat: "p1", index: 0 } as const;

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
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

/** TEST SURGERY — `count` Fire Energy onto p1's Active, taken off the deck so every
    uid stays in exactly one zone. "Licking Catch" costs a single {R}. */
function fuel(state: GameState, count: number): GameState {
  const side = state.players.p1;
  const body = side.active;
  if (body === null) throw new Error("p1 has no Active");
  const energy = side.deck.filter((u) => state.cardIdByUid[u] === FIRE_ENERGY).slice(0, count);
  if (energy.length < count) throw new Error(`deck lacks ${count} ${FIRE_ENERGY}`);
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        active: { ...body, energy: [...body.energy, ...energy] },
        deck: side.deck.filter((u) => !energy.includes(u)),
      },
    },
  };
}

/** A board with Heatmor Active for p1 on p1's turn, a 330 HP Wall opposite, and one
    filler body on each Bench. The DECK is the whole search zone, so nothing needs
    seeding into a window — what is in the deck is what is offered. */
function board(seed: number, opts: { attacker?: string; energy?: number } = {}): GameState {
  let state = localSetup(seed, "p2");
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", FILLER);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", opts.attacker ?? HEATMOR);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", FILLER);
  return fuel(state, opts.energy ?? 1);
}

/** The uids in p1's DECK carrying `id`. */
function deckUids(state: GameState, id: string): string[] {
  return state.players.p1.deck.filter((uid) => state.cardIdByUid[uid] === id);
}

/** Declare "Licking Catch" and return the parked `chooseCards` prompt with it. The
    attack has no cost op, so the FIRST park is the search. */
function attack(state: GameState) {
  const result = applyAction(state, ATTACK);
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  const parked = result.state;
  if (parked.phase.kind !== "effect:choose") {
    throw new Error(`expected effect:choose, got ${parked.phase.kind}`);
  }
  if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
  return { parked, prompt: parked.phase.prompt, events: [...result.events] };
}

describe("D338 — Heatmor 'Licking Catch', a flat cap over a TYPED union", () => {
  // ── §1 THE PRINTED SHAPE, READ OFF THE REGISTRY BEFORE ANY BOARD RUNS ──────

  it("the registry resolves a program for BOTH printings", () => {
    for (const id of [HEATMOR, HEATMOR_REPRINT]) expect(programFor(id), id).toBeDefined();
  });

  it("the two printings share ONE program object — a reprint, not two authorings", () => {
    expect(programFor(HEATMOR_REPRINT)).toBe(programFor(HEATMOR));
  });

  it("the program is `anyOf` under a FLAT cap — and carries NO `also`", () => {
    const op = programFor(HEATMOR)?.attack?.[0]?.[0];
    if (op?.op !== "searchDeck") throw new Error("expected a searchDeck op");
    expect(op).toEqual({
      op: "searchDeck",
      filter: {
        kind: "anyOf",
        filters: [
          { kind: "typedPokemon", pokemonType: "Fire" },
          { kind: "basicEnergy", energyType: "Fire" },
        ],
      },
      dest: "hand",
      max: 3,
      reveal: true,
    });
    expect(op.also).toBeUndefined();
  });

  it("the row is TWO ops and the second is the printed trailing shuffle", () => {
    expect(programFor(HEATMOR)?.attack?.[0]).toHaveLength(2);
    expect(programFor(HEATMOR)?.attack?.[0]?.[1]).toEqual({ op: "shuffleDeck" });
  });

  it("the `typedPokemon` member carries NO `stage` — the print names none", () => {
    const op = programFor(HEATMOR)?.attack?.[0]?.[0];
    if (op?.op !== "searchDeck") throw new Error("expected a searchDeck op");
    if (op.filter.kind !== "anyOf") throw new Error("expected an anyOf filter");
    const [pokemon] = op.filter.filters;
    if (pokemon?.kind !== "typedPokemon") throw new Error("expected typedPokemon first");
    expect(pokemon.stage).toBeUndefined();
    expect(pokemon.pokemonType).toBe("Fire");
    expect(pokemon.maxHp).toBeUndefined();
  });

  it("INDEX-PRECISION — index 0 is authored and index 1 'Fire Claws' is NOT", () => {
    expect(programFor(HEATMOR)?.attack?.[0]).toBeDefined();
    expect(programFor(HEATMOR)?.attack?.[1]).toBeUndefined();
    const printed = LOCAL_CARDS[HEATMOR]?.attacks?.[1];
    expect(printed?.name).toBe(HEATMOR_IDX1_NAME);
    expect(printed?.effect).toBeUndefined();
  });

  it("the program authors NO non-attack surface — it is attack-only", () => {
    expect(Object.keys(programFor(HEATMOR) ?? {})).toEqual(["attack"]);
  });

  // ── §2 THE UNION — WHAT IT ADMITS AND WHAT IT REFUSES ─────────────────────

  it("offers BOTH members — a {R} Pokémon and a Basic {R} Energy", () => {
    const state = board(3);
    const { prompt, parked } = attack(state);
    expect(prompt.candidates).toContain(deckUids(parked, FIRE_BASIC)[0]);
    expect(prompt.candidates).toContain(deckUids(parked, FIRE_ENERGY)[0]);
  });

  it("admits a {R} STAGE 2 — the printed noun carries no stage", () => {
    const state = board(4);
    const { prompt, parked } = attack(state);
    expect(prompt.candidates).toContain(deckUids(parked, FIRE_STAGE2)[0]);
  });

  it("admits an OWNER-PREFIXED {R} Pokémon — the noun is TYPE-narrowed only", () => {
    const state = board(5);
    const { prompt, parked } = attack(state);
    expect(prompt.candidates).toContain(deckUids(parked, FIRE_PREFIXED)[0]);
  });

  it("REFUSES a {L} Pokémon — the printed {R} on the first member", () => {
    const state = board(6);
    const { prompt, parked } = attack(state);
    expect(prompt.candidates).not.toContain(deckUids(parked, LIGHTNING_BASIC)[0]);
  });

  it("REFUSES a Basic Energy of another type — the printed {R} on the second member", () => {
    const state = board(7);
    const { prompt, parked } = attack(state);
    expect(prompt.candidates).not.toContain(deckUids(parked, GRASS_ENERGY)[0]);
  });

  it('REFUSES a SPECIAL Energy — the printed "Basic"', () => {
    const state = board(8);
    const { prompt, parked } = attack(state);
    expect(prompt.candidates).not.toContain(deckUids(parked, SPECIAL)[0]);
  });

  it("REFUSES a {C} Pokémon — the Wall and the filler are in the deck too", () => {
    // The population control: the deck holds plenty of Pokémon this filter must
    // not offer, so "it offered a Pokémon" and "it offered a {R} Pokémon" are
    // different boards.
    const state = board(9);
    const { prompt, parked } = attack(state);
    expect(prompt.candidates).not.toContain(deckUids(parked, FILLER)[0]);
    expect(prompt.candidates).not.toContain(deckUids(parked, WALL)[0]);
  });

  // ── §3 THE FLAT CAP — THE ANSWERS THAT SEPARATE IT FROM `also` ────────────

  it("the cap is 3 over the WHOLE union, and the pick is optional", () => {
    const state = board(10);
    const { prompt } = attack(state);
    expect(prompt.max).toBe(3);
    expect(prompt.min).toBe(0);
  });

  it("takes THREE {R} POKÉMON and nothing else — the answer `also` would refuse", () => {
    const state = board(11);
    const { parked } = attack(state);
    const picks = deckUids(parked, FIRE_BASIC).slice(0, 3);
    expect(picks).toHaveLength(3);
    const { state: after } = mustResolve(parked, picks);
    for (const uid of picks) expect(after.players.p1.hand).toContain(uid);
  });

  it("takes THREE BASIC {R} ENERGY and nothing else — the union's other extreme", () => {
    const state = board(12);
    const { parked } = attack(state);
    const picks = deckUids(parked, FIRE_ENERGY).slice(0, 3);
    expect(picks).toHaveLength(3);
    const { state: after } = mustResolve(parked, picks);
    for (const uid of picks) expect(after.players.p1.hand).toContain(uid);
  });

  it("takes a MIXTURE — two Pokémon and one Energy, the printed 'combination'", () => {
    const state = board(13);
    const { parked } = attack(state);
    const picks = [
      ...deckUids(parked, FIRE_BASIC).slice(0, 2),
      ...deckUids(parked, FIRE_ENERGY).slice(0, 1),
    ];
    expect(picks).toHaveLength(3);
    const { state: after } = mustResolve(parked, picks);
    for (const uid of picks) expect(after.players.p1.hand).toContain(uid);
  });

  it("a FOURTH card is refused — the flat cap really is a cap", () => {
    const state = board(14);
    const { parked } = attack(state);
    const picks = deckUids(parked, FIRE_ENERGY).slice(0, 4);
    expect(picks).toHaveLength(4);
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: picks },
    });
    expect(result.ok).toBe(false);
  });

  it("taking NOTHING is legal and still shuffles — `min: 0`", () => {
    const state = board(15);
    const { parked } = attack(state);
    const { events } = mustResolve(parked, []);
    expect(find(events, "SHUFFLE")).toBeDefined();
  });

  // ── §4 THE CAPTION — `retrieveNoun`'s FOURTH WITNESS ON THIS JOIN ─────────

  it("the caption is the `anyOf` join, with the brace code WRITTEN OUT", () => {
    const state = board(16);
    const { prompt } = attack(state);
    expect(prompt.note).toBe(
      "Search your deck for up to 3 Fire Pokémon or Basic Fire Energy cards into your hand.",
    );
  });

  it("the caption spells NO serial comma — this is the single-group arm", () => {
    const state = board(17);
    const { prompt } = attack(state);
    expect(prompt.note).not.toContain(", and ");
    expect(prompt.note).not.toContain(" and ");
    expect(prompt.note).toContain(" or ");
  });

  it("the caption does NOT quote the printed brace code", () => {
    const state = board(18);
    const { prompt } = attack(state);
    expect(prompt.note).not.toContain("{R}");
    expect(PRINTED).toContain("{R}");
  });

  // ── §5 THE EPILOGUE — REVEAL, DESTINATION AND THE PRINTED SHUFFLE ─────────

  it("the search REVEALS — the printed 'reveal them' rides on the op", () => {
    const state = board(19);
    const { parked } = attack(state);
    const picks = deckUids(parked, FIRE_BASIC).slice(0, 2);
    const { events } = mustResolve(parked, picks);
    const searched = find(events, "DECK_SEARCHED");
    expect(searched?.reveal).toBe(true);
    expect(searched?.dest).toBe("hand");
  });

  it("the taken cards LEAVE the deck — they move, they are not copied", () => {
    const state = board(20);
    const { parked } = attack(state);
    const picks = deckUids(parked, FIRE_STAGE2).slice(0, 1);
    const { state: after } = mustResolve(parked, picks);
    for (const uid of picks) {
      expect(after.players.p1.hand).toContain(uid);
      expect(after.players.p1.deck).not.toContain(uid);
    }
  });

  it('the deck is SHUFFLED after the search — the printed "Then, shuffle your deck"', () => {
    const state = board(21);
    const { parked } = attack(state);
    const { events } = mustResolve(parked, deckUids(parked, FIRE_ENERGY).slice(0, 1));
    expect(find(events, "SHUFFLE")).toBeDefined();
  });

  it("the attack deals NO damage — the print carries no damage on index 0", () => {
    // The Wall is 330 HP and untouched: this attack's whole printed effect is the
    // search, and a build that let the plain damage path run underneath it would
    // show up here and nowhere else in the file.
    const state = board(22);
    const { parked } = attack(state);
    const { state: after } = mustResolve(parked, deckUids(parked, FIRE_ENERGY).slice(0, 1));
    expect(after.players.p2.active?.damage ?? 0).toBe(0);
    expect(LOCAL_CARDS[HEATMOR]?.attacks?.[0]?.damage).toBeUndefined();
  });

  // ── §6 THE REPRINT AND THE ATTRIBUTION CONTROL ───────────────────────────

  it("the REPRINT runs the identical program on a real board", () => {
    const state = board(23, { attacker: HEATMOR_REPRINT });
    const { prompt, parked } = attack(state);
    expect(prompt.max).toBe(3);
    expect(prompt.candidates).toContain(deckUids(parked, FIRE_BASIC)[0]);
    expect(prompt.candidates).not.toContain(deckUids(parked, LIGHTNING_BASIC)[0]);
  });

  it("the ATTRIBUTION CONTROL — the deck really did hold what was refused", () => {
    const state = board(24);
    const { parked } = attack(state);
    for (const id of [LIGHTNING_BASIC, GRASS_ENERGY, SPECIAL, FILLER]) {
      expect(deckUids(parked, id).length, id).toBeGreaterThan(0);
    }
  });
});

/** Answer the parked search with `uids` and hand back the state and events. */
function mustResolve(state: GameState, uids: string[]) {
  const result = applyAction(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids },
  });
  if (!result.ok) throw new Error(`resolve failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: [...result.events] };
}
