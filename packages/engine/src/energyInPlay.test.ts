import { describe, expect, it } from "vitest";
import {
  conditionHolds,
  conditionNote,
  countEnergyInPlay,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  programFor,
} from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  ENERGY_IN_PLAY_DECK,
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

const DARKFALL = "If you have at least 3 {D} Energy in play, this attack does 50 more damage.";

const ORTHWORM = "If this Pokémon has 3 or more {M} Energy attached, it gets +100 HP.";
const SLITHER_WING =
  "If your opponent has any Future Pokémon in play, this attack does 120 more damage.";

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

function inPlayClause(count: number, token: string, per = 30): string {
  return `If you have at least ${count} ${token} Energy in play, this attack does ${per} more damage.`;
}

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: ENERGY_IN_PLAY_DECK, p2: ENERGY_IN_PLAY_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** `board`, then handed over to P2 — P1 passes into P2's turn 3, which is equally
    unrestricted. The clause is seat-relative (it reads YOUR side), and a P1-only
    suite cannot tell "reads your own side" apart from "reads p1's side". */
function boardP2(seed: number): GameState {
  return mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
}

function absol(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv06.5-030"), seat, "fix-energy", 1);
}

function benchDark(state: GameState, seat: Seat, count: number): GameState {
  const seeded =
    state.players[seat].bench.length > 0 ? state : benchFromDeck(state, seat, "fix-bigbody");
  return attachBenchFromDeck(seeded, seat, 0, "fix-darkness-energy", count);
}

/** The seat's opposite. Spelled once here rather than imported, because the
    member is seat-relative and every board case names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

describe("the printed sentence — the fixture-text-verbatim guard", () => {
  it("matches FIXTURE_POOL char-for-char", () => {
    expect(FIXTURE_POOL["sv06.5-030"]?.attacks?.[0]?.effect).toBe(DARKFALL);
    // The printed "+" marker — what tells the pipeline a scaling clause is
    // expected at all — and the base the fold starts from.
    expect(FIXTURE_POOL["sv06.5-030"]?.attacks?.[0]?.damage).toBe("20+");
    expect(FIXTURE_POOL["sv06.5-030"]?.attacks?.[0]?.name).toBe("Darkfall");
    expect(FIXTURE_POOL["sv06.5-030"]?.attacks?.[0]?.cost).toEqual(["Colorless"]);
  });

  it("keeps the card to ONE attack — so the index below cannot be right by accident", () => {
    // Absol's whole cast is this attack. Every sibling suite in the family has an
    // index-keyed negative to run; here there is no second index to run it on, so
    // the honest assertion is that the array has length 1 and the clause is at 0.
    expect(FIXTURE_POOL["sv06.5-030"]?.attacks).toHaveLength(1);
    expect(FIXTURE_POOL["sv06.5-030"]?.abilities).toBeNull();
  });

  it("keeps the card facts the damage arithmetic is measured against", () => {
    expect(FIXTURE_POOL["sv06.5-030"]?.name).toBe("Absol");
    expect(FIXTURE_POOL["sv06.5-030"]?.types).toEqual(["Darkness"]); // the fold-order attacker
    expect(FIXTURE_POOL["sv06.5-030"]?.stage).toBe("Basic"); // fields in one surgery
    expect(FIXTURE_POOL["sv06.5-030"]?.hp).toBe(110);
    expect(FIXTURE_POOL["sv06.5-030"]?.retreat).toBe(1);
    expect(FIXTURE_POOL["sv06.5-030"]?.weaknesses).toEqual([{ type: "Grass", value: "×2" }]);
    expect(FIXTURE_POOL["sv06.5-030"]?.resistances).toBeNull();
  });

  it("keeps the fixture facts the ENERGY cases ride on", () => {
    expect(FIXTURE_POOL["fix-darkness-energy"]?.name).toBe("Darkness Energy");
    expect(FIXTURE_POOL["fix-darkness-energy"]?.category).toBe("Energy");
    expect(FIXTURE_POOL["fix-darkness-energy"]?.energyType).toBe("Normal");
    expect(FIXTURE_POOL["fix-energy"]?.name).toBe("fix-energy");
    expect(FIXTURE_POOL["fix-energy"]?.category).toBe("Energy");
    expect(FIXTURE_POOL["sv02-191"]?.name).toBe("Luminous Energy"); // the wildcard
    expect(FIXTURE_POOL["sv02-191"]?.energyType).toBe("Special");
    // The §8.5 defender and the clean neutral control.
    expect(FIXTURE_POOL["fix-darkness-weak"]?.weaknesses).toEqual([
      { type: "Darkness", value: "×2" },
    ]);
    expect(FIXTURE_POOL["fix-darkness-weak"]?.hp).toBe(200);
    expect(FIXTURE_POOL["fix-darkness-weak"]?.attacks).toBeNull();
    expect(FIXTURE_POOL["fix-bigbody"]?.hp).toBe(200);
    expect(FIXTURE_POOL["fix-bigbody"]?.weaknesses).toBeNull();
  });

  it("pins the sentence's BYTES — this clause is PURE ASCII, 75 and 75", () => {
    expect(DARKFALL.length).toBe(75);
    expect(utf8Bytes(DARKFALL)).toBe(75);
    expect(DARKFALL).not.toContain("Pokémon");
    expect(DARKFALL).not.toContain("'");
    expect(DARKFALL).not.toContain("’");
    expect(DARKFALL).toContain("{D}");
    expect(DARKFALL).not.toContain("Darkness");
  });

  it("proves the fixture file is not ASCII-only by accident", () => {
    // A companion sentence from the same file that DOES carry non-ASCII, so the
    // claim above is about this string rather than about the encoding of the
    // whole module. Orthworm's near-miss carries a precomposed é.
    expect(ORTHWORM).toContain("Pokémon");
    expect(utf8Bytes(ORTHWORM)).toBe(ORTHWORM.length + 1);
    // And Absol's own Weakness value is a real U+00D7, not an ASCII "x".
    expect(FIXTURE_POOL["sv06.5-030"]?.weaknesses?.[0]?.value).toBe("×2");
  });
});

describe("derivation — the clause resolves to a parameterised member", () => {
  it("derives Darkfall's bonus with BOTH parameters", () => {
    expect(deriveAttackDamageBonus(DARKFALL)).toEqual({
      per: 50,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourEnergyInPlayAtLeast", energy: "Darkness", count: 3 },
      },
    });
  });

  it("takes the bonus N from the SENTENCE, not from the card", () => {
    const rewritten = DARKFALL.replace("does 50 more", "does 10 more");
    expect(deriveAttackDamageBonus(rewritten)).toMatchObject({ per: 10 });
  });

  it("is a LITERAL row, so a re-thresholded rewrite does NOT resolve", () => {
    expect(deriveAttackDamageBonus(inPlayClause(1, "{D}"))).toBeNull();
    expect(deriveAttackDamageBonus(inPlayClause(2, "{D}"))).toBeNull();
    expect(deriveAttackDamageBonus(inPlayClause(4, "{D}"))).toBeNull();
    expect(deriveAttackDamageBonus(inPlayClause(3, "{D}"))).toMatchObject({
      per: 30,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourEnergyInPlayAtLeast", energy: "Darkness", count: 3 },
      },
    });
  });

  it("is a LITERAL row, so the OTHER energy tokens do not resolve either", () => {
    for (const token of ["{G}", "{R}", "{W}", "{L}", "{P}", "{F}", "{M}", "{Y}", "Special"]) {
      expect(deriveAttackDamageBonus(inPlayClause(3, token, 50))).toBeNull();
    }
    expect(deriveAttackDamageBonus(inPlayClause(3, "Darkness", 50))).toBeNull();
  });

  it("refuses the one-word rewrite that turns it into D118's clause", () => {
    const attached = DARKFALL.replace("in play", "attached");
    expect(deriveAttackDamageBonus(attached)).toBeNull();
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

  it("holds the whole-sentence anchor", () => {
    expect(deriveAttackDamageBonus(DARKFALL.toLowerCase())).toBeNull();
    expect(deriveAttackDamageBonus(DARKFALL.slice(0, -1))).toBeNull(); // no period
    expect(deriveAttackDamageBonus(`${DARKFALL} Then, shuffle your deck.`)).toBeNull();
    expect(deriveAttackDamageBonus(`Flip a coin. ${DARKFALL}`)).toBeNull();
    expect(deriveAttackDamageBonus(DARKFALL.replace("If you", "if you"))).toBeNull();
  });

  it("leaves the REAL near-misses LOUD", () => {
    // Orthworm sv02-151/-224: a threshold, a brace code and the word "Energy" —
    // everything but the scope — on an ABILITY that changes HP, not damage. A
    // substring or a keyword matcher would take it.
    expect(deriveAttackDamageBonus(ORTHWORM)).toBeNull();
    expect(deriveAttackEffect(ORTHWORM)).toBeNull();
    expect(deriveAttackDamageBonus(SLITHER_WING)?.per).toBe(120);
    expect(
      deriveAttackDamageBonus(
        "If 1 of your other Ancient Pokémon used an attack during your last turn, this attack does 150 more damage.",
      )?.per,
    ).toBe(150);
    expect(
      deriveAttackDamageBonus(
        "If 1 of your other Future Pokémon used an attack during your last turn, this attack does 150 more damage.",
      ),
    ).toBeNull();
    // Kingambit sv03-150: "4 or more", a threshold over damage counters, on a
    // knockout consequent rather than a damage one.
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon has 4 or more damage counters on it, that Pokémon is Knocked Out.",
      ),
    ).toBeNull();
  });

  it("is disjoint from the other two derivers", () => {
    expect(deriveAttackEffect(DARKFALL)).toBeNull();
    expect(deriveAttackDamageMultiplier(DARKFALL)).toBeNull();
  });
});

describe("ZERO registry rows — every damage number below is text", () => {
  it("gives the id no authored attack program", () => {
    expect(programFor("sv06.5-030")?.attack).toBeUndefined();
    expect(programFor("sv06.5-030")).toBeUndefined();
  });
});

describe("Darkfall — the threshold on a real board", () => {
  it("with no countable Energy the printed 20 stands — and nothing is flagged", () => {
    const state = absol(board(1), "p1");
    // The Colorless that paid the cost is genuinely in play and genuinely does
    // not count. Asserted directly, because every control below depends on it.
    expect(state.players.p1.active?.energy).toHaveLength(1);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(0);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 20, dealt: 20 });
    expect(dealt?.scaled).toBeUndefined(); // `scaled` is omitted at 0
  });

  it("at TWO it is still 20 — the boundary that fails", () => {
    const state = benchDark(absol(board(2), "p1"), "p1", 2);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(2);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(20);
  });

  it("at THREE it pays — 20 + 50 = 70, from a Bench the attacker never touched", () => {
    const state = benchDark(absol(board(3), "p1"), "p1", 3);
    expect(state.players.p1.active?.energy).toHaveLength(1);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(3);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      base: 20,
      scaled: 50,
      weakness: null,
      resistance: null,
      dealt: 70,
    });
  });

  it("at FOUR it still pays — a THRESHOLD, not an exact count", () => {
    const state = benchDark(absol(board(4), "p1"), "p1", 4);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(4);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(70);
  });

  it("folds ACROSS zones — one on the Active and two on the Bench is three", () => {
    // Neither zone alone reaches the threshold, so this fails on any read that
    // scopes to one of them. The Active's Darkness is attached ON TOP of the
    // Colorless that paid the cost, so the cost is not what changed.
    const state = attachFromDeck(
      benchDark(absol(board(5), "p1"), "p1", 2),
      "p1",
      "fix-darkness-energy",
      1,
    );
    expect(state.players.p1.active?.energy).toHaveLength(2);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(3);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(70);
  });

  it("counts the attacker's OWN Energy too — three on Absol and an empty Bench", () => {
    // The other half of "in play": the attacker is in play, so what is attached to
    // it counts, and a read that excluded the Active would score 20 here. The
    // {C} cost is over-paid three times over, which is legal (§8.2).
    const state = attachFromDeck(
      setActiveFromDeck(board(6), "p1", "sv06.5-030"),
      "p1",
      "fix-darkness-energy",
      3,
    );
    expect(state.players.p1.bench[0]?.energy).toHaveLength(0);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(3);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(70);
  });

  it("reads YOUR side — the opponent's three Darkness score nothing", () => {
    // The case that catches a member wired to `otherSeat`. P2's bench carries the
    // full threshold and P1's carries none.
    const state = benchDark(absol(board(7), "p1"), "p2", 3);
    expect(countEnergyInPlay(state, "p2", "Darkness")).toBe(3);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(0);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(20);
  });

  it("runs identically from the OTHER seat", () => {
    const state = benchDark(absol(boardP2(8), "p2"), "p2", 3);
    const { events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 20, scaled: 50, dealt: 70 });
  });

  it("and the seat asymmetry mirrors too", () => {
    const state = benchDark(absol(boardP2(9), "p2"), "p1", 3);
    const { events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(20);
  });

  it("folds BEFORE Weakness — (20 + 50) × 2 = 140, against the control's 40", () => {
    const armed = benchDark(
      absol(setActiveFromDeck(board(10), "p2", "fix-darkness-weak"), "p1"),
      "p1",
      3,
    );
    const { events } = mustApply(armed, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      base: 20,
      scaled: 50,
      weakness: { op: "multiply", amount: 2 },
      dealt: 140,
    });

    const control = absol(setActiveFromDeck(board(11), "p2", "fix-darkness-weak"), "p1");
    const { events: controlEvents } = mustApply(control, { type: "attack", seat: "p1", index: 0 });
    expect(find(controlEvents, "DAMAGE_DEALT")).toMatchObject({
      base: 20,
      weakness: { op: "multiply", amount: 2 },
      dealt: 40,
    });
  });

  it("flags no ATTACK_EFFECT_SKIPPED in EITHER direction", () => {
    const armed = mustApply(benchDark(absol(board(12), "p1"), "p1", 3), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(armed.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const unarmed = mustApply(absol(board(13), "p1"), { type: "attack", seat: "p1", index: 0 });
    expect(types(unarmed.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("PROVISION, not the printed name — D118's predicate folded over the board", () => {
  it("a wildcard Luminous counts as a {D} Energy", () => {
    const state = attachBenchFromDeck(
      benchDark(absol(board(20), "p1"), "p1", 2),
      "p1",
      0,
      "sv02-191",
      1,
    );
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(3);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(70);
  });

  it("a SECOND Luminous on the same body DISARMS it — one more card, less damage", () => {
    const state = attachBenchFromDeck(
      benchDark(absol(board(21), "p1"), "p1", 2),
      "p1",
      0,
      "sv02-191",
      2,
    );
    expect(state.players.p1.bench[0]?.energy).toHaveLength(4); // MORE Energy than the case above
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(2);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // The attack still resolves — the demotion is about what COUNTS, not about
    // whether the cost is payable, and Darkfall's {C} was paid by fix-energy.
    expect(types(events)).toContain("DAMAGE_DEALT");
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(20);
  });

  it("demotion is PER POKÉMON — two Luminous on two bodies both count", () => {
    const state = attachBenchFromDeck(
      attachFromDeck(setActiveFromDeck(board(22), "p1", "sv06.5-030"), "p1", "sv02-191", 1),
      "p1",
      0,
      "sv02-191",
      1,
    );
    const withBasic = benchDark(state, "p1", 1);
    expect(countEnergyInPlay(withBasic, "p1", "Darkness")).toBe(3);
    const { events } = mustApply(withBasic, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(70);
  });

  it("counts CARDS, not units of provision", () => {
    // A wildcard provides every one of the nine types, and it is still ONE Energy
    // card. Three Luminous spread one per body would be three; one Luminous is
    // one, however many units it offers. Below the threshold on its own.
    const state = attachBenchFromDeck(absol(board(23), "p1"), "p1", 0, "sv02-191", 1);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(1);
    expect(countEnergyInPlay(state, "p1", "Fire")).toBe(1); // the same one card, another type
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(20);
  });
});

describe("countEnergyInPlay — the helper, directly", () => {
  it("is 0 on a board the deal alone produced", () => {
    // Setup fields Basics and nothing else, so no seed can arm this clause by
    // accident — which is what makes every control above a real control.
    const state = board(30);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(0);
    expect(countEnergyInPlay(state, "p2", "Darkness")).toBe(0);
  });

  it("sums the Active and the whole Bench", () => {
    const state = attachFromDeck(
      benchDark(absol(board(31), "p1"), "p1", 2),
      "p1",
      "fix-darkness-energy",
      2,
    );
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(4);
  });

  it("survives an EMPTY Active Spot", () => {
    // The holders idiom drops a null Active rather than iterating it, so a side
    // mid-promotion counts its Bench and does not throw. Not reachable through a
    // legal action at this point in the turn, so it is constructed.
    const state = benchDark(absol(board(32), "p1"), "p1", 3);
    const empty: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: null } },
    };
    expect(countEnergyInPlay(empty, "p1", "Darkness")).toBe(3);
  });

  it("counts the SPECIAL class as well as a type", () => {
    const state = attachBenchFromDeck(
      benchDark(absol(board(33), "p1"), "p1", 2),
      "p1",
      0,
      "sv02-191",
      1,
    );
    expect(countEnergyInPlay(state, "p1", "special")).toBe(1);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(3); // the Luminous, both ways
    // Basic Energy are not Special, however many of them there are.
    expect(countEnergyInPlay(board(34), "p1", "special")).toBe(0);
  });
});

describe("conditionHolds / conditionNote — the member on its own", () => {
  it("sweeps the threshold from 0 to 5 with no gaps", () => {
    // A THRESHOLD is monotone: once true it stays true. Swept rather than
    // sampled, because the failure this catches (`===` for `>=`) shows up as a
    // single false value ABOVE the line and would survive a two-point check.
    const cond = { kind: "yourEnergyInPlayAtLeast", energy: "Darkness", count: 3 } as const;
    const expected = [false, false, false, true, true, true];
    for (let n = 0; n <= 5; n++) {
      const state = n === 0 ? absol(board(40), "p1") : benchDark(absol(board(40), "p1"), "p1", n);
      expect(conditionHolds(state, "p1", cond)).toBe(expected[n]);
    }
  });

  it("answers per SEAT on one board", () => {
    const cond = { kind: "yourEnergyInPlayAtLeast", energy: "Darkness", count: 3 } as const;
    const state = benchDark(absol(board(41), "p1"), "p1", 3);
    expect(conditionHolds(state, "p1", cond)).toBe(true);
    expect(conditionHolds(state, other("p1"), cond)).toBe(false);
  });

  it("is trivially true at a count of 0, and false for another type", () => {
    const state = benchDark(absol(board(42), "p1"), "p1", 3);
    // An empty board satisfies "at least 0" — degenerate, and worth pinning
    // because the printed sentence's 3 is the only thing keeping it off.
    expect(
      conditionHolds(board(43), "p1", {
        kind: "yourEnergyInPlayAtLeast",
        energy: "Darkness",
        count: 0,
      }),
    ).toBe(true);
    // Three Darkness are not three Fire. Provision, not a wildcard read.
    expect(
      conditionHolds(state, "p1", { kind: "yourEnergyInPlayAtLeast", energy: "Fire", count: 3 }),
    ).toBe(false);
  });

  it("renders a note from BOTH parameters", () => {
    expect(conditionNote({ kind: "yourEnergyInPlayAtLeast", energy: "Darkness", count: 3 })).toBe(
      "you have at least 3 Darkness Energy in play",
    );
    expect(conditionNote({ kind: "yourEnergyInPlayAtLeast", energy: "Metal", count: 1 })).toBe(
      "you have at least 1 Metal Energy in play",
    );
    expect(conditionNote({ kind: "yourEnergyInPlayAtLeast", energy: "special", count: 2 })).toBe(
      "you have at least 2 Special Energy in play",
    );
  });

  it("does NOT byte-round-trip to the printed clause — and that is deliberate", () => {
    const note = conditionNote({ kind: "yourEnergyInPlayAtLeast", energy: "Darkness", count: 3 });
    const printed = DARKFALL.slice("If ".length, DARKFALL.indexOf(", this attack"));
    expect(printed).toBe("you have at least 3 {D} Energy in play");
    expect(note).not.toBe(printed);
    expect(note).toBe(printed.replace("{D}", "Darkness"));
  });
});

describe("purity", () => {
  it("mutates nothing on a frozen board, armed or not", () => {
    const armed = deepFreeze(benchDark(absol(board(50), "p1"), "p1", 3));
    expect(() => mustApply(armed, { type: "attack", seat: "p1", index: 0 })).not.toThrow();
    const unarmed = deepFreeze(absol(board(51), "p1"));
    expect(() => mustApply(unarmed, { type: "attack", seat: "p1", index: 0 })).not.toThrow();
  });
});
