import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effectTypes";
import { applyAction, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
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
  must,
  findEvent,
  driveSetup,
} from "./testFixtures";

/** Iron Valiant `sv05-080` "Calculation" — sentence (i), the OWN-deck arm. */
const PRINTED_OWN = "Look at the top 4 cards of your deck and put them back in any order.";
/** Gothorita `sv10.5w-042` "Fortunate Eye" — sentence (ii), the OPPONENT arm. */
const PRINTED_OPP =
  "Look at the top 5 cards of your opponent's deck and put them back in any order.";

const IRON_VALIANT = "sv05-080";
const DOTTLER = "sv10-088";
const GOTHORITA_A = "sv10.5w-042";
const GOTHORITA_B = "sv10.5w-125";
const LEGAL_IDS = [IRON_VALIANT, DOTTLER, GOTHORITA_A, GOTHORITA_B] as const;

const PSYCHIC_ENERGY = "d341-energy";
const WALL = "d341-wall";
/** Six distinguishable deck fillers, so a re-sequenced top is observable by NAME
    and not only by uid — a permutation of five identical cards is indistinguishable
    from the identity, which would make every ordering assertion vacuous. */
const FILLERS = ["d341-f1", "d341-f2", "d341-f3", "d341-f4", "d341-f5", "d341-f6"] as const;

const LOCAL_CARDS: Record<string, Card> = {
  [IRON_VALIANT]: battler(IRON_VALIANT, {
    name: "Iron Valiant",
    hp: 130,
    retreat: 1,
    types: ["Psychic"],
    attacks: [
      { cost: ["Psychic"], name: "Calculation", effect: PRINTED_OWN },
      { cost: ["Psychic", "Psychic", "Colorless"], name: "Majestic Sword", damage: "100+" },
    ],
  }),
  [DOTTLER]: battler(DOTTLER, {
    name: "Team Rocket's Dottler",
    hp: 90,
    retreat: 1,
    types: ["Psychic"],
    stage: "Stage1",
    evolveFrom: "Team Rocket's Blipbug",
    attacks: [
      {
        cost: ["Colorless"],
        name: "Disruptive Radar",
        effect: "Look at the top 5 cards of your opponent's deck and put them back in any order.",
      },
      { cost: ["Psychic", "Colorless"], name: "Super Psy Bolt", damage: 30 },
    ],
  }),
  [GOTHORITA_A]: battler(GOTHORITA_A, {
    name: "Gothorita",
    hp: 80,
    retreat: 1,
    types: ["Psychic"],
    stage: "Stage1",
    evolveFrom: "Gothita",
    attacks: [
      { cost: ["Psychic"], name: "Fortunate Eye", effect: PRINTED_OPP },
      { cost: ["Psychic", "Colorless"], name: "Psyshot", damage: 40 },
    ],
  }),
  [GOTHORITA_B]: battler(GOTHORITA_B, {
    name: "Gothorita",
    hp: 80,
    retreat: 1,
    types: ["Psychic"],
    stage: "Stage1",
    evolveFrom: "Gothita",
    attacks: [
      { cost: ["Psychic"], name: "Fortunate Eye", effect: PRINTED_OPP },
      { cost: ["Psychic", "Colorless"], name: "Psyshot", damage: 40 },
    ],
  }),
  [PSYCHIC_ENERGY]: typedEnergy(PSYCHIC_ENERGY, "Psychic"),
  [WALL]: battler(WALL, {
    name: "D341 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  ...Object.fromEntries(
    FILLERS.map((id, i) => [
      id,
      battler(id, {
        name: `D341 Filler ${String(i + 1)}`,
        hp: 200,
        retreat: 1,
        types: ["Colorless"],
        attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
      }),
    ]),
  ),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

// 4 + 4 + 4 + 4 + 16 + 4 + 6×4 = 60.
const DECK = deckOf({
  [IRON_VALIANT]: 4,
  [DOTTLER]: 4,
  [GOTHORITA_A]: 4,
  [GOTHORITA_B]: 4,
  [PSYCHIC_ENERGY]: 16,
  [WALL]: 4,
  ...Object.fromEntries(FILLERS.map((id) => [id, 4])),
});

const ATTACK = { type: "attack", seat: "p1", index: 0 } as const;

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

/** TEST SURGERY — `count` Energy onto p1's Active, taken off p1's deck so every
    uid stays in exactly one zone. Both attacks cost a single Energy. */
function fuel(state: GameState, count: number): GameState {
  const side = state.players.p1;
  const body = side.active;
  if (body === null) throw new Error("p1 has no Active");
  const energy = side.deck.filter((u) => state.cardIdByUid[u] === PSYCHIC_ENERGY).slice(0, count);
  if (energy.length < count) throw new Error(`deck lacks ${count} ${PSYCHIC_ENERGY}`);
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

/** TEST SURGERY — replace `seat`'s deck outright. The whole subject of this op is
    a deck's ORDER, so every ordering assertion needs a KNOWN starting sequence;
    seeding by shuffle would make the assertions depend on the rng. */
function setDeck(state: GameState, seat: Seat, deck: readonly string[]): GameState {
  return {
    ...state,
    players: { ...state.players, [seat]: { ...state.players[seat], deck: [...deck] } },
  };
}

/** A board with `attacker` Active for p1 on p1's turn and a 330 HP Wall opposite. */
function board(seed: number, attacker: string): GameState {
  let state = localSetup(seed, "p2");
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", FILLERS[0]);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", attacker);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", FILLERS[1]);
  return fuel(state, 1);
}

/** The catalog ids of the first `n` cards of `seat`'s deck, top first. */
function topIds(state: GameState, seat: Seat, n: number): string[] {
  return state.players[seat].deck.slice(0, n).map((uid) => state.cardIdByUid[uid] ?? "?");
}

function attack(state: GameState): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, ATTACK);
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function answer(state: GameState, uids: readonly string[], seat: Seat = "p1") {
  return applyAction(state, {
    type: "resolveEffect",
    seat,
    choice: { kind: "orderCards", uids: [...uids] },
  });
}

function parkedPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`not parked: ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "orderCards") {
    throw new Error(`wrong prompt: ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 the reader — the four legal printings derive and the two illegal ones do not", () => {
  it("sentence (i) derives to a bare own-deck reorder of the printed window", () => {
    expect(deriveAttackEffect(PRINTED_OWN)).toEqual<EffectOp[]>([{ op: "reorderTop", n: 4 }]);
  });

  it("sentence (ii) derives to the SAME op plus `side`, and nothing else moves", () => {
    expect(deriveAttackEffect(PRINTED_OPP)).toEqual<EffectOp[]>([
      { op: "reorderTop", n: 5, side: "opponent" },
    ]);
  });

  it("all FOUR legal printings resolve off their own catalog text", () => {
    for (const id of LEGAL_IDS) {
      const card = LOCAL_CARDS[id];
      if (card?.category !== "Pokemon") throw new Error(`${id} is not a Pokémon`);
      const effect = card.attacks?.[0]?.effect;
      if (effect === undefined) throw new Error(`${id} attack 0 has no effect text`);
      expect(deriveAttackEffect(effect)).not.toBeNull();
    }
  });

  it("the two GOTHORITA printings carry BYTE-IDENTICAL text and derive identically", () => {
    // `sv10.5w-042` and `sv10.5w-125` are the same card in two slots. If the two
    // ever diverge in the catalog this is the rung that says so, rather than the
    // count silently dropping to 3.
    const a = LOCAL_CARDS[GOTHORITA_A];
    const b = LOCAL_CARDS[GOTHORITA_B];
    if (a?.category !== "Pokemon" || b?.category !== "Pokemon") throw new Error("not Pokémon");
    expect(a.attacks?.[0]?.effect).toBe(b.attacks?.[0]?.effect);
  });

  it("Absol ex's *either player's* deck is REFUSED — a printed SIDE CHOICE", () => {
    expect(
      deriveAttackEffect(
        "Look at the top 3 cards of either player's deck and put them back in any order.",
      ),
    ).toBeNull();
  });

  it("the four NEIGHBOURING `in any order` sentences are all refused", () => {
    for (const sentence of [
      // Deduction Kit `sv08-171` — this arm's sentence PLUS a printed `or`.
      "Look at the top 3 cards of your deck and put them back in any order, or shuffle them and put them on the bottom of your deck.",
      // Raifort `sv06-161`/`sv08.5-142` — a discard, then a reorder of the rest.
      "Look at the top 5 cards of your deck and discard any number of them. Put the other cards back in any order.",
      // Kofu `sv07-138`/`-165` — from the HAND, to the BOTTOM.
      "Put 2 cards from your hand on the bottom of your deck in any order.",
    ]) {
      expect(deriveAttackEffect(sentence)).toBeNull();
    }
  });

  it("D342 — the SEARCH neighbour is no longer NULL, and THIS arm still refuses it", () => {
    const search =
      "Search your deck for 2 cards, shuffle your deck, then put those cards on top of it in any order.";
    const derived = deriveAttackEffect(search);
    expect(derived).not.toBeNull();
    expect(derived?.map((op) => op.op)).toEqual(["shuffleDeck", "searchDeck", "reorderTop"]);
    expect(derived).not.toEqual<EffectOp[]>([{ op: "reorderTop", n: 2 }]);
  });

  it("THE TRAILING ANCHOR IS LOAD-BEARING RATHER THAN HYGIENIC", () => {
    const withTail =
      "Look at the top 3 cards of your deck and put them back in any order, or shuffle them and put them on the bottom of your deck.";
    expect(
      withTail.startsWith("Look at the top 3 cards of your deck and put them back in any order"),
    ).toBe(true);
    expect(deriveAttackEffect(withTail)).toBeNull();
  });

  it("the window is DIGITS — `Number`'s grammar cannot size a deck window", () => {
    for (const n of ["4e1", "0x28", "4.5", " 4", "four"]) {
      expect(
        deriveAttackEffect(
          `Look at the top ${n} cards of your deck and put them back in any order.`,
        ),
      ).toBeNull();
    }
  });

  it("the printed-number guard refuses 0 and refuses an absurd window", () => {
    expect(
      deriveAttackEffect("Look at the top 0 cards of your deck and put them back in any order."),
    ).toBeNull();
    expect(
      deriveAttackEffect("Look at the top 999 cards of your deck and put them back in any order."),
    ).toBeNull();
  });

  it("BOTH spellings of the possessive apostrophe read as the opponent arm", () => {
    expect(
      deriveAttackEffect(
        "Look at the top 5 cards of your opponent’s deck and put them back in any order.",
      ),
    ).toEqual<EffectOp[]>([{ op: "reorderTop", n: 5, side: "opponent" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§2 the park — the window is offered in DECK ORDER and the note names the deck", () => {
  it("Iron Valiant parks on `orderCards` with the top 4 of p1's OWN deck, top first", () => {
    const state = seededOwn(3);
    const before = topIds(state, "p1", 4);
    const { state: parked } = attack(state);
    const prompt = parkedPrompt(parked);
    expect(prompt.candidates).toHaveLength(4);
    // The offer IS the current top, in current order — the identity permutation
    // has to be a reachable answer, and the dialog needs the order it starts from.
    expect(prompt.candidates.map((uid) => parked.cardIdByUid[uid])).toEqual(before);
  });

  it("the note speaks to the ANSWERER and names WHOSE deck, on both arms", () => {
    const own = parkedPrompt(attack(seededOwn(4)).state);
    expect(own.note).toBe("Put these cards back on top of your deck in any order.");
    const opp = parkedPrompt(attack(seededOpp(7)).state);
    expect(opp.note).toBe("Put these cards back on top of your opponent's deck in any order.");
  });

  it("the note prints NO number, unlike every other look caption", () => {
    const short = parkedPrompt(attack(seededOpp(9, 2)).state);
    expect(short.candidates).toHaveLength(2);
    expect(short.note).not.toMatch(/\d/);
  });

  it("Gothorita and Dottler park on the OPPONENT's cards, not the controller's", () => {
    for (const id of [DOTTLER, GOTHORITA_A, GOTHORITA_B]) {
      const state = seededOpp(11, 5, id);
      const expected = topIds(state, "p2", 5);
      const parked = attack(state).state;
      const prompt = parkedPrompt(parked);
      expect(prompt.candidates.map((uid) => parked.cardIdByUid[uid])).toEqual(expected);
      // And NONE of them is a card of the controller's — the whole point of `side`.
      expect(prompt.candidates.every((uid) => !parked.players.p1.deck.includes(uid))).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§3 the degenerate windows — no decision, no park, but the LOOK is announced", () => {
  it("a 1-card deck does NOT park: one ordering is not a decision", () => {
    const state = seededOpp(13, 1);
    const { state: done, events } = attack(state);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(findEvent(events, "DECK_TOP_REORDERED")?.count).toBe(1);
  });

  it("an EMPTY deck does not park and still announces a look of 0", () => {
    const state = seededOpp(17, 0);
    const { state: done, events } = attack(state);
    expect(done.phase.kind).not.toBe("effect:choose");
    const row = findEvent(events, "DECK_TOP_REORDERED");
    expect(row?.count).toBe(0);
  });

  it("the announced COUNT is what was LOOKED AT, never the printed window", () => {
    // A 2-card deck under a printed top-5 taught the looker two cards. Announcing
    // five would be a claim about cards nobody saw — `lookAtTopN`'s whiff branch
    // guards on `top.length` for the same reason, and this is that rule transferred.
    const { events } = attack(seededOpp(19, 2));
    expect(findEvent(events, "DECK_TOP_REORDERED")?.count).toBe(2);
  });

  it("a 2-card window DOES park — two is the smallest real decision", () => {
    expect(parkedPrompt(attack(seededOpp(23, 2)).state).candidates).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§4 the apply — the ANSWER'S POSITIONS are the whole effect", () => {
  it("the deck top is re-sequenced into the answered order and nothing else moves", () => {
    const state = seededOwn(29);
    const before = [...state.players.p1.deck];
    const parked = attack(state).state;
    const prompt = parkedPrompt(parked);
    const reversed = [...prompt.candidates].reverse();
    const done = must(answer(parked, reversed));
    expect(done.players.p1.deck.slice(0, 4)).toEqual(reversed);
    // Everything UNDER the window is byte-identical — the splice replaces exactly
    // `uids.length` slots and re-derives the tail off the live deck.
    expect(done.players.p1.deck.slice(4)).toEqual(before.slice(4));
    expect(done.players.p1.deck).toHaveLength(before.length);
  });

  it("the IDENTITY permutation is a legal answer and leaves the deck untouched", () => {
    // "Put them back in any order" prints no "you may": leaving the order alone is
    // an ANSWER the player gives, not a decline they take.
    const state = seededOwn(31);
    const before = [...state.players.p1.deck];
    const parked = attack(state).state;
    const done = must(answer(parked, parkedPrompt(parked).candidates));
    expect(done.players.p1.deck).toEqual(before);
  });

  it("the OPPONENT arm orders the OPPONENT's deck, AND THE NEW TOP IS WHAT THEY DRAW", () => {
    const state = seededOpp(37, 5);
    const ownBefore = [...state.players.p1.deck];
    const parked = attack(state).state;
    const rotated = [...parkedPrompt(parked).candidates];
    const head = rotated.shift();
    if (head === undefined) throw new Error("empty window");
    rotated.push(head);
    const done = must(answer(parked, rotated));
    const drawn = rotated[0];
    if (drawn === undefined) throw new Error("empty ordering");
    expect(done.players.p2.hand).toContain(drawn);
    expect(done.players.p2.deck.slice(0, 4)).toEqual(rotated.slice(1));
    // The controller's own deck is untouched — the failure this rung exists for is
    // an apply that read `ctx.seat` where the park read the opponent.
    expect(done.players.p1.deck).toEqual(ownBefore);
  });

  it("no card is created or destroyed — counted over deck AND hand, not deck alone", () => {
    // The same correction, stated as arithmetic: the turn hand-off draws, so a
    // deck-only conservation law is false for the seat whose turn begins. Deck +
    // hand is the invariant the reorder actually preserves.
    const state = seededOpp(41, 5);
    const held = (s: GameState, seat: Seat) =>
      s.players[seat].deck.length + s.players[seat].hand.length;
    const before = [held(state, "p1"), held(state, "p2")];
    const parked = attack(state).state;
    const done = must(answer(parked, [...parkedPrompt(parked).candidates].reverse()));
    expect([held(done, "p1"), held(done, "p2")]).toEqual(before);
  });

  it("the resolve emits NO second `DECK_TOP_REORDERED` row", () => {
    const parked = attack(seededOwn(43)).state;
    const result = answer(parked, [...parkedPrompt(parked).candidates].reverse());
    if (!result.ok) throw new Error("answer refused");
    expect(result.events.filter((e) => e.type === "DECK_TOP_REORDERED")).toHaveLength(0);
  });

  it("the program finishes and the turn returns to the controller", () => {
    const parked = attack(seededOwn(47)).state;
    const done = must(answer(parked, [...parkedPrompt(parked).candidates].reverse()));
    expect(done.phase.kind).not.toBe("effect:choose");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§5 validateChoice — a PERMUTATION, which is three refusals the `cards` arm has never had to make", () => {
  it("a SHORT answer is refused — it would destroy the cards it left out", () => {
    const parked = attack(seededOwn(53)).state;
    const result = answer(parked, parkedPrompt(parked).candidates.slice(0, 3));
    expect(result.ok).toBe(false);
  });

  it("an EMPTY answer is refused — there is no printed decline", () => {
    const parked = attack(seededOwn(59)).state;
    expect(answer(parked, []).ok).toBe(false);
  });

  it("a LONG answer is refused", () => {
    const parked = attack(seededOwn(61)).state;
    const c = parkedPrompt(parked).candidates;
    expect(answer(parked, [...c, c[0] ?? ""]).ok).toBe(false);
  });

  it("a REPEATED uid is refused — one physical card cannot occupy two slots", () => {
    const parked = attack(seededOwn(67)).state;
    const c = parkedPrompt(parked).candidates;
    const first = c[0];
    if (first === undefined) throw new Error("empty window");
    expect(answer(parked, [first, first, c[2] ?? "", c[3] ?? ""]).ok).toBe(false);
  });

  it("an UNOFFERED uid is refused — it would drag a card up from BELOW the window", () => {
    // `lookAtTopN`'s rule: the print let the player see the top N, so an answer
    // naming index N would promote a card nobody looked at.
    const parked = attack(seededOwn(71)).state;
    const c = parkedPrompt(parked).candidates;
    const deeper = parked.players.p1.deck[4];
    if (deeper === undefined) throw new Error("deck too short");
    expect(answer(parked, [deeper, c[1] ?? "", c[2] ?? "", c[3] ?? ""]).ok).toBe(false);
  });

  it("a WRONG-KIND answer is refused", () => {
    const parked = attack(seededOwn(73)).state;
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [...parkedPrompt(parked).candidates] },
    });
    expect(result.ok).toBe(false);
  });

  it("a NON-STRING entry off the wire is refused", () => {
    // The `string[]` type is a claim about the action, not about the JSON — the
    // `attachCards` arm's rule, and a P4 client is checked by this function alone.
    const parked = attack(seededOwn(79)).state;
    const c = parkedPrompt(parked).candidates;
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "orderCards",
        uids: [7 as unknown as string, c[1] ?? "", c[2] ?? "", c[3] ?? ""],
      },
    });
    expect(result.ok).toBe(false);
  });

  it("every refusal leaves the park standing, so the game is not soft-locked", () => {
    const parked = attack(seededOwn(83)).state;
    const refused = answer(parked, []);
    expect(refused.ok).toBe(false);
    // The phase is unchanged, so the correct answer still lands.
    expect(must(answer(parked, [...parkedPrompt(parked).candidates].reverse()))).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§6 redaction — the deck's OWNER must not learn their own top", () => {
  it("the OPPONENT's projection carries no card identity from the prompt", () => {
    const parked = attack(seededOpp(89, 5)).state;
    const prompt = parkedPrompt(parked);
    const victimView = redactGame(parked, "p2");
    const serialized = JSON.stringify(victimView);
    for (const uid of prompt.candidates) {
      expect(serialized).not.toContain(uid);
    }
  });

  it("the ANSWERER's projection carries the full ordered window", () => {
    const parked = attack(seededOpp(97, 5)).state;
    const prompt = parkedPrompt(parked);
    const view = redactGame(parked, "p1");
    const wire = view.phase.kind === "effect:choose" ? view.phase.prompt : null;
    if (wire === null || wire.kind !== "orderCards") throw new Error("no orderCards prompt");
    expect(wire.candidates.map((c: { id: string }) => c.id)).toEqual([...prompt.candidates]);
    // ORDER-PRESERVING: the redactor must not sort or group, because the order it
    // passes through is the state the player is reordering FROM.
    expect(wire.candidates.every((c: { name: string }) => typeof c.name === "string")).toBe(true);
  });

  it("the own-deck arm reaches its own controller unchanged", () => {
    const parked = attack(seededOwn(101)).state;
    const view = redactGame(parked, "p1");
    const wire = view.phase.kind === "effect:choose" ? view.phase.prompt : null;
    if (wire === null || wire.kind !== "orderCards") throw new Error("no orderCards prompt");
    expect(wire.candidates).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§7 the event and its log row — count-only, and the voice follows the actor", () => {
  it("`seat` is the DECK'S OWNER and `actor` is the looker, on the opponent arm", () => {
    const { events } = attack(seededOpp(103, 5));
    const row = findEvent(events, "DECK_TOP_REORDERED");
    expect(row).toEqual({ type: "DECK_TOP_REORDERED", seat: "p2", actor: "p1", count: 5 });
  });

  it("on the own-deck arm the two seats coincide", () => {
    const { events } = attack(seededOwn(107));
    const row = findEvent(events, "DECK_TOP_REORDERED");
    expect(row).toEqual({ type: "DECK_TOP_REORDERED", seat: "p1", actor: "p1", count: 4 });
  });

  it("the row names NO card — the whole confidentiality rule in one assertion", () => {
    const { state: parked, events } = attack(seededOpp(109, 5));
    const row = findEvent(events, "DECK_TOP_REORDERED");
    if (row === undefined) throw new Error("no row");
    const serialized = JSON.stringify(row);
    for (const uid of parkedPrompt(parked).candidates) {
      expect(serialized).not.toContain(uid);
    }
  });

  it("the log VOICE is ACTIVE for the own-deck look and PASSIVE for the opponent's", () => {
    const own = logRows(attack(seededOwn(113)));
    expect(own).toContainEqual([
      "p1",
      "looked at the top 4 cards of their deck and put them back in a chosen order",
    ]);
    const opp = logRows(attack(seededOpp(127, 5)));
    expect(opp).toContainEqual([
      "p2",
      "had the top 5 cards of their deck looked at and put back in a chosen order",
    ]);
    expect(opp.some(([seat, text]) => seat === "p2" && text.startsWith("looked"))).toBe(false);
  });

  it("the row singularises at a count of 1", () => {
    const text = logRows(attack(seededOpp(131, 1)))
      .map(([, t]) => t)
      .join("\n");
    expect(text).toContain("had the top card of their deck looked at");
    expect(text).not.toContain("chosen order");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§8 the census arithmetic this row is accountable for", () => {
  it("FOUR legal printings on TWO sentences, and the two sums agree", () => {
    // (b)'s split re-added against its own total: 1 own-deck + 3 opponent-deck = 4.
    const own = LEGAL_IDS.filter((id) => {
      const card = LOCAL_CARDS[id];
      return card?.category === "Pokemon" && card.attacks?.[0]?.effect === PRINTED_OWN;
    });
    const opp = LEGAL_IDS.filter((id) => {
      const card = LOCAL_CARDS[id];
      return card?.category === "Pokemon" && card.attacks?.[0]?.effect === PRINTED_OPP;
    });
    expect(own).toHaveLength(1);
    expect(opp).toHaveLength(3);
    expect(own.length + opp.length).toBe(LEGAL_IDS.length);
  });

  it("every id derives, so the raw summand steps by exactly the printing count", () => {
    const resolved = LEGAL_IDS.filter((id) => {
      const card = LOCAL_CARDS[id];
      if (card?.category !== "Pokemon") return false;
      const effect = card.attacks?.[0]?.effect;
      return effect !== undefined && deriveAttackEffect(effect) !== null;
    });
    expect(resolved).toHaveLength(4);
  });

  it("the engine version has moved PAST D341's bump and the anchor has moved on", () => {
    expect(engineVersion >= "0.247.0").toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§9 this suite adds NOTHING to the shared fixture pool", () => {
  it("every local id is absent from `FIXTURE_POOL`", () => {
    for (const id of Object.keys(LOCAL_CARDS)) {
      expect(FIXTURE_POOL[id]).toBeUndefined();
    }
  });

  it("the four real catalog ids are real ids and not `fix-*` keys", () => {
    for (const id of LEGAL_IDS) {
      expect(id.startsWith("fix-")).toBe(false);
    }
  });
});

// ── helpers used above, defined after the suites they serve ─────────────────

function seedDeck(state: GameState, seat: Seat, size: number): GameState {
  const deck = state.players[seat].deck;
  if (deck.length < size) throw new Error(`${seat}'s deck is shorter than ${String(size)}`);
  return setDeck(state, seat, deck.slice(0, size));
}

/** A board where p1 attacks with Iron Valiant over a six-card own deck. */
function seededOwn(seed: number): GameState {
  return seedDeck(board(seed, IRON_VALIANT), "p1", 6);
}

function seededOpp(seed: number, size = 5, attacker: string = GOTHORITA_A): GameState {
  return seedDeck(board(seed, attacker), "p2", size);
}

function logRows(run: { state: GameState; events: readonly GameEvent[] }): [string, string][] {
  const ctx: LogContext = { names: { p1: "Ash", p2: "Gary" }, state: run.state, elapsed: "+00:00" };
  return logFromEvents(run.events, ctx).flatMap((r) =>
    r.kind === "action"
      ? [[r.who, r.segments.map((seg) => seg.text).join("")] as [string, string]]
      : [],
  );
}
