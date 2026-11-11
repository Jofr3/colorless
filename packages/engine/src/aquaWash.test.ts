import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effectTypes";
import { applyAction } from "./index";
import type { GameState, Seat } from "./index";
import { logFromEvents } from "./log";
import type { LogContext } from "./log";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  deepFreeze,
  must,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
  driveSetup,
} from "./testFixtures";

const AN = "You may put an Energy attached to your opponent's Active Pokémon into their hand.";
const TWO = "You may put 2 Energy attached to your opponent's Active Pokémon into their hand.";
const TWO_STAGE2 =
  "You may put 2 Energy attached to your opponent's Active Stage 2 Pokémon into their hand.";

function put(count?: number): EffectOp {
  return {
    op: "discardEnergy",
    from: "opponentActive",
    filter: { kind: "anyEnergy" },
    to: "hand",
    ...(count === undefined ? {} : { count }),
  };
}

function wrapped(note: string, then: EffectOp[]): EffectOp[] {
  return [{ op: "optional", note, ops: then }];
}

const CLAUSES = [
  { text: AN, program: wrapped(AN, [put()]), legalPrintings: 1, ids: ["sv09-034"] },
  {
    text: TWO,
    program: wrapped(TWO, [put(2)]),
    legalPrintings: 2,
    ids: ["sv05-135", "sv08.5-019"],
  },
  {
    text: TWO_STAGE2,
    program: [
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsStage2" },
        ops: wrapped(TWO_STAGE2, [put(2)]),
      },
    ] as EffectOp[],
    legalPrintings: 1,
    ids: ["sv08-039"],
  },
] as const;

describe("§0 — the anchor: 3 sentences, 4 legal printings, one regex", () => {
  it("derives each printed sentence to its wrapped program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up: 4 legal printings across 3 sentences", () => {
    expect(CLAUSES).toHaveLength(3);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(4);
    expect(CLAUSES.flatMap((c) => c.ids)).toEqual([
      "sv09-034",
      "sv05-135",
      "sv08.5-019",
      "sv08-039",
    ]);
  });

  it("wraps the SAME inner op the hammer arm already derives, plus `to` and the count", () => {
    const bare = deriveAttackEffect("Discard an Energy from your opponent's Active Pokémon.");
    expect(bare).toEqual([
      { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } },
    ]);
    const gate = deriveAttackEffect(AN)?.[0];
    expect(gate?.op).toBe("optional");
    const inner = gate?.op === "optional" ? gate.ops : [];
    expect(inner).toHaveLength(1);
    const only = inner[0];
    expect(only?.op === "discardEnergy" ? only.from : undefined).toBe("opponentActive");
    expect(only?.op === "discardEnergy" ? only.to : undefined).toBe("hand");
    expect(only?.op === "discardEnergy" ? only.count : undefined).toBeUndefined();
  });

  it("carries the printed sentence VERBATIM as the note", () => {
    for (const { text } of CLAUSES) {
      const top = deriveAttackEffect(text)?.[0];
      // Tauros's program is gated, so the ask is one level down — descend
      // rather than special-case, so the loop asserts all three sentences.
      const ask = top?.op === "conditionGate" ? top.ops[0] : top;
      expect(ask?.op === "optional" ? ask.note : undefined, text).toBe(text);
    }
    // …and the whitespace tolerance the reader documents: the note is the
    // TRIMMED string, which is the sentence.
    const padded = deriveAttackEffect(`  ${AN}\n`)?.[0];
    expect(padded?.op === "optional" ? padded.note : undefined).toBe(AN);
    // …and the note is what BOTH surfaces render, so the sentence with the
    // adjective keeps the adjective — the gate does not eat a printed word.
    const tauros = deriveAttackEffect(TWO_STAGE2)?.[0];
    const inner = tauros?.op === "conditionGate" ? tauros.ops[0] : undefined;
    expect(inner?.op === "optional" ? inner.note : "").toContain("Stage 2");
  });

  it("the Stage 2 group is the ONLY difference between TWO and TWO_STAGE2", () => {
    // Stated as string surgery rather than by eye, because the two sentences
    // differ by eight characters and a build that dropped the group would still
    // derive both — to the same program.
    expect(TWO_STAGE2).toBe(TWO.replace("Active Pokémon", "Active Stage 2 Pokémon"));
    const gated = deriveAttackEffect(TWO_STAGE2)?.[0];
    const ungated = deriveAttackEffect(TWO) ?? [];
    expect(gated?.op).toBe("conditionGate");
    expect(ungated[0]?.op).toBe("optional");
    // The gate's BODY is the ungated sentence's WHOLE program, with only the
    // note differing (the note is the matched string, so it carries the
    // adjective the gate reads).
    const body = gated?.op === "conditionGate" ? gated.ops : [];
    expect(body).toEqual(wrapped(TWO_STAGE2, [put(2)]));
    const bodyAsk = body[0];
    const plainAsk = ungated[0];
    expect(bodyAsk?.op === "optional" ? bodyAsk.ops : undefined).toEqual(
      plainAsk?.op === "optional" ? plainAsk.ops : undefined,
    );
  });
});

describe("§1 — the near-misses: what an over-wide anchor would eat", () => {
  /** REAL printed sentences from the same sweep. Every entry is a witness. */
  const NEAR_MISSES = [
    "Put an Energy attached to your opponent's Active Pokémon into their hand.",
    "Put 2 Energy attached to your opponent's Active Pokémon into their hand.",
    // The SHUFFLE destination (Masquerain sv04-002 "Daunting Eyes") — the same
    // noun phrase, a different zone, and behind an until-tails loop.
    "Flip a coin until you get tails. For each heads, shuffle an Energy attached to your opponent's Active Pokémon into their deck.",
    "This attack does 20 more damage for each Energy attached to your opponent's Active Pokémon.",
    "This attack does 20 damage for each Energy attached to your opponent's Active Pokémon.",
    // The hammer's own bare sentence with the wrapper's prefix bolted on — a
    // "You may" over an op whose sentence this anchor does not read.
    "You may discard an Energy from your opponent's Active Pokémon.",
    "You may put an Energy attached to 1 of your opponent's Pokémon into their hand.",
    "You may put an Energy attached to your Active Pokémon into your hand.",
  ] as const;

  it("refuses every one", () => {
    for (const text of NEAR_MISSES) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("leaves the OWN-hand family exactly where it was — a positive, not a null", () => {
    expect(
      deriveAttackEffect("Put a Supporter card from your discard pile into your hand."),
    ).not.toBeNull();
  });

  it("refuses a printed ZERO — the guard every sibling numeric arm carries", () => {
    // Unwrapped this would file a no-op. WRAPPED it is worse: it parks a real
    // decision whose YES leaves the identical board, which is exactly the prompt
    // the no-choice rule exists to refuse.
    expect(deriveAttackEffect(TWO.replace(" 2 ", " 0 "))).toBeNull();
    expect(deriveAttackEffect(TWO_STAGE2.replace(" 2 Energy", " 0 Energy"))).toBeNull();
  });

  it("has no ceiling above zero — the op clamps against the board", () => {
    // Matching every other numeric arm of this reader: a short board gives up
    // everything it has ("do as much as you can"), so a large count is a legal
    // program rather than a malformed one.
    for (const n of [1, 3, 4, 9]) {
      const text = TWO.replace(" 2 ", ` ${n} `);
      expect(deriveAttackEffect(text), text).toEqual(wrapped(text, [put(n)]));
    }
  });

  it("is ANCHORED at both ends and CASE-COMMITTED", () => {
    for (const { text } of CLAUSES) {
      expect(deriveAttackEffect(`${text} Then, shuffle your deck.`), text).toBeNull();
      expect(
        deriveAttackEffect(`Your opponent's Active Pokémon is now Confused. ${text}`),
      ).toBeNull();
      expect(deriveAttackEffect(text.toLowerCase()), text).toBeNull();
      expect(deriveAttackEffect(text.toUpperCase()), text).toBeNull();
      expect(deriveAttackEffect(text.slice(0, -1)), text).toBeNull(); // no trailing period
    }
  });

  it("folds the apostrophe — a U+2019 re-ingest must not un-derive the row", () => {
    for (const { text, program } of CLAUSES) {
      const curly = text.replace("opponent's", "opponent’s");
      expect(curly, text).not.toBe(text);
      // The note is the MATCHED string, so the curly sentence's note is curly —
      // and that is the ONLY byte that may differ between the two programs.
      const straight = JSON.stringify(program);
      expect(JSON.stringify(deriveAttackEffect(curly)), curly).toBe(straight.replace(text, curly));
    }
  });
});

const OCTILLERY: Card = battler("fix-aquawash", {
  hp: 110,
  attacks: [
    { name: "Aqua Wash", cost: ["Colorless"], damage: 20, effect: AN },
    { name: "Octo Beatdown", cost: ["Colorless", "Colorless", "Colorless"], damage: 90 },
  ],
});

const SLOWKING: Card = battler("fix-washslate", {
  hp: 120,
  attacks: [{ name: "Wash the Slate Clean", cost: ["Colorless"], damage: 70, effect: TWO }],
});

/** Paldean Tauros `sv08-039` "Upthrusting Horns" — the Stage 2 gate. */
const TAUROS: Card = battler("fix-upthrust", {
  hp: 130,
  attacks: [{ name: "Upthrusting Horns", cost: ["Colorless"], damage: 30, effect: TWO_STAGE2 }],
});

const HAMMER_TWIN: Card = battler("fix-barewash", {
  hp: 110,
  attacks: [
    {
      name: "Bare Wash",
      cost: ["Colorless"],
      damage: 20,
      effect: "Discard an Energy from your opponent's Active Pokémon.",
    },
  ],
});

const STAGE2_BODY: Card = battler("fix-stage2body", {
  hp: 200,
  stage: "Stage2",
  evolveFrom: "fix-stage1body",
});
const STAGE1_BODY: Card = battler("fix-stage1body", {
  hp: 200,
  stage: "Stage1",
  evolveFrom: "fix-basic-1",
});

const LOCAL_CARDS: Record<string, Card> = {
  "fix-aquawash": OCTILLERY,
  "fix-washslate": SLOWKING,
  "fix-upthrust": TAUROS,
  "fix-barewash": HAMMER_TWIN,
  "fix-stage2body": STAGE2_BODY,
  "fix-stage1body": STAGE1_BODY,
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "fix-aquawash": 4,
  "fix-washslate": 4,
  "fix-upthrust": 4,
  "fix-barewash": 4,
  "fix-stage2body": 4,
  "fix-stage1body": 4,
  "fix-bigbody": 8,
  "fix-basic-1": 4,
  "fix-special": 4,
  "fix-special-2": 4,
  "fix-energy": 16,
});

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

function matchup(
  seed: number,
  attackerId: string,
  defenderId: string,
  energy: readonly (readonly [string, number])[],
): GameState {
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  state = clearBench(setActiveFromDeck(state, "p1", attackerId), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", defenderId), "p2");
  state = attachFromDeck(state, "p1", "fix-energy", 3);
  for (const [id, count] of energy) state = attachFromDeck(state, "p2", id, count);
  let next = state;
  for (const seat of ["p1", "p2"] as const) {
    const side = next.players[seat];
    next = {
      ...next,
      players: {
        ...next.players,
        [seat]: { ...side, hand: [], deck: [...side.deck, ...side.hand] },
      },
    };
  }
  return next;
}

function fateOf(state: GameState, watch: readonly string[]) {
  const side = state.players.p2;
  const attached = new Set(side.active?.energy ?? []);
  const hand = new Set(side.hand);
  const discard = new Set(side.discard);
  return {
    attached: watch.filter((uid) => attached.has(uid)).length,
    inHand: watch.filter((uid) => hand.has(uid)).length,
    inDiscard: watch.filter((uid) => discard.has(uid)).length,
  };
}

/** The uids the defender has attached right now — the `watch` list above. */
function attachedUids(state: GameState): string[] {
  return [...(state.players.p2.active?.energy ?? [])];
}

/** Declare the attack at `index` and return the result. */
function attack(state: GameState, index = 0) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

function answerConfirm(state: GameState, yes: boolean) {
  return mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } });
}

describe("§2 — the ask: a printed card parks a confirm carrying its own sentence", () => {
  it("Aqua Wash deals its damage FIRST, then asks", () => {
    const state = matchup(11, "fix-aquawash", "fix-bigbody", [["fix-energy", 1]]);
    const watch = attachedUids(state);
    const { state: parked, events } = attack(state);

    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(20);
    expect(types(events)).toContain("EFFECT_PENDING");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    // The whole prompt: a kind and the printed sentence. No candidates — the
    // decision IS the content.
    expect(parked.phase.prompt).toEqual({ kind: "confirm", note: AN });
    // The CONTROLLER answers, not the victim. A build that copied
    // `opponentMayDraw`'s `decider` would put the printed "you" on the wrong
    // screen — and here the wrong screen belongs to the player being robbed.
    expect(parked.phase.seat).toBe("p1");
    expect(parked.phase.answerer).toBeUndefined();
    // NOTHING has moved yet, on either side of the wrapper.
    expect(fateOf(parked, watch)).toEqual({ attached: 1, inHand: 0, inDiscard: 0 });
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(types(events)).not.toContain("TURN_ENDED");
  });

  it("THE CONTROL: the hammer twin asks NOTHING and files the card in the PILE", () => {
    const state = matchup(11, "fix-barewash", "fix-bigbody", [["fix-energy", 1]]);
    const watch = attachedUids(state);
    const { state: done, events } = attack(state);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    const row = findEvent(events, "ENERGY_DISCARDED");
    expect(row?.seat).toBe("p2");
    expect(row?.to).toBeUndefined(); // THE PILE — the op's own name
    expect(fateOf(done, watch)).toEqual({ attached: 0, inHand: 0, inDiscard: 1 });
  });
});

describe("§3 — the answer: YES moves the card to the victim's HAND, NO moves nothing", () => {
  it("YES puts the Energy in the OPPONENT'S HAND and NOT in anybody's pile", () => {
    const state = matchup(11, "fix-aquawash", "fix-bigbody", [["fix-energy", 1]]);
    const watch = attachedUids(state);
    const { state: parked } = attack(state);
    const { state: done, events } = answerConfirm(parked, true);

    expect(fateOf(done, watch)).toEqual({ attached: 0, inHand: 1, inDiscard: 0 });
    expect(done.players.p1.hand).toHaveLength(0);
    expect(done.players.p1.discard).toHaveLength(0);
    const row = findEvent(events, "ENERGY_DISCARDED");
    expect(row?.seat).toBe("p2");
    expect(row?.actor).toBe("p1");
    expect(row?.to).toBe("hand");
    expect(row?.uids).toHaveLength(1);
    // The attack epilogue ran: the turn ended behind the answer.
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("NO moves NOTHING — and still finishes the turn", () => {
    const state = matchup(11, "fix-aquawash", "fix-bigbody", [["fix-energy", 1]]);
    const watch = attachedUids(state);
    const { state: parked } = attack(state);
    const { state: done, events } = answerConfirm(parked, false);

    expect(fateOf(done, watch)).toEqual({ attached: 1, inHand: 0, inDiscard: 0 });
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(types(events)).toContain("TURN_ENDED");
    expect(done.turn).toBe(4);
    expect(done.phase.kind).toBe("turn:action");
    // The damage the attack already dealt stays dealt — declining the rider is
    // not declining the attack.
    expect(done.players.p2.active?.damage).toBe(20);
  });

  it("the log row names the VICTIM in the passive voice and says HAND", () => {
    const state = matchup(11, "fix-aquawash", "fix-bigbody", [["fix-energy", 1]]);
    const { state: parked } = attack(state);
    const { state: done, events } = answerConfirm(parked, true);
    const ctx: LogContext = { names: { p1: "Ash", p2: "Gary" }, state: done, elapsed: "+00:00" };
    const text = logFromEvents(events, ctx)
      .map((r) => (r.kind === "action" ? r.segments.map((seg) => seg.text).join("") : ""))
      .join("\n");
    expect(text).toContain("hand");
    expect(text).not.toContain("discard pile");
    expect(text).not.toContain("Gary put");
  });
});

describe("§4 — the COUNT: 'you may put 2' is a decline or a pair, never a single", () => {
  it("takes exactly 2 off a board holding more", () => {
    // Three DISTINCT Energy prints, so nothing collapses and the pick is a real
    // decision behind the confirm — two parks in sequence, which is the
    // sequencing the one-Energy rows cannot exercise.
    const state = matchup(29, "fix-washslate", "fix-bigbody", [
      ["fix-energy", 1],
      ["fix-special", 1],
      ["fix-special-2", 1],
    ]);
    const watch = attachedUids(state);
    const { state: parked } = attack(state);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the confirm");
    expect(parked.phase.prompt).toEqual({ kind: "confirm", note: TWO });

    const { state: picking } = answerConfirm(parked, true);
    if (picking.phase.kind !== "effect:choose") throw new Error("expected the discard park");
    const prompt = picking.phase.prompt;
    if (prompt.kind !== "discardEnergy") throw new Error("expected a discardEnergy prompt");
    expect(prompt.scope).toEqual({ kind: "total", count: 2 });
    expect(prompt.discardable).toHaveLength(3);
    expect(prompt.note).toBe(
      "Put 2 Energy attached to your opponent's Active Pokémon into their hand.",
    );

    const uids = prompt.discardable.slice(0, 2).map((d) => d.uid);
    const { state: done, events } = mustApply(picking, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids },
    });
    expect(fateOf(done, watch)).toEqual({ attached: 1, inHand: 2, inDiscard: 0 });
    expect(findEvent(events, "ENERGY_DISCARDED")?.to).toBe("hand");
  });

  it("REFUSES a pick of one where an `upTo` scope would allow it", () => {
    // The sharpest single assertion in the file. `{count:"any", cap:2}` derives
    // a park this board would accept a ONE-uid answer to; `total: 2` does not.
    const state = matchup(29, "fix-washslate", "fix-bigbody", [
      ["fix-energy", 1],
      ["fix-special", 1],
      ["fix-special-2", 1],
    ]);
    const { state: picking } = answerConfirm(attack(state).state, true);
    if (picking.phase.kind !== "effect:choose") throw new Error("expected the discard park");
    const prompt = picking.phase.prompt;
    if (prompt.kind !== "discardEnergy") throw new Error("expected a discardEnergy prompt");
    const one = applyAction(picking, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [prompt.discardable[0]?.uid ?? ""] },
    });
    expect(one.ok).toBe(false);
    // …and the EMPTY answer is refused too: the decline lives on the wrapper,
    // and offering it twice is exactly what `optional`'s doc block forbids.
    const none = applyAction(picking, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [] },
    });
    expect(none.ok).toBe(false);
  });

  it("does as much as it CAN on a short board — one attached, one taken, no park", () => {
    // "A board holding fewer than N matching Energy gives up all of them" is the
    // op's own rule; behind the wrapper it means the player is asked WHETHER and
    // then nothing further, because there is no choice left.
    const state = matchup(29, "fix-washslate", "fix-bigbody", [["fix-energy", 1]]);
    const watch = attachedUids(state);
    const { state: parked } = attack(state);
    const { state: done } = answerConfirm(parked, true);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(fateOf(done, watch)).toEqual({ attached: 0, inHand: 1, inDiscard: 0 });
  });

  it("KEEPS the interchangeable collapse — three identical Basic Energy ask NOTHING", () => {
    const state = matchup(47, "fix-washslate", "fix-bigbody", [["fix-energy", 3]]);
    const watch = attachedUids(state);
    const { state: parked } = attack(state);
    const { state: done } = answerConfirm(parked, true);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(fateOf(done, watch)).toEqual({ attached: 1, inHand: 2, inDiscard: 0 });
  });

  it("asks nothing at all when the defender holds NO Energy — but still asks WHETHER", () => {
    const state = matchup(11, "fix-aquawash", "fix-bigbody", []);
    const { state: parked } = attack(state);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the confirm");
    const { state: done, events } = answerConfirm(parked, true);
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(fateOf(done, [])).toEqual({ attached: 0, inHand: 0, inDiscard: 0 });
    expect(types(events)).toContain("TURN_ENDED");
  });
});

describe("§5 — the Stage 2 gate: the adjective is read BEFORE anybody is asked", () => {
  it("asks, and takes, against a Stage 2 defender", () => {
    const state = matchup(11, "fix-upthrust", "fix-stage2body", [["fix-energy", 2]]);
    const watch = attachedUids(state);
    const { state: parked } = attack(state);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the confirm");
    expect(parked.phase.prompt).toEqual({ kind: "confirm", note: TWO_STAGE2 });
    const { state: done } = answerConfirm(parked, true);
    expect(fateOf(done, watch)).toEqual({ attached: 0, inHand: 2, inDiscard: 0 });
  });

  it("asks NOTHING AT ALL against a Stage 1 defender — no confirm, no park", () => {
    const state = matchup(11, "fix-upthrust", "fix-stage1body", [["fix-energy", 2]]);
    const watch = attachedUids(state);
    const { state: done, events } = attack(state);
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(fateOf(done, watch)).toEqual({ attached: 2, inHand: 0, inDiscard: 0 });
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("and nothing against a BASIC defender either", () => {
    const state = matchup(11, "fix-upthrust", "fix-bigbody", [["fix-energy", 2]]);
    const watch = attachedUids(state);
    const { state: done, events } = attack(state);
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(fateOf(done, watch)).toEqual({ attached: 2, inHand: 0, inDiscard: 0 });
  });

  it("reads the PRINTED stage word, so the Stage 1 and Stage 2 bodies differ ONLY there", () => {
    expect(STAGE2_BODY.stage).toBe("Stage2");
    expect(STAGE1_BODY.stage).toBe("Stage1");
    expect(STAGE2_BODY.hp).toBe(STAGE1_BODY.hp);
    expect(STAGE2_BODY.category).toBe(STAGE1_BODY.category);
    // Both are EVOLUTION Pokémon (`evolveFrom` non-null), which is the exact
    // reason `opponentActiveIsEvolution` could not be narrowed into this member.
    expect(STAGE2_BODY.evolveFrom).not.toBeNull();
    expect(STAGE1_BODY.evolveFrom).not.toBeNull();
  });
});

describe("§6 — the wire and the record", () => {
  it("the confirm prompt reaches the CONTROLLER alone, with the printed sentence", () => {
    const state = matchup(11, "fix-aquawash", "fix-bigbody", [["fix-energy", 1]]);
    const { state: parked } = attack(state);
    expect(redactGame(parked, "p1").phase).toMatchObject({
      kind: "effect:choose",
      prompt: { kind: "confirm", note: AN },
    });
    // Controller-answered, so the VICTIM's snapshot carries null — and here the
    // gate matters more than usual: the question is about the victim's own
    // Energy, and a dialog on their screen is one they cannot answer.
    const theirs = redactGame(parked, "p2").phase;
    if (theirs.kind !== "effect:choose") throw new Error("expected the park");
    expect(theirs.prompt).toBeNull();
  });

  it("MATCH_RECORD_VERSION STAYS 16 — driven both directions with a literal key anchor", () => {
    const state = matchup(11, "fix-aquawash", "fix-bigbody", [["fix-energy", 1]]);
    const { state: parked } = attack(state);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the confirm");
    const roundTrip = JSON.parse(JSON.stringify(parked)) as GameState;
    if (roundTrip.phase.kind !== "effect:choose") throw new Error("lost the phase");

    // FORWARD: the serialized park is byte-identical to the live one.
    expect(JSON.stringify(roundTrip.phase)).toBe(JSON.stringify(parked.phase));
    // THE ANCHOR: the exact keys the persisted op carries, listed literally, so
    // "every body grew a key" cannot hide inside a same-tree diff.
    const cont = roundTrip.phase.cont;
    const pending = (cont as { pendingOp?: unknown }).pendingOp as Record<string, unknown>;
    expect(Object.keys(pending).sort()).toEqual(["note", "op", "ops"]);
    expect(pending.op).toBe("optional");
    const inner = (pending.ops as Record<string, unknown>[])[0] ?? {};
    expect(Object.keys(inner).sort()).toEqual(["filter", "from", "op", "to"]);

    // BACKWARD: the rehydrated record answers, and reaches the same board the
    // live one does.
    const fromRecord = answerConfirm(deepFreeze(roundTrip), true).state;
    const live = answerConfirm(parked, true).state;
    const watch = attachedUids(parked);
    expect(fateOf(fromRecord, watch)).toEqual({ attached: 0, inHand: 1, inDiscard: 0 });
    expect(fateOf(fromRecord, watch)).toEqual(fateOf(live, watch));
  });

  it("the new BoardCondition member NEVER REACHES THE RECORD — the gate resolves first", () => {
    const state = matchup(11, "fix-upthrust", "fix-stage2body", [["fix-energy", 2]]);
    const { state: parked } = attack(state);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the confirm");
    const serialized = JSON.stringify(parked.phase);
    expect(serialized).not.toContain("opponentActiveIsStage2");
    expect(serialized).not.toContain("conditionGate");
    const roundTrip = JSON.parse(serialized) as GameState["phase"];
    if (roundTrip.kind !== "effect:choose") throw new Error("lost the phase");
    const pending = (roundTrip.cont as { pendingOp?: unknown }).pendingOp as Record<
      string,
      unknown
    >;
    expect(Object.keys(pending).sort()).toEqual(["note", "op", "ops"]);
    const inner = (pending.ops as Record<string, unknown>[])[0] ?? {};
    expect(Object.keys(inner).sort()).toEqual(["count", "filter", "from", "op", "to"]);
    expect(inner.count).toBe(2);
  });
});
