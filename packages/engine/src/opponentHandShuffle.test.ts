import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { EffectOp } from "./effectTypes";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, redactGame } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { runProgram } from "./interpreter";
import { phaseViewOf } from "./phaseView";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
  driveSetup,
  roundTrip,
} from "./testFixtures";

const SENTENCE =
  "Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.";

const FAMILY = [
  {
    text: "Your opponent discards 2 cards from their hand.",
    ops: [{ op: "opponentDiscardsFromHand", count: 2 }],
    printings: 4,
  },
  {
    text: "Your opponent discards a card from their hand.",
    ops: [{ op: "opponentDiscardsFromHand", count: 1 }],
    printings: 2,
  },
  {
    text: "Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards.",
    ops: [
      { op: "opponentDiscardsFromHand", count: 1 },
      {
        op: "conditionGate",
        cond: { kind: "yourActiveEvolvedFromThisTurn", name: "Salandit" },
        ops: [{ op: "opponentDiscardsFromHand", count: 2 }],
      },
    ],
    printings: 1,
  },
  {
    text: "Discard a card from your hand. If you do, your opponent discards a card from their hand.",
    ops: undefined,
    printings: 1,
  },
] as const satisfies readonly {
  text: string;
  ops: readonly EffectOp[] | undefined;
  printings: number;
}[];

const PROGRAM: readonly EffectOp[] = [
  { op: "opponentDiscardsFromHand", count: 3, to: "deck" },
  { op: "shuffleDeck", whose: "opponent" },
];

const SHUFFLE = 0; // {C}, no damage — the sentence
const PLAIN = 1; // {C}, no damage, NO effect — the one-axis control
const DISCARD_TWO = 2; // {C}, no damage — the BUILT sibling, same board, other destination

const LOCAL_CARDS: Record<string, Card> = {
  "d542-shuffler": battler("d542-shuffler", {
    types: ["Colorless"],
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Hand Reshuffle", effect: SENTENCE },
      { cost: ["Colorless"], name: "Plain Call" },
      { cost: ["Colorless"], name: "Hand Purge", effect: FAMILY[0].text },
    ],
  }),
  "d542-wall": battler("d542-wall", { types: ["Colorless"], hp: 300, retreat: 1 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const HAND_IDS = ["fix-item", "fix-tool", "fix-gatedsup", "fix-stadium", "fix-energy"] as const;

const SHUFFLE_DECK = deckOf({
  "d542-shuffler": 4,
  "d542-wall": 4,
  "fix-basic-1": 8,
  "fix-item": 8,
  "fix-tool": 8,
  "fix-gatedsup": 4,
  "fix-stadium": 4,
  "fix-energy": 20,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };
const SEED = 20260922;

const other = (seat: Seat): Seat => (seat === "p1" ? "p2" : "p1");

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: SHUFFLE_DECK, p2: SHUFFLE_DECK }, { pool: POOL, first });
}

/** Rebuild `seat`'s HAND outright — the opponent's hand IS the zone under test and
    every board below has to field it at an exact size. */
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

function ready(hand: readonly string[] = HAND_IDS, attacker: Seat = "p1", seed = SEED): GameState {
  const opponent = other(attacker);
  let state = localSetup(seed, attacker);
  state = mustApply(state, { type: "endTurn", seat: attacker }).state;
  state = mustApply(state, { type: "endTurn", seat: opponent }).state;
  state = setActiveFromDeck(state, attacker, "d542-shuffler");
  state = attachFromDeck(state, attacker, "fix-energy", 1);
  state = clearBench(state, attacker);
  state = setActiveFromDeck(state, opponent, "d542-wall");
  state = clearBench(state, opponent);
  return withHand(state, opponent, hand);
}

const attack = (state: GameState, index: number, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index });

function parkedPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected the park, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "chooseCards") throw new Error("expected a chooseCards prompt");
  return prompt;
}

function answerWith(state: GameState, seat: Seat, uids: readonly string[]) {
  return mustApply(state, {
    type: "resolveEffect",
    seat,
    choice: { kind: "cards", uids: [...uids] },
  } satisfies GameAction);
}

function zones(state: GameState, seat: Seat) {
  const side = state.players[seat];
  return { hand: side.hand, deck: side.deck, discard: side.discard };
}

function rowText(state: GameState, events: GameEvent[], needle: string): string {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  const row = logFromEvents(events, ctx).find(
    (r) => r.kind === "action" && r.segments.some((s) => s.text.includes(needle)),
  );
  if (row === undefined || row.kind !== "action") throw new Error(`no row mentioning ${needle}`);
  return row.segments.map((s) => s.text).join("");
}

describe("§1 — the anchor, driven against the whole printed family", () => {
  it("derives to TWO SHIPPED OPS in printed order — and `to` is the only new byte", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual(PROGRAM);
    const [head] = deriveAttackEffect(SENTENCE) ?? [];
    if (head === undefined || head.op !== "opponentDiscardsFromHand") throw new Error("no head op");
    const { to, ...withoutTo } = head;
    expect(to).toBe("deck");
    expect(withoutTo).toEqual({ op: "opponentDiscardsFromHand", count: 3 });
    // …and that stripped object is exactly what the SIBLING sentence derives to one
    // count over, so the claim is anchored on a shipped reading and not on a shape.
    expect(deriveAttackEffect("Your opponent discards 3 cards from their hand.")).toEqual([
      withoutTo,
    ]);
  });

  it("THE FIVE-BY-FIVE MATRIX — every family sentence lands on its OWN reading", () => {
    for (const sibling of FAMILY) {
      const got = deriveAttackEffect(sibling.text);
      expect(got, sibling.text).not.toBeNull();
      if (sibling.ops !== undefined) expect(got, sibling.text).toEqual(sibling.ops);
      expect(got, sibling.text).not.toEqual(PROGRAM);
      // …nor does any of them carry the new field anywhere in its program.
      expect(JSON.stringify(got), sibling.text).not.toContain('"to":"deck"');
    }
    expect(new Set([SENTENCE, ...FAMILY.map((f) => f.text)]).size).toBe(5);
  });

  it("the UNPREFIXED CONTROL (D424): the bare sentence is what the reader answers to", () => {
    // Without this the two near-miss rungs below are tautologies — a build that
    // refused every string in this family would pass both of them.
    expect(resolvedByAnyReader(SENTENCE)).toBe(true);
    expect(deriveAttackEffect(SENTENCE)).not.toBeNull();
  });

  it("`^` — A PREFIX THAT KEEPS THE CAPITAL is refused (D539(1a))", () => {
    expect(deriveAttackEffect(`Flip a coin. ${SENTENCE}`)).toBeNull();
    expect(deriveAttackEffect(`If heads, ${SENTENCE}`)).toBeNull();
  });

  it("`$` — A TRAILING CLAUSE THAT KEEPS THE PERIOD is refused (D540(1a))", () => {
    expect(deriveAttackEffect(`${SENTENCE} Then, draw a card.`)).toBeNull();
    expect(deriveAttackEffect(`${SENTENCE} Draw a card.`)).toBeNull();
    expect(deriveAttackEffect(`${SENTENCE.slice(0, -1)} and draws a card.`)).toBeNull();
  });

  it("THE `3` IS A LITERAL, NOT A CAPTURE (D121's warrant, run not inherited)", () => {
    for (const n of [1, 2, 4, 10]) {
      const spelled = SENTENCE.split(" chooses 3 cards ").join(` chooses ${n} cards `);
      expect(deriveAttackEffect(spelled), spelled).toBeNull();
    }
    // …and the CONTROL: the one printed number still derives, so the loop above
    // cannot be passed by a build that refused the whole sentence.
    expect(deriveAttackEffect(SENTENCE)).toEqual(PROGRAM);
  });

  it("NO POSSESSIVE IS PRINTED, so NO `['’]` CLASS IS OWED (D137 does not reach it)", () => {
    const row = legalAttackCorpus().find(([, s]) => s === SENTENCE);
    expect(row).toBeDefined();
    expect(row?.[1]).not.toContain("'");
    expect(row?.[1]).not.toContain("’");
    expect(row?.[1]).toContain("their hand");
    expect(row?.[1]).toContain("their deck");
  });

  it("the sentence is read OFF THE FIXTURE, not off this file's copy (D183)", () => {
    const attacks = POOL["d542-shuffler"]?.attacks ?? [];
    expect(attacks[SHUFFLE]?.effect).toBe(SENTENCE);
    expect(attacks[PLAIN]?.effect).toBeUndefined();
    expect(attacks[DISCARD_TWO]?.effect).toBe(FAMILY[0].text);
    // NO printed base damage on any index: the sentence PARKS, and a base-damage
    // Knock Out would put a promotion prompt in front of the very `effect:choose`
    // phase every board below reads.
    for (const index of [SHUFFLE, PLAIN, DISCARD_TWO]) {
      expect(attacks[index]?.damage, `index ${index}`).toBeUndefined();
    }
  });

  it("neither splitter claims it — the row leaves through the READER summand", () => {
    expect(splitAttackTrailingClause(SENTENCE)).toBeNull();
    expect(splitAttackGateClause(SENTENCE)).toBeNull();
  });
});

describe("§2 — the corpus figures, read off the population", () => {
  it("the row is IN the legal attack column at 1 printing, exactly once", () => {
    const corpus = legalAttackCorpus();
    expect(corpus.length).toBe(640);
    expect(corpus.reduce((sum, [n]) => sum + n, 0)).toBe(1732);
    const hits = corpus.filter(([, s]) => s === SENTENCE);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.[0]).toBe(1);
    expect(corpus.findIndex(([, s]) => s === SENTENCE)).toBe(612);
  });

  it("THE FAMILY IS FIVE ROWS / NINE PRINTINGS, AND ALL FIVE NOW RESOLVE", () => {
    const corpus = legalAttackCorpus();
    const mentionsAHand = corpus.filter(([, s]) => /their hand|opponent's hand/i.test(s));
    expect(mentionsAHand.length).toBeGreaterThan(20);
    const family = mentionsAHand.filter(([, s]) =>
      /^Your opponent (?:discards|chooses)|your opponent discards/.test(s),
    );
    expect(family).toHaveLength(5);
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(9);
    for (const [, sentence] of family) {
      expect(resolvedByAnyReader(sentence), sentence).toBe(true);
    }
    expect(family.map(([, s]) => s).sort()).toEqual(
      [SENTENCE, ...FAMILY.map((f) => f.text)].sort(),
    );
    for (const sibling of FAMILY) {
      expect(family.find(([, s]) => s === sibling.text)?.[0], sibling.text).toBe(sibling.printings);
    }
  });
});

describe("§3 — the park, its decider and its redaction", () => {
  it("parks under the CONTROLLER with the OWNER as answerer", () => {
    const { state: parked, events } = attack(deepFreeze(ready()), SHUFFLE);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the park");
    expect(parked.phase.seat).toBe("p1");
    expect(parked.phase.answerer).toBe("p2");
    expect(findEvent(events, "EFFECT_PENDING")?.seat).toBe("p2");
  });

  it("MANDATORY AND EXACT AT THREE, INTO THE DECK", () => {
    const state = ready();
    const oppHand = [...state.players.p2.hand];
    const prompt = parkedPrompt(attack(state, SHUFFLE).state);
    expect(prompt.min).toBe(3);
    expect(prompt.max).toBe(3);
    expect(prompt.dest).toBe("deck");
    // The WHOLE hand is the offer — no interchangeable collapse, because the
    // answerer owns this hand and is looking at it.
    expect(prompt.candidates).toEqual(oppHand);
    expect(prompt.candidates.length).toBeGreaterThan(prompt.min);
  });

  it("THE CAPTION IS IN THE ANSWERER'S VOICE AND NAMES THE DECK", () => {
    const note = parkedPrompt(attack(ready(), SHUFFLE).state).note;
    expect(note).toBe("Shuffle 3 cards from your hand into your deck.");
    expect(note).not.toContain("Discard");
    expect(note).not.toBe(SENTENCE);
    // …and the CONTROL on the same board: the sibling's caption still says discard,
    // so a build that renamed the verb everywhere fails here (two spellings kept).
    expect(parkedPrompt(attack(ready(), DISCARD_TWO).state).note).toBe(
      "Discard 2 cards from your hand.",
    );
  });

  it("`redactedPromptOf` sends the uids to the OWNER ALONE", () => {
    // Both halves, from both chairs. A build that dropped `decider` would hand the
    // CONTROLLER a face-up list of the opponent's hidden hand AND the choice.
    const state = ready();
    const oppHand = [...state.players.p2.hand];
    const { state: parked } = attack(state, SHUFFLE);
    const actorView = redactGame(parked, "p1");
    if (actorView.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(actorView.phase.prompt).toBeNull();
    const wire = JSON.stringify(actorView);
    for (const uid of oppHand) expect(wire).not.toContain(`"${uid}"`);
    // …and the OWNER's snapshot DOES carry the prompt, which is the control.
    const ownerView = redactGame(parked, "p2");
    if (ownerView.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(ownerView.phase.prompt?.kind).toBe("chooseCards");
    const ownerWire = JSON.stringify(ownerView);
    for (const uid of oppHand) expect(ownerWire).toContain(`"${uid}"`);
  });

  it("the CONTROLLER's answer is refused and the OWNER's is accepted", () => {
    const { state: parked } = attack(ready(), SHUFFLE);
    const uids = parkedPrompt(parked).candidates.slice(0, 3);
    const bad = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [...uids] },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("WRONG_SEAT");
    const good = applyAction(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: [...uids] },
    });
    expect(good.ok).toBe(true);
  });

  it("the TURN does not move — the attacker keeps the glow, the owner waits", () => {
    const { state: parked } = attack(ready(), SHUFFLE);
    for (const viewer of ["p1", "p2"] as const) {
      const view = phaseViewOf(parked, viewer);
      expect(view.activeSeat, viewer).toBe("p1");
      expect(view.waitingSeat, viewer).toBe("p2");
    }
    expect(phaseViewOf(parked, "p1").pendingDecision).toBeNull();
    expect(phaseViewOf(parked, "p2").pendingDecision?.kind).toBe("effectChoose");
  });
});

describe("§4 — the picked cards land in the DECK and not in the discard", () => {
  it("OUT of the hand, IN the owner's DECK, NOT in the owner's discard", () => {
    const start = ready();
    const { state: parked } = attack(start, SHUFFLE);
    const picked = parkedPrompt(parked).candidates.slice(0, 3);
    const before = zones(parked, "p2");
    const { state } = answerWith(parked, "p2", picked);
    const after = zones(state, "p2");
    for (const uid of picked) {
      expect([...after.deck, ...after.hand], uid).toContain(uid);
      expect(after.discard, uid).not.toContain(uid);
    }
    expect(after.discard).toEqual(before.discard);
    // THE ZONE ARITHMETIC, which is what turns the union above into a statement
    // about the DECK: three cards left the hand for the deck and the turn-end draw
    // took one back, so the deck is up 2 and the hand is the 2 leftovers plus 1.
    expect(after.deck.length).toBe(before.deck.length + 2);
    expect(after.hand).toHaveLength(3);
    // At most ONE picked card can be back in hand (the single draw); a build that
    // returned the picks to the hand instead of the deck fails here.
    expect(picked.filter((uid) => after.hand.includes(uid)).length).toBeLessThanOrEqual(1);
    // Nothing anywhere gained or lost a card.
    expect(after.deck.length + after.hand.length + after.discard.length).toBe(
      before.deck.length + before.hand.length + before.discard.length,
    );
  });

  it("THE EVENT NAMES THE DECK, AND IT IS FILED UNDER THE OWNER", () => {
    const { state: parked } = attack(ready(), SHUFFLE);
    const picked = parkedPrompt(parked).candidates.slice(0, 3);
    const { events } = answerWith(parked, "p2", picked);
    const row = findEvent(events, "FORCED_HAND_DISCARD");
    expect(row?.seat).toBe("p2");
    expect(row?.to).toBe("deck");
    expect(row?.uids).toEqual([...picked]);
    expect(row === undefined ? true : "actor" in row).toBe(false);
  });

  it("the SIBLING on the same board still files the DISCARD arm — both spellings", () => {
    // The two-reasons rule: a build that made every `FORCED_HAND_DISCARD` a deck
    // move would pass the rung above and fail this one.
    const { state: parked } = attack(ready(), DISCARD_TWO);
    const picked = parkedPrompt(parked).candidates.slice(0, 2);
    const { state, events } = answerWith(parked, "p2", picked);
    const row = findEvent(events, "FORCED_HAND_DISCARD");
    expect(row?.to).toBeUndefined();
    for (const uid of picked) {
      expect(state.players.p2.discard).toContain(uid);
      expect(state.players.p2.deck).not.toContain(uid);
    }
  });
});

describe("§5 — the §8.6 short boards, on the arm §4 cannot reach", () => {
  it("an EMPTY hand moves no card and asks nothing — and the TAIL still runs", () => {
    const start = ready([]);
    const { state, events } = attack(start, SHUFFLE);
    expect(state.phase.kind).toBe("turn:action");
    expect(types(events)).not.toContain("FORCED_HAND_DISCARD");
    // The tail ran, on the OPPONENT's deck, and nothing crossed a zone boundary but
    // the turn-end draw.
    expect(types(events)).toContain("SHUFFLE");
    expect(findEvent(events, "SHUFFLE")?.seat).toBe("p2");
    expect(state.players.p2.hand).toHaveLength(1);
    expect(state.players.p2.deck.length).toBe(start.players.p2.deck.length - 1);
    expect(state.players.p2.discard).toEqual(start.players.p2.discard);
  });

  it("A HAND OF EXACTLY 3 IS FORCED — AND THE CARDS LAND IN THE DECK", () => {
    const start = ready(HAND_IDS.slice(0, 3));
    const hand = [...start.players.p2.hand];
    const before = zones(start, "p2");
    const { state, events } = attack(start, SHUFFLE);
    expect(state.phase.kind).toBe("turn:action"); // no question was asked
    expect(types(events)).not.toContain("EFFECT_PENDING");
    for (const uid of hand) {
      expect([...state.players.p2.deck, ...state.players.p2.hand], uid).toContain(uid);
      expect(state.players.p2.discard, uid).not.toContain(uid);
    }
    expect(state.players.p2.discard).toEqual(before.discard);
    // Three cards left the hand and the turn-end draw put one card back.
    expect(state.players.p2.hand).toHaveLength(1);
    expect(state.players.p2.deck.length).toBe(before.deck.length + 2);
    expect(findEvent(events, "FORCED_HAND_DISCARD")?.to).toBe("deck");
  });

  it("A HAND OF FEWER THAN 3 DOES WHAT IT CAN — into the DECK", () => {
    const start = ready(HAND_IDS.slice(0, 2));
    const hand = [...start.players.p2.hand];
    const { state, events } = attack(start, SHUFFLE);
    expect(state.phase.kind).toBe("turn:action");
    expect(findEvent(events, "FORCED_HAND_DISCARD")?.uids).toEqual(hand);
    expect(findEvent(events, "FORCED_HAND_DISCARD")?.to).toBe("deck");
    for (const uid of hand) {
      expect([...state.players.p2.deck, ...state.players.p2.hand], uid).toContain(uid);
      expect(state.players.p2.discard, uid).not.toContain(uid);
    }
    expect(state.players.p2.discard).toEqual(start.players.p2.discard);
  });

  it("the SIBLING's short board still discards — the forced arm's two spellings", () => {
    const start = ready(HAND_IDS.slice(0, 2));
    const hand = [...start.players.p2.hand];
    const { state } = attack(start, DISCARD_TWO);
    for (const uid of hand) {
      expect(state.players.p2.discard, uid).toContain(uid);
      expect(state.players.p2.deck, uid).not.toContain(uid);
      expect(state.players.p2.hand, uid).not.toContain(uid);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE TAIL: `shuffleDeck { whose: "opponent" }` runs AFTER the answer.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the printed shuffle, and whose deck it reaches", () => {
  it("the SHUFFLE lands on the OPPONENT's deck and rngState moves", () => {
    const { state: parked } = attack(ready(), SHUFFLE);
    const picked = parkedPrompt(parked).candidates.slice(0, 3);
    const attackerDeckBefore = [...parked.players.p1.deck];
    const { state, events } = answerWith(parked, "p2", picked);
    const shuffles = events.filter((e) => e.type === "SHUFFLE");
    expect(shuffles).toHaveLength(1);
    expect(shuffles[0]).toEqual({ type: "SHUFFLE", seat: "p2" });
    expect(state.rngState).not.toEqual(parked.rngState);
    // The ATTACKER's deck is byte-identical — the half `whose` is for.
    expect(state.players.p1.deck).toEqual(attackerDeckBefore);
    // …and the picked cards are NOT sitting in pick order on the tail of the deck,
    // which is what a dropped shuffle would leave. Asserted as "the tail is not the
    // pick", so it is a statement about the shuffle and not about a seed.
    expect(state.players.p2.deck.slice(-3)).not.toEqual([...picked]);
  });

  it("the SHUFFLE runs AFTER the hand move, not before — one event per thing", () => {
    const { state: parked } = attack(ready(), SHUFFLE);
    const picked = parkedPrompt(parked).candidates.slice(0, 3);
    const { events } = answerWith(parked, "p2", picked);
    const order = types(events);
    expect(order.indexOf("FORCED_HAND_DISCARD")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("SHUFFLE")).toBeGreaterThan(order.indexOf("FORCED_HAND_DISCARD"));
  });

  it("the SIBLING emits NO shuffle at all — the tail belongs to this arm alone", () => {
    const { state: parked } = attack(ready(), DISCARD_TWO);
    const picked = parkedPrompt(parked).candidates.slice(0, 2);
    const { state, events } = answerWith(parked, "p2", picked);
    expect(types(events)).not.toContain("SHUFFLE");
    expect(state.rngState).toEqual(parked.rngState);
  });
});

describe("§7 — the log row, both spellings", () => {
  it("the DECK arm speaks in COUNTS, names the deck, and does NOT say discard", () => {
    const { state: parked } = attack(ready(), SHUFFLE);
    const picked = parkedPrompt(parked).candidates.slice(0, 3);
    const { state, events } = answerWith(parked, "p2", picked);
    const text = rowText(state, events, "from their hand");
    expect(text).toContain("put 3 cards from their hand into their deck");
    expect(text).not.toContain("discard");
    for (const uid of picked) expect(text).not.toContain(uid);
  });

  it("the DISCARD arm still says discarded — both spellings kept", () => {
    const { state: parked } = attack(ready(), DISCARD_TWO);
    const picked = parkedPrompt(parked).candidates.slice(0, 2);
    const { state, events } = answerWith(parked, "p2", picked);
    const text = rowText(state, events, "from their hand");
    expect(text).toContain("discarded 2 cards from their hand");
    expect(text).not.toContain("into their deck");
  });

  it("the singular renders as ONE CARD on the deck arm too", () => {
    // The forced short board at a hand of one: the count is board-derived, so the
    // singular is reachable from print even though the printed count is 3.
    const start = ready(HAND_IDS.slice(0, 1));
    const { state, events } = attack(start, SHUFFLE);
    expect(rowText(state, events, "from their hand")).toContain(
      "put 1 card from their hand into their deck",
    );
  });
});

describe("§8 — the prompt shape the HUDs' Confirm-verb tables read", () => {
  it('THE FIRST MANDATORY `dest: "deck"` PARK IN THIS ENGINE', () => {
    const prompt = parkedPrompt(attack(ready(), SHUFFLE).state);
    expect(prompt.dest).toBe("deck");
    expect(prompt.min).toBeGreaterThan(0);
    expect(prompt.min).toBe(prompt.max);
  });
});

describe("§8b — the gate caption names the DECK, driven from a hand-built program", () => {
  /** The note on the §9.2 payment park for `[payFromHand, recordGate → ops]`. */
  const gatedNote = (inner: readonly EffectOp[]): string => {
    const board = ready();
    const result = runProgram(
      board,
      [
        { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
        { op: "recordGate", slot: "paid", ops: [...inner] },
      ],
      { seat: "p1" },
      {},
      [],
    );
    if (result.kind !== "parked") throw new Error("expected a park");
    if (result.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    return result.prompt.note;
  };

  it("THE DECK BRANCH SAYS DECK — and it is unreachable from print, so it is DRIVEN", () => {
    expect(gatedNote([{ op: "opponentDiscardsFromHand", count: 3, to: "deck" }])).toBe(
      "Discard a card from your hand. If you do, your opponent shuffles 3 cards from their hand into their deck.",
    );
    expect(gatedNote([{ op: "opponentDiscardsFromHand", count: 1, to: "deck" }])).toBe(
      "Discard a card from your hand. If you do, your opponent shuffles a card from their hand into their deck.",
    );
  });

  it("the DISCARD branch is UNMOVED — both spellings, on one board", () => {
    // The two-reasons rule: a build that rewrote the phrase for every destination
    // passes the rung above and fails this one.
    expect(gatedNote([{ op: "opponentDiscardsFromHand", count: 1 }])).toBe(
      "Discard a card from your hand. If you do, your opponent discards a card from their hand.",
    );
    expect(gatedNote([{ op: "opponentDiscardsFromHand", count: 3 }])).toBe(
      "Discard a card from your hand. If you do, your opponent discards 3 cards from their hand.",
    );
  });
});

describe("§9 — the persisted op, over the serialized bytes", () => {
  it('`"cont" in phase` IS TRUE and the new field IS in the bytes', () => {
    const { state } = attack(ready(), SHUFFLE);
    const phase = state.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect("cont" in phase).toBe(true);
    expect(JSON.stringify(state)).toContain(
      '"op":"opponentDiscardsFromHand","count":3,"to":"deck"',
    );
  });

  it("DIRECTION 1 — the parked program survives a JSON round trip and resolves", () => {
    const parked = attack(ready(), SHUFFLE).state;
    const revived = roundTrip(parked);
    const picked = parkedPrompt(revived).candidates.slice(0, 3);
    const { state, events } = answerWith(revived, "p2", picked);
    expect(findEvent(events, "FORCED_HAND_DISCARD")?.to).toBe("deck");
    for (const uid of picked) expect(state.players.p2.deck).toContain(uid);
    expect(types(events)).toContain("SHUFFLE");
  });

  it("DIRECTION 2 — STRIP THE KEY AND A v30 RECORD MEANS WHAT IT ALWAYS MEANT", () => {
    const parked = attack(ready(), SHUFFLE).state;
    const bytes = JSON.stringify(parked);
    expect(bytes).toContain('"count":3,"to":"deck"');
    const stripped = JSON.parse(
      bytes.split('"count":3,"to":"deck"').join('"count":3'),
    ) as GameState;
    // The park itself is unchanged in every field but `dest` — which is the prompt,
    // not the record, and is re-derived from the op on resume.
    const picked = parkedPrompt(stripped).candidates.slice(0, 3);
    const { state, events } = answerWith(stripped, "p2", picked);
    expect(findEvent(events, "FORCED_HAND_DISCARD")?.to).toBeUndefined();
    for (const uid of picked) {
      expect(state.players.p2.discard, uid).toContain(uid);
      expect(state.players.p2.deck, uid).not.toContain(uid);
    }
    // …and the SHUFFLE tail still runs, because it is a SEPARATE op in the program
    // and not something the destination implies.
    expect(types(events)).toContain("SHUFFLE");
  });

  it("the FORCED board puts nothing new in the record at all — the carrier door", () => {
    const { state } = attack(ready(HAND_IDS.slice(0, 3)), SHUFFLE);
    expect("cont" in state.phase).toBe(false);
    expect(JSON.stringify(state)).not.toContain('"to":"deck"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — VERSION AND BYTE PINS.
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 — the version moved with the behaviour", () => {
  it("the op is PURE — the parked board is not mutated by resolving it", () => {
    const parked = deepFreeze(attack(ready(), SHUFFLE).state);
    const snapshot = JSON.stringify(parked);
    const picked = parkedPrompt(parked).candidates.slice(0, 3);
    answerWith(parked, "p2", picked);
    expect(JSON.stringify(parked)).toBe(snapshot);
  });
});
