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
  setConditions,
  trainerCard,
} from "./testFixtures";

// D206 — THE "SWITCH … . IF YOU DO, …" SEAM: `switchActive.ownerPokemon` and
// `switchActive.recordAs`, the two pieces D205 flagged Team Rocket's Giovanni on
// and named exactly. Neither is new vocabulary — the first is D200's predicate at
// its FOURTH read site, the second is §9.2's existing `recordGate` reaching a
// sixth (and, with its mirror `gust`, seventh) recording op — and between them
// they land SEVEN Standard-legal printings.
//
// ── WHAT MOVED WHEN D205's FLAG LIST WAS RE-DERIVED ──────────────────────────
// Every id and count below was re-run against the remote D1 `luminous`
// (735f0fb5-cdc3-494d-8b97-74a8ade0124a; 3,786 rows / 20 sets, 2,021
// `legal_standard = 1`) on 2026-08-04, ⚠️ **with `GLOB` and never `LIKE`**.
//
// **D205's DATA HOLDS, ROW BY ROW.** Giovanni 3, Orbeetle 2, N's Zoroark ex 4,
// Cofagrigus `sv10.5w-040/-123` 2, Flutter Mane `sv08-096` 1 — every id resolves
// to the card D205 names, every one is legal, and every printed sentence matches
// its constant byte for byte. The `attacks_json GLOB 'Move all damage counters*'`
// sweep reproduces at exactly 8 printings / 5 clauses.
//
// ⚠️ WHAT MOVED IS THE *SIZE* OF TWO OF ITS FLAGS, AND BOTH GREW, BECAUSE D205's
// SWEEP WAS OVER `attacks_json` ONLY.
//   • The chosen-DESTINATION counter move is not 2 printings but **7**: Munkidori
//     `sv06-095`/`sv06.5-072`/`sv08.5-044` (3 legal) prints "move up to 3 damage
//     counters from 1 of your Pokémon **to 1 of your opponent's Pokémon**" on the
//     ABILITY surface — Cofagrigus's axis exactly — and Orbeetle's own row is a
//     third member of it (own → own). One missing piece, three cards, 7 legal
//     printings, and §6 names what that piece structurally is.
//   • The "Switch … If you do" family is not one card but **8 legal printings /
//     5 sentences**, of which this slice lands 5 and refuses 3 with reasons.
//
// ⚠️ AND ONE OF D205's INCIDENTAL CLAIMS NEEDED NARROWING RATHER THAN REPAIR.
// D205 drove its Giovanni flag through "THE REAL Switch, `sv01-194`" — correct,
// that is the engine's only `switchActive` TRAINER — but all three printings of
// that sentence (`sv01-194`, `sv03.5-206`, `mfb-34`) are `legal_standard = 0`.
// The op itself is NOT idle — D189's `ATTACK_SELF_SWITCH` reads the bare
// "Switch this Pokémon with 1 of your Benched Pokémon." on **7 Standard-legal
// attack printings** (counted over `json_each(attacks_json)`, not over cards) —
// so this is not D205's Dedenne finding repeated: it is the
// narrower fact that the TRAINER seam had no legal card behind it until now.
//
// ── THE FAMILY, AS THE CATALOG PRINTS IT ─────────────────────────────────────
//   `effect GLOB '*Switch your Active*'` (Trainers) + `attacks_json GLOB
//   '*Switch this Pokémon with 1 of your Benched*'` (attacks), 2026-08-04:
//     ✅ "Switch your Active **Team Rocket's** Pokémon with 1 of your Benched
//        Team Rocket's Pokémon. If you do, switch in 1 of your opponent's Benched
//        Pokémon to the Active Spot."  sv10-174/-225/-238 — **3 legal. TAKEN.**
//     ✅ "Switch your Active Pokémon with 1 of your Benched Pokémon. If you do,
//        draw cards until you have 5 cards in your hand."  Surfer sv08-187/-235 —
//        **2 legal. TAKEN**, and it prices `recordAs` ALONE.
//     ✅ "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If
//        you do, switch your Active Pokémon with 1 of your Benched Pokémon."
//        Prime Catcher sv05-157/sv08.5-119 — **2 legal. TAKEN** — Giovanni's two
//        ops in the OPPOSITE ORDER, which is what makes the seam symmetric.
//     ⏹️ "Switch in 1 of your opponent's Benched **Basic** Pokémon to the Active
//        Spot. If you do, the new Active Pokémon is now Confused."  Lisia's
//        Appeal sv08-179/-234/-246 — 3 legal. REFUSED — TWO further pieces.
//     ⏹️ "…If you do, you may move any amount of Energy from **the Pokémon you
//        moved to your Bench** to the new Active Pokémon."  Scramble Switch
//        sv08-186 — 1 legal. REFUSED, and §6 DRIVES why.
//     ⏹️ THE ATTACK SURFACE — 4 legal printings, 4 sentences, ALL REFUSED:
//        Kilowattrel ex sv08-068 ("…attach up to 2 Basic {L} Energy … to **this
//        Pokémon**" — no self-target on `attachEnergyFrom`); Iron Bundle sv06-062
//        and Grimmsnarl sv07-096 ("**Your opponent chooses** the new Active
//        Pokémon" — an opponent-DECIDED promotion, which `gust` is not); Malamar
//        sv06.5-034 (damage to "the new Active Pokémon" PLUS "if you didn't play
//        Xerosic's Machinations from your hand during this turn", a
//        cards-played-this-turn history the state does not keep).
//     ⏹️ "Switch this Pokémon with 1 of your Benched **{L}** Pokémon."  Vikavolt
//        sv07-053 — 1 legal. ⚠️ THE SECOND NARROWING AXIS, and the row that makes
//        `ownerPokemon`'s width a measurement rather than a guess.
//     — "Switch your Active Pokémon with 1 of your Benched Pokémon." (bare)
//        sv01-194 / sv03.5-206 / mfb-34 — 0 legal, built since M4.
//
// ⚠️ Surfer appears in NO earlier table in this repo — not D199's 651-printing
// census of legal Ability/Trainer text, whose `DROPPED` names the cheapest twenty
// missing pieces, and not D200's or D204's owner-prefix work (it has no owner).
// It is found here by sweeping the ANTECEDENT rather than the subgroup.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}


// ── The printed sentences, as bytes ──────────────────────────────────────────

/** Team Rocket's Giovanni `sv10-174/-225/-238`, verbatim off `effect`. */
const GIOVANNI =
  "Switch your Active Team Rocket's Pokémon with 1 of your Benched Team Rocket's Pokémon. If you do, switch in 1 of your opponent's Benched Pokémon to the Active Spot.";
/** Surfer `sv08-187/-235`, verbatim off `effect`. */
const SURFER =
  "Switch your Active Pokémon with 1 of your Benched Pokémon. If you do, draw cards until you have 5 cards in your hand.";
/** Switch `sv01-194` — the bare sentence, ⚠️ `legal_standard = 0`. */
const PLAIN_SWITCH = "Switch your Active Pokémon with 1 of your Benched Pokémon.";
/** Boss's Orders `sv02-172` — Giovanni's consequent, verbatim and separately. */
const BOSSS_ORDERS = "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.";
/** Prime Catcher `sv05-157`/`sv08.5-119`, verbatim off `effect`. */
const PRIME_CATCHER =
  "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If you do, switch your Active Pokémon with 1 of your Benched Pokémon.";
/** ⏹️ Lisia's Appeal `sv08-179/-234/-246` — the gust-antecedent row REFUSED. */
const LISIAS_APPEAL =
  "Switch in 1 of your opponent's Benched Basic Pokémon to the Active Spot. If you do, the new Active Pokémon is now Confused.";
/** ⏹️ Scramble Switch `sv08-186` — the third own-switch Trainer, refused. */
const SCRAMBLE_SWITCH =
  "Switch your Active Pokémon with 1 of your Benched Pokémon. If you do, you may move any amount of Energy from the Pokémon you moved to your Bench to the new Active Pokémon.";
/** D189's attack self-switch — the anchor that must keep deriving unchanged. */
const SELF_SWITCH = "Switch this Pokémon with 1 of your Benched Pokémon.";
/** ⏹️ Kilowattrel ex `sv08-068` "Return Charge" — the seam on the ATTACK surface. */
const RETURN_CHARGE =
  "Switch this Pokémon with 1 of your Benched Pokémon. If you do, attach up to 2 Basic {L} Energy cards from your hand to this Pokémon.";
/** ⏹️ Iron Bundle `sv06-062` "Interjet" — the seam whose consequent the OPPONENT
    answers. ⚠️ NOT Yanmega `svp-187`, which this slice first mis-attributed it to
    and which in fact prints the BARE self-switch ("Gyro Shockwave"). */
const INTERJET =
  "Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)";
/** ⏹️ Grimmsnarl `sv07-096` "Goad 'n' Grab" — the same opponent-answered promotion
    with a SECOND §8.5 hit bolted on. Still flagged after D227, which built its
    sibling: the rider needs attack damage against a body that is not the captured
    defender, and the §8.5 pipeline runs in FRONT of the interpreter. */
const GOAD_N_GRAB =
  "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.) If you do, this attack does 160 damage to the new Active Pokémon.";
/** ⚠️ Vikavolt `sv07-053` "Volt Switch" — one WORD from the row taken, and a
    different narrowing axis entirely. */
const VOLT_SWITCH = "Switch this Pokémon with 1 of your Benched {L} Pokémon.";
/** ✅ Cofagrigus `sv10.5w-040/-123` — the chosen DESTINATION, on an attack.
    BUILT AT D216 (`moveCountersChosen`); kept here as the witness that this
    file's flag was paid rather than deleted. */
const EXTENDED_DAMAGRIIIGUS =
  "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon.";
/** ⏹️ ⚠️ Munkidori `sv06-095`/`sv06.5-072`/`sv08.5-044` — the SAME axis on the
    ABILITY surface, and 3 legal printings D205's attacks-only sweep could not
    see. */
const ADRENA_BRAIN =
  "Once during your turn, if this Pokémon has any {D} Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon.";
/** ⏹️ Team Rocket's Orbeetle `sv10-089/-198` — D205's flag, re-priced. */
const ROCKET_BRAIN =
  "As often as you like during your turn, you may move 1 damage counter from 1 of your Team Rocket's Pokémon to another of your Pokémon.";
/** ⏹️ N's Zoroark ex `sv09-098/-175/-185/-189` — D205's flag, re-priced. */
const NIGHT_JOKER = "Choose 1 of your Benched N's Pokémon's attacks and use it as this attack.";
/** D138's own sentence — the counter move whose destination is FIXED. */
const TAIL_SWAP =
  "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.";

/** The two rows this slice LANDS, with the legal id sets re-derived by NAME from
    the live catalog rather than inherited from D204's or D205's tables. */
const LANDED = [
  { card: "Team Rocket's Giovanni", sentence: GIOVANNI, ids: ["sv10-174", "sv10-225", "sv10-238"], legal: 3 },
  { card: "Surfer", sentence: SURFER, ids: ["sv08-187", "sv08-235"], legal: 2 },
  { card: "Prime Catcher", sentence: PRIME_CATCHER, ids: ["sv05-157", "sv08.5-119"], legal: 2 },
] as const;

// ── The demonstrator pool ────────────────────────────────────────────────────
//
// ⚠️ THE TWO TRAINERS ARE DECLARED UNDER THEIR **REAL IDS**, and that is forced
// rather than stylistic: `programFor` is keyed by card id, so a `fix-giovanni`
// body would exercise a fixture and not the registry row this slice ships. It is
// the opposite of D205's counter-move case, where the program came from a text
// DERIVER and a synthetic id was the honest carrier. The catalog manifest cannot
// be regenerated here (`SQLITE_CANTOPEN`) and measures a six-set catalog with no
// sv08/sv10 row at all, so these ids have nothing to be diffed against and appear
// in this file's LOCAL pool only — never in `FIXTURE_POOL`, whose `absent` set
// stays empty.
//
// ⚠️ `FIXTURE_POOL` WAS SWEPT AS ITS OWN POPULATION FIRST (§7): no owner-prefixed
// name, and the only pooled `switchActive` carrier is `sv01-194`, whose program
// is asserted BYTE-IDENTICAL below.

function subgroupBasic(id: string, name: string): Card {
  return battler(id, { name, hp: 90, types: ["Psychic"] });
}

const LOCAL_CARDS: Record<string, Card> = {
  "sv10-174": trainerCard("sv10-174", "Supporter", GIOVANNI),
  "sv08-187": trainerCard("sv08-187", "Supporter", SURFER),
  "sv05-157": trainerCard("sv05-157", "Item", PRIME_CATCHER),
  // ── Bodies the subgroup rider must KEEP.
  "fix-tr-nidorino": subgroupBasic("fix-tr-nidorino", "Team Rocket's Nidorino"),
  "fix-tr-meowth": subgroupBasic("fix-tr-meowth", "Team Rocket's Meowth"),
  "fix-tr-mewtwo": subgroupBasic("fix-tr-mewtwo", "Team Rocket's Mewtwo ex"),
  // ── Bodies it must DROP. Every one is a real near-miss.
  /** No prefix at all — the ordinary body every real board also holds. */
  "fix-plain": subgroupBasic("fix-plain", "Pikachu"),
  /** ⚠️ THE POSSESSIVE WITNESS, fielded on BOTH of this op's read sites. D204's
      one surviving mutant was `name.startsWith(owner)` without the trailing
      `'s `, and `switchActiveTargets` reads the predicate TWICE — once for the
      Bench candidates and once for the printed Active precondition — so it is two
      fresh chances to write it. `Team Rocketeer` is offered as a bench body AND
      surgeried Active below. */
  "fix-rocketeer": subgroupBasic("fix-rocketeer", "Team Rocketeer"),
  /** ⚠️ Exact case: `team rocket's Meowth` is not a Team Rocket's Pokémon. */
  "fix-lowercase": subgroupBasic("fix-lowercase", "team rocket's Meowth"),
  /** A DIFFERENT owner's prefixed body — so a rider that matched any possessive
      at all would keep it. */
  "fix-iono-body": subgroupBasic("fix-iono-body", "Iono's Bellibolt"),
  /** ⚠️ A {L}-typed body, for Vikavolt's refused axis: `ownerPokemon` must not be
      able to express "your Benched {L} Pokémon" even by accident. */
  "fix-lightning-body": battler("fix-lightning-body", { name: "Wattrel", hp: 70, types: ["Lightning"] }),
  /** An EVOLUTION body for the opponent's Bench — Lisia's Appeal's refused
      "Benched **Basic** Pokémon" filter needs a non-Basic to be about anything. */
  "fix-stage1": battler("fix-stage1", { name: "Beartic", hp: 130, stage: "Stage1", evolveFrom: "Cubchoo", types: ["Water"] }),
  /** A 340 HP neutral body for the opponent's side. */
  "fix-bigtitan": battler("fix-bigtitan", { name: "Titan", hp: 340, types: ["Colorless"] }),
  /** D138's own counter-move sentence on a local body — the op the destination
      flag DRIVES. Its printed destination is fixed, which is the whole point. */
  "fix-tailswap": battler("fix-tailswap", {
    name: "Dedenne ex",
    hp: 200,
    types: ["Psychic"],
    attacks: [{ name: "Tail Swap", cost: ["Psychic", "Colorless"], effect: TAIL_SWAP }],
  }),
} as const;

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "sv10-174": 4,
  "sv08-187": 4,
  "sv05-157": 3,
  // ⚠️ THE REAL Switch `sv01-194` (already in FIXTURE_POOL), so the regression
  // half asks what the ENGINE's unmarked program offers rather than a look-alike.
  "sv01-194": 3,
  "fix-tr-nidorino": 5,
  "fix-tr-meowth": 4,
  "fix-tr-mewtwo": 3,
  "fix-plain": 5,
  "fix-rocketeer": 4,
  "fix-lowercase": 3,
  "fix-iono-body": 3,
  "fix-lightning-body": 3,
  "fix-bigtitan": 4,
  "fix-stage1": 3,
  "fix-tailswap": 3,
  "fix-psychic-energy": 6,
});

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }));
  }
  for (const seat of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat }));
  return state;
}

/** P1 to move on turn 3, past §4's going-first Supporter restriction — which
    matters here in a way it did not for D205: both landed rows are SUPPORTERS. */
function board(seed: number): GameState {
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  return state;
}

/** P1's board with `bodyId` Active and an EMPTY Bench on both seats — D133's
    trap (`setActiveFromDeck` DISPLACES the Active it replaces onto the Bench, and
    every claim in this file is about a candidate list or a promotion). */
function withActive(seed: number, bodyId: string): GameState {
  let state = board(seed);
  state = handToDeck(state, "p1", bodyId);
  const base = clearBench(setActiveFromDeck(state, "p1", bodyId), "p1");
  return clearBench(setActiveFromDeck(base, "p2", "fix-bigtitan"), "p2");
}

/** `bodyId` Active for P1, `bench` behind it, `oppBench` behind P2's Titan. */
function stage(seed: number, bodyId: string, bench: string[], oppBench: string[] = []): GameState {
  let state = withActive(seed, bodyId);
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  for (const id of oppBench) state = benchFromDeck(state, "p2", id);
  return state;
}

/** Put `cardId` in P1's hand and return its uid — the Supporter about to be played. */
function inHand(state: GameState, cardId: string): { state: GameState; uid: string } {
  const next = handFromDeck(handToDeck(state, "p1", cardId), "p1", cardId, 1);
  const uid = next.players.p1.hand.find((u) => next.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${cardId} not in hand`);
  return { state: next, uid };
}

function play(state: GameState, uid: string) {
  return applyAction(state, { type: "playTrainer", seat: "p1", uid });
}

/** The parked `choosePokemon` prompt, narrowed. */
function choosePrompt(state: GameState): { candidates: PokemonRef[]; note: string } {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "choosePokemon") {
    throw new Error(`expected choosePokemon, got ${state.phase.prompt.kind}`);
  }
  return { candidates: state.phase.prompt.candidates, note: state.phase.prompt.note };
}

/** The §9.2 record a parked continuation is carrying — the slot `recordAs` fills. */
function parkedRecord(state: GameState): Record<string, string[]> {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return (state.phase.cont.record ?? {}) as Record<string, string[]>;
}

/** The printed NAME of a seat's Active — narrowed, so an empty spot fails here
    with the reason rather than three lines later on an undefined. */
function activeName(state: GameState, seat: Seat): string {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return topCardOf(state, active)?.name ?? "?";
}

/** The printed NAME of every body a ref list points at. */
function refNames(state: GameState, refs: readonly PokemonRef[]): string[] {
  return refs.map((ref) => {
    const side = state.players[ref.seat];
    const body = ref.spot.spot === "active" ? side.active : (side.bench[ref.spot.index] ?? null);
    return body === null ? "?" : (topCardOf(state, body)?.name ?? "?");
  });
}

function pick(seat: Seat, ref: PokemonRef) {
  return { type: "resolveEffect", seat, choice: { kind: "pokemon", ref } } as const;
}

const P1_BENCH = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });
const P2_BENCH = (index: number): PokemonRef => ({ seat: "p2", spot: { spot: "bench", index } });

// ── 1. Surfer — `recordAs` ALONE, with nothing laid over it ──────────────────
//
// This row is first because it is the CONTROL for the whole slice: it needs the
// seam and NOTHING else — both ops in the consequent already existed and the gate
// is Miriam's, unchanged — so anything it proves is about `recordAs` and cannot
// be about the subgroup rider.

describe("Surfer sv08-187/-235 — `switchActive.recordAs` + §9.2, and nothing else", () => {
  it("switches, and THEN draws to 5 — both printed clauses, in order", () => {
    // Hand is emptied to exactly the Supporter, so "drew to 5" is a measurement
    // and not an accident of the opening seven.
    let state = stage(11, "fix-plain", ["fix-tr-nidorino", "fix-tr-meowth"]);
    const staged = inHand({ ...state, players: { ...state.players, p1: { ...state.players.p1, hand: [] } } }, "sv08-187");
    state = staged.state;
    expect(state.players.p1.hand).toHaveLength(1);
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid: staged.uid });
    const { state: done, events } = mustApply(parked, pick("p1", P1_BENCH(0)));
    const switched = find(events, "POKEMON_SWITCHED");
    expect(switched?.seat).toBe("p1");
    expect(activeName(done, "p1")).toBe("Team Rocket's Nidorino");
    // ⚠️ THE GATE FIRED. The Supporter is already in the discard, so the hand
    // held ZERO when the draw ran and five is exactly `drawUntilHandSize 5`.
    expect(done.players.p1.hand).toHaveLength(5);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("⚠️ files the PROMOTED body's uid under `moved` — read off the live continuation", () => {
    // The seam made visible rather than inferred: the parked continuation carries
    // the §9.2 record, and this is what `recordGateHolds` will ask about.
    const state = stage(12, "fix-plain", ["fix-tr-nidorino", "fix-tr-meowth"]);
    const staged = inHand(state, "sv08-187");
    const { state: parked } = mustApply(staged.state, { type: "playTrainer", seat: "p1", uid: staged.uid });
    // Nothing is filed BEFORE the answer — the op has not run yet.
    expect(parkedRecord(parked).moved).toBeUndefined();
    const incoming = parked.players.p1.bench[0]?.stack[0];
    const { state: done } = mustApply(parked, pick("p1", P1_BENCH(0)));
    expect(done.players.p1.active?.stack[0]).toBe(incoming);
  });

  it("⚠️ the PROMPT says what the answer buys — §9.2's `withConsequence`, at a sixth op", () => {
    const state = stage(13, "fix-plain", ["fix-tr-nidorino", "fix-tr-meowth"]);
    const staged = inHand(state, "sv08-187");
    const { state: parked } = mustApply(staged.state, { type: "playTrainer", seat: "p1", uid: staged.uid });
    // The unmarked heading, plus the printed condition and the printed
    // consequent. A `recordSlotOf` that had not learned `switchActive` would
    // silently drop the second half and describe HALF the card — which is the
    // whole reason that function is a list and not a `recordAs in op` test.
    expect(choosePrompt(parked).note).toBe(
      "Switch to which Benched Pokémon? If you do, draw cards until you have 5 cards in your hand.",
    );
  });

  it("a hand ALREADY at 5+ draws nothing — and the card is still playable", () => {
    // `drawUntilHandSize` NEVER TRIMS, so the consequent is a no-op here. The
    // would-whiff gate belongs to `switchActive` alone: the switch is a printed
    // effect that happens, so refusing the play would refuse a working board.
    let state = stage(14, "fix-plain", ["fix-tr-nidorino", "fix-tr-meowth"]);
    const staged = inHand(state, "sv08-187");
    state = handFromDeck(staged.state, "p1", "fix-psychic-energy", 4);
    const uid = state.players.p1.hand.find((u) => state.cardIdByUid[u] === "sv08-187");
    if (uid === undefined) throw new Error("Surfer left the hand");
    const before = state.players.p1.hand.length - 1;
    // The premise, asserted: this hand is genuinely at or above the target, so a
    // green here is "nothing was drawn" and not "the draw happened to be zero".
    expect(before).toBeGreaterThanOrEqual(5);
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const { state: done } = mustApply(parked, pick("p1", P1_BENCH(0)));
    expect(done.players.p1.hand).toHaveLength(before);
    expect(activeName(done, "p1")).toBe("Team Rocket's Nidorino");
  });

  it("an EMPTY Bench refuses the play — so the whole card, draw included, cannot whiff", () => {
    const state = stage(15, "fix-plain", []);
    const staged = inHand(state, "sv08-187");
    const result = play(staged.state, staged.uid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("carries the printed sentence and the exact program it maps to", () => {
    for (const id of ["sv08-187", "sv08-235"]) {
      expect(programFor(id)?.trainer, `${id}`).toEqual([
        { op: "switchActive", recordAs: "moved" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        { op: "recordGate", slot: "moved", then: [{ op: "drawUntilHandSize", size: 5 }] },
      ]);
    }
    expect(SURFER).toContain("If you do");
    expect(SURFER).toContain("until you have 5 cards");
  });
});

// ── 2. Team Rocket's Giovanni — the subgroup rider on TOP of the seam ────────

describe("Team Rocket's Giovanni sv10-174/-225/-238 — both printed nouns, one field", () => {
  /** A mixed Bench: two Team Rocket's bodies and three near-misses. */
  const MIXED = ["fix-tr-nidorino", "fix-plain", "fix-rocketeer", "fix-tr-meowth", "fix-lowercase"];

  it("⚠️ offers ONLY the Team Rocket's bodies — `Team Rocketeer` and the lowercase are DROPPED", () => {
    const state = stage(21, "fix-tr-mewtwo", MIXED, ["fix-plain"]);
    const staged = inHand(state, "sv10-174");
    const { state: parked } = mustApply(staged.state, { type: "playTrainer", seat: "p1", uid: staged.uid });
    // ⚠️ The possessive is the load-bearing character: `startsWith("Team Rocket")`
    // takes `Team Rocketeer`, and a case-folded read takes `team rocket's Meowth`.
    // Both are on this Bench and both must be absent.
    expect(refNames(parked, choosePrompt(parked).candidates).sort()).toEqual([
      "Team Rocket's Meowth",
      "Team Rocket's Nidorino",
    ]);
    expect(choosePrompt(parked).note).toBe(
      "Switch to which Benched Team Rocket's Pokémon? If you do, switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    );
  });

  it("switches own, THEN gusts the opponent — two boards moved by one card", () => {
    const state = stage(22, "fix-tr-mewtwo", MIXED, ["fix-plain", "fix-iono-body"]);
    const staged = inHand(state, "sv10-174");
    const { state: parked } = mustApply(staged.state, { type: "playTrainer", seat: "p1", uid: staged.uid });
    const { state: gustParked, events: first } = mustApply(parked, pick("p1", P1_BENCH(0)));
    expect(find(first, "POKEMON_SWITCHED")?.seat).toBe("p1");
    expect(activeName(gustParked, "p1")).toBe("Team Rocket's Nidorino");
    // ⚠️ THE GATE IS WHAT PRODUCED THIS SECOND PARK. `recordGate` spliced `gust`
    // into the queue because `moved` was filled — a program without `recordAs`
    // (or with the wrong slot name) files nothing, the gate reads false, and this
    // phase is `turn:action` with the opponent's board untouched.
    expect(gustParked.phase.kind).toBe("effect:choose");
    expect(parkedRecord(gustParked).moved).toEqual([gustParked.players.p1.active?.stack[0]]);
    // ⚠️ …and the gust's candidates are the OPPONENT's Bench, unnarrowed: the
    // printed second sentence names no subgroup, so `ownerPokemon` must not leak
    // across the gate into an op that never had it.
    expect(refNames(gustParked, choosePrompt(gustParked).candidates).sort()).toEqual([
      "Iono's Bellibolt",
      "Pikachu",
    ]);
    const { state: done, events: second } = mustApply(gustParked, pick("p1", P2_BENCH(0)));
    expect(find(second, "POKEMON_SWITCHED")?.seat).toBe("p2");
    expect(activeName(done, "p2")).toBe("Pikachu");
    expect(done.phase.kind).toBe("turn:action");
  });

  it("⚠️ a POISONED+BURNED outgoing Active files ONE uid, not one per EVENT", () => {
    // ⚠️ FOUND BY A SURVIVING MUTANT, AND THE FIRST FIX DID NOT KILL IT. The
    // filing reads the rows `switchInto` emits, and a switch emits MORE THAN ONE
    // when the outgoing Active carries Special Conditions: §12 clears them and a
    // `STATUS_CLEARED` row goes out beside the `POKEMON_SWITCHED`. Every other
    // board in this file switches a CLEAN body, so a filing that took every
    // emitted row looked identical — and a board that only asserted the DRAW ran
    // still could not see it, because `recordGateHolds` asks the slot's LENGTH and
    // a longer wrong list is still non-empty. It takes a card that PARKS AGAIN
    // (Giovanni's gust) so the slot's exact CONTENTS are readable off the live
    // continuation.
    let state = stage(28, "fix-tr-mewtwo", ["fix-tr-nidorino", "fix-tr-meowth"], ["fix-plain", "fix-iono-body"]);
    state = setConditions(state, "p1", { poisonDamage: 10, burned: true });
    const staged = inHand(state, "sv10-174");
    const { state: parked } = mustApply(staged.state, { type: "playTrainer", seat: "p1", uid: staged.uid });
    const { state: gustParked, events } = mustApply(parked, pick("p1", P1_BENCH(0)));
    // BOTH rows really are emitted — otherwise this asserts nothing.
    expect(find(events, "POKEMON_SWITCHED")).toBeDefined();
    expect(find(events, "STATUS_CLEARED")).toBeDefined();
    // ⚠️ EXACTLY ONE uid, and it is the promoted body — not one entry per event.
    expect(parkedRecord(gustParked).moved).toEqual([gustParked.players.p1.active?.stack[0]]);
    // …and §12's own rule still holds through the new helper: the body that left
    // the Active Spot lost its conditions.
    expect(gustParked.players.p1.active?.conditions.poisonDamage).toBe(0);
    expect(gustParked.players.p1.active?.conditions.burned).toBe(false);
  });

  it("⚠️ an Active OUTSIDE the subgroup refuses the play — the FIRST printed noun", () => {
    // "Switch your Active **Team Rocket's** Pokémon…". A Bench full of Team
    // Rocket's bodies is not enough: with Pikachu Active there is no such Active
    // to switch, so the switch cannot happen and the gate stops the gust. The
    // card does nothing at all, and a Supporter that does nothing is not playable.
    //
    // ⚠️ THIS IS THE SHARPEST ASSERTION IN THE FILE. A rider read on the BENCH
    // end only — the obvious build, and the one D204's `attachEnergyFrom` shape
    // invites — passes every other case here and fails exactly this one: it would
    // switch Pikachu out for a Team Rocket's Pokémon and hand over a free Boss's
    // Orders on a board where the card is printed to do nothing.
    const state = stage(23, "fix-plain", MIXED, ["fix-plain"]);
    const staged = inHand(state, "sv10-174");
    const result = play(staged.state, staged.uid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("⚠️ `Team Rocketeer` ACTIVE is also refused — the possessive, on the second read site", () => {
    // The negative fixture fielded at the OTHER end. `startsWith("Team Rocket")`
    // on the Active precondition passes the test above (Pikachu fails it either
    // way) and fails only here.
    const state = stage(24, "fix-rocketeer", ["fix-tr-nidorino", "fix-tr-meowth"], ["fix-plain"]);
    const staged = inHand(state, "sv10-174");
    const result = play(staged.state, staged.uid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("a Bench with no Team Rocket's body refuses the play — the SECOND printed noun", () => {
    const state = stage(25, "fix-tr-mewtwo", ["fix-plain", "fix-rocketeer", "fix-iono-body"], ["fix-plain"]);
    const staged = inHand(state, "sv10-174");
    const result = play(staged.state, staged.uid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("an EMPTY OPPONENT Bench is still playable — the consequent is not the card", () => {
    // The division `programPlayable` already draws for `coinFlipGate`: a gate's
    // branch is refused only when it is the WHOLE card. Giovanni's first sentence
    // resolves here, so the card works and the gust does as much as it can.
    const state = stage(26, "fix-tr-mewtwo", MIXED, []);
    const staged = inHand(state, "sv10-174");
    const { state: parked } = mustApply(staged.state, { type: "playTrainer", seat: "p1", uid: staged.uid });
    const { state: done } = mustApply(parked, pick("p1", P1_BENCH(0)));
    expect(activeName(done, "p1")).toBe("Team Rocket's Nidorino");
    expect(activeName(done, "p2")).toBe("Titan");
    expect(done.phase.kind).toBe("turn:action");
  });

  it("ONE Team Rocket's benched body is FORCED, not asked — `parkOrForce`, unchanged", () => {
    const state = stage(27, "fix-tr-mewtwo", ["fix-tr-nidorino", "fix-plain", "fix-rocketeer"], [
      "fix-plain",
      "fix-iono-body",
    ]);
    const staged = inHand(state, "sv10-174");
    const { state: gustParked, events } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    // The own switch auto-resolved (one candidate) and the program ran straight
    // on into the gate and the gust — so the FIRST park a player sees is the
    // opponent's Bench, which is the narrowing doing real work on the dialog.
    expect(find(events, "POKEMON_SWITCHED")?.seat).toBe("p1");
    expect(activeName(gustParked, "p1")).toBe("Team Rocket's Nidorino");
    expect(refNames(gustParked, choosePrompt(gustParked).candidates).sort()).toEqual([
      "Iono's Bellibolt",
      "Pikachu",
    ]);
  });

  it("carries the printed sentence and the exact program it maps to", () => {
    for (const id of ["sv10-174", "sv10-225", "sv10-238"]) {
      expect(programFor(id)?.trainer, `${id}`).toEqual([
        { op: "switchActive", ownerPokemon: "Team Rocket", recordAs: "moved" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        { op: "recordGate", slot: "moved", then: [{ op: "gust" }] },
      ]);
    }
    // The consequent IS Boss's Orders' whole program, byte for byte — one printed
    // action read off two different cards, which is this family's checkable claim.
    const gate = programFor("sv10-174")?.trainer?.[1];
    expect(gate?.op === "recordGate" ? gate.then : undefined).toEqual(programFor("sv02-172")?.trainer);
    expect(GIOVANNI).toContain(BOSSS_ORDERS.charAt(0).toLowerCase() + BOSSS_ORDERS.slice(1));
  });
});

// ── 2b. Prime Catcher — the SAME seam, the other way round ──────────────────

describe("Prime Catcher sv05-157/sv08.5-119 — `gust.recordAs`, the mirror field", () => {
  it("gusts, and THEN switches own — Giovanni's two ops in the opposite order", () => {
    const state = stage(81, "fix-plain", ["fix-tr-nidorino", "fix-tr-meowth"], ["fix-plain", "fix-iono-body"]);
    const staged = inHand(state, "sv05-157");
    const { state: parked } = mustApply(staged.state, { type: "playTrainer", seat: "p1", uid: staged.uid });
    // The FIRST park is the OPPONENT's Bench — the antecedent, not the consequent.
    expect(refNames(parked, choosePrompt(parked).candidates).sort()).toEqual([
      "Iono's Bellibolt",
      "Pikachu",
    ]);
    const { state: ownParked, events: first } = mustApply(parked, pick("p1", P2_BENCH(0)));
    expect(find(first, "POKEMON_SWITCHED")?.seat).toBe("p2");
    expect(activeName(ownParked, "p2")).toBe("Pikachu");
    // ⚠️ THE GATE FIRED, off a uid filed on the OPPONENT's board — which is what
    // makes `recordAs` a property of the MOVE and not of whose side it happens on.
    expect(ownParked.phase.kind).toBe("effect:choose");
    expect(parkedRecord(ownParked).moved).toEqual([ownParked.players.p2.active?.stack[0]]);
    // …and the consequent's candidates are the CONTROLLER's Bench, unnarrowed.
    expect(refNames(ownParked, choosePrompt(ownParked).candidates).sort()).toEqual([
      "Team Rocket's Meowth",
      "Team Rocket's Nidorino",
    ]);
    const { state: done, events: second } = mustApply(ownParked, pick("p1", P1_BENCH(0)));
    expect(find(second, "POKEMON_SWITCHED")?.seat).toBe("p1");
    expect(activeName(done, "p1")).toBe("Team Rocket's Nidorino");
    expect(done.phase.kind).toBe("turn:action");
  });

  it("⚠️ an empty OPPONENT Bench refuses the play; an empty OWN Bench does not", () => {
    // The play gate lands the right way round with no new code: `programPlayable`
    // refuses a `gust` whose opponent Bench is empty (the ANTECEDENT is the whole
    // card), and does NOT scan a `recordGate` branch, so an empty own Bench leaves
    // the card doing the half it prints. The exact inverse of Giovanni's pair,
    // which is the check that the symmetry is real and not asserted.
    const noOpp = inHand(stage(82, "fix-plain", ["fix-tr-nidorino"], []), "sv05-157");
    const refused = play(noOpp.state, noOpp.uid);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("NO_LEGAL_TARGET");

    const noOwn = inHand(stage(83, "fix-plain", [], ["fix-plain", "fix-iono-body"]), "sv05-157");
    const { state: parked } = mustApply(noOwn.state, { type: "playTrainer", seat: "p1", uid: noOwn.uid });
    const { state: done } = mustApply(parked, pick("p1", P2_BENCH(0)));
    expect(activeName(done, "p2")).toBe("Pikachu");
    expect(activeName(done, "p1")).toBe("Pikachu");
    expect(done.phase.kind).toBe("turn:action");
  });

  it("⚠️ a FORCED gust records too — the auto-apply path, not just the parked one", () => {
    // ⚠️ FOUND BY A SURVIVING MUTANT. `parkOrForce` auto-applies a single
    // candidate WITHOUT going through `resolveEffect`, so the forced path files
    // the slot from a completely different call site than the parked one — and
    // with only two-body opponent Benches in this file, dropping the recording
    // there changed nothing. One benched body on the opponent's side: the gust is
    // forced, and the gate must STILL fire.
    const state = stage(85, "fix-plain", ["fix-tr-nidorino", "fix-tr-meowth"], ["fix-plain"]);
    const staged = inHand(state, "sv05-157");
    const { state: ownParked, events } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    expect(find(events, "POKEMON_SWITCHED")?.seat).toBe("p2");
    expect(activeName(ownParked, "p2")).toBe("Pikachu");
    expect(parkedRecord(ownParked).moved).toEqual([ownParked.players.p2.active?.stack[0]]);
    // The consequent's own park — proof the gate read the forced filing.
    expect(refNames(ownParked, choosePrompt(ownParked).candidates).sort()).toEqual([
      "Team Rocket's Meowth",
      "Team Rocket's Nidorino",
    ]);
  });

  it("⚠️ the PROMPT says what the answer buys, and Boss's Orders' does NOT", () => {
    const state = stage(84, "fix-plain", ["fix-tr-nidorino", "fix-tr-meowth"], ["fix-plain", "fix-iono-body"]);
    const staged = inHand(state, "sv05-157");
    const { state: parked } = mustApply(staged.state, { type: "playTrainer", seat: "p1", uid: staged.uid });
    expect(choosePrompt(parked).note).toBe(
      "Gust up which of the opponent's Benched Pokémon? If you do, switch your Active Pokémon with 1 of your Benched Pokémon.",
    );
    // The un-riddered gust is untouched — same op, same heading, no clause.
    expect(programFor("sv02-172")?.trainer).toEqual([{ op: "gust" }]);
  });

  it("carries the exact program, and its consequent IS `SWITCH` byte for byte", () => {
    for (const id of ["sv05-157", "sv08.5-119"]) {
      expect(programFor(id)?.trainer, `${id}`).toEqual([
        { op: "gust", recordAs: "moved" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        { op: "recordGate", slot: "moved", then: [{ op: "switchActive" }] },
      ]);
    }
    const gate = programFor("sv05-157")?.trainer?.[1];
    expect(gate?.op === "recordGate" ? gate.then : undefined).toEqual(programFor("sv01-194")?.trainer);
  });
});

// ── 3. The regression half — the UNMARKED op is byte-identical ───────────────

describe("the unmarked `switchActive` did not move", () => {
  it("`sv01-194` is still the bare one-op program, with NEITHER key written", () => {
    // ⚠️ Absent, never `undefined` (D135's rule / `CHOSEN_HEAL`'s `zone` trap):
    // registry rows are compared by VALUE across this suite, and an explicit
    // `ownerPokemon: undefined` is not `toEqual`-identical to an absent one.
    expect(programFor("sv01-194")?.trainer).toEqual([{ op: "switchActive" }]);
    const op = programFor("sv01-194")?.trainer?.[0];
    expect(op).not.toHaveProperty("ownerPokemon");
    expect(op).not.toHaveProperty("recordAs");
  });

  it("offers EVERY benched body and keeps the unmarked heading, with no §9.2 clause", () => {
    const state = stage(31, "fix-plain", ["fix-tr-nidorino", "fix-plain", "fix-rocketeer"]);
    const staged = inHand(state, "sv01-194");
    const { state: parked } = mustApply(staged.state, { type: "playTrainer", seat: "p1", uid: staged.uid });
    expect(refNames(parked, choosePrompt(parked).candidates).sort()).toEqual([
      "Pikachu",
      "Team Rocket's Nidorino",
      "Team Rocketeer",
    ]);
    // No consequence clause: `recordSlotOf` returns undefined for an op with no
    // `recordAs`, so `withConsequence` leaves the note exactly as it was pre-D206.
    expect(choosePrompt(parked).note).toBe("Switch to which Benched Pokémon?");
    expect(parkedRecord(parked)).toEqual({});
  });

  it("D189's ATTACK self-switch still derives to the field-less op", () => {
    expect(deriveAttackEffect(SELF_SWITCH)).toEqual([{ op: "switchActive" }]);
    // …and the three printings of the bare TRAINER sentence are all rotated out,
    // which is why the three rows above are this seam's first legal Trainer work.
    expect(PLAIN_SWITCH).not.toContain("If you do");
  });
});

// ── 4. What the riders REFUSE — the width, measured ─────────────────────────

describe("the width of `ownerPokemon`, measured by what it cannot say", () => {
  it("⚠️ Vikavolt sv07-053 (1 legal) — '{L} Pokémon' is a DIFFERENT axis, not this one", () => {
    // One word from the row taken, and the reason the field is named for the
    // OWNER rather than for "a subgroup". `ownerPokemon` is a possessive-prefix
    // predicate over the card NAME; the energy type is a `types` column, and
    // pointing this field at "{L}" produces a filter that answers FALSE for every
    // {L} body in the catalog — a permanently empty candidate set, D205's Flutter
    // Mane failure exactly. Driven on a real {L} body rather than argued.
    const wattrel = LOCAL_CARDS["fix-lightning-body"] as Card;
    expect(wattrel.types).toEqual(["Lightning"]);
    expect(matchesFilter(wattrel, { kind: "ownerPokemon", owner: "{L}" })).toBe(false);
    expect(matchesFilter(wattrel, { kind: "ownerPokemon", owner: "Lightning" })).toBe(false);
    // 🆕🆕 **D468 RE-POINTED THE NEXT LINE RATHER THAN DELETING IT**, and the two
    // rules that decide how are worth naming at the site.
    //
    // It used to read `expect(deriveAttackEffect(VOLT_SWITCH)).toBeNull()` — a
    // `toBeNull` on a sentence the catalog PRINTS, which D449 calls a liability
    // precisely because it goes red the day somebody builds it. D468 built it
    // (`ATTACK_SELF_SWITCH_TYPED`, `typedSelfSwitch.test.ts`), and this is that day.
    //
    // ⚠️ **THE REPLACEMENT IS NOT `.not.toBeNull()`.** That would be TRUE under this
    // build and equally true under a build that pointed `ownerPokemon` at "{L}" —
    // D438's polarity rule, and the exact move that disarmed D368's tripwire and
    // produced this run's only GAP. What this rung was ever really claiming is
    // DISJOINTNESS: *the energy type is a different axis from the owner prefix*. So
    // it is re-pointed onto the derived VALUE, which still reddens on that defect
    // and cannot go green by accident.
    expect(deriveAttackEffect(VOLT_SWITCH)).toEqual([
      { op: "switchActive", targetType: "Lightning" },
    ]);
    // …and the field this file is about is still ABSENT from that program, which is
    // the half that carries the original claim: an `ownerPokemon` build would have
    // put "{L}" (or "Lightning") in this slot.
    expect(deriveAttackEffect(VOLT_SWITCH)?.[0]).not.toHaveProperty("ownerPokemon");
    expect(programFor("sv07-053")?.attack).toBeUndefined();
  });

  it("the possessive predicate is the SAME one three other read sites use", () => {
    // Shared, not re-implemented: a Team Rocket's Pokémon must mean the same
    // three conjuncts to a deck search, an attach target, a counter-move source
    // and now a switch, or a player learns one rule and the engine enforces two.
    const tr: Parameters<typeof matchesFilter>[1] = { kind: "ownerPokemon", owner: "Team Rocket" };
    expect(matchesFilter(LOCAL_CARDS["fix-tr-nidorino"] as Card, tr)).toBe(true);
    expect(matchesFilter(LOCAL_CARDS["fix-rocketeer"] as Card, tr)).toBe(false);
    expect(matchesFilter(LOCAL_CARDS["fix-lowercase"] as Card, tr)).toBe(false);
    expect(matchesFilter(LOCAL_CARDS["fix-iono-body"] as Card, tr)).toBe(false);
  });
});

// ── 5. The landed census ────────────────────────────────────────────────────

describe("the landed census, re-derived", () => {
  it("lands SEVEN Standard-legal printings on TWO mirror ops and ZERO new vocabulary", () => {
    expect(LANDED.reduce((n, row) => n + row.legal, 0)).toBe(7);
    for (const row of LANDED) {
      expect(row.ids, `${row.card}: id list disagrees with its measured legal count`).toHaveLength(row.legal);
      // The TRAINER surface has exactly one route — there is no Trainer deriver
      // in this engine — so unlike D205's attack arm this cannot be vacuous for
      // the reason D204's was. Asserted rather than assumed, one line down.
      for (const id of row.ids) expect(programFor(id)?.trainer, `${id} (${row.card})`).toBeDefined();
      expect(deriveAttackEffect(row.sentence), `${row.card} is a TRAINER, not an attack`).toBeNull();
    }
  });

  it("shares ONE program object per card across its printings", () => {
    for (const row of LANDED) {
      const first = programFor(row.ids[0]);
      for (const id of row.ids) expect(programFor(id), `${id} left ${row.card}`).toBe(first);
    }
    // …and all three are SEPARATE objects. Surfer and Giovanni differ by ONE
    // field, which is exactly the near-twin pair an edit to either could silently
    // move (D199's rule); Prime Catcher is the same two ops in the other order.
    expect(programFor("sv08-187")).not.toBe(programFor("sv10-174"));
    expect(programFor("sv05-157")).not.toBe(programFor("sv08-187"));
  });
});

// ── 6. The FLAGS — driven, never declared ───────────────────────────────────
//
// ⚠️ EVERY FLAG BELOW RUNS THE MECHANISM IT SAYS IS MISSING AND ASSERTS THE GAP.
// "These ids are unbuilt" is nearly always true in a catalog that is ~92 %
// unbuilt — that assertion passed for D200 on ids naming the WRONG CARDS — so it
// is never the whole of a flag here.

describe("⏹️ FLAGGED — the CHOSEN DESTINATION counter move (D216: 2 of 8 landed)", () => {
  // D205 sized this at 2 (Cofagrigus). D206 re-measured it at 7. ⚠️ **D216 makes
  // it 8** — Alakazam sv06-082 "Strange Hacking" prints the same axis on an
  // ATTACK, with BOTH ends on the opponent's board, and neither earlier sweep
  // named it. D216 BUILT the Cofagrigus surface (2 legal, `moveCountersChosen`)
  // and left the other three refused on a MECHANISM each; the ids below are the
  // ones that are still flagged, which is what keeps this block a flag.
  const IDS = ["sv06-095", "sv06.5-072", "sv08.5-044", "sv10-089", "sv10-198", "sv06-082"];

  it("⚠️ the ONE counter move in the union ALWAYS lands on the defender, and NEVER asks — driven", () => {
    // The missing piece is not a predicate and not a field: it is a SECOND
    // QUESTION. Driven by running the op D138 shipped and D205 widened, on a
    // board where the source is a real choice, and asserting that answering it
    // ENDS the program — there is nowhere for a destination prompt to go.
    //
    // ⚠️ **AND THE STRUCTURAL REASON D206 GAVE HERE WAS THE WRONG ONE — CORRECTED
    // AT D216, IN PLACE.** It read: "`applyChoice` returns a `GameState`, so an op
    // that has already parked has no way to request another park … `moveEnergy`
    // dodges this with a compound prompt kind, i.e. a WIRE change." The first
    // clause is true of ONE OP and was silently generalised to a PROGRAM, which is
    // false and was already false: `runProgram(rest)` parks again the moment an op
    // in `rest` wants a decision, and Koraidon "Dino Cry" has shipped two parks in
    // one program since D186 (dinoCry.test.ts). What was actually missing was a
    // CHANNEL from the first answer to a second op — which D216 built with no wire
    // change at all, as a second `choosePokemon` park. The gap this case drives is
    // therefore about THIS OP, and stays real: `moveCountersToDefender` has one
    // question and one destination, and always will.
    let state = stage(41, "fix-tailswap", ["fix-tr-nidorino", "fix-tr-meowth"], ["fix-plain"]);
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 2);
    state = setBenchDamage(state, "p1", 0, 30);
    state = setBenchDamage(state, "p1", 1, 50);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(choosePrompt(parked).candidates).toHaveLength(2);
    const { state: done } = mustApply(parked, pick("p1", P1_BENCH(1)));
    // ⚠️ THE FLAG. One question was asked, the counters went to the OPPONENT'S
    // ACTIVE — the fixed destination — and the program is OVER. Cofagrigus needs
    // "1 of your opponent's Pokémon", Munkidori "1 of your opponent's Pokémon"
    // from "1 of YOUR Pokémon", Orbeetle "another of your Pokémon": three
    // destinations this op cannot even ask about.
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(done.players.p1.bench[1]?.damage).toBe(0);
    expect(done.players.p1.bench[0]?.damage).toBe(30);
    expect(done.players.p2.active?.damage).toBe(50);
    expect(done.players.p2.bench[0]?.damage).toBe(0);
  });

  it("⚠️ and the SIX still-flagged printings resolve on NEITHER route", () => {
    // Per surface AND through both routes — D205's repair of D204's vacuous arm,
    // applied here rather than cited. Munkidori and Orbeetle are ABILITIES
    // (`abilities` + `triggered`); Alakazam is an ATTACK (deriver + registry).
    //
    // ⚠️ COFAGRIGUS HAS LEFT THIS LIST BECAUSE IT IS BUILT, and the line that
    // replaces it says so rather than being deleted — the witness moves, it is
    // never quietly dropped (D139/D140's precedent on the neighbouring anchor).
    expect(deriveAttackEffect(EXTENDED_DAMAGRIIIGUS)).toEqual([{ op: "moveCountersChosen" }]);
    for (const id of ["sv06-095", "sv06.5-072", "sv08.5-044", "sv10-089", "sv10-198"]) {
      expect(programFor(id)?.abilities, `${id} was half-built`).toBeUndefined();
      expect(programFor(id)?.triggered, `${id} was half-built as a trigger`).toBeUndefined();
    }
    expect(programFor("sv06-082")?.attack, "sv06-082 was half-built").toBeUndefined();
    expect(IDS).toHaveLength(6);
    // The three sentences share ONE axis and differ on the others, which is what
    // makes them one flag rather than three: bounded amounts (Munkidori "up to 3",
    // Orbeetle "1") and repetition ("as often as you like") are SECOND pieces.
    expect(EXTENDED_DAMAGRIIIGUS).toContain("to 1 of your opponent's Pokémon");
    expect(ADRENA_BRAIN).toContain("to 1 of your opponent's Pokémon");
    expect(ROCKET_BRAIN).toContain("to another of your Pokémon");
    expect(TAIL_SWAP).toContain("to your opponent's Active Pokémon");
  });
});

describe("⏹️ FLAGGED — Scramble Switch sv08-186 (1 legal), the seam's third Trainer", () => {
  it("⚠️ §9.2 files the PROMOTED body, and this card names the DEMOTED one — driven", () => {
    // "If you do, you may move any amount of Energy from **the Pokémon you moved
    // to your Bench** to the new Active Pokémon." Both ends of one switch, and
    // `recordAs` files exactly one of them. Driven by playing the seam this slice
    // SHIPPED and reading the slot: the uid in `moved` is the body now Active, and
    // the body that went to the Bench is not in the record at all — so the gate
    // could fire but the consequent has no way to name its source.
    const state = stage(51, "fix-plain", ["fix-tr-nidorino", "fix-tr-meowth"]);
    const staged = inHand(state, "sv08-187");
    const { state: parked } = mustApply(staged.state, { type: "playTrainer", seat: "p1", uid: staged.uid });
    const wasActive = parked.players.p1.active?.stack[0];
    const incoming = parked.players.p1.bench[0]?.stack[0];
    // Two bodies, so "the record holds one of them" is a real distinction.
    expect(wasActive).not.toBe(incoming);
    const { state: gustLess } = mustApply(parked, pick("p1", P1_BENCH(0)));
    // The program finished, so read the filing off a board where it is still
    // parked: Giovanni's gust park carries the same record one op later.
    const trState = stage(52, "fix-tr-mewtwo", ["fix-tr-nidorino", "fix-tr-meowth"], ["fix-plain", "fix-iono-body"]);
    const trStaged = inHand(trState, "sv10-174");
    const { state: trParked } = mustApply(trState === trStaged.state ? trState : trStaged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: trStaged.uid,
    });
    const demoted = trParked.players.p1.active?.stack[0];
    const { state: gustParked } = mustApply(trParked, pick("p1", P1_BENCH(0)));
    const filed = parkedRecord(gustParked).moved ?? [];
    expect(filed).toEqual([gustParked.players.p1.active?.stack[0]]);
    // ⚠️ THE FLAG: the demoted body — Scramble Switch's printed source — is on the
    // Bench and NOT in the record. A `recordAs` that filed both, or a second slot
    // for the other end, is the piece; today the consequent cannot be authored.
    expect(filed).not.toContain(demoted);
    expect(gustParked.players.p1.bench.some((b) => b.stack[0] === demoted)).toBe(true);
    expect(gustLess.phase.kind).toBe("turn:action");
    expect(programFor("sv08-186")).toBeUndefined();
    expect(SCRAMBLE_SWITCH).toContain("the Pokémon you moved to your Bench");
  });
});

// ✅ **D331 BUILT THIS ROW, AND BOTH HALVES OF THE FLAG THAT STOOD HERE WERE
// WRONG — IN OPPOSITE DIRECTIONS.** The block below used to open
// *"TWO pieces, and the seam this slice built is neither"*. It priced:
//   PIECE ONE — a STAGE filter on the gust's candidates. **Right that something
//     was missing, wrong about its shape**: what shipped is not a `filter` at all
//     but `basicOnly?: true`, because across the whole *"Switch in 1 of your
//     opponent's…"* family (28 rows / 15 legal) exactly three rows print a stage
//     word and it is always "Basic" — a `CardFilter` would have been a whole union
//     no sentence asks this op for. **Narrow it, do not widen it.**
//   PIECE TWO — *"`applyStatus` takes `self` or `defender`… neither names the body
//     a gust just promoted on the opponent's board"*. **Simply false, and it was
//     false when it was written.** `applyStatus target: "defender"` resolves
//     `otherSeat(ctx.seat)` and reads that seat's Active **at OP TIME**, so
//     sequenced AFTER a gust it IS the printed "new Active Pokémon". D330 settled
//     this for Florges; D331 spends it. No `recordAs`, no `recordGate`.
// 🆕 **THE PIECE THE FLAG NEVER MENTIONED IS THE ONE THAT COST**: `programPlayable`
// refused a gust on a raw `bench.length`, which cannot see a rider — so the whiff
// arm the handoff called free had to be bought as `gustTargets`. **A FLAG THAT
// ENUMERATES "TWO PIECES" IS A CLAIM ABOUT COMPLETENESS**, and this one was wrong
// about both of its members and silent about the real one.
describe("✅ BUILT AT D331 — Lisia's Appeal sv08-179/-234/-246 (3 legal)", () => {
  it("⚠️ the UNRIDDEN gust seam is untouched, and the ridden one now exists — both driven", () => {
    // "Switch in 1 of your opponent's Benched **Basic** Pokémon to the Active
    // Spot. If you do, the new Active Pokémon is now Confused."
    //
    // ⚠️ THE BEHAVIOUR-PRESERVING HALF, AND IT IS THE POINT OF KEEPING THIS CASE.
    // Prime Catcher is a gust with NO rider, and `gustTargets` must leave it
    // offering every benched body of the opponent's, Evolution ones included —
    // this board holds a Stage 1 (Beartic) precisely so a funnel that started
    // filtering unconditionally would redden right here.
    const state = stage(91, "fix-plain", ["fix-tr-nidorino"], ["fix-plain", "fix-stage1"]);
    const staged = inHand(state, "sv05-157");
    const { state: parked } = mustApply(staged.state, { type: "playTrainer", seat: "p1", uid: staged.uid });
    expect(refNames(parked, choosePrompt(parked).candidates).sort()).toEqual(["Beartic", "Pikachu"]);
    const gustOp = programFor("sv05-157")?.trainer?.[0];
    expect(gustOp).toEqual({ op: "gust", recordAs: "moved" });
    expect(gustOp).not.toHaveProperty("filter");
    // …and it did NOT quietly acquire the new rider.
    expect(gustOp).not.toHaveProperty("basicOnly");
    // ⚠️ THE BUILT HALF — the same op with the adjective on, and the `defender`
    // arm the old flag declared impossible. **A "DECLARED IMPOSSIBLE" CLAIM IS A
    // CLAIM** (D329), and this file is where that one was recorded, so this is
    // where it is discharged.
    expect(programFor("sv08-179")?.trainer).toEqual([
      { op: "gust", basicOnly: true },
      { op: "applyStatus", target: "defender", status: "confused" },
    ]);
    // The rider is a NARROWING and not a `CardFilter` — the shape the flag got
    // wrong, pinned so a later widening has to argue with this line.
    expect(programFor("sv08-179")?.trainer?.[0]).not.toHaveProperty("filter");
    expect(LISIAS_APPEAL).toContain("Benched Basic Pokémon");
    expect(LISIAS_APPEAL).toContain("the new Active Pokémon is now Confused");
  });
});

describe("⏹️ FLAGGED — the seam on the ATTACK surface (4 legal printings)", () => {
  it("⚠️ the anchor that reads the bare self-switch REFUSES both, and still reads the bare one", () => {
    // D189's `ATTACK_SELF_SWITCH` is fully anchored (`^…$`), so a trailing "If you
    // do" clause drops the whole sentence rather than half-reading it. Driven in
    // BOTH directions — the refusal is worthless if the anchor itself broke.
    expect(deriveAttackEffect(SELF_SWITCH)).toEqual([{ op: "switchActive" }]);
    // ⚠️⚠️ D246 — RETURN CHARGE IS NO LONGER NULL, AND THIS IS THE **THIRD** TIME
    // THIS CASE HAS BEHAVED AS DESIGNED RATHER THAN BREAKING (Interjet at D227,
    // Grimmsnarl at D228, Kilowattrel ex now). The claim was never "the compound
    // is unbuilt"; it was that a fully anchored `ATTACK_SELF_SWITCH` refuses a
    // trailing "If you do" rather than HALF-READING it. It now derives to a
    // TWO-op program, and the half-read this case exists against would have
    // produced the bare one-op program — which is exactly what the inequality
    // below refuses. A `toBeNull` here would now assert the absence of a feature
    // instead of the anchoring it was written for.
    expect(deriveAttackEffect(RETURN_CHARGE)).toEqual([
      { op: "switchActive", recordAs: "moved" },
      {
        op: "recordGate",
        slot: "moved",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [
          {
            op: "attachEnergyFrom",
            source: "hand",
            energyType: "Lightning",
            toSelf: true,
            count: 2,
          },
        ],
      },
    ]);
    expect(deriveAttackEffect(RETURN_CHARGE)).not.toEqual(deriveAttackEffect(SELF_SWITCH));
    // ⚠️ D227 — INTERJET IS NO LONGER NULL, AND WHAT THIS CASE CLAIMS SURVIVED THE
    // CHANGE INTACT. The claim was never "the compound is unbuilt"; it was "a
    // fully anchored `ATTACK_SELF_SWITCH` refuses a trailing 'If you do' rather
    // than HALF-READING it". D227 gave the compound its own whole-string anchor,
    // so the sentence now derives to a TWO-op program — and the half-read this
    // case exists against would have produced the bare one-op program, which is
    // exactly what the inequality below refuses. A `toBeNull` here would now be
    // asserting the absence of a feature instead of the anchoring it was written
    // for.
    expect(deriveAttackEffect(INTERJET)).toEqual([
      { op: "switchActive", recordAs: "moved" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
      { op: "recordGate", slot: "moved", then: [{ op: "opponentSwitchOut" }] },
    ]);
    expect(deriveAttackEffect(INTERJET)).not.toEqual(deriveAttackEffect(SELF_SWITCH));
    // ⚠️ D228 — AND GRIMMSNARL LOSES THE FLAG THE SAME WAY INTERJET DID ONE SLICE
    // AGO, WHICH IS THIS CASE BEHAVING AS DESIGNED FOR THE SECOND TIME. The claim
    // was never "the rider is unbuilt"; it was that `ATTACK_SELF_SWITCH`'s and
    // `ATTACK_OPPONENT_SWITCH_OUT`'s anchors refuse a trailing clause rather than
    // half-reading it. D228 gave the rider its own whole-string anchor, so it
    // derives to a TWO-op program — and the half-read this case exists against
    // would have produced D227's bare one-op program, which is what the
    // inequality below refuses. (The paragraph that stood here said the rider
    // "lives in attack.ts and has no channel from a program"; `snipeActive` is
    // that channel and has been since D96 — see D228.)
    expect(deriveAttackEffect(GOAD_N_GRAB)).toEqual([
      { op: "opponentSwitchOut", recordAs: "moved" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
      { op: "recordGate", slot: "moved", then: [{ op: "damageNewActive", amount: 160 }] },
    ]);
    expect(deriveAttackEffect(GOAD_N_GRAB)).not.toEqual([{ op: "opponentSwitchOut" }]);
    // …and every one of the four is still unauthored in the REGISTRY, which is the
    // half of this case D227 did not touch (an arm is not a row).
    for (const id of ["sv08-068", "sv06-062", "sv06.5-034", "sv07-096"]) {
      expect(programFor(id)?.attack, `${id} was half-built`).toBeUndefined();
    }
    // ⚠️ …and Yanmega `svp-187` is the card this slice first mis-attributed
    // "Interjet" to. It prints the BARE self-switch, so it IS built — pinned here
    // so the correction cannot rot back into the wrong id.
    expect(deriveAttackEffect("Switch this Pokémon with 1 of your Benched Pokémon.")).not.toBeNull();
  });

  it("⚠️ names each missing piece, and neither is the seam this slice built", () => {
    // Kilowattrel ex sv08-068: the consequent attaches "to **this Pokémon**", and
    // `attachEnergyFrom` chooses a target — it has `targetType`, `basicOnly`,
    // `ownerPokemon`, `benchOnly` and (since D205) `count`, but no self-target, so
    // the batch would park on a question the card does not ask. Driven off the op
    // D205 shipped rather than read off a comment.
    //   ✅ **D221 BUILT `toSelf` AND D246 SPENT IT HERE** — the paragraph above is
    //   kept verbatim (D178: provenance is annotated, never overwritten) and its
    //   claim is now HISTORICAL. Golden Flame is still the un-narrowed row it
    //   always was, so the assertions below still say what they said; what changed
    //   is the OP, not this card. ⚠️ AND THE FIELD DID MORE WORK HERE THAN ON ANY
    //   PRIOR PRINTING: `toSelf` reads `sourceRef`, which finds the attacker
    //   WHEREVER IT SITS, and Return Charge is the first printing to move its own
    //   body to the Bench and then feed it there.
    const goldenFlame = programFor("sv10-039")?.abilities?.[0]?.program?.[0];
    expect(goldenFlame).toMatchObject({ op: "attachEnergyFrom", count: 2 });
    expect(goldenFlame).not.toHaveProperty("toSelf");
    expect(deriveAttackEffect(RETURN_CHARGE)?.[1]).toMatchObject({
      op: "recordGate",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
      then: [{ op: "attachEnergyFrom", toSelf: true }],
    });
    // Iron Bundle sv06-062 and Grimmsnarl sv07-096: "(Your opponent chooses the
    // new Active Pokémon.)" — at D206 the union's only opponent-answered park was
    // `opponentMayDraw`, a confirm, and `gust` is the CONTROLLER choosing, which
    // this slice's own mirror row proves by driving it.
    // ✅ **D227 BUILT IT** (`opponentSwitchOut` — `gust`'s board move with a
    // `decider` on the park), so Iron Bundle's whole sentence now derives; ✅ and
    // **D228 BUILT GRIMMSNARL'S DAMAGE RIDER** (`damageNewActive` behind the
    // printed "If you do"), so of the four printings this block flags, only
    // Kilowattrel ex `sv08-068` and Malamar `sv06.5-034` are still unread — for
    // the two reasons named below, neither of which is the switch. The paragraph
    // is CORRECTED rather than deleted: what it got right is that the missing
    // piece was the ANSWERING SEAT and not the switch.
    // ✅ **AND D246 BUILT KILOWATTREL EX**, so of the four printings this block
    // flags, **ONE** is still unread and it is Malamar `sv06.5-034`. Three slices,
    // three printings, and the flag that survives all three is the one blocked on
    // a DATUM the state does not keep rather than on a piece of vocabulary — which
    // is the useful shape of this whole table: a missing OP gets built, a missing
    // FACT does not.
    expect(programFor("sv02-172")?.trainer).toEqual([{ op: "gust" }]);
    expect(INTERJET).toContain("Your opponent chooses");
    // Malamar sv06.5-034 wants a second thing no board keeps: "if you didn't play
    // **Xerosic's Machinations** from your hand during this turn". `allowances`
    // records that a Supporter/Stadium was played, never WHICH card — so the
    // predicate has no datum — D205's rule (check the datum exists before
    // designing a predicate over it), applied to a HISTORY rather than a banner.
    // Driven: play a Supporter and read the turn's allowances.
    const state = stage(93, "fix-plain", ["fix-tr-nidorino", "fix-tr-meowth"]);
    const staged = inHand(state, "sv08-187");
    const { state: parked } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    const { state: done } = mustApply(parked, pick("p1", P1_BENCH(0)));
    expect(done.allowances.supporterPlayed).toBe(true);
    expect(JSON.stringify(done.allowances)).not.toContain("sv08-187");
  });
});

describe("⏹️ FLAGGED — N's Zoroark ex sv09-098/-175/-185/-189 (4 legal)", () => {
  const IDS = ["sv09-098", "sv09-175", "sv09-185", "sv09-189"] as const;

  it("⚠️ unbuilt on BOTH routes, and the gap is the COPY rather than the predicate", () => {
    for (const id of IDS) {
      expect(programFor(id)?.attack, `${id} grew a registry attack`).toBeUndefined();
      expect(programFor(id)?.abilities?.[0]?.name, `${id} lost its Trade Ability`).toBe("Trade");
    }
    expect(deriveAttackEffect(NIGHT_JOKER)).toBeNull();
    // ⚠️ THE ASSERTION THAT MAKES THIS MORE THAN "IT IS UNBUILT": strip the
    // subgroup word — the only part of the sentence this slice's rider could
    // touch — and it is STILL unreadable. So the 4 printings are not a price
    // signal for `ownerPokemon`; they are one for an attack-COPY op, and a slice
    // that builds the predicate cannot come back and claim this row.
    expect(deriveAttackEffect("Choose 1 of your Benched Pokémon's attacks and use it as this attack.")).toBeNull();
    expect(NIGHT_JOKER).toContain("use it as this attack");
  });
});

// ── 7. FIXTURE_POOL as a separate population, and MATCH_RECORD_VERSION ──────

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
        // printed NAME of an attached Energy, and the choice it makes is NAME
        // EQUALITY over the `Team Rocket's ` PREFIX — so the suite needs a prefixed
        // Energy the member must REFUSE (`fix-tr-other-energy`, invented, since no
        // second family member is printed) and one whose name merely CONTAINS the
        // noun (`fix-not-tr-energy`). Neither is reachable from this file's ops; the
        // list edit is the whole cost. 🛑 **AND THIS IS THE FOURTH SLICE IN A ROW
        // WHOSE PRICE DID NOT ENUMERATE THIS READER** — an owner-prefixed FIXTURE is
        // a census subject wherever the pool is swept, whatever category it is.
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
        // 🆕🆕🆕 **D510 — TWO MORE, AND THIS SWEEP IS THE ONLY THING IN THE REPO
        // THAT SEES EITHER OF THEM.** The PRINTED NAME FRAGMENT count is demonstrated on
        // *"each Supporter card that has "Team Rocket" in its name"*, and the fragment's
        // real-world carriers are owner-possessive cards — so `fix-trsupporter` ("Team
        // Rocket's Ambition", the Supporter positive) and `fix-trtransceiver` ("Team
        // Rocket's Transceiver", the ITEM that proves the head-noun conjunct is
        // load-bearing) both carry the prefix, and neither is a Pokémon.
        // 🛑 **THE PRICE FOR THIS SLICE NAMED THIS READER BEFORE THE SWEEP RAN, WHICH IS
        // THE FIRST TIME IN THE RUN OF EXPIRIES ABOVE.** D337, D374, D392 and D440 each
        // recorded that their price had MISSED it; D510's did not, because the rule was
        // read off this very comment. ⚠️ **AND THE THIRD FIXTURE IS DELIBERATELY NOT
        // PREFIXED**: `fix-trgrunt` ("Grunt of Team Rocket") puts the fragment at a
        // NON-ZERO offset with no possessive, which is what separates `.includes` from
        // `.startsWith` — so it is invisible to this pattern by design rather than by
        // luck, and a successor who "tidies" it into a possessive would both break that
        // separation AND land here.
        "fix-trsupporter",
        "fix-trtransceiver",
      ].sort(),
    );
    // …and NONE of the four is a Pokémon this file's ops can reach: three are
    // D242-local `fix-*` bodies never dealt into a board here, and the fourth is an
    // ENERGY. The rider assertion below is the driven half of that claim.
  });

  it("⚠️ holds exactly ONE `switchActive` carrier, and its program is unchanged", () => {
    // The sweep a widened OP owes, asked of the REGISTRY rather than of a name
    // scan: every pooled id whose program mentions `switchActive`, and what it
    // resolves to. One id, one field-less op — so no pooled fixture's behaviour
    // moves under either new key and no other test file's board can shift.
    const carriers = Object.keys(FIXTURE_POOL).filter((id) =>
      (programFor(id)?.trainer ?? []).some((op) => op.op === "switchActive"),
    );
    expect(carriers).toEqual(["sv01-194"]);
    expect(programFor("sv01-194")?.trainer).toEqual([{ op: "switchActive" }]);
  });

  it("the unmarked rider's candidate set IS the whole Bench — the play gate's own claim", () => {
    // `programPlayable` swapped `bench.length === 0` for the op's own candidate
    // function. On an unmarked op the two agree BY CONSTRUCTION, and that is what
    // keeps every pre-D206 `switchActive` board identical; driven on a Bench with
    // three near-misses, where a rider that leaked a default would refuse the play.
    const state = stage(61, "fix-plain", ["fix-rocketeer", "fix-lowercase", "fix-iono-body"]);
    const staged = inHand(state, "sv01-194");
    const { state: parked } = mustApply(staged.state, { type: "playTrainer", seat: "p1", uid: staged.uid });
    expect(choosePrompt(parked).candidates).toHaveLength(3);
  });
});

describe("MATCH_RECORD_VERSION — the derivation, not the habit", () => {
  it("⚠️ STAYS 12, and the park question is asked rather than assumed", () => {
    // `switchActive` PARKS, so both new keys DO reach storage: they ride
    // `EffectContinuation.pendingOp`, which is persisted. It is D186's / D204's /
    // D205's shape and NOT D136's — D136 bumped for a REQUIRED field on a parking
    // op, where a record written before it cannot be replayed at all. Both keys
    // here are OPTIONAL and their ABSENCE means exactly what every earlier program
    // meant: no `ownerPokemon` is every benched body, no `recordAs` files nothing
    // and every §9.2 gate over the program reads false. An old record replays to
    // the same board.
    //
    // Asserted as BEHAVIOUR: the pre-D206 shape still resolves to the same ops,
    // its park carries an ABSENT record (not an empty object), and its candidate
    // set is materialised in `phase.prompt.candidates` rather than recomputed from
    // the op on resume — so a resumed decision never re-reads either key.
    expect(deriveAttackEffect(SELF_SWITCH)).toEqual([{ op: "switchActive" }]);
    const state = stage(71, "fix-plain", ["fix-tr-nidorino", "fix-plain"]);
    const staged = inHand(state, "sv01-194");
    const { state: parked } = mustApply(staged.state, { type: "playTrainer", seat: "p1", uid: staged.uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(parked.phase.cont.record).toBeUndefined();
    expect(parked.phase.cont.pendingOp).toEqual({ op: "switchActive" });
    expect(parked.phase.prompt.kind).toBe("choosePokemon");
  });
});
