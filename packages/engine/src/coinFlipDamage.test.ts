import { describe, expect, it } from "vitest";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  deriveAttackRequirement,
  programFor,
} from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import { flipCoin } from "./rng";
import {
  COIN_FLIP_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.76.0 → 0.77.0 — the PRINTED COIN FLIP (D126). "Flip a coin. If heads, this
// attack does N more damage." (20 printings) and "Flip a coin. If tails, this
// attack does nothing." (11 printings) — Litwick sv03-036 "Firebreathing"
// ({R}, 10+) and Tarountula sv01-018 "Surprise Attack" ({G}, 30).
//
//   31 PRINTINGS ON TWO REGEXES AND ZERO NEW VOCABULARY.
//
// Ten slices of this family bought a printed CLAUSE table and, usually, a
// `BoardCondition` member to answer one of its rows. This slice buys NEITHER, and
// the reason is worth stating precisely: THE CLAUSE IS A FIXED LITERAL, and A COIN
// FACE IS NOT A BOARD FACT. "heads" is drawn from `rngState` at resolution; no
// state answers it, nothing on the board can be asked about it, and there is
// consequently nothing to look up. So there is no `Map`, no `BoardCondition`
// member, no `DamageCountSource` member, and no state field — two anchored
// regexes and a two-member union is the whole vocabulary cost.
//
// `scaledAttackDamage` IS DELIBERATELY UNTOUCHED. It stays a pure function of the
// board, and the flip's contribution rides into the §8.5 pipeline as a local
// `coinBonus`. A `DamageCountSource.coinFlip` member would have made that fold
// impure — every consumer of the vocabulary suddenly needing an rng — to model a
// thing the vocabulary is not for. The zero-vocabulary block below is what pins
// this mechanically, in the only way a test can: BOTH sentences are refused by
// `deriveAttackRequirement`, so neither reached a clause table at all.
//
// HEADS AND TAILS ARE ONE SLICE, and `AttackCoinFlip` is a 2-MEMBER UNION rather
// than two independent readers. They are ONE MECHANISM — a single flip taken
// BEFORE the §8.5 pipeline — read from two ends: heads adds the printed N, tails
// cancels. The union makes their mutual exclusivity STRUCTURAL, which is the fact
// that lets `attack.ts` match one value and never flip twice. Built as two slices,
// the flip's site, its event and its fold would each have been designed twice.
//
// WHERE THE FLIP SITS is the other half of the design, and it is D125's rule
// applied a second time: a derived shape is classified by WHERE IN RESOLUTION IT
// LANDS. An effect PROGRAM runs at attack.ts's tail, strictly after §8.5 — it can
// neither raise a number already computed nor retract damage already dealt — so a
// flip that GATES damage must run in FRONT of the pipeline, at the same site as
// §8 step 3's confusion flip. Two consequences the cases below assert directly:
//
//   (1) THE BONUS FOLDS PRE-WEAKNESS. Litwick's heads 10 lands alongside the base
//       10 BEFORE Weakness, so a ×2 Fire body takes (10 + 10) × 2 = 40, not
//       10 × 2 + 10 = 30. Two numbers that cannot be confused for one another.
//
//   (2) THE TURN STILL ENDS on a tails cancel. An attack that did nothing is an
//       attack that was USED — the same rule the confusion and requirement paths
//       already carried, and the reason `finishAttack` is reused here too.
//
// THE MODIFIER TRAP IS THE ONE THING THIS SUITE EXISTS TO CATCH. Every heads
// printing carries a printed "10+"-style damage marker, which `parseAttackDamage`
// splits into base 10 + modifier "+" — and that modifier IS the flip's N. The coin
// reader therefore has to be a term in `modifierSimulated` as well as in
// `effectSimulated`; miss the first and all 20 printings resolve PERFECTLY while
// still emitting a loud ATTACK_EFFECT_SKIPPED row. The no-skipped-row block below
// is the assertion that fails when that term is dropped.
//
// AND THE REST OF THE COIN FAMILY STAYS LOUD. The pool's flip printings run well
// past these two sentences, and this suite pins WHICH PROPERTY refuses each of the
// near ones — the `$` anchor for the second-consequent and extra-branch prints,
// the `^Flip a coin\.` literal for the multi-flip prints, and the CONSEQUENT for
// the 16 "…is now Paralyzed." printings, which are the slice's only real
// double-read risk because `deriveAttackEffect` already claims them.
//
// 0.79.0 → 0.80.0 (D129) TOUCHED THIS FILE IN EXACTLY ONE PLACE, and it is a
// CARDINALITY change: `bonusOnHeads` gained a `flips: AttackFlipCount`, so these 20
// printings now read `{ kind: "printed", count: 1 }` where they used to carry no
// such field — which is what they always were implicitly. Nothing else about the
// slice moved: same two regexes, same union members, same site, same fold, same
// KEPT printed base. The reason for the widening is that "Flip a coin until you get
// tails. This attack does 30 more damage for each heads." (Bouffalant sv03-174) is
// THIS member's consequent over an unbounded count — only the SOURCE of the number
// differs, which is D128's rule applied to the other member. The `ONE_FLIP` constant
// below names the value once so the diff stayed mechanical.
//
// One witness in this file moved with it: the unbounded printing that stood as a
// REFUSAL under "a DIFFERENT NUMBER OF FLIPS" is the sentence D129 mapped, so that
// case is now held by Magikarp sv02-042 ("Flip 2 coins. If both of them are heads,
// this attack does 20 more damage.") — a sharper witness for the same claim, since
// its consequent is FIREBREATHING's word for word. A witness quietly deleted when
// its subject gets built is a witness that was never load-bearing.

/** Tarountula sv01-018 "Surprise Attack", verbatim, and pinned char-for-char
    against FIXTURE_POOL below. ELEVEN printings share it. Tarountula carries no
    authored program (see the ZERO-rows block), so the sentence IS the wiring: a
    drifted character does not throw, it drops the card back onto the loud
    ATTACK_EFFECT_SKIPPED path and lets a flat 30 land unconditionally. */
const SURPRISE_ATTACK = "Flip a coin. If tails, this attack does nothing.";

/** Litwick sv03-036 "Firebreathing", verbatim. The smallest of the pool's seven
    printed N values, and the sentence whose "+" marker the reader consumes. */
const FIREBREATHING = "Flip a coin. If heads, this attack does 10 more damage.";

/** Every printed N the "…does N more damage." sentence carries across the pool's
    20 printings. Seven values, and the deriver has to read each one off the SAME
    regex — there is no table, so a value it refused would be a value it could not
    represent at all. */
const PRINTED_BONUSES = [10, 20, 30, 50, 60, 80, 90] as const;

/** U+00A0, spelled as an ESCAPE rather than typed. A non-breaking space is
    byte-different from an ASCII one and INVISIBLE in a diff, so the near-miss
    cases below name it instead of carrying it — the mistake this guards against
    is exactly the mistake a literal would make in this file. */
const NBSP = "\u00a0";

/** The flip COUNT every printing in THIS slice carries, as the value D129 made it.
    `bonusOnHeads` was `{ kind, per }` when D126 built it — one flip, implicitly —
    and D129 WIDENED it to carry an `AttackFlipCount`, because "Flip a coin until
    you get tails. This attack does 30 more damage for each heads." (Bouffalant
    sv03-174) is the SAME consequent over an unbounded count. Only the SOURCE of the
    number moved: these 20 printings still take exactly ONE flip, still KEEP their
    printed base, and still fold `heads × per` at the same pre-W/R step. `printed 1`
    is what they always were implicitly, now written down. Naming the value once,
    here, is what keeps the widening a CARDINALITY change rather than a rewrite of
    this file — every expectation below reads `flips: ONE_FLIP` and the slice's own
    claims are untouched. */
const ONE_FLIP = { kind: "printed", count: 1 } as const;

/** UTF-8 byte length, counted off code points. Deliberately NOT
    `new TextEncoder().encode(s).length`: the engine package compiles with
    `lib: ["ES2022"]` and `types: []` (packages/engine/tsconfig.json), so no
    platform global is in scope and `tsc -b` — which CI runs — would reject it.
    Copied rather than shared with attackRequirement.test.ts, where it is local for
    the same reason: testFixtures.ts is a fixture module, not a string library. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

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

/** Both attackers carry exactly ONE attack, so the index cannot be got wrong —
    named all the same, because a reprint that added a second attack would
    otherwise silently move it. */
const FLIP_INDEX = 0;

/** How far the seed sweeps run. The established number (coverage.test.ts): 24
    seeds is far past the point where a fair coin has failed to show both faces,
    and every case that uses it asserts it SAW both rather than trusting the loop. */
const SEEDS = 24;

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so the attack step is legal (§4).

    Both Active spots are pinned to the neutral 200 HP fix-bigbody, which has NO
    Weakness at all: every case that is not about Weakness therefore measures the
    printed number and nothing else, and no defender here can be Knocked Out by a
    10/20/30. The pin also makes the board a known shape on EVERY seed, which is
    what the sweeps below depend on. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: COIN_FLIP_DECK, p2: COIN_FLIP_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** Litwick in the seat's Active Spot with Firebreathing's single {R} paid.
    SURGERY: both attackers are Basic and COULD be dealt, but a swept seed cannot
    be relied on to deal any particular one, so every case fields its attacker. */
function litwickActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv03-036"), seat, "fix-fire-energy", 1);
}

/** Tarountula in the seat's Active Spot with Surprise Attack's single {G} paid. */
function tarountulaActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv01-018"), seat, "fix-grass-energy", 1);
}

/** The 60 HP ×2 FIRE body in the seat's Active Spot — the pre-Weakness fold
    defender. Litwick is Fire, so the multiplier is live; Tarountula is Grass, so
    it is inert and no cancel case ever meets it. 40 < 60, so heads does not KO. */
function weakDefender(state: GameState, seat: Seat): GameState {
  return setActiveFromDeck(state, seat, "fix-weak");
}

/** The seat's Active damage — read straight off the board so the "nothing
    happened" cases are a real comparison and not an event-log inference. */
function activeDamage(state: GameState, seat: Seat): number | undefined {
  return state.players[seat].active?.damage;
}

describe("the printed sentences — the fixture-text-verbatim guards", () => {
  it("matches FIXTURE_POOL char-for-char for Tarountula sv01-018", () => {
    const attack = FIXTURE_POOL["sv01-018"]?.attacks?.[FLIP_INDEX];
    expect(attack?.effect).toBe(SURPRISE_ATTACK);
    expect(attack?.name).toBe("Surprise Attack");
    // A FLAT 30, a NUMBER — the cancel consequent adds nothing, so there is no
    // printed damage marker at all and `modifierSimulated` is never in play on
    // this half of the slice. The exact contrast with Litwick's string "10+".
    expect(attack?.damage).toBe(30);
    expect(typeof attack?.damage).toBe("number");
    expect(attack?.cost).toEqual(["Grass"]);
    expect(FIXTURE_POOL["sv01-018"]?.attacks).toHaveLength(1);
    expect(FIXTURE_POOL["sv01-018"]?.abilities).toBeNull();
  });

  it("matches FIXTURE_POOL char-for-char for Litwick sv03-036", () => {
    const attack = FIXTURE_POOL["sv03-036"]?.attacks?.[FLIP_INDEX];
    expect(attack?.effect).toBe(FIREBREATHING);
    expect(attack?.name).toBe("Firebreathing");
    // "10+" — a STRING, and the load-bearing field of the whole slice. The "+" is
    // the printed marker the coin reader consumes; typed as a number it would
    // parse to a bare 10 with no modifier and the missed-`modifierSimulated`
    // regression would become invisible.
    expect(attack?.damage).toBe("10+");
    expect(typeof attack?.damage).toBe("string");
    expect(attack?.cost).toEqual(["Fire"]);
    expect(FIXTURE_POOL["sv03-036"]?.attacks).toHaveLength(1);
    expect(FIXTURE_POOL["sv03-036"]?.abilities).toBeNull();
  });

  it("keeps the card facts the two faces are measured against", () => {
    expect(FIXTURE_POOL["sv01-018"]?.name).toBe("Tarountula");
    expect(FIXTURE_POOL["sv01-018"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv01-018"]?.types).toEqual(["Grass"]);
    expect(FIXTURE_POOL["sv01-018"]?.hp).toBe(60);
    expect(FIXTURE_POOL["sv01-018"]?.retreat).toBe(2);
    expect(FIXTURE_POOL["sv01-018"]?.weaknesses).toEqual([{ type: "Fire", value: "×2" }]);
    expect(FIXTURE_POOL["sv01-018"]?.resistances).toBeNull();

    expect(FIXTURE_POOL["sv03-036"]?.name).toBe("Litwick");
    expect(FIXTURE_POOL["sv03-036"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv03-036"]?.types).toEqual(["Fire"]);
    expect(FIXTURE_POOL["sv03-036"]?.hp).toBe(60);
    expect(FIXTURE_POOL["sv03-036"]?.retreat).toBe(1);
    expect(FIXTURE_POOL["sv03-036"]?.weaknesses).toEqual([{ type: "Water", value: "×2" }]);
    expect(FIXTURE_POOL["sv03-036"]?.resistances).toBeNull();

    // The Weakness defender is FIRE-weak, which is Litwick's type and NOT
    // Tarountula's — the whole reason one deck serves both ends of the slice.
    expect(FIXTURE_POOL["fix-weak"]?.weaknesses).toEqual([{ type: "Fire", value: "×2" }]);
    expect(FIXTURE_POOL["fix-weak"]?.hp).toBe(60);
    // …and the neutral defender has none at all, so the non-Weakness cases read
    // the printed number unmodified.
    expect(FIXTURE_POOL["fix-bigbody"]?.weaknesses).toBeNull();
    expect(FIXTURE_POOL["fix-bigbody"]?.resistances).toBeNull();
  });

  it("pins the BYTES — and that both sentences are PURE ASCII", () => {
    // THE FAMILY'S FIRST PRINTED TEXT WITH NO é IN IT. Every predecessor sentence
    // says "Pokémon" at least once and carries the invariant
    // `bytes = codePoints + count("Pokémon")`; these two name no Pokémon at all,
    // so bytes and code points are EQUAL. The census confirms it: no curly
    // apostrophe, no non-breaking space, no accented character anywhere in either.
    expect(SURPRISE_ATTACK.length).toBe(48);
    expect(utf8Bytes(SURPRISE_ATTACK)).toBe(48);
    expect(FIREBREATHING.length).toBe(55);
    expect(utf8Bytes(FIREBREATHING)).toBe(55);
    for (const sentence of [SURPRISE_ATTACK, FIREBREATHING]) {
      // PURE ASCII, asserted over the characters rather than inferred from the
      // equal totals above (which a pair of compensating drifts could fake).
      expect([...sentence].filter((ch) => (ch.codePointAt(0) ?? 0) >= 128)).toEqual([]);
      expect(sentence).not.toContain("é");
      expect(sentence).not.toContain("’"); // U+2019 — the pool holds zero of them
      expect(sentence).not.toContain(NBSP); // the invisible drift
      // The shared leading sentence, char-for-char: the literal the multi-flip
      // printings are refused on.
      expect(sentence.startsWith("Flip a coin. ")).toBe(true);
      expect(sentence.endsWith(".")).toBe(true);
      // No trailing or leading whitespace on the printed row.
      expect(sentence).toBe(sentence.trim());
    }
    expect(SURPRISE_ATTACK).toContain("If tails,");
    expect(FIREBREATHING).toContain("If heads,");
  });
});

describe("deriveAttackCoinFlip — two sentences, ZERO new vocabulary", () => {
  it("reads all SEVEN printed N values off the one regex", () => {
    // No table exists, so this is not a coverage check on a Map — it is the claim
    // that the shape is PARAMETERISED and every printed value is inside it. A
    // reader built on literal sentences would need seven rows for this.
    for (const per of PRINTED_BONUSES) {
      const text = `Flip a coin. If heads, this attack does ${per} more damage.`;
      expect(deriveAttackCoinFlip(text)).toEqual({ kind: "bonusOnHeads", flips: ONE_FLIP, per });
    }
    // …and Litwick's own printing is the smallest of them, derived off the string
    // rather than off a rebuilt template.
    expect(deriveAttackCoinFlip(FIREBREATHING)).toEqual({
      kind: "bonusOnHeads",
      flips: ONE_FLIP,
      per: 10,
    });
  });

  it("reads the cancel sentence as a BARE TAG", () => {
    const flip = deriveAttackCoinFlip(SURPRISE_ATTACK);
    expect(flip).toEqual({ kind: "cancelOnTails" });
    // No parameter to get wrong: the member is one key wide. "does nothing" has
    // no number in it, and the union member has no field for one.
    expect(Object.keys(flip ?? {})).toEqual(["kind"]);
  });

  it("derives off the card fixtures, not just the constants", () => {
    // The constants above are pinned to FIXTURE_POOL char-for-char, but reading
    // the derivation straight off the fixture is what proves the two never drifted
    // apart in the same edit.
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv01-018"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "cancelOnTails" });
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv03-036"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "bonusOnHeads", flips: ONE_FLIP, per: 10 });
  });

  it("buys ZERO NEW VOCABULARY — neither sentence reaches a clause table", () => {
    // THE HEADLINE OF THE SLICE, stated the only way a test can state it: the
    // clause-table reader REFUSES both sentences, so no `BoardCondition` member
    // was consulted, none was added, and no row was written. `deriveAttackRequirement`
    // is the sharpest witness because Tarountula's sentence ENDS in exactly the
    // string that reader's skeleton claims ("this attack does nothing.") — it is
    // refused at the anchor, by the flip sentence in front, and not by a table.
    expect(deriveAttackRequirement(SURPRISE_ATTACK)).toBeNull();
    expect(deriveAttackRequirement(FIREBREATHING)).toBeNull();
    expect(SURPRISE_ATTACK.endsWith("this attack does nothing.")).toBe(true);
    expect(SURPRISE_ATTACK.startsWith("If ")).toBe(false);
    // The union's own shape says the same thing structurally: NO member of it
    // carries a `cond`, a `count`, or anything else that would have to be answered
    // off the board. A coin face is not a board fact.
    //
    // D129 ADDED A KEY HERE AND THE CLAIM IS UNCHANGED. `bonusOnHeads` now carries
    // `flips` (the widening this file's ONE_FLIP names), and `{ kind: "printed",
    // count: 1 }` is a LITERAL — it is answered by the sentence, not by the state,
    // exactly like the `per` beside it. What the assertion is about is the ABSENCE
    // of `cond` and `count`: those are the two field names the clause vocabulary and
    // `DamageCountSource` use, and neither has ever appeared on this union. The key
    // list is spelled out per member rather than loosened to "at least these", so a
    // future field that DID have to be answered off the board would fail here.
    for (const text of [SURPRISE_ATTACK, FIREBREATHING]) {
      const flip = deriveAttackCoinFlip(text);
      if (flip === null) throw new Error("unreachable");
      expect(Object.keys(flip).sort()).toEqual(
        flip.kind === "bonusOnHeads" ? ["flips", "kind", "per"] : ["kind"],
      );
      expect(flip).not.toHaveProperty("cond");
      expect(flip).not.toHaveProperty("count");
      // …and the added key is the PRINTED one, not a board read: no `energy` filter
      // to resolve and no state to ask.
      expect(flip).not.toHaveProperty("flips.energy");
    }
  });

  it("is EXCLUSIVE by construction — no string is both members", () => {
    // The union is what makes "at most one flip per attack" structural rather than
    // a rule attack.ts has to keep. The two anchors cannot both match: one
    // requires "If heads, this attack does <digits> more damage.", the other
    // "If tails, this attack does nothing.", and neither is a substring shape.
    expect(deriveAttackCoinFlip(SURPRISE_ATTACK)?.kind).toBe("cancelOnTails");
    expect(deriveAttackCoinFlip(FIREBREATHING)?.kind).toBe("bonusOnHeads");
    // The crossed sentences — real English, no printing — are refused outright.
    expect(deriveAttackCoinFlip("Flip a coin. If heads, this attack does nothing.")).toBeNull();
    expect(
      deriveAttackCoinFlip("Flip a coin. If tails, this attack does 10 more damage."),
    ).toBeNull();
  });
});

describe("deriver disjointness — a fourth reader that crosses none of the other three", () => {
  it("keeps BOTH flip sentences off the effect/bonus/multiplier/requirement readers", () => {
    // The leading "Flip a coin." sentence denies all three leading-`If` families
    // their `^` anchor, and the consequent keeps them off `deriveAttackEffect`.
    // Each refuses at its own OUTER anchor, before any clause table is consulted.
    for (const sentence of [SURPRISE_ATTACK, FIREBREATHING]) {
      expect(deriveAttackEffect(sentence)).toBeNull();
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
      expect(deriveAttackRequirement(sentence)).toBeNull();
    }
  });

  it("keeps a REAL sentence of each of the four families off deriveAttackCoinFlip", () => {
    // The mirror, one live representative per family, so the nulls above are
    // refusals in both directions and not one reader being dead.
    const representatives = [
      // deriveAttackEffect — a plain status op (Tarountula's own family neighbour).
      "Your opponent's Active Pokémon is now Paralyzed.",
      // deriveAttackDamageBonus — D122's Tool clause (Greedent sv01-152).
      "If this Pokémon has a Pokémon Tool attached, this attack does 80 more damage.",
      // deriveAttackDamageMultiplier — the Prize-count "×" shape.
      "This attack does 50 damage for each Prize card your opponent has taken.",
      // deriveAttackRequirement — D125's Palafin sentence.
      "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.",
    ];
    for (const sentence of representatives) {
      expect(deriveAttackCoinFlip(sentence)).toBeNull();
    }
    // …and each really is live for its own reader, so the nulls are refusals and
    // not four dead strings.
    expect(deriveAttackEffect(representatives[0] ?? "")).not.toBeNull();
    expect(deriveAttackDamageBonus(representatives[1] ?? "")).not.toBeNull();
    expect(deriveAttackDamageMultiplier(representatives[2] ?? "")).not.toBeNull();
    expect(deriveAttackRequirement(representatives[3] ?? "")).not.toBeNull();
  });
});

describe("the rest of the coin family stays LOUD", () => {
  it("refuses a SECOND CONSEQUENT riding the same flip — at the `$` anchor", () => {
    // Real printings, each one the mapped sentence with something appended. The
    // trailing period is INSIDE the anchor, so an extra clause or an extra
    // sentence denies the match outright — which is exactly right: the engine
    // would resolve the damage and silently drop the heal / the Confusion / the
    // can't-attack rider.
    for (const text of [
      // Floette sv01-092 — a heal riding the same heads branch.
      "Flip a coin. If heads, this attack does 30 more damage, and heal 30 damage from this Pokémon.",
      // Conkeldurr V swsh10.5-040 — a status riding the same heads branch.
      "Flip a coin. If heads, this attack does 90 more damage, and your opponent's Active Pokémon is now Confused.",
      // Dragonite ex sv03-159 — a whole extra TAILS branch. The mapped shape's
      // first sentence pair is present verbatim; the third sentence is what the
      // `$` refuses, and it is a self-penalty the engine has no way to carry.
      "Flip a coin. If heads, this attack does 140 more damage. If tails, during your next turn, this Pokémon can't attack.",
      // Squawkabilly sv01-162 — the CANCEL sentence verbatim, plus a heads branch
      // that grants damage prevention. Refused for the same reason, from the
      // other member: the first sentence pair IS Tarountula's, char-for-char.
      "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
    ]) {
      expect(deriveAttackCoinFlip(text)).toBeNull();
      expect(text.startsWith("Flip a coin. ")).toBe(true); // reached the anchor
    }
    // The two prefixes really are the mapped sentences, so the refusals above are
    // the `$` doing the work and not the `^` or the middle of the pattern.
    expect(
      "Flip a coin. If tails, this attack does nothing. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.".startsWith(
        SURPRISE_ATTACK,
      ),
    ).toBe(true);
    expect(
      "Flip a coin. If heads, this attack does 140 more damage. If tails, during your next turn, this Pokémon can't attack.".startsWith(
        "Flip a coin. If heads, this attack does 140 more damage.",
      ),
    ).toBe(true);
  });

  it("refuses a DIFFERENT NUMBER OF FLIPS — at the literal `^Flip a coin\\.`", () => {
    // Real printings whose mechanism is a MULTI-flip tally. Each is refused on the
    // opening sentence itself, which is the guard that matters: their consequents
    // are close cousins of the mapped one — one of them is this slice's consequent
    // WORD FOR WORD — and a reader anchored only on the consequent would claim all
    // three and flip exactly once for a card that prints two or three.
    //
    // THE WITNESS MOVED, IT WAS NOT DELETED. Bouffalant sv03-174 ("Flip a coin until
    // you get tails. …30 more damage for each heads.") stood here as the unbounded
    // tally until D129 mapped it, so its slot is now held by Magikarp sv02-042, which
    // is a SHARPER witness for this case's actual claim: its consequent is
    // FIREBREATHING's consequent verbatim ("this attack does 20 more damage."), only
    // the number differs, and the sentence is still unmapped. If the `^Flip a coin\.`
    // literal ever loosened, Magikarp is the first printing that would silently
    // resolve as a ONE-flip bonus — paying out on a single head where the card
    // demands two.
    for (const text of [
      // Magikarp sv02-042 (+ its sv02-203 reprint) — TWO coins gating D126's own
      // consequent, and the closest live near-miss this slice has.
      "Flip 2 coins. If both of them are heads, this attack does 20 more damage.",
      // Bisharp sv03-149 — THREE coins with a stepped payout table.
      "Flip 3 coins. If 1 of them is heads, this attack does 20 more damage. If 2 of them are heads, this attack does 60 more damage. If all of them are heads, this attack does 120 more damage.",
    ]) {
      expect(deriveAttackCoinFlip(text)).toBeNull();
      expect(text.startsWith("Flip a coin. ")).toBe(false); // the opening sentence differs
    }
    // 🆕🆕 D413 — MELMETAL swsh10.5-046 LEFT THAT LIST, AND IT IS RE-POINTED RATHER
    // THAN DELETED, BECAUSE THE CLAIM IT WAS MAKING IS STILL THE ONE THAT MATTERS.
    // Its sentence used to be refused by everything; D413 maps it. What this rung
    // asserted was never "nothing reads it" — it was **`^Flip a coin\.` does not
    // swallow a TWO-coin sentence**, and asserting that POSITIVELY is strictly
    // stronger than asserting a null: a null goes green the day the whole family
    // stops resolving, and `count: 2` does not. If the single-flip literal were ever
    // loosened, this reads back `count: 1` and pays out on one head where the card
    // demands two — the exact defect the paragraph above describes.
    expect(
      deriveAttackCoinFlip("Flip 2 coins. This attack does 90 more damage for each heads."),
    ).toEqual({ kind: "bonusOnHeads", flips: { kind: "printed", count: 2 }, per: 90 });
    // Magikarp's tail really IS this slice's consequent, so the null above is the
    // OPENING doing the work and not the consequent.
    expect(
      "Flip 2 coins. If both of them are heads, this attack does 20 more damage.".endsWith(
        "this attack does 20 more damage.",
      ),
    ).toBe(true);
    expect(FIREBREATHING.endsWith("this attack does 10 more damage.")).toBe(true);
    // …and the sentence that used to sit here is now READ, by D129's unbounded arm,
    // to the same member this slice owns over a different flip count. Stated here
    // rather than dropped: a witness quietly deleted when its subject gets built is a
    // witness that was never load-bearing. (Its own suite is untilTailsFlip.test.ts.)
    expect(
      deriveAttackCoinFlip(
        "Flip a coin until you get tails. This attack does 30 more damage for each heads.",
      ),
    ).toEqual({ kind: "bonusOnHeads", flips: { kind: "untilTails" }, per: 30 });
  });

  it("refuses the PARALYSIS flip — the slice's ONLY real double-read risk", () => {
    // 16 printings, and the one case where a loose reader would not merely be
    // quiet but WRONG TWICE OVER. `deriveAttackEffect` ALREADY claims this
    // sentence as a `coinFlipGate` program, which attack.ts runs at its tail with
    // a flip of its own. If `deriveAttackCoinFlip` also claimed it, the attack
    // would consume TWO rngState steps and emit TWO ATTACK_EFFECT_COIN_FLIP
    // events for one printed "Flip a coin." — the faces could even disagree.
    //
    // What refuses it is the CONSEQUENT: "your opponent's Active Pokémon is now
    // Paralyzed" is neither "this attack does N more damage" nor "this attack
    // does nothing", so neither anchor can reach it.
    const paralysisFlip = "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.";
    expect(deriveAttackCoinFlip(paralysisFlip)).toBeNull();
    // ASSERTED EXPLICITLY, not implied: the OTHER reader really does own it, so
    // the null above is a hand-off and not a gap.
    expect(deriveAttackEffect(paralysisFlip)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
      },
    ]);
    // Its prefix is Tarountula's leading sentence verbatim — so this is the
    // consequent refusing it, not the opening.
    expect(paralysisFlip.startsWith("Flip a coin. If heads, ")).toBe(true);
  });
});

describe("constructed near-misses stay LOUD", () => {
  it("refuses the anchor and casing rewrites", () => {
    for (const text of [
      // Lowercase leading "flip" — the skeleton has no /i.
      "flip a coin. If heads, this attack does 10 more damage.",
      "flip a coin. If tails, this attack does nothing.",
      // Lowercase "if" — the same guard one word later.
      "Flip a coin. if heads, this attack does 10 more damage.",
      // No trailing period is not the whole sentence.
      "Flip a coin. If heads, this attack does 10 more damage",
      "Flip a coin. If tails, this attack does nothing",
      // "!" for "." — the same one-character difference from the other side.
      "Flip a coin. If tails, this attack does nothing!",
      // The CONSEQUENT ALONE, with no flip in front — the degenerate string a
      // substring matcher would happily claim, and the one D125's reader owns.
      "If heads, this attack does 10 more damage.",
      "If tails, this attack does nothing.",
      // Leading text pins `^`.
      "Before doing damage, flip a coin. If heads, this attack does 10 more damage.",
      // A missing space after the flip sentence — invisible in a diff.
      "Flip a coin.If heads, this attack does 10 more damage.",
      // "coins" for "coin" — one letter, and a different mechanism.
      "Flip a coins. If heads, this attack does 10 more damage.",
    ]) {
      expect(deriveAttackCoinFlip(text)).toBeNull();
    }
  });

  it("refuses a printed ZERO — the `per >= 1` guard every arm carries", () => {
    // Nothing in the pool prints it, and the guard is what keeps that a FACT about
    // the pool rather than an assumption: a 0 bonus would spend a flip (and an
    // rngState step, and an event) to add nothing at all.
    expect(deriveAttackCoinFlip("Flip a coin. If heads, this attack does 0 more damage.")).toBeNull();
    // …while the smallest REAL value one digit away is read fine.
    expect(deriveAttackCoinFlip("Flip a coin. If heads, this attack does 1 more damage.")).toEqual({
      kind: "bonusOnHeads",
      flips: ONE_FLIP,
      per: 1,
    });
  });

  it("refuses whitespace and apostrophe drift", () => {
    // A TRAILING SPACE survives `trim()` by design (the deriver trims), so this
    // pair states which drift is tolerated and which is not.
    expect(deriveAttackCoinFlip(`${FIREBREATHING} `)).toEqual({
      kind: "bonusOnHeads",
      flips: ONE_FLIP,
      per: 10,
    });
    expect(deriveAttackCoinFlip(` ${SURPRISE_ATTACK}`)).toEqual({ kind: "cancelOnTails" });
    // An INTERIOR double space is not trimmable and is refused.
    expect(
      deriveAttackCoinFlip("Flip a coin.  If heads, this attack does 10 more damage."),
    ).toBeNull();
    // A NON-BREAKING SPACE where an ASCII one is printed — the invisible drift.
    expect(
      deriveAttackCoinFlip(`Flip a coin.${NBSP}If heads, this attack does 10 more damage.`),
    ).toBeNull();
    // A CURLY APOSTROPHE variant. Neither mapped sentence contains an apostrophe
    // at all, so this is built on the nearest family sentence that does — and the
    // point stands: the pool holds ZERO U+2019, so a hand-retyped near-miss is the
    // only way one enters the codebase.
    expect(
      deriveAttackCoinFlip(
        "Flip a coin. If heads, your opponent’s Active Pokémon is now Paralyzed.",
      ),
    ).toBeNull();
  });
});

describe("ZERO registry rows — the cards flip straight off their printed text", () => {
  it("has no program of any kind for either card", () => {
    for (const id of ["sv01-018", "sv03-036"]) {
      expect(programFor(id)).toBeUndefined();
      expect(programFor(id)?.attack).toBeUndefined();
      expect(programFor(id)?.passive).toBeUndefined();
    }
  });
});

describe("Litwick — the heads BONUS through a REAL attack, both faces", () => {
  it("deals 20 on heads and 10 on tails, and flips exactly ONCE either way", () => {
    // THE CENTRAL CASE. Both faces of one printed flip, reached by sweeping seeds
    // rather than by injecting an rngState — so the flip is a REAL flip taken by
    // the engine at the real site, and the assertion covers what the engine
    // REPORTED as well as what it did.
    let sawHeads = false;
    let sawTails = false;
    for (let seed = 0; seed < SEEDS && !(sawHeads && sawTails); seed++) {
      const state = litwickActive(board(seed), "p1");
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      // EXACTLY ONE flip per attack — the union's mutual exclusivity, observed.
      const flips = all(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips).toHaveLength(1);
      const flip = flips[0];
      if (flip === undefined) throw new Error("Firebreathing did not flip");
      expect(flip.seat).toBe("p1"); // the ATTACKER flips, not the defender
      const damage = find(events, "DAMAGE_DEALT");
      if (flip.result === "heads") {
        sawHeads = true;
        // base 10 + the printed 10, into a body with no Weakness at all.
        expect(damage?.dealt).toBe(20);
        expect(damage?.base).toBe(10);
        // The bonus is REPORTED through `scaled`, the same field the count-scaling
        // clauses use — one pre-W/R "the attack's own extra" channel, not two.
        expect(damage?.scaled).toBe(10);
        expect(activeDamage(done, "p2")).toBe(20);
      } else {
        sawTails = true;
        // Tails on THIS member adds nothing and cancels nothing — the printed base
        // resolves normally, which is the asymmetry with Tarountula.
        expect(damage?.dealt).toBe(10);
        expect(damage?.base).toBe(10);
        // ABSENT, not 0: the field is only present when the extra actually landed.
        expect(damage?.scaled).toBeUndefined();
        expect(activeDamage(done, "p2")).toBe(10);
        // No cancel on this member, ever.
        expect(types(events)).not.toContain("ATTACK_FAILED");
      }
      // The flip is announced BEFORE the damage it modifies, in printed order.
      expect(types(events).indexOf("ATTACK_EFFECT_COIN_FLIP")).toBeLessThan(
        types(events).indexOf("DAMAGE_DEALT"),
      );
      expect(types(events)).toContain("TURN_ENDED");
    }
    expect(sawHeads && sawTails).toBe(true);
  });
});

describe("Tarountula — the tails CANCEL through a REAL attack, both faces", () => {
  it("deals 30 on heads; on tails does NOTHING and the turn still ends", () => {
    let sawHeads = false;
    let sawTails = false;
    for (let seed = 0; seed < SEEDS && !(sawHeads && sawTails); seed++) {
      const state = tarountulaActive(board(seed), "p1");
      const uid = activeUid(state, "p1");
      const before = activeDamage(state, "p2");
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const flips = all(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips).toHaveLength(1);
      const flip = flips[0];
      if (flip === undefined) throw new Error("Surprise Attack did not flip");
      if (flip.result === "heads") {
        sawHeads = true;
        // Heads on THIS member is the plain printed resolution — no bonus.
        expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
        expect(find(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
        expect(activeDamage(done, "p2")).toBe(30);
        expect(types(events)).not.toContain("ATTACK_FAILED");
      } else {
        sawTails = true;
        // NOTHING is exactly what happened, stated as a list of absences.
        expect(find(events, "ATTACK_FAILED")).toEqual({
          type: "ATTACK_FAILED",
          seat: "p1",
          uid,
          reason: "coinFlip",
        });
        expect(types(events)).not.toContain("DAMAGE_DEALT");
        expect(types(events)).not.toContain("COUNTERS_PLACED");
        expect(types(events)).not.toContain("KNOCKED_OUT");
        // …and the defender's damage is byte-identical to before, not merely small.
        expect(activeDamage(done, "p2")).toBe(before);
        expect(activeDamage(done, "p2")).toBe(0);
        // The flip is announced BEFORE the failure it caused.
        expect(types(events).indexOf("ATTACK_EFFECT_COIN_FLIP")).toBeLessThan(
          types(events).indexOf("ATTACK_FAILED"),
        );
        // THE TURN STILL ENDS. An attack that did nothing is an attack that was
        // USED — the same claim attackRequirement.test.ts makes for D125's gate,
        // and asserted the same way: the TURN_ENDED event AND the phase it left.
        expect(types(events)).toContain("TURN_ENDED");
        expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
      }
    }
    expect(sawHeads && sawTails).toBe(true);
  });
});

describe("the fold order — the heads bonus lands BEFORE Weakness", () => {
  it("deals (10 + 10) × 2 = 40 into a Fire-weak body, not 10 × 2 + 10 = 30", () => {
    // THE ARITHMETIC THAT PINS THE FOLD SITE. `coinBonus` is the attack's OWN
    // printed extra, so it joins `scaled` at the pre-W/R step; folded after
    // Weakness it would read 30, and folded as a post-damage effect op it could
    // not exist at all. 40 and 30 cannot be confused for one another, and both sit
    // under fix-weak's 60 HP so neither outcome is a Knock Out.
    let sawHeads = false;
    let sawTails = false;
    for (let seed = 0; seed < SEEDS && !(sawHeads && sawTails); seed++) {
      const opened = weakDefender(board(seed), "p2");
      const state = litwickActive(opened, "p1");
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const damage = find(events, "DAMAGE_DEALT");
      expect(damage?.weakness).toEqual({ op: "multiply", amount: 2 });
      if (find(events, "ATTACK_EFFECT_COIN_FLIP")?.result === "heads") {
        sawHeads = true;
        expect(damage?.dealt).toBe(40);
        expect(damage?.scaled).toBe(10);
        expect(activeDamage(done, "p2")).toBe(40);
        expect(types(events)).not.toContain("KNOCKED_OUT");
      } else {
        sawTails = true;
        // The SAME body with no bonus: 10 × 2 = 20. The pair is what makes the 40
        // above a fold-order claim rather than a number.
        expect(damage?.dealt).toBe(20);
        expect(damage?.scaled).toBeUndefined();
      }
    }
    expect(sawHeads && sawTails).toBe(true);
  });
});

describe("rngState — exactly ONE flip's worth is consumed", () => {
  it("threads the flip back into rngState and consumes nothing more", () => {
    // The flip the engine MUST take, computed by hand off the pre-attack state and
    // compared to the post-attack one (checkup.test.ts's pattern). This is the
    // assertion that catches a double flip: two steps would leave `after.rngState`
    // at `rng2`, not `rng1`.
    for (const field of [litwickActive, tarountulaActive]) {
      const state = field(board(3), "p1");
      const [face, rng1] = flipCoin(state.rngState);
      const { state: after, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      // The face the engine reported IS the face the seed owed.
      expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe(face);
      // …and the state advanced by exactly one step. Nothing else in a plain
      // attack (the §8.5 pipeline, the §8.1 sweep, the §5.3 turn end and its
      // draw) touches the rng, so this is a total account.
      expect(after.rngState).toBe(rng1);
    }
  });

  it("does not double-flip with §8's CONFUSION check — an unconfused attacker flips once", () => {
    // The two flips live at the same site, one gate apart, and the confusion one
    // is the older. An UNCONFUSED attacker must never emit its event and must
    // never consume its step — asserted here rather than assumed, because the
    // D126 block was inserted between the confusion check and the pipeline.
    const state = tarountulaActive(board(5), "p1");
    expect(state.players.p1.active?.conditions.rotation).toBe("none");
    const [, rng1] = flipCoin(state.rngState);
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: FLIP_INDEX,
    });
    expect(types(events)).not.toContain("CONFUSION_CHECK");
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
    expect(after.rngState).toBe(rng1);
  });
});

describe("effectSimulated / modifierSimulated — no loud row on EITHER face", () => {
  it("emits NO ATTACK_EFFECT_SKIPPED for either card, heads or tails", () => {
    // THE COVERAGE WIN, and the case that catches a missed `modifierSimulated`
    // term. Litwick prints "10+", so `parseAttackDamage` hands attack.ts a
    // modifier "+" — and the coin reader is the thing that consumes it. A build
    // that only added the `effectSimulated` term would resolve every number in
    // this file correctly and STILL fail here, on all four boards.
    let sawHeads = false;
    let sawTails = false;
    for (let seed = 0; seed < SEEDS && !(sawHeads && sawTails); seed++) {
      const litwick = mustApply(litwickActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const tarountula = mustApply(tarountulaActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      expect(types(litwick.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(tarountula.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      // Both cards flip off the SAME rngState here (same seed, same board), so one
      // face flag covers both — which is also why the two are stepped through
      // together rather than in separate loops.
      if (find(litwick.events, "ATTACK_EFFECT_COIN_FLIP")?.result === "heads") sawHeads = true;
      else sawTails = true;
    }
    expect(sawHeads && sawTails).toBe(true);
  });
});

describe("ATTACK_FAILED — the THREE reasons stay distinguishable", () => {
  it("renders a DISTINCT log row for coinFlip, requirement and confusion", () => {
    // The enum widening's user-visible half, now three wide. Each reason is
    // followed by something different — "confusion" by its own COUNTERS_PLACED
    // row, "requirement" by nothing at all, "coinFlip" by nothing but PRECEDED by
    // the ATTACK_EFFECT_COIN_FLIP that already named the face — so each line has a
    // different job and none may collapse into another.
    const state = tarountulaActive(board(0), "p1");
    const uid = activeUid(state, "p1");
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:07" };
    const text = (event: GameEvent): string =>
      logFromEvents([event], ctx)
        .flatMap((entry) => (entry.kind === "turn" ? [] : entry.segments.map((s) => s.text)))
        .join("");
    const rows = (["confusion", "requirement", "coinFlip"] as const).map((reason) =>
      text({ type: "ATTACK_FAILED", seat: "p1", uid, reason }),
    );
    expect(new Set(rows).size).toBe(3);
    const [confusionRow, requirementRow, coinRow] = rows;
    expect(confusionRow).toContain("Confused");
    expect(requirementRow).toContain("its condition was not met");
    expect(coinRow).toContain("did nothing");
    expect(coinRow).toContain("coin flip");
    // The coin row does NOT repeat the face — the row in front of it already said
    // it, and the log's copy for that row is shared with the Trainer flips.
    expect(coinRow).not.toContain("tails");
    expect(coinRow).not.toContain("Confused");
  });

  it("pairs the flip row with the failure row on a REAL cancelled attack", () => {
    // The two rows a player actually sees, in order, off a real board — so the
    // hand-built events above are not three strings in a test file.
    let rendered: string[] | null = null;
    for (let seed = 0; seed < SEEDS && rendered === null; seed++) {
      const state = tarountulaActive(board(seed), "p1");
      const { events } = mustApply(state, { type: "attack", seat: "p1", index: FLIP_INDEX });
      if (find(events, "ATTACK_FAILED") === undefined) continue;
      const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:07" };
      rendered = logFromEvents(
        events.filter((e) => e.type === "ATTACK_EFFECT_COIN_FLIP" || e.type === "ATTACK_FAILED"),
        ctx,
      ).flatMap((entry) =>
        entry.kind === "turn" ? [] : [entry.segments.map((s) => s.text).join("")],
      );
    }
    if (rendered === null) throw new Error("no seed in range produced a tails cancel");
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toContain("tails"); // the shared flip row names the face
    expect(rendered[1]).toContain("did nothing"); // and this one names the consequence
  });
});

describe("purity", () => {
  it("resolves both printed flips on a DEEP-FROZEN board", () => {
    // The gate reads and the fold write both go through fresh objects — a frozen
    // state proves nothing was mutated in place, on BOTH members and on the
    // Weakness board (which is the one that also rewrites the defender).
    for (let seed = 0; seed < SEEDS; seed++) {
      const litwick = deepFreeze(litwickActive(weakDefender(board(seed), "p2"), "p1"));
      mustApply(litwick, { type: "attack", seat: "p1", index: FLIP_INDEX });
      const tarountula = deepFreeze(tarountulaActive(board(seed), "p1"));
      mustApply(tarountula, { type: "attack", seat: "p1", index: FLIP_INDEX });
    }
    // …and the DERIVER is a pure function of its string, frozen board or not.
    expect(deriveAttackCoinFlip(FIREBREATHING)).toEqual({
      kind: "bonusOnHeads",
      flips: ONE_FLIP,
      per: 10,
    });
    expect(deriveAttackCoinFlip(SURPRISE_ATTACK)).toEqual({ kind: "cancelOnTails" });
  });
});
