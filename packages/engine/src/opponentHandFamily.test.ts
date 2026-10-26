import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effectTypes";
import type { GameEvent } from "./events";
import type { GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { redactGame } from "./redact";
import { programFor } from "./registry";
import { nextU32, randomIndex, shuffle } from "./rng";
import {
  FIXTURE_POOL,
  OPPONENT_HAND_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
} from "./testFixtures";

const CLAUSES = [
  {
    text: "Your opponent reveals their hand.",
    ops: [{ op: "revealOpponentHand" }],
    legalPrintings: 7,
    // sv05-126 Hoothoot, sv06-066 Shinx, sv06.5-016 Drowzee, sv08-084 Espurr,
    // sv10.5b-071 / sv10.5b-148 Pidove, svp-185 Yanma
    index: 25,
  },
  {
    text: "Discard a random card from your opponent's hand.",
    ops: [{ op: "randomFromOpponentHand", to: "discard" }],
    legalPrintings: 8,
    // sv07-083 Mienfoo, sv08.5-034 / sv08.5-155 / svp-175 Espeon ex,
    // sv08.5-064 Tyranitar ex, sv10-085 Team Rocket's Chingling,
    // sv10.5w-056 / sv10.5w-137 Liepard
    index: 26,
  },
  {
    text: "Choose a random card from your opponent's hand. Your opponent reveals that card and shuffles it into their deck.",
    ops: [{ op: "randomFromOpponentHand", to: "deck" }],
    legalPrintings: 5,
    // sv06-051 Snorunt, sv10-077 / sv10-197 Rotom,
    // sv10-149 / sv10-203 Team Rocket's Meowth
    index: 27,
  },
  {
    text: "Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck.",
    ops: [{ op: "bottomFromOpponentHand" }],
    legalPrintings: 1, // sv09-096 N's Purrloin
    index: 28,
  },
] as const satisfies readonly {
  text: string;
  ops: readonly EffectOp[];
  legalPrintings: number;
  index: number;
}[];

const ROTATED: readonly (readonly [string, readonly EffectOp[] | null, string])[] = [
  [
    "Choose 2 random cards from your opponent's hand. Your opponent reveals those cards and shuffles them into their deck.",
    null,
    "a COUNT the op has no field for — and the only printing of it in the whole 3,786-row catalog is rotated, which is precisely why `count` was not built (D104's minimal shape)",
  ],
  [
    "Flip a coin. If heads, discard a random card from your opponent's hand.",
    null,
    "a coin-gated sibling (2 printings): `coinFlipGate` exists and would hold it, but no legal printing drives the composition",
  ],
  [
    "Flip a coin until you get tails. For each heads, discard a random card from your opponent's hand.",
    null,
    "the unbounded fold (D129) over this op — no legal printing",
  ],
  [
    "Discard a random card from your opponent's hand. Discard the top card of your opponent's deck.",
    null,
    "a two-op COMPOUND; both ops exist, the whole-sentence anchor does not admit the pair",
  ],
];

const DEFERRED: readonly (readonly [string, string, number])[] = [
  [
    "Flip 3 coins. For each heads, discard a random card from your opponent's hand.",
    "`programPerHeads` over the built op (D130) — the composition, not the op",
    1,
  ],
];

const REVEAL_COPY_BUILT_AT_D580 =
  "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.";

const SEE_THROUGH = 25; // the bare reveal
const KNOCK_OFF = 26; // the random discard
const ASTONISH = 27; // the random shuffle-back
const THIEVING_SWIPE = 28; // the unfiltered reveal-and-bottom, on an M5 op

const SEED = 20260806;

/** The seven DISTINCT ids the opponent's hand is rebuilt from. Distinctness is
    the whole design: the taken uid is read back by CARD ID, so a build that
    always took index 0 (or the last, or ignored `rngState`) is visible. */
const OPP_HAND = [
  "fix-item",
  "fix-tool",
  "fix-gatedsup",
  "fix-stadium",
  "fix-energy",
  "fix-basic-1",
  "fix-trainerops",
] as const;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: OPPONENT_HAND_DECK, p2: OPPONENT_HAND_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** Rebuild `seat`'s HAND outright: every dealt card back into the deck, then
    exactly `ids` dealt off it (revealBottom.test.ts's `withHand`, which this file
    needs for the same reason — the opponent's hand is the zone under test). */
function withHand(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  let next: GameState = {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, hand: [], deck: [...side.deck, ...side.hand] },
    },
  };
  for (const id of ids) next = handFromDeck(next, seat, id, 1);
  return next;
}

/** P1 attacks with `fix-trainerops`, one {C} attached; P2 fields a body of its
    own and holds `hand`. */
function ready(hand: readonly string[] = OPP_HAND, seed = SEED): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  state = setActiveFromDeck(state, "p2", "fix-basic-1");
  return withHand(state, "p2", hand);
}

const attack = (state: GameState, index: number) =>
  mustApply(state, { type: "attack", seat: "p1", index });

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

function familyRow(state: GameState, events: GameEvent[], needle: string): string {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  const row = logFromEvents(events, ctx).find(
    (r) => r.kind === "action" && r.segments.some((s) => s.text.includes(needle)),
  );
  if (row === undefined || row.kind !== "action") throw new Error(`no row mentioning ${needle}`);
  return row.segments.map((s) => s.text).join("");
}

describe("D232 — the opponent-hand family's census", () => {
  it("adds up to the 21 legal ATTACK printings this slice builds", () => {
    const total = CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0);
    expect(total).toBe(21);
    expect(CLAUSES.map((c) => c.legalPrintings)).toEqual([7, 8, 5, 1]);
  });

  it("is 4 ARMS and 2 NEW OPS — the row said ~14 arms and 2 ops", () => {
    expect(CLAUSES).toHaveLength(4);
    const ops = new Set(CLAUSES.flatMap((c) => c.ops.map((o) => o.op)));
    expect([...ops].sort()).toEqual([
      "bottomFromOpponentHand",
      "randomFromOpponentHand",
      "revealOpponentHand",
    ]);
  });

  it("prices the THREE legal printings still unbuilt, and they are all compounds", () => {
    const left = DEFERRED.reduce((sum, [, , n]) => sum + n, 0);
    expect(left).toBe(1);
    const builtElsewhere = 9;
    expect(left + 21 + builtElsewhere).toBe(31);
    expect(left + 21 + builtElsewhere).not.toBe(35);
    for (const [sentence] of DEFERRED) {
      expect(CLAUSES.some((c) => c.text === sentence)).toBe(false);
    }
  });

  it("D580 — the Supporter copy left DEFERRED as a REGISTRY row: the reader still refuses it", () => {
    expect(DEFERRED.some(([sentence]) => sentence === REVEAL_COPY_BUILT_AT_D580)).toBe(false);
    expect(deriveAttackEffect(REVEAL_COPY_BUILT_AT_D580)).toBeNull();
    expect(programFor("sv05-063")?.attack?.[0]).toEqual([
      { op: "revealOpponentHand" },
      { op: "useOpponentSupporterEffect" },
    ]);
  });
});

// ── 2. The deriver: three anchors, and what they REFUSE ──────────────────────

describe("D232 — deriveAttackEffect over the three printed sentences", () => {
  for (const clause of CLAUSES) {
    it(`derives ${JSON.stringify(clause.text.slice(0, 48))}…`, () => {
      expect(deriveAttackEffect(clause.text)).toEqual(clause.ops);
    });
  }

  it("reads the sentences OFF THE FIXTURE, not off this file's copies", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    for (const clause of CLAUSES) {
      expect(attacks[clause.index]?.effect).toBe(clause.text);
      expect(deriveAttackEffect(attacks[clause.index]?.effect ?? "")).toEqual(clause.ops);
    }
    // …and no fixture attack prints damage on any of the three (the divergence the
    // fixture comment declares, asserted rather than described).
    for (const clause of CLAUSES) expect(attacks[clause.index]?.damage).toBeUndefined();
  });

  it("reads the U+2019 spelling identically — and NO printing of it exists", () => {
    for (const clause of CLAUSES) {
      const curly = clause.text.replaceAll("'", "’");
      if (curly === clause.text) continue;
      expect(deriveAttackEffect(curly)).toEqual(clause.ops);
    }
    // The rewrite actually fired on two of the three (the bare reveal has no
    // apostrophe at all) — otherwise the loop above asserts nothing.
    expect(CLAUSES.filter((c) => c.text.includes("'"))).toHaveLength(2);
  });

  for (const [sentence, expected, why] of ROTATED) {
    it(`refuses the rotated ${JSON.stringify(sentence.slice(0, 40))}… — ${why.slice(0, 40)}…`, () => {
      expect(deriveAttackEffect(sentence)).toEqual(expected);
    });
  }

  for (const [sentence, why, n] of DEFERRED) {
    it(`leaves ${n} printing(s) of ${JSON.stringify(sentence.slice(0, 36))}… — ${why.slice(0, 36)}…`, () => {
      // Every one lands on the loud ATTACK_EFFECT_SKIPPED path rather than
      // deriving half of what it prints (D190b's exact-map-or-flag rule).
      expect(deriveAttackEffect(sentence)).toBeNull();
    });
  }

  it("anchors WHOLE — a leading or trailing clause is refused, both directions", () => {
    for (const clause of CLAUSES) {
      expect(
        deriveAttackEffect(`If heads, ${clause.text[0]?.toLowerCase()}${clause.text.slice(1)}`),
      ).toBeNull();
      expect(deriveAttackEffect(`${clause.text} Draw a card.`)).toBeNull();
    }
  });
});

// ── 3. The bare reveal, and WHERE THE INFORMATION GOES ───────────────────────

describe("D232 — 'Your opponent reveals their hand.' (7 legal)", () => {
  it("reveals every uid, moves nothing, and ends the turn", () => {
    const state = ready();
    const before = [...state.players.p2.hand];
    const { state: done, events } = attack(deepFreeze(state), SEE_THROUGH);
    expect(findEvent(events, "HAND_REVEALED")?.seat).toBe("p2");
    expect(findEvent(events, "HAND_REVEALED")?.uids).toEqual(before);
    expect(done.players.p2.discard).toEqual(state.players.p2.discard);
    expect(done.players.p2.deck).toEqual(state.players.p2.deck.slice(1));
    // …and P2's hand is `before` plus exactly that draw.
    expect(done.players.p2.hand.slice(0, before.length)).toEqual(before);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("takes NO rng — a reveal is not a draw", () => {
    const state = ready();
    const events: GameEvent[] = [];
    const result = runProgram(state, [{ op: "revealOpponentHand" }], { seat: "p1" }, {}, events);
    if (result.kind !== "done") throw new Error("a reveal must not park");
    expect(result.state.rngState).toBe(state.rngState);
    expect(types(events)).toEqual(["HAND_REVEALED"]);
  });

  it("reveals an EMPTY hand honestly, as zero uids", () => {
    const { state: done, events } = attack(ready([]), SEE_THROUGH);
    expect(findEvent(events, "HAND_REVEALED")?.uids).toEqual([]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("names the cards in the LOG — the only channel the reveal has", () => {
    const { state: done, events } = attack(ready(["fix-item", "fix-stadium"]), SEE_THROUGH);
    const row = familyRow(done, events, "revealed their hand");
    expect(row).toContain("fix-item");
    expect(row).toContain("fix-stadium");
  });

  it("leaves `redact.ts` at ZERO — the opponent's hand stays FACE DOWN", () => {
    const state = ready();
    const { state: done } = attack(state, SEE_THROUGH);
    for (const [viewer, spectating] of [
      ["p1", false],
      ["p2", false],
      ["p1", true],
    ] as const) {
      const view = redactGame(done, viewer, spectating);
      const oppHand = view.board.opponent.hand;
      // Every projected opponent card is a face-down back with a POSITIONAL id —
      // no engine uid, no catalog id, no name.
      for (const card of oppHand) {
        expect(card.id).toMatch(/^opponent-hand-\d+$/);
        expect(card.cardId).toBe("hidden");
      }
    }
    // And the control: the same redactor DOES name a card the moment one is
    // genuinely public — P1's own hand, face up to P1.
    expect(redactGame(done, "p1").board.you.hand.every((c) => c.cardId !== "hidden")).toBe(true);
  });
});

// ── 4. The random pick: is it random, and is it REPRODUCIBLE ─────────────────

describe("D232 — 'Discard a random card from your opponent's hand.' (8 legal)", () => {
  it("moves ONE card from the opponent's hand to their OWN discard", () => {
    const state = ready();
    const before = [...state.players.p2.hand];
    const { state: done, events } = attack(deepFreeze(state), KNOCK_OFF);
    const taken = findEvent(events, "RANDOM_CARD_TAKEN");
    expect(taken?.seat).toBe("p2"); // whose hand and whose discard
    expect(taken?.actor).toBe("p1"); // who did it
    expect(taken?.to).toBe("discard");
    expect(before).toContain(taken?.uid);
    // The card is in P2's discard, and P1's discard did not move.
    expect(done.players.p2.discard).toContain(taken?.uid);
    expect(done.players.p1.discard).toEqual(state.players.p1.discard);
    // Card conservation on the hand: `before` minus exactly the taken uid, plus
    // P2's own turn-start draw (the attack ended P1's turn).
    expect(done.players.p2.hand.slice(0, before.length - 1)).toEqual(
      before.filter((u) => u !== taken?.uid),
    );
  });

  it("the pick is NOT a fixed index — several seeds take several positions", () => {
    // The assertion (b) at the head of this file exists for. A build that always
    // took hand index 0 — or the last — passes every count assertion in this repo.
    const picked = new Set<number>();
    for (let bump = 0; bump < 24; bump++) {
      const base = ready();
      const state: GameState = { ...base, rngState: (base.rngState + bump * 7919) | 0 };
      const hand = [...state.players.p2.hand];
      const { events } = attack(state, KNOCK_OFF);
      const uid = findEvent(events, "RANDOM_CARD_TAKEN")?.uid as string;
      picked.add(hand.indexOf(uid));
    }
    expect(picked.size).toBeGreaterThan(1);
    // Specifically: an interior index is reachable, so neither `0` nor
    // `hand.length - 1` can be hard-coded.
    expect([...picked].some((i) => i > 0 && i < OPP_HAND.length - 1)).toBe(true);
    expect(picked.has(0) && picked.size === 1).toBe(false);
  });

  it("the pick is exactly `randomIndex` over the LIVE hand — spelled independently", () => {
    const state = ready();
    const hand = [...state.players.p2.hand];
    const [value] = nextU32(state.rngState);
    const expected = hand[Math.floor((value / 4294967296) * hand.length)];
    const { events } = attack(state, KNOCK_OFF);
    expect(findEvent(events, "RANDOM_CARD_TAKEN")?.uid).toBe(expected);
  });

  it("REPLAYS: the same state picks the same card and lands on the same rngState", () => {
    // The whole seed argument, as behaviour. `rngState` is a field of `GameState`
    // and `MatchRecord` persists the whole `GameState`, so an online match resumed
    // from storage picks the card it already picked.
    const state = ready();
    const a = attack(deepFreeze(state), KNOCK_OFF);
    const b = attack(deepFreeze(state), KNOCK_OFF);
    expect(findEvent(a.events, "RANDOM_CARD_TAKEN")?.uid).toBe(
      findEvent(b.events, "RANDOM_CARD_TAKEN")?.uid,
    );
    expect(a.state.rngState).toBe(b.state.rngState);
    // …and a DIFFERENT rngState is a different run — otherwise the equality above
    // would hold for a build that ignored the RNG entirely.
    const moved: GameState = { ...state, rngState: (state.rngState + 1) | 0 };
    expect(attack(moved, KNOCK_OFF).state.rngState).not.toBe(a.state.rngState);
  });

  it("an EMPTY hand takes nothing, says nothing, AND ADVANCES NO RNG", () => {
    const state = ready([]);
    const events: GameEvent[] = [];
    const result = runProgram(
      state,
      [{ op: "randomFromOpponentHand", to: "discard" }],
      { seat: "p1" },
      {},
      events,
    );
    if (result.kind !== "done") throw new Error("this op never parks");
    expect(events).toEqual([]);
    expect(result.state.rngState).toBe(state.rngState);
    expect(result.state).toEqual(state);
  });

  it("takes ONE card from a ONE-card hand — the single-candidate board", () => {
    const state = ready(["fix-stadium"]);
    const held = state.players.p2.hand[0];
    const { state: done, events } = attack(state, KNOCK_OFF);
    expect(findEvent(events, "RANDOM_CARD_TAKEN")?.uid).toBe(held);
    expect(done.players.p2.discard).toContain(held);
  });

  it("names the card in the LOG, with the word 'random' in it", () => {
    const { state: done, events } = attack(ready(["fix-stadium"]), KNOCK_OFF);
    const row = familyRow(done, events, "at random");
    expect(row).toBe("took fix-stadium at random from Tide's hand and discarded it");
    expect(row).toContain("at random");
  });

  it("the discarded card becomes PUBLIC to both seats — §2", () => {
    const { state: done, events } = attack(ready(), KNOCK_OFF);
    const uid = findEvent(events, "RANDOM_CARD_TAKEN")?.uid as string;
    // The controller can now see it, in the opponent's discard, by identity.
    const p1View = redactGame(done, "p1");
    expect(p1View.board.opponent.discard.map((c) => c.id)).toContain(uid);
    // …and the REST of the hand is still shut, which is the printed difference
    // between this family and the reveal one.
    for (const card of p1View.board.opponent.hand) expect(card.cardId).toBe("hidden");
  });
});

describe("D232 — 'Choose a random card … shuffles it into their deck.' (5 legal)", () => {
  it("moves ONE card from the opponent's hand into their OWN deck, and shuffles", () => {
    const state = ready();
    const before = [...state.players.p2.hand];
    const deckBefore = state.players.p2.deck.length;
    const { state: done, events } = attack(deepFreeze(state), ASTONISH);
    const taken = findEvent(events, "RANDOM_CARD_TAKEN");
    expect(taken?.to).toBe("deck");
    expect(before).toContain(taken?.uid);
    expect(done.players.p2.deck).toContain(taken?.uid);
    expect(done.players.p2.discard).toEqual(state.players.p2.discard);
    // The deck grew by the card and shrank by P2's own turn-start draw.
    expect(done.players.p2.deck).toHaveLength(deckBefore + 1 - 1);
    // The SHUFFLE is on the OWNER's seat and is emitted — a build that appended
    // without shuffling would leave a known card the owner is about to draw.
    expect(findEvent(events, "SHUFFLE")?.seat).toBe("p2");
  });

  it("the position is genuinely LOST — the deck is reordered, not appended to", () => {
    const state = ready();
    const before = [...state.players.p2.deck];
    const events: GameEvent[] = [];
    const result = runProgram(
      state,
      [{ op: "randomFromOpponentHand", to: "deck" }],
      { seat: "p1" },
      {},
      events,
    );
    if (result.kind !== "done") throw new Error("this op never parks");
    const after = result.state.players.p2.deck;
    const uid = findEvent(events, "RANDOM_CARD_TAKEN")?.uid as string;
    // Same multiset, different order — and the card is NOT sitting on either end,
    // which is what "appended and then shuffled" has to mean.
    expect([...after].sort()).toEqual([...before, uid].sort());
    expect(after).not.toEqual([...before, uid]);
    expect(after.at(-1)).not.toBe(uid);
  });

  it("takes TWO rng steps (the pick, then the shuffle) — the discard route takes ONE", () => {
    // A structural claim about the two routes, asserted by walking the generator
    // by hand: one `nextU32` for the pick, then `shuffle` over the grown deck.
    const state = ready();
    const hand = [...state.players.p2.hand];
    const [value, afterPick] = nextU32(state.rngState);
    const uid = hand[Math.floor((value / 4294967296) * hand.length)] as string;
    const [, afterShuffle] = shuffle([...state.players.p2.deck, uid], afterPick);

    const discard: GameEvent[] = [];
    const one = runProgram(
      state,
      [{ op: "randomFromOpponentHand", to: "discard" }],
      { seat: "p1" },
      {},
      discard,
    );
    const deck: GameEvent[] = [];
    const two = runProgram(
      state,
      [{ op: "randomFromOpponentHand", to: "deck" }],
      { seat: "p1" },
      {},
      deck,
    );
    if (one.kind !== "done" || two.kind !== "done") throw new Error("neither route parks");
    expect(one.state.rngState).toBe(afterPick);
    expect(two.state.rngState).toBe(afterShuffle);
    // Both routes picked the SAME card — the destination cannot change the draw.
    expect(findEvent(discard, "RANDOM_CARD_TAKEN")?.uid).toBe(uid);
    expect(findEvent(deck, "RANDOM_CARD_TAKEN")?.uid).toBe(uid);
  });

  it("an EMPTY hand shuffles NOTHING — no SHUFFLE event, no rng", () => {
    const state = ready([]);
    const events: GameEvent[] = [];
    const result = runProgram(
      state,
      [{ op: "randomFromOpponentHand", to: "deck" }],
      { seat: "p1" },
      {},
      events,
    );
    if (result.kind !== "done") throw new Error("this op never parks");
    expect(events).toEqual([]);
    expect(result.state.rngState).toBe(state.rngState);
  });

  it("names the card in the LOG and says where it went", () => {
    const { state: done, events } = attack(ready(["fix-tool"]), ASTONISH);
    expect(familyRow(done, events, "at random")).toBe(
      "took fix-tool at random from Tide's hand and shuffled it into their deck",
    );
    const ctx: LogContext = { names: NAMES, state: done, elapsed: formatElapsed(0) };
    const shuffleRow = logFromEvents(events, ctx).find(
      (r) => r.kind === "action" && r.segments.some((s) => s.text === "shuffled their deck"),
    );
    expect(shuffleRow?.kind === "action" ? shuffleRow.who : null).toBe("p2");
  });

  it("the card is NOT public afterwards — the deck is count-only", () => {
    const { state: done, events } = attack(ready(), ASTONISH);
    const uid = findEvent(events, "RANDOM_CARD_TAKEN")?.uid as string;
    const p1View = redactGame(done, "p1");
    expect(p1View.board.opponent.discard.map((c) => c.id)).not.toContain(uid);
    // `deckCount` is the whole projection of a deck — no uid can appear.
    expect(JSON.stringify(p1View)).not.toContain(uid);
  });
});

// ── 4b. The fourth sentence: an op that already existed, unread ──────────────

describe("D232 — N's Purrloin sv09-096, the UNFILTERED reveal-and-bottom (1 legal)", () => {
  it("parks the pick with the card's OWN printed sentence as the note", () => {
    const state = ready();
    const oppHand = [...state.players.p2.hand];
    const { state: parked, events } = attack(deepFreeze(state), THIEVING_SWIPE);
    expect(findEvent(events, "HAND_REVEALED")?.uids).toEqual(oppHand);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the pick park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.note).toBe(CLAUSES[3].text);
    // UNFILTERED: every one of the seven distinct classes is on offer, which is
    // the whole difference from Greavard's Supporter-narrowed twin.
    expect(prompt.candidates).toEqual(oppHand);
    const picked = oppHand[3] as string;
    const { state: done, events: resolved } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [picked] },
    });
    expect(findEvent(resolved, "CARD_TO_BOTTOM_OF_DECK")?.uid).toBe(picked);
    expect(done.players.p2.deck.at(-1)).toBe(picked);
  });

  it("shares ONE reveal spelling with the two new ops — `revealHand`", () => {
    const state = ready();
    const oppHand = [...state.players.p2.hand];
    for (const index of [SEE_THROUGH, THIEVING_SWIPE]) {
      const { events } = attack(state, index);
      expect(findEvent(events, "HAND_REVEALED")?.seat).toBe("p2");
      expect(findEvent(events, "HAND_REVEALED")?.uids).toEqual(oppHand);
    }
  });
});

describe("D232 — the read sites, measured rather than assumed", () => {
  it("`programPlayable` owes NO arm — no printing of this family is a played card", () => {
    const empty = ready([]);
    expect(programPlayable(empty, [{ op: "revealOpponentHand" }], "p1")).toBe(true);
    expect(programPlayable(empty, [{ op: "randomFromOpponentHand", to: "discard" }], "p1")).toBe(
      true,
    );
    // …and the CONTROL on the same board: the op that DOES carry the gate refuses.
    expect(programPlayable(empty, [{ op: "bottomFromOpponentHand" }], "p1")).toBe(false);
  });

  it("all three attacks are declarable into an EMPTY opponent hand (§8.6)", () => {
    for (const index of [SEE_THROUGH, KNOCK_OFF, ASTONISH]) {
      const { state: done } = attack(ready([]), index);
      expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    }
  });

  it("`MATCH_RECORD_VERSION` STAYS 12 — the derivation, not the habit", () => {
    for (const index of [SEE_THROUGH, KNOCK_OFF, ASTONISH]) {
      const { state: done } = attack(ready(), index);
      expect(done.phase.kind).toBe("turn:action");
    }
    const events: GameEvent[] = [];
    for (const op of [
      { op: "revealOpponentHand" },
      { op: "randomFromOpponentHand", to: "discard" },
      { op: "randomFromOpponentHand", to: "deck" },
    ] as const) {
      expect(runProgram(ready(), [op], { seat: "p1" }, {}, events).kind).toBe("done");
    }
  });

  it("`randomIndex` is the arithmetic `shuffle` always used — the extraction is exact", () => {
    for (let s = -5; s <= 5; s++) {
      for (const count of [1, 2, 7, 13, 60]) {
        const [value, next] = nextU32(s);
        expect(randomIndex(count, s)).toEqual([Math.floor((value / 4294967296) * count), next]);
      }
    }
    // The zero case takes NO step — the branch the empty-hand whiff rides.
    expect(randomIndex(0, 12345)).toEqual([0, 12345]);
    // …and every index it ever returns is in range.
    for (let s = 0; s < 200; s++) {
      const [i] = randomIndex(7, s);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(7);
    }
  });
});
