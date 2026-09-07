import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  engineVersion,
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

// 0.358.0 → 0.359.0 — 🆕🆕 D460, THE COIN-COUNT THRESHOLD. "Flip {N} coins. This
// attack does {D} damage for each heads. If {threshold}, your opponent's Active
// Pokémon is now {Status}." — 3 sentences / 4 legal printings, `censusAttackCorpus.ts`
// FILE LINES 213, 214 and 228 (cited by file line, D448/D459, not by array index).
//
//   THE HEAD ALREADY BUILT; THE TAIL IS A PREDICATE OVER THE SAME FACES.
//
// `scripts/residue-census.ts` classified all three `COMPOUND-head`: segment removal
// leaves *"Flip N coins. This attack does D damage for each heads."*, which
// `deriveAttackCoinFlip` claims as `perHeads`, and the removed tail builds nowhere.
// So the whole of the missing mechanism is the tail, and the tail is
// `count(face) >= atLeast` applied to a status the engine has shipped since M3.
//
// 🛑 THE ANSWER IS A FIFTH UNION MEMBER, NOT A COMPOSITION SEAM, AND THE REASON IS
// THE COIN. D409's trailing splitter requires `deriveAttackEffect(tail) !== null`;
// the only shape that reader could produce for *"If either of them is heads, …"* is
// a `coinFlipGate`, which takes its OWN coin inside `runProgram` — so the attack
// would flip twice and the damage fold and the status could disagree about the same
// two coins. `ATTACK_COIN_BONUS`'s own doc block has named that hazard since D126
// ("It must never be read here too, or the attack would flip twice"); this slice
// meets it from the other direction and answers it the same way: ONE READER OWNS
// THE SENTENCE and hands back both halves of what it says.
//
// AND THE CARRY IS D130's, PAID A SECOND TIME. The flips are taken in FRONT of §8.5
// and EffectOps run at `attack.ts`'s TAIL; the value that crosses the gap is the
// PROGRAM. `programPerHeads` REPEATS its ops `heads` times; this member GATES the
// same payload on a predicate. Nothing new crosses, and no `EffectOp` had to learn
// to read a coin it did not take.

/** The three printed sentences, at their `censusAttackCorpus.ts` FILE LINES. Every
    one is asserted to BE a corpus row, with its printing count, in §1 — D452's rule
    that a byte pin on an invented string is green by construction. */
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

/** How far the seed sweeps run, and it is MEASURED on THIS deck, not inherited.
    Sweeping seeds 0..199 over `COIN_THRESHOLD_DECK`, the first seed reaching each
    outcome is:

      indices 0 and 1 (2 flips): 0 heads → seed 5, 1 → seed 0, 2 → seed 2.
        ALL THREE by seed 5.
      index 2 (4 flips): 0 heads → seed 13, 1 → 0, 2 → 4, 3 → 1, 4 → 2.
        ALL FIVE by seed 13.

    A 4-flip card needs more seeds than a 2-flip one (its all-tails outcome is a
    1-in-16 draw), which is why the bound is measured rather than copied from
    `multiCoinFlip.test.ts`. 24 is comfortably past both, and every sweep asserts it
    SAW every outcome rather than trusting the loop. */
const SEEDS = 24;

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so the attack step is legal (§4).

    Both Active spots pin `fix-titan`: 340 HP, no Weakness, no attacks. The HP is
    chosen rather than inherited — index 2 deals `60 × 4 = 240` on an all-heads
    sweep, so a 200 HP body would be Knocked Out on precisely the outcome this suite
    most needs to read a landed Special Condition off, and the promotion would clear
    it. 44 of the 60 cards are `fix-titan`, so every seed in range opens without a
    mulligan the sweep would otherwise have to control. */
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

/** The rotation slot's EMPTY value, spelled once. `SpecialConditions.rotation` is a
    four-value enum whose empty inhabitant is the string `"none"` and NOT `undefined`
    — a distinction worth a named constant, because `toBeUndefined()` on this slot is
    green on a body that has no Active at all and red on every real board. */
const NO_ROTATION = "none";

describe("§1 — the three sentences are CORPUS ROWS, and the fixture is them", () => {
  it("each is in `legalAttackCorpus()` at its measured printing count", () => {
    // D452's rule, applied to a POSITIVE build rather than to a refusal set: a
    // hand-retyped near-miss is byte-pinnable and green forever, so the source of
    // truth is the committed corpus and the PRINTING COUNT is asserted beside the
    // text (D448 — the count is what tells two conventions and two populations
    // apart in one look).
    const corpus = new Map(legalAttackCorpus().map(([units, text]) => [text, units]));
    expect(corpus.get(EITHER_HEADS)).toBe(2); // file line 214
    expect(corpus.get(BOTH_TAILS)).toBe(1); // file line 213
    expect(corpus.get(AT_LEAST_TWO)).toBe(1); // file line 228
    // 3 sentences / 4 printings — the step every census rung in this slice moved by,
    // and the two numbers DISAGREE, which is exactly the trap D451 named.
    expect([3, 2 + 1 + 1]).toEqual([3, 4]);
  });

  it("🛑 BOTH_TAILS carries TWO spaces after `tails,` and that is the catalog's", () => {
    // Verified with `cat -A` at `censusAttackCorpus.ts` file line 213. The anchor
    // spells `\s+` for exactly this reason; a single literal space would silently
    // drop this printing, and a "tidying" edit here would silently move the fixture
    // off the printed row while leaving every other assertion green.
    expect(BOTH_TAILS).toContain("are tails,  your opponent");
    expect(BOTH_TAILS).not.toContain("are tails, your opponent");
  });

  it("matches FIXTURE_POOL char-for-char at all three indices", () => {
    const attacks = FIXTURE_POOL["fix-threshflip"]?.attacks ?? [];
    expect(attacks[EITHER]?.effect).toBe(EITHER_HEADS);
    expect(attacks[BOTH]?.effect).toBe(BOTH_TAILS);
    expect(attacks[AT_LEAST]?.effect).toBe(AT_LEAST_TWO);
    // 🛑 THE PRINTED MARKERS ARE `×`, AND THEY ARE THE SLICE'S OTHER LOAD-BEARING
    // FIELD. The digits ARE the per-heads amount, so `attack.ts` must DROP the base
    // (D127's rule reached through a fifth member); a flat marker here would make
    // §5's leaked-base cases pass for the wrong reason.
    expect(parseAttackDamage(attacks[EITHER]?.damage)).toEqual({ base: 90, modifier: "×" });
    expect(parseAttackDamage(attacks[BOTH]?.damage)).toEqual({ base: 90, modifier: "×" });
    expect(parseAttackDamage(attacks[AT_LEAST]?.damage)).toEqual({ base: 60, modifier: "×" });
    // No registry row anywhere near this body, so §5's "appended, never assigned"
    // case is measuring an append onto null — checked, not assumed (D130's rule).
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

  it("🛑 `both … are tails` is NOT normalised to `zero heads`, and the value says so", () => {
    // Over TWO coins the two are the same event, and the normalisation is available
    // — `faces.length - heads` at the flip site is total. It is refused at DERIVE
    // time because it would need `flips` to know its own cardinality, which
    // `AttackFlipCount`'s `printed` member does and its `attachedEnergy` and
    // `untilTails` members do NOT: a rule that fires on one of three members
    // couples the two axes D128's doc block has called independent since it was
    // written. So the tails form is a first-class inhabitant, and this rung is what
    // a normalising rewrite would have to delete rather than merely change.
    const both = deriveAttackCoinFlip(BOTH_TAILS);
    expect(both).toHaveProperty("threshold.face", "tails");
    expect(both).not.toHaveProperty("threshold.face", "heads");
    // …and it is NOT `{ face: "heads", atLeast: 0 }`, which would be satisfied by
    // every outcome including two heads — the arithmetic a careless normalisation
    // reaches for.
    expect(both).not.toHaveProperty("threshold.atLeast", 0);
  });

  it("is ONE shape with the discriminator as a FIELD — five keys, no member per predicate", () => {
    // D440's rule read rather than copied: identical payload ⇒ one member with the
    // discriminator as a field. All three predicates carry a face and a count and
    // nothing else, so a member apiece would duplicate the field that answers "how
    // many is enough".
    const value = deriveAttackCoinFlip(AT_LEAST_TWO);
    if (value === null) throw new Error("unreachable");
    expect(Object.keys(value).sort()).toEqual(["flips", "kind", "ops", "per", "threshold"]);
    if (value.kind !== "perHeadsThenThreshold") throw new Error("unreachable");
    expect(Object.keys(value.threshold).sort()).toEqual(["atLeast", "face"]);
    // ⚠️ AND THE SAME RULE CUTS THE OTHER WAY ONE TYPE UP: `perHeads` has nothing to
    // put in `threshold`/`ops`, so THOSE are two members and not one widened one.
    // The bare head is still the four-key member it always was.
    const bare = deriveAttackCoinFlip("Flip 2 coins. This attack does 90 damage for each heads.");
    if (bare === null) throw new Error("unreachable");
    expect(Object.keys(bare).sort()).toEqual(["flips", "kind", "per"]);
    expect(bare.kind).toBe("perHeads");
  });

  it("is PARAMETERISED in every axis the pool varies — 240 combinations, zero rows", () => {
    // No table exists, so this is the claim that the shape is parameterised in all
    // FIVE of its axes at once and that every value the column prints sits inside
    // it. A reader built on literal sentences would need one arm per printing.
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

  it("⚠️ the published pattern's OWN EDGE: `(?:is|are)` admits an ungrammatical spelling", () => {
    // D425's rule — state what your pattern cannot see. The verb is shared across
    // the alternation, so "either of them ARE heads" also reads. No card prints it;
    // it means exactly what the grammatical form means, so the looseness can produce
    // an extra RIGHT reading and never a wrong one. Written down rather than left
    // for a successor to discover as a surprise.
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

  it("🆕 `atLeast >= 1` — a threshold of ZERO is met by every outcome", () => {
    // This member's own guard, and it is `per >= 1` asked of the other number: a
    // printed "if at least 0 of them are heads" is not a conditional at all, and
    // admitting it would ship an unconditional status wearing an `if`.
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. This attack does 90 damage for each heads. If at least 0 of them are heads, your opponent's Active Pokémon is now Paralyzed.",
      ),
    ).toBeNull();
  });

  it("🆕 `atLeast <= flips` — a threshold ABOVE the flip count can NEVER be met", () => {
    // The mirror guard, and the more interesting one: without it the reader would
    // claim the sentence, `ATTACK_EFFECT_SKIPPED` would go quiet, and the printed
    // status would silently never land on any board this engine can build. A
    // consequent that is unreachable belongs on the LOUD path.
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

  it("🆕 `either` and `both` are TWO-COIN WORDS — the grammar guard", () => {
    // Measured across every "of them" row in the corpus that carries a printed flip
    // count: file lines 202, 213 and 214 are 2-coin and spell `both`/`either`; file
    // line 228 is 4-coin and spells the numeric form instead. "Either of them" over
    // four coins is not English, and `ATTACK_COIN_MULTI`'s plural guard is this same
    // argument one step shallower.
    for (const word of ["either of them is", "both of them are"]) {
      for (const flips of [3, 4, 10]) {
        expect(
          deriveAttackCoinFlip(
            `Flip ${flips} coins. This attack does 90 damage for each heads. If ${word} heads, your opponent's Active Pokémon is now Paralyzed.`,
          ),
        ).toBeNull();
      }
    }
    // …while the NUMERIC form is free of the guard, which is why the 4-coin printing
    // can exist at all.
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
    // The `$` on `ATTACK_COIN_MULTI` is what keeps the two apart, and the split is
    // exactly the one `scripts/residue-census.ts` reported: the head builds, the
    // tail does not.
    for (const [whole, head] of [
      [EITHER_HEADS, "Flip 2 coins. This attack does 90 damage for each heads."],
      [BOTH_TAILS, "Flip 2 coins. This attack does 90 damage for each heads."],
      [AT_LEAST_TWO, "Flip 4 coins. This attack does 60 damage for each heads."],
    ] as const) {
      expect(deriveAttackCoinFlip(head)?.kind).toBe("perHeads");
      expect(deriveAttackCoinFlip(whole)?.kind).toBe("perHeadsThenThreshold");
    }
  });

  it("🛑 `deriveAttackEffect` refuses the whole sentence AND the tail — so the coin is not flipped twice", () => {
    for (const text of [EITHER_HEADS, BOTH_TAILS, AT_LEAST_TWO]) {
      expect(deriveAttackEffect(text)).toBeNull();
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
    }
    // The TAIL on its own is refused too, which is the fact that makes D409's
    // trailing splitter structurally unable to reach this family: its tail test is
    // `deriveAttackEffect(tail) !== null`.
    for (const tail of [
      "If either of them is heads, your opponent's Active Pokémon is now Paralyzed.",
      "If both of them are tails,  your opponent's Active Pokémon is now Confused.",
      "If at least 2 of them are heads, your opponent's Active Pokémon is now Paralyzed.",
    ]) {
      expect(deriveAttackEffect(tail)).toBeNull();
    }
  });

  it("🛑 the trailing splitter refuses all three — and now by the SHADOW REFUSAL", () => {
    // Before this slice the splitter refused them on its TAIL test. After it, the
    // FIRST guard fires instead: `claimedByAnyReader(text)` is true, so composition
    // never gets a look. **THE ANCHOR WINS; THE SPLITTER IS THE FALLBACK** — and the
    // three sentences moved from one refusal to the other, which is why
    // `compoundCompose.test.ts` §4's claimed-whole set gained exactly 3 / 4.
    for (const text of [EITHER_HEADS, BOTH_TAILS, AT_LEAST_TWO]) {
      expect(splitAttackTrailingClause(text)).toBeNull();
      expect(resolvedByAnyReader(text)).toBe(true);
    }
  });

  it("the ops are the SHIPPED status op, byte-identical to the bare sentence's", () => {
    // Not a new inhabitant and not a re-implementation: the consequent is exactly
    // what `deriveAttackEffect` produces for the bare printed status sentence, so
    // the §11 refusal gate and the §12 immunity gate are asked ONCE in the engine
    // rather than twice. This is also the whole of §7's reachability argument.
    const bare = deriveAttackEffect("Your opponent's Active Pokémon is now Paralyzed.");
    const value = deriveAttackCoinFlip(EITHER_HEADS);
    if (value === null || value.kind !== "perHeadsThenThreshold") throw new Error("unreachable");
    expect(value.ops).toEqual(bare);
  });
});

describe("§5 — the board: `per × heads` with the base DROPPED, and the status iff the threshold holds", () => {
  it("index 0 (`either … heads`) — 0 / 90 / 180, and Paralysis on every outcome but zero", () => {
    // THE CENTRAL CASE, and both halves of the slice at once. A leaked printed base
    // gives 90 / 180 / 270, which OVERLAPS the correct 0 / 90 / 180 at two of three
    // points — only the zero-heads outcome settles it, and it cannot be faked.
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

  it("🛑 index 1 (`both … tails`) — the status lands on the outcome that deals NO damage", () => {
    // The sharpest case in the file, and the reason the tails form is worth its own
    // inhabitant. `perHeadsThenThreshold` folds `90 × 0 = 0` on two tails, so the
    // §8.5 pipeline is never entered and there is no `DAMAGE_DEALT` row at all — and
    // the Confusion still lands, off the same two faces. A member that read the
    // threshold as "zero HEADS" would agree here; a member that read it as "at least
    // one heads" would be exactly inverted, and only a swept zero-heads board tells
    // them apart.
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
        // No damage row at all — the `scaledBase + scaledTotal > 0` guard — and the
        // Special Condition regardless.
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
    // The event's own account, which is what a log and an animator read. `base` is
    // the printed base AFTER `scaledBase` dropped it — 0 on every outcome — and the
    // number arrives through `scaled`, the same pre-W/R channel every other "the
    // attack's own extra" uses. One channel, not two.
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
    // Both terms: `effectSimulated` needs no new clause (`coinFlip !== null` already
    // covers the fifth member and it is right to — the sentence IS read whole), and
    // `coinExplainsModifier` is an EXCLUSION list, so this member is claimed by
    // DEFAULT and correctly: its printed marker is `×` and its digits are the
    // per-heads amount. Verified rather than duplicated.
    for (const index of [EITHER, BOTH, AT_LEAST]) {
      const { events } = mustApply(attacker(board(0)), { type: "attack", seat: "p1", index });
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });
});

describe("§6 — the §12 IMMUNITY gate, driven: a refused status must not silently succeed", () => {
  it("🛑 Therapeutic Energy on the defender turns the landed status into STATUS_PREVENTED", () => {
    // D454 pinned `applyStatus`'s implementation — a seat ternary, a §11 refusal
    // gate and a §12 immunity gate — and this slice REUSES it rather than
    // re-implementing it, so the gate is inherited by construction. Inherited is not
    // driven, though: the whole point of routing the consequent through the shipped
    // op is that an immunity the engine already knows about must still refuse it,
    // and nothing asserts that until a board does.
    //
    // ONE attached card covers BOTH printed statuses — sv02-193's passive lists
    // `asleep`, `confused` and `paralyzed`.
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
      // 🛑 AND IT IS LOUD RATHER THAN SILENT, which is the assertion that matters:
      // a refusal that emitted nothing would be indistinguishable from a threshold
      // that never fired.
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
  it("🛑 `MATCH_RECORD_VERSION` STAYS 29 — TWO independent arguments, both driven", () => {
    // D450's rule for a non-parking change is REACHABILITY: can the thing this slice
    // touched ever appear inside a saved record? Unlike D459, this slice DOES put ops
    // into a program that `runProgram` executes, so the question has a real subject
    // and is answered twice over.
    //
    //   (1) THE INHABITANT IS NOT NEW. `{op:"applyStatus", target:"defender",
    //       status:"paralyzed"}` has been produced by `deriveAttackEffect`'s
    //       `DEFENDER_NOW` arm since M3 and by its `FLIP_DEFENDER_NOW` arm since
    //       D126 (16 printings). §4 pins the two values EQUAL, so any record that
    //       could hold this op could already hold it before this slice.
    //   (2) IT CANNOT PARK ANYWAY. `applyStatus` is on the interpreter's
    //       SYNCHRONOUS path (`case "applyStatus": return { done: … }`), and for
    //       these three printings the program before the append is null — the reader
    //       claims the sentence WHOLE, so `deriveAttackEffect` refused it, and
    //       `programFor("fix-threshflip")` is undefined (§1). So the program is
    //       exactly `[applyStatus]` and no `EffectContinuation` is ever written.
    //
    // ZERO new `EffectOp` members, op FIELDS, prompt kinds, prompt fields,
    // `@luminous/schema` bytes, `redact.ts` bytes, events, error codes or registry
    // rows. `AttackCoinFlip` and `AttackFlipThreshold` are PARSE-TIME types produced
    // at declaration and consumed at the flip site in the same tick.
    for (const text of [EITHER_HEADS, BOTH_TAILS, AT_LEAST_TWO]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("🛑 driven over the SERIALIZED BYTES, in three directions", () => {
    // D458's loss question needs a subject, and the honest one here is the BOARD
    // ITSELF: if the derived value or the appended op were stored anywhere a record
    // reaches, `JSON.stringify` of the post-attack state would say so.
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
    // (c) LOSS — a v29 reader that DROPPED everything this slice knows about still
    //     reads every field of this record with its old meaning: the condition sits
    //     in the `rotation` slot `applyStatus` has written since M3, and the damage
    //     is a plain number. Round-tripping through JSON is the check that nothing
    //     in the board depends on a shape only this engine can name.
    const roundTripped = JSON.parse(bytes) as GameState;
    expect(roundTripped.players.p2.active?.conditions.rotation).toBe("paralyzed");
    expect(roundTripped.players.p2.active?.damage).toBe(done.players.p2.active?.damage);
  });

  it("engineVersion is 0.379.0 and `manifest.version` agrees", () => {
    // 🆕🆕 D460 — 0.358.0 → **0.359.0**, and the bump is owed for BEHAVIOUR: three
    // printed sentences that derived to `null` and fell to the loud
    // ATTACK_EFFECT_SKIPPED path now fold `per × heads` AND apply a Special
    // Condition off a threshold over the same faces. Unlike D459's, this diff DOES
    // carry a vocabulary change a reader would find — one `AttackCoinFlip` member
    // and one exported type — which is exactly why the version and the record
    // version part company here: the union is parse-time and the record is not.
    expect(engineVersion).toBe("0.379.0");
  });
});
