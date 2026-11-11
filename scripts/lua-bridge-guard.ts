#!/usr/bin/env bun
/**
 * Fails when shipped Lua could write to stdout outside `frontend/lua/ui/bridge.lua`. love.js hands
 * the page one stdout line per byte 10 and `src/host/shell.ts` runs every line that starts with
 * `COLORLESS:` as a command, so a print of unencoded data, such as an opponent's name holding a
 * newline, can forge commands. The bridge encodes every payload; everything else sends through it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { type Report, runReport } from "./lib/cli";
import { repoPath } from "./lib/repo";

const ROOT = "frontend/lua";
/** What build.mjs packs into game.data, besides assets. */
const SHIPPED = ["conf.lua", "main.lua", "ui"];
const BRIDGE = "ui/bridge.lua";

const RULES: readonly { label: string; pattern: RegExp }[] = [
  // Any use of the global, not LÖVE's `g.print` or a method named print.
  { label: "the global print", pattern: /(^|[^\w.:])print\b/gm },
  { label: "_G.print", pattern: /\b_G\s*(\.|\[)\s*["']?print\b/g },
  { label: "io.write or io.stdout", pattern: /\bio\s*[.:]\s*(write|stdout|output)\b/g },
  { label: "a COLORLESS: literal", pattern: /COLORLESS:/g },
];

export type LuaSource = { path: string; text: string };

/** Each line of `text` that a rule matches, from 1, with the rules' labels. A hit belongs to the
    line its match ends on, since the global print's match can start at the newline before it. */
function hitLines(text: string): [number, string[]][] {
  const hits = new Map<number, string[]>();
  for (const { label, pattern } of RULES) {
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index + match[0].length).split("\n").length;
      hits.set(line, [...(hits.get(line) ?? []), label]);
    }
  }
  return [...hits].sort(([a], [b]) => a - b);
}

export function luaBridgeReport(files: readonly LuaSource[]): Report {
  const problems = files.flatMap(({ path, text }) =>
    path === BRIDGE
      ? []
      : hitLines(text).map(([line, labels]) => `  ${ROOT}/${path}:${line}: ${labels.join(", ")}`),
  );
  if (problems.length > 0) {
    return {
      ok: false,
      lines: [
        "lua-bridge-guard: FAIL — only ui/bridge.lua may write to stdout, which the page runs as commands:",
        ...problems,
        "Send through Bridge.emit(channel, ...fields) or Bridge.send(channel, joinedPayload).",
      ],
    };
  }
  return { ok: true, lines: [`${files.length} Lua files write to stdout only through the bridge`] };
}

function shippedLua(): LuaSource[] {
  return SHIPPED.flatMap((entry) =>
    entry.endsWith(".lua")
      ? [entry]
      : readdirSync(repoPath(`${ROOT}/${entry}`), { recursive: true, encoding: "utf8" })
          .filter((name) => name.endsWith(".lua"))
          .map((name) => `${entry}/${name}`),
  )
    .sort()
    .map((path) => ({ path, text: readFileSync(repoPath(`${ROOT}/${path}`), "utf8") }));
}

if (import.meta.main) runReport("lua-bridge-guard", () => luaBridgeReport(shippedLua()));
