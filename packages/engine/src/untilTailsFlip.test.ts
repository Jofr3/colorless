import { describe, expect, it } from "vitest";
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
import { legalAttackCorpus } from "./censusAttackCorpus";
import { MAX_UNTIL_TAILS_FLIPS, flipCoin, flipUntilTails, type RngState } from "./rng";
import {
  FIXTURE_POOL,
  UNTIL_TAILS_FLIP_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
  headsIn,
} from "./testFixtures";

const RELENTLESS_FLAMES =
  "Flip a coin until you get tails. This attack does 30 damage for each heads.";

const BALL_ROLL = "Flip a coin until you get tails. This attack does 30 damage for each heads.";

const CONTINUOUS_SPIN =
  "Flip a coin until you get tails. This attack does 50 damage for each heads.";

const EGG_ROLLING = "Flip a coin until you get tails. This attack does 60 damage for each heads.";

const DAMAGE_RUSH =
  "Flip a coin until you get tails. This attack does 30 more damage for each heads.";

const FOR_EACH_HEADS = [
  "Flip a coin until you get tails. For each heads, discard an Energy from your opponent's Active Pokémon.",
  "Flip a coin until you get tails. For each heads, discard a random card from your opponent's hand.",
] as const;

const WREAK_HAVOC =
  "Flip a coin until you get tails. For each heads, discard the top 2 cards of your opponent's deck.";

const UNTIL_TAILS_OPENING = "Flip a coin until you get tails. ";

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

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const FLIP_INDEX = 0;
const EGG_INDEX = 1;
const POUND_INDEX = 0;

const SEEDS = 32;

function board(seed: number): GameState {
  let state = driveSetup(
    seed,
    { p1: UNTIL_TAILS_FLIP_DECK, p2: UNTIL_TAILS_FLIP_DECK },
    { first: "p2" },
  );
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return state;
}

/** Growlithe in the seat's Active Spot with Relentless Flames' single {R} paid.
    SURGERY: all three attackers are Basic and COULD be dealt, but a swept seed
    cannot be relied on to deal any particular one, so every case fields its own. */
function growlitheActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv01-030"), seat, "fix-fire-energy", 1);
}

/** Chansey in the seat's Active Spot with Egg Rolling's {C}{C}{C} paid — three
    symbols, which also pays Pound's {C}{C} for the control case. */
function chanseyActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv01-144"), seat, "fix-energy", 3);
}

function bouffalantActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv03-174"), seat, "fix-energy", 2);
}

function krookodileActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv01-117"), seat, "fix-fighting-energy", 1);
}

/** The seat's Active damage — read straight off the board, so the "nothing happened"
    cases are a real comparison and not an event-log inference. */
function activeDamage(state: GameState, seat: Seat): number | undefined {
  return state.players[seat].active?.damage;
}

function foldFlips(state: RngState, count: number): [faces: CoinFace[], next: RngState] {
  const faces: CoinFace[] = [];
  let rng = state;
  for (let i = 0; i < count; i += 1) {
    const [face, next] = flipCoin(rng);
    faces.push(face);
    rng = next;
  }
  return [faces, rng];
}

function facesIn(events: GameEvent[]): CoinFace[] {
  return all(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result);
}

describe("the printed sentences — the fixture-text-verbatim guards", () => {
  it("matches FIXTURE_POOL char-for-char for Growlithe sv01-030", () => {
    const attack = FIXTURE_POOL["sv01-030"]?.attacks?.[FLIP_INDEX];
    expect(attack?.effect).toBe(RELENTLESS_FLAMES);
    expect(attack?.name).toBe("Relentless Flames");
    expect(attack?.damage).toBe(`30${TIMES}`);
    expect(typeof attack?.damage).toBe("string");
    // ONE symbol, which is what makes this the cheapest board in the family: the only
    // thing varying across a swept seed is the flip sequence.
    expect(attack?.cost).toEqual(["Fire"]);
    expect(FIXTURE_POOL["sv01-030"]?.attacks).toHaveLength(1);
    expect(FIXTURE_POOL["sv01-030"]?.abilities).toBeNull();
  });

  it("matches FIXTURE_POOL char-for-char for Chansey sv01-144", () => {
    const attack = FIXTURE_POOL["sv01-144"]?.attacks?.[EGG_INDEX];
    expect(attack?.effect).toBe(EGG_ROLLING);
    expect(attack?.name).toBe("Egg Rolling");
    expect(attack?.damage).toBe(`60${TIMES}`);
    expect(typeof attack?.damage).toBe("string");
    expect(attack?.cost).toEqual(["Colorless", "Colorless", "Colorless"]);
    // The flat control at index 0, and the reason EGG_INDEX is 1 on this card: a
    // bare number with no effect and no modifier, on the same card and the same
    // board as the flip attack.
    expect(FIXTURE_POOL["sv01-144"]?.attacks?.[POUND_INDEX]?.name).toBe("Pound");
    expect(FIXTURE_POOL["sv01-144"]?.attacks?.[POUND_INDEX]?.damage).toBe(40);
    expect(FIXTURE_POOL["sv01-144"]?.attacks?.[POUND_INDEX]?.effect).toBeUndefined();
    expect(FIXTURE_POOL["sv01-144"]?.attacks).toHaveLength(2);
    expect(FIXTURE_POOL["sv01-144"]?.abilities).toBeNull();
  });

  it("matches FIXTURE_POOL char-for-char for Bouffalant sv03-174 — the ADDITIVE one", () => {
    const attack = FIXTURE_POOL["sv03-174"]?.attacks?.[FLIP_INDEX];
    expect(attack?.effect).toBe(DAMAGE_RUSH);
    expect(attack?.name).toBe("Damage Rush");
    expect(attack?.damage).toBe("50+");
    expect(typeof attack?.damage).toBe("string");
    expect(attack?.damage).not.toContain(TIMES);
    expect(attack?.cost).toEqual(["Colorless", "Colorless"]);
    expect(FIXTURE_POOL["sv03-174"]?.attacks).toHaveLength(1);
    expect(FIXTURE_POOL["sv03-174"]?.abilities).toHaveLength(1);
    expect(FIXTURE_POOL["sv03-174"]?.abilities?.[0]?.name).toBe("Bouffer");
  });

  it("matches FIXTURE_POOL char-for-char for the two DERIVER-ONLY printings", () => {
    expect(FIXTURE_POOL["sv02-026"]?.attacks?.[FLIP_INDEX]?.effect).toBe(BALL_ROLL);
    expect(FIXTURE_POOL["sv02-026"]?.attacks?.[FLIP_INDEX]?.name).toBe("Ball Roll");
    expect(FIXTURE_POOL["sv02-026"]?.attacks?.[FLIP_INDEX]?.damage).toBe(`30${TIMES}`);
    expect(FIXTURE_POOL["sv01-139"]?.attacks?.[FLIP_INDEX]?.effect).toBe(CONTINUOUS_SPIN);
    expect(FIXTURE_POOL["sv01-139"]?.attacks?.[FLIP_INDEX]?.name).toBe("Continuous Spin");
    expect(FIXTURE_POOL["sv01-139"]?.attacks?.[FLIP_INDEX]?.damage).toBe(`50${TIMES}`);
    expect(BALL_ROLL).toBe(RELENTLESS_FLAMES);
    expect(FIXTURE_POOL["sv02-026"]?.types).not.toEqual(FIXTURE_POOL["sv01-030"]?.types);
    expect(FIXTURE_POOL["sv02-026"]?.attacks?.[FLIP_INDEX]?.cost).not.toEqual(
      FIXTURE_POOL["sv01-030"]?.attacks?.[FLIP_INDEX]?.cost,
    );
  });

  it("matches FIXTURE_POOL char-for-char for the RE-POINTED Krookodile sv01-117", () => {
    const attack = FIXTURE_POOL["sv01-117"]?.attacks?.[FLIP_INDEX];
    expect(attack?.effect).toBe(FOR_EACH_HEADS[0]);
    expect(attack?.name).toBe("Chomp Chomp Bite");
    expect(attack?.damage).toBe(50);
    expect(typeof attack?.damage).toBe("number");
    expect(attack?.cost).toEqual(["Fighting"]);
    expect(FIXTURE_POOL["sv01-117"]?.attacks).toHaveLength(2);
    expect(FIXTURE_POOL["sv01-117"]?.abilities).toBeNull();
  });

  it("keeps the RE-POINTED witness honest — Gyarados swsh10.5-022 is now MAPPED", () => {
    expect(FIXTURE_POOL["swsh10.5-022"]?.attacks?.[FLIP_INDEX]?.effect).toBe(WREAK_HAVOC);
    expect(deriveAttackCoinFlip(WREAK_HAVOC)).not.toBeNull();
    expect(deriveAttackCoinFlip(WREAK_HAVOC)?.kind).toBe("programPerHeads");
    expect(deriveAttackCoinFlip(WREAK_HAVOC)?.kind).not.toBe("perHeads");
    expect(deriveAttackCoinFlip(WREAK_HAVOC)?.kind).not.toBe("bonusOnHeads");
    expect(deriveAttackCoinFlip(WREAK_HAVOC)).not.toHaveProperty("per");
    expect(deriveAttackCoinFlip(WREAK_HAVOC)).toHaveProperty("flips.kind", "untilTails");
    expect(WREAK_HAVOC.startsWith(UNTIL_TAILS_OPENING)).toBe(true);
  });

  it('splits the printed markers into base + "×" / "+" through parseAttackDamage', () => {
    expect(parseAttackDamage(FIXTURE_POOL["sv01-030"]?.attacks?.[FLIP_INDEX]?.damage)).toEqual({
      base: 30,
      modifier: TIMES,
    });
    expect(parseAttackDamage(FIXTURE_POOL["sv01-144"]?.attacks?.[EGG_INDEX]?.damage)).toEqual({
      base: 60,
      modifier: TIMES,
    });
    // THE ONE THAT IS DIFFERENT. Bouffalant's modifier is "+", so its base is KEPT —
    // and 50 is NOT its per-heads amount, where 30 and 60 above are exactly that.
    expect(parseAttackDamage(FIXTURE_POOL["sv03-174"]?.attacks?.[FLIP_INDEX]?.damage)).toEqual({
      base: 50,
      modifier: "+",
    });
    for (const [text, damage] of [
      [RELENTLESS_FLAMES, `30${TIMES}`],
      [CONTINUOUS_SPIN, `50${TIMES}`],
      [EGG_ROLLING, `60${TIMES}`],
    ] as const) {
      const flip = deriveAttackCoinFlip(text);
      if (flip?.kind !== "perHeads") throw new Error("expected a perHeads printing");
      expect(parseAttackDamage(damage).base).toBe(flip.per);
      expect(parseAttackDamage(damage).modifier).toBe(TIMES);
    }
    const rush = deriveAttackCoinFlip(DAMAGE_RUSH);
    if (rush?.kind !== "bonusOnHeads") throw new Error("expected a bonusOnHeads printing");
    expect(rush.per).toBe(30);
    expect(parseAttackDamage("50+").base).toBe(50);
    expect(parseAttackDamage("50+").base).not.toBe(rush.per);
    // …and the flat control carries NO modifier at all, which is why it can never be
    // confused for a member of this family.
    expect(parseAttackDamage(FIXTURE_POOL["sv01-144"]?.attacks?.[POUND_INDEX]?.damage)).toEqual({
      base: 40,
      modifier: null,
    });
  });

  it("keeps the card facts the sequences are measured against", () => {
    expect(FIXTURE_POOL["sv01-030"]?.name).toBe("Growlithe");
    expect(FIXTURE_POOL["sv01-030"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv01-030"]?.types).toEqual(["Fire"]);
    expect(FIXTURE_POOL["sv01-030"]?.hp).toBe(70);
    expect(FIXTURE_POOL["sv01-030"]?.retreat).toBe(2);
    expect(FIXTURE_POOL["sv01-030"]?.weaknesses).toEqual([{ type: "Water", value: `${TIMES}2` }]);
    expect(FIXTURE_POOL["sv01-030"]?.resistances).toBeNull();

    expect(FIXTURE_POOL["sv01-144"]?.name).toBe("Chansey");
    expect(FIXTURE_POOL["sv01-144"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv01-144"]?.types).toEqual(["Colorless"]);
    expect(FIXTURE_POOL["sv01-144"]?.hp).toBe(110);
    expect(FIXTURE_POOL["sv01-144"]?.retreat).toBe(2);
    expect(FIXTURE_POOL["sv01-144"]?.weaknesses).toEqual([
      { type: "Fighting", value: `${TIMES}2` },
    ]);

    expect(FIXTURE_POOL["sv03-174"]?.name).toBe("Bouffalant");
    expect(FIXTURE_POOL["sv03-174"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv03-174"]?.types).toEqual(["Colorless"]);
    expect(FIXTURE_POOL["sv03-174"]?.hp).toBe(120);

    expect(FIXTURE_POOL["fix-titan"]?.weaknesses).toBeNull();
    expect(FIXTURE_POOL["fix-titan"]?.resistances).toBeNull();
    expect(FIXTURE_POOL["fix-titan"]?.hp).toBe(340);
    expect(FIXTURE_POOL["fix-titan"]?.attacks).toBeNull();
  });

  it("pins the BYTES — and that all five mapped sentences are PURE ASCII", () => {
    expect(RELENTLESS_FLAMES.length).toBe(75);
    expect(utf8Bytes(RELENTLESS_FLAMES)).toBe(75);
    expect(CONTINUOUS_SPIN.length).toBe(75);
    expect(EGG_ROLLING.length).toBe(75);
    expect(DAMAGE_RUSH.length).toBe(80);
    expect(utf8Bytes(DAMAGE_RUSH)).toBe(80);
    expect(DAMAGE_RUSH.length - RELENTLESS_FLAMES.length).toBe(" more".length);
    for (const sentence of [
      RELENTLESS_FLAMES,
      BALL_ROLL,
      CONTINUOUS_SPIN,
      EGG_ROLLING,
      DAMAGE_RUSH,
    ]) {
      // PURE ASCII, asserted over the characters rather than inferred from the equal
      // totals above (which a pair of compensating drifts could fake).
      expect([...sentence].filter((ch) => (ch.codePointAt(0) ?? 0) >= 128)).toEqual([]);
      expect(sentence).not.toContain("é");
      expect(sentence).not.toContain("’"); // U+2019 — the pool holds zero of them
      expect(sentence).not.toContain(NBSP);
      expect(sentence).not.toContain(TIMES);
      expect(sentence.startsWith(UNTIL_TAILS_OPENING)).toBe(true);
      expect(sentence.startsWith("Flip a coin.")).toBe(false);
      expect(sentence.startsWith("Flip 2 coins.")).toBe(false);
      expect(sentence.endsWith(" damage for each heads.")).toBe(true);
      expect(sentence).toBe(sentence.trim());
    }
    // "more" appears on EXACTLY ONE of the five, and that one word is the whole
    // difference between a kept base and a dropped one.
    expect(
      [RELENTLESS_FLAMES, CONTINUOUS_SPIN, EGG_ROLLING, DAMAGE_RUSH].filter((s) =>
        s.includes("more"),
      ),
    ).toEqual([DAMAGE_RUSH]);
    // The three multiply sentences differ from each other in exactly their per.
    expect(RELENTLESS_FLAMES.replace("30", "50")).toBe(CONTINUOUS_SPIN);
    expect(RELENTLESS_FLAMES.replace("30", "60")).toBe(EGG_ROLLING);
    // …and the additive one is the multiply one plus one word, which is what makes
    // the two regexes' disjointness a claim about `(\d+) damage` refusing to span
    // "30 more damage" rather than about two unrelated patterns.
    expect(RELENTLESS_FLAMES.replace(" damage", " more damage")).toBe(DAMAGE_RUSH);
  });

  it("pins the TWO unmapped sentences too — same opening, different consequent", () => {
    // The witnesses are pinned char-for-char for the same reason the mapped ones are:
    // the claim below is that they are refused by the CONSEQUENT, and that is only a
    // claim if the opening they share is byte-identical to the mapped one.
    for (const sentence of FOR_EACH_HEADS) {
      expect(sentence.startsWith(UNTIL_TAILS_OPENING)).toBe(true);
      expect(sentence).toContain("For each heads,");
      // …and NONE of them says "damage for each heads" at all: they repeat an
      // EffectOp, they do not fold a number, which is why they belong at a different
      // site and not merely on a different regex.
      expect(sentence).not.toContain("damage for each heads");
      expect(sentence).not.toContain("This attack does");
      expect(sentence).toBe(sentence.trim());
    }
    // Krookodile's names a Pokémon and so carries the family's only é; Masquerain's
    // is pure ASCII. Pinned because a re-ingest that mangled the accent would change
    // that sentence and nothing else in this file.
    expect(FOR_EACH_HEADS[0].length).toBe(103);
    expect(utf8Bytes(FOR_EACH_HEADS[0])).toBe(104);
    expect(FOR_EACH_HEADS[1].length).toBe(97);
    expect(utf8Bytes(FOR_EACH_HEADS[1])).toBe(97);
    // The re-pointed-away sentence is pinned by the same rule and for a new reason:
    // its length is what says the two witnesses above were not merely renamed.
    expect(WREAK_HAVOC.length).toBe(97);
    expect(utf8Bytes(WREAK_HAVOC)).toBe(97);
    expect(WREAK_HAVOC).not.toBe(FOR_EACH_HEADS[1]);
  });

  it("D463 — [0] IS a corpus row and [1] is NOT, said off the measured column", () => {
    const corpus = new Set(legalAttackCorpus().map(([, sentence]) => sentence));
    expect(corpus.has(FOR_EACH_HEADS[0])).toBe(true);
    expect(corpus.has(FOR_EACH_HEADS[1])).toBe(false);
    const masquerain =
      "Flip 3 coins. For each heads, discard a random card from your opponent's hand.";
    expect(corpus.has(masquerain)).toBe(true);
    expect(masquerain).toHaveLength(78);
    expect(FOR_EACH_HEADS[1].endsWith(masquerain.slice("Flip 3 coins. ".length))).toBe(true);
    const untilTailsRepeats = legalAttackCorpus().filter(
      ([, s]) => s.startsWith(UNTIL_TAILS_OPENING) && s.includes("For each heads,"),
    );
    expect(untilTailsRepeats.map(([, s]) => s)).toEqual([FOR_EACH_HEADS[0]]);
  });
});

describe("deriveAttackCoinFlip — the FIFTH shape, on two regexes and ZERO table rows", () => {
  it("reads all FOUR multiply printings to perHeads/untilTails, with their own per", () => {
    // 30 twice (Growlithe and Rellor, byte-identical), 50 and 60 — every per the
    // pool prints for this sentence, off ONE regex and no table. A reader built on
    // literal sentences would need four rows for what is one shape with one hole.
    for (const [text, per] of [
      [RELENTLESS_FLAMES, 30],
      [BALL_ROLL, 30],
      [CONTINUOUS_SPIN, 50],
      [EGG_ROLLING, 60],
    ] as const) {
      expect(deriveAttackCoinFlip(text)).toEqual({
        kind: "perHeads",
        flips: { kind: "untilTails" },
        per,
      });
    }
    expect(deriveAttackCoinFlip(RELENTLESS_FLAMES)).toHaveProperty("flips.kind", "untilTails");
    expect(deriveAttackCoinFlip(RELENTLESS_FLAMES)).not.toHaveProperty("flips.count");
    expect(deriveAttackCoinFlip(RELENTLESS_FLAMES)).not.toHaveProperty("flips.energy");
  });

  it("reads the ADDITIVE printing to bonusOnHeads/untilTails — the SAME count, the other member", () => {
    expect(deriveAttackCoinFlip(DAMAGE_RUSH)).toEqual({
      kind: "bonusOnHeads",
      flips: { kind: "untilTails" },
      per: 30,
    });
    // The two arms produce the SAME flip count and DIFFERENT members off one word.
    // Stated as an equality and an inequality on the same pair, so neither half can
    // be satisfied by accident.
    expect(deriveAttackCoinFlip(DAMAGE_RUSH)).toHaveProperty("flips.kind", "untilTails");
    expect(deriveAttackCoinFlip(RELENTLESS_FLAMES)).toHaveProperty("flips.kind", "untilTails");
    expect(deriveAttackCoinFlip(DAMAGE_RUSH)?.kind).not.toBe(
      deriveAttackCoinFlip(RELENTLESS_FLAMES)?.kind,
    );
  });

  it("carries NO PAYLOAD on the count — `untilTails` is one key wide", () => {
    for (const text of [RELENTLESS_FLAMES, EGG_ROLLING, DAMAGE_RUSH]) {
      const flip = deriveAttackCoinFlip(text);
      if (flip === null) throw new Error("unreachable");
      expect(Object.keys(flip).sort()).toEqual(["flips", "kind", "per"]);
      switch (flip.kind) {
        case "bonusOnHeads":
        case "perHeads":
        case "programPerHeads":
        case "perHeadsThenThreshold":
          expect(Object.keys(flip.flips)).toEqual(["kind"]);
          break;
        case "cancelOnTails":
        case "cancelOnTailsElseProgram":
          throw new Error("unreachable: all three subjects carry a printed flip count");
      }
      expect(flip).not.toHaveProperty("cond");
      expect(flip).not.toHaveProperty("count");
    }
  });

  it("derives off the card fixtures, not just the constants", () => {
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv01-030"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "perHeads", flips: { kind: "untilTails" }, per: 30 });
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv02-026"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "perHeads", flips: { kind: "untilTails" }, per: 30 });
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv01-139"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "perHeads", flips: { kind: "untilTails" }, per: 50 });
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv01-144"]?.attacks?.[EGG_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "perHeads", flips: { kind: "untilTails" }, per: 60 });
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv03-174"]?.attacks?.[FLIP_INDEX]?.effect ?? ""),
    ).toEqual({ kind: "bonusOnHeads", flips: { kind: "untilTails" }, per: 30 });
  });

  it("reads a per no card prints — the shape is PARAMETERISED, not four rows", () => {
    for (const per of [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 250]) {
      expect(
        deriveAttackCoinFlip(
          `${UNTIL_TAILS_OPENING}This attack does ${per} damage for each heads.`,
        ),
      ).toEqual({ kind: "perHeads", flips: { kind: "untilTails" }, per });
      expect(
        deriveAttackCoinFlip(
          `${UNTIL_TAILS_OPENING}This attack does ${per} more damage for each heads.`,
        ),
      ).toEqual({ kind: "bonusOnHeads", flips: { kind: "untilTails" }, per });
    }
  });
});

describe("the two new regexes are DISJOINT — from each other, and from all four siblings", () => {
  it("separates the arms by the word `more` — `(\\d+) damage` cannot span `30 more damage`", () => {
    expect(deriveAttackCoinFlip(DAMAGE_RUSH)?.kind).toBe("bonusOnHeads");
    expect(deriveAttackCoinFlip(RELENTLESS_FLAMES)?.kind).toBe("perHeads");
    // Deleting the one word turns the additive sentence into the multiply one, and
    // inserting it does the reverse. Two edits, two members, one flip count.
    expect(DAMAGE_RUSH.replace(" more", "")).toBe(RELENTLESS_FLAMES);
    expect(deriveAttackCoinFlip(DAMAGE_RUSH.replace(" more", ""))).toEqual(
      deriveAttackCoinFlip(RELENTLESS_FLAMES),
    );
    expect(deriveAttackCoinFlip(RELENTLESS_FLAMES.replace(" damage", " more damage"))).toEqual(
      deriveAttackCoinFlip(DAMAGE_RUSH),
    );
    // …and the `per` really is read from the digits either way, not defaulted from
    // the arm: 60 through the additive arm is a sentence no card prints and it still
    // reads 60.
    expect(
      deriveAttackCoinFlip(`${UNTIL_TAILS_OPENING}This attack does 60 more damage for each heads.`),
    ).toEqual({ kind: "bonusOnHeads", flips: { kind: "untilTails" }, per: 60 });
  });

  it("leaves the four D126/D127/D128 readings EXACTLY as they were", () => {
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
      deriveAttackCoinFlip(
        "Flip a coin for each {R} Energy attached to this Pokémon. This attack does 80 damage for each heads.",
      ),
    ).toEqual({ kind: "perHeads", flips: { kind: "attachedEnergy", energy: "Fire" }, per: 80 });
    const litwick = deriveAttackCoinFlip("Flip a coin. If heads, this attack does 10 more damage.");
    const bouffalant = deriveAttackCoinFlip(DAMAGE_RUSH);
    expect(litwick?.kind).toBe(bouffalant?.kind);
    expect(litwick).toHaveProperty("flips.kind", "printed");
    expect(bouffalant).toHaveProperty("flips.kind", "untilTails");
  });

  it("is refused by all four SIBLING READERS, and refuses a live sentence of each", () => {
    for (const sentence of [RELENTLESS_FLAMES, CONTINUOUS_SPIN, EGG_ROLLING, DAMAGE_RUSH]) {
      expect(deriveAttackEffect(sentence)).toBeNull();
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
      expect(deriveAttackRequirement(sentence)).toBeNull();
    }
    // The mirror, one live representative per family, so the nulls above are refusals
    // in both directions and not one reader being dead.
    const representatives = [
      // deriveAttackEffect — a plain status op.
      "Your opponent's Active Pokémon is now Paralyzed.",
      // deriveAttackDamageBonus — the additive "+" family on a count that reader
      // really does answer.
      "This attack does 10 more damage for each damage counter on this Pokémon.",
      "This attack does 50 damage for each Prize card your opponent has taken.",
      "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.",
    ];
    for (const sentence of representatives) {
      expect(deriveAttackCoinFlip(sentence)).toBeNull();
    }
    expect(deriveAttackEffect(representatives[0] ?? "")).not.toBeNull();
    expect(deriveAttackDamageBonus(representatives[1] ?? "")).not.toBeNull();
    expect(deriveAttackDamageMultiplier(representatives[2] ?? "")).not.toBeNull();
    expect(deriveAttackRequirement(representatives[3] ?? "")).not.toBeNull();
  });
});

describe("the two `For each heads` sentences — one BUILT at D463, one never printed", () => {
  it("D463 — [0] derives programPerHeads/untilTails; [1] stays NULL on every reader", () => {
    expect(deriveAttackCoinFlip(FOR_EACH_HEADS[0])).toEqual({
      kind: "programPerHeads",
      flips: { kind: "untilTails" },
      ops: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      face: "heads",
    });
    for (const sentence of FOR_EACH_HEADS) {
      // …and by nothing else in the family either, so what reads [0] is ONE reader and
      // what reads [1] is none.
      expect(deriveAttackEffect(sentence)).toBeNull();
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
      expect(deriveAttackRequirement(sentence)).toBeNull();
      // The opening really is the mapped one, so what separates the two is the CONSEQUENT
      // and not the `^` anchor.
      expect(sentence.startsWith(UNTIL_TAILS_OPENING)).toBe(true);
    }
    expect(deriveAttackCoinFlip(FOR_EACH_HEADS[1])).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip 3 coins. For each heads, discard a random card from your opponent's hand.",
      ),
    ).not.toBeNull();
    // …and swapping each one's consequent for the mapped one turns it into a sentence
    // this deriver reads, which is what makes the three nulls above a claim about
    // which half of the string was refused.
    for (const sentence of FOR_EACH_HEADS) {
      const swapped = `${UNTIL_TAILS_OPENING}This attack does 30 damage for each heads.`;
      expect(sentence.slice(0, UNTIL_TAILS_OPENING.length)).toBe(
        swapped.slice(0, UNTIL_TAILS_OPENING.length),
      );
      expect(deriveAttackCoinFlip(swapped)).not.toBeNull();
    }
  });

  it("D463 — FLIPS, announces every face, and STILL lands its flat 50 — Krookodile", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = krookodileActive(board(seed), "p1");
      const before = state.rngState;
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      // The attack WAS declared.
      expect(types(events)).toContain("ATTACK_DECLARED");
      // …and it is no longer on the loud path at all.
      expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      const [expectedFaces, expectedRng] = flipUntilTails(before, MAX_UNTIL_TAILS_FLIPS);
      const announced = all(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result);
      expect(announced).toEqual(expectedFaces);
      expect(announced.length).toBeGreaterThanOrEqual(1);
      expect(announced[announced.length - 1]).toBe("tails");
      expect(done.rngState).toBe(expectedRng);
      expect(done.rngState).not.toBe(before);
      // …and no Energy left the defender, because it had none to lose: the expansion ran
      // `announced.filter(heads).length` copies of an op whose candidate set was empty.
      expect(types(events)).not.toContain("ENERGY_DISCARDED");
      // The printed 50 lands unmodified (fix-titan has neither Weakness nor
      // Resistance), and the turn ends the ordinary way.
      expect(findEvent(events, "DAMAGE_DEALT")?.base).toBe(50);
      expect(findEvent(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
      expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(50);
      expect(activeDamage(done, "p2")).toBe(50);
      expect(types(events)).not.toContain("ATTACK_FAILED");
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(types(events)).toContain("TURN_ENDED");
    }
  });
});

describe("constructed near-misses stay LOUD", () => {
  it("refuses a printed ZERO per — the `per >= 1` guard every arm of the family carries", () => {
    expect(
      deriveAttackCoinFlip(`${UNTIL_TAILS_OPENING}This attack does 0 damage for each heads.`),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(`${UNTIL_TAILS_OPENING}This attack does 0 more damage for each heads.`),
    ).toBeNull();
    // …while the smallest REAL value one digit away is read fine on both.
    expect(
      deriveAttackCoinFlip(`${UNTIL_TAILS_OPENING}This attack does 1 damage for each heads.`),
    ).toEqual({ kind: "perHeads", flips: { kind: "untilTails" }, per: 1 });
    expect(
      deriveAttackCoinFlip(`${UNTIL_TAILS_OPENING}This attack does 1 more damage for each heads.`),
    ).toEqual({ kind: "bonusOnHeads", flips: { kind: "untilTails" }, per: 1 });
  });

  it("refuses `until you get HEADS` — the sentence that would never terminate the same way", () => {
    for (const text of [
      "Flip a coin until you get heads. This attack does 30 damage for each heads.",
      "Flip a coin until you get heads. This attack does 30 more damage for each heads.",
      "Flip a coin until you get tails. This attack does 30 damage for each tails.",
      "Flip a coin until you get tails. This attack does 30 more damage for each tails.",
    ]) {
      expect(deriveAttackCoinFlip(text)).toBeNull();
    }
    expect(
      "Flip a coin until you get tails. This attack does 30 damage for each tails.".startsWith(
        UNTIL_TAILS_OPENING,
      ),
    ).toBe(true);
  });

  it("refuses the anchor, casing, whitespace and SUFFIX rewrites — but trims outer space", () => {
    for (const text of [
      // Lowercase leading "flip" — the skeleton has no /i.
      "flip a coin until you get tails. This attack does 30 damage for each heads.",
      // Lowercase "this" one sentence later.
      "Flip a coin until you get tails. this attack does 30 damage for each heads.",
      // NO TRAILING PERIOD is not the whole sentence — the `$` sits after it.
      "Flip a coin until you get tails. This attack does 30 damage for each heads",
      "Flip a coin until you get tails. This attack does 30 more damage for each heads",
      // "!" for "." — the same one-character difference from the other side.
      "Flip a coin until you get tails. This attack does 30 damage for each heads!",
      "Flip a coin until you get tails This attack does 30 damage for each heads.",
      // The CONSEQUENT ALONE — the degenerate string a substring matcher would claim,
      // and the one `deriveAttackDamageMultiplier`'s family lives next door to.
      "This attack does 30 damage for each heads.",
      // The OPENING alone — an unbounded sequence with nothing to fold it into.
      "Flip a coin until you get tails.",
      // Leading text pins `^`.
      "Before doing damage, flip a coin until you get tails. This attack does 30 damage for each heads.",
      // A missing space after the first sentence — invisible in a diff.
      "Flip a coin until you get tails.This attack does 30 damage for each heads.",
      // An INTERIOR double space is not trimmable.
      "Flip a coin until you get tails.  This attack does 30 damage for each heads.",
      "Flip a coins until you get tails. This attack does 30 damage for each heads.",
      // "head" for "heads".
      "Flip a coin until you get tails. This attack does 30 damage for each head.",
      // A NON-BREAKING SPACE where an ASCII one is printed — the invisible drift.
      `Flip a coin until you get tails.${NBSP}This attack does 30 damage for each heads.`,
      "Flip a coin until you get tails. This attack does 30 damage for each heads. Your opponent's Active Pokémon is now Confused.",
      "Flip a coin until you get tails. This attack does 30 damage for each heads, and discard an Energy from this Pokémon.",
      "Flip a coin until you get tails. This attack does 30 more damage for each heads. If tails, this attack does nothing.",
    ]) {
      expect(deriveAttackCoinFlip(text)).toBeNull();
    }
    // Outer whitespace, by contrast, SURVIVES by design (the deriver trims), so this
    // pair states which drift is tolerated and which is not — on BOTH arms, because
    // the trim happens once and both arms have to benefit from it.
    expect(deriveAttackCoinFlip(`${RELENTLESS_FLAMES} `)).toEqual({
      kind: "perHeads",
      flips: { kind: "untilTails" },
      per: 30,
    });
    expect(deriveAttackCoinFlip(`  ${DAMAGE_RUSH}\n`)).toEqual({
      kind: "bonusOnHeads",
      flips: { kind: "untilTails" },
      per: 30,
    });
  });
});

describe("ZERO registry rows — the cards fold straight off their printed text", () => {
  it("has no ATTACK program for any of the five, authored or otherwise", () => {
    // The two multiply attackers and the deriver-only pair carry no registry entry at
    // all: the sentence IS the wiring.
    for (const id of ["sv01-030", "sv02-026", "sv01-139", "sv01-144"]) {
      expect(programFor(id)).toBeUndefined();
      expect(programFor(id)?.attack).toBeUndefined();
      expect(programFor(id)?.passive).toBeUndefined();
    }
    expect(programFor("sv03-174")).toBeDefined();
    expect(programFor("sv03-174")?.passive).toBeDefined();
    expect(programFor("sv03-174")?.attack).toBeUndefined();
    expect(programFor("sv01-117")).toBeUndefined();
    expect(programFor("swsh10.5-022")).toBeUndefined();
  });
});

describe("Growlithe — the MULTIPLY form: one row per face, and the base that must not leak", () => {
  it("announces the whole sequence IN ORDER and ends it in TAILS", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = growlitheActive(board(seed), "p1");
      const { events } = mustApply(state, { type: "attack", seat: "p1", index: FLIP_INDEX });
      const faces = facesIn(events);
      expect(faces.length).toBeGreaterThanOrEqual(1);
      // Every face but the last is heads, and the last is tails.
      expect(faces[faces.length - 1]).toBe("tails");
      expect(faces.slice(0, -1).every((f) => f === "heads")).toBe(true);
      // …stated the other way round too, so a sequence like ["tails", "heads"] (a
      // loop that kept going after its stop condition) fails here rather than passing
      // a heads count by luck.
      expect(faces.filter((f) => f === "tails")).toHaveLength(1);
      expect(faces.filter((f) => f === "heads")).toHaveLength(faces.length - 1);
      expect(headsIn(events)).toBe(faces.length - 1);
      for (const flip of all(events, "ATTACK_EFFECT_COIN_FLIP")) expect(flip.seat).toBe("p1");
      // The flips are announced BEFORE the damage they decided, in printed order.
      if (types(events).includes("DAMAGE_DEALT")) {
        expect(types(events).lastIndexOf("ATTACK_EFFECT_COIN_FLIP")).toBeLessThan(
          types(events).indexOf("DAMAGE_DEALT"),
        );
      }
    }
  });

  it("deals exactly 30 × heads with the printed base DROPPED — never 30 + 30 × heads", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = growlitheActive(board(seed), "p1");
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const heads = headsIn(events);
      seen.add(heads);
      expect(activeDamage(done, "p2")).toBe(30 * heads);
      // The total the printed base WOULD have produced, named as an absence.
      expect(activeDamage(done, "p2")).not.toBe(30 * heads + 30);
      const damage = findEvent(events, "DAMAGE_DEALT");
      if (heads === 0) {
        expect(damage).toBeUndefined();
        expect(activeDamage(done, "p2")).toBe(0);
      } else {
        expect(damage?.base).toBe(0);
        expect(damage?.scaled).toBe(30 * heads);
        expect(damage?.dealt).toBe(30 * heads);
        expect(damage?.weakness).toBeNull();
        expect(damage?.resistance).toBeNull();
      }
      // 340 HP is above the sweep's worst case, so every seed measures damage rather
      // than ending on a promotion.
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(types(events)).toContain("TURN_ENDED");
    }
    // The sweep reached 0 heads, which is the outcome the whole case rests on.
    expect(seen.has(0)).toBe(true);
  });

  it("deals exactly 60 × heads for CHANSEY — `per` is captured, not assumed", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const growlithe = mustApply(growlitheActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const chansey = mustApply(chanseyActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: EGG_INDEX,
      });
      // SAME BOARD, SAME rngState, SAME SEQUENCE — asserted, because the whole
      // comparison below depends on it.
      expect(facesIn(chansey.events)).toEqual(facesIn(growlithe.events));
      const heads = headsIn(chansey.events);
      seen.add(heads);
      expect(activeDamage(chansey.state, "p2")).toBe(60 * heads);
      expect(activeDamage(chansey.state, "p2")).not.toBe(60 * heads + 60);
      // …and it is TWICE Growlithe's on the same faces, which is what says the number
      // came off the sentence rather than out of the loop.
      expect(activeDamage(chansey.state, "p2")).toBe(
        2 * (activeDamage(growlithe.state, "p2") ?? 0),
      );
      expect(types(chansey.events)).not.toContain("KNOCKED_OUT");
    }
    expect(seen.has(0)).toBe(true);
  });

  it("leaves Chansey's OTHER attack completely alone — a flat 40, no flips, base kept", () => {
    const state = chanseyActive(board(0), "p1");
    const before = state.rngState;
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: POUND_INDEX,
    });
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(done.rngState).toBe(before);
    expect(findEvent(events, "DAMAGE_DEALT")?.base).toBe(40);
    // `scaled` is "present only when it applied", so its ABSENCE is the claim:
    // nothing was folded in front of Weakness at all.
    expect(findEvent(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
    expect(activeDamage(done, "p2")).toBe(40);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("Bouffalant — the ADDITIVE form: the printed base is KEPT", () => {
  it("deals 50 + 30 × heads, and 50 on the very first tails", () => {
    const seen = new Set<number>();
    let checkedZero = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = bouffalantActive(board(seed), "p1");
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const faces = facesIn(events);
      const heads = headsIn(events);
      seen.add(heads);
      expect(faces.length).toBeGreaterThanOrEqual(1);
      expect(faces[faces.length - 1]).toBe("tails");
      const damage = findEvent(events, "DAMAGE_DEALT");
      // THE PRINTED BASE IS KEPT — the assertion the whole member exists for.
      expect(damage?.base).toBe(50);
      expect(damage?.dealt).toBe(50 + 30 * heads);
      expect(activeDamage(done, "p2")).toBe(50 + 30 * heads);
      // …and the multiply arm's total is named as an absence, so "kept" is a claim
      // about this card rather than a number that happens to match.
      expect(activeDamage(done, "p2")).not.toBe(30 * heads);
      if (heads === 0) {
        checkedZero += 1;
        // THE EXPLICIT ZERO-HEADS CASE. One flip, tails, and the flat printed 50 —
        // which a `perHeads` reading would report as nothing at all.
        expect(faces).toEqual(["tails"]);
        expect(damage?.dealt).toBe(50);
        expect(activeDamage(done, "p2")).toBe(50);
        // `scaled` is present only when the attack's own extra actually landed, and
        // on this outcome it did not.
        expect(damage?.scaled).toBeUndefined();
        const growlithe = mustApply(growlitheActive(board(seed), "p1"), {
          type: "attack",
          seat: "p1",
          index: FLIP_INDEX,
        });
        expect(facesIn(growlithe.events)).toEqual(["tails"]);
        expect(findEvent(growlithe.events, "DAMAGE_DEALT")).toBeUndefined();
        expect(activeDamage(growlithe.state, "p2")).toBe(0);
      } else {
        // On every other outcome the bonus arrives through `scaled`, the same pre-W/R
        // channel the multiply arm's whole number arrives through — one channel for
        // "the attack's own extra", and the BASE is what differs between the members.
        expect(damage?.scaled).toBe(30 * heads);
      }
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(types(events)).not.toContain("ATTACK_FAILED");
      expect(types(events)).toContain("TURN_ENDED");
    }
    expect(checkedZero).toBeGreaterThanOrEqual(1);
    expect(seen.has(0)).toBe(true);
  });
});

describe("the rngState account — exactly the sequence, no more and no fewer steps", () => {
  it("recomputes every board's whole sequence with flipUntilTails, in order", () => {
    for (const [label, field, index] of [
      ["Growlithe (30×)", growlitheActive, FLIP_INDEX],
      ["Chansey (60×)", chanseyActive, EGG_INDEX],
      ["Bouffalant (50+)", bouffalantActive, FLIP_INDEX],
    ] as const) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const state = field(board(seed), "p1");
        const [faces, expected] = flipUntilTails(state.rngState, MAX_UNTIL_TAILS_FLIPS);
        const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index });
        expect(after.rngState, label).toBe(expected);
        expect(facesIn(events), label).toEqual(faces);
        expect(after.rngState, label).not.toBe(foldFlips(state.rngState, faces.length + 1)[1]);
        expect(after.rngState, label).not.toBe(foldFlips(state.rngState, faces.length - 1)[1]);
        // …and the two helpers agree, which is what lets the ±1 probes be stated in
        // terms of a counted fold at all.
        expect(foldFlips(state.rngState, faces.length)[1], label).toBe(expected);
      }
    }
  });

  it("does not double-flip with §8's CONFUSION check — the sequence rows are the ONLY ones", () => {
    for (const field of [growlitheActive, bouffalantActive]) {
      const state = field(board(5), "p1");
      expect(state.players.p1.active?.conditions.rotation).toBe("none");
      const { events } = mustApply(state, { type: "attack", seat: "p1", index: FLIP_INDEX });
      expect(types(events)).not.toContain("CONFUSION_CHECK");
      expect(facesIn(events)).toEqual(flipUntilTails(state.rngState, MAX_UNTIL_TAILS_FLIPS)[0]);
    }
  });
});

describe("outcome coverage — an unbounded fold has an unbounded outcome space", () => {
  it("sees 0, 1 and 2 heads across the sweep, and never an empty sequence", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { events } = mustApply(growlitheActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const faces = facesIn(events);
      expect(faces.length).toBeGreaterThanOrEqual(1);
      // …and the heads count is exactly one less than the length, always, because the
      // last face is the tails that stopped it.
      expect(headsIn(events)).toBe(faces.length - 1);
      seen.add(headsIn(events));
    }
    for (const heads of [0, 1, 2]) expect([...seen]).toContain(heads);
    expect(Math.max(...seen)).toBe(5);
  });
});

describe("modifierSimulated — no loud row on ANY outcome, on EITHER member", () => {
  it("emits NO ATTACK_EFFECT_SKIPPED across the whole sweep, on all three cards", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const growlithe = mustApply(growlitheActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      const chansey = mustApply(chanseyActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: EGG_INDEX,
      });
      const bouffalant = mustApply(bouffalantActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      expect(types(growlithe.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(chansey.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(bouffalant.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      seen.add(headsIn(growlithe.events));
    }
    expect(seen.has(0)).toBe(true);
    expect(deriveAttackCoinFlip(BALL_ROLL)).not.toBeNull();
    expect(deriveAttackCoinFlip(CONTINUOUS_SPIN)).not.toBeNull();
  });
});

describe("flipUntilTails — the TERMINATION ARGUMENT, which is this slice's real cost", () => {
  it("always ends in tails, and never approaches the cap, across a swept range", () => {
    let longest = 0;
    for (let state = 0; state < 2000; state += 1) {
      const [faces] = flipUntilTails(state, MAX_UNTIL_TAILS_FLIPS);
      expect(faces.length).toBeGreaterThanOrEqual(1);
      expect(faces[faces.length - 1]).toBe("tails");
      expect(faces.slice(0, -1).every((f) => f === "heads")).toBe(true);
      expect(faces.length).toBeLessThan(MAX_UNTIL_TAILS_FLIPS);
      longest = Math.max(longest, faces.length);
    }
    expect(longest).toBe(11);
    expect(longest).toBeLessThan(MAX_UNTIL_TAILS_FLIPS / 2);
  });

  it("TRUNCATES at a small cap — the one shape the guard would ever produce", () => {
    expect(flipUntilTails(0, MAX_UNTIL_TAILS_FLIPS)[0]).toEqual(["heads", "tails"]);
    const [capped1, after1] = flipUntilTails(0, 1);
    expect(capped1).toEqual(["heads"]);
    expect(capped1.every((f) => f === "heads")).toBe(true);
    expect(capped1[capped1.length - 1]).not.toBe("tails");
    expect(after1).toBe(flipCoin(0)[1]);
    expect(after1).toBe(foldFlips(0, 1)[1]);
    expect(after1).not.toBe(flipUntilTails(0, MAX_UNTIL_TAILS_FLIPS)[1]);

    // State 4 has TWO leading heads, so the same claim one length up: capped at two
    // it returns two heads and two steps, where its natural run is three faces.
    expect(flipUntilTails(4, MAX_UNTIL_TAILS_FLIPS)[0]).toEqual(["heads", "heads", "tails"]);
    const [capped2, after2] = flipUntilTails(4, 2);
    expect(capped2).toEqual(["heads", "heads"]);
    expect(capped2[capped2.length - 1]).not.toBe("tails");
    expect(after2).toBe(foldFlips(4, 2)[1]);
    expect(after2).not.toBe(flipUntilTails(4, MAX_UNTIL_TAILS_FLIPS)[1]);

    // A cap ABOVE the natural run does not truncate and does not over-draw — the
    // sequence stops at its tails and the cap is simply never reached, which is the
    // engine's own situation on every seed.
    for (const cap of [2, 3, 8, MAX_UNTIL_TAILS_FLIPS]) {
      expect(flipUntilTails(0, cap)).toEqual(flipUntilTails(0, MAX_UNTIL_TAILS_FLIPS));
    }
    for (const cap of [3, 4, 16, MAX_UNTIL_TAILS_FLIPS]) {
      expect(flipUntilTails(4, cap)).toEqual(flipUntilTails(4, MAX_UNTIL_TAILS_FLIPS));
    }
  });

  it("takes NO FLIP at all for a cap of zero or below, and advances nothing", () => {
    for (const state of [0, 1, 7, 123456, -5, -2147483648, 2147483647]) {
      for (const cap of [0, -1, -64]) {
        expect(flipUntilTails(state, cap)).toEqual([[], state]);
      }
      // …and a cap of ONE is the first that does anything, which is what makes the
      // zero above a boundary rather than a shrug.
      expect(flipUntilTails(state, 1)[0]).toHaveLength(1);
      expect(flipUntilTails(state, 1)[1]).not.toBe(state);
    }
  });

  it("agrees face-for-face with repeated flipCoin from the same state", () => {
    for (let state = 0; state < 500; state += 1) {
      const [faces, next] = flipUntilTails(state, MAX_UNTIL_TAILS_FLIPS);
      const [byHand, handNext] = foldFlips(state, faces.length);
      expect(byHand).toEqual(faces);
      expect(handNext).toBe(next);
      // …and one more `flipCoin` from the returned state is NOT part of the sequence,
      // which is what says the loop stopped where it said it did.
      expect(flipCoin(next)[1]).not.toBe(next);
      expect(foldFlips(state, faces.length + 1)[1]).not.toBe(next);
    }
  });

  it("pins MAX_UNTIL_TAILS_FLIPS at the MEASURED worst case, doubled", () => {
    expect(MAX_UNTIL_TAILS_FLIPS).toBe(64);
    expect(MAX_UNTIL_TAILS_FLIPS).toBeGreaterThan(31);
    expect(MAX_UNTIL_TAILS_FLIPS).toBe(2 * 32);
    // A ceiling chosen by feel would have been 10 or 20 — numbers a fair sequence
    // really does reach, and reaching one would TRUNCATE, which is a lie about the
    // game rather than a slow attack. Named as the thing this constant is not.
    expect(MAX_UNTIL_TAILS_FLIPS).toBeGreaterThan(20);
  });

  it("finds no run reaching the cap in a bounded scan of the state space", () => {
    let longest = 0;
    for (let state = 0; state < 400000; state += 1) {
      const [faces] = flipUntilTails(state, MAX_UNTIL_TAILS_FLIPS);
      if (faces.length > longest) longest = faces.length;
    }
    expect(longest).toBe(21);
    expect(longest).toBeLessThan(MAX_UNTIL_TAILS_FLIPS);
    expect(longest).toBeGreaterThan(20);
  });
});

describe("purity", () => {
  it("resolves every unbounded fold on a DEEP-FROZEN board", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      mustApply(deepFreeze(growlitheActive(board(seed), "p1")), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      mustApply(deepFreeze(chanseyActive(board(seed), "p1")), {
        type: "attack",
        seat: "p1",
        index: EGG_INDEX,
      });
      mustApply(deepFreeze(bouffalantActive(board(seed), "p1")), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
      mustApply(deepFreeze(krookodileActive(board(seed), "p1")), {
        type: "attack",
        seat: "p1",
        index: FLIP_INDEX,
      });
    }
    // …and `flipUntilTails` is a pure function of its two numbers: same inputs, same
    // faces and same state, and the array it hands back is a fresh one each time (so
    // a caller that mutated the sequence could not poison the next call).
    const [facesA, nextA] = flipUntilTails(4, MAX_UNTIL_TAILS_FLIPS);
    const [facesB, nextB] = flipUntilTails(4, MAX_UNTIL_TAILS_FLIPS);
    expect(facesA).toEqual(facesB);
    expect(nextA).toBe(nextB);
    expect(facesA).not.toBe(facesB);
    facesA.push("heads");
    expect(flipUntilTails(4, MAX_UNTIL_TAILS_FLIPS)[0]).toEqual(facesB);
    // …and the DERIVER is a pure function of its string, frozen board or not, on both
    // arms.
    expect(deriveAttackCoinFlip(RELENTLESS_FLAMES)).toEqual({
      kind: "perHeads",
      flips: { kind: "untilTails" },
      per: 30,
    });
    expect(deriveAttackCoinFlip(DAMAGE_RUSH)).toEqual({
      kind: "bonusOnHeads",
      flips: { kind: "untilTails" },
      per: 30,
    });
  });
});
