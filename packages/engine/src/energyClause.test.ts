import { BASIC_ENERGY_TYPES } from "@colorless/schema";
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
import type { GameState, Seat } from "./index";
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
  findEvent,
} from "./testFixtures";

const SUPER_SPICY_BREATH =
  "If this Pokémon has any {R} Energy attached, this attack does 90 more damage.";
const SHOCKING_WEB =
  "If this Pokémon has any {L} Energy attached, this attack does 80 more damage.";
const SPECIAL_HORN =
  "If this Pokémon has any Special Energy attached, this attack does 140 more damage.";
const SPECIAL_HAMMER =
  "If this Pokémon has any Special Energy attached, this attack does 90 more damage.";

const HOT_BITE = "Your opponent's Active Pokémon is now Burned.";

const CLAUSES = [SUPER_SPICY_BREATH, SHOCKING_WEB, SPECIAL_HORN, SPECIAL_HAMMER];

const CARD_IDS = ["sv01-029", "sv01-202", "sv06.5-002", "sv02-055", "sv02-105"] as const;

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function board(seed: number): GameState {
  let state = driveSetup(seed, { p1: ENERGY_CLAUSE_DECK, p2: ENERGY_CLAUSE_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-bigbody");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return state;
}

function boardP2(seed: number): GameState {
  return mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
}

function pay(state: GameState, seat: Seat, spec: [string, number][]): GameState {
  let next = state;
  for (const [id, count] of spec) next = attachFromDeck(next, seat, id, count);
  return next;
}

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
    const CURLY_APOSTROPHE = "’";
    const COMBINING_ACUTE = "é";
    for (const text of CLAUSES) {
      // NFC-stable => no combining marks anywhere in the string.
      expect(text.normalize("NFC")).toBe(text);
      expect(text).not.toContain(COMBINING_ACUTE);
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
    const horn = deriveAttackDamageBonus(SPECIAL_HORN);
    const hammer = deriveAttackDamageBonus(SPECIAL_HAMMER);
    expect(horn?.count).toEqual(hammer?.count);
    expect(horn?.per).toBe(140);
    expect(hammer?.per).toBe(90);
  });

  it("resolves every brace code the pool can print — nine tokens, one shape", () => {
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
    const forEach =
      "This attack does 40 more damage for each of your Benched Pokémon that has any {G} Energy attached.";
    expect(forEach).toContain("has any {G} Energy attached");
    expect(deriveAttackDamageBonus(forEach)).toBeNull();
    expect(deriveAttackDamageMultiplier(forEach)).toBeNull();
    expect(deriveAttackEffect(forEach)).toBeNull();
  });

  it("refuses Haxorus sv06.5-046 as a BONUS — its clause is now READ, and by another reader", () => {
    const haxorus =
      "If your opponent's Active Pokémon has any Special Energy attached, it is Knocked Out.";
    expect(haxorus).toContain("has any Special Energy attached");
    expect(deriveAttackDamageBonus(haxorus)).toBeNull();
    expect(deriveAttackDamageMultiplier(haxorus)).toBeNull();
    expect(deriveAttackEffect(haxorus)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveHasEnergyAttached", energy: "special" },
        ops: [{ op: "knockOutDefender" }],
      },
    ]);
    expect(deriveAttackDamageBonus(SPECIAL_HAMMER)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "yourActiveHasEnergyAttached", energy: "special" },
    });
    expect(SPECIAL_HAMMER).toContain("has any Special Energy attached");
  });

  it("refuses Slither Wing sv06.5-026 — the OUTER shape matches and the clause still misses", () => {
    const slitherWing =
      "If your opponent has any Future Pokémon in play, this attack does 120 more damage.";
    expect(deriveAttackDamageBonus(slitherWing)?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentBannerPokemonInPlay", banner: "Future" },
    });
    expect(
      deriveAttackDamageBonus(
        "If 1 of your other Ancient Pokémon used an attack during your last turn, this attack does 150 more damage.",
      )?.count,
    ).toEqual({
      kind: "boardCondition",
      cond: { kind: "yourOtherBannerPokemonAttackedLastTurn", banner: "Ancient" },
    });
    expect(
      deriveAttackDamageBonus(
        "If 1 of your other Future Pokémon used an attack during your last turn, this attack does 150 more damage.",
      ),
    ).toBeNull();
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
    for (const token of ["{X}", "{RR}", "R", "basic", "special", "constructor", "toString"]) {
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
    for (const text of CLAUSES) {
      expect(deriveAttackEffect(text)).toBeNull();
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
    }
  });

  it("Scovillain's index-0 Hot Bite is a BUILT setter and not this family", () => {
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
    for (const id of CARD_IDS) {
      expect(programFor(id)?.attack).toBeUndefined();
    }
    for (const id of ["sv01-029", "sv01-202", "sv02-055"] as const) {
      expect(programFor(id)).toBeUndefined();
    }
    expect(programFor("sv02-105")?.abilities).toHaveLength(1);
    expect(Object.keys(programFor("sv06.5-002") ?? {})).toEqual(["passive"]);
    expect(programFor("sv06.5-002")?.passive?.damageBonusBeforeWRIf).toEqual({
      amount: 50,
      cond: { kind: "opponentActiveHasAbility" },
    });
    expect(CARD_IDS).toContain("sv01-202");
  });

  it("no DERIVER reads Galvantula's 'Compound Eyes' — the text is not an attack clause (the Ability is a registry `passive` since D560)", () => {
    expect(FIXTURE_POOL["fix-bigbody"]?.abilities ?? []).toEqual([]);
    expect(FIXTURE_POOL["fix-psychic-weak"]?.abilities ?? []).toEqual([]);
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
    const dealt = findEvent(events, "DAMAGE_DEALT");
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
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 90, scaled: 90, dealt: 180 });
  });

  it("is the ATTACKER's own body — the same Fire on the DEFENDER scores nothing", () => {
    // THE seat asymmetry, and the case that catches a member wired to
    // `otherSeat(seat)`. The defender is a mirrored Scovillain carrying the very
    // Energy the clause names; a cross-board read would score 180 here.
    let state = scovillain(board(3), "p1");
    state = attachFromDeck(scovillain(state, "p2"), "p2", "fix-fire-energy", 1);
    expect(state.players.p2.active?.energy.length).toBe(4);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const dealt = findEvent(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 90, dealt: 90 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("is the ACTIVE Spot — Fire on your own BENCH scores nothing", () => {
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
    const dealt = findEvent(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 90, dealt: 90 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("runs identically from the OTHER seat — seat-relativity, both directions", () => {
    // Nothing in this clause is p1-shaped: a hardcoded "p1" would read P1's
    // Fire-less Scovillain here and pay 90.
    const clean = scovillain(boardP2(5), "p2");
    const cleanDealt = findEvent(
      mustApply(clean, { type: "attack", seat: "p2", index: 1 }).events,
      "DAMAGE_DEALT",
    );
    expect(cleanDealt).toMatchObject({ base: 90, dealt: 90 });
    expect(cleanDealt?.scaled).toBeUndefined();

    const armed = attachFromDeck(clean, "p2", "fix-fire-energy", 1);
    expect(
      findEvent(mustApply(armed, { type: "attack", seat: "p2", index: 1 }).events, "DAMAGE_DEALT"),
    ).toMatchObject({ base: 90, scaled: 90, dealt: 180 });
  });

  it("keeps index 0 on its OWN meaning — Hot Bite burns and does not scale", () => {
    const state = attachFromDeck(scovillain(board(6), "p1"), "p1", "fix-fire-energy", 1);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = findEvent(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 20, dealt: 20 });
    expect(dealt?.scaled).toBeUndefined();
    expect(findEvent(events, "STATUS_APPLIED")).toMatchObject({ seat: "p2", status: "burned" });
  });
});

describe("Galvantula 'Shocking Web' — the {L} clause, a second token at a second N", () => {
  it("with no Lightning attached the printed 50 stands", () => {
    const state = galvantula(board(10), "p1");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = findEvent(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 50, dealt: 50 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("adds the whole printed 80 with a Basic Lightning attached → 130", () => {
    const state = attachFromDeck(galvantula(board(11), "p1"), "p1", "fix-lightning-energy", 1);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 50, scaled: 80, dealt: 130 });
  });

  it("reads its OWN token — Scovillain's Fire does not arm Galvantula's {L}", () => {
    const state = attachFromDeck(galvantula(board(12), "p1"), "p1", "fix-fire-energy", 1);
    expect(state.players.p1.active?.energy.length).toBe(3);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const dealt = findEvent(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 50, dealt: 50 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("runs from the OTHER seat too", () => {
    const armed = attachFromDeck(galvantula(boardP2(13), "p2"), "p2", "fix-lightning-energy", 1);
    expect(
      findEvent(mustApply(armed, { type: "attack", seat: "p2", index: 0 }).events, "DAMAGE_DEALT"),
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
    const dealt = findEvent(events, "DAMAGE_DEALT");
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
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 80, scaled: 140, dealt: 220 });
    // 220 through a 200 HP fix-bigbody: the KO is reported for completeness, not as
    // the proof — the proof is `scaled`.
    expect(types(events)).toContain("KNOCKED_OUT");
  });

  it("Tinkaton: no Special → 90, one Luminous → 180", () => {
    const clean = tinkaton(board(22), "p1");
    const cleanDealt = findEvent(
      mustApply(clean, { type: "attack", seat: "p1", index: 0 }).events,
      "DAMAGE_DEALT",
    );
    expect(cleanDealt).toMatchObject({ base: 90, dealt: 90 });
    expect(cleanDealt?.scaled).toBeUndefined();

    const armed = attachFromDeck(clean, "p1", "sv02-191", 1);
    expect(
      findEvent(mustApply(armed, { type: "attack", seat: "p1", index: 0 }).events, "DAMAGE_DEALT"),
    ).toMatchObject({ base: 90, scaled: 90, dealt: 180 });
  });

  it("Cetitan: the DEFENDER's Special scores nothing, from either seat", () => {
    // The seat asymmetry for the class arm — mirrored so neither direction is a
    // p1 accident.
    let state = cetitan(board(23), "p1");
    state = attachFromDeck(cetitan(state, "p2"), "p2", "sv02-190", 1);
    const dealt = findEvent(
      mustApply(state, { type: "attack", seat: "p1", index: 1 }).events,
      "DAMAGE_DEALT",
    );
    expect(dealt).toMatchObject({ base: 80, dealt: 80 });
    expect(dealt?.scaled).toBeUndefined();

    const mirrored = attachFromDeck(cetitan(cetitan(boardP2(24), "p2"), "p1"), "p1", "sv02-190", 1);
    const mirroredDealt = findEvent(
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
    const dealt = findEvent(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 50, dealt: 50 });
    expect(dealt?.scaled).toBeUndefined();
  });
});

describe("PROVISION, not the printed name — the Luminous/Jet pair", () => {
  it("a wildcard Luminous ALONE satisfies {R} on Scovillain → 180", () => {
    let state = setActiveFromDeck(board(30), "p1", "sv01-029");
    state = pay(state, "p1", [
      ["fix-grass-energy", 1],
      ["fix-energy", 1],
      ["sv02-191", 1],
    ]);
    expect(state.players.p1.active?.energy.length).toBe(3);
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(phase.attacks[1]).toMatchObject({ name: "Super Spicy Breath", playable: true });

    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 90, scaled: 90, dealt: 180 });
  });

  it("…and a second Special DEMOTES it, so the SAME board scores 90 again", () => {
    let state = setActiveFromDeck(board(31), "p1", "sv01-029");
    state = pay(state, "p1", [
      ["fix-grass-energy", 1],
      ["fix-energy", 1],
      ["sv02-191", 1],
    ]);
    const before = mustApply(state, { type: "attack", seat: "p1", index: 1 }).events;
    expect(findEvent(before, "DAMAGE_DEALT")).toMatchObject({ base: 90, scaled: 90, dealt: 180 });

    const demoted = attachFromDeck(state, "p1", "sv02-190", 1);
    expect(demoted.players.p1.active?.energy.length).toBe(4);
    const phase = redactGame(demoted, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(phase.attacks[1]).toMatchObject({ name: "Super Spicy Breath", playable: true });

    const { events } = mustApply(demoted, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = findEvent(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 90, dealt: 90 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("THE TWO AXES on one board: the TYPE clause is false while the CLASS clause is true", () => {
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
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 80, scaled: 140, dealt: 220 });
  });
});

describe("the fold order — the bonus lands BEFORE §8.5 Weakness", () => {
  it("doubles (base + scaled), not base alone: (90 + 90) × 2 = 360", () => {
    let state = setActiveFromDeck(board(40), "p2", "fix-psychic-weak");
    state = attachFromDeck(tinkaton(state, "p1"), "p1", "sv02-190", 1);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
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
    const dealt = findEvent(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 90, weakness: { op: "multiply", amount: 2 }, dealt: 180 });
    expect(dealt?.scaled).toBeUndefined();
    expect(types(events)).not.toContain("KNOCKED_OUT");
  });
});

describe("ATTACK_EFFECT_SKIPPED never fires — in EITHER direction, on all four cards", () => {
  it("simulates the sentence whether or not the clause holds", () => {
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
      expect(findEvent(events, "DAMAGE_DEALT")?.scaled !== undefined).toBe(arm);
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
    for (const energy of BASIC_ENERGY_TYPES) {
      const note = conditionNote({ kind: "yourActiveHasEnergyAttached", energy });
      expect(note).toBe(`your Active Pokémon has ${energy} Energy attached`);
      expect(note).not.toContain("{");
    }
  });

  it("drops the printed pronoun — the note never says 'this Pokémon'", () => {
    const note = conditionNote({ kind: "yourActiveHasEnergyAttached", energy: "Fire" });
    expect(note).not.toContain("this Pokémon");
    expect(note).toContain("your Active Pokémon");
    // The printed sentences it came from DO say it — the two really do differ.
    for (const text of CLAUSES) expect(text).toContain("this Pokémon");
  });
});

describe("the family is PURE — a frozen board is never mutated", () => {
  it("resolves all four clauses, TRUE and FALSE, off a deep-frozen state", () => {
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
