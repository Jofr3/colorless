// The declaration a mutant's `find` sits in, recorded on the row so reanchor.ts
// can refuse to move it onto an identical fragment in some other function.

import ts from "typescript";

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
  const holds = (n: ts.Node) => n.getStart(sf) <= start && end <= n.getEnd();
  const statement = sf.statements.find(holds);
  if (statement === undefined) return undefined;
  const name = nameOf(statement);
  if (name === undefined) return undefined;
  if (!ts.isVariableStatement(statement)) return name;
  let init = statement.declarationList.declarations[0]?.initializer;
  while (init !== undefined && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)))
    init = init.expression;
  if (init === undefined || !ts.isObjectLiteralExpression(init)) return name;
  const property = init.properties.find(holds);
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
