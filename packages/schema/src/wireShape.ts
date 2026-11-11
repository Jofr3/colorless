// The server-to-client wire reduced to what an open tab depends on, so a test can tell a change an
// old client survives from one it does not (backend-data.md §3.7.1). Each path into the frames maps
// to its atoms: the JSON types a value there may have, or, where it is restricted to literals, the
// literals, plus "absent" when the key is optional. A union whose branches share a literal key
// (`kind`) records that key's literals at the union and files each branch's fields under
// `{kind=value}`. Only wireShape.test.ts imports this.

import * as z from "zod";

export type WireShape = Record<string, string[]>;

type Node = {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  anyOf?: Node[];
  oneOf?: Node[];
  properties?: Record<string, Node>;
  required?: string[];
  items?: Node;
  additionalProperties?: Node | boolean;
};

/** The literal key every branch of a union fixes, if there is one. */
function discriminator(branches: Node[]): string | null {
  const [first] = branches;
  for (const key of Object.keys(first?.properties ?? {}))
    if (branches.every((branch) => branch.properties?.[key]?.const !== undefined)) return key;
  return null;
}

function walk(node: Node, path: string, shape: Map<string, Set<string>>): void {
  const branches = node.anyOf ?? node.oneOf;
  if (branches !== undefined) {
    const key = discriminator(branches);
    for (const branch of branches) {
      if (key === null) {
        walk(branch, path, shape);
        continue;
      }
      const value = JSON.stringify(branch.properties?.[key]?.const);
      walk(branch.properties?.[key] ?? {}, `${path}.${key}`, shape);
      walk(branch, `${path}{${key}=${value}}`, shape);
    }
    return;
  }
  const atoms = shape.get(path) ?? new Set<string>();
  shape.set(path, atoms);
  const literals = node.const !== undefined ? [node.const] : node.enum;
  if (literals !== undefined) {
    for (const literal of literals) atoms.add(`=${JSON.stringify(literal)}`);
    return;
  }
  for (const type of [node.type ?? "any"].flat()) atoms.add(type);
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    walk(child, `${path}.${key}`, shape);
    if (!node.required?.includes(key)) shape.get(`${path}.${key}`)?.add("absent");
  }
  if (node.items !== undefined) walk(node.items, `${path}[]`, shape);
  if (typeof node.additionalProperties === "object")
    walk(node.additionalProperties, `${path}{}`, shape);
}

/** `schema`'s wire shape, as the output a client receives, paths and atoms sorted. */
export function wireShape(schema: z.ZodType): WireShape {
  const json = z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }) as Node;
  const shape = new Map<string, Set<string>>();
  walk(json, "frame", shape);
  return Object.fromEntries(
    [...shape.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, s]) => [p, [...s].sort()]),
  );
}

/**
 * The changes from `recorded` to `current` that break a tab still running the recorded client: a
 * path it reads that is gone, and a type, a literal or an absence it has never seen. A new path
 * and a dropped atom are safe, since an old client ignores a key it does not read and never needs
 * a value it no longer receives.
 */
export function unsafeChanges(recorded: WireShape, current: WireShape): string[] {
  const out: string[] = [];
  for (const [path, atoms] of Object.entries(recorded)) {
    const now = current[path];
    if (now === undefined) {
      out.push(`${path} is gone, and old clients read it`);
      continue;
    }
    for (const atom of now)
      if (!atoms.includes(atom))
        out.push(
          atom === "absent"
            ? `${path} may now be missing, and old clients read it`
            : `${path} now carries ${atom}, which old clients have no arm for`,
        );
  }
  return out;
}
