#!/usr/bin/env bash
# PostToolUse / PostToolUseFailure entrypoint for the Agent tool. Uses Node.
root="${CLAUDE_PLUGIN_ROOT:-}"
if [[ -z "$root" ]]; then
  root="$(cd "$(dirname "$0")/.." && pwd)"
fi

if command -v node >/dev/null 2>&1; then
  exec node "$root/hooks/after_agent.mjs"
fi

printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"cc-tiers could not update the attempt counter because node is not on PATH. The orchestrator still applies the retry limit from /config (default 2)."}}'
