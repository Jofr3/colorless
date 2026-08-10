import { describe, expect, it } from "vitest";
import { parseAttackDamage } from "./cards";
import {
  bonusConsequentProgram,
  deriveAttackBonusConsequent,
  deriveAttackCoinFlip,
  deriveAttackEffect,
} from "./effects";
import type { EffectOp } from "./effects";
import { programFor } from "./index";
import { FIXTURE_POOL, programBranchCarriers, walkProgram } from "./testFixtures";

// 0.190.0 → 0.191.0 — D276: THE PROGRAM SWEEP, EXTRACTED AND MADE STRUCTURAL.
//
// This file is not about a printed card. It is about the FIVE hand-rolled copies
// of one recursion that five auditors were each carrying, and about the fact that
// every one of them was a DIFFERENT subset of the same four branching ops.
//
//   preventBlock.test.ts `walkKinds`      coinFlipGate.then, conditionGate.then/otherwise,
//                                          recordGate.then/otherwise, optional.then   (4 ops)
//   vengefulPunch.test.ts `walk`          the same MINUS optional                     (3 ops)
//   tailsGatedOp.test.ts  `walk`          the same MINUS optional                     (3 ops)
//   attackDebuff.test.ts  `walk`          coinFlipGate.then, conditionGate only —
//                                          and chained through `else if`, so a
//                                          producer inside a gate is missed TWICE   (2 ops)
//   preventBlock.test.ts (invokedBy)      coinFlipGate.then                          (1 op)
//
// ⚠️ THE FAILURE MODE IS SILENT AND FLATTERING. A walk that misses a branch does
// not throw — it returns a SMALLER set, and a `toEqual` over a producer list goes
// GREEN because the row that would have broken it was never reached. `walkKinds`'s
// own doc block records this exact defect being found and patched FIVE separate
// times (D148, D150, D227), always one arm at a time and always AFTER a fixture
// happened to print the shape. That is not five mistakes; it is one missing
// abstraction, which is the standing rule about a debt paid N times.
//
// 🛑 SO THE PREDICATE IS NEGATIVE. `walkProgram` never asks which op it is
// looking at: a sub-program is any array-valued property whose elements are
// objects with a string `op`. The enumerated thing — the set of branching ops —
// GROWS with the union; the shape does not.
//
// 📊 WHAT THE MEASUREMENT ACTUALLY RETURNED, before any of this was written,
// because the handoff asked for the number rather than the plan:
//
//   • the structural walk finds 402 ops across FIXTURE_POOL + registry where
//     tailsGatedOp's enumerated walk finds 398;
//   • the whole 4-op difference is `optional.then` — three ops directly under one,
//     plus a `moveEnergy` one level deeper inside a `recordGate` that sits inside
//     an `optional`;
//   • 🛑 `coinFlipGate.otherwise` — THE GAP D269 FLAGGED AND D270–D275 CARRIED
//     FORWARD — occurs ZERO times. Widening that arm alone is STRUCTURALLY
//     INCAPABLE of changing any sweep's answer today. The flagged gap was the
//     wrong one; the live one was `optional.then`, and nobody had named it.

/** Every program the pool can hand an auditor, as (where, ops) pairs — the union
    of the two ATTACK sources, the abilities, the triggers and the trainer seam.
    Hoisted so the cases below sweep the SAME corpus rather than each choosing. */
function poolPrograms(): { where: string; ops: readonly EffectOp[] }[] {
  const out: { where: string; ops: readonly EffectOp[] }[] = [];
  for (const [id, card] of Object.entries(FIXTURE_POOL)) {
    for (const [index, attack] of (card.attacks ?? []).entries()) {
      const derived = attack.effect === undefined ? null : deriveAttackEffect(attack.effect);
      if (derived !== null) out.push({ where: `${id} attack ${index}`, ops: derived });
      // ⚠️ THE PROGRAM THAT DOES NOT HANG OFF AN OP. `programPerHeads.ops` is
      // reached through the COIN reading, not through an `EffectOp`, so no
      // structural walk can find it from a program root — it has to be fed in.
      // D150 found this the hard way; it is stated here so the next reader does
      // not have to.
      const coin = attack.effect === undefined ? null : deriveAttackCoinFlip(attack.effect);
      if (coin !== null && coin.kind === "programPerHeads") {
        out.push({ where: `${id} attack ${index} perHeads`, ops: coin.ops });
      }
      // 🆕 D317 — THE SECOND PROGRAM THAT DOES NOT HANG OFF AN OP, FED IN THE SAME
      // WAY AND FOR THE SAME REASON. `deriveAttackBonusConsequent` returns a
      // reading, and the gate that carries it needs the attack's PRINTED BASE,
      // which lives on the card rather than in the reading — so `attack.ts` is
      // where it is assembled at runtime and this is where it is assembled for the
      // sweep. 🛑 **THIS IS ONLY POSSIBLE BECAUSE THE ASSEMBLER IS EXPORTED.**
      // D316's `optional` is built inline in `attack.ts` and therefore CANNOT be
      // fed in here, which is exactly why this file's carrier pin below still
      // reports `optional` as carrying `then` alone while the op has had an
      // `otherwise` since that slice. A program a sweep cannot build is a program
      // the sweep cannot audit.
      const bonus =
        attack.effect === undefined ? null : deriveAttackBonusConsequent(attack.effect);
      if (bonus !== null) {
        out.push({
          where: `${id} attack ${index} bonusConsequent`,
          ops: bonusConsequentProgram(bonus, parseAttackDamage(attack.damage).base),
        });
      }
    }
    const authored = programFor(id);
    for (const [index, ops] of Object.entries(authored?.attack ?? {})) {
      out.push({ where: `${id} authored attack ${index}`, ops });
    }
    for (const ability of authored?.abilities ?? []) {
      out.push({ where: `${id} ${ability.name}`, ops: ability.program });
    }
    for (const trigger of authored?.triggered ?? []) {
      out.push({ where: `${id} trigger`, ops: trigger.program });
    }
    if (authored?.trainer !== undefined) out.push({ where: `${id} trainer`, ops: authored.trainer });
  }
  return out;
}

describe("walkProgram — the structural predicate", () => {
  it("yields the op itself, in pre-order, before its branches", () => {
    const program: EffectOp[] = [
      { op: "drawCards", count: 1 },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "coinFlipGate", then: [{ op: "gust" }] },
    ];
    expect(walkProgram(program).map((op) => op.op)).toEqual(["drawCards", "coinFlipGate", "gust"]);
  });

  it("⚠️ DESCENDS THE BRANCHES FOUR ENUMERATED WALKERS MISSED — `otherwise` AND `optional.then`", () => {
    // The two shapes the hand-rolled copies could not see, in ONE program, at TWO
    // depths. This is the DATA half of the red proof: with the recursion narrowed
    // back to `coinFlipGate.then` alone, this case names the missing ops.
    const program: EffectOp[] = [
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "gust" }],
        // 🛑 ZERO printings in the pool carry this today — which is exactly why an
        // enumerated walker could go on missing it for seven slices without a
        // single test noticing.
        otherwise: [{ op: "drawCards", count: 2 }],
      },
      {
        op: "optional",
        note: "You may.",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          { op: "switchActive" },
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          { op: "recordGate", slot: "moved", then: [{ op: "shuffleDeck" }] },
        ],
      },
    ];
    expect(walkProgram(program).map((op) => op.op)).toEqual([
      "coinFlipGate",
      "gust",
      "drawCards",
      "optional",
      "switchActive",
      "recordGate",
      "shuffleDeck",
    ]);
  });

  it("does not mistake a non-program array for a branch", () => {
    // The predicate's only real hazard: an op field that is an array of OBJECTS.
    // `attachCards`-shaped targets carry `seat`/`spot` and no `op`, so they are
    // not descended — asserted rather than assumed, because a false positive here
    // would make every sweep report phantom ops.
    const program = [
      {
        op: "healChosen",
        amount: 30,
        targets: [{ seat: "p1", spot: { spot: "active" } }],
      },
    ] as unknown as EffectOp[];
    expect(walkProgram(program).map((op) => op.op)).toEqual(["healChosen"]);
  });

  it("treats an EMPTY array as no branch at all", () => {
    // Vacuously "every element has an `op`", which is the classic every()-on-empty
    // trap. It matters for `programBranchCarriers`: an empty `otherwise` would
    // otherwise be reported as a carrier the pool does not actually exercise.
    const program = [
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "conditionGate", cond: { kind: "isActive" }, then: [], otherwise: [] },
    ] as unknown as EffectOp[];
    expect(walkProgram(program).map((op) => op.op)).toEqual(["conditionGate"]);
    expect([...programBranchCarriers(program).keys()]).toEqual([]);
  });
});

describe("the pool sweep, structurally", () => {
  it("finds MORE ops than the enumerated walk it replaces, and names where", () => {
    // The enumerated walk tailsGatedOp/vengefulPunch carried, reproduced verbatim
    // so the DIFFERENCE is measured here rather than asserted from a note.
    const enumerated = (ops: readonly EffectOp[], out: EffectOp[]): EffectOp[] => {
      for (const op of ops) {
        out.push(op);
        if (op.op === "coinFlipGate") enumerated(op.then, out);
        if (op.op === "conditionGate" || op.op === "recordGate") {
          enumerated(op.then, out);
          enumerated(op.otherwise ?? [], out);
        }
      }
      return out;
    };
    let structuralTotal = 0;
    let enumeratedTotal = 0;
    const missed: string[] = [];
    for (const { where, ops } of poolPrograms()) {
      const full = walkProgram(ops);
      const partial = enumerated(ops, []);
      structuralTotal += full.length;
      enumeratedTotal += partial.length;
      for (const op of full) if (!partial.includes(op)) missed.push(`${where} :: ${op.op}`);
    }
    // ⚠️ NOT A BARE INEQUALITY. The exact ids are pinned, because "more" would stay
    // green if the extra ops were the wrong ones.
    expect(missed.sort()).toEqual([
      // 🆕 🛑 D317 — THE FIRST ENTRY ON THIS LIST THAT IS A `coinFlipGate.otherwise`
      // MISS, AND IT IS THE GAP PROVING ITSELF. The enumerated walk reproduced
      // above descends `coinFlipGate.then` ALONE (that is the defect this file
      // exists to measure), so the `damageDefender` on the DECLINE arm of
      // `fix-bonusconsequent`'s gate is exactly the op it cannot see. For 48
      // slices this list could not contain such a row because no program in the
      // pool had the shape; now one does, and the difference the file reports is a
      // difference about the arm D269 flagged.
      "fix-bonusconsequent attack 1 bonusConsequent :: damageDefender",
      "fix-rapidvernier trigger :: moveEnergy",
      "fix-rapidvernier trigger :: recordGate",
      "fix-rapidvernier trigger :: switchActive",
      "fix-trainerops attack 10 :: opponentSwitchOut",
    ]);
    expect(structuralTotal - enumeratedTotal).toBe(missed.length);
    expect(enumeratedTotal).toBeGreaterThan(300); // the corpus is real, not empty
  });

  it("🛑 PINS THE BRANCHING OPS THE POOL ACTUALLY EXERCISES — op AND property name", () => {
    // The auditor over the negative predicate. `walkProgram` cannot notice that the
    // union grew a fifth branching op; this can, and it fails NAMING the op and the
    // key rather than by quietly sweeping less.
    const carriers = new Map<string, Set<string>>();
    for (const { ops } of poolPrograms()) {
      for (const [op, keys] of programBranchCarriers(ops)) {
        const merged = carriers.get(op) ?? new Set<string>();
        for (const key of keys) merged.add(key);
        carriers.set(op, merged);
      }
    }
    expect(
      [...carriers.entries()].map(([op, keys]) => [op, [...keys].sort()]).sort(),
    ).toEqual([
      // 🆕 🛑 **`otherwise` ARRIVES, AND THE GAP D269 FLAGGED IS CLOSED AFTER
      // FORTY-EIGHT SLICES.** This entry read `["then"]` from D269 to D316, with a
      // comment saying the gap was *"real in the TYPE and vacuous in the POOL"*.
      // D317's `fix-bonusconsequent` — Floragato's printed *"Flip a coin. If
      // heads, this attack does 30 more damage, and heal 30 damage from this
      // Pokémon."* — is the first producer: its DECLINE arm is a real printed
      // consequent (the bare base hit), not an absent branch. ⚠️ **AND IT IS
      // VISIBLE HERE ONLY BECAUSE `bonusConsequentProgram` IS EXPORTED** — see the
      // feed in `poolPrograms` above, and see `optional` below for the shape this
      // pin still cannot see.
      ["coinFlipGate", ["otherwise", "then"]],
      ["conditionGate", ["otherwise", "then"]],
      // 🆕 THE GAP THAT WAS LIVE AND UNNAMED. Four ops hide under this key today.
      // ⚠️ 🛑 **AND IT STILL READS `then` ALONE THOUGH `optional.otherwise` HAS
      // SHIPPED SINCE D316** — not because no printing produces one, but because
      // the ONE that does is assembled inline inside `attack.ts` and no sweep can
      // build it. **A carrier pin measures what the sweep can REACH, not what the
      // union has.** D317 avoided inheriting that by exporting its assembler; the
      // honest repair for this row is the same one, and it is the cheapest known
      // item on the backlog.
      ["optional", ["then"]],
      ["recordGate", ["then"]],
    ]);
  });
});
