import { describe, expect, it } from "vitest";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackEffect,
  deriveAttackRequirement,
} from "./effects";
import type { CoinFace, EffectOp, GameEvent, GameState } from "./index";
import { programFor } from "./index";
import { programPlayable } from "./cardplay";
import {
  FIXTURE_POOL,
  TRAINER_OPS_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.121.0 → 0.122.0 — D181, THE TRAINER-PATH OPS PRINTED AS ATTACK TEXT. Four
// families the engine has executed since M4 on the Trainer path and had no
// ATTACK reader for. Nothing is built: `drawCards`, `drawUntilHandSize`, `gust`
// and `coinFlipGate` all exist, all park (or don't) as they already did, and the
// whole slice is four anchors and four `return`s. D132's inventory rule for the
// fourth family running — for THREE of the four families.
//
// ⚠️⚠️ AND THE FOURTH WAS D181'S FINDING: THE SELF-SWITCH WAS NOT BUILT, BECAUSE
// THE BACKLOG'S "one regex + one return, zero new ops" PRICE WAS WRONG. It was
// right about the op and wrong about the cost. Deriving `switchActive` from ATTACK
// text lets the attacker leave the Active Spot mid-attack, and `finishAttack`
// addressed the Attacking Pokémon as `players[attackerSeat].active` — an
// addressing `vengefulPunch.test.ts` SWEEPS ("no attack program — derived OR
// authored — can move its own actor off the spot") and whose repair it named in
// advance: hand `finishAttack` a uid, which is a required field on the
// `attackEpilogue` `PendingStage`, which is PERSISTED, which is a
// `MATCH_RECORD_VERSION` bump.
//
// ── 0.122.1 → 0.123.0 — D189 PAID EXACTLY THAT PRICE AND LANDED THE FAMILY. ──
// `finishAttack` takes `attackerUid`; `PendingStage.attackEpilogue` carries a
// REQUIRED `uid`; `MATCH_RECORD_VERSION` **11 → 12**. Two new anchors follow
// ("Switch this Pokémon with 1 of your Benched Pokémon.", bare and coin-gated) —
// **7 of the family's 9 six-set printings, and 7 Standard-legal ones**. The two
// rows are in the table below, the boards are two describes down, and D181's
// blocker (1) is now inverted in `vengefulPunch.test.ts` rather than pinned here.
// ⚠️ THE THIRD SENTENCE IS STILL UNBUILT and its pin is untouched: "You may switch
// this Pokémon…" needs the generic confirm-park (**D186**), which is a VOCABULARY
// slice, not a persistence one.
//
// ⚠️ THE CENSUS WAS RE-DERIVED AND EVERY BACKLOG FIGURE HELD EXACT — over
// `json_each(attacks_json)`, six-set scope: draw **12 printings / 2 sentences**,
// draw-until **3 / 1**, self-switch **9 / 3**, gust **4 / 2**. 28 printings, 8
// sentences, of which D181 read **19 across 5** and D189 reads **26 across 7**.
//
// ⚠️ D189 RE-RAN THE SELF-SWITCH CENSUS RATHER THAN INHERITING IT, and every
// six-set figure held EXACT (bare ×6, flip-gated ×1, "You may" ×2, plus the two
// compound near-misses ×5 and ×1). What moved is the LEGAL axis, which D181 left
// half-measured: the bare sentence is **0 of 6 legal at six-set scope and 7 of 20
// across the whole remote**; the flip-gated one is its single Bramblin `sv02-022`
// printing, regulation mark G, i.e. **0 legal** — the cell D181 carried as `null`,
// now MEASURED and measured to zero.
//
// ⚠️⚠️ AND A COUNT WITHOUT A POPULATION *AND* A LEGALITY IS NOT A FACT — which
// is a SECOND axis this repo's SCOPE discipline (D154) has never had. The
// queryable catalog is the REMOTE D1: **20 sets / 3,786 rows**, of which the six
// sets the local D1 holds are **exactly 978** — byte-identical to the population
// every census in these docs was measured against, so a census must be scoped to
// those six or it is not comparable to any documented number. **But that
// population is ROTATED OUT.** Legality tracks the regulation mark exactly
// (Standard = marks H and I, plus Basic Energy, which carries no mark): 2,021 of
// the remote's 3,786 rows are Standard-legal, and only **127 of the six-set
// 978** are — `swsh10.5` is 0 of 88, and sv01/sv02/sv03 contribute five Basic
// Energy between them.
//
// ⚠️ THE SLICE SURVIVES THAT INTACT, AND IS WORTH MORE THAN IT WAS DISPATCHED
// FOR, because **a deriver arm is a TEXT PARSER and printed sentences transfer
// across sets.** Counted over `legal_standard = 1`, these five anchors serve
// **34 measured printings** (the gated gust has not been counted there, and is
// carried as `null` rather than as zero) against 19 in the six-set catalog. The
// legal pool holds 1,732 attack text units to the six-set scope's 811. Every
// count in this file therefore carries BOTH numbers.
//
// ⚠️ The local sqlite itself is `.wrangler` dev state and is absent from a fresh
// clone — `docs/reference/coverage-backlog.md` now records that, and records
// that every ranking in it is over the rotated-out population.
//
// ⚠️ TWO NUMBERS THE BACKLOG GENERALISED, MEASURED HERE. Its "Draw a card. /
// Draw N cards." is really **"Draw a card." ×7 and "Draw 2 cards." ×5** — no
// printing in this pool draws any other count. And its "until you have N cards"
// is **always 7** (×3). Both arms stay parameterised anyway, because the TRAINER
// path already prints other numbers (Nemona 3, Grusha 5) and an anchor keyed to
// one card's constant is an anchor that breaks on the next print.
//
// ⚠️ THE FAILURE MODE THESE ANCHORS EXIST AGAINST is a compound read as its
// first clause. `NEAR_MISSES` below is eight REAL sentences from the same sweep
// that CONTAIN one of these clauses and mean something else — five printings of
// a self-switch that also switches the defender out, two of a gust that also
// deals 30 to the new Active. Every one is refused by `^…$` alone, and every one
// is asserted, because that is exactly where a widened arm does damage.

/** The five sentences this slice reads, with the op each derives to and TWO
    measured printing counts — because one count is not a fact about this pool.

    `printings` is over the **978-row / 6-set catalog** every census in this repo
    is measured against. `legalPrintings` is over the **Standard-legal pool**
    (regulation marks H and I, plus Basic Energy — 2,021 rows of the remote D1's
    3,786). ⚠️ THE TWO POPULATIONS BARELY OVERLAP: only 127 of those 978 rows are
    Standard-legal, so the six-set count is a census of ROTATED-OUT cards. A
    deriver arm does not care — it is a TEXT parser and the sentences transfer
    across sets — which is exactly why both numbers belong on the row.

    `legalPrintings: null` means NOT MEASURED, not zero. The gated gust was
    counted at six-set scope only; nobody has run it against `legal_standard`. */
const CLAUSES = [
  {
    text: "Draw a card.",
    program: [{ op: "drawCards", count: 1 }] as EffectOp[],
    printings: 7,
    legalPrintings: 22,
  },
  {
    text: "Draw 2 cards.",
    program: [{ op: "drawCards", count: 2 }] as EffectOp[],
    printings: 5,
    legalPrintings: 9,
  },
  {
    text: "Draw cards until you have 7 cards in your hand.",
    program: [{ op: "drawUntilHandSize", size: 7 }] as EffectOp[],
    printings: 3,
    legalPrintings: 1,
  },
  {
    text: "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    program: [{ op: "gust" }] as EffectOp[],
    printings: 3,
    legalPrintings: 2,
  },
  {
    text: "Flip a coin. If heads, switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
    program: [{ op: "coinFlipGate", then: [{ op: "gust" }] }] as EffectOp[],
    printings: 1,
    legalPrintings: null,
  },
  // ── D189's two, the family D181 measured, priced and REFUSED to build. ──
  {
    text: "Switch this Pokémon with 1 of your Benched Pokémon.",
    program: [{ op: "switchActive" }] as EffectOp[],
    printings: 6,
    legalPrintings: 7,
  },
  {
    text: "Flip a coin. If heads, switch this Pokémon with 1 of your Benched Pokémon.",
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
    program: [{ op: "coinFlipGate", then: [{ op: "switchActive" }] }] as EffectOp[],
    printings: 1,
    // ⚠️ A MEASURED ZERO, AND IT IS THE FIRST ONE ON THIS TABLE — which is what
    // makes the `null`-is-not-zero convention two rows up worth having. D181 left
    // this cell UNMEASURED; D189 ran it. The single printing is Bramblin
    // `sv02-022` "Ride the Wind", regulation mark **G**, i.e. ROTATED OUT — so
    // this anchor serves ZERO Standard-legal printings and is built anyway,
    // because it is one `if` riding a reader whose bare sibling serves 7 and
    // because D180's lesson cuts the other way for a PARSER: refusing a sentence
    // for being rotated out today would have to be revisited on the next reprint.
    legalPrintings: 0,
  },
] as const;

const DRAW_1 = 0;
const DRAW_2 = 1;
const DRAW_UNTIL = 2;
const GUST = 3;
const FLIP_GUST = 4;
const SELF_SWITCH = 5;
const FLIP_SELF_SWITCH = 6;

/** The two sentences D181 measured and refused to build, and D189 built once the
    `attackEpilogue` uid was paid for. Kept as their own names (rather than read
    off `CLAUSES`) because a dozen cases below reason about the FAMILY. */
const SELF_SWITCH_BARE = CLAUSES[SELF_SWITCH].text;
const SELF_SWITCH_FLIP = CLAUSES[FLIP_SELF_SWITCH].text;

/** 🆕🆕 **D422 — THE PRINTING NEITHER D181 NOR D189 READ, AND IT IS BUILT NOW.**
    Verbatim; named up here because it belongs to the same family and its 2 six-set
    printings are part of the 28. **3 Standard-legal printings.**

    🛑 EVERY ASSERTION THAT USED TO PIN THIS STRING NULL IS RE-POINTED IN PLACE
    RATHER THAN DELETED (conventions.md's *re-point, do not delete* rule), and each
    one is re-pointed onto the claim the OLD one was really making:
      • the family-arithmetic rung (§"the ONE remaining printed sentence") now
        asserts all THREE sentences derive and that this one's program is the bare
        one WRAPPED;
      • the case-vs-anchor mutant rung (§"a SUBSTRING matcher…") keeps both of its
        mutants and asserts the same DISCRIMINATION it always did — a `.test()`
        with no `^` still refuses this sentence and the capital-`S` build still
        would have — but as an inequality against the real program rather than
        against `null`;
      • the STAYS-LOUD board (`fix-trainerops` idx 7) becomes a POSITIVE board.
    ⚠️ Per D418's second half: what the old `toBeNull` rungs could catch that a
    bare "it derives" cannot is a build whose anchor is too WIDE — `null` is false
    under both the real build and the over-wide mutant only because the sentence
    was unread. So the replacements assert the exact PROGRAM and, at the two mutant
    sites, an INEQUALITY against the neighbouring sentence's program; "it derives"
    alone would be true under the wrong-arm mutant too. */
const YOU_MAY_SELF_SWITCH = "You may switch this Pokémon with 1 of your Benched Pokémon.";

/** The program D422's arm derives it to: D189's bare program, wrapped. Spelled
    once so the three re-pointed rungs below cannot drift apart from each other. */
const YOU_MAY_SELF_SWITCH_PROGRAM: EffectOp[] = [
  {
    op: "optional",
    note: YOU_MAY_SELF_SWITCH,
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
    then: [{ op: "switchActive" }],
  },
];

/** U+00A0, spelled as an ESCAPE rather than typed — byte-different from an ASCII
    space and invisible in a diff. `flipGatedOp.test.ts`'s convention, reused. */
const NBSP = "\u00a0";

/** REAL rows from the same sweep that CONTAIN one of the seven clauses and mean
    something else — the population an unanchored or greedy build eats. Counts
    are MEASURED at five-set scope. Kept as data rather than inlined, because
    each one is a live witness that "one anchored reader per printed string" is a
    property of this family and not a slogan. */
const NEAR_MISSES = [
  // The self-switch clause, VERBATIM, in front of a deck search.
  "Switch this Pokémon with 1 of your Benched Pokémon. If you do, search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.",
  // The gust clause, VERBATIM, with a damage rider bolted on. ⚠️ D228 MOVED THE
  // FIRST OF THESE TWO OUT OF THIS LIST BY BUILDING IT — see `BUILT_AT_D228`. The
  // one that stays is the ROTATED compound whose rider carries a second mechanic
  // (a flip and a status) on top of the damage, so it is still the shape an
  // unanchored build eats and is still refused.
  "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If you do, this attack does 60 damage to the new Active Pokémon, and then flip a coin. If heads, that Pokémon is now Paralyzed.",
  // A switch described from the OTHER side of the table entirely.
  "Your opponent chooses 1 of their Benched Pokémon and switches it with their Active Pokémon. The new Active Pokémon is now Asleep.",
  // The variable-size draw-until (Bronzor sv03-144 "Mirror Draw"). The count is
  // not a number, so `(\d+)` refuses it — and it is a real future slice.
  "Draw cards until you have the same number of cards in your hand as your opponent.",
  // ── D189: FOUR MORE REAL ROWS, and the FIRST TRAILING ones this list has had.
  // Every entry above carries its clause at the START, so a `^`-anchored-only
  // build (no `$`) would still refuse them all and this list would be passing for
  // half the reason it claims. These four come from the 14 remote sets the six-set
  // census never saw, and TWO of them print the self-switch as the LAST sentence —
  // which is the shape that eats a `.test()` with no `$`. They are outside the
  // documented population and are here anyway, because a REGEX does not care what
  // population it was written against.
  "Your opponent's Active Pokémon is now Confused and Poisoned. Switch this Pokémon with 1 of your Benched Pokémon.",
  "This attack does 10 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) Switch this Pokémon with 1 of your Benched Pokémon.",
  "Search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck. You may switch this Pokémon with 1 of your Benched Pokémon.",
] as const;

/** ⚠️ D246 — A FIFTH ROW LEFT `NEAR_MISSES` BY BEING BUILT, AND IT IS THE THIRD
    TIME THIS FILE HAS PAID ONE LINE FOR THE RE-HOME RULE RATHER THAN DELETING AN
    EXPIRED CONTROL. Kilowattrel ex `sv08-068` "Return Charge" was the list's
    canonical "the self-switch clause VERBATIM in front of an attach", and a build
    that dropped the `$` from `ATTACK_SELF_SWITCH` would answer it with a bare
    `[{ op: "switchActive" }]` — losing two Energy and the §9.2 gate that decides
    whether they land at all. That is exactly the equality the case below refuses,
    now that the sentence has a right answer.
    (`derivedGatedAttach.test.ts` owns the sentence and drives its boards.) */
const BUILT_AT_D246 = [
  "Switch this Pokémon with 1 of your Benched Pokémon. If you do, attach up to 2 Basic {L} Energy cards from your hand to this Pokémon.",
] as const;

/** ⚠️ D227 — THREE ROWS LEFT `NEAR_MISSES` BY BEING BUILT, AND THEY ARE KEPT HERE
    RATHER THAN DELETED, BECAUSE THE CLAIM THEY WITNESS DID NOT GO AWAY — IT GOT
    STRONGER. Until D227 they were pinned NULL, which is a weak fact about a
    catalog that is ~92 % unread: "the reader refuses this" is nearly always true.
    Now the reader ANSWERS all three, so the assertion below can say the thing the
    `^…$` convention is actually about — that each derives to its OWN program and
    to none of this file's seven, i.e. that a compound was not read as its first
    clause. A build that dropped the `$` from `ATTACK_SELF_SWITCH` would derive the
    first row to a BARE `switchActive` and lose the whole second half; that mutant
    used to be caught by a `toBeNull`, and is caught here by an inequality that
    keeps working now that the sentence has a right answer.

    (The two remaining opponent-switch-out rows are the same family read alone and
    behind the printed "You may" — see `derivedOpponentSwitchOut.test.ts`, which
    owns them.) */
const BUILT_AT_D227 = [
  "Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
  "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
  "You may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
] as const;

/** ⚠️ D228 — A FOURTH ROW LEFT `NEAR_MISSES` THE SAME WAY, AND IT IS THE ONE THAT
    MATTERS MOST TO **THIS** FILE, because it begins with THIS file's gust clause
    rather than with the self-switch. It was the list's canonical "the gust clause
    VERBATIM with a damage rider bolted on", and a build that dropped the `$` from
    `ATTACK_GUST` would answer it with a bare `[{ op: "gust" }]` — which is exactly
    the equality the case below refuses, now that the sentence has a right answer.
    (`derivedNewActiveDamage.test.ts` owns the sentence and its three siblings at
    20 / 40 / 70.) */
const BUILT_AT_D228 = [
  "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 30 damage to the new Active Pokémon.",
] as const;

describe("the five anchors — three ops that already existed, four readers that did not", () => {
  it("derives each printed sentence to its op", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up on BOTH populations — 26 of 28 in the 6-set catalog, 41 among LEGAL cards", () => {
    // The arithmetic, stated rather than described, on both axes — because a
    // slice that quietly dropped a sentence would still pass every case above,
    // and a handoff quoting ONE number would be doing exactly what this repo
    // spent four decisions learning not to do about SCOPE.
    const read = CLAUSES.reduce((sum, c) => sum + c.printings, 0);
    expect(read).toBe(26); // D181's 19 + D189's 6 + 1
    expect(CLAUSES).toHaveLength(7);
    // …and the remainder is exactly the "You may" printing: 2, and no more.
    expect(read + 2).toBe(28);
    // THE LEGAL COUNT, over the sentences that HAVE one. `null` is NOT MEASURED
    // and is excluded rather than treated as zero — the distinction D135's
    // absent-field rule makes about ops, applied to a census. D189 added a row
    // whose measured value IS zero, which is the first time on this table that
    // the distinction is doing visible work: six rows are measured, one is not,
    // and one of the six measured to nothing.
    const measured = CLAUSES.filter((c) => c.legalPrintings !== null);
    expect(measured).toHaveLength(6);
    expect(measured.reduce((sum, c) => sum + (c.legalPrintings ?? 0), 0)).toBe(41);
    expect(CLAUSES[FLIP_GUST].legalPrintings).toBeNull(); // still not measured
    expect(CLAUSES[FLIP_SELF_SWITCH].legalPrintings).toBe(0); // measured, and zero
    // ⚠️ AND THE LEGAL COUNT IS BIGGER THAN THE SIX-SET ONE, WHICH IS THE POINT
    // OF CARRYING BOTH: the catalog the backlog ranks families over is almost
    // entirely rotated out (127 of its 978 rows are Standard-legal), while the
    // SENTENCES transfer across sets. A deriver arm is a text parser, so its
    // value is measured over the pool people can actually play. D189's bare
    // self-switch is the sharpest instance yet — **0** of its 6 six-set printings
    // are Standard-legal, and it serves **7** printings that are.
    expect(41).toBeGreaterThan(read);
    expect(CLAUSES[SELF_SWITCH].legalPrintings).toBe(7);
    // 🆕🆕 D422 — THE FAMILY IS WHOLE, AND THIS RUNG MOVED FROM AN ABSENCE TO A
    // SHAPE. It used to read *"the one sentence in the family still unread —
    // D186's, and D189's line is exactly here"* over a `toBeNull`. There is no
    // line any more: all three printed sentences derive. What is asserted instead
    // is the relationship the `toBeNull` was standing in for — the "You may"
    // printing is the BARE printing's program and one wrapper, so a build that
    // read the offer and dropped the switch, or read the switch and dropped the
    // offer, is red here. (`optionalSelfSwitch.test.ts` owns its boards.)
    expect(deriveAttackEffect(YOU_MAY_SELF_SWITCH)).toEqual(YOU_MAY_SELF_SWITCH_PROGRAM);
    const wrapped = deriveAttackEffect(YOU_MAY_SELF_SWITCH)?.[0];
    expect(wrapped?.op === "optional" ? wrapped.then : undefined).toEqual(
      deriveAttackEffect(SELF_SWITCH_BARE),
    );
    // …and it is NOT the bare program, which is what a dropped wrapper looks like.
    expect(deriveAttackEffect(YOU_MAY_SELF_SWITCH)).not.toEqual(
      deriveAttackEffect(SELF_SWITCH_BARE),
    );
  });

  it("reads the SINGULAR and the PLURAL draw through ONE anchor", () => {
    // `DECK_TOP_MILL`'s arrangement rather than D136's one-regex-per-string rule,
    // and for its reason: the two spellings differ only in whether the count is
    // WRITTEN. The singular branch invents its 1 at the site.
    expect(deriveAttackEffect(CLAUSES[DRAW_1].text)).toEqual([{ op: "drawCards", count: 1 }]);
    expect(deriveAttackEffect(CLAUSES[DRAW_2].text)).toEqual([{ op: "drawCards", count: 2 }]);
    // "Draw 1 cards." is not English and is not printed; it is admitted because
    // refusing it would cost a guard that says nothing about any real card.
    expect(deriveAttackEffect("Draw 1 cards.")).toEqual([{ op: "drawCards", count: 1 }]);
    for (const n of [2, 3, 5, 7]) {
      expect(deriveAttackEffect(`Draw ${n} cards.`)).toEqual([{ op: "drawCards", count: n }]);
    }
    // The pool prints only 1 and 2 on the ATTACK side; the arm stays
    // parameterised because the TRAINER side already prints 3 and 7 on the same
    // op, and an anchor keyed to one card's constant breaks on the next print.
    expect(programFor("sv01-180")?.trainer).toEqual([{ op: "drawCards", count: 3 }]);
  });

  it("refuses a printed ZERO on both counted arms — the guard every arm of this reader carries", () => {
    // A "Draw 0 cards." would file an effect that moved nothing; a "until you
    // have 0 cards in your hand" is worse, because `drawUntilHandSize` NEVER
    // TRIMS — the op is a no-op by construction at that size, so admitting it
    // would report a simulated sentence that cannot ever do anything.
    expect(deriveAttackEffect("Draw 0 cards.")).toBeNull();
    expect(deriveAttackEffect("Draw cards until you have 0 cards in your hand.")).toBeNull();
    // No CEILING on either, matching every other arm: the ops clamp against the
    // deck (§14.3 deck-out is a turn-START rule), so a malformed large count
    // empties a deck and stops — a legal board state.
    expect(deriveAttackEffect("Draw 999 cards.")).toEqual([{ op: "drawCards", count: 999 }]);
    expect(deriveAttackEffect("Draw cards until you have 60 cards in your hand.")).toEqual([
      { op: "drawUntilHandSize", size: 60 },
    ]);
  });

  it("puts the GATED program's `then` byte-identical to the BARE arm's whole program", () => {
    // The family's checkable claim (D134's shape): there is ONE action here,
    // printed twice, and the coin is procedure in front of it. Read the gate
    // apart rather than re-typing the inner op, so a copy-paste cannot pass it.
    const bare = deriveAttackEffect(CLAUSES[GUST].text);
    const gated = deriveAttackEffect(CLAUSES[FLIP_GUST].text);
    expect(gated).toHaveLength(1);
    const gate = gated?.[0];
    expect(gate?.op).toBe("coinFlipGate");
    expect(gate?.op === "coinFlipGate" ? gate.then : undefined).toEqual(bare);
    // …and the gate carries NO `onTails` — the printed face is heads, and the
    // field is ABSENT rather than `false` so a heads-gated program stays
    // `toEqual`-identical to the registry rows below (D135's absent-field rule).
    expect(gate?.op === "coinFlipGate" ? gate.onTails : "absent").toBeUndefined();
  });
});

describe("the INVENTORY RULE, stated as an equality — one action, two seams", () => {
  // The sharpest claim in the slice: these exact actions are ALREADY authored in
  // the registry as Trainers, so the derived ATTACK program and the registry
  // TRAINER program must be the same value. A build that invented a subtly
  // different program for the attack side — a `gust` with a field, a `drawCards`
  // off by one, the wrong seat's switch — fails here without any board at all.
  it("the derived GUST equals Boss's Orders' registry program", () => {
    expect(deriveAttackEffect(CLAUSES[GUST].text)).toEqual(programFor("sv02-172")?.trainer);
    expect(programFor("sv02-172")?.trainer).toEqual([{ op: "gust" }]);
  });

  it("the derived GATED GUST equals Pokémon Catcher's registry program", () => {
    expect(deriveAttackEffect(CLAUSES[FLIP_GUST].text)).toEqual(programFor("sv01-187")?.trainer);
  });

  it("keeps the GUST off the SELF-SWITCH's op — one `otherSeat` at the interpreter", () => {
    // THE MOST DANGEROUS CONFUSION IN THE SLICE, asserted as a disequality. The
    // two ops take the same prompt kind, emit the same events, and differ only in
    // which seat `switchInto` is called for. Nothing about their SHAPE tells them
    // apart, which is why the board cases below watch which side of the table
    // moved rather than trusting the op name — and why crossing them would ALSO
    // trip the `finishAttack` addressing the self-switch family is blocked on.
    expect(deriveAttackEffect(CLAUSES[GUST].text)).toEqual([{ op: "gust" }]);
    expect(deriveAttackEffect(CLAUSES[GUST].text)).not.toEqual([{ op: "switchActive" }]);
    expect(Object.keys({ op: "gust" })).toEqual(Object.keys({ op: "switchActive" }));
    // …and `switchActive` IS live on the other seam, so this is a constraint
    // rather than a claim about vocabulary the engine never had.
    expect(programFor("sv01-194")?.trainer).toEqual([{ op: "switchActive" }]);
  });
});

describe("PROVENANCE — the anchors against the printed bytes this repo carries", () => {
  // The catalog sweep is the primary warrant (see the header). These are the
  // in-repo corroborations, and they are what a future reader with no database
  // can still re-check: the same sentences are printed on TRAINERS that sit in
  // `FIXTURE_POOL` verbatim.
  it("GUST — sv02-172 Boss's Orders prints it char-for-char", () => {
    expect(FIXTURE_POOL["sv02-172"]?.effect).toBe(CLAUSES[GUST].text);
    expect(FIXTURE_POOL["sv02-172"]?.trainerType).toBe("Supporter");
  });

  it("GATED GUST — sv01-187 Pokémon Catcher prints it char-for-char", () => {
    expect(FIXTURE_POOL["sv01-187"]?.effect).toBe(CLAUSES[FLIP_GUST].text);
  });

  it("each GATED sentence is its BARE sibling behind one printed prefix", () => {
    // The gate is procedure in front of the action, and the STRINGS say so: strip
    // "Flip a coin. If heads, " and lowercase the first letter and you have the
    // bare printing back. Pinned because it is the reading that licenses ONE
    // inner op rather than a second parse of a switch — and it holds for the
    // UNBUILT family's pair too, which is how we know that family's blocker is
    // the epilogue's addressing and not the sentence.
    const pairs: readonly (readonly [string, string])[] = [
      [CLAUSES[GUST].text, CLAUSES[FLIP_GUST].text],
      [SELF_SWITCH_BARE, SELF_SWITCH_FLIP],
    ];
    for (const [bare, gated] of pairs) {
      expect(gated).toBe(`Flip a coin. If heads, ${bare[0]?.toLowerCase()}${bare.slice(1)}`);
    }
  });

  it("the NEAR-MISS pair the doc's prose could not have told apart", () => {
    // sv01-194 Switch prints "Switch YOUR ACTIVE POKÉMON with 1 of your Benched
    // Pokémon."; the attack prints "Switch THIS POKÉMON with …". Same op, two
    // subjects, one shared tail — and only a catalog query could say which the
    // attacks carry. Pinned so nobody collapses them into one anchor later.
    const item = FIXTURE_POOL["sv01-194"]?.effect ?? "";
    expect(item).toBe("Switch your Active Pokémon with 1 of your Benched Pokémon.");
    expect(item).not.toBe(SELF_SWITCH_BARE);
    expect(item.endsWith("with 1 of your Benched Pokémon.")).toBe(true);
    expect(SELF_SWITCH_BARE.endsWith("with 1 of your Benched Pokémon.")).toBe(true);
    // The Item's own string must NOT derive — it is Trainer text, and the attack
    // reader has no business claiming it.
    expect(deriveAttackEffect(item)).toBeNull();
  });

  it("the fixture demonstrator carries all seven BUILT sentences and the ONE still unbuilt", () => {
    // The unbuilt one is fielded ON PURPOSE: a printing the engine deliberately
    // does not read is pinned by a board that carries it, not by a comment.
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    const texts = attacks.map((a) => a.effect);
    for (const { text } of CLAUSES) expect(texts, text).toContain(text);
    expect(texts).toContain(YOU_MAY_SELF_SWITCH);
    // ⚠️ NINE, NOT EIGHT — D189 APPENDED a ninth. Indices 0-7 are D181's and are
    // addressed here by constant, so the append cannot shift them; index 8 is
    // "Spin Turn", the self-switch WITH PRINTED DAMAGE ({C}, 10, modelled on
    // Murkrow sv02-131). It exists because D181's `Slip Away` gave the family no
    // damage at all, and that turns out to be the MINORITY printed shape: of the
    // 20 remote printings of this sentence, 14 print a damage number. Without one
    // there is no board on which "the recoil follows the ATTACKER rather than the
    // SPOT" can even happen — see `vengefulPunch.test.ts`.
    // ⚠️ THIRTEEN, NOT NINE — D227 appended four more (indices 9-12: the
    // opponent-chosen switch-out bare / "You may" / compound, plus the damage-rider
    // printing it deliberately does not read). The constants above still address
    // 0-8, which is the whole point of appending; the length is asserted so a
    // future INSERT is a failure here rather than a silent index shift in nine
    // other cases. `derivedOpponentSwitchOut.test.ts` owns 9-12.
    // ⚠️ FOURTEEN AT D228, which BUILT index 12 and appended index 13 (the gust
    // rider, "Drag Off") — `derivedNewActiveDamage.test.ts` owns 12-13. The
    // append-never-insert discipline has now held across three slices, which is
    // the only reason the nine constants above are still correct.
    // ⚠️ SEVENTEEN AT D229, which appended 14-16 (the attacker's own Energy onto
    // its own Bench — "Volt Cyclone" / "Jet Cyclone" / "Hurricane").
    // `derivedSelfEnergyMove.test.ts` owns 14-16.
    // ⚠️ TWENTY AT D230, which appended 17-19 (the deck search onto your own
    // Bench — "Call for Family" / "Form Ranks" / "Parallel Placement").
    // `derivedBenchSearch.test.ts` owns 17-19.
    // ⚠️ TWENTY-FIVE AT D231, which appended 20-24 (the deck search into your own
    // HAND — "Meal Time" / "Big Meal" / "Energy Search" / "Item Hunt" / "Stadium
    // Search"). `derivedHandSearch.test.ts` owns 20-24.
    // ⚠️ TWENTY-NINE AT D232, which appended 25-28 (the opponent-hand family —
    // "See Through" / "Knock Off" / "Astonish" / "Thieving Swipe").
    // `opponentHandFamily.test.ts` owns 25-28.
    // ⚠️ THIRTY-FIVE AT D234, which appended 29-34 (attach from the DISCARD PILE
    // — "Regi Charge" / "Sand Gift" / "Fault Line" / "Pick and Stick" / "Dragon's
    // Fury" / "Mud Stock"). `derivedDiscardAttach.test.ts` owns 29-34.
    // ⚠️ FORTY-THREE AT D235, which appended 35-42 (the deck search that ATTACHES
    // — "Energy Assist" / "Zap Charge" / "Aqua Supply" / "Energy Bounty" / "Bench
    // Charge" / "Toxic Reserve" / "Water Draw" / "Split Supply").
    // `derivedDeckSearchAttach.test.ts` owns 35-42.
    // ⚠️ FORTY-EIGHT AT D236, which appended 43-47 (attach from the HAND —
    // "Wrapped in Wind" / "Lucky Attachment" / "Full Heart" / "Leaflet Blessings" /
    // "Tropical Frenzy"). `derivedHandAttach.test.ts` owns 43-47. Ten slices, ten
    // appends, zero inserts.
    // ⚠️ FIFTY-FIVE AT D240; **58 at D241**, which appended 55-57 (look at the
    // top N — "Summoning Gate" / "Larimar Rain" / "Dig It Up").
    // `derivedLookAtTop.test.ts` owns 55-57. ELEVEN slices, eleven appends, zero
    // inserts.
    // 🆕🆕 **63 AT D426**, which appended **61-62** — the opponent-chooses hand
    // discard (*"Your opponent discards 2 cards from their hand."* / *"…a card…"*).
    // `opponentHandDiscard.test.ts` owns them, and the append-never-insert
    // discipline this whole paragraph exists for holds again: 0-60 are addressed by
    // constant in a dozen sibling suites and every one of them still means what it
    // meant. ⚠️ NO ORDINAL IS CLAIMED (*"the Nth slice"*) — the running count above
    // was last written at D241 and was already one append behind by D246, which is
    // exactly how a count in a comment rots. The LENGTH is the executable half and
    // it is the line below.
    // 🆕🆕 **68 AT D443**, which appended **66-67** — the OPPONENT-BOARD pair
    // (`derivedOpponentEnergyMove.test.ts` owns them). TWELVE sibling suites carry
    // this pin and all twelve were stepped in one pass, as D442 stepped eleven.
    // 🆕🆕 **66 AT D442**, which appended **63-65** — the destination-side SPREAD
    // (`derivedSpreadEnergyMove.test.ts` owns them). ELEVEN sibling suites carry this
    // same length pin and ALL of them were stepped in one pass (D431): a green run
    // after fixing the one that reddened is evidence the runner stopped early.
    expect(attacks).toHaveLength(73); // 🆕🆕 **72 AT D457**, which appended **71** — and NOT to field a new family: index 42 was the demonstrator's LAST unread sentence and D457 built it, leaving `optionalSelfSwitch.test.ts` §7's loud-path attribution control with no subject at all. 71 is corpus line 404 (the Future-banner attach, DATA-BLOCKED rather than merely unbuilt), and `testFixtures.ts` carries the argument. THIRTEEN suites carry this pin and all thirteen were stepped in one pass (D431).
    expect(attacks[SPIN_TURN]?.damage).toBe(10);
    expect(attacks[SPIN_TURN]?.effect).toBe(SELF_SWITCH_BARE);
    expect(attacks[SLIP_AWAY]?.damage).toBeUndefined();
  });
});

describe("the anchors stay DISJOINT — from each other, from the compounds, from five readers", () => {
  it("refuses all EIGHT still-unread near-miss rows — the compounds that contain a clause", () => {
    // THE CASE THIS FILE IS REALLY FOR. Every string here is a real printing that
    // begins with, or contains, one of the seven clauses. An unanchored build
    // reads the first clause and silently drops a whole second mechanic.
    for (const text of NEAR_MISSES) {
      expect(deriveAttackEffect(text), text).toBeNull();
      expect(deriveAttackCoinFlip(text), text).toBeNull();
    }
    // …and they really do carry the clauses, so the refusal is doing work rather
    // than being trivially true.
    expect(NEAR_MISSES[0]?.startsWith(SELF_SWITCH_BARE)).toBe(true);
    expect(NEAR_MISSES[1]?.startsWith(CLAUSES[GUST].text)).toBe(true);
    // ⚠️ AND THE TWO TRAILING ONES, WHICH ARE WHAT THE `$` IS ACTUALLY FOR — a
    // build anchored only at `^` refuses every row above and eats both of these.
    // No `!== SELF_SWITCH_BARE` guard: tsc proves the bare sentence is not in this
    // list (`as const`), and a comparison it can prove false is a comparison that
    // will rot into a lie the day someone adds it.
    const trailing = NEAR_MISSES.filter((t) => t.endsWith(SELF_SWITCH_BARE));
    expect(trailing).toHaveLength(2);
    for (const text of trailing) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("D246's row derives to its OWN program, and to none of the seven", () => {
    // BUILT_AT_D246's block, made re-runnable: the stronger successor to the
    // `toBeNull` this row used to carry. The sentence is READ now, so the claim
    // this file owns is the one an inequality can still state — that it was not
    // read as its FIRST CLAUSE. A dropped `$` on `ATTACK_SELF_SWITCH` gives the
    // bare one-op program below, and that is what is refused.
    const gated = deriveAttackEffect(BUILT_AT_D246[0]);
    expect(gated).not.toBeNull();
    expect(gated).not.toEqual([{ op: "switchActive" }]);
    expect(gated).not.toEqual(deriveAttackEffect(SELF_SWITCH_BARE));
    // …and it really does carry the clause, so the inequality is doing work.
    expect(BUILT_AT_D246[0].startsWith(SELF_SWITCH_BARE)).toBe(true);
  });

  it("D227's three rows derive to their OWN programs, and to none of the seven", () => {
    // The stronger successor to a `toBeNull` — see BUILT_AT_D227's block. Each of
    // these three is now READ, and the property this file cares about is that
    // none of them was read as one of ITS clauses: a dropped `$` on the
    // self-switch anchor would answer the first row with a bare `switchActive`,
    // which is exactly the equality this refuses.
    const ours = CLAUSES.map((c) => JSON.stringify(c.program));
    for (const text of BUILT_AT_D227) {
      const derived = deriveAttackEffect(text);
      expect(derived, text).not.toBeNull();
      expect(ours, text).not.toContain(JSON.stringify(derived));
      // …and no coin is taken on any of them, the same disjointness every clause
      // on this page owes the flip reader.
      expect(deriveAttackCoinFlip(text), text).toBeNull();
    }
    // The compound really does carry this file's clause at the front, so the
    // inequality above is doing work rather than passing on an unrelated string.
    expect(BUILT_AT_D227[0].startsWith(SELF_SWITCH_BARE)).toBe(true);
  });

  it("D228's row derives to its OWN program too — the GUST clause with a tail", () => {
    // The same successor-to-a-`toBeNull` shape one clause over, and the sharper
    // one for this file: this row starts with THIS file's gust sentence, so a
    // dropped `$` on `ATTACK_GUST` answers it with the bare one-op program. The
    // inequality is the guard, and it keeps working now the sentence has an answer.
    const [text] = BUILT_AT_D228;
    expect(text.startsWith(CLAUSES[GUST].text)).toBe(true);
    const derived = deriveAttackEffect(text);
    expect(derived).not.toBeNull();
    expect(derived).not.toEqual(CLAUSES[GUST].program);
    // …and it really is the gust plus a tail rather than some third thing.
    expect(derived?.[0]).toEqual(CLAUSES[GUST].program[0]);
    expect(derived).toHaveLength(2);
    expect(deriveAttackCoinFlip(text)).toBeNull();
  });

  it("hands no clause to the coin reader — a build where both fired would flip twice", () => {
    for (const { text } of CLAUSES) {
      expect(deriveAttackCoinFlip(text), text).toBeNull();
    }
  });

  it("hands no clause to the three scaling readers or the requirement gate", () => {
    for (const { text } of CLAUSES) {
      expect(deriveAttackDamageBonus(text), text).toBeNull();
      expect(deriveAttackDamagePenalty(text), text).toBeNull();
      expect(deriveAttackDamageMultiplier(text), text).toBeNull();
      expect(deriveAttackRequirement(text), text).toBeNull();
    }
  });

  it("keeps each anchor off every OTHER clause in the table", () => {
    // Five anchors, one function, no dispatch table — so "one anchored reader per
    // printed string" has to be a property rather than an accident of order.
    for (const mine of CLAUSES) {
      for (const other of CLAUSES) {
        if (other.text === mine.text) continue;
        expect(deriveAttackEffect(other.text), `${other.text} vs ${mine.text}`).not.toEqual(
          mine.program,
        );
      }
    }
  });

  it("refuses the anchor, punctuation and case rewrites — but trims outer space", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Draw a card",
      "Draw 2 cards",
      "Draw cards until you have 7 cards in your hand",
      "Switch this Pokémon with 1 of your Benched Pokémon",
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot",
      // A LOWERCASE first word — half of what keeps a MID-SENTENCE clause off the
      // derived path (the other half is the `^`), and the reason no /i flag is on
      // any of these. "…, draw a card." is a real printed shape in this pool.
      "draw a card.",
      "draw 2 cards.",
      "switch this Pokémon with 1 of your Benched Pokémon.",
      "switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
      // A CAPITALISED consequent behind a gate: the printed text lowercases it.
      "Flip a coin. If heads, Switch this Pokémon with 1 of your Benched Pokémon.",
      // TAILS, not heads — four characters that invert the sentence.
      "Flip a coin. If tails, switch this Pokémon with 1 of your Benched Pokémon.",
      "Flip a coin. If tails, switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
      // A MULTI-FLIP count. A gate over N flips is a fold, not a gate.
      "Flip 2 coins. If heads, switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
      "Flip a coin until you get tails. If heads, switch this Pokémon with 1 of your Benched Pokémon.",
      // MISSING the comma after "If heads".
      "Flip a coin. If heads switch this Pokémon with 1 of your Benched Pokémon.",
      // "1 of" → "2 of": the count is LITERAL in both switch anchors because every
      // printing prints 1, and a 2 would be a different park.
      "Switch this Pokémon with 2 of your Benched Pokémon.",
      "Switch in 2 of your opponent's Benched Pokémon to the Active Spot.",
      // THE SEAT, SWAPPED. Neither of these is printed, and each is the other
      // anchor's sentence with one possessive moved — the mutation a single
      // alternation with a captured possessive would have admitted.
      "Switch in 1 of your Benched Pokémon to the Active Spot.",
      "Switch this Pokémon with 1 of your opponent's Benched Pokémon.",
      // A NON-BREAKING SPACE where an ASCII one is printed — byte-different and
      // INVISIBLE in a diff, which is why it is spelled as an escape rather than
      // typed. A re-ingest that swapped one in would un-simulate every printing
      // with nothing on screen to see.
      `Draw${NBSP}a card.`,
      `Switch in 1 of your${NBSP}opponent's Benched Pokémon to the Active Spot.`,
      // "cards" → "card" on the until-arm; the printed noun is plural there even
      // at N=1, because the sentence counts the HAND, not the draw.
      "Draw cards until you have 7 card in your hand.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    // …but OUTER whitespace is trimmed, exactly like every other arm.
    expect(deriveAttackEffect("  Draw a card.  ")).toEqual([{ op: "drawCards", count: 1 }]);
    expect(
      deriveAttackEffect("\nSwitch in 1 of your opponent's Benched Pokémon to the Active Spot.\n"),
    ).toEqual([{ op: "gust" }]);
  });

  it("accepts BOTH apostrophes in the gust clauses — deliberately, not accidentally", () => {
    // The catalog is all-straight today (`curlyApostropheAnywhere === 0`), so the
    // curly arm exists against a future re-ingest rather than against today's
    // bytes — the same arrangement the mill and discard families carry. The two
    // self-switch anchors carry no apostrophe at all, which is why only these two
    // have the class.
    const curly = CLAUSES[GUST].text.replace("'", "’");
    expect(curly).not.toBe(CLAUSES[GUST].text);
    expect(deriveAttackEffect(curly)).toEqual([{ op: "gust" }]);
    expect(deriveAttackEffect(CLAUSES[FLIP_GUST].text.replace("'", "’"))).toEqual(
      CLAUSES[FLIP_GUST].program,
    );
    expect(SELF_SWITCH_BARE).not.toContain("'");
  });
});

// ── MUTATION CHECKS: the wrong implementation a future author would actually
//    write, taken from a NEIGHBOURING ARM's real code rather than invented. ──

describe("mutants — each arm's realistic wrong build, and the case that kills it", () => {
  it("DRAW: dropping the `>= 1` guard (the arm beside it has none; a copy might not)", () => {
    // The realistic mutant is `return [{ op: "drawCards", count }]` with no guard
    // — what you get by copying the switch arms' shape (`if (X.test(effect))
    // return […]`) onto a CAPTURING regex. Killed by the printed zero.
    const mutant = (text: string): EffectOp[] | null => {
      const m = /^Draw (?:(\d+) cards|a card)\.$/.exec(text.trim());
      return m === null
        ? null
        : [{ op: "drawCards", count: m[1] === undefined ? 1 : Number(m[1]) }];
    };
    expect(mutant("Draw 0 cards.")).toEqual([{ op: "drawCards", count: 0 }]);
    expect(deriveAttackEffect("Draw 0 cards.")).toBeNull();
  });

  it("DRAW: the singular branch defaulting to the WRONG count", () => {
    // `Number(undefined)` is NaN, and it is what a copy of arm 15's
    // `match[1] === undefined ? 1 : …` gets wrong in exactly one way. Killed by
    // the singular case — which is 7 of the family's 12 printings.
    const nan = (text: string): EffectOp[] | null => {
      const m = /^Draw (?:(\d+) cards|a card)\.$/.exec(text.trim());
      return m === null ? null : [{ op: "drawCards", count: Number(m[1]) }];
    };
    expect(Number.isNaN((nan("Draw a card.")?.[0] as { count: number }).count)).toBe(true);
    expect(deriveAttackEffect("Draw a card.")).toEqual([{ op: "drawCards", count: 1 }]);
  });

  it("DRAW-UNTIL: reading the size as a DRAW COUNT — the two ops' whole distinction", () => {
    // The op the sentence looks like is `drawCards`, and the engine has an arm for
    // that two lines up. `drawUntilHandSize` reads the CURRENT hand and
    // `drawCards` does not, so this mutant is invisible off an empty hand and
    // wrong off every other one. Killed by the program shape AND by the board case
    // below ("draws NOTHING when the hand is already at size").
    const mutant = (text: string): EffectOp[] | null => {
      const m = /^Draw cards until you have (\d+) cards in your hand\.$/.exec(text.trim());
      return m === null ? null : [{ op: "drawCards", count: Number(m[1]) }];
    };
    expect(mutant(CLAUSES[DRAW_UNTIL].text)).toEqual([{ op: "drawCards", count: 7 }]);
    expect(deriveAttackEffect(CLAUSES[DRAW_UNTIL].text)).toEqual([
      { op: "drawUntilHandSize", size: 7 },
    ]);
  });

  it("SWITCH: crossing the two seats — the mutant that produces a legal-looking OPPOSITE", () => {
    // Copy the gust arm onto the self-switch anchor (or vice versa) and you get a
    // build that switches the ATTACKER out where the card drags the DEFENDER up.
    // Same prompt kind, same events, same op shape; only the SEAT differs, and
    // only a board can see it. Killed by the derived program here and by the
    // "which side moved" board cases below.
    const mutant = (text: string): EffectOp[] | null =>
      /^Switch in 1 of your opponent['’]s Benched Pokémon to the Active Spot\.$/.test(text.trim())
        ? [{ op: "switchActive" }]
        : null;
    expect(mutant(CLAUSES[GUST].text)).toEqual([{ op: "switchActive" }]);
    expect(deriveAttackEffect(CLAUSES[GUST].text)).toEqual([{ op: "gust" }]);
  });

  it("GATED: dropping the gate — a build that passes every HEADS assertion", () => {
    // Copy the bare arm (`if (test) return [op]`) onto the gated string and the
    // coin vanishes. Every heads-face board case still passes; only a TAILS seed
    // separates them, which is why the board cases collect both faces.
    const mutant = (text: string): EffectOp[] | null =>
      /^Flip a coin\. If heads, switch in 1 of your opponent['’]s Benched Pokémon to the Active Spot\.$/.test(
        text.trim(),
      )
        ? [{ op: "gust" }]
        : null;
    expect(mutant(CLAUSES[FLIP_GUST].text)).toEqual([{ op: "gust" }]);
    expect(deriveAttackEffect(CLAUSES[FLIP_GUST].text)).not.toEqual([{ op: "gust" }]);
    expect(deriveAttackEffect(CLAUSES[FLIP_GUST].text)).toEqual(CLAUSES[FLIP_GUST].program);
  });

  it("SELF-SWITCH: dropping the `^` — the mutant that BUILDS D186's unbuilt printing", () => {
    // ⚠️ THE REALISTIC WRONG BUILD FOR D189's ARM, and it is realistic because the
    // right one is one character away. An author adding this anchor writes the
    // sentence out and anchors the END (the period is right there); forgetting the
    // `^` costs NOTHING on the six-set census — all 6 printings there begin with
    // the clause — and silently eats the two TRAILING compounds from the wider
    // remote, each of which prints a whole second mechanic in front of the switch.
    const mutant = (text: string): EffectOp[] | null =>
      /Switch this Pokémon with 1 of your Benched Pokémon\.$/.test(text.trim())
        ? [{ op: "switchActive" }]
        : null;
    const trailing = NEAR_MISSES.filter((t) => t.endsWith(SELF_SWITCH_BARE));
    expect(trailing).toHaveLength(2);
    for (const text of trailing) {
      expect(mutant(text), text).not.toBeNull(); // the mutant eats it…
      expect(deriveAttackEffect(text), text).toBeNull(); // …and the real reader does not
    }
    // ⚠️ AND A FINDING THAT FELL OUT OF WRITING THIS MUTANT RATHER THAN OF
    // REASONING ABOUT IT: dropping the `^` does NOT reach the "You may" printing,
    // which was the first thing this case was written to claim. That sentence
    // LOWERCASES the verb ("You may **s**witch…"), so the capital `S` is what
    // refuses it, and the `^` is doing a different job entirely. Two guards, two
    // rows, and neither is redundant — the `^` protects the trailing compounds and
    // the CASE keeps `ATTACK_SELF_SWITCH` off a sentence that is now a DIFFERENT
    // ARM's rather than off one that is nobody's.
    expect(YOU_MAY_SELF_SWITCH).toContain(" switch this Pokémon");
    expect(YOU_MAY_SELF_SWITCH).not.toContain("Switch this Pokémon");
    expect(mutant(YOU_MAY_SELF_SWITCH)).toBeNull(); // NOT eaten — by the case, not the anchor
    // 🆕🆕 D422 — AND THIS RUNG GOT SHARPER RATHER THAN WEAKER WHEN THE SENTENCE WAS
    // BUILT, WHICH IS THE POINT OF RE-POINTING IT INSTEAD OF DELETING IT. `caseless`
    // used to be "the mutant that WOULD reach an unbuilt sentence", refuted by a
    // `toBeNull` — a weak claim, because the sentence was nobody's. It is now
    // EXACTLY the defect D422's own author could have shipped: the right anchor with
    // the `optional` wrapper forgotten, i.e. the offer read as a mandatory switch.
    // The refutation is therefore an INEQUALITY against a real program rather than
    // an absence, which is the one shape that stays red under both builds.
    const caseless = (text: string): EffectOp[] | null =>
      /^You may switch this Pokémon with 1 of your Benched Pokémon\.$/.test(text.trim())
        ? [{ op: "switchActive" }]
        : null;
    expect(caseless(YOU_MAY_SELF_SWITCH)).toEqual([{ op: "switchActive" }]);
    expect(deriveAttackEffect(YOU_MAY_SELF_SWITCH)).not.toEqual(caseless(YOU_MAY_SELF_SWITCH));
    expect(deriveAttackEffect(YOU_MAY_SELF_SWITCH)).toEqual(YOU_MAY_SELF_SWITCH_PROGRAM);
    // …and the un-anchored capital-`S` mutant STILL cannot reach it, so the two
    // guards remain independent: one sentence, two ways to get it wrong.
    expect(mutant(YOU_MAY_SELF_SWITCH)).not.toEqual(deriveAttackEffect(YOU_MAY_SELF_SWITCH));
  });

  it("SELF-SWITCH: reusing the GUST's apostrophe class — a widening with no printing behind it", () => {
    // The neighbouring arm two lines up carries `['’]`, so the copy-paste keeps it
    // and reaches for a possessive that is not in this sentence at all. Harmless
    // today (the class has nothing to match) and it is exactly how "Switch this
    // Pokémon with 1 of your OPPONENT'S Benched Pokémon." — the seat-swapped
    // string this file already refuses — starts looking admissible. Pinned as the
    // absence it is: neither self-switch sentence contains an apostrophe.
    expect(SELF_SWITCH_BARE).not.toContain("'");
    expect(SELF_SWITCH_BARE).not.toContain("\u2019");
    expect(SELF_SWITCH_FLIP).not.toContain("'");
    expect(deriveAttackEffect("Switch this Pokémon with 1 of your opponent's Benched Pokémon.")).toBeNull();
  });

  it("ALL SEVEN: a SUBSTRING matcher instead of a whole-string anchor", () => {
    // The generic mutant, and the one the whole `^…$` convention exists against.
    // Run every anchor UNANCHORED over the eight real near-misses and count what
    // it would have eaten — five of the eight, each of them a compound whose
    // second mechanic would vanish without a word in the log.
    const unanchored = [
      /Draw (?:(\d+) cards|a card)\./,
      /Draw cards until you have (\d+) cards in your hand\./,
      /Switch this Pokémon with 1 of your Benched Pokémon\./,
      /Switch in 1 of your opponent['’]s Benched Pokémon to the Active Spot\./,
    ];
    const eaten = NEAR_MISSES.filter((text) => unanchored.some((re) => re.test(text)));
    // D181's list gave 5; D189's four new rows pushed it to 7; D227 took ONE of
    // those seven out of this list by BUILDING it (Iron Bundle's compound, now in
    // BUILT_AT_D227 where the same mutant is caught by an inequality instead), so
    // six remained. D228 took a SECOND out the same way (the gust-plus-30 rider,
    // now in BUILT_AT_D228), so five remain. The "Search your deck … You may
    // switch" row escapes for the CASE reason two cases up, which is the same
    // finding from the other direction. D246 took a THIRD out (Kilowattrel ex's
    // gated attach, now in BUILT_AT_D246), so four remain.
    expect(eaten.length).toBe(4);
    // …and every one of them is refused by the real reader.
    for (const text of eaten) expect(deriveAttackEffect(text), text).toBeNull();
    // ⚠️ AND BOTH ROWS THAT LEFT ARE STILL EATEN BY THE SAME UNANCHORED BUILD —
    // which is why they moved rather than being dropped. Without these two lines
    // the count above could fall to zero by the family being built out, and the
    // mutant would go unwitnessed with the test still green.
    expect(unanchored.some((re) => re.test(BUILT_AT_D227[0]))).toBe(true);
    expect(unanchored.some((re) => re.test(BUILT_AT_D228[0]))).toBe(true);
    expect(unanchored.some((re) => re.test(BUILT_AT_D246[0]))).toBe(true);
  });
});

// ── The board. `fix-trainerops` carries all NINE printings; see its doc block
//    for why the demonstrator is synthetic (none of the 28 real printings is in
//    this pool, and none can be added while the manifest is unregenerable — the
//    generator reads a `.wrangler` sqlite that does not exist in this container,
//    which is exactly why D189's ninth attack is a synthetic `fix-*` body too). ──

const COLLECT = 0;
const STOCK_UP = 1;
const TAUNT = 2;
const ESCORT = 3;
const DOUBLE_DRAW = 4;
const SLIP_AWAY = 5;
const RIDE_THE_WIND = 6;
const STRAFE = 7;
/** D189 — the self-switch WITH printed damage, appended at 8. */
const SPIN_TURN = 8;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: TRAINER_OPS_DECK, p2: TRAINER_OPS_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops` and holds `ownBench` Benched `fix-basic-1`;
    p2 holds one `fix-bigbody` Active and `oppBench` Benched `fix-basic-1`. Both
    Benches are set explicitly, because every case here is about WHICH ONE moved. */
function ready(seed: number, ownBench: number, oppBench: number): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (let i = 0; i < ownBench; i++) state = benchFromDeck(state, "p1", "fix-basic-1");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  for (let i = 0; i < oppBench; i++) state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function face(events: GameEvent[]): CoinFace | undefined {
  return all(events, "ATTACK_EFFECT_COIN_FLIP")[0]?.result;
}

/** The draws THIS ATTACK made. ⚠️ Not `all(events, "CARDS_DRAWN")`: declaring an
    attack ENDS the turn, so the opponent's turn-start draw lands in the same
    event list and a bare filter counts it. `reason: "effect"` is the discriminator
    the event already carries, and getting this wrong is how a "drew nothing" case
    passes while reporting someone else's card. */
function effectDraws(events: GameEvent[]): Extract<GameEvent, { type: "CARDS_DRAWN" }>[] {
  return all(events, "CARDS_DRAWN").filter((e) => e.reason === "effect");
}

describe("end to end — the two DRAW arms", () => {
  it("'Draw a card.' draws exactly one, and never parks", () => {
    const state = ready(1, 1, 1);
    const before = state.players.p1.hand.length;
    deepFreeze(state);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: COLLECT });
    expect(done.players.p1.hand.length).toBe(before + 1);
    expect(effectDraws(events)[0]).toMatchObject({ seat: "p1", reason: "effect" });
    expect(effectDraws(events)[0]?.uids).toHaveLength(1);
    // A draw is not a decision — the attack resolves straight through, never to
    // an effect:choose.
    expect(done.phase.kind).not.toBe("effect:choose");
    // …and no loud row: the sentence WAS read.
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
  });

  it("'Draw 2 cards.' draws two — the count is READ, not assumed", () => {
    const state = ready(2, 1, 1);
    const before = state.players.p1.hand.length;
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: DOUBLE_DRAW,
    });
    expect(done.players.p1.hand.length).toBe(before + 2);
    expect(effectDraws(events)[0]?.uids).toHaveLength(2);
  });

  it("'Draw cards until you have 7…' fills a SHORT hand and draws NOTHING off a full one", () => {
    // THE PAIR THAT DISTINGUISHES THE TWO OPS. A `drawCards 7` mutant passes the
    // first half on any hand and fails the second on every hand of 7 or more,
    // which is the whole reason `drawUntilHandSize` exists as its own op.
    let short = ready(3, 1, 1);
    // The hand size is this op's INPUT, so it is SET rather than hoped for: keep
    // two and put the rest back on top of the deck.
    const p1 = short.players.p1;
    short = {
      ...short,
      players: {
        ...short.players,
        p1: { ...p1, hand: p1.hand.slice(0, 2), deck: [...p1.hand.slice(2), ...p1.deck] },
      },
    };
    const { state: filled, events: fillEvents } = mustApply(short, {
      type: "attack",
      seat: "p1",
      index: STOCK_UP,
    });
    expect(filled.players.p1.hand.length).toBe(7);
    expect(effectDraws(fillEvents)[0]?.uids).toHaveLength(5);

    let big = ready(4, 1, 1);
    const side = big.players.p1;
    const owed = Math.max(0, 9 - side.hand.length);
    big = {
      ...big,
      players: {
        ...big.players,
        p1: { ...side, hand: [...side.hand, ...side.deck.slice(0, owed)], deck: side.deck.slice(owed) },
      },
    };
    const handBefore = big.players.p1.hand.length;
    expect(handBefore).toBeGreaterThan(7);
    const { state: unchanged, events: noneEvents } = mustApply(big, {
      type: "attack",
      seat: "p1",
      index: STOCK_UP,
    });
    expect(unchanged.players.p1.hand.length).toBe(handBefore);
    expect(effectDraws(noneEvents)).toHaveLength(0);
    // …and still no loud row. The sentence was read; it simply had nothing to do.
    expect(all(noneEvents, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
  });
});


describe("end to end — the GUST moves the OPPONENT'S side, and only theirs", () => {
  it("drags the opponent's bench up, leaving the attacker untouched", () => {
    const state = ready(6, 2, 1);
    const ownActive = activeUid(state, "p1");
    const wasActive = activeUid(state, "p2");
    const wasBenched = state.players.p2.bench[0]?.stack[0];
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: TAUNT });
    // One benched body → parkOrForce's forced branch, no decision left.
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeUid(done, "p2")).toBe(wasBenched);
    expect(done.players.p2.bench[0]?.stack[0]).toBe(wasActive);
    // ⚠️ THE ATTACKER DID NOT MOVE — the assertion the crossed-seat mutant fails,
    // and the same fact `finishAttack` relies on to address the Attacking Pokémon
    // by spot (which is why the SELF-switch family is not built; see the UNBUILT
    // block). The board is populated on BOTH sides so this is a real choice.
    expect(activeUid(done, "p1")).toBe(ownActive);
    expect(done.players.p1.bench).toHaveLength(2);
  });

  it("PARKS over the OPPONENT'S Bench when there is a choice, and the CONTROLLER answers", () => {
    const { state: parked } = mustApply(ready(7, 3, 3), {
      type: "attack",
      seat: "p1",
      index: TAUNT,
    });
    expect(parked.phase.kind).toBe("effect:choose");
    const phase = parked.phase;
    expect(phase.kind === "effect:choose" ? phase.prompt.kind : undefined).toBe("choosePokemon");
    // The CONTROLLER answers — you choose which of THEIRS comes up, which is
    // Boss's Orders' own reading, so the park carries no `answerer`.
    expect(phase.kind === "effect:choose" ? phase.seat : undefined).toBe("p1");
    expect(phase.kind === "effect:choose" ? phase.answerer : "unset").toBeUndefined();
    const candidates =
      phase.kind === "effect:choose" && phase.prompt.kind === "choosePokemon"
        ? phase.prompt.candidates
        : [];
    expect(candidates).toHaveLength(3);
    // EVERY candidate is on the OPPONENT's bench — on a board where BOTH benches
    // hold three, so the crossed-seat mutant offers the wrong three here.
    for (const ref of candidates) {
      expect(ref.seat).toBe("p2");
      expect(ref.spot.spot).toBe("bench");
    }
  });

  it("is a SILENT no-op on an empty opponent Bench — and still not a skipped effect", () => {
    const state = ready(8, 2, 0);
    const before = [activeUid(state, "p1"), activeUid(state, "p2")];
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: TAUNT });
    expect([activeUid(done, "p1"), activeUid(done, "p2")]).toEqual(before);
    expect(done.phase.kind).not.toBe("effect:choose");
    // The sentence WAS read and had no legal target; a loud row would be a lie,
    // exactly as on a tails flip. Note p1's OWN bench is stocked, so a build that
    // read the wrong seat would have found candidates and moved something.
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
  });
});

describe("end to end — the GATED gust, on both faces", () => {
  it("gusts on HEADS and moves nothing on TAILS", () => {
    const faces = new Map<CoinFace, string>();
    for (const seed of SEEDS) {
      const state = ready(seed, 1, 1);
      const wasBenched = state.players.p2.bench[0]?.stack[0] ?? "";
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: ESCORT,
      });
      const result = face(events);
      expect(result, `seed ${seed} took no coin`).toBeDefined();
      faces.set(result as CoinFace, activeUid(done, "p2") === wasBenched ? "gusted" : "unmoved");
    }
    // BOTH FACES WERE SEEN — otherwise the pair below passes vacuously on one.
    expect([...faces.keys()].sort()).toEqual(["heads", "tails"]);
    expect(faces.get("heads")).toBe("gusted");
    expect(faces.get("tails")).toBe("unmoved");
  });

  it("takes the coin on BOTH faces — a tails is a flip, not a no-op", () => {
    for (const seed of SEEDS) {
      const state = ready(seed, 1, 1);
      deepFreeze(state);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: ESCORT,
      });
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
      expect(done.rngState).not.toBe(state.rngState);
      expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    }
  });
});

describe("the TAIL PLACEMENT the gust inherits — damage, then the effect, then Knock Outs", () => {
  it("switches the DYING defender to the Bench, and the KO sweep finds it there", () => {
    // `Escort` prints 60 into a 60 HP `fix-basic-1`, so the main hit is lethal and
    // the gust runs while the dead body is still Active (an `EffectOp` runs at
    // attack.ts's tail, BEFORE `finishAttack`'s §8.1 sweep — D125). The printed
    // order is damage → the attack's effect → Knock Outs, and that is what this
    // asserts rather than assumes.
    const faces = new Set<CoinFace>();
    for (const seed of SEEDS) {
      let state = ready(seed, 0, 0);
      state = setActiveFromDeck(state, "p2", "fix-basic-1");
      state = clearBench(state, "p2");
      state = benchFromDeck(state, "p2", "fix-basic-1");
      const dying = activeUid(state, "p2");
      const benched = state.players.p2.bench[0]?.stack[0];
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: ESCORT,
      });
      const result = face(events);
      expect(result).toBeDefined();
      faces.add(result as CoinFace);
      // BOTH FACES: the 60 HP body took 60 and was Knocked Out exactly once, and
      // it is the body that was ACTIVE when the damage landed — never the one the
      // gust brought up.
      const knockouts = all(events, "KNOCKED_OUT");
      expect(knockouts).toHaveLength(1);
      expect(knockouts[0]?.uid).toBe(dying);
      // The KO RESOLVED — p1 is owed its Prize, which is the phase a Knock Out
      // opens (prizes are TAKEN by an action, not by the attack).
      expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
      if (result === "heads") {
        // ⚠️ THE ORDER, VISIBLE ON THE EVENT LIST: POKEMON_SWITCHED comes BEFORE
        // KNOCKED_OUT. The dying body was gusted to the Bench and the sweep found
        // it there, so the benched Pokémon is Active and the Bench is empty —
        // exactly what "damage, then the attack's effect, then Knock Outs" means.
        const types = events.map((e) => e.type);
        expect(types.indexOf("POKEMON_SWITCHED")).toBeGreaterThan(types.indexOf("DAMAGE_DEALT"));
        expect(types.indexOf("POKEMON_SWITCHED")).toBeLessThan(types.indexOf("KNOCKED_OUT"));
        expect(done.players.p2.active?.stack[0]).toBe(benched);
        expect(done.players.p2.bench).toHaveLength(0);
      } else {
        // TAILS: no switch at all, so the Active died in place and p2 has no
        // Active until it promotes.
        expect(all(events, "POKEMON_SWITCHED")).toHaveLength(0);
        expect(done.players.p2.active).toBeNull();
        expect(done.players.p2.bench[0]?.stack[0]).toBe(benched);
      }
    }
    expect([...faces].sort(), "one face never came up — half the case proved nothing").toEqual([
      "heads",
      "tails",
    ]);
  });
});

// ── THE REMAINDER, PINNED IN CODE. ──────────────────────────────────────────

describe("end to end — the SELF-SWITCH, the family D181 priced and D189 paid for", () => {
  it("'Switch this Pokémon…' moves the ATTACKER, and the mirror op would have moved the DEFENDER", () => {
    // ⚠️ THE SHARPEST MUTANT IN THE SLICE, DRIVEN. `switchActive` and `gust` are
    // one `otherSeat` apart at the interpreter — same prompt kind, same events,
    // same `switchInto` — so a build that crossed them produces a legal-looking
    // board with the opposite effect and nothing but the SEAT to see it by. Both
    // sides are asserted, in both directions, on one board.
    const state = ready(20, 1, 1);
    const myActive = activeUid(state, "p1");
    const myBench = state.players.p1.bench[0]?.stack.at(-1);
    const theirActive = activeUid(state, "p2");
    const theirBench = state.players.p2.bench[0]?.stack.at(-1);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SLIP_AWAY,
    });

    // MY side moved: the attacker is benched and my Benched body is Active.
    expect(activeUid(done, "p1")).toBe(myBench);
    expect(done.players.p1.bench[0]?.stack.at(-1)).toBe(myActive);
    // THEIRS did not — the half a crossed build gets exactly backwards.
    expect(activeUid(done, "p2")).toBe(theirActive);
    expect(done.players.p2.bench[0]?.stack.at(-1)).toBe(theirBench);
    // One candidate, so `parkOrForce` FORCED it: no question was asked.
    expect(done.phase.kind).not.toBe("effect:choose");
    // …and the sentence was READ, so nothing is flagged.
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
  });

  it("PARKS on a two-body Bench, and the epilogue waits behind the question", () => {
    // ≥2 candidates is a decision, and it is the ATTACKER's. The `attackEpilogue`
    // sitting in `pending` behind it is the stage that now carries the attacker's
    // uid — the persisted shape this slice bumped MATCH_RECORD_VERSION for.
    const state = ready(21, 2, 1);
    const attacker = activeUid(state, "p1");
    deepFreeze(state);

    const { state: parked, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SLIP_AWAY,
    });

    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.seat).toBe("p1"); // the ATTACKER decides — not the opponent
    expect(parked.phase.resumeTail).toBe(true);
    expect(parked.phase.prompt.kind).toBe("choosePokemon");
    // The candidates are the ATTACKER's OWN Bench — the seat again.
    if (parked.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(parked.phase.prompt.candidates.every((ref) => ref.seat === "p1")).toBe(true);
    expect(parked.phase.prompt.candidates).toHaveLength(2);
    expect(parked.phase.prompt.note).toBe("Switch to which Benched Pokémon?");
    // Nothing moved yet, and the turn has NOT ended.
    expect(activeUid(parked, "p1")).toBe(attacker);
    expect(types(events)).not.toContain("TURN_ENDED");
    expect(parked.pending).toEqual([
      // 🆕 D394 — the stage names the ATTACK as well as the attacker.
      { kind: "attackEpilogue", seat: "p1", uid: attacker, attack: "Slip Away" },
    ]);

    // Answer it, and the switch lands + the turn ends through the SAME epilogue.
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 1 } } },
    });
    expect(activeUid(done, "p1")).not.toBe(attacker);
    expect(done.players.p1.bench.some((b) => b.stack.at(-1) === attacker)).toBe(true);
    expect(done.pending).toEqual([]);
  });

  it("⚠️ AN EMPTY BENCH IS A NO-OP, AND IT IS THE SEAM'S NEWLY REACHABLE EARLY RETURN", () => {
    // ⚠️ THE EARLY RETURN THIS SLICE MADE REACHABLE, enumerated rather than
    // discovered. `parkOrForce`'s zero-candidate arm (`{ done: state }`) was
    // UNREACHABLE while `switchActive` lived only in the Switch Item's `trainer:`
    // program: `programPlayable` (cardplay.ts) refuses to PLAY a `switchActive`
    // Trainer with an empty Bench, so the Item could never run into it.
    //
    // An ATTACK has no such gate and must not have one — §8 declares an attack
    // against its ENERGY COST, never against whether its effect can accomplish
    // anything — so this is the printed "do as much as you can": the attack is
    // used, the turn ends, and the switch moves nobody.
    const state = ready(22, 0, 1);
    const attacker = activeUid(state, "p1");
    expect(state.players.p1.bench).toHaveLength(0);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SLIP_AWAY,
    });

    expect(activeUid(done, "p1")).toBe(attacker); // nobody moved
    expect(done.phase.kind).not.toBe("effect:choose"); // and nothing was asked
    // The attack was USED: it is not flagged as unread, and the turn ended.
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(types(events)).toContain("TURN_ENDED");
    // …and the Trainer seam still refuses the same board, which is what makes the
    // difference a fact about the SEAM rather than about the op.
    expect(programPlayable(done, [{ op: "switchActive" }], "p1")).toBe(false);
  });

  it("the FLIP-GATED printing switches on heads and does nothing on tails", () => {
    // One inner op behind one printed gate — `Escort`'s arrangement on the other
    // seat. Swept across seeds so both faces are driven rather than hoped for.
    let sawHeads = false;
    let sawTails = false;
    for (const seed of SEEDS) {
      const state = ready(seed, 1, 1);
      const attacker = activeUid(state, "p1");
      const benched = state.players.p1.bench[0]?.stack.at(-1);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: RIDE_THE_WIND,
      });
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
      if (face(events) === "heads") {
        sawHeads = true;
        expect(activeUid(done, "p1")).toBe(benched);
      } else {
        sawTails = true;
        expect(activeUid(done, "p1")).toBe(attacker);
      }
      // Either way the OPPONENT's board is untouched — the seat, on the gated arm.
      expect(done.players.p2.bench).toHaveLength(1);
    }
    expect(sawHeads && sawTails).toBe(true);
  });

  it("the GATED program's `then` is BYTE-IDENTICAL to the bare arm's whole program", () => {
    // This family's checkable claim, applied to D189's pair exactly as D181
    // applied it to the gust pair: the gate is procedure in front of the action,
    // so the inner program must be the other anchor's output object-for-object.
    const bare = deriveAttackEffect(SELF_SWITCH_BARE);
    const gated = deriveAttackEffect(SELF_SWITCH_FLIP);
    expect(gated).toHaveLength(1);
    const inner = gated?.[0];
    if (inner === undefined || inner.op !== "coinFlipGate") throw new Error("expected a gate");
    expect(inner.then).toEqual(bare);
    // …and it also equals the REGISTRY program printed on the Switch ITEM, which
    // is the same action read off two different seams by two different readers.
    expect(bare).toEqual(programFor("sv01-194")?.trainer);
  });
});

// ── THE REMAINDER — 🆕🆕 D422: THERE IS NONE. ───────────────────────────────

describe("🆕🆕 D422 — the family's LAST printing, and the blocker that had rotted under its own pin", () => {
  // ⚠️ D181 measured this family at 9 six-set printings across 3 sentences and
  // built NONE of them, on a price the backlog had got wrong. D189 paid that price
  // (a required `uid` on the `attackEpilogue` `PendingStage`, `MATCH_RECORD_VERSION`
  // 11 → 12) and built 7 of the 9. **D422 built the third sentence and the family
  // is whole** — and what it cost is the finding, because it is not what either
  // slice priced.
  //
  //   THE PRINTED "**You may** switch this Pokémon with 1 of your Benched
  //   Pokémon." (2 six-set printings, **3 among Standard-legal cards** — worth
  //   MORE than the six-set count suggests, which is the whole reason both axes
  //   are carried). ONE anchor and ONE `deriveAttackEffect` arm:
  //   `[{ op: "optional", note: effect, then: [{ op: "switchActive" }] }]`. No new
  //   op, no new field, no new prompt kind, and `MATCH_RECORD_VERSION` STAYS 26.
  //
  // 🛑 **WHAT THIS BLOCK USED TO SAY, KEPT VERBATIM BECAUSE THE WAY IT WAS WRONG
  // IS THE LESSON:** *"`switchActive` parks a `choosePokemon`, a prompt shape with
  // NO `declinable` field, and `parkOrForce` AUTO-APPLIES at one candidate, so a
  // decline has nowhere to live. … The remaining route is a new `declinable` on
  // `choosePokemon` plus a decline answer: also PERSISTED … which is the bill D136
  // paid at `MATCH_RECORD_VERSION` 2 → 3. Queued as **D186, the generic
  // confirm-park**."*
  //
  // Every sentence of that was TRUE about `choosePokemon` when written. **The
  // conclusion was wrong because it looked for the decline in the PICK.** The
  // decline lives one op EARLIER, in the `confirm` that `optional` parks — and
  // D186 had already built that wrapper, and **D227 had already proved this exact
  // route on the mirror sentence** (*"You may switch out your opponent's Active
  // Pokémon…"*), in one line, with no change to `optional` and none to
  // `parkOrForce`. `parkOrForce` is untouched by D422 in either direction: behind a
  // "yes" the pick is the same MANDATORY `choosePokemon` the bare sentence has had
  // since D189, still forced at one candidate.
  //
  // ⚠️ **AND THE BLOCKER HAD ROTTED UNDER ITS OWN PIN.** `declinable` was RENAMED
  // to `upTo?: number` on `choosePokemon` at D359 — so from that day *"the prompt
  // has no `declinable` field"* stopped being a GAP and became a TAUTOLOGY, and the
  // guard this block kept to watch it (below) could not go red for ANY reason.
  // ⚠️ `declinable` is NOT gone from the engine and a successor must not read it
  // that way: `choosePokemonMulti` still carries it as a REQUIRED boolean, projected
  // to the wire by `redact.ts` and read by both HUDs. D359 renamed ONE member.
  //
  // ⚠️ AND NOTE WHAT IS NO LONGER HERE. D181's blocker (1) — "no attack program
  // can produce `switchActive`" — was a PIN ON AN INVARIANT, and D189 broke that
  // invariant deliberately. Its case is not deleted quietly: it lives on inverted
  // in `vengefulPunch.test.ts`, where the same sweep now asserts that
  // `switchActive` IS reachable from attack text and a DRIVEN board shows the
  // epilogue surviving it.

  it("reads ALL THREE printed sentences of the family, and the third is the first WRAPPED", () => {
    // 🆕🆕 D422 — was *"reads the ONE remaining printed sentence NOT at all"*.
    expect(deriveAttackEffect(YOU_MAY_SELF_SWITCH)).toEqual(YOU_MAY_SELF_SWITCH_PROGRAM);
    // …and it is an EFFECT and not a coin sentence, which the old rung also said.
    expect(deriveAttackCoinFlip(YOU_MAY_SELF_SWITCH)).toBeNull();
    // Its two siblings are unchanged by the third arriving — the discrimination
    // that matters, since all three share `SELF_SWITCH_CLAUSE`.
    expect(deriveAttackEffect(SELF_SWITCH_BARE)).toEqual([{ op: "switchActive" }]);
    expect(deriveAttackEffect(SELF_SWITCH_FLIP)).not.toBeNull();
    // The three programs are pairwise DISTINCT, so no anchor has eaten another's
    // sentence — the one claim that could not be made while the third was null.
    const three = [SELF_SWITCH_BARE, SELF_SWITCH_FLIP, YOU_MAY_SELF_SWITCH].map((t) =>
      JSON.stringify(deriveAttackEffect(t)),
    );
    expect(new Set(three).size).toBe(3);
    // The Switch ITEM's own near-miss string is refused too — it is Trainer text,
    // and the attack reader has no business claiming it.
    expect(deriveAttackEffect(FIXTURE_POOL["sv01-194"]?.effect ?? "")).toBeNull();
  });

  it("🛑 the prompt shape this arm RIDES, read off a live park — the dead guard, replaced", () => {
    // 🛑🛑 D422 — WHAT WAS HERE COULD NOT GO RED, AND HAD NOT BEEN ABLE TO SINCE
    // D359. It read:
    //
    //     expect(prompt?.kind).toBe("choosePokemon");
    //     expect(prompt === undefined ? "unset" : "declinable" in prompt).toBe(false);
    //
    // titled *"blocker: the prompt an optional switch would need STILL has no
    // `declinable`"*, with a comment promising *"a future widening of the prompt is
    // visible here"*. The widening HAPPENED — D359 renamed `declinable` to `upTo`
    // on this very prompt — and this case saw nothing, because once the key is
    // gone from the member the second line is true BY CONSTRUCTION. It was a guard
    // watching for a field its own type system had made unspellable.
    //
    // ⚠️ SO IT IS REPLACED RATHER THAN DELETED, AND THE REPLACEMENT NAMES A SHAPE
    // D422 ACTUALLY DEPENDS ON: the `switchActive` behind the "yes" parks a
    // `choosePokemon` with a `candidates` array and NO ceiling key — i.e. it is
    // the MANDATORY pick, which is why the decline had to live in the `confirm`
    // and why `parkOrForce` needed no change. A rename of `upTo`, a stray ceiling
    // authored onto this park, or a `switchActive` that started offering a decline
    // of its own all turn this RED. Read off a LIVE park, not off the type.
    const { state: parked } = mustApply(ready(10, 1, 3), {
      type: "attack",
      seat: "p1",
      index: TAUNT,
    });
    const phase = parked.phase;
    expect(phase.kind).toBe("effect:choose");
    const prompt = phase.kind === "effect:choose" ? phase.prompt : undefined;
    if (prompt?.kind !== "choosePokemon") throw new Error("expected a choosePokemon park");
    // The positive half: the fields this park really carries.
    expect(Object.keys(prompt).sort()).toEqual(["candidates", "kind", "note"]);
    expect(prompt.candidates.length).toBeGreaterThan(1); // a real park, not a forced one
    // The negative half, spelled as the key that EXISTS today rather than one that
    // cannot: absent `upTo` is what makes this pick MANDATORY, and mandatory is
    // what D422's design requires of it.
    expect(prompt.upTo).toBeUndefined();
    // ⚠️ THE CONTROL — the same read on a park that DOES carry a ceiling, so the
    // assertion above is discriminating rather than vacuous. Without this, "no
    // `upTo` here" would be as unfalsifiable as the line it replaced.
    const withCeiling = { kind: "choosePokemon", candidates: [], upTo: 1, note: "x" } as const;
    expect(withCeiling.upTo).toBeDefined();
    expect(Object.keys(withCeiling).sort()).not.toEqual(["candidates", "kind", "note"]);
  });

  it("▶️🆕🆕 D422 — it STOPPED being loud, and the board says so: the SAME index now PARKS", () => {
    // 🛑 THE INVERTED CASE, AND IT IS THE POINT OF PINNING AN ABSENCE IN CODE.
    // This case used to read *"STAYS LOUD on a board — the printing is fielded, so
    // the gap has a live witness"*: index 7 of `fix-trainerops` printed the unread
    // sentence, nothing moved on either side, and the engine SAID SO with a loud
    // `ATTACK_EFFECT_SKIPPED`. Its own comment promised *"the day D186 lands, this
    // turns red"*. **It did, and this is what it turned into** — the identical
    // board and the identical index, asserting the opposite of each line.
    //
    // ⚠️ IT IS CONVERTED RATHER THAN DELETED, AND IT IS A POSITIVE ASSERTION
    // RATHER THAN A WEAKER NEGATIVE ONE. `expect(SKIPPED).toHaveLength(0)` alone
    // would be true of a build that read the sentence into the WRONG program, or
    // into an empty one; what is asserted is that the attack PARKS on a `confirm`
    // whose note is the printed sentence, which no other outcome produces.
    const state = ready(9, 2, 2);
    const before = [activeUid(state, "p1"), activeUid(state, "p2")];
    const { state: parked, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: STRAFE,
    });
    // No longer loud — and that is now the SECOND-strongest thing said here.
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    // The strongest: it asks, and it asks the printed question, of the CONTROLLER.
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a confirm park");
    expect(parked.phase.prompt.kind).toBe("confirm");
    expect(parked.phase.prompt.note).toBe(YOU_MAY_SELF_SWITCH);
    expect(parked.phase.answerer).toBeUndefined(); // the printed "you" is the attacker
    // Nothing has MOVED yet — the offer is a question, not a switch.
    expect([activeUid(parked, "p1"), activeUid(parked, "p2")]).toEqual(before);
    // No coin either — the sentence carries none, and the arm reaches for none.
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    // …and the two siblings on the SAME body still resolve WITHOUT asking, on the
    // same board — so "asks" is a fact about this sentence and not this fixture.
    for (const index of [SLIP_AWAY, RIDE_THE_WIND]) {
      const { state: sib, events: live } = mustApply(ready(9, 2, 2), {
        type: "attack",
        seat: "p1",
        index,
      });
      expect(all(live, "ATTACK_EFFECT_SKIPPED"), `index ${index}`).toHaveLength(0);
      const kind = sib.phase.kind === "effect:choose" ? sib.phase.prompt.kind : "none";
      expect(kind, `index ${index}`).not.toBe("confirm");
    }
  });
});
