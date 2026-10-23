import { BASIC_ENERGY_TYPES } from "@colorless/schema";
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

const WONDER_FLASH =
  "If your opponent's Active Pokémon is a Dragon Pokémon, this attack does 90 more damage.";
const RECKLESS_CHARGE = "If Falinks is on your Bench, this attack does 90 more damage.";

const SOUVENIR =
  "Search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck.";

const CARD_IDS = ["swsh10.5-035", "sv02-119"] as const;

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

function typeClause(token: string, per = 50): string {
  return `If your opponent's Active Pokémon is a ${token} Pokémon, this attack does ${per} more damage.`;
}

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: TYPE_NAME_DECK, p2: TYPE_NAME_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function boardP2(seed: number): GameState {
  return mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
}

function pay(state: GameState, seat: Seat, spec: [string, number][]): GameState {
  let next = state;
  for (const [id, count] of spec) next = attachFromDeck(next, seat, id, count);
  return next;
}

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

function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

describe("the printed sentences — the fixture-text-verbatim guard", () => {
  it("matches FIXTURE_POOL char-for-char on both printings", () => {
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
    for (const type of POKEMON_TYPES) {
      expect(deriveAttackDamageBonus(typeClause(type))).toEqual({
        per: 50,
        count: { kind: "boardCondition", cond: { kind: "opponentActiveHasType", type } },
      });
    }
    expect(POKEMON_TYPES).toContain("Dragon"); // the one the pool actually prints
  });

  it("REJECTS a non-type token — the real trap is 'a Basic Pokémon'", () => {
    expect(deriveAttackDamageBonus(typeClause("Basic"))).toBeNull();
    // A bogus token, for the same reason from the other direction: the map is a
    // closed list, not a shape check.
    expect(deriveAttackDamageBonus(typeClause("Sparkle"))).toBeNull();
    for (const token of ["dragon", "DRAGON", "Dragons", "Special", "Pokémon ex", "Basic Fire"]) {
      expect(deriveAttackDamageBonus(typeClause(token))).toBeNull();
    }
  });

  it("leaves 'an Evolution Pokémon' on its LITERAL row — the article decides", () => {
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
    expect(
      deriveAttackDamageBonus("If falinks is on your Bench, this attack does 90 more damage."),
    ).toBeNull();
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

  it("Souvenir is BUILT as of D231 — and the two DAMAGE paths still refuse it", () => {
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
    expect(deriveAttackDamageBonus(SOUVENIR)).toBeNull();
    expect(FIXTURE_POOL["sv02-119"]?.attacks?.[0]?.effect).toBeUndefined();
  });
});

describe("ZERO registry rows — every damage number below is text", () => {
  it("gives neither id an authored attack program", () => {
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

  it("the loud control RE-HOMED at D231 — Souvenir now SIMULATES", () => {
    const state = sylveon(board(35), "p1");
    const built = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(built.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(built.state.phase.kind).toBe("effect:choose");
    const quiet = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(quiet.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("…and the flag is NOT DEAD — a still-unbuilt sentence on its own board", () => {
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
    const state = setActiveFromDeck(board(43), "p2", "fix-psychic-energy");
    expect(FIXTURE_POOL["fix-psychic-energy"]?.types).toBeNull();
    for (const type of POKEMON_TYPES) {
      expect(conditionHolds(state, "p1", { kind: "opponentActiveHasType", type })).toBe(false);
    }
  });

  it("ROUND-TRIPS to the printed clause — both notes need nothing dropped", () => {
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
