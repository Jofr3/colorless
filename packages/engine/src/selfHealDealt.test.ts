import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import type { EffectOp } from "./effectTypes";
import { applyAction } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  SELF_ENERGY_HAND_DECK,
  SELF_HEAL_DEALT_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
  findEvent,
  roundTrip,
} from "./testFixtures";

const LOUD_SENTENCE = "Heal 100 damage from 1 of your Benched Ancient Pokémon.";

const SEED = 7;

const SENTENCE =
  "Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon.";

/** The whole program the sentence derives to. One op, no gate, no wrapper. */
const PROGRAM: readonly EffectOp[] = [{ op: "heal", target: "self", amount: "dealt" }];

const IDX = { fifty: 0, twoHundred: 1, noDamage: 2, loud: 3 } as const;

const other = (seat: Seat): Seat => (seat === "p1" ? "p2" : "p1");

function board(defender: string, healerDamage: number, seat: Seat = "p1"): GameState {
  const decks = { p1: SELF_HEAL_DEALT_DECK, p2: SELF_HEAL_DEALT_DECK };
  let state = driveSetup(SEED, decks, { first: other(seat) });
  state = setActiveFromDeck(state, seat, "fix-suction");
  state = setActiveFromDeck(state, other(seat), defender);
  state = attachFromDeck(state, seat, "fix-energy", 3);
  state = setDamage(state, seat, healerDamage);
  return mustApply(state, { type: "endTurn", seat: other(seat) }).state;
}

function swing(
  state: GameState,
  index: number,
  seat: Seat = "p1",
): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat, index });
}

function dealtAndHealed(events: GameEvent[]): {
  base: number | undefined;
  dealt: number | undefined;
  healed: number | undefined;
} {
  const damage = findEvent(events, "DAMAGE_DEALT");
  const healed = findEvent(events, "HEALED");
  return { base: damage?.base, dealt: damage?.dealt, healed: healed?.amount };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, and why the anchor is a LITERAL.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — one sentence, six printings, no sibling to generalise over", () => {
  it("the corpus prints exactly this sentence at exactly this count", () => {
    const rows = legalAttackCorpus().filter(([, text]) => text === SENTENCE);
    expect(rows).toEqual([[6, SENTENCE]]);
  });

  it("the LOOSEST plausible family grep returns exactly ONE row — so a template would author a card", () => {
    const LOOSE = /same amount of damage|damage you did|amount of damage/i;
    const family = legalAttackCorpus().filter(([, text]) => LOOSE.test(text));
    expect(family).toEqual([[6, SENTENCE]]);
    expect(LOOSE.test("This attack does 30 more damage.")).toBe(false);
    expect(LOOSE.test("Heal 30 damage from this Pokémon.")).toBe(false);
    expect(LOOSE.test("Heal the same amount of damage.")).toBe(true);
  });

  it("the apostrophe byte is U+0027, and the corpus holds no U+2019 anywhere", () => {
    expect(SENTENCE).toContain("opponent's");
    expect(SENTENCE).not.toContain("’");
    expect(legalAttackCorpus().filter(([, text]) => text.includes("’"))).toEqual([]);
    expect(deriveAttackEffect(SENTENCE.replace("'", "’"))).toEqual(PROGRAM);
  });

  it("the fixture prints the sentence VERBATIM at three indices, and AUTHORS nothing", () => {
    const card = FIXTURE_POOL["fix-suction"];
    if (card === undefined) throw new Error("fix-suction missing from FIXTURE_POOL");
    const attacks = card.attacks ?? [];
    expect(attacks.map((attack) => attack.effect)).toEqual([
      SENTENCE,
      SENTENCE,
      SENTENCE,
      LOUD_SENTENCE,
    ]);
    expect(legalAttackCorpus().filter(([, text]) => text === LOUD_SENTENCE)).toEqual([
      [1, LOUD_SENTENCE],
    ]);
    // Every scalar around the sentence is CHOSEN and says so; only the TEXT is read
    // off the catalog. The printed damages are the suite's whole variable.
    expect(attacks.map((attack) => attack.damage)).toEqual([50, 200, undefined, 50]);
  });

  it("the six carriers cannot be enumerated in this checkout, and that is stated not invented", () => {
    expect(Object.keys(FIXTURE_POOL)).not.toContain("sv06.5-009");
    expect(legalAttackCorpus().filter(([, text]) => text === SENTENCE)[0]?.[0]).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the derivation: one anchor, one arm, one op.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the derivation, and the boundaries the anchor holds", () => {
  it("derives exactly one `heal` op whose amount is the SOURCE, not a number", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual(PROGRAM);
  });

  it("ZERO new readers — the arm is inside `deriveAttackEffect`, and the surface is unmoved", () => {
    expect(attackReaderSurface()).toHaveLength(14);
    expect(attackReaderSurface()).toContain("deriveAttackEffect");
    expect(attackReaderSurface().filter((name) => /Heal|Dealt/i.test(name))).toEqual([]);
  });

  it("the sentence is claimed WHOLE — neither splitter is involved, and no registry row is", () => {
    expect(resolvedByAnyReader(SENTENCE)).toBe(true);
    expect(splitAttackGateClause(SENTENCE)).toBeNull();
    expect(splitAttackTrailingClause(SENTENCE)).toBeNull();
  });

  it("refuses each near-miss — and ADMITS one on the same axis beside each (D424)", () => {
    const REFUSED = [
      // the WRONG SIDE: healing the opponent is not printed anywhere
      "Heal from your opponent's Active Pokémon the same amount of damage you did to this Pokémon.",
      `This Pokémon is now Asleep. ${SENTENCE}`,
      // a TRAILING clause — `\.$` is the only thing that refuses it. An anchor
      // without it claims the head and silently drops the status the card prints.
      `${SENTENCE} This Pokémon is now Asleep.`,
      // …and the COMMA-joined trailing form as well, which `splitAttackTrailingClause`
      // cannot reach either (its BREAK is a sentence boundary, not a comma).
      `${SENTENCE.slice(0, -1)}, and this Pokémon is now Asleep.`,
      // lowercased throughout: no /i flag, deliberately
      SENTENCE.toLowerCase(),
    ] as const;
    for (const text of REFUSED) expect(deriveAttackEffect(text), text).toBeNull();
    const ADMITTED = [
      // same reader, same op family, a LITERAL amount — proves the reader still says yes
      ["Heal 30 damage from this Pokémon.", [{ op: "heal", target: "self", amount: 30 }]],
      // same anchor, the other apostrophe byte
      [SENTENCE.replace("'", "’"), PROGRAM],
      // the anchor itself, unmodified
      [SENTENCE, PROGRAM],
    ] as const;
    for (const [text, program] of ADMITTED) expect(deriveAttackEffect(text), text).toEqual(program);
  });

  it("exactly ONE corpus sentence is newly claimed — the arm's blast radius, measured", () => {
    const dealtRows = legalAttackCorpus().filter(([, text]) =>
      ((deriveAttackEffect(text) ?? []) as EffectOp[]).some(
        (op) => op.op === "heal" && op.amount === "dealt",
      ),
    );
    expect(dealtRows).toEqual([[6, SENTENCE]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the CARRIER, and the version prediction driven both directions.
// ─────────────────────────────────────────────────────────────────────────────

function parkedMidAttack(): GameState {
  const decks = { p1: SELF_ENERGY_HAND_DECK, p2: SELF_ENERGY_HAND_DECK };
  let state = driveSetup(SEED, decks, { first: "p2" });
  state = setActiveFromDeck(state, "p1", "fix-selfenergyhand");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  return swing(state, 0).state;
}

function contOf(state: GameState): { ctx: Record<string, unknown>; rest: EffectOp[] } {
  const phase = state.phase;
  if (phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${phase.kind}`);
  return (phase as unknown as { cont: { ctx: Record<string, unknown>; rest: EffectOp[] } }).cont;
}

describe("§3 — the carrier is `EffectContext`, and `MATCH_RECORD_VERSION` stays 26", () => {
  it("`EffectRecord` ~~could not have held it~~ ( D579 (D539): WITHDRAWN as absolute — `placed` files a COUNT as repeated uids; the figure stays on `ctx.dealt` by CHOICE) — every slot's value type is a LIST OF UIDS", () => {
    const cont = contOf(parkedMidAttack());
    const record = (cont as unknown as { record?: Record<string, unknown> }).record ?? {};
    for (const value of Object.values(record)) {
      expect(Array.isArray(value)).toBe(true);
      for (const entry of value as unknown[]) expect(typeof entry).toBe("string");
    }
    // …and the CONTROL the rung above needs: the context DOES carry a number, on the
    // same continuation, in the same JSON. The two shapes are not interchangeable.
    expect(typeof cont.ctx.dealt).toBe("number");
  });

  it("the value RIDES A PARK — this is why the version question is live at all", () => {
    const state = parkedMidAttack();
    const cont = contOf(state);
    // `fix-selfenergyhand` prints 30 and the defender is neutral, so §8.5 arrives at
    // 30 and THAT is the number written into the persisted phase.
    expect(cont.ctx).toEqual({
      seat: "p1",
      sourceUid: cont.ctx.sourceUid,
      invokedBy: "attack",
      dealt: 30,
    });
    const revived = roundTrip(state);
    expect(Object.keys(contOf(revived).ctx).sort()).toEqual([
      "dealt",
      "invokedBy",
      "seat",
      "sourceUid",
    ]);
  });

  it('`invokedBy === "attack"` ⟺ `dealt !== undefined`, on every continuation this engine writes', () => {
    const ctx = contOf(parkedMidAttack()).ctx;
    expect(ctx.invokedBy === "attack").toBe(ctx.dealt !== undefined);
    const nonAttack = legalAttackCorpus().filter(([, text]) =>
      ((deriveAttackEffect(text) ?? []) as EffectOp[]).some(
        (op) => op.op === "heal" && op.amount === "dealt",
      ),
    );
    expect(nonAttack).toHaveLength(1);
  });

  it("the version PREDICTION, driven both directions: this is a WIDENING", () => {
    const parked = parkedMidAttack();
    const revived = roundTrip(parked);
    const phase = revived.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const legacy = phase as unknown as { cont: { ctx: Record<string, unknown> } };
    legacy.cont.ctx = Object.fromEntries(
      Object.entries(legacy.cont.ctx).filter(([key]) => key !== "dealt"),
    );
    expect(Object.keys(legacy.cont.ctx).sort()).toEqual(["invokedBy", "seat", "sourceUid"]);
    const prompt = phase.prompt;
    if (prompt?.kind !== "discardEnergy") throw new Error("expected a discardEnergy prompt");
    const chosen = prompt.discardable[0]?.uid as string;
    const resolvedLegacy = mustApply(revived, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen] },
    }).state;
    const resolvedToday = mustApply(roundTrip(parked), {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen] },
    }).state;
    expect(resolvedLegacy.players.p1.hand).toEqual(resolvedToday.players.p1.hand);
    expect(resolvedLegacy.players.p1.active).toEqual(resolvedToday.players.p1.active);

    const legacyOp: EffectOp = { op: "heal", target: "self", amount: 30 };
    expect(deriveAttackEffect("Heal 30 damage from this Pokémon.")).toEqual([legacyOp]);
    const withLegacyTail = roundTrip(parked);
    const tail = withLegacyTail.phase;
    if (tail.kind !== "effect:choose") throw new Error("expected effect:choose");
    (tail as unknown as { cont: { rest: EffectOp[] } }).cont.rest = [legacyOp];
    // The healer took no damage on this board, so a 30-point heal has nothing to do
    // and whiffs; what matters is that the OLD op still parses, still dispatches and
    // still resolves rather than throwing on an unrecognised `amount`.
    const drained = mustApply(withLegacyTail, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen] },
    });
    expect(drained.state.phase.kind).not.toBe("effect:choose");
    // …and the same tail with a DAMAGED healer really does heal the literal 30, which
    // is the half that proves the arm ran rather than that it was skipped.
    const damagedTail = roundTrip(parked);
    const dPhase = damagedTail.phase;
    if (dPhase.kind !== "effect:choose") throw new Error("expected effect:choose");
    (dPhase as unknown as { cont: { rest: EffectOp[] } }).cont.rest = [legacyOp];
    const hurt = setDamage(damagedTail, "p1", 60);
    const healedLegacy = mustApply(hurt, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen] },
    });
    expect(findEvent(healedLegacy.events, "HEALED")?.amount).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the amount is the FINAL figure, not the printed base.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — post-Weakness, post-Resistance, post-reduction: the DEALT amount", () => {
  it("ONE printed 50, THREE defenders, THREE heals — base and dealt come apart in BOTH directions", () => {
    const HEALER_DAMAGE = 150;
    const cases = [
      ["fix-drainwall", 50], // no Weakness, no Resistance, no aura — dealt === base
      ["fix-drainweak", 100], // ×2 Fire — dealt is DOUBLE the base
      ["sv02-113", 40], // Hariyama's seat-wide −10 after W/R — dealt is BELOW the base
    ] as const;
    for (const [defender, expected] of cases) {
      const { events } = swing(board(defender, HEALER_DAMAGE), IDX.fifty);
      const { base, dealt, healed } = dealtAndHealed(events);
      expect(base, defender).toBe(50);
      expect(dealt, defender).toBe(expected);
      expect(healed, defender).toBe(expected);
    }
    // …and the three answers are genuinely DISTINCT, so no single constant satisfies
    // all three — the rung cannot pass against a build that healed any fixed number.
    expect(new Set(cases.map(([, expected]) => expected)).size).toBe(3);
  });

  it("the reduction is the pipeline's LAST step, and it is read AFTER Weakness — one board says so", () => {
    const reduced = dealtAndHealed(swing(board("sv02-113", 150), IDX.fifty).events);
    const doubled = dealtAndHealed(swing(board("fix-drainweak", 150), IDX.fifty).events);
    const flat = dealtAndHealed(swing(board("fix-drainwall", 150), IDX.fifty).events);
    expect([flat.dealt, doubled.dealt, reduced.dealt]).toEqual([50, 100, 40]);
    expect([flat.healed, doubled.healed, reduced.healed]).toEqual([50, 100, 40]);
  });

  it("the healed amount EQUALS `DAMAGE_DEALT.dealt` on every board that heals — one identity, swept", () => {
    for (const [defender, healerDamage] of [
      ["fix-drainwall", 150],
      ["fix-drainweak", 150],
      ["sv02-113", 150],
      ["fix-drainwall", 20],
      ["fix-wall", 150],
    ] as const) {
      const index = defender === "fix-wall" ? IDX.twoHundred : IDX.fifty;
      const { events } = swing(board(defender, healerDamage), index);
      const { dealt, healed } = dealtAndHealed(events);
      expect(healed, defender).toBe(Math.min(dealt ?? 0, healerDamage));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the clamp: you cannot heal more damage than is on the healer.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the clamp is the healer's own damage, and it is `healSelf`'s, not a new one", () => {
  it("an attacker with 20 damage that deals 100 heals 20, not 100", () => {
    const { state, events } = swing(board("fix-drainweak", 20), IDX.fifty);
    const { dealt, healed } = dealtAndHealed(events);
    expect(dealt).toBe(100);
    expect(healed).toBe(20);
    expect(state.players.p1.active?.damage).toBe(0);
  });

  it("an UNDAMAGED healer whiffs SILENTLY — no HEALED row, and that is not a skipped effect", () => {
    const { state, events } = swing(board("fix-drainwall", 0), IDX.fifty);
    expect(dealtAndHealed(events).dealt).toBe(50);
    expect(findEvent(events, "HEALED")).toBeUndefined();
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(state.players.p1.active?.damage).toBe(0);
  });

  it("a healer damaged EXACTLY as much as it dealt heals all of it — the clamp's boundary", () => {
    const { state, events } = swing(board("fix-drainwall", 50), IDX.fifty);
    expect(dealtAndHealed(events).healed).toBe(50);
    expect(state.players.p1.active?.damage).toBe(0);
  });

  it("the clamp is the SHIPPED one — the literal-amount heal answers identically", () => {
    const literal = deriveAttackEffect("Heal 30 damage from this Pokémon.");
    expect(literal).toEqual([{ op: "heal", target: "self", amount: 30 }]);
    const { events } = swing(board("fix-drainwall", 20), IDX.fifty);
    expect(dealtAndHealed(events).healed).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the zero cases: prevention, a whiffed attack, an absent defender.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — every way the amount is zero, and each one is silent rather than loud", () => {
  it("PREVENTED damage means `dealt` is 0, so the heal is 0 and no HEALED row is emitted", () => {
    const { state, events } = swing(board("fix-imperviousshell", 150), IDX.twoHundred);
    const damage = findEvent(events, "DAMAGE_DEALT");
    expect(damage?.base).toBe(200);
    expect(damage?.prevented).toBe(true);
    expect(damage?.dealt).toBe(0);
    expect(findEvent(events, "HEALED")).toBeUndefined();
    expect(state.players.p1.active?.damage).toBe(150);
    const open = swing(board("fix-wall", 150), IDX.twoHundred);
    expect(dealtAndHealed(open.events).dealt).toBe(200);
    expect(dealtAndHealed(open.events).healed).toBe(150);
  });

  it("an attack with NO printed damage never runs the §8.5 block — the hoisted 0 IS the semantics", () => {
    // Index 2 prints the sentence and no damage at all, so
    // `scaledBase + scaledTotal > 0` is false, `dealtToDefender` keeps its
    // initialiser, and "the same amount of damage you did" is correctly none.
    const { state, events } = swing(board("fix-drainwall", 150), IDX.noDamage);
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(findEvent(events, "HEALED")).toBeUndefined();
    expect(state.players.p1.active?.damage).toBe(150);
    expect(state.players.p2.active?.damage).toBe(0);
  });

  it("an ABSENT defender is refused by the turn gate — the program never runs at all", () => {
    const state = board("fix-drainwall", 150);
    const empty: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, active: null } },
    };
    const result = applyAction(empty, { type: "attack", seat: "p1", index: IDX.fifty });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected NO_TARGET");
    expect(result.error.code).toBe("NO_TARGET");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the Knock Out, the §8.5 ordering, and the loud path's control.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — a Knocked Out defender changes nothing about what was dealt", () => {
  it("a 200 into a 120-HP body deals 200, heals 200-worth, and THEN Knocks Out", () => {
    // `dealt` is deliberately unclamped by the defender's remaining HP (§8.1's own
    // comment says so), so the printed "damage you did" is 200 and not 120. The heal
    // is still bounded by the HEALER, which is a different clamp entirely.
    const { events } = swing(board("fix-wall", 150), IDX.twoHundred);
    const { dealt, healed } = dealtAndHealed(events);
    expect(dealt).toBe(200);
    expect(healed).toBe(150);
    expect(types(events)).toContain("KNOCKED_OUT");
  });

  it("the ORDER is printed order: DAMAGE_DEALT, then HEALED, then the KO sweep", () => {
    // §8 step 4 — the attack's own effect program runs AFTER the damage and BEFORE
    // finishAttack's §8.1 sweep. A build that ran the program first would read a
    // `dealt` that had not happened yet.
    const order = types(swing(board("fix-wall", 150), IDX.twoHundred).events);
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("HEALED"));
    expect(order.indexOf("HEALED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    expect(order[0]).toBe("ATTACK_DECLARED");
  });

  it("no ATTACK_EFFECT_SKIPPED in EITHER direction — and index 3 is the control that skips", () => {
    for (const [defender, healerDamage, index] of [
      ["fix-drainwall", 150, IDX.fifty],
      ["fix-drainweak", 150, IDX.fifty],
      ["sv02-113", 150, IDX.fifty],
      ["fix-drainwall", 0, IDX.fifty],
      ["fix-imperviousshell", 150, IDX.twoHundred],
      ["fix-drainwall", 150, IDX.noDamage],
      ["fix-wall", 150, IDX.twoHundred],
    ] as const) {
      const label = `${defender}/${String(index)}/${String(healerDamage)}`;
      const { events } = swing(board(defender, healerDamage), index);
      expect(types(events), label).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
    const loud = swing(board("fix-drainwall", 150), IDX.loud);
    expect(types(loud.events)).toContain("ATTACK_EFFECT_SKIPPED");
    expect(resolvedByAnyReader(LOUD_SENTENCE)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — both seats, and the board is not mutated.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — both chairs, and a frozen board resolves", () => {
  it("p2 attacking heals p2's Active off the damage p2 dealt — the seat is not hard-coded", () => {
    for (const seat of ["p1", "p2"] as const) {
      const { state, events } = swing(board("fix-drainweak", 150, seat), IDX.fifty, seat);
      const { dealt, healed } = dealtAndHealed(events);
      expect(dealt, seat).toBe(100);
      expect(healed, seat).toBe(100);
      expect(findEvent(events, "HEALED")?.seat, seat).toBe(seat);
      // the HEALER moved, and the DEFENDER took the damage — not the other way round
      expect(state.players[seat].active?.damage, seat).toBe(50);
      expect(state.players[other(seat)].active?.damage, seat).toBe(100);
    }
  });

  it("the board is not mutated — a deep-frozen state resolves in both the heal and the whiff case", () => {
    for (const [defender, healerDamage, index] of [
      ["fix-drainweak", 150, IDX.fifty],
      ["fix-imperviousshell", 150, IDX.twoHundred],
    ] as const) {
      const frozen = deepFreeze(board(defender, healerDamage));
      const { events } = swing(frozen, index);
      expect(types(events)[0], defender).toBe("ATTACK_DECLARED");
    }
  });
});
