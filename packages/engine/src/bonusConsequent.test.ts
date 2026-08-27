import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, resolvedByAnyReader } from "./censusAttackCorpus";
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
  programBranchCarriers,
  setActiveFromDeck,
  typedEnergy,
  walkProgram,
} from "./testFixtures";

// ── D317 — "…THIS ATTACK DOES {N} MORE DAMAGE, AND {CONSEQUENT}" — D316's SHAPE
//    WITH THE DECIDER CHANGED, AND `coinFlipGate.otherwise`'s FIRST PRODUCER. ──
//
// THE POPULATION, queried against remote Cloudflare D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) over MCP on **2026-08-10**, WHOLE
// COLUMN read (D306's rule) and at FOUR widths across all three text columns:
//
//   instr(attacks_json,  'more damage, and ')     → 14 rows, 6 legal  ← the family
//   instr(effect,        'more damage, and ')     → 0
//   instr(abilities_json,'more damage, and ')     → 0
//   instr(<any>,         'more damage and ')      → 0   (no comma-less spelling)
//   instr(<any>,         'and this attack does ') → 5, ALL a different family
//
// The last width is the one worth naming: reversing the word order (D312/D313's
// rule) returns Armarouge `sv08-034`, Bombirdier `sv09-101`, Zeraora `sv10-078`,
// Quagsire `svp-156` and Misty's Gyarados `sv10-049` — a cost paid up front and
// then a FLAT hit ("Discard all Energy from this Pokémon, and this attack does
// 120 damage to…"). None carries "more", none is this shape, and a reader that
// had been written to a looser pattern would have claimed all five.
//
//   sv06-040     Hearthflame Mask Ogerpon ex  idx 1 "Dynamic Blaze"  "140+"
//   sv06-192     (the same card, a second rarity)
//   sv06-212     (a third)
//   sv08.5-017   (a fourth)
//   sv08.5-148   (a fifth)
//     "If your opponent's Active Pokémon is an Evolution Pokémon, this attack
//      does 140 more damage, and discard all Energy from this Pokémon."
//   sv09-017     Floragato                    idx 0 "Magical Leaf"   "30+"
//     "Flip a coin. If heads, this attack does 30 more damage, and heal 30
//      damage from this Pokémon."
//
// **SIX legal printings on TWO sentences — and ONE CARD IN FIVE RARITIES is five
// of the six**, which is why the sentence count and the printing count are so far
// apart and why the arm is keyed on neither.
//
// ⚠️ **THE OTHER EIGHT ROWS ARE `legal_standard = 0` AND THEY ARE THE PROOF THAT
// THE REACH IS WIDER THAN THE CENSUS**: Floette `sv01-092` prints Floragato's
// sentence byte-identically (so the coin arm already serves a second card the day
// it rotates in), while Beedrill `sv03.5-015`, Tapu Koko ex `sv04-068`/`-222`/
// `-247` and Conkeldurr V `swsh10.5-040`/`-073`/`-074` print four FURTHER
// antecedent/consequent pairs whose consequents this arm's two anchors do NOT
// read ("…is now Paralyzed and Poisoned", "…is now Confused"). Those are a
// widening, priced at zero today and named here so the next slice can find them.
//
// ── 🛑 THE DESIGN CALL, WHICH THE RESUME POINT DELIBERATELY LEFT OPEN ────────
//
// D316's resume point named two honest routes and refused to choose:
//
//   1. **D316's route** — the WHOLE hit inside the gate, one reader, base dropped.
//   2. **The co-firing route** — the bonus stays in the pre-W/R fold (its
//      antecedent is a BOARD fact known at declaration, unlike a confirm) and the
//      consequent rides a plain `conditionGate`. *"Cheaper if it works."*
//
// **ROUTE 1, AND ROUTE 2 IS NOT MERELY UGLIER — IT IS WRONG ON FLORAGATO.** The
// coin decides BOTH halves, and the two sites that could take it sit on opposite
// sides of the pipeline: `deriveAttackCoinFlip`'s `bonusOnHeads` draws in
// `attack.ts` in FRONT of §8.5, and a `coinFlipGate` program draws again at the
// interpreter's tail. One printed coin would become TWO draws, TWO
// `ATTACK_EFFECT_COIN_FLIP` rows and two INDEPENDENT answers — a board on which
// the bonus lands and the heal does not. There is no arrangement of two readers
// that makes one printed coin one flip. §6 drives that one-flip property directly
// rather than asserting it.
//
// Route 2 additionally needs ONE SENTENCE READ BY TWO READERS, which every doc
// block in `effects.ts` denies out loud (*"at most one of the four ever fires on
// a given attack"*) — and that invariant is load-bearing, not decorative: it is
// what makes `attack.ts`'s simulated-flags SUMS rather than choices.
//
// ⚠️ **AND THE TWO SENTENCES WERE PRICED SEPARATELY BEFORE BEING CALLED ONE ROW**,
// as the resume point ordered. They come apart under route 2 (a coin is not a
// board fact) and are identical under route 1 (the decider is the ONLY thing that
// differs — same triple, same gate, same drop). That asymmetry is itself an
// argument for route 1: a design under which two printings of one printed shape
// need two mechanisms is a design that has not found the shape.
//
// ── WHAT THE ROW COSTS ──────────────────────────────────────────────────────
//
// ONE new reader (`deriveAttackBonusConsequent`, the NINTH) and ONE exported
// assembler (`bonusConsequentProgram`). **NO new op, no new FIELD, no prompt
// kind, choice kind, event, error code, `GameState` field, `CardFilter` member or
// registry row** — every op it emits already ships. `packages/schema` takes ZERO
// and `MATCH_RECORD_VERSION` stays 18, on easier terms than D316's: there is
// nothing new for a v18 deploy to fail to author.

/** The two printed sentences, transcribed off the D1 rows (D306: transcribe,
    never interpolate). */
const OGERPON_TEXT =
  "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 140 more damage, and discard all Energy from this Pokémon.";
const FLORAGATO_TEXT =
  "Flip a coin. If heads, this attack does 30 more damage, and heal 30 damage from this Pokémon.";

/** Ogerpon's OTHER printed attack — the index-precision control, and a sentence
    `deriveAttackDamageMultiplier` has read since D167. */
const WRATHFUL_TEXT = "This attack does 20 damage for each damage counter on this Pokémon.";

/** The two BARE sentences the family's antecedents already resolve, kept as the
    pair that says this reader widened nothing: both are real printed catalog
    sentences read by OTHER readers, and both must stay theirs. */
const BARE_OGERPON_TEXT =
  "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 50 more damage.";
const BARE_FLORAGATO_TEXT = "Flip a coin. If heads, this attack does 30 more damage.";

const OGERPON = "sv06-040";
const FLORAGATO = "sv09-017";
/** The five Ogerpon ex rarities and Floragato — the whole legal population. */
const ALL_SIX = [OGERPON, "sv06-192", "sv06-212", "sv08.5-017", "sv08.5-148", FLORAGATO] as const;

const EVOLVED = "fix-d317-evolved";
const BASIC = "fix-d317-basic";
const RESIST = "fix-d317-resist";
const WEAK = "fix-d317-weak";
const FILLER = "fix-d317-filler";
const FIRE = "fix-d317-fire";
const GRASS = "fix-d317-grass";
/** The ATTRIBUTION CONTROL's card — the SAME antecedent with a consequent no
    anchor reads, so the sentence must stay on the loud path. */
const UNREAD = "fix-d317-unread";
const UNREAD_TEXT =
  "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 60 more damage, and hum a little tune.";

/** The LOCAL pool (D275's idiom) — the two real ids live HERE and not in
    `FIXTURE_POOL`, so no manifest row is owed (neither `sv06` nor `sv09` is one
    of the manifest's six sets).

    ⚠️ **BUT THE BLIND SPOT THAT IDIOM BUYS IS PAID FOR THIS TIME**, which is the
    one place this suite departs from D316's. A shape driven only off a local pool
    is invisible to `programWalk.test.ts`'s FIXTURE_POOL sweep, and this slice's
    whole structural claim is about a branch arm that sweep reports on. So
    `fix-bonusconsequent` — Floragato's sentence on a `fix-*` id — lives in
    `FIXTURE_POOL` as the demonstrator, and §7 below ties the two together. */
const LOCAL_CARDS: Record<string, Card> = {
  [OGERPON]: battler(OGERPON, {
    name: "Hearthflame Mask Ogerpon ex",
    hp: 210,
    stage: "Basic",
    retreat: 1,
    types: ["Fire"],
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      {
        cost: ["Fire", "Colorless", "Colorless"],
        name: "Wrathful Hearth",
        effect: WRATHFUL_TEXT,
        damage: "20×",
      },
      {
        cost: ["Fire", "Fire", "Fire"],
        name: "Dynamic Blaze",
        effect: OGERPON_TEXT,
        damage: "140+",
      },
    ],
  }),
  [FLORAGATO]: battler(FLORAGATO, {
    name: "Floragato",
    hp: 90,
    stage: "Stage1",
    evolveFrom: "Sprigatito",
    retreat: 1,
    types: ["Grass"],
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Magical Leaf",
        effect: FLORAGATO_TEXT,
        damage: "30+",
      },
    ],
  }),
  [UNREAD]: battler(UNREAD, {
    types: ["Fire"],
    hp: 200,
    attacks: [
      { cost: ["Fire"], name: "Unread Blaze", effect: UNREAD_TEXT, damage: "10+" },
    ],
  }),
  /** 🛑 THE POSITIVE SIDE OF THE GATE, AND IT IS WHY THIS SUITE CAN CLAIM THE ARM
      IS NOT DEAD. `opponentActiveIsEvolution` reads `evolveFrom` (D105), so a
      defender that is a Stage 1 makes the condition TRUE — and `fix-d317-basic`
      one entry down makes it FALSE with everything else held equal. A gate driven
      on only one of the two is exactly D310's "green and dead" hazard. */
  [EVOLVED]: battler(EVOLVED, {
    types: ["Colorless"],
    hp: 340,
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
  }),
  [BASIC]: battler(BASIC, { types: ["Colorless"], hp: 340 }),
  /** THE DISCRIMINATOR BOARD (D316's, inherited whole): a −30 Resistance is a
      SUBTRACTION, so it is paid once per hit and tells one §8.5 pass from two. */
  [RESIST]: battler(RESIST, {
    types: ["Colorless"],
    hp: 340,
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
    resistances: [{ type: "Fire", value: "-30" }],
  }),
  /** THE CONTROL THAT PROVES NOTHING, kept and LABELLED: ×2 DISTRIBUTES over a
      split hit, so this board is green under both readings. */
  [WEAK]: battler(WEAK, {
    types: ["Colorless"],
    hp: 340,
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
    weaknesses: [{ type: "Fire", value: "×2" }],
  }),
  [FILLER]: battler(FILLER, { types: ["Colorless"], hp: 60 }),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [GRASS]: typedEnergy(GRASS, "Grass"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [OGERPON]: 4,
  [FLORAGATO]: 4,
  [UNREAD]: 4,
  [EVOLVED]: 4,
  [BASIC]: 4,
  [RESIST]: 4,
  [WEAK]: 4,
  [FILLER]: 4,
  [FIRE]: 14,
  [GRASS]: 14,
});

/** Two seeds for the deterministic boards, eight for the coin sweep — nothing
    below rests on one shuffle (D270), and §6 needs enough draws to see both
    faces. */
const SEEDS = [4021, 4099] as const;
const COIN_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

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

/** TEST SURGERY — `count` Energy of one printed type onto p1's Active. */
function fuel(state: GameState, energyId: string, count: number): GameState {
  const side = state.players.p1;
  const body = side.active;
  if (body === null) throw new Error("p1 has no Active");
  const energy = side.deck.filter((u) => state.cardIdByUid[u] === energyId).slice(0, count);
  if (energy.length < count) throw new Error(`deck lacks ${count} × ${energyId}`);
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        active: { ...body, energy: [...body.energy, ...energy] },
        deck: side.deck.filter((u) => !energy.includes(u)),
      },
    },
  };
}

/** A board on p1's turn: `attacker` Active with `energy × count` on it, filler
    bodies behind it, and `defender` standing opposite. */
function board(opts: {
  attacker: string;
  energy: string;
  count: number;
  defender?: string;
  seed?: number;
}): GameState {
  let state = localSetup(opts.seed ?? SEEDS[0], "p2");
  state = setActiveFromDeck(state, "p2", opts.defender ?? EVOLVED);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", FILLER);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", opts.attacker);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", FILLER);
  state = benchFromDeck(state, "p1", FILLER);
  return fuel(state, opts.energy, opts.count);
}

const BLAZE = { type: "attack", seat: "p1", index: 1 } as const;
const LEAF = { type: "attack", seat: "p1", index: 0 } as const;

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
  // 🆕🆕 D419 — the readers this COMPLEMENT never named (D381, D403, D417), written
  // in NAME order rather than in landing order because the guard in §2 diffs a
  // SORTED list against the module surface.
  // ⚠️ SPLICED MID-LIST RATHER THAN APPENDED: mutant `find` strings in
  // `scripts/mutation/mutants.ts` quote an array's LAST entries plus its closing
  // `];`, and appending moves that anchor without a character of it changing —
  // the adjacency class D418 paid for once on `stadiumPresence.test.ts`.
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
  // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
  // array's LAST entries plus its closing bracket, and appending moves that anchor
  // without a character of it changing.
  deriveAttackPreDamage,
  deriveAttackOptionalBoost,
];

// ────────────────────────────────────────────────────────────────────────────
describe("D317 §1 — the print, and the reading each of the two sentences gets", () => {
  it("the fixtures carry the printed sentences VERBATIM, with their '+' markers", () => {
    expect(POOL[OGERPON]?.attacks?.[1]?.effect).toBe(OGERPON_TEXT);
    expect(POOL[OGERPON]?.attacks?.[1]?.damage).toBe("140+");
    expect(POOL[OGERPON]?.attacks?.[0]?.effect).toBe(WRATHFUL_TEXT);
    expect(POOL[FLORAGATO]?.attacks?.[0]?.effect).toBe(FLORAGATO_TEXT);
    expect(POOL[FLORAGATO]?.attacks?.[0]?.damage).toBe("30+");
  });

  it("🛑 each sentence reads into its DECIDER, its bonus and the ops the yes arm buys", () => {
    expect(deriveAttackBonusConsequent(OGERPON_TEXT)).toEqual({
      decider: { kind: "boardCondition", cond: { kind: "opponentActiveIsEvolution" } },
      bonus: 140,
      ops: [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" }],
    });
    expect(deriveAttackBonusConsequent(FLORAGATO_TEXT)).toEqual({
      decider: { kind: "coinFlip" },
      bonus: 30,
      ops: [{ op: "heal", target: "self", amount: 30 }],
    });
  });

  it("⚠️ the ops are BYTE-IDENTICAL to the ones the BARE consequents derive", () => {
    // The whole claim of the slice: both consequents were already built, so this
    // reader authors no behaviour at all — it decides a NUMBER and who decides it.
    // Each pair is the gated reading beside the bare anchor's own output.
    expect(deriveAttackBonusConsequent(OGERPON_TEXT)?.ops).toEqual(
      deriveAttackEffect("Discard all Energy from this Pokémon."),
    );
    expect(deriveAttackBonusConsequent(FLORAGATO_TEXT)?.ops).toEqual(
      deriveAttackEffect("Heal 30 damage from this Pokémon."),
    );
  });

  it("⚠️ the DECIDER is byte-identical to the one the BARE antecedent derives", () => {
    // The other half of the same claim, and it is the half that says the clause
    // table is SHARED rather than copied: a clause meaning "does N more damage if
    // X" must mean the same thing here as it does one reader over. The bare
    // sentence is a REAL printed catalog sentence (Seviper `sv02-137` at +50), so
    // this is a statement about two readers agreeing on the catalog and not about
    // two constants agreeing in this file.
    const bare = deriveAttackDamageBonus(BARE_OGERPON_TEXT)?.count;
    if (bare?.kind !== "boardCondition") throw new Error("expected a boardCondition count");
    expect(deriveAttackBonusConsequent(OGERPON_TEXT)?.decider).toEqual({
      kind: "boardCondition",
      cond: bare.cond,
    });
  });

  it("🛑 the ASSEMBLER puts the whole hit inside the gate, on BOTH arms", () => {
    // The base is the argument, so this is the one place the two halves meet.
    expect(bonusConsequentProgram(deriveAttackBonusConsequent(OGERPON_TEXT) as never, 140)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsEvolution" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          { op: "damageDefender", amount: 280 },
          { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
        ],
        otherwise: [{ op: "damageDefender", amount: 140 }],
      },
    ]);
    expect(bonusConsequentProgram(deriveAttackBonusConsequent(FLORAGATO_TEXT) as never, 30)).toEqual(
      [
        {
          op: "coinFlipGate",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [
            { op: "damageDefender", amount: 60 },
            { op: "heal", target: "self", amount: 30 },
          ],
          otherwise: [{ op: "damageDefender", amount: 30 }],
        },
      ],
    );
  });

  it("🛑 THE DECLINE ARM IS THE PRINTED BASE, NEVER AN ABSENT BRANCH", () => {
    // ⚠️ THE ONE MISTAKE THIS SHAPE INVITES. An absent `otherwise` splices nothing
    // — and with the base suppressed by `scaledBase`, "nothing" would mean an
    // Ogerpon that deals ZERO into a Basic Active and a Floragato that deals ZERO
    // on tails. Both printings hit on the losing side; the field is what says so.
    for (const [text, base] of [
      [OGERPON_TEXT, 140],
      [FLORAGATO_TEXT, 30],
    ] as const) {
      const gate = bonusConsequentProgram(deriveAttackBonusConsequent(text) as never, base)[0];
      expect(gate, text).toMatchObject({ otherwise: [{ op: "damageDefender", amount: base }] });
    }
  });

  it("🛑 NO registry ATTACK row is authored for any of the SIX printings — an ARM serves them all", () => {
    // An arm transfers across sets and a row does not: ONE reader serves both
    // sentences, all five Ogerpon rarities and every future reprint. ⚠️ ASKED OF
    // THE `attack` HALF SPECIFICALLY (D316's lesson — a card a slice touches is
    // the most likely card to already be half-authored), though here neither id
    // carries a row at all.
    for (const id of ALL_SIX) {
      expect(programFor(id)?.attack, id).toBeUndefined();
      expect(programFor(id), id).toBeUndefined();
    }
  });

  it("⚠️ INDEX PRECISION — Ogerpon's other attack is read by a DIFFERENT reader", () => {
    // The sentence at index 0 is `deriveAttackDamageMultiplier`'s since D167 and
    // must not inherit anything from index 1's reading, in either direction.
    expect(deriveAttackBonusConsequent(WRATHFUL_TEXT)).toBeNull();
    expect(deriveAttackDamageMultiplier(WRATHFUL_TEXT)).not.toBeNull();
    expect(deriveAttackDamageMultiplier(OGERPON_TEXT)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D317 §2 — the REFUSALS, which are what keep an unread sentence loud", () => {
  it("🆕🆕 D419 — OTHER_READERS plus the reader under test IS the module's surface", () => {
    // 🛑 THE GUARD THIS COMPLEMENT NEVER HAD, AND A COMPLEMENT IS WHERE A STALE LIST
    // DOES ITS WORST WORK. The rung below asserts that all the OTHER readers refuse
    // both of this slice's sentences — a claim whose entire force is the word ALL. A list that has fallen
    // behind `effects.ts` does not make that claim FALSE, it makes it NARROWER, and
    // narrower is invisible: the missing reader is simply never asked and the rung
    // stays green. This list ran short of the module until this slice, so the
    // refusal below was quantified over a strict subset of the surface.
    expect([...OTHER_READERS.map((read) => read.name), "deriveAttackBonusConsequent"].sort()).toEqual(
      attackReaderSurface(),
    );
    // ⚠️ THE COUNT IS PINNED SEPARATELY FROM THE DIFF ABOVE, and the separation is
    // load-bearing: a diff alone stays GREEN when a slice deletes a reader from the
    // module and from this list in the SAME commit, and the refusals would quietly
    // narrow again with nothing naming the cause.
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 all ELEVEN other readers refuse BOTH sentences", () => {
    for (const text of [OGERPON_TEXT, FLORAGATO_TEXT]) {
      // 🆕🆕 D419 — THE POSITIVE HALF, TAKEN OFF THE MODULE. "Exactly one reader
      // claims this" is two facts and the loop only ever carried the second;
      // `resolvedByAnyReader` walks whatever `effects.ts` exports today.
      expect(resolvedByAnyReader(text), text).toBe(true);
      for (const read of OTHER_READERS) expect(read(text), text).toBeNull();
      expect(deriveAttackBonusConsequent(text), text).not.toBeNull();
    }
  });

  it("🛑 and the BARE sentences stay with the readers that already owned them", () => {
    // The disjointness claim from the other side, and the reason this slice
    // loosened nothing: the two antecedents are live printed sentences with live
    // readers, and this arm must not have taken either.
    expect(deriveAttackBonusConsequent(BARE_OGERPON_TEXT)).toBeNull();
    expect(deriveAttackDamageBonus(BARE_OGERPON_TEXT)).toEqual({
      per: 50,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveIsEvolution" } },
    });
    expect(deriveAttackBonusConsequent(BARE_FLORAGATO_TEXT)).toBeNull();
    expect(deriveAttackCoinFlip(BARE_FLORAGATO_TEXT)).toEqual({
      kind: "bonusOnHeads",
      flips: { kind: "printed", count: 1 },
      per: 30,
    });
  });

  it("the ATTRIBUTION CONTROL — a sentence this reader must NOT claim", () => {
    // D214's rule: without it, "every sentence resolves" would pass just as
    // happily on a broken import.
    expect(deriveAttackBonusConsequent("Draw a card.")).toBeNull();
    expect(deriveAttackEffect("Draw a card.")).not.toBeNull();
  });

  it("🛑 an UNRECOGNISED consequent refuses the WHOLE sentence — never a prefix match", () => {
    // The family's safety property. A reader that swallowed the damage clause and
    // dropped the consequent would ship an Ogerpon whose printed cost silently
    // vanished, which is strictly worse than not reading the card at all.
    for (const tail of [
      "discard 2 Energy from this Pokémon.",
      "discard all Energy from your opponent's Active Pokémon.",
      "heal all damage from this Pokémon.",
      "your opponent's Active Pokémon is now Paralyzed and Poisoned.",
      "your opponent's Active Pokémon is now Confused.",
    ]) {
      expect(
        deriveAttackBonusConsequent(
          `If your opponent's Active Pokémon is Poisoned, this attack does 60 more damage, and ${tail}`,
        ),
        tail,
      ).toBeNull();
      expect(
        deriveAttackBonusConsequent(
          `Flip a coin. If heads, this attack does 60 more damage, and ${tail}`,
        ),
        tail,
      ).toBeNull();
    }
  });

  it("🛑 an UNMAPPED antecedent clause refuses too, and stays LOUD", () => {
    // `CONDITIONAL_DAMAGE_BONUS`'s own rule inherited: an unrecognised condition
    // must never silently score its bonus at 0.
    expect(
      deriveAttackBonusConsequent(
        "If your opponent's Active Pokémon is a Dragon, this attack does 60 more damage, and discard all Energy from this Pokémon.",
      ),
    ).toBeNull();
  });

  it("⚠️ the consequent's verb is LOWERCASE, and a CAPITAL one is refused", () => {
    // D246's rule: the case is spelled at the anchor, never folded into a
    // `[Dd]`/`[Hh]` class — the capital is exactly what keeps a whole-sentence
    // reader off a mid-sentence clause, and a class here would give that up in
    // both directions at once.
    expect(
      deriveAttackBonusConsequent(
        "Flip a coin. If heads, this attack does 30 more damage, and Heal 30 damage from this Pokémon.",
      ),
    ).toBeNull();
    expect(
      deriveAttackBonusConsequent(OGERPON_TEXT.replace(", and discard", ", and Discard")),
    ).toBeNull();
  });

  it("⚠️ the CURLY apostrophe resolves EQUALLY — the class is at the shared clause fold (D136/D137)", () => {
    // The apostrophe is in the ANTECEDENT, and this reader owns no copy of that
    // vocabulary: it goes through `boardConditionForClause`'s `literalClauseRow`
    // fold. So the property is inherited rather than re-implemented, and this rung
    // is what says the inheritance is real.
    const curly = OGERPON_TEXT.replace("opponent's", "opponent’s");
    expect(curly).not.toBe(OGERPON_TEXT);
    expect(deriveAttackBonusConsequent(curly)).toEqual(deriveAttackBonusConsequent(OGERPON_TEXT));
  });

  it("a printed ZERO on either number is refused, on both slots and both deciders", () => {
    // A printed 0 is not a real card and would derive to a silent no-op — the
    // guard every captured amount in this family carries.
    expect(deriveAttackBonusConsequent(OGERPON_TEXT.replace("140 more", "0 more"))).toBeNull();
    expect(deriveAttackBonusConsequent(FLORAGATO_TEXT.replace("30 more", "0 more"))).toBeNull();
    expect(deriveAttackBonusConsequent(FLORAGATO_TEXT.replace("heal 30", "heal 0"))).toBeNull();
  });

  it("the anchor is WHOLE-STRING — leading or trailing text is refused", () => {
    expect(deriveAttackBonusConsequent(`Draw a card. ${OGERPON_TEXT}`)).toBeNull();
    expect(deriveAttackBonusConsequent(`${OGERPON_TEXT} Draw a card.`)).toBeNull();
    expect(deriveAttackBonusConsequent(`${FLORAGATO_TEXT} Draw a card.`)).toBeNull();
  });

  it("🛑 THE ANCHOR ORDER IS LOAD-BEARING — the coin form is tried FIRST", () => {
    // ⚠️ THE ONE ORDERING HAZARD IN THE READER. `BONUS_CONSEQUENT_CONDITION`'s
    // `^If (.+)` cannot match a string starting "Flip a coin." — but the reader
    // does not rely on that alone, and this rung is what keeps the reliance
    // visible: a future maintainer relaxing the condition anchor's `^` would hand
    // "heads" to `boardConditionForClause`, which returns null, and Floragato
    // would silently STOP RESOLVING rather than resolve wrongly. A silent loss is
    // the failure this order prevents, so it is asserted rather than commented.
    expect(deriveAttackBonusConsequent(FLORAGATO_TEXT)?.decider).toEqual({ kind: "coinFlip" });
    expect(deriveAttackBonusConsequent(OGERPON_TEXT)?.decider.kind).toBe("boardCondition");
  });

  it("⚠️ the REACH is wider than the census, and it is the arm's own parameterisation", () => {
    // An arm transfers across sets. The catalog prints two of these sentences at
    // `legal_standard = 1` today; the anchors read any bonus, any heal amount and
    // any clause the shared table maps — which is what a reprint at a different
    // number costs (nothing). Floette `sv01-092` is the live proof: it prints
    // Floragato's sentence byte-identically at `legal_standard = 0`.
    expect(
      deriveAttackBonusConsequent(
        "Flip a coin. If heads, this attack does 90 more damage, and heal 70 damage from this Pokémon.",
      ),
    ).toEqual({
      decider: { kind: "coinFlip" },
      bonus: 90,
      ops: [{ op: "heal", target: "self", amount: 70 }],
    });
    expect(
      deriveAttackBonusConsequent(
        "If you have a Stadium in play, this attack does 20 more damage, and discard all Energy from this Pokémon.",
      ),
    ).toEqual({
      decider: { kind: "boardCondition", cond: { kind: "yourStadiumInPlay" } },
      bonus: 20,
      ops: [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" }],
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D317 §3 — OGERPON: the board condition, and BOTH arms on a real board", () => {
  for (const seed of SEEDS) {
    it(`🛑 an EVOLUTION Active takes 280 in ONE hit, and the Energy goes (seed ${seed})`, () => {
      const { state: done, events } = apply(
        board({ attacker: OGERPON, energy: FIRE, count: 3, defender: EVOLVED, seed }),
        BLAZE,
      );
      // ONE hit, at base + bonus. Two hits would be two rows.
      expect(count(events, "DAMAGE_DEALT")).toBe(1);
      expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 280 });
      expect(done.players.p2.active?.damage).toBe(280);
      // …and the printed consequent ran: every Energy left the attacker.
      expect(done.players.p1.active?.energy).toEqual([]);
    });

    it(`🛑 a BASIC Active takes the printed 140 and the Energy STAYS (seed ${seed})`, () => {
      // ⚠️ THE ARM THAT PROVES THE GATE IS NOT DEAD, and the reason the two
      // defenders differ by ONE field. Without this board the suite would be green
      // under a build that ignored the condition entirely.
      const { state: done, events } = apply(
        board({ attacker: OGERPON, energy: FIRE, count: 3, defender: BASIC, seed }),
        BLAZE,
      );
      expect(count(events, "DAMAGE_DEALT")).toBe(1);
      expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 140 });
      expect(done.players.p2.active?.damage).toBe(140);
      expect(done.players.p1.active?.energy).toHaveLength(3);
    });
  }

  it("⚠️ the two boards differ in ONE printed field, and the answers differ", () => {
    // The intersection is proved NON-EMPTY on a real board rather than argued
    // from the type (D310/D314). `fix-d317-evolved` and `fix-d317-basic` are the
    // same 340 HP Colorless body; only `evolveFrom` separates them.
    expect(POOL[EVOLVED]?.hp).toBe(POOL[BASIC]?.hp);
    expect(POOL[EVOLVED]?.evolveFrom).toBe("fix-basic-1");
    // ⚠️ `null`, NOT `undefined` — `battler`'s blank spreads an explicit null, and
    // `toBeUndefined()` here went red on the first run. Worth the two words: the
    // whole gate reads THIS field, so what it holds when absent is exactly the
    // thing a reader of this rung needs to know.
    expect(POOL[BASIC]?.evolveFrom).toBeNull();
  });

  it("the attack still ends the turn on the DECLINE arm — nothing here is a cancellation", () => {
    const { state: done } = apply(
      board({ attacker: OGERPON, energy: FIRE, count: 3, defender: BASIC }),
      BLAZE,
    );
    expect(done.phase).toMatchObject({ seat: "p2" });
    expect(count([], "ATTACK_FAILED")).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D317 §4 — the LOUD path closed: the sentence and its '+' are both simulated", () => {
  it("🛑 no ATTACK_EFFECT_SKIPPED on either card, on EITHER arm", () => {
    // Two terms, and BOTH were needed: without `effectSimulated` the sentence is
    // flagged, without `modifierSimulated` the printed "+" is — and both printed
    // sentences carry one ("140+", "30+").
    const runs = [
      [board({ attacker: OGERPON, energy: FIRE, count: 3, defender: EVOLVED }), BLAZE],
      [board({ attacker: OGERPON, energy: FIRE, count: 3, defender: BASIC }), BLAZE],
      [board({ attacker: FLORAGATO, energy: GRASS, count: 2 }), LEAF],
    ] as const;
    for (const [state, action] of runs) {
      const { events } = apply(state, action);
      expect(count(events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    }
  });

  it("🛑 the ATTRIBUTION CONTROL — the SAME antecedent with an unread consequent IS flagged", () => {
    // Without this the assertion above would pass on a board where nothing is
    // ever flagged (D214's vacuous shape) — and the control shares the ANTECEDENT
    // deliberately, so what it isolates is the consequent DISPATCH and not the
    // anchor.
    expect(deriveAttackBonusConsequent(UNREAD_TEXT)).toBeNull();
    const { events } = apply(
      board({ attacker: UNREAD, energy: FIRE, count: 1, defender: EVOLVED }),
      { type: "attack", seat: "p1", index: 0 },
    );
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toMatchObject({
      effect: UNREAD_TEXT,
      damageModifier: "+",
    });
    // …and the printed base landed the ordinary way, because nothing claimed it.
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 10 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D317 §5 — 🛑 §8.5 APPLIED ONCE, ON A BOARD WHERE TWO HITS WOULD DIFFER", () => {
  it("🛑 a −30 RESISTANCE is paid ONCE: 280 − 30 = 250, not (140−30) + (140−30)", () => {
    // THE DISCRIMINATOR, and the reason the WHOLE hit moves inside the gate rather
    // than the bonus alone. Two damage ops would each re-enter §8.5 and each
    // subtract the printed 30, landing on 220. One op lands on 250.
    const { state: done, events } = apply(
      board({ attacker: OGERPON, energy: FIRE, count: 3, defender: RESIST }),
      BLAZE,
    );
    expect(count(events, "DAMAGE_DEALT")).toBe(1);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      dealt: 250,
      resistance: { op: "subtract", amount: 30 },
    });
    expect(done.players.p2.active?.damage).toBe(250);
    expect(done.players.p2.active?.damage).not.toBe(220);
  });

  it("⚠️ the WEAKNESS CONTROL cannot tell the two readings apart, and that is why it is a control", () => {
    // ×2 DISTRIBUTES over the split (2×140 + 2×140 = 2×280), so a Weakness board
    // is green under BOTH readings. Kept — and LABELLED — because a suite that
    // only ever drove this board would have proved nothing about the split at all
    // (D310's "green and dead" hazard wearing arithmetic).
    const { state: done, events } = apply(
      board({ attacker: OGERPON, energy: FIRE, count: 3, defender: WEAK }),
      BLAZE,
    );
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      dealt: 560,
      weakness: { op: "multiply", amount: 2 },
    });
    // 560 into 340 HP is lethal, so the body is gone rather than damaged — which
    // is itself the ONE-hit statement in a third currency: a split reading would
    // have asked the §8.1 survival clamp TWICE on the way here.
    expect(count(events, "KNOCKED_OUT")).toBe(1);
    expect(done.players.p2.active).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D317 §6 — FLORAGATO: ONE coin decides BOTH halves", () => {
  /** Drive Magical Leaf on `seed` and report the face, the damage and the heal. */
  function leaf(seed: number) {
    let state = board({ attacker: FLORAGATO, energy: GRASS, count: 2, seed });
    // Start damaged, so the heal has something to move: a heal on a full-HP body
    // is a silent no-op and could not tell the two faces apart.
    const body = state.players.p1.active;
    if (body === null) throw new Error("no Active");
    state = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: { ...body, damage: 50 } } },
    };
    const { state: done, events } = apply(state, LEAF);
    return {
      done,
      events,
      face: find(events, "ATTACK_EFFECT_COIN_FLIP")?.result,
      flips: count(events, "ATTACK_EFFECT_COIN_FLIP"),
      dealt: find(events, "DAMAGE_DEALT")?.dealt,
      selfDamage: done.players.p1.active?.damage,
    };
  }

  it("🛑 EXACTLY ONE COIN IS FLIPPED, on every seed — the whole reason route 1 was taken", () => {
    // ⚠️ THIS IS THE SLICE'S SHARPEST RUNG. Under the co-firing route the bonus
    // would be taken by `deriveAttackCoinFlip` in front of §8.5 and the heal by a
    // `coinFlipGate` at the tail: TWO rows, and two independent answers. One row
    // per declaration is what says the printed coin is one coin.
    for (const seed of COIN_SEEDS) {
      expect(leaf(seed).flips, `seed ${seed}`).toBe(1);
    }
  });

  it("🛑 the SAME face decides the damage and the heal — they can never disagree", () => {
    for (const seed of COIN_SEEDS) {
      const run = leaf(seed);
      if (run.face === "heads") {
        expect(run.dealt, `seed ${seed} heads`).toBe(60);
        expect(run.selfDamage, `seed ${seed} heads`).toBe(20); // 50 − 30
      } else {
        expect(run.dealt, `seed ${seed} tails`).toBe(30);
        expect(run.selfDamage, `seed ${seed} tails`).toBe(50); // untouched
      }
      // ONE hit either way — the decline arm hits too.
      expect(count(run.events, "DAMAGE_DEALT"), `seed ${seed}`).toBe(1);
    }
  });

  it("⚠️ BOTH FACES ARE ACTUALLY REACHED across the eight seeds", () => {
    // The sweep is only evidence if it saw both — otherwise the branch assertions
    // above are vacuous on one arm, which is the shape D310 was written about.
    const faces = new Set(COIN_SEEDS.map((seed) => leaf(seed).face));
    expect(faces).toEqual(new Set(["heads", "tails"]));
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D317 §7 — 🛑 `coinFlipGate.otherwise`'s FIRST PRODUCER, structurally", () => {
  it("the gate the reader assembles CARRIES an `otherwise`, and a walk finds it", () => {
    // D269 added the field, D270–D316 each carried it forward, and
    // `programWalk.test.ts`'s carrier pin read `["coinFlipGate", ["then"]]` for
    // forty-eight slices with a comment saying the gap was "real in the TYPE and
    // vacuous in the POOL". This is the printing that makes it non-vacuous.
    const program = bonusConsequentProgram(
      deriveAttackBonusConsequent(FLORAGATO_TEXT) as never,
      30,
    );
    expect([...programBranchCarriers(program).entries()].map(([op, keys]) => [op, [...keys].sort()]))
      .toEqual([["coinFlipGate", ["otherwise", "then"]]]);
    // …and the structural walk descends BOTH arms, so the decline arm's hit is a
    // reachable op rather than one only the interpreter ever sees.
    expect(walkProgram(program).map((op) => op.op)).toEqual([
      "coinFlipGate",
      "damageDefender",
      "heal",
      "damageDefender",
    ]);
  });

  it("⚠️ and the DEMONSTRATOR in FIXTURE_POOL prints the sentence, so the shared sweeps see it", () => {
    // D275's local-`cardPool` idiom buys a blind spot: a shape driven only off a
    // local pool is invisible to every FIXTURE_POOL sweep. `fix-bonusconsequent`
    // is what pays for it, and this rung ties the demonstrator to the sentence so
    // a future edit to either goes red by name.
    const demo = FIXTURE_POOL["fix-bonusconsequent"];
    expect(demo?.attacks?.[1]?.effect).toBe(FLORAGATO_TEXT);
    expect(demo?.attacks?.[1]?.damage).toBe("30+");
    expect(deriveAttackBonusConsequent(demo?.attacks?.[1]?.effect ?? "")).not.toBeNull();
    // Its index-0 attack is the plain control: one body, one read attack and one
    // unread one.
    expect(deriveAttackBonusConsequent(demo?.attacks?.[0]?.effect ?? "")).toBeNull();
  });

  it("🛑 the ASSEMBLER IS EXPORTED, which is the only reason any of this is visible", () => {
    // The structural point, asserted rather than left in a comment: the gate needs
    // the attack's PRINTED BASE, which lives on the card. A sweep can only build
    // it because `bonusConsequentProgram` is importable — D316's `optional` is
    // assembled inline in `attack.ts` and therefore cannot be, which is why that
    // op's `otherwise` is still invisible to the pool sweep.
    const reading = deriveAttackBonusConsequent(FLORAGATO_TEXT);
    if (reading === null) throw new Error("expected a reading");
    const ops: EffectOp[] = bonusConsequentProgram(reading, 30);
    expect(ops).toHaveLength(1);
    // The base really is a parameter and not a constant folded into the reading.
    expect(bonusConsequentProgram(reading, 999)[0]).toMatchObject({
      otherwise: [{ op: "damageDefender", amount: 999 }],
    });
  });
});
