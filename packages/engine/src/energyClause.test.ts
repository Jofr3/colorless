import { BASIC_ENERGY_TYPES } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  conditionHolds,
  conditionNote,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  hasAttachedEnergy,
  programFor,
  redactGame,
} from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  ENERGY_CLAUSE_DECK,
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.68.0 → 0.69.0 — the conditional-damage family's first PARAMETERISED clause
// (D118). D115 built the shape ("If <clause>, this attack does N more damage." →
// a 0-or-1 INDICATOR folded through the existing additive `per × count`), D116
// added the pronoun rule, D117 added two more literal rows. This slice adds no
// new arithmetic and no new event field either — but it is the first clause that
// is a TEMPLATE rather than a literal:
//
//   • `yourActiveHasEnergyAttached`, carrying `energy: BasicEnergyType | "special"`
//     — the first `BoardCondition` member with a parameter at all.
//
// Four printings across four cards, all on ZERO registry ATTACK rows (Tinkaton
// carries an abilities-only row from an older slice — see the ZERO-rows block):
//   Scovillain sv01-029 / -202 "Super Spicy Breath"  ({R},      90+ / +90)
//   Galvantula sv06.5-002    "Shocking Web"          ({L},      50+ / +80)
//   Cetitan    sv02-055      "Special Horn"          (Special,  80+ / +140)
//   Tinkaton   sv02-105      "Special Hammer"        (Special,  90+ / +90)
//
// THE THREE CALLS this suite exists to pin:
//
// 1. ONE SHAPE, NOT FOUR ROWS. `boardConditionForClause` now runs TWO passes: the
//    literal `CONDITIONAL_DAMAGE_CLAUSES` Map first, then the anchored
//    whole-clause template `SELF_ENERGY_ATTACHED_CLAUSE`. Literals win by
//    construction, so a template can never re-interpret a clause a row owns. The
//    token vocabulary is built FROM the two notation maps, so the brace code
//    ({R}) and the spelled-out name (Fire) resolve to the same member — asserted
//    below on a CONSTRUCTED probe, because every printing of this sentence today
//    is brace-coded and a code-only parser would look perfectly healthy right up
//    until swsh10.5 prints the shape.
//
// 2. THE READ IS PROVISION, NOT THE PRINTED NAME. A type arm asks
//    `providesEnergyType`, the same question §8.2's cost check asks — so a
//    wildcard Luminous Energy IS a {R} Energy while it provides every type, and
//    STOPS being one the moment a second Special demotes it to {C}. One pair of
//    cards therefore turns the clause off on a board where nothing else moved.
//    That is this slice's sharpest case, and the one a name-matching
//    implementation cannot pass.
//
// 3. TWO AXES, NOT ONE. `"special"` is the card CLASS, not a tenth type. On the
//    very Luminous+Jet board where the {R} clause is FALSE, the Special clause is
//    TRUE — which is why the parameter is `BasicEnergyType | "special"` and not a
//    widened type union.

/** The four printed sentences, pinned here and asserted char-for-char against
    FIXTURE_POOL below. These cards derive off text — none carries an authored
    attack (see the ZERO-rows block) — so the sentence IS the wiring: a drifted brace, a
    lost capital on "Special" or a lookalike é does not fail loudly, it silently
    un-simulates the card at the exact moment the clause would have paid off. */
const SUPER_SPICY_BREATH =
  "If this Pokémon has any {R} Energy attached, this attack does 90 more damage.";
const SHOCKING_WEB =
  "If this Pokémon has any {L} Energy attached, this attack does 80 more damage.";
const SPECIAL_HORN =
  "If this Pokémon has any Special Energy attached, this attack does 140 more damage.";
const SPECIAL_HAMMER =
  "If this Pokémon has any Special Energy attached, this attack does 90 more damage.";

/** The two companion sentences on the cast, each doing a specific job here:
    Scovillain's index 0 is a BUILT status setter (the only index-0 in this cast
    simulated for a reason other than a scaling clause), and Cetitan's index 0
    carries no `effect` key at all — the plain-vanilla negative. */
const HOT_BITE = "Your opponent's Active Pokémon is now Burned.";

const CLAUSES = [SUPER_SPICY_BREATH, SHOCKING_WEB, SPECIAL_HORN, SPECIAL_HAMMER];

/** Every id this one template covers. Keyed by ID everywhere in this file on
    purpose: Scovillain is two printings of one rules text, and the pool holds
    several cards whose printed clause merely CONTAINS this one (see the
    near-miss block), so an assertion that went by `name` would be reading
    whichever card it happened to find. */
const CARD_IDS = ["sv01-029", "sv01-202", "sv06.5-002", "sv02-055", "sv02-105"] as const;

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
    seed-independent, and here it also guarantees the DEFENDER carries no Energy
    of its own: every one of these clauses reads an ATTACHED Energy, and a dealt
    starter with an incidental attachment would arm or disarm a case the test
    never named. fix-bigbody is simultaneously the arithmetically clean defender
    (Colorless, no Weakness, no Resistance) every damage number below is measured
    against. Each displaced starter lands on its own bench. */
function board(seed: number): GameState {
  let state = driveSetup(seed, { p1: ENERGY_CLAUSE_DECK, p2: ENERGY_CLAUSE_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-bigbody");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return state;
}

/** `board`, then handed over to P2 — P1 passes into P2's turn 3, which is equally
    unrestricted. `yourActiveHasEnergyAttached` is a SEAT-RELATIVE read of the
    attacker's OWN Active, and a P1-only suite cannot tell "reads the attacker's
    side" apart from "reads p1's side". */
function boardP2(seed: number): GameState {
  return mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
}

/** Pay a printed cost symbol-for-symbol onto `seat`'s Active — typed Energy for
    the typed symbols, plain {C} (fix-energy) for the Colorless ones, rather than
    leaning on a typed card to cover both. That separation is load-bearing in this
    suite and nowhere else: the Energy that ARMS a type clause ({R}, {L}) is never
    the Energy that pays a cost, so no case can accidentally read a cost payment
    as the condition. Must run AFTER the attacker is fielded (attachFromDeck
    attaches to whatever is in the Active Spot). */
function pay(state: GameState, seat: Seat, spec: [string, number][]): GameState {
  let next = state;
  for (const [id, count] of spec) next = attachFromDeck(next, seat, id, count);
  return next;
}

/** TEST SURGERY: empty `seat`'s Active Spot, parking its cards in the discard.
    The live attack gate guarantees a Defending Pokémon, so no board reachable
    through `attack` can present a null Active — only a direct `conditionHolds`
    call finds this edge, and the new member has to answer FALSE rather than
    throw. */
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

// ── The four casts, each fielded + paid symbol-for-symbol (never armed) ──────

/** Scovillain — {G}{C}{C} buys Super Spicy Breath at index 1, and the same Energy
    covers Hot Bite's bare {C} at index 0. NOT armed: the {R} the clause reads is
    attached case by case. A Stage 1 (from Capsakid), always force-placed. */
function scovillain(state: GameState, seat: Seat): GameState {
  return pay(setActiveFromDeck(state, seat, "sv01-029"), seat, [
    ["fix-grass-energy", 1],
    ["fix-energy", 2],
  ]);
}

/** Galvantula — {G}{C} buys Shocking Web, its only attack (index 0). A Stage 1
    from Joltik; its "Compound Eyes" Ability is INERT (no registry row, and no
    deriver reads ability text), which the ZERO-rows block asserts. */
function galvantula(state: GameState, seat: Seat): GameState {
  return pay(setActiveFromDeck(state, seat, "sv06.5-002"), seat, [
    ["fix-grass-energy", 1],
    ["fix-energy", 1],
  ]);
}

/** Cetitan — {W}{W}{C} buys Special Horn at index 1, and the same Energy covers
    Icicle Missile's {W}{C} at index 0. A Stage 1 from Cetoddle. */
function cetitan(state: GameState, seat: Seat): GameState {
  return pay(setActiveFromDeck(state, seat, "sv02-055"), seat, [
    ["fix-water-energy", 2],
    ["fix-energy", 1],
  ]);
}

/** Tinkaton — {P}{C} buys Special Hammer, its only attack (index 0). The cast's
    only STAGE 2, force-placed like the rest. */
function tinkaton(state: GameState, seat: Seat): GameState {
  return pay(setActiveFromDeck(state, seat, "sv02-105"), seat, [
    ["fix-psychic-energy", 1],
    ["fix-energy", 1],
  ]);
}

describe("the printed sentences — the fixture-text-verbatim guard", () => {
  it("matches FIXTURE_POOL char-for-char on all four printings", () => {
    // These cards derive off text, so this is not decoration: it is the assertion
    // that the fixture rows and the clause TEMPLATE still agree on every byte. A
    // one-character drift here does not throw — it drops the card back onto the
    // loud ATTACK_EFFECT_SKIPPED path and silently stops paying the bonus.
    expect(FIXTURE_POOL["sv01-029"]?.attacks?.[1]?.effect).toBe(SUPER_SPICY_BREATH);
    expect(FIXTURE_POOL["sv06.5-002"]?.attacks?.[0]?.effect).toBe(SHOCKING_WEB);
    expect(FIXTURE_POOL["sv02-055"]?.attacks?.[1]?.effect).toBe(SPECIAL_HORN);
    expect(FIXTURE_POOL["sv02-105"]?.attacks?.[0]?.effect).toBe(SPECIAL_HAMMER);
    // The printed "+" markers, which are what tell the pipeline a scaling clause
    // is expected at all — and the printed BASE the fold starts from.
    expect(FIXTURE_POOL["sv01-029"]?.attacks?.[1]?.damage).toBe("90+");
    expect(FIXTURE_POOL["sv06.5-002"]?.attacks?.[0]?.damage).toBe("50+");
    expect(FIXTURE_POOL["sv02-055"]?.attacks?.[1]?.damage).toBe("80+");
    expect(FIXTURE_POOL["sv02-105"]?.attacks?.[0]?.damage).toBe("90+");
    // Names, so a re-ingest that reshuffled the attack order fails HERE rather
    // than as a mystery damage number three describes down.
    expect(FIXTURE_POOL["sv01-029"]?.attacks?.[1]?.name).toBe("Super Spicy Breath");
    expect(FIXTURE_POOL["sv06.5-002"]?.attacks?.[0]?.name).toBe("Shocking Web");
    expect(FIXTURE_POOL["sv02-055"]?.attacks?.[1]?.name).toBe("Special Horn");
    expect(FIXTURE_POOL["sv02-105"]?.attacks?.[0]?.name).toBe("Special Hammer");
  });

  it("matches the companion index-0 rows too — they carry the suite's controls", () => {
    // Scovillain's index 0 is a BUILT setter, so it is the control proving "no
    // ATTACK_EFFECT_SKIPPED" is not simply this cast being unreadable; Cetitan's
    // index 0 omits `effect` ENTIRELY (not an empty string — the row has no key),
    // the plain-vanilla negative. Both would break a case silently.
    expect(FIXTURE_POOL["sv01-029"]?.attacks?.[0]?.effect).toBe(HOT_BITE);
    expect(FIXTURE_POOL["sv02-055"]?.attacks?.[0]?.effect).toBeUndefined();
    expect(FIXTURE_POOL["sv02-055"]?.attacks?.[0]?.name).toBe("Icicle Missile");
    // Flat printed damage, no "+": neither index 0 is in this family at all.
    expect(FIXTURE_POOL["sv01-029"]?.attacks?.[0]?.damage).toBe(20);
    expect(FIXTURE_POOL["sv02-055"]?.attacks?.[0]?.damage).toBe(50);
  });

  it("keeps the fixture facts the damage arithmetic below is measured against", () => {
    // Every number in the board layer is (HP, type, Weakness) arithmetic off these
    // rows. Pinned here so a fixture edit that moves 360 to 270 fails with a
    // sentence about Weakness rather than with a bare numeric mismatch.
    expect(FIXTURE_POOL["sv01-029"]?.types).toEqual(["Grass"]); // reads {R}, IS {G}
    expect(FIXTURE_POOL["sv06.5-002"]?.types).toEqual(["Grass"]); // reads {L}, IS {G}
    expect(FIXTURE_POOL["sv02-055"]?.hp).toBe(180); // the only body that survives its own 220
    expect(FIXTURE_POOL["sv02-105"]?.types).toEqual(["Psychic"]); // the fold-order attacker
    expect(FIXTURE_POOL["sv02-105"]?.stage).toBe("Stage2"); // the cast's only Stage 2
    // The §8.5 defender and the clean control, the two bodies every damage number
    // lands on.
    expect(FIXTURE_POOL["fix-psychic-weak"]?.weaknesses).toEqual([
      { type: "Psychic", value: "×2" },
    ]);
    expect(FIXTURE_POOL["fix-psychic-weak"]?.hp).toBe(200);
    expect(FIXTURE_POOL["fix-bigbody"]?.hp).toBe(200);
    expect(FIXTURE_POOL["fix-bigbody"]?.weaknesses).toBeNull();
    // The two Specials the provision case turns on: Luminous is the WILDCARD and
    // Jet is the second Special that demotes it. Both must be `energyType`
    // "Special" for the CLASS arm to see them at all.
    expect(FIXTURE_POOL["sv02-191"]?.energyType).toBe("Special");
    expect(FIXTURE_POOL["sv02-190"]?.energyType).toBe("Special");
    // …and the basics must NOT be, or the class clause would fire off a cost
    // payment.
    expect(FIXTURE_POOL["fix-fire-energy"]?.energyType).toBe("Normal");
    expect(FIXTURE_POOL["fix-energy"]?.energyType).toBe("Normal");
  });

  it("carries precomposed U+00E9 and no apostrophe at all — the byte facts, checked programmatically", () => {
    // Asserted by CONSTRUCTION rather than by eye: the characters a re-ingest
    // drifts on are INVISIBLE in a diff. U+2019 (the typographic apostrophe) and
    // "e" + U+0301 (the decomposed e-acute) both render identically to the real
    // thing and both miss the template's `Map.get` by a mile. The two probes are
    // spelled as \u escapes on purpose — a literal here would be exactly as
    // unreadable as the drift it is hunting.
    const CURLY_APOSTROPHE = "’";
    const COMBINING_ACUTE = "é";
    for (const text of CLAUSES) {
      // NFC-stable => no combining marks anywhere in the string.
      expect(text.normalize("NFC")).toBe(text);
      expect(text).not.toContain(COMBINING_ACUTE);
      // Unlike D117's pair, these four are SELF-scoped and name no possessive at
      // all, so the correct apostrophe count is ZERO — a stronger claim than "the
      // apostrophes present are ASCII", and one that also catches a clause
      // rewritten into the opponent-scoped form.
      expect(text).not.toContain("'");
      expect(text).not.toContain(CURLY_APOSTROPHE);
      // Every `Pokémon` spells its accent as the precomposed U+00E9: the two
      // split counts can only agree if no other spelling of it occurs.
      expect(text.split("Pokémon").length).toBe(text.split("Pok").length);
    }
  });

  it("pins each clause's UTF-8 byte length", () => {
    // The e-acute is the one character that changes the BYTE length without
    // changing the visible one, so the encoded length is the single number that
    // catches a decomposition drift on its own.
    expect(utf8Bytes(SUPER_SPICY_BREATH)).toBe(78);
    expect(utf8Bytes(SHOCKING_WEB)).toBe(78);
    expect(utf8Bytes(SPECIAL_HORN)).toBe(83);
    expect(utf8Bytes(SPECIAL_HAMMER)).toBe(82);
    // And the invariant behind those four constants: each clause is exactly one
    // byte over its character count PER "Pokémon" it prints — one precomposed
    // U+00E9 (2 bytes) each, every other character ASCII. NOT "+1": the constant
    // is the accent COUNT, which is 1 here only because these sentences are
    // self-scoped and say "Pokémon" once (D117's Fighting Sword says it three
    // times). A decomposed accent adds a character AND a byte; a curly apostrophe
    // keeps the character count and adds two. Neither survives this equality.
    for (const text of CLAUSES) {
      const accents = text.split("Pokémon").length - 1;
      expect(accents).toBe(1);
      expect(utf8Bytes(text)).toBe(text.length + accents);
    }
    // The two {R}/{L} sentences differ only in one brace letter and one digit, so
    // they weigh the same — the fact that makes the byte pins a per-SENTENCE
    // check rather than a per-card one.
    expect(utf8Bytes(SUPER_SPICY_BREATH)).toBe(utf8Bytes(SHOCKING_WEB));
  });
});

describe("deriveAttackDamageBonus — the PARAMETERISED clause", () => {
  it("reads the two brace-coded TYPE printings, each with its own token and N", () => {
    // One template, two tokens, two amounts. The pair is the whole argument for a
    // parameter: as literal rows this would already cost two entries and two union
    // members, and the pool prints nine codes in two rival notations.
    expect(deriveAttackDamageBonus(SUPER_SPICY_BREATH)).toEqual({
      per: 90,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "Fire" },
      },
    });
    expect(deriveAttackDamageBonus(SHOCKING_WEB)).toEqual({
      per: 80,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "Lightning" },
      },
    });
  });

  it("reads the two Special-CLASS printings — same member, different axis", () => {
    // "Special" resolves to the literal `"special"`, which is NOT a member of
    // BASIC_ENERGY_TYPES: the parameter is `BasicEnergyType | "special"` precisely
    // so the card class and the energy type cannot be confused for one another at
    // the type level, let alone on a board.
    expect(deriveAttackDamageBonus(SPECIAL_HORN)).toEqual({
      per: 140,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "special" },
      },
    });
    expect(deriveAttackDamageBonus(SPECIAL_HAMMER)).toEqual({
      per: 90,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "special" },
      },
    });
    expect(BASIC_ENERGY_TYPES).not.toContain("special");
    expect(BASIC_ENERGY_TYPES).not.toContain("Special");
  });

  it("captures the N from the SENTENCE — the template carries the condition, never the amount", () => {
    // Cetitan and Tinkaton print the SAME clause at 140 and 90, which is the live
    // proof rather than a constructed one: one condition, two amounts, one
    // template row. Nothing may key the amount off the condition.
    const horn = deriveAttackDamageBonus(SPECIAL_HORN);
    const hammer = deriveAttackDamageBonus(SPECIAL_HAMMER);
    expect(horn?.count).toEqual(hammer?.count);
    expect(horn?.per).toBe(140);
    expect(hammer?.per).toBe(90);
  });

  it("resolves every brace code the pool can print — nine tokens, one shape", () => {
    // The template's vocabulary is built FROM ENERGY_TYPE_BY_CODE, so this is the
    // assertion that the derived list really is the full one rather than the two
    // codes that happen to be printed today. {C} and {N} are absent by design and
    // are checked in the near-miss block below.
    const CODES = {
      "{G}": "Grass",
      "{R}": "Fire",
      "{W}": "Water",
      "{L}": "Lightning",
      "{P}": "Psychic",
      "{F}": "Fighting",
      "{D}": "Darkness",
      "{M}": "Metal",
      "{Y}": "Fairy",
    } as const;
    for (const [code, energy] of Object.entries(CODES)) {
      expect(
        deriveAttackDamageBonus(
          `If this Pokémon has any ${code} Energy attached, this attack does 30 more damage.`,
        ),
      ).toEqual({
        per: 30,
        count: { kind: "boardCondition", cond: { kind: "yourActiveHasEnergyAttached", energy } },
      });
    }
    // Every one of the nine is a real BASIC_ENERGY_TYPES member — the two lists
    // cannot drift apart without failing here.
    for (const energy of Object.values(CODES)) expect(BASIC_ENERGY_TYPES).toContain(energy);
  });

  it("NOTATION PARITY (constructed): the spelled-out name reads as the brace code does", () => {
    // CONSTRUCTED — no card prints this sentence with a spelled-out type TODAY, and
    // that is exactly why the case exists. The pool's two notations split cleanly
    // by SET: sv01/sv02/sv03/sv06.5 use brace codes exclusively, swsh10.5 spells
    // names out exclusively (25 matching cards, zero brace codes). All four
    // printings of THIS clause are sv-era, so a code-only parser would pass every
    // other test in this file and then silently skip a whole set the moment one
    // swsh card prints the shape. The two forms must land on the same member.
    const spelled = deriveAttackDamageBonus(
      "If this Pokémon has any Fire Energy attached, this attack does 30 more damage.",
    );
    expect(spelled).toEqual({
      per: 30,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "Fire" },
      },
    });
    // Identical condition to the real {R} printing — only the amount differs.
    expect(spelled?.count).toEqual(deriveAttackDamageBonus(SUPER_SPICY_BREATH)?.count);
    // And the whole spelled-out vocabulary, keyed off BASIC_ENERGY_TYPES itself so
    // a type added to the schema is admitted here by construction rather than by a
    // hand-maintained list.
    for (const energy of BASIC_ENERGY_TYPES) {
      expect(
        deriveAttackDamageBonus(
          `If this Pokémon has any ${energy} Energy attached, this attack does 30 more damage.`,
        )?.count,
      ).toEqual({ kind: "boardCondition", cond: { kind: "yourActiveHasEnergyAttached", energy } });
    }
  });
});

describe("deriveAttackDamageBonus — the near-misses that stay UNMAPPED (and therefore LOUD)", () => {
  it("refuses Okidogi sv06.5-074's ABILITY text — prefix-identical, not an attack clause", () => {
    // REAL printed text (the non-ex Okidogi is in the live catalog, not in this
    // pool). It opens with the mapped clause CHARACTER FOR CHARACTER — "If this
    // Pokémon has any {D} Energy attached, " — and then goes somewhere else
    // entirely. Only the outer whole-sentence anchor keeps it out: the trailing
    // half is not ", this attack does N more damage.", so `CONDITIONAL_DAMAGE_BONUS`
    // never matches and the clause pass is never reached. A deriver that hunted for
    // the clause first and the sentence second would score +100 off an Ability.
    const okidogi =
      "If this Pokémon has any {D} Energy attached, it gets +100 HP, and the attacks it uses do 100 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).";
    expect(deriveAttackDamageBonus(okidogi)).toBeNull();
    expect(deriveAttackDamageMultiplier(okidogi)).toBeNull();
    // The prefix really is shared, so the refusal is a discrimination rather than
    // a coincidence of unrelated text.
    expect(okidogi.startsWith("If this Pokémon has any {D} Energy attached, ")).toBe(true);
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon has any {D} Energy attached, this attack does 100 more damage.",
      ),
    ).not.toBeNull();
  });

  it("refuses sv03-022's 'for each' sentence — the mapped words, a different mechanism", () => {
    // REAL printed text, and the closest LEXICAL trap in the pool: it contains
    // "has any {G} Energy attached" verbatim, inside a per-Pokémon COUNT over the
    // BENCH. This family's count is a 0-or-1 indicator on the ACTIVE; that one is a
    // genuine multi-unit count nobody has built. Both readers must decline, or a
    // bench-wide scaling attack would quietly become a flat +40.
    const forEach =
      "This attack does 40 more damage for each of your Benched Pokémon that has any {G} Energy attached.";
    expect(forEach).toContain("has any {G} Energy attached");
    expect(deriveAttackDamageBonus(forEach)).toBeNull();
    expect(deriveAttackDamageMultiplier(forEach)).toBeNull();
    expect(deriveAttackEffect(forEach)).toBeNull();
  });

  it("refuses Haxorus sv06.5-046 as a BONUS — its clause is now READ, and by another reader", () => {
    // RE-POINTED (D415), NOT DELETED — and this case is the family's clearest
    // instance of a witness outliving its own reasons. It was written with TWO,
    // and **BOTH HAVE SINCE EXPIRED, ONE PER SLICE**:
    //
    //   • *"its consequence is a KO, not a damage bonus"* — EXPIRED AT D414, which
    //     built the field-free `knockOutDefender` op and made a Knock Out an
    //     expressible consequent for the first time (its suite is
    //     knockOutDefender.test.ts).
    //   • *"it reads the OPPONENT's Active (this member is self-scoped by
    //     construction — the printed 'this Pokémon' is resolved to YOUR Active in
    //     the clause table)"* — EXPIRED AT D415, whose
    //     `opponentActiveHasEnergyAttached` is the SEAT MIRROR of this file's own
    //     member: same `energy` parameter, same `hasAttachedEnergy` predicate (by
    //     PROVISION, D118), same false-on-an-empty-Active-Spot contract, one seat
    //     over. The self-scoped half of the sentence is still true OF THIS FILE'S
    //     MEMBER — what expired is "self-scoped BY CONSTRUCTION", the claim that no
    //     member of the union could read the other board.
    //
    // 🛑 WHAT THE CASE STILL OWNS IS THE HALF THAT STAYED TRUE, AND IT IS SHARPER
    // NOW THAN WHEN IT WAS WRITTEN: **a Knock Out is still not a damage bonus**, so
    // both damage readers must keep declining. This is the sentence that would
    // tempt a substring match hardest — "has any Special Energy attached" is
    // Cetitan's and Tinkaton's clause VERBATIM — and where that used to be a
    // hypothetical, there is now a live arm in the tree that reads these exact
    // words to a program. A bonus reader that hunted the clause first and the
    // sentence second would find a real member waiting for it and score +N off a
    // sentence that prints no number at all.
    const haxorus =
      "If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out.";
    expect(haxorus).toContain("has any Special Energy attached");
    // 🛑 THE TWO NULLS ARE KEPT UNCHANGED — they are the surviving half of the
    // claim, and the reason this rung was re-pointed rather than dropped.
    expect(deriveAttackDamageBonus(haxorus)).toBeNull();
    expect(deriveAttackDamageMultiplier(haxorus)).toBeNull();
    // …and the third null is now the POSITIVE program, asserted as an EQUALITY
    // rather than as a non-null (D409's rule): an arm that emitted the op BARE —
    // gate dropped — satisfies a non-null and unconditionally Knocks Out every
    // Active in the format.
    expect(deriveAttackEffect(haxorus)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveHasEnergyAttached", energy: "special" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "knockOutDefender" }],
      },
    ]);
    // The SEAT is the only thing that differs between the two members, said as a
    // comparison on the same run rather than asserted about one side alone: this
    // file's own sentence, whose clause is the Haxorus clause word for word past
    // the subject, still resolves to the SELF-scoped member.
    expect(deriveAttackDamageBonus(SPECIAL_HAMMER)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "yourActiveHasEnergyAttached", energy: "special" },
    });
    expect(SPECIAL_HAMMER).toContain("has any Special Energy attached");
  });

  it("refuses Slither Wing sv06.5-026 — the OUTER shape matches and the clause still misses", () => {
    // REAL printed text, and the strongest live witness in the suite: the outer
    // anchor "If <clause>, this attack does 120 more damage." matches PERFECTLY,
    // so `boardConditionForClause` genuinely runs — misses every literal row,
    // misses both templates, and returns null. That null is the whole fall-through
    // contract: an unrecognised clause keeps its loud ATTACK_EFFECT_SKIPPED row
    // instead of silently scoring the bonus at 0.
    //
    // RE-POINTED (D121). This case used to ride Absol sv06.5-030's "you have at
    // least 3 {D} Energy in play", which that slice MAPPED — so the witness moved
    // rather than being deleted, per the family's standing rule. Slither Wing is
    // the better long-term choice besides: it is blocked on an INGEST change, not
    // on engine work (D115's census — the catalog parses tcgdex's `suffix` but
    // drops it before the D1 insert, so "Future Pokémon" is unspellable today),
    // which means it cannot be mapped out from under this case by a table row.
    const slitherWing =
      "If your opponent has any Future Pokémon in play, this attack does 120 more damage.";
    expect(deriveAttackDamageBonus(slitherWing)).toBeNull();
    // It also keeps the discriminator this case was originally chosen for: "in
    // play" is not "attached", the one word between a board-wide read and a
    // per-Pokémon one, and the reason this suite's template is anchored on the
    // latter. (The Energy half of that pair now lives in energyInPlay.test.ts.)
    expect(slitherWing).toContain("in play");
    expect(slitherWing).not.toContain("attached");
    // The same skeleton with a MAPPED clause derives fine, so the anchor is not
    // what refused it.
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon has any {D} Energy attached, this attack does 50 more damage.",
      ),
    ).toEqual({
      per: 50,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "Darkness" },
      },
    });
  });

  it("refuses {C} — Colorless is the provision FALLBACK, never a filter", () => {
    // CONSTRUCTED, and deliberately absent from the vocabulary rather than merely
    // unbuilt. Every UNAUTHORED Special Energy provides {C} conservatively, so a
    // "{C} Energy attached" clause would match a board nobody meant — including
    // one whose only Energy is a Special the engine has no program for. {N}
    // (Dragon) is absent for the schema's own reason: there is no Basic Dragon
    // Energy. Both stay null, both stay loud.
    for (const code of ["{C}", "{N}"]) {
      expect(
        deriveAttackDamageBonus(
          `If this Pokémon has any ${code} Energy attached, this attack does 30 more damage.`,
        ),
      ).toBeNull();
    }
    expect(BASIC_ENERGY_TYPES).not.toContain("Colorless");
  });

  it("refuses a bogus token — the capture is resolved, not trusted", () => {
    // CONSTRUCTED. The template's capture group is `(.+)`, so the REGEX matches
    // any token at all; what refuses these is `CLAUSE_ENERGY_TOKENS.get` coming
    // back undefined. The Map (not an object literal) is why "constructor" and
    // "toString" are refused too: an object lookup on arbitrary printed text can
    // hit Object.prototype and hand back something that is not an energy type.
    for (const token of ["{X}", "{RR}", "R", "Basic", "special", "constructor", "toString"]) {
      expect(
        deriveAttackDamageBonus(
          `If this Pokémon has any ${token} Energy attached, this attack does 30 more damage.`,
        ),
      ).toBeNull();
    }
    // Case matters on the class token too: the vocabulary carries "Special" as
    // printed, and the matcher has no /i.
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon has any special Energy attached, this attack does 30 more damage.",
      ),
    ).toBeNull();
  });

  it("holds the whole-sentence ANCHOR — case, period, both margins, and a printed 0", () => {
    // The ways a real print differs from this family while still containing its
    // words. Each must stay null: an unrecognised sentence is LOUD, and a deriver
    // that shrugged off the anchor would score +90 for text it never actually read
    // (the trailing-clause probe carries a whole extra effect).
    expect(
      deriveAttackDamageBonus(
        "if this Pokémon has any {R} Energy attached, this attack does 90 more damage.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon has any {R} Energy attached, this attack does 90 more damage",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon has any {R} Energy attached, this attack does 90 more damage. Then, discard that Energy.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "During your turn, if this Pokémon has any {R} Energy attached, this attack does 90 more damage.",
      ),
    ).toBeNull();
    // A printed 0 is the family's own guard, not an anchor one: it parses and is
    // then REFUSED, because a bonus that adds nothing must stay loud rather than
    // claim to be simulated.
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon has any {R} Energy attached, this attack does 0 more damage.",
      ),
    ).toBeNull();
  });

  it("refuses an opponent-scoped rewrite of the very same clause", () => {
    // CONSTRUCTED, and the member's defining boundary. `yourActiveHasEnergyAttached`
    // is named for what it READS, and the printed "this Pokémon" was resolved to
    // YOUR Active in the clause table (D116's rule) — so the cross-board wording is
    // a DIFFERENT condition. If the template were keyed loosely enough to swallow
    // it, Scovillain would score +90 off the defender's Energy, which the board
    // layer below proves it does not.
    //
    // ⚠️ ONE WORD OF THIS COMMENT EXPIRED AT D415 and is corrected here rather than
    // left to mislead: the cross-board condition is no longer one "that nothing
    // owns" — `opponentActiveHasEnergyAttached` owns it, and `effects.ts` names
    // THIS case as the sentence the repo had already written down as the thing the
    // typed reading was waiting for. What is still unowned is the SENTENCE, not the
    // condition: no BONUS reader reads an opponent-scoped clause, so both lines
    // below stay null, and the day one is built this rung asserts a value rather
    // than being deleted.
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon has any {R} Energy attached, this attack does 90 more damage.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon has any Special Energy attached, this attack does 90 more damage.",
      ),
    ).toBeNull();
    // The self-scoped originals, on the same shape — so the two refusals are a
    // discrimination and not a broken deriver.
    expect(deriveAttackDamageBonus(SUPER_SPICY_BREATH)).not.toBeNull();
    expect(deriveAttackDamageBonus(SPECIAL_HAMMER)).not.toBeNull();
  });
});

describe("the derivers stay disjoint, and stay INDEX-KEYED", () => {
  it("deriveAttackEffect and deriveAttackDamageMultiplier match none of the four", () => {
    // The op deriver reads sentences that run AFTER damage; this family folds
    // BEFORE the §8.5 pipeline. And all four print "more", so all four are additive
    // by construction — the multiply reader DROPS the printed base rather than
    // adding to it, so Special Horn would deal 140 instead of 220 if it saw them.
    for (const text of CLAUSES) {
      expect(deriveAttackEffect(text)).toBeNull();
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
    }
  });

  it("Scovillain's index-0 Hot Bite is a BUILT setter and not this family", () => {
    // The index-keyed case with a twist the rest of the cast cannot give: index 0
    // derives to a real op, so this card is simulated on BOTH indices for two
    // DIFFERENT reasons. A card-keyed (rather than index-keyed) lookup would hand
    // one attack the other's meaning and nothing would look wrong.
    const hotBite = FIXTURE_POOL["sv01-029"]?.attacks?.[0]?.effect ?? "";
    expect(hotBite).toBe(HOT_BITE);
    expect(deriveAttackEffect(hotBite)).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
    ]);
    expect(deriveAttackDamageBonus(hotBite)).toBeNull();
    expect(deriveAttackDamageMultiplier(hotBite)).toBeNull();
    // Index 1, off the same card, is owned by the scaling deriver alone.
    expect(deriveAttackDamageBonus(FIXTURE_POOL["sv01-029"]?.attacks?.[1]?.effect ?? "")).toEqual({
      per: 90,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "Fire" },
      },
    });
  });

  it("Cetitan's index-0 Icicle Missile has NO effect text at all", () => {
    // The other index-keyed negative, and the reason the fixture omits the key
    // rather than carrying "": `undefined` and "" travel different paths through
    // the pipeline, and the printed row genuinely has no rules text. Every deriver
    // sees the empty string here and must decline — including the scaling one,
    // whose sibling clause sits one index away.
    expect(FIXTURE_POOL["sv02-055"]?.attacks?.[0]?.effect).toBeUndefined();
    expect(deriveAttackDamageBonus("")).toBeNull();
    expect(deriveAttackDamageMultiplier("")).toBeNull();
    expect(deriveAttackEffect("")).toBeNull();
    expect(deriveAttackDamageBonus(FIXTURE_POOL["sv02-055"]?.attacks?.[1]?.effect ?? "")).toEqual({
      per: 140,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "special" },
      },
    });
  });
});

describe("ZERO registry ATTACK rows — every damage number below is text", () => {
  it("gives none of the five ids an authored attack", () => {
    // The claim the header makes, asserted. attack.ts resolves an attack as
    // `programFor(id)?.attack?.[index] ?? derive`, so a single authored row would
    // WIN and every damage number below would keep passing while testing nothing
    // about the printed sentence. REGISTRY itself is not exported; `programFor` is
    // the only view of it, and `undefined` from it is exactly "no row for this id".
    for (const id of CARD_IDS) {
      expect(programFor(id)?.attack).toBeUndefined();
    }
    // Four of the five carry no row at ALL. Tinkaton is the exception and it is
    // worth being precise about: it holds an ABILITIES-only row (Gather Materials,
    // authored back in the payFromHand slice), which is a different key on the same
    // program and never consulted by the attack path. Asserted both ways so the
    // exception is documented rather than merely tolerated.
    for (const id of ["sv01-029", "sv01-202", "sv06.5-002", "sv02-055"] as const) {
      expect(programFor(id)).toBeUndefined();
    }
    expect(programFor("sv02-105")?.abilities).toHaveLength(1);
    // sv01-202 is Scovillain's second printing — byte-identical rules text, no
    // fixture of its own, equally rowless. Named in CARD_IDS so the pair stays
    // visible; the fixture the board layer runs is sv01-029.
    expect(CARD_IDS).toContain("sv01-202");
  });

  it("leaves Galvantula's 'Compound Eyes' Ability INERT — printed, not simulated", () => {
    // The fixture keeps the Ability verbatim because the printed card has it, and
    // this is the assertion that nothing acts on it: no registry row (above), and
    // no deriver reads ability text at ALL — only attack `effect` strings reach
    // `deriveAttackEffect`/`deriveAttackDamageBonus`. So Shocking Web's 50 is 50,
    // not 100, into an Active with an Ability, and the board layer below is
    // measuring the CLAUSE rather than the clause plus a silent aura.
    const compoundEyes = FIXTURE_POOL["sv06.5-002"]?.abilities?.[0];
    expect(compoundEyes?.name).toBe("Compound Eyes");
    expect(compoundEyes?.effect).toContain("do 50 more damage");
    expect(deriveAttackEffect(compoundEyes?.effect ?? "")).toBeNull();
    expect(deriveAttackDamageBonus(compoundEyes?.effect ?? "")).toBeNull();
    expect(deriveAttackDamageMultiplier(compoundEyes?.effect ?? "")).toBeNull();
  });
});

describe("Scovillain 'Super Spicy Breath' — the {R} clause on a {G} body", () => {
  it("with no Fire attached the printed 90 stands — and nothing is flagged", () => {
    const state = scovillain(board(1), "p1");
    // The paid cost is {G}{C}{C} and NONE of it provides Fire, which is the point
    // of paying symbol-for-symbol: a cost payment can never arm this clause.
    expect(state.players.p1.active?.energy.length).toBe(3);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    // The condition is FALSE and the "+" is still simulated: `effectSimulated` /
    // `modifierSimulated` ride `scaling !== null`, not on the clause holding.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 90, dealt: 90 });
    // `scaled` is omitted at 0 — the indicator genuinely added nothing.
    expect(dealt?.scaled).toBeUndefined();
  });

  it("adds the whole printed 90 with ONE Basic Fire attached → 180", () => {
    // "any" is `> 0`, not a count: one Energy is the whole bonus, and a second
    // would not change it (the indicator is 0-or-1 by construction).
    const state = attachFromDeck(scovillain(board(2), "p1"), "p1", "fix-fire-energy", 1);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 90, scaled: 90, dealt: 180 });
  });

  it("is the ATTACKER's own body — the same Fire on the DEFENDER scores nothing", () => {
    // THE seat asymmetry, and the case that catches a member wired to
    // `otherSeat(seat)`. The defender is a mirrored Scovillain carrying the very
    // Energy the clause names; a cross-board read would score 180 here.
    let state = scovillain(board(3), "p1");
    state = attachFromDeck(scovillain(state, "p2"), "p2", "fix-fire-energy", 1);
    expect(state.players.p2.active?.energy.length).toBe(4);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 90, dealt: 90 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("is the ACTIVE Spot — Fire on your own BENCH scores nothing", () => {
    // The other half of the scoping. `hasAttachedEnergy` is a per-Pokémon
    // predicate, so it happily answers TRUE for the benched body; it is
    // `conditionHolds` that pins the question to `players[seat].active`. Asserting
    // both is what separates "the predicate is wrong" from "the spot is wrong".
    let state = scovillain(board(4), "p1");
    const bench = state.players.p1.bench.length - 1;
    state = attachBenchFromDeck(state, "p1", bench, "fix-fire-energy", 1);
    const benched = state.players.p1.bench[bench];
    if (benched === undefined) throw new Error("expected a benched Pokémon");
    expect(hasAttachedEnergy(state, benched, "Fire")).toBe(true);
    expect(
      conditionHolds(state, "p1", { kind: "yourActiveHasEnergyAttached", energy: "Fire" }),
    ).toBe(false);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 90, dealt: 90 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("runs identically from the OTHER seat — seat-relativity, both directions", () => {
    // Nothing in this clause is p1-shaped: a hardcoded "p1" would read P1's
    // Fire-less Scovillain here and pay 90.
    const clean = scovillain(boardP2(5), "p2");
    const cleanDealt = find(
      mustApply(clean, { type: "attack", seat: "p2", index: 1 }).events,
      "DAMAGE_DEALT",
    );
    expect(cleanDealt).toMatchObject({ base: 90, dealt: 90 });
    expect(cleanDealt?.scaled).toBeUndefined();

    const armed = attachFromDeck(clean, "p2", "fix-fire-energy", 1);
    expect(
      find(mustApply(armed, { type: "attack", seat: "p2", index: 1 }).events, "DAMAGE_DEALT"),
    ).toMatchObject({ base: 90, scaled: 90, dealt: 180 });
  });

  it("keeps index 0 on its OWN meaning — Hot Bite burns and does not scale", () => {
    // The board half of the index-keyed case, on the one card in the cast whose
    // index 0 is BUILT: the same fielded Scovillain, with the clause's Fire
    // attached, runs index 0 for a flat 20 and a Burn. If index 1's clause leaked
    // onto the card rather than the index, this would deal 110.
    const state = attachFromDeck(scovillain(board(6), "p1"), "p1", "fix-fire-energy", 1);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 20, dealt: 20 });
    expect(dealt?.scaled).toBeUndefined();
    expect(find(events, "STATUS_APPLIED")).toMatchObject({ seat: "p2", status: "burned" });
  });
});

describe("Galvantula 'Shocking Web' — the {L} clause, a second token at a second N", () => {
  it("with no Lightning attached the printed 50 stands", () => {
    const state = galvantula(board(10), "p1");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 50, dealt: 50 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("adds the whole printed 80 with a Basic Lightning attached → 130", () => {
    const state = attachFromDeck(galvantula(board(11), "p1"), "p1", "fix-lightning-energy", 1);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 50, scaled: 80, dealt: 130 });
  });

  it("reads its OWN token — Scovillain's Fire does not arm Galvantula's {L}", () => {
    // THE case that separates a parameterised member from a boolean "has any
    // Energy attached": the wrong TYPE is as false as no Energy at all. Galvantula
    // is fielded with a Fire (which pays nothing here and arms nothing) and still
    // deals the printed 50.
    const state = attachFromDeck(galvantula(board(12), "p1"), "p1", "fix-fire-energy", 1);
    expect(state.players.p1.active?.energy.length).toBe(3);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 50, dealt: 50 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("runs from the OTHER seat too", () => {
    const armed = attachFromDeck(galvantula(boardP2(13), "p2"), "p2", "fix-lightning-energy", 1);
    expect(
      find(mustApply(armed, { type: "attack", seat: "p2", index: 0 }).events, "DAMAGE_DEALT"),
    ).toMatchObject({ base: 50, scaled: 80, dealt: 130 });
  });
});

describe("Cetitan 'Special Horn' / Tinkaton 'Special Hammer' — the CLASS arm", () => {
  it("Cetitan: no Special attached → the printed 80", () => {
    // The cost is three BASIC Energy, so this is the control that proves the class
    // clause is not simply "has any Energy attached".
    const state = cetitan(board(20), "p1");
    expect(state.players.p1.active?.energy.length).toBe(3);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 80, dealt: 80 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("Cetitan: one Jet Energy → 220, the family's largest printed swing", () => {
    // Jet is a plain non-wildcard Special providing {C}, which is exactly why it is
    // the CLASS arm's cleanest witness: it provides no Water at all, so nothing
    // about the cost changed — only the card class of one attached Energy.
    const state = attachFromDeck(cetitan(board(21), "p1"), "p1", "sv02-190", 1);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 80, scaled: 140, dealt: 220 });
    // 220 through a 200 HP fix-bigbody: the KO is reported for completeness, not as
    // the proof — the proof is `scaled`.
    expect(types(events)).toContain("KNOCKED_OUT");
  });

  it("Tinkaton: no Special → 90, one Luminous → 180", () => {
    // The same clause at a different N on the cast's only Stage 2. Luminous is a
    // WILDCARD, but the class arm never asks what it provides — only whether it is
    // a Special Energy card — so it counts here for a completely different reason
    // than it counts in the provision case below.
    const clean = tinkaton(board(22), "p1");
    const cleanDealt = find(
      mustApply(clean, { type: "attack", seat: "p1", index: 0 }).events,
      "DAMAGE_DEALT",
    );
    expect(cleanDealt).toMatchObject({ base: 90, dealt: 90 });
    expect(cleanDealt?.scaled).toBeUndefined();

    const armed = attachFromDeck(clean, "p1", "sv02-191", 1);
    expect(
      find(mustApply(armed, { type: "attack", seat: "p1", index: 0 }).events, "DAMAGE_DEALT"),
    ).toMatchObject({ base: 90, scaled: 90, dealt: 180 });
  });

  it("Cetitan: the DEFENDER's Special scores nothing, from either seat", () => {
    // The seat asymmetry for the class arm — mirrored so neither direction is a
    // p1 accident.
    let state = cetitan(board(23), "p1");
    state = attachFromDeck(cetitan(state, "p2"), "p2", "sv02-190", 1);
    const dealt = find(
      mustApply(state, { type: "attack", seat: "p1", index: 1 }).events,
      "DAMAGE_DEALT",
    );
    expect(dealt).toMatchObject({ base: 80, dealt: 80 });
    expect(dealt?.scaled).toBeUndefined();

    const mirrored = attachFromDeck(cetitan(cetitan(boardP2(24), "p2"), "p1"), "p1", "sv02-190", 1);
    const mirroredDealt = find(
      mustApply(mirrored, { type: "attack", seat: "p2", index: 1 }).events,
      "DAMAGE_DEALT",
    );
    expect(mirroredDealt).toMatchObject({ base: 80, dealt: 80 });
    expect(mirroredDealt?.scaled).toBeUndefined();
  });

  it("Cetitan: index-0 Icicle Missile is a flat 50 and stays SILENT", () => {
    // The board half of the effect-less negative: an attack with no rules text is
    // fully simulated (there is nothing to skip), so a bare DAMAGE_DEALT with no
    // `scaled` is the whole event story.
    const state = attachFromDeck(cetitan(board(25), "p1"), "p1", "sv02-190", 1);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 50, dealt: 50 });
    expect(dealt?.scaled).toBeUndefined();
  });
});

describe("PROVISION, not the printed name — the Luminous/Jet pair", () => {
  it("a wildcard Luminous ALONE satisfies {R} on Scovillain → 180", () => {
    // THE case of this slice. Luminous Energy is not a Fire card and its name says
    // nothing about Fire; it PROVIDES every type while it is the only Special on
    // its host, and `hasAttachedEnergy` asks provision (`providesEnergyType`) —
    // the same question §8.2's cost check asks. A name-matching implementation
    // deals 90 here.
    //
    // The board is built minimally on purpose: {G} + {C} + Luminous is exactly
    // three Energy for a {G}{C}{C} cost, so there is no spare card to hide behind.
    let state = setActiveFromDeck(board(30), "p1", "sv01-029");
    state = pay(state, "p1", [
      ["fix-grass-energy", 1],
      ["fix-energy", 1],
      ["sv02-191", 1],
    ]);
    expect(state.players.p1.active?.energy.length).toBe(3);
    // The COST is asserted, not dodged: the HUD's own `playable` flag runs the
    // real `costMet` over `effectiveAttackCost`, so this says "Super Spicy Breath
    // is payable on this exact board" rather than trusting that mustApply's
    // silence meant the same thing.
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(phase.attacks[1]).toMatchObject({ name: "Super Spicy Breath", playable: true });

    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 90, scaled: 90, dealt: 180 });
  });

  it("…and a second Special DEMOTES it, so the SAME board scores 90 again", () => {
    // Provision is read on the HOST, so the answer genuinely moves with the board:
    // attaching Jet demotes Luminous to {C} and it stops being a {R} Energy at all.
    // Nothing else changed — no card left, no counter moved, the attacker is the
    // same Pokémon — and the bonus is gone. Only a provision-based read behaves
    // this way; a "was a Luminous ever attached" read cannot.
    //
    // The cost stays MET across the demotion (a fourth Energy joined and {G} still
    // pays {G}), which is asserted rather than assumed: if the demotion had made
    // the attack unpayable, the 90 below would be a rejection dressed as a result.
    let state = setActiveFromDeck(board(31), "p1", "sv01-029");
    state = pay(state, "p1", [
      ["fix-grass-energy", 1],
      ["fix-energy", 1],
      ["sv02-191", 1],
    ]);
    const before = mustApply(state, { type: "attack", seat: "p1", index: 1 }).events;
    expect(find(before, "DAMAGE_DEALT")).toMatchObject({ base: 90, scaled: 90, dealt: 180 });

    const demoted = attachFromDeck(state, "p1", "sv02-190", 1);
    expect(demoted.players.p1.active?.energy.length).toBe(4);
    const phase = redactGame(demoted, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(phase.attacks[1]).toMatchObject({ name: "Super Spicy Breath", playable: true });

    const { events } = mustApply(demoted, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 90, dealt: 90 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("THE TWO AXES on one board: the TYPE clause is false while the CLASS clause is true", () => {
    // The Luminous+Jet board again, read both ways. Luminous is demoted, so it
    // provides no Fire and the {R} clause is FALSE; both cards are still Special
    // Energy, so the class clause is TRUE. If `"special"` had been modelled as a
    // tenth energy TYPE the two reads could not disagree, and this board is where
    // that shows.
    let state = setActiveFromDeck(board(32), "p1", "sv01-029");
    state = pay(state, "p1", [
      ["fix-grass-energy", 1],
      ["fix-energy", 1],
      ["sv02-191", 1],
      ["sv02-190", 1],
    ]);
    expect(
      conditionHolds(state, "p1", { kind: "yourActiveHasEnergyAttached", energy: "Fire" }),
    ).toBe(false);
    expect(
      conditionHolds(state, "p1", { kind: "yourActiveHasEnergyAttached", energy: "special" }),
    ).toBe(true);
    // Colorless is not in the vocabulary at all, but the demoted Luminous DOES
    // provide it — which is precisely why {C} is refused by the parser: this board
    // would otherwise match a clause nobody meant.
    expect(
      conditionHolds(state, "p1", { kind: "yourActiveHasEnergyAttached", energy: "Grass" }),
    ).toBe(true); // the real Basic {G} that pays the cost
  });

  it("…and the class arm PAYS on that exact shape: Cetitan 80 → 220", () => {
    // The same Luminous+Jet pair under a card whose clause reads the CLASS. Two
    // Specials, one demoted, and the bonus lands in full — the mirror image of the
    // Scovillain half above, on the same energy shape.
    let state = setActiveFromDeck(board(33), "p1", "sv02-055");
    state = pay(state, "p1", [
      ["fix-water-energy", 2],
      ["sv02-191", 1],
      ["sv02-190", 1],
    ]);
    expect(
      conditionHolds(state, "p1", { kind: "yourActiveHasEnergyAttached", energy: "Fire" }),
    ).toBe(false);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 80, scaled: 140, dealt: 220 });
  });
});

describe("the fold order — the bonus lands BEFORE §8.5 Weakness", () => {
  it("doubles (base + scaled), not base alone: (90 + 90) × 2 = 360", () => {
    // Tinkaton is a Psychic Pokémon (the multiplier reads the ATTACKING Pokémon's
    // type, not its attack cost) and fix-psychic-weak is ×2 Psychic, so the whole
    // folded number is what doubles. A fold placed AFTER Weakness would give
    // 90 × 2 + 90 = 270.
    let state = setActiveFromDeck(board(40), "p2", "fix-psychic-weak");
    state = attachFromDeck(tinkaton(state, "p1"), "p1", "sv02-190", 1);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      base: 90,
      scaled: 90,
      weakness: { op: "multiply", amount: 2 },
      resistance: null,
      dealt: 360,
    });
  });

  it("and the un-bonused control on the same matchup: 90 × 2 = 180", () => {
    // Same Weakness, no Special attached — so the 180 of difference above is the
    // bonus being doubled and nothing else. 180 through a 200 HP body also leaves
    // it alive, which the armed half does not.
    const state = tinkaton(setActiveFromDeck(board(41), "p2", "fix-psychic-weak"), "p1");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 90, weakness: { op: "multiply", amount: 2 }, dealt: 180 });
    expect(dealt?.scaled).toBeUndefined();
    expect(types(events)).not.toContain("KNOCKED_OUT");
  });
});

describe("ATTACK_EFFECT_SKIPPED never fires — in EITHER direction, on all four cards", () => {
  it("simulates the sentence whether or not the clause holds", () => {
    // The point of the whole family: before D115 every leading-`If` print fell onto
    // the loud skipped path with its "+" marker unsimulated. Now the flag rides
    // `scaling !== null` — the sentence being RECOGNISED — so a false clause is a
    // simulated 0, not an unsimulated unknown. Asserted for the true AND the false
    // board of each card, because a flag wired to the clause's VALUE instead of its
    // recognition would only show up on one of the two.
    const cases: { build: (seed: number) => GameState; index: number; arm: boolean }[] = [
      { build: (s) => scovillain(board(s), "p1"), index: 1, arm: false },
      {
        build: (s) => attachFromDeck(scovillain(board(s), "p1"), "p1", "fix-fire-energy", 1),
        index: 1,
        arm: true,
      },
      { build: (s) => galvantula(board(s), "p1"), index: 0, arm: false },
      {
        build: (s) => attachFromDeck(galvantula(board(s), "p1"), "p1", "fix-lightning-energy", 1),
        index: 0,
        arm: true,
      },
      { build: (s) => cetitan(board(s), "p1"), index: 1, arm: false },
      {
        build: (s) => attachFromDeck(cetitan(board(s), "p1"), "p1", "sv02-190", 1),
        index: 1,
        arm: true,
      },
      { build: (s) => tinkaton(board(s), "p1"), index: 0, arm: false },
      {
        build: (s) => attachFromDeck(tinkaton(board(s), "p1"), "p1", "sv02-191", 1),
        index: 0,
        arm: true,
      },
    ];
    for (const [i, { build, index, arm }] of cases.entries()) {
      const { events } = mustApply(build(50 + i), { type: "attack", seat: "p1", index });
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      // And the two boards really are different boards — `scaled` present exactly
      // when the clause held, which is what makes the shared flag meaningful.
      expect(find(events, "DAMAGE_DEALT")?.scaled !== undefined).toBe(arm);
    }
  });
});

describe("conditionHolds / conditionNote — the parameterised member, directly", () => {
  it("is OWN-side and per seat, on both parameter shapes", () => {
    const clean = board(60); // both Actives are the Energy-free fix-bigbody
    for (const energy of ["Fire", "special"] as const) {
      expect(conditionHolds(clean, "p1", { kind: "yourActiveHasEnergyAttached", energy })).toBe(
        false,
      );
      expect(conditionHolds(clean, "p2", { kind: "yourActiveHasEnergyAttached", energy })).toBe(
        false,
      );
    }

    // A Basic Fire on P1's Active is P1's OWN condition and nobody else's — the
    // case that catches a member wired to `otherSeat`.
    const fire = attachFromDeck(clean, "p1", "fix-fire-energy", 1);
    expect(
      conditionHolds(fire, "p1", { kind: "yourActiveHasEnergyAttached", energy: "Fire" }),
    ).toBe(true);
    expect(
      conditionHolds(fire, "p2", { kind: "yourActiveHasEnergyAttached", energy: "Fire" }),
    ).toBe(false);
    // A Basic is not a Special, so the class arm stays false on the same board —
    // the two axes are independent, not two spellings of one read.
    expect(
      conditionHolds(fire, "p1", { kind: "yourActiveHasEnergyAttached", energy: "special" }),
    ).toBe(false);
    // …and the wrong TYPE is as false as no Energy at all.
    expect(
      conditionHolds(fire, "p1", { kind: "yourActiveHasEnergyAttached", energy: "Lightning" }),
    ).toBe(false);

    // Mirrored onto the other seat — nothing here is p1-shaped.
    const mirrored = attachFromDeck(clean, "p2", "fix-fire-energy", 1);
    expect(
      conditionHolds(mirrored, "p2", { kind: "yourActiveHasEnergyAttached", energy: "Fire" }),
    ).toBe(true);
    expect(
      conditionHolds(mirrored, "p1", { kind: "yourActiveHasEnergyAttached", energy: "Fire" }),
    ).toBe(false);

    // The CLASS arm, both seats: an unauthored Special would answer the same way —
    // the read is `isSpecialEnergy`, not the registry.
    const jet = attachFromDeck(clean, "p1", "sv02-190", 1);
    expect(
      conditionHolds(jet, "p1", { kind: "yourActiveHasEnergyAttached", energy: "special" }),
    ).toBe(true);
    expect(
      conditionHolds(jet, "p2", { kind: "yourActiveHasEnergyAttached", energy: "special" }),
    ).toBe(false);
    // Jet provides {C} and nothing else, so no typed clause fires off it.
    for (const energy of BASIC_ENERGY_TYPES) {
      expect(conditionHolds(jet, "p1", { kind: "yourActiveHasEnergyAttached", energy })).toBe(
        false,
      );
    }
  });

  it("answers FALSE — not a throw — on an empty Active Spot, both arms", () => {
    // The live attack gate guarantees a Defending Pokémon, so no board reachable
    // through `attack` presents this; only a direct call (a play gate, or the HUD
    // rendering between a KO and the promote) finds it.
    const empty = clearActive(attachFromDeck(board(61), "p1", "fix-fire-energy", 1), "p1");
    expect(empty.players.p1.active).toBeNull();
    for (const energy of ["Fire", "special"] as const) {
      expect(conditionHolds(empty, "p1", { kind: "yourActiveHasEnergyAttached", energy })).toBe(
        false,
      );
    }
  });

  it("names both parameter shapes in the reject/tooltip vocabulary", () => {
    // The family's first note built from a PARAMETER rather than returned as a
    // literal, and nothing else in the suite would catch a typo in the copy — the
    // HUD renders these strings verbatim.
    expect(conditionNote({ kind: "yourActiveHasEnergyAttached", energy: "Fire" })).toBe(
      "your Active Pokémon has Fire Energy attached",
    );
    expect(conditionNote({ kind: "yourActiveHasEnergyAttached", energy: "special" })).toBe(
      "your Active Pokémon has a Special Energy attached",
    );
    // Every type produces a note, and every one of them is prose: the note reads
    // the spelled-out NAME even though the printed card said "{R}", because a
    // reject fragment is read by a human and half the pool prints it that way
    // anyway.
    for (const energy of BASIC_ENERGY_TYPES) {
      const note = conditionNote({ kind: "yourActiveHasEnergyAttached", energy });
      expect(note).toBe(`your Active Pokémon has ${energy} Energy attached`);
      expect(note).not.toContain("{");
    }
  });

  it("drops the printed pronoun — the note never says 'this Pokémon'", () => {
    // THE D116 rule, asserted where it is visible. The clause table resolved "this
    // Pokémon" to the attacker's Active; the note is read off the BOARD by a play
    // gate or a HUD tooltip, where there is no attack in flight and the pronoun has
    // no referent at all. So the note names the SPOT.
    const note = conditionNote({ kind: "yourActiveHasEnergyAttached", energy: "Fire" });
    expect(note).not.toContain("this Pokémon");
    expect(note).toContain("your Active Pokémon");
    // The printed sentences it came from DO say it — the two really do differ.
    for (const text of CLAUSES) expect(text).toContain("this Pokémon");
  });
});

describe("the family is PURE — a frozen board is never mutated", () => {
  it("resolves all four clauses, TRUE and FALSE, off a deep-frozen state", () => {
    // Strict mode turns any write to a frozen object into a throw, so a fold that
    // (say) memoised a provision lookup on the state would fail here and nowhere
    // else. The provision path is the one worth freezing: `unitsProvidedBy` walks
    // the host's whole attachment list on every read.
    const cases: { build: (seed: number) => GameState; index: number }[] = [
      { build: (s) => scovillain(board(s), "p1"), index: 1 },
      {
        build: (s) => attachFromDeck(scovillain(board(s), "p1"), "p1", "sv02-191", 1),
        index: 1,
      },
      { build: (s) => cetitan(board(s), "p1"), index: 1 },
      {
        build: (s) => attachFromDeck(cetitan(board(s), "p1"), "p1", "sv02-190", 1),
        index: 1,
      },
    ];
    for (const [i, { build, index }] of cases.entries()) {
      const state = deepFreeze(build(70 + i));
      expect(() => mustApply(state, { type: "attack", seat: "p1", index })).not.toThrow();
    }
  });

  it("conditionHolds itself is a pure read, both seats, both arms", () => {
    // The direct-call half: `conditionHolds` is the single evaluator behind the
    // attack fold, the play gate and the HUD, and the HUD calls it on every render
    // against state it does not own.
    const frozen = deepFreeze(
      attachFromDeck(attachFromDeck(board(80), "p1", "fix-fire-energy", 1), "p1", "sv02-190", 1),
    );
    for (const seat of ["p1", "p2"] as const) {
      for (const energy of ["Fire", "special"] as const) {
        expect(() =>
          conditionHolds(frozen, seat, { kind: "yourActiveHasEnergyAttached", energy }),
        ).not.toThrow();
      }
    }
    // Armed for P1 on both arms, false for P2 on both — the frozen board answers,
    // and answers seat-relatively.
    expect(
      conditionHolds(frozen, "p1", { kind: "yourActiveHasEnergyAttached", energy: "Fire" }),
    ).toBe(true);
    expect(
      conditionHolds(frozen, "p1", { kind: "yourActiveHasEnergyAttached", energy: "special" }),
    ).toBe(true);
    expect(
      conditionHolds(frozen, "p2", { kind: "yourActiveHasEnergyAttached", energy: "Fire" }),
    ).toBe(false);
    expect(
      conditionHolds(frozen, "p2", { kind: "yourActiveHasEnergyAttached", energy: "special" }),
    ).toBe(false);
  });
});
