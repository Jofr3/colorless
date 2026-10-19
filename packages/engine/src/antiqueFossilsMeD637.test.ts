import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { cardOfUid, hpOf } from "./cards";
import { CATALOG_MANIFEST } from "./catalogManifest";
import { opposingAttackDebuff, passivesOf, seatDamageReduction } from "./continuous";
import type { GameEvent } from "./events";
import { FOSSIL_IDS, fossilPokemonCard } from "./fossils";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  trainerCard,
} from "./testFixtures";

// ── 🆕🆕🆕 D637 — THE FOUR `me` ANTIQUE FOSSILS: 4 TEXTS / 4 PRINTINGS, MATCH_RECORD_VERSION 45 → 46 ──
//
// D635's drops: Antique Jaw Fossil `me03-068` "Intimidating Jaw", Antique Sail Fossil `me03-069` "Protective Sail",
// Antique Armor Fossil `me05-072` "Protective Armor", Antique Skull Fossil `me05-073` "Spiny Skull". Each joins
// `FOSSIL_IDS` on D576's `playAsPokemon`, its face off the catalog row (D581). Every id and text off the LOCAL D1
// (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-10, `legal_standard = 1`; before this slice the four ids were
// only in D635's drop notes, the manifest, D581's face pins and the census. Driven on a LOCAL `cardPool` (D275) in
// the suite's OWN 60-card deck (D270). The migration is apps/api `fossilsMigrationD637.test.ts`.

const FOSSIL_RULE =
  "Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.\n\nAt any time during your turn, you may discard this card from play.";
const JAW_TEXT =
  "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 30 less damage (before applying Weakness and Resistance).";
const SAIL_TEXT =
  "Whenever your opponent plays a Supporter card from their hand, prevent all effects of that card done to this Pokémon.";
const ARMOR_TEXT =
  "As long as this Pokémon is in the Active Spot, all of your Pokémon take 10 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance).";
const SKULL_TEXT =
  "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 3 damage counters on the Attacking Pokémon.";
const QUARRY_TEXT =
  'Once during each player\'s turn, that player may search their deck for up to 2 Item cards that have "Antique" in their name and put them onto their Bench. Then, that player shuffles their deck.';
const BEATDOWN_TEXT =
  'This attack does 30 more damage for each of your Benched Pokémon that has "Antique" in its name.';

const JAW = "me03-068";
const SAIL = "me03-069";
const ARMOR = "me05-072";
const SKULL = "me05-073";
const ME_FOSSILS = [JAW, SAIL, ARMOR, SKULL] as const;
const COVER = "sv07-129";
const QUARRY = "me05-076";
const RELICANTH = "me05-017";
const BOSS = "sv02-172"; // Boss's Orders — a SUPPORTER gust off the opponent's Bench
const HAMMER = "fix-hammer"; // an ITEM: discard an Energy from 1 of the opponent's Pokémon (opponentChosen)
const KLEFKI = "sv01-096"; // Mischievous Lock — Basic Pokémon in play have no Abilities
const TAP = "d637-tap"; // 50 damage, no cost
const SMASH = "d637-smash"; // 100 damage, no cost
const WALL = "d637-wall";
const SNIPER = "fix-sniper"; // Spread Shot: 30 to the Active, 20 to each of the opponent's Benched Pokémon
const ENERGY = "fix-energy";

/** A fossil exactly as the catalog row arrives (D581: its printed `hp` and `abilities`). */
function fossilRow(id: string, name: string): Card {
  const face = CATALOG_MANIFEST.trainerFaces[id];
  if (face === undefined) throw new Error(`no catalog face for ${id}`);
  return { ...trainerCard(id, "Item", FOSSIL_RULE), name, hp: face.hp, abilities: face.abilities };
}

const LOCAL_CARDS: Record<string, Card> = {
  [JAW]: fossilRow(JAW, "Antique Jaw Fossil"),
  [SAIL]: fossilRow(SAIL, "Antique Sail Fossil"),
  [ARMOR]: fossilRow(ARMOR, "Antique Armor Fossil"),
  [SKULL]: fossilRow(SKULL, "Antique Skull Fossil"),
  [COVER]: fossilRow(COVER, "Antique Cover Fossil"),
  [QUARRY]: { ...trainerCard(QUARRY, "Stadium", QUARRY_TEXT), name: "Fossil Quarry" },
  [RELICANTH]: battler(RELICANTH, {
    name: "Relicanth",
    types: ["Water"],
    hp: 100,
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Fossil Beatdown", damage: "10+", effect: BEATDOWN_TEXT }],
  }),
  [TAP]: battler(TAP, { name: "D637 Tap", hp: 300, types: ["Colorless"], attacks: [{ cost: [], name: "Tap", damage: "50" }] }),
  [SMASH]: battler(SMASH, {
    name: "D637 Smash",
    hp: 300,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Smash", damage: "100" }],
  }),
  [WALL]: battler(WALL, { name: "D637 Wall", hp: 900, types: ["Colorless"] }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [JAW]: 2,
  [SAIL]: 2,
  [ARMOR]: 2,
  [SKULL]: 2,
  [COVER]: 1,
  [QUARRY]: 1,
  [RELICANTH]: 1,
  [BOSS]: 2,
  [HAMMER]: 2,
  [KLEFKI]: 1,
  [TAP]: 4,
  [SMASH]: 2,
  [SNIPER]: 1,
  [WALL]: 23,
  [ENERGY]: 14,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup with p2 going first; returns p1's (unrestricted) turn 2 after p2 passed. */
function opened(seed: number): GameState {
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
    const uid = state.players[s].hand.find((h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic");
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** TEST SURGERY — both hands and every Prize back into the decks, so every card is reachable. */
function emptied(state: GameState): GameState {
  const players = { ...state.players };
  for (const seat of ["p1", "p2"] as const) {
    const side = players[seat];
    players[seat] = { ...side, deck: [...side.deck, ...side.hand, ...side.prizes], hand: [], prizes: [] };
  }
  return { ...state, players };
}

/** p1's turn 2: `active` for p1 and `oppActive` for p2, each Bench exactly the listed bodies. Prizes are restored
    from the deck so a Knock Out can be paid. */
function table(
  active: string,
  bench: readonly string[] = [],
  oppActive: string = WALL,
  oppBench: readonly string[] = [],
  seed = 6371,
): GameState {
  let state = emptied(opened(seed));
  state = setActiveFromDeck(state, "p1", active);
  state = setActiveFromDeck(state, "p2", oppActive);
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  for (const id of oppBench) state = benchFromDeck(state, "p2", id);
  const players = { ...state.players };
  for (const seat of ["p1", "p2"] as const) {
    const side = players[seat];
    const prizes = side.deck.filter((u) => state.cardIdByUid[u] === WALL).slice(0, 6);
    players[seat] = { ...side, prizes, deck: side.deck.filter((u) => !prizes.includes(u)) };
  }
  return { ...state, players };
}

const hit = (state: GameState) => mustApply(state, { type: "attack", seat: "p1", index: 0 });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const idOf = (state: GameState, body: InPlayPokemon | null | undefined) => state.cardIdByUid[body?.stack[0] ?? ""];

function play(state: GameState, cardId: string, seat: Seat = "p1") {
  const withCard = handFromDeck(state, seat, cardId, 1);
  return mustApply(withCard, { type: "playTrainer", seat, uid: handUid(withCard, seat, cardId) });
}

/** The candidate refs a parked prompt offers, as "active" / "bench:N" (a one-candidate set auto-resolves). */
function offered(state: GameState): string[] {
  if (state.phase.kind !== "effect:choose") return [];
  const prompt = state.phase.prompt;
  const refs =
    prompt.kind === "choosePokemon"
      ? prompt.candidates
      : prompt.kind === "discardEnergy"
        ? prompt.discardable.map((c) => c.from)
        : [];
  return refs.map((ref) => (ref.spot.spot === "active" ? "active" : `bench:${ref.spot.index}`));
}

describe("D637 §1 — the prints and the programs", () => {
  it("the four catalog faces print the texts this slice built (LOCAL D1)", () => {
    const texts = { [JAW]: JAW_TEXT, [SAIL]: SAIL_TEXT, [ARMOR]: ARMOR_TEXT, [SKULL]: SKULL_TEXT };
    const names = { [JAW]: "Intimidating Jaw", [SAIL]: "Protective Sail", [ARMOR]: "Protective Armor", [SKULL]: "Spiny Skull" };
    for (const id of ME_FOSSILS) {
      const face = CATALOG_MANIFEST.trainerFaces[id];
      expect(face?.hp, id).toBe(60);
      expect(face?.abilities, id).toEqual([{ type: "Ability", name: names[id], effect: texts[id] }]);
    }
  });

  it("each is a fossil program: `playAsPokemon` and its printed Ability as the passive", () => {
    expect(programFor(JAW)).toEqual({ playAsPokemon: true, passive: { opponentActiveAttackDebuff: 30 } });
    expect(programFor(SAIL)).toEqual({ playAsPokemon: true, passive: { preventSupporterEffects: true } });
    expect(programFor(ARMOR)).toEqual({
      playAsPokemon: true,
      passive: { seatDamageReductionAfterWR: { amount: 10, sourceActive: true } },
    });
    expect(programFor(SKULL)).toEqual({ playAsPokemon: true, passive: { damageAttacker: { amount: 30 } } });
  });

  it("the two word-for-word twins share their twin's field and number", () => {
    expect(programFor(JAW)?.passive).toEqual(programFor("me01-024")?.passive); // Pyroar "Intimidating Fang"
    expect(programFor(SKULL)?.passive).toEqual(programFor("me02.5-068")?.passive); // Hop's Pincurchin ex "Counterattack Quills"
  });

  it("all four are `FOSSIL_IDS` ids with a 60-HP Basic {C} in-play face carrying the printed Ability", () => {
    for (const id of ME_FOSSILS) {
      expect(FOSSIL_IDS.has(id), id).toBe(true);
      const face = fossilPokemonCard(POOL[id] as Card);
      expect(face.category, id).toBe("Pokemon");
      expect(face.stage, id).toBe("Basic");
      expect(face.types, id).toEqual(["Colorless"]);
      expect(hpOf(face), id).toBe(60);
      expect(face.abilities, id).toEqual(CATALOG_MANIFEST.trainerFaces[id]?.abilities);
    }
  });
});

describe("D637 §2 — played from the hand onto the Bench, with the card rules", () => {
  it("each `me` fossil is played as an Item onto the Bench and is a Pokémon there", () => {
    for (const id of ME_FOSSILS) {
      const { state } = play(table(TAP), id);
      const body = state.players.p1.bench[0];
      expect(idOf(state, body), id).toBe(id);
      const face = cardOfUid(state, body?.stack[0] ?? "");
      expect(face?.category, id).toBe("Pokemon");
      expect(state.players.p1.discard.some((u) => state.cardIdByUid[u] === id), id).toBe(false);
    }
  });

  it("an Active `me` fossil can't retreat (the card rule rides `FOSSIL_IDS`)", () => {
    let state = table(SKULL, [WALL]);
    state = attachFromDeck(state, "p1", ENERGY, 1);
    expectErr(state, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 }, "RETREAT_PREVENTED");
  });
});

describe("D637 §3 — Antique Jaw Fossil \"Intimidating Jaw\": the opposing Active's attacks do 30 less", () => {
  it("Active: a 50 Tap on the Jaw does 20", () => {
    const { state } = hit(table(TAP, [], JAW));
    expect(state.players.p2.active?.damage).toBe(20);
  });

  it("Benched: no debuff — the Active Wall takes the whole 50", () => {
    const { state } = hit(table(TAP, [], WALL, [JAW]));
    expect(state.players.p2.active?.damage).toBe(50);
  });

  it("the scan reads the opposing Active only, and §9: Klefki's lock takes it down (a Basic's Ability)", () => {
    const board = table(TAP, [], JAW);
    expect(opposingAttackDebuff(board, board.players.p1.active as InPlayPokemon)).toBe(30);
    expect(opposingAttackDebuff(board, board.players.p2.active as InPlayPokemon)).toBe(0);
    const locked = table(KLEFKI, [], JAW);
    expect(opposingAttackDebuff(locked, locked.players.p1.active as InPlayPokemon)).toBe(0);
  });
});

describe("D637 §4 — Antique Sail Fossil \"Protective Sail\": the opponent's Supporters, not their Items", () => {
  it("Boss's Orders does not offer a benched Sail; the other two are offered", () => {
    const { state, events } = play(table(TAP, [], WALL, [SAIL, WALL, WALL]), BOSS);
    expect(offered(state)).toEqual(["bench:1", "bench:2"]);
    expect(of(events, "TRAINER_EFFECT_PREVENTED")).toMatchObject([{ seat: "p2", trainerType: "supporter" }]);
  });

  it("a lone benched Sail: Boss's Orders gusts nothing and the Wall stays Active", () => {
    const { state } = play(table(TAP, [], WALL, [SAIL]), BOSS);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(idOf(state, state.players.p2.active)).toBe(WALL);
    expect(idOf(state, state.players.p2.bench[0])).toBe(SAIL);
  });

  it("an Item still reaches it: Crushing Hammer's choice offers the Sail's Energy", () => {
    let board = table(TAP, [], SAIL, [WALL]);
    board = attachFromDeck(board, "p2", ENERGY, 1);
    board = attachBenchFromDeck(board, "p2", 0, ENERGY, 1);
    const { state, events } = play(board, HAMMER);
    expect(offered(state)).toEqual(["active", "bench:0"]);
    expect(of(events, "TRAINER_EFFECT_PREVENTED")).toEqual([]);
  });

  it("the fold: a Sail answers wherever it stands, and Klefki's lock switches it off", () => {
    const board = table(TAP, [], WALL, [SAIL]);
    const sail = board.players.p2.bench[0] as InPlayPokemon;
    expect(passivesOf(board, sail).preventSupporterEffects).toBe(true);
    expect(passivesOf(board, sail).preventTrainerEffects).toBe(false);
    const active = table(TAP, [], SAIL);
    expect(passivesOf(active, active.players.p2.active as InPlayPokemon).preventSupporterEffects).toBe(true);
    const locked = table(KLEFKI, [], WALL, [SAIL]);
    expect(passivesOf(locked, locked.players.p2.bench[0] as InPlayPokemon).preventSupporterEffects).toBe(false);
    const { state } = play(table(KLEFKI, [], WALL, [SAIL, WALL]), BOSS);
    expect(offered(state)).toEqual(["bench:0", "bench:1"]);
  });
});

describe("D637 §5 — Antique Armor Fossil \"Protective Armor\": all of yours take 10 less while it is Active", () => {
  it("Active: the Armor itself takes 40 from a 50 Tap", () => {
    const { state } = hit(table(TAP, [], ARMOR, [WALL]));
    expect(state.players.p2.active?.damage).toBe(40);
  });

  it("Benched: the Active Wall takes the whole 50 — the source-zone gate, not the target", () => {
    const { state } = hit(table(TAP, [], WALL, [ARMOR]));
    expect(state.players.p2.active?.damage).toBe(50);
  });

  it("the scan: every one of the Armor side's bodies pays 10 while it is Active, and none while it is Benched", () => {
    const active = table(TAP, [], ARMOR, [WALL, WALL]);
    const side = active.players.p2;
    for (const body of [side.active, ...side.bench]) {
      expect(seatDamageReduction(active, body as InPlayPokemon, "all", "p1")).toBe(10);
    }
    expect(seatDamageReduction(active, active.players.p1.active as InPlayPokemon, "all", "p2")).toBe(0);
    const benched = table(TAP, [], WALL, [ARMOR, WALL]);
    for (const body of [benched.players.p2.active, ...benched.players.p2.bench]) {
      expect(seatDamageReduction(benched, body as InPlayPokemon, "all", "p1")).toBe(0);
    }
  });

  it("§9: Klefki's lock takes it down", () => {
    const board = table(KLEFKI, [], ARMOR);
    expect(seatDamageReduction(board, board.players.p2.active as InPlayPokemon, "all", "p1")).toBe(0);
  });
});

describe("D637 §6 — Antique Skull Fossil \"Spiny Skull\": 3 counters on the attacker when the Active Skull is hit", () => {
  it("Active and damaged: the attacker takes 30", () => {
    const { state } = hit(table(TAP, [], SKULL, [WALL]));
    expect(state.players.p2.active?.damage).toBe(50);
    expect(state.players.p1.active?.damage).toBe(30);
  });

  it("even if Knocked Out: a 100 Smash KOs the Skull and still takes 30", () => {
    const { state } = hit(table(SMASH, [], SKULL, [WALL]));
    expect(state.players.p2.discard.some((u) => state.cardIdByUid[u] === SKULL)).toBe(true);
    expect(state.players.p1.active?.damage).toBe(30);
  });

  it("Benched: nothing — the hit on the Active Wall pays no counters", () => {
    const { state } = hit(table(TAP, [], WALL, [SKULL]));
    expect(state.players.p1.active?.damage).toBe(0);
  });

  it("Benched AND damaged: a spread hit on the benched Skull pays no counters (\"in the Active Spot\")", () => {
    const { state } = hit(attachFromDeck(table(SNIPER, [], WALL, [SKULL]), "p1", ENERGY, 1));
    expect(idOf(state, state.players.p2.bench[0])).toBe(SKULL);
    expect(state.players.p2.bench[0]?.damage).toBe(20);
    expect(state.players.p1.active?.damage).toBe(0);
  });
});

describe("D637 §7 — Fossil Quarry and Fossil Beatdown reach the new fossils", () => {
  it("Fossil Quarry now offers the four `me` fossils beside the `sv` one", () => {
    let board = table(TAP);
    const side = board.players.p1;
    const uid = side.deck.find((u) => board.cardIdByUid[u] === QUARRY) as string;
    board = {
      ...board,
      stadium: { uid, owner: "p1" },
      players: { ...board.players, p1: { ...side, deck: side.deck.filter((u) => u !== uid) } },
    };
    const { state } = mustApply(board, { type: "useStadiumAbility", seat: "p1" });
    if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "chooseCards") throw new Error("no prompt");
    const ids = new Set(state.phase.prompt.candidates.map((u) => state.cardIdByUid[u]));
    expect(ids).toEqual(new Set([...ME_FOSSILS, COVER]));
  });

  it("Relicanth \"Fossil Beatdown\" counts a benched `me` fossil (+30 each)", () => {
    const charged = attachFromDeck(table(RELICANTH, [JAW, SKULL]), "p1", ENERGY, 1);
    expect(hit(charged).state.players.p2.active?.damage).toBe(70);
  });

  it("the engine is 0.542.0", () => {
    expect(engineVersion).toBe("0.542.0");
  });
});
