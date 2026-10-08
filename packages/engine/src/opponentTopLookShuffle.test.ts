import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import type { EffectContinuation } from "./interpreter";
import { logFromEvents } from "./log";
import type { LogContext } from "./log";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ─────────────────────────────────────────────────────────────────────────────
// 🆕🆕🆕 D534 — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE.
//
// `censusAttackCorpus.ts` **FILE LINE 401** — *"Look at the top card of your
// opponent's deck. You may have your opponent shuffle their deck."* — **1 sentence
// / 1 legal printing** (Inkay `sv06.5-033`, residue class SUBST-16 at SUBMAX=12 BEFORE
// D534 built it — 🆕🆕🆕 D547: a stale label now, not a live class membership; SUBST-16
// holds `:149` and `:169` after D547 built `:150` — 🆕🆕🆕 D549: STALE in turn, and WITHDRAWN as a
// present-tense claim; D549 built `:149` and `:169` (with `:170` and `:171`), and SUBST-16 is
// 0/0 at SUBMAX=12, measured).
// No catalog id on this checkout, so the demonstrator is FILE-LOCAL and DECLARED
// (D425): `d534-inkay` below carries the printed bytes and nothing else of the card.
//
// engine 0.418.0 → 0.419.0 — `shuffleDeck` gains the optional key
// `whose?: "opponent"` (D131/D532's spelling), `reorderTop`'s guard parks a ONE-card
// window when its two arms differ, `reorderNote` and the `DECK_TOP_REORDERED` log arm
// gain a one-card branch. `MATCH_RECORD_VERSION` HELD at 30 (an optional widening).
//
// THE PROGRAM: `reorderTop{ n: 1, side: "opponent", otherwise: [shuffleDeck{ whose:
// "opponent" }], otherwiseNote }` — D341's op with D344's second arm, one card wide.
// The looker is the only seat that decides; "have your opponent shuffle" names who
// handles the deck. The refusal on record ("two-seat CONSENT") priced the wrong thing.
// ─────────────────────────────────────────────────────────────────────────────

const PRINTED =
  "Look at the top card of your opponent's deck. You may have your opponent shuffle their deck.";
const NOTE = "Have your opponent shuffle their deck.";
const CAPTION =
  "Look at the top card of your opponent's deck — put it back, or have your opponent shuffle their deck.";
const OWN_CAPTION = "Look at the top card of your deck — put it back on top.";

const PROGRAM: EffectOp[] = [
  {
    op: "reorderTop",
    n: 1,
    side: "opponent",
    otherwise: [{ op: "shuffleDeck", whose: "opponent" }],
    otherwiseNote: NOTE,
  },
];

const INKAY = "d534-inkay";
const PSYCHIC_ENERGY = "d534-energy";
const WALL = "d534-wall";
/** Distinguishable deck fillers, so an order change is observable by uid over a deck
    of many different cards (a permutation of identical cards would be invisible). */
const FILLERS = ["d534-f1", "d534-f2", "d534-f3", "d534-f4", "d534-f5", "d534-f6"] as const;

const LOCAL_CARDS: Record<string, Card> = {
  [INKAY]: battler(INKAY, {
    name: "D534 Inkay",
    hp: 60,
    retreat: 1,
    types: ["Darkness"],
    attacks: [
      { cost: ["Psychic"], name: "Peek", effect: PRINTED },
      { cost: ["Psychic", "Colorless"], name: "Tackle", damage: 20 },
    ],
  }),
  [PSYCHIC_ENERGY]: typedEnergy(PSYCHIC_ENERGY, "Psychic"),
  [WALL]: battler(WALL, {
    name: "D534 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  ...Object.fromEntries(
    FILLERS.map((id, i) => [
      id,
      battler(id, {
        name: `D534 Filler ${String(i + 1)}`,
        hp: 200,
        retreat: 1,
        types: ["Colorless"],
        attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
      }),
    ]),
  ),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

// 4 + 16 + 4 + 6×6 = 60.
const DECK = deckOf({
  [INKAY]: 4,
  [PSYCHIC_ENERGY]: 16,
  [WALL]: 4,
  ...Object.fromEntries(FILLERS.map((id) => [id, 6])),
});

const ATTACK = { type: "attack", seat: "p1", index: 0 } as const;

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string | readonly string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob(
  [
    "./{censusAttackCorpus,index,effects,interpreter,log,preventBlock.test}.ts",
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

/** TEST SURGERY — one Energy onto p1's Active, taken off p1's deck. */
function fuel(state: GameState): GameState {
  const side = state.players.p1;
  const body = side.active;
  if (body === null) throw new Error("p1 has no Active");
  const energy = side.deck.find((u) => state.cardIdByUid[u] === PSYCHIC_ENERGY);
  if (energy === undefined) throw new Error("p1's deck lacks an Energy");
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        active: { ...body, energy: [...body.energy, energy] },
        deck: side.deck.filter((u) => u !== energy),
      },
    },
  };
}

/** TEST SURGERY — truncate `seat`'s deck to its own first `size` uids. */
function truncateDeck(state: GameState, seat: Seat, size: number): GameState {
  const deck = state.players[seat].deck;
  if (deck.length < size) throw new Error(`${seat}'s deck is shorter than ${String(size)}`);
  return {
    ...state,
    players: { ...state.players, [seat]: { ...state.players[seat], deck: deck.slice(0, size) } },
  };
}

/** p1's turn, the demonstrator Active and fuelled, a 330 HP Wall opposite. */
function board(seed: number, p2DeckSize?: number): GameState {
  let state = localSetup(seed);
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", FILLERS[0]);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", INKAY);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", FILLERS[1]);
  state = fuel(state);
  return p2DeckSize === undefined ? state : truncateDeck(state, "p2", p2DeckSize);
}

function attack(state: GameState): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, ATTACK);
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function answer(state: GameState, uids: readonly string[]) {
  const result = applyAction(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "orderCards", uids: [...uids] },
  });
  if (!result.ok) throw new Error(`answer refused: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function parkedPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`not parked: ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "orderCards") {
    throw new Error(`wrong prompt: ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

function continuation(state: GameState): EffectContinuation {
  if (state.phase.kind !== "effect:choose") throw new Error(`not parked: ${state.phase.kind}`);
  return state.phase.cont;
}

function shuffleSeats(events: readonly GameEvent[]): Seat[] {
  return events.flatMap((e) => (e.type === "SHUFFLE" ? [e.seat] : []));
}

function reorderRows(events: readonly GameEvent[]) {
  return events.filter((e) => e.type === "DECK_TOP_REORDERED");
}

function logRows(run: { state: GameState; events: readonly GameEvent[] }): [string, string][] {
  const ctx: LogContext = { names: { p1: "Ash", p2: "Gary" }, state: run.state, elapsed: "+00:00" };
  return logFromEvents(run.events, ctx).flatMap((r) =>
    r.kind === "action"
      ? [[r.who, r.segments.map((seg) => seg.text).join("")] as [string, string]]
      : [],
  );
}

const sorted = (uids: readonly string[]): string[] => [...uids].sort();

// ─────────────────────────────────────────────────────────────────────────────
describe("D534 §1 — the reading: file line 401 derives to ONE reorderTop with a shuffle arm", () => {
  it("🛑 the printed sentence derives to EXACTLY the program (`D534-arm-drops-whose` / `-arm-drops-the-note`)", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    const [op] = deriveAttackEffect(PRINTED) ?? [];
    expect(Object.keys(op ?? {}).sort()).toEqual([
      "n",
      "op",
      "otherwise",
      "otherwiseNote",
      "side",
    ]);
  });

  it("the straight and the curly apostrophe derive EQUAL programs (`D534-anchor-narrows-the-apostrophe`)", () => {
    const curly = PRINTED.replace("opponent's", "opponent’s");
    expect(curly).not.toBe(PRINTED);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(PRINTED));
  });

  it("🛑 a TRAILING clause is refused — the `$` is load-bearing (`D534-anchor-loses-the-tail`)", () => {
    expect(deriveAttackEffect(`${PRINTED} Draw a card.`)).toBeNull();
  });

  it("🛑 a PREFIXED print is refused — the `^`", () => {
    expect(deriveAttackEffect(`Draw a card. ${PRINTED}`)).toBeNull();
  });

  it("a single-axis near miss — YOUR deck for your OPPONENT's deck — is not this program", () => {
    const own =
      "Look at the top card of your deck. You may have your opponent shuffle their deck.";
    expect(deriveAttackEffect(own)).not.toEqual(PROGRAM);
    expect(deriveAttackEffect(own)).toBeNull();
  });

  it("the sibling `ATTACK_REORDER_TOP` does NOT claim the sentence (measured on its own bytes)", () => {
    const sibling = new RegExp(
      "^Look at the top (?:" +
        "(\\d+) cards of your deck" +
        "|(\\d+) cards of your opponent['’]s deck" +
        ") and put them back in any order\\.$",
    );
    expect(sibling.exec(PRINTED)).toBeNull();
    expect(raw("/effects.ts")).toContain(
      '    "(\\\\d+) cards of your deck" +\n    `|(\\\\d+) cards of your opponent[\'’]s deck` +\n    ") and put them back in any order\\\\.$",',
    );
  });

  it("🛑 the row is the corpus's bytes at ONE printing, RAW file line 401, and it is RESOLVED", () => {
    const corpus = legalAttackCorpus();
    expect(corpus.filter(([, s]) => s === PRINTED)).toEqual([[1, PRINTED]]);
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(raw("/censusAttackCorpus.ts").split("\n")[400]).toBe(`1 ${PRINTED}`);
  });

  it("the demonstrator is FILE-LOCAL and DECLARED (D425) — no fixture-pool id, the deck is 60", () => {
    expect(Object.keys(LOCAL_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
    expect(DECK).toHaveLength(60);
    expect(LOCAL_CARDS[INKAY]?.attacks?.[0]?.effect).toBe(PRINTED);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D534 §2 — the board: the look parks, and the answer is put-back or shuffle", () => {
  it("🛑 the attack PARKS on `orderCards` over p2's TOP card, with the alternative and the one-card caption (`D534-guard-drops-the-new-disjunct` / `-note-drops-the-one-card-branch`)", () => {
    const state = board(11);
    const { state: parked, events } = attack(state);
    const prompt = parkedPrompt(parked);
    expect(prompt.candidates).toEqual(state.players.p2.deck.slice(0, 1));
    expect(prompt.alt).toBe(NOTE);
    expect(prompt.note).toBe(CAPTION);
    // The look is announced at the park, under the deck's OWNER, by the LOOKER.
    expect(reorderRows(events)).toEqual([
      { type: "DECK_TOP_REORDERED", seat: "p2", actor: "p1", count: 1 },
    ]);
    // Nothing moved yet — both decks are exactly as they were.
    expect(parked.players.p2.deck).toEqual(state.players.p2.deck);
    expect(parked.players.p1.deck).toEqual(state.players.p1.deck);
    expect(continuation(parked).pendingOp).toEqual(PROGRAM[0]);
  });

  it("🛑 the redacted prompt shows the card to the ANSWERER (p1) and NOTHING to the deck's owner (p2)", () => {
    const { state: parked } = attack(board(13));
    const [uid] = parkedPrompt(parked).candidates;
    if (uid === undefined) throw new Error("no candidate");
    const mine = redactGame(parked, "p1");
    if (mine.phase.kind !== "effect:choose" || mine.phase.prompt?.kind !== "orderCards") {
      throw new Error("p1's view does not carry the orderCards prompt");
    }
    expect(mine.phase.prompt.candidates.map((c: { id: string }) => c.id)).toEqual([uid]);
    expect(redactGame(parked, "p2").phase).toEqual({ kind: "effect:choose", prompt: null });
    expect(JSON.stringify(redactGame(parked, "p2"))).not.toContain(uid);
  });

  it("🛑 answering [uid] PUTS IT BACK: p2's deck is untouched (the card is what p2 draws next), no SHUFFLE, rng unspent", () => {
    const state = board(17);
    const { state: parked } = attack(state);
    const [uid] = parkedPrompt(parked).candidates;
    if (uid === undefined) throw new Error("no candidate");
    const run = answer(parked, [uid]);
    // An attack ends the turn [🆕🆕🆕 D570 (D539): except a FIRST attack under Festival Lead with Festival Grounds in play, which no board here builds]: p2's turn begins and p2 DRAWS the card that was put back.
    expect(run.state.players.p2.hand).toContain(uid);
    expect(run.state.players.p2.deck).toEqual(state.players.p2.deck.slice(1));
    expect(run.state.players.p1.deck).toEqual(state.players.p1.deck);
    expect(shuffleSeats(run.events)).toEqual([]);
    expect(run.state.rngState).toEqual(parked.rngState);
  });

  it("🛑 answering [] runs the printed arm: SHUFFLE{p2}, rng advanced, p2's deck a real permutation, p1's deck byte-identical (`D534-shuffle-reads-the-actor`)", () => {
    const state = board(19);
    const before = [...state.players.p2.deck];
    const { state: parked } = attack(state);
    const run = answer(parked, []);
    expect(shuffleSeats(run.events)).toEqual(["p2"]);
    expect(run.state.rngState).not.toEqual(parked.rngState);
    // p2 drew one card at the start of their turn: the drawn card plus the deck is the
    // multiset that was there, and the ORDER is not the one that was there.
    const drawn = run.state.players.p2.hand.filter((u) => !parked.players.p2.hand.includes(u));
    expect(drawn).toHaveLength(1);
    const after = [...drawn, ...run.state.players.p2.deck];
    expect(sorted(after)).toEqual(sorted(before));
    expect(after).not.toEqual(before);
    expect(run.state.players.p1.deck).toEqual(state.players.p1.deck);
  });

  it("the log: the look reads PASSIVE under p2 with no 'chosen order'; the shuffle reads under p2; nothing under p1 claims a shuffle (`D534-log-drops-the-one-card-branch`)", () => {
    const parkedRun = attack(board(23));
    const look = logRows(parkedRun);
    expect(look).toContainEqual(["p2", "had the top card of their deck looked at"]);
    expect(look.some(([, t]) => t.includes("chosen order"))).toBe(false);
    const shuffled = logRows(answer(parkedRun.state, []));
    expect(shuffled).toContainEqual(["p2", "shuffled their deck"]);
    expect(shuffled).not.toContainEqual(["p1", "shuffled their deck"]);
    const [uid] = parkedPrompt(parkedRun.state).candidates;
    if (uid === undefined) throw new Error("no candidate");
    const kept = logRows(answer(parkedRun.state, [uid]));
    expect(kept.some(([, t]) => t === "shuffled their deck")).toBe(false);
  });

  it("a SHORT or a FOREIGN answer is refused — the one-card prompt is still a permutation", () => {
    const { state: parked } = attack(board(29));
    const foreign = parked.players.p2.deck[1];
    if (foreign === undefined) throw new Error("p2's deck is too short");
    const refused = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "orderCards", uids: [foreign] },
    });
    expect(refused.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D534 §3 — the degenerate boards and the constructed ops", () => {
  it("🛑 a 1-card p2 deck does NOT park (a shuffle of one card is the state it was) and still announces a look of 1 (`D534-guard-drops-the-deck-conjunct`)", () => {
    const { state: done, events } = attack(board(31, 1));
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(reorderRows(events)).toEqual([
      { type: "DECK_TOP_REORDERED", seat: "p2", actor: "p1", count: 1 },
    ]);
    expect(shuffleSeats(events)).toEqual([]);
  });

  it("an EMPTY p2 deck does not park and announces a look of 0", () => {
    const { state: done, events } = attack(board(37, 0));
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(reorderRows(events)).toEqual([
      { type: "DECK_TOP_REORDERED", seat: "p2", actor: "p1", count: 0 },
    ]);
  });

  it("🛑 a constructed `reorderTop{n:1, side:opponent}` with NO `otherwise` does not park over a long deck — one ordering is not a decision (`D534-guard-drops-the-otherwise-conjunct`)", () => {
    const state = board(41);
    expect(state.players.p2.deck.length).toBeGreaterThan(10);
    const events: GameEvent[] = [];
    const result = runProgram(state, [{ op: "reorderTop", n: 1, side: "opponent" }], { seat: "p1" }, events);
    expect(result.kind).toBe("done");
    expect(reorderRows(events)).toHaveLength(1);
  });

  it("🛑 a constructed OWN-side `reorderTop{n:1}` WITH `otherwise` PARKS over a long own deck — decided: the guard asks whether the arms differ, not whose deck it is — under the own one-card caption", () => {
    const state = board(43);
    const events: GameEvent[] = [];
    const result = runProgram(
      state,
      [
        {
          op: "reorderTop",
          n: 1,
          otherwise: [{ op: "shuffleDeck" }],
          otherwiseNote: "Shuffle your deck.",
        },
      ],
      { seat: "p1" },
      events,
    );
    if (result.kind !== "parked" || result.prompt.kind !== "orderCards") {
      throw new Error("the own-side op did not park");
    }
    expect(result.prompt.candidates).toEqual(state.players.p1.deck.slice(0, 1));
    expect(result.prompt.note).toBe(OWN_CAPTION);
    expect(result.prompt.alt).toBe("Shuffle your deck.");
  });

  it("the D341 plural captions are untouched for n ≥ 2", () => {
    const state = board(47);
    const events: GameEvent[] = [];
    const result = runProgram(state, [{ op: "reorderTop", n: 3, side: "opponent" }], { seat: "p1" }, events);
    if (result.kind !== "parked" || result.prompt.kind !== "orderCards") throw new Error("no park");
    expect(result.prompt.note).toBe(
      "Put these cards back on top of your opponent's deck in any order.",
    );
  });

  it("a bare `shuffleDeck` (no `whose`) still shuffles the CONTROLLER's deck — every pre-slice construction site keeps its meaning", () => {
    const state = board(53);
    const events: GameEvent[] = [];
    const result = runProgram(state, [{ op: "shuffleDeck" }], { seat: "p1" }, events);
    if (result.kind !== "done") throw new Error("shuffleDeck parked");
    expect(shuffleSeats(events)).toEqual(["p1"]);
    expect(result.state.players.p2.deck).toEqual(state.players.p2.deck);
    expect(result.state.players.p1.deck).not.toEqual(state.players.p1.deck);
    expect(sorted(result.state.players.p1.deck)).toEqual(sorted(state.players.p1.deck));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D534 §4 — the record: an optional widening, `MATCH_RECORD_VERSION` HELD at 30 (🆕🆕🆕 held at THIS slice; 31 since D547; 32 since D548; 33 since D549; 34 since D552; 35 since D556; 36 since D564; 37 since D570; 38 since D575; 39 since D576; 40 since D577; 41 since D579; 42 since D583)", () => {
  it("🛑 the parked state round-trips through JSON BYTE-EQUAL, keeps `whose` in `cont.pendingOp.otherwise`, and resumes from its bytes to the same result", () => {
    const { state: parked } = attack(board(59));
    const bytes = JSON.stringify(parked);
    const revived = JSON.parse(bytes) as GameState;
    expect(JSON.stringify(revived)).toBe(bytes);
    const op = continuation(revived).pendingOp;
    if (op.op !== "reorderTop") throw new Error("wrong pending op");
    expect(op.otherwise).toEqual([{ op: "shuffleDeck", whose: "opponent" }]);
    expect(bytes).toContain('"otherwise":[{"op":"shuffleDeck","whose":"opponent"}]');
    const fromBytes = answer(revived, []);
    const fromLive = answer(parked, []);
    expect(fromBytes.state).toEqual(fromLive.state);
    expect(shuffleSeats(fromBytes.events)).toEqual(["p2"]);
  });

  it("🛑 THE LOSS DIRECTION (D421/D435): the key DELETED from the parked arm resumes as a shuffle of the ATTACKER's deck — p1 shuffles, p2's deck keeps its order", () => {
    const state = board(61);
    const { state: parked } = attack(state);
    const revived = JSON.parse(
      JSON.stringify(parked, (k, v: unknown) => (k === "whose" ? undefined : v)),
    ) as GameState;
    const op = continuation(revived).pendingOp;
    if (op.op !== "reorderTop") throw new Error("wrong pending op");
    expect(op.otherwise).toEqual([{ op: "shuffleDeck" }]);
    const run = answer(revived, []);
    expect(shuffleSeats(run.events)).toEqual(["p1"]);
    // p2 drew its OLD top card and the rest of its deck is in its old order.
    expect(run.state.players.p2.deck).toEqual(state.players.p2.deck.slice(1));
    expect(run.state.players.p1.deck).not.toEqual(state.players.p1.deck);
  });

  it("🛑 `MATCH_RECORD_VERSION` is 42 (🆕🆕🆕 D583 stepped it 41 → 42; D579 stepped it 40 → 41; D577 stepped it 39 → 40; D576 stepped it 38 → 39; D575 stepped it 37 → 38; D570 stepped it 36 → 37; D564 stepped it 35 → 36; D556 stepped it 34 → 35; D552 stepped it 33 → 34; D549 stepped it 32 → 33; D548 stepped it 31 → 32; D547 stepped it 30 → 31; this slice held it) in `apps/api` — a widening, not a new shape", () => {
    // 🆕🆕🆕 D547 — the constant this slice held is now 31: D547 added two REQUIRED `InPlayPokemon` fields (apps/api match.ts).
    expect(raw("/lobby/match.ts")).toContain("export const MATCH_RECORD_VERSION = 42;");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D534 §5 — §11 and the describer: a deck is not a body, and no branch phrase is owed", () => {
  it("the §11 table still classifies `shuffleDeck` as untouched, and `describeBranch` has NO `shuffleDeck` arm (it is never inside a §9.2 gate branch), so no phrase for `whose` is owed", () => {
    expect(raw("/preventBlock.test.ts")).toContain('    shuffleDeck: "untouched",');
    const interpreter = raw("/interpreter.ts");
    const start = interpreter.indexOf("function describeBranch(");
    const end = interpreter.indexOf("\n}\n", start);
    expect(start).toBeGreaterThan(0);
    expect(interpreter.slice(start, end)).not.toContain('"shuffleDeck"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D534 §6 — the version steps and the bytes this suite drove are the bytes that shipped", () => {
  it("engineVersion and `manifest.version` agree, and the bump is owed for BEHAVIOUR", () => {
    expect(engineVersion).toBe("0.477.0");
    expect(manifest.version).toBe(engineVersion);
    expect(raw("/index.ts")).toContain("engineVersion 0.418.0 → **0.419.0** (D534");
  });

  it("🛑 the anchor, the arm, the helper's seat, the guard, the caption and the log branch are byte for byte what this suite drove", () => {
    const effects = raw("/effects.ts");
    expect(effects).toContain(
      "const ATTACK_OPPONENT_TOP_LOOK_SHUFFLE =\n  /^Look at the top card of your opponent['’]s deck\\. You may have your opponent shuffle their deck\\.$/;",
    );
    expect(effects).toContain('  | { op: "shuffleDeck"; whose?: "opponent" }');
    expect(effects).toContain('        otherwise: [{ op: "shuffleDeck", whose: "opponent" }],');
    const interpreter = raw("/interpreter.ts");
    expect(interpreter).toContain(
      '  const seat = op.whose === "opponent" ? otherSeat(ctx.seat) : ctx.seat;',
    );
    expect(interpreter).toContain("      if (top.length < 2 && !armsDiffer) return { done: state };");
    expect(interpreter).toContain('      return { done: shuffleDeck(state, ctx, op, events) };');
    expect(raw("/log.ts")).toContain('              : "had the top card of their deck looked at",');
  });
});
