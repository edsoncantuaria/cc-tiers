---
description: Classify a task as Haiku, Sonnet, or Opus without doing the work.
argument-hint: "[task]"
---

Classify `$ARGUMENTS` under the cc-tiers rules. Do not edit files and do not delegate.

Read the session routing summary if it is present. Otherwise read `${CLAUDE_PLUGIN_ROOT}/config/routing.default.json` and `${CLAUDE_PROJECT_DIR}/.claude/cc-tiers.json` when that file exists. Live settings: max attempts ${user_config.max_attempts}, review policy ${user_config.review_policy}, extra Haiku phrases ${user_config.trivial_extra}, extra review phrases ${user_config.risky_extra}. If a placeholder is still visible, use 2 and `risky`.

Reply with one short block:

- Slug
- Tier: `haiku`, `sonnet`, or `opus`
- Agent: `cc-tiers:worker`, `cc-tiers:implementer`, or the Opus orchestrator
- Why, in one line, naming the rule that matched
- Review: `yes` or `no`, under the current review policy

If the argument mixes trivial and normal work, return one block per task. Default to Sonnet when the task is not clearly trivial.
