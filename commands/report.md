---
description: Show what cc-tiers routed this session, per task, with the estimated cost next to Opus rates.
argument-hint: "[--all]"
allowed-tools: Bash(node:*)
---

Run the report helper and show its table. Do not edit files and do not delegate.

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/report.mjs" "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS
```

`--all` adds every session cc-tiers still keeps (the last 20). Print the table as it comes back. Then add at most three short lines: which task cost the most, any task that escalated or stopped, and the total next to Opus rates. Keep the caveat that the cost is an estimate at API list prices, not what a subscription is billed.
