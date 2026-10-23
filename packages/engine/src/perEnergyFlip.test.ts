import { BASIC_ENERGY_TYPES } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import {
  countAttachedEnergy,
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
  FIXTURE_POOL,
  PER_ENERGY_FLIP_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
  headsIn,
} from "./testFixtures";

const CONCENTRATED_FIRE =
  "Flip a coin for each {R} Energy attached to this Pokémon. This attack does 80 damage for each heads.";

/** Bellossom sv03-003 "Powerful Dance", verbatim — the UNTYPED reading, where the
    count is attached Energy CARDS and the type of each is irrelevant. */
const POWERFUL_DANCE =
  "Flip a coin for each Energy attached to this Pokémon. This attack does 90 damage for each heads.";

const FULL_TILT_FLING =
  "Flip a coin for each Energy attached to this Pokémon. This attack does 60 damage for each heads.";

const FILTERED_FLIP =
  "Flip a coin for each {W} Energy attached to this Pokémon. This attack does 50 damage for each heads.";

/** U+00A0, spelled as an ESCAPE rather than typed. A non-breaking space is
    byte-different from an ASCII one and INVISIBLE in a diff, so the near-miss cases
    below name it instead of carrying it. */
const NBSP = " ";

const E_ACUTE = "é";

const TIMES = "×";

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const FLIP_INDEX = 1;

/** …and index 0 on the constructed fixture, which prints exactly one attack. */
const FILTER_INDEX = 0;

/** Torkoal's OTHER attack — a flat 30 with no effect and no modifier. It is the
    control for every "the coin reader did not touch this" claim: the same card, the
    same board, no flip rows and no dropped base. */
const FLAT_INDEX = 0;

const SEEDS = 24;

function board(seed: number): GameState {
  let state = driveSetup(
    seed,
    { p1: PER_ENERGY_FLIP_DECK, p2: PER_ENERGY_FLIP_DECK },
    { first: "p2" },
  );
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return state;
}

function pile(state: GameState, seat: Seat, spec: [id: string, count: number][]): GameState {
  let next = state;
  for (const [id, count] of spec) next = attachFromDeck(next, seat, id, count);
  return next;
}

/** Torkoal in the seat's Active Spot, with the pile the case wants.
    SURGERY: Torkoal is a Basic and COULD be dealt, but a swept seed cannot be relied
    on to deal any particular card, so every case fields its attacker. */
function torkoalActive(
  state: GameState,
  seat: Seat,
  spec: [id: string, count: number][],
): GameState {
  return pile(setActiveFromDeck(state, seat, "sv01-035"), seat, spec);
}

function bellossomActive(
  state: GameState,
  seat: Seat,
  spec: [id: string, count: number][],
): GameState {
  return pile(setActiveFromDeck(state, seat, "sv03-003"), seat, spec);
}

/** The constructed {W}-filter body in the seat's Active Spot, with the pile the case
    wants. Its {C} cost is paid by ANY one Energy, which is what lets a case attach a
    pile its filter counts NOTHING in. */
function filterActive(
  state: GameState,
  seat: Seat,
  spec: [id: string, count: number][],
): GameState {
  return pile(setActiveFromDeck(state, seat, "fix-flip-filter"), seat, spec);
}

function weakDefender(state: GameState, seat: Seat): GameState {
  return setActiveFromDeck(state, seat, "fix-pokemon-v-weak");
}

/** The seat's Active damage — read straight off the board, so the "nothing happened"
    cases are a real comparison and not an event-log inference. */
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

describe("the printed sentences — the fixture-text-verbatim guards", () => {
  it("matches FIXTURE_POOL char-for-char for Torkoal sv01-035", () => {
    const attack = FIXTURE_POOL["sv01-035"]?.attacks?.[FLIP_INDEX];
    expect(attack?.effect).toBe(CONCENTRATED_FIRE);
    expect(attack?.name).toBe("Concentrated Fire");
    expect(attack?.damage).toBe(`80${TIMES}`);
    expect(typeof attack?.damage).toBe("string");
    // THE COST IS THE CASE. {R}{C}{C} is what makes "the cost is met and the count is
    // still 1" a board this suite can build — a card whose cost were {R}{R}{R} could
    // not tell a filtered count from an unfiltered one at all.
    expect(attack?.cost).toEqual(["Fire", "Colorless", "Colorless"]);
    // The flat control at index 0, and the reason FLIP_INDEX is 1 on this card.
    expect(FIXTURE_POOL["sv01-035"]?.attacks?.[FLAT_INDEX]?.name).toBe("Stampede");
    expect(FIXTURE_POOL["sv01-035"]?.attacks?.[FLAT_INDEX]?.damage).toBe(30);
    expect(FIXTURE_POOL["sv01-035"]?.attacks?.[FLAT_INDEX]?.effect).toBeUndefined();
    expect(FIXTURE_POOL["sv01-035"]?.attacks).toHaveLength(2);
    expect(FIXTURE_POOL["sv01-035"]?.abilities).toBeNull();
  });

  it("matches FIXTURE_POOL char-for-char for Bellossom sv03-003", () => {
    const attack = FIXTURE_POOL["sv03-003"]?.attacks?.[FLIP_INDEX];
    expect(attack?.effect).toBe(POWERFUL_DANCE);
    expect(attack?.name).toBe("Powerful Dance");
    expect(attack?.damage).toBe(`90${TIMES}`);
    expect(typeof attack?.damage).toBe("string");
    // ONE symbol, which is what lets a legal declaration hold a pile of three
    // different types — the board that separates "counts CARDS" (3) from "counts
    // Grass" (1).
    expect(attack?.cost).toEqual(["Grass"]);
    expect(FIXTURE_POOL["sv03-003"]?.attacks?.[FLAT_INDEX]?.name).toBe("Sleep Powder");
    expect(FIXTURE_POOL["sv03-003"]?.attacks).toHaveLength(2);
    expect(FIXTURE_POOL["sv03-003"]?.abilities).toBeNull();
  });

  it("matches the CONSTRUCTED zero-count probe, and says why it is constructed", () => {
    const attack = FIXTURE_POOL["fix-flip-filter"]?.attacks?.[FILTER_INDEX];
    expect(attack?.effect).toBe(FILTERED_FLIP);
    expect(attack?.damage).toBe(`50${TIMES}`);
    expect(attack?.cost).toEqual(["Colorless"]);
    expect(attack?.cost).not.toContain("Water");
    expect(FILTERED_FLIP).toContain("{W}");
    expect(FIXTURE_POOL["fix-flip-filter"]?.attacks).toHaveLength(1);
    expect(FIXTURE_POOL["sv01-035"]?.attacks?.[FLIP_INDEX]?.cost).toContain("Fire");
    expect(FIXTURE_POOL["sv03-003"]?.attacks?.[FLIP_INDEX]?.cost).toHaveLength(1);
  });

  it('splits all three printed markers into base + "×" through parseAttackDamage', () => {
    expect(parseAttackDamage(FIXTURE_POOL["sv01-035"]?.attacks?.[FLIP_INDEX]?.damage)).toEqual({
      base: 80,
      modifier: TIMES,
    });
    expect(parseAttackDamage(FIXTURE_POOL["sv03-003"]?.attacks?.[FLIP_INDEX]?.damage)).toEqual({
      base: 90,
      modifier: TIMES,
    });
    expect(
      parseAttackDamage(FIXTURE_POOL["fix-flip-filter"]?.attacks?.[FILTER_INDEX]?.damage),
    ).toEqual({ base: 50, modifier: TIMES });
    for (const [text, damage] of [
      [CONCENTRATED_FIRE, `80${TIMES}`],
      [POWERFUL_DANCE, `90${TIMES}`],
      [FILTERED_FLIP, `50${TIMES}`],
    ] as const) {
      const flip = deriveAttackCoinFlip(text);
      if (flip?.kind !== "perHeads") throw new Error("expected a perHeads printing");
      expect(parseAttackDamage(damage).base).toBe(flip.per);
      expect(parseAttackDamage(damage).modifier).toBe(TIMES);
    }
    // …and the flat control carries NO modifier at all, which is why it can never be
    // confused for a member of this family.
    expect(parseAttackDamage(FIXTURE_POOL["sv01-035"]?.attacks?.[FLAT_INDEX]?.damage)).toEqual({
      base: 30,
      modifier: null,
    });
  });

  it("keeps the card facts the counts are measured against", () => {
    expect(FIXTURE_POOL["sv01-035"]?.name).toBe("Torkoal");
    expect(FIXTURE_POOL["sv01-035"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv01-035"]?.types).toEqual(["Fire"]);
    expect(FIXTURE_POOL["sv01-035"]?.hp).toBe(130);
    expect(FIXTURE_POOL["sv01-035"]?.retreat).toBe(3);
    expect(FIXTURE_POOL["sv01-035"]?.weaknesses).toEqual([{ type: "Water", value: `${TIMES}2` }]);
    expect(FIXTURE_POOL["sv01-035"]?.resistances).toBeNull();
    expect(FIXTURE_POOL["sv01-035"]?.evolveFrom).toBeNull();

    // A STAGE 2 that evolves from Gloom — pinned because it is why every case force-
    // places this card, and because a fixture that quietly became a Basic would make
    // the surgery look unnecessary.
    expect(FIXTURE_POOL["sv03-003"]?.name).toBe("Bellossom");
    expect(FIXTURE_POOL["sv03-003"]?.stage).toBe("Stage2");
    expect(FIXTURE_POOL["sv03-003"]?.evolveFrom).toBe("Gloom");
    expect(FIXTURE_POOL["sv03-003"]?.types).toEqual(["Grass"]);
    expect(FIXTURE_POOL["sv03-003"]?.hp).toBe(130);
    expect(FIXTURE_POOL["sv03-003"]?.retreat).toBe(1);
    expect(FIXTURE_POOL["sv03-003"]?.weaknesses).toEqual([{ type: "Fire", value: `${TIMES}2` }]);
    expect(FIXTURE_POOL["sv03-003"]?.resistances).toBeNull();

    // TORKOAL IS FIRE and the weak body is ×2 FIRE — which is what makes the fold-order
    // case a claim about this attacker rather than about a body nothing here can hit.
    // 210 HP is above 160 (one head doubled), so that case measures damage.
    expect(FIXTURE_POOL["fix-pokemon-v-weak"]?.weaknesses).toEqual([
      { type: "Fire", value: `${TIMES}2` },
    ]);
    expect(FIXTURE_POOL["fix-pokemon-v-weak"]?.hp).toBe(210);
    expect(FIXTURE_POOL["fix-pokemon-v-weak"]?.resistances).toBeNull();
    // …and the neutral defender has NEITHER, so every other case reads the folded
    // number unmodified. 340 HP is above every total in this file (Bellossom's three
    // heads is 270), so no swept seed ends on a Knock Out.
    expect(FIXTURE_POOL["fix-titan"]?.weaknesses).toBeNull();
    expect(FIXTURE_POOL["fix-titan"]?.resistances).toBeNull();
    expect(FIXTURE_POOL["fix-titan"]?.hp).toBe(340);
    expect(FIXTURE_POOL["fix-titan"]?.attacks).toBeNull();
  });

  it("pins the BYTES — and that every sentence in THIS family is non-ASCII", () => {
    expect(CONCENTRATED_FIRE.length).toBe(100);
    expect(utf8Bytes(CONCENTRATED_FIRE)).toBe(101);
    expect(POWERFUL_DANCE.length).toBe(96);
    expect(utf8Bytes(POWERFUL_DANCE)).toBe(97);
    expect(FILTERED_FLIP.length).toBe(100);
    expect(utf8Bytes(FILTERED_FLIP)).toBe(101);
    expect(FULL_TILT_FLING.length).toBe(96);
    expect(utf8Bytes(FULL_TILT_FLING)).toBe(97);
    for (const sentence of [CONCENTRATED_FIRE, POWERFUL_DANCE, FILTERED_FLIP, FULL_TILT_FLING]) {
      // EXACTLY ONE non-ASCII character, and it is the accent — asserted over the
      // characters rather than inferred from the byte total, which a pair of
      // compensating drifts could fake.
      expect([...sentence].filter((ch) => (ch.codePointAt(0) ?? 0) >= 128)).toEqual([E_ACUTE]);
      expect(sentence).toContain(`this Pok${E_ACUTE}mon`);
      // A DECOMPOSED accent is byte-different and looks identical in a diff.
      expect(sentence).not.toContain("é");
      expect(sentence).not.toContain("’"); // U+2019 — the pool holds zero of them
      expect(sentence).not.toContain(NBSP); // the invisible drift
      // The "×" lives in the DAMAGE field, never in the effect text.
      expect(sentence).not.toContain(TIMES);
      // The shared trailing sentence, char-for-char: the clause whose one missing word
      // ("more") separates this family from the additive one.
      expect(sentence.endsWith(" damage for each heads.")).toBe(true);
      expect(sentence).not.toContain("more");
      expect(sentence.startsWith("Flip a coin for each ")).toBe(true);
      expect(sentence.startsWith("Flip 2 coins.")).toBe(false);
      expect(sentence).toBe(sentence.trim());
    }
    // The TYPED and UNTYPED sentences differ by exactly the token and its space, which
    // is the entire difference between the two readings.
    expect(CONCENTRATED_FIRE.replace("{R} ", "").replace("80", "90")).toBe(POWERFUL_DANCE);
    expect(POWERFUL_DANCE.replace("90", "60")).toBe(FULL_TILT_FLING);
  });
});

describe("deriveAttackCoinFlip — the FOURTH shape, and the first flip count read off the BOARD", () => {
  it("reads Torkoal's TYPED sentence to an attachedEnergy count", () => {
    expect(deriveAttackCoinFlip(CONCENTRATED_FIRE)).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: "Fire" },
      per: 80,
    });
    expect(deriveAttackCoinFlip(CONCENTRATED_FIRE)).toHaveProperty("flips.kind", "attachedEnergy");
    expect(deriveAttackCoinFlip(CONCENTRATED_FIRE)).not.toHaveProperty("flips.count");
    const flip = deriveAttackCoinFlip(CONCENTRATED_FIRE);
    if (flip === null) throw new Error("unreachable");
    expect(Object.keys(flip).sort()).toEqual(["flips", "kind", "per"]);
    if (flip.kind !== "perHeads") throw new Error("expected perHeads");
    expect(Object.keys(flip.flips).sort()).toEqual(["energy", "kind"]);
    expect(flip).not.toHaveProperty("cond");
  });

  it("reads BOTH untyped printings to energy: null, with their own per", () => {
    expect(deriveAttackCoinFlip(POWERFUL_DANCE)).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: null },
      per: 90,
    });
    expect(deriveAttackCoinFlip(FULL_TILT_FLING)).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: null },
      per: 60,
    });
    const flip = deriveAttackCoinFlip(POWERFUL_DANCE);
    if (flip?.kind !== "perHeads" || flip.flips.kind !== "attachedEnergy") {
      throw new Error("expected an attachedEnergy perHeads printing");
    }
    expect(flip.flips.energy).toBeNull();
    // 60 ≠ 90 off ONE regex: `per` is captured, not assumed.
    expect(deriveAttackCoinFlip(FULL_TILT_FLING)).not.toEqual(deriveAttackCoinFlip(POWERFUL_DANCE));
  });

  it("derives off the card fixtures, not just the constants", () => {
    // The constants above are pinned to FIXTURE_POOL char-for-char, but reading the
    // derivation straight off the fixture is what proves the two never drifted apart
    // in the same edit.
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv01-035"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "perHeads", flips: { kind: "attachedEnergy", energy: "Fire" }, per: 80 });
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv03-003"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "perHeads", flips: { kind: "attachedEnergy", energy: null }, per: 90 });
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["fix-flip-filter"]?.attacks?.[FILTER_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "perHeads", flips: { kind: "attachedEnergy", energy: "Water" }, per: 50 });
  });
});

describe("both notations, one vocabulary — a spelled-out type derives identically to its brace code", () => {
  it("reads every basic type through BOTH spellings, off the one regex", () => {
    const codes: Record<string, string> = {
      Grass: "{G}",
      Fire: "{R}",
      Water: "{W}",
      Lightning: "{L}",
      Psychic: "{P}",
      Fighting: "{F}",
      Darkness: "{D}",
      Metal: "{M}",
      Fairy: "{Y}",
    };
    for (const type of BASIC_ENERGY_TYPES) {
      const code = codes[type];
      if (code === undefined) throw new Error(`no brace code for ${type}`);
      const braced = `Flip a coin for each ${code} Energy attached to this Pokémon. This attack does 50 damage for each heads.`;
      const spelled = `Flip a coin for each ${type} Energy attached to this Pokémon. This attack does 50 damage for each heads.`;
      const expected = {
        kind: "perHeads",
        flips: { kind: "attachedEnergy", energy: type },
        per: 50,
      };
      expect(deriveAttackCoinFlip(braced)).toEqual(expected);
      expect(deriveAttackCoinFlip(spelled)).toEqual(expected);
      // …and the two notations really are the SAME value, not two values that happen
      // to satisfy the same literal.
      expect(deriveAttackCoinFlip(spelled)).toEqual(deriveAttackCoinFlip(braced));
    }
    expect(deriveAttackCoinFlip(CONCENTRATED_FIRE.replace("{R}", "Fire"))).toEqual(
      deriveAttackCoinFlip(CONCENTRATED_FIRE),
    );
  });

  it("reads `Special` — the CARD CLASS, which is not a type at all", () => {
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Special Energy attached to this Pokémon. This attack does 50 damage for each heads.",
      ),
    ).toEqual({ kind: "perHeads", flips: { kind: "attachedEnergy", energy: "special" }, per: 50 });
    // Lower-cased it is NOT the token — the map is keyed on the printed capital.
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each special Energy attached to this Pokémon. This attack does 50 damage for each heads.",
      ),
    ).toBe(null);
  });
});

describe("unresolvable tokens stay LOUD — a filter nobody can resolve is not an unfiltered count", () => {
  it("refuses {C} — because Colorless is the SPECIAL-ENERGY FALLBACK, not a type", () => {
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each {C} Energy attached to this Pokémon. This attack does 50 damage for each heads.",
      ),
    ).toBe(null);
    // …and the spelled-out form is refused by the same absence, from the other
    // notation: `Colorless` is deliberately not in BASIC_ENERGY_TYPES (it is a cost
    // SYMBOL, not an attachable basic type), so the name map cannot resolve it either.
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Colorless Energy attached to this Pokémon. This attack does 50 damage for each heads.",
      ),
    ).toBe(null);
    expect((BASIC_ENERGY_TYPES as readonly string[]).includes("Colorless")).toBe(false);
  });

  it("refuses every OTHER token that resolves to nothing — codes, names and junk", () => {
    for (const token of [
      "{N}", // no such code in either notation
      "{Q}", // ditto — a plausible-looking one
      "{c}", // the right code, wrong case
      "Dragon", // a real Pokémon TYPE with no Basic Energy at all, so not in the map
      "Fake", // junk
      "{R", // a truncated brace
      "R", // a bare code letter with no braces
      "{R} Basic", // a compound the greedy `.+` will happily capture whole
    ]) {
      const text = `Flip a coin for each ${token} Energy attached to this Pokémon. This attack does 50 damage for each heads.`;
      expect(deriveAttackCoinFlip(text)).toBe(null);
      // …and the SAME sentence with the token removed is the unfiltered reading, which
      // is what makes each null above a claim about the token and not about the shape.
      expect(deriveAttackCoinFlip(text.replace(`${token} `, ""))).toEqual({
        kind: "perHeads",
        flips: { kind: "attachedEnergy", energy: null },
        per: 50,
      });
    }
  });

  it("refuses a printed ZERO per — the `per >= 1` guard every arm of the family carries", () => {
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Energy attached to this Pokémon. This attack does 0 damage for each heads.",
      ),
    ).toBe(null);
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each {R} Energy attached to this Pokémon. This attack does 0 damage for each heads.",
      ),
    ).toBe(null);
    // …while the smallest REAL value one digit away is read fine on both.
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Energy attached to this Pokémon. This attack does 1 damage for each heads.",
      ),
    ).toEqual({ kind: "perHeads", flips: { kind: "attachedEnergy", energy: null }, per: 1 });
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each {R} Energy attached to this Pokémon. This attack does 1 damage for each heads.",
      ),
    ).toEqual({ kind: "perHeads", flips: { kind: "attachedEnergy", energy: "Fire" }, per: 1 });
  });

  it('refuses the NEAR-MISSES — "more", the wrong subject, and the missing accent', () => {
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Energy attached to this Pokémon. This attack does 50 more damage for each heads.",
      ),
    ).toBe(null);
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each {R} Energy attached to this Pokémon. This attack does 50 more damage for each heads.",
      ),
    ).toBe(null);
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Energy attached to your Pokémon. This attack does 50 damage for each heads.",
      ),
    ).toBe(null);
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Energy attached to each of your Pokémon. This attack does 50 damage for each heads.",
      ),
    ).toBe(null);
    // THE MISSING ACCENT — the one drift a re-ingest is most likely to introduce, and
    // the reason the byte guard above exists. "Pokemon" is not "Pokémon".
    expect(
      deriveAttackCoinFlip(
        "Flip a coin for each Energy attached to this Pokemon. This attack does 50 damage for each heads.",
      ),
    ).toBe(null);
    expect(deriveAttackCoinFlip(CONCENTRATED_FIRE.replace(E_ACUTE, "e"))).toBe(null);
  });

  it("refuses the anchor, casing, whitespace and SUFFIX rewrites — but trims outer space", () => {
    for (const text of [
      // Lowercase leading "flip" — the skeleton has no /i.
      "flip a coin for each Energy attached to this Pokémon. This attack does 50 damage for each heads.",
      // Lowercase "this" one sentence later.
      "Flip a coin for each Energy attached to this Pokémon. this attack does 50 damage for each heads.",
      // No trailing period is not the whole sentence.
      "Flip a coin for each Energy attached to this Pokémon. This attack does 50 damage for each heads",
      // The CONSEQUENT ALONE — the degenerate string a substring matcher would claim.
      "This attack does 50 damage for each heads.",
      // The OPENING alone — a count with nothing to fold it into.
      "Flip a coin for each Energy attached to this Pokémon.",
      // Leading text pins `^`.
      "Before doing damage, flip a coin for each Energy attached to this Pokémon. This attack does 50 damage for each heads.",
      // A missing space after the first sentence — invisible in a diff.
      "Flip a coin for each Energy attached to this Pokémon.This attack does 50 damage for each heads.",
      // An INTERIOR double space is not trimmable.
      "Flip a coin for each Energy attached to this Pokémon.  This attack does 50 damage for each heads.",
      "Flip a coins for each Energy attached to this Pokémon. This attack does 50 damage for each heads.",
      // "head" for "heads".
      "Flip a coin for each Energy attached to this Pokémon. This attack does 50 damage for each head.",
      // A NON-BREAKING SPACE where an ASCII one is printed.
      `Flip a coin for each Energy attached to this Pokémon.${NBSP}This attack does 50 damage for each heads.`,
      // A SECOND CONSEQUENT riding the same flips — the shape the `$` exists for. The
      // engine would resolve the damage and silently drop the rider.
      "Flip a coin for each Energy attached to this Pokémon. This attack does 50 damage for each heads. Your opponent's Active Pokémon is now Confused.",
      "Flip a coin for each Energy attached to this Pokémon. This attack does 50 damage for each heads, and discard an Energy from this Pokémon.",
    ]) {
      expect(deriveAttackCoinFlip(text)).toBe(null);
    }
    // Outer whitespace, by contrast, SURVIVES by design (the deriver trims), so this
    // pair states which drift is tolerated and which is not.
    expect(deriveAttackCoinFlip(`${CONCENTRATED_FIRE} `)).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: "Fire" },
      per: 80,
    });
    expect(deriveAttackCoinFlip(`  ${POWERFUL_DANCE}\n`)).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: null },
      per: 90,
    });
  });
});

describe("deriver disjointness — a fourth SHAPE that crosses none of the other four readers", () => {
  it("keeps all three sentences off the effect/bonus/multiplier/requirement readers", () => {
    for (const sentence of [CONCENTRATED_FIRE, POWERFUL_DANCE, FILTERED_FLIP, FULL_TILT_FLING]) {
      expect(deriveAttackEffect(sentence)).toBeNull();
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
      expect(deriveAttackRequirement(sentence)).toBeNull();
    }
  });

  it("keeps a REAL sentence of each of the four families off deriveAttackCoinFlip", () => {
    const representatives = [
      // deriveAttackEffect — a plain status op.
      "Your opponent's Active Pokémon is now Paralyzed.",
      // deriveAttackDamageBonus — the additive "+" family, on a count that reader
      // really does answer.
      "This attack does 10 more damage for each damage counter on this Pokémon.",
      // deriveAttackDamageMultiplier — the "×" shape on a board count.
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

  it("keeps Entei's ATTACHED-ENERGY count off the COIN reader — now that damage reads it", () => {
    const blazeBall =
      "This attack does 20 more damage for each {R} Energy attached to this Pokémon.";
    expect(FIXTURE_POOL["sv03-030"]?.attacks?.[0]?.effect).toBe(blazeBall);
    expect(deriveAttackCoinFlip(blazeBall)).toBeNull();
    expect(deriveAttackDamageBonus(blazeBall)).toEqual({
      per: 20,
      count: { kind: "energyOnSelf", energyType: "Fire" },
    });
    // The `×` twin still refuses it — "more" is the fold discriminator, and a
    // sentence that reaches BOTH damage readers would fold twice.
    expect(deriveAttackDamageMultiplier(blazeBall)).toBeNull();
    // The two sentences share their counted noun VERBATIM, which is what makes the
    // coin reader's null a statement about the CONSEQUENT rather than about the text:
    // CONCENTRATED_FIRE contains the identical clause and DOES derive a flip count.
    expect(blazeBall.endsWith("for each {R} Energy attached to this Pokémon.")).toBe(true);
    expect(CONCENTRATED_FIRE).toContain("for each {R} Energy attached to this Pokémon.");
    expect(deriveAttackCoinFlip(CONCENTRATED_FIRE)).not.toBeNull();
    expect(deriveAttackDamageBonus(CONCENTRATED_FIRE)).toBeNull();
    expect(deriveAttackDamageMultiplier(CONCENTRATED_FIRE)).toBeNull();
  });

  it("leaves the other AttackCoinFlip readings exactly where they were", () => {
    expect(deriveAttackCoinFlip("Flip a coin. If heads, this attack does 10 more damage.")).toEqual(
      {
        kind: "bonusOnHeads",
        flips: { kind: "printed", count: 1 },
        per: 10,
      },
    );
    expect(deriveAttackCoinFlip("Flip a coin. If tails, this attack does nothing.")).toEqual({
      kind: "cancelOnTails",
    });
    expect(
      deriveAttackCoinFlip("Flip 2 coins. This attack does 30 damage for each heads."),
    ).toEqual({ kind: "perHeads", flips: { kind: "printed", count: 2 }, per: 30 });
    expect(
      deriveAttackCoinFlip("Flip 3 coins. This attack does 20 damage for each heads."),
    ).toEqual({ kind: "perHeads", flips: { kind: "printed", count: 3 }, per: 20 });
    // `cancelOnTails` did NOT acquire one, and the asymmetry is deliberate: that
    // member IS "flip once, then take the printed branch", so attack.ts spells its
    // single flip as a local value rather than as a field nothing would vary.
    expect(
      Object.keys(
        deriveAttackCoinFlip("Flip a coin. If heads, this attack does 10 more damage.") ?? {},
      ).sort(),
    ).toEqual(["flips", "kind", "per"]);
    expect(
      Object.keys(deriveAttackCoinFlip("Flip a coin. If tails, this attack does nothing.") ?? {}),
    ).toEqual(["kind"]);
    for (const [text, expected] of [
      [
        "Flip a coin until you get tails. This attack does 30 damage for each heads.",
        { kind: "perHeads", flips: { kind: "untilTails" }, per: 30 },
      ],
      [
        "Flip a coin until you get tails. This attack does 30 more damage for each heads.",
        { kind: "bonusOnHeads", flips: { kind: "untilTails" }, per: 30 },
      ],
    ] as const) {
      expect(deriveAttackCoinFlip(text)).toEqual(expected);
      expect(deriveAttackCoinFlip(text)).not.toHaveProperty("flips.energy");
      expect(deriveAttackCoinFlip(text)).toHaveProperty("flips.kind", "untilTails");
    }
    const krookodile = deriveAttackCoinFlip(
      "Flip a coin until you get tails. For each heads, discard an Energy from your opponent's Active Pokémon.",
    );
    expect(krookodile).not.toBeNull();
    expect(krookodile).toHaveProperty("kind", "programPerHeads");
    expect(krookodile).toHaveProperty("flips.kind", "untilTails");
    expect(krookodile).not.toHaveProperty("flips.energy");
    expect(
      deriveAttackCoinFlip(
        "Flip 3 coins. For each heads, discard a random card from your opponent's hand.",
      ),
    ).toHaveProperty("flips.kind", "printed");
  });
});

describe("ZERO registry rows — all three cards flip straight off their printed text", () => {
  it("has no program of any kind for any of them", () => {
    for (const id of ["sv01-035", "sv03-003", "fix-flip-filter"]) {
      expect(programFor(id)).toBeUndefined();
      expect(programFor(id)?.attack).toBeUndefined();
      expect(programFor(id)?.passive).toBeUndefined();
    }
  });
});

describe("Torkoal — the TYPED count is not the ENERGY count, on a board where the cost is MET", () => {
  it("flips ONCE on 1 Fire + 2 Water: 0 or 80, and never the 240 an unfiltered count gives", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = torkoalActive(board(seed), "p1", [
        ["fix-fire-energy", 1],
        ["fix-water-energy", 2],
      ]);
      // The board really is the one described: three Energy cards attached, of which
      // exactly one is Fire. Without this the case could pass on a board that simply
      // failed to attach the Waters.
      expect(state.players.p1.active?.energy).toHaveLength(3);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const flips = all(events, "ATTACK_EFFECT_COIN_FLIP");
      expect(flips).toHaveLength(1);
      for (const flip of flips) expect(flip.seat).toBe("p1"); // the ATTACKER flips
      const heads = headsIn(events);
      seen.add(heads);
      expect(activeDamage(done, "p2")).toBe(80 * heads);
      // The three totals an unfiltered count could have produced, named as absences.
      expect(activeDamage(done, "p2")).not.toBe(240);
      expect(activeDamage(done, "p2")).not.toBe(160);
      // …and the printed base never leaks: one head is 80, not 160.
      expect(activeDamage(done, "p2")).not.toBe(80 * heads + 80);
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(types(events)).toContain("TURN_ENDED");
    }
    // BOTH outcomes of the single flip were reached — asserted, not assumed.
    expect([...seen].sort()).toEqual([0, 1]);
  });

  it("reports base 0 and scaled 80 on the DAMAGE_DEALT row, and no row at all on tails", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { events } = mustApply(
        torkoalActive(board(seed), "p1", [
          ["fix-fire-energy", 1],
          ["fix-water-energy", 2],
        ]),
        { type: "attack", seat: "p1", index: FLIP_INDEX },
      );
      const heads = headsIn(events);
      seen.add(heads);
      const damage = findEvent(events, "DAMAGE_DEALT");
      if (heads === 0) {
        expect(damage).toBeUndefined();
        continue;
      }
      expect(damage?.base).toBe(0);
      expect(damage?.scaled).toBe(80);
      expect(damage?.dealt).toBe(80);
      expect(damage?.weakness).toBeNull();
      expect(damage?.resistance).toBeNull();
      // The flip is announced BEFORE the damage it decided.
      expect(types(events).lastIndexOf("ATTACK_EFFECT_COIN_FLIP")).toBeLessThan(
        types(events).indexOf("DAMAGE_DEALT"),
      );
    }
    expect([...seen].sort()).toEqual([0, 1]);
  });

  it("flips THREE times on 3 Fire — the same card, the same text, a different board", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = torkoalActive(board(seed), "p1", [["fix-fire-energy", 3]]);
      expect(state.players.p1.active?.energy).toHaveLength(3);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(3);
      const heads = headsIn(events);
      seen.add(heads);
      // 0 / 80 / 160 / 240, and the printed base is dropped on every one of them: a
      // leaked base would read 80 / 160 / 240 / 320, which OVERLAPS the correct set at
      // two points — only the 0-heads outcome cannot be faked, and the sweep reaches it.
      expect(activeDamage(done, "p2")).toBe(80 * heads);
      expect(activeDamage(done, "p2")).not.toBe(80 * heads + 80);
      const damage = findEvent(events, "DAMAGE_DEALT");
      if (heads === 0) {
        expect(damage).toBeUndefined();
      } else {
        expect(damage?.base).toBe(0);
        expect(damage?.scaled).toBe(80 * heads);
        expect(damage?.dealt).toBe(80 * heads);
      }
      // 240 into 340 HP is not a Knock Out, so every seed measures damage.
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(types(events)).toContain("TURN_ENDED");
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("leaves the card's OTHER attack completely alone — a flat 30, no flips, base kept", () => {
    const state = torkoalActive(board(0), "p1", [["fix-water-energy", 2]]);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: FLAT_INDEX,
    });
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(findEvent(events, "DAMAGE_DEALT")?.base).toBe(30);
    // `scaled` is "present only when it applied", so its ABSENCE is the claim: nothing
    // was folded in front of Weakness at all, where the flip attack's whole number
    // arrives through that field.
    expect(findEvent(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
    expect(activeDamage(done, "p2")).toBe(30);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("Bellossom — the UNTYPED count reads CARDS, whatever each one provides", () => {
  it("flips once per attached Energy on a THREE-TYPE pile — 3 flips, not the 1 a Grass filter gives", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = bellossomActive(board(seed), "p1", [
        ["fix-grass-energy", 1],
        ["fix-fire-energy", 1],
        ["fix-water-energy", 1],
      ]);
      expect(state.players.p1.active?.energy).toHaveLength(3);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(3);
      const heads = headsIn(events);
      seen.add(heads);
      expect(activeDamage(done, "p2")).toBe(90 * heads);
      // The printed "90×" base is dropped here too — a leaked one reads 90 more.
      expect(activeDamage(done, "p2")).not.toBe(90 * heads + 90);
      // 270 into 340 HP survives, so the sweep never ends on a promotion.
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(types(events)).toContain("TURN_ENDED");
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("counts a WILDCARD Special as exactly ONE card — the reading that makes `null` nullable", () => {
    let sawHeads = false;
    let sawTails = false;
    for (let seed = 0; seed < SEEDS && !(sawHeads && sawTails); seed++) {
      const state = bellossomActive(board(seed), "p1", [["sv02-191", 1]]);
      expect(state.players.p1.active?.energy).toHaveLength(1);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
      const heads = headsIn(events);
      expect(activeDamage(done, "p2")).toBe(90 * heads);
      if (heads === 1) sawHeads = true;
      else sawTails = true;
    }
    expect(sawHeads && sawTails).toBe(true);
  });
});

describe("ZERO COUNT — zero FLIPS, which is not zero HEADS", () => {
  it("takes no flip, spends no rngState step, deals nothing, and STILL ends the turn", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = filterActive(board(seed), "p1", [["fix-fire-energy", 1]]);
      expect(state.players.p1.active?.energy).toHaveLength(1);
      const before = state.rngState;
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FILTER_INDEX,
      });
      // The attack was DECLARED — this is a resolved attack, not a rejected one.
      expect(types(events)).toContain("ATTACK_DECLARED");
      // ZERO ROWS. Not "no heads" — no coin at all.
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
      // NO rngState STEP. Byte-identical to the state before the attack, which is a
      // strictly stronger claim than "no rows": a flip that was taken and not
      // announced would pass the assertion above and fail this one.
      expect(done.rngState).toBe(before);
      expect(done.rngState).toBe(foldFlips(before, 0)[1]);
      expect(done.rngState).not.toBe(foldFlips(before, 1)[1]);
      // NOTHING LANDED.
      expect(types(events)).not.toContain("DAMAGE_DEALT");
      expect(types(events)).not.toContain("COUNTERS_PLACED");
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(activeDamage(done, "p2")).toBe(0);
      // BUT IT WAS NOT CANCELLED — no ATTACK_FAILED of any reason. This is the
      // assertion that separates a zero count from `cancelOnTails`.
      expect(types(events)).not.toContain("ATTACK_FAILED");
      expect(findEvent(events, "ATTACK_FAILED")).toBeUndefined();
      // …and the turn ended the ordinary way, through the same `finishAttack` every
      // resolved attack takes.
      expect(types(events)).toContain("TURN_ENDED");
      expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    }
  });

  it("flips EXACTLY ONCE the moment a Water joins the same pile", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = filterActive(board(seed), "p1", [
        ["fix-fire-energy", 1],
        ["fix-water-energy", 1],
      ]);
      expect(state.players.p1.active?.energy).toHaveLength(2);
      const before = state.rngState;
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FILTER_INDEX,
      });
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
      const heads = headsIn(events);
      seen.add(heads);
      // TWO cards attached, ONE flip — the filter is doing the work, not the pile size.
      expect(activeDamage(done, "p2")).toBe(50 * heads);
      expect(activeDamage(done, "p2")).not.toBe(100);
      expect(done.rngState).toBe(foldFlips(before, 1)[1]);
    }
    expect([...seen].sort()).toEqual([0, 1]);
  });
});

describe("the rngState account — exactly `count` steps, no more and no fewer", () => {
  it("recomputes every board's whole flip sequence by hand, in order", () => {
    const boards: [
      label: string,
      build: (state: GameState) => GameState,
      count: number,
      index: number,
    ][] = [
      [
        "Torkoal, 1 Fire + 2 Water → the {R} count is 1",
        (s) =>
          torkoalActive(s, "p1", [
            ["fix-fire-energy", 1],
            ["fix-water-energy", 2],
          ]),
        1,
        FLIP_INDEX,
      ],
      ["Torkoal, 3 Fire", (s) => torkoalActive(s, "p1", [["fix-fire-energy", 3]]), 3, FLIP_INDEX],
      [
        "Bellossom, 3 mixed cards",
        (s) =>
          bellossomActive(s, "p1", [
            ["fix-grass-energy", 1],
            ["fix-fire-energy", 1],
            ["fix-water-energy", 1],
          ]),
        3,
        FLIP_INDEX,
      ],
      [
        "fix-flip-filter, 1 Fire against a {W} filter → ZERO",
        (s) => filterActive(s, "p1", [["fix-fire-energy", 1]]),
        0,
        FILTER_INDEX,
      ],
    ];
    for (const [label, build, count, index] of boards) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const state = build(board(seed));
        const [faces, expected] = foldFlips(state.rngState, count);
        const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index });
        expect(after.rngState, label).toBe(expected);
        expect(
          all(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result),
          label,
        ).toEqual(faces);
        expect(after.rngState, label).not.toBe(foldFlips(state.rngState, count + 1)[1]);
        if (count > 0) {
          expect(after.rngState, label).not.toBe(foldFlips(state.rngState, count - 1)[1]);
        }
      }
    }
  });

  it("does not double-flip with §8's CONFUSION check — the flip rows are the ONLY ones", () => {
    for (const [build, count, index] of [
      [(s: GameState) => torkoalActive(s, "p1", [["fix-fire-energy", 3]]), 3, FLIP_INDEX],
      [(s: GameState) => filterActive(s, "p1", [["fix-fire-energy", 1]]), 0, FILTER_INDEX],
    ] as const) {
      const state = build(board(5));
      expect(state.players.p1.active?.conditions.rotation).toBe("none");
      const { events } = mustApply(state, { type: "attack", seat: "p1", index });
      expect(types(events)).not.toContain("CONFUSION_CHECK");
      expect(types(events).filter((t) => t === "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(count);
    }
  });
});

describe("modifierSimulated — no loud row on ANY outcome, on ANY count, including ZERO", () => {
  it("emits NO ATTACK_EFFECT_SKIPPED across the whole sweep, on all three cards", () => {
    const seenTorkoal = new Set<number>();
    const seenBellossom = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const torkoal = mustApply(torkoalActive(board(seed), "p1", [["fix-fire-energy", 3]]), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const bellossom = mustApply(
        bellossomActive(board(seed), "p1", [
          ["fix-grass-energy", 1],
          ["fix-fire-energy", 1],
          ["fix-water-energy", 1],
        ]),
        { type: "attack", seat: "p1", index: FLIP_INDEX },
      );
      const zero = mustApply(filterActive(board(seed), "p1", [["fix-fire-energy", 1]]), {
        type: "attack",
        seat: "p1",
        index: FILTER_INDEX,
      });
      expect(types(torkoal.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(bellossom.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(zero.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(all(zero.events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
      seenTorkoal.add(headsIn(torkoal.events));
      seenBellossom.add(headsIn(bellossom.events));
    }
    expect([...seenTorkoal].sort()).toEqual([0, 1, 2, 3]);
    expect([...seenBellossom].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe("the fold order — the board-counted flips land BEFORE Weakness", () => {
  it("deals (0 + 80) × 2 = 160 into a Fire-weak body, not 320 and not 80", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const opened = weakDefender(board(seed), "p2");
      const state = torkoalActive(opened, "p1", [
        ["fix-fire-energy", 1],
        ["fix-water-energy", 2],
      ]);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
      const heads = headsIn(events);
      seen.add(heads);
      const damage = findEvent(events, "DAMAGE_DEALT");
      if (heads === 0) {
        expect(damage).toBeUndefined();
        expect(activeDamage(done, "p2")).toBe(0);
        continue;
      }
      // The multiplier really is live on this board — otherwise "160" below would be a
      // claim about nothing. (Torkoal is Fire; the body is ×2 Fire.)
      expect(damage?.weakness).toEqual({ op: "multiply", amount: 2 });
      expect(damage?.base).toBe(0);
      expect(damage?.scaled).toBe(80);
      expect(damage?.dealt).toBe(160);
      expect(damage?.dealt).not.toBe(320);
      expect(damage?.dealt).not.toBe(80);
      expect(activeDamage(done, "p2")).toBe(160);
      expect(types(events)).not.toContain("KNOCKED_OUT");
    }
    expect([...seen].sort()).toEqual([0, 1]);
  });
});

describe("countAttachedEnergy — three readings of one pile, and where they DISAGREE", () => {
  it('counts CARDS for null, PROVISION for a type, and the CARD CLASS for "special"', () => {
    const state = bellossomActive(board(0), "p1", [
      ["fix-fire-energy", 1],
      ["fix-water-energy", 1],
      ["fix-special", 1],
    ]);
    const mon = state.players.p1.active;
    if (mon === null) throw new Error("no Active to count");
    expect(mon.energy).toHaveLength(3);
    expect(countAttachedEnergy(state, mon, null)).toBe(3);
    expect(countAttachedEnergy(state, mon, "Fire")).toBe(1);
    expect(countAttachedEnergy(state, mon, "Water")).toBe(1);
    expect(countAttachedEnergy(state, mon, "Grass")).toBe(0);
    expect(countAttachedEnergy(state, mon, "special")).toBe(1);
    // Stated as the inequality it is, so the case cannot be satisfied by three
    // separately-correct-looking numbers that happen to add up.
    expect(countAttachedEnergy(state, mon, null)).not.toBe(
      countAttachedEnergy(state, mon, "Fire") +
        countAttachedEnergy(state, mon, "Water") +
        countAttachedEnergy(state, mon, "Grass"),
    );
    // An empty pile answers 0 to all three, on the same Pokémon before anything was
    // attached — the trivial reading, pinned because "0" is also what a broken filter
    // returns and the suite should be able to tell the two apart elsewhere.
    const bare = setActiveFromDeck(board(0), "p1", "sv03-003").players.p1.active;
    if (bare === null) throw new Error("no Active to count");
    expect(countAttachedEnergy(state, bare, null)).toBe(0);
    expect(countAttachedEnergy(state, bare, "Fire")).toBe(0);
    expect(countAttachedEnergy(state, bare, "special")).toBe(0);
  });

  it("counts a WILDCARD for EVERY type and still as exactly ONE card", () => {
    const state = bellossomActive(board(0), "p1", [["sv02-191", 1]]);
    const mon = state.players.p1.active;
    if (mon === null) throw new Error("no Active to count");
    expect(mon.energy).toHaveLength(1);
    for (const type of BASIC_ENERGY_TYPES) {
      expect(countAttachedEnergy(state, mon, type)).toBe(1);
    }
    expect(countAttachedEnergy(state, mon, null)).toBe(1);
    expect(countAttachedEnergy(state, mon, "special")).toBe(1);

    const demoted = pile(state, "p1", [["fix-special", 1]]);
    const after = demoted.players.p1.active;
    if (after === null) throw new Error("no Active to count");
    expect(countAttachedEnergy(demoted, after, null)).toBe(2);
    expect(countAttachedEnergy(demoted, after, "special")).toBe(2);
    for (const type of BASIC_ENERGY_TYPES) {
      expect(countAttachedEnergy(demoted, after, type)).toBe(0);
    }
  });

  it("is the number the FLIP COUNT uses — the unit reading and the board reading agree", () => {
    const cases: [
      build: (s: GameState) => GameState,
      energy: "Fire" | "Water" | null,
      pileSize: number,
      expected: number,
      index: number,
    ][] = [
      // The three central boards: the filtered count BELOW the pile size, the filtered
      // count EQUAL to it, and the unfiltered count that IS it.
      [
        (s) =>
          torkoalActive(s, "p1", [
            ["fix-fire-energy", 1],
            ["fix-water-energy", 2],
          ]),
        "Fire",
        3,
        1,
        FLIP_INDEX,
      ],
      [(s) => torkoalActive(s, "p1", [["fix-fire-energy", 3]]), "Fire", 3, 3, FLIP_INDEX],
      [
        (s) =>
          bellossomActive(s, "p1", [
            ["fix-grass-energy", 1],
            ["fix-fire-energy", 1],
            ["fix-water-energy", 1],
          ]),
        null,
        3,
        3,
        FLIP_INDEX,
      ],
      // …and the two filter boards, including the ZERO one.
      [(s) => filterActive(s, "p1", [["fix-fire-energy", 1]]), "Water", 1, 0, FILTER_INDEX],
      [
        (s) =>
          filterActive(s, "p1", [
            ["fix-fire-energy", 1],
            ["fix-water-energy", 1],
          ]),
        "Water",
        2,
        1,
        FILTER_INDEX,
      ],
    ];
    let differed = 0;
    for (const [build, energy, pileSize, expected, index] of cases) {
      const state = build(board(3));
      const mon = state.players.p1.active;
      if (mon === null) throw new Error("no Active to count");
      expect(mon.energy).toHaveLength(pileSize);
      const counted = countAttachedEnergy(state, mon, energy);
      expect(counted).toBe(expected);
      const { events } = mustApply(state, { type: "attack", seat: "p1", index });
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(counted);
      if (counted !== pileSize) differed += 1;
    }
    expect(differed).toBe(3);
  });
});

describe("purity", () => {
  it("resolves every board-counted attack on a DEEP-FROZEN board", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const torkoal = deepFreeze(
        torkoalActive(weakDefender(board(seed), "p2"), "p1", [
          ["fix-fire-energy", 1],
          ["fix-water-energy", 2],
        ]),
      );
      mustApply(torkoal, { type: "attack", seat: "p1", index: FLIP_INDEX });
      const bellossom = deepFreeze(
        bellossomActive(board(seed), "p1", [
          ["fix-grass-energy", 1],
          ["fix-fire-energy", 1],
          ["fix-water-energy", 1],
        ]),
      );
      mustApply(bellossom, { type: "attack", seat: "p1", index: FLIP_INDEX });
      const zero = deepFreeze(filterActive(board(seed), "p1", [["fix-fire-energy", 1]]));
      mustApply(zero, { type: "attack", seat: "p1", index: FILTER_INDEX });
    }
    // …and the COUNTER is a pure read of the board, frozen or not.
    const frozen = deepFreeze(torkoalActive(board(0), "p1", [["fix-fire-energy", 2]]));
    const mon = frozen.players.p1.active;
    if (mon === null) throw new Error("no Active to count");
    expect(countAttachedEnergy(frozen, mon, "Fire")).toBe(2);
    // …and the DERIVER is a pure function of its string.
    expect(deriveAttackCoinFlip(CONCENTRATED_FIRE)).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: "Fire" },
      per: 80,
    });
    expect(deriveAttackCoinFlip(POWERFUL_DANCE)).toEqual({
      kind: "perHeads",
      flips: { kind: "attachedEnergy", energy: null },
      per: 90,
    });
  });
});
