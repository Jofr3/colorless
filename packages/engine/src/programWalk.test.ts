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
import {
  FIXTURE_POOL,
  programBranchCarriers,
  walkProgram,
  programmedCardIds,
} from "./testFixtures";

function poolPrograms(): { where: string; ops: readonly EffectOp[] }[] {
  const out: { where: string; ops: readonly EffectOp[] }[] = [];
  for (const [id, card] of Object.entries(FIXTURE_POOL)) {
    for (const [index, attack] of (card.attacks ?? []).entries()) {
      const derived = attack.effect === undefined ? null : deriveAttackEffect(attack.effect);
      if (derived !== null) out.push({ where: `${id} attack ${index}`, ops: derived });
      const coin = attack.effect === undefined ? null : deriveAttackCoinFlip(attack.effect);
      if (coin !== null && coin.kind === "programPerHeads") {
        out.push({ where: `${id} attack ${index} perHeads`, ops: coin.ops });
      }
      const bonus = attack.effect === undefined ? null : deriveAttackBonusConsequent(attack.effect);
      if (bonus !== null) {
        out.push({
          where: `${id} attack ${index} bonusConsequent`,
          ops: bonusConsequentProgram(bonus, parseAttackDamage(attack.damage).base),
        });
      }
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
  for (const id of programmedCardIds()) {
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
      { op: "coinFlipGate", ops: [{ op: "gust" }] },
    ];
    expect(walkProgram(program).map((op) => op.op)).toEqual(["drawCards", "coinFlipGate", "gust"]);
  });

  it("DESCENDS THE BRANCHES FOUR ENUMERATED WALKERS MISSED — `otherwise` AND `optional.then`", () => {
    // The two shapes the hand-rolled copies could not see, in ONE program, at TWO
    // depths. This is the DATA half of the red proof: with the recursion narrowed
    // back to `coinFlipGate.then` alone, this case names the missing ops.
    const program: EffectOp[] = [
      {
        op: "coinFlipGate",
        ops: [{ op: "gust" }],
        otherwise: [{ op: "drawCards", count: 2 }],
      },
      {
        op: "optional",
        note: "You may.",
        ops: [
          { op: "switchActive" },
          { op: "recordGate", slot: "moved", ops: [{ op: "shuffleDeck" }] },
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
      { op: "conditionGate", cond: { kind: "isActive" }, ops: [], otherwise: [] },
    ] as unknown as EffectOp[];
    expect(walkProgram(program).map((op) => op.op)).toEqual(["conditionGate"]);
    expect([...programBranchCarriers(program).keys()]).toEqual([]);
  });
});

describe("the pool sweep, structurally", () => {
  it("finds MORE ops than the enumerated walk it replaces, and names where", () => {
    const enumerated = (ops: readonly EffectOp[], out: EffectOp[]): EffectOp[] => {
      for (const op of ops) {
        out.push(op);
        if (op.op === "coinFlipGate") enumerated(op.ops, out);
        if (op.op === "conditionGate" || op.op === "recordGate") {
          enumerated(op.ops, out);
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
    expect(missed.sort()).toEqual([
      "30th-073 authored attack 0 :: returnSelf",
      "30th-136 authored attack 0 :: returnSelf",
      "fix-bitingspree authored attack 0 :: returnSelf",
      "fix-bonusconsequent attack 1 bonusConsequent :: damageDefender",
      "fix-crushpress attack 0 optionalCostBoost :: damageDefender",
      "fix-crushpress attack 0 optionalCostBoost :: damageDefender",
      "fix-crushpress attack 0 optionalCostBoost :: discardStadium",
      "fix-drasna trainer :: handRefresh",
      "fix-harlequin trainer :: handRefresh",
      "fix-knockover attack 0 :: discardStadium",
      "fix-optionalboost attack 1 optionalBoost :: damageDefender",
      "fix-optionalboost attack 1 optionalBoost :: damageDefender",
      "fix-optionalboost attack 1 optionalBoost :: damageSelf",
      "fix-picnicker trainer :: drawCards",
      "fix-purging attack 0 optionalCostBoost :: damageDefender",
      "fix-purging attack 0 optionalCostBoost :: damageDefender",
      "fix-purging attack 0 optionalCostBoost :: discardHand",
      "fix-rapidvernier trigger :: moveEnergy",
      "fix-rapidvernier trigger :: recordGate",
      "fix-rapidvernier trigger :: switchActive",
      "fix-torrent attack 0 optionalCostBoost :: damageChosen",
      "fix-torrent attack 0 optionalCostBoost :: discardEnergy",
      "fix-torrent attack 0 optionalCostBoost :: shuffleDeck",
      "fix-trainerops attack 10 :: opponentSwitchOut",
      "fix-trainerops attack 7 :: switchActive",
      "me01-055 trigger :: drawCards",
      "me01-056 trigger :: drawCards",
      "me01-120 trainer :: drawCards",
      "me01-120 trainer :: eachPlayerTakesPrize",
      "me01-170 trainer :: drawCards",
      "me01-170 trainer :: eachPlayerTakesPrize",
      "me01-185 trainer :: drawCards",
      "me01-185 trainer :: eachPlayerTakesPrize",
      "me02-047 trigger :: applyStatus",
      "me02-053 trigger :: discardDeckTop",
      "me02-053 trigger :: discardDeckTop",
      "me02-086 trainer :: discardEnergy",
      "me02-086 trainer :: discardStadium",
      "me02-086 trainer :: discardTools",
      "me02-101 trigger :: discardDeckTop",
      "me02-101 trigger :: discardDeckTop",
      "me02-117 trainer :: discardEnergy",
      "me02-117 trainer :: discardStadium",
      "me02-117 trainer :: discardTools",
      "me02.5-205 trainer :: searchDeck",
      "me03-062 trigger :: searchDeck",
      "me03-062 trigger :: shuffleDeck",
      "me03-107 trigger :: searchDeck",
      "me03-107 trigger :: shuffleDeck",
      "me03-121 trigger :: searchDeck",
      "me03-121 trigger :: shuffleDeck",
      "mep-003 trigger :: drawCards",
      "mep-009 trigger :: drawCards",
      "mep-016 trigger :: discardDeckTop",
      "mep-016 trigger :: discardDeckTop",
      "sv05-015 trigger :: heal",
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
      "sv06-154 trainer :: boostSideAttacksThisTurn",
      "sv06-154 trainer :: switchActive",
      "sv06-206 trainer :: boostSideAttacksThisTurn",
      "sv06-206 trainer :: switchActive",
      "sv06-218 trainer :: boostSideAttacksThisTurn",
      "sv06-218 trainer :: switchActive",
      "sv06.5-021 attack 1 optionalCostBoost :: damageDefender",
      "sv06.5-021 attack 1 optionalCostBoost :: damageDefender",
      "sv06.5-021 attack 1 optionalCostBoost :: turnPrizeFaceUp",
      "sv07-006 Selective Slime :: applyStatus",
      "sv07-006 Selective Slime :: applyStatus",
      "sv07-006 Selective Slime :: applyStatus",
      "sv07-006 Selective Slime :: optional",
      "sv07-067 trigger :: healEach",
      "sv07-160 trigger :: healEach",
      "sv07-169 trigger :: healEach",
      "sv08-056 trigger :: discardStadium",
      "sv08-131 authored attack 1 :: returnSelf",
      "sv08-171 trainer :: bottomDeckTop",
      "sv08-173 trainer :: handRefresh",
      "sv08-231 trainer :: handRefresh",
      "sv08.5-008 trigger :: heal",
      "sv08.5-113 trainer :: boostSideAttacksThisTurn",
      "sv08.5-113 trainer :: switchActive",
      "sv08.5-174 trainer :: boostSideAttacksThisTurn",
      "sv08.5-174 trainer :: switchActive",
      "sv08.5-176 trigger :: moveEnergy",
      "sv08.5-176 trigger :: recordGate",
      "sv08.5-176 trigger :: switchActive",
      "sv10-122 authored attack 0 :: returnSelf",
      "sv10-172 trainer :: swapTurnedPrizeWithRevealed",
      "sv10-175 trainer :: searchDeck",
      "sv10-179 trainer :: damageSelf",
      "sv10-217 authored attack 0 :: returnSelf",
      "sv10-234 authored attack 0 :: returnSelf",
      "sv10-242 authored attack 0 :: returnSelf",
      "sv10.5w-083 trainer :: handRefresh",
      "sv10.5w-163 trainer :: handRefresh",
      "svp-114 trainer :: drawCards",
      "svp-128 trigger :: moveEnergy",
      "svp-128 trigger :: recordGate",
      "svp-128 trigger :: switchActive",
      "svp-152 trigger :: discardStadium",
    ]);
    expect(structuralTotal - enumeratedTotal).toBe(missed.length);
    expect(enumeratedTotal).toBeGreaterThan(900);
  });

  it("PINS THE BRANCHING OPS THE POOL ACTUALLY EXERCISES — op AND property name", () => {
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
      ["chooseOneOffered", ["branches"]],
      ["coinFlipGate", ["ops", "otherwise"]],
      ["conditionGate", ["ops", "otherwise"]],
      ["optional", ["ops", "otherwise"]],
      ["recordGate", ["ops"]],
      ["reorderTop", ["otherwise"]],
    ]);
  });
});
