import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  trainerCard,
  typedEnergy,
} from "./testFixtures";

// ── D314 — ELDEGOSS `sv07-011` "BREEZY GIFT", AND A PRICE THAT WAS WRONG BY A
//    WHOLE FIELD. ───────────────────────────────────────────────────────────────
//
// *"Put this Pokémon and all attached cards into your deck. If you do, search
//  your deck for up to 3 cards and put them into your hand. Then, shuffle your
//  deck."* — ONE legal printing, attack index 0, no printed `damage`.
//
// 🛑 **THE HANDOFF PRICED THIS ROW AS "A `recordAs` ON `returnSelf` ITSELF" AND
// THE FIELD IS NOT OWED.** D311 earned `drawCards.recordAs` because an empty deck
// really does draw nothing, so Dudunsparce's two halves come apart on a board a
// player reaches. Ask the same question of this sentence and the answer inverts:
// `returnSelf` can decline to move exactly three ways (no ref from `sourceRef`,
// no body in the spot, no top uid), and an ATTACK program reaches none of them —
// §8 declares the attack off the attacker's own Active body, "Breezy Gift" deals
// no damage, and nothing between the declaration and step 4 empties that spot.
// **A gate whose antecedent cannot fail is D310's *"a FILTER may be a
// SUBSTITUTION"* wearing §9.2's clothes**: green, dead and unkillable. §2 asserts
// the ABSENCE against the live program and drives the closest board there is to a
// separating one (an EMPTY deck) to show it does not separate.
//
// 🛑 **WHAT THE ROW REALLY BUYS IS A BOARD: THIS IS THE FIRST PROGRAM IN THIS
// ENGINE THAT *PARKS* AFTER EMPTYING ITS OWN ACTIVE SPOT.** D311's Dudunsparce
// and D312's Gholdengo removed the actor and finished, so the §8.1 promotion
// D312 queued in `finishAttack` was always reached with the program settled.
// Here `searchDeck` asks a question first: an `effect:choose` interrupt is
// announced while the attacker's Active Spot stands EMPTY, and the promotion is
// queued only when the answer comes back. §4 and §5 drive that ordering, §6 the
// §14.2 ending underneath it.
//
// ⚠️ **AND THE VERB IS *PUT*, WHICH NO OTHER PRINTING IN THIS FAMILY SAYS.** The
// four other deck printings all *"shuffle … into your deck"*; this one *puts* and
// then ends *"Then, shuffle your deck."* `returnSelf`'s deck arm shuffles as it
// places, so the program emits TWO `SHUFFLE` rows for a sentence that prints one
// shuffle — DRIVEN in §3 rather than hidden, because the log reports what the
// ENGINE did and the engine really did randomise twice. Randomising EARLY can
// change no outcome: `searchDeck` scans the whole deck, so its candidate set is
// order-blind, and the printed trailing shuffle is the one that hides the order
// the player has just seen.

const ELDEGOSS = "sv07-011";
const PRINTED =
  "Put this Pokémon and all attached cards into your deck. If you do, search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.";
const ELDEGOSS_IDX1_NAME = "Leafage";
const DUDUNSPARCE = "sv05-129";
const POLIWRATH = "sv06-043";

const WALL = "fix-d314bg-wall";
const FILLER = "fix-d314bg-filler";
const UNDER = "fix-d314bg-under";
const GRASS = "fix-d314bg-grass";
const TOOL = "fix-d314bg-tool";

/** The LOCAL pool (D275's idiom) — the real id lives HERE and not in
    `FIXTURE_POOL`, so no `fix-*` demonstrator is owed and `catalogManifest`
    never sees it. (It would owe none anyway: `sv07` is not one of that
    manifest's six sets.) */
const LOCAL_CARDS: Record<string, Card> = {
  [ELDEGOSS]: battler(ELDEGOSS, {
    name: "Eldegoss",
    hp: 90,
    stage: "Stage1",
    evolveFrom: "Gossifleur",
    retreat: 1,
    types: ["Grass"],
    attacks: [
      { cost: ["Colorless"], name: "Breezy Gift", effect: PRINTED },
      { cost: ["Grass"], name: ELDEGOSS_IDX1_NAME, damage: 50 },
    ],
  }),
  [WALL]: battler(WALL, {
    name: "D314 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "D314 Filler",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [UNDER]: battler(UNDER, {
    name: "D314 Under",
    hp: 60,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [TOOL]: trainerCard(TOOL, "Tool", "Attach to 1 of your Pokémon."),
  [GRASS]: typedEnergy(GRASS, "Grass"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [ELDEGOSS]: 2,
  [WALL]: 4,
  [FILLER]: 8,
  [UNDER]: 4,
  [TOOL]: 4,
  [GRASS]: 38,
});

/** Two seeds — nothing below rests on one shuffle (D270). */
const SEEDS = [3141, 3167] as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function apply(
  state: GameState,
  action: Parameters<typeof applyAction>[1],
): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: [...result.events] };
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

/** TEST SURGERY — `count` Energy of `GRASS` onto p1's Active, taken off the deck
    so every uid stays in exactly one zone. */
function fuel(state: GameState, count: number): GameState {
  const side = state.players.p1;
  const body = side.active;
  if (body === null) throw new Error("p1 has no Active");
  const energy = side.deck.filter((u) => state.cardIdByUid[u] === GRASS).slice(0, count);
  if (energy.length < count) throw new Error(`deck lacks ${count} ${GRASS}`);
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

/** TEST SURGERY — push `count` cards UNDER p1's Active, building a real evolution
    STACK. The whole point: `stack` and `energy`+`tools` only differ on a body
    with more than one card in its stack, and this destination takes BOTH piles,
    so a build that moved only the top card is invisible on a Basic. */
function stackUnder(state: GameState, count: number): GameState {
  const side = state.players.p1;
  const body = side.active;
  if (body === null) throw new Error("p1 has no Active");
  const under = side.deck.filter((u) => state.cardIdByUid[u] === UNDER).slice(0, count);
  if (under.length < count) throw new Error(`deck lacks ${count} ${UNDER}`);
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        active: { ...body, stack: [...under, ...body.stack] },
        deck: side.deck.filter((u) => !under.includes(u)),
      },
    },
  };
}

/** TEST SURGERY — p1's whole deck into their discard, so the attack's own op is
    the only thing that can put a card back. Every uid stays in exactly one
    zone. */
function emptyDeck(state: GameState): GameState {
  const side = state.players.p1;
  return {
    ...state,
    players: {
      ...state.players,
      p1: { ...side, deck: [], discard: [...side.discard, ...side.deck] },
    },
  };
}

/** A board with Eldegoss Active for p1 on p1's turn, a 330 HP Wall opposite, and
    `bench` filler bodies behind the attacker. */
function board(opts: {
  bench?: number;
  under?: number;
  tool?: boolean;
  seed?: number;
  energy?: number;
}): GameState {
  let state = localSetup(opts.seed ?? SEEDS[0], "p2");
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", FILLER);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", ELDEGOSS);
  state = clearBench(state, "p1");
  for (let i = 0; i < (opts.bench ?? 1); i += 1) state = benchFromDeck(state, "p1", FILLER);
  if (opts.under !== undefined) state = stackUnder(state, opts.under);
  if (opts.tool === true) state = attachToolFromDeck(state, "p1", "active", TOOL);
  return fuel(state, opts.energy ?? 1);
}

const BREEZY = { type: "attack", seat: "p1", index: 0 } as const;

function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

function take(uids: readonly string[]) {
  return {
    type: "resolveEffect" as const,
    seat: "p1" as const,
    choice: { kind: "cards" as const, uids: [...uids] },
  };
}

// ────────────────────────────────────────────────────────────────────────────
describe("D314 §1 — the print, the row, and the index it does not claim", () => {
  it("the fixture carries the printed sentence VERBATIM at its printed index", () => {
    expect(POOL[ELDEGOSS]?.attacks?.[0]?.effect).toBe(PRINTED);
    expect(POOL[ELDEGOSS]?.attacks?.[0]?.name).toBe("Breezy Gift");
    // No printed `damage` — the whole attack is its effect text.
    expect(POOL[ELDEGOSS]?.attacks?.[0]?.damage).toBeUndefined();
    expect(POOL[ELDEGOSS]?.attacks?.[1]?.name).toBe(ELDEGOSS_IDX1_NAME);
    expect(POOL[ELDEGOSS]?.attacks?.[1]?.effect).toBeUndefined();
  });

  it("🛑 the row is THREE EXISTING OPS in printed order and nothing else", () => {
    expect(programFor(ELDEGOSS)?.attack?.[0]).toEqual([
      { op: "returnSelf", dest: "deck" },
      { op: "searchDeck", filter: { kind: "anyCard" }, dest: "hand", max: 3 },
      { op: "shuffleDeck" },
    ]);
  });

  it("INDEX-PRECISE: index 1 is not claimed, and the Ability slot stays empty", () => {
    // "Leafage" is `damage: 50` with NO effect key at all, so it contributes zero
    // attack units and must not inherit this program (D187's inflated result,
    // D312's rung one card over).
    expect(programFor(ELDEGOSS)?.attack?.[1]).toBeUndefined();
    expect(programFor(ELDEGOSS)?.abilities).toBeUndefined();
    expect(programFor(ELDEGOSS)?.triggered).toBeUndefined();
    expect(programFor(ELDEGOSS)?.trainer).toBeUndefined();
  });

  it("`max: 3` is the printed number and `reveal` is ABSENT because the print is", () => {
    const search = programFor(ELDEGOSS)?.attack?.[0]?.[1];
    expect(search?.op).toBe("searchDeck");
    expect(search).not.toHaveProperty("reveal");
    expect(PRINTED).toContain("up to 3 cards");
    expect(PRINTED).not.toContain("reveal");
    // ⚠️ THE INTERSECTION PROOF for the absent rider (D135's ABSENT-never-false
    // rule): a sibling registry search that DOES print the word carries it, so
    // "no `reveal`" is a reading of this sentence and not of the type.
    const comfey = programFor("sv09-068")?.attack?.[0]?.[0];
    expect(comfey?.op).toBe("searchDeck");
    const misty = programFor("sv10-050")?.attack?.[0]?.[0];
    expect(misty).toMatchObject({ op: "searchDeck", reveal: true });
  });

  it("the trailing `shuffleDeck` is the printed sentence and is a SEPARATE op", () => {
    // Every other search row in this registry authors the printed "Then, shuffle
    // your deck." as its own op; a build that folded it into `searchDeck` would
    // read a card that never says it (`derivedHandSearch`'s trailing-sentence
    // guard, from the registry side).
    const program = programFor(ELDEGOSS)?.attack?.[0] ?? [];
    expect(program[2]).toEqual({ op: "shuffleDeck" });
    expect(PRINTED.endsWith("Then, shuffle your deck.")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D314 §2 — 🛑 the field the handoff priced and this row does NOT owe", () => {
  it("no `recordAs` on the `returnSelf`, and no `recordGate` anywhere in the program", () => {
    const program = programFor(ELDEGOSS)?.attack?.[0] ?? [];
    expect(program[0]).not.toHaveProperty("recordAs");
    expect(program.map((op) => op.op)).not.toContain("recordGate");
    // Asserted on the SERIALISED program too, so a gate nested inside a future
    // wrapper cannot slip in under an `op.op` scan.
    expect(JSON.stringify(programFor(ELDEGOSS))).not.toContain("record");
  });

  it("⚠️ THE INTERSECTION PROOF: the sibling that DOES have a separating board carries both", () => {
    // Without this, "no recordGate" would pass on an engine that had never built
    // one. Dudunsparce's *"If you drew any cards in this way"* comes apart on an
    // empty deck, so D311 spent the slot; this sentence's antecedent cannot fail,
    // so it does not. The two rows differ on the field for a reason that is about
    // the BOARD and not about house style.
    const dudunsparce = programFor(DUDUNSPARCE)?.abilities?.[0]?.program ?? [];
    expect(dudunsparce[0]).toMatchObject({ op: "drawCards", recordAs: "moved" });
    expect(dudunsparce[1]).toMatchObject({ op: "recordGate", slot: "moved" });
  });

  for (const seed of SEEDS) {
    it(`🛑 the closest thing to a separating board does not separate — an EMPTY deck still returns and still searches (seed ${seed})`, () => {
      // The board D311's row comes apart on, asked of this one. p1's deck is
      // EMPTY when the attack is declared, so the only card the search can ever
      // find is the Eldegoss the op before it just put there. Both halves of the
      // printed sentence still happen: this is what "the antecedent cannot fail"
      // looks like when it is driven instead of argued.
      const state = emptyDeck(board({ seed, under: 1, tool: true, energy: 2 }));
      expect(state.players.p1.deck).toHaveLength(0);
      const uids = [
        ...(state.players.p1.active?.stack ?? []),
        ...(state.players.p1.active?.energy ?? []),
        ...(state.players.p1.active?.tools ?? []),
      ];
      expect(uids).toHaveLength(5); // 2 stack + 2 Energy + 1 Tool

      const parked = must(applyAction(state, BREEZY));
      // The search PARKED rather than taking `searchDeck`'s silent
      // zero-candidate ending, and every candidate is a card this attack itself
      // put into the deck.
      const prompt = cardsPrompt(parked);
      expect([...prompt.candidates].sort()).toEqual([...uids].sort());
      expect(prompt.min).toBe(0);
      expect(prompt.max).toBe(3);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
describe("D314 §3 — the removal: both piles to the deck, and the TWO shuffles", () => {
  for (const seed of SEEDS) {
    it(`the STACK *and* the attachments go to the deck — one destination, no split (seed ${seed})`, () => {
      const state = board({ seed, under: 2, tool: true, energy: 2 });
      const body = state.players.p1.active;
      const stack = body?.stack ?? [];
      const attached = [...(body?.energy ?? []), ...(body?.tools ?? [])];
      expect(stack).toHaveLength(3); // 2 under + the Eldegoss itself
      expect(attached).toHaveLength(3); // 2 Grass + 1 Tool
      const deckBefore = state.players.p1.deck.length;
      const discardBefore = state.players.p1.discard.length;

      const parked = must(applyAction(state, BREEZY));
      // Every one of the six is in the deck, and NONE went to the discard or the
      // hand — the discrimination `dest: "deck"` is making.
      for (const uid of [...stack, ...attached]) {
        expect(parked.players.p1.deck, uid).toContain(uid);
        expect(parked.players.p1.discard, uid).not.toContain(uid);
        expect(parked.players.p1.hand, uid).not.toContain(uid);
      }
      expect(parked.players.p1.deck).toHaveLength(deckBefore + 6);
      expect(parked.players.p1.discard).toHaveLength(discardBefore);
      expect(parked.players.p1.active).toBeNull();
    });
  }

  it("`POKEMON_RETURNED` names the deck and carries the WHOLE pile", () => {
    const { events } = apply(board({ under: 2, tool: true, energy: 2 }), BREEZY);
    const returned = find(events, "POKEMON_RETURNED");
    expect(returned?.dest).toBe("deck");
    expect(returned?.uids).toHaveLength(6);
    // Not a split — this printing sends nothing anywhere else.
    expect(returned).not.toHaveProperty("attachmentsTo");
  });

  it("🛑 TWO `SHUFFLE` rows for a sentence that prints ONE shuffle — and both are true", () => {
    // ⚠️ THE ONE PRINTING IN THIS FAMILY WHOSE VERB IS *PUT*. The other four deck
    // printings say "shuffle … into your deck"; this one puts, searches, and then
    // shuffles. `returnSelf`'s deck arm randomises as it places, so the engine
    // really does shuffle twice — the log reports what happened, not what the
    // sentence said, and shuffling EARLY can change no outcome because
    // `searchDeck` scans the whole deck rather than its top.
    const state = board({ under: 1, tool: true, energy: 2 });
    const parked = apply(state, BREEZY);
    // One SHUFFLE before the question is asked…
    expect(parked.events.filter((e) => e.type === "SHUFFLE")).toHaveLength(1);
    const order = parked.events.map((e) => e.type);
    expect(order.indexOf("POKEMON_RETURNED")).toBeLessThan(order.indexOf("SHUFFLE"));
    // …and the printed one after the answer.
    const prompt = cardsPrompt(parked.state);
    const done = apply(parked.state, take(prompt.candidates.slice(0, 3)));
    expect(done.events.filter((e) => e.type === "SHUFFLE")).toHaveLength(1);
    const after = done.events.map((e) => e.type);
    expect(after.indexOf("DECK_SEARCHED")).toBeLessThan(after.indexOf("SHUFFLE"));
  });

  it("⚠️ THE CONTROL: the sibling that prints *shuffle* emits exactly ONE", () => {
    // Without this the rung above would pass on an engine that shuffled twice for
    // every removal. Gholdengo's "You may shuffle this Pokémon…" is one shuffle
    // and stays one.
    const program = programFor("sv08-131")?.attack?.[1] ?? [];
    expect(JSON.stringify(program)).not.toContain("shuffleDeck");
    expect(JSON.stringify(programFor(ELDEGOSS))).toContain("shuffleDeck");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D314 §4 — 🛑 the first program that PARKS with its own Active Spot empty", () => {
  it("the interrupt is announced while p1 has no Active, and p2's board is untouched", () => {
    const state = board({ bench: 2, under: 1, energy: 2 });
    const p2Active = state.players.p2.active;
    const { state: parked, events } = apply(state, BREEZY);
    expect(parked.phase.kind).toBe("effect:choose");
    expect(events.map((e) => e.type)).toContain("EFFECT_PENDING");
    // 🛑 THE BOARD NOTHING IN THIS ENGINE HAD REACHED: a decision is outstanding
    // and the seat that must answer it has an EMPTY Active Spot.
    expect(parked.players.p1.active).toBeNull();
    expect(parked.players.p1.bench).toHaveLength(2);
    expect(parked.players.p2.active).toEqual(p2Active);
  });

  it("🛑 NO promotion is queued or announced while the choice is outstanding", () => {
    // The ordering the whole section exists for. §8.1's promotion is owed the
    // moment the spot empties, and it is DELIBERATELY not queued here: it belongs
    // to the attack epilogue, which has not run. A build that promoted inside the
    // op would refill the spot mid-question — and would do it before the player
    // had seen the prompt.
    const { state: parked, events } = apply(board({ bench: 2, under: 1, energy: 2 }), BREEZY);
    expect(events.map((e) => e.type)).not.toContain("PROMOTION_REQUIRED");
    expect(events.map((e) => e.type)).not.toContain("TURN_ENDED");
    expect(parked.pending.filter((s) => s.kind === "promote")).toEqual([]);
  });

  it("the prompt is the answerer's own, and it survives a full serialise round trip", () => {
    // A park stores its continuation inside `GameState`; this one stores it with
    // the source body no longer on the board, which is the new part.
    const parked = must(applyAction(board({ bench: 2, under: 1, energy: 2 }), BREEZY));
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(revived.phase).toEqual(parked.phase);
    const prompt = cardsPrompt(revived);
    expect(prompt.dest).toBe("hand");
    expect(prompt.max).toBe(3);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D314 §5 — the search, its two legal answers, and the tail behind it", () => {
  for (const seed of SEEDS) {
    it(`taking THREE puts exactly three cards in hand and shuffles once more (seed ${seed})`, () => {
      const state = board({ seed, bench: 2, under: 1, energy: 2 });
      const parked = must(applyAction(state, BREEZY));
      const handBefore = parked.players.p1.hand.length;
      const deckBefore = parked.players.p1.deck.length;
      const picked = cardsPrompt(parked).candidates.slice(0, 3);

      const { state: done, events } = apply(parked, take(picked));
      for (const uid of picked) expect(done.players.p1.hand, uid).toContain(uid);
      expect(done.players.p1.hand).toHaveLength(handBefore + 3);
      expect(done.players.p1.deck).toHaveLength(deckBefore - 3);
      expect(find(events, "DECK_SEARCHED")).toBeDefined();
      expect(events.map((e) => e.type)).toContain("SHUFFLE");
    });
  }

  it('taking NONE is a legal answer — "up to 3" and `min: 0`', () => {
    const parked = must(applyAction(board({ bench: 2, under: 1, energy: 2 }), BREEZY));
    const handBefore = parked.players.p1.hand.length;
    const deckBefore = parked.players.p1.deck.length;
    const { state: done, events } = apply(parked, take([]));
    expect(done.players.p1.hand).toHaveLength(handBefore);
    expect(done.players.p1.deck).toHaveLength(deckBefore);
    // 🛑 THE PRINTED SHUFFLE STILL FIRES on the decline — it is a separate op and
    // a separate sentence, and `searchDeck`'s whiff never suppresses it.
    expect(events.map((e) => e.type)).toContain("SHUFFLE");
    // ⚠️ AND THE TURN HAS *NOT* ENDED, WHICH IS THIS ROW'S OWN NEW ORDERING: the
    // §8.1 promotion is owed and sits in front of the tail, so `TURN_ENDED` is
    // still queued rather than fired. Declining the search does not decline the
    // removal — the two clauses are separate ops and only one of them was a
    // decision.
    expect(events.map((e) => e.type)).not.toContain("TURN_ENDED");
    expect(events.map((e) => e.type)).toContain("PROMOTION_REQUIRED");
    expect(done.pending.map((s) => s.kind)).toContain("endTurn");
  });

  it("a FOURTH card is refused — the printed maximum is a maximum", () => {
    const parked = must(applyAction(board({ bench: 2, under: 1, energy: 2 }), BREEZY));
    const four = cardsPrompt(parked).candidates.slice(0, 4);
    const result = applyAction(parked, take(four));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("BAD_EFFECT_CHOICE");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D314 §6 — §8.1's promotion, queued only once the answer comes back", () => {
  it("a Bench of TWO asks — and it asks AFTER the search, never before it", () => {
    const parked = must(applyAction(board({ bench: 2, under: 1, energy: 2 }), BREEZY));
    const picked = cardsPrompt(parked).candidates.slice(0, 3);
    const { state: done, events } = apply(parked, take(picked));
    const order = events.map((e) => e.type);
    expect(order).toContain("PROMOTION_REQUIRED");
    expect(order.indexOf("DECK_SEARCHED")).toBeLessThan(order.indexOf("PROMOTION_REQUIRED"));
    expect(done.pending.filter((s) => s.kind === "promote")).toHaveLength(1);
    // …and the turn tail sits behind it: a player does not hand over a board with
    // an empty Active Spot (D312's ordering, reached through a park this time).
    const kinds = done.pending.map((s) => s.kind);
    expect(kinds.indexOf("promote")).toBeLessThan(kinds.indexOf("endTurn"));
  });

  it("a Bench of ONE auto-resolves — the M1 no-choice doctrine, through a park", () => {
    const parked = must(applyAction(board({ bench: 1, under: 1, energy: 2 }), BREEZY));
    const picked = cardsPrompt(parked).candidates.slice(0, 3);
    const { state: done, events } = apply(parked, take(picked));
    expect(events.map((e) => e.type)).not.toContain("PROMOTION_REQUIRED");
    expect(events.map((e) => e.type)).toContain("TURN_ENDED");
    expect(done.players.p1.active).not.toBeNull();
    expect(done.players.p1.bench).toHaveLength(0);
    expect(done.phase).toMatchObject({ seat: "p2" });
  });

  it("🛑 a Bench of NONE is the §14.2 loss — and the player still gets their search", () => {
    // ⚠️ THE ORDERING THAT MAKES THIS DIFFERENT FROM D312's Gholdengo: the loss is
    // owed from the instant the spot empties, and it is nonetheless deferred until
    // the outstanding decision has been answered. Losing a player's prompt because
    // they were about to lose the game would be the same class of defect as
    // promoting into the spot mid-question.
    const parked = must(applyAction(board({ bench: 0, under: 1, energy: 2 }), BREEZY));
    expect(parked.phase.kind).toBe("effect:choose");
    const handBefore = parked.players.p1.hand.length;
    const picked = cardsPrompt(parked).candidates.slice(0, 3);
    const { state: done, events } = apply(parked, take(picked));
    expect(done.players.p1.hand).toHaveLength(handBefore + 3);
    expect(done.phase.kind).toBe("gameOver");
    expect(find(events, "GAME_OVER")?.outcome).toMatchObject({ result: "win", winner: "p2" });
  });

  it("⚠️ THE CONTROL: the card's OTHER attack promotes nobody", () => {
    // The seam scans both seats on every attack; on "Leafage" neither spot empties
    // and nothing is queued. Without this a build that promoted unconditionally
    // would still pass every rung above.
    const { state: done, events } = apply(board({ bench: 2, energy: 2 }), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    expect(events.map((e) => e.type)).not.toContain("PROMOTION_REQUIRED");
    expect(done.pending.filter((s) => s.kind === "promote")).toEqual([]);
    expect(done.players.p1.active).not.toBeNull();
    expect(events.map((e) => e.type)).toContain("TURN_ENDED");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D314 §7 — the family at TWELVE of thirteen, and why the last one is not next", () => {
  /** The thirteen legal printings of the self-removal family, re-derived over
      `attacks_json` + `abilities_json` + `effect` at `legal_standard = 1` on
      2026-08-10 (the union of `'and all attached cards into'`,
      `'cards attached to this'` and `'Discard this Pokémon and all attached'` —
      D311's literal, D312's word order and D313's subject sweep, run again and
      returning the same thirteen). */
  const FAMILY = [
    "sv05-129",
    "sv08.5-080",
    "sv06-080",
    "sv08-131",
    "sv09-068",
    "sv06.5-015",
    "sv06.5-081",
    "sv10-122",
    "sv10-217",
    "sv10-234",
    "sv10-242",
    ELDEGOSS, // 🆕 D314
    POLIWRATH, // the one left
  ] as const;

  it("TWELVE of the thirteen carry a `returnSelf`, and the thirteenth is Poliwrath", () => {
    expect(FAMILY).toHaveLength(13);
    const built = FAMILY.filter((id) => JSON.stringify(programFor(id) ?? null).includes("returnSelf"));
    expect(built).toHaveLength(12);
    expect(FAMILY.filter((id) => !built.includes(id))).toEqual([POLIWRATH]);
  });

  it("🛑 Poliwrath is refused on the DAMAGE FOLD, and this repo already priced that shape", () => {
    // ⚠️ RE-DERIVED RATHER THAN INHERITED. The resume point priced this row as
    // *"a decision feeding a conditional damage boost, and no arm spends a
    // `recordGate` slot on the damage step"* — as if the slot were the cost. It
    // is not. *"You may do 120 more damage. If you do, …"* puts a PLAYER DECISION
    // IN FRONT OF §8.5, and `attack.ts` folds the printed damage BEFORE step 4
    // runs the program, so no op inside the program can add to a hit that has
    // already landed. `effects.ts` says exactly this about the identical shape
    // one family over — Copperajah `sv06.5-042`'s *"You may do 100 more damage.
    // If you do, during your next turn, this Pokémon can't attack."* — which it
    // refuses as *"a park the damage fold cannot express today"*.
    //
    // So the family CANNOT be closed at 13 of 13 by a registry row, and the row
    // that closes it is a change to the damage pipeline. The refusal is asserted
    // LIVE so it cannot rot into prose.
    expect(programFor(POLIWRATH)).toBeUndefined();
    // …and the printed antecedent that makes it so, transcribed.
    expect(POOL[ELDEGOSS]?.attacks?.[0]?.damage).toBeUndefined();
  });

  it("every registry `returnSelf` still spells its `dest` — D313's converse guard, one row wider", () => {
    const bare = JSON.stringify(
      [ELDEGOSS, "sv10-122", "sv09-068", "sv06.5-015", "sv06-080", "sv08-131", "sv05-129"].map(
        (id) => programFor(id),
      ),
    );
    expect(bare).toContain('"returnSelf"');
    expect(bare).not.toContain('{"op":"returnSelf"}');
  });

  it("🛑 the DESTINATION axis stays closed at 4 of 4 — this row adds no member", () => {
    // D313's claim, re-asked after a new printing landed on it. The one printing
    // left prints `deck`, which is built four times over, so nothing about `dest`
    // is owed by the last row either.
    const dests = new Set(
      FAMILY.map((id) => JSON.stringify(programFor(id) ?? null))
        .flatMap((json) => [...json.matchAll(/"dest":"(deck|hand|discard)"/g)])
        .map((m) => m[1]),
    );
    expect([...dests].sort()).toEqual(["deck", "discard", "hand"]);
  });
});
