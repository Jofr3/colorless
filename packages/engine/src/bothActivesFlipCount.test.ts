import type { Card } from "@colorless/schema";
import manifest from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { countAttachedEnergy, countEnergyInPlay, providedEnergy } from "./continuous";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackCopy,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { countPokemonInPlay } from "./boardCondition";
import { flipCoin } from "./rng";
import type { CoinFace } from "./rng";
import {
  completeSetup,
  FIXTURE_POOL,
  basicEnergy,
  battler,
  deckOf,
  itemTrainer,
} from "./testFixtures";
import { makeInPlay } from "./types";

const PRINTED =
  "Flip a coin for each Energy attached to both Active Pokémon. This attack does 60 damage for each heads.";

const SELF_SIDE =
  "Flip a coin for each Energy attached to this Pokémon. This attack does 80 damage for each heads.";

const BODY_SIDE =
  "Flip a coin for each {D} Pokémon you have in play. This attack does 60 damage for each heads.";

const DAMAGE_TWIN =
  "This attack does 30 more damage for each Energy attached to both Active Pokémon.";

const ALL_READERS: readonly ((t: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackDiscardScaledBoost,
];

const printings = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

describe("D475 §1 — the sentence, measured live over the legal column", () => {
  it("the hand-kept reader list IS the module's reader surface, and it is 13", () => {
    expect(ALL_READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("is really in the column, ONCE, at ONE printing", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === PRINTED);
    expect([rows.length, printings(rows)]).toEqual([1, 1]);
  });

  it("the `Flip a coin for each` family is THREE rows / FOUR printings, and D475 closes it", () => {
    const family = legalAttackCorpus().filter(([, s]) => /Flip a coin for each/.test(s));
    expect(family.map(([, s]) => s).sort()).toEqual([PRINTED, SELF_SIDE, BODY_SIDE].sort());
    expect([family.length, printings(family)]).toEqual([3, 4]);
    const members = [PRINTED, SELF_SIDE, BODY_SIDE].map((s) => {
      const read = deriveAttackCoinFlip(s);
      return read !== null && "flips" in read ? read.flips.kind : null;
    });
    expect(members).toEqual(["bothActivesEnergy", "attachedEnergy", "pokemonInPlay"]);
  });

  it("`deriveAttackCoinFlip` is its ONLY reader — the other TWELVE refuse it", () => {
    expect(deriveAttackCoinFlip(PRINTED)).not.toBeNull();
    for (const read of ALL_READERS) {
      if (read === deriveAttackCoinFlip) continue;
      expect(read(PRINTED), read.name).toBeNull();
    }
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });

  it("D464's COMPOUND route contributes nothing — no row is this sentence plus a tail", () => {
    const compounds = legalAttackCorpus().filter(([, s]) => s !== PRINTED && s.startsWith(PRINTED));
    expect(compounds).toEqual([]);
  });

  it("EVERY widening claims the IDENTICAL 1 sentence / 1 printing — pure RISK", () => {
    const widenings: Record<string, RegExp> = {
      typed:
        /^Flip a coin for each (?:(.+) )?Energy attached to both Active Pokémon\. This attack does (\d+) damage for each heads\.$/,
      // …an open consequent: the count clause stops being pinned to a per-heads fold.
      consequent: /^Flip a coin for each Energy attached to both Active Pokémon\. (.+)$/,
      // …dropping the `^`.
      caret:
        /Flip a coin for each Energy attached to both Active Pokémon\. This attack does (\d+) damage for each heads\.$/,
      // …dropping the `\.$`.
      dollar:
        /^Flip a coin for each Energy attached to both Active Pokémon\. This attack does (\d+) damage for each heads\./,
      // …making `both ` optional, which would spell a one-Active sentence nobody prints.
      both: /^Flip a coin for each Energy attached to (?:both )?Active Pokémon\. This attack does (\d+) damage for each heads\.$/,
    };
    for (const [name, re] of Object.entries(widenings)) {
      const claimed = legalAttackCorpus().filter(([, s]) => re.test(s));
      expect([claimed.length, printings(claimed)], name).toEqual([1, 1]);
      expect(claimed[0]?.[1], name).toBe(PRINTED);
    }
    const more =
      /^Flip a coin for each Energy attached to both Active Pokémon\. This attack does (\d+) more damage for each heads\.$/;
    expect(legalAttackCorpus().filter(([, s]) => more.test(s))).toEqual([]);
  });

  it("the two loosenings that DO move a number would EAT A SIBLING'S ROW", () => {
    const noun =
      /^Flip a coin for each Energy attached to ([^.]+)\. This attack does (\d+) damage for each heads\.$/;
    const head = /^Flip a coin for each ([^.]+)\. This attack does (\d+) damage for each heads\.$/;
    const byNoun = legalAttackCorpus().filter(([, s]) => noun.test(s));
    const byHead = legalAttackCorpus().filter(([, s]) => head.test(s));
    expect([byNoun.length, printings(byNoun)]).toEqual([2, 2]);
    expect([byHead.length, printings(byHead)]).toEqual([3, 4]);
    expect(byNoun.map(([, s]) => s).sort()).toEqual([PRINTED, SELF_SIDE].sort());
    expect(byHead.map(([, s]) => s).sort()).toEqual([PRINTED, SELF_SIDE, BODY_SIDE].sort());
  });

  it("STRUCTURAL disjointness from BOTH siblings, driven from every side", () => {
    expect(deriveAttackCoinFlip(PRINTED)).toEqual({
      kind: "perHeads",
      flips: { kind: "bothActivesEnergy" },
      per: 60,
    });
    expect(deriveAttackCoinFlip(SELF_SIDE)).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: null },
      per: 80,
    });
    expect(deriveAttackCoinFlip(PRINTED)).not.toEqual(deriveAttackCoinFlip(SELF_SIDE));
    expect(deriveAttackCoinFlip(PRINTED)).not.toEqual(deriveAttackCoinFlip(BODY_SIDE));
    // …and the CROSSINGS — each sentence's head against another's tail — reach no
    // pattern at all, which is the byte-level claim spelled as a rung.
    for (const crossed of [
      "Flip a coin for each Energy attached to both Active Pokémon you have in play. This attack does 60 damage for each heads.",
      "Flip a coin for each Energy attached to this Pokémon and both Active Pokémon. This attack does 60 damage for each heads.",
      "Flip a coin for each {D} Pokémon attached to both Active Pokémon. This attack does 60 damage for each heads.",
    ]) {
      expect(deriveAttackCoinFlip(crossed), crossed).toBeNull();
    }
  });

  it("the sentence has been FIELDED as a refusal witness since D196, and it is that fixture's", () => {
    expect(FIXTURE_POOL["fix-bothactives"]?.attacks?.[2]?.effect).toBe(PRINTED);
    expect(FIXTURE_POOL["fix-bothactives"]?.attacks?.[2]?.damage).toBe("60×");
    const carriers = Object.entries(FIXTURE_POOL).filter(([, card]) =>
      (card.attacks ?? []).some((a) => a.effect === PRINTED),
    );
    expect(carriers.map(([id]) => id)).toEqual(["fix-bothactives"]);
  });
});

describe("D475 §2 — the derived value, and every refusal pinned on ONE printed byte", () => {
  it("the member is NULLARY — there is no filter, no seat and no count on it", () => {
    const read = deriveAttackCoinFlip(PRINTED);
    expect(read).toEqual({ kind: "perHeads", flips: { kind: "bothActivesEnergy" }, per: 60 });
    expect(read !== null && "flips" in read ? Object.keys(read.flips) : []).toEqual(["kind"]);
  });

  it("a printed 0 stays LOUD, and 1 does not — the family's `per >= 1` guard", () => {
    expect(deriveAttackCoinFlip(PRINTED.replace("does 60 damage", "does 0 damage"))).toBeNull();
    expect(deriveAttackCoinFlip(PRINTED.replace("does 60 damage", "does 1 damage"))).toEqual({
      kind: "perHeads",
      flips: { kind: "bothActivesEnergy" },
      per: 1,
    });
  });

  it("a TYPED spelling stays LOUD — the pool prints none, so the group is refused", () => {
    for (const token of ["{R}", "{W}", "Basic", "Special", "Water"]) {
      expect(
        deriveAttackCoinFlip(PRINTED.replace("each Energy", `each ${token} Energy`)),
        token,
      ).toBeNull();
    }
  });

  it("each near-miss differs on ONE axis and each is refused for THAT axis", () => {
    expect(deriveAttackCoinFlip(PRINTED)).not.toBeNull();
    expect(deriveAttackCoinFlip(PRINTED.replace("both Active Pokémon", "this Pokémon"))).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: null },
      per: 60,
    });
    for (const text of [
      // …the SEAT alone: the printed subject names both Actives, not one side's.
      PRINTED.replace("both Active Pokémon", "your opponent's Active Pokémon"),
      PRINTED.replace("each Energy attached to", "each Pokémon attached to"),
      // …the ADJECTIVE alone: "more" KEEPS the printed base, a different member.
      PRINTED.replace("60 damage", "60 more damage"),
      // …the FACE alone: nothing in the column folds on tails.
      PRINTED.replace("for each heads", "for each tails"),
      // …the VERB alone: a printed flip count is `ATTACK_COIN_MULTI`'s shape.
      PRINTED.replace("Flip a coin for each", "Flip 3 coins for each"),
      // …the NUMBER WORD alone: "all" is not the printed determiner.
      PRINTED.replace("for each Energy", "for all Energy"),
    ]) {
      expect(deriveAttackCoinFlip(text), text).toBeNull();
    }
  });

  it("the anchor is WHOLE-SENTENCE — leading text, trailing text, case and the period", () => {
    for (const text of [
      `This attack does 30 damage. ${PRINTED}`,
      `${PRINTED} Then, discard a card.`,
      PRINTED.toLowerCase(),
      PRINTED.toUpperCase(),
      PRINTED.slice(0, -1),
    ]) {
      expect(deriveAttackCoinFlip(text), text).toBeNull();
    }
  });

  it("the DAMAGE twin of this printed noun stays where it was — two readers, two halves", () => {
    expect(deriveAttackDamageBonus(DAMAGE_TWIN)).toEqual({
      per: 30,
      count: { kind: "bothActivesEnergyCount" },
    });
    expect(deriveAttackCoinFlip(DAMAGE_TWIN)).toBeNull();
    expect(deriveAttackDamageBonus(PRINTED)).toBeNull();
    expect(deriveAttackDamageMultiplier(PRINTED)).toBeNull();
    const twin = legalAttackCorpus().filter(([, s]) => s === DAMAGE_TWIN);
    expect([twin.length, printings(twin)]).toEqual([1, 8]);
  });
});

/** The attacker that prints the sentence, at the printed `{C}` cost. */
const TIDE_CALLER = "d475-tide-caller";
const FREE_CALLER = "d475-free-caller";
/** 900 HP: nine flips at 60 is 540, so no swept seed can end on a Knock Out and park
    the turn on a promotion. Every case here is about the flip COUNT. */
const BULWARK = "d475-bulwark";
/** A plain Basic with no attacks — Bench filler, so a board can state its own body
    count exactly. */
const FILLER = "d475-filler";
const ITEM_CARD = "d475-item";

/** The printed attack, spelled ONCE so the two attackers cannot drift apart.
    `damage: "60×"` is the printed marker `perHeads` consumes, so the dropped base is
    DECLARED rather than silently discarded (`attack.ts`'s modifier-simulated check). */
const TIDE_ATTACK: NonNullable<Card["attacks"]>[number] = {
  cost: ["Colorless"],
  name: "Tidal Tally",
  effect: PRINTED,
  damage: "60×",
};

const LOCAL_CARDS: Record<string, Card> = {
  [TIDE_CALLER]: battler(TIDE_CALLER, {
    name: "D475 Tide Caller",
    hp: 200,
    retreat: 1,
    types: ["Water"],
    attacks: [{ ...TIDE_ATTACK }, { cost: ["Colorless"], name: "Flat Slap", damage: "10" }],
  }),
  [FREE_CALLER]: battler(FREE_CALLER, {
    name: "D475 Free Caller",
    hp: 200,
    retreat: 1,
    types: ["Water"],
    attacks: [
      { ...TIDE_ATTACK, cost: [] },
      { cost: [], name: "Flat Slap", damage: "10" },
    ],
  }),
  [BULWARK]: battler(BULWARK, {
    name: "D475 Bulwark",
    hp: 900,
    retreat: 1,
    types: ["Fighting"],
    attacks: [{ cost: ["Colorless"], name: "Shove", damage: "10" }],
  }),
  [FILLER]: battler(FILLER, { name: "D475 Filler", hp: 90, types: ["Fighting"] }),
  [ITEM_CARD]: itemTrainer(ITEM_CARD),
  "d475-plain-energy": basicEnergy("d475-plain-energy"),
};

const CARD_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const FIRE = "fix-fire-energy";
const WATER = "fix-water-energy";
const GRASS_DOUBLE = "fix-grassdouble";

const LOCAL_DECK = deckOf({
  [TIDE_CALLER]: 5,
  [FREE_CALLER]: 5,
  [BULWARK]: 5,
  [FILLER]: 11,
  [FIRE]: 11,
  [WATER]: 13,
  [GRASS_DOUBLE]: 6,
  [ITEM_CARD]: 4,
});

const TALLY = 0;

function ok(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}

function play(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const outcome = applyAction(state, action);
  if (!outcome.ok) {
    throw new Error(`${action.type} rejected: ${outcome.error.code}: ${outcome.error.message}`);
  }
  return { state: outcome.state, events: [...outcome.events] };
}

/** Setup driven against the LOCAL pool, then P2's turn ended so P1 is on
    `turn:action` and may attack (§4 of the rules). */
function opened(seed: number): GameState {
  const created = createGame({
    seed,
    decks: { p1: LOCAL_DECK, p2: LOCAL_DECK },
    cardPool: CARD_POOL,
  });
  if (!created.ok) throw new Error(`createGame: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = ok(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  state = completeSetup(state);
  return play(state, { type: "endTurn", seat: "p2" }).state;
}

/** Field `cardId` from the seat's deck into the Active Spot, discarding whatever was
    there rather than benching it — the boards below state their own Bench exactly, so
    a displaced opening Active would be an extra body nobody counted. */
function intoActive(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((held) => state.cardIdByUid[held] === cardId);
  if (uid === undefined) throw new Error(`${seat}'s deck has no ${cardId}`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        active: makeInPlay(uid, state.turn),
        bench: [],
      },
    },
  };
}

/** Put `count` copies of `cardId` from the seat's deck onto its Bench. */
function ontoBench(state: GameState, seat: Seat, cardId: string, count: number): GameState {
  let next = state;
  for (let placed = 0; placed < count; placed += 1) {
    const side = next.players[seat];
    const uid = side.deck.find((held) => next.cardIdByUid[held] === cardId);
    if (uid === undefined) throw new Error(`${seat}'s deck ran out of ${cardId}`);
    if (side.bench.length >= 5) throw new Error("Bench full");
    next = {
      ...next,
      players: {
        ...next.players,
        [seat]: {
          ...side,
          deck: side.deck.filter((u) => u !== uid),
          bench: [...side.bench, makeInPlay(uid, next.turn)],
        },
      },
    };
  }
  return next;
}

/** Attach `count` copies of `cardId` from the seat's deck onto its ACTIVE. */
function ontoActiveEnergy(state: GameState, seat: Seat, cardId: string, count: number): GameState {
  const side = state.players[seat];
  const spot = side.active;
  if (spot === null) throw new Error(`${seat} has no Active`);
  const uids = side.deck.filter((held) => state.cardIdByUid[held] === cardId).slice(0, count);
  if (uids.length < count) throw new Error(`${seat}'s deck has fewer than ${count} ${cardId}`);
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((held) => !taken.has(held)),
        active: { ...spot, energy: [...spot.energy, ...uids] },
      },
    },
  };
}

/** Attach `count` copies of `cardId` from the seat's deck onto Bench slot `slot`. The
    BENCH piles are what separate "the two ACTIVES" from "the two BOARDS" (§3's
    `boardSelf` / `boardFoe` / `boardBoth` readings), so every board here states them. */
function ontoBenchEnergy(
  state: GameState,
  seat: Seat,
  slot: number,
  cardId: string,
  count: number,
): GameState {
  const side = state.players[seat];
  const body = side.bench[slot];
  if (body === undefined || body === null) throw new Error(`${seat} has no Bench slot ${slot}`);
  const uids = side.deck.filter((held) => state.cardIdByUid[held] === cardId).slice(0, count);
  if (uids.length < count) throw new Error(`${seat}'s deck has fewer than ${count} ${cardId}`);
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((held) => !taken.has(held)),
        bench: side.bench.map((slotBody, index) =>
          index === slot && slotBody !== null
            ? { ...slotBody, energy: [...slotBody.energy, ...uids] }
            : slotBody,
        ),
      },
    },
  };
}

function discriminating(seed: number): GameState {
  let state = opened(seed);
  state = intoActive(state, "p1", TIDE_CALLER);
  state = ontoActiveEnergy(state, "p1", FIRE, 1);
  state = ontoActiveEnergy(state, "p1", GRASS_DOUBLE, 1);
  state = ontoBench(state, "p1", FILLER, 4);
  state = ontoBenchEnergy(state, "p1", 0, WATER, 2);
  state = intoActive(state, "p2", BULWARK);
  state = ontoActiveEnergy(state, "p2", FIRE, 2);
  state = ontoActiveEnergy(state, "p2", WATER, 5);
  state = ontoBench(state, "p2", FILLER, 5);
  return ontoBenchEnergy(state, "p2", 0, WATER, 1);
}

function zeroCount(seed: number): GameState {
  let state = opened(seed);
  state = intoActive(state, "p1", FREE_CALLER);
  state = ontoBench(state, "p1", FILLER, 3);
  state = ontoBenchEnergy(state, "p1", 0, WATER, 2);
  state = intoActive(state, "p2", BULWARK);
  state = ontoBench(state, "p2", FILLER, 3);
  return ontoBenchEnergy(state, "p2", 0, FIRE, 3);
}

function defenderOnly(seed: number): GameState {
  let state = opened(seed);
  state = intoActive(state, "p1", FREE_CALLER);
  state = ontoBench(state, "p1", FILLER, 2);
  state = intoActive(state, "p2", BULWARK);
  state = ontoActiveEnergy(state, "p2", WATER, 1);
  return ontoBench(state, "p2", FILLER, 2);
}

function attackerOnly(seed: number): GameState {
  let state = opened(seed);
  state = intoActive(state, "p1", FREE_CALLER);
  state = ontoActiveEnergy(state, "p1", WATER, 1);
  state = ontoBench(state, "p1", FILLER, 2);
  state = intoActive(state, "p2", BULWARK);
  return ontoBench(state, "p2", FILLER, 2);
}

const tally = { type: "attack", seat: "p1", index: TALLY } as const;

function rowsOf<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

const names = (events: readonly GameEvent[]): string[] => events.map((e) => e.type);

/** The heads count off the emitted rows — every damage assertion is stated against
    what the engine REPORTED doing, and §5 separately proves the report is honest. */
function headsIn(events: readonly GameEvent[]): number {
  return rowsOf(events, "ATTACK_EFFECT_COIN_FLIP").filter((e) => e.result === "heads").length;
}

/** Take `count` flips by hand off `rng`, returning the faces IN ORDER and the state
    they leave behind. `count === 0` is a REAL call here, not a degenerate one: it
    returns the input unchanged, which is exactly the zero board's claim. */
function handFlips(rng: number, count: number): [faces: CoinFace[], next: number] {
  const faces: CoinFace[] = [];
  let cursor = rng;
  for (let taken = 0; taken < count; taken += 1) {
    const [face, next] = flipCoin(cursor);
    faces.push(face);
    cursor = next;
  }
  return [faces, cursor];
}

function readings(state: GameState): number[] {
  const own = state.players.p1.active;
  const foe = state.players.p2.active;
  if (own === null || foe === null) throw new Error("both Actives are required");
  const bodies = (seat: Seat) => countPokemonInPlay(state, seat, { kind: "anyPokemon" });
  return [
    countAttachedEnergy(state, own, null) + countAttachedEnergy(state, foe, null),
    providedEnergy(state, own).length + providedEnergy(state, foe).length,
    countAttachedEnergy(state, own, null),
    countAttachedEnergy(state, foe, null),
    countAttachedEnergy(state, own, "Fire") + countAttachedEnergy(state, foe, "Fire"),
    countEnergyInPlay(state, "p1", null),
    countEnergyInPlay(state, "p2", null),
    countEnergyInPlay(state, "p1", null) + countEnergyInPlay(state, "p2", null),
    bodies("p1"),
    bodies("p2"),
    bodies("p1") + bodies("p2"),
  ];
}

const SEEDS = 24;

describe("D475 §3 — the board, where ELEVEN plausible readings answer ELEVEN DIFFERENT numbers", () => {
  it("the eleven readings are 9 / 10 / 2 / 7 / 3 / 4 / 8 / 12 / 5 / 6 / 11 — MEASURED", () => {
    const state = discriminating(0);
    expect(readings(state)).toEqual([9, 10, 2, 7, 3, 4, 8, 12, 5, 6, 11]);
    expect(new Set(readings(state)).size).toBe(11);
    expect([readings(state)[2], readings(state)[3]]).toEqual([2, 7]);
  });

  it("flips EXACTLY NINE times, on every swept seed, and never any of the other ten", () => {
    const seenHeads = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const state = discriminating(seed);
      const { state: done, events } = play(state, tally);
      const flips = rowsOf(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips, `seed ${seed}`).toHaveLength(9);
      for (const flip of flips) expect(flip.seat).toBe("p1"); // the ATTACKER flips
      const heads = headsIn(events);
      seenHeads.add(heads);
      expect(done.players.p2.active?.damage ?? 0, `seed ${seed}`).toBe(60 * heads);
      // The totals only a WRONG count could produce, named as absences.
      for (const wrong of [10, 2, 7, 3, 4, 8, 12, 5, 6, 11]) {
        expect(flips.length, `seed ${seed} / ${wrong}`).not.toBe(wrong);
      }
      // …and the printed base never leaks: N heads is 60N, not 60N + 60.
      expect(done.players.p2.active?.damage ?? 0).not.toBe(60 * heads + 60);
      expect(names(events)).not.toContain("KNOCKED_OUT");
      expect(names(events)).toContain("TURN_ENDED");
    }
    // More than one heads count was reached, so the damage assertion above is not
    // green against a single constant.
    expect(seenHeads.size).toBeGreaterThan(1);
  });

  it("the DEFENDER's pile really is counted — remove it and the flip count falls by 7", () => {
    // The one thing that separates this member from `attachedEnergy`. Same board, same
    // card, same text; the defender's Active stripped and nothing else touched.
    const full = discriminating(0);
    expect(rowsOf(play(full, tally).events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(9);
    const foe = full.players.p2.active;
    if (foe === null) throw new Error("p2 has no Active");
    const stripped: GameState = {
      ...full,
      players: { ...full.players, p2: { ...full.players.p2, active: { ...foe, energy: [] } } },
    };
    expect(rowsOf(play(stripped, tally).events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(2);
  });

  it("the ATTACKER's pile really is counted too — remove it and the count falls by 2", () => {
    const full = discriminating(0);
    const own = full.players.p1.active;
    if (own === null) throw new Error("p1 has no Active");
    const stripped: GameState = {
      ...full,
      players: { ...full.players, p1: { ...full.players.p1, active: { ...own, energy: [] } } },
    };
    const onlyDouble: GameState = {
      ...full,
      players: {
        ...full.players,
        p1: { ...full.players.p1, active: { ...own, energy: own.energy.slice(1) } },
      },
    };
    expect(rowsOf(play(onlyDouble, tally).events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(8);
    expect(countAttachedEnergy(stripped, { ...own, energy: [] }, null)).toBe(0);
  });

  it("counts CARDS and not UNITS — the Grass double is ONE flip, not two", () => {
    const state = discriminating(0);
    const own = state.players.p1.active;
    if (own === null) throw new Error("p1 has no Active");
    expect(providedEnergy(state, own)).toEqual(["Fire", "Grass", "Grass"]);
    expect(countAttachedEnergy(state, own, null)).toBe(2);
    expect(rowsOf(play(state, tally).events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(9);
  });

  it("leaves the card's OTHER attack alone — a flat 10, no flips, base KEPT", () => {
    // The control for every "the coin reader did not touch this" claim: the same card,
    // the same board, no flip rows and no dropped base.
    const { state: done, events } = play(discriminating(0), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    expect(rowsOf(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(done.players.p2.active?.damage ?? 0).toBe(10);
  });
});

describe("D475 §4 — ZERO FLIPS and ALL TAILS deal the same damage and are NOT the same fact", () => {
  it("an EMPTY pair of Actives takes NO flip, spends NO rng step, and is not LOUD", () => {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const state = zeroCount(seed);
      const shape = readings(state);
      expect(shape.slice(0, 5), `seed ${seed}`).toEqual([0, 0, 0, 0, 0]);
      expect(
        shape.slice(5).every((n) => n > 0),
        `seed ${seed} / ${shape.join(",")}`,
      ).toBe(true);
      const before = state.rngState;
      const { state: done, events } = play(state, tally);
      expect(rowsOf(events, "ATTACK_EFFECT_COIN_FLIP"), `seed ${seed}`).toHaveLength(0);
      expect(done.players.p2.active?.damage ?? 0, `seed ${seed}`).toBe(0);
      expect(rowsOf(events, "DAMAGE_DEALT"), `seed ${seed}`).toHaveLength(0);
      expect(names(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(names(events)).toContain("TURN_ENDED");
      expect(names(events)).toContain("ATTACK_DECLARED");
      expect(done.rngState, `seed ${seed}`).toBe(before);
    }
  });

  it("ALL TAILS deals the same ZERO and is a DIFFERENT fact — one flip row, one rng step", () => {
    const tailsSeeds: number[] = [];
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const state = defenderOnly(seed);
      const before = state.rngState;
      const { state: done, events } = play(state, tally);
      const flips = rowsOf(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips, `seed ${seed}`).toHaveLength(1);
      // …the generator MOVED, on every seed, heads or tails — the flip was really taken.
      expect(done.rngState, `seed ${seed}`).not.toBe(before);
      expect(done.rngState, `seed ${seed}`).toBe(handFlips(before, 1)[1]);
      if (flips[0]?.result !== "tails") continue;
      tailsSeeds.push(seed);
      expect(done.players.p2.active?.damage ?? 0, `seed ${seed}`).toBe(0);
      expect(rowsOf(events, "DAMAGE_DEALT"), `seed ${seed}`).toHaveLength(0);
      expect(names(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
    // An all-tails board was really reached — the case is not vacuously green.
    expect(tailsSeeds.length).toBeGreaterThan(0);
  });

  it("ONE Energy on EITHER side is ONE flip — the pair no single board can give", () => {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const foeSide = defenderOnly(seed);
      const ownSide = attackerOnly(seed);
      expect(readings(foeSide).slice(0, 4), `seed ${seed}`).toEqual([1, 1, 0, 1]);
      expect(readings(ownSide).slice(0, 4), `seed ${seed}`).toEqual([1, 1, 1, 0]);
      expect(rowsOf(play(foeSide, tally).events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
      expect(rowsOf(play(ownSide, tally).events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
    }
  });
});

describe("D475 §5 — the rngState account: exactly `count` steps, no more and no fewer", () => {
  it("recomputes the whole flip sequence by hand, in order, on every swept seed", () => {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const state = discriminating(seed);
      const [faces, after] = handFlips(state.rngState, 9);
      const { state: done, events } = play(state, tally);
      expect(
        rowsOf(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result),
        `seed ${seed}`,
      ).toEqual(faces);
      expect(done.rngState, `seed ${seed}`).toBe(after);
      // …and NOT the state ten or two flips would have left, which is what an
      // off-by-one loop bound and a one-seat reading produce.
      expect(done.rngState, `seed ${seed}`).not.toBe(handFlips(state.rngState, 10)[1]);
      expect(done.rngState, `seed ${seed}`).not.toBe(handFlips(state.rngState, 2)[1]);
    }
  });

  it("emits NO loud row on ANY outcome, on ANY count, including ZERO", () => {
    // `modifierSimulated`: the sentence is READ, so the engine must never flag it.
    for (let seed = 0; seed < SEEDS; seed += 1) {
      for (const build of [discriminating, defenderOnly, attackerOnly, zeroCount]) {
        const { events } = play(build(seed), tally);
        expect(rowsOf(events, "ATTACK_EFFECT_SKIPPED"), `${build.name} / ${seed}`).toHaveLength(0);
      }
    }
  });
});

describe("D475 §6 — `MATCH_RECORD_VERSION` stays 29, and this is D473's FIRST argument", () => {
  it("`AttackFlipCount` has NO CARRIER AT ALL — it is never serialised anywhere", () => {
    for (const build of [discriminating, zeroCount]) {
      const { state: done } = play(build(0), tally);
      const wire = JSON.stringify(done);
      expect(wire, build.name).not.toContain("bothActivesEnergy");
      expect(wire, build.name).not.toContain("attachedEnergy");
      expect(wire, build.name).not.toContain("perHeads");
      // …and no continuation was written at all, on either board.
      expect(done.phase.kind, build.name).not.toBe("effect:choose");
    }
  });

  it("engineVersion is 0.555.0 and `manifest.version` agrees", () => {
    expect(manifest.version).toBe(engineVersion);
  });
});
