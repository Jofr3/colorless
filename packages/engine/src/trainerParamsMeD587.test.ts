import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  discardFromDeck,
  expectErr,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  trainerCard,
  must,
} from "./testFixtures";

/** [me ids, twin id, card name, me text, twin text, edits]. Each edit is [twin phrase, me
    phrase]; applied in order, they turn the twin's text into the `me` text. */
const FACES: readonly (readonly [
  readonly string[],
  string,
  string,
  string,
  string,
  readonly (readonly [string, string])[],
])[] = [
  [
    ["me02-094", "me03-117"],
    "sv09-153",
    "Wondrous Patch",
    "Attach a Basic {P} Energy card from your discard pile to 1 of your Benched {P} Pokémon.",
    "Attach a Basic Energy card from your discard pile to 1 of your Benched N's Pokémon.",
    [
      ["a Basic Energy card", "a Basic {P} Energy card"],
      ["Benched N's Pokémon", "Benched {P} Pokémon"],
    ],
  ],
  [
    ["me04-079", "me04-110"],
    "sv09-153",
    "Philippe",
    "Attach up to 2 Basic {M} Energy cards from your discard pile to 1 of your {M} Pokémon.",
    "Attach a Basic Energy card from your discard pile to 1 of your Benched N's Pokémon.",
    [
      ["Attach a Basic Energy card", "Attach up to 2 Basic {M} Energy cards"],
      ["1 of your Benched N's Pokémon", "1 of your {M} Pokémon"],
    ],
  ],
  [
    ["me03-075", "me03-110", "me03-122"],
    "sv06.5-062",
    "Jacinthe",
    "Heal 150 damage from 1 of your {P} Pokémon.",
    "Heal 150 damage from 1 of your Pokémon.\n\nThis card can't be put into your hand or deck from the discard pile.",
    [
      [
        "1 of your Pokémon.\n\nThis card can't be put into your hand or deck from the discard pile.",
        "1 of your {P} Pokémon.",
      ],
    ],
  ],
  [
    ["me02-089", "me02-119"],
    "sv02-061",
    "Firebreather",
    "Search your deck for up to 7 Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    "Once during your turn, if this Pokémon is in the Active Spot, you may search your deck for up to 2 Basic {W} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    [
      ["Once during your turn, if this Pokémon is in the Active Spot, you may search", "Search"],
      ["up to 2 Basic {W}", "up to 7 Basic {R}"],
    ],
  ],
  [
    ["me01-116", "me01-168", "me02.5-187"],
    "sv10-165",
    "Fighting Gong",
    "Search your deck for a Basic {F} Energy card or a Basic {F} Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.",
    "Search your deck for up to 3 in any combination of Ethan's Pokémon and Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    [
      [
        "up to 3 in any combination of Ethan's Pokémon and Basic {R} Energy cards, reveal them, and put them",
        "a Basic {F} Energy card or a Basic {F} Pokémon, reveal it, and put it",
      ],
    ],
  ],
  [
    ["me03-085", "me03-116"],
    "sv08.5-116",
    "Tarragon",
    "Put up to 4 in any combination of {F} Pokémon and Basic {F} Energy cards from your discard pile into your hand.",
    "Put up to 5 in any combination of Pokémon and Basic Energy cards from your discard pile into your hand.",
    [
      [
        "up to 5 in any combination of Pokémon and Basic Energy",
        "up to 4 in any combination of {F} Pokémon and Basic {F} Energy",
      ],
    ],
  ],
  [
    ["me02.5-198", "me03-081", "me03-113"],
    "sv05-153",
    "Poké Pad",
    "Search your deck for a Pokémon that doesn't have a Rule Box, reveal it, and put it into your hand. Then, shuffle your deck. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)",
    "Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.",
    [
      ["for a Pokémon,", "for a Pokémon that doesn't have a Rule Box,"],
      ["shuffle your deck.", "shuffle your deck. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)"],
    ],
  ],
  [
    ["me03-073"],
    "sv03-190",
    "Energy Swatter",
    "Your opponent reveals their hand, and you choose an Energy card you find there and put it on the bottom of their deck.",
    "Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck. If you put a card on the bottom of your opponent's deck in this way, your opponent may draw a card.",
    [
      ["choose a card", "choose an Energy card"],
      [
        " If you put a card on the bottom of your opponent's deck in this way, your opponent may draw a card.",
        "",
      ],
    ],
  ],
];

/** Repel's twin is a SENTENCE, not an id: the attack text `deriveAttackEffect` already reads. */
const REPEL = "me01-126";
const REPEL_TEXT =
  "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)";

const ME_IDS = [...FACES.flatMap(([ids]) => ids), REPEL];

describe("D587 §1 — the faces: 19 `me` printings / 9 texts, each rebuilt from its twin's", () => {
  it("9 texts / 19 printings, no id twice", () => {
    expect(FACES.length + 1).toBe(9);
    expect(ME_IDS).toHaveLength(19);
    expect(new Set(ME_IDS).size).toBe(19);
  });

  it("every `me` text IS its twin's through the stated edits (each edit's left side is printed)", () => {
    for (const [ids, twin, name, meText, twinText, edits] of FACES) {
      let built = twinText;
      for (const [from, to] of edits) {
        expect(built, `${twin}: "${from}"`).toContain(from);
        built = built.split(from).join(to);
      }
      expect(built, `${ids.join(" / ")} (${name}) ~ ${twin}`).toBe(meText);
    }
  });

  it("Repel prints the attack sentence the deriver reads, and its program IS that derivation", () => {
    expect(deriveAttackEffect(REPEL_TEXT)).toEqual([{ op: "opponentSwitchOut" }]);
    expect(programFor(REPEL)?.trainer).toEqual(deriveAttackEffect(REPEL_TEXT));
  });
});

describe("D587 §2 — the registry: one NEW object per text, the twin's op at the printed parameter", () => {
  it("every printing of a text shares ONE object, distinct from its twin's, holding only `trainer`", () => {
    for (const [ids, twin] of FACES) {
      const program = programFor(ids[0] as string);
      expect(program, ids[0]).toBeDefined();
      for (const id of ids) expect(programFor(id), id).toBe(program);
      expect(program, twin).not.toBe(programFor(twin));
    }
    for (const id of ME_IDS) expect(Object.keys(programFor(id) ?? {}), id).toEqual(["trainer"]);
  });

  it("the attaches: N's PP Up's op at the printed {P} / {M}, Philippe's batch of 2 on 1 body", () => {
    expect(programFor("sv09-153")?.trainer).toEqual([
      { op: "attachEnergyFrom", source: "discard", benchOnly: true, ownerPokemon: "N" },
    ]);
    expect(programFor("me02-094")?.trainer).toEqual([
      {
        op: "attachEnergyFrom",
        source: "discard",
        energyType: "Psychic",
        targetType: "Psychic",
        benchOnly: true,
      },
    ]);
    expect(programFor("me04-079")?.trainer).toEqual([
      {
        op: "attachEnergyFrom",
        source: "discard",
        energyType: "Metal",
        targetType: "Metal",
        count: 2,
      },
    ]);
  });

  it("Jacinthe = Poké Vital A's heal with the {P} filter", () => {
    expect(programFor("me03-075")?.trainer).toEqual([
      {
        ...programFor("sv06.5-062")?.trainer?.[0],
        filter: { kind: "typedPokemon", pokemonType: "Psychic" },
      },
    ]);
  });

  it("the searches: Shivery Chill at {R} / 7, Ethan's Adventure's union at 1, Master Ball without a Rule Box", () => {
    const chill = programFor("sv02-061")?.abilities?.[0]?.program;
    expect(JSON.stringify(programFor("me02-089")?.trainer)).toBe(
      JSON.stringify(chill).split('"Water"').join('"Fire"').split('"max":2').join('"max":7'),
    );
    const ethans = programFor("sv10-165")?.trainer ?? [];
    expect(programFor("me01-116")?.trainer).toEqual([
      {
        ...ethans[0],
        filter: {
          kind: "anyOf",
          filters: [
            { kind: "basicEnergy", energyType: "Fighting" },
            { kind: "typedPokemon", pokemonType: "Fighting", stage: "basic" },
          ],
        },
        max: 1,
      },
      ethans[1],
    ]);
    const master = programFor("sv05-153")?.trainer ?? [];
    expect(programFor("me02.5-198")?.trainer).toEqual([
      { ...master[0], filter: { kind: "anyPokemon", noRuleBox: true } },
      master[1],
    ]);
  });

  it("Tarragon = Lana's Aid's `anyOf` retrieval at {F} and 4 (Max Rod's sentence, typed)", () => {
    const lana = programFor("sv06-155")?.trainer?.[0];
    expect(programFor("me03-085")?.trainer).toEqual([
      {
        ...lana,
        filter: {
          kind: "anyOf",
          filters: [
            { kind: "typedPokemon", pokemonType: "Fighting" },
            { kind: "basicEnergy", energyType: "Fighting" },
          ],
        },
        max: 4,
      },
    ]);
    expect(programFor("sv08.5-116")?.trainer?.[0]).toMatchObject({ dest: "hand", max: 5 });
  });

  it("Energy Swatter = Ortega's first op with an Energy filter, and no record or draw", () => {
    const { recordAs: _recorded, ...first } = programFor("sv03-190")?.trainer?.[0] as {
      recordAs?: string;
    };
    expect(programFor("me03-073")?.trainer).toEqual([{ ...first, filter: { kind: "anyEnergy" } }]);
  });
});

// ── ON A BOARD: each program at its printed parameter, against a control ──

const PATCH = "me02-094";
const PHILIPPE = "me04-079";
const JACINTHE = "me03-075";
const FIREBREATHER = "me02-089";
const GONG = "me01-116";
const TARRAGON = "me03-085";
const PAD = "me02.5-198";
const SWATTER = "me03-073";
const CARBINK = "me02.5-117";
const PSY = "d587-psychic";
const MET = "d587-metal";
const FIGHT = "d587-fighting";
const FIGHT_S1 = "d587-fighting-stage1";
const EX = "d587-rulebox-ex";
const FILLER = "d587-filler";

const text = (id: string) =>
  id === REPEL ? REPEL_TEXT : (FACES.find(([ids]) => ids.includes(id))?.[3] ?? "");
const trainer = (id: string, name: string, trainerType: string): Card => ({
  ...trainerCard(id, trainerType, text(id)),
  name,
});
const mon = (id: string, name: string, type: string, extra: Partial<Card> = {}): Card =>
  battler(id, {
    name,
    hp: 200,
    types: [type],
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
    ...extra,
  });

const LOCAL: Record<string, Card> = {
  [PATCH]: trainer(PATCH, "Wondrous Patch", "Item"),
  [PHILIPPE]: trainer(PHILIPPE, "Philippe", "Supporter"),
  [JACINTHE]: trainer(JACINTHE, "Jacinthe", "Supporter"),
  [FIREBREATHER]: trainer(FIREBREATHER, "Firebreather", "Supporter"),
  [GONG]: trainer(GONG, "Fighting Gong", "Item"),
  [TARRAGON]: trainer(TARRAGON, "Tarragon", "Supporter"),
  [PAD]: trainer(PAD, "Poké Pad", "Item"),
  [SWATTER]: trainer(SWATTER, "Energy Swatter", "Item"),
  [REPEL]: trainer(REPEL, "Repel", "Item"),
  [CARBINK]: battler(CARBINK, {
    name: "Carbink",
    hp: 90,
    types: ["Fighting"],
    retreat: 1,
    abilities: [
      {
        type: "Ability",
        name: "Double Type",
        effect: "As long as this Pokémon is in play, it is {F} and {P} type.",
      },
    ],
    attacks: [
      {
        cost: ["Fighting", "Fighting", "Colorless"],
        name: "Counter Jewel",
        effect:
          "If your opponent has 2 or fewer Prize cards remaining, this attack does 100 more damage.",
        damage: "70+",
      },
    ],
  }),
  [PSY]: mon(PSY, "D587 Psychic", "Psychic"),
  [MET]: mon(MET, "D587 Metal", "Metal"),
  [FIGHT]: mon(FIGHT, "D587 Fighting", "Fighting"),
  [FIGHT_S1]: mon(FIGHT_S1, "D587 Fighting Stage 1", "Fighting", {
    stage: "Stage1",
    evolveFrom: "D587 Fighting",
  }),
  [EX]: mon(EX, "D587 Mon ex", "Colorless"),
  [FILLER]: mon(FILLER, "D587 Filler", "Colorless", { hp: 400 }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [PATCH]: 1,
  [PHILIPPE]: 1,
  [JACINTHE]: 1,
  [FIREBREATHER]: 1,
  [GONG]: 1,
  [TARRAGON]: 1,
  [PAD]: 1,
  [SWATTER]: 1,
  [REPEL]: 1,
  [CARBINK]: 1,
  [PSY]: 4,
  [MET]: 4,
  [FIGHT]: 3,
  [FIGHT_S1]: 2,
  [EX]: 2,
  [FILLER]: 6,
  "fix-psychic-energy": 4,
  "fix-metal-energy": 4,
  "fix-fighting-energy": 4,
  "fix-fire-energy": 8,
  "fix-water-energy": 3,
  "fix-energy": 6,
});

/** Setup, then P1's own turn (P2 went first and passed). The surgery never depends on the deal. */
function p1Turn(): GameState {
  const created = createGame({ seed: 5874, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    const pile = [...side.deck, ...side.hand, ...side.prizes];
    const prizes = pile.filter((u) => state.cardIdByUid[u] === "fix-energy");
    state = {
      ...state,
      players: {
        ...state.players,
        [s]: { ...side, hand: [], prizes, deck: pile.filter((u) => !prizes.includes(u)) },
      },
    };
  }
  return state;
}

/** P1's Active is `active` and P1's Bench is exactly `bench`; P2's Active is a Filler, no Bench. */
function board(active: string, bench: readonly string[]): GameState {
  let state = clearBench(setActiveFromDeck(p1Turn(), "p1", active), "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  return clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
}

function idOf(state: GameState, uid: string | undefined): string | undefined {
  return uid === undefined ? undefined : state.cardIdByUid[uid];
}
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => idOf(state, u));

function all<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** `id` from P1's deck into the hand, then played. */
function play(state: GameState, id: string): { state: GameState; events: GameEvent[] } {
  const staged = handFromDeck(state, "p1", id, 1);
  const uid = staged.players.p1.hand.find((u) => idOf(staged, u) === id) as string;
  return mustApply(staged, { type: "playTrainer", seat: "p1", uid });
}
function refused(state: GameState, id: string): void {
  const staged = handFromDeck(state, "p1", id, 1);
  const uid = staged.players.p1.hand.find((u) => idOf(staged, u) === id) as string;
  expectErr(staged, { type: "playTrainer", seat: "p1", uid }, "NO_LEGAL_TARGET");
}

function prompt(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt;
}
const bench = (index: number) => ({ seat: "p1", spot: { spot: "bench", index } }) as const;
const pick = (seat: Seat, ref: unknown): GameAction =>
  ({ type: "resolveEffect", seat, choice: { kind: "pokemon", ref } }) as GameAction;
const cards = (uids: readonly string[]): GameAction => ({
  type: "resolveEffect",
  seat: "p1",
  choice: { kind: "cards", uids: [...uids] },
});

describe("D587 §3 — Wondrous Patch: a Basic {P} Energy from the discard to 1 of your Benched {P} Pokémon", () => {
  function patchBoard(): GameState {
    let state = board(PSY, [PSY, MET, PSY]);
    state = discardFromDeck(state, "p1", "fix-psychic-energy", 1);
    return discardFromDeck(state, "p1", "fix-fire-energy", 1);
  }

  it("offers the Benched {P} bodies only (not the {P} Active, not the {M}), attaches the {P} card", () => {
    const parked = play(patchBoard(), PATCH).state;
    const p = prompt(parked);
    if (p.kind !== "choosePokemon") throw new Error(`expected choosePokemon, got ${p.kind}`);
    expect(p.candidates).toEqual([bench(0), bench(2)]);
    const done = mustApply(parked, pick("p1", bench(2))).state;
    expect(ids(done, done.players.p1.bench[2]?.energy ?? [])).toEqual(["fix-psychic-energy"]);
    expect(ids(done, done.players.p1.bench[0]?.energy ?? [])).toEqual([]);
    expect(ids(done, done.players.p1.discard)).toContain("fix-fire-energy");
    expect(ids(done, done.players.p1.discard)).not.toContain("fix-psychic-energy");
  });

  it("is refused with no Benched {P} body, and with no Basic {P} Energy in the discard", () => {
    let noTarget = board(PSY, [MET]);
    noTarget = discardFromDeck(noTarget, "p1", "fix-psychic-energy", 1);
    refused(noTarget, PATCH);
    refused(discardFromDeck(board(PSY, [PSY]), "p1", "fix-fire-energy", 1), PATCH);
  });
});

describe("D587 §4 — Philippe: up to 2 Basic {M} Energy from the discard to 1 of your {M} Pokémon", () => {
  function philippeBoard(): GameState {
    let state = board(MET, [PSY, MET]);
    state = discardFromDeck(state, "p1", "fix-metal-energy", 3);
    return discardFromDeck(state, "p1", "fix-fire-energy", 1);
  }

  it("offers the {M} bodies (Active and Bench) at the printed ceiling, puts TWO {M} on the one chosen", () => {
    const parked = play(philippeBoard(), PHILIPPE).state;
    const p = prompt(parked);
    if (p.kind !== "choosePokemon") throw new Error(`expected choosePokemon, got ${p.kind}`);
    expect(p.candidates).toEqual([{ seat: "p1", spot: { spot: "active" } }, bench(1)]);
    expect(p.upTo).toBe(2);
    const done = mustApply(parked, pick("p1", bench(1))).state;
    expect(ids(done, done.players.p1.bench[1]?.energy ?? [])).toEqual([
      "fix-metal-energy",
      "fix-metal-energy",
    ]);
    expect(ids(done, done.players.p1.discard).filter((x) => x === "fix-metal-energy")).toHaveLength(
      1,
    );
    expect(ids(done, done.players.p1.discard)).toContain("fix-fire-energy");
  });

  it('"up to": ONE is an answer (D359\'s `take`), and a one-card pile attaches one', () => {
    const parked = play(philippeBoard(), PHILIPPE).state;
    const one = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: bench(1), take: 1 },
    } as GameAction).state;
    expect(ids(one, one.players.p1.bench[1]?.energy ?? [])).toEqual(["fix-metal-energy"]);
    const single = play(
      discardFromDeck(board(MET, []), "p1", "fix-metal-energy", 1),
      PHILIPPE,
    ).state;
    const done = mustApply(single, pick("p1", { seat: "p1", spot: { spot: "active" } })).state;
    expect(ids(done, done.players.p1.active?.energy ?? [])).toEqual(["fix-metal-energy"]);
  });

  it("no {M} body refuses the Supporter", () => {
    refused(discardFromDeck(board(PSY, [FIGHT]), "p1", "fix-metal-energy", 2), PHILIPPE);
  });
});

describe("D587 §5 — Jacinthe: heal 150 from 1 of your {P} Pokémon", () => {
  it("offers the {P} bodies only and heals 150 off the chosen one", () => {
    let state = board(PSY, [MET, PSY]);
    state = setDamage(state, "p1", 160);
    state = setBenchDamage(setBenchDamage(state, "p1", 0, 50), "p1", 1, 30);
    const parked = play(state, JACINTHE).state;
    const p = prompt(parked);
    if (p.kind !== "choosePokemon") throw new Error(`expected choosePokemon, got ${p.kind}`);
    expect(p.candidates).toEqual([{ seat: "p1", spot: { spot: "active" } }, bench(1)]);
    expect(p.note).toBe("Heal which of your Psychic Pokémon?");
    const done = mustApply(parked, pick("p1", { seat: "p1", spot: { spot: "active" } })).state;
    expect(done.players.p1.active?.damage).toBe(10);
    expect(done.players.p1.bench.map((b) => b.damage)).toEqual([50, 30]);
  });

  it('Carbink\'s in-play {P} ("Double Type") makes it a {P} Pokémon; no {P} body refuses it', () => {
    let state = board(FILLER, [CARBINK, FIGHT]);
    state = setBenchDamage(setBenchDamage(state, "p1", 0, 60), "p1", 1, 60);
    const done = play(state, JACINTHE).state;
    expect(done.players.p1.bench.map((b) => b.damage)).toEqual([0, 60]);
    refused(setBenchDamage(board(FILLER, [FIGHT]), "p1", 0, 60), JACINTHE);
  });
});

describe("D587 §6 — Firebreather: up to 7 Basic {R} Energy from the deck to the hand", () => {
  it("offers only Basic {R} Energy at a ceiling of 7, takes 7, reveals and shuffles", () => {
    const state = board(FILLER, []);
    const { state: parked } = play(state, FIREBREATHER);
    const p = prompt(parked);
    if (p.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${p.kind}`);
    expect(p).toMatchObject({ min: 0, max: 7, dest: "hand" });
    expect(new Set(ids(parked, p.candidates))).toEqual(new Set(["fix-fire-energy"]));
    expect(p.candidates).toHaveLength(8);
    const take = p.candidates.slice(0, 7);
    const { state: done, events } = mustApply(parked, cards(take));
    for (const uid of take) expect(done.players.p1.hand).toContain(uid);
    expect(events.some((e) => e.type === "SHUFFLE")).toBe(true);
    expect(all(events, "DECK_SEARCHED")).toMatchObject([
      { seat: "p1", dest: "hand", reveal: true },
    ]);
  });
});

describe("D587 §7 — Fighting Gong: a Basic {F} Energy card or a Basic {F} Pokémon", () => {
  it("offers Basic {F} Energy and Basic {F} Pokémon only (not the Stage 1 {F}, not the {P}), one of them", () => {
    const { state: parked } = play(board(FILLER, []), GONG);
    const p = prompt(parked);
    if (p.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${p.kind}`);
    expect(p).toMatchObject({ min: 0, max: 1, dest: "hand" });
    // Carbink is a printed Basic {F} Pokémon too.
    expect(new Set(ids(parked, p.candidates))).toEqual(
      new Set(["fix-fighting-energy", FIGHT, CARBINK]),
    );
    const gong = p.candidates.find((u) => idOf(parked, u) === FIGHT) as string;
    const done = mustApply(parked, cards([gong])).state;
    expect(done.players.p1.hand).toContain(gong);
  });
});

describe("D587 §8 — Tarragon: up to 4 {F} Pokémon and Basic {F} Energy from the discard", () => {
  it("offers {F} Pokémon of any stage and Basic {F} Energy only, at a ceiling of 4", () => {
    let state = board(FILLER, []);
    for (const [id, n] of [
      [FIGHT, 2],
      [FIGHT_S1, 1],
      ["fix-fighting-energy", 2],
      ["fix-fire-energy", 1],
      [PSY, 1],
    ] as const)
      state = discardFromDeck(state, "p1", id, n);
    const parked = play(state, TARRAGON).state;
    const p = prompt(parked);
    if (p.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${p.kind}`);
    expect(p).toMatchObject({ min: 0, max: 4, dest: "hand" });
    expect(new Set(ids(parked, p.candidates))).toEqual(
      new Set([FIGHT, FIGHT_S1, "fix-fighting-energy"]),
    );
    const take = p.candidates.slice(0, 4);
    const done = mustApply(parked, cards(take)).state;
    for (const uid of take) expect(done.players.p1.hand).toContain(uid);
  });

  it("a discard with no {F} card refuses the Supporter", () => {
    let state = discardFromDeck(board(FILLER, []), "p1", "fix-fire-energy", 1);
    state = discardFromDeck(state, "p1", PSY, 1);
    refused(state, TARRAGON);
  });
});

describe("D587 §9 — Poké Pad: a Pokémon that doesn't have a Rule Box", () => {
  it("offers every Pokémon of any stage but the ex, one of them", () => {
    const { state: parked } = play(board(FILLER, []), PAD);
    const p = prompt(parked);
    if (p.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${p.kind}`);
    expect(p).toMatchObject({ min: 0, max: 1, dest: "hand" });
    const offered = new Set(ids(parked, p.candidates));
    expect(offered.has(EX)).toBe(false);
    for (const id of [PSY, MET, FIGHT, FIGHT_S1, CARBINK, FILLER])
      expect(offered.has(id), id).toBe(true);
    for (const id of offered) expect(POOL[id ?? ""]?.category, id).toBe("Pokemon");
  });
});

describe("D587 §10 — Energy Swatter: an Energy card from the opponent's revealed hand to the bottom of their deck", () => {
  function swatBoard(): GameState {
    let state = board(FILLER, []);
    state = handFromDeck(state, "p2", "fix-fire-energy", 1);
    state = handFromDeck(state, "p2", "fix-water-energy", 1);
    return handFromDeck(state, "p2", PSY, 1);
  }

  it("reveals the hand, offers its Energy cards only, captions the printed sentence, bottoms the pick", () => {
    const { state: parked, events } = play(swatBoard(), SWATTER);
    expect(events.some((e) => e.type === "HAND_REVEALED")).toBe(true);
    const p = prompt(parked);
    if (p.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${p.kind}`);
    expect(p).toMatchObject({ min: 1, max: 1 });
    expect(p.note).toBe(text(SWATTER));
    expect(new Set(ids(parked, p.candidates))).toEqual(
      new Set(["fix-fire-energy", "fix-water-energy"]),
    );
    const water = p.candidates.find((u) => idOf(parked, u) === "fix-water-energy") as string;
    const done = mustApply(parked, cards([water])).state;
    expect(done.players.p2.deck.at(-1)).toBe(water);
    expect(ids(done, done.players.p2.hand).sort()).toEqual(["d587-psychic", "fix-fire-energy"]);
    // No "may draw": nothing parks for the opponent after the move (Ortega's second sentence).
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(done.players.p2.hand).toHaveLength(2);
  });

  it("a hand with no Energy reveals and moves nothing; an empty hand refuses the Item", () => {
    const state = handFromDeck(board(FILLER, []), "p2", PSY, 2);
    const { state: done, events } = play(state, SWATTER);
    expect(events.some((e) => e.type === "HAND_REVEALED")).toBe(true);
    expect(done.players.p2.hand).toHaveLength(2);
    expect(done.phase.kind).not.toBe("effect:choose");
    refused(board(FILLER, []), SWATTER);
  });
});

describe("D587 §11 — Repel: switch out the opponent's Active; the opponent chooses", () => {
  it("the OPPONENT answers from their own Bench, and the pick is promoted", () => {
    let state = board(FILLER, []);
    state = benchFromDeck(benchFromDeck(state, "p2", PSY), "p2", MET);
    const wasActive = state.players.p2.active?.stack.at(-1);
    const parked = play(state, REPEL).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.answerer).toBe("p2");
    const p = parked.phase.prompt;
    if (p.kind !== "choosePokemon") throw new Error(`expected choosePokemon, got ${p.kind}`);
    expect(p.note).toBe("Choose your new Active Pokémon.");
    const done = mustApply(
      parked,
      pick("p2", { seat: "p2", spot: { spot: "bench", index: 1 } }),
    ).state;
    expect(idOf(done, done.players.p2.active?.stack.at(-1))).toBe(MET);
    expect(done.players.p2.bench.map((b) => b.stack.at(-1))).toContain(wasActive);
  });

  it("one benched body is forced; an empty opponent Bench refuses the Item", () => {
    const state = benchFromDeck(board(FILLER, []), "p2", PSY);
    const done = play(state, REPEL).state;
    expect(idOf(done, done.players.p2.active?.stack.at(-1))).toBe(PSY);
    refused(board(FILLER, []), REPEL);
  });
});

describe("D587 §12 — every id this file drives is a real `me` id, held in a LOCAL pool only", () => {
  it("no D587 Trainer or body reached the shared `FIXTURE_POOL`", () => {
    for (const id of Object.keys(LOCAL)) expect(FIXTURE_POOL[id], id).toBeUndefined();
    for (const id of ME_IDS) expect(/^me/.test(id), id).toBe(true);
  });
});
