import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackCopy, deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ─────────────────────────────────────────────────────────────────────────────
// 🆕🆕🆕 D535 — THE PICK-WITH-REPLACEMENT SNIPE.
//
// `censusAttackCorpus.ts` **FILE LINE 81** — *"Choose 1 of your opponent's Pokémon 6
// times. (You can choose the same Pokémon more than once.) For each time you chose a
// Pokémon, do 20 damage to it. This damage isn't affected by Weakness or
// Resistance."* — **1 sentence / 2 legal printings** (`legalAttackCorpus()` index 28,
// leading count column `2`).
//
// ⚠️ **THE CARD IDS ARE UNRESOLVED ON THIS CHECKOUT** — no D1 and no catalog sqlite
// here — so they are stated unresolved rather than invented (D425), and the
// demonstrator below is FILE-LOCAL and DECLARED: `d535-sniper` carries the printed
// bytes and nothing else of any real card.
//
// engine 0.419.0 → 0.420.0. **ZERO NEW VOCABULARY**: no `EffectOp` member, no op
// field, no `EffectPrompt` key, no `GameEvent`, no `GameOverReason`, no
// `CardFilter`/`BoardCondition` member, no `packages/schema` byte and no HUD byte.
// `MATCH_RECORD_VERSION` HELD at **30** on D452's *"this byte already ships"* — the
// six-op literal is the one `CHOSEN_ANY_TARGET` has authored since D400/D448, so the
// serialized alphabet does not grow at all (D237's POPULATION change, `effects.ts:23564`).
//
// THE PROGRAM: SIX `damageChosen{target:"opponentAny", amount:20, count:1,
// source:"attack", deals:true, ignoreWR:true}` ops — never ONE op at `amount * count`.
// `validateChoice`'s `choosePokemonMulti` arm (`cardplay.ts:1419`) refuses a repeated
// ref inside ONE prompt, so six independent single-answer parks are the only shape
// that can deliver the printed *"(You can choose the same Pokémon more than once.)"*.
// ─────────────────────────────────────────────────────────────────────────────

const PRINTED =
  "Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance.";

/** The op literal `CHOSEN_ANY_TARGET` authors, byte for byte, at THIS amount. */
const ONE: EffectOp = {
  op: "damageChosen",
  target: "opponentAny",
  amount: 20,
  count: 1,
  source: "attack",
  deals: true,
  ignoreWR: true,
};
const PROGRAM: EffectOp[] = [ONE, ONE, ONE, ONE, ONE, ONE];

/** The SIBLING's own sentence at the same amount — the byte control for §3. */
const SIBLING_AT_20 =
  "This attack does 20 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance.";
/** …and the REAL corpus row the sibling has claimed since D400 (FILE LINE 620). */
const SIBLING_ROW =
  "This attack does 70 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance.";

const SNIPER = "d535-sniper";
const PSYCHIC_ENERGY = "d535-energy";
const WALL = "d535-wall";
const WEAK = "d535-weak";
const RESIST = "d535-resist";
/** Exactly 120 HP: six hits at 20 kill it on the sixth and not before. */
const TINY = "d535-tiny";
const FILLERS = ["d535-f1", "d535-f2", "d535-f3", "d535-f4"] as const;

const LOCAL_CARDS: Record<string, Card> = {
  [SNIPER]: battler(SNIPER, {
    name: "D535 Sniper",
    hp: 70,
    retreat: 1,
    types: ["Psychic"],
    attacks: [
      { cost: ["Psychic"], name: "Six Shots", effect: PRINTED },
      { cost: ["Psychic", "Colorless"], name: "Tap", damage: 20 },
    ],
  }),
  [PSYCHIC_ENERGY]: typedEnergy(PSYCHIC_ENERGY, "Psychic"),
  [WALL]: battler(WALL, {
    name: "D535 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [WEAK]: battler(WEAK, {
    name: "D535 Weak",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    weaknesses: [{ type: "Psychic", value: "×2" }],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [RESIST]: battler(RESIST, {
    name: "D535 Resist",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    resistances: [{ type: "Psychic", value: "-30" }],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [TINY]: battler(TINY, {
    name: "D535 Tiny",
    hp: 120,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  ...Object.fromEntries(
    FILLERS.map((id, i) => [
      id,
      battler(id, {
        name: `D535 Filler ${String(i + 1)}`,
        hp: 200,
        retreat: 1,
        types: ["Colorless"],
        attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
      }),
    ]),
  ),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** 🆕🆕🆕 **D536 RIDE-ALONG — Bouffalant `sv03-174`, the body that pays the debt D535
    carried forward.** 120 HP, {C} cost, Fighting Weakness (INERT against a Psychic
    attacker, which is the point — the only thing it can discriminate is the
    reduction), and `registry.ts` gives it `passive: { damageReductionAfterWR: 20 }`.
    Already in `FIXTURE_POOL`; nothing new is invented. */
const BOUFFALANT = "sv03-174";

// 4 + 16 + 4 + 4 + 4 + 4 + 4 + 4×5 = 60.
// ⚠️ THE FILLERS DROPPED 6 → 5 TO MAKE ROOM FOR BOUFFALANT'S FOUR, and the
// arithmetic comment is RE-SPELLED rather than left stale (D442).
const DECK = deckOf({
  [SNIPER]: 4,
  [PSYCHIC_ENERGY]: 16,
  [WALL]: 4,
  [WEAK]: 4,
  [RESIST]: 4,
  [TINY]: 4,
  [BOUFFALANT]: 4,
  ...Object.fromEntries(FILLERS.map((id) => [id, 5])),
});

const ATTACK = { type: "attack", seat: "p1", index: 0 } as const;

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string | readonly string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob(
  ["./{censusAttackCorpus,index,effects,cardplay}.ts", "../../../apps/api/src/lobby/match.ts"],
  { query: "?raw", import: "default", eager: true },
);
const raw = (suffix: string): string =>
  Object.entries(RAW).find(([k]) => k.endsWith(suffix))?.[1] ?? "";

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
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

/** TEST SURGERY — one Psychic Energy onto p1's Active, taken off p1's deck. */
function fuel(state: GameState): GameState {
  const side = state.players.p1;
  const body = side.active;
  if (body === null) throw new Error("p1 has no Active");
  const energy = side.deck.find((u) => state.cardIdByUid[u] === PSYCHIC_ENERGY);
  if (energy === undefined) throw new Error("p1's deck lacks an Energy");
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        active: { ...body, energy: [...body.energy, energy] },
        deck: side.deck.filter((u) => u !== energy),
      },
    },
  };
}

/** p1's turn, the demonstrator Active and fuelled; p2's Active is `oppActive`, its
    Bench exactly `bench`. */
function board(seed: number, oppActive: string = WALL, bench: readonly string[] = []): GameState {
  let state = localSetup(seed);
  state = setActiveFromDeck(state, "p2", oppActive);
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", SNIPER);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", FILLERS[0]);
  return fuel(state);
}

function attack(state: GameState): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, ATTACK);
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function parkedPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`not parked: ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "choosePokemonMulti") {
    throw new Error(`wrong prompt: ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

function pick(
  state: GameState,
  which: number,
): { state: GameState; events: readonly GameEvent[] } {
  const prompt = parkedPrompt(state);
  const ref = prompt.candidates[which];
  if (ref === undefined) throw new Error(`no candidate ${String(which)}`);
  const result = applyAction(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [ref as PokemonRef] },
  });
  if (!result.ok) throw new Error(`answer refused: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

/** Walk `n` parks, answering `which[i]` at each; returns the state and every event. */
function walk(
  start: GameState,
  which: readonly number[],
): { state: GameState; events: GameEvent[]; parks: number } {
  let state = start;
  const events: GameEvent[] = [];
  let parks = 0;
  for (const w of which) {
    if (state.phase.kind !== "effect:choose") break;
    parks += 1;
    const step = pick(state, w);
    state = step.state;
    events.push(...step.events);
  }
  return { state, events, parks };
}

// ─────────────────────────────────────────────────────────────────────────────
describe("D535 §1 — the READING: one sentence, six ops, and the anchor takes this row and no other", () => {
  it("🛑 derives EXACTLY the six-op program", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    // SIX ops, every one identical — the fold is the LENGTH and never the amount.
    const ops = deriveAttackEffect(PRINTED) ?? [];
    expect(ops).toHaveLength(6);
    expect(new Set(ops.map((op) => JSON.stringify(op))).size).toBe(1);
    // …and the per-op amount is the PRINTED 20, not 120. The mutant that folds the
    // other way (`amount * count` on one op) reddens both of these.
    expect((ops[0] as { amount: number }).amount).toBe(20);
    expect((ops[0] as { count: number }).count).toBe(1);
  });

  it("🛑 the corpus row is read at raw FILE LINE 81 and its 2 printings come off `legalAttackCorpus()`, never retyped", () => {
    const lines = raw("/censusAttackCorpus.ts").split("\n");
    // The file's own line 81 (1-indexed), quoted rather than transcribed.
    const line = lines[80] ?? "";
    expect(line).toBe(`2 ${PRINTED}`);
    expect(legalAttackCorpus().filter(([, s]) => s === PRINTED)).toEqual([[2, PRINTED]]);
    expect(legalAttackCorpus()).toHaveLength(640);
    // ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE — 1 and 2 — which is the
    // shape a pass that copied one number into the other kind of site gets wrong.
    expect(legalAttackCorpus().filter(([, s]) => s === PRINTED)[0]?.[0]).toBe(2);
  });

  it("🛑 the ANCHOR takes this row and NO other, asked with a predicate LOOSER than the anchor (D425)", () => {
    // The loose predicate: any sentence that OPENS the way this one does. It cannot be
    // the anchor itself, or the rung would be the anchor agreeing with itself.
    const opening = legalAttackCorpus().filter(([, s]) =>
      s.startsWith("Choose 1 of your opponent"),
    );
    expect(opening).toHaveLength(4);
    // ⚠️ MEASURED, NOT ASSUMED: TWO of the four are claimed, and the other one is NOT
    // this anchor's. FILE LINE 79 — the attack LOCK — has its own reader
    // (`preventChosenAttack`), so the rung names WHICH row belongs to WHICH arm rather
    // than counting. The price on record called line 79 a copy-attack; it is not, and
    // this is where that is spelled correctly (D438).
    const claimed = opening.filter(([, s]) => deriveAttackEffect(s) !== null);
    expect(claimed.map(([, s]) => s).sort()).toEqual(
      [
        "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack.",
        PRINTED,
      ].sort(),
    );
    expect(
      deriveAttackEffect(
        "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack.",
      ),
    ).toEqual([{ op: "preventChosenAttack" }]);
    // ⚠️ **AND A SIX-OP PROGRAM IS *NOT* A UNIQUE DESCRIPTION OF THIS ROW — MEASURED,
    // NOT ASSUMED.** `COUNTER_SPREAD_ON_OPPONENT` prints a SIX-counter spread
    // (*"Put 6 damage counters on your opponent's Benched Pokémon in any way you
    // like."*), which unrolls to six `damageChosen` ops too. What separates them is
    // `deals` — attack damage against a placed counter, `effects.ts:5438`'s split —
    // and that is the conjunct `counterSpread.test.ts`'s census rung gained this slice.
    expect(
      legalAttackCorpus()
        .filter(([, s]) => (deriveAttackEffect(s) ?? []).length === 6)
        .map(([, s]) => s)
        .sort(),
    ).toEqual(
      ["Put 6 damage counters on your opponent's Benched Pokémon in any way you like.", PRINTED].sort(),
    );
    expect(
      legalAttackCorpus()
        .filter(([, s]) => {
          const ops = deriveAttackEffect(s) ?? [];
          return ops.length === 6 && ops.every((op) => (op as { deals?: true }).deals === true);
        })
        .map(([, s]) => s),
    ).toEqual([PRINTED]);
    // …and a SECOND, looser still: every row carrying the printed repetition clause.
    const family = legalAttackCorpus().filter(([, s]) => /Pokémon \d+ times\./.test(s));
    expect(family).toEqual([[2, PRINTED]]);
    expect(legalAttackCorpus().filter(([, s]) => /For each time you chose/.test(s))).toEqual([
      [2, PRINTED],
    ]);
    // 🛑 THE BARE `"This damage"` TAIL (as against `"This attack's damage"`) IS UNIQUE
    // TO THIS ROW over all 640, which is why the tail cannot be loosened.
    expect(
      legalAttackCorpus().filter(([, s]) =>
        /(^|\. )This damage isn['’]t affected by Weakness or Resistance/.test(s),
      ),
    ).toEqual([[2, PRINTED]]);
  });

  it("🛑 `resolvedByAnyReader` was FALSE before this slice and is TRUE after — the reader surface is the thing that moved", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    // The control: the two COPY-ATTACK neighbours on the same opening are still unread
    // (that family is BLOCKED), while the attack LOCK on FILE LINE 79 was already read
    // before this slice — so the step this rung records is exactly one row.
    // 🆕🆕🆕 D573 — INVERTED (D516), and *"still unread (that family is BLOCKED)"* is WITHDRAWN
    // (D539): D573 BUILT both neighbours on their OWN reader, `deriveAttackCopy` (the
    // declaration-time substitution). The rung's claim is unchanged — THIS slice's step was one
    // row — and is now made by naming the reader that owns them rather than by their refusal.
    for (const s of [
      "Choose 1 of your opponent's Active Pokémon's attacks and use it as this attack.",
      "Choose 1 of your opponent's Active Tera Pokémon's attacks and use it as this attack.",
    ]) {
      expect(resolvedByAnyReader(s), s).toBe(true);
      expect(deriveAttackCopy(s), s).not.toBeNull();
      expect(deriveAttackEffect(s), s).toBeNull();
    }
    expect(
      resolvedByAnyReader(
        "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack.",
      ),
    ).toBe(true);
  });

  it("🛑 BOTH apostrophe slots drive CURLY, with EQUALITY against the straight form", () => {
    // ⚠️ EQUALITY and never merely non-null: a non-null check passes on a reader that
    // folded the sentence into some other row (D136/D137).
    const curlyBoth = PRINTED.replaceAll("'", "’");
    expect(curlyBoth).not.toBe(PRINTED);
    expect(deriveAttackEffect(curlyBoth)).toEqual(PROGRAM);
    // …and EACH SLOT ON ITS OWN, so a class narrowed on one slot cannot hide behind
    // the other. Slot 1 is the possessive `opponent's`; slot 2 the contraction `isn't`.
    const possessiveOnly = PRINTED.replace("opponent's", "opponent’s");
    const contractionOnly = PRINTED.replace("isn't", "isn’t");
    expect(possessiveOnly).not.toBe(PRINTED);
    expect(contractionOnly).not.toBe(PRINTED);
    expect(deriveAttackEffect(possessiveOnly)).toEqual(PROGRAM);
    expect(deriveAttackEffect(contractionOnly)).toEqual(PROGRAM);
  });

  it("the deriver's outer-whitespace tolerance is stated rather than assumed", () => {
    expect(deriveAttackEffect(`\t  ${PRINTED}\n`)).toEqual(PROGRAM);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D535 §2 — the NEGATIVE CONTROLS, and the siblings measured in BOTH directions", () => {
  const NBSP = " ";
  it("🛑 every near miss is NULL", () => {
    for (const [why, text] of [
      // The `$` from both sides.
      ["no trailing period", PRINTED.slice(0, -1)],
      ["an exclamation", `${PRINTED.slice(0, -1)}!`],
      // No /i anywhere — the capitalised verb is the whole of what keeps a mid-sentence
      // ABILITY printing of the same action off this path.
      ["a lowercase verb", `c${PRINTED.slice(1)}`],
      // THE PARENTHETICAL IS MANDATORY. Made optional the anchor would claim a string
      // the legal column prints NOWHERE — mutant (d)'s exact shape.
      [
        "the parenthetical dropped",
        PRINTED.replace(" (You can choose the same Pokémon more than once.)", ""),
      ],
      // The tail re-worded to the SIBLING's spelling: that is `CHOSEN_ANY_TARGET`'s
      // string and must stay its string.
      ["the sibling's tail", PRINTED.replace("This damage isn't", "This attack's damage isn't")],
      // A LEADING rider pins `^` — this is how a gated printing arrives.
      ["a leading flip", `Flip a coin. If heads, ${PRINTED.slice(0, 1).toLowerCase()}${PRINTED.slice(1)}`],
      // A TRAILING sentence the engine has never seen — the `$`'s reason for existing.
      ["an unknown remainder", `${PRINTED} Draw a card.`],
      // NON-INTEGER, SIGNED and ZERO on BOTH captures. `\d+` takes neither of the first
      // two; the `>= 1` floor is what refuses the third.
      ["a fractional count", PRINTED.replace("6 times", "6.5 times")],
      ["a signed count", PRINTED.replace("Pokémon 6 times", "Pokémon -6 times")],
      ["a zero count", PRINTED.replace("6 times", "0 times")],
      ["a fractional amount", PRINTED.replace("do 20 damage", "do 20.5 damage")],
      ["a signed amount", PRINTED.replace("do 20 damage", "do -20 damage")],
      ["a zero amount", PRINTED.replace("do 20 damage", "do 0 damage")],
      // A NON-BREAKING SPACE, spelled as an escape: byte-different and invisible in a diff.
      ["a non-breaking space", PRINTED.replace("Pokémon 6 times", `Pokémon${NBSP}6 times`)],
      // An INTERIOR double space is not trimmable.
      ["an interior double space", PRINTED.replace("6 times.", "6  times.")],
      // The lookalike `Pokemon`.
      ["a lookalike Pokemon", PRINTED.replace("Pokémon 6 times", "Pokemon 6 times")],
      // …and the REAL CATALOG NEIGHBOURS on the same opening, each a different
      // mechanism. ⚠️ FILE LINE 79 is an attack LOCK and NOT a copy-attack — the price
      // on record spelled it wrong — and it is NOT in this table because it is already
      // BUILT (`preventChosenAttack`); a `toBeNull` on it would be a false refusal
      // (D418). It is driven positively in the rung below instead.
      // 🆕🆕🆕 D573 — lines 78 and 80 (the copy-attack pair) LEFT this table for the same reason:
      // they are BUILT now (`deriveAttackCopy`), so a `toBeNull` here would be a false refusal
      // of `deriveAttackEffect` passing for a refusal of the family (D418). They are driven
      // positively in the rung below, naming the reader that owns them (D438's polarity rule).
      ["empty", ""],
    ] as const) {
      expect(deriveAttackEffect(text), why).toBeNull();
    }
  });

  it("🛑 the three neighbours are REAL corpus rows at the printed counts — a straw man would prove nothing", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(
      rows.get("Choose 1 of your opponent's Active Pokémon's attacks and use it as this attack."),
    ).toBe(3);
    const LOCK =
      "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack.";
    expect(rows.get(LOCK)).toBe(3);
    // 🛑 …and line 79 is driven POSITIVELY, because it is built: this anchor must not
    // claim it, and the way to say so without a false refusal is to name the arm that
    // does own it (D438's polarity rule).
    expect(deriveAttackEffect(LOCK)).toEqual([{ op: "preventChosenAttack" }]);
    expect((deriveAttackEffect(LOCK) ?? []).length).not.toBe(6);
    expect(
      rows.get(
        "Choose 1 of your opponent's Active Tera Pokémon's attacks and use it as this attack.",
      ),
    ).toBe(1);
    // 🆕🆕🆕 D573 — …and lines 78 / 80 are driven POSITIVELY too, now that they are built: THIS
    // anchor does not claim them, and `deriveAttackCopy` does (D438's polarity rule).
    for (const [s, copy] of [
      ["Choose 1 of your opponent's Active Pokémon's attacks and use it as this attack.", { from: "opponentActive" }],
      ["Choose 1 of your opponent's Active Tera Pokémon's attacks and use it as this attack.", { from: "opponentActiveTera" }],
    ] as const) {
      expect(deriveAttackEffect(s), s).toBeNull();
      expect(deriveAttackCopy(s), s).toEqual(copy);
    }
  });

  it("🛑 the SIBLINGS still derive their own rows unchanged, and neither claims this one", () => {
    // `CHOSEN_ANY_TARGET` — its OWN corpus row (FILE LINE 620, 2 printings) at its own
    // amount, unchanged, and still ONE op rather than six.
    expect(deriveAttackEffect(SIBLING_ROW)).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 70,
        count: 1,
        source: "attack",
        deals: true,
        ignoreWR: true,
      },
    ]);
    // `COUNTER_SPREAD_ON_OPPONENT` — its own sentence, unchanged: N ops at the §12 unit,
    // `deals` ABSENT (a placed counter, not attack damage).
    const spread = deriveAttackEffect(
      "Put 3 damage counters on your opponent's Pokémon in any way you like.",
    );
    expect(spread).toHaveLength(3);
    expect(spread?.[0]).toEqual({
      op: "damageChosen",
      target: "opponentAny",
      amount: 10,
      count: 1,
      source: "attack",
    });
    // …and NEITHER sibling's head can reach this sentence: disjointness is STRUCTURAL,
    // asserted and not assumed (D467/D499). `CHOSEN_ANY_TARGET` demands `^This attack
    // does`, arms 22/23/23a/23b demand `^Put `, this one demands `^Choose 1 of`.
    expect(PRINTED.startsWith("This attack does")).toBe(false);
    expect(PRINTED.startsWith("Put ")).toBe(false);
    expect(PRINTED.startsWith("Choose 1 of")).toBe(true);
    expect(SIBLING_ROW.startsWith("Choose 1 of")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D535 §3 — the PERSISTED BYTES: the version claim, driven rather than argued", () => {
  it("🛑 the parked op's bytes are IDENTICAL to the op `CHOSEN_ANY_TARGET` authors — the serialized alphabet does not grow", () => {
    // The sibling's own sentence at THIS amount derives the same single op. If the two
    // byte strings ever differ, D535 has widened the record and the version argument
    // below is void.
    const sibling = deriveAttackEffect(SIBLING_AT_20);
    expect(sibling).toHaveLength(1);
    expect(JSON.stringify(sibling?.[0])).toBe(JSON.stringify(ONE));
    for (const op of deriveAttackEffect(PRINTED) ?? []) {
      expect(JSON.stringify(op)).toBe(JSON.stringify(sibling?.[0]));
    }
  });

  it("🛑 the parked program round-trips through JSON in BOTH directions, byte-equal, and resumes identically", () => {
    const { state: parked } = attack(board(59, WALL, [FILLERS[1]]));
    const bytes = JSON.stringify(parked);
    const revived = JSON.parse(bytes) as GameState;
    expect(JSON.stringify(revived)).toBe(bytes);
    if (revived.phase.kind !== "effect:choose") throw new Error("not parked");
    const cont = revived.phase.cont;
    expect(cont.pendingOp).toEqual(ONE);
    // 🛑 THE KEY SET AS A LITERAL — an optional key added later reddens this line by
    // name, which a `toMatchObject` would not.
    expect(Object.keys(cont.pendingOp).sort()).toEqual([
      "amount",
      "count",
      "deals",
      "ignoreWR",
      "op",
      "source",
      "target",
    ]);
    // …and the TAIL still carries the remaining FIVE ops, each the same literal.
    expect(cont.rest).toHaveLength(5);
    expect(cont.rest).toEqual([ONE, ONE, ONE, ONE, ONE]);
    expect(bytes).toContain(
      '"pendingOp":{"op":"damageChosen","target":"opponentAny","amount":20,"count":1,"source":"attack","deals":true,"ignoreWR":true}',
    );
    // …and resuming FROM THE BYTES is the same board as resuming live.
    const fromBytes = pick(revived, 0);
    const fromLive = pick(parked, 0);
    expect(fromBytes.state).toEqual(fromLive.state);
  });

  it("🛑 `MATCH_RECORD_VERSION` is 38 (🆕🆕🆕 D575 stepped it 37 → 38; D570 stepped it 36 → 37; D564 stepped it 35 → 36; D556 stepped it 34 → 35; D552 stepped it 33 → 34; D549 stepped it 32 → 33; D548 stepped it 31 → 32; D547 stepped it 30 → 31; this slice held it) in `apps/api` — D237's POPULATION change, not a widening and not a rename", () => {
    // 🆕🆕🆕 D547 — the constant this slice held is now 31: D547 added two REQUIRED `InPlayPokemon` fields (apps/api match.ts).
    expect(raw("/lobby/match.ts")).toContain("export const MATCH_RECORD_VERSION = 38;");
    // …and the reason, pinned where a successor will look: `cardplay.ts`'s distinctness
    // guard is what makes six parks the shape, and it is still there.
    expect(raw("/cardplay.ts")).toContain(
      'if (seen.has(key)) return err("BAD_EFFECT_CHOICE", "a Pokémon picked twice");',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D535 §4 — THE SIX PARKS, END TO END", () => {
  it("🛑 six sequential `choosePokemonMulti` prompts, each at min = max = 1", () => {
    const { state: first } = attack(board(11, WALL, [FILLERS[1]]));
    let state = first;
    const seen: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const prompt = parkedPrompt(state);
      expect(prompt, `park ${String(i)}`).toMatchObject({ min: 1, max: 1, declinable: false });
      expect(prompt.candidates, `park ${String(i)}`).toHaveLength(2);
      seen.push(prompt.candidates.length);
      state = pick(state, 0).state;
    }
    expect(seen).toEqual([2, 2, 2, 2, 2, 2]);
    // …and AFTER the sixth answer the program is spent: no seventh park.
    expect(state.phase.kind).not.toBe("effect:choose");
  });

  it("🛑 THE SAME BODY PICKED TWICE TAKES 40 — which is the printed parenthetical, delivered", () => {
    const { state: first } = attack(board(13, WALL, [FILLERS[1]]));
    // Two picks on the SAME ref, then four on the Bench.
    const run = walk(first, [0, 0, 1, 1, 1, 1]);
    expect(run.parks).toBe(6);
    expect(run.state.players.p2.active?.damage).toBe(40);
    expect(run.state.players.p2.bench[0]?.damage).toBe(80);
  });

  it("🛑 ONE BODY PICKED ALL SIX TIMES TAKES 120, is KNOCKED OUT at the epilogue sweep, and pays ONE prize", () => {
    const before = board(17, TINY, [FILLERS[1]]);
    const prizesBefore = before.players.p1.prizes.length;
    const run = walk(attack(before).state, [0, 0, 0, 0, 0, 0]);
    expect(run.parks).toBe(6);
    // 120 on a 120 HP body — dead exactly on the sixth hit and not before.
    expect(run.state.players.p2.active).toBeNull();
    // 🛑 ONE Knock Out even though the program hit SIX times, because the sweep is
    // `finishAttack`'s epilogue AFTER the program settles — not a per-op sweep. This is
    // the §7 argument's observable half.
    expect(run.events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(1);
    expect(run.events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(6);
    // 🛑 …AND ONE PRIZE, DRIVEN RATHER THAN ARGUED — the prize row walked to the end.
    expect(run.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    expect(run.state.players.p1.prizes).toHaveLength(prizesBefore);
    const taken = applyAction(run.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    if (!taken.ok) throw new Error(`takePrizes refused: ${taken.error.code}`);
    expect(prizesBefore - taken.state.players.p1.prizes.length).toBe(1);
  });

  it("🛑 the `rest` tail is walked SIX DEEP — the resume is a real chain, not one op repeated by the prompt", () => {
    const { state: first } = attack(board(19, WALL, [FILLERS[1]]));
    let state = first;
    const remaining: number[] = [];
    while (state.phase.kind === "effect:choose") {
      remaining.push(state.phase.cont.rest.length);
      state = pick(state, 0).state;
    }
    expect(remaining).toEqual([5, 4, 3, 2, 1, 0]);
  });

  it("the `decider` is the attacker at every park, and the prompt is REDACTED from the other seat", () => {
    const { state: first } = attack(board(23, WALL, [FILLERS[1]]));
    let state = first;
    for (let i = 0; i < 6; i += 1) {
      if (state.phase.kind !== "effect:choose") throw new Error(`no park at ${String(i)}`);
      // The ANSWERER is the attacker: the phase carries `seat: "p1"` and no `answerer`
      // override, which is the default every own-seat park takes.
      expect(state.phase.seat, `park ${String(i)}`).toBe("p1");
      expect(
        (state.phase as { answerer?: Seat }).answerer,
        `park ${String(i)}`,
      ).toBeUndefined();
      // p1 sees the prompt; p2 sees the phase with the prompt nulled.
      const mine = redactGame(state, "p1");
      if (mine.phase.kind !== "effect:choose") throw new Error("p1 lost the park");
      expect(mine.phase.prompt).not.toBeNull();
      expect(redactGame(state, "p2").phase).toEqual({ kind: "effect:choose", prompt: null });
      state = pick(state, 0).state;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D535 §5 — THE FORCED BRANCH: no choice is no prompt (M1's doctrine, inherited)", () => {
  it("🛑 an opponent holding ONLY the Active auto-takes six times for 120 with NO park", () => {
    const { state, events } = attack(board(29, WALL, []));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p2.active?.damage).toBe(120);
    // Six hits, six events — the forced branch is the same six ops, not one folded op.
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D535 §6 — `ignoreWR` and `deals` ON THE BOARD", () => {
  it("🛑 a Weakness-carrying Active takes 20 per hit, not 40", () => {
    const { state, events } = attack(board(31, WEAK, []));
    // ×2 Psychic weakness against a Psychic attacker: 240 without the flag, 120 with it.
    expect(state.players.p2.active?.damage).toBe(120);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(6);
  });

  it("🛑 a Resistance-carrying Active is likewise unaffected — the flag nulls BOTH directions", () => {
    const { state } = attack(board(37, RESIST, []));
    // −30 Psychic resistance would floor each 20 at 0; with the flag it is a flat 120.
    expect(state.players.p2.active?.damage).toBe(120);
  });

  it("🛑 `deals` makes it ATTACK DAMAGE: `DAMAGE_DEALT` fires and `COUNTERS_PLACED` does not", () => {
    const { events } = attack(board(41, WALL, []));
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(6);
    expect(events.filter((e) => e.type === "COUNTERS_PLACED")).toHaveLength(0);
    // The control, one family over: the counter-spread sibling's own sentence is the
    // one that emits `COUNTERS_PLACED`, and its op carries NO `deals` (effects.ts:5438).
    const spread = deriveAttackEffect(
      "Put 3 damage counters on your opponent's Pokémon in any way you like.",
    );
    expect((spread?.[0] as { deals?: true }).deals).toBeUndefined();
  });

  // ── 🆕🆕🆕 D536 RIDE-ALONG — THE DEBT D535 CARRIED FORWARD, PAID ─────────────
  //
  // 🛑 **`ignoreWR` ALSO NULLS `damageReductionAfterWR`, AND UNTIL NOW NO RUNG IN THIS
  // SUITE DROVE IT.** The print does not spell it; the reading is inherited VERBATIM from
  // the D400 sibling at corpus FILE LINE 620 and from D492's spread, and D535 DISCLOSED it
  // in four places — but a reading disclosed only in prose survives its own deletion in
  // silence (D465: an instrument that produces a COMMITTED figure needs a KILLER, not a
  // doc block; D466: a REFUSAL IS NOT AN ASSERTION).
  //
  // ⚠️ **TWO RUNGS AND NOT ONE, BECAUSE THERE ARE TWO READ SITES** — `placeSnipe`'s
  // benched loop and `snipeActive`. D535's own close-out priced this at +1 test; it is +2,
  // and the correction is MEASURED rather than inherited.
  //
  // ⚠️ **TWO PICKS, NOT SIX.** 2 × 20 = 40 against Bouffalant's 120 HP keeps the KO and
  // its prize epilogue out of the number, and 40-vs-0 is MAXIMAL DISCRIMINATION: Bouffer's
  // −20 exactly cancels a 20 hit, so a build that stopped nulling the reduction reads a
  // FLAT ZERO rather than a smaller number. Fighting Weakness is inert against a Psychic
  // attacker, so the only thing this board can measure is the reduction.
  //
  // ⚠️ **`walk` IS FED `attack(board(…)).state` AND NOT `board(…)`** — it breaks at
  // `phase.kind !== "effect:choose"` and would silently return `parks: 0` with the board
  // untouched, reading 0 against 0: a vacuous green in the D200 class.
  //
  // ⚠️ **NO MUTANT ROW CAN BE UNIQUELY ATTRIBUTED TO THESE TWO** — a split-flag build
  // already reddens FOUR rungs in THREE other files (`alwaysOnReduction.test.ts`,
  // `anyTargetSnipe.test.ts` twice, `classedBoardSpread.test.ts`), which is MEASURED and
  // is also why D535's *"NO RUNG DRIVES IT"* was false about the repo even while it was
  // true about this suite. `D535-ignore-wr-keeps-the-target-reduction` names these rungs
  // as a SECOND witness rather than as the only one.
  it("🆕 RIDE-ALONG — the BENCH read site: `ignoreWR` nulls a benched Bouffalant's `damageReductionAfterWR`, so two picks land the full 40", () => {
    const { state } = walk(attack(board(43, WALL, [BOUFFALANT])).state, [1, 1]);
    // 40, not 0: Bouffer's −20 would cancel each 20 hit exactly.
    expect(state.players.p2.bench[0]?.damage).toBe(40);
  });

  it("🆕 RIDE-ALONG — the ACTIVE read site: the same nulling one function over, on the opponent's Active", () => {
    const { state } = walk(attack(board(47, BOUFFALANT, [FILLERS[1]])).state, [0, 0]);
    expect(state.players.p2.active?.damage).toBe(40);
  });

  it("the FLAT control: the same board WITHOUT the flag would differ — driven on the sibling the engine already ships", () => {
    // A constructed `deals` op with NO `ignoreWR`, run through the same attack path by
    // the sibling's own sentence, DOES double on the weak body. This is the LOSS
    // DIRECTION (D421/D435) for the flag: not corruption, not loud, a different board.
    const flat = deriveAttackEffect("This attack does 20 damage to 1 of your opponent's Pokémon.");
    expect(flat).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 20, count: 1, source: "attack", deals: true },
    ]);
    expect((flat?.[0] as { ignoreWR?: true }).ignoreWR).toBeUndefined();
    // …and the D535 op differs from it by EXACTLY that key.
    expect(Object.keys(ONE).filter((k) => !Object.keys(flat?.[0] ?? {}).includes(k))).toEqual([
      "ignoreWR",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D535 §7 — THE DECIDED DISCREPANCY, PINNED RATHER THAN PAPERED OVER (D421)", () => {
  it("🛑 the print reads *choose six times, THEN damage*; the engine INTERLEAVES pick and hit — and the FINAL BOARD is identical", () => {
    // The two readings can only disagree if the candidate set or the bodies can change
    // between picks. Neither can: `snipeTargets` applies no HP filter, and a program op
    // never sweeps Knock Outs — the sweep is `finishAttack`'s epilogue AFTER the program
    // settles. So a body already at lethal is still a candidate at pick 6.
    const { state: first } = attack(board(43, TINY, [FILLERS[1]]));
    // Five hits kill nothing (100 of 120); the SIXTH is still offered the same body,
    // which is exactly what "choose six times first" would have allowed.
    let state = first;
    for (let i = 0; i < 5; i += 1) {
      const prompt = parkedPrompt(state);
      expect(prompt.candidates, `park ${String(i)}`).toHaveLength(2);
      state = pick(state, 0).state;
    }
    const sixth = parkedPrompt(state);
    expect(sixth.candidates).toHaveLength(2);
    expect(sixth.candidates[0]).toMatchObject({ seat: "p2", spot: { spot: "active" } });
    state = pick(state, 0).state;
    expect(state.players.p2.active).toBeNull();
  });

  it("🛑 ONLY EVENT ORDER DIFFERS, and the sibling this is inherited from is named", () => {
    // `COUNTER_SPREAD_ON_OPPONENT` (4 live printings, shipped since D450) already
    // interleaves exactly this way and its own comment states the argument; D535 claims
    // nothing new here. The observable consequence is the EVENT SEQUENCE: six separate
    // `DAMAGE_DEALT` rows interleaved with the parks, where the print's reading would
    // have emitted six picks and then six hits.
    const { state: first } = attack(board(47, WALL, [FILLERS[1]]));
    const run = walk(first, [0, 1, 0, 1, 0, 1]);
    const dealt = run.events.filter((e) => e.type === "DAMAGE_DEALT");
    expect(dealt).toHaveLength(6);
    // …one per answer, never six at the end — measured, so a later fold to one op at
    // `amount * count` reddens this by name.
    expect(run.parks).toBe(6);
    expect(run.state.players.p2.active?.damage).toBe(60);
    expect(run.state.players.p2.bench[0]?.damage).toBe(60);
    // The sibling's comment is where the argument lives; pinned so a successor finds it.
    expect(raw("/effects.ts")).toContain(
      "  //      is arm 23's D125 tail (damage → program → epilogue sweep) at N picks",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D535 §8 — the POPULATION RUNG and the version", () => {
  it("🛑 `BUILT.attack` steps by the PRINTINGS (2), not by the sentences (1) — D495's shape", () => {
    // The column counts PRINTINGS. D534 stepped it by 1 for a 1-printing row; this row
    // prints twice, so the step is 2 and the two units are told apart here.
    const claimed = legalAttackCorpus().filter(([, s]) => deriveAttackEffect(s) !== null);
    expect(claimed.filter(([, s]) => s === PRINTED)).toEqual([[2, PRINTED]]);
    const reader = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    expect([reader.length, reader.reduce((sum, [n]) => sum + n, 0)]).toEqual([599, 1662]);  // (🆕🆕🆕 **D575 +6 sentences / +6 printings — THE MRV-38 ATTACK SLICE** — `deriveAttackEffect`'s six new whole-sentence anchors claim `censusAttackCorpus.ts` file lines 177 (Hypno "Daydream"), 181 (Miraidon "C.O.D.E.: Protect"), 182 (Iron Moth "Anachronism Repulsor"), 346 (N's Sigilyph "Victory Symbol"), 394 (Team Rocket's Blipbug "Searching Eyes") and 690 (Glimmora "Corrosive Shards", the compound claimed WHOLE) — one printing each, so the sentence and printing steps AGREE. A READER move.) (🆕🆕🆕 **D574 +3 sentences / +5 printings — THE COPY-FAMILY REMAINDER + SABLEYE** — `deriveAttackCopy`'s two RESOLVE-TIME anchors claim `censusAttackCorpus.ts` file lines 434 and 131 WHOLE (Haughty Order ×3, Seek Inspiration) and `deriveAttackEffect`'s new anchor claims file line 649 (Sableye "Damage Collection"). Alakazam (686) composes through the TRAILING seam and Malamar (489) is a REGISTRY row — neither is a reader move. A READER move; the sentence step (3) and the printing step (5) DISAGREE, so each site was classified by its unit.) (🆕🆕🆕 **D573 +4 sentences / +9 printings — THE COPY-ATTACK SUBSTITUTION** — `deriveAttackCopy`, the FOURTEENTH reader, claims `censusAttackCorpus.ts` file lines 77, 78, 80 and 245 WHOLE: Night Joker ×4, Foul Play ×2 + Metronome, Gemstone Mimicry, Try to Imitate. A READER move; the sentence step (4) and the printing step (9) DISAGREE, so each site was classified by its unit.) (🆕🆕🆕 **D569 +4 sentences / +6 printings — THE PARADOX BANNER READERS** — Koraidon `sv05-119`/`svp-091` "Primordial Beatdown" (`IN_PLAY_BODY_NOUNS` "Ancient Pokémon"), Roaring Moon `sv05-109`/`sv08.5-065` "Vengeance Fletching" (`DISCARD_PILE_NOUNS` "Ancient card"), Iron Valiant `sv05-080` "Majestic Sword" and Slither Wing `sv06.5-026` "Iron Smasher" (two literal `CONDITIONAL_DAMAGE_CLAUSES` rows), all over `banners.ts`' widened table (582/1636 → 586/1642)) (🆕🆕🆕 **D568 +2 sentences / +2 printings — THE TWO TERA CLAUSES, NOW THAT THE BANNER HAS A WRITER** — Ho-Oh `sv08-019` "Shining Blaze" (*"If you have any Tera Pokémon on your Bench, this attack does 100 more damage."*) and Regigigas `sv08.5-086` "Jewel Breaker" (*"If your opponent's Active Pokémon is a Tera Pokémon, this attack does 230 more damage."*), one legal printing each, two literal `CONDITIONAL_DAMAGE_CLAUSES` rows over `banners.ts` (580/1634 → 582/1636)) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: reader arm 578/1632 → 580/1634.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: reader arm 577/1631 → 578/1632.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: reader arm 573/1627 → 577/1631.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: reader arm 572/1625 → 573/1627.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: reader arm 570/1621 → 572/1625.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: reader arm 568/1619 → 570/1621.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: reader arm 567/1617 → 568/1619.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: reader arm 566/1615 → 567/1617.)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34, leading count column `1`), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing** (no card id resolves on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d540-*`), claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen` — a READER move: reader arm 564/1613 → 565/1614, raw residue 76/119 → 75/118, `BUILT.attack` 1664 → 1665, residue 49/68 → 48/67; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.424.0 → 0.425.0, `MATCH_RECORD_VERSION` HELD at 30 (D125's widening at a persisted address — and this op DOES park, so a record really can hold it, which is why the version claim rests on the widening and not on parking). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 1 — they AGREE for the first time in six slices, which is the one case where a copied number would be right by accident, so every site was measured.)  // (🆕🆕🆕 **D539 +1 sentence / +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS, so no record that can exist holds the new value). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 563/1611 → 564/1613.)  // (🆕🆕🆕 **D538 +1 sentence / +3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 562/1608 → 563/1611.)  // (🆕🆕🆕 **D537 +1 sentence / +2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 561/1606 → 562/1608.)  // (🆕🆕🆕 **D536 +1 sentence / +3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 560/1603 → 561/1606.)
    const residue = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    expect([residue.length, residue.reduce((sum, [n]) => sum + n, 0)]).toEqual([41, 70]);  // (🆕🆕🆕 **D575 −6 sentences / −6 printings — THE MRV-38 ATTACK SLICE** leave the raw residue: file lines 177, 181, 182, 346, 394 and 690, each claimed WHOLE by a new `deriveAttackEffect` anchor (Glimmora's compound included, so it does not stay raw the way D574's Alakazam did) — measured 41/70, as the D575 judge predicted.) (🆕🆕🆕 **D574 −3 sentences / −5 printings — THE COPY-FAMILY REMAINDER + SABLEYE** leave the raw residue (file lines 434, 131 and 649, claimed whole by readers); Alakazam (686, composed on the trailing seam) and Malamar (489, a registry row) STAY in the raw reader-only residue — measured 47/76 where the D574 judge predicted 46/75.) (🆕🆕🆕 **D573 −4 sentences / −9 printings — THE COPY-ATTACK SUBSTITUTION** leaves the residue: `deriveAttackCopy` claims file lines 77, 78, 80 and 245 whole; Haughty Order and Seek Inspiration stay.) (🆕🆕🆕 **D569 −4 sentences / −6 printings — THE PARADOX BANNER READERS LEFT THE RAW RESIDUE** — Koraidon ×2, Roaring Moon ×2, Iron Valiant, Slither Wing; the reader rung's +4/+6 seen from the other side (58/96 → 54/90)) (🆕🆕🆕 **D568 −2 sentences / −2 printings — THE TWO TERA CLAUSES LEFT THE RAW RESIDUE** — Ho-Oh `sv08-019` and Regigigas `sv08.5-086`, the reader rung's +2/+2 seen from the other side (60/98 → 58/96)) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: raw reader-only residue 62/100 → 60/98.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: raw reader-only residue 63/101 → 62/100.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: raw reader-only residue 67/105 → 63/101.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: raw reader-only residue 68/107 → 67/105.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: raw reader-only residue 70/111 → 68/107.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: raw reader-only residue 72/113 → 70/111.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: raw reader-only residue 73/115 → 72/113.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: raw reader-only residue 74/117 → 73/115.)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen`. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 for the first time in six slices — the one case where a copied number is right by accident, so THIS SITE was measured off the live failure and never copied from a neighbour.)  // (🆕🆕🆕 **D539 −1 sentence / −2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3). THIS SITE: 77/121 → 76/119.)  // (🆕🆕🆕 **D538 −1 sentence / −3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 78/124 → 77/121.)  // (🆕🆕🆕 **D537 −1 sentence / −2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 79/126 → 78/124.)  // (🆕🆕🆕 **D536 −1 sentence / −3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 80/129 → 79/126.)
    expect(reader.length + residue.length).toBe(640);
  });

  it("engineVersion and `manifest.version` agree, and the bump is owed for BEHAVIOUR", () => {
    expect(engineVersion).toBe("0.459.0");
    expect(manifest.version).toBe(engineVersion);
    expect(raw("/index.ts")).toContain("engineVersion 0.419.0 → **0.420.0** (D535");
  });

  it("🛑 the anchor and the arm are byte for byte what this suite drove", () => {
    const effects = raw("/effects.ts");
    expect(effects).toContain("const ATTACK_PICK_WITH_REPLACEMENT_SNIPE = new RegExp(");
    expect(effects).toContain(
      "  `^Choose 1 of your opponent['’]s Pokémon (\\\\d+) times\\\\. ` +",
    );
    expect(effects).toContain(
      '    "\\\\(You can choose the same Pokémon more than once\\\\.\\\\) " +',
    );
    expect(effects).toContain(
      "  `This damage isn['’]t affected by Weakness or Resistance\\\\.$`,",
    );
    expect(effects).toContain("    if (count >= 1 && amount >= 1) {");
    expect(effects).toContain("      return Array.from({ length: count }, () => ({");
    expect(effects).toContain('        target: "opponentAny" as const,');
    expect(effects).toContain("        count: 1,");
    expect(effects).toContain("        deals: true as const,");
    expect(effects).toContain("        ignoreWR: true as const,");
    // …and NOTHING was added: no `repeatable?: true` FIELD anywhere in the op
    // vocabulary, and no `EffectPrompt` key for one. The two hits `repeatable` has in
    // this file are the doc block SAYING it was not built (risk 7), which is why the
    // claim is spelled as a field declaration and not as a bare substring.
    expect(effects).not.toContain("repeatable?: true;");
    expect(effects).not.toContain("repeatable: true");
  });
});
