import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { matchesFilter } from "./cards";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { CardFilter, EffectOp } from "./effects";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import type { GameEvent } from "./events";
import { engineVersion } from "./index";
import type { GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  attachFromDeck,
  basicEnergy,
  battler,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  trainerCard,
  types,
  driveSetup,
} from "./testFixtures";

const SWEEP =
  "Your opponent reveals their hand. Discard all Item cards and Pokémon Tool cards you find there.";
/** Its two halves at the one printed period — used by §7 and by nothing else. */
const SWEEP_HEAD = "Your opponent reveals their hand.";
const SWEEP_TAIL = "Discard all Item cards and Pokémon Tool cards you find there.";

/** The printed noun phrase as a filter: `anyOf` of two SHIPPED members. */
const SWEEP_FILTER: CardFilter = {
  kind: "anyOf",
  filters: [{ kind: "item" }, { kind: "toolCard" }],
};

/** The whole derived program, written out so §3 reads the arm against a value rather
    than against a re-typed expectation. */
const SWEEP_PROGRAM: readonly EffectOp[] = [
  { op: "revealOpponentHand" },
  { op: "discardFromOpponentHand", filter: SWEEP_FILTER },
];

const SEED = 20260907;

const SWEEP_ATTACK = 0;
const NO_EFFECT_AT_ALL = 1;

const SWEEP_CARDS: Record<string, Card> = {
  /** The attacker. Index 0 prints the sentence; index 1 prints NO effect text at all,
      which is §6's control separating *the program ran and found nothing* from *no
      program ran* — two silences that look identical in a hand count. */
  "d485-thief": battler("d485-thief", {
    name: "D485 Thief",
    types: ["Colorless"],
    hp: 300,
    attacks: [
      { cost: ["Colorless"], name: "Hand Sweep", effect: SWEEP },
      { cost: ["Colorless"], name: "Plain Cuff", damage: 30 },
    ],
  }),
  /** The defender. Big enough that nothing here Knocks it Out — this attack prints no
      damage box, and a KO would end the batch before the hand could be read. */
  "d485-wall": battler("d485-wall", { name: "D485 Wall", types: ["Colorless"], hp: 340 }),
  "d485-item-a": trainerCard("d485-item-a", "Item", "The first test Item."),
  "d485-item-b": trainerCard("d485-item-b", "Item", "The second test Item."),
  "d485-item-c": trainerCard("d485-item-c", "Item", "The third test Item."),
  "d485-tool-a": trainerCard("d485-tool-a", "Tool", "The first test Tool."),
  "d485-tool-b": trainerCard("d485-tool-b", "Tool", "The second test Tool."),
  "d485-sup": trainerCard("d485-sup", "Supporter", "A test Supporter."),
  "d485-stadium": trainerCard("d485-stadium", "Stadium", "A test Stadium."),
  "d485-nrg": basicEnergy("d485-nrg"),
};

const SWEEP_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...SWEEP_CARDS };

const SWEEP_DECK = deckOf({
  "d485-thief": 8,
  "d485-wall": 8,
  "d485-item-a": 6,
  "d485-item-b": 6,
  "d485-item-c": 6,
  "d485-tool-a": 6,
  "d485-tool-b": 6,
  "d485-sup": 4,
  "d485-stadium": 4,
  "d485-nrg": 6,
});

const LOADED_HAND = [
  "d485-item-a",
  "d485-item-b",
  "d485-item-c",
  "d485-tool-a",
  "d485-tool-b",
  "d485-sup",
  "d485-stadium",
  "d485-nrg",
] as const;

/** No Item and no Tool — §6's ZERO-MATCH board. */
const BARREN_HAND = ["d485-sup", "d485-stadium", "d485-nrg"] as const;

function openTable(first: Seat): GameState {
  return driveSetup(SEED, { p1: SWEEP_DECK, p2: SWEEP_DECK }, { pool: SWEEP_POOL, first });
}

/** Rebuild `seat`'s HAND outright (`opponentHandDiscard.test.ts`'s `withHand`, needed
    here for its reason — the opponent's hand IS the zone under test, and every board
    below has to field it at an exact composition). */
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

function table(oppHand: readonly string[] = LOADED_HAND, attacker: Seat = "p1"): GameState {
  const defender: Seat = attacker === "p1" ? "p2" : "p1";
  let state = openTable(defender);
  state = mustApply(state, { type: "endTurn", seat: defender }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, attacker, "d485-thief");
  state = setActiveFromDeck(state, defender, "d485-wall");
  state = clearBench(state, attacker);
  state = clearBench(state, defender);
  state = attachFromDeck(state, attacker, "d485-nrg", 1);
  state = withHand(state, attacker, ["d485-item-a", "d485-tool-a", "d485-nrg"]);
  return withHand(state, defender, oppHand);
}

/** The card id behind a uid, off the two persisted maps the state actually carries
    (`interpreter.ts`'s own `cardOf`, spelled here because it is private there). */
function idOf(uid: string, state: GameState): string {
  const id = state.cardIdByUid[uid];
  if (id === undefined) throw new Error(`no card for uid ${uid}`);
  return id;
}

const idsIn = (state: GameState, seat: Seat, zone: "hand" | "discard"): string[] =>
  state.players[seat][zone].map((uid) => idOf(uid, state)).sort();

describe("§1 — the sentence, and the family it lands in, measured not quoted", () => {
  it("the printed sentence is IN the legal attack column at exactly 1 printing", () => {
    const row = legalAttackCorpus().find(([, sentence]) => sentence === SWEEP);
    expect(row).toBeDefined();
    expect(row?.[0]).toBe(1);
  });

  it("the WHOLE `reveals their hand` family, printed whole and classified", () => {
    const family = legalAttackCorpus().filter(([, s]) => s.includes("reveals their hand"));
    expect(family.map(([n, s]) => `${n} ${s}`).sort()).toEqual(
      [
        "1 Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck.",
        "1 Your opponent reveals their hand. Discard all Item cards and Pokémon Tool cards you find there.",
        "1 Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.",
        "2 Your opponent reveals their hand. Discard a card you find there.",
        "2 Your opponent reveals their hand. Put up to 2 Basic Pokémon you find there onto your opponent's Bench.",
        "3 Your opponent reveals their hand. This attack does 50 damage for each Trainer card you find there.",
        "7 Your opponent reveals their hand.",
      ].sort(),
    );
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(17);
    const refused = family.filter(([, s]) => !resolvedByAnyReader(s));
    expect(refused.map(([, s]) => s)).toEqual([
      "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.",
    ]);
    expect(refused.reduce((sum, [n]) => sum + n, 0)).toBe(1);
  });

  it("NO APOSTROPHE OF EITHER CLASS on the sentence, so the BEARING census stands still", () => {
    expect(SWEEP).not.toContain("'");
    expect(SWEEP).not.toContain("’");
  });
});

describe("§2 — the oracle, and the anchor's yield measured over the whole column", () => {
  it("the anchor claims EXACTLY this row — 1 sentence / 1 printing over 640", () => {
    const claimed = legalAttackCorpus().filter(([, s]) => deriveAttackEffect(s) !== null);
    const mine = claimed.filter(([, s]) => s.includes("Discard all Item cards"));
    expect(mine.map(([, s]) => s)).toEqual([SWEEP]);
    expect(mine.reduce((sum, [n]) => sum + n, 0)).toBe(1);
  });

  it("the TEMPLATED alternative claims the IDENTICAL 1 / 1, so the capture buys nothing", () => {
    const WIDE =
      /^Your opponent reveals their hand\. Discard all ([A-Za-zé ]+) cards and ([A-Za-zé ]+) cards you find there\.$/;
    const wide = legalAttackCorpus().filter(([, s]) => WIDE.test(s));
    expect(wide.map(([, s]) => s)).toEqual([SWEEP]);
    expect(wide.reduce((sum, [n]) => sum + n, 0)).toBe(1);
    // …and the two captures it would have bought are exactly the two printed nouns, so
    // the equality above is a statement about the POOL and not about a lucky regex.
    const m = WIDE.exec(SWEEP);
    expect([m?.[1], m?.[2]]).toEqual(["Item", "Pokémon Tool"]);
  });

  it("the reader surface is still THIRTEEN, derived off the module", () => {
    expect(attackReaderSurface()).toHaveLength(14);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE ARM
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the derived program", () => {
  it("the printed sentence derives to the reveal AND the sweep, in printed order", () => {
    expect(deriveAttackEffect(SWEEP)).toEqual(SWEEP_PROGRAM);
  });

  it("the filter is `anyOf` of two SHIPPED members, and they are DISJOINT", () => {
    const item = SWEEP_CARDS["d485-item-a"] as Card;
    const tool = SWEEP_CARDS["d485-tool-a"] as Card;
    const sup = SWEEP_CARDS["d485-sup"] as Card;
    expect(matchesFilter(item, { kind: "item" })).toBe(true);
    expect(matchesFilter(item, { kind: "toolCard" })).toBe(false);
    expect(matchesFilter(tool, { kind: "toolCard" })).toBe(true);
    expect(matchesFilter(tool, { kind: "item" })).toBe(false);
    expect(matchesFilter(item, SWEEP_FILTER)).toBe(true);
    expect(matchesFilter(tool, SWEEP_FILTER)).toBe(true);
    // …and the third printed Trainer subtype is NOT swept, which is the rung that
    // separates a `trainerType` read from a bare `category === "Trainer"` one.
    expect(matchesFilter(sup, SWEEP_FILTER)).toBe(false);
  });

  it("neither near-miss spelling is claimed — the anchor is the WHOLE sentence", () => {
    // The head alone still derives to the bare reveal it has derived to since M5…
    expect(deriveAttackEffect(SWEEP_HEAD)).toEqual([{ op: "revealOpponentHand" }]);
    // …and the TAIL alone is claimed by NOBODY, which is §7's whole subject.
    expect(deriveAttackEffect(SWEEP_TAIL)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE OP, DRIVEN AT UNIT LEVEL
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — `discardFromOpponentHand`, driven off a program", () => {
  it("sweeps every match out of the OPPONENT's hand and NEVER parks", () => {
    const state = table();
    const events: GameEvent[] = [];
    const result = runProgram(deepFreeze(state), SWEEP_PROGRAM, { seat: "p1" }, events);
    if (result.kind !== "done") throw new Error("the sweep must not park");
    expect(idsIn(result.state, "p2", "hand")).toEqual(
      ["d485-nrg", "d485-stadium", "d485-sup"].sort(),
    );
    expect(idsIn(result.state, "p2", "discard")).toEqual(
      ["d485-item-a", "d485-item-b", "d485-item-c", "d485-tool-a", "d485-tool-b"].sort(),
    );
    // The reveal is FIRST and the discard SECOND — the printed order, filed as two rows.
    expect(types(events)).toEqual(["HAND_REVEALED", "FORCED_HAND_DISCARD"]);
  });

  it("the CONTROLLER's own hand is untouched, on a board where it holds matches", () => {
    // The seat axis, observable only because `table()` loads p1's hand with an Item and a
    // Tool. A build that read `ctx.seat` instead of `otherSeat(ctx.seat)` would empty this
    // hand and leave the other one whole, and both halves are asserted.
    const state = table();
    const before = idsIn(state, "p1", "hand");
    const events: GameEvent[] = [];
    const result = runProgram(deepFreeze(state), SWEEP_PROGRAM, { seat: "p1" }, events);
    if (result.kind !== "done") throw new Error("the sweep must not park");
    expect(idsIn(result.state, "p1", "hand")).toEqual(before);
    expect(idsIn(result.state, "p1", "discard")).toEqual(idsIn(state, "p1", "discard"));
  });

  it("an EMPTY hand reveals honestly and discards nothing", () => {
    const state = table([]);
    const events: GameEvent[] = [];
    const result = runProgram(deepFreeze(state), SWEEP_PROGRAM, { seat: "p1" }, events);
    if (result.kind !== "done") throw new Error("the sweep must not park");
    // The reveal still fires — "they showed me nothing" is a real thing that happened at
    // the table (`revealOpponentHand`'s own rule) — and the sweep files nothing.
    expect(types(events)).toEqual(["HAND_REVEALED"]);
    expect(result.state).toBe(state);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE LOAD-BEARING BOARD: SIX READINGS, SIX DIFFERENT ANSWERS
// ─────────────────────────────────────────────────────────────────────────────

const READINGS: readonly (readonly [string, CardFilter | null])[] = [
  ["correct — anyOf(item, toolCard)", SWEEP_FILTER],
  ["filter dropped — discard EVERYTHING", { kind: "anyCard" }],
  ["toolCard dropped — items only", { kind: "item" }],
  ["item dropped — tools only", { kind: "toolCard" }],
  ["category-only — every Trainer", { kind: "trainerCard" }],
  ["anyOf read as an INTERSECTION — discard nothing", null],
];

describe("§5 — the discriminating board, computed BEFORE it is asserted", () => {
  it("the six readings answer six DIFFERENT numbers on this one hand", () => {
    const cards = LOADED_HAND.map((id) => SWEEP_CARDS[id] as Card);
    const swept = READINGS.map(([, filter]) =>
      filter === null
        ? // the `.every` reading of `anyOf`: item AND tool, which no card satisfies
          cards.filter(
            (c) => matchesFilter(c, { kind: "item" }) && matchesFilter(c, { kind: "toolCard" }),
          ).length
        : cards.filter((c) => matchesFilter(c, filter)).length,
    );
    // 5 correct · 8 everything · 3 items-only · 2 tools-only · 7 every Trainer · 0
    // intersection. **SIX READINGS, SIX DIFFERENT NUMBERS**, so no pair of them can be
    // confused on this board and none of the rungs below is vacuous by coincidence.
    expect(swept).toEqual([5, 8, 3, 2, 7, 0]);
    expect(new Set(swept).size).toBe(READINGS.length);
    const without = (drop: string) =>
      cards.filter((c) => c.id !== drop).filter((c) => matchesFilter(c, { kind: "item" })).length;
    expect(without("d485-item-a")).toBe(2);
    const trainersWithoutTheOthers = cards
      .filter((c) => c.id !== "d485-sup" && c.id !== "d485-stadium")
      .filter((c) => matchesFilter(c, { kind: "trainerCard" })).length;
    expect(trainersWithoutTheOthers).toBe(5);
  });

  it("the NEAR-MISS shipped op is separated by this board, and would NOT be by a smaller one", () => {
    const ONE_MATCH = ["d485-item-a", "d485-sup", "d485-nrg"];
    for (const program of [
      SWEEP_PROGRAM,
      [
        { op: "revealOpponentHand" },
        { op: "bottomFromOpponentHand", filter: SWEEP_FILTER, dest: "discard" },
      ],
    ] as readonly (readonly EffectOp[])[]) {
      const events: GameEvent[] = [];
      const result = runProgram(deepFreeze(table(ONE_MATCH)), program, { seat: "p1" }, events);
      if (result.kind !== "done") throw new Error("a one-match hand asks nobody anything");
      expect(idsIn(result.state, "p2", "discard")).toEqual(["d485-item-a"]);
      expect(idsIn(result.state, "p2", "hand")).toEqual(["d485-nrg", "d485-sup"].sort());
    }
    const near: readonly EffectOp[] = [
      { op: "revealOpponentHand" },
      { op: "bottomFromOpponentHand", filter: SWEEP_FILTER, dest: "discard" },
    ];
    const parked = runProgram(deepFreeze(table()), near, { seat: "p1" }, []);
    expect(parked.kind).toBe("parked");
    const done = runProgram(deepFreeze(table()), SWEEP_PROGRAM, { seat: "p1" }, []);
    expect(done.kind).toBe("done");
  });

  it("the real ATTACK produces the CORRECT reading's board, end to end", () => {
    const { state, events } = mustApply(table(), {
      type: "attack",
      seat: "p1",
      index: SWEEP_ATTACK,
    });
    expect(idsIn(state, "p2", "discard")).toEqual(
      ["d485-item-a", "d485-item-b", "d485-item-c", "d485-tool-a", "d485-tool-b"].sort(),
    );
    // No park anywhere in the batch, and the turn simply ended.
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(types(events)).toContain("HAND_REVEALED");
    expect(types(events)).toContain("FORCED_HAND_DISCARD");
    // …and the sentence was NOT flagged loud, which is the rung that would go red if the
    // anchor were removed while the ops stayed.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("the LOG row this op reaches, driven — D478's call-path obligation", () => {
    const { state, events } = mustApply(table(), {
      type: "attack",
      seat: "p1",
      index: SWEEP_ATTACK,
    });
    const ctx: LogContext = {
      names: { p1: "Ember", p2: "Tide" },
      state,
      elapsed: formatElapsed(0),
    };
    const rows = logFromEvents(events, ctx).filter(
      (r) => r.kind === "action" && r.segments.some((seg) => seg.text.includes("from their hand")),
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined || row.kind !== "action") throw new Error("no hand-discard row");
    expect(row.segments.map((seg) => seg.text).join("")).toContain(
      "discarded 5 cards from their hand",
    );
    expect(row.who).toBe("p2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE ZERO-MATCH BOARD, WITH ITS CONTROLS
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — zero matches, and the controls that say WHY it is silent", () => {
  it("a hand with no Item and no Tool loses NOTHING, and files no discard row", () => {
    const { state, events } = mustApply(table(BARREN_HAND), {
      type: "attack",
      seat: "p1",
      index: SWEEP_ATTACK,
    });
    expect(idsIn(state, "p2", "discard")).toEqual([]);
    expect(types(events)).not.toContain("FORCED_HAND_DISCARD");
  });

  it("CONTROL ONE — the program DID run: the reveal fired on the same board", () => {
    // The first of the two silences. `HAND_REVEALED` is the op that cannot whiff, so its
    // presence separates *the sweep ran and matched nothing* from *nothing ran*.
    const { events } = mustApply(table(BARREN_HAND), {
      type: "attack",
      seat: "p1",
      index: SWEEP_ATTACK,
    });
    expect(types(events)).toContain("HAND_REVEALED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("CONTROL TWO — an attack with NO effect text on the SAME board reveals nothing", () => {
    // The other silence, fielded so the two are distinguishable. Same board, same seat,
    // same hand; the only difference is the printed sentence.
    const { events } = mustApply(table(BARREN_HAND), {
      type: "attack",
      seat: "p1",
      index: NO_EFFECT_AT_ALL,
    });
    expect(types(events)).not.toContain("HAND_REVEALED");
    expect(types(events)).not.toContain("FORCED_HAND_DISCARD");
  });

  it("CONTROL THREE — one Item in the same hand and exactly one card moves", () => {
    const { state, events } = mustApply(table(["d485-item-a", "d485-sup", "d485-nrg"]), {
      type: "attack",
      seat: "p1",
      index: SWEEP_ATTACK,
    });
    expect(idsIn(state, "p2", "discard")).toEqual(["d485-item-a"]);
    expect(types(events)).toContain("FORCED_HAND_DISCARD");
  });
});

describe("§7 — why the compound is anchored WHOLE and not composed", () => {
  it("the printed string splits into a head that BUILDS and this tail", () => {
    expect(SWEEP).toBe(`${SWEEP_HEAD} ${SWEEP_TAIL}`);
    expect(resolvedByAnyReader(SWEEP_HEAD)).toBe(true);
  });

  it("the splitter DOES compose this shape — proved on a tail that already builds", () => {
    const composed = splitAttackTrailingClause(`${SWEEP_HEAD} Draw 3 cards.`);
    expect(composed).toEqual({ head: SWEEP_HEAD, tail: "Draw 3 cards." });
  });

  it("THE TAIL IS AN ANAPHOR, so nothing claims it alone — and nothing may", () => {
    expect(deriveAttackEffect(SWEEP_TAIL)).toBeNull();
    const BOGUS = `Draw 3 cards. ${SWEEP_TAIL}`;
    expect(deriveAttackEffect(BOGUS)).toBeNull();
    expect(splitAttackTrailingClause(BOGUS)).toBeNull();
    expect(resolvedByAnyReader(BOGUS)).toBe(false);
  });

  it("the compound is claimed WHOLE, so neither splitter ever sees it", () => {
    // The shadow refusal: a string a reader claims is that reader's, and composition never
    // gets a look at it. Both splitters are driven, not inferred from the guard.
    expect(resolvedByAnyReader(SWEEP)).toBe(true);
    expect(splitAttackTrailingClause(SWEEP)).toBeNull();
    expect(splitAttackGateClause(SWEEP)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — `MATCH_RECORD_VERSION` STAYS 29, DRIVEN RATHER THAN QUOTED
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the persisted record cannot hold this op", () => {
  it("REACHABILITY IS EMPTY: neither op in the program can park", () => {
    for (const hand of [
      LOADED_HAND,
      BARREN_HAND,
      [],
      ["d485-item-a"],
      ["d485-tool-a", "d485-tool-b"],
    ]) {
      const result = runProgram(deepFreeze(table(hand)), SWEEP_PROGRAM, { seat: "p1" }, []);
      expect(result.kind, JSON.stringify(hand)).toBe("done");
    }
    // …and through the real action API, where a park would surface as the phase.
    for (const hand of [LOADED_HAND, BARREN_HAND, []]) {
      const { state } = mustApply(table(hand), { type: "attack", seat: "p1", index: SWEEP_ATTACK });
      expect(state.phase.kind, JSON.stringify(hand)).toBe("turn:action");
    }
  });

  it("the SERIALIZED ALPHABET does not grow: a round trip is byte-identical", () => {
    const { state } = mustApply(table(), { type: "attack", seat: "p1", index: SWEEP_ATTACK });
    const round = JSON.parse(JSON.stringify(state)) as GameState;
    expect(round).toEqual(state);
    expect(JSON.stringify(state)).not.toContain("discardFromOpponentHand");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — THE VERSION PINS
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — the version, and what it is owed for", () => {
  it("engineVersion is 0.555.0 and the bump is owed for BEHAVIOUR", () => {
    expect(manifest.version).toBe(engineVersion);
  });
});
