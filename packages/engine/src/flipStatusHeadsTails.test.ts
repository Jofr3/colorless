import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { EffectOp } from "./effects";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import { applyAction, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  DEFENDER_STATUS_PAIR_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.375.0 → 0.376.0 — 🆕🆕 D478, THE OTHER BRANCH OF A GATE THAT ALREADY SHIPS.
// *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned.
// If tails, your opponent's Active Pokémon is now Confused."* — `censusAttackCorpus.ts`
// **FILE LINE 263**, **1 sentence / 2 legal printings** — ONE `coinFlipGate` with BOTH
// arms filled, through ONE new anchor and ONE new `deriveAttackEffect` arm.
//
// 🛑 **WHAT THIS SLICE IS ACTUALLY ABOUT IS A REFUSAL WHOSE STATED MECHANISM WAS 209
// DECISIONS OLD.** D424 measured this row, named it, and left it LOUD with the reason
// *"a heads/tails compound with a DIFFERENT tail. `coinFlipGate` carries no tails
// branch, so this needs a mechanism neither anchor has."* Every clause after the first
// is false, and it was false **on the day it was written**:
//
//   • `coinFlipGate.otherwise?: EffectOp[]` shipped at **D269** (`0.184.0 → 0.185.0`,
//     Picnicker `svp-114` and Drasna `sv08-173`/`-231`);
//   • `interpreter.ts` splices it through the SAME `runProgram` `unshift` that splices
//     `then` — one line, `op.otherwise ?? []`;
//   • and `deriveAttackEffect` **arm 6d** (`FLIP_KO_ACTIVE_OR_BENCHED_BASIC`, D416, 4
//     printings) has emitted a two-armed gate from this very function since before
//     D424 wrote the sentence — three hundred lines below the comment that said the
//     mechanism was absent.
//
// ⚠️ **THE TWO KINDS OF DOUBT ARE NOT SYMMETRIC (D473).** A wrong PRICE makes a slice
// look expensive and somebody re-measures it. A wrong EXPRESSIBILITY doubt moves a row
// from the shortlist to the blocked list, and nothing re-reads the blocked list. This
// row sat there for 54 decisions with the cheapest possible build waiting behind it.
//
// ⚠️ **ZERO NEW MECHANISM, MEASURED RATHER THAN BOASTED (§6, §7).** No new `EffectOp`
// member, op FIELD, op VALUE, reader (the surface stands still at 13), prompt, choice,
// event, error code, registry row, `FIXTURE_POOL` id, `packages/schema` byte,
// `redact.ts` byte — and **no `interpreter.ts` byte and no `attack.ts` byte**.
//
// ⚠️ **THE CARRIERS ARE UNRESOLVED AND SAID SO (D425).** The row has 2 legal printings
// and this checkout has no D1, so the demonstrator is `fix-glimmora` RE-TEXTED on a
// per-board `cardPool` clone (D414). That fixture already prints this sentence's HEADS
// ARM as its own whole attack, which is exactly why it is the right body: the printed
// difference between the two is the tails branch and nothing else. The STRING is the
// corpus row byte for byte (§1); nothing else about the body is transcription.

/** Corpus FILE LINE 263, byte for byte. ⚠️ THE APOSTROPHES ARE ASCII U+0027 and the `é`
    is U+00E9 — asserted in §1 off the corpus rather than eyeballed. */
const PRINTED =
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused.";

/** The two shipped sentences whose programs this slice's two ARMS are, byte for byte —
    corpus FILE LINE 262 (`fix-glimmora`'s own printed attack, 1 printing) and the bare
    single status (4 printings). They are here so §2 can assert the JOIN rather than
    describe it: if either sibling arm's program moves, the equality reddens and §7's
    version argument is owed a re-read. */
const HEADS_ARM_ALONE =
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned.";
const TAILS_ARM_ALONE = "Your opponent's Active Pokémon is now Confused.";

/** 🛑 **THE ONE REMAINING PRINTED HEADS/TAILS COMPOUND IN THE WHOLE COLUMN** — corpus
    FILE LINE 268, 2 printings — and the subject three refusal slots were re-pointed
    onto when this slice built line 263 (`defenderStatusPair.test.ts`'s `LEFT_LOUD`,
    `checkup.test.ts`'s null list, and §5 below).

    ⚠️ Its blocker is a SEAM and not a vocabulary: *"If tails, this attack does
    nothing."* is an attack-level CANCEL that `deriveAttackCoinFlip` reads as
    `{kind:"cancelOnTails"}` when it stands alone, and it resolves at the §8 declaration
    gate — where `deriveAttackEffect`, which runs at `attack()`'s TAIL after §8.5, has
    nowhere to put it. No widening of any anchor in this family can reach it, which is
    what makes it a durable witness rather than a treadmill. **It is load-bearing in
    three files; a successor who builds it owes the re-point (D467).** */
const STILL_LOUD_COMPOUND =
  "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.";

/** 🛑 CONSTRUCTED, AND SAID OUT LOUD (D440/D462's standing). §2 measures that this
    anchor has NO printed near miss — every single-axis loosening still claims exactly
    one row — so its `^…$` discipline can only ever be driven synthetically. An
    assertion with no printing behind it is a deliberate choice; an undeclared one reads
    as an accident. ⚠️ **Each differs from `PRINTED` on exactly ONE axis (D427)**, so
    each says something about which feature did the refusing. */
const CONSTRUCTED_MISSES = [
  // (a) the TAILS slot holds a word that is not a Special Condition
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Tired.",
  // (b) leading text before the flip — the `^` is what refuses it
  "This attack does nothing. Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused.",
  // (c) the tails clause names the ATTACKER's body — a subject this arm cannot mean
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, this Pokémon is now Confused.",
  // (d) the faces printed the other way round — measured at ZERO rows in §3
  "Flip a coin. If tails, your opponent's Active Pokémon is now Paralyzed and Poisoned. If heads, your opponent's Active Pokémon is now Confused.",
  // (e) the heads pair joined by a comma rather than by ` and ` — the pair's own vocabulary refuses it
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, Poisoned. If tails, your opponent's Active Pokémon is now Confused.",
] as const;

/** 🛑 THE ROTATION COLLISIONS, IN THE HEADS ARM. `Asleep`, `Confused` and `Paralyzed`
    are three values of ONE field (`SpecialConditions.rotation`), so a heads pair naming
    two of them is a program whose second op silently overwrites its first — D424's *lie
    that resolves*. `defenderStatusOps` refuses it, and the open slots on this anchor are
    what keep that refusal REACHABLE from this arm (D462).

    ⚠️ **AND THE COLLISION IS ASKED ABOUT THE HEADS LIST ALONE, WHICH IS THE POINT.** The
    PRINTED row lands Paralyzed on heads and Confused on tails — two `rotation` values in
    one sentence — and that is not a collision, because the coin makes the arms mutually
    exclusive. A refusal spanning the arms would have refused the sentence this slice
    exists for. §5 drives both directions. */
const HEADS_COLLISIONS = [
  "Flip a coin. If heads, your opponent's Active Pokémon is now Asleep and Confused. If tails, your opponent's Active Pokémon is now Burned.",
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Confused. If tails, your opponent's Active Pokémon is now Poisoned.",
  "Flip a coin. If heads, your opponent's Active Pokémon is now Confused and Confused. If tails, your opponent's Active Pokémon is now Burned.",
] as const;

const W = "(?:Asleep|Burned|Confused|Paralyzed|Poisoned)";
const SUBJ = "your opponent['’]s Active Pokémon";
const SEEDS = 400;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}
function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}
const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);
const hit = (re: RegExp) => legalAttackCorpus().filter(([, s]) => re.test(s));

/** Re-text `fix-glimmora`'s ONE printed attack on a board's OWN `cardPool` copy.
    ⚠️ **NOT A FIXTURE EDIT** — `FIXTURE_POOL` is shared by every suite in this package
    and D412 reddened three of D409's boards by widening a shared one. This mutates a
    per-board clone, so nothing outside the calling `it` can see it, and the slice adds
    **no `FIXTURE_POOL` id** — every `ids.length` ladder takes a ZERO term (D414/D452). */
function withEffect(state: GameState, effect: string): GameState {
  const card = state.cardPool["fix-glimmora"];
  if (card === undefined) throw new Error("no fix-glimmora in pool");
  const attacks = card.attacks ?? [];
  const first = attacks[0];
  if (first === undefined) throw new Error("fix-glimmora has no attack 0");
  return {
    ...state,
    cardPool: {
      ...state.cardPool,
      "fix-glimmora": { ...card, attacks: [{ ...first, effect }, ...attacks.slice(1)] },
    },
  };
}

/** `fix-glimmora` Active for `by` ({C} for "Stun Poison"), `fix-titan` Active for the
    other seat — 340 HP with no attacks, no Weakness and no Resistance, so no printed
    number in this suite can Knock it Out and a landed status can never be lost to a
    §8.1 tail. Both benches cleared, so no stray body can absorb anything. */
function board(seed: number, { by = "p1" as Seat, effect = PRINTED } = {}): GameState {
  const opener: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        seed,
        { p1: DEFENDER_STATUS_PAIR_DECK, p2: DEFENDER_STATUS_PAIR_DECK },
        { first: opener },
      ),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-glimmora");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, opener, "fix-titan");
  state = clearBench(state, opener);
  return withEffect(state, effect);
}
function swing(state: GameState, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: 0 });
}
function defenderConditions(state: GameState, by: Seat = "p1") {
  const active = state.players[by === "p1" ? "p2" : "p1"].active;
  if (active === null) throw new Error("no defender");
  return active.conditions;
}

/** A board seeded so the ONE coin lands the way the case needs. ⚠️ **THE SEED IS
    SEARCHED, NOT STUBBED** — the RNG is part of what this suite claims about a gate, and
    a stub would answer about the stub. A seed that cannot build the board (the attacker
    or its Energy shuffled into HAND rather than DECK) is skipped rather than counted. */
function flipBoard(wantHeads: boolean, opts: { by?: Seat; effect?: string } = {}): GameState {
  for (let seed = 1; seed < SEEDS; seed++) {
    let candidate: GameState;
    try {
      candidate = board(seed, opts);
    } catch {
      continue;
    }
    const flip = find(swing(candidate, opts.by ?? "p1").events, "ATTACK_EFFECT_COIN_FLIP");
    if (flip?.result === (wantHeads ? "heads" : "tails")) return candidate;
  }
  throw new Error(`no seed under ${SEEDS} gives ${wantHeads ? "heads" : "tails"}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, transcribed rather than recognised.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed data, transcribed rather than recognised", () => {
  it("🛑 the sentence is the CORPUS's bytes at TWO printings, apostrophes ASCII U+0027", () => {
    // D183's rule: author and assert against the printed bytes, never a paraphrase.
    // D456's: derive the specimen from `legalAttackCorpus()` where you can.
    const rows = new Map(legalAttackCorpus().map(([n, text]) => [text, n]));
    expect(rows.get(PRINTED)).toBe(2);
    expect(rows.get(HEADS_ARM_ALONE)).toBe(1);
    expect(rows.get(TAILS_ARM_ALONE)).toBe(31);
    expect(rows.get(STILL_LOUD_COMPOUND)).toBe(2);
    // ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2** — one file line,
    // two legal printings. D476's and D475's agreed at 1 and 1, so a pass that copied
    // either slice's number into the other kind of site would have been wrong here
    // (D451/D461/D464). Both were read off THIS corpus at THIS head.
    for (const s of [PRINTED, HEADS_ARM_ALONE, TAILS_ARM_ALONE]) {
      expect(s.includes("opponent's")).toBe(true);
      expect(s.includes("opponent’s")).toBe(false);
      expect(s.includes("Pokémon")).toBe(true);
    }
    // The é is U+00E9 and the apostrophes are U+0027, measured with `codePointAt`
    // rather than by eye (D421/D440).
    expect(PRINTED.codePointAt(PRINTED.indexOf("é"))).toBe(0x00e9);
    for (const i of [PRINTED.indexOf("'"), PRINTED.lastIndexOf("'")]) {
      expect(PRINTED.codePointAt(i)).toBe(0x0027);
    }
  });

  it("the demonstrator is NOT a new fixture — `fix-glimmora` prints the HEADS ARM", () => {
    // ⚠️ SYNTHETIC BY NECESSITY AND SAID SO (D425). The body is D424's, and its printed
    // attack is this sentence's heads arm ALONE, which is exactly what makes it the
    // right demonstrator: the only printed difference is the branch this slice adds.
    // ⚠️ AND `FIXTURE_POOL` IS UNTOUCHED — the boards re-text a per-board `cardPool`
    // clone (D414), so this slice adds ZERO fixture ids and moves NONE of D460's four
    // fixture census sites.
    // ⚠️ THE WHOLE printed attack list, not just index 0 (D437: truncating an
    // enumeration by WIDTH is truncating). The second index is `typedActiveStatusGate`'s
    // and is why the boards below always swing index 0.
    expect(FIXTURE_POOL["fix-glimmora"]?.attacks).toEqual([
      { cost: ["Colorless"], name: "Stun Poison", effect: HEADS_ARM_ALONE },
      {
        cost: ["Fighting"],
        name: "Venoshock",
        damage: "30+",
        effect:
          "If your opponent's Active Pokémon is Poisoned, this attack does 100 more damage.",
      },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the derivation, the JOIN it is, and the population behind both.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the derivation, and the population it was measured on", () => {
  it("derives to ONE coinFlipGate holding the pair on `then` and the single on `otherwise`", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          { op: "applyStatus", target: "defender", status: "paralyzed" },
          { op: "applyStatus", target: "defender", status: "poisoned" },
        ],
        otherwise: [{ op: "applyStatus", target: "defender", status: "confused" }],
      },
    ]);
  });

  it("🛑 the two arms ARE the two shipped programs — asserted, not described", () => {
    // The zero-new-mechanism claim as an EQUALITY rather than as an inventory (D452's
    // rule for the record-version argument, applied one layer down). `then` is
    // `FLIP_DEFENDER_STATUS_PAIR`'s whole program; `otherwise` is `DEFENDER_NOW`'s. If
    // either sibling arm moves, this rung reddens and §7 is owed a re-read.
    const gate = deriveAttackEffect(PRINTED)?.[0];
    if (gate?.op !== "coinFlipGate") throw new Error("expected a coinFlipGate");
    const headsSibling = deriveAttackEffect(HEADS_ARM_ALONE)?.[0];
    if (headsSibling?.op !== "coinFlipGate") throw new Error("expected a coinFlipGate");
    expect(gate.then).toEqual(headsSibling.then);
    expect(gate.otherwise).toEqual(deriveAttackEffect(TAILS_ARM_ALONE));
    // …and the sibling that supplies `then` has NO second arm of its own, which is what
    // makes the `otherwise` this slice's contribution rather than an inherited key.
    expect(headsSibling.otherwise).toBeUndefined();
  });

  it("🛑 the U+2019 fold — the typographic apostrophe derives to the SAME program", () => {
    // D136/D137's hardening, driven rather than assumed. The catalog prints BOTH `'`
    // and `’`, and this anchor spells the subject TWICE, so a class dropped at either
    // position silently un-derives the sentence under a punctuation-normalising
    // re-ingest — and it fails SILENTLY, by falling back to the loud skip path.
    // ⚠️ **BOTH POSITIONS ARE DRIVEN SEPARATELY**, because folding only one is exactly
    // the half-fix a careless edit ships and a whole-string replace cannot see it.
    const curlyBoth = PRINTED.replaceAll("opponent's", "opponent’s");
    const curlyHeadsOnly = PRINTED.replace("opponent's", "opponent’s");
    const curlyTailsOnly = `${PRINTED.slice(0, PRINTED.lastIndexOf("opponent's"))}${PRINTED.slice(
      PRINTED.lastIndexOf("opponent's"),
    ).replace("opponent's", "opponent’s")}`;
    for (const variant of [curlyBoth, curlyHeadsOnly, curlyTailsOnly]) {
      expect(variant).not.toBe(PRINTED);
      expect(deriveAttackEffect(variant)).toEqual(deriveAttackEffect(PRINTED));
      expect(resolvedByAnyReader(variant)).toBe(true);
    }
    // …and the corpus really does print the ASCII form, so the fold is the DEFENSIVE
    // direction rather than the one in use today.
    const rows = new Set(legalAttackCorpus().map(([, s]) => s));
    expect(rows.has(PRINTED)).toBe(true);
    expect(rows.has(curlyBoth)).toBe(false);
  });

  it("all three slots are TEMPLATES, and every status word reaches every one of them", () => {
    // ⚠️ D121 prices a NEW parameter and this anchor adds none — `STATUS_WORDS` is this
    // family's own vocabulary at three more positions. The TAILS slot is walked over all
    // five words against a fixed heads pair; the HEADS slots are walked against a fixed
    // tails word, skipping the pairs the rotation slot refuses (§5 owns those).
    for (const [word, status] of [
      ["Asleep", "asleep"],
      ["Burned", "burned"],
      ["Confused", "confused"],
      ["Paralyzed", "paralyzed"],
      ["Poisoned", "poisoned"],
    ] as const) {
      const text = PRINTED.replace("is now Confused.", `is now ${word}.`);
      const ops = deriveAttackEffect(text);
      expect(ops?.[0]?.op === "coinFlipGate" ? ops[0].otherwise : null).toEqual([
        { op: "applyStatus", target: "defender", status },
      ]);
    }
    // The heads slots, on a pair the rotation map admits: Burned + Poisoned are two
    // different fields, so every arrangement here is a legal program.
    for (const [x, y, sx, sy] of [
      ["Burned", "Poisoned", "burned", "poisoned"],
      ["Poisoned", "Burned", "poisoned", "burned"],
      ["Asleep", "Burned", "asleep", "burned"],
    ] as const) {
      const text = PRINTED.replace("Paralyzed and Poisoned", `${x} and ${y}`);
      const ops = deriveAttackEffect(text);
      expect(ops?.[0]?.op === "coinFlipGate" ? ops[0].then : null).toEqual([
        { op: "applyStatus", target: "defender", status: sx },
        { op: "applyStatus", target: "defender", status: sy },
      ]);
    }
  });

  it("🛑 ZERO false positives over the WHOLE 640-sentence column — one row, two printings", () => {
    // ⚠️ THE SWEEP IS OVER THE POPULATION, not over the rows this slice went looking
    // for (D423). An anchor that had drifted into a floating match shows up here and
    // nowhere else. The predicate reads what the READER RETURNED, so it also catches a
    // widening that reaches the shape through some other arm.
    const twoArmed = legalAttackCorpus().filter(([, s]) => {
      const ops = deriveAttackEffect(s);
      const head: EffectOp | undefined = ops?.[0];
      return (
        ops?.length === 1 &&
        head?.op === "coinFlipGate" &&
        head.otherwise !== undefined &&
        head.then.every((o) => o.op === "applyStatus") &&
        head.otherwise.every((o) => o.op === "applyStatus")
      );
    });
    expect(twoArmed.map(([, s]) => s)).toEqual([PRINTED]);
    expect(units(twoArmed)).toBe(2);
  });

  it("🛑 NO GENERALITY WAS TAKEN, AND THAT IS A MEASUREMENT (D472)", () => {
    // Over all 640 rows the shipped anchor claims 1 row / 2 printings — and so does
    // every single-axis loosening available to it. A wider form that claims the same
    // rows buys nothing and costs a wrong program, so the printed shape is spelled
    // exactly. ⚠️ D477 overrode this rule deliberately and recorded the override as a
    // rung; this slice does NOT need the override, and the difference is measured here
    // rather than asserted.
    const strict = new RegExp(
      `^Flip a coin\\. If heads, ${SUBJ} is now (${W}) and (${W})\\. If tails, ${SUBJ} is now (${W})\\.$`,
    );
    const loosenings: Array<[string, RegExp]> = [
      ["heads pair made optional", new RegExp(
        `^Flip a coin\\. If heads, ${SUBJ} is now (${W})(?: and (${W}))?\\. If tails, ${SUBJ} is now (${W})\\.$`,
      )],
      ["tails slot widened to a pair", new RegExp(
        `^Flip a coin\\. If heads, ${SUBJ} is now (${W}) and (${W})\\. If tails, ${SUBJ} is now (${W})(?: and (${W}))?\\.$`,
      )],
      ["heads consequent widened to (.+)", new RegExp(
        `^Flip a coin\\. If heads, ${SUBJ} is now (.+)\\. If tails, ${SUBJ} is now (${W})\\.$`,
      )],
      ["tails consequent widened to (.+)", new RegExp(
        `^Flip a coin\\. If heads, ${SUBJ} is now (${W}) and (${W})\\. If tails, (.+)\\.$`,
      )],
      ["the ^ dropped", new RegExp(
        `Flip a coin\\. If heads, ${SUBJ} is now (${W}) and (${W})\\. If tails, ${SUBJ} is now (${W})\\.$`,
      )],
      ["the \\.$ dropped", new RegExp(
        `^Flip a coin\\. If heads, ${SUBJ} is now (${W}) and (${W})\\. If tails, ${SUBJ} is now (${W})\\.`,
      )],
    ];
    expect([hit(strict).length, units(hit(strict))]).toEqual([1, 2]);
    for (const [name, re] of loosenings) {
      expect([name, hit(re).length, units(hit(re))]).toEqual([name, 1, 2]);
    }
    // 🛑 AND THE FACE-SWAPPED FORM CLAIMS **NOTHING**, which is why the branches are
    // read in printed order rather than by a face-agnostic pattern: no printing
    // warrants the other arrangement.
    const swapped = new RegExp(
      `^Flip a coin\\. If tails, ${SUBJ} is now (${W}) and (${W})\\. If heads, ${SUBJ} is now (${W})\\.$`,
    );
    expect([hit(swapped).length, units(hit(swapped))]).toEqual([0, 0]);
  });

  it("🛑 DISJOINT FROM THE SIX OLDER `is now` ANCHORS BY CONSTRUCTION, not by position", () => {
    // D467's rule, first preference: a string cannot end two ways. The pair anchor
    // demands `\.$` immediately after its SECOND status word and this one puts
    // `. If tails, ` there; `FLIP_DEFENDER_NOW` demands it after the FIRST; the bare
    // `^Your opponent` anchors cannot match a string opening `Flip a coin.` at all.
    // So the ARM ORDER is a refactor and there is no guard here that could rot.
    expect(deriveAttackEffect(HEADS_ARM_ALONE)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          { op: "applyStatus", target: "defender", status: "paralyzed" },
          { op: "applyStatus", target: "defender", status: "poisoned" },
        ],
      },
    ]);
    expect(deriveAttackEffect(TAILS_ARM_ALONE)).toEqual([
      { op: "applyStatus", target: "defender", status: "confused" },
    ]);
    expect(
      deriveAttackEffect("Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."),
    ).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
      },
    ]);
  });

  it("neither splitter is involved — the sentence is claimed WHOLE", () => {
    // D444's tell, run rather than assumed: before claiming a sentence is served by an
    // anchor, check the two composition paths do not also answer.
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE FAMILY, measured with a PUBLISHED PATTERN rather than enumerated.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the two-branch coin family, measured over all 640 rows", () => {
  it("🛑 the family is 3 sentences / 8 printings, and TWO of the three now build", () => {
    // ⚠️ **THE PATTERN IS PUBLISHED SO ITS EDGES ARE VISIBLE (D424/D425/D477).** A
    // sentence is in this family when it prints BOTH branches of one coin —
    // `/If heads,/` AND `/If tails,/`, case-insensitively, in either order. That is the
    // loosest plausible shape for *"a coin whose losing face also does something"*, and
    // what it cannot see is stated: a family member spelling the faces some other way
    // (*"If it is heads"*, *"On tails"*) — measured at ZERO rows below — and a
    // two-branch gate printed across two attacks rather than one sentence, which is not
    // a sentence-level fact at all.
    const both = legalAttackCorpus().filter(
      ([, s]) => /If heads,/i.test(s) && /If tails,/i.test(s),
    );
    expect([both.length, units(both)]).toEqual([3, 8]);
    expect(both.map(([, s]) => s).sort()).toEqual(
      [
        "Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon.",
        PRINTED,
        STILL_LOUD_COMPOUND,
      ].sort(),
    );
    // 🛑 **THE BRIEF'S "2 PRINTINGS" WAS ONE ROW'S COUNT, NOT THE FAMILY'S** — and the
    // LARGEST member of the family (4 printings) had ALREADY SHIPPED, at D416, through
    // the very `otherwise` the refusal on line 263 said did not exist. That is the whole
    // disproof in one figure.
    const built = both.filter(([, s]) => resolvedByAnyReader(s));
    expect([built.length, units(built)]).toEqual([2, 6]);
    expect(built.map(([, s]) => s).sort()).toEqual(
      [
        "Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon.",
        PRINTED,
      ].sort(),
    );
    const left = both.filter(([, s]) => !resolvedByAnyReader(s));
    expect(left.map(([, s]) => s)).toEqual([STILL_LOUD_COMPOUND]);
    expect(units(left)).toBe(2);
  });

  it("the wider coin-face populations, so the family's denominator is not a guess", () => {
    // The three figures a successor will want, all off the same committed corpus.
    // ⚠️ These are the pattern's SUPERSETS, published for the same reason: a family
    // counted with one literal is as narrow as that literal (D310/D445).
    expect([hit(/If heads,/i).length, units(hit(/If heads,/i))]).toEqual([24, 116]);
    expect([hit(/If tails,/i).length, units(hit(/If tails,/i))]).toEqual([6, 27]);
    expect([hit(/If (?:heads|tails)/i).length, units(hit(/If (?:heads|tails)/i))]).toEqual([
      27, 135,
    ]);
    // …and the alternative face spellings the published pattern cannot see are ZERO,
    // which is what turns "what it cannot see" from a list somebody thought of into a
    // query somebody ran (D448).
    for (const re of [/If it is (?:heads|tails)/i, /On (?:heads|tails)/i, /When .{0,20}tails/i]) {
      expect(hit(re)).toEqual([]);
    }
  });

  it("🛑 the two-branch gate the family needs has shipped since D269, on BOTH sides", () => {
    // The disproof as an executable rung rather than as prose: the field exists, the
    // interpreter splices it, and `deriveAttackEffect` already emitted one before this
    // slice. Delete the D416 arm's `otherwise` and this reddens by VALUE.
    const ko = deriveAttackEffect(
      "Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon.",
    );
    const gate = ko?.[0];
    if (gate?.op !== "coinFlipGate") throw new Error("expected a coinFlipGate");
    expect(gate.otherwise).toEqual([
      { op: "knockOutChosen", target: "opponentBench", basicOnly: true },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the two OUTCOMES on a real board, driven separately, with a searched seed.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — both outcomes land, asserted on the FIELDS", () => {
  it("🛑 HEADS lands Paralyzed AND Poisoned — two statuses, not one", () => {
    // ⚠️ THE AND-NESS IS THE POINT OF THIS RUNG. A heads arm that kept only its first
    // op would land Paralysis, resolve, emit a coin row, report nothing skipped, and
    // move every census figure by exactly the same amount. The `poisonDamage` figure is
    // a NUMBER, so a build that set a flag would be invisible to a status-list
    // assertion and is visible here.
    const { state, events } = swing(flipBoard(true));
    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("heads");
    expect(defenderConditions(state)).toEqual({
      rotation: "paralyzed",
      poisonDamage: 10,
      burned: false,
    });
    expect(all(events, "STATUS_APPLIED").map((e) => e.status)).toEqual(["paralyzed", "poisoned"]);
  });

  it("🛑 TAILS lands Confused — the branch this slice exists for", () => {
    // Before D478 this board landed NOTHING and the whole sentence was announced as
    // unread. Both halves are asserted: the condition on the model, and the absence of
    // the loud row.
    const { state, events } = swing(flipBoard(false));
    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("tails");
    expect(defenderConditions(state)).toEqual({
      rotation: "confused",
      poisonDamage: 0,
      burned: false,
    });
    expect(all(events, "STATUS_APPLIED").map((e) => e.status)).toEqual(["confused"]);
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("🛑 THE SWAP IS OBSERVABLE, AND THAT IS WHY THE TWO ARMS DIFFER OBSERVABLY", () => {
    // ⚠️ **A TWO-BRANCH GATE WHOSE BRANCHES DID THE SAME KIND OF THING WOULD HIDE A
    // SWAPPED-ARM BUILD.** If heads and tails both merely applied *some* status, a
    // suite asserting "a status landed" would pass on the arms crossed. So the killing
    // case is the PAIR of outcomes read together: exactly ONE board carries Poison and
    // exactly ONE carries Confusion, and they are opposite faces of the same sentence.
    const onHeads = defenderConditions(swing(flipBoard(true)).state);
    const onTails = defenderConditions(swing(flipBoard(false)).state);
    expect(onHeads).not.toEqual(onTails);
    expect([onHeads.rotation, onTails.rotation]).toEqual(["paralyzed", "confused"]);
    expect([onHeads.poisonDamage > 0, onTails.poisonDamage > 0]).toEqual([true, false]);
    // …and neither board is the OTHER build's board: an arms-swapped reader would give
    // exactly this pair with the faces exchanged, which the coin row above pins.
    expect([
      find(swing(flipBoard(true)).events, "ATTACK_EFFECT_COIN_FLIP")?.result,
      find(swing(flipBoard(false)).events, "ATTACK_EFFECT_COIN_FLIP")?.result,
    ]).toEqual(["heads", "tails"]);
  });

  it("the coin is taken and announced ONCE, on both faces", () => {
    // D269's invariant at this arm: the flip happens before any branch is consulted, so
    // `rngState` advances the same number of steps whichever face lands and no online
    // match can desynchronise on the outcome. A two-armed gate emits exactly the one row
    // a one-armed gate does.
    for (const wantHeads of [true, false]) {
      const { events } = swing(flipBoard(wantHeads));
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
    }
  });

  it("🛑 BOTH SEATS — the same sentence read from p2 lands on p1's Active", () => {
    // D213's rule, re-earned by D412: the server-side twin passing proves nothing about
    // the other seat. `applyStatus`'s `target: "defender"` is resolved from the ATTACKING
    // seat, so a hard-coded `p2` would pass every line above and fail here — and it is
    // driven on the TAILS face, because that is the branch this slice added.
    const state = flipBoard(false, { by: "p2" });
    const { state: after } = swing(state, "p2");
    expect(defenderConditions(after, "p2")).toEqual({
      rotation: "confused",
      poisonDamage: 0,
      burned: false,
    });
    // …and the ATTACKER is untouched — `defender` is not `self`.
    expect(after.players.p2.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
    });
  });

  it("a pre-existing rotation is REPLACED on the tails arm too", () => {
    // §12's rule: the rotation slot overwrites. Correct here — one branch, one rotation
    // word — and asserted on the branch that is new, because the heads arm's behaviour
    // was already shipped and driven at D424.
    let state = flipBoard(false);
    const defender = state.players.p2.active;
    if (defender === null) throw new Error("no defender");
    state = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...state.players.p2,
          active: {
            ...defender,
            conditions: { rotation: "asleep", poisonDamage: 20, burned: false },
          },
        },
      },
    };
    expect(defenderConditions(swing(state).state)).toEqual({
      rotation: "confused", // replaced Asleep — §12
      poisonDamage: 20, // untouched: a different field
      burned: false,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the refusals, each with the admission that differs from it on ONE axis.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — what this anchor refuses, and what it still admits", () => {
  it("the five CONSTRUCTED near misses derive to null", () => {
    for (const text of CONSTRUCTED_MISSES) expect(deriveAttackEffect(text), text).toBeNull();
    // ⚠️ **THE ADMISSION ON THE SAME AXIS (D424).** A refusal loop passes trivially if
    // the reader refuses everything, so the control is the printed string itself.
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
  });

  it("🛑 a rotation collision in the HEADS pair is refused — and the printed cross-arm pair is NOT", () => {
    // The refusal is `defenderStatusOps`', shared with the three older list arms, and
    // the open slots on this anchor are what keep it reachable from here (D462).
    for (const text of HEADS_COLLISIONS) expect(deriveAttackEffect(text), text).toBeNull();
    // 🛑 **THE CONTROL THAT MATTERS, AND IT IS THE PRINTED ROW.** Paralyzed (heads) and
    // Confused (tails) are two `rotation` values in ONE sentence, and that is not a
    // collision, because the coin makes the arms mutually exclusive — no board can
    // reach both. A refusal that spanned the arms would have refused the very sentence
    // this slice exists for, so the asymmetry is the design and not an oversight.
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
    // …and it is a REAL cross-arm rotation pair, not a constructed one: measured off
    // the corpus so the claim is about the pool rather than about a specimen (D423).
    expect(new Map(legalAttackCorpus()).get(2)).toBeDefined();
    const gate = deriveAttackEffect(PRINTED)?.[0];
    if (gate?.op !== "coinFlipGate") throw new Error("expected a coinFlipGate");
    const rotations = [...gate.then, ...(gate.otherwise ?? [])]
      .map((o) => (o.op === "applyStatus" ? o.status : null))
      .filter((s) => s === "paralyzed" || s === "confused" || s === "asleep");
    expect(rotations).toEqual(["paralyzed", "confused"]);
  });

  it("🛑 the `\\.$` end, asserted as a SPLIT rather than as nullity (D464)", () => {
    // ⚠️ **THE TWO ENDS OF THIS ANCHOR FAIL DIFFERENTLY, AND ONLY ONE OF THEM REACHES
    // THE LOUD PATH.** A near miss with LEADING text stays loud, because nothing claims
    // its head — that is `CONSTRUCTED_MISSES` (b) above. A near miss with a claimed
    // TRAILING clause does NOT: once this sentence derives, D409's splitter sees a
    // claimed head and a claimed tail and composes them. So the `$` is pinned by
    // asserting the SPLIT, plus the fact that `deriveAttackEffect` still refuses the
    // compound WHOLE — which is the byte that reddens if the terminator is dropped,
    // because a prefix match would claim the compound and throw the draw away in
    // silence.
    const compound = `${PRINTED} Draw a card.`;
    expect(deriveAttackEffect(compound)).toBeNull();
    expect(resolvedByAnyReader(compound)).toBe(false);
    expect(splitAttackTrailingClause(compound)).toEqual({
      head: PRINTED,
      tail: "Draw a card.",
    });
    // …and no such compound is PRINTED, checked over the whole column rather than
    // assumed, so nothing is authored for a sentence nobody prints (D464).
    expect(legalAttackCorpus().filter(([, s]) => s.startsWith(`${PRINTED} `))).toEqual([]);
  });

  it("🛑 the column's LAST printed heads/tails compound stays LOUD, and its blocker is a SEAM", () => {
    // The slot three files re-pointed onto when this slice built line 263 (D418: the
    // subject that still has the old property, D444). Its head alone IS read — as an
    // attack-level cancel — and the WHOLE sentence is read by nobody, which is the
    // distinction that makes it durable: no anchor in this family can be widened to
    // reach a rule that resolves at the §8 declaration gate.
    expect(deriveAttackEffect(STILL_LOUD_COMPOUND)).toBeNull();
    expect(resolvedByAnyReader(STILL_LOUD_COMPOUND)).toBe(false);
    expect(splitAttackGateClause(STILL_LOUD_COMPOUND)).toBeNull();
    expect(splitAttackTrailingClause(STILL_LOUD_COMPOUND)).toBeNull();
  });

  it("…and it is still ANNOUNCED on a real board — the attribution control", () => {
    // 🛑 D214's rule. Without this, §4's "no skip marker on either face" could be true
    // because the marker stopped being emitted at all.
    const doctored = board(11, { effect: STILL_LOUD_COMPOUND });
    expect(find(swing(doctored).events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(
      STILL_LOUD_COMPOUND,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the census moves in exactly ONE summand, and the surface stands still.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the census moves in exactly ONE summand", () => {
  it("🛑 the resolving corpus gains ONE sentence and TWO printings", () => {
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([516, 1545]);  // (🆕🆕🆕 D483 +2 sentences / +2 printings — THE PRINTED CANDIDATE **CLASS** ON THE BENCHED SNIPE, `censusAttackCorpus.ts` FILE LINES **111** and **615**, **2 sentences / 2 legal printings**, both claimed WHOLE by `deriveAttackEffect` (arms 9b-bis and 6c) through ONE new group on the SHARED fragment `ALSO_BENCHED_SNIPE_BODY` and ONE new OPTIONAL op field `damageChosen.filter?: CardFilter`. RAW summand ALONE; reader surface still 13. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 2 AND 2, MEASURED at this head.) // (🆕🆕 D482 +1 sentence / +1 printing — THE WHOLE-SIDE SPREAD, `censusAttackCorpus.ts` FILE LINE **572**, *"This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` arm 6a-bis through ONE new anchor `SPREAD_EACH_OPPONENT_POKEMON` over a TWO-OP PROGRAM OF SHIPPED OPS (`damageDefender` flat + `spreadDamage { target: "opponentBench" }`) — **ZERO new op members, fields, values or `interpreter.ts` bytes**, reader surface still 13. RAW summand ALONE: no registry row, no gate split, no trailing split. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1.)// (🆕🆕 D479 +1 sentence / +1 printing — THE ATTACK-SIDE HAND REFRESH, `censusAttackCorpus.ts` FILE LINE 486, *"Shuffle your hand into your deck. Then, draw {N} cards."*, claimed WHOLE by `deriveAttackEffect` arm 44b through ONE new anchor `SHUFFLE_HAND_DRAW` over `handRefresh { who: "you", draw: { kind: "fixed", count } }` — Youngster `sv01-198`'s hand-authored program at a second address. ZERO new op members/fields/values, reader surface still 13. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1.)
    // …and without this sentence it is one row and two printings smaller, which is what
    // makes the step THIS slice's rather than an inherited figure.
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([515, 1543]); // (🆕🆕🆕 D483 +2 sentences / +2 printings — THE PRINTED CANDIDATE **CLASS** ON THE BENCHED SNIPE, `censusAttackCorpus.ts` FILE LINES **111** and **615**, **2 sentences / 2 legal printings**, both claimed WHOLE by `deriveAttackEffect` (arms 9b-bis and 6c) through ONE new group on the SHARED fragment `ALSO_BENCHED_SNIPE_BODY` and ONE new OPTIONAL op field `damageChosen.filter?: CardFilter`. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 2 AND 2, MEASURED. ⚠️ FOUND ON A SECOND `check` ROUND, BEHIND A SITE IN THE SAME `it` THAT THREW FIRST — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short and the ROUND COUNT is the measurement.) // (🆕🆕 D479 — THE ATTACK-SIDE HAND REFRESH, `censusAttackCorpus.ts` FILE LINE 486, *"Shuffle your hand into your deck. Then, draw {N} cards."*, 1 sentence / 1 legal printing, `deriveAttackEffect` arm 44b through ONE new anchor `SHUFFLE_HAND_DRAW`. ZERO new op members/fields/values, reader surface still 13.) // (🆕🆕🆕 D482 — the WHOLE-SIDE SPREAD raises the head by 1 sentence / 1 printing (`censusAttackCorpus.ts` FILE LINE 572, arm 6a-bis, `SPREAD_EACH_OPPONENT_POKEMON` over `damageDefender` + `spreadDamage`), so this DERIVED figure moves with it. This slice's own sentence is NOT in this file's subtracted set, which is why the figure steps by exactly the head's step.)
  });

  it("the reader SURFACE stands still at 13 — this is an ARM, not a reader", () => {
    // D444's rule: `censusAttackCorpus.ts` derives the reader surface off `effects.ts`
    // by NAME PREFIX, so an export called `deriveAttack…` enrols itself. This slice
    // adds an anchor and an arm inside an existing reader and must move nothing here.
    expect(attackReaderSurface()).toHaveLength(13);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the version questions, driven rather than reasoned from a name.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — engineVersion, and why MATCH_RECORD_VERSION does not move", () => {
  it("engineVersion is 0.379.0", () => {
    expect(engineVersion).toBe("0.379.0");
  });

  it("🛑 `MATCH_RECORD_VERSION` STAYS 29 — the SERIALIZED ALPHABET, and REACHABILITY too", () => {
    // ⚠️ **BOTH HALVES ARE STATED BECAUSE EACH ALONE READS AS AN EXCUSE (D452).**
    //
    // (a) THE ALPHABET (D462/D463). This slice adds no `EffectOp` member, no op FIELD
    //     and no op VALUE. `coinFlipGate.otherwise` has been in the union since D269 and
    //     `applyStatus{target:"defender"}` has been produced into a gate's `then` since
    //     D142 — so `JSON.stringify` of what this arm emits is a byte string a v29
    //     deploy can already write, and there is no new byte for a version to be about.
    //     ⚠️ A new COMBINATION of a shipped vocabulary is not a new shape (D405).
    //
    // (b) REACHABILITY (D450/D461/D465). An `EffectOp` reaches storage only through an
    //     `EffectContinuation`'s `pendingOp` and its `rest`, both written only on a
    //     PARK. This producer returns a program of LENGTH ONE, so there is no earlier op
    //     at all; and neither a gate nor `applyStatus` parks, so neither arm can put one
    //     there either. Driven on BOTH faces, because a whiff is not a park and the two
    //     are easy to confuse.
    const program = deriveAttackEffect(PRINTED);
    expect(program).toHaveLength(1);
    const gate = program?.[0];
    if (gate?.op !== "coinFlipGate") throw new Error("expected a coinFlipGate");
    for (const op of [...gate.then, ...(gate.otherwise ?? [])]) {
      expect(op.op).toBe("applyStatus");
    }
    for (const wantHeads of [true, false]) {
      const { state } = swing(flipBoard(wantHeads));
      expect(state.phase.kind).not.toBe("effect:choose");
      expect("cont" in state.phase ? state.phase.cont : undefined).toBeUndefined();
    }
    // The emitted ops are byte-identical to programs the catalog already prints
    // STANDALONE, which is the alphabet argument as an equality rather than a sentence.
    expect(JSON.stringify(gate.then)).toBe(
      JSON.stringify(
        (deriveAttackEffect(HEADS_ARM_ALONE)?.[0] as { then: EffectOp[] } | undefined)?.then,
      ),
    );
    expect(JSON.stringify(gate.otherwise)).toBe(
      JSON.stringify(deriveAttackEffect(TAILS_ARM_ALONE)),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — purity: the reader is a function of TEXT and the run does not mutate its input.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — purity and determinism", () => {
  it("the derivation is a pure function of the string", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(deriveAttackEffect(`${PRINTED}`));
    expect(deriveAttackEffect(` ${PRINTED} `)).toEqual(deriveAttackEffect(PRINTED));
  });

  it("the swing does not mutate the state it was handed, on either face", () => {
    for (const wantHeads of [true, false]) {
      const frozen = deepFreeze(flipBoard(wantHeads));
      expect(() => swing(frozen)).not.toThrow();
    }
  });

  it("the same seed replays to the same board", () => {
    const seed = flipBoard(false);
    const a = swing(seed).state;
    const b = swing(seed).state;
    expect(defenderConditions(a)).toEqual(defenderConditions(b));
  });
});
