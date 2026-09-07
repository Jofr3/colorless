import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackTrailingClause } from "./effects";
import { applyAction, engineVersion } from "./index";
import type { GameEvent, GameState, Seat, StatusName } from "./index";
import {
  DEFENDER_STATUS_TRIPLE_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.360.0 → 0.361.0 — 🆕🆕 D462, THE THREE-STATUS OXFORD LIST. *"Your opponent's
// Active Pokémon is now Burned, Confused, and Poisoned."* — `censusAttackCorpus.ts`
// FILE LINE 679, **1 sentence / 2 legal printings** — THREE `applyStatus` ops in
// printed order behind ONE new anchor and the pair helper generalised to a LIST.
//
// 🛑 **WHAT THIS SLICE IS ACTUALLY ABOUT IS A REFUSAL THAT NAMED A SENTENCE WHILE
// PRICING A PARAMETER.** D424 measured this row, named it, and left it LOUD with a
// reason: *"the ONLY 3-status row in the column, so a 3-list template would be D121's
// literal over a pool of one"*. D121 prices a NEW parameter. This anchor adds none —
// `STATUS_WORDS` is D424's own vocabulary, warranted there on THREE distinct printed
// pairs with BOTH slots varying, and the third slot is that SAME parameter at one more
// position. The pool of one was the SENTENCE's and never the parameter's, and the
// distance between those two claims is the whole of this slice.
//
// ⚠️ **ZERO NEW MECHANISM, AND THAT IS THE MEASURED CLAIM RATHER THAN A BOAST.** No
// new `EffectOp` member, no new op FIELD, no new op VALUE, no new reader (the surface
// stands still at 13, asserted in §6), no prompt, no event, no registry row, no
// `packages/schema` byte and no `redact.ts` byte. The program is three of an op the
// engine has run since 0.x — which is also the whole `MATCH_RECORD_VERSION` argument
// (§7): the serialized ALPHABET does not move.
//
// ⚠️ **THE CARRIERS ARE UNRESOLVED AND SAID SO (D425).** The row has 2 legal
// printings and this checkout has no D1, so `fix-oxford` is SYNTHETIC. The STRING is
// the corpus row byte for byte (§1); nothing else about the body is transcription.

/** Corpus FILE LINE 679, byte for byte. ⚠️ THE APOSTROPHE IS ASCII U+0027 and the
    `é` is U+00E9 — asserted in §1 off the corpus rather than eyeballed, which is the
    check D424 paid for after a brief asserted U+2019 for a sibling sentence. */
const OXFORD = "Your opponent's Active Pokémon is now Burned, Confused, and Poisoned.";

/** Corpus FILE LINE 264 — a REAL legal printing (2) that NO reader claims, and the
    one printed NEAR MISS of the new anchor: it opens exactly like a coin-flipped
    Oxford list and puts an OP where the second status word would go.

    🆕🆕 **D464 — BOTH HALVES OF THAT SENTENCE ARE NOW STALE, AND THE SECOND ONE WAS
    NEVER TRUE.** It is no longer unclaimed: `FLIP_DEFENDER_STATUS_THEN_DISCARD` builds
    it, into a `coinFlipGate` carrying the `applyStatus` AND the `discardEnergy`. And it
    was never a near miss OF THIS ANCHOR — measured over all 640 rows,
    `DEFENDER_STATUS_TRIPLE` claims exactly one row / 2 printings under every single-axis
    loosening it has (any slot widened to `(.+)`, the `^` dropped, the `\.$` dropped), and
    this string is in none of them: after *"is now Paralyzed"* the anchor demands a SECOND
    comma this sentence never prints, and the `^Your opponent` prefix refuses the flip
    clause besides. The anchor that really refused it was `FLIP_DEFENDER_NOW`, by its
    `\.$`. The name is kept so the provenance is readable; the claims are corrected in
    §2. */
const COMMA_NEAR_MISS =
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon.";

/** 🛑 THE COLLISION SENTENCES, AND THEY ARE CONSTRUCTED — SAID OUT LOUD, D424's rule
    verbatim. No card prints a three-word list at all except row 679, so the refusal
    can only ever be driven SYNTHETICALLY. Each of these puts TWO `rotation` words in
    one list (or one word twice), which `defenderStatusOps` refuses because both would
    write `SpecialConditions.rotation` and the later op would silently eat the earlier
    — a program that RESOLVES and leaves the board carrying fewer conditions than the
    sentence printed. */
const COLLISIONS = [
  "Your opponent's Active Pokémon is now Asleep, Confused, and Poisoned.",
  "Your opponent's Active Pokémon is now Confused, Paralyzed, and Burned.",
  "Your opponent's Active Pokémon is now Burned, Asleep, and Paralyzed.",
  "Your opponent's Active Pokémon is now Poisoned, Asleep, and Confused.",
  "Your opponent's Active Pokémon is now Burned, Burned, and Poisoned.",
  "Your opponent's Active Pokémon is now Poisoned, Confused, and Poisoned.",
] as const;

/** ⚠️ THE CONTROL WITHOUT WHICH §3 WOULD BE A TAUTOLOGY (D424's rule). Three
    slot-disjoint words in an order NO card prints: it must be ADMITTED, so
    *"refuse every three-word list"* cannot pass this suite. */
const UNPRINTED_BUT_COHERENT = "Your opponent's Active Pokémon is now Poisoned, Confused, and Burned.";

/** 🆕🆕 D464 — corpus FILE LINES 685, 686 and 690, one printing each. The set
    `DEFENDER_NOW`'s `\.$` MEASURABLY refuses: strict it claims 4 rows / 74 printings,
    and with that one byte gone it claims 16 / 96 — these three among the twelve it
    gains, each with a second clause the engine cannot run. They carry §5's attribution
    control now that `COMMA_NEAR_MISS` derives. */
const DOT_ANCHOR_TRIO = [
  "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.",
  "Your opponent's Active Pokémon is now Confused. You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like.",
  "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, Energy cards can't be attached from your opponent's hand to that Pokémon.",
] as const;

const SEED = 11;

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

/** `fix-oxford` Active for `by`, `fix-titan` Active for the other seat, benches
    cleared on both sides so no stray body can absorb anything. Two {C} cover every
    index's cost. */
function board(by: Seat = "p1", seed = SEED): GameState {
  const opener: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        seed,
        { p1: DEFENDER_STATUS_TRIPLE_DECK, p2: DEFENDER_STATUS_TRIPLE_DECK },
        { first: opener },
      ),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-oxford");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 2);
  state = setActiveFromDeck(state, opener, "fix-titan");
  state = clearBench(state, opener);
  return state;
}
function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}
/** Re-text ONE attack on a board's OWN `cardPool` copy. ⚠️ NOT a fixture edit —
    `FIXTURE_POOL` is shared by every suite in this package and D412 reddened three
    boards by widening a shared fixture. It exists for the constructed sentences of
    §3, which have no printing and can have no fixture. */
function withEffect(state: GameState, effect: string, index = 0): GameState {
  const card = state.cardPool["fix-oxford"];
  if (card === undefined) throw new Error("no fix-oxford in pool");
  const attacks = [...(card.attacks ?? [])];
  const at = attacks[index];
  if (at === undefined) throw new Error(`fix-oxford has no attack ${index}`);
  attacks[index] = { ...at, effect };
  return { ...state, cardPool: { ...state.cardPool, "fix-oxford": { ...card, attacks } } };
}
/** The defender's live `SpecialConditions`, read from the seat that is NOT attacking. */
function defenderConditions(state: GameState, by: Seat = "p1") {
  const active = state.players[by === "p1" ? "p2" : "p1"].active;
  if (active === null) throw new Error("no defender");
  return active.conditions;
}
/** The status words a derived program lands, or `null` when the program is not a
    LIST of `applyStatus` ops. Keyed on the OPS rather than on the sentence, so a
    regex that had drifted into a floating match is still caught here. */
function statusListOf(text: string): StatusName[] | null {
  const ops = deriveAttackEffect(text);
  if (ops === null || ops.length === 0) return null;
  const statuses = ops.map((o) => (o.op === "applyStatus" ? o.status : null));
  return statuses.every((x): x is StatusName => x !== null) ? statuses : null;
}
const units = (rows: readonly (readonly [number, string])[]) =>
  rows.reduce((sum, [n]) => sum + n, 0);

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, transcribed rather than recognised.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed data, transcribed rather than recognised", () => {
  it("🛑 both sentences are the CORPUS's bytes, and the apostrophe is ASCII U+0027", () => {
    // D183's rule: author and assert against the printed bytes, never a paraphrase.
    const rows = new Map(legalAttackCorpus().map(([n, text]) => [text, n]));
    expect(rows.get(OXFORD)).toBe(2);
    expect(rows.get(COMMA_NEAR_MISS)).toBe(2);
    for (const s of [OXFORD, COMMA_NEAR_MISS]) {
      expect(s.includes("opponent's")).toBe(true);
      expect(s.includes("opponent’s")).toBe(false);
      expect(s.includes("Pokémon")).toBe(true);
    }
  });

  it("the fixture carries the corpus strings, at the indices the suite drives", () => {
    // ⚠️ SYNTHETIC BY NECESSITY AND SAID SO (D425): 2 legal printings, no D1 in this
    // checkout, so the carriers are UNRESOLVED. Only the STRING is transcription.
    expect(FIXTURE_POOL["fix-oxford"]).toMatchObject({
      category: "Pokemon",
      stage: "Basic",
      hp: 130,
      types: ["Psychic"],
      retreat: 1,
    });
    expect(FIXTURE_POOL["fix-oxford"]?.abilities ?? null).toBeNull();
    expect(FIXTURE_POOL["fix-oxford"]?.attacks).toEqual([
      { cost: ["Colorless", "Colorless"], name: "Triple Bloom", effect: OXFORD, damage: 50 },
      { cost: ["Colorless"], name: "Bare Bloom", effect: OXFORD },
      { cost: ["Colorless"], name: "Comma Bloom", effect: COMMA_NEAR_MISS, damage: 10 },
    ]);
    // Index 1 prints NO damage at all — the whole reason it is here.
    expect(FIXTURE_POOL["fix-oxford"]?.attacks?.[1]).not.toHaveProperty("damage");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the derivation, and the POPULATION it was measured on.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the derivation, and the population it was measured on", () => {
  it("the sentence derives to THREE applyStatus ops in PRINTED order", () => {
    expect(deriveAttackEffect(OXFORD)).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
      { op: "applyStatus", target: "defender", status: "confused" },
      { op: "applyStatus", target: "defender", status: "poisoned" },
    ]);
  });

  it("🛑 ZERO false positives over the WHOLE 640-sentence column — one row, two printings", () => {
    // ⚠️ THE SWEEP IS OVER THE POPULATION, not over the rows this slice went looking
    // for (D423). An anchor that had drifted into a floating match shows up here and
    // nowhere else.
    const hits = legalAttackCorpus().filter(([, s]) => {
      const ops = deriveAttackEffect(s);
      return ops !== null && ops.length === 3 && ops.every((o) => o.op === "applyStatus");
    });
    expect(hits.map(([, s]) => s)).toEqual([OXFORD]);
    expect(units(hits)).toBe(2);
  });

  it("🛑 the column prints exactly ONE three-status list, and ZERO flipped ones", () => {
    // The refusal in `DEFENDER_STATUS_TRIPLE`'s doc block, asserted rather than
    // remembered. D424 took the pair's coin-flipped twin because the column PRINTS it;
    // there is no flipped Oxford list to take, so no flip arm was written. **AN EMPTY
    // RESULT IS A FINDING** — this is the site that keeps it a measured one.
    const W = "(?:Asleep|Burned|Confused|Paralyzed|Poisoned)";
    const list = new RegExp(`is now ${W}, ${W}, and ${W}\\.$`);
    const flipped = new RegExp(`^Flip a coin\\. If heads, .*is now ${W}, ${W}, and ${W}\\.$`);
    const rows = legalAttackCorpus();
    expect(rows.filter(([, s]) => list.test(s)).map(([, s]) => s)).toEqual([OXFORD]);
    expect(rows.filter(([, s]) => flipped.test(s))).toEqual([]);
    // ⚠️ AND THE LOOSER SHAPE FINDS THE NEAR MISS, which is why the vocabulary in the
    // second capture group is load-bearing rather than decorative: `is now (X),` has
    // TWO rows in this column and only one of them is a list.
    const looseComma = new RegExp(`is now ${W}, `);
    expect(rows.filter(([, s]) => looseComma.test(s)).map(([, s]) => s).sort()).toEqual(
      [OXFORD, COMMA_NEAR_MISS].sort(),
    );
  });

  it("🆕🆕 D464 — the printed NEAR MISS is BUILT now, and this anchor is untouched by it", () => {
    // 🛑 RE-POINTED, NOT DELETED (D418). The old rung asserted three nullities on corpus
    // line 264 and titled them *"the vocabulary is why"*. D464 built the sentence, so the
    // nullities had to go — and re-deriving the reason showed the title was false besides:
    // this anchor cannot reach line 264 under ANY single-axis loosening (§2's next rung
    // measures that), so its capture groups were never what refused it.
    //
    // What replaces the nullities is STRICTLY STRONGER than they were (D449's rule): the
    // sentence must derive to the TWO-op program in PRINTED ORDER. That goes red under the
    // drift the old rung caught — an anchor loosening that claims line 264 and drops its
    // Energy discard now yields a WRONG program instead of a null — and it also goes red
    // under a drift that lands the ops in the wrong order, which `toBeNull` never could.
    expect(deriveAttackEffect(COMMA_NEAR_MISS)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          { op: "applyStatus", target: "defender", status: "paralyzed" },
          { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } },
        ],
      },
    ]);
    expect(resolvedByAnyReader(COMMA_NEAR_MISS)).toBe(true);
    // …and it is still the DERIVER that answers, not a splitter — the half of the old
    // rung that survives the inversion unchanged.
    expect(splitAttackTrailingClause(COMMA_NEAR_MISS)).toBeNull();
  });

  it("🛑 D462's stated reason was wrong, and this is the regex that says so", () => {
    // 🛑 D462's doc block: *"It is refused by the SECOND capture group and by nothing
    // else: drop `(${STATUS_WORDS})` to `(.+)` and this anchor eats a sentence whose
    // Energy discard it would silently throw away."* MEASURED over the POPULATION, this
    // anchor claims ONE row / 2 printings under every loosening available to it, and line
    // 264 is in none of them. A doc block that names the byte doing a refusal is one regex
    // from being checked; this is that regex, kept so the claim cannot rot back.
    const W = "(?:Asleep|Burned|Confused|Paralyzed|Poisoned)";
    const rows = legalAttackCorpus();
    const hit = (re: RegExp) => rows.filter(([, s]) => re.test(s));
    for (const re of [
      new RegExp(`^Your opponent['’]s Active Pokémon is now (${W}), (${W}), and (${W})\\.$`),
      new RegExp(`^Your opponent['’]s Active Pokémon is now (.+), (${W}), and (${W})\\.$`),
      new RegExp(`^Your opponent['’]s Active Pokémon is now (${W}), (.+), and (${W})\\.$`),
      new RegExp(`^Your opponent['’]s Active Pokémon is now (${W}), (${W}), and (.+)\\.$`),
      new RegExp(`Your opponent['’]s Active Pokémon is now (${W}), (${W}), and (${W})\\.$`),
      new RegExp(`^Your opponent['’]s Active Pokémon is now (${W}), (${W}), and (${W})`),
    ]) {
      expect(hit(re).map(([, s]) => s)).toEqual([OXFORD]);
      expect(re.test(COMMA_NEAR_MISS)).toBe(false);
    }
    // The anchor that DID refuse it, and the size of the drift it holds back: 2 rows / 29
    // printings strict, 6 / 35 with the `\.$` gone — line 264 among the four gained.
    const flipStrict = new RegExp(`^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${W})\\.$`);
    const flipDrift = new RegExp(`^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${W})`);
    expect([hit(flipStrict).length, hit(flipStrict).reduce((a, [n]) => a + n, 0)]).toEqual([2, 29]);
    expect([hit(flipDrift).length, hit(flipDrift).reduce((a, [n]) => a + n, 0)]).toEqual([6, 35]);
    expect(flipStrict.test(COMMA_NEAR_MISS)).toBe(false);
    expect(flipDrift.test(COMMA_NEAR_MISS)).toBe(true);
  });

  it("🛑 the FLIPPED Oxford list is refused — there is no flip arm, by choice", () => {
    // The refusal `DEFENDER_STATUS_TRIPLE`'s doc block records, made LIVE rather than
    // left as prose. D424 took the pair's coin-flipped twin because the column prints
    // it; this list has no flipped printing (the rung above measures ZERO), so no flip
    // arm was written — and the anchor's `^` is what keeps a floating match from
    // claiming the flipped sentence and landing three conditions with **no coin at
    // all**, on TAILS as well as heads.
    expect(deriveAttackEffect(`Flip a coin. If heads, ${OXFORD.slice(0, 1).toLowerCase()}${OXFORD.slice(1)}`)).toBeNull();
    expect(deriveAttackEffect(`Flip a coin. If heads, ${OXFORD}`)).toBeNull();
  });

  it("the older anchors are untouched — the four `is now` shapes are disjoint", () => {
    // ORDER against arms 1, 2 and 2b is a REFACTOR and not behaviour: `(X)` admits no
    // comma and no space, so no string can be claimed by two of these anchors. Stated
    // as a rung because it is exactly what a fourth anchor could fail to have.
    expect(statusListOf("Your opponent's Active Pokémon is now Asleep.")).toEqual(["asleep"]);
    expect(statusListOf("Your opponent's Active Pokémon is now Burned and Confused.")).toEqual([
      "burned",
      "confused",
    ]);
    expect(statusListOf(OXFORD)).toEqual(["burned", "confused", "poisoned"]);
    // The trailing-clause compound of the PAIR family still composes rather than being
    // shadowed — the triple anchor's `\.$` is what keeps it out of the way.
    expect(
      splitAttackTrailingClause(
        "Your opponent's Active Pokémon is now Confused and Poisoned. Switch this Pokémon with 1 of your Benched Pokémon.",
      ),
    ).not.toBeNull();
    // …and a trailing clause after the OXFORD list is claimed by nobody, whole or split.
    expect(deriveAttackEffect(`${OXFORD} Draw a card.`)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the refusal, and the admission that stops it being a tautology.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the slot collision, refused by a derivation rather than a blocklist", () => {
  it("🛑 a list with two words in ONE `SpecialConditions` field derives to null", () => {
    for (const text of COLLISIONS) expect(deriveAttackEffect(text)).toBeNull();
  });

  it("⚠️ …AND a coherent list NO card prints is ADMITTED — the control", () => {
    // Without this, "refuse every three-word list" passes the rung above (D424's rule:
    // every "X is refused" owes a neighbouring "Y is admitted").
    expect(deriveAttackEffect(UNPRINTED_BUT_COHERENT)).toEqual([
      { op: "applyStatus", target: "defender", status: "poisoned" },
      { op: "applyStatus", target: "defender", status: "confused" },
      { op: "applyStatus", target: "defender", status: "burned" },
    ]);
  });

  it("🛑 ZERO of the 1,732 printings carries a colliding list — the population claim", () => {
    // The refusal is UNREACHABLE from the catalog, which is why it is driven
    // synthetically above. Asserted on the POPULATION, not on a specimen (D423).
    const W = "(?:Asleep|Burned|Confused|Paralyzed|Poisoned)";
    const list = new RegExp(`is now (${W}), (${W}), and (${W})\\.$`);
    const SLOT: Record<string, string> = {
      Asleep: "rotation",
      Paralyzed: "rotation",
      Confused: "rotation",
      Poisoned: "poisonDamage",
      Burned: "burned",
    };
    const colliding = legalAttackCorpus().filter(([, s]) => {
      const m = list.exec(s);
      if (m === null) return false;
      const slots = [m[1], m[2], m[3]].map((w) => SLOT[w as string]);
      return new Set(slots).size !== slots.length;
    });
    expect(colliding).toEqual([]);
  });

  it("a REFUSED list returns null from the whole reader, not a partial program", () => {
    // The dangerous alternative is not "no program" but "two of the three printed
    // conditions" — a program that RESOLVES while the board carries less than the card
    // says. Asserted as an absence of ops rather than as a count.
    for (const text of COLLISIONS) expect(statusListOf(text)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the board, on both printed indices.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the board: three conditions land, and all three are observable", () => {
  it("index 0 (50 damage) lands Burned, Confused AND Poisoned on the defender", () => {
    const { state } = swing(board(), 0);
    expect(defenderConditions(state)).toEqual({
      burned: true,
      rotation: "confused",
      poisonDamage: 10,
    });
  });

  it("…and TWO of the three conditions are visible in the DAMAGE, not just the log", () => {
    // 🛑 THE ARITHMETIC IS THE POINT AND IT IS DETERMINISTIC. An attack ENDS the turn
    // (§5.3), so the Checkup runs before this state is handed back: the printed 50,
    // plus BURN's 20, plus POISON's default 10 = **80**. Confused places nothing, which
    // is why §4's first rung reads the model and this one reads the total — between
    // them all three printed words have a consequence a board can see.
    //
    // ⚠️ THE THREE TICKS ARE UNCONDITIONAL EVEN THOUGH BURN TAKES A COIN: the counters
    // are placed first and the flip only decides whether the condition SURVIVES, so
    // this number does not depend on the seed. The `burned: true` in the rungs either
    // side of it DOES — see the coin rung below.
    const { state } = swing(board(), 0);
    expect(state.players.p2.active?.damage).toBe(80);
  });

  it("index 1 (NO printed damage) lands the same three, and the 30 is all Checkup", () => {
    // A reader keyed on the presence of a `damage` key satisfies index 0 and fails
    // here — the substitute for D424's second BODY, which this slice cannot resolve.
    // 50 → 0 on the printed hit, and the same 30 of Checkup tick: the difference
    // between the two indices is exactly the printed number and nothing else.
    const { state } = swing(board(), 1);
    expect(defenderConditions(state)).toEqual({
      burned: true,
      rotation: "confused",
      poisonDamage: 10,
    });
    expect(state.players.p2.active?.damage).toBe(30);
  });

  it("⚠️ the surviving BURN is the seed's coin, said out loud rather than assumed", () => {
    // 🛑 THE DECK IS NOT SEED-FREE AND THE SUITE MUST NOT PRETEND IT IS. Burn's §12
    // recovery is a coin flip; at SEED 11 it comes up tails on this board, which is why
    // `burned: true` survives into the rungs above. The dependency is named HERE, with
    // the flip asserted, so a future seed change reddens THIS rung with an explanation
    // rather than reddening two board assertions with none.
    const { events } = swing(board(), 0);
    const flips = all(events, "CHECKUP_COIN_FLIP").filter((f) => f.status === "burned");
    expect(flips.map((f) => f.result)).toEqual(["tails"]);
    // …and no STATUS_CLEARED row followed it, which is the other half of the same fact.
    expect(all(events, "STATUS_CLEARED")).toEqual([]);
  });

  it("🛑 THREE `STATUS_APPLIED` rows, in PRINTED order, on the defender's uid", () => {
    // The order is unobservable on the BOARD — the three writes are disjoint by
    // construction, so either order reaches a byte-identical `conditions`. Only this
    // sequence and the derived program can see it, which is why both are asserted.
    const { state, events } = swing(board(), 0);
    const rows = all(events, "STATUS_APPLIED");
    expect(rows.map((r) => r.status)).toEqual(["burned", "confused", "poisoned"]);
    const uid = state.players.p2.active?.stack.at(-1);
    expect(new Set(rows.map((r) => r.uid))).toEqual(new Set([uid]));
    expect(new Set(rows.map((r) => r.seat))).toEqual(new Set(["p2"]));
    // Poison's row carries the DEFAULT damage — the field is read, not defaulted at
    // the board.
    expect(rows.find((r) => r.status === "poisoned")?.poisonDamage).toBe(10);
  });

  it("the SEAT comes off the printed possessive, driven from the other side too", () => {
    const { state } = swing(board("p2"), 0, "p2");
    expect(defenderConditions(state, "p2")).toEqual({
      burned: true,
      rotation: "confused",
      poisonDamage: 10,
    });
    // …and the attacker's own body took none of them.
    expect(state.players.p2.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the loud path, with its attribution control.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the printed text stops being flagged, and the loud path still works", () => {
  it("neither printed index reports a skipped effect any more", () => {
    for (const index of [0, 1]) {
      expect(find(swing(board(), index).events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    }
  });

  it("🆕 D464 — index 2 stops being flagged too, because D464 built it", () => {
    // The rung this replaces asserted index 2 was STILL skipped, as this suite's
    // attribution control. D464 built corpus line 264, so the assertion inverts (D418) —
    // and the control it provided is re-pointed one rung down rather than dropped.
    expect(find(swing(board(), 2).events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("🛑 THE ATTRIBUTION CONTROL, RE-POINTED: three REAL printings are still flagged (D214)", () => {
    // Without a control, "no skip marker" could be true because the marker stopped being
    // emitted at all. These are corpus FILE LINES 685, 686 and 690 — real legal printings,
    // one each, whose second clause is an unbuilt mechanic — and they are the set
    // `DEFENDER_NOW`'s `\.$` measurably refuses, which is what the old control was
    // believed to be and was not (see §2).
    for (const text of DOT_ANCHOR_TRIO) {
      const doctored = withEffect(board(), text);
      expect(find(swing(doctored, 0).events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(text);
    }
  });

  it("…and a CONSTRUCTED colliding list is announced too — the refusal is loud", () => {
    for (const text of COLLISIONS) {
      const doctored = withEffect(board(), text);
      expect(find(swing(doctored, 0).events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(text);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the census moves in exactly ONE summand, and the step is 1 and 2.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the census moves in exactly ONE summand", () => {
  it("the reader SURFACE stands still at 13 — this slice adds an ARM, not a reader", () => {
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 the resolving corpus gains ONE sentence and TWO printings", () => {
    // ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2 — the one file line
    // carries 2 legal printings, so a pass that copied one number into the other kind
    // of site would be wrong at EVERY site (D451/D461's finding, paid here).
    const rows = legalAttackCorpus();
    const resolved = rows.filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([516, 1545]);  // (🆕🆕🆕 D483 +2 sentences / +2 printings — THE PRINTED CANDIDATE **CLASS** ON THE BENCHED SNIPE, `censusAttackCorpus.ts` FILE LINES **111** and **615**, **2 sentences / 2 legal printings**, both claimed WHOLE by `deriveAttackEffect` (arms 9b-bis and 6c) through ONE new group on the SHARED fragment `ALSO_BENCHED_SNIPE_BODY` and ONE new OPTIONAL op field `damageChosen.filter?: CardFilter`. RAW summand ALONE; reader surface still 13. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 2 AND 2, MEASURED at this head.) // (🆕🆕 D482 +1 sentence / +1 printing — THE WHOLE-SIDE SPREAD, `censusAttackCorpus.ts` FILE LINE **572**, *"This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` arm 6a-bis through ONE new anchor `SPREAD_EACH_OPPONENT_POKEMON` over a TWO-OP PROGRAM OF SHIPPED OPS (`damageDefender` flat + `spreadDamage { target: "opponentBench" }`) — **ZERO new op members, fields, values or `interpreter.ts` bytes**, reader surface still 13. RAW summand ALONE: no registry row, no gate split, no trailing split. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1.)// (🆕🆕 D479 +1 sentence / +1 printing — THE ATTACK-SIDE HAND REFRESH, `censusAttackCorpus.ts` FILE LINE 486, *"Shuffle your hand into your deck. Then, draw {N} cards."*, 1 sentence / 1 legal printing, claimed WHOLE by `deriveAttackEffect` arm 44b through ONE new anchor `SHUFFLE_HAND_DRAW` over `handRefresh { who: "you", draw: { kind: "fixed", count } }` — Youngster `sv01-198`'s hand-authored trainer program at a second address, so ZERO new `EffectOp` members, op FIELDS, op VALUES, readers (surface still 13), prompts, events, `interpreter.ts` or `redact.ts` bytes. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1, unlike D478's 1-vs-2 — derived here, not carried.) // (D478 +1 sentence / +2 printings — THE OTHER BRANCH OF A GATE THAT ALREADY SHIPS, `censusAttackCorpus.ts` FILE LINE 263, *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused."*, 1 sentence / 2 legal printings, claimed WHOLE by `deriveAttackEffect` arm 2b-bis through ONE new anchor `FLIP_DEFENDER_PAIR_OR_TAILS_STATUS` over a `coinFlipGate` with BOTH arms filled. `coinFlipGate.otherwise` shipped at D269 and arm 6d has emitted a two-armed gate since D416, so the mechanism the old refusal called absent was 209 decisions old. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2 — one file line, two legal printings; D476's and D475's agreed at 1 and 1, so this term was DERIVED here and not carried. RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414), ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events or `interpreter.ts` bytes.) // (🆕🆕 D476 +1 sentence / +1 printing — THE FACE AXIS, THE LAST OPEN AXIS OF THE PRINTED PER-FACE FAMILY — `censusAttackCorpus.ts` **FILE LINE 217**, *"Flip 3 coins. For each tails, discard an Energy from this Pokémon."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_SELF_ENERGY_PER_TAILS`) and ONE **REQUIRED** `face: CoinFace` FIELD on the shipped `programPerHeads` member. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — D472's disagreed at 1 and 2, D473's agreed at 2 and 2, D474's disagreed at 1 and 2, D475's agreed at 1 and 1 — so this term was DERIVED at this head and not carried from the previous slice (D451/D461/D464). RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, and **ZERO new `FIXTURE_POOL` ids** (file-local `cardPool`, D414), so every id ladder takes a ZERO term. ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events, error codes or `AttackCoinFlip` MEMBERS — the op is `SELF_DISCARD_ONE`'s output byte for byte, and the FACE rides the member that already shipped.) // (🆕🆕 D475 +1 sentence / +1 printing — THE COIN FLIP COUNTED OVER BOTH ACTIVES — `censusAttackCorpus.ts` **FILE LINE 231**, *"Flip a coin for each Energy attached to both Active Pokémon. This attack does 60 damage for each heads."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor and a FIFTH, NULLARY `AttackFlipCount` member `bothActivesEnergy`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — D472's disagreed at 1 and 2, D473's agreed at 2 and 2, D474's disagreed at 1 and 2, so this term was DERIVED at this head and not carried from the previous slice (D451/D461/D464). RAW summand ALONE: no registry row, no gate split, no trailing split, D464's compound route measured EMPTY, reader surface still 13, and **NO new `FIXTURE_POOL` id** — the printed sentence has sat on `fix-bothactives` index 2 as a refusal witness since D196, so every id ladder takes a ZERO term.) // 🆕🆕 D474 +1 sentence / +2 printings (THE BOARD-COUNTED COIN FLIP OVER BODIES — `censusAttackCorpus.ts` **FILE LINE 233**, *"Flip a coin for each {D} Pokémon you have in play. This attack does 60 damage for each heads."*, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor and ONE new `AttackFlipCount` member `pokemonInPlay`. ⚠️ **THIS IS A LIVE HEAD, NOT A FROZEN TAIL** (D461/D462): the literal moves and there is no front term to add. ⚠️ **AND THE TWO UNITS DISAGREE, 1 AND 2** — the opposite of D473's 2-and-2 — so the number here was read off THIS assertion's head rather than copied from a sibling site. RAW summand ALONE: no registry row, no gate split, no trailing split, D464's compound route measured EMPTY, reader surface still 13.) // 🆕🆕 D470 +1 sentence / +1 printing (THE BOARD-WIDE OWN-SIDE ENERGY COUNT, NARROWED BY A PRINTED SUBGROUP NOUN — `censusAttackCorpus.ts` **FILE LINE 558**, *"This attack does 20 more damage for each {L} Energy attached to all of your Iono's Pokémon."*, **1 legal printing**, claimed WHOLE by `deriveAttackDamageBonus` through the new `SELF_ENERGY_FILTERED_SCALE` anchor. ONE anchor, ONE reader arm, ONE **OPTIONAL FIELD ON THE SHIPPED** `energyOnSelf` member (`filter?: CardFilter`), ONE evaluator branch and ONE **OPTIONAL PARAMETER ON THE SHARED** `countEnergyInPlay` — whose THREE call sites (`energyOnOpponent`'s board arm, `energyOnSelf`'s, and `interpreter.ts`'s `yourEnergyInPlayAtLeast`, the third of which is NOT an op) are byte-identical, because `undefined` is every body. D454's blast radius, ENUMERATED before a byte was written. DISJOINT FROM `SELF_ENERGY_SCALE` BY STRUCTURE and not by the lookahead, which D467/D468 require saying: both are `^…$` and this one demands a run of bytes ending in a SPACE that the shipped literal cannot spend; the `(?!opponent)` lookahead is a DIFFERENT guard doing a DIFFERENT job (it refuses a SEAT, not a subgroup) and it IS killable. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `CardFilter` MEMBERS, `packages/schema` bytes or `redact.ts` bytes; ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414). **`MATCH_RECORD_VERSION` STAYS 29** — an `AttackDamageBonus` is a parse-time LOCAL inside `attack()`, and `CardFilter` IS persisted but gains no MEMBER here (`ownerPokemon` has been an inhabitant since D242), driven over the SERIALIZED BYTES in `ownerBoardEnergyScaling.test.ts` §8.)
    // 🆕🆕 D469 +1 sentence / +1 printing (THE OPPONENT'S WHOLE BOARD OF DAMAGE COUNTERS — `censusAttackCorpus.ts` **FILE LINE 534**, *"This attack does 10 more damage for each damage counter on all of your opponent's Pokémon."*, **1 legal printing**, claimed WHOLE by `deriveAttackDamageBonus` through the new `OPPONENT_BOARD_COUNTER_SCALE` anchor. ONE anchor, ONE reader arm, ONE NULLARY `DamageCountSource` member (`damageCountersOnOpponentBoard`), ONE evaluator arm and ONE shared board counter (`countDamageCountersInPlay`, continuous.ts, beside `countEnergyInPlay`/`countToolsInPlay`) — D406's cost table verbatim, at a second address. DISJOINT FROM `OPPONENT_COUNTER_SCALE` BY STRUCTURE and not by a lookahead, which D467/D468 require saying: both are `^…$` and disagree on a mandatory run of bytes at the same position. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `packages/schema` bytes or `redact.ts` bytes; ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414). **`MATCH_RECORD_VERSION` STAYS 29** — an `AttackDamageBonus` is a parse-time LOCAL inside `attack()` and there is no carrier at all, driven over the SERIALIZED BYTES in `opponentBoardCounterScaling.test.ts` §8 rather than reasoned from the type's name (D427).) // 🆕🆕 D468 +1 sentence / +1 printing (THE TYPED SELF-SWITCH — `censusAttackCorpus.ts` **FILE LINE 499**, *"Switch this Pokémon with 1 of your Benched {L} Pokémon."*, **1 legal printing**. ⚠️ **A LIVE HEAD, NOT A CHAIN — SO THE LITERAL MOVES AND NOTHING IS ADDED AT THE FRONT** (D461's table: the tell is the left-hand side of the assertion). ⚠️ **AND THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 HERE**, which is the easy case and is not a shape that carries — D467's was 2 vs 3.)  // 🆕🆕 D467 +2 sentences / +3 printings (THE ATTACKER'S OWN BENCH NARROWED BY A PRINTED NOUN, ON BOTH OF ITS COUNTING AXES — `censusAttackCorpus.ts` **file lines 544 and 622**, *"This attack does 20 damage for each damage counter on all of your Benched {F} Pokémon."* (2 legal, the `×` fold) and *"This attack does 80 more damage for each of your Benched Charjabug."* (1 legal, the `+` fold), **2 sentences / 3 legal printings**. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 3** — two file lines carrying 2 and 1 printings, so MEASURE each site rather than copying one number into the other kind (D451/D461/D466). RAW summand ALONE: no registry row, no gate split, no trailing split, and the reader surface stands still at 13. TWO new anchors, ONE new OPTIONAL field on the shipped `damageCountersOnYourBench` member, ONE new `IN_PLAY_BODY_NOUNS` row and ZERO new `CardFilter` members — so `MATCH_RECORD_VERSION` STAYS 29 on the SERIALIZED-ALPHABET shape (D462) at ONE address, not two.)
    // 🆕🆕 D466 +2 sentences / +3 printings (THE PRINTED EVOLUTION-STAGE ORDINAL AS A BODY FILTER — `censusAttackCorpus.ts` **file lines 586 and 589**, *"This attack does 40 damage for each of your Stage 1 Pokémon in play."* (1 legal, the `×` fold) and *"This attack does 40 more damage for each Stage 2 Pokémon on your Bench."* (2 legal, the `+` fold), **2 sentences / 3 legal printings**, claimed by `deriveAttackDamageMultiplier` and `deriveAttackDamageBonus` respectively. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 3** — two file lines carrying 1 and 2 printings, so a pass that copied one number into the other kind of site would be wrong at every site of the other kind (D451/D461); MEASURE each site. ONE new `CardFilter` member (`stagePokemon`, delegating to cards.ts `isStage1Pokemon`/`isStage2Pokemon`, which D387/D262 had already written for the `boardCondition` antecedents) and TWO new `IN_PLAY_BODY_NOUNS` rows — which is the WHOLE of file line 586, with **ZERO new anchors**, because D439's two shipped `in play` anchors already reached it and only the VOCABULARY refused. File line 589 costs ONE new anchor (`YOUR_BENCH_FILTERED_SCALE`) and ONE new OPTIONAL FIELD on the SHIPPED `yourBenchCount` member (`filter?: CardFilter`, D407's `energyOnSelf.zone` shape) — `undefined` is every body, so all ten shipped printings of that member emit a filter-less object byte for byte as before. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `packages/schema` bytes or `redact.ts` bytes; ONE new FIXTURE id (`fix-stage2body`) and ONE new attack on `fix-inplaybodies`. **`MATCH_RECORD_VERSION` STAYS 29 AT TWO ADDRESSES** — `CardFilter` IS persisted (D446 measured it: nine `EffectOp` fields carry one and an op rides `state.phase.cont.pendingOp`) and a WIDENING is free; `DamageCountSource` is PARSE-TIME and is not at a persisted address at all. 🛑 **`OPAQUE` MOVES, 81/116 → 80/114, AND `PHRASE-2` EMPTIES, 1/1 → 0/0 — AND THE INSTRUMENT STOOD STILL THIS SLICE** (`residue-census.ts` is untouched by D466), so unlike D465 this class-table delta really is a statement about the WORK.) 🆕🆕 D465 +1 sentence / +1 printing (THE RECOIL THAT SCALES OFF ITS OWN COUNTERS — `censusAttackCorpus.ts` **file line 500**, *"This Pokémon also does 10 damage to itself for each damage counter on it."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` arm 14 through ONE new anchor (`SELF_DAMAGE_PER_COUNTER`) and ONE new OPTIONAL FIELD on the SHIPPED `damageSelf` op (`perDamageCounterOnSelf`), folded by `recoilAmount` in `interpreter.ts` — `snipeAmount`'s `(op, state, ctx)` shape, the third rider of that kind. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE, 1 AND 1** — the OPPOSITE of D464's 1-vs-2 one slice ago, so a pass that inferred either from the other would have been right here and wrong then: MEASURE each site. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` MEMBERS, `DamageCountSource` kinds (`damageCountersOnSelf` already ships and is deliberately NOT used — it is a PARSE-TIME type no `EffectOp` carries), prompts, events, error codes, registry rows, FIXTURE ids, `packages/schema` bytes or `redact.ts` bytes; **`MATCH_RECORD_VERSION` STAYS 29 on D461's REACHABILITY shape** — `damageSelf` never parks and the only producer of the rider returns a program of LENGTH ONE, so the field can never sit in `phase.cont.rest` behind an earlier park. 🛑 **`OPAQUE` DOES NOT MOVE — 81/116 BEFORE AND AFTER** — because D465 FIXED `residue-census.ts`'s span probe FIRST, which reclassified this row out of `OPAQUE` into `PHRASE-6` before anything was built. The class it left is `PHRASE-6`.) 🆕🆕 D464 +1 sentence / +2 printings (THE FLIP-GATED STATUS THAT ALSO STRIPS AN ENERGY — `censusAttackCorpus.ts` **file line 264**, *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon."*, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackEffect` arm 2d through ONE new anchor (`FLIP_DEFENDER_STATUS_THEN_DISCARD`) whose program is arm 2's `applyStatus` followed by `FLIP_OPPONENT_ACTIVE_DISCARD`'s `discardEnergy` inside ONE `coinFlipGate`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2** — one file line carrying two legal printings, so a pass that copied one number into the other kind of site would be wrong at EVERY site (D463's agreed at 2 and 2, which is the trap in the other direction). RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op FIELDS, op VALUES or FIXTURE ids — `fix-oxford` index 2 ALREADY printed this sentence, as D462's loud control. 🛑 **`OPAQUE` MOVES FOR THE SECOND SLICE RUNNING** (87/125 → 86/123), and this row sat in it: no deletion and no substitution `residue-census.ts` can make reaches a built string, because the edit that would — deleting the trailing consequent — must take the sentence-final period with it.)
    // …and the step is attributable: remove THIS sentence from the resolved set and the
    // pair falls by exactly 1 and 2.
    // 🛑🛑 **D463 — THE SECOND LITERAL IS NO LONGER "THE PRE-SLICE PAIR", AND
    // SAYING SO IS THE POINT.** It was [490, 1510] when D462 wrote it, which was D461's head;
    // D463 then added 2 sentences / 2 printings to the SAME resolved set (the per-heads Energy
    // discard, corpus file lines 200 and 234), so the difference this rung measures is still
    // exactly 1 and 2 while neither endpoint is a historical constant any more. ⚠️ **BOTH
    // LITERALS MOVED TOGETHER HERE AND THAT IS NOT THE `head === head` TRAP** (D426/D437): both
    // sides are absolute pins re-derived from the corpus, not a tail computed off the head, so a
    // mutation that moved `resolved` without moving `withoutOxford` still reddens one of them.
    const withoutOxford = resolved.filter(([, s]) => s !== OXFORD);
    expect([withoutOxford.length, units(withoutOxford)]).toEqual([515, 1543]); // (🆕🆕🆕 D483 +2 sentences / +2 printings — THE PRINTED CANDIDATE **CLASS** ON THE BENCHED SNIPE, `censusAttackCorpus.ts` FILE LINES **111** and **615**, **2 sentences / 2 legal printings**, both claimed WHOLE by `deriveAttackEffect` (arms 9b-bis and 6c) through ONE new group on the SHARED fragment `ALSO_BENCHED_SNIPE_BODY` and ONE new OPTIONAL op field `damageChosen.filter?: CardFilter`. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 2 AND 2, MEASURED. ⚠️ FOUND ON A SECOND `check` ROUND, BEHIND A SITE IN THE SAME `it` THAT THREW FIRST — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short and the ROUND COUNT is the measurement.) // (🆕🆕 D479 +1 sentence / +1 printing — THE ATTACK-SIDE HAND REFRESH, `censusAttackCorpus.ts` FILE LINE 486, *"Shuffle your hand into your deck. Then, draw {N} cards."*, claimed WHOLE by `deriveAttackEffect` arm 44b through ONE new anchor `SHUFFLE_HAND_DRAW` over `handRefresh { who: "you", draw: { kind: "fixed", count } }` — Youngster `sv01-198`'s hand-authored program at a second address. ZERO new op members/fields/values, reader surface still 13. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1.) // (D478 +1 sentence / +2 printings — THE OTHER BRANCH OF A GATE THAT ALREADY SHIPS, `censusAttackCorpus.ts` FILE LINE 263, *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused."*, 1 sentence / 2 legal printings, claimed WHOLE by `deriveAttackEffect` arm 2b-bis through ONE new anchor `FLIP_DEFENDER_PAIR_OR_TAILS_STATUS` over a `coinFlipGate` with BOTH arms filled. `coinFlipGate.otherwise` shipped at D269 and arm 6d has emitted a two-armed gate since D416, so the mechanism the old refusal called absent was 209 decisions old. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2 — one file line, two legal printings; D476's and D475's agreed at 1 and 1, so this term was DERIVED here and not carried. RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414), ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events or `interpreter.ts` bytes.) // (🆕🆕 D476 +1 sentence / +1 printing — THE FACE AXIS, THE LAST OPEN AXIS OF THE PRINTED PER-FACE FAMILY — `censusAttackCorpus.ts` **FILE LINE 217**, *"Flip 3 coins. For each tails, discard an Energy from this Pokémon."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_SELF_ENERGY_PER_TAILS`) and ONE **REQUIRED** `face: CoinFace` FIELD on the shipped `programPerHeads` member. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — D472's disagreed at 1 and 2, D473's agreed at 2 and 2, D474's disagreed at 1 and 2, D475's agreed at 1 and 1 — so this term was DERIVED at this head and not carried from the previous slice (D451/D461/D464). RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, and **ZERO new `FIXTURE_POOL` ids** (file-local `cardPool`, D414), so every id ladder takes a ZERO term. ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events, error codes or `AttackCoinFlip` MEMBERS — the op is `SELF_DISCARD_ONE`'s output byte for byte, and the FACE rides the member that already shipped.) // (🆕🆕 D475 +1 sentence / +1 printing — THE COIN FLIP COUNTED OVER BOTH ACTIVES, `censusAttackCorpus.ts` **FILE LINE 231**, claimed WHOLE by `deriveAttackCoinFlip`. ⚠️ FOUND ON THE SECOND `check` ROUND, BEHIND A SITE IN THE SAME `it` THAT THREW FIRST — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short and the round count is the measurement.) // 🆕🆕 D474 +1 sentence / +2 printings (THE BOARD-COUNTED COIN FLIP OVER BODIES — `censusAttackCorpus.ts` **FILE LINE 233**, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackCoinFlip`. ⚠️ **FOUND ON THE SECOND `check` ROUND, BEHIND A SITE THAT THREW FIRST** — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short. The head name was read at THIS site rather than copied from the sibling above it.) // 🆕🆕 D470 +1 sentence / +1 printing (THE BOARD-WIDE OWN-SIDE ENERGY COUNT, NARROWED BY A PRINTED SUBGROUP NOUN — `censusAttackCorpus.ts` **FILE LINE 558**, *"This attack does 20 more damage for each {L} Energy attached to all of your Iono's Pokémon."*, **1 legal printing**, claimed WHOLE by `deriveAttackDamageBonus` through the new `SELF_ENERGY_FILTERED_SCALE` anchor — ONE anchor, ONE arm, ONE OPTIONAL field on the SHIPPED `energyOnSelf` member, ONE evaluator branch, ONE OPTIONAL parameter on the SHARED `countEnergyInPlay`. RAW summand ALONE; the reader surface stands still at 13.) // (🆕🆕🆕 D482 — the WHOLE-SIDE SPREAD raises the head by 1 sentence / 1 printing (`censusAttackCorpus.ts` FILE LINE 572, arm 6a-bis, `SPREAD_EACH_OPPONENT_POKEMON` over `damageDefender` + `spreadDamage`), so this DERIVED figure moves with it. This slice's own sentence is NOT in this file's subtracted set, which is why the figure steps by exactly the head's step.)
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
// §7 — purity, the park question, and the persisted bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — purity and the structural answers", () => {
  it("never mutates the board it is handed", () => {
    const frozen = deepFreeze(board());
    const snapshot = JSON.stringify(frozen);
    expect(swing(frozen, 0).state).not.toBe(frozen);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  it("replays identically for one seed", () => {
    const a = swing(board(), 0);
    const b = swing(board(), 0);
    expect(b.state).toEqual(a.state);
    expect(b.events).toEqual(a.events);
  });

  it("🛑 there is no PARK on this path — the three ops resolve inline", () => {
    // This is what makes the version prediction true rather than hopeful: an op that
    // never parks can never reach `phase.cont.rest`, so no continuation this slice can
    // author is ever persisted. Driven, not asserted.
    for (const index of [0, 1]) {
      expect(swing(board(), index).state.phase.kind).not.toBe("effect:choose");
    }
  });

  it("🛑 `MATCH_RECORD_VERSION` STAYS 29 — DRIVEN, in three directions", () => {
    // ⚠️ `MATCH_RECORD_VERSION` is not exported from this package (it lives in
    // `apps/api/src/lobby/match.ts`), so the claim is DRIVEN the way D421–D424 drove
    // theirs. The bump trigger is a PERSISTED structure gaining, renaming or losing a
    // required field. This slice adds no op, no field and no VALUE: the serialized
    // ALPHABET is unmoved, and a program of three `applyStatus` ops was already
    // authorable before it (arm 2b authors two).
    //
    // DIRECTION 1 — FORWARD. Round-trip the board through JSON, which is what
    // persistence actually does to it, and replay. Any new persisted shape shows up as
    // a divergence.
    const live = board();
    const persisted = JSON.parse(JSON.stringify(live)) as GameState;
    const liveRun = swing(live, 0);
    const replayed = swing(persisted, 0);
    expect(replayed.events).toEqual(liveRun.events);
    expect(replayed.state).toEqual(liveRun.state);

    // DIRECTION 2 — WIDENING / ABSENT. The `conditions` record's key set is asserted
    // as a LITERAL rather than as a diff between two boards of ONE build: a diff is
    // blind to a key that grew on both (D279). This slice writes all three and adds
    // none, and an ABSENT `conditions` still reads as "no condition".
    expect(Object.keys(defenderConditions(liveRun.state)).sort()).toEqual([
      "burned",
      "poisonDamage",
      "rotation",
    ]);
    expect(defenderConditions(live)).toEqual({ rotation: "none", poisonDamage: 0, burned: false });

    // DIRECTION 3 — LOSS. Drop each written key from the PERSISTED bytes in turn and
    // confirm a v29 reader can SEE the loss. That is the direction a version argument
    // usually skips, and it is the one that proves the three conditions are really in
    // the record rather than merely in the events: if any key were unpersisted, its
    // removal would be invisible here and the "three conditions landed" claim would be
    // a statement about a log rather than about a board.
    const after = JSON.parse(JSON.stringify(liveRun.state)) as GameState;
    for (const key of ["burned", "poisonDamage", "rotation"] as const) {
      const lossy = JSON.parse(JSON.stringify(after)) as GameState;
      const active = lossy.players.p2.active;
      if (active === null) throw new Error("no defender");
      delete (active.conditions as unknown as Record<string, unknown>)[key];
      expect(lossy.players.p2.active?.conditions).not.toEqual(
        after.players.p2.active?.conditions,
      );
    }
  });

  it("engineVersion is 0.379.0 and the bump is owed for BEHAVIOUR", () => {
    // 🆕🆕 D462 — 0.360.0 → **0.361.0**. One printed sentence that derived to `null`
    // now derives to a program: an OBSERVABLE change to what the engine does with a
    // real catalog row, which is the bump's whole trigger.
    expect(engineVersion).toBe("0.379.0");
  });
});
