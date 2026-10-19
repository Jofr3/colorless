import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { normalizeCardText } from "./cardText";
import {
  deriveAttackDamageMultiplier,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  discardScaledBoostProgram,
} from "./effects";
import type { GameEvent, GameState } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  specialEnergy,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D597 — WP29: THE DISCARD-SCALED ATTACKS ──
//
// 8 printed attack texts / 18 `me` printings, every id and text measured on the LOCAL D1,
// 2026-10-08, `legal_standard = 1`; no id was referenced in the tree before this slice except
// Mega Diancie ex's three (registry-keyed on `COPPERAJAH_EX` for its Ability; its attack derives)
// and `me02-013` (megaEvolutionRuleD582.test.ts's Mega Charizard X ex). No `me` row is a fixture,
// so the printed faces used on a board are carried HERE.
//   • effects.ts `COMMA_DISCARD_SCALED_DAMAGE` (arm 10d): Inferno X ×4 (Mega Charizard X ex `me02`),
//     Garland Ray ×3 (Mega Diancie ex), Steel Cutter (Skarmory `me05-060`), Double Eater (Mawile
//     `me03-032`).
//   • `milledCardFilter`'s typed Basic noun: Hammer-lanche ×2 (Mega Abomasnow ex), Iceberg Breaker
//     (Avalugg `me04-024`).
//   • `deriveAttackDiscardScaledBoost`'s `handDiscard` member: Shooting Moons ×4 (Mega Clefable ex;
//     "Luminous Wing" stays unbuilt).
//   • registry.ts `INFERNO_X`: the two `mep` Inferno X, whose text prints tcgdex's "[R]".
//     [🆕🆕🆕 D612: RETIRED — WP06's normaliser reads "[R]" as {R} (at ingest and in cards.ts
//     `cardOfUid`), so both printings play the comma arm off their text (R-IX1 resolved).]

const T = {
  infernoX:
    "Discard any amount of {R} Energy from among your Pokémon, and this attack does 90 damage for each card you discarded in this way.",
  infernoXBracket:
    "Discard any amount of [R] Energy from among your Pokémon, and this attack does 90 damage for each card you discarded in this way.",
  garlandRay:
    "Discard up to 2 Energy cards from this Pokémon, and this attack does 120 damage for each card you discarded in this way.",
  steelCutter:
    "Discard up to 2 Basic {M} Energy cards from your hand, and this attack does 40 damage for each card you discarded in this way.",
  doubleEater:
    "Discard up to 2 Energy cards from your hand, and this attack does 60 damage for each card you discarded in this way.",
  hammerLanche:
    "Discard the top 6 cards of your deck, and this attack does 100 damage for each Basic {W} Energy card that you discarded in this way.",
  icebergBreaker:
    "Discard the top 6 cards of your deck, and this attack does 60 damage for each Basic {W} Energy card you discarded in this way.",
  shootingMoons:
    "You may discard up to 4 Energy cards from your hand, and this attack does 40 more damage for each card you discarded in this way.",
} as const;

const CHARIZARD_ME02 = ["me02-013", "me02-109", "me02-125", "me02-130"];
const CHARIZARD_MEP = ["mep-023", "mep-029"];
const DIANCIE = ["me02-041", "me02.5-267", "me02.5-282"];
const ABOMASNOW = ["me01-036", "me01-157"];
const CLEFABLE = ["mep-072", "me03-031", "me03-103", "me03-119"];

/** [text, legal `me` printings, the ids] — the seven reader-built rows. */
const ROWS: readonly (readonly [string, number, readonly string[]])[] = [
  [T.infernoX, 4, CHARIZARD_ME02],
  [T.garlandRay, 3, DIANCIE],
  [T.steelCutter, 1, ["me05-060"]],
  [T.doubleEater, 1, ["me03-032"]],
  [T.hammerLanche, 2, ABOMASNOW],
  [T.icebergBreaker, 1, ["me04-024"]],
  [T.shootingMoons, 4, CLEFABLE],
];

const INFERNO_PROGRAM = [
  {
    op: "discardEnergy",
    from: "yours",
    filter: { kind: "providesEnergy", energyType: "Fire" },
    count: "any",
    recordAs: "discarded",
  },
  { op: "damageDefender", per: 90, count: "discarded" },
];

describe("D597 §1 — the eight sentences and their readings", () => {
  it("each reader row is the `me` corpus's row at its printing count, none printed in `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n, ids] of ROWS) {
      // 🆕🆕🆕 D612 — Inferno X's row is 6: the two `mep` "[R]" printings normalise into it (WP06).
      expect([text, me.get(text)]).toEqual([text, text === T.infernoX ? n + CHARIZARD_MEP.length : n]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
      expect(ids).toHaveLength(n);
    }
    expect(ROWS.reduce((sum, [, n]) => sum + n, 0)).toBe(16);
    for (const id of CHARIZARD_MEP) expect(programFor(id)?.attack, id).toBeUndefined(); // 🆕🆕🆕 D612
    // Only Mega Diancie ex is registry-keyed (its Ability, `COPPERAJAH_EX`), and with no attack entry.
    for (const [, , ids] of ROWS) {
      for (const id of ids) expect(programFor(id)?.attack, id).toBeUndefined();
    }
    for (const id of DIANCIE) expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
  });

  it("Inferno X: any amount of {R} from the whole own board, 90 per card", () => {
    expect(deriveAttackEffect(T.infernoX)).toEqual(INFERNO_PROGRAM);
  });

  it("~~the \"[R]\" Inferno X ×2 is unread, and keyed BY ID on `INFERNO_X`~~ (🆕🆕🆕 D612: the raw text is still unread, but it normalises to the `{R}` sentence and the key is retired)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    // 🆕🆕🆕 D612 (D539): the corpus no longer prints "[R]" (WP06's re-ingest); the raw text a persisted
    // face may still carry is unread by the readers, and the normaliser turns it into the `{R}` sentence.
    expect(me.get(T.infernoXBracket)).toBeUndefined();
    expect(resolvedByAnyReader(T.infernoXBracket)).toBe(false);
    expect(normalizeCardText(T.infernoXBracket)).toBe(T.infernoX);
    for (const id of CHARIZARD_MEP) expect(programFor(id), id).toBeUndefined();
  });

  it("Garland Ray: up to 2 of ANY Energy off the attacking body, 120 per card", () => {
    expect(deriveAttackEffect(T.garlandRay)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "any", cap: 2, recordAs: "discarded" },
      { op: "damageDefender", per: 120, count: "discarded" },
    ]);
  });

  it("Steel Cutter and Double Eater: D489's declinable hand payment at the printed ceiling", () => {
    expect(deriveAttackEffect(T.steelCutter)).toEqual([
      {
        op: "payFromHand",
        count: "any",
        cap: 2,
        to: "discard",
        filter: { kind: "basicEnergy", energyType: "Metal" },
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 40, count: "discarded" },
    ]);
    expect(deriveAttackEffect(T.doubleEater)).toEqual([
      { op: "payFromHand", count: "any", cap: 2, to: "discard", filter: { kind: "anyEnergy" }, recordAs: "discarded" },
      { op: "damageDefender", per: 60, count: "discarded" },
    ]);
  });

  it("Hammer-lanche and Iceberg Breaker: D488's mill, counting Basic {W} Energy only", () => {
    expect(deriveAttackEffect(T.hammerLanche)).toEqual([
      { op: "discardDeckTop", whose: "self", count: 6, recordAs: "discarded" },
      { op: "damageDefender", per: 100, count: "discarded", countFilter: { kind: "basicEnergy", energyType: "Water" } },
    ]);
    expect(deriveAttackEffect(T.icebergBreaker)).toEqual([
      { op: "discardDeckTop", whose: "self", count: 6, recordAs: "discarded" },
      { op: "damageDefender", per: 60, count: "discarded", countFilter: { kind: "basicEnergy", energyType: "Water" } },
    ]);
  });

  it("Shooting Moons: the `handDiscard` member, the printed base kept", () => {
    const reading = deriveAttackDiscardScaledBoost(T.shootingMoons);
    expect(reading).toEqual({ kind: "handDiscard", cap: 4, per: 40 });
    expect(deriveAttackEffect(T.shootingMoons)).toBeNull();
    if (reading === null) throw new Error("unread");
    expect(discardScaledBoostProgram(reading, 120)).toEqual([
      { op: "payFromHand", count: "any", cap: 4, to: "discard", filter: { kind: "anyEnergy" }, recordAs: "discarded" },
      { op: "damageDefender", base: 120, per: 40, count: "discarded" },
    ]);
    // No comma-arm sentence is a boost reading, and the boost sentence is no comma-arm sentence.
    for (const text of [T.infernoX, T.garlandRay, T.steelCutter, T.doubleEater]) {
      expect(deriveAttackDiscardScaledBoost(text), text).toBeNull();
    }
  });
});

describe("D597 §2 — near misses stay null", () => {
  it("the comma arm: a hand discard with no ceiling, the zeros, the `more` fold, other zones and quantifiers", () => {
    const controls = [
      T.doubleEater.replace("up to 2", "any amount of"),
      T.garlandRay.replace("up to 2", "up to 0"),
      T.garlandRay.replace("120 damage", "0 damage"),
      T.garlandRay.replace("120 damage", "120 more damage"),
      T.garlandRay.replace("this Pokémon", "your Benched Pokémon"),
      T.infernoX.replace("any amount of", "all"),
      T.infernoX.replace("{R}", "{C}"),
      `${T.garlandRay} Draw a card.`,
      T.garlandRay.replace("Pokémon, and this attack", "Pokémon. This attack"),
    ];
    for (const text of controls) expect(deriveAttackEffect(text), text).toBeNull();
    // Basic and a code together read as a typed Basic filter.
    expect(deriveAttackEffect(T.infernoX.replace("{R} Energy", "Basic {R} Energy"))?.[0]).toMatchObject({
      op: "discardEnergy",
      filter: { kind: "basicEnergy", energyType: "Fire" },
    });
  });

  it("the typed Basic noun is MILL-ONLY: an unmapped code stays loud, and the pile count does not gain it", () => {
    expect(deriveAttackEffect(T.hammerLanche.replace("{W}", "{C}"))).toBeNull();
    expect(
      deriveAttackDamageMultiplier("This attack does 100 damage for each Basic {W} Energy card in your discard pile."),
    ).toBeNull();
  });

  it("the hand boost: the zeros, no \"You may\", a Basic noun, the period spelling", () => {
    const controls = [
      T.shootingMoons.replace("up to 4", "up to 0"),
      T.shootingMoons.replace("40 more", "0 more"),
      T.shootingMoons.replace("You may discard", "Discard"),
      T.shootingMoons.replace("Energy cards", "Basic Energy cards"),
      T.shootingMoons.replace("hand, and this attack", "hand. This attack"),
    ];
    for (const text of controls) expect(deriveAttackDiscardScaledBoost(text), text).toBeNull();
  });
});

// ── ON A BOARD ──

const CHARIZARD = "me02-013";
const CHARIZARD_KEYED = "mep-023";
const DIANCIE_ID = "me02-041";
const SKARMORY = "me05-060";
const MAWILE = "me03-032";
const ABOMASNOW_ID = "me01-036";
const AVALUGG = "me04-024";
const CLEFABLE_ID = "me03-031";
const FILLER = "d597-filler"; // a {C} Basic, 900 HP
const FIRE = "d597-fire";
const WATER = "d597-water";
const PSYCHIC = "d597-psychic";
const METAL = "d597-metal";
const SPECIAL = "d597-special";

const body = (id: string, name: string, attack: Partial<NonNullable<Card["attacks"]>[number]>, extra: Partial<Card> = {}) =>
  battler(id, { name, hp: 360, retreat: 2, attacks: [attack as NonNullable<Card["attacks"]>[number]], ...extra } as Partial<Card>);

const LOCAL: Record<string, Card> = {
  [CHARIZARD]: body(CHARIZARD, "Mega Charizard X ex", { cost: ["Fire", "Fire"], name: "Inferno X", damage: "90×", effect: T.infernoX }),
  [CHARIZARD_KEYED]: body(CHARIZARD_KEYED, "Mega Charizard X ex", {
    cost: ["Fire", "Fire"],
    name: "Inferno X",
    damage: "90×",
    effect: T.infernoXBracket,
  }),
  [DIANCIE_ID]: body(DIANCIE_ID, "Mega Diancie ex", { cost: ["Psychic", "Psychic"], name: "Garland Ray", damage: "120×", effect: T.garlandRay }),
  [SKARMORY]: body(SKARMORY, "Skarmory", { cost: ["Metal"], name: "Steel Cutter", damage: "40×", effect: T.steelCutter }),
  [MAWILE]: body(MAWILE, "Mawile", { cost: ["Psychic", "Colorless"], name: "Double Eater", damage: "60×", effect: T.doubleEater }),
  [ABOMASNOW_ID]: body(ABOMASNOW_ID, "Mega Abomasnow ex", {
    cost: ["Water", "Water"],
    name: "Hammer-lanche",
    damage: "100×",
    effect: T.hammerLanche,
  }),
  [AVALUGG]: body(AVALUGG, "Avalugg", { cost: ["Water"], name: "Iceberg Breaker", damage: "60×", effect: T.icebergBreaker }),
  [CLEFABLE_ID]: body(CLEFABLE_ID, "Mega Clefable ex", {
    cost: ["Psychic", "Psychic"],
    name: "Shooting Moons",
    damage: "120+",
    effect: T.shootingMoons,
  }),
  [FILLER]: battler(FILLER, { name: "D597 Filler", hp: 900, types: ["Colorless"], retreat: 1 }),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [WATER]: typedEnergy(WATER, "Water"),
  [PSYCHIC]: typedEnergy(PSYCHIC, "Psychic"),
  [METAL]: typedEnergy(METAL, "Metal"),
  [SPECIAL]: specialEnergy(SPECIAL, "D597 Special"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [FILLER]: 12,
  [CHARIZARD]: 2,
  [CHARIZARD_KEYED]: 2,
  [DIANCIE_ID]: 2,
  [SKARMORY]: 2,
  [MAWILE]: 2,
  [ABOMASNOW_ID]: 2,
  [AVALUGG]: 2,
  [CLEFABLE_ID]: 2,
  [FIRE]: 8,
  [WATER]: 8,
  [PSYCHIC]: 6,
  [METAL]: 4,
  [SPECIAL]: 4,
  "fix-energy": 2,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup (P2 first), then P1's turn 4 with both hands and Prizes back in the decks (D596's idiom). */
function p1Turn(): GameState {
  const created = createGame({ seed: 5971, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const hand = state.players[s].hand;
    const uid =
      hand.find((h) => state.cardIdByUid[h] === FILLER) ??
      hand.find((h) => POOL[state.cardIdByUid[h] ?? ""]?.category === "Pokemon");
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    state = {
      ...state,
      players: { ...state.players, [s]: { ...side, hand: [], prizes: [], deck: [...side.deck, ...side.hand, ...side.prizes] } },
    };
  }
  return state;
}

/** Move `count` copies of `cardId` from P1's deck onto P1's Active. */
function onActive(state: GameState, cardId: string, count: number): GameState {
  const side = state.players.p1;
  const uids = side.deck.filter((u) => state.cardIdByUid[u] === cardId).slice(0, count);
  if (uids.length < count || side.active === null) throw new Error(`cannot attach ${count} ${cardId}`);
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        deck: side.deck.filter((u) => !uids.includes(u)),
        active: { ...side.active, energy: [...side.active.energy, ...uids] },
      },
    },
  };
}

/** Move `count` copies of `cardId` from P1's deck into P1's hand. */
function toHand(state: GameState, cardId: string, count: number): GameState {
  const side = state.players.p1;
  const uids = side.deck.filter((u) => state.cardIdByUid[u] === cardId).slice(0, count);
  if (uids.length < count) throw new Error(`cannot hand ${count} ${cardId}`);
  return {
    ...state,
    players: { ...state.players, p1: { ...side, deck: side.deck.filter((u) => !uids.includes(u)), hand: [...side.hand, ...uids] } },
  };
}

/** Put P1's deck in the order `top` (card ids, one copy each), then the rest. */
function stackTop(state: GameState, top: readonly string[]): GameState {
  const side = state.players.p1;
  const rest = [...side.deck];
  const picked: string[] = [];
  for (const id of top) {
    const at = rest.findIndex((u) => state.cardIdByUid[u] === id);
    if (at < 0) throw new Error(`no ${id} left in the deck`);
    picked.push(rest.splice(at, 1)[0] as string);
  }
  return { ...state, players: { ...state.players, p1: { ...side, deck: [...picked, ...rest] } } };
}

/** P1's `active` with `paid` copies of `energy` on it and `bench` FILLERs; P2 a FILLER Active and no Bench. */
function table(active: string, energy: string, paid: number, bench = 0): GameState {
  let state = p1Turn();
  state = clearBench(setActiveFromDeck(state, "p1", active), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
  for (let i = 0; i < bench; i++) state = benchFromDeck(state, "p1", FILLER);
  return onActive(state, energy, paid);
}

const swing = (state: GameState) => mustApply(state, { type: "attack", seat: "p1", index: 0 });
const of = <K extends GameEvent["type"]>(events: readonly GameEvent[], type: K) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: K }>[];
const dealt = (events: readonly GameEvent[]) => of(events, "DAMAGE_DEALT")[0]?.dealt ?? 0;
const idsOf = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);

function discardPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "discardEnergy") throw new Error(`expected discardEnergy, got ${prompt.kind}`);
  return prompt;
}
function handPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
  return prompt;
}
const answerDiscard = (state: GameState, uids: readonly string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "discardEnergy", uids: [...uids] } });
const answerCards = (state: GameState, uids: readonly string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [...uids] } });

describe("D597 §3 — Inferno X: {R} Energy from the whole own board", () => {
  function board(active: string): GameState {
    let state = table(active, FIRE, 2, 1);
    state = attachBenchFromDeck(state, "p1", 0, FIRE, 2);
    return attachBenchFromDeck(state, "p1", 0, "fix-energy", 1);
  }

  it("offers the four {R} on the Active AND the Bench (never the {C}), and deals 90 per card discarded", () => {
    const parked = swing(board(CHARIZARD)).state;
    const prompt = discardPrompt(parked);
    expect(prompt.discardable).toHaveLength(4);
    expect(new Set(idsOf(parked, prompt.discardable.map((d) => d.uid)))).toEqual(new Set([FIRE]));
    expect(prompt.note).toBe("Discard any amount of Fire Energy from your Pokémon.");
    const picks = prompt.discardable.map((d) => d.uid).slice(0, 3);
    const { state: done, events } = answerDiscard(parked, picks);
    expect(dealt(events)).toBe(270);
    expect(done.players.p1.discard).toEqual(expect.arrayContaining(picks));
  });

  it("declining discards nothing and deals 0 — the printed 90× is not dealt", () => {
    const parked = swing(board(CHARIZARD)).state;
    const { events } = answerDiscard(parked, []);
    expect(of(events, "DAMAGE_DEALT")).toHaveLength(0);
    expect(of(events, "ENERGY_DISCARDED")).toHaveLength(0);
  });

  it("the keyed \"[R]\" printing `mep-023` plays the same program (🆕🆕🆕 D612: unkeyed — its raw face, as a persisted pre-D612 pool holds it, is read through `cardOfUid`'s normaliser)", () => {
    const parked = swing(board(CHARIZARD_KEYED)).state;
    const prompt = discardPrompt(parked);
    expect(prompt.discardable).toHaveLength(4);
    expect(dealt(answerDiscard(parked, prompt.discardable.map((d) => d.uid)).events)).toBe(360);
  });
});

describe("D597 §4 — Garland Ray: up to 2 Energy off the attacking body", () => {
  it("offers the Active's Energy only, at most 2, and deals 120 per card", () => {
    let state = table(DIANCIE_ID, PSYCHIC, 2, 1);
    state = onActive(state, SPECIAL, 1);
    state = attachBenchFromDeck(state, "p1", 0, PSYCHIC, 2);
    const parked = swing(state).state;
    const prompt = discardPrompt(parked);
    expect(prompt.discardable).toHaveLength(3);
    expect(prompt.scope).toEqual({ kind: "upTo", max: 2 });
    expect(idsOf(parked, prompt.discardable.map((d) => d.uid)).sort()).toEqual([PSYCHIC, PSYCHIC, SPECIAL].sort());
    const special = prompt.discardable.map((d) => d.uid).find((u) => parked.cardIdByUid[u] === SPECIAL) as string;
    const psychic = prompt.discardable.map((d) => d.uid).find((u) => parked.cardIdByUid[u] === PSYCHIC) as string;
    const { state: done, events } = answerDiscard(parked, [special, psychic]);
    expect(dealt(events)).toBe(240);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(2);
    expect(dealt(answerDiscard(parked, [psychic]).events)).toBe(120);
  });
});

describe("D597 §5 — Steel Cutter and Double Eater: the declinable hand payment", () => {
  it("Steel Cutter offers Basic {M} only, at most 2, 40 per card; declining deals 0", () => {
    let state = table(SKARMORY, METAL, 1);
    state = toHand(toHand(toHand(state, METAL, 3), FIRE, 1), SPECIAL, 1);
    const parked = swing(state).state;
    const prompt = handPrompt(parked);
    expect(new Set(idsOf(parked, prompt.candidates))).toEqual(new Set([METAL]));
    expect(prompt.max).toBe(2);
    expect(prompt.min).toBe(0);
    const { state: done, events } = answerCards(parked, prompt.candidates.slice(0, 2));
    expect(dealt(events)).toBe(80);
    expect(done.players.p1.hand).toHaveLength(3);
    expect(of(answerCards(parked, []).events, "DAMAGE_DEALT")).toHaveLength(0);
  });

  it("Double Eater offers any Energy card (the Special too), 60 per card", () => {
    let state = table(MAWILE, PSYCHIC, 2);
    state = toHand(toHand(state, FIRE, 1), SPECIAL, 1);
    const parked = swing(state).state;
    const prompt = handPrompt(parked);
    expect(new Set(idsOf(parked, prompt.candidates))).toEqual(new Set([FIRE, SPECIAL]));
    expect(dealt(answerCards(parked, prompt.candidates.slice(0, 2)).events)).toBe(120);
  });

  it("an empty hand asks nothing and deals 0", () => {
    const { state, events } = swing(table(MAWILE, PSYCHIC, 2));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(of(events, "DAMAGE_DEALT")).toHaveLength(0);
  });
});

describe("D597 §6 — Hammer-lanche and Iceberg Breaker: Basic {W} Energy among the top 6", () => {
  it("Hammer-lanche: 3 Basic {W} among the six milled → 300; the Special and the Fire do not count", () => {
    let state = table(ABOMASNOW_ID, WATER, 2);
    state = stackTop(state, [WATER, FIRE, WATER, SPECIAL, FILLER, WATER, WATER]);
    const { state: done, events } = swing(state);
    expect(dealt(events)).toBe(300);
    expect(idsOf(done, done.players.p1.discard)).toEqual(expect.arrayContaining([WATER, FIRE, SPECIAL, FILLER]));
    // The seventh card (a {W}) stays on top of the deck.
    expect(done.players.p1.deck[0] === undefined ? undefined : done.cardIdByUid[done.players.p1.deck[0]]).toBe(WATER);
  });

  it("Iceberg Breaker: 60 per Basic {W}; none milled deals 0", () => {
    let state = table(AVALUGG, WATER, 1);
    state = stackTop(state, [WATER, FILLER, FILLER, WATER, FIRE, FIRE]);
    expect(dealt(swing(state).events)).toBe(120);
    let dry = table(AVALUGG, WATER, 1);
    dry = stackTop(dry, [FIRE, FILLER, FILLER, FIRE, SPECIAL, FIRE]);
    expect(of(swing(dry).events, "DAMAGE_DEALT")).toHaveLength(0);
  });
});

describe("D597 §7 — Shooting Moons: up to 4 Energy cards from the hand, 40 more each", () => {
  it("2 discarded → 120 + 80; declining keeps the printed 120", () => {
    let state = table(CLEFABLE_ID, PSYCHIC, 2);
    state = toHand(toHand(state, FIRE, 2), SPECIAL, 1);
    const parked = swing(state).state;
    const prompt = handPrompt(parked);
    expect(prompt.candidates).toHaveLength(3);
    expect(prompt.max).toBe(3);
    expect(dealt(answerCards(parked, prompt.candidates.slice(0, 2)).events)).toBe(200);
    expect(dealt(answerCards(parked, []).events)).toBe(120);
  });

  it("the ceiling is the printed 4", () => {
    let state = table(CLEFABLE_ID, PSYCHIC, 2);
    state = toHand(state, FIRE, 6);
    const parked = swing(state).state;
    const prompt = handPrompt(parked);
    expect(prompt.max).toBe(4);
    expect(dealt(answerCards(parked, prompt.candidates.slice(0, 4)).events)).toBe(280);
  });
});

describe("D597 §8 — the version", () => {
  it("is built at engine 0.544.0", () => {
    expect(engineVersion).toBe("0.544.0");
  });
});
