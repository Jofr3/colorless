import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  deriveAttackRequirement,
  parseAttackDamage,
  programFor,
} from "./index";
import type { CoinFace, GameEvent, GameState, Seat } from "./index";
import { flipCoin } from "./rng";
import {
  COIN_BONUS_DECK,
  COIN_FLIP_DECK,
  FIXTURE_POOL,
  MULTI_COIN_FLIP_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

const DOUBLE_HIT = "Flip 2 coins. This attack does 30 damage for each heads.";

/** Meowth sv06.5-048 "Fury Swipes", verbatim. THREE flips — the second N, and the
    reason the loop's bound is provably read from the string. */
const FURY_SWIPES = "Flip 3 coins. This attack does 20 damage for each heads.";

const PRINTED_FLIPS = [2, 3, 4] as const;

/** Every per-heads D the pool prints. Nine values, one regex, no rows. */
const PRINTED_PER = [10, 20, 30, 40, 50, 60, 70, 80, 100] as const;

const NBSP = " ";

const TIMES = "×";

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
    named all the same, because a reprint that added a second attack would otherwise
    silently move it. */
const FLIP_INDEX = 0;

const SEEDS = 24;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: MULTI_COIN_FLIP_DECK, p2: MULTI_COIN_FLIP_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** Tandemaus in the seat's Active Spot with Double Hit's {C}{C} paid.
    SURGERY: both attackers are Basic and COULD be dealt, but a swept seed cannot be
    relied on to deal any particular one, so every case fields its attacker. */
function tandemausActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv01-160"), seat, "fix-energy", 2);
}

/** Meowth in the seat's Active Spot with Fury Swipes' {C}{C} paid. */
function meowthActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv06.5-048"), seat, "fix-energy", 2);
}

function weakDefender(state: GameState, seat: Seat): GameState {
  return setActiveFromDeck(state, seat, "fix-colorless-weak-big");
}

/** The seat's Active damage — read straight off the board so the "nothing
    happened" cases are a real comparison and not an event-log inference. */
function activeDamage(state: GameState, seat: Seat): number | undefined {
  return state.players[seat].active?.damage;
}

function foldFlips(state: number, count: number): [faces: CoinFace[], next: number] {
  const faces: CoinFace[] = [];
  let rng = state;
  for (let i = 0; i < count; i += 1) {
    const [face, next] = flipCoin(rng);
    faces.push(face);
    rng = next;
  }
  return [faces, rng];
}

function headsIn(events: GameEvent[]): number {
  return all(events, "ATTACK_EFFECT_COIN_FLIP").filter((e) => e.result === "heads").length;
}

describe("the printed sentences — the fixture-text-verbatim guards", () => {
  it("matches FIXTURE_POOL char-for-char for Tandemaus sv01-160", () => {
    const attack = FIXTURE_POOL["sv01-160"]?.attacks?.[FLIP_INDEX];
    expect(attack?.effect).toBe(DOUBLE_HIT);
    expect(attack?.name).toBe("Double Hit");
    expect(attack?.damage).toBe(`30${TIMES}`);
    expect(typeof attack?.damage).toBe("string");
    expect(attack?.cost).toEqual(["Colorless", "Colorless"]);
    expect(FIXTURE_POOL["sv01-160"]?.attacks).toHaveLength(1);
    expect(FIXTURE_POOL["sv01-160"]?.abilities).toBeNull();
  });

  it("matches FIXTURE_POOL char-for-char for Meowth sv06.5-048", () => {
    const attack = FIXTURE_POOL["sv06.5-048"]?.attacks?.[FLIP_INDEX];
    expect(attack?.effect).toBe(FURY_SWIPES);
    expect(attack?.name).toBe("Fury Swipes");
    expect(attack?.damage).toBe(`20${TIMES}`);
    expect(typeof attack?.damage).toBe("string");
    expect(attack?.cost).toEqual(["Colorless", "Colorless"]);
    expect(FIXTURE_POOL["sv06.5-048"]?.attacks).toHaveLength(1);
    expect(FIXTURE_POOL["sv06.5-048"]?.abilities).toBeNull();
  });

  it('splits both printed markers into base + "×" through parseAttackDamage', () => {
    expect(parseAttackDamage(FIXTURE_POOL["sv01-160"]?.attacks?.[FLIP_INDEX]?.damage)).toEqual({
      base: 30,
      modifier: TIMES,
    });
    expect(parseAttackDamage(FIXTURE_POOL["sv06.5-048"]?.attacks?.[FLIP_INDEX]?.damage)).toEqual({
      base: 20,
      modifier: TIMES,
    });
    for (const [text, damage] of [
      [DOUBLE_HIT, `30${TIMES}`],
      [FURY_SWIPES, `20${TIMES}`],
    ] as const) {
      const flip = deriveAttackCoinFlip(text);
      if (flip?.kind !== "perHeads") throw new Error("expected a perHeads printing");
      expect(parseAttackDamage(damage).base).toBe(flip.per);
      expect(parseAttackDamage(damage).modifier).toBe(TIMES);
    }
  });

  it("keeps the card facts the counts are measured against", () => {
    expect(FIXTURE_POOL["sv01-160"]?.name).toBe("Tandemaus");
    expect(FIXTURE_POOL["sv01-160"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv01-160"]?.types).toEqual(["Colorless"]);
    expect(FIXTURE_POOL["sv01-160"]?.hp).toBe(40);
    expect(FIXTURE_POOL["sv01-160"]?.retreat).toBe(1);
    expect(FIXTURE_POOL["sv01-160"]?.weaknesses).toEqual([
      { type: "Fighting", value: `${TIMES}2` },
    ]);
    expect(FIXTURE_POOL["sv01-160"]?.resistances).toBeNull();

    expect(FIXTURE_POOL["sv06.5-048"]?.name).toBe("Meowth");
    expect(FIXTURE_POOL["sv06.5-048"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv06.5-048"]?.types).toEqual(["Colorless"]);
    expect(FIXTURE_POOL["sv06.5-048"]?.hp).toBe(70);
    expect(FIXTURE_POOL["sv06.5-048"]?.retreat).toBe(1);
    expect(FIXTURE_POOL["sv06.5-048"]?.weaknesses).toEqual([
      { type: "Fighting", value: `${TIMES}2` },
    ]);
    expect(FIXTURE_POOL["sv06.5-048"]?.resistances).toBeNull();

    expect(FIXTURE_POOL["fix-colorless-weak-big"]?.weaknesses).toEqual([
      { type: "Colorless", value: `${TIMES}2` },
    ]);
    expect(FIXTURE_POOL["fix-colorless-weak-big"]?.hp).toBe(200);
    expect(FIXTURE_POOL["fix-colorless-weak-big"]?.resistances).toBeNull();
    // …and the neutral defender has neither, so the non-Weakness cases read the
    // folded number unmodified. 200 HP is above every total in this file.
    expect(FIXTURE_POOL["fix-bigbody"]?.weaknesses).toBeNull();
    expect(FIXTURE_POOL["fix-bigbody"]?.resistances).toBeNull();
    expect(FIXTURE_POOL["fix-bigbody"]?.hp).toBe(200);
  });

  it("pins the BYTES — and that both sentences are PURE ASCII", () => {
    expect(DOUBLE_HIT.length).toBe(56);
    expect(utf8Bytes(DOUBLE_HIT)).toBe(56);
    expect(FURY_SWIPES.length).toBe(56);
    expect(utf8Bytes(FURY_SWIPES)).toBe(56);
    for (const sentence of [DOUBLE_HIT, FURY_SWIPES]) {
      // PURE ASCII, asserted over the characters rather than inferred from the
      // equal totals above (which a pair of compensating drifts could fake).
      expect([...sentence].filter((ch) => (ch.codePointAt(0) ?? 0) >= 128)).toEqual([]);
      expect(sentence).not.toContain("é");
      expect(sentence).not.toContain("’"); // U+2019 — the pool holds zero of them
      expect(sentence).not.toContain(NBSP);
      expect(sentence).not.toContain(TIMES);
      // The shared trailing sentence, char-for-char: the clause whose one missing
      // word ("more") separates this family from Melmetal's and Bouffalant's.
      expect(sentence.endsWith(" damage for each heads.")).toBe(true);
      expect(sentence).not.toContain("more");
      expect(sentence).toBe(sentence.trim());
    }
    // The counts differ in exactly one character, which is the entire difference
    // between a two-flip card and a three-flip one.
    expect(DOUBLE_HIT.startsWith("Flip 2 coins. ")).toBe(true);
    expect(FURY_SWIPES.startsWith("Flip 3 coins. ")).toBe(true);
    expect(DOUBLE_HIT.startsWith("Flip a coin.")).toBe(false);
    expect(FURY_SWIPES.startsWith("Flip a coin.")).toBe(false);
  });
});

describe("deriveAttackCoinFlip — the THIRD member, on ONE regex", () => {
  it("reads both fixture sentences to their exact perHeads values", () => {
    expect(deriveAttackCoinFlip(DOUBLE_HIT)).toEqual({
      kind: "perHeads",
      flips: { kind: "printed", count: 2 },
      per: 30,
    });
    expect(deriveAttackCoinFlip(FURY_SWIPES)).toEqual({
      kind: "perHeads",
      flips: { kind: "printed", count: 3 },
      per: 20,
    });
    expect(deriveAttackCoinFlip(DOUBLE_HIT)).toHaveProperty("flips.kind", "printed");
    expect(deriveAttackCoinFlip(FURY_SWIPES)).toHaveProperty("flips.kind", "printed");
    const flip = deriveAttackCoinFlip(DOUBLE_HIT);
    if (flip === null) throw new Error("unreachable");
    expect(Object.keys(flip).sort()).toEqual(["flips", "kind", "per"]);
    expect(flip).not.toHaveProperty("cond");
    expect(flip).not.toHaveProperty("count");
  });

  it("derives off the card fixtures, not just the constants", () => {
    // The constants above are pinned to FIXTURE_POOL char-for-char, but reading the
    // derivation straight off the fixture is what proves the two never drifted apart
    // in the same edit.
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv01-160"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "perHeads", flips: { kind: "printed", count: 2 }, per: 30 });
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv06.5-048"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "perHeads", flips: { kind: "printed", count: 3 }, per: 20 });
  });

  it("reads every printed COUNT and every printed PER off the one regex", () => {
    for (const flips of PRINTED_FLIPS) {
      for (const per of PRINTED_PER) {
        const text = `Flip ${flips} coins. This attack does ${per} damage for each heads.`;
        expect(deriveAttackCoinFlip(text)).toEqual({
          kind: "perHeads",
          flips: { kind: "printed", count: flips },
          per,
        });
      }
    }
  });

  it("bounds the COUNT — plural below, MAX_PRINTED_FLIPS above", () => {
    expect(deriveAttackCoinFlip("Flip 1 coins. This attack does 30 damage for each heads.")).toBe(
      null,
    );
    // …and 0, for the same reason from further below: a zero-flip attack would spend
    // nothing and decide nothing.
    expect(deriveAttackCoinFlip("Flip 0 coins. This attack does 30 damage for each heads.")).toBe(
      null,
    );
    expect(
      deriveAttackCoinFlip("Flip 10 coins. This attack does 10 damage for each heads."),
    ).toEqual({ kind: "perHeads", flips: { kind: "printed", count: 10 }, per: 10 });
    expect(deriveAttackCoinFlip("Flip 11 coins. This attack does 10 damage for each heads.")).toBe(
      null,
    );
    expect(
      deriveAttackCoinFlip("Flip 1000000 coins. This attack does 10 damage for each heads."),
    ).toBe(null);
    // The pool's own maximum sits comfortably inside the bound (Unfezant
    // swsh10.5-063 is the family's only 4).
    expect(
      deriveAttackCoinFlip("Flip 4 coins. This attack does 30 damage for each heads."),
    ).toEqual({ kind: "perHeads", flips: { kind: "printed", count: 4 }, per: 30 });
  });

  it("refuses a printed ZERO per — the `per >= 1` guard every arm carries", () => {
    expect(deriveAttackCoinFlip("Flip 2 coins. This attack does 0 damage for each heads.")).toBe(
      null,
    );
    // …while the smallest REAL value one digit away is read fine.
    expect(deriveAttackCoinFlip("Flip 2 coins. This attack does 1 damage for each heads.")).toEqual(
      {
        kind: "perHeads",
        flips: { kind: "printed", count: 2 },
        per: 1,
      },
    );
  });
});

describe("the rest of the flip family — what stays LOUD, and the one shape D128 took", () => {
  it('refuses the live "more" printing — ONE WORD from the mapped shape', () => {
    const melmetal = "Flip 2 coins. This attack does 90 more damage for each heads.";
    expect(deriveAttackCoinFlip(melmetal)).toEqual({
      kind: "bonusOnHeads",
      flips: { kind: "printed", count: 2 },
      per: 90,
    });
    // …and the ONE WORD is the whole difference: drop "more" and the same sentence
    // resolves to the OTHER member, with the same flips and the same per.
    expect(deriveAttackCoinFlip(melmetal.replace(" more", ""))).toEqual({
      kind: "perHeads",
      flips: { kind: "printed", count: 2 },
      per: 90,
    });
    for (const [text, per] of [
      ["Flip 2 coins. This attack does 30 more damage for each heads.", 30],
      ["Flip 2 coins. This attack does 50 more damage for each heads.", 50],
    ] as const) {
      expect(deriveAttackCoinFlip(text)).toEqual({
        kind: "bonusOnHeads",
        flips: { kind: "printed", count: 2 },
        per,
      });
    }
    const bouffalant =
      "Flip a coin until you get tails. This attack does 30 more damage for each heads.";
    expect(deriveAttackCoinFlip(bouffalant)).toEqual({
      kind: "bonusOnHeads",
      flips: { kind: "untilTails" },
      per: 30,
    });
    expect(deriveAttackCoinFlip(bouffalant)).not.toHaveProperty("flips.count");
    expect(deriveAttackCoinFlip(bouffalant)?.kind).not.toBe("perHeads");
    expect(melmetal.replace(" more", "")).toBe(
      "Flip 2 coins. This attack does 90 damage for each heads.",
    );
    expect(deriveAttackCoinFlip(melmetal.replace(" more", ""))).toEqual({
      kind: "perHeads",
      flips: { kind: "printed", count: 2 },
      per: 90,
    });
    expect(deriveAttackCoinFlip(bouffalant.replace(" more", ""))).toEqual({
      kind: "perHeads",
      flips: { kind: "untilTails" },
      per: 30,
    });
  });

  it("refuses the STEPPED TWO-COIN GATE — this slice's own opening, a different consequent", () => {
    const magikarp = "Flip 2 coins. If both of them are heads, this attack does 20 more damage.";
    expect(deriveAttackCoinFlip(magikarp)).toEqual({
      kind: "bonusOnAllHeads",
      flips: { kind: "printed", count: 2 },
      bonus: 20,
    });
    // Its OPENING is Tandemaus's, word for word — so this is the consequent being
    // refused, not the count.
    expect(magikarp.startsWith("Flip 2 coins. ")).toBe(true);
    expect(magikarp.startsWith(DOUBLE_HIT.slice(0, "Flip 2 coins. ".length))).toBe(true);
    expect(
      deriveAttackCoinFlip("Flip 2 coins. This attack does 30 damage for each heads."),
    ).not.toBe(null);
    const growlithe = "Flip a coin until you get tails. This attack does 30 damage for each heads.";
    expect(growlithe.endsWith("This attack does 30 damage for each heads.")).toBe(true);
    expect(deriveAttackCoinFlip(growlithe)).toEqual({
      kind: "perHeads",
      flips: { kind: "untilTails" },
      per: 30,
    });
    // The `flips` TAG is the whole disjointness claim: a `printed` reading here would
    // be a FIXED number of flips for a card whose count is a property of the faces.
    expect(deriveAttackCoinFlip(growlithe)).not.toHaveProperty("flips.count");
    expect(deriveAttackCoinFlip(growlithe)).not.toEqual(deriveAttackCoinFlip(DOUBLE_HIT));
  });

  it("hands the BOARD-COUNTED number of flips to D128's arm — never to this slice's printed one", () => {
    const torkoal =
      "Flip a coin for each {R} Energy attached to this Pokémon. This attack does 80 damage for each heads.";
    expect(deriveAttackCoinFlip(torkoal)).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: "Fire" },
      per: 80,
    });
    expect(deriveAttackCoinFlip(torkoal)).not.toHaveProperty("flips.kind", "printed");
    expect(deriveAttackCoinFlip(torkoal)).not.toHaveProperty("flips.count");
    // Its CONSEQUENT is Tandemaus's, word for word past the opening — so the two arms
    // really are told apart by the leading sentence and by nothing else. (The whole
    // family's own cases live in perEnergyFlip.test.ts.)
    expect(torkoal.endsWith("This attack does 80 damage for each heads.")).toBe(true);
    expect(
      deriveAttackCoinFlip("Flip 2 coins. This attack does 80 damage for each heads."),
    ).toEqual({ kind: "perHeads", flips: { kind: "printed", count: 2 }, per: 80 });
  });

  it("reads the STEPPED PAYOUT table as its OWN member — a TABLE, not `perHeads` (BUILT at D526)", () => {
    const bisharp =
      "Flip 3 coins. If 1 of them is heads, this attack does 20 more damage. If 2 of them are heads, this attack does 60 more damage. If all of them are heads, this attack does 120 more damage.";
    const member = deriveAttackCoinFlip(bisharp);
    expect(member).toEqual({
      kind: "bonusLadder",
      flips: { kind: "printed", count: 3 },
      ladder: [20, 60, 120],
    });
    expect(member?.kind).toBe("bonusLadder");
    // NOT perHeads: the payout is a table, not per × heads.
    expect(member).not.toHaveProperty("per");
    expect(member?.kind).not.toBe("perHeads");
    // …and the `$` still holds: a trailing clause keeps the sentence off the member.
    expect(deriveAttackCoinFlip(`${bisharp} Draw a card.`)).toBeNull();
  });
});

describe("constructed near-misses stay LOUD", () => {
  it("refuses the anchor, casing and whitespace rewrites", () => {
    for (const text of [
      // Lowercase leading "flip" — the skeleton has no /i.
      "flip 2 coins. This attack does 30 damage for each heads.",
      // Lowercase "this" — the same guard one sentence later.
      "Flip 2 coins. this attack does 30 damage for each heads.",
      // No trailing period is not the whole sentence.
      "Flip 2 coins. This attack does 30 damage for each heads",
      // "!" for "." — the same one-character difference from the other side.
      "Flip 2 coins. This attack does 30 damage for each heads!",
      "This attack does 30 damage for each heads.",
      // The OPENING alone — a count with nothing to fold it into.
      "Flip 2 coins.",
      // Leading text pins `^`.
      "Before doing damage, flip 2 coins. This attack does 30 damage for each heads.",
      // A missing space after the flip sentence — invisible in a diff.
      "Flip 2 coins.This attack does 30 damage for each heads.",
      // An INTERIOR double space is not trimmable.
      "Flip 2 coins.  This attack does 30 damage for each heads.",
      "Flip 2 coin. This attack does 30 damage for each heads.",
      "Flip two coins. This attack does 30 damage for each heads.",
      // "head" for "heads".
      "Flip 2 coins. This attack does 30 damage for each head.",
      // A NON-BREAKING SPACE where an ASCII one is printed — the invisible drift.
      `Flip 2 coins.${NBSP}This attack does 30 damage for each heads.`,
    ]) {
      expect(deriveAttackCoinFlip(text)).toBe(null);
    }
  });

  it("refuses a TRAILING SUFFIX at the `$` — but trims outer whitespace", () => {
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. This attack does 30 damage for each heads. Your opponent's Active Pokémon is now Confused.",
      ),
    ).toBe(null);
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. This attack does 30 damage for each heads, and discard an Energy from this Pokémon.",
      ),
    ).toBe(null);
    // Outer whitespace, by contrast, SURVIVES by design (the deriver trims), so this
    // pair states which drift is tolerated and which is not.
    expect(deriveAttackCoinFlip(`${DOUBLE_HIT} `)).toEqual({
      kind: "perHeads",
      flips: { kind: "printed", count: 2 },
      per: 30,
    });
    expect(deriveAttackCoinFlip(`  ${FURY_SWIPES}\n`)).toEqual({
      kind: "perHeads",
      flips: { kind: "printed", count: 3 },
      per: 20,
    });
  });
});

describe("deriver disjointness — a fourth reader that crosses none of the other three", () => {
  it("keeps BOTH multi-flip sentences off the effect/bonus/multiplier/requirement readers", () => {
    for (const sentence of [DOUBLE_HIT, FURY_SWIPES]) {
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
      // deriveAttackEffect — a plain status op.
      "Your opponent's Active Pokémon is now Paralyzed.",
      "If this Pokémon has a Pokémon Tool attached, this attack does 80 more damage.",
      "This attack does 50 damage for each Prize card your opponent has taken.",
      "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.",
    ];
    for (const sentence of representatives) {
      expect(deriveAttackCoinFlip(sentence)).toBeNull();
    }
    // …and each really is live for its own reader, so the nulls are refusals and not
    // four dead strings.
    expect(deriveAttackEffect(representatives[0] ?? "")).not.toBeNull();
    expect(deriveAttackDamageBonus(representatives[1] ?? "")).not.toBeNull();
    expect(deriveAttackDamageMultiplier(representatives[2] ?? "")).not.toBeNull();
    expect(deriveAttackRequirement(representatives[3] ?? "")).not.toBeNull();
  });
});

describe("ZERO registry rows — the cards flip straight off their printed text", () => {
  it("has no program of any kind for either card", () => {
    for (const id of ["sv01-160", "sv06.5-048"]) {
      expect(programFor(id)).toBeUndefined();
      expect(programFor(id)?.attack).toBeUndefined();
      expect(programFor(id)?.passive).toBeUndefined();
    }
  });
});

describe("Tandemaus — TWO flips, THREE outcomes, and the base that must not leak", () => {
  it("deals exactly 30 × heads into a neutral body — 0 / 30 / 60, never 30 / 60 / 90", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = tandemausActive(board(seed), "p1");
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      // EXACTLY TWO flips — the printed count, read from the sentence.
      const flips = all(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips).toHaveLength(2);
      for (const flip of flips) expect(flip.seat).toBe("p1"); // the ATTACKER flips
      const heads = headsIn(events);
      seen.add(heads);
      expect(activeDamage(done, "p2")).toBe(30 * heads);
      // …and the three totals the printed base WOULD have produced are absent.
      expect(activeDamage(done, "p2")).not.toBe(30 * heads + 30);
      // Never a Knock Out on a 200 HP body, so every seed measures damage.
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(types(events)).toContain("TURN_ENDED");
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it("reports base 0 and scaled 30 × heads on the DAMAGE_DEALT row", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { events } = mustApply(tandemausActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const heads = headsIn(events);
      seen.add(heads);
      const damage = find(events, "DAMAGE_DEALT");
      if (heads === 0) {
        expect(damage).toBeUndefined();
        continue;
      }
      expect(damage?.base).toBe(0);
      expect(damage?.scaled).toBe(30 * heads);
      expect(damage?.dealt).toBe(30 * heads);
      expect(damage?.weakness).toBeNull();
      expect(damage?.resistance).toBeNull();
      // The flips are announced BEFORE the damage they decided, in printed order.
      expect(types(events).lastIndexOf("ATTACK_EFFECT_COIN_FLIP")).toBeLessThan(
        types(events).indexOf("DAMAGE_DEALT"),
      );
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });
});

describe("Meowth — THREE flips, FOUR outcomes, and a second N through the same loop", () => {
  it("deals exactly 20 × heads into a neutral body — 0 / 20 / 40 / 60", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = meowthActive(board(seed), "p1");
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const flips = all(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips).toHaveLength(3);
      for (const flip of flips) expect(flip.seat).toBe("p1");
      const heads = headsIn(events);
      seen.add(heads);
      expect(activeDamage(done, "p2")).toBe(20 * heads);
      expect(activeDamage(done, "p2")).not.toBe(20 * heads + 20);
      const damage = find(events, "DAMAGE_DEALT");
      if (heads === 0) {
        expect(damage).toBeUndefined();
      } else {
        expect(damage?.base).toBe(0);
        expect(damage?.scaled).toBe(20 * heads);
        expect(damage?.dealt).toBe(20 * heads);
      }
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(types(events)).toContain("TURN_ENDED");
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe("the rngState account — exactly `flips` steps, no more and no fewer", () => {
  it("recomputes both cards' whole flip sequences by hand, in order", () => {
    for (const [field, flips] of [
      [tandemausActive, 2],
      [meowthActive, 3],
    ] as const) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const state = field(board(seed), "p1");
        const [faces, expected] = foldFlips(state.rngState, flips);
        const { state: after, events } = mustApply(state, {
          type: "attack",
          seat: "p1",
          index: FLIP_INDEX,
        });
        expect(after.rngState).toBe(expected);
        expect(all(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result)).toEqual(faces);
        // One MORE step would have landed here — named explicitly so the assertion
        // above is a claim about the count and not just about a number.
        expect(after.rngState).not.toBe(foldFlips(state.rngState, flips + 1)[1]);
        expect(after.rngState).not.toBe(foldFlips(state.rngState, flips - 1)[1]);
      }
    }
  });

  it("does not double-flip with §8's CONFUSION check — the flip rows are the ONLY ones", () => {
    // The two flips live at the same site, one gate apart, and the confusion one is
    // the older. An UNCONFUSED attacker must never emit its event and never consume
    // its step, so the N rows in the list are N and are all the attack's own.
    for (const [field, flips] of [
      [tandemausActive, 2],
      [meowthActive, 3],
    ] as const) {
      const state = field(board(5), "p1");
      expect(state.players.p1.active?.conditions.rotation).toBe("none");
      const { events } = mustApply(state, { type: "attack", seat: "p1", index: FLIP_INDEX });
      expect(types(events)).not.toContain("CONFUSION_CHECK");
      expect(types(events).filter((t) => t === "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(flips);
    }
  });
});

describe("modifierSimulated — no loud row on ANY outcome, for EITHER card", () => {
  it("emits NO ATTACK_EFFECT_SKIPPED across the whole sweep", () => {
    const seenTandemaus = new Set<number>();
    const seenMeowth = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const tandemaus = mustApply(tandemausActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const meowth = mustApply(meowthActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      expect(types(tandemaus.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(meowth.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      seenTandemaus.add(headsIn(tandemaus.events));
      seenMeowth.add(headsIn(meowth.events));
    }
    expect([...seenTandemaus].sort()).toEqual([0, 1, 2]);
    expect([...seenMeowth].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe("ZERO HEADS — a RESOLVED attack that dealt nothing, not a cancelled one", () => {
  it("emits no DAMAGE_DEALT and no ATTACK_FAILED, and still ends the turn", () => {
    let checked = 0;
    for (const [field, flips] of [
      [tandemausActive, 2],
      [meowthActive, 3],
    ] as const) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const state = field(board(seed), "p1");
        const before = activeDamage(state, "p2");
        const { state: done, events } = mustApply(state, {
          type: "attack",
          seat: "p1",
          index: FLIP_INDEX,
        });
        if (headsIn(events) !== 0) continue;
        checked += 1;
        // Every flip still happened and was still announced — the attack was fully
        // resolved, it simply totalled nothing.
        expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(flips);
        expect(all(events, "ATTACK_EFFECT_COIN_FLIP").every((e) => e.result === "tails")).toBe(
          true,
        );
        // NOTHING LANDED, stated as a list of absences.
        expect(types(events)).not.toContain("DAMAGE_DEALT");
        expect(types(events)).not.toContain("COUNTERS_PLACED");
        expect(types(events)).not.toContain("KNOCKED_OUT");
        // …and the defender's damage is identical to before, not merely small.
        expect(activeDamage(done, "p2")).toBe(before);
        expect(activeDamage(done, "p2")).toBe(0);
        expect(types(events)).not.toContain("ATTACK_FAILED");
        expect(find(events, "ATTACK_FAILED")).toBeUndefined();
        // And the turn ended the ordinary way, through the same `finishAttack` every
        // resolved attack takes.
        expect(types(events)).toContain("TURN_ENDED");
        expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
      }
    }
    // Both cards actually reached the outcome — otherwise the block above is a loop
    // that asserted nothing.
    expect(checked).toBeGreaterThanOrEqual(2);
  });
});

describe("the fold order — the dropped base and the count land BEFORE Weakness", () => {
  it("deals (0 + 60) × 2 = 120 into a Colorless-weak body, not 180 and not 60", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const opened = weakDefender(board(seed), "p2");
      const state = tandemausActive(opened, "p1");
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const heads = headsIn(events);
      seen.add(heads);
      const damage = find(events, "DAMAGE_DEALT");
      if (heads === 0) {
        expect(damage).toBeUndefined();
        expect(activeDamage(done, "p2")).toBe(0);
        continue;
      }
      // The multiplier really is live on this board — otherwise "120" below would be
      // a claim about nothing.
      expect(damage?.weakness).toEqual({ op: "multiply", amount: 2 });
      expect(damage?.base).toBe(0);
      expect(damage?.scaled).toBe(30 * heads);
      expect(damage?.dealt).toBe(60 * heads);
      expect(activeDamage(done, "p2")).toBe(60 * heads);
      if (heads === 2) {
        // Spelled out at the outcome the comment above is about.
        expect(damage?.dealt).toBe(120);
        expect(damage?.dealt).not.toBe(180);
        expect(damage?.dealt).not.toBe(60);
      } else {
        // ONE head: (0 + 30) × 2 = 60. The pair is what makes the 120 a fold-order
        // claim rather than a number.
        expect(damage?.dealt).toBe(60);
      }
      expect(types(events)).not.toContain("KNOCKED_OUT");
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });
});

describe("the D126 members still read the D126 sentences", () => {
  it("still reads both one-flip sentences to their own shapes", () => {
    expect(deriveAttackCoinFlip("Flip a coin. If heads, this attack does 10 more damage.")).toEqual(
      { kind: "bonusOnHeads", flips: { kind: "printed", count: 1 }, per: 10 },
    );
    expect(deriveAttackCoinFlip("Flip a coin. If tails, this attack does nothing.")).toEqual({
      kind: "cancelOnTails",
    });
    // `cancelOnTails` did NOT get one, and that asymmetry is deliberate: the member
    // IS "flip once, then take the printed branch", and attack.ts spells its single
    // flip as a local `ONE_FLIP` value rather than as a field nothing would vary.
    expect(
      Object.keys(
        deriveAttackCoinFlip("Flip a coin. If heads, this attack does 10 more damage.") ?? {},
      ).sort(),
    ).toEqual(["flips", "kind", "per"]);
    expect(
      Object.keys(deriveAttackCoinFlip("Flip a coin. If tails, this attack does nothing.") ?? {}),
    ).toEqual(["kind"]);
    expect(
      deriveAttackCoinFlip("Flip a coin. If heads, this attack does 10 more damage."),
    ).toHaveProperty("flips.kind", "printed");
    expect(
      deriveAttackCoinFlip("Flip a coin. If heads, this attack does 10 more damage."),
    ).toHaveProperty("flips.count", 1);
  });

  it("still flips exactly ONCE for a cancelOnTails attack — the loop's `flips = 1` path", () => {
    let sawHeads = false;
    let sawTails = false;
    for (let seed = 0; seed < SEEDS && !(sawHeads && sawTails); seed++) {
      const opened = mustApply(
        driveSetup(
          seed,
          { p1: COIN_FLIP_DECK, p2: COIN_FLIP_DECK },
          { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
        ),
        { type: "endTurn", seat: "p2" },
      ).state;
      const state = attachFromDeck(
        setActiveFromDeck(opened, "p1", "sv01-018"),
        "p1",
        "fix-grass-energy",
        1,
      );
      const [faces, expected] = foldFlips(state.rngState, 1);
      const { state: after, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result)).toEqual(faces);
      expect(after.rngState).toBe(expected);
      if (faces[0] === "heads") {
        sawHeads = true;
        expect(find(events, "DAMAGE_DEALT")?.base).toBe(30);
        expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
      } else {
        sawTails = true;
        // …and tails still CANCELS, which zero heads on a `perHeads` attack does not.
        expect(find(events, "ATTACK_FAILED")?.reason).toBe("coinFlip");
        expect(types(events)).not.toContain("DAMAGE_DEALT");
        expect(types(events)).toContain("TURN_ENDED");
      }
    }
    expect(sawHeads && sawTails).toBe(true);
  });
});

describe("purity", () => {
  it("resolves both multi-flip attacks on a DEEP-FROZEN board", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const tandemaus = deepFreeze(tandemausActive(weakDefender(board(seed), "p2"), "p1"));
      mustApply(tandemaus, { type: "attack", seat: "p1", index: FLIP_INDEX });
      const meowth = deepFreeze(meowthActive(board(seed), "p1"));
      mustApply(meowth, { type: "attack", seat: "p1", index: FLIP_INDEX });
    }
    // …and the DERIVER is a pure function of its string, frozen board or not.
    expect(deriveAttackCoinFlip(DOUBLE_HIT)).toEqual({
      kind: "perHeads",
      flips: { kind: "printed", count: 2 },
      per: 30,
    });
    expect(deriveAttackCoinFlip(FURY_SWIPES)).toEqual({
      kind: "perHeads",
      flips: { kind: "printed", count: 3 },
      per: 20,
    });
  });
});

describe("D413 — the ADDITIVE printed-count fold, on real seeds", () => {
  function bonusBoard(seed: number): GameState {
    const state = driveSetup(
      seed,
      { p1: COIN_BONUS_DECK, p2: COIN_BONUS_DECK },
      { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
    );
    const opened = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    return attachFromDeck(setActiveFromDeck(opened, "p1", "fix-coinbonus"), "p1", "fix-energy", 2);
  }

  it("keeps the printed base and adds per heads — swept, every outcome reached", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { state: done, events } = mustApply(bonusBoard(seed), {
        type: "attack",
        seat: "p1",
        index: 0,
      });
      // EXACTLY TWO flips — the printed count, read from the sentence and not from
      // the board or the faces.
      const flips = all(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips).toHaveLength(2);
      for (const flip of flips) expect(flip.seat).toBe("p1"); // the ATTACKER flips
      const heads = headsIn(events);
      seen.add(heads);
      // 20 + 30 × heads — the base KEPT, which is the whole difference from the
      // shipped `30×` twin one word away.
      expect(activeDamage(done, "p2")).toBe(20 + 30 * heads);
      expect(activeDamage(done, "p2")).not.toBe(30 * heads);
      expect(types(events)).not.toContain("KNOCKED_OUT");
    }
    // THE SWEEP REACHED EVERY OUTCOME — asserted, not assumed.
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it("the 50 twin is the same program on the one token D121's warrant is about", () => {
    // The pair differs in `per` and in nothing else — same cost, same base, same
    // flip count — so a board that credited the fold to the wrong scalar disagrees
    // here. 20 + 50 × heads = 20 / 70 / 120, all under the defender's 200 HP.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { state: done, events } = mustApply(bonusBoard(seed), {
        type: "attack",
        seat: "p1",
        index: 1,
      });
      const heads = headsIn(events);
      seen.add(heads);
      expect(activeDamage(done, "p2")).toBe(20 + 50 * heads);
      expect(types(events)).not.toContain("KNOCKED_OUT");
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it("the fixture prints the legal column's bytes verbatim, at the indices named", () => {
    const card = FIXTURE_POOL["fix-coinbonus"];
    expect(card?.attacks).toHaveLength(2);
    expect(card?.attacks?.[0]?.effect).toBe(
      "Flip 2 coins. This attack does 30 more damage for each heads.",
    );
    expect(card?.attacks?.[1]?.effect).toBe(
      "Flip 2 coins. This attack does 50 more damage for each heads.",
    );
    for (const attack of card?.attacks ?? []) expect(attack.damage).toBe("20+");
  });

  it("reads the COUNT from the sentence, and keeps its twin's two guards", () => {
    expect(
      deriveAttackCoinFlip("Flip 3 coins. This attack does 30 more damage for each heads."),
    ).toEqual({ kind: "bonusOnHeads", flips: { kind: "printed", count: 3 }, per: 30 });

    expect(
      deriveAttackCoinFlip("Flip 1 coins. This attack does 30 more damage for each heads."),
    ).toBeNull();
    // `per >= 1`: a printed 0 would spend a flip — and an `rngState` step — to add
    // nothing. No card prints it; the guard is what keeps that a fact about the pool
    // rather than an assumption.
    expect(
      deriveAttackCoinFlip("Flip 2 coins. This attack does 0 more damage for each heads."),
    ).toBeNull();
  });

  it("both sentences are in the legal column, and they are its WHOLE population", () => {
    const rows = legalAttackCorpus().filter(([, sentence]) =>
      /^Flip \d+ coins\. This attack does \d+ more damage for each heads\.$/.test(sentence),
    );
    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, [n]) => sum + n, 0)).toBe(5);
    for (const [, sentence] of rows) expect(deriveAttackCoinFlip(sentence)).not.toBeNull();
  });
});
