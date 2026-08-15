import { describe, expect, it } from "vitest";
import type { Card } from "@luminous/schema";
import type { EffectOp } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { logFromEvents } from "./log";
import type { LogContext } from "./log";
import { redactGame } from "./redact";
import { programFor } from "./registry";
import { FIXTURE_POOL, battler, deckOf, expectErr, trainerCard, typedEnergy } from "./testFixtures";

// ── D344 — DEDUCTION KIT `sv08-171`, AND THE PRINTED `or` THAT WAS THE WHOLE
//    REMAINING COST OF THE *"IN ANY ORDER"* FAMILY ──────────────────────────
//
// ── THE PRINTED SENTENCE ────────────────────────────────────────────────────
//   "Look at the top 3 cards of your deck and put them back in any order, **or**
//    shuffle them and put them on the bottom of your deck."
//   Item, mark H, **1 Standard-legal printing of 1**, `effect` (125 chars).
//
// ── THE FAMILY CENSUS, RE-DERIVED FROM REMOTE D1 `luminous` (2026-08-15) ────
// The resume point flagged the inherited figure as unverified and it needed the
// flag. `instr(<col>,'in any order') > 0` over ALL THREE text columns:
//
//   `effect`          8 printings / 6 legal
//   `attacks_json`    7 printings / 5 legal
//   `abilities_json`  0 printings / 0 legal
//   TOTAL            15 printings / 11 legal.  8 + 7 + 0 = 15 ✅  6 + 5 + 0 = 11 ✅
//
// **15 / 11 IS CONFIRMED TO THE DIGIT.** The SEVEN distinct sentences, with the
// slice that read each:
//   1. "Look at the top 4 cards of your deck and put them back in any order."
//      — Iron Valiant `sv05-080` (1 legal) — BUILT, D341 (`ATTACK_REORDER_TOP`)
//   2. "…the top 5 cards of your **opponent's** deck…" — Team Rocket's Dottler
//      `sv10-088`, Gothorita `sv10.5w-042`/`-125` (3 legal) — BUILT, D341
//   3. "Search your deck for 2 cards, shuffle your deck, then put those cards on
//      top of it in any order." — Ciphermaniac's Codebreaking ×3 + Dialga
//      `sv08-135` (4 legal) — BUILT, D342
//   4. "Put 2 cards from your hand on the bottom of your deck in any order. …"
//      — Kofu `sv07-138`/`-165` (2 legal) — BUILT, D343
//   5. **THIS ONE** — Deduction Kit `sv08-171` (1 legal)
//   6. "Look at the top 5 cards of your deck and discard any number of them. Put
//      the other cards back in any order." — Raifort `sv06-161`/`sv08.5-142`
//      (**0 legal**)
//   7. "Look at the top 3 cards of **either player's** deck and put them back in
//      any order." — Absol ex `sv03-135`/`-214` (**0 legal**)
//
// 🛑🛑 **AND THE INHERITED "FIVE OF SEVEN BUILT" WAS ONE TOO MANY — IT WAS
//    FOUR.** D342 wrote it, D343 recorded that it did not reconcile against the
//    sentences its own entry names and did not re-derive it. Counted off
//    `registry.ts` and `effects.ts` at this head, four of the seven were built.
//    **This is the fifth, and every sentence in the family with a legal printing
//    is now built — the family CLOSES on Standard**, with two survivors that are
//    both `legal_standard = 0` and buy nothing.
//
// ⚠️ THE HONEST FORM OF THE FIGURE SEPARATES THE TWO AXES, which is exactly what
//    the rotten one did not: **7 sentences, 5 of them with any legal printing,
//    and 5 of those 5 now built.** "Five of seven" was the right numerator
//    attached to the wrong denominator a slice early.
//
// ── WHAT THE `or` ACTUALLY COST, AND WHY THE CHEAP READING IS REFUSED ───────
// The work order priced it as *"the print settles neither a caption nor a prompt
// kind"*. Measured against the source, **the KIND half was already paid**:
// `confirm`'s own doc block records that *"a confirm answer means run `then` …
// a fact about the program"* where a `mayDraw` answer is a fact about cards. A
// binary answer picking between two printed arms is therefore a MEANING this
// engine has had since D186, and `optional { then, otherwise }` has been a
// two-armed branch on a human answer since D316.
//
// 🛑 **IT IS REFUSED ANYWAY, AND NOT ON TASTE.** An `optional` parks
// `{kind:"confirm", note}` and **a confirm carries no candidates**. The print
// hands the information over FIRST — *"**Look at the top 3 cards** of your deck
// **and** put them back in any order, or …"* — so an `optional` wrapper asks the
// question BLIND. That is not a caption difference; it is the loss of the one
// thing the sentence gives before it asks. **THE PROMPT THAT ASKS THE `or` HAS
// TO BE THE PROMPT THAT DELIVERS THE LOOK**, and `orderCards` is the only prompt
// whose window `redactPrompt` resolves to the answerer alone.
//
// **THE ANSWER IS THE EMPTY ORDERING**, which reads as the print does: *none of
// these cards is being put back on top*. It is a value the prompt could not
// previously hold rather than one taken from something else — `validateChoice`
// demands a permutation of a window never smaller than 2 — and it is admitted
// EXACTLY when `alt` is present, which the second `describe` below pins from
// both sides.

const KIT = "sv08-171";
const PRINTED =
  "Look at the top 3 cards of your deck and put them back in any order, " +
  "or shuffle them and put them on the bottom of your deck.";
const ALT = "Shuffle them and put them on the bottom of your deck.";

const WALL = "fix-d344-wall";
const ENERGY = "fix-d344-energy";
const MARKERS = ["fix-d344-m1", "fix-d344-m2", "fix-d344-m3", "fix-d344-m4"] as const;
const FILLERS = ["fix-d344-f1", "fix-d344-f2", "fix-d344-f3"] as const;

/** 🆕 A LOCAL `cardPool` (D275's idiom, `derivedSearchTopOrder.test.ts`'s shape
    two slices over), NOT an addition to `FIXTURE_POOL`. `sv08` is not among
    `catalogManifest`'s six generated sets, so a shared-pool body would owe a
    `fix-deductionkit` registry key AND move `raw.length` by two instead of one —
    the cost D337 paid and D338–D343 each declined. THE KEY IS THE SET, NOT THE
    SURFACE. */
const LOCAL_CARDS: Record<string, Card> = {
  [KIT]: trainerCard(KIT, "Item", PRINTED),
  [ENERGY]: typedEnergy(ENERGY, "Colorless"),
  [WALL]: battler(WALL, {
    name: "D344 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  ...Object.fromEntries(
    [...MARKERS, ...FILLERS].map((id, i) => [
      id,
      battler(id, {
        name: `D344 Body ${String(i + 1)}`,
        hp: 200,
        retreat: 1,
        types: ["Colorless"],
        attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
      }),
    ]),
  ),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

// 4 + 20 + 4 + (4 × 4) + (6 + 5 + 5) = 60.
const DECK = deckOf({
  [KIT]: 4,
  [ENERGY]: 20,
  [WALL]: 4,
  ...Object.fromEntries(MARKERS.map((id) => [id, 4])),
  [FILLERS[0]]: 6,
  [FILLERS[1]]: 5,
  [FILLERS[2]]: 5,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function apply(
  state: GameState,
  action: Parameters<typeof applyAction>[1],
): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
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

/** TEST SURGERY — replace p1's deck outright. Every assertion in this file is
    about a deck's CONTENTS AND ORDER, so a known starting sequence is what makes
    "the window went to the bottom" distinguishable from "the deck was shuffled". */
function setDeck(state: GameState, deck: readonly string[]): GameState {
  return {
    ...state,
    players: { ...state.players, p1: { ...state.players.p1, deck: [...deck] } },
  };
}

/** TEST SURGERY — move one copy of `id` out of p1's deck and into their hand. */
function toHand(state: GameState, id: string): { state: GameState; uid: string } {
  const side = state.players.p1;
  const uid = side.deck.find((u) => state.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`p1's deck has no ${id}`);
  return {
    state: {
      ...state,
      players: {
        ...state.players,
        p1: { ...side, deck: side.deck.filter((u) => u !== uid), hand: [...side.hand, uid] },
      },
    },
    uid,
  };
}

/** P1's first unrestricted turn — P2 went first and passed. */
function board(seed: number): GameState {
  return must(applyAction(localSetup(seed, "p2"), { type: "endTurn", seat: "p2" }));
}

/** Play the Item and return the PARKED ordering prompt with p1's deck set to
    `deck` beforehand, so the window is exactly its first three entries. */
function parked(
  seed: number,
  deck?: readonly string[],
): { state: GameState; events: readonly GameEvent[]; deck: readonly string[] } {
  const withHand = toHand(board(seed), KIT);
  const staged = deck === undefined ? withHand.state : setDeck(withHand.state, deck);
  const played = apply(staged, { type: "playTrainer", seat: "p1", uid: withHand.uid });
  return { state: played.state, events: played.events, deck: [...staged.players.p1.deck] };
}

/** The uids p1's deck holds, in deck order, taken off a board whose deck we set
    ourselves — so the window under test is named rather than discovered. */
function stagedDeck(seed: number, length: number): { state: GameState; uids: string[] } {
  const start = board(seed);
  return { state: start, uids: start.players.p1.deck.slice(0, length) };
}

describe("D344 — Deduction Kit sv08-171: the printed `or` on the ordering prompt", () => {
  it("the registry row IS the one-op program, and the `or` is two optional fields on it", () => {
    // The whole shape, asserted by value rather than described: a reader who
    // wonders whether the alternative is an `optional` wrapper gets the answer
    // from the object.
    const program = programFor(KIT);
    expect(program?.trainer).toEqual([
      {
        op: "reorderTop",
        n: 3,
        otherwise: [{ op: "bottomDeckTop", n: 3 }],
        otherwiseNote: ALT,
      },
    ]);
    // 🛑 NO `optional` ANYWHERE IN IT, which is the refusal this row is about.
    // Asserted rather than left to the doc block, because the cheap reading is
    // the one a later slice would "simplify" this into.
    const ops = JSON.stringify(program?.trainer);
    expect(ops).not.toContain('"optional"');
    // …and the two windows agree. A divergence would silently bottom a different
    // set of cards than the one the player was shown — the print's "them" is the
    // window, once.
    const op = program?.trainer?.[0] as Extract<EffectOp, { op: "reorderTop" }>;
    const arm = op.otherwise?.[0] as Extract<EffectOp, { op: "bottomDeckTop" }>;
    expect(arm.n).toBe(op.n);
  });

  it("parks the ORDERING prompt carrying the printed alternative as its `alt`", () => {
    const { state } = parked(4001);
    if (state.phase.kind !== "effect:choose") throw new Error(`not parked: ${state.phase.kind}`);
    const prompt = state.phase.prompt;
    if (prompt.kind !== "orderCards") throw new Error(`wrong prompt: ${prompt.kind}`);
    expect(prompt.candidates).toHaveLength(3);
    // The ordering caption is `reorderNote`'s unchanged own-deck/top arm — the
    // alternative does not change what the FIRST arm is called.
    expect(prompt.note).toBe("Put these cards back on top of your deck in any order.");
    expect(prompt.alt).toBe(ALT);
  });

  it("the ordering arm is unchanged: a permutation re-sequences the top 3 and nothing else", () => {
    const { uids } = stagedDeck(4002, 8);
    const start = parked(4002);
    if (start.state.phase.kind !== "effect:choose") throw new Error("not parked");
    const prompt = start.state.phase.prompt;
    if (prompt.kind !== "orderCards") throw new Error("wrong prompt");
    const window = [...prompt.candidates];
    expect(window).toEqual(uids.slice(0, 3));
    const reversed = [...window].reverse();
    const done = apply(start.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "orderCards", uids: reversed },
    });
    const deck = done.state.players.p1.deck;
    expect(deck.slice(0, 3)).toEqual(reversed);
    // Everything under the window untouched, which is the half a shuffle would
    // destroy and the half this arm is FOR.
    expect(deck.slice(3)).toEqual(start.deck.slice(3));
    // No bottoming row on this arm: the two arms are exclusive.
    expect(find(done.events, "DECK_TOP_TO_BOTTOM")).toBeUndefined();
  });

  it("🛑 THE EMPTY ORDERING TAKES THE PRINTED ALTERNATIVE: the top 3 go UNDER the deck", () => {
    const start = parked(4003);
    if (start.state.phase.kind !== "effect:choose") throw new Error("not parked");
    const before = start.deck;
    const window = before.slice(0, 3);
    const done = apply(start.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "orderCards", uids: [] },
    });
    const deck = done.state.players.p1.deck;
    // Same cards, none created and none destroyed.
    expect([...deck].sort()).toEqual([...before].sort());
    // 🛑 THE DECK UNDER THE WINDOW IS UNTOUCHED AND IN ORDER — this is the whole
    // difference between `bottomDeckTop` and `shuffleDeck`, and the fact the log
    // row exists to report. The draws that were coming are still coming.
    expect(deck.slice(0, before.length - 3)).toEqual(before.slice(3));
    // …and the three that moved are exactly the window, as a SET: the order they
    // land in is the shuffle's and this suite must not pin it.
    expect([...deck.slice(-3)].sort()).toEqual([...window].sort());
    // The phase resolved — the alternative is a whole arm, not a second question.
    expect(done.state.phase.kind).not.toBe("effect:choose");
  });

  it("the alternative CONSUMES rng and the ordering arm does not", () => {
    // The two arms are separated by a fact no card count can see. `shuffle`
    // advances `rngState`; a `reorderTop` answer moves nothing random at all.
    const a = parked(4004);
    if (a.state.phase.kind !== "effect:choose") throw new Error("not parked");
    const promptA = a.state.phase.prompt;
    if (promptA.kind !== "orderCards") throw new Error("wrong prompt");
    const ordered = apply(a.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "orderCards", uids: [...promptA.candidates].reverse() },
    });
    expect(ordered.state.rngState).toBe(a.state.rngState);

    const b = parked(4004);
    const bottomed = apply(b.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "orderCards", uids: [] },
    });
    expect(bottomed.state.rngState).not.toBe(b.state.rngState);
  });

  it("the bottoming row is COUNT-ONLY, names no card, and is not a SHUFFLE row", () => {
    const start = parked(4005);
    const done = apply(start.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "orderCards", uids: [] },
    });
    const row = find(done.events, "DECK_TOP_TO_BOTTOM");
    expect(row).toEqual({ type: "DECK_TOP_TO_BOTTOM", seat: "p1", count: 3 });
    // 🛑 NOT A `SHUFFLE`. That row says the DECK was randomized and here it was
    // not — the window under it was. A player watching needs the difference.
    expect(find(done.events, "SHUFFLE")).toBeUndefined();
    // The look was still announced by the park, on the earlier action.
    expect(find(start.events, "DECK_TOP_REORDERED")).toEqual({
      type: "DECK_TOP_REORDERED",
      seat: "p1",
      actor: "p1",
      count: 3,
    });
  });

  it("renders a log row that says the window moved, not that the deck was shuffled", () => {
    const start = parked(4006);
    const done = apply(start.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "orderCards", uids: [] },
    });
    const ctx: LogContext = {
      state: done.state,
      names: { p1: "You", p2: "Them" },
      elapsed: "+00:10",
    };
    const rows = logFromEvents([...done.events], ctx);
    const text = rows
      .flatMap((r) => (r.kind === "action" ? r.segments.map((seg) => seg.text) : []))
      .join(" | ");
    expect(text).toContain("shuffled the top 3 cards of their deck to the bottom of it");
  });

  it("the WIRE carries the alternative's caption to the answering seat", () => {
    const { state } = parked(4007);
    const view = redactGame(state, "p1");
    if (view.phase.kind !== "effect:choose") throw new Error("no prompt on the wire");
    const prompt = view.phase.prompt;
    if (prompt?.kind !== "orderCards") throw new Error("wrong wire prompt");
    expect(prompt.alt).toBe(ALT);
    // The caption is printed card text and hides nothing; the CANDIDATES are the
    // half that is gated, and the opponent's view has neither.
    const opponent = redactGame(state, "p2");
    if (opponent.phase.kind !== "effect:choose") throw new Error("no phase");
    expect(opponent.phase.prompt).toBeNull();
  });
});

describe("D344 — the empty ordering is legal EXACTLY where an alternative is printed", () => {
  it("a prompt with NO alternative still refuses it — the other four printings are untouched", () => {
    // 🛑 THE GUARD, FROM THE SIDE THAT MATTERS. Iron Valiant / Dottler /
    // Gothorita / Kofu print no `or`, and *"put them back in any order"* carries
    // no "you may": an empty answer there is not a decline and must stay refused.
    // Driven through a REAL parked prompt rather than by calling the validator,
    // so the licence really is the prompt's own field.
    const start = parked(4008);
    if (start.state.phase.kind !== "effect:choose") throw new Error("not parked");
    const withoutAlt: GameState = {
      ...start.state,
      phase: { ...start.state.phase, prompt: { ...start.state.phase.prompt, alt: undefined } },
    } as GameState;
    expectErr(
      withoutAlt,
      { type: "resolveEffect", seat: "p1", choice: { kind: "orderCards", uids: [] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("a PARTIAL answer is refused even where an alternative IS printed", () => {
    // The widening is `length === 0`, not `length <= candidates.length`. A short
    // answer would leave cards out of the deck entirely (the apply splices over
    // the first `uids.length` slots), which is the first of the three failures
    // the permutation check was written for.
    const start = parked(4009);
    if (start.state.phase.kind !== "effect:choose") throw new Error("not parked");
    const prompt = start.state.phase.prompt;
    if (prompt.kind !== "orderCards") throw new Error("wrong prompt");
    expectErr(
      start.state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "orderCards", uids: prompt.candidates.slice(0, 2) },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("an UNOFFERED uid is refused, alternative or no alternative", () => {
    const start = parked(4010);
    if (start.state.phase.kind !== "effect:choose") throw new Error("not parked");
    const prompt = start.state.phase.prompt;
    if (prompt.kind !== "orderCards") throw new Error("wrong prompt");
    const stranger = start.deck[5];
    if (stranger === undefined) throw new Error("deck too short to hold a stranger");
    expectErr(
      start.state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "orderCards", uids: [stranger, ...prompt.candidates.slice(0, 2)] },
      },
      "BAD_EFFECT_CHOICE",
    );
  });
});

describe("D344 — the degenerate decks, and why the M1 guard needed no second arm", () => {
  it("a deck of ONE card does not park, and the alternative does not run", () => {
    // `top.length` is `min(3, deck.length)`, so a 1-card deck makes both arms the
    // SAME STATE: shuffling that card onto the bottom of nothing leaves it on
    // top. The existing `top.length < 2` refusal is exactly right, and this is
    // the board that says so.
    const withHand = toHand(board(4011), KIT);
    const one = withHand.state.players.p1.deck.slice(0, 1);
    const staged = setDeck(withHand.state, one);
    const played = apply(staged, { type: "playTrainer", seat: "p1", uid: withHand.uid });
    expect(played.state.phase.kind).not.toBe("effect:choose");
    expect(played.state.players.p1.deck).toEqual(one);
    expect(find(played.events, "DECK_TOP_TO_BOTTOM")).toBeUndefined();
    // The LOOK is still announced, D241's rule: `count` is what was looked at.
    expect(find(played.events, "DECK_TOP_REORDERED")?.count).toBe(1);
  });

  it("a deck of TWO parks a two-card window and both arms are real", () => {
    // The other side of the same boundary: at 2 the arms diverge (an ordering of
    // two is a decision, and bottoming both is a rotation), so the park is owed.
    const withHand = toHand(board(4012), KIT);
    const two = withHand.state.players.p1.deck.slice(0, 2);
    const staged = setDeck(withHand.state, two);
    const played = apply(staged, { type: "playTrainer", seat: "p1", uid: withHand.uid });
    if (played.state.phase.kind !== "effect:choose") throw new Error("expected the park");
    const prompt = played.state.phase.prompt;
    if (prompt.kind !== "orderCards") throw new Error("wrong prompt");
    expect(prompt.candidates).toEqual(two);
    expect(prompt.alt).toBe(ALT);
    // …and the alternative bottoms the whole two-card deck, which is a permutation
    // of it — the count is the LIVE window, never the printed 3.
    const done = apply(played.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "orderCards", uids: [] },
    });
    expect(find(done.events, "DECK_TOP_TO_BOTTOM")?.count).toBe(2);
    expect([...done.state.players.p1.deck].sort()).toEqual([...two].sort());
  });

  it("an EMPTY deck plays the Item for nothing, and that is the family's precedent", () => {
    // `programPlayable` has no `reorderTop` arm and needs none: the refusals that
    // file makes are about a board that can offer no target at all, and a deck is
    // a target even when it is empty (Poké Ball's "a deck search is always
    // playable enough"). Pinned so a later slice adding a gate has to mean it.
    const withHand = toHand(board(4013), KIT);
    const staged = setDeck(withHand.state, []);
    const played = apply(staged, { type: "playTrainer", seat: "p1", uid: withHand.uid });
    expect(played.state.phase.kind).not.toBe("effect:choose");
    expect(played.state.players.p1.deck).toEqual([]);
    expect(find(played.events, "DECK_TOP_TO_BOTTOM")).toBeUndefined();
  });
});

describe("D344 — the version", () => {
  it("moved past 0.249.0 with the op, the fields and the event, and the two files agree", () => {
    // The TIE, not the literal — `fanCall.test.ts` owns the manifest comparison.
    expect(engineVersion >= "0.250.0").toBe(true);
  });
});
