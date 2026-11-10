#!/usr/bin/env bun
/**
 * Fails when the API's log lines slip past the rules in `apps/api/src/http/log.ts`:
 *   - a `console` call anywhere in `apps/api/src` outside log.ts (tests and `testing/` aside), so
 *     every line goes through log.ts as one JSON object with an `evt`;
 *   - a log field key that names personal data or a credential (DENIED_KEYS, DENIED_KEY_PARTS),
 *     read from the object literals in a log call's arguments and in any function that returns
 *     `LogFields`;
 *   - an `evt` and `kind` pair that the Monitoring runbook (backend-data.md §3.7.4) does not name,
 *     so a query found in the runbook finds every line.
 * A call must name its `evt` and `kind` as string literals, except the forwarders in FORWARDERS,
 * whose callers are read instead. It reads source text, so a key built outside the call (a
 * variable, a helper not typed `LogFields`) or a log function under another name goes unseen; the
 * `LogFields` type and the lobby's LB8 test cover part of that at run time.
 */

import { readdirSync, readFileSync } from "node:fs";
import { type Report, runReport } from "./lib/cli";
import { repoPath } from "./lib/repo";

const ROOT = "apps/api/src";
const LOG_MODULE = "http/log.ts";
const LOBBY = "lobby/lobbyDO.ts";
const RUNBOOK = "docs/workstreams/backend-data.md";
const RUNBOOK_SECTION = "#### 3.7.4 ";

/** Field keys that hold an identity, an address or a player-typed string, compared without case.
    `code` is not one: lobby lines carry a WebSocket close code under it (the lobby's own code is
    `lobby`). */
const DENIED_KEYS = new Set([
  "ip",
  "session",
  "sessionid",
  "userid",
  "accountid",
  "deckid",
  "displayname",
  "deckname",
  "name",
]);
/** Key fragments that are never a count or a reason, whatever surrounds them. */
const DENIED_KEY_PARTS = /email|password|token|cookie|secret/i;

/** Where each log function takes its `evt` and `kind`; `kind` may be absent with a default. */
const CALLS: Readonly<Record<string, { evt: number; kind: number; defaultKind?: string }>> = {
  logInfo: { evt: 0, kind: 1 },
  logEvent: { evt: 0, kind: 1 },
  logError: { evt: 0, kind: 1 },
  logEventThrottled: { evt: 0, kind: 1 },
  logErrorThrottled: { evt: 0, kind: 1 },
  logEventThrottledBy: { evt: 1, kind: 2 },
  logErrorThrottledBy: { evt: 1, kind: 2 },
  bindingRefuses: { evt: 2, kind: 4, defaultKind: "binding_error" },
};
const CALL = new RegExp(
  `(?<![\\w$.])(${Object.keys(CALLS).join("|")})\\s*\\(|(?<![\\w$])this\\.(log|info)\\s*\\(`,
  "g",
);

/** Calls that pass on an `evt` or `kind` they were given, as `file callee(args up to kind)`. */
const FORWARDERS = new Set([
  "http/bindingLimit.ts logEventThrottled(evt, failureKind)",
  `${LOBBY} logEventThrottledBy(throttled, "lobby", kind)`,
  `${LOBBY} logEventThrottled("lobby", kind)`,
  `${LOBBY} logEvent("lobby", kind)`,
  `${LOBBY} logInfo("lobby", kind)`,
]);

export type ApiSource = { path: string; text: string };

/** `text` with comments and the insides of string and template literals blanked to spaces, so
    offsets still line up with the original. */
function codeOnly(text: string): string {
  const out = text.split("");
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
    } else i++;
  }
  return out.join("");
}

const OPEN = "([{";
const CLOSE = ")]}";
const KEY = /\s*(\.\.\.)?\s*(?:([A-Za-z_$][\w$]*)|((["'])\s*\4))\s*[:,}]/dy;

/** From the bracket at `start` to the one that closes it: its top-level argument spans, and the
    keys of every object literal inside. */
function bracketed(code: string, text: string, start: number) {
  const stack: string[] = [];
  const args: [number, number][] = [];
  const keys: { key: string; at: number }[] = [];
  let argStart = start + 1;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (OPEN.includes(c)) stack.push(c);
    else if (CLOSE.includes(c)) {
      stack.pop();
      if (stack.length === 0) {
        if (code.slice(argStart, i).trim() !== "") args.push([argStart, i]);
        break;
      }
    } else if (c === "," && stack.length === 1) {
      args.push([argStart, i]);
      argStart = i + 1;
    }
    if ((c === "{" || c === ",") && stack.at(-1) === "{") {
      KEY.lastIndex = i + 1;
      const match = KEY.exec(code);
      const quoted = match?.indices?.[3];
      if (match && match[1] === undefined) {
        const key = quoted ? text.slice(quoted[0] + 1, quoted[1] - 1) : match[2];
        keys.push({ key, at: i + 1 });
      }
    }
  }
  return { args, keys };
}

const deniedKey = (key: string) =>
  DENIED_KEYS.has(key.toLowerCase()) || DENIED_KEY_PARTS.test(key) || /[a-z]Ip$/.test(key);

const literal = (raw: string) => raw.trim().match(/^(["'])([\w-]+)\1$/)?.[2];

/** Each `evt` row's backticked words, and the lobby kind table's first column. */
function runbookKinds(runbook: string): Map<string, Set<string>> | null {
  const start = runbook.indexOf(`\n${RUNBOOK_SECTION}`);
  if (start === -1) return null;
  const rest = runbook.slice(start + 1);
  const end = rest.search(/\n#{2,4} /);
  const section = end === -1 ? rest : rest.slice(0, end);
  const kinds = new Map<string, Set<string>>();
  const add = (evt: string, words: string) => {
    const set = kinds.get(evt) ?? new Set();
    for (const [, word] of words.matchAll(/`(\w+)`/g)) set.add(word);
    kinds.set(evt, set);
  };
  for (const line of section.split("\n")) {
    const row = line.match(/^\| `evt = "(\w+)"` \|(.*)$/);
    if (row) add(row[1], row[2]);
    const lobbyKinds = line.match(/^\| ((?:`[a-z_]+`(?: \*t\*)?(?:, )?)+) \|/);
    if (lobbyKinds) add("lobby", lobbyKinds[1]);
  }
  return kinds;
}

export function logGuardReport(files: readonly ApiSource[], runbook: string): Report {
  const problems: string[] = [];
  const pairs = new Set<string>();
  const documented = runbookKinds(runbook);
  if (documented === null) problems.push(`  ${RUNBOOK} has no "${RUNBOOK_SECTION}" section`);

  for (const { path, text } of files) {
    const code = codeOnly(text);
    const where = (at: number) => `${ROOT}/${path}:${text.slice(0, at).split("\n").length}`;
    const checkKeys = (keys: { key: string; at: number }[]) => {
      for (const { key, at } of keys) {
        if (deniedKey(key)) problems.push(`  ${where(at)}: log field \`${key}\``);
      }
    };

    if (path !== LOG_MODULE) {
      for (const match of code.matchAll(/(?<![\w$.])console\s*[.[]/g)) {
        problems.push(`  ${where(match.index)}: a console call`);
      }
    }
    for (const match of code.matchAll(/\)\s*:\s*LogFields\s*\{/g)) {
      checkKeys(bracketed(code, text, match.index + match[0].length - 1).keys);
    }
    if (path === LOG_MODULE) continue;

    for (const match of code.matchAll(CALL)) {
      if (/\bfunction\s*$/.test(code.slice(0, match.index))) continue;
      const lobbyMethod = match[2] !== undefined;
      if (lobbyMethod && path !== LOBBY) continue;
      const { args, keys } = bracketed(code, text, match.index + match[0].length - 1);
      checkKeys(keys);
      const raw = args.map(([from, to]) => text.slice(from, to).trim());
      const spec = lobbyMethod ? { evt: -1, kind: 0 } : CALLS[match[1]];
      const evt = spec.evt === -1 ? "lobby" : literal(raw[spec.evt] ?? "");
      const kind = raw[spec.kind] === undefined ? spec.defaultKind : literal(raw[spec.kind]);
      const head = `${path} ${match[1] ?? `this.${match[2]}`}(${raw.slice(0, spec.kind + 1).join(", ")})`;
      if (evt === undefined || kind === undefined) {
        if (!FORWARDERS.has(head)) {
          problems.push(`  ${where(match.index)}: evt and kind must be string literals`);
        }
        continue;
      }
      pairs.add(`${evt} ${kind}`);
      if (documented !== null && !documented.get(evt)?.has(kind)) {
        problems.push(
          `  ${where(match.index)}: \`${evt}\` \`${kind}\` is not in ${RUNBOOK} §3.7.4`,
        );
      }
    }
  }

  if (problems.length > 0) {
    return {
      ok: false,
      lines: [
        "log-guard: FAIL — the API logs only through http/log.ts, never personal data:",
        ...problems,
        "Log through apps/api/src/http/log.ts with counts, reasons and logTag tags, and document",
        `each new evt/kind in ${RUNBOOK} §3.7.4.`,
      ],
    };
  }
  return {
    ok: true,
    lines: [
      `${files.length} API files log only through http/log.ts with no denied field; ` +
        `${pairs.size} evt/kind pairs, all in the runbook`,
    ],
  };
}

function apiSources(): ApiSource[] {
  return readdirSync(repoPath(ROOT), { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .filter((name) => !name.startsWith("testing/"))
    .sort()
    .map((path) => ({ path, text: readFileSync(repoPath(`${ROOT}/${path}`), "utf8") }));
}

if (import.meta.main) {
  runReport("log-guard", () =>
    logGuardReport(apiSources(), readFileSync(repoPath(RUNBOOK), "utf8")),
  );
}
