#!/usr/bin/env bun
/**
 * Fails when a declaration in the engine's passive readers (continuous.ts and ops/) reads a
 * `passive` key without a lock filter. A filter is a call to one of LOCK_FILTERS in the same
 * top-level declaration: the §9 Ability lock, Jamming Tower's Tool filter, or a typed Special
 * Energy's holder rule. A reader that needs none is named in UNFILTERED with the reason. It reads
 * source, so a filter applied by a caller in another file is seen only through that list.
 */

import { readdirSync, readFileSync } from "node:fs";
// TypeScript 7 (the Go compiler) has no stable compiler API yet, so the parser comes from
// TypeScript 6 under its own name; port to TS 7.1's API when it is stable.
import ts from "@typescript/typescript6";
import { type Report, runReport } from "./lib/cli";
import { repoPath } from "./lib/repo";

const ROOT = "packages/engine/src";

/** The calls that keep a locked Ability, a Tool under Jamming Tower or an off-type Energy out.
    `opposedToolPassives` yields only `toolsInEffect`'s Tools. */
export const LOCK_FILTERS: ReadonlySet<string> = new Set([
  "disabledAbilityUids",
  "toolsInEffect",
  "energyRulesApply",
  "opposedToolPassives",
]);

/** Readers with no filter of their own, as `file declaration`, and why none is owed. */
export const UNFILTERED: Readonly<Record<string, string>> = {
  "continuous.ts abilityLockedUids": "it computes the Ability lock, so it cannot ask it",
  "continuous.ts foldDamageModifiers": "its caller passes sources already filtered",
  "continuous.ts foldHpBonus": "its caller passes sources already filtered",
  "continuous.ts foldRecoil": "its caller passes sources already filtered",
  "continuous.ts foldPreventions": "its caller passes sources already filtered",
  "continuous.ts foldStatuses": "its caller passes sources already filtered",
  "continuous.ts foldLicences": "its caller passes sources already filtered",
  "continuous.ts gatedBombOf": "deluxeBombOf passes it a Tool it already filtered",
  "continuous.ts toolCapNames": "it collects names off the whole registry, not a body in play",
  "ops/damage.ts spendCoinRedo": "it spends a Badge that coinRedoToolOf already filtered",
};

export type EngineSource = { path: string; text: string };

/** `x.passive`, `x?.passive` or a binding named `passive`. */
function namesPassive(node: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(node)
    ? node.name.text === "passive"
    : ts.isIdentifier(node) && node.text === "passive";
}

/** Each top-level declaration that reads `….passive.<key>`, with the keys and whether it filters. */
export function passiveReaders(
  source: EngineSource,
): { name: string; keys: string[]; filtered: boolean }[] {
  const file = ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true);
  const out: { name: string; keys: string[]; filtered: boolean }[] = [];
  for (const statement of file.statements) {
    const name = ts.isFunctionDeclaration(statement)
      ? statement.name?.text
      : ts.isVariableStatement(statement)
        ? statement.declarationList.declarations[0]?.name.getText(file)
        : undefined;
    if (name === undefined) continue;
    const keys = new Set<string>();
    let filtered = false;
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && namesPassive(node.expression)) {
        keys.add(node.name.text);
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (LOCK_FILTERS.has(node.expression.text)) filtered = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(statement);
    if (keys.size > 0) out.push({ name, keys: [...keys].sort(), filtered });
  }
  return out;
}

export function passiveLockReport(
  sources: readonly EngineSource[],
  unfiltered: Readonly<Record<string, string>> = UNFILTERED,
): Report {
  const problems: string[] = [];
  const allowed = new Set<string>();
  let readers = 0;
  for (const source of sources) {
    for (const reader of passiveReaders(source)) {
      readers++;
      const key = `${source.path} ${reader.name}`;
      if (Object.hasOwn(unfiltered, key)) {
        allowed.add(key);
        if (reader.filtered) problems.push(`  ${key}: filters now, so drop it from UNFILTERED`);
        continue;
      }
      if (!reader.filtered) {
        problems.push(`  ${key} reads passive ${reader.keys.join(", ")} with no lock filter`);
      }
    }
  }
  for (const key of Object.keys(unfiltered)) {
    if (!allowed.has(key)) problems.push(`  ${key}: in UNFILTERED but reads no passive key`);
  }
  if (problems.length > 0) {
    return {
      ok: false,
      lines: [
        "passive-lock-guard: FAIL — every passive read needs a lock filter or a named reason:",
        ...problems,
        `Call one of ${[...LOCK_FILTERS].join(", ")} in the reader, or add it to UNFILTERED in`,
        "scripts/passive-lock-guard.ts with the reason it needs none.",
      ],
    };
  }
  return {
    ok: true,
    lines: [`${readers} passive readers, ${allowed.size} unfiltered by name`],
  };
}

function engineSources(): EngineSource[] {
  const ops = readdirSync(repoPath(`${ROOT}/ops`))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => `ops/${name}`);
  return ["continuous.ts", ...ops.sort()].map((path) => ({
    path,
    text: readFileSync(repoPath(`${ROOT}/${path}`), "utf8"),
  }));
}

if (import.meta.main) runReport("passive-lock-guard", () => passiveLockReport(engineSources()));
