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
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  TYPE_SHARE_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
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
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackBonusConsequent,
];

const TAKEN =
  "If any of your Pokémon in play are the same type as any of your opponent's Pokémon in play, this attack does 120 more damage.";
const TAKEN_CLAUSE =
  "any of your Pokémon in play are the same type as any of your opponent's Pokémon in play";

const SHARED: BoardCondition = { kind: "inPlayTypesIntersect" };

function typesInPlay(state: GameState, seat: Seat): string[][] {
  const side = state.players[seat];
  return [side.active, ...side.bench].flatMap((p) => {
    if (p === null) return [];
    const top = p.stack.at(-1);
    const card = top === undefined ? undefined : state.cardPool[state.cardIdByUid[top] ?? ""];
    return [card?.types ?? []];
  });
}

/** WRONG READING A — only the two ACTIVE bodies are consulted. */
function activesOnly(state: GameState, seat: Seat): boolean {
  const own = state.players[seat].active;
  const theirs = state.players[seat === "p1" ? "p2" : "p1"].active;
  if (own === null || theirs === null) return false;
  const [mine] = typesInPlay(state, seat);
  const [yours] = typesInPlay(state, seat === "p1" ? "p2" : "p1");
  return (mine ?? []).some((t) => (yours ?? []).includes(t));
}

/** WRONG READING B — the two `types` ARRAYS compared for equality. Green on every
    single-type board, which is every board the catalog can build. */
function arraysEqual(state: GameState, seat: Seat): boolean {
  const mine = typesInPlay(state, seat);
  const theirs = typesInPlay(state, seat === "p1" ? "p2" : "p1");
  return mine.some((a) =>
    theirs.some((b) => a.length === b.length && a.every((t, i) => t === b[i])),
  );
}

/** WRONG READING C — only `types[0]` on each body. Agrees with the member unless
    the shared type sits SECOND in some array. */
function firstTypeOnly(state: GameState, seat: Seat): boolean {
  const mine = typesInPlay(state, seat);
  const theirs = typesInPlay(state, seat === "p1" ? "p2" : "p1");
  return mine.some((a) => theirs.some((b) => a[0] !== undefined && a[0] === b[0]));
}

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: TYPE_SHARE_DECK, p2: TYPE_SHARE_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because the member
    is seat-relative and every board case below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

function ready(seed: number, seat: Seat = "p1", oppActive = "fix-bigbody"): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, "fix-typeshare");
  state = attachFromDeck(state, seat, "fix-energy", 1);
  state = setActiveFromDeck(state, other(seat), oppActive);
  return clearBench(clearBench(state, seat), other(seat));
}

function benched(state: GameState, seat: Seat, ...ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) next = benchFromDeck(next, seat, id);
  return next;
}

/** Attack index 0 from `seat` and report the damage actually dealt. */
function damageDealt(state: GameState, seat: Seat = "p1"): number {
  const after = mustApply(state, { type: "attack", seat, index: 0 });
  const dealt = after.events.find((e: GameEvent) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

function pushOnBench(state: GameState, seat: Seat, index: number, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  const body = side.bench[index];
  if (uid === undefined) throw new Error(`${seat} deck has no ${cardId}`);
  if (body === undefined) throw new Error(`${seat} has no benched Pokémon at ${index}`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        bench: side.bench.map((p, i) => (i === index ? { ...p, stack: [...p.stack, uid] } : p)),
      },
    },
  };
}

function emptyActive(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  if (side.active === null) return state;
  const returned = [...side.active.stack, ...side.active.energy, ...side.active.tools];
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: null, deck: [...side.deck, ...returned] },
    },
  };
}

describe("§1 — the price, RE-DERIVED: the residue, the band and the `needs` column", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the residue steps by exactly this sentence, and the 2-printing band by one", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(refused.length).toBe(0);
    expect(units(refused)).toBe(0);
    expect(refused.length + 23).toBe(23);
    expect(units(refused) + 27).toBe(27);
    expect(refused.length + 24).toBe(24);
    expect(units(refused) + 29).toBe(29);
    expect(refused.length + 25).toBe(25);
    expect(units(refused) + 32).toBe(32);
    expect(refused.length + 27).toBe(27);
    expect(units(refused) + 34).toBe(34);
    expect(refused.length + 28).toBe(28);
    expect(units(refused) + 36).toBe(36);
    expect(refused.length + 30).toBe(30);
    expect(units(refused) + 38).toBe(38);

    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    const band = [...byClause].filter(([, n]) => n === 2).map(([clause]) => clause);
    expect(band).toEqual([]);
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([]);
    expect(byClause.size).toBe(0);
    expect(band.length + 2).toBe(2);
    expect(band.length + 3).toBe(3);
    expect(band.length + 4).toBe(4);
    expect(band.length + 5).toBe(5);
    expect([...byClause.values()]).toEqual([]);
  });

  it("the taken sentence is 2 legal printings, and that is ALL of them", () => {
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(2);
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
  });

  it("the `needs` column: NO existing member answers this, and the near ones DISAGREE", () => {
    const state = benched(ready(6400), "p2", "fix-fairybody");
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    // Same FIELD, one body, wrong side of the table: their ACTIVE is Colorless.
    expect(conditionHolds(state, "p1", { kind: "opponentActiveHasType", type: "Fairy" })).toBe(
      false,
    );
    // Same FIELD, one body, right side, wrong zone: YOUR Bench is empty.
    expect(conditionHolds(state, "p1", { kind: "yourBenchHasType", type: "Fairy" })).toBe(false);
    // The two CROSS-BOARD members: both compare SCALARS on NAMED bodies, and
    // neither can see a type at all. `handSizesEqual` is a coincidence of the deal
    // and is asserted only to show it is not this clause's answer.
    expect(conditionHolds(state, "p1", { kind: "activeEnergyCountsEqual" })).toBe(false);
    // …and the whole reason no widening was priced: this member quantifies over
    // Active + Bench on BOTH seats. Moving the Fairy body to YOUR Bench keeps this
    // member's answer the same while every member above answers differently.
    const mirrored = benched(ready(6401), "p1", "fix-fairybody");
    expect(conditionHolds(mirrored, "p1", SHARED)).toBe(false);
    expect(conditionHolds(mirrored, "p1", { kind: "yourBenchHasType", type: "Fairy" })).toBe(true);
  });
});

describe("§2 — the LITERAL row: 120 from the sentence, and the near misses stay LOUD", () => {
  it("maps the printed sentence onto the new member at the printed 120", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: SHARED },
    });
  });

  it("takes N FROM THE SENTENCE, not from the card", () => {
    for (const per of [10, 30, 250]) {
      expect(
        deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does ${per} more damage.`),
      ).toEqual({ per, count: { kind: "boardCondition", cond: SHARED } });
    }
    // A printed 0 adds nothing — the guard every arm in this family carries, so the
    // sentence stays LOUD rather than deriving a no-op bonus.
    expect(
      deriveAttackDamageBonus(`If ${TAKEN_CLAUSE}, this attack does 0 more damage.`),
    ).toBeNull();
  });

  it("pins the BYTES — a lookalike character would un-map the clause silently", () => {
    // 125 code points; the clause inside it is 87. The é in "Pokémon" is the
    // character this rung exists for — two UTF-8 bytes, one code point, and a
    // decomposed spelling would read identically in a diff.
    expect(TAKEN.length).toBe(125);
    expect(TAKEN_CLAUSE.length).toBe(87);
    expect(TAKEN).toContain("é");
    expect(TAKEN).not.toContain("́");
    expect(TAKEN).toContain("opponent's");
    expect(TAKEN).not.toContain("’");
    // "in play" is printed TWICE and both are load-bearing (§4).
    expect(TAKEN_CLAUSE.split("in play")).toHaveLength(3);
  });

  it("D137's fold reaches this row — a CURLED re-ingest still lands on the member", () => {
    const curled = TAKEN.replace("opponent's", "opponent’s");
    expect(curled).not.toBe(TAKEN);
    expect(deriveAttackDamageBonus(curled)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: SHARED },
    });
  });

  it("refuses CONSTRUCTED rewrites of the clause — the key is char-for-char", () => {
    for (const clause of [
      "any of your Pokémon are the same type as any of your opponent's Pokémon",
      // One "in play" dropped, each side in turn.
      "any of your Pokémon in play are the same type as any of your opponent's Pokémon",
      "any of your Pokémon are the same type as any of your opponent's Pokémon in play",
      // The NARROWING §4 refutes on a board, spelled as a sentence nobody printed.
      "any of your Pokémon in play are the same type as your opponent's Active Pokémon",
      // The seat collapsed — one side named twice.
      "any of your Pokémon in play are the same type as any of your Pokémon in play",
      // The quantifier changed: a UNIVERSAL is the case §15b had to CHOOSE about,
      // and it is not this sentence.
      "all of your Pokémon in play are the same type as any of your opponent's Pokémon in play",
      // The verb changed.
      "any of your Pokémon in play have the same type as any of your opponent's Pokémon in play",
      // De-accented: the exact silent failure the byte guard above exists for.
      "any of your Pokemon in play are the same type as any of your opponent's Pokemon in play",
    ]) {
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does 120 more damage.`),
        clause,
      ).toBeNull();
    }
  });

  it("keeps the outer anchor guards on this sentence too", () => {
    for (const text of [
      // Lowercase leading "if" — the matcher has no /i.
      `if ${TAKEN_CLAUSE}, this attack does 120 more damage.`,
      // No trailing period is not the whole sentence.
      `If ${TAKEN_CLAUSE}, this attack does 120 more damage`,
      // A real trailing clause pins `$`.
      `If ${TAKEN_CLAUSE}, this attack does 120 more damage. Then, draw a card.`,
      // Leading text pins `^`.
      `Flip a coin. If ${TAKEN_CLAUSE}, this attack does 120 more damage.`,
      // The "×"/multiply twin, which `deriveAttackDamageMultiplier` owns.
      `If ${TAKEN_CLAUSE}, this attack does 120 damage.`,
    ]) {
      expect(deriveAttackDamageBonus(text), text).toBeNull();
    }
  });

  it("the two CROSS-BOARD siblings still answer their own sentences", () => {
    expect(
      deriveAttackDamageBonus(
        "If you have the same number of cards in your hand as your opponent, this attack does 90 more damage.",
      ),
    ).toEqual({ per: 90, count: { kind: "boardCondition", cond: { kind: "handSizesEqual" } } });
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached, this attack does 100 more damage.",
      ),
    ).toEqual({
      per: 100,
      count: { kind: "boardCondition", cond: { kind: "activeEnergyCountsEqual" } },
    });
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a Dragon Pokémon, this attack does 90 more damage.",
      ),
    ).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveHasType", type: "Dragon" } },
    });
  });
});

describe("§3 — the note: VERBATIM, and the first cross-board one that round-trips BOTH ways", () => {
  it("round-trips to the printed BYTES *and* to the member", () => {
    expect(conditionNote(SHARED)).toBe(TAKEN_CLAUSE);
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(SHARED)}, this attack does 120 more damage.`),
    ).toEqual({ per: 120, count: { kind: "boardCondition", cond: SHARED } });
  });

  it("…and the two NEIGHBOURS deliberately do NOT, which is why this is stated", () => {
    const energy: BoardCondition = { kind: "activeEnergyCountsEqual" };
    expect(conditionNote(energy)).not.toBe(
      "this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached",
    );
    const bench: BoardCondition = { kind: "yourBenchHasType", type: "Metal" };
    expect(conditionNote(bench)).toBe("you have any Metal Pokémon on your Bench");
    expect(conditionNote(bench)).not.toContain("{M}");
  });
});

describe("§4 — the ZONE: 'in play' is BOTH sides, and each half is its own refutation", () => {
  it("the base board shares NO type — the printed base and nothing more", () => {
    // A FAIRY attacker against a COLORLESS `fix-bigbody`, both benches empty. If
    // this were TRUE every rung below would be worthless.
    const state = ready(6410);
    expect(state.players.p1.bench).toHaveLength(0);
    expect(state.players.p2.bench).toHaveLength(0);
    expect(conditionHolds(state, "p1", SHARED)).toBe(false);
    expect(activesOnly(state, "p1")).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("the ATTACKER's OWN type counts — Active against Active, 10 + 120", () => {
    const state = ready(6411, "p1", "fix-bigfairy");
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    expect(activesOnly(state, "p1")).toBe(true);
    expect(damageDealt(state)).toBe(130);
  });

  it("THEIR BENCH is in play — an opponent-Active-only reading MISSES it", () => {
    // Their Active is Colorless and their BENCH holds the Fairy body. The member
    // pays; the narrowed reading does not, on the same board.
    const state = benched(ready(6412), "p2", "fix-fairybody");
    expect(state.players.p2.bench).toHaveLength(1);
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    expect(activesOnly(state, "p1")).toBe(false);
    expect(damageDealt(state)).toBe(130);
  });

  it("YOUR BENCH is in play — a your-Active-only reading MISSES it", () => {
    // The mirror half, and it needs a different type: the attacker is Fairy, so the
    // match has to come off a benched COLORLESS body meeting the Colorless
    // `fix-bigbody` across the table.
    const state = benched(ready(6413), "p1", "fix-benchfiller");
    expect(state.players.p1.bench).toHaveLength(1);
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    expect(activesOnly(state, "p1")).toBe(false);
    expect(damageDealt(state)).toBe(130);
  });

  it("BENCH against BENCH — neither Active is involved at all", () => {
    // Both halves narrowed at once: a Metal body on each Bench, a Fairy attacker,
    // a Colorless defender. This is the board that separates the member from a
    // build that got ONE of the two spreads right.
    let state = benched(ready(6414), "p1", "fix-metalbody");
    state = benched(state, "p2", "fix-metalbody");
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    expect(activesOnly(state, "p1")).toBe(false);
    expect(damageDealt(state)).toBe(130);
  });

  it("a body of the WRONG type on either Bench arms nothing", () => {
    // The complement of the three rungs above: benching bodies that share no type
    // leaves the clause false, so "any Bench body at all" is refuted too.
    let state = benched(ready(6415), "p1", "fix-metalbody");
    state = benched(state, "p2", "fix-water-basic");
    expect(state.players.p1.bench).toHaveLength(1);
    expect(state.players.p2.bench).toHaveLength(1);
    expect(conditionHolds(state, "p1", SHARED)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });
});

describe("§5 — the INTERSECTION: the dual-type boards, and nothing else can see them", () => {
  it("DUAL vs SINGLE — an ARRAY EQUALITY answers FALSE and the member TRUE", () => {
    let state = benched(ready(6420), "p1", "fix-dualbody");
    state = benched(state, "p2", "fix-water-basic");
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    expect(arraysEqual(state, "p1")).toBe(false);
    expect(damageDealt(state)).toBe(130);
  });

  it("DUAL vs SINGLE on the SECOND member — a `types[0]` reading answers FALSE", () => {
    // The same fixture against `["Metal"]`: Metal sits SECOND in `["Water",
    // "Metal"]`, so a build that compared first elements misses it. A board that
    // used Water instead would leave that build green.
    let state = benched(ready(6421), "p1", "fix-dualbody");
    state = benched(state, "p2", "fix-metalbody");
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    expect(firstTypeOnly(state, "p1")).toBe(false);
    // …and the equality reading misses it too, for the other reason.
    expect(arraysEqual(state, "p1")).toBe(false);
    expect(damageDealt(state)).toBe(130);
  });

  it("the two wrong readings are NOT always false — the control board", () => {
    const shared = ready(6422, "p1", "fix-bigfairy");
    expect(conditionHolds(shared, "p1", SHARED)).toBe(true);
    expect(arraysEqual(shared, "p1")).toBe(true);
    expect(firstTypeOnly(shared, "p1")).toBe(true);
    // …and on the base board all three agree FALSE.
    const apart = ready(6423);
    expect(conditionHolds(apart, "p1", SHARED)).toBe(false);
    expect(arraysEqual(apart, "p1")).toBe(false);
    expect(firstTypeOnly(apart, "p1")).toBe(false);
  });

  it("DUAL against DUAL meets on BOTH members, and one match is enough", () => {
    // The printed word is "any": a single shared member arms it, and a body that
    // carries two does not arm it twice.
    let state = benched(ready(6424), "p1", "fix-dualbody");
    state = benched(state, "p2", "fix-dualbody");
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    expect(arraysEqual(state, "p1")).toBe(true);
    expect(damageDealt(state)).toBe(130);
  });

  it("ONE match among MANY is enough — an existential on each side", () => {
    // Three bodies benched on each side and exactly one pair meets, in the LAST
    // slot on both — a reader that stopped at slot 0 would answer FALSE.
    let state = benched(ready(6425), "p1", "fix-benchfiller", "fix-water-basic", "fix-metalbody");
    state = benched(state, "p2", "fix-fairybody", "fix-bigfairy", "fix-metalbody");
    expect(state.players.p1.bench).toHaveLength(3);
    expect(state.players.p2.bench).toHaveLength(3);
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    expect(damageDealt(state)).toBe(130);
  });
});

describe("§6 — the boundaries: the empty set, the stack TOP, the seat, and the corpus", () => {
  it("an EMPTY side is FALSE, and §15b says that is FORCED rather than chosen", () => {
    const shared = ready(6430, "p1", "fix-bigfairy");
    expect(conditionHolds(shared, "p1", SHARED)).toBe(true);
    const noneOfMine = emptyActive(shared, "p1");
    expect(noneOfMine.players.p1.active).toBeNull();
    expect(noneOfMine.players.p1.bench).toHaveLength(0);
    expect(conditionHolds(noneOfMine, "p1", SHARED)).toBe(false);
    expect(conditionHolds(noneOfMine, "p2", SHARED)).toBe(false);
    const noneOfTheirs = emptyActive(shared, "p2");
    expect(conditionHolds(noneOfTheirs, "p1", SHARED)).toBe(false);
    expect(conditionHolds(noneOfTheirs, "p2", SHARED)).toBe(false);
    // …and an empty side does not become true by the OTHER side being large.
    const stacked = benched(emptyActive(shared, "p2"), "p1", "fix-fairybody", "fix-metalbody");
    expect(conditionHolds(stacked, "p1", SHARED)).toBe(false);
  });

  it("the identity is the STACK TOP (§1.2) — an evolution DISARMS it", () => {
    // A Metal body on each Bench arms the clause; pushing a Fairy card onto MY
    // benched body makes it a Fairy Pokémon and the shared type is gone. Reading
    // `stack[0]` would still answer Metal and keep paying.
    let state = benched(ready(6431), "p1", "fix-metalbody");
    state = benched(state, "p2", "fix-metalbody");
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    state = pushOnBench(state, "p1", 0, "fix-fairybody");
    expect(state.players.p1.bench[0]?.stack).toHaveLength(2);
    expect(conditionHolds(state, "p1", SHARED)).toBe(false);
    expect(damageDealt(state)).toBe(10);
  });

  it("…and an evolution ARMS it, which is the same read from the other end", () => {
    // The mirror: a Metal body on my Bench and a Colorless `fix-bigbody` across the
    // table share nothing, until a Colorless card is pushed onto my benched body.
    let state = benched(ready(6432), "p1", "fix-metalbody");
    expect(conditionHolds(state, "p1", SHARED)).toBe(false);
    state = pushOnBench(state, "p1", 0, "fix-benchfiller");
    expect(conditionHolds(state, "p1", SHARED)).toBe(true);
    expect(damageDealt(state)).toBe(130);
  });

  it("SEAT-SYMMETRIC: the same board answers the same for both seats", () => {
    for (const seed of [6440, 6441, 6442, 6443]) {
      const apart = ready(seed);
      expect(conditionHolds(apart, "p1", SHARED), `${seed} apart`).toBe(
        conditionHolds(apart, "p2", SHARED),
      );
      const meeting = benched(ready(seed + 10), "p2", "fix-fairybody");
      expect(conditionHolds(meeting, "p1", SHARED), `${seed} meeting`).toBe(
        conditionHolds(meeting, "p2", SHARED),
      );
      expect(conditionHolds(meeting, "p2", SHARED), `${seed} meeting p2`).toBe(true);
    }
  });

  it("answers from BOTH seats on a real attack — it reads the board, not p1's", () => {
    // A p2 attacker pays the same +120, which is what tells "reads both sides"
    // apart from "reads p1's side and p2's side" spelled the wrong way round.
    const state = benched(ready(6450, "p2"), "p1", "fix-fairybody");
    expect(state.players.p1.bench).toHaveLength(1);
    expect(conditionHolds(state, "p2", SHARED)).toBe(true);
    expect(damageDealt(state, "p2")).toBe(130);
  });

  it("the corpus totals STAND STILL — this slice adds no catalog row", () => {
    expect(corpus().length).toBe(640);
    expect(units(corpus())).toBe(1732);
  });
});
