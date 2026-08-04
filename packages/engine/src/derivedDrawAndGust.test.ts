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
} from "./testFixtures";

// 0.121.0 → 0.122.0 — D181, THE TRAINER-PATH OPS PRINTED AS ATTACK TEXT. Four
// families the engine has executed since M4 on the Trainer path and had no
// ATTACK reader for. Nothing is built: `drawCards`, `drawUntilHandSize`, `gust`
// and `coinFlipGate` all exist, all park (or don't) as they already did, and the
// whole slice is four anchors and four `return`s. D132's inventory rule for the
// fourth family running — for THREE of the four families.
//
// ⚠️⚠️ AND THE FOURTH IS THE FINDING: THE SELF-SWITCH IS NOT BUILT, BECAUSE THE
// BACKLOG'S "one regex + one return, zero new ops" PRICE IS WRONG. It is right
// about the op and wrong about the cost. Deriving `switchActive` from ATTACK text
// lets the attacker leave the Active Spot mid-attack, and `finishAttack`
// addresses the Attacking Pokémon as `players[attackerSeat].active` — an
// addressing `vengefulPunch.test.ts` SWEEPS ("no attack program — derived OR
// authored — can move its own actor off the spot") and whose repair it names in
// advance: hand `finishAttack` a uid, which is a required field on the
// `attackEpilogue` `PendingStage`, which is PERSISTED, which is a
// `MATCH_RECORD_VERSION` bump. This slice is the first to turn that line red. See
// the UNBUILT block at the bottom, which pins BOTH of the family's blockers.
//
// ⚠️ THE CENSUS WAS RE-DERIVED AND EVERY BACKLOG FIGURE HELD EXACT — over
// `json_each(attacks_json)`, six-set scope: draw **12 printings / 2 sentences**,
// draw-until **3 / 1**, self-switch **9 / 3**, gust **4 / 2**. 28 printings, 8
// sentences, of which this slice reads **19 across 5**.
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
] as const;

const DRAW_1 = 0;
const DRAW_2 = 1;
const DRAW_UNTIL = 2;
const GUST = 3;
const FLIP_GUST = 4;

/** The family this slice does NOT read, verbatim — all three printed sentences,
    9 printings (MEASURED). The UNBUILT block at the bottom gives the two
    independent reasons; they are named up here because they are two thirds of
    the backlog row this slice was pointed at. */
const SELF_SWITCH_BARE = "Switch this Pokémon with 1 of your Benched Pokémon.";
const SELF_SWITCH_FLIP =
  "Flip a coin. If heads, switch this Pokémon with 1 of your Benched Pokémon.";

/** The printing this slice does NOT read, verbatim. Its own block at the bottom
    says why; it is named up here because it belongs to the same family and its
    2 printings are part of the 28. */
const YOU_MAY_SELF_SWITCH = "You may switch this Pokémon with 1 of your Benched Pokémon.";

/** U+00A0, spelled as an ESCAPE rather than typed — byte-different from an ASCII
    space and invisible in a diff. `flipGatedOp.test.ts`'s convention, reused. */
const NBSP = "\u00a0";

/** REAL rows from the same sweep that CONTAIN one of the seven clauses and mean
    something else — the population an unanchored or greedy build eats. Counts
    are MEASURED at five-set scope. Kept as data rather than inlined, because
    each one is a live witness that "one anchored reader per printed string" is a
    property of this family and not a slogan. */
const NEAR_MISSES = [
  // The self-switch clause, VERBATIM, followed by a whole second mechanic — the
  // opponent-chooses switch-out, which has no op at all (backlog Tier 3).
  "Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
  // …and the same clause in front of a deck search.
  "Switch this Pokémon with 1 of your Benched Pokémon. If you do, search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.",
  // The opponent-chooses switch-out ALONE, and its "You may" form. Neither is a
  // gust: the SEAT that chooses is the other one, which is the whole mechanic.
  "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
  "You may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
  // The gust clause, VERBATIM, with a damage rider bolted on.
  "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 30 damage to the new Active Pokémon.",
  "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If you do, this attack does 60 damage to the new Active Pokémon, and then flip a coin. If heads, that Pokémon is now Paralyzed.",
  // A switch described from the OTHER side of the table entirely.
  "Your opponent chooses 1 of their Benched Pokémon and switches it with their Active Pokémon. The new Active Pokémon is now Asleep.",
  // The variable-size draw-until (Bronzor sv03-144 "Mirror Draw"). The count is
  // not a number, so `(\d+)` refuses it — and it is a real future slice.
  "Draw cards until you have the same number of cards in your hand as your opponent.",
] as const;

describe("the five anchors — three ops that already existed, four readers that did not", () => {
  it("derives each printed sentence to its op", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up on BOTH populations — 19 of 28 in the 6-set catalog, 34 among LEGAL cards", () => {
    // The arithmetic, stated rather than described, on both axes — because a
    // slice that quietly dropped a sentence would still pass every case above,
    // and a handoff quoting ONE number would be doing exactly what this repo
    // spent four decisions learning not to do about SCOPE.
    const read = CLAUSES.reduce((sum, c) => sum + c.printings, 0);
    expect(read).toBe(19);
    expect(CLAUSES).toHaveLength(5);
    // …and the remainder is exactly the self-switch family: 6 + 1 + 2 = 9.
    expect(read + 9).toBe(28);
    // THE LEGAL COUNT, over the sentences that HAVE one. `null` is NOT MEASURED
    // and is excluded rather than treated as zero — the distinction D135's
    // absent-field rule makes about ops, applied to a census.
    const measured = CLAUSES.filter((c) => c.legalPrintings !== null);
    expect(measured).toHaveLength(4);
    expect(measured.reduce((sum, c) => sum + (c.legalPrintings ?? 0), 0)).toBe(34);
    // ⚠️ AND THE LEGAL COUNT IS BIGGER THAN THE SIX-SET ONE, WHICH IS THE POINT
    // OF CARRYING BOTH: the catalog the backlog ranks families over is almost
    // entirely rotated out (127 of its 978 rows are Standard-legal), while the
    // SENTENCES transfer across sets. A deriver arm is a text parser, so its
    // value is measured over the pool people can actually play.
    expect(34).toBeGreaterThan(read);
    for (const text of [SELF_SWITCH_BARE, SELF_SWITCH_FLIP, YOU_MAY_SELF_SWITCH]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
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

  it("the fixture demonstrator carries all five BUILT sentences and all three UNBUILT ones", () => {
    // The unbuilt three are fielded ON PURPOSE: a printing the engine deliberately
    // does not read is pinned by a board that carries it, not by a comment.
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    const texts = attacks.map((a) => a.effect);
    for (const { text } of CLAUSES) expect(texts, text).toContain(text);
    for (const text of [SELF_SWITCH_BARE, SELF_SWITCH_FLIP, YOU_MAY_SELF_SWITCH]) {
      expect(texts, text).toContain(text);
    }
    expect(attacks).toHaveLength(8);
  });
});

describe("the anchors stay DISJOINT — from each other, from the compounds, from five readers", () => {
  it("refuses all EIGHT real near-miss rows — the compounds that contain a clause", () => {
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
    expect(NEAR_MISSES[4]?.startsWith(CLAUSES[GUST].text)).toBe(true);
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
    expect(eaten.length).toBeGreaterThanOrEqual(4);
    // …and every one of them is refused by the real reader.
    for (const text of eaten) expect(deriveAttackEffect(text), text).toBeNull();
  });
});

// ── The board. `fix-trainerops` carries all eight printings; see its doc block
//    for why the demonstrator is synthetic (none of the 28 real printings is in
//    this pool, and none can be added while the manifest is unregenerable). ──

const COLLECT = 0;
const STOCK_UP = 1;
const TAUNT = 2;
const ESCORT = 3;
const DOUBLE_DRAW = 4;
const SLIP_AWAY = 5;
const RIDE_THE_WIND = 6;
const STRAFE = 7;
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

describe("UNBUILT — the whole SELF-SWITCH family, and the two things it is blocked on", () => {
  // ⚠️ 9 PRINTINGS ACROSS 3 SENTENCES in the six-set catalog — and **10 measured
  // among Standard-legal cards** (bare 7, "You may" 3; the flip-gated one has not
  // been counted there, and is carried as unmeasured rather than as zero).
  // DELIBERATELY LEFT UNREAD — and
  // the backlog priced this row at ONE REGEX AND ONE `return`. It is right about
  // the op (`switchActive` has existed since M4) and wrong about the cost, twice
  // over. Both blockers are asserted below rather than described.
  //
  //   (1) THE 7 BARE + FLIP-GATED PRINTINGS BREAK `finishAttack`'s ADDRESSING.
  //       That function reaches the Attacking Pokémon as
  //       `players[attackerSeat].active`, which is only sound because nothing
  //       between the §8.5 hit and the epilogue can swap that seat's Active.
  //       `switchActive` is the one op that can, and it has lived in exactly one
  //       `trainer:` program (Switch `sv01-194`) that no attack can invoke.
  //       Derive it from ATTACK text and the §8.1 KO-conditioned recoil (Vengeful
  //       Punch `sv03-197`) lands its counters on the body that was just PROMOTED
  //       rather than on the one that attacked. ⚠️ This is not a deduction: it is
  //       SWEPT by `vengefulPunch.test.ts` ("no attack program — derived OR
  //       authored — can move its own actor off the spot"), which names the repair
  //       in advance — hand `finishAttack` a uid, i.e. a REQUIRED field on the
  //       `attackEpilogue` `PendingStage`, which rides `GameState.pending` and is
  //       therefore PERSISTED, i.e. a `MATCH_RECORD_VERSION` bump.
  //       `preventBlock.test.ts`'s total op classification enforces the same claim
  //       independently. **That is a different slice from "a regex and a return".**
  //
  //   (2) THE OTHER 2 PRINTINGS NEED A MECHANISM THAT DOES NOT EXIST — the printed
  //       "**You may**". `switchActive` parks a `choosePokemon`, a prompt shape
  //       with NO `declinable` field, and `parkOrForce` AUTO-APPLIES at one
  //       candidate, so a decline has nowhere to live. The only optional pick that
  //       exists (`damageChosen.optional`) rides `choosePokemonMulti` — a
  //       different prompt kind with a different answer shape (`applyChoice` reads
  //       `pokemonMulti` there and `pokemon` here) — and the decline-by-empty-pick
  //       idiom needs a park with a legal empty answer, which this one is not.
  //       `TriggeredAbility.optional` governs whether a TRIGGER fires, not whether
  //       a pick may be declined. The remaining route is a new `declinable` on
  //       `choosePokemon` plus a decline answer: also PERSISTED (`EffectPrompt`
  //       rides `phase.prompt`/`phase.cont`, and `redact.ts` projects the
  //       `choosePokemonMulti` flag to the WIRE), which is the bill D136 paid at
  //       `MATCH_RECORD_VERSION` 2 → 3. Queued as **D186, the generic
  //       confirm-park** — which is worth MORE than the six-set count suggests:
  //       those 2 printings are **3 among Standard-legal cards**.

  it("reads NONE of the family's three printed sentences", () => {
    for (const text of [SELF_SWITCH_BARE, SELF_SWITCH_FLIP, YOU_MAY_SELF_SWITCH]) {
      expect(deriveAttackEffect(text), text).toBeNull();
      expect(deriveAttackCoinFlip(text), text).toBeNull();
    }
    // The Switch ITEM's own near-miss string is refused too — it is Trainer text,
    // and the attack reader has no business claiming it.
    expect(deriveAttackEffect(FIXTURE_POOL["sv01-194"]?.effect ?? "")).toBeNull();
  });

  it("blocker (1): NO attack program can produce `switchActive`, which is what the epilogue needs", () => {
    // The invariant `finishAttack` rests on, read off the same population
    // `vengefulPunch.test.ts` sweeps — restated here so this file fails too, at
    // the site whose author would be the one to break it. If a future slice
    // derives the self-switch WITHOUT giving the epilogue a uid, both go red.
    const fromAttacks = new Set<string>();
    for (const card of Object.values(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        const derived = attack.effect === undefined ? null : deriveAttackEffect(attack.effect);
        for (const op of derived ?? []) {
          fromAttacks.add(op.op);
          if (op.op === "coinFlipGate") for (const inner of op.then) fromAttacks.add(inner.op);
        }
      }
    }
    // The sweep found real programs, and `gust` among them — so this is a live
    // constraint about the SEAT rather than a claim about switching in general.
    expect(fromAttacks.size).toBeGreaterThan(10);
    expect(fromAttacks.has("gust")).toBe(true);
    expect(fromAttacks.has("switchActive")).toBe(false);
    // …and the op IS reachable on the other seam, which is what makes the family
    // a PRICING decision rather than a missing primitive.
    expect(programFor("sv01-194")?.trainer).toEqual([{ op: "switchActive" }]);
  });

  it("blocker (2): the prompt an optional switch would need has no `declinable`", () => {
    // The pricing, as a fact rather than a paragraph. `switchActive` and `gust`
    // park the SAME prompt kind, so this reads the shape off a LIVE gust park
    // rather than off the type — a future widening of the prompt is visible here.
    const { state: parked } = mustApply(ready(10, 1, 3), {
      type: "attack",
      seat: "p1",
      index: TAUNT,
    });
    const phase = parked.phase;
    expect(phase.kind).toBe("effect:choose");
    const prompt = phase.kind === "effect:choose" ? phase.prompt : undefined;
    expect(prompt?.kind).toBe("choosePokemon");
    expect(prompt === undefined ? "unset" : "declinable" in prompt).toBe(false);
  });

  it("STAYS LOUD on a board — all three printings are fielded, so the gap has live witnesses", () => {
    // A row deliberately not built is pinned by a board that carries it. Indices
    // 5/6/7 of `fix-trainerops` print the three unread sentences: each attack
    // resolves, nothing moves on either side, and the engine SAYS SO with the loud
    // ATTACK_EFFECT_SKIPPED row. The day D186 (or the epilogue-uid slice) lands,
    // these turn red — which is the point of pinning an absence in code.
    for (const index of [SLIP_AWAY, RIDE_THE_WIND, STRAFE]) {
      const state = ready(9, 2, 2);
      const before = [activeUid(state, "p1"), activeUid(state, "p2")];
      const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index });
      expect([activeUid(done, "p1"), activeUid(done, "p2")], `index ${index}`).toEqual(before);
      expect(done.phase.kind).not.toBe("effect:choose");
      expect(all(events, "ATTACK_EFFECT_SKIPPED"), `index ${index}`).toHaveLength(1);
      // No coin either — the flip-gated printing is unread as a WHOLE sentence,
      // so nothing flips and `rngState` is untouched.
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP"), `index ${index}`).toHaveLength(0);
    }
  });
});
