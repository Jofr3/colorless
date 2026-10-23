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

const SELF_SWITCH_BARE = CLAUSES[SELF_SWITCH].text;
const SELF_SWITCH_FLIP = CLAUSES[FLIP_SELF_SWITCH].text;

const YOU_MAY_SELF_SWITCH = "You may switch this Pokémon with 1 of your Benched Pokémon.";

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

const NEAR_MISSES = [
  // The self-switch clause, VERBATIM, in front of a deck search.
  "Switch this Pokémon with 1 of your Benched Pokémon. If you do, search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.",
  "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If you do, this attack does 60 damage to the new Active Pokémon, and then flip a coin. If heads, that Pokémon is now Paralyzed.",
  // A switch described from the OTHER side of the table entirely.
  "Your opponent chooses 1 of their Benched Pokémon and switches it with their Active Pokémon. The new Active Pokémon is now Asleep.",
  "Draw cards until you have the same number of cards in your hand as your opponent.",
  "Your opponent's Active Pokémon is now Confused and Poisoned. Switch this Pokémon with 1 of your Benched Pokémon.",
  "This attack does 10 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) Switch this Pokémon with 1 of your Benched Pokémon.",
  "Search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck. You may switch this Pokémon with 1 of your Benched Pokémon.",
] as const;

const BUILT_AT_D246 = [
  "Switch this Pokémon with 1 of your Benched Pokémon. If you do, attach up to 2 Basic {L} Energy cards from your hand to this Pokémon.",
] as const;

const BUILT_AT_D227 = [
  "Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
  "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
  "You may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
] as const;

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
    const read = CLAUSES.reduce((sum, c) => sum + c.printings, 0);
    expect(read).toBe(26);
    expect(CLAUSES).toHaveLength(7);
    expect(read + 2).toBe(28);
    const measured = CLAUSES.filter((c) => c.legalPrintings !== null);
    expect(measured).toHaveLength(6);
    expect(measured.reduce((sum, c) => sum + (c.legalPrintings ?? 0), 0)).toBe(41);
    expect(CLAUSES[FLIP_GUST].legalPrintings).toBeNull();
    expect(CLAUSES[FLIP_SELF_SWITCH].legalPrintings).toBe(0);
    expect(41).toBeGreaterThan(read);
    expect(CLAUSES[SELF_SWITCH].legalPrintings).toBe(7);
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
    const bare = deriveAttackEffect(CLAUSES[GUST].text);
    const gated = deriveAttackEffect(CLAUSES[FLIP_GUST].text);
    expect(gated).toHaveLength(1);
    const gate = gated?.[0];
    expect(gate?.op).toBe("coinFlipGate");
    expect(gate?.op === "coinFlipGate" ? gate.then : undefined).toEqual(bare);
    expect(gate?.op === "coinFlipGate" ? gate.onTails : "absent").toBeUndefined();
  });
});

describe("the INVENTORY RULE, stated as an equality — one action, two seams", () => {
  it("the derived GUST equals Boss's Orders' registry program", () => {
    expect(deriveAttackEffect(CLAUSES[GUST].text)).toEqual(programFor("sv02-172")?.trainer);
    expect(programFor("sv02-172")?.trainer).toEqual([{ op: "gust" }]);
  });

  it("the derived GATED GUST equals Pokémon Catcher's registry program", () => {
    expect(deriveAttackEffect(CLAUSES[FLIP_GUST].text)).toEqual(programFor("sv01-187")?.trainer);
  });

  it("keeps the GUST off the SELF-SWITCH's op — one `otherSeat` at the interpreter", () => {
    expect(deriveAttackEffect(CLAUSES[GUST].text)).toEqual([{ op: "gust" }]);
    expect(deriveAttackEffect(CLAUSES[GUST].text)).not.toEqual([{ op: "switchActive" }]);
    expect(Object.keys({ op: "gust" })).toEqual(Object.keys({ op: "switchActive" }));
    // …and `switchActive` IS live on the other seam, so this is a constraint
    // rather than a claim about vocabulary the engine never had.
    expect(programFor("sv01-194")?.trainer).toEqual([{ op: "switchActive" }]);
  });
});

describe("PROVENANCE — the anchors against the printed bytes this repo carries", () => {
  it("GUST — sv02-172 Boss's Orders prints it char-for-char", () => {
    expect(FIXTURE_POOL["sv02-172"]?.effect).toBe(CLAUSES[GUST].text);
    expect(FIXTURE_POOL["sv02-172"]?.trainerType).toBe("Supporter");
  });

  it("GATED GUST — sv01-187 Pokémon Catcher prints it char-for-char", () => {
    expect(FIXTURE_POOL["sv01-187"]?.effect).toBe(CLAUSES[FLIP_GUST].text);
  });

  it("each GATED sentence is its BARE sibling behind one printed prefix", () => {
    const pairs: readonly (readonly [string, string])[] = [
      [CLAUSES[GUST].text, CLAUSES[FLIP_GUST].text],
      [SELF_SWITCH_BARE, SELF_SWITCH_FLIP],
    ];
    for (const [bare, gated] of pairs) {
      expect(gated).toBe(`Flip a coin. If heads, ${bare[0]?.toLowerCase()}${bare.slice(1)}`);
    }
  });

  it("the NEAR-MISS pair the doc's prose could not have told apart", () => {
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
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    const texts = attacks.map((a) => a.effect);
    for (const { text } of CLAUSES) expect(texts, text).toContain(text);
    expect(texts).toContain(YOU_MAY_SELF_SWITCH);
    expect(attacks).toHaveLength(73);
    expect(attacks[SPIN_TURN]?.damage).toBe(10);
    expect(attacks[SPIN_TURN]?.effect).toBe(SELF_SWITCH_BARE);
    expect(attacks[SLIP_AWAY]?.damage).toBeUndefined();
  });
});

describe("the anchors stay DISJOINT — from each other, from the compounds, from five readers", () => {
  it("refuses all EIGHT still-unread near-miss rows — the compounds that contain a clause", () => {
    for (const text of NEAR_MISSES) {
      expect(deriveAttackEffect(text), text).toBeNull();
      expect(deriveAttackCoinFlip(text), text).toBeNull();
    }
    // …and they really do carry the clauses, so the refusal is doing work rather
    // than being trivially true.
    expect(NEAR_MISSES[0]?.startsWith(SELF_SWITCH_BARE)).toBe(true);
    expect(NEAR_MISSES[1]?.startsWith(CLAUSES[GUST].text)).toBe(true);
    const trailing = NEAR_MISSES.filter((t) => t.endsWith(SELF_SWITCH_BARE));
    expect(trailing).toHaveLength(2);
    for (const text of trailing) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("D246's row derives to its OWN program, and to none of the seven", () => {
    const gated = deriveAttackEffect(BUILT_AT_D246[0]);
    expect(gated).not.toBeNull();
    expect(gated).not.toEqual([{ op: "switchActive" }]);
    expect(gated).not.toEqual(deriveAttackEffect(SELF_SWITCH_BARE));
    // …and it really does carry the clause, so the inequality is doing work.
    expect(BUILT_AT_D246[0].startsWith(SELF_SWITCH_BARE)).toBe(true);
  });

  it("D227's three rows derive to their OWN programs, and to none of the seven", () => {
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
      "Switch this Pokémon with 2 of your Benched Pokémon.",
      "Switch in 2 of your opponent's Benched Pokémon to the Active Spot.",
      // THE SEAT, SWAPPED. Neither of these is printed, and each is the other
      // anchor's sentence with one possessive moved — the mutation a single
      // alternation with a captured possessive would have admitted.
      "Switch in 1 of your Benched Pokémon to the Active Spot.",
      "Switch this Pokémon with 1 of your opponent's Benched Pokémon.",
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
    const nan = (text: string): EffectOp[] | null => {
      const m = /^Draw (?:(\d+) cards|a card)\.$/.exec(text.trim());
      return m === null ? null : [{ op: "drawCards", count: Number(m[1]) }];
    };
    expect(Number.isNaN((nan("Draw a card.")?.[0] as { count: number }).count)).toBe(true);
    expect(deriveAttackEffect("Draw a card.")).toEqual([{ op: "drawCards", count: 1 }]);
  });

  it("DRAW-UNTIL: reading the size as a DRAW COUNT — the two ops' whole distinction", () => {
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
    const mutant = (text: string): EffectOp[] | null =>
      /Switch this Pokémon with 1 of your Benched Pokémon\.$/.test(text.trim())
        ? [{ op: "switchActive" }]
        : null;
    const trailing = NEAR_MISSES.filter((t) => t.endsWith(SELF_SWITCH_BARE));
    expect(trailing).toHaveLength(2);
    for (const text of trailing) {
      expect(mutant(text), text).not.toBeNull();
      expect(deriveAttackEffect(text), text).toBeNull(); // …and the real reader does not
    }
    expect(YOU_MAY_SELF_SWITCH).toContain(" switch this Pokémon");
    expect(YOU_MAY_SELF_SWITCH).not.toContain("Switch this Pokémon");
    expect(mutant(YOU_MAY_SELF_SWITCH)).toBeNull();
    const caseless = (text: string): EffectOp[] | null =>
      /^You may switch this Pokémon with 1 of your Benched Pokémon\.$/.test(text.trim())
        ? [{ op: "switchActive" }]
        : null;
    expect(caseless(YOU_MAY_SELF_SWITCH)).toEqual([{ op: "switchActive" }]);
    expect(deriveAttackEffect(YOU_MAY_SELF_SWITCH)).not.toEqual(caseless(YOU_MAY_SELF_SWITCH));
    expect(deriveAttackEffect(YOU_MAY_SELF_SWITCH)).toEqual(YOU_MAY_SELF_SWITCH_PROGRAM);
    expect(mutant(YOU_MAY_SELF_SWITCH)).not.toEqual(deriveAttackEffect(YOU_MAY_SELF_SWITCH));
  });

  it("SELF-SWITCH: reusing the GUST's apostrophe class — a widening with no printing behind it", () => {
    expect(SELF_SWITCH_BARE).not.toContain("'");
    expect(SELF_SWITCH_BARE).not.toContain("\u2019");
    expect(SELF_SWITCH_FLIP).not.toContain("'");
    expect(
      deriveAttackEffect("Switch this Pokémon with 1 of your opponent's Benched Pokémon."),
    ).toBeNull();
  });

  it("ALL SEVEN: a SUBSTRING matcher instead of a whole-string anchor", () => {
    const unanchored = [
      /Draw (?:(\d+) cards|a card)\./,
      /Draw cards until you have (\d+) cards in your hand\./,
      /Switch this Pokémon with 1 of your Benched Pokémon\./,
      /Switch in 1 of your opponent['’]s Benched Pokémon to the Active Spot\./,
    ];
    const eaten = NEAR_MISSES.filter((text) => unanchored.some((re) => re.test(text)));
    expect(eaten.length).toBe(4);
    // …and every one of them is refused by the real reader.
    for (const text of eaten) expect(deriveAttackEffect(text), text).toBeNull();
    expect(unanchored.some((re) => re.test(BUILT_AT_D227[0]))).toBe(true);
    expect(unanchored.some((re) => re.test(BUILT_AT_D228[0]))).toBe(true);
    expect(unanchored.some((re) => re.test(BUILT_AT_D246[0]))).toBe(true);
  });
});

const COLLECT = 0;
const STOCK_UP = 1;
const TAUNT = 2;
const ESCORT = 3;
const DOUBLE_DRAW = 4;
const SLIP_AWAY = 5;
const RIDE_THE_WIND = 6;
const STRAFE = 7;
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

function effectDraws(events: GameEvent[]): Extract<GameEvent, { type: "CARDS_DRAWN" }>[] {
  return all(events, "CARDS_DRAWN").filter((e) => e.reason === "effect");
}

describe("end to end — the two DRAW arms", () => {
  it("'Draw a card.' draws exactly one, and never parks", () => {
    const state = ready(1, 1, 1);
    const before = state.players.p1.hand.length;
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: COLLECT,
    });
    expect(done.players.p1.hand.length).toBe(before + 1);
    expect(effectDraws(events)[0]).toMatchObject({ seat: "p1", reason: "effect" });
    expect(effectDraws(events)[0]?.uids).toHaveLength(1);
    // A draw is not a decision — the attack resolves straight through, never to
    // an effect:choose.
    expect(done.phase.kind).not.toBe("effect:choose");
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
        p1: {
          ...side,
          hand: [...side.hand, ...side.deck.slice(0, owed)],
          deck: side.deck.slice(owed),
        },
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

  it("AN EMPTY BENCH IS A NO-OP, AND IT IS THE SEAM'S NEWLY REACHABLE EARLY RETURN", () => {
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

describe("D422 — the family's LAST printing, and the blocker that had rotted under its own pin", () => {
  it("reads ALL THREE printed sentences of the family, and the third is the first WRAPPED", () => {
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

  it("the prompt shape this arm RIDES, read off a live park — the dead guard, replaced", () => {
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
    expect(prompt.candidates.length).toBeGreaterThan(1);
    expect(prompt.upTo).toBeUndefined();
    const withCeiling = { kind: "choosePokemon", candidates: [], upTo: 1, note: "x" } as const;
    expect(withCeiling.upTo).toBeDefined();
    expect(Object.keys(withCeiling).sort()).not.toEqual(["candidates", "kind", "note"]);
  });

  it("▶️ D422 — it STOPPED being loud, and the board says so: the SAME index now PARKS", () => {
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
