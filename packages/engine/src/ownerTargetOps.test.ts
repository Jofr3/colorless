import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { matchesFilter } from "./cards";
import { applyAction, createGame, deriveAttackEffect, programFor, topCardOf } from "./index";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  handFromDeck,
  handToDeck,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
} from "./testFixtures";

// D205 — THE SAME-TARGET ATTACH COUNT (`attachEnergyFrom.count`) and THE
// COUNTER-MOVE SOURCE SUBGROUP (`moveCountersToDefender.ownerPokemon`): the two
// rows of D204's flag list whose missing piece was ONE parameter wide.
//
// ── WHAT THIS SLICE RE-DERIVED, AND WHAT MOVED ───────────────────────────────
// D204's own preamble is a correction of D200's flag table, and this slice was
// ordered to VERIFY it rather than inherit it — because D200's list named
// entirely different cards on six of ten rows and its "every id asserted
// unbuilt" guard passed anyway. Every id and every count D205 relies on was
// re-run against the remote D1 `luminous`
// (735f0fb5-cdc3-494d-8b97-74a8ade0124a; 3,786 rows / 20 sets, 2,021
// `legal_standard = 1`) on 2026-08-04, ⚠️ **with `GLOB` and never `LIKE`**.
//
// **D204's TABLE HOLDS, ID BY ID.** All 23 ids in `inPlayTarget.test.ts` (15
// flagged + 8 landed) were resolved by `SELECT id, name, legal_standard`: every
// one names the card D204 says it names and every one is legal. The five flagged
// rows also reproduce as COMPLETE legal sets when queried the other way round,
// by name: Ethan's Ho-Oh ex 4, N's Zoroark ex 4, Team Rocket's Giovanni 3, Team
// Rocket's Orbeetle 2, Team Rocket's Wobbuffet 2 — 15, and the printed sentences
// match the table's `sentence` strings verbatim. **Nothing of D204's moved.**
//
// ⚠️ ONE THING OF D204's DID BREAK, AND IT IS THE FLAG SHAPE RATHER THAN THE
// DATA. D204 replaced D200's whole-id `programFor(id) === undefined` with a
// per-SURFACE assertion, correctly — but wrote the attack surface as
// `programFor(id)?.attack`, which reads the REGISTRY ONLY. Attack programs
// resolve `programFor(id)?.attack?.[index] ?? deriveAttackEffect(text)`, so a
// sentence the DERIVER picks up is fully built with `programFor(id)` still
// undefined. Team Rocket's Wobbuffet below is built exactly that way, and D204's
// flag for it would have stayed GREEN on a finished card. Same class as the
// defect D204 caught in D200 — an assertion that runs, is green, and cannot fail
// for the reason it exists — repaired in that file (`attackIsBuilt`) rather than
// worked around here. Its ABILITY arm had the twin hole one field over
// (`abilities` only, where Marnie's Grimmsnarl ex is `triggered`), and that one
// was already false about a card D204 itself had landed.
//
// ── THE TWO ROWS TAKEN, PRICED BY LEGAL PRINTINGS PER EDIT ───────────────────
//   1. **Ethan's Ho-Oh ex** sv10-039/-209/-230/-239 — 4 legal, ONE NEW
//      PARAMETER (`attachEnergyFrom.count`). The slice's one new primitive.
//   2. **Team Rocket's Wobbuffet** sv10-082/svp-203 — 2 legal, ONE OPTIONAL
//      PARAMETER on an op that already exists, answered by the predicate D200
//      wrote and D204 first read from the board.
// Six legal printings, one new field each on two ops, no new vocabulary.
//
// The other three rows are FLAGGED, each needing a second piece, and the flags
// below are DRIVEN rather than declared — see §6.
//
// ── WHY `count` IS A PRIMITIVE AND NOT A REARRANGEMENT ───────────────────────
// D200's flag table said this row needed the in-play target rider "plus nothing
// else — `attachEnergyFrom` already has `benchOnly` for the printed zone word
// **and a count of 2**". ⚠️ THAT SENTENCE WAS FALSE IN ITS SECOND HALF, D204
// proved it, and D204 left it standing in `ownerPrefix.test.ts` beside the ids
// it corrected — it is removed with the row here.
//
// The engine's multi-attach was N separate `attachEnergyFrom` ops in one
// program, and the op's own doc said so: "MULTI-attach … is just N of these ops
// in one program: the interpreter parks on each attach's target in turn". That
// is the EXACT reading of Koraidon "Dino Cry"'s printed *"in any way you like"*,
// where each Energy is an independent decision. It is the WRONG reading of
// *"attach up to 2 Basic {R} Energy cards from your hand to **1 of** your
// Benched Ethan's Pokémon"*, which pins the batch: two ops there park twice and
// let a player put one Energy on each of two bodies. A program that plays a rule
// the card does not print is the wrong-but-plausible build the exact-map-or-flag
// doctrine forbids, which is why D204 flagged rather than forced it.
//
// So the two models coexist and the field is what tells them apart —
// `maxPerTarget` on `attachFromDeck` is the same distinction already drawn on
// the deck-search side. `count` parks ONCE and attaches `min(count, available)`
// to the ONE body chosen; absent means 1, which is what every pre-D205 program
// meant, so no existing row changes byte for byte.
//
// ── WHY THE COUNTER-MOVE RIDER IS NOT A NEW PRIMITIVE ────────────────────────
// D138 shipped `moveCountersToDefender` field-less and wrote down the condition
// that would earn it fields: *"a second ATTACK printing of a counter move, at
// which point the two readings are in hand and this op gains the field they
// actually differ on."* Team Rocket's Wobbuffet is that printing, and it differs
// on exactly one axis. The sweep that found it also found the two sentences the
// widened anchor must REFUSE, which is what makes the width a measurement:
//
//   `attacks_json` GLOB 'Move all damage counters*' over the whole D1 —
//   8 printings / 5 distinct clauses:
//     ✅ "…from 1 of your Benched **Team Rocket's** Pokémon to your opponent's
//        Active Pokémon."  Team Rocket's Wobbuffet sv10-082 / svp-203, 2 legal.
//        TAKEN — one possessive away from D138's own sentence.
//     ⏹️ "…from 1 of your Benched Pokémon **to 1 of your opponent's Pokémon**."
//        Cofagrigus sv10.5w-040/-123, 2 legal. REFUSED — that is D138's
//        DESTINATION axis and it is a second CHOICE (a second park, on the
//        opponent's board), not a predicate on the first. Flagged in §6.
//     ⏹️ "…from 1 of your Benched **Ancient** Pokémon to your opponent's Active
//        Pokémon."  Flutter Mane sv08-096, 1 legal. ⚠️ REFUSED AND UNBUILDABLE:
//        the Ancient/Future banner is printed on the card FACE and appears in NO
//        ingested column (D146's finding, re-checked). A subgroup the catalog
//        cannot answer is not a rider — and it is one adjective away from the
//        row that WAS taken, which is why the capture demands the POSSESSIVE.
//     ⏹️ Dedenne ex sv02-093/-239 (the printings that BOUGHT this anchor) and
//        Liepard sv04-115 are all `legal_standard = 0`. ⚠️ The op's own
//        printings are rotated OUT of Standard; Wobbuffet is the reason it has
//        any legal work at all, which no earlier slice had cause to notice.
//
// ── WHAT `MATCH_RECORD_VERSION` DOES, AND THE DERIVATION RATHER THAN THE HABIT ─
// It STAYS 12, and §7 asks the question rather than asserting the answer.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

// ── The printed sentences, as bytes ──────────────────────────────────────────

/** Ethan's Ho-Oh ex "Golden Flame", verbatim off `abilities_json`. */
const GOLDEN_FLAME =
  "Once during your turn, you may attach up to 2 Basic {R} Energy cards from your hand to 1 of your Benched Ethan's Pokémon.";
/** Team Rocket's Wobbuffet "Rocket Mirror", verbatim off `attacks_json`. */
const ROCKET_MIRROR =
  "Move all damage counters from 1 of your Benched Team Rocket's Pokémon to your opponent's Active Pokémon.";
/** Dedenne ex "Tail Swap" — the sentence that BOUGHT the anchor, which must keep
    deriving to the byte-identical field-less op. */
const TAIL_SWAP =
  "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.";
/** ⚠️ Flutter Mane sv08-096 "Perplexing Transfer" — one adjective from the row
    this slice took, and unbuildable because "Ancient" has no datum. */
const PERPLEXING_TRANSFER =
  "Move all damage counters from 1 of your Benched Ancient Pokémon to your opponent's Active Pokémon.";
/** ⚠️ Cofagrigus sv10.5w-040/-123 "Extended Damagriiigus" — D138's DESTINATION
    axis, printed on an attack and still refused. */
const EXTENDED_DAMAGRIIIGUS =
  "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon.";
/** N's Zoroark ex "Night Joker" — flagged, the attack-copy row. */
const NIGHT_JOKER = "Choose 1 of your Benched N's Pokémon's attacks and use it as this attack.";
/** Team Rocket's Giovanni — flagged, the parameterised switch + "If you do". */
const GIOVANNI =
  "Switch your Active Team Rocket's Pokémon with 1 of your Benched Team Rocket's Pokémon. If you do, switch in 1 of your opponent's Benched Pokémon to the Active Spot.";
/** Team Rocket's Orbeetle "Rocket Brain" — flagged, the own→own counter move. */
const ROCKET_BRAIN =
  "As often as you like during your turn, you may move 1 damage counter from 1 of your Team Rocket's Pokémon to another of your Pokémon.";

/** The two rows this slice LANDS, with their complete legal id sets as
    re-derived from the catalog by name (not inherited from D204's table). */
const LANDED = [
  {
    card: "Ethan's Ho-Oh ex",
    surface: "ability",
    sentence: GOLDEN_FLAME,
    ids: ["sv10-039", "sv10-209", "sv10-230", "sv10-239"],
    legal: 4,
  },
  {
    card: "Team Rocket's Wobbuffet",
    surface: "attack",
    sentence: ROCKET_MIRROR,
    ids: ["sv10-082", "svp-203"],
    legal: 2,
  },
] as const;

// ── The demonstrator pool. Synthetic `fix-*` bodies declared HERE against
//    `createGame({ cardPool })` — D190/D199/D200/D204's idiom and their reason:
//    the catalog manifest CANNOT be regenerated in this clone (`SQLITE_CANTOPEN`)
//    and measures a six-set catalog holding no sv09 or sv10 row at all, so a
//    fixture id naming a real printing has nothing to be diffed against.
//
//    ⚠️ `FIXTURE_POOL` WAS SWEPT AS ITS OWN POPULATION FIRST (§8): it holds NO
//    owner-prefixed name, so nothing there is reusable here and nothing there
//    changes behaviour under either new parameter. ─────────────────────────────

function subgroupBasic(id: string, name: string, types?: string[]): Card {
  return battler(id, { name, hp: 90, ...(types === undefined ? {} : { types }) });
}

const LOCAL_CARDS: Record<string, Card> = {
  /** Ethan's Ho-Oh ex — the `count` carrier. A Basic, so it can be surgeried
      Active without an evolution chain; the print's own Basic-ness is why
      "Golden Flame" is usable on turn 1 in a real game. */
  "fix-goldenflame": battler("fix-goldenflame", {
    name: "Ethan's Ho-Oh ex",
    hp: 220,
    types: ["Fire"],
    abilities: [{ type: "Ability", name: "Golden Flame", effect: GOLDEN_FLAME }],
    attacks: [
      {
        name: "Shining Feathers",
        cost: ["Fire", "Fire", "Fire", "Fire"],
        damage: 160,
        effect: "Heal 50 damage from each of your Pokémon.",
      },
    ],
  }),
  /** Team Rocket's Wobbuffet — the counter-move carrier. Its printed idx 0 is
      the move; idx 1 is a plain damaging attack, kept so the index this suite
      declares is a CHOICE the fixture can get wrong rather than the only one. */
  "fix-rocketmirror": battler("fix-rocketmirror", {
    name: "Team Rocket's Wobbuffet",
    hp: 120,
    types: ["Psychic"],
    attacks: [
      { name: "Rocket Mirror", cost: ["Psychic", "Colorless"], effect: ROCKET_MIRROR },
      { name: "Headbutt Bounce", cost: ["Psychic", "Colorless", "Colorless"], damage: 70 },
    ],
  }),
  /** The Dedenne ex sentence on a local body — so the REGRESSION half (the
      unmarked print still derives to the field-less op and still offers every
      benched body) is driven on the same boards as the new half. */
  "fix-tailswap": battler("fix-tailswap", {
    name: "Dedenne ex",
    hp: 200,
    types: ["Psychic"],
    attacks: [{ name: "Tail Swap", cost: ["Psychic", "Colorless"], effect: TAIL_SWAP }],
  }),
  // ── The subgroup bodies each rider must KEEP.
  "fix-ethan-cyndaquil": subgroupBasic("fix-ethan-cyndaquil", "Ethan's Cyndaquil", ["Fire"]),
  "fix-ethan-pichu": subgroupBasic("fix-ethan-pichu", "Ethan's Pichu", ["Lightning"]),
  "fix-tr-nidorino": subgroupBasic("fix-tr-nidorino", "Team Rocket's Nidorino", ["Psychic"]),
  "fix-tr-meowth": subgroupBasic("fix-tr-meowth", "Team Rocket's Meowth", ["Psychic"]),
  // ── The bodies each rider must DROP. Every one is a real near-miss.
  /** A DIFFERENT owner's Pokémon, {R}-typed like the Ethan's ones — so
      `targetType` alone would keep it and only the owner rider drops it. */
  "fix-iono-body": subgroupBasic("fix-iono-body", "Iono's Bellibolt", ["Fire"]),
  /** No prefix at all — the ordinary body every real board also holds. */
  "fix-plain": subgroupBasic("fix-plain", "Pikachu", ["Fire"]),
  /** ⚠️ THE ONE-LETTER-OWNER WITNESS, re-fielded on BOTH of this slice's read
      sites. D204's one surviving mutant was `name.startsWith(owner)` without the
      trailing possessive, killed only by a NEGATIVE fixture — and the hazard is
      not owner-specific: `startsWith("Ethan")` would take an "Ethanite", and
      `startsWith("Team Rocket")` would take "Team Rocketeer". Both are fielded
      below rather than argued, because the counter-move filter is a SECOND copy
      of the read and a second chance to write the mutant. */
  "fix-ethanite": subgroupBasic("fix-ethanite", "Ethanite", ["Fire"]),
  "fix-rocketeer": subgroupBasic("fix-rocketeer", "Team Rocketeer", ["Psychic"]),
  /** ⚠️ Exact-case: `ethan's Cyndaquil` is not an Ethan's Pokémon. */
  "fix-lowercase": subgroupBasic("fix-lowercase", "ethan's Cyndaquil", ["Fire"]),
  /** A 340 HP neutral body — the counter move's defender and bench filler, big
      enough that no pile this file moves causes a Knock Out under an assertion
      that is about candidates rather than about prizes. */
  "fix-bigtitan": battler("fix-bigtitan", { name: "Titan", hp: 340, types: ["Colorless"] }),
} as const;

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** One 60 carrying every carrier and every body a case distinguishes. Fat on the
    BODIES rather than the Energy for D204's stated reason: setup draws 7 and
    prizes 6 before a case touches the deck, and `benchFromDeck` pulls from what
    is LEFT. */
const DECK = deckOf({
  "fix-goldenflame": 3,
  "fix-rocketmirror": 3,
  "fix-tailswap": 2,
  // ⚠️ THE REAL Switch, `sv01-194`, and not a `fix-*` look-alike: the Giovanni
  // flag is about what the ENGINE's only `switchActive` program actually offers,
  // so a constructed Trainer would be flagging a fixture rather than the engine.
  "sv01-194": 3,
  "fix-ethan-cyndaquil": 4,
  "fix-ethan-pichu": 4,
  "fix-tr-nidorino": 4,
  "fix-tr-meowth": 4,
  "fix-iono-body": 2,
  "fix-plain": 4,
  "fix-ethanite": 2,
  "fix-rocketeer": 3,
  "fix-lowercase": 2,
  "fix-bigtitan": 4,
  "fix-fire-energy": 8,
  "fix-psychic-energy": 5,
  "fix-lightning-energy": 3,
});

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

/** P1 to move on turn 3, past §4's going-first restrictions. */
function board(seed: number): GameState {
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  return state;
}

/** P1's board with `bodyId` Active and an EMPTY Bench on BOTH seats — D133's
    trap, which this file is exposed to twice over: `setActiveFromDeck` DISPLACES
    the Active it replaces onto the Bench, and every claim here is about a
    CANDIDATE LIST. */
function withActive(seed: number, bodyId: string): GameState {
  let state = board(seed);
  // ⚠️ THE HAND IS EMPTIED OF EVERY ENERGY FIRST. Setup DRAWS seven, so a case
  // that adds "one {R}" to an opening hand that already held two is measuring a
  // fixture accident — and this file's sharpest claim ("up to 2 attaches ONE
  // when the hand holds one") is exactly the claim that accident would hide.
  for (const id of ["fix-fire-energy", "fix-psychic-energy", "fix-lightning-energy", bodyId]) {
    state = handToDeck(state, "p1", id);
  }
  const base = clearBench(setActiveFromDeck(state, "p1", bodyId), "p1");
  return clearBench(setActiveFromDeck(base, "p2", "fix-bigtitan"), "p2");
}

/** The printed NAME of every body a ref list points at. */
function refNames(state: GameState, refs: readonly PokemonRef[]): string[] {
  return refs.map((ref) => {
    const side = state.players[ref.seat];
    const body = ref.spot.spot === "active" ? side.active : (side.bench[ref.spot.index] ?? null);
    return body === null ? "?" : (topCardOf(state, body)?.name ?? "?");
  });
}

/** The parked `choosePokemon` prompt, narrowed — a state that did NOT park fails
    here with the reason rather than three lines later on an undefined. */
function choosePrompt(state: GameState): {
  candidates: PokemonRef[];
  note: string;
  upTo?: number;
} {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "choosePokemon") {
    throw new Error(`expected choosePokemon, got ${state.phase.prompt.kind}`);
  }
  const prompt = state.phase.prompt;
  return {
    candidates: prompt.candidates,
    note: prompt.note,
    ...(prompt.upTo === undefined ? {} : { upTo: prompt.upTo }),
  };
}

/** 🆕🆕 D359 — **A ONE-BODY BOARD NOW PARKS TOO.** *"attach up to 2 … to 1 of
    your Benched Ethan's Pokémon"* has THREE answers over one candidate, so the M1
    no-choice rule no longer forces it: three cases below used to resolve inline
    and now answer a park. Uses the Ability, then answers with `take` (absent =
    the whole printed batch); a board that whiffs never parks and comes back as
    it is. */
function useAndTake(state: GameState, take?: number): GameState {
  const used = mustApply(state, useGoldenFlame);
  if (used.state.phase.kind !== "effect:choose") return used.state;
  const prompt = used.state.phase.prompt;
  if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
  const ref = prompt.candidates[0];
  if (ref === undefined) throw new Error("expected a candidate");
  return mustApply(used.state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemon", ref, ...(take === undefined ? {} : { take }) },
  }).state;
}

const BENCH_0: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };
const BENCH_1: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 1 } };

function pick(ref: PokemonRef) {
  return { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } } as const;
}

const useGoldenFlame = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "active" },
  abilityName: "Golden Flame",
} as const;

// ── 1. `attachEnergyFrom.count` — the new primitive at its own seam ──────────

describe("`attachEnergyFrom.count` — ONE decision, N Energy, ONE body", () => {
  /** Ho-Oh Active, the named bench, and `fire` {R} in hand. */
  function ohoBoard(seed: number, bench: string[], fire: number): GameState {
    let state = withActive(seed, "fix-goldenflame");
    for (const id of bench) state = benchFromDeck(state, "p1", id);
    return fire === 0 ? state : handFromDeck(state, "p1", "fix-fire-energy", fire);
  }

  it("puts BOTH Energy on the ONE chosen body — the split the old model allowed", () => {
    const state = ohoBoard(31, ["fix-ethan-cyndaquil", "fix-ethan-pichu"], 3);
    const { state: parked } = mustApply(state, useGoldenFlame);
    const { state: done, events } = mustApply(parked, pick(BENCH_0));
    // ⚠️ THE WHOLE CLAIM. Two Energy on bench 0, ZERO on bench 1 — the other
    // Ethan's Pokémon, which was offered and not chosen. Two `attachEnergyFrom`
    // ops in sequence would have parked twice and could legally have put one on
    // each, which is the reading the print excludes with "1 of".
    expect(done.players.p1.bench[0]?.energy).toHaveLength(2);
    expect(done.players.p1.bench[1]?.energy).toHaveLength(0);
    // Two ROWS, one per card, each naming its own uid and the SAME target.
    const attached = all(events, "ENERGY_ATTACHED");
    expect(attached).toHaveLength(2);
    expect(new Set(attached.map((e) => e.uid)).size).toBe(2);
    expect(attached.map((e) => e.target)).toEqual([
      { spot: "bench", index: 0 },
      { spot: "bench", index: 0 },
    ]);
  });

  it("asks EXACTLY ONCE — the batch is one decision, not two", () => {
    const state = ohoBoard(32, ["fix-ethan-cyndaquil", "fix-ethan-pichu"], 3);
    const { state: parked } = mustApply(state, useGoldenFlame);
    const { state: done } = mustApply(parked, pick(BENCH_0));
    // A second park would leave the phase in effect:choose with one Energy placed.
    expect(done.phase.kind).toBe("turn:action");
  });

  it("takes both Energy OUT of the hand, and only the matching type", () => {
    let state = ohoBoard(33, ["fix-ethan-cyndaquil", "fix-ethan-pichu"], 2);
    state = handFromDeck(state, "p1", "fix-lightning-energy", 2);
    const handBefore = state.players.p1.hand.length;
    const { state: parked } = mustApply(state, useGoldenFlame);
    const { state: done } = mustApply(parked, pick(BENCH_0));
    expect(done.players.p1.hand).toHaveLength(handBefore - 2);
    // `energyType: "Fire"` — the two {L} in hand are untouched, so a build that
    // filled the count from "any Basic Energy" reads four in hand, not two.
    expect(done.players.p1.hand.filter((uid) => done.cardIdByUid[uid] === "fix-lightning-energy"))
      .toHaveLength(2);
  });

  it("⚠️ 'UP TO' — one matching Energy in hand attaches ONE, silently", () => {
    const state = ohoBoard(34, ["fix-ethan-cyndaquil"], 1);
    // 🆕 D359 — ONE Benched Ethan's Pokémon no longer FORCES: the printed ceiling
    // makes {0, 1, 2} three answers over one body. And the ceiling stays 2 with a
    // single {R} in hand — a prompt clamped to what the hand holds would leak it.
    const parked = mustApply(state, useGoldenFlame).state;
    expect(choosePrompt(parked).upTo).toBe(2);
    const done = useAndTake(state);
    const events = mustApply(parked, pick(BENCH_0)).events;
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    // A shortfall is the PRINT ("up to"), not an error and not a refusal: the
    // Ability was usable and it did what it could.
    expect(done.players.p1.hand.filter((uid) => done.cardIdByUid[uid] === "fix-fire-energy"))
      .toHaveLength(0);
  });

  it("⚠️ the caption names the COUNT — the one fact the offered rows cannot show", () => {
    const state = ohoBoard(35, ["fix-ethan-cyndaquil", "fix-ethan-pichu"], 3);
    const { state: parked } = mustApply(state, useGoldenFlame);
    const { note } = choosePrompt(parked);
    // "Attach the Energy to which of your …?" is a SINGULAR the print
    // contradicts, and the batch size is invisible from the rows because the
    // whole batch lands on whichever one is picked.
    expect(note).toContain("up to 2 Energy");
    expect(note).toContain("Benched Ethan's Pokémon");
  });

  it("⚠️ REGRESSION — an op with NO count still attaches exactly one", () => {
    // The absence of the field must mean what it meant before D205 on every
    // pre-existing program, which is the whole reason it is optional. Driven on
    // a REAL registry row rather than a constructed op: Iono's Bellibolt ex's
    // "Electric Streamer" is `attachEnergyFrom` with no count.
    const streamer = programFor("sv09-053")?.abilities?.[0]?.program?.[0];
    expect(streamer).toEqual({
      op: "attachEnergyFrom",
      source: "hand",
      energyType: "Lightning",
      ownerPokemon: "Iono",
    });
    expect(streamer).not.toHaveProperty("count");
  });
});

// ── 2. Ethan's Ho-Oh ex, end to end (4 legal printings) ──────────────────────

describe("Ethan's Ho-Oh ex 'Golden Flame' — the 4 legal printings", () => {
  function ohoBoard(seed: number, bench: string[]): GameState {
    let state = withActive(seed, "fix-goldenflame");
    for (const id of bench) state = benchFromDeck(state, "p1", id);
    return handFromDeck(state, "p1", "fix-fire-energy", 3);
  }

  it("offers ONLY the Benched Ethan's Pokémon — not the Active, not another owner", () => {
    const state = ohoBoard(41, [
      "fix-ethan-cyndaquil",
      "fix-iono-body",
      "fix-plain",
      "fix-ethan-pichu",
    ]);
    const { state: parked } = mustApply(state, useGoldenFlame);
    const { candidates } = choosePrompt(parked);
    // Ho-Oh is ITSELF an Ethan's Pokémon and is dropped by the printed word
    // "Benched"; Iono's Bellibolt is {R}-typed and dropped by the owner; Pikachu
    // is {R}-typed and dropped by the owner. Both riders are load-bearing and a
    // build missing either one reads a longer list.
    expect(refNames(parked, candidates).sort()).toEqual(["Ethan's Cyndaquil", "Ethan's Pichu"]);
  });

  it("⚠️ drops `Ethanite` — the possessive is matched WHOLE, not as a name prefix", () => {
    const state = ohoBoard(42, [
      "fix-ethan-cyndaquil",
      "fix-ethanite",
      "fix-lowercase",
      "fix-ethan-pichu",
    ]);
    const { state: parked } = mustApply(state, useGoldenFlame);
    // `startsWith("Ethan")` — the predicate without its trailing `'s ` — takes
    // Ethanite; a case-insensitive compare takes `ethan's Cyndaquil`. Both are on
    // this board on purpose, and both must be absent. A SECOND real Ethan's body
    // is benched so the op PARKS: with one candidate it auto-applies and the
    // candidate list this case is about would never be built.
    expect(refNames(parked, choosePrompt(parked).candidates).sort()).toEqual([
      "Ethan's Cyndaquil",
      "Ethan's Pichu",
    ]);
  });

  it("⚠️ WIRE SAFETY — a crafted frame naming an excluded body is REFUSED", () => {
    const state = ohoBoard(43, ["fix-ethan-cyndaquil", "fix-plain", "fix-ethan-pichu"]);
    const { state: parked } = mustApply(state, useGoldenFlame);
    // Bench index 1 is Pikachu — on the board, {R}-typed, and not a candidate.
    const rejected = applyAction(parked, pick(BENCH_1));
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("expected the illegal target to be rejected");
    expect(rejected.error.code).toBe("BAD_EFFECT_CHOICE");
  });

  it("is ONCE per turn — the second use is refused, and the board is unchanged", () => {
    const state = ohoBoard(44, ["fix-ethan-cyndaquil"]);
    const once = useAndTake(state);
    expect(once.players.p1.bench[0]?.energy).toHaveLength(2);
    const again = applyAction(once, useGoldenFlame);
    expect(again.ok).toBe(false);
    // …and it never touched the §6.3 manual attach allowance, which is a
    // different allowance entirely.
    expect(once.players.p1.active?.energy ?? []).toHaveLength(0);
  });

  it("⚠️ is STILL usable with only ONE matching Energy — the gate is not the count", () => {
    let state = withActive(45, "fix-goldenflame");
    state = benchFromDeck(state, "p1", "fix-ethan-cyndaquil");
    state = handFromDeck(state, "p1", "fix-fire-energy", 1);
    // `programPlayable` refuses an attach that could only whiff. "Up to 2" with
    // one {R} in hand is NOT a whiff — it attaches one, exactly as printed — so a
    // gate written against `count` would refuse the card on a board it works on.
    const done = useAndTake(state);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(1);
  });

  it("is NOT usable with no matching Energy, nor with no Benched Ethan's Pokémon", () => {
    const noEnergy = (() => {
      let state = withActive(46, "fix-goldenflame");
      state = benchFromDeck(state, "p1", "fix-ethan-cyndaquil");
      return handFromDeck(state, "p1", "fix-lightning-energy", 2);
    })();
    // The hand holds Energy, just not {R}: the gate reads the TYPE, not the count.
    expect(applyAction(noEnergy, useGoldenFlame).ok).toBe(false);

    const noTarget = (() => {
      let state = withActive(47, "fix-goldenflame");
      state = benchFromDeck(state, "p1", "fix-plain");
      return handFromDeck(state, "p1", "fix-fire-energy", 2);
    })();
    // Ho-Oh itself is an Ethan's Pokémon but `benchOnly` excludes the Active, so
    // this board has NO eligible target and the Ability cannot be activated.
    expect(applyAction(noTarget, useGoldenFlame).ok).toBe(false);
  });

  it("all 4 legal printings carry ONE shared program object, with the count on it", () => {
    const first = programFor("sv10-039");
    expect(first?.abilities?.[0]?.name).toBe("Golden Flame");
    expect(first?.abilities?.[0]?.oncePerTurn).toBe(true);
    expect(first?.abilities?.[0]?.program).toEqual([
      {
        op: "attachEnergyFrom",
        source: "hand",
        energyType: "Fire",
        count: 2,
        ownerPokemon: "Ethan",
        benchOnly: true,
      },
    ]);
    for (const id of ["sv10-039", "sv10-209", "sv10-230", "sv10-239"]) {
      expect(programFor(id), `${id} left the shared program`).toBe(first);
    }
    // The fixture carries the same object, so the driven cases above are the
    // catalog rows and not a look-alike.
    expect(programFor("fix-goldenflame")).toBe(first);
  });
});

// ── 3. The widened counter-move anchor, and the sentences it refuses ─────────

describe("`COUNTER_MOVE_TO_DEFENDER` — one optional capture, three refusals", () => {
  it("reads Wobbuffet's possessive into `ownerPokemon`", () => {
    expect(deriveAttackEffect(ROCKET_MIRROR)).toEqual([
      { op: "moveCountersToDefender", ownerPokemon: "Team Rocket" },
    ]);
  });

  it("⚠️ leaves Dedenne ex's sentence BYTE-IDENTICAL — the key is omitted, not undefined", () => {
    const derived = deriveAttackEffect(TAIL_SWAP);
    expect(derived).toEqual([{ op: "moveCountersToDefender" }]);
    // `{ ownerPokemon: undefined }` would pass `toEqual` against the object above
    // in some comparisons and fail the registry value-compare in others, which is
    // the trap `CHOSEN_HEAL`'s `zone` arm already documents. Asserted directly.
    expect(derived?.[0]).not.toHaveProperty("ownerPokemon");
  });

  it("⚠️ REFUSES 'Ancient' — the subgroup with no datum, one adjective away", () => {
    // The capture demands `'s `, so a MARK-subgroup sentence falls through the
    // whole anchor rather than deriving to an op with a permanently empty
    // candidate set — which would be a card whose attack silently does nothing.
    expect(deriveAttackEffect(PERPLEXING_TRANSFER)).toBeNull();
  });

  it("⚠️ REFUSES the CHOSEN destination — D138's other axis, now a DIFFERENT op", () => {
    // Still refused BY THIS ANCHOR, which is the claim: D216 built the sentence
    // behind `COUNTER_MOVE_TO_CHOSEN`, so the two tails stay disjoint and no
    // widening of this regex ever happened. Asserting `toBeNull` here would now
    // be asserting that the sentence is unbuilt, which is a different and false
    // thing — so the case asserts the OP instead.
    expect(deriveAttackEffect(EXTENDED_DAMAGRIIIGUS)).not.toContainEqual(
      expect.objectContaining({ op: "moveCountersToDefender" }),
    );
    expect(deriveAttackEffect(EXTENDED_DAMAGRIIIGUS)).toEqual([{ op: "moveCountersChosen" }]);
  });

  it("refuses a lowercase owner, and a possessive that is not a subgroup", () => {
    // No `/i`: the capture is `[A-Z]`-anchored, matching the exact-case rule the
    // predicate itself enforces. A lowercase prefix is not an owner.
    expect(
      deriveAttackEffect(ROCKET_MIRROR.replace("Team Rocket's", "team rocket's")),
    ).toBeNull();
    // `'d`, not `'s ` — the Farfetch'd class, on the anchor rather than on the
    // predicate.
    expect(
      deriveAttackEffect(ROCKET_MIRROR.replace("Team Rocket's", "Farfetch'd")),
    ).toBeNull();
  });

  it("keeps the apostrophe FOLD on both slots (D136/D137)", () => {
    const curly = ROCKET_MIRROR.replaceAll("'", "’");
    // Both possessives — the owner's and "your opponent's" — carry `['’]`, and
    // the fold must produce the SAME value rather than merely a non-null one.
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(ROCKET_MIRROR));
  });
});

// ── 4. Team Rocket's Wobbuffet, end to end (2 legal printings) ───────────────

describe("Team Rocket's Wobbuffet 'Rocket Mirror' — the 2 legal printings", () => {
  const ROCKET_MIRROR_INDEX = 0;
  /** A pile size that is not an HP, not a printed damage and not a round
      multiple of anything the epilogue computes. */
  const HURT = 80;
  const OTHER_HURT = 30;

  /** Wobbuffet Active with {P}{C} paid, the named bench, each body damaged. */
  function mirrorBoard(seed: number, bench: readonly [string, number][]): GameState {
    let state = withActive(seed, "fix-rocketmirror");
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 2);
    for (const [id, damage] of bench) {
      state = benchFromDeck(state, "p1", id);
      state = setBenchDamage(state, "p1", state.players.p1.bench.length - 1, damage);
    }
    return state;
  }

  it("offers ONLY the Benched Team Rocket's Pokémon", () => {
    const state = mirrorBoard(51, [
      ["fix-tr-nidorino", HURT],
      ["fix-plain", OTHER_HURT],
      ["fix-tr-meowth", OTHER_HURT],
      ["fix-rocketeer", HURT],
    ]);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ROCKET_MIRROR_INDEX,
    });
    // `Team Rocketeer` is the board-side mutant witness: `startsWith("Team
    // Rocket")` takes it, the printed predicate does not.
    expect(refNames(parked, choosePrompt(parked).candidates).sort()).toEqual([
      "Team Rocket's Meowth",
      "Team Rocket's Nidorino",
    ]);
  });

  it("names the SUBGROUP in the caption, not 'your Benched Pokémon'", () => {
    const state = mirrorBoard(52, [
      ["fix-tr-nidorino", HURT],
      ["fix-tr-meowth", OTHER_HURT],
      ["fix-plain", HURT],
    ]);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ROCKET_MIRROR_INDEX,
    });
    expect(choosePrompt(parked).note).toContain("Benched Team Rocket's Pokémon");
  });

  it("moves the pick's counters — one number, two rows, across the seat boundary", () => {
    const state = mirrorBoard(53, [
      ["fix-tr-nidorino", HURT],
      ["fix-tr-meowth", OTHER_HURT],
    ]);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ROCKET_MIRROR_INDEX,
    });
    const { state: done, events } = mustApply(parked, pick(BENCH_0));
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    // The OTHER Team Rocket's body kept its own pile — a build that moved
    // "whatever was on the Bench" reads 110 on the defender.
    expect(done.players.p1.bench[1]?.damage).toBe(OTHER_HURT);
    expect(done.players.p2.active?.damage).toBe(HURT);
    expect(find(events, "HEALED")?.amount).toBe(HURT);
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(HURT);
  });

  it("⚠️ WIRE SAFETY — a crafted frame naming a non-subgroup body is REFUSED", () => {
    const state = mirrorBoard(54, [
      ["fix-tr-nidorino", HURT],
      ["fix-plain", HURT],
      ["fix-tr-meowth", OTHER_HURT],
    ]);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ROCKET_MIRROR_INDEX,
    });
    // Bench index 1 is Pikachu — on the board, damaged, and not a candidate.
    // `validateChoice` reads the PROMPT the rider narrowed, never the op, so this
    // is refused by construction rather than by a second copy of the rule.
    const rejected = applyAction(parked, pick(BENCH_1));
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("expected the illegal source to be rejected");
    expect(rejected.error.code).toBe("BAD_EFFECT_CHOICE");
  });

  it("is FORCED inline when the subgroup holds exactly one benched body", () => {
    const state = mirrorBoard(55, [
      ["fix-plain", HURT],
      ["fix-tr-nidorino", HURT],
      ["fix-rocketeer", HURT],
    ]);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ROCKET_MIRROR_INDEX,
    });
    // Three damaged benched bodies, ONE of them in the subgroup → no prompt.
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(HURT);
    expect(done.players.p1.bench[1]?.damage).toBe(0);
  });

  it("⚠️ a Bench with NO subgroup body resolves SILENTLY — no prompt, no move", () => {
    const state = mirrorBoard(56, [
      ["fix-plain", HURT],
      ["fix-rocketeer", HURT],
    ]);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ROCKET_MIRROR_INDEX,
    });
    // `parkOrForce`'s existing empty-candidate ending, which an empty Bench
    // already took: the attack resolves and the sentence does as much as it can,
    // i.e. nothing. Nothing is healed and nothing is placed.
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "HEALED")).toEqual([]);
    expect(all(events, "COUNTERS_PLACED")).toEqual([]);
    expect(done.players.p1.bench[0]?.damage).toBe(HURT);
  });

  it("⚠️ REGRESSION — the unmarked print still offers EVERY benched body", () => {
    let state = withActive(57, "fix-tailswap");
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 2);
    for (const id of ["fix-tr-nidorino", "fix-plain", "fix-rocketeer"]) {
      state = benchFromDeck(state, "p1", id);
      state = setBenchDamage(state, "p1", state.players.p1.bench.length - 1, HURT);
    }
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // Dedenne ex's sentence narrows nothing, so all three are candidates and the
    // caption says "your Benched Pokémon" with no possessive in it.
    expect(choosePrompt(parked).candidates).toHaveLength(3);
    expect(choosePrompt(parked).note).toBe(
      "Move the damage counters off which of your Benched Pokémon?",
    );
  });

  it("needs NO registry row — both legal printings resolve through the deriver", () => {
    // The row is built entirely in `effects.ts`. This is the assertion D204's own
    // flag shape could not make, and the reason its attack arm was vacuous.
    for (const id of ["sv10-082", "svp-203"]) {
      expect(programFor(id)?.attack, `${id} grew a registry attack`).toBeUndefined();
    }
    expect(deriveAttackEffect(ROCKET_MIRROR)).not.toBeNull();
  });
});

// ── 5. The landed census, measured ───────────────────────────────────────────

describe("what this slice landed, in LEGAL printings", () => {
  it("lands SIX legal printings across two ops", () => {
    expect(LANDED.reduce((n, row) => n + row.legal, 0)).toBe(6);
    for (const row of LANDED) {
      expect(row.ids, `${row.card}: id list disagrees with its measured legal count`).toHaveLength(
        row.legal,
      );
      for (const id of row.ids) {
        const built =
          row.surface === "attack"
            ? deriveAttackEffect(row.sentence) !== null
            : programFor(id)?.abilities !== undefined;
        expect(built, `${id} (${row.card}) is listed as landed and is not built`).toBe(true);
      }
    }
  });
});

// ── 6. The FLAGS — driven, not declared ──────────────────────────────────────
//
// ⚠️ THE POINT OF THIS SECTION IS THAT A FLAG MUST BE ABLE TO FAIL FOR THE
// REASON IT EXISTS. D200's flag list asserted "these ids are unbuilt" over a
// catalog that is overwhelmingly unbuilt, on ids that named the wrong cards, and
// it passed. So each flag below asserts the MISSING MECHANISM by driving it —
// the op the row would need is run, and the wrong behaviour it produces today is
// the assertion. A slice that builds the piece cannot leave these green.

// ✅ D206 BUILT D205's GIOVANNI ROW, and this describe is what a flag looks like
// when the slice after it pays the bill. D205's two assertions were DRIVEN, so
// exactly one of them went red on the build (the "no program exists" half) and
// the other one — what the UNMARKED `switchActive` program offers — is still true
// and is now the REGRESSION witness for `ownerPokemon` being absent-means-every-
// body. Both are kept, re-pointed rather than deleted: a flag that is erased on
// the day it is paid leaves nothing pinning the row it used to describe.
describe("✅ LANDED BY D206 — Team Rocket's Giovanni sv10-174/-225/-238 (3 legal)", () => {
  const IDS = ["sv10-174", "sv10-225", "sv10-238"] as const;

  it("the UNMARKED `switchActive` still offers EVERY benched body — the regression half", () => {
    let state = withActive(61, "fix-plain");
    for (const id of ["fix-tr-nidorino", "fix-plain", "fix-rocketeer"]) {
      state = benchFromDeck(state, "p1", id);
    }
    state = handToDeck(state, "p1", "sv01-194");
    state = handFromDeck(state, "p1", "sv01-194", 1);
    const uid = state.players.p1.hand.find((u) => state.cardIdByUid[u] === "sv01-194");
    if (uid === undefined) throw new Error("no fix-switch in hand");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    // D205 WROTE THIS AS THE FLAG — "the op offers all three, including Pikachu
    // and Team Rocketeer, so the only authorable program plays a different rule".
    // D206 gave the op the rider, and this same board is now the proof that the
    // rider's ABSENCE means what it always meant: `sv01-194` carries no
    // `ownerPokemon`, so all three are still offered and the note is still
    // subgroup-free. Byte-for-byte unchanged behaviour on the unmarked print is
    // the widening's own precondition; the NARROWED board is driven in
    // `switchSeam.test.ts`.
    expect(refNames(parked, choosePrompt(parked).candidates).sort()).toEqual([
      "Pikachu",
      "Team Rocket's Nidorino",
      "Team Rocketeer",
    ]);
    expect(choosePrompt(parked).note).not.toContain("Team Rocket's");
  });

  it("✅ the 'If you do' seam D205 priced is §9.2's `recordGate`, and it SHIPPED", () => {
    // D205: "`recordGate` gates on an `EffectSlot` filled by an earlier op, and
    // `switchActive` files nothing — it has no `recordAs`. So even with both ends
    // narrowed the consequent could not read whether the antecedent happened."
    // Right on both counts, and both are now paid. The unmarked Switch row is
    // asserted UNCHANGED — no `recordAs`, no `ownerPokemon`, the same one-op
    // program `toEqual` compared by value — because a widening that quietly wrote
    // defaults onto the existing row is the failure this pair of assertions
    // exists to catch.
    const switchOp = programFor("sv01-194")?.trainer?.[0];
    expect(switchOp).toEqual({ op: "switchActive" });
    expect(switchOp).not.toHaveProperty("recordAs");
    expect(switchOp).not.toHaveProperty("ownerPokemon");
    for (const id of IDS) {
      expect(programFor(id)?.trainer, `${id} lost its D206 program`).toEqual([
        { op: "switchActive", ownerPokemon: "Team Rocket", recordAs: "moved" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        { op: "recordGate", slot: "moved", then: [{ op: "gust" }] },
      ]);
    }
  });

  it("names the printed sentence, so the row cannot drift onto another card", () => {
    expect(GIOVANNI).toContain("Team Rocket's Pokémon");
    expect(GIOVANNI).toContain("If you do");
  });
});

describe("FLAGGED — Team Rocket's Orbeetle sv10-089/-198 (2 legal)", () => {
  const IDS = ["sv10-089", "sv10-198"] as const;

  it("⚠️ every counter-move route ends on the OPPONENT's Active — driven", () => {
    // "…move 1 damage counter from 1 of your Team Rocket's Pokémon **to another
    // of your Pokémon**." The one counter-move op in the union always lands on
    // the defender, which this drives rather than reads off the type: the
    // controller's own board LOSES the counters and gains nothing.
    let state = withActive(62, "fix-rocketmirror");
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 2);
    state = benchFromDeck(state, "p1", "fix-tr-nidorino");
    state = setBenchDamage(state, "p1", 0, 80);
    state = benchFromDeck(state, "p1", "fix-tr-meowth");
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // Forced (one damaged? no — both are candidates; the pick is parked), so
    // resolve it explicitly.
    const settled = done.phase.kind === "effect:choose" ? mustApply(done, pick(BENCH_0)).state : done;
    expect(settled.players.p1.bench[0]?.damage).toBe(0);
    // ⚠️ THE FLAG: the counters went to the OPPONENT. Orbeetle needs them on the
    // controller's other body, and no op in the union can put them there.
    expect(settled.players.p1.bench[1]?.damage).toBe(0);
    expect(settled.players.p2.active?.damage).toBe(80);
  });

  it("⚠️ and the amount is the printed word 'all', where Orbeetle prints 1", () => {
    // A second missing piece on the same op: this row wants a BOUNDED amount and
    // a repeatable "as often as you like", where the anchor's only amount is the
    // whole pile. Two axes, so the row is flagged rather than forced.
    expect(deriveAttackEffect(TAIL_SWAP)).toEqual([{ op: "moveCountersToDefender" }]);
    expect(ROCKET_BRAIN).toContain("move 1 damage counter");
    expect(ROCKET_BRAIN).toContain("to another of your Pokémon");
    for (const id of IDS) {
      const program = programFor(id);
      expect(program?.abilities, `${id} was half-built`).toBeUndefined();
      expect(program?.triggered, `${id} was half-built as a trigger`).toBeUndefined();
    }
  });
});

describe("FLAGGED — N's Zoroark ex sv09-098/-175/-185/-189 (4 legal)", () => {
  const IDS = ["sv09-098", "sv09-175", "sv09-185", "sv09-189"] as const;

  it("⚠️ the ATTACK is unbuilt on BOTH routes, and the ABILITY is built", () => {
    for (const id of IDS) {
      // Per SURFACE and through BOTH routes — the registry AND the deriver. D204
      // established the first half; the second is this slice's repair, and it is
      // what stops a widened anchor from silently satisfying this flag.
      expect(programFor(id)?.attack, `${id} grew a registry attack`).toBeUndefined();
      expect(programFor(id)?.abilities?.[0]?.name, `${id} lost its Trade Ability`).toBe("Trade");
    }
    expect(deriveAttackEffect(NIGHT_JOKER)).toBeNull();
  });

  it("⚠️ names the piece: an attack-COPY, of which the target predicate is the least", () => {
    // Two coupled decisions (a benched body, then one of ITS attacks) and a
    // re-entrant attack resolution. The predicate this slice's other rows needed
    // is the smallest part, which is why 4 printings is not the price signal.
    expect(NIGHT_JOKER).toContain("Benched N's Pokémon's attacks");
    expect(NIGHT_JOKER).toContain("use it as this attack");
  });
});

describe("FLAGGED — the two counter-move sentences the widened anchor refuses", () => {
  it("⚠️ Cofagrigus sv10.5w-040/-123 (2 legal) — BUILT AT D216, and still not by THIS anchor", () => {
    // ⚠️ THE FLAG WAS PAID, AND THE REFUSAL IT ASSERTED IS UNCHANGED. D205 called
    // this "a second CHOICE (a second park, on the opponent's board), not a
    // predicate on the first" and refused it HERE for that reason. D216 built it
    // — as `moveCountersChosen`, behind its own anchor — so the claim this case
    // makes is now the sharper one: `COUNTER_MOVE_TO_DEFENDER` still does not
    // reach the sentence, and the op it produces is still the fixed-destination
    // one. A build that widened this anchor instead would fail both lines.
    expect(deriveAttackEffect(EXTENDED_DAMAGRIIIGUS)).toEqual([{ op: "moveCountersChosen" }]);
    expect(deriveAttackEffect(EXTENDED_DAMAGRIIIGUS)).not.toContainEqual(
      expect.objectContaining({ op: "moveCountersToDefender" }),
    );
    // …and STILL no registry row: both printings simulate off their printed text.
    for (const id of ["sv10.5w-040", "sv10.5w-123"]) {
      expect(programFor(id)?.attack, `${id} grew a registry row`).toBeUndefined();
    }
  });

  it("⚠️ Flutter Mane sv08-096 (1 legal) — 'Ancient' has NO DATUM to read", () => {
    expect(deriveAttackEffect(PERPLEXING_TRANSFER)).toBeNull();
    expect(programFor("sv08-096")?.attack).toBeUndefined();
    // ⚠️ THE PROOF THAT IT IS A MISSING DATUM AND NOT A MISSING PREDICATE, taken
    // off the CARD SHAPE rather than off one printing. `Card` is a closed schema
    // (packages/schema catalog/card.ts) and the only mark-like column on it is
    // `regulationMark` — the block LETTER that decides Standard legality, not the
    // Ancient/Future banner, which is printed on the card FACE and ingested
    // nowhere. So no predicate over a catalog row can answer "is this an Ancient
    // Pokémon" for ANY owner of the question: the widening is not declined here,
    // it is unavailable (D146, re-checked rather than cited).
    const sample = Object.values(FIXTURE_POOL).find((card) => card.category === "Pokemon");
    const keys = Object.keys(sample ?? {});
    expect(keys.filter((key) => /^(regulationMark|banner|subtypes|tags|marks)$/.test(key))).toEqual(
      ["regulationMark"],
    );
    expect(keys).not.toContain("subtypes");
    // …and the ONE subgroup predicate the engine has is NAME-BASED, which is the
    // second half of the proof: the banner is not in the name either. Roaring
    // Moon ex is the canonical Ancient species and its printed name says nothing
    // about it, so the only predicate that could be pointed at this sentence
    // answers FALSE for every Ancient body in the catalog — a filter that cannot
    // fail to be wrong, which is why the anchor refuses the sentence instead.
    const roaringMoon = battler("fix-ancient", { name: "Roaring Moon ex", hp: 230 });
    expect(matchesFilter(roaringMoon, { kind: "ownerPokemon", owner: "Ancient" })).toBe(false);
  });
});

// ── 7. FIXTURE_POOL as a SEPARATE population, and MATCH_RECORD_VERSION ───────

describe("FIXTURE_POOL, swept as its own population", () => {
  it("holds EXACTLY D242's four owner-prefixed names, and nothing else", () => {
    const cards = Object.values(FIXTURE_POOL);
    expect(cards.length).toBeGreaterThan(300);
    // ⚠️ **THIS CONTROL EXPIRED AT D242 AND IS RE-HOMED RATHER THAN DELETED**
    // (progress.md's standing rule). It used to read "zero possessive prefixes",
    // which is what made every demonstrator above safe to reuse. D242 fielded four
    // deliberately — a "Team Rocket's" gate holder, a plain prefixed body and TWO
    // NEAR MISSES — so the invariant becomes an ENUMERATION: the pool's prefixed
    // names are exactly those, and any fifth one arriving by accident goes red
    // here before it can change a shared fixture's behaviour.
    const prefixed = cards.filter((card) => /^[A-Z][A-Za-z' ]*'s /.test(card.name));
    // ⚠️ **AND IT EXPIRED AGAIN AT D243, WHICH IS THE ENUMERATION EARNING ITS
    // KEEP RATHER THAN A DEFECT** — three MORE prefixed bodies arrived (the
    // seat-wide aura's `Cynthia's` pair and its `Hop's` source), in a slice that
    // names none of these three files. A one-line list edit is the whole cost; a
    // deleted control would have cost nothing and said nothing.
    expect(prefixed.map((card) => card.id).sort()).toEqual(
      [
        "fix-powersaver",
        "fix-tr-body",
        "fix-tr-energy",
        "fix-not-tr-body",
        "fix-cynthia-aura",
        "fix-cynthia-body",
        "fix-hop-aura",
        // ⚠️ **AND A THIRD EXPIRY, AT D260** — the ENUMERATION earning its keep for
        // the second time in three sessions. Backlog row 15-E's target clause is
        // "your Basic Team Rocket's Pokémon", so its holder must CARRY the prefix
        // (it is a printed member of its own group) and its STAGE negative must
        // carry it too. Neither is reachable from this file's ops; the one-line
        // edit is the whole cost.
        "fix-repellingveil",
        "fix-tr-stage1",
        // ⚠️ **AND A FOURTH EXPIRY, AT D298** — the enumeration earning its keep a
        // THIRD time, and this one from a family with no owner vocabulary of its
        // own: Lillie's Pearl `sv09-151` gates its Prize reduction on the HOLDER
        // being a `Lillie's ` Pokémon, so this row's cast needed a prefixed body
        // (`fix-lillie-body`) and a prefixed 2-Prize one (`fix-legacy-ex`). Neither
        // is reachable from this file's ops; the list edit is the whole cost.
        "fix-lillie-body",
        "fix-legacy-ex",
        // ⚠️ **AND A FIFTH EXPIRY, AT D337** — the enumeration earning its keep a
        // FOURTH time, and this one from the cheapest kind of slice there is.
        // Ethan's Adventure `sv10-165`/`-221`/`-236` searches for *"Ethan's
        // Pokémon"*, and `testFixtures.ts` held **no `Ethan's ` anything** at head,
        // so three prefixed bodies arrived to give that filter something to admit
        // (a Basic, a Stage 2 and a {L} one — the stage and the type are the two
        // riders the printed noun does NOT carry). None is reachable from this
        // file's ops; the list edit is the whole cost. 🛑 **AND THIS IS THE READER
        // THE SLICE'S PRICE DID NOT ENUMERATE**: the price said "zero engine diff"
        // and was right, then said the fixture cost was four bodies and was right —
        // and never noticed that an owner-prefixed FIXTURE is itself a census
        // subject in FOUR files. A shared pool is shared per SWEEP, not per test.
        "fix-ethans-cyndaquil",
        "fix-ethans-typhlosion",
        "fix-ethans-pichu",
        // ⚠️ **AND A SIXTH EXPIRY, AT D374** — the enumeration earning its keep a
        // FIFTH time, and the first from a slice whose prefixed fixtures are ENERGY
        // cards rather than bodies. `yourActiveHasNamedEnergyAttached` reads the
        // printed NAME of an attached Energy and chooses NAME EQUALITY over the
        // `Team Rocket's ` PREFIX, so the suite needs a prefixed Energy the member
        // must REFUSE (`fix-tr-other-energy`, invented, since no second family
        // member is printed) and one whose name merely CONTAINS the noun
        // (`fix-not-tr-energy`). Neither is reachable from this file's ops; the list
        // edit is the whole cost.
        "fix-tr-other-energy",
        "fix-not-tr-energy",
        // ⚠️ **AND ANOTHER EXPIRY, AT D392 — THE FIRST IN SEVENTEEN SLICES, AND IT WAS
        // PAID ON PURPOSE.** The SUBSTRING name read is demonstrated on Team Rocket's
        // Nidoqueen `sv10-116`, whose printed clause is satisfied in Standard by Team
        // Rocket's Nidoking ex — and the OWNER POSSESSIVE is exactly what puts the
        // fragment "Nidoking" at a NON-ZERO offset, so a `startsWith` reading fails on
        // the board the card is printed for. A tidy unprefixed name would have dodged
        // this list and left that reading unrefuted. Neither body is reachable from this
        // file's ops; the list edit is the whole cost.
        "fix-loveimpact",
        "fix-trnidoking",
        // 🆕🆕 D393 — TWO MORE, AND THIS TIME THE POSSESSIVE IS NOT A CHOICE. The
        // EVOLVE PAIR's second printing is Misty's Starmie `sv10-047`, whose printed
        // clause names *"Misty's Staryu"* — the arm compares that name to the clause
        // key byte for byte, so a tidy "Staryu" would make the demonstrator match no
        // printed sentence at all. D392 paid this toll deliberately; D393 could not
        // avoid it. Neither body is reachable from this file's ops; the list edit is
        // the whole cost.
        "fix-abruptflash",
        "fix-mistystaryu",
        // 🆕🆕 D439 — `fix-inplaybodies` ("Team Rocket's Fixmon"), the FILTERED IN-PLAY
        // BODY COUNT's five-attack holder. Prefixed ON PURPOSE: the owner sentence's
        // board needs the ACTIVE SPOT inside the counted set, so that a walk which
        // skipped the Active answers 0 where the truth is 1. A Stage 1, like
        // `fix-tr-stage1` beside it, and matched by the bare owner filter for the same
        // reason — this sweep passes no `stage`.
        "fix-inplaybodies",
        // 🆕🆕 D440 — `fix-ethansadv`, a Supporter whose NAME is exactly "Ethan's
        // Adventure". Prefixed ON PURPOSE and unavoidably: `matchesFilter`'s `byName`
        // arm is `card.name === filter.name`, and the printed noun the FILTERED
        // DISCARD-PILE COUNT reads is *"Ethan's Adventure card"* — so the possessive is
        // the card's own name and a tidy alternative would make the demonstrator match
        // no printed sentence at all (D393's case, at a Trainer instead of a body).
        // 🛑 **AND IT IS AN ENERGY/TRAINER RATHER THAN A BODY, WHICH IS WHY THIS SWEEP
        // AND NOT THE `ownerPokemon` ONE CATCHES IT**: `matchesFilter`'s `ownerPokemon`
        // arm requires `category === "Pokemon"`, so this card is invisible to every
        // owner-prefix PREDICATE in the engine and visible only to this NAME sweep —
        // which is exactly the "a shared pool is shared per SWEEP, not per test"
        // finding D337 wrote three expiries up, arriving from the other side.
        // The list edit is the whole cost.
        "fix-ethansadv",
      ].sort(),
    );
    // …and NONE of the four is a Pokémon this file's ops can reach: three are
    // D242-local `fix-*` bodies never dealt into a board here, and the fourth is an
    // ENERGY. The rider assertion below is the driven half of that claim.
  });

  it("⚠️ holds NO attack that the widened anchor newly resolves", () => {
    // The regression that matters for a widened deriver, and the one
    // `clauseApostrophe.test.ts`'s census of 78 would otherwise absorb silently.
    // Swept over every pooled attack: the anchor resolves exactly the sentences
    // it resolved before, so that census does not move and owes no attribution.
    const newlyRead = Object.values(FIXTURE_POOL).flatMap((card) =>
      (card.attacks ?? [])
        .map((attack) => attack.effect ?? "")
        .filter((text) => {
          const derived = deriveAttackEffect(text)?.[0];
          // Asked of the DERIVER rather than of a second regex: the only sentence
          // the widening can newly resolve is one that produces the op WITH the
          // new key, so this cannot be fooled by a pattern that drifts from the
          // anchor it is meant to shadow.
          return (
            derived?.op === "moveCountersToDefender" &&
            (derived as { ownerPokemon?: string }).ownerPokemon !== undefined
          );
        }),
    );
    expect(newlyRead).toEqual([]);
  });
});

describe("MATCH_RECORD_VERSION — the derivation, not the habit", () => {
  it("⚠️ STAYS 12, and the park question is asked rather than assumed", () => {
    // BOTH new parameters DO reach storage: both ops PARK (asserted above, on
    // both), and `EffectContinuation.pendingOp` is persisted, so a record written
    // mid-decision carries them.
    //
    // It is D186's / D204's shape and NOT D136's. D136 bumped for a REQUIRED
    // field on a parking op — a record written before it existed cannot be
    // replayed, because the op has no meaning without the field. Both of these
    // are OPTIONAL, and their ABSENCE means exactly what every earlier program
    // meant: no `count` is the single attach, no `ownerPokemon` is every benched
    // body. An old record replays to the same board.
    //
    // Asserted as behaviour rather than as prose: the two pre-D205 shapes still
    // resolve, and neither op requires the new key.
    expect(deriveAttackEffect(TAIL_SWAP)).toEqual([{ op: "moveCountersToDefender" }]);
    const streamer = programFor("sv09-053")?.abilities?.[0]?.program?.[0];
    expect(streamer).not.toHaveProperty("count");
    // And the candidate sets are materialised in `phase.prompt.candidates` rather
    // than recomputed from the op on resume, so a resumed decision does not
    // re-read either parameter to decide what was legal.
    let state = withActive(71, "fix-goldenflame");
    state = benchFromDeck(state, "p1", "fix-ethan-cyndaquil");
    state = benchFromDeck(state, "p1", "fix-ethan-pichu");
    state = handFromDeck(state, "p1", "fix-fire-energy", 2);
    const { state: parked } = mustApply(state, useGoldenFlame);
    expect(choosePrompt(parked).candidates).toHaveLength(2);
  });
});
