import { describe, expect, it } from "vitest";
import {
  conditionHolds,
  conditionNote,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  programFor,
} from "./index";
import type { GameState, Seat } from "./index";
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
  findEvent,
} from "./testFixtures";

const CHAIN_CRAZED = "If this Pokémon is Poisoned, this attack does 130 more damage.";
const FIGHTING_SWORD =
  "If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 100 more damage.";

const POISONOUS_MUSCULATURE =
  "Search your deck for up to 2 Basic {D} Energy cards and attach them to this Pokémon. Then, shuffle your deck. If you attached Energy to a Pokémon in this way, this Pokémon is now Poisoned.";
const LIFE_SUCKER = "Heal 30 damage from this Pokémon.";
const SPIT_POISON = "Your opponent's Active Pokémon is now Poisoned.";

const CLAUSES = [CHAIN_CRAZED, FIGHTING_SWORD];

const CARD_IDS = ["sv06.5-036", "sv06.5-082", "sv06.5-090", "sv02-098"] as const;

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function board(seed: number): GameState {
  let state = driveSetup(seed, { p1: CLAUSE_TABLE_DECK, p2: CLAUSE_TABLE_DECK }, { first: "p2" });
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
    expect(FIXTURE_POOL["sv06.5-036"]?.attacks?.[0]?.effect).toBe(POISONOUS_MUSCULATURE);
    expect(FIXTURE_POOL["sv02-098"]?.attacks?.[0]?.effect).toBe(LIFE_SUCKER);
    expect(FIXTURE_POOL["sv01-128"]?.attacks?.[0]?.effect).toBe(SPIT_POISON);
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
    expect(deriveAttackDamageBonus(FIGHTING_SWORD)).not.toBeNull();
  });

  it("refuses Lokix's evolved-this-turn clause — a well-formed sentence, an unmapped condition", () => {
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon evolved from Nymble during this turn, this attack does 100 more damage.",
      ),
    ).toBeNull();
  });

  it("holds the whole-sentence ANCHOR on Chain-Crazed — case, period and both margins", () => {
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
    expect(deriveAttackEffect(SPIT_POISON)).toEqual([
      { op: "applyStatus", target: "defender", status: "poisoned" },
    ]);
    expect(deriveAttackDamageBonus(SPIT_POISON)).toBeNull();
  });
});

describe("ZERO registry rows — the whole slice is text", () => {
  it("gives none of the four ids a registry program", () => {
    for (const id of CARD_IDS) {
      expect(programFor(id)).toBeUndefined();
    }
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
    const dealt = findEvent(events, "DAMAGE_DEALT");
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
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 130, scaled: 130, dealt: 260 });
  });

  it("is armed by the GAME, not by a surgery — P2's Spit Poison one turn, Chain-Crazed the next", () => {
    let state = boardP2(3);
    state = okidogi(state, "p1");
    state = seviper(state, "p2");
    expect(state.players.p1.active?.conditions.poisonDamage).toBe(0);

    const poisonRun = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    // Spit Poison deals nothing itself — the only damage in its events is §13.1's.
    expect(findEvent(poisonRun.events, "DAMAGE_DEALT")).toBeUndefined();
    expect(types(poisonRun.events)).toContain("COUNTERS_PLACED");
    state = poisonRun.state;
    expect(state.players.p1.active?.conditions.poisonDamage).toBe(10);
    expect(state.players.p1.active?.damage).toBe(10); // one Checkup tick
    expect(state.players.p2.active?.conditions.poisonDamage).toBe(0); // Seviper is clean

    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 130, scaled: 130, dealt: 260 });
    // Seviper is a 120 HP body, so 260 is lethal — and so would 130 have been.
    // The KO is reported for completeness, not as the proof; the proof is `scaled`.
    expect(types(events)).toContain("KNOCKED_OUT");
  });

  it("is the ATTACKER's side — Poison on the DEFENDER's Active scores nothing", () => {
    const state = setConditions(okidogi(board(4), "p1"), "p2", { poisonDamage: 10 });
    expect(state.players.p1.active?.conditions.poisonDamage).toBe(0);
    expect(state.players.p2.active?.conditions.poisonDamage).toBe(10);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const dealt = findEvent(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 130, dealt: 130 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("runs identically from the OTHER seat — seat-relativity, both directions", () => {
    // The whole trio again with P2 attacking. Nothing in this clause is p1-shaped:
    // a hardcoded "p1" would read P1's unpoisoned Okidogi here and pay 130.
    const clean = okidogi(boardP2(5), "p2");
    const cleanEvents = mustApply(clean, { type: "attack", seat: "p2", index: 1 }).events;
    const cleanDealt = findEvent(cleanEvents, "DAMAGE_DEALT");
    expect(cleanDealt).toMatchObject({ base: 130, dealt: 130 });
    expect(cleanDealt?.scaled).toBeUndefined();

    const poisoned = setConditions(clean, "p2", { poisonDamage: 10 });
    const poisonedEvents = mustApply(poisoned, { type: "attack", seat: "p2", index: 1 }).events;
    expect(findEvent(poisonedEvents, "DAMAGE_DEALT")).toMatchObject({
      base: 130,
      scaled: 130,
      dealt: 260,
    });

    // And Poison on P2's OPPONENT (P1) still scores nothing, mirrored.
    const wrongSide = setConditions(clean, "p1", { poisonDamage: 10 });
    const wrongEvents = mustApply(wrongSide, { type: "attack", seat: "p2", index: 1 }).events;
    const wrongDealt = findEvent(wrongEvents, "DAMAGE_DEALT");
    expect(wrongDealt).toMatchObject({ base: 130, dealt: 130 });
    expect(wrongDealt?.scaled).toBeUndefined();
  });

  it("runs index 0 as its OWN program — no DAMAGE_DEALT, and no clause inherited", () => {
    const state = okidogi(board(6), "p1");
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
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
    const dealt = findEvent(events, "DAMAGE_DEALT");
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
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
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
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 100, scaled: 100, dealt: 200 });
  });

  it("into a Pokémon VMAX it does NOT — isExOrV, not hasRuleBox", () => {
    const state = setActiveFromDeck(ceruledge(board(13), "p1"), "p2", "fix-pokemon-vmax");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = findEvent(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 100, dealt: 100 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("runs from the OTHER seat too — the read follows the ATTACKER's opponent", () => {
    // Seat-relativity for the cross-board member: P2 attacks, so the ex body has to
    // be on P1 to count. The mirrored negative is the same ex body on P2's OWN side
    // — a member that read `seat` instead of `otherSeat(seat)` would score there.
    const armed = setActiveFromDeck(ceruledge(boardP2(14), "p2"), "p1", "fix-pokemon-v");
    const armedEvents = mustApply(armed, { type: "attack", seat: "p2", index: 1 }).events;
    expect(findEvent(armedEvents, "DAMAGE_DEALT")).toMatchObject({
      base: 100,
      scaled: 100,
      dealt: 200,
    });

    // P2 attacks out of an ex/V-free board into a plain fix-bigbody: no bonus.
    const clean = ceruledge(boardP2(15), "p2");
    const cleanEvents = mustApply(clean, { type: "attack", seat: "p2", index: 1 }).events;
    const cleanDealt = findEvent(cleanEvents, "DAMAGE_DEALT");
    expect(cleanDealt).toMatchObject({ base: 100, dealt: 100 });
    expect(cleanDealt?.scaled).toBeUndefined();
  });
});

describe("the fold order — the bonus lands BEFORE §8.5 Weakness", () => {
  it("doubles (base + scaled), not base alone: (130 + 130) × 2 = 520", () => {
    const state = setConditions(
      setActiveFromDeck(okidogi(board(20), "p1"), "p2", "sv02-098"),
      "p1",
      { poisonDamage: 10 },
    );
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
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
    const dealt = findEvent(events, "DAMAGE_DEALT");
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
      expect(findEvent(events, "DAMAGE_DEALT")?.scaled !== undefined).toBe(arm);
    }
  });
});

describe("conditionHolds / conditionNote — the two NEW members, directly", () => {
  it("yourActivePoisoned is OWN-side, per seat, and 0-exclusive", () => {
    const clean = board(40);
    expect(conditionHolds(clean, "p1", { kind: "yourActivePoisoned" })).toBe(false);
    expect(conditionHolds(clean, "p2", { kind: "yourActivePoisoned" })).toBe(false);

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
    const note = conditionNote({ kind: "yourActivePoisoned" });
    expect(note).not.toContain("this Pokémon");
    expect(note).not.toContain("This Pokémon");
    expect(note).toContain("your Active Pokémon");
    // The printed sentence it came from DOES say it — the two really do differ.
    expect(CHAIN_CRAZED).toContain("this Pokémon");
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
