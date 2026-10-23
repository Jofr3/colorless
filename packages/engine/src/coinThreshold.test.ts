import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  parseAttackDamage,
  programFor,
  splitAttackTrailingClause,
} from "./index";
import type { GameEvent, GameState } from "./index";
import {
  COIN_THRESHOLD_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

const EITHER_HEADS =
  "Flip 2 coins. This attack does 90 damage for each heads. If either of them is heads, your opponent's Active Pokémon is now Paralyzed.";
const BOTH_TAILS =
  "Flip 2 coins. This attack does 90 damage for each heads. If both of them are tails,  your opponent's Active Pokémon is now Confused.";
const AT_LEAST_TWO =
  "Flip 4 coins. This attack does 60 damage for each heads. If at least 2 of them are heads, your opponent's Active Pokémon is now Paralyzed.";

/** The three attack indices on `fix-threshflip`, in printed order. */
const EITHER = 0;
const BOTH = 1;
const AT_LEAST = 2;

const SEEDS = 24;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: COIN_THRESHOLD_DECK, p2: COIN_THRESHOLD_DECK },
    { first: "p2", active: { p1: "fix-titan", p2: "fix-titan" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The threshold attacker in P1's Active Spot with two {C} paid — enough for all
    three printed costs. SURGERY, for `multiCoinFlip.test.ts`'s reason: a swept seed
    cannot be relied on to deal any particular body. */
function attacker(state: GameState): GameState {
  return attachFromDeck(setActiveFromDeck(state, "p1", "fix-threshflip"), "p1", "fix-energy", 2);
}

/** Therapeutic Energy `sv02-193` on the DEFENDER — the §12 immunity control. Its
    passive lists `asleep`, `confused` AND `paralyzed`, so one attached card drives
    the gate against index 0's Paralysis and index 1's Confusion alike. */
function immuneDefender(state: GameState): GameState {
  return attachFromDeck(state, "p2", "sv02-193", 1);
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** The heads count off the EMITTED rows, so every assertion below is a claim about
    what the engine reported doing rather than about a recomputed rng. */
function headsIn(events: GameEvent[]): number {
  return all(events, "ATTACK_EFFECT_COIN_FLIP").filter((e) => e.result === "heads").length;
}

/** The defender's rotation slot — the one `applyStatus` writes for Paralysis and
    Confusion. Read off the BOARD, so a "nothing happened" case is a comparison and
    not an inference from a missing event. */
function rotationOf(state: GameState): string | undefined {
  return state.players.p2.active?.conditions.rotation;
}

const NO_ROTATION = "none";

describe("§1 — the three sentences are CORPUS ROWS, and the fixture is them", () => {
  it("each is in `legalAttackCorpus()` at its measured printing count", () => {
    const corpus = new Map(legalAttackCorpus().map(([units, text]) => [text, units]));
    expect(corpus.get(EITHER_HEADS)).toBe(2); // file line 214
    expect(corpus.get(BOTH_TAILS)).toBe(1); // file line 213
    expect(corpus.get(AT_LEAST_TWO)).toBe(1);
    expect([3, 2 + 1 + 1]).toEqual([3, 4]);
  });

  it("BOTH_TAILS carries TWO spaces after `tails,` and that is the catalog's", () => {
    expect(BOTH_TAILS).toContain("are tails,  your opponent");
    expect(BOTH_TAILS).not.toContain("are tails, your opponent");
  });

  it("matches FIXTURE_POOL char-for-char at all three indices", () => {
    const attacks = FIXTURE_POOL["fix-threshflip"]?.attacks ?? [];
    expect(attacks[EITHER]?.effect).toBe(EITHER_HEADS);
    expect(attacks[BOTH]?.effect).toBe(BOTH_TAILS);
    expect(attacks[AT_LEAST]?.effect).toBe(AT_LEAST_TWO);
    expect(parseAttackDamage(attacks[EITHER]?.damage)).toEqual({ base: 90, modifier: "×" });
    expect(parseAttackDamage(attacks[BOTH]?.damage)).toEqual({ base: 90, modifier: "×" });
    expect(parseAttackDamage(attacks[AT_LEAST]?.damage)).toEqual({ base: 60, modifier: "×" });
    expect(programFor("fix-threshflip")).toBeUndefined();
  });
});

describe("§2 — the reader: three printed predicates, ONE parameterised comparison", () => {
  it("reads all three to their exact values", () => {
    expect(deriveAttackCoinFlip(EITHER_HEADS)).toEqual({
      kind: "perHeadsThenThreshold",
      flips: { kind: "printed", count: 2 },
      per: 90,
      threshold: { face: "heads", atLeast: 1 },
      ops: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
    });
    expect(deriveAttackCoinFlip(BOTH_TAILS)).toEqual({
      kind: "perHeadsThenThreshold",
      flips: { kind: "printed", count: 2 },
      per: 90,
      threshold: { face: "tails", atLeast: 2 },
      ops: [{ op: "applyStatus", target: "defender", status: "confused" }],
    });
    expect(deriveAttackCoinFlip(AT_LEAST_TWO)).toEqual({
      kind: "perHeadsThenThreshold",
      flips: { kind: "printed", count: 4 },
      per: 60,
      threshold: { face: "heads", atLeast: 2 },
      ops: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
    });
  });

  it("`both … are tails` is NOT normalised to `zero heads`, and the value says so", () => {
    const both = deriveAttackCoinFlip(BOTH_TAILS);
    expect(both).toHaveProperty("threshold.face", "tails");
    expect(both).not.toHaveProperty("threshold.face", "heads");
    // …and it is NOT `{ face: "heads", atLeast: 0 }`, which would be satisfied by
    // every outcome including two heads — the arithmetic a careless normalisation
    // reaches for.
    expect(both).not.toHaveProperty("threshold.atLeast", 0);
  });

  it("is ONE shape with the discriminator as a FIELD — five keys, no member per predicate", () => {
    const value = deriveAttackCoinFlip(AT_LEAST_TWO);
    if (value === null) throw new Error("unreachable");
    expect(Object.keys(value).sort()).toEqual(["flips", "kind", "ops", "per", "threshold"]);
    if (value.kind !== "perHeadsThenThreshold") throw new Error("unreachable");
    expect(Object.keys(value.threshold).sort()).toEqual(["atLeast", "face"]);
    const bare = deriveAttackCoinFlip("Flip 2 coins. This attack does 90 damage for each heads.");
    if (bare === null) throw new Error("unreachable");
    expect(Object.keys(bare).sort()).toEqual(["flips", "kind", "per"]);
    expect(bare.kind).toBe("perHeads");
  });

  it("is PARAMETERISED in every axis the pool varies — 240 combinations, zero rows", () => {
    const STATUSES = [
      ["Asleep", "asleep"],
      ["Burned", "burned"],
      ["Confused", "confused"],
      ["Paralyzed", "paralyzed"],
      ["Poisoned", "poisoned"],
    ] as const;
    let seen = 0;
    for (const flips of [2, 3, 4]) {
      for (const per of [10, 60, 90, 120]) {
        for (const face of ["heads", "tails"] as const) {
          for (const [word, status] of STATUSES) {
            for (const atLeast of [1, 2]) {
              const text = `Flip ${flips} coins. This attack does ${per} damage for each heads. If at least ${atLeast} of them are ${face}, your opponent's Active Pokémon is now ${word}.`;
              expect(deriveAttackCoinFlip(text)).toEqual({
                kind: "perHeadsThenThreshold",
                flips: { kind: "printed", count: flips },
                per,
                threshold: { face, atLeast },
                ops: [{ op: "applyStatus", target: "defender", status }],
              });
              seen += 1;
            }
          }
        }
      }
    }
    expect(seen).toBe(240);
  });

  it("reads the CURLY apostrophe too, like every status anchor in this file", () => {
    // `DEFENDER_NOW` has spelled `['’]` since M3 and this anchor reuses the habit
    // rather than inventing a narrower one. The catalog prints ASCII today; a
    // swsh-era reprint that does not is admitted by construction.
    expect(deriveAttackCoinFlip(EITHER_HEADS.replace("opponent's", "opponent’s"))).toEqual(
      deriveAttackCoinFlip(EITHER_HEADS),
    );
  });

  it("the published pattern's OWN EDGE: `(?:is|are)` admits an ungrammatical spelling", () => {
    expect(deriveAttackCoinFlip(EITHER_HEADS.replace("of them is", "of them are"))).toEqual(
      deriveAttackCoinFlip(EITHER_HEADS),
    );
    expect(legalAttackCorpus().some(([, s]) => s.includes("either of them are"))).toBe(false);
  });
});

describe("§3 — the guards, every one driven", () => {
  it("`flips >= 2` — the regex's own `coins` is PLURAL", () => {
    for (const n of [0, 1]) {
      expect(
        deriveAttackCoinFlip(
          `Flip ${n} coins. This attack does 90 damage for each heads. If at least 1 of them are heads, your opponent's Active Pokémon is now Paralyzed.`,
        ),
      ).toBeNull();
    }
  });

  it("`flips <= MAX_PRINTED_FLIPS` — the ingested-text ceiling, at 10", () => {
    const at = (n: number) =>
      `Flip ${n} coins. This attack does 90 damage for each heads. If at least 2 of them are heads, your opponent's Active Pokémon is now Paralyzed.`;
    expect(deriveAttackCoinFlip(at(10))).not.toBeNull();
    expect(deriveAttackCoinFlip(at(11))).toBeNull();
    expect(deriveAttackCoinFlip(at(1000000))).toBeNull();
  });

  it("`per >= 1` — a printed 0 would spend the flips to add nothing", () => {
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. This attack does 0 damage for each heads. If either of them is heads, your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. This attack does 1 damage for each heads. If either of them is heads, your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).not.toBeNull();
  });

  it("`atLeast >= 1` — a threshold of ZERO is met by every outcome", () => {
    // This member's own guard, and it is `per >= 1` asked of the other number: a
    // printed "if at least 0 of them are heads" is not a conditional at all, and
    // admitting it would ship an unconditional status wearing an `if`.
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. This attack does 90 damage for each heads. If at least 0 of them are heads, your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).toBeNull();
  });

  it("`atLeast <= flips` — a threshold ABOVE the flip count can NEVER be met", () => {
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. This attack does 90 damage for each heads. If at least 3 of them are heads, your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).toBeNull();
    // …and the boundary one below it reads, so the guard is `<=` and not `<`.
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. This attack does 90 damage for each heads. If at least 2 of them are heads, your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).not.toBeNull();
  });

  it("`either` and `both` are TWO-COIN WORDS — the grammar guard", () => {
    for (const word of ["either of them is", "both of them are"]) {
      for (const flips of [3, 4, 10]) {
        expect(
          deriveAttackCoinFlip(
            `Flip ${flips} coins. This attack does 90 damage for each heads. If ${word} heads, your opponent's Active Pokémon is now Paralyzed.`,
          ),
        ).toBeNull();
      }
    }
    expect(
      deriveAttackCoinFlip(
        "Flip 4 coins. This attack does 60 damage for each heads. If at least 1 of them are heads, your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).not.toBeNull();
  });

  it("refuses a status word outside the closed vocabulary, and a missing consequent", () => {
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. This attack does 90 damage for each heads. If either of them is heads, your opponent's Active Pokémon is now Frozen.",
      ),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. This attack does 90 damage for each heads. If either of them is heads, this Pokémon is now Confused.",
      ),
    ).toBeNull();
    // A face outside the two the coin has.
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. This attack does 90 damage for each heads. If either of them is edges, your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).toBeNull();
  });
});

describe("§4 — disjointness: one reader owns the sentence, and the coin is taken ONCE", () => {
  it("the HEAD alone is still `perHeads` and the whole sentence is not", () => {
    for (const [whole, head] of [
      [EITHER_HEADS, "Flip 2 coins. This attack does 90 damage for each heads."],
      [BOTH_TAILS, "Flip 2 coins. This attack does 90 damage for each heads."],
      [AT_LEAST_TWO, "Flip 4 coins. This attack does 60 damage for each heads."],
    ] as const) {
      expect(deriveAttackCoinFlip(head)?.kind).toBe("perHeads");
      expect(deriveAttackCoinFlip(whole)?.kind).toBe("perHeadsThenThreshold");
    }
  });

  it("`deriveAttackEffect` refuses the whole sentence AND the tail — so the coin is not flipped twice", () => {
    for (const text of [EITHER_HEADS, BOTH_TAILS, AT_LEAST_TWO]) {
      expect(deriveAttackEffect(text)).toBeNull();
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
    }
    for (const tail of [
      "If either of them is heads, your opponent's Active Pokémon is now Paralyzed.",
      "If both of them are tails,  your opponent's Active Pokémon is now Confused.",
      "If at least 2 of them are heads, your opponent's Active Pokémon is now Paralyzed.",
    ]) {
      expect(deriveAttackEffect(tail)).toBeNull();
    }
  });

  it("the trailing splitter refuses all three — and now by the SHADOW REFUSAL", () => {
    for (const text of [EITHER_HEADS, BOTH_TAILS, AT_LEAST_TWO]) {
      expect(splitAttackTrailingClause(text)).toBeNull();
      expect(resolvedByAnyReader(text)).toBe(true);
    }
  });

  it("the ops are the SHIPPED status op, byte-identical to the bare sentence's", () => {
    const bare = deriveAttackEffect("Your opponent's Active Pokémon is now Paralyzed.");
    const value = deriveAttackCoinFlip(EITHER_HEADS);
    if (value === null || value.kind !== "perHeadsThenThreshold") throw new Error("unreachable");
    expect(value.ops).toEqual(bare);
  });
});

describe("§5 — the board: `per × heads` with the base DROPPED, and the status iff the threshold holds", () => {
  it("index 0 (`either … heads`) — 0 / 90 / 180, and Paralysis on every outcome but zero", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { state: done, events } = mustApply(attacker(board(seed)), {
        type: "attack",
        seat: "p1",
        index: EITHER,
      });
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(2);
      const heads = headsIn(events);
      seen.add(heads);
      expect(done.players.p2.active?.damage).toBe(90 * heads);
      expect(done.players.p2.active?.damage).not.toBe(90 * heads + 90);
      // THE THRESHOLD: `count(heads) >= 1`.
      expect(rotationOf(done)).toBe(heads >= 1 ? "paralyzed" : NO_ROTATION);
      expect(types(events).includes("STATUS_APPLIED")).toBe(heads >= 1);
      expect(types(events)).not.toContain("KNOCKED_OUT");
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it("index 1 (`both … tails`) — the status lands on the outcome that deals NO damage", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { state: done, events } = mustApply(attacker(board(seed)), {
        type: "attack",
        seat: "p1",
        index: BOTH,
      });
      const heads = headsIn(events);
      const tails = all(events, "ATTACK_EFFECT_COIN_FLIP").length - heads;
      seen.add(heads);
      expect(done.players.p2.active?.damage).toBe(90 * heads);
      expect(rotationOf(done)).toBe(tails >= 2 ? "confused" : NO_ROTATION);
      if (heads === 0) {
        expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
        expect(rotationOf(done)).toBe("confused");
      }
      // …and the turn still ends, because an attack that dealt nothing was USED.
      expect(types(events)).toContain("TURN_ENDED");
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it("index 2 (`at least 2 … heads`) — four flips, five outcomes, the threshold at 2", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { state: done, events } = mustApply(attacker(board(seed)), {
        type: "attack",
        seat: "p1",
        index: AT_LEAST,
      });
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(4);
      const heads = headsIn(events);
      seen.add(heads);
      expect(done.players.p2.active?.damage).toBe(60 * heads);
      // The whole content of `atLeast: 2` — one head is NOT enough, two is.
      expect(rotationOf(done)).toBe(heads >= 2 ? "paralyzed" : NO_ROTATION);
      // 340 HP survives the all-heads 240, so every seed measures damage rather
      // than a Knock Out.
      expect(types(events)).not.toContain("KNOCKED_OUT");
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("reports base 0 and the whole fold through `scaled` on the DAMAGE_DEALT row", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { events } = mustApply(attacker(board(seed)), {
        type: "attack",
        seat: "p1",
        index: EITHER,
      });
      const heads = headsIn(events);
      seen.add(heads);
      const damage = find(events, "DAMAGE_DEALT");
      if (heads === 0) {
        expect(damage).toBeUndefined();
        continue;
      }
      expect(damage?.base).toBe(0);
      expect(damage?.dealt).toBe(90 * heads);
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it("the whole printed sentence is SIMULATED — no ATTACK_EFFECT_SKIPPED row", () => {
    for (const index of [EITHER, BOTH, AT_LEAST]) {
      const { events } = mustApply(attacker(board(0)), { type: "attack", seat: "p1", index });
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });
});

describe("§6 — the §12 IMMUNITY gate, driven: a refused status must not silently succeed", () => {
  it("Therapeutic Energy on the defender turns the landed status into STATUS_PREVENTED", () => {
    const seenParalysis = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { state: done, events } = mustApply(immuneDefender(attacker(board(seed))), {
        type: "attack",
        seat: "p1",
        index: EITHER,
      });
      const heads = headsIn(events);
      seenParalysis.add(heads);
      // The DAMAGE is untouched — an immunity is about the condition, not the hit.
      expect(done.players.p2.active?.damage).toBe(90 * heads);
      // …and the condition NEVER lands, on any outcome.
      expect(rotationOf(done)).toBe(NO_ROTATION);
      expect(types(events)).not.toContain("STATUS_APPLIED");
      expect(types(events).includes("STATUS_PREVENTED")).toBe(heads >= 1);
      const prevented = find(events, "STATUS_PREVENTED");
      if (heads >= 1) {
        expect(prevented?.status).toBe("paralyzed");
        expect(prevented?.seat).toBe("p2");
      }
    }
    expect([...seenParalysis].sort()).toEqual([0, 1, 2]);
  });

  it("the CONFUSION half of the same gate, on the zero-heads outcome", () => {
    // Index 1's threshold fires on two TAILS, so this drives the immunity gate on
    // the board where the attack deals no damage at all — the one place a "nothing
    // happened" and a "refused" would otherwise look identical.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { state: done, events } = mustApply(immuneDefender(attacker(board(seed))), {
        type: "attack",
        seat: "p1",
        index: BOTH,
      });
      const heads = headsIn(events);
      seen.add(heads);
      expect(rotationOf(done)).toBe(NO_ROTATION);
      expect(types(events).includes("STATUS_PREVENTED")).toBe(heads === 0);
      if (heads === 0) expect(find(events, "STATUS_PREVENTED")?.status).toBe("confused");
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });
});

describe("§7 — the record-shape derivation, made rather than inherited", () => {
  it("`MATCH_RECORD_VERSION` STAYS 29 — TWO independent arguments, both driven", () => {
    for (const text of [EITHER_HEADS, BOTH_TAILS, AT_LEAST_TWO]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("driven over the SERIALIZED BYTES, in three directions", () => {
    const { state: done } = mustApply(attacker(board(0)), {
      type: "attack",
      seat: "p1",
      index: EITHER,
    });
    const bytes = JSON.stringify(done);
    // (a) FORWARD — the CONSEQUENCE is in the bytes, so this is not a vacuous grep
    //     over a state that records nothing at all.
    expect(bytes).toContain("paralyzed");
    // (b) ABSENCE — neither the op nor the member reaches them. An op that had
    //     parked would put the literal `"applyStatus"` into `phase.cont`.
    expect(bytes).not.toContain("applyStatus");
    expect(bytes).not.toContain("perHeadsThenThreshold");
    expect(bytes).not.toContain("atLeast");
    const roundTripped = JSON.parse(bytes) as GameState;
    expect(roundTripped.players.p2.active?.conditions.rotation).toBe("paralyzed");
    expect(roundTripped.players.p2.active?.damage).toBe(done.players.p2.active?.damage);
  });
});
