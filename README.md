# 🎚️ cc-tiers

**Criteria Tiers for Claude Code**: criteria scaled to the risk of each task, and each task on the model it needs.

### You ask. It researches, writes the spec, gets the work reviewed and re-runs the tests before calling it done.

A Claude Code plugin for Pro and Max subscribers who want work done right the first time. The point is your time and the code, not tokens. You make a short request and do not write the spec: cc-tiers researches the project and writes the acceptance criteria itself. The code follows the docs of the version you have installed and the conventions of your own project, reuses what already exists, and stays inside the task, without you asking for clean code or writing rules for it. Opus reviews the work in a fresh context, a review counts only with a reproduced defect, and the hooks re-run the tests before a pass counts, so you do not have to ask again. Underneath, each task runs on the model it needs (Sonnet for normal work, Haiku for the simple stuff, Opus for the hard tasks such as auth, payments, migrations, concurrency and architecture, and for what Sonnet could not finish), so Opus is not spent on a typo. On the clock a run takes longer than plain Opus.

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
| Research | `cc-tiers:researcher` | Sonnet | Finds the installed version, that version's docs, existing usage, reusable code, and conventions, and how a feature is usually done, before code is written. Does not edit, and runs one read-only shell command at a time |
| Default | `cc-tiers:implementer` | Sonnet | Features, bug fixes, tests, local refactors |
| Trivial | `cc-tiers:worker` | Haiku | Renames, typos, formatting, lookups, simple searches, ~15-line edits |
| Check | `cc-tiers:checker` | Sonnet | A fresh pass over Haiku's output. Does not edit |
| Review | `cc-tiers:reviewer` | Opus | A fresh pass over risky or non-trivial work. Does not edit |
| Light mode | `cc-tiers:dispatcher` | Sonnet | Optional session agent for when the window is tight: it routes on Sonnet and calls Opus only when needed |
| Light plan | `cc-tiers:planner` | Opus | Plans a multi-task request for the dispatcher. Does not edit |
| Light ceiling | `cc-tiers:architect` | Opus | Implements hard tasks and the ceiling for the dispatcher |

While the plugin is enabled, `settings.json` sets the session agent to `orchestrator`. Your own `agent` in `~/.claude/settings.json` still wins. If you override it, `/cc-tiers:tiers` runs the same workflow.

The agents pin `model: haiku`, `sonnet`, or `opus`. The orchestrator does not pass a model on the call, because a per-call override would replace the tier. A PreToolUse hook refuses a cc-tiers delegation that tries.

For a request of two or more writer tasks, or a task that starts on Opus, the orchestrator plans in Claude Code's plan mode: it reads the code and runs the researcher without editing, then writes the plan and calls `ExitPlanMode`. You get one approval click for the plan, and Claude Code titles the session from the plan's first line, so several sessions are told apart by what they do, not by `cc-tiers:orchestrator`. A title you set with `/rename` is kept. With no human to answer, it plans in the conversation as before and says so in the final report. A small change, a question, and a retry skip plan mode.

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

Code written from memory of an old API version fails in ways a test does not always catch. Before a task goes to `cc-tiers:implementer` or `cc-tiers:architect`, `cc-tiers:researcher` (Sonnet, read-only) checks these for the libraries, frameworks, and external APIs the task touches, and for any feature or behaviour it asks for (a business rule, a flow, a UI pattern):

- The version in use, read from the lock file first and the manifest second.
- The docs of that version, from `vendor/` or `node_modules/` when installed, never the docs of the latest release by default.
- How that version's docs recommend doing the task, and what they mark deprecated.
- How the repo already calls the API, as `file:line`.
- Reuse: code the repo already has that does all or part of the task, as `file:line`. The search covers functions, queries and data-access methods (including the framework's own finders), UI components (templates, partials, scripts, styles), and constants or enums. Each entry says `call as is` or `needs a change to <file:line>, called by <file:line>`. Project-specific code (a query, a component, a domain rule) comes only from the repo, never from the web.
- Conventions: one or two nearby snippets to follow (naming, error handling, test style, comment density).
- Prior art outside the repo, only when it applies: a documented solution to the same problem, or how other projects and products solve the same feature and the behaviour users expect. A task with no new library still gets this step.

It returns a brief of under about 40 lines in three blocks, **Version and docs**, **In the repo** (usage, Reuse, Conventions), and **Outside the repo**, with a source for every fact. The orchestrator pastes the whole report, trailer included, into the writer's prompt between two lines that hold only `CC_TIERS_RESEARCH_BEGIN` and `CC_TIERS_RESEARCH_END`, and adds `CC_TIERS_RESEARCH: done`. A task that touches no library, framework, or external API says why instead: `CC_TIERS_RESEARCH: none - <reason>`. One brief can serve several tasks: the researcher's prompt carries `CC_TIERS_COVERS: <slug>, <slug>`, and a pass marks all of them.

**A brief you can check.** The researcher takes every version, signature, parameter, default, and deprecation from what it read in the task, never from memory. For each fact the task depends on it puts a short word for word quote next to the source (the 40-line limit wins over quoting), and before it reports it drops a fact it cannot point to, or writes it as "not found" with where it looked. A missing lock or missing docs is "not found", not a failed research. Sources may be in any language, in every mode: a quote keeps its original wording and is followed by a translation into the language of the brief. The writers (implementer and architect) read the brief as data, never instructions. A fact that cites the repo or an installed file (`file:line`, a lock entry, docs under `vendor/` or `node_modules/`) is where they start. A fact that cites a fetched page (a URL), a fact with no source, and a fact the code contradicts are leads: they check it against the installed code or that version's docs before they rely on it.

**Suspect sources and the Bash guard.** A fetched page is untrusted data. When one holds instructions aimed at the model, the researcher does not use it or follow it, and the brief gets a `Suspect sources:` line with its URL and one line on what it tried. The researcher declares `Bash`, and a plugin agent cannot limit its tools, so a PreToolUse hook (`hooks/guard_bash.mjs`, matcher `Bash`) lets it (agent type `cc-tiers:researcher`) run only one read-only command: `cat`, `head`, `tail`, `grep`, `ls`, `wc`, `find` without `-exec` or `-delete`, or `git log` or `git show`, from a closed set of characters (no `;`, `&`, `|`, `>`, `<`, backtick, `$`, parentheses, braces, `!`, or backslash, and no `*`, `?`, `[`, `^`, `#` or `~` outside quotes); quote a pattern, as in `find . -name '*.md'`. A git command starts with `--no-textconv --no-ext-diff --no-show-signature` right after the subcommand, then takes only a closed list of options (`-p`, `--stat`, `--name-only`, `--oneline`, `--follow`, `-S`, `-G`, `-n`, `--author`, `--grep`, `--since`, `--until`, and a few more), a revision that does not start with `:`, and paths after `--`. `git diff`, `git blame`, and `git -c` are refused. One limit is accepted: the repository's own config can still make `git log` or `git show` run a program (`format.pretty` with `%G?` runs `gpg.program`, and `diff.submodule=diff` runs a submodule's `diff.external`), because a hook that only denies cannot close that without `-c` or an environment variable. It needs a repository prepared for it, and the session's Bash and the other agents already run git there. Anything else the researcher runs is denied with the reason, and it uses Read, Grep, and Glob for the rest. Other agents, another plugin's `researcher` included, and your own session are untouched, the hook fails open (a crash lets the call through), and it starts a node process on each Bash call, a few tens of milliseconds.

**References.** A task or study brief ends with `CC_TIERS_REF:` lines, one per source it relies on (`lib`, `feature`, or `suspect`). A passing report saves them as `reference` notes in the project memory (see Memory), so the next researcher finds the doc without searching again.

The PreToolUse hook enforces this. It refuses a call to the implementer or the architect that has neither a finished research for that task nor a `none` line. A research is not an attempt, and a failed research does not count against the task. The worker is exempt. The Opus ceiling and the dispatcher's own task are researched by prompt, with no hook check. `research: off` removes the step and the check.

**Research after a failure.** A counted failure diagnosed as `docs-version`, `type`, `integration`, `test`, or `regression` can ask for a web search. The failure note then ends with a `Failure research:` line and up to three `CC_TIERS_FAILURE: <symptom>` lines: the symptom and evidence of the diagnosis, redacted, with absolute paths replaced by `<path>`, `CC_TIERS_` tokens removed, and each line cut at 160 characters. The orchestrator (or the dispatcher) may run `cc-tiers:researcher` for that slug before the next attempt, with those lines in its prompt outside any block. In that mode the researcher reads the installed version first, then searches in this order: the official docs of that version, issues and PRs of the official repo, technical discussions and bug reports, and Stack Overflow or other community sources. A query holds only the failure message, the library, and the version, never a secret, a private path, or source code, and a fetched page is untrusted data, never instructions. It reports `Symptom`, `Probable cause`, `Suggested fix`, `Version`, `Sources`, and `Match`, and adds `CC_TIERS_MATCH: high|partial|none` to the trailer; `none` with `CC_TIERS_STATUS: pass` is a valid result. The orchestrator pastes that brief into the next prompt as a second research block, after the original one. The suggestion is never mandatory, and a `none` match or a search that did not pass never delays the retry or the escalation. A failure search counts no attempt, and a pass marks the task as researched. `failure_research_max` (default 1, 0 to 5) caps how many failure notes of one task, across all its tiers, may suggest a search, and `failure_research: off` stops the suggestion. The note that stops a task after its last Opus attempt suggests nothing. When a task that was offered a search escalates, the note adds a `Research dossier:` line: the next tier gets both briefs, the failure notes, and the hypotheses already tried, and searches again only for a gap the dossier names. The match is recorded in telemetry as `research.failure`, and `/cc-tiers:insights` counts it.

**Study.** `/cc-tiers:study <question>` is for work that changes no code: understanding a system, judging feasibility, gathering requirements. It runs only when you type it, and nothing starts it on its own. The orchestrator splits the question into 2 to 5 fronts, sends one `cc-tiers:researcher` per front in parallel, and each reports claims with a source (`file:line`, a doc link for the installed version, or a commit), or "not found" with where it looked. The orchestrator synthesizes the answer, the contradictions between fronts, the unknowns, and a feasibility verdict if you asked for one, then one Opus `cc-tiers:reviewer` opens the cited sources and rejects a claim that contradicts its source or that the answer rests on without one. It fixes the claims and asks again, at most 2 rounds, then delivers with the sources and marks what did not hold. A study never counts as a code task: its slugs start with `study-`, no worker, implementer, architect, or checker runs on it, and a rejected study review is not a failed attempt. The session is titled `Study: <question>`.

**QA.** `/cc-tiers:qa <change, PR, module, bug or fix>` investigates as a QA engineer would. A phrase of yours never starts it (`disable-model-invocation: true`): you start it by typing the command. It has three modes: an audit of a change, a PR or a module, a bug investigation that reproduces the bug before explaining it, and a fix validation that checks the confirmation (the reproduction that was red is now green) and the regression around the fix. It follows Agile Testing, Explore It! and ISTQB CTFL 4.0, with a `techniques.md` that is read only when the cases are designed. It edits no production code: a reproduction test goes only in a test file and is cited in the report, and you decide whether it stays. Typed, it runs as a study: slugs are `study-qa-<topic>`, with no spec, attempt, or verify, and a `cc-tiers:researcher` only for a library or version question the repo cannot settle. Each finding is typed (confirmed bug, suspicion, risk, coverage gap, test not run), then one `cc-tiers:reviewer` checks them in Claims mode, at most 2 rounds. The reviewer runs the command behind each confirmed bug and compares its output with the claim, and a claim that does not hold is a `trace` finding. A standalone run that confirms a bug ends with the line the fix task takes under `Repro:` (``- `<command>` fails before the fix with <message>``) and starts no fix task. The orchestrator (not the reviewer, and not the dispatcher in light mode) also reads the QA method itself in two cases, with no study slug, researcher, or claims review: the task's own review checks the result. Trigger 1: a bug fix that starts on Opus with no clear reproduction is investigated before its spec. It writes no file, only read-only commands and the existing tests. A red command becomes the `Repro:` criterion and the defect `file:line` goes into the spec; when the reproduction needs a new test, the `Repro:` criterion names that test and its command, and the Opus attempt writes it first. With no reproduction, the best hypothesis goes under `Assumed:`. It is skipped under `hard_start: sonnet` or while budget routing conserves. Trigger 2: after a review passes a task of high or critical risk with a `note` finding whose observed starts with `unconfirmed:` (a suspicion the reviewer could not settle), the orchestrator runs one focused QA investigation on that point, at most once per task. The reviewer only writes the note, which never blocks. If the investigation confirms it, the task goes back to the tier that wrote it with a `Repro:` criterion added; if not, the report says it was refuted and what was exercised. The task report carries a `QA trigger 1|2: <result>` line.

---

## 🧹 Clean code without asking

The writers carry these rules, so a project needs no CLAUDE.md rules for them:

- Call existing code as it is. Change code that other code calls (its body, signature, or visibility, an extraction, a removal) only when the spec or the task names that change; otherwise stop and report. Never fork a copy unless the spec names it. Code this work created (this diff or an earlier commit of the same work) is not "other code". The brief's Reuse block says where to look.
- A new query, data-access method, or UI component only when the repo has none. The reason line says what was searched.
- Follow the docs of the installed version, and the conventions of the file being edited.
- Touch only what the task needs: no drive-by refactor, reformat, rename, or dependency bump.
- No hypothetical protection: retry, cache, fallback, or compatibility only when something real consumes it.
- Fix the cause, not the symptom: no swallowed error, silenced lint or type check, skipped test, or test special-casing. An unavoidable workaround carries a one-line comment saying why.
- No speculative code: an abstraction, option, or new file only when the task or a real second caller needs it; no impossible-state checks, no leftover debug output.
- Comments only for what the code cannot say.
- Stop when it is verified. No extra passes.

When the brief says a reuse needs a change, the orchestrator (or the dispatcher) keeps the code unchanged with a `Preserve:` line if the task can be done calling it as is. If not, it asks you before delegating, with the recommended option first: keep it unchanged and copy only the part the task needs (the spec names the copy), or change it (the spec names the change and a callers check). With nobody to answer, it takes the recommended option, named under `Assumed:`. A writer that stops because the reuse needs a change the spec does not name brings the same question before the retry.

The reviewer blocks code that recreates what the project already has, and changes outside the task (both `scope` findings). The reviewer and the checker also block a diff that changes or removes existing code other code calls when the spec or the task does not name it (a `regression` finding: the callers at `file:line` must keep their behaviour). Before passing, they search the repo for each new query, data-access method, component, or constant by table and column, concept, and literal value, and an equivalent is the recreated-code finding, except when the spec names the copy. The reviewer also blocks a change that hides a failure instead of fixing its cause, with no comment saying why (`correctness`), and a new file the task does not need (`scope`). Hypothetical protection, speculative code, leftover debug output, style, comment noise, and naming taste are notes: they reach the final report and never fail a task.

---

## 📝 Specify and ask

Research says what is true; the criteria say what done means. Before a task that writes code goes to `cc-tiers:implementer` or `cc-tiers:architect`, the orchestrator (or the dispatcher) writes the acceptance criteria itself, from the request and the research, so you do not have to. The flow is research, specify, ask (only if needed), implement, review.

The criteria ride in the delegation prompt between two lines that hold only `CC_TIERS_SPEC_BEGIN` and `CC_TIERS_SPEC_END`, in under about 15 lines:

- `Criteria:` observable results.
- `Edge cases:` inputs or states that could break it.
- `Assumed:` (only when needed) what was chosen where the request was silent.

Every line says where it came from: `(request)`, `(repo: file:line)`, `(docs: <link or path>)`, `(decided: <why>)`, or `(user)` for an answer. The same block goes to the implementer and to the reviewer or checker of that task. The implementer builds and tests each line, and the reviewer rejects a criterion or edge case that is not met or not tested. A retry or an escalation reuses the block.

**When it asks.** Only when two reasonable readings lead to different code and neither the project nor the docs of the version in use decide. Everything else it decides and marks `(decided: ...)`. It asks once, before implementing (the one exception is the reuse question above, after a writer stopped for it), all questions together, at most 3, with `AskUserQuestion` as multiple choice and the recommended option first, with its reason. Your answer goes into the block as `(user)`.

**When nobody can answer.** If `AskUserQuestion` is unavailable or denied, it takes the recommended option, lists it under `Assumed:`, says so in the final report, and does not wait.

**New code is reachable.** For a new module, component, handler, or job, one criterion names how the new code is called (a route, an import chain, an init call). New code that nothing calls does not meet the request, and the reviewer reports it as a blocking `correctness` finding.

**Reproduce before the fix.** For a bug that can be reproduced in code, the criteria carry a `Repro:` section with the command that reproduces it, for example ``- `node --test tests/x.test.mjs` fails before the fix with <message> (request)``. An infrastructure, environment, or flaky failure and a bug that cannot be reproduced have no `Repro:`: that fix is validated by other means, in proportion to the risk, and a new test is required only when it is viable and relevant. A writer (the worker, the implementer, the architect, the Opus ceiling, the dispatcher's own task) writes or finds that test first and runs it before it changes any code, then reports how it failed, before the criterion lines: ``CC_TIERS_REPRO: `<command>` - <failure before the fix>``. It makes the smallest fix, runs the same command again, and lists it in `CC_TIERS_VERIFY`. It never weakens, skips, or deletes the reproducing test to make it pass. When the bug cannot be reproduced, it reports `CC_TIERS_REPRO: none - <reason>`. On a retry or an escalation the fix may already be in the tree, so the writer repeats the earlier `CC_TIERS_REPRO` line from the failure notes instead of reporting a new failure. The same block, `Repro:` included, goes to the review. See Spec contract and completion for how the hook judges it.

**Approval of the criteria.** `contract_approval` (default `critical`; `high` or `off`) says which tasks need your OK on the criteria first. Before the first delegation of a task at or above that risk, the orchestrator shows you its criteria and asks once with `AskUserQuestion`, recommended option first, then adds `CC_TIERS_APPROVED: user - <how>` to the delegation. When no human can answer, it adds `CC_TIERS_APPROVED: none - <reason>` and says so in the final report; the task then finishes at moderate confidence at most, with the reason `criteria not approved by the user`. The PreToolUse hook refuses a call to the worker, the implementer, or the architect that has criteria, a risk at or above the option, and neither line, until the task's contract holds an approval. A retry needs no new line, but a `CC_TIERS_RESPEC` that adds, drops, or rewords a criterion voids the approval and asks again. A task whose only risk factor is a keyword in the text is `high`, not `critical`, so the default does not ask for it. `off` asks nothing.

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

**What the hook runs.** Only when the report is `pass`. It runs each command as argv, without a shell, in the project directory. A line with any of `` ; | & > < ` $ ( ) `` or a line break is refused, and on Windows also `% ! ^`. So is a line that carries code instead of naming a repo test: a `data:` or `javascript:` URL anywhere, or, after the program, a flag that loads or evaluates code (`--import`, `--require`, `-r`, `--loader`, `--experimental-loader`, `-e`, `--eval`, `-p`, `--print`, `--script-shell`, `--node-options`, `--userconfig`, `--globalconfig`, also abbreviated, as npm expands them, and as `--flag=value`). That refuses `node -p` and `pytest -p` too, and the rule holds on every line. Only the arguments of a program that runs no code with those flags are exempt (`grep`, `egrep`, `fgrep`, `rg`, `sort`, `ls`, `wc`, `diff`, `head`, `tail`, `cut`, `uniq`, `du`, `phinx`, `systemctl`), so `phinx status -e test`, `grep -E` and `systemctl --user` run. Refused on top of that: a bundle of short flags that holds a code flag (`perl -we`, `sh -lc`), `-c` of `python` and the shells, `python -m pytest` judged as `pytest`, `pytest -o addopts` (and `--override-ini`), `--env-file` and `--prefix`, a node test reporter other than `spec`, `tap`, `dot`, `junit` and `lcov` (and a destination other than `stdout` or `stderr`), and for git `--output`, `--no-index`, `--ext-diff`, `--textconv`, `--config-env` (abbreviated too), and `-c` or `-p` before the subcommand. Every `git diff` the gate runs adds `--no-ext-diff --no-textconv`, so the repository's config cannot make it run a program. Two forms are read by the hook itself: `KEY=value` at the start becomes an environment variable (`APP_ENV=testing vendor/bin/phpunit`), and `cd <dir> && <command>` runs in `<dir>`, relative to the project directory, which must be inside the project, symlinks resolved; an absolute `<dir>` inside the project runs as its relative form, and one outside it is refused. The checks the gate detected for that line are the ones `<dir>` declares: the project's plus `<dir>`'s in a normal project, only `<dir>`'s in a folder of repositories (see below). Keys that change which program runs or load code first are refused, in any case: `PATH`, `PATHEXT`, `LD_*`, `DYLD_*`, `GIT_*`, `NODE_OPTIONS`, `NODE_PATH`, `npm_config_*`, `PYTHONPATH`, `PYTHONSTARTUP`, `PYTHONHOME`, `PYTEST_ADDOPTS`, `PYTEST_PLUGINS`, `BASH_ENV`, `ENV`, `PERL5OPT`, `PERL5LIB`, `RUBYOPT`, `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`, `PHPRC`, `PHP_INI_SCAN_DIR`. The allow list is checked on what is left.

**Allow list.** `verify_allow` is a comma-separated list of prefixes, compared on whole words: `npm test` matches `npm test -- x`, not `npm testx`. The default covers `npm test`, `node --test`, `npx tsc`, `npx eslint`, `npx vitest`, `npx jest`, `npx playwright test`, PHPUnit, PHPStan, PHPCS, `pytest`, `go test`, and `cargo test`, plus five reads: `wc -l`, `grep -c`, `git diff --name-only`, `git diff --stat`, and `git status --short`. The gate also runs a command that is exactly one of the checks cc-tiers detected in the project (the ones the writer's context block lists, such as `npm test` when `package.json` has a `test` script, `make test`, `make check` or `make lint` when the Makefile has that rule, or `composer test` when `composer.json` has that script), with no entry: the match is the whole command, not a prefix, so `make test CENARIO=x` still needs an entry. `php -l`, `bash -n`, `sh -n` and `node --check` also need no entry, as long as exactly one argument follows and it is a file of that tool (`.php`, `.phtml` or `.inc`; `.sh` or `.bash`; `.js`, `.mjs` or `.cjs`): they only parse, and any option (including `+n`), a second file or any other word makes the line a plain command again. A `docker exec`, `docker compose exec` or `docker-compose exec` line is judged by the command it runs inside the container, so when the list or the detected checks cover that command the wrapper needs no entry: `docker exec app vendor/bin/phpunit` runs on the default list. Before the container name the gate accepts only `-i`, `-t`, `-w` and `-u` for `docker exec`, and `-T`, `-w`, `-u` and `--index` for compose; any other option (`-e`, `--env-file`, `--privileged`, `-d`) makes the line a plain command again, refused unless the list covers it. With a `KEY=value` before it, the gate does not look inside the container, because `DOCKER_HOST`, `DOCKER_CONFIG` and the like choose what docker runs: such a line runs only if `verify_allow` covers the docker command itself. `docker exec` itself is not in the default: an entry for it would allow any command inside the container. A `verify_allow` value replaces the default list, so add the entry your project needs, such as `make check`, after the entries already there. The list limits the shape of the command, not what a test executes: a test is repository code, and the agent can already write code.

**Project allow list.** A project may add to the list with a `verifyAllow` array of strings in `.claude/cc-tiers.json` (prefixes, compared as above). The gate and the check of a reviewer's command findings use the entries through one function that reads the file once and compares the hash of those bytes with the one the session stamped when its state was first opened. A file created or changed after that, a session with no plugin data directory to keep the stamp, and a `verifyAllow` that is not a list of strings add nothing, and the gate says so (`project verifyAllow not applied: ...`, or `ignored: ...`): a new session picks the file up. A state file that went missing or unreadable in the middle of a session is never stamped again, so the file is not applied until a new session, and a review that rejects on a command finding says why the list was not applied. So an attempt cannot widen the list its own report or its review is judged by. A file that exists when the session begins goes into `.git/info/exclude` (never `.gitignore`), unless git tracks it, which is the team's; a file created during the session stays in `git status` and in the attempt's diff, and a change to it is a sensitive file for the workspace guard (see Workspace guard). The session context lists the entries in effect.

**Outcomes.**

- A command that exits non-zero runs once more. Passing the second time is a pass, reported as `flaky`. Failing twice is a failure, and the note for the next attempt carries the command, the exit code, and the last 40 lines of output. When the budget leaves no time for the second run, or cuts it short, the first failure stands.
- A command that hits `verify_timeout` (default 300 s) is **not validated**, not a failure: the message says `timed out after N s: <command>`, it is not run again, the next lines still run, and the writer's own run stands only as declared evidence. A suite longer than the limit is the environment's, not the code's, and the review still runs.
- `verify_budget` (default 600 s) caps the whole report, retries included. At Stop it caps all the parked passes together, so they fit the hook timeout. Commands past it do not run and are listed as not validated. That is not a failure, so a slow suite does not push the task up to Opus.
- A failure stops the commands after it.
- A command outside the list, a `none` line, or a refused line is **not validated**: nothing runs and it is not a failure. The message names the prefix to add to `verify_allow` in `/config` (for a wrapped line, the command inside the container, without the paths and `NAME=value` arguments it ends with), keeping the entries already there. For a command it did not run (not a `none` line), it adds that the command was not re-run, so the writer's own run stands only as declared evidence.
- A command that cannot start (the program is not installed) is **not validated** too: `could not start: <command>`. Nothing ran, so it says nothing about the code and is not a failure. So is a syntax check (`php -l`, `bash -n`, `sh -n`, `node --check`) of a file that is not there: `file not found: <command>`, not run, because it could only fail.
- A command that already passed on the same tree (same `HEAD`, same content in every changed file) is not run again: the report says `reused for the same tree`. The gate that runs at Stop, for the Opus ceiling and the dispatcher, reuses a pass the same way. A pass that was `flaky` is never reused: it runs again and keeps its `flaky` label.
- A command that exits zero but creates, deletes, or changes a file that git tracks or does not ignore is **not validated**: `changed the tree: <paths>`. It cannot count as evidence, because the tree it proved is not the one it left. The hook compares `git status` and the content hashes before and after each command. Outside a git repository, or for a reused pass, nothing is compared.
- While another writer that is not isolated runs in the same tree, that check is skipped, because its edits are not the command's. The gate says `tree check skipped: <task> still writing`, and the command counts as before.
- A `pass` with no `CC_TIERS_VERIFY` line counts as a failure.

**A folder of repositories.** When the project directory is outside git and has a child that holds `.git`, a line with no `cd` would run in the wrong place, so the gate does not re-run it. It is **not validated**, not a failure, and the message says `<line>: the gate runs from <projectDir>, a folder of repositories; write `cd <repo dir> && <line>``, ahead of any advice about `verify_allow`. `cd <repo> && make test` runs as a detected check, because the checks come from the repo in the `cd`, not from the folder. A one-file syntax check runs without the `cd`. A line with no `cd` also runs when every file of the task's `CC_TIERS_FILES` sits in one child repository that holds `.git`: it runs there. A file given as an absolute path inside the folder counts by its relative path. A project that is not a folder of repositories behaves as before.

**One gate at a time.** Two gates of the same project never run together. The gate takes a lock file (`gate-<hash>.lock`) in the plugin data directory, which holds `pid@host` of the gate that took it and is taken over only when that process is gone or the file is older than 660 s (a pid from another host, such as a container sharing the data directory, is not checked with `process.kill`, so only the age frees it), and waits for it only within what is left of `verify_budget`. A gate that cannot take it re-runs nothing and reports `another cc-tiers gate was running: <command>`: **not validated**, not a failure. A result that is already cached takes no lock, and gates of different projects do not wait for each other. A reviewer's command findings take the same lock before their first command, and one that cannot get it leaves the finding unchecked, so it keeps blocking.

**A failure that was already there.** When the only failing command fails the same way without the writer's change, the report can say so with `CC_TIERS_PREEXISTING: <command> - <evidence it fails without the change>`, before `CC_TIERS_STATUS: pass`, and keep that command in its `CC_TIERS_VERIFY` lines. The writer shows it on a scratch copy of `HEAD` outside the repo, never on the shared tree. Once per task, and unless `review_policy` is `never`, the hook does not count a gate failure of exactly that command when every other command ran and passed; any other failing command counts as always. The same holds when the gate did not run that command and the only mandatory criteria the report fails are checks of exactly that command: the writer's pass is taken the same way, those criteria are reported `unverifiable` and inherited, and the completion is `partial`. A `cd` to an absolute directory inside the project in the declared line is read as its relative form. The task goes to `cc-tiers:reviewer` (Opus), which must confirm that the command fails on a copy of the base without the change, and rejects when it does not. Only the Opus reviewer can confirm it: a call to `cc-tiers:checker` for that task is refused, and a checker pass does not finish it. The completion line is `partial` at most, with the real counts of checks.

The final report says, per task, `verified: <commands>`, `flaky: <command>`, or `not validated: <reason>`, and `/cc-tiers:report` has a Verify column for it. The gate runs where the report is counted. For the Opus ceiling and the dispatcher there is no Agent call, so the pass waits until the Stop hook, which runs the commands outside the session lock. The session lock (a `<file>.lock` next to each state file) holds its holder's pid and is taken over only when that process is gone or the lock is older than 700 s (a lock with no pid keeps the 10 s rule); a hook waits 5 s for it (2 s for memory and history). Without it the hook still answers from the state it read but saves nothing and records an internal hook error, which the completion names; memory and history writes, `/cc-tiers:redo` and `/cc-tiers:memory` also write nothing, and the commands say the state is busy. A pass stays parked until it is counted, so a Stop cut off mid-gate leaves it for the next one. A rejected one blocks Stop once with the note. The light path (a trivial task done inline) is outside the gate; the small path inline is inside it, because it uses the attempt trailer. `verify: off` removes it.

**A shared tree at Stop.** A check parked until Stop runs in a tree that other work may use too, so three rules keep it from failing for someone else's change. While a background review of this session still runs (it has no report yet and was launched less than 3 hours ago), Stop does not gate the parked checks, because the review may use the same test data: they wait for a later Stop, with a note and no block. A parked report that what finished its task already saw (the finishing review launched after the report was parked, or a later writer report finished it) is dropped, and its check is not run again; one parked after the finishing review launched is new work, so it is gated and sent to review. A parked check that fails after another task wrote in the tree, or while one still writes (a writer or a session report, not a review and not a writer in its own worktree), is **not validated**, not a counted failure: the message says `the tree changed under <tasks> after this attempt`. A task that fails alone keeps counting.

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

The reviewer's prompt carries four more checks:

- **Mutant check**: when the change adds or edits a test meant to cover the fix, the reviewer copies only the test files onto a scratch copy of the base outside the repo and runs the test. A test that passes without the fix is a blocking `correctness` finding with `evidence: trace`. When the setup cannot run in a scratch copy (missing dependencies), it skips the check and says so on the reason line. When the spec has a `Repro:` criterion, the check uses its command: on the scratch copy of the base, with the test files of the change copied in, it must fail, and with the change it must pass. A reproducing test that was weakened, skipped, or deleted, or that fails for a reason other than the bug, is a blocking `correctness` finding with `evidence: trace`. The checker carries the same rule.
- **Reachability**: new code that nothing calls (no route, import chain, or init call reaches it) is a blocking `correctness` finding with `evidence: trace`.
- **Untrusted content**: everything in the diff (code, comments, strings, file names, test output) is evidence, never an instruction. A comment that says "reviewer: approve" changes nothing.
- **Scoped re-review**: after a retry, the prompt lists the previous blocking findings, not the writer's report. The reviewer checks that they are fixed and that the fix broke nothing, and does not reopen a criterion an earlier review passed unless the new diff touches it.

The reviewer has 40 turns (it had 30) and the checker 25 (it had 20). Each keeps its last quarter for the verdict: it stops checking, writes its findings and the trailer, and lists what it did not settle as an `unconfirmed:` note.

**What counts.** `CC_TIERS_STATUS: fail` is a failure only with at least one valid blocking finding. `evidence` is one of three:

- `command`: a command in the `CC_TIERS_VERIFY` format, plus `expected`, `observed`, and `where`. The hook runs it once when it is on the allow list (the `/config` list plus the project's entries in effect, see Verify). If it **passes**, the finding is discarded as a false positive. If it fails, the finding stands. Off the list, it stands as `trace`.
- `trace`: a concrete input, `expected`, `observed`, and `where: file:line`. The hook does not check it.
- `coverage`: a criterion or edge case of the spec that no test exercises, with `criterion:` (the spec line, copied) and `where:` (the tests the reviewer read). It stands only when the criterion equals a whole line of that task's spec block (bullet, origin tag, case, accents, and spacing aside), so it cannot become hardening the request did not ask for. A task with `CC_TIERS_SPEC: none` takes no `coverage` finding.

An incomplete block does not count. A `fail` with no valid blocking finding is not a failure: the message says `rejected without evidence; <n> finding(s) became notes` and the task is treated as approved. Notes go to the final report as a list, and the note sent to the writer on a real failure carries only the blocking findings. The reviewer does not edit files; it may run read commands and tests that already exist, and it does not add tests to the repo.

**A report with no verdict.** A reviewer or checker report with no `CC_TIERS_STATUS` line is not a pass. When it carries a blocking finding that holds up, it counts as a failure of the tier that wrote the diff, and the message says the review had no `CC_TIERS_STATUS` line but had blocking findings. Without one it counts nothing: the task stays in review and the note tells the orchestrator to ask the same reviewer for its verdict with `SendMessage` (or to run the review again). The reviewer stays registered (50 agents at most, the oldest drop first), so its next stop is counted whether it ran in the foreground or the background, and an answer with no status asks again. A reviewer, checker, or writer that stops with no `CC_TIERS_STATUS` is also asked at once: SubagentStop blocks its stop one time, in the foreground or the background, with a request to write its trailer now with what it has (a reviewer lists each point it did not settle as an `unconfirmed:` note, a writer the `CC_TIERS_VERIFY` commands it ran). It asks once per agent, never while a stop hook is already continuing the agent, and not when a blocking finding that holds up already counts the review. When a review still has no verdict at the end of a turn, Stop asks the orchestrator, naming the agent, to send for it with `SendMessage`, up to 3 times per agent across all its stops, then only tells you. It stops asking when another review of the task was counted or the task finished, and never while the reviewer runs (a reviewer resumed by `SendMessage` counts as running until it stops again). A review's status is read from its report only: a status line in its prompt, such as a pasted earlier trailer, is ignored. A review of a task with no writer attempt on record is not counted either: it charges no tier, asks for no retry, and the note says that no writer attempt was recorded for the task (`final-gate`, which reviews the whole integrated diff, is exempt).

**A rejection belongs to one attempt.** It sticks to the writer attempt the review judged. A pass from another review of that attempt does not clear it or finish the task, and a further rejection of the same attempt adds its findings but not a second failure. A task that stopped at the Opus ceiling stays stopped. The next writer report clears the mark, because it is a new attempt, except the session's own pass that waited for the Stop gate while its review rejected it: that is the judged attempt, so the rejection stands. A rejection judges only the attempts parked before the review was launched (its start time for a background review, the time it ran for a foreground one): an attempt made after the review started is new, and the rejection of the one before no longer sticks to it. A pass that covers an attempt still parked does not finish the task on the spot: that attempt runs its own gate at Stop and is counted, and the task finishes as reviewed on that evidence. If that gate fails, it counts as a failure, except for an attempt the review itself judged: its gate failing at Stop is not a second failure, whichever of it and the covered fix is counted first, and the other covered attempts stay covered. A `final-gate` pass launched before a counted `final-gate` rejection saw the rejected diff, so it does not clear that rejection. Limit: a slice launched before the next writer report that arrives after it is charged to the new attempt.

**A large diff.** When the last writer attempt changed more than 15 files, one review may run out of turns, so the review delegation gets a note to review in slices: one `cc-tiers:reviewer` per group of related files, plus one integration review over the whole diff, each with the spec block. A call that is already one of those slices goes on.

`review_evidence: off` goes back to 0.6: any reviewer `fail` counts. Limit: the hook does not check `trace` evidence, so a made-up trace still counts.

---

## 🔁 Escalation

A failure is a failed test, a rejected review, or a subagent error. The task may fail **twice** at its tier (`max_attempts`, default 2). The next attempt moves up, and the failure notes go with it:

**Haiku → Sonnet → Opus**

**Hard tasks start on Opus** (`hard_start: opus`, the default). A task that matches an Opus review keyword (auth, payments, migrations, schema, security, concurrency, plus `risky_extra`), or that needs an architecture decision with trade-offs, a bug fix with no clear reproduction or across modules, or an investigation with competing hypotheses, skips Sonnet. It still gets research, the spec, the verify gate, and the Opus review. The orchestrator implements it (in light mode, `cc-tiers:architect`), and if the Opus attempts fail it stops and tells you. While budget routing conserves, it starts on Sonnet one effort level up. `hard_start: sonnet` restores the 0.7 behavior: Opus implements only what Sonnet could not finish. The files the task names decide how far a keyword goes (`CC_TIERS_FILES`, or the paths in the request). When the keyword is only in the text and every named file is an ordinary one, a name with an extension that is not a sensitive path, the task does not hard-start: it starts on Sonnet one effort level up, with risk `high` (the factor `risk keyword, no sensitive file named`), and its review cannot be skipped. With no file named, a directory, a name with no extension, or a sensitive path such as `src/auth.js`, it stays a hard start on Opus. Either way a risk keyword alone gives risk `high`, never `critical`: `critical` needs a sensitive path among the files the task edits (see Risk assessment). The keyword scan of a delegation skips fenced code blocks (```), so a quoted error such as `permission denied` no longer raises the effort or forces a review: the orchestrator, the dispatcher, and the tiers skill paste only error output and failure notes inside a fence and say in prose what the task changes, so the task's own words are still read. An unclosed fence counts as prose, the writer's report is still read whole, and a sensitive path and `CC_TIERS_RISK` work as before. A keyword that shows up only as text (docs, a quoted example, `git checkout` in an instruction) is not a risk at all: the orchestrator adds `CC_TIERS_RISK: none - <reason>` to that delegation, and the hook drops the hard start, the effort boost, and the routing hint. A line with no reason is ignored, and the writer's report is still checked, so a result that touches risky code is reviewed as usual.

**Writer mode** (`writer`, in `/config` only: there is no project key). `tiers`, the default, is everything above. `opus` makes every new task, trivial ones included, the session's own Opus attempt (`because: writer`, and `cc-tiers:architect` in light mode), and a new `cc-tiers:worker` or `cc-tiers:implementer` call for a new task is refused. Research, the spec, the verify gate, and the review stay as usual. `alternate` uses `opus` on even local days (counted from 1970-01-01) and `tiers` on odd ones. A task keeps the mode it recorded first. A task started while budget routing conserves routes as in `tiers` and is recorded as `tiers`, so it does not count in the `opus` row. The point is a comparison on your own work: `/cc-tiers:insights` has a By writer mode table (see Telemetry and insights).

**A task too large for one writer.** Before the first delegation, the orchestrator (or the dispatcher) splits a task that crosses several layers (data, back end, front end), or holds more work than one writer can finish in its turns, into several slugs, each with its own `CC_TIERS_FILES` and spec, and `CC_TIERS_DEPENDS` where one needs another. Many files alone is no reason: a mechanical edit across them is one task. The implementer and the architect pace their turns: they read only what the brief, the spec, and the named files point to, write the first change and its test early, and, when the task cannot fit their turns, deliver the part that closes and report failure with the reason `too large: split into <parts>`. That is an ordinary failure of the slug: the retry follows the attempt rules, with the part that is left named in its prompt, and the slugs are not split again after the first delegation. The worker has no such rule: it reports `not a trivial task` for an edit that is not done within a few turns. The reviewer, checker, and researcher keep their last turns for the verdict or the brief.

The new tier starts at zero. Opus is the last stop: the orchestrator does that work itself, and if those attempts fail too it stops and tells you. A review rejection counts against the tier that wrote the diff, not against the checker or the reviewer. Budget routing does not block this ceiling. The exception is a failure diagnosed `unverifiable`: at the limit the task stops instead of moving up (see Failure diagnosis).

A hook on the Agent tool keeps the counter. When it reports `cc-tiers counted a failure`, that count is the one the orchestrator follows.

The hooks enforce what the prompts ask for:

- **Before a delegation** (PreToolUse), a call to a cc-tiers agent is refused when it passes `model`, has no `CC_TIERS_TASK` header, or sends an escalated task back down a tier. `CC_TIERS_TASK` is the only header a delegation must carry: the agent type gives the role and the tier, so `CC_TIERS_TIER` and `CC_TIERS_ROLE` lines are optional, and a review is charged to the tier that wrote the diff (the attempt waiting for its gate, then the task's counter, then the log, and a `CC_TIERS_TIER` line last). Sending a task up early (`/cc-tiers:escalate`) moves the counter with the notes carried.
- **Research** (`research: on`, the default): a call to the implementer or the architect is refused when its task has neither a researcher pass nor a `CC_TIERS_RESEARCH: none - <reason>` line.
- **Failure research** (`failure_research: on`, the default): a counted failure of a searchable kind gets a note that suggests a web search, up to `failure_research_max` per task. It refuses nothing: the suggestion is never mandatory (see Research first).
- **Specify** (`specify: on`, the default): a call to the implementer or the architect is refused when its prompt has no `CC_TIERS_SPEC_BEGIN` / `CC_TIERS_SPEC_END` block with content and no `CC_TIERS_SPEC: none - <reason>` line.
- **Verify** (`verify: on`, the default): a writer's `pass` counts only after the hook runs the `CC_TIERS_VERIFY` commands that the allow list, the detected checks or the one-file syntax checks cover. A `pass` without those lines, or with a command that fails, counts as a failure. The Opus ceiling and the dispatcher are verified at Stop.
- **Evidence** (`review_evidence: on`, the default): a reviewer or checker `fail` counts only with a valid blocking finding. The hook re-runs the finding's command and discards one that passes, and a `fail` with no finding becomes notes.
- **Contract** (`specify: on`): a retry or an escalation that drops or rewords a criterion of the stored spec is refused until the prompt says why in `CC_TIERS_RESPEC: <reason>`. When the last counted failure of a writer named a criterion that the `CC_TIERS_RESPEC` drops or rewords, the spec was the cause: that failure is uncounted, once per task and only for the same tier (a respec after an escalation finds nothing to uncount). The note says which criteria changed, the audit records it, and telemetry gets a `failure.uncounted` event, which `/cc-tiers:insights` and `/cc-tiers:report` show.
- **Criteria approval** (`contract_approval`, `critical` by default): a call to the worker, the implementer, or the architect that has criteria and a risk at or above the option is refused until the prompt carries `CC_TIERS_APPROVED: user - <how>` or `CC_TIERS_APPROVED: none - <reason>`.
- **Task budget** (`task_budget_*`): a writer call for a task over its budget is refused until the prompt carries `CC_TIERS_BUDGET: override - <reason>`, after you agreed.
- **Parallel writers**: a writer call whose files overlap a running writer, or that waits on a task in `CC_TIERS_DEPENDS`, is refused, and so is one past the `max_parallel` cap. So is a `CC_TIERS_DEPENDS` slug that no delegation in the session had, and a dependency cycle.
- **Background agents** are counted too. The launch records the agent id and when it started, and SubagentStop counts the report when it finishes. The note reaches the orchestrator on its next delegation, or at the end of the turn. A background writer's pass that arrives after the task's review passed is not counted again when that review was launched after this writer: the task stays finished, and the note says to send a new diff to review only if that writer was still editing when the review started. A writer launched after the review, or a pass whose gate fails, still counts. An agent of any role that stops with no `CC_TIERS_STATUS` stays registered (50 at most, the oldest drop first), so its next stop, after a `SendMessage`, counts. SubagentStop reads the `SubagentHandback` of the agent's latest run before its last message, so a reworded trailer in the last message does not hide the report; a `SendMessage` from the session (origin `coordinator`) starts a new run, and an earlier hand-back is not its report. The hand-back is the text the hand-back row carries, so that row is its twin and does not count again. When the hand-back is not in the file yet and the last message has no `CC_TIERS_STATUS`, SubagentStop waits up to 2 s (10 tries of 200 ms), and only for a background agent cc-tiers registered or a reviewer, checker, or writer (the roles that owe a trailer). When SubagentStop did not count a background agent's report, the hand-back row it leaves in the main transcript does, as a fallback (a user row or the `queued_command` attachment written when the hand-back arrives mid-turn, and a peer user row that carries only `origin.body`): a research report counts at once, and a reviewer or writer report is parked and judged or gated at Stop. An agent resumed by `SendMessage` counts as running again until it stops once more: a resumed reviewer holds the parked checks (the 3 hours of that hold count from the resume), and a resumed writer is not released as idle. A review counts from its latest resume, not only its launch, so a reviewer resumed after a new attempt judges that attempt; a review resumed with no new attempt still does not clear a rejection. A writer resumed by `SendMessage` is a new attempt, the same report that arrives by both paths counts once, and a rejection goes to the tier of the writer. A rejection parked until Stop marks as judged only the writer attempts parked before the review was launched (and before its own row); an attempt made after it in the same turn is new.
- **The Opus ceiling** has no Agent call, so the orchestrator marks its own attempt with a Bash heredoc that starts with `cat <<'CC_TIERS_ATTEMPT'` and ends with a line `CC_TIERS_ATTEMPT`. A `CC_TIERS_TASK` / `CC_TIERS_TIER: opus` / `CC_TIERS_ROLE: orchestrator` header opens it before the first edit, and a second heredoc closes it with the same lines plus the criteria, `CC_TIERS_VERIFY`, `CC_TIERS_STATUS`, and `CC_TIERS_REASON`. When the task has a spec block, its `CC_TIERS_SPEC_BEGIN` to `CC_TIERS_SPEC_END` lines go inside the opening heredoc: the hook stores them as the task's criteria, held like a writer delegation's (a `CC_TIERS_RESPEC` that fixes a criterion the last failure named uncounts it), and judges the closing `CC_TIERS_CRITERION` lines against them. The hook counts that trailer like any other report, and among Bash commands reads it only from such a heredoc: any other Bash command is never read as a trailer. A trailer written in the message text is still read, the same trailer in the text and in a heredoc in one response counts once, and a later response that repeats the lines counts as another attempt. The dispatcher marks its attempt the same way.
- Parallel agents share one counter file per session, behind a lock, written atomically.
- **API and network errors** (overloaded, rate limit, 5xx) are not failures. The hook says so and the same tier runs again, so an outage does not push work up to Opus. An Agent call that failed before an agent started (`cannot create agent worktree`) is not a failure of the writer either: the hook says so, and the same tier is delegated again once the error is fixed.

---

## 🪜 Effort

Each tier also has an effort ladder. A retry at the same tier runs one effort level higher before the task changes model, on the bet that more thinking on Sonnet can fix what would otherwise take a new model, and so the notes stay in one context:

| Tier | Attempt 1 | Attempt 2 | Attempt 3+ |
| --- | --- | --- | --- |
| Haiku | `low` | `medium` | `medium` |
| Sonnet | `high` | `xhigh` | `xhigh` |
| Opus (`cc-tiers:architect`) | `high` | `xhigh` | `xhigh` |

The PreToolUse hook sets `effort` on the Agent call (Claude Code's per-call `effort`, 2.1.292+), so the orchestrator cannot forget it. It may ask for a higher level, never a lower one, and never above the top of the ladder. A risky task, one that matches a review keyword, starts one level up: on Sonnet (`hard_start: sonnet`, while conserving, or when the keyword is only text and every named file is ordinary) at `xhigh`, and on `cc-tiers:architect` at `xhigh` too. While budget routing is conserving, effort stops at `high`. When the Opus orchestrator implements the ceiling itself, it keeps its own session effort. `CLAUDE_CODE_EFFORT_LEVEL`, when set, wins over all of this.

`effort_ladder: off` leaves each agent at the effort its file pins. A project can replace a ladder in `.claude/cc-tiers.json` with `effort.haiku`, `effort.sonnet`, `effort.opus`, and `effort.conserveCap`. The reviewer and the planner run at the first rung of the opus ladder, and the checker at the first rung of the sonnet ladder, only when a project ladder (`.claude/cc-tiers.json`) sets that tier; otherwise they keep the effort their agent file pins (reviewer and planner `high`, checker `medium`).

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
- **Small path** (follows `light_path`). A short request (40 words or fewer) that matches no Opus review keyword, scores 0 on complexity, and would start on Sonnet gets a `cc-tiers small path` note. The session agent reads the target first. If the change fits in about 20 lines of one file (its test file aside), has a clear expected result, and uses no library API it has not seen in the repo, it does it itself: no plan, research, or subagent, a spec of one to three criteria, a reproducing test for a bug fix when the file has tests, and its attempt trailer with `CC_TIERS_REVIEW: skip`. The verify gate re-runs its `CC_TIERS_VERIFY` commands, with no review pass. The light-mode dispatcher does the same with its dispatcher trailer. With `delegate`, or while budget routing conserves, it is one `cc-tiers:implementer` call with `CC_TIERS_RESEARCH: none`, a short spec, and `CC_TIERS_REVIEW: skip`. A bigger or risky change, or doubt, takes the usual route, and so does a request that mentions login, payments, or migrations, on purpose. The note is left out for a prompt that ends in `?`, opens with a question or analysis word (only the first word counts, such as `qual`, `como`, `what`, `how`, `should`, `analisar`, `explain`, `review`, `o que`, `por que`), or names several tasks (`todos`, `all`, `em partes`, `esses`, `both`, a labeled range or pair such as `prioridade 1 e 2` or `do 1 ao 6`). It also needs a verb that names a change (`add`, `fix`, `rename`, `corrija`, `troque`, `crie` and the like), and it is left out for a continuation or an acknowledgement, a question, research, or validation ask (`pesquise`, `valida`, or a first word such as `research`, `check`, `confer`), and a decision that only points back to an earlier proposal (`isso`, `assim`, `dessa forma`, `do that`, `go with that`, `that one`). In the 163 real prompts of a week that got the note, this drops it from 150 to 10. `off` turns it off with the light path.
- **Light mode**, the `cc-tiers:dispatcher` session agent on Sonnet. It does one ordinary task itself, marking the attempt with a `CC_TIERS_ROLE: dispatcher` trailer that the hooks count, so two failures still move it to Opus. It calls Opus only for three things: `cc-tiers:planner` for a request with more than one task or a design decision, `cc-tiers:architect` for a hard task or one that used its attempts on Sonnet, and `cc-tiers:reviewer` for risky work.

The light path and small path notes end with the same rule: a request that only asks for an answer, an explanation, a study, or an opinion, and changes nothing, is answered in the session, with no slug, spec, or implementer. The session model decides that, not a keyword list, which misread real change requests in both directions. Only the small path note is held back by a narrow check (a change verb, the closing `?`, the first word, the several-task and points-back patterns above), and when unsure there is no note: a missing note costs nothing, a wrong one misroutes. The orchestrator follows the rule when no note appears.

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

0.11 adds one option, `contract_approval`, and tightens these controls: a verify command may not change the tree, a failure the repo cannot test stops instead of escalating, a failure that was already there can be declared and confirmed by the Opus reviewer, a critical task's criteria are approved before it starts, and a review can read the project's own rubric.

0.11.1 adds two options, `failure_research` and `failure_research_max`, and builds on the same controls. A failure can ask for a web search on what it printed (Research first). A bug fix is reproduced by a test before it is fixed, and the hook keeps what the writer declared about that (`Repro:` in Spec contract and completion). A package the manifest declares and the tree lacks does not cost an attempt (Failure diagnosis). The Stop gate reuses a verify pass on the same tree, the completion line says how many attempts and escalations a task took and how many checks were reused, and `/cc-tiers:insights` shows how each start tier fared.

0.12 adds one option, `writer`, and one command, `/cc-tiers:redo`. The verify gate also runs the checks cc-tiers detected and looks through `docker exec` and compose exec lines. A delegation needs only `CC_TIERS_TASK`, the hook numbers the criteria, and a review keyword that is only text, with ordinary files named, no longer forces the Opus start. A review with no status line, a rejection that a later pass cannot wipe, and a large diff reviewed in slices are handled by the hook, and `/cc-tiers:insights` counts the tasks you sent back and compares writer modes. 0.13 changes how the hook reads risk, reports, and the gate: a risk keyword alone is `high`, and `critical` needs a sensitive path among the files the task edits; an agent's report counts by any path (SubagentStop first, the hand-back row in the transcript as a fallback); the Opus attempt trailer is a Bash heredoc; the gate runs one-file syntax checks and the detected `make` and `composer` checks, asks for `cd <repo> &&` in a folder of repositories, and runs one gate at a time per project; the diagnosis has a `data` category and no longer takes a bare 5xx for infra; re-asks count only prompts a person typed; and the small path note stays away from questions, analyses, and requests for several tasks.

0.13.2 changes how the hook counts what is not the model's fault: a command that hits `verify_timeout` is not validated, no longer a failure; a `cd` to an absolute directory inside the project runs as its relative form; lock and busy-resource output is a confirmed infra diagnosis; a hand-back is read in every row shape and by the agent's latest run, and counted once; a pass whose only failed criteria check the pre-existing command takes the pre-existing path; a `CC_TIERS_RESPEC` that fixes a criterion a failure named uncounts that failure once per task; and the small path note needs a change verb and stays away from continuations, research, validation, and decisions that point back.

### Risk assessment

The hook scores each task from the request, the files it names, the history, and the project, on five dimensions of 0 to 3, and derives a level: `low`, `medium`, `high`, or `critical`.

- **Complexity**: the Classifier's score.
- **Regression**: a public-contract word (`endpoint`, `public api`, `contract`, `breaking`, `signature`) adds 2. A dependency or version word, or a manifest or lock file, adds 1. Files in three or more top-level directories add 1, and so does an earlier Sonnet failure on a similar task.
- **Sensitivity**: 3 for a sensitive path among the files the task edits, which is a whole word such as `auth`, `login`, `session`, `payment`, `migration`, `schema`, `secret`, `token`, `jwt`, `password`, or an `.env*` file. Those files are the `CC_TIERS_FILES` entries first, plus the paths in the text that an entry covers (`.`, a directory, or a glob); without that header, the paths the text names. 2 for a risk keyword (the factor `risk keyword`, or `risk keyword, no sensitive file named` when it is only in the text and every file the task names is an ordinary one; see Escalation), and 2 for persistent data (`database`, `sql`, `persist`, `drop`). A keyword alone never reaches 3.
- **Ambiguity**: one for each hedge ("maybe", "not sure", "figure out", "talvez") and one for two or more question marks.
- **Evidence**: 0 when the project has tests (a test directory in any letter case, such as `test` or `Test`, a `test` script in `package.json` or `composer.json`, a `test:` rule in a `Makefile`, `makefile`, or `GNUmakefile`, or a runner config), 1 when that is unknown, 2 when it has none, and 1 more after a Haiku failure on a similar task.

Sensitivity 3 is `critical`, so a risk keyword alone (sensitivity 2) is `high`. Sensitivity 2, regression 2 or more together with complexity 2 or more, or a sum of 6 or more over complexity, regression, ambiguity, and evidence, is `high`. A sum of 2 or more, or any regression or sensitivity, is `medium`. Anything else is `low`. `/cc-tiers:route` prints the level next to the tier, with the scores and the factors behind it, and `risky` keeps its old meaning. Abridged, for "Add a login endpoint to src/auth.js and a users table migration":

```
{ "tier": "opus", "because": "hard", "risk": "critical",
  "riskDimensions": { "complexity": 0, "regression": 2, "sensitivity": 3, "ambiguity": 0, "evidence": 0 },
  "riskFactors": ["risk keyword", "sensitive path: src/auth.js", "public contract"] }
```

What the level changes:

- A task that looks like Haiku work but has `high` or `critical` risk starts on Sonnet (`because: risk`). Under `hard_start: opus`, a Sonnet task of `critical` risk starts on Opus.
- A `critical` task starts its writer one effort level up, like one that matches a review keyword.
- The writer's prompt gets a context block, between `CC_TIERS_CONTEXT_BEGIN` and `CC_TIERS_CONTEXT_END`, with the ids of the spec's criteria in order (`Criterion ids for CC_TIERS_CRITERION lines, in spec order: C1 <text>; ...`, when `specify` is on) and the project's checks that fit the risk (see Profiles). Reviewer and checker prompts get the ids line too. The block is data, not instructions.
- A writer cannot close with `CC_TIERS_REVIEW: skip` when it changed a sensitive file its prompt did not name, when its risk is `critical`, or when its risk reaches the profile's review floor. `review_policy: never` is the only way past that. A file listed in `CC_TIERS_FILES` (its exact path or a listed directory) counts as named. A file that you, or another Claude Code session in the same transcript folder, edited with an edit tool while the writer ran is named on its own line and not charged to the writer; an edit made through Bash leaves no path, so it still is. Writers close with `CC_TIERS_REVIEW: pending` unless the prompt says `skip`: the review policy and the risk decide, and the hook overrides a `skip` that a floor forbids. A task that matches an Opus review keyword keeps its review too, whether it starts on Opus or on Sonnet because the keyword is only text: a keyword factor of either kind makes the review mandatory, so a keyword-only task, `high` and not `critical`, cannot skip it.

### Spec contract and completion

The spec block becomes a numbered contract. The hook reads the lines under `Criteria:`, `Preserve:`, `Checks:`, `Repro:`, `Security:`, `Evidence:`, and `Edge cases:` as `C1`, `C2`, and so on, and stores them at the task's first delegation. `Assumed:` and `Ambiguous:` stay notes.

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

- A writer reports each criterion before the trailer, as `CC_TIERS_CRITERION: C<n> pass|fail|unverifiable|na - <evidence>`. `na` and `unverifiable` need a reason, and the last line for an id wins. The hook supplies the ids: the context block of a writer, reviewer, or checker delegation lists them in spec order, as one count over every section of the block, so the prompt does not number the criteria itself. It also reads ` — `, ` – `, `: ` and `(<evidence>)` in place of ` - `, and a line behind a bullet or inside backticks. A line it still cannot read is named in the note, and that criterion counts as pending.
- A `Checks:` criterion with a backticked command is evidenced only when that exact command passes in the gate. A leading `cd <dir> && ` is the one difference allowed: a criterion without it is evidenced by the same command run behind any `cd` (a folder of repositories needs one), and a criterion with it needs the same directory. The same rule matches a `Repro:` command, its `CC_TIERS_REPRO` line, and `CC_TIERS_PREEXISTING`. Without a backticked command it stays unevidenced.
- A `Repro:` criterion with a backticked command is evidenced only by three things together: that command passes in the gate now, the writer's report that passed holds a ``CC_TIERS_REPRO: `<command>` - <failure before the fix>`` line for the same command, and an independent review (the reviewer or the checker) passed. Without the review it is a declared pass: the status is `pass`, the evidence says `not yet confirmed by a review`, and it does not count in `Criteria with evidence`. With the command passing and no before line it stays `pending` (`no failure-before evidence`). With `CC_TIERS_REPRO: none - <reason>` it is `unverifiable`, and the reason is the evidence. Nothing is refused: the hook cannot run the command on the base, so the declared failure is a claim that only the review's mutant check tests. A task with a `Repro:` criterion is not review-skipped: the orchestrator's and the dispatcher's prompts do not set `CC_TIERS_REVIEW: skip` on it, because only an independent review confirms it. The hook reads the `CC_TIERS_REPRO` line from the report that passed, which is why a retry repeats it. A `Repro:` line with no backticked command is an ordinary criterion.
- A `pass` or an `na` the writer only declared is evidence after an independent review passed, never before, and never gives high confidence.
- A retry or an escalation that drops or rewords a criterion is refused. When the criterion was wrong, the prompt says why in `CC_TIERS_RESPEC: <reason>`, and the change is audited. When the last counted failure of the writer named that criterion, the failure is uncounted, once per task and for the same tier only (audit, `failure.uncounted` event, shown by `/cc-tiers:insights` and `/cc-tiers:report`).
- The reviewer's and the checker's prompt must carry the same spec block, or the call is refused.

When a task passes, the hook prints one completion line:

```
cc-tiers completion: users-pagination verified on sonnet, high risk; confidence high (gate verified 1 command). Checks run 1, passed 1, failed 0, not run 0. Criteria with evidence: 4/4.
```

When the task failed or moved up before it passed, the line says so after the tier, as `on sonnet after 2 failed attempts and 1 escalation`, and when the gate reused checks from the same tree it says `Checks run 2 (1 reused)`. A task that passed on the first try with nothing reused reads as before. The counts are the task's counted failures and escalations, so a failure skipped as infra or pre-existing is not in them. The status is `verified`, `partial`, `failed`, or `unverified`. `verified` needs a verified command, no `na` that only the writer declared, evidence for every criterion from the profile's evidence risk up, and a review pass for `high` and `critical` risk. `failed` is a failed gate, a rejected review, or a failed criterion. Confidence is `high`, `moderate`, or `low`, and the reasons come after it. A `critical` task with no review is always `low`, and a line ends with `Remaining:` when something is open. Criteria approved with `CC_TIERS_APPROVED: none` cap the confidence at `moderate` (`criteria not approved by the user`). A failure declared with `CC_TIERS_PREEXISTING` keeps the status at `partial` at most. `specify: off` removes the contract.

After the completion line, a task with criteria gets a table of them, to paste into the commit body or the PR description:

```
cc-tiers criteria for users-pagination (paste into the commit or PR):
| Criterion | Status | Evidence |
| --- | --- | --- |
| C1 GET /users takes a cursor and returns the next page | pass | node --test test/users.test.mjs |
| C2 GET /orders keeps its current response | pass | reviewed: the orders route is unchanged |
| C3 `node --test test/users.test.mjs` | pass | node --test test/users.test.mjs |
| C4 the cursor is validated before it reaches the query | pass | reviewed: a cursor that is not an id gets a 400 |
```

A criterion's `Status` is `pass`, `fail`, `unverifiable`, `na`, or `pending`, and `Evidence` is the command that passed, or what the writer or the review said. A `pass` that no command or review confirmed shows `declared`, a `pending` criterion has no evidence, a long cell is cut, and a `|` in a cell is escaped.

### Failure diagnosis

A failure is classified before the next attempt: `syntax`, `type`, `test`, `regression`, `requirement`, `docs-version`, `dependency`, `integration`, `architecture`, `security`, `infra`, `flaky`, `scope`, `data`, `coverage`, `defect`, `unverifiable`, or `unknown`. The source is the reviewer's finding category when there is one (`coverage` when its evidence is `coverage`, `defect` when it is `trace` and the category would give `test`), and the output of the gate or the error otherwise. A review rejection records its diagnosis in telemetry and in memory, like a gate failure. The note for the next attempt carries it:

```
Diagnosis: dependency (confirmed by the output). A module, package or command the code needs is missing from the environment.
Next: The environment is missing something: fix it, then rerun. Do not change code until then.
```

- `retry`: syntax, type, test, regression, requirement, integration, and scope, with what to read first. `data` retries too: fix the seed or fixture in the repo (changing it is allowed), ask for the data when the repo cannot supply it, or fix the code when it mishandles that missing or empty data. `coverage` retries too: the review found a criterion of the spec that no test exercises, so the note says to write the missing test for that criterion, then rerun the suite. `defect` retries too: a reviewer traced a defect in the code without running it, so the note says to retry with the finding (expected, observed, where), fix the cause it names, and add a test that shows it. `unknown` retries with no advice, and the note says `cc-tiers could not tell the cause from the report`.
- `retry-research`: docs-version. Run `cc-tiers:researcher` again for the installed version. When the failure note suggests a failure search (see Research first), that search replaces this advice.
- `rerun-env`: dependency, infra, and flaky. Fix the environment and rerun; do not change code.
- `escalate`: architecture and security.
- `report-partial`: unverifiable. At the attempt limit the task stops instead of moving up a tier, with a message that asks for the part that can be verified, a `partial` report, and the missing test setup named.
- The same failure twice (quoted text, paths, and numbers aside), or no attempt left, moves the task up as well. At Opus it is `stop`.

`unverifiable` is a failure the repo cannot exercise, so another attempt, at this tier or a stronger one, could not be checked either. Only the reporter's own reason decides it (a line of runner output never does), it is the last rule (any other category wins), and it never applies when the reason or the output speaks of security, auth, login, a session, a role, a permission, 401 or 403, an API key, a JWT, a token, a secret, a credential, or a password: such a failure is never reported as partial. The reason has to say that it cannot be tested, reproduced, or verified here; a missing test or a missing credential alone proves nothing.

`coverage` is a review rejection whose blocking finding has `evidence: coverage`, whatever its category: no test failed, so nothing is sent to a failure search. `defect` is a review rejection whose blocking finding has `evidence: trace` and a category that would otherwise give `test` (`correctness`, `error-handling`, `concurrency`, `state`): no test ran, so nothing is sent to a failure search either; `evidence: command` keeps `test`, and `api-usage` stays `docs-version` even from a trace. `data` is a seed, fixture, or test data with a fault word on the same line (`lacks`, `missing`, `empty`, `incomplete`, `already holds`, `not seeded`, `faltam`, `vazio`); an empty table or `no rows` alone does not count, because it is as often a code bug. It comes after `infra`, so a down database stays infra, and before `test`, and it is not sent to a failure search. A 5xx alone in the output of a check (`5xx`, `HTTP 500`, `status 503`) is not `infra`: it may be the system under test answering 500, so it falls to the other rules.

A diagnosis is **confirmed** only by a reviewer category (the note says `confirmed by the review`, and memory records `review finding`) or by the output of a command (`confirmed by the output`), and for dependency and infra only by a machine signature (`Cannot find module`, `command not found`, `ECONNREFUSED`, `ENOSPC`, `EADDRINUSE`; and, for a lock, a resource another run holds, or a database collision, `database is locked`, `Deadlock found when trying to get lock`, `Lock wait timeout exceeded`, `SQLSTATE[HY000] [2002]`, `could not obtain|acquire|get [the] lock`, `resource temporarily unavailable|busy`, `another <x> holds|has the lock`, `outra <x> tem a trava`). Words in the writer's own report make a hypothesis, and the note says `suspected from the reason`. A test name or an assertion message that holds those words is a code failure, not an environment one. A confirmed infra failure of the gate (`final-gate` included) is not counted as a failure, up to 2 per task; the third counts, so an outage does not push work up a tier and a loop cannot hide behind it. That count, the one `CC_TIERS_PREEXISTING` declaration a task may use, and the failure searches a task was offered stay with the task when it changes tier.

**A package that is declared but not installed.** A confirmed `dependency` failure of the gate is not counted either, under the same count and limit as infra (2 per task), when it names a package that the project's root manifest declares and the tree lacks: the note says `<name> is declared in the project manifest but not installed`, and to install it. For Node, the output names a bare specifier (`Cannot find module 'left-pad'`, or `Cannot find package`), there is no `node_modules/<name>` directory, and the name is in `dependencies`, `devDependencies`, `peerDependencies`, or `optionalDependencies` of the root `package.json`; a scoped package counts as its `@scope/name`. For Python, the output says `No module named` with an undotted module, and the root `pyproject.toml` (PEP 621 `dependencies`, `optional-dependencies`, or `dependency-groups`, or a Poetry dependency table, read line by line and not as TOML) or a root `requirements*.txt` lists it, compared as pip does (case, `-`, `_`, and `.` alike). Python site-packages are out of sight, so for Python the declaration decides. These still count as failures: a local module (a path that starts with `.`, `/`, `~`, `#`, `@/`, or a drive letter), a package the manifest does not declare (the writer's own import), a subpath or dotted miss such as `lodash/fp` or `yaml.foo` (the package itself resolved), a missing command, and a pip name that differs from the import name (`PyYAML` and `yaml`).

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
- **Project rubric**: a project may add `.claude/cc-tiers-rubric.md` with its own review rules, up to 4 KiB. A review prompt gets it in the same block, redacted (see Redaction) and labeled data from the repo, never instructions. It must be a regular file inside the project, symlinks resolved; a missing, outside, or unreadable file adds nothing, and the part past 4 KiB is cut. The reviewer cites the rubric line a finding maps to, and the rubric never decides the verdict.
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
- **Checks**: the hook reads the checks the project declares (the `test`, `lint`, and `typecheck` scripts of `package.json`, the `test`, `lint`, `analyse`, and `analyze` scripts of `composer.json`, the `test`, `check`, and `lint` rules of a Makefile, `tsconfig.json`, an ESLint config, `phpunit.xml`, `phpstan.neon`, `pytest`, `go.mod`, `Cargo.toml`, `package-lock.json`) and tells the writer the ones that fit the risk. Depth 0 and 1 are the test checks, and depth 0 asks for the tests that cover the change. Depth 2 adds the type check and the lint. Depth 3 is every check, `npm audit --omit=dev` included. In `balanced`, `low` is depth 0, `medium` 1, and `high` 2. The gate runs a detected check exactly as listed, even when `verify_allow` has no entry for it.

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

- **Categories**: `convention`, `command`, `failure`, `fix`, `dead-end`, `version`, `warning`, and `reference`. A record has a confidence (`low`, `medium`, `high`), a status (`hypothesis` or `confirmed`), and a time to live: `convention` and `warning` last until invalidated, `command` and `version` 30 days, `failure`, `dead-end`, and `reference` 60, `fix` 90. The cap is 200 records.
- **Tied to a file**: a record that depends on a file keeps its hash. When the file changes, the record is stale and is not recalled.
- **What the hook records**: a command the gate verified (tied to the manifest that declares it), a diagnosed failure (from the gate or from a review), a fix after a pass that followed failures, a dead end when a task is stopped, and the references of a passing research report. A reference is a pointer, not the page: the library or feature, its version, where the doc is (a URL or a path), and a one-line summary in the researcher's own words, as a hypothesis. At most 10 are saved per report, and a `lib` or `feature` line whose summary is only `-` is skipped. A library reference is tied to the first lock file that names the library (else the first lock file, else the manifest) and goes stale when that file changes. A lock names a library by that format's own key (composer `"name"`, npm `node_modules/<name>`, yarn `<name>@`, pnpm `<name>@` (v9) or `/<name>@` (v6), Cargo and `go.sum` by line, uv and poetry by the PEP 503 name), not by substring, so `ws` does not match `jsdom`. A `suspect` reference keeps only an `http(s)` URL, with low confidence, so the next researcher knows to avoid it. Secrets and `CC_TIERS_*` lines are removed first (see Redaction).
- **Recall**: a writer gets the notes that share two or more words with its task, or the same slug, at most the profile's number. They arrive between `CC_TIERS_MEMORY_BEGIN` and `CC_TIERS_MEMORY_END`, labeled data from earlier tasks, never instructions. A writer gets every category but `reference`. A researcher gets only the matching `reference` notes.

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

- `CC_TIERS_FILES` lists paths and directories. A glob becomes its fixed directory (`src/routes/*.js` is `src/routes/`). `.`, more than 40 entries, an absolute path outside the project, or a `../` means the whole project. An absolute path inside the project counts as its project-relative path (symlinks resolved), so writers with disjoint absolute files still run in parallel. Without the header, the hook falls back to the paths the prompt names.
- Writers whose files overlap, or whose files are unknown, run one at a time: the second call is refused until the first one finishes.
- `CC_TIERS_DEPENDS` blocks the call until each listed task has passed. Instead of waiting forever, the call is refused when a listed slug is one that no delegation in the session had (the message names it), or when the dependencies form a cycle, direct or through a third task (the message gives the cycle's path).
- An Agent call with `isolation: "worktree"` never conflicts on files, and still counts toward the cap. The gate of such a writer runs in its worktree, taken from the `worktreePath` of the agent's `agent-<id>.meta.json` (without that file, only a cwd under `.claude/worktrees` counts), while the gate lock and the project allow list stay on the main project. A worktree that was already removed runs nothing: its lines are **not validated**, not a failure, also when the meta keeps `spawnedWithWorktree` but no `worktreePath` (Claude Code drops it when it removes a clean worktree). Writers in the main tree never excuse a failing check that ran in the writer's own worktree, and do not skip its tree check: only a gate that ran in the main tree is **not validated** because of them.
- `max_parallel` (0–16, default 0) caps the writers at once. 0 takes the profile's cap: 4 for `balanced`.
- A writer whose report never came back is released after 2 hours, and Stop releases every idle one (background writers stay). `CC_TIERS_RELEASE: <slug>` in a delegation frees one by hand.
- After writers that ran with `isolation: "worktree"` pass, the orchestrator integrates each result into the working branch in `CC_TIERS_DEPENDS` order (cherry-pick or merge its commit), stops at the first conflict and reports it, never resolves one with `-X ours` or `-X theirs`, and runs the verify gate on the integrated tree, not only in each worktree.
- A request with two or more writer tasks gets one more `cc-tiers:reviewer` call on the whole integrated diff before the final report, under the pseudo-task slug `final-gate`: every spec block, and a `CC_TIERS_VERIFY` line for the project's broad test command. Like any review prompt it carries the diff, never the writers' reports. It has no writer attempt, so its own prompt is its contract: the hook stores that prompt's spec block and runs its `CC_TIERS_VERIFY` lines through the gate (the same parser, allow list, and lock as a writer's), only when the prompt's own task is `final-gate`. A `final-gate` pass whose gate fails is a failure, and a `final-gate` pass after a `final-gate` rejection finishes the task.
- Agents that share the tree never run `git stash`, `git checkout`, `git reset`, `git restore`, or `git clean` on it. A baseline comes from a scratch copy outside the repo.

### Workspace guard

Before and after each writer attempt the hook takes a snapshot of the working tree: `git status` and a hash of the content of every changed file. What the attempt changed is the difference, and the hook reports two things the prompt did not ask for:

- **Sensitive files** the prompt did not name: `.env` files, key material, SSH keys, credential and registry credential files, CI workflows, lockfiles, Claude settings, the project's own `.claude/cc-tiers.json`, git internals, `Dockerfile` and Compose files. Such a pass cannot skip review. The snapshot lists `.claude/cc-tiers.json` whenever it exists, even when git excludes it, so a change to it is seen.
- **Files outside `CC_TIERS_FILES`**, when the header is there. A test file counts as in scope when it tests a declared file by name.

When the tree has more than 400 changed files, the snapshot is cut and gives no fingerprint. Another task that is open in the same checkout can change files too, and the note says so.

On every load, the task state is validated. An entry with a bad slug, an unknown tier, a bad failure list, or more failures than the limit below Opus is dropped, written to the audit, and reported to the orchestrator once.

### Telemetry and insights

With `telemetry` set to `on` (the default), the hook appends one small event per transition to `events.jsonl` in the plugin data directory: `task.received`, `risk.assessed`, `model.selected`, `research.done`, `research.failure`, `criteria.defined`, `implementation.done`, `verify.done`, `failure.diagnosed`, `escalated`, `review.done`, `task.passed`, `task.stopped`, `budget.warning`, `state.recovered`, `task.redone`, and `task.redo.undone`. An event holds whitelisted fields (slug, tier, risk level, category, counts), never prompt or file text, and passes through redaction. The file rotates once to `events.1.jsonl` above 1 MB. `reduced` keeps only `escalated`, `failure.diagnosed`, `task.passed`, `task.stopped`, `budget.warning`, `task.redone`, and `task.redo.undone`; `off` writes nothing. Nothing leaves your machine.

`/cc-tiers:insights` reads that log and prints failures by category, escalation reasons, estimated cost by risk level, gates that were not validated, and confidence on the tasks that passed. It also prints two tables of what happened, with no advice. **Routing in hindsight** has one row per tier a task started on (the tier of its first `model.selected` event): the tasks, how many passed there without escalating, how many escalated and the tier each finished on, how many stopped, and how many passed after a blocking review finding. **Failure research by match** has one row per `CC_TIERS_MATCH` a failure search reported (`high`, `partial`, `none`, or `unknown` when the report had no valid one): the searches, the tasks that had one, and how many of those tasks passed later without escalating. When tasks that started on Opus at `low` or `medium` risk passed with no escalation, no diagnosed failure, and no blocking review finding, a line says `Possibly over-routed: N task(s) ...` and that it is a hint to look at, not a verdict. A sample under 10 tasks is marked small, and the output says it is not a reason to change routing. The command never edits config or routing.

**Re-asks.** `/cc-tiers:redo <slug> [reason]` marks a done task as sent back by you, and `/cc-tiers:redo --undo <slug>` removes one mark. The slug is looked up in this session first, then in the newest other session that has it. The hook also counts a re-ask by itself: a prompt typed by a person (not a slash command, a subagent hand-back, a task notification, or a system notification) that names a done task of this session by its slug as a whole word and holds a complaint word (`still`, `broken`, `again`, `wrong`, `ainda`, `quebrou`, and the like, in English and Portuguese) adds a mark and says so, with the `--undo` command to take it back. The prompt text is never kept. Each mark writes a `task.redone` event with the tier, the reason (clipped to 200 characters and redacted), and the `source` (`command` or `prompt`), and an undo writes `task.redo.undone`. With `telemetry: off` no event is written, and the mark stays in the session state.

`/cc-tiers:insights` turns the marks into `Sent back by the user: N of M tasks`, a table of them by the tier the task finished on, and, in Real use, a sent-back column in the Projects table. The figure is a floor: a re-ask counts only when you marked it or your prompt named the task and complained. Once a task has recorded a writer mode, a **By writer mode** table has one row per mode: the tasks, how many were done with no failure, how many you sent back, how many had a blocking review finding, and the estimated USD. Real use has the same table without the blocking column.

### Redaction

Memory, telemetry, and the audit trail store only text that went through `hooks/redact.mjs` first. It masks private keys, provider keys (`sk-`, `pk-`, `glpat-`, `npm_`, `ghp_` and its kin, `github_pat_`, `xox`, `AKIA`, `AIza`, Slack webhook URLs), JWTs, credentials inside URLs, `Bearer`, `Basic`, and `Token` values, `Cookie` headers, `--password` and `--token` style flags, `key=value` pairs whose key names a secret, and e-mail addresses. `[redacted]` replaces the value and the key stays readable.

### Report and session notes

- `/cc-tiers:report` has four more columns at the end: Risk, Completion, Confidence, and Time. Time is measured, shown as `N s` or `N.N min`; the footer says that time is measured and cost is estimated.
- SessionStart lists open work it finds in the session state (a task with failures, a review pending, a writer that was running, a ceiling pass waiting for its gate) and says nothing is rerun automatically: check `git status` and the working tree before delegating or reviewing it again. On a resumed session (source `resume`) the background agents of the previous process are marked stopped, so they no longer hold the gate or the request for a verdict; `compact` leaves them alone, and a later `SendMessage` makes one count as running again.
- A fork (SessionStart source `fork`) carries the task records of its parent session (tasks, log, contracts, evidence, researched, completions, snapshots, depends): the parent is the sibling transcript that holds the fork's first row (the `session_id` of the rows is only a hint, and it can name the session from before a `/clear`). The parent's state file is only read, never written, and the copied rows of the transcript are not folded again, so the parent's attempts are not counted twice. Agents and parked reports stay with the parent, and the note says so; when the parent's state is gone, the note says its tasks start over. A state that comes back missing or corrupt in the middle of a session (after cc-tiers started it) is told in a note and recorded as `state.recovered`, its transcript is not read again, and the project `verifyAllow` file is not applied until a new session.
- The session context states the profile, memory, telemetry, the task budget, whether failure research is on and its cap, the parallel and contract rules in force, and the project `verifyAllow` entries in effect.
- `.claude/cc-tiers.json` may also set `profile`, `memory`, `telemetry`, `maxParallel`, `taskBudgetUsd`, `taskBudgetCalls`, `taskBudgetMinutes`, `budgetWarnAt`, `contractApproval`, `failureResearch`, and `failureResearchMax`. `/config` wins when both are set.

### Hook failures

An internal error in a cc-tiers hook is never taken as a success. `before_agent`, `after_agent`, `subagent_stop` and `stop` catch it, even when `hooks/cc_tiers.mjs` itself fails to load, append one line to `hook-errors.jsonl` in the plugin data folder (time, session, hook, task slug, the redacted error), and say so:

- Before a delegation, a `cc-tiers:*` call is refused with the reason; another agent goes through with a note. The PreToolUse command hook has `"onFailure": "block"`, so a crash it cannot catch, or its 15 s timeout, refuses the call too.
- After an agent, the orchestrator is told the report was not counted, its gate did not run, and the task is not validated.
- On Stop, the stop is blocked once with that warning (only a warning when Claude is already continuing from a stop hook). On a prompt, the warning is added to the context.
- The next hook that works marks the tasks those lines name. Such a task never completes as `verified`: at most `partial`, confidence low, with the reason in the completion line. A task that had already completed loses `verified` the same way, and `/cc-tiers:report` shows `hook error`.

### Limitations

- A SubagentStop that fails cannot block, since that would keep the subagent running: its warning reaches the orchestrator at the next hook that works.
- The state lock waits 5 s (2 s for memory and history). A hook that cannot take it answers from the state it read but saves nothing, so a very busy session can lose a count; the hook records an internal hook error and the completion names it.
- The workspace snapshot comes from `git status`, so files that git ignores are not seen.
- Without `CC_TIERS_FILES`, the scope is the paths named in the prompt. An absolute path inside the project counts as its relative path, and one outside it is dropped, so a prompt that names only paths outside the project has an unknown scope and its writer runs alone.
- Claude Code does not fully document how a hook rewrites the Agent prompt (`updatedInput`), or what PostToolUse sees of it. cc-tiers keeps the state it needs at PreToolUse instead of reading the rewritten prompt back.
- Redaction matches known patterns. A secret in a format it does not know can pass.
- Diagnosis reads text. A flaky or infra call is a hypothesis unless a machine signature confirms it.
- A `Checks:` line with no backticked command cannot be matched to a run, so it stays unevidenced.
- Risk scoring is a keyword and path heuristic, not a reading of the code.
- The `unverifiable` rule is keyword based and errs toward retry: a pytest `test session starts` header, or a word like "author" in the output, keeps it from firing, and the task retries and escalates as before.
- The tree check is skipped while other writers run in the same tree, so a command that changes files then passes unflagged.
- A writer launched after the gate started is not known to it: the check still runs, and that writer's edits can look like the command's.
- The pre-existing confirmation relies on the reviewer running the command on a base copy. cc-tiers does not run it there itself, so a review that passes without running it is taken on trust. The `Repro:` check has the same limit: the hook sees the command pass now, but only the review's mutant check runs it on the base, and the failure-before line is the writer's claim.
- The scrub of the failure lines that go to the web researcher replaces an absolute path up to its first space, so the tail of a POSIX path that holds a space can stay in the line.
- The hindsight table keys a task by its slug, so a slug reused across sessions merges into one task.
- A slug reused in the same session keeps the failure and escalation counts of its earlier run, and the completion line says `after N failed attempts` for them.
- The Bash guard covers only the researcher, allows only what it can match to one read-only command, and fails open: a crash of the hook lets the call through. A reference note is the researcher's summary of a source, kept as a hypothesis, so a wrong summary is recalled as data until it goes stale or you invalidate it.
- A failure search is a suggestion: nothing makes the orchestrator run it, and the cap counts the notes that offered one, not the searches that ran.
- Risk by path judges file names, not code. Auth code in a file with an ordinary name (`src/tokens.js`: "tokens" is not the whole word `token`) starts on Sonnet with a forced review, not on Opus, and a directory whose name has a dot and no trailing slash counts as a file.
- Sent-back figures are a floor. A re-ask in other words is missed, and a prompt that names a slug and complains about something else is counted until you run `--undo`.
- A review slice launched before the next writer report but arriving after it is charged to the new attempt.
- A background review with no report after 3 hours is taken as lost: Stop stops holding the parked checks for it.
- A `docker exec` line is judged by the command inside the container. Whether that container holds the same code as the tree is not checked.
- cc-tiers runs no model benchmark on its own. Telemetry is local and descriptive, and `/cc-tiers:insights` does not tune anything.

---

## 💬 Commands

| Command | What it does |
| --- | --- |
| `/cc-tiers:tiers [task]` | Plan, route, and run the work |
| `/cc-tiers:route [task]` | Name the tier and stop. Runs the same heuristic as the hooks. No edits |
| `/cc-tiers:escalate [slug]` | Move that task up one tier now, notes included |
| `/cc-tiers:study <question>` | Study a system, a feasibility question, or requirements, with no code change: researchers answer each front with sources, and an Opus review checks the claims. Runs only on this command |
| `/cc-tiers:qa <change, PR, module, bug or fix>` | QA investigation: audit, bug reproduction, or fix validation. Edits no production code, and an Opus review checks the typed findings. Only this command starts it; the orchestrator also reads its method in two cases (see QA) |
| `/cc-tiers:report [--all]` | Per-task table for this session: tiers, attempts, effort, review, verify, status, and cost next to Opus rates, then risk, completion, confidence, and measured time. The Verify column says `ok`, `flaky`, or `not validated` |
| `/cc-tiers:memory [list\|add\|invalidate\|delete\|prune\|clear]` | List, add, invalidate, delete, prune, or clear what cc-tiers remembers about this project. No edits to code |
| `/cc-tiers:redo <slug> [reason]` | Mark a done task as sent back by you, so the sent-back figures in `/cc-tiers:insights` count it. `--undo <slug>` removes one mark. No edits to code |
| `/cc-tiers:insights` | Failures by category, escalation reasons, estimated cost by risk, unverified gates, and confidence, plus how each start tier fared (routing in hindsight), the failure research counts, the tasks you sent back, and the writer modes, from the local telemetry. Changes nothing |

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
| `writer` | `tiers` | Who writes new tasks: `tiers` (the routing above), `opus` (the session's own Opus attempt for every new task, trivial ones included), or `alternate` (`opus` on even days, `tiers` on odd). For comparing on your own work. In `/config` only |
| `show_cost` | `off` | `on` shows the estimated cost of each task and the session next to Opus rates |
| `research` | `on` | Require a researcher brief, or a `none - <reason>` line, before code goes to the implementer or the architect. `off` removes the step |
| `failure_research` | `on` | After a counted failure diagnosed as docs-version, type, integration, test, or regression, the failure note suggests running `cc-tiers:researcher` on the failure message and the installed version. Never mandatory. `off` stops the suggestion |
| `failure_research_max` | `1` | How many failure notes of one task, across its tiers, may suggest a search. 0–5. 0 behaves like `off` |
| `specify` | `on` | Require acceptance criteria, or a `CC_TIERS_SPEC: none - <reason>` line, before code goes to the implementer or the architect, and let the orchestrator ask what changes the result. `off` removes the step |
| `verify` | `on` | A writer's `pass` must list the commands that prove it in `CC_TIERS_VERIFY` lines, and the hook runs the ones on the allow list. `off` takes a pass from the report alone |
| `verify_allow` | see below | Comma-separated command prefixes the gate may run, compared on whole words. A value replaces the default, so keep the entries already there when you add one. The project's `.claude/cc-tiers.json` may add entries (see below). `docker exec` is not in the default, but a `docker exec` or `docker compose exec` line runs when the command inside is covered. Blank uses the default |
| `verify_timeout` | `300` | Seconds one gate command may run before it is left not validated (`timed out after N s`). 10–600 |
| `verify_budget` | `600` | Seconds the gate may spend on one report. Commands past it are not validated, not failed. 30–600 |
| `review_evidence` | `on` | A reviewer's `fail` counts only with a blocking finding that has evidence. `off` counts any `fail` |
| `profile` | `balanced` | `balanced`, `quality`, `budget`, or `fast`: effort, evidence, review, parallel, memory, and check depth thresholds. No profile removes a gate |
| `memory` | `on` | Keep small evidence-backed notes per project in `.claude/cc-tiers-memory.json` and give a writer, or a researcher for references, the few that match. `off` neither reads nor writes it |
| `telemetry` | `on` | `on` writes one small event per transition to `events.jsonl` in the plugin data directory, `reduced` only failures, escalations, and outcomes, `off` nothing. Nothing leaves the machine |
| `max_parallel` | `0` | Writers at the same time. 0–16. 0 uses the profile's cap (`balanced` 4) |
| `task_budget_usd` | `0` | Estimated cost at API list prices after which writer calls for one task need your approval. 0–1000. 0 is no limit |
| `task_budget_calls` | `0` | Agent calls one task may make before writer calls need your approval. 0–200. 0 is no limit |
| `task_budget_minutes` | `0` | Minutes from a task's first delegation before writer calls need your approval. 0–1440. 0 is no limit |
| `budget_warn_at` | `80` | Percent of a task budget at which cc-tiers warns before the limit. 50–99 |
| `contract_approval` | `critical` | From which risk a task's criteria need your OK before its first delegation: `critical`, `high`, or `off`. Without a human, `CC_TIERS_APPROVED: none - <reason>` caps confidence at moderate |

The default `verify_allow` is `npm test, npm run test, node --test, npx tsc, npx eslint, npx vitest, npx jest, npx playwright test, vendor/bin/phpunit, ./vendor/bin/phpunit, vendor/bin/phpstan, ./vendor/bin/phpstan, vendor/bin/phpcs, ./vendor/bin/phpcs, pytest, python -m pytest, go test, cargo test, wc -l, grep -c, git diff --name-only, git diff --stat, git status --short`.

`risky` is the default: Opus reviews non-trivial work in a fresh context and skips a trivial Haiku pass. `cheap` sends Haiku output to the Sonnet checker and sends Opus review only for a review phrase or the ceiling. `always` reviews every pass (Haiku on Sonnet, the rest on Opus). `never` skips review. While a budget window is conserving, Opus review is reserved for critical work even under `risky` or `always`.

Routing matches two kinds of lists. **Phrases** (`when`, `reviewWhen`, and the `_extra` options) match when the whole phrase appears in the task. **Keywords** (`haiku.keywords`, `opus.reviewKeywords`) match at the start of a word, case- and accent-insensitive: `migra` finds "migration" and "migração", `authent` finds "authentication" but not "author". The built-in keywords cover renames, typos, formatting and lookups for Haiku, and auth, payments, migrations, schemas, public APIs, security, and concurrency for Opus review, in English and Portuguese. A task that looks trivial but hits a review keyword, or scores 2 on complexity (`sonnet.complexKeywords` is one of its signals), starts on Sonnet.

To replace a whole list, add `.claude/cc-tiers.json` to the project. A list you include replaces that list; lists you omit stay at the default. The same file may set `learn`, `budget5h`, `budget7d`, `profile`, `memory`, `telemetry`, `maxParallel`, `taskBudgetUsd`, `taskBudgetCalls`, `taskBudgetMinutes`, `budgetWarnAt`, `contractApproval`, `failureResearch`, and `failureResearchMax` when `/config` leaves them empty. `/config` still wins when both are set. It may also hold `verifyAllow`, a list of command prefixes that adds to the `/config` list and never replaces it (see Verify). It applies only while the file is the one the session stamped when it began, so a change to it takes a new session. See `config/cc-tiers.example.json`.

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

The escalation order is fixed. Routing phrases and keywords, the retry limit, the effort ladders, the review policy, the research gate, the failure research, the specify gate, the verify gate and evidence-based review, the classifier, learning, the two budget thresholds, the profile, memory, telemetry, the writer cap, the task budget, and the criteria approval are the knobs.

---

## 📊 Measuring real use

`/cc-tiers:insights` ends with a **Real use** section built from the session state files cc-tiers keeps (`session-*.json`), as aggregates only: tasks, how many are done, the tiers they started and finished on, how many were done with no failure or after one, how many escalated and finished, how many were reviewed, the verify and completion counts, and the estimated cost next to the same tokens at Opus rates. Projects appear as `project 1`, `project 2`, ... ordered by task count, so the output names no task, session, path, or project. To measure an archive of your own sessions, point it at one plugin data folder of that archive (it reads that folder only, no subfolders): `/cc-tiers:insights --sessions <dir>`.

Measured on the author's own work, 20 to 22 October 2026, cc-tiers 0.9.0 to 0.11.1: 84 tasks in 19 sessions across 3 projects. One user and a small sample, so read it as a description, not a verdict. It predates the re-ask measure, so the table has no sent-back row.

| Real use | Tasks |
| --- | --: |
| Finished on Sonnet / Opus / Haiku | 33 / 45 / 0 |
| Done, out of 84 | 77 |
| Done with no failure | 57 |
| Done after at least one failure, caught before delivery | 20 |
| Escalated (all of them done) | 7 |
| Verify not validated | 41 |
| Estimated cost / same tokens at Opus rates | $200.78 / $214.25 |

Real use also says how many of the done tasks you sent back (`N of the M done tasks were sent back by the user`). Two limits: that figure counts a re-ask only when you marked it with `/cc-tiers:redo` or your prompt named the task and complained, so it is a floor, and the command does not know what plain Opus would have spent. The Opus-rate column prices the same tokens, and plain Opus would not use exactly those. To compare on your own work, set `writer` to `alternate` for a stretch: Real use then shows a By writer mode table.

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
| `skills/qa/SKILL.md` | `/cc-tiers:qa` |
| `skills/qa/techniques.md` | Techniques for designing cases, read by `/cc-tiers:qa` on demand |
| `commands/route.md` | `/cc-tiers:route` |
| `commands/escalate.md` | `/cc-tiers:escalate` |
| `commands/study.md` | `/cc-tiers:study` |
| `config/routing.default.json` | Built-in phrase lists, effort ladders, and default thresholds |
| `hooks/hooks.json` | SessionStart summary, the Agent checks, effort, Haiku classifier, and counter, the Bash guard, SubagentStop, Stop, and UserPromptSubmit |
| `hooks/cc_tiers.mjs` | Merge rules, the counter, spend, budget, and history |
| `hooks/guard_bash.mjs` | The Bash guard: lets the researcher run one read-only command and denies the rest |
| `hooks/route.mjs` | The heuristic behind `/cc-tiers:route` |
| `hooks/verify.mjs` | The verify gate: read `CC_TIERS_VERIFY`, the allow list, run the commands, and judge findings |
| `hooks/report.mjs` | The table behind `/cc-tiers:report` |
| `commands/report.md` | `/cc-tiers:report` |
| `commands/memory.md` | `/cc-tiers:memory` |
| `commands/insights.md` | `/cc-tiers:insights` |
| `commands/redo.md` | `/cc-tiers:redo` |
| `hooks/redo.mjs` | The helper behind `/cc-tiers:redo`: finds the task, marks or unmarks the re-ask, and writes the event |
| `hooks/base.mjs` | Helpers shared by the modules below: paths, file lists, and dollars |
| `hooks/risk.mjs` | Risk scoring: five dimensions and the level |
| `hooks/contract.mjs` | The spec as numbered criteria, the criterion reports, and the completion status |
| `hooks/diagnose.mjs` | Failure categories, the next action, the lines a failure search gets, and the missing-package check |
| `hooks/policy.mjs` | Profiles, the project's checks, and the checks a risk selects |
| `hooks/budget.mjs` | The per-task budget: limits, status, and the warning |
| `hooks/memory.mjs`, `hooks/memory_cli.mjs` | The project memory and the helper behind `/cc-tiers:memory` |
| `hooks/parallel.mjs` | The registry of running writers, file scope, dependencies, and the cap |
| `hooks/workspace.mjs` | Working-tree snapshots, sensitive and out-of-scope files, and state validation |
| `hooks/telemetry.mjs`, `hooks/insights.mjs` | The local event log and the helper behind `/cc-tiers:insights` |
| `hooks/integrity.mjs` | Hook failures: the record in `hook-errors.jsonl` and the warning that the work is not validated |
| `hooks/redact.mjs` | Secret masking before memory, telemetry, and the audit trail |
| `evals/` | Behavioural evals for `claude plugin eval`: one directory per case (`case.yaml`, `fixture.sh`, `prompt.md`, `graders/`) and `evals/README.md` |
| `.github/workflows/ci.yml` | Tests on Linux, macOS, and Windows, and `claude plugin validate` |
| `CHANGELOG.md` | Release notes |

### Evals

`npm test` checks the hooks. `evals/` checks how the plugin behaves in a real run, with `claude plugin eval` (Claude Code 2.1.269 or later). Each case builds a small repo with `fixture.sh`, gives the orchestrator a prompt that does not mention agents, and grades what it did. Two sets exist: `research-before-implementer` (a researcher runs before the implementer) and an effort sweep of seven cases that compares the effort ladders. The sweep changed no ladder, and a rerun with Bash working could not be done on the machine that ran it (an AppArmor profile blocks the nested sandbox); `evals/README.md` has the cause, how to measure elsewhere, and two ready reviewer cases. A case costs about $0.5 to $0.8 a run, so pass `--max-cost-usd`:

```bash
claude plugin eval . --case research-before-implementer --ablation none --scaffold --trust-plugin --no-publish --max-cost-usd 10 --allow-tools Bash,Edit,Write
```

`evals/README.md` has the flags, the results, and the limits: Bash failed inside the runs on the machine that ran them, a review keyword in quoted text boosted the Sonnet ladder, and the Opus reviewer's effort could not be compared until the review roles followed the project ladder (the rerun attempt is described there). Results land in `evals/results/`, which git ignores.

## 🔒 Privacy

Nothing leaves your machine, and the command hooks make no network calls. cc-tiers keeps a local event log (see Telemetry and insights), which `telemetry: off` stops. With `classifier: haiku`, the classifier hook sends each `cc-tiers:worker` call's input to Haiku through Claude Code, the same way the session reaches Claude. When the orchestrator runs a failure search, the researcher's web queries carry the failure message, the library, and the version, scrubbed of secrets, absolute paths, and `CC_TIERS_` tokens; `failure_research: off` stops the suggestion. The hooks read the routing files, the plugin options Claude Code already passes in, the session transcript, `.claude/cc-tiers-rubric.md` when a review runs and the project has one, and cc-cost's local plugin data when that plugin is installed. They write the attempt counter under the plugin data directory (`latest.json` and one file per session), the event log `events.jsonl` (and `events.1.jsonl`) there unless telemetry is `off`, and, when learning is on, `.claude/cc-tiers-history.json` in the project plus one line in `.git/info/exclude`. When memory is on they also write `.claude/cc-tiers-memory.json` in the project, kept out of git by its own line in `.git/info/exclude`; a reference note holds a URL or path and a one-line summary, never the text of a page. Events hold no prompt or file text, and both files pass through redaction first. Uninstalling the plugin removes the plugin data directory unless you pass `--keep-data`. The history and memory files stay in the project until you delete them.

---

Made with ☕ by [@edsoncantuaria](https://github.com/edsoncantuaria) · [MIT](LICENSE)

If it gets you better answers, leave a ⭐
