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

const CLUTCH = "During your opponent's next turn, the Defending Pokémon can't retreat.";
const SPIT_POISON = "Your opponent's Active Pokémon is now Poisoned.";
const NIGHT_EYES = "Your opponent's Active Pokémon is now Asleep.";

const CLAUSES = [FIERY_BREEZE, DAMAGE_COUNTERPUNCH, LIGHTNING_RAMPAGE, VENOSHOCK, UNSEEN_CLAW];

const CARD_IDS = ["sv02-030", "sv03-035", "sv03-066", "sv01-128", "sv02-136"] as const;

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

function boardP2(seed: number): GameState {
  return mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
}

function pay(state: GameState, seat: Seat, spec: [string, number][]): GameState {
  let next = state;
  for (const [id, count] of spec) next = attachFromDeck(next, seat, id, count);
  return next;
}

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
    expect(utf8Bytes(FIERY_BREEZE)).toBe(80);
    expect(utf8Bytes(DAMAGE_COUNTERPUNCH)).toBe(80);
    expect(utf8Bytes(LIGHTNING_RAMPAGE)).toBe(92);
    expect(utf8Bytes(VENOSHOCK)).toBe(81);
    expect(utf8Bytes(UNSEEN_CLAW)).toBe(103);
    for (const text of CLAUSES) expect(utf8Bytes(text)).toBe(text.length + 1);
  });
});

describe("deriveAttackDamageBonus — the four NEW clauses", () => {
  it("reads Fiery Breeze as yourActiveDamaged — the printed pronoun, resolved in the TABLE", () => {
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
    expect(
      deriveAttackDamageBonus(
        "If any of your {F} Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 120 more damage.",
      ),
    ).toBeNull();
  });

  it("refuses the damage-PLACEMENT sentences that merely CONTAIN a mapped clause", () => {
    const yveltal =
      "Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it.";
    const vespiquen =
      "Put 3 damage counters on each of your opponent's Benched Pokémon that has any damage counters on it.";
    expect(deriveAttackDamageBonus(yveltal)).toBeNull();
    expect(deriveAttackDamageBonus(vespiquen)).toBeNull();
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
    for (const id of CARD_IDS) {
      expect(programFor(id)).toBeUndefined();
    }
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
    const note = conditionNote({ kind: "yourActiveDamaged" });
    expect(note).not.toContain("this Pokémon");
    expect(note).not.toContain("This Pokémon");
    expect(note).toContain("your Active Pokémon");
    // The printed sentence it came from DOES say it — the two really do differ.
    expect(FIERY_BREEZE).toContain("this Pokémon");
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
