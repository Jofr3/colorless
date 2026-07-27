# autoloop — unattended development, one slice per session

```bash
./scripts/autoloop/loop.sh                          # defaults
AUTOLOOP_MAX_ITERATIONS=3 ./scripts/autoloop/loop.sh
./scripts/autoloop/loop.sh "focus: P5 uploaded avatars"
```

## The idea

Context does not have to be *managed* — it has to be **abandoned on purpose**.
Each iteration is a brand-new `claude -p` session that boots from `docs/`, does
**one slice**, writes the handoff, commits, and exits. The driver starts the
next one. Nothing is carried in memory between iterations, because
`docs/progress.md` already carries it — that is what this project's docs system
was built for.

Auto-compaction is the thing being avoided: it keeps a session alive by summarising
it, and the summary is lossy in ways nobody chose. A fresh session reading a resume
point *you* wrote is strictly better.

```
loop.sh ──► claude -p (fresh session) ──► reads docs/ ──► one slice ──► ritual + commit ──► exit
   ▲                     │
   │                     ├── PostToolUse: context-guard  ─ past 60% → "land the session"
   │                     └── Stop:        session-gate   ─ ritual not done → one more turn
   └──────────────────── next iteration, empty context ◄─┘
```

## The two hooks

Both live in `hooks/` and are wired through `settings.json`, which `loop.sh`
passes with `--settings`. **They never fire in your interactive sessions** — the
gate is inert unless `AUTOLOOP_BASE_SHA` is set, and the settings file is only
loaded by the loop.

**`context-guard.mjs`** (PostToolUse) — reads real token usage and, past a
threshold, injects an instruction to land the session. Two tiers, each firing at
most once: **soft** (60%) *stop starting new work, run the ritual, commit*;
**hard** (78%) *stop now, honest half-slice handoff, commit*.

> It reads the **stream file the driver tees to disk**, not the transcript. Under
> `-p` the transcript is flushed at end of turn — and the whole iteration is one
> turn — so a hook reading it mid-flight sees the session's opening bytes and
> nothing else. The stream carries `.message.usage` per assistant message, live.
> Sub-agent records are skipped: their usage describes *their* context, not this
> session's, and this project delegates heavily.

**`session-gate.mjs`** (Stop) — the loop's one unrecoverable failure is a session
that changes the repo and ends without updating `progress.md`: the next session
then boots from a resume point that no longer describes reality. The gate catches
exactly that, plus a dirty tree, and sends the session back **once**. Never more
than once — a Stop hook that keeps blocking is an infinite loop with a billing
account.

## Configuration

| Env | Default | What it does |
|---|---|---|
| `AUTOLOOP_MAX_ITERATIONS` | `8` | Sessions per run |
| `AUTOLOOP_CONTEXT_WINDOW` | auto | Resolved from the model in your settings — `1000000` if it carries `[1m]`, else `200000`. The banner prints which and why; override if it guesses wrong |
| `AUTOLOOP_SOFT_PCT` / `_HARD_PCT` | `60` / `78` | Land-the-session thresholds |
| `AUTOLOOP_BUDGET_USD` | `15` | Per-iteration cap on *estimated equivalent* cost — see Billing (`""` = uncapped) |
| `AUTOLOOP_TIMEOUT` | `5400` | Per-iteration wall clock, seconds (`""` = none) |
| `AUTOLOOP_WAIT_FOR_RESET` | `1` | On hitting a usage limit, sleep until the window reopens instead of halting |
| `AUTOLOOP_MAX_WAIT` | `21600` | Longest sleep it will take — 6h rides out a five-hour window, not a weekly one |
| `AUTOLOOP_ALLOW_API` | `0` | Required to run on API-key auth instead of a subscription |
| `AUTOLOOP_MODEL` / `_EFFORT` | session default | e.g. `opus`, `xhigh` |
| `AUTOLOOP_PERMISSION_MODE` | `bypassPermissions` | See the warning below |
| `AUTOLOOP_SLEEP` | `5` | Pause between iterations |
| `AUTOLOOP_ALLOW_MAIN` | `0` | Required to run on `main`/`master` |

The window must match the model the headless session actually gets — a 1M session
measured against 200k lands after a fifth of its real capacity, turning every
iteration into a stub.

There is no `--max-turns` in this CLI version, so `AUTOLOOP_BUDGET_USD` and
`AUTOLOOP_TIMEOUT` are the only runaway backstops. A session told to do something
it cannot do was measured burning 93 turns before being killed. Keep them set.

## Billing — it runs on your subscription

Headless sessions use whatever the CLI is logged in as, so `claude auth login`
(claude.ai) is all it takes. The driver does not take this on faith:

- it **checks `claude auth status` before the first iteration** and refuses to
  start on API-key auth (`AUTOLOOP_ALLOW_API=1` to override) — an unattended run
  that quietly bills per token is not something to discover afterwards;
- it **strips `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`
  and the Bedrock/Vertex switches** from each session's environment, so a key left
  in a shell profile cannot flip billing mid-run;
- the banner prints the auth method and plan it resolved.

`AUTOLOOP_BUDGET_USD` is therefore **not money** — on a subscription the reported
cost is an estimate of what the same tokens would have cost on the API. It is
still the right runaway backstop (this CLI has no `--max-turns`), just read it as
"how much work one iteration may do", not as a bill.

The real limit is your usage window. The driver reads the `rate_limit_event` the
stream emits after each iteration and, when the window closes, **sleeps until
`resetsAt` and carries on** — a five-hour window reopens well within one night.
A reset further out than `AUTOLOOP_MAX_WAIT` (a weekly cap) halts instead, and it
warns when a window is merely getting close. Note that overage is disabled on this
account, so exhausting the subscription fails the request rather than silently
spending API credit.

## It halts on

- the iteration cap;
- **two stalled iterations** — no commit and a clean tree means the session did
  nothing, and doing nothing twice means the loop is spinning;
- `tmp/autoloop-stop` — the agent writes this (gitignored, not a commit) when the
  resume point needs a decision only you can make, e.g. the remote P4 deploy;
- a non-zero exit, a wall-clock kill, or Ctrl-C.

## Before you start it

- **It runs with permissions bypassed.** That is what unattended means: an agent
  that stops at the first prompt for `bun run check` is not a loop. Run it on a
  branch (the driver refuses `main` without `AUTOLOOP_ALLOW_MAIN=1`), or in a
  worktree if you want the repo untouched while it works.
- **Commit or stash first.** The driver refuses a dirty tree — the agent commits,
  and mixing your uncommitted work into its commits is how work gets lost.
- **Read the first commits before walking away.** The loop is only as good as the
  resume point each session writes; the first iteration tells you whether that
  ritual is holding.

Logs, per run, under `tmp/autoloop/<timestamp>/`: `iter-N.jsonl` (full stream),
`iter-N.stderr`, and the resolved `settings.json`.
