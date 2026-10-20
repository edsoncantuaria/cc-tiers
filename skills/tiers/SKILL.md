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
- Research: ${user_config.research}
- Specify: ${user_config.specify}
- Learn from Haiku failures: ${user_config.learn}
- 5h conserve threshold: ${user_config.budget_5h}
- 7d conserve threshold: ${user_config.budget_7d}
- Extra Haiku phrases: ${user_config.trivial_extra}
- Extra review phrases: ${user_config.risky_extra}
- Effort ladder: ${user_config.effort_ladder}
- Classifier: ${user_config.classifier}
- Light path: ${user_config.light_path}

If a placeholder is still visible, use 2, `risky`, research `on`, specify `on`, learning `on`, thresholds of 80, no extra phrases, the effort ladder `on`, the classifier `haiku`, and the light path `inline`.

The session-start note is the effective phrase list, the budget line, and the Haiku history line. When it is missing, read `${CLAUDE_PLUGIN_ROOT}/config/routing.default.json` and, if it exists, `${CLAUDE_PROJECT_DIR}/.claude/cc-tiers.json`. A list in the project file (`when`, `keywords`, `reviewWhen`, `reviewKeywords`) replaces that list. `/config` wins for the attempt limit, the review policy, learning, and the budget thresholds. Append the extra phrases.

## Route

| Work | Agent |
| --- | --- |
| Rename, typo, format, lookup, simple search, ~15-line mechanical edit | `cc-tiers:worker` (Haiku) |
| The same shape, when `.claude/cc-tiers-history.json` already recorded a similar Haiku failure and learning is on | `cc-tiers:implementer` (Sonnet) |
| Normal feature, bug fix, test, or local refactor | `cc-tiers:implementer` (Sonnet) |
| Planning, splitting tasks, or the attempt ceiling | Opus orchestrator, in this session |
| The same, when this session is the light-mode `cc-tiers:dispatcher` | `cc-tiers:planner` for the plan, `cc-tiers:architect` for the ceiling (Opus) |
| Research before code goes to the implementer or architect | `cc-tiers:researcher` (Sonnet) |
| Review of Haiku output under `cheap` or `always` | `cc-tiers:checker` (Sonnet) |
| Review of risky, non-trivial, or ceiling work | `cc-tiers:reviewer` (Opus) |

Default to Sonnet when a task is not clearly trivial, and when a trivial-looking task has several steps, many files, or design wording. With the classifier `haiku`, a Haiku pass may refuse a worker call: send the slug to `cc-tiers:implementer`, which is not a failure. With the classifier `local`, add `CC_TIERS_CLASSIFY: skip` to every worker prompt. When the session says `Budget routing: conserve`, do not start a task on Opus. Opus remains the ceiling after Sonnet uses its attempts, and the reviewer for critical work. Split a mixed request into one slug per task (`users-pagination`).

## Attempt rule

A failure is a failed test, a rejected review, or a subagent error; an API or network error is not, and the same tier runs again. With the effort ladder on, a retry at the same tier runs one effort level higher, and the hook sets it on the call; leave `effort` unset or pass a higher level, never a lower one. After ${user_config.max_attempts} failures at one tier (default 2), escalate Haiku to Sonnet, then Sonnet to Opus. Paste every failure note into the next prompt. The new tier starts at zero. The Opus ceiling is `cc-tiers:orchestrator`: do the work in this session when that agent is already the session agent, and delegate to it (no `model` override, failure notes in the prompt) when it is not. If the Opus attempts also fail, stop and report the notes. Do not add a tier above Opus. Conserving budget does not block the ceiling. When you implement at the ceiling in this session, open the attempt with `CC_TIERS_TASK`, `CC_TIERS_TIER: opus`, and `CC_TIERS_ROLE: orchestrator` lines, and close it with the same lines plus `CC_TIERS_STATUS` and `CC_TIERS_REASON`, so the hook counts it.

A hook note that begins `cc-tiers counted a failure` is the counter. Follow its next step. A note that begins `cc-tiers recorded a Haiku failure` means similar later tasks start on Sonnet. A `cc-tiers spend` note is the fresh-token cost of that task when cc-cost is installed. Do not invent one when the session says cc-cost is not installed.

### Research

Before a task goes to `cc-tiers:implementer` or `cc-tiers:architect`, run `cc-tiers:researcher` for it, with the same `CC_TIERS_TASK` slug. Send independent researches in parallel. One research may cover several slugs: add `CC_TIERS_COVERS: <slug>, <slug>` to its prompt, and a pass marks all of them. Before your own attempt at the ceiling, research it too: no hook checks that case.

When the researcher reports `CC_TIERS_STATUS: pass`, paste its entire report, trailer included, between two lines that hold only `CC_TIERS_RESEARCH_BEGIN` and `CC_TIERS_RESEARCH_END`. Put that block under the writer's `CC_TIERS_TASK/TIER/ROLE` header, outside the block, and add `CC_TIERS_RESEARCH: done`. The hook strips the block before it reads headers. If the research fails, fix what it says is missing or use the next option.

Paste the same block, between the same delimiters, into the `cc-tiers:reviewer` or `cc-tiers:checker` prompt for that slug, so the review checks the version the brief names. A retry, or an escalation to the architect or the Opus ceiling, reuses the research: keep the block and the `CC_TIERS_RESEARCH: done` line, and do not research again unless the failure notes show the brief was wrong.

When the task touches no library, framework, or external API, skip the research and add `CC_TIERS_RESEARCH: none - <reason>` instead. Research `off` makes the hook skip the check; `cc-tiers:worker` needs none. If the hook refuses a delegation for missing research, run the researcher or add the `none` line, as the refusal says.

### Specify

Flow: research, specify, ask (only if needed), implement, review. Write the acceptance criteria yourself from the request and the research; the user should not have to. Put this block in the message that delegates the task, as lines that hold only the delimiters:

```
CC_TIERS_SPEC_BEGIN
Criteria:
- <observable result> (request)
Edge cases:
- <input or state that could break it> (repo: file:line)
Assumed:
- <what you chose where the request was silent> (decided: <why>)
CC_TIERS_SPEC_END
```

Keep it under about 15 lines, and omit `Assumed:` when nothing was assumed. Every line says where it came from: `(request)`, `(repo: file:line)`, `(docs: <link or path>)`, `(decided: <why>)`, or `(user)` for an answer. A block with only headings is refused. The hook strips the block before it reads headers, like the research block.

Ask the user only when two reasonable readings lead to different code and neither the project nor the docs of the version in use decide. Do not ask what the repo, the research, or a sensible default settles. Ask once, before any implementing, with every question together and at most 3. Use `AskUserQuestion` as multiple choice, the recommended option first, with the reason in its label. Tag each answer `(user)` in the block. Only the main session can call `AskUserQuestion`; a subagent cannot, so never tell one to ask.

When no human can answer (the tool is unavailable or denied; in a non-interactive run nothing tells you, the call is simply denied), take the recommended option, list it under `Assumed:`, say so in the final report, and do not wait.

Paste the block under the writer's `CC_TIERS_TASK/TIER/ROLE` header, outside the research block. Paste the same block into the `cc-tiers:reviewer` or `cc-tiers:checker` prompt for that slug, so the review judges the same criteria. A retry, or an escalation to the architect or the Opus ceiling, reuses the block; fix a criterion only when the failure notes show it was wrong, and say so in the block.

When a task needs no criteria (a mechanical edit, a lookup), add `CC_TIERS_SPEC: none - <reason>` instead, on its own line under the delegation header, outside both blocks. Before your own attempt at the ceiling, write the block in your own message before the first edit: no hook checks it. `cc-tiers:worker` needs none, and the light path skips this step. The live setting `Specify: ${user_config.specify}` (fallback `on`) says whether it is on: `off` makes the hook skip the check. If the hook refuses a delegation, it says `cc-tiers: write the acceptance criteria for <task> between CC_TIERS_SPEC_BEGIN and CC_TIERS_SPEC_END before delegating it, or add CC_TIERS_SPEC: none - <reason>.` Write the block, or add the `none` line, and delegate again.

Start every delegation with:

```
CC_TIERS_TASK: <slug>
CC_TIERS_TIER: haiku|sonnet|opus
CC_TIERS_ROLE: worker|implementer|architect|checker|reviewer|researcher
```

Tell the worker or implementer to set `CC_TIERS_REVIEW: pending` when a review is coming, otherwise `skip`. The checker and the reviewer set `CC_TIERS_TIER` to the tier that wrote the diff.

Review policy `cheap` sends Haiku output to `cc-tiers:checker` and sends Opus review only for a review-phrase match or the ceiling. `risky` skips a trivial Haiku pass and sends other finished work to `cc-tiers:reviewer`. `always` reviews every pass, Haiku on Sonnet and the rest on Opus. `never` skips review. While conserving, skip Opus review unless the result is critical.

## Close

Tell the user the slug, the tier that finished it, whether it escalated, who reviewed it, and the spend and cost lines when the hook reported them. `/cc-tiers:report` prints the whole session as a table. Keep the failure notes only when the task is still open.
