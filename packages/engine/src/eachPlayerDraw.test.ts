import type { Card } from "@colorless/schema";
import manifest from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effects from "./effects";
import type { EffectOp } from "./effects";
import { deriveAttackEffect } from "./effects";
import type { GameEvent } from "./events";
import { engineVersion } from "./index";
import type { GameState, Seat } from "./index";
import type { EffectRecord } from "./interpreter";
import { runProgram } from "./interpreter";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  attachFromDeck,
  basicEnergy,
  battler,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  driveSetup,
} from "./testFixtures";

const find = (events: readonly GameEvent[], type: string): GameEvent | undefined =>
  events.find((e) => e.type === type);
const all = (events: readonly GameEvent[], type: string): GameEvent[] =>
  events.filter((e) => e.type === type);
const types = (events: readonly GameEvent[]): string[] => events.map((e) => e.type);

const PRINTED = "Each player draws 3 cards.";
const COUNT = 3;
const SEED = 20260910;

const D491_CARDS: Record<string, Card> = {
  "d491-drawer": battler("d491-drawer", {
    name: "D491 Drawer",
    types: ["Colorless"],
    hp: 300,
    attacks: [
      { cost: ["Colorless"], name: "Share Out", damage: 10, effect: PRINTED },
      // The CONTROL attack: same body, same cost, same damage, NO effect text at all. It
      // is what makes "these cards moved" a claim about the SENTENCE rather than about
      // the turn.
      { cost: ["Colorless"], name: "Plain Cuff", damage: 10 },
      { cost: ["Colorless"], name: "Solo Draw", damage: 10, effect: "Draw 3 cards." },
    ],
  }),
  /** The defender. Big enough that no reading in §4 Knocks it Out, because a KO ends the
      batch before the zones can be read. */
  "d491-wall": battler("d491-wall", { name: "D491 Wall", types: ["Colorless"], hp: 700 }),
  "d491-energy": basicEnergy("d491-energy"),
  "d491-a1": battler("d491-a1", { name: "D491 A One", types: ["Water"], hp: 60 }),
  "d491-a2": battler("d491-a2", { name: "D491 A Two", types: ["Water"], hp: 60 }),
  "d491-a3": battler("d491-a3", { name: "D491 A Three", types: ["Water"], hp: 60 }),
  "d491-a4": battler("d491-a4", { name: "D491 A Four", types: ["Water"], hp: 60 }),
  "d491-b1": battler("d491-b1", { name: "D491 B One", types: ["Fire"], hp: 60 }),
  "d491-b2": battler("d491-b2", { name: "D491 B Two", types: ["Fire"], hp: 60 }),
  "d491-b3": battler("d491-b3", { name: "D491 B Three", types: ["Fire"], hp: 60 }),
  "d491-b4": battler("d491-b4", { name: "D491 B Four", types: ["Fire"], hp: 60 }),
  "d491-filler": battler("d491-filler", { name: "D491 Filler", types: ["Colorless"], hp: 60 }),
};

const D491_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...D491_CARDS };

const D491_DECK = deckOf({
  "d491-drawer": 4,
  "d491-wall": 4,
  "d491-energy": 4,
  "d491-a1": 4,
  "d491-a2": 4,
  "d491-a3": 4,
  "d491-a4": 4,
  "d491-b1": 4,
  "d491-b2": 4,
  "d491-b3": 4,
  "d491-b4": 4,
  "d491-filler": 16,
});

const SELF_TOP = ["d491-a1", "d491-a2", "d491-a3", "d491-a4"] as const;
const FOE_TOP = ["d491-b1", "d491-b2", "d491-b3", "d491-b4"] as const;

function openTable(first: Seat): GameState {
  return driveSetup(SEED, { p1: D491_DECK, p2: D491_DECK }, { pool: D491_POOL, first });
}

/** Rebuild `seat`'s DECK outright and park the rest in the HAND. The deck is the zone
    under test; the hand is only ever read as a DELTA, so its residue is inert. */
function withDeck(state: GameState, seat: Seat, deckIds: readonly string[]): GameState {
  const side = state.players[seat];
  const pool = [...side.deck, ...side.hand];
  const deck = deckIds.map((id) => {
    const at = pool.findIndex((uid) => state.cardIdByUid[uid] === id);
    if (at < 0) throw new Error(`${seat} has no spare ${id}`);
    const [uid] = pool.splice(at, 1);
    if (uid === undefined) throw new Error("splice returned nothing");
    return uid;
  });
  return { ...state, players: { ...state.players, [seat]: { ...side, deck, hand: pool } } };
}

function table(attacker: Seat, selfDeck: readonly string[], foeDeck: readonly string[]): GameState {
  const defender: Seat = attacker === "p1" ? "p2" : "p1";
  let state = openTable(defender);
  state = mustApply(state, { type: "endTurn", seat: defender }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, attacker, "d491-drawer");
  state = setActiveFromDeck(state, defender, "d491-wall");
  state = clearBench(state, attacker);
  state = clearBench(state, defender);
  state = attachFromDeck(state, attacker, "d491-energy", 1);
  state = withDeck(state, attacker, selfDeck);
  return withDeck(state, defender, foeDeck);
}

const SHARE_OUT = 0;
const PLAIN_CUFF = 1;
const SOLO_DRAW = 2;

const idOf = (uid: string, state: GameState): string => {
  const id = state.cardIdByUid[uid];
  if (id === undefined) throw new Error(`no card for uid ${uid}`);
  return id;
};
const idsIn = (state: GameState, seat: Seat, zone: "hand" | "deck"): string[] =>
  state.players[seat][zone].map((uid) => idOf(uid, state));

function swing(
  state: GameState,
  seat: Seat,
  index: number,
): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat, index });
}

function effectDraws(
  events: readonly GameEvent[],
  state: GameState,
): { seat: Seat; ids: string[] }[] {
  return events.flatMap((e) =>
    e.type === "CARDS_DRAWN" && e.reason === "effect"
      ? [{ seat: e.seat, ids: e.uids.map((uid) => idOf(uid, state)) }]
      : [],
  );
}

/** The ids that JOINED `seat`'s hand across the swing, in arrival order. A delta rather
    than a whole-hand pin, because the setup draw's contents are a function of the seed and
    are none of this file's business. */
function gained(before: GameState, after: GameState, seat: Seat): string[] {
  const had = new Map<string, number>();
  for (const uid of before.players[seat].hand) had.set(uid, (had.get(uid) ?? 0) + 1);
  const out: string[] = [];
  for (const uid of after.players[seat].hand) {
    const n = had.get(uid) ?? 0;
    if (n > 0) had.set(uid, n - 1);
    else out.push(idOf(uid, after));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the reader surface, and WHICH reader owns the sentence.

describe("D491 §1 — one reader claims it and the other twelve still refuse", () => {
  it("the surface is thirteen, taken off the MODULE and not off a list", () => {
    expect(attackReaderSurface()).toHaveLength(14);
    expect(attackReaderSurface()).toContain("deriveAttackEffect");
  });

  it("`deriveAttackEffect` OWNS it and every other reader still says null", () => {
    const owner = "deriveAttackEffect";
    for (const name of attackReaderSurface()) {
      const read = (effects as unknown as Record<string, (t: string) => unknown>)[name];
      if (read === undefined) throw new Error(`surface names a missing export: ${name}`);
      if (name === owner) expect(read(PRINTED), name).not.toBeNull();
      else expect(read(PRINTED), name).toBeNull();
    }
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });

  it("the specimen IS a row of the committed corpus, at its committed printing count", () => {
    expect(legalAttackCorpus().filter(([, text]) => text === PRINTED)).toEqual([[1, PRINTED]]);
    const eachPlayer = legalAttackCorpus().filter(([, text]) => /each player/i.test(text));
    expect(eachPlayer.map(([, text]) => text)).toEqual([
      "Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way.",
      PRINTED,
    ]);
  });

  it("neither splitter and no registry row is involved — the RAW summand alone", () => {
    for (const split of [
      effects.splitAttackRequirementClause,
      effects.splitAttackCancelClause,
      effects.splitAttackGateClause,
      effects.splitAttackTrailingClause,
    ]) {
      expect(split(PRINTED)).toBeNull();
    }
    expect(legalAttackCorpus().filter(([, t]) => t.startsWith(`${PRINTED} `))).toEqual([]);
  });

  it("derives to ONE op — the shipped `drawCards`, keyed", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual([
      { op: "drawCards", count: COUNT, who: "eachPlayer" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the axis-substitution LATTICE, pinned rather than described.

describe("D491 §2 — the 2⁴ lattice, and the one axis that decides it", () => {
  const point = (scope: boolean, form: boolean, mood: boolean, count: boolean): string => {
    const n = count ? 2 : 3;
    if (form) return mood ? `You may draw ${n} cards.` : `Draw ${n} cards.`;
    return `${scope ? "Your opponent" : "Each player"} ${mood ? "may draw" : "draws"} ${n} cards.`;
  };

  it("the 16 points, and the ONE axis that decides all of them", () => {
    const CLAIMED = /^Each player draws (\d+) cards\.$/;
    const rows: { weight: number; text: string; now: boolean; before: boolean; form: boolean }[] =
      [];
    for (let m = 0; m < 16; m++) {
      const [scope, form, mood, count] = [1, 2, 4, 8].map((bit) => (m & bit) !== 0) as [
        boolean,
        boolean,
        boolean,
        boolean,
      ];
      const text = point(scope, form, mood, count);
      const now = resolvedByAnyReader(text);
      rows.push({
        weight: [scope, form, mood, count].filter(Boolean).length,
        text,
        now,
        before: now && !CLAIMED.test(text),
        form,
      });
    }
    expect(rows).toHaveLength(16);

    for (const row of rows) expect(row.before, `${row.text} (before)`).toBe(row.form);
    expect([0, 1, 2, 3, 4].map((w) => rows.filter((r) => r.weight === w).length)).toEqual([
      1, 4, 6, 4, 1,
    ]);
    expect(
      [0, 1, 2, 3, 4].map((w) => rows.filter((r) => r.weight === w && r.before).length),
    ).toEqual([0, 1, 3, 3, 1]);

    for (const row of rows) {
      expect(row.now, `${row.text} (after)`).toBe(row.form || CLAIMED.test(row.text));
    }
    expect(rows.filter((r) => r.now && !r.before).map((r) => r.text)).toEqual([
      "Each player draws 3 cards.",
      "Each player draws 2 cards.",
    ]);
  });

  it("the COUNT axis is DEGENERATE, and that corrects the price", () => {
    // The recorded price named SCOPE, MOOD and COUNT. `Draw 3 cards.` has built since M4,
    // so substituting the count onto its nearest built spelling changes nothing on either
    // side of the split — it is not an axis of this sentence at all.
    expect(deriveAttackEffect("Draw 3 cards.")).toEqual([{ op: "drawCards", count: 3 }]);
    expect(deriveAttackEffect("Draw 2 cards.")).toEqual([{ op: "drawCards", count: 2 }]);
    expect(deriveAttackEffect("Each player draws 2 cards.")).toEqual([
      { op: "drawCards", count: 2, who: "eachPlayer" },
    ]);
  });

  it("an OPPONENT-side finite draw is STILL refused — the axis is the clause, not the seat", () => {
    // This is what makes the lattice's conclusion a claim about the engine rather than
    // about this one sentence: the engine has an opponent-draw OP (`opponentMayDraw`) and
    // no reader has ever read a sentence into it.
    expect(deriveAttackEffect("Your opponent draws 3 cards.")).toBeNull();
    expect(resolvedByAnyReader("Your opponent draws 3 cards.")).toBe(false);
    expect(deriveAttackEffect("Both players draw 3 cards.")).toBeNull();
  });

  it("the anchor claims exactly ONE corpus row, measured over all 640", () => {
    const claimed = legalAttackCorpus().filter(([, t]) =>
      /^Each player draws (\d+) cards\.$/.test(t),
    );
    expect(claimed).toEqual([[1, PRINTED]]);
  });

  it("the near-misses are refused, each differing on exactly ONE axis (D427)", () => {
    for (const near of [
      "Each player draws 3 cards", // the `\.$`
      "each player draws 3 cards.", // the `^` and the case
      "Each player draws a card.",
      "Each player draws 0 cards.", // the family's `count >= 1` guard
      "Each player may draw 3 cards.", // the MOOD; the engine's seat-crossing MAY parks
      "Each player draws 3 cards from the bottom of your deck.", // the `from` axis, unprinted
    ]) {
      expect(deriveAttackEffect(near), near).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the fixture and the anchor's disjointness from its two siblings.

describe("D491 §3 — three draw anchors, disjoint by STRUCTURE", () => {
  it("no string matches two of the three, so no ordering here can change an answer", () => {
    for (const [text, expected] of [
      [PRINTED, [{ op: "drawCards", count: 3, who: "eachPlayer" }]],
      ["Draw 3 cards.", [{ op: "drawCards", count: 3 }]],
      [
        "Draw 3 cards from the bottom of your deck.",
        [{ op: "drawCards", count: 3, from: "bottom" }],
      ],
    ] as const) {
      expect(deriveAttackEffect(text), text).toEqual(expected);
    }
    expect(
      deriveAttackEffect("Each player draws 3 cards from the bottom of their deck."),
    ).toBeNull();
    expect(
      deriveAttackEffect("Your opponent draws 3 cards from the bottom of their deck."),
    ).toBeNull();
  });

  it("both ENDS of the anchor are pinned, and they fail DIFFERENTLY (D464)", () => {
    expect(deriveAttackEffect("Draw a card. Each player draws 3 cards.")).toBeNull();
    expect(resolvedByAnyReader("Draw a card. Each player draws 3 cards.")).toBe(false);
    expect(deriveAttackEffect(`${PRINTED} Draw a card.`)).toBeNull();
    expect(deriveAttackEffect("Each player draws 3 cards")).toBeNull();
    // …and the composition, asserted rather than left to be discovered.
    expect(effects.splitAttackTrailingClause(`${PRINTED} Draw a card.`)).toEqual({
      head: PRINTED,
      tail: "Draw a card.",
    });
    expect(legalAttackCorpus().filter(([, t]) => t.startsWith(`${PRINTED} `))).toEqual([]);
  });

  it("the MODAL is refused by the anchor, not by a guard", () => {
    expect(deriveAttackEffect("Each player may draw 3 cards.")).toBeNull();
    expect(deriveAttackEffect("Each player may draws 3 cards.")).toBeNull();
    expect(legalAttackCorpus().filter(([, t]) => /each player may/i.test(t))).toEqual([]);
  });

  it("the demonstrator prints the sentence VERBATIM and AUTHORS nothing", () => {
    const attacks = D491_POOL["d491-drawer"]?.attacks ?? [];
    expect(attacks.map((a) => a.effect)).toEqual([PRINTED, undefined, "Draw 3 cards."]);
    expect(attacks.map((a) => a.damage)).toEqual([10, 10, 10]);
    expect(attacks.map((a) => a.cost)).toEqual([["Colorless"], ["Colorless"], ["Colorless"]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the board. SEVEN readings, and which cards reached which hand.

describe("D491 §4 — both hands grow, and the ids say whose deck they came off", () => {
  const board = (): GameState => table("p1", SELF_TOP, FOE_TOP);

  it("the correct build moves THREE cards into EACH hand, off EACH OWN deck", () => {
    const before = board();
    const { state, events } = swing(before, "p1", SHARE_OUT);
    expect(effectDraws(events, state)).toEqual([
      { seat: "p1", ids: ["d491-a1", "d491-a2", "d491-a3"] },
      { seat: "p2", ids: ["d491-b1", "d491-b2", "d491-b3"] },
    ]);
    for (const [seat, ids] of [
      ["p1", ["d491-a1", "d491-a2", "d491-a3"]],
      ["p2", ["d491-b1", "d491-b2", "d491-b3"]],
    ] as const) {
      const hand = idsIn(state, seat, "hand");
      for (const id of ids) expect(hand, `${seat} ${id}`).toContain(id);
    }
    expect(idsIn(state, "p1", "deck")).toEqual(["d491-a4"]);
    expect(idsIn(state, "p2", "deck")).toEqual([]);
  });

  it("readings 2, 3 and 4 are separated by CONTENTS, not by a total", () => {
    const { state, events } = swing(board(), "p1", SHARE_OUT);
    const rows = effectDraws(events, state);
    // The totals are equal by construction (3 and 3), which is exactly why a hand-SIZE
    // assertion would pass on a build that dealt six cards to one seat.
    expect(rows.map((r) => r.ids.length)).toEqual([COUNT, COUNT]);
    for (const row of rows) {
      const prefix = row.seat === "p1" ? "d491-a" : "d491-b";
      expect(
        row.ids.every((id) => id.startsWith(prefix)),
        row.seat,
      ).toBe(true);
    }
    expect(rows.map((r) => r.ids[0])).toEqual(["d491-a1", "d491-b1"]);
  });

  it("the ONE-AXIS SIBLING on the SAME board leaves the opponent's deck alone", () => {
    // `Draw 3 cards.` — same count, same cost, same printed damage, one word of subject
    // different. This is the rung that makes the key load-bearing rather than decorative:
    // a build that ignored `who` would answer THIS for the printed sentence too.
    const { state, events } = swing(board(), "p1", SOLO_DRAW);
    expect(effectDraws(events, state)).toEqual([
      { seat: "p1", ids: ["d491-a1", "d491-a2", "d491-a3"] },
    ]);
    // p2's deck lost exactly ONE card, and it is the §5.1 turn draw rather than this op's.
    expect(idsIn(state, "p2", "deck")).toEqual(["d491-b2", "d491-b3", "d491-b4"]);
  });

  it("the CONTROL attack moves no card at all", () => {
    const { state, events } = swing(board(), "p1", PLAIN_CUFF);
    expect(effectDraws(events, state)).toEqual([]);
    expect(idsIn(state, "p1", "deck")).toEqual(SELF_TOP.slice());
    // …and it is not on the loud path either — an attack with no effect text has nothing
    // to skip, which is a different state from an unread one.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("the sentence is SIMULATED, so the loud channel stays silent", () => {
    const { events } = swing(board(), "p1", SHARE_OUT);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", by: "p1", dealt: 10 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — §8.6 "do as much as you can", per seat, and §14.3 deck-out.

describe("D491 §5 — the shallow decks, and who loses when a deck runs out", () => {
  it("§8.6 — a 1-card deck deals ONE, and the other seat still takes three", () => {
    const { state, events } = swing(table("p1", ["d491-a1"], FOE_TOP), "p1", SHARE_OUT);
    expect(effectDraws(events, state)).toEqual([
      { seat: "p1", ids: ["d491-a1"] },
      { seat: "p2", ids: ["d491-b1", "d491-b2", "d491-b3"] },
    ]);
  });

  it("an EMPTY deck emits NO row at all, rather than a `drew 0 cards` one", () => {
    const { state, events } = swing(table("p1", [], FOE_TOP), "p1", SHARE_OUT);
    expect(effectDraws(events, state)).toEqual([
      { seat: "p2", ids: ["d491-b1", "d491-b2", "d491-b3"] },
    ]);
  });

  it("§14.3 — the draw that EMPTIES a deck loses nothing; the next DRAW STEP does", () => {
    const { state, events } = swing(table("p1", ["d491-a1"], ["d491-b1"]), "p1", SHARE_OUT);
    expect(effectDraws(events, state)).toEqual([
      { seat: "p1", ids: ["d491-a1"] },
      { seat: "p2", ids: ["d491-b1"] },
    ]);
    const order = types(events);
    expect(order.indexOf("GAME_OVER")).toBeGreaterThan(order.lastIndexOf("CARDS_DRAWN"));
    expect(order.indexOf("GAME_OVER")).toBeGreaterThan(order.indexOf("DAMAGE_DEALT"));
    expect(order.indexOf("GAME_OVER")).toBeGreaterThan(order.indexOf("TURN_ENDED"));
  });

  it("…and with BOTH decks empty the DEFENDER loses, because their turn is next", () => {
    const { state, events } = swing(table("p1", ["d491-a1"], ["d491-b1"]), "p1", SHARE_OUT);
    expect(state.phase.kind).toBe("gameOver");
    expect(find(events, "GAME_OVER")).toMatchObject({
      outcome: { result: "win", winner: "p1", reason: "deckOut" },
    });
    // …and the ATTACKER, whose deck is equally empty, is the WINNER. That is the whole
    // asymmetry, and it belongs to the rules rather than to this op.
    expect(state.players.p1.deck).toEqual([]);
    expect(state.players.p2.deck).toEqual([]);
  });

  it("the CONTROL: with both decks DEEP the same swing ends nothing", () => {
    const { state } = swing(table("p1", SELF_TOP, FOE_TOP), "p1", SHARE_OUT);
    expect(state.phase.kind).not.toBe("gameOver");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the seat ORDER, driven from p2's chair.

describe("D491 §6 — controller-first, and the rung runs from p2's chair", () => {
  it("from P2's chair the rows read p2 THEN p1 — absolute seats would read p1 first", () => {
    const { state, events } = swing(table("p2", SELF_TOP, FOE_TOP), "p2", SHARE_OUT);
    expect(effectDraws(events, state)).toEqual([
      { seat: "p2", ids: ["d491-a1", "d491-a2", "d491-a3"] },
      { seat: "p1", ids: ["d491-b1", "d491-b2", "d491-b3"] },
    ]);
  });

  it("from P1's chair the two readings AGREE, which is the control", () => {
    const { state, events } = swing(table("p1", SELF_TOP, FOE_TOP), "p1", SHARE_OUT);
    expect(effectDraws(events, state).map((row) => row.seat)).toEqual(["p1", "p2"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the log, and the second player's voice.

describe("D491 §7 — the second player's wording is FREE", () => {
  it("two rows, each filed under its OWN seat, with the same predicate", () => {
    const { state, events } = swing(table("p1", SELF_TOP, FOE_TOP), "p1", SHARE_OUT);
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:11" };
    const rows = logFromEvents(events, ctx).flatMap((entry) =>
      entry.kind === "turn"
        ? []
        : [{ who: entry.who, text: entry.segments.map((seg) => seg.text).join("") }],
    );
    const drew = rows.filter((row) => row.text === "drew 3 cards");
    expect(drew.map((row) => row.who)).toEqual(["p1", "p2"]);
    expect(new Set(drew.map((row) => row.text))).toEqual(new Set(["drew 3 cards"]));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — `recordAs` over two seats, and the DESCRIBER obligation, traced.

describe("D491 §8 — the record is filed ONCE, over both seats' cards", () => {
  it("`recordMoved` ASSIGNS, so a per-seat filing would keep only the LAST seat", () => {
    const state = table("p1", SELF_TOP, FOE_TOP);
    const record: EffectRecord = {};
    const events: GameEvent[] = [];
    const program: readonly EffectOp[] = [
      { op: "drawCards", count: COUNT, who: "eachPlayer", recordAs: "moved" },
    ];
    runProgram(state, program, { seat: "p1" }, record, events);
    expect(record.moved).toHaveLength(2 * COUNT);
    expect((record.moved ?? []).map((uid) => idOf(uid, state))).toEqual([
      "d491-a1",
      "d491-a2",
      "d491-a3",
      "d491-b1",
      "d491-b2",
      "d491-b3",
    ]);
  });

  it("the DESCRIBER obligation is EMPTY, and it is traced rather than argued", () => {
    for (const [seat, self, foe] of [
      ["p1", SELF_TOP, FOE_TOP],
      ["p1", ["d491-a1"], ["d491-b1"]],
      ["p1", [], []],
      ["p2", SELF_TOP, FOE_TOP],
    ] as const) {
      const { state, events } = swing(table(seat, self, foe), seat, SHARE_OUT);
      expect(state.phase.kind).not.toBe("effect:choose");
      expect(types(events)).not.toContain("EFFECT_PENDING");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — `MATCH_RECORD_VERSION` stays 29, driven at the hard address.

describe("D491 §9 — the version question, asked at the address that persists", () => {
  it("the ADDRESS does persist, so this is NOT a no-carrier argument", () => {
    expect(deriveAttackEffect("Discard a card from your hand. If you do, draw 2 cards.")).toEqual([
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      { op: "recordGate", slot: "paid", ops: [{ op: "drawCards", count: 2 }] },
    ]);
  });

  it("a v29 byte string still means what a v29 writer meant — the LOSS direction", () => {
    const state = table("p1", SELF_TOP, FOE_TOP);
    const v29: readonly EffectOp[] = [{ op: "drawCards", count: COUNT }];
    const events: GameEvent[] = [];
    const record: EffectRecord = {};
    const next = runProgram(state, v29, { seat: "p1" }, record, events);
    if ("park" in next) throw new Error("drawCards must not park");
    expect(all(events, "CARDS_DRAWN")).toHaveLength(1);
    expect(gained(state, next.state, "p1")).toEqual(["d491-a1", "d491-a2", "d491-a3"]);
    expect(gained(state, next.state, "p2")).toEqual([]);
    const wide: readonly EffectOp[] = [{ op: "drawCards", count: COUNT, who: "eachPlayer" }];
    const wideEvents: GameEvent[] = [];
    const widened = runProgram(state, wide, { seat: "p1" }, {}, wideEvents);
    if ("park" in widened) throw new Error("drawCards must not park");
    expect(gained(state, widened.state, "p2")).toHaveLength(COUNT);
    expect(all(wideEvents, "CARDS_DRAWN")).toHaveLength(2);
  });

  it("the engine version moved and the record version did not", () => {
    expect(manifest.version).toBe(engineVersion);
  });
});
