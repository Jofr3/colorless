#!/usr/bin/env bun
/**
 * Fails when shipped Lua could write to stdout outside `frontend/lua/ui/bridge.lua`. love.js hands
 * the page one stdout line per byte 10 and `src/host/shell.ts` runs every line that starts with
 * `COLORLESS:` as a command, so a print of unencoded data, such as an opponent's name holding a
 * newline, can forge commands (security audit WC1). The bridge encodes every payload; everything
 * else sends through it.
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
  { label: "the global print", pattern: /(^|[^\w.:])print\b/m },
  { label: "_G.print", pattern: /\b_G\s*(\.|\[)\s*["']?print\b/ },
  { label: "io.write or io.stdout", pattern: /\bio\s*[.:]\s*(write|stdout|output)\b/ },
  { label: "a COLORLESS: literal", pattern: /COLORLESS:/ },
];

export type LuaSource = { path: string; text: string };

export function luaBridgeReport(files: readonly LuaSource[]): Report {
  const problems = files.flatMap(({ path, text }) => {
    if (path === BRIDGE) return [];
    const found = RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label);
    return found.length === 0 ? [] : [`  ${ROOT}/${path}: ${found.join(", ")}`];
  });
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
