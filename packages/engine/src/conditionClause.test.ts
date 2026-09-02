import { describe, expect, it } from "vitest";
import {
  conditionHolds,
  conditionNote,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  programFor,
} from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  CONDITION_CLAUSE_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setConditions,
  setDamage,
  types,
} from "./testFixtures";

// 0.66.0 → 0.67.0 — the SECOND wave of the conditional flat attack-damage bonus
// (D116): four more printed clauses onto D115's machinery, which is unchanged.
//
// D115 built the shape ("If <clause>, this attack does N more damage." → a 0-or-1
// INDICATOR folded through the existing additive `per × count`) and mapped four
// clauses. This slice adds four more table rows and four new `BoardCondition`
// members — no new regex, no new arithmetic, no new event field:
//
//   • `yourActiveDamaged`                  — Talonflame sv02-030 "Fiery Breeze"
//                                            (70+, +90); Darmanitan sv03-035
//                                            "Damage Counterpunch" (60+, +60)
//   • `yourBenchDamaged`                   — Tyranitar ex sv03-066 (+ the
//                                            byte-identical sv03-211) "Lightning
//                                            Rampage" (150+, +100)
//   • `opponentActivePoisoned`             — Seviper sv01-128 "Venoshock" (60+,
//                                            +120), and Paldean Clodsire sv03-129
//                                            off the same row (not fixtured)
//   • `opponentActiveHasSpecialCondition`  — Sableye sv02-136 "Unseen Claw"
//                                            (20+, +70), the pool's only printing
//
// Eleven printings across seven distinct cards, on ZERO registry rows — every one
// of them simulates straight off its printed sentence, which is why the verbatim
// guard below is load-bearing rather than decorative.
//
// THE DESIGN CALL this suite exists to pin: Talonflame and Darmanitan print the
// pronoun "this Pokémon", and that pronoun is resolved to the ATTACKER'S ACTIVE in
// the CLAUSE TABLE (effects.ts), not inside `conditionHolds`. The union member is
// therefore named for what it READS — `yourActiveDamaged` — because
// `BoardCondition` is shared with `trainerPlayableIf` (a play gate evaluated with
// no attack in flight) and with the HUD, where a self-pronoun has no referent at
// all. The visible consequence, asserted at the bottom of this file: the member's
// `conditionNote` says "your Active Pokémon", never "this Pokémon".
//
// The other trap the family sets is LEXICAL. `yourActiveDamaged`'s clause and
// D115's `opponentActiveDamaged` differ by exactly one printed word ("already"),
// and `opponentActivePoisoned`'s clause is one pronoun away from Okidogi ex's
// self-Poison twin (UNMAPPED when this suite was written; D117 mapped it onto the
// SELF member `yourActivePoisoned`). Both discriminators get their own case.

/** The five printed sentences, pinned here and asserted char-for-char against
    FIXTURE_POOL below. These cards derive off text — not one carries a registry
    row (see the ZERO-rows block) — so the sentence IS the wiring: a drifted
    apostrophe or a lookalike é does not fail loudly, it silently un-simulates the
    card at the exact moment the clause would have paid off. */
const FIERY_BREEZE =
  "If this Pokémon has any damage counters on it, this attack does 90 more damage.";
const DAMAGE_COUNTERPUNCH =
  "If this Pokémon has any damage counters on it, this attack does 60 more damage.";
const LIGHTNING_RAMPAGE =
  "If your Benched Pokémon have any damage counters on them, this attack does 100 more damage.";
const VENOSHOCK =
  "If your opponent's Active Pokémon is Poisoned, this attack does 120 more damage.";
const UNSEEN_CLAW =
  "If your opponent's Active Pokémon is affected by a Special Condition, this attack does 70 more damage.";

/** The three companion sentences on the same five cards — none of them is this
    family, and each is doing a specific job in the suite: Clutch is the DERIVED
    PROGRAM that proves the two derivers stay index-keyed on one card, and the two
    status setters let the board arm its own clause without a surgery. */
const CLUTCH = "During your opponent's next turn, the Defending Pokémon can't retreat.";
const SPIT_POISON = "Your opponent's Active Pokémon is now Poisoned.";
const NIGHT_EYES = "Your opponent's Active Pokémon is now Asleep.";

const CLAUSES = [FIERY_BREEZE, DAMAGE_COUNTERPUNCH, LIGHTNING_RAMPAGE, VENOSHOCK, UNSEEN_CLAW];

/** The five card ids, in the order the table maps them. Keyed by ID everywhere in
    this file on purpose: sv01-128 Seviper and D115's sv02-137 Seviper are the SAME
    PRINTED NAME on two different cards with two different clauses, so any
    assertion that went by `name` would be reading whichever one it happened to
    find. */
const CARD_IDS = ["sv02-030", "sv03-035", "sv03-066", "sv01-128", "sv02-136"] as const;

/** UTF-8 byte length, counted off code points. Deliberately NOT
    `new TextEncoder().encode(s).length`: the engine package compiles with
    `lib: ["ES2022"]` and `types: []` (packages/engine/tsconfig.json), so no
    platform global is in scope and `tsc -b` — which CI runs — would reject it.
    Counting by code point is the same number and needs no ambient type. */
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

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so the attack step is legal (§4) — with BOTH Active spots
    pinned to a neutral 200 HP fix-bigbody. Pinning is what keeps every assertion
    seed-independent: CONDITION_CLAUSE_DECK carries Seviper and Sableye, two BASICS
    that could otherwise be the dealt starter, and fix-bigbody is simultaneously
    the arithmetically clean defender (Colorless, no Weakness, no Resistance) every
    damage number below is measured against and the clean BENCH body Lightning
    Rampage reads. Each displaced starter lands on its own bench, so both seats
    open with a non-empty, UNDAMAGED bench — the `yourBenchDamaged` negative. */
function board(seed: number): GameState {
  let state = driveSetup(
    seed,
    { p1: CONDITION_CLAUSE_DECK, p2: CONDITION_CLAUSE_DECK },
    { first: "p2" },
  );
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-bigbody");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return state;
}

/** `board`, then handed over to P2 — P1 passes into P2's turn 3, which is equally
    unrestricted. Two of these clauses are SEAT-RELATIVE reads of the attacker's
    own board (`yourActiveDamaged`, `yourBenchDamaged`), and a P1-only suite cannot
    tell "reads the attacker's side" apart from "reads p1's side". */
function boardP2(seed: number): GameState {
  return mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
}

/** Pay a printed cost symbol-for-symbol onto `seat`'s Active — typed Energy for
    the typed symbols, plain {C} (fix-energy) for the Colorless ones, rather than
    leaning on a typed card to cover both. Must run AFTER the attacker is fielded
    (attachFromDeck attaches to whatever is in the Active Spot). */
function pay(state: GameState, seat: Seat, spec: [string, number][]): GameState {
  let next = state;
  for (const [id, count] of spec) next = attachFromDeck(next, seat, id, count);
  return next;
}

/** TEST SURGERY: empty `seat`'s Bench, parking every card in the discard so each
    uid stays in exactly one zone. The `yourBenchDamaged` edge that no reachable
    board presents — `board` always leaves a displaced starter benched — and the
    one that separates "some benched Pokémon is damaged" from a vacuous
    every()-style read over an empty list. */
function clearBench(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        bench: [],
        discard: [
          ...side.discard,
          ...side.bench.flatMap((p) => [...p.stack, ...p.energy, ...p.tools]),
        ],
      },
    },
  };
}

/** TEST SURGERY: empty `seat`'s Active Spot, parking its cards in the discard.
    The live attack gate guarantees a Defending Pokémon, so no board reachable
    through `attack` can present a null Active — only a direct `conditionHolds`
    call finds this edge, and all three of the new Active-reading members have to
    answer FALSE rather than throw. */
function clearActive(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) return state;
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        active: null,
        discard: [...side.discard, ...active.stack, ...active.energy, ...active.tools],
      },
    },
  };
}

// ── The five casts, each fielded + paid symbol-for-symbol ────────────────────

/** Talonflame — {R} buys either attack (Clutch at 0, Fiery Breeze at 1). */
function talonflame(state: GameState, seat: Seat): GameState {
  return pay(setActiveFromDeck(state, seat, "sv02-030"), seat, [["fix-fire-energy", 1]]);
}

/** Darmanitan — {R}{C}{C} buys Damage Counterpunch at index 0. */
function darmanitan(state: GameState, seat: Seat): GameState {
  return pay(setActiveFromDeck(state, seat, "sv03-035"), seat, [
    ["fix-fire-energy", 1],
    ["fix-energy", 2],
  ]);
}

/** Tyranitar ex — {F}{F} buys Lightning Rampage at index 1. Faithfully odd: the
    card is typed {L} (which is what Weakness reads) but costs {F}. */
function tyranitarEx(state: GameState, seat: Seat): GameState {
  return pay(setActiveFromDeck(state, seat, "sv03-066"), seat, [["fix-fighting-energy", 2]]);
}

/** Seviper sv01-128 — {D}{C}{C} buys Venoshock at index 1 and also covers Spit
    Poison's bare {D} at index 0, so one payment serves both turns of the
    armed-by-the-game case below. */
function seviper(state: GameState, seat: Seat): GameState {
  return pay(setActiveFromDeck(state, seat, "sv01-128"), seat, [
    ["fix-dark-energy", 1],
    ["fix-energy", 2],
  ]);
}

/** Sableye — {D} buys Unseen Claw at index 1; Night Eyes at index 0 is {C}, which
    the same Darkness Energy covers. */
function sableye(state: GameState, seat: Seat): GameState {
  return pay(setActiveFromDeck(state, seat, "sv02-136"), seat, [["fix-dark-energy", 1]]);
}

describe("the printed sentences — the fixture-text-verbatim guard", () => {
  it("matches FIXTURE_POOL char-for-char on all five cards", () => {
    // These cards derive off text, so this is not decoration: it is the assertion
    // that the fixture row and the clause TABLE still agree on every byte. A
    // one-character drift here does not throw — it drops the card back onto the
    // loud ATTACK_EFFECT_SKIPPED path and silently stops paying the bonus.
    expect(FIXTURE_POOL["sv02-030"]?.attacks?.[1]?.effect).toBe(FIERY_BREEZE);
    expect(FIXTURE_POOL["sv03-035"]?.attacks?.[0]?.effect).toBe(DAMAGE_COUNTERPUNCH);
    expect(FIXTURE_POOL["sv03-066"]?.attacks?.[1]?.effect).toBe(LIGHTNING_RAMPAGE);
    expect(FIXTURE_POOL["sv01-128"]?.attacks?.[1]?.effect).toBe(VENOSHOCK);
    expect(FIXTURE_POOL["sv02-136"]?.attacks?.[1]?.effect).toBe(UNSEEN_CLAW);
    // And the printed "+" markers, which are what tell the pipeline a scaling
    // clause is expected at all.
    expect(FIXTURE_POOL["sv02-030"]?.attacks?.[1]?.damage).toBe("70+");
    expect(FIXTURE_POOL["sv03-035"]?.attacks?.[0]?.damage).toBe("60+");
    expect(FIXTURE_POOL["sv03-066"]?.attacks?.[1]?.damage).toBe("150+");
    expect(FIXTURE_POOL["sv01-128"]?.attacks?.[1]?.damage).toBe("60+");
    expect(FIXTURE_POOL["sv02-136"]?.attacks?.[1]?.damage).toBe("20+");
  });

  it("matches the three companion sentences too — they carry the suite's controls", () => {
    // Clutch is the DERIVED PROGRAM half of the index-keyed disjointness case, and
    // the two setters are how the poison/sleep boards get armed by the game rather
    // than by a surgery. All three would break those cases silently if they drifted.
    expect(FIXTURE_POOL["sv02-030"]?.attacks?.[0]?.effect).toBe(CLUTCH);
    expect(FIXTURE_POOL["sv01-128"]?.attacks?.[0]?.effect).toBe(SPIT_POISON);
    expect(FIXTURE_POOL["sv02-136"]?.attacks?.[0]?.effect).toBe(NIGHT_EYES);
    // Darmanitan's second attack omits `effect` ENTIRELY (not an empty string) —
    // the plain-vanilla control the skipped-effect path must stay silent about.
    expect(FIXTURE_POOL["sv03-035"]?.attacks?.[1]?.effect).toBeUndefined();
    // Neither status setter deals damage, which is what lets Spit Poison arm
    // Venoshock's clause without moving the arithmetic.
    expect(FIXTURE_POOL["sv01-128"]?.attacks?.[0]?.damage).toBeUndefined();
    expect(FIXTURE_POOL["sv02-136"]?.attacks?.[0]?.damage).toBeUndefined();
  });

  it("carries ASCII apostrophes and precomposed U+00E9 — the byte facts, checked programmatically", () => {
    // Asserted by CONSTRUCTION rather than by eye: the two characters a re-ingest
    // drifts on are INVISIBLE in a diff. U+2019 (the typographic apostrophe) and
    // "e" + U+0301 (the decomposed e-acute) both render identically to the real
    // thing and both miss the table's `Map.get` by a mile. The two probes are
    // spelled as \u escapes on purpose — a literal here would be exactly as
    // unreadable as the drift it is hunting.
    const CURLY_APOSTROPHE = "\u2019";
    const COMBINING_ACUTE = "e\u0301";
    for (const text of CLAUSES) {
      // NFC-stable => no combining marks anywhere in the string.
      expect(text.normalize("NFC")).toBe(text);
      expect(text).not.toContain(CURLY_APOSTROPHE);
      expect(text).not.toContain(COMBINING_ACUTE);
      // Every apostrophe present is the ASCII one, 0x27 — checked per CHARACTER so
      // the claim covers all of them, not just the first.
      for (const ch of text) {
        if (ch === "'" || ch === CURLY_APOSTROPHE) expect(ch.codePointAt(0)).toBe(0x27);
      }
      // Every `Pok\u00e9mon` spells its accent as the precomposed U+00E9: the two
      // split counts can only agree if no other spelling of it occurs.
      expect(text.split("Pok\u00e9mon").length).toBe(text.split("Pok").length);
    }
  });

  it("pins each clause's UTF-8 byte length", () => {
    // The e-acute is the one character that changes the BYTE length without
    // changing the visible one, so the encoded length is the single number that
    // catches a decomposition drift on its own. (Talonflame and Darmanitan tie at
    // 80 because "90" and "60" are both two digits.)
    expect(utf8Bytes(FIERY_BREEZE)).toBe(80);
    expect(utf8Bytes(DAMAGE_COUNTERPUNCH)).toBe(80);
    expect(utf8Bytes(LIGHTNING_RAMPAGE)).toBe(92);
    expect(utf8Bytes(VENOSHOCK)).toBe(81);
    expect(utf8Bytes(UNSEEN_CLAW)).toBe(103);
    // Every clause is EXACTLY one byte over its character count: one precomposed
    // U+00E9 each (2 bytes), and every other character — the apostrophes included —
    // ASCII. A decomposed accent adds a character AND a byte (81/82 here); a curly
    // apostrophe keeps the character count and adds two (80/83). Neither survives
    // this equality, which is why it is pinned alongside the absolute numbers.
    for (const text of CLAUSES) expect(utf8Bytes(text)).toBe(text.length + 1);
  });
});

describe("deriveAttackDamageBonus — the four NEW clauses", () => {
  it("reads Fiery Breeze as yourActiveDamaged — the printed pronoun, resolved in the TABLE", () => {
    // "this Pokémon" is resolved to the ATTACKER'S ACTIVE by the clause table, so
    // the member that comes out is named for what it reads, not for how it was
    // printed. That naming is the whole D116 call (see the header).
    expect(deriveAttackDamageBonus(FIERY_BREEZE)).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: { kind: "yourActiveDamaged" } },
    });
  });

  it("reads Lightning Rampage as yourBenchDamaged", () => {
    expect(deriveAttackDamageBonus(LIGHTNING_RAMPAGE)).toEqual({
      per: 100,
      count: { kind: "boardCondition", cond: { kind: "yourBenchDamaged" } },
    });
  });

  it("reads Venoshock as opponentActivePoisoned", () => {
    expect(deriveAttackDamageBonus(VENOSHOCK)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: { kind: "opponentActivePoisoned" } },
    });
  });

  it("reads Unseen Claw as opponentActiveHasSpecialCondition", () => {
    expect(deriveAttackDamageBonus(UNSEEN_CLAW)).toEqual({
      per: 70,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveHasSpecialCondition" } },
    });
  });

  it("maps a CLAUSE, not a card — Talonflame and Darmanitan share one row at 90 and 60", () => {
    // Two different cards, two different printed amounts, one identical clause.
    // Nothing may key the amount off the condition (or the condition off the card):
    // the N is captured from the sentence every time.
    expect(deriveAttackDamageBonus(DAMAGE_COUNTERPUNCH)).toEqual({
      per: 60,
      count: { kind: "boardCondition", cond: { kind: "yourActiveDamaged" } },
    });
    const fiery = deriveAttackDamageBonus(FIERY_BREEZE);
    const counterpunch = deriveAttackDamageBonus(DAMAGE_COUNTERPUNCH);
    expect(fiery?.count).toEqual(counterpunch?.count);
    expect(fiery?.per).not.toBe(counterpunch?.per);
  });

  it("keeps the 'already' discriminator — one word apart, two different members", () => {
    // THE lexical trap of this family. D115's opponent-facing clause and D116's
    // self-facing one are the same English sentence but for the pronoun and the
    // word "already"; a substring-matching table would collapse them and score
    // Talonflame's +90 off the DEFENDER's damage.
    expect(deriveAttackDamageBonus(FIERY_BREEZE)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "yourActiveDamaged" },
    });
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon already has any damage counters on it, this attack does 90 more damage.",
      )?.count,
    ).toEqual({ kind: "boardCondition", cond: { kind: "opponentActiveDamaged" } });
  });
});

describe("deriveAttackDamageBonus — the near-misses that stay UNMAPPED (and therefore LOUD)", () => {
  it("reads Okidogi ex's SELF-Poison twin as the OTHER member, not this one", () => {
    // Okidogi ex sv06.5-036/-082/-090 "Chain-Crazed", 3 printings — UNMAPPED when
    // this suite was written (it was the file's near-miss witness) and mapped by
    // D117 onto `yourActivePoisoned`. It stays here as the LEXICAL discriminator
    // it always was: one pronoun apart from Venoshock's row, opposite boards. The
    // failure this guards against is a row keyed loosely enough to swallow both.
    expect(
      deriveAttackDamageBonus("If this Pokémon is Poisoned, this attack does 130 more damage.")
        ?.count,
    ).toEqual({ kind: "boardCondition", cond: { kind: "yourActivePoisoned" } });
    expect(deriveAttackDamageBonus(VENOSHOCK)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActivePoisoned" },
    });
  });

  it("refuses Lucario's last-turn-KO clause — a well-formed sentence, an unmapped condition", () => {
    // Lucario sv01-114 "Avenging Knuckle", printed text (verified verbatim
    // against the local D1 — the attack's NAME is "Avenging Knuckle", not "Aura
    // Sphere"). The sentence matches the
    // family's shape perfectly; only the CLAUSE misses the table, which is exactly
    // the fall-through the `Map.get` guard exists to protect. It reads what
    // happened on the PREVIOUS turn, state the model does not keep.
    //
    // (This case used to point at Sylveon swsh10.5-035's Dragon clause, which
    // D120 mapped via the type TEMPLATE — re-pointed rather than deleted, since
    // the fall-through needs a live witness.)
    expect(
      deriveAttackDamageBonus(
        "If any of your {F} Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 120 more damage.",
      ),
    ).toBeNull();
  });

  it("refuses the damage-PLACEMENT sentences that merely CONTAIN a mapped clause", () => {
    // Yveltal sv06.5-035 "Cruel Arrow"-family and Vespiquen ex sv03-096 both print
    // "…that has any damage counters on it" as a TARGET FILTER on a `Put N damage
    // counters` sentence. The substring is there; the sentence is not this shape.
    // The whole-sentence anchor (^If … more damage\.$) is the only thing excluding
    // them, and a table that searched for its keys anywhere in the text would turn
    // both into a flat damage bonus.
    const yveltal =
      "Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it.";
    const vespiquen =
      "Put 3 damage counters on each of your opponent's Benched Pokémon that has any damage counters on it.";
    expect(deriveAttackDamageBonus(yveltal)).toBeNull();
    expect(deriveAttackDamageBonus(vespiquen)).toBeNull();
    // 🆕🆕🆕 **D450 CORRECTED THE PARAGRAPH THAT USED TO SIT HERE, AND THE CORRECTION IS
    // THE POINT.** It read: *"NEITHER derives to a program on the op path today either.
    // The `Put N damage counters on EACH …` spread with a per-target filter is an
    // unbuilt shape, so both cards stay wholly on the loud skipped path."* That was
    // TRUE when written and is now half false: `deriveAttackEffect` claims the first of
    // the two through arm 23f (`counterEachAll` with `side: "opponent"` and D437's
    // `damagedOnly` rider). The SECOND — the Bench-scoped spelling — is still unread and
    // carries **0 Standard-legal printings**, so it is refused by the anchor and by the
    // population both. ⚠️ **THIS RUNG'S OWN CLAIM IS UNTOUCHED BY EITHER FACT**: it is
    // about `deriveAttackDamageBonus`, and a sentence that reaches a DIFFERENT reader
    // has not reached this one. Stated as an inequality of READERS rather than deleted,
    // which is what keeps the disjointness assertion doing its job.
    expect(deriveAttackDamageBonus(yveltal)).toBeNull();
    expect(deriveAttackEffect(yveltal)?.[0]?.op).toBe("counterEachAll");
    expect(deriveAttackEffect(vespiquen)).toBeNull();
  });

  it("deriveAttackDamageMultiplier refuses all four — the no-'more' twin owns nothing here", () => {
    // Every one of these prints "more", so it is additive by construction; the
    // multiply reader (which drops the printed base) must not see any of them.
    for (const text of CLAUSES) {
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
    }
  });
});

describe("the two derivers stay disjoint, and stay INDEX-KEYED", () => {
  it("deriveAttackEffect matches none of the clause sentences", () => {
    // The op deriver reads sentences that run AFTER damage; this family folds
    // BEFORE the §8.5 pipeline. No printed text may derive down both paths, or the
    // same sentence would be paid for twice.
    for (const text of CLAUSES) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("Talonflame carries a derived PROGRAM at index 0 and a derived SCALING at index 1", () => {
    // One card, both derivers, neither leaking into the other's slot. Index 0's
    // Clutch is D112's retreat-LOCK rider, which `deriveAttackEffect` owns outright;
    // index 1 is this slice's clause, which `deriveAttackDamageBonus` owns outright.
    const clutch = FIXTURE_POOL["sv02-030"]?.attacks?.[0]?.effect ?? "";
    const fieryBreeze = FIXTURE_POOL["sv02-030"]?.attacks?.[1]?.effect ?? "";
    expect(deriveAttackEffect(clutch)).toEqual([{ op: "preventRetreat" }]);
    expect(deriveAttackDamageBonus(clutch)).toBeNull();
    expect(deriveAttackDamageBonus(fieryBreeze)).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: { kind: "yourActiveDamaged" } },
    });
    // And the half this case really exists for: index 1 does NOT inherit index 0's
    // program. A card-keyed (rather than index-keyed) lookup would hand Fiery
    // Breeze a retreat lock it never printed.
    expect(deriveAttackEffect(fieryBreeze)).toBeNull();
  });

  it("Seviper's and Sableye's index-0 setters derive as PROGRAMS, not as clauses", () => {
    // The mirror of the case above on the two cards whose index 0 arms the very
    // condition index 1 reads — the setter is an op, the reader is a clause, and
    // the two never swap.
    expect(deriveAttackEffect(SPIT_POISON)).toEqual([
      { op: "applyStatus", target: "defender", status: "poisoned" },
    ]);
    expect(deriveAttackEffect(NIGHT_EYES)).toEqual([
      { op: "applyStatus", target: "defender", status: "asleep" },
    ]);
    expect(deriveAttackDamageBonus(SPIT_POISON)).toBeNull();
    expect(deriveAttackDamageBonus(NIGHT_EYES)).toBeNull();
  });
});

describe("ZERO registry rows — the whole slice is text", () => {
  it("gives none of the five cards a registry program", () => {
    // The claim the header makes, asserted. If any of these ever grows a row, the
    // registry would win (`programFor(id)?.attack?.[index] ?? derive`) and every
    // damage number below would keep passing while testing nothing about the text.
    for (const id of CARD_IDS) {
      expect(programFor(id)).toBeUndefined();
    }
    // sv03-211 is Tyranitar ex's second printing — byte-identical rules text, no
    // fixture of its own, and equally rowless. Named here so the pair stays visible.
    expect(programFor("sv03-211")).toBeUndefined();
  });
});

describe("Talonflame 'Fiery Breeze' — yourActiveDamaged, read off the ATTACKER's own body", () => {
  it("UNDAMAGED the printed 70 stands — and nothing is flagged", () => {
    const state = talonflame(board(1), "p1");
    expect(state.players.p1.active?.damage).toBe(0);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    // The condition is FALSE and the "+" is still simulated: `effectSimulated` /
    // `modifierSimulated` ride `scaling !== null`, not on the clause holding.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 70, dealt: 70 });
    // `scaled` is omitted at 0 — the indicator genuinely added nothing.
    expect(dealt?.scaled).toBeUndefined();
  });

  it("adds the whole printed 90 once the attacker carries counters → 160", () => {
    // One counter is enough: "any damage counters on it" carries no threshold, and
    // the read happens at DECLARATION, off the damage Talonflame walked in with.
    const state = setDamage(talonflame(board(2), "p1"), "p1", 10);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 70, scaled: 90, dealt: 160 });
  });

  it("is the ATTACKER's side — damage on the DEFENDER's Active scores nothing", () => {
    // THE asymmetry, and the case that catches a seat-swapped read: the identical
    // 10 counters, on the wrong side of the board. A `yourActiveDamaged` wired to
    // `otherSeat(seat)` would be D115's `opponentActiveDamaged` wearing this name,
    // and would score 160 here.
    const state = setDamage(talonflame(board(3), "p1"), "p2", 10);
    expect(state.players.p1.active?.damage).toBe(0);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 70, dealt: 70 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("runs identically from the OTHER seat — seat-relativity, both directions", () => {
    // The whole trio again with P2 attacking. Nothing in this clause is p1-shaped:
    // a hardcoded "p1" would read P1's undamaged Talonflame here and pay 70.
    const clean = talonflame(boardP2(4), "p2");
    const cleanEvents = mustApply(clean, { type: "attack", seat: "p2", index: 1 }).events;
    expect(find(cleanEvents, "DAMAGE_DEALT")).toMatchObject({ base: 70, dealt: 70 });

    const hurt = setDamage(clean, "p2", 10);
    const hurtEvents = mustApply(hurt, { type: "attack", seat: "p2", index: 1 }).events;
    expect(find(hurtEvents, "DAMAGE_DEALT")).toMatchObject({ base: 70, scaled: 90, dealt: 160 });

    // And damage on P2's OPPONENT (P1) still scores nothing, mirrored.
    const wrongSide = setDamage(clean, "p1", 10);
    const wrongEvents = mustApply(wrongSide, { type: "attack", seat: "p2", index: 1 }).events;
    expect(find(wrongEvents, "DAMAGE_DEALT")).toMatchObject({ base: 70, dealt: 70 });
  });
});

describe("Darmanitan 'Damage Counterpunch' — the same clause at a DIFFERENT N", () => {
  it("goes 60 → 120, not 60 → 150", () => {
    // The proof that the amount is captured per SENTENCE: the identical clause that
    // pays Talonflame +90 pays Darmanitan +60. A table that carried the amount
    // alongside the condition would give both cards the same bonus.
    const clean = darmanitan(board(5), "p1");
    const cleanEvents = mustApply(clean, { type: "attack", seat: "p1", index: 0 }).events;
    expect(types(cleanEvents)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(cleanEvents, "DAMAGE_DEALT")).toMatchObject({ base: 60, dealt: 60 });

    const hurt = setDamage(darmanitan(board(6), "p1"), "p1", 10);
    const hurtEvents = mustApply(hurt, { type: "attack", seat: "p1", index: 0 }).events;
    expect(types(hurtEvents)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(hurtEvents, "DAMAGE_DEALT")).toMatchObject({ base: 60, scaled: 60, dealt: 120 });
  });
});

describe("Tyranitar ex 'Lightning Rampage' — yourBenchDamaged, the family's only BENCH read", () => {
  it("with a CLEAN bench the printed 150 stands", () => {
    // `board` leaves both seats a real, non-empty, undamaged bench (the displaced
    // starter, plus the fix-bigbody this surgery displaces in turn) — so this is
    // "bench present and clean", not "no bench".
    const state = tyranitarEx(board(7), "p1");
    expect(state.players.p1.bench.length).toBeGreaterThan(0);
    expect(state.players.p1.bench.every((p) => p.damage === 0)).toBe(true);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 150, dealt: 150 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("ONE damaged benched body is enough → 250", () => {
    // The printed plural ("your Benched Pokémon HAVE any damage counters on THEM")
    // is collective, not universal: any single benched Pokémon carrying counters
    // satisfies it. A literal `every()` reading would demand the whole bench.
    const state = setBenchDamage(tyranitarEx(board(8), "p1"), "p1", 0, 10);
    expect(state.players.p1.bench.some((p) => p.damage === 0)).toBe(true); // not all of them
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 150, scaled: 100, dealt: 250 });
  });

  it("is BENCH-ONLY — damage on Tyranitar ex ITSELF does not satisfy it", () => {
    // The case that catches conflating this member with `yourActiveDamaged`. Both
    // read "your side" and both read `damage > 0`; only the SPOT differs, and the
    // Active is deliberately not consulted here.
    const state = setDamage(tyranitarEx(board(9), "p1"), "p1", 10);
    expect(state.players.p1.active?.damage).toBe(10);
    expect(state.players.p1.bench.every((p) => p.damage === 0)).toBe(true);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 150, dealt: 150 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("an EMPTY bench is FALSE, not vacuously true", () => {
    // `[].every(...)` is true and `[].some(...)` is false — the difference between
    // a Tyranitar ex that pays 250 for having no bench at all and one that pays the
    // printed 150. Unreachable through normal play from `board`, hence the surgery.
    const state = clearBench(tyranitarEx(board(10), "p1"), "p1");
    expect(state.players.p1.bench).toEqual([]);
    expect(conditionHolds(state, "p1", { kind: "yourBenchDamaged" })).toBe(false);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 150, dealt: 150 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("reads the ATTACKER's bench — the OPPONENT's damaged bench scores nothing", () => {
    // The seat-relativity half, cross-board: the same counters, on P2's bench.
    const state = setBenchDamage(tyranitarEx(board(11), "p1"), "p2", 0, 10);
    expect(state.players.p1.bench.every((p) => p.damage === 0)).toBe(true);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 150, dealt: 150 });
    expect(dealt?.scaled).toBeUndefined();
  });
});

describe("Seviper sv01-128 'Venoshock' — opponentActivePoisoned", () => {
  it("vs a CLEAN Active the printed 60 stands", () => {
    const state = seviper(board(12), "p1");
    expect(state.players.p2.active?.conditions.poisonDamage).toBe(0);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 60, dealt: 60 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("vs a POISONED Active it adds the whole 120 → 180", () => {
    // §12 stores Poison as the counter AMOUNT an effect may raise, so "is Poisoned"
    // is `poisonDamage > 0` — the same read the Checkup makes.
    const state = setConditions(seviper(board(13), "p1"), "p2", { poisonDamage: 10 });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 60, scaled: 120, dealt: 180 });
  });

  it("is armed by the GAME, not by a surgery — Spit Poison one turn, Venoshock the next", () => {
    // The end-to-end case: no `setConditions` anywhere. Seviper's own index-0 Spit
    // Poison (a derived `applyStatus` op that deals NO damage) sets the condition
    // its index-1 reads two turns later, so the clause is proved against a board the
    // engine built for itself.
    //
    // The arithmetic has to account for §13.1: the Checkup runs between EVERY pair
    // of turns and ticks Poison on both Actives, so P2's fix-bigbody takes 10 when
    // P1's attack ends the turn and another 10 when P2 passes back — 20 already on
    // it before Venoshock is even declared. That is accounted for, not worked
    // around: the DAMAGE_DEALT is still exactly 60 + 120, and 20 + 180 = 200 is
    // precisely fix-bigbody's HP, so the hit is also lethal.
    let state = seviper(board(14), "p1");
    const poisonRun = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // Spit Poison deals nothing itself — the only damage in its events is §13.1's.
    expect(find(poisonRun.events, "DAMAGE_DEALT")).toBeUndefined();
    expect(types(poisonRun.events)).toContain("COUNTERS_PLACED");
    state = poisonRun.state;
    expect(state.players.p2.active?.conditions.poisonDamage).toBe(10);
    expect(state.players.p2.active?.damage).toBe(10); // one Checkup tick

    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    expect(state.players.p2.active?.damage).toBe(20); // a second tick, on the way back
    expect(state.players.p1.active?.damage).toBe(0); // Seviper was never Poisoned

    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 60, scaled: 120, dealt: 180 });
    // 20 + 180 against 200 HP — the bonus is what makes it lethal (60 alone would
    // have left the body on 80).
    expect(types(events)).toContain("KNOCKED_OUT");
  });

  it("is POISON specifically — an ASLEEP Active does not satisfy it", () => {
    // The negative that separates this member from `opponentActiveHasSpecialCondition`
    // below: Sleep is a Special Condition and is not Poison, so Venoshock stays at
    // its printed 60 on a board where Unseen Claw would fire.
    const state = setConditions(seviper(board(15), "p1"), "p2", { rotation: "asleep" });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 60, dealt: 60 });
    expect(dealt?.scaled).toBeUndefined();
  });
});

describe("Sableye 'Unseen Claw' — opponentActiveHasSpecialCondition, ANY one of them", () => {
  it("vs a CLEAN Active the printed 20 stands", () => {
    const state = sableye(board(16), "p1");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 20, dealt: 20 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("fires on Asleep, on Poisoned and on Burned alike → 90 every time", () => {
    // "affected by a Special Condition" is a disjunction over the whole §12 set:
    // the rotation slot (Asleep here) and the two independent flags (Poison, Burn)
    // each satisfy it ALONE. Three separate boards, one number.
    const cases: Parameters<typeof setConditions>[2][] = [
      { rotation: "asleep" },
      { poisonDamage: 10 },
      { burned: true },
    ];
    for (const [i, conditions] of cases.entries()) {
      const state = setConditions(sableye(board(17 + i), "p1"), "p2", conditions);
      const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 20, scaled: 70, dealt: 90 });
    }
  });

  it("the PAIRING: on ONE Asleep board Unseen Claw fires and Venoshock does not", () => {
    // The two clauses are nested (Poisoned ⊂ affected by a Special Condition), and
    // this is the board that proves they are not aliases of each other. Both
    // attackers are built off the SAME `asleep` state, so nothing but the clause
    // differs between the two runs.
    const asleep = setConditions(board(20), "p2", { rotation: "asleep" });
    expect(conditionHolds(asleep, "p1", { kind: "opponentActiveHasSpecialCondition" })).toBe(true);
    expect(conditionHolds(asleep, "p1", { kind: "opponentActivePoisoned" })).toBe(false);

    const claw = mustApply(sableye(asleep, "p1"), { type: "attack", seat: "p1", index: 1 }).events;
    expect(find(claw, "DAMAGE_DEALT")).toMatchObject({ base: 20, scaled: 70, dealt: 90 });

    const venom = mustApply(seviper(asleep, "p1"), { type: "attack", seat: "p1", index: 1 }).events;
    const venomDealt = find(venom, "DAMAGE_DEALT");
    expect(venomDealt).toMatchObject({ base: 60, dealt: 60 });
    expect(venomDealt?.scaled).toBeUndefined();
  });
});

describe("the fold order — the bonus lands BEFORE §8.5 Weakness", () => {
  it("doubles (base + scaled), not base alone: (150 + 100) × 2 = 500", () => {
    // Tyranitar ex is typed {L} (its {F} attack cost is irrelevant to W/R — the
    // multiplier reads the attacking POKÉMON's type) and Talonflame is Weakness
    // Lightning ×2, so the whole folded number is what doubles. A fold placed AFTER
    // Weakness would give 150×2 + 100 = 400. Talonflame's printed Fighting −30
    // resistance never fires: the attacker is not a Fighting Pokémon.
    const state = setBenchDamage(
      setActiveFromDeck(tyranitarEx(board(21), "p1"), "p2", "sv02-030"),
      "p1",
      0,
      10,
    );
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      base: 150,
      scaled: 100,
      weakness: { op: "multiply", amount: 2 },
      dealt: 500,
    });
  });

  it("and the un-bonused control on the same matchup: 150 × 2 = 300", () => {
    // Same Weakness, clean bench — so the 200 of difference above is the bonus
    // being doubled and nothing else.
    const state = setActiveFromDeck(tyranitarEx(board(22), "p1"), "p2", "sv02-030");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({
      base: 150,
      weakness: { op: "multiply", amount: 2 },
      dealt: 300,
    });
    expect(dealt?.scaled).toBeUndefined();
  });
});

describe("ATTACK_EFFECT_SKIPPED never fires — in EITHER direction", () => {
  it("simulates the sentence whether or not the clause holds, on all four cards", () => {
    // The point of the whole family: before D115 every leading-`If` print fell onto
    // the loud skipped path with its "+" marker unsimulated. Now the flag rides
    // `scaling !== null` — the sentence being RECOGNISED — so a false clause is a
    // simulated 0, not an unsimulated unknown. Asserted for the true AND the false
    // board of each card, because a flag wired to the clause's VALUE instead of its
    // recognition would only show up on one of the two.
    const cases: { build: (seed: number) => GameState; index: number; arm: boolean }[] = [
      { build: (s) => talonflame(board(s), "p1"), index: 1, arm: false },
      { build: (s) => setDamage(talonflame(board(s), "p1"), "p1", 10), index: 1, arm: true },
      { build: (s) => tyranitarEx(board(s), "p1"), index: 1, arm: false },
      {
        build: (s) => setBenchDamage(tyranitarEx(board(s), "p1"), "p1", 0, 10),
        index: 1,
        arm: true,
      },
      { build: (s) => seviper(board(s), "p1"), index: 1, arm: false },
      {
        build: (s) => setConditions(seviper(board(s), "p1"), "p2", { poisonDamage: 10 }),
        index: 1,
        arm: true,
      },
      { build: (s) => sableye(board(s), "p1"), index: 1, arm: false },
      {
        build: (s) => setConditions(sableye(board(s), "p1"), "p2", { rotation: "asleep" }),
        index: 1,
        arm: true,
      },
    ];
    for (const [i, { build, index, arm }] of cases.entries()) {
      const { events } = mustApply(build(30 + i), { type: "attack", seat: "p1", index });
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      // And the two boards really are different boards — `scaled` present exactly
      // when the clause held, which is what makes the shared flag meaningful.
      expect(find(events, "DAMAGE_DEALT")?.scaled !== undefined).toBe(arm);
    }
  });
});

describe("conditionHolds / conditionNote — the four NEW members, directly", () => {
  it("yourActiveDamaged is OWN-side, per seat, and 0-exclusive", () => {
    const clean = board(40);
    expect(conditionHolds(clean, "p1", { kind: "yourActiveDamaged" })).toBe(false);
    expect(conditionHolds(clean, "p2", { kind: "yourActiveDamaged" })).toBe(false);

    // Damage on P1's Active is P1's OWN condition — the exact opposite scoping to
    // D115's `opponentActiveDamaged`, which the same board answers the other way.
    const hurt = setDamage(clean, "p1", 10);
    expect(conditionHolds(hurt, "p1", { kind: "yourActiveDamaged" })).toBe(true);
    expect(conditionHolds(hurt, "p2", { kind: "yourActiveDamaged" })).toBe(false);
    expect(conditionHolds(hurt, "p2", { kind: "opponentActiveDamaged" })).toBe(true);

    // Mirrored onto the other seat — nothing here is p1-shaped.
    const mirrored = setDamage(clean, "p2", 10);
    expect(conditionHolds(mirrored, "p2", { kind: "yourActiveDamaged" })).toBe(true);
    expect(conditionHolds(mirrored, "p1", { kind: "yourActiveDamaged" })).toBe(false);

    // The empty-spot edge: FALSE, not a throw.
    const empty = clearActive(hurt, "p1");
    expect(empty.players.p1.active).toBeNull();
    expect(conditionHolds(empty, "p1", { kind: "yourActiveDamaged" })).toBe(false);
  });

  it("yourBenchDamaged is own-side, per seat, and false on an EMPTY bench", () => {
    const clean = board(41);
    expect(conditionHolds(clean, "p1", { kind: "yourBenchDamaged" })).toBe(false);
    expect(conditionHolds(clean, "p2", { kind: "yourBenchDamaged" })).toBe(false);

    const hurt = setBenchDamage(clean, "p1", 0, 10);
    expect(conditionHolds(hurt, "p1", { kind: "yourBenchDamaged" })).toBe(true);
    expect(conditionHolds(hurt, "p2", { kind: "yourBenchDamaged" })).toBe(false);

    const mirrored = setBenchDamage(clean, "p2", 0, 10);
    expect(conditionHolds(mirrored, "p2", { kind: "yourBenchDamaged" })).toBe(true);
    expect(conditionHolds(mirrored, "p1", { kind: "yourBenchDamaged" })).toBe(false);

    // A SECOND damaged body on a longer bench changes nothing — the collective
    // plural is a disjunction, so it is already true at one.
    const bigger = setBenchDamage(benchFromDeck(hurt, "p1", "fix-bigbody"), "p1", 1, 10);
    expect(bigger.players.p1.bench.length).toBeGreaterThan(hurt.players.p1.bench.length);
    expect(conditionHolds(bigger, "p1", { kind: "yourBenchDamaged" })).toBe(true);

    // The empty-bench edge, off a board that WAS true a line ago: emptying it makes
    // it false rather than vacuously true.
    const empty = clearBench(hurt, "p1");
    expect(empty.players.p1.bench).toEqual([]);
    expect(conditionHolds(empty, "p1", { kind: "yourBenchDamaged" })).toBe(false);
    // And clearing the OTHER seat's bench leaves P1's answer alone.
    expect(conditionHolds(clearBench(hurt, "p2"), "p1", { kind: "yourBenchDamaged" })).toBe(true);
  });

  it("opponentActivePoisoned is cross-board, per seat, and false with no Active", () => {
    const clean = board(42);
    expect(conditionHolds(clean, "p1", { kind: "opponentActivePoisoned" })).toBe(false);
    expect(conditionHolds(clean, "p2", { kind: "opponentActivePoisoned" })).toBe(false);

    const poisoned = setConditions(clean, "p2", { poisonDamage: 10 });
    expect(conditionHolds(poisoned, "p1", { kind: "opponentActivePoisoned" })).toBe(true);
    expect(conditionHolds(poisoned, "p2", { kind: "opponentActivePoisoned" })).toBe(false);

    const mirrored = setConditions(clean, "p1", { poisonDamage: 10 });
    expect(conditionHolds(mirrored, "p2", { kind: "opponentActivePoisoned" })).toBe(true);
    expect(conditionHolds(mirrored, "p1", { kind: "opponentActivePoisoned" })).toBe(false);

    // A raised counter amount is still just "Poisoned" — the read is `> 0`, not
    // `=== 10`, so a doubled-Poison board answers the same.
    const heavy = setConditions(clean, "p2", { poisonDamage: 30 });
    expect(conditionHolds(heavy, "p1", { kind: "opponentActivePoisoned" })).toBe(true);

    const empty = clearActive(poisoned, "p2");
    expect(empty.players.p2.active).toBeNull();
    expect(conditionHolds(empty, "p1", { kind: "opponentActivePoisoned" })).toBe(false);
  });

  it("opponentActiveHasSpecialCondition covers every §12 slot, and is false with no Active", () => {
    const clean = board(43);
    expect(conditionHolds(clean, "p1", { kind: "opponentActiveHasSpecialCondition" })).toBe(false);
    expect(conditionHolds(clean, "p2", { kind: "opponentActiveHasSpecialCondition" })).toBe(false);

    // Every §12 condition alone, plus the two-at-once board — the rotation slot
    // holds one of asleep/confused/paralyzed while Poison and Burn are independent
    // flags, so "affected" has to be a disjunction across all three fields.
    const singles: Parameters<typeof setConditions>[2][] = [
      { rotation: "asleep" },
      { rotation: "confused" },
      { rotation: "paralyzed" },
      { poisonDamage: 10 },
      { burned: true },
      { rotation: "asleep", poisonDamage: 10 },
    ];
    for (const conditions of singles) {
      const armed = setConditions(clean, "p2", conditions);
      expect(conditionHolds(armed, "p1", { kind: "opponentActiveHasSpecialCondition" })).toBe(true);
      // Always the OPPONENT's Active: P2's own answer reads P1, who is clean.
      expect(conditionHolds(armed, "p2", { kind: "opponentActiveHasSpecialCondition" })).toBe(
        false,
      );
    }

    // Mirrored onto the other seat.
    const mirrored = setConditions(clean, "p1", { burned: true });
    expect(conditionHolds(mirrored, "p2", { kind: "opponentActiveHasSpecialCondition" })).toBe(
      true,
    );
    expect(conditionHolds(mirrored, "p1", { kind: "opponentActiveHasSpecialCondition" })).toBe(
      false,
    );

    const empty = clearActive(setConditions(clean, "p2", { burned: true }), "p2");
    expect(empty.players.p2.active).toBeNull();
    expect(conditionHolds(empty, "p1", { kind: "opponentActiveHasSpecialCondition" })).toBe(false);
  });

  it("names all four in the reject/tooltip vocabulary", () => {
    // None of the four is reachable from a play gate today (all four arrive through
    // attack text), so nothing else in the suite would catch a typo in the copy —
    // and the HUD renders these strings verbatim.
    expect(conditionNote({ kind: "yourActiveDamaged" })).toBe(
      "your Active Pokémon has damage counters on it",
    );
    expect(conditionNote({ kind: "yourBenchDamaged" })).toBe(
      "1 of your Benched Pokémon has damage counters on it",
    );
    expect(conditionNote({ kind: "opponentActivePoisoned" })).toBe(
      "your opponent's Active Pokémon is Poisoned",
    );
    expect(conditionNote({ kind: "opponentActiveHasSpecialCondition" })).toBe(
      "your opponent's Active Pokémon is affected by a Special Condition",
    );
  });

  it("drops the printed pronoun — yourActiveDamaged's note never says 'this Pokémon'", () => {
    // THE D116 point, asserted where it is visible. The clause table resolved "this
    // Pokémon" to the attacker's Active; the note is read off the BOARD by a play
    // gate or a HUD tooltip, where there is no attack in flight and the pronoun has
    // no referent at all. So the note names the SPOT.
    const note = conditionNote({ kind: "yourActiveDamaged" });
    expect(note).not.toContain("this Pokémon");
    expect(note).not.toContain("This Pokémon");
    expect(note).toContain("your Active Pokémon");
    // The printed sentence it came from DOES say it — the two really do differ.
    expect(FIERY_BREEZE).toContain("this Pokémon");
    // And it is not simply D115's opponent-facing note wearing a new name.
    expect(note).not.toBe(conditionNote({ kind: "opponentActiveDamaged" }));
  });
});

describe("the family is PURE — a frozen board is never mutated", () => {
  it("resolves every clause, TRUE and FALSE, off a deep-frozen state", () => {
    // Eight boards: each of the four clauses armed and unarmed. Strict mode turns
    // any write to a frozen object into a throw, so a fold that (say) normalised a
    // condition in place would fail here and nowhere else.
    const cases: { build: (seed: number) => GameState; index: number }[] = [
      { build: (s) => talonflame(board(s), "p1"), index: 1 },
      { build: (s) => setDamage(talonflame(board(s), "p1"), "p1", 10), index: 1 },
      { build: (s) => tyranitarEx(board(s), "p1"), index: 1 },
      { build: (s) => setBenchDamage(tyranitarEx(board(s), "p1"), "p1", 0, 10), index: 1 },
      { build: (s) => seviper(board(s), "p1"), index: 1 },
      {
        build: (s) => setConditions(seviper(board(s), "p1"), "p2", { poisonDamage: 10 }),
        index: 1,
      },
      { build: (s) => sableye(board(s), "p1"), index: 1 },
      {
        build: (s) => setConditions(sableye(board(s), "p1"), "p2", { rotation: "asleep" }),
        index: 1,
      },
    ];
    for (const [i, { build, index }] of cases.entries()) {
      const state = deepFreeze(build(50 + i));
      expect(() => mustApply(state, { type: "attack", seat: "p1", index })).not.toThrow();
    }
  });

  it("conditionHolds itself is a pure read, both seats, all four members", () => {
    // The direct-call half: `conditionHolds` is the single evaluator behind the
    // attack fold, the play gate and the HUD, and the HUD calls it on every render
    // against state it does not own.
    const frozen = deepFreeze(
      setConditions(setBenchDamage(setDamage(board(60), "p1", 10), "p1", 0, 10), "p2", {
        rotation: "asleep",
        poisonDamage: 10,
      }),
    );
    for (const seat of ["p1", "p2"] as const) {
      for (const kind of [
        "yourActiveDamaged",
        "yourBenchDamaged",
        "opponentActivePoisoned",
        "opponentActiveHasSpecialCondition",
      ] as const) {
        expect(() => conditionHolds(frozen, seat, { kind })).not.toThrow();
      }
    }
    // Armed for P1 on every one of the four, and false for P2 on every one — the
    // frozen board answers, and answers seat-relatively.
    expect(conditionHolds(frozen, "p1", { kind: "yourActiveDamaged" })).toBe(true);
    expect(conditionHolds(frozen, "p1", { kind: "yourBenchDamaged" })).toBe(true);
    expect(conditionHolds(frozen, "p1", { kind: "opponentActivePoisoned" })).toBe(true);
    expect(conditionHolds(frozen, "p1", { kind: "opponentActiveHasSpecialCondition" })).toBe(true);
    expect(conditionHolds(frozen, "p2", { kind: "yourActiveDamaged" })).toBe(false);
    expect(conditionHolds(frozen, "p2", { kind: "yourBenchDamaged" })).toBe(false);
    expect(conditionHolds(frozen, "p2", { kind: "opponentActivePoisoned" })).toBe(false);
    expect(conditionHolds(frozen, "p2", { kind: "opponentActiveHasSpecialCondition" })).toBe(false);
  });
});
