import type { EffectOp } from "../effects";

export function walkProgram(ops: readonly EffectOp[]): EffectOp[] {
  const out: EffectOp[] = [];
  const visit = (list: readonly EffectOp[]): void => {
    for (const op of list) {
      out.push(op);
      for (const nested of subPrograms(op)) visit(nested);
    }
  };
  visit(ops);
  return out;
}

function subPrograms(op: EffectOp): EffectOp[][] {
  const found: EffectOp[][] = [];
  for (const value of Object.values(op as unknown as Record<string, unknown>)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    const every = value.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        typeof (entry as { op?: unknown }).op === "string",
    );
    if (every) found.push(value as EffectOp[]);
  }
  return found;
}

export function programBranchCarriers(ops: readonly EffectOp[]): Map<string, Set<string>> {
  const carriers = new Map<string, Set<string>>();
  for (const op of walkProgram(ops)) {
    for (const [key, value] of Object.entries(op as unknown as Record<string, unknown>)) {
      if (subPrograms(op).includes(value as EffectOp[])) {
        const keys = carriers.get(op.op) ?? new Set<string>();
        keys.add(key);
        carriers.set(op.op, keys);
      }
    }
  }
  return carriers;
}
