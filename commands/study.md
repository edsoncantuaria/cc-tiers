---
description: Study a system, a feasibility question or a set of requirements with researchers and an Opus review of the claims. Changes no code.
argument-hint: "<question>"
---

Study `$ARGUMENTS`: understand a system, judge feasibility, or gather requirements. This explicit command is the exception to the answer-only rule: run the flow below even though it changes no code. It runs only when the user types it.

Never edit a file. Never delegate to `cc-tiers:worker`, `cc-tiers:implementer`, `cc-tiers:architect` or `cc-tiers:checker`. A study is not a code task: it has no spec, no attempt and no verify. Do not pass a `model` argument.

1. Split the question into 2 to 5 fronts, each a part that can be answered on its own (a subsystem, a library, a constraint). Give each front a slug `study-<topic>-<front>` of lowercase letters, digits and hyphens. Say the fronts in one short list.
2. Send one `cc-tiers:researcher` per front, all in parallel and in the foreground. Each prompt starts with `CC_TIERS_TASK: <slug>`, then a line `CC_TIERS_STUDY: <front question>` outside any block, then the repo, the installed versions and anything else you already know.
3. Synthesize what the researchers report, in this order: the answer; numbered claims, each with its source (`file:line`, a doc link for the installed version, or a commit); contradictions between fronts; unknowns and risks; a feasibility verdict when the user asked for one. Add next steps only when they help, as code tasks with seed criteria for the normal flow. Do not run them.
4. Send one `cc-tiers:reviewer`, once for the whole study, with the slug `study-<topic>`. The prompt starts with `CC_TIERS_TASK: study-<topic>`, then the question, then the synthesized claims between two lines that hold only `CC_TIERS_CLAIMS_BEGIN` and `CC_TIERS_CLAIMS_END`. Paste each researcher brief, trailer included, between two lines that hold only `CC_TIERS_RESEARCH_BEGIN` and `CC_TIERS_RESEARCH_END`: a brief pasted outside a block would replace the reviewer's task header. Send the claims and the briefs, never your own reasoning.
5. The hook answers with `cc-tiers study: <slug> claims checked by Opus review.` or `cc-tiers study: <slug> claims rejected: ...`. On a rejection, fix the claims the findings name (drop a claim, correct it, or cite a better source) and send the review again. At most 2 rounds. After that, deliver and mark which claims did not hold.
6. Deliver in the chat: the synthesis with its sources, and what the review confirmed or rejected. When the study is for other people, offer to publish it as a document.

Write no `CC_TIERS_ROLE: orchestrator` or `CC_TIERS_STATUS` trailer for the study: the gate would count it as a failed attempt with no verify. The hook sets the session title `Study: <question>` on its own.
