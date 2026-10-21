---
description: Show what the cc-tiers telemetry says about failures, escalations, estimated cost and unverified gates.
allowed-tools: Bash(node:*)
---

Run the insights helper and show its tables. Do not edit files and do not delegate.

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/insights.mjs" "${CLAUDE_PLUGIN_DATA}"
```

Print the tables as they come back. Then add at most three short lines: the most common failure category, the most common escalation reason, and which risk level cost the most. Costs are estimates from token counts, never billed amounts. If the sample is small, say so and do not suggest routing changes. Never change config or routing rules from this output.
