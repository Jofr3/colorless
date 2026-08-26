import { describe, expect, it } from "vitest";
import { parseAttackDamage } from "./cards";
import {
  bonusConsequentProgram,
  deriveAttackBonusConsequent,
  deriveAttackCoinFlip,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  discardScaledBoostProgram,
  optionalBoostProgram,
  optionalCostBoostProgram,
} from "./effects";
import type { EffectOp } from "./effects";
import { programFor } from "./index";
import { registryCardIds } from "./registry";
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

/** Every program an auditor can be handed, as (where, ops) pairs — the union of
    the two ATTACK sources, the abilities, the triggers and the trainer seam.
    Hoisted so the cases below sweep the SAME corpus rather than each choosing.

    🆕🛑 **D342 — THE AUTHORED HALF IS SWEPT OFF `registryCardIds()`, NOT OFF
    `FIXTURE_POOL`, AND THAT IS A REPAIR OF THE BUG D341 NAMED ONE FILE OVER.**
    This function used to run ONE loop over `Object.entries(FIXTURE_POOL)` and ask
    `programFor(id)` inside it — so the registry half of the corpus was silently
    intersected with the fixture pool, and **every authored program whose card is
    not a fixture was invisible to both auditors below.** That is exactly
    `preventBlock`'s §11 defect (D341: *"an auditor that sweeps a fixture pool is
    auditing the pool, not the code"*), found at the site D341's resume point
    named as the suspect, and it was a REAL loss rather than a theoretical one:
    at this head the registry carries 675 keys and the pool a fraction of them,
    so the carrier pin below was claiming totality over a sample.

    🛑 **AND THE TWO HALVES ARE SCOPED DIFFERENTLY ON PURPOSE, WHICH IS THE WHOLE
    POINT.** The DERIVED half genuinely needs printed card text, so it still runs
    over the pool — a limit this file states rather than hides. The AUTHORED half
    needs **no card text at all**: `programFor` takes an id and returns a program,
    so there was never a reason for it to be pool-scoped, and the intersection was
    an accident of the two halves sharing one loop. **WHEN AN AUDITOR'S POPULATION
    IS AN INTERSECTION, CHECK WHETHER EITHER SIDE WAS EVER REQUIRED.** */
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
      const bonus = attack.effect === undefined ? null : deriveAttackBonusConsequent(attack.effect);
      if (bonus !== null) {
        out.push({
          where: `${id} attack ${index} bonusConsequent`,
          ops: bonusConsequentProgram(bonus, parseAttackDamage(attack.damage).base),
        });
      }
      // 🆕 D318 — THE THIRD, AND IT IS THE ONE THE COMMENT ABOVE SAID COULD NOT BE
      // FED IN. D316's `optional` was assembled inline inside `attack.ts`, so no
      // sweep could build it and the carrier pin below reported `["optional",
      // ["then"]]` on an op that had carried two arms for two slices. D318 moved
      // the assembly into `effects.ts` for exactly this line — and added
      // `fix-optionalboost` to `FIXTURE_POOL`, because an exported assembler with
      // nothing in the pool to call it on is a repair that changes no answer.
      const boost = attack.effect === undefined ? null : deriveAttackOptionalBoost(attack.effect);
      if (boost !== null) {
        out.push({
          where: `${id} attack ${index} optionalBoost`,
          ops: optionalBoostProgram(
            boost,
            parseAttackDamage(attack.damage).base,
            attack.effect ?? "",
          ),
        });
      }
      // 🆕🆕 D381 — THE FOURTH, FED IN FROM THE SLICE THAT BUILT IT RATHER THAN TWO
      // SLICES LATER. `deriveAttackOptionalCostBoost` is D316's sentence with its two
      // halves swapped, and its assembler was exported on its first line for exactly
      // the reason the three feeds above record: a program a sweep cannot BUILD is a
      // program the sweep cannot audit. `fix-crushpress` (Cetitan ex's printed
      // "Crushing Press") is the pool card it is called on — the other half, without
      // which the export changes no answer here.
      const costBoost =
        attack.effect === undefined ? null : deriveAttackOptionalCostBoost(attack.effect);
      if (costBoost !== null) {
        out.push({
          where: `${id} attack ${index} optionalCostBoost`,
          ops: optionalCostBoostProgram(
            costBoost,
            parseAttackDamage(attack.damage).base,
            attack.effect ?? "",
          ),
        });
      }
      // 🆕🆕 D403 — THE FIFTH, and the first whose reading carries NO gate at all.
      // `deriveAttackDiscardScaledBoost` returns a ceiling, a filter and a per-card
      // amount; the printed BASE it folds into the hit lives on the card, so the
      // assembler is exported on its first line for the reason the four feeds above
      // record. `fix-benchboost` and `fix-benchbasicboost` are the pool cards it is
      // called on — the other half, without which the export changes no answer here.
      const discardBoost =
        attack.effect === undefined ? null : deriveAttackDiscardScaledBoost(attack.effect);
      if (discardBoost !== null) {
        out.push({
          where: `${id} attack ${index} discardScaledBoost`,
          ops: discardScaledBoostProgram(discardBoost, parseAttackDamage(attack.damage).base),
        });
      }
    }
  }
  // 🆕 D342 — THE AUTHORED HALF, OVER THE WHOLE REGISTRY. `registryCardIds()` is
  // the authoritative domain of authored programs and needs no pool at all; a
  // `fix-*` key and a real catalog id are swept identically, because `programFor`
  // cannot tell them apart and neither should this.
  for (const id of registryCardIds()) {
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
    if (authored?.trainer !== undefined)
      out.push({ where: `${id} trainer`, ops: authored.trainer });
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
      // 🆕🛑🛑 **D342 — THIRTY-TWO ROWS ARRIVE AT ONCE, AND NOT ONE OF THEM IS A NEW
      // PROGRAM. THEY ARE THE PROGRAMS THIS AUDITOR COULD NOT SEE.** Until this
      // slice the authored half of `poolPrograms` was swept off `FIXTURE_POOL` and
      // asked `programFor(id)` inside that loop, so the corpus was the registry
      // INTERSECTED WITH THE POOL and every authored program whose card is not a
      // fixture was invisible. Sweeping `registryCardIds()` instead — which needs
      // no card text and never did — quadruples the pin.
      //
      // 🛑 **THE EIGHT ROWS ABOVE ARE ALL `fix-*` AND ALL THIRTY-TWO OF THESE ARE
      // NOT, WHICH IS THE SHAPE OF THE DEFECT IN ONE LINE.** The pin recorded only
      // the demonstrators someone had deliberately added to the pool; the REAL
      // catalog programs carrying the same invisible branches — every
      // `switchActive`/`recordGate`/`moveEnergy` trigger, every `returnSelf` under
      // an authored attack, every `handRefresh`/`drawCards` under a trainer —
      // reported nothing for as long as this file has existed. **AN AUDITOR THAT
      // ONLY EVER SEES DEMONSTRATORS WILL ALWAYS LOOK HEALTHY.**
      //
      // ⚠️ AND FOUR OF THEM ARE `fix-*` KEYS THAT ARE *NOT* IN THE POOL
      // (`fix-bitingspree`, `fix-drasna`, `fix-harlequin`, `fix-picnicker`) — so
      // the old population was not even "the demonstrators", it was "the
      // demonstrators that happen to have a pool card". A registry key and a pool
      // card are two different populations and this loop conflated them.
      //
      // This is D341's finding at `preventBlock` §11, repaired at the site D341's
      // resume point named as the suspect, and it was the LIVE one rather than the
      // theoretical one.
      "fix-bitingspree authored attack 0 :: returnSelf",
      "fix-bonusconsequent attack 1 bonusConsequent :: damageDefender",
      // 🆕🆕 **D381 — THREE ROWS FROM ONE PROGRAM, AND THIS FILE IS WHAT DECIDED THE
      // ASSEMBLER'S SHAPE.** `fix-crushpress`'s derived program is
      // `conditionGate → optional → [discardStadium, damageDefender(280)]` with a
      // `damageDefender(140)` decline arm on EACH gate. The enumerated walk descends
      // `conditionGate.then`/`.otherwise` and stops — it knows four op NAMES and
      // `optional` is not one of them — so everything inside the confirm is invisible
      // to it: the cost, the boosted hit and the confirm's own decline.
      // ⚠️ **THE FIRST DRAFT HANDED ONE ARRAY TO BOTH GATES AND THIS ROW WAS *TWO*,
      // WITH `structural - enumerated` ONE HIGHER THAN `missed.length`.** This list is
      // built by object IDENTITY, so a shared arm is "already seen" down the outer
      // path and the invariant below fails by exactly one. **A PROGRAM THAT SHARES A
      // BRANCH IS A DAG, AND EVERY AUDITOR HERE ASSUMES A TREE** — so the assembler
      // builds the two arms separately and says why.
      "fix-crushpress attack 0 optionalCostBoost :: damageDefender",
      "fix-crushpress attack 0 optionalCostBoost :: damageDefender",
      "fix-crushpress attack 0 optionalCostBoost :: discardStadium",
      "fix-drasna trainer :: handRefresh",
      "fix-harlequin trainer :: handRefresh",
      // 🆕🛑 **D380 — THE FIRST `optional.then` MISS ON THIS LIST, AND IT ARRIVES
      // NESTED TWO GATES DEEP.** `fix-knockover`'s derived program is
      // `conditionGate → optional → discardStadium` (the printed *"You may discard a
      // Stadium in play."*), and the enumerated walk reproduced above descends
      // neither branch — so the op inside is exactly what it cannot see. Every
      // earlier `optional` in the pool wrapped an op the walk reached by another
      // route; this one does not, which is why the row is new rather than a
      // duplicate.
      "fix-knockover attack 0 :: discardStadium",
      "fix-optionalboost attack 1 optionalBoost :: damageDefender",
      "fix-optionalboost attack 1 optionalBoost :: damageDefender",
      "fix-optionalboost attack 1 optionalBoost :: damageSelf",
      "fix-picnicker trainer :: drawCards",
      // 🆕🆕 **D385 — THREE ROWS FROM ONE FIXTURE, AND THEY ARE `fix-crushpress`'s ARM
      // REACHED THROUGH A DIFFERENT CONNECTIVE.** `fix-purging` (Veluza ex's printed
      // "Purging Strike") assembles through `optionalCostBoostProgram`'s `moreDamage`
      // half — the same branch `fix-crushpress` reaches — so this is NOT a new arm and
      // D318's rule is not what puts it here. What puts it here is the OP: `discardHand`
      // has been an `EffectOp` since Professor's Research and has only ever appeared in
      // a `trainer` program, which is a FLAT list the enumerated walk can see. This is
      // the first time it sits inside an `optional.then` NESTED IN a `conditionGate.then`,
      // and the two `damageDefender` rows are the boosted hit and the decline arm that
      // `costSnipeProgram`'s printings do not have.
      "fix-purging attack 0 optionalCostBoost :: damageDefender",
      "fix-purging attack 0 optionalCostBoost :: damageDefender",
      "fix-purging attack 0 optionalCostBoost :: discardHand",
      "fix-rapidvernier trigger :: moveEnergy",
      "fix-rapidvernier trigger :: recordGate",
      "fix-rapidvernier trigger :: switchActive",
      // 🆕🆕 **D383 — THREE ROWS FROM ONE FIXTURE, AND THEY ARE THE SECOND ARM OF
      // `optionalCostBoostProgram`.** `fix-torrent` (Wellspring Mask Ogerpon ex's
      // printed "Torrential Pump") assembles through `costSnipeProgram`, whose whole
      // payload sits inside an `optional.then` NESTED IN a `conditionGate.then` — the
      // branch the enumerated walk reproduced above cannot descend. **THE POOL COULD
      // NOT REACH THIS ARM AT ALL BEFORE THE FIXTURE**, which is D318's rule paid a
      // third time: `fix-crushpress` prints the OTHER payoff and exercises the other
      // half of the same exported assembler.
      "fix-torrent attack 0 optionalCostBoost :: damageChosen",
      "fix-torrent attack 0 optionalCostBoost :: discardEnergy",
      "fix-torrent attack 0 optionalCostBoost :: shuffleDeck",
      "fix-trainerops attack 10 :: opponentSwitchOut",
      // 🆕🆕 **D422 — THE SECOND `optional.then` ROW OFF THIS FIXTURE, AND THE FIRST
      // WHOSE INNER OP IS THE ATTACKER'S OWN SWITCH.** Index 7 prints *"You may switch
      // this Pokémon with 1 of your Benched Pokémon."* and derives to
      // `optional → switchActive` — so the `switchActive` sits one level down a branch
      // the enumerated walk reproduced above does not descend, exactly as index 10's
      // `opponentSwitchOut` does. ⚠️ **THE ROW APPEARED WITHOUT A FIXTURE BEING ADDED**,
      // which is the shape worth noting: index 7 has been on `fix-trainerops` since
      // D189, fielded on purpose as the witness for an UNREAD sentence, and it walked to
      // ZERO ops for as long as it stayed unread. Building the arm moved this list by
      // one with no change to the pool — so a sweep keyed on "which fixtures exist" would
      // have seen nothing, and only a sweep keyed on what the READERS return catches it.
      "fix-trainerops attack 7 :: switchActive",
      "sv05-025 trigger :: moveEnergy",
      "sv05-025 trigger :: recordGate",
      "sv05-025 trigger :: switchActive",
      "sv05-186 trigger :: moveEnergy",
      "sv05-186 trigger :: recordGate",
      "sv05-186 trigger :: switchActive",
      "sv05-203 trigger :: moveEnergy",
      "sv05-203 trigger :: recordGate",
      "sv05-203 trigger :: switchActive",
      "sv05-213 trigger :: moveEnergy",
      "sv05-213 trigger :: recordGate",
      "sv05-213 trigger :: switchActive",
      "sv08-131 authored attack 1 :: returnSelf",
      // 🆕🛑 **D344 — THE FIRST ROW ON THIS LIST WHOSE CARRIER IS NOT A GATE.**
      // Deduction Kit's `reorderTop { otherwise: [bottomDeckTop] }` is a printed
      // `or` rather than a condition, and the enumerated walk reproduced above
      // knows four op NAMES — so it misses this arm for the reason it misses
      // every other one here: **an enumerated list of gates is the wrong shape,
      // and it fails in the flattering direction.** The structural predicate
      // needed no edit at all to see it, which is the whole claim this file makes
      // about the negative predicate, tested for the first time by an op the
      // predicate's author never imagined.
      "sv08-171 trainer :: bottomDeckTop",
      "sv08-173 trainer :: handRefresh",
      "sv08-231 trainer :: handRefresh",
      "sv08.5-176 trigger :: moveEnergy",
      "sv08.5-176 trigger :: recordGate",
      "sv08.5-176 trigger :: switchActive",
      "sv10-122 authored attack 0 :: returnSelf",
      "sv10-217 authored attack 0 :: returnSelf",
      "sv10-234 authored attack 0 :: returnSelf",
      "sv10-242 authored attack 0 :: returnSelf",
      "sv10.5w-083 trainer :: handRefresh",
      "sv10.5w-163 trainer :: handRefresh",
      "svp-114 trainer :: drawCards",
      "svp-128 trigger :: moveEnergy",
      "svp-128 trigger :: recordGate",
      "svp-128 trigger :: switchActive",
    ]);
    expect(structuralTotal - enumeratedTotal).toBe(missed.length);
    // 🆕 D342 — raised 300 -> 900 with the population repair, and the gap between
    // the two numbers is the measurement: the enumerated walk now reaches **979**
    // ops where the pool-scoped corpus gave it a few hundred (this file's own
    // opening paragraph records the structural walk finding **402** when it was
    // written). The old bound was chosen against a SAMPLE, so leaving it there
    // would let the corpus collapse back to a quarter of the registry and still
    // pass — which is the same defect one rung down from the one just repaired.
    expect(enumeratedTotal).toBeGreaterThan(900); // the corpus is the REGISTRY, not a sample
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
    expect([...carriers.entries()].map(([op, keys]) => [op, [...keys].sort()]).sort()).toEqual([
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
      // 🆕 THE GAP THAT WAS LIVE AND UNNAMED. Four ops hid under this key at D276.
      // 🛑 **AND `otherwise` ARRIVES AT D318, TWO SLICES AFTER THE OP GREW IT.**
      // This row read `["then"]` from D276 to D317 — including for the two slices
      // in which `optional.otherwise` was real, shipped and running on five printed
      // cards — because the ONE producer was assembled INLINE inside `attack.ts`
      // and no sweep could build it. **A CARRIER PIN MEASURES WHAT THE SWEEP CAN
      // REACH, NOT WHAT THE UNION HAS**, and the repair was never a better test:
      // D318 moved the assembly into `effects.ts` (`optionalBoostProgram`) and put
      // `fix-optionalboost` in the pool to call it on. Either half alone leaves
      // this row exactly where it was, green.
      ["optional", ["otherwise", "then"]],
      ["recordGate", ["then"]],
      // 🆕🆕 **D344 — THE FIFTH BRANCHING OP, AND THE FIRST THAT IS NOT A GATE.**
      // The four rows above all splice on a CONDITION — a coin, the board, an
      // earlier op's record, a yes/no. `reorderTop.otherwise` splices on the
      // printed `or` of Deduction Kit `sv08-171`, whose two arms are both things
      // the card DOES; the answer that picks between them is the empty ordering.
      // **THIS ROW IS THE PIN DOING EXACTLY WHAT ITS OWN COMMENT PROMISES**: the
      // header says `walkProgram` *"cannot notice that the union grew a fifth
      // branching op; this can"*, and this is the first slice in which the union
      // actually did. It went red naming the op and the key, before the suite
      // that drives the card existed.
      //
      // ⚠️ NO `then` KEY, and the absence is printed rather than incidental: the
      // ordering arm is the op's OWN behaviour and not a sub-program, so there is
      // nothing to enumerate on that side. This is the only entry here that
      // carries one key, and the day a second `EffectOp[]` field lands on this op
      // is the day that changes.
      ["reorderTop", ["otherwise"]],
    ]);
  });
});
