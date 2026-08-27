import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import {
  bonusConsequentProgram,
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
} from "./effects";
import type { EffectOp } from "./effects";
import {
  applyAction,
  createGame,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackRequirement,
} from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  walkProgram,
} from "./testFixtures";

// ── D382 — "…THIS ATTACK DOES {N} MORE DAMAGE. THEN, {CONSEQUENT}" — D317's SHAPE
//    WITH THE PRINTED JOIN CHANGED, AND ITS `conditionGate` ARM'S FIRST
//    `FIXTURE_POOL` PRODUCER. ────────────────────────────────────────────────────
//
// THE POPULATION, measured off `legalAttackCorpus()` (the committed
// `legal_standard = 1` attack column, 640 sentences / 1,732 printings) rather than
// off a live D1 — this container has no D1 credentials (D369) and the corpus is
// what stands in. Both figures are RE-DERIVED in §7 rather than quoted:
//
//   /^If (.+), this attack does (\d+) more damage, and (.+)$/   → 1 sentence /  5
//   /^If (.+), this attack does (\d+) more damage\. Then, (.+)$/ → 1 sentence /  1  ← this slice
//   /^Flip a coin\. If heads, …more damage\. Then, (.+)$/        → 0 sentences / 0
//
//   sv06-039  Chi-Yu  idx 1  "Ground Melter"  ({R}{C}, "60+")
//     "If a Stadium is in play, this attack does 60 more damage. Then, discard
//      that Stadium."
//
// **ONE legal printing**, and the cost of claiming it is ONE anchor constant plus
// ONE consequent row. Confirmed by id against tcgdex on 2026-08-21 — two attacks,
// "Allure" ({C}, "Draw 2 cards.") at index 0 and "Ground Melter" at index 1, the
// printed sentence and the `60+` marker byte for byte.
//
// ── 🛑 THE SHAPE QUESTION, SETTLED FROM THE CATALOG BEFORE A LINE WAS WRITTEN ──
//
// **IS `. Then, ` THE SAME SHAPE AS `, and `, OR A DIFFERENT ONE?** The resume
// point called it *"a SPELLING plus one consequent row"* and that is what the
// catalog says too, on three counts:
//
//   1. **BOTH HALVES ARE ALREADY OWNED SEPARATELY.** The bare antecedent — *"If a
//      Stadium is in play, this attack does 60 more damage."* — reads through
//      `deriveAttackDamageBonus` into `{per: 60, count: {boardCondition
//      stadiumInPlay}}` and has since D378; the bare consequent's op is D380's
//      `discardStadium`. The join is the ONLY thing this slice buys, exactly as
//      D317's was. §2 asserts both halves stay with their owners.
//   2. **THE CONSEQUENT ATTACHES TO THE YES ARM UNDER EITHER JOIN.** *"Then,"* is a
//      SEQUEL where *", and"* is a rider, and neither is reachable when the
//      antecedent is false — so both fold into `boostedArms`'s `[damageDefender(base
//      + bonus), ...ops]` with nothing to choose between them.
//   3. **AND THE DECIDER IS THE ONE THING THE FAMILY IS ALLOWED TO VARY** (D317's
//      finding: *"a design under which two printings of one printed shape need two
//      mechanisms is a design that has not found the shape"*). A THIRD reader for a
//      changed comma would have been that design.
//
// ⚠️ **THE JOIN IS NOT WIDENED TO THE COIN FORM.** `/^Flip a coin\. If heads, this
// attack does (\d+) more damage\. Then, /` returns ZERO sentences in the whole legal
// attack column, so writing that arm would be authoring a card (D190b: exact map or
// flag). §7 measures the zero rather than asserting it.
//
// ── 🛑 WHAT WAS *NOT* SETTLED, STATED RATHER THAN GLOSSED ────────────────────
//
// **THE ORDER OF THE HIT AND THE DISCARD IS UNOBSERVABLE ON THIS PRINTING, AND THE
// ASSEMBLER'S ORDER IS CLAIMED FROM THE PRINT.** D381's rule says to go and look for
// the one card that observes an "obviously unobservable" order, so this slice
// looked: the only Stadium in `FIXTURE_POOL` whose presence changes a damage number
// is Neutralization Zone `sv06.5-060`, which prevents damage only **from an
// attacking Pokémon ex** — and Chi-Yu `sv06-039` is a Basic with no Rule Box, so
// that board is unreachable for it and `isExOrV` cannot be talked into it by a
// fixture NAME the way D381's `Fixceti ex` was, because this suite drives the REAL
// printing. Beach Court changes a retreat cost and Pokémon League Headquarters an
// attack COST, both settled before the program runs. So the order here is written
// from the printed sentence (*"does 60 more damage. Then, discard"*) and NOT from
// what a test would notice — D130/D228's precedent, named so a printing that CAN
// reach it is a known cost rather than a surprise. §4 pins the order in the
// ASSEMBLED program, which is the strongest claim available on this board.
//
// ── WHAT THE ROW COSTS ──────────────────────────────────────────────────────
//
// ONE anchor constant (`BONUS_CONSEQUENT_CONDITION_THEN`), ONE consequent row
// (`CONSEQUENT_DISCARD_STADIUM`) and ONE `FIXTURE_POOL` demonstrator. **NO new
// reader, op, `BoardCondition` member, field, prompt kind, choice kind, event,
// error code, `GameState` field or registry row** — every step the program contains
// already ships. `packages/schema` takes ZERO and `MATCH_RECORD_VERSION` stays
// **22**: this slice adds no `EffectOp` member at all, so every step the new program
// contains could already appear in a v22 record and no v22 byte string means
// anything different under this one (D335's discriminator).

/** The printed sentence, transcribed off the committed corpus (D306: transcribe,
    never interpolate). */
const MELTER_TEXT =
  "If a Stadium is in play, this attack does 60 more damage. Then, discard that Stadium.";
/** Chi-Yu's OTHER printed attack — the index-precision control, and a sentence
    `deriveAttackEffect` has read since long before this slice. */
const ALLURE_TEXT = "Draw 2 cards.";

/** The two BARE halves, each a REAL printed catalog sentence read by a reader that
    is not this one. Both must stay theirs: that is what says this slice widened a
    JOIN and not a vocabulary. */
const BARE_ANTECEDENT = "If a Stadium is in play, this attack does 70 more damage.";
const BARE_CONSEQUENT = "Discard a Stadium in play.";
/** …and the consequent as it is actually printed INSIDE the sentence — lowercase
    and anaphoric, which no standalone reader claims. */
const INNER_CONSEQUENT = "discard that Stadium.";

/** D317's sentence, the `, and ` half of the same shape. */
const OGERPON_TEXT =
  "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 140 more damage, and discard all Energy from this Pokémon.";

/** 🛑 THE NEAR MISS THE CATALOG PRINTS, and it is not synthetic: Ting-Lu
    `sv06-110` "Ground Crasher" carries the SAME antecedent AND the SAME consequent
    AND the `, and ` join — and must still be REFUSED, because its middle half is a
    SECOND HIT (*"also does 30 damage to each…"*) rather than a bonus. A reader that
    had been widened at the join instead of at the anchor would have claimed it. */
const TINGLU_TEXT =
  "If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const CHIYU = "sv06-039";
const BEACH_COURT = "sv01-167";
const DEFENDER = "fix-bigbody";
const FIRE = "fix-fire-energy";
const COLORLESS = "fix-energy";

/** The ATTRIBUTION CONTROL's card — the SAME antecedent and the SAME `. Then, `
    join with a consequent no anchor reads, so the whole sentence must stay on the
    loud path. */
const UNREAD = "fix-d382-unread";
const UNREAD_TEXT =
  "If a Stadium is in play, this attack does 60 more damage. Then, hum a little tune.";

/** The LOCAL pool (D275's idiom) — the real id lives HERE and not in
    `FIXTURE_POOL`, because `catalogManifest.test.ts` diffs the `sv*` ids in that
    pool against the 978-row / 6-set manifest and `sv06` is in none of the six.
    `fix-groundmelter` is the demonstrator that pays for the blind spot this buys;
    §8 ties the two together. */
const LOCAL_CARDS: Record<string, Card> = {
  [CHIYU]: battler(CHIYU, {
    name: "Chi-Yu",
    hp: 110,
    stage: "Basic",
    retreat: 1,
    types: ["Fire"],
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      { cost: ["Colorless"], name: "Allure", effect: ALLURE_TEXT },
      {
        cost: ["Fire", "Colorless"],
        name: "Ground Melter",
        effect: MELTER_TEXT,
        damage: "60+",
      },
    ],
  }),
  [UNREAD]: battler(UNREAD, {
    hp: 110,
    types: ["Fire"],
    attacks: [
      { cost: ["Colorless"], name: "Allure", effect: ALLURE_TEXT },
      {
        cost: ["Fire", "Colorless"],
        name: "Hummed Melter",
        effect: UNREAD_TEXT,
        damage: "60+",
      },
    ],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** ⚠️ **SIX BEACH COURTS AND NOT FOUR — A MARGIN, NOT A SEED** (D376, and the same
    payment D380 and D381 each made). Setup takes 7 cards to hand and 6 to Prizes
    before a case can reach the deck, and the boards below play a Stadium from
    EITHER seat, so a four-copy printing is one unlucky prize away from a throw.

    `fix-bigbody` (200 HP, no Weakness, no Resistance) is the defender on every
    board: it is the only arithmetic under which 60 and 120 are both readable
    unmodified, and 200 survives the boosted 120 so no KO tail interferes. */
const DECK = deckOf({
  [CHIYU]: 4,
  [UNREAD]: 4,
  [BEACH_COURT]: 6,
  [FIRE]: 8,
  [COLORLESS]: 8,
  [DEFENDER]: 30,
});

/** Two seeds — nothing below rests on one shuffle (D270). */
const SEEDS = [4021, 4099] as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function apply(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** Put a Beach Court into `seat`'s hand and PLAY it through §7.3.
    ⚠️ **A CONSTRUCTED `state.stadium` WOULD BE GREEN AND DEAD** (D380's rule,
    inherited): what is under test is that the Stadium the RULES put in the zone is
    the one this program's consequent takes out of it. */
function playStadium(state: GameState, seat: Seat): GameState {
  const withCard = handFromDeck(state, seat, BEACH_COURT, 1);
  const uid = handUid(withCard, seat, BEACH_COURT);
  return must(applyAction(withCard, { type: "playTrainer", seat, uid }));
}

/** TEST SURGERY — `count` Energy of one printed type onto `seat`'s Active. */
function fuel(state: GameState, seat: Seat, energyId: string, count: number): GameState {
  const side = state.players[seat];
  const body = side.active;
  if (body === null) throw new Error(`${seat} has no Active`);
  const energy = side.deck.filter((u) => state.cardIdByUid[u] === energyId).slice(0, count);
  if (energy.length < count) throw new Error(`deck lacks ${count} × ${energyId}`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        active: { ...body, energy: [...body.energy, ...energy] },
        deck: side.deck.filter((u) => !energy.includes(u)),
      },
    },
  };
}

/** A board on P1's turn with `attacker` Active, `{R}{C}` paid onto it and
    `fix-bigbody` opposite. `stadium` says who, if anyone, played the one Beach
    Court: P2 has to play it on its OWN turn, which is why that choice is made here
    rather than by a caller reaching in afterwards. */
function board(opts: { attacker: string; stadium?: Seat | null; seed?: number }): GameState {
  let state = localSetup(opts.seed ?? SEEDS[0], "p2");
  state = setActiveFromDeck(state, "p2", DEFENDER);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", DEFENDER);
  if (opts.stadium === "p2") state = playStadium(state, "p2");
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (opts.stadium === "p1") state = playStadium(state, "p1");
  state = setActiveFromDeck(state, "p1", opts.attacker);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", DEFENDER);
  state = fuel(state, "p1", FIRE, 1);
  return fuel(state, "p1", COLORLESS, 1);
}

const MELTER = { type: "attack", seat: "p1", index: 1 } as const;

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function count(events: readonly GameEvent[], type: GameEvent["type"]): number {
  return events.filter((e) => e.type === type).length;
}

/** The other ELEVEN readers, run as one — the disjointness control. */
const OTHER_READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  // 🆕🆕 D419 — the reader this COMPLEMENT never named (D417), written
  // in NAME order rather than in landing order because the guard in §2 diffs a
  // SORTED list against the module surface.
  // ⚠️ SPLICED MID-LIST RATHER THAN APPENDED: mutant `find` strings in
  // `scripts/mutation/mutants.ts` quote an array's LAST entries plus its closing
  // `];`, and appending moves that anchor without a character of it changing —
  // the adjacency class D418 paid for once on `stadiumPresence.test.ts`.
  deriveAttackCancelRequirement,
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
  // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
  // array's LAST entries plus its closing bracket, and appending moves that anchor
  // without a character of it changing.
  deriveAttackPreDamage,
  deriveAttackDiscardScaledBoost,
];

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

// ────────────────────────────────────────────────────────────────────────────
describe("D382 §1 — the print, and the reading it gets", () => {
  it("the fixture carries the printed sentence VERBATIM, with its '+' marker", () => {
    expect(POOL[CHIYU]?.attacks?.[1]?.effect).toBe(MELTER_TEXT);
    expect(POOL[CHIYU]?.attacks?.[1]?.damage).toBe("60+");
    expect(POOL[CHIYU]?.attacks?.[1]?.cost).toEqual(["Fire", "Colorless"]);
    // …and the sentence is in the COMMITTED corpus at ONE printing, which is where
    // the population figure comes from rather than from this file's prose.
    expect(corpus().filter(([, s]) => s === MELTER_TEXT)).toEqual([[1, MELTER_TEXT]]);
  });

  it("🛑 the sentence reads into its DECIDER, its bonus and the op the yes arm buys", () => {
    expect(deriveAttackBonusConsequent(MELTER_TEXT)).toEqual({
      decider: { kind: "boardCondition", cond: { kind: "stadiumInPlay" } },
      bonus: 60,
      ops: [{ op: "discardStadium" }],
    });
  });

  it("⚠️ the DECIDER is byte-identical to the one the BARE antecedent derives", () => {
    // The clause goes through `boardConditionForClause`'s shared fold, so a
    // sentence meaning "does N more damage if a Stadium is out" means the same
    // thing here as it does one reader over. Asserted, not argued.
    const bare = deriveAttackDamageBonus(BARE_ANTECEDENT);
    expect(bare).toMatchObject({ count: { kind: "boardCondition" } });
    const reading = deriveAttackBonusConsequent(MELTER_TEXT);
    expect(reading?.decider).toEqual({
      kind: "boardCondition",
      cond: (bare as { count: { cond: unknown } }).count.cond,
    });
  });

  it("⚠️ the ops are BYTE-IDENTICAL to the ones the BARE consequent derives", () => {
    // D380's standalone imperative and this anaphoric tail are the same action, so
    // they must be the same op — a second spelling of `discardStadium` would be the
    // "two names for one action" defect `damageDefender`'s doc block refuses.
    expect(deriveAttackBonusConsequent(MELTER_TEXT)?.ops).toEqual(
      deriveAttackEffect(BARE_CONSEQUENT),
    );
  });

  it("🛑 NO registry ATTACK row is authored for the printing — an ARM serves it", () => {
    // The whole value of a deriver arm is that it is a text parser: it serves every
    // reprint of its sentence, where a registry row is keyed by card id (D187).
    expect(programFor(CHIYU)).toBeUndefined();
  });

  it("⚠️ INDEX PRECISION — Chi-Yu's other attack is read by a DIFFERENT reader", () => {
    expect(POOL[CHIYU]?.attacks?.[0]?.effect).toBe(ALLURE_TEXT);
    expect(deriveAttackBonusConsequent(ALLURE_TEXT)).toBeNull();
    expect(deriveAttackEffect(ALLURE_TEXT)).toEqual([{ op: "drawCards", count: 2 }]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D382 §2 — the REFUSALS, which are what keep an unread sentence loud", () => {
  it("🆕🆕 D419 — OTHER_READERS plus the reader under test IS the module's surface", () => {
    // 🛑 THE GUARD THIS COMPLEMENT NEVER HAD, AND A COMPLEMENT IS WHERE A STALE LIST
    // DOES ITS WORST WORK. The rungs below assert that all the OTHER readers refuse
    // these sentences — a claim whose entire force is the word ALL. A list that has
    // fallen behind `effects.ts` does not make that claim FALSE, it makes it
    // NARROWER, and narrower is invisible: the missing reader is simply never asked
    // and the rung stays green. This list ran short of the module until this slice,
    // so every refusal below was quantified over a strict subset of the surface.
    expect([...OTHER_READERS.map((read) => read.name), "deriveAttackBonusConsequent"].sort()).toEqual(
      attackReaderSurface(),
    );
    // ⚠️ THE COUNT IS PINNED SEPARATELY FROM THE DIFF ABOVE, and the separation is
    // load-bearing: a diff alone stays GREEN when a slice deletes a reader from the
    // module and from this list in the SAME commit, and the refusals would quietly
    // narrow again with nothing naming the cause.
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 all ELEVEN other readers refuse the sentence", () => {
    // 🆕🆕 D419 — THE POSITIVE HALF, TAKEN OFF THE MODULE. "Exactly one reader
    // claims this" is two facts, and the loop below only ever carried the second.
    // `resolvedByAnyReader` walks whatever `effects.ts` exports TODAY, so if the
    // sentence ever stopped being claimed at all this rung reddens — where the loop
    // alone would go greener.
    expect(resolvedByAnyReader(MELTER_TEXT), MELTER_TEXT).toBe(true);
    for (const read of OTHER_READERS) expect(read(MELTER_TEXT)).toBeNull();
  });

  it("🛑 and the BARE halves stay with the readers that already owned them", () => {
    // ⚠️ THE HALF-AND-HALF CHECK D379/D381 made the house rule: a reader that
    // claims everything looks exactly like a reader that works, so each half is
    // re-paired with its own owner and required to still resolve there.
    expect(deriveAttackDamageBonus(BARE_ANTECEDENT)).not.toBeNull();
    expect(deriveAttackBonusConsequent(BARE_ANTECEDENT)).toBeNull();
    expect(deriveAttackEffect(BARE_CONSEQUENT)).toEqual([{ op: "discardStadium" }]);
    expect(deriveAttackBonusConsequent(BARE_CONSEQUENT)).toBeNull();
  });

  it("🛑 the INNER consequent is lowercase and ANAPHORIC, and NOTHING reads it alone", () => {
    // This is why the consequent is a dispatched row here rather than a delegation
    // to `deriveAttackEffect`: that reader's `DISCARD_STADIUM` anchor demands the
    // capitalised standalone imperative and returns null for the printed tail.
    expect(MELTER_TEXT.endsWith(` Then, ${INNER_CONSEQUENT}`)).toBe(true);
    expect(deriveAttackEffect(INNER_CONSEQUENT)).toBeNull();
    // 🆕🆕 D419 — "NOTHING reads it alone" over the WHOLE module surface, not over
    // this file's list minus the reader under test. The loop below names which
    // reader broke; this line is the claim the title actually makes.
    expect(resolvedByAnyReader(INNER_CONSEQUENT), INNER_CONSEQUENT).toBe(false);
    for (const read of OTHER_READERS) expect(read(INNER_CONSEQUENT)).toBeNull();
  });

  it("🛑 THE CATALOG'S OWN NEAR MISS — same antecedent, same consequent, REFUSED", () => {
    // Ting-Lu `sv06-110` "Ground Crasher" is the sharpest control available because
    // nobody invented it: it shares BOTH halves and the `, and ` join, and differs
    // only in that its middle clause is a SECOND HIT rather than a bonus. A reader
    // widened at the JOIN rather than at the ANCHOR would have swallowed it.
    expect(corpus().filter(([, s]) => s === TINGLU_TEXT)).toEqual([[1, TINGLU_TEXT]]);
    expect(deriveAttackBonusConsequent(TINGLU_TEXT)).toBeNull();
    // 🆕🆕 D419 — the near miss is refused by the MODULE's whole surface, so a reader
    // added tomorrow that swallows it reddens here rather than passing unasked.
    expect(resolvedByAnyReader(TINGLU_TEXT), TINGLU_TEXT).toBe(false);
    for (const read of OTHER_READERS) expect(read(TINGLU_TEXT)).toBeNull();
  });

  it("🛑 an UNRECOGNISED consequent refuses the WHOLE sentence — never a prefix match", () => {
    // A reader that swallowed the damage and dropped the tail would ship a Chi-Yu
    // whose printed consequent silently vanished, which is strictly worse than not
    // reading the card at all (D316's rule, inherited).
    expect(deriveAttackBonusConsequent(UNREAD_TEXT)).toBeNull();
  });

  it("⚠️ the consequent's verb is LOWERCASE, and a CAPITAL one is refused", () => {
    expect(
      deriveAttackBonusConsequent(
        "If a Stadium is in play, this attack does 60 more damage. Then, Discard that Stadium.",
      ),
    ).toBeNull();
  });

  it("a printed ZERO on the bonus is refused", () => {
    expect(
      deriveAttackBonusConsequent(
        "If a Stadium is in play, this attack does 0 more damage. Then, discard that Stadium.",
      ),
    ).toBeNull();
  });

  it("the anchor is WHOLE-STRING — leading or trailing text is refused", () => {
    expect(deriveAttackBonusConsequent(`${MELTER_TEXT} Then, draw a card.`)).toBeNull();
    expect(deriveAttackBonusConsequent(`Before anything else, ${MELTER_TEXT}`)).toBeNull();
  });

  it("🛑 an UNMAPPED antecedent clause refuses too, and stays LOUD", () => {
    expect(
      deriveAttackBonusConsequent(
        "If the moon is full, this attack does 60 more damage. Then, discard that Stadium.",
      ),
    ).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D382 §3 — 🛑 THE TWO JOINS ARE DISJOINT, AND THE `??` IS ORDER-FREE", () => {
  it("🛑 neither printed sentence carries the OTHER's join", () => {
    // The byte claim the disjointness rests on: the `. Then, ` anchor demands a
    // literal ". " where the `, and ` anchor demands a literal ", " at the same
    // offset in the same sentence, so no sentence can match both.
    expect(MELTER_TEXT.includes("more damage, and ")).toBe(false);
    expect(OGERPON_TEXT.includes("more damage. Then, ")).toBe(false);
    // …and no sentence in the whole legal attack column carries both.
    const both = corpus().filter(
      ([, s]) => s.includes("more damage, and ") && s.includes("more damage. Then, "),
    );
    expect(both).toEqual([]);
  });

  it("🛑 THE JOIN IS PARAMETERISED, NOT A SPECIAL CASE — both crosses read", () => {
    // ⚠️ THE GUARD THAT CAN GO RED FOR THE RIGHT REASON. If the new anchor had been
    // written around Chi-Yu's own antecedent or its own consequent, exactly one of
    // these two would refuse. Each swaps ONE half across the join.
    const ogerponWithThen = OGERPON_TEXT.replace(
      "more damage, and discard all Energy",
      "more damage. Then, discard all Energy",
    );
    expect(deriveAttackBonusConsequent(ogerponWithThen)).toEqual(
      deriveAttackBonusConsequent(OGERPON_TEXT),
    );
    const melterWithAnd = MELTER_TEXT.replace(
      "more damage. Then, discard that Stadium.",
      "more damage, and discard that Stadium.",
    );
    expect(deriveAttackBonusConsequent(melterWithAnd)).toEqual(
      deriveAttackBonusConsequent(MELTER_TEXT),
    );
  });

  it("⚠️ the COIN form is NOT widened, and the catalog is why", () => {
    // ZERO printings, measured rather than asserted — writing this arm would be
    // authoring a card (D190b: exact map or flag).
    const coinThen = /^Flip a coin\. If heads, this attack does (\d+) more damage\. Then, (.+)$/;
    expect(corpus().filter(([, s]) => coinThen.test(s))).toEqual([]);
    expect(
      deriveAttackBonusConsequent(
        "Flip a coin. If heads, this attack does 60 more damage. Then, discard that Stadium.",
      ),
    ).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D382 §4 — the ASSEMBLER: both arms, and the PRINTED ORDER inside the gate", () => {
  const program = (): EffectOp[] => {
    const reading = deriveAttackBonusConsequent(MELTER_TEXT);
    if (reading === null) throw new Error("Ground Melter did not read");
    return bonusConsequentProgram(reading, 60);
  };

  it("🛑 the whole hit moves inside the gate, on BOTH arms", () => {
    expect(program()).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "stadiumInPlay" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "damageDefender", amount: 120 }, { op: "discardStadium" }],
        otherwise: [{ op: "damageDefender", amount: 60 }],
      },
    ]);
  });

  it("🛑 THE DECLINE ARM IS THE PRINTED BASE, NEVER AN ABSENT BRANCH", () => {
    // Ground Melter is `60+` and not `+60`, so an absent `otherwise` would silently
    // delete a 60-damage attack (D381's finding, and the difference from D380).
    const gate = program()[0];
    expect(gate).toMatchObject({ op: "conditionGate" });
    expect((gate as { otherwise?: EffectOp[] }).otherwise).toEqual([
      { op: "damageDefender", amount: 60 },
    ]);
  });

  it("🛑 THE DAMAGE COMES FIRST AND THE DISCARD SECOND — the PRINTED order", () => {
    // Unobservable on this printing (see the header), so it is pinned in the
    // program rather than on a board: reversing the two steps here goes red.
    const gate = program()[0] as { then: EffectOp[] };
    expect(gate.then.map((op) => op.op)).toEqual(["damageDefender", "discardStadium"]);
  });

  it("⚠️ the two arms are DISTINCT OBJECTS, not one array shared", () => {
    // 🛑 D381's finding, inherited: `programWalk.test.ts` accounts for the ops it
    // reaches BY IDENTITY, so a shared arm is "already seen" down the outer path
    // and its structural invariant fails by exactly one. `boostedArms` builds two.
    const gate = program()[0] as { then: EffectOp[]; otherwise: EffectOp[] };
    expect(gate.then).not.toBe(gate.otherwise);
    expect(walkProgram(program()).map((op) => op.op)).toEqual([
      "conditionGate",
      "damageDefender",
      "discardStadium",
      "damageDefender",
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D382 §5 — CHI-YU ON A REAL BOARD: both arms, and the zone", () => {
  for (const seed of SEEDS) {
    it(`🛑 with a Stadium out the hit is 120 in ONE row and the zone EMPTIES (seed ${seed})`, () => {
      const start = board({ attacker: CHIYU, stadium: "p2", seed });
      expect(start.stadium).not.toBeNull();
      const { state: done, events } = apply(start, MELTER);
      // ONE hit, at base + bonus. Two hits would be two rows and §8.5 twice.
      expect(count(events, "DAMAGE_DEALT")).toBe(1);
      expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 120 });
      expect(done.players.p2.active?.damage).toBe(120);
      // …and the printed consequent ran: the zone is empty and the card is in its
      // OWNER's discard pile, which is the half a constructed `state.stadium` could
      // never have shown.
      expect(done.stadium).toBeNull();
      const discarded = find(events, "STADIUM_DISCARDED");
      expect(discarded).toMatchObject({ seat: "p2" });
      expect(done.players.p2.discard).toContain(discarded?.uid);
    });

    it(`🛑 with the zone EMPTY the hit is the printed 60 and nothing is discarded (seed ${seed})`, () => {
      // ⚠️ THE ARM THAT PROVES THE GATE IS NOT DEAD. Without this board the suite
      // would be green under a build that ignored the condition entirely.
      const start = board({ attacker: CHIYU, stadium: null, seed });
      expect(start.stadium).toBeNull();
      const { state: done, events } = apply(start, MELTER);
      expect(count(events, "DAMAGE_DEALT")).toBe(1);
      expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 60 });
      expect(done.players.p2.active?.damage).toBe(60);
      expect(count(events, "STADIUM_DISCARDED")).toBe(0);
      expect(done.stadium).toBeNull();
    });
  }

  it("🛑 the Stadium may be the ATTACKER'S OWN — `stadiumInPlay`, not `yourStadiumInPlay`", () => {
    // The printed clause carries no possessive (*"a Stadium"*), and D378 bought the
    // presence member for exactly that. A build that had reached for the OWNERSHIP
    // member reads right on the P2 board above and wrong on this one.
    const start = board({ attacker: CHIYU, stadium: "p1" });
    expect(start.stadium).toMatchObject({ owner: "p1" });
    const { state: done, events } = apply(start, MELTER);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 120 });
    expect(done.stadium).toBeNull();
    expect(find(events, "STADIUM_DISCARDED")).toMatchObject({ seat: "p1" });
  });

  it("the attack still ends the turn on the DECLINE arm — nothing here is a cancellation", () => {
    const { state: done } = apply(board({ attacker: CHIYU, stadium: null }), MELTER);
    expect(done.phase).toMatchObject({ seat: "p2" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D382 §6 — the LOUD path closed: the sentence and its '+' are both simulated", () => {
  it("🛑 no ATTACK_EFFECT_SKIPPED on EITHER arm", () => {
    // Two terms, and BOTH are needed: without `effectSimulated` the sentence is
    // flagged, without `modifierSimulated` the printed "+" is — and this sentence
    // carries one ("60+"). Both are claimed off the D317 reading in attack.ts,
    // which this slice did not have to touch.
    for (const stadium of ["p2", null] as const) {
      const { events } = apply(board({ attacker: CHIYU, stadium }), MELTER);
      expect(count(events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    }
  });

  it("🛑 the ATTRIBUTION CONTROL — the SAME antecedent and join with an unread tail IS flagged", () => {
    // Without this the assertion above would pass on a board where nothing is ever
    // flagged (D214's vacuous shape) — and the control shares the antecedent AND the
    // join deliberately, so what it isolates is the consequent DISPATCH.
    const { events } = apply(board({ attacker: UNREAD, stadium: "p2" }), MELTER);
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toMatchObject({
      effect: UNREAD_TEXT,
      damageModifier: "+",
    });
    // …and the printed base landed the ordinary way, because nothing claimed it.
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 60 });
    // …and the Stadium is still standing, because the consequent never ran.
    expect(count(events, "STADIUM_DISCARDED")).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D382 §7 — the CENSUS, re-derived off the corpus rather than quoted", () => {
  const AND_JOIN = /^If (.+), this attack does (\d+) more damage, and (.+)$/;
  const THEN_JOIN = /^If (.+), this attack does (\d+) more damage\. Then, (.+)$/;

  it("🛑 the `. Then, ` join is ONE sentence and ONE printing; `, and ` is ONE and FIVE", () => {
    const then = corpus().filter(([, s]) => THEN_JOIN.test(s));
    expect([then.length, units(then)]).toEqual([1, 1]);
    expect(then[0]?.[1]).toBe(MELTER_TEXT);
    const and = corpus().filter(([, s]) => AND_JOIN.test(s));
    expect([and.length, units(and)]).toEqual([1, 5]);
    expect(and[0]?.[1]).toBe(OGERPON_TEXT);
  });

  it("🛑 every sentence either anchor matches is now READ by this reader", () => {
    // The saturation check stated as a claim about a POPULATION rather than about
    // two hand-picked strings — and it is not vacuous, because §2's Ting-Lu row is
    // a sentence in the same corpus that neither anchor matches and this reader
    // still refuses.
    const matched = corpus().filter(([, s]) => AND_JOIN.test(s) || THEN_JOIN.test(s));
    expect(matched).toHaveLength(2);
    for (const [, s] of matched) expect(deriveAttackBonusConsequent(s)).not.toBeNull();
  });

  it("⚠️ `discard that Stadium` is TWO sentences and this slice claims ONE of them", () => {
    // The residue, named rather than glossed: Ting-Lu's Bench-spread twin still
    // needs a payoff shape this family has no room for, so it stays refused and
    // stays LOUD. Reported as both columns (D381's rule: a reader slice is priced
    // in refused sentences claimed, measured at BOTH ends).
    const family = corpus().filter(([, s]) => s.includes("discard that Stadium"));
    expect([family.length, units(family)]).toEqual([2, 2]);
    const claimed = family.filter(([, s]) => deriveAttackBonusConsequent(s) !== null);
    expect(claimed.map(([, s]) => s)).toEqual([MELTER_TEXT]);
    const left = family.filter(([, s]) => deriveAttackBonusConsequent(s) === null);
    expect(left.map(([, s]) => s)).toEqual([TINGLU_TEXT]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D382 §8 — 🛑 the `conditionGate` ARM'S FIRST `FIXTURE_POOL` PRODUCER", () => {
  it("🛑 the DEMONSTRATOR prints the sentence, so the shared sweeps can see the shape", () => {
    // D318's rule: a shape driven only off a LOCAL pool is invisible to every
    // sweep that walks `FIXTURE_POOL`, and `bonusConsequentProgram`'s CONDITION arm
    // had been in exactly that position since D317 — the pool's only member of this
    // family is `fix-bonusconsequent`, which prints the COIN form.
    const demo = FIXTURE_POOL["fix-groundmelter"];
    expect(demo?.attacks?.[0]?.effect).toBe(MELTER_TEXT);
    expect(demo?.attacks?.[0]?.damage).toBe("60+");
    expect(deriveAttackBonusConsequent(demo?.attacks?.[0]?.effect ?? "")).not.toBeNull();
  });

  it("🛑 and it is the ONLY `FIXTURE_POOL` card whose reading uses the BOARD-FACT decider", () => {
    // ⚠️ THE MEASUREMENT THAT SAYS THE GAP WAS REAL, taken over the pool rather
    // than asserted. It goes RED the day a second such card lands — which is the
    // correct moment for a successor to re-read this claim.
    const byDecider = (kind: string): string[] =>
      Object.entries(FIXTURE_POOL)
        .filter(([, card]) =>
          (card.attacks ?? []).some(
            (a) => deriveAttackBonusConsequent(a.effect ?? "")?.decider.kind === kind,
          ),
        )
        .map(([id]) => id);
    expect(byDecider("boardCondition")).toEqual(["fix-groundmelter"]);
    expect(byDecider("coinFlip")).toEqual(["fix-bonusconsequent"]);
  });
});
