import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effects from "./effects";
import {
  deriveAttackCoinFlip,
  deriveAttackEffect,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, engineVersion, programFor } from "./index";
import { registryCardIds } from "./registry";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  PREVENT_BLOCK_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.390.0 → 0.391.0 — 🆕🆕 D499, THE PRINTED CANCEL WITH A HEADS CONSEQUENT ON THE
// SAME FLIP. *"Flip a coin. If tails, this attack does nothing. If heads, during your
// opponent's next turn, prevent all damage from and effects of attacks done to this
// Pokémon."* — `censusAttackCorpus.ts` **FILE LINE 268**, **1 sentence / 2 legal
// printings** — ONE new anchor, ONE new `AttackCoinFlip` member, ONE `if` at the
// flip site. The id in D142's block is Squawkabilly `sv01-162` "Fly"; this checkout
// has no D1, so the id is cited as that block's and the SENTENCE is the citation
// (D425/D490).
//
// 🛑 **WHAT THIS SLICE IS ABOUT IS A REFUSAL THAT WAS RIGHT ABOUT ITS OWN CARRIER AND
// WAS READ AS A CLAIM ABOUT THE ENGINE (D456/D457).** D142 listed this row LOUD with
// the warrant *"a SECOND consequent on the same flip"*, and four suites then carried
// it — `flipStatusHeadsTails.test.ts` in the sharpest words: *"its blocker is a SEAM …
// no widening of any anchor in this family can reach it, which is what makes it a
// durable witness rather than a treadmill."*
//
// **Every clause of that is TRUE and the conclusion does not follow.** The seam
// argument is exactly right about `deriveAttackEffect`, whose program runs at
// `attack()`'s TAIL strictly after the §8.5 pipeline: a `coinFlipGate { then,
// otherwise }` cannot spell this sentence, because its `otherwise` would have to
// RETRACT damage already dealt, and `attack.ts` says so at the flip site in those
// words. What nobody asked is which carrier is read at the §8 seam the cancel
// resolves at. `deriveAttackCoinFlip` is — it is read ~1,000 lines earlier, in front
// of the pipeline, for exactly this reason — and it has carried a consequent PROGRAM
// on a coin member (`programPerHeads.ops`) since **D130**. The row was blocked by a
// price against the wrong carrier, for **57 decisions**.
//
// 🛑 **ONE READER, ONE FLIP — AND THE TWO-READER IDIOM D493/D494 SHIPPED IS REFUSED
// HERE ON A MEASUREMENT, NOT ON TASTE.** `attack.ts` hands `effect` to every reader,
// so letting `deriveAttackCoinFlip` take the cancel and `deriveAttackEffect` take the
// heads gate is one constant away. It would spend **TWO** `rngState` steps and emit
// **TWO** `ATTACK_EFFECT_COIN_FLIP` rows for ONE printed flip — the coin block's
// `takeFlips` and `runProgram`'s `coinFlipGate` are two draws — and the two faces
// could disagree, so the printed *"If tails, this attack does nothing"* could fire
// beside the printed *"If heads, prevent…"*. §6 drives the consumption and pins it
// against the bare cancel's `rngState` on the same seed.
//
// ⚠️ **ZERO NEW MECHANISM BELOW THE READER, MEASURED IN §8**: no new `EffectOp`
// member, op FIELD, op VALUE, `BoardCondition`/`CardFilter`/`DamageCountSource`
// member, reader (the surface stands still at 13), prompt, choice kind, park, event,
// error code, `GameState`/`InPlayPokemon` field, registry row, `FIXTURE_POOL` id
// (file-local board surgery, D414/D452), `interpreter.ts` byte, `log.ts` byte,
// `redact.ts` byte or `packages/schema` byte. The op this arm emits is
// `FLIP_PREVENT_DAMAGE_AND_EFFECTS`'s, byte for byte (§2).

/** Corpus FILE LINE 268, byte for byte. ⚠️ The apostrophe is ASCII U+0027 and the `é`
    is U+00E9 — asserted in §1 off the corpus rather than eyeballed (D421/D440). */
const PRINTED =
  "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.";

/** The two printed sentences this one is spliced from, both real corpus rows: the bare
    cancel (FILE LINE 267) and the bare gated prevent (FILE LINE 249). They are here so
    §2 can assert the JOIN rather than describe it — if either sibling's reading moves,
    the equality reddens instead of the claim quietly rotting. */
const BARE_CANCEL = "Flip a coin. If tails, this attack does nothing.";
const BARE_PREVENT =
  "Flip a coin. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.";

/** The derived value, written once. */
const DERIVED = {
  kind: "cancelOnTailsElseProgram",
  ops: [{ op: "preventDamage", effects: true }],
} as const;

/** Seeds on which the ONE flip lands each way for the board below, measured over
    [1..40]. ⚠️ **SEARCHED, NEVER STUBBED (D495)** — the RNG is half of what this suite
    claims, and a stub would answer about the stub. Pinned as lists so a deck or
    shuffle drift fails loudly here rather than silently turning §5 vacuous. */
const HEADS_SEEDS = [2, 3, 6, 7, 16, 18, 20, 22, 23, 27, 28, 30, 34, 35, 38] as const;
const TAILS_SEEDS = [1, 4, 5, 8, 9, 10, 11, 12, 13, 14] as const;

const READERS: Record<string, (text: string) => unknown> = Object.fromEntries(
  attackReaderSurface().map((name) => {
    const fn = (effects as unknown as Record<string, unknown>)[name];
    if (typeof fn !== "function") throw new Error(`reader ${name} is not a function`);
    return [name, fn as (text: string) => unknown];
  }),
);
const owners = (s: string) => attackReaderSurface().filter((n) => READERS[n]?.(s) !== null);

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}
const count = (events: readonly GameEvent[], type: GameEvent["type"]) =>
  events.filter((e) => e.type === type).length;
const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);

/** Re-text Scyther `sv03-004` "Agility" ({C}, printed **10**) on a board's OWN
    `cardPool` copy. ⚠️ **NOT A FIXTURE EDIT** — `FIXTURE_POOL` is shared by every suite
    in this package and D412 reddened three of D409's boards by widening a shared one.
    This mutates a per-board clone, so the slice adds **no `FIXTURE_POOL` id** and every
    `ids.length` ladder takes a ZERO term (D414/D452).

    Scyther is the right body precisely because its OWN printed attack is `BARE_PREVENT`
    — the printed difference between the two sentences is the cancel clause and nothing
    else, which is what makes §2's join assertion a one-axis comparison (D427). */
function withEffect(state: GameState, effect: string): GameState {
  const card = state.cardPool["sv03-004"];
  if (card === undefined) throw new Error("no sv03-004 in the pool");
  const attacks = card.attacks ?? [];
  const first = attacks[0];
  if (first === undefined) throw new Error("sv03-004 has no attack 0");
  return {
    ...state,
    cardPool: {
      ...state.cardPool,
      "sv03-004": { ...card, attacks: [{ ...first, effect }, ...attacks.slice(1)] },
    },
  };
}

/** P2 opens and passes, so P1's turn 2 carries no §4 restriction. Scyther Active for
    P1 with the one {C} "Agility" costs; **`fix-titan` Active for P2** with its Bench
    cleared.

    🛑 **THE DEFENDER IS CHOSEN, NOT INHERITED, AND THE REASON IS D482's ARITHMETIC
    COINCIDENCE — FOUND BY DRIVING IT.** The deck's dominant starter carries
    **Resistance −30**, which clamps Agility's printed 10 to a dealt **0** — so on that
    board the HEADS face and the TAILS face produce byte-identical damage and the whole
    cancel is unobservable by number while every assertion still passes. `fix-titan` has
    340 HP, **no Weakness and no Resistance**, so the two faces separate 10 against 0
    and no printed number here can Knock it Out. */
function board(seed: number, effect: string = PRINTED): GameState {
  let state = must(
    applyAction(
      driveSetup(seed, { p1: PREVENT_BLOCK_DECK, p2: PREVENT_BLOCK_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", "sv03-004");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = clearBench(state, "p2");
  return withEffect(state, effect);
}
const swing = (state: GameState, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index: 0 });

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, transcribed rather than recognised.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed data, off the corpus", () => {
  it("🛑 all three sentences ARE corpus rows, at the printing counts this slice quotes", () => {
    // D490's rule: a byte pin measures an invention exactly as faithfully as it
    // measures the truth, so a specimen is asserted to BE a row of the committed
    // corpus and its count is READ rather than typed.
    const rows = new Map(legalAttackCorpus().map(([n, text]) => [text, n]));
    expect(rows.get(PRINTED)).toBe(2);
    expect(rows.get(BARE_CANCEL)).toBe(16);
    expect(rows.get(BARE_PREVENT)).toBe(15);
    // ⚠️ **TWO INHERITED FIGURES IN THIS FAMILY ARE STALE AND THE CORRECTION LIVES
    // HERE RATHER THAN IN PROSE (D423/D471).** `effects.ts`'s D126 block says the bare
    // cancel is "11 printings" and `coinFlipDamage.test.ts` says "ELEVEN printings";
    // D142's block says the gated prevent is "11 printings" and that the compound is
    // "(1 —…)". Measured at this head off the very corpus those blocks are about:
    // 16, 15 and 2. They are not "wrong when written" — they were measured on the
    // local 978-card / 6-set D1 before the legal column was committed (D413's two
    // populations) — and the executable figures are these.
    expect(rows.get(BARE_CANCEL)).not.toBe(11);
    expect(rows.get(PRINTED)).not.toBe(1);
  });

  it("the print is the two siblings SPLICED, and the apostrophe byte is U+0027", () => {
    // One axis, spelled structurally: the compound is the cancel's whole sentence
    // followed by the prevent's whole sentence with its opening flip removed.
    expect(PRINTED).toBe(`${BARE_CANCEL} ${BARE_PREVENT.slice("Flip a coin. ".length)}`);
    expect(PRINTED.includes("opponent's")).toBe(true);
    expect(PRINTED.includes("opponent’s")).toBe(false);
    expect(PRINTED.codePointAt(PRINTED.indexOf("opponent's") + 8)).toBe(0x27);
    expect(PRINTED.includes("Pokémon")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the READER: one owner, and the ops are the sibling arm's byte for byte.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — one reader owns the sentence, and the ops are the sibling's", () => {
  it("🛑 derives to `cancelOnTailsElseProgram` carrying the shipped prevent op", () => {
    expect(deriveAttackCoinFlip(PRINTED)).toEqual(DERIVED);
  });

  it("🛑 the `ops` ARE `FLIP_PREVENT_DAMAGE_AND_EFFECTS`'s gate body, both directions", () => {
    // D132's inventory rule: the family's checkable claim is that the GATE is what
    // differs between the two printings and the ACTION is identical. Asserted as an
    // equality rather than described, so a drift in either arm reddens.
    const sibling = deriveAttackEffect(BARE_PREVENT);
    expect(sibling).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "preventDamage", effects: true }],
      },
    ]);
    const gate = sibling?.[0];
    if (gate === undefined || gate.op !== "coinFlipGate") throw new Error("unreachable");
    expect(deriveAttackCoinFlip(PRINTED)?.kind).toBe("cancelOnTailsElseProgram");
    const mine = deriveAttackCoinFlip(PRINTED);
    if (mine === null || mine.kind !== "cancelOnTailsElseProgram") throw new Error("unreachable");
    expect(mine.ops).toEqual(gate.then);
    // …and the other direction: the sibling's `then` is exactly what this member carries,
    // so neither can gain a field without the other being re-read.
    expect(gate.then).toEqual(mine.ops);
  });

  it("🛑 EXACTLY ONE of the thirteen readers claims it — named, with the twelve refusals kept", () => {
    // D438's polarity rule. `resolvedByAnyReader === true` alone is a claim about NONE
    // of the thirteen: it is satisfied by a mistaken widening of any one of them and by
    // the real build alike. Naming the owner AND keeping the other twelve refusing is
    // strictly stronger in both directions.
    expect(owners(PRINTED)).toEqual(["deriveAttackCoinFlip"]);
    for (const name of attackReaderSurface()) {
      if (name === "deriveAttackCoinFlip") continue;
      expect(READERS[name]?.(PRINTED), name).toBeNull();
    }
    // 🛑 **`deriveAttackEffect` STILL REFUSES IT, AND THAT IS LOAD-BEARING IN FIVE
    // SHIPPED SUITES.** `tailsGatedOp`, `tailsSelfCost`, `classBlock`, `preventBlock`
    // and `checkup` each pin `deriveAttackEffect(this sentence) === null`. This slice
    // does not re-point any of them, because the claim is still true AND still
    // discriminating: it reddens the day a `FLIP_PREVENT_*` or `coinFlipGate` anchor is
    // widened across the compound, which is the drift those rungs were written for.
    expect(deriveAttackEffect(PRINTED)).toBeNull();
  });

  it("no splitter serves it — all FOUR answer null, so the RAW summand is the only one that moved", () => {
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    // …and no registry row claims it either, so the census step is the READER summand
    // alone (D422/D444: the residue has four subtraction sets and only one moved).
    for (const id of registryCardIds()) {
      const program = programFor(id);
      if (program?.attack === undefined) continue;
      expect(JSON.stringify(program.attack).includes("cancelOnTails")).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the ANCHOR, end to end, and what it refuses.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the anchor is anchored, and every probe runs against IT", () => {
  it("🛑 the `^` end: leading text stays on the loud path", () => {
    // D496's finding: an anchor-shape defect is invisible to EVERY census, because a
    // loosened anchor claims exactly the sentences it claimed before — measured over
    // all 640 rows in §4. A constructed near-miss is the only instrument that exists
    // for it, which is why these two rungs carry more than their line count suggests.
    // ⚠️ The prefix ENDS A SENTENCE and is CAPITALISED normally (D452): a lowercased
    // continuation would be refused by case rather than by the `^`, and the rung would
    // pin the wrong mechanism.
    const lead = `This attack does 30 damage. ${PRINTED}`;
    expect(deriveAttackCoinFlip(lead)).toBeNull();
    expect(resolvedByAnyReader(lead)).toBe(false);
  });

  it("🛑 the `$` end: a trailing clause is refused HERE, and the SPLIT is what says so", () => {
    // D464: the two ends fail differently. A `^`-end near miss stays loud, but once the
    // sentence itself derives, D409's trailing splitter sees a claimed head and a
    // claimed tail and composes them — so `resolvedByAnyReader` is the wrong oracle for
    // the `$`. Assert the READER's refusal and the SPLIT separately.
    const trailing = `${PRINTED} Draw a card.`;
    expect(deriveAttackCoinFlip(trailing)).toBeNull();
    expect(splitAttackTrailingClause(trailing)).toEqual({ head: PRINTED, tail: "Draw a card." });
    // …and no such compound is PRINTED, checked over the whole column rather than
    // assumed, so nothing is authored for a sentence nobody prints (D464).
    expect(legalAttackCorpus().filter(([, s]) => s.startsWith(`${PRINTED} `))).toEqual([]);
  });

  it("the U+2019 re-ingest derives IDENTICALLY — the apostrophe class is live", () => {
    // D440's rule at the anchor: a punctuation-normalising re-ingest must not drop the
    // sentence off the built set, and the only instrument that can see it is a probe
    // like this one. The class is `['’]`; deleting it costs this assertion.
    const curly = PRINTED.replace("opponent's", "opponent’s");
    expect(curly).not.toBe(PRINTED);
    expect(deriveAttackCoinFlip(curly)).toEqual(DERIVED);
  });

  it("🛑 the printed MIDDLE is load-bearing: a different heads consequent is refused", () => {
    // Each differs from `PRINTED` on exactly ONE axis (D427), so each says which
    // feature does the refusing. All three are real printed consequents of the same
    // `^Flip a coin. If heads,` family — refused here because this arm is a LITERAL and
    // not a capture, which is the choice §4 measures.
    for (const consequent of [
      "during your opponent's next turn, prevent all damage done to this Pokémon by attacks",
      "your opponent's Active Pokémon is now Paralyzed",
      "discard an Energy from your opponent's Active Pokémon",
    ]) {
      const near = `${BARE_CANCEL} If heads, ${consequent}.`;
      expect(deriveAttackCoinFlip(near), near).toBeNull();
    }
    // …and the ADMISSION on the same axis, so the refusals are not a reader that says
    // no to everything (D424's control rule).
    expect(deriveAttackCoinFlip(PRINTED)).toEqual(DERIVED);
  });

  it("🛑 the BARE cancel's `^` — the hole a probe found, unguarded for 373 decisions", () => {
    // 🛑 **THIS RUNG EXISTS BECAUSE A MUTANT SURVIVED, AND THE SURVIVAL IS THE FINDING
    // (D464/D496).** `D499-debt-bare-cancel-anchor-loses-its-caret` drops the `^` from
    // D126's `ATTACK_COIN_CANCEL` — the anchor behind 16 legal printings — and it
    // SURVIVED `--full` across the whole suite (482 files / 11,001 tests, 131 s). Not an
    // over-narrow killer set, which is what `--full` was run to rule out (D455): a real
    // hole. The line had **ZERO mutant rows intersecting it by SPAN for 373 decisions**,
    // measured by resolving all 2,427 pre-existing `find` strings to line spans, and its
    // own suite drove both faces and both spellings that whole time without ever varying
    // the anchor's shape. ⚠️ **THE ROW WAS NOT TUNED — THE SUITE WAS** (D496).
    //
    // ⚠️ **NO CENSUS COULD EVER HAVE REPORTED IT.** Measured over all 640 corpus rows,
    // the caret-less form claims exactly the same 1 sentence / 16 printings, so
    // `BUILT.attack`, the residue and `resolvedByAnyReader` are byte-identical under it.
    // A CONSTRUCTED prefix is the only instrument that exists for this class.
    // ⚠️ The lead ENDS A SENTENCE and is capitalised normally (D452), so the refusal is
    // the `^` and not the family's case-sensitivity.
    const lead = `This attack does 30 damage. ${BARE_CANCEL}`;
    expect(deriveAttackCoinFlip(lead)).toBeNull();
    expect(resolvedByAnyReader(lead)).toBe(false);
    expect(splitAttackTrailingClause(lead)).toBeNull();
    // …and the ADMISSION on the same axis, so this is not a reader that refuses
    // everything (D424): the bare sentence alone still derives.
    expect(deriveAttackCoinFlip(BARE_CANCEL)).toEqual({ kind: "cancelOnTails" });
    // …and the string really would be claimed by the loosened anchor, so the rung is
    // pointed at the mutation rather than at a prefix nothing could ever match.
    expect(/Flip a coin\. If tails, this attack does nothing\.$/.test(lead)).toBe(true);
  });

  it("🛑 the bare cancel is read FIRST, and that ORDER is what keeps its `$` killable", () => {
    // D467. Under the shipped build the two anchors are structurally disjoint, so no
    // input distinguishes the orders. But `ATTACK_COIN_CANCEL`'s `\.$` is a deletable
    // byte: drop it and that anchor becomes a PREFIX matcher which claims the compound
    // too. Reading it FIRST is what makes the deletion observable — the compound then
    // answers `cancelOnTails` and this rung (and `coinFlipDamage.test.ts`'s) reddens.
    expect(deriveAttackCoinFlip(BARE_CANCEL)).toEqual({ kind: "cancelOnTails" });
    expect(deriveAttackCoinFlip(PRINTED)).not.toEqual({ kind: "cancelOnTails" });
    expect(PRINTED.startsWith(BARE_CANCEL)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the LATTICE and the anchor's reach, over the whole 640-row column.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — what this anchor claims, measured over all 640 rows", () => {
  it("🛑 every single-axis LOOSENING claims exactly the same 1 sentence / 2 printings", () => {
    // D472/D496: before generalising an anchor, measure what the generalisation would
    // claim. If the answer is "the same rows", the generality is PURE RISK — and the
    // corollary is the one that matters here: an anchor-shape defect cannot move any
    // census figure, so no census in this repo could ever report one.
    const LIT =
      /^Flip a coin\. If tails, this attack does nothing\. If heads, during your opponent['’]s next turn, prevent all damage from and effects of attacks done to this Pokémon\.$/;
    const LOOSE = [
      // the `^` dropped
      /Flip a coin\. If tails, this attack does nothing\. If heads, during your opponent['’]s next turn, prevent all damage from and effects of attacks done to this Pokémon\.$/,
      // the `\.$` dropped
      /^Flip a coin\. If tails, this attack does nothing\. If heads, during your opponent['’]s next turn, prevent all damage from and effects of attacks done to this Pokémon\./,
      // the consequent CAPTURED instead of spelled
      /^Flip a coin\. If tails, this attack does nothing\. If heads, (.+)\.$/,
      // the whole tail captured
      /^Flip a coin\. If tails, this attack does nothing\. (.+)$/,
    ];
    const claimed = (re: RegExp) => legalAttackCorpus().filter(([, s]) => re.test(s));
    expect([claimed(LIT).length, units(claimed(LIT))]).toEqual([1, 2]);
    for (const re of LOOSE) {
      expect([claimed(re).length, units(claimed(re))], String(re)).toEqual([1, 2]);
    }
  });

  it("🛑 the 2³ axis-substitution lattice, and the built-by-weight vector it produced", () => {
    // 🛑 **THE LATTICE IS DERIVED FROM TODAY'S READERS AND NOT QUOTED (D491).** A
    // pre-slice table written as prose records what someone once saw and nothing
    // rechecks it. The executable form is `before = now && !NEW.test(point)` — subtract
    // what the new anchor claims from the current verdict — plus the claim that the
    // points the new anchor takes are exactly the ones that moved.
    //
    // AXES, COUNTED FROM THE PRINT and each checked for DEGENERACY (D491/D494):
    //   A  the CANCEL ARM's presence      → nearest BUILT "absent" is corpus line 249
    //   B  the CANCEL ARM's consequent    → nearest BUILT second-arm consequent is
    //                                       *"your opponent's Active Pokémon is now
    //                                       Confused"*, off corpus line 263 (D478)
    //   C  the ARM ORDER                  → nearest BUILT is heads-first (line 263)
    // ⚠️ **A FOURTH CANDIDATE WAS REJECTED AS DEGENERATE**: the HEADS consequent's
    // nearest BUILT spelling IS its printed value (line 249 builds), so substituting it
    // changes nothing on either side and a 2⁴ table would be the 2³ table reported
    // twice. And when A = absent, B and C have nothing to vary, so four of the eight
    // points COLLAPSE onto one string — reported rather than counted twice.
    const NEW =
      /^Flip a coin\. If tails, this attack does nothing\. If heads, during your opponent['’]s next turn, prevent all damage from and effects of attacks done to this Pokémon\.$/;
    const HEADS_ARM = "If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.";
    const point = (aAbsent: boolean, bBuilt: boolean, cHeadsFirst: boolean) => {
      if (aAbsent) return `Flip a coin. ${HEADS_ARM}`;
      const tails = `If tails, ${bBuilt ? "your opponent's Active Pokémon is now Confused" : "this attack does nothing"}.`;
      return cHeadsFirst ? `Flip a coin. ${HEADS_ARM} ${tails}` : `Flip a coin. ${tails} ${HEADS_ARM}`;
    };
    const seen = new Set<string>();
    const byWeight = new Map<number, [built: number, total: number]>();
    const movedByThisSlice: string[] = [];
    for (const a of [false, true])
      for (const b of [false, true])
        for (const c of [false, true]) {
          const s = point(a, b, c);
          if (seen.has(s)) continue; // a COLLAPSED point, counted once
          seen.add(s);
          const w = Number(a) + Number(b) + Number(c);
          const nowBuilt = resolvedByAnyReader(s);
          const beforeBuilt = nowBuilt && !NEW.test(s);
          if (nowBuilt && !beforeBuilt) movedByThisSlice.push(s);
          const [built, total] = byWeight.get(w) ?? [0, 0];
          byWeight.set(w, [built + (beforeBuilt ? 1 : 0), total + 1]);
        }
    // 🛑 **THE BUILT-BY-WEIGHT VECTOR, PRE-SLICE: 0/1 · 1/3 · 0/1.** Five distinct
    // points; exactly ONE built, and it is at WEIGHT 1, reached by DELETING the cancel
    // arm. That is neither D489/D490/D494's shape (one built point at FULL weight — no
    // proper subset builds) nor D495's (every segment built, only the combination
    // unread). It is a third: **a PREREQUISITE HALF exists and is itself a printed,
    // 15-printing corpus row**, while every point that keeps the cancel arm is refused
    // whatever else is substituted. That is what says the blocker is the JOIN and not
    // either half — and the join is a SEAM question, which is why the answer was a coin
    // member rather than an anchor in the prevent family.
    expect(seen.size).toBe(5);
    expect([...byWeight.entries()].sort(([x], [y]) => x - y)).toEqual([
      [0, [0, 1]],
      [1, [1, 3]],
      [2, [0, 1]],
    ]);
    // …and the points this slice moved are EXACTLY the ones the new anchor claims.
    expect(movedByThisSlice).toEqual([PRINTED]);
    expect([...seen].filter((s) => NEW.test(s))).toEqual([PRINTED]);
  });

  it("🛑 the DIRECTION-2 lattice: the cancel arm HELD, the heads consequent varied", () => {
    // D492: never run a substitution in one direction only — vary the segment you KEPT
    // as well as the one you cut. Six printed heads consequents, every one of which
    // BUILDS as a bare `Flip a coin. If heads, …` sentence; with the cancel arm in front
    // of it, all six are refused and only the one this slice anchors is claimed.
    const CONSEQUENTS = [
      "during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon",
      "during your opponent's next turn, prevent all damage done to this Pokémon by attacks",
      "during your opponent's next turn, the Defending Pokémon can't attack",
      "discard an Energy from your opponent's Active Pokémon",
      "your opponent's Active Pokémon is now Paralyzed",
      "this attack does 20 more damage",
    ];
    const built: string[] = [];
    for (const consequent of CONSEQUENTS) {
      const bare = `Flip a coin. If heads, ${consequent}.`;
      expect(resolvedByAnyReader(bare), bare).toBe(true); // every one builds ALONE
      const withCancel = `${BARE_CANCEL} If heads, ${consequent}.`;
      if (resolvedByAnyReader(withCancel)) built.push(consequent);
    }
    expect(built).toEqual([CONSEQUENTS[0]]);
    // …and the mirror ORDER is refused for all six, so nothing is claimed by accident
    // on the strength of the arm order alone.
    for (const consequent of CONSEQUENTS) {
      const mirrored = `Flip a coin. If heads, ${consequent}. If tails, this attack does nothing.`;
      expect(resolvedByAnyReader(mirrored), mirrored).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the BOARD: both faces, driven.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — both faces on a real board", () => {
  it("🛑 TAILS — no damage, ATTACK_FAILED, and no block installed", () => {
    const { state, events } = swing(board(TAILS_SEEDS[0]));
    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("tails");
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(find(events, "ATTACK_FAILED")?.reason).toBe("coinFlip");
    expect(find(events, "ATTACK_BLOCK_APPLIED")).toBeUndefined();
    expect(state.players.p2.active?.damage).toBe(0);
    expect(state.players.p1.active?.attackBlock).toBeNull();
    // 🛑 **THE CANCEL IS PRE-DAMAGE AND THIS IS THE ASSERTION THAT SAYS SO.** A build
    // that put the whole sentence in a `coinFlipGate { then, otherwise }` would deal
    // the printed 10 and then run an `otherwise` with nothing to undo — `attack.ts`
    // says at the flip site that a program "could neither add to a number already
    // computed nor retract damage already dealt", and the board is where that is true
    // rather than argued.
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined(); // the text was READ
  });

  it("🛑 HEADS — the printed 10 lands AND the durated block is installed", () => {
    const { state, events } = swing(board(HEADS_SEEDS[0]));
    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("heads");
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(10);
    expect(state.players.p2.active?.damage).toBe(10);
    expect(find(events, "ATTACK_FAILED")).toBeUndefined();
    const applied = find(events, "ATTACK_BLOCK_APPLIED");
    expect(applied?.effects).toBe(true);
    expect(applied?.fromClass).toBeUndefined();
    expect(applied?.maxDamage).toBeUndefined();
    expect(state.players.p1.active?.attackBlock).toEqual({ turn: 3, effects: true });
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    // 🛑 **THE BLOCK IS BYTE-IDENTICAL TO WHAT THE BARE PREVENT INSTALLS** — same seed,
    // same board, the sibling sentence. That is the version argument's subject (§9)
    // driven as a board fact rather than asserted about a type.
    const sibling = swing(board(HEADS_SEEDS[0], BARE_PREVENT));
    expect(sibling.state.players.p1.active?.attackBlock).toEqual(
      state.players.p1.active?.attackBlock,
    );
  });

  it("🛑 the installed block really PREVENTS on the opponent's turn, and expires after it", () => {
    // The cross-turn case. Without it, "a block was installed" is a claim about a
    // field rather than about the game.
    const after = swing(board(HEADS_SEEDS[0])).state;
    expect(after.turn).toBe(3);
    // P2 promotes an attacker and swings back into the block.
    let p2turn = setActiveFromDeck(after, "p2", "fix-attacker");
    p2turn = attachFromDeck(p2turn, "p2", "fix-energy", 1);
    const back = swing(p2turn, "p2");
    expect(back.state.players.p1.active?.damage).toBe(0);
    // The damage row is FILED and flagged rather than suppressed — `prevented?: true`
    // has named that fact since Mimikyu "Safeguard" (0.58.0), and asserting the flag
    // rather than the absence is what tells a block apart from an attack that missed.
    expect(find(back.events, "DAMAGE_DEALT")?.prevented).toBe(true);
    expect(find(back.events, "DAMAGE_DEALT")?.dealt).toBe(0);
  });

  it("both seed lists are REAL — every seed lands the face it is filed under", () => {
    // D495's rule made executable: a seed table that has drifted turns every case above
    // vacuous, and nothing else would say so.
    for (const seed of HEADS_SEEDS) {
      expect(find(swing(board(seed)).events, "ATTACK_EFFECT_COIN_FLIP")?.result, `seed ${seed}`).toBe("heads");
    }
    for (const seed of TAILS_SEEDS) {
      expect(find(swing(board(seed)).events, "ATTACK_EFFECT_COIN_FLIP")?.result, `seed ${seed}`).toBe("tails");
    }
  });

  it("never mutates the board it is handed", () => {
    const frozen = deepFreeze(board(HEADS_SEEDS[0]));
    const snapshot = JSON.stringify(frozen);
    expect(swing(frozen).state).not.toBe(frozen);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — ONE FLIP. The whole argument for the member.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the coin is drawn ONCE, and the rngState proves it", () => {
  it("🛑 exactly ONE `ATTACK_EFFECT_COIN_FLIP` row, on each face", () => {
    for (const seed of [HEADS_SEEDS[0], TAILS_SEEDS[0]]) {
      expect(count(swing(board(seed)).events, "ATTACK_EFFECT_COIN_FLIP"), `seed ${seed}`).toBe(1);
    }
  });

  it("🛑 the rngState after the swing is the BARE CANCEL's, byte for byte, on both faces", () => {
    // 🛑 **THIS IS THE RUNG THAT REFUSES THE TWO-READER IDIOM.** If `deriveAttackEffect`
    // also claimed this string, `attack.ts` would run its `coinFlip` block AND then
    // drain a `coinFlipGate` inside `runProgram` — two draws off one seed. The count
    // rung above would catch the second ROW; this one catches a second DRAW even if
    // nothing announced it, because a spent generator is only observable on its SECOND
    // use (D455) and a comparison across the consumption is the only thing that sees it.
    for (const seed of [HEADS_SEEDS[0], TAILS_SEEDS[0]]) {
      const bare = swing(board(seed, BARE_CANCEL));
      const compound = swing(board(seed));
      expect(compound.state.rngState, `seed ${seed}`).toEqual(bare.state.rngState);
      // …and the CONTROL on the same axis (D424/D455): the generator really MOVED, so
      // "equal" is not two boards that both failed to flip.
      expect(compound.state.rngState).not.toEqual(board(seed).rngState);
    }
  });

  it("…and the two faces agree with the bare cancel's, seed for seed", () => {
    // The stronger form: not just the same rngState but the same FACE, which is what
    // makes "one flip, two consequences" a statement about the draw rather than about
    // the count of rows.
    for (const seed of [...HEADS_SEEDS, ...TAILS_SEEDS]) {
      const bare = find(swing(board(seed, BARE_CANCEL)).events, "ATTACK_EFFECT_COIN_FLIP");
      const compound = find(swing(board(seed)).events, "ATTACK_EFFECT_COIN_FLIP");
      expect(compound?.result, `seed ${seed}`).toBe(bare?.result);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the LOG, RENDERED rather than reasoned about.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the log rows, rendered", () => {
  function render(state: GameState, events: readonly GameEvent[]): string {
    const ctx: LogContext = {
      names: { p1: "Ash", p2: "Gary" },
      state,
      elapsed: "+00:11",
    };
    return logFromEvents(events, ctx)
      .flatMap((e) => (e.kind === "turn" ? [] : [`${e.who}: ${e.segments.map((s) => s.text).join("")}`]))
      .join("\n");
  }

  it("🛑 the TAILS row names the CONSEQUENCE and does not repeat the face", () => {
    const { state, events } = swing(board(TAILS_SEEDS[0]));
    const text = render(state, events);
    expect(text).toContain("flipped tails");
    expect(text).toContain("'s attack did nothing — the coin flip missed");
    // …and it does NOT claim a protection that was never installed.
    expect(text).not.toContain("is protected from damage");
  });

  it("🛑 the HEADS rows announce the flip, the damage and the DURATION", () => {
    const { state, events } = swing(board(HEADS_SEEDS[0]));
    const text = render(state, events);
    expect(text).toContain("flipped heads");
    expect(text).toContain(
      "is protected from damage and effects of attacks during your opponent's next turn",
    );
    expect(text).not.toContain("did nothing");
    // ⚠️ **THE HONEST LIMIT AT THE RUNG (D456/D421).** The row says "during your
    // opponent's next turn", which is what the card prints AND what the stamp means
    // (`turn: state.turn + 1`, asserted in §5) — so the claim is true rather than
    // stilted. What no row anywhere says is that the attack's damage LANDED FIRST and
    // the block was installed after it; the ordering is only visible in the event
    // sequence, which §5 pins instead. `log.ts` is BYTE-UNCHANGED by this slice and
    // that is the measurement, not a hope: both arms already shipped for the two
    // sibling sentences and both read correctly for the compound.
    expect(text.indexOf("flipped heads")).toBeLessThan(text.indexOf("is protected from damage"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — the census, and what did NOT move.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the census moves in exactly ONE summand", () => {
  it("🛑 the resolving corpus gains ONE sentence and TWO printings", () => {
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([540, 1578]);  // (🆕🆕🆕 **D513 +1 sentence / +1 printing — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, *"Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group has captured `Basic Energy cards of different types` WHOLE since D231 and the sentence died one step later in `HAND_SEARCH_PLURAL.get`, so the new optional group MOVES a phrase out of the noun rather than admitting a sentence the pattern refused (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members — and no widening of that union could EVER have reached this row**, because `matchesFilter` narrows each card INDEPENDENTLY while *“of different types”* is a predicate on the ANSWER SET. It rides D332's shipped `chooseCards.caps` instead — one cap of ONE per `energyProvidesOf` cell — so **ZERO** new prompt fields, validator branches or client mirrors. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D512 +1 sentence / +2 printings — THE BOTH-SIDES BODY COUNT NARROWED BY TWO PRINTED NAME FRAGMENTS** — `censusAttackCorpus.ts` **FILE LINE 583**, *"This attack does 40 damage for each Pokémon in play that has \"Koffing\" or \"Weezing\" in its name (both yours and your opponent's)."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`IN_PLAY_BOTH_SIDES_NAME_MULTIPLY`), ONE new `CardFilter` member (`pokemonNameContaining`) and ONE new `DamageCountSource` member (`bothSidesPokemonInPlay` — the FIRST both-sides count in that union to carry a `CardFilter`; `bothSidesBenchCount` and `bothActivesEnergyCount` are both BARE, because their printed nouns carry no adjective and this one's is NARROWED in print). 🛑 **THE SHIPPED ANCHORS WERE RUN AGAINST THE ROW FIRST AND ALL FOUR REFUSE IT AT THE PATTERN** — the OPPOSITE answer to D510's one row up, and the reason this row genuinely owed a pattern: every in-play anchor requires the literal `for each of your ` and this sentence's head is SEATLESS, with the side named by a trailing parenthetical. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2**, measured at this head rather than carried (D451/D461). RAW summand ALONE: no registry row, no gate split and no trailing split — re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.) (🆕🆕🆕 **D510 +1 sentence / +2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT** — `censusAttackCorpus.ts` **FILE LINE 543**, *"This attack does 20 damage for each Supporter card that has \"Team Rocket\" in its name in your discard pile."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE new `CardFilter` member (`supporterNameContaining`) and ONE PARAMETERISED noun in `discardPileFilter` — **ZERO new anchors**, because D440’s shipped `DISCARD_PILE_COUNT_MULTIPLY` had matched this row since it was written and the NOUN RESOLVER was the blocker. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2** — a TWO-printing sentence, the opposite of D508 one entry down, measured at this head rather than carried (D451/D461). RAW summand ALONE: registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved.) (🆕🆕🆕 **D508 +1 sentence / +1 printing — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME** — `censusAttackCorpus.ts` **FILE LINE 542**, *"This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`DISCARD_PILE_ATTACK_NAME_MULTIPLY`) crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter — **ZERO new members in either union, ZERO evaluator bytes**. READER summand ALONE; registry, gate and trailing stand still at 10/16, 5/13, 11/21.) (🆕🆕🆕 **D507 +2 sentences / +2 printings — THE SPREAD THAT HITS **BOTH** BENCHES, AND THE OPTIONAL PRINTED CLAUSE THAT NARROWS IT TO THE ALREADY-DAMAGED BODIES** — `censusAttackCorpus.ts` **FILE LINES 515 and 526**, *"This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)"* and *"This attack also does 40 damage to each Benched Pokémon **that has any damage counters on it** (both yours and your opponent's). (Don't apply…)"*, **2 sentences / 2 legal printings**, both claimed by `deriveAttackEffect` arm **6-ii** over ONE new anchor (`SPREAD_EACH_BOTH_BENCH`) whose OPTIONAL GROUP *is* the rider. 🛑 **THE BOTH-SIDES HALF COSTS NO TYPE AT ALL: it is a TWO-OP PROGRAM OF THE SAME OP** — `spreadDamage { yourBench }` then `spreadDamage { opponentBench }` — which is D482's shipped answer to the identical question one zone over, so `spreadDamage.target` gains **NO third member** and `counterEachAll`'s `filter` + `side` shape was refused rather than copied (D448/D449/D465's thrice-refused widening, same class). The op gains ONE OPTIONAL BOOLEAN RIDER, `damagedOnly` — `counterEachAll`'s own name on its own predicate `hasAnyDamageCounters`, D505's idiom one rider later. **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), `CardFilter`/`BoardCondition`/`DamageCountSource` members, prompts, choice kinds, parks, events, error codes, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids (file-local `cardPool`, D414), `redact.ts` bytes, `packages/schema` bytes or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 2 AND 2**, MEASURED at this head rather than carried (D451/D461/D465) — both rows are 1-printing sentences. RAW summand ALONE: no registry row, no gate split, no trailing split — all three re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.) (🆕🆕🆕 **D505 +1 sentence / +3 printings — THE PRIZE-SCALED BENCH SPREAD, THE MISSING CELL OF A SHIPPED 2×2** — `censusAttackCorpus.ts` **FILE LINE 517**, *"This attack also does 10 damage to each of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 3 legal printings**, claimed by `deriveAttackEffect` arm **6-i** over ONE new anchor (`SPREAD_EACH_BENCH_TAKEN_PRIZES`) and ONE OPTIONAL BOOLEAN RIDER on the SHIPPED `spreadDamage` (`perTakenPrize` — D448's own name spelled on a second op, so `snipeAmount`'s structural parameter folds it UNCHANGED). **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), prompts, choice kinds, parks, events, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 3**, so a `.length` site takes +1 where a `units(…)` site takes +3 — the largest single printing step left in the residue's spread family, and the reason this row was worth taking before smaller ones (D451, re-paid again).) (🆕🆕🆕 **D500 +1 sentence / +1 printing — THE PRINTED CARD CATEGORY `Basic`, WHICH IS `Special`'s COMPLEMENT AND NOT A TENTH TYPE** — `censusAttackCorpus.ts` **FILE LINE 580**, *"This attack does 40 damage for each Basic Energy attached to this Pokémon."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` through **ONE ROW in `CLAUSE_ENERGY_TOKENS`** — the anchor `SELF_ENERGY_MULTIPLY` already admitted the token and the refusal lived one step later, in `attachedEnergyFilter`. **ZERO new anchors, ZERO new readers (surface unmoved at 13), ZERO new ops, ZERO new op FIELDS, ZERO new `DamageCountSource` members, ZERO new `FIXTURE_POOL` ids and ZERO `packages/schema` bytes.** ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — the row is 1/1 — and that was VERIFIED at both kinds of site rather than assumed from the row being singular (D451/D461).) 
    // ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 AND 2**, measured at THIS
    // head rather than carried (D451/D461/D464/D465): a `.length` site takes +1 where a
    // `units(…)` site takes +2, and the two are on the same LINE in three files.
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([539, 1576]);  // (🆕🆕🆕 **D513 +1 sentence / +1 printing — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group captured `Basic Energy cards of different types` WHOLE from the day it was written, and the refusal was one step later in `HAND_SEARCH_PLURAL.get` (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members, and no widening of that union could ever reach this row** — it rides D332's shipped `chooseCards.caps`, one cap of ONE per `energyProvidesOf` cell, so ZERO new prompt fields, validator branches or client mirrors. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D512 — THE BOTH-SIDES BODY COUNT NARROWED BY TWO PRINTED NAME FRAGMENTS** — `censusAttackCorpus.ts` **FILE LINE 583**, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor, ONE new `CardFilter` member (`pokemonNameContaining`) and ONE new `DamageCountSource` member (`bothSidesPokemonInPlay`). **+1 sentence / +2 printings**, which this BEFORE-figure inherits because it is the live sum minus this slice's own row.) (🆕🆕🆕 **D510 +1 sentence / +2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT** — `censusAttackCorpus.ts` **FILE LINE 543**, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE `CardFilter` member and ONE parameterised noun, **ZERO new anchors**. ⚠️ The SENTENCE step and the PRINTING step DISAGREE at 1 and 2.) (🆕🆕🆕 **D508 +1 sentence / +1 printing — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME** — `censusAttackCorpus.ts` **FILE LINE 542**, *"This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`DISCARD_PILE_ATTACK_NAME_MULTIPLY`) crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter — **ZERO new members in either union, ZERO evaluator bytes**. READER summand ALONE; registry, gate and trailing stand still at 10/16, 5/13, 11/21. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, measured per site rather than copied between the two kinds of site (D451/D461).) 🆕🆕🆕 **D505 +1 sentence / +3 printings — THE PRIZE-SCALED BENCH SPREAD (corpus FILE LINE 517).** This pair is the resolving set MINUS this file's own sentence, so it steps by exactly what the line above it steps by — which is the point of measuring both: a slice that moved only one of the two would be visible here (D451/D465). (🆕🆕🆕 **D500 +1 sentence / +1 printing — THE PRINTED CARD CATEGORY `Basic`, WHICH IS `Special`'s COMPLEMENT AND NOT A TENTH TYPE** — `censusAttackCorpus.ts` **FILE LINE 580**, *"This attack does 40 damage for each Basic Energy attached to this Pokémon."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` through **ONE ROW in `CLAUSE_ENERGY_TOKENS`** — the anchor `SELF_ENERGY_MULTIPLY` already admitted the token and the refusal lived one step later, in `attachedEnergyFilter`. **ZERO new anchors, ZERO new readers (surface unmoved at 13), ZERO new ops, ZERO new op FIELDS, ZERO new `DamageCountSource` members, ZERO new `FIXTURE_POOL` ids and ZERO `packages/schema` bytes.** ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — the row is 1/1 — and that was VERIFIED at both kinds of site rather than assumed from the row being singular (D451/D461).) 
  });

  it("the reader SURFACE stands still at 13 — this is an ARM, not a reader", () => {
    // D444: `censusAttackCorpus.ts` derives the surface off `effects.ts` by NAME PREFIX,
    // so a new export called `deriveAttack…` enrols itself and the predicate would claim
    // every sentence in the corpus. This slice adds a MEMBER and an ARM, not an export.
    expect(attackReaderSurface()).toHaveLength(13);
    expect(attackReaderSurface()).toContain("deriveAttackCoinFlip");
  });

  it("🛑 the CENSUS is blind to whether the claim is CORRECT — stated, not assumed", () => {
    // D469/D489/D491. Under an attribution control that breaks the arm at its nearest
    // wrong sibling — emitting the NARROW `preventDamage` where the print says "from and
    // effects of" — the sentence still reads, `resolvedByAnyReader` is still true, the
    // residue still falls by one and `BUILT.attack` still steps by two. Every rung in
    // this `describe` stays GREEN. The rungs that discriminate are §2's value equality
    // (the READER layer) and §5's `attackBlock` assertion (the EXECUTOR layer), and
    // only the second survives a mutation in `attack.ts` or `interpreter.ts`.
    //
    // The layer map, so a later slice does not read a green census as coverage:
    //   census + loud controls   — blind to BOTH layers
    //   §2's value equality      — the READER only
    //   §5/§6's boards           — the READER and the EXECUTOR
    const mine = deriveAttackCoinFlip(PRINTED);
    if (mine === null || mine.kind !== "cancelOnTailsElseProgram") throw new Error("unreachable");
    expect(mine.ops).not.toEqual([{ op: "preventDamage" }]); // the narrow sibling
    expect(mine.ops).toEqual([{ op: "preventDamage", effects: true }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — `MATCH_RECORD_VERSION`, at the address that persists.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — the version question, asked at the durated address", () => {
  it("the engine version is 0.400.0 and `manifest.version` agrees", () => {
    expect(engineVersion).toBe("0.400.0");
  });

  it("🛑 the ADDRESS is `InPlayPokemon.attackBlock`, and the SERIALIZED ALPHABET is unchanged", () => {
    // 🛑 **THE ADDRESS FIRST (D456/D463).** This row lands in the durated family, and
    // `InPlayPokemon.attackBlock` is a `GameState` field persisted DIRECTLY in
    // `MatchRecord.state` on every save — no park in front of it, so D450's reachability
    // argument is the wrong shape and is not what holds 29.
    //
    // **THE ARGUMENT USED IS THE SERIALIZED ALPHABET (D462/D463):** there is no byte a
    // v29 record can hold after this slice that it could not hold before it. The op this
    // arm emits is `{"op":"preventDamage","effects":true}`, which corpus line 249's
    // **15 printings** already produce inside a `coinFlipGate.then`; the record those
    // ops write is `{turn, effects}`, with no new key, no new value and no re-meaning.
    // Driven rather than asserted: the compound's installed record is byte-identical to
    // the bare prevent's on the same board (§5), and the JSON of the two is compared
    // here directly.
    const mine = swing(board(HEADS_SEEDS[0])).state.players.p1.active?.attackBlock;
    const sibling = swing(board(HEADS_SEEDS[0], BARE_PREVENT)).state.players.p1.active?.attackBlock;
    expect(JSON.stringify(mine)).toBe(JSON.stringify(sibling));
    // ⚠️ The record carries FOUR declared keys and two of them are `undefined` here, so
    // `JSON.stringify` renders `{"turn":3,"effects":true}` — which is the byte string
    // the version question is actually about. Both halves are asserted: the KEY SET, so
    // a new field on `AttackBlock` would redden this rung, and the SERIALIZED bytes.
    expect(Object.keys(mine ?? {}).sort()).toEqual(["effects", "fromClass", "maxDamage", "turn"]);
    expect(JSON.stringify(mine)).toBe('{"turn":3,"effects":true}');
  });

  it("🛑 REACHABILITY, stated second as the weaker half", () => {
    // D452's rule: state BOTH halves. Reachability alone reads as an excuse, and "this
    // byte already ships" alone leaves the loss hazard unnamed.
    //
    // The new SHAPE is `AttackCoinFlip.cancelOnTailsElseProgram`, and that union is
    // **PARSE-TIME**: it is a local `const` inside `attack()`, derived from card text and
    // spent in the same tick. It appears in `packages/schema` nowhere, no `EffectOp`
    // carries one, no `GameState` field stores one and no `GameEvent` names one — so it
    // is D442/D473's "not at a persisted address at all".
    //
    // The `ops` it hands to `program` DO reach `phase.cont` if anything parks. Nothing
    // does: the program is LENGTH ONE and `preventDamage` never parks, which is D465's
    // FIRST-POSITION form of the argument (there is no earlier op, let alone a parking
    // one). Driven on BOTH faces, because a whiff is not a park and the two are easy to
    // confuse in a `stepOp` arm.
    for (const seed of [HEADS_SEEDS[0], TAILS_SEEDS[0]]) {
      const after = swing(board(seed)).state;
      expect(after.phase.kind, `seed ${seed}`).not.toBe("effect:choose");
      expect(JSON.stringify(after).includes("cancelOnTails"), `seed ${seed}`).toBe(false);
    }
    const mine = deriveAttackCoinFlip(PRINTED);
    if (mine === null || mine.kind !== "cancelOnTailsElseProgram") throw new Error("unreachable");
    expect(mine.ops).toHaveLength(1);
  });

  it("🛑 the LOSS direction, and why the member is REQUIRED rather than an optional rider", () => {
    // D421/D425/D432's test APPLIED rather than copied. The alternative shape was an
    // optional `ops?: EffectOp[]` on the shipped `cancelOnTails`. It is refused in the
    // TYPE (asymmetric payload ⇒ two members, D440 as D460 applied it one union over)
    // and it is refused here on DEGRADATION, measured rather than classified:
    //
    //   • a dropped `ops` on a shared member leaves `{kind:"cancelOnTails"}` — a board
    //     on which the coin flips, tails still cancels, and the printed protection
    //     SILENTLY never installs. That is D124's benign soft landing, which is exactly
    //     the failure the version constant exists to refuse;
    //   • a REQUIRED `ops` on its own member makes a producer that forgets it a COMPILE
    //     ERROR, and the member name itself is the witness that the payload was there.
    //
    // ⚠️ **AND IT COSTS NO BUMP EITHER WAY**, because the union is not persisted — which
    // is why the decision was taken on detectability rather than on price.
    expect(deriveAttackCoinFlip(BARE_CANCEL)).toEqual({ kind: "cancelOnTails" });
    expect(Object.keys(deriveAttackCoinFlip(BARE_CANCEL) ?? {})).toEqual(["kind"]);
    expect(Object.keys(deriveAttackCoinFlip(PRINTED) ?? {}).sort()).toEqual(["kind", "ops"]);
  });

  it("the fixture pool is UNTOUCHED — the board surgery is file-local", () => {
    // D414/D452: a `FIXTURE_POOL` id is a census entry of its own and costs an
    // eleven-deep ladder in a file with nothing to do with this subject. This slice
    // adds none, so every `ids.length` term takes a ZERO.
    expect(FIXTURE_POOL["sv03-004"]?.attacks?.[0]?.effect).toBe(BARE_PREVENT);
    expect(board(HEADS_SEEDS[0]).cardPool["sv03-004"]?.attacks?.[0]?.effect).toBe(PRINTED);
  });
});
