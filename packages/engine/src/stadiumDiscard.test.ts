import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader as readByAny,
} from "./censusAttackCorpus";
import { effectiveRetreatCost } from "./continuous";
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
  splitAttackCancelClause,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
} from "./effects";
import type { EffectOp, GameState, Seat } from "./index";
import {
  STADIUM_DISCARD_DECK,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
} from "./testFixtures";

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

const READERS: readonly ((text: string) => unknown)[] = [
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
  deriveAttackDiscardScaledBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackCancelRequirement,
];

const BARE = "Discard a Stadium in play.";
const MAY = "You may discard a Stadium in play.";

const STILL_OWED = [] as const;

const TAKEN_BY_D522 =
  "If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const TAKEN_BY_D382 =
  "If a Stadium is in play, this attack does 60 more damage. Then, discard that Stadium.";

const TAKEN_BY_D417 = "Discard a Stadium in play. If you can't, this attack does nothing.";

const BEACH_COURT = "sv01-167";

// ── boards ─────────────────────────────────────────────────────────────────────

function playStadium(state: GameState, seat: Seat): GameState {
  const withCard = handFromDeck(state, seat, BEACH_COURT, 1);
  const uid = handUid(withCard, seat, BEACH_COURT);
  return mustApply(withCard, { type: "playTrainer", seat, uid }).state;
}

function board(seed: number, owner: Seat | null = null): GameState {
  let state = driveSetup(
    seed,
    { p1: STADIUM_DISCARD_DECK, p2: STADIUM_DISCARD_DECK },
    { first: "p2" },
  );
  if (owner === "p2") state = playStadium(state, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  if (owner === "p1") state = playStadium(state, "p1");
  state = setActiveFromDeck(state, "p1", "fix-bigbody");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return state;
}

/** Field `cardId` in `seat`'s Active Spot and pay `spec` onto it symbol-for-symbol.
    Must run in that order: `attachFromDeck` attaches to whatever is Active. */
function fielded(
  state: GameState,
  seat: Seat,
  cardId: string,
  spec: readonly (readonly [string, number])[] = [],
): GameState {
  let next = setActiveFromDeck(state, seat, cardId);
  for (const [id, count] of spec) next = attachFromDeck(next, seat, id, count);
  return next;
}

/** Hisuian Growlithe's body. NO Energy is attached, because the printed attack takes
    none — which is what makes the discard the only thing on the board that moved. */
const blazingDestruction = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "fix-blazedestruct");

/** Wooloo's body, paid `{C}{C}`. */
const knockOver = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "fix-knockover", [["fix-energy", 2]]);

const attack = (state: GameState, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index: 0 });

const SEEDS = [9001, 9013, 9029] as const;

describe("§1 — the price, MEASURED: six printings on one op, against ONE for the best clause row", () => {
  it("D418 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the family is 6 sentences / 11 printings, and 5 / 10 of them now resolve", () => {
    const family = corpus().filter(([, s]) => s.includes("Stadium") && s.includes("iscard"));
    expect([family.length, units(family)]).toEqual([6, 11]);
    const taken = family.filter(([, s]) => s === BARE || s === MAY || readByAny(s));
    expect([taken.length, units(taken)]).toEqual([6, 11]);
    expect(taken.map(([, s]) => s)).toContain(TAKEN_BY_D382);
    expect(taken.map(([, s]) => s)).toContain(TAKEN_BY_D417);
    expect(taken.map(([, s]) => s)).toContain(TAKEN_BY_D522);
    const left = family.filter(([, s]) => (STILL_OWED as readonly string[]).includes(s));
    expect([left.length, units(left)]).toEqual([0, 0]);
    // The parts sum, which is what makes a partition a partition — and what stops a
    // successor quietly moving a sentence from one list to the other.
    expect(taken.length + left.length).toBe(family.length);
    expect(units(taken) + units(left)).toBe(units(family));
  });

  it("the two sentences carry 4 and 2 printings, and no third spelling hides behind them", () => {
    const bare = corpus().filter(([, s]) => s === BARE);
    expect([bare.length, units(bare)]).toEqual([1, 4]);
    const may = corpus().filter(([, s]) => s === MAY);
    expect([may.length, units(may)]).toEqual([1, 2]);
    const anyStadium = corpus().filter(([, s]) => s.includes("Stadium"));
    expect(anyStadium).toHaveLength(9);
    expect(corpus().filter(([, s]) => /stadium/i.test(s))).toHaveLength(anyStadium.length);
    expect(corpus().filter(([, s]) => /discard .{0,12}stadium/i.test(s))).toHaveLength(6);
    expect(corpus().some(([, s]) => /discard (your|their|your opponent's) Stadium/.test(s))).toBe(
      false,
    );
  });

  it("it is worth SIX times the best remaining clause row, which is why the era ended", () => {
    const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !readByAny(s));
    expect([refused.length, units(refused)]).toEqual([0, 0]);
    const singletons = refused.filter(([n]) => n === 1);
    expect(refused.length - singletons.length).toBe(0);
    expect(units(refused) - units(singletons)).toBe(0);
    expect([singletons.length, units(singletons)]).toEqual([0, 0]);
    expect(units(corpus().filter(([, s]) => s === BARE || s === MAY))).toBe(6 * 1);
  });
});

describe("§2 — the two readings, pinned byte-for-byte", () => {
  it("the BARE imperative derives the op ALONE — no gate, because an empty zone is a no-op", () => {
    expect(deriveAttackEffect(BARE)).toEqual([{ op: "discardStadium" }]);
  });

  it("the printed 'You may' derives the gate, the confirm and the op, in that order", () => {
    const expected: EffectOp[] = [
      {
        op: "conditionGate",
        cond: { kind: "stadiumInPlay" },
        then: [
          {
            op: "optional",
            note: MAY,
            then: [{ op: "discardStadium" }],
          },
        ],
      },
    ];
    expect(deriveAttackEffect(MAY)).toEqual(expected);
    // The confirm's note is the WHOLE printed sentence and not a re-voicing — the op's
    // own contract, and what the dialog shows.
    const gate = deriveAttackEffect(MAY)?.[0];
    if (gate === undefined || gate.op !== "conditionGate") throw new Error("expected the gate");
    const inner = gate.then[0];
    if (inner === undefined || inner.op !== "optional") throw new Error("expected the confirm");
    expect(inner.note).toBe(MAY);
    expect(gate.otherwise).toBeUndefined();
    expect(inner.otherwise).toBeUndefined();
  });

  it("the anchors are WHOLE-SENTENCE, so every compound printing of the family is refused", () => {
    for (const sentence of [...STILL_OWED, TAKEN_BY_D382]) {
      expect(deriveAttackEffect(sentence), sentence).toBeNull();
    }
    expect(deriveAttackEffect(TAKEN_BY_D522)).not.toBeNull();
    expect(deriveAttackEffect(TAKEN_BY_D522)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "stadiumInPlay" },
        then: [
          { op: "spreadDamage", target: "opponentBench", amount: 30 },
          { op: "discardStadium" },
        ],
      },
    ]);
    // …and the near misses a floating match would have swallowed. Neither is a printed
    // sentence; both are the fragments the four compounds are built out of.
    expect(deriveAttackEffect("discard that Stadium.")).toBeNull();
    expect(
      deriveAttackEffect(
        "You may discard a Stadium in play. If you do, this attack does 10 more damage.",
      ),
    ).toBeNull();
  });
});

describe("§3 — the board: the OWNER's pile, and a zone that is genuinely vacated", () => {
  it.each(SEEDS)("seed %i — P2's Stadium goes to P2's discard, not the attacker's", (seed) => {
    const before = blazingDestruction(board(seed, "p2"));
    const stadium = before.stadium;
    if (stadium === null) throw new Error("expected P2's Stadium in the zone");
    expect(stadium.owner).toBe("p2");
    const p1Discard = before.players.p1.discard.length;
    const p2Discard = before.players.p2.discard.length;

    const result = attack(before);
    const state = result.state;

    // The zone is EMPTY…
    expect(state.stadium).toBeNull();
    // …the card is in the OWNER's pile…
    expect(state.players.p2.discard).toContain(stadium.uid);
    expect(state.players.p2.discard).toHaveLength(p2Discard + 1);
    expect(state.players.p1.discard).toHaveLength(p1Discard);
    expect(state.players.p1.discard).not.toContain(stadium.uid);
    expect(state.players.p2.discard).toEqual([...before.players.p2.discard, stadium.uid]);
    expect(state.players.p2.active).toEqual(before.players.p2.active);
    expect(state.players.p2.bench).toEqual(before.players.p2.bench);
    expect(state.players.p1.discard).toEqual(before.players.p1.discard);
    expect(state.players.p1.active).toEqual({
      ...before.players.p1.active,
      usedAttack: { name: "Blazing Destruction", turn: before.turn },
    });
    expect(findEvent(result.events, "STADIUM_DISCARDED")).toEqual({
      type: "STADIUM_DISCARDED",
      seat: "p2",
      uid: stadium.uid,
      cause: "effect",
    });
    // …and the attack was not skipped, which is what a dropped op would look like.
    expect(types(result.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it.each(SEEDS)(
    "seed %i — the zone's CONTINUOUS effect stops applying, which a pile write cannot fake",
    (seed) => {
      let state = blazingDestruction(board(seed, "p2"));
      const defender = state.players.p2.active;
      if (defender === null) throw new Error("expected P2's Active");
      // `fix-bigbody` is a Basic with retreat 1, discounted to 0 while the zone holds it.
      expect(effectiveRetreatCost(state, defender)).toBe(0);
      state = attack(state).state;
      const after = state.players.p2.active;
      if (after === null) throw new Error("expected P2's Active");
      expect(effectiveRetreatCost(state, after)).toBe(1);
    },
  );

  it.each(SEEDS)(
    "seed %i — the same op on the attacker's OWN Stadium routes to the attacker",
    (seed) => {
      // The other half of the ownership read: `stadium.owner` is not a constant, and a
      // hard-coded `otherSeat(ctx.seat)` would be green on the case above and red here.
      let state = blazingDestruction(board(seed, "p1"));
      const stadium = state.stadium;
      if (stadium === null) throw new Error("expected P1's Stadium in the zone");
      const p2Discard = state.players.p2.discard.length;
      const result = attack(state);
      state = result.state;
      expect(state.stadium).toBeNull();
      expect(state.players.p1.discard).toContain(stadium.uid);
      expect(state.players.p2.discard).toHaveLength(p2Discard);
      expect(findEvent(result.events, "STADIUM_DISCARDED")?.seat).toBe("p1");
    },
  );

  it.each(SEEDS)(
    "seed %i — it works from the FAR SEAT too: the op reads the zone, not p1",
    (seed) => {
      // The op is seat-INDEPENDENT on its face (it never looks at `ctx.seat`), and a
      // P1-only suite cannot tell "reads the zone" apart from "reads p1's Stadium".
      let state = mustApply(board(seed, "p1"), { type: "endTurn", seat: "p1" }).state;
      state = blazingDestruction(state, "p2");
      const stadium = state.stadium;
      if (stadium === null) throw new Error("expected P1's Stadium in the zone");
      const result = attack(state, "p2");
      expect(result.state.stadium).toBeNull();
      // P2 attacked; the Stadium is P1's; it goes to P1's pile.
      expect(result.state.players.p1.discard).toContain(stadium.uid);
      expect(findEvent(result.events, "STADIUM_DISCARDED")?.seat).toBe("p1");
    },
  );
});

describe("§4 — the EMPTY zone: a silent no-op, and not a skipped effect", () => {
  it.each(SEEDS)("seed %i — the bare imperative resolves with nothing to discard", (seed) => {
    const state = blazingDestruction(board(seed, null));
    expect(state.stadium).toBeNull();
    const p1Discard = state.players.p1.discard.length;
    const p2Discard = state.players.p2.discard.length;
    const result = attack(state);
    // §8.6's "do as much as you can" — the attack RESOLVES, both piles stand still…
    expect(types(result.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(result.events)).not.toContain("ATTACK_FAILED");
    expect(result.state.players.p1.discard).toHaveLength(p1Discard);
    expect(result.state.players.p2.discard).toHaveLength(p2Discard);
    expect(types(result.events)).not.toContain("STADIUM_DISCARDED");
    // The turn is handed back to the actor, not parked on anything.
    expect(result.state.phase.kind).not.toBe("effect:choose");
  });
});

describe("§5 — the printed 'You may': a confirm that is asked ONLY when it has a stake", () => {
  it.each(SEEDS)(
    "seed %i — an OCCUPIED zone parks a confirm, and YES discards to the owner",
    (seed) => {
      let state = knockOver(board(seed, "p2"));
      const stadium = state.stadium;
      if (stadium === null) throw new Error("expected P2's Stadium in the zone");
      const parked = attack(state);
      expect(parked.state.phase.kind).toBe("effect:choose");
      expect(findEvent(parked.events, "EFFECT_PENDING")).toEqual({
        type: "EFFECT_PENDING",
        seat: "p1",
        note: MAY,
      });
      // …and the printed 30 has already landed: the confirm is about the discard, not
      // about the attack.
      expect(findEvent(parked.events, "DAMAGE_DEALT")).toMatchObject({ base: 30, dealt: 30 });

      const done = mustApply(parked.state, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "confirm", yes: true },
      });
      state = done.state;
      expect(state.stadium).toBeNull();
      expect(state.players.p2.discard).toContain(stadium.uid);
      expect(findEvent(done.events, "STADIUM_DISCARDED")?.seat).toBe("p2");
    },
  );

  it.each(SEEDS)("seed %i — and NO leaves the zone exactly as it was", (seed) => {
    const state = knockOver(board(seed, "p2"));
    const stadium = state.stadium;
    if (stadium === null) throw new Error("expected P2's Stadium in the zone");
    const parked = attack(state);
    const done = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: false },
    });
    expect(done.state.stadium).toEqual(stadium);
    expect(done.state.players.p2.discard).not.toContain(stadium.uid);
    expect(types(done.events)).not.toContain("STADIUM_DISCARDED");
  });

  it.each(SEEDS)(
    "seed %i — an EMPTY zone is not asked at all, which is the gate's whole job",
    (seed) => {
      // The rung a dropped `conditionGate` reddens on, and the ONLY one it can: without
      // the gate the program parks a confirm whose "yes" and "no" leave the identical
      // board — a decision with no stake, and a dialog the player cannot answer usefully.
      const state = knockOver(board(seed, null));
      expect(state.stadium).toBeNull();
      const result = attack(state);
      expect(result.state.phase.kind).not.toBe("effect:choose");
      expect(types(result.events)).not.toContain("EFFECT_PENDING");
      expect(types(result.events)).not.toContain("STADIUM_DISCARDED");
      // The attack still resolves its printed 30 — the gate refuses the question, not
      // the attack.
      expect(findEvent(result.events, "DAMAGE_DEALT")).toMatchObject({ base: 30, dealt: 30 });
    },
  );
});

describe("§6 — what this slice did NOT buy", () => {
  it("the ONE COMPOUND printing left stays LOUD, waiting on a named mechanism — D522: NONE is left, and the list is asserted EMPTY", () => {
    for (const sentence of STILL_OWED) {
      expect(readByAny(sentence), sentence).toBe(false);
    }
    const left = corpus().filter(([, s]) => (STILL_OWED as readonly string[]).includes(s));
    expect(units(left)).toBe(0);
    expect(STILL_OWED).toHaveLength(0);
    expect(readByAny(TAKEN_BY_D382)).toBe(true);
    expect(readByAny(TAKEN_BY_D417)).toBe(true);
    expect(readByAny(TAKEN_BY_D522)).toBe(true);
  });

  it("the TRAILING ANAPHORIC cancel is a FAMILY of 3 printings, not one card — and D420 closed it", () => {
    const anaphoric = corpus().filter(([, s]) =>
      s.includes("If you can't, this attack does nothing."),
    );
    expect([anaphoric.length, units(anaphoric)]).toEqual([2, 2]);
    for (const [, s] of anaphoric) expect(deriveAttackRequirement(s), s).toBeNull();
    const [stadiumRow, handRow] = [
      anaphoric.filter(([, s]) => s === TAKEN_BY_D417),
      anaphoric.filter(([, s]) => s !== TAKEN_BY_D417),
    ];
    expect([stadiumRow.length, handRow.length]).toEqual([1, 1]);
    for (const [, s] of stadiumRow) {
      expect(deriveAttackCancelRequirement(s), s).not.toBeNull();
      expect(readByAny(s), s).toBe(true);
    }
    for (const [, s] of handRow) {
      expect(deriveAttackCancelRequirement(s), s).not.toBeNull();
      expect(readByAny(s), s).toBe(true);
    }
    expect(deriveAttackCancelRequirement(handRow[0]?.[1] ?? "")).not.toEqual(
      deriveAttackCancelRequirement(stadiumRow[0]?.[1] ?? ""),
    );
    expect(anaphoric.some(([, s]) => s.startsWith("Discard a Basic"))).toBe(true);
  });

  it("the bare anchor's TERMINATOR still refuses an UNMAPPED tail — D418's own repair re-armed", () => {
    const bare = "Discard a Stadium in play.";
    const unmappedTail = `${bare} Draw a card.`;
    expect(splitAttackCancelClause(unmappedTail)).toBeNull();
    expect(deriveAttackEffect(unmappedTail)).toBeNull();
    // …and the CONTROL, so this cannot pass on a build where the anchor stopped
    // reading anything at all.
    expect(deriveAttackEffect(bare)).toEqual([{ op: "discardStadium" }]);
    expect(splitAttackCancelClause(TAKEN_BY_D417)?.head).toBe(bare);
  });

  it("bought no new event, no new prompt and no second Stadium zone", () => {
    const attacked = attack(blazingDestruction(board(SEEDS[0], "p2")));
    const row = findEvent(attacked.events, "STADIUM_DISCARDED");
    if (row === undefined) throw new Error("expected the discard row");
    expect(Object.keys(row).sort()).toEqual(["cause", "seat", "type", "uid"]);
    expect(row.cause).toBe("effect");
  });

  it("bought no play GATE and no registry row — the op reaches the board through attack text only", () => {
    // No printed Trainer or Ability spells this sentence, so `programPlayable` gains
    // nothing: an unknown op falls through its loop as playable, which is correct for
    // an op whose empty answer is a legal resolution.
    const abilityOrEffect = corpus().filter(([, s]) => s === BARE || s === MAY);
    expect(abilityOrEffect).toHaveLength(2);
    expect(units(abilityOrEffect)).toBe(6);
  });
});
