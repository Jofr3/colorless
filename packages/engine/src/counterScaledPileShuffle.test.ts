import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import {
  deriveAttackEffect,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import type { CardFilter, EffectOp } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
import { countCardsInDiscardPile } from "./interpreter";
import { FIXTURE_POOL, battler, benchFromDeck, clearBench, deckOf, setActiveFromDeck } from "./testFixtures";

// ─────────────────────────────────────────────────────────────────────────────
// 🆕🆕🆕 D538 — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD, AND WHOSE TAIL
// SHUFFLES THE VERY CARDS THE AMOUNT COUNTED.
//
// `censusAttackCorpus.ts` **FILE LINE 412** — *"Put 2 damage counters on 1 of your
// opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then,
// shuffle those Energy cards into your deck."* — **1 sentence / 3 legal printings**
// (`legalAttackCorpus()` index **359**, leading count column `3`).
//
// ⚠️ **NO CARD ID IS RESOLVED FOR THIS SENTENCE ON THIS CHECKOUT**, and that was
// MEASURED at this head rather than inherited: `git grep -F` for the sentence over the
// whole repo returns the corpus row and the refusal rows in the placement family, and
// nothing anywhere — `index.ts`'s D373 name-only block included — claims an id or a
// name for it. So the suite rides a FILE-LOCAL DECLARED demonstrator, `d538-pile-sniper`
// (D425, conventions.md "When a card id cannot be resolved"), in D535's `d535-sniper` /
// D536's `d536-moltres` / D537's `d537-bencher` shape. ⚠️ **A REACHABILITY ARGUMENT
// BUILT ON A POPULATION GOES STALE LIKE A COUNT** (D536's finding, recurring at D537),
// which is why the grep is recorded beside the declaration rather than in a commit body.
//
// engine 0.422.0 → 0.423.0. ONE new whole-sentence anchor (`COUNTER_PUT_SCALED_BY_PILE`,
// declared with the counter-put family), ONE new arm (**23b-bis**), ONE new OPTIONAL
// `damageChosen` rider (`perDiscardPileCard?: CardFilter`), ONE widened value domain
// (`discardPileRetrieval.max: number | "all"`), ONE new `snipeAmount` branch and ONE new
// FORCED branch in `stepOp`'s `discardPileRetrieval` arm. **ZERO new `EffectOp`
// members, zero new prompt kinds, zero new readers** — `attackReaderSurface()` stays 13.
//
// 🛑 **ONE `CardFilter`, TWO OPS, AND THAT IS THE WHOLE MECHANISM.** The head counts
// *"Basic {G} Energy card"*s in the controller's discard pile; the tail says *"those
// Energy cards"*, a CROSS-CLAUSE REFERENCE to the population the count measured. The
// filter is resolved ONCE and handed to both ops. **A build that narrows one and widens
// the other places the right damage and shuffles the wrong cards, silently** — §2 and §4
// drive the two halves against ONE filter object, and the mutant rows
// `D538-retrieval-filter-widened` and `D538-energy-noun-guard-dropped` are the two
// experiments that prove the decision was MADE.
//
// 🛑 **THE PROGRAM ORDER IS LOAD-BEARING AND IS THE SHARPEST DEFECT THIS SLICE COULD
// HAVE SHIPPED.** The fold reads the pile, so the retrieval must run AFTER the
// placement. Swapped, `countCardsInDiscardPile` sees an emptied pile, the amount folds
// to 0, `damageChosen` returns before it asks, and the attack places NOTHING under a log
// that reads exactly right (`D538-program-order-swapped`). §2 pins the order and §5
// pins the value the pile is read at on BOTH resolution paths.
//
// 🛑 **`MATCH_RECORD_VERSION` HELD AT 30, ON D125's WIDENING AND ON NOTHING ELSE.**
// `damageChosen` PARKS, so `perDiscardPileCard` rides `phase.cont.pendingOp`; the program
// is THREE ops, so `{"op":"discardPileRetrieval",…,"max":"all"}` rides `phase.cont.rest`.
// **BOTH literals GROW the serialized alphabet** (D450's two doors) and §7 measures them
// rather than claiming the type is unpersisted. 30 holds because no v30 deploy can author
// either byte and every byte a v30 deploy DID write still means what it meant: a NEW
// OPTIONAL KEY whose absence means what it always meant (D125, the same door
// `perEnergyOnSelf` and `perRecorded` were added through at 29) and a PURE ADDITION to a
// value domain (D333's `lookAtTopN.max: "any"`, D527's `searchDeck.max:
// "yourBenchCount"`). Neither is D359's RENAME.
// ─────────────────────────────────────────────────────────────────────────────

/** The printed sentence, read off the corpus in §1 and used as a constant everywhere
    else. Retyped ONCE, here, and §1's first rung is what proves the bytes agree. */
const PRINTED =
  "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.";

/** The printed HEAD and the printed TAIL, each on its own. Neither is read by anything,
    which is the whole-sentence claim made executable rather than asserted in prose. */
const HEAD_ALONE =
  "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile.";
const TAIL_ALONE = "Then, shuffle those Energy cards into your deck.";

/** The UNSCALED twin, corpus line 413 — arm 23b's whole sentence, and a strict PREFIX
    of this one up to its own `.`. */
const UNSCALED_TWIN = "Put 2 damage counters on 1 of your opponent's Pokémon.";

/** The filter the printed noun resolves to. ONE object, shared by both ops. */
const GRASS_FILTER: CardFilter = { kind: "basicEnergy", energyType: "Grass" };

/** The derived program, spelled once. THREE ops in printed order. */
const PROGRAM: EffectOp[] = [
  {
    op: "damageChosen",
    target: "opponentAny",
    amount: 20,
    count: 1,
    source: "attack",
    perDiscardPileCard: GRASS_FILTER,
  },
  { op: "discardPileRetrieval", filter: GRASS_FILTER, dest: "deck", max: "all" },
  { op: "shuffleDeck" },
];

const SNIPER = "d538-pile-sniper";
const WALL = "d538-wall";
const B1 = "d538-b1";
const B2 = "d538-b2";
/** THE MATCHING CARD — Basic {G} Energy, the only card class the printed noun names. */
const GRASS = "fix-grass-energy";
/** THE OFF-TYPE BASIC — Basic {R}. `basicEnergy` YES, `energyType: "Grass"` NO, so it
    separates the TYPED filter from a bare `{kind:"basicEnergy"}`. */
const FIRE = "fix-fire-energy";
/** THE SPECIAL ENERGY — `anyEnergy` YES, `basicEnergy` NO (the printed word *"Basic"*). */
const SPECIAL = "fix-special";
/** THE NON-ENERGY — an Item Trainer, so a build counting pile LENGTH reads a third
    number and not a second one. */
const ITEM = "fix-item";
/** Basic {C} — the printed cost of both declared attacks, and nothing else. */
const ENERGY = "fix-energy";

const bencher = (id: string, name: string, hp: number): Card =>
  battler(id, {
    name,
    hp,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  });

const LOCAL_CARDS: Record<string, Card> = {
  [SNIPER]: battler(SNIPER, {
    name: "D538 Pile Sniper",
    hp: 260,
    retreat: 1,
    types: ["Colorless"],
    attacks: [
      // ⚠️ **NO PRINTED `damage`, AND THAT IS A DECLARATION RATHER THAN A PRINTING'S
      // FACT** (no id is resolved for this sentence, D425). It is omitted so that every
      // point of HP this suite counts on the opponent's board came from the OP, and a
      // rung reading 60 cannot be read as 50 + 10.
      { cost: ["Colorless"], name: "Pile Snipe", effect: PRINTED },
      // THE CONTROL, one index over: same attacker, same cost, NO effect text — so
      // every "no park AND no board change" verdict is a claim about the op rather
      // than about the board.
      { cost: ["Colorless"], name: "Plain Tap", damage: 10 },
      // THE NOUN NEAR MISSES, declared so §6 can drive the guard through a real attack
      // rather than through the deriver alone. Index 2 resolves to a NON-ENERGY filter
      // (`typedPokemon`) and index 3 resolves to NOTHING at all (`{Q}` is not a code).
      {
        cost: ["Colorless"],
        name: "Body Count",
        effect:
          "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Pokémon in your discard pile. Then, shuffle those Energy cards into your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Nonsense Count",
        effect:
          "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {Q} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.",
      },
    ],
  }),
  [WALL]: bencher(WALL, "D538 Wall", 330),
  [B1]: bencher(B1, "D538 B1", 200),
  [B2]: bencher(B2, "D538 B2", 200),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** ITS OWN DECK on D270's rule, never a widened shared one: `deckOf` order feeds the
    shuffle, so moving one card in a shared deck reshuffles every seed-pinned board that
    reads it. 4 + 4 + 4 + 4 + 12 + 6 + 6 + 6 + 14 = 60. */
const DECK = deckOf({
  [SNIPER]: 4,
  [WALL]: 4,
  [B1]: 4,
  [B2]: 4,
  [GRASS]: 12,
  [FIRE]: 6,
  [SPECIAL]: 6,
  [ITEM]: 6,
  [ENERGY]: 14,
});

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string | readonly string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob(["./{censusAttackCorpus,effects,interpreter}.ts", "../../../apps/api/src/lobby/match.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const raw = (suffix: string): string =>
  Object.entries(RAW).find(([k]) => k.endsWith(suffix))?.[1] ?? "";

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** TEST SURGERY — move `count` copies of `cardId` from `seat`'s deck into their DISCARD
    pile. The pile is the zone this whole slice reads, and every card in it is placed by
    surgery rather than by scripting the KOs that would put it there. */
function toPile(state: GameState, seat: Seat, cardId: string, count: number): GameState {
  const side = state.players[seat];
  const uids = side.deck.filter((u) => state.cardIdByUid[u] === cardId).slice(0, count);
  if (uids.length < count) {
    throw new Error(`${seat} deck has ${uids.length} ${cardId}, needed ${count}`);
  }
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => !taken.has(u)),
        discard: [...side.discard, ...uids],
      },
    },
  };
}

/** TEST SURGERY — attach `count` copies of `fix-energy` off `seat`'s deck onto its
    Active, so the printed cost is payable. */
function fuel(state: GameState, seat: Seat, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i++) {
    const side = next.players[seat];
    const body = side.active;
    if (body === null) throw new Error(`${seat} has no Active`);
    const uid = side.deck.find((u) => next.cardIdByUid[u] === ENERGY);
    if (uid === undefined) throw new Error(`${seat}'s deck lacks ${ENERGY}`);
    next = {
      ...next,
      players: {
        ...next.players,
        [seat]: {
          ...side,
          active: { ...body, energy: [...body.energy, uid] },
          deck: side.deck.filter((u) => u !== uid),
        },
      },
    };
  }
  return next;
}

/** THE CANONICAL PILE — 3 matching and 5 decoys, chosen so that FIVE wrong builds read
    FIVE different numbers on one board at the printed 2 counters (20 HP) per card:

      the print      — Basic {G} in YOUR pile                 3 → **60**
      the TYPE wide  — any Basic Energy in your pile          5 → 100
      the CLASS wide — any Energy at all in your pile         7 → 140
      the pile LENGTH— no filter at all                       8 → 160
      the SEAT wrong — Basic {G} in your OPPONENT's pile      1 →  20

    Five distinct totals, none a multiple of another by accident, and the defender
    (330 HP) survives all five so every rung reads damage rather than a Knock Out. */
function stockPile(state: GameState): GameState {
  let next = toPile(state, "p1", GRASS, 3);
  next = toPile(next, "p1", FIRE, 2);
  next = toPile(next, "p1", SPECIAL, 2);
  next = toPile(next, "p1", ITEM, 1);
  // …and ONE matching card on the OPPONENT's side, so "the seat is read" is a claim
  // about a pile that is NOT empty rather than about an absence (D423).
  return toPile(next, "p2", GRASS, 1);
}

/** p1's turn; `d538-pile-sniper` Active with one {C}; p2's Active is `WALL` and its
    Bench is exactly `bench`, in the order given. The discard piles are UNTOUCHED —
    every rung stocks its own. */
function board(seed: number, bench: readonly string[] = []): GameState {
  let state = localSetup(seed);
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", SNIPER);
  state = clearBench(state, "p1");
  return fuel(state, "p1", 1);
}

function attack(state: GameState, index = 0): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, { type: "attack", seat: "p1", index });
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function answer(
  state: GameState,
  ref: PokemonRef,
): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [ref] },
  });
  if (!result.ok) throw new Error(`answer refused: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

const SEED = 538;
const benchRef = (index: number): PokemonRef => ({ seat: "p2", spot: { spot: "bench", index } });
const ACTIVE_REF: PokemonRef = { seat: "p2", spot: { spot: "active" } };
const rows = (events: readonly GameEvent[], type: string) => events.filter((e) => e.type === type);
const pileIds = (state: GameState, seat: Seat): string[] =>
  state.players[seat].discard.map((u) => state.cardIdByUid[u] ?? "?");
const deckIds = (state: GameState, seat: Seat): string[] =>
  state.players[seat].deck.map((u) => state.cardIdByUid[u] ?? "?");
const activeDamage = (state: GameState, seat: Seat): number => state.players[seat].active?.damage ?? -1;

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE CENSUS ROW AND THE ANCHOR.
// ─────────────────────────────────────────────────────────────────────────────

describe("D538 §1 — the corpus row, read off the census rather than retyped", () => {
  it("🛑 the row is READ by index and by units, never retyped (D183/D456)", () => {
    const corpus = legalAttackCorpus();
    const row = corpus[359];
    expect(row?.[1]).toBe(PRINTED);
    // The LEADING COUNT COLUMN is the printing count, and it is the unit the census
    // delta is measured in — 1 sentence, 3 legal printings. ⚠️ THIS ROW IS WHY D538's
    // sentence step and printing step DISAGREE (1 against 3), the fourth consecutive
    // slice on which they have.
    expect(row?.[0]).toBe(3);
    // EXACTLY ONE row carries this string: the sentence is the key of the census delta,
    // so a duplicate would double-count the printings under one build.
    expect(corpus.filter(([, s]) => s === PRINTED)).toEqual([[3, PRINTED]]);
  });

  it("🛑 the sentence is READ by `resolvedByAnyReader` at head — the census delta's own predicate", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });

  it("🛑 the SURFACE did not grow: a new ARM is not a new READER (D447)", () => {
    // Asked of the SURFACE rather than of one reader: arm 23b-bis sits inside
    // `deriveAttackEffect`, so there is no fourteenth reader and `attackReaderSurface()`
    // is the same length it was at HEAD.
    expect(attackReaderSurface()).toHaveLength(14 /* 🆕🆕🆕 D573: 13 → 14, + deriveAttackCopy */);
  });

  it("🛑 ONE apostrophe slot, COUNTED off the printed bytes", () => {
    // D537's anchor had THREE (two possessives and a contraction); this one has exactly
    // one — "opponent's". "your discard pile" and "your deck" carry no mark at all, so a
    // successor cannot quietly add a slot the sentence does not have.
    expect((PRINTED.match(/'/g) ?? []).length).toBe(1);
    expect(PRINTED.split("opponent's")).toHaveLength(2);
  });

  it("🛑 the one slot CURLS and derives IDENTICALLY (D136/D137)", () => {
    const curly = PRINTED.replace("opponent's", "opponent’s");
    expect(curly).not.toBe(PRINTED);
    expect((curly.match(/'/g) ?? []).length).toBe(0);
    // EQUALITY, never merely non-null: a non-null check passes on a reader that folded
    // the sentence into some other row. `D538-anchor-apostrophe-straightened` is the
    // experiment this rung is the killer for.
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(PRINTED));
    expect(deriveAttackEffect(curly)).toEqual(PROGRAM);
  });

  it("the LOOKALIKE `Pokemon` is not `Pokémon` — the one occurrence", () => {
    expect(PRINTED.split("Pokémon")).toHaveLength(2);
    expect(deriveAttackEffect(PRINTED.replace("Pokémon", "Pokemon"))).toBeNull();
  });

  it("a NON-BREAKING SPACE anywhere in the sentence is NOT this sentence", () => {
    const nbsp = PRINTED.replace("Put 2", "Put 2");
    expect(nbsp).not.toBe(PRINTED);
    expect(deriveAttackEffect(nbsp)).toBeNull();
  });

  it("🛑 the HEAD is anchored — a printed prefix refuses", () => {
    expect(deriveAttackEffect(`You may ${PRINTED[0]?.toLowerCase()}${PRINTED.slice(1)}`)).toBeNull();
    expect(deriveAttackEffect(`Flip a coin. If heads, ${PRINTED[0]?.toLowerCase()}${PRINTED.slice(1)}`)).toBeNull();
  });

  it("🛑 the TAIL is anchored — the `$` refuses a printed continuation", () => {
    // `D538-anchor-loses-its-dollar` is the experiment: without the `$` the anchor would
    // claim any sentence this one prefixes, and the reader would silently drop whatever
    // followed it.
    expect(deriveAttackEffect(`${PRINTED} During your next turn, this Pokémon can't attack.`)).toBeNull();
    expect(deriveAttackEffect(PRINTED.replace(/\.$/, ""))).toBeNull();
    expect(deriveAttackEffect(PRINTED.replace(/\.$/, "!"))).toBeNull();
  });

  it("🛑 NO /i ON THIS PATH: the lowercase mid-sentence spelling is refused", () => {
    expect(deriveAttackEffect(`${PRINTED[0]?.toLowerCase()}${PRINTED.slice(1)}`)).toBeNull();
    expect(raw("/effects.ts")).toContain(
      "/^Put (\\d+) damage counters on 1 of your opponent['’]s Pokémon for each (.+) in your discard pile\\. Then, shuffle those Energy cards into your deck\\.$/",
    );
  });

  it("🛑 NEITHER HALF IS READ ON ITS OWN, which is what makes the anchor whole-sentence", () => {
    // The head alone carries this family's verb and a count clause; the tail alone is a
    // printed clause with a cross-clause referent. Both are refused, and both refusals
    // are what `scaledAnySnipe.test.ts` §1(d) and `counterPutChosen.test.ts` §1(a) keep
    // after their `toContain`s inverted (D418 — re-point, never delete).
    expect(deriveAttackEffect(HEAD_ALONE)).toBeNull();
    expect(deriveAttackEffect(TAIL_ALONE)).toBeNull();
    expect(deriveAttackEffect("Shuffle those Energy cards into your deck.")).toBeNull();
  });

  it("🛑 NO SPLITTER composes on it, which is why `SPLIT_ATTACK_UNITS` does not move", () => {
    // D426's mechanism, driven rather than asserted: the sentence DOES carry a `. `
    // joiner, so the question is a real one — and all four splitters refuse it, because
    // `deriveAttackEffect(tail)` is null and a splitter needs a buildable tail.
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE ARM, THE PROGRAM AND THE ORDERING, MEASURED IN BOTH DIRECTIONS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D538 §2 — arm 23b-bis derives THREE ops, and ONE filter object serves two of them", () => {
  it("🛑 the whole program, field for field", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
  });

  it("🛑 the counters are converted to HP AT THE PRODUCER (§12), never left as counters", () => {
    // `D538-counters-not-converted` is the experiment: the printed 2 is 20 HP, and the
    // interpreter's fold multiplies an HP figure it never has to unit-convert. The whole
    // family — arms 22, 23, 23a, 23b, 25 — converts here.
    expect((deriveAttackEffect(PRINTED)?.[0] as Record<string, unknown>).amount).toBe(20);
    expect(
      (deriveAttackEffect(PRINTED.replace("Put 2 ", "Put 5 "))?.[0] as Record<string, unknown>)
        .amount,
    ).toBe(50);
  });

  it("🛑 the count is CAPTURED and the printed-zero guard is LOUD", () => {
    // `D538-printed-zero-guard-relaxed` is the experiment: a printed 0 would park the
    // attacker on a choice with no possible outcome, so the whole sentence falls to the
    // loud skip path instead.
    expect(deriveAttackEffect(PRINTED.replace("Put 2 ", "Put 0 "))).toBeNull();
    expect(deriveAttackEffect(PRINTED.replace("Put 2 ", "Put 1 "))).not.toBeNull();
  });

  it("🛑 THE SAME FILTER OBJECT reaches both ops — asserted by IDENTITY, not by shape", () => {
    // 🛑 **THE DEFECT THIS RUNG EXISTS FOR IS SILENT.** A build that gave each op its own
    // literal would pass every damage assertion in §3 and every event assertion in §4
    // while shuffling a different population. Identity is the strongest available claim
    // and it is the one the arm actually makes (`filter: pileFilter` twice, one `const`).
    const program = deriveAttackEffect(PRINTED) as unknown as Record<string, unknown>[];
    expect(program).toHaveLength(3);
    expect(program[0]?.perDiscardPileCard).toBe(program[1]?.filter);
    expect(program[0]?.perDiscardPileCard).toEqual(GRASS_FILTER);
  });

  it("🛑 the ORDER is placement → retrieval → shuffle, and the order is the mechanism", () => {
    // `D538-program-order-swapped` is the sharpest row this slice declares: the fold
    // reads the pile, so a retrieval in front of it empties the pile, folds the amount to
    // 0 and ends the op before it asks — an attack that places nothing under a correct
    // log. The order is pinned as a LIST of op kinds so a reordering fails by shape.
    expect(deriveAttackEffect(PRINTED)?.map((o) => o.op)).toEqual([
      "damageChosen",
      "discardPileRetrieval",
      "shuffleDeck",
    ]);
  });

  it("🛑 NO `deals`, NO `recordAs`, NO `exclude`, NO `ignoreWR` — every absent key named", () => {
    // `D538-deals-set-on-the-placement` is the experiment. These are PLACED counters, so
    // an Active pick routes through `damageActive` (flat, §11-gated) rather than
    // `snipeActive`'s §8.5 pipeline; `deals: true` would DOUBLE the placement on a
    // Weakness. And D135: an unread field is a field with no observable meaning, so the
    // two §9.2 riders are ABSENT rather than `undefined`.
    const head = deriveAttackEffect(PRINTED)?.[0] as Record<string, unknown>;
    const retrieval = deriveAttackEffect(PRINTED)?.[1] as Record<string, unknown>;
    expect(head).not.toHaveProperty("deals");
    expect(head).not.toHaveProperty("ignoreWR");
    expect(head).not.toHaveProperty("optional");
    expect(retrieval).not.toHaveProperty("recordAs");
    expect(retrieval).not.toHaveProperty("exclude");
    expect(Object.keys(head).sort()).toEqual(
      ["amount", "count", "op", "perDiscardPileCard", "source", "target"].sort(),
    );
    expect(Object.keys(retrieval).sort()).toEqual(["dest", "filter", "max", "op"].sort());
  });

  it("🛑 DIRECTION 1 — arm 23b-bis cannot claim arm 23b's string", () => {
    // Both anchors are `^…$`. Arm 23b's sentence ENDS at `Pokémon.` where this one
    // continues " for each", so no ordering of the two arms can matter — and that is
    // MEASURED here rather than copied from arm 41-bis's or 42-bis's argument.
    expect(deriveAttackEffect(UNSCALED_TWIN)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 20, count: 1, source: "attack" },
    ]);
    expect(deriveAttackEffect(UNSCALED_TWIN)).toHaveLength(1);
    expect(deriveAttackEffect(UNSCALED_TWIN)?.[0]).not.toHaveProperty("perDiscardPileCard");
  });

  it("🛑 DIRECTION 2 — arm 23b cannot claim arm 23b-bis's string", () => {
    expect(deriveAttackEffect(PRINTED)).toHaveLength(3);
    expect(deriveAttackEffect(PRINTED)).not.toEqual(deriveAttackEffect(UNSCALED_TWIN));
    // …and the scaled sentence is NOT the unscaled one with a rider bolted on: the
    // program length is the difference a widened `(\d+)` capture could never produce.
    expect(deriveAttackEffect(PRINTED)?.[0]).not.toEqual(deriveAttackEffect(UNSCALED_TWIN)?.[0]);
  });

  it("🛑 DIRECTION 3 — the COMPOUND at corpus line 416 keeps its own two ops", () => {
    // Arm 25's sentence shares this one's first eight words and diverges at the same
    // offset. The `$` on all three anchors is what keeps the three apart, and it is
    // asserted from every side rather than reasoned about.
    const compound =
      "Put 9 damage counters on 1 of your opponent's Pokémon. During your next turn, this Pokémon can't attack.";
    expect(deriveAttackEffect(compound)).toHaveLength(2);
    expect(deriveAttackEffect(compound)).not.toEqual(deriveAttackEffect(PRINTED));
    expect(deriveAttackEffect(compound)?.map((o) => o.op)).toEqual([
      "damageChosen",
      "preventAttack",
    ]);
  });

  it("🛑 THE TWO NEAR MISSES, both refused on the NOUN and each for its own reason", () => {
    // (a) A noun that resolves to a NON-ENERGY filter — refused by the `basicEnergy`
    //     guard, which is the printed anaphora ("those ENERGY cards") made mechanical.
    expect(
      deriveAttackEffect(
        "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Pokémon in your discard pile. Then, shuffle those Energy cards into your deck.",
      ),
    ).toBeNull();
    // (b) A noun that resolves to NOTHING — `{Q}` is in neither code map, so
    //     `typedNounFilter` returns `undefined` and the sentence falls to the loud skip
    //     path rather than being approximated.
    expect(
      deriveAttackEffect(
        "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {Q} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.",
      ),
    ).toBeNull();
  });

  it("🛑 THE NUMBER IS WELDED: the PLURAL spelling of the noun derives NOTHING", () => {
    // `D538-singular-map-becomes-plural` is the experiment, and this rung is why it
    // cannot be a silent no-op: `typedNounFilter` welds the grammatical number, so the
    // plural map and `true` derive nothing off the printed SINGULAR string — and the
    // plural string is not printed at all.
    expect(
      deriveAttackEffect(
        "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy cards in your discard pile. Then, shuffle those Energy cards into your deck.",
      ),
    ).toBeNull();
    // …and the SINGULAR one does derive, which is the control that makes the refusal
    // above about the NUMBER rather than about the sentence.
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
  });

  it("🛑 the OTHER printed types derive too — the filter is the CAPTURE, not a literal", () => {
    // The anchor captures the noun, so every typed Basic Energy spelling this family
    // could print resolves. 0 printings today for the others, which is what makes this a
    // claim about the MECHANISM rather than about the catalog.
    expect(
      (
        deriveAttackEffect(PRINTED.replace("Basic {G} Energy", "Basic {R} Energy"))?.[0] as Record<
          string,
          unknown
        >
      ).perDiscardPileCard,
    ).toEqual({ kind: "basicEnergy", energyType: "Fire" });
    // …and the UNQUALIFIED Energy noun is refused: without the printed word "Basic" the
    // phrase is a PROVISION phrase, a different filter for a different question.
    expect(
      deriveAttackEffect(
        "Put 2 damage counters on 1 of your opponent's Pokémon for each {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.",
      ),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE FOLD: the pile, the seat and the filter.
// ─────────────────────────────────────────────────────────────────────────────

describe("D538 §3 — the amount folds over the CONTROLLER's pile, through the PRINTED filter", () => {
  it("🛑 the canonical pile answers 3 / 5 / 7 / 8 / 1 — five builds, five numbers", () => {
    // The reader is `countCardsInDiscardPile`, called directly here so the fold is
    // separated from the op that consumes it (D436's rule: the comparand fixes the unit).
    const state = stockPile(board(SEED));
    expect(countCardsInDiscardPile(state, "p1", GRASS_FILTER)).toBe(3);
    expect(countCardsInDiscardPile(state, "p1", { kind: "basicEnergy" })).toBe(5);
    expect(countCardsInDiscardPile(state, "p1", { kind: "anyEnergy" })).toBe(7);
    expect(state.players.p1.discard).toHaveLength(8);
    expect(countCardsInDiscardPile(state, "p2", GRASS_FILTER)).toBe(1);
  });

  it("🛑 the ATTACK reads 3 and places 60 — the printed 2 counters × 3 cards", () => {
    const { state } = attack(stockPile(board(SEED)));
    // The opponent fields only an Active, so `count: 1` FORCES and there is no park.
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(activeDamage(state, "p2")).toBe(60);
  });

  it("🛑 THE SEAT IS `ctx.seat` AND NOT ITS COMPLEMENT — the opponent's pile is not read", () => {
    // `D538-fold-reads-the-opponents-pile` is the experiment, and `otherSeat` IS bound in
    // `interpreter.ts`, so it is a mistake an author could actually make. The two piles
    // hold 3 and 1 matching cards, so the inversion reads 20 where the print reads 60.
    const stocked = stockPile(board(SEED));
    expect(countCardsInDiscardPile(stocked, "p2", GRASS_FILTER)).toBe(1);
    const { state } = attack(stocked);
    expect(activeDamage(state, "p2")).toBe(60);
    expect(activeDamage(state, "p2")).not.toBe(20);
  });

  it("🛑 THE FILTER IS READ — a pile of decoys alone places nothing", () => {
    // `D538-fold-ignores-the-filter` is the experiment (count the pile's LENGTH instead
    // of walking it). This board holds FIVE cards and none of them matches, so the
    // unfiltered build reads 100 where the print reads 0.
    let state = board(SEED);
    state = toPile(state, "p1", FIRE, 2);
    state = toPile(state, "p1", SPECIAL, 2);
    state = toPile(state, "p1", ITEM, 1);
    expect(state.players.p1.discard).toHaveLength(5);
    expect(countCardsInDiscardPile(state, "p1", GRASS_FILTER)).toBe(0);
    const after = attack(state);
    expect(activeDamage(after.state, "p2")).toBe(0);
    expect(after.state.phase.kind).not.toBe("effect:choose");
  });

  it("🛑 AN EMPTY PILE FOLDS TO 0 AND `damageChosen` RETURNS BEFORE ASKING", () => {
    // Not a park with nothing in it — `stepOp`'s `amount <= 0` early return ends the op
    // BEFORE the candidates are offered, which is the ending a 0-taken Covetous Ivy has.
    // Driven on a board where the opponent HAS a bench, so a park is otherwise certain.
    const state = board(SEED, [B1, B2]);
    expect(state.players.p1.discard).toHaveLength(0);
    const { state: after } = attack(state);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(activeDamage(after, "p2")).toBe(0);
    expect(after.players.p2.bench.map((b) => b.damage)).toEqual([0, 0]);
  });

  it("🛑 the fold SCALES — one more matching card is one more 20", () => {
    for (const [copies, hp] of [
      [1, 20],
      [2, 40],
      [4, 80],
    ] as const) {
      const { state } = attack(toPile(board(SEED), "p1", GRASS, copies));
      expect(activeDamage(state, "p2"), `${copies} copies`).toBe(hp);
    }
  });

  it("🛑 THE RIDER IS CHECKED BEFORE `perEnergyOnSelf`'s unconditional return", () => {
    // `D538-rider-checked-too-late` is the experiment: `snipeAmount`'s
    // `if (op.perEnergyOnSelf !== true) return op.amount;` returns for EVERY op carrying
    // this rider, so a branch appended below it is dead code and the card deals a FLAT
    // 20 where it prints 20 × N. The board reads 60, which is the value only the live
    // branch can produce.
    const { state } = attack(stockPile(board(SEED)));
    expect(activeDamage(state, "p2")).toBe(60);
    expect(activeDamage(state, "p2")).not.toBe(20);
    expect(raw("/interpreter.ts")).toContain(
      "if (op.perDiscardPileCard !== undefined)\n    return op.amount * countCardsInDiscardPile(state, ctx.seat, op.perDiscardPileCard);\n  if (op.perEnergyOnSelf !== true) return op.amount;",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE FORCED RETRIEVAL ON `dest: "deck"`, AND ITS ONE EVENT ROW.
// ─────────────────────────────────────────────────────────────────────────────

describe("D538 §4 — `max: \"all\"` moves the whole matching pile, FORCED and never parked", () => {
  it("🛑 the three matching cards leave the pile and land in the deck", () => {
    const before = stockPile(board(SEED));
    expect(pileIds(before, "p1").filter((id) => id === GRASS)).toHaveLength(3);
    const { state } = attack(before);
    // The matching cards are GONE from the pile and the five decoys are untouched.
    expect(pileIds(state, "p1").filter((id) => id === GRASS)).toHaveLength(0);
    expect(pileIds(state, "p1").sort()).toEqual([FIRE, FIRE, ITEM, SPECIAL, SPECIAL].sort());
    expect(state.players.p1.discard).toHaveLength(5);
    expect(deckIds(state, "p1").filter((id) => id === GRASS)).toHaveLength(
      deckIds(before, "p1").filter((id) => id === GRASS).length + 3,
    );
  });

  it("🛑 ONE `DISCARD_RETRIEVED` row, naming the SEAT, the DEST and the UIDS that moved", () => {
    const before = stockPile(board(SEED));
    const movedUids = before.players.p1.discard.filter(
      (u) => before.cardIdByUid[u] === GRASS,
    );
    const { events, state } = attack(before);
    const retrieved = rows(events, "DISCARD_RETRIEVED");
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0]).toEqual({
      type: "DISCARD_RETRIEVED",
      seat: "p1",
      dest: "deck",
      uids: movedUids,
    });
    // …and what the row NAMES is exactly what left the pile, which is `retrieveMove`'s
    // stated rule rather than a coincidence of this board.
    expect(state.players.p1.discard.some((u) => movedUids.includes(u))).toBe(false);
  });

  it("🛑 NO PARK — the clause is mandatory, so the player is never asked", () => {
    // 🛑 **THE TWO WRONG ENDINGS THIS BRANCH EXISTS TO REFUSE.** A `chooseCards` park at
    // `min === max === candidates.length` is a question with exactly one answer (D537's
    // M1 no-choice rule); the SHIPPED `min: 0` park, whose own comment reads *"up to" —
    // taking none is a legal answer*, would let the player DECLINE a clause the card
    // prints as compulsory (D435's plausible-looking wrong board). Driven on a board
    // where `damageChosen` itself does not park either, so a `chooseCards` phase here
    // could only come from the retrieval.
    const { state } = attack(stockPile(board(SEED)));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(JSON.stringify(state)).not.toContain("chooseCards");
  });

  it("🛑 `max: \"all\"` is the WHOLE matching pile and not a number — six copies move too", () => {
    // `D538-max-all-becomes-one` is the experiment: a `max: 1` would retrieve one card,
    // place the right damage, and be invisible on any board holding exactly one match.
    const before = toPile(board(SEED), "p1", GRASS, 6);
    const { state } = attack(before);
    expect(activeDamage(state, "p2")).toBe(120);
    expect(pileIds(state, "p1")).toEqual([]);
  });

  it("🛑 the DESTINATION is the DECK and not the hand", () => {
    // `D538-retrieval-dest-hand` is the experiment. The hand is measured before and
    // after, because "it is not in the pile" is true of both destinations.
    const before = stockPile(board(SEED));
    const handSize = before.players.p1.hand.length;
    const movedUids = before.players.p1.discard.filter((u) => before.cardIdByUid[u] === GRASS);
    const { state } = attack(before);
    expect(state.players.p1.hand).toHaveLength(handSize);
    // ⚠️ **BY UID AND NOT BY CARD ID**: the opening hand already holds copies of this very
    // card, so "no Grass Energy in hand" is false on every board and would be the wrong
    // claim. The question is whether THE THREE THAT LEFT THE PILE went to the hand.
    expect(movedUids).toHaveLength(3);
    for (const uid of movedUids) {
      expect(state.players.p1.hand, uid).not.toContain(uid);
      expect(state.players.p1.deck, uid).toContain(uid);
    }
  });

  it("🛑 the RETRIEVAL reads the SAME filter the fold did — the decoys stay put", () => {
    // `D538-retrieval-filter-widened` is the experiment, and it is the one an audit that
    // checks only the damage misses: with `{kind:"anyEnergy"}` on the retrieval the
    // placement is still 60 and the Special Energy and the off-type Basics are shuffled
    // away as well. The pile contents after the attack are the only thing that sees it.
    const { state } = attack(stockPile(board(SEED)));
    expect(activeDamage(state, "p2")).toBe(60);
    expect(pileIds(state, "p1").filter((id) => id === SPECIAL)).toHaveLength(2);
    expect(pileIds(state, "p1").filter((id) => id === FIRE)).toHaveLength(2);
    expect(pileIds(state, "p1").filter((id) => id === ITEM)).toHaveLength(1);
  });

  it("🛑 ONE `SHUFFLE` row and ONE RNG draw for one printed shuffle", () => {
    // `D538-trailing-shuffle-dropped` is the experiment: without it the retrieved cards
    // sit on the BOTTOM of the deck in pile order, which is a known board rather than a
    // shuffled one — no `SHUFFLE` row and no RNG draw.
    const before = stockPile(board(SEED));
    const { events, state } = attack(before);
    expect(rows(events, "SHUFFLE")).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
    expect(state.rngState).not.toEqual(before.rngState);
  });

  it("🛑 the two `retrieveMax` lines are BYTE-IDENTICAL, which keeps D237's clamp row alive", () => {
    // The forced branch sits ABOVE them so control-flow narrowing leaves `op.max: number`
    // for the bench clamp — measured here rather than trusted, because the mutant row
    // `D237-bench-clamp-dropped-at-the-park` quotes these two lines verbatim and would go
    // 0× if they moved.
    expect(raw("/interpreter.ts")).toContain(
      '      const retrieveMax =\n        op.dest === "bench" ? Math.min(op.max, benchSpace(state, ctx.seat)) : op.max;',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — BOTH RESOLUTION PATHS OF `damageChosen`, AT THE SAME PILE VALUE.
// ─────────────────────────────────────────────────────────────────────────────

describe("D538 §5 — forced and parked resolve the same sentence to the same board", () => {
  it("🛑 FORCED — the opponent fields only an Active, so `count: 1` takes it without asking", () => {
    // §8.6: with fewer candidates than the printed number, take them all. `opponentAny`
    // over a bare Active is exactly one candidate.
    const { state } = attack(stockPile(board(SEED)));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(activeDamage(state, "p2")).toBe(60);
    // …and the WHOLE program ran in the one action: the retrieval and the shuffle are
    // not left behind by the forced path.
    expect(state.players.p1.discard).toHaveLength(5);
  });

  it("🛑 PARKED — a bench makes it a real question, and the pile is READ AT THE SAME VALUE", () => {
    const before = stockPile(board(SEED, [B1, B2]));
    const { state: parked } = attack(before);
    expect(parked.phase.kind).toBe("effect:choose");
    // 🛑 **THE PILE IS STILL FULL AT THE PARK**: the retrieval rides `cont.rest` and has
    // not run, so `applyChoice`'s own `snipeAmount` call recomputes the SAME 3.
    expect(parked.players.p1.discard).toHaveLength(8);
    expect(countCardsInDiscardPile(parked, "p1", GRASS_FILTER)).toBe(3);
    const { state: done } = answer(parked, benchRef(1));
    expect(done.players.p2.bench[1]?.damage).toBe(60);
    expect(done.players.p2.bench[0]?.damage).toBe(0);
    expect(activeDamage(done, "p2")).toBe(0);
    // …and the rest of the program ran on resume, exactly as it did on the forced path.
    expect(done.players.p1.discard).toHaveLength(5);
  });

  it("🛑 THE PARKED PATH CAN ALSO NAME THE ACTIVE, and the amount is the same 60", () => {
    const before = stockPile(board(SEED, [B1, B2]));
    const { state: parked } = attack(before);
    const { state: done } = answer(parked, ACTIVE_REF);
    expect(activeDamage(done, "p2")).toBe(60);
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([0, 0]);
  });

  it("🛑 the two paths agree on the PILE, the DECK and the EVENTS", () => {
    // The same sentence, the same pile, two different boards — and everything this op
    // does to the CONTROLLER's zones is identical. That is what makes the forced branch a
    // shortcut rather than a second implementation.
    const forced = attack(stockPile(board(SEED)));
    const before = stockPile(board(SEED, [B1, B2]));
    const parked = attack(before);
    const resumed = answer(parked.state, benchRef(0));
    expect(pileIds(forced.state, "p1").sort()).toEqual(pileIds(resumed.state, "p1").sort());
    expect(rows(forced.events, "DISCARD_RETRIEVED")).toHaveLength(1);
    expect(rows(resumed.events, "DISCARD_RETRIEVED")).toHaveLength(1);
    expect(rows(forced.events, "SHUFFLE")).toHaveLength(1);
    expect(rows(resumed.events, "SHUFFLE")).toHaveLength(1);
    // …and the PARK itself files neither row, which is where the "the retrieval rides
    // `rest`" claim becomes observable rather than structural.
    expect(rows(parked.events, "DISCARD_RETRIEVED")).toHaveLength(0);
    expect(rows(parked.events, "SHUFFLE")).toHaveLength(0);
  });

  it("🛑 the CONTROL attack, one index over, moves none of this", () => {
    // Same attacker, same cost, no effect text: every "the op did it" verdict above is a
    // claim about the op rather than about the board.
    const before = stockPile(board(SEED, [B1, B2]));
    const { state, events } = attack(before, 1);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p1.discard).toHaveLength(8);
    expect(rows(events, "DISCARD_RETRIEVED")).toHaveLength(0);
    expect(rows(events, "SHUFFLE")).toHaveLength(0);
    expect(activeDamage(state, "p2")).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE `basicEnergy` GUARD, AND ITS LOUD SKIP (D190b).
// ─────────────────────────────────────────────────────────────────────────────

describe("D538 §6 — a head noun the tail cannot be about falls to the LOUD skip path", () => {
  it("🛑 a NON-ENERGY head noun derives to null, and the attack reports it", () => {
    // `D538-energy-noun-guard-dropped` is the experiment. The printed tail says "those
    // ENERGY cards", so a `typedPokemon` head noun cannot be the population it shuffles —
    // and without the guard the derived program would shuffle POKÉMON into the deck under
    // a caption naming Energy. 0 printings today, which is what makes this a guard on a
    // future print and exactly why it is DRIVEN.
    const { state, events } = attack(stockPile(board(SEED)), 2);
    expect(rows(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(1);
    expect(rows(events, "DISCARD_RETRIEVED")).toHaveLength(0);
    expect(activeDamage(state, "p2")).toBe(0);
    expect(state.players.p1.discard).toHaveLength(8);
  });

  it("🛑 an UNRESOLVABLE head noun derives to null too, and for a different reason", () => {
    // `{Q}` is in neither code map, so `typedNounFilter` returns `undefined` before the
    // guard is reached. TWO refusals, two mechanisms, and the events are the same loud
    // report — which is the point of the loud path (D190b/D199).
    const { state, events } = attack(stockPile(board(SEED)), 3);
    expect(rows(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(1);
    expect(rows(events, "DISCARD_RETRIEVED")).toHaveLength(0);
    expect(activeDamage(state, "p2")).toBe(0);
  });

  it("🛑 …and the PRINTED sentence is NOT skipped, which is the control for both", () => {
    const { events } = attack(stockPile(board(SEED)));
    expect(rows(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
  });

  it("🛑 the guard is on the FILTER KIND, asserted through the deriver on every map row", () => {
    // `HAND_SEARCH_SINGULAR` resolves three nouns and only ONE of them is Basic Energy.
    // The other two are refused here, which pins the guard to the KIND rather than to the
    // brace pattern.
    for (const noun of ["a Trainer card", "an Energy card"]) {
      expect(
        deriveAttackEffect(
          `Put 2 damage counters on 1 of your opponent's Pokémon for each ${noun} in your discard pile. Then, shuffle those Energy cards into your deck.`,
        ),
        noun,
      ).toBeNull();
    }
    // …and the map row that IS Basic Energy derives, UNTYPED — the control that makes the
    // two refusals above about the KIND and not about the map.
    expect(
      (
        deriveAttackEffect(
          "Put 2 damage counters on 1 of your opponent's Pokémon for each a Basic Energy card in your discard pile. Then, shuffle those Energy cards into your deck.",
        )?.[0] as Record<string, unknown>
      ).perDiscardPileCard,
    ).toEqual({ kind: "basicEnergy" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE PERSISTED BYTES (D450's two doors), MEASURED IN THREE DIRECTIONS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D538 §7 — two literals GROW the serialized alphabet and `MATCH_RECORD_VERSION` still holds at 30 (🆕🆕🆕 held at THIS slice; 31 since D547; 32 since D548; 33 since D549; 34 since D552; 35 since D556; 36 since D564; 37 since D570; 38 since D575; 39 since D576; 40 since D577; 41 since D579; 42 since D583)", () => {
  it("🛑 THE FIRST DOOR, MEASURED: the rider rides `phase.cont.pendingOp`", () => {
    // 🛑 **DO NOT RE-DERIVE *"the type is unpersisted"*.** `damageChosen` PARKS, so the
    // rider's bytes genuinely reach a stored match record.
    const { state } = attack(stockPile(board(SEED, [B1, B2])));
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(JSON.parse(JSON.stringify(state.phase.cont.pendingOp))).toEqual(PROGRAM[0]);
    expect(JSON.stringify(state)).toContain(
      '"perDiscardPileCard":{"kind":"basicEnergy","energyType":"Grass"}',
    );
  });

  it("🛑 THE SECOND DOOR, MEASURED: the widened `max` rides `phase.cont.rest`", () => {
    // D450's second door is `EffectContinuation.rest`, and on THIS program it is
    // occupied: the first op parks and two more are queued behind it.
    const { state } = attack(stockPile(board(SEED, [B1, B2])));
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(state.phase.cont.rest).toEqual([PROGRAM[1], PROGRAM[2]]);
    expect(JSON.stringify(state)).toContain('"max":"all"');
  });

  it("🛑 DIRECTION 1 — every byte string a v30 deploy could have written is UNCHANGED", () => {
    // D125's widening test, driven through JSON because the claim is about BYTES.
    const preSlice = [
      '{"op":"damageChosen","target":"opponentAny","amount":20,"count":1,"source":"attack"}',
      '{"op":"damageChosen","target":"opponentBench","amount":40,"count":1,"source":"attack","deals":true,"perTakenPrize":true}',
      '{"op":"discardPileRetrieval","filter":{"kind":"basicEnergy","energyType":"Water"},"dest":"deck","max":3}',
    ];
    for (const bytes of preSlice) {
      const revived = JSON.parse(bytes) as EffectOp;
      expect(JSON.stringify(revived)).toBe(bytes); // no key gained, none lost, order kept
    }
    // …and the two v30 sentences that wrote the first and the third still derive to
    // exactly those bytes, which is the half a RENAME would have failed.
    expect(JSON.parse(preSlice[0] as string)).toEqual(deriveAttackEffect(UNSCALED_TWIN)?.[0]);
    expect(JSON.parse(preSlice[2] as string)).toEqual(
      deriveAttackEffect(
        "Shuffle up to 3 Basic {W} Energy cards from your discard pile into your deck.",
      )?.[0],
    );
  });

  it("🛑 DIRECTION 2 — the NEW bytes are unreachable backwards and round-trip forwards", () => {
    const fresh = deriveAttackEffect(PRINTED);
    expect(JSON.stringify(fresh)).toBe(
      '[{"op":"damageChosen","target":"opponentAny","amount":20,"count":1,"source":"attack","perDiscardPileCard":{"kind":"basicEnergy","energyType":"Grass"}},' +
        '{"op":"discardPileRetrieval","filter":{"kind":"basicEnergy","energyType":"Grass"},"dest":"deck","max":"all"},' +
        '{"op":"shuffleDeck"}]',
    );
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(fresh);
    // ⚠️ **NEITHER LITERAL IS A RENAME (D359).** `perDiscardPileCard` is a NEW OPTIONAL
    // KEY whose ABSENCE means what absence has always meant here — an unscaled hit — and
    // `"all"` is a PURE ADDITION to a value domain whose numbers all still mean the
    // numbers they meant (D333's `lookAtTopN.max:"any"`, D527's
    // `searchDeck.max:"yourBenchCount"`).
    expect(raw("/effects.ts")).toContain('max: number | "all";');
  });

  it("🛑 DIRECTION 3 — the LOSS direction, and it degrades LOUDLY ENOUGH (D421)", () => {
    // A v30 reader that DROPPED the rider deals `amount` where the card prints
    // `amount × N` — the degraded op is byte-for-byte the UNSCALED twin's, which is a
    // sentence this engine also prints, so the failure is a real neighbouring program
    // rather than a crash. `D538-scale-rider-dropped` is that experiment, and the board
    // that shows it reads 20 against 60.
    const fresh = deriveAttackEffect(PRINTED)?.[0];
    const dropped = JSON.parse(
      JSON.stringify(fresh, (k, v) => (k === "perDiscardPileCard" ? undefined : v)),
    ) as EffectOp;
    expect(dropped).toEqual(deriveAttackEffect(UNSCALED_TWIN)?.[0]);
    // …and a v30 reader that dropped the retrieval's WIDENED value has no number to fall
    // back on at all, which is why `"all"` is a value and not an absent key.
    expect((deriveAttackEffect(PRINTED)?.[1] as Record<string, unknown>).max).toBe("all");
  });

  it("🛑 the parked record REPLAYS — the rider is applied from `pendingOp` and nothing else", () => {
    const { state } = attack(stockPile(board(SEED, [B1, B2])));
    const revived = JSON.parse(JSON.stringify(state)) as GameState;
    expect(revived.phase.kind).toBe("effect:choose");
    const { state: done } = answer(revived, benchRef(0));
    expect(done.players.p2.bench[0]?.damage).toBe(60);
    expect(done.players.p1.discard).toHaveLength(5);
  });

  it("🛑 `MATCH_RECORD_VERSION` is 42 (🆕🆕🆕 D583 stepped it 41 → 42; D579 stepped it 40 → 41; D577 stepped it 39 → 40; D576 stepped it 38 → 39; D575 stepped it 37 → 38; D570 stepped it 36 → 37; D564 stepped it 35 → 36; D556 stepped it 34 → 35; D552 stepped it 33 → 34; D549 stepped it 32 → 33; D548 stepped it 31 → 32; D547 stepped it 30 → 31; this slice held it) — read off the raw source, not retyped", () => {
    // 🆕🆕🆕 D547 — the constant this slice held is now 31: D547 added two REQUIRED `InPlayPokemon` fields (apps/api match.ts).
    expect(raw("/match.ts")).toContain("MATCH_RECORD_VERSION = 42");
  });

  it("🛑 the engine version stepped to 0.500.0 in BOTH places", () => {
    expect(engineVersion).toBe("0.500.0");
    expect(manifest.version).toBe("0.500.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE DECIDED DISCREPANCY: the empty pile still shuffles.
// ─────────────────────────────────────────────────────────────────────────────

describe("D538 §8 — a whiffed retrieval STILL shuffles, and the decision is pinned", () => {
  it("🛑 zero matching cards: no damage, no retrieval — and a `SHUFFLE` row anyway", () => {
    // 🛑 **DECIDED, NOT GLOSSED (conventions.md "Deciding a discrepancy", D421).** With
    // an empty pile the fold is 0, `damageChosen` returns before asking, the retrieval
    // finds no candidate and files nothing — and the trailing `shuffleDeck` STILL takes
    // an RNG draw and files a `SHUFFLE` row for a shuffle the card did not print.
    //
    // **IT IS KEPT, and it is D523's SHIPPED POSTURE one arm over**: the `Shuffle up to 3
    // Basic {W} Energy cards …` program files the same row when the player DECLINES, and
    // `searchDeck`'s whiff has shuffled since the Nest Ball pattern. A conditional
    // shuffle would be a second reading of the word "Then," and a divergence between two
    // arms emitting the same printed clause. **A decision that is not pinned is
    // indistinguishable from an oversight**, so it is pinned here.
    const before = board(SEED);
    expect(before.players.p1.discard).toHaveLength(0);
    const { state, events } = attack(before);
    expect(activeDamage(state, "p2")).toBe(0);
    expect(rows(events, "DISCARD_RETRIEVED")).toHaveLength(0);
    expect(rows(events, "SHUFFLE")).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
    expect(state.rngState).not.toEqual(before.rngState);
  });

  it("🛑 a pile of DECOYS ONLY does the same thing, which separates the two zeros", () => {
    // The pile is not empty — five cards sit in it — and none of them matches. The
    // retrieval's `candidates.length === 0` branch is reached through the FILTER rather
    // than through the zone, and it ends the same way.
    let before = board(SEED);
    before = toPile(before, "p1", FIRE, 2);
    before = toPile(before, "p1", SPECIAL, 2);
    before = toPile(before, "p1", ITEM, 1);
    const { state, events } = attack(before);
    expect(state.players.p1.discard).toHaveLength(5);
    expect(rows(events, "DISCARD_RETRIEVED")).toHaveLength(0);
    expect(rows(events, "SHUFFLE")).toHaveLength(1);
    expect(state.rngState).not.toEqual(before.rngState);
  });

  it("🛑 the discrepancy is WRITTEN AT THE SITE, not only here", () => {
    // conventions.md's rule has two halves and this is the second: the decision lives
    // beside the op as well as in a test, so a successor reading the arm finds it.
    expect(raw("/effects.ts")).toContain(
      "DECIDED DISCREPANCY — A WHIFFED RETRIEVAL STILL SHUFFLES, AND THE",
    );
  });

  it("🛑 the whiff is not a SKIP — the sentence was read, and the log says so", () => {
    // The distinction that makes the discrepancy a discrepancy rather than a refusal:
    // nothing about this board reaches `ATTACK_EFFECT_SKIPPED`. The program RAN; it had
    // nothing to move.
    const { events } = attack(board(SEED));
    expect(rows(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
  });
});
