import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import {
  bonusConsequentProgram,
  deriveAttackBonusConsequent,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  discardScaledBoostProgram,
  optionalBoostProgram,
  optionalCostBoostProgram,
  ATTACK_READERS,
} from "./effects";
import { ENGINE_ONLY_OPS, ENGINE_WRITTEN_FIELDS, type EffectOp } from "./effectTypes";
import { programFor, registryCardIds } from "./registry";

// The engine stores answers on the ops it parks and builds a few ops of its own. Authored and
// derived programs must never carry either, or a program would start out already answered.

const FIELDS: Partial<Record<EffectOp["op"], readonly string[]>> = ENGINE_WRITTEN_FIELDS;
const ENGINE_ONLY: ReadonlySet<string> = new Set(ENGINE_ONLY_OPS);

/** Every op-shaped object anywhere inside `value`. */
function opsIn(value: unknown, out: EffectOp[] = []): EffectOp[] {
  if (Array.isArray(value)) {
    for (const entry of value) opsIn(entry, out);
  } else if (value !== null && typeof value === "object") {
    if (typeof (value as { op?: unknown }).op === "string") out.push(value as EffectOp);
    for (const entry of Object.values(value)) opsIn(entry, out);
  }
  return out;
}

function violations(where: string, value: unknown): string[] {
  const found: string[] = [];
  for (const op of opsIn(value)) {
    if (ENGINE_ONLY.has(op.op)) found.push(`${where}: ${op.op}`);
    for (const field of FIELDS[op.op] ?? []) {
      if (Object.hasOwn(op, field)) found.push(`${where}: ${op.op}.${field}`);
    }
  }
  return found;
}

/** The audited op names the walk reaches, so a walk that sees nothing cannot pass. */
function auditedOpsIn(value: unknown): string[] {
  return [...new Set(opsIn(value).map((op) => op.op))].filter(
    (name) => FIELDS[name as EffectOp["op"]],
  );
}

const READERS = ATTACK_READERS.map(({ read }) => read);

/** Every program the deriver builds for one printed sentence, its boost builders included. */
function derivedFor(text: string): unknown[] {
  const out: unknown[] = READERS.map((read) => read(text));
  const base = 10;
  const bonus = deriveAttackBonusConsequent(text);
  if (bonus !== null) out.push(bonusConsequentProgram(bonus, base));
  const boost = deriveAttackOptionalBoost(text);
  if (boost !== null) out.push(optionalBoostProgram(boost, base, text));
  const costBoost = deriveAttackOptionalCostBoost(text);
  if (costBoost !== null) out.push(optionalCostBoostProgram(costBoost, base, text));
  const discardBoost = deriveAttackDiscardScaledBoost(text);
  if (discardBoost !== null) out.push(discardScaledBoostProgram(discardBoost, base));
  return out;
}

describe("authored and derived programs carry no engine-written state", () => {
  it("no authored program carries an engine-written field or an engine-only op", () => {
    const ids = registryCardIds();
    expect(auditedOpsIn(ids.map((id) => programFor(id)))).toContain("coinFlipGate");
    expect(ids.flatMap((id) => violations(id, programFor(id)))).toEqual([]);
  });

  it("no program derived from the census corpus carries one either", () => {
    const sentences = [...legalAttackCorpus(), ...meAttackCorpus()].map(([, text]) => text);
    const derived = sentences.map((text) => [text, derivedFor(text)] as const);
    expect(auditedOpsIn(derived.map(([, programs]) => programs))).toContain("coinFlipGate");
    expect(derived.flatMap(([text, programs]) => violations(text, programs))).toEqual([]);
  });

  it("flags an answered field, an engine-only op, and either one nested in a branch", () => {
    expect(violations("x", [{ op: "lookAtPrize", side: "opponent", index: 2 }])).toEqual([
      "x: lookAtPrize.index",
    ]);
    expect(violations("x", [{ op: "lookAtPrize", side: "opponent" }])).toEqual([]);
    expect(
      violations("x", {
        attack: {
          0: [
            {
              op: "coinFlipGate",
              ops: [{ op: "drawCards", count: 1 }],
              otherwise: [{ op: "trimBench" }, { op: "moveCountersChosen", fromBench: 0 }],
            },
          ],
        },
      }),
    ).toEqual(["x: trimBench", "x: moveCountersChosen.fromBench"]);
  });
});
