import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
  splitAttackGateClause,
} from "./effects";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, createGame, programFor, redactGame, topUid } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// 0.195.0 → 0.196.0 — D282: `DamageCountSource.yourBenchCount` AND THE SPLIT ANCHOR.
//
// TWO mechanisms, and the second one is the slice. The first is a rider by every
// measure D193 set for this family (one union member, one evaluator `case`, two
// regexes, two reader arms); the second changes WHICH STRING the seven readers
// see, and it is the reason 7 of this member's 13 legal printings were
// unreachable while its arithmetic was two lines away.
//
// ── 🛑 THE LEADING-CLAUSE CENSUS, RE-QUERIED FIRST — AND IT SAYS BUILD NARROW ──
//
// D281's handoff asked for one number before any design: *how many legal attack
// units carry a leading clause of any kind*, "because that number is the entire
// case for doing it generically", and predicted it is LARGER than 13. **IT IS
// NOT. IT IS EXACTLY 13.** Remote D1 `luminous`, 2026-08-08, `json_each` over
// `attacks_json`, five rungs and what each ACTUALLY returned:
//
//   1,732  legal attack units                        (the whole column)
//     613  contain a sentence break (". ")           (multi-sentence)
//     216  open "Flip …", 91 "This …", 89 "Search …" (the leading word census;
//          48 "You …", 45 "Discard …", 16 "If …")     these are BODIES, not clauses
//      16  open "If " AND are multi-sentence
//       3  open "You can use this attack only if …"  (Illumise, Scream Tail ex ×2)
//      ──
//      13  a LEADING TIMING GATE with a body behind it — and every one of the 13
//          is a D281 `attackGate` row. 10 of the 16 `If ` rows plus the 3 above.
//
// ⚠️ **THE OTHER 6 `If ` ROWS ARE NOT LEADING CLAUSES AND MUST NOT BE TREATED AS
// ONE.** Chi-Yu `sv06-039`, Sandy Shocks `sv05-098`, Sawk `sv10.5w-049`/`-130`,
// Ting-Lu `sv06-110`, Wo-Chien `sv08-015`: in each the `If` clause IS the
// substance of the attack (a conditional bonus, a "does nothing" requirement, a
// conditional snipe), and 5 of the 6 are already pinned in attack.ts as the
// "rider-on-compound" deferrals — a DIFFERENT mechanism (a sentence-list composer)
// that this slice deliberately does not build.
//
// 🛑 **SO THE HANDOFF'S OWN CONTINGENCY FIRES: "if it is not larger, REPORT THAT
// AND BUILD THE NARROW THING — a generic mechanism whose population is one family
// is scaffolding."** `splitAttackGateClause` is the narrow thing: a CLOSED list of
// the three printed gate spellings, anchored at `^`, whose one call site fires
// only where `attackGateOf` says the clause is already represented.
//
// ── THE POPULATION `yourBenchCount` REACHES — 13 PRINTINGS, TWO FOLDS ────────
//
//   n  fold      sentence                                     ids
//   3  ADD       "This attack does 20 more damage for each     sv09-051 Tapu Koko ex,
//                 of your Benched Pokémon."                    sv10.5b-076, sv10.5b-153
//   3  MULTIPLY  "This attack does 20 damage for each of       sv06-018 Dipplin,
//                 your Benched Pokémon."                       sv06-170, sv08.5-010
//   7  MULTIPLY  the same sentence at 30, BEHIND the D281      Terapagos ex sv07-128/
//     +SPLIT      BAN clause                                    -170/-173/sv08.5-092/
//                                                               -169/-180/svp-165
//   ──
//  13  legal. Pool-only and NOT arms: `svp-027`'s "10 more" (the additive sentence
//      at `legal_standard = 0`) and `sv03-022`/`sv04.5-005`/`-213`'s
//      "…Benched Pokémon **that has any {G} Energy attached**." — a
//      PREDICATE-narrowed noun, 0 legal, refused by the anchors and asserted so.
//
// ⚠️ AND A FOURTEENTH PRINTING RIDES THE SPLIT WITHOUT TOUCHING THIS MEMBER:
// Volbeat `sv06-009` "Quick Sign", whose bench-search body effects.ts has named
// as a deferral since D230 for exactly this reason. **14 printings BUILT: 6 raw +
// 7 Terapagos + 1 Volbeat.**
//
// ── 🛑 WHAT THIS SUITE EXISTS TO PIN, IN THE ORDER IT PINS IT ────────────────
//
// 1. 🛑 **THE BOARD WHERE THE SPLIT IS DENIED, FIRST** (§4). D278/D279's standing
//    lesson is that a permission's natural test is written on the board it is
//    obviously about. The dangerous direction here is the opposite one: a build
//    that splits on TEXT alone silently DELETES a printed restriction from any
//    card whose clause is not represented. So §4 authors a body printing the
//    Terapagos sentence VERBATIM with NO `attackGate`, and asserts it keeps its
//    whole string and stays loud. A text-only split is green on every other line
//    in this file.
//    🆕🆕 **D444 — AND THAT RUNG WAS PINNING HALF A DEFECT.** "Keeps its whole
//    string and stays loud" is a claim about the DAMAGE. The RULE on the same body
//    was never asked about, and it was **silently absent**: measured before D444,
//    `UNGATED_TWIN` could declare "Unified Beatdown" on exactly the turn its own
//    printed sentence forbids. `attackGateOf` is `registry ?? derived` from that
//    head, so §4 now drives the rule on `UNGATED_TWIN` and keeps the "text alone
//    gates nothing" half on `NEAR_MISS_TWIN`, whose clause is one token off the
//    table and therefore genuinely unrepresented. The suite is now 24 rungs, not
//    23, because the two halves are two claims.
// 2. **THE THREE COUNT SOURCES DISAGREE ON ONE BOARD** (§5). 3 mine / 1 theirs
//    makes `yourBenchCount` 3, `opponentBenchCount` 1 and `bothSidesBenchCount` 4
//    — three distinct numbers on one setup, so an arm that answered its
//    neighbour's question cannot pass.
// 3. **THE SPLIT DOES NOT LOOSEN AN ANCHOR** (§3/§6). It hands a WHOLE sentence
//    to unchanged `^…$` patterns, so a body the readers refuse is still refused
//    LOUDLY — and §6 asserts the remaining three gate families report their BODY
//    alone on ATTACK_EFFECT_SKIPPED, which is the observable difference between
//    "the clause was accounted for" and "the clause was dropped".
// 4. **`MATCH_RECORD_VERSION` STAYS 14, DRIVEN BOTH WAYS** (§7).

// ── the printed sentences, byte-for-byte off the D1 ─────────────────────────

const TERAPAGOS_TEXT =
  "If you go second, you can't use this attack during your first turn. This attack does 30 damage for each of your Benched Pokémon.";
const TERAPAGOS_BODY = "This attack does 30 damage for each of your Benched Pokémon.";
const VOLBEAT_TEXT =
  "If you go first, you can use this attack during your first turn. Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.";
const VOLBEAT_BODY =
  "Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.";
const ILLUMISE_TEXT =
  "You can use this attack only if you go second, and only during your first turn. Shuffle 1 of your opponent's Benched Pokémon and all attached cards into their deck.";
const ILLUMISE_BODY =
  "Shuffle 1 of your opponent's Benched Pokémon and all attached cards into their deck.";
const DIPPLIN_TEXT = "This attack does 20 damage for each of your Benched Pokémon.";
const TAPU_KOKO_TEXT = "This attack does 20 more damage for each of your Benched Pokémon.";
/** ⚠️ 0 LEGAL, 3 PRINTED — the PREDICATE-narrowed noun, and the one near miss a
    `[^.]*` noun would have swallowed. */
const NARROWED_NOUN =
  "This attack does 40 more damage for each of your Benched Pokémon that has any {G} Energy attached.";

const TERAPAGOS_IDS = [
  "sv07-128",
  "sv07-170",
  "sv07-173",
  "sv08.5-092",
  "sv08.5-169",
  "sv08.5-180",
  "svp-165",
] as const;

// ── the local pool (FIXTURE_POOL untouched — D190's idiom, D275's `cardPool`) ─

/** 🛑 THE CONTROL THIS WHOLE SUITE RESTS ON: the Terapagos sentence, VERBATIM,
    on a body with NO registry row and therefore NO `attackGate`. A split keyed on
    TEXT rather than on the authored gate resolves this card's damage and deletes
    its printed restriction — and would be green on every other assertion here.

    🆕🆕 **D444 — "AND THEREFORE NO `attackGate`" IS NO LONGER TRUE, AND THE OLD
    RUNG THIS BODY CARRIED WAS PINNING A SILENT DEFECT.** `attackGateOf` is
    `registry ?? timingGateFromAttackText` from D444's head, so this body derives the
    same `barredIf` its registered twins author. What §4 used to assert — that the
    body keeps its whole string and stays LOUD — was TRUE about the damage half and
    said nothing about the RULE half, which was **silently absent**: MEASURED before
    the change, this body could declare "Unified Beatdown" on exactly the turn its own
    printed sentence forbids. §4 now drives the rule. The "text alone gates nothing"
    discrimination moves to `NEAR_MISS_TWIN` below (D418: after re-pointing, ask what
    the OLD claim could catch that the new one cannot). */
const UNGATED_TWIN = "fix-d282-ungated-twin";
/** 🆕🆕 **D444 — THE NEAR-MISS, AND IT IS WHAT KEEPS §4 A PAIR.** One token off the
    printed clause ("next" for "first"), so it is not a row of `ATTACK_GATE_CLAUSES`,
    derives no gate, keeps its whole printed string and stays on the loud path. ⚠️
    Differs on EXACTLY ONE AXIS (D427) — a near-miss that were also re-worded or
    re-cased could not show WHICH feature did the refusing. */
const NEAR_MISS_TWIN = "fix-d444-near-miss-twin";
const NEAR_MISS_TEXT =
  "If you go second, you can't use this attack during your next turn. This attack does 30 damage for each of your Benched Pokémon.";
/** A plain benchable body, and the Basic the deck search may fetch. */
const FILLER = "fix-d282-filler";
const ENERGY = "fix-d282-energy";

function terapagos(id: string): Card {
  // Every scalar re-read off the D1 row (D146): hp 230, {C}, retreat 2, "30×" on
  // idx 0 at {C}{C} and "Crown Opal" 180 at {G}{W}{L}. ⚠️ THE PRINTED "30×" IS
  // LOAD-BEARING — the multiply fold DROPS the printed base, so a build that kept
  // it would read 30 + 30×n here and only here.
  return battler(id, {
    name: "Terapagos ex",
    hp: 230,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Unified Beatdown",
        damage: "30×",
        effect: TERAPAGOS_TEXT,
      },
      { cost: ["Colorless", "Colorless"], name: "Crown Opal", damage: 180 },
    ],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(TERAPAGOS_IDS.map((id) => [id, terapagos(id)])),
  "sv06-009": battler("sv06-009", {
    name: "Volbeat",
    hp: 70,
    retreat: 1,
    types: ["Grass"],
    attacks: [
      { cost: ["Colorless"], name: "Quick Sign", effect: VOLBEAT_TEXT },
      { cost: ["Colorless", "Colorless"], name: "Coordinated Strike", damage: "20+" },
    ],
  }),
  "sv06-010": battler("sv06-010", {
    name: "Illumise",
    hp: 70,
    retreat: 1,
    types: ["Grass"],
    attacks: [{ cost: ["Colorless"], name: "Slowing Perfume", effect: ILLUMISE_TEXT }],
  }),
  "sv06-018": battler("sv06-018", {
    name: "Dipplin",
    hp: 80,
    retreat: 2,
    types: ["Grass"],
    attacks: [
      { cost: ["Colorless"], name: "Do the Wave", damage: "20×", effect: DIPPLIN_TEXT },
    ],
  }),
  "sv09-051": battler("sv09-051", {
    name: "Tapu Koko ex",
    hp: 200,
    retreat: 0,
    types: ["Lightning"],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Linked Lightning",
        damage: "60+",
        effect: TAPU_KOKO_TEXT,
      },
    ],
  }),
  [UNGATED_TWIN]: battler(UNGATED_TWIN, {
    name: "Ungated Twin",
    hp: 230,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Unified Beatdown",
        damage: "30×",
        effect: TERAPAGOS_TEXT,
      },
    ],
  }),
  [NEAR_MISS_TWIN]: battler(NEAR_MISS_TWIN, {
    name: "Near-Miss Twin",
    hp: 230,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Unified Beatdown",
        damage: "30×",
        effect: NEAR_MISS_TEXT,
      },
    ],
  }),
  [FILLER]: battler(FILLER, {
    name: "D282 Filler",
    hp: 60,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [ENERGY]: typedEnergy(ENERGY, "Colorless"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "sv07-128": 4,
  "sv07-170": 1,
  "sv07-173": 1,
  "sv08.5-092": 1,
  "sv08.5-169": 1,
  "sv08.5-180": 1,
  "svp-165": 1,
  "sv06-009": 4,
  "sv06-010": 2,
  "sv06-018": 4,
  "sv09-051": 4,
  [UNGATED_TWIN]: 4,
  // 🆕🆕 D444 — the near-miss control; `ENERGY` drops 24 → 20 to keep the 60 honest.
  [NEAR_MISS_TWIN]: 4,
  [FILLER]: 8,
  [ENERGY]: 20,
});

/** Two seeds — nothing below rests on one shuffle (D270). */
const SEEDS = [5171, 5179] as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

/** D277's shape: the FIRST PLAYER is a parameter, because everything the gate
    half of this file asserts is a per-seat fact. */
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

/** `seat`'s Active is `activeId`, its Bench is EXACTLY `bench` fillers, the
    opponent's is exactly `foeBench`, and two {C} are attached so no refusal below
    can ever be an unpaid cost. Every count this suite measures is a POPULATION,
    so both Benches are cleared first — a body the shuffle placed would move the
    answer silently.

    ⚠️ `passes` IS LOAD-BEARING AND IS NEVER DEFAULTED SILENTLY. §4 bans every
    attack on turn 1, so a damage assertion made on turn 1 would be measuring the
    first-turn ban rather than the fold; the turns are passed BEFORE the surgery
    so that no draw or prize step can move a Bench this suite counts. */
function board(
  seed: number,
  first: Seat,
  seat: Seat,
  activeId: string,
  bench: number,
  foeBench = 0,
  passes = 2,
): GameState {
  const foe = seat === "p1" ? "p2" : "p1";
  let state = localSetup(seed, first);
  for (let i = 0; i < passes; i += 1) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  if (state.phase.kind !== "turn:action" || state.phase.seat !== seat) {
    throw new Error(`expected ${seat} to be on turn, got ${JSON.stringify(state.phase)}`);
  }
  state = setActiveFromDeck(state, seat, activeId);
  state = clearBench(state, seat);
  state = clearBench(state, foe);
  for (let i = 0; i < bench; i += 1) state = benchFromDeck(state, seat, FILLER);
  for (let i = 0; i < foeBench; i += 1) state = benchFromDeck(state, foe, FILLER);
  return attachFromDeck(state, seat, ENERGY, 2);
}

function swing(state: GameState, seat: Seat, index: number) {
  const result = applyAction(deepFreeze(state), { type: "attack", seat, index });
  if (!result.ok) throw new Error(`attack refused: ${result.error.code}`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE CENSUS, against the committed corpus rather than against memory.
// ─────────────────────────────────────────────────────────────────────────────

describe("D282 §1 — the leading-clause census, re-derived at HEAD", () => {
  it("🛑 the corpus holds exactly 6 gate sentences / 14 printings, and NO other leading clause", () => {
    const corpus = legalAttackCorpus();
    const gated = corpus.filter(([, text]) => splitAttackGateClause(text) !== null);
    // 🆕🆕 D395 — 5/13 -> **6/14**: Miltank `sv08.5-081`'s *"You can use this attack
    // only if this Pokémon used Rollout during your last turn."* — a FOURTH row in
    // `ATTACK_GATE_CLAUSES`, and the first that is a whole printed effect text
    // rather than a leading clause. ⚠️ **IT MOVES THIS NUMBER AND NOT THE
    // `leadingIf` ONE BELOW**, which is exactly the separation the comment there
    // predicted a fourth spelling would test: the sentence neither starts with
    // `If ` nor contains a `. `, so it is in NEITHER of that filter's two halves.
    expect(gated.length).toBe(6);
    expect(gated.reduce((sum, [units]) => sum + units, 0)).toBe(14);

    // ⚠️ THE NEGATIVE HALF, AND IT IS THE ONE THAT DECIDED THE DESIGN. Every OTHER
    // multi-sentence corpus row that opens with "If " is a sentence whose `If`
    // clause is the SUBSTANCE — no split may touch them. Six of them, and the
    // count is asserted so that a later slice adding a fourth gate spelling to
    // `ATTACK_GATE_CLAUSES` moves the first number and not this one.
    const leadingIf = corpus.filter(
      ([, text]) => text.startsWith("If ") && text.includes(". "),
    );
    // 8 DISTINCT sentences / 16 printings. Three of the eight are gate spellings
    // (Terapagos ex, Volbeat, Exeggcute) carrying 10 of the 16 printings; the
    // other five are the substantive ones, 6 printings between them.
    expect(leadingIf.length).toBe(8);
    expect(leadingIf.reduce((sum, [units]) => sum + units, 0)).toBe(16);
    const substantive = leadingIf.filter(([, text]) => splitAttackGateClause(text) === null);
    expect(substantive.length).toBe(5);
    expect(substantive.reduce((sum, [units]) => sum + units, 0)).toBe(6);
  });

  it("the 13 `yourBenchCount` printings, and the two POOL-ONLY sentences that are not arms", () => {
    const corpus = new Map(legalAttackCorpus().map(([units, text]) => [text, units]));
    expect(corpus.get(TAPU_KOKO_TEXT)).toBe(3);
    expect(corpus.get(DIPPLIN_TEXT)).toBe(3);
    expect(corpus.get(TERAPAGOS_TEXT)).toBe(7);
    // 3 + 3 + 7 = 13, and the split half is 7 of them.
    // ⚠️ 0-LEGAL AND SO ABSENT FROM THE CORPUS ENTIRELY — asserted rather than
    // assumed, because "the reader refuses it" and "the corpus never offers it"
    // are two different guarantees and only the first is a code fact.
    expect(corpus.get(NARROWED_NOUN)).toBeUndefined();
    expect(corpus.get("This attack does 10 more damage for each of your Benched Pokémon.")).toBe(
      undefined,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The two readers — the fold is the ADJECTIVE, the seat is the POSSESSIVE.
// ─────────────────────────────────────────────────────────────────────────────

describe("D282 §2 — `yourBenchCount` on both folds", () => {
  it("reads the attacker's own Bench on the ADDITIVE fold and on the `×` fold", () => {
    expect(deriveAttackDamageBonus(TAPU_KOKO_TEXT)).toEqual({
      per: 20,
      count: { kind: "yourBenchCount" },
    });
    expect(deriveAttackDamageMultiplier(DIPPLIN_TEXT)).toEqual({
      per: 20,
      count: { kind: "yourBenchCount" },
    });
  });

  it("🛑 THE POSSESSIVE IS THE WHOLE DISCRIMINATOR — the three Bench nouns stay apart", () => {
    // One word separates these three sentences and they must produce three
    // different members. A reader that dropped the possessive would collapse them.
    expect(
      deriveAttackDamageBonus("This attack does 20 more damage for each of your opponent's Benched Pokémon."),
    ).toEqual({ per: 20, count: { kind: "opponentBenchCount" } });
    expect(
      deriveAttackDamageBonus(
        "This attack does 20 more damage for each Benched Pokémon (both yours and your opponent's).",
      ),
    ).toEqual({ per: 20, count: { kind: "bothSidesBenchCount" } });
    expect(deriveAttackDamageBonus(TAPU_KOKO_TEXT)).toEqual({
      per: 20,
      count: { kind: "yourBenchCount" },
    });
  });

  it("counts BODIES, never the counters on them — the near miss one arm over", () => {
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 20 damage for each damage counter on all of your Benched Pokémon.",
      ),
    ).toEqual({ per: 20, count: { kind: "damageCountersOnYourBench" } });
  });

  it("⚠️ REFUSES the PREDICATE-narrowed noun (3 printed, 0 legal) and the anchors' near misses", () => {
    const read = (t: string) => deriveAttackDamageBonus(t) ?? deriveAttackDamageMultiplier(t);
    expect(read(NARROWED_NOUN)).toBeNull();
    for (const sentence of [TAPU_KOKO_TEXT, DIPPLIN_TEXT]) {
      expect(read(sentence.replace(/^This/, "this"))).toBeNull(); // lowercase
      expect(read(sentence.slice(0, -1))).toBeNull(); // no trailing period
      expect(read(`Flip a coin. If heads, ${sentence.toLowerCase()}`)).toBeNull(); // leading text
      expect(read(`${sentence} Then, shuffle your deck.`)).toBeNull(); // trailing text
    }
    // 🛑 AND THE GATED PRINTING IS REFUSED WHOLE, WHICH IS WHY THE SPLIT EXISTS.
    expect(read(TERAPAGOS_TEXT)).toBeNull();
  });

  it("a printed 0 does nothing — the guard every arm in both families carries", () => {
    expect(
      deriveAttackDamageMultiplier("This attack does 0 damage for each of your Benched Pokémon."),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus("This attack does 0 more damage for each of your Benched Pokémon."),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The split anchor as a PURE function — three clauses, and nothing else.
// ─────────────────────────────────────────────────────────────────────────────

/** 🆕🆕 D395 — Miltank `sv08.5-081` idx 1 "Moomoo Rolling", the FOURTH
    `ATTACK_GATE_CLAUSES` row and the only one that is a whole printed effect text.
    Transcribed from the printing, not paraphrased. */
const ROLLOUT_GATE_TEXT =
  "You can use this attack only if this Pokémon used Rollout during your last turn.";

describe("D282 §3 — splitAttackGateClause", () => {
  it("splits all three printed gate spellings and hands back BOTH halves", () => {
    expect(splitAttackGateClause(TERAPAGOS_TEXT)).toEqual({
      clause: "If you go second, you can't use this attack during your first turn.",
      body: TERAPAGOS_BODY,
    });
    expect(splitAttackGateClause(VOLBEAT_TEXT)).toEqual({
      clause: "If you go first, you can use this attack during your first turn.",
      body: VOLBEAT_BODY,
    });
    expect(splitAttackGateClause(ILLUMISE_TEXT)).toEqual({
      clause: "You can use this attack only if you go second, and only during your first turn.",
      body: ILLUMISE_BODY,
    });
  });

  it("🛑 IS ANCHORED AT `^` — a gate clause anywhere but the front is not a split", () => {
    expect(splitAttackGateClause(`Draw a card. ${TERAPAGOS_TEXT}`)).toBeNull();
    expect(splitAttackGateClause(TERAPAGOS_BODY)).toBeNull();
    expect(splitAttackGateClause(DIPPLIN_TEXT)).toBeNull();
    expect(splitAttackGateClause("")).toBeNull();
  });

  it("🆕🆕 a clause with NO BODY behind it IS a split, and `body` is the empty string", () => {
    // 🛑 **D395 REVERSES D282's EMPTY-REMAINDER REFUSAL, AND THE REFUSAL NAMED ITS
    // OWN TRIGGER.** This case used to assert `null`, and its comment said why:
    // *"No legal printing is clause-only today (all 13 carry a body), so this is a
    // guard against a future one."* Miltank `sv08.5-081` idx 1 IS that printing, so
    // the premise has expired. ⚠️ **AND THE OLD ANSWER WAS THE UNSAFE ONE ONCE IT
    // WENT LIVE**, which is the opposite of what the old comment claimed: `null`
    // hands the WHOLE printed string to the readers, every one of them refuses it,
    // and `ATTACK_EFFECT_SKIPPED` fires naming a sentence the §8 seam enforced in
    // full. `""` is what `attack.ts` already spells as "no text" at every
    // downstream site.
    expect(splitAttackGateClause(ROLLOUT_GATE_TEXT)).toEqual({
      clause: ROLLOUT_GATE_TEXT,
      body: "",
    });
    // The two FIRST-TURN spellings answer the same way when nothing follows them —
    // no legal printing spells either that way today, and the branch is one rule
    // rather than one card.
    expect(
      splitAttackGateClause("If you go first, you can use this attack during your first turn."),
    ).toEqual({
      clause: "If you go first, you can use this attack during your first turn.",
      body: "",
    });
    // ⚠️ TRAILING WHITESPACE IS THE SAME CASE AND NOT A THIRD ONE — the leading
    // `trim()` is what makes it so, and this is the assertion that says the branch
    // is reached through the trim rather than around it.
    expect(
      splitAttackGateClause("If you go first, you can use this attack during your first turn.  "),
    ).toEqual({
      clause: "If you go first, you can use this attack during your first turn.",
      body: "",
    });
  });

  it("🛑 DOES NOT LOOSEN ANY READER — all TWELVE still refuse the WHOLE gated string", () => {
    // The split's entire safety argument: it produces a different STRING, and the
    // anchors are untouched. If any reader ever resolves the compound directly,
    // `censusAtHead`'s split term double-counts and this line is the earlier warning.
    const readers = [
      deriveAttackEffect,
      deriveAttackDamageBonus,
      deriveAttackDamagePenalty,
      deriveAttackDamageMultiplier,
      deriveAttackCoinFlip,
      deriveAttackRequirement,
      // 🆕🆕 D419 — COMPLETED TO THE MODULE'S TWELVE. This list was hand-kept INLINE,
      // which is why D418's survey of forty module-level `READERS` arrays did not see
      // it at all. ⚠️ A REFUSAL OVER A SHORT LIST IS NOT FALSE, IT IS NARROWER — the
      // missing reader is simply never asked and the rung stays green, which is the
      // failure mode this whole run is about.
      deriveAttackBonusConsequent,
      deriveAttackCancelRequirement,
      deriveAttackDiscardScaledBoost,
      deriveAttackOptionalBoost,
      deriveAttackOptionalCostBoost,
      // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
      // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
      // array's LAST entries plus its closing bracket, and appending moves that anchor
      // without a character of it changing.
      deriveAttackPreDamage,
      deriveAttackDamageSuppression,
    ];
    // 🆕🆕 D419 — THE TWO-RUNG GUARD, CO-LOCATED because this list is function-local.
    // The diff names the drifting reader; the COUNT is pinned separately because a
    // diff alone stays GREEN when a slice deletes a reader from the module and from
    // this list in the same commit.
    expect(readers.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(13);
    for (const text of [TERAPAGOS_TEXT, VOLBEAT_TEXT, ILLUMISE_TEXT]) {
      // 🆕🆕 D419 — the claim the TITLE makes, taken off the module rather than off
      // the list beside it. The loop below names WHICH reader broke and is kept for
      // that; this line is what makes "no reader resolves the compound" true of the
      // engine and not merely of this array.
      expect(resolvedByAnyReader(text), text).toBe(false);
      for (const read of readers) expect(read(text), text).toBeNull();
    }
    // …and the BODIES behind all three resolve. 🆕 **D299 — ILLUMISE'S JOINED
    // THEM, WHICH IS WHY THIS LINE IS AN ASSERTION AND NOT A COMMENT.** It was
    // the measured 8-of-13's odd one out for seventeen slices ("Illumise's does
    // not, and that is the measured 8-of-13"); `returnBenched` reads it, and
    // `censusAtHead`'s split term moved 10 → 11 in the same commit.
    expect(deriveAttackDamageMultiplier(TERAPAGOS_BODY)).not.toBeNull();
    expect(deriveAttackEffect(VOLBEAT_BODY)).not.toBeNull();
    expect(deriveAttackEffect(ILLUMISE_BODY)).not.toBeNull();
    // 🛑 AND THE SAFETY ARGUMENT IS UNCHANGED BY THAT: the loop above still shows
    // every reader refusing Illumise's WHOLE gated string, so the new anchor is
    // reached through the split and by no other route. A reader loosened to
    // swallow the gate clause would satisfy the line above and FAIL the loop.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. 🛑 THE BOARD WHERE THE SPLIT IS DENIED — written before the one where it works.
// ─────────────────────────────────────────────────────────────────────────────

describe("D282 §4 — the split fires ONLY where the gate is already accounted for", () => {
  // 🆕🆕 **D444 — THIS RUNG HAS MOVED FROM `UNGATED_TWIN` TO `NEAR_MISS_TWIN`, AND
  // THE MOVE IS THE ONLY WAY TO KEEP WHAT IT WAS FOR.** It asserted that a body
  // whose clause is NOT represented keeps its whole string — the discrimination that
  // makes `D282-split-fires-without-a-gate` killable. D444 made every clause in the
  // table represented BY CONSTRUCTION (`attackGateOf` is `registry ?? derived`), so
  // `UNGATED_TWIN` is no longer such a body and re-pointing this at it would assert
  // something TRUE that nothing can falsify. `NEAR_MISS_TWIN` is such a body: one
  // token off the printed clause, no table row, no gate, no split.
  it("🛑 a NEAR-MISS clause keeps its whole string and stays LOUD — the split is a TABLE, not a pattern", () => {
    expect(programFor(NEAR_MISS_TWIN)).toBeUndefined();
    expect(splitAttackGateClause(NEAR_MISS_TEXT)).toBeNull();
    const state = board(SEEDS[0], "p1", "p1", NEAR_MISS_TWIN, 3);
    const { events } = swing(state, "p1", 0);
    // ⚠️ THE FOLD NEVER RAN, so the printed "30×" lands as an UNEXPLAINED flat 30
    // — not the 90 the gated twin below deals off the identical Bench. That is the
    // observable a text-only split would erase.
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    // …and the engine SAYS SO, with the WHOLE printed compound in the report and
    // the unexplained "×" beside it.
    const skipped = find(events, "ATTACK_EFFECT_SKIPPED");
    expect(skipped?.effect).toBe(NEAR_MISS_TEXT);
    expect(skipped?.damageModifier).toBe("×");
  });

  // 🆕🆕 **D444 — THE DEFECT THE OLD RUNG WAS PINNING, NOW DRIVEN THE OTHER WAY.**
  it("🆕🆕 D444 — the UNGATED twin is now GATED off its own printed clause, with no registry row", () => {
    expect(programFor(UNGATED_TWIN)).toBeUndefined();
    // ① THE RULE. `passes = 1` lands on TURN 2 with `first = "p1"`, which is p2's
    // OWN FIRST TURN as the going-SECOND player — the one board the printed clause
    // names. 🛑 **BEFORE D444 THIS DECLARATION SUCCEEDED**: `attackGateOf` had one
    // producer, keyed by card id, and an unregistered printing lost its rule in
    // silence while the damage half of the same sentence was loudly withheld.
    const barred = board(SEEDS[0], "p1", "p2", UNGATED_TWIN, 3, 0, 1);
    expect(barred.turn).toBe(2);
    const refused = applyAction(deepFreeze(barred), { type: "attack", seat: "p2", index: 0 });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error.code).toBe("ATTACK_PREVENTED");
    // …and the REGISTERED twin answers identically on the identical board, which is
    // the agreement claim: `registry ?? derived` must not fork the behaviour.
    const registered = board(SEEDS[0], "p1", "p2", "sv07-128", 3, 0, 1);
    const refusedReal = applyAction(deepFreeze(registered), {
      type: "attack",
      seat: "p2",
      index: 0,
    });
    expect(refusedReal.ok).toBe(false);
    expect(refusedReal.ok === false && refusedReal.error.code).toBe("ATTACK_PREVENTED");
    // ② THE ADMISSION (D424: a refusal rung owes one on the same axis). On a turn
    // the clause does NOT name, the same body resolves the fold to 90 — so the bar
    // is a GATE and not a build that refuses everything.
    const { events } = swing(board(SEEDS[0], "p1", "p1", UNGATED_TWIN, 3), "p1", 0);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(90);
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("…while the GATED printing of that same sentence resolves it", () => {
    // The pair, on the same seed and the same Bench. The ONLY difference is the
    // registry's `attackGate`, which is the precondition under test.
    expect(programFor("sv07-128")?.attackGate?.[0]).toBeDefined();
    const state = board(SEEDS[0], "p1", "p1", "sv07-128", 3);
    const { events } = swing(state, "p1", 0);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(90);
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The evaluator, on a board where the three Bench counts DISAGREE.
// ─────────────────────────────────────────────────────────────────────────────

describe("D282 §5 — the count, driven", () => {
  it("🛑 3 MINE / 1 THEIRS: the answer is 3 × 30, not 1 × 30 and not 4 × 30", () => {
    // Three distinct numbers on ONE setup, so an arm reading `defenderSeat` or
    // summing both sides cannot pass. This is the mutant-killing board.
    for (const seed of SEEDS) {
      const state = board(seed, "p1", "p1", "sv07-128", 3, 1);
      expect(find(swing(state, "p1", 0).events, "DAMAGE_DEALT")?.dealt).toBe(90);
    }
  });

  it("the `×` fold DROPS the printed base — an empty Bench deals nothing at all", () => {
    const state = board(SEEDS[0], "p1", "p1", "sv07-128", 0);
    const { events } = swing(state, "p1", 0);
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    // ⚠️ AND IT IS STILL NOT "SKIPPED" — the sentence resolved; it resolved to 0.
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("counts BODIES and never the counters on them", () => {
    let hurt = board(SEEDS[0], "p1", "p1", "sv07-128", 2);
    hurt = {
      ...hurt,
      players: {
        ...hurt.players,
        p1: { ...hurt.players.p1, bench: hurt.players.p1.bench.map((p) => ({ ...p, damage: 50 })) },
      },
    };
    const clean = board(SEEDS[0], "p1", "p1", "sv07-128", 2);
    expect(find(swing(hurt, "p1", 0).events, "DAMAGE_DEALT")?.dealt).toBe(60);
    expect(find(swing(clean, "p1", 0).events, "DAMAGE_DEALT")?.dealt).toBe(60);
  });

  it("the ADDITIVE fold KEEPS the printed base: 60 + 2 × 20 = 100 (Tapu Koko ex)", () => {
    // The un-gated half of the member, on the other fold, so the arm and the
    // evaluator are exercised on a printing that never reaches the split.
    const state = board(SEEDS[0], "p1", "p1", "sv09-051", 2, 3);
    const { events } = swing(state, "p1", 0);
    expect(find(events, "DAMAGE_DEALT")?.scaled).toBe(40);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(100);
  });

  it("…and the un-gated `×` printing reads the same member: 3 × 20 (Dipplin)", () => {
    const state = board(SEEDS[1], "p1", "p1", "sv06-018", 3, 2);
    expect(find(swing(state, "p1", 0).events, "DAMAGE_DEALT")?.dealt).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. The gate and the split, together — and the residue the split still reports.
// ─────────────────────────────────────────────────────────────────────────────

describe("D282 §6 — the gate still bites, and the unread bodies stay loud", () => {
  it("🛑 THE GATE IS UNTOUCHED: going second on turn 1, Terapagos is still BARRED", () => {
    // The split runs AFTER the §4/§8 declaration seam, so a slice that reached the
    // damage must not have reached it by loosening the gate. Driven from the seat
    // that goes SECOND on its own first turn — the exact board D281 built.
    // `passes: 1` puts p2 on turn 2 — p2's OWN first turn, having gone second.
    const turn = board(SEEDS[0], "p1", "p2", "sv07-128", 3, 0, 1);
    expect(turn.turn).toBe(2);
    const refused = applyAction(deepFreeze(turn), { type: "attack", seat: "p2", index: 0 });
    expect(refused.ok).toBe(false);
    // …and the wire agrees, per row.
    const phase = redactGame(turn, "p2").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action on the wire");
    expect(phase.attacks.find((a) => a.index === 0)?.playable).toBe(false);
  });

  it("VOLBEAT's licensed body RUNS — the search program the split unblocked", () => {
    // `sv06-009` idx 0 is D281's LICENCE arm: legal on turn 1 when you go first.
    // Its body has been a named deferral in effects.ts since D230 for exactly the
    // reason this slice removed. A `searchDeck` op parks for a choice, so the
    // observable is the pending prompt rather than an event.
    const state = board(SEEDS[0], "p1", "p1", "sv06-009", 1, 0, 0);
    expect(state.turn).toBe(1);
    const { state: after, events } = swing(state, "p1", 0);
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(after.pending).not.toBeNull();
  });

  it("🆕 D299 — ILLUMISE's body is READ NOW, and the split is still what delivers it", () => {
    // 🛑 **THIS TEST INVERTED AT D299 AND THE INVERSION IS THE POINT.** It read
    // "ILLUMISE's body is STILL REFUSED, and the report names the BODY not the
    // compound" — the loud `ATTACK_EFFECT_SKIPPED` path carrying the SPLIT half
    // was the observable that told the two failure modes apart. `returnBenched`
    // reads that body, so the loud row is gone and the observable moves to the
    // effect itself; what does NOT change is the route, and that is what the
    // second board below pins.
    // p1 goes SECOND (first = p2) and attacks on turn 2 — its own first turn,
    // which is the only board Illumise's `onlyIf` gate admits.
    //
    // ① The opponent's Bench is EMPTY (foeBench = 0), which on turn 2 going
    // second is the ordinary board rather than an edge case: `parkOrForce` finds
    // no candidate and the op is a silent no-op. 🛑 STILL NOT A SKIP — an effect
    // that ran and found nothing is not an effect the engine could not read, and
    // conflating the two is exactly what the old assertion was guarding.
    const empty = board(SEEDS[0], "p2", "p1", "sv06-010", 1, 0, 1);
    const { state: afterEmpty, events: emptyEvents } = swing(empty, "p1", 0);
    expect(find(emptyEvents, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(find(emptyEvents, "POKEMON_RETURNED")).toBeUndefined();
    expect(afterEmpty.players.p2.bench).toHaveLength(0);
    // `pending` is the PROMPT list and an empty array is "nothing to answer" —
    // the same shape §4's ungated twin asserts non-empty one describe up.
    expect(afterEmpty.pending).toHaveLength(0);

    // ② One body on their Bench — forced (a lone candidate is not a decision),
    // so the whole sentence resolves inside the attack.
    const one = board(SEEDS[0], "p2", "p1", "sv06-010", 1, 1, 1);
    const benchedUid = topUid(one.players.p2.bench[0] as InPlayPokemon) as string;
    const { state: after, events } = swing(one, "p1", 0);
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    const returned = find(events, "POKEMON_RETURNED");
    expect(returned?.seat).toBe("p2");
    expect(returned?.actor).toBe("p1");
    expect(returned?.dest).toBe("deck");
    expect(after.players.p2.bench).toHaveLength(0);
    // ⚠️ NOT A DECK-LENGTH ASSERTION. The attack ENDS the turn, so p2's own
    // turn-start draw takes a card back off the deck in the same result — a
    // length would net to +0 and read as "nothing happened". The uid is the
    // observable that survives the draw.
    expect(returned?.uids).toEqual([benchedUid]);
    expect(one.players.p2.deck).not.toContain(benchedUid);
    expect(after.players.p2.deck).toContain(benchedUid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. MATCH_RECORD_VERSION — driven, not asserted.
// ─────────────────────────────────────────────────────────────────────────────

describe("D282 §7 — the persisted shape is untouched", () => {
  it("a scaled attack and a plain one write the SAME top-level keys, against a literal anchor", () => {
    // ⚠️ A DIFF BETWEEN TWO BOARDS FROM ONE BUILD IS A HALF-GUARD (D279) — it is
    // blind to "every body grew a key". So the diff is PAIRED with a literal list.
    const scaled = swing(board(SEEDS[0], "p1", "p1", "sv07-128", 3), "p1", 0).state;
    const plain = swing(board(SEEDS[0], "p1", "p1", FILLER, 3), "p1", 0).state;
    expect(Object.keys(scaled).sort()).toEqual(Object.keys(plain).sort());
    expect(Object.keys(scaled).sort()).toEqual(
      [
        "allowances",
        "cardIdByUid",
        "cardPool",
        "firstPlayer",
        "lastKoMarks",
        "lastKoTurn",
        "oncePerGameSpent",
        // 🆕 D283 — `handPlayLockedTurn`, the turn-scoped imposed hand-play bar.
        "handPlayLockedTurn",
        "pending",
        "phase",
        "players",
        "rngState",
        "stadium",
        "turn",
      ].sort(),
    );
  });

  it("🛑 NOTHING THIS SLICE ADDS CAN REACH A PERSISTED STRUCTURE — the source is a DERIVED value", () => {
    // The version question, answered structurally rather than by inspection of one
    // board. `DamageCountSource` is produced by a reader at attack time from the
    // printed string and consumed inside the same call; it is NEVER stored, and the
    // registry authors none of it. Measured as an absence with its own control: the
    // whole registry is swept and the string `yourBenchCount` appears in no
    // authored program at all, while `attackGate` (D281's field) appears in 13 —
    // so the sweep is answering rather than empty.
    // 🆕🆕 **D395 — THE 13 IS A FACT ABOUT `POOL`, NOT ABOUT THE REGISTRY**, and it
    // stays 13 for that reason: the fourteenth gate (Miltank `sv08.5-081`) is driven
    // from a LOCAL pool in `rolloutGate.test.ts` and never enters `FIXTURE_POOL`.
    // `splitOrder.test.ts` §1 holds the registry-wide count, which IS 14.
    let programsWalked = 0;
    let gatesFound = 0;
    let countSourcesFound = 0;
    for (const id of Object.keys(POOL)) {
      const program = programFor(id);
      if (program === undefined) continue;
      programsWalked += 1;
      gatesFound += Object.keys(program.attackGate ?? {}).length;
      if (JSON.stringify(program).includes("yourBenchCount")) countSourcesFound += 1;
    }
    expect(programsWalked).toBeGreaterThan(0);
    expect(gatesFound).toBe(9); // the 7 Terapagos + Volbeat + Illumise in THIS pool
    expect(countSourcesFound).toBe(0);
    // …and the in-play stack carries no new field either.
    const scaled = swing(board(SEEDS[0], "p1", "p1", "sv07-128", 3), "p1", 0).state;
    const active = scaled.players.p1.active;
    expect(active).not.toBeNull();
    expect(Object.keys(active ?? {})).not.toContain("scaled");
  });
});
