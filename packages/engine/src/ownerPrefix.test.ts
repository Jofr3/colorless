import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { matchesFilter } from "./cards";
import { resolvedByAnyReader } from "./censusAttackCorpus";
import type { CardFilter } from "./effectTypes";
import { applyAction, programFor } from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  handToDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  specialEnergy,
  trainerCard,
  driveSetup,
} from "./testFixtures";

const CENSUS = [
  { owner: "Team Rocket", effect: 12, attack: 9, ability: 10, total: 31 },
  { owner: "Ethan", effect: 3, attack: 3, ability: 5, total: 11 },
  { owner: "Iono", effect: 0, attack: 1, ability: 5, total: 6 },
  { owner: "N", effect: 2, attack: 4, ability: 0, total: 6 },
  { owner: "Cynthia", effect: 1, attack: 1, ability: 3, total: 5 },
  { owner: "Hop", effect: 3, attack: 0, ability: 2, total: 5 },
  { owner: "Misty", effect: 0, attack: 4, ability: 0, total: 4 },
  { owner: "Arven", effect: 1, attack: 0, ability: 2, total: 3 },
  { owner: "Steven", effect: 1, attack: 1, ability: 1, total: 3 },
  { owner: "Lillie", effect: 1, attack: 1, ability: 0, total: 2 },
  { owner: "Marnie", effect: 1, attack: 0, ability: 1, total: 2 },
  { owner: "Janine", effect: 0, attack: 0, ability: 1, total: 1 },
  { owner: "Xerosic", effect: 0, attack: 1, ability: 0, total: 1 },
] as const;

const LANDED = [
  {
    program: "Champion's Call (Cynthia's Gabite)",
    fixture: "fix-championscall",
    ids: ["sv10-103"],
    legal: 1,
    ops: "searchDeck{ownerPokemon Cynthia, hand, 1} + shuffleDeck — Mesagoza's line with the owner noun",
  },
  {
    program: "Swim Together (Misty's Lapras)",
    fixture: "fix-swimtogether",
    ids: ["sv10-050", "sv10-194"],
    legal: 2,
    ops: "the same two ops at max 3, on the ATTACK path (the deriver has no deck-search anchor at all)",
  },
  {
    program: "Hop's Bag",
    fixture: "fix-hopsbag",
    ids: ["sv09-147"],
    legal: 1,
    ops: "searchDeck{ownerPokemon Hop + stage basic, bench, 2} + shuffleDeck — the first writer of `stage`",
  },
  {
    program: "Summoning Sign (Steven's Baltoy)",
    fixture: "fix-summoningsign",
    ids: ["sv10-083"],
    legal: 1,
    ops: "Hop's Bag's program on an attack, one owner over — a separate const, not a shared object",
  },
  {
    program: "Inviting Flowers (Lillie's Comfey)",
    fixture: "fix-invitingflowers",
    ids: ["sv09-068"],
    legal: 1,
    ops: "the printed 'any number' at max BENCH_MAX, which the bench clamp makes exact rather than approximate",
  },
] as const;

const DROPPED: readonly {
  readonly sentence: string;
  readonly ids: readonly string[];
  readonly legal: number;
  readonly surface: "attack" | "trainer" | "stadium";
  readonly needs: string;
}[] = [];

/** A Pokémon in an owner's subgroup. `name` carries the printed possessive
    prefix; `id` stays synthetic. */
function subgroupBasic(id: string, name: string): Card {
  return battler(id, { name, hp: 70 });
}

function subgroupEvolution(id: string, name: string, from: string): Card {
  return battler(id, { name, hp: 120, stage: "Stage1", evolveFrom: from });
}

const LOCAL_CARDS: Record<string, Card> = {
  // ── The five program carriers.
  "fix-championscall": battler("fix-championscall", {
    name: "Cynthia's Gabite",
    hp: 100,
    stage: "Stage1",
    evolveFrom: "Cynthia's Gible",
    abilities: [
      {
        type: "Ability",
        name: "Champion's Call",
        effect:
          "Once during your turn, you may search your deck for a Cynthia's Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.",
      },
    ],
  }),
  "fix-swimtogether": battler("fix-swimtogether", {
    name: "Misty's Lapras",
    hp: 110,
    attacks: [
      {
        name: "Swim Together",
        cost: ["Water"],
        effect:
          "Search your deck for up to 3 Misty's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
      },
      { name: "Surf", cost: ["Water", "Colorless"], damage: 60 },
    ],
  }),
  "fix-hopsbag": trainerCard(
    "fix-hopsbag",
    "Item",
    "Search your deck for up to 2 Basic Hop's Pokémon and put them onto your Bench. Then, shuffle your deck.",
  ),
  "fix-summoningsign": battler("fix-summoningsign", {
    name: "Steven's Baltoy",
    hp: 60,
    attacks: [
      {
        name: "Summoning Sign",
        cost: ["Colorless"],
        effect:
          "Search your deck for up to 2 Basic Steven's Pokémon and put them onto your Bench. Then, shuffle your deck.",
      },
      { name: "Psychic Sphere", cost: ["Psychic"], damage: 20 },
    ],
  }),
  "fix-invitingflowers": battler("fix-invitingflowers", {
    name: "Lillie's Comfey",
    hp: 70,
    attacks: [
      {
        name: "Inviting Flowers",
        cost: ["Colorless"],
        effect:
          "You may search your deck for any number of Basic Lillie's Pokémon and put them onto your Bench. Then, shuffle your deck.",
      },
      {
        name: "Fade Out",
        cost: ["Psychic"],
        effect: "Put this Pokémon and all attached cards into your hand.",
        damage: 30,
      },
    ],
  }),
  // ── The search targets, two stages per owner where the stage rider is read.
  "fix-cynthia-basic": subgroupBasic("fix-cynthia-basic", "Cynthia's Gible"),
  "fix-cynthia-evo": subgroupEvolution("fix-cynthia-evo", "Cynthia's Garchomp", "Cynthia's Gabite"),
  "fix-misty-basic": subgroupBasic("fix-misty-basic", "Misty's Psyduck"),
  "fix-misty-evo": subgroupEvolution("fix-misty-evo", "Misty's Starmie", "Misty's Staryu"),
  "fix-hop-basic": subgroupBasic("fix-hop-basic", "Hop's Wooloo"),
  "fix-hop-evo": subgroupEvolution("fix-hop-evo", "Hop's Dubwool", "Hop's Wooloo"),
  "fix-steven-basic": subgroupBasic("fix-steven-basic", "Steven's Beldum"),
  "fix-steven-evo": subgroupEvolution("fix-steven-evo", "Steven's Metang", "Steven's Beldum"),
  "fix-lillie-basic": subgroupBasic("fix-lillie-basic", "Lillie's Cutiefly"),
  "fix-lillie-evo": subgroupEvolution("fix-lillie-evo", "Lillie's Ribombee", "Lillie's Cutiefly"),
  // ── The NEGATIVES, each a real printed card that a name-only predicate takes.
  /** sv10-182 — the one card that breaks the name rule (see the header). */
  "fix-tr-energy": specialEnergy(
    "fix-tr-energy",
    "Team Rocket's Energy",
    "This card can only be attached to a Team Rocket's Pokémon. If this card is attached to anything other than a Team Rocket's Pokémon, discard this card.\n\nAs long as this card is attached to a Pokémon, it provides 2 in any combination of {P} Energy and {D} Energy.",
  ),
  /** A prefixed TRAINER sitting in the same deck as the Pokémon it shares an
      owner with — the in-deck negative for every `owner: "Cynthia"` search. */
  "fix-cynthia-trainer": trainerCard(
    "fix-cynthia-trainer",
    "Tool",
    "The Cynthia's Pokémon this card is attached to gets +70 HP.",
  ),
  /** `Farfetch'd` — the catalog's apostrophe-bearing name that is NOT a
      possessive prefix, and the reason the trailing `'s ` is matched whole. */
  "fix-farfetchd": battler("fix-farfetchd", { name: "Farfetch'd" }),
} as const;

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** One deck carries every carrier and every target: the searches are for
    DISJOINT owners, so a single 60 is enough and each search's candidate set is
    the other owners' bodies proving the prefix bites. */
const DECK = deckOf({
  "fix-championscall": 2,
  "fix-swimtogether": 2,
  "fix-summoningsign": 2,
  "fix-invitingflowers": 2,
  "fix-hopsbag": 2,
  "fix-cynthia-basic": 2,
  "fix-cynthia-evo": 2,
  "fix-misty-basic": 2,
  "fix-misty-evo": 2,
  "fix-hop-basic": 2,
  "fix-hop-evo": 2,
  "fix-steven-basic": 2,
  "fix-steven-evo": 2,
  "fix-lillie-basic": 3,
  "fix-lillie-evo": 2,
  "fix-cynthia-trainer": 2,
  "fix-tr-energy": 2,
  "fix-farfetchd": 2,
  "fix-water-energy": 4,
  "fix-energy": 6,
  "fix-basic-1": 4,
  "fix-bigbody": 9,
});

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

function board(seed: number): GameState {
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  return state;
}

/** P1's board with `bodyId` Active and an EMPTY bench — the bench-bound searches
    need every one of the five slots free for the clamp to be the printed cap. */
function withActive(seed: number, bodyId: string): GameState {
  return clearBench(setActiveFromDeck(handToDeck(board(seed), "p1", bodyId), "p1", bodyId), "p1");
}

function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

/** The card ids a chooseCards prompt is offering, sorted — what the FILTER
    actually admitted, named rather than counted. */
function offered(state: GameState): string[] {
  return cardsPrompt(state)
    .candidates.map((uid) => state.cardIdByUid[uid] as string)
    .sort();
}

const resolve = (state: GameState, uids: string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } });

// ─────────────────────────────────────────────────────────────────────────────

describe("D200 — the census, as data", () => {
  it("totals 80 legal text units across 13 owners and 3 columns", () => {
    for (const row of CENSUS) {
      expect(
        row.effect + row.attack + row.ability,
        `${row.owner}: columns disagree with total`,
      ).toBe(row.total);
    }
    expect(CENSUS.reduce((n, r) => n + r.total, 0)).toBe(80);
    expect(CENSUS.reduce((n, r) => n + r.attack, 0)).toBe(25);
    expect(CENSUS).toHaveLength(13);
  });

  it("the landed yield is SIX printings — 7.5 % of the dimension it is named after", () => {
    const landed = LANDED.reduce((n, r) => n + r.legal, 0);
    expect(landed).toBe(6);
    expect(DROPPED.reduce((n, r) => n + r.legal, 0)).toBe(0);
  });
});

describe("D200 — the registry map", () => {
  it("registers all 6 Standard-legal printings, one shared object per program", () => {
    for (const { program, ids, fixture, legal } of LANDED) {
      expect(ids, `${program}: id list disagrees with its measured legal count`).toHaveLength(
        legal,
      );
      const first = programFor(ids[0] as string);
      expect(first, `${program}: ${ids[0]} has no program`).toBeDefined();
      for (const id of ids) expect(programFor(id), `${id} left ${program}`).toBe(first);
      expect(programFor(fixture), `${fixture} does not carry ${program}`).toBe(first);
    }
    expect(LANDED.reduce((n, r) => n + r.ids.length, 0)).toBe(6);
  });

  it("Hop's Bag and Summoning Sign are SEPARATE objects, not one shared near-twin", () => {
    expect(programFor("sv09-147")).not.toBe(programFor("sv10-083"));
  });

  it("an index-keyed attack program adopts ONLY its index", () => {
    // "Surf" / "Psychic Sphere" must stay on the plain damage path.
    for (const id of ["sv10-050", "sv10-083"]) {
      expect(programFor(id)?.attack?.[0], `${id} idx 0`).toBeDefined();
      expect(programFor(id)?.attack?.[1], `${id} idx 1 was adopted`).toBeUndefined();
    }
    const comfey = programFor("sv09-068")?.attack;
    expect(comfey?.[0], "sv09-068 idx 0").toBeDefined();
    expect(comfey?.[1], "sv09-068 idx 1").toEqual([{ op: "returnSelf", dest: "hand" }]);
    expect(comfey?.[0]).not.toEqual(comfey?.[1]);
    expect(comfey?.[2], "sv09-068 idx 2 — the card prints two attacks").toBeUndefined();
  });

  it("DROPPED is EMPTY — and every row added back must still be UNBUILT on its own SURFACE", () => {
    expect(DROPPED).toHaveLength(0);
    for (const { sentence, ids, legal, surface } of DROPPED) {
      expect(ids, `${sentence.slice(0, 40)}…: id list disagrees with its legal count`).toHaveLength(
        legal,
      );
      for (const id of ids) {
        expect(
          programFor(id)?.[surface],
          `${id}'s ${surface} was quietly authored; update DROPPED`,
        ).toBeUndefined();
      }
      if (surface === "attack") {
        expect(
          resolvedByAnyReader(sentence),
          `${sentence.slice(0, 40)}… is now claimed by a READER; update DROPPED`,
        ).toBe(false);
      }
    }
  });

  it("the DERIVER channel currently covers ZERO rows — the vacuity measured, not described", () => {
    expect(DROPPED.filter((r) => r.surface === "attack")).toHaveLength(0);
    expect(DROPPED.map((r) => r.surface).sort()).toEqual([]);
    expect(
      resolvedByAnyReader(
        "Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards.",
      ),
    ).toBe(true);
    expect(resolvedByAnyReader("Not a printed sentence at all.")).toBe(false);
  });
});

describe("D200 — what the predicate reads", () => {
  const cynthia: CardFilter = { kind: "ownerPokemon", owner: "Cynthia" };
  const card = (id: string) => POOL[id] as Card;

  it("matches on the card NAME's possessive prefix", () => {
    expect(matchesFilter(card("fix-cynthia-basic"), cynthia)).toBe(true);
    expect(matchesFilter(card("fix-cynthia-evo"), cynthia)).toBe(true);
    expect(matchesFilter(card("fix-championscall"), cynthia)).toBe(true);
  });

  it("does not match another owner, nor an unprefixed Pokémon", () => {
    expect(matchesFilter(card("fix-misty-basic"), cynthia)).toBe(false);
    expect(matchesFilter(card("fix-basic-1"), cynthia)).toBe(false);
  });

  it("REFUSES `Team Rocket's Energy` — the one card that breaks the name rule", () => {
    // sv10-182 carries the prefix and is a Special Energy. The `category`
    // conjunct is what stops the card that PRINTS "only be attached to a Team
    // Rocket's Pokémon" from being one.
    const teamRocket: CardFilter = { kind: "ownerPokemon", owner: "Team Rocket" };
    expect(card("fix-tr-energy").name.startsWith("Team Rocket's ")).toBe(true);
    expect(matchesFilter(card("fix-tr-energy"), teamRocket)).toBe(false);
  });

  it("refuses a prefixed TRAINER for the same reason", () => {
    expect(card("fix-cynthia-trainer").name).toBe("fix-cynthia-trainer");
    // …and the printed Trainers that DO carry the prefix (Cynthia's Power
    // Weight, Hop's Bag, Lillie's Pearl) are refused by the same conjunct — here
    // driven on a body whose own name carries it.
    const named: Card = { ...card("fix-cynthia-trainer"), name: "Cynthia's Power Weight" };
    expect(named.name.startsWith("Cynthia's ")).toBe(true);
    expect(matchesFilter(named, cynthia)).toBe(false);
  });

  it("the match is EXACT-CASE and the trailing space is load-bearing", () => {
    const gible = card("fix-cynthia-basic");
    expect(matchesFilter({ ...gible, name: "cynthia's Gible" }, cynthia)).toBe(false);
    // No trailing space in the print → not a member. "Cynthia'sGible" is not a
    // real name, and this is what keeps it from becoming one by accident.
    expect(matchesFilter({ ...gible, name: "Cynthia'sGible" }, cynthia)).toBe(false);
    // A LONGER owner is not a member of a shorter one's subgroup.
    expect(matchesFilter({ ...gible, name: "Cynthia Jr.'s Gible" }, cynthia)).toBe(false);
  });

  it("`Farfetch'd` cannot collide with any owner prefix", () => {
    // The only two apostrophe-bearing non-possessive names in the catalog are
    // `Farfetch'd` and `Billy & O'Nare`; both carry `'d` / `'N`, never `'s `.
    for (const owner of ["Farfetch", "Billy & O", "N", "Misty"]) {
      expect(matchesFilter(card("fix-farfetchd"), { kind: "ownerPokemon", owner })).toBe(false);
    }
  });

  it("an owner nobody prints matches the EMPTY SET — a loud no-op, never a wrong card", () => {
    // The safety argument for the bare `string`: no misspelling can match a
    // Pokémon it does not name, so a typo whiffs where `providesEnergy`'s
    // forbidden Colorless would have taken the wrong print.
    for (const id of Object.keys(LOCAL_CARDS)) {
      expect(matchesFilter(card(id), { kind: "ownerPokemon", owner: "Cynthai" })).toBe(false);
    }
  });

  it("`stage` narrows to the printed word, and the two arms partition the subgroup", () => {
    const basic: CardFilter = { kind: "ownerPokemon", owner: "Cynthia", stage: "basic" };
    const evo: CardFilter = { kind: "ownerPokemon", owner: "Cynthia", stage: "evolution" };
    expect(matchesFilter(card("fix-cynthia-basic"), basic)).toBe(true);
    expect(matchesFilter(card("fix-cynthia-basic"), evo)).toBe(false);
    expect(matchesFilter(card("fix-cynthia-evo"), basic)).toBe(false);
    expect(matchesFilter(card("fix-cynthia-evo"), evo)).toBe(true);
    for (const id of ["fix-cynthia-basic", "fix-cynthia-evo"]) {
      expect(matchesFilter(card(id), cynthia)).toBe(true);
    }
  });

  it("the stage arms agree with the sibling members on every card in the pool", () => {
    // "Evolution X's Pokémon" and "an Evolution Pokémon" must not disagree —
    // both read `evolveFromOf(card) !== null`, and this is where that is checked
    // rather than asserted in a comment.
    for (const [id, c] of Object.entries(POOL)) {
      if (c.category !== "Pokemon" || !c.name.includes("'s ")) continue;
      const owner = c.name.slice(0, c.name.indexOf("'s "));
      expect(
        matchesFilter(c, { kind: "ownerPokemon", owner, stage: "basic" }),
        `${id} (${c.name}) basic arm`,
      ).toBe(matchesFilter(c, { kind: "basicPokemon" }));
      expect(
        matchesFilter(c, { kind: "ownerPokemon", owner, stage: "evolution" }),
        `${id} (${c.name}) evolution arm`,
      ).toBe(matchesFilter(c, { kind: "evolutionPokemon" }));
    }
  });

  it("exactly D242's TWO prefixed POKÉMON match, and no other fixture matches any owner", () => {
    const owners = CENSUS.map((r) => r.owner);
    const matched: string[] = [];
    for (const [id, c] of Object.entries(FIXTURE_POOL)) {
      for (const owner of owners) {
        if (matchesFilter(c, { kind: "ownerPokemon", owner })) matched.push(`${id}/${owner}`);
      }
    }
    expect(matched.sort()).toEqual(
      [
        "fix-powersaver/Team Rocket",
        "fix-tr-body/Team Rocket",
        "fix-cynthia-aura/Cynthia",
        "fix-cynthia-body/Cynthia",
        "fix-hop-aura/Hop",
        "fix-repellingveil/Team Rocket",
        "fix-tr-stage1/Team Rocket",
        "fix-lillie-body/Lillie",
        "fix-legacy-ex/Lillie",
        "fix-ethans-cyndaquil/Ethan",
        "fix-ethans-typhlosion/Ethan",
        "fix-ethans-pichu/Ethan",
        "fix-loveimpact/Team Rocket",
        "fix-trnidoking/Team Rocket",
        "fix-abruptflash/Misty",
        "fix-mistystaryu/Misty",
        "fix-inplaybodies/Team Rocket",
      ].sort(),
    );
  });
});

describe("D200 — Champion's Call (Cynthia's Gabite sv10-103)", () => {
  it("searches the deck for a Cynthia's Pokémon of ANY stage, and captions it as printed", () => {
    const state = withActive(1, "fix-championscall");
    const { state: parked } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Champion's Call",
    });
    const prompt = cardsPrompt(parked);
    // The printed noun phrase, whole — `retrieveNoun`'s new arm through
    // `searchNote`. A member without it would have read "a Pokémon".
    expect(prompt.note).toBe("Search your deck for a Cynthia's Pokémon into your hand.");
    expect(prompt.max).toBe(1);
    expect(prompt.min).toBe(0); // "up to" — declining is legal
    expect(prompt.dest).toBe("hand");
    // BOTH stages, the Gabite copies still in the deck, and NOTHING else: not
    // the Cynthia's TOOL, not another owner's Pokémon.
    expect(new Set(offered(parked))).toEqual(
      new Set(["fix-cynthia-basic", "fix-cynthia-evo", "fix-championscall"]),
    );
  });

  it("resolving puts the chosen card in hand and shuffles", () => {
    const state = withActive(2, "fix-championscall");
    const { state: parked } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Champion's Call",
    });
    // Any offer will do — the candidate SET is pinned in the case above; this
    // one is about what resolving does with a pick.
    const pick = cardsPrompt(parked).candidates[0] as string;
    const before = parked.players.p1.hand.length;
    const { state: done, events } = resolve(parked, [pick]);
    expect(done.players.p1.hand).toContain(pick);
    expect(done.players.p1.hand.length).toBe(before + 1);
    expect(done.players.p1.deck).not.toContain(pick);
    expect(events.map((e) => e.type)).toEqual(["DECK_SEARCHED", "SHUFFLE"]);
  });
});

describe("D200 — Swim Together (Misty's Lapras sv10-050/-194)", () => {
  it("the ATTACK path runs the same two ops at the printed max 3", () => {
    let state = withActive(3, "fix-swimtogether");
    state = attachFromDeck(state, "p1", "fix-water-energy", 1);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const prompt = cardsPrompt(parked);
    expect(prompt.note).toBe("Search your deck for up to 3 Misty's Pokémon into your hand.");
    expect(prompt.max).toBe(3);
    expect(new Set(offered(parked))).toEqual(
      new Set(["fix-misty-basic", "fix-misty-evo", "fix-swimtogether"]),
    );
  });

  it("takes up to three, and the attacker's own copies are legal picks", () => {
    let state = withActive(4, "fix-swimtogether");
    state = attachFromDeck(state, "p1", "fix-water-energy", 1);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const picks = cardsPrompt(parked).candidates.slice(0, 3);
    const before = parked.players.p1.hand.length;
    const { state: done } = resolve(parked, picks);
    expect(done.players.p1.hand.length).toBe(before + 3);
    for (const uid of picks) expect(done.players.p1.hand).toContain(uid);
  });
});

describe("D200 — the `stage` rider on the board", () => {
  it("Hop's Bag (sv09-147) offers BASIC Hop's Pokémon only, onto the Bench", () => {
    let state = clearBench(board(5), "p1");
    state = handFromDeck(handToDeck(state, "p1", "fix-hopsbag"), "p1", "fix-hopsbag", 1);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-hopsbag"),
    });
    const prompt = cardsPrompt(parked);
    expect(prompt.note).toBe("Search your deck for up to 2 Basic Hop's Pokémon onto your Bench.");
    expect(prompt.dest).toBe("bench");
    expect(prompt.max).toBe(2);
    // `fix-hop-evo` is a Hop's Pokémon and is REFUSED by the stage rider;
    // `fix-hopsbag` itself is a Hop's-named TRAINER and is refused by category.
    expect(new Set(offered(parked))).toEqual(new Set(["fix-hop-basic"]));
  });

  it("Summoning Sign (sv10-083) is the same program one owner over", () => {
    let state = withActive(6, "fix-summoningsign");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(cardsPrompt(parked).note).toBe(
      "Search your deck for up to 2 Basic Steven's Pokémon onto your Bench.",
    );
    // The attacker's own copies are in it: Steven's Baltoy IS a Basic Steven's
    // Pokémon, and the printed sentence has no "other" in it.
    expect(new Set(offered(parked))).toEqual(new Set(["fix-steven-basic", "fix-summoningsign"]));
    const picks = cardsPrompt(parked).candidates.slice(0, 2);
    const { state: done } = resolve(parked, picks);
    expect(done.players.p1.bench).toHaveLength(picks.length);
  });
});

describe("D200 — Inviting Flowers (Lillie's Comfey sv09-068): the printed 'any number'", () => {
  it("offers the whole Bench when the Bench is empty — BENCH_MAX is a cap, not a guess ( D577: the cap is BENCH_CEILING; the live limit binds here)", () => {
    let state = withActive(7, "fix-invitingflowers");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const prompt = cardsPrompt(parked);
    expect(prompt.max).toBe(5);
    expect(prompt.note).toBe(
      "Search your deck for up to 5 Basic Lillie's Pokémon onto your Bench.",
    );
    expect(new Set(offered(parked))).toEqual(new Set(["fix-lillie-basic", "fix-invitingflowers"]));
    expect(prompt.min).toBe(0);
  });

  it("clamps to the REMAINING bench space, so the cap is never the number 5", () => {
    let state = withActive(8, "fix-invitingflowers");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    // Three bodies benched → two slots left.
    for (const _ of [0, 1, 2]) state = benchFromDeck(state, "p1", "fix-bigbody");
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(cardsPrompt(parked).max).toBe(2);
    expect(cardsPrompt(parked).note).toBe(
      "Search your deck for up to 2 Basic Lillie's Pokémon onto your Bench.",
    );
  });
});
