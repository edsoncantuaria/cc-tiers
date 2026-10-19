#!/usr/bin/env bash
# PostToolUse / PostToolUseFailure entrypoint for the Agent tool.
root="${CLAUDE_PLUGIN_ROOT:-}"
if [[ -z "$root" ]]; then
  root="$(cd "$(dirname "$0")/.." && pwd)"
fi

if command -v python3 >/dev/null 2>&1; then
  exec python3 "$root/hooks/after_agent.py"
fi
if command -v python >/dev/null 2>&1; then
  exec python "$root/hooks/after_agent.py"
fi

printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"cc-tiers could not update the attempt counter because python3 is not on PATH. The orchestrator still applies the retry limit from /config (default 2)."}}'
