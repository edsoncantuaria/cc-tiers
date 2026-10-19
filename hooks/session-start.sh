#!/usr/bin/env bash
# SessionStart entrypoint. Prefer python3, then python, then a static reminder.
root="${CLAUDE_PLUGIN_ROOT:-}"
if [[ -z "$root" ]]; then
  root="$(cd "$(dirname "$0")/.." && pwd)"
fi

if command -v python3 >/dev/null 2>&1; then
  exec python3 "$root/hooks/session_start.py"
fi
if command -v python >/dev/null 2>&1; then
  exec python "$root/hooks/session_start.py"
fi

printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"cc-tiers is enabled. python3 is not on PATH, so the live routing summary was not built. Defaults still apply: max attempts per tier is 2, review policy is risky, escalation is haiku then sonnet then opus."}}'
