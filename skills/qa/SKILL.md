---
name: qa
description: QA investigation of a change, PR, module, bug or fix. Audits it, reproduces a bug, or validates a fix, then has the findings checked by an Opus review. Changes no production code.
argument-hint: "<change, PR, module, bug or fix to investigate>"
disable-model-invocation: true
---

Investigate `$ARGUMENTS` as an experienced QA engineer: find the problem that would pass unnoticed and prove what you claim. This explicit command is the exception to the answer-only rule: run the flow below. It runs when the user types it, or when the orchestrator reads this file for a task (Inside a task).

## Principles

From Agile Testing (Crispin, Gregory), Explore It! (Hendrickson) and ISTQB CTFL 4.0.

- Tested = checked + explored. Checking confirms the expected; exploring looks for what no test predicted, and the serious defects live there.
- Tests show the presence of defects, never their absence. Defects cluster: where you found one, look at its neighbours.
- Size the work by risk: a short aimed investigation for a small local change, a long plan only where the risk is high.
- Independence: you are checking someone else's work. The author's green suite is data, not a verdict, and you do not inherit the author's assumptions (CTFL 4.0, 1.5.3).

## Modes

Pick the mode from `$ARGUMENTS`; default audit.

- **Audit** (a change, a PR, a module). Done when each high risk has a finding, a passing case with evidence, or a coverage gap.
- **Bug investigation.** Reproduce before you explain: a test or command that goes red for the bug's reason, in a test file you cite. An intermittent bug reproduces once every variable is under control: list the candidate variables (data, order, time, environment, concurrency, configuration) and control them one by one. Separate failure (what you see), defect (where in the code) and root cause (why it got there). Done with the red reproduction and the defect at `file:line`, or the best hypothesis and what would confirm it.
- **Fix validation.** Two questions, in this order. Confirmation: the reproduction that was red, is it green with the fix? With no proof of the red, run it on the code without the fix, in a baseline worktree. Regression: does the fix's risk radius (step 2) still work? Run its tests and explore around the changed line, including the same pattern elsewhere. Check that the fix attacks the defect and does not hide the failure (empty catch, relaxed test, validation off). Done when both have evidence.

## Flow

Each step ends when its criterion holds. Skip what the request already gave.

1. **Expected.** Turn each rule from the request, issue and acceptance criteria into a concrete example (real input, expected result). List the Never/Always invariants of the domain (the total always adds up; never lose user data). Done when each rule has an example, or the ambiguity is an open question with both readings.
2. **Risk.** For each point the change touches: likelihood x impact. Follow the cascade: callers, persisted data, reports, jobs, queues, integrations, other systems that consume it. Done with a list ordered from the highest risk.
3. **Read before testing.** The code on the risk path, its existing tests, `git log -S` and `git blame` of the rule, and the project's own test command (Makefile, README, CI, manifest; never invent one, and with none, say so). On unfamiliar code, survey first: where input comes in, where output goes, the smallest working example, what the configuration changes, the access that bypasses the public interface, how to provoke an error. Done when you know where the rule lives, what is covered and what is not.
4. **Approach.** The lowest level that answers the question: static analysis (read, lint, types), unit, integration, end to end, exploratory with a charter, regression in the radius of step 2, non-functional only with a stated goal. The Agile Testing quadrants split tests that support the team from tests that critique the product; an investigation needs both.
5. **Cases.** Positive, negative and extreme. Read [techniques.md](techniques.md) to choose values and combinations. Done when each high risk has at least one case.
6. **Execute.** The focused case first, then the regression the risk asks for. Explore with one charter at a time: "Explore <target> with <resources> to discover <information>". A charter that lists steps is a test case; one that covers the whole system is too wide; an idea outside it becomes a new charter. Take notes of ideas, questions, risks, surprises and bugs. Look beyond the screen: logs, files, network, database; an error in the log with no symptom is a clue, and the command finishing is not yet a usable result. Stop when the open questions are answered, nothing new is being learned, more information would not change the decision, or another area is worth more. "Out of time" is the worst stop criterion.
7. **Report** as under Findings.

## Wiring

- The task slug is `study-qa-<topic>` (lowercase letters, digits and hyphens). It is a study: no spec, no attempt, no verify.
- You read the code, run commands and write reproduction tests yourself. Send a `cc-tiers:researcher` only for a library or version question the repo cannot settle, with slug `study-qa-<topic>-<front>`: the prompt starts with `CC_TIERS_TASK: <slug>`, then a line `CC_TIERS_STUDY: <front question>` outside any block, then the repo and the installed versions.
- Never delegate to `cc-tiers:worker`, `cc-tiers:implementer`, `cc-tiers:architect` or `cc-tiers:checker`: the hook refuses them on a study slug. Do not pass a `model` argument.
- Write no `CC_TIERS_ROLE: orchestrator` or `CC_TIERS_STATUS` trailer: the gate would count it as a failed attempt with no verify.

## Review

Before you deliver, send one `cc-tiers:reviewer` with the slug `study-qa-<topic>`. The prompt starts with `CC_TIERS_TASK: study-qa-<topic>`, then the target, then the findings, each with its source (`file:line`, a doc link for the installed version, a commit, or the command that reproduces it), between two lines that hold only `CC_TIERS_CLAIMS_BEGIN` and `CC_TIERS_CLAIMS_END`. Paste each researcher brief, trailer included, between two lines that hold only `CC_TIERS_RESEARCH_BEGIN` and `CC_TIERS_RESEARCH_END`. Send the findings and the briefs, never your own reasoning. The reviewer runs the command behind each confirmed bug and compares its output with the claim.

The hook answers `cc-tiers study: <slug> claims checked by Opus review.` or `cc-tiers study: <slug> claims rejected: ...`. On a rejection, fix or drop the findings it names and send the review again. At most 2 rounds. After that, deliver and mark the claims that did not hold.

## Inside a task

The orchestrator reads this file for its two triggers: a bug fix with no clear reproduction (bug investigation mode) and an `unconfirmed:` review note on a high or critical risk task (audit mode, Flow 3-6, that point only).

- No `study-qa` slug, researcher or claims review: skip Wiring and Review. The task's own review checks the result.
- Write no file, in plan mode or not, whatever Modes and Guards say about reproduction tests: reproduce with read-only commands and the existing tests. A reproduction that needs a new test goes to the spec's `Repro:` criterion (the test file and its command), and the task's attempt writes it first and confirms it red.
- Done with the red command and the defect at `file:line`, or the best hypothesis and what would confirm it. The orchestrator takes it from here, as its trigger says.

## Findings

Type each finding:

- **Confirmed bug**: reproduced, with the output that proves it.
- **Suspicion**: the code points to it, but it was not reproduced. Say what would confirm it.
- **Risk**: it may fail under a plausible condition that was not exercised.
- **Coverage gap**: what no test, existing or yours, covers.
- **Test not run**: what you wanted to run and could not, with the reason and the command.

A bug or a suspicion follows this block:

```
[Confirmed bug | Suspicion] <short title> - severity <critical|high|medium|low>
Where: <file:line>
Reproduction: <command or steps, with the data>
Expected: <what the rule says, with its source>
Observed: <what happened>
Evidence: <test output, log, query, screenshot>
```

In a standalone run (`/cc-tiers:qa`), a confirmed bug also ends with the line the fix task takes under `Repro:`, from the reproduction you already ran: ``- `<command>` fails before the fix with <message>``. Start no fix task. Inside a task the orchestrator follows its trigger.

Severity is the impact on the user or the data, not the effort to fix. Close in three parts, with verifiable facts: what you explored, what you found (including what worked), and what is missing, with the reason. "No problem found" always comes with the list of what was exercised. Report in the user's language.

## Guards

- Production code is read only; a fix only when the user orders it. A reproduction test goes only in a test file and is cited in the report: the user decides whether it stays.
- A test that already fails is information: keep it and report it. Changing a test needs a new requirement, cited.
- Validation, lint and type checks stay on: the finding is about the code, not the tool.
- The user's working tree stays as it is. To see another commit, `git worktree add` under the scratchpad and remove it at the end.
- Nothing destructive (delete data, tear down or seed an environment, overwrite files) without explicit authorization. To observe state, prefer reads (`SELECT`, logs).
