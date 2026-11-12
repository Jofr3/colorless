import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effectTypes";
import { applyAction } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { programPlayable } from "./cardplay";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  deepFreeze,
  expectErr,
  must,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
  driveSetup,
  roundTrip,
  mustDerive,
} from "./testFixtures";

const CLAUSES = [
  {
    text: "You may draw cards until you have 6 cards in your hand.",
    bare: "Draw cards until you have 6 cards in your hand.",
    inner: { op: "drawUntilHandSize", size: 6 } as EffectOp,
    legalPrintings: 10,
  },
  {
    text: "You may draw 5 cards.",
    bare: "Draw 5 cards.",
    inner: { op: "drawCards", count: 5 } as EffectOp,
    legalPrintings: 2,
  },
] as const;

const UNTIL = 0;
const FIVE = 1;

function wrapped(text: string, inner: EffectOp): EffectOp[] {
  return [{ op: "optional", note: text, ops: [inner] }];
}

const NEAR_MISSES = [
  "Draw cards until you have the same number of cards in your hand as your opponent.",
  "You may discard any number of cards from your hand until you have 4 or fewer. Draw cards until you have 5 cards in your hand.",
  "Look at the top card of your deck. You may put that card into your hand. If you don't, discard that card and draw a card.",
] as const;

const BUILT_AT_D422 = "You may switch this Pokémon with 1 of your Benched Pokémon.";

const WRAPPED_ELSEWHERE =
  "You may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)";

const BUILT_AT_D404 = "Discard your hand and draw 6 cards.";

const BUILT_AT_D473 = "Discard a card from your hand. If you do, draw 2 cards.";
const BUILT_AT_D473_SIBLING = "Discard a card from your hand. If you do, draw 3 cards.";
const BUILT_AT_D487 = "Draw 3 cards from the bottom of your deck.";

const BUILT_AT_D491 = "Each player draws 3 cards.";

describe("the two anchors — 12 legal printings, and the four words in front of the op", () => {
  it("derives each printed sentence to the WRAPPED program", () => {
    for (const { text, inner } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(wrapped(text, inner));
    }
  });

  it("adds up: 12 legal printings across 2 sentences", () => {
    expect(CLAUSES).toHaveLength(2);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(12);
    expect(CLAUSES[UNTIL].legalPrintings).toBe(10);
    expect(CLAUSES[FIVE].legalPrintings).toBe(2);
  });

  it("puts the WRAPPED program's `then` byte-identical to the BARE anchor's whole program", () => {
    for (const { text, bare } of CLAUSES) {
      const gated = deriveAttackEffect(text);
      expect(gated, text).toHaveLength(1);
      const gate = gated?.[0];
      expect(gate?.op).toBe("optional");
      expect(gate?.op === "optional" ? gate.ops : undefined).toEqual(deriveAttackEffect(bare));
    }
  });

  it("carries the printed sentence VERBATIM as the note — the string the player reads", () => {
    for (const { text } of CLAUSES) {
      const gate = deriveAttackEffect(text)?.[0];
      const note = gate?.op === "optional" ? gate.note : "";
      expect(note).toBe(text);
      expect(/^[\x20-\x7e]+$/.test(note)).toBe(true);
      expect(note).not.toContain("'");
      expect(note).not.toContain("’");
    }
  });

  it("is PARAMETERISED on the count, unlike the two self-switch anchors", () => {
    for (const n of [1, 2, 3, 6, 7]) {
      expect(deriveAttackEffect(`You may draw ${n} cards.`)).toEqual(
        wrapped(`You may draw ${n} cards.`, { op: "drawCards", count: n }),
      );
      expect(
        deriveAttackEffect(`You may draw cards until you have ${n} cards in your hand.`),
      ).toEqual(
        wrapped(`You may draw cards until you have ${n} cards in your hand.`, {
          op: "drawUntilHandSize",
          size: n,
        }),
      );
    }
  });

  it("refuses a printed ZERO on both arms — the bare arms' guard, and it bites harder here", () => {
    expect(deriveAttackEffect("You may draw 0 cards.")).toBeNull();
    expect(
      deriveAttackEffect("You may draw cards until you have 0 cards in your hand."),
    ).toBeNull();
    // …and the bare forms agree, which is the point: the wrapper inherits the
    // guard rather than re-deciding it.
    expect(deriveAttackEffect("Draw 0 cards.")).toBeNull();
    expect(deriveAttackEffect("Draw cards until you have 0 cards in your hand.")).toBeNull();
  });

  it("has NO ceiling on either count — the ops clamp against the deck", () => {
    // Matching every other arm of this reader: §14.3 deck-out is a turn-START
    // rule, so a malformed large count empties a deck and stops, which is a legal
    // board state. A ceiling here would be a rule this engine does not have.
    expect(deriveAttackEffect("You may draw 999 cards.")).toEqual(
      wrapped("You may draw 999 cards.", { op: "drawCards", count: 999 }),
    );
    expect(deriveAttackEffect("You may draw cards until you have 60 cards in your hand.")).toEqual(
      wrapped("You may draw cards until you have 60 cards in your hand.", {
        op: "drawUntilHandSize",
        size: 60,
      }),
    );
  });

  it("the two anchors are DISJOINT — neither reaches the other's sentence", () => {
    const untilProgram = deriveAttackEffect(CLAUSES[UNTIL].text)?.[0];
    const fiveProgram = deriveAttackEffect(CLAUSES[FIVE].text)?.[0];
    expect(untilProgram?.op === "optional" ? untilProgram.ops : undefined).toEqual([
      { op: "drawUntilHandSize", size: 6 },
    ]);
    expect(fiveProgram?.op === "optional" ? fiveProgram.ops : undefined).toEqual([
      { op: "drawCards", count: 5 },
    ]);
  });
});

describe("the near-misses — the population an over-wide anchor eats", () => {
  it("refuses every real sentence that CONTAINS a clause and means something else", () => {
    for (const text of NEAR_MISSES) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("D491's both-seats draw is BUILT as a KEYED `drawCards`, never a wrapper", () => {
    expect(deriveAttackEffect(BUILT_AT_D491)).toEqual([
      { op: "drawCards", count: 3, who: "eachPlayer" },
    ]);
    // …and it is NOT the bare `ATTACK_DRAW` program: the key is the whole difference
    // between one hand growing and two.
    expect(deriveAttackEffect(BUILT_AT_D491)).not.toEqual([{ op: "drawCards", count: 3 }]);
    expect(deriveAttackEffect("Each player may draw 3 cards.")).toBeNull();
    expect(deriveAttackEffect("Each player draws a card.")).toBeNull();
    // …and the printed subject is the ONLY seat spelling read: a single-seat
    // third-person draw is still refused, which is what keeps the axis honest.
    expect(deriveAttackEffect("Your opponent draws 3 cards.")).toBeNull();
    expect(deriveAttackEffect("Both players draw 3 cards.")).toBeNull();
  });

  it("D487's bottom draw is BUILT as a KEYED `drawCards`, never a wrapper", () => {
    expect(deriveAttackEffect(BUILT_AT_D487)).toEqual([
      { op: "drawCards", count: 3, from: "bottom" },
    ]);
    // …and it is NOT the bare `ATTACK_DRAW` program, which is the whole point of the
    // key: the two sentences differ by which three cards leave the deck.
    expect(deriveAttackEffect(BUILT_AT_D487)).not.toEqual([{ op: "drawCards", count: 3 }]);
    // …and the WRAPPED spelling is nobody's sentence, so this file's anchors must still
    // refuse it — the original entry's claim about the `you may` family, kept.
    expect(deriveAttackEffect("You may draw 3 cards from the bottom of your deck.")).toBeNull();
    // …and the SINGULAR spelling is nobody's sentence either, so no `(?:a card)`
    // alternation crept onto the new anchor.
    expect(deriveAttackEffect("Draw a card from the bottom of your deck.")).toBeNull();
  });

  it("D404's row is BUILT and deliberately NOT wrapped", () => {
    const built = deriveAttackEffect(BUILT_AT_D404);
    expect(built).toEqual([{ op: "discardHand" }, { op: "drawCards", count: 6 }]);
    expect(built?.some((op) => op.op === "optional")).toBe(false);
    // …and the WRAPPED spelling of it is nobody's sentence, so the anchors here must
    // still refuse it — which is the original entry's claim, kept.
    expect(deriveAttackEffect("You may discard your hand and draw 6 cards.")).toBeNull();
  });

  it("D473's pair is BUILT as a §9.2 GATE and never as a `you may` WRAPPER", () => {
    for (const [text, count] of [
      [BUILT_AT_D473, 2],
      [BUILT_AT_D473_SIBLING, 3],
    ] as const) {
      const built = deriveAttackEffect(text);
      expect(built, text).toEqual([
        { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
        { op: "recordGate", slot: "paid", ops: [{ op: "drawCards", count }] },
      ]);
      const hasOptional = (value: unknown): boolean =>
        Array.isArray(value)
          ? value.some(hasOptional)
          : typeof value === "object" && value !== null
            ? (value as Record<string, unknown>).op === "optional" ||
              Object.values(value as Record<string, unknown>).some(hasOptional)
            : false;
      expect(hasOptional(built), text).toBe(false);
      // …and the WRAPPED spelling is nobody's sentence, so the anchors here must
      // still refuse it — the original entry's claim, kept.
      expect(
        deriveAttackEffect(`You may ${text.charAt(0).toLowerCase()}${text.slice(1)}`),
      ).toBeNull();
    }
  });

  it("D227's third producer wraps through the SAME gate, byte for byte", () => {
    expect(deriveAttackEffect(WRAPPED_ELSEWHERE)).toEqual(
      wrapped(WRAPPED_ELSEWHERE, { op: "opponentSwitchOut" }),
    );
    const bare =
      "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)";
    expect(WRAPPED_ELSEWHERE).toBe(`You may s${bare.slice(1)}`);
    expect(deriveAttackEffect(bare)).toEqual([{ op: "opponentSwitchOut" }]);
  });

  it("D422's row is BUILT, and it wraps through the SAME gate as the draws", () => {
    expect(deriveAttackEffect(BUILT_AT_D422)).toEqual(
      wrapped(BUILT_AT_D422, { op: "switchActive" }),
    );
    const bare = "Switch this Pokémon with 1 of your Benched Pokémon.";
    expect(BUILT_AT_D422).toBe(`You may s${bare.slice(1)}`);
    expect(deriveAttackEffect(bare)).toEqual([{ op: "switchActive" }]);
    const four = [CLAUSES[UNTIL].text, CLAUSES[FIVE].text, WRAPPED_ELSEWHERE, BUILT_AT_D422];
    for (const text of four) {
      const program = deriveAttackEffect(text);
      expect(program, text).toHaveLength(1);
      const gate = program?.[0];
      expect(gate?.op, text).toBe("optional");
      expect(gate?.op === "optional" ? gate.otherwise : "unset", text).toBeUndefined();
      expect(gate?.op === "optional" ? gate.note : undefined, text).toBe(text);
    }
  });

  it("leaves the BARE forms on their existing (D181) path, UNWRAPPED", () => {
    for (const { bare, inner } of CLAUSES) {
      expect(deriveAttackEffect(bare), bare).toEqual([inner]);
    }
    // …and so do the counts the catalog actually prints bare, which the wrapper
    // must not have disturbed.
    expect(deriveAttackEffect("Draw a card.")).toEqual([{ op: "drawCards", count: 1 }]);
    expect(deriveAttackEffect("Draw 2 cards.")).toEqual([{ op: "drawCards", count: 2 }]);
    expect(deriveAttackEffect("Draw cards until you have 7 cards in your hand.")).toEqual([
      { op: "drawUntilHandSize", size: 7 },
    ]);
  });

  it("refuses the anchors' own sentences with ANY text added on either side", () => {
    for (const { text } of CLAUSES) {
      expect(
        deriveAttackEffect(`${text} This attack does 30 damage to the new Active Pokémon.`),
      ).toBeNull();
      expect(
        deriveAttackEffect(`Your opponent's Active Pokémon is now Confused. ${text}`),
      ).toBeNull();
      expect(deriveAttackEffect(`Discard your hand. ${text} Then, shuffle your deck.`)).toBeNull();
      // Case is load-bearing too: the readers commit to it (no `/i` anywhere in
      // this reader), so the lowercase spelling of a sentence is not the
      // sentence.
      expect(deriveAttackEffect(text.toLowerCase())).toBeNull();
      expect(deriveAttackEffect(text.toUpperCase())).toBeNull();
    }
    // The trailing period is required — the failure mode this repo names first,
    // because a regex written from a paraphrase matches no real card.
    expect(deriveAttackEffect("You may draw 5 cards")).toBeNull();
    expect(deriveAttackEffect("You may draw cards until you have 6 cards in your hand")).toBeNull();
  });

  it("still accepts surrounding WHITESPACE — the reader's one documented tolerance", () => {
    // `deriveAttackEffect` trims before matching, and the trim is the ONLY
    // liberty it takes. The note is the TRIMMED string, which is the sentence.
    expect(deriveAttackEffect(`  ${CLAUSES[FIVE].text}\n`)).toEqual(
      wrapped(CLAUSES[FIVE].text, CLAUSES[FIVE].inner),
    );
  });
});

const RETURN_BODY: Card = battler("fix-may-return", {
  hp: 100,
  attacks: [
    { name: "Return", cost: ["Colorless"], damage: 30, effect: CLAUSES[UNTIL].text },
    // A second attack with NO effect at all, so "the derived program is on the
    // attack the player declared" is checkable rather than assumed.
    { name: "Tackle", cost: ["Colorless"], damage: 10 },
  ],
});

const ZIRCON_BODY: Card = battler("fix-may-zircon", {
  hp: 210,
  attacks: [
    {
      name: "Zircon Road",
      cost: ["Colorless", "Colorless", "Colorless"],
      damage: 180,
      effect: CLAUSES[FIVE].text,
    },
  ],
});

const BARE_BODY: Card = battler("fix-bare-return", {
  hp: 100,
  attacks: [{ name: "Bare Return", cost: ["Colorless"], damage: 30, effect: CLAUSES[UNTIL].bare }],
});

const LOCAL_CARDS: Record<string, Card> = {
  "fix-may-return": RETURN_BODY,
  "fix-may-zircon": ZIRCON_BODY,
  "fix-bare-return": BARE_BODY,
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "fix-may-return": 4,
  "fix-may-zircon": 4,
  "fix-bare-return": 4,
  "fix-victim": 4, // 30 HP — OHKO'd by Zircon Road, so the epilogue's KO sweep runs
  "fix-bigbody": 8, // 200 HP — survives, so the plain turn-end tail runs
  "fix-basic-1": 4,
  "fix-energy": 32,
});

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

function matchup(seed: number, attackerId: string, defenderId: string): GameState {
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  state = clearBench(setActiveFromDeck(state, "p1", attackerId), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", defenderId), "p2");
  state = attachFromDeck(state, "p1", "fix-energy", 3);
  const side = state.players.p1;
  return {
    ...state,
    players: { ...state.players, p1: { ...side, hand: [], deck: [...side.deck, ...side.hand] } },
  };
}

function hand(state: GameState): number {
  return state.players.p1.hand.length;
}

function deck(state: GameState): readonly string[] {
  return state.players.p1.deck;
}

function effectDrawn(events: GameEvent[]): number | undefined {
  const drawn = events.find(
    (e) => e.type === "CARDS_DRAWN" && e.seat === "p1" && e.reason === "effect",
  );
  return drawn?.type === "CARDS_DRAWN" ? drawn.uids.length : undefined;
}

describe("end to end — a printed card asks, and the answer is the effect", () => {
  it("the attack PARKS a confirm carrying the printed sentence, after the damage", () => {
    const state = matchup(11, "fix-may-return", "fix-bigbody");
    const { state: parked, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    // §8 printed order: the damage lands FIRST, then the effect asks.
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(types(events)).toContain("EFFECT_PENDING");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    // The whole prompt: a kind and the printed sentence, byte for byte off the
    // card. No candidates (the decision IS the content), no `count`.
    expect(parked.phase.prompt).toEqual({ kind: "confirm", note: CLAUSES[UNTIL].text });
    // The CONTROLLER answers — no `answerer` beside the seat, unlike the
    // `opponentMayDraw` family. A build that copied that park's `decider` would
    // put the printed "you" on the other player's screen.
    expect(parked.phase.seat).toBe("p1");
    expect(parked.phase.answerer).toBeUndefined();
    expect(parked.phase.resumeTail).toBe(true);
    // The epilogue is QUEUED, not run: the turn has not ended and no card moved.
    expect(parked.pending).toEqual([
      {
        kind: "attackEpilogue",
        seat: "p1",
        uid: findEvent(events, "ATTACK_DECLARED")?.uid,
        attack: findEvent(events, "ATTACK_DECLARED")?.attack,
      },
    ]);
    expect(types(events)).not.toContain("TURN_ENDED");
    expect(types(events)).not.toContain("CARDS_DRAWN");
    expect(hand(parked)).toBe(0);
  });

  it("YES draws to the printed size, THEN runs the epilogue and ends the turn", () => {
    const state = matchup(11, "fix-may-return", "fix-bigbody");
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });

    // Drew from 0 to the printed 6 — the number off the card, not a constant.
    expect(effectDrawn(events)).toBe(6);
    // …and then P2's turn opened with their own start-of-turn draw, which is why
    // the event list is read rather than the final hand.
    expect(types(events)).toEqual(["CARDS_DRAWN", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(done.players.p1.hand).toHaveLength(6);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
  });

  it("NO draws NOTHING — and the attack is still USED, so the turn still ends", () => {
    const state = matchup(11, "fix-may-return", "fix-bigbody");
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const before = { hand: hand(parked), deck: [...deck(parked)] };
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: false },
    });

    // NOTHING was drawn: not the hand, and not the deck it would have come from.
    // The deck is compared ELEMENT BY ELEMENT rather than by length, because a
    // draw-and-put-back would keep the length and move the order.
    expect(hand(done)).toBe(before.hand);
    expect(hand(done)).toBe(0);
    expect(deck(done)).toEqual(before.deck);
    // The branch left no trace in the log — the only draw is P2's turn-start one.
    expect(types(events)).toEqual(["TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(effectDrawn(events)).toBeUndefined();
    expect(findEvent(events, "CARDS_DRAWN")?.seat).toBe("p2");
    // …and the attack was USED: the turn ended, the queue drained, P2 is up.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
    // The damage the attack already did is still on the board — a decline is not
    // an undo of the attack.
    expect(done.players.p2.active?.damage).toBe(30);
  });

  it("the DECLINE does not consume the attack's other effects — the KO sweep still runs", () => {
    // Zircon Road's 180 is lethal to a 30 HP body, so the §8.1 Knock Out sweep is
    // real work sitting BEHIND the park. It must survive both answers, and the
    // decline is the one that can lose it.
    const state = matchup(12, "fix-may-zircon", "fix-victim");
    const { state: parked, events: attackEvents } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    // Lethally damaged but NOT yet Knocked Out — the sweep is in the epilogue.
    expect(types(attackEvents)).not.toContain("KNOCKED_OUT");
    expect(parked.players.p2.active).not.toBeNull();
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.prompt).toEqual({ kind: "confirm", note: CLAUSES[FIVE].text });

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: false },
    });
    // No draw, and the KO the DAMAGE caused resolved anyway.
    expect(types(events)).not.toContain("CARDS_DRAWN");
    expect(hand(done)).toBe(0);
    expect(types(events)[0]).toBe("KNOCKED_OUT");
    // p2's Bench is empty, so the Knock Out the sweep resolves ends the game.
    expect(types(events)).toContain("GAME_OVER");
    expect(done.phase).toMatchObject({ kind: "gameOver", outcome: { winner: "p1" } });
  });

  it("the ACCEPT twin of the KO case — draw first, then the same sweep", () => {
    const state = matchup(12, "fix-may-zircon", "fix-victim");
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    // The printed 5, off the card.
    expect(effectDrawn(events)).toBe(5);
    expect(hand(done)).toBe(5);
    // Draw, THEN the Knock Out — the spliced branch runs where the op sat, ahead
    // of the queued epilogue, not after it.
    expect(types(events).slice(0, 2)).toEqual(["CARDS_DRAWN", "KNOCKED_OUT"]);
    expect(done.phase).toMatchObject({ kind: "gameOver", outcome: { winner: "p1" } });
  });

  it("the BARE printing on the same board asks NOTHING and draws immediately", () => {
    // The control. Same op, same size, same damage, same seat — and no park, no
    // prompt, no second action. This is what an over-wide anchor would break, and
    // it would break it INVISIBLY unless something drives the mandatory side.
    const state = matchup(11, "fix-bare-return", "fix-bigbody");
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(effectDrawn(events)).toBe(6);
    expect(done.players.p1.hand).toHaveLength(6);
  });

  it("the SECOND attack on the same body carries no effect — the program follows the index", () => {
    const state = matchup(11, "fix-may-return", "fix-bigbody");
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(10);
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("draws only up to the printed size — a hand already at 6 draws NOTHING on a YES", () => {
    let state = matchup(13, "fix-may-return", "fix-bigbody");
    const side = state.players.p1;
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...side, hand: side.deck.slice(0, 6), deck: side.deck.slice(6) },
      },
    };
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the confirm park");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    expect(effectDrawn(events)).toBeUndefined();
    expect(hand(done)).toBe(6);
  });

  it("the attack is DECLARABLE — programPlayable does not descend into `then`", () => {
    const state = matchup(13, "fix-may-return", "fix-bigbody");
    const program = mustDerive(deriveAttackEffect, CLAUSES[UNTIL].text);
    const empty: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, deck: [] } },
    };
    expect(programPlayable(empty, program, "p1")).toBe(true);
  });
});

describe("the wire and the seat gate, on the DERIVED park", () => {
  function parked(): GameState {
    const state = matchup(11, "fix-may-return", "fix-bigbody");
    return mustApply(state, { type: "attack", seat: "p1", index: 0 }).state;
  }

  it("accepts a real boolean and REFUSES every truthy impostor", () => {
    const state = deepFreeze(parked());
    for (const yes of ["yes", 1, 0, null, undefined, {}] as const) {
      expectErr(
        state,
        {
          type: "resolveEffect",
          seat: "p1",
          choice: { kind: "confirm", yes } as unknown as { kind: "confirm"; yes: boolean },
        },
        "BAD_EFFECT_CHOICE",
      );
    }
    // The other yes/no prompt's answer is not this one's — a `mayDraw` frame
    // aimed at a `confirm` park is refused rather than read as consent.
    expectErr(
      state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "mayDraw", draw: true } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("the OPPONENT cannot answer the controller's printed 'you may'", () => {
    expectErr(
      parked(),
      { type: "resolveEffect", seat: "p2", choice: { kind: "confirm", yes: true } },
      "WRONG_SEAT",
    );
  });

  it("redacts to the sentence alone, and reaches the ANSWERER only", () => {
    const state = parked();
    expect(redactGame(state, "p1").phase).toMatchObject({
      kind: "effect:choose",
      prompt: { kind: "confirm", note: CLAUSES[UNTIL].text },
    });
    const theirs = redactGame(state, "p2").phase;
    if (theirs.kind !== "effect:choose") throw new Error("expected the park");
    expect(theirs.prompt).toBeNull();
  });

  it("MATCH_RECORD_VERSION stays 12 — and D186's SECOND leg has retired, so this is the check", () => {
    const state = parked();
    const thawed = roundTrip(state);
    if (thawed.phase.kind !== "effect:choose") throw new Error("expected the park");
    expect(thawed.phase.prompt).toEqual({ kind: "confirm", note: CLAUSES[UNTIL].text });
    expect(thawed.phase.cont.pendingOp).toEqual({
      op: "optional",
      note: CLAUSES[UNTIL].text,
      ops: [{ op: "drawUntilHandSize", size: 6 }],
    });
    const { state: done } = mustApply(thawed, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    expect(done.players.p1.hand).toHaveLength(6);
  });
});
