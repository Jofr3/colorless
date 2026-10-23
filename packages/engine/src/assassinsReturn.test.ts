import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./index";
import type { GameState, Seat } from "./index";
import { logFromEvents } from "./log";
import { programFor } from "./registry";
import {
  completeSetup,
  FIXTURE_POOL,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  trainerCard,
  typedEnergy,
  must,
  findEvent,
} from "./testFixtures";

const CROBAT_PRINTED =
  "You may put this Pokémon into your hand. (Discard all cards attached to this Pokémon.)";
const COMFEY_PRINTED = "Put this Pokémon and all attached cards into your hand.";
const REVAVROOM_PRINTED = "Discard this Pokémon and all attached cards.";

/** The index-0 sentences the registry deliberately does NOT author, kept as the
    controls for each card's index-precision claim. */
const COMFEY_IDX0 =
  "You may search your deck for any number of Basic Lillie's Pokémon and put them onto your Bench. Then, shuffle your deck.";
const REVAVROOM_IDX0 =
  "If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 120 more damage.";
const BITING_SPREE =
  "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may choose 2 of your opponent's Pokémon and put 2 damage counters on each of them.";

const CROBAT = "sv10-122";
const CROBAT_REPRINTS = ["sv10-217", "sv10-234", "sv10-242"] as const;
const COMFEY = "sv09-068";
const REVAVROOM = "sv06.5-015";
const REVAVROOM_REPRINT = "sv06.5-081";

const WALL = "fix-d313ar-wall";
const FILLER = "fix-d313ar-filler";
const UNDER = "fix-d313ar-under";
const DARK = "fix-d313ar-dark";
const PSY = "fix-d313ar-psy";
const METAL = "fix-d313ar-metal";
const TOOL = "fix-d313ar-tool";

const LOCAL_CARDS: Record<string, Card> = {
  [CROBAT]: battler(CROBAT, {
    name: "Team Rocket's Crobat ex",
    hp: 310,
    stage: "Stage2",
    evolveFrom: "Team Rocket's Golbat",
    retreat: 1,
    types: ["Darkness"],
    abilities: [{ type: "Ability", name: "Biting Spree", effect: BITING_SPREE }],
    attacks: [
      {
        cost: ["Darkness", "Darkness"],
        name: "Assassin's Return",
        damage: 120,
        effect: CROBAT_PRINTED,
      },
    ],
  }),
  [COMFEY]: battler(COMFEY, {
    name: "Lillie's Comfey",
    hp: 70,
    retreat: 1,
    types: ["Psychic"],
    attacks: [
      { cost: ["Colorless"], name: "Inviting Flowers", effect: COMFEY_IDX0 },
      { cost: ["Psychic"], name: "Fade Out", damage: 30, effect: COMFEY_PRINTED },
    ],
  }),
  [REVAVROOM]: battler(REVAVROOM, {
    name: "Revavroom ex",
    hp: 280,
    stage: "Stage1",
    evolveFrom: "Varoom",
    retreat: 1,
    types: ["Lightning"],
    attacks: [
      { cost: ["Metal"], name: "Accelerator Flash", damage: "20+", effect: REVAVROOM_IDX0 },
      {
        cost: ["Metal", "Metal", "Metal"],
        name: "Shattering Speed",
        damage: 250,
        effect: REVAVROOM_PRINTED,
      },
    ],
  }),
  [WALL]: battler(WALL, {
    name: "D313 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "D313 Filler",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [UNDER]: battler(UNDER, {
    name: "D313 Under",
    hp: 60,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [TOOL]: trainerCard(TOOL, "Tool", "Attach to 1 of your Pokémon."),
  [DARK]: typedEnergy(DARK, "Darkness"),
  [PSY]: typedEnergy(PSY, "Psychic"),
  [METAL]: typedEnergy(METAL, "Metal"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [CROBAT]: 2,
  [COMFEY]: 2,
  [REVAVROOM]: 2,
  [WALL]: 4,
  [FILLER]: 6,
  [UNDER]: 4,
  [TOOL]: 4,
  [DARK]: 12,
  [PSY]: 12,
  [METAL]: 12,
});

const SEEDS = [4241, 4253] as const;

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  state = completeSetup(state);
  return state;
}

/** TEST SURGERY — `count` Energy of `cardId` onto p1's Active, taken off the
    deck so every uid stays in exactly one zone. */
function fuel(state: GameState, cardId: string, count: number): GameState {
  const side = state.players.p1;
  const body = side.active;
  if (body === null) throw new Error("p1 has no Active");
  const energy = side.deck.filter((u) => state.cardIdByUid[u] === cardId).slice(0, count);
  if (energy.length < count) throw new Error(`deck lacks ${count} ${cardId}`);
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

/** A board with `attacker` Active for p1 on p1's turn, a 330 HP Wall opposite
    (nothing here is meant to Knock anything out except where §5 says so), and
    `bench` filler bodies behind the attacker. */
function board(opts: {
  attacker: string;
  energy: string;
  count: number;
  bench?: number;
  under?: number;
  tool?: boolean;
  seed?: number;
  p2Bench?: number;
}): GameState {
  let state = localSetup(opts.seed ?? SEEDS[0], "p2");
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p2");
  for (let i = 0; i < (opts.p2Bench ?? 1); i += 1) state = benchFromDeck(state, "p2", FILLER);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", opts.attacker);
  state = clearBench(state, "p1");
  for (let i = 0; i < (opts.bench ?? 1); i += 1) state = benchFromDeck(state, "p1", FILLER);
  if (opts.under !== undefined) state = stackUnder(state, opts.under);
  if (opts.tool === true) state = attachToolFromDeck(state, "p1", "active", TOOL);
  return fuel(state, opts.energy, opts.count);
}

const ASSASSIN = { type: "attack", seat: "p1", index: 0 } as const;
const FADE_OUT = { type: "attack", seat: "p1", index: 1 } as const;
const SHATTER = { type: "attack", seat: "p1", index: 1 } as const;
const YES = { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } } as const;
const NO = { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: false } } as const;

// ────────────────────────────────────────────────────────────────────────────
describe("D313 §1 — the three prints, the three registry rows, and what differs between them", () => {
  it("every fixture carries its printed sentences VERBATIM, at its printed index", () => {
    expect(POOL[CROBAT]?.attacks?.[0]?.effect).toBe(CROBAT_PRINTED);
    expect(POOL[CROBAT]?.attacks?.[0]?.name).toBe("Assassin's Return");
    expect(POOL[CROBAT]?.attacks?.[0]?.damage).toBe(120);
    expect(POOL[CROBAT]?.attacks?.[1]).toBeUndefined();
    expect(POOL[COMFEY]?.attacks?.[1]?.effect).toBe(COMFEY_PRINTED);
    expect(POOL[COMFEY]?.attacks?.[1]?.damage).toBe(30);
    expect(POOL[COMFEY]?.attacks?.[0]?.effect).toBe(COMFEY_IDX0);
    expect(POOL[REVAVROOM]?.attacks?.[1]?.effect).toBe(REVAVROOM_PRINTED);
    expect(POOL[REVAVROOM]?.attacks?.[1]?.damage).toBe(250);
    expect(POOL[REVAVROOM]?.attacks?.[0]?.effect).toBe(REVAVROOM_IDX0);
  });

  it("the SPLIT row is `dest: hand` + `attachmentsTo: discard`, wrapped in the printed `optional`", () => {
    expect(programFor(CROBAT)?.attack?.[0]).toEqual([
      {
        op: "optional",
        note: CROBAT_PRINTED,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "returnSelf", dest: "hand", attachmentsTo: "discard" }],
      },
    ]);
  });

  it("the two UNSPLIT rows are bare — no wrapper, no `attachmentsTo`", () => {
    expect(programFor(COMFEY)?.attack?.[1]).toEqual([{ op: "returnSelf", dest: "hand" }]);
    expect(programFor(REVAVROOM)?.attack?.[1]).toEqual([{ op: "returnSelf", dest: "discard" }]);
    expect(CROBAT_PRINTED.includes("You may")).toBe(true);
    expect(COMFEY_PRINTED.includes("You may")).toBe(false);
    expect(REVAVROOM_PRINTED.includes("You may")).toBe(false);
  });

  it("index-precision in BOTH directions on all three cards", () => {
    expect(programFor(CROBAT)?.attack?.[0]).toBeDefined();
    expect(programFor(CROBAT)?.attack?.[1]).toBeUndefined();
    for (const id of [COMFEY, REVAVROOM, REVAVROOM_REPRINT]) {
      expect(programFor(id)?.attack?.[1], id).toBeDefined();
    }
    expect(programFor(COMFEY)?.attack?.[0]).toBeDefined();
    expect(programFor(REVAVROOM)?.attack?.[0]).toBeUndefined();
    expect(programFor(REVAVROOM_REPRINT)?.attack?.[0]).toBeUndefined();
  });

  it("the four Crobat ex printings are ONE object that carries BOTH printed surfaces", () => {
    const first = programFor(CROBAT);
    for (const id of CROBAT_REPRINTS) expect(programFor(id), id).toBe(first);
    expect(programFor("fix-bitingspree")).toBe(first);
    expect(first?.triggered).toHaveLength(1);
    expect(first?.attack?.[0]).toBeDefined();
    expect(programFor(REVAVROOM_REPRINT)).toBe(programFor(REVAVROOM));
  });

  it("the three sentences are DISTINCT — no row was written from a paraphrase", () => {
    const set = new Set([CROBAT_PRINTED, COMFEY_PRINTED, REVAVROOM_PRINTED]);
    expect(set.size).toBe(3);
    const wrapper = programFor(CROBAT)?.attack?.[0]?.[0];
    expect(wrapper?.op).toBe("optional");
    expect(wrapper?.op === "optional" ? wrapper.note : "").toBe(POOL[CROBAT]?.attacks?.[0]?.effect);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D313 §2 — THE SPLIT, driven on the only board where the two piles differ", () => {
  /** A Crobat ex with TWO cards under it, two {D} and a Tool attached: the body
      pile is THREE uids, the attached pile is THREE, and they go to different
      zones. On a Basic with nothing under it, a wrong split is invisible. */
  function split(seed?: number): GameState {
    return board({ attacker: CROBAT, energy: DARK, count: 2, under: 2, tool: true, seed });
  }

  it("the board is the discriminating one: 3 in the stack, 3 attached", () => {
    const state = split();
    const body = state.players.p1.active;
    expect(body?.stack).toHaveLength(3);
    expect(body?.energy).toHaveLength(2);
    expect(body?.tools).toHaveLength(1);
  });

  for (const seed of SEEDS) {
    it(`the STACK goes to the hand and the ATTACHMENTS go to the discard (seed ${seed})`, () => {
      const state = split(seed);
      const body = state.players.p1.active;
      const stack = body?.stack ?? [];
      const attached = [...(body?.energy ?? []), ...(body?.tools ?? [])];
      const handBefore = state.players.p1.hand.length;
      const discardBefore = state.players.p1.discard.length;

      const parked = must(applyAction(state, ASSASSIN));
      const after = must(applyAction(parked, YES));

      // The body pile — every card of it, not just the top — is in the hand.
      for (const uid of stack) expect(after.players.p1.hand, uid).toContain(uid);
      expect(after.players.p1.hand).toHaveLength(handBefore + 3);
      // …and the attachments are in the discard, which is the parenthetical.
      for (const uid of attached) expect(after.players.p1.discard, uid).toContain(uid);
      expect(after.players.p1.discard).toHaveLength(discardBefore + 3);
      for (const uid of stack) expect(after.players.p1.discard, uid).not.toContain(uid);
      for (const uid of attached) expect(after.players.p1.hand, uid).not.toContain(uid);
      // The deck is untouched — this destination never shuffles.
      expect(after.players.p1.deck).toHaveLength(state.players.p1.deck.length);
    });
  }

  it("no SHUFFLE event is emitted — nothing reached the deck", () => {
    const parked = must(applyAction(split(), ASSASSIN));
    const result = applyAction(parked, YES);
    if (!result.ok) throw new Error("resolve failed");
    expect(findEvent(result.events, "SHUFFLE")).toBeUndefined();
  });

  it("the event names the BODY's zone in `dest` and the attachments' in `attachmentsTo`", () => {
    const state = split();
    const body = state.players.p1.active;
    const parked = must(applyAction(state, ASSASSIN));
    const result = applyAction(parked, YES);
    if (!result.ok) throw new Error("resolve failed");
    const returned = findEvent(result.events, "POKEMON_RETURNED");
    expect(returned?.dest).toBe("hand");
    expect(returned?.uid).toBe(body?.stack[body.stack.length - 1]);
    // `uids` stays the WHOLE pile (the KNOCKED_OUT precedent) — six cards.
    expect(returned?.uids).toHaveLength(6);
    expect(returned?.attachmentsTo?.dest).toBe("discard");
    expect(returned?.attachmentsTo?.uids).toHaveLength(3);
    // …and the split subset is a SUBSET of `uids`, so a reader that trusts one
    // field cannot be told a card that is not in the other.
    for (const uid of returned?.attachmentsTo?.uids ?? []) {
      expect(returned?.uids, uid).toContain(uid);
    }
  });

  it("the log row COUNTS THE ATTACHMENTS and not the pile", () => {
    const parked = must(applyAction(split(), ASSASSIN));
    const result = applyAction(parked, YES);
    if (!result.ok) throw new Error("resolve failed");
    const lines = logFromEvents(result.events, {
      names: { p1: "P1", p2: "P2" },
      state: result.state,
      elapsed: "+00:10",
    });
    const line = lines.find((l) =>
      l.kind === "action" ? l.segments.some((seg) => seg.text.includes("P1's hand")) : false,
    );
    if (line === undefined || line.kind !== "action") throw new Error("no POKEMON_RETURNED row");
    expect(line.who).toBe("p1");
    const text = line.segments.map((seg) => seg.text).join("");
    expect(text).toContain("into P1's hand");
    expect(text).toContain("and discarded 3 attached cards");
    expect(text).not.toContain("5 attached");
  });

  it("a SPLIT with nothing attached says so by omission, not by a zero", () => {
    const state = board({ attacker: CROBAT, energy: DARK, count: 2, under: 2 });
    const parked = must(applyAction(state, ASSASSIN));
    const result = applyAction(parked, YES);
    if (!result.ok) throw new Error("resolve failed");
    const returned = findEvent(result.events, "POKEMON_RETURNED");
    expect(returned?.attachmentsTo?.uids).toHaveLength(2);
    expect(result.state.players.p1.discard).toHaveLength(2);
    expect(
      result.state.players.p1.hand.filter((u) => result.state.cardIdByUid[u] === UNDER),
    ).toHaveLength(2);
  });

  it("the 120 is dealt BEFORE the bounce — §8.5 order, not this op's choice", () => {
    const state = split();
    const parked = must(applyAction(state, ASSASSIN));
    // The damage is on the board while the confirm prompt is still open.
    expect(parked.players.p2.active?.damage).toBe(120);
    const after = must(applyAction(parked, YES));
    expect(after.players.p2.active?.damage).toBe(120);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D313 §3 — the two UNSPLIT destinations, which are the split's controls", () => {
  it("Comfey sends the ATTACHMENTS to the HAND too — the same board, the other field state", () => {
    const state = board({ attacker: COMFEY, energy: PSY, count: 1, under: 0, tool: true });
    const body = state.players.p1.active;
    const attached = [...(body?.energy ?? []), ...(body?.tools ?? [])];
    expect(attached).toHaveLength(2);
    const result = applyAction(state, FADE_OUT);
    if (!result.ok) throw new Error("attack failed");
    for (const uid of attached) expect(result.state.players.p1.hand, uid).toContain(uid);
    expect(result.state.players.p1.discard).toHaveLength(0);
    const returned = findEvent(result.events, "POKEMON_RETURNED");
    expect(returned?.dest).toBe("hand");
    expect(returned?.attachmentsTo).toBeUndefined();
  });

  it("Revavroom ex sends the WHOLE pile to the discard, body included", () => {
    const state = board({ attacker: REVAVROOM, energy: METAL, count: 3, under: 1, tool: true });
    const body = state.players.p1.active;
    const whole = [...(body?.stack ?? []), ...(body?.energy ?? []), ...(body?.tools ?? [])];
    expect(whole).toHaveLength(6);
    const result = applyAction(state, SHATTER);
    if (!result.ok) throw new Error("attack failed");
    for (const uid of whole) expect(result.state.players.p1.discard, uid).toContain(uid);
    expect(result.state.players.p1.discard).toHaveLength(6);
    const returned = findEvent(result.events, "POKEMON_RETURNED");
    expect(returned?.dest).toBe("discard");
    expect(returned?.attachmentsTo).toBeUndefined();
    expect(findEvent(result.events, "SHUFFLE")).toBeUndefined();
  });

  it("a self-DISCARD is not a Knock Out — nobody takes a prize", () => {
    const state = board({ attacker: REVAVROOM, energy: METAL, count: 3 });
    const prizesBefore = state.players.p2.prizes.length;
    const result = applyAction(state, SHATTER);
    if (!result.ok) throw new Error("attack failed");
    expect(findEvent(result.events, "KNOCKED_OUT")).toBeUndefined();
    expect(findEvent(result.events, "PRIZES_OWED")).toBeUndefined();
    expect(result.state.players.p2.prizes).toHaveLength(prizesBefore);
  });

  it("the discard row and the hand row read differently in the log", () => {
    const hand = board({ attacker: COMFEY, energy: PSY, count: 1 });
    const disc = board({ attacker: REVAVROOM, energy: METAL, count: 3 });
    const render = (state: GameState, action: Parameters<typeof applyAction>[1]) => {
      const result = applyAction(state, action);
      if (!result.ok) throw new Error("attack failed");
      return logFromEvents(result.events, {
        names: { p1: "P1", p2: "P2" },
        state: result.state,
        elapsed: "+00:10",
      })
        .flatMap((l) => (l.kind === "action" ? [l.segments.map((seg) => seg.text).join("")] : []))
        .join(" | ");
    };
    expect(render(hand, FADE_OUT)).toContain("into P1's hand");
    // "discard pile" is §2's name for the zone, not the field value read aloud.
    expect(render(disc, SHATTER)).toContain("into P1's discard pile");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D313 §4 — the printed `optional`, both directions, and its absence on the other two", () => {
  it("declining leaves the Crobat ex standing with EVERY card still attached", () => {
    const state = board({ attacker: CROBAT, energy: DARK, count: 2, under: 2, tool: true });
    const parked = must(applyAction(state, ASSASSIN));
    expect(parked.phase.kind).toBe("effect:choose");
    const after = must(applyAction(parked, NO));
    const body = after.players.p1.active;
    expect(body?.stack).toHaveLength(3);
    expect(body?.energy).toHaveLength(2);
    expect(body?.tools).toHaveLength(1);
    expect(after.players.p1.discard).toHaveLength(0);
    // …and the 120 stays dealt. Declining the bounce does not undo the attack.
    expect(after.players.p2.active?.damage).toBe(120);
  });

  it("the prompt is the printed sentence, character for character", () => {
    const parked = must(applyAction(board({ attacker: CROBAT, energy: DARK, count: 2 }), ASSASSIN));
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(parked.phase.prompt.note).toBe(CROBAT_PRINTED);
  });

  it("neither compulsory printing parks at all — the wrapper is the sentence", () => {
    // The converse of §1's assertion, driven on a board: a Comfey and a Revavroom
    // ex resolve in one action with no prompt in between, so an author who copied
    // Crobat ex's wrapper across would redden here and not only in §1.
    const comfey = applyAction(board({ attacker: COMFEY, energy: PSY, count: 1 }), FADE_OUT);
    if (!comfey.ok) throw new Error("attack failed");
    expect(comfey.state.phase.kind).not.toBe("effect:choose");
    // The Comfey is GONE without anyone being asked — the §8.1 seam has already
    // promoted the one benched body behind it, which is §5's business and here is
    // only the evidence that no prompt intervened.
    expect(comfey.state.cardIdByUid[comfey.state.players.p1.active?.stack[0] ?? ""]).not.toBe(
      COMFEY,
    );
    const rev = applyAction(board({ attacker: REVAVROOM, energy: METAL, count: 3 }), SHATTER);
    if (!rev.ok) throw new Error("attack failed");
    expect(rev.state.phase.kind).not.toBe("effect:choose");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D313 §5 — the §8.1 promotion at the attack site, on the two NEW zones", () => {
  it("the hand destination empties the Active Spot and the seam promotes", () => {
    const state = board({ attacker: CROBAT, energy: DARK, count: 2, bench: 2 });
    const parked = must(applyAction(state, ASSASSIN));
    const after = must(applyAction(parked, YES));
    expect(after.phase.kind).toBe("ko:promote");
    expect(after.players.p1.active).toBeNull();
    expect(findEvent([], "TURN_ENDED")).toBeUndefined();
  });

  it("a Bench of ONE auto-resolves — no prompt, the turn just ends", () => {
    const state = board({ attacker: REVAVROOM, energy: METAL, count: 3, bench: 1 });
    const benched = state.players.p1.bench[0]?.stack[0];
    const result = applyAction(state, SHATTER);
    if (!result.ok) throw new Error("attack failed");
    expect(result.state.players.p1.active?.stack[0]).toBe(benched);
    expect(result.state.players.p1.bench).toHaveLength(0);
    expect(findEvent(result.events, "POKEMON_PROMOTED")?.uid).toBe(benched);
  });

  it("an EMPTY Bench is the §14.2 loss, and it falls out with no new code", () => {
    const state = board({ attacker: REVAVROOM, energy: METAL, count: 3, bench: 0 });
    const result = applyAction(state, SHATTER);
    if (!result.ok) throw new Error("attack failed");
    expect(result.state.phase.kind).toBe("gameOver");
    const outcome = findEvent(result.events, "GAME_OVER")?.outcome;
    expect(outcome?.result).toBe("win");
    expect(outcome?.result === "win" ? outcome.winner : null).toBe("p2");
  });

  it("the promotion is owed BEFORE the turn ends — the order D312 drove, on a new zone", () => {
    const state = board({ attacker: CROBAT, energy: DARK, count: 2, bench: 2 });
    const parked = must(applyAction(state, ASSASSIN));
    const result = applyAction(parked, YES);
    if (!result.ok) throw new Error("resolve failed");
    expect(findEvent(result.events, "TURN_ENDED")).toBeUndefined();
    expect(result.state.phase.kind).toBe("ko:promote");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D313 §6 — the v18 WIRE arm: a bare `returnSelf` still means the deck", () => {
  it('a parked continuation holding `{op:"returnSelf"}` with NO `dest` shuffles into the deck', () => {
    const state = board({ attacker: CROBAT, energy: DARK, count: 2, under: 2, tool: true });
    const parked = must(applyAction(state, ASSASSIN));
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    const cont = parked.phase.cont;
    if (cont.pendingOp.op !== "optional") throw new Error("expected an optional park");
    const v18: GameState = {
      ...parked,
      phase: {
        ...parked.phase,
        cont: {
          ...cont,
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          pendingOp: { ...cont.pendingOp, then: [{ op: "returnSelf" }] },
        },
      },
    };
    const body = v18.players.p1.active;
    const whole = [...(body?.stack ?? []), ...(body?.energy ?? []), ...(body?.tools ?? [])];
    const deckBefore = v18.players.p1.deck.length;

    const result = applyAction(v18, YES);
    if (!result.ok) throw new Error("resolve failed");
    // The WHOLE pile went to the deck — no split, no hand, no discard.
    expect(result.state.players.p1.deck).toHaveLength(deckBefore + 6);
    for (const uid of whole) expect(result.state.players.p1.deck, uid).toContain(uid);
    expect(result.state.players.p1.discard).toHaveLength(0);
    for (const uid of whole) expect(result.state.players.p1.hand, uid).not.toContain(uid);
    const returned = findEvent(result.events, "POKEMON_RETURNED");
    expect(returned?.dest).toBe("deck");
    expect(returned?.attachmentsTo).toBeUndefined();
    expect(findEvent(result.events, "SHUFFLE")).toBeDefined();
  });

  it("the ATTRIBUTION CONTROL: the same board with the D313 spelling splits instead", () => {
    const state = board({ attacker: CROBAT, energy: DARK, count: 2, under: 2, tool: true });
    const parked = must(applyAction(state, ASSASSIN));
    const result = applyAction(parked, YES);
    if (!result.ok) throw new Error("resolve failed");
    expect(result.state.players.p1.deck).toHaveLength(state.players.p1.deck.length);
    expect(result.state.players.p1.discard).toHaveLength(3);
    expect(findEvent(result.events, "POKEMON_RETURNED")?.dest).toBe("hand");
  });

  it("every registry `returnSelf` spells its `dest` — the optionality is the WIRE's, not the author's", () => {
    const bare = JSON.stringify(
      [
        CROBAT,
        COMFEY,
        REVAVROOM,
        REVAVROOM_REPRINT,
        "sv06-080",
        "sv08-131",
        "sv05-129",
        "sv07-011",
      ].map((id) => programFor(id)),
    );
    expect(bare).toContain('"returnSelf"');
    expect(bare).not.toContain('{"op":"returnSelf"}');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D313 §7 — the family, the field, and what is left", () => {
  const FAMILY: readonly (readonly [string, "deck" | "hand" | "discard" | "split", boolean])[] = [
    ["sv05-129", "deck", true],
    ["sv08.5-080", "deck", true],
    ["sv06-080", "deck", true],
    ["sv08-131", "deck", true],
    ["sv06-043", "deck", false], // Poliwrath — a conditional damage BOOST first
    ["sv07-011", "deck", true],
    [COMFEY, "hand", true],
    [REVAVROOM, "discard", true],
    [REVAVROOM_REPRINT, "discard", true],
    [CROBAT, "split", true],
    ["sv10-217", "split", true],
    ["sv10-234", "split", true],
    ["sv10-242", "split", true],
  ];

  it("thirteen printings, TWELVE built, and the one left is not a `dest` question", () => {
    expect(FAMILY).toHaveLength(13);
    expect(FAMILY.filter(([, , built]) => built)).toHaveLength(12);
    expect(FAMILY.filter(([, , built]) => !built).map(([id]) => id)).toEqual(["sv06-043"]);
  });

  it("ALL FOUR printed destinations are BUILT — the axis is closed, which is what makes the field honest", () => {
    const built = new Set(FAMILY.filter(([, , b]) => b).map(([, dest]) => dest));
    expect([...built].sort()).toEqual(["deck", "discard", "hand", "split"]);
    const owed = new Set(FAMILY.filter(([, , b]) => !b).map(([, dest]) => dest));
    expect([...owed]).toEqual(["deck"]);
  });

  it("every BUILT row is refused LIVE by the right spelling — the converse guard", () => {
    for (const [id, dest, built] of FAMILY) {
      const authored = JSON.stringify(programFor(id) ?? null);
      if (!built) {
        expect(authored, id).not.toContain('"returnSelf"');
        continue;
      }
      expect(authored, id).toContain('"returnSelf"');
      if (dest === "split") {
        expect(authored, id).toContain('"attachmentsTo":"discard"');
        expect(authored, id).toContain('"dest":"hand"');
      } else {
        expect(authored, id).toContain(`"dest":"${dest}"`);
        expect(authored, id).not.toContain("attachmentsTo");
      }
    }
  });

  it("no registry row spells a REDUNDANT `attachmentsTo`", () => {
    for (const [id] of FAMILY) {
      const authored = JSON.stringify(programFor(id) ?? null);
      expect(authored, id).not.toContain('"dest":"discard","attachmentsTo"');
    }
  });

  it("the SUBJECT-side census sweep is recorded as a NEGATIVE result", () => {
    expect(FAMILY).toHaveLength(13);
    expect(new Set(FAMILY.map(([id]) => id)).size).toBe(13);
  });
});
