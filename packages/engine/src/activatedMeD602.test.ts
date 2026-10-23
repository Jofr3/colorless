import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction } from "./index";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
import {
  effectPrompt,
  effectPromptOf,
  FIXTURE_POOL,
  attachFromDeck,
  itemTrainer,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  trainerCard,
  typedEnergy,
  must,
  driveSetup,
} from "./testFixtures";

const CALL_A_BUDDY =
  "Once during your turn, if you have no cards in your hand, you may use this Ability. Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck.";
const GATHERING_OF_BLOSSOMS =
  "Once during your turn, you may use this Ability. Search your deck for an Erika's Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.";
const GUIDING_DANCE =
  "Once during your turn, you may use this Ability. Flip a coin. If heads, search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.";
const FERMENTED_JUICE =
  "Once during your turn, if this Pokémon has any {G} Energy attached, you may use this Ability. Heal 30 damage from 1 of your Pokémon.";
const LOVELY_FRAGRANCE =
  "Once during your turn, you may use this Ability. Heal 30 damage from each of your Pokémon.";
const SUNRISE =
  "Once during your turn, if this Pokémon is on your Bench, you may use this Ability. Search your deck for up to 2 Basic Metal Energy cards and attach them to this Pokémon. Then, shuffle your deck.";

const SILVALLY = ["me05-070", "me05-095"] as const;
const TANGELA = ["me02.5-007", "me02.5-218"] as const;
const VIVILLON = "30th-008";
const SHUCKLE = ["me01-011", "me01-136"] as const;
const VILEPLUME = "me02.5-003";
const SOLGALEO = "30th-105";

const ABILITIES: readonly (readonly [string, readonly string[], string, boolean])[] = [
  ["Call a Buddy", SILVALLY, CALL_A_BUDDY, false],
  ["Gathering of Blossoms", TANGELA, GATHERING_OF_BLOSSOMS, false],
  ["Guiding Dance", [VIVILLON], GUIDING_DANCE, false],
  ["Fermented Juice", SHUCKLE, FERMENTED_JUICE, false],
  ["Lovely Fragrance", [VILEPLUME], LOVELY_FRAGRANCE, false],
  ["Sunrise", [SOLGALEO], SUNRISE, true],
];

const abilityOf = (id: string) => programFor(id)?.abilities?.[0];

describe("D602 §1 — the programs: six objects over 9 printings", () => {
  it("every keyed printing carries ONE activated Ability under its printed name, one object per text", () => {
    expect(ABILITIES.flatMap(([, ids]) => ids)).toHaveLength(9);
    for (const [name, ids] of ABILITIES) {
      for (const id of ids) {
        expect(Object.keys(programFor(id) ?? {}), id).toEqual(["abilities"]);
        expect(programFor(id)?.abilities, id).toHaveLength(1);
        expect(abilityOf(id), id).toMatchObject({ name, activeOnly: false });
        expect(programFor(id), id).toBe(programFor(ids[0] as string));
      }
    }
    expect(new Set(ABILITIES.map(([, ids]) => programFor(ids[0] as string))).size).toBe(6);
  });

  it("every lock is per Pokémon (no printed name lock); `benchOnly` exactly where the Bench clause is printed", () => {
    for (const [name, ids, text, benchOnly] of ABILITIES) {
      expect(text.startsWith("Once during your turn, "), name).toBe(true);
      expect(text.includes("You can't use more than 1"), name).toBe(false);
      expect(abilityOf(ids[0] as string)?.oncePerTurn, name).toBe(true);
      expect(text.includes("if this Pokémon is on your Bench"), name).toBe(benchOnly);
      expect(abilityOf(ids[0] as string)?.benchOnly === true, name).toBe(benchOnly);
    }
  });

  it("the three searches: Call a Buddy (empty-hand gate), Gathering of Blossoms (Erika's), Guiding Dance (heads only)", () => {
    expect(abilityOf(SILVALLY[0])?.playableIf).toEqual({ kind: "yourHandExactly", count: 0 });
    expect(abilityOf(SILVALLY[0])?.program).toEqual([
      { op: "searchDeck", filter: { kind: "supporter" }, dest: "hand", max: 1, reveal: true },
      { op: "shuffleDeck" },
    ]);
    expect(abilityOf(TANGELA[0])?.playableIf).toBeUndefined();
    expect(abilityOf(TANGELA[0])?.program).toEqual([
      {
        op: "searchDeck",
        filter: { kind: "ownerPokemon", owner: "Erika" },
        dest: "hand",
        max: 1,
        reveal: true,
      },
      { op: "shuffleDeck" },
    ]);
    // Guiding Dance is Poké Ball `sv01-185`'s program on the Ability surface.
    expect(abilityOf(VIVILLON)?.program).toEqual(programFor("sv01-185")?.trainer);
  });

  it("the two heals and the attach", () => {
    expect(abilityOf(SHUCKLE[0])?.requiresEnergyType).toBe("Grass");
    expect(abilityOf(SHUCKLE[0])?.program).toEqual([{ op: "healChosen", amount: 30 }]);
    expect(abilityOf(VILEPLUME)?.requiresEnergyType).toBeUndefined();
    expect(abilityOf(VILEPLUME)?.program).toEqual([{ op: "healEach", amount: 30 }]);
    expect(abilityOf(SOLGALEO)?.program).toEqual([
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Metal" },
        max: 2,
        toSelf: true,
      },
      { op: "shuffleDeck" },
    ]);
  });

  it("no printed attack is registry-keyed (each keeps deriving)", () => {
    for (const [, ids] of ABILITIES)
      for (const id of ids) expect(programFor(id)?.attack, id).toBeUndefined();
  });
});

// ── ON A BOARD ──

const FILLER = "d602-filler"; // a {C} Basic, 300 HP
const SUPPORTER = "d602-supporter";
const ERIKAS_ODDISH = "d602-erikas-oddish";
const ODDISH = "d602-oddish";
const ERIKAS_TRAINER = "d602-erikas-trainer"; // a Trainer whose name begins "Erika's "
const ITEM = "d602-item"; // a Trainer that is not a Supporter
const G = "d602-grass";
const R = "d602-fire";
const M = "d602-metal";

const body = (id: string, name: string, ability: string, text: string, over: Partial<Card>): Card =>
  battler(id, {
    name,
    retreat: 1,
    abilities: [{ type: "Ability", name: ability, effect: text }],
    ...over,
  } as Partial<Card>);

const LOCAL: Record<string, Card> = {
  [SILVALLY[0]]: body(SILVALLY[0], "Silvally", "Call a Buddy", CALL_A_BUDDY, {
    stage: "Stage1",
    evolveFrom: "Type: Null",
    hp: 140,
    types: ["Colorless"],
    retreat: 2,
    attacks: [
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Air Slash",
        damage: 130,
        effect: "Discard an Energy from this Pokémon.",
      },
    ],
  }),
  [SILVALLY[1]]: body(SILVALLY[1], "Silvally", "Call a Buddy", CALL_A_BUDDY, {
    stage: "Stage1",
    evolveFrom: "Type: Null",
    hp: 140,
    types: ["Colorless"],
    retreat: 2,
  }),
  [TANGELA[0]]: body(
    TANGELA[0],
    "Erika's Tangela",
    "Gathering of Blossoms",
    GATHERING_OF_BLOSSOMS,
    {
      hp: 80,
      types: ["Grass"],
      retreat: 2,
    },
  ),
  [VIVILLON]: body(VIVILLON, "Vivillon", "Guiding Dance", GUIDING_DANCE, {
    stage: "Stage2",
    hp: 120,
    types: ["Grass"],
  }),
  [SHUCKLE[0]]: body(SHUCKLE[0], "Shuckle", "Fermented Juice", FERMENTED_JUICE, {
    hp: 80,
    types: ["Grass"],
  }),
  [SHUCKLE[1]]: body(SHUCKLE[1], "Shuckle", "Fermented Juice", FERMENTED_JUICE, {
    hp: 80,
    types: ["Grass"],
  }),
  [VILEPLUME]: body(VILEPLUME, "Erika's Vileplume ex", "Lovely Fragrance", LOVELY_FRAGRANCE, {
    stage: "Stage2",
    evolveFrom: "Erika's Gloom",
    hp: 310,
    types: ["Grass"],
    retreat: 2,
  }),
  [SOLGALEO]: body(SOLGALEO, "Solgaleo", "Sunrise", SUNRISE, {
    stage: "Stage2",
    hp: 170,
    types: ["Metal"],
    retreat: 2,
  }),
  [FILLER]: battler(FILLER, { name: "D602 Filler", hp: 300, types: ["Colorless"], retreat: 1 }),
  [SUPPORTER]: trainerCard(SUPPORTER, "Supporter", "Draw 2 cards."),
  [ERIKAS_ODDISH]: battler(ERIKAS_ODDISH, { name: "Erika's Oddish", hp: 60, types: ["Grass"] }),
  [ODDISH]: battler(ODDISH, { name: "Oddish", hp: 60, types: ["Grass"] }),
  [ERIKAS_TRAINER]: {
    ...trainerCard(ERIKAS_TRAINER, "Supporter", "Draw a card."),
    name: "Erika's Invitation",
  },
  [ITEM]: itemTrainer(ITEM),
  [G]: typedEnergy(G, "Grass"),
  [R]: typedEnergy(R, "Fire"),
  [M]: typedEnergy(M, "Metal"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [SILVALLY[0]]: 1,
  [SILVALLY[1]]: 1,
  [TANGELA[0]]: 1,
  [VIVILLON]: 1,
  [SHUCKLE[0]]: 1,
  [SHUCKLE[1]]: 1,
  [VILEPLUME]: 1,
  [SOLGALEO]: 1,
  [FILLER]: 14,
  [SUPPORTER]: 2,
  [ERIKAS_ODDISH]: 2,
  [ODDISH]: 2,
  [ERIKAS_TRAINER]: 2,
  [ITEM]: 2,
  [G]: 6,
  [R]: 6,
  [M]: 6,
  "fix-energy": 10,
});

function p1Turn(): GameState {
  let state = driveSetup(6021, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    let deck = [...side.deck, ...side.hand];
    const prizes = side.prizes.map((u) => {
      if ([FILLER, "fix-energy"].includes(state.cardIdByUid[u] as string)) return u;
      const swap = deck.find((d) =>
        [FILLER, "fix-energy"].includes(state.cardIdByUid[d] as string),
      );
      if (swap === undefined) throw new Error("no swap card");
      deck = [...deck.filter((d) => d !== swap), u];
      return swap;
    });
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], prizes, deck } } };
  }
  return state;
}

/** P1: `active` (a FILLER by default) and `bench`; P2: a FILLER; P1's hand is exactly `hand`. */
function table(opts: { active?: string; bench?: readonly string[]; hand: readonly string[] }) {
  let state = p1Turn();
  state = clearBench(setActiveFromDeck(state, "p1", opts.active ?? FILLER), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
  for (const id of opts.bench ?? []) state = benchFromDeck(state, "p1", id);
  const side = state.players.p1;
  let deck = [...side.deck];
  const hand: string[] = [];
  for (const id of opts.hand) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`p1 deck has no ${id}`);
    hand.push(uid);
    deck = deck.filter((u) => u !== uid);
  }
  return { ...state, players: { ...state.players, p1: { ...side, hand, deck } } } as GameState;
}

const ACTIVE = { spot: "active" } as const;
const bench = (index: number) => ({ spot: "bench", index }) as const;
const use = (
  state: GameState,
  abilityName: string,
  target: typeof ACTIVE | ReturnType<typeof bench>,
  seat: Seat = "p1",
) => applyAction(state, { type: "useAbility", seat, target, abilityName } as GameAction);
function ok(result: ReturnType<typeof applyAction>) {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result;
}
function refusal(result: ReturnType<typeof applyAction>): string {
  if (result.ok) throw new Error("expected a refusal");
  return result.error.code;
}
const resolve = (state: GameState, choice: unknown, seat: Seat = "p1") =>
  ok(applyAction(state, { type: "resolveEffect", seat, choice } as GameAction));
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
const shuffled = (events: readonly GameEvent[]) =>
  events.filter((e) => e.type === "SHUFFLE").map((e) => (e as { seat: Seat }).seat);

/** An rng cursor whose first flip lands on `face`. */
function cursorFor(face: "heads" | "tails"): number {
  for (let n = 1; n < 1000; n++) if (flipCoin(n)[0] === face) return n;
  throw new Error("no cursor");
}

describe("D602 §2 — Call a Buddy: no cards in hand, a Supporter from the deck", () => {
  it("with an empty hand: only the Supporters are offered (not an Item), one goes to the hand, the deck is shuffled", () => {
    const state = table({ bench: [SILVALLY[0]], hand: [] });
    const parked = ok(use(state, "Call a Buddy", bench(0)));
    const offer = effectPromptOf(parked.state, "chooseCards");
    expect(offer.max).toBe(1);
    const candidates = offer.candidates;
    expect(new Set(ids(parked.state, candidates))).toEqual(new Set([SUPPORTER, ERIKAS_TRAINER]));
    const pick = candidates.find((u) => parked.state.cardIdByUid[u] === SUPPORTER) as string;
    const done = resolve(parked.state, { kind: "cards", uids: [pick] });
    expect(done.state.phase.kind).toBe("turn:action");
    expect(done.state.players.p1.hand).toEqual([pick]);
    expect(shuffled(done.events)).toContain("p1");
  });

  it("refused with ANY card in hand — the printed gate, named in the reason", () => {
    const result = use(table({ bench: [SILVALLY[0]], hand: [R] }), "Call a Buddy", bench(0));
    expect(refusal(result)).toBe("ABILITY_CONDITION_NOT_MET");
    if (result.ok) throw new Error("unreachable");
    expect(result.error.message).toContain("you have no cards in your hand");
  });

  it("once per Pokémon: the same Silvally is refused, the other printing still searches", () => {
    let state = table({ active: SILVALLY[1], bench: [SILVALLY[0]], hand: [] });
    let parked = ok(use(state, "Call a Buddy", bench(0)));
    // An empty answer keeps the hand empty, so the second gate still holds.
    state = resolve(parked.state, { kind: "cards", uids: [] }).state;
    expect(state.players.p1.hand).toEqual([]);
    expect(refusal(use(state, "Call a Buddy", bench(0)))).toBe("ABILITY_ALREADY_USED");
    parked = ok(use(state, "Call a Buddy", ACTIVE));
    expect(effectPrompt(parked.state).kind).toBe("chooseCards");
  });
});

describe("D602 §3 — Gathering of Blossoms: an Erika's Pokémon from the deck", () => {
  it("offers exactly the Erika's Pokémon (not an Oddish, not an \"Erika's\" Trainer)", () => {
    const state = table({ bench: [TANGELA[0]], hand: [R] });
    const parked = ok(use(state, "Gathering of Blossoms", bench(0)));
    const offer = effectPromptOf(parked.state, "chooseCards");
    expect(offer.max).toBe(1);
    const candidates = offer.candidates;
    // Erika's Vileplume ex is in the deck too: an Erika's Pokémon of another stage.
    expect(new Set(ids(parked.state, candidates))).toEqual(new Set([ERIKAS_ODDISH, VILEPLUME]));
    const pick = candidates.find((u) => parked.state.cardIdByUid[u] === ERIKAS_ODDISH) as string;
    const done = resolve(parked.state, { kind: "cards", uids: [pick] });
    expect(ids(done.state, done.state.players.p1.hand)).toEqual([R, ERIKAS_ODDISH]);
    expect(shuffled(done.events)).toContain("p1");
  });

  it("is used from the Active Spot as well, and once per Pokémon", () => {
    let state = table({ active: TANGELA[0], hand: [] });
    state = resolve(ok(use(state, "Gathering of Blossoms", ACTIVE)).state, {
      kind: "cards",
      uids: [],
    }).state;
    expect(refusal(use(state, "Gathering of Blossoms", ACTIVE))).toBe("ABILITY_ALREADY_USED");
  });
});

describe("D602 §4 — Guiding Dance: a coin; heads, a Pokémon from the deck", () => {
  it("heads: a Pokémon search (Pokémon only), then the shuffle", () => {
    const state = { ...table({ bench: [VIVILLON], hand: [] }), rngState: cursorFor("heads") };
    const parked = ok(use(state, "Guiding Dance", bench(0)));
    const offer = effectPromptOf(parked.state, "chooseCards");
    expect(offer.max).toBe(1);
    const candidates = offer.candidates;
    for (const id of ids(parked.state, candidates))
      expect(POOL[id as string]?.category, id).toBe("Pokemon");
    expect(ids(parked.state, candidates)).toContain(ODDISH);
    const done = resolve(parked.state, { kind: "cards", uids: [candidates[0]] });
    expect(done.state.players.p1.hand).toEqual([candidates[0]]);
    expect(shuffled(done.events)).toContain("p1");
  });

  it("tails: nothing — no search, no shuffle (Poké Ball's reading) — and the use is spent", () => {
    const state = { ...table({ bench: [VIVILLON], hand: [] }), rngState: cursorFor("tails") };
    const result = ok(use(state, "Guiding Dance", bench(0)));
    expect(result.state.phase.kind).toBe("turn:action");
    expect(result.state.players.p1.hand).toEqual([]);
    expect(result.state.players.p1.deck).toEqual(state.players.p1.deck);
    expect(shuffled(result.events)).toEqual([]);
    expect(refusal(use(result.state, "Guiding Dance", bench(0)))).toBe("ABILITY_ALREADY_USED");
  });
});

describe("D602 §5 — Fermented Juice: any {G} Energy on this Pokémon; heal 30 from 1 of your Pokémon", () => {
  it("with a {G} Energy attached: the chosen body heals 30, the other keeps its damage", () => {
    let state = table({ active: SHUCKLE[0], bench: [FILLER], hand: [] });
    state = attachFromDeck(state, "p1", G, 1);
    state = setBenchDamage(setDamage(state, "p1", 50), "p1", 0, 40);
    const parked = ok(use(state, "Fermented Juice", ACTIVE));
    expect(effectPrompt(parked.state).kind).toBe("choosePokemon");
    const done = resolve(parked.state, {
      kind: "pokemon",
      ref: { seat: "p1", spot: { spot: "bench", index: 0 } },
    }).state;
    expect(done.players.p1.bench[0]?.damage).toBe(10);
    expect(done.players.p1.active?.damage).toBe(50);
    expect(refusal(use(done, "Fermented Juice", ACTIVE))).toBe("ABILITY_ALREADY_USED");
  });

  it("refused with no Energy, and with only a {R} Energy attached — the reason names the clause", () => {
    const bare = setDamage(table({ active: SHUCKLE[0], hand: [] }), "p1", 50);
    expect(refusal(use(bare, "Fermented Juice", ACTIVE))).toBe("ABILITY_CONDITION_NOT_MET");
    const fire = use(attachFromDeck(bare, "p1", R, 1), "Fermented Juice", ACTIVE);
    expect(refusal(fire)).toBe("ABILITY_CONDITION_NOT_MET");
    if (fire.ok) throw new Error("unreachable");
    expect(fire.error.message).toContain("this Pokémon has any Grass Energy attached");
  });

  it("the {G} must be on THIS Pokémon: a Benched Shuckle without one is refused while the Active has one", () => {
    let state = table({ active: SHUCKLE[0], bench: [SHUCKLE[1]], hand: [] });
    state = setDamage(attachFromDeck(state, "p1", G, 1), "p1", 50);
    expect(refusal(use(state, "Fermented Juice", bench(0)))).toBe("ABILITY_CONDITION_NOT_MET");
  });

  it("with nothing damaged it is still usable — `healChosen`'s unnarrowed candidates are every own body (Confectionary Gift's shipped reading)", () => {
    const state = attachFromDeck(table({ active: SHUCKLE[0], hand: [] }), "p1", G, 1);
    const after = ok(use(state, "Fermented Juice", ACTIVE)).state;
    expect(after.players.p1.active?.damage).toBe(0);
    expect(after.allowances.abilitiesUsed).toEqual([
      `${state.players.p1.active?.stack.at(-1)}:Fermented Juice`,
    ]);
  });
});

describe("D602 §6 — Lovely Fragrance: heal 30 from each of your Pokémon", () => {
  it("each of your bodies heals 30 (clamped at 0); the opponent's Active is untouched; nothing asks", () => {
    let state = table({ active: VILEPLUME, bench: [FILLER, FILLER], hand: [] });
    state = setBenchDamage(setBenchDamage(setDamage(state, "p1", 70), "p1", 0, 20), "p1", 1, 0);
    state = setDamage(state, "p2", 60);
    const after = ok(use(state, "Lovely Fragrance", ACTIVE)).state;
    expect(after.phase.kind).toBe("turn:action");
    expect(after.players.p1.active?.damage).toBe(40);
    expect(after.players.p1.bench.map((b) => b.damage)).toEqual([0, 0]);
    expect(after.players.p2.active?.damage).toBe(60);
    expect(refusal(use(after, "Lovely Fragrance", ACTIVE))).toBe("ABILITY_ALREADY_USED");
  });

  it("from the Bench too (no spot clause is printed)", () => {
    const state = setDamage(table({ bench: [VILEPLUME], hand: [] }), "p1", 30);
    expect(ok(use(state, "Lovely Fragrance", bench(0))).state.players.p1.active?.damage).toBe(0);
  });
});

describe("D602 §7 — Sunrise: on the Bench, up to 2 Basic {M} Energy from the deck to itself", () => {
  it("offers only Basic {M} Energy; two land on Solgaleo, the deck is shuffled", () => {
    const state = table({ bench: [FILLER, SOLGALEO], hand: [] });
    const parked = ok(use(state, "Sunrise", bench(1)));
    const offer = effectPromptOf(parked.state, "attachCards");
    expect(offer.max).toBe(2);
    const candidates = offer.candidates;
    expect(new Set(ids(parked.state, candidates))).toEqual(new Set([M]));
    const to = { seat: "p1", spot: { spot: "bench", index: 1 } };
    const done = resolve(parked.state, {
      kind: "attachCards",
      assignments: [
        { uid: candidates[0], to },
        { uid: candidates[1], to },
      ],
    });
    expect(ids(done.state, done.state.players.p1.bench[1]?.energy ?? [])).toEqual([M, M]);
    expect(done.state.players.p1.bench[0]?.energy).toEqual([]);
    expect(shuffled(done.events)).toContain("p1");
  });

  it("refused from the Active Spot (the Bench clause)", () => {
    const state = table({ active: SOLGALEO, hand: [] });
    expect(refusal(use(state, "Sunrise", ACTIVE))).toBe("ABILITY_BENCH_ONLY");
  });
});

describe('D602 §8 — the two dropped texts stay unkeyed, and the version ( D611 (D539): "stay unkeyed" WITHDRAWN for Dragonair — keyed at D611)', () => {
  it("Dragonair `me02.5-151` and Larry's Komala `me02.5-175` carry no program ( D611 (D539): WITHDRAWN for Dragonair — it carries its D611 Ability; D628 (D539): WITHDRAWN for Larry's Komala — it carries its D628 Ability)", () => {
    expect(programFor("me02.5-151")?.abilities?.[0]?.name).toBe("Evolutionary Guidance");
    expect(programFor("me02.5-175")?.abilities?.[0]?.name).toBe("Lethargic Charge");
  });
});
