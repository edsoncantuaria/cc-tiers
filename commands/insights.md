---
description: Show what the cc-tiers telemetry says about failures, escalations, estimated cost and unverified gates.
argument-hint: "[--sessions <dir>]"
allowed-tools: Bash(node:*)
---

Run the insights helper and show its tables. Do not edit files and do not delegate.

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/insights.mjs" "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS
```

`--sessions <dir>` builds the Real use section from the `session-*.json` files in that folder (only that folder) instead of the data dir. Print the tables as they come back, including "Routing in hindsight" (how each start tier fared), "Failure research by match" (how the failure searches ended) and the "Real use" section (how cc-tiers behaved on real sessions, with anonymous project rows, and its "Not measured" line) when they appear. All are descriptive and give no advice. Then add at most three short lines: the most common failure category, the most common escalation reason, and which risk level cost the most. Costs are estimates from token counts, never billed amounts. If the sample is small, say so and do not suggest routing changes. Never claim what plain Opus would have cost: the Opus-rate column prices the same tokens and is not a counterfactual. Never change config or routing rules from this output.
