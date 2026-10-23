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
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { CoinFace, GameEvent, GameState, Seat } from "./index";
import { MAX_UNTIL_TAILS_FLIPS, flipCoin, flipUntilTails } from "./rng";
import {
  FIXTURE_POOL,
  PER_HEADS_PROGRAM_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  trimDeckTo,
  types,
  findEvent,
  headsIn,
} from "./testFixtures";

const UNDERSEA_TUNNEL =
  "Flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck.";

const WREAK_HAVOC =
  "Flip a coin until you get tails. For each heads, discard the top 2 cards of your opponent's deck.";

const FOR_EACH_HEADS_TAIL = "For each heads, discard the top ";

const DIG_A_LITTLE = "Flip a coin. If heads, discard the top card of your opponent's deck.";

const BUILT_AT_D525 = [
  "Flip 3 coins. Put a number of cards up to the number of heads from your discard pile into your hand.",
] as const;

const BUILT_AT_D528 = [
  "Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like.",
] as const;

const BUILT_AT_D476 = [
  "Flip 3 coins. For each tails, discard an Energy from this Pokémon.",
] as const;

const BUILT_AT_D463 = [
  "Flip 2 coins. For each heads, discard an Energy from your opponent's Active Pokémon.",
  "Flip a coin until you get tails. For each heads, discard an Energy from your opponent's Active Pokémon.",
] as const;

const NBSP = "\u00a0";

const RSQUO = "\u2019";

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

const TUNNEL_INDEX = 1;
const HEADBUTT_INDEX = 0;
const HAVOC_INDEX = 0;

/** The two mill counts, named because every delta assertion in the file is stated in
    terms of them and a hardcoded 3 would be indistinguishable from a hardcoded 2 on
    a one-heads outcome. */
const TUNNEL_MILL = 3;
const HAVOC_MILL = 2;

const SEEDS = 12;

function board(seed: number): GameState {
  let state = driveSetup(
    seed,
    { p1: PER_HEADS_PROGRAM_DECK, p2: PER_HEADS_PROGRAM_DECK },
    { first: "p2" },
  );
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return state;
}

/** Wugtrio in the seat's Active Spot with Undersea Tunnel's {C}{C}{C} paid.
    SURGERY: both attackers are Stage 1 and could never be dealt as an opening
    Active, so every case fields its own. */
function wugtrioActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv01-057"), seat, "fix-energy", 3);
}

function headbuttActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv01-057"), seat, "fix-water-energy", 1);
}

/** Gyarados in the seat's Active Spot with Wreak Havoc's single {C} paid. */
function gyaradosActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "swsh10.5-022"), seat, "fix-energy", 1);
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

/** The faces off the emitted rows, IN ORDER. */
function facesIn(events: GameEvent[]): CoinFace[] {
  return all(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result);
}

function milledUids(events: GameEvent[]): string[] {
  return all(events, "DECK_TOP_DISCARDED").flatMap((e) => e.uids);
}

describe("the printed sentences — the fixture-text-verbatim guards", () => {
  it("matches FIXTURE_POOL char-for-char for Wugtrio sv01-057", () => {
    const attack = FIXTURE_POOL["sv01-057"]?.attacks?.[TUNNEL_INDEX];
    expect(attack?.effect).toBe(UNDERSEA_TUNNEL);
    expect(attack?.name).toBe("Undersea Tunnel");
    // NO PRINTED DAMAGE AT ALL — asserted, because it is what makes `scaledBase`'s
    // "this member KEEPS the base" branch unobservable on any board and therefore
    // something the code has to get right from the rule rather than from a test.
    expect(attack?.damage).toBeUndefined();
    expect(attack?.cost).toEqual(["Colorless", "Colorless", "Colorless"]);
    // The flat control at index 0, and the reason TUNNEL_INDEX is 1 on this card: a
    // bare number with no effect and no modifier, on the same card and the same
    // board as the coin attack.
    expect(FIXTURE_POOL["sv01-057"]?.attacks?.[HEADBUTT_INDEX]?.name).toBe("Headbutt");
    expect(FIXTURE_POOL["sv01-057"]?.attacks?.[HEADBUTT_INDEX]?.damage).toBe(30);
    expect(FIXTURE_POOL["sv01-057"]?.attacks?.[HEADBUTT_INDEX]?.effect).toBeUndefined();
    expect(FIXTURE_POOL["sv01-057"]?.attacks).toHaveLength(2);
    expect(FIXTURE_POOL["sv01-057"]?.abilities).toBeNull();
  });

  it("matches FIXTURE_POOL char-for-char for Gyarados swsh10.5-022", () => {
    const attack = FIXTURE_POOL["swsh10.5-022"]?.attacks?.[HAVOC_INDEX];
    expect(attack?.effect).toBe(WREAK_HAVOC);
    expect(attack?.name).toBe("Wreak Havoc");
    expect(attack?.damage).toBeUndefined();
    expect(attack?.cost).toEqual(["Colorless"]);
    expect(FIXTURE_POOL["swsh10.5-022"]?.attacks).toHaveLength(2);
    expect(FIXTURE_POOL["swsh10.5-022"]?.abilities).toBeNull();
    expect(FIXTURE_POOL["swsh10.5-022"]?.attacks?.[1]?.name).toBe("Wild Splash");
    expect(FIXTURE_POOL["swsh10.5-022"]?.attacks?.[1]?.effect).toBe(
      "Discard the top 5 cards of your deck.",
    );
    expect(deriveAttackCoinFlip("Discard the top 5 cards of your deck.")).toBeNull();
    expect(deriveAttackEffect("Discard the top 5 cards of your deck.")).toEqual([
      { op: "discardDeckTop", whose: "self", count: 5 },
    ]);
  });

  it("keeps the card facts the boards are built on", () => {
    expect(FIXTURE_POOL["sv01-057"]?.name).toBe("Wugtrio");
    expect(FIXTURE_POOL["sv01-057"]?.stage).toBe("Stage1");
    expect(FIXTURE_POOL["sv01-057"]?.evolveFrom).toBe("Wiglett");
    expect(FIXTURE_POOL["sv01-057"]?.types).toEqual(["Water"]);
    expect(FIXTURE_POOL["sv01-057"]?.hp).toBe(90);

    expect(FIXTURE_POOL["swsh10.5-022"]?.name).toBe("Gyarados");
    expect(FIXTURE_POOL["swsh10.5-022"]?.stage).toBe("Stage1");
    expect(FIXTURE_POOL["swsh10.5-022"]?.evolveFrom).toBe("Magikarp");
    expect(FIXTURE_POOL["swsh10.5-022"]?.types).toEqual(["Water"]);
    expect(FIXTURE_POOL["swsh10.5-022"]?.hp).toBe(170);

    expect(FIXTURE_POOL["fix-titan"]?.attacks).toBeNull();
    expect(FIXTURE_POOL["fix-titan"]?.weaknesses).toBeNull();
    expect(FIXTURE_POOL["fix-titan"]?.resistances).toBeNull();
    expect(FIXTURE_POOL["fix-titan"]?.hp).toBe(340);
  });

  it("pins the BYTES — pure ASCII, an ASCII apostrophe, and ZERO U+2019", () => {
    expect(UNDERSEA_TUNNEL.length).toBe(78);
    expect(utf8Bytes(UNDERSEA_TUNNEL)).toBe(78);
    expect(WREAK_HAVOC.length).toBe(97);
    expect(utf8Bytes(WREAK_HAVOC)).toBe(97);
    for (const sentence of [UNDERSEA_TUNNEL, WREAK_HAVOC]) {
      // PURE ASCII, asserted over the characters rather than inferred from the equal
      // totals above (which a pair of compensating drifts could fake).
      expect([...sentence].filter((ch) => (ch.codePointAt(0) ?? 0) >= 128)).toEqual([]);
      expect(sentence).not.toContain("é");
      expect(sentence).not.toContain(NBSP); // the invisible drift
      expect(sentence).not.toContain("×"); // lives in `damage`, and neither card has one
      // THE APOSTROPHE IS ASCII U+0027 AND THERE IS EXACTLY ONE OF IT.
      expect(sentence).toContain("your opponent's deck");
      expect(sentence).not.toContain(RSQUO);
      expect([...sentence].filter((ch) => ch === "'")).toHaveLength(1);
      expect([...sentence].filter((ch) => ch === RSQUO)).toHaveLength(0);
      expect(RSQUO.codePointAt(0)).toBe(0x2019);
      // The shared CONSEQUENT, char-for-char — what the two regexes anchor on past
      // their different leading sentences.
      expect(sentence).toContain(FOR_EACH_HEADS_TAIL);
      expect(sentence.endsWith(" cards of your opponent's deck.")).toBe(true);
      // …and NEITHER says "This attack does", which is what keeps them off all five
      // of the folding arms.
      expect(sentence).not.toContain("This attack does");
      expect(sentence).not.toContain("damage");
      expect(sentence).toBe(sentence.trim());
    }
    // The two differ ONLY in the leading sentence and the count — stated as a
    // rewrite, so "one consequent, two flip counts" is an assertion and not a claim
    // in a comment.
    expect(UNDERSEA_TUNNEL.startsWith("Flip 3 coins. ")).toBe(true);
    expect(WREAK_HAVOC.startsWith("Flip a coin until you get tails. ")).toBe(true);
    expect(UNDERSEA_TUNNEL.slice(UNDERSEA_TUNNEL.indexOf(FOR_EACH_HEADS_TAIL))).toBe(
      WREAK_HAVOC.slice(WREAK_HAVOC.indexOf(FOR_EACH_HEADS_TAIL)).replace("top 2", "top 3"),
    );
  });

  it("pins Wiglett sv01-056's near-miss sentence too — the pre-evolution one card away", () => {
    expect(legalAttackCorpus().some(([, sentence]) => sentence === DIG_A_LITTLE)).toBe(false);
    // Not fielded (it is not in this deck) but pinned, because the refusal case below
    // is a claim about THIS string and a hand-typed near-miss nobody pinned is a
    // near-miss that can drift into agreement with the pattern.
    expect(DIG_A_LITTLE.length).toBe(68);
    expect(utf8Bytes(DIG_A_LITTLE)).toBe(68);
    expect(DIG_A_LITTLE).not.toContain(RSQUO);
    expect(DIG_A_LITTLE).toContain("the top card of your opponent's deck");
    expect(DIG_A_LITTLE).not.toContain("cards");
    expect(DIG_A_LITTLE.startsWith("Flip a coin. ")).toBe(true);
    expect(DIG_A_LITTLE.startsWith("Flip a coin until")).toBe(false);
    //   3. a GATE consequent ("If heads, …" — one flip, one conditional run) rather
    //      than a REPEAT ("For each heads, …" — N flips, N runs).
    expect(DIG_A_LITTLE).toContain("If heads,");
    expect(DIG_A_LITTLE).not.toContain(FOR_EACH_HEADS_TAIL);
    // …and it really is the same card LINE, which is what makes it the sharpest
    // near-miss available rather than a constructed one.
    expect(FIXTURE_POOL["sv01-057"]?.evolveFrom).toBe("Wiglett");
  });

  it("pins the TWO out-of-scope printings and the TWO D463 built — each in the CORPUS", () => {
    const corpus = new Map(legalAttackCorpus().map(([units, sentence]) => [sentence, units]));
    for (const sentence of [
      ...BUILT_AT_D528,
      ...BUILT_AT_D525,
      ...BUILT_AT_D476,
      ...BUILT_AT_D463,
    ]) {
      expect(sentence).toBe(sentence.trim());
      expect(sentence).not.toContain(RSQUO);
      expect(corpus.has(sentence), `not a corpus sentence: ${sentence}`).toBe(true);
      expect(sentence).not.toContain("cards of your opponent's deck");
      expect(sentence).not.toContain("card of your opponent's deck");
      expect(sentence).not.toContain("random card from your opponent's hand");
    }
    expect(BUILT_AT_D525.map((sentence) => corpus.get(sentence))).toEqual([2]);
    expect(BUILT_AT_D528.map((sentence) => corpus.get(sentence))).toEqual([1]);
    expect(BUILT_AT_D476.map((sentence) => corpus.get(sentence))).toEqual([1]);
    expect(BUILT_AT_D463.map((sentence) => corpus.get(sentence))).toEqual([1, 1]);

    expect(BUILT_AT_D476[0].length).toBe(66);
    expect(utf8Bytes(BUILT_AT_D476[0])).toBe(67);
    expect(BUILT_AT_D476[0]).toContain("For each tails,");
    expect(
      [...BUILT_AT_D528, ...BUILT_AT_D525, ...BUILT_AT_D476, ...BUILT_AT_D463].filter((s) =>
        s.includes("For each tails,"),
      ),
    ).toHaveLength(1);
    expect(BUILT_AT_D528[0].startsWith("Flip 3 coins. ")).toBe(true);
    expect(BUILT_AT_D528[0]).toContain("up to the number of heads");
    expect(BUILT_AT_D528[0]).not.toContain("For each heads");
    expect(deriveAttackCoinFlip(BUILT_AT_D528[0])?.kind).toBe("programPerHeads");
    expect(deriveAttackCoinFlip(BUILT_AT_D525[0])?.kind).toBe("retrievalUpToHeads");
    expect(BUILT_AT_D525[0].startsWith("Flip 3 coins. ")).toBe(true);
    expect(UNDERSEA_TUNNEL.startsWith("Flip 3 coins. ")).toBe(true);
    expect(BUILT_AT_D525[0]).not.toContain("For each heads");
    expect(BUILT_AT_D525[0].length).toBe(100);
    expect(BUILT_AT_D463[0].length).toBe(84);
    expect(utf8Bytes(BUILT_AT_D463[0])).toBe(85);
    expect(BUILT_AT_D463[0].startsWith("Flip 2 coins. For each heads, ")).toBe(true);
    expect(BUILT_AT_D463[1].length).toBe(103);
    expect(utf8Bytes(BUILT_AT_D463[1])).toBe(104);
    expect(BUILT_AT_D463[1]).toContain(FOR_EACH_HEADS_TAIL.slice(0, "For each heads, ".length));
    expect(BUILT_AT_D463[1].endsWith(BUILT_AT_D463[0].slice("Flip 2 coins. ".length))).toBe(true);
  });
});

describe("deriveAttackCoinFlip — ONE consequent, TWO flip counts, ZERO table rows", () => {
  it("reads Wugtrio to programPerHeads over a PRINTED count of 3", () => {
    expect(deriveAttackCoinFlip(UNDERSEA_TUNNEL)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 3 },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 3 }],
      face: "heads",
    });
    expect(deriveAttackCoinFlip(UNDERSEA_TUNNEL)?.kind).toBe("programPerHeads");
    expect(deriveAttackCoinFlip(UNDERSEA_TUNNEL)).not.toHaveProperty("per");
    expect(deriveAttackCoinFlip(UNDERSEA_TUNNEL)).toHaveProperty("flips.count", 3);
  });

  it("reads Gyarados to programPerHeads over an UNBOUNDED count — the SAME consequent", () => {
    expect(deriveAttackCoinFlip(WREAK_HAVOC)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "untilTails" },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 2 }],
      face: "heads",
    });
    expect(deriveAttackCoinFlip(WREAK_HAVOC)?.kind).toBe(
      deriveAttackCoinFlip(UNDERSEA_TUNNEL)?.kind,
    );
    const havoc = deriveAttackCoinFlip(WREAK_HAVOC);
    const tunnel = deriveAttackCoinFlip(UNDERSEA_TUNNEL);
    if (havoc?.kind !== "programPerHeads" || tunnel?.kind !== "programPerHeads") {
      throw new Error("expected two programPerHeads printings");
    }
    expect(havoc.flips).not.toEqual(tunnel.flips);
    expect(havoc.ops[0]?.op).toBe(tunnel.ops[0]?.op);
    expect(Object.keys(havoc.flips)).toEqual(["kind"]);
    expect(Object.keys(tunnel.flips).sort()).toEqual(["count", "kind"]);
  });

  it("derives off the card fixtures, not just the constants", () => {
    // The constants above are pinned to FIXTURE_POOL char-for-char, but reading the
    // derivation straight off the fixture is what proves the two never drifted apart
    // in the same edit.
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["sv01-057"]?.attacks?.[TUNNEL_INDEX]?.effect ?? ""),
    ).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 3 },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 3 }],
      face: "heads",
    });
    expect(
      deriveAttackCoinFlip(FIXTURE_POOL["swsh10.5-022"]?.attacks?.[HAVOC_INDEX]?.effect ?? ""),
    ).toEqual({
      kind: "programPerHeads",
      flips: { kind: "untilTails" },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 2 }],
      face: "heads",
    });
  });

  it("reads counts no card prints — the shape is PARAMETERISED, not two rows", () => {
    for (const flips of [2, 3, 4, 5, 10]) {
      for (const mill of [1, 2, 3, 7, 30]) {
        expect(
          deriveAttackCoinFlip(
            `Flip ${flips} coins. For each heads, discard the top ${mill} cards of your opponent's deck.`,
          ),
        ).toEqual({
          kind: "programPerHeads",
          flips: { kind: "printed", count: flips },
          ops: [{ op: "discardDeckTop", whose: "opponent", count: mill }],
          face: "heads",
        });
      }
    }
    for (const mill of [1, 2, 3, 7, 30]) {
      expect(
        deriveAttackCoinFlip(
          `Flip a coin until you get tails. For each heads, discard the top ${mill} cards of your opponent's deck.`,
        ),
      ).toEqual({
        kind: "programPerHeads",
        flips: { kind: "untilTails" },
        ops: [{ op: "discardDeckTop", whose: "opponent", count: mill }],
        face: "heads",
      });
    }
    // THE TWO NUMBERS ARE READ INDEPENDENTLY, stated on the one sentence where they
    // differ most: 2 flips milling 9 is not 9 flips milling 2.
    const swapped = deriveAttackCoinFlip(
      "Flip 2 coins. For each heads, discard the top 9 cards of your opponent's deck.",
    );
    expect(swapped).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 2 },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 9 }],
      face: "heads",
    });
    expect(swapped).not.toEqual(
      deriveAttackCoinFlip(
        "Flip 9 coins. For each heads, discard the top 2 cards of your opponent's deck.",
      ),
    );
  });

  it("leaves all five D126–D129 readings EXACTLY as they were", () => {
    expect(deriveAttackCoinFlip("Flip a coin. If heads, this attack does 10 more damage.")).toEqual(
      { kind: "bonusOnHeads", flips: { kind: "printed", count: 1 }, per: 10 },
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
    expect(
      deriveAttackCoinFlip(
        "Flip a coin until you get tails. This attack does 30 damage for each heads.",
      ),
    ).toEqual({ kind: "perHeads", flips: { kind: "untilTails" }, per: 30 });
    expect(
      deriveAttackCoinFlip(
        "Flip a coin until you get tails. This attack does 30 more damage for each heads.",
      ),
    ).toEqual({ kind: "bonusOnHeads", flips: { kind: "untilTails" }, per: 30 });
    expect(
      deriveAttackCoinFlip("Flip 3 coins. This attack does 30 damage for each heads.")?.kind,
    ).toBe("perHeads");
    expect(deriveAttackCoinFlip(UNDERSEA_TUNNEL)?.kind).toBe("programPerHeads");
  });
});

describe("deriver DISJOINTNESS — one reader owns each sentence", () => {
  it("returns NULL from all four sibling readers for both printings", () => {
    for (const sentence of [UNDERSEA_TUNNEL, WREAK_HAVOC]) {
      expect(deriveAttackEffect(sentence)).toBeNull();
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
      expect(deriveAttackRequirement(sentence)).toBeNull();
      expect(deriveAttackCoinFlip(sentence)).not.toBeNull();
    }
    // The mirror, one live representative per family, so the nulls above are refusals
    // in both directions and not one reader being dead.
    const representatives = [
      "Your opponent's Active Pokémon is now Paralyzed.",
      "This attack does 10 more damage for each damage counter on this Pokémon.",
      "This attack does 50 damage for each Prize card your opponent has taken.",
      "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.",
    ];
    for (const sentence of representatives) expect(deriveAttackCoinFlip(sentence)).toBeNull();
    expect(deriveAttackEffect(representatives[0] ?? "")).not.toBeNull();
    expect(deriveAttackDamageBonus(representatives[1] ?? "")).not.toBeNull();
    expect(deriveAttackDamageMultiplier(representatives[2] ?? "")).not.toBeNull();
    expect(deriveAttackRequirement(representatives[3] ?? "")).not.toBeNull();
  });

  it("keeps parseAttackDamage out of it — neither card prints a number to split", () => {
    expect(parseAttackDamage(FIXTURE_POOL["sv01-057"]?.attacks?.[TUNNEL_INDEX]?.damage)).toEqual({
      base: 0,
      modifier: null,
    });
    expect(parseAttackDamage(FIXTURE_POOL["swsh10.5-022"]?.attacks?.[HAVOC_INDEX]?.damage)).toEqual(
      { base: 0, modifier: null },
    );
    expect(parseAttackDamage(FIXTURE_POOL["sv01-057"]?.attacks?.[HEADBUTT_INDEX]?.damage)).toEqual({
      base: 30,
      modifier: null,
    });
  });
});

describe("constructed near-misses stay NULL", () => {
  it("refuses Wiglett sv01-056's real sentence — on the TWO counts D452 leaves it", () => {
    expect(deriveAttackCoinFlip(DIG_A_LITTLE)).toBeNull();
    // …and it is not quietly picked up by anything else either, so it stays on the
    // loud path rather than being half-resolved somewhere.
    expect(deriveAttackDamageBonus(DIG_A_LITTLE)).toBeNull();
    expect(deriveAttackDamageMultiplier(DIG_A_LITTLE)).toBeNull();
    expect(deriveAttackRequirement(DIG_A_LITTLE)).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip a coin. For each heads, discard the top card of your opponent's deck.",
      ),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip a coin. For each heads, discard the top 1 cards of your opponent's deck.",
      ),
    ).toBeNull();
    // COUNT 2 — THE GATE CONSEQUENT. Give it the plural flip count and leave "If
    // heads,", and it is still null on BOTH mill spellings.
    expect(
      deriveAttackCoinFlip("Flip 2 coins. If heads, discard the top card of your opponent's deck."),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. If heads, discard the top 1 cards of your opponent's deck.",
      ),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. For each heads, discard the top card of your opponent's deck.",
      ),
    ).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 2 },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 1 }],
      face: "heads",
    });
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. For each heads, discard the top 1 cards of your opponent's deck.",
      ),
    ).toEqual(
      deriveAttackCoinFlip(
        "Flip 2 coins. For each heads, discard the top card of your opponent's deck.",
      ),
    );
  });

  it("refuses `Flip 1 coins.` and `Flip 11 coins.` — the two printed-count guards", () => {
    expect(
      deriveAttackCoinFlip(
        "Flip 1 coins. For each heads, discard the top 3 cards of your opponent's deck.",
      ),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip 0 coins. For each heads, discard the top 3 cards of your opponent's deck.",
      ),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip 10 coins. For each heads, discard the top 3 cards of your opponent's deck.",
      ),
    ).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 10 },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 3 }],
      face: "heads",
    });
    expect(
      deriveAttackCoinFlip(
        "Flip 11 coins. For each heads, discard the top 3 cards of your opponent's deck.",
      ),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip 9999 coins. For each heads, discard the top 3 cards of your opponent's deck.",
      ),
    ).toBeNull();
    expect(deriveAttackCoinFlip(WREAK_HAVOC)).toHaveProperty("flips.kind", "untilTails");
  });

  it("refuses `discard the top 0 cards` — the mill count's own `>= 1` guard", () => {
    expect(
      deriveAttackCoinFlip(
        "Flip 3 coins. For each heads, discard the top 0 cards of your opponent's deck.",
      ),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip a coin until you get tails. For each heads, discard the top 0 cards of your opponent's deck.",
      ),
    ).toBeNull();
    // …while the smallest REAL value one digit away is read fine on both.
    expect(
      deriveAttackCoinFlip(
        "Flip 3 coins. For each heads, discard the top 1 cards of your opponent's deck.",
      ),
    ).toHaveProperty("ops", [{ op: "discardDeckTop", whose: "opponent", count: 1 }]);
    expect(
      deriveAttackCoinFlip(
        "Flip a coin until you get tails. For each heads, discard the top 1 cards of your opponent's deck.",
      ),
    ).toHaveProperty("ops", [{ op: "discardDeckTop", whose: "opponent", count: 1 }]);
  });

  it("is CASE SENSITIVE — there is no /i on either pattern", () => {
    expect(
      deriveAttackCoinFlip(
        "flip 3 Coins. For each heads, discard the top 3 cards of your opponent's deck.",
      ),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck.",
      ),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip 3 Coins. For each heads, discard the top 3 cards of your opponent's deck.",
      ),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip 3 coins. for each heads, discard the top 3 cards of your opponent's deck.",
      ),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip 3 coins. For each heads, Discard the top 3 cards of your opponent's deck.",
      ),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip(
        "flip a coin until you get tails. For each heads, discard the top 2 cards of your opponent's deck.",
      ),
    ).toBeNull();
  });

  it("refuses the anchor, punctuation and SUFFIX rewrites — but trims outer space", () => {
    for (const text of [
      // NO TRAILING PERIOD is not the whole sentence — the `$` sits after it.
      "Flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck",
      "Flip a coin until you get tails. For each heads, discard the top 2 cards of your opponent's deck",
      // "!" for "." — the same one-character difference from the other side.
      "Flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck!",
      // A missing period on the FIRST sentence, which is the half the two patterns
      // are told apart by.
      "Flip 3 coins For each heads, discard the top 3 cards of your opponent's deck.",
      // A missing COMMA after "For each heads", invisible at a glance.
      "Flip 3 coins. For each heads discard the top 3 cards of your opponent's deck.",
      "For each heads, discard the top 3 cards of your opponent's deck.",
      "Discard the top 2 cards of your opponent's deck.",
      "Discard the top card of your opponent's deck.",
      // The OPENING alone — flips with nothing to spend them on.
      "Flip 3 coins.",
      "Flip a coin until you get tails.",
      "Before doing damage, flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck.",
      // A missing space after the first sentence — invisible in a diff.
      "Flip 3 coins.For each heads, discard the top 3 cards of your opponent's deck.",
      // An INTERIOR double space is not trimmable.
      "Flip 3 coins.  For each heads, discard the top 3 cards of your opponent's deck.",
      // A NON-BREAKING SPACE where an ASCII one is printed.
      `Flip 3 coins.${NBSP}For each heads, discard the top 3 cards of your opponent's deck.`,
      "Flip 3 coin. For each heads, discard the top 3 cards of your opponent's deck.",
      "Flip a coins until you get tails. For each heads, discard the top 2 cards of your opponent's deck.",
      // "until you get HEADS" — a sentence that would never terminate the same way.
      "Flip a coin until you get heads. For each heads, discard the top 2 cards of your opponent's deck.",
      // "For each tails" — the opening is the mapped one verbatim, so this is refused
      // by the consequent, and reading it as heads would score every outcome upside
      // down (a sequence that ends in tails has exactly one).
      "Flip a coin until you get tails. For each tails, discard the top 2 cards of your opponent's deck.",
      // YOUR deck rather than your OPPONENT's — the op's deliberately-absent `whose:`
      // field, and a sentence the pool really prints (Gyarados's own "Wild Splash").
      "Flip 3 coins. For each heads, discard the top 3 cards of your deck.",
      "Flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck. Your opponent's Active Pokémon is now Confused.",
      "Flip a coin until you get tails. For each heads, discard the top 2 cards of your opponent's deck, and this attack does 30 damage.",
    ]) {
      expect(deriveAttackCoinFlip(text)).toBeNull();
    }
    // Outer whitespace, by contrast, SURVIVES by design (the deriver trims), so this
    // pair states which drift is tolerated and which is not — on BOTH arms, because
    // the trim happens once and both arms have to benefit from it.
    expect(deriveAttackCoinFlip(`${UNDERSEA_TUNNEL} `)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 3 },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 3 }],
      face: "heads",
    });
    expect(deriveAttackCoinFlip(`  ${WREAK_HAVOC}\n`)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "untilTails" },
      ops: [{ op: "discardDeckTop", whose: "opponent", count: 2 }],
      face: "heads",
    });
  });

  it("U0001f6d1 the `^` REALLY pins the front — a CAPITALISED leading clause, on both arms", () => {
    for (const prefix of [
      "Discard an Energy from this Pokémon. ",
      "Before doing damage, ",
      "Then, ",
    ]) {
      expect(
        deriveAttackCoinFlip(
          `${prefix}Flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck.`,
        ),
        prefix,
      ).toBeNull();
      expect(
        deriveAttackCoinFlip(
          `${prefix}Flip a coin until you get tails. For each heads, discard the top 2 cards of your opponent's deck.`,
        ),
        prefix,
      ).toBeNull();
    }
    // …and the unprefixed sentences still derive, which is what makes the six nulls a
    // fence rather than a regression.
    expect(deriveAttackCoinFlip(UNDERSEA_TUNNEL)).not.toBeNull();
    expect(deriveAttackCoinFlip(WREAK_HAVOC)).not.toBeNull();
  });

  it("ACCEPTS the U+2019 spelling of `opponent's` on both arms — the class, not a near-miss", () => {
    for (const straight of [UNDERSEA_TUNNEL, WREAK_HAVOC]) {
      const curly = straight.replace("opponent's", `opponent${RSQUO}s`);
      expect(curly).not.toBe(straight); // the rewrite actually fired
      expect(deriveAttackCoinFlip(curly)).toEqual(deriveAttackCoinFlip(straight));
      expect(deriveAttackCoinFlip(curly)).not.toBeNull();
    }
  });

  it("D525 — the last out-of-scope printing is BUILT: the coin reader derives `retrievalUpToHeads`, the four other readers STILL refuse it (the control), and a one-token near-miss is still refused by ALL", () => {
    for (const sentence of BUILT_AT_D525) {
      expect(resolvedByAnyReader(sentence), `not resolved: ${sentence}`).toBe(true);
      expect(deriveAttackCoinFlip(sentence)).toEqual({
        kind: "retrievalUpToHeads",
        flips: { kind: "printed", count: 3 },
        filter: { kind: "anyCard" },
        dest: "hand",
      });
      expect(deriveAttackEffect(sentence)).toBeNull();
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
      expect(deriveAttackRequirement(sentence)).toBeNull();
      // THE CONTROL: one token over (`deck` for `hand`) nothing reads it — false on the real
      // build, true under A2.
      const nearMiss = sentence.replace("into your hand.", "into your deck.");
      expect(nearMiss).not.toBe(sentence);
      expect(resolvedByAnyReader(nearMiss), `near-miss resolved: ${nearMiss}`).toBe(false);
      expect(deriveAttackCoinFlip(nearMiss)).toBeNull();
    }
    for (const built of BUILT_AT_D476) {
      expect(resolvedByAnyReader(built), built).toBe(true);
      expect(deriveAttackCoinFlip(built), built).toEqual({
        kind: "programPerHeads",
        flips: { kind: "printed", count: 3 },
        ops: [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } }],
        face: "tails",
      });
      expect(deriveAttackEffect(built), built).toBeNull();
      expect(deriveAttackDamageBonus(built), built).toBeNull();
      expect(deriveAttackDamageMultiplier(built), built).toBeNull();
      expect(deriveAttackRequirement(built), built).toBeNull();
    }
    for (const builtSentence of BUILT_AT_D463) {
      const opening = builtSentence.slice(0, builtSentence.indexOf("For each heads"));
      const asMill = deriveAttackCoinFlip(
        `${opening}For each heads, discard the top 2 cards of your opponent's deck.`,
      );
      const asEnergy = deriveAttackCoinFlip(builtSentence);
      expect(asEnergy, builtSentence).not.toBeNull();
      expect(JSON.stringify(asEnergy)).not.toBe(JSON.stringify(asMill));
      expect(asEnergy).toMatchObject({
        ops: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      });
      expect(JSON.stringify((asEnergy as { flips: unknown }).flips)).toBe(
        JSON.stringify((asMill as { flips: unknown } | null)?.flips),
      );
    }
    for (const refused of [BUILT_AT_D463[0], BUILT_AT_D463[1]]) {
      const head = refused.slice(0, refused.indexOf("For each heads"));
      expect(
        deriveAttackCoinFlip(
          `${head}For each heads, discard the top 2 cards of your opponent's deck.`,
        ),
      ).not.toBeNull();
    }
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. For each heads, discard the top card of your opponent's deck.",
      ),
    ).not.toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip 2 coins. For each heads, discard a random card from your opponent's hand.",
      ),
    ).not.toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip a coin until you get tails. For each heads, discard the top card of your opponent's deck.",
      ),
    ).not.toBeNull();
    expect(
      deriveAttackCoinFlip(
        "Flip a coin until you get tails. For each heads, discard a random card from your opponent's hand.",
      ),
    ).toBeNull();
  });
});

describe("ZERO registry rows — both cards mill straight off their printed text", () => {
  it("has no program of any kind for either id", () => {
    for (const id of ["sv01-057", "swsh10.5-022"]) {
      expect(programFor(id)).toBeUndefined();
      expect(programFor(id)?.attack).toBeUndefined();
      expect(programFor(id)?.passive).toBeUndefined();
      expect(programFor(id)?.attack?.[0]).toBeUndefined();
      expect(programFor(id)?.attack?.[1]).toBeUndefined();
    }
    expect(programFor("sv01-056")).toBeUndefined();
  });
});

describe("Wugtrio — the PRINTED count: 3 flips, one op per heads, 3 cards each", () => {
  it("announces exactly THREE rows and mills 3 × heads off the top, in order", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = wugtrioActive(board(seed), "p1");
      const deckBefore = [...state.players.p2.deck];
      const discardBefore = state.players.p2.discard.length;
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: TUNNEL_INDEX,
      });
      // ALWAYS THREE FLIPS. The printed count does not depend on the faces or on the
      // board, which is the whole difference from Gyarados below.
      expect(facesIn(events)).toHaveLength(3);
      const heads = headsIn(events);
      seen.add(heads);
      for (const flip of all(events, "ATTACK_EFFECT_COIN_FLIP")) expect(flip.seat).toBe("p1");

      const rows = all(events, "DECK_TOP_DISCARDED");
      expect(rows).toHaveLength(heads);
      for (const row of rows) {
        // THE SEAT IS THE VICTIM, not the actor: the event names the deck's OWNER.
        expect(row.seat).toBe("p2");
        expect(row.uids).toHaveLength(TUNNEL_MILL);
      }

      // THE CARDS CAME OFF THE TOP, IN ORDER — the strongest form of the claim, and
      // the one a count-only assertion cannot make.
      const milled = milledUids(events);
      expect(milled).toHaveLength(TUNNEL_MILL * heads);
      expect(milled).toEqual(deckBefore.slice(0, TUNNEL_MILL * heads));
      // …and they landed in the OPPONENT's discard pile, at its end, in that order.
      expect(done.players.p2.discard).toEqual([
        ...state.players.p2.discard,
        ...deckBefore.slice(0, TUNNEL_MILL * heads),
      ]);
      expect(done.players.p2.discard.length - discardBefore).toBe(TUNNEL_MILL * heads);

      expect(deckBefore.length - done.players.p2.deck.length).toBe(TUNNEL_MILL * heads + 1);
      expect(done.players.p2.hand).toContain(deckBefore[TUNNEL_MILL * heads]);
      expect(done.players.p2.deck).toEqual(deckBefore.slice(TUNNEL_MILL * heads + 1));

      // The ATTACKER's own deck and discard are untouched — the op is opponent-only,
      // and nothing about it reads or writes this side.
      expect(done.players.p1.discard).toEqual(state.players.p1.discard);

      expect(types(events)).not.toContain("DAMAGE_DEALT");
      expect(done.players.p2.active?.damage).toBe(0);
      expect(types(events)).not.toContain("ATTACK_FAILED");
      expect(types(events)).not.toContain("KNOCKED_OUT");
      expect(types(events)).toContain("TURN_ENDED");
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("orders the rows behind the flips that caused them", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const { events } = mustApply(wugtrioActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: TUNNEL_INDEX,
      });
      const order = types(events);
      if (!order.includes("DECK_TOP_DISCARDED")) continue;
      expect(order.lastIndexOf("ATTACK_EFFECT_COIN_FLIP")).toBeLessThan(
        order.indexOf("DECK_TOP_DISCARDED"),
      );
      // …and the whole mill sits inside the attack, before the turn ends.
      expect(order.lastIndexOf("DECK_TOP_DISCARDED")).toBeLessThan(order.indexOf("TURN_ENDED"));
    }
  });

  it("leaves Wugtrio's OTHER attack completely alone — a flat 30, no flips, no mill", () => {
    const state = headbuttActive(board(0), "p1");
    const before = state.rngState;
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: HEADBUTT_INDEX,
    });
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(done.rngState).toBe(before);
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(0);
    expect(done.players.p2.discard).toEqual(state.players.p2.discard);
    expect(findEvent(events, "DAMAGE_DEALT")?.base).toBe(30);
    expect(findEvent(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
    expect(done.players.p2.active?.damage).toBe(30);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("Gyarados — the UNBOUNDED count: the SAME op, a different number of runs", () => {
  it("announces a heads* + tails sequence and mills 2 × heads off the top, in order", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = gyaradosActive(board(seed), "p1");
      const deckBefore = [...state.players.p2.deck];
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: HAVOC_INDEX,
      });
      const faces = facesIn(events);
      // AT LEAST ONE FLIP, ALWAYS, and it ends in TAILS — the sequence's own shape is
      // the evidence that the loop terminated rather than being cut off at the cap.
      expect(faces.length).toBeGreaterThanOrEqual(1);
      expect(faces[faces.length - 1]).toBe("tails");
      expect(faces.slice(0, -1).every((f) => f === "heads")).toBe(true);
      const heads = headsIn(events);
      expect(heads).toBe(faces.length - 1);
      seen.add(heads);

      const rows = all(events, "DECK_TOP_DISCARDED");
      expect(rows).toHaveLength(heads);
      for (const row of rows) {
        expect(row.seat).toBe("p2");
        expect(row.uids).toHaveLength(HAVOC_MILL);
      }
      const milled = milledUids(events);
      expect(milled).toHaveLength(HAVOC_MILL * heads);
      expect(milled).toEqual(deckBefore.slice(0, HAVOC_MILL * heads));
      expect(done.players.p2.discard).toEqual([
        ...state.players.p2.discard,
        ...deckBefore.slice(0, HAVOC_MILL * heads),
      ]);
      expect(deckBefore.length - done.players.p2.deck.length).toBe(HAVOC_MILL * heads + 1);
      expect(types(events)).not.toContain("DAMAGE_DEALT");
      expect(types(events)).not.toContain("ATTACK_FAILED");
      expect(types(events)).toContain("TURN_ENDED");
    }
    // The unbounded arm's outcome space is a geometric tail, so this is a SUPERSET
    // claim: 0 was seen and something ≥ 2 was seen. An exact set would be a statement
    // about the seeds rather than about the shape.
    expect(seen.has(0)).toBe(true);
    expect([...seen].some((h) => h >= 2)).toBe(true);
  });

  it("mills a DIFFERENT number per heads than Wugtrio, off the same op", () => {
    // 2 against 3, read out of the two sentences by one shape. A build that hardcoded
    // either count would pass one card's whole block and fail the other's — and both
    // cards run on the same board here, so the comparison is exact.
    for (let seed = 0; seed < SEEDS; seed++) {
      const wug = mustApply(wugtrioActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: TUNNEL_INDEX,
      });
      const gya = mustApply(gyaradosActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: HAVOC_INDEX,
      });
      expect(milledUids(wug.events)).toHaveLength(TUNNEL_MILL * headsIn(wug.events));
      expect(milledUids(gya.events)).toHaveLength(HAVOC_MILL * headsIn(gya.events));
      for (const row of all(wug.events, "DECK_TOP_DISCARDED")) expect(row.uids).toHaveLength(3);
      for (const row of all(gya.events, "DECK_TOP_DISCARDED")) expect(row.uids).toHaveLength(2);
    }
  });
});

describe("the ZERO-HEADS outcome — nothing runs, and nothing is skipped either", () => {
  it("mills nothing, emits no row, and takes the existing NO-PROGRAM ending", () => {
    for (const [label, field, index, seed, flips] of [
      ["Wugtrio (3 printed flips)", wugtrioActive, TUNNEL_INDEX, 10, 3],
      ["Gyarados (until tails)", gyaradosActive, HAVOC_INDEX, 0, 1],
    ] as const) {
      const state = field(board(seed), "p1");
      const deckBefore = [...state.players.p2.deck];
      const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index });
      // The flips WERE taken and announced — a zero-heads attack still spends its
      // sequence, which is what separates it from an attack that never flipped.
      expect(facesIn(events), label).toHaveLength(flips);
      expect(headsIn(events), label).toBe(0);
      expect(
        facesIn(events).every((f) => f === "tails"),
        label,
      ).toBe(true);
      // ZERO ROWS — not one carrying an empty uid list.
      expect(all(events, "DECK_TOP_DISCARDED"), label).toHaveLength(0);
      // The deck and the discard are untouched by the ATTACK; the single missing deck
      // card is P2's own turn-start draw, and the discard is exactly as it was.
      expect(done.players.p2.discard, label).toEqual(state.players.p2.discard);
      expect(done.players.p2.deck, label).toEqual(deckBefore.slice(1));
      expect(types(events), label).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(events), label).not.toContain("ATTACK_FAILED");
      expect(types(events), label).not.toContain("DAMAGE_DEALT");
      expect(types(events), label).toContain("TURN_ENDED");
    }
  });
});

describe("modifierSimulated / effectSimulated — no loud row on ANY outcome", () => {
  it("emits NO ATTACK_EFFECT_SKIPPED across the whole sweep, on both cards", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const wug = mustApply(wugtrioActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: TUNNEL_INDEX,
      });
      const gya = mustApply(gyaradosActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: HAVOC_INDEX,
      });
      expect(types(wug.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(gya.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      seen.add(headsIn(wug.events));
    }
    expect(seen.has(0)).toBe(true);
  });
});

describe("outcome coverage — the sweep reaches the outcomes the cases rest on", () => {
  it("sees 0 heads and at least one ≥ 2 on BOTH cards inside SEEDS", () => {
    const wugtrio = new Set<number>();
    const gyarados = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      wugtrio.add(
        headsIn(
          mustApply(wugtrioActive(board(seed), "p1"), {
            type: "attack",
            seat: "p1",
            index: TUNNEL_INDEX,
          }).events,
        ),
      );
      gyarados.add(
        headsIn(
          mustApply(gyaradosActive(board(seed), "p1"), {
            type: "attack",
            seat: "p1",
            index: HAVOC_INDEX,
          }).events,
        ),
      );
    }
    expect(wugtrio.has(0)).toBe(true);
    expect([...wugtrio].some((h) => h >= 2)).toBe(true);
    expect(gyarados.has(0)).toBe(true);
    expect([...gyarados].some((h) => h >= 2)).toBe(true);
    // Wugtrio's outcome space IS bounded (3 flips), so its set can be pinned exactly
    // — and doing so is what says the printed count really is 3 and not 2 or 4.
    expect([...wugtrio].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(Math.max(...wugtrio)).toBe(3);
    // Gyarados's cannot be, and is asserted only where it is a fact about the shape:
    // it exceeds the printed arm's ceiling on this very sweep, which no bounded count
    // could do.
    expect(Math.max(...gyarados)).toBeGreaterThan(3);
  });
});

describe("the CLAMP — a deck shallower than the printed number", () => {
  it("discards the WHOLE deck, reports the short list, and does not throw", () => {
    const state = trimDeckTo(wugtrioActive(board(2), "p1"), "p2", 2);
    const deckBefore = [...state.players.p2.deck];
    const discardBefore = [...state.players.p2.discard];
    expect(deckBefore).toHaveLength(2);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: TUNNEL_INDEX,
    });
    expect(headsIn(events)).toBe(3);
    const rows = all(events, "DECK_TOP_DISCARDED");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.seat).toBe("p2");
    expect(rows[0]?.uids).toEqual(deckBefore);
    expect(rows[0]?.uids).toHaveLength(2);
    expect(done.players.p2.deck).toEqual([]);
    expect(done.players.p2.discard).toEqual([...discardBefore, ...deckBefore]);
  });

  it("clamps only the op that runs short — an earlier full one is unaffected", () => {
    const state = trimDeckTo(wugtrioActive(board(2), "p1"), "p2", 4);
    const deckBefore = [...state.players.p2.deck];
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: TUNNEL_INDEX,
    });
    expect(headsIn(events)).toBe(3);
    const rows = all(events, "DECK_TOP_DISCARDED");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.uids).toEqual(deckBefore.slice(0, 3));
    expect(rows[1]?.uids).toEqual(deckBefore.slice(3, 4));
    expect(milledUids(events)).toEqual(deckBefore);
    expect(done.players.p2.deck).toEqual([]);
  });

  it("does NOT end the game at the mill — the loss is owed to the DRAW STEP", () => {
    const state = trimDeckTo(wugtrioActive(board(2), "p1"), "p2", 2);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: TUNNEL_INDEX,
    });
    const order = types(events);
    const over = findEvent(events, "GAME_OVER");
    expect(over?.outcome).toEqual({ result: "win", winner: "p1", reason: "deckOut" });
    // THE ORDER IS THE ASSERTION.
    expect(order.indexOf("DECK_TOP_DISCARDED")).toBeLessThan(order.indexOf("TURN_ENDED"));
    expect(order.indexOf("TURN_ENDED")).toBeLessThan(order.indexOf("TURN_STARTED"));
    expect(order.indexOf("TURN_STARTED")).toBeLessThan(order.indexOf("GAME_OVER"));
    expect(order.lastIndexOf("CARDS_DRAWN")).toBeLessThan(order.indexOf("TURN_ENDED"));
    expect(done.players.p2.deck).toEqual([]);
    // The mill itself reported only the cards it moved; it neither knew nor said
    // anything about the deck being empty afterwards.
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(1);
  });

  it("mills an ALREADY-EMPTY deck silently — no row, no throw, no game over yet", () => {
    const state = trimDeckTo(wugtrioActive(board(2), "p1"), "p2", 0);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: TUNNEL_INDEX,
    });
    expect(headsIn(events)).toBe(3);
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(0);
    expect(done.players.p2.discard).toEqual(state.players.p2.discard);
    const order = types(events);
    expect(order.indexOf("TURN_STARTED")).toBeLessThan(order.indexOf("GAME_OVER"));
    expect(findEvent(events, "GAME_OVER")?.outcome).toEqual({
      result: "win",
      winner: "p1",
      reason: "deckOut",
    });
  });
});

describe("the rngState account — exactly the sequence, no more and no fewer steps", () => {
  it("recomputes both boards' whole face sequence, in order", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const wugState = wugtrioActive(board(seed), "p1");
      const [wugFaces, wugAfter] = foldFlips(wugState.rngState, 3);
      const wug = mustApply(wugState, { type: "attack", seat: "p1", index: TUNNEL_INDEX });
      expect(wug.state.rngState).toBe(wugAfter);
      expect(facesIn(wug.events)).toEqual(wugFaces);
      // ONE MORE STEP would have landed here, and one FEWER here — so this is a claim
      // about the LENGTH of the sequence and not just about a number.
      expect(wug.state.rngState).not.toBe(foldFlips(wugState.rngState, 4)[1]);
      expect(wug.state.rngState).not.toBe(foldFlips(wugState.rngState, 2)[1]);

      const gyaState = gyaradosActive(board(seed), "p1");
      const [gyaFaces, gyaAfter] = flipUntilTails(gyaState.rngState, MAX_UNTIL_TAILS_FLIPS);
      const gya = mustApply(gyaState, { type: "attack", seat: "p1", index: HAVOC_INDEX });
      expect(gya.state.rngState).toBe(gyaAfter);
      expect(facesIn(gya.events)).toEqual(gyaFaces);
      expect(gya.state.rngState).not.toBe(foldFlips(gyaState.rngState, gyaFaces.length + 1)[1]);
      expect(gya.state.rngState).not.toBe(foldFlips(gyaState.rngState, gyaFaces.length - 1)[1]);
      // …and the two helpers agree on the unbounded run, which is what lets the ±1
      // probes above be stated in terms of a counted fold at all.
      expect(foldFlips(gyaState.rngState, gyaFaces.length)[1]).toBe(gyaAfter);
    }
  });

  it("spends the same steps whatever the mill DOES — a clamped run costs no more", () => {
    const full = wugtrioActive(board(2), "p1");
    const clamped = trimDeckTo(full, "p2", 2);
    const empty = trimDeckTo(full, "p2", 0);
    const [, expected] = foldFlips(full.rngState, 3);
    for (const state of [full, clamped, empty]) {
      const { state: after } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: TUNNEL_INDEX,
      });
      expect(after.rngState).toBe(expected);
    }
  });

  it("does not double-flip with §8's CONFUSION check", () => {
    // The two flips live at the same site, one gate apart, and the confusion one is
    // the older. An UNCONFUSED attacker must never emit its event and never consume
    // its step, so the rows in the list are the attack's own.
    for (const [field, index] of [
      [wugtrioActive, TUNNEL_INDEX],
      [gyaradosActive, HAVOC_INDEX],
    ] as const) {
      const state = field(board(5), "p1");
      expect(state.players.p1.active?.conditions.rotation).toBe("none");
      const { events } = mustApply(state, { type: "attack", seat: "p1", index });
      expect(types(events)).not.toContain("CONFUSION_CHECK");
    }
  });
});

describe("purity", () => {
  it("resolves both printings on a DEEP-FROZEN board, at every outcome", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      mustApply(deepFreeze(wugtrioActive(board(seed), "p1")), {
        type: "attack",
        seat: "p1",
        index: TUNNEL_INDEX,
      });
      mustApply(deepFreeze(gyaradosActive(board(seed), "p1")), {
        type: "attack",
        seat: "p1",
        index: HAVOC_INDEX,
      });
    }
    mustApply(deepFreeze(trimDeckTo(wugtrioActive(board(2), "p1"), "p2", 2)), {
      type: "attack",
      seat: "p1",
      index: TUNNEL_INDEX,
    });
    mustApply(deepFreeze(trimDeckTo(wugtrioActive(board(2), "p1"), "p2", 0)), {
      type: "attack",
      seat: "p1",
      index: TUNNEL_INDEX,
    });
    const first = deriveAttackCoinFlip(UNDERSEA_TUNNEL);
    const second = deriveAttackCoinFlip(UNDERSEA_TUNNEL);
    expect(first).toEqual(second);
    if (first?.kind !== "programPerHeads" || second?.kind !== "programPerHeads") {
      throw new Error("expected two programPerHeads printings");
    }
    expect(first.ops).not.toBe(second.ops);
    first.ops.push({ op: "shuffleDeck" });
    expect(deriveAttackCoinFlip(UNDERSEA_TUNNEL)).toEqual(second);
  });
});
