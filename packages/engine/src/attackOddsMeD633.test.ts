import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState } from "./index";
import { applyAction, formatElapsed, logFromEvents } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  trainerCard,
  typedEnergy,
  must,
  unprize,
  driveSetup,
} from "./testFixtures";

const YEET = "You may discard any number of cards from your hand.";
const ROCKET_FEATHERS =
  'You may discard any number of Supporter cards that have "Team Rocket" in their name from your hand, and this attack does 60 damage for each card you discarded in this way.';
const SWORDS =
  "Reveal any number of Honedge, Doublade, and Aegislash from your hand, and this attack does 60 damage for each card you revealed in this way.";
const VOLTAIC_FIST =
  "You may have this Pokémon also do 60 damage to itself and make your opponent's Active Pokémon Paralyzed.";
const ELEMENTAL_BLAST = "Discard a {R} Energy, a {W} Energy, and a {L} Energy from this Pokémon.";
const OVERWRITING_BOLT =
  "The Defending Pokémon's Weakness is now {L} until the end of your next turn. (Apply Weakness as ×2.)";

const SENTENCES: readonly (readonly [string, readonly string[]])[] = [
  [YEET, ["me05-029"]],
  [ROCKET_FEATHERS, ["me02.5-127"]],
  [SWORDS, ["mep-067", "me03-057", "me03-098"]],
  [VOLTAIC_FIST, ["me02-034"]],
  [ELEMENTAL_BLAST, ["30th-121"]],
];

describe("D633 §1 — the texts", () => {
  it("5 sentences / 7 printings, each a row of the committed `me` corpus, none printed in legal `sv`, each now read", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, ids] of SENTENCES) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
      for (const id of ids) expect(programFor(id), id).toBeUndefined();
    }
    expect(SENTENCES.flatMap(([, ids]) => ids)).toHaveLength(7);
  });

  it("Overwriting Bolt stays unbuilt, named: no reader, no key ( D640 (D539): read since D640, still no key)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    expect(me.get(OVERWRITING_BOLT)).toBe(1);
    expect(resolvedByAnyReader(OVERWRITING_BOLT)).toBe(true);
    expect(programFor("30th-040")).toBeUndefined();
  });

  it("no new anchor claims a legal `sv` sentence: the legal `sv` column prints none of the four openings", () => {
    const opening =
      /^You may discard any number of |^Reveal any number of |^You may have this Pokémon also do |^Discard a \{.\} Energy, a /;
    expect(legalAttackCorpus().filter(([, text]) => opening.test(text))).toEqual([]);
  });
});

describe("D633 §2 — the readings", () => {
  it("All-You-Can-Yeet: the uncapped declinable hand discard, no filter, no slot", () => {
    expect(deriveAttackEffect(YEET)).toEqual([
      { op: "payFromHand", count: "any", cap: "any", to: "discard" },
    ]);
  });

  it("Rocket Feathers: the same payment on the Team Rocket Supporter noun, then 60 per discarded card", () => {
    expect(deriveAttackEffect(ROCKET_FEATHERS)).toEqual([
      {
        op: "payFromHand",
        count: "any",
        cap: "any",
        to: "discard",
        filter: { kind: "supporterNameContaining", fragment: "Team Rocket" },
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 60, count: "discarded" },
    ]);
    // A printed 0 per card stays loud; the curly quotes read the same.
    expect(deriveAttackEffect(ROCKET_FEATHERS.replace("does 60", "does 0"))).toBeNull();
    expect(deriveAttackEffect(ROCKET_FEATHERS.replace('"Team Rocket"', "“Team Rocket”"))).toEqual(
      deriveAttackEffect(ROCKET_FEATHERS),
    );
    expect(deriveAttackEffect(ROCKET_FEATHERS.replace("Team Rocket", "Team Star"))).toBeNull();
  });

  it("Weaponized Swords: the reveal by printed names, then 60 per revealed card", () => {
    expect(deriveAttackEffect(SWORDS)).toEqual([
      {
        op: "revealFromHand",
        filter: {
          kind: "anyOf",
          filters: [
            { kind: "byName", name: "Honedge" },
            { kind: "byName", name: "Doublade" },
            { kind: "byName", name: "Aegislash" },
          ],
        },
        note: "Reveal any number of Honedge, Doublade, and Aegislash from your hand.",
        recordAs: "revealed",
      },
      { op: "damageDefender", per: 60, count: "revealed" },
    ]);
    expect(deriveAttackEffect(SWORDS.replace("does 60", "does 0"))).toBeNull();
    expect(deriveAttackEffect(SWORDS.replace(" from your hand", " from your deck"))).toBeNull();
  });

  it("Voltaic Fist: one confirm over the self-damage and the Paralysis (the D590 rule)", () => {
    expect(deriveAttackEffect(VOLTAIC_FIST)).toEqual([
      {
        op: "optional",
        note: VOLTAIC_FIST,
        ops: [
          { op: "damageSelf", amount: 60 },
          { op: "applyStatus", target: "defender", status: "paralyzed" },
        ],
      },
    ]);
    expect(deriveAttackEffect(VOLTAIC_FIST.replace("Paralyzed", "Asleep"))).toBeNull();
    expect(deriveAttackEffect(VOLTAIC_FIST.replace("do 60", "do 0"))).toBeNull();
  });

  it("Elemental Blast: three count-1 picks off the attacker, each but the last reserving the types still owed", () => {
    const typed = (energyType: string, reserve?: string[]) => ({
      op: "discardEnergy",
      from: "yourActive",
      filter: { kind: "providesEnergy", energyType },
      count: 1,
      ...(reserve === undefined ? {} : { reserve }),
    });
    expect(deriveAttackEffect(ELEMENTAL_BLAST)).toEqual([
      typed("Fire", ["Water", "Lightning"]),
      typed("Water", ["Lightning"]),
      typed("Lightning"),
    ]);
    expect(deriveAttackEffect(ELEMENTAL_BLAST.replace("{L}", "{C}"))).toBeNull();
  });
});

// ── ON A BOARD ──

const FILLER = "d633-filler";
const HONEDGE = "d633-honedge";
const AEGISLASH = "d633-aegislash";
const TR_ARCHER = "d633-tr-archer";
const TR_PETREL = "d633-tr-petrel";
const PLAIN_SUPPORTER = "d633-plain-supporter";
const R = "d633-fire";
const W = "d633-water";
const L = "d633-lightning";
const P = "d633-psychic";
const LEGACY = "fix-legacy-energy";

const mon = (
  id: string,
  name: string,
  hp: number,
  type: string,
  attacks: Card["attacks"],
  extra: Partial<Card> = {},
) => battler(id, { name, hp, types: [type], retreat: 2, attacks, ...extra });
const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];
const supporter = (id: string, name: string): Card => ({
  ...trainerCard(id, "Supporter", "Draw a card."),
  name,
});

const LOCAL: Record<string, Card> = {
  "me05-029": mon("me05-029", "Slowpoke", 70, "Psychic", [
    { cost: ["Psychic"], name: "All-You-Can-Yeet", effect: YEET },
    { cost: ["Colorless", "Colorless"], name: "Headbutt", damage: 20 },
  ]),
  "me02.5-127": mon(
    "me02.5-127",
    "Team Rocket's Honchkrow",
    130,
    "Darkness",
    [
      {
        cost: ["Colorless", "Colorless"],
        name: "Rocket Feathers",
        damage: "60×",
        effect: ROCKET_FEATHERS,
      },
      { cost: ["Darkness", "Colorless", "Colorless"], name: "Hammer In", damage: 100 },
    ],
    { stage: "Stage1", evolveFrom: "Team Rocket's Murkrow" },
  ),
  "me03-057": mon(
    "me03-057",
    "Doublade",
    100,
    "Metal",
    [
      {
        cost: ["Colorless", "Colorless"],
        name: "Weaponized Swords",
        damage: "60×",
        effect: SWORDS,
      },
    ],
    { stage: "Stage1", evolveFrom: "Honedge" },
  ),
  "me02-034": mon(
    "me02-034",
    "Pawmot",
    140,
    "Lightning",
    [{ cost: ["Lightning", "Lightning"], name: "Voltaic Fist", damage: 130, effect: VOLTAIC_FIST }],
    { stage: "Stage2", evolveFrom: "Pawmo" },
  ),
  "30th-121": mon("30th-121", "Lugia", 120, "Colorless", [
    {
      cost: ["Fire", "Water", "Lightning"],
      name: "Elemental Blast",
      damage: 250,
      effect: ELEMENTAL_BLAST,
    },
  ]),
  [FILLER]: mon(FILLER, "D633 Filler", 400, "Colorless", TAP),
  [HONEDGE]: mon(HONEDGE, "Honedge", 70, "Metal", TAP),
  [AEGISLASH]: mon(AEGISLASH, "Aegislash", 150, "Metal", TAP, {
    stage: "Stage2",
    evolveFrom: "Doublade",
  }),
  [TR_ARCHER]: supporter(TR_ARCHER, "Team Rocket's Archer"),
  [TR_PETREL]: supporter(TR_PETREL, "Team Rocket's Petrel"),
  [PLAIN_SUPPORTER]: supporter(PLAIN_SUPPORTER, "Professor's Research"),
  [R]: typedEnergy(R, "Fire"),
  [W]: typedEnergy(W, "Water"),
  [L]: typedEnergy(L, "Lightning"),
  [P]: typedEnergy(P, "Psychic"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  "me05-029": 1,
  "me02.5-127": 1,
  "me03-057": 2,
  "me02-034": 1,
  "30th-121": 1,
  [FILLER]: 8,
  [HONEDGE]: 2,
  [AEGISLASH]: 1,
  [TR_ARCHER]: 2,
  [TR_PETREL]: 1,
  [PLAIN_SUPPORTER]: 2,
  [R]: 3,
  [W]: 3,
  [L]: 4,
  [P]: 2,
  [LEGACY]: 1,
  "fix-energy": 25,
});
const BOARD_IDS = new Set(
  Object.keys(LOCAL)
    .filter((id) => id !== FILLER)
    .concat([LEGACY]),
);

/** Setup, then P1's own FIRST turn (P2 went first and passed); both hands back into the decks. */
function p1Turn(): GameState {
  let state = driveSetup(6331, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    state = {
      ...state,
      players: { ...state.players, [s]: { ...side, hand: [], deck: [...side.deck, ...side.hand] } },
    };
  }
  return state;
}

/** P1's Active is `attacker` with `energy` and `hand` in hand (a Filler on the Bench); P2's Active a Filler. */
function table(
  attacker: string,
  energy: readonly (readonly [string, number])[],
  hand: readonly (readonly [string, number])[] = [],
): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const)
    state = unprize(clearBench(setActiveFromDeck(state, s, FILLER), s), s, BOARD_IDS);
  state = benchFromDeck(clearBench(setActiveFromDeck(state, "p1", attacker), "p1"), "p1", FILLER);
  for (const [id, n] of energy) state = attachFromDeck(state, "p1", id, n);
  for (const [id, n] of hand) state = handFromDeck(state, "p1", id, n);
  return clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
}

const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index });
const resolve = (state: GameState, choice: unknown) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice } as GameAction);
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
const handUids = (state: GameState, id: string) =>
  state.players.p1.hand.filter((u) => state.cardIdByUid[u] === id);
const defenderDamage = (state: GameState) => state.players.p2.active?.damage ?? -1;

function parkedCards(state: GameState) {
  if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected a chooseCards park, got ${state.phase.kind}`);
  }
  return state.phase.prompt;
}

describe("D633 §3 — All-You-Can-Yeet and Rocket Feathers on a board", () => {
  it("All-You-Can-Yeet: every hand card is offered, 0..all; the picks are discarded", () => {
    const state = table(
      "me05-029",
      [[P, 1]],
      [
        [TR_ARCHER, 1],
        [PLAIN_SUPPORTER, 2],
      ],
    );
    const parked = mustApply(state, attack(0)).state;
    const prompt = parkedCards(parked);
    expect([prompt.min, prompt.max, prompt.candidates.length, prompt.dest]).toEqual([
      0,
      3,
      3,
      "discard",
    ]);
    expect(prompt.note).toBe("Discard any number of cards from your hand.");
    const two = resolve(parked, { kind: "cards", uids: handUids(parked, PLAIN_SUPPORTER) }).state;
    expect(ids(two, two.players.p1.hand)).toEqual([TR_ARCHER]);
    expect(ids(two, two.players.p1.discard)).toEqual([PLAIN_SUPPORTER, PLAIN_SUPPORTER]);
    const none = resolve(parked, { kind: "cards", uids: [] }).state;
    expect(none.players.p1.hand).toHaveLength(3);
  });

  it("All-You-Can-Yeet with an empty hand: no park, nothing happens", () => {
    const result = mustApply(table("me05-029", [[P, 1]]), attack(0));
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(defenderDamage(result.state)).toBe(0);
  });

  it("Rocket Feathers: only the Team Rocket Supporters are offered; 2 discarded → 120", () => {
    const state = table(
      "me02.5-127",
      [["fix-energy", 2]],
      [
        [TR_ARCHER, 2],
        [TR_PETREL, 1],
        [PLAIN_SUPPORTER, 1],
      ],
    );
    const parked = mustApply(state, attack(0)).state;
    const prompt = parkedCards(parked);
    expect(ids(parked, prompt.candidates)).toEqual([TR_ARCHER, TR_ARCHER, TR_PETREL]);
    expect([prompt.min, prompt.max]).toEqual([0, 3]);
    const done = resolve(parked, {
      kind: "cards",
      uids: [...handUids(parked, TR_PETREL), ...handUids(parked, TR_ARCHER).slice(0, 1)],
    }).state;
    expect(defenderDamage(done)).toBe(120);
    expect(ids(done, done.players.p1.hand).sort()).toEqual([PLAIN_SUPPORTER, TR_ARCHER].sort());
  });

  it("Rocket Feathers declined: 0 damage; no Team Rocket Supporter in hand: no park, 0 damage", () => {
    const parked = mustApply(
      table("me02.5-127", [["fix-energy", 2]], [[TR_ARCHER, 1]]),
      attack(0),
    ).state;
    expect(defenderDamage(resolve(parked, { kind: "cards", uids: [] }).state)).toBe(0);
    const bare = mustApply(
      table("me02.5-127", [["fix-energy", 2]], [[PLAIN_SUPPORTER, 2]]),
      attack(0),
    );
    expect(bare.state.phase.kind).not.toBe("effect:choose");
    expect(defenderDamage(bare.state)).toBe(0);
  });
});

describe("D633 §4 — Weaponized Swords on a board", () => {
  it("the named cards are offered (dest `reveal`); 2 revealed → 120, both stay in the hand, the row names them", () => {
    const state = table(
      "me03-057",
      [["fix-energy", 2]],
      [
        [HONEDGE, 1],
        [AEGISLASH, 1],
        ["me03-057", 1],
        [PLAIN_SUPPORTER, 1],
      ],
    );
    const parked = mustApply(state, attack(0)).state;
    const prompt = parkedCards(parked);
    expect(ids(parked, prompt.candidates)).toEqual([HONEDGE, AEGISLASH, "me03-057"]);
    expect([prompt.min, prompt.max, prompt.dest]).toEqual([0, 3, "reveal"]);
    expect(prompt.note).toBe(
      "Reveal any number of Honedge, Doublade, and Aegislash from your hand.",
    );
    const picked = [...handUids(parked, HONEDGE), ...handUids(parked, AEGISLASH)];
    const done = resolve(parked, { kind: "cards", uids: picked });
    expect(defenderDamage(done.state)).toBe(120);
    expect(done.state.players.p1.hand).toEqual(parked.players.p1.hand);
    expect(of(done.events, "HAND_CARDS_REVEALED")).toEqual([
      { type: "HAND_CARDS_REVEALED", seat: "p1", uids: picked },
    ]);
    const rows = logFromEvents(of(done.events, "HAND_CARDS_REVEALED"), {
      names: { p1: "P1", p2: "P2" },
      state: done.state,
      elapsed: formatElapsed(0),
    });
    expect(
      rows.map((row) =>
        row.kind === "action" ? [row.who, row.segments.map((x) => x.text).join("")] : null,
      ),
    ).toEqual([["p1", "revealed from their hand: Honedge, Aegislash"]]);
  });

  it("one Honedge in hand: the lone match still asks (0 or 1), and revealing it is 60", () => {
    const state = table(
      "me03-057",
      [["fix-energy", 2]],
      [
        [HONEDGE, 1],
        [PLAIN_SUPPORTER, 1],
      ],
    );
    const parked = mustApply(state, attack(0)).state;
    expect([parkedCards(parked).min, parkedCards(parked).max]).toEqual([0, 1]);
    const done = resolve(parked, { kind: "cards", uids: handUids(parked, HONEDGE) });
    expect(defenderDamage(done.state)).toBe(60);
  });

  it("revealing none: 0 damage and no reveal row; nothing named in hand: no park", () => {
    const parked = mustApply(
      table("me03-057", [["fix-energy", 2]], [[HONEDGE, 2]]),
      attack(0),
    ).state;
    const none = resolve(parked, { kind: "cards", uids: [] });
    expect(defenderDamage(none.state)).toBe(0);
    expect(of(none.events, "HAND_CARDS_REVEALED")).toEqual([]);
    const bare = mustApply(
      table("me03-057", [["fix-energy", 2]], [[PLAIN_SUPPORTER, 1]]),
      attack(0),
    );
    expect(bare.state.phase.kind).not.toBe("effect:choose");
    expect(defenderDamage(bare.state)).toBe(0);
  });
});

describe("D633 §5 — Voltaic Fist on a board", () => {
  it("asks first; yes: 130, then 60 to itself and the Defending Pokémon is Paralyzed", () => {
    const parked = mustApply(table("me02-034", [[L, 2]]), attack(0)).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the confirm");
    expect(parked.phase.prompt).toStrictEqual({ kind: "confirm", note: VOLTAIC_FIST });
    expect(defenderDamage(parked)).toBe(130);
    const yes = resolve(parked, { kind: "confirm", yes: true }).state;
    expect(yes.players.p1.active?.damage).toBe(60);
    expect(yes.players.p2.active?.conditions.rotation).toBe("paralyzed");
  });

  it("no: the 130 only — no self-damage, no Paralysis", () => {
    const parked = mustApply(table("me02-034", [[L, 2]]), attack(0)).state;
    const no = resolve(parked, { kind: "confirm", yes: false }).state;
    expect(no.players.p1.active?.damage).toBe(0);
    expect(no.players.p2.active?.conditions.rotation).toBe("none");
    expect(defenderDamage(no)).toBe(130);
  });
});

describe("D633 §6 — Elemental Blast on a board (the matched discard, R-EB1)", () => {
  it("{R}{W}{L} plus Legacy: the {R} pick offers both providers, then the rest is forced; three come off", () => {
    const parked = mustApply(
      table("30th-121", [
        [R, 1],
        [W, 1],
        [L, 1],
        [LEGACY, 1],
      ]),
      attack(0),
    ).state;
    expect(defenderDamage(parked)).toBe(250);
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "discardEnergy") {
      throw new Error("expected the {R} pick");
    }
    expect(
      ids(
        parked,
        parked.phase.prompt.discardable.map((d) => d.uid),
      ).sort(),
    ).toEqual([R, LEGACY].sort());
    const legacy =
      parked.phase.prompt.discardable.find((d) => parked.cardIdByUid[d.uid] === LEGACY)?.uid ?? "";
    const done = resolve(parked, { kind: "discardEnergy", uids: [legacy] }).state;
    expect(ids(done, done.players.p1.active?.energy ?? [])).toEqual([R]);
    expect(ids(done, done.players.p1.discard).sort()).toEqual([LEGACY, W, L].sort());
  });

  it("{R}{W} plus Legacy (Legacy pays {L}): Legacy cannot fill the {R} slot, so all three come off, no park", () => {
    const result = mustApply(
      table("30th-121", [
        [R, 1],
        [W, 1],
        [LEGACY, 1],
      ]),
      attack(0),
    );
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(result.state.players.p1.active?.energy).toEqual([]);
    expect(ids(result.state, result.state.players.p1.discard).sort()).toEqual(
      [LEGACY, R, W].sort(),
    );
  });
});
