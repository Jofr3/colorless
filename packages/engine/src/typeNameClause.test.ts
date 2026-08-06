import { BASIC_ENERGY_TYPES } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { POKEMON_TYPES } from "./effects";
import {
  conditionHolds,
  conditionNote,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  programFor,
} from "./index";
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  TYPE_NAME_DECK,
  attachFromDeck,
  benchFromDeck,
  deckOf,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.70.0 → 0.71.0 — TYPE and NAME (D120). D115 built the shape ("If <clause>,
// this attack does N more damage." → a 0-or-1 INDICATOR folded through the
// existing additive `per × count`), D116 added the pronoun rule, D117 a third
// wave of literal rows, D118 the first parameterised member and the second
// resolution pass, D119 the clauses that read no Pokémon at all. This slice adds
// no arithmetic, no op, no event and no registry row — two printings, two cards,
// two clauses:
//
//   • `opponentActiveHasType { type }` — Sylveon swsh10.5-035 "Wonder Flash"
//     (+90, `Dragon`), matched by an anchored TEMPLATE.
//   • `yourBenchHasNamed { name }`     — Falinks sv02-119 "Reckless Charge
//     Together" (+90, `Falinks`), matched by a LITERAL table row.
//
// THE ONE CALL THIS SUITE EXISTS TO PIN, and everything else here serves it:
//
//   BOTH SENTENCES VARY ON EXACTLY ONE TOKEN, AND THEY GET OPPOSITE TREATMENTS.
//   The discriminator is NOT the printing count (each is a singleton) and NOT
//   D119's "how many things vary" — it is whether the varying token has a CLOSED
//   VOCABULARY TO BE REJECTED AGAINST.
//
//   A type name has one: `POKEMON_TYPES` is eleven words, so an unresolvable
//   token falls through and the clause stays LOUD on its ATTACK_EFFECT_SKIPPED
//   row. That is what keeps the pattern off "is a Basic Pokémon" — a real print
//   (Houndoom ex sv03-134) on another skeleton — and off anything else that ever
//   fills the slot. Eleven words also means the template covers the other ten
//   types for free, which a literal row could not.
//
//   A card NAME has none. `^(.+) is on your Bench$` has nothing to reject
//   against: it would read "a Pokémon with an Ability is on your Bench" as a card
//   CALLED "a Pokémon with an Ability" and answer FALSE forever, with no failure
//   anywhere. Wrong-with-no-failure is the one outcome this family refuses, so
//   the name clause is one row per printing — and the pool prints one (Flamigo
//   sv03-185 prints the identical clause under a DIFFERENT consequent, which this
//   skeleton never reaches).
//
// The two halves are asserted against each other throughout: the ten CONSTRUCTED
// type sentences that resolve, the two that must not, and the four name-shaped
// sentences that must not.

/** The two printed sentences, pinned here and asserted char-for-char against
    FIXTURE_POOL below. Neither card carries an authored attack (see the ZERO-rows
    block), so the sentence IS the wiring: a drifted character does not fail
    loudly, it silently un-simulates the card at the exact moment the clause would
    have paid off. */
const WONDER_FLASH =
  "If your opponent's Active Pokémon is a Dragon Pokémon, this attack does 90 more damage.";
const RECKLESS_CHARGE = "If Falinks is on your Bench, this attack does 90 more damage.";

/** Sylveon's index-0 companion, kept verbatim. 🛑 **D231 BUILT IT, AND THIS
    COMMENT USED TO SAY "a REAL unbuilt sentence … that no deriver owns".** It was
    true when D120 wrote it and stopped being true the moment `deriveAttackEffect`
    learned the deck-search-into-hand family: this is one of that family's ROTATED
    printings, read for free by an arm authored for 28 legal ones (D187's "an arm
    transfers across sets"). So the ATTACK_EFFECT_SKIPPED contrast this file
    depended on has been RE-HOMED rather than deleted — see the section at the
    bottom — and the disjointness claim below now reads the other way round.
    Falinks' own index 0 ("Headbutt") is a bare 20 with no `effect` key at all —
    the other kind of companion, and the other kind of silence. */
const SOUVENIR =
  "Search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck.";

/** Every id this pair covers. Keyed by ID everywhere in this file: several other
    cards in the pool print these exact words in a different frame (see the
    near-miss blocks), so an assertion that went by `name` would be reading
    whichever card it found — and "Falinks" is a card NAME this slice makes
    load-bearing, which makes the distinction sharper here than anywhere. */
const CARD_IDS = ["swsh10.5-035", "sv02-119"] as const;

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

/** The clause sentence at an arbitrary bonus, built the way the pool builds it —
    the constructor behind every CONSTRUCTED type case below. 50 rather than 90 on
    purpose: the printed Dragon sentence is +90, so a fold that hard-coded the
    printing's amount would survive a same-amount probe. */
function typeClause(token: string, per = 50): string {
  return `If your opponent's Active Pokémon is a ${token} Pokémon, this attack does ${per} more damage.`;
}

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so the attack step is legal (§4) — with BOTH Active spots
    pinned to a neutral 200 HP fix-bigbody.

    THE PIN IS BY NAME (`active:`), not by whatever Basic the deal put first in
    hand, and that is load-bearing HERE in a way it is not in the sibling suites:
    `setActiveFromDeck` displaces the sitting Active onto the BENCH, which is the
    exact zone this slice's second clause reads. A deal-dependent starter would
    make "is a Falinks on your Bench" a deal-dependent question. With the pin, the
    bench under every attacker below is exactly `[fix-bigbody]` — one body, of a
    known name that is not "Falinks" — and every Falinks that reaches it got there
    because a case put it there.

    fix-bigbody is also the arithmetically clean defender (200 HP, COLORLESS, no
    Weakness, no Resistance) every damage number here is measured against, and its
    Colorless typing is a real negative for the type clause rather than an absent
    field. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: TYPE_NAME_DECK, p2: TYPE_NAME_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** `board`, then handed over to P2 — P1 passes into P2's turn 3, which is equally
    unrestricted. BOTH clauses in this slice are seat-asymmetric (one reads the
    opponent's Active, one reads your own Bench), and a P1-only suite cannot tell
    "reads the opponent's side" apart from "reads p2's side". */
function boardP2(seed: number): GameState {
  return mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
}

/** Pay a printed cost onto `seat`'s Active. No Energy in this cast ARMS anything
    — unlike D118's, neither clause here can be touched by an attachment — so the
    typed Energy paying the Colorless symbols (legal, §8.2) costs the suite
    nothing, and each attacker is deliberately paid out of BOTH Energy lines: one
    card of its own printed type and two of the other for the {C} symbols. That
    keeps the demand on any one line at two cards, which matters because a seat's
    opening hand and Prize row hold 13 of its 60 before any surgery runs. Must run
    AFTER the attacker is fielded (attachFromDeck attaches to the Active Spot). */
function pay(state: GameState, seat: Seat, spec: [string, number][]): GameState {
  let next = state;
  for (const [id, count] of spec) next = attachFromDeck(next, seat, id, count);
  return next;
}

/** Sylveon — one {P} for Souvenir's bare {P} at index 0, and the three together
    buy Wonder Flash's {C}{C}{C} at index 1. A Stage 1 (from Eevee) placed by
    SURGERY, exactly as publicCount.test.ts places Krokorok: the clause is about
    the DEFENDER, so evolving a real Eevee would add a chain to the deck and prove
    nothing this suite is about. */
function sylveon(state: GameState, seat: Seat): GameState {
  return pay(setActiveFromDeck(state, seat, "swsh10.5-035"), seat, [
    ["fix-psychic-energy", 1],
    ["fix-fighting-energy", 2],
  ]);
}

/** Falinks — one {F} for Reckless Charge Together's {F} at index 1, two more for
    its {C}{C}, and any one of the three covers Headbutt's {C} at index 0. A
    Basic, and the §8.5 fold-order attacker (Fighting into fix-fighting-weak). */
function falinks(state: GameState, seat: Seat): GameState {
  return pay(setActiveFromDeck(state, seat, "sv02-119"), seat, [
    ["fix-fighting-energy", 1],
    ["fix-psychic-energy", 2],
  ]);
}

/** The seat's opposite. Spelled once here rather than imported, because both of
    this slice's members are seat-relative and every board case names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

describe("the printed sentences — the fixture-text-verbatim guard", () => {
  it("matches FIXTURE_POOL char-for-char on both printings", () => {
    // Not decoration: this is the assertion that the fixture rows and the clause
    // resolver still agree on every byte. A one-character drift does not throw —
    // it drops the card back onto the loud ATTACK_EFFECT_SKIPPED path and
    // silently stops paying the bonus.
    expect(FIXTURE_POOL["swsh10.5-035"]?.attacks?.[1]?.effect).toBe(WONDER_FLASH);
    expect(FIXTURE_POOL["sv02-119"]?.attacks?.[1]?.effect).toBe(RECKLESS_CHARGE);
    // The printed "+" markers — what tells the pipeline a scaling clause is
    // expected at all — and the printed BASE each fold starts from.
    expect(FIXTURE_POOL["swsh10.5-035"]?.attacks?.[1]?.damage).toBe("90+");
    expect(FIXTURE_POOL["sv02-119"]?.attacks?.[1]?.damage).toBe("70+");
    // Names, so a re-ingest that reshuffled the attack order fails HERE rather
    // than as a mystery damage number three describes down. BOTH clauses sit at
    // index 1, which is why every board case names its index explicitly anyway.
    expect(FIXTURE_POOL["swsh10.5-035"]?.attacks?.[1]?.name).toBe("Wonder Flash");
    expect(FIXTURE_POOL["sv02-119"]?.attacks?.[1]?.name).toBe("Reckless Charge Together");
  });

  it("matches the companion rows too — one loud sentence and one empty one", () => {
    // Sylveon's index 0 is a REAL unbuilt attack kept verbatim and carrying NO
    // `damage` key; Falinks' index 0 omits `effect` ENTIRELY (not an empty string
    // — the catalog row has no key). Both would break a case silently if a
    // fixture edit moved them.
    expect(FIXTURE_POOL["swsh10.5-035"]?.attacks?.[0]?.effect).toBe(SOUVENIR);
    expect(FIXTURE_POOL["swsh10.5-035"]?.attacks?.[0]?.name).toBe("Souvenir");
    expect(FIXTURE_POOL["swsh10.5-035"]?.attacks?.[0]?.damage).toBeUndefined();
    expect(FIXTURE_POOL["sv02-119"]?.attacks?.[0]?.name).toBe("Headbutt");
    expect(FIXTURE_POOL["sv02-119"]?.attacks?.[0]?.damage).toBe(20);
    expect(FIXTURE_POOL["sv02-119"]?.attacks?.[0]?.effect).toBeUndefined();
  });

  it("keeps the fixture facts the damage arithmetic below is measured against", () => {
    // Every number in the board layer is (HP, type, Weakness) arithmetic off these
    // rows. Pinned here so a fixture edit that moves 320 to 160 fails with a
    // sentence about Weakness rather than with a bare numeric mismatch.
    expect(FIXTURE_POOL["swsh10.5-035"]?.name).toBe("Sylveon");
    expect(FIXTURE_POOL["swsh10.5-035"]?.types).toEqual(["Psychic"]);
    expect(FIXTURE_POOL["swsh10.5-035"]?.stage).toBe("Stage1"); // placed by surgery
    expect(FIXTURE_POOL["swsh10.5-035"]?.evolveFrom).toBe("Eevee");
    expect(FIXTURE_POOL["sv02-119"]?.name).toBe("Falinks"); // the NAME the clause reads
    expect(FIXTURE_POOL["sv02-119"]?.types).toEqual(["Fighting"]); // the fold-order attacker
    expect(FIXTURE_POOL["sv02-119"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv02-119"]?.hp).toBe(110);
    // The DRAGON body — the only reason the type clause can be armed on a real
    // board at all. No Weakness, no Resistance, so §8.5 contributes nothing there
    // and Sylveon's 180 is the fold alone; 120 HP survives the un-armed 90.
    expect(FIXTURE_POOL["sv03-161"]?.name).toBe("Drampa");
    expect(FIXTURE_POOL["sv03-161"]?.types).toEqual(["Dragon"]);
    expect(FIXTURE_POOL["sv03-161"]?.hp).toBe(120);
    expect(FIXTURE_POOL["sv03-161"]?.weaknesses).toBeNull();
    expect(FIXTURE_POOL["sv03-161"]?.resistances).toBeNull();
    // The §8.5 defender and the clean NON-Dragon control, the two bodies the rest
    // of the damage numbers land on.
    expect(FIXTURE_POOL["fix-fighting-weak"]?.weaknesses).toEqual([
      { type: "Fighting", value: "×2" },
    ]);
    expect(FIXTURE_POOL["fix-fighting-weak"]?.hp).toBe(200);
    expect(FIXTURE_POOL["fix-bigbody"]?.types).toEqual(["Colorless"]); // a real negative, not an absent field
    expect(FIXTURE_POOL["fix-bigbody"]?.hp).toBe(200);
    expect(FIXTURE_POOL["fix-bigbody"]?.weaknesses).toBeNull();
    expect(FIXTURE_POOL["fix-bigbody"]?.attacks).toBeNull();
  });

  it("pins Wonder Flash's BYTES — two precomposed é and one ASCII apostrophe", () => {
    // The characters a re-ingest drifts on are INVISIBLE in a diff, so they are
    // asserted by construction and by OFFSET. A lookalike é (e + U+0301) or a
    // curly apostrophe would silently un-map the clause — and this sentence is
    // matched by a TEMPLATE whose anchor spells both characters, so the failure
    // would land on the pattern rather than on a table row.
    const CURLY_APOSTROPHE = "’";
    expect(WONDER_FLASH.length).toBe(87);
    expect(utf8Bytes(WONDER_FLASH)).toBe(89);
    expect(WONDER_FLASH.normalize("NFC")).toBe(WONDER_FLASH);
    expect(WONDER_FLASH.split("é").length - 1).toBe(2);
    expect(WONDER_FLASH.indexOf("é")).toBe(29);
    expect(WONDER_FLASH.lastIndexOf("é")).toBe(49);
    expect(WONDER_FLASH.charCodeAt(29)).toBe(0x00e9); // precomposed, one code point
    expect(WONDER_FLASH.charCodeAt(49)).toBe(0x00e9);
    expect(WONDER_FLASH.split("'").length - 1).toBe(1);
    expect(WONDER_FLASH.indexOf("'")).toBe(16);
    expect(WONDER_FLASH.charCodeAt(16)).toBe(0x27); // ASCII, not U+2019
    expect(WONDER_FLASH).not.toContain(CURLY_APOSTROPHE);
    // …and the invariant behind the two numbers, so the 89 is not a magic
    // constant: every character is one byte except the two é, which are two.
    expect(utf8Bytes(WONDER_FLASH)).toBe(
      WONDER_FLASH.length + (WONDER_FLASH.split("Pokémon").length - 1),
    );
  });

  it("ACCEPTS the U+2019 spelling of Wonder Flash's `opponent's` — the template's class", () => {
    // The byte-pin above says a curly apostrophe "would silently un-map the clause".
    // Until the D135 review that was literally true, and it was a defect rather than
    // a fact worth pinning: `OPPONENT_ACTIVE_TYPE_CLAUSE` spelled the possessive
    // straight-only while every sibling regex reading the SAME noun phrase carries
    // `['’]` — a class that effects.ts documents as existing precisely "so a
    // re-ingest changing only punctuation cannot silently un-derive" the sentence.
    //
    // Both assertions belong here. The BYTES pin says what the catalog holds today
    // (ASCII, U+0027); this says the reader does not DEPEND on that. Pinning only
    // the first mistakes a property of the current ingest for a property of the
    // engine — and the whole point of the class is to survive an ingest that changes.
    const CURLY_APOSTROPHE = "’";
    const curly = WONDER_FLASH.replace("'", CURLY_APOSTROPHE);
    expect(curly).toContain(CURLY_APOSTROPHE); // the rewrite actually fired
    expect(curly).not.toBe(WONDER_FLASH);
    // Equality with the straight form, not merely non-null: the apostrophe carries
    // no meaning, so the two spellings must yield the SAME condition.
    expect(deriveAttackDamageBonus(curly)).toEqual(deriveAttackDamageBonus(WONDER_FLASH));
    expect(deriveAttackDamageBonus(curly)).not.toBeNull();
    // And the note round-trips the sentence it was actually given.
    expect(conditionNote({ kind: "opponentActiveHasType", type: "Dragon" })).toBe(
      "your opponent's Active Pokémon is a Dragon Pokémon",
    );
  });

  it("pins Reckless Charge Together's bytes — PURE ASCII, no é and no apostrophe", () => {
    // The other half of the pair, and the opposite byte profile: this clause names
    // no Pokémon and no possessive, so it is one byte per character throughout.
    // That is a fact worth pinning rather than shrugging at — it is the reason a
    // literal TABLE KEY (rather than a pattern spelling é) is enough here.
    const CURLY_APOSTROPHE = "’";
    expect(RECKLESS_CHARGE.length).toBe(61);
    expect(utf8Bytes(RECKLESS_CHARGE)).toBe(61);
    expect(utf8Bytes(RECKLESS_CHARGE)).toBe(RECKLESS_CHARGE.length);
    expect(RECKLESS_CHARGE.normalize("NFC")).toBe(RECKLESS_CHARGE);
    expect(RECKLESS_CHARGE).not.toContain("é");
    expect(RECKLESS_CHARGE).not.toContain("Pok");
    expect(RECKLESS_CHARGE).not.toContain("'");
    expect(RECKLESS_CHARGE).not.toContain(CURLY_APOSTROPHE);
  });
});

describe("deriveAttackDamageBonus — the TYPE clause and the NAME clause", () => {
  it("reads Wonder Flash as a PARAMETERISED type member", () => {
    expect(deriveAttackDamageBonus(WONDER_FLASH)).toEqual({
      per: 90,
      count: {
        kind: "boardCondition",
        cond: { kind: "opponentActiveHasType", type: "Dragon" },
      },
    });
  });

  it("reads Reckless Charge Together as a NAME member off a literal row", () => {
    expect(deriveAttackDamageBonus(RECKLESS_CHARGE)).toEqual({
      per: 90,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourBenchHasNamed", name: "Falinks" },
      },
    });
  });

  it("takes N from the SENTENCE and the token from the CLAUSE", () => {
    // Both printings happen to be +90, which is exactly the coincidence a
    // constructed probe has to break: a fold that hard-coded either printing's
    // amount survives every same-amount case in this file.
    expect(deriveAttackDamageBonus(typeClause("Water", 30))?.per).toBe(30);
    expect(deriveAttackDamageBonus(typeClause("Water", 30))?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActiveHasType", type: "Water" },
    });
    expect(deriveAttackDamageBonus(typeClause("Dragon", 90))?.per).toBe(90);
  });
});

describe("the TEMPLATE — eleven type words, and nothing else", () => {
  it("resolves EVERY member of POKEMON_TYPES", () => {
    // Ten of the eleven are CONSTRUCTED: the pool prints this sentence exactly
    // once, with `Dragon`. They are asserted all the same, because that coverage
    // is the entire argument for a template over a literal row — the day a Fire or
    // a Water printing lands it must cost nothing, and this loop is what says so.
    for (const type of POKEMON_TYPES) {
      expect(deriveAttackDamageBonus(typeClause(type))).toEqual({
        per: 50,
        count: { kind: "boardCondition", cond: { kind: "opponentActiveHasType", type } },
      });
    }
    expect(POKEMON_TYPES).toContain("Dragon"); // the one the pool actually prints
  });

  it("REJECTS a non-type token — the real trap is 'a Basic Pokémon'", () => {
    // THE case this vocabulary exists for. Houndoom ex sv03-134 "Evil Claw" prints
    // "If the Defending Pokémon is a Basic Pokémon, it can't attack during your
    // opponent's next turn." — the same "is a … Pokémon" reading on another
    // skeleton. An open `(.+)` with no vocabulary behind it would capture `Basic`,
    // build a condition for a type that does not exist, and answer FALSE forever
    // with no failure anywhere. It resolves to nothing instead.
    //
    // ⚠️ RE-POINTED AT D148, NOT DELETED, AND THE CLAIM GOT SHARPER RATHER THAN
    // WEAKER. Until 0.96.0 the note here ended "…so the sentence keeps its loud
    // ATTACK_EFFECT_SKIPPED row"; D148 MAPPED that sentence, on its own anchor,
    // to a `conditionGate { cond: { kind: "opponentActiveIsBasic" } }`. So the
    // failure this line guards against is no longer "an unread card" but the
    // worse one: TWO readers claiming one printed clause, where the damage family
    // would silently build `opponentActiveHasType` for a type named "Basic" and
    // answer false forever beside a lock that works. The token still resolves to
    // nothing HERE, and that is exactly what keeps the two readings disjoint.
    expect(deriveAttackDamageBonus(typeClause("Basic"))).toBeNull();
    // A bogus token, for the same reason from the other direction: the map is a
    // closed list, not a shape check.
    expect(deriveAttackDamageBonus(typeClause("Sparkle"))).toBeNull();
    // …and the near-misses around the real vocabulary: a lowercase type, a
    // pluralised one, a Special-Energy class word, and the two-word rule-box
    // phrase the D117 row owns.
    for (const token of ["dragon", "DRAGON", "Dragons", "Special", "Pokémon ex", "Basic Fire"]) {
      expect(deriveAttackDamageBonus(typeClause(token))).toBeNull();
    }
  });

  it("leaves 'an Evolution Pokémon' on its LITERAL row — the article decides", () => {
    // The template's article is hard-coded to "a" (all eleven type names begin
    // with a consonant), so the Evolution sentence cannot even reach the pattern —
    // and it would not matter if it could, because `boardConditionForClause` runs
    // the literal table FIRST and D117's row already owns it. Both halves are
    // asserted: the real sentence maps to the EVOLUTION member, and the same
    // sentence with the template's article maps to nothing at all.
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 50 more damage.",
      ),
    ).toEqual({
      per: 50,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveIsEvolution" } },
    });
    // Not a type — `Evolution` is not in POKEMON_TYPES, so the "a" spelling is
    // simply unrecognised rather than silently admitted as an eleventh-and-a-half
    // type word.
    expect(deriveAttackDamageBonus(typeClause("Evolution"))).toBeNull();
    expect(POKEMON_TYPES).not.toContain("Evolution");
  });

  it("holds the whole-sentence ANCHOR — case, period, trailing text, leading margin", () => {
    expect(deriveAttackDamageBonus(WONDER_FLASH.replace("If", "if"))).toBeNull();
    expect(deriveAttackDamageBonus(WONDER_FLASH.replace(/\.$/, ""))).toBeNull();
    expect(deriveAttackDamageBonus(`${WONDER_FLASH} Then, discard an Energy.`)).toBeNull();
    expect(deriveAttackDamageBonus(`Flip a coin. ${WONDER_FLASH}`)).toBeNull();
    // A printed 0 is refused by the `per >= 1` floor, as everywhere in the family.
    expect(deriveAttackDamageBonus(typeClause("Dragon", 0))).toBeNull();
  });
});

describe("the LITERAL row — a card NAME has no vocabulary, so it gets no template", () => {
  it("maps the one printed sentence, and nothing that merely looks like it", () => {
    expect(deriveAttackDamageBonus(RECKLESS_CHARGE)).not.toBeNull();
    // The row is keyed on the whole printed clause, capital included.
    expect(
      deriveAttackDamageBonus("If falinks is on your Bench, this attack does 90 more damage."),
    ).toBeNull();
    // A REAL card name in the same shape, and still null. Flamigo sv03-185
    // "Synchronized Feathers" prints "If Flamigo is on your Bench, this attack
    // ALSO does 60 damage to 1 of your opponent's Benched Pokémon." — the clause
    // word for word, under a different CONSEQUENT, so it never reaches this
    // skeleton. The row is per-printing, and this is what per-printing means.
    expect(
      deriveAttackDamageBonus("If Flamigo is on your Bench, this attack does 90 more damage."),
    ).toBeNull();
    // Lunatone sv03-092's "If you have Solrock in play" is the same idea in the
    // pool on yet another skeleton — a different zone AND a different frame.
    expect(
      deriveAttackDamageBonus("If you have Solrock in play, this attack does 90 more damage."),
    ).toBeNull();
  });

  it("THE NO-OPEN-TEMPLATE PROOF: a noun phrase in the name slot resolves to nothing", () => {
    // The slice's thesis, stated as an assertion. `^(.+) is on your Bench$` would
    // read the noun phrase below as a card CALLED "a Pokémon with an Ability",
    // build `{ kind: "yourBenchHasNamed", name: "a Pokémon with an Ability" }`,
    // and answer FALSE on every board forever — no throw, no skipped row, no
    // symptom. That is the one failure mode this family refuses, and it is why the
    // NAME clause is a literal row while the TYPE clause one describe block up is
    // a template: the type token has eleven words to be rejected against, and a
    // card name has nothing at all.
    expect(
      deriveAttackDamageBonus(
        "If a Pokémon with an Ability is on your Bench, this attack does 90 more damage.",
      ),
    ).toBeNull();
    // The same shape at three more widths, so the point is about the SLOT rather
    // than about one phrase.
    for (const phrase of ["a Basic Pokémon", "1 of your Pokémon", "any Pokémon", "Falinks ex"]) {
      expect(
        deriveAttackDamageBonus(`If ${phrase} is on your Bench, this attack does 90 more damage.`),
      ).toBeNull();
    }
  });

  it("holds the whole-sentence ANCHOR on the name clause too", () => {
    expect(deriveAttackDamageBonus(RECKLESS_CHARGE.replace("If", "if"))).toBeNull();
    expect(deriveAttackDamageBonus(RECKLESS_CHARGE.replace(/\.$/, ""))).toBeNull();
    expect(deriveAttackDamageBonus(`${RECKLESS_CHARGE} Then, discard an Energy.`)).toBeNull();
    expect(deriveAttackDamageBonus(`Flip a coin. ${RECKLESS_CHARGE}`)).toBeNull();
    expect(
      deriveAttackDamageBonus("If Falinks is on your Bench, this attack does 0 more damage."),
    ).toBeNull();
    // "Bench" is capitalised as printed, and the matcher has no /i.
    expect(
      deriveAttackDamageBonus("If Falinks is on your bench, this attack does 90 more damage."),
    ).toBeNull();
  });
});

describe("the derivers stay disjoint, and stay INDEX-KEYED", () => {
  it("gives deriveAttackEffect and deriveAttackDamageMultiplier nothing on either sentence", () => {
    for (const clause of [WONDER_FLASH, RECKLESS_CHARGE]) {
      expect(deriveAttackEffect(clause)).toBeNull();
      expect(deriveAttackDamageMultiplier(clause)).toBeNull();
    }
  });

  it("🛑 Souvenir is BUILT as of D231 — and the two DAMAGE paths still refuse it", () => {
    // ⚠️ THIS ROW USED TO ASSERT THE OPPOSITE, AND IT WENT RED ON D231's AUTHOR,
    // which is exactly what it was written for: D120 checked "no deriver owns it"
    // rather than assuming it, precisely so that the day one did, this file would
    // say so instead of quietly asserting a falsehood elsewhere.
    //
    // The sentence is a ROTATED printing of the deck-search-into-hand family
    // (`swsh10.5` is 0 of 88 legal), read for free by an arm authored for 28 legal
    // ones — D187's "an arm transfers across sets; a registry row does not",
    // demonstrated on a card that predates the arm by a hundred slices.
    expect(deriveAttackEffect(SOUVENIR)).toEqual([
      { op: "searchDeck", filter: { kind: "anyCard" }, dest: "hand", max: 2 },
      { op: "shuffleDeck" },
    ]);
    // …and no `reveal`, because the print carries no "reveal them" — the rider is
    // the printed clause and this is one of the seven no-reveal sentences.
    expect(SOUVENIR).not.toContain("reveal");
    // THE DISJOINTNESS CLAIM THIS SECTION IS ABOUT IS UNCHANGED: an effect the OP
    // deriver reads must still be invisible to both DAMAGE derivers, or a card
    // would be scaled and simulated off one sentence.
    expect(deriveAttackDamageBonus(SOUVENIR)).toBeNull();
    expect(deriveAttackDamageMultiplier(SOUVENIR)).toBeNull();
  });

  it("keys on the INDEX: neither card's index 0 derives a damage bonus", () => {
    // Still true after D231 — index 0 now derives an OP, which is a different
    // deriver and a different field on the attack.
    // Falinks' index 0 has no `effect` key at all, so there is no text to derive
    // from; Sylveon's is real text that derives to nothing. Two different kinds of
    // negative on the same index, which is why the board cases below name theirs.
    expect(deriveAttackDamageBonus(SOUVENIR)).toBeNull();
    expect(FIXTURE_POOL["sv02-119"]?.attacks?.[0]?.effect).toBeUndefined();
  });
});

describe("ZERO registry rows — every damage number below is text", () => {
  it("gives neither id an authored attack program", () => {
    // attack.ts resolves an attack as `programFor(id)?.attack?.[index] ?? derive`,
    // so a single authored ATTACK row would WIN and every damage number below
    // would keep passing while testing nothing about the printed sentence. The
    // load-bearing assertion is therefore on `?.attack` and not on `programFor`
    // itself (D118's correction: a card can carry an abilities-only row and still
    // derive all of its attacks). Today both are undefined; only the first would
    // have to stay that way.
    for (const id of CARD_IDS) {
      expect(programFor(id)?.attack).toBeUndefined();
      expect(programFor(id)).toBeUndefined();
    }
  });
});

describe("Sylveon 'Wonder Flash' — their Active is a Dragon", () => {
  it("into a COLORLESS body the printed 90 stands — and nothing is flagged", () => {
    const state = sylveon(board(1), "p1");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 90, dealt: 90 });
    expect(dealt?.scaled).toBeUndefined(); // `scaled` is omitted at 0
    expect(types(events)).not.toContain("KNOCKED_OUT"); // 90 through 200 HP
  });

  it("into a DRAGON body it doubles to 180 — and Knocks the 120 HP body Out", () => {
    // Drampa has no Weakness and no Resistance, so §8.5 contributes nothing: the
    // 180 is base + fold and nothing else.
    const state = sylveon(setActiveFromDeck(board(2), "p2", "sv03-161"), "p1");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      base: 90,
      scaled: 90,
      weakness: null,
      resistance: null,
      dealt: 180,
    });
    expect(types(events)).toContain("KNOCKED_OUT");
  });

  it("runs identically from the OTHER seat", () => {
    const state = sylveon(setActiveFromDeck(boardP2(3), "p1", "sv03-161"), "p2");
    const { events } = mustApply(state, { type: "attack", seat: "p2", index: 1 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 90, scaled: 90, dealt: 180 });
  });

  it("reads the DEFENDER's type, not the attacker's — a Dragon on your own side scores nothing", () => {
    // The case that catches a member wired to `seat` instead of `otherSeat`: P1
    // puts a Dragon on its OWN bench and swings into the Colorless control.
    const state = benchFromDeck(sylveon(board(4), "p1"), "p1", "sv03-161");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(90);
  });

  it("reads the ACTIVE Spot, not the whole board — a benched Dragon scores nothing", () => {
    const state = sylveon(benchFromDeck(board(5), "p2", "sv03-161"), "p1");
    expect(state.players.p2.bench.length).toBe(1);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(90);
  });
});

describe("Falinks 'Reckless Charge Together' — a Falinks on YOUR Bench", () => {
  it("with no Falinks benched the printed 70 stands — and nothing is flagged", () => {
    const state = falinks(board(10), "p1");
    // The bench is exactly the displaced starter, of a known non-Falinks name —
    // the pin in `board` is what makes that a fact rather than a hope.
    expect(state.players.p1.bench.length).toBe(1);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 70, dealt: 70 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("with a SECOND Falinks on the Bench it pays: 70 → 160", () => {
    const state = benchFromDeck(falinks(board(11), "p1"), "p1", "sv02-119");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 70, scaled: 90, dealt: 160 });
  });

  it("BENCH ONLY: the attacking Falinks does not count ITSELF", () => {
    // The printed word is "Bench", and the Active Spot is deliberately excluded
    // (exactly as `yourBenchDamaged` excludes it). The attacker IS a Falinks in
    // every case in this block, so a member that consulted the Active as well
    // would score the bonus on EVERY one of them — including the control above.
    const state = falinks(board(12), "p1");
    expect(state.players.p1.active).not.toBeNull();
    expect(
      state.players.p1.bench.some(
        (p) => FIXTURE_POOL[state.cardIdByUid[p.stack[0] ?? ""] ?? ""]?.name === "Falinks",
      ),
    ).toBe(false);
    expect(conditionHolds(state, "p1", { kind: "yourBenchHasNamed", name: "Falinks" })).toBe(false);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(70);
  });

  it("a differently-NAMED benched body scores nothing", () => {
    // A second Pokémon on the bench, just not the one the sentence names. This is
    // the case that separates "a Falinks is benched" from "anything is benched".
    const state = benchFromDeck(falinks(board(13), "p1"), "p1", "sv03-161");
    expect(state.players.p1.bench.length).toBe(2);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(70);
  });

  it("is SEAT-ASYMMETRIC: a Falinks on the OPPONENT's Bench scores nothing", () => {
    const state = benchFromDeck(falinks(board(14), "p1"), "p2", "sv02-119");
    expect(
      state.players.p2.bench.some(
        (p) => FIXTURE_POOL[state.cardIdByUid[p.stack[0] ?? ""] ?? ""]?.name === "Falinks",
      ),
    ).toBe(true);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(70);
  });

  it("runs identically from the OTHER seat", () => {
    const state = benchFromDeck(falinks(boardP2(15), "p2"), "p2", "sv02-119");
    const { events } = mustApply(state, { type: "attack", seat: "p2", index: 1 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 70, scaled: 90, dealt: 160 });
  });
});

describe("the fold order — the bonus lands BEFORE §8.5 Weakness", () => {
  it("doubles (base + scaled), not base alone: (70 + 90) × 2 = 320", () => {
    // Falinks is the right attacker for this case precisely because its clause is
    // DEFENDER-INDEPENDENT: the Bench arms the bonus and the defender's Weakness
    // doubles it, so the two layers cannot be mistaken for one another. A fold
    // placed AFTER Weakness would give 70 × 2 + 90 = 230.
    let state = setActiveFromDeck(board(20), "p2", "fix-fighting-weak");
    state = benchFromDeck(falinks(state, "p1"), "p1", "sv02-119");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      base: 70,
      scaled: 90,
      weakness: { op: "multiply", amount: 2 },
      resistance: null,
      dealt: 320,
    });
  });

  it("and the un-bonused control on the same matchup: 70 × 2 = 140", () => {
    const state = falinks(setActiveFromDeck(board(21), "p2", "fix-fighting-weak"), "p1");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 70, weakness: { op: "multiply", amount: 2 }, dealt: 140 });
    expect(dealt?.scaled).toBeUndefined();
    // 140 through a 200 HP body leaves it alive, which the armed 320 does not.
    expect(types(events)).not.toContain("KNOCKED_OUT");
  });
});

describe("ATTACK_EFFECT_SKIPPED — never on either clause, ALWAYS on the unbuilt sibling", () => {
  it("simulates both sentences whether or not the clause holds", () => {
    // The flag rides `scaling !== null` — the sentence being RECOGNISED — so a
    // false clause is a simulated 0, not an unsimulated unknown. Asserted for the
    // TRUE and the FALSE board of each card, because a flag wired to the clause's
    // VALUE would only show up on one of the two.
    const cases: { build: (seed: number) => GameState; arm: boolean }[] = [
      { build: (s) => sylveon(board(s), "p1"), arm: false },
      { build: (s) => sylveon(setActiveFromDeck(board(s), "p2", "sv03-161"), "p1"), arm: true },
      { build: (s) => falinks(board(s), "p1"), arm: false },
      { build: (s) => benchFromDeck(falinks(board(s), "p1"), "p1", "sv02-119"), arm: true },
    ];
    for (const [i, { build, arm }] of cases.entries()) {
      const { events } = mustApply(build(30 + i), { type: "attack", seat: "p1", index: 1 });
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      // And the two boards really are different boards — `scaled` present exactly
      // when the clause held, which is what makes the shared flag meaningful.
      expect(find(events, "DAMAGE_DEALT")?.scaled !== undefined).toBe(arm);
    }
  });

  it("🛑 the loud control RE-HOMED at D231 — Souvenir now SIMULATES", () => {
    // ⚠️ THIS TEST WENT RED ON D231, AND THE FAILURE IS THE FINDING: the "unbuilt
    // sibling" this whole section leaned on was BUILT by an arm authored three
    // months later for a different family. A contrast that rides on a card being
    // unreadable has an expiry date nobody writes down — which is the same defect
    // class as a vacuous guard, one step round.
    //
    // Half 1: Sylveon's index 0 no longer skips. It PARKS, because the sentence is
    // now a program.
    const state = sylveon(board(35), "p1");
    const built = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(built.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(built.state.phase.kind).toBe("effect:choose");
    const quiet = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(quiet.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("…and the flag is NOT DEAD — a still-unbuilt sentence on its own board", () => {
    // Half 2, and the reason the row above is not just a deletion: "no skipped
    // row" is only a claim about the clause if the flag can still fire at all.
    // `fix-statuser`'s "Lullaby" prints "The Defending Pokémon is now Asleep." —
    // §9's third-person phrasing that no deriver owns (the built family says "Your
    // opponent's Active Pokémon is now …") — and it costs nothing, so no Energy
    // surgery is needed.
    //
    // ⚠️ ITS OWN DECK, DELIBERATELY: adding a line to TYPE_NAME_DECK would move
    // `deckOf` order and reshuffle every seed-pinned board in this file.
    const own = deckOf({ "fix-statuser": 12, "fix-bigbody": 30, "fix-energy": 18 });
    const setup = driveSetup(
      70,
      { p1: own, p2: own },
      { first: "p2", active: { p1: "fix-statuser", p2: "fix-bigbody" } },
    );
    const opened = mustApply(setup, { type: "endTurn", seat: "p2" }).state;
    const { events } = mustApply(opened, { type: "attack", seat: "p1", index: 6 });
    expect(FIXTURE_POOL["fix-statuser"]?.attacks?.[6]?.effect).toBe(
      "The Defending Pokémon is now Asleep.",
    );
    expect(types(events)).toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("stays quiet on Falinks' plain index 0 too — no text, nothing to skip", () => {
    const state = falinks(board(36), "p1");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(20);
  });
});

describe("conditionHolds / conditionNote — the two members, directly", () => {
  const DRAGON: BoardCondition = { kind: "opponentActiveHasType", type: "Dragon" };
  const BENCHED_FALINKS: BoardCondition = { kind: "yourBenchHasNamed", name: "Falinks" };

  it("reads the OPPONENT's Active type, from both seats", () => {
    const state = setActiveFromDeck(board(40), "p2", "sv03-161");
    expect(conditionHolds(state, "p1", DRAGON)).toBe(true);
    expect(conditionHolds(state, "p2", DRAGON)).toBe(false); // p1's Active is Colorless
    // Every other type word answers false against the very same body — the
    // parameter is read, not ignored.
    for (const type of POKEMON_TYPES) {
      expect(conditionHolds(state, "p1", { kind: "opponentActiveHasType", type })).toBe(
        type === "Dragon",
      );
    }
    // …and the Colorless control is a genuine positive for its OWN type, which is
    // what makes "false for Dragon" a discrimination rather than a broken read.
    expect(conditionHolds(state, "p2", { kind: "opponentActiveHasType", type: "Colorless" })).toBe(
      true,
    );
  });

  it("reads YOUR Bench for the name, from both seats", () => {
    for (const seat of ["p1", "p2"] as const) {
      const bare = board(41);
      expect(conditionHolds(bare, seat, BENCHED_FALINKS)).toBe(false);
      const armed = benchFromDeck(bare, seat, "sv02-119");
      expect(conditionHolds(armed, seat, BENCHED_FALINKS)).toBe(true);
      // …and the far seat still reads false off the same board: the member is
      // seat-relative, and a Falinks on their bench is not one on yours.
      expect(conditionHolds(armed, other(seat), BENCHED_FALINKS)).toBe(false);
    }
  });

  it("is FALSE on an empty Active Spot and on an empty Bench", () => {
    // Both members read a Pokémon, so unlike D119's counting cluster an empty
    // board is a real edge for them: no Active is not a Dragon, and no Bench holds
    // no Falinks. Asserted by emptying BOTH sides.
    const state = board(42);
    const bare: GameState = {
      ...state,
      players: {
        p1: { ...state.players.p1, active: null, bench: [] },
        p2: { ...state.players.p2, active: null, bench: [] },
      },
    };
    for (const seat of ["p1", "p2"] as const) {
      expect(conditionHolds(bare, seat, DRAGON)).toBe(false);
      expect(conditionHolds(bare, seat, BENCHED_FALINKS)).toBe(false);
      for (const type of POKEMON_TYPES) {
        expect(conditionHolds(bare, seat, { kind: "opponentActiveHasType", type })).toBe(false);
      }
    }
  });

  it("answers FALSE for a card whose `types` is NULL — the `?? []` guard", () => {
    // `Card.types` is null on every Trainer and every Energy, and the member reads
    // `(card.types ?? []).includes(...)`. A Trainer in the Active Spot is not
    // reachable in a real game, so this is asserted by SURGERY: a Basic Energy
    // card from the deck is put in the spot, which is illegal-shaped on purpose
    // and is the only way to exercise the guard at all. Without the `?? []` this
    // would throw rather than answer.
    const state = setActiveFromDeck(board(43), "p2", "fix-psychic-energy");
    expect(FIXTURE_POOL["fix-psychic-energy"]?.types).toBeNull();
    for (const type of POKEMON_TYPES) {
      expect(conditionHolds(state, "p1", { kind: "opponentActiveHasType", type })).toBe(false);
    }
  });

  it("ROUND-TRIPS to the printed clause — both notes need nothing dropped", () => {
    // Several notes in this family drop something the printed text carries: a
    // pronoun with no referent on the board (D116/D117), or the timing word
    // "already" (D115). These two name no pronoun and no timing, so each note IS
    // the printed clause — and both are built from the parameter rather than
    // returned as a literal.
    expect(conditionNote(DRAGON)).toBe("your opponent's Active Pokémon is a Dragon Pokémon");
    expect(conditionNote(BENCHED_FALINKS)).toBe("Falinks is on your Bench");
    for (const clause of [WONDER_FLASH, RECKLESS_CHARGE]) {
      const bonus = deriveAttackDamageBonus(clause);
      const cond = bonus?.count.kind === "boardCondition" ? bonus.count.cond : null;
      expect(cond).not.toBeNull();
      expect(clause).toBe(`If ${conditionNote(cond ?? DRAGON)}, this attack does 90 more damage.`);
    }
  });

  it("spells every OTHER type, and another name, the same way", () => {
    // Not reachable from any printed sentence today (the pool prints one type
    // clause and one name clause), but both members admit them, so the notes have
    // to — and each of these round-trips through the resolver in one step.
    for (const type of POKEMON_TYPES) {
      const note = conditionNote({ kind: "opponentActiveHasType", type });
      expect(note).toBe(`your opponent's Active Pokémon is a ${type} Pokémon`);
      expect(
        deriveAttackDamageBonus(`If ${note}, this attack does 50 more damage.`)?.count,
      ).toEqual({ kind: "boardCondition", cond: { kind: "opponentActiveHasType", type } });
    }
    expect(conditionNote({ kind: "yourBenchHasNamed", name: "Flamigo" })).toBe(
      "Flamigo is on your Bench",
    );
    // …and THAT note does NOT round-trip, which is the literal row's whole point:
    // the note is generated from the member, the resolver is keyed per printing,
    // and only the printed sentence has a row.
    expect(
      deriveAttackDamageBonus(
        `If ${conditionNote({ kind: "yourBenchHasNamed", name: "Flamigo" })}, this attack does 90 more damage.`,
      ),
    ).toBeNull();
  });
});

describe("POKEMON_TYPES is canonical — the vocabulary the template rejects against", () => {
  it("is BASIC_ENERGY_TYPES plus exactly Dragon and Colorless, with no duplicates", () => {
    // Built FROM the schema's list rather than re-typed, so a type added there is
    // admitted here by construction. This is the test that says so — and the test
    // a re-ingest that grew the wheel would fail.
    expect(POKEMON_TYPES.length).toBe(11);
    expect(new Set(POKEMON_TYPES).size).toBe(11);
    for (const energy of BASIC_ENERGY_TYPES) expect(POKEMON_TYPES).toContain(energy);
    const basics: readonly string[] = BASIC_ENERGY_TYPES;
    expect(POKEMON_TYPES.filter((type) => !basics.includes(type))).toEqual(["Dragon", "Colorless"]);
    // The two directions of the split, spelled out: a Pokémon type is a strictly
    // WIDER thing than a payable energy type (§6.1 — Colorless is a cost symbol,
    // Dragon has no Basic Energy at all).
    expect(BASIC_ENERGY_TYPES).not.toContain("Dragon");
    expect(BASIC_ENERGY_TYPES).not.toContain("Colorless");
    expect(BASIC_ENERGY_TYPES.length).toBe(9);
  });

  it("covers every `types` value anywhere in FIXTURE_POOL", () => {
    // A re-ingest that introduced a type word the vocabulary does not carry would
    // silently un-map every clause naming it. This catches it at the fixture
    // layer, which is the layer that would change first.
    const seen = new Set<string>();
    for (const card of Object.values(FIXTURE_POOL)) {
      for (const type of card.types ?? []) seen.add(type);
    }
    const pokemonTypes: readonly string[] = POKEMON_TYPES;
    for (const type of seen) expect(pokemonTypes).toContain(type);
    // And the pool really does exercise the wheel rather than one corner of it —
    // including Dragon, which no fixture carried before this slice added Drampa.
    expect(seen.has("Dragon")).toBe(true);
    expect(seen.has("Colorless")).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });
});

describe("the pair is PURE — a frozen board is never mutated", () => {
  it("resolves both clauses, TRUE and FALSE, off a deep-frozen state", () => {
    const armed = deepFreeze(
      benchFromDeck(setActiveFromDeck(board(50), "p2", "sv03-161"), "p1", "sv02-119"),
    );
    const conds: BoardCondition[] = [
      { kind: "opponentActiveHasType", type: "Dragon" },
      { kind: "opponentActiveHasType", type: "Water" },
      { kind: "yourBenchHasNamed", name: "Falinks" },
      { kind: "yourBenchHasNamed", name: "Flamigo" },
    ];
    expect(conds.map((c) => conditionHolds(armed, "p1", c))).toEqual([true, false, true, false]);
    // The same reads a second time, unchanged — nothing was memoised into state.
    expect(conds.map((c) => conditionHolds(armed, "p1", c))).toEqual([true, false, true, false]);
    // One benched body (the Falinks this case put there) — P1's Active is still
    // the pinned starter here, since no attack is declared off this board.
    expect(armed.players.p1.bench.length).toBe(1);
  });

  it("runs a whole armed attack off a frozen board", () => {
    const frozen = deepFreeze(benchFromDeck(falinks(board(51), "p1"), "p1", "sv02-119"));
    const { events } = mustApply(frozen, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(160);
    expect(frozen.players.p2.active?.damage).toBe(0);
  });
});
