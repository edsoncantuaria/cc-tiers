---
name: tiers
description: "Route a code change across Haiku, Sonnet, and Opus. Use when the user asks to implement, fix, refactor, rename, format, look up, or review code."
argument-hint: "[task]"
when_to_use: "The user wants a feature, bug fix, rename, formatting pass, code lookup, or review."
---

# cc-tiers

Run the tiered workflow for `$ARGUMENTS`. If that is empty, use the user's latest request.

You are coordinating, even if this session is not already the Opus orchestrator. Delegate with the Agent tool to the agents below. Do not pass a `model` argument; each agent file pins its model. Run them in the foreground.

## Live settings

- Max attempts per tier: ${user_config.max_attempts}
- Review policy: ${user_config.review_policy}
- Extra Haiku phrases: ${user_config.trivial_extra}
- Extra review phrases: ${user_config.risky_extra}

If a placeholder is still visible, use 2, `risky`, and no extra phrases.

The session-start note is the effective phrase list. When it is missing, read `${CLAUDE_PLUGIN_ROOT}/config/routing.default.json` and, if it exists, `${CLAUDE_PROJECT_DIR}/.claude/cc-tiers.json`. A list in the project file replaces that list. `/config` wins for the attempt limit and the review policy. Append the extra phrases.

## Route

| Work | Agent |
| --- | --- |
| Rename, typo, format, lookup, simple search, ~15-line mechanical edit | `cc-tiers:worker` (Haiku) |
| Normal feature, bug fix, test, or local refactor | `cc-tiers:implementer` (Sonnet) |
| Planning, splitting tasks, or the attempt ceiling | Opus orchestrator, in this session |
| Review of a non-trivial or risky result | `cc-tiers:reviewer` (Opus) |

Default to Sonnet when a task is not clearly trivial. Split a mixed request into one slug per task (`users-pagination`).

## Attempt rule

A failure is a failed test, a rejected review, or a subagent error. After ${user_config.max_attempts} failures at one tier (default 2), escalate Haiku to Sonnet, then Sonnet to Opus. Paste every failure note into the next prompt. The new tier starts at zero. At Opus, implement the ceiling yourself; if those attempts also fail, stop and report the notes. Do not add a tier above Opus.

A hook note that begins `cc-tiers counted a failure` is the counter. Follow its next step.

Start every delegation with:

```
CC_TIERS_TASK: <slug>
CC_TIERS_TIER: haiku|sonnet
CC_TIERS_ROLE: worker|implementer|reviewer
```

Tell the worker or implementer to set `CC_TIERS_REVIEW: pending` when a review is coming, otherwise `skip`. The reviewer sets `CC_TIERS_TIER` to the tier that wrote the diff.

Review policy `risky` reviews public contracts, auth, payments, migrations, security, concurrency, large diffs, and anything non-trivial. Skip it for a trivial Haiku pass. `always` reviews every pass. `never` skips review.

## Close

Tell the user the slug, the tier that finished it, and whether it escalated. Keep the failure notes only when the task is still open.
