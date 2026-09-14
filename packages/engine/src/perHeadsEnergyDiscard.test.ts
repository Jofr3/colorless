import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  deriveAttackRequirement,
} from "./effects";
import { applyAction, createGame, engineVersion, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.361.0 → 0.362.0 — 🆕🆕 D463: THE PER-HEADS CONSEQUENT THAT PARKS.
//
//   line 200 (1 printing)  "Flip 2 coins. For each heads, discard an Energy from
//                           your opponent's Active Pokémon."
//   line 234 (1 printing)  "Flip a coin until you get tails. For each heads,
//                           discard an Energy from your opponent's Active Pokémon."
//                          — Krookodile sv01-117 "Chomp Chomp Bite".
//
// 🛑 **THE REFUSAL THIS SLICE OVERTURNS WAS A COST WEARING A CAPABILITY'S CLOTHES,
// AND IT SURVIVED THREE SLICES THAT ALL QUOTED IT.** D130 wrote that N sequential
// parks are *"the one thing D130's expansion cannot express"*. The code never said
// that: `resumeProgram` ends in `runProgram(applied, rest, …)`, so an op in `rest`
// that parks simply parks again, and the expansion puts its copies in `rest` like any
// other program. D423 corrected it in prose, D452 disproved it EXECUTABLY (its §9
// builds the two-op program by hand and shows the second copy sitting in `cont.rest`)
// — and the arrays in four files went on asserting the sentence was unreadable for
// another eleven decisions, because the correction and the assertion lived in
// different files. **A refusal is only as retired as its most confident test.**
//
// 🛑 **AND THE REFUSAL GROUPED THREE ROWS UNDER ONE REASON.** D452's `OUT_OF_SCOPE`
// held corpus lines 200, 217 and 234 with `discardEnergy` PARKS as the shared count.
// Two of the three are built here; the third (line 217) was never refused for that
// reason at all — it is a FACE axis (`For each TAILS`), which no amount of parking
// work would have touched. **Read a refusal that groups N rows under one reason as N
// refusals until each has been priced separately**, because the group's reason is the
// reason of its cheapest member and its cost is the cost of its dearest.
//
// ⚠️ **ZERO NEW MECHANISM, MEASURED RATHER THAN CLAIMED.** No new `EffectOp` member,
// no new op FIELD, no new op VALUE, no new `AttackCoinFlip` member, no new reader (the
// surface stands still at 13, asserted in §4), no prompt, no event, no error code, no
// registry row, no FIXTURE_POOL id, no `packages/schema` byte and no `redact.ts` byte.
// TWO regexes and TWO arms in `deriveAttackCoinFlip`, over the `programPerHeads` member
// D130 shipped and the `discardEnergy` op D43 shipped.
//
// 🛑 **N COPIES OF A COUNTLESS OP, AND THE ORDER OF EVENTS SETTLES IT RATHER THAN
// TASTE.** A reader might have emitted ONE `discardEnergy` carrying `count: heads`.
// It cannot: `ops` is fixed at DERIVE time and the heads count does not exist until
// the flip site runs, so there is no N to put in the field. The expansion is the only
// place the number can live — and it is also the right reading, because N independent
// picks out of a set that SHRINKS between them is what the card says.
//
// ⚠️ **THE PRINTED-COUNT CARRIER IS SYNTHETIC AND SAID SO (D425).** Corpus line 200
// has 1 legal printing and this checkout has no D1, so the card that prints it is
// UNRESOLVABLE here and is not invented. `fix-perheads-energy` is a local `fix-*` key
// with no catalog row behind it; the STRING is the corpus row byte for byte (§1).
// Line 234's carrier IS resolved and IS fielded — Krookodile sv01-117, whose
// end-to-end case lives in `untilTailsFlip.test.ts` and was re-pointed there (D418).

/** Corpus FILE LINE 200, byte for byte. ⚠️ The apostrophe is ASCII U+0027 and the `é`
    is U+00E9 — asserted in §1 off the corpus rather than eyeballed. */
const PRINTED_TWO =
  "Flip 2 coins. For each heads, discard an Energy from your opponent's Active Pokémon.";

/** Corpus FILE LINE 234, byte for byte — Krookodile sv01-117 "Chomp Chomp Bite". The
    SAME consequent as `PRINTED_TWO` over D129's unbounded flip count. */
const UNTIL_TAILS =
  "Flip a coin until you get tails. For each heads, discard an Energy from your opponent's Active Pokémon.";

/** D43's BARE sentence — the one `deriveAttackEffect` claims, and the one whose op
    both anchors above put in `programPerHeads.ops`. It is the reason the two new
    patterns need their `^`: both of this slice's sentences END in these exact words
    apart from the capital. */
const BARE = "Discard an Energy from your opponent's Active Pokémon.";

/** The plain control attack's absent effect, spelled as a name rather than a string:
    an attack with NO effect text at all is the one-axis control that says the coin
    rows below come from the sentence and not from the declaration. */
const PLAIN = 1;
const REPEAT = 0;

/** `fix-*` keys with no catalog row behind them (D425). The demonstrator prints the
    corpus row at index 0 and NOTHING at index 1, and prints no `damage` field at all —
    exactly as corpus line 200's real carrier would have to, since the sentence claims
    the whole printing and leaves `deriveAttackEffect` nothing. */
const LOCAL_CARDS: Record<string, Card> = {
  "fix-perheads-energy": battler("fix-perheads-energy", {
    types: ["Colorless"],
    hp: 320,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Twin Bite", effect: PRINTED_TWO },
      { cost: ["Colorless"], name: "Plain Slap" },
    ],
  }),
  /** 320 HP, no attacks — the victim and the bench filler. Nothing in this suite deals
      damage at all, so it exists to keep every promotion forced and every board legal
      rather than to survive anything. */
  "fix-perheads-victim": battler("fix-perheads-victim", {
    types: ["Colorless"],
    hp: 320,
    retreat: 1,
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its own deck (D270), 60 counted before the first run: 12 + 24 + 8 + 8 + 8. THREE
    DIFFERENT Energy cards, and that is the whole point of the list: a park at a single
    class of interchangeable candidates AUTO-RESOLVES (the M1 doctrine), so a defender
    holding three of one card would prove nothing about parking. Three DISTINCT classes
    give a genuine choice at the first pick and still a genuine one at the second. */
const PER_HEADS_ENERGY_DECK = deckOf({
  "fix-perheads-energy": 12,
  "fix-perheads-victim": 24,
  "fix-energy": 8,
  "fix-water-energy": 8,
  "fix-fire-energy": 8,
});

/** How many seeds every sweep walks. Wide enough that a 2-flip attack reaches 0, 1 and
    2 heads — asserted in §5 rather than hoped for. */
const SEEDS = 40;

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function headsIn(events: GameEvent[]): number {
  return all(events, "ATTACK_EFFECT_COIN_FLIP").filter((e) => e.result === "heads").length;
}

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: PER_HEADS_ENERGY_DECK, p2: PER_HEADS_ENERGY_DECK },
    cardPool: POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** p1 owns TURN 2 with the demonstrator Active and one {C} attached; p2 goes first and
    ends turn 1 immediately (§4 forbids the going-first player's turn-1 attack). p2's
    Active carries `energies` DISTINCT Energy cards and its bench holds one body, so any
    promotion is FORCED and no case can end on an unanswered promotion prompt. */
function armed(seed: number, energies: number): GameState {
  let state = localSetup(seed, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, "p1", "fix-perheads-energy");
  state = setActiveFromDeck(state, "p2", "fix-perheads-victim");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  const kinds = ["fix-energy", "fix-water-energy", "fix-fire-energy"] as const;
  for (let i = 0; i < energies; i += 1) {
    const card = kinds[i];
    if (card === undefined) throw new Error("at most three distinct Energy are stocked");
    state = attachFromDeck(state, "p2", card, 1);
  }
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-perheads-victim");
  return state;
}

function attack(state: GameState, index: number) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

function discardPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
  return state.phase.prompt;
}

function activeEnergy(state: GameState, seat: Seat): string[] {
  return [...(state.players[seat].active?.energy ?? [])];
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE POPULATION, MEASURED OFF THE COMMITTED COLUMN.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — two sentences, two printings, and the family re-enumerated", () => {
  it("both are corpus rows at ONE legal printing each", () => {
    const corpus = new Map(legalAttackCorpus().map(([units, sentence]) => [sentence, units]));
    expect(corpus.get(PRINTED_TWO)).toBe(1);
    expect(corpus.get(UNTIL_TAILS)).toBe(1);
    // ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE HERE, 2 AND 2** — which is the
    // opposite of D461 (2 and 4) and D462 (1 and 2). Said out loud because the last two
    // slices both paid for the disagreement, and a pass that carried their habit forward
    // would put a 4 where every site wants a 2.
    expect([PRINTED_TWO, UNTIL_TAILS].map((s) => corpus.get(s))).toEqual([1, 1]);
  });

  it("the bytes are the corpus's bytes, not a retyping", () => {
    // 🛑 D452's LESSON, PAID BY ITS OWN SIBLING FILE: a byte pin on a hand-typed string
    // is green by construction. `untilTailsFlip.test.ts` carried a 97-character invented
    // sentence for 322 decisions with a green `.length` assertion beside it. So the pins
    // below are taken against the CORPUS ROW and not against a literal in this file.
    const corpus = legalAttackCorpus().map(([, sentence]) => sentence);
    const printed = corpus.find((s) => s.startsWith("Flip 2 coins. For each heads, discard an"));
    const until = corpus.find((s) => s.startsWith("Flip a coin until you get tails. For each heads, discard an"));
    expect(printed).toBe(PRINTED_TWO);
    expect(until).toBe(UNTIL_TAILS);
    // ASCII apostrophe, U+00E9 for the accent — the two characters a re-ingest would move.
    expect(PRINTED_TWO).toContain("opponent's");
    expect(PRINTED_TWO).not.toContain("’");
    expect(PRINTED_TWO).toContain("Pokémon");
    expect(PRINTED_TWO).toHaveLength(84);
    expect(UNTIL_TAILS).toHaveLength(103);
    // The consequents are BYTE-IDENTICAL and the openings are all that differ, which is
    // what makes two anchors the honest shape rather than one loose one.
    const tail = "For each heads, discard an Energy from your opponent's Active Pokémon.";
    expect(PRINTED_TWO.endsWith(tail)).toBe(true);
    expect(UNTIL_TAILS.endsWith(tail)).toBe(true);
    expect(PRINTED_TWO.slice(0, -tail.length)).toBe("Flip 2 coins. ");
    expect(UNTIL_TAILS.slice(0, -tail.length)).toBe("Flip a coin until you get tails. ");
  });

  it("🛑 the whole per-face family, RE-ENUMERATED, and NOTHING is left unbuilt", () => {
    // The same filter D452's §1 used, run again after this slice: every corpus sentence
    // matching /For each (heads|tails),/ that is not a "This attack does" fold. FIVE
    // rows, ONE printing each — D452 built two, D463 built two, and 🆕🆕 **D476 built the
    // fifth, so the printed per-face CONSEQUENT family is CLOSED.**
    const perFace = legalAttackCorpus().filter(
      ([, s]) => /For each (heads|tails),/.test(s) && !s.includes("This attack does"),
    );
    expect(perFace).toHaveLength(5);
    expect(perFace.reduce((n, [units]) => n + units, 0)).toBe(5);
    const unbuilt = perFace.filter(([, s]) => !resolvedByAnyReader(s));
    expect(unbuilt.map(([, s]) => s)).toEqual([]);
    // 🛑 **AND THE ROW THAT LEFT LAST DID NOT LEAVE ON THIS SLICE'S REASON, WHICH IS THE
    // POINT THE OLD RUNG WAS MAKING AND IS KEPT INVERTED RATHER THAN DELETED (D418).** It
    // was grouped with these two under "`discardEnergy` PARKS" and that was never why: the
    // park was shipped HERE at D463 and the row stayed unbuilt for twenty-four decisions
    // afterwards, refused by a FACE axis instead. So the executable form of the distinction
    // is no longer "still unbuilt" but "built through a DIFFERENT field": all five rows
    // resolve, and the one that counts tails is the only one whose reading carries
    // `face: "tails"`.
    const tails = perFace.filter(([, s]) => s.includes("For each tails,"));
    expect(tails.map(([, s]) => s)).toEqual([
      "Flip 3 coins. For each tails, discard an Energy from this Pokémon.",
    ]);
    for (const [, s] of perFace) {
      const read = deriveAttackCoinFlip(s);
      expect(read, s).not.toBeNull();
      expect((read as { face: string }).face, s).toBe(
        s.includes("For each tails,") ? "tails" : "heads",
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE DERIVER: two anchors, their guards, and the crossings they refuse.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the anchors derive their own literals", () => {
  it("each sentence derives the exact reading", () => {
    expect(deriveAttackCoinFlip(PRINTED_TWO)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 2 },
      ops: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      face: "heads",
    });
    expect(deriveAttackCoinFlip(UNTIL_TAILS)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "untilTails" },
      ops: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      face: "heads",
    });
  });

  it("🛑 the op is D43's op, byte for byte, and not a second spelling of it", () => {
    // The whole no-new-vocabulary claim in one assertion: the op the coin member carries
    // is the SAME JSON the bare sentence's reader produces. Two producers agreeing on one
    // printed consequent BY CONSTRUCTION rather than by coincidence (the argument D361
    // makes about Mawile's Ability and the attack twin, applied to a third producer).
    const bare = JSON.stringify(deriveAttackEffect(BARE));
    expect(bare).toBe(
      '[{"op":"discardEnergy","from":"opponentActive","filter":{"kind":"anyEnergy"}}]',
    );
    for (const sentence of [PRINTED_TWO, UNTIL_TAILS]) {
      const read = deriveAttackCoinFlip(sentence) as { ops: unknown[] };
      expect(JSON.stringify(read.ops)).toBe(bare);
    }
  });

  it("the PRINTED arm carries the family's two flip guards and nothing else", () => {
    // `flips >= 2`, because the regex's own "coins" is PLURAL and the one-flip form is
    // printed "Flip a coin." (D126's gate, a different member at a different site).
    expect(deriveAttackCoinFlip(PRINTED_TWO.replace("Flip 2 coins.", "Flip 1 coins."))).toBeNull();
    expect(deriveAttackCoinFlip(PRINTED_TWO.replace("Flip 2 coins.", "Flip 0 coins."))).toBeNull();
    // `flips <= MAX_PRINTED_FLIPS` (10), because the digits come out of third-party
    // ingested text and the expansion now grows one copy per heads — an unbounded `\d+`
    // would let one malformed row spin the flip loop AND the program.
    expect(deriveAttackCoinFlip(PRINTED_TWO.replace("Flip 2 coins.", "Flip 10 coins."))).not.toBeNull();
    expect(deriveAttackCoinFlip(PRINTED_TWO.replace("Flip 2 coins.", "Flip 11 coins."))).toBeNull();
    // …and the count is CAPTURED rather than assumed, which one printing cannot say on
    // its own: the same sentence at a different digit reads that digit back.
    expect(deriveAttackCoinFlip(PRINTED_TWO.replace("Flip 2 coins.", "Flip 4 coins."))).toHaveProperty(
      "flips.count",
      4,
    );
  });

  it("🛑 the UNTIL-TAILS arm has NOTHING left to guard, and that is not an omission", () => {
    // D129's rule verbatim: the bound that makes an unbounded sequence terminate belongs
    // to the RNG that produces the faces (`MAX_UNTIL_TAILS_FLIPS`), not to the sentence
    // that asks for them. And there is no consequent payload either — the op takes no
    // count — so this arm returns unconditionally. It is the only arm in the family that
    // does, and the mill twin's `count >= 1` is exactly the difference: that arm reads a
    // printed digit which could be 0, and this sentence has no digit anywhere.
    expect(UNTIL_TAILS).not.toMatch(/\d/);
    expect(deriveAttackCoinFlip(UNTIL_TAILS)).not.toBeNull();
    // The near-drift with a MECHANISM behind it: `flipUntilTails` stops on TAILS, so a
    // pattern that admitted "until you get heads" would run the mapped loop over a card
    // asking for the mirror sequence.
    expect(
      deriveAttackCoinFlip(UNTIL_TAILS.replace("until you get tails", "until you get heads")),
    ).toBeNull();
  });

  it("refuses the crossings between the two openings and the family's other consequents", () => {
    // The consequent is byte-identical across the pair, so the ONLY thing that can make
    // the two anchors wrong is an opening reading the wrong consequent or the reverse.
    // Every crossing is enumerated rather than sampled: two openings × four consequents.
    const openings = ["Flip 2 coins. ", "Flip a coin until you get tails. "];
    const consequents = [
      "For each heads, discard an Energy from your opponent's Active Pokémon.",
      "For each heads, discard the top card of your opponent's deck.",
      "For each heads, discard a random card from your opponent's hand.",
      "For each heads, discard the top 2 cards of your opponent's deck.",
    ];
    const built = new Set([PRINTED_TWO, UNTIL_TAILS]);
    for (const opening of openings) {
      for (const consequent of consequents) {
        const sentence = `${opening}${consequent}`;
        const read = deriveAttackCoinFlip(sentence);
        if (built.has(sentence)) {
          expect(read, sentence).toMatchObject({
            ops: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
          });
        } else if (read !== null) {
          // The crossings that DO derive are D130's and D452's, and none of them may
          // reach this slice's op — that is the whole disjointness claim.
          expect(JSON.stringify(read), sentence).not.toContain("discardEnergy");
        }
      }
    }
    // …and the two crossings that must derive NOTHING at all, both for reasons already on
    // record: the until-tails singular mill (nothing prints it — D452's refusal) and the
    // until-tails random hand (the invented string `untilTailsFlip.test.ts` carried).
    expect(
      deriveAttackCoinFlip("Flip a coin until you get tails. For each heads, discard the top card of your opponent's deck."),
    ).toBeNull();
    expect(
      deriveAttackCoinFlip("Flip a coin until you get tails. For each heads, discard a random card from your opponent's hand."),
    ).toBeNull();
  });

  it("refuses a mid-sentence clause and a missing terminator — the `^` and the `$`", () => {
    // 🛑 **EVERY PROBE IS RUN ON BOTH ANCHORS, AND THE FIRST PASS OF THIS FILE DID
    // NOT DO THAT.** It prefixed only `PRINTED_TWO`, so `ATTACK_COIN_ENERGY_UNTIL_TAILS`
    // dropping its `^` was a GAP the D463 probe reported — the twin's caret had nothing
    // driving it at all. **A pair of anchors needs a pair of probes; a loop that varies the
    // SENTENCE while holding the DEFECT fixed only looks symmetric.**
    for (const text of [
      `This attack does 30 damage. ${PRINTED_TWO}`,
      `${PRINTED_TWO} Then, flip a coin.`,
      PRINTED_TWO.replace(/\.$/, ""),
      PRINTED_TWO.toLowerCase(),
      `This attack does 30 damage. ${UNTIL_TAILS}`,
      `${UNTIL_TAILS} Then, flip a coin.`,
      UNTIL_TAILS.replace(/\.$/, ""),
      UNTIL_TAILS.toLowerCase(),
      UNTIL_TAILS.replace(/\.$/, " and heal 10."),
    ]) {
      expect(deriveAttackCoinFlip(text), text).toBeNull();
    }
    // ⚠️ THE CURLY APOSTROPHE IS ACCEPTED, DELIBERATELY, and it is the family's standing
    // rule rather than this slice's choice: these read the SAME noun phrase as
    // `FLIP_OPPONENT_ACTIVE_DISCARD`, and a class on one but not the other would let a
    // re-ingest normalise the bare sentence into deriving while these two silently fell
    // to the loud path — a two-card regression that reads as punctuation.
    expect(deriveAttackCoinFlip(PRINTED_TWO.replace("'", "’"))).not.toBeNull();
    expect(deriveAttackCoinFlip(UNTIL_TAILS.replace("'", "’"))).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — DISJOINTNESS: the trap `deriveAttackEffect` must not fall into.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — one reader per sentence, and the trap is worse than it was", () => {
  it("🛑 `deriveAttackEffect` STILL refuses both, and that null is load-bearing", () => {
    // Both sentences END in `FLIP_OPPONENT_ACTIVE_DISCARD`'s exact words apart from the
    // capital. When they were unread, that pattern matching one of them would have turned
    // a loud skip into ONE silent discard. Now that a different reader claims the whole
    // sentence, it would put TWO readers on one printing at TWO different sites (the flip
    // site in front of the §8.5 pipeline, and the program at its tail) — so the card
    // would discard once flatly AND once per heads. **The trap got worse when the sentence
    // got built, which is why this assertion is kept rather than retired.**
    for (const sentence of [PRINTED_TWO, UNTIL_TAILS]) {
      expect(deriveAttackEffect(sentence), sentence).toBeNull();
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageMultiplier(sentence)).toBeNull();
      expect(deriveAttackRequirement(sentence)).toBeNull();
      expect(sentence.endsWith(BARE.charAt(0).toLowerCase() + BARE.slice(1))).toBe(true);
    }
    // …while the BARE sentence itself is claimed by `deriveAttackEffect` and by nothing
    // on the coin side, which is the other half of the seam.
    expect(deriveAttackEffect(BARE)).not.toBeNull();
    expect(deriveAttackCoinFlip(BARE)).toBeNull();
  });

  it("the two guards that keep the bare pattern out are INDEPENDENT", () => {
    // effects.ts says it takes both: the leading `^`, and the fact that the clause reads
    // lowercase "discard" mid-sentence where the pattern needs a capital. Driven here as
    // two separate one-change probes rather than asserted, because "neither alone is
    // enough" is a claim about each guard separately.
    const capitalised = `Flip 2 coins. For each heads, ${BARE}`;
    expect(capitalised).toContain(", Discard an Energy");
    expect(deriveAttackEffect(capitalised)).toBeNull(); // the `^` alone still refuses it
    expect(deriveAttackEffect(BARE.toLowerCase())).toBeNull(); // the capital alone too
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE READER SURFACE, AND THE ZERO ROWS.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — no new reader, no registry row", () => {
  it("the surface is still 13 and both sentences resolve through it", () => {
    expect(attackReaderSurface()).toHaveLength(13);
    expect(resolvedByAnyReader(PRINTED_TWO)).toBe(true);
    expect(resolvedByAnyReader(UNTIL_TAILS)).toBe(true);
  });

  it("ZERO registry rows — the demonstrator and Krookodile both flip off printed text", () => {
    for (const id of ["fix-perheads-energy", "sv01-117"]) {
      expect(programFor(id)).toBeUndefined();
      // Stated per ATTACK INDEX too, because the registry seam is index-keyed (D97):
      // "no row for the card" and "no row for this attack" are different claims.
      expect(programFor(id)?.attack?.[0]).toBeUndefined();
      expect(programFor(id)?.attack?.[1]).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE PARK, ON A BOARD, N TIMES.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — N heads is N sequential parks, driven end to end", () => {
  it("reaches every heads count across the sweep — 0, 1 and 2 all seen", () => {
    // The outcome coverage is MEASURED on this deck rather than assumed, because every
    // case below is keyed on a heads count and a sweep that never produced 2 would leave
    // the two-park claim untested while looking green.
    const seen = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { events } = attack(armed(seed, 3), REPEAT);
      seen.add(headsIn(events));
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(2);
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it("🛑 TWO heads PARKS TWICE — and the second copy is sitting in `cont.rest`", () => {
    const seed = firstSeedWithHeads(2);
    const { state: parked, events } = attack(armed(seed, 3), REPEAT);
    expect(headsIn(events)).toBe(2);
    // The attack is not over: it is waiting on the FIRST of two picks.
    expect(parked.phase.kind).toBe("effect:choose");
    const first = discardPrompt(parked);
    expect(first.note).toBe(BARE);
    expect(first.scope).toEqual({ kind: "total", count: 1 });
    expect(first.discardable).toHaveLength(3);
    // 🛑 **THE SECOND COPY IS IN `rest`, WHICH IS THE WHOLE MECHANISM CLAIM.** D130 said
    // this was the one thing its expansion could not express; here it is, persisted in the
    // continuation the park writes.
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.cont.rest).toHaveLength(1);
    expect(JSON.stringify(parked.phase.cont.rest[0])).toBe(
      '{"op":"discardEnergy","from":"opponentActive","filter":{"kind":"anyEnergy"}}',
    );
    expect(types(events)).not.toContain("TURN_ENDED");

    // FIRST PICK — the {W}.
    const water = first.discardable.find((d) => parked.cardIdByUid[d.uid] === "fix-water-energy");
    if (water === undefined) throw new Error("no {W} candidate");
    const { state: mid, events: midEvents } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [water.uid] },
    });
    // …and it parks AGAIN rather than finishing, which is the assertion this whole slice
    // exists for. The turn has still not ended.
    expect(mid.phase.kind).toBe("effect:choose");
    expect(types(midEvents)).not.toContain("TURN_ENDED");
    const second = discardPrompt(mid);
    // ONE FEWER CANDIDATE, because the set really SHRANK between the two picks — which is
    // the reading `count: 2` on a single op could not have produced.
    expect(second.discardable).toHaveLength(2);
    expect(second.discardable.map((d) => d.uid)).not.toContain(water.uid);
    if (mid.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(mid.phase.cont.rest).toHaveLength(0);

    // SECOND PICK — and now the tail runs.
    const { state: done, events: endEvents } = mustApply(mid, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [second.discardable[0]?.uid as string] },
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeEnergy(done, "p2")).toHaveLength(1);
    expect(types(endEvents)).toContain("TURN_ENDED");
    // The cards went to their OWNER's pile and the events name the victim seat with the
    // ACTOR who caused it — the two differ here, unlike a self-discard.
    expect(done.players.p2.discard).toContain(water.uid);
    expect(done.players.p1.discard).not.toContain(water.uid);
    const discarded = find(endEvents, "ENERGY_DISCARDED");
    expect(discarded?.seat).toBe("p2");
    expect(discarded?.actor).toBe("p1");
  });

  it("ONE head parks ONCE — the count is the HEADS and not the flips", () => {
    // The sharpest single case in the file: the attack takes TWO flips either way, so a
    // build that expanded per FLIP rather than per HEADS would look identical in the coin
    // rows and differ only here.
    const seed = firstSeedWithHeads(1);
    const { state: parked, events } = attack(armed(seed, 3), REPEAT);
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(2);
    expect(headsIn(events)).toBe(1);
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.cont.rest).toHaveLength(0);
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [discardPrompt(parked).discardable[0]?.uid as string] },
    });
    expect(activeEnergy(done, "p2")).toHaveLength(2);
  });

  it("ZERO heads asks NOTHING and discards nothing — no empty program, no extra ending", () => {
    // D130's `expanded.length > 0 ? expanded : null` in one case: an empty `EffectOp[]`
    // would route the attack through `settleProgram` to say nothing at all, which is a
    // different ending with the same result — and "different ending" is how a no-op grows
    // a KO sweep it did not have.
    const seed = firstSeedWithHeads(0);
    const { state: done, events } = attack(armed(seed, 3), REPEAT);
    expect(headsIn(events)).toBe(0);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeEnergy(done, "p2")).toHaveLength(3);
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("a FORCED pick auto-resolves and never parks — the M1 doctrine, on ONE Energy", () => {
    // With a single Energy on the defender there is no question to ask, so the op resolves
    // inline. This is what says the parks above are a property of the BOARD rather than of
    // the op, and it is also the reason §5's other cases stock three DISTINCT cards.
    const seed = firstSeedWithHeads(2);
    const { state: done, events } = attack(armed(seed, 1), REPEAT);
    expect(headsIn(events)).toBe(2);
    expect(done.phase.kind).not.toBe("effect:choose");
    // Two heads, one Energy: the first copy takes it and the second finds an EMPTY
    // candidate set and whiffs. A whiff is a no-op, not a failure.
    expect(activeEnergy(done, "p2")).toHaveLength(0);
    expect(all(events, "ENERGY_DISCARDED")).toHaveLength(1);
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("an EMPTY defender board whiffs on every copy — and the attack still ends", () => {
    const seed = firstSeedWithHeads(2);
    const { state: done, events } = attack(armed(seed, 0), REPEAT);
    expect(headsIn(events)).toBe(2);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("the PLAIN sibling attack takes no flip at all — the one-axis control", () => {
    // Index 1 prints no effect text, so nothing about the coin path may fire. Without it
    // every coin row in this file could have come from the declaration rather than from
    // the sentence.
    const { state: done, events } = attack(armed(firstSeedWithHeads(2), 3), PLAIN);
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeEnergy(done, "p2")).toHaveLength(3);
  });
});

/** The first seed in the sweep whose two flips come up with exactly `heads` heads.
    Searched rather than hardcoded, so a change to the deck or to the RNG reddens the
    search (it throws) instead of silently re-pointing a case at a different outcome. */
function firstSeedWithHeads(heads: number): number {
  for (let seed = 0; seed < SEEDS; seed++) {
    if (headsIn(attack(armed(seed, 3), REPEAT).events) === heads) return seed;
  }
  throw new Error(`no seed below ${SEEDS} produces ${heads} heads`);
}

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE CENSUS STEP, IN ONE SUMMAND.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the census moves in exactly ONE summand", () => {
  const units = (rows: readonly (readonly [number, string])[]) =>
    rows.reduce((sum, [n]) => sum + n, 0);

  it("🛑 the resolving corpus gains TWO sentences and TWO printings", () => {
    const rows = legalAttackCorpus();
    const resolved = rows.filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([540, 1578]);  // (🆕🆕🆕 **D513 +1 sentence / +1 printing — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, *"Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group has captured `Basic Energy cards of different types` WHOLE since D231 and the sentence died one step later in `HAND_SEARCH_PLURAL.get`, so the new optional group MOVES a phrase out of the noun rather than admitting a sentence the pattern refused (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members — and no widening of that union could EVER have reached this row**, because `matchesFilter` narrows each card INDEPENDENTLY while *“of different types”* is a predicate on the ANSWER SET. It rides D332's shipped `chooseCards.caps` instead — one cap of ONE per `energyProvidesOf` cell — so **ZERO** new prompt fields, validator branches or client mirrors. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D512 +1 sentence / +2 printings — THE BOTH-SIDES BODY COUNT NARROWED BY TWO PRINTED NAME FRAGMENTS** — `censusAttackCorpus.ts` **FILE LINE 583**, *"This attack does 40 damage for each Pokémon in play that has \"Koffing\" or \"Weezing\" in its name (both yours and your opponent's)."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`IN_PLAY_BOTH_SIDES_NAME_MULTIPLY`), ONE new `CardFilter` member (`pokemonNameContaining`) and ONE new `DamageCountSource` member (`bothSidesPokemonInPlay` — the FIRST both-sides count in that union to carry a `CardFilter`; `bothSidesBenchCount` and `bothActivesEnergyCount` are both BARE, because their printed nouns carry no adjective and this one's is NARROWED in print). 🛑 **THE SHIPPED ANCHORS WERE RUN AGAINST THE ROW FIRST AND ALL FOUR REFUSE IT AT THE PATTERN** — the OPPOSITE answer to D510's one row up, and the reason this row genuinely owed a pattern: every in-play anchor requires the literal `for each of your ` and this sentence's head is SEATLESS, with the side named by a trailing parenthetical. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2**, measured at this head rather than carried (D451/D461). RAW summand ALONE: no registry row, no gate split and no trailing split — re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.) (🆕🆕🆕 **D510 +1 sentence / +2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT** — `censusAttackCorpus.ts` **FILE LINE 543**, *"This attack does 20 damage for each Supporter card that has \"Team Rocket\" in its name in your discard pile."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE new `CardFilter` member (`supporterNameContaining`) and ONE PARAMETERISED noun in `discardPileFilter` — **ZERO new anchors**, because D440’s shipped `DISCARD_PILE_COUNT_MULTIPLY` had matched this row since it was written and the NOUN RESOLVER was the blocker. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2** — a TWO-printing sentence, the opposite of D508 one entry down, measured at this head rather than carried (D451/D461). RAW summand ALONE: registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved.) (🆕🆕🆕 **D508 +1 sentence / +1 printing — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME** — `censusAttackCorpus.ts` **FILE LINE 542**, *"This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`DISCARD_PILE_ATTACK_NAME_MULTIPLY`) crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter — **ZERO new members in either union, ZERO evaluator bytes**. READER summand ALONE; registry, gate and trailing stand still at 10/16, 5/13, 11/21.) (🆕🆕🆕 **D507 +2 sentences / +2 printings — THE SPREAD THAT HITS **BOTH** BENCHES, AND THE OPTIONAL PRINTED CLAUSE THAT NARROWS IT TO THE ALREADY-DAMAGED BODIES** — `censusAttackCorpus.ts` **FILE LINES 515 and 526**, *"This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)"* and *"This attack also does 40 damage to each Benched Pokémon **that has any damage counters on it** (both yours and your opponent's). (Don't apply…)"*, **2 sentences / 2 legal printings**, both claimed by `deriveAttackEffect` arm **6-ii** over ONE new anchor (`SPREAD_EACH_BOTH_BENCH`) whose OPTIONAL GROUP *is* the rider. 🛑 **THE BOTH-SIDES HALF COSTS NO TYPE AT ALL: it is a TWO-OP PROGRAM OF THE SAME OP** — `spreadDamage { yourBench }` then `spreadDamage { opponentBench }` — which is D482's shipped answer to the identical question one zone over, so `spreadDamage.target` gains **NO third member** and `counterEachAll`'s `filter` + `side` shape was refused rather than copied (D448/D449/D465's thrice-refused widening, same class). The op gains ONE OPTIONAL BOOLEAN RIDER, `damagedOnly` — `counterEachAll`'s own name on its own predicate `hasAnyDamageCounters`, D505's idiom one rider later. **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), `CardFilter`/`BoardCondition`/`DamageCountSource` members, prompts, choice kinds, parks, events, error codes, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids (file-local `cardPool`, D414), `redact.ts` bytes, `packages/schema` bytes or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 2 AND 2**, MEASURED at this head rather than carried (D451/D461/D465) — both rows are 1-printing sentences. RAW summand ALONE: no registry row, no gate split, no trailing split — all three re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.) (🆕🆕🆕 **D505 +1 sentence / +3 printings — THE PRIZE-SCALED BENCH SPREAD, THE MISSING CELL OF A SHIPPED 2×2** — `censusAttackCorpus.ts` **FILE LINE 517**, *"This attack also does 10 damage to each of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 3 legal printings**, claimed by `deriveAttackEffect` arm **6-i** over ONE new anchor (`SPREAD_EACH_BENCH_TAKEN_PRIZES`) and ONE OPTIONAL BOOLEAN RIDER on the SHIPPED `spreadDamage` (`perTakenPrize` — D448's own name spelled on a second op, so `snipeAmount`'s structural parameter folds it UNCHANGED). **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), prompts, choice kinds, parks, events, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 3**, so a `.length` site takes +1 where a `units(…)` site takes +3 — the largest single printing step left in the residue's spread family, and the reason this row was worth taking before smaller ones (D451, re-paid again).) (🆕🆕🆕 **D500 +1 sentence / +1 printing — THE PRINTED CARD CATEGORY `Basic`, WHICH IS `Special`'s COMPLEMENT AND NOT A TENTH TYPE** — `censusAttackCorpus.ts` **FILE LINE 580**, *"This attack does 40 damage for each Basic Energy attached to this Pokémon."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` through **ONE ROW in `CLAUSE_ENERGY_TOKENS`** — the anchor `SELF_ENERGY_MULTIPLY` already admitted the token and the refusal lived one step later, in `attachedEnergyFilter`. **ZERO new anchors, ZERO new readers (surface unmoved at 13), ZERO new ops, ZERO new op FIELDS, ZERO new `DamageCountSource` members, ZERO new `FIXTURE_POOL` ids and ZERO `packages/schema` bytes.** ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — the row is 1/1 — and that was VERIFIED at both kinds of site rather than assumed from the row being singular (D451/D461).) (🆕🆕🆕 **D491 +1 sentence / +1 printing — THE ONLY DRAW IN THE COLUMN WHOSE SUBJECT IS NOT THE CONTROLLER** — corpus FILE LINE **199**, *"Each player draws 3 cards."*, claimed WHOLE by `deriveAttackEffect` through ONE new anchor over `drawCards` + ONE optional key `who?: "eachPlayer"`; reader surface still **13**. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1, measured.)   // (🆕🆕🆕 **D489 +1 sentence / +2 printings — THE HAND DISCARD WHOSE COUNT IS THE SNIPE'S MULTIPLIER** — `censusAttackCorpus.ts` FILE LINE **138**, *"Discard up to 3 Energy cards from your hand. This attack does 60 damage to 1 of your opponent's Pokémon for each Energy card you discarded in this way. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `HAND_DISCARD_THEN_SCALED_ANY_TARGET`, ONE new UNION ARM on the shipped `payFromHand` (the declinable `{count: "any"; cap}` quantifier, `discardEnergy.count`'s D361 widening at the sibling op) and ONE OPTIONAL key on the shipped `damageChosen` (`perRecorded: EffectSlot`). 🛑 **THE 2⁵ AXIS-DELETION LATTICE WAS RUN AND EXACTLY ONE OF ITS 32 POINTS BUILDS** — the all-five substitution — so no half of this sentence already shipped. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 AND 2** (D451/D464), so a `.length` site takes +1 where a `units(…)` site takes +2 — read the head name, not the neighbouring term. **ZERO** new `EffectOp` kinds, `EffectSlot` members, `CardFilter`/`DamageCountSource`/`BoardCondition` members, readers (surface still **13**), prompts, choice kinds, events, `FIXTURE_POOL` ids, `redact.ts` bytes, `packages/schema` bytes or `MATCH_RECORD_VERSION` bytes.) (🆕🆕🆕 **D488 +2 sentences / +2 printings — MILL YOUR OWN DECK, THEN SCALE BY WHAT WAS MILLED** — `censusAttackCorpus.ts` FILE LINES **126** and **129**, *"Discard the top {3|7} cards of your deck, and this attack does {80|70} damage for each {Energy card|Misty's Pokémon that} you discarded in this way."*, **2 sentences / 2 legal printings**, both claimed WHOLE by `deriveAttackEffect` through ONE new anchor `DECK_MILL_FILTERED_SCALED_DAMAGE` and TWO OPTIONAL keys on TWO SHIPPED ops (`discardDeckTop.recordAs`, `damageDefender.countFilter`). 🛑 **THE TWO ROWS SHARE ONE BLOCKER AND IT WAS PROVED BY AXIS DELETION, NOT BY RESEMBLANCE** (D483's cluster split 2+2 under the same test). **ZERO** new `EffectOp`/`EffectSlot`/`CardFilter`/`DamageCountSource` members, readers (surface still **13**), prompts, parks, events, `FIXTURE_POOL` ids or `packages/schema` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 2 AND 2**, MEASURED (D451/D461/D465).) (🆕🆕🆕 **D487 +1 sentence / +1 printing — THE DECK'S OTHER END** — `censusAttackCorpus.ts` FILE LINE **143**, *"Draw 3 cards from the bottom of your deck."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `ATTACK_DRAW_BOTTOM` over the SHIPPED `drawCards` op carrying ONE new OPTIONAL key `from?: "bottom"`. **ZERO** new `EffectOp` members, op VALUES on any other field, `BoardCondition`/`CardFilter` members, readers (surface still **13**), prompts, choice kinds, parks, events, error codes, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids (file-local `cardPool`, D414), `redact.ts` bytes or `packages/schema` bytes. 🛑 **`MATCH_RECORD_VERSION` STAYS 29 AND THE ADDRESS DOES PERSIST** — `drawCards` rides `recordGate.then` behind `payFromHand`'s park into `state.phase`, so this is NOT D470/D472's no-carrier argument; it is D125's WIDENING, DRIVEN in the LOSS direction (a v29 op with the key ABSENT still draws the TOP). ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, MEASURED here rather than carried (D451/D461/D465). RAW summand ALONE: no registry row, no gate split, no trailing split — re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.) (🆕🆕🆕 **D486 +1 sentence / +1 printing — THE GATED INCREMENT ON THE OPPONENT'S HAND DISCARD** — `censusAttackCorpus.ts` FILE LINE **668**, *"Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `ATTACK_OPPONENT_DISCARDS_HAND_MORE` over a TWO-OP program of ops that ALL SHIPPED (`opponentDiscardsFromHand` + `conditionGate` on D393's `yourActiveEvolvedFromThisTurn`), plus ONE new literal `CONDITIONAL_DAMAGE_CLAUSES` row. **ZERO** new op members, op fields, op values, `BoardCondition` members, readers (surface still 13), `interpreter.ts` bytes, `redact.ts` bytes or `packages/schema` bytes. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1, MEASURED.) (🆕🆕🆕 D485 +1 sentence / +1 printing — THE MANDATORY FILTERED SWEEP OF THE OPPONENT'S HAND, `censusAttackCorpus.ts` FILE LINE **673**, *"Your opponent reveals their hand. Discard all Item cards and Pokémon Tool cards you find there."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `ATTACK_REVEAL_AND_SWEEP` over the shipped `revealOpponentHand` plus ONE new `EffectOp` member `discardFromOpponentHand { filter: CardFilter }`. **ZERO** new `CardFilter` members — the printed *"Item cards and Pokémon Tool cards"* is `anyOf` over the shipped `item` and `toolCard` — and zero new op VALUES, prompts, events, error codes or `packages/schema` bytes; reader surface still **13**. RAW summand ALONE: no registry row, no gate split, no trailing split (10/16, 5/13, 11/21 all re-measured unmoved). ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, MEASURED at this head rather than carried (D451/D461/D465).) // (🆕🆕🆕 D483 +2 sentences / +2 printings — THE PRINTED CANDIDATE **CLASS** ON THE BENCHED SNIPE, `censusAttackCorpus.ts` FILE LINES **111** and **615**, **2 sentences / 2 legal printings**, both claimed WHOLE by `deriveAttackEffect` (arms 9b-bis and 6c) through ONE new group on the SHARED fragment `ALSO_BENCHED_SNIPE_BODY` and ONE new OPTIONAL op field `damageChosen.filter?: CardFilter`. RAW summand ALONE; reader surface still 13. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 2 AND 2, MEASURED at this head.) // (🆕🆕 D482 +1 sentence / +1 printing — THE WHOLE-SIDE SPREAD, `censusAttackCorpus.ts` FILE LINE **572**, *"This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` arm 6a-bis through ONE new anchor `SPREAD_EACH_OPPONENT_POKEMON` over a TWO-OP PROGRAM OF SHIPPED OPS (`damageDefender` flat + `spreadDamage { target: "opponentBench" }`) — **ZERO new op members, fields, values or `interpreter.ts` bytes**, reader surface still 13. RAW summand ALONE: no registry row, no gate split, no trailing split. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1.)// (🆕🆕 D479 +1 sentence / +1 printing — THE ATTACK-SIDE HAND REFRESH, `censusAttackCorpus.ts` FILE LINE 486, *"Shuffle your hand into your deck. Then, draw {N} cards."*, 1 sentence / 1 legal printing, claimed WHOLE by `deriveAttackEffect` arm 44b through ONE new anchor `SHUFFLE_HAND_DRAW` over `handRefresh { who: "you", draw: { kind: "fixed", count } }` — Youngster `sv01-198`'s hand-authored trainer program at a second address, so ZERO new `EffectOp` members, op FIELDS, op VALUES, readers (surface still 13), prompts, events, `interpreter.ts` or `redact.ts` bytes. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1, unlike D478's 1-vs-2 — derived here, not carried.) // (D478 +1 sentence / +2 printings — THE OTHER BRANCH OF A GATE THAT ALREADY SHIPS, `censusAttackCorpus.ts` FILE LINE 263, *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused."*, 1 sentence / 2 legal printings, claimed WHOLE by `deriveAttackEffect` arm 2b-bis through ONE new anchor `FLIP_DEFENDER_PAIR_OR_TAILS_STATUS` over a `coinFlipGate` with BOTH arms filled. `coinFlipGate.otherwise` shipped at D269 and arm 6d has emitted a two-armed gate since D416, so the mechanism the old refusal called absent was 209 decisions old. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2 — one file line, two legal printings; D476's and D475's agreed at 1 and 1, so this term was DERIVED here and not carried. RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414), ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events or `interpreter.ts` bytes.) // (🆕🆕 D476 +1 sentence / +1 printing — THE FACE AXIS, THE LAST OPEN AXIS OF THE PRINTED PER-FACE FAMILY — `censusAttackCorpus.ts` **FILE LINE 217**, *"Flip 3 coins. For each tails, discard an Energy from this Pokémon."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_SELF_ENERGY_PER_TAILS`) and ONE **REQUIRED** `face: CoinFace` FIELD on the shipped `programPerHeads` member. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — D472's disagreed at 1 and 2, D473's agreed at 2 and 2, D474's disagreed at 1 and 2, D475's agreed at 1 and 1 — so this term was DERIVED at this head and not carried from the previous slice (D451/D461/D464). RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, and **ZERO new `FIXTURE_POOL` ids** (file-local `cardPool`, D414), so every id ladder takes a ZERO term. ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events, error codes or `AttackCoinFlip` MEMBERS — the op is `SELF_DISCARD_ONE`'s output byte for byte, and the FACE rides the member that already shipped.) // (🆕🆕 D475 +1 sentence / +1 printing — THE COIN FLIP COUNTED OVER BOTH ACTIVES — `censusAttackCorpus.ts` **FILE LINE 231**, *"Flip a coin for each Energy attached to both Active Pokémon. This attack does 60 damage for each heads."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor and a FIFTH, NULLARY `AttackFlipCount` member `bothActivesEnergy`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — D472's disagreed at 1 and 2, D473's agreed at 2 and 2, D474's disagreed at 1 and 2, so this term was DERIVED at this head and not carried from the previous slice (D451/D461/D464). RAW summand ALONE: no registry row, no gate split, no trailing split, D464's compound route measured EMPTY, reader surface still 13, and **NO new `FIXTURE_POOL` id** — the printed sentence has sat on `fix-bothactives` index 2 as a refusal witness since D196, so every id ladder takes a ZERO term.) // 🆕🆕 D474 +1 sentence / +2 printings (THE BOARD-COUNTED COIN FLIP OVER BODIES — `censusAttackCorpus.ts` **FILE LINE 233**, *"Flip a coin for each {D} Pokémon you have in play. This attack does 60 damage for each heads."*, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor and ONE new `AttackFlipCount` member `pokemonInPlay`. ⚠️ **THIS IS A LIVE HEAD, NOT A FROZEN TAIL** (D461/D462): the literal moves and there is no front term to add. ⚠️ **AND THE TWO UNITS DISAGREE, 1 AND 2** — the opposite of D473's 2-and-2 — so the number here was read off THIS assertion's head rather than copied from a sibling site. RAW summand ALONE: no registry row, no gate split, no trailing split, D464's compound route measured EMPTY, reader surface still 13.) // 🆕🆕 D470 +1 sentence / +1 printing (THE BOARD-WIDE OWN-SIDE ENERGY COUNT, NARROWED BY A PRINTED SUBGROUP NOUN — `censusAttackCorpus.ts` **FILE LINE 558**, *"This attack does 20 more damage for each {L} Energy attached to all of your Iono's Pokémon."*, **1 legal printing**, claimed WHOLE by `deriveAttackDamageBonus` through the new `SELF_ENERGY_FILTERED_SCALE` anchor. ONE anchor, ONE reader arm, ONE **OPTIONAL FIELD ON THE SHIPPED** `energyOnSelf` member (`filter?: CardFilter`), ONE evaluator branch and ONE **OPTIONAL PARAMETER ON THE SHARED** `countEnergyInPlay` — whose THREE call sites (`energyOnOpponent`'s board arm, `energyOnSelf`'s, and `interpreter.ts`'s `yourEnergyInPlayAtLeast`, the third of which is NOT an op) are byte-identical, because `undefined` is every body. D454's blast radius, ENUMERATED before a byte was written. DISJOINT FROM `SELF_ENERGY_SCALE` BY STRUCTURE and not by the lookahead, which D467/D468 require saying: both are `^…$` and this one demands a run of bytes ending in a SPACE that the shipped literal cannot spend; the `(?!opponent)` lookahead is a DIFFERENT guard doing a DIFFERENT job (it refuses a SEAT, not a subgroup) and it IS killable. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `CardFilter` MEMBERS, `packages/schema` bytes or `redact.ts` bytes; ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414). **`MATCH_RECORD_VERSION` STAYS 29** — an `AttackDamageBonus` is a parse-time LOCAL inside `attack()`, and `CardFilter` IS persisted but gains no MEMBER here (`ownerPokemon` has been an inhabitant since D242), driven over the SERIALIZED BYTES in `ownerBoardEnergyScaling.test.ts` §8.)  // 🆕🆕🆕 **D490 +1 sentence / +2 printings — THE MILL OF BOTH DECKS, SCALED BY THE ENERGY AMONG WHAT IT MILLED** (`censusAttackCorpus.ts` FILE LINE 130; the LAST unbuilt member of the `discarded in this way` family, claimed by `deriveAttackDiscardScaledBoost`'s new `eachDeckMill` member — the reader SURFACE stands still at 13). ⚠️ THE TWO STEPS DISAGREE, 1 AND 2.
    // 🆕🆕 D469 +1 sentence / +1 printing (THE OPPONENT'S WHOLE BOARD OF DAMAGE COUNTERS — `censusAttackCorpus.ts` **FILE LINE 534**, *"This attack does 10 more damage for each damage counter on all of your opponent's Pokémon."*, **1 legal printing**, claimed WHOLE by `deriveAttackDamageBonus` through the new `OPPONENT_BOARD_COUNTER_SCALE` anchor. ONE anchor, ONE reader arm, ONE NULLARY `DamageCountSource` member (`damageCountersOnOpponentBoard`), ONE evaluator arm and ONE shared board counter (`countDamageCountersInPlay`, continuous.ts, beside `countEnergyInPlay`/`countToolsInPlay`) — D406's cost table verbatim, at a second address. DISJOINT FROM `OPPONENT_COUNTER_SCALE` BY STRUCTURE and not by a lookahead, which D467/D468 require saying: both are `^…$` and disagree on a mandatory run of bytes at the same position. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `packages/schema` bytes or `redact.ts` bytes; ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414). **`MATCH_RECORD_VERSION` STAYS 29** — an `AttackDamageBonus` is a parse-time LOCAL inside `attack()` and there is no carrier at all, driven over the SERIALIZED BYTES in `opponentBoardCounterScaling.test.ts` §8 rather than reasoned from the type's name (D427).) // 🆕🆕 D468 +1 sentence / +1 printing (THE TYPED SELF-SWITCH — `censusAttackCorpus.ts` **FILE LINE 499**, *"Switch this Pokémon with 1 of your Benched {L} Pokémon."*, **1 legal printing**. ⚠️ **A LIVE HEAD, NOT A CHAIN — SO THE LITERAL MOVES AND NOTHING IS ADDED AT THE FRONT** (D461's table: the tell is the left-hand side of the assertion). ⚠️ **AND THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 HERE**, which is the easy case and is not a shape that carries — D467's was 2 vs 3.)  // 🆕🆕 D467 +2 sentences / +3 printings (THE ATTACKER'S OWN BENCH NARROWED BY A PRINTED NOUN, ON BOTH OF ITS COUNTING AXES — `censusAttackCorpus.ts` **file lines 544 and 622**, *"This attack does 20 damage for each damage counter on all of your Benched {F} Pokémon."* (2 legal, the `×` fold) and *"This attack does 80 more damage for each of your Benched Charjabug."* (1 legal, the `+` fold), **2 sentences / 3 legal printings**. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 3** — two file lines carrying 2 and 1 printings, so MEASURE each site rather than copying one number into the other kind (D451/D461/D466). RAW summand ALONE: no registry row, no gate split, no trailing split, and the reader surface stands still at 13. TWO new anchors, ONE new OPTIONAL field on the shipped `damageCountersOnYourBench` member, ONE new `IN_PLAY_BODY_NOUNS` row and ZERO new `CardFilter` members — so `MATCH_RECORD_VERSION` STAYS 29 on the SERIALIZED-ALPHABET shape (D462) at ONE address, not two.)
    // 🆕🆕 D466 +2 sentences / +3 printings (THE PRINTED EVOLUTION-STAGE ORDINAL AS A BODY FILTER — `censusAttackCorpus.ts` **file lines 586 and 589**, *"This attack does 40 damage for each of your Stage 1 Pokémon in play."* (1 legal, the `×` fold) and *"This attack does 40 more damage for each Stage 2 Pokémon on your Bench."* (2 legal, the `+` fold), **2 sentences / 3 legal printings**, claimed by `deriveAttackDamageMultiplier` and `deriveAttackDamageBonus` respectively. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 3** — two file lines carrying 1 and 2 printings, so a pass that copied one number into the other kind of site would be wrong at every site of the other kind (D451/D461); MEASURE each site. ONE new `CardFilter` member (`stagePokemon`, delegating to cards.ts `isStage1Pokemon`/`isStage2Pokemon`, which D387/D262 had already written for the `boardCondition` antecedents) and TWO new `IN_PLAY_BODY_NOUNS` rows — which is the WHOLE of file line 586, with **ZERO new anchors**, because D439's two shipped `in play` anchors already reached it and only the VOCABULARY refused. File line 589 costs ONE new anchor (`YOUR_BENCH_FILTERED_SCALE`) and ONE new OPTIONAL FIELD on the SHIPPED `yourBenchCount` member (`filter?: CardFilter`, D407's `energyOnSelf.zone` shape) — `undefined` is every body, so all ten shipped printings of that member emit a filter-less object byte for byte as before. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `packages/schema` bytes or `redact.ts` bytes; ONE new FIXTURE id (`fix-stage2body`) and ONE new attack on `fix-inplaybodies`. **`MATCH_RECORD_VERSION` STAYS 29 AT TWO ADDRESSES** — `CardFilter` IS persisted (D446 measured it: nine `EffectOp` fields carry one and an op rides `state.phase.cont.pendingOp`) and a WIDENING is free; `DamageCountSource` is PARSE-TIME and is not at a persisted address at all. 🛑 **`OPAQUE` MOVES, 81/116 → 80/114, AND `PHRASE-2` EMPTIES, 1/1 → 0/0 — AND THE INSTRUMENT STOOD STILL THIS SLICE** (`residue-census.ts` is untouched by D466), so unlike D465 this class-table delta really is a statement about the WORK.) 🆕🆕 D465 +1 sentence / +1 printing (THE RECOIL THAT SCALES OFF ITS OWN COUNTERS — `censusAttackCorpus.ts` **file line 500**, *"This Pokémon also does 10 damage to itself for each damage counter on it."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` arm 14 through ONE new anchor (`SELF_DAMAGE_PER_COUNTER`) and ONE new OPTIONAL FIELD on the SHIPPED `damageSelf` op (`perDamageCounterOnSelf`), folded by `recoilAmount` in `interpreter.ts` — `snipeAmount`'s `(op, state, ctx)` shape, the third rider of that kind. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE, 1 AND 1** — the OPPOSITE of D464's 1-vs-2 one slice ago, so a pass that inferred either from the other would have been right here and wrong then: MEASURE each site. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` MEMBERS, `DamageCountSource` kinds (`damageCountersOnSelf` already ships and is deliberately NOT used — it is a PARSE-TIME type no `EffectOp` carries), prompts, events, error codes, registry rows, FIXTURE ids, `packages/schema` bytes or `redact.ts` bytes; **`MATCH_RECORD_VERSION` STAYS 29 on D461's REACHABILITY shape** — `damageSelf` never parks and the only producer of the rider returns a program of LENGTH ONE, so the field can never sit in `phase.cont.rest` behind an earlier park. 🛑 **`OPAQUE` DOES NOT MOVE — 81/116 BEFORE AND AFTER** — because D465 FIXED `residue-census.ts`'s span probe FIRST, which reclassified this row out of `OPAQUE` into `PHRASE-6` before anything was built. The class it left is `PHRASE-6`.) 🆕🆕 D464 +1 sentence / +2 printings (THE FLIP-GATED STATUS THAT ALSO STRIPS AN ENERGY — `censusAttackCorpus.ts` **file line 264**, *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon."*, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackEffect` arm 2d through ONE new anchor (`FLIP_DEFENDER_STATUS_THEN_DISCARD`) whose program is arm 2's `applyStatus` followed by `FLIP_OPPONENT_ACTIVE_DISCARD`'s `discardEnergy` inside ONE `coinFlipGate`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2** — one file line carrying two legal printings, so a pass that copied one number into the other kind of site would be wrong at EVERY site (D463's agreed at 2 and 2, which is the trap in the other direction). RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op FIELDS, op VALUES or FIXTURE ids — `fix-oxford` index 2 ALREADY printed this sentence, as D462's loud control. 🛑 **`OPAQUE` MOVES FOR THE SECOND SLICE RUNNING** (87/125 → 86/123), and this row sat in it: no deletion and no substitution `residue-census.ts` can make reaches a built string, because the edit that would — deleting the trailing consequent — must take the sentence-final period with it.)
    // …and the step is attributable: remove THESE TWO from the resolved set and the pair
    // falls by exactly 2 and 2, re-derived rather than remembered.
    const without = resolved.filter(([, s]) => s !== PRINTED_TWO && s !== UNTIL_TAILS);
    expect([without.length, units(without)]).toEqual([538, 1576]);  // (🆕🆕🆕 **D513 +1 sentence / +1 printing — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group captured `Basic Energy cards of different types` WHOLE from the day it was written, and the refusal was one step later in `HAND_SEARCH_PLURAL.get` (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members, and no widening of that union could ever reach this row** — it rides D332's shipped `chooseCards.caps`, one cap of ONE per `energyProvidesOf` cell, so ZERO new prompt fields, validator branches or client mirrors. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D512 — THE BOTH-SIDES BODY COUNT NARROWED BY TWO PRINTED NAME FRAGMENTS** — `censusAttackCorpus.ts` **FILE LINE 583**, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor, ONE new `CardFilter` member (`pokemonNameContaining`) and ONE new `DamageCountSource` member (`bothSidesPokemonInPlay`). **+1 sentence / +2 printings**, which this BEFORE-figure inherits because it is the live sum minus this slice's own row.) (🆕🆕🆕 **D510 +1 sentence / +2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT** — `censusAttackCorpus.ts` **FILE LINE 543**, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE `CardFilter` member and ONE parameterised noun, **ZERO new anchors**. ⚠️ The SENTENCE step and the PRINTING step DISAGREE at 1 and 2.) (🆕🆕🆕 **D508 +1 sentence / +1 printing — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME** — `censusAttackCorpus.ts` **FILE LINE 542**, *"This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`DISCARD_PILE_ATTACK_NAME_MULTIPLY`) crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter — **ZERO new members in either union, ZERO evaluator bytes**. READER summand ALONE; registry, gate and trailing stand still at 10/16, 5/13, 11/21. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, measured per site rather than copied between the two kinds of site (D451/D461).) 🆕🆕🆕 **D505 +1 sentence / +3 printings — THE PRIZE-SCALED BENCH SPREAD (corpus FILE LINE 517).** This pair is the resolving set MINUS this file's own sentence, so it steps by exactly what the line above it steps by — which is the point of measuring both: a slice that moved only one of the two would be visible here (D451/D465). (🆕🆕🆕 **D500 +1 sentence / +1 printing — THE PRINTED CARD CATEGORY `Basic`, WHICH IS `Special`'s COMPLEMENT AND NOT A TENTH TYPE** — `censusAttackCorpus.ts` **FILE LINE 580**, *"This attack does 40 damage for each Basic Energy attached to this Pokémon."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` through **ONE ROW in `CLAUSE_ENERGY_TOKENS`** — the anchor `SELF_ENERGY_MULTIPLY` already admitted the token and the refusal lived one step later, in `attachedEnergyFilter`. **ZERO new anchors, ZERO new readers (surface unmoved at 13), ZERO new ops, ZERO new op FIELDS, ZERO new `DamageCountSource` members, ZERO new `FIXTURE_POOL` ids and ZERO `packages/schema` bytes.** ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — the row is 1/1 — and that was VERIFIED at both kinds of site rather than assumed from the row being singular (D451/D461).) (🆕🆕🆕 **D491 ±1: THE ONLY DRAW IN THE COLUMN WHOSE SUBJECT IS NOT THE CONTROLLER** — corpus FILE LINE **199**, *"Each player draws 3 cards."*, 1 sentence / 1 legal printing.)  //  // 🆕🆕🆕 **D490 +1 sentence / +2 printings — THE MILL OF BOTH DECKS, SCALED BY THE ENERGY AMONG WHAT IT MILLED** (`censusAttackCorpus.ts` FILE LINE 130). ⚠️ THE TWO STEPS DISAGREE, 1 AND 2. (🆕🆕🆕 **D489 +1 sentence / +2 printings — THE HAND DISCARD WHOSE COUNT IS THE SNIPE'S MULTIPLIER; `censusAttackCorpus.ts` FILE LINE 138. ⚠️ THE TWO STEPS DISAGREE, 1 AND 2** — read the head name, not the neighbouring term.) (🆕🆕🆕 **D488 +2 sentences / +2 printings — MILL YOUR OWN DECK, THEN SCALE BY WHAT WAS MILLED** — `censusAttackCorpus.ts` FILE LINES **126** and **129**, *"Discard the top {3|7} cards of your deck, and this attack does {80|70} damage for each {Energy card|Misty's Pokémon that} you discarded in this way."*, **2 sentences / 2 legal printings**, both claimed WHOLE by `deriveAttackEffect` through ONE new anchor `DECK_MILL_FILTERED_SCALED_DAMAGE` and TWO OPTIONAL keys on TWO SHIPPED ops (`discardDeckTop.recordAs`, `damageDefender.countFilter`). 🛑 **THE TWO ROWS SHARE ONE BLOCKER AND IT WAS PROVED BY AXIS DELETION, NOT BY RESEMBLANCE** (D483's cluster split 2+2 under the same test). **ZERO** new `EffectOp`/`EffectSlot`/`CardFilter`/`DamageCountSource` members, readers (surface still **13**), prompts, parks, events, `FIXTURE_POOL` ids or `packages/schema` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 2 AND 2**, MEASURED (D451/D461/D465).) (🆕🆕🆕 **D487 +1 sentence / +1 printing — THE DECK'S OTHER END** — `censusAttackCorpus.ts` FILE LINE **143**, *"Draw 3 cards from the bottom of your deck."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `ATTACK_DRAW_BOTTOM` over the SHIPPED `drawCards` op carrying ONE new OPTIONAL key `from?: "bottom"`. ⚠️ **SECOND-WAVE SITE — masked behind a first failing `expect(` in the same `it` (D473's masked-second-failure effect), so it was found by a SECOND `check` round rather than by the first.** **ZERO** new `EffectOp` members, readers (surface still **13**), registry rows or `packages/schema` bytes; 🛑 **`MATCH_RECORD_VERSION` STAYS 29** at an address that DOES persist — D125's widening, driven in the LOSS direction. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, MEASURED at each site rather than copied between them (D451/D461).) (🆕🆕🆕 **D486 +1 sentence / +1 printing — THE GATED INCREMENT ON THE OPPONENT'S HAND DISCARD** — `censusAttackCorpus.ts` FILE LINE **668**, *"Your opponent discards a card from their hand. If this Pokémon evolved from Salandit during this turn, your opponent discards 2 more cards."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `ATTACK_OPPONENT_DISCARDS_HAND_MORE` over a TWO-OP program of ops that ALL SHIPPED (`opponentDiscardsFromHand` + `conditionGate` on D393's `yourActiveEvolvedFromThisTurn`), plus ONE new literal `CONDITIONAL_DAMAGE_CLAUSES` row. **ZERO** new op members, op fields, op values, `BoardCondition` members, readers (surface still 13), `interpreter.ts` bytes, `redact.ts` bytes or `packages/schema` bytes. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1, MEASURED.) (🆕🆕🆕 D485 +1 sentence / +1 printing — THE MANDATORY FILTERED SWEEP OF THE OPPONENT'S HAND, `censusAttackCorpus.ts` FILE LINE **673**, *"Your opponent reveals their hand. Discard all Item cards and Pokémon Tool cards you find there."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `ATTACK_REVEAL_AND_SWEEP` over the shipped `revealOpponentHand` plus ONE new `EffectOp` member `discardFromOpponentHand { filter: CardFilter }`; ZERO new `CardFilter` members and reader surface still **13**. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1, MEASURED at this head.) // (🆕🆕🆕 D483 +2 sentences / +2 printings — THE PRINTED CANDIDATE **CLASS** ON THE BENCHED SNIPE, `censusAttackCorpus.ts` FILE LINES **111** and **615**, **2 sentences / 2 legal printings**, both claimed WHOLE by `deriveAttackEffect` (arms 9b-bis and 6c) through ONE new group on the SHARED fragment `ALSO_BENCHED_SNIPE_BODY` and ONE new OPTIONAL op field `damageChosen.filter?: CardFilter`. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 2 AND 2, MEASURED. ⚠️ FOUND ON A SECOND `check` ROUND, BEHIND A SITE IN THE SAME `it` THAT THREW FIRST — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short and the ROUND COUNT is the measurement.) // (🆕🆕 D479 +1 sentence / +1 printing — THE ATTACK-SIDE HAND REFRESH, `censusAttackCorpus.ts` FILE LINE 486, *"Shuffle your hand into your deck. Then, draw {N} cards."*, claimed WHOLE by `deriveAttackEffect` arm 44b through ONE new anchor `SHUFFLE_HAND_DRAW` over `handRefresh { who: "you", draw: { kind: "fixed", count } }` — Youngster `sv01-198`'s hand-authored program at a second address. ZERO new op members/fields/values, reader surface still 13. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1.) // (D478 +1 sentence / +2 printings — THE OTHER BRANCH OF A GATE THAT ALREADY SHIPS, `censusAttackCorpus.ts` FILE LINE 263, *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused."*, 1 sentence / 2 legal printings, claimed WHOLE by `deriveAttackEffect` arm 2b-bis through ONE new anchor `FLIP_DEFENDER_PAIR_OR_TAILS_STATUS` over a `coinFlipGate` with BOTH arms filled. `coinFlipGate.otherwise` shipped at D269 and arm 6d has emitted a two-armed gate since D416, so the mechanism the old refusal called absent was 209 decisions old. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2 — one file line, two legal printings; D476's and D475's agreed at 1 and 1, so this term was DERIVED here and not carried. RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414), ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events or `interpreter.ts` bytes.) // (🆕🆕 D476 +1 sentence / +1 printing — THE FACE AXIS, THE LAST OPEN AXIS OF THE PRINTED PER-FACE FAMILY — `censusAttackCorpus.ts` **FILE LINE 217**, *"Flip 3 coins. For each tails, discard an Energy from this Pokémon."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_SELF_ENERGY_PER_TAILS`) and ONE **REQUIRED** `face: CoinFace` FIELD on the shipped `programPerHeads` member. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — D472's disagreed at 1 and 2, D473's agreed at 2 and 2, D474's disagreed at 1 and 2, D475's agreed at 1 and 1 — so this term was DERIVED at this head and not carried from the previous slice (D451/D461/D464). RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, and **ZERO new `FIXTURE_POOL` ids** (file-local `cardPool`, D414), so every id ladder takes a ZERO term. ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events, error codes or `AttackCoinFlip` MEMBERS — the op is `SELF_DISCARD_ONE`'s output byte for byte, and the FACE rides the member that already shipped.) // (🆕🆕 D475 +1 sentence / +1 printing — THE COIN FLIP COUNTED OVER BOTH ACTIVES, `censusAttackCorpus.ts` **FILE LINE 231**, claimed WHOLE by `deriveAttackCoinFlip`. ⚠️ FOUND ON THE SECOND `check` ROUND, BEHIND A SITE IN THE SAME `it` THAT THREW FIRST — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short and the round count is the measurement.) // 🆕🆕 D474 +1 sentence / +2 printings (THE BOARD-COUNTED COIN FLIP OVER BODIES — `censusAttackCorpus.ts` **FILE LINE 233**, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackCoinFlip`. ⚠️ **FOUND ON THE SECOND `check` ROUND, BEHIND A SITE THAT THREW FIRST** — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short. The head name was read at THIS site rather than copied from the sibling above it.) // 🆕🆕 D470 +1 sentence / +1 printing (THE BOARD-WIDE OWN-SIDE ENERGY COUNT, NARROWED BY A PRINTED SUBGROUP NOUN — `censusAttackCorpus.ts` **FILE LINE 558**, *"This attack does 20 more damage for each {L} Energy attached to all of your Iono's Pokémon."*, **1 legal printing**, claimed WHOLE by `deriveAttackDamageBonus` through the new `SELF_ENERGY_FILTERED_SCALE` anchor — ONE anchor, ONE arm, ONE OPTIONAL field on the SHIPPED `energyOnSelf` member, ONE evaluator branch, ONE OPTIONAL parameter on the SHARED `countEnergyInPlay`. RAW summand ALONE; the reader surface stands still at 13.) // (🆕🆕🆕 D482 — the WHOLE-SIDE SPREAD raises the head by 1 sentence / 1 printing (`censusAttackCorpus.ts` FILE LINE 572, arm 6a-bis, `SPREAD_EACH_OPPONENT_POKEMON` over `damageDefender` + `spreadDamage`), so this DERIVED figure moves with it. This slice's own sentence is NOT in this file's subtracted set, which is why the figure steps by exactly the head's step.)
    // 🆕🆕 D469 +1 sentence / +1 printing (THE OPPONENT'S WHOLE BOARD OF DAMAGE COUNTERS — `censusAttackCorpus.ts` **FILE LINE 534**, *"This attack does 10 more damage for each damage counter on all of your opponent's Pokémon."*, **1 legal printing**, claimed WHOLE by `deriveAttackDamageBonus` through the new `OPPONENT_BOARD_COUNTER_SCALE` anchor. ONE anchor, ONE reader arm, ONE NULLARY `DamageCountSource` member (`damageCountersOnOpponentBoard`), ONE evaluator arm and ONE shared board counter (`countDamageCountersInPlay`, continuous.ts, beside `countEnergyInPlay`/`countToolsInPlay`) — D406's cost table verbatim, at a second address. DISJOINT FROM `OPPONENT_COUNTER_SCALE` BY STRUCTURE and not by a lookahead, which D467/D468 require saying: both are `^…$` and disagree on a mandatory run of bytes at the same position. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `packages/schema` bytes or `redact.ts` bytes; ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414). **`MATCH_RECORD_VERSION` STAYS 29** — an `AttackDamageBonus` is a parse-time LOCAL inside `attack()` and there is no carrier at all, driven over the SERIALIZED BYTES in `opponentBoardCounterScaling.test.ts` §8 rather than reasoned from the type's name (D427).) // 🆕🆕 D468 +1 sentence / +1 printing (THE TYPED SELF-SWITCH — `censusAttackCorpus.ts` **FILE LINE 499**, *"Switch this Pokémon with 1 of your Benched {L} Pokémon."*, **1 legal printing**. ⚠️ **A LIVE HEAD, NOT A CHAIN** — the literal moves and nothing is added at the front (D461). ⚠️ **THIS SITE WAS MASKED BEHIND ANOTHER IN THE SAME `it` AND ONLY SURFACED ON THE THIRD `check` ROUND** — vitest stops an `it` at its first throw, so the runner's list is never the population (D462/D465).)  // 🆕🆕 D467 +2 sentences / +3 printings (THE ATTACKER'S OWN BENCH NARROWED BY A PRINTED NOUN, ON BOTH OF ITS COUNTING AXES — `censusAttackCorpus.ts` **file lines 544 and 622**, **2 sentences / 3 legal printings**, RAW summand ALONE. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 3** — MEASURE each site (D451/D461/D466).)
    // 🆕🆕 D466 +2 sentences / +3 printings (THE PRINTED EVOLUTION-STAGE ORDINAL AS A BODY FILTER — `censusAttackCorpus.ts` **file lines 586 and 589**, *"This attack does 40 damage for each of your Stage 1 Pokémon in play."* (1 legal, the `×` fold) and *"This attack does 40 more damage for each Stage 2 Pokémon on your Bench."* (2 legal, the `+` fold), **2 sentences / 3 legal printings**, claimed by `deriveAttackDamageMultiplier` and `deriveAttackDamageBonus` respectively. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 3** — two file lines carrying 1 and 2 printings, so a pass that copied one number into the other kind of site would be wrong at every site of the other kind (D451/D461); MEASURE each site. ONE new `CardFilter` member (`stagePokemon`, delegating to cards.ts `isStage1Pokemon`/`isStage2Pokemon`, which D387/D262 had already written for the `boardCondition` antecedents) and TWO new `IN_PLAY_BODY_NOUNS` rows — which is the WHOLE of file line 586, with **ZERO new anchors**, because D439's two shipped `in play` anchors already reached it and only the VOCABULARY refused. File line 589 costs ONE new anchor (`YOUR_BENCH_FILTERED_SCALE`) and ONE new OPTIONAL FIELD on the SHIPPED `yourBenchCount` member (`filter?: CardFilter`, D407's `energyOnSelf.zone` shape) — `undefined` is every body, so all ten shipped printings of that member emit a filter-less object byte for byte as before. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `packages/schema` bytes or `redact.ts` bytes; ONE new FIXTURE id (`fix-stage2body`) and ONE new attack on `fix-inplaybodies`. **`MATCH_RECORD_VERSION` STAYS 29 AT TWO ADDRESSES** — `CardFilter` IS persisted (D446 measured it: nine `EffectOp` fields carry one and an op rides `state.phase.cont.pendingOp`) and a WIDENING is free; `DamageCountSource` is PARSE-TIME and is not at a persisted address at all. 🛑 **`OPAQUE` MOVES, 81/116 → 80/114, AND `PHRASE-2` EMPTIES, 1/1 → 0/0 — AND THE INSTRUMENT STOOD STILL THIS SLICE** (`residue-census.ts` is untouched by D466), so unlike D465 this class-table delta really is a statement about the WORK.) 🆕🆕 D465 +1 sentence / +1 printing (THE RECOIL THAT SCALES OFF ITS OWN COUNTERS — `censusAttackCorpus.ts` **file line 500**, *"This Pokémon also does 10 damage to itself for each damage counter on it."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` arm 14 through ONE new anchor (`SELF_DAMAGE_PER_COUNTER`) and ONE new OPTIONAL FIELD on the SHIPPED `damageSelf` op (`perDamageCounterOnSelf`), folded by `recoilAmount` in `interpreter.ts` — `snipeAmount`'s `(op, state, ctx)` shape, the third rider of that kind. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE, 1 AND 1** — the OPPOSITE of D464's 1-vs-2 one slice ago, so a pass that inferred either from the other would have been right here and wrong then: MEASURE each site. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` MEMBERS, `DamageCountSource` kinds (`damageCountersOnSelf` already ships and is deliberately NOT used — it is a PARSE-TIME type no `EffectOp` carries), prompts, events, error codes, registry rows, FIXTURE ids, `packages/schema` bytes or `redact.ts` bytes; **`MATCH_RECORD_VERSION` STAYS 29 on D461's REACHABILITY shape** — `damageSelf` never parks and the only producer of the rider returns a program of LENGTH ONE, so the field can never sit in `phase.cont.rest` behind an earlier park. 🛑 **`OPAQUE` DOES NOT MOVE — 81/116 BEFORE AND AFTER** — because D465 FIXED `residue-census.ts`'s span probe FIRST, which reclassified this row out of `OPAQUE` into `PHRASE-6` before anything was built. The class it left is `PHRASE-6`.) 🆕🆕 D464 +1 sentence / +2 printings (THE FLIP-GATED STATUS THAT ALSO STRIPS AN ENERGY — `censusAttackCorpus.ts` **file line 264**, *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon."*, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackEffect` arm 2d through ONE new anchor (`FLIP_DEFENDER_STATUS_THEN_DISCARD`) whose program is arm 2's `applyStatus` followed by `FLIP_OPPONENT_ACTIVE_DISCARD`'s `discardEnergy` inside ONE `coinFlipGate`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2** — one file line carrying two legal printings, so a pass that copied one number into the other kind of site would be wrong at EVERY site (D463's agreed at 2 and 2, which is the trap in the other direction). RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op FIELDS, op VALUES or FIXTURE ids — `fix-oxford` index 2 ALREADY printed this sentence, as D462's loud control. 🛑 **`OPAQUE` MOVES FOR THE SECOND SLICE RUNNING** (87/125 → 86/123), and this row sat in it: no deletion and no substitution `residue-census.ts` can make reaches a built string, because the edit that would — deleting the trailing consequent — must take the sentence-final period with it.)
  });

  it("the population itself did not move — 640 sentences / 1,732 printings", () => {
    const rows = legalAttackCorpus();
    expect(rows).toHaveLength(640);
    expect(units(rows)).toBe(1732);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — purity, and the persisted bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — purity and the structural answers", () => {
  it("never mutates the board it is handed", () => {
    const frozen = deepFreeze(armed(firstSeedWithHeads(2), 3));
    const snapshot = JSON.stringify(frozen);
    expect(attack(frozen, REPEAT).state).not.toBe(frozen);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  it("replays identically for one seed", () => {
    const seed = firstSeedWithHeads(2);
    const a = attack(armed(seed, 3), REPEAT);
    const b = attack(armed(seed, 3), REPEAT);
    expect(b.state).toEqual(a.state);
    expect(b.events).toEqual(a.events);
  });

  it("🛑 `MATCH_RECORD_VERSION` STAYS 29 — DRIVEN, in three directions", () => {
    // ⚠️ `MATCH_RECORD_VERSION` is not exported from this package (it lives in
    // `apps/api/src/lobby/match.ts`), so the claim is DRIVEN the way D421–D424 and D462
    // drove theirs. The bump trigger is a PERSISTED structure gaining, renaming or losing
    // a required field.
    //
    // 🛑 **THE ARGUMENT IS THE SERIALIZED ALPHABET — D462's shape and not D461's
    // reachability**, and it has to be, because THIS slice does reach the continuation.
    // D461 could say "the op never parks, so it can never appear in `phase.cont.rest`";
    // that sentence is FALSE here and saying it would be the easy mistake. What is true is
    // narrower and stronger: `EffectContinuation.rest` has held `EffectOp[]` since M5, and
    // the ONLY op this slice ever puts there is
    // `discardEnergy {from:"opponentActive", filter:{kind:"anyEnergy"}}` — the same JSON
    // D43's bare sentence has produced for a hundred slices, and one that could already
    // sit in `rest` behind any program with a second op after it. **No new op, no new op
    // field, no new op value ⇒ no byte a v29 record can hold after this slice that it
    // could not hold before it.** The COUNT of copies is not a byte in the alphabet; an
    // array that already accepts N members does not gain a shape by holding two.
    const seed = firstSeedWithHeads(2);
    const parked = attack(armed(seed, 3), REPEAT).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");

    // DIRECTION 1 — FORWARD. Round-trip the PARKED board through JSON, which is what
    // persistence actually does to it, and resume from the bytes. A continuation that
    // did not survive serialization diverges here.
    const persisted = JSON.parse(JSON.stringify(parked)) as GameState;
    const pick = discardPrompt(parked).discardable[0]?.uid as string;
    const live = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });
    const replayed = mustApply(persisted, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });
    expect(replayed.events).toEqual(live.events);
    expect(replayed.state).toEqual(live.state);

    // DIRECTION 2 — WIDENING / ABSENT. The continuation's key set as a LITERAL rather
    // than as a diff between two boards of one build: a diff is blind to a key that grew
    // on both (D279). And every op in `rest` is checked against the shipped alphabet by
    // its FULL JSON, so a new field on the op would show as a longer string.
    expect(Object.keys(parked.phase.cont).sort()).toEqual(["ctx", "pendingOp", "rest"]);
    const shipped = '{"op":"discardEnergy","from":"opponentActive","filter":{"kind":"anyEnergy"}}';
    expect(JSON.stringify(parked.phase.cont.pendingOp)).toBe(shipped);
    for (const op of parked.phase.cont.rest) expect(JSON.stringify(op)).toBe(shipped);
    // …and it really is the SAME string the bare sentence's reader emits, which is the
    // alphabet argument stated as an equality rather than as an inventory.
    expect(JSON.stringify(deriveAttackEffect(BARE)?.[0])).toBe(shipped);

    // DIRECTION 3 — LOSS. Drop the `rest` array from the PERSISTED bytes and confirm a
    // v29 reader can SEE the loss. This is the direction a version argument usually
    // skips, and here it is the load-bearing one: if the second copy were not really in
    // the record, the "N parks" claim would be a statement about a log rather than about
    // a persisted board, and a resumed match would silently discard once.
    const lossy = JSON.parse(JSON.stringify(parked)) as GameState;
    if (lossy.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    (lossy.phase.cont as unknown as { rest: unknown[] }).rest = [];
    const truncated = mustApply(lossy, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });
    // The full record parks a second time; the truncated one ends the turn after ONE
    // discard. Two observable endings from bytes that differ only in `rest`.
    expect(live.state.phase.kind).toBe("effect:choose");
    expect(truncated.state.phase.kind).not.toBe("effect:choose");
    expect(types(truncated.events)).toContain("TURN_ENDED");
    expect(activeEnergy(truncated.state, "p2")).toHaveLength(2);
  });

  it("engineVersion is 0.400.0 and the bump is owed for BEHAVIOUR", () => {
    // 🆕🆕 D463 — 0.361.0 → **0.362.0**. Two printed sentences that derived to `null` now
    // derive to a program, and a fielded card (Krookodile sv01-117) that took no flip at
    // all now takes an unbounded sequence of them: an OBSERVABLE change to what the engine
    // does with real catalog rows, which is the bump's whole trigger.
    expect(engineVersion).toBe("0.400.0");
  });
});
