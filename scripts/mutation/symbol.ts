// The declaration a mutant's `find` sits in, recorded on the row so reanchor.ts
// can refuse to move it onto an identical fragment in some other function.

// TypeScript 7 (the Go compiler) has no stable compiler API yet, so the parser comes from
// TypeScript 6 under its own name; port to TS 7.1's API when it is stable (DEP-P5).
import ts from "@typescript/typescript6";

const parsed = new Map<string, { text: string; sf: ts.SourceFile }>();

function parse(file: string, text: string): ts.SourceFile {
  const hit = parsed.get(file);
  if (hit?.text === text) return hit.sf;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  parsed.set(file, { text, sf });
  return sf;
}

function nameOf(node: ts.Node): string | undefined {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)) &&
    node.name !== undefined
  )
    return node.name.text;
  if (ts.isVariableStatement(node)) {
    const [decl, ...rest] = node.declarationList.declarations;
    if (decl !== undefined && rest.length === 0 && ts.isIdentifier(decl.name))
      return decl.name.text;
  }
  return undefined;
}

function propertyKey(node: ts.ObjectLiteralElementLike): string | undefined {
  const name = node.name;
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  return undefined;
}

/** The top-level declaration holding [start, end), plus the top-level property
    when the declaration is an object literal (so each REGISTRY entry is its own
    symbol). Undefined for non-TypeScript files and for spans outside, or across,
    one declaration. */
export function enclosingSymbol(
  file: string,
  text: string,
  start: number,
  end: number,
): string | undefined {
  if (!/\.(ts|tsx|mts|js|mjs)$/.test(file)) return undefined;
  const sf = parse(file, text);
  // Statements, like an object literal's properties, are in source order and do not overlap, so
  // only the first one ending at or after `end` can hold the span.
  const holder = <T extends ts.Node>(nodes: readonly T[]): T | undefined => {
    let lo = 0;
    let hi = nodes.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((nodes[mid] as T).getEnd() < end) lo = mid + 1;
      else hi = mid;
    }
    const node = nodes[lo];
    return node !== undefined && node.getStart(sf) <= start ? node : undefined;
  };
  const statement = holder(sf.statements);
  if (statement === undefined) return undefined;
  const name = nameOf(statement);
  if (name === undefined) return undefined;
  if (!ts.isVariableStatement(statement)) return name;
  let init = statement.declarationList.declarations[0]?.initializer;
  while (init !== undefined && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)))
    init = init.expression;
  if (init === undefined || !ts.isObjectLiteralExpression(init)) return name;
  const property = holder(init.properties);
  const key = property === undefined ? undefined : propertyKey(property);
  return key === undefined ? name : `${name}.${key}`;
}

/** The symbol a row's `find` sits in today, or undefined when it does not
    occur exactly once. */
export function currentSymbol(
  row: { file: string; find: string },
  text: string,
): string | undefined {
  const at = text.indexOf(row.find);
  if (at === -1 || text.indexOf(row.find, at + 1) !== -1) return undefined;
  return enclosingSymbol(row.file, text, at, at + row.find.length);
}
