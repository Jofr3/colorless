import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { applyDamageModifier } from "./cards";
import type { DamageModifier } from "./cards";
import { type LogContext, logFromEvents } from "./log";
import {
  ATTACK_DEBUFF_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setPrizes,
  types,
  walkProgram,
} from "./testFixtures";

// 0.97.0 → 0.98.0 — the ATTACKER-SIDE DAMAGE DEBUFF (P3-M5 long tail, D149):
//
//   "During your opponent's next turn, the Defending Pokémon's attacks do
//    {20|30} less damage (before applying Weakness and Resistance)."      (3)
//   "During your opponent's next turn, attacks used by the Defending Pokémon
//    do 100 less damage (before applying Weakness and Resistance)."       (2)
//
// D147's MIRROR ON BOTH AXES AT ONCE, which is the whole slice: that record is
// installed on the ATTACKER's own body and subtracted from what it TAKES after
// Weakness and Resistance; this one is installed on the DEFENDER's body and
// subtracted from what it DEALS before them. The printed sentences are told apart
// by ONE WORD inside the parenthetical, so the two anchors carry it.
//
// ⚠️ THE RESUME LIST QUOTED ONE SENTENCE AND THE POOL PRINTS TWO. Three of the
// five printings say "the Defending Pokémon'S ATTACKS DO"; two say "ATTACKS USED
// BY the Defending Pokémon DO". Same mechanism, same amount slot, same
// parenthetical, different subject noun phrase — so TWO anchored whole-sentence
// patterns (D136/D137), sharing their OP and asserted to share it byte for byte.
//
// ⚠️ THE STEP ORDER IS DRIVEN IN BOTH DIRECTIONS, NOT ASSERTED. Every DAMAGE_DEALT
// row here is re-derived from its OWN reported fields in both placements
// (`pipeline` below), through the engine's own `applyDamageModifier`, and the two
// are asserted to DIFFER wherever a Weakness is present. Resistance and this
// number are both additive and commute — D147's finding, read on the other side of
// §8.5 — so the parenthetical can only ever bite on the MULTIPLICATIVE step, which
// is why every board here is a pair of cards chosen for a Weakness line.

/** Sentence ONE at each printed amount — the majority spelling (3 of 5). */
function possessive(amount: number): string {
  return `During your opponent's next turn, the Defending Pokémon's attacks do ${String(amount)} less damage (before applying Weakness and Resistance).`;
}
/** Sentence TWO at each printed amount — Houndoom sv06.5-008/-066 "Snarl". */
function usedBy(amount: number): string {
  return `During your opponent's next turn, attacks used by the Defending Pokémon do ${String(amount)} less damage (before applying Weakness and Resistance).`;
}
/** Entei sv03-030 "Pressure" — the ALWAYS-ON member of this exact mechanism, and
    the one printing this slice deliberately leaves LOUD. It is an ABILITY and a
    CROSS-BOARD aura (an Active clause on the SOURCE and on the TARGET), which is
    `opposingRetreatBlocked`'s shape rather than a stamp's, so it wants a
    `PassiveEffects` sibling and a scan of its own. */
const ALWAYS_ON =
  "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 20 less damage (before applying Weakness and Resistance).";
/** D147's sentence — the OTHER parenthetical, on the opposite body at the opposite
    step. Must never derive here, and this one must never derive there. */
const AFTER_WR =
  "During your opponent's next turn, this Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance).";

/** One seed for the whole suite. Nothing in this family flips a coin — no printing
    of either sentence carries one — so a seed table would describe a shuffle rather
    than a rule, and the install cases pin that with an unchanged `rngState`
    (D143's move, inherited by `classBlock` and `damageReduction`). */
const SEED = 7;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** ⚠️ THE ORDERING ORACLE — §8.5's pre-W/R step computed BOTH WAYS from a row's
    own reported fields, so the pin is on the ENGINE's arithmetic rather than on a
    number a test author typed. It is `damageReduction.test.ts`'s oracle with the
    subtraction moved to the other end of the pipeline, which is the whole
    relationship between the two slices.

    `beforeWR` is the printed reading: (base + bonus − debuff), clamped, then
    ×Weakness → −Resistance → clamp → −reduction → clamp. `afterWR` is the only
    other placement a build could plausibly choose: run the modifiers on the raw
    base and take the debuff off at the end. Every damage row in this suite is
    checked against `beforeWR`, and every row reporting a Weakness is additionally
    asserted to DIFFER from `afterWR`. */
function pipeline(row: {
  base: number;
  scaled?: number;
  bonus?: number;
  debuff?: number;
  weakness: DamageModifier | null;
  resistance: DamageModifier | null;
  reduction?: number;
}): { beforeWR: number; afterWR: number } {
  const raw = row.base + (row.scaled ?? 0) + (row.bonus ?? 0);
  const debuff = row.debuff ?? 0;
  const reduction = row.reduction ?? 0;
  // The engine's OWN modifier fold (cards.ts), reused rather than re-implemented:
  // this oracle is about the ORDER of the steps, and re-deriving what "×2" means
  // would let a bug in that function hide behind a matching bug here.
  const modify = (value: number): number =>
    Math.max(0, applyDamageModifier(applyDamageModifier(value, row.weakness), row.resistance));
  return {
    beforeWR: Math.max(0, modify(Math.max(0, raw - debuff)) - reduction),
    afterWR: Math.max(0, modify(raw) - debuff - reduction),
  };
}

/** Assert a damage row is the BEFORE-W/R reading, and — when the row reports a
    Weakness — that the two readings really are different numbers on this board.
    Called on every driven hit, so the ordering claim is swept rather than
    spot-checked. */
function expectBeforeWR(row: Extract<GameEvent, { type: "DAMAGE_DEALT" }>): void {
  const { beforeWR, afterWR } = pipeline(row);
  expect(row.dealt).toBe(row.prevented === true ? 0 : beforeWR);
  if (row.weakness !== null && (row.debuff ?? 0) > 0 && row.prevented !== true) {
    expect(beforeWR).not.toBe(afterWR);
    expect(row.dealt).not.toBe(afterWR);
  }
}

/** The four printed installers and everything a declaration of theirs needs: the
    attack INDEX (not constant — Houndoom's sits at 1), the energy, the printed
    amount the install must write, and the printed damage the declaration itself
    does. Read off the local D1 per printing (D144's rule, D146's names). */
const INSTALLERS = {
  "sv02-062": { index: 0, amount: 20, energy: [{ id: "fix-energy", count: 1 }], hit: 0 },
  "swsh10.5-061": { index: 0, amount: 20, energy: [{ id: "fix-energy", count: 1 }], hit: 0 },
  "sv01-093": {
    index: 0,
    amount: 30,
    energy: [
      { id: "fix-psychic-energy", count: 1 },
      { id: "fix-energy", count: 2 },
    ],
    hit: 120,
  },
  "sv06.5-008": {
    index: 1,
    amount: 100,
    energy: [
      { id: "fix-fire-energy", count: 1 },
      { id: "fix-energy", count: 2 },
    ],
    hit: 100,
  },
} as const;

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. The
    INSTALLER goes on P1's Active and the VICTIM on P2's — and the victim has to be
    in place BEFORE the declaration, because "the Defending Pokémon" is the body
    that was Active when the attack RESOLVED (§8 step 5). */
function armed(
  installer: keyof typeof INSTALLERS,
  victim: string,
  victimEnergy: { id: string; count: number }[] = [],
): GameState {
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: ATTACK_DEBUFF_DECK, p2: ATTACK_DEBUFF_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", installer);
  for (const { id, count } of INSTALLERS[installer].energy) {
    state = attachFromDeck(state, "p1", id, count);
  }
  state = setActiveFromDeck(state, "p2", victim);
  for (const { id, count } of victimEnergy) state = attachFromDeck(state, "p2", id, count);
  return state;
}

/** `armed`, then the install declared — asserting the row actually landed with the
    printed amount, so a board that failed to install can never leave a case
    asserting "nothing was weakened" against nothing. Returns P2's turn (the
    window), which is also the turn the debuffed body attacks on. */
function installed(
  installer: keyof typeof INSTALLERS,
  victim: string,
  victimEnergy: { id: string; count: number }[] = [],
): GameState {
  const spec = INSTALLERS[installer];
  const { state, events } = mustApply(armed(installer, victim, victimEnergy), {
    type: "attack",
    seat: "p1",
    index: spec.index,
  });
  const row = find(events, "ATTACK_DEBUFF_APPLIED");
  if (row === undefined) throw new Error(`${installer} did not install a debuff`);
  if (row.amount !== spec.amount) throw new Error(`${installer} installed ${String(row.amount)}`);
  return state;
}

/** The debuffed body swings back: P2 declares `index` on the turn the window is
    open. Everything it needs is already attached by `armed`. */
function swingBack(state: GameState, index = 0) {
  return mustApply(state, { type: "attack", seat: "p2", index });
}

/** A live debuff written straight onto a body — for the boards no printing can
    reach (a second install in one turn; a debuff that outlives its installer).
    D144/D146's precedent for pinning a rule with no card behind it. */
function withDebuff(
  state: GameState,
  seat: Seat,
  amount: number,
  turn = state.turn,
): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to stamp");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...active, attackDamageDebuff: { turn, amount } } },
    },
  };
}

/** D147's record, written straight on — the two live on opposite bodies of one
    exchange and no single declaration can install both, so the interaction case
    drives one and constructs the other. */
function withReduction(
  state: GameState,
  seat: Seat,
  where: "active" | { bench: number },
  amount: number,
  turn = state.turn,
): GameState {
  const side = state.players[seat];
  const stamp = { turn, amount };
  if (where === "active") {
    const active = side.active;
    if (active === null) throw new Error("no Active to stamp");
    return {
      ...state,
      players: { ...state.players, [seat]: { ...side, active: { ...active, damageReduction: stamp } } },
    };
  }
  const bench = side.bench.map((p, i) => (i === where.bench ? { ...p, damageReduction: stamp } : p));
  return { ...state, players: { ...state.players, [seat]: { ...side, bench } } };
}

/** D142's WIDE block, written straight on. Every one of the pool's 13
    `effects: true` printings is coin-gated (censused at D148), so driving one
    would put a coin into a suite whose whole determinism claim is that it takes
    none — the same call `defenderLock.test.ts` made on the same field. */
function withWideBlock(state: GameState, seat: Seat, turn = state.turn): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to block with");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...active, attackBlock: { turn, effects: true } } },
    },
  };
}

/** The rendered log, flattened to `{ who, text }` — the shape the neighbouring
    suites read a sequence in. */
function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:07" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

describe("the attacker-side debuff — derived, not authored", () => {
  it("derives BOTH printed sentences off ONE op, at every printed amount", () => {
    // Three amounts across two anchors, one `(\d+)` each (D120's precondition met:
    // a NUMBER is closed by its type, unlike the open consequent vocabularies that
    // earn a row each).
    expect(deriveAttackEffect(possessive(20))).toEqual([
      { op: "weakenDefenderAttacks", amount: 20 },
    ]);
    expect(deriveAttackEffect(possessive(30))).toEqual([
      { op: "weakenDefenderAttacks", amount: 30 },
    ]);
    expect(deriveAttackEffect(usedBy(100))).toEqual([
      { op: "weakenDefenderAttacks", amount: 100 },
    ]);
    // …and an amount nothing prints derives on BOTH, which is what makes each
    // capture a capture rather than a two-row table with a regex around it.
    expect(deriveAttackEffect(possessive(70))).toEqual([
      { op: "weakenDefenderAttacks", amount: 70 },
    ]);
    expect(deriveAttackEffect(usedBy(70))).toEqual([{ op: "weakenDefenderAttacks", amount: 70 }]);
  });

  it("shares the OP between the two sentences — asserted, not argued", () => {
    // ⚠️ THE FAMILY'S CHECKABLE CLAIM (D134's move on the heads face, D148's on its
    // own pair). Two anchors are only justified if what they mean is ONE thing, so
    // the two programs are compared byte for byte at a common amount rather than
    // described as "the same op" in a comment.
    expect(deriveAttackEffect(possessive(50))).toEqual(deriveAttackEffect(usedBy(50)));
    // And they really are two DIFFERENT strings — i.e. this is not one regex being
    // asserted against itself.
    expect(possessive(50)).not.toBe(usedBy(50));
    expect(possessive(50).length).not.toBe(usedBy(50).length);
  });

  it("refuses a printed ZERO — the guard every arm in this family carries", () => {
    // A "do 0 less damage" record changes no arithmetic anywhere and would emit a
    // row announcing a drawback that does not exist, which is worse than an unread
    // sentence. No such printing exists; the guard is the point.
    expect(deriveAttackEffect(possessive(0))).toBeNull();
    expect(deriveAttackEffect(usedBy(0))).toBeNull();
  });

  it("folds the typographic apostrophe — and sentence ONE carries TWO slots", () => {
    // A re-ingest that changes only punctuation must not silently un-simulate five
    // printings (D136/D137). Sentence one is the first in this whole family with
    // the SAME slot twice ("your opponent's" AND "the Defending Pokémon's"), so a
    // build that classed only the first would pass every earlier suite and fail
    // here — which is exactly why both are classed.
    for (const amount of [20, 30]) {
      expect(deriveAttackEffect(possessive(amount).replace(/'/g, "’"))).toEqual(
        deriveAttackEffect(possessive(amount)),
      );
    }
    expect(deriveAttackEffect(usedBy(100).replace(/'/g, "’"))).toEqual(
      deriveAttackEffect(usedBy(100)),
    );
    // …and mixing the two spellings within one sentence still derives, which is the
    // only assertion that proves BOTH slots are classed rather than one of them.
    expect(
      deriveAttackEffect(possessive(20).replace("opponent's", "opponent’s")),
    ).toEqual(deriveAttackEffect(possessive(20)));
    expect(
      deriveAttackEffect(possessive(20).replace("Pokémon's", "Pokémon’s")),
    ).toEqual(deriveAttackEffect(possessive(20)));
  });

  it("is UNGATED — no coin is printed on any of the five", () => {
    expect((deriveAttackEffect(possessive(20)) as EffectOp[]).map((op) => op.op)).toEqual([
      "weakenDefenderAttacks",
    ]);
    // And a coin prefix must not ride in front of either anchor and install
    // silently: both start at "During", so this is a property of `^` and not luck.
    expect(deriveAttackEffect(`Flip a coin. If heads, ${possessive(20).toLowerCase()}`)).toBeNull();
    expect(deriveAttackEffect(`Flip a coin. If heads, ${usedBy(100).toLowerCase()}`)).toBeNull();
  });

  it("is anchored end to end, on both sentences", () => {
    for (const text of [possessive(30), usedBy(100)]) {
      expect(deriveAttackEffect(`Then, ${text}`)).toBeNull();
      expect(deriveAttackEffect(text.slice(0, -1))).toBeNull();
      expect(deriveAttackEffect(text.toLowerCase())).toBeNull();
      expect(deriveAttackEffect(`${text} Draw a card.`)).toBeNull();
      // The parenthetical is IN both anchors, so dropping it is a different
      // sentence — and the pool prints no such sentence, so it stays LOUD.
      expect(deriveAttackEffect(text.replace(" (before applying Weakness and Resistance)", ""))).toBeNull();
    }
  });

  it("⚠️ REFUSES D147's SENTENCE, AND D147's ANCHOR REFUSES THESE — the parenthetical is the taxonomy", () => {
    // The two families read the same words ("N less damage") and mean OPPOSITE
    // things — one is subtracted from what the DEFENDER takes after the modifiers,
    // the other from what the ATTACKER deals before them — and 25 of the pool's 31
    // "less damage" printings sit in one or the other. A reader keying on the verb
    // phrase would have shipped five attacks backwards.
    expect(deriveAttackEffect(AFTER_WR)).toEqual([{ op: "reduceDamage", amount: 30 }]);
    expect(deriveAttackEffect(possessive(30))).toEqual([
      { op: "weakenDefenderAttacks", amount: 30 },
    ]);
    // …and the ONE WORD that separates them is load-bearing IN BOTH DIRECTIONS.
    expect(deriveAttackEffect(AFTER_WR.replace("after applying", "before applying"))).toBeNull();
    expect(deriveAttackEffect(possessive(30).replace("before applying", "after applying"))).toBeNull();
  });

  it("refuses the ALWAYS-ON Ability — the duration AND the body are the difference", () => {
    // Entei sv03-030 "Pressure" prints this exact mechanism with no duration, on a
    // CROSS-BOARD aura scoped to both Active Spots. Deriving it as an attack effect
    // would install a one-turn stamp for a permanent Ability AND write it onto the
    // wrong body — the aura reads off the SOURCE's opponent each turn, where a
    // stamp is written once onto one record. It stays LOUD, and it is deliberately
    // NOT this slice: `PassiveEffects` has no shape for an aura with an Active
    // clause on both ends (continuous.ts `opposingRetreatBlocked` is the template).
    expect(deriveAttackEffect(ALWAYS_ON)).toBeNull();
    // ⚠️ RE-POINTED AT D151, NOT DELETED. The sentence still must not derive — that
    // half of the witness is the point and is unchanged — but the datum has since
    // ARRIVED, through the registry rather than through this deriver: Entei's
    // printed Ability is now on the fixture and `opponentActiveAttackDebuff: 20` is
    // authored on its `passive`, read by continuous.ts `opposingAttackDebuff` and
    // SUMMED beside this slice's stamp at all four damage sites (pressureAura.test.ts).
    // So the assertion that used to say "absent" now says WHERE it landed, which is
    // the stronger claim: an aura, not an op.
    expect(programFor("sv03-030")?.passive).toEqual({ opponentActiveAttackDebuff: 20 });
    expect(programFor("sv03-030")?.attack).toBeUndefined();
    expect(FIXTURE_POOL["sv03-030"]?.abilities).toEqual([
      { type: "Ability", name: "Pressure", effect: ALWAYS_ON },
    ]);
  });

  it("costs zero registry rows — all four cards simulate off their printed text", () => {
    for (const id of Object.keys(INSTALLERS)) expect(programFor(id)?.attack).toBeUndefined();
  });

  it("keeps the fixtures' NAME, text, cost, damage and INDEX verbatim", () => {
    // Ids, NAMES, costs, printed damage and the INDEX all checked against the local
    // D1 (2026-08-02, 978 cards / 6 sets) PER PRINTING — D144's rule, extended to names by
    // D146 after two consecutive lists carried wrong ones.
    expect(FIXTURE_POOL["sv02-062"]?.name).toBe("Pikachu");
    expect(FIXTURE_POOL["sv02-062"]?.attacks?.[0]).toEqual({
      cost: ["Colorless"],
      name: "Growl",
      effect: possessive(20),
    });
    expect(FIXTURE_POOL["sv02-062"]?.attacks?.[1]).toEqual({
      cost: ["Lightning", "Colorless"],
      name: "Pika Bolt",
      damage: 30,
    });
    expect(FIXTURE_POOL["swsh10.5-061"]?.name).toBe("Pidove");
    expect(FIXTURE_POOL["swsh10.5-061"]?.attacks?.[0]).toEqual({
      cost: ["Colorless"],
      name: "Growl",
      effect: possessive(20),
    });
    expect(FIXTURE_POOL["sv01-093"]?.name).toBe("Florges");
    expect(FIXTURE_POOL["sv01-093"]?.attacks?.[0]).toEqual({
      cost: ["Psychic", "Colorless", "Colorless"],
      name: "Moonblast",
      damage: 120,
      effect: possessive(30),
    });
    expect(FIXTURE_POOL["sv06.5-008"]?.name).toBe("Houndoom");
    expect(FIXTURE_POOL["sv06.5-008"]?.attacks?.[1]).toEqual({
      cost: ["Fire", "Colorless", "Colorless"],
      name: "Snarl",
      damage: 100,
      effect: usedBy(100),
    });
    // ⚠️ THE INDEX IS NOT CONSTANT ACROSS THE FAMILY — Houndoom prints its rider at
    // 1 and the other three at 0, which is why each was read separately rather than
    // once for the family (the trap D144 found and D146 sharpened).
    expect(Object.values(INSTALLERS).map((s) => s.index)).toEqual([0, 0, 0, 1]);
    // The Weakness lines are the reason these cards rather than any others: each
    // installer is the body its own debuffed victim swings back into.
    expect(FIXTURE_POOL["sv06.5-008"]?.weaknesses).toEqual([{ type: "Water", value: "×2" }]);
    expect(FIXTURE_POOL["swsh10.5-061"]?.weaknesses).toEqual([{ type: "Lightning", value: "×2" }]);
    expect(FIXTURE_POOL["swsh10.5-061"]?.resistances).toEqual([{ type: "Fighting", value: "-30" }]);
    expect(FIXTURE_POOL["sv01-048"]?.types).toEqual(["Water"]);
    expect(FIXTURE_POOL["sv02-062"]?.types).toEqual(["Lightning"]);
    // …and Florges carries BOTH readings on one card, which is the interaction the
    // ordering section turns on.
    expect(FIXTURE_POOL["sv01-093"]?.abilities?.[0]?.name).toBe("Blooming Garden");
    expect(possessive(20)).toContain("opponent's");
    expect(possessive(20)).not.toContain("’");
  });

  it("emits `weakenDefenderAttacks` from exactly the four printings, swept over the pool", () => {
    // The producer SET, discovered rather than listed (D145's move, and the sweep
    // that found D147's fifth producer): a fifth producer fails loudly instead of
    // being absorbed, and the amounts it emits are asserted to be the printed ones
    // rather than "some number".
    const producers = new Map<string, number[]>();
    // 🆕 D276 — THROUGH THE SHARED `walkProgram`. This was the NARROWEST of the
    // five hand-rolled walkers and the only one whose arms were chained with
    // `else if`: a `weakenDefenderAttacks` inside a `recordGate` was missed
    // twice over — once because the gate was not descended, and once because a
    // gate op could never fall through to the producer arm at all.
    const walk = (ops: EffectOp[], id: string) => {
      for (const op of walkProgram(ops)) {
        if (op.op === "weakenDefenderAttacks") {
          producers.set(id, [...(producers.get(id) ?? []), op.amount]);
        }
      }
    };
    for (const card of Object.values(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        const derived = attack.effect === undefined ? null : deriveAttackEffect(attack.effect);
        if (derived !== null) walk(derived, card.id);
      }
      const authored = programFor(card.id)?.attack;
      for (const ops of Object.values(authored ?? {})) walk(ops, card.id);
    }
    // ⚠️ FOUR, AND ONE OF THEM WAS ALREADY IN THE POOL — D147's finding repeating
    // itself in its OTHER form. Florges sv01-093 has been in `FIXTURE_POOL` since
    // D104 as the Blooming Garden aura source, and its fixture carried NO ATTACKS
    // AT ALL, so its only printed attack — this family's 30 — was absent rather
    // than present-and-unread. The pool sweep D147 mandated is what found it; no
    // remainder list mentioned that the card was already fielded.
    // 🆕🆕 D397 — FIVE, and the fifth arrived as a SIDE EFFECT of a slice about
    // something else entirely, which is this rung doing exactly the job D147 gave it.
    // `fix-bonevengeance` (Marowak `sv07-073`) was transcribed WHOLE for the
    // benched-Cubone clause at index 1, and its index-0 "Growl" turns out to print this
    // family's sentence at 40 — so the pool gained a producer nobody was pricing.
    // **A NUMBER THAT IS A FACT ABOUT THE WHOLE POOL IS MOVED BY SLICES THAT ARE NOT
    // ABOUT IT**, and a sweep is the only instrument that can say so.
    expect([...producers.entries()].sort()).toEqual([
      ["fix-bonevengeance", [40]],
      ["sv01-093", [30]],
      ["sv02-062", [20]],
      ["sv06.5-008", [100]],
      ["swsh10.5-061", [20]],
    ]);
  });
});

describe("the attacker-side debuff — installing it", () => {
  it("installs with NO coin — the rngState does not move", () => {
    const before = armed("sv02-062", "sv01-069");
    const { state: done, events } = mustApply(before, { type: "attack", seat: "p1", index: 0 });
    expect(done.rngState).toBe(before.rngState);
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("stamps the OPPONENT's next turn ON THE OPPONENT'S BODY, and names the AMOUNT", () => {
    const state = armed("swsh10.5-061", "sv02-062");
    const victim = activeUid(state, "p2");
    expect(state.turn).toBe(2);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    expect(find(events, "ATTACK_DEBUFF_APPLIED")).toEqual({
      type: "ATTACK_DEBUFF_APPLIED",
      seat: "p2",
      uid: victim,
      amount: 20,
    });
    // D142's stamp arithmetic, on the FOURTH field that uses it and the FIRST that
    // writes it across the table: turn 2 installed it, turn 3 is the opponent's,
    // and that is the only turn it answers on. NOT the installing turn — the
    // printed word is "next" — and NOT `+ 2`, which is what the same one rule
    // ("the HOLDER's controller's next turn") reads as on `preventAttack`'s SELF
    // arm, where the holder is the installer instead of the victim (D148).
    expect(done.players.p2.active?.attackDamageDebuff).toEqual({ turn: 3, amount: 20 });
    expect(done.turn).toBe(3);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // Defender-relative: nothing on the INSTALLER's own board moved, which is the
    // exact inverse of `reduceDamage`'s assertion one suite over.
    expect(done.players.p1.active?.attackDamageDebuff).toBeNull();
    expect(done.players.p1.active?.damageReduction).toBeNull();
    for (const seat of ["p1", "p2"] as const) {
      for (const benched of done.players[seat].bench) {
        expect(benched.attackDamageDebuff).toBeNull();
      }
    }
  });

  it("installs the PRINTED amount on all four printings, at their own INDEX", () => {
    for (const [id, spec] of Object.entries(INSTALLERS)) {
      const key = id as keyof typeof INSTALLERS;
      const { state: done, events } = mustApply(armed(key, "fix-titan"), {
        type: "attack",
        seat: "p1",
        index: spec.index,
      });
      expect(find(events, "ATTACK_DEBUFF_APPLIED")?.amount, id).toBe(spec.amount);
      expect(done.players.p2.active?.attackDamageDebuff, id).toEqual({
        turn: 3,
        amount: spec.amount,
      });
      // …and the printed damage of the declaration itself is untouched (D125's tail
      // board): the debuff rides BEHIND the hit, because its whole effect is future.
      const hit = find(events, "DAMAGE_DEALT");
      expect(hit?.dealt ?? 0, id).toBe(spec.hit);
      if (spec.hit > 0) {
        expect(types(events).indexOf("DAMAGE_DEALT")).toBeLessThan(
          types(events).indexOf("ATTACK_DEBUFF_APPLIED"),
        );
      }
    }
  });

  it("does not leak across the attack index", () => {
    // Houndoom installs at INDEX 1; its index-0 "Bite" (50) must not…
    const { state: bite, events: biteEvents } = mustApply(armed("sv06.5-008", "fix-titan"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(biteEvents)).not.toContain("ATTACK_DEBUFF_APPLIED");
    expect(bite.players.p2.active?.attackDamageDebuff).toBeNull();
    expect(find(biteEvents, "DAMAGE_DEALT")?.dealt).toBe(50);
    // …and Pikachu installs at INDEX 0, so its index-1 "Pika Bolt" (30) must not.
    const { state: bolt, events: boltEvents } = mustApply(
      attachFromDeck(armed("sv02-062", "fix-titan"), "p1", "fix-lightning-energy", 1),
      { type: "attack", seat: "p1", index: 1 },
    );
    expect(types(boltEvents)).not.toContain("ATTACK_DEBUFF_APPLIED");
    expect(bolt.players.p2.active?.attackDamageDebuff).toBeNull();
  });

  it("writes onto the body that was Active when the attack RESOLVED (§8 step 5)", () => {
    // "The Defending Pokémon" is a term of art, not "whatever is Active later": the
    // debuff lands on the victim standing in front of the attack, and the victim's
    // own Bench takes nothing — so a promotion after the fact inherits nothing.
    let state = armed("swsh10.5-061", "sv01-069");
    state = benchFromDeck(state, "p2", "fix-titan");
    const victim = activeUid(state, "p2");
    const benched = benchTopUid(state, "p2", state.players.p2.bench.length - 1);
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(done.players.p2.active?.stack).toContain(victim);
    expect(done.players.p2.active?.attackDamageDebuff).toEqual({ turn: 3, amount: 20 });
    const stillBenched = done.players.p2.bench.find((p) => p.stack.includes(benched ?? ""));
    expect(stillBenched?.attackDamageDebuff).toBeNull();
  });
});

describe("the attacker-side debuff — the §8.5 ORDERING the parenthetical pins", () => {
  it("⚠️ subtracts BEFORE Weakness: Water 120 into a ×2 Water body with 100 installed", () => {
    // THE SLICE'S HEADLINE NUMBER, driven off two printed cards with no surgery.
    // Houndoom sv06.5-008 declares "Snarl" (100 damage + a 100 debuff) into
    // Alomomola sv01-048 (120 HP, survives at 100), which then answers with "Aqua
    // Slash" (120, WATER) into Houndoom's ×2 WATER:
    //
    //     printed:  max(0, 120 − 100) = 20, × 2 = 40   ← what the card says
    //     reversed: 120 × 2 = 240, − 100 = 140         ← a 3.5× miss
    //
    // The 120 HP body ends the turn ALIVE on the printed reading and dead on the
    // reversed one, so the two are not merely different numbers.
    const state = installed("sv06.5-008", "sv01-048", [
      { id: "fix-water-energy", count: 2 },
      { id: "fix-energy", count: 1 },
    ]);
    expect(state.players.p2.active?.damage).toBe(100); // Snarl landed
    const installer = activeUid(state, "p1");
    const { state: done, events } = swingBack(state, 1);
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.uid).toBe(installer);
    expect(row?.base).toBe(120);
    expect(row?.debuff).toBe(100);
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row?.dealt).toBe(40);
    if (row !== undefined) {
      expect(pipeline(row).afterWR).toBe(140);
      expectBeforeWR(row);
    }
    expect(done.players.p1.active?.damage).toBe(40);
    expect(types(events)).not.toContain("KNOCKED_OUT");
    // …and the row does NOT say `prevented`: a debuffed hit ran the whole pipeline.
    expect(row?.prevented).toBeUndefined();
  });

  it("subtracts BEFORE Weakness on the small amount too — 30 Lightning, ×2, −20", () => {
    // Pidove installs 20 on Pikachu; Pikachu answers with "Pika Bolt" (30,
    // LIGHTNING) into Pidove's ×2 Lightning:
    //     printed  max(0, 30 − 20) = 10, × 2 = 20
    //     reversed 30 × 2 = 60, − 20 = 40
    const state = installed("swsh10.5-061", "sv02-062", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    const { events } = swingBack(state, 1);
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(30);
    expect(row?.debuff).toBe(20);
    expect(row?.dealt).toBe(20);
    if (row !== undefined) {
      expect(pipeline(row).afterWR).toBe(40);
      expectBeforeWR(row);
    }
  });

  it("⚠️ CANNOT bite on Florges's OWN board — Blooming Garden nulls the Weakness", () => {
    // THE FINDING THIS SLICE DID NOT GO LOOKING FOR. Florges sv01-093 is the card
    // that prints the 30 AND the card whose Ability reads "Your Pokémon in play
    // have no Weakness" — and Florges's side is exactly the side its debuffed
    // victim attacks INTO. So on any board Florges is on, the multiplicative step
    // is gone and the printed parenthetical is unobservable: the ONE printing of
    // the 30 is the one printing whose ordering claim cannot be driven.
    //
    // Pinned as a PAIR on one board, ± a benched Florges, so the claim is about the
    // aura rather than about a different set of cards:
    //   without Florges: max(0, 30 − 20) × 2 = 20  (the case above)
    //   with Florges:    max(0, 30 − 20)     = 10, and the two orders AGREE
    let state = installed("swsh10.5-061", "sv02-062", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    state = benchFromDeck(state, "p1", "sv01-093");
    const { events } = swingBack(state, 1);
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(30);
    expect(row?.debuff).toBe(20);
    expect(row?.weakness).toBeNull();
    expect(row?.dealt).toBe(10);
    // The two placements AGREE here, which is the whole content of the case: with
    // no multiplicative step there is nothing for the parenthetical to decide.
    if (row !== undefined) {
      expect(pipeline(row).beforeWR).toBe(pipeline(row).afterWR);
      expectBeforeWR(row);
    }
  });

  it("COMMUTES with Resistance — which is why only Weakness makes the order visible", () => {
    // Both Resistance and this debuff are ADDITIVE, so they can be applied in either
    // order for the same number. That is not a gap: it is the reason the printed
    // parenthetical exists at all, and the reason every board above is a Weakness
    // pair. D147's own finding, read on the other side of §8.5, and asserted on the
    // arithmetic because the claim is about the operation rather than about a card.
    const resisted = {
      base: 100,
      debuff: 40,
      weakness: null,
      resistance: { op: "subtract", amount: 30 } as DamageModifier,
    };
    expect(pipeline(resisted).beforeWR).toBe(pipeline(resisted).afterWR);
    expect(pipeline(resisted).beforeWR).toBe(30);
    // …and the moment a Weakness joins it, they diverge.
    const weak = {
      base: 100,
      debuff: 40,
      weakness: { op: "multiply", amount: 2 } as DamageModifier,
      resistance: { op: "subtract", amount: 30 } as DamageModifier,
    };
    // printed  (100 − 40) × 2 = 120, − 30 = 90   vs  100 × 2 − 30 = 170, − 40 = 130
    expect(pipeline(weak).beforeWR).toBe(90);
    expect(pipeline(weak).afterWR).toBe(130);
  });

  it("⚠️ CLAMPS at the pre-W/R step, and a clamped 0 is not a prevention", () => {
    // Alomomola's index-0 "Surf" (30, WATER) under Houndoom's 100:
    //   max(0, 30 − 100) = 0, × 2 = 0.
    // The clamp is written at the step the printed parenthetical names rather than
    // left to the final floor. On every board this pool can build the two spellings
    // agree (every catalog Weakness is ×2, every Resistance −30), so the claim that
    // needs asserting is the OBSERVABLE one: the attack does 0 and says so honestly.
    const state = installed("sv06.5-008", "sv01-048", [
      { id: "fix-water-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    const { state: done, events } = swingBack(state, 0);
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(30);
    expect(row?.debuff).toBe(100);
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row?.dealt).toBe(0);
    // ⚠️ `prevented` STAYS ABSENT — a 0 from a big debuff and a 0 from a §11 block
    // are the same number and different facts (D147's call, on the other body).
    expect(row?.prevented).toBeUndefined();
    // Nothing went negative on the way, and the defender's total is untouched.
    expect(done.players.p1.active?.damage).toBe(0);
    expect(row?.damage).toBe(0);
    // …and the ADDITIVE-weakness spelling, which the pool does not print but the
    // engine's own DamageModifier admits, is where the clamp's PLACEMENT becomes
    // observable — pinned as arithmetic, D147's move on its commuting case.
    const additive = {
      base: 50,
      debuff: 100,
      weakness: { op: "add", amount: 20 } as DamageModifier,
      resistance: null,
    };
    expect(pipeline(additive).beforeWR).toBe(20); // max(0, 50 − 100) + 20
    expect(pipeline(additive).afterWR).toBe(0); // 50 + 20 − 100 → clamp
  });

  it("⚠️ a clamped-to-zero hit did NOT 'do damage' — the §9 recoil boundary, BOTH ways", () => {
    // D141/D145's boundary, driven from the debuff's end: `dealt > 0` gates the §9
    // counterattack (and the `onDamagedByAttack` trigger beside it), so a swing the
    // debuff clamps to 0 must land on the same side of that line as an attack that
    // never damaged anything at all. Rocky Helmet sv01-193 on the INSTALLER makes
    // that observable rather than merely absent: it puts 2 counters on whatever
    // damages its holder, so the two arms of the same board differ by an event.
    //
    // ⚠️ BOTH DIRECTIONS, because "no COUNTERS_PLACED" on its own is what a board
    // with no recoil source also says.
    const helmeted = (): GameState => {
      let state = armed("sv06.5-008", "sv01-048", [
        { id: "fix-water-energy", count: 2 },
        { id: "fix-energy", count: 1 },
      ]);
      state = handFromDeck(state, "p1", "sv01-193", 1);
      const { state: worn } = mustApply(state, {
        type: "attachTool",
        seat: "p1",
        uid: handUid(state, "p1", "sv01-193"),
        target: { spot: "active" },
      });
      const { state: installed } = mustApply(worn, { type: "attack", seat: "p1", index: 1 });
      return installed;
    };
    // Surf (30) clamped to 0 by the 100 → NOTHING happened to the holder, so the
    // Helmet says nothing either.
    const clamped = swingBack(helmeted(), 0);
    expect(find(clamped.events, "DAMAGE_DEALT")?.dealt).toBe(0);
    expect(types(clamped.events)).not.toContain("COUNTERS_PLACED");
    expect(types(clamped.events)).not.toContain("KNOCKED_OUT");
    expect(clamped.state.players.p1.active?.damage).toBe(0);
    // The attack still HAPPENED — it was used, the turn ended, and §8.1 swept.
    expect(types(clamped.events)).toContain("ATTACK_DECLARED");
    expect(clamped.state.turn).toBe(4);
    // Aqua Slash (120) survives the same 100 at 40, so the Helmet DOES fire — same
    // board, same Tool, same debuff, and the only difference is whether `dealt` was
    // positive.
    const through = swingBack(helmeted(), 1);
    expect(find(through.events, "DAMAGE_DEALT")?.dealt).toBe(40);
    expect(find(through.events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p2",
      amount: 20,
      source: "counterattack",
    });
  });
});

describe("the attacker-side debuff — the four READ SITES", () => {
  it("weakens the §8.5 MAIN HIT", () => {
    const state = installed("swsh10.5-061", "sv02-062", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    const { events } = swingBack(state, 1);
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.debuff).toBe(20);
    expect(row?.dealt).toBe(20);
    if (row !== undefined) expectBeforeWR(row);
  });

  it("weakens an Active-target SNIPE — `snipeActive`, the other site that runs W/R", () => {
    // Rotom sv01-069's "Linear Attack" ({C}, `opponentAny` 20, `deals`) under a 20
    // debuff, into Pidove's ×2 LIGHTNING:
    //     printed  max(0, 20 − 20) = 0, × 2 = 0
    //     reversed 20 × 2 = 40, − 20 = 20
    // The second of the two sites that runs Weakness at all, so the ordering claim
    // is pinned twice on two different code paths rather than once.
    let state = installed("swsh10.5-061", "sv01-069", [{ id: "fix-energy", count: 1 }]);
    state = clearBench(state, "p1"); // one candidate → no park
    const { events } = swingBack(state, 0);
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(20);
    expect(row?.debuff).toBe(20);
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row?.dealt).toBe(0);
    if (row !== undefined) {
      expect(pipeline(row).afterWR).toBe(20);
      expectBeforeWR(row);
    }
  });

  it("⚠️ weakens SPREAD damage on the BENCH, where the pre-W/R BONUS deliberately does not reach", () => {
    // THE ASYMMETRY THE CENSUS DECIDED. Every pre-W/R printing in the pool that
    // ADDS damage scopes itself "to your opponent's Active Pokémon" (Vitality Band,
    // Defiance Band, Choice Belt, Practice Studio, Binding Mochi, Kingambit,
    // Galvantula, Okidogi, the three birds) — which is why `spreadDamage` correctly
    // omits `damageBonusBeforeWR`. NEITHER sentence that SUBTRACTS carries an
    // Active clause at all, so this number comes off every damage the attack does.
    //
    // fix-sniper's "Spread Shot" (30 main + 20 to each benched) under a 20 debuff:
    //     main   max(0, 30 − 20) = 10 into Pidove's ×2 Lightning… no, fix-sniper is
    //            FIRE, so no Weakness applies and the main hit is a flat 10
    //     bench  max(0, 20 − 20) = 0 on every benched body
    let state = installed("swsh10.5-061", "fix-sniper", [{ id: "fix-energy", count: 1 }]);
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    const benched = benchTopUid(state, "p1", 0);
    const { events } = swingBack(state, 0);
    const rows = findAll(events, "DAMAGE_DEALT");
    const main = rows.find((e) => e.uid === activeUid(state, "p1"));
    const bench = rows.find((e) => e.uid === benched);
    expect(main?.debuff).toBe(20);
    expect(main?.dealt).toBe(10);
    expect(bench?.base).toBe(20);
    expect(bench?.debuff).toBe(20);
    expect(bench?.dealt).toBe(0);
    // §8.5 says no Weakness on the Bench, so this site's two placements agree — the
    // debuff is the whole of what it does there.
    if (bench !== undefined) expectBeforeWR(bench);
    if (main !== undefined) expectBeforeWR(main);
  });

  it("weakens a benched `deals` SNIPE — `placeSnipe`'s damage arm", () => {
    // fix-bramble's per-40 benched snipe, scaled by the Prizes the opponent has
    // TAKEN. One Prize taken → 40 to the single benched target, and the 20 debuff
    // takes it to 20.
    let state = installed("swsh10.5-061", "fix-bramble", [{ id: "fix-energy", count: 1 }]);
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    state = setPrizes(state, "p1", 5); // 6 − 5 = 1 Prize taken
    const benched = benchTopUid(state, "p1", 0);
    const { events } = swingBack(state, 0);
    const bench = findAll(events, "DAMAGE_DEALT").find((e) => e.uid === benched);
    expect(bench?.base).toBe(40);
    expect(bench?.debuff).toBe(20);
    expect(bench?.dealt).toBe(20);
    if (bench !== undefined) expectBeforeWR(bench);
  });

  it("does NOT touch a PLACED counter — a counter is not damage from an attack", () => {
    // D138/D139's standing ruling, re-asserted from this side: `placeSnipe`'s
    // put-counter arm skips Weakness, Resistance and every reduction passive, so a
    // sentence about how much damage an attack DOES has nothing to take off it.
    // Rotom's `deals` snipe is the reader; the put arm is exercised through
    // fix-bramble's sibling shape being `deals`, so this is asserted on the op the
    // deriver produces for a counter PUT rather than on a board that cannot exist.
    const put = deriveAttackEffect("Put 5 damage counters on your opponent's Active Pokémon.");
    expect(put?.[0]?.op).toBe("damageActive");
    // …and the debuff op is nowhere near it: two different questions, two ops.
    expect(JSON.stringify(put)).not.toContain("weaken");
  });
});

describe("the attacker-side debuff — meeting D147's reduction on one exchange", () => {
  it("⚠️ both are live at once, and each takes its own bite at its own STEP", () => {
    // The two records are structurally identical and semantically opposite, and a
    // single exchange can carry both: the attacker's output is cut BEFORE the
    // modifiers and the defender's intake AFTER them. No one declaration can
    // install both (they land on opposite bodies from opposite seats), so the
    // debuff is DRIVEN off Pidove's printed Growl and the reduction constructed —
    // D144/D146's precedent, and the same split D147 used for its own bench sites.
    //
    // Pika Bolt (30, LIGHTNING) into Pidove (×2 Lightning) with debuff 20 and
    // reduction 20:
    //     max(0, 30 − 20) = 10, × 2 = 20, − 20 = 0
    let state = installed("swsh10.5-061", "sv02-062", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    state = withReduction(state, "p1", "active", 20);
    const { events } = swingBack(state, 1);
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(30);
    expect(row?.debuff).toBe(20);
    expect(row?.reduction).toBe(20);
    expect(row?.dealt).toBe(0);
    if (row !== undefined) expectBeforeWR(row);
    // …and the THREE-WAY separation, which is what makes "each takes its own bite"
    // a measurement rather than a description: the same board with only one of the
    // two live gives two different non-zero numbers, and with neither, 60.
    const both = row as Extract<GameEvent, { type: "DAMAGE_DEALT" }>;
    expect(pipeline({ ...both, reduction: undefined }).beforeWR).toBe(20); // debuff only
    expect(pipeline({ ...both, debuff: undefined }).beforeWR).toBe(40); // reduction only
    expect(pipeline({ ...both, debuff: undefined, reduction: undefined }).beforeWR).toBe(60);
  });

  it("the two records coexist on ONE body without either answering the other", () => {
    // A body can be the attacker of a debuffed swing AND the holder of its own
    // reduction — the fields are read by different sites for different questions,
    // and neither reader may see the other's number.
    let state = installed("swsh10.5-061", "sv02-062", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    state = withReduction(state, "p2", "active", 50);
    expect(state.players.p2.active?.attackDamageDebuff).toEqual({ turn: 3, amount: 20 });
    expect(state.players.p2.active?.damageReduction).toEqual({ turn: 3, amount: 50 });
    // The debuffed body's own attack is cut by 20 (its debuff) and NOT by 50.
    const { events } = swingBack(state, 1);
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.debuff).toBe(20);
    expect(row?.reduction).toBeUndefined(); // the reduction is on the ATTACKER, not the target
    expect(row?.dealt).toBe(20);
  });
});

describe("the attacker-side debuff — the LIFETIME", () => {
  it("is DEAD outside its one turn, with the stale stamp left alone", () => {
    // The whole of what a turn STAMP buys: no boundary clear anywhere, so the
    // record simply stops answering. Driven across two turn boundaries.
    let state = installed("swsh10.5-061", "sv02-062", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    expect(state.turn).toBe(3);
    expect(state.players.p2.active?.attackDamageDebuff).toEqual({ turn: 3, amount: 20 });
    // P2 passes without attacking; turn 4 is P1's, then P1 passes back.
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(4);
    expect(state.players.p2.active?.attackDamageDebuff).toEqual({ turn: 3, amount: 20 });
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    expect(state.turn).toBe(5);
    // On turn 5 the SAME attacker hits for the undebuffed number: 30 × 2 = 60.
    const { events } = swingBack(state, 1);
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.debuff).toBeUndefined();
    expect(row?.dealt).toBe(60);
  });

  it("is NOT live on the installing turn — the printed word is 'next'", () => {
    // The install happens at the attack's tail, on turn 2; a hypothetical read on
    // that same turn must return nothing. Driven by asking the read site through a
    // declaration on the installing turn is impossible (the attack ended it), so
    // this is asserted on the stamp against the turn it was written on.
    const state = installed("swsh10.5-061", "sv02-062");
    expect(state.players.p2.active?.attackDamageDebuff?.turn).toBe(3);
    expect(state.players.p2.active?.attackDamageDebuff?.turn).not.toBe(2);
  });

  it("ends when the victim RETREATS out of it — the victim's own counterplay", () => {
    // §10's clear, with D148's agency: the window is the VICTIM's own turn, so all
    // three routes off the Active Spot are lines of play the victim can take, and
    // the INSTALLER can reach none of them (their turn ended when they declared).
    let state = installed("swsh10.5-061", "sv02-062", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    const victim = activeUid(state, "p2");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "sv01-048");
    const { state: retreated, events: retreatEvents } = mustApply(state, {
      type: "retreat",
      seat: "p2",
      discardEnergy: [state.players.p2.active?.energy[0] as string],
      promoteBenchIndex: 0,
    });
    const benched = retreated.players.p2.bench.find((p) => p.stack.includes(victim ?? ""));
    expect(benched?.attackDamageDebuff).toBeNull();
    // Silent: the RETREATED row already tells the story (D112's call, D147's too).
    expect(types(retreatEvents)).not.toContain("ATTACK_DEBUFF_APPLIED");
    // …and the promoted body attacks at FULL strength, so the clear is real rather
    // than merely unread.
    let next = attachFromDeck(retreated, "p2", "fix-water-energy", 1);
    next = attachFromDeck(next, "p2", "fix-energy", 1);
    const { events } = mustApply(next, { type: "attack", seat: "p2", index: 0 });
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.debuff).toBeUndefined();
    expect(row?.dealt).toBe(30); // Surf 30, Pidove is Colorless-neutral to Water
  });

  it("ends on a SWITCH inside the window", () => {
    let state = installed("swsh10.5-061", "sv02-062");
    const victim = activeUid(state, "p2");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    state = handFromDeck(state, "p2", "sv01-194", 1);
    const { state: done } = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "sv01-194"),
    });
    let next = done;
    if (next.phase.kind === "effect:choose") {
      next = must(
        applyAction(next, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    const benched = next.players.p2.bench.find((p) => p.stack.includes(victim ?? ""));
    expect(benched?.attackDamageDebuff).toBeNull();
  });

  it("⚠️ ends on EVOLVING — a PLAYED LINE, and the cheapest counterplay there is", () => {
    // §10 sheds the effects of ATTACKS, and here that is a line rather than a rule
    // written for completeness: the window is the victim's own turn, so evolving
    // the weakened body frees its attacks the same turn — no Energy, no allowance.
    // Driven on two printed cards, Alomomola sv01-048 → fix-mola-stage1.
    let state = installed("sv06.5-008", "sv01-048");
    expect(state.players.p2.active?.attackDamageDebuff).toEqual({ turn: 3, amount: 100 });
    state = handFromDeck(state, "p2", "fix-mola-stage1", 1);
    const { state: done, events } = mustApply(state, {
      type: "evolve",
      seat: "p2",
      uid: handUid(state, "p2", "fix-mola-stage1"),
      target: { spot: "active" },
    });
    expect(types(events)).toContain("POKEMON_EVOLVED");
    expect(done.players.p2.active?.attackDamageDebuff).toBeNull();
    // Silent, like every §10 clear in this family.
    expect(types(events)).not.toContain("ATTACK_DEBUFF_APPLIED");
    // …and the evolution attacks at full: "Bubble" ({W}, 40) into Houndoom, which is
    // ×2 WATER, so 80 rather than the max(0, 40 − 100) = 0 the debuff would have made.
    const armedEvo = attachFromDeck(done, "p2", "fix-water-energy", 1);
    const { events: hit } = mustApply(armedEvo, { type: "attack", seat: "p2", index: 0 });
    const row = find(hit, "DAMAGE_DEALT");
    expect(row?.debuff).toBeUndefined();
    expect(row?.dealt).toBe(80);
  });

  it("does not travel to the promoted body when the victim is Knocked Out", () => {
    // Snarl's printed 100 into a body it also debuffs is a LINE rather than a
    // corner. Alomomola survives at 120 HP; Rotom (60 HP) does not — and the
    // promoted Pokémon is a different Pokémon carrying nothing.
    let state = armed("sv06.5-008", "sv01-069");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    const victim = activeUid(state, "p2");
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).toContain("KNOCKED_OUT");
    // The debuff row landed BEFORE the KO — the program runs at attack.ts's tail
    // and the §8.1 sweep follows it (D148's ordering on a lethal defender install).
    expect(types(events).indexOf("ATTACK_DEBUFF_APPLIED")).toBeLessThan(
      types(events).indexOf("KNOCKED_OUT"),
    );
    // The victim is gone; whoever is promoted into the empty spot is a DIFFERENT
    // Pokémon and carries nothing — the stamp left with the stack (§8.1).
    let next = done;
    if (next.phase.kind === "ko:takePrizes") {
      next = must(applyAction(next, { type: "takePrizes", seat: "p1", prizeIndices: [0] }));
    }
    if (next.phase.kind === "ko:promote") {
      next = must(applyAction(next, { type: "promote", seat: "p2", benchIndex: 0 }));
    }
    expect(next.players.p2.active).not.toBeNull();
    expect(next.players.p2.active?.attackDamageDebuff).toBeNull();
    expect(next.players.p2.discard.some((uid) => uid === victim)).toBe(true);
  });

  it("MERGES by Math.max — unreachable off any printing, DRIVEN through the interpreter", () => {
    // One attack per turn, and two installs would have to land on the SAME turn, so
    // no legal sequence stacks these. The rule is `reduceDamage`'s read from the
    // installing side — *a second installation may never leave the installer with
    // less than one of them printed* — and a SUM is refused for its reason: this
    // field holds ONE installation with ONE window, so summing would make the
    // stored number depend on how many times the record was written.
    //
    // The PRIOR stamp is constructed (nothing can write it legally) and the second
    // install is then DRIVEN off a printed card, so the merge runs in the
    // interpreter rather than being asserted as arithmetic in a test.
    //
    // 50 already there, Snarl's 100 arriving → 100, announced.
    let state = withDebuff(armed("sv06.5-008", "sv01-048"), "p2", 50, 3);
    let done = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(done.state.players.p2.active?.attackDamageDebuff).toEqual({ turn: 3, amount: 100 });
    expect(find(done.events, "ATTACK_DEBUFF_APPLIED")?.amount).toBe(100);
    // …and the row reports the MERGED number rather than the printed one, exactly
    // as ATTACK_BLOCK_APPLIED reports the merged `effects`: the row must describe
    // the state that now exists.
    //
    // The other direction: 100 already there, Pidove's 20 arriving → still 100, and
    // SILENT, because announcing a re-install that changed no number would announce
    // a non-event (D142's idempotence answer, D140/D146's loudness rule).
    state = withDebuff(armed("swsh10.5-061", "sv01-048"), "p2", 100, 3);
    done = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(done.state.players.p2.active?.attackDamageDebuff).toEqual({ turn: 3, amount: 100 });
    expect(types(done.events)).not.toContain("ATTACK_DEBUFF_APPLIED");
    // A SUM would have said 120 here and 150 above; a plain overwrite 20 and 100.
    // Both are refused by the two assertions together.
  });
});

describe("the attacker-side debuff — the §11 block REFUSES it", () => {
  it("⚠️ a wide block on the Defending Pokémon refuses the install, and says so", () => {
    // THE VERDICT `preventBlock.test.ts`'s table forces, DRIVEN rather than only
    // declared — because D148 measured that the table checks a verdict EXISTS and
    // never that it is true. This op writes onto the DEFENDING Pokémon, so it is an
    // effect of an attack done to it: `preventRetreat`'s and D148's `preventAttack`
    // reading, and the same `attackEffectRefused` gate.
    //
    // Reachable off printed cards, not constructed as a rule: the defender installs
    // a wide block on their own turn, its window is the installer's very next turn,
    // and that is the turn this debuff would land on. The BLOCK itself is written
    // straight on because all 13 of the pool's `effects: true` printings are
    // coin-gated (censused at D148) and driving one would put a coin into a
    // seed-free suite.
    let state = armed("sv06.5-008", "sv01-048");
    state = withWideBlock(state, "p2", state.turn);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(types(events)).not.toContain("ATTACK_DEBUFF_APPLIED");
    expect(done.players.p2.active?.attackDamageDebuff).toBeNull();
    // The DAMAGE half is nulled by the same block, on its own field.
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    // The refusal row names the PROTECTED Pokémon, the block's own contract.
    expect(find(events, "ATTACK_EFFECT_PREVENTED")?.seat).toBe("p2");
  });

  it("…and an EXPIRED block does not refuse it", () => {
    // The other side of the same gate: a block whose stamp is not this turn stops
    // answering, so the install lands normally. Without this the case above would
    // pass for a build that refused every install unconditionally.
    let state = armed("sv06.5-008", "sv01-048");
    state = withWideBlock(state, "p2", state.turn + 5);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(done.players.p2.active?.attackDamageDebuff).toEqual({ turn: 3, amount: 100 });
  });
});

describe("the attacker-side debuff — the LOG", () => {
  it("⚠️ renders in the VICTIM's voice and names the VICTIM's own next turn", () => {
    // THE SLICE'S THIRD VOICE ANSWER, and the first in this family where copying
    // the neighbouring row would have LIED. `seat` owns the debuffed Pokémon
    // (D136's finding 1) and this op has no self arm, so the row ALWAYS renders
    // under the actor's opponent's name. DAMAGE_REDUCTION_APPLIED's wording ends
    // "…during your opponent's next turn" — honest there, because that row renders
    // under the INSTALLER's name. Under the victim's name those same words name
    // the wrong turn. So the phrasing is ATTACK_LOCKED's instead: "next turn",
    // which under this family's seat rule always means the named player's own.
    const state = armed("swsh10.5-061", "sv02-062");
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const rows = rendered(done, events);
    const row = rows.find((r) => r.text.includes("less damage"));
    expect(row?.who).toBe("p2"); // the VICTIM's seat, not the actor's
    expect(row?.text).toBe("Pikachu's attacks do 20 less damage next turn");
    // …and it must NOT carry the installer-voiced wording D147 chose.
    expect(row?.text).not.toContain("your opponent's next turn");
    // Read IN SEQUENCE (D144's rule): the declaration is the actor's, the rider the
    // victim's, and a reader following the two names sees who did what to whom.
    const declared = rows.findIndex((r) => r.text.includes("Growl"));
    const applied = rows.findIndex((r) => r.text.includes("less damage"));
    expect(declared).toBeGreaterThanOrEqual(0);
    expect(applied).toBeGreaterThan(declared);
    expect(rows[declared]?.who).toBe("p1");
  });

  it("reports the number on the hit it shrank — and emits no second row for firing", () => {
    // A debuff that BITES says nothing of its own: `DAMAGE_DEALT.debuff` carries the
    // number on the very row whose arithmetic it changed, at the pre-W/R step, in
    // §8.5 order between the boosts and the Weakness. Loudness is owed to UNREAD
    // TEXT, not to a read rule doing its job (D140/D146).
    const state = installed("swsh10.5-061", "sv02-062", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    const { state: done, events } = swingBack(state, 1);
    expect(types(events)).not.toContain("ATTACK_DEBUFF_APPLIED");
    const line = rendered(done, events).find((r) => r.text.includes("dealt"));
    expect(line?.text).toContain("weakened −20");
    expect(line?.text).toContain("weakness");
    // …and the crumb sits BEFORE the Weakness one, so the log reconstructs §8.5 in
    // printed order rather than in field order.
    expect((line?.text.indexOf("weakened") ?? -1)).toBeLessThan(
      line?.text.indexOf("weakness") ?? 0,
    );
  });

  it("says nothing at all when the debuff is not live", () => {
    const state = installed("swsh10.5-061", "sv02-062", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    let next = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    next = must(applyAction(next, { type: "endTurn", seat: "p1" }));
    const { state: done, events } = swingBack(next, 1);
    const line = rendered(done, events).find((r) => r.text.includes("dealt"));
    expect(line?.text).not.toContain("weakened");
  });
});
