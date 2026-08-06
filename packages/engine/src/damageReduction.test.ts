import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { applyDamageModifier } from "./cards";
import type { DamageModifier } from "./cards";
import { type LogContext, logFromEvents } from "./log";
import {
  DAMAGE_REDUCTION_DECK,
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
  setDamage,
  setPrizes,
  types,
} from "./testFixtures";

// 0.95.0 → 0.96.0 — the DURATED DAMAGE REDUCTION (P3-M5 long tail, D147):
//
//   "During your opponent's next turn, this Pokémon takes {20|30|50} less damage
//    from attacks (after applying Weakness and Resistance)."          (12 printings)
//   "Discard all Energy from this Pokémon. During your opponent's next turn, this
//    Pokémon takes 100 less damage from attacks (after applying Weakness and
//    Resistance)."                                                    ( 2 printings)
//
// The largest count this tail had left — 14 printings across 4 amounts — and the
// third stamped field on `InPlayPokemon`, which is the slice D143 deferred the
// GENERALISATION question to. The verdict is a third PARALLEL field and the
// argument is in decisions.md (D147); the two facts that decided it are both
// pinned below rather than only argued:
//
//   • THE READ PATH IS NOT SHARED, only the SITES are. All four damage sites ask
//     `attackBlockOf` and `installedReductionOf` two independent questions at two
//     different steps of §8.5 — one is SUBTRACTED inside the pipeline, the other
//     SUPERSEDES its result — and the case where a block DECLINES while a
//     reduction on the same body still bites is driven here;
//   • THE MECHANISM AND THE NUMBER ALREADY EXISTED. The pool prints this exact
//     sentence MINUS its four-word duration prefix as an always-on Ability on FOUR
//     printings (Bouffalant sv03-174 "Bouffer" 20, Stonjourner sv01-121
//     "Exoskeleton" 20, Copperajah ex sv02-150/-245 "Bronze Body" 30), simulated
//     since 0.x as `PassiveEffects.damageReductionAfterWR` and read at those same
//     four sites. So this field is a SOURCE summed into a number the engine
//     already computes — which is why the read-site diff is one `+` each and why
//     the clamp, the `ignoreWR` bypass and the `DAMAGE_DEALT.reduction` row all
//     come for free.
//
// ⚠️ THE PRINTED PARENTHETICAL IS THE SPEC AND IT IS DRIVEN, NOT ASSERTED. Every
// DAMAGE_DEALT row this suite produces is re-derived from its own reported fields
// in BOTH orders (`pipeline` below), and the two are asserted to differ wherever a
// Weakness is present. Resistance and the reduction are both ADDITIVE and commute,
// so the parenthetical can only ever bite on the MULTIPLICATIVE step — which is
// why the fixtures were chosen for their Weakness lines.

/** The bare sentence at each printed amount — one anchor, one capture. */
function bare(amount: number): string {
  return `During your opponent's next turn, this Pokémon takes ${String(amount)} less damage from attacks (after applying Weakness and Resistance).`;
}
/** Eiscue sv02-048/-205 "Frigid Block" — the COMPOUND printing, verbatim. */
const COMPOUND = `Discard all Energy from this Pokémon. ${bare(100)}`;
/** The always-on Ability spelling — this sentence MINUS the duration prefix, on
    Bouffalant sv03-174 / Stonjourner sv01-121 / Copperajah ex sv02-150. It is a
    printed ABILITY, read out of the registry, and must never derive as an ATTACK
    effect: the duration is the entire difference between the two readings. */
const ALWAYS_ON =
  "This Pokémon takes 20 less damage from attacks (after applying Weakness and Resistance).";
/** The ATTACKER-side family — the OTHER parenthetical: 6 printings across TWO
    attack sentences plus one Ability. A debuff on the attacker read at a different
    step on a different body, and the reason "(after applying …)" is inside this
    file's anchor rather than trimmed off it. **The five ATTACK printings became
    D149**; the list is kept (re-pointed, not deleted) because the claim it makes
    is now the sharper one — the two families must be told apart by their
    parenthetical BY TWO LIVE READERS rather than by one reader and a silence. */
const BEFORE_WR_ATTACKS = [
  // Houndoom sv06.5-008/-066 "Snarl" ({R}{C}{C}, 100, INDEX 1).
  "During your opponent's next turn, attacks used by the Defending Pokémon do 100 less damage (before applying Weakness and Resistance).",
  // Pikachu sv02-062 / Pidove swsh10.5-061 "Growl" ({C}, no damage, INDEX 0).
  "During your opponent's next turn, the Defending Pokémon's attacks do 20 less damage (before applying Weakness and Resistance).",
  // Florges sv01-093 "Moonblast" ({P}{C}{C}, 120, INDEX 0).
  "During your opponent's next turn, the Defending Pokémon's attacks do 30 less damage (before applying Weakness and Resistance).",
];
/** Entei sv03-030 "Pressure" — the always-on member, an ABILITY and a CROSS-BOARD
    aura (Active clause on both ends), deliberately left unread by D149 as well as
    by this slice. It must stay NULL on the attack reader. */
const BEFORE_WR_ABILITY =
  "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 20 less damage (before applying Weakness and Resistance).";

/** One seed for the whole suite. Nothing here flips a coin — no printing of this
    family carries one — so a seed table would describe a shuffle rather than a
    rule, and the install cases pin that by an unchanged `rngState` (D143's move,
    inherited by `classBlock.test.ts` and now by this one). */
const SEED = 11;

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

/** ⚠️ THE ORDERING ORACLE — §8.5 step 5 computed BOTH WAYS from a row's own
    reported fields, so the pin is on the ENGINE's arithmetic rather than on a
    number a test author typed.

    `afterWR` is the printed reading: base (+ bonus) → ×Weakness → −Resistance →
    clamp → −reduction → clamp. `beforeWR` is the only other placement a build
    could plausibly choose: subtract the reduction from the base first, then run
    the modifiers. Every damage row in this suite is checked against `afterWR`,
    and every row that reports a Weakness is additionally asserted to DIFFER from
    `beforeWR` — so a build that moved the subtraction one step earlier fails on
    the specific declarations rather than on a comment. */
function pipeline(row: {
  base: number;
  bonus?: number;
  weakness: DamageModifier | null;
  resistance: DamageModifier | null;
  reduction?: number;
}): { afterWR: number; beforeWR: number } {
  const raw = row.base + (row.bonus ?? 0);
  const reduction = row.reduction ?? 0;
  // The engine's OWN modifier fold (cards.ts), reused rather than re-implemented:
  // this oracle is about the ORDER of the steps, and re-deriving what "×2" means
  // would let a bug in that function hide behind a matching bug here.
  const modify = (value: number): number =>
    Math.max(0, applyDamageModifier(applyDamageModifier(value, row.weakness), row.resistance));
  return {
    afterWR: Math.max(0, modify(raw) - reduction),
    beforeWR: modify(Math.max(0, raw - reduction)),
  };
}

/** Assert a damage row is the AFTER-W/R reading, and — when the row reports a
    Weakness — that the two readings really are different numbers on this board.
    Called on every driven hit, so the ordering claim is swept rather than spot-checked. */
function expectAfterWR(row: Extract<GameEvent, { type: "DAMAGE_DEALT" }>): void {
  const { afterWR, beforeWR } = pipeline(row);
  expect(row.dealt).toBe(row.prevented === true ? 0 : afterWR);
  if (row.weakness !== null && (row.reduction ?? 0) > 0 && row.prevented !== true) {
    expect(afterWR).not.toBe(beforeWR);
    expect(row.dealt).not.toBe(beforeWR);
  }
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. The
    installer goes on P1's Active with whatever energy its attack costs. */
function armed(installer: string, energy: { id: string; count: number }[]): GameState {
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: DAMAGE_REDUCTION_DECK, p2: DAMAGE_REDUCTION_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", installer);
  for (const { id, count } of energy) state = attachFromDeck(state, "p1", id, count);
  return state;
}

/** The four installers and everything a declaration of theirs needs: the attack
    INDEX (not constant — two of the fourteen printings sit at 1), the energy, and
    the printed amount the install must write. Read off the local D1 per printing. */
const INSTALLERS = {
  "sv03-169": { index: 0, amount: 20, energy: [{ id: "fix-energy", count: 1 }], hit: 0 },
  "sv01-001": { index: 0, amount: 30, energy: [{ id: "fix-energy", count: 2 }], hit: 10 },
  "sv01-139": {
    index: 1,
    amount: 50,
    energy: [
      { id: "fix-metal-energy", count: 1 },
      { id: "fix-energy", count: 2 },
    ],
    hit: 90,
  },
  "sv02-048": { index: 1, amount: 100, energy: [{ id: "fix-water-energy", count: 3 }], hit: 100 },
  // The FIFTH producer, and the one no list named: Varoom has been in the fixture
  // pool since D131 as Revavroom ex's pre-evolution, printing this rider all along.
  "sv06.5-043": { index: 0, amount: 30, energy: [{ id: "fix-metal-energy", count: 1 }], hit: 0 },
} as const;

/** `armed`, then the install declared — asserting the row actually landed, so a
    board that failed to install can never leave a case asserting "nothing was
    reduced" against nothing. Returns P2's turn (the window). */
function installed(installer: keyof typeof INSTALLERS): GameState {
  const spec = INSTALLERS[installer];
  const { state, events } = mustApply(armed(installer, [...spec.energy]), {
    type: "attack",
    seat: "p1",
    index: spec.index,
  });
  const row = find(events, "DAMAGE_REDUCTION_APPLIED");
  if (row === undefined) throw new Error(`${installer} did not install a reduction`);
  if (row.amount !== spec.amount) throw new Error(`${installer} installed ${String(row.amount)}`);
  return state;
}

/** The declaration every read-site case is: put `attacker` on P2's Active with the
    energy it needs and swing into the shielded body. */
function swing(
  state: GameState,
  attacker: string,
  energy: { id: string; count: number }[],
  index = 0,
) {
  let next = setActiveFromDeck(state, "p2", attacker);
  for (const { id, count } of energy) next = attachFromDeck(next, "p2", id, count);
  return mustApply(next, { type: "attack", seat: "p2", index });
}

/** A live reduction written straight onto a body — for the boards no printing can
    reach (a BENCHED holder; a reduction sitting beside D142's block). D144/D146's
    precedent for pinning a rule with no card behind it. */
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

/** The rendered log, flattened to `{ who, text }` — the shape the neighbouring
    suites read a sequence in. */
function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

describe("the durated damage reduction — derived, not authored", () => {
  it("derives every printed amount off ONE anchor with ONE capture", () => {
    // FOUR amounts, one `(\d+)` (D120's precondition met: a NUMBER is closed by
    // its type, unlike the open consequent vocabularies that earn a row each).
    // 100 is included even though only the COMPOUND prints it, because the capture
    // is the same capture — the bare anchor must be able to read a number it will
    // never be handed rather than accidentally enumerating three.
    for (const amount of [20, 30, 50, 100]) {
      expect(deriveAttackEffect(bare(amount))).toEqual([{ op: "reduceDamage", amount }]);
    }
    // …and an amount nothing prints derives too, which is what makes the capture a
    // capture rather than a three-row table with a regex around it.
    expect(deriveAttackEffect(bare(70))).toEqual([{ op: "reduceDamage", amount: 70 }]);
  });

  it("refuses a printed ZERO — the guard every arm in this family carries", () => {
    // A "takes 0 less damage" record changes no arithmetic anywhere and would emit
    // a row announcing a protection that does not exist, which is worse than an
    // unread sentence. No such printing exists; the guard is the point.
    expect(deriveAttackEffect(bare(0))).toBeNull();
  });

  it("folds the typographic apostrophe", () => {
    // A re-ingest that changes only punctuation must not silently un-simulate
    // fourteen printings (D136/D137). The `['’]` class sits BEFORE the capture,
    // which a template-per-amount build would have had to spell three times.
    for (const amount of [20, 30, 50]) {
      expect(deriveAttackEffect(bare(amount).replace(/'/g, "’"))).toEqual(
        deriveAttackEffect(bare(amount)),
      );
    }
    expect(deriveAttackEffect(COMPOUND.replace(/'/g, "’"))).toEqual(deriveAttackEffect(COMPOUND));
  });

  it("is UNGATED — no coin is printed on any of the fourteen", () => {
    const derived = deriveAttackEffect(bare(30)) as EffectOp[];
    expect(derived.map((op) => op.op)).toEqual(["reduceDamage"]);
    // And a coin prefix must not ride in front of the anchor and install silently:
    // the anchor starts at "During", so this is a property of `^` rather than luck.
    expect(deriveAttackEffect(`Flip a coin. If heads, ${bare(30).toLowerCase()}`)).toBeNull();
  });

  it("is anchored end to end", () => {
    expect(deriveAttackEffect(`Then, ${bare(30)}`)).toBeNull();
    expect(deriveAttackEffect(bare(30).slice(0, -1))).toBeNull();
    expect(deriveAttackEffect(bare(30).toLowerCase())).toBeNull();
    expect(deriveAttackEffect(`${bare(30)} Draw a card.`)).toBeNull();
    // The parenthetical is IN the anchor, so dropping it is a different sentence.
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, this Pokémon takes 30 less damage from attacks.",
      ),
    ).toBeNull();
  });

  it("refuses the ALWAYS-ON spelling — the duration is the whole difference", () => {
    // Bouffalant sv03-174 "Bouffer", Stonjourner sv01-121 "Exoskeleton" and
    // Copperajah ex sv02-150/-245 "Bronze Body" print THIS sentence, and all three
    // are simulated — as a registry PASSIVE, not as an attack effect. Deriving it
    // here would install a one-turn stamp for a permanent Ability, i.e. read the
    // right number at the right step for the wrong lifetime.
    expect(deriveAttackEffect(ALWAYS_ON)).toBeNull();
    expect(programFor("sv03-174")?.passive?.damageReductionAfterWR).toBe(20);
    expect(programFor("sv01-121")?.passive?.damageReductionAfterWR).toBe(20);
    expect(programFor("sv02-150")?.passive?.damageReductionAfterWR).toBe(30);
    // …and the bare anchor really is that sentence with four words in front of it,
    // so the refusal is a property of the anchor rather than of the shape.
    expect(bare(20)).toBe(`During your opponent's next turn, this ${ALWAYS_ON.slice(5)}`);
  });

  it("refuses the ATTACKER-side family — the OTHER parenthetical", () => {
    // 6 printings that reduce damage by a flat number BEFORE Weakness and
    // Resistance, on the ATTACKER's side of the table. Same verb, same units, a
    // different body and a different step — so a reader keying on "N less damage"
    // would have shipped five attacks and an Ability backwards.
    //
    // ⚠️ RE-POINTED AT D149, NOT DELETED — NULL → SHAPE, D145's rule and the move
    // D147 itself made on two witnesses. The five ATTACK printings now derive, to
    // an op of their own on a field of their own, and the claim this case makes
    // gets SHARPER rather than weaker: the demand is no longer "nothing reads
    // this" but "the other reader reads it, and this one still does not" — i.e.
    // two readers must not claim one printed clause (D148's own sharpening of
    // `typeNameClause`). The ABILITY sentence stays flatly NULL: it is a
    // cross-board aura with an Active clause on both ends, deliberately out of
    // D149's scope, and an attack reader that swallowed it would install a
    // one-turn stamp for a permanent Ability.
    for (const text of BEFORE_WR_ATTACKS) {
      expect(deriveAttackEffect(text)).not.toBeNull();
      expect((deriveAttackEffect(text) as EffectOp[])[0]?.op).toBe("weakenDefenderAttacks");
      // …and NOT this slice's op, which is the whole point of the parenthetical.
      expect(deriveAttackEffect(text)).not.toEqual([{ op: "reduceDamage", amount: 100 }]);
    }
    expect(deriveAttackEffect(BEFORE_WR_ABILITY)).toBeNull();
    // The two parentheticals differ in ONE WORD; assert that the refusal survives
    // the minimal rewrite rather than depending on the rest of the sentence — and
    // now in BOTH directions, since the "before" spelling has a reader.
    expect(deriveAttackEffect(bare(30).replace("after applying", "before applying"))).toBeNull();
    expect(
      deriveAttackEffect(
        (BEFORE_WR_ATTACKS[0] as string).replace("before applying", "after applying"),
      ),
    ).toBeNull();
  });

  it("derives the COMPOUND to TWO ops in printed order — the free count", () => {
    // Eiscue sv02-048/-205 "Frigid Block". Its first sentence has derived since
    // 0.x, so the pair costs ONE regex — D145's census flagged this exact printing
    // as one of the four compounds `SELF_DISCARD_ALL`'s `$` keeps out, and this is
    // the day it said would come.
    expect(deriveAttackEffect(COMPOUND)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "reduceDamage", amount: 100 },
    ]);
    // The discard half is BYTE-IDENTICAL to the bare discard anchor's own output
    // (D132's inventory rule with nothing left over on that half)…
    const compound = deriveAttackEffect(COMPOUND) as EffectOp[];
    expect(compound[0]).toEqual(
      (deriveAttackEffect("Discard all Energy from this Pokémon.") as EffectOp[])[0],
    );
    // …and the reduction half is byte-identical to the bare reduction anchor's.
    expect(compound[1]).toEqual((deriveAttackEffect(bare(100)) as EffectOp[])[0]);
  });

  it("keeps the two anchors mutually exclusive in BOTH directions", () => {
    // The bare anchor must REFUSE the compound — otherwise it would ship the
    // shield without the cost that buys it…
    expect(deriveAttackEffect(bare(100))).not.toEqual(deriveAttackEffect(COMPOUND));
    expect((deriveAttackEffect(COMPOUND) as EffectOp[]).length).toBe(2);
    // …and the compound anchor must refuse the bare sentence, which is the
    // direction a session only checks when it is told to: a compound anchor that
    // matched the bare string would silently discard a board's whole attachment.
    expect(deriveAttackEffect(bare(100))).toEqual([{ op: "reduceDamage", amount: 100 }]);
    // Mutual exclusion is decided by the capitalised first word plus `^…$`, before
    // either body is considered — assert the prefix relationship that makes it so.
    expect(COMPOUND.endsWith(bare(100))).toBe(true);
    expect(COMPOUND.startsWith("Discard all Energy")).toBe(true);
    // And the BARE DISCARD anchor still refuses the compound (D145's live guard —
    // pinned in `attackPark.test.ts` and `tailsSelfCost.test.ts` too, and here
    // because this is the slice that made it load-bearing rather than theoretical).
    expect(deriveAttackEffect("Discard all Energy from this Pokémon.")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
    ]);
  });

  it("costs zero registry rows — all four cards simulate off their printed text", () => {
    for (const id of Object.keys(INSTALLERS)) expect(programFor(id)?.attack).toBeUndefined();
  });

  it("keeps the fixtures' NAME, text, cost, damage and INDEX verbatim", () => {
    // Ids, NAMES, costs, printed damage and the INDEX all checked against the local
    // D1 (2026-08-02, 978 cards / 6 sets) PER PRINTING — D144's rule, extended to names by
    // D146 after four consecutive lists carried two wrong ones.
    expect(FIXTURE_POOL["sv03-169"]?.name).toBe("Swablu");
    expect(FIXTURE_POOL["sv03-169"]?.attacks?.[0]).toEqual({
      cost: ["Colorless"],
      name: "Fluffy Guard",
      effect: bare(20),
    });
    expect(FIXTURE_POOL["sv01-001"]?.name).toBe("Pineco");
    expect(FIXTURE_POOL["sv01-001"]?.attacks?.[0]).toEqual({
      cost: ["Colorless", "Colorless"],
      name: "Guard Press",
      damage: 10,
      effect: bare(30),
    });
    expect(FIXTURE_POOL["sv01-139"]?.name).toBe("Forretress");
    expect(FIXTURE_POOL["sv01-139"]?.attacks?.[1]?.name).toBe("Rolling Shell");
    expect(FIXTURE_POOL["sv01-139"]?.attacks?.[1]?.cost).toEqual([
      "Metal",
      "Colorless",
      "Colorless",
    ]);
    expect(FIXTURE_POOL["sv01-139"]?.attacks?.[1]?.damage).toBe(90);
    expect(FIXTURE_POOL["sv01-139"]?.attacks?.[1]?.effect).toBe(bare(50));
    expect(FIXTURE_POOL["sv02-048"]?.name).toBe("Eiscue");
    expect(FIXTURE_POOL["sv02-048"]?.attacks?.[1]).toEqual({
      cost: ["Water", "Water", "Water"],
      name: "Frigid Block",
      damage: 100,
      effect: COMPOUND,
    });
    // ⚠️ THE INDEX IS NOT CONSTANT ACROSS THE FAMILY — two of the fourteen print
    // the rider at index 1 and the other twelve at index 0, which is why each was
    // read separately rather than once for the family.
    expect(Object.values(INSTALLERS).map((s) => s.index)).toEqual([0, 0, 1, 1, 0]);
    // …and Varoom, fielded for an unrelated slice, is verbatim too.
    expect(FIXTURE_POOL["sv06.5-043"]?.name).toBe("Varoom");
    expect(FIXTURE_POOL["sv06.5-043"]?.attacks?.[0]).toEqual({
      cost: ["Metal"],
      name: "Rigidify",
      effect: bare(30),
    });
    // Pineco is Forretress's PRE-EVOLUTION, which is what lets the §10 evolve clear
    // and the "the record belongs to the Pokémon" case run off two printed cards.
    expect(FIXTURE_POOL["sv01-139"]?.evolveFrom).toBe("Pineco");
    expect(FIXTURE_POOL["sv01-001"]?.stage).toBe("Basic");
    // The Weakness lines are the reason these four rather than any other four.
    expect(FIXTURE_POOL["sv02-048"]?.weaknesses).toEqual([{ type: "Metal", value: "×2" }]);
    expect(FIXTURE_POOL["sv01-139"]?.types).toEqual(["Metal"]);
    expect(bare(30)).toContain("opponent's");
    expect(bare(30)).not.toContain("’");
  });

  it("emits `reduceDamage` from exactly the four printings, swept over the pool", () => {
    // The producer SET, discovered rather than listed (D145's move): a fifth
    // producer fails loudly instead of being absorbed, and the amounts it emits
    // are asserted to be the printed ones rather than "some number".
    const producers = new Map<string, number[]>();
    const walk = (ops: EffectOp[], id: string) => {
      for (const op of ops) {
        if (op.op === "coinFlipGate") walk(op.then, id);
        else if (op.op === "reduceDamage") {
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
    // ⚠️ FIVE, NOT FOUR — AND THE FIFTH IS WHY THIS SWEEP IS A SWEEP. Varoom
    // sv06.5-043 has been in the fixture pool since D131's promoted-clause work,
    // fielded as the PRE-EVOLUTION of Revavroom ex, and its index-0 "Rigidify"
    // has been printing this family's 30 the whole time with nothing reading it.
    // The suite discovered it; no list mentioned it; and the same thing was true
    // of Forretress sv01-139's index-1 "Rolling Shell", which this slice went
    // looking for and found already fielded. Two of the fourteen printings were
    // ALREADY SITTING IN THE POOL as unmapped riders on cards fielded for other
    // reasons — which is the strongest argument this file makes for discovering a
    // producer set rather than listing it.
    expect([...producers.entries()].sort()).toEqual([
      ["sv01-001", [30]],
      ["sv01-139", [50]],
      ["sv02-048", [100]],
      ["sv03-169", [20]],
      ["sv06.5-043", [30]],
    ]);
  });
});

describe("the durated damage reduction — installing it", () => {
  it("installs with NO coin — the rngState does not move", () => {
    const before = armed("sv03-169", [{ id: "fix-energy", count: 1 }]);
    const { state: done, events } = mustApply(before, { type: "attack", seat: "p1", index: 0 });
    expect(done.rngState).toBe(before.rngState);
    expect(types(events)).not.toContain("ATTACK_EFFECT_COIN_FLIP");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("stamps the OPPONENT's next turn and names the AMOUNT in the actor's voice", () => {
    const state = armed("sv01-001", [{ id: "fix-energy", count: 2 }]);
    const installer = activeUid(state, "p1");
    expect(state.turn).toBe(2);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    expect(find(events, "DAMAGE_REDUCTION_APPLIED")).toEqual({
      type: "DAMAGE_REDUCTION_APPLIED",
      seat: "p1",
      uid: installer,
      amount: 30,
    });
    // D142's stamp arithmetic, unchanged and re-driven on the third field that
    // uses it: turn 2 installed it, turn 3 is the opponent's, and that is the only
    // turn it answers on. NOT the installing turn — the printed word is "next".
    expect(done.players.p1.active?.damageReduction).toEqual({ turn: 3, amount: 30 });
    expect(done.turn).toBe(3);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // Attacker-relative, like every "self" op: nothing else on either board moved.
    expect(done.players.p2.active?.damageReduction).toBeNull();
    for (const seat of ["p1", "p2"] as const) {
      for (const benched of done.players[seat].bench) expect(benched.damageReduction).toBeNull();
    }
  });

  it("installs the PRINTED amount on all four printings, at their own INDEX", () => {
    for (const [id, spec] of Object.entries(INSTALLERS)) {
      const { state: done, events } = mustApply(armed(id, [...spec.energy]), {
        type: "attack",
        seat: "p1",
        index: spec.index,
      });
      expect(find(events, "DAMAGE_REDUCTION_APPLIED")?.amount, id).toBe(spec.amount);
      expect(done.players.p1.active?.damageReduction, id).toEqual({ turn: 3, amount: spec.amount });
    }
  });

  it("keeps the printed damage — a D125 tail board on the three that hit", () => {
    for (const id of ["sv01-001", "sv01-139", "sv02-048"] as const) {
      const spec = INSTALLERS[id];
      const { events } = mustApply(armed(id, [...spec.energy]), {
        type: "attack",
        seat: "p1",
        index: spec.index,
      });
      const order = types(events);
      // The §8.5 hit lands FIRST and the install rides the tail behind it — free
      // rather than lucky, since the reduction's whole effect is in the future.
      expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(
        order.indexOf("DAMAGE_REDUCTION_APPLIED"),
      );
      const row = find(events, "DAMAGE_DEALT");
      expect(row?.dealt, id).toBe(spec.hit);
      if (row !== undefined) expectAfterWR(row);
    }
    // Swablu prints NO damage at all, so its declaration is the install and
    // nothing else — the control the other three are read against.
    const { events } = mustApply(armed("sv03-169", [{ id: "fix-energy", count: 1 }]), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).toContain("DAMAGE_REDUCTION_APPLIED");
  });

  it("does not leak across the attack index", () => {
    // Forretress installs at index 1; its index-0 "Continuous Spin" must not.
    // (It flips, so this is also the one declaration in the suite that moves the
    // rngState — asserted, so the seed-free claim above stays honest.)
    const before = armed("sv01-139", [{ id: "fix-metal-energy", count: 1 }]);
    const { state: done, events } = mustApply(before, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("DAMAGE_REDUCTION_APPLIED");
    expect(done.players.p1.active?.damageReduction).toBeNull();
    expect(done.rngState).not.toBe(before.rngState);
    // …and Eiscue's index-0 "Headbutt" (20, no effect) likewise.
    const eiscue = mustApply(armed("sv02-048", [{ id: "fix-water-energy", count: 1 }]), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(eiscue.events)).not.toContain("DAMAGE_REDUCTION_APPLIED");
    expect(eiscue.state.players.p1.active?.damageReduction).toBeNull();
  });

  it("resolves the COMPOUND in printed order — the cost, then the shield", () => {
    const state = armed("sv02-048", [{ id: "fix-water-energy", count: 3 }]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const order = types(events);
    // Printed order, and the only order that reads right: the discard is the COST
    // and the reduction is what it buys, so announcing the shield first would
    // describe the card backwards.
    expect(order.indexOf("ENERGY_DISCARDED")).toBeLessThan(
      order.indexOf("DAMAGE_REDUCTION_APPLIED"),
    );
    // …and behind the printed 100, which is the §8.5 hit.
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("ENERGY_DISCARDED"));
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(100);
    // The cost is real: all three {W} are gone, so the shielded body cannot attack
    // again — the printed trade, driven rather than described.
    expect(done.players.p1.active?.energy).toEqual([]);
    expect(find(events, "ENERGY_DISCARDED")?.uids).toHaveLength(3);
    expect(done.players.p1.active?.damageReduction).toEqual({ turn: 3, amount: 100 });
  });
});

describe("the durated damage reduction — the §8.5 ORDERING the parenthetical pins", () => {
  it("subtracts AFTER Weakness: Metal 90 into a ×2 Metal body with 100 installed", () => {
    // ⚠️ THE SLICE'S HEADLINE NUMBER, and it is driven off two printed cards with
    // no surgery in it. Forretress sv01-139 (Metal) declares "Rolling Shell" (90)
    // into Eiscue sv02-048, which is ×2 METAL and carrying its own 100:
    //
    //     printed:  90 × 2 = 180, − 100 = 80        ← what the card says
    //     reversed: max(0, 90 − 100) = 0, × 2 = 0   ← a reduction that never fires
    //
    // The wrong order turns a 100-point reduction into TOTAL IMMUNITY against a
    // 90-point attack, and the 110 HP body ends the turn alive either way — so the
    // difference is visible in `dealt` rather than only in a KO.
    let state = installed("sv02-048");
    const shielded = activeUid(state, "p1");
    state = clearBench(state, "p1");
    const { state: done, events } = swing(
      state,
      "sv01-139",
      [
        { id: "fix-metal-energy", count: 1 },
        { id: "fix-energy", count: 2 },
      ],
      1,
    );
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.uid).toBe(shielded);
    expect(row?.base).toBe(90);
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row?.reduction).toBe(100);
    expect(row?.dealt).toBe(80);
    // The reversed reading is 0, i.e. the two are not merely different numbers but
    // opposite CONCLUSIONS about whether the attack did anything at all.
    if (row !== undefined) {
      expect(pipeline(row).beforeWR).toBe(0);
      expectAfterWR(row);
    }
    expect(done.players.p1.active?.damage).toBe(80);
    // …and the row does NOT say `prevented`: a clamped or heavy reduction is not a
    // §11 prevention, and the two are different facts about the same 0.
    expect(row?.prevented).toBeUndefined();
  });

  it("subtracts AFTER Weakness on the smaller amounts too — 60 Fire, ×2, −50 and −30", () => {
    // Forretress (120 HP, ×2 Fire, 50 installed) takes fix-attacker's Flame (60):
    //   printed  60 × 2 = 120, − 50 = 70
    //   reversed (60 − 50) × 2 = 20
    let state = clearBench(installed("sv01-139"), "p1");
    const forretress = swing(state, "fix-attacker", [
      { id: "fix-fire-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ], 1);
    const tank = find(forretress.events, "DAMAGE_DEALT");
    expect(tank?.dealt).toBe(70);
    if (tank !== undefined) {
      expect(pipeline(tank).beforeWR).toBe(20);
      expectAfterWR(tank);
    }
    // Pineco (60 HP, ×2 Fire, 30 installed) takes the same 60:
    //   printed  60 × 2 = 120, − 30 = 90   → KNOCKED OUT
    //   reversed (60 − 30) × 2 = 60        → also lethal on 60 HP, which is why the
    //                                        assertion is on the NUMBER as well
    state = clearBench(installed("sv01-001"), "p1");
    state = benchFromDeck(state, "p1", "fix-titan"); // a promote target
    const pineco = swing(state, "fix-attacker", [
      { id: "fix-fire-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ], 1);
    const small = find(pineco.events, "DAMAGE_DEALT");
    expect(small?.dealt).toBe(90);
    if (small !== undefined) {
      expect(pipeline(small).beforeWR).toBe(60);
      expectAfterWR(small);
    }
    expect(types(pineco.events)).toContain("KNOCKED_OUT");
  });

  it("subtracts AFTER Weakness on EVERY ×2 board this pool can build", () => {
    // A TABLE rather than a case, because the mutation this suite most needs to
    // catch — moving the subtraction one step earlier — is only observable where a
    // Weakness and a live reduction sit on the SAME body, and the pool offers
    // exactly these boards. Each row states the printed answer and the reversed
    // one, and the reversed one is asserted to be what the engine did NOT do.
    const boards = [
      // installer, its amount, attacker index/energy, printed dealt, reversed dealt
      // Pineco (×2 Fire, 30) taking Bite (30 Fire): 60 − 30 = 30 vs (30−30)×2 = 0.
      { installer: "sv01-001" as const, index: 0, dealt: 30, reversed: 0 },
      // Forretress (×2 Fire, 50) taking Bite (30 Fire): 60 − 50 = 10 vs 0.
      { installer: "sv01-139" as const, index: 0, dealt: 10, reversed: 0 },
      // Varoom (×2 Fire, 30) taking Bite (30 Fire): 60 − 30 = 30 vs 0. A third
      // card, and the one no remainder list ever named.
      { installer: "sv06.5-043" as const, index: 0, dealt: 30, reversed: 0 },
    ];
    for (const board of boards) {
      const state = clearBench(installed(board.installer), "p1");
      const { events } = swing(state, "fix-attacker", [{ id: "fix-energy", count: 1 }], board.index);
      const row = find(events, "DAMAGE_DEALT");
      expect(row?.dealt, board.installer).toBe(board.dealt);
      if (row !== undefined) {
        expect(pipeline(row).beforeWR, board.installer).toBe(board.reversed);
        expectAfterWR(row);
      }
    }
  });

  it("COMMUTES with Resistance — which is why only Weakness makes the order visible", () => {
    // Both Resistance and this reduction are ADDITIVE, so they can be applied in
    // either order and give the same number. That is not a gap in the test: it is
    // the reason the printed parenthetical exists at all, and the reason the
    // fixtures were chosen for their WEAKNESS lines. Asserted on the arithmetic
    // rather than on a board, because no Grass attacker in this deck hits the
    // Active — the claim is about the operation, not about a card.
    const resisted = {
      base: 100,
      weakness: null,
      resistance: { op: "subtract", amount: 30 } as DamageModifier,
      reduction: 50,
    };
    expect(pipeline(resisted).afterWR).toBe(pipeline(resisted).beforeWR);
    // …and the moment a Weakness joins it, they diverge.
    const weak = {
      base: 100,
      weakness: { op: "multiply", amount: 2 } as DamageModifier,
      resistance: { op: "subtract", amount: 30 } as DamageModifier,
      reduction: 50,
    };
    // 100 × 2 = 200, − 30 = 170, − 50 = 120  vs  (100 − 50) × 2 = 100, − 30 = 70.
    expect(pipeline(weak).afterWR).toBe(120);
    expect(pipeline(weak).beforeWR).toBe(70);
  });

  it("CLAMPS at zero and does not go negative — and a clamped 0 is not a prevention", () => {
    // Eiscue's 100 against fix-attacker's Bite (30, Fire — Eiscue is ×2 METAL, so
    // no Weakness): max(0, 30 − 100) = 0. The clamp is `attack.ts`'s existing
    // `Math.max(0, …)`, inherited by summing into the number it already guarded.
    let state = clearBench(installed("sv02-048"), "p1");
    const { state: done, events } = swing(state, "fix-attacker", [{ id: "fix-energy", count: 1 }]);
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(30);
    expect(row?.reduction).toBe(100);
    expect(row?.dealt).toBe(0);
    expect(row?.weakness).toBeNull();
    // ⚠️ `prevented` STAYS ABSENT. A 0 from a big reduction and a 0 from a §11
    // block are the same number and different facts — the block SUPERSEDES the
    // pipeline, this ran it — and the row must not claim the second.
    expect(row?.prevented).toBeUndefined();
    // The body took nothing, and the damage field is still exactly 0 rather than
    // having gone negative anywhere on the way.
    expect(done.players.p1.active?.damage).toBe(0);
    expect(row?.damage).toBe(0);
    state = done;
    expect(state.players.p1.active?.damageReduction).toEqual({ turn: 3, amount: 100 });
  });
});

describe("the durated damage reduction — the four READ SITES", () => {
  it("reduces the §8.5 MAIN HIT", () => {
    // Swablu (50 HP, ×2 Lightning, 20 installed) takes Bite (30, Fire — neutral):
    // 30 − 20 = 10.
    const state = clearBench(installed("sv03-169"), "p1");
    const { events } = swing(state, "fix-attacker", [{ id: "fix-energy", count: 1 }]);
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.dealt).toBe(10);
    expect(row?.reduction).toBe(20);
    if (row !== undefined) expectAfterWR(row);
  });

  it("reduces an Active-target SNIPE — `snipeActive`, the other site that runs W/R", () => {
    // Rotom sv01-069's "Linear Attack" ({C}, `opponentAny` 20, `deals`) into
    // Swablu's ×2 LIGHTNING and its own 20: 20 × 2 = 40, − 20 = 20. This is the
    // second of the four sites that runs Weakness at all, so the ordering claim is
    // pinned twice on two different code paths rather than once.
    let state = clearBench(installed("sv03-169"), "p1"); // one candidate → no park
    state = setDamage(state, "p1", 0);
    const { events } = swing(state, "sv01-069", [{ id: "fix-energy", count: 1 }]);
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.base).toBe(20);
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row?.reduction).toBe(20);
    expect(row?.dealt).toBe(20);
    if (row !== undefined) {
      expect(pipeline(row).beforeWR).toBe(0);
      expectAfterWR(row);
    }
  });

  it("reduces SPREAD damage on the Bench — guarded at a site no printing reaches", () => {
    // ⚠️ UNREACHABLE OFF ANY CARD, GUARDED ANYWAY (D146's precedent). A reduction
    // can only be installed from the Active Spot and leaving it clears the record,
    // so no legal sequence puts a LIVE one on a benched body. Ignoring it there
    // would make the field mean one thing at two sites and another at two more,
    // purely because no printing reaches them — an accident rather than a guard.
    let state = clearBench(installed("sv03-169"), "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    state = withReduction(state, "p1", { bench: 0 }, 20);
    const { events } = swing(state, "fix-sniper", [{ id: "fix-energy", count: 1 }]);
    const bench = findAll(events, "DAMAGE_DEALT").find(
      (e) => e.uid === benchTopUid(state, "p1", 0),
    );
    // Spread Shot puts 20 on each benched Pokémon; the installed 20 takes it to 0.
    expect(bench?.base).toBe(20);
    expect(bench?.reduction).toBe(20);
    expect(bench?.dealt).toBe(0);
    // …and §8.5 says no Weakness on the Bench, so this site's `afterWR` and
    // `beforeWR` agree — the reduction is the whole of what it does there.
    if (bench !== undefined) expectAfterWR(bench);
  });

  it("reduces a benched `deals` SNIPE — `placeSnipe`'s damage arm", () => {
    // fix-bramble's per-40 benched snipe, scaled by the Prizes the opponent has
    // TAKEN. One Prize taken → 40 to the single benched target, whose constructed
    // 20 takes it to 20. Same unreachability argument as the spread above.
    let state = clearBench(installed("sv03-169"), "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    state = withReduction(state, "p1", { bench: 0 }, 20);
    state = setPrizes(state, "p1", 5); // 6 − 5 = 1 Prize taken by P2's opponent…
    const { events } = swing(state, "fix-bramble", [{ id: "fix-energy", count: 1 }]);
    const bench = findAll(events, "DAMAGE_DEALT").find(
      (e) => e.uid === benchTopUid(state, "p1", 0),
    );
    expect(bench?.base).toBe(40);
    expect(bench?.reduction).toBe(20);
    expect(bench?.dealt).toBe(20);
    if (bench !== undefined) expectAfterWR(bench);
  });
});

describe("the durated damage reduction — the LIFETIME", () => {
  it("is DEAD on the holder's own following turn, with the stale stamp left alone", () => {
    // The whole of what a turn STAMP buys: no boundary clear anywhere, so the
    // record simply stops answering. Driven across two turn boundaries.
    let state = clearBench(installed("sv03-169"), "p1");
    expect(state.turn).toBe(3);
    expect(state.players.p1.active?.damageReduction).toEqual({ turn: 3, amount: 20 });
    // P2 passes; turn 4 is P1's own and the window has closed.
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(4);
    expect(state.players.p1.active?.damageReduction).toEqual({ turn: 3, amount: 20 });
    // P1 passes back; on turn 5 the same attacker hits for the UNREDUCED number.
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    const { events } = swing(state, "fix-attacker", [{ id: "fix-energy", count: 1 }]);
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.dealt).toBe(30);
    expect(row?.reduction).toBeUndefined();
  });

  it("ends when the Pokémon leaves the Active Spot — a Boss's Orders INSIDE the window", () => {
    // §10's reachable clear, and it is reachable for D142's reason rather than
    // D143's: the window belongs to the OPPONENT, so the opponent is the only
    // player who can move the body while it is live.
    let state = installed("sv03-169");
    const shielded = activeUid(state, "p1");
    expect(state.players.p1.bench.length).toBeGreaterThan(0);
    state = handFromDeck(state, "p2", "sv02-172", 1);
    const gusted = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-172"),
    });
    let next = gusted.state;
    if (next.phase.kind === "effect:choose") {
      next = must(
        applyAction(next, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    const benchIndex = next.players.p1.bench.findIndex((p) => p.stack.includes(shielded));
    expect(benchIndex).toBeGreaterThanOrEqual(0);
    expect(next.players.p1.bench[benchIndex]?.damageReduction).toBeNull();
    // Silent: the POKEMON_SWITCHED row already tells the story (D112's call).
    expect(types(gusted.events)).not.toContain("DAMAGE_REDUCTION_APPLIED");
    // And it is GONE rather than merely unread — the promoted body takes a full hit.
    const { events } = swing(next, "fix-attacker", [{ id: "fix-energy", count: 1 }]);
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.reduction).toBeUndefined();
  });

  it("ends on EVOLVING — unreachable by construction, written anyway", () => {
    // §10 sheds the effects of ATTACKS. Installing ends the turn, the window is the
    // opponent's, and nobody evolves on someone else's turn — so no legal sequence
    // puts an evolution between the install and the expiry, exactly as at D142.
    // A surgery pins the RULE rather than a sequence, and the pair is real cards:
    // Pineco (30) evolving into Forretress (50), which also shows the record is the
    // POKÉMON's rather than the card's.
    let state = installed("sv01-001");
    // Hand the window back so the holder's controller may act, then re-stamp the
    // record onto the (now current) turn so the clear has something live to remove.
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(4);
    state = withReduction(state, "p1", "active", 30, 4);
    expect(state.players.p1.active?.damageReduction).toEqual({ turn: 4, amount: 30 });
    state = handFromDeck(state, "p1", "sv01-139", 1);
    const { state: done, events } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "sv01-139"),
      target: { spot: "active" },
    });
    expect(types(events)).toContain("POKEMON_EVOLVED");
    expect(done.players.p1.active?.damageReduction).toBeNull();
    // Silent, like every §10 clear in this family: POKEMON_EVOLVED is the row.
    expect(types(events)).not.toContain("DAMAGE_REDUCTION_APPLIED");
  });

  it("leaves play with a KNOCKED OUT holder", () => {
    // The promoted body is a DIFFERENT Pokémon and carries no reduction, which is
    // what makes this a per-Pokémon effect rather than a per-player one.
    let state = clearBench(installed("sv03-169"), "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    state = setDamage(state, "p1", 40); // 50 HP Swablu, 30 Bite − 20 = 10 incoming
    const { state: done, events } = swing(state, "fix-attacker", [{ id: "fix-energy", count: 1 }]);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(10);
    expect(types(events)).toContain("KNOCKED_OUT");
    let next = done;
    expect(next.phase.kind).toBe("ko:takePrizes");
    next = must(applyAction(next, { type: "takePrizes", seat: "p2", prizeIndices: [0] }));
    if (next.phase.kind === "ko:promote") {
      next = must(applyAction(next, { type: "promote", seat: "p1", benchIndex: 0 }));
    }
    expect(next.players.p1.active?.damageReduction).toBeNull();
  });

  it("MERGES by MAX when installed twice in one window, and says nothing when it need not", () => {
    // Unreachable off any printing (one attack per turn, and no card prints two of
    // these), so it is constructed — D144/D146's precedent. The rule is D142's `||`
    // with the boolean replaced by a number: a second installation may never leave
    // the holder with LESS protection than one of them printed.
    let state = armed("sv03-169", [{ id: "fix-energy", count: 1 }]);
    state = withReduction(state, "p1", "active", 50, state.turn + 1);
    const bigger = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // The printed 20 landing on top of a 50 must NOT downgrade it…
    expect(bigger.state.players.p1.active?.damageReduction).toEqual({ turn: 3, amount: 50 });
    // …and, having changed nothing, it says nothing (D140/D146: announcing a
    // re-install that moved no number would be announcing a non-event).
    expect(types(bigger.events)).not.toContain("DAMAGE_REDUCTION_APPLIED");

    // The other direction: a smaller existing record is raised, and the row reports
    // the MERGED number rather than the printed one, because the row must describe
    // the state that now exists.
    let smaller = armed("sv03-169", [{ id: "fix-energy", count: 1 }]);
    smaller = withReduction(smaller, "p1", "active", 10, smaller.turn + 1);
    const raised = mustApply(smaller, { type: "attack", seat: "p1", index: 0 });
    expect(raised.state.players.p1.active?.damageReduction).toEqual({ turn: 3, amount: 20 });
    expect(find(raised.events, "DAMAGE_REDUCTION_APPLIED")?.amount).toBe(20);

    // A stamp from a DIFFERENT (stale) window is replaced outright rather than
    // merged — there is nothing to preserve in a record that answers nothing.
    let stale = armed("sv03-169", [{ id: "fix-energy", count: 1 }]);
    stale = withReduction(stale, "p1", "active", 90, 1);
    const replaced = mustApply(stale, { type: "attack", seat: "p1", index: 0 });
    expect(replaced.state.players.p1.active?.damageReduction).toEqual({ turn: 3, amount: 20 });
  });
});

describe("the durated damage reduction — beside D142's block", () => {
  it("is SUPERSEDED by a live block on the same body", () => {
    // Two durated effects, one body, one window — the board the third stamped
    // field makes reachable. The block NULLS the result and the reduction is
    // subtracted inside the pipeline, so when both are live the block wins and the
    // row says `prevented` rather than merely reporting a big `reduction`.
    let state = clearBench(installed("sv02-048"), "p1");
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, active: { ...active, attackBlock: { turn: 3, effects: false } } },
      },
    };
    const { events } = swing(state, "fix-attacker", [{ id: "fix-energy", count: 1 }]);
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.prevented).toBe(true);
    expect(row?.dealt).toBe(0);
    // The reduction is still COMPUTED and REPORTED — the block supersedes, it does
    // not skip, which is the same claim D142 made about Weakness on this row.
    expect(row?.reduction).toBe(100);
  });

  it("still bites when a `fromClass` block DECLINES — the two are independent reads", () => {
    // ⚠️ THIS IS THE CASE THAT DECIDED THE GENERALISATION. `attackBlockOf` folds
    // D146's attacker-class filter into its own read and returns null for an
    // attacker the filter refuses; `installedReductionOf` has no filter and knows
    // nothing about attackers. Same body, same window, same four sites — two
    // independent answers, which is why a discriminated union would have merged
    // the STORAGE and shortened nothing.
    let state = clearBench(installed("sv01-139"), "p1"); // Forretress, 50 installed
    const active = state.players.p1.active;
    if (active === null) throw new Error("no Active");
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          // A block that only refuses BASIC attackers…
          active: { ...active, attackBlock: { turn: 3, effects: false, fromClass: { stage: "basic" } } },
        },
      },
    };
    // …met by a BASIC attacker: the block matches and nulls everything.
    const basic = swing(state, "fix-attacker", [
      { id: "fix-fire-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ], 1);
    expect(find(basic.events, "DAMAGE_DEALT")?.prevented).toBe(true);
    expect(find(basic.events, "DAMAGE_DEALT")?.dealt).toBe(0);
    // …and by a STAGE 1 (Forretress itself, Metal): the block declines, the attack
    // lands in full — and the reduction, which asked nobody about the attacker,
    // still takes its 50 off. 90 × 2 (Forretress is ×2 Fire… but the attacker here
    // is METAL and the target is a ×2 FIRE body, so no Weakness) − 50 = 40.
    const evolved = swing(
      state,
      "sv01-139",
      [
        { id: "fix-metal-energy", count: 1 },
        { id: "fix-energy", count: 2 },
      ],
      1,
    );
    const row = find(evolved.events, "DAMAGE_DEALT");
    expect(row?.prevented).toBeUndefined();
    expect(row?.reduction).toBe(50);
    expect(row?.dealt).toBe(40);
    if (row !== undefined) expectAfterWR(row);
  });
});

describe("the durated damage reduction — the VOICE", () => {
  it("renders in the ACTOR's own voice, naming the amount, in sequence", () => {
    const state = armed("sv01-001", [{ id: "fix-energy", count: 2 }]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const rows = rendered(done, events);
    const shield = rows.findIndex((r) => r.text.includes("less damage from attacks"));
    expect(shield).toBeGreaterThanOrEqual(0);
    // `seat` owns the protected Pokémon AND that Pokémon is the actor's own, so
    // the row credits the right player — the straightforward case D142 named, and
    // the opposite of D141's counterattack row. NOT a system row.
    expect(rows[shield]?.who).toBe("p1");
    expect(rows[shield]?.text).toBe(
      "Pineco takes 30 less damage from attacks during your opponent's next turn",
    );
    // Read in sequence: the declaration, the hit, then the shield — printed order.
    const hit = rows.findIndex((r) => r.text.includes("10 damage"));
    expect(hit).toBeGreaterThanOrEqual(0);
    expect(shield).toBeGreaterThan(hit);
  });

  it("says NOTHING when the reduction FIRES — `DAMAGE_DEALT.reduction` is the whole story", () => {
    // Loudness is owed to UNREAD TEXT, not to a read rule doing its job (D140,
    // D146). The number is already on the damage row, which has carried it since
    // Bouffalant "Bouffer" and names the FACT rather than the source.
    const state = clearBench(installed("sv03-169"), "p1");
    const { events } = swing(state, "fix-attacker", [{ id: "fix-energy", count: 1 }]);
    expect(types(events)).not.toContain("DAMAGE_REDUCTION_APPLIED");
    expect(find(events, "DAMAGE_DEALT")?.reduction).toBe(20);
  });
});
