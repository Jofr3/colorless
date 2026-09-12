import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effects from "./effects";
import {
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  deriveAttackPreDamage,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";

// 0.395.0 — 🛑 **D503: THE REFUSAL OF THE PRE-DAMAGE ATTACH, WRITTEN AS RUNGS.**
//
// `censusAttackCorpus.ts` **FILE LINE 569**, 1 sentence / **1 legal printing**:
//
//   "This attack does 30 damage for each {W} Energy attached to this Pokémon.
//    Before doing damage, you may attach any number of Basic {W} Energy cards from
//    your hand to this Pokémon."
//
// The printed sentence attaches Energy BEFORE damage precisely so the attachment is
// counted by the multiplier. **It is refused, and this file is the refusal** — D428's
// rule (*a refusal written as prose rots; a refusal written as a test cannot*) and
// D468's (*when a refusal survives its third re-litigation, stop writing the paragraph
// better and spend the same effort on the assertion*).
//
// 🛑 **NOTHING HERE BUILDS ANYTHING.** No reader, no anchor, no op, no op field, no
// `FIXTURE_POOL` id, no `packages/schema` byte, no engine source at all. So (D496): the
// residue does not move, `BUILT.attack` does not move, the census stands still, there is
// no census tax, `engineVersion` stays 0.395.0 and `MATCH_RECORD_VERSION` stays 30.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🛑 THE PRICE, MEASURED AT THIS HEAD — three costs, and only the third is large.
//
//  1. **THE DESTINATION** — one optional rider. Measured below (§5): the two attach
//     ops are a PINCER. `attachFromHand { filter }` takes the printed *"any number"*
//     and has **no** destination narrowing (`AttachTargetRiders` carries
//     `targetType`/`basicOnly`/`ownerPokemon`/`benchOnly`/`bonusCounters`/`notIfKO`
//     and **no self flag**); `attachEnergyFrom` carries `toSelf` and a `count` that is
//     a `number`. Neither op has both halves of the print. Cheap in isolation.
//  2. **THE READER** — one whole-sentence anchor and a DUAL claim (the multiplier and
//     the pre-damage reader over one string). Free at the caller: `attack.ts` hands the
//     same `effect` to every reader, which is D493/D494's idiom.
//  3. 🛑 **THE SEAM** — and it is the whole refusal. The printed clause must resolve
//     BEFORE the §8.5 fold, and it PARKS (*"you may attach any number"* is declinable,
//     so the floor is 0 and `attachFromHand` parks even at ONE candidate —
//     `derivedAnyNumberAttach.test.ts` drives exactly that at `count` 1, 3 and 5).
//     `applyAttackPreDamage` returns `AttackPreDamageResult`, which its own doc block
//     says is *"not an `ApplyResult`, not a `RunResult`, not anything `settleProgram`
//     could drain"* — the park is forbidden **by the compiler**, deliberately.
//
//     Making it possible means cutting `attack()` at the pre-damage seam and
//     re-expressing the remainder as a resumable, PERSISTED continuation. Measured at
//     this head with a static scan over the function body: `attack()` spans file lines
//     **1117..3271 (2,155 lines)**; it has exactly ONE continuation point,
//     `settleProgram` in the TAIL at ~3230, so everything before it is straight-line.
//     At the shipped hook (file line 2568) **703 lines and 20 live locals** cross the
//     seam; at the earliest LEGAL park point — immediately after §8 step 3's confusion
//     check, the last thing that can still cancel the attack — **1,851 lines and 13
//     live locals** do, `events: GameEvent[]` and the mutated board among them.
//
// **AND THE PAYOFF IS 1 SENTENCE / 1 PRINTING.** D493's rule, measured over the whole
// corpus in §6: each of the three branches frees the SAME single row and nothing else,
// so they are not a fork — they are three cost lines on one invoice.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ **WHAT THIS FILE CANNOT PIN, SAID OUT LOUD** (D433: declare partial evidence as
// partial). The ordering itself — *that the §8.5 scaling fold is computed BEFORE the
// pre-damage hook runs* — is **not executable here**, because it needs one string
// claimed by a scaling reader AND by `deriveAttackPreDamage`, and §4 measures that no
// corpus sentence is. It was DRIVEN at this head instead, on a real board, with a
// temporary reader arm restored in a `finally` and the file's size and sha256 verified
// both ways:
//
//   · a temporary `deriveAttackDamageMultiplier` arm claiming corpus row 71
//     (*"Before doing damage, discard all Pokémon Tools and Special Energy from your
//     opponent's Active Pokémon."*) with `{ per: 30, count: { kind: "energyOnOpponent",
//     zone: "active", energyType: null } }`;
//   · `preDamageFamily.test.ts`'s own `armedDefender` board — the defender wears a
//     Tool, a Special Energy and a Basic Energy;
//   · result: `TOOLS_DISCARDED → ENERGY_DISCARDED → DAMAGE_DEALT { scaled: 60 }`, and
//     the defender's Energy went **2 → 1**. The hook had already discarded one Energy
//     and the fold still scored **two**.
//
// 🛑 So the hook runs after the number is fixed, and a pre-damage ATTACH would not be
// counted by the multiplier — which is the entire point of the printed sentence. That
// is D428's own claim (*"a hook placed after §8.5 would resolve, emit its event, print
// its log row and change no number"*) confirmed at a second address, and it is the
// reason this row is refused rather than built.
// ─────────────────────────────────────────────────────────────────────────────

/** 🛑 **THE SPECIMEN IS TAKEN FROM THE CORPUS, NEVER TYPED** (D452/D490: a byte pin
    measures an invention exactly as faithfully as it measures the truth). §1 asserts
    this string IS a row of `legalAttackCorpus()` and reads its printing count off the
    corpus rather than transcribing it. */
const PRINTED =
  "This attack does 30 damage for each {W} Energy attached to this Pokémon. Before doing damage, you may attach any number of Basic {W} Energy cards from your hand to this Pokémon.";

/** The compound's two segments, split at the printed `. ` join. */
const HEAD = "This attack does 30 damage for each {W} Energy attached to this Pokémon.";
const TAIL =
  "Before doing damage, you may attach any number of Basic {W} Energy cards from your hand to this Pokémon.";

/** ⚠️ **CONSTRUCTED, AND LABELLED SO** (D440: a rung over unprinted text is a claim
    about the READER, not about the pool). The printed 4-legal-printing sibling with the
    brace code the print narrows by — `deriveAttackEffect` already admits it, which is
    the whole of §3. `derivedAnyNumberAttach.test.ts` pins the same fact from the other
    end (*"the brace code is read though ZERO legal printings spell it"*). */
const TYPED_SIBLING =
  "You may attach any number of Basic {W} Energy cards from your hand to your Pokémon in any way you like.";

/** The printed 4-legal-printing sibling itself — `censusAttackCorpus.ts`'s row for
    `attachFromHand` (D247). Asserted to be a corpus row in §1. */
const BARE_SIBLING =
  "You may attach any number of Basic Energy cards from your hand to your Pokémon in any way you like.";

/** The printed `toSelf` attach — the OTHER half of §5's pincer, and a corpus row. */
const TO_SELF =
  "Attach an Energy card from your hand to this Pokémon. If you do, heal 60 damage from this Pokémon.";

type Reader = (text: string) => unknown;

/** Every `deriveAttack*` reader that claims `text`, BY NAME, run off the module surface
    rather than off a hand-kept list (D417/D418). The names are what the rungs assert,
    so a widening names itself in the failure message. */
function claimants(text: string): string[] {
  return attackReaderSurface().filter((name) => {
    const read = (effects as unknown as Record<string, Reader | undefined>)[name];
    // ⚠️ A missing lookup would answer `undefined`, and `undefined !== null` is TRUE —
    // which is exactly the failure `resolvedByAnyReader`'s own doc block predicts for a
    // name lookup (every sentence claimed, every figure moving upward at once). There
    // is no name to miss here, because the names come off the module; the throw is what
    // keeps that true rather than a comment saying so.
    if (read === undefined) throw new Error(`reader surface names a missing export: ${name}`);
    return read(text) !== null;
  });
}

const SPLITTERS = {
  splitAttackRequirementClause,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackTrailingClause,
} as const;

function splitVerdicts(text: string): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(SPLITTERS).map(([name, split]) => [name, split(text)]),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE POPULATION. Every specimen is a row of the committed corpus, or is
//      declared CONSTRUCTED. (D452/D490: assert the source, do not pin the bytes.)
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 the specimens come off the corpus", () => {
  it("🛑 the printed compound IS a corpus row, and its printing count is READ not typed", () => {
    const rows = legalAttackCorpus().filter(([, text]) => text === PRINTED);
    expect(rows).toHaveLength(1);
    // 1 legal printing. The card id is UNRESOLVED in this checkout (no D1) and is not
    // guessed (D425); the corpus FILE LINE is 569 and that is the citation (D448/D459).
    expect(rows[0]?.[0]).toBe(1);
  });

  it("the two printed siblings §3 and §5 lean on are corpus rows too", () => {
    const corpus = legalAttackCorpus();
    expect(corpus.filter(([, t]) => t === BARE_SIBLING).map(([n]) => n)).toEqual([4]);
    expect(corpus.filter(([, t]) => t === TO_SELF).map(([n]) => n)).toEqual([1]);
  });

  it("⚠️ TYPED_SIBLING is CONSTRUCTED, and the rung that uses it says so", () => {
    // D440: a rung over a sentence the pool does not print is a claim about the READER.
    // Stated as an assertion rather than as a comment, so the label cannot drift.
    expect(legalAttackCorpus().some(([, t]) => t === TYPED_SIBLING)).toBe(false);
  });

  it("the compound really is HEAD + ' ' + TAIL, byte for byte", () => {
    expect(`${HEAD} ${TAIL}`).toBe(PRINTED);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — BUILD STATE. Refused whole; the HEAD builds and is OWNED by one named
//      reader; the TAIL is refused by all thirteen.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 build state, re-derived off the module surface", () => {
  it("🛑 the printed compound is refused by ALL THIRTEEN readers and ALL FOUR splitters", () => {
    expect(attackReaderSurface()).toHaveLength(13);
    expect(claimants(PRINTED)).toEqual([]);
    expect(resolvedByAnyReader(PRINTED)).toBe(false);
    expect(splitVerdicts(PRINTED)).toEqual({
      splitAttackRequirementClause: null,
      splitAttackCancelClause: null,
      splitAttackGateClause: null,
      splitAttackTrailingClause: null,
    });
  });

  it("the HEAD builds, and exactly ONE reader owns it", () => {
    // 🛑 D438's polarity rule: name what owns it AND keep the refusals. A bare
    // `resolvedByAnyReader(HEAD) === true` is satisfied by a mistaken widening of any
    // of the other twelve; this is not.
    expect(claimants(HEAD)).toEqual(["deriveAttackDamageMultiplier"]);
    expect(deriveAttackDamageMultiplier(HEAD)).toEqual({
      per: 30,
      count: { kind: "energyOnSelf", energyType: "Water" },
    });
  });

  it("🛑 the TAIL alone is refused by all thirteen — the half the engine cannot place", () => {
    expect(claimants(TAIL)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE LATTICE. Which axes are blockers and which are FREE. Two axes carry the
//      whole refusal and the printed type token carries none of it.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 the axis lattice — the {W} filter is free, the PREFIX and the DESTINATION are not", () => {
  it("⚠️ the FILTER axis is INERT ON THE VERDICT: the shipped anchor already takes {W}", () => {
    // The printed noun *"Basic {W} Energy cards"* costs ZERO. `attachFromHand`'s
    // anchor builds its brace class out of `ENERGY_TYPE_BY_CODE`'s own keys, so the
    // typed form derives with the filter INTACT — measured, not assumed.
    expect(deriveAttackEffect(TYPED_SIBLING)).toEqual([
      { op: "attachFromHand", filter: { kind: "basicEnergy", energyType: "Water" } },
    ]);
    expect(deriveAttackEffect(BARE_SIBLING)).toEqual([
      { op: "attachFromHand", filter: { kind: "basicEnergy" } },
    ]);
  });

  it("🛑 the PREFIX axis is a blocker: 'Before doing damage, ' refuses the same act", () => {
    // One axis moved, nothing else. The act, the quantifier, the source and the
    // destination are byte-identical to `TYPED_SIBLING` above, which builds.
    const prefixed =
      "Before doing damage, you may attach any number of Basic {W} Energy cards from your hand to your Pokémon in any way you like.";
    expect(claimants(prefixed)).toEqual([]);
  });

  it("🛑 the DESTINATION axis is a blocker: 'to this Pokémon' refuses the same act", () => {
    const narrowed =
      "You may attach any number of Basic {W} Energy cards from your hand to this Pokémon.";
    expect(claimants(narrowed)).toEqual([]);
  });

  it("🛑 BUILT-BY-WEIGHT over the whole-sentence 2³: 0/1 · 0/3 · 0/3 · 0/1", () => {
    // D502's SIXTH lattice shape — empty at every weight, which is a claim about the
    // SEAM rather than about the axes. ⚠️ A Set, not an array (D502): a degenerate axis
    // would make the point set smaller than the bit set, and this table's is not.
    const prefixes = ["Before doing damage, you may attach", "You may attach"];
    const dests = ["to this Pokémon.", "to your Pokémon in any way you like."];
    const filters = ["Basic {W} Energy cards", "Basic Energy cards"];
    const points = new Set<string>();
    const builtByWeight = [0, 0, 0, 0];
    const pointsByWeight = [0, 0, 0, 0];
    for (let bits = 0; bits < 8; bits++) {
      const tail = `${prefixes[bits & 1]} any number of ${filters[(bits >> 2) & 1]} from your hand ${dests[(bits >> 1) & 1]}`;
      const point = `${HEAD} ${tail}`;
      if (points.has(point)) continue;
      points.add(point);
      const weight = (bits & 1) + ((bits >> 1) & 1) + ((bits >> 2) & 1);
      pointsByWeight[weight] = (pointsByWeight[weight] ?? 0) + 1;
      if (claimants(point).length > 0) builtByWeight[weight] = (builtByWeight[weight] ?? 0) + 1;
    }
    expect(points.size).toBe(8);
    expect(pointsByWeight).toEqual([1, 3, 3, 1]);
    expect(builtByWeight).toEqual([0, 0, 0, 0]);
    // 🛑 AND THE TAIL'S OWN 2³ IS THE INFORMATIVE ONE: `0/1 · 0/3 · 1/3 · 1/1`. The one
    // built point at weight 2 keeps the printed `{W}`, which is what makes the FILTER
    // axis inert and the other two load-bearing.
    const tailBuilt = [0, 0, 0, 0];
    for (let bits = 0; bits < 8; bits++) {
      const tail = `${prefixes[bits & 1]} any number of ${filters[(bits >> 2) & 1]} from your hand ${dests[(bits >> 1) & 1]}`;
      const weight = (bits & 1) + ((bits >> 1) & 1) + ((bits >> 2) & 1);
      if (claimants(tail).length > 0) tailBuilt[weight] = (tailBuilt[weight] ?? 0) + 1;
    }
    expect(tailBuilt).toEqual([0, 0, 1, 1]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — 🛑 THE TRIPWIRE. The composition path ALREADY EXISTS, and the only thing
//      between this corpus row and a silently wrong build is one reader's refusal.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 the trailing splitter already composes this shape — the cheap road is the trap", () => {
  it("🛑 `splitAttackTrailingClause` COMPOSES a multiplier head with an effect tail", () => {
    // D445 says the splitter composes HEAD-claimed-by-any-reader + TAIL-claimed-by
    // -`deriveAttackEffect`. That predicate is SATISFIED by this compound's shape, so
    // the seam is not what refuses it — the tail's own refusal is.
    expect(splitAttackTrailingClause(`${HEAD} ${TYPED_SIBLING}`)).toEqual({
      head: HEAD,
      tail: TYPED_SIBLING,
    });
  });

  it("🛑🛑 THE TRIPWIRE: `deriveAttackEffect` must NOT claim the printed tail", () => {
    // ⚠️ **THIS IS THE ROW'S ONE GUARD, AND IT IS ONE ARM WIDE.** Teach
    // `deriveAttackEffect` the printed tail and the splitter composes the whole printed
    // sentence for free — `BUILT.attack` steps, the residue falls by one, and every
    // census in the repo reports SUCCESS. The program it would ship was DRIVEN on a
    // real board at this head and it is wrong:
    //
    //     ATTACK_DECLARED → DAMAGE_DEALT { scaled: 60 } → EFFECT_PENDING
    //
    // The damage is dealt off the PRE-attach board and the attach parks AFTERWARDS, so
    // the printed sentence's entire mechanism is inverted and the attachment
    // contributes nothing to the number it exists to raise. On that board the correct
    // answer was 210 and the composed program answered 60.
    //
    // 🛑 That is D485's rule (*the splitter's admission test is not a licence — ask what
    // the tail refers to*) at a TIMING clause rather than at an anaphor: the words
    // *"Before doing damage"* are a constraint the composition path structurally cannot
    // honour, because `deriveAttackEffect`'s program runs at `attack()`'s TAIL. And it
    // is D190b/D199 at the instrument layer — a wrong-but-plausible program is strictly
    // worse than an unbuilt one, which at least fails loudly.
    expect(deriveAttackEffect(TAIL)).toBeNull();
    // The control on the same axis (D424): the reader still says YES to the act with
    // the timing clause removed, so this rung cannot pass by refusing everything.
    expect(deriveAttackEffect(BARE_SIBLING)).not.toBeNull();
  });

  it("⚠️ and no OTHER reader claims the tail either, so the refusal is thirteen-way", () => {
    // D438: a negative over a disjunction is a claim about EVERY disjunct. Kept
    // alongside the named claim above rather than collapsed into it.
    expect(claimants(TAIL)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE SEAM AND THE PINCER, pinned on the POPULATION rather than on a specimen.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 the seam: no printed sentence needs a pre-damage reader AND a scaling reader", () => {
  it("🛑 `deriveAttackPreDamage` claims exactly 4 sentences / 8 printings, and NONE scales", () => {
    // D423: pin an absence on the POPULATION, not on a specimen. This is the rung that
    // reddens the day somebody claims the compound — in either direction.
    const corpus = legalAttackCorpus();
    const pre = corpus.filter(([, text]) => deriveAttackPreDamage(text) !== null);
    expect(pre).toHaveLength(4);
    expect(pre.reduce((sum, [n]) => sum + n, 0)).toBe(8);
    const scaling = [
      "deriveAttackDamageBonus",
      "deriveAttackDamageMultiplier",
      "deriveAttackDamagePenalty",
    ];
    const dual = pre.filter(([, text]) => scaling.some((name) => claimants(text).includes(name)));
    expect(dual).toEqual([]);
  });

  it("⚠️ exactly ONE corpus sentence would need both, and it is this one", () => {
    const both = legalAttackCorpus().filter(
      ([, text]) => /[Bb]efore doing damage/.test(text) && /for each/i.test(text),
    );
    expect(both.map(([, text]) => text)).toEqual([PRINTED]);
  });
});

describe("§5b the destination pincer: two attach ops, neither with both halves of the print", () => {
  it("🛑 `attachFromHand` takes the unbounded count and carries NO destination", () => {
    const program = deriveAttackEffect(BARE_SIBLING);
    expect(program).toEqual([{ op: "attachFromHand", filter: { kind: "basicEnergy" } }]);
    // The op is `{ op, filter }` and nothing else — no `toSelf`, no riders. The offer
    // funnel calls `attachEnergyTargets(state, seat, {})`, so the prompt's targets are
    // the controller's WHOLE board; `derivedAnyNumberAttach.test.ts` drives that
    // directly by splitting one hand across the Active and two Benched bodies.
    expect(Object.keys(program?.[0] ?? {}).sort()).toEqual(["filter", "op"]);
  });

  it("🛑 `attachEnergyFrom` carries `toSelf` and a count that is a NUMBER", () => {
    const program = deriveAttackEffect(TO_SELF);
    expect(program).toEqual([
      { op: "attachEnergyFrom", source: "hand", anyEnergy: true, toSelf: true, healTarget: 60 },
    ]);
    // ⚠️ **THE PINCER, STATED.** `attachEnergyFrom.count` pins a BATCH to the one body
    // this op always picks and its own doc block declares it a `number` ("Absent = 1");
    // `attachFromHand`'s count is the candidate set and is unbounded by construction.
    // The printed sentence wants BOTH — an unbounded batch aimed at one named body —
    // and that is the one optional rider branch (1) of this file's header prices.
    expect(program?.[0]).toHaveProperty("toSelf", true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE BRANCH PRICING. Each branch ALONE, over the whole corpus (D493).
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 every branch frees the SAME single row, so the fork was never a fork", () => {
  it("🛑 all three branches have a SOLO payoff of 1 sentence / 1 printing — this one", () => {
    // The canonical residue predicate, copied VERBATIM from `censusAtHead.test.ts`
    // minus the registry summand, which none of these rows is in (D430: do not roll
    // your own instrument; where the list is not importable, copy the predicate).
    const residue = legalAttackCorpus()
      .filter(([, text]) => !resolvedByAnyReader(text))
      .filter(([, text]) => {
        const gate = splitAttackGateClause(text);
        if (gate !== null && gate.body !== "" && resolvedByAnyReader(gate.body)) return false;
        return splitAttackTrailingClause(text) === null;
      });

    // (A) a PARKABLE pre-damage seam.
    const branchA = residue.filter(([, t]) => /[Bb]efore doing damage/.test(t));
    // (B) a destination narrowing on the unbounded hand attach.
    const branchB = residue.filter(([, t]) => /attach[^.]*from your hand/i.test(t));
    // (C) the scaling fold recomputed after the pre-damage hook.
    const branchC = residue.filter(([, t]) => /[Bb]efore doing damage/.test(t) && /for each/i.test(t));

    for (const [label, branch] of [
      ["A", branchA],
      ["B", branchB],
      ["C", branchC],
    ] as const) {
      expect(branch.map(([, t]) => t), `branch ${label}`).toEqual([PRINTED]);
      expect(branch.reduce((sum, [n]) => sum + n, 0), `branch ${label}`).toBe(1);
    }
  });

  it("⚠️ and branch C moves ZERO shipped printings, which is what bounds its risk", () => {
    // The fold's inputs are read at DECLARATION; recomputing them after the hook can
    // only move a board on which BOTH a pre-damage reader and a scaling reader claim
    // the same string. §5 measures that population at zero, so the reorder's blast
    // radius on today's column is empty — the risk is the 2,000 lines of straight-line
    // `attack()` the PARK needs, not the fold.
    const preDamageRows = legalAttackCorpus().filter(
      ([, text]) => deriveAttackPreDamage(text) !== null,
    );
    for (const [, text] of preDamageRows) {
      expect(claimants(text), text).toEqual(["deriveAttackPreDamage"]);
    }
  });
});
