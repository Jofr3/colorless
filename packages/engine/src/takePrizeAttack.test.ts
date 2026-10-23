import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  applyAction,
  deriveAttackEffect,
  formatElapsed,
  logFromEvents,
  otherSeat,
  phaseViewOf,
  programFor,
  redactGame,
} from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import { splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import {
  FIXTURE_POOL,
  TAKE_PRIZE_DECK,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setPrizes,
  types,
} from "./testFixtures";

const SENTENCE = "Discard all Energy from this Pokémon, and take a Prize card.";

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function count(events: GameEvent[], type: GameEvent["type"]): number {
  return events.filter((e) => e.type === type).length;
}

function board(first: Seat = "p2", seed = 4): GameState {
  const state = driveSetup(
    seed,
    { p1: TAKE_PRIZE_DECK, p2: TAKE_PRIZE_DECK },
    { first, active: { p1: "fix-prizewheel", p2: "fix-prizewheel" } },
  );
  const opened = mustApply(state, { type: "endTurn", seat: first }).state;
  return benchFromDeck(benchFromDeck(opened, "p1", "fix-titan"), "p2", "fix-titan");
}

function wheel(opts: {
  attacker: Seat;
  energy: number;
  defender?: string;
  fire?: number;
  seed?: number;
}): GameState {
  const defenderSeat = otherSeat(opts.attacker);
  let state = board(defenderSeat, opts.seed ?? 4);
  if (opts.defender !== undefined) {
    state = setActiveFromDeck(state, defenderSeat, opts.defender);
  }
  state = attachFromDeck(state, opts.attacker, "fix-energy", opts.energy);
  return opts.fire === undefined
    ? state
    : attachFromDeck(state, opts.attacker, "fix-fire-energy", opts.fire);
}

function attack(state: GameState, seat: Seat, index: number) {
  return mustApply(state, { type: "attack", seat, index });
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the sentence, the population, and what cannot be resolved here.
// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — one sentence, three printings, and one printed count in the whole column", () => {
  it("the corpus prints exactly this sentence at exactly this count", () => {
    const rows = legalAttackCorpus().filter(([, text]) => text === SENTENCE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(3);
  });

  it("the LOOSEST plausible family grep returns 14 rows, and ONE of them takes a prize", () => {
    const hits = legalAttackCorpus().filter(([, text]) => /prize/i.test(text));
    expect(hits).toHaveLength(14);
    const takes = hits.filter(([, text]) => /take \d+ more Prize|and take a Prize card/.test(text));
    expect(takes.map(([, text]) => text).sort()).toEqual([
      SENTENCE,
      "During your next turn, if the Defending Pokémon is Knocked Out, take 2 more Prize cards.",
    ]);
    const rider = deriveAttackEffect(
      "During your next turn, if the Defending Pokémon is Knocked Out, take 2 more Prize cards.",
    );
    expect(rider).toEqual([{ op: "bountyDefender", amount: 2 }]);
    expect((rider ?? []).some((op) => op.op === "takePrize")).toBe(false);
  });

  it("the fixture prints the sentence VERBATIM at three indices and AUTHORS nothing", () => {
    const attacks = FIXTURE_POOL["fix-prizewheel"]?.attacks ?? [];
    expect(attacks.slice(0, 3).map((a) => a.effect)).toEqual([SENTENCE, SENTENCE, SENTENCE]);
    expect(attacks[3]?.effect).toBe("Heal 100 damage from 1 of your Benched Ancient Pokémon.");
    expect(
      legalAttackCorpus().filter(
        ([, text]) => text === "Heal 100 damage from 1 of your Benched Ancient Pokémon.",
      ),
    ).toEqual([[1, "Heal 100 damage from 1 of your Benched Ancient Pokémon."]]);
    expect(attacks[4]?.effect).toBe("Discard an Energy from this Pokémon.");
  });

  it("the three carriers cannot be enumerated in this checkout, and that is STATED", () => {
    const row = legalAttackCorpus().find(([, text]) => text === SENTENCE);
    expect(row).toEqual([3, SENTENCE]);
    expect(FIXTURE_POOL["fix-prizewheel"]?.id).toBe("fix-prizewheel");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the derivation, and every boundary the anchor holds.
// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — two ops in printed order, and the compound cost ONE anchor", () => {
  it("derives the shipped discard-all followed by the new field-free prize op", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "takePrize" },
    ]);
  });

  it("the HEAD alone is the SHIPPED arm, byte-identical — this slice widened nothing", () => {
    // The compound's first op is not a new spelling of the discard; it is arm 9's own
    // output. If they ever come apart, one of the two is wrong.
    const head = deriveAttackEffect("Discard all Energy from this Pokémon.");
    expect(head).toEqual([deriveAttackEffect(SENTENCE)?.[0]]);
  });

  it("ONE anchor and not a composed pair — BOTH splitter refusals, driven", () => {
    // The pricing pass predicted `splitAttackTrailingClause` returns null. It does,
    // and for TWO independent reasons, either of which alone refuses it.
    expect(splitAttackTrailingClause(SENTENCE)).toBeNull();
    expect(splitAttackGateClause(SENTENCE)).toBeNull();
    // REASON 1 — the clause break is a PERIOD then whitespace then a capital, and this
    // sentence joins with ", and". The period-joined near-miss splits into two halves…
    const periodJoined = "Discard all Energy from this Pokémon. Take a Prize card.";
    expect(splitAttackTrailingClause(periodJoined)).toBeNull();
    // REASON 2 — …and is STILL refused, because the tail is claimed by no reader. That
    // is the reason that survives a reprint switching the punctuation, which is why
    // both are pinned rather than only the one that happens to fire first.
    expect(deriveAttackEffect("Take a Prize card.")).toBeNull();
    expect(deriveAttackEffect("take a Prize card.")).toBeNull();
    expect(deriveAttackEffect("Discard all Energy from this Pokémon.")).not.toBeNull();
  });

  it("ZERO new readers — the arm is inside `deriveAttackEffect`", () => {
    expect(deriveAttackEffect(SENTENCE)).not.toBeNull();
    expect(programFor("fix-prizewheel")).toBeUndefined();
  });

  it("refuses each near-miss — and ADMITS one on the SAME axis beside each (D424/D427)", () => {
    const cases: { axis: string; refused: string; admitted: string }[] = [
      {
        axis: "the leading capital (the anchor's ^D)",
        refused: "discard all Energy from this Pokémon, and take a Prize card.",
        admitted: SENTENCE,
      },
      {
        axis: "the trailing period (the anchor's \\.$)",
        refused: "Discard all Energy from this Pokémon, and take a Prize card",
        admitted: SENTENCE,
      },
      {
        axis: "the printed count — 'a' versus '2'",
        refused: "Discard all Energy from this Pokémon, and take 2 Prize cards.",
        admitted: SENTENCE,
      },
      {
        axis: "the joiner — ', and' versus '. '",
        refused: "Discard all Energy from this Pokémon. Take a Prize card.",
        admitted: SENTENCE,
      },
      {
        axis: "the quantifier — 'all' versus 'an'",
        refused: "Discard an Energy from this Pokémon, and take a Prize card.",
        admitted: "Discard an Energy from this Pokémon.",
      },
      {
        axis: "the subject — 'this Pokémon' versus 'your Active Pokémon'",
        refused: "Discard all Energy from your Active Pokémon, and take a Prize card.",
        admitted: SENTENCE,
      },
    ];
    for (const { axis, refused, admitted } of cases) {
      expect({ axis, derived: deriveAttackEffect(refused) }).toEqual({ axis, derived: null });
      expect({ axis, derived: deriveAttackEffect(admitted) }).not.toEqual({ axis, derived: null });
    }
  });

  it("exactly ONE corpus sentence is newly claimed — the arm's blast radius, measured", () => {
    // The anchor is a whole-sentence literal, so its reach over the committed column is
    // decidable rather than estimated: every sentence the regex could possibly match is
    // exactly the ones that ARE this string.
    const claimed = legalAttackCorpus().filter(([, text]) =>
      /^Discard all Energy from this Pokémon, and take a Prize card\.$/.test(text),
    );
    expect(claimed.map(([, text]) => text)).toEqual([SENTENCE]);
    expect(claimed[0]?.[0]).toBe(3);
    const family = legalAttackCorpus().filter(([, text]) =>
      text.startsWith("Discard all Energy from this Pokémon"),
    );
    expect(family.length).toBeGreaterThan(1);
    expect(family.filter(([, text]) => deriveAttackEffect(text) !== null).length).toBeLessThan(
      family.length,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the persisted version, driven both directions.
// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — `MATCH_RECORD_VERSION` stays 26, and the prediction is DRIVEN", () => {
  function parkedMidAttack(): GameState {
    const state = wheel({ attacker: "p1", energy: 1, fire: 1 });
    const parked = attack(state, "p1", 4).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    return JSON.parse(JSON.stringify(parked)) as GameState;
  }

  it("DIRECTION 1 — a v26 record holding the PARKED PRIZE STAGE replays unchanged", () => {
    const parked = attack(wheel({ attacker: "p1", energy: 3 }), "p1", 0).state;
    expect(parked.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    expect(parked.pending[0]).toEqual({ kind: "takePrizes", seat: "p1", count: 1 });
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    const live = mustApply(parked, { type: "takePrizes", seat: "p1", prizeIndices: [2] });
    const replayed = mustApply(revived, { type: "takePrizes", seat: "p1", prizeIndices: [2] });
    expect(replayed.state.players.p1.hand).toEqual(live.state.players.p1.hand);
    expect(replayed.state.players.p1.prizes).toEqual(live.state.players.p1.prizes);
    expect(types(replayed.events)).toEqual(types(live.events));
  });

  it("DIRECTION 2 — a v26 `cont.rest` WITHOUT the op resolves; one WITH it takes a prize", () => {
    const legacy = parkedMidAttack();
    const legacyPhase = legacy.phase;
    if (legacyPhase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(legacyPhase.cont.rest).toEqual([]);
    const chosen = (legacyPhase.prompt as { discardable: { uid: string }[] }).discardable[0]?.uid;
    const drainedLegacy = mustApply(legacy, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen as string] },
    });
    expect(drainedLegacy.state.players.p1.prizes).toHaveLength(6);
    expect(count(drainedLegacy.events, "PRIZES_OWED")).toBe(0);

    // …and a record whose tail DOES carry the new inhabitant parks on the prize, which
    // is the half that proves the op survives serialisation rather than that the old
    // bytes were merely ignored.
    const carrying = parkedMidAttack();
    const carryingPhase = carrying.phase;
    if (carryingPhase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const newOp: EffectOp = { op: "takePrize" };
    (carryingPhase as unknown as { cont: { rest: EffectOp[] } }).cont.rest = [newOp];
    const roundTripped = JSON.parse(JSON.stringify(carrying)) as GameState;
    const drained = mustApply(roundTripped, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen as string] },
    });
    expect(drained.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    expect(find(drained.events, "PRIZES_OWED")?.seat).toBe("p1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the Energy discard and the prize, together, on one board, from both chairs.
// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — the cost and the prize are ONE sentence and both happen", () => {
  it("the Energy goes to the discard pile AND the prize is owed — printed order", () => {
    const state = wheel({ attacker: "p1", energy: 3 });
    expect(state.players.p1.active?.energy).toHaveLength(3);
    const result = attack(state, "p1", 0);
    // ORDER: the §8.5 hit, then the discard (the printed cost), then the prize prompt.
    expect(types(result.events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "ENERGY_DISCARDED",
      "PRIZES_OWED",
    ]);
    expect(result.state.players.p1.active?.energy).toEqual([]);
    expect(result.state.players.p1.discard).toHaveLength(3);
    expect(find(result.events, "PRIZES_OWED")).toEqual({
      type: "PRIZES_OWED",
      seat: "p1",
      count: 1,
    });
  });

  it("the prize lands in the ATTACKER's hand and the row shortens by exactly one", () => {
    const parked = attack(wheel({ attacker: "p1", energy: 2 }), "p1", 0).state;
    const before = parked.players.p1.prizes;
    const taken = mustApply(parked, { type: "takePrizes", seat: "p1", prizeIndices: [3] });
    expect(find(taken.events, "PRIZES_TAKEN")).toEqual({
      type: "PRIZES_TAKEN",
      seat: "p1",
      uids: [before[3] as string],
      indices: [3],
      remaining: 5,
    });
    expect(taken.state.players.p1.prizes).toHaveLength(5);
    expect(taken.state.players.p1.hand).toContain(before[3] as string);
    expect(taken.state.players.p2.prizes).toHaveLength(6);
  });

  it("the SEAT is not hard-coded — p2 attacking takes p2's prize", () => {
    const parked = attack(wheel({ attacker: "p2", energy: 2 }), "p2", 0).state;
    expect(parked.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    const taken = mustApply(parked, { type: "takePrizes", seat: "p2", prizeIndices: [1] });
    expect(taken.state.players.p2.prizes).toHaveLength(5);
    expect(taken.state.players.p1.prizes).toHaveLength(6);
  });

  it("an attack with NO printed damage still takes the prize — it is an EFFECT", () => {
    // Index 2 has no `damage` key at all, so §8.5 never runs. A build that conditioned
    // the prize on damage dealt would whiff here and be right everywhere else.
    const result = attack(wheel({ attacker: "p1", energy: 2 }), "p1", 2);
    expect(types(result.events)).toEqual(["ATTACK_DECLARED", "ENERGY_DISCARDED", "PRIZES_OWED"]);
  });

  it("no ATTACK_EFFECT_SKIPPED in EITHER direction — and index 3 is the control", () => {
    for (const index of [0, 1, 2]) {
      const result = attack(
        wheel({ attacker: "p1", energy: 3, defender: "fix-titan" }),
        "p1",
        index,
      );
      expect({ index, skipped: count(result.events, "ATTACK_EFFECT_SKIPPED") }).toEqual({
        index,
        skipped: 0,
      });
    }
    const control = attack(wheel({ attacker: "p1", energy: 2 }), "p1", 3);
    expect(count(control.events, "ATTACK_EFFECT_SKIPPED")).toBe(1);
  });

  it("an attacker with NO Energy attached still takes the prize — the discard whiffs alone", () => {
    // §8.6 "do as much as you can": index 2 costs {C} and the wheel must pay it, so the
    // board is one Energy that the discard then removes. The point is the ordering
    // contract — the prize is not gated on the discard having found anything.
    const result = attack(wheel({ attacker: "p1", energy: 1 }), "p1", 2);
    expect(find(result.events, "PRIZES_OWED")?.count).toBe(1);
  });
});

describe("§5 — the stage is spliced AHEAD of the attack tail, and the KO's prize is second", () => {
  it("the park's queue is [takePrizes, attackEpilogue] — spliced, not appended", () => {
    const parked = attack(wheel({ attacker: "p1", energy: 3 }), "p1", 0).state;
    expect(parked.pending.map((stage) => stage.kind)).toEqual(["takePrizes", "attackEpilogue"]);
    // An APPEND would put the prize BEHIND the epilogue — i.e. after the §8.1 Knock Out
    // sweep, after TURN_ENDED and after the Checkup. This is the assertion that goes red
    // for that build, and it is the whole reason the splice exists.
    expect(parked.pending[0]).toEqual({ kind: "takePrizes", seat: "p1", count: 1 });
  });

  it("resolving the prize resumes the epilogue and ends the turn — the tail still drains", () => {
    const parked = attack(wheel({ attacker: "p1", energy: 3 }), "p1", 0).state;
    const done = mustApply(parked, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(types(done.events)).toEqual([
      "PRIZES_TAKEN",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(done.state.pending).toEqual([]);
    expect(done.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("an attack that ALSO Knocks the Defender Out owes TWO prizes, effect's FIRST", () => {
    const first = attack(wheel({ attacker: "p1", energy: 3, defender: "fix-wall" }), "p1", 1);
    expect(types(first.events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "ENERGY_DISCARDED",
      "PRIZES_OWED",
    ]);
    expect(count(first.events, "KNOCKED_OUT")).toBe(0);
    expect(first.state.players.p2.active).not.toBeNull();
    expect(first.state.pending.map((s) => s.kind)).toEqual(["takePrizes", "attackEpilogue"]);

    // PROMPT 2 — the §8.1 sweep's, from inside the epilogue. The Knock Out fires HERE,
    // between the two prizes, which is what makes them two stages rather than one.
    const second = mustApply(first.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(types(second.events)).toEqual(["PRIZES_TAKEN", "KNOCKED_OUT", "PRIZES_OWED"]);
    expect(second.state.players.p1.prizes).toHaveLength(5);
    expect(second.state.pending.map((s) => s.kind)).toEqual([
      "takePrizes",
      "promote",
      "endTurn",
      "checkup",
      "startTurn",
    ]);

    const third = mustApply(second.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(types(third.events)).toEqual(["PRIZES_TAKEN", "PROMOTION_REQUIRED"]);
    // TWO prizes for ONE attack: 6 → 5 → 4. A build that merged the two stages, or that
    // dropped either, lands on 5.
    expect(third.state.players.p1.prizes).toHaveLength(4);
    expect(third.state.phase).toEqual({ kind: "ko:promote", seat: "p2" });
  });

  it("and the EFFECT's prize can end the game BEFORE the Knock Out it would have caused", () => {
    const state = setPrizes(wheel({ attacker: "p1", energy: 3, defender: "fix-wall" }), "p1", 1);
    const result = attack(state, "p1", 1);
    expect(types(result.events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "ENERGY_DISCARDED",
      "PRIZES_TAKEN",
      "GAME_OVER",
    ]);
    expect(count(result.events, "KNOCKED_OUT")).toBe(0);
    expect(result.state.pending).toEqual([]);
  });
});

describe("§6 — §14, the win, its control, and the empty row", () => {
  it("the attacker on their LAST prize takes it and the game ends, with the right winner", () => {
    const result = attack(setPrizes(wheel({ attacker: "p1", energy: 3 }), "p1", 1), "p1", 0);
    expect(types(result.events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "ENERGY_DISCARDED",
      "PRIZES_TAKEN",
      "GAME_OVER",
    ]);
    expect(find(result.events, "GAME_OVER")?.outcome).toEqual({
      result: "win",
      winner: "p1",
      reason: "prizesTaken",
    });
    expect(result.state.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p1", reason: "prizesTaken" },
    });
    expect(result.state.players.p1.prizes).toEqual([]);
  });

  it("the SAME board one prize higher does NOT end the game — the non-winning control", () => {
    const parked = attack(setPrizes(wheel({ attacker: "p1", energy: 3 }), "p1", 2), "p1", 0).state;
    expect(parked.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const done = mustApply(parked, { type: "takePrizes", seat: "p1", prizeIndices: [1] });
    expect(count(done.events, "GAME_OVER")).toBe(0);
    expect(done.state.players.p1.prizes).toHaveLength(1);
    expect(done.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("the win is the ATTACKER's — p2 on their last prize wins as p2", () => {
    const result = attack(setPrizes(wheel({ attacker: "p2", energy: 3 }), "p2", 1), "p2", 0);
    expect(find(result.events, "GAME_OVER")?.outcome).toEqual({
      result: "win",
      winner: "p2",
      reason: "prizesTaken",
    });
  });

  it("ZERO prizes left: the stage CLAMPS to nothing, pops, and the turn ends", () => {
    const result = attack(setPrizes(wheel({ attacker: "p1", energy: 3 }), "p1", 0), "p1", 0);
    expect(types(result.events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "ENERGY_DISCARDED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(count(result.events, "PRIZES_OWED")).toBe(0);
    expect(count(result.events, "PRIZES_TAKEN")).toBe(0);
    expect(result.state.players.p1.prizes).toEqual([]);
    // …and the Energy discard, which is the OTHER half of the sentence, still ran.
    expect(result.state.players.p1.active?.energy).toEqual([]);
  });
});

describe("§7 — no consumer of the stage derives a Knock Out from it", () => {
  const parkedBoard = () => attack(wheel({ attacker: "p1", energy: 3 }), "p1", 0).state;

  it("the board shows NO Knock Out: nothing left play, and no seat is short a body", () => {
    // The premise of the whole audit, asserted first: this stage is live and there is
    // no Knock Out anywhere on the board. Every rung below is about a reader that could
    // have concluded otherwise.
    const parked = parkedBoard();
    expect(parked.phase.kind).toBe("ko:takePrizes");
    expect(parked.players.p2.active).not.toBeNull();
    expect(parked.players.p2.bench).toHaveLength(1);
    expect(parked.players.p1.active).not.toBeNull();
    expect(parked.lastKoTurn).toEqual({ p1: null, p2: null });
    expect(parked.lastKoMarks).toEqual({ p1: [], p2: [] });
  });

  it("`phaseViewOf` — the nearest thing to a derivation, and it answers correctly", () => {
    const parked = parkedBoard();
    for (const viewer of ["p1", "p2"] as const) {
      const view = phaseViewOf(parked, viewer);
      expect({ viewer, ...view }).toEqual({
        viewer,
        activeSeat: "p1",
        waitingSeat: "p1",
        pendingDecision: { kind: "takePrizes", count: 1 },
        outcome: null,
      });
    }
  });

  it("`redactGame` — counts only, no seat, and the opponent learns nothing extra", () => {
    const parked = parkedBoard();
    for (const viewer of ["p1", "p2"] as const) {
      expect({ viewer, phase: redactGame(parked, viewer).phase }).toEqual({
        viewer,
        phase: { kind: "ko:takePrizes", count: 1 },
      });
    }
    const wire = JSON.stringify(redactGame(parked, "p2"));
    for (const uid of parked.players.p1.prizes) expect(wire).not.toContain(`"${uid}"`);
  });

  it("the LOG rows name the attacker and claim no Knock Out — D425's exact defect shape", () => {
    const parked = parkedBoard();
    const owedRun = attack(wheel({ attacker: "p1", energy: 3 }), "p1", 0);
    const taken = mustApply(parked, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    const ctx = { names: { p1: "Ana", p2: "Bo" }, state: parked, elapsed: formatElapsed(0) };
    const rows = [...logFromEvents(owedRun.events, ctx), ...logFromEvents(taken.events, ctx)];
    const prizeRows = rows.filter(
      (row) => row.kind === "action" && row.segments.some((s) => /prize card/.test(s.text)),
    );
    expect(prizeRows).toHaveLength(2);
    for (const row of prizeRows) {
      if (row.kind !== "action") throw new Error("expected an action row");
      expect(row.who).toBe("p1");
      const text = row.segments.map((s) => s.text).join("");
      expect(text).not.toMatch(/Knocked Out|Knock Out|Bo/);
    }
  });

  it("`flow.ts`'s two batch quantifiers cannot see this stage — and the §14 tie is intact", () => {
    const first = attack(wheel({ attacker: "p1", energy: 3, defender: "fix-wall" }), "p1", 1);
    const second = mustApply(first.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(second.state.players.p1.prizes).toHaveLength(5);
    expect(second.state.pending.filter((s) => s.kind === "takePrizes")).toEqual([
      { kind: "takePrizes", seat: "p1", count: 1 },
    ]);
    expect(count(second.events, "GAME_OVER")).toBe(0);
  });

  it("`attack.ts`'s desync guard still fires — the phase and the head must agree", () => {
    // The handler cross-checks the head stage against the ko:* phase before popping it,
    // and this is the first stage of that kind the queue can hold for a non-KO reason.
    // A crafted snapshot must still be refused rather than acted out.
    const parked = parkedBoard();
    const tampered: GameState = {
      ...parked,
      pending: [{ kind: "takePrizes", seat: "p2", count: 1 }, ...parked.pending.slice(1)],
    };
    const rejected = applyAction(tampered, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(rejected).toEqual({
      ok: false,
      error: { code: "PHASE_DESYNC", message: expect.stringContaining("ko:takePrizes") },
    });
    // …and the WRONG SEAT answering is refused by the shared interrupt gate.
    const wrongSeat = applyAction(parked, { type: "takePrizes", seat: "p2", prizeIndices: [0] });
    expect(wrongSeat).toEqual({
      ok: false,
      error: { code: "WRONG_SEAT", message: expect.any(String) },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — purity.
// ─────────────────────────────────────────────────────────────────────────────
describe("§8 — a frozen board resolves, in both the parking and the clamped case", () => {
  it("the board is not mutated — the PARKING case", () => {
    const state = deepFreeze(wheel({ attacker: "p1", energy: 3 }));
    const parked = attack(state, "p1", 0).state;
    expect(parked.phase.kind).toBe("ko:takePrizes");
    const resolved = mustApply(deepFreeze(parked), {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [4],
    });
    expect(resolved.state.players.p1.prizes).toHaveLength(5);
    // The original is untouched: a splice that pushed into `pending` in place would
    // throw on the frozen array rather than return a new one.
    expect(state.players.p1.active?.energy).toHaveLength(3);
  });

  it("the board is not mutated — the CLAMPED (empty row) case", () => {
    const state = deepFreeze(setPrizes(wheel({ attacker: "p1", energy: 3 }), "p1", 0));
    const result = attack(state, "p1", 0);
    expect(result.state.players.p1.prizes).toEqual([]);
    expect(state.players.p1.prizes).toEqual([]);
    expect(state.pending).toEqual([]);
  });
});
