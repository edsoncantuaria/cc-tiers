---
description: Mark a finished task as sent back by you, or undo that mark.
argument-hint: "<slug> [reason] | --undo <slug>"
allowed-tools: Bash(node:*)
---

Run the redo helper with the arguments as given and show what it prints. Do not edit files and do not delegate.

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/redo.mjs" "${CLAUDE_PLUGIN_DATA}" "${CLAUDE_SESSION_ID}" --telemetry '${user_config.telemetry}' --project "${CLAUDE_PROJECT_DIR}" $ARGUMENTS
```

Keep the line as it is, but quote the reason: write it as one single-quoted argument after the slug, with each single quote inside it written as `'\''`, so that a reason like `doesn't work` or `broken (again)` stays valid. For example, the arguments `fix-login doesn't work (again)` end the line with `fix-login 'doesn'\''t work (again)'`. `--undo <slug>` has no reason, and the slug is never quoted.

The slug is the `CC_TIERS_TASK` of the task, as `/cc-tiers:report` lists it. It is looked up in this session first, then in the newest earlier session that has it. The count feeds `/cc-tiers:insights` as "done, then sent back by the user". cc-tiers also counts a prompt that names a done task and complains about it; run `--undo <slug>` when it was not a re-ask. The reason is clipped and redacted before it goes to telemetry, and nothing is sent when telemetry is `off`.
