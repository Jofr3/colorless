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
  CLAUSE_TABLE_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setConditions,
  types,
} from "./testFixtures";

// 0.67.0 → 0.68.0 — the THIRD wave of the conditional flat attack-damage bonus
// (D117): two more printed clauses onto D115's machinery, which is unchanged.
//
// D115 built the shape ("If <clause>, this attack does N more damage." → a 0-or-1
// INDICATOR folded through the existing additive `per × count`), D116 added the
// pronoun rule. This slice adds two more table rows and two new `BoardCondition`
// members — no new regex, no new arithmetic, no new event field:
//
//   • `yourActivePoisoned`     — Okidogi ex sv06.5-036 / -082 / -090
//                                "Chain-Crazed" (130+, +130). Three printings,
//                                byte-identical rules text, one fixture.
//   • `opponentActiveIsExOrV`  — Ceruledge sv02-098 "Fighting Sword" (100+,
//                                +100), the pool's only printing of the clause.
//
// Four printings across two distinct cards, on ZERO registry rows — both simulate
// straight off their printed sentence, which is why the verbatim guard below is
// load-bearing rather than decorative.
//
// THE TWO CALLS this suite exists to pin:
//
// 1. D116's PRONOUN rule, used a second time. Okidogi prints "this Pokémon is
//    Poisoned", and that pronoun is resolved to the ATTACKER'S ACTIVE in the
//    CLAUSE TABLE (effects.ts), not inside `conditionHolds`. The member is named
//    for what it READS — `yourActivePoisoned` — because `BoardCondition` is shared
//    with `trainerPlayableIf` (a play gate with no attack in flight) and with the
//    HUD, where a self-pronoun has no referent. The visible consequence, asserted
//    at the bottom of this file: the note says "your Active Pokémon", never "this
//    Pokémon". And the LEXICAL trap: Okidogi's clause and D116's Seviper sv01-128
//    clause are ONE POSSESSIVE apart and read OPPOSITE boards.
//
// 2. Ceruledge's clause is `isExOrV`, NOT `hasRuleBox`. The sentence names ex and
//    V and nothing else, so a VMAX Active does NOT satisfy it — the single case
//    that separates the two predicates, since every other rule-box body answers
//    both the same way.

/** The two printed sentences, pinned here and asserted char-for-char against
    FIXTURE_POOL below. These cards derive off text — neither carries a registry
    row (see the ZERO-rows block) — so the sentence IS the wiring: a drifted
    apostrophe or a lookalike é does not fail loudly, it silently un-simulates the
    card at the exact moment the clause would have paid off. */
const CHAIN_CRAZED = "If this Pokémon is Poisoned, this attack does 130 more damage.";
const FIGHTING_SWORD =
  "If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 100 more damage.";

/** The three companion sentences on the cast, each doing a specific job here:
    Okidogi's index 0 is the UNBUILT twin that must stay loud (and must not
    inherit index 1's clause), Ceruledge's index 0 is its own index-keyed
    negative, and Spit Poison is the only in-game route to a Poisoned OWN Active. */
const POISONOUS_MUSCULATURE =
  "Search your deck for up to 2 Basic {D} Energy cards and attach them to this Pokémon. Then, shuffle your deck. If you attached Energy to a Pokémon in this way, this Pokémon is now Poisoned.";
const LIFE_SUCKER = "Heal 30 damage from this Pokémon.";
const SPIT_POISON = "Your opponent's Active Pokémon is now Poisoned.";

const CLAUSES = [CHAIN_CRAZED, FIGHTING_SWORD];

/** Every id the two rows cover. Keyed by ID everywhere in this file on purpose:
    Okidogi ex is three printings of one rules text, and the pool holds a SECOND
    Seviper (sv02-137) whose clause is a different row entirely, so an assertion
    that went by `name` would be reading whichever card it happened to find. */
const CARD_IDS = ["sv06.5-036", "sv06.5-082", "sv06.5-090", "sv02-098"] as const;

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
    seed-independent, and here it is load-bearing twice over: CLAUSE_TABLE_DECK is
    Basic-dense, and two of those Basics (fix-pokemon-v, Okidogi ex) would SATISFY
    Ceruledge's clause on their own if one were dealt as the starter — an unpinned
    board could score +100 for a reason the test never named. fix-bigbody is
    simultaneously the arithmetically clean defender (Colorless, no Weakness, no
    Resistance, no rule box) every damage number below is measured against. Each
    displaced starter lands on its own bench. */
function board(seed: number): GameState {
  let state = driveSetup(seed, { p1: CLAUSE_TABLE_DECK, p2: CLAUSE_TABLE_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-bigbody");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return state;
}

/** `board`, then handed over to P2 — P1 passes into P2's turn 3, which is equally
    unrestricted. `yourActivePoisoned` is a SEAT-RELATIVE read of the attacker's
    OWN board, and a P1-only suite cannot tell "reads the attacker's side" apart
    from "reads p1's side". This is also the entry point for the armed-by-the-game
    case, where P2 has to move first. */
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

/** TEST SURGERY: empty `seat`'s Active Spot, parking its cards in the discard.
    The live attack gate guarantees a Defending Pokémon, so no board reachable
    through `attack` can present a null Active — only a direct `conditionHolds`
    call finds this edge, and both new members have to answer FALSE rather than
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

// ── The three casts, each fielded + paid symbol-for-symbol ───────────────────

/** Okidogi ex — {D}{D}{C} buys Chain-Crazed at index 1, and the same Energy
    covers Poisonous Musculature's bare {C} at index 0. */
function okidogi(state: GameState, seat: Seat): GameState {
  return pay(setActiveFromDeck(state, seat, "sv06.5-036"), seat, [
    ["fix-dark-energy", 2],
    ["fix-energy", 1],
  ]);
}

/** Ceruledge — {P}{C}{C} buys Fighting Sword at index 1. A Stage 1 (from
    Charcadet), so it is always force-placed onto the Active Spot. */
function ceruledge(state: GameState, seat: Seat): GameState {
  return pay(setActiveFromDeck(state, seat, "sv02-098"), seat, [
    ["fix-psychic-energy", 1],
    ["fix-energy", 2],
  ]);
}

/** Seviper sv01-128 — a bare {D} buys Spit Poison at index 0, which is all this
    suite wants from it: it is the POISON SOURCE, not a subject. */
function seviper(state: GameState, seat: Seat): GameState {
  return pay(setActiveFromDeck(state, seat, "sv01-128"), seat, [["fix-dark-energy", 1]]);
}

describe("the printed sentences — the fixture-text-verbatim guard", () => {
  it("matches FIXTURE_POOL char-for-char on both cards", () => {
    // These cards derive off text, so this is not decoration: it is the assertion
    // that the fixture row and the clause TABLE still agree on every byte. A
    // one-character drift here does not throw — it drops the card back onto the
    // loud ATTACK_EFFECT_SKIPPED path and silently stops paying the bonus.
    expect(FIXTURE_POOL["sv06.5-036"]?.attacks?.[1]?.effect).toBe(CHAIN_CRAZED);
    expect(FIXTURE_POOL["sv02-098"]?.attacks?.[1]?.effect).toBe(FIGHTING_SWORD);
    // The printed "+" markers, which are what tell the pipeline a scaling clause
    // is expected at all — and the printed BASE the fold starts from.
    expect(FIXTURE_POOL["sv06.5-036"]?.attacks?.[1]?.damage).toBe("130+");
    expect(FIXTURE_POOL["sv02-098"]?.attacks?.[1]?.damage).toBe("100+");
    // Names, so a re-ingest that reshuffled the attack order fails HERE rather
    // than as a mystery damage number three describes down.
    expect(FIXTURE_POOL["sv06.5-036"]?.attacks?.[1]?.name).toBe("Chain-Crazed");
    expect(FIXTURE_POOL["sv02-098"]?.attacks?.[1]?.name).toBe("Fighting Sword");
  });

  it("matches the companion sentences too — they carry the suite's controls", () => {
    // Okidogi's index 0 is the UNBUILT sentence that keeps the card's loud row (and
    // must not inherit index 1's clause); Ceruledge's index 0 is its own
    // index-keyed negative; Spit Poison, on the OTHER seat, is the only in-game
    // route to a Poisoned own Active. All three would break a case silently.
    expect(FIXTURE_POOL["sv06.5-036"]?.attacks?.[0]?.effect).toBe(POISONOUS_MUSCULATURE);
    expect(FIXTURE_POOL["sv02-098"]?.attacks?.[0]?.effect).toBe(LIFE_SUCKER);
    expect(FIXTURE_POOL["sv01-128"]?.attacks?.[0]?.effect).toBe(SPIT_POISON);
    // Poisonous Musculature omits `damage` ENTIRELY (not an empty string), so the
    // loud-row case below reads a no-damage attack; Life Sucker prints a flat 50
    // with no "+", so it is not this family at all.
    expect(FIXTURE_POOL["sv06.5-036"]?.attacks?.[0]?.damage).toBeUndefined();
    expect(FIXTURE_POOL["sv02-098"]?.attacks?.[0]?.damage).toBe(50);
    expect(FIXTURE_POOL["sv01-128"]?.attacks?.[0]?.damage).toBeUndefined();
  });

  it("keeps the fixture facts the damage arithmetic below is measured against", () => {
    // Every number in the board layer is (HP, type, Weakness) arithmetic off these
    // four rows. Pinned here so a fixture edit that moves 520 to 390 fails with a
    // sentence about Weakness rather than with a bare numeric mismatch.
    expect(FIXTURE_POOL["sv06.5-036"]?.name).toBe("Okidogi ex"); // an `isExOrV` body
    expect(FIXTURE_POOL["sv06.5-036"]?.hp).toBe(250);
    expect(FIXTURE_POOL["sv06.5-036"]?.types).toEqual(["Darkness"]);
    expect(FIXTURE_POOL["sv02-098"]?.hp).toBe(140);
    expect(FIXTURE_POOL["sv02-098"]?.types).toEqual(["Psychic"]);
    expect(FIXTURE_POOL["sv02-098"]?.weaknesses).toEqual([{ type: "Darkness", value: "×2" }]);
    // The two rule-box bodies the printed reading has to tell apart, and the
    // NEITHER body every control lands on. `isExOrV` is name-derived, so the names
    // are the datum.
    expect(FIXTURE_POOL["fix-pokemon-v"]?.name).toBe("Fixmon V");
    expect(FIXTURE_POOL["fix-pokemon-vmax"]?.name).toBe("Fixmon VMAX");
    expect(FIXTURE_POOL["fix-bigbody"]?.name).toBe("fix-bigbody");
    expect(FIXTURE_POOL["fix-bigbody"]?.hp).toBe(200);
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
      // the claim covers all of them, not just the first. (Only Fighting Sword
      // prints one, in "opponent's".)
      for (const ch of text) {
        if (ch === "'" || ch === CURLY_APOSTROPHE) expect(ch.codePointAt(0)).toBe(0x27);
      }
      // Every `Pokémon` spells its accent as the precomposed U+00E9: the two
      // split counts can only agree if no other spelling of it occurs.
      expect(text.split("Pok\u00e9mon").length).toBe(text.split("Pok").length);
    }
    expect(FIGHTING_SWORD).toContain("opponent's");
  });

  it("pins each clause's UTF-8 byte length", () => {
    // The e-acute is the one character that changes the BYTE length without
    // changing the visible one, so the encoded length is the single number that
    // catches a decomposition drift on its own.
    expect(utf8Bytes(CHAIN_CRAZED)).toBe(63);
    expect(utf8Bytes(FIGHTING_SWORD)).toBe(100);
    // And the invariant behind those two constants: each clause is exactly one
    // byte over its character count PER "Pokémon" it prints — one precomposed
    // U+00E9 each (2 bytes), every other character ASCII. Chain-Crazed says it
    // once (62 chars / 63 bytes), Fighting Sword three times (97 / 100). A
    // decomposed accent adds a character AND a byte; a curly apostrophe keeps the
    // character count and adds two. Neither survives this equality.
    for (const text of CLAUSES) {
      const accents = text.split("Pok\u00e9mon").length - 1;
      expect(utf8Bytes(text)).toBe(text.length + accents);
    }
    expect(CHAIN_CRAZED.split("Pok\u00e9mon").length - 1).toBe(1);
    expect(FIGHTING_SWORD.split("Pok\u00e9mon").length - 1).toBe(3);
  });
});

describe("deriveAttackDamageBonus — the two NEW clauses", () => {
  it("reads Chain-Crazed as yourActivePoisoned — the printed pronoun, resolved in the TABLE", () => {
    // "this Pokémon" is resolved to the ATTACKER'S ACTIVE by the clause table, so
    // the member that comes out is named for what it reads, not for how it was
    // printed. That is D116's rule, used a second time (see the header).
    expect(deriveAttackDamageBonus(CHAIN_CRAZED)).toEqual({
      per: 130,
      count: { kind: "boardCondition", cond: { kind: "yourActivePoisoned" } },
    });
  });

  it("reads Fighting Sword as opponentActiveIsExOrV", () => {
    expect(deriveAttackDamageBonus(FIGHTING_SWORD)).toEqual({
      per: 100,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveIsExOrV" } },
    });
  });

  it("captures the N from the SENTENCE — the row carries the condition, never the amount", () => {
    // A CONSTRUCTED probe (no card in the pool prints "+40" off this clause): the
    // same table row at a different printed amount. Nothing may key the amount off
    // the condition, which is what lets one row serve a future reprint at another
    // number — exactly as D116's damage-counter row serves +90 and +60.
    const forty = deriveAttackDamageBonus(
      "If this Pokémon is Poisoned, this attack does 40 more damage.",
    );
    expect(forty).toEqual({
      per: 40,
      count: { kind: "boardCondition", cond: { kind: "yourActivePoisoned" } },
    });
    expect(forty?.count).toEqual(deriveAttackDamageBonus(CHAIN_CRAZED)?.count);
    expect(forty?.per).not.toBe(deriveAttackDamageBonus(CHAIN_CRAZED)?.per);
  });

  it("keeps the POSSESSIVE discriminator, run both ways — one pronoun apart, opposite boards", () => {
    // THE lexical trap of this slice. Okidogi's clause and D116's Seviper sv01-128
    // clause are the same English sentence but for "this Pokémon" / "your
    // opponent's Active Pokémon", and they read OPPOSITE sides of the table. A row
    // keyed loosely enough to swallow both would score Chain-Crazed's +130 off the
    // DEFENDER's Poison — which the board layer below proves it does not.
    expect(deriveAttackDamageBonus(CHAIN_CRAZED)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "yourActivePoisoned" },
    });
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is Poisoned, this attack does 120 more damage.",
      )?.count,
    ).toEqual({ kind: "boardCondition", cond: { kind: "opponentActivePoisoned" } });
    // And the two really are distinct members, not one member reached twice.
    expect(deriveAttackDamageBonus(CHAIN_CRAZED)?.count).not.toEqual(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is Poisoned, this attack does 120 more damage.",
      )?.count,
    );
  });
});

describe("deriveAttackDamageBonus — the near-misses that stay UNMAPPED (and therefore LOUD)", () => {
  it("refuses a VMAX / VSTAR rule-box clause — the row is isExOrV, not hasRuleBox", () => {
    // CONSTRUCTED probes: the pool prints neither sentence. They exist because the
    // difference between `isExOrV` and `hasRuleBox` is invisible on every board
    // except a VMAX/VSTAR one, and because a table row that matched "is a Pokémon
    // <rule box>" loosely would map both. Only the exact printed enumeration
    // "Pokémon ex or Pokémon V" is a row; anything else falls through to null and
    // stays on the loud ATTACK_EFFECT_SKIPPED path.
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a Pokémon VMAX, this attack does 100 more damage.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a Pokémon ex or Pokémon VSTAR, this attack does 100 more damage.",
      ),
    ).toBeNull();
    // The real row, on the same board shape — so the three assertions above are a
    // discrimination and not a broken deriver.
    expect(deriveAttackDamageBonus(FIGHTING_SWORD)).not.toBeNull();
  });

  it("refuses Lokix's evolved-this-turn clause — a well-formed sentence, an unmapped condition", () => {
    // Lokix sv02-021 "Assaulting Kick", printed text (verified verbatim against
    // the local D1 — the attack's NAME is "Assaulting Kick", not "Bug Bite").
    // The sentence matches the family's
    // shape perfectly; only the CLAUSE misses the table, which is exactly the
    // fall-through the `Map.get` guard exists to protect. It needs cross-turn
    // state nothing on the model carries yet, so it will stay unmapped a while.
    //
    // (This case used to point at Sylveon swsh10.5-035's Dragon clause, which
    // D120 mapped via the type TEMPLATE — re-pointed rather than deleted, since
    // the fall-through needs a live witness.)
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon evolved from Nymble during this turn, this attack does 100 more damage.",
      ),
    ).toBeNull();
  });

  it("holds the whole-sentence ANCHOR on Chain-Crazed — case, period and both margins", () => {
    // The four ways a real print differs from this family while still containing
    // its words. Each must stay null: an unrecognised sentence is LOUD, and a
    // deriver that shrugged off the anchor would score +130 for text it never
    // actually read (the trailing-clause probe carries a whole extra effect).
    expect(
      deriveAttackDamageBonus("if this Pokémon is Poisoned, this attack does 130 more damage."),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus("If this Pokémon is Poisoned, this attack does 130 more damage"),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon is Poisoned, this attack does 130 more damage. Then, discard an Energy from it.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "During your turn, if this Pokémon is Poisoned, this attack does 130 more damage.",
      ),
    ).toBeNull();
    // A printed 0 is the family's own guard, not an anchor one: it parses and is
    // then REFUSED, because a bonus that adds nothing must stay loud rather than
    // claim to be simulated.
    expect(
      deriveAttackDamageBonus("If this Pokémon is Poisoned, this attack does 0 more damage."),
    ).toBeNull();
  });

  it("deriveAttackDamageMultiplier refuses both — the no-'more' twin owns nothing here", () => {
    // Both clauses print "more", so both are additive by construction; the
    // multiply reader (which DROPS the printed base rather than adding to it) must
    // not see either, or Chain-Crazed would deal 130 instead of 260.
    for (const text of CLAUSES) {
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
    }
  });
});

describe("the two derivers stay disjoint, and stay INDEX-KEYED", () => {
  it("deriveAttackEffect matches neither clause sentence", () => {
    // The op deriver reads sentences that run AFTER damage; this family folds
    // BEFORE the §8.5 pipeline. No printed text may derive down both paths, or the
    // same sentence would be paid for twice.
    for (const text of CLAUSES) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("Okidogi's index-0 is OWNED BY THE OP DERIVER ALONE — and index 1 does not inherit it", () => {
    // ⚠️⚠️ D235 — THIS CASE USED TO ASSERT AN ABSENCE, AND THE ABSENCE EXPIRED.
    // "Poisonous Musculature" is a deck search + an attach + a shuffle + a
    // CONDITIONAL self-Poison in one sentence pair, and for 100-odd decisions no
    // deriver owned that shape. It is backlog row 10's §9.2-tail sentence —
    // `sv06.5-036`/`-082`/`-090`, 3 legal printings — and D235's anchor reads it.
    // **RE-HOMED RATHER THAN DELETED** (`revealBottom.test.ts`'s D232 precedent):
    // the assertion now names the PROGRAM the sentence reaches instead of
    // asserting there is none, so it still fails if this attack ever inherits
    // index 1's meaning.
    //
    // 🛑 AND IT IS THE ONLY REAL PRINTING OF ITS FAMILY ALREADY IN THIS POOL,
    // which makes it the one card in D235 whose evidence is a catalog row rather
    // than a synthetic demonstrator. The whole slice was built and tested against
    // `fix-trainerops`; this card is what proves the strings were not a
    // paraphrase (D183).
    //
    // It is also the sentence that would be most tempting to confuse with index
    // 1's: it ends in "this Pokémon is now Poisoned", one word away from the
    // clause the next attack READS. A card-keyed (rather than index-keyed) lookup
    // would hand one attack the other's meaning — so the two readers are asserted
    // DISJOINT on it, which is the half of this case that never depended on the
    // absence.
    const musculature = FIXTURE_POOL["sv06.5-036"]?.attacks?.[0]?.effect ?? "";
    const chainCrazed = FIXTURE_POOL["sv06.5-036"]?.attacks?.[1]?.effect ?? "";
    expect(musculature).toBe(POISONOUS_MUSCULATURE);
    expect(deriveAttackEffect(musculature)).toEqual([
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy", energyType: "Darkness" },
        max: 2,
        toSelf: true,
        recordAs: "moved",
      },
      { op: "shuffleDeck" },
      {
        op: "recordGate",
        slot: "moved",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "applyStatus", target: "self", status: "poisoned" }],
      },
    ]);
    // 🛑 THE SCALING DERIVERS ARE STILL SILENT ON IT, and that is now a statement
    // about which reader owns which sentence rather than about an absence —
    // exactly the shape Ceruledge's index-0 case one test down already had.
    expect(deriveAttackDamageBonus(musculature)).toBeNull();
    expect(deriveAttackDamageMultiplier(musculature)).toBeNull();
    // Index 1, off the same card, is fully owned by the scaling deriver alone.
    expect(deriveAttackDamageBonus(chainCrazed)).toEqual({
      per: 130,
      count: { kind: "boardCondition", cond: { kind: "yourActivePoisoned" } },
    });
    expect(deriveAttackEffect(chainCrazed)).toBeNull();
  });

  it("Ceruledge's index-0 heal is its own index-keyed negative", () => {
    // 0.83.0 (D132) MAPPED Life Sucker. This case used to record that "Heal N damage
    // from this Pokémon." derived to nothing at all — the op deriver owned only the
    // compound "This Pokémon is now Asleep. Heal {N} damage from it." — and it is
    // STRONGER now that the bare sentence has an anchor: index 0 derives a DIFFERENT
    // op rather than none, so the SCALING derivers being silent on it is a statement
    // about which reader owns which sentence, and not about an absence. (The heal's
    // own end-to-end account lives in selfHeal.test.ts; sv02-098 still carries no
    // registry row, so both readings come off the printed text.)
    const lifeSucker = FIXTURE_POOL["sv02-098"]?.attacks?.[0]?.effect ?? "";
    expect(lifeSucker).toBe(LIFE_SUCKER);
    expect(deriveAttackDamageBonus(lifeSucker)).toBeNull();
    expect(deriveAttackDamageMultiplier(lifeSucker)).toBeNull();
    expect(deriveAttackEffect(lifeSucker)).toEqual([{ op: "heal", target: "self", amount: 30 }]);
    expect(deriveAttackDamageBonus(FIXTURE_POOL["sv02-098"]?.attacks?.[1]?.effect ?? "")).toEqual({
      per: 100,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveIsExOrV" } },
    });
  });

  it("Spit Poison — the arming SETTER — derives as a PROGRAM, not as a clause", () => {
    // The other half of the disjointness, on the card that arms Okidogi's clause
    // from across the table: the setter is an op, the reader is a clause, and the
    // two never swap. (Its `target: "defender"` is why Seviper has to sit on the
    // OTHER seat to Poison Okidogi.)
    expect(deriveAttackEffect(SPIT_POISON)).toEqual([
      { op: "applyStatus", target: "defender", status: "poisoned" },
    ]);
    expect(deriveAttackDamageBonus(SPIT_POISON)).toBeNull();
  });
});

describe("ZERO registry rows — the whole slice is text", () => {
  it("gives none of the four ids a registry program", () => {
    // The claim the header makes, asserted. If any of these ever grows a row, the
    // registry would win (`programFor(id)?.attack?.[index] ?? derive`) and every
    // damage number below would keep passing while testing nothing about the text.
    // REGISTRY itself is not exported; `programFor` is the only view of it, and
    // `undefined` from it is exactly "no row for this id".
    for (const id of CARD_IDS) {
      expect(programFor(id)).toBeUndefined();
    }
    // -082 and -090 are Okidogi ex's other two printings — byte-identical rules
    // text, no fixture of their own, equally rowless. Named in CARD_IDS so the
    // trio stays visible; the fixture the board layer runs is -036.
    expect(CARD_IDS).toContain("sv06.5-082");
    expect(CARD_IDS).toContain("sv06.5-090");
  });
});

describe("Okidogi ex 'Chain-Crazed' — yourActivePoisoned, read off the ATTACKER's own body", () => {
  it("UNPOISONED the printed 130 stands — and nothing is flagged", () => {
    const state = okidogi(board(1), "p1");
    expect(state.players.p1.active?.conditions.poisonDamage).toBe(0);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    // The condition is FALSE and the "+" is still simulated: `effectSimulated` /
    // `modifierSimulated` ride `scaling !== null`, not on the clause holding.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 130, dealt: 130 });
    // `scaled` is omitted at 0 — the indicator genuinely added nothing.
    expect(dealt?.scaled).toBeUndefined();
  });

  it("adds the whole printed 130 once the attacker is Poisoned → 260", () => {
    // §12 stores Poison as the counter AMOUNT an effect may raise, so "is
    // Poisoned" is `poisonDamage > 0` — the same read the Checkup makes.
    const state = setConditions(okidogi(board(2), "p1"), "p1", { poisonDamage: 10 });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 130, scaled: 130, dealt: 260 });
  });

  it("is armed by the GAME, not by a surgery — P2's Spit Poison one turn, Chain-Crazed the next", () => {
    // THE case that matters most, and the one this deck exists for. Okidogi's OWN
    // self-Poison attack (index 0, "Poisonous Musculature") is UNBUILT, so there is
    // no way to Poison your own Active from your own side of the table — the only
    // honest route is the one the real game uses: the opponent Poisons you. P2's
    // Seviper sv01-128 does exactly that with a derived `applyStatus` op that deals
    // no damage of its own, and §13.1's Checkup then ticks it.
    //
    // The Poison damage is ASSERTED rather than dodged: one Checkup runs between
    // P2's attack and P1's, so Okidogi walks into its own attack on 10.
    let state = boardP2(3);
    state = okidogi(state, "p1");
    state = seviper(state, "p2");
    expect(state.players.p1.active?.conditions.poisonDamage).toBe(0);

    const poisonRun = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    // Spit Poison deals nothing itself — the only damage in its events is §13.1's.
    expect(find(poisonRun.events, "DAMAGE_DEALT")).toBeUndefined();
    expect(types(poisonRun.events)).toContain("COUNTERS_PLACED");
    state = poisonRun.state;
    expect(state.players.p1.active?.conditions.poisonDamage).toBe(10);
    expect(state.players.p1.active?.damage).toBe(10); // one Checkup tick
    expect(state.players.p2.active?.conditions.poisonDamage).toBe(0); // Seviper is clean

    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 130, scaled: 130, dealt: 260 });
    // Seviper is a 120 HP body, so 260 is lethal — and so would 130 have been.
    // The KO is reported for completeness, not as the proof; the proof is `scaled`.
    expect(types(events)).toContain("KNOCKED_OUT");
  });

  it("is the ATTACKER's side — Poison on the DEFENDER's Active scores nothing", () => {
    // THE seat asymmetry, and the case that catches a member wired to
    // `otherSeat(seat)`: the identical Poison, on the wrong side of the board. A
    // `yourActivePoisoned` that read across the table would be D116's
    // `opponentActivePoisoned` wearing this name, and would score 260 here.
    const state = setConditions(okidogi(board(4), "p1"), "p2", { poisonDamage: 10 });
    expect(state.players.p1.active?.conditions.poisonDamage).toBe(0);
    expect(state.players.p2.active?.conditions.poisonDamage).toBe(10);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 130, dealt: 130 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("runs identically from the OTHER seat — seat-relativity, both directions", () => {
    // The whole trio again with P2 attacking. Nothing in this clause is p1-shaped:
    // a hardcoded "p1" would read P1's unpoisoned Okidogi here and pay 130.
    const clean = okidogi(boardP2(5), "p2");
    const cleanEvents = mustApply(clean, { type: "attack", seat: "p2", index: 1 }).events;
    const cleanDealt = find(cleanEvents, "DAMAGE_DEALT");
    expect(cleanDealt).toMatchObject({ base: 130, dealt: 130 });
    expect(cleanDealt?.scaled).toBeUndefined();

    const poisoned = setConditions(clean, "p2", { poisonDamage: 10 });
    const poisonedEvents = mustApply(poisoned, { type: "attack", seat: "p2", index: 1 }).events;
    expect(find(poisonedEvents, "DAMAGE_DEALT")).toMatchObject({
      base: 130,
      scaled: 130,
      dealt: 260,
    });

    // And Poison on P2's OPPONENT (P1) still scores nothing, mirrored.
    const wrongSide = setConditions(clean, "p1", { poisonDamage: 10 });
    const wrongEvents = mustApply(wrongSide, { type: "attack", seat: "p2", index: 1 }).events;
    const wrongDealt = find(wrongEvents, "DAMAGE_DEALT");
    expect(wrongDealt).toMatchObject({ base: 130, dealt: 130 });
    expect(wrongDealt?.scaled).toBeUndefined();
  });

  it("runs index 0 as its OWN program — no DAMAGE_DEALT, and no clause inherited", () => {
    // ⚠️⚠️ D235 — THE BOARD HALF OF THE EXPIRED CONTROL, re-homed the same way.
    // This case asserted ATTACK_EFFECT_SKIPPED on index 0; D235 built the sentence,
    // so the flag is gone and the observable that MATTERS is kept: Chain-Crazed's
    // {D}{D}{C} covers Poisonous Musculature's bare {C}, so the same fielded
    // Okidogi runs both, and index 0 must still deal NO damage and carry NO
    // scaling. If index 1's clause ever leaked onto the card rather than the
    // index, index 0 would start dealing 130.
    const state = okidogi(board(6), "p1");
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    // The attack ran its own program instead: it either parked on WHICH {D}
    // Energy to take, or found none and finished. Both are this sentence's
    // behaviour and neither is index 1's.
    expect(state.players.p1.active?.conditions.poisonDamage).toBe(0);
    expect(after.players.p2.active?.damage).toBe(0);
  });
});

describe("Ceruledge 'Fighting Sword' — opponentActiveIsExOrV, ex and V and nothing else", () => {
  it("into a NON-rule-box body the printed 100 stands", () => {
    // fix-bigbody: 200 HP, Colorless, no Weakness, no Resistance, and — the part
    // that matters here — no suffix at all, so `pokemonSuffixOf` is null.
    const state = ceruledge(board(10), "p1");
    expect(state.players.p2.active).not.toBeNull();
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 100, dealt: 100 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("into a Pokémon ex it adds the whole 100 → 200", () => {
    // Okidogi ex is the cast's own ex body, which is why one deck can carry both
    // clauses. Ceruledge is Psychic and Okidogi's Weakness is Fighting, so the
    // 200 is the raw fold with no §8.5 multiplier in it.
    const state = setActiveFromDeck(ceruledge(board(11), "p1"), "p2", "sv06.5-036");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      base: 100,
      scaled: 100,
      weakness: null,
      dealt: 200,
    });
  });

  it("into a Pokémon V it adds the whole 100 too → 200", () => {
    // The other half of the printed enumeration. `isExOrV` reads the NAME suffix
    // ("Fixmon V"), so this and the ex case must agree exactly.
    const state = setActiveFromDeck(ceruledge(board(12), "p1"), "p2", "fix-pokemon-v");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 100, scaled: 100, dealt: 200 });
  });

  it("into a Pokémon VMAX it does NOT — isExOrV, not hasRuleBox", () => {
    // THE case of this describe. A VMAX has a Rule Box, so a `hasRuleBox` reading
    // would pay 200 here; the printed sentence names ex and V only, and
    // `pokemonSuffixOf` reads "Fixmon VMAX" as VMAX rather than as a space-then-V.
    // This is the ONLY board on which the two predicates disagree.
    const state = setActiveFromDeck(ceruledge(board(13), "p1"), "p2", "fix-pokemon-vmax");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 100, dealt: 100 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("runs from the OTHER seat too — the read follows the ATTACKER's opponent", () => {
    // Seat-relativity for the cross-board member: P2 attacks, so the ex body has to
    // be on P1 to count. The mirrored negative is the same ex body on P2's OWN side
    // — a member that read `seat` instead of `otherSeat(seat)` would score there.
    const armed = setActiveFromDeck(ceruledge(boardP2(14), "p2"), "p1", "fix-pokemon-v");
    const armedEvents = mustApply(armed, { type: "attack", seat: "p2", index: 1 }).events;
    expect(find(armedEvents, "DAMAGE_DEALT")).toMatchObject({
      base: 100,
      scaled: 100,
      dealt: 200,
    });

    // P2 attacks out of an ex/V-free board into a plain fix-bigbody: no bonus.
    const clean = ceruledge(boardP2(15), "p2");
    const cleanEvents = mustApply(clean, { type: "attack", seat: "p2", index: 1 }).events;
    const cleanDealt = find(cleanEvents, "DAMAGE_DEALT");
    expect(cleanDealt).toMatchObject({ base: 100, dealt: 100 });
    expect(cleanDealt?.scaled).toBeUndefined();
  });
});

describe("the fold order — the bonus lands BEFORE §8.5 Weakness", () => {
  it("doubles (base + scaled), not base alone: (130 + 130) × 2 = 520", () => {
    // Okidogi ex is a Darkness Pokémon (the multiplier reads the ATTACKING
    // Pokémon's type, not its attack cost) and Ceruledge is Weakness Darkness ×2,
    // so the whole folded number is what doubles. A fold placed AFTER Weakness
    // would give 130 × 2 + 130 = 390. Ceruledge's printed Fighting −30 Resistance
    // never fires: the attacker is not a Fighting Pokémon.
    const state = setConditions(
      setActiveFromDeck(okidogi(board(20), "p1"), "p2", "sv02-098"),
      "p1",
      { poisonDamage: 10 },
    );
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      base: 130,
      scaled: 130,
      weakness: { op: "multiply", amount: 2 },
      resistance: null,
      dealt: 520,
    });
  });

  it("and the un-bonused control on the same matchup: 130 × 2 = 260", () => {
    // Same Weakness, unpoisoned attacker — so the 260 of difference above is the
    // bonus being doubled and nothing else.
    const state = setActiveFromDeck(okidogi(board(21), "p1"), "p2", "sv02-098");
    expect(state.players.p1.active?.conditions.poisonDamage).toBe(0);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({
      base: 130,
      weakness: { op: "multiply", amount: 2 },
      dealt: 260,
    });
    expect(dealt?.scaled).toBeUndefined();
  });
});

describe("ATTACK_EFFECT_SKIPPED never fires — in EITHER direction", () => {
  it("simulates the sentence whether or not the clause holds, on both cards", () => {
    // The point of the whole family: before D115 every leading-`If` print fell onto
    // the loud skipped path with its "+" marker unsimulated. Now the flag rides
    // `scaling !== null` — the sentence being RECOGNISED — so a false clause is a
    // simulated 0, not an unsimulated unknown. Asserted for the true AND the false
    // board of each card, because a flag wired to the clause's VALUE instead of its
    // recognition would only show up on one of the two.
    const cases: { build: (seed: number) => GameState; arm: boolean }[] = [
      { build: (s) => okidogi(board(s), "p1"), arm: false },
      {
        build: (s) => setConditions(okidogi(board(s), "p1"), "p1", { poisonDamage: 10 }),
        arm: true,
      },
      { build: (s) => ceruledge(board(s), "p1"), arm: false },
      {
        build: (s) => setActiveFromDeck(ceruledge(board(s), "p1"), "p2", "fix-pokemon-v"),
        arm: true,
      },
    ];
    for (const [i, { build, arm }] of cases.entries()) {
      const { events } = mustApply(build(30 + i), { type: "attack", seat: "p1", index: 1 });
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      // And the two boards really are different boards — `scaled` present exactly
      // when the clause held, which is what makes the shared flag meaningful.
      expect(find(events, "DAMAGE_DEALT")?.scaled !== undefined).toBe(arm);
    }
  });
});

describe("conditionHolds / conditionNote — the two NEW members, directly", () => {
  it("yourActivePoisoned is OWN-side, per seat, and 0-exclusive", () => {
    const clean = board(40);
    expect(conditionHolds(clean, "p1", { kind: "yourActivePoisoned" })).toBe(false);
    expect(conditionHolds(clean, "p2", { kind: "yourActivePoisoned" })).toBe(false);

    // Poison on P1's Active is P1's OWN condition — the exact opposite scoping to
    // D116's `opponentActivePoisoned`, which the same board answers the other way.
    const poisoned = setConditions(clean, "p1", { poisonDamage: 10 });
    expect(conditionHolds(poisoned, "p1", { kind: "yourActivePoisoned" })).toBe(true);
    expect(conditionHolds(poisoned, "p2", { kind: "yourActivePoisoned" })).toBe(false);
    expect(conditionHolds(poisoned, "p2", { kind: "opponentActivePoisoned" })).toBe(true);
    expect(conditionHolds(poisoned, "p1", { kind: "opponentActivePoisoned" })).toBe(false);

    // Mirrored onto the other seat — nothing here is p1-shaped.
    const mirrored = setConditions(clean, "p2", { poisonDamage: 10 });
    expect(conditionHolds(mirrored, "p2", { kind: "yourActivePoisoned" })).toBe(true);
    expect(conditionHolds(mirrored, "p1", { kind: "yourActivePoisoned" })).toBe(false);

    // A raised counter amount is still just "Poisoned" — the read is `> 0`, not
    // `=== 10`, so a doubled-Poison board answers the same.
    expect(
      conditionHolds(setConditions(clean, "p1", { poisonDamage: 30 }), "p1", {
        kind: "yourActivePoisoned",
      }),
    ).toBe(true);

    // POISON specifically: another §12 condition on the same spot is not it.
    const asleep = setConditions(clean, "p1", { rotation: "asleep", burned: true });
    expect(conditionHolds(asleep, "p1", { kind: "yourActivePoisoned" })).toBe(false);

    // The empty-spot edge: FALSE, not a throw.
    const empty = clearActive(poisoned, "p1");
    expect(empty.players.p1.active).toBeNull();
    expect(conditionHolds(empty, "p1", { kind: "yourActivePoisoned" })).toBe(false);
  });

  it("opponentActiveIsExOrV is cross-board, per seat, and refuses VMAX", () => {
    const clean = board(41); // both Actives are the suffix-free fix-bigbody
    expect(conditionHolds(clean, "p1", { kind: "opponentActiveIsExOrV" })).toBe(false);
    expect(conditionHolds(clean, "p2", { kind: "opponentActiveIsExOrV" })).toBe(false);

    // Each rule-box body in the cast, read from BOTH seats: true only for the seat
    // whose OPPONENT is holding it.
    for (const id of ["sv06.5-036", "fix-pokemon-v"] as const) {
      const onP2 = setActiveFromDeck(clean, "p2", id);
      expect(conditionHolds(onP2, "p1", { kind: "opponentActiveIsExOrV" })).toBe(true);
      expect(conditionHolds(onP2, "p2", { kind: "opponentActiveIsExOrV" })).toBe(false);
      const onP1 = setActiveFromDeck(clean, "p1", id);
      expect(conditionHolds(onP1, "p2", { kind: "opponentActiveIsExOrV" })).toBe(true);
      expect(conditionHolds(onP1, "p1", { kind: "opponentActiveIsExOrV" })).toBe(false);
    }

    // The VMAX, from both seats: FALSE either way. It has a Rule Box; the clause
    // does not name it.
    const vmax = setActiveFromDeck(clean, "p2", "fix-pokemon-vmax");
    expect(conditionHolds(vmax, "p1", { kind: "opponentActiveIsExOrV" })).toBe(false);
    expect(conditionHolds(vmax, "p2", { kind: "opponentActiveIsExOrV" })).toBe(false);

    // The empty-spot edge: FALSE, not a throw.
    const empty = clearActive(setActiveFromDeck(clean, "p2", "fix-pokemon-v"), "p2");
    expect(empty.players.p2.active).toBeNull();
    expect(conditionHolds(empty, "p1", { kind: "opponentActiveIsExOrV" })).toBe(false);
  });

  it("names both in the reject/tooltip vocabulary", () => {
    // Neither member is reachable from a play gate today (both arrive through
    // attack text), so nothing else in the suite would catch a typo in the copy —
    // and the HUD renders these strings verbatim.
    expect(conditionNote({ kind: "yourActivePoisoned" })).toBe("your Active Pokémon is Poisoned");
    expect(conditionNote({ kind: "opponentActiveIsExOrV" })).toBe(
      "your opponent's Active Pokémon is a Pokémon ex or Pokémon V",
    );
  });

  it("drops the printed pronoun — yourActivePoisoned's note never says 'this Pokémon'", () => {
    // THE D116 point, asserted where it is visible. The clause table resolved "this
    // Pokémon" to the attacker's Active; the note is read off the BOARD by a play
    // gate or a HUD tooltip, where there is no attack in flight and the pronoun has
    // no referent at all. So the note names the SPOT.
    const note = conditionNote({ kind: "yourActivePoisoned" });
    expect(note).not.toContain("this Pokémon");
    expect(note).not.toContain("This Pokémon");
    expect(note).toContain("your Active Pokémon");
    // The printed sentence it came from DOES say it — the two really do differ.
    expect(CHAIN_CRAZED).toContain("this Pokémon");
    // And it is not simply D116's cross-board note wearing a new name: the two are
    // one possessive apart in the copy exactly as they are in the print.
    expect(note).not.toBe(conditionNote({ kind: "opponentActivePoisoned" }));
    expect(conditionNote({ kind: "opponentActivePoisoned" })).toContain("your opponent's");
    // Ceruledge's clause, by contrast, prints no pronoun at all — so its note is
    // the printed sentence's clause verbatim, and that identity is worth pinning.
    expect(FIGHTING_SWORD).toContain(conditionNote({ kind: "opponentActiveIsExOrV" }));
  });
});

describe("the family is PURE — a frozen board is never mutated", () => {
  it("resolves both clauses, TRUE and FALSE, off a deep-frozen state", () => {
    // Four boards: each of the two clauses armed and unarmed. Strict mode turns any
    // write to a frozen object into a throw, so a fold that (say) normalised a
    // condition in place would fail here and nowhere else.
    const cases: ((seed: number) => GameState)[] = [
      (s) => okidogi(board(s), "p1"),
      (s) => setConditions(okidogi(board(s), "p1"), "p1", { poisonDamage: 10 }),
      (s) => ceruledge(board(s), "p1"),
      (s) => setActiveFromDeck(ceruledge(board(s), "p1"), "p2", "sv06.5-036"),
    ];
    for (const [i, build] of cases.entries()) {
      const state = deepFreeze(build(50 + i));
      expect(() => mustApply(state, { type: "attack", seat: "p1", index: 1 })).not.toThrow();
    }
  });

  it("conditionHolds itself is a pure read, both seats, both members", () => {
    // The direct-call half: `conditionHolds` is the single evaluator behind the
    // attack fold, the play gate and the HUD, and the HUD calls it on every render
    // against state it does not own.
    const frozen = deepFreeze(
      setConditions(setActiveFromDeck(board(60), "p2", "fix-pokemon-v"), "p1", {
        poisonDamage: 10,
      }),
    );
    for (const seat of ["p1", "p2"] as const) {
      for (const kind of ["yourActivePoisoned", "opponentActiveIsExOrV"] as const) {
        expect(() => conditionHolds(frozen, seat, { kind })).not.toThrow();
      }
    }
    // Armed for P1 on both, and false for P2 on both — the frozen board answers,
    // and answers seat-relatively.
    expect(conditionHolds(frozen, "p1", { kind: "yourActivePoisoned" })).toBe(true);
    expect(conditionHolds(frozen, "p1", { kind: "opponentActiveIsExOrV" })).toBe(true);
    expect(conditionHolds(frozen, "p2", { kind: "yourActivePoisoned" })).toBe(false);
    expect(conditionHolds(frozen, "p2", { kind: "opponentActiveIsExOrV" })).toBe(false);
  });
});
