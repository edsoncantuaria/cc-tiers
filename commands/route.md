---
description: Classify a task as Haiku, Sonnet, or Opus without doing the work.
argument-hint: "[task]"
allowed-tools: Bash(node:*)
---

Classify `$ARGUMENTS` under the cc-tiers rules. Do not edit files and do not delegate.

First get the heuristic from the hook module. Pass each task on stdin, never inside the command line:

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/route.mjs" <<'CC_TIERS_TASK_TEXT'
<one task description>
CC_TIERS_TASK_TEXT
```

It prints `tier`, `agent`, `because`, `risky`, and `review` from the phrase and keyword lists, the project history, and the cc-cost budget files. It does not see `/config`, so use the live settings below for the review policy and thresholds. Treat its answer as the starting point and override it only with a stated reason.

Read the session routing summary if it is present. Otherwise read `${CLAUDE_PLUGIN_ROOT}/config/routing.default.json` and `${CLAUDE_PROJECT_DIR}/.claude/cc-tiers.json` when that file exists. When learning is on, also read `${CLAUDE_PROJECT_DIR}/.claude/cc-tiers-history.json` if it exists. Live settings: max attempts ${user_config.max_attempts}, review policy ${user_config.review_policy}, learn ${user_config.learn}, 5h threshold ${user_config.budget_5h}, 7d threshold ${user_config.budget_7d}, extra Haiku phrases ${user_config.trivial_extra}, extra review phrases ${user_config.risky_extra}. If a placeholder is still visible, use 2, `cheap`, learning `on`, and thresholds of 80.

A Haiku phrase match stays on Haiku unless the history file records a similar failure. Then the tier is Sonnet. Anything that is not trivial is Sonnet. Opus is planning, or the ceiling after Sonnet has used its attempts. When the session says `Budget routing: conserve`, do not classify new implementation as Opus. Planning and the ceiling stay Opus.

Reply with one short block:

- Slug
- Tier: `haiku`, `sonnet`, or `opus`
- Agent: `cc-tiers:worker`, `cc-tiers:implementer`, or the Opus orchestrator
- Why, in one line, naming the rule that matched (`trivial`, `history`, `risky`, `budget`, `ceiling`, or the default)
- Review: `checker`, `reviewer`, or `no`, under the current review policy and budget line

If the argument mixes trivial and normal work, return one block per task. Default to Sonnet when the task is not clearly trivial.
