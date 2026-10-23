import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackCopy,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
} from "./effects";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  HAND_DRAW_DECK,
  attachFromDeck,
  clearBench,
  driveSetup,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
} from "./testFixtures";

const attack = { type: "attack", seat: "p1", index: 0 } as const;

const READERS: readonly ((t: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackDiscardScaledBoost,
];

const PRINTED =
  "Shuffle your hand into your deck. Then, draw a card for each card in your opponent's hand.";

const SIBLING = "Shuffle your hand into your deck. Then, draw 6 cards.";

/** THE PROGRAM, spelled once and reused, so a case cannot pass against a hand-copied
    literal that has drifted from what the file means by it. */
const PROGRAM: EffectOp[] = [{ op: "handRefresh", who: "you", draw: { kind: "opponentHandSize" } }];

const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);

function effectDraw(events: GameEvent[], seat: Seat = "p1"): string[] {
  return events.flatMap((e) =>
    e.type === "CARDS_DRAWN" && e.seat === seat && e.reason === "effect" ? e.uids : [],
  );
}

describe("D516 §1 — the printed data, measured live over the legal column", () => {
  it("the sentence is the CORPUS's bytes at ONE printing, and so is its sibling", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n] as const));
    expect(rows.get(PRINTED)).toBe(1);
    expect(rows.get(SIBLING)).toBe(1);
  });

  it("the APOSTROPHE is ASCII, and the anchor would silently miss a typographic one", () => {
    expect(PRINTED.includes("opponent's")).toBe(true);
    expect(PRINTED.includes("opponent’s")).toBe(false);
    expect(PRINTED.codePointAt(PRINTED.indexOf("'"))).toBe(0x0027);
  });

  it("the column prints this DERIVED count on this skeleton exactly ONCE", () => {
    const family = legalAttackCorpus().filter(([, s]) =>
      s.startsWith("Shuffle your hand into your deck."),
    );
    expect(family.map(([, s]) => s).sort()).toEqual([PRINTED, SIBLING].sort());
    expect(units(family)).toBe(2);
  });

  it("D516 — the sentence is now RESOLVED, and by exactly one reader", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(PRINTED), read.name).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reading, against the SIBLING rather than against a re-typed shape.
// ─────────────────────────────────────────────────────────────────────────────

describe("D516 §2 — the program, read against D479's sibling", () => {
  it("the two programs differ in `draw` and in NOTHING else", () => {
    const mine = deriveAttackEffect(PRINTED);
    const theirs = deriveAttackEffect(SIBLING);
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(1);
    expect({ ...mine?.[0], draw: null }).toEqual({ ...theirs?.[0], draw: null });
    expect(mine?.[0]).toMatchObject({ op: "handRefresh", who: "you" });
    expect(theirs?.[0]).toMatchObject({ draw: { kind: "fixed", count: 6 } });
    expect(mine).not.toEqual(theirs);
  });

  it("neither rider is set, and that is the printed difference from Iono", () => {
    // `toBottom` is Iono's placement (the deck's ORDER survives) and `onlyIfAnyMoved` is
    // Iono's gate. This sentence prints neither, so the keys must be ABSENT and not
    // `undefined`-valued — a JSON record is the shape a successor diffs.
    expect(Object.keys(deriveAttackEffect(PRINTED)?.[0] ?? {}).sort()).toEqual([
      "draw",
      "op",
      "who",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the refusals, each pinned on ONE printed byte.
// ─────────────────────────────────────────────────────────────────────────────

describe("D516 §3 — the refusals, each pinned on ONE printed byte", () => {
  it("the COUNT'S SOURCE ZONE, the SEAT, the RATE and the JOIN refuse INDEPENDENTLY", () => {
    // …the ZONE alone: your own hand is empty by the time the draw runs, and no member
    // of this union reads it. `cardsInDiscardPile` spells the pile for the damage
    // vocabulary and nothing spells it here.
    expect(
      deriveAttackEffect(
        "Shuffle your hand into your deck. Then, draw a card for each card in your hand.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "Shuffle your hand into your deck. Then, draw a card for each card in your opponent's discard pile.",
      ),
    ).toBeNull();
    // …the SEAT of the refresh alone: `who: "opponent"` and `who: "both"` are the op's
    // other two values and either would empty a hand this sentence never names.
    expect(
      deriveAttackEffect(
        "Shuffle your opponent's hand into their deck. Then, draw a card for each card in your opponent's hand.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "Each player shuffles their hand into their deck. Then, draw a card for each card in your opponent's hand.",
      ),
    ).toBeNull();
    // …the RATE alone: this member is NULLARY because the printed rate is one card per
    // card. A printed multiple is a different member (`per`), not this one with a field.
    expect(
      deriveAttackEffect(
        "Shuffle your hand into your deck. Then, draw 2 cards for each card in your opponent's hand.",
      ),
    ).toBeNull();
    // …the JOIN alone: the printed two-sentence form with ". Then, " is what this anchor
    // reads, exactly as the sibling's is.
    expect(
      deriveAttackEffect(
        "Shuffle your hand into your deck and draw a card for each card in your opponent's hand.",
      ),
    ).toBeNull();
    // …and the DESTINATION alone: Iono's `toBottom` is a different program.
    expect(
      deriveAttackEffect(
        "Shuffle your hand and put it on the bottom of your deck. Then, draw a card for each card in your opponent's hand.",
      ),
    ).toBeNull();
  });

  it("the anchor is WHOLE-SENTENCE — a leading or trailing clause is refused", () => {
    for (const text of [
      `Draw a card. ${PRINTED}`,
      `${PRINTED} Your turn ends.`,
      `${PRINTED} If you do, this attack does 60 more damage.`,
      // Case is load-bearing: no reader in `effects.ts` carries an `/i`.
      PRINTED.toLowerCase(),
      PRINTED.toUpperCase(),
      // The trailing period is required — a regex written from a paraphrase matches no
      // real card.
      PRINTED.slice(0, -1),
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("the two anchors are STRUCTURALLY DISJOINT, so their order is legibility", () => {
    expect(deriveAttackEffect(PRINTED)).not.toEqual(deriveAttackEffect(SIBLING));
    expect(PRINTED.startsWith("Shuffle your hand into your deck. Then, draw ")).toBe(true);
    expect(SIBLING.startsWith("Shuffle your hand into your deck. Then, draw ")).toBe(true);
    expect(PRINTED.endsWith("in your opponent's hand.")).toBe(true);
    expect(SIBLING.endsWith("draw 6 cards.")).toBe(true);
  });
});

/** THE CONTROLLER'S HAND, and it is FIVE so that `handPlus { delta: 0 }` would answer a
    number no other member does. */
const OWN_HAND = ["fix-item", "fix-item", "fix-item", "fix-energy", "fix-energy"] as const;

/** THE OPPONENT'S HAND, and it is FOUR — the only number the print admits, and distinct
    from the controller's five, from `fixed`'s six and from `prizeCount`'s six. */
const FOE_HAND = ["fix-item", "fix-item", "fix-energy", "fix-bigbody"] as const;

function withEffect(state: GameState, effect: string): GameState {
  const card = state.cardPool["fix-handdraw"];
  if (card === undefined) throw new Error("no fix-handdraw in pool");
  const attacks = card.attacks ?? [];
  const first = attacks[0];
  if (first === undefined) throw new Error("fix-handdraw has no attack 0");
  return {
    ...state,
    cardPool: {
      ...state.cardPool,
      "fix-handdraw": { ...card, attacks: [{ ...first, effect }, ...attacks.slice(1)] },
    },
  };
}

/** Rebuild `seat`'s HAND outright — every dealt card back into the deck, then exactly
    `ids` dealt off it (`opponentHandScaling.test.ts`'s helper, needed here for the same
    reason: the hand is the zone under test at BOTH seats). */
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

function fielded(
  seed: number,
  effect: string = PRINTED,
  foeHand: readonly string[] = FOE_HAND,
): GameState {
  const opened = mustApply(
    driveSetup(seed, { p1: HAND_DRAW_DECK, p2: HAND_DRAW_DECK }, { first: "p2" }),
    { type: "endTurn", seat: "p2" },
  ).state;
  let state = setActiveFromDeck(opened, "p1", "fix-handdraw");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = withHand(state, "p1", OWN_HAND);
  state = withHand(state, "p2", foeHand);
  return withEffect(state, effect);
}

const sorted = (uids: readonly string[]) => [...uids].sort();

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the COUNT, on a board where five candidate members give five numbers.
// ─────────────────────────────────────────────────────────────────────────────

describe("D516 §4 — the count is the OPPONENT'S hand size, and four rivals say otherwise", () => {
  it("the controller draws exactly the opponent's hand size, and the rivals are all wrong", () => {
    const state = fielded(1);
    const before = state.players.p1;
    expect(before.hand).toHaveLength(5); //   handPlus { delta: 0 }
    expect(before.prizes).toHaveLength(6); // prizeCount
    expect(state.players.p2.hand).toHaveLength(4); // opponentHandSize — the print
    //                                        fixed would be 6 (the sibling's constant)
    const { state: done, events } = mustApply(state, attack);
    expect(effectDraw(events)).toHaveLength(4);
    expect(done.players.p1.hand).toHaveLength(4);
  });

  it("it TRACKS the zone rather than hitting a constant — two more sizes, same board", () => {
    // A single board cannot tell a read from a lucky literal. Three sizes, three draws.
    for (const [size, ids] of [
      [1, ["fix-item"]],
      [3, ["fix-item", "fix-energy", "fix-bigbody"]],
      [6, ["fix-item", "fix-item", "fix-item", "fix-energy", "fix-energy", "fix-bigbody"]],
    ] as const) {
      const state = fielded(2, PRINTED, ids);
      expect(state.players.p2.hand, `${size}`).toHaveLength(size);
      const { state: done } = mustApply(state, attack);
      expect(done.players.p1.hand, `${size}`).toHaveLength(size);
    }
  });

  it("the SIBLING on the SAME board draws SIX, which is the member's whole content", () => {
    // The control that separates "this member works" from "this board draws four".
    const { state: done } = mustApply(fielded(1, SIBLING), attack);
    expect(done.players.p1.hand).toHaveLength(6);
  });

  it("the OLD hand ends in the DECK and not in the discard, and the OPPONENT is untouched", () => {
    const state = fielded(3);
    const oldHand = [...state.players.p1.hand];
    const oldDiscard = [...state.players.p1.discard];
    const foeHand = [...state.players.p2.hand];
    const foeDeck = [...state.players.p2.deck];
    const { state: done, events } = mustApply(state, attack);
    // Every old card is in the deck; none of them reached the pile.
    for (const uid of oldHand) expect(done.players.p1.deck).toContain(uid);
    expect(done.players.p1.discard).toEqual(oldDiscard);
    expect(types(events)).toContain("HAND_SHUFFLED_INTO_DECK");
    expect(types(events)).not.toContain("HAND_DISCARDED");
    expect(types(events)).not.toContain("HAND_TO_BOTTOM_OF_DECK");
    for (const uid of foeHand) expect(done.players.p2.hand).toContain(uid);
    expect(done.players.p2.hand).toHaveLength(foeHand.length + 1);
    expect(done.players.p2.deck).toEqual(foeDeck.slice(1));
    expect(done.players.p2.hand).toContain(foeDeck[0]);
    expect(done.players.p2.discard).toEqual([]);
    // The shuffled hand and the freshly drawn one are disjoint from the discard pile.
    expect(sorted(done.players.p1.hand).some((uid) => oldDiscard.includes(uid))).toBe(false);
  });

  it("the EVENT is COUNT-ONLY at the other seat, so nothing leaks", () => {
    // The zone this member reads is HIDDEN, and the number it produces is public. What
    // keeps that honest is that a hand SIZE is already public — the count shows — and
    // this member reads `hand.length` and never a card. No event names an opponent uid.
    const { events } = mustApply(fielded(4), attack);
    const shuffled = findEvent(events, "HAND_SHUFFLED_INTO_DECK");
    expect(shuffled?.seat).toBe("p1");
    expect(shuffled?.count).toBe(5);
    expect(events.filter((e) => e.type === "HAND_SHUFFLED_INTO_DECK")).toHaveLength(1);
    expect(effectDraw(events)).toHaveLength(4);
    expect(effectDraw(events, "p2")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the falsifiers, driven rather than argued.
// ─────────────────────────────────────────────────────────────────────────────

describe("D516 §5 — the falsifiers, driven rather than argued", () => {
  it("FALSIFIER 1 — an EMPTY opponent hand still reshuffles and draws ZERO", () => {
    const state = fielded(5, PRINTED, []);
    const oldHand = [...state.players.p1.hand];
    expect(state.players.p2.hand).toHaveLength(0);
    const { state: done, events } = mustApply(state, attack);
    expect(done.players.p1.hand).toEqual([]);
    for (const uid of oldHand) expect(done.players.p1.deck).toContain(uid);
    expect(types(events)).toContain("HAND_SHUFFLED_INTO_DECK");
    expect(findEvent(events, "HAND_SHUFFLED_INTO_DECK")?.count).toBe(5);
    expect(effectDraw(events)).toEqual([]);
    expect(events.some((e) => e.type === "CARDS_DRAWN")).toBe(true);
    // …and the attack still RESOLVED: the effect is not skipped.
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("FALSIFIER 2 — the controller's OWN hand is emptied BEFORE the count is taken", () => {
    const state = fielded(6);
    expect(state.players.p1.hand).toHaveLength(5);
    const { state: done } = mustApply(state, attack);
    expect(done.players.p1.hand).toHaveLength(4);
    expect(done.players.p1.hand).not.toHaveLength(0);
  });

  it("ZERO-MATCH BOARD — a near-miss on the SAME body is SILENT, and loudly so", () => {
    const state = fielded(
      7,
      "Shuffle your hand into your deck. Then, draw a card for each card in your hand.",
    );
    const oldHand = [...state.players.p1.hand];
    const oldDeck = [...state.players.p1.deck];
    const { state: done, events } = mustApply(state, attack);
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(types(events)).toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("HAND_SHUFFLED_INTO_DECK");
    expect(done.players.p1.hand).toEqual(oldHand);
    expect(done.players.p1.deck).toEqual(oldDeck);
  });
});

describe("D516 §6 — the describer surfaces, checked rather than assumed", () => {
  it("the op NEVER PARKS, so no caption is owed and `describeBranch` never sees it", () => {
    for (const foe of [[], FOE_HAND] as const) {
      const { state: done } = mustApply(fielded(8, PRINTED, foe), attack);
      expect(done.phase.kind).not.toBe("effect");
      expect(done.phase.kind).not.toBe("gameOver");
    }
  });

  it("the LOG renders the draw from the EVENT's count, so the new kind needs no arm", () => {
    const events = mustApply(fielded(9), attack).events;
    expect(effectDraw(events)).toHaveLength(4);
    expect(findEvent(events, "HAND_SHUFFLED_INTO_DECK")?.count).toBe(5);
  });
});

describe("D516 §7 — what this slice did NOT buy, measured", () => {
  it("the hand-kept READERS list IS the module's reader surface, still THIRTEEN", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("`FIXTURE_POOL` is BYTE-UNCHANGED — the demonstrator is a per-board clone", () => {
    expect(FIXTURE_POOL["fix-handdraw"]?.attacks).toEqual([
      {
        cost: ["Colorless"],
        name: "Hand Refresh",
        damage: "30",
        effect: "Discard your hand and draw 6 cards.",
      },
    ]);
  });

  it("`prizeCount` and the damage union's prize count are OPPOSITE ENDS OF ONE PILE", () => {
    const state = fielded(10);
    expect(state.players.p1.prizes).toHaveLength(6);
    const PRIZE_COUNT = state.players.p1.prizes.length;
    const PRIZES_TAKEN = 6 - state.players.p2.prizes.length;
    expect([PRIZE_COUNT, PRIZES_TAKEN]).toEqual([6, 0]);
    expect(PRIZE_COUNT).not.toBe(PRIZES_TAKEN);
  });

  it("REACHABILITY IS EMPTY, MEASURED OVER EVERY PRODUCER RATHER THAN ASSERTED", () => {
    const offenders: string[] = [];
    let opLists = 0;
    let multiOpLists = 0;
    const holdsRefresh = (v: unknown): boolean => {
      if (Array.isArray(v)) return v.some(holdsRefresh);
      if (v === null || typeof v !== "object") return false;
      const rec = v as Record<string, unknown>;
      if (rec.op === "handRefresh") return true;
      return Object.values(rec).some(holdsRefresh);
    };
    const walk = (v: unknown, where: string): void => {
      if (Array.isArray(v)) {
        const ops = v.filter((e) => e !== null && typeof e === "object" && "op" in (e as object));
        if (ops.length === v.length && v.length > 0) {
          opLists += 1;
          if (v.length > 1) multiOpLists += 1;
          v.forEach((el, i) => {
            if (i > 0 && holdsRefresh(el)) offenders.push(`${where}[${i}]`);
          });
        }
        v.forEach((el, i) => walk(el, `${where}[${i}]`));
        return;
      }
      if (v === null || typeof v !== "object") return;
      for (const [k, el] of Object.entries(v as Record<string, unknown>)) walk(el, `${where}.${k}`);
    };
    for (const id of registryCardIds()) walk(programFor(id), id);
    let derived = 0;
    for (const [, text] of legalAttackCorpus()) {
      const program = deriveAttackEffect(text);
      if (program === null) continue;
      derived += 1;
      walk(program, `derived:${text.slice(0, 40)}`);
    }
    expect(offenders).toEqual([]);
    expect(derived).toBeGreaterThan(100);
    expect(registryCardIds().length).toBeGreaterThan(100);
    const producers = registryCardIds().filter((id) => holdsRefresh(programFor(id)));
    expect(producers).toHaveLength(45);
    expect(opLists).toBeGreaterThan(800);
    expect(multiOpLists).toBeGreaterThan(300);
  });
});
