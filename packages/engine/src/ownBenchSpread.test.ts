import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, engineVersion, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  OWN_BENCH_SPREAD_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setPrizes,
  types,
} from "./testFixtures";

// 0.326.0 → 0.327.0 — D425, THE OWN-SIDE BENCH-WIDE SPREAD:
//
//   "This attack also does {N} damage to each of your Benched Pokémon.
//    (Don't apply Weakness and Resistance for Benched Pokémon.)"
//
// 3 sentences / 5 legal printings (10 ×3, 20 ×1, 30 ×1) over `legalAttackCorpus()`'s
// 640 sentences / 1,732 printings — the `legal_standard = 1` attack column.
//
// 🛑 **ZERO NEW ANCHORS, ZERO NEW READERS: THE POSSESSIVE BECAME A CAPTURE.**
// `SPREAD_EACH_BENCH` has claimed the opponent-side twin since the `spreadDamage`
// op existed. D425 replaced its literal `your opponent's` with the alternation
// `(your opponent['’]s|your)` and the shipped arm resolves `target` off group 2. A
// second `SPREAD_EACH_YOUR_BENCH` regex would have been this one with two words
// changed — D416's copied-function hazard, where the corpus goes QUIET rather than
// red — and would have let a future "also" rider or apostrophe class drift onto one
// wording and not the other.
//
// 🛑 **AND THE OP'S `target` WAS DEAD CODE UNTIL THIS SLICE.** It was the singleton
// literal `"opponentBench"`, and `interpreter.ts`'s arm read `op.amount` alone. The
// field documented an intention nothing checked. Widening the union is what turns
// forgetting to read it into a type error.
//
// ⚠️⚠️ **THE MECHANISM THE SENTENCE DOES NOT ADVERTISE, AND THE WHOLE REASON THIS
// FILE IS LONG: THIS IS THE FIRST ATTACK IN THE ENGINE WHOSE OWN DAMAGE CAN KNOCK
// OUT ITS USER'S OWN POKÉMON, AND A KNOCKED OUT POKÉMON GIVES THE *OPPONENT* A
// PRIZE.** Every producer of `spreadDamage` before D425 hit the other side of the
// table, so §8.1's own-side path had never been reached from an attack's own
// damage. §6 and §7 DRIVE it — the Prize, the game end, the promotion question and
// D189's addressing invariant — rather than inheriting any of it from a comment.
// The engine needed no new code for a single one of the four.
//
// ⚠️ **WHAT *DID* NEED A MECHANISM WAS THE LOG (§9).** `log.ts` rendered every
// `DAMAGE_DEALT` row under `otherSeat(event.seat)`, which encodes *"whoever was
// damaged, the OTHER player did it"* — D222's negated-closed-world shape on a log
// row. It was true of every board this engine could produce and true BY ACCIDENT:
// all four write sites aimed across the table, and `damageSelf`, the one op that
// does not, emits `COUNTERS_PLACED` and never this row. So the row credited the
// DEFENDER with damage the ATTACKER had just done to its own Bench, and
// `DAMAGE_DEALT` gained a REQUIRED `by: Seat`.
//
// ⚠️ **THE APOSTROPHE BYTE IS MEASURED, NOT REMEMBERED (D421).** `hexdump -C` on
// `censusAttackCorpus.ts` line 516 returns `44 6f 6e 27 74` — `Don't` with U+0027,
// never U+2019 — and the own-side sentence carries NO possessive at all, so that
// contraction is its ONLY apostrophe slot. §1 pins both halves.

/** One seed for the whole suite. Nothing declared here flips a coin, and every
    Active, benched body, damage total and Prize row is placed by surgery — so a
    seed table would describe a shuffle rather than a rule (D143's move, inherited
    by every spread suite since). */
const SEED = 5;

/** The three printed own-side sentences, transcribed off `censusAttackCorpus.ts`
    lines 516 / 521 / 524. `AMOUNTS` is the axis D121's template warrant is met on:
    three DISTINCT amounts are printed, so the `(\d+)` capture has three witnesses
    in the pool and is not a template over a population of one. */
const AMOUNTS = [10, 20, 30] as const;
const own = (n: number) =>
  `This attack also does ${n} damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)`;
/** The SHIPPED opponent-side twin, the sentence this anchor has always claimed —
    the control without which every "the own side is read" rung below would be
    consistent with a reader that claims everything (D424's rule). */
const opp = (n: number) =>
  `This attack also does ${n} damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)`;

/** The attack indices this suite drives, keyed by name so no case addresses a fold
    by number. `fix-tremor` carries BOTH possessives of ONE shape at ONE amount, so
    the SIDE is the only difference between its two indices — which is what makes a
    wrong-side build fail rather than pass. */
const TREMOR = { home: 0, away: 1 } as const;
/** The two REAL carriers, at their printed indices. Both were in `FIXTURE_POOL`
    before this slice as DECLARED-UNSIMULATED siblings (D170, D129). */
const QUAKE = { krookodile: 1, tyranitar: 1 } as const;

const ENERGY: Record<string, { id: string; count: number }[]> = {
  "fix-tremor": [{ id: "fix-energy", count: 2 }],
  "sv01-117": [{ id: "fix-fighting-energy", count: 2 }],
  "swsh10.5-043": [
    { id: "fix-darkness-energy", count: 2 },
    { id: "fix-energy", count: 2 },
  ],
};

/** `by`'s opponent opens and passes, so the attacking seat carries no §4 first-turn
    restriction. BOTH Actives are placed by surgery and BOTH benches are cleared to
    nothing: every number this suite measures is a POPULATION over a bench, so a body
    the setup shuffle happened to place would silently move the answer. */
function board(attacker: string, defender: string, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: OWN_BENCH_SPREAD_DECK, p2: OWN_BENCH_SPREAD_DECK }, { first: opener }),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, attacker);
  state = clearBench(state, by);
  for (const { id, count } of ENERGY[attacker] ?? []) {
    state = attachFromDeck(state, by, id, count);
  }
  state = setActiveFromDeck(state, opener, defender);
  return clearBench(state, opener);
}

function bench(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) next = benchFromDeck(next, seat, id);
  return next;
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

/** Every `DAMAGE_DEALT` row in order, flattened to the three fields every case
    below reads: who owns the damaged body, who DEALT it, and how much landed. */
function damage(events: GameEvent[]): { seat: Seat; by: Seat; dealt: number }[] {
  return events.flatMap((e) =>
    e.type === "DAMAGE_DEALT" ? [{ seat: e.seat, by: e.by, dealt: e.dealt }] : [],
  );
}

function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, and the byte that D421 got wrong from memory.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed data: three amounts, two real cards, one constructed pair", () => {
  it("the corpus prints exactly these three sentences at exactly these counts", () => {
    // 🛑 **PINNED ON THE POPULATION, NOT ON A SPECIMEN (D423).** The claim is not
    // "this hand-written string derives" — that would be green forever and would
    // mean nothing about the pool. It is that the committed `legal_standard = 1`
    // attack column holds these three rows at these printing counts and no other
    // row of this shape at all.
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(own(10))).toBe(3);
    expect(rows.get(own(20))).toBe(1);
    expect(rows.get(own(30))).toBe(1);
    // …and the family is CLOSED at three: every corpus row whose text is an
    // own-side "each of your Benched" spread is one of these three. The predicate
    // is deliberately looser than the anchor (no "also", no W/R tail, no leading
    // "This attack"), so a fourth wording would be caught rather than excluded.
    const family = legalAttackCorpus().filter(
      ([, s]) => /damage to each of your Benched Pokémon/.test(s) && !/opponent/.test(s),
    );
    expect(family.map(([, s]) => s).sort()).toEqual([own(10), own(20), own(30)].sort());
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(5);
  });

  it("🛑 the apostrophe byte is U+0027 and there is exactly ONE slot", () => {
    // ⚠️ **D421 ASSERTED THIS FROM MEMORY AND WAS WRONG.** Measured with
    // `hexdump -C` on `censusAttackCorpus.ts` line 516: `… 28 44 6f 6e 27 74 …` —
    // `(Don't`, U+0027 APOSTROPHE. The é in "Pokémon" is `c3 a9`, U+00E9, which is
    // the OTHER byte this family has always cared about.
    const sentence = own(10);
    expect(sentence).toContain("Don't");
    expect(sentence).not.toContain("’");
    expect(sentence).toContain("Pokémon");
    // ⚠️ **AND THE COUNT OF SLOTS IS THE POINT, not just the byte.** The
    // opponent-side twin carries TWO apostrophe positions (the possessive and the
    // contraction); the own-side sentence carries ONE, because the possessive is
    // exactly the token D425 turned into a capture. A slice reasoning about this
    // family from the shipped sentence alone would predict two.
    expect(sentence.split(/['’]/).length - 1).toBe(1);
    expect(opp(10).split(/['’]/).length - 1).toBe(2);
  });

  it("the two REAL carriers print it at their printed index, and were carried UNSIMULATED", () => {
    // 🛑 **NO FIXTURE WAS WRITTEN FOR THE 20 OR THE 30.** Both have been in
    // `FIXTURE_POOL` for hundreds of decisions as DECLARED-UNSIMULATED siblings —
    // D129 carried Krookodile's "Earthquake" and D170 carried Tyranitar's, each
    // stating the gap out loud rather than hiding it behind a card that looks fully
    // simulated (D169's convention). D425 is what makes those admissions expire,
    // and `benchCounterMultiply.test.ts` / `benchBodyScaling.test.ts` carry the
    // re-pointed rungs.
    expect(FIXTURE_POOL["sv01-117"]?.attacks?.[QUAKE.krookodile]).toMatchObject({
      name: "Earthquake",
      cost: ["Fighting", "Fighting"],
      effect: own(30),
      damage: 180,
    });
    expect(FIXTURE_POOL["swsh10.5-043"]?.attacks?.[QUAKE.tyranitar]).toMatchObject({
      name: "Earthquake",
      cost: ["Darkness", "Darkness", "Colorless", "Colorless"],
      effect: own(20),
      damage: 180,
    });
  });

  it("`fix-tremor` carries BOTH possessives of ONE shape, and the SIDE is the only difference", () => {
    // 🛑 **THIS IS WHY THE FIXTURE IS A PAIR AND NOT A CARD.** Same cost, same
    // printed damage, same amount, same attacker, same board, two indices — a build
    // that resolved `target` to the wrong bench passes every single-index probe in
    // the repo and fails this one. §4 drives the pair on one board.
    expect(FIXTURE_POOL["fix-tremor"]?.attacks).toEqual([
      {
        cost: ["Colorless", "Colorless"],
        name: "Home Tremor",
        effect: own(10),
        damage: 30,
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Away Tremor",
        effect: opp(10),
        damage: 30,
      },
    ]);
    expect(FIXTURE_POOL["fix-tremor"]?.types).toEqual(["Fighting"]);
    expect(FIXTURE_POOL["fix-tremor"]?.hp).toBe(140);
  });

  it("AUTHORS nothing — all three printings are read off the TEXT", () => {
    // A registry-authored program would win over the reader (D8), so this is the
    // claim that says the text path is the one being driven below.
    for (const id of ["fix-tremor", "sv01-117", "swsh10.5-043"]) {
      expect(programFor(id)?.attack ?? undefined).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reader: the amount is a capture, and so is the SIDE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — one anchor, two possessives, three amounts", () => {
  it("reads all THREE printed amounts onto the attacker's own Bench", () => {
    // 🛑 **D121's TEMPLATE WARRANT IS MET ON THE AMOUNT AXIS BY THE POOL ITSELF**:
    // three DISTINCT amounts are printed on three distinct sentences, so the
    // `(\d+)` capture has three witnesses and is not a template over a population
    // of one. Writing three literals would have cost three arms for the same
    // behaviour and would have refused the fourth amount a future set prints.
    for (const n of AMOUNTS) {
      expect(deriveAttackEffect(own(n))).toEqual([
        { op: "spreadDamage", target: "yourBench", amount: n },
      ]);
    }
  });

  it("⚠️ …and the SHIPPED opponent-side twin is UNMOVED — the control this rung needs", () => {
    // 🛑 **WITHOUT THIS THE RUNG ABOVE IS A TAUTOLOGY (D424).** "The own side is
    // read" passes trivially under a build that answers `"yourBench"` for
    // EVERYTHING, which is precisely the defect a shared anchor makes easy. The
    // twin is asserted at the same three amounts, off the same regex, in the same
    // breath.
    for (const n of AMOUNTS) {
      expect(deriveAttackEffect(opp(n))).toEqual([
        { op: "spreadDamage", target: "opponentBench", amount: n },
      ]);
    }
    // The bare (no "also") opponent-side form, and its own-side mirror — the
    // optional rider is shared by construction now, which is the whole argument for
    // one anchor rather than two.
    expect(deriveAttackEffect(`This attack does 50 damage to each of your opponent's ${"Benched"} Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)`)).toEqual([
      { op: "spreadDamage", target: "opponentBench", amount: 50 },
    ]);
    expect(
      deriveAttackEffect(
        "This attack does 50 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([{ op: "spreadDamage", target: "yourBench", amount: 50 }]);
  });

  it("the W/R parenthetical is optional on BOTH wordings, and nothing else changed", () => {
    // The tail was optional for the opponent-side form before this slice; sharing
    // one anchor is what makes it optional for the own-side form too, with no
    // second place for it to be forgotten.
    expect(
      deriveAttackEffect("This attack also does 10 damage to each of your Benched Pokémon."),
    ).toEqual([{ op: "spreadDamage", target: "yourBench", amount: 10 }]);
    expect(
      deriveAttackEffect(
        "This attack also does 10 damage to each of your opponent's Benched Pokémon.",
      ),
    ).toEqual([{ op: "spreadDamage", target: "opponentBench", amount: 10 }]);
    // …and the CURLY spelling of the contraction, on the family's standing reason
    // (a re-ingest could curl them). The byte in the corpus is U+0027 today.
    expect(
      deriveAttackEffect(own(10).replace("Don't", "Don’t")),
    ).toEqual([{ op: "spreadDamage", target: "yourBench", amount: 10 }]);
  });

  it("refuses the near-misses — and ADMITS one on the same axis beside each", () => {
    // ⚠️ **EVERY REFUSAL RUNG OWES A NEIGHBOURING ADMISSION ON THE SAME AXIS
    // (D424)**, or it passes under a reader that refuses everything. Each pair
    // below moves ONE token and states what the anchor is actually keyed on.
    const pairs: readonly (readonly [string, string, string])[] = [
      // possessive: an owner word this sentence never prints ↔ the two it does
      ["a THIRD possessive", "This attack also does 10 damage to each of my Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)", own(10)],
      // quantifier: "1 of" is a CHOICE and a different op ↔ "each of" is this one
      // 🆕🆕🆕 **D447 CHANGED THIS ROW'S SENTENCE WITHOUT CHANGING ITS AXIS, AND THE FIRST
      // REPLACEMENT WAS ALSO WRONG.** *"1 of your Benched Pokémon"* is BUILT now, as
      // `damageChosen {target: "yourBench"}`, so asserting null would pin a refusal the
      // engine does not make (D444). The obvious substitute — *"2 of"* — is ALSO read:
      // D399 made the count a CAPTURE, so every numeral on that axis resolves, and the
      // rung went red a second time before this comment was written. What genuinely
      // refuses is a quantifier WORD neither anchor spells: `SPREAD_EACH_BENCH` is keyed
      // on the literal "each of" and the snipe fragment on `\d+ of`, and "all of" is
      // neither. ⚠️ **THE AXIS IS UNCHANGED — a quantifier this family is not keyed on —
      // and that is the only thing that had to survive the substitution.**
      ["`all of` (a quantifier neither anchor spells)", "This attack also does 10 damage to all of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)", own(10)],
      // scope: the both-sides form names no possessive at all ↔ the one-sided form
      ["`each Benched Pokémon (both yours and your opponent's)`", "This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)", own(10)],
      // a trailing clause continues the sentence past the anchor's `\.`
      ["a SCALED tail", "This attack also does 10 damage to each of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)", opp(10)],
      // the lookalike é falls off the path silently, which is the family's reason
      ["a lookalike `Pokemon`", own(10).replace(/Pokémon/g, "Pokemon"), own(10)],
      // no leading `This attack`: a mid-sentence clause must not reach this path
      ["a mid-sentence clause", `Flip a coin. ${own(10)}`, own(10)],
    ];
    for (const [why, refused, admitted] of pairs) {
      expect(deriveAttackEffect(refused), `REFUSED: ${why}`).toBeNull();
      expect(deriveAttackEffect(admitted), `ADMITTED beside ${why}`).not.toBeNull();
    }
  });

  it("🛑 the OTHER unbuilt own-side shapes are STILL unbuilt — priced, not swept in", () => {
    // ⚠️ **AN ABSENCE PINNED ON THE POPULATION (D423), and it is what keeps this
    // slice's scope honest.** These sentences are real corpus rows this slice
    // deliberately did NOT take, each for a stated reason:
    //   · `1 of your Benched` (2 printings, at 10 and 40) PARKS a `choosePokemon`
    //     on the attacker's OWN bench — `parkOrForce`'s doctrine (0 = silent
    //     no-op, 1 = forced, ≥2 = park), which is a different mechanism from a
    //     spread and a different op (`damageChosen`);
    //   · `each Benched Pokémon (both yours and your opponent's)` (1) and its
    //     damage-counter-filtered sibling (1) need a THIRD `target` value plus a
    //     two-board fold, and the filtered one needs a per-body predicate as well.
    // Their marginal SITE cost is not near zero (D424's test), so they are left and
    // named. If a later slice claims one, this rung goes RED, which is the point.
    // 🛑🛑 **D447 FIRED THE FALSIFIER THIS RUNG PROMISED, AND IT WENT RED EXACTLY AS
    // THE PARAGRAPH ABOVE SAID IT WOULD** — *"If a later slice claims one, this rung goes
    // RED, which is the point."* Two of the four were claimed: the `1 of your Benched`
    // pair, at 10 and 40, is now `damageChosen {target: "yourBench", count: 1}`, read
    // through the SHARED snipe fragment's new possessive capture rather than through any
    // new anchor. ⚠️ **AND THE PRICE D425 QUOTED WAS WRONG IN ONE DIRECTION AND RIGHT IN
    // THE OTHER**: the `parkOrForce` doctrine really is a different mechanism from a
    // spread (right), but its marginal SITE cost was NOT the barrier — `snipeTargets`,
    // `ownBenchRefs` and the whole `damageChosen` park already existed, and the slice
    // cost one union member, one ternary, one funnel arm, one caption arm and a
    // seat-parametric `placeSnipe`. **THE TWO SURVIVING ROWS ARE UNTOUCHED AND KEEP
    // THEIR ORIGINAL REASON** (a THIRD `target` value plus a two-board fold, and a
    // per-body predicate on top for the filtered one), which is what stops this rung
    // decaying into a list of whatever is unbuilt today.
    const stillUnbuilt = [
      "This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "This attack also does 40 damage to each Benched Pokémon that has any damage counters on it (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ];
    // 🆕🆕🆕 D447 — the two that LEFT, pinned on the other side of the same predicate
    // so this rung records the transition rather than quietly shrinking (D444).
    for (const s of [
      "This attack also does 10 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "This attack also does 40 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]) {
      expect(resolvedByAnyReader(s), `claimed at D447: ${s}`).toBe(true);
      expect(deriveAttackEffect(s), s).toEqual([
        {
          op: "damageChosen",
          target: "yourBench",
          amount: Number(/does (\d+) damage/.exec(s)?.[1]),
          count: 1,
          source: "attack",
          deals: true,
        },
      ]);
    }
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    for (const s of stillUnbuilt) {
      expect(rows.get(s), `is a real corpus row: ${s}`).toBeGreaterThanOrEqual(1);
      expect(resolvedByAnyReader(s), `still unbuilt: ${s}`).toBe(false);
    }
    // …and the three D425 DID take are on the other side of the same predicate.
    for (const n of AMOUNTS) expect(resolvedByAnyReader(own(n))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the widening, and the version prediction DRIVEN in both directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — `target` is a union now, and the record version does not move", () => {
  it("both values are inhabited by PRINTED sentences, not just by the type", () => {
    // ⚠️ A union member no printing produces is a value no board can reach, which
    // is the shape D205 removed rather than tested around. Both members are reached
    // here from the catalog's own text.
    const seen = new Set<string>();
    for (const [, text] of legalAttackCorpus()) {
      for (const op of (deriveAttackEffect(text) ?? []) as EffectOp[]) {
        if (op.op === "spreadDamage") seen.add(op.target);
      }
    }
    expect([...seen].sort()).toEqual(["opponentBench", "yourBench"]);
  });

  it("🛑 the version PREDICTION, driven both directions: this is a WIDENING", () => {
    // **DIRECTION 1 — the old value still means what it meant.** A v26 record could
    // hold `{op:"spreadDamage", target:"opponentBench", amount:N}`. Under this
    // deploy that value is still in the union and still resolves to the opponent's
    // Bench, byte for byte. That is D125's widening test, not D309's rename case:
    // the old key's presence AND its absence both mean what the writer said.
    const old: EffectOp = { op: "spreadDamage", target: "opponentBench", amount: 20 };
    expect(deriveAttackEffect(opp(20))).toEqual([old]);
    // **DIRECTION 2 — the op cannot be IN a record at all, which makes it doubly
    // safe.** `EffectOp`s reach `MatchRecord.state` only through
    // `EffectContinuation.pendingOp`, and only a PARKING op is ever written there.
    // `spreadDamage`'s interpreter arm returns `{ done: … }` unconditionally, so no
    // board can park on it — asserted here by resolving all five printings to
    // completion with an empty `pending` tail and no prompt.
    for (const [id, index] of [
      ["fix-tremor", TREMOR.home],
      ["sv01-117", QUAKE.krookodile],
      ["swsh10.5-043", QUAKE.tyranitar],
    ] as const) {
      const state = bench(board(id, "fix-titan"), "p1", ["fix-titan", "fix-titan"]);
      const { state: done } = swing(state, index);
      // The whole attack resolved to the turn tail in ONE action: no
      // `effect:choose`, so no `EffectContinuation`, so no `pendingOp` — which is
      // the only address in `MatchRecord.state` an `EffectOp` is ever written to.
      expect(done.phase.kind, id).not.toBe("effect:choose");
      expect(done.pending.map((stage) => stage.kind), id).toEqual([]);
    }
    // ⚠️ **AND THE STRONGER HALF OF THE SAME CLAIM IS THE COMPILER'S, NOT A
    // BOARD'S.** `PendingStage["kind"]` has no member that resumes a parked effect
    // at all — a parked program lives in `phase.cont`, and reaching it needs
    // `phase.kind === "effect:choose"`, which the loop above refuses on every
    // printing. An earlier draft of this rung asserted
    // `pending.some((s) => s.kind === "effect")`; `tsc` rejected it as a comparison
    // with no overlap, which is a better proof than the assertion would have been
    // and is recorded here rather than deleted (D424's preference for a refusal the
    // type system re-derives).
  });

  it("the engine version moved and the two spellings agree", () => {
    expect(engineVersion).toBe("0.379.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the damage lands, on the right bench, from both seats.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — every own benched body, and NOT the opponent's", () => {
  it("hits EVERY body on the attacker's own Bench and none on the opponent's", () => {
    // Three own bodies, two across the table: a fold that stopped at the first, or
    // that walked the wrong side, or that walked BOTH, all differ here.
    let state = bench(board("sv01-117", "fix-titan"), "p1", ["fix-titan", "fix-titan", "fix-titan"]);
    state = bench(state, "p2", ["fix-titan", "fix-titan"]);
    const { state: done, events } = swing(state, QUAKE.krookodile);
    expect(damage(events)).toEqual([
      { seat: "p2", by: "p1", dealt: 180 }, // the main §8.5 hit on the Defender
      { seat: "p1", by: "p1", dealt: 30 },
      { seat: "p1", by: "p1", dealt: 30 },
      { seat: "p1", by: "p1", dealt: 30 },
    ]);
    expect(done.players.p1.bench.map((b) => b.damage)).toEqual([30, 30, 30]);
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([0, 0]);
  });

  it("🛑 ONE card, ONE amount, ONE board, TWO indices — the side is the ONLY difference", () => {
    // 🛑 **THE DEFECT A READER CANNOT SEE.** A build that resolved the own-side
    // sentence to `"opponentBench"` derives, interprets, damages a Bench, emits the
    // right number of rows and passes every single-index case in this repo. It
    // fails here and only here, because the two indices differ in nothing else.
    const start = bench(
      bench(board("fix-tremor", "fix-titan"), "p1", ["fix-titan", "fix-titan"]),
      "p2",
      ["fix-titan", "fix-titan", "fix-titan"],
    );
    const home = swing(start, TREMOR.home);
    const away = swing(start, TREMOR.away);
    expect(home.state.players.p1.bench.map((b) => b.damage)).toEqual([10, 10]);
    expect(home.state.players.p2.bench.map((b) => b.damage)).toEqual([0, 0, 0]);
    expect(away.state.players.p1.bench.map((b) => b.damage)).toEqual([0, 0]);
    expect(away.state.players.p2.bench.map((b) => b.damage)).toEqual([10, 10, 10]);
    // …and the main hit is identical on both, so nothing else about the two
    // declarations can be what the assertion above is measuring.
    expect(damage(home.events)[0]).toEqual({ seat: "p2", by: "p1", dealt: 30 });
    expect(damage(away.events)[0]).toEqual({ seat: "p2", by: "p1", dealt: 30 });
  });

  it("BOTH SEATS — p2 attacking splashes p2's Bench, not p1's", () => {
    // `ctx.seat` is the attacker's seat, so a build that hard-coded `p1` anywhere in
    // the new branch is invisible until the other seat swings.
    let state = bench(board("fix-tremor", "fix-titan", "p2"), "p2", ["fix-titan", "fix-titan"]);
    state = bench(state, "p1", ["fix-titan"]);
    const { state: done, events } = swing(state, TREMOR.home, "p2");
    expect(damage(events)).toEqual([
      { seat: "p1", by: "p2", dealt: 30 },
      { seat: "p2", by: "p2", dealt: 10 },
      { seat: "p2", by: "p2", dealt: 10 },
    ]);
    expect(done.players.p1.bench.map((b) => b.damage)).toEqual([0]);
    expect(done.players.p2.bench.map((b) => b.damage)).toEqual([10, 10]);
  });

  it("an EMPTY own Bench is a silent no-op, and so is an empty opponent Bench", () => {
    // Both directions off the same card. `spreadDamage` returns the state untouched
    // on a bench of none — no rows, no throw, and the main hit still lands.
    for (const index of [TREMOR.home, TREMOR.away]) {
      const { state: done, events } = swing(board("fix-tremor", "fix-titan"), index);
      expect(damage(events)).toEqual([{ seat: "p2", by: "p1", dealt: 30 }]);
      expect(done.players.p1.bench).toEqual([]);
      expect(done.players.p2.bench).toEqual([]);
    }
  });

  it("🛑 no ATTACK_EFFECT_SKIPPED in EITHER direction — the sentence is not loud any more", () => {
    // The other half of "the clause was read". Before D425 the own-side wording fell
    // to the loud skip path and the log carried its whole printed text; a build that
    // derived the op but ALSO flagged the sentence would be built-but-dead (D420's
    // shape). Driven on a populated bench AND on an empty one, because the skip is
    // decided by the DERIVATION and must not depend on whether anything was hit.
    for (const populated of [true, false]) {
      for (const index of [TREMOR.home, TREMOR.away]) {
        const start = populated
          ? bench(bench(board("fix-tremor", "fix-titan"), "p1", ["fix-titan"]), "p2", ["fix-titan"])
          : board("fix-tremor", "fix-titan");
        expect(types(swing(start, index).events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      }
    }
    // …and the two REAL carriers likewise, at their printed indices.
    for (const [id, index] of [
      ["sv01-117", QUAKE.krookodile],
      ["swsh10.5-043", QUAKE.tyranitar],
    ] as const) {
      const start = bench(board(id, "fix-titan"), "p1", ["fix-titan"]);
      expect(types(swing(start, index).events), id).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });

  it("the board is not mutated — a frozen state resolves either direction", () => {
    // The purity pair. Every op in this program writes through spreads; a build that
    // mutated `side.bench` in place to save an allocation throws here rather than
    // corrupting a caller's state.
    for (const index of [TREMOR.home, TREMOR.away]) {
      const state = bench(
        bench(board("fix-tremor", "fix-titan"), "p1", ["fix-titan", "fix-titan"]),
        "p2",
        ["fix-titan"],
      );
      deepFreeze(state);
      expect(() => applyAction(state, { type: "attack", seat: "p1", index })).not.toThrow();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the parenthetical is the RULE, and it needs its own control.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — Weakness is genuinely not applied on the Bench", () => {
  it("🛑 a ×2 Weakness body DOUBLES on the Active and stays FLAT on the Bench — one board", () => {
    // 🛑 **THE SAME CARD IN BOTH ZONES, IN ONE DECLARATION.** `fix-fighting-weak`
    // prints ×2 Fighting and `fix-tremor` is a Fighting attacker, so:
    //   · across the table, in the Active Spot, the main hit's 30 becomes 60 —
    //     which proves the §8.5 Weakness step is LIVE on this board;
    //   · on the attacker's own Bench, the very same card takes the splash's 10
    //     FLAT.
    // Without the first half, "the bench body took 10" is consistent with an engine
    // that applies no Weakness anywhere, and the rung would be a tautology (D424).
    const state = bench(board("fix-tremor", "fix-fighting-weak"), "p1", ["fix-fighting-weak"]);
    const { events } = swing(state, TREMOR.home);
    const rows = events.flatMap((e) => (e.type === "DAMAGE_DEALT" ? [e] : []));
    expect(rows[0]).toMatchObject({ seat: "p2", base: 30, dealt: 60 });
    expect(rows[0]?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(rows[1]).toMatchObject({ seat: "p1", base: 10, dealt: 10 });
    expect(rows[1]?.weakness).toBeNull();
    expect(rows[1]?.resistance).toBeNull();
  });

  it("…and the OPPONENT-side splash is flat on a ×2 body too — the shipped half is unmoved", () => {
    // The control for the control: nothing about D425 changed the opponent-side
    // arm's W/R behaviour, and a shared function makes that easy to break in one
    // direction only.
    const state = bench(board("fix-tremor", "fix-titan"), "p2", ["fix-fighting-weak"]);
    const { events } = swing(state, TREMOR.away);
    const rows = events.flatMap((e) => (e.type === "DAMAGE_DEALT" ? [e] : []));
    expect(rows[1]).toMatchObject({ seat: "p2", base: 10, dealt: 10, weakness: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — 🛑 THE MECHANISM THE SENTENCE DOES NOT ADVERTISE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — your own Knock Out, and the Prize goes to your OPPONENT", () => {
  /** The attacker's own benched `fix-fighting-weak` at 190 of 200, so Tyranitar's
      printed 20 splash is exactly lethal on it and on nothing else. */
  function selfLethal(): GameState {
    let state = bench(board("swsh10.5-043", "fix-titan"), "p1", ["fix-fighting-weak", "fix-titan"]);
    state = setBenchDamage(state, "p1", 0, 190);
    return state;
  }

  it("🛑 §8.1 Knocks Out the ATTACKER's own benched body and owes the PRIZE to the OPPONENT", () => {
    // 🛑 **THE RULE, AND THE ENGINE NEEDED NO NEW CODE FOR IT.** `finishAttack`
    // already sweeps `[defender, attacker]` and `collectKnockOutPass` already calls
    // `knockOut` with `otherSeat(entry.ref.seat)` as the prize seat, so the batch
    // parks on `ko:takePrizes` for the seat that did NOT attack. Driven rather than
    // inherited from either comment: before this slice no attack's own damage could
    // reach the own-side branch of that sweep at all.
    const { state, events } = swing(selfLethal(), QUAKE.tyranitar);
    expect(events.flatMap((e) => (e.type === "KNOCKED_OUT" ? [e.seat] : []))).toEqual(["p1"]);
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    // …and the OPPONENT actually takes it: their row shrinks, the attacker's does not.
    expect(state.players.p1.prizes).toHaveLength(6);
    expect(state.players.p2.prizes).toHaveLength(6);
    const { state: taken } = mustApply(state, {
      type: "takePrizes",
      seat: "p2",
      prizeIndices: [0],
    });
    expect(taken.players.p1.prizes).toHaveLength(6);
    expect(taken.players.p2.prizes).toHaveLength(5);
    // The turn tail was queued BEHIND the prize and resumes once it is paid.
    expect(taken.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 a BENCHED Knock Out owes NO promotion — verified, not assumed", () => {
    // The brief's third question, and it is answerable straight off the queue:
    // `knockOut`'s benched branch returns `[takePrizes]` and no `promote`, because
    // the Bench compacts and no spot is left empty. The ACTIVE branch returns both,
    // which is the discrimination — so this rung asserts the ABSENCE beside a board
    // where the presence is visible (§6's next case).
    const { state } = swing(selfLethal(), QUAKE.tyranitar);
    expect(state.pending.filter((s) => s.kind === "promote")).toEqual([]);
    expect(state.pending.map((s) => s.kind)).toEqual([
      "takePrizes",
      "endTurn",
      "checkup",
      "startTurn",
    ]);
    // The attacker's Active is untouched and its bench is one body shorter.
    expect(state.players.p1.active?.damage).toBe(0);
    expect(state.players.p1.bench).toHaveLength(1);
  });

  it("🛑 BOTH boards in ONE batch, and §8.1's Prize ORDER holds", () => {
    // ⚠️ **A NEW ROUTE TO A BATCH THAT WAS ONLY EVER REACHABLE THROUGH RECOIL.**
    // Krookodile's 180 Knocks Out a ×2 Fighting Active across the table while its
    // own 30 finishes its own benched teammate — one attack, two seats, one batch.
    // §8.1 says *"the player whose turn it is takes their Prize card(s) first"*, so
    // the ATTACKER's prize (for the defender's body) is queued ahead of the
    // DEFENDER's (for the attacker's own body), and only the defender — whose ACTIVE
    // died — is owed a promotion.
    let state = bench(board("sv01-117", "fix-fighting-weak"), "p1", ["fix-fighting-weak"]);
    state = setBenchDamage(state, "p1", 0, 190);
    const { state: done, events } = swing(state, QUAKE.krookodile);
    expect(events.flatMap((e) => (e.type === "KNOCKED_OUT" ? [e.seat] : []))).toEqual(["p2", "p1"]);
    expect(done.pending.map((s) => [s.kind, s.seat])).toEqual([
      ["takePrizes", "p1"], // for the DEFENDER's Knocked Out Active — attacker first
      ["takePrizes", "p2"], // for the ATTACKER's own Knocked Out benched body
      ["promote", "p2"], // …and only the emptied ACTIVE Spot owes one
      ["endTurn", "p1"],
      ["checkup", "p1"],
      ["startTurn", "p2"],
    ]);
  });

  it("⚠️ D189 — the attack changed its OWN board and the epilogue still addresses the attacker", () => {
    // 🛑 **D189's PRECEDENT IS THE SHAPE TO FEAR AND IT IS PROVEN, NOT REASONED.**
    // That slice broke an invariant `finishAttack` relied on by deriving a
    // self-switch: the epilogue addressed the Attacking Pokémon BY SPOT, and the
    // spot had moved. D425 also changes the attacker's own board mid-resolution —
    // it deletes a body from the attacker's own Bench inside the §8.1 batch — so
    // the question has to be asked again.
    //
    // It is safe, and the reason is structural rather than incidental:
    // `spreadDamage` only ever reads and rewrites `side.bench`, and the declared
    // attacker is the ACTIVE. The proof is the `usedAttack` stamp — written by
    // `finishAttack` against `attackerUid`, AFTER the sweep — landing on the right
    // body with the right printed name while that seat's bench is a body shorter.
    const { state } = swing(selfLethal(), QUAKE.tyranitar);
    expect(state.players.p1.active?.usedAttack).toMatchObject({ name: "Earthquake" });
    expect(state.players.p1.bench).toHaveLength(1);
    // …and the attacker took no damage from its own spread: the Active is not on
    // the Bench, which is the one-sentence statement of why this is safe.
    expect(state.players.p1.active?.damage).toBe(0);
  });

  it("a full-HP own benched body SURVIVES a splash that would otherwise be lethal", () => {
    // The §8.1 KO-survival clamp is asked of the DAMAGED body, so it reaches the
    // attacker's own bench exactly as it reaches the opponent's — no special case,
    // and this rung is what says so. `fix-titan` is 340 HP and a 20 splash cannot
    // touch it, which is the un-KO-able control the deck carries it for.
    const state = bench(board("swsh10.5-043", "fix-titan"), "p1", ["fix-titan"]);
    const { state: done, events } = swing(state, QUAKE.tyranitar);
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(done.players.p1.bench.map((b) => b.damage)).toEqual([20]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — and it can END the game, in the attacker's disfavour.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the game ends on a Prize the attacker handed over", () => {
  it("🛑 the OPPONENT wins outright when their last Prize comes off the attacker's own KO", () => {
    // ⚠️ **THE WIN-CONDITION PATH, DRIVEN.** `evaluateWin` fires on
    // `prizes.length === 0` for a seat, and the seat that empties its row here is
    // the one that never attacked. With exactly one Prize left the pick is FORCED,
    // so the batch resolves straight through: `PRIZES_TAKEN` then `GAME_OVER`, with
    // no park in between.
    let state = bench(board("swsh10.5-043", "fix-titan"), "p1", ["fix-fighting-weak", "fix-titan"]);
    state = setBenchDamage(state, "p1", 0, 190);
    state = setPrizes(state, "p2", 1);
    const { state: done, events } = swing(state, QUAKE.tyranitar);
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT", // the main hit on the Defender
      "DAMAGE_DEALT", // the splash on the attacker's own benched body…
      "DAMAGE_DEALT", // …and on its teammate
      "KNOCKED_OUT",
      "PRIZES_TAKEN",
      "GAME_OVER",
    ]);
    expect(done.phase).toEqual({
      kind: "gameOver",
      outcome: { result: "win", winner: "p2", reason: "prizesTaken" },
    });
  });

  it("…and with TWO Prizes left it parks instead, which is the control on the rung above", () => {
    // Without this, "the game ended" is consistent with an engine that ends the
    // game on any own-side Knock Out at all. The only difference between the two
    // boards is the size of the Prize row.
    let state = bench(board("swsh10.5-043", "fix-titan"), "p1", ["fix-fighting-weak", "fix-titan"]);
    state = setBenchDamage(state, "p1", 0, 190);
    state = setPrizes(state, "p2", 2);
    const { state: done } = swing(state, QUAKE.tyranitar);
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    const { state: taken } = mustApply(done, {
      type: "takePrizes",
      seat: "p2",
      prizeIndices: [0],
    });
    expect(taken.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(taken.players.p2.prizes).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — the log row, which is a claim with the same standing as a predicate.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — `DAMAGE_DEALT.by`, and the row it stopped getting wrong", () => {
  it("🛑 the own-side splash is voiced by the ATTACKER, not by the defender", () => {
    // 🛑 **THE DEFECT THIS FIELD EXISTS FOR.** `log.ts` read the dealer as
    // `otherSeat(event.seat)` until D425. On the board below that renders the
    // splash under **Wren**, crediting the DEFENDER with damage **Ember's**
    // Krookodile had just done to Ember's own Bench — a false row, in the direction
    // that misreads the board.
    const state = bench(board("sv01-117", "fix-titan"), "p1", ["fix-fighting-weak"]);
    const { state: done, events } = swing(state, QUAKE.krookodile);
    expect(rendered(done, events)).toEqual([
      { who: "p1", text: "Krookodile used Earthquake" },
      { who: "p1", text: "dealt 180 damage to fix-titan" },
      { who: "p1", text: "dealt 30 damage to fix-fighting-weak" },
      { who: "p1", text: "ended their turn" },
      { who: "p2", text: "drew a card" },
    ]);
  });

  it("⚠️ …and every PRE-D425 row still renders under the opposite seat — the control", () => {
    // ⚠️ **RE-POINTING A CLAIM CAN DROP THE DISCRIMINATION IT CARRIED (D418).** The
    // old line was `otherSeat(event.seat)`; if `by` were simply `event.seat`
    // everywhere, the rung above would pass and every shipped row would be wrong.
    // So the opponent-side arm is asserted beside it, on a board where the two
    // answers differ.
    const state = bench(board("fix-tremor", "fix-titan"), "p2", ["fix-titan"]);
    const { state: done, events } = swing(state, TREMOR.away);
    expect(rendered(done, events).slice(0, 3)).toEqual([
      { who: "p1", text: "fix-tremor used Away Tremor" },
      { who: "p1", text: "dealt 30 damage to fix-titan" },
      { who: "p1", text: "dealt 10 damage to fix-titan" },
    ]);
    // The event's own fields are what separates the two: the damaged body's owner
    // is p2 here and p1 above, while the DEALER is p1 on both.
    expect(damage(events)).toEqual([
      { seat: "p2", by: "p1", dealt: 30 },
      { seat: "p2", by: "p1", dealt: 10 },
    ]);
  });

  it("`by` equals `otherSeat(seat)` on every board that is not an own-side spread", () => {
    // The compatibility claim, driven rather than asserted in prose: the field is a
    // pure addition for the whole shipped pool, so no existing log row moved. The
    // sweep runs the main hit, the opponent-side spread and the own-side spread on
    // one seat and checks the identity holds on exactly the first two.
    const opponentSide = swing(
      bench(board("fix-tremor", "fix-titan"), "p2", ["fix-titan"]),
      TREMOR.away,
    );
    for (const row of damage(opponentSide.events)) {
      expect(row.by).not.toBe(row.seat);
    }
    const ownSide = swing(bench(board("fix-tremor", "fix-titan"), "p1", ["fix-titan"]), TREMOR.home);
    const [main, splash] = damage(ownSide.events);
    expect(main).toEqual({ seat: "p2", by: "p1", dealt: 30 });
    expect(splash).toEqual({ seat: "p1", by: "p1", dealt: 10 }); // …and here it does NOT
  });
});
