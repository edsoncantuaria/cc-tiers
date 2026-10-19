#!/usr/bin/env bash
# SessionStart entrypoint. Claude Code ships with Node.
root="${CLAUDE_PLUGIN_ROOT:-}"
if [[ -z "$root" ]]; then
  root="$(cd "$(dirname "$0")/.." && pwd)"
fi

if command -v node >/dev/null 2>&1; then
  exec node "$root/hooks/session_start.mjs"
fi

printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"cc-tiers is enabled. node is not on PATH, so the live routing summary was not built. Defaults still apply: max attempts per tier is 2, review policy is cheap, escalation is haiku then sonnet then opus."}}'
