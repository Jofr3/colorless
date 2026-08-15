import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  specialEnergy,
  typedEnergy,
} from "./testFixtures";

// ── D338 — HEATMOR `sv10.5w-019`/`-104` "LICKING CATCH", D337's SENTENCE WITH
//    EXACTLY ONE NOUN CHANGED, ONE SURFACE OVER. ────────────────────────────────
//
// ── THE PRINTED SENTENCE ────────────────────────────────────────────────────
//   "Search your deck for **up to 3 in any combination of {R} Pokémon and Basic
//    {R} Energy cards**, reveal them, and put them into your hand. Then, shuffle
//    your deck."
//   ATTACK index 0, cost {R}, no printed damage. **2 Standard-legal printings on
//   one byte-identical sentence.**
//
// ── THE CENSUS, RE-RUN AT THIS HEAD OVER ALL THREE TEXT COLUMNS ─────────────
// Every figure re-queried against remote D1 `luminous` (3,786 rows, 2,021
// `legal_standard`) on 2026-08-14 rather than inherited from the work order, and
// every per-column split re-added against its own total.
//
//   (a) THE GRAMMAR — `instr(<col>,'in any combination of') > 0`:
//         `effect`         15 rows / 10 legal
//         `attacks_json`    4 rows /  3 legal
//         `abilities_json`  0 rows /  0 legal
//       TOTAL 19 printings / 13 legal.  15 + 4 + 0 = 19 ✅  10 + 3 + 0 = 13 ✅
//
//   (b) THE GRAMMAR *UNDER THIS OP* — `instr(<col>,'earch your deck for') > 0
//       AND instr(<col>,'in any combination of') > 0`:
//         `effect`          3 rows / 3 legal — Ethan's Adventure ×3 (BUILT, D337)
//         `attacks_json`    3 rows / 3 legal — Heatmor ×2 (THIS ROW), Maushold ×1
//         `abilities_json`  0 rows / 0 legal
//       TOTAL 6 printings / 6 legal.  3 + 3 + 0 = 6 ✅  3 + 3 + 0 = 6 ✅
//
//   (c) THE NOUN, narrowed to this card — `instr(<col>,'in any combination of
//       {R} Pok') > 0`:  `attacks_json` **2 / 2**, `effect` 0, `abilities_json` 0.
//       And `instr(attacks_json,'Licking Catch') > 0` is **2 / 2** — the same two
//       ids, reached by the attack NAME instead of by the sentence.
//
//   (d) THE STANDING-STILL OF THE OTHER THREE `BUILT` COLUMNS, MEASURED AND NOT
//       ASSUMED: both ids carry `abilities_json IS NULL` **AND** `effect IS NULL`
//       **AND** `category = 'Pokemon'`, against an `attacks_json` of 268 chars.
//       So no ability reader, no trainer reader and no Energy reader can see this
//       sentence at all — every figure off `IS NULL` / `length()` / `category` on
//       the remote D1 in the session that wrote them.
//
// ── 🛑 THE SUMMAND THIS ROW MOVES, AND WHAT IT IS KEYED ON ──────────────────
// `BUILT.attack` = **1,164 raw + 13 registry + 13 split = 1,190** at head.
//
// ⚠️ **THE WORK ORDER SAID "1,158 raw" AND THAT WAS TWELVE DECISIONS STALE** —
// 1,158 is D317's figure and D326 moved it to 1,164 (the last-turn-KO revenge
// clause's six printings, all raw). `1,158 + 13 + 13 = 1,184`, the PRE-D326 head;
// `1,164 + 13 + 13 = 1,190` ✅. **A COUNT THE BRIEF HANDS YOU IS STILL A COUNT
// YOU HAVE TO RE-RUN.**
//
// THIS ROW MOVES THE **REGISTRY** SUMMAND, **KEYED ON THE REGISTRY**: 13 → **15**,
// so `BUILT.attack` 1,190 → **1,192**.
//   * the RAW summand CANNOT move — `rawUnitsAtHead()` runs the `deriveAttack*`
//     readers LIVE over the committed legal corpus with `programFor` nowhere in
//     the addition, so an authored row buys it no printings at all (D307/D315);
//   * the SPLIT summand CANNOT move — this sentence carries no gate clause.
//
// ⚠️ **AND THE DERIVER STILL REFUSES THE SENTENCE, WHICH IS NOT A CONTRADICTION.**
// `derivedHandSearch.test.ts`'s `DEFERRED` names these very ids — *"a typed
// DISJUNCTION (sv10.5w-019/-104) — D230's Maushold case, typed"*, 2 legal
// printings — and that table asserts only `deriveAttackEffect(text) === null`,
// never `programFor(id) === undefined`. D314's distinction, checked by opening the
// assertion rather than by assuming it: *"refused by the deriver"* and *"unbuilt"*
// have never been the same claim, and its `10` total stands still.
//
// ── 🛑 WHY THIS FILE DRIVES A **LOCAL** POOL ────────────────────────────────
// The real ids live in `LOCAL_CARDS` below and NOT in `FIXTURE_POOL` (D275's
// idiom, `breezyGift.test.ts`'s shape). That is a census decision, not a tidiness
// one: nothing enters the shared pool, so no `fix-*` demonstrator is owed
// (`raw.length` steps by the 2 catalog ids alone), `catalogManifest` never
// classifies an `sv10.5w` id against its six-set manifest, and `revealClause`'s
// DISCOVERED sweep over `Object.keys(FIXTURE_POOL)` cannot reach these rows at all
// — `swept.size` stands still where `classified.size` moves.
// 🛑 **D343 — AND THAT INABILITY WAS THE BUG, NOT THE FEATURE.** The sweep now
// reads `registryCardIds()` ∪ the pool (`swept.size` **103**, `classified.size`
// **44**), so a registry row is swept the day it lands regardless of what its
// suite seats. The sentence above is kept as the clearest statement of the
// defect: a discovered census that cannot see the catalog does not fail, it
// agrees with you. **D337's lesson runs
// the other way here**: it learned that a shared pool is shared per SWEEP after
// three fixture bodies reddened four files; the cheapest way to owe none of that
// is to add nothing to the shared pool.
//
// ── THE CAST, AND WHY IT IS D337's WITH EVERY VERDICT INVERTED ──────────────
// D337 bought four Pokémon bodies to separate an OWNER-narrowed member from a
// TYPE-narrowed one. This card is the TYPE one, so the same four cases separate it
// with the answers swapped: an un-prefixed {R} Pokémon is REFUSED there and
// **ADMITTED** here; an `Ethan's` {L} Pokémon is ADMITTED there and **REFUSED**
// here. The bodies are mirrored LOCALLY rather than borrowed, so this file owes
// the shared pool nothing.

const HEATMOR = "sv10.5w-019";
const HEATMOR_REPRINT = "sv10.5w-104";
const PRINTED =
  "Search your deck for up to 3 in any combination of {R} Pokémon and Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.";
const HEATMOR_IDX1_NAME = "Fire Claws";

const FIRE_BASIC = "fix-d338lc-fire-basic";
const FIRE_STAGE2 = "fix-d338lc-fire-stage2";
const FIRE_PREFIXED = "fix-d338lc-fire-prefixed";
const LIGHTNING_BASIC = "fix-d338lc-lightning-basic";
const FIRE_ENERGY = "fix-d338lc-fire-energy";
const GRASS_ENERGY = "fix-d338lc-grass-energy";
const SPECIAL = "fix-d338lc-special";
const WALL = "fix-d338lc-wall";
const FILLER = "fix-d338lc-filler";

/** The LOCAL pool — the real ids live HERE, so nothing this file adds is visible
    to `catalogManifest`, to `revealClause`'s FIXTURE_POOL sweep, or to any of the
    owner-prefix enumerations D337 expired. */
const LOCAL_CARDS: Record<string, Card> = {
  [HEATMOR]: battler(HEATMOR, {
    name: "Heatmor",
    hp: 110,
    retreat: 2,
    types: ["Fire"],
    attacks: [
      { cost: ["Fire"], name: "Licking Catch", effect: PRINTED },
      { cost: ["Fire", "Fire"], name: HEATMOR_IDX1_NAME, damage: 60 },
    ],
  }),
  [HEATMOR_REPRINT]: battler(HEATMOR_REPRINT, {
    name: "Heatmor",
    hp: 110,
    retreat: 2,
    types: ["Fire"],
    attacks: [
      { cost: ["Fire"], name: "Licking Catch", effect: PRINTED },
      { cost: ["Fire", "Fire"], name: HEATMOR_IDX1_NAME, damage: 60 },
    ],
  }),
  /** A {R} Basic with NO owner prefix. **ADMITTED** — and this is the exact body
      D337's row REFUSES, which is the whole difference between the two filters. */
  [FIRE_BASIC]: battler(FIRE_BASIC, { name: "Litwick", types: ["Fire"], hp: 70 }),
  /** A {R} **STAGE 2**. **ADMITTED**, and it is the card that separates the printed
      *"{R} Pokémon"* from `stage: "basic"` — the rider a plausible build adds and
      the print does not carry (three other registry rows on this filter DO use it). */
  [FIRE_STAGE2]: battler(FIRE_STAGE2, {
    name: "Chandelure",
    stage: "Stage2",
    evolveFrom: "Lampent",
    types: ["Fire"],
    hp: 300,
  }),
  /** A {R} Basic that DOES carry an owner prefix. **ADMITTED**, because this
      filter reads the TYPE and nothing else — the mirror image of `fix-plain-
      cyndaquil`'s refusal in `ethansAdventure.test.ts`. Without it, "the type was
      read" and "the possessive was ignored" are the same board. */
  [FIRE_PREFIXED]: battler(FIRE_PREFIXED, {
    name: "Ethan's Cyndaquil",
    types: ["Fire"],
    hp: 70,
  }),
  /** A **{L}** Basic. **REFUSED**, and it is the sharpest card in this cast: it is
      the body D337's `ownerPokemon{Ethan}` ADMITS. A build that let an owner or a
      stage rider onto this member, or that dropped the type, would take it. */
  [LIGHTNING_BASIC]: battler(LIGHTNING_BASIC, {
    name: "Ethan's Pichu",
    types: ["Lightning"],
    hp: 60,
  }),
  [FIRE_ENERGY]: typedEnergy(FIRE_ENERGY, "Fire"),
  [GRASS_ENERGY]: typedEnergy(GRASS_ENERGY, "Grass"),
  [SPECIAL]: specialEnergy(SPECIAL, "D338 Special Energy"),
  [WALL]: battler(WALL, {
    name: "D338 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "D338 Filler",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

// ⚠️ **THE REPRINT IS IN THE DECK BECAUSE §6 DRIVES IT ON A REAL BOARD.** The
// first draft carried only `HEATMOR` and §6 threw `p1 deck has no sv10.5w-104`;
// the board was WIDENED to hold the second printing rather than the assertion
// relaxed to stop asking for it. 2 + 2 + 4 + 2 + 2 + 2 + 20 + 4 + 4 + 4 + 14 = 60.
const DECK = deckOf({
  [HEATMOR]: 2,
  [HEATMOR_REPRINT]: 2,
  [FIRE_BASIC]: 4,
  [FIRE_STAGE2]: 2,
  [FIRE_PREFIXED]: 2,
  [LIGHTNING_BASIC]: 2,
  [FIRE_ENERGY]: 20,
  [GRASS_ENERGY]: 4,
  [SPECIAL]: 4,
  [WALL]: 4,
  [FILLER]: 14,
});

const ATTACK = { type: "attack", seat: "p1", index: 0 } as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
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

/** TEST SURGERY — `count` Fire Energy onto p1's Active, taken off the deck so every
    uid stays in exactly one zone. "Licking Catch" costs a single {R}. */
function fuel(state: GameState, count: number): GameState {
  const side = state.players.p1;
  const body = side.active;
  if (body === null) throw new Error("p1 has no Active");
  const energy = side.deck.filter((u) => state.cardIdByUid[u] === FIRE_ENERGY).slice(0, count);
  if (energy.length < count) throw new Error(`deck lacks ${count} ${FIRE_ENERGY}`);
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        active: { ...body, energy: [...body.energy, ...energy] },
        deck: side.deck.filter((u) => !energy.includes(u)),
      },
    },
  };
}

/** A board with Heatmor Active for p1 on p1's turn, a 330 HP Wall opposite, and one
    filler body on each Bench. The DECK is the whole search zone, so nothing needs
    seeding into a window — what is in the deck is what is offered. */
function board(seed: number, opts: { attacker?: string; energy?: number } = {}): GameState {
  let state = localSetup(seed, "p2");
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", FILLER);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", opts.attacker ?? HEATMOR);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", FILLER);
  return fuel(state, opts.energy ?? 1);
}

/** The uids in p1's DECK carrying `id`. */
function deckUids(state: GameState, id: string): string[] {
  return state.players.p1.deck.filter((uid) => state.cardIdByUid[uid] === id);
}

/** Declare "Licking Catch" and return the parked `chooseCards` prompt with it. The
    attack has no cost op, so the FIRST park is the search. */
function attack(state: GameState) {
  const result = applyAction(state, ATTACK);
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  const parked = result.state;
  if (parked.phase.kind !== "effect:choose") {
    throw new Error(`expected effect:choose, got ${parked.phase.kind}`);
  }
  if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
  return { parked, prompt: parked.phase.prompt, events: [...result.events] };
}

describe("D338 — Heatmor 'Licking Catch', a flat cap over a TYPED union", () => {
  // ── §1 THE PRINTED SHAPE, READ OFF THE REGISTRY BEFORE ANY BOARD RUNS ──────

  it("the registry resolves a program for BOTH printings", () => {
    for (const id of [HEATMOR, HEATMOR_REPRINT]) expect(programFor(id), id).toBeDefined();
  });

  it("the two printings share ONE program object — a reprint, not two authorings", () => {
    expect(programFor(HEATMOR_REPRINT)).toBe(programFor(HEATMOR));
  });

  it("🛑 the program is `anyOf` under a FLAT cap — and carries NO `also`", () => {
    // 🛑 THE FIELD THE SIBLING SENTENCE WANTS AND THIS ONE MUST NOT HAVE. `also`
    // (D336) is one cap PER NOUN; this prints ONE flat cap over a UNION, and the
    // two mean opposite things about a legal answer — `also` here would refuse the
    // three-{R}-Pokémon take this card explicitly permits (§3 drives it).
    // `toEqual` is exact, so an `also` added here goes red on this line rather
    // than on a subtle answer four cases down.
    const op = programFor(HEATMOR)?.attack?.[0]?.[0];
    if (op?.op !== "searchDeck") throw new Error("expected a searchDeck op");
    expect(op).toEqual({
      op: "searchDeck",
      filter: {
        kind: "anyOf",
        filters: [
          { kind: "typedPokemon", pokemonType: "Fire" },
          { kind: "basicEnergy", energyType: "Fire" },
        ],
      },
      dest: "hand",
      max: 3,
      reveal: true,
    });
    expect(op.also).toBeUndefined();
  });

  it("the row is TWO ops and the second is the printed trailing shuffle", () => {
    expect(programFor(HEATMOR)?.attack?.[0]).toHaveLength(2);
    expect(programFor(HEATMOR)?.attack?.[0]?.[1]).toEqual({ op: "shuffleDeck" });
  });

  it("🛑 the `typedPokemon` member carries NO `stage` — the print names none", () => {
    // The rider a plausible build adds and the print does not carry. Asserted on
    // the FILTER as well as driven on a board (§2) because the two failures look
    // different: a `stage: "basic"` here silently refuses a {R} Stage 2, and a
    // board that happened to hold none would never notice.
    const op = programFor(HEATMOR)?.attack?.[0]?.[0];
    if (op?.op !== "searchDeck") throw new Error("expected a searchDeck op");
    if (op.filter.kind !== "anyOf") throw new Error("expected an anyOf filter");
    const [pokemon] = op.filter.filters;
    if (pokemon?.kind !== "typedPokemon") throw new Error("expected typedPokemon first");
    expect(pokemon.stage).toBeUndefined();
    expect(pokemon.pokemonType).toBe("Fire");
    expect(pokemon.maxHp).toBeUndefined();
  });

  it("🛑 INDEX-PRECISION — index 0 is authored and index 1 'Fire Claws' is NOT", () => {
    // D187's mistake, pinned in BOTH directions: marking a whole id built instead
    // of one index inflated an intermediate result by 1. "Fire Claws" is 60 damage
    // with NO `effect` key at all, so it contributes zero attack units to the
    // census and must stay unclaimed — Eldegoss's rule at D314.
    expect(programFor(HEATMOR)?.attack?.[0]).toBeDefined();
    expect(programFor(HEATMOR)?.attack?.[1]).toBeUndefined();
    const printed = LOCAL_CARDS[HEATMOR]?.attacks?.[1];
    expect(printed?.name).toBe(HEATMOR_IDX1_NAME);
    expect(printed?.effect).toBeUndefined();
  });

  it("the program authors NO non-attack surface — it is attack-only", () => {
    // 🛑 THE CLAIM THAT KEEPS THIS ROW OUT OF `nonAttackRegistryIds()`, and the
    // sharpest structural difference from D332-D337's six trainer slices: those
    // all moved that pool, and this one cannot. `censusAtHead.test.ts` filters on
    // `some(key !== "attack")`, so a stray `trainer` or `abilities` key here would
    // move a census line this slice asserts stands still.
    expect(Object.keys(programFor(HEATMOR) ?? {})).toEqual(["attack"]);
  });

  // ── §2 THE UNION — WHAT IT ADMITS AND WHAT IT REFUSES ─────────────────────

  it("🛑 offers BOTH members — a {R} Pokémon and a Basic {R} Energy", () => {
    const state = board(3);
    const { prompt, parked } = attack(state);
    expect(prompt.candidates).toContain(deckUids(parked, FIRE_BASIC)[0]);
    expect(prompt.candidates).toContain(deckUids(parked, FIRE_ENERGY)[0]);
  });

  it("🛑 admits a {R} STAGE 2 — the printed noun carries no stage", () => {
    const state = board(4);
    const { prompt, parked } = attack(state);
    expect(prompt.candidates).toContain(deckUids(parked, FIRE_STAGE2)[0]);
  });

  it("🛑 admits an OWNER-PREFIXED {R} Pokémon — the noun is TYPE-narrowed only", () => {
    // 🛑 THE MIRROR OF D337's SHARPEST CASE. There, `fix-plain-cyndaquil` is
    // refused because the member is narrowed by the possessive; here the member is
    // narrowed by the TYPE and by nothing else, so a printed possessive must be
    // invisible to it. A build that copied the neighbouring row's `ownerPokemon`
    // would refuse this body and stay green on every un-prefixed case in the file.
    const state = board(5);
    const { prompt, parked } = attack(state);
    expect(prompt.candidates).toContain(deckUids(parked, FIRE_PREFIXED)[0]);
  });

  it("🛑 REFUSES a {L} Pokémon — the printed {R} on the first member", () => {
    // 🛑 THE CARD D337's ROW ADMITS. `Ethan's Pichu` is `ownerPokemon{Ethan}`'s
    // positive witness one file over; here it must be refused, because the two
    // rows narrow the same member on different axes. This single body is what
    // makes "the type was read" a claim rather than a coincidence.
    const state = board(6);
    const { prompt, parked } = attack(state);
    expect(prompt.candidates).not.toContain(deckUids(parked, LIGHTNING_BASIC)[0]);
  });

  it("🛑 REFUSES a Basic Energy of another type — the printed {R} on the second member", () => {
    const state = board(7);
    const { prompt, parked } = attack(state);
    expect(prompt.candidates).not.toContain(deckUids(parked, GRASS_ENERGY)[0]);
  });

  it('🛑 REFUSES a SPECIAL Energy — the printed "Basic"', () => {
    const state = board(8);
    const { prompt, parked } = attack(state);
    expect(prompt.candidates).not.toContain(deckUids(parked, SPECIAL)[0]);
  });

  it("🛑 REFUSES a {C} Pokémon — the Wall and the filler are in the deck too", () => {
    // The population control: the deck holds plenty of Pokémon this filter must
    // not offer, so "it offered a Pokémon" and "it offered a {R} Pokémon" are
    // different boards.
    const state = board(9);
    const { prompt, parked } = attack(state);
    expect(prompt.candidates).not.toContain(deckUids(parked, FILLER)[0]);
    expect(prompt.candidates).not.toContain(deckUids(parked, WALL)[0]);
  });

  // ── §3 THE FLAT CAP — THE ANSWERS THAT SEPARATE IT FROM `also` ────────────

  it("the cap is 3 over the WHOLE union, and the pick is optional", () => {
    const state = board(10);
    const { prompt } = attack(state);
    expect(prompt.max).toBe(3);
    expect(prompt.min).toBe(0);
  });

  it("🛑 takes THREE {R} POKÉMON and nothing else — the answer `also` would refuse", () => {
    // 🛑 THE ANSWER THAT IS THE ROW. One cap PER NOUN would cap the Pokémon member
    // at some number below 3 and refuse this take outright; the printed "up to 3
    // in any combination of" permits it explicitly. This is the case that would
    // still be green if the union were respelled as `also` at the same total.
    const state = board(11);
    const { parked } = attack(state);
    const picks = deckUids(parked, FIRE_BASIC).slice(0, 3);
    expect(picks).toHaveLength(3);
    const { state: after } = mustResolve(parked, picks);
    for (const uid of picks) expect(after.players.p1.hand).toContain(uid);
  });

  it("🛑 takes THREE BASIC {R} ENERGY and nothing else — the union's other extreme", () => {
    const state = board(12);
    const { parked } = attack(state);
    const picks = deckUids(parked, FIRE_ENERGY).slice(0, 3);
    expect(picks).toHaveLength(3);
    const { state: after } = mustResolve(parked, picks);
    for (const uid of picks) expect(after.players.p1.hand).toContain(uid);
  });

  it("🛑 takes a MIXTURE — two Pokémon and one Energy, the printed 'combination'", () => {
    const state = board(13);
    const { parked } = attack(state);
    const picks = [
      ...deckUids(parked, FIRE_BASIC).slice(0, 2),
      ...deckUids(parked, FIRE_ENERGY).slice(0, 1),
    ];
    expect(picks).toHaveLength(3);
    const { state: after } = mustResolve(parked, picks);
    for (const uid of picks) expect(after.players.p1.hand).toContain(uid);
  });

  it("a FOURTH card is refused — the flat cap really is a cap", () => {
    const state = board(14);
    const { parked } = attack(state);
    const picks = deckUids(parked, FIRE_ENERGY).slice(0, 4);
    expect(picks).toHaveLength(4);
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: picks },
    });
    expect(result.ok).toBe(false);
  });

  it("taking NOTHING is legal and still shuffles — `min: 0`", () => {
    const state = board(15);
    const { parked } = attack(state);
    const { events } = mustResolve(parked, []);
    expect(find(events, "SHUFFLE")).toBeDefined();
  });

  // ── §4 THE CAPTION — `retrieveNoun`'s FOURTH WITNESS ON THIS JOIN ─────────

  it("🛑 the caption is the `anyOf` join, with the brace code WRITTEN OUT", () => {
    // ⚠️ THE NOUNS ARE `retrieveNoun`'s OWN, not a second vocabulary. `{R}` comes
    // out as "Fire" on BOTH members for `typedPokemon`'s stated reason (D238): the
    // rows the player then clicks are card NAMES, so a dialog quoting `{R}` back
    // would be the engine speaking a second vocabulary. D337's row renders the
    // same shape with the possessive in the first slot; this is the FOURTH witness
    // that the join is `" or "` where the card prints "and".
    const state = board(16);
    const { prompt } = attack(state);
    expect(prompt.note).toBe(
      "Search your deck for up to 3 Fire Pokémon or Basic Fire Energy cards into your hand.",
    );
  });

  it("the caption spells NO serial comma — this is the single-group arm", () => {
    // D336's multi-noun arm spells "A, B, and C". This sentence has ONE group, so
    // it must take the arm that predates it — a build that routed `anyOf` through
    // the group join would still read plausibly and would be wrong.
    const state = board(17);
    const { prompt } = attack(state);
    expect(prompt.note).not.toContain(", and ");
    expect(prompt.note).not.toContain(" and ");
    expect(prompt.note).toContain(" or ");
  });

  it("the caption does NOT quote the printed brace code", () => {
    const state = board(18);
    const { prompt } = attack(state);
    expect(prompt.note).not.toContain("{R}");
    expect(PRINTED).toContain("{R}");
  });

  // ── §5 THE EPILOGUE — REVEAL, DESTINATION AND THE PRINTED SHUFFLE ─────────

  it("🛑 the search REVEALS — the printed 'reveal them' rides on the op", () => {
    const state = board(19);
    const { parked } = attack(state);
    const picks = deckUids(parked, FIRE_BASIC).slice(0, 2);
    const { events } = mustResolve(parked, picks);
    const searched = find(events, "DECK_SEARCHED");
    expect(searched?.reveal).toBe(true);
    expect(searched?.dest).toBe("hand");
  });

  it("the taken cards LEAVE the deck — they move, they are not copied", () => {
    const state = board(20);
    const { parked } = attack(state);
    const picks = deckUids(parked, FIRE_STAGE2).slice(0, 1);
    const { state: after } = mustResolve(parked, picks);
    for (const uid of picks) {
      expect(after.players.p1.hand).toContain(uid);
      expect(after.players.p1.deck).not.toContain(uid);
    }
  });

  it('the deck is SHUFFLED after the search — the printed "Then, shuffle your deck"', () => {
    const state = board(21);
    const { parked } = attack(state);
    const { events } = mustResolve(parked, deckUids(parked, FIRE_ENERGY).slice(0, 1));
    expect(find(events, "SHUFFLE")).toBeDefined();
  });

  it("the attack deals NO damage — the print carries no damage on index 0", () => {
    // The Wall is 330 HP and untouched: this attack's whole printed effect is the
    // search, and a build that let the plain damage path run underneath it would
    // show up here and nowhere else in the file.
    const state = board(22);
    const { parked } = attack(state);
    const { state: after } = mustResolve(parked, deckUids(parked, FIRE_ENERGY).slice(0, 1));
    expect(after.players.p2.active?.damage ?? 0).toBe(0);
    expect(LOCAL_CARDS[HEATMOR]?.attacks?.[0]?.damage).toBeUndefined();
  });

  // ── §6 THE REPRINT AND THE ATTRIBUTION CONTROL ───────────────────────────

  it("the REPRINT runs the identical program on a real board", () => {
    // An arm transfers across sets and a registry row does not (D187), so the
    // second printing is driven rather than assumed to ride the first.
    const state = board(23, { attacker: HEATMOR_REPRINT });
    const { prompt, parked } = attack(state);
    expect(prompt.max).toBe(3);
    expect(prompt.candidates).toContain(deckUids(parked, FIRE_BASIC)[0]);
    expect(prompt.candidates).not.toContain(deckUids(parked, LIGHTNING_BASIC)[0]);
  });

  it("🛑 the ATTRIBUTION CONTROL — the deck really did hold what was refused", () => {
    // 🛑 WITHOUT THIS, EVERY REFUSAL ABOVE PASSES ON AN EMPTY POPULATION. Each
    // refused body must be present in the deck at the moment the prompt is built,
    // or "not offered" means "not there".
    const state = board(24);
    const { parked } = attack(state);
    for (const id of [LIGHTNING_BASIC, GRASS_ENERGY, SPECIAL, FILLER]) {
      expect(deckUids(parked, id).length, id).toBeGreaterThan(0);
    }
  });
});

/** Answer the parked search with `uids` and hand back the state and events. */
function mustResolve(state: GameState, uids: string[]) {
  const result = applyAction(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids },
  });
  if (!result.ok) throw new Error(`resolve failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: [...result.events] };
}
