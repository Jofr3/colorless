#!/usr/bin/env bash
# autoloop — run Claude Code on this repo in a loop, one slice per fresh session.
#
# The context problem is solved by NOT solving it: instead of keeping one session
# alive across a compaction, each iteration is a brand-new session that boots from
# docs/progress.md. The context-guard hook lands a session before it hits the
# compaction cliff; this driver then starts the next one. docs/ is the handoff.
#
#   ./scripts/autoloop/loop.sh                # run with defaults
#   ./scripts/autoloop/loop.sh "focus: P5 uploaded avatars"   # steer one run
#
# Halts on: iteration cap, a stalled iteration (no commit, clean tree), a
# docs/.autoloop-stop sentinel written by the agent, or Ctrl-C.
set -uo pipefail

ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)" || {
  echo "autoloop: not a git repo" >&2
  exit 1
}
HERE="$ROOT/scripts/autoloop"
FOCUS="${1:-}"

# ── config (env-overridable) ────────────────────────────────────────────────
MAX_ITERATIONS="${AUTOLOOP_MAX_ITERATIONS:-8}"

# The window has to match the model the headless session will actually get, or
# the thresholds are meaningless: a 1M session measured against 200k lands after
# a fifth of its real capacity. Resolve it from the model name unless told.
resolve_model() {
  [[ -n "${AUTOLOOP_MODEL:-}" ]] && { echo "$AUTOLOOP_MODEL"; return; }
  for f in "$ROOT/.claude/settings.local.json" "$ROOT/.claude/settings.json" "$HOME/.claude/settings.json"; do
    [[ -f "$f" ]] || continue
    local m
    m="$(jq -r '.model // empty' "$f" 2>/dev/null)"
    [[ -n "$m" ]] && { echo "$m"; return; }
  done
}
EFFECTIVE_MODEL="$(resolve_model)"
if [[ -n "${AUTOLOOP_CONTEXT_WINDOW:-}" ]]; then
  CONTEXT_WINDOW="$AUTOLOOP_CONTEXT_WINDOW"
  WINDOW_SOURCE="env"
elif [[ "$EFFECTIVE_MODEL" == *"1m"* || "$EFFECTIVE_MODEL" == *"1M"* ]]; then
  CONTEXT_WINDOW=1000000
  WINDOW_SOURCE="model ${EFFECTIVE_MODEL}"
else
  CONTEXT_WINDOW=200000
  WINDOW_SOURCE="default${EFFECTIVE_MODEL:+, model $EFFECTIVE_MODEL}"
fi
SOFT_PCT="${AUTOLOOP_SOFT_PCT:-60}"
HARD_PCT="${AUTOLOOP_HARD_PCT:-78}"
PERMISSION_MODE="${AUTOLOOP_PERMISSION_MODE:-bypassPermissions}"
SLEEP_BETWEEN="${AUTOLOOP_SLEEP:-5}"
ALLOW_MAIN="${AUTOLOOP_ALLOW_MAIN:-0}"
MODEL="${AUTOLOOP_MODEL:-}"
EFFORT="${AUTOLOOP_EFFORT:-}"
# Per-iteration backstops. This CLI has no --max-turns, and an unattended session
# that gets stuck retrying will keep spending: a session told to do something it
# cannot do was measured burning 93 turns before it was killed. Set either to ""
# to uncap, but do that with your eyes open.
BUDGET_USD="${AUTOLOOP_BUDGET_USD-30}"
ITER_TIMEOUT="${AUTOLOOP_TIMEOUT-5400}"      # wall-clock seconds per iteration
STOP_FILE="$ROOT/tmp/autoloop-stop"   # gitignored: a signal to you, not a commit
WAIT_FOR_RESET="${AUTOLOOP_WAIT_FOR_RESET:-1}"
MAX_WAIT="${AUTOLOOP_MAX_WAIT:-21600}"       # 6h: rides out a five_hour window, not a weekly one

RUN_ID="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="$ROOT/tmp/autoloop/$RUN_ID"
mkdir -p "$RUN_DIR"

# Hooks read these. AUTOLOOP_BASE_SHA is re-exported per iteration.
export AUTOLOOP_CONTEXT_WINDOW="$CONTEXT_WINDOW"
export AUTOLOOP_SOFT_PCT="$SOFT_PCT"
export AUTOLOOP_HARD_PCT="$HARD_PCT"
export AUTOLOOP_STATE_DIR="$RUN_DIR/state"

# Absolute paths, resolved once — a relative hook command would break the moment
# a sub-agent changes directory.
RUN_SETTINGS="$RUN_DIR/settings.json"
sed "s|__ROOT__|$ROOT|g" "$HERE/settings.json" > "$RUN_SETTINGS"

# ── guards ─────────────────────────────────────────────────────────────────
BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]] && [[ "$ALLOW_MAIN" != "1" ]]; then
  echo "autoloop: refusing to run unattended on '$BRANCH'." >&2
  echo "          branch first, or set AUTOLOOP_ALLOW_MAIN=1 if you mean it." >&2
  exit 1
fi
if [[ -f "$STOP_FILE" ]]; then
  echo "autoloop: $STOP_FILE exists — a previous run halted for you:" >&2
  cat "$STOP_FILE" >&2
  echo "          delete it to resume." >&2
  exit 1
fi
if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
  echo "autoloop: working tree is dirty. Commit or stash first — the agent commits," >&2
  echo "          and mixing your changes into its commits is how work gets lost." >&2
  exit 1
fi

# Billing is not a per-iteration detail — it is a property of the whole run, so
# it gets checked once, loudly, before anything starts.
auth_json="$(claude auth status 2>/dev/null)"
AUTH_METHOD="$(jq -r '.authMethod // "unknown"' <<< "$auth_json" 2>/dev/null)"
AUTH_PLAN="$(jq -r '.subscriptionType // "—"' <<< "$auth_json" 2>/dev/null)"
if [[ "$AUTH_METHOD" != "claude.ai" ]]; then
  echo "autoloop: auth is '$AUTH_METHOD', not a claude.ai subscription — this run would" >&2
  echo "          bill as API usage. \`claude auth login\` first, or set AUTOLOOP_ALLOW_API=1." >&2
  [[ "${AUTOLOOP_ALLOW_API:-0}" != "1" ]] && exit 1
fi

printf '\033[1mautoloop\033[0m  branch=%s  iterations=%s  soft=%s%%  hard=%s%%  perms=%s\n' \
  "$BRANCH" "$MAX_ITERATIONS" "$SOFT_PCT" "$HARD_PCT" "$PERMISSION_MODE"
printf '          context window: %s tokens (%s)\n' "$CONTEXT_WINDOW" "$WINDOW_SOURCE"
printf '          auth: %s (%s)\n' "$AUTH_METHOD" "$AUTH_PLAN"
printf '          logs: %s\n\n' "$RUN_DIR"

stall_count=0
total_cost=0

for (( i=1; i<=MAX_ITERATIONS; i++ )); do
  base_sha="$(git -C "$ROOT" rev-parse HEAD)"
  export AUTOLOOP_BASE_SHA="$base_sha"
  raw="$RUN_DIR/iter-$i.jsonl"
  # The context guard reads this, not the transcript: under -p the transcript is
  # only flushed at end of turn, while `tee` puts the stream on disk live.
  export AUTOLOOP_STREAM_FILE="$raw"
  : > "$raw"

  printf '\033[1m── iteration %s/%s\033[0m  %s  (base %s)\n' \
    "$i" "$MAX_ITERATIONS" "$(date +%H:%M:%S)" "${base_sha:0:8}"

  # The whole "fabricated prompt": a fixed protocol + which iteration this is.
  # Everything situational comes from docs/, read by the agent at boot.
  prompt="$(cat "$HERE/prompt.md")"
  prompt+=$'\n\n---\nAutoloop iteration '"$i of $MAX_ITERATIONS"$'. Context window: '"$CONTEXT_WINDOW"$' tokens.'
  [[ -n "$FOCUS" ]] && prompt+=$'\nUser steer for this run (overrides the resume point if they conflict): '"$FOCUS"

  cmd=(claude -p "$prompt"
       --settings "$RUN_SETTINGS"
       --output-format stream-json --verbose
       --add-dir "$ROOT")
  if [[ "$PERMISSION_MODE" == "bypassPermissions" ]]; then
    cmd+=(--dangerously-skip-permissions)
  else
    cmd+=(--permission-mode "$PERMISSION_MODE")
  fi
  [[ -n "$MODEL"      ]] && cmd+=(--model "$MODEL")
  [[ -n "$EFFORT"     ]] && cmd+=(--effort "$EFFORT")
  [[ -n "$BUDGET_USD" ]] && cmd+=(--max-budget-usd "$BUDGET_USD")

  [[ -n "$ITER_TIMEOUT" ]] && cmd=(timeout --foreground -k 30 "$ITER_TIMEOUT" "${cmd[@]}")

  # A stray key in a shell profile would silently move this run onto API billing.
  # Strip them for the child so the subscription is the only credential available.
  cmd=(env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL
       -u CLAUDE_CODE_USE_BEDROCK -u CLAUDE_CODE_USE_VERTEX "${cmd[@]}")

  # Raw stream to disk for forensics; a readable trickle to the terminal.
  ( cd "$ROOT" && "${cmd[@]}" ) 2> "$RUN_DIR/iter-$i.stderr" \
    | tee "$raw" \
    | jq -j --unbuffered '
        if .type == "assistant" then
          (.message.content[]? |
            if .type == "text" then .text
            elif .type == "tool_use" then "\n  ⚙ \(.name)\n"
            else empty end)
        elif .type == "result" then
          "\n\n── \(.subtype) · turns=\(.num_turns // "?") · $\(.total_cost_usd // 0)\n"
        else empty end' 2>/dev/null
  status="${PIPESTATUS[0]}"

  cost="$(jq -r 'select(.type=="result") | .total_cost_usd // 0' "$raw" 2>/dev/null | tail -1)"
  [[ -n "$cost" ]] && total_cost="$(awk -v a="$total_cost" -v b="$cost" 'BEGIN{printf "%.4f", a+b}')"

  # The guard's systemMessage never reaches the -p stream, so report from the
  # tier files it claims — otherwise you cannot tell a landed session from a
  # session that simply finished early.
  for tier in hard soft; do
    if compgen -G "$AUTOLOOP_STATE_DIR/*.$tier" > /dev/null; then
      echo "          context guard: $tier limit hit — the session was told to land"
      break
    fi
  done
  rm -f "$AUTOLOOP_STATE_DIR"/*.soft "$AUTOLOOP_STATE_DIR"/*.hard 2>/dev/null

  if [[ "$status" -eq 124 || "$status" -eq 137 ]]; then
    echo "autoloop: iteration $i hit the ${ITER_TIMEOUT}s wall clock and was killed." >&2
    echo "          the tree is left as-is; inspect before resuming." >&2
    break
  fi
  if [[ "$status" -ne 0 ]]; then
    echo "autoloop: claude exited $status — see $RUN_DIR/iter-$i.stderr" >&2
    tail -5 "$RUN_DIR/iter-$i.stderr" >&2
    break
  fi

  # Did anything actually happen? A clean tree at the same SHA means the session
  # burned an iteration on nothing; twice in a row and the loop is spinning.
  head_sha="$(git -C "$ROOT" rev-parse HEAD)"
  if [[ "$head_sha" == "$base_sha" && -z "$(git -C "$ROOT" status --porcelain)" ]]; then
    stall_count=$(( stall_count + 1 ))
    echo "autoloop: iteration $i produced no commit and no changes (stall $stall_count/2)"
    if [[ "$stall_count" -ge 2 ]]; then
      echo "autoloop: two stalled iterations — halting rather than burning tokens." >&2
      break
    fi
  else
    stall_count=0
    git -C "$ROOT" --no-pager log --oneline "$base_sha..$head_sha" | sed 's/^/          + /'
  fi

  # Subscription usage, not money, is the real budget here. The stream reports the
  # window's state; when it closes, waiting for the reset beats halting a run that
  # still has slices to do — a five-hour window reopens well within one night.
  rl="$(jq -c 'select(.type=="rate_limit_event") | .rate_limit_info' "$raw" 2>/dev/null | tail -1)"
  if [[ -n "$rl" ]]; then
    rl_status="$(jq -r '.status // "unknown"' <<< "$rl")"
    rl_kind="$(jq -r '.rateLimitType // "?"' <<< "$rl")"
    rl_resets="$(jq -r '.resetsAt // 0' <<< "$rl")"
    if [[ "$rl_status" == *reject* || "$rl_status" == *exceed* || "$rl_status" == *block* ]]; then
      wait_s=$(( rl_resets - $(date +%s) + 60 ))
      if [[ "$wait_s" -le 0 ]]; then
        echo "          $rl_kind limit reported, but the window has already reset — continuing"
      elif [[ "$WAIT_FOR_RESET" != "1" || "$wait_s" -gt "$MAX_WAIT" ]]; then
        echo "autoloop: $rl_kind usage limit reached; resets $(date -d "@$rl_resets" '+%a %H:%M')." >&2
        echo "          that is $((wait_s / 60))min away — halting." >&2
        if [[ "$WAIT_FOR_RESET" == "1" ]]; then
          echo "          to sleep through it: AUTOLOOP_MAX_WAIT=$((wait_s + 300))" >&2
        else
          echo "          to sleep through it: AUTOLOOP_WAIT_FOR_RESET=1" >&2
        fi
        break
      else
        echo "          $rl_kind limit reached — sleeping $((wait_s / 60))min until $(date -d "@$rl_resets" '+%H:%M'), then continuing"
        sleep "$wait_s"
      fi
    elif [[ "$rl_status" == *warning* ]]; then
      echo "          heads up: approaching the $rl_kind limit (resets $(date -d "@$rl_resets" '+%H:%M'))"
    fi
  fi

  if [[ -f "$STOP_FILE" ]]; then
    echo ""
    echo "autoloop: the agent asked to stop — it needs you:"
    sed 's/^/          /' "$STOP_FILE"
    break
  fi

  (( i < MAX_ITERATIONS )) && sleep "$SLEEP_BETWEEN"
done

printf '\n\033[1mautoloop done\033[0m  total ≈ $%s  ·  %s\n' "$total_cost" "$RUN_DIR"
git -C "$ROOT" --no-pager log --oneline -10
