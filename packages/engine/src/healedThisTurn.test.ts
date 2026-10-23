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
import type { BoardCondition, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  HEALED_THIS_TURN_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
} from "./testFixtures";

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

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
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackDiscardScaledBoost,
];

const TAKEN = "If this Pokémon was healed during this turn, this attack does 100 more damage.";
const TAKEN_CLAUSE = "this Pokémon was healed during this turn";

const HEALED: BoardCondition = { kind: "yourActiveHealedThisTurn" };
const PROMOTED: BoardCondition = { kind: "yourActivePromotedThisTurn" };

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: HEALED_THIS_TURN_DECK, p2: HEALED_THIS_TURN_DECK },
    { first: "p2", extraDraw: { p1: 0, p2: 0 }, active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function ready(seed: number, seat: Seat = "p1"): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, "fix-lively");
  state = attachFromDeck(state, seat, "fix-grass-energy", 1);
  state = setActiveFromDeck(state, other(seat), "fix-bigbody");
  return clearBench(clearBench(state, seat), other(seat));
}

function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

const attack = (state: GameState, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index: 0 });

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function potion(
  state: GameState,
  seat: Seat,
  ref?: PokemonRef,
): { state: GameState; events: GameEvent[] } {
  const withCard = handFromDeck(state, seat, "sv01-188", 1);
  const uid = handUid(withCard, seat, "sv01-188");
  const played = mustApply(withCard, { type: "playTrainer", seat, uid });
  if (played.state.phase.kind !== "effect:choose") return played;
  const prompt = played.state.phase.prompt;
  if (prompt.kind !== "choosePokemon") throw new Error("expected a choosePokemon prompt");
  const pick = ref ?? prompt.candidates.find((c) => c.spot.spot === "active");
  if (pick === undefined) throw new Error("no candidate matched");
  const done = mustApply(played.state, {
    type: "resolveEffect",
    seat,
    choice: { kind: "pokemon", ref: pick },
  });
  return { state: done.state, events: [...played.events, ...done.events] };
}

/** Play a Picnic Basket from `seat`'s hand: `{ op: "healEachAll", amount: 30 }`, the
    ONE route in this pool that writes a stamp onto the OPPONENT's board. Never parks. */
function picnicBasket(state: GameState, seat: Seat): { state: GameState; events: GameEvent[] } {
  const withCard = handFromDeck(state, seat, "sv01-184", 1);
  const uid = handUid(withCard, seat, "sv01-184");
  return mustApply(withCard, { type: "playTrainer", seat, uid });
}

const SEEDS = [7001, 7013, 7027] as const;

describe("§1 — the price, RE-DERIVED: the residue steps, and the 2-printing band EMPTIES", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the residue goes 20 / 24 → 19 / 22, and the band it leaves behind is EMPTY", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(refused.length).toBe(0);
    expect(units(refused)).toBe(0);
    expect([refused.length + 20, units(refused) + 24]).toEqual([20, 24]);
    expect([refused.length + 21, units(refused) + 25]).toEqual([21, 25]);
    expect([refused.length + 22, units(refused) + 26]).toEqual([22, 26]);
    expect([refused.length + 24, units(refused) + 28]).toEqual([24, 28]);

    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    const band = [...byClause].filter(([, n]) => n === 2).map(([clause]) => clause);
    expect(band).toEqual([]);
    const distribution = new Map<number, number>();
    for (const n of byClause.values()) distribution.set(n, (distribution.get(n) ?? 0) + 1);
    expect([...distribution].sort((a, b) => a[0] - b[0])).toEqual([]);
    expect(byClause.size).toBe(0);
    expect([...byClause.values()]).toEqual([]);
    expect(byClause.has(TAKEN_CLAUSE)).toBe(false);
  });

  it("ONE sentence, TWO printings — and the CLAUSE is the whole population", () => {
    const records = corpus().filter(([, s]) => s === TAKEN);
    expect(records).toHaveLength(1);
    expect(units(records)).toBe(2);
    const clauseRows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TAKEN_CLAUSE);
    expect(clauseRows).toHaveLength(1);
    expect(units(clauseRows)).toBe(2);
    const anyHealed = corpus().filter(([, s]) => s.includes("healed"));
    expect(anyHealed.map(([, s]) => s)).toEqual([TAKEN]);
  });
});

describe("§2 — the reading: ONE clause row, and every other reader refuses the sentence", () => {
  it("the printed sentence reads as +100 behind the member, byte for byte", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 100,
      count: { kind: "boardCondition", cond: HEALED },
    });
  });

  it("the OTHER NINE readers refuse it — the disjointness this family rests on", () => {
    for (const read of READERS) {
      if (read === deriveAttackDamageBonus) continue;
      expect(read(TAKEN)).toBeNull();
    }
  });

  it("the note ROUND-TRIPS to the printed clause with the pronoun resolved (D116)", () => {
    // The printed subject is "this Pokémon"; a note read off the board by a person has
    // to spell it "your Active Pokémon". Everything after it is the printed clause.
    expect(conditionNote(HEALED)).toBe("your Active Pokémon was healed during this turn");
    expect(conditionNote(HEALED).endsWith("was healed during this turn")).toBe(true);
    expect(conditionNote(PROMOTED)).not.toBe(conditionNote(HEALED));
  });

  it("a NEAR-MISS spelling is refused rather than mapped", () => {
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon was healed this turn, this attack does 100 more damage.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon healed during this turn, this attack does 100 more damage.",
      ),
    ).toBeNull();
  });
});

describe("§3 — the board: the REAL printing, healed and unhealed", () => {
  it.each(SEEDS)("seed %i — an unhealed Maractus deals the printed 20", (seed) => {
    const state = ready(seed);
    const { state: after, events } = attack(state);
    expect(find(events, "DAMAGE_DEALT")?.damage).toBe(20);
    expect(after.players.p2.active?.damage).toBe(20);
    // …and the stamp really is absent rather than merely unequal.
    expect(state.players.p1.active?.healedTurn).toBeNull();
    expect(conditionHolds(state, "p1", HEALED)).toBe(false);
  });

  it.each(SEEDS)("seed %i — a Potion on the wounded Active buys the printed +100", (seed) => {
    // 50 damage on a 100 HP body: a comfortable non-lethal wound, and 30 of it comes
    // off. The Potion is played from HAND as an ordinary Item, which is the line the
    // printed card is designed for — this gate's true arm needs no constructed board.
    let state = setDamage(ready(seed), "p1", 50);
    const healed = potion(state, "p1");
    state = healed.state;
    expect(find(healed.events, "HEALED")?.amount).toBe(30);
    expect(state.players.p1.active?.damage).toBe(20);
    expect(state.players.p1.active?.healedTurn).toBe(state.turn);
    expect(conditionHolds(state, "p1", HEALED)).toBe(true);
    const { events } = attack(state);
    expect(find(events, "DAMAGE_DEALT")?.damage).toBe(120);
  });

  it.each(SEEDS)("seed %i — the two arms differ by exactly the printed 100", (seed) => {
    const base = ready(seed);
    const cold = find(attack(base).events, "DAMAGE_DEALT")?.damage ?? 0;
    const warm =
      find(attack(potion(setDamage(base, "p1", 50), "p1").state).events, "DAMAGE_DEALT")?.damage ??
      0;
    expect(warm - cold).toBe(100);
    expect([cold, warm]).toEqual([20, 120]);
  });
});

describe("§4 — a WHIFF is not a heal, and the board is ordinary", () => {
  it.each(SEEDS)(
    "seed %i — a Potion on an UNDAMAGED Active files no event and writes no stamp",
    (seed) => {
      const state = ready(seed);
      expect(state.players.p1.active?.damage).toBe(0);
      const played = potion(state, "p1");
      expect(find(played.events, "HEALED")).toBeUndefined();
      expect(played.state.players.p1.active?.healedTurn).toBeNull();
      expect(conditionHolds(played.state, "p1", HEALED)).toBe(false);
      expect(find(attack(played.state).events, "DAMAGE_DEALT")?.damage).toBe(20);
    },
  );
});

describe("§5 — the SUBJECT is 'this Pokémon', not the seat", () => {
  it.each(SEEDS)("seed %i — healing a BENCHED body leaves the Active's clause cold", (seed) => {
    let state = benchFromDeck(ready(seed), "p1", "fix-bigbody");
    state = setBenchDamage(state, "p1", 0, 50);
    const benchRef: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };
    const healed = potion(state, "p1", benchRef);
    state = healed.state;
    expect(find(healed.events, "HEALED")?.uid).toBe(benchTopUid(state, "p1", 0));
    expect(state.players.p1.bench[0]?.healedTurn).toBe(state.turn);
    // …the ACTIVE is untouched on both the field and the clause…
    expect(state.players.p1.active?.healedTurn).toBeNull();
    expect(conditionHolds(state, "p1", HEALED)).toBe(false);
    // …and the PER-SEAT reading, computed here beside the member off the same board,
    // disagrees — which is the whole content of the shape decision.
    const perSeatReading =
      state.players.p1.active?.healedTurn === state.turn ||
      state.players.p1.bench.some((b) => b.healedTurn === state.turn);
    expect(perSeatReading).toBe(true);
    expect(perSeatReading).not.toBe(conditionHolds(state, "p1", HEALED));
    expect(find(attack(state).events, "DAMAGE_DEALT")?.damage).toBe(20);
  });

  it.each(SEEDS)(
    "seed %i — the stamp SURVIVES the bench→Active move, and so does the clause",
    (seed) => {
      let state = benchFromDeck(ready(seed), "p1", "fix-lively");
      state = setBenchDamage(state, "p1", 0, 50);
      const benchRef: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };
      state = potion(state, "p1", benchRef).state;
      const healedUid = benchTopUid(state, "p1", 0);
      // The retreat cost is paid by the {G} `ready` attached to the body that is
      // LEAVING — the one card on this board that is not the subject of anything here.
      const paying = state.players.p1.active?.energy ?? [];
      expect(paying).toHaveLength(1);
      state = mustApply(state, {
        type: "retreat",
        seat: "p1",
        discardEnergy: [...paying],
        promoteBenchIndex: 0,
      }).state;
      expect(activeUid(state, "p1")).toBe(healedUid);
      expect(state.players.p1.active?.healedTurn).toBe(state.turn);
      expect(state.players.p1.active?.promotedTurn).toBe(state.turn);
      expect(conditionHolds(state, "p1", HEALED)).toBe(true);
      expect(conditionHolds(state, "p1", PROMOTED)).toBe(true);
    },
  );
});

describe("§6 — the CLOCK: a turn STAMP expires by arithmetic, with no boundary clear", () => {
  it.each(SEEDS)("seed %i — healed on this turn, cold on the NEXT one this seat owns", (seed) => {
    let state = setDamage(ready(seed), "p1", 50);
    state = potion(state, "p1").state;
    const healedOn = state.turn;
    expect(state.players.p1.active?.healedTurn).toBe(healedOn);
    expect(conditionHolds(state, "p1", HEALED)).toBe(true);
    // Round-trip to P1's next turn. Nothing walks the board at a turn boundary and
    // nothing clears the field — the comparison is what expires.
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    expect(state.turn).toBeGreaterThan(healedOn);
    expect(state.players.p1.active?.healedTurn).toBe(healedOn);
    expect(conditionHolds(state, "p1", HEALED)).toBe(false);
    expect(find(attack(state).events, "DAMAGE_DEALT")?.damage).toBe(20);
  });
});

describe("§7 — the SEAT: the arm reads the ASKER's Active, on a board that can tell", () => {
  it.each(SEEDS)("seed %i — P2's own Maractus collects the +100 on P2's turn", (seed) => {
    // The mirror of §3, one seat over. `ready` opens P2's turn for this case, so a
    // build that hard-coded `p1` reads a cold clause here and deals 20.
    let state = setDamage(ready(seed, "p2"), "p2", 50);
    state = potion(state, "p2").state;
    expect(conditionHolds(state, "p2", HEALED)).toBe(true);
    expect(conditionHolds(state, "p1", HEALED)).toBe(false);
    expect(find(attack(state, "p2").events, "DAMAGE_DEALT")?.damage).toBe(120);
  });

  it.each(SEEDS)(
    "seed %i — a CROSS-BOARD heal stamps the opponent, and expires before they can ask",
    (seed) => {
      let state = ready(seed);
      state = setActiveFromDeck(state, "p2", "fix-lively");
      state = attachFromDeck(state, "p2", "fix-grass-energy", 1);
      state = setDamage(state, "p2", 50);
      const played = picnicBasket(state, "p1");
      state = played.state;
      const p1Turn = state.turn;
      expect(state.players.p2.active?.healedTurn).toBe(p1Turn);
      // …and inside P1's own turn the clause is TRUE for P2, which is correct and
      // unobservable: P2 cannot attack during P1's turn.
      expect(conditionHolds(state, "p2", HEALED)).toBe(true);
      // Hand the turn over. `state.turn` advances, so the stamp P1 wrote reads FALSE for
      // the seat that owns the body — which is the printed reading of "this turn".
      state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
      expect(state.turn).toBeGreaterThan(p1Turn);
      expect(state.players.p2.active?.healedTurn).toBe(p1Turn);
      expect(conditionHolds(state, "p2", HEALED)).toBe(false);
      expect(find(attack(state, "p2").events, "DAMAGE_DEALT")?.damage).toBe(20);
    },
  );
});
