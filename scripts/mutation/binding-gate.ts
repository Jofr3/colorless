/**
 * Binding gate: a mutant's `replace` may only name identifiers its file binds. Vitest does not
 * type-check, so an unbound name throws a ReferenceError and reports a false kill. Checks
 * introduced names and deleted top-level declarations at top-level-statement granularity, so it is
 * a floor rather than a proof.
 *
 *   bun scripts/mutation/binding-gate.ts
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { isRecord, type Report, runReport, wiringProblems } from "../lib/cli";
import { repoPath, sourceCache } from "../lib/repo";
import { MUTANTS } from "./mutants";

/** The script that must call this gate, so the pre-sweep command reports it. */
const WIRING_SITE = "scripts/mutation/precheck.ts";
/** The exact call the wiring rung looks for in `WIRING_SITE`. */
const WIRING_CALL = "bindingReport()";

/** Cap the naming so a wholly-broken corpus prints a page, not a book. */
const MAX_NAMED = 30;

/** One top-level statement of a target file, with what it binds and reads. */
type TopStatement = {
  start: number;
  end: number;
  /** VALUE names this statement declares at top level. */
  names: string[];
  /** Names this statement reads that it does not itself declare. */
  free: Set<string>;
};

/** A parsed target file, cached per path: every row re-uses one parse. */
export type FileInfo = {
  text: string;
  kind: ts.ScriptKind;
  top: TopStatement[];
  /** Original-region scans, keyed by `lo:hi`. */
  regions: Map<string, Original>;
  /** `regionDigest` results, keyed by `lo:hi`. */
  digests: Map<string, string>;
};

/** The script kind of a target, or `null` for a non-code target (JSON, Markdown). */
function kindOf(file: string): ts.ScriptKind | null {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".ts")) return ts.ScriptKind.TS;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(m|c)?js$/.test(file)) return ts.ScriptKind.JS;
  return null;
}

function parse(text: string, kind: ts.ScriptKind): ts.SourceFile {
  return ts.createSourceFile("fragment.tsx", text, ts.ScriptTarget.Latest, false, kind);
}

function bindingNames(name: ts.BindingName, out: string[]): void {
  if (ts.isIdentifier(name)) {
    out.push(name.text);
    return;
  }
  for (const el of name.elements) if (ts.isBindingElement(el)) bindingNames(el.name, out);
}

/** The value names an import binds; type-only imports bind nothing at run time. */
function importNames(st: ts.ImportDeclaration, out: string[]): void {
  const c = st.importClause;
  if (c === undefined) return;
  const typeOnly = (spec?: { isTypeOnly: boolean }): boolean =>
    c.isTypeOnly || spec?.isTypeOnly === true;
  if (c.name !== undefined && !typeOnly()) out.push(c.name.text);
  const nb = c.namedBindings;
  if (nb === undefined) return;
  if (ts.isNamespaceImport(nb)) {
    if (!typeOnly()) out.push(nb.name.text);
    return;
  }
  for (const e of nb.elements) if (!typeOnly(e)) out.push(e.name.text);
}

/** The VALUE names a statement declares at its own top level. */
function topNames(st: ts.Statement): string[] {
  const out: string[] = [];
  if (ts.isVariableStatement(st)) {
    for (const d of st.declarationList.declarations) bindingNames(d.name, out);
  } else if (
    (ts.isFunctionDeclaration(st) ||
      ts.isClassDeclaration(st) ||
      ts.isEnumDeclaration(st) ||
      ts.isModuleDeclaration(st)) &&
    st.name !== undefined &&
    ts.isIdentifier(st.name)
  ) {
    out.push(st.name.text);
  } else if (ts.isImportDeclaration(st)) {
    importNames(st, out);
  } else if (ts.isImportEqualsDeclaration(st) && !st.isTypeOnly) {
    out.push(st.name.text);
  }
  return out;
}

/** Is this identifier the NAME a declaration introduces? */
function isDeclarationName(n: ts.Identifier, p: ts.Node): boolean {
  return (
    (ts.isVariableDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isBindingElement(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isClassDeclaration(p) ||
      ts.isClassExpression(p) ||
      ts.isEnumDeclaration(p) ||
      ts.isModuleDeclaration(p) ||
      ts.isImportEqualsDeclaration(p)) &&
    p.name === n
  );
}

/** Is this identifier in a position that is NOT a read of a binding? */
function isNonReference(n: ts.Identifier, p: ts.Node): boolean {
  return (
    (ts.isPropertyAccessExpression(p) && p.name === n) ||
    (ts.isPropertyAssignment(p) && p.name === n) ||
    ((ts.isMethodDeclaration(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isGetAccessor(p) ||
      ts.isSetAccessor(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodSignature(p) ||
      ts.isEnumMember(p)) &&
      p.name === n) ||
    (ts.isBindingElement(p) && p.propertyName === n) ||
    ((ts.isLabeledStatement(p) || ts.isBreakStatement(p) || ts.isContinueStatement(p)) &&
      p.label === n) ||
    (ts.isQualifiedName(p) && p.right === n) ||
    ts.isImportSpecifier(p) ||
    ts.isExportSpecifier(p) ||
    ts.isNamespaceExport(p) ||
    ts.isMetaProperty(p) ||
    (ts.isJsxAttribute(p) && p.name === n) ||
    ((ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) &&
      p.tagName === n &&
      /^[a-z]/.test(n.text))
  );
}

/** The value-position reads and the declared names inside one parsed region. */
type Scan = { refs: Set<string>; decls: Set<string> };

function scan(root: ts.Node): Scan {
  const refs = new Set<string>();
  const decls = new Set<string>();
  // Parents are threaded through the walk rather than set on the tree: parsing
  // without `setParentNodes` is what keeps the whole corpus near ten seconds.
  const walk = (n: ts.Node, p: ts.Node): void => {
    if (ts.isTypeNode(n) && !ts.isExpressionWithTypeArguments(n)) return;
    if (
      ts.isInterfaceDeclaration(n) ||
      ts.isTypeAliasDeclaration(n) ||
      ts.isTypeParameterDeclaration(n) ||
      ts.isExportDeclaration(n)
    )
      return;
    if (ts.isHeritageClause(n) && n.token === ts.SyntaxKind.ImplementsKeyword) return;
    if (ts.isImportDeclaration(n)) {
      const out: string[] = [];
      importNames(n, out);
      for (const name of out) decls.add(name);
      return;
    }
    if (ts.isIdentifier(n)) {
      if (isDeclarationName(n, p)) decls.add(n.text);
      else if (!isNonReference(n, p)) refs.add(n.text);
      return;
    }
    ts.forEachChild(n, (c) => walk(c, n));
  };
  walk(root, root);
  return { refs, decls };
}

/** Top-level VALUE names of a parsed region, statement by statement. */
function regionTopNames(sf: ts.SourceFile): Set<string> {
  return new Set(sf.statements.flatMap(topNames));
}

/** Build the per-file index. Exported shape for the self-check's synthetic files. */
export function fileInfoOf(file: string, text: string): FileInfo | null {
  const kind = kindOf(file);
  if (kind === null) return null;
  const sf = parse(text, kind);
  const top = sf.statements.map((st) => {
    const { refs, decls } = scan(st);
    return {
      start: st.pos,
      end: st.end,
      names: topNames(st),
      free: new Set([...refs].filter((r) => !decls.has(r))),
    };
  });
  return { text, kind, top, regions: new Map(), digests: new Map() };
}

const files = new Map<string, FileInfo | null>();
const sourceOf = sourceCache();
function fileInfo(file: string, cache: VerdictCache): FileInfo | null {
  const cached = files.get(file);
  if (cached !== undefined) return cached;
  const text = sourceOf(file);
  const kind = kindOf(file);
  const textKey = sha1(JSON.stringify([kind, text]));
  const stored = cache.storedFiles.get(textKey);
  const fi =
    stored === undefined || kind === null
      ? fileInfoOf(file, text)
      : {
          text,
          kind,
          top: stored.map(([start, end, names, free]) => ({
            start,
            end,
            names,
            free: new Set(free),
          })),
          regions: new Map(),
          digests: new Map(),
        };
  if (fi !== null) {
    cache.usedFiles.set(
      textKey,
      fi.top.map((t) => [t.start, t.end, t.names, [...t.free]]),
    );
  }
  files.set(file, fi);
  return fi;
}

/** Is `name` bound by a top-level statement OUTSIDE the region [lo, hi)? */
function boundInFile(fi: FileInfo, lo: number, hi: number, name: string): boolean {
  return fi.top.some((t) => (t.end <= lo || t.start >= hi) && t.names.includes(name));
}

/** Is `name` a run-time global? The one exemption, and it is the platform's, not a list. */
const isGlobal = (name: string): boolean => name in globalThis;

/** Names read in a scanned region that nothing binds. */
function unresolvedIn(s: Scan, fi: FileInfo, lo: number, hi: number): Set<string> {
  return new Set(
    [...s.refs].filter((r) => !s.decls.has(r) && !boundInFile(fi, lo, hi, r) && !isGlobal(r)),
  );
}

/** The ORIGINAL region's scan, cached: 654 regions serve ~2,700 rows (effects.ts's
    `deriveAttackEffect` alone carries hundreds), so it is parsed once, not per row. */
type Original = { refs: Set<string>; top: Set<string>; baseline: Set<string> };
function originalRegion(fi: FileInfo, lo: number, hi: number): Original {
  const key = `${String(lo)}:${String(hi)}`;
  const cached = fi.regions.get(key);
  if (cached !== undefined) return cached;
  const sf = parse(fi.text.slice(lo, hi), fi.kind);
  const s = scan(sf);
  const made = { refs: s.refs, top: regionTopNames(sf), baseline: unresolvedIn(s, fi, lo, hi) };
  fi.regions.set(key, made);
  return made;
}

/** One row's verdict: what it flags, and whether it introduces any identifier at all. */
export type RowVerdict = { flagged: string[]; introduces: boolean };

/** A digest of everything a verdict reads besides `find` and `replace`: the script kind, the
    region's text, and what the statements outside it bind and read. */
function regionDigest(fi: FileInfo, lo: number, hi: number): string {
  const key = `${String(lo)}:${String(hi)}`;
  const cached = fi.digests.get(key);
  if (cached !== undefined) return cached;
  const names = new Set<string>();
  const free = new Set<string>();
  for (const t of fi.top) {
    if (t.end > lo && t.start < hi) continue;
    for (const name of t.names) names.add(name);
    for (const name of t.free) free.add(name);
  }
  const digest = sha1(
    JSON.stringify([fi.kind, fi.text.slice(lo, hi), [...names].sort(), [...free].sort()]),
  );
  fi.digests.set(key, digest);
  return digest;
}

/** A target file's top-level statements as stored: start, end, names, free names. */
type StoredStatement = [number, number, string[], string[]];

/**
 * Results of earlier runs, kept under tmp/: each target file's statements, keyed by its text, and
 * each row's verdict, keyed by `regionDigest`, where `find` sits in the region, and the `replace`.
 * `stamp` ties them to this gate's own source, the TypeScript version and the runtime whose
 * globals `isGlobal` sees. A run writes back only what it used.
 */
export type VerdictCache = {
  stamp: string;
  storedFiles: Map<string, StoredStatement[]>;
  usedFiles: Map<string, StoredStatement[]>;
  stored: Map<string, RowVerdict>;
  used: Map<string, RowVerdict>;
};

const VERDICT_CACHE = repoPath("tmp/binding-gate-cache.json");

const sha1 = (text: string): string => createHash("sha1").update(text).digest("hex");

type SavedCache = {
  stamp: string;
  files: [string, StoredStatement[]][];
  verdicts: [string, RowVerdict][];
};

function isSavedCache(v: unknown): v is SavedCache {
  return (
    isRecord(v) &&
    typeof v.stamp === "string" &&
    Array.isArray(v.files) &&
    Array.isArray(v.verdicts)
  );
}

/** A cache holding the verdicts `stored`, as a run that found them under its stamp starts. */
export function verdictCacheOf(
  stamp: string,
  stored: ReadonlyMap<string, RowVerdict> = new Map(),
): VerdictCache {
  return {
    stamp,
    storedFiles: new Map(),
    usedFiles: new Map(),
    stored: new Map(stored),
    used: new Map(),
  };
}

function loadVerdictCache(): VerdictCache {
  const stamp = sha1(
    JSON.stringify([
      readFileSync(fileURLToPath(import.meta.url), "utf8"),
      ts.version,
      process.versions.bun ?? process.version,
    ]),
  );
  const cache = verdictCacheOf(stamp);
  try {
    const saved: unknown = JSON.parse(readFileSync(VERDICT_CACHE, "utf8"));
    if (isSavedCache(saved) && saved.stamp === stamp) {
      cache.storedFiles = new Map(saved.files);
      cache.stored = new Map(saved.verdicts);
    }
  } catch {
    // No cache, or an unreadable one: every row is judged afresh.
  }
  return cache;
}

function saveVerdictCache(cache: VerdictCache): void {
  const saved: SavedCache = {
    stamp: cache.stamp,
    files: [...cache.usedFiles],
    verdicts: [...cache.used],
  };
  try {
    mkdirSync(dirname(VERDICT_CACHE), { recursive: true });
    const partial = `${VERDICT_CACHE}.${String(process.pid)}`;
    writeFileSync(partial, JSON.stringify(saved));
    renameSync(partial, VERDICT_CACHE);
  } catch {
    // The cache only saves time; failing to write it costs the next run its hits.
  }
}

/**
 * The core check, shared by the self-check and the live corpus. Null when `find` does not occur
 * exactly once, which precheck reports.
 */
export function judgeRow(
  fi: FileInfo,
  find: string,
  replace: string,
  cache?: VerdictCache,
): RowVerdict | null {
  const at = fi.text.indexOf(find);
  if (at === -1 || fi.text.indexOf(find, at + 1) !== -1) return null;
  const stop = at + find.length;
  const covering = fi.top.filter((t) => t.end > at && t.start < stop);
  const lo = covering[0]?.start ?? at;
  const hi = covering.at(-1)?.end ?? stop;
  const key =
    cache === undefined
      ? ""
      : sha1(JSON.stringify([regionDigest(fi, lo, hi), at - lo, find.length, replace]));
  const hit = cache?.stored.get(key);
  if (hit !== undefined) {
    cache?.used.set(key, hit);
    return hit;
  }
  const before = originalRegion(fi, lo, hi);
  const afterSf = parse(fi.text.slice(lo, at) + replace + fi.text.slice(stop, hi), fi.kind);
  const after = scan(afterSf);

  // INTRODUCTION — unresolved after, and not already unresolved before (the baseline).
  const fresh = [...unresolvedIn(after, fi, lo, hi)].filter((r) => !before.baseline.has(r));

  // DELETION — a top-level name the region stopped declaring that another statement still reads.
  const afterTop = regionTopNames(afterSf);
  const lost = [...before.top].filter((name) => !afterTop.has(name));
  const orphaned = lost.filter(
    (name) =>
      !boundInFile(fi, lo, hi, name) &&
      fi.top.some((t) => (t.end <= lo || t.start >= hi) && t.free.has(name)),
  );

  const verdict = {
    flagged: [...fresh, ...orphaned],
    introduces: [...after.refs].some((r) => !before.refs.has(r)),
  };
  cache?.used.set(key, verdict);
  return verdict;
}

/** One synthetic case: a file, a patch, and the names it must flag (exactly). */
type Fixture = { name: string; text: string; find: string; replace: string; flags: string[] };

const FN = "export function f(a: number, b: number): number {\n  return a;\n}\n";

/**
 * Self-check on synthetic fixtures, each one difference from a correct row, so a vacuous gate fails
 * even when the corpus is clean.
 */
const FIXTURES: Fixture[] = [
  // ── POSITIVES — the gate must flag exactly these names ────────────────────
  {
    name: "an unimported call (with the name in a COMMENT of the file — D377's mask)",
    text: `// helper() is defined in another module and is not imported here.\nimport { used } from "./m";\n${FN.replace("return a;", "return used(a);")}`,
    find: "  return used(a);",
    replace: "  return helper(a);",
    flags: ["helper"],
  },
  {
    name: "a type-only import used as a value (both spellings — D242's `programFor`)",
    text: `import type { Shape } from "./t";\nimport { type Kind, live } from "./t";\n${FN.replace("return a;", "return live(a);")}`,
    find: "  return live(a);",
    replace: "  return live(Shape, Kind);",
    flags: ["Shape", "Kind"],
  },
  {
    name: "a local removed while the same statement still reads it (D237's shape)",
    text: "export function f(xs: number[]): number {\n  const moved = xs.slice(1);\n  return moved.length;\n}\n",
    find: "  const moved = xs.slice(1);",
    replace: "  xs.slice(1);",
    flags: ["moved"],
  },
  {
    name: "a top-level declaration deleted while another statement reads it (D232's shape)",
    text: "const ANCHOR = /^x$/;\nexport function f(s: string): boolean {\n  return ANCHOR.test(s);\n}\n",
    find: "const ANCHOR = /^x$/;",
    replace: "/^x$/;",
    flags: ["ANCHOR"],
  },
  // ── NEGATIVES — the gate must flag nothing ────────────────────────────────
  {
    name: "names the replace itself declares (a const, a destructured pair, a param)",
    text: FN,
    find: "  return a;",
    replace:
      "  const [c, { d }] = [a, { d: 2 }];\n  const add = (e: number): number => c + d + e;\n  return add(a);",
    flags: [],
  },
  {
    name: "a VALUE-imported name",
    text: `import { live } from "./t";\n${FN}`,
    find: "  return a;",
    replace: "  return live(a);",
    flags: [],
  },
  {
    name: "a member after `.` and after `?.`",
    text: FN,
    find: "  return a;",
    replace: "  return a.toFixed.length + (a?.toPrecision.length ?? 0);",
    flags: [],
  },
  {
    name: "an object key",
    text: FN,
    find: "  return a;",
    replace: "  return Object.keys({ brandNewKey: a }).length;",
    flags: [],
  },
  {
    name: "a name in a comment, a string, a template and a regex",
    text: FN,
    find: "  return a;",
    replace: '  // ghostA\n  return `ghostB ${"ghostC"}`.length + /ghostD/.source.length + a;',
    flags: [],
  },
  {
    name: "a type-position name",
    text: FN,
    find: "  return a;",
    replace: "  const t: GhostType = a as unknown as GhostType;\n  return t;",
    flags: [],
  },
  {
    name: "a run-time global (Number, Object, undefined)",
    text: FN,
    find: "  return a;",
    replace: "  return Number(a) + Object.keys({}).length + (undefined === undefined ? 0 : 1);",
    flags: [],
  },
  {
    name: "a name already unresolved in the original (the baseline — `expect` in a suite)",
    text: "export function f(): void {\n  expect(1).toBe(1);\n}\n",
    find: "  expect(1).toBe(1);",
    replace: "  expect(2).toBe(1);",
    flags: [],
  },
  {
    name: "a name the ENCLOSING function declares, outside the `find` span",
    text: FN,
    find: "  return a;",
    replace: "  return b;",
    flags: [],
  },
];

/** Runs every fixture and names every failure; empty means the guard can be trusted. */
export function selfCheck(): string[] {
  const failed: string[] = [];
  for (const fx of FIXTURES) {
    const fi = fileInfoOf("fixture.ts", fx.text);
    const verdict = fi === null ? null : judgeRow(fi, fx.find, fx.replace);
    const got = verdict === null ? "(no verdict)" : JSON.stringify([...verdict.flagged].sort());
    const want = JSON.stringify([...fx.flags].sort());
    if (got !== want) failed.push(`   - ${fx.name}: flagged ${got}, expected ${want}`);
  }
  if (failed.length === 0) return [];
  return [
    `binding-gate: SELF-CHECK FAILED on ${String(failed.length)} of ${String(FIXTURES.length)} fixture(s):`,
    ...failed,
    "The guard cannot be trusted about the real corpus, so its verdict means nothing.",
  ];
}

/** Asserts precheck.ts calls this gate. */
export function checkWiring(): string[] {
  return wiringProblems("binding-gate", WIRING_SITE, WIRING_CALL);
}

/** True when no row's patch names an identifier its file does not bind. */
export type BindingReport = Report;

export function bindingReport(): BindingReport {
  const problems = [...selfCheck(), ...checkWiring()];
  if (problems.length > 0) return { ok: false, lines: problems };

  const named: string[] = [];
  let code = 0;
  let nonCode = 0;
  let introducing = 0;
  let flaggedRows = 0;
  const cache = loadVerdictCache();
  for (const m of MUTANTS) {
    if (!existsSync(repoPath(m.file))) continue; // a missing target is `precheck`'s business
    const fi = fileInfo(m.file, cache);
    if (fi === null) {
      nonCode++;
      continue;
    }
    code++;
    const verdict = judgeRow(fi, m.find, m.replace, cache);
    if (verdict === null) continue;
    if (verdict.introduces) introducing++;
    if (verdict.flagged.length === 0) continue;
    flaggedRows++;
    if (named.length < MAX_NAMED) {
      named.push(`   ${m.id}  [${m.file}] → ${verdict.flagged.join(", ")}`);
    }
  }
  saveVerdictCache(cache);

  if (flaggedRows === 0) {
    return {
      ok: true,
      lines: [
        `every one of ${String(introducing)} row(s) whose patch brings a name new to its statement names only what its file binds (${String(code)} code row(s), ${String(nonCode)} non-code skipped)`,
      ],
    };
  }
  const more =
    flaggedRows > named.length
      ? [`   … and ${String(flaggedRows - named.length)} more row(s).`]
      : [];
  return {
    ok: false,
    lines: [
      `\n🛑 binding-gate: FLAGGED ${String(flaggedRows)} ROW(S) — each patch names an identifier its file does not bind.`,
      "   Such a row is killed by a ReferenceError the first time the suite reaches it,",
      "   never by an assertion — and the verdict column cannot tell the two apart.",
      "   This is D532's D445: KILLED for 87 decisions by a missing import.",
      "",
      ...named,
      ...more,
      "",
      "   Fix by re-spelling the `replace` with names its file already imports or",
      "   defines (D533), NOT by adding an import to the target for the mutant's sake.",
      "",
    ],
  };
}

if (import.meta.main) runReport("binding-gate", bindingReport, { timed: true });
