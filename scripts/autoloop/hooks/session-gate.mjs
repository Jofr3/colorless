#!/usr/bin/env node
// Stop hook — the handoff gate.
//
// The loop's single point of failure is a session that does work and then ends
// without updating docs/progress.md: the next session boots from a stale resume
// point and either redoes the slice or wanders off. This hook catches exactly
// that case and sends the session back to finish the ritual.
//
// It blocks at most AUTOLOOP_MAX_GATE_BLOCKS times (default 1) per session — a
// Stop hook that keeps blocking is an infinite loop with a billing account.
// It is inert outside the loop (AUTOLOOP_BASE_SHA unset), so interactive
// sessions in this repo are untouched.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const STATE_DIR = process.env.AUTOLOOP_STATE_DIR || join(tmpdir(), "claude-autoloop");
const MAX_BLOCKS = Number(process.env.AUTOLOOP_MAX_GATE_BLOCKS ?? 1);
const PROGRESS = "docs/progress.md";

const git = (cwd, args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function blocksUsed(sessionId) {
  const path = join(STATE_DIR, `${sessionId}.gate`);
  let n = 0;
  try {
    n = Number(readFileSync(path, "utf8")) || 0;
  } catch {
    /* first stop of the session */
  }
  return {
    n,
    bump: () => {
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(path, String(n + 1));
    },
  };
}

function main() {
  const base = process.env.AUTOLOOP_BASE_SHA;
  if (!base) return; // not an autoloop session

  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id;
  if (!sessionId) return;

  let dirty;
  let committed;
  let head;
  try {
    dirty = git(cwd, ["status", "--porcelain"]);
    head = git(cwd, ["rev-parse", "HEAD"]);
    committed = head === base ? "" : git(cwd, ["log", "--name-only", "--pretty=format:", `${base}..HEAD`]);
  } catch {
    return; // no git, detached weirdness — never block on a broken read
  }

  // Nothing happened at all. That is the loop driver's problem (it detects the
  // stall and halts), not something more turns in this session would fix.
  if (!dirty && head === base) return;

  if (`${committed}\n${dirty}`.includes(PROGRESS)) {
    // The handoff was written. Uncommitted leftovers are still worth a nudge,
    // since the next session starts on this tree.
    if (!dirty) return;
  }

  const gate = blocksUsed(sessionId);
  if (gate.n >= MAX_BLOCKS) return; // said our piece; let the session end
  gate.bump();

  // Every prose block below is `.join("")`ed rather than `+`ed. Same bytes, but
  // `lint/style/useTemplate` fires on `+` the moment one operand interpolates,
  // and its fix collapses the whole paragraph onto one 400-col line. These files
  // were linted by nothing until D212 — see scripts/lint-coverage.ts.
  const problems = [];
  if (!`${committed}\n${dirty}`.includes(PROGRESS)) {
    problems.push(
      [
        `- \`${PROGRESS}\` was not touched. This session changed the repo, so the next one `,
        "boots from a resume point that no longer describes reality. Update the status, ",
        "append the session-log entry, and rewrite **NEXT (resume point)**.",
      ].join(""),
    );
  }
  if (dirty) {
    problems.push(
      [
        "- The working tree is dirty. The next session starts on this tree — commit the ",
        "slice (or `git restore` what was a dead end) so it starts from a known state:\n",
        dirty
          .split("\n")
          .slice(0, 20)
          .map((l) => `    ${l}`)
          .join("\n"),
      ].join(""),
    );
  }

  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason: [
        "[autoloop] End-of-session ritual incomplete — this is the one thing the loop ",
        "cannot recover from:\n",
        problems.join("\n"),
        "\nAlso log any decision in `docs/decisions.md` and write what you learned into the ",
        "workstream doc. Do this in ONE pass and end the turn — this gate fires once and will ",
        "not block again, so do not re-verify or re-plan, just write the handoff and commit. ",
        "If something here is impossible (no tool, no permission), say so in one line and stop ",
        "rather than retrying.",
      ].join(""),
    }),
  );
}

main();
