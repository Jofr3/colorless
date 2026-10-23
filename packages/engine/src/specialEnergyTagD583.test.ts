import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { energyProvidesOf, isBasicEnergy, isSpecialEnergy, matchesFilter } from "./cards";
import type { GameState } from "./index";
import { applyAction, createGame } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  basicEnergy,
  battler,
  deckOf,
  specialEnergy,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D583 — A SPECIAL ENERGY IS ONE THAT PRINTS RULES TEXT, WHATEVER tcgdex TAGS IT ──
//
// tcgdex tags `energyType: "Normal"` on 14 Standard-legal Energy printings that print rules text:
// all 11 `me` Special Energies and three `sv` ones (Reversal `sv04-266`, Prism `sv10.5b-086`,
// Ignition `sv10.5w-086`). Measured on the LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`),
// 2026-10-07:
//
//   SELECT id, name, effect FROM cards
//    WHERE category = 'Energy' AND energy_type = 'Normal' AND effect NOT IN ('');   -- 14 rows, all legal
//   SELECT energy_type, COUNT(*) FROM cards
//    WHERE category = 'Energy' AND (effect IS NULL OR effect = '') GROUP BY 1;     -- Normal|52, no Special
//
// So the text separates the catalog exactly: 52 Basic Energy rows print none, and all 29 rows that
// print text (14 tagged Normal + 15 tagged Special) are Special Energy. The schema's own doc says
// the same (`Card.effect`: "null on basic energies").
//
// MEASURED BEFORE THE FIX (engine 0.466.0, `isSpecialEnergy` = `energyType === "Special"`): each of
// the 14 faces below answered `isSpecialEnergy` false and matched the `basicEnergy` filter, so a
// "Basic Energy" search offered Prism Energy (§3) and a Special-only reader skipped it. Their
// PROVISION was right all along — the registry keys Reversal / Prism / Ignition (and, since D582,
// `me02-124` / `me02.5-216`) by id (continuous.ts `providedEnergy`), and the census's Special
// Energy column splits by `category`, which is how they were counted built.
//
// The fix is the ENGINE predicate (so a persisted `GameState.cardPool` holding the old tag is read
// right) plus the ingest (`apps/api/src/ingest/map.ts` writes "Special" for an Energy that prints
// text); neither D1 is re-ingested here.

/** [id, name, effect] — the 14 faces, verbatim off the LOCAL D1 (`energy_type` is `Normal` on each). */
const MISTAGGED: readonly (readonly [string, string, string])[] = [
  [
    "me02-124",
    "Ignition Energy",
    "If this card is attached to 1 of your Pokémon, discard it at the end of your turn.\n\nAs long as this card is attached to a Pokémon, it provides {C} Energy.\n\nIf this card is attached to an Evolution Pokémon, it provides {C}{C}{C} Energy instead.",
  ],
  [
    "me02.5-216",
    "Prism Energy",
    "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nIf this card is attached to a Basic Pokémon, this card provides every type of Energy but provides only 1 Energy at a time.",
  ],
  [
    "me02.5-217",
    "Team Rocket's Energy",
    "This card can only be attached to a Team Rocket's Pokémon. If this card is attached to anything other than a Team Rocket's Pokémon, discard this card.\n\nAs long as this card is attached to a Pokémon, it provides 2 in any combination of {P} Energy and {D} Energy.",
  ],
  [
    "me03-086",
    "Growing Grass Energy",
    "As long as this card is attached to a Pokémon, it provides {G} Energy.\nThe {G} Pokémon this card is attached to gets +20 HP.",
  ],
  [
    "me03-087",
    "Rocky Fighting Energy",
    "As long as this card is attached to a Pokémon, it provides {F} Energy.\nPrevent all effects of attacks used by your opponent's Pokémon done to the {F} Pokémon this card is attached to. (Existing effects are not removed. Damage is not an effect.)",
  ],
  [
    "me03-088",
    "Telepathic Psychic Energy",
    "As long as this card is attached to a Pokémon, it provides {P} Energy.\nWhen you attach this card from your hand to a {P} Pokémon, search your deck for up to 2 Basic {P} Pokémon and put them onto your Bench. Then, shuffle your deck.",
  ],
  [
    "me04-084",
    "Bubbly Water Energy",
    "As long as this card is attached to a Pokémon, it provides {W} Energy.\n\nThe {W} Pokémon this card is attached to recovers from all Special Conditions and can't be affected by any Special Conditions.",
  ],
  [
    "me04-085",
    "Magnetic Metal Energy",
    "As long as this card is attached to a Pokémon, it provides {M} Energy.\n\nThe {M} Pokémon this card is attached to has no Retreat Cost.",
  ],
  [
    "me04-086",
    "Nitro Fire Energy",
    "As long as this card is attached to a Pokémon, it provides {R} Energy.\n\nIf this card is discarded by an effect of an attack used by the {R} Pokémon this card is attached to, put this card into your hand after attack damage and effects.",
  ],
  [
    "me05-083",
    "Shadowy Darkness Energy",
    "As long as this card is attached to a Pokémon, it provides {D} Energy.\n\nAs long as the {D} Pokémon this card is attached to is on your Bench, prevent all damage done to it by attacks from your opponent's Pokémon.",
  ],
  [
    "me05-084",
    "Voltaic Lightning Energy",
    "As long as this card is attached to a Pokémon, it provides {L} Energy.\n\nAttacks used by the {L} Pokémon this card is attached to do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
  ],
  [
    "sv04-266",
    "Reversal Energy",
    "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nIf you have more Prize cards remaining than your opponent, and if this card is attached to an Evolution Pokémon that doesn't have a Rule Box (Pokémon ex, Pokémon V, etc. have Rule Boxes), this card provides every type of Energy but provides only 3 Energy at a time.",
  ],
  [
    "sv10.5b-086",
    "Prism Energy",
    "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nIf this card is attached to a Basic Pokémon, this card provides every type of Energy but provides only 1 Energy at a time.",
  ],
  [
    "sv10.5w-086",
    "Ignition Energy",
    "If this card is attached to 1 of your Pokémon, discard it at the end of your turn.\n\nAs long as this card is attached to a Pokémon, it provides {C} Energy.\n\nIf this card is attached to an Evolution Pokémon, it provides {C}{C}{C} Energy instead.",
  ],
];

/** The catalog face exactly as tcgdex hands it today: a Special Energy tagged "Normal". */
const asCatalog = (id: string, name: string, effect: string): Card => ({
  ...specialEnergy(id, name, effect),
  energyType: "Normal",
});

describe("D583 §1 — the 14 Normal-tagged Special Energies, read as the catalog stores them", () => {
  it("are 11 `me` + 3 `sv` printings (Reversal, Prism, Ignition)", () => {
    expect(MISTAGGED).toHaveLength(14);
    expect(MISTAGGED.filter(([id]) => id.startsWith("me"))).toHaveLength(11);
    expect(MISTAGGED.filter(([id]) => id.startsWith("sv")).map(([, name]) => name)).toEqual([
      "Reversal Energy",
      "Prism Energy",
      "Ignition Energy",
    ]);
  });

  it("each is a Special Energy and never a Basic one", () => {
    for (const [id, name, effect] of MISTAGGED) {
      const card = asCatalog(id, name, effect);
      expect(isSpecialEnergy(card), id).toBe(true);
      expect(isBasicEnergy(card), id).toBe(false);
      expect(matchesFilter(card, { kind: "specialEnergy" }), id).toBe(true);
      expect(matchesFilter(card, { kind: "basicEnergy" }), id).toBe(false);
      expect(matchesFilter(card, { kind: "pokemonOrBasicEnergy" }), id).toBe(false);
      // An unauthored Special falls back to one {C}, whatever its name parses to.
      expect(energyProvidesOf(card), id).toBe("Colorless");
    }
  });

  it("a whitespace-only `effect` is no rules text: the card stays Basic", () => {
    const card: Card = { ...typedEnergy("d583-ws", "Fire"), effect: " \n " };
    expect(isSpecialEnergy(card)).toBe(false);
    expect(isBasicEnergy(card)).toBe(true);
  });
});

describe("D583 §2 — Basic Energy stays Basic; a Special tagged Special stays Special", () => {
  it("both catalog spellings of a Basic Energy, and the unnamed fixture", () => {
    for (const card of [
      typedEnergy("sve-002", "Fire"),
      { ...typedEnergy("sv06.5-098", "Darkness"), name: "Basic Darkness Energy" },
      basicEnergy("fix-energy"),
    ]) {
      expect(isSpecialEnergy(card), card.id).toBe(false);
      expect(isBasicEnergy(card), card.id).toBe(true);
      expect(matchesFilter(card, { kind: "basicEnergy" }), card.id).toBe(true);
    }
    expect(
      matchesFilter(typedEnergy("sve-002", "Fire"), { kind: "basicEnergy", energyType: "Fire" }),
    ).toBe(true);
    expect(
      energyProvidesOf({ ...typedEnergy("sv06.5-098", "Darkness"), name: "Basic Darkness Energy" }),
    ).toBe("Darkness");
  });

  it("a Special tagged Special (Team Rocket's Energy `sv10-182`), with or without text", () => {
    for (const card of [
      specialEnergy("sv10-182", "Team Rocket's Energy"),
      specialEnergy("fix-special", "x", "x"),
    ]) {
      expect(isSpecialEnergy(card), card.id).toBe(true);
      expect(isBasicEnergy(card), card.id).toBe(false);
    }
  });

  it("no non-Energy card is either", () => {
    const pokemon = battler("d583-mon");
    expect([isSpecialEnergy(pokemon), isBasicEnergy(pokemon)]).toEqual([false, false]);
  });
});

// ── §3 ON A BOARD: a "Basic Energy" search never offers Prism Energy ──

const PRISM = "sv10.5b-086";
const FIRE = "d583-fire";
const FILLER = "d583-filler";
const POOL: Record<string, Card> = {
  ...FIXTURE_POOL,
  [PRISM]: asCatalog(PRISM, "Prism Energy", MISTAGGED.find(([id]) => id === PRISM)?.[2] ?? ""),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [FILLER]: battler(FILLER, { hp: 900 }),
};
const DECK = deckOf({ "sv01-172": 4, [FILLER]: 36, [PRISM]: 16, [FIRE]: 4 });

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function p1Turn(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find(
      (h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic",
    );
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const)
    state = must(applyAction(state, { type: "setupReady", seat: s }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

describe('D583 §3 — Energy Search `sv01-172` ("a Basic Energy card") over a deck holding Prism Energy', () => {
  it("offers the Basic Fire Energy and never the Normal-tagged Prism Energy", () => {
    let state = p1Turn(5831);
    const side = state.players.p1;
    const search = [...side.hand, ...side.deck].find(
      (u) => state.cardIdByUid[u] === "sv01-172",
    ) as string;
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...side,
          hand: [...side.hand.filter((u) => u !== search), search],
          deck: side.deck.filter((u) => u !== search),
        },
      },
    };
    const deckIds = state.players.p1.deck.map((u) => state.cardIdByUid[u]);
    expect(deckIds).toContain(PRISM);
    expect(deckIds).toContain(FIRE);
    const parked = must(applyAction(state, { type: "playTrainer", seat: "p1", uid: search }));
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const offered = new Set(prompt.candidates.map((u) => parked.cardIdByUid[u]));
    expect([...offered]).toEqual([FIRE]);
  });
});

// ── §3b ON A BOARD: "Attach a Basic Energy card from your hand" never attaches Prism Energy ──

const ATTACHER = "d583-attacher";
const ATTACH_POOL: Record<string, Card> = {
  ...POOL,
  [ATTACHER]: battler(ATTACHER, {
    hp: 900,
    attacks: [
      {
        cost: [],
        name: "Wrapped in Wind",
        effect: "Attach a Basic Energy card from your hand to this Pokémon.",
      },
    ],
  }),
};
const ATTACH_DECK = deckOf({ [ATTACHER]: 40, [PRISM]: 20 });

describe("D583 §3b — the interpreter's hand attach (`attachableEnergies`) over a hand holding only Prism Energy", () => {
  it("attaches nothing: Prism Energy is not a Basic Energy card", () => {
    const created = createGame({
      seed: 5832,
      decks: { p1: ATTACH_DECK, p2: ATTACH_DECK },
      cardPool: ATTACH_POOL,
    });
    if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
    let state = created.state;
    if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
    state = must(
      applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
    );
    while (state.phase.kind === "setup:drawExtra") {
      const phase = state.phase;
      const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
      if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
      state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
    }
    for (const s of ["p1", "p2"] as const) {
      const uid = state.players[s].hand.find((h) => state.cardIdByUid[h] === ATTACHER);
      if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
      state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
    }
    for (const s of ["p1", "p2"] as const)
      state = must(applyAction(state, { type: "setupReady", seat: s }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    const side = state.players.p1;
    const all = [...side.hand, ...side.deck];
    const prism = all.find((u) => state.cardIdByUid[u] === PRISM) as string;
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...side, hand: [prism], deck: all.filter((u) => u !== prism) },
      },
    };
    const after = must(applyAction(state, { type: "attack", seat: "p1", index: 0 }));
    expect(after.players.p1.active?.energy ?? []).not.toContain(prism);
    expect(after.players.p1.hand).toContain(prism);
  });
});

// ── §4 THE `me` ALIAS THE TAG BLOCKED: Team Rocket's Energy `me02.5-217` ──

describe("D583 §4 — Team Rocket's Energy `me02.5-217` is keyed on `sv10-182`'s program", () => {
  it("shares the SAME program object, and its catalog face reads as Special", () => {
    expect(programFor("sv10-182")).toBeDefined();
    expect(programFor("me02.5-217")).toBe(programFor("sv10-182"));
    const [, name, effect] = MISTAGGED.find(([id]) => id === "me02.5-217") ?? ["", "", ""];
    expect(isSpecialEnergy(asCatalog("me02.5-217", name, effect))).toBe(true);
  });
});

// ── §5 ON A BOARD: two DIFFERENT Normal-tagged Specials are two answers, not one ──
//
// interpreter.ts `cardIdentity` keys a Basic Energy on the type it provides (`basic:<type>`) and
// everything else on its catalog id. Before D583 the "Normal" tag alone made Prism and Reversal
// Energy both `basic:Colorless`, so "Discard an Energy from this Pokémon" over the two collapsed to
// ONE representative and resolved with no prompt; since D583 they are two candidates.

const REVERSAL = "sv04-266";
const DISCARDER = "d583-discarder";
const DISCARD_POOL: Record<string, Card> = {
  ...POOL,
  [REVERSAL]: asCatalog(
    REVERSAL,
    "Reversal Energy",
    MISTAGGED.find(([id]) => id === REVERSAL)?.[2] ?? "",
  ),
  [DISCARDER]: battler(DISCARDER, {
    hp: 900,
    attacks: [{ cost: [], name: "Shed", effect: "Discard an Energy from this Pokémon." }],
  }),
};
const DISCARD_DECK = deckOf({ [DISCARDER]: 40, [PRISM]: 10, [REVERSAL]: 10 });

/** P1's first turn with `ids` (one uid each, out of the deck) attached to its Active. */
function discardBoard(seed: number, ids: readonly string[]): GameState {
  const created = createGame({
    seed,
    decks: { p1: DISCARD_DECK, p2: DISCARD_DECK },
    cardPool: DISCARD_POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => state.cardIdByUid[h] === DISCARDER);
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const)
    state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  const side = state.players.p1;
  const active = side.active;
  if (active === null) throw new Error("no p1 Active");
  const energy: string[] = [];
  let deck = [...side.deck];
  for (const id of ids) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`no ${id} in p1's deck`);
    energy.push(uid);
    deck = deck.filter((u) => u !== uid);
  }
  return {
    ...state,
    players: { ...state.players, p1: { ...side, deck, active: { ...active, energy } } },
  };
}

describe("D583 §5 — `cardIdentity`: Prism and Reversal Energy are two answers to a one-Energy discard", () => {
  it("Prism + Reversal attached: the discard parks on BOTH (no longer one `basic:Colorless` class)", () => {
    const state = discardBoard(5833, [PRISM, REVERSAL]);
    const after = must(applyAction(state, { type: "attack", seat: "p1", index: 0 }));
    if (after.phase.kind !== "effect:choose")
      throw new Error(`expected a park, got ${after.phase.kind}`);
    const prompt = after.phase.prompt;
    if (prompt.kind !== "discardEnergy")
      throw new Error(`expected discardEnergy, got ${prompt.kind}`);
    expect(prompt.discardable.map((d) => after.cardIdByUid[d.uid]).sort()).toEqual([
      REVERSAL,
      PRISM,
    ]);
    expect(after.players.p1.active?.energy).toHaveLength(2);
  });

  it("control — two copies of the SAME print still collapse to one, and the discard resolves with no prompt", () => {
    const state = discardBoard(5834, [PRISM, PRISM]);
    const after = must(applyAction(state, { type: "attack", seat: "p1", index: 0 }));
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(after.players.p1.active?.energy ?? []).toHaveLength(1);
  });
});
