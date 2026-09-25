import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import type { GameEvent } from "./events";
import { applyAction, createGame } from "./index";
import type { GameAction, GameState } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  expectErr,
  mustApply,
  setActiveFromDeck,
  trainerCard,
  typedEnergy,
  types,
} from "./testFixtures";

// ── 🆕🆕🆕 D553 — THE SIMPLE ONCE-PER-TURN ABILITIES, PART B: THE DECK SEARCHES ──
//
// Three of the slice's seven printed texts, 5 of its 12 legal printings (part A is
// `onceAbilities.test.ts`), each `CHAMPIONS_CALL`'s template with ONE noun changed:
//
//   Mamoswine ex    sv09-079 / sv09-174  "Mammoth Hauler"         — a Pokémon
//   Sawsbuck        sv05-017 / sv05-166  "Changing Seasons"       — a Stadium card
//   Ethan's Quilava sv10-033             "Bonded by the Journey"  — an Ethan's Adventure card
//
// Every one prints "search your deck for a(n) …, reveal it, and put it into your
// hand. Then, shuffle your deck." — `searchDeck { max: 1, dest: "hand", reveal: true }`
// then `shuffleDeck`. ⚠️ THE ONE BEHAVIOUR LINE OUTSIDE THE REGISTRY is
// `retrieveNoun`'s byName article: "Ethan's Adventure" is the first VOWEL-INITIAL name
// its cardNoun seam has met, and D553 withdrew the claim that none could (§5 pins the
// caption).
//
// Real ids on a LOCAL `cardPool` (D275), no `fix-*` demonstrator; the Stage 1 / Stage 2
// bodies keep their printed stage and are SEATED by surgery as a Basic would be (D243).
// Ethan's Adventure itself rides at its REAL id `sv10-165` (a registry Supporter since
// D337) with its printed name, ASCII apostrophe, so the `byName` match is the real one.

const MAMMOTH_TEXT =
  "Once during your turn, you may search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.";
const SEASONS_TEXT =
  "Once during your turn, you may search your deck for a Stadium card, reveal it, and put it into your hand. Then, shuffle your deck.";
const BONDED_TEXT =
  "Once during your turn, you may search your deck for an Ethan's Adventure card, reveal it, and put it into your hand. Then, shuffle your deck.";

const MAMOSWINE = "sv09-079";
const MAMOSWINE_2 = "sv09-174";
const SAWSBUCK = "sv05-017";
const SAWSBUCK_2 = "sv05-166";
const QUILAVA = "sv10-033";
const ETHANS_ADVENTURE = "sv10-165";

const FILLER = "d553-searchfiller";
const ENERGY = "d553-fire";
const STADIUM = "d553-stadium";
const ITEM = "d553-item";
const SUPPORTER = "d553-supporter";

function body(id: string, name: string, stage: string, evolveFrom: string, ability: string, effect: string): Card {
  return battler(id, {
    name,
    hp: 130,
    stage,
    evolveFrom,
    retreat: 2,
    types: ["Colorless"],
    abilities: [{ type: "Ability", name: ability, effect }],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  [MAMOSWINE]: body(MAMOSWINE, "Mamoswine ex", "Stage2", "Piloswine", "Mammoth Hauler", MAMMOTH_TEXT),
  [MAMOSWINE_2]: body(MAMOSWINE_2, "Mamoswine ex", "Stage2", "Piloswine", "Mammoth Hauler", MAMMOTH_TEXT),
  [SAWSBUCK]: body(SAWSBUCK, "Sawsbuck", "Stage1", "Deerling", "Changing Seasons", SEASONS_TEXT),
  [SAWSBUCK_2]: body(SAWSBUCK_2, "Sawsbuck", "Stage1", "Deerling", "Changing Seasons", SEASONS_TEXT),
  [QUILAVA]: body(QUILAVA, "Ethan's Quilava", "Stage1", "Ethan's Cyndaquil", "Bonded by the Journey", BONDED_TEXT),
  [ETHANS_ADVENTURE]: {
    ...trainerCard(ETHANS_ADVENTURE, "Supporter", "Search your deck for up to 3 in any combination of Ethan's Pokémon and Basic Fire Energy cards, reveal them, and put them into your hand. Then, shuffle your deck."),
    name: "Ethan's Adventure",
  },
  [FILLER]: battler(FILLER, {
    name: "D553 Search Filler",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [ENERGY]: typedEnergy(ENERGY, "Fire"),
  [STADIUM]: { ...trainerCard(STADIUM, "Stadium", "A D553 Stadium."), name: "D553 Stadium" },
  [ITEM]: { ...trainerCard(ITEM, "Item", "A D553 Item."), name: "D553 Item" },
  [SUPPORTER]: { ...trainerCard(SUPPORTER, "Supporter", "A D553 Supporter."), name: "D553 Supporter" },
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [MAMOSWINE]: 3,
  [MAMOSWINE_2]: 3,
  [SAWSBUCK]: 3,
  [SAWSBUCK_2]: 3,
  [QUILAVA]: 4,
  [ETHANS_ADVENTURE]: 4,
  [STADIUM]: 4,
  [ITEM]: 4,
  [SUPPORTER]: 4,
  [FILLER]: 16,
  [ENERGY]: 12,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** p1 on its own (unrestricted) turn 2 — p2 went first and passed. */
function p1Turn(seed = 5530): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
    const uid = state.players[s].hand.find((h) => state.cardIdByUid[h] === FILLER);
    if (uid === undefined) throw new Error(`no filler Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** p1's turn, a FILLER Active, `id` benched at index 0. */
function benched(id: string, seed = 5530): GameState {
  let state = p1Turn(seed);
  state = setActiveFromDeck(state, "p1", FILLER);
  state = clearBench(state, "p1");
  return benchFromDeck(state, "p1", id);
}

/** TEST SURGERY — move every card of p1's DECK that `drop` names to the discard, so a
    search meets a deck with no legal pick (the "miss") or with only a near miss. */
function stripDeck(state: GameState, drop: (id: string) => boolean): GameState {
  const side = state.players.p1;
  const gone = side.deck.filter((u) => drop(state.cardIdByUid[u] ?? ""));
  const goneSet = new Set(gone);
  return {
    ...state,
    players: {
      ...state.players,
      p1: { ...side, deck: side.deck.filter((u) => !goneSet.has(u)), discard: [...side.discard, ...gone] },
    },
  };
}

function use(abilityName: string, target: "active" | number = 0): GameAction {
  return {
    type: "useAbility",
    seat: "p1",
    target: target === "active" ? { spot: "active" } : { spot: "bench", index: target },
    abilityName,
  };
}

function parkOf(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
  return prompt;
}

function answer(state: GameState, uids: readonly string[]) {
  return mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [...uids] } });
}

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

const ctx = (state: GameState): LogContext => ({
  names: { p1: "Ember", p2: "Tide" },
  state,
  elapsed: formatElapsed(0),
});

function searchRow(state: GameState, events: GameEvent[]): string {
  const row = logFromEvents(events, ctx(state)).find(
    (r) => r.kind === "action" && r.segments.some((s) => s.text.includes("searched their deck")),
  );
  return row?.kind === "action" ? row.segments.map((s) => s.text).join("") : "";
}

/** The three texts, each with the card it may take, a NEAR MISS it must refuse, and
    the caption the dialog reads. */
const TEXTS: readonly {
  name: string;
  ids: readonly string[];
  text: string;
  filter: unknown;
  hit: string;
  hitName: string;
  nearMiss: string;
  nearMissWhy: string;
  isHit: (id: string) => boolean;
  caption: string;
}[] = [
  {
    name: "Mammoth Hauler",
    ids: [MAMOSWINE, MAMOSWINE_2],
    text: MAMMOTH_TEXT,
    filter: { kind: "anyPokemon" },
    hit: FILLER,
    hitName: "D553 Search Filler",
    nearMiss: SUPPORTER,
    nearMissWhy: "a Trainer is not a Pokémon",
    isHit: (id) => POOL[id]?.category === "Pokemon",
    caption: "Search your deck for a Pokémon into your hand.",
  },
  {
    name: "Changing Seasons",
    ids: [SAWSBUCK, SAWSBUCK_2],
    text: SEASONS_TEXT,
    filter: { kind: "stadium" },
    hit: STADIUM,
    hitName: "D553 Stadium",
    nearMiss: ITEM,
    nearMissWhy: "an Item is a Trainer and not a Stadium",
    isHit: (id) => id === STADIUM,
    caption: "Search your deck for a Stadium card into your hand.",
  },
  {
    name: "Bonded by the Journey",
    ids: [QUILAVA],
    text: BONDED_TEXT,
    filter: { kind: "byName", name: "Ethan's Adventure", cardNoun: true },
    hit: ETHANS_ADVENTURE,
    hitName: "Ethan's Adventure",
    nearMiss: SUPPORTER,
    nearMissWhy: "a DIFFERENT Supporter",
    isHit: (id) => id === ETHANS_ADVENTURE,
    caption: "Search your deck for an Ethan's Adventure card into your hand.",
  },
];

// ────────────────────────────────────────────────────────────────────────────
describe("D553 B §1 — the print, and the registry rows that map it", () => {
  for (const t of TEXTS) {
    it(`${t.name}: pinned by toEqual — CHAMPIONS_CALL's template with one noun, no \`attack\` key, reprints on ONE object`, () => {
      for (const id of t.ids) {
        expect(POOL[id]?.abilities?.[0]?.effect).toBe(t.text);
        expect(programFor(id)).toBe(programFor(t.ids[0] as string));
      }
      const program = programFor(t.ids[0] as string);
      expect(program).toEqual({
        abilities: [
          {
            name: t.name,
            oncePerTurn: true,
            activeOnly: false,
            program: [
              { op: "searchDeck", filter: t.filter, dest: "hand", max: 1, reveal: true },
              { op: "shuffleDeck" },
            ],
          },
        ],
      });
      expect(Object.keys(program ?? {})).toEqual(["abilities"]);
      expect(t.text).toContain(", reveal it, and put it into your hand. Then, shuffle your deck.");
    });
  }

  it("the three are three DISTINCT objects, and none is CHAMPIONS_CALL's (D199)", () => {
    const objects = new Set([MAMOSWINE, SAWSBUCK, QUILAVA, "sv10-103"].map((id) => programFor(id)));
    expect(objects.size).toBe(4);
  });

  it("the byName noun is spelled with the ASCII apostrophe U+0027, the tcgdex bytes", () => {
    const op = programFor(QUILAVA)?.abilities?.[0]?.program[0];
    const name = op?.op === "searchDeck" && op.filter.kind === "byName" ? op.filter.name : "";
    expect(name).toBe("Ethan's Adventure");
    expect(name.codePointAt(5)).toBe(0x27);
    expect(POOL[ETHANS_ADVENTURE]?.name).toBe(name);
  });
});

// ────────────────────────────────────────────────────────────────────────────
for (const t of TEXTS) {
  describe(`D553 B §2 — ${t.name}: pick, reveal, shuffle`, () => {
    it("parks on chooseCards offering EXACTLY the printed noun, max 1, into the hand", () => {
      const before = benched(t.ids[0] as string);
      const prompt = parkOf(mustApply(before, use(t.name)).state);
      expect(prompt.max).toBe(1);
      expect(prompt.min).toBe(0);
      expect(prompt.dest).toBe("hand");
      const expected = before.players.p1.deck.filter((u) => t.isHit(before.cardIdByUid[u] ?? ""));
      expect(expected.length).toBeGreaterThan(0);
      expect([...prompt.candidates].sort()).toEqual([...expected].sort());
    });

    it("the pick lands in hand, DECK_SEARCHED carries `reveal: true`, the log NAMES the card, then the deck shuffles", () => {
      const before = benched(t.ids[0] as string);
      const parked = mustApply(before, use(t.name)).state;
      const pick = parkOf(parked).candidates.find((u) => parked.cardIdByUid[u] === t.hit) as string;
      const { state: after, events } = answer(parked, [pick]);
      expect(after.players.p1.hand).toContain(pick);
      expect(after.players.p1.deck).not.toContain(pick);
      expect(find(events, "DECK_SEARCHED")).toEqual({
        type: "DECK_SEARCHED",
        seat: "p1",
        dest: "hand",
        uids: [pick],
        reveal: true,
      });
      expect(searchRow(after, events)).toBe(`searched their deck — revealed ${t.hitName} and put it in hand`);
      const order = types(events);
      expect(order.indexOf("SHUFFLE")).toBeGreaterThan(order.indexOf("DECK_SEARCHED"));
      expect(after.phase).toEqual({ kind: "turn:action", seat: "p1" });
    });

    it("a DECLINE (take none) still shuffles, and moves nothing", () => {
      const before = benched(t.ids[0] as string);
      const parked = mustApply(before, use(t.name)).state;
      const { state: after, events } = answer(parked, []);
      expect(after.players.p1.hand).toEqual(parked.players.p1.hand);
      expect(find(events, "SHUFFLE")?.seat).toBe("p1");
      expect(after.phase.kind).toBe("turn:action");
    });

    it("a MISS — no legal card in the deck — never parks, and still shuffles", () => {
      const before = stripDeck(benched(t.ids[0] as string), t.isHit);
      const { state: after, events } = mustApply(before, use(t.name));
      expect(after.phase).toEqual({ kind: "turn:action", seat: "p1" });
      expect(types(events)).toEqual(["ABILITY_USED", "SHUFFLE"]);
      expect(after.players.p1.hand).toEqual(before.players.p1.hand);
    });

    it(`the NEAR MISS is refused — ${t.nearMissWhy}: never offered, and naming it is BAD_EFFECT_CHOICE`, () => {
      const before = benched(t.ids[0] as string);
      const parked = mustApply(before, use(t.name)).state;
      const near = parked.players.p1.deck.find((u) => parked.cardIdByUid[u] === t.nearMiss) as string;
      expect(near).toBeDefined();
      expect(parkOf(parked).candidates).not.toContain(near);
      expectErr(
        parked,
        { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [near] } },
        "BAD_EFFECT_CHOICE",
      );
    });

    it("a second use in the same turn is refused ABILITY_ALREADY_USED — after a pick AND after a decline", () => {
      const before = benched(t.ids[0] as string);
      const picked = answer(mustApply(before, use(t.name)).state, [
        parkOf(mustApply(before, use(t.name)).state).candidates[0] as string,
      ]).state;
      expectErr(picked, use(t.name), "ABILITY_ALREADY_USED");
      const declined = answer(mustApply(before, use(t.name)).state, []).state;
      expectErr(declined, use(t.name), "ABILITY_ALREADY_USED");
    });

    it("works from the BENCH (every case above) and from the ACTIVE alike", () => {
      let state = p1Turn();
      state = setActiveFromDeck(state, "p1", t.ids[t.ids.length - 1] as string);
      state = clearBench(state, "p1");
      const prompt = parkOf(mustApply(state, use(t.name, "active")).state);
      expect(prompt.candidates.length).toBeGreaterThan(0);
    });
  });
}

// ────────────────────────────────────────────────────────────────────────────
describe("D553 B §5 — the caption, and the article D553 had to compute", () => {
  for (const t of TEXTS) {
    it(`${t.name} captions "${t.caption}"`, () => {
      expect(parkOf(mustApply(benched(t.ids[0] as string), use(t.name)).state).note).toBe(t.caption);
    });
  }

  it("🛑 the article is COMPUTED off the name (D553 withdrew the consonant-only claim): the live singular reads \"an\"", () => {
    // The caption above is the only singular this seam reaches today. Arven's
    // Greedent's "Arven's Sandwich" — the seam's first producer, and ALSO
    // vowel-initial — prints "up to 2 … cards" and reaches the PLURAL only, which is
    // how the withdrawn claim ("every printed card name in this seam is
    // consonant-initial") survived: it was never true of the names, only of the
    // singulars any card could reach.
    const note = parkOf(mustApply(benched(QUILAVA), use("Bonded by the Journey")).state).note;
    expect(note.startsWith("Search your deck for an Ethan's Adventure card")).toBe(true);
    expect(note).not.toContain(" a Ethan's");
  });
});
