#!/usr/bin/env node
// PostToolUse hook — the context tripwire.
//
// Claude Code's own answer to a full context is auto-compaction, which keeps the
// session alive but degrades it: the summary is lossy in ways nobody chose. This
// project already has a better handoff (docs/progress.md), so the loop would
// rather END the session early and start a clean one. This hook is what makes
// that happen: it reads the real token usage off the transcript after every tool
// call and, past a threshold, injects an instruction to land the session.
//
// Two tiers, each fired at most once per session:
//   soft (default 60%) — stop starting new work, run the ritual, commit, stop.
//   hard (default 78%) — stop now, honest progress entry, commit, stop.
//
// Silent and exit 0 in every other case: a hook that breaks the session it is
// supposed to protect is worse than no hook.
//
// WHERE THE NUMBER COMES FROM. Not the transcript: in `-p` mode Claude Code
// flushes the transcript at the END of a turn, and the whole loop iteration is
// one turn — a PostToolUse hook reading it mid-flight sees the session's opening
// bytes and nothing else (measured: 886 bytes and 0 usage records at tool time,
// 8185 bytes at Stop). The `--output-format stream-json` stream, which the driver
// tees to disk, carries `.message.usage` per assistant message in real time. So
// the stream file is the source when the driver provides one, and the transcript
// is the fallback for interactive use, where it is flushed per turn and correct.

import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// The transcript is append-only, so the newest usage record is near the end.
// Never read the whole file — it grows to tens of MB in a long session.
const TAIL_BYTES = 512 * 1024;

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// 200k is the default window; the 1M-context models need this overridden.
const WINDOW = num(process.env.AUTOLOOP_CONTEXT_WINDOW, 200_000);
const SOFT = num(process.env.AUTOLOOP_SOFT_PCT, 60);
const HARD = num(process.env.AUTOLOOP_HARD_PCT, 78);
const STATE_DIR = process.env.AUTOLOOP_STATE_DIR || join(tmpdir(), "claude-autoloop");

function tail(path, bytes) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

// Context used ≈ everything the last request sent: fresh input + both cache
// halves. output_tokens is excluded — it is already counted in the next request.
// Both the stream and the transcript nest it at the same path, so one reader
// serves both.
function lastContextTokens(path) {
  const lines = tail(path, TAIL_BYTES).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // a truncated first line from the tail read, or a partial write
    }
    // A sub-agent's usage describes the SUB-AGENT's context, not this session's —
    // and this project delegates heavily, so reading one would badly misreport.
    if (entry.isSidechain || entry.parent_tool_use_id) continue;
    const u = entry?.message?.usage;
    if (!u) continue;
    const used =
      (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    if (used > 0) return used;
  }
  return 0;
}

// One file per (session, tier). Its existence is the "already fired" flag —
// without it the notice would repeat after every single tool call.
function claimTier(sessionId, tier) {
  mkdirSync(STATE_DIR, { recursive: true });
  const flag = join(STATE_DIR, `${sessionId}.${tier}`);
  try {
    writeFileSync(flag, "", { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

const NOTICE = {
  // The fragments are `.join("")`ed rather than `+`ed: identical bytes, but it
  // keeps these prose blocks under the 100-col line width without tripping
  // `lint/style/useTemplate`, whose fix would collapse each into one 400-col
  // line. (These files were unlinted until D212 — see scripts/lint-coverage.ts.)
  soft: (pct) =>
    [
      `[autoloop] SOFT LIMIT — context is at ${pct}% of the window.\n`,
      "Stop starting new work. Finish or park what is open, run the end-of-session ",
      "ritual (progress.md status + session log + a NEW resume point, decisions.md, ",
      "the workstream doc), commit, and end the turn. The loop will open a fresh ",
      "session from your resume point — so the resume point is the deliverable now. ",
      "Do not compact and continue.",
    ].join(""),
  hard: (pct) =>
    [
      `[autoloop] HARD LIMIT — context is at ${pct}% of the window.\n`,
      "Stop now. Get the tree compiling, write an honest progress.md entry naming ",
      "exactly where you stopped and what is half-done, commit, end the turn. An ",
      "accurate half-slice handoff is worth more than a finished slice nobody can resume.",
    ].join(""),
};

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }

  const { transcript_path: transcriptPath, session_id: sessionId } = input;
  if (!sessionId) return;

  // Stream first (live under -p), transcript second (correct interactively).
  const sources = [process.env.AUTOLOOP_STREAM_FILE, transcriptPath].filter(Boolean);
  let used = 0;
  for (const source of sources) {
    try {
      used = lastContextTokens(source);
    } catch {
      continue; // not written yet, or unreadable — try the next source
    }
    if (used) break;
  }
  if (!used) return;

  const pct = Math.round((used / WINDOW) * 100);
  const tier = pct >= HARD ? "hard" : pct >= SOFT ? "soft" : null;
  if (!tier) return;
  // Claim the hard tier's slot too, so a session that jumps straight past both
  // thresholds gets the hard notice only, not both.
  if (tier === "hard") claimTier(sessionId, "soft");
  if (!claimTier(sessionId, tier)) return;

  process.stdout.write(
    JSON.stringify({
      systemMessage: `autoloop: context ${pct}% (${used.toLocaleString()} tok) — ${tier} limit, landing the session`,
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: NOTICE[tier](pct),
      },
    }),
  );
}

main();
