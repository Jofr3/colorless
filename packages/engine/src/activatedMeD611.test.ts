import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion, pokemonPlayBarred } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { formatElapsed, logFromEvents } from "./log";
import { redactGame } from "./redact";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  itemTrainer,
  setActiveFromDeck,
  setBenchDamage,
  specialEnergy,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D611 — WP21: THE REST OF THE `me` ACTIVATED ABILITIES, plus Dragonair (a WP20b drop) ──
//
// 9 printed texts / 17 `me` printings on nine new registry objects. Every id and text measured on the
// LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-08, `legal_standard = 1`; no id was keyed
// anywhere in the tree before this slice (Dragonair was pinned UNKEYED by D602). None prints "You can't
// use more than 1 … Ability each turn", so every lock is per Pokémon (`true`). New pieces:
// `payFromHand.swapWithTop`, `evolveFromDeck.fromHand` + `recordAs`, the op `countersOnRecordedBody`,
// the `BoardCondition` `notYourFirstTurn` and `requiresEnergyType: "any"`. Readings R-EG1, R-SE1, R-SE2
// (UNRULED) are pinned in §6 / §9. Dropped and named: Larry's Komala `me02.5-175` "Lethargic Charge"
// (an Active-only target AND a which-Energy-card choice — two pieces; §11 pins it unkeyed) [🆕🆕🆕 D628 (D539):
// BUILT at D628 (A1); §11 now pins the key].

const NIGHTTIME_MANEUVERS =
  "Once during your turn, if this Pokémon is in the Active Spot, you may use this Ability. Search your deck for a card. Shuffle your deck, then put that card on top of it.";
const SINISTER_SURGE =
  "Once during your turn, you may use this Ability. Search your deck for a Basic {D} Energy card and attach it to 1 of your Benched {D} Pokémon. Then, shuffle your deck. If you attached Energy to a Pokémon in this way, place 2 damage counters on that Pokémon.";
const BOISTEROUS_WIND =
  "Once during your turn, you may use this Ability. Flip a coin. If heads, put an Energy attached to your opponent's Active Pokémon into their hand.";
const DESTRUCTIVE_HEADBUTTING =
  "Once during your turn, if this Pokémon is in the Active Spot, you may use this Ability. Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon.";
const EVIDENCE_GATHERING =
  "Once during your turn, you may use this Ability. Switch a card from your hand with the top card of your deck.";
const SKY_HUNT =
  "Once during your turn, you may use this Ability. Flip a coin. If heads, discard a random card from your opponent's hand.";
const GRAND_WING =
  "Once during your turn, you may use this Ability. Your opponent shuffles their hand and puts it on the bottom of their deck. If they put any cards on the bottom of their deck in this way, they draw 4 cards.";
const SPITEFUL_EVOLUTION =
  "Once during your turn, you may use this Ability. Choose a card in your hand that evolves from this Pokémon and put it onto this Pokémon to evolve it. If you do, place 2 damage counters on the Pokémon you evolved in this way. You can't use this Ability during your first turn.";
const EVOLUTIONARY_GUIDANCE =
  "Once during your turn, if this Pokémon has any Energy attached, you may use this Ability. Search your deck for an Evolution Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.";

const CROBAT = ["me04-051", "me04-093", "mep-076"] as const;
const TOXTRICITY = ["me02-068", "me02-103", "mep-017"] as const;
const DUSTOX = ["me02.5-015", "me02.5-220"] as const;
const RAMPARDOS = ["me05-045", "me05-100"] as const;
const GUMSHOOS = ["me01-110", "me01-153"] as const;
const TALONFLAME = ["me03-014", "me03-091"] as const;
const VIVILLON = "me03-009";
const PHANTUMP = "me04-038";
const DRAGONAIR = "me02.5-151";
const KOMALA = "me02.5-175"; // Larry's Komala "Lethargic Charge" — dropped, stays unkeyed [🆕🆕🆕 D628 (D539): keyed at D628]
const TREVENANT = "me04-039"; // Stage 1, evolves from Phantump, 130 HP
const TREVENANT_SV = "sv06-013"; // Stage 1, evolves from Phantump, 120 HP

/** [Ability name, the keyed printings, the printed text, `activeOnly`, `benchOnly`]. */
const ABILITIES: readonly (readonly [string, readonly string[], string, boolean, boolean])[] = [
  ["Nighttime Maneuvers", CROBAT, NIGHTTIME_MANEUVERS, true, false],
  ["Sinister Surge", TOXTRICITY, SINISTER_SURGE, false, false],
  ["Boisterous Wind", DUSTOX, BOISTEROUS_WIND, false, false],
  ["Destructive Headbutting", RAMPARDOS, DESTRUCTIVE_HEADBUTTING, true, false],
  ["Evidence Gathering", GUMSHOOS, EVIDENCE_GATHERING, false, false],
  ["Sky Hunt", TALONFLAME, SKY_HUNT, false, false],
  ["Grand Wing", [VIVILLON], GRAND_WING, false, false],
  ["Spiteful Evolution", [PHANTUMP], SPITEFUL_EVOLUTION, false, false],
  ["Evolutionary Guidance", [DRAGONAIR], EVOLUTIONARY_GUIDANCE, false, false],
];

const abilityOf = (id: string) => programFor(id)?.abilities?.[0];

describe("D611 §1 — the programs: nine objects over 17 printings", () => {
  it("every keyed printing carries ONE activated Ability under its printed name, one object per text", () => {
    expect(ABILITIES.flatMap(([, ids]) => ids)).toHaveLength(17);
    for (const [name, ids] of ABILITIES) {
      for (const id of ids) {
        expect(Object.keys(programFor(id) ?? {}), id).toEqual(["abilities"]);
        expect(programFor(id)?.abilities, id).toHaveLength(1);
        expect(abilityOf(id)?.name, id).toBe(name);
        expect(programFor(id), id).toBe(programFor(ids[0] as string));
      }
    }
    expect(new Set(ABILITIES.map(([, ids]) => programFor(ids[0] as string))).size).toBe(9);
  });

  it("every lock is per Pokémon; the spot gates sit exactly where the print names a spot", () => {
    for (const [name, ids, text, activeOnly, benchOnly] of ABILITIES) {
      const ability = abilityOf(ids[0] as string);
      expect(text.startsWith("Once during your turn, "), name).toBe(true);
      expect(text.includes("You can't use more than 1"), name).toBe(false);
      expect(ability?.oncePerTurn, name).toBe(true);
      expect(text.includes("if this Pokémon is in the Active Spot"), name).toBe(activeOnly);
      expect(ability?.activeOnly, name).toBe(activeOnly);
      expect(text.includes("if this Pokémon is on your Bench"), name).toBe(benchOnly);
      expect(ability?.benchOnly === true, name).toBe(benchOnly);
    }
  });

  it("the gates: Spiteful Evolution's first-turn ban, Evolutionary Guidance's untyped Energy clause", () => {
    expect(abilityOf(PHANTUMP)?.playableIf).toEqual({ kind: "notYourFirstTurn" });
    expect(abilityOf(DRAGONAIR)?.requiresEnergyType).toBe("any");
    for (const [, ids] of ABILITIES) {
      const id = ids[0] as string;
      if (id !== PHANTUMP) expect(abilityOf(id)?.playableIf, id).toBeUndefined();
      if (id !== DRAGONAIR) expect(abilityOf(id)?.requiresEnergyType, id).toBeUndefined();
    }
  });

  it("the shipped-op programs", () => {
    expect(abilityOf(CROBAT[0])?.program).toEqual([
      { op: "shuffleDeck" },
      { op: "searchDeck", filter: { kind: "anyCard" }, max: 1, exact: true, dest: "deckTop" },
    ]);
    expect(abilityOf(DUSTOX[0])?.program).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
        then: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" }, to: "hand" }],
      },
    ]);
    // Destructive Headbutting is Haphazard Hammer `me01-097`'s program on an activated Ability.
    expect(abilityOf(RAMPARDOS[0])?.program).toEqual(programFor("me01-097")?.triggered?.[0]?.program);
    expect(abilityOf(TALONFLAME[0])?.program).toEqual([
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      { op: "coinFlipGate", then: [{ op: "randomFromOpponentHand", to: "discard" }] },
    ]);
    expect(abilityOf(VIVILLON)?.program).toEqual([
      { op: "handRefresh", who: "opponent", toBottom: true, onlyIfAnyMoved: true, draw: { kind: "fixed", count: 4 } },
    ]);
    expect(abilityOf(DRAGONAIR)?.program).toEqual([
      { op: "searchDeck", filter: { kind: "evolutionPokemon" }, dest: "hand", max: 1, reveal: true },
      { op: "shuffleDeck" },
    ]);
  });

  it("the new-piece programs", () => {
    expect(abilityOf(TOXTRICITY[0])?.program).toEqual([
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Darkness" },
        max: 1,
        targetType: "Darkness",
        benchOnly: true,
        recordAs: "moved",
      },
      { op: "shuffleDeck" },
      { op: "countersOnRecordedBody", slot: "moved", amount: 20 },
    ]);
    expect(abilityOf(GUMSHOOS[0])?.program).toEqual([
      { op: "payFromHand", count: 1, to: "deckTop", swapWithTop: true },
    ]);
    expect(abilityOf(PHANTUMP)?.program).toEqual([
      { op: "evolveFromDeck", fromHand: true, recordAs: "moved" },
      { op: "countersOnRecordedBody", slot: "moved", amount: 20 },
    ]);
  });

  it("no printed attack is registry-keyed (each keeps deriving)", () => {
    for (const [, ids] of ABILITIES)
      for (const id of ids) expect(programFor(id)?.attack, id).toBeUndefined();
  });
});

// ── ON A BOARD ──

const FILLER = "d611-filler"; // a {C} Basic, 300 HP
const DARK = "d611-dark"; // a {D} Basic, 60 HP
const ITEM = "d611-item";
const G = "d611-grass";
const D = "d611-darkness";
const SPECIAL = "d611-special";

const body = (id: string, name: string, ability: string, text: string, over: Partial<Card>): Card =>
  battler(id, {
    name,
    retreat: 1,
    abilities: [{ type: "Ability", name: ability, effect: text }],
    ...over,
  } as Partial<Card>);

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(
    CROBAT.map((id) => [
      id,
      body(id, "Crobat", "Nighttime Maneuvers", NIGHTTIME_MANEUVERS, {
        stage: "Stage2",
        evolveFrom: "Golbat",
        hp: 130,
        types: ["Darkness"],
      }),
    ]),
  ),
  ...Object.fromEntries(
    TOXTRICITY.map((id) => [
      id,
      body(id, "Toxtricity", "Sinister Surge", SINISTER_SURGE, {
        stage: "Stage1",
        evolveFrom: "Toxel",
        hp: 140,
        types: ["Darkness"],
      }),
    ]),
  ),
  ...Object.fromEntries(
    DUSTOX.map((id) => [
      id,
      body(id, "Dustox", "Boisterous Wind", BOISTEROUS_WIND, {
        stage: "Stage2",
        evolveFrom: "Cascoon",
        hp: 140,
        types: ["Grass"],
      }),
    ]),
  ),
  ...Object.fromEntries(
    RAMPARDOS.map((id) => [
      id,
      body(id, "Rampardos ex", "Destructive Headbutting", DESTRUCTIVE_HEADBUTTING, {
        stage: "Stage2",
        evolveFrom: "Cranidos",
        hp: 330,
        types: ["Fighting"],
      }),
    ]),
  ),
  ...Object.fromEntries(
    GUMSHOOS.map((id) => [
      id,
      body(id, "Gumshoos", "Evidence Gathering", EVIDENCE_GATHERING, {
        stage: "Stage1",
        evolveFrom: "Yungoos",
        hp: 100,
        types: ["Colorless"],
      }),
    ]),
  ),
  ...Object.fromEntries(
    TALONFLAME.map((id) => [
      id,
      body(id, "Talonflame", "Sky Hunt", SKY_HUNT, {
        stage: "Stage2",
        evolveFrom: "Fletchinder",
        hp: 150,
        types: ["Fire"],
      }),
    ]),
  ),
  [VIVILLON]: body(VIVILLON, "Vivillon", "Grand Wing", GRAND_WING, {
    stage: "Stage2",
    evolveFrom: "Spewpa",
    hp: 120,
    types: ["Grass"],
  }),
  [PHANTUMP]: body(PHANTUMP, "Phantump", "Spiteful Evolution", SPITEFUL_EVOLUTION, {
    hp: 70,
    types: ["Psychic"],
  }),
  [TREVENANT]: battler(TREVENANT, {
    name: "Trevenant",
    stage: "Stage1",
    evolveFrom: "Phantump",
    hp: 130,
    types: ["Psychic"],
    retreat: 3,
  }),
  [TREVENANT_SV]: battler(TREVENANT_SV, {
    name: "Trevenant",
    stage: "Stage1",
    evolveFrom: "Phantump",
    hp: 120,
    types: ["Grass"],
    retreat: 3,
  }),
  [DRAGONAIR]: body(DRAGONAIR, "Dragonair", "Evolutionary Guidance", EVOLUTIONARY_GUIDANCE, {
    stage: "Stage1",
    evolveFrom: "Dratini",
    hp: 100,
    types: ["Dragon"],
  }),
  [FILLER]: battler(FILLER, { name: "D611 Filler", hp: 300, types: ["Colorless"], retreat: 1 }),
  [DARK]: battler(DARK, { name: "D611 Dark", hp: 60, types: ["Darkness"], retreat: 1 }),
  [ITEM]: itemTrainer(ITEM),
  [G]: typedEnergy(G, "Grass"),
  [D]: typedEnergy(D, "Darkness"),
  [SPECIAL]: specialEnergy(SPECIAL, "D611 Special Energy"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [CROBAT[0]]: 1,
  [CROBAT[1]]: 1,
  [TOXTRICITY[0]]: 1,
  [TOXTRICITY[1]]: 1,
  [DUSTOX[0]]: 1,
  [RAMPARDOS[0]]: 1,
  [GUMSHOOS[0]]: 1,
  [GUMSHOOS[1]]: 1,
  [TALONFLAME[0]]: 1,
  [VIVILLON]: 1,
  [PHANTUMP]: 2,
  [TREVENANT]: 2,
  [TREVENANT_SV]: 1,
  [DRAGONAIR]: 1,
  [DARK]: 3,
  [ITEM]: 3,
  [G]: 4,
  [D]: 6,
  [SPECIAL]: 2,
  [FILLER]: 26,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup (P2 first), then `endTurns` more turn ends (3 → P1's turn 4, 1 → P1's FIRST turn); both
    hands back into the decks and the Prizes swapped out for filler, so every named card is
    findable (D602's `p1Turn`). */
function p1Turn(endTurns = 3): GameState {
  const created = createGame({ seed: 6111, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  const seats = ["p2", "p1", "p2"] as const;
  for (let i = 0; i < endTurns; i++)
    state = must(applyAction(state, { type: "endTurn", seat: seats[i] as Seat }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    let deck = [...side.deck, ...side.hand];
    const prizes = side.prizes.map((u) => {
      if (state.cardIdByUid[u] === FILLER) return u;
      const swap = deck.find((d) => state.cardIdByUid[d] === FILLER);
      if (swap === undefined) throw new Error("no swap card");
      deck = [...deck.filter((d) => d !== swap), u];
      return swap;
    });
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], prizes, deck } } };
  }
  return state;
}

/** Move one copy of each id in `ids` from `seat`'s deck into their hand. */
function toHand(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  let deck = [...side.deck];
  const hand = [...side.hand];
  for (const id of ids) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`${seat} deck has no ${id}`);
    hand.push(uid);
    deck = deck.filter((u) => u !== uid);
  }
  return { ...state, players: { ...state.players, [seat]: { ...side, hand, deck } } };
}

/** P1: `active` (FILLER by default) and `bench`; P2: `p2Active` (FILLER); P1's hand is `hand`. */
function table(opts: {
  active?: string;
  bench?: readonly string[];
  hand?: readonly string[];
  p2Active?: string;
  endTurns?: number;
}): GameState {
  let state = p1Turn(opts.endTurns);
  state = clearBench(setActiveFromDeck(state, "p1", opts.active ?? FILLER), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", opts.p2Active ?? FILLER), "p2");
  for (const id of opts.bench ?? []) state = benchFromDeck(state, "p1", id);
  return toHand(state, "p1", opts.hand ?? []);
}

const ACTIVE = { spot: "active" } as const;
const bench = (index: number) => ({ spot: "bench", index }) as const;
const use = (state: GameState, abilityName: string, target: typeof ACTIVE | ReturnType<typeof bench>) =>
  applyAction(state, { type: "useAbility", seat: "p1", target, abilityName } as GameAction);
function ok(result: ReturnType<typeof applyAction>) {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result;
}
function refusal(result: ReturnType<typeof applyAction>): { code: string; message: string } {
  if (result.ok) throw new Error("expected a refusal");
  return { code: result.error.code, message: result.error.message };
}
const resolve = (state: GameState, choice: unknown) =>
  ok(applyAction(state, { type: "resolveEffect", seat: "p1", choice } as GameAction));
function prompt(state: GameState): Record<string, unknown> {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt as unknown as Record<string, unknown>;
}
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
const shuffled = (events: readonly GameEvent[]) =>
  events.filter((e) => e.type === "SHUFFLE").map((e) => (e as { seat: Seat }).seat);
const ofType = (events: readonly GameEvent[], type: string) => events.filter((e) => e.type === type);

/** An rng cursor whose first flip lands on `face`. */
function cursorFor(face: "heads" | "tails"): number {
  for (let n = 1; n < 1000; n++) if (flipCoin(n)[0] === face) return n;
  throw new Error("no cursor");
}

describe("D611 §2 — Nighttime Maneuvers: Active only; any card from the deck onto its top", () => {
  it("offers every card in the deck (Pokémon, Trainer, Energy) as a mandatory pick of one; the pick lands on top after the shuffle", () => {
    const state = table({ active: CROBAT[0] });
    const parked = ok(use(state, "Nighttime Maneuvers", ACTIVE));
    expect(shuffled(parked.events)).toEqual(["p1"]);
    const offer = prompt(parked.state);
    expect(offer.kind).toBe("chooseCards");
    expect(offer).toMatchObject({ min: 1, max: 1 });
    const candidates = offer.candidates as string[];
    const offered = new Set(ids(parked.state, candidates));
    for (const id of [ITEM, G, SPECIAL, TREVENANT, FILLER]) expect(offered.has(id), id).toBe(true);
    const pick = candidates.find((u) => parked.state.cardIdByUid[u] === ITEM) as string;
    const done = resolve(parked.state, { kind: "cards", uids: [pick] });
    expect(done.state.phase.kind).toBe("turn:action");
    expect(done.state.players.p1.deck[0]).toBe(pick);
    expect(done.state.players.p1.deck).toHaveLength(state.players.p1.deck.length);
    expect(done.state.players.p1.hand).toEqual([]);
    expect(refusal(use(done.state, "Nighttime Maneuvers", ACTIVE)).code).toBe("ABILITY_ALREADY_USED");
  });

  it("refused from the Bench (the printed Active-Spot clause); the second Crobat printing shares the object", () => {
    const state = table({ bench: [CROBAT[1]] });
    expect(refusal(use(state, "Nighttime Maneuvers", bench(0))).code).toBe("ABILITY_ACTIVE_ONLY");
  });
});

describe("D611 §3 — Sinister Surge: a Basic {D} to a Benched {D} body, then 2 counters on THAT body", () => {
  it("offers only Basic {D} Energy and only Benched {D} bodies; the chosen body takes the Energy and 20 damage; the deck is shuffled", () => {
    const state = table({ active: TOXTRICITY[0], bench: [FILLER, DARK, DARK] });
    const parked = ok(use(state, "Sinister Surge", ACTIVE));
    const offer = prompt(parked.state);
    expect(offer.kind).toBe("attachCards");
    expect(offer.max).toBe(1);
    // §9.2: the answer decides which body takes the counters, so the prompt says they follow.
    expect(offer.note).toMatch(/ If you do, place 2 damage counters on that Pokémon\.$/);
    expect(new Set(ids(parked.state, offer.candidates as string[]))).toEqual(new Set([D]));
    // The Active Toxtricity ({D}, but not Benched) and the Benched {C} filler are not targets.
    expect(offer.targets).toEqual([
      { seat: "p1", spot: { spot: "bench", index: 1 } },
      { seat: "p1", spot: { spot: "bench", index: 2 } },
    ]);
    const uid = (offer.candidates as string[])[0] as string;
    const done = resolve(parked.state, {
      kind: "attachCards",
      assignments: [{ uid, to: { seat: "p1", spot: { spot: "bench", index: 2 } } }],
    });
    expect(done.state.phase.kind).toBe("turn:action");
    expect(done.state.players.p1.bench[2]?.energy).toEqual([uid]);
    expect(done.state.players.p1.bench.map((b) => b.damage)).toEqual([0, 0, 20]);
    expect(done.state.players.p1.active?.damage).toBe(0);
    expect(shuffled(done.events)).toContain("p1");
    expect(ofType(done.events, "COUNTERS_PLACED")).toEqual([
      {
        type: "COUNTERS_PLACED",
        seat: "p1",
        uid: done.state.players.p1.bench[2]?.stack[0],
        amount: 20,
        source: "ability",
      },
    ]);
    expect(refusal(use(done.state, "Sinister Surge", ACTIVE)).code).toBe("ABILITY_ALREADY_USED");
  });

  it("nothing attached, nothing placed: a declined search, and a board with no Benched {D} body", () => {
    const state = table({ active: TOXTRICITY[0], bench: [DARK] });
    const parked = ok(use(state, "Sinister Surge", ACTIVE));
    const declined = resolve(parked.state, { kind: "attachCards", assignments: [] });
    expect(declined.state.players.p1.bench[0]?.damage).toBe(0);
    expect(ofType(declined.events, "COUNTERS_PLACED")).toEqual([]);
    expect(shuffled(declined.events)).toContain("p1");
    const none = ok(use(table({ active: TOXTRICITY[0], bench: [FILLER] }), "Sinister Surge", ACTIVE));
    expect(none.state.phase.kind).toBe("turn:action");
    expect(none.state.players.p1.bench[0]?.damage).toBe(0);
    expect(ofType(none.events, "COUNTERS_PLACED")).toEqual([]);
  });

  it("the counters can Knock Out the body they land on (a mid-turn Knock Out, the opponent's Prize)", () => {
    const state = setBenchDamage(table({ active: TOXTRICITY[0], bench: [DARK] }), "p1", 0, 40);
    const parked = ok(use(state, "Sinister Surge", ACTIVE));
    const uid = (prompt(parked.state).candidates as string[])[0] as string;
    const done = resolve(parked.state, {
      kind: "attachCards",
      assignments: [{ uid, to: { seat: "p1", spot: { spot: "bench", index: 0 } } }],
    });
    expect(ofType(done.events, "KNOCKED_OUT")).toHaveLength(1);
    expect(done.state.players.p1.bench).toEqual([]);
    expect(done.state.players.p1.discard).toContain(uid);
  });
});

describe("D611 §4 — Boisterous Wind: heads, an Energy off the opponent's Active into their hand", () => {
  it("heads: the Energy goes to the opponent's hand; tails: nothing, and the use is spent", () => {
    const base = attachFromDeck(table({ bench: [DUSTOX[0]] }), "p2", G, 1);
    const energy = base.players.p2.active?.energy[0] as string;
    const heads = ok(use({ ...base, rngState: cursorFor("heads") }, "Boisterous Wind", bench(0)));
    expect(heads.state.players.p2.active?.energy).toEqual([]);
    expect(heads.state.players.p2.hand).toEqual([energy]);
    const tails = ok(use({ ...base, rngState: cursorFor("tails") }, "Boisterous Wind", bench(0)));
    expect(tails.state.players.p2.active?.energy).toEqual([energy]);
    expect(refusal(use(tails.state, "Boisterous Wind", bench(0))).code).toBe("ABILITY_ALREADY_USED");
  });

  it("refused when the opponent's Active has no Energy (the coin gate's whiff rule)", () => {
    expect(refusal(use(table({ bench: [DUSTOX[0]] }), "Boisterous Wind", bench(0))).code).toBe("NO_LEGAL_TARGET");
  });
});

describe("D611 §5 — Destructive Headbutting: Active only; heads, discard an Energy off the opponent's Active", () => {
  it("heads: the Energy goes to the opponent's discard pile; refused from the Bench", () => {
    const base = attachFromDeck(table({ active: RAMPARDOS[0] }), "p2", G, 1);
    const energy = base.players.p2.active?.energy[0] as string;
    const heads = ok(use({ ...base, rngState: cursorFor("heads") }, "Destructive Headbutting", ACTIVE));
    expect(heads.state.players.p2.active?.energy).toEqual([]);
    expect(heads.state.players.p2.discard).toContain(energy);
    const benched = attachFromDeck(table({ bench: [RAMPARDOS[0]] }), "p2", G, 1);
    expect(refusal(use(benched, "Destructive Headbutting", bench(0))).code).toBe("ABILITY_ACTIVE_ONLY");
  });
});

describe("D611 §6 — Evidence Gathering: switch a card from your hand with the top card of your deck", () => {
  it("the hand pick is asked first; the old top card goes to the hand and the pick goes on top; the log counts it", () => {
    const state = table({ bench: [GUMSHOOS[0]], hand: [ITEM, G] });
    const top = state.players.p1.deck[0] as string;
    const parked = ok(use(state, "Evidence Gathering", bench(0)));
    const offer = prompt(parked.state);
    expect(offer).toMatchObject({ kind: "chooseCards", min: 1, max: 1, dest: "deckTop" });
    expect(offer.note).toBe("Switch a card from your hand with the top card of your deck.");
    const item = state.players.p1.hand[0] as string;
    const done = resolve(parked.state, { kind: "cards", uids: [item] });
    expect(done.state.players.p1.deck[0]).toBe(item);
    expect(done.state.players.p1.deck.slice(1)).toEqual(state.players.p1.deck.slice(1));
    expect(done.state.players.p1.hand).toEqual([state.players.p1.hand[1], top]);
    const paid = ofType(done.events, "HAND_COST_PAID");
    expect(paid).toEqual([{ type: "HAND_COST_PAID", seat: "p1", uids: [item], to: "deckTop", took: [top] }]);
    const rows = logFromEvents(paid, {
      names: { p1: "P1", p2: "P2" },
      state: done.state,
      elapsed: formatElapsed(0),
    }).flatMap((entry) => (entry.kind === "turn" ? [] : [entry.segments.map((seg) => seg.text).join("")]));
    expect(rows).toEqual(["switched 1 card from their hand with the top card of their deck"]);
  });

  it("a single card in hand is switched without a prompt", () => {
    const state = table({ bench: [GUMSHOOS[0]], hand: [ITEM] });
    const top = state.players.p1.deck[0] as string;
    const done = ok(use(state, "Evidence Gathering", bench(0)));
    expect(done.state.phase.kind).toBe("turn:action");
    expect(done.state.players.p1.hand).toEqual([top]);
    expect(done.state.players.p1.deck[0]).toBe(state.players.p1.hand[0]);
  });

  it("refused with an empty hand, and with an empty deck (R-EG1 ⚠️ UNRULED: no top card to switch with)", () => {
    const empty = refusal(use(table({ bench: [GUMSHOOS[0]] }), "Evidence Gathering", bench(0)));
    expect(empty.code).toBe("ABILITY_COST_UNMET");
    expect(empty.message).toContain("switch a card from your hand with the top card of your deck");
    const state = table({ bench: [GUMSHOOS[0]], hand: [ITEM] });
    const noDeck = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, deck: [], discard: [...state.players.p1.discard, ...state.players.p1.deck] },
      },
    };
    expect(refusal(use(noDeck, "Evidence Gathering", bench(0))).code).toBe("ABILITY_COST_UNMET");
  });
});

describe("D611 §7 — Sky Hunt: heads, a random card from the opponent's hand to their discard pile", () => {
  it("heads: exactly one of the opponent's cards is discarded; tails: none", () => {
    const base = toHand(table({ bench: [TALONFLAME[0]] }), "p2", [ITEM, G, FILLER]);
    const hand = base.players.p2.hand;
    const heads = ok(use({ ...base, rngState: cursorFor("heads") }, "Sky Hunt", bench(0)));
    expect(heads.state.players.p2.hand).toHaveLength(2);
    const gone = hand.filter((u) => !heads.state.players.p2.hand.includes(u));
    expect(gone).toHaveLength(1);
    expect(heads.state.players.p2.discard).toContain(gone[0]);
    const tails = ok(use({ ...base, rngState: cursorFor("tails") }, "Sky Hunt", bench(0)));
    expect(tails.state.players.p2.hand).toEqual(hand);
  });
});

describe("D611 §8 — Grand Wing: the opponent's hand under their deck; if any moved, they draw 4", () => {
  it("a hand of 3 goes under the deck and they draw 4 off the top; the controller's hand is untouched", () => {
    const base = toHand(table({ bench: [VIVILLON], hand: [ITEM] }), "p2", [ITEM, G, FILLER]);
    const hand = base.players.p2.hand;
    const top4 = base.players.p2.deck.slice(0, 4);
    const done = ok(use(base, "Grand Wing", bench(0)));
    expect(done.state.players.p2.hand).toEqual(top4);
    expect(new Set(done.state.players.p2.deck.slice(-3))).toEqual(new Set(hand));
    expect(done.state.players.p1.hand).toEqual(base.players.p1.hand);
  });

  it("an empty opponent hand moves nothing, so they draw nothing", () => {
    const base = table({ bench: [VIVILLON] });
    const done = ok(use(base, "Grand Wing", bench(0)));
    expect(done.state.players.p2.hand).toEqual([]);
    expect(done.state.players.p2.deck).toEqual(base.players.p2.deck);
  });
});

describe("D611 §9 — Spiteful Evolution: a card from the hand onto this Phantump, then 2 counters on it", () => {
  it("one Trevenant in hand evolves the Benched Phantump without a prompt; 20 damage lands on the evolved body", () => {
    const state = table({ bench: [PHANTUMP], hand: [TREVENANT, ITEM] });
    const trevenant = state.players.p1.hand[0] as string;
    const done = ok(use(state, "Spiteful Evolution", bench(0)));
    expect(done.state.phase.kind).toBe("turn:action");
    expect(ids(done.state, done.state.players.p1.bench[0]?.stack ?? [])).toEqual([PHANTUMP, TREVENANT]);
    expect(done.state.players.p1.bench[0]?.damage).toBe(20);
    expect(done.state.players.p1.hand).toEqual([state.players.p1.hand[1]]);
    expect(ofType(done.events, "POKEMON_EVOLVED")).toHaveLength(1);
    expect(ofType(done.events, "COUNTERS_PLACED")).toEqual([
      { type: "COUNTERS_PLACED", seat: "p1", uid: trevenant, amount: 20, source: "ability" },
    ]);
  });

  it("evolves under a stamped Evolution Jammer bar (R-SE3 ⚠️ UNRULED: the Ability is not a play from the hand)", () => {
    // Bronzong `sv05-069` "Evolution Jammer" stamps `handPlayLockedTurn.evolve`; the hand
    // evolve of `turn.ts` asks `pokemonPlayBarred`, this op does not (as Rare Candy, R-SE2).
    const base = table({ bench: [PHANTUMP], hand: [TREVENANT] });
    const state: GameState = {
      ...base,
      handPlayLockedTurn: { ...base.handPlayLockedTurn, p1: { ...base.handPlayLockedTurn.p1, evolve: base.turn } },
    };
    expect(pokemonPlayBarred(state, "p1", "evolve", POOL[TREVENANT])).toBe(true);
    const done = ok(use(state, "Spiteful Evolution", bench(0)));
    expect(ids(done.state, done.state.players.p1.bench[0]?.stack ?? [])).toEqual([PHANTUMP, TREVENANT]);
    expect(done.state.players.p1.bench[0]?.damage).toBe(20);
  });

  it("two different evolutions in hand park a MANDATORY pick of one (from the Active too)", () => {
    const state = table({ active: PHANTUMP, hand: [TREVENANT, TREVENANT_SV, ITEM] });
    const parked = ok(use(state, "Spiteful Evolution", ACTIVE));
    const offer = prompt(parked.state);
    expect(offer).toMatchObject({ kind: "chooseCards", min: 1, max: 1, dest: "evolve" });
    expect(offer.note).toBe(
      "Choose a card in your hand that evolves from Phantump and put it onto Phantump to evolve it. If you do, place 2 damage counters on that Pokémon.",
    );
    expect(new Set(ids(parked.state, offer.candidates as string[]))).toEqual(new Set([TREVENANT, TREVENANT_SV]));
    const pick = state.players.p1.hand[1] as string;
    const done = resolve(parked.state, { kind: "cards", uids: [pick] });
    expect(done.state.players.p1.active?.stack.at(-1)).toBe(pick);
    expect(done.state.players.p1.active?.damage).toBe(20);
  });

  it("refused with no evolution in hand (no whiff), and on the controller's first turn (the printed ban)", () => {
    expect(refusal(use(table({ bench: [PHANTUMP], hand: [ITEM] }), "Spiteful Evolution", bench(0))).code).toBe(
      "NO_LEGAL_TARGET",
    );
    const first = table({ bench: [PHANTUMP], hand: [TREVENANT], endTurns: 1 });
    expect(first.turn).toBe(2);
    const banned = refusal(use(first, "Spiteful Evolution", bench(0)));
    expect(banned.code).toBe("ABILITY_CONDITION_NOT_MET");
    expect(banned.message).toContain("it is not your first turn");
  });

  it("R-SE1 ⚠️ UNRULED: a Phantump put into play THIS turn evolves (only the first-turn ban is printed)", () => {
    const state = table({ bench: [PHANTUMP], hand: [TREVENANT] });
    const fresh = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          bench: state.players.p1.bench.map((b) => ({ ...b, turnPlayed: state.turn })),
        },
      },
    };
    const done = ok(use(fresh, "Spiteful Evolution", bench(0)));
    expect(ids(done.state, done.state.players.p1.bench[0]?.stack ?? [])).toEqual([PHANTUMP, TREVENANT]);
  });

  it("the online HUD row is live with an evolution in hand and greyed without one (the body's uid reaches the gate)", () => {
    const row = (state: GameState) => {
      const phase = redactGame(state, "p1").phase;
      if (phase.kind !== "turn:action") throw new Error("expected turn:action");
      return phase.abilities.find((a) => a.abilityName === "Spiteful Evolution");
    };
    expect(row(table({ bench: [PHANTUMP], hand: [TREVENANT] }))?.disabled).toBe(false);
    expect(row(table({ bench: [PHANTUMP], hand: [ITEM] }))?.disabled).toBe(true);
  });
});

describe("D611 §10 — Evolutionary Guidance: any Energy attached; an Evolution Pokémon from the deck", () => {
  it("refused with no Energy (the reason names the untyped clause); with a Special Energy it searches Evolution Pokémon only", () => {
    const bare = table({ active: DRAGONAIR });
    const refused = refusal(use(bare, "Evolutionary Guidance", ACTIVE));
    expect(refused.code).toBe("ABILITY_CONDITION_NOT_MET");
    expect(refused.message).toContain("this Pokémon has any Energy attached");
    const state = attachFromDeck(bare, "p1", SPECIAL, 1);
    const parked = ok(use(state, "Evolutionary Guidance", ACTIVE));
    const offer = prompt(parked.state);
    expect(offer).toMatchObject({ kind: "chooseCards", max: 1 });
    const offered = new Set(ids(parked.state, offer.candidates as string[]));
    expect(offered.has(TREVENANT)).toBe(true);
    expect(offered.has(CROBAT[0])).toBe(true);
    for (const id of [PHANTUMP, FILLER, DARK, ITEM, G]) expect(offered.has(id), id).toBe(false);
    const pick = (offer.candidates as string[]).find((u) => parked.state.cardIdByUid[u] === TREVENANT) as string;
    const done = resolve(parked.state, { kind: "cards", uids: [pick] });
    expect(done.state.players.p1.hand).toEqual([pick]);
    expect(shuffled(done.events)).toContain("p1");
  });
});

describe("D611 §11 — Lethargic Charge is dropped and named (🆕🆕🆕 D628 (D539): WITHDRAWN — BUILT at D628)", () => {
  it("Larry's Komala `me02.5-175` stays unkeyed: an Active-only target AND a which-Energy-card choice (two pieces) (🆕🆕🆕 D628 (D539): WITHDRAWN — both pieces built, `attachFromHand` `one` + `activeOnly`; onBenchMoveMeD628.test.ts §4)", () => {
    expect(programFor(KOMALA)?.abilities?.[0]?.name).toBe("Lethargic Charge");
  });
});

describe("D611 §12 — `notYourFirstTurn`, and the version", () => {
  it("is the exact complement of `yourFirstTurn` for the seat asked about", () => {
    const first = p1Turn(1);
    expect(conditionHolds(first, "p1", { kind: "notYourFirstTurn" })).toBe(false);
    expect(conditionHolds(first, "p1", { kind: "yourFirstTurn" })).toBe(true);
    const later = p1Turn(3);
    expect(conditionHolds(later, "p1", { kind: "notYourFirstTurn" })).toBe(true);
    expect(conditionNote({ kind: "notYourFirstTurn" })).toBe("it is not your first turn");
  });

  it("is built at engine 0.547.0", () => {
    expect(engineVersion).toBe("0.547.0");
  });
});
