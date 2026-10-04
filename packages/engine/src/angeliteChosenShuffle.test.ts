import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { EffectOp } from "./effects";
import {
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
  timingGateFromAttackText,
} from "./effects";
import {
  applyAction,
  attackGateOf,
  createGame,
  engineVersion,
} from "./index";
import { programFor, registryCardIds } from "./registry";
import type { GameEvent, GameState, InPlayPokemon, PokemonRef, Seat } from "./index";
import { shuffle } from "./rng";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
} from "./testFixtures";
import { stackUids } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// 🆕🆕🆕 D541 — THE CHOSEN BENCH SHUFFLE BEHIND A TRAILING GATE CLAUSE, AND THE
// FUNNEL THAT WAS ALREADY THERE.
//
// `censusAttackCorpus.ts` **FILE LINE 82** (`legalAttackCorpus()` index **29**,
// leading count column **3**) — Sylveon ex `sv08-086` / `sv08.5-041` / `sv08.5-156`
// idx 1 "Angelite":
//   *"Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all
//    attached cards into your opponent's deck. If 1 of your Pokémon used Angelite
//    during your last turn, this attack can't be used."*
// **1 sentence / 3 legal printings** — the largest single row left in the residue
// and the only 3-printing one.
//
// ── 🛑 THE DIVISION OF LABOUR WITH `angeliteCancel.test.ts` ───────────────────
// That file is **the GATE half** (D396): the `BoardCondition` member, the index
// key, the §9 payability mirrors, the report, `MATCH_RECORD_VERSION` 25. **This
// file is the BODY half**: the anchor, the TRAILING split branch and its tripwire,
// the `returnBenchedChosen` op on a real board, the §11 shield at the park, and the
// census arithmetic. They meet at exactly two seams and BOTH are asserted on BOTH
// sides: that file's §1 rung (INVERTED by this slice) and this file's §2 agree
// about what the splitter answers; this file's §7 pins `registry === derived` for
// the three ids that file pins the registry row on. Extending that file was the
// alternative and was DECLINED — 869 lines of gate, and the body half needs its own
// 60-card demonstrator deck (D270) and its own boards.
//
// ── 🛑 THE DECISION AT THE TOP, BECAUSE IT IS A POLICY A REVIEWER MAY REFUSE ──
// D282 anchored the gate splitter at `^` and said so in as many words. This slice
// keys the SAME closed literal list at the TRAILING end too. **THE ALTERNATIVE WAS
// PRICED AND REJECTED, AND THE REASON IS MEASURABLE RATHER THAN STYLISTIC.**
// Anchoring the WHOLE printed string — trailing clause and all — in
// `deriveAttackEffect` needs no splitter change at all, and it was rejected because:
//   (i) it credits the row to the READER summand, moving `reader` 565/1614 →
//       566/1617 and `rawUnbuilt` 75/118 → 74/115, and with them the **25** files
//       that pin `[565, 1614]` and the **7** that pin `toBe(1614)` — so the split
//       route is the SMALLER pin radius as well as the semantically right answer
//       (§3 drives all four of those figures and asserts the two that must NOT move);
//  (ii) it embeds gate text inside an EFFECT anchor, so a reprint without the clause
//       would not match — the opposite of `conventions.md:195`'s *"an arm transfers
//       across sets"*;
// (iii) it leaves the gate half a hand-authored registry row forever.
// ⚠️ **IF THE `^`-POLICY WIDENING IS REFUSED, THE ROW FALLS BACK TO THE REGISTRY
// SHAPE D540 ALREADY REJECTED.** That is this slice's real contingency and it is
// stated here rather than in a footnote.
//
// ── 🛑 THE SITE THE COMPILER CANNOT SEE, AND §4 IS THE ONLY THING THAT CAN ────
// `applyChoice`'s `switch` ends in `default: return state;` — *"Synchronous ops
// never park, so never reach the choice path"* — so OMITTING `case
// "returnBenchedChosen"` there TYPECHECKS GREEN and then silently discards the
// player's answer: the op parks, the prompt is shown, `validateChoice` accepts the
// refs, and the board comes back byte-identical with no event and no log row.
// MEASURED at this head rather than inherited from D540: deleting that arm and
// running `bunx tsc -b --force` prints NOTHING. **§4 therefore drives the PARKED
// path through `resolveEffect` and asserts the VICTIM'S BENCH and DECK — never the
// op's shape (D421)** — and a FORCED-path rung could not kill it, because the
// forced path never reaches `applyChoice` at all.
//
// ── 🛑 THE OTHER SITE THE TYPE SYSTEM CANNOT SEE (§6) ─────────────────────────
// The gate map's fifth row names `yourPokemonUsedAttackLastTurn`. Its WRONG TWIN
// `yourActiveUsedAttackLastTurn` is type-compatible, compiles, and is green on every
// board anyone writes naturally — the two diverge ONLY when the body that used
// Angelite has since left the Active Spot. ⚠️ **AND IT IS MASKED ON ALL THREE REAL
// IDS**, because `attackGateOf` is `authored ?? derived` and `registry.ts`'s
// `SYLVEON_EX_ANGELITE` wins. So §6's witness rides a file-local DECLARED
// demonstrator with NO registry row (`d541-sylveon`, D425 / D540's shape) in this
// suite's own 60-card deck (D270). **A suite that only drove the real ids would be
// green and worthless, and that is said out loud rather than reported as a pass.**
//
// ── WHAT SHIPS ───────────────────────────────────────────────────────────────
// ONE `ATTACK_GATE_CLAUSES` row + ONE `ATTACK_GATE_CLAUSE_GATES` row (the
// `Record<AttackGateClause, …>` is TOTAL, so one without the other does not
// compile); ONE TRAILING branch on `splitAttackGateClause` plus its leading-AND-
// trailing TRIPWIRE; ONE new anchor `CHOOSE_SHUFFLE_CHOSEN`; ONE new `EffectOp`
// member `returnBenchedChosen`; ONE new `deriveAttackEffect` arm (42-ter); ONE
// `stepOp` arm, ONE `applyChoice` arm and ONE note in `interpreter.ts`; and a
// RENAME of the module-private `returnBenchedRest` funnel to
// `shuffleBenchedRefsIntoDeck`. ⚠️ **THE PRICING REPORT ASKED FOR AN EXTRACTION AND
// THERE WAS NOTHING TO EXTRACT** — that function already took an arbitrary
// `readonly PokemonRef[]`, consulted `op` nowhere, enforced the single-seat
// precondition, gathered before splicing, spliced descending and emitted exactly one
// `SHUFFLE`. D433's prescription was already satisfied STRUCTURALLY, so this slice
// paid a rename instead: a price REDUCTION, published as one. **The OP NAME
// `"returnBenchedRest"` is untouched — it is a persisted `EffectOp` member.**
// ZERO bytes in `redact.ts` (`git grep returnBenched` → empty), `packages/schema`,
// `cardplay.ts` (`choosePokemonMulti` already ships in `validateChoice` and its arm
// is op-agnostic — VERIFIED by probe, not assumed), `src/` and `apps/`. No new
// prompt kind, choice kind, event, error code or `CardFilter` member.
// `MATCH_RECORD_VERSION` HOLDS at 30 (§8). engine 0.425.0 → 0.426.0.
// ─────────────────────────────────────────────────────────────────────────────

/** The PRINTED row, byte for byte off the committed corpus. §1's first rung is what
    proves these bytes agree with `legalAttackCorpus()` index 29. */
const PRINTED =
  "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck. If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.";

/** The TRAILING gate clause alone — `ATTACK_GATE_CLAUSES`' fifth row. */
const CLAUSE =
  "If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.";

/** The STRIPPED body — what the split hands the readers, and what
    `CHOOSE_SHUFFLE_CHOSEN` claims. Spelled out rather than sliced off `PRINTED`, so
    §1's claims are about a sentence somebody read (D183/D456). */
const BODY =
  "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck.";

/** The NEAR MISS whose pick names the bodies that STAY — `CHOOSE_KEEP_SHUFFLE_REST`,
    corpus file line 84, D537. The exact INVERSION of this row. */
const KEEP_SENTENCE =
  "Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck.";

/** The other near miss that shares this opening — `COUNTER_PUT_ON_CHOSEN_OPPONENTS`. */
const COUNTER_SENTENCE =
  "Choose 2 of your opponent's Pokémon and put 3 damage counters on each of them.";

/** The head the two bench anchors SHARE, byte for byte. */
const SHARED_HEAD = "Choose 2 of your opponent's Benched Pokémon.";

/** The tail `CHOOSE_SHUFFLE_CHOSEN` requires. */
const CHOSEN_TAIL = "Shuffle those Pokémon and all attached cards into your opponent's deck.";

const PROGRAM: EffectOp[] = [{ op: "returnBenchedChosen", count: 2 }];

/** The printed prompt caption, pinned byte for byte in §9. */
const NOTE = "Choose 2 of your opponent's Benched Pokémon to shuffle into their deck.";

const SYLVEON_IDS = ["sv08-086", "sv08.5-041", "sv08.5-156"] as const;

// ── THE DECLARED DEMONSTRATORS (D425 — no registry row, stated out loud) ──────
const CHARMER = "d541-sylveon";
const WALL = "d541-wall";
const B1 = "d541-b1";
const B2 = "d541-b2";
const B3 = "d541-b3";
const B4 = "d541-b4";
const B5 = "d541-b5";
const STAGE1 = "d541-stage1";
/** The BENCH-GATED §11 shield — Poltchageist "Curious Tea Party"
    (`preventDamageAndEffectsWhileBenched`), the one prevent in this pool that fires
    on a BENCHED body and therefore the only one this op can meet. */
const TEAPARTY = "fix-teaparty";
const TOOL = "fix-tool";
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
  [CHARMER]: battler(CHARMER, {
    name: "D541 Charmer",
    hp: 270,
    retreat: 1,
    types: ["Colorless"],
    attacks: [
      // ⚠️ **INDEX 0 IS NAMED "Angelite" AND HAS NO `damage` KEY, AND BOTH ARE
      // PRINTED RATHER THAN CONVENIENT.** The real printing deals no damage, so
      // §6's boards can be wound on for turns without a Knock Out changing the
      // question; and the NAME is what `stampAttackUse` writes into `usedAttack`,
      // which is the fact the derived gate reads back. A differently-named attack
      // would make §6 green on both twins.
      { cost: ["Colorless"], name: "Angelite", effect: PRINTED },
      // THE CONTROL, one index over: same attacker, same cost, NO effect text — so
      // every "no park AND no board change" verdict below is a claim about the op
      // rather than about the board, and §6's index-keying has a row to be right
      // about.
      { cost: ["Colorless"], name: "Plain Tap", damage: 10 },
    ],
  }),
  [WALL]: bencher(WALL, "D541 Wall", 330),
  [B1]: bencher(B1, "D541 B1", 200),
  [B2]: bencher(B2, "D541 B2", 200),
  [B3]: bencher(B3, "D541 B3", 200),
  [B4]: bencher(B4, "D541 B4", 200),
  [B5]: bencher(B5, "D541 B5", 200),
  [STAGE1]: battler(STAGE1, {
    name: "D541 Stage 1",
    hp: 140,
    retreat: 1,
    stage: "Stage 1",
    evolveFrom: "D541 B2",
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

// 4 + 4 + 4*5 + 2 + 4 + 2 + 24 = 60 (D270).
const DECK = deckOf({
  [CHARMER]: 4,
  [WALL]: 4,
  [B1]: 4,
  [B2]: 4,
  [B3]: 4,
  [B4]: 4,
  [B5]: 4,
  [STAGE1]: 2,
  [TEAPARTY]: 4,
  [TOOL]: 2,
  [ENERGY]: 24,
});

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string | readonly string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob(
  [
    "./{censusAttackCorpus,effects,interpreter,cardplay,redact,registry}.ts",
    "../../../apps/api/src/lobby/match.ts",
  ],
  { query: "?raw", import: "default", eager: true },
);
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

/** TEST SURGERY — attach one `cardId` off `seat`'s deck onto the benched body at
    `index`, as ENERGY or as a TOOL. */
function attachToBench(
  state: GameState,
  seat: Seat,
  index: number,
  cardId: string,
  as: "energy" | "tools",
): GameState {
  const side = state.players[seat];
  const body = side.bench[index];
  if (body === undefined) throw new Error(`${seat} has no bench[${index}]`);
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat}'s deck lacks ${cardId}`);
  const grown = { ...body, [as]: [...body[as], uid] };
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        bench: [...side.bench.slice(0, index), grown, ...side.bench.slice(index + 1)],
        deck: side.deck.filter((u) => u !== uid),
      },
    },
  };
}

/** TEST SURGERY — push one `cardId` UNDER the benched body at `index`. */
function underBench(state: GameState, seat: Seat, index: number, cardId: string): GameState {
  const side = state.players[seat];
  const body = side.bench[index];
  if (body === undefined) throw new Error(`${seat} has no bench[${index}]`);
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat}'s deck lacks ${cardId}`);
  const grown = { ...body, stack: [uid, ...body.stack] };
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        bench: [...side.bench.slice(0, index), grown, ...side.bench.slice(index + 1)],
        deck: side.deck.filter((u) => u !== uid),
      },
    },
  };
}

/** TEST SURGERY — attach `count` copies of `fix-energy` onto `seat`'s Active. */
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

/** p1's turn; `d541-sylveon` Active; p2's Active is `WALL` and its Bench is exactly
    `bench`, in the order given. */
function board(seed: number, bench: readonly string[]): GameState {
  let state = localSetup(seed);
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", CHARMER);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", B1);
  return fuel(state, "p1", 1);
}

function attack(state: GameState, index = 0): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, { type: "attack", seat: "p1", index });
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function answer(
  state: GameState,
  refs: readonly PokemonRef[],
): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [...refs] },
  });
  if (!result.ok) throw new Error(`answer refused: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

const SEED = 541;
const SEEDS = [541, 557, 563, 569] as const;
const benchIds = (state: GameState, seat: Seat): string[] =>
  state.players[seat].bench.map((b) => state.cardIdByUid[b.stack[b.stack.length - 1] ?? ""] ?? "?");
const benchRef = (index: number): PokemonRef => ({ seat: "p2", spot: { spot: "bench", index } });
const rows = (events: readonly GameEvent[], type: string) => events.filter((e) => e.type === type);
/** ⚠️ **AN ATTACK ENDS THE TURN [🆕🆕🆕 D570 (D539): except a FIRST attack under Festival Lead with Festival Grounds in play, which no board here builds]**, so every board measured AFTER the answer has
    already run p2's turn tail — and that tail DRAWS ONE CARD off the very deck this
    op just shuffled into. The pile this op writes is therefore `deck ∪ hand`
    (`benchKeepShuffleRest.test.ts`'s finding, re-derived here rather than copied:
    the same tail runs on the same seat). */
const libraryOf = (state: GameState, seat: Seat): string[] => [
  ...state.players[seat].deck,
  ...state.players[seat].hand,
];
function bodyAt(state: GameState, seat: Seat, index: number) {
  const body = state.players[seat].bench[index];
  if (body === undefined) throw new Error(`no ${seat} bench[${index}]`);
  return body;
}

function parkedPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`not parked: ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error(`wrong prompt: ${prompt.kind}`);
  return prompt;
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const body = state.players[seat].active;
  if (body === null) throw new Error(`${seat} has no Active`);
  return body;
}

/** Wind the clock until it is `seat`'s turn again, ending turns and nothing else. */
function untilTurnOf(state: GameState, seat: Seat, guard = 12): GameState {
  let next = state;
  for (let i = 0; i < guard; i++) {
    if (next.phase.kind === "turn:action" && next.phase.seat === seat) return next;
    const phase = next.phase;
    if (phase.kind !== "turn:action") throw new Error(`stuck in ${phase.kind}`);
    next = must(applyAction(next, { type: "endTurn", seat: phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE READING: the anchor claims the STRIPPED BODY and nothing else.
// ─────────────────────────────────────────────────────────────────────────────

describe("D541 §1 — the anchor claims the STRIPPED body, and refuses the row, the clause and both near misses", () => {
  it("🛑 the row is READ off the census by index and by units, never retyped (D183/D456)", () => {
    const corpus = legalAttackCorpus();
    expect(corpus).toHaveLength(640);
    const row = corpus[29];
    expect(row?.[1]).toBe(PRINTED);
    expect(row?.[0]).toBe(3);
    // …and it occurs EXACTLY ONCE, which is what makes "index 29" a description of
    // the corpus rather than of this line.
    expect(corpus.filter(([, t]) => t === PRINTED)).toHaveLength(1);
  });

  it("🛑 the PRINTED row is claimed by no reader whole, and the STRIPPED body is claimed by one", () => {
    // The row resolves through the SPLIT summand, not the reader summand. If a
    // reader ever claims the raw row, something is double-counting.
    expect(resolvedByAnyReader(PRINTED)).toBe(false);
    expect(deriveAttackEffect(PRINTED)).toBeNull();
    expect(resolvedByAnyReader(BODY)).toBe(true);
    expect(deriveAttackEffect(BODY)).toEqual(PROGRAM);
  });

  it("🛑 the CLAUSE alone derives NOTHING — it is a gate, not a program", () => {
    expect(deriveAttackEffect(CLAUSE)).toBeNull();
    expect(resolvedByAnyReader(CLAUSE)).toBe(false);
    // …but the SPLITTER claims it whole, with an empty body (D395's clause-only
    // branch, which is position-free by construction).
    expect(splitAttackGateClause(CLAUSE)).toEqual({ clause: CLAUSE, body: "" });
  });

  it("🛑 THE UNPREFIXED CONTROL (D424): the body alone is what the anchor is about", () => {
    // Without this the two refusals below are green on a build whose anchor matches
    // nothing at all.
    expect(deriveAttackEffect(BODY)).toEqual(PROGRAM);
  });

  it("🛑 THE CARET KILLER, and it KEEPS the leading capital (D539(1a))", () => {
    // A prefix that lowercases or rewrites the body's first word would be refused by
    // the WORD and not by the `^`. This one leaves "Choose" capitalised and intact,
    // so the ONLY thing refusing it is the anchor's own `^`.
    expect(deriveAttackEffect(`Draw a card. ${BODY}`)).toBeNull();
    expect(resolvedByAnyReader(`Draw a card. ${BODY}`)).toBe(false);
  });

  it("🛑 THE TERMINATOR KILLER, and it KEEPS the period (D540(1a))", () => {
    // 🛑 **BOTH KILLERS ARE KEPT BECAUSE THEY REFUSE FOR DIFFERENT REASONS.** The
    // caret one is about the head; this one is about the tail, and it must keep the
    // body's own final period — a suffix glued on with `BODY.slice(0, -1)` would be
    // refused by the MISSING PERIOD and a `$`-less pattern would refuse it too, so
    // that spelling proves nothing about `$`.
    expect(BODY.endsWith(".")).toBe(true);
    expect(deriveAttackEffect(`${BODY} Then, draw a card.`)).toBeNull();
    expect(resolvedByAnyReader(`${BODY} Then, draw a card.`)).toBe(false);
  });

  it("🛑 THE NUMBER IS CAPTURED, not a literal 2 — and it is the number REMOVED", () => {
    expect(deriveAttackEffect(BODY.replace("Choose 2", "Choose 3"))).toEqual([
      { op: "returnBenchedChosen", count: 3 },
    ]);
    expect(deriveAttackEffect(BODY.replace("Choose 2", "Choose 1"))).toEqual([
      { op: "returnBenchedChosen", count: 1 },
    ]);
    // THE FLOOR, printed rather than defensive: "Choose 0" names no pick at all, so
    // the arm declines and the sentence goes to the loud path.
    expect(deriveAttackEffect(BODY.replace("Choose 2", "Choose 0"))).toBeNull();
  });

  it("🛑 THE TWO NEAR MISSES, BOTH DIRECTIONS — the inversion and the counter placement", () => {
    // ① `CHOOSE_KEEP_SHUFFLE_REST` (D537, corpus file line 84): the pick names the
    //    bodies that STAY. Its own doc block already names corpus line 82 as this
    //    exact inversion.
    expect(deriveAttackEffect(KEEP_SENTENCE)).toEqual([{ op: "returnBenchedRest", keep: 3 }]);
    // ② …and the other direction: this anchor does not claim that sentence, and that
    //    is what the arm ORDER would otherwise hide (see the composed cell below).
    // ③ `COUNTER_PUT_ON_CHOSEN_OPPONENTS` — the same opening, a different tail.
    expect(deriveAttackEffect(COUNTER_SENTENCE)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 30, count: 2, source: "attack" },
    ]);
    expect(COUNTER_SENTENCE.startsWith("Choose 2 of your opponent's ")).toBe(true);
  });

  it("🛑 THE 2×2 MATRIX, WITH THE ONE CELL ARM ORDER MASKS NAMED AS COMPOSED (D540)", () => {
    // Arm 42-bis (`CHOOSE_KEEP_SHUFFLE_REST`) runs BEFORE arm 42-ter, so three of
    // the four cells are read directly off `deriveAttackEffect` and the fourth is
    // not. This rung says which, rather than reporting four measurements where it
    // has three.
    //
    // (1) 42-bis's sentence → 42-bis's op. Direct.
    expect(deriveAttackEffect(KEEP_SENTENCE)).toEqual([{ op: "returnBenchedRest", keep: 3 }]);
    // (2) THIS sentence → 42-ter's op. Direct — AND it also settles "does 42-bis
    //     claim this body?" in the NEGATIVE, because 42-bis runs first and did not
    //     return.
    expect(deriveAttackEffect(BODY)).toEqual(PROGRAM);
    // (3) Either sentence with its own tail removed → null. Direct.
    expect(deriveAttackEffect(SHARED_HEAD)).toBeNull();
    // (4) 🛑 **THE MASKED CELL** — *"would `CHOOSE_SHUFFLE_CHOSEN` claim 42-bis's
    //     sentence?"* — cannot be read directly, because 42-bis returns first. It is
    //     reached by COMPOSING two measurements the module DOES expose:
    //       (a) 42-ter's anchor REQUIRES its tail byte for byte — the same head with
    //           a one-word-different tail derives to `null`;
    const WRONG_TAIL = `${SHARED_HEAD} Shuffle those Pokémon and all attached cards into their deck.`;
    expect(deriveAttackEffect(WRONG_TAIL)).toBeNull();
    //       (b) …and 42-bis's sentence does not CONTAIN that tail at all.
    expect(KEEP_SENTENCE.includes(CHOSEN_TAIL)).toBe(false);
    //     (a) ∧ (b) ⟹ the masked cell is `null`. Stated as a composition, not as a
    //     measurement, because that is what it is.
  });

  it("🛑 BOTH `['’]` SLOTS, ONE AT A TIME AND BOTH TOGETHER — the rows that survive otherwise", () => {
    // 🛑 **THE CORPUS PRINTS U+0027 AT BOTH SLOTS TODAY, SO COLLAPSING `['’]` TO `'`
    // LEAVES EVERY BOARD GREEN AND EVERY CENSUS FIGURE STILL.** D540 paid for
    // exactly this at the neighbouring anchor. A rule nothing can see is not a rule
    // (D137 is about the SITE of a spelled apostrophe, not about today's bytes), so
    // each slot gets its own curled board.
    const curl = (s: string, which: 1 | 2 | "both"): string => {
      const parts = s.split("'");
      if (parts.length !== 3) throw new Error(`expected 2 apostrophes, got ${parts.length - 1}`);
      const [a, b, c] = parts as [string, string, string];
      if (which === 1) return `${a}’${b}'${c}`;
      if (which === 2) return `${a}'${b}’${c}`;
      return `${a}’${b}’${c}`;
    };
    expect(deriveAttackEffect(curl(BODY, 1))).toEqual(PROGRAM);
    expect(deriveAttackEffect(curl(BODY, 2))).toEqual(PROGRAM);
    expect(deriveAttackEffect(curl(BODY, "both"))).toEqual(PROGRAM);
    // …and the straight form still works, so the class is a CLASS and not a swap.
    expect(deriveAttackEffect(BODY)).toEqual(PROGRAM);
  });

  it("🛑 THE CONTROL FOR THOSE SLOTS READS THE LIVE CORPUS ROW, not this file's constant", () => {
    // 🛑 **SO A RE-INGEST REDDENS HERE FIRST.** If the catalog is ever re-ingested
    // with curled quotes, the three rungs above stay green (they drive curled
    // strings on purpose) and NOTHING would say the class had become load-bearing.
    // This rung reads the code points off `legalAttackCorpus()` itself.
    const row = legalAttackCorpus()[29]?.[1] ?? "";
    const straight = [...row].flatMap((ch, i) => (ch === "'" ? [i] : []));
    const curled = [...row].flatMap((ch, i) => (ch === "’" ? [i] : []));
    // Three straight apostrophes: two possessives in the BODY and the "can't" inside
    // the trailing clause. Zero curled ones.
    expect(straight).toEqual([25, 108, 190]);
    expect(curled).toEqual([]);
    // …and the three `é` are single real U+00E9, NOT decomposed (the other half of
    // the same measurement).
    expect([...row].flatMap((ch, i) => (ch === "é" ? [i] : []))).toEqual([39, 62, 133]);
    expect(row.includes("́")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE SPLITTER: the trailing branch, the leading population, the tripwire.
// ─────────────────────────────────────────────────────────────────────────────

describe("D541 §2 — the TRAILING branch claims exactly this row, and the leading branch still claims its 14 (🆕 D545 → 16)", () => {
  it("🛑 the trailing branch claims THIS row and hands back the body", () => {
    expect(splitAttackGateClause(PRINTED)).toEqual({ clause: CLAUSE, body: BODY });
    // …and the concatenation really is the printed row, checked against the LIVE
    // corpus rather than against this file's three constants.
    expect(`${BODY} ${CLAUSE}`).toBe(legalAttackCorpus()[29]?.[1]);
  });

  it("🛑 THE SPLIT IS IDEMPOTENT — the body it returns carries no clause of its own", () => {
    expect(splitAttackGateClause(BODY)).toBeNull();
  });

  it("🛑 the split claims 7 sentences / 17 printings (🆕 D545 → 9 / 19), of which the TRAILING branch is 1 / 3", () => {
    const corpus = legalAttackCorpus();
    const gated = corpus.filter(([, t]) => splitAttackGateClause(t) !== null);
    expect(gated).toHaveLength(9);  // (🆕🆕🆕 **D545 +2 sentences / +2 printings — THE TWO PRINTED COST CLAUSES, BUILT AS A PAIR ON THE GATE ARM** — `censusAttackCorpus.ts` **file lines 316 and 324** (leading count column `1` each), *“If this Pokémon has any damage counters on it, this attack can be used for {F}.”* and *“If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrators `d545-alt` / `d545-waive`), claimed WHOLE as clause-only rows six and seven of `ATTACK_GATE_CLAUSES` (`body: ""`, D395's path) mapped to TWO new NON-BLOCKING `AttackTimingGate` members `alternateCostIf` / `costWaivedIf`, read by `attackCostAt` — a GATE move: gate 7/17 → 9/19, residue 44/59 → 42/57, `BUILT.attack` 1673 → 1675, `SPLIT_ATTACK_UNITS` 17 → 19 (READ at `censusAtHead.test.ts:8169`); reader arm 568/1619, raw residue 72/113, registry 10/16, trailing 11/21 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.429.0 → 0.430.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 2 AND THE PRINTING STEP IS 2 — THEY AGREE**, the one case where a number copied from one kind of site into another is right BY ACCIDENT, so every site was measured anyway (D426/D451). THIS SITE: the gate split's sentence count, 7 → 9 (the two new rows are clause-only, so they land in the LEADING partition below, not the trailing one).)
    expect(gated.reduce((sum, [n]) => sum + n, 0)).toBe(19);  // (🆕🆕🆕 **D545 +2 sentences / +2 printings — THE TWO PRINTED COST CLAUSES, BUILT AS A PAIR ON THE GATE ARM** — `censusAttackCorpus.ts` **file lines 316 and 324** (leading count column `1` each), *“If this Pokémon has any damage counters on it, this attack can be used for {F}.”* and *“If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrators `d545-alt` / `d545-waive`), claimed WHOLE as clause-only rows six and seven of `ATTACK_GATE_CLAUSES` (`body: ""`, D395's path) mapped to TWO new NON-BLOCKING `AttackTimingGate` members `alternateCostIf` / `costWaivedIf`, read by `attackCostAt` — a GATE move: gate 7/17 → 9/19, residue 44/59 → 42/57, `BUILT.attack` 1673 → 1675, `SPLIT_ATTACK_UNITS` 17 → 19 (READ at `censusAtHead.test.ts:8169`); reader arm 568/1619, raw residue 72/113, registry 10/16, trailing 11/21 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.429.0 → 0.430.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 2 AND THE PRINTING STEP IS 2 — THEY AGREE**, the one case where a number copied from one kind of site into another is right BY ACCIDENT, so every site was measured anyway (D426/D451). THIS SITE: the gate split's printing count, 17 → 19.)
    // 🆕🆕🆕 D545 — the leading population is now 8 / 16: D545's two clause-only rows are
    // counted on this side (`body === ""`), and the sentence below is D541's claim about
    // D541's own row, kept as history.
    // 🛑 **THE LEADING POPULATION IS UNMOVED AT 14**, which is what says this slice
    // added a POSITION rather than widening the existing one. Partitioned by where
    // the clause sits, driven off the splitter's own answer.
    const trailing = gated.filter(([, t]) => {
      const split = splitAttackGateClause(t);
      return split !== null && split.body !== "" && t.trim().endsWith(split.clause);
    });
    expect(trailing).toHaveLength(1);
    expect(trailing.reduce((sum, [n]) => sum + n, 0)).toBe(3);
    expect(trailing[0]?.[1]).toBe(PRINTED);
    const leading = gated.filter(([, t]) => {
      const split = splitAttackGateClause(t);
      return split !== null && (split.body === "" || t.trim().startsWith(split.clause));
    });
    expect(leading).toHaveLength(8);  // (🆕🆕🆕 **D545 +2 sentences / +2 printings — THE TWO PRINTED COST CLAUSES, BUILT AS A PAIR ON THE GATE ARM** — `censusAttackCorpus.ts` **file lines 316 and 324** (leading count column `1` each), *“If this Pokémon has any damage counters on it, this attack can be used for {F}.”* and *“If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrators `d545-alt` / `d545-waive`), claimed WHOLE as clause-only rows six and seven of `ATTACK_GATE_CLAUSES` (`body: ""`, D395's path) mapped to TWO new NON-BLOCKING `AttackTimingGate` members `alternateCostIf` / `costWaivedIf`, read by `attackCostAt` — a GATE move: gate 7/17 → 9/19, residue 44/59 → 42/57, `BUILT.attack` 1673 → 1675, `SPLIT_ATTACK_UNITS` 17 → 19 (READ at `censusAtHead.test.ts:8169`); reader arm 568/1619, raw residue 72/113, registry 10/16, trailing 11/21 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.429.0 → 0.430.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 2 AND THE PRINTING STEP IS 2 — THEY AGREE**, the one case where a number copied from one kind of site into another is right BY ACCIDENT, so every site was measured anyway (D426/D451). THIS SITE: the LEADING partition (which counts clause-only rows, `body === ""`) 6 → 8 — D541's *"unmoved at 14"* is D541's claim about ITS row and is kept as history; D545 adds two rows to this side.)
    expect(leading.reduce((sum, [n]) => sum + n, 0)).toBe(16);  // (🆕🆕🆕 **D545 +2 sentences / +2 printings — THE TWO PRINTED COST CLAUSES, BUILT AS A PAIR ON THE GATE ARM** — `censusAttackCorpus.ts` **file lines 316 and 324** (leading count column `1` each), *“If this Pokémon has any damage counters on it, this attack can be used for {F}.”* and *“If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrators `d545-alt` / `d545-waive`), claimed WHOLE as clause-only rows six and seven of `ATTACK_GATE_CLAUSES` (`body: ""`, D395's path) mapped to TWO new NON-BLOCKING `AttackTimingGate` members `alternateCostIf` / `costWaivedIf`, read by `attackCostAt` — a GATE move: gate 7/17 → 9/19, residue 44/59 → 42/57, `BUILT.attack` 1673 → 1675, `SPLIT_ATTACK_UNITS` 17 → 19 (READ at `censusAtHead.test.ts:8169`); reader arm 568/1619, raw residue 72/113, registry 10/16, trailing 11/21 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.429.0 → 0.430.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 2 AND THE PRINTING STEP IS 2 — THEY AGREE**, the one case where a number copied from one kind of site into another is right BY ACCIDENT, so every site was measured anyway (D426/D451). THIS SITE: the LEADING partition's printings 14 → 16.)
    // …and the partition is TOTAL, so nothing is counted twice or missed.
    expect(trailing.length + leading.length).toBe(gated.length);
  });

  it("🛑 THE LEADING-AND-TRAILING TRIPWIRE — a string matching at both ends is REFUSED", () => {
    // 🛑 **NOTHING PRINTS BOTH TODAY AND THE DAY ONE DOES IS NOT THE DAY TO GUESS.**
    // A loop that returned at the first hit would hand the caller a `body` still
    // carrying an accounted-for clause. The refusal is `null` — `effects.ts` has ZERO
    // `throw` statements by policy — which routes the printing to the LOUD
    // `ATTACK_EFFECT_SKIPPED` path rather than half-splitting it in silence.
    const LEADING = "If you go second, you can't use this attack during your first turn.";
    expect(splitAttackGateClause(`${LEADING} ${BODY}`)).toEqual({
      clause: LEADING,
      body: BODY,
    });
    // ① the SAME clause at both ends;
    expect(splitAttackGateClause(`${LEADING} ${BODY} ${LEADING}`)).toBeNull();
    // ② …and, the case a per-clause tripwire would miss, TWO DIFFERENT clauses.
    expect(splitAttackGateClause(`${LEADING} ${BODY} ${CLAUSE}`)).toBeNull();
    expect(splitAttackGateClause(`${CLAUSE} ${BODY} ${LEADING}`)).toBeNull();
    // ③ THE ATTRIBUTION CONTROL: each half alone still splits, so the three `null`s
    //    above are about the COMBINATION and not about a broken splitter.
    expect(splitAttackGateClause(`${BODY} ${CLAUSE}`)).toEqual({ clause: CLAUSE, body: BODY });
    // ④ 🆕 **THE SPACE IS PART OF THE PATTERN AT THIS END TOO** — the branch tests
    //    ``endsWith(` ${clause}`)`` and not `endsWith(clause)`. Glued straight onto the
    //    previous sentence's period there is NO sentence boundary, so this is a substring
    //    match and not a clause match, and the closed literal list would stop being a
    //    CLAUSE matcher. `rolloutGate.test.ts` drives the same property from its own end;
    //    it is driven HERE too because this is the row the branch was added for.
    expect(splitAttackGateClause(`${BODY}${CLAUSE}`)).toBeNull();
  });

  it("🛑 …and no printed string in the corpus trips it — measured, not assumed", () => {
    // The tripwire is a refusal, so it could silently remove a printing from the
    // split population. This asserts it costs nothing on the catalog today.
    for (const [, text] of legalAttackCorpus()) {
      const split = splitAttackGateClause(text);
      if (split === null) continue;
      expect(split.body.includes(split.clause), text).toBe(false);
    }
  });

  it("🛑 DISJOINTNESS AGAINST THE OTHER TWO STRIPPERS, DRIVEN AND NOT QUOTED", () => {
    // 🛑 **RE-DERIVED FOR THE TRAILING CASE RATHER THAN COPIED FROM THE LEADING
    // ONE.** The leading case's argument was "the two strippers look at OPPOSITE
    // ENDS", which is precisely the property a trailing branch destroys:
    // `splitAttackRequirementClause` reads a LEADING does-nothing sentence and this
    // branch reads a TRAILING gate clause, so for the first time the two CAN both
    // fire on one printing.
    const corpus = legalAttackCorpus();
    const gate = corpus.filter(([, t]) => splitAttackGateClause(t) !== null);
    const req = corpus.filter(([, t]) => splitAttackRequirementClause(t) !== null);
    const trail = corpus.filter(([, t]) => splitAttackTrailingClause(t) !== null);
    expect(req).toHaveLength(1);
    expect(req.reduce((sum, [n]) => sum + n, 0)).toBe(2);
    // 🆕🆕🆕 D574 — 11/21 → 12/22: Alakazam `sv06-082` "Strange Hacking" (file line 686) composes on the
    // TRAILING seam now (its tail is claimed by `COUNTER_MOVE_OPPONENT_ANY_WAY`).
    expect(trail).toHaveLength(12);
    expect(trail.reduce((sum, [n]) => sum + n, 0)).toBe(22);
    const both = (
      a: readonly (readonly [number, string])[],
      b: readonly (readonly [number, string])[],
    ) => a.filter(([, t]) => b.some(([, u]) => u === t));
    expect(both(gate, req)).toHaveLength(0);
    expect(both(gate, trail)).toHaveLength(0);
    // THE ATTRIBUTION CONTROL: the three sets are non-empty, so three zeroes above
    // are not three empty filters.
    expect(gate.length * req.length * trail.length).toBeGreaterThan(0);
  });

  it("🛑 §1's 16-PARTITION IS UNMOVED BY CONSTRUCTION — CHECKED, not assumed (D540)", () => {
    // This row does not open with `If `, so it cannot be in the population D364's
    // 10 + 6 partition is defined over. **Checked rather than assumed**, which is
    // exactly the seventh-site lesson D540 paid for.
    expect(PRINTED.startsWith("If ")).toBe(false);
    const ifOpen = legalAttackCorpus().filter(([, t]) => t.startsWith("If ") && t.includes(". "));
    expect(ifOpen).toHaveLength(8);
    expect(ifOpen.reduce((sum, [n]) => sum + n, 0)).toBe(16);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE CENSUS, driven off the module and never retyped.
// ─────────────────────────────────────────────────────────────────────────────

describe("D541 §3 — the census arithmetic, and the two figures that must NOT move", () => {
  const corpus = () => legalAttackCorpus();
  const units = (r: readonly (readonly [number, string])[]) => r.reduce((sum, [n]) => sum + n, 0);

  it("🛑 the GATE arm steps 6/14 → 7/17 (🆕 D545 → 9/19) and this row is IN it", () => {
    const gate = corpus().filter(([, t]) => {
      const split = splitAttackGateClause(t);
      return split !== null && (split.body === "" || resolvedByAnyReader(split.body));
    });
    expect(gate).toHaveLength(9);  // (🆕🆕🆕 **D545 +2 sentences / +2 printings — THE TWO PRINTED COST CLAUSES, BUILT AS A PAIR ON THE GATE ARM** — `censusAttackCorpus.ts` **file lines 316 and 324** (leading count column `1` each), *“If this Pokémon has any damage counters on it, this attack can be used for {F}.”* and *“If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrators `d545-alt` / `d545-waive`), claimed WHOLE as clause-only rows six and seven of `ATTACK_GATE_CLAUSES` (`body: ""`, D395's path) mapped to TWO new NON-BLOCKING `AttackTimingGate` members `alternateCostIf` / `costWaivedIf`, read by `attackCostAt` — a GATE move: gate 7/17 → 9/19, residue 44/59 → 42/57, `BUILT.attack` 1673 → 1675, `SPLIT_ATTACK_UNITS` 17 → 19 (READ at `censusAtHead.test.ts:8169`); reader arm 568/1619, raw residue 72/113, registry 10/16, trailing 11/21 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.429.0 → 0.430.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 2 AND THE PRINTING STEP IS 2 — THEY AGREE**, the one case where a number copied from one kind of site into another is right BY ACCIDENT, so every site was measured anyway (D426/D451). THIS SITE: the GATE arm's sentences 7 → 9.)
    expect(units(gate)).toBe(19);  // (🆕🆕🆕 **D545 +2 sentences / +2 printings — THE TWO PRINTED COST CLAUSES, BUILT AS A PAIR ON THE GATE ARM** — `censusAttackCorpus.ts` **file lines 316 and 324** (leading count column `1` each), *“If this Pokémon has any damage counters on it, this attack can be used for {F}.”* and *“If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrators `d545-alt` / `d545-waive`), claimed WHOLE as clause-only rows six and seven of `ATTACK_GATE_CLAUSES` (`body: ""`, D395's path) mapped to TWO new NON-BLOCKING `AttackTimingGate` members `alternateCostIf` / `costWaivedIf`, read by `attackCostAt` — a GATE move: gate 7/17 → 9/19, residue 44/59 → 42/57, `BUILT.attack` 1673 → 1675, `SPLIT_ATTACK_UNITS` 17 → 19 (READ at `censusAtHead.test.ts:8169`); reader arm 568/1619, raw residue 72/113, registry 10/16, trailing 11/21 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.429.0 → 0.430.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 2 AND THE PRINTING STEP IS 2 — THEY AGREE**, the one case where a number copied from one kind of site into another is right BY ACCIDENT, so every site was measured anyway (D426/D451). THIS SITE: the GATE arm's printings 17 → 19.)
    expect(gate.some(([, t]) => t === PRINTED)).toBe(true);
  });

  it("🛑 D541's ROW moved NEITHER the reader arm nor the raw residue — the case for the split route", () => {
    // 🛑 **THIS IS THE RUNG THAT PRICES THE REJECTED ALTERNATIVE.** Anchoring the
    // whole printed string in `deriveAttackEffect` would have moved BOTH of these,
    // ~~and with them the 25 files pinning `[565, 1614]` and the 7 pinning
    // `toBe(1614)`. The split route leaves all 32 of them standing.~~
    //
    // 🆕🆕🆕 **D542 — THE FIGURES MOVED AND THE CLAIM DID NOT, AND THE TITLE NOW
    // SAYS WHOSE ROW IT IS ABOUT.** The old title read *"the READER arm and the RAW
    // residue are UNMOVED"* as if it were a standing property of the census. It was
    // never that: it is a statement about **D541's row**, which leaves through the
    // GATE-SPLIT summand. D542's row is a whole-sentence reader claim, so it moves
    // the reader arm 565/1614 → 566/1615 and the raw residue 75/118 → 74/117 exactly
    // as the rejected alternative would have — and that is not a reversal, it is a
    // DIFFERENT ROW leaving by a different door. ⚠️ **The counts in the struck
    // sentence went stale in the same breath** (the 25/7/32 file tallies), which is
    // why they are struck rather than re-counted: a tally of pin sites is a
    // measurement of a tree, not an argument, and the argument is the SUMMAND.
    // What survives, and is what the rung actually measures: D541's row is credited
    // to the gate-split summand, so the reader/raw figures move **only** by the
    // amount LATER slices put through the reader door.
    const reader = corpus().filter(([, t]) => resolvedByAnyReader(t));
    expect([reader.length, units(reader)]).toEqual([599, 1662]);  // (🆕🆕🆕 **D575 +6 sentences / +6 printings — THE MRV-38 ATTACK SLICE** — `deriveAttackEffect`'s six new whole-sentence anchors claim `censusAttackCorpus.ts` file lines 177 (Hypno "Daydream"), 181 (Miraidon "C.O.D.E.: Protect"), 182 (Iron Moth "Anachronism Repulsor"), 346 (N's Sigilyph "Victory Symbol"), 394 (Team Rocket's Blipbug "Searching Eyes") and 690 (Glimmora "Corrosive Shards", the compound claimed WHOLE) — one printing each, so the sentence and printing steps AGREE. A READER move.) (🆕🆕🆕 **D574 +3 sentences / +5 printings — THE COPY-FAMILY REMAINDER + SABLEYE** — `deriveAttackCopy`'s two RESOLVE-TIME anchors claim `censusAttackCorpus.ts` file lines 434 and 131 WHOLE (Haughty Order ×3, Seek Inspiration) and `deriveAttackEffect`'s new anchor claims file line 649 (Sableye "Damage Collection"). Alakazam (686) composes through the TRAILING seam and Malamar (489) is a REGISTRY row — neither is a reader move. A READER move; the sentence step (3) and the printing step (5) DISAGREE, so each site was classified by its unit.) (🆕🆕🆕 **D573 +4 sentences / +9 printings — THE COPY-ATTACK SUBSTITUTION** — `deriveAttackCopy`, the FOURTEENTH reader, claims `censusAttackCorpus.ts` file lines 77, 78, 80 and 245 WHOLE: Night Joker ×4, Foul Play ×2 + Metronome, Gemstone Mimicry, Try to Imitate. A READER move; the sentence step (4) and the printing step (9) DISAGREE, so each site was classified by its unit.) (🆕🆕🆕 **D569 +4 sentences / +6 printings — THE PARADOX BANNER READERS** — Koraidon `sv05-119`/`svp-091` "Primordial Beatdown" (`IN_PLAY_BODY_NOUNS` "Ancient Pokémon"), Roaring Moon `sv05-109`/`sv08.5-065` "Vengeance Fletching" (`DISCARD_PILE_NOUNS` "Ancient card"), Iron Valiant `sv05-080` "Majestic Sword" and Slither Wing `sv06.5-026` "Iron Smasher" (two literal `CONDITIONAL_DAMAGE_CLAUSES` rows), all over `banners.ts`' widened table (582/1636 → 586/1642)) (🆕🆕🆕 **D568 +2 sentences / +2 printings — THE TWO TERA CLAUSES, NOW THAT THE BANNER HAS A WRITER** — Ho-Oh `sv08-019` "Shining Blaze" (*"If you have any Tera Pokémon on your Bench, this attack does 100 more damage."*) and Regigigas `sv08.5-086` "Jewel Breaker" (*"If your opponent's Active Pokémon is a Tera Pokémon, this attack does 230 more damage."*), one legal printing each, two literal `CONDITIONAL_DAMAGE_CLAUSES` rows over `banners.ts` (580/1634 → 582/1636)) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: reader arm 578/1632 → 580/1634.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: reader arm 577/1631 → 578/1632.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: reader arm 573/1627 → 577/1631.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: reader arm 572/1625 → 573/1627.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: reader arm 570/1621 → 572/1625.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: reader arm 568/1619 → 570/1621.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: reader arm 567/1617 → 568/1619.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: reader arm 566/1615 → 567/1617.)
    const rawUnbuilt = corpus().filter(([, t]) => !resolvedByAnyReader(t));
    expect([rawUnbuilt.length, units(rawUnbuilt)]).toEqual([41, 70]);  // (🆕🆕🆕 **D575 −6 sentences / −6 printings — THE MRV-38 ATTACK SLICE** leave the raw residue: file lines 177, 181, 182, 346, 394 and 690, each claimed WHOLE by a new `deriveAttackEffect` anchor (Glimmora's compound included, so it does not stay raw the way D574's Alakazam did) — measured 41/70, as the D575 judge predicted.) (🆕🆕🆕 **D574 −3 sentences / −5 printings — THE COPY-FAMILY REMAINDER + SABLEYE** leave the raw residue (file lines 434, 131 and 649, claimed whole by readers); Alakazam (686, composed on the trailing seam) and Malamar (489, a registry row) STAY in the raw reader-only residue — measured 47/76 where the D574 judge predicted 46/75.) (🆕🆕🆕 **D573 −4 sentences / −9 printings — THE COPY-ATTACK SUBSTITUTION** leaves the residue: `deriveAttackCopy` claims file lines 77, 78, 80 and 245 whole; Haughty Order and Seek Inspiration stay.) (🆕🆕🆕 **D569 −4 sentences / −6 printings — THE PARADOX BANNER READERS LEFT THE RAW RESIDUE** — Koraidon ×2, Roaring Moon ×2, Iron Valiant, Slither Wing; the reader rung's +4/+6 seen from the other side (58/96 → 54/90)) (🆕🆕🆕 **D568 −2 sentences / −2 printings — THE TWO TERA CLAUSES LEFT THE RAW RESIDUE** — Ho-Oh `sv08-019` and Regigigas `sv08.5-086`, the reader rung's +2/+2 seen from the other side (60/98 → 58/96)) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: raw reader-only residue 62/100 → 60/98.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: raw reader-only residue 63/101 → 62/100.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: raw reader-only residue 67/105 → 63/101.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: raw reader-only residue 68/107 → 67/105.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: raw reader-only residue 70/111 → 68/107.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: raw reader-only residue 72/113 → 70/111.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: raw reader-only residue 73/115 → 72/113.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: raw reader-only residue 74/117 → 73/115.)
    // 🛑 **AND THE CLAIM ITSELF, DRIVEN RATHER THAN LEFT IN THE TITLE**: D541's own
    // printed row is STILL not in the reader arm — it is claimed by the gate split,
    // which is the whole of what this rung was ever for.
    expect(resolvedByAnyReader(PRINTED)).toBe(false);
    expect(splitAttackGateClause(PRINTED)).not.toBeNull();
  });

  it("🛑 the RESIDUE steps 48/67 → 47/64 → 🆕 46/63, and `BUILT.attack` 1665 → 1668 → 🆕 1669 (🆕 D545: at this head 42/57 and 1675 — the chain in this title was last stepped at D541)", () => {
    // The residue is the raw reader refusal MINUS the three summands that claim
    // printings another way. The REGISTRY summand is read off the same predicate
    // `censusAtHead.test.ts` uses, so this figure is derived and not recorded.
    const residue = corpus().filter(([, text]) => {
      if (!resolvedByAnyReader(text)) {
        const gate = splitAttackGateClause(text);
        if (gate !== null && (gate.body === "" || resolvedByAnyReader(gate.body))) return false;
        return splitAttackTrailingClause(text) === null;
      }
      return false;
    });
    // ⚠️ **THIS FILE DOES NOT REBUILD `REGISTRY_ATTACK_SENTENCES`** — that list lives
    // in `censusAtHead.test.ts` and rebuilding it here would be a second copy of the
    // thing D417/D418 spent two slices de-duplicating. So the figure asserted here is
    // the residue BEFORE the registry subtraction (~~57/80~~ ~~56/79 at D542~~ ~~55/77 at D543~~ ~~54/75 at D544~~ ~~52/73 at D545~~ ~~50/71 at D546~~ 🆕 **48/67 at D547**), and
    // the ~~47/64~~ ~~46/63~~ ~~45/61 at D543~~ ~~44/59 at D544~~ ~~42/57 at D545~~ ~~40/55 at D546~~ 🆕 **38/51 at D547** that follows from it is pinned where the partition lives.
    expect(residue).toHaveLength(20);  // (🆕🆕🆕 **D575 −6 sentences / −6 printings — THE MRV-38 ATTACK SLICE** leaves this pre-registry residue: file lines 177, 181, 182, 346, 394 and 690 are each claimed WHOLE by a new `deriveAttackEffect` anchor, one printing each.) (🆕🆕🆕 **D574 −4 sentences / −6 printings — THE COPY-FAMILY REMAINDER + THE BUNDLE A RIDER** leaves this pre-registry residue: file lines 434, 131 and 649 are claimed whole by readers and 686 (Alakazam) composes on the trailing seam; Malamar (489) is subtracted only by the REGISTRY, which is after this figure, so it stays.) (🆕🆕🆕 **D573 −4 sentences / −9 printings — THE COPY-ATTACK SUBSTITUTION** leaves the residue: `deriveAttackCopy` claims file lines 77, 78, 80 and 245 whole; Haughty Order and Seek Inspiration stay.) (🆕🆕🆕 **D569 −4 sentences — THE PARADOX BANNER READERS** leave the residue (Koraidon, Roaring Moon, Iron Valiant, Slither Wing — two noun rows and two literal clause rows over `banners.ts`).) (🆕🆕🆕 **D568 −2 sentences — THE TWO TERA CLAUSES** leave the residue through two literal rows (Ho-Oh `sv08-019`, Regigigas `sv08.5-086`).) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: the residue BEFORE the registry subtraction, sentences 42 → 40.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: the residue BEFORE the registry subtraction, sentences 43 → 42.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: the residue BEFORE the registry subtraction, sentences 47 → 43.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: the residue BEFORE the registry subtraction, sentences 48 → 47.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: the residue BEFORE the registry subtraction, sentences 50 → 48.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: the residue BEFORE the registry subtraction, sentences 52 → 50.)  // (🆕🆕🆕 **D545 +2 sentences / +2 printings — THE TWO PRINTED COST CLAUSES, BUILT AS A PAIR ON THE GATE ARM** — `censusAttackCorpus.ts` **file lines 316 and 324** (leading count column `1` each), *“If this Pokémon has any damage counters on it, this attack can be used for {F}.”* and *“If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrators `d545-alt` / `d545-waive`), claimed WHOLE as clause-only rows six and seven of `ATTACK_GATE_CLAUSES` (`body: ""`, D395's path) mapped to TWO new NON-BLOCKING `AttackTimingGate` members `alternateCostIf` / `costWaivedIf`, read by `attackCostAt` — a GATE move: gate 7/17 → 9/19, residue 44/59 → 42/57, `BUILT.attack` 1673 → 1675, `SPLIT_ATTACK_UNITS` 17 → 19 (READ at `censusAtHead.test.ts:8169`); reader arm 568/1619, raw residue 72/113, registry 10/16, trailing 11/21 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.429.0 → 0.430.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 2 AND THE PRINTING STEP IS 2 — THEY AGREE**, the one case where a number copied from one kind of site into another is right BY ACCIDENT, so every site was measured anyway (D426/D451). THIS SITE: the residue BEFORE the registry subtraction, sentences 54 → 52 (both rows leave through the GATE summand).)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the residue BEFORE the registry subtraction, sentences 55 → 54.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the residue BEFORE the registry subtraction, sentences 56 → 55.)
    expect(units(residue)).toBe(29);  // (🆕🆕🆕 **D575 −6 sentences / −6 printings — THE MRV-38 ATTACK SLICE** leaves this pre-registry residue: file lines 177, 181, 182, 346, 394 and 690 are each claimed WHOLE by a new `deriveAttackEffect` anchor, one printing each.) (🆕🆕🆕 **D574 −4 sentences / −6 printings — THE COPY-FAMILY REMAINDER + THE BUNDLE A RIDER** leaves this pre-registry residue: file lines 434 (×3), 131, 649 and 686 leave; Malamar (489) stays until the registry subtraction.) (🆕🆕🆕 **D573 −4 sentences / −9 printings — THE COPY-ATTACK SUBSTITUTION** leaves the residue: `deriveAttackCopy` claims file lines 77, 78, 80 and 245 whole; Haughty Order and Seek Inspiration stay.) (🆕🆕🆕 **D569 −4 sentences / −6 printings — THE PARADOX BANNER READERS** leave the residue.) (🆕🆕🆕 **D568 −2 sentences / −2 printings — THE TWO TERA CLAUSES** leave the residue through two literal rows (Ho-Oh `sv08-019`, Regigigas `sv08.5-086`).) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: the residue BEFORE the registry subtraction, printings 60 → 58.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: the residue BEFORE the registry subtraction, printings 61 → 60.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: the residue BEFORE the registry subtraction, printings 65 → 61.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: the residue BEFORE the registry subtraction, printings 67 → 65.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: the residue BEFORE the registry subtraction, printings 71 → 67.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: the residue BEFORE the registry subtraction, printings 73 → 71.)  // (🆕🆕🆕 **D545 +2 sentences / +2 printings — THE TWO PRINTED COST CLAUSES, BUILT AS A PAIR ON THE GATE ARM** — `censusAttackCorpus.ts` **file lines 316 and 324** (leading count column `1` each), *“If this Pokémon has any damage counters on it, this attack can be used for {F}.”* and *“If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrators `d545-alt` / `d545-waive`), claimed WHOLE as clause-only rows six and seven of `ATTACK_GATE_CLAUSES` (`body: ""`, D395's path) mapped to TWO new NON-BLOCKING `AttackTimingGate` members `alternateCostIf` / `costWaivedIf`, read by `attackCostAt` — a GATE move: gate 7/17 → 9/19, residue 44/59 → 42/57, `BUILT.attack` 1673 → 1675, `SPLIT_ATTACK_UNITS` 17 → 19 (READ at `censusAtHead.test.ts:8169`); reader arm 568/1619, raw residue 72/113, registry 10/16, trailing 11/21 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.429.0 → 0.430.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 2 AND THE PRINTING STEP IS 2 — THEY AGREE**, the one case where a number copied from one kind of site into another is right BY ACCIDENT, so every site was measured anyway (D426/D451). THIS SITE: the residue BEFORE the registry subtraction, printings 75 → 73.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the residue BEFORE the registry subtraction, printings 77 → 75.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the residue BEFORE the registry subtraction, printings 79 → 77.)
    // …and the registry summand, which is the difference, is the 10/16 this slice
    // does not touch: ~~57 − 10 = 47 and 80 − 16 = 64~~ ~~56 − 10 = 46 and 79 − 16 = 63 at D542~~
    // ~~55 − 10 = 45 and 77 − 16 = 61 at D543~~ ~~54 − 10 = 44 and 75 − 16 = 59 at D544~~ ~~52 − 10 = 42 and 73 − 16 = 57 at D545~~ 🆕 **50 − 10 = 40 and 71 − 16 = 55 at D546**. 🛑 **BOTH PROSE SPELLINGS ARE STEPPED IN THE
    // SAME PASS AS THE ASSERTIONS THEY DESCRIBE** — that is exactly what the paragraph below
    // says was missed at D542, and it is a pin the runner never reports.
    // ⚠️ **THIS COMMENT WAS MISSED BY D542's OWN RE-POINT AND CAUGHT IN REVIEW.** The
    // block three lines ABOVE struck the same arithmetic to 56/79 and 46/63 in this
    // same slice; this SECOND spelling of it, sitting directly on top of the two
    // assertions it describes, was stepped in neither pass. **TWO SPELLINGS OF ONE
    // MEASUREMENT IS THE DEFECT** — D426's rule is that the figure travels with the
    // EXPRESSION, and a prose copy of an assertion is a pin the runner never reports
    // (D539's silently-no-opping helper, arriving as prose rather than as code).
    // 🆕🆕🆕 D568 — the REGISTRY summand moves this slice (it stood at 10/16 through this rung's life):
    // Terapagos `sv08-161` "Prism Charge" is a hand-written registry ATTACK (1 sentence / 1
    // printing), so the subtraction is 11/17 now, not 10/16 — and the two Tera clauses left the
    // residue through the readers (−2/−2). 38 − 11 = 27 and 56 − 17 = 39.
    // 🆕🆕🆕 D569 — the REGISTRY summand moves again: FOUR hand-written registry ATTACKS on SIX
    // printings (Miraidon ×2 "Peak Acceleration", Great Tusk ×2 "Land Collapse", Scream Tail
    // "Supportive Singing", Flutter Mane "Perplexing Transfer"), so the subtraction is 15/23 now —
    // and the four Paradox reader sentences left the residue (−4/−6). 34 − 15 = 19 and 50 − 23 = 27.
    expect(residue.length - 16).toBe(4);  // (🆕🆕🆕 **D575 −6 sentences** — the MRV-38 attack slice's six rows (file lines 177, 181, 182, 346, 394, 690) leave the residue through the readers (26 → 20); the REGISTRY subtrahend (16) is unmoved: 20 − 16 = **4**.) (🆕🆕🆕 **D574 −4 sentences and +1 on the subtrahend** — Haughty Order, Seek Inspiration and Sableye leave the residue through the readers and Alakazam through the trailing seam (30 → 26); Malamar stays in this pre-registry residue and moves the REGISTRY subtrahend instead (15 → 16): 26 − 16 = **10**.) (🆕🆕🆕 **D573 −4 sentences** — the copy-attack substitution's four sentences leave the residue; the registry summand (15) is unmoved: 30 − 15 = **15**.) (🆕🆕🆕 **D569 −8 sentences** — the four Paradox reader sentences leave the residue, and four registry attack sentences join the registry summand (11 → 15).) (🆕🆕🆕 **D568 −3 sentences** — the two Tera clauses leave the residue, and Prism Charge joins the registry summand (10 → 11).) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: the residue after the registry subtraction, SENTENCES 32 → 30.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: the residue after the registry subtraction, SENTENCES 33 → 32.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: the residue after the registry subtraction, SENTENCES 37 → 33.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: the residue after the registry subtraction, SENTENCES 38 → 37.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: the residue after the registry subtraction, SENTENCES 40 → 38.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: the residue after the registry subtraction, SENTENCES 42 → 40.)  // (🆕🆕🆕 **D545 +2 sentences / +2 printings — THE TWO PRINTED COST CLAUSES, BUILT AS A PAIR ON THE GATE ARM** — `censusAttackCorpus.ts` **file lines 316 and 324** (leading count column `1` each), *“If this Pokémon has any damage counters on it, this attack can be used for {F}.”* and *“If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrators `d545-alt` / `d545-waive`), claimed WHOLE as clause-only rows six and seven of `ATTACK_GATE_CLAUSES` (`body: ""`, D395's path) mapped to TWO new NON-BLOCKING `AttackTimingGate` members `alternateCostIf` / `costWaivedIf`, read by `attackCostAt` — a GATE move: gate 7/17 → 9/19, residue 44/59 → 42/57, `BUILT.attack` 1673 → 1675, `SPLIT_ATTACK_UNITS` 17 → 19 (READ at `censusAtHead.test.ts:8169`); reader arm 568/1619, raw residue 72/113, registry 10/16, trailing 11/21 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.429.0 → 0.430.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 2 AND THE PRINTING STEP IS 2 — THEY AGREE**, the one case where a number copied from one kind of site into another is right BY ACCIDENT, so every site was measured anyway (D426/D451). THIS SITE: the residue AFTER the registry subtraction, sentences 44 → 42 (a flat pin on `residue.length - 10`, where 10 is the registry summand, not a front term).)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the residue after the registry subtraction, SENTENCES 45 → 44.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the residue after the registry subtraction, SENTENCES 46 → 45.)
    expect(units(residue) - 24).toBe(5);  // (🆕🆕🆕 **D575 −6 printings** — the six rows leave the residue (35 → 29); the REGISTRY subtrahend (24) is unmoved: 29 − 24 = **5**.) (🆕🆕🆕 **D574 −6 printings and +1 on the subtrahend** — Haughty Order ×3, Seek Inspiration, Sableye and Alakazam leave the residue (41 → 35); Malamar moves the REGISTRY subtrahend (23 → 24): 35 − 24 = **11**.) (🆕🆕🆕 **D573 −9 printings** — the copy-attack substitution's four sentences (9 printings) leave the residue; the registry summand (23) is unmoved: 41 − 23 = **18**.) (🆕🆕🆕 **D569 −12 printings** — the reader sentences leave the residue (−6), and six registry attack printings join the registry summand (17 → 23).) (🆕🆕🆕 **D568 −3 printings** — the two Tera clauses leave the residue (−2), and Prism Charge joins the registry summand (16 → 17).) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: the residue after the registry subtraction, PRINTINGS 44 → 42.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: the residue after the registry subtraction, PRINTINGS 45 → 44.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: the residue after the registry subtraction, PRINTINGS 49 → 45.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: the residue after the registry subtraction, PRINTINGS 51 → 49.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: the residue after the registry subtraction, PRINTINGS 55 → 51.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: the residue after the registry subtraction, PRINTINGS 57 → 55.)  // (🆕🆕🆕 **D545 +2 sentences / +2 printings — THE TWO PRINTED COST CLAUSES, BUILT AS A PAIR ON THE GATE ARM** — `censusAttackCorpus.ts` **file lines 316 and 324** (leading count column `1` each), *“If this Pokémon has any damage counters on it, this attack can be used for {F}.”* and *“If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrators `d545-alt` / `d545-waive`), claimed WHOLE as clause-only rows six and seven of `ATTACK_GATE_CLAUSES` (`body: ""`, D395's path) mapped to TWO new NON-BLOCKING `AttackTimingGate` members `alternateCostIf` / `costWaivedIf`, read by `attackCostAt` — a GATE move: gate 7/17 → 9/19, residue 44/59 → 42/57, `BUILT.attack` 1673 → 1675, `SPLIT_ATTACK_UNITS` 17 → 19 (READ at `censusAtHead.test.ts:8169`); reader arm 568/1619, raw residue 72/113, registry 10/16, trailing 11/21 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.429.0 → 0.430.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 2 AND THE PRINTING STEP IS 2 — THEY AGREE**, the one case where a number copied from one kind of site into another is right BY ACCIDENT, so every site was measured anyway (D426/D451). THIS SITE: the residue AFTER the registry subtraction, printings 59 → 57.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the residue after the registry subtraction, PRINTINGS 61 → 59.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the residue after the registry subtraction, PRINTINGS 63 → 61.)
    // `BUILT.attack` is the complement of the residue's PRINTINGS over 1,732.
    expect(1732 - (units(residue) - 24)).toBe(1727);  // (🆕🆕🆕 **D575 +6** — the six READER rows leave the residue (6 printings), the registry subtrahend unmoved: 1,721 → **1,727**.) (🆕🆕🆕 **D574 +7** — Haughty Order ×3, Seek Inspiration, Sableye and Alakazam leave the residue (6 printings) and Malamar moves the registry subtrahend 23 → 24 (1): 1,714 → **1,721**.) (🆕🆕🆕 **D573 +9** — the copy-attack substitution (4 reader sentences, 9 printings) leaves the residue; the registry subtrahend (23) is this rung's own D569 constant and is unmoved: 1,705 → **1,714**.) (🆕🆕🆕 **D569 +12** — `BUILT.attack` 1,693 → 1,705: the four Paradox reader sentences (+6 printings) and the four registry attacks (+6 printings, 17 → 23).) (🆕🆕🆕 **D568 +3** — `BUILT.attack` 1,690 → 1,693: the two Tera clauses (reader) and Prism Charge (registry, 16 → 17).) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: `BUILT.attack` as the complement of the residue's PRINTINGS over 1688 → 1690.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: `BUILT.attack` as the complement of the residue's PRINTINGS over 1687 → 1688.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: `BUILT.attack` as the complement of the residue's PRINTINGS over 1683 → 1687.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: `BUILT.attack` as the complement of the residue's PRINTINGS over 1681 → 1683.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: `BUILT.attack` as the complement of the residue's PRINTINGS over 1,732: 1677 → 1681 (the PRINTINGS step, 4).)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: `BUILT.attack` as the complement of the residue's PRINTINGS over 1,732: 1675 → 1677.)  // (🆕🆕🆕 **D545 +2 sentences / +2 printings — THE TWO PRINTED COST CLAUSES, BUILT AS A PAIR ON THE GATE ARM** — `censusAttackCorpus.ts` **file lines 316 and 324** (leading count column `1` each), *“If this Pokémon has any damage counters on it, this attack can be used for {F}.”* and *“If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrators `d545-alt` / `d545-waive`), claimed WHOLE as clause-only rows six and seven of `ATTACK_GATE_CLAUSES` (`body: ""`, D395's path) mapped to TWO new NON-BLOCKING `AttackTimingGate` members `alternateCostIf` / `costWaivedIf`, read by `attackCostAt` — a GATE move: gate 7/17 → 9/19, residue 44/59 → 42/57, `BUILT.attack` 1673 → 1675, `SPLIT_ATTACK_UNITS` 17 → 19 (READ at `censusAtHead.test.ts:8169`); reader arm 568/1619, raw residue 72/113, registry 10/16, trailing 11/21 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.429.0 → 0.430.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 2 AND THE PRINTING STEP IS 2 — THEY AGREE**, the one case where a number copied from one kind of site into another is right BY ACCIDENT, so every site was measured anyway (D426/D451). THIS SITE: `BUILT.attack` as the complement over 1,732, 1673 → 1675.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: `BUILT.attack` as the complement of the residue's PRINTINGS over 1,732: 1671 → 1673.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: `BUILT.attack` as the complement of the residue's PRINTINGS over 1,732: 1669 → 1671.)
  });

  it("🛑 the TRAILING-COMPOUND summand is UNMOVED at 11/21", () => {
    const trail = corpus().filter(([, t]) => splitAttackTrailingClause(t) !== null);
    expect([trail.length, units(trail)]).toEqual([12, 22]);  // (🆕🆕🆕 **D574 +1 sentence / +1 printing on the TRAILING summand** — Alakazam `sv06-082` "Strange Hacking" (file line 686): its head (*"…is now Confused."*) was claimed already and its tail is claimed now by `COUNTER_MOVE_OPPONENT_ANY_WAY`, so `splitAttackTrailingClause` composes it.)
  });

  it("🛑 the POPULATION is unmoved at 640 / 1,732 — nothing was added to the corpus", () => {
    expect([corpus().length, units(corpus())]).toEqual([640, 1732]);
    // 🛑 **AND THE CATALOG FILE IS ABSENT FROM THIS SLICE'S DIFF ENTIRELY** (D538).
    // Checked by AUDIT in the close-out rather than by this rung — a green run cannot
    // see a corpus edit that is internally consistent. What this rung pins is that
    // the row is where it was.
    expect(raw("/censusAttackCorpus.ts")).toContain(`3 ${PRINTED}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE PICK ON A BOARD. The section `D541-apply-choice-falls-to-default`
//      exists for: it drives the PARKED path and asserts the VICTIM's board.
// ─────────────────────────────────────────────────────────────────────────────

describe("D541 §4 — the answer names the bodies that LEAVE, and they reach the victim's deck", () => {
  it("🛑 the park asks for EXACTLY 2, is NOT declinable, and offers the opponent's whole Bench", () => {
    const { state } = attack(board(SEED, [B1, B2, B3, B4]));
    const prompt = parkedPrompt(state);
    expect(prompt.min).toBe(2);
    expect(prompt.max).toBe(2);
    expect(prompt.declinable).toBe(false);
    expect(prompt.candidates).toHaveLength(4);
    expect(prompt.candidates.every((c) => c.seat === "p2" && c.spot.spot === "bench")).toBe(true);
    expect(prompt.note).toBe(NOTE);
    // NO `decider`: the CONTROLLER answers a pick on the other board (§9.4).
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(state.phase.seat).toBe("p1");
  });

  it("🛑 BOTH bodies and ALL their attached cards reach the VICTIM'S deck — never the actor's", () => {
    let start = board(SEED, [B1, B2, B3]);
    start = attachToBench(start, "p2", 0, ENERGY, "energy");
    start = attachToBench(start, "p2", 0, TOOL, "tools");
    start = underBench(start, "p2", 1, STAGE1);
    const parked = attack(start).state;
    const leaving = [0, 1].flatMap((i) => stackUids(bodyAt(parked, "p2", i)));
    expect(leaving).toHaveLength(5); // 2 bodies + 1 Energy + 1 Tool + 1 buried card
    const p1Library = libraryOf(parked, "p1");
    const { state } = answer(parked, [benchRef(0), benchRef(1)]);
    for (const uid of leaving) expect(libraryOf(state, "p2"), uid).toContain(uid);
    // …and NOTHING reached the actor's own library or anyone's discard.
    expect(libraryOf(state, "p1")).toEqual(
      expect.arrayContaining(p1Library.filter((u) => !leaving.includes(u))),
    );
    for (const uid of leaving) expect(libraryOf(state, "p1")).not.toContain(uid);
    expect(state.players.p2.discard).toHaveLength(0);
    expect(benchIds(state, "p2")).toEqual([B3]);
  });

  it("🛑 THE NON-ADJACENT PAIR — the board an ASCENDING splice gets wrong", () => {
    // Pick {0,2} on a 4-bench: removing index 0 first compacts the bench, and index 2
    // then names B4 rather than B3. `benchKeepShuffleRest.test.ts` §5's precedent,
    // driven here on the ANSWER rather than on the complement.
    const parked = attack(board(SEED, [B1, B2, B3, B4])).state;
    const { state, events } = answer(parked, [benchRef(0), benchRef(2)]);
    expect(benchIds(state, "p2")).toEqual([B2, B4]);
    expect(
      rows(events, "POKEMON_RETURNED").map((e) => state.cardIdByUid[(e as { uid: string }).uid]),
    ).toEqual([B1, B3]);
  });

  it("🛑 …and the ADJACENT-FROM-THE-FRONT pair {0,1}, the other half of the same defect", () => {
    // A loop over the shipped `returnBenched` removes A, the bench compacts, and
    // index 1 then removes C rather than B — SILENTLY, under a correct-looking event.
    const parked = attack(board(SEED, [B1, B2, B3, B4])).state;
    const { state } = answer(parked, [benchRef(0), benchRef(1)]);
    expect(benchIds(state, "p2")).toEqual([B3, B4]);
  });

  it("🛑 …and the TAIL pair {1,3}, where an ascending splice reads `undefined` and one body SURVIVES", () => {
    const parked = attack(board(SEED, [B1, B2, B3, B4])).state;
    const { state, events } = answer(parked, [benchRef(1), benchRef(3)]);
    expect(benchIds(state, "p2")).toEqual([B1, B3]);
    expect(rows(events, "POKEMON_RETURNED")).toHaveLength(2);
  });

  it("🛑 EXACTLY ONE `SHUFFLE` row naming the OWNER, and ONE `POKEMON_RETURNED` per body in BOARD order", () => {
    // A loop over `returnBenched` would file TWO SHUFFLE rows and take TWO RNG draws
    // for ONE printed shuffle: the right board with the wrong log.
    const parked = attack(board(SEED, [B1, B2, B3, B4])).state;
    // 🛑 **THE ANSWER IS DELIBERATELY OUT OF BOARD ORDER**, because that is the one
    // thing `returnBenchedRest` could never produce: its refs are already ascending
    // by construction, so the funnel's *"in board order"* claim was true and
    // untestable until this caller arrived. See the SORT in
    // `shuffleBenchedRefsIntoDeck` — and §4's RNG rung below, which is the half that
    // is not cosmetic.
    const { state, events } = answer(parked, [benchRef(2), benchRef(0)]);
    expect(rows(events, "SHUFFLE")).toHaveLength(1);
    expect(rows(events, "SHUFFLE").map((e) => (e as { seat: Seat }).seat)).toEqual(["p2"]);
    const returned = rows(events, "POKEMON_RETURNED");
    expect(returned).toHaveLength(2);
    // 🛑 BOARD ORDER, not answer order — the answer named {2,0} and the rows read
    // {0,2}. A writer that emitted in answer order would be green on every other rung
    // in this file.
    expect(returned.map((e) => state.cardIdByUid[(e as { uid: string }).uid])).toEqual([B1, B3]);
    expect(returned.map((e) => (e as { dest: string }).dest)).toEqual(["deck", "deck"]);
    expect(returned.map((e) => (e as { seat: Seat }).seat)).toEqual(["p2", "p2"]);
    expect(returned.map((e) => (e as { actor: Seat }).actor)).toEqual(["p1", "p1"]);
  });

  it("🛑 EXACTLY ONE RNG DRAW — the `rngState` is the ONE shuffle's, computed rather than remembered", () => {
    const parked = attack(board(SEED, [B1, B2, B3, B4])).state;
    const leaving = [0, 1].flatMap((i) => stackUids(bodyAt(parked, "p2", i)));
    const expected = shuffle([...parked.players.p2.deck, ...leaving], parked.rngState)[1];
    const { state } = answer(parked, [benchRef(0), benchRef(1)]);
    // Fisher–Yates consumes `n − 1` draws, so two shuffles of two smaller piles land
    // on a DIFFERENT state than one shuffle of the whole pile. This is the rung a
    // per-ref shuffle cannot pass even where the board happens to agree.
    expect(state.rngState).toBe(expected);
  });

  it("🛑 A PLAYER'S CLICK ORDER IS NOT A GAME FACT — the same picks answered both ways give ONE board", () => {
    // 🛑 **THE DEFECT THIS SUITE FOUND, AND IT IS NOT COSMETIC.** The funnel appends
    // the leaving pile to the deck BEFORE shuffling, so before D541 sorted
    // `gathered` into board order the SAME two picks answered `{0,2}` and `{2,0}`
    // produced DIFFERENT `rngState`s and different decks. It could not be seen from
    // `returnBenchedRest`, whose refs are ascending by construction. A replay that
    // recorded the refs in either order must reproduce one board.
    const parked = attack(board(SEED, [B1, B2, B3, B4])).state;
    const forwards = answer(parked, [benchRef(0), benchRef(2)]);
    const backwards = answer(parked, [benchRef(2), benchRef(0)]);
    expect(backwards.state.rngState).toBe(forwards.state.rngState);
    expect(JSON.stringify(backwards.state)).toBe(JSON.stringify(forwards.state));
    expect(JSON.stringify(backwards.events)).toBe(JSON.stringify(forwards.events));
  });

  it("🛑 §8.6 CLAMPS AND DOES NOT CANCEL — a bench SHORTER than the printed number shuffles what is there", () => {
    // 🛑 **THE RULE IS PRINTED AND UNQUALIFIED** — `docs/reference/ptcg-rules.md:333`
    // (§8.6) and `:370-374` (§9.1): *"§8.6 is its only softening: with fewer legal
    // targets than the number, you choose as many as you can"*, and a shortfall may
    // cancel the effect ONLY where the card PRINTS *"If you can't, this attack does
    // nothing"*. "Angelite" (index **1**, the attack this suite builds — NOT index 0
    // "Magical Charm") prints no such rider, so with ONE opponent Benched Pokémon the
    // attack shuffles that one.
    // ⚠️ **NEITHER NEIGHBOUR'S COMPARATOR IS THIS OP'S.** `returnBenchedRest`'s
    // `<= keep` is correct THERE because its effect is the COMPLEMENT — at a bench of
    // `keep` there is genuinely nothing to shuffle. A `< count` refusal HERE would be
    // the engine inventing an exception §8.6 requires to be printed, and this suite
    // would then be defending a defect (`conventions.md:1008`). The engine already
    // reads the rule this way for the very near miss §1 names: `damageChosen`'s
    // `const take = Math.min(ceiling, candidates.length)`.
    const one = attack(board(SEED, [B1]));
    expect(one.state.phase.kind).toBe("effect:choose");
    const prompt = parkedPrompt(one.state);
    expect(prompt.candidates).toHaveLength(1);
    // CLAMPED, not widened: a short board asks for FEWER, never for "up to".
    expect(prompt.min).toBe(1);
    expect(prompt.max).toBe(1);
    expect(prompt.declinable).toBe(false);
    // …and the answer really moves that body, whole, into the VICTIM's library.
    const leaving = stackUids(bodyAt(one.state, "p2", 0));
    const { state, events } = answer(one.state, [benchRef(0)]);
    expect(benchIds(state, "p2")).toEqual([]);
    for (const uid of leaving) expect(libraryOf(state, "p2")).toContain(uid);
    expect(rows(events, "SHUFFLE")).toHaveLength(1);
    expect(rows(events, "POKEMON_RETURNED")).toHaveLength(1);
  });

  it("🛑 …and the clamp is a CEILING and not a floor — bench 2, 3 and 4 all ask for exactly 2", () => {
    for (const bench of [[B1, B2], [B1, B2, B3], [B1, B2, B3, B4]] as const) {
      const state = attack(board(SEED, [...bench])).state;
      const prompt = parkedPrompt(state);
      expect(prompt.candidates, `bench ${bench.length}`).toHaveLength(bench.length);
      expect([prompt.min, prompt.max], `bench ${bench.length}`).toEqual([2, 2]);
    }
    // BENCH EXACTLY 2 — the board `returnBenchedRest`'s `<= keep` comparator would
    // silently skip, and the board on which this op does the MOST work.
    const two = attack(board(SEED, [B1, B2])).state;
    const { state: emptied } = answer(two, [benchRef(0), benchRef(1)]);
    expect(benchIds(emptied, "p2")).toEqual([]);
  });

  it("🛑 ZERO candidates is the ONLY board that does not park — and it is a NO-OP, not an empty shuffle", () => {
    const start = board(SEED, []);
    const { state, events } = attack(start);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(benchIds(state, "p2")).toEqual([]);
    expect(rows(events, "SHUFFLE")).toHaveLength(0);
    expect(rows(events, "POKEMON_RETURNED")).toHaveLength(0);
    expect(state.rngState).toBe(start.rngState);
  });

  it("🛑 no §8.1 promotion is owed — a bench-only op leaves the Active alone", () => {
    const parked = attack(board(SEED, [B1, B2, B3])).state;
    const activeUid = parked.players.p2.active?.stack[0];
    const { state, events } = answer(parked, [benchRef(0), benchRef(1)]);
    expect(state.players.p2.active?.stack[0]).toBe(activeUid);
    expect(rows(events, "KNOCKED_OUT")).toHaveLength(0);
    expect(state.pending.filter((p) => p.kind === "promote")).toHaveLength(0);
  });

  it("🛑 THE CONTROL INDEX: 'Plain Tap' on the same body parks nothing and moves no bench", () => {
    // Without this every verdict above is a claim about the board rather than about
    // the op (D318's finding-one).
    const start = board(SEED, [B1, B2, B3]);
    const { state, events } = attack(start, 1);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(benchIds(state, "p2")).toEqual([B1, B2, B3]);
    expect(rows(events, "SHUFFLE")).toHaveLength(0);
  });

  it("🛑 a wire answer naming a body that has since LEFT PLAY narrows nothing and does not throw", () => {
    // `returnBenched`'s trust level, verbatim: the funnel re-reads the LIVE bench, so
    // a stale ref matches nothing.
    const parked = attack(board(SEED, [B1, B2, B3])).state;
    const shrunk: GameState = {
      ...parked,
      players: {
        ...parked.players,
        p2: { ...parked.players.p2, bench: parked.players.p2.bench.slice(0, 2) },
      },
    };
    const { state, events } = answer(shrunk, [benchRef(0), benchRef(2)]);
    expect(benchIds(state, "p2")).toEqual([B2]);
    expect(rows(events, "POKEMON_RETURNED")).toHaveLength(1);
    expect(rows(events, "SHUFFLE")).toHaveLength(1);
  });

  it("🛑 `validateChoice` refuses a short answer, a long one and a repeat — the printed number is EXACT", () => {
    const parked = attack(board(SEED, [B1, B2, B3])).state;
    for (const refs of [
      [benchRef(0)],
      [benchRef(0), benchRef(1), benchRef(2)],
      [benchRef(0), benchRef(0)],
      [],
    ]) {
      const result = applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemonMulti", refs: [...refs] },
      });
      expect(result.ok, JSON.stringify(refs)).toBe(false);
      if (result.ok) throw new Error("expected a refusal");
      expect(result.error.code).toBe("BAD_EFFECT_CHOICE");
    }
    // …and a ref that was never a candidate (the actor's OWN bench).
    const foreign = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "pokemonMulti",
        refs: [{ seat: "p1", spot: { spot: "bench", index: 0 } }, benchRef(0)],
      },
    });
    expect(foreign.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — §11, ASKED AT THE PARK. Both directions, because both are silent.
// ─────────────────────────────────────────────────────────────────────────────

describe("D541 §5 — the shield is asked at PARK TIME, about the bodies the effect will REACH", () => {
  it("🛑 a SHIELDED benched body is NOT OFFERED — the candidates are filtered before the prompt", () => {
    // 🛑 **THE PRECEDENT IS `returnBenched`'s OPPONENT ARM, NOT `returnBenchedRest`'s
    // PARK.** That op asks the shield in `applyChoice` because its pick names the
    // bodies that are SPARED; here the pick IS the effect, so every candidate offered
    // is a body this op will shuffle away. The rule is *ask about the bodies the
    // effect will actually reach*, and the two arms differ because their picks point
    // in opposite directions.
    const { state } = attack(board(SEED, [B1, TEAPARTY, B3]));
    const prompt = parkedPrompt(state);
    expect(prompt.candidates).toHaveLength(2);
    expect(
      prompt.candidates.map((c) => benchIds(state, "p2")[(c.spot as { index: number }).index]),
    ).toEqual([B1, B3]);
  });

  it("🛑 …and an UNSHIELDED one IS offered, on the same board shape — the other direction", () => {
    const { state } = attack(board(SEED, [B1, B2, B3]));
    expect(parkedPrompt(state).candidates).toHaveLength(3);
  });

  it("🛑 ONE `ATTACK_EFFECT_PREVENTED` row for the shielded body, filed at the PARK", () => {
    const { events } = attack(board(SEED, [B1, TEAPARTY, B3]));
    expect(rows(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
  });

  it("🛑 NO FALSE `ATTACK_EFFECT_PREVENTED` on a board where nothing was going to be reached", () => {
    // The other silent direction: asking the shield too late (in `applyChoice`, on
    // the answer) would OFFER a shielded body and let the player waste a pick on it;
    // asking it about the wrong SET would file a row about a body nothing was going
    // to touch. Here every benched body is unshielded, so no row may be filed at all.
    const { events } = attack(board(SEED, [B1, B2, B3]));
    expect(rows(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
    // …and on a board that does not even park (ZERO candidates, §4), still none.
    expect(rows(attack(board(SEED, [])).events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
  });

  it("🛑 a shield that takes the bench BELOW the printed number CLAMPS the prompt — it does not cancel the attack", () => {
    // §11 AND §8.6 COMPOSE, and the composition is the reason the row filed here is
    // TRUE. The shield takes `TEAPARTY` out of the candidate set; a candidate set
    // shorter than the printed number is then §8.6's ordinary shortfall, so the prompt
    // asks for ONE and the unshielded body really leaves. ⚠️ **A `< count` REFUSAL
    // HERE WOULD FILE A `PREVENTED` ROW ON A BOARD WHERE THE OP THEN REACHED NOTHING
    // AT ALL** — the false row this op's park placement exists to avoid, arrived at
    // from the other end.
    const start = board(SEED, [B1, TEAPARTY]);
    const { state, events } = attack(start);
    expect(state.phase.kind).toBe("effect:choose");
    const prompt = parkedPrompt(state);
    expect(prompt.candidates).toHaveLength(1);
    expect([prompt.min, prompt.max]).toEqual([1, 1]);
    expect(rows(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    const after = answer(state, [benchRef(0)]);
    expect(benchIds(after.state, "p2")).toEqual([TEAPARTY]);
    expect(rows(after.events, "SHUFFLE")).toHaveLength(1);
    expect(rows(after.events, "POKEMON_RETURNED")).toHaveLength(1);
  });

  it("🛑 …and when EVERY benched body is shielded, nothing parks, nothing moves, no SHUFFLE", () => {
    const start = board(SEED, [TEAPARTY, TEAPARTY]);
    const { state, events } = attack(start);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(benchIds(state, "p2")).toEqual([TEAPARTY, TEAPARTY]);
    expect(rows(events, "SHUFFLE")).toHaveLength(0);
    expect(state.rngState).toBe(start.rngState);
    // The TWO rows filed here are NOT the false kind: the shield is precisely WHY
    // nothing is reached, so each row names a body this op was about to shuffle and
    // was refused. Contrast §4's zero-candidate board, where no shield spoke and no
    // row is filed at all.
    expect(rows(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE GATE ON A REAL BOARD, on the DECLARED demonstrator (Site B).
// ─────────────────────────────────────────────────────────────────────────────

describe("D541 §6 — the derived gate BLOCKS the attack, and the wrong twin is killable only here", () => {
  it("🛑 the demonstrator has NO registry row, which is what makes the derivation observable", () => {
    // 🛑 **SAID OUT LOUD RATHER THAN REPORTED AS A PASS ON `sv08-086`.**
    // `attackGateOf` is `authored ?? derived`, and `registry.ts`'s
    // `SYLVEON_EX_ANGELITE` wins on all three real ids — so every assertion in this
    // section would be green on a build whose DERIVATION was wrong if it were driven
    // on the real cards. It is driven on `d541-sylveon` instead.
    expect(programFor(CHARMER)).toBeUndefined();
    expect(registryCardIds()).not.toContain(CHARMER);
    const state = board(SEED, [B1, B2, B3]);
    expect(attackGateOf(state, activeOf(state, "p1"), 0)).toEqual({
      kind: "barredIf",
      condition: { kind: "yourPokemonUsedAttackLastTurn", attack: "Angelite" },
    });
    // …and the gate is INDEX-keyed: 'Plain Tap' at index 1 prints no clause.
    expect(attackGateOf(state, activeOf(state, "p1"), 1)).toBeUndefined();
  });

  it("🛑 THE ATTACK IS ACTUALLY BLOCKED after Angelite — the gate is enforced, not merely derived", () => {
    const start = board(SEEDS[0], [B1, B2, B3]);
    const parked = attack(start).state;
    const { state: resolved } = answer(parked, [benchRef(0), benchRef(1)]);
    const back = untilTurnOf(resolved, "p1");
    expect(activeOf(back, "p1").usedAttack?.name).toBe("Angelite");
    const again = applyAction(back, { type: "attack", seat: "p1", index: 0 });
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("expected the gate to refuse");
    expect(again.error.message).toContain("Angelite");
    // 🛑 THE CONTROL: index 1 is STILL legal on that very board, so what blocked is
    // the gate at index 0 and not the turn.
    expect(applyAction(back, { type: "attack", seat: "p1", index: 1 }).ok).toBe(true);
  });

  it("🛑 THE SITE-B TWIN BOARD: the stamped body has LEFT the Active Spot, and the gate still bites", () => {
    // 🛑 **THE ONLY BOARD ON WHICH `yourPokemonUsedAttackLastTurn` AND
    // `yourActiveUsedAttackLastTurn` DISAGREE, AND THE WRONG TWIN TYPECHECKS.**
    // Charmer A uses "Angelite"; A is displaced onto the Bench and a FRESH copy is
    // promoted, so the only body carrying the history is a BENCHED one and the
    // Active's own `usedAttack` is `null`. The printed clause bars the attack; the
    // Active-only reading lets it through.
    const start = board(SEEDS[0], [B1, B2, B3]);
    const parked = attack(start).state;
    const { state: resolved } = answer(parked, [benchRef(0), benchRef(1)]);
    const back = untilTurnOf(resolved, "p1");
    const displaced = fuel(setActiveFromDeck(back, "p1", CHARMER), "p1", 1);
    expect(activeOf(displaced, "p1").usedAttack).toBeNull();
    expect(displaced.players.p1.bench.some((b) => b.usedAttack?.name === "Angelite")).toBe(true);
    const blocked = applyAction(displaced, { type: "attack", seat: "p1", index: 0 });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error("expected the gate to refuse on the bench board");
    // 🛑 AND THE CONTROL THAT MAKES THIS A SITE-B WITNESS RATHER THAN A REPEAT: the
    // ACTIVE-only twin condition really does answer FALSE on this board, so the two
    // members are measurably different here and identical everywhere else.
    expect(activeOf(displaced, "p1").usedAttack?.name).toBeUndefined();
  });

  it("🛑 the clause→gate row is `barredIf` and names the WIDENED subject — read off the module", () => {
    // The polarity is the printed one (*"this attack can't be used"*, the BAN
    // direction) where the two other `condition`-carrying rows in the table are
    // LICENCES, and the condition member is the WIDENED one.
    expect(timingGateFromAttackText(PRINTED)).toEqual({
      kind: "barredIf",
      condition: { kind: "yourPokemonUsedAttackLastTurn", attack: "Angelite" },
    });
    // …and the clause ALONE derives the same gate, which is what says the gate is
    // keyed on the clause and not on the row.
    expect(timingGateFromAttackText(CLAUSE)).toEqual(timingGateFromAttackText(PRINTED));
    // …and the BODY alone derives none, so the two halves really are separable.
    expect(timingGateFromAttackText(BODY)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — registry === derived on the three REAL ids (the keep decision's rung).
// ─────────────────────────────────────────────────────────────────────────────

describe("D541 §7 — `SYLVEON_EX_ANGELITE` is KEPT as defence in depth, and the two producers AGREE", () => {
  it("🛑 registry === derived for all three ids, by VALUE", () => {
    // 🛑 **THE KEEP-OR-RETIRE DECISION IS RECORDED AT `registry.ts` AND THIS IS ITS
    // RUNG.** Retiring the row is the stronger answer to `conventions.md:195` and
    // would un-mask the derivation on the real printings; it costs
    // `splitOrder.test.ts` §4's five pins plus the deletion, and the smaller radius
    // won. What keeps the two producers from drifting silently is this line.
    const derived = timingGateFromAttackText(PRINTED);
    expect(derived).toBeDefined();
    for (const id of SYLVEON_IDS) {
      expect(programFor(id)?.attackGate?.[1], id).toEqual(derived);
      // …and the row is still keyed at index 1 and nowhere else.
      expect(Object.keys(programFor(id)?.attackGate ?? {}), id).toEqual(["1"]);
    }
  });

  it("🛑 …and the registry row still WINS, which is what `authored ?? derived` means", () => {
    // If it did not win, retiring it would be free and the decision above would be
    // moot. The precedence is asserted rather than assumed.
    expect(raw("/registry.ts")).toContain("const SYLVEON_EX_ANGELITE: CardProgram = {");
    for (const id of SYLVEON_IDS) expect(programFor(id)).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE PERSISTED BYTES (D450's two doors), over SERIALIZED BYTES.
// ─────────────────────────────────────────────────────────────────────────────

describe("D541 §8 — the parked op IS persisted, and `MATCH_RECORD_VERSION` HOLDS at 30 (🆕🆕🆕 held at THIS slice; 31 since D547; 32 since D548; 33 since D549; 34 since D552; 35 since D556; 36 since D564; 37 since D570; 38 since D575)", () => {
  it("🛑 THE FIRST DOOR: `phase.cont.pendingOp` carries the op as a LITERAL byte string", () => {
    // 🛑 **DO NOT RE-DERIVE THIS AS *"it never parks"*.** This op PARKS, so the
    // serialized alphabet GROWS: `{"op":"returnBenchedChosen","count":2}` is a byte
    // string no v30 deploy could ever have authored. 30 holds on D125's WIDENING and
    // on nothing else — every byte a v30 deploy DID write still means what it meant.
    const { state } = attack(board(SEED, [B1, B2, B3]));
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(JSON.parse(JSON.stringify(state.phase.cont.pendingOp))).toEqual(PROGRAM[0]);
    expect(JSON.stringify(state)).toContain('{"op":"returnBenchedChosen","count":2}');
  });

  it("🛑 THE SECOND DOOR, SCOPED HONESTLY (D423): `cont.rest` is EMPTY on THIS program", () => {
    const { state } = attack(board(SEED, [B1, B2, B3]));
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(state.phase.cont.rest).toEqual([]);
  });

  it("🛑 A FRESH PARKED RECORD STRINGIFIES WITH THE NEW INHABITANT AND RESUMES TO THE SAME BOARD", () => {
    // D450's direction ①, driven over SERIALIZED BYTES and not over a live object.
    const { state } = attack(board(SEED, [B1, B2, B3]));
    const wire = JSON.stringify(state);
    expect(wire).toContain("returnBenchedChosen");
    const revived = JSON.parse(wire) as GameState;
    expect(revived.phase.kind).toBe("effect:choose");
    const { state: fromWire } = answer(revived, [benchRef(0), benchRef(1)]);
    const { state: fromLive } = answer(state, [benchRef(0), benchRef(1)]);
    expect(benchIds(fromWire, "p2")).toEqual([B3]);
    expect(JSON.stringify(fromWire)).toBe(JSON.stringify(fromLive));
  });

  it("🛑 A PRE-SLICE v30 BYTE STRING ROUND-TRIPS AND STILL RESUMES — the other D450 direction", () => {
    // ② The WIDENING argument's other half: a record a v30 deploy really could have
    // written (this op's SIBLING, which shipped at D537 under the same version) is
    // byte-identical through this build and still resolves. Nothing about the new
    // member changed what an old byte means.
    const { state } = attack(board(SEED, [B1, B2, B3]));
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const preSlice = JSON.parse(
      JSON.stringify(state).split('{"op":"returnBenchedChosen","count":2}').join(
        '{"op":"returnBenchedRest","keep":1}',
      ),
    ) as GameState;
    expect(JSON.stringify(preSlice)).toContain('{"op":"returnBenchedRest","keep":1}');
    expect(JSON.stringify(preSlice)).not.toContain("returnBenchedChosen");
    const resumed = applyAction(preSlice, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [benchRef(0), benchRef(1)] },
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error("the pre-slice byte string failed to resume");
    // The SIBLING's reading: the answer names the bodies that STAY, so B3 is the one
    // that leaves. A build that confused the two ops would return the complement.
    expect(benchIds(resumed.state, "p2")).toEqual([B1, B2]);
  });

  it("🛑 on a NON-PARKING board the byte is NOWHERE in the record", () => {
    // The ONLY non-parking board is the ZERO-candidate one (§4): §8.6 CLAMPS a short
    // bench rather than cancelling on it, so `[B1]` parks with `min === max === 1`.
    const { state } = attack(board(SEED, []));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(JSON.stringify(state)).not.toContain("returnBenchedChosen");
  });

  it("🛑 `MATCH_RECORD_VERSION` is 38 (🆕🆕🆕 D575 stepped it 37 → 38; D570 stepped it 36 → 37; D564 stepped it 35 → 36; D556 stepped it 34 → 35; D552 stepped it 33 → 34; D549 stepped it 32 → 33; D548 stepped it 31 → 32; D547 stepped it 30 → 31; this slice held it) — read off the raw source, not retyped", () => {
    // 🆕🆕🆕 D547 — the constant this slice held is now 31: D547 added two REQUIRED `InPlayPokemon` fields (apps/api match.ts).
    expect(raw("/match.ts")).toContain("MATCH_RECORD_VERSION = 38");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — THE VERSION AND BYTE PINS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D541 §9 — the version tax and the byte pins", () => {
  it("🛑 the engine version is the CURRENT one in BOTH places (🆕 D541 — the TITLE is de-valued on purpose: D460's fifth site kind is the `it()` title, and a title carrying BOTH arrows is a site the next bump has to edit twice)", () => {
    expect(engineVersion).toBe("0.459.0");
    expect(manifest.version).toBe("0.459.0");
  });

  it("🛑 the OP NAME is untouched by the funnel RENAME — it is a persisted member", () => {
    // 🛑 The module-private function became `shuffleBenchedRefsIntoDeck`; the op
    // string `"returnBenchedRest"` and the note `returnBenchedRestNote` did NOT, and
    // the reason is that the op rides `phase.cont.pendingOp` into a serialized record.
    const source = raw("/interpreter.ts");
    expect(source).toContain("function shuffleBenchedRefsIntoDeck(");
    expect(source).not.toContain("function returnBenchedRest(");
    expect(source).toContain("function returnBenchedRestNote(");
    expect(source).toContain('case "returnBenchedRest"');
    // …and the funnel has exactly TWO call sites plus its definition.
    expect(source.split("shuffleBenchedRefsIntoDeck").length - 1).toBeGreaterThanOrEqual(3);
  });

  it("🛑 ZERO bytes in `redact.ts` and `packages/schema` — stated rather than discovered", () => {
    expect(raw("/redact.ts")).not.toContain("returnBenched");
    // `choosePokemonMulti` already ships in `validateChoice` and its arm is
    // op-agnostic, so `cardplay.ts` owes nothing either — VERIFIED, not assumed.
    expect(raw("/cardplay.ts")).toContain('case "choosePokemonMulti"');
    expect(raw("/cardplay.ts")).not.toContain("returnBenchedChosen");
  });

  it("🛑 the note is the printed caption, and it is UNMISTAKABLE for its sibling's", () => {
    const { state } = attack(board(SEED, [B1, B2, B3]));
    expect(parkedPrompt(state).note).toBe(NOTE);
    expect(NOTE).not.toBe("Choose 2 of your opponent's Benched Pokémon to leave in play.");
    // Two prompts with the same shape and opposite meanings are the one place a
    // shared caption would be a genuine defect.
    expect(raw("/interpreter.ts")).toContain("to shuffle into their deck.");
    expect(raw("/interpreter.ts")).toContain("to leave in play.");
  });

  it("🛑 …and the caption NAMES THE CLAMPED NUMBER, not the printed one — `snipeNote`'s rule", () => {
    // 🛑 **THE CAPTION MUST NAME EXACTLY THE SET THE FUNNEL OFFERS** (`snipeNote`'s
    // own `damagedOnly` block, obeyed by `damageChosen`, which passes its clamped
    // `take`). On the §8.6 board the prompt accepts exactly ONE ref, and a heading
    // still reading *"Choose 2"* would contradict its own validator — the player would
    // be told to pick two bodies the dialog then refuses. The PRINTED number still
    // reaches them through the attack text.
    const one = attack(board(SEED, [B1])).state;
    expect(parkedPrompt(one).note).toBe(
      "Choose 1 of your opponent's Benched Pokémon to shuffle into their deck.",
    );
    // …and it is still the PRINTED number wherever the board can answer it.
    expect(parkedPrompt(attack(board(SEED, [B1, B2, B3])).state).note).toBe(NOTE);
  });
});
