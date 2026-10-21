# 🎚️ cc-tiers

### Opus plans, reviews, and builds the hard parts. Sonnet builds the rest. Haiku does the small stuff.

A Claude Code plugin for Pro and Max subscribers who want work done right the first time. The point is your time and the code, not tokens. You make a short request and do not write the spec: cc-tiers researches the project and writes the acceptance criteria itself. The code follows the docs of the version you have installed and the conventions of your own project, reuses what already exists, and stays inside the task, without you asking for clean code or writing rules for it. The hooks re-run the tests before a pass counts, and a review counts only with a reproduced defect, so you do not have to ask again. Each task goes to the model it needs: Haiku for the simple stuff, Sonnet for normal work, Opus to plan, review, build the hard tasks (auth, payments, migrations, concurrency, architecture), and take what Sonnet could not finish, so Opus is not spent on a typo. On the clock a run takes longer than plain Opus; the [benchmark](#-benchmark) measures whether the result is better.

[![Claude Code](https://img.shields.io/badge/Claude_Code-2.1.295%2B-d97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://claude.com/claude-code)
[![Plugin](https://img.shields.io/badge/type-plugin-8a63d2?style=for-the-badge)](#-install)
[![License: MIT](https://img.shields.io/badge/license-MIT-2f81f7?style=for-the-badge)](LICENSE)

**English** · [Português](README.pt-BR.md)

🔬 research before code  •  🧐 independent review  •  🪜 more effort before a bigger model  •  🔁 two failures, then escalate  •  📏 quality measured  •  ✅ tests re-run by the hook  •  ♻️ reuse before writing

---

## 🚀 Install

At the prompt of a Claude Code session, once this repo is the marketplace `edsoncantuaria/cc-tiers`:

```
/plugin install cc-tiers --marketplace edsoncantuaria/cc-tiers
```

> [!TIP]
> Answer `y` to add the marketplace, then pick a scope. The next session starts on the Opus orchestrator — nothing else to install.

To try a local checkout without publishing:

```bash
git clone https://github.com/edsoncantuaria/cc-tiers
claude --plugin-dir /path/to/cc-tiers
```

---

## 🔎 Who does what

| Tier | Agent | Model | Does |
| :-: | --- | --- | --- |
| Plan | `cc-tiers:orchestrator` | Opus | Splits the request, delegates, and implements hard tasks and the ceiling |
| Research | `cc-tiers:researcher` | Sonnet | Finds the installed version, that version's docs, existing usage, reusable code, and conventions before code is written. Does not edit |
| Default | `cc-tiers:implementer` | Sonnet | Features, bug fixes, tests, local refactors |
| Trivial | `cc-tiers:worker` | Haiku | Renames, typos, formatting, lookups, simple searches, ~15-line edits |
| Check | `cc-tiers:checker` | Sonnet | A fresh pass over Haiku's output. Does not edit |
| Review | `cc-tiers:reviewer` | Opus | A fresh pass over risky or non-trivial work. Does not edit |
| Light mode | `cc-tiers:dispatcher` | Sonnet | Optional session agent for when the window is tight: it routes on Sonnet and calls Opus only when needed |
| Light plan | `cc-tiers:planner` | Opus | Plans a multi-task request for the dispatcher. Does not edit |
| Light ceiling | `cc-tiers:architect` | Opus | Implements hard tasks and the ceiling for the dispatcher |

While the plugin is enabled, `settings.json` sets the session agent to `orchestrator`. Your own `agent` in `~/.claude/settings.json` still wins. If you override it, `/cc-tiers:tiers` runs the same workflow.

The agents pin `model: haiku`, `sonnet`, or `opus`. The orchestrator does not pass a model on the call, because a per-call override would replace the tier. A PreToolUse hook refuses a cc-tiers delegation that tries.

```mermaid
flowchart LR
    A[Opus orchestrator] --> B{Task}
    B -- trivial --> C[Haiku worker]
    B -- normal or hard --> R[Sonnet researcher]
    R -- brief --> D[Sonnet implementer]
    R -- brief, hard --> E
    C -- fail twice --> D
    D -- fail twice --> E[Opus implements]
    C -- pass --> V{Verify gate}
    D -- pass --> V
    E -- pass --> V
    V -- command fails --> C
    V -- command fails --> D
    V -- verified --> H[Sonnet checker]
    V -- verified, risky --> F[Opus reviewer]
    H -- reject --> C
    F -- reject --> D
    H -- approve --> G[Done]
    F -- approve --> G
```

---

## 🔬 Research first

Code written from memory of an old API version fails in ways a test does not always catch. Before a task goes to `cc-tiers:implementer` or `cc-tiers:architect`, `cc-tiers:researcher` (Sonnet, read-only) checks these:

- The version in use, read from the lock file first and the manifest second.
- The docs of that version, from `vendor/` or `node_modules/` when installed, never the docs of the latest release by default.
- How that version's docs recommend doing the task, and what they mark deprecated.
- How the repo already calls the API, as `file:line`.
- Reuse: code the repo already has that does all or part of the task, as `file:line`.
- Conventions: one or two nearby snippets to follow (naming, error handling, test style, comment density).
- Prior art outside the repo, only when it applies.

It returns a brief of under about 40 lines in three blocks, **Version and docs**, **In the repo** (usage, Reuse, Conventions), and **Outside the repo**, with a source for every fact. The orchestrator pastes the whole report, trailer included, into the writer's prompt between two lines that hold only `CC_TIERS_RESEARCH_BEGIN` and `CC_TIERS_RESEARCH_END`, and adds `CC_TIERS_RESEARCH: done`. A task that touches no library, framework, or external API says why instead: `CC_TIERS_RESEARCH: none - <reason>`. One brief can serve several tasks: the researcher's prompt carries `CC_TIERS_COVERS: <slug>, <slug>`, and a pass marks all of them.

The PreToolUse hook enforces this. It refuses a call to the implementer or the architect that has neither a finished research for that task nor a `none` line. A research is not an attempt, and a failed research does not count against the task. The worker is exempt. The Opus ceiling and the dispatcher's own task are researched by prompt, with no hook check. `research: off` removes the step and the check.

---

## 🧹 Clean code without asking

The writers carry these rules, so a project needs no CLAUDE.md rules for them:

- Reuse or extend what exists, never fork it. The brief's Reuse block says where to look.
- Follow the docs of the installed version, and the conventions of the file being edited.
- Touch only what the task needs: no drive-by refactor, reformat, rename, or dependency bump.
- No hypothetical protection: retry, cache, fallback, or compatibility only when something real consumes it.
- Comments only for what the code cannot say.
- Stop when it is verified. No extra passes.

The reviewer blocks code that recreates what the project already has, and changes outside the task (both `scope` findings). Hypothetical protection, style, comment noise, and naming taste are notes: they reach the final report and never fail a task.

---

## 📝 Specify and ask

Research says what is true; the criteria say what done means. Before a task that writes code goes to `cc-tiers:implementer` or `cc-tiers:architect`, the orchestrator (or the dispatcher) writes the acceptance criteria itself, from the request and the research, so you do not have to. The flow is research, specify, ask (only if needed), implement, review.

The criteria ride in the delegation prompt between two lines that hold only `CC_TIERS_SPEC_BEGIN` and `CC_TIERS_SPEC_END`, in under about 15 lines:

- `Criteria:` observable results.
- `Edge cases:` inputs or states that could break it.
- `Assumed:` (only when needed) what was chosen where the request was silent.

Every line says where it came from: `(request)`, `(repo: file:line)`, `(docs: <link or path>)`, `(decided: <why>)`, or `(user)` for an answer. The same block goes to the implementer and to the reviewer or checker of that task. The implementer builds and tests each line, and the reviewer rejects a criterion or edge case that is not met or not tested. A retry or an escalation reuses the block.

**When it asks.** Only when two reasonable readings lead to different code and neither the project nor the docs of the version in use decide. Everything else it decides and marks `(decided: ...)`. It asks once, before implementing, all questions together, at most 3, with `AskUserQuestion` as multiple choice and the recommended option first, with its reason. Your answer goes into the block as `(user)`.

**When nobody can answer.** If `AskUserQuestion` is unavailable or denied, it takes the recommended option, lists it under `Assumed:`, says so in the final report, and does not wait.

A task that needs no criteria (a mechanical edit, a lookup) says why with `CC_TIERS_SPEC: none - <reason>`. The light path and the worker skip this step. The PreToolUse hook refuses a call to the implementer or the architect that has neither a block with content nor a `none` line, and it ignores a `CC_TIERS_*` line inside the block. `specify: off` removes the step and the check.

---

## ✅ Verify

A `pass` used to be the agent's word. With the gate, the hook runs the check itself. Every report from a writer (worker, implementer, architect, the Opus ceiling, the dispatcher's own task) lists the commands that prove the work, one per line, before the status:

```
CC_TIERS_VERIFY: node --test test/booking.test.mjs
CC_TIERS_VERIFY: npx tsc --noEmit
CC_TIERS_STATUS: pass
```

When nothing can verify the change (a device write, a screen checked by hand), the report says so: `CC_TIERS_VERIFY: none - <reason>`. The command is the one focused on the area touched, the same one the writer ran, not the whole project.

**What the hook runs.** Only when the report is `pass`. It runs each command as argv, without a shell, in the project directory. A line with any of `` ; | & > < ` $ ( ) `` or a line break is refused, and on Windows also `% ! ^`. So is a line that carries code instead of naming a repo test: a `data:` or `javascript:` URL anywhere, or, after the program, a flag that loads or evaluates code (`--import`, `--require`, `-r`, `--loader`, `--experimental-loader`, `-e`, `--eval`, `-p`, `--print`, `--script-shell`, `--node-options`, `--userconfig`, `--globalconfig`, also abbreviated, as npm expands them, and as `--flag=value`). That refuses `node -p` and `pytest -p` too. Two forms are read by the hook itself: `KEY=value` at the start becomes an environment variable (`APP_ENV=testing vendor/bin/phpunit`), and `cd <dir> && <command>` runs in `<dir>`, which must be relative and inside the project, symlinks resolved. Keys that change which program runs or load code first are refused, in any case: `PATH`, `PATHEXT`, `LD_*`, `DYLD_*`, `NODE_OPTIONS`, `NODE_PATH`, `npm_config_*`, `PYTHONPATH`, `PYTHONSTARTUP`, `PYTHONHOME`, `BASH_ENV`, `ENV`, `PERL5OPT`, `PERL5LIB`, `RUBYOPT`, `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`, `PHPRC`, `PHP_INI_SCAN_DIR`. The allow list is checked on what is left.

**Allow list.** `verify_allow` is a comma-separated list of prefixes, compared on whole words: `npm test` matches `npm test -- x`, not `npm testx`. The default covers `npm test`, `node --test`, `npx tsc`, `npx eslint`, `npx vitest`, `npx jest`, `npx playwright test`, PHPUnit, PHPStan, PHPCS, `pytest`, `go test`, and `cargo test`. `docker exec` is off by default, because with it any command runs inside the container. If you use it, for example on a PHP project in Docker, add `docker exec` in `/config`. The list limits the shape of the command, not what a test executes: a test is repository code, and the agent can already write code.

**Outcomes.**

- A command that exits non-zero runs once more. Passing the second time is a pass, reported as `flaky`. Failing twice is a failure, and the note for the next attempt carries the command, the exit code, and the last 40 lines of output. When the budget leaves no time for the second run, or cuts it short, the first failure stands.
- A command that hits `verify_timeout` (default 300 s) counts as a failure: a test that hangs is a defect or a broken environment, and either way the pass is not valid.
- `verify_budget` (default 600 s) caps the whole report, retries included. At Stop it caps all the parked passes together, so they fit the hook timeout. Commands past it do not run and are listed as not validated. That is not a failure, so a slow suite does not push the task up to Opus.
- A failure stops the commands after it.
- A command outside the list, a `none` line, or a refused line is **not validated**: nothing runs and it is not a failure. The message says which prefix to add in `/config`.
- A command that cannot start (the program is not installed, the file is not found) is **not validated** too: `could not start: <command>`. Nothing ran, so it says nothing about the code and is not a failure.
- A command that already passed on the same tree (same `HEAD`, same content in every changed file) is not run again: the report says `reused for the same tree`.
- A `pass` with no `CC_TIERS_VERIFY` line counts as a failure.

The final report says, per task, `verified: <commands>`, `flaky: <command>`, or `not validated: <reason>`, and `/cc-tiers:report` has a Verify column for it. The gate runs where the report is counted. For the Opus ceiling and the dispatcher there is no Agent call, so the pass waits until the Stop hook, which runs the commands outside the session lock. A pass stays parked until it is counted, so a Stop cut off mid-gate leaves it for the next one. A rejected one blocks Stop once with the note. The light path (a trivial task done inline) is outside the gate; the small path inline is inside it, because it uses the attempt trailer. `verify: off` removes it.

**Limits.** The gate proves that the declared command passes, not that it covers the change: a writer can declare a test that does not touch what changed, and the review is what catches that. Parallel sessions that share a checkout can fail a command because of another task; the failure message says so when another task is active. Commands run through the hook, not through your permission rules, which is why the allow list exists. A timeout kills the command with SIGKILL; processes it started in the background can outlive it.

---

## 🧾 Evidence-based review

A review used to reject with "a concrete reason", and that weighed the same with a proof or without one. Now a rejection counts only when it carries a blocking defect with a way to reproduce it. The reviewer receives the diff, the spec block, the research block, and the request, and never the writer's report or explanation: a reviewer that reads the writer's reasoning inherits its blind spots.

The reviewer goes through correctness, regression, security, state (order, idempotency, atomicity), and scope, in that order. Recreated code and changes outside the task are blocking `scope` findings. Each finding is a block before the trailer:

```
CC_TIERS_FINDING_BEGIN
category: state
severity: blocking
evidence: command
command: node --test test/booking.test.mjs
expected: an old event does not close the reopened shift
observed: 'reopen keeps open' fails: expected open, got closed
where: src/booking.js:142
CC_TIERS_FINDING_END
```

`category` is `correctness`, `regression`, `security`, `state`, or `scope`, or one of the finer ones in Review protocol (`access-control`, `input-validation`, `data-exposure`, `error-handling`, `concurrency`, `api-usage`, `compatibility`). `severity` is `blocking` or `note`, or one of the graded ones there (`blocker`, `high`, `medium`, `low`, `suggestion`). A finding describes the defect, never the fix: the writer chooses the fix. Hardening the spec does not ask for, style, and anything that belongs to another issue are always notes.

**What counts.** `CC_TIERS_STATUS: fail` is a failure only with at least one valid blocking finding. `evidence` is one of three:

- `command`: a command in the `CC_TIERS_VERIFY` format, plus `expected`, `observed`, and `where`. The hook runs it once when it is on the allow list. If it **passes**, the finding is discarded as a false positive. If it fails, the finding stands. Off the list, it stands as `trace`.
- `trace`: a concrete input, `expected`, `observed`, and `where: file:line`. The hook does not check it.
- `coverage`: a criterion or edge case of the spec that no test exercises, with `criterion:` (the spec line, copied) and `where:` (the tests the reviewer read). It stands only when the criterion equals a whole line of that task's spec block (bullet, origin tag, case, accents, and spacing aside), so it cannot become hardening the request did not ask for. A task with `CC_TIERS_SPEC: none` takes no `coverage` finding.

An incomplete block does not count. A `fail` with no valid blocking finding is not a failure: the message says `rejected without evidence; <n> finding(s) became notes` and the task is treated as approved. Notes go to the final report as a list, and the note sent to the writer on a real failure carries only the blocking findings. The reviewer does not edit files; it may run read commands and tests that already exist, and it does not add tests to the repo.

`review_evidence: off` goes back to 0.6: any reviewer `fail` counts. Limit: the hook does not check `trace` evidence, so a made-up trace still counts.

---

## 🔁 Escalation

A failure is a failed test, a rejected review, or a subagent error. The task may fail **twice** at its tier (`max_attempts`, default 2). The next attempt moves up, and the failure notes go with it:

**Haiku → Sonnet → Opus**

**Hard tasks start on Opus** (`hard_start: opus`, the default). A task that matches an Opus review keyword (auth, payments, migrations, schema, security, concurrency, plus `risky_extra`), or that needs an architecture decision with trade-offs, a bug fix with no clear reproduction or across modules, or an investigation with competing hypotheses, skips Sonnet. It still gets research, the spec, the verify gate, and the Opus review. The orchestrator implements it (in light mode, `cc-tiers:architect`), and if the Opus attempts fail it stops and tells you. While budget routing conserves, it starts on Sonnet one effort level up. `hard_start: sonnet` restores the 0.7 behavior: Opus implements only what Sonnet could not finish. A keyword that shows up only as text (docs, a quoted example, `git checkout` in an instruction) is not a risk: the orchestrator adds `CC_TIERS_RISK: none - <reason>` to that delegation, and the hook drops the hard start, the effort boost, and the routing hint. A line with no reason is ignored, and the writer's report is still checked, so a result that touches risky code is reviewed as usual.

The new tier starts at zero. Opus is the last stop: the orchestrator does that work itself, and if those attempts fail too it stops and tells you. A review rejection counts against the tier that wrote the diff, not against the checker or the reviewer. Budget routing does not block this ceiling.

A hook on the Agent tool keeps the counter. When it reports `cc-tiers counted a failure`, that count is the one the orchestrator follows.

The hooks enforce what the prompts ask for:

- **Before a delegation** (PreToolUse), a call to a cc-tiers agent is refused when it passes `model`, has no `CC_TIERS_TASK` header, or sends an escalated task back down a tier. Sending a task up early (`/cc-tiers:escalate`) moves the counter with the notes carried.
- **Research** (`research: on`, the default): a call to the implementer or the architect is refused when its task has neither a researcher pass nor a `CC_TIERS_RESEARCH: none - <reason>` line.
- **Specify** (`specify: on`, the default): a call to the implementer or the architect is refused when its prompt has no `CC_TIERS_SPEC_BEGIN` / `CC_TIERS_SPEC_END` block with content and no `CC_TIERS_SPEC: none - <reason>` line.
- **Verify** (`verify: on`, the default): a writer's `pass` counts only after the hook runs the `CC_TIERS_VERIFY` commands that are on the allow list. A `pass` without those lines, or with a command that fails, counts as a failure. The Opus ceiling and the dispatcher are verified at Stop.
- **Evidence** (`review_evidence: on`, the default): a reviewer or checker `fail` counts only with a valid blocking finding. The hook re-runs the finding's command and discards one that passes, and a `fail` with no finding becomes notes.
- **Contract** (`specify: on`): a retry or an escalation that drops or rewords a criterion of the stored spec is refused until the prompt says why in `CC_TIERS_RESPEC: <reason>`.
- **Task budget** (`task_budget_*`): a writer call for a task over its budget is refused until the prompt carries `CC_TIERS_BUDGET: override - <reason>`, after you agreed.
- **Parallel writers**: a writer call whose files overlap a running writer, or that waits on a task in `CC_TIERS_DEPENDS`, is refused, and so is one past the `max_parallel` cap.
- **Background agents** are counted too. The launch records the agent id, and SubagentStop counts the report when it finishes. The note reaches the orchestrator on its next delegation, or at the end of the turn.
- **The Opus ceiling** has no Agent call, so the orchestrator marks its own attempt with a `CC_TIERS_TASK` / `CC_TIERS_TIER: opus` / `CC_TIERS_ROLE: orchestrator` header and closes it with `CC_TIERS_STATUS`. The hook counts that trailer like any other report.
- Parallel agents share one counter file per session, behind a lock, written atomically.
- **API and network errors** (overloaded, rate limit, 5xx) are not failures. The hook says so and the same tier runs again, so an outage does not push work up to Opus.

---

## 🪜 Effort

Each tier also has an effort ladder. A retry at the same tier runs one effort level higher before the task changes model, on the bet that more thinking on Sonnet can fix what would otherwise take a new model, and so the notes stay in one context:

| Tier | Attempt 1 | Attempt 2 | Attempt 3+ |
| --- | --- | --- | --- |
| Haiku | `low` | `medium` | `medium` |
| Sonnet | `high` | `xhigh` | `xhigh` |
| Opus (`cc-tiers:architect`) | `high` | `xhigh` | `xhigh` |

The PreToolUse hook sets `effort` on the Agent call (Claude Code's per-call `effort`, 2.1.292+), so the orchestrator cannot forget it. It may ask for a higher level, never a lower one, and never above the top of the ladder. A risky task, one that matches a review keyword, starts one level up: on Sonnet (`hard_start: sonnet`, or while conserving) at `xhigh`, and on `cc-tiers:architect` at `xhigh` too. While budget routing is conserving, effort stops at `high`. When the Opus orchestrator implements the ceiling itself, it keeps its own session effort. `CLAUDE_CODE_EFFORT_LEVEL`, when set, wins over all of this.

`effort_ladder: off` leaves each agent at the effort its file pins. A project can replace a ladder in `.claude/cc-tiers.json` with `effort.haiku`, `effort.sonnet`, `effort.opus`, and `effort.conserveCap`.

---

## 🧪 Classifier

The keyword lists are a first guess. Two checks stand behind them before a task reaches Haiku:

- **Complexity score**, local and free. Several steps (bullets, "and then", "e depois"), three or more files, design or investigation wording (refactor, architecture, debug, flaky, memory leak), or a long brief add points. At 2 points a trivial-looking task starts on Sonnet. `/cc-tiers:route` prints the score and its signals.
- **Large files.** When the task names files in the project that add up to 400 KB or more (`largeFileBytes`), it starts on Sonnet. This is cc-tiers' take on long-context routing: every current model has a 1M window, but a huge file is still a lot for one cheap pass, and Haiku 4.5, if your `haiku` alias still points there, has only 200K.
- **Haiku classifier**, a `prompt` hook that runs only on `cc-tiers:worker` calls. A quick Haiku pass reads the task, and when it is not really trivial the call is refused with the reason, and the orchestrator sends the same slug to Sonnet. That is a routing correction, not a failure. `classifier: local` turns it off: the orchestrator then marks worker prompts `CC_TIERS_CLASSIFY: skip`, which the command hook only accepts in that mode.

---

## 🪶 Light mode

Plan, research, and review in separate contexts use more of your window than one thread. Light mode is for when the window is tight. The Opus orchestrator reads every request, even a typo fix, and every subagent starts a fresh context, so for a small task that overhead can cost more than the task. Three things cut it:

- **Light path** (`light_path: inline`, the default). When a request is one trivial task, the UserPromptSubmit hook tells the session agent to do it itself: no plan, no worker, no checker. `delegate` sends it to the worker in one call instead (the 0.4 behavior), and `off` plans every request.
- **Small path** (follows `light_path`). A short request (40 words or fewer) that matches no Opus review keyword, scores 0 on complexity, and would start on Sonnet gets a `cc-tiers small path` note. The session agent reads the target first. If the change fits in about 20 lines of one file (its test file aside), has a clear expected result, and uses no library API it has not seen in the repo, it does it itself: no plan, research, or subagent, a spec of one to three criteria, a reproducing test for a bug fix when the file has tests, and its attempt trailer with `CC_TIERS_REVIEW: skip`. The verify gate re-runs its `CC_TIERS_VERIFY` commands, with no review pass. The light-mode dispatcher does the same with its dispatcher trailer. With `delegate`, or while budget routing conserves, it is one `cc-tiers:implementer` call with `CC_TIERS_RESEARCH: none`, a short spec, and `CC_TIERS_REVIEW: skip`. A bigger or risky change, or doubt, takes the usual route, and so does a request that mentions login, payments, or migrations, on purpose. `off` turns it off with the light path.
- **Light mode**, the `cc-tiers:dispatcher` session agent on Sonnet. It does one ordinary task itself, marking the attempt with a `CC_TIERS_ROLE: dispatcher` trailer that the hooks count, so two failures still move it to Opus. It calls Opus only for three things: `cc-tiers:planner` for a request with more than one task or a design decision, `cc-tiers:architect` for a hard task or one that used its attempts on Sonnet, and `cc-tiers:reviewer` for risky work.

Turn on light mode for one session with `claude --agent cc-tiers:dispatcher`, or for good with `"agent": "cc-tiers:dispatcher"` in `~/.claude/settings.json`. The planner starts in a fresh context, so for a long conversation that keeps building on earlier turns, the orchestrator is the better fit.

---

## 💸 Spend and cost

This is optional. Quality is the point of cc-tiers; this section only tells you what it spent. When [cc-cost](https://github.com/edsoncantuaria/cc-cost) is installed, the session summary and each finished task report **fresh tokens per model tier**. Fresh tokens are input + cache write + output. Cache reads stay out, the same rule cc-cost uses. A subagent's tokens come from the Agent result, or from its own transcript when it ran in the background, and go to its `CC_TIERS_TASK` slug. The orchestrator's message that delegates a task counts toward that task, and so do its turns inside a ceiling attempt. Its other turns are listed as `(orchestration)`. The hook reads the session transcript incrementally, from where the last hook stopped, so totals only grow and long sessions stay cheap.

The 5h and 7d windows use cc-cost's kinds, `five_hour` and `seven_day`. The hook reads them from the hook payload when Claude Code includes them, from the transcript as it is scanned, and from `limits.json` or `store.json` in cc-cost's plugin data directory (`~/.claude/plugins/data/cc-cost/`). A daily total is reported when that directory holds cc-cost's `novos:<day>:<sessionId>` keys.

If cc-cost is not installed, those lines are omitted. Routing, retries, and review keep working. A missing window reading does not invent a percent.

Cost needs no other plugin. Each finished task gets a `cc-tiers cost` line, an estimate at Anthropic API list prices from the price table in `config/routing.default.json`. It prices each model by its own id (Opus 5.5 at $4/$20 per million, Sonnet 5.5 at $2/$10, Haiku 5.5 at $0.10/$0.50, older models at theirs), with cache reads at the model's rate and cache writes at 1.25x input, or 2x for the 1-hour cache. Next to it is the same tokens at Opus rates, for comparison. A subscription is not billed this way. `show_cost` is `off` by default; set it to `on` for these lines. `/cc-tiers:report` shows the whole session as a table: tiers, attempts, escalations, effort, review, status, and cost per task.

---

## 🧭 Budget

Budget routing protects your Pro/Max window. `budget_5h` and `budget_7d` default to 80. When either window is at or above its threshold, the session says `Budget routing: conserve`. New work stays on Haiku or Sonnet. Opus still plans, still takes a task that already used its attempts on Sonnet, and still reviews critical work.

A window whose reset time is already past counts as 0, the same way cc-cost draws it. No reading yet means the hook says routing does not conserve.

---

## 🧑‍🏫 With the advisor

Claude Code's [advisor tool](https://code.claude.com/docs/en/advisor) lets a model consult a stronger one at decision points, with the whole conversation in view. It is a session setting (`/advisor opus`), not something a plugin can switch on per agent, and subagents inherit it. That decides where it pays:

- **Light mode + Opus advisor** is the good pairing. The Sonnet dispatcher asks Opus at the hard moments without a fresh `cc-tiers:planner` context, and Sonnet and Haiku subagents can ask too. Expect fewer planner calls and escalations; each consultation reads the full transcript at Opus rates.
- **Orchestrator + Opus advisor** doubles Opus: an Opus main thread consulting another Opus. Leave the advisor off there unless the work is high-stakes.

The advisor's tokens count toward `/usage`. cc-tiers does not see them per task, so `/cc-tiers:report` leaves them out.

---

## 🧠 Learning from Haiku and Sonnet

With `learn` set to `on` (the default), a Haiku failure is appended to `.claude/cc-tiers-history.json` in the project. The next task with the same slug, or enough of the same words, starts on Sonnet instead of Haiku. A task that used its attempts on Sonnet is recorded too, and a similar task later starts on Sonnet at the top of its effort ladder (`xhigh`) instead of climbing it again. Opus starts only hard tasks (`hard_start`). Words are compared without accents, so `migração` and `migracao` match. `off` writes nothing and ignores the file.

The first write adds the file to `.git/info/exclude` when the project is a git checkout (worktrees included), so it stays out of git without touching your tracked `.gitignore`. The plugin repo ignores that path too.

---

## 🏗️ Engineering controls

0.10 adds controls around the flow that research, specify, implement, verify, and review already make. A task gets a risk level, its criteria are held across retries, a failure is classified before the next attempt, writers share a checkout without colliding, the project keeps a small memory, and every pass ends with a line that says how sure the result is. No control removes a gate or a step above. The new options (`profile`, `memory`, `telemetry`, `max_parallel`, `task_budget_usd`, `task_budget_calls`, `task_budget_minutes`, `budget_warn_at`) are in the Configure table.

### Risk assessment

The hook scores each task from the request, the files it names, the history, and the project, on five dimensions of 0 to 3, and derives a level: `low`, `medium`, `high`, or `critical`.

- **Complexity**: the Classifier's score.
- **Regression**: a public-contract word (`endpoint`, `public api`, `contract`, `breaking`, `signature`) adds 2. A dependency or version word, or a manifest or lock file, adds 1. Files in three or more top-level directories add 1, and so does an earlier Sonnet failure on a similar task.
- **Sensitivity**: 3 for a risk keyword or a sensitive path, which is a whole word such as `auth`, `login`, `session`, `payment`, `migration`, `schema`, `secret`, `token`, `jwt`, `password`, or an `.env*` file. 2 for persistent data (`database`, `sql`, `persist`, `drop`).
- **Ambiguity**: one for each hedge ("maybe", "not sure", "figure out", "talvez") and one for two or more question marks.
- **Evidence**: 0 when the project has tests (a test directory, a test script, or a runner config), 1 when that is unknown, 2 when it has none, and 1 more after a Haiku failure on a similar task.

Sensitivity 3 is `critical`. Sensitivity 2, regression 2 or more together with complexity 2 or more, or a sum of 6 or more over complexity, regression, ambiguity, and evidence, is `high`. A sum of 2 or more, or any regression or sensitivity, is `medium`. Anything else is `low`. `/cc-tiers:route` prints the level next to the tier, with the scores and the factors behind it, and `risky` keeps its old meaning. Abridged, for "Add a login endpoint to src/auth.js and a users table migration":

```
{ "tier": "opus", "because": "hard", "risk": "critical",
  "riskDimensions": { "complexity": 0, "regression": 2, "sensitivity": 3, "ambiguity": 0, "evidence": 0 },
  "riskFactors": ["risk keyword", "sensitive path: src/auth.js", "public contract"] }
```

What the level changes:

- A task that looks like Haiku work but has `high` or `critical` risk starts on Sonnet (`because: risk`). Under `hard_start: opus`, a Sonnet task of `critical` risk starts on Opus.
- A `critical` task starts its writer one effort level up, like one that matches a review keyword.
- The writer's prompt gets a context block, between `CC_TIERS_CONTEXT_BEGIN` and `CC_TIERS_CONTEXT_END`, with the project's checks that fit the risk (see Profiles). The block is data, not instructions.
- A writer cannot close with `CC_TIERS_REVIEW: skip` when it changed a sensitive file its prompt did not name, when its risk is `critical`, or when its risk reaches the profile's review floor. `review_policy: never` is the only way past that.

### Spec contract and completion

The spec block becomes a numbered contract. The hook reads the lines under `Criteria:`, `Preserve:`, `Checks:`, `Security:`, `Evidence:`, and `Edge cases:` as `C1`, `C2`, and so on, and stores them at the task's first delegation. `Assumed:` and `Ambiguous:` stay notes.

```
CC_TIERS_SPEC_BEGIN
Criteria:
- GET /users takes a cursor and returns the next page (request)
Preserve:
- GET /orders keeps its current response (repo: src/orders.js:12)
Checks:
- `node --test test/users.test.mjs`
Security:
- the cursor is validated before it reaches the query (decided: it is user input)
CC_TIERS_SPEC_END
```

- A writer reports each criterion before the trailer, as `CC_TIERS_CRITERION: C<n> pass|fail|unverifiable|na - <evidence>`. `na` and `unverifiable` need a reason, and the last line for an id wins.
- A `Checks:` criterion with a backticked command is evidenced only when that exact command passes in the gate. Without a backticked command it stays unevidenced.
- A `pass` or an `na` the writer only declared is evidence after an independent review passed, never before, and never gives high confidence.
- A retry or an escalation that drops or rewords a criterion is refused. When the criterion was wrong, the prompt says why in `CC_TIERS_RESPEC: <reason>`, and the change is audited.
- The reviewer's and the checker's prompt must carry the same spec block, or the call is refused.

When a task passes, the hook prints one completion line:

```
cc-tiers completion: users-pagination verified on sonnet, high risk; confidence high (gate verified 1 command). Checks run 1, passed 1, failed 0, not run 0. Criteria with evidence: 4/4.
```

The status is `verified`, `partial`, `failed`, or `unverified`. `verified` needs a verified command, no `na` that only the writer declared, evidence for every criterion from the profile's evidence risk up, and a review pass for `high` and `critical` risk. `failed` is a failed gate, a rejected review, or a failed criterion. Confidence is `high`, `moderate`, or `low`, and the reasons come after it. A `critical` task with no review is always `low`, and a line ends with `Remaining:` when something is open. `specify: off` removes the contract.

### Failure diagnosis

A failure is classified before the next attempt: `syntax`, `type`, `test`, `regression`, `requirement`, `docs-version`, `dependency`, `integration`, `architecture`, `security`, `infra`, `flaky`, `scope`, or `unknown`. The source is the reviewer's finding category when there is one, and the output of the gate or the error otherwise. The note for the next attempt carries it:

```
Diagnosis: dependency (confirmed by the output). A module, package or command the code needs is missing from the environment.
Next: The environment is missing something: fix it, then rerun. Do not change code until then.
```

- `retry`: syntax, type, test, regression, requirement, integration, scope, and unknown, with what to read first.
- `retry-research`: docs-version. Run `cc-tiers:researcher` again for the installed version.
- `rerun-env`: dependency, infra, and flaky. Fix the environment and rerun; do not change code.
- `escalate`: architecture and security.
- The same failure twice (quoted text, paths, and numbers aside), or no attempt left, moves the task up as well. At Opus it is `stop`.

A diagnosis is **confirmed** only by a reviewer category or by the output of a command, and for dependency and infra only by a machine signature (`Cannot find module`, `command not found`, `ECONNREFUSED`, `ENOSPC`, `EADDRINUSE`). Words in the writer's own report make a hypothesis, and the note says `suspected from the reason`. A test name or an assertion message that holds those words is a code failure, not an environment one. A confirmed infra failure of the gate is not counted as a failure, up to 2 per task; the third counts, so an outage does not push work up a tier and a loop cannot hide behind it.

### Review protocol

The reviewer and the checker may now use finer categories and graded severities. The five categories of the evidence block stay, and `access-control`, `input-validation`, `data-exposure`, `error-handling`, `concurrency`, `api-usage`, and `compatibility` join them. `severity` is `blocking`, `note`, or one of `blocker`, `high`, `medium`, `low`, `suggestion`.

```
CC_TIERS_FINDING_BEGIN
category: input-validation
severity: high
confidence: high
justification: the cursor reaches the query as typed
scenario: GET /users?cursor=1%20OR%201=1 returns every row
evidence: trace
expected: a 400 for a cursor that is not an id
observed: 200 with all rows
where: src/users.js:58
CC_TIERS_FINDING_END
```

- `blocker` and `high` count as blocking, like `blocking`, and need `confidence` (`low`, `medium`, or `high`) and `justification`. A low-confidence one becomes a note. `medium`, `low`, and `suggestion` are notes. `scenario`, `confidence`, and `justification` are optional on the rest.
- A review prompt gets a review-focus block, between `CC_TIERS_CONTEXT_BEGIN` and `CC_TIERS_CONTEXT_END`: up to 5 of 8 risk classes (access control, input validation, data exposure, concurrency, state consistency, external APIs, error handling, backward compatibility) chosen from the words of the diff and the request. A blocking finding still needs evidence.
- A reviewer or checker prompt that carries a writer's trailer (a writer's `CC_TIERS_ROLE` line and a `CC_TIERS_STATUS` line) is refused: the review gets the diff, the spec, the research, and the request, never the writer's report.

### Profiles

`profile` moves a few thresholds together. `balanced`, the default, is the behavior of 0.9. Set it in `/config`, or in `.claude/cc-tiers.json` when `/config` leaves it empty.

| Profile | Writer effort | Evidence from | Review from | Parallel writers | Memory items | Checks |
| --- | --- | --- | --- | --: | --: | --- |
| `balanced` (default) | ladder | `medium` | `critical` | 4 | 5 | by risk |
| `quality` | one level up | `low` | `high` | 3 | 8 | one depth more |
| `budget` | ladder | `medium` | `critical` | 2 | 3 | by risk |
| `fast` | ladder | `high` | `critical` | 6 | 3 | one depth less |

- **Writer effort**: `quality` starts a Sonnet or Opus writer one effort level above the first rung of its ladder. A retry still climbs from there.
- **Evidence from**: the lowest risk from which every criterion needs evidence (a verified command or a passed review) for a `verified` status. Below it the rule is light; from it, standard; for `high` and `critical`, strong.
- **Review from**: the lowest risk from which `CC_TIERS_REVIEW: skip` is refused.
- **Parallel writers**: the cap when `max_parallel` is 0.
- **Memory items**: how many recalled notes a writer gets at most.
- **Checks**: the hook reads the checks the project declares (the `test`, `lint`, and `typecheck` scripts of `package.json`, `tsconfig.json`, an ESLint config, `phpunit.xml`, `phpstan.neon`, `pytest`, `go.mod`, `Cargo.toml`, `package-lock.json`) and tells the writer the ones that fit the risk. Depth 0 and 1 are the test checks, and depth 0 asks for the tests that cover the change. Depth 2 adds the type check and the lint. Depth 3 is every check, `npm audit --omit=dev` included. In `balanced`, `low` is depth 0, `medium` 1, and `high` 2. A check that is not on `verify_allow` is listed as one the gate will not run.

No profile removes an agent, a gate, a criterion, or a step, overrides a `/config` value, or lowers what a `critical` task gets: it always gets depth 3, a review, and strong evidence.

```json
{ "profile": "quality" }
```

### Task budget

`budget_5h` and `budget_7d` guard your usage window. The task budget guards one task: a runaway retry loop or a task that grows past what you meant. All four options default to off.

| Key | Default | Meaning |
| --- | --- | --- |
| `task_budget_usd` | `0` | Estimated cost, at API list prices, after which writer calls for that task need your approval. 0–1000, 0 is no limit |
| `task_budget_calls` | `0` | Agent calls one task may make. 0–200, 0 is no limit |
| `task_budget_minutes` | `0` | Minutes since the task's first delegation. 0–1440, 0 is no limit |
| `budget_warn_at` | `80` | Percent of a limit at which cc-tiers warns first. 50–99 |

Near a limit, the hook warns: `cc-tiers: users-pagination is close to its budget (calls 8/10).` Over it, the hook refuses new writer calls for that task. Review and verification calls still run, so what was built can still be checked. The orchestrator asks you; when you agree, it adds this line to the delegation, and the hook lets the call through with a note:

```
CC_TIERS_BUDGET: override - the user approved more calls for the pagination work
```

Calls and minutes are measured. The cost is an estimate from token counts, never a billed amount. A `critical` task over its budget asks for your decision and is not skipped quietly.

### Memory

With `memory` set to `on` (the default), the project keeps small notes in `.claude/cc-tiers-memory.json`, so the next task does not rediscover them. The first write adds the file to `.git/info/exclude`, as with the history file. `off` neither reads nor writes it.

- **Categories**: `convention`, `command`, `failure`, `fix`, `dead-end`, `version`, and `warning`. A record has a confidence (`low`, `medium`, `high`), a status (`hypothesis` or `confirmed`), and a time to live: `convention` and `warning` last until invalidated, `command` and `version` 30 days, `failure` and `dead-end` 60, `fix` 90. The cap is 200 records.
- **Tied to a file**: a record that depends on a file keeps its hash. When the file changes, the record is stale and is not recalled.
- **What the hook records**: a command the gate verified (tied to the manifest that declares it), a diagnosed failure, a fix after a pass that followed failures, and a dead end when a task is stopped. Secrets and `CC_TIERS_*` lines are removed first (see Redaction).
- **Recall**: a writer gets the notes that share two or more words with its task, or the same slug, at most the profile's number. They arrive between `CC_TIERS_MEMORY_BEGIN` and `CC_TIERS_MEMORY_END`, labeled data from earlier tasks, never instructions.

```
/cc-tiers:memory list
/cc-tiers:memory add convention Tests sit next to the code and run with node --test
/cc-tiers:memory invalidate m-9f3a17ebaf the test script was renamed
```

The command is `/cc-tiers:memory [list [--all] | add <category> <text> | invalidate <id> <reason> | delete <id> | prune | clear --yes]`. A note you add is confirmed, with high confidence. `clear` needs `--yes`. `list --all` includes stale and invalidated records.

### Parallel writers

Writers that run at the same time in one checkout can overwrite each other. A delegation says which files it touches, and the hook keeps a registry of the writers that are running:

```
CC_TIERS_TASK: users-pagination
CC_TIERS_FILES: src/users.js, src/routes/*.js, test/users.test.mjs
CC_TIERS_DEPENDS: users-schema
```

- `CC_TIERS_FILES` lists paths and directories. A glob becomes its fixed directory (`src/routes/*.js` is `src/routes/`). `.`, more than 40 entries, an absolute path, or a `../` means the whole project. Without the header, the hook falls back to the paths the prompt names.
- Writers whose files overlap, or whose files are unknown, run one at a time: the second call is refused until the first one finishes.
- `CC_TIERS_DEPENDS` blocks the call until each listed task has passed.
- An Agent call with `isolation: "worktree"` never conflicts on files, and still counts toward the cap.
- `max_parallel` (0–16, default 0) caps the writers at once. 0 takes the profile's cap: 4 for `balanced`.
- A writer whose report never came back is released after 2 hours, and Stop releases every idle one (background writers stay). `CC_TIERS_RELEASE: <slug>` in a delegation frees one by hand.

### Workspace guard

Before and after each writer attempt the hook takes a snapshot of the working tree: `git status` and a hash of the content of every changed file. What the attempt changed is the difference, and the hook reports two things the prompt did not ask for:

- **Sensitive files** the prompt did not name: `.env` files, key material, SSH keys, credential and registry credential files, CI workflows, lockfiles, Claude settings, git internals, `Dockerfile` and Compose files. Such a pass cannot skip review.
- **Files outside `CC_TIERS_FILES`**, when the header is there. A test file counts as in scope when it tests a declared file by name.

When the tree has more than 400 changed files, the snapshot is cut and gives no fingerprint. Another task that is open in the same checkout can change files too, and the note says so.

On every load, the task state is validated. An entry with a bad slug, an unknown tier, a bad failure list, or more failures than the limit below Opus is dropped, written to the audit, and reported to the orchestrator once.

### Telemetry and insights

With `telemetry` set to `on` (the default), the hook appends one small event per transition to `events.jsonl` in the plugin data directory: `task.received`, `risk.assessed`, `model.selected`, `research.done`, `criteria.defined`, `implementation.done`, `verify.done`, `failure.diagnosed`, `escalated`, `review.done`, `task.passed`, `task.stopped`, `budget.warning`, and `state.recovered`. An event holds whitelisted fields (slug, tier, risk level, category, counts), never prompt or file text, and passes through redaction. The file rotates once to `events.1.jsonl` above 1 MB. `reduced` keeps only `escalated`, `failure.diagnosed`, `task.passed`, `task.stopped`, and `budget.warning`; `off` writes nothing. Nothing leaves your machine.

`/cc-tiers:insights` reads that log and prints failures by category, escalation reasons, estimated cost by risk level, gates that were not validated, and confidence on the tasks that passed. A sample under 10 tasks is marked small, and the output says it is not a reason to change routing. The command never edits config or routing.

### Redaction

Memory, telemetry, and the audit trail store only text that went through `hooks/redact.mjs` first. It masks private keys, provider keys (`sk-`, `pk-`, `glpat-`, `npm_`, `ghp_` and its kin, `github_pat_`, `xox`, `AKIA`, `AIza`, Slack webhook URLs), JWTs, credentials inside URLs, `Bearer`, `Basic`, and `Token` values, `Cookie` headers, `--password` and `--token` style flags, `key=value` pairs whose key names a secret, and e-mail addresses. `[redacted]` replaces the value and the key stays readable.

### Report and session notes

- `/cc-tiers:report` has four more columns at the end: Risk, Completion, Confidence, and Time. Time is measured, shown as `N s` or `N.N min`; the footer says that time is measured and cost is estimated.
- SessionStart lists open work it finds in the session state (a task with failures, a review pending, a writer that was running, a ceiling pass waiting for its gate) and says nothing is rerun automatically: check `git status` and the working tree before delegating or reviewing it again.
- The session context states the profile, memory, telemetry, the task budget, and the parallel and contract rules in force.
- `.claude/cc-tiers.json` may also set `profile`, `memory`, `telemetry`, `maxParallel`, `taskBudgetUsd`, `taskBudgetCalls`, `taskBudgetMinutes`, and `budgetWarnAt`. `/config` wins when both are set.

### Limitations

- The state lock waits 3 s; after that a hook proceeds without it, so a very busy session can lose a count.
- The workspace snapshot comes from `git status`, so files that git ignores are not seen.
- Without `CC_TIERS_FILES`, the scope is the paths named in the prompt. Absolute paths are dropped, so a prompt that names only those has an unknown scope and its writer runs alone.
- Claude Code does not fully document how a hook rewrites the Agent prompt (`updatedInput`), or what PostToolUse sees of it. cc-tiers keeps the state it needs at PreToolUse instead of reading the rewritten prompt back.
- Redaction matches known patterns. A secret in a format it does not know can pass.
- Diagnosis reads text. A flaky or infra call is a hypothesis unless a machine signature confirms it.
- A `Checks:` line with no backticked command cannot be matched to a run, so it stays unevidenced.
- Risk scoring is a keyword and path heuristic, not a reading of the code.
- cc-tiers runs no model benchmark on its own. Telemetry is local and descriptive, and `/cc-tiers:insights` does not tune anything.

---

## 💬 Commands

| Command | What it does |
| --- | --- |
| `/cc-tiers:tiers [task]` | Plan, route, and run the work |
| `/cc-tiers:route [task]` | Name the tier and stop. Runs the same heuristic as the hooks. No edits |
| `/cc-tiers:escalate [slug]` | Move that task up one tier now, notes included |
| `/cc-tiers:report [--all]` | Per-task table for this session: tiers, attempts, effort, review, verify, status, and cost next to Opus rates, then risk, completion, confidence, and measured time. The Verify column says `ok`, `flaky`, or `not validated` |
| `/cc-tiers:memory [list\|add\|invalidate\|delete\|prune\|clear]` | List, add, invalidate, delete, prune, or clear what cc-tiers remembers about this project. No edits to code |
| `/cc-tiers:insights` | Failures by category, escalation reasons, estimated cost by risk, unverified gates, and confidence, from the local telemetry. Changes nothing |

You can also ask in plain language. The `tiers` skill loads for an implement, fix, rename, or review request. Mention an agent directly with `@agent-cc-tiers:worker`, `@agent-cc-tiers:implementer`, `@agent-cc-tiers:checker`, or `@agent-cc-tiers:reviewer`.

---

## 🎬 Example

You: "Rename `fetchUser` to `loadUser` in `api.ts`, and add pagination to `GET /users`."

1. The Opus orchestrator splits it into `rename-fetch-user` (Haiku) and `users-pagination` (Sonnet).
2. Haiku renames the symbol and the check passes. The policy is `risky`, and a one-file rename is not risky, so there is no review pass for it.
3. `users-pagination` is a normal task, so the researcher runs first. It reads the lock, finds the framework version in use, opens that version's docs in `node_modules/`, and cites how `GET /orders` already paginates. The brief goes into the Sonnet prompt.
4. Sonnet adds pagination at effort `high`. The cursor test fails. That is failure 1, so Sonnet retries at `xhigh` with the traceback in the prompt. The tests pass.
5. The route is a public API, so the Opus reviewer reads the diff in a fresh context and rejects it: the cursor is not validated. That is failure 2 on Sonnet.
6. The limit is 2, so the task escalates to Opus with both notes, the traceback and the review. The orchestrator researches that attempt itself, fixes the validation, and the reviewer approves on the next pass.
7. The orchestrator reports both slugs, the tier that finished each one, who reviewed them, and that pagination escalated. With `show_cost` on, each slug also carries its cost line.

A later "add pagination for users" in this repo starts on Sonnet, because Haiku already failed at that kind and `learn` is on.

---

## ⚙️ Configure

Open `/config` and set the cc-tiers rows. They apply on the next session (the SessionStart hook reads them).

| Key | Default | Meaning |
| --- | --- | --- |
| `max_attempts` | `2` | Failures allowed at one tier before escalating. 1–5 |
| `review_policy` | `risky` | `risky`, `cheap`, `always`, or `never` |
| `learn` | `on` | Record Haiku failures and start similar tasks on Sonnet. `off` disables it |
| `budget_5h` | `80` | Percent of the `five_hour` window that starts conserving. 1–100 |
| `budget_7d` | `80` | Percent of the `seven_day` window that starts conserving. 1–100 |
| `trivial_extra` | empty | Comma-separated phrases added to the Haiku list |
| `risky_extra` | empty | Comma-separated phrases added to the Opus review list |
| `effort_ladder` | `on` | Raise effort on a retry before changing model. `off` keeps each agent's own effort |
| `classifier` | `haiku` | `haiku` adds the Haiku check on worker calls. `local` uses only keywords and the complexity score |
| `light_path` | `inline` | One trivial or small task: `inline` does it in the session, `delegate` sends it to the worker or the implementer, `off` plans it |
| `hard_start` | `opus` | Where a hard task (review keyword, architecture, unclear bug) starts: `opus`, or `sonnet` to implement on Opus only after Sonnet fails |
| `show_cost` | `off` | `on` shows the estimated cost of each task and the session next to Opus rates |
| `research` | `on` | Require a researcher brief, or a `none - <reason>` line, before code goes to the implementer or the architect. `off` removes the step |
| `specify` | `on` | Require acceptance criteria, or a `CC_TIERS_SPEC: none - <reason>` line, before code goes to the implementer or the architect, and let the orchestrator ask what changes the result. `off` removes the step |
| `verify` | `on` | A writer's `pass` must list the commands that prove it in `CC_TIERS_VERIFY` lines, and the hook runs the ones on the allow list. `off` takes a pass from the report alone |
| `verify_allow` | see below | Comma-separated command prefixes the gate may run, compared on whole words. `docker exec` is not in the default. Blank uses the default |
| `verify_timeout` | `300` | Seconds one gate command may run before it counts as a failure. 10–600 |
| `verify_budget` | `600` | Seconds the gate may spend on one report. Commands past it are not validated, not failed. 30–600 |
| `review_evidence` | `on` | A reviewer's `fail` counts only with a blocking finding that has evidence. `off` counts any `fail` |
| `profile` | `balanced` | `balanced`, `quality`, `budget`, or `fast`: effort, evidence, review, parallel, memory, and check depth thresholds. No profile removes a gate |
| `memory` | `on` | Keep small evidence-backed notes per project in `.claude/cc-tiers-memory.json` and give a writer the few that match. `off` neither reads nor writes it |
| `telemetry` | `on` | `on` writes one small event per transition to `events.jsonl` in the plugin data directory, `reduced` only failures, escalations, and outcomes, `off` nothing. Nothing leaves the machine |
| `max_parallel` | `0` | Writers at the same time. 0–16. 0 uses the profile's cap (`balanced` 4) |
| `task_budget_usd` | `0` | Estimated cost at API list prices after which writer calls for one task need your approval. 0–1000. 0 is no limit |
| `task_budget_calls` | `0` | Agent calls one task may make before writer calls need your approval. 0–200. 0 is no limit |
| `task_budget_minutes` | `0` | Minutes from a task's first delegation before writer calls need your approval. 0–1440. 0 is no limit |
| `budget_warn_at` | `80` | Percent of a task budget at which cc-tiers warns before the limit. 50–99 |

The default `verify_allow` is `npm test, npm run test, node --test, npx tsc, npx eslint, npx vitest, npx jest, npx playwright test, vendor/bin/phpunit, ./vendor/bin/phpunit, vendor/bin/phpstan, ./vendor/bin/phpstan, vendor/bin/phpcs, ./vendor/bin/phpcs, pytest, python -m pytest, go test, cargo test`.

`risky` is the default: Opus reviews non-trivial work in a fresh context and skips a trivial Haiku pass. `cheap` sends Haiku output to the Sonnet checker and sends Opus review only for a review phrase or the ceiling. `always` reviews every pass (Haiku on Sonnet, the rest on Opus). `never` skips review. While a budget window is conserving, Opus review is reserved for critical work even under `risky` or `always`.

Routing matches two kinds of lists. **Phrases** (`when`, `reviewWhen`, and the `_extra` options) match when the whole phrase appears in the task. **Keywords** (`haiku.keywords`, `opus.reviewKeywords`) match at the start of a word, case- and accent-insensitive: `migra` finds "migration" and "migração", `authent` finds "authentication" but not "author". The built-in keywords cover renames, typos, formatting and lookups for Haiku, and auth, payments, migrations, schemas, public APIs, security, and concurrency for Opus review, in English and Portuguese. A task that looks trivial but hits a review keyword, or scores 2 on complexity (`sonnet.complexKeywords` is one of its signals), starts on Sonnet.

To replace a whole list, add `.claude/cc-tiers.json` to the project. A list you include replaces that list; lists you omit stay at the default. The same file may set `learn`, `budget5h`, `budget7d`, `profile`, `memory`, `telemetry`, `maxParallel`, `taskBudgetUsd`, `taskBudgetCalls`, `taskBudgetMinutes`, and `budgetWarnAt` when `/config` leaves them empty. `/config` still wins when both are set. See `config/cc-tiers.example.json`.

```json
{
  "learn": "on",
  "budget5h": 80,
  "budget7d": 80,
  "trivialExtra": ["changelog edits"],
  "tiers": {
    "haiku": { "when": ["rename a symbol in one or two files", "changelog edits"] },
    "opus": { "reviewKeywords": ["authent", "payment", "migrat", "terraform"] }
  },
  "effort": { "sonnet": ["medium", "high", "max"], "conserveCap": "high" }
}
```

The escalation order is fixed. Routing phrases and keywords, the retry limit, the effort ladders, the review policy, the research gate, the specify gate, the verify gate and evidence-based review, the classifier, learning, the two budget thresholds, the profile, memory, telemetry, the writer cap, and the task budget are the knobs.

---

## 📊 Benchmark

> [!IMPORTANT]
> **The benchmark measures quality only: whether the work comes out right the first time.** It does not measure cost. Tokens are shown in the last column, for information.

A run is right the first time when the user would not have to ask again. They would when it does not work, it broke something that worked, it recreated code the project already had, or it is inconsistent across runs. `bench/` grades each run with hidden checks and reports:

| Metric | Meaning | Where it comes from |
| --- | --- | --- |
| `pass@1` | Share of runs that resolve the task, averaged over tasks. `Δ pass@1 vs Opus only` is the difference from Opus only, in percentage points | pass@k, HumanEval (Chen et al., 2021) |
| FAIL_TO_PASS | The hidden check fails on the untouched fixture and must pass after the change | SWE-bench (Jimenez et al., 2024) |
| PASS_TO_PASS | Test files that passed before the change must still pass, each re-run in its before-form | SWE-bench (Jimenez et al., 2024) |
| `pass^k` | Share of tasks resolved in all `k` runs. It drops when a configuration is lucky, not reliable. Shown as `(k=N)` | pass^k, τ-bench (Yao et al., 2024) |
| Resolved | FAIL_TO_PASS passed and no PASS_TO_PASS file regressed | SWE-bench |
| Broke something | Runs whose hidden check passed but that broke a test that passed before | PASS_TO_PASS |
| Recreated existing code | Runs that failed a hidden-check test whose name starts with `reuse: `. `—` when no run was checked for it | cc-tiers |
| Touched outside scope | Runs that changed a file outside the task's scope: the files of the reference solution, `scopeExtra` from the tasks JSON, and test directories. `—` when no run was measured for it | cc-tiers |
| Tokens per resolved task | Fresh tokens (input + cache write + output) divided by resolved tasks. For information only | cc-tiers |

Tests the model wrote do not count toward resolved; the raw JSON keeps them as `ownTests`. A task may list `changesTests`, the original test files it changes on purpose; they are left out of PASS_TO_PASS. Below the per-task table, **Where it made a difference** lists the tasks where a configuration resolved a different share of runs than Opus only.

The scope is the reference solution's files plus a short allowance list, so a legitimate alternative fix in another file can count as touched outside scope; the raw JSON lists the files so a reader can judge. Readability and comment quality have no deterministic metric and are not in the tables. The rows below predate the column, so it shows `—`.

**Two suites.**

- `bench/tasks-login.json`, the main suite and the default: one natural request, `POST /login`, with no hints, on `bench/fixture-login/`, a small API. The project's own state hides what the request does not say: a silent version trap (the installed dotenv 8.6.0 cuts the multi-line `PRIVATE_KEY` in `.env` at its first line), an existing token signing helper, and existing behaviour that can break. The hidden check is in `bench/checks-login/` and the reference in `bench/solutions-login/`.
- `bench/tasks-hard.json`: twelve realistic bug reports and requests on `bench/fixture-hard/`, a 1,600-line Node service with shared state, time zones, and async booking. The hidden checks are in `bench/checks-hard/` and the references in `bench/solutions-hard/`.

`npm test` verifies both sides of every check: it fails on the fixture and passes with the reference.

**Run it.**

```bash
npm run bench -- --tasks-file bench/tasks-login.json --configs opus,sonnet,cc-tiers --repeat 2 --out bench/results/login.json
npm run bench -- --tasks-file bench/tasks-hard.json --tasks traversal,race --configs opus,sonnet,cc-tiers --repeat 3 --out bench/results/hard-pair.json
npm run bench -- --tasks-file bench/tasks-hard.json --tasks race,cancel,instances,traversal,date-filter,csv-escape,offboarding,recurring-pack --configs opus,cc-tiers --repeat 2 --out bench/results/verify-evidence.json
npm run bench:table -- bench/results/login.json
```

> [!WARNING]
> A run uses your real Claude Code login, so on Pro or Max it spends your usage window. `npm run bench:table -- <result files>` prints the tables from saved results.

The login suite is one-shot only: its task edits the server and the config, so `--session` is refused. The runner loads only project and local settings, so your own CLAUDE.md, agents, and plugins stay out of the measurement. It disables `AskUserQuestion` for every configuration, Opus only and Sonnet only included: a headless run denies it anyway and nobody would answer. cc-tiers's prompts tell it to take the recommended option and record it under `Assumed:` (`agents/orchestrator.md`, Specify). For cc-tiers the runner also reads, from the session transcript, the escalations the hooks announced and whether each task was routed as this README says. For cc-tiers, a quality layers table shows what the gate and the review did: passes blocked by the gate, flaky commands, tasks not validated, findings discarded, rejections without evidence, and review rounds per task. The command for the verify and evidence suite (the 8 non-trivial tasks of the hard suite, Opus only against cc-tiers) is the last one in the list above.

**Results**, as measured, one-shot. The results below are from 0.6, before the gate and evidence-based review.

Login (`bench/results/login.json`, k=2, cc-tiers at plugin commit `18a1222`):

| Configuration | pass@1 | Δ pass@1 vs Opus only | pass^k | Resolved | Broke something | Recreated existing code | Touched outside scope | Tokens per resolved task |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| Opus only | 50% | — | 0% (k=2) | 1/2 | 0 | — | — | 50.2k |
| Sonnet only | 50% | 0 pp | 0% (k=2) | 1/2 | 0 | — | — | 40.1k |
| cc-tiers (Opus orchestrator) 18a1222 | 100% | +50 pp | 100% (k=2) | 2/2 | 0 | — | — | 202.4k |

| Task | Opus only | Sonnet only | cc-tiers (Opus orchestrator) 18a1222 |
| --- | --: | --: | --: |
| `login` (hard) | 🟡 1/2 | 🟡 1/2 | ✅ 2/2 |

**Where it made a difference** (resolved runs per task vs Opus only)

| Task | Opus only | Sonnet only | cc-tiers (Opus orchestrator) 18a1222 |
| --- | --: | --: | --: |
| `login` | 1/2 | 1/2 | 2/2 |

| Configuration | hard: pass@1 | Escalations | Routed as documented |
| --- | --: | --: | --: |
| Opus only | 50% | — | — |
| Sonnet only | 50% | — | — |
| cc-tiers (Opus orchestrator) 18a1222 | 100% | 1 | 2/2 |

| Configuration | hard |
| --- | --- |
| cc-tiers (Opus orchestrator) 18a1222 | 2/2 (sonnet (+ Opus review)) |

- Plain Opus and plain Sonnet each failed one of their two runs the same way: `/login` answered 500, because dotenv 8.6.0 had cut the key. cc-tiers resolved both runs; in both, the researcher found the truncation in `node_modules/dotenv` before any code was written.
- `Recreated existing code` shows `—` because these runs predate the column; none of the six runs failed the reuse test.
- The sample is small. cc-tiers took about 4× the tokens per resolved task of plain Opus (202.4k vs 50.2k) and about 12× its wall time (646 s vs 54 s per run), partly because the review asked for hardening the request did not ask for.

Hard pair (`bench/results/hard-pair.json`, `traversal` and `race`, k=3, cc-tiers at plugin commit `ef57726`):

| Configuration | pass@1 | Δ pass@1 vs Opus only | pass^k | Resolved | Broke something | Recreated existing code | Touched outside scope | Tokens per resolved task |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| Opus only | 100% | — | 100% (k=3) | 6/6 | 0 | — | — | 32.7k |
| Sonnet only | 50% | −50 pp | 50% (k=3) | 3/6 | 0 | — | — | 38.5k |
| cc-tiers (Opus orchestrator) | 100% | 0 pp | 100% (k=3) | 6/6 | 0 | — | — | 166.5k |

| Task | Opus only | Sonnet only | cc-tiers (Opus orchestrator) |
| --- | --: | --: | --: |
| `race` (hard) | ✅ 3/3 | ✅ 3/3 | ✅ 3/3 |
| `traversal` (hard) | ✅ 3/3 | ❌ 0/3 | ✅ 3/3 |

**Where it made a difference** (resolved runs per task vs Opus only)

| Task | Opus only | Sonnet only | cc-tiers (Opus orchestrator) |
| --- | --: | --: | --: |
| `traversal` | 3/3 | 0/3 | 3/3 |

| Configuration | hard: pass@1 | Escalations | Routed as documented |
| --- | --: | --: | --: |
| Opus only | 100% | — | — |
| Sonnet only | 50% | — | — |
| cc-tiers (Opus orchestrator) | 100% | 1 | 6/6 |

| Configuration | hard |
| --- | --- |
| cc-tiers (Opus orchestrator) | 6/6 (sonnet (+ Opus review)) |

- Plain Opus and cc-tiers resolved every run; plain Sonnet failed `traversal` in all three. In cc-tiers the code is written by Sonnet, and the Opus reviewer rejected its first `traversal` fix in every run.

**What the data does not show:** cc-tiers beating plain Opus on tasks with the rules spelled out. On the hard pair, plain Opus resolved every run too.

**Gate and evidence-based review (0.7), hard suite, k=2:** results pending. A tie with plain Opus on quality is a possible result and will be reported as one.

---

## 📋 Requirements

- Claude Code **2.1.295+** (the `/config` pickers use `userConfig.options`, the PreToolUse hook sets `onFailure`, and the effort ladder uses the per-call `effort` from 2.1.292).
- Node.js 18+ on `PATH` as `node`. The hooks call `node` directly, so they run the same under bash, Git Bash, and PowerShell on Windows. They do not call Python.

## 🛠️ Development

```bash
git clone https://github.com/edsoncantuaria/cc-tiers
cd cc-tiers
npm test
claude plugin validate --strict .
claude --plugin-dir .
```

> [!WARNING]
> Copying the folder into a project does not load it. Use the marketplace install or `--plugin-dir`. Don't enable both at once or the agents show up twice.

### Layout

| Path | Owns |
| --- | --- |
| `.claude-plugin/plugin.json` | Name, metadata, and the `/config` knobs |
| `.claude-plugin/marketplace.json` | Marketplace entry, source `./` |
| `settings.json` | Session agent: `orchestrator` |
| `agents/*.md` | Opus orchestrator, reviewer, planner, and architect, Sonnet researcher, implementer, checker, and dispatcher, Haiku worker |
| `skills/tiers/SKILL.md` | `/cc-tiers:tiers` |
| `commands/route.md` | `/cc-tiers:route` |
| `commands/escalate.md` | `/cc-tiers:escalate` |
| `config/routing.default.json` | Built-in phrase lists, effort ladders, and default thresholds |
| `hooks/hooks.json` | SessionStart summary, the Agent checks, effort, Haiku classifier, and counter, SubagentStop, Stop, and UserPromptSubmit |
| `hooks/cc_tiers.mjs` | Merge rules, the counter, spend, budget, and history |
| `hooks/route.mjs` | The heuristic behind `/cc-tiers:route` |
| `hooks/verify.mjs` | The verify gate: read `CC_TIERS_VERIFY`, the allow list, run the commands, and judge findings |
| `hooks/report.mjs` | The table behind `/cc-tiers:report` |
| `commands/report.md` | `/cc-tiers:report` |
| `commands/memory.md` | `/cc-tiers:memory` |
| `commands/insights.md` | `/cc-tiers:insights` |
| `hooks/base.mjs` | Helpers shared by the modules below: paths, file lists, and dollars |
| `hooks/risk.mjs` | Risk scoring: five dimensions and the level |
| `hooks/contract.mjs` | The spec as numbered criteria, the criterion reports, and the completion status |
| `hooks/diagnose.mjs` | Failure categories and the next action |
| `hooks/policy.mjs` | Profiles, the project's checks, and the checks a risk selects |
| `hooks/budget.mjs` | The per-task budget: limits, status, and the warning |
| `hooks/memory.mjs`, `hooks/memory_cli.mjs` | The project memory and the helper behind `/cc-tiers:memory` |
| `hooks/parallel.mjs` | The registry of running writers, file scope, dependencies, and the cap |
| `hooks/workspace.mjs` | Working-tree snapshots, sensitive and out-of-scope files, and state validation |
| `hooks/telemetry.mjs`, `hooks/insights.mjs` | The local event log and the helper behind `/cc-tiers:insights` |
| `hooks/redact.mjs` | Secret masking before memory, telemetry, and the audit trail |
| `bench/` | The benchmark: the login and hard suites (tasks, fixtures, hidden checks, references), the runner, and measured results |
| `.github/workflows/ci.yml` | Tests on Linux, macOS, and Windows, and `claude plugin validate` |
| `CHANGELOG.md` | Release notes |

## 🔒 Privacy

Nothing leaves your machine, and the command hooks make no network calls. cc-tiers keeps a local event log (see Telemetry and insights), which `telemetry: off` stops. With `classifier: haiku`, the classifier hook sends each `cc-tiers:worker` call's input to Haiku through Claude Code, the same way the session reaches Claude. The hooks read the routing files, the plugin options Claude Code already passes in, the session transcript, and cc-cost's local plugin data when that plugin is installed. They write the attempt counter under the plugin data directory (`latest.json` and one file per session), the event log `events.jsonl` (and `events.1.jsonl`) there unless telemetry is `off`, and, when learning is on, `.claude/cc-tiers-history.json` in the project plus one line in `.git/info/exclude`. When memory is on they also write `.claude/cc-tiers-memory.json` in the project, kept out of git by its own line in `.git/info/exclude`. Events hold no prompt or file text, and both files pass through redaction first. Uninstalling the plugin removes the plugin data directory unless you pass `--keep-data`. The history and memory files stay in the project until you delete them.

---

Made with ☕ by [@edsoncantuaria](https://github.com/edsoncantuaria) · [MIT](LICENSE)

If it gets you better answers, leave a ⭐
