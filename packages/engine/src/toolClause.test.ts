import { describe, expect, it } from "vitest";
import {
  conditionHolds,
  conditionNote,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  effectiveMaxHp,
  programFor,
} from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  TOOL_CLAUSE_DECK,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.72.0 → 0.73.0 — the POKÉMON TOOL clause (D122). Greedent sv01-152 "Enhanced
// Fang", "If this Pokémon has a Pokémon Tool attached, this attack does 80 more
// damage." One card, one clause, one printing, no reprint — and the LAST clause
// in this family that reads a field the model already carries. It rides D115's
// 0-or-1 indicator through the existing additive fold, so this slice adds no op,
// no event, no registry row, no continuous.ts helper and no change to attack.ts.
//
//   `yourActiveHasToolAttached` — a BARE TAG on a LITERAL table row.
//
// WHY THIS IS THE FAMILY'S CHEAPEST MEMBER, and the one thing that could still
// have gone wrong:
//
//   `tools` IS ALREADY A UID ARRAY ON `InPlayPokemon`, AND EVERY UID IN IT
//   REACHED IT THROUGH A GATE THAT ALREADY CHECKED trainerType === "Tool".
//
// So there is no provision question here of the kind the Energy clauses have to
// answer (D118: an Energy card can pay for a type it is not named after, so
// "has {R} Energy attached" cannot be a name match). A Tool is a Tool. What is
// left is a LENGTH test, and the only real decision is `> 0` rather than
// `=== 1`: §7.4 caps a Pokémon at one Tool, but that cap lives at the attach
// gate, and Revavroom ex sv03-156's "Tune-Up" Ability raises it to 4. A
// predicate reading `=== 1` would answer FALSE on a board the printed sentence
// plainly describes, so the two-Tool case below is a real one.
//
// THE THREE READINGS THIS SUITE EXISTS TO SEPARATE, all of which score the same
// on a naive board and diverge here:
//
//   1. "this Pokémon" is YOUR ACTIVE — not any of your Pokémon. A Tool on the
//      BENCH arms nothing.
//   2. YOUR Active — not the defender's. A Tool across the table arms nothing,
//      asserted from both seats.
//   3. The Tool's OWN passive is not the clause. Vitality Band arms the clause
//      AND adds its own +10 in the same pre-W/R step; Bravery Charm arms it and
//      adds nothing (Greedent is a Stage 1, so `basicHpBonus` does not apply).
//      The pair is what separates a +80 that is the clause's from a swing that
//      merely happened when a Tool landed.
//
// AND THE NEAR-MISS THAT MAKES THE WHOLE-SENTENCE ANCHOR LOAD-BEARING: two OTHER
// cards in the pool print this clause's exact words. Genesect sv06.5-040's "ACE
// Nullifier" shares the entire prefix and Stunfisk sv03-112's "Custom Trap"
// carries it as a middle conjunct — both are ABILITIES, and a substring matcher
// would have scored a damage bonus off them.

/** The printed sentence, pinned here and asserted char-for-char against
    FIXTURE_POOL below. Greedent carries no authored program at all (see the
    ZERO-rows block), so the sentence IS the wiring: a drifted character does not
    throw, it drops the card back onto the loud ATTACK_EFFECT_SKIPPED path and
    silently stops paying the bonus. */
const ENHANCED_FANG =
  "If this Pokémon has a Pokémon Tool attached, this attack does 80 more damage.";

/** The two REAL sentences from the same pool that print this clause's exact
    words under a different consequent. Both are Abilities; neither may derive.

    Genesect is the sharper of the two — it is byte-identical to ENHANCED_FANG up
    to and including the comma, so everything separating them is downstream of the
    clause capture. Stunfisk buries the same words as a middle conjunct, which is
    the case a `.includes` would fail on regardless of what the sentence ends
    with. */
const ACE_NULLIFIER =
  "If this Pokémon has a Pokémon Tool attached, your opponent can't play any ACE SPEC cards from their hand.";
const CUSTOM_TRAP =
  "If this Pokémon is in the Active Spot, has a Pokémon Tool attached, and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 5 damage counters on the Attacking Pokémon.";

/** UTF-8 byte length, counted off code points. Deliberately NOT
    `new TextEncoder().encode(s).length`: the engine package compiles with
    `lib: ["ES2022"]` and `types: []` (packages/engine/tsconfig.json), so no
    platform global is in scope and `tsc -b` — which CI runs — would reject it. */
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

/** The clause sentence at an arbitrary bonus — the constructor behind the
    CONSTRUCTED cases below. The default deliberately does NOT match the printing
    (30 rather than 80), so a fold that hard-coded the printed amount would
    survive a same-amount probe. */
function toolClause(per = 30): string {
  return `If this Pokémon has a Pokémon Tool attached, this attack does ${per} more damage.`;
}

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so the attack step is legal (§4) — with BOTH Active spots
    pinned to a neutral 200 HP fix-bigbody.

    Greedent is a STAGE 1 and can never be the setup Active, so the pin is not
    optional here: without it the opening Active is whatever Basic the seed
    turned up, and fix-bigbody is 35 of 60 precisely so the deal is mulligan-free
    around it. Pinning both sides also keeps the defender's Weakness out of every
    case that is not about Weakness. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: TOOL_CLAUSE_DECK, p2: TOOL_CLAUSE_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** `board`, then handed over to P2 — P1 passes into P2's turn 3, which is equally
    unrestricted. The clause is seat-relative (it reads YOUR Active), and a
    P1-only suite cannot tell "reads your own Active" apart from "reads p1's". */
function boardP2(seed: number): GameState {
  return mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
}

/** Greedent in the seat's Active Spot with Enhanced Fang's {C}{C}{C} paid.
    Surgery, because Greedent is a Stage 1 and the deck holds no Skwovet — the
    evolution path is another slice's business and this one is about the clause.
    The displaced fix-bigbody lands on the Bench, which is where the
    "a Tool on your BENCH arms nothing" case wants it. */
function greedent(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv01-152"), seat, "fix-energy", 3);
}

/** The seat's opposite. Spelled once here rather than imported, because the
    member is seat-relative and every board case names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** Enhanced Fang is at index 1 — index 0 is the effect-less "Bite". */
const ENHANCED_FANG_INDEX = 1;

describe("the printed sentence — the fixture-text-verbatim guard", () => {
  it("matches FIXTURE_POOL char-for-char", () => {
    const attack = FIXTURE_POOL["sv01-152"]?.attacks?.[ENHANCED_FANG_INDEX];
    expect(attack?.effect).toBe(ENHANCED_FANG);
    // The printed "+" marker — what tells the pipeline a scaling clause is
    // expected at all — and the base the fold starts from.
    expect(attack?.damage).toBe("80+");
    expect(attack?.name).toBe("Enhanced Fang");
    expect(attack?.cost).toEqual(["Colorless", "Colorless", "Colorless"]);
  });

  it("keeps index 0 EFFECT-LESS — so the index above cannot be right by accident", () => {
    const bite = FIXTURE_POOL["sv01-152"]?.attacks?.[0];
    expect(bite?.name).toBe("Bite");
    expect(bite?.damage).toBe(50);
    // No `effect` key AT ALL on the D1 row, not an empty string — the faithful
    // shape, and the reason index 0 derives to null on every path below.
    expect(bite?.effect).toBeUndefined();
    expect(FIXTURE_POOL["sv01-152"]?.attacks).toHaveLength(2);
    expect(FIXTURE_POOL["sv01-152"]?.abilities).toBeNull();
  });

  it("keeps the card facts the damage arithmetic is measured against", () => {
    expect(FIXTURE_POOL["sv01-152"]?.name).toBe("Greedent");
    expect(FIXTURE_POOL["sv01-152"]?.types).toEqual(["Colorless"]); // the fold-order attacker
    expect(FIXTURE_POOL["sv01-152"]?.stage).toBe("Stage1"); // NOT a Basic — see the Charm case
    expect(FIXTURE_POOL["sv01-152"]?.evolveFrom).toBe("Skwovet");
    expect(FIXTURE_POOL["sv01-152"]?.hp).toBe(120);
    expect(FIXTURE_POOL["sv01-152"]?.retreat).toBe(2);
    expect(FIXTURE_POOL["sv01-152"]?.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
    expect(FIXTURE_POOL["sv01-152"]?.resistances).toBeNull();
  });

  it("pins the BYTES — a lookalike character would un-map the clause silently", () => {
    // 77 code points, 79 UTF-8 bytes: the two extra are the é in each "Pokémon".
    // The invariant is `bytes = codePoints + count("Pokémon")`, the same one the
    // predecessor suites carry.
    expect(ENHANCED_FANG.length).toBe(77);
    expect(utf8Bytes(ENHANCED_FANG)).toBe(79);
    expect(ENHANCED_FANG.split("Pokémon")).toHaveLength(3); // two occurrences
    // Precomposed U+00E9, never e + U+0301 — a decomposed é is invisible in a
    // diff and would fail the Map lookup.
    expect(ENHANCED_FANG).toContain("é");
    expect(ENHANCED_FANG).not.toContain("́");
    // No apostrophe of EITHER kind on this row, so the anchor never has to pick.
    expect(ENHANCED_FANG).not.toContain("'");
    expect(ENHANCED_FANG).not.toContain("’");
    // The near-miss COMPANION proves the claim is about this string rather than
    // the module being ASCII-clean by accident: Genesect's sentence carries the
    // same two é AND an ASCII apostrophe ("can't", "their hand").
    expect(ACE_NULLIFIER).toContain("can't");
    expect(utf8Bytes(ACE_NULLIFIER)).toBe(ACE_NULLIFIER.length + 2);
  });
});

describe("deriveAttackDamageBonus — the clause resolves to the new member", () => {
  it("maps Enhanced Fang onto yourActiveHasToolAttached at the printed 80", () => {
    expect(deriveAttackDamageBonus(ENHANCED_FANG)).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "yourActiveHasToolAttached" } },
    });
  });

  it("takes N FROM THE SENTENCE, not from the card", () => {
    for (const per of [10, 30, 250]) {
      expect(deriveAttackDamageBonus(toolClause(per))).toEqual({
        per,
        count: { kind: "boardCondition", cond: { kind: "yourActiveHasToolAttached" } },
      });
    }
    // A printed 0 adds nothing — the guard every arm in this family carries, so
    // it stays LOUD rather than deriving a no-op bonus.
    expect(deriveAttackDamageBonus(toolClause(0))).toBeNull();
  });

  it("is a BARE TAG — the member carries no parameter to get wrong", () => {
    const bonus = deriveAttackDamageBonus(ENHANCED_FANG);
    expect(bonus?.count.kind).toBe("boardCondition");
    if (bonus?.count.kind !== "boardCondition") throw new Error("unreachable");
    expect(Object.keys(bonus.count.cond)).toEqual(["kind"]);
  });
});

describe("the near-misses stay LOUD", () => {
  it("refuses the two REAL Abilities that print this clause's exact words", () => {
    // Byte-identical to ENHANCED_FANG through the comma. Everything that
    // separates them is the consequent, which is exactly what the anchor reads.
    expect(ACE_NULLIFIER.startsWith("If this Pokémon has a Pokémon Tool attached,")).toBe(true);
    expect(ENHANCED_FANG.startsWith("If this Pokémon has a Pokémon Tool attached,")).toBe(true);
    // The same words buried mid-sentence — the `.includes` case.
    expect(CUSTOM_TRAP).toContain("has a Pokémon Tool attached");
    for (const text of [ACE_NULLIFIER, CUSTOM_TRAP]) {
      expect(deriveAttackDamageBonus(text)).toBeNull();
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("refuses CONSTRUCTED rewrites of the clause — the Map key is char-for-char", () => {
    for (const clause of [
      // Plural, and the game does print "Pokémon Tools" elsewhere (Revavroom ex).
      "this Pokémon has 2 Pokémon Tools attached",
      "this Pokémon has any Pokémon Tools attached",
      // "attached to it" is the phrasing Tools use on their own card faces.
      "this Pokémon has a Pokémon Tool attached to it",
      // The article moved — "any" is D118's energy phrasing, not this one's.
      "this Pokémon has any Pokémon Tool attached",
      // De-accented: the exact silent failure the byte guard above exists for.
      "this Pokemon has a Pokemon Tool attached",
      // The BENCH-scoped rewrite, likewise a different board.
      "your Benched Pokémon have a Pokémon Tool attached",
      // A Tool by NAME, which would be `yourBenchHasNamed`'s open-vocabulary trap
      // on a different noun.
      "this Pokémon has a Vitality Band attached",
    ]) {
      expect(deriveAttackDamageBonus(`If ${clause}, this attack does 80 more damage.`)).toBeNull();
    }
  });

  it("🛑🆕🆕 D369 — the OPPONENT-scoped rewrite is a REAL PRINTING, and it was refused HERE", () => {
    // 🛑 THIS RUNG USED TO ASSERT THE WRONG SIDE, AND THE COMMENT BESIDE IT SAID SO
    // OUT LOUD. The list above carried `"your opponent's Active Pokémon has a
    // Pokémon Tool attached"` as a CONSTRUCTED near-miss annotated *"The pool does
    // not print it, and if it ever does it is a different member reading the other
    // board — not this row."* The pool DOES print it — **2 legal printings**, in the
    // committed corpus this repo has shipped since D274 — so half of that sentence
    // was false the day it was written and the other half was the specification for
    // D369. The rewrite is now a real member, and the assertion is POSITIVE.
    //
    // ⚠️ THE BYTE-PIN STAYS AND THE POLARITY MOVES — D136's shape. What this rung
    // asserts is that the two clauses land on TWO DIFFERENT members: the row under
    // test here is unmoved, and the cross-board sentence resolves elsewhere.
    const CROSS_BOARD =
      "If your opponent's Active Pokémon has a Pokémon Tool attached, this attack does 80 more damage.";
    expect(deriveAttackDamageBonus(CROSS_BOARD)).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveHasToolAttached" } },
    });
    // …and THIS row is untouched by that: the self clause still resolves to the self
    // member, which is the only thing this suite ever claimed about it.
    expect(deriveAttackDamageBonus(ENHANCED_FANG)).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "yourActiveHasToolAttached" } },
    });
    // The two clauses differ ONLY in the noun phrase naming the body — everything
    // else is byte-identical — which is why conflating them was the live hazard.
    expect(CROSS_BOARD.replace("your opponent's Active Pokémon", "this Pokémon")).toBe(
      ENHANCED_FANG,
    );
  });

  it("keeps the outer anchor guards on this sentence too", () => {
    for (const text of [
      // Lowercase leading "if" — the matcher has no /i.
      "if this Pokémon has a Pokémon Tool attached, this attack does 80 more damage.",
      // No trailing period is not the whole sentence.
      "If this Pokémon has a Pokémon Tool attached, this attack does 80 more damage",
      // A real trailing clause pins `$`.
      "If this Pokémon has a Pokémon Tool attached, this attack does 80 more damage. Then, draw a card.",
      // Leading text pins `^`.
      "Flip a coin. If this Pokémon has a Pokémon Tool attached, this attack does 80 more damage.",
      // The "×"/multiply twin, which `deriveAttackDamageMultiplier` owns.
      "If this Pokémon has a Pokémon Tool attached, this attack does 80 damage.",
    ]) {
      expect(deriveAttackDamageBonus(text)).toBeNull();
    }
  });
});

describe("deriver disjointness and the index-keyed negatives", () => {
  it("keeps Enhanced Fang off the other two derivers", () => {
    expect(deriveAttackEffect(ENHANCED_FANG)).toBeNull();
    expect(deriveAttackDamageMultiplier(ENHANCED_FANG)).toBeNull();
  });

  it("derives NOTHING from Greedent's index 0", () => {
    const bite = FIXTURE_POOL["sv01-152"]?.attacks?.[0];
    expect(bite?.effect).toBeUndefined();
    // The whole cast, so the claim is about the card and not about one string.
    for (const attack of FIXTURE_POOL["sv01-152"]?.attacks ?? []) {
      if (attack.effect === undefined || attack.effect === "") continue;
      expect(attack.effect).toBe(ENHANCED_FANG);
    }
  });
});

describe("ZERO registry rows — the card derives straight off its printed text", () => {
  it("has no program of any kind for sv01-152", () => {
    expect(programFor("sv01-152")).toBeUndefined();
    expect(programFor("sv01-152")?.attack).toBeUndefined();
    expect(programFor("sv01-152")?.passive).toBeUndefined();
  });

  it("keeps the TOOLS authored, which is what makes the board cases real", () => {
    // The clause is unauthored; the Tools that arm it are not. Bravery Charm's
    // passive is an HP bonus for BASICS and Vitality Band's is a pre-W/R damage
    // bonus — the two halves of the "the Tool's own passive is not the clause"
    // pair below.
    expect(programFor("sv02-173")?.passive).toEqual({ basicHpBonus: 50 });
    expect(programFor("sv01-197")?.passive).toEqual({ damageBonusBeforeWR: 10 });
  });
});

describe("the board — Enhanced Fang through a real attack", () => {
  it("scores the printed 80 with NO Tool attached (the control)", () => {
    const state = greedent(board(11), "p1");
    expect(state.players.p1.active?.tools).toEqual([]);
    const { events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ENHANCED_FANG_INDEX,
    });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(80);
  });

  it("scores 160 with Bravery Charm — the SILENT arm", () => {
    const state = attachToolFromDeck(greedent(board(11), "p1"), "p1", "active", "sv02-173");
    expect(state.players.p1.active?.tools).toHaveLength(1);
    // Greedent is a STAGE 1, so the Charm's +50 does not apply — every point of
    // the 80-point swing is the clause's, and nothing else on the board moved.
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    expect(effectiveMaxHp(state, active)).toBe(120);
    const { events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ENHANCED_FANG_INDEX,
    });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(160);
  });

  it("scores 170 with Vitality Band — the clause and the Tool's own passive STACK", () => {
    const state = attachToolFromDeck(greedent(board(11), "p1"), "p1", "active", "sv01-197");
    const { events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ENHANCED_FANG_INDEX,
    });
    // 80 base + 80 clause + 10 the Band's own damageBonusBeforeWR, all in the
    // same pre-W/R step. The 10 over the Charm's 160 is the whole point: a fold
    // that read the Tool's passive AS the clause would score these two the same.
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(170);
  });

  it("is armed BY THE GAME — a real §7.4 attachTool, not surgery", () => {
    let state = greedent(board(11), "p1");
    state = handFromDeck(state, "p1", "sv02-173", 1);
    const charm = handUid(state, "p1", "sv02-173");
    const attached = mustApply(state, {
      type: "attachTool",
      seat: "p1",
      uid: charm,
      target: { spot: "active" },
    });
    expect(types(attached.events)).toContain("TOOL_ATTACHED");
    expect(attached.state.players.p1.active?.tools).toEqual([charm]);
    const { events } = mustApply(attached.state, {
      type: "attack",
      seat: "p1",
      index: ENHANCED_FANG_INDEX,
    });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(160);
  });

  it("reads YOUR ACTIVE — a Tool on your own BENCH arms nothing", () => {
    // greedent() displaces the pinned fix-bigbody onto the Bench, so this is the
    // same board as the control with one Tool moved one spot.
    const state = attachToolFromDeck(greedent(board(11), "p1"), "p1", 0, "sv02-173");
    expect(state.players.p1.bench[0]?.tools).toHaveLength(1);
    expect(state.players.p1.active?.tools).toEqual([]);
    const { events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: ENHANCED_FANG_INDEX,
    });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(80);
  });

  it("reads YOUR side — a Tool on the DEFENDER arms nothing (both seats)", () => {
    for (const seat of ["p1", "p2"] as const) {
      const opened = seat === "p1" ? board(11) : boardP2(11);
      const state = attachToolFromDeck(greedent(opened, seat), other(seat), "active", "sv02-173");
      expect(state.players[other(seat)].active?.tools).toHaveLength(1);
      const { events } = mustApply(state, {
        type: "attack",
        seat,
        index: ENHANCED_FANG_INDEX,
      });
      expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(80);
      // …and the SAME Tool on the attacker's own Active does arm it, from the
      // same seat, so the case is not passing for want of a Tool anywhere.
      const mine = attachToolFromDeck(greedent(opened, seat), seat, "active", "sv02-173");
      expect(
        find(
          mustApply(mine, { type: "attack", seat, index: ENHANCED_FANG_INDEX }).events,
          "DAMAGE_DEALT",
        )?.dealt,
      ).toBe(160);
    }
  });

  it("folds BEFORE Weakness (§8.5) — (80 + 80) × 2 = 320", () => {
    const opened = setActiveFromDeck(board(11), "p2", "fix-colorless-weak");
    const control = greedent(opened, "p1");
    expect(
      find(
        mustApply(control, { type: "attack", seat: "p1", index: ENHANCED_FANG_INDEX }).events,
        "DAMAGE_DEALT",
      )?.dealt,
    ).toBe(160);
    const armed = attachToolFromDeck(control, "p1", "active", "sv02-173");
    expect(
      find(
        mustApply(armed, { type: "attack", seat: "p1", index: ENHANCED_FANG_INDEX }).events,
        "DAMAGE_DEALT",
      )?.dealt,
    ).toBe(320);
  });

  it("emits NO ATTACK_EFFECT_SKIPPED in EITHER direction", () => {
    const control = greedent(board(11), "p1");
    const armed = attachToolFromDeck(control, "p1", "active", "sv02-173");
    for (const state of [control, armed]) {
      const { events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: ENHANCED_FANG_INDEX,
      });
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
  });
});

describe("conditionHolds / conditionNote — the member read directly", () => {
  it("is false with no Tool and true with one, on both seats", () => {
    for (const seat of ["p1", "p2"] as const) {
      const bare = greedent(seat === "p1" ? board(11) : boardP2(11), seat);
      expect(conditionHolds(bare, seat, { kind: "yourActiveHasToolAttached" })).toBe(false);
      expect(conditionHolds(bare, other(seat), { kind: "yourActiveHasToolAttached" })).toBe(false);
      const armed = attachToolFromDeck(bare, seat, "active", "sv02-173");
      expect(conditionHolds(armed, seat, { kind: "yourActiveHasToolAttached" })).toBe(true);
      // Seat asymmetry: arming one side never arms the other.
      expect(conditionHolds(armed, other(seat), { kind: "yourActiveHasToolAttached" })).toBe(false);
    }
  });

  it("is TRUE above §7.4's one-Tool cap — `> 0`, never `=== 1`", () => {
    // Revavroom ex "Tune-Up" raises the cap to 4 in the real game, so a second
    // Tool must not un-arm the clause. Surgery, because the attach gate is what
    // enforces the cap the Ability lifts.
    let state = greedent(board(11), "p1");
    state = attachToolFromDeck(state, "p1", "active", "sv02-173");
    state = attachToolFromDeck(state, "p1", "active", "sv01-197");
    expect(state.players.p1.active?.tools).toHaveLength(2);
    expect(conditionHolds(state, "p1", { kind: "yourActiveHasToolAttached" })).toBe(true);
  });

  it("is FALSE with an empty Active Spot", () => {
    const state = board(11);
    const emptied: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: null } },
    };
    expect(conditionHolds(emptied, "p1", { kind: "yourActiveHasToolAttached" })).toBe(false);
  });

  it("reads the Active only — a benched Tool leaves it false", () => {
    let state = greedent(board(11), "p1");
    state = benchFromDeck(state, "p1", "fix-bigbody");
    const benched = attachToolFromDeck(state, "p1", 0, "sv02-173");
    expect(benched.players.p1.bench[0]?.tools).toHaveLength(1);
    expect(conditionHolds(benched, "p1", { kind: "yourActiveHasToolAttached" })).toBe(false);
  });

  it("prints the clause with the pronoun resolved", () => {
    expect(conditionNote({ kind: "yourActiveHasToolAttached" })).toBe(
      "your Active Pokémon has a Pokémon Tool attached",
    );
    // The printed sentence with "this Pokémon" swapped for what it means and
    // nothing else dropped — this clause carries no timing word and no glyph.
    expect(ENHANCED_FANG).toContain("this Pokémon has a Pokémon Tool attached");
  });
});

describe("purity", () => {
  it("mutates nothing when the condition is read on a frozen board", () => {
    const bare = deepFreeze(greedent(board(11), "p1"));
    expect(conditionHolds(bare, "p1", { kind: "yourActiveHasToolAttached" })).toBe(false);
    const armed = deepFreeze(
      attachToolFromDeck(greedent(board(11), "p1"), "p1", "active", "sv02-173"),
    );
    expect(conditionHolds(armed, "p1", { kind: "yourActiveHasToolAttached" })).toBe(true);
    expect(conditionHolds(armed, "p2", { kind: "yourActiveHasToolAttached" })).toBe(false);
  });
});
