---
description: Move a task up one tier and carry its failure notes into the next attempt.
argument-hint: "[task-slug]"
---

Escalate `$ARGUMENTS` by one tier. If the argument is empty, escalate the task the conversation is already on.

Order is fixed: Haiku (`cc-tiers:worker`) to Sonnet (`cc-tiers:implementer`) to Opus (the orchestrator implements it). Opus is the last tier. If the task is already on Opus, stop and report the notes instead of delegating.

The attempt limit is ${user_config.max_attempts} (default 2). Escalating early is allowed when the user asks for it. Say that the user asked, and still carry the failure notes. A conserve line from budget routing does not block this escalation: Opus is the ceiling.

Look for a `cc-tiers counted a failure` note in the conversation. If you need the stored counter, read `${CLAUDE_PLUGIN_DATA}/latest.json` and use the entry for this slug. Include every failure note, and any carried notes, in the next delegation prompt. The new tier starts at zero.

Start the prompt with:

```
CC_TIERS_TASK: <slug>
CC_TIERS_TIER: <new tier>
CC_TIERS_ROLE: worker|implementer
```

Delegating to the higher tier moves the stored counter up with the notes carried; the hook says so. Do not pass a `model` argument. Run the agent in the foreground. If the new tier is Opus and this session is already `cc-tiers:orchestrator`, do the work here. If it is not, delegate to `cc-tiers:orchestrator` with the failure notes in the prompt.
