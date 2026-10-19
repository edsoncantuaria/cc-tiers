---
name: tiers
description: "Route a code change across Haiku, Sonnet, and Opus. Use when the user asks to implement, fix, refactor, rename, format, look up, or review code."
argument-hint: "[task]"
when_to_use: "The user wants a feature, bug fix, rename, formatting pass, code lookup, or review."
---

# cc-tiers

Run the tiered workflow for `$ARGUMENTS`. If that is empty, use the user's latest request.

You are coordinating, even if this session is not already the Opus orchestrator. Delegate with the Agent tool to the agents below. Do not pass a `model` argument; each agent file pins its model, and the cc-tiers hook refuses a call that overrides it. Prefer the foreground; a background run is counted when it finishes.

## Live settings

- Max attempts per tier: ${user_config.max_attempts}
- Review policy: ${user_config.review_policy}
- Learn from Haiku failures: ${user_config.learn}
- 5h conserve threshold: ${user_config.budget_5h}
- 7d conserve threshold: ${user_config.budget_7d}
- Extra Haiku phrases: ${user_config.trivial_extra}
- Extra review phrases: ${user_config.risky_extra}

If a placeholder is still visible, use 2, `cheap`, learning `on`, thresholds of 80, and no extra phrases.

The session-start note is the effective phrase list, the budget line, and the Haiku history line. When it is missing, read `${CLAUDE_PLUGIN_ROOT}/config/routing.default.json` and, if it exists, `${CLAUDE_PROJECT_DIR}/.claude/cc-tiers.json`. A list in the project file (`when`, `keywords`, `reviewWhen`, `reviewKeywords`) replaces that list. `/config` wins for the attempt limit, the review policy, learning, and the budget thresholds. Append the extra phrases.

## Route

| Work | Agent |
| --- | --- |
| Rename, typo, format, lookup, simple search, ~15-line mechanical edit | `cc-tiers:worker` (Haiku) |
| The same shape, when `.claude/cc-tiers-history.json` already recorded a similar Haiku failure and learning is on | `cc-tiers:implementer` (Sonnet) |
| Normal feature, bug fix, test, or local refactor | `cc-tiers:implementer` (Sonnet) |
| Planning, splitting tasks, or the attempt ceiling | Opus orchestrator, in this session |
| Review of Haiku output under `cheap` or `always` | `cc-tiers:checker` (Sonnet) |
| Review of risky, non-trivial, or ceiling work | `cc-tiers:reviewer` (Opus) |

Default to Sonnet when a task is not clearly trivial. When the session says `Budget routing: conserve`, do not start a task on Opus. Opus remains the ceiling after Sonnet uses its attempts, and the reviewer for critical work. Split a mixed request into one slug per task (`users-pagination`).

## Attempt rule

A failure is a failed test, a rejected review, or a subagent error. After ${user_config.max_attempts} failures at one tier (default 2), escalate Haiku to Sonnet, then Sonnet to Opus. Paste every failure note into the next prompt. The new tier starts at zero. The Opus ceiling is `cc-tiers:orchestrator`: do the work in this session when that agent is already the session agent, and delegate to it (no `model` override, failure notes in the prompt) when it is not. If the Opus attempts also fail, stop and report the notes. Do not add a tier above Opus. Conserving budget does not block the ceiling. When you implement at the ceiling in this session, open the attempt with `CC_TIERS_TASK`, `CC_TIERS_TIER: opus`, and `CC_TIERS_ROLE: orchestrator` lines, and close it with the same lines plus `CC_TIERS_STATUS` and `CC_TIERS_REASON`, so the hook counts it.

A hook note that begins `cc-tiers counted a failure` is the counter. Follow its next step. A note that begins `cc-tiers recorded a Haiku failure` means similar later tasks start on Sonnet. A `cc-tiers spend` note is the fresh-token cost of that task when cc-cost is installed. Do not invent one when the session says cc-cost is not installed.

Start every delegation with:

```
CC_TIERS_TASK: <slug>
CC_TIERS_TIER: haiku|sonnet
CC_TIERS_ROLE: worker|implementer|checker|reviewer
```

Tell the worker or implementer to set `CC_TIERS_REVIEW: pending` when a review is coming, otherwise `skip`. The checker and the reviewer set `CC_TIERS_TIER` to the tier that wrote the diff.

Review policy `cheap` sends Haiku output to `cc-tiers:checker` and sends Opus review only for a review-phrase match or the ceiling. `risky` skips a trivial Haiku pass and sends other finished work to `cc-tiers:reviewer`. `always` reviews every pass, Haiku on Sonnet and the rest on Opus. `never` skips review. While conserving, skip Opus review unless the result is critical.

## Close

Tell the user the slug, the tier that finished it, whether it escalated, who reviewed it, and the spend line when the hook reported one. Keep the failure notes only when the task is still open.
