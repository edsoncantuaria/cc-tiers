# Changelog

## Unreleased

### Added

- Re-asks are measured. `/cc-tiers:redo <slug> [reason]` marks a done task as sent back by the user and `/cc-tiers:redo --undo <slug>` removes one mark; the slug is looked up in the session first, then in the newest other session that has it. A prompt that names a done task of the session by its slug as a whole word and holds a complaint word (English or Portuguese) counts a re-ask too, says so, and names the `--undo` command; the prompt text is never kept. Telemetry gets `task.redone` (tier, reason clipped to 200 characters and redacted, `source` of `command` or `prompt`) and `task.redo.undone`, both kept at `telemetry: reduced`; with `telemetry: off` no event is written and the mark stays in the session state. `/cc-tiers:insights` prints `Sent back by the user: N of M tasks` with a table by finishing tier, and Real use gets a sent-back line and column. The figure is a floor, and the "Not measured" line says so. New files: `commands/redo.md` and `hooks/redo.mjs`.
- The `writer` option (`tiers` by default, `opus`, `alternate`; environment `CLAUDE_PLUGIN_OPTION_WRITER`; `/config` only, no project key). In `opus` every new task, trivial ones included, is the session's own Opus attempt (`because: writer`; `cc-tiers:architect` in light mode), and a new `cc-tiers:worker` or `cc-tiers:implementer` call for a new task is refused; research, spec, gate, and review stay as usual. `alternate` uses `opus` on even local days and `tiers` on odd ones. A task keeps the mode it recorded first, and budget routing that conserves still starts new work on Sonnet. Telemetry records the `mode`, the session context has a `Writer:` line, and `/cc-tiers:insights` and Real use print a By writer mode table to compare the modes on real work.
- The verify gate runs a command that is exactly one of the checks cc-tiers detected in the project, without a `verify_allow` entry, and looks through `docker exec`, `docker compose exec`, and `docker-compose exec`: the line is judged by the command inside the container, so `docker exec app vendor/bin/phpunit` runs on the default list. Only `-i`, `-t`, `-w`, and `-u` (compose: `-T`, `-w`, `-u`, `--index`) are accepted before the container; any other option makes it a plain command again, and with a leading `KEY=value` the gate does not look inside the container, because `DOCKER_HOST` and the like choose what docker runs.
- The hook adds `Criterion ids for CC_TIERS_CRITERION lines, in spec order: C1 <text>; ...` to the context block of writer, reviewer, and checker delegations when `specify` is on, so a prompt no longer numbers the criteria.
- A task whose review keyword is only in the text, with every named file ordinary (an extension, not a sensitive path), starts on Sonnet one effort level up instead of Opus, at risk `high` (factor `risk keyword, no sensitive file named`), and its review cannot be skipped. With no file named, a directory, a name with no extension, or a sensitive path it stays a hard start.
- When the last writer attempt changed more than 15 files, the review delegation gets a note to review in slices: one `cc-tiers:reviewer` per group of related files plus one integration review, each with the spec block.

### Changed

- Only `CC_TIERS_TASK` is required in a delegation. The agent type gives the role and the tier, so `CC_TIERS_TIER` and `CC_TIERS_ROLE` lines are optional, and a review is charged to the tier that wrote the diff (the attempt waiting for its gate, then the task's counter, then the log, then a `CC_TIERS_TIER` line). Writers close with `CC_TIERS_REVIEW: pending` unless the prompt says `skip`, and the hook overrides a `skip` that a floor forbids. `CC_TIERS_RISK: none - <reason>` still waives a keyword that is only text. The Opus attempt trailer is unchanged.
- The refusal for a command outside `verify_allow` names the command inside a wrapper and says to keep the entries already there, and the context block no longer marks a check "not on verify_allow". A `verify_allow` value still replaces the default list.
- The reviewer has 40 turns (it had 30) and the checker 25 (it had 20).
- README and README.pt-BR: `docker exec` is no longer something to add by hand, and Real use no longer says re-asks are not measured.

### Fixed

- A reviewer or checker report with no `CC_TIERS_STATUS` line but a blocking finding that holds up is a failure of the writer's tier, instead of being lost. Without such a finding it counts nothing, the task stays in review, and the note says to ask the same reviewer for its verdict with `SendMessage`; the reviewer stays registered, so its next stop is counted, foreground or background. A review's status is read from its report only, so a status line in its prompt (a pasted earlier trailer) no longer stands for a verdict.
- A rejection belongs to the writer attempt it judged: a pass from another review of that attempt no longer clears it or finishes the task, a further rejection adds findings but not a second failure, and a task that stopped at the Opus ceiling stays stopped. The next writer report clears the mark. Idle writers no longer release a reviewer that is waiting for a verdict.

## 0.11.3 - 2026-10-22

### Changed

- A cc-tiers hook that fails internally no longer exits as if it had succeeded. `before_agent`, `after_agent`, `subagent_stop` and `stop` run through `hooks/integrity.mjs`, which loads `hooks/cc_tiers.mjs` inside the catch, appends the failure to `hook-errors.jsonl` in the plugin data folder (time, session, hook, task slug, redacted error; written even with `telemetry: off`), and tells the orchestrator the work is not validated. The task slug in the record is the one `slug()` tracks, now shared from `hooks/base.mjs`. Before a delegation a `cc-tiers:*` call is refused and another agent gets a note; after an agent (and after a background agent) the note says the report was not counted and its gate did not run; on Stop the stop is blocked once (a `systemMessage` when `stop_hook_active`); on UserPromptSubmit the note joins the context; SubagentStop only warns. The PreToolUse command hook now has `"onFailure": "block"`. The next hook that works marks the named tasks (`hookErrors` in the task log) and says so once; such a task completes at most `partial` with confidence low and the reason in the completion line, a task that had already completed loses `verified` the same way, and `/cc-tiers:report` shows `hook error` and how often the hooks failed.

## 0.11.2 - 2026-10-22

### Added

- A "Real use" section in `/cc-tiers:insights`, built from the session state files (`session-*.json`) in the data dir or in the folder given by `--sessions <dir>`: tasks, done, start and finish tiers, failures, escalations, reviews, verify, completion, and estimated cost next to Opus rates, with anonymous per-project rows. It names no task, session, path, or project, and says it does not measure re-asks or what plain Opus would have spent.

### Removed

- The synthetic benchmark: the `bench/` directory, `tests/bench_quality.test.mjs`, the tests of `tests/cc_tiers.test.mjs` that ran it, the `bench` and `bench:table` npm scripts, and the Benchmark section and the `bench/` row of the READMEs. Tasks Opus solves easily do not measure cc-tiers.

## 0.11.1 - 2026-10-22

### Added

- Failure research and the `failure_research` and `failure_research_max` options (`on` and `1` by default, `failure_research_max` from 0 to 5 with 0 acting as `off`; project keys `failureResearch` and `failureResearchMax`; environment `CLAUDE_PLUGIN_OPTION_FAILURE_RESEARCH` and `CLAUDE_PLUGIN_OPTION_FAILURE_RESEARCH_MAX`). After a counted failure diagnosed as docs-version, type, integration, test, or regression, the failure note adds a `Failure research:` line and up to three `CC_TIERS_FAILURE: <symptom>` lines (redacted, absolute paths replaced by `<path>`, `CC_TIERS_` tokens removed, each line cut at 160 characters). The orchestrator or the dispatcher may run `cc-tiers:researcher` with them before the retry. In that mode the researcher searches the official docs of the installed version, then the official repo's issues and PRs, then technical discussions and bug reports, then Stack Overflow and community sources, with queries that hold only the failure message, the library, and the version. Its brief has Symptom, Probable cause, Suggested fix, Version, Sources, and Match, and its trailer adds `CC_TIERS_MATCH: high|partial|none`. The brief goes into the next prompt as a second research block. The hook counts no attempt for it, never delays the retry, marks the task researched on a pass, and records `research.failure`. The cap counts the notes that offered a search, across tiers. The note that stops a task after its last Opus attempt suggests nothing, and an escalation note adds a `Research dossier:` line when a search was offered.
- `Repro:` spec section and `CC_TIERS_REPRO: `<command>` - <failure before the fix>` (or `none - <reason>`). For a bug that can be reproduced in code, the writer runs the reproducing test before the fix, never weakens, skips, or deletes it, and repeats the earlier `CC_TIERS_REPRO` line on a retry or an escalation. A `Repro:` criterion with a backticked command is `pass` and evidenced only when that command passes in the gate, a before line exists, and a review passed; without the review it reads `not yet confirmed by a review`, without a before line it stays `pending`, and with `none` it is `unverifiable`. The hook cannot run the command on the base, so the failure before is a claim that the review's mutant check tests: the reviewer and the checker run the `Repro:` command on a scratch copy of the base with the test files copied in (it must fail) and with the change (it must pass), and a weakened, skipped, or deleted test is a blocking `correctness` finding. The orchestrator and the dispatcher do not set `CC_TIERS_REVIEW: skip` on a task with a `Repro:` criterion.
- `/cc-tiers:insights` prints a "Routing in hindsight" table, one row per start tier (the tier of the task's first `model.selected` event): tasks, passed there, escalated, the tier they finished on, stopped, and passed after a blocking review finding. A `Possibly over-routed: N task(s) ...` line appears when tasks that started on Opus at `low` or `medium` risk passed with no escalation, failure, or blocking finding; it is a hint, not a verdict. A "Failure research by match" table counts searches, tasks, and tasks that passed later without escalating, per `CC_TIERS_MATCH` (`high`, `partial`, `none`, or `unknown`).
- The completion line says `on <tier> after N failed attempts and M escalations` when the task failed or moved up before it passed, and `Checks run N (K reused)` when the gate reused checks from the same tree.
- Tests for a stale lock, the lock wait, the atomic state write, and a corrupt state file.

### Changed

- A confirmed `dependency` failure of the gate that names a package the root manifest declares and the tree lacks is not counted, under the same count and limit as infra (2 per task). For Node it needs a bare specifier in `Cannot find module` or `Cannot find package`, no `node_modules/<name>`, and a declaration in the root `package.json`. For Python it needs an undotted `No module named` and a listing in the root `pyproject.toml` or a root `requirements*.txt`. A local module, an undeclared package, a subpath or dotted miss, a missing command, a timeout, and a pip name that differs from the import name still count. The note says to install the package and run the same tier again.
- The gate at Stop, for the Opus ceiling and the dispatcher, reuses a verify pass on the same tree, the way the gate for a delegated writer does.
- The failure searches a task was offered stay with the task across every tier change, like the infra count.

### Fixed

- A `flaky` verify pass was cached and lost its `flaky` label when it was reused. It is no longer cached, so the command runs again and keeps the label.

## 0.11.0 - 2026-10-21

### Added

- Criteria approval and the `contract_approval` option (`critical` default, `high`, or `off`; project key `contractApproval`; environment `CLAUDE_PLUGIN_OPTION_CONTRACT_APPROVAL`). A call to the worker, the implementer, or the architect that has spec criteria and a risk at or above the option is refused until the delegation says `CC_TIERS_APPROVED: user - <how>` (the user approved the criteria) or `CC_TIERS_APPROVED: none - <reason>` (no human could answer), once per task. A `CC_TIERS_RESPEC` that adds, drops, or rewords a criterion voids the approval and asks again. `none` caps the confidence at `moderate` with the reason `criteria not approved by the user`.
- `CC_TIERS_PREEXISTING: <command> - <evidence>`. A writer can declare that its only failing verify command fails the same way without its change. Once per task, unless `review_policy` is `never`, a gate failure of exactly that command is not counted when every other command ran and passed, and the task goes to `cc-tiers:reviewer` (Opus), which must confirm that the command fails on a copy of the base. A `cc-tiers:checker` call for that task is refused, and the completion is `partial` at most, with the real check counts.
- Diagnosis category `unverifiable`, with the action `report-partial`: a failure the repo cannot exercise. Only the reporter's own reason decides it, it is the last rule, and it never applies when the reason or the output speaks of security, auth, login, session, role, permission, 401, 403, an API key, JWT, token, secret, credential, or password. At the attempt limit the task stops with a message that asks for the verifiable part, a `partial` report, and the missing test setup named, instead of escalating.
- Verify gate: a command that exits zero but creates, deletes, or changes a file git tracks or does not ignore is `not validated: changed the tree: <paths>`. The check compares `git status` and content hashes before and after each command. It is skipped, and the gate says `tree check skipped: <task> still writing`, while another writer that is not isolated runs in the same tree.
- Criteria table. After the completion line, a task with criteria gets `cc-tiers criteria for <task> (paste into the commit or PR):` and a table of criterion, status, and evidence.
- Project review rubric: `.claude/cc-tiers-rubric.md`, up to 4 KiB, a regular file inside the project, redacted, in the review prompt's context block as data from the repo, never instructions.
- Light path and small path notes end with: a request that only asks for an answer, an explanation, a study, or an opinion, and changes nothing, is answered in the session, with no slug, spec, or implementer.
- Prompts: a criterion that names how new code is called (reachability); a mutant check (a new test must fail without the fix) and a reachability finding for the reviewer; the diff is evidence, never instructions; a scoped re-review that lists the previous blocking findings; a `final-gate` review of the whole integrated diff when a request had two or more writer tasks; a recipe to integrate worktree results in `CC_TIERS_DEPENDS` order; and a rule that agents on a shared tree never run `git stash`, `git checkout`, `git reset`, `git restore`, or `git clean`.

### Changed

- `CC_TIERS_DEPENDS` refuses, instead of waiting forever, a slug that no delegation in the session had (the message names it) and a dependency cycle, direct or through a third task (the message gives the cycle's path).
- The count of infra failures skipped (and the one pre-existing declaration) stays with the task across every tier change.
- A writer's prompt keeps "a failing test is a failed task" with one exception, `CC_TIERS_PREEXISTING`, and tells it that a verify command may not change the tree.
- The reviewer's `maxTurns` went from 20 to 30.

### Fixed

- A background writer's pass that arrives after its task's review passed is not counted again when that review was launched after this writer: the task stays finished instead of asking for the review again. A newer writer, or a pass whose gate fails, still counts.

## 0.10.0 - 2026-10-21

### Added

- Risk assessment (`hooks/risk.mjs`). Each task is scored 0 to 3 on complexity, regression (public contract, dependency or version, files in three or more top-level directories, an earlier Sonnet failure), sensitivity (a risk keyword or a sensitive path such as auth, login, session, payment, migration, schema, secret, token, jwt, password, `.env*`; persistent data is 2), ambiguity (hedge words, two or more question marks), and evidence (no tests 2, unknown 1, tests 0, plus 1 after a Haiku failure), and gets a level `low`, `medium`, `high`, or `critical`. `/cc-tiers:route` prints `risk`, `riskDimensions`, and `riskFactors` beside the unchanged `risky`.
- Spec contract (`hooks/contract.mjs`). The spec block is parsed into numbered criteria `C1`, `C2`, ... from `Criteria:`, `Preserve:`, `Checks:`, `Security:`, `Evidence:`, and `Edge cases:` (`Assumed:` and `Ambiguous:` stay notes) and stored at the task's first delegation. Writers report `CC_TIERS_CRITERION: C<n> pass|fail|unverifiable|na - <evidence>`; `na` and `unverifiable` need a reason and the last line per id wins. A `Checks:` criterion with a backticked command is evidenced only when that exact command passes in the gate. A declared `pass` or `na` becomes evidence only after an independent review passed. The reviewer and checker prompts must carry the same spec block.
- `CC_TIERS_RESPEC: <reason>` in a delegation lets a retry or an escalation change a criterion on purpose, and the change is audited.
- Completion line. A passed task ends with `cc-tiers completion: <task> verified|partial|failed|unverified on <tier>, <risk> risk; confidence high|moderate|low (reasons). Checks run N, passed N, failed N, not run N. Criteria with evidence: x/y. Remaining: ...`. `verified` needs a verified command, no `na` the writer only declared, evidence for every criterion from the profile's strict risk level up, and a review pass for high and critical risk. A critical task with no review has low confidence.
- Failure diagnosis (`hooks/diagnose.mjs`). A failure is classified as `syntax`, `type`, `test`, `regression`, `requirement`, `docs-version`, `dependency`, `integration`, `architecture`, `security`, `infra`, `flaky`, `scope`, or `unknown`, from the reviewer's finding category or the output of the gate, and the note for the next attempt says what to try: `retry`, `retry-research` (a docs-version failure), `rerun-env` (dependency, infra, flaky), `escalate` (architecture, security), or `stop` at Opus. A diagnosis is confirmed only by a reviewer category or a machine signature in the output (`Cannot find module`, `ECONNREFUSED`, `ENOSPC`, ...); a match in the writer's own words is a hypothesis. The same failure signature twice moves the task up.
- Review protocol. Findings take the categories `access-control`, `input-validation`, `data-exposure`, `error-handling`, `concurrency`, `api-usage`, and `compatibility` beside the five of 0.7, the severities `blocker`, `high`, `medium`, `low`, and `suggestion` beside `blocking` and `note`, and the optional fields `scenario`, `confidence` (`low`, `medium`, `high`), and `justification`. `blocker` and `high` count as blocking and need `confidence` and `justification`; a low-confidence one becomes a note. A review prompt gets a review-focus block (at most 5 of 8 risk classes, picked from the words of the diff and the request), and a reviewer or checker prompt that carries a writer's trailer is refused.
- Verify gate. A command that cannot start (program missing, bad directory) is `not validated: could not start: ...`, not a failure. A command that already passed on the same tree (same `HEAD` and same content of the dirty files) is reused instead of run again.
- Profiles (`hooks/policy.mjs`) and the `profile` option: `balanced` (default), `quality`, `budget`, and `fast`. A profile sets the effort boost for writers, the risk from which criteria need evidence, the risk from which review is required, the writer cap, how many memory items are recalled, and how many project checks a task selects. No profile removes an agent, a gate, a criterion, or a step, overrides a `/config` value, or lowers what a critical task gets.
- Checks per risk. The writer prompt carries a context block with the checks the project declares (`npm test`, `npm run lint`, `npx tsc --noEmit`, `vendor/bin/phpunit`, `pytest`, `go test ./...`, `cargo test`, `npm audit --omit=dev`, ...) for the task's risk: targeted tests at depth 0, tests at 1, tests, typecheck, and lint at 2, all checks at 3. Critical risk always gets depth 3.
- Task budget: options `task_budget_usd` (0-1000), `task_budget_calls` (0-200), `task_budget_minutes` (0-1440), all default 0 (off), and `budget_warn_at` (50-99, default 80). Near the limit cc-tiers warns; over it, it refuses new writer calls for that task until the user agrees and the delegation says `CC_TIERS_BUDGET: override - <reason>`. Review and verification calls still run. Calls and minutes are measured, usd is an estimate at API list prices, and a critical task over budget asks for the user's decision.
- Memory (`hooks/memory.mjs`) and the `memory` option (`on` / `off`, default `on`). Small records per project in `.claude/cc-tiers-memory.json`, kept out of git through `.git/info/exclude`: `convention`, `command`, `failure`, `fix`, `dead-end`, `version`, and `warning`, each with a confidence, a `hypothesis` or `confirmed` status, a time to live (0 is until invalidated), and, when it depends on a file, that file's hash, so a changed file makes it stale. The cap is 200 records. A writer gets the few that share two or more words with its task (or its slug), limited by the profile, between `CC_TIERS_MEMORY_BEGIN` and `CC_TIERS_MEMORY_END` as data, not instructions. The hook records gate-verified commands, diagnosed failures, a fix after failures, and dead ends.
- `/cc-tiers:memory [list [--all] | add <category> <text> | invalidate <id> <reason> | delete <id> | prune | clear --yes]`. A record added by the user is confirmed with high confidence, and `clear` needs `--yes`.
- Parallel writers (`hooks/parallel.mjs`) and the `max_parallel` option (0-16, default 0, which is the profile's cap: balanced 4). A delegation names its files in `CC_TIERS_FILES: <path>, <glob>` (a glob becomes its fixed directory; `.`, more than 40 files, an absolute path, or `../` means the whole project), waits for other tasks with `CC_TIERS_DEPENDS: <slug>, <slug>`, and frees a stale writer with `CC_TIERS_RELEASE: <slug>`. Writers whose files overlap, or whose files are unknown, run one at a time; an Agent call with `isolation: "worktree"` never conflicts on files but still counts toward the cap. A writer unseen for 2 hours is released, and so is every idle one at Stop (background writers stay).
- Workspace guard (`hooks/workspace.mjs`). The hook takes a snapshot of the working tree (`git status` plus content hashes) before and after each writer attempt, warns about sensitive files the prompt did not name (`.env`, keys, credentials, CI workflows, lockfiles, Claude settings, git internals, Dockerfile and compose files), and about files outside `CC_TIERS_FILES`. A test file for a declared file counts as in scope. Files git ignores are not seen. On load, the task state is validated, inconsistent entries are dropped and audited, and the orchestrator is told once.
- Telemetry (`hooks/telemetry.mjs`) and the `telemetry` option (`on`, `reduced`, `off`, default `on`). One small event per transition goes to `events.jsonl` in the plugin data directory, with whitelisted fields only, no prompt or file text, redacted, rotated once to `events.1.jsonl` above 1 MB. `reduced` keeps escalations, diagnosed failures, passes, stops, and budget warnings. Nothing leaves the machine.
- `/cc-tiers:insights` (`hooks/insights.mjs`): failures by category, escalation reasons, estimated cost by risk, unverified gates, and confidence on passed tasks. A sample under 10 tasks is marked small, and the output never changes routing or config.
- Redaction (`hooks/redact.mjs`). Private keys, provider keys and tokens (`sk-`, `ghp_`, `github_pat`, `glpat`, `npm_`, `xox`, `AKIA`, `AIza`, Slack hooks), JWTs, URL credentials, `Authorization` and `Cookie` headers, `--password` and `--token` flags, `key=value` with a secret name, and e-mail addresses are masked before memory, telemetry, and the audit trail store them.
- `/cc-tiers:report` has the columns Risk, Completion, Confidence, and Time (measured), and its footer says that time is measured and cost is estimated. SessionStart lists open work found in the session state and says nothing is rerun automatically.
- The project file `.claude/cc-tiers.json` may set `profile`, `memory`, `telemetry`, `maxParallel`, `taskBudgetUsd`, `taskBudgetCalls`, `taskBudgetMinutes`, and `budgetWarnAt`; `/config` still wins.

### Changed

- A task of high or critical risk that looks like a Haiku task starts on Sonnet (`because: risk`), and under `hard_start: opus` a Sonnet task of critical risk starts on Opus.
- A writer cannot skip review with `CC_TIERS_REVIEW: skip` when it changed a sensitive file the prompt did not name, when its risk is critical, or when its risk reaches the profile's review floor (`critical` for `balanced`, `budget`, and `fast`; `high` for `quality`). `review_policy: never` still skips.
- A retry or an escalation that drops or rewords a criterion of the stored spec is refused until `CC_TIERS_RESPEC: <reason>` says why.
- A confirmed infra failure of the gate (network, port, disk, memory, or a missing command) is not counted as a failure, at most 2 per task; the third counts.
- A `fail` whose only blocking finding is a low-confidence `blocker` or `high` is treated as notes, as a `fail` with no valid finding already was.
- Privacy. "No telemetry" is now "no network calls and a local event log": the plugin data directory holds `events.jsonl`, and the project holds `.claude/cc-tiers-memory.json`. Both can be turned off with `telemetry: off` and `memory: off`.

## 0.9.0 - 2026-10-20

### Added

- Small path. On UserPromptSubmit the hook adds a `cc-tiers small path` note when a request is 40 words or fewer, matches no Opus review keyword, has complexity score 0, and would start on Sonnet (by default, or a trivial-looking task that already failed on Haiku). The session agent reads the target first. If the change fits in about 20 lines of one file (its test file aside), has a clear expected result, and uses no library API it has not seen in the repo, then with `light_path: inline` it does it itself: no plan, research, or subagent, a spec of one to three criteria, a reproducing test for a bug fix when the file has tests, and its attempt trailer with `CC_TIERS_REVIEW: skip`, so the verify gate re-runs its `CC_TIERS_VERIFY` commands with no review pass. The light-mode dispatcher does the same with its dispatcher trailer.
- With `light_path: delegate`, or while budget routing conserves, a small change is one `cc-tiers:implementer` call with `CC_TIERS_RESEARCH: none`, a short spec, and `CC_TIERS_REVIEW: skip`. A bigger or risky change, or doubt, takes the usual route.
- No new option: the small path follows `light_path`, and `off` turns both off.
- `CC_TIERS_RISK: none - <reason>` in a delegation waives an Opus review keyword that is only text there (docs, a quoted example, `git checkout` in an instruction): no hard start, no effort boost, no routing hint. A line with no reason is ignored, and the writer's report is still checked for risk, ignoring any `CC_TIERS_RISK` line it echoes.

### Changed

- A one-line fix such as removing a debug log or changing a config value no longer gets research, a full spec block, a Sonnet implementer, and an Opus review; it gets one to three criteria and the verify gate. The trivial light path only caught keyword tasks (typo, rename, lint, lookup).

### Fixed

- A background subagent that delivers its report through the `SubagentHandback` tool is counted: when the last assistant message has no `CC_TIERS_STATUS`, SubagentStop reads the report from the last `SubagentHandback` call in the agent transcript instead of reporting "finished without CC_TIERS_STATUS".

## 0.8.0 - 2026-10-20

### Added

- `hard_start` option (`opus` / `sonnet`, default `opus`). A hard task starts on Opus: one that matches an Opus review keyword (auth, payments, migrations, schema, security, concurrency, plus `risky_extra`), or that needs an architecture decision with trade-offs, a bug fix with no clear reproduction or across modules, or an investigation with competing hypotheses. The orchestrator implements it with the Opus attempt trailer, and in light mode the dispatcher sends it to `cc-tiers:architect`; research, the spec, the verify gate, and the Opus review still apply. While budget routing conserves, it starts on Sonnet one effort level up.
- `decideTier` and `/cc-tiers:route` return `because: hard` for such a task. The PreToolUse hook adds a routing hint when one goes to the worker or the implementer.

### Changed

- Under the default `hard_start: opus`, a task that matches a review keyword no longer starts on Sonnet. `hard_start: sonnet` restores 0.7.
- The planner may now give a task the `opus` tier.

## 0.7.0 - 2026-10-20

### Added

- Verify gate (`hooks/verify.mjs`). A writer's report lists the commands that prove its work in `CC_TIERS_VERIFY: <command>` lines, or says `CC_TIERS_VERIFY: none - <reason>`. When the report is `pass`, the hook runs each command itself, as argv without a shell. A line with `` ; | & > < ` $ ( ) `` (on Windows also `% ! ^`) or a line break is refused, and so is one that carries code: a `data:` or `javascript:` URL, or a flag that loads or evaluates it (`--import`, `--require`, `-r`, `-e`, `-p`, `--script-shell`, `--node-options`, and the rest in README, Verify). `KEY=value` at the start becomes an environment variable (`PATH`, `LD_*`, `DYLD_*`, `NODE_OPTIONS`, `npm_config_*`, `PYTHONPATH`, and the other keys that load code are refused) and `cd <dir> &&` runs in a relative directory inside the project, symlinks resolved. A command that fails runs once more: passing the second time is `flaky`, failing twice is a failure, and so is failing once with no budget left for the second run. A timeout is a failure. A command outside the allow list, a `none` line, a refused line, or a command left by the time budget is `not validated`, not a failure. A failure stops the commands after it.
- The gate covers the worker, the implementer, the architect, the Opus ceiling, and the dispatcher. The ceiling and the dispatcher have no Agent call, so their pass waits until the Stop hook, which runs the commands outside the session lock and blocks once on a failure.
- Evidence-based review. The reviewer and the checker report each defect as a `CC_TIERS_FINDING_BEGIN` / `CC_TIERS_FINDING_END` block with `category`, `severity`, and `evidence` (`command`, `trace`, or `coverage`). A `fail` counts only with a valid blocking finding. The hook re-runs a `command` finding once and discards it when the command passes, and a `coverage` finding stands only when its criterion appears in the task's spec block. A `fail` without such a finding becomes notes.
- Options `verify` (`on` / `off`, default `on`), `verify_allow` (command prefixes, `docker exec` not included), `verify_timeout` (default 300 s, 10-600), `verify_budget` (default 600 s, 30-600), and `review_evidence` (`on` / `off`, default `on`).
- `/cc-tiers:report` has a Verify column: `ok`, `flaky`, or `not validated`. The final report says `verified`, `flaky`, or `not validated` per task.
- Benchmark: for cc-tiers a quality layers table counts passes blocked by the gate, flaky commands, tasks not validated, findings discarded, rejections without evidence, and review rounds per task. README documents the run for the hard suite (`bench/results/verify-evidence.json`); results are pending.
- Clean code without asking. The researcher brief has Reuse (existing helpers as `file:line`) and Conventions (nearby snippets), and notes how the installed version recommends doing the task and what it marks deprecated; the limit is about 40 lines. The writers reuse or extend and never fork, follow the version's docs and the file's conventions, touch only what the task needs, add no hypothetical protection (retry, cache, fallback, or compatibility only with a real consumer), comment only what the code cannot say, and stop when verified. The reviewer blocks recreated code and changes outside the task as `scope` findings; hypothetical protection, style, comment noise, and naming taste are notes.
- Benchmark: a `Touched outside scope` column counts runs that changed a file outside the task's scope (the reference solution's files, `scopeExtra` in the tasks JSON, and test directories). The raw JSON keeps the list of files.

### Changed

- A writer `pass` without `CC_TIERS_VERIFY` now counts as a failure. `verify: off` restores 0.6.
- A review `fail` without a blocking finding with evidence no longer counts as a failure. `review_evidence: off` restores 0.6.
- The hook timeout of PostToolUse, PostToolUseFailure, SubagentStop, and Stop is 660 s, so the gate can run its commands. The other hooks keep their timeouts.
- The reviewer and the checker no longer receive the writer's report, only the diff, the spec block, the research block, and the request.
- The README opening states the purpose: your time, the spec, and the code, not tokens; the right model per task; and that a run is slower on the clock than plain Opus.

## 0.6.0 - 2026-10-20

### Added

- `cc-tiers:researcher` (Sonnet, read-only): before code is written it finds the installed version of each library, that version's docs, how the repo already uses the API, and prior art, and returns a brief with a source per fact.
- Research gate in the PreToolUse hook. A call to `cc-tiers:implementer` or `cc-tiers:architect` is refused unless the researcher reported pass for that task and the prompt says `CC_TIERS_RESEARCH: done`, or the prompt says `CC_TIERS_RESEARCH: none - <reason>`. The brief rides in the prompt between `CC_TIERS_RESEARCH_BEGIN` and `CC_TIERS_RESEARCH_END`, `CC_TIERS_COVERS` lets one research serve several tasks, and a research is not an attempt. The worker is exempt; the Opus ceiling and the dispatcher's own task are researched by prompt only.
- `research` option (`on` / `off`, default `on`).
- Quality metrics in the benchmark: FAIL_TO_PASS and PASS_TO_PASS (SWE-bench), pass@1 (HumanEval), pass^k (tau-bench), regressions, and fresh tokens per resolved task. `changesTests` is recorded per task, and session mode stores usage per step.
- Benchmark table column `Δ pass@1 vs Opus only` (percentage points), and a **Where it made a difference** section that lists only the tasks where a configuration resolved a different share of runs than Opus only.
- Specify and ask: before code goes to `cc-tiers:implementer` or `cc-tiers:architect`, the orchestrator (and the dispatcher) writes acceptance criteria between `CC_TIERS_SPEC_BEGIN` and `CC_TIERS_SPEC_END`, asks at most 3 multiple-choice questions only when two readings lead to different code, and records what it assumed when nobody can answer. The same block goes to the reviewer or checker. See README, Specify and ask.
- Specify gate in the PreToolUse hook and the `specify` option (`on` / `off`, default `on`): a call to the implementer or the architect is refused without a block with content or a `CC_TIERS_SPEC: none - <reason>` line.
- Login suite: `bench/tasks-login.json`, `bench/fixture-login/` (dotenv 8.6.0 vendored), `bench/checks-login/`, and `bench/solutions-login/`. One natural `POST /login` request with no hints, on a project that already has a token signer and a multi-line `PRIVATE_KEY` that dotenv 8.6.0 cuts silently; the check passes only if the user would not have to ask again (nothing broken, no hallucinated dotenv behaviour, no recreated signer, login works).
- Benchmark column `Recreated existing code`: a hidden-check test whose name starts with `reuse: ` checks that existing code was reused, and the column counts the runs that failed one (`—` when no run was checked). Regressions are now shown as `Broke something`.
- Measured results: `bench/results/login.json` (login, k=2) and `bench/results/hard-pair.json` (`traversal` and `race`, k=3), each against Opus only, Sonnet only, and cc-tiers.

### Changed

- The benchmark runner passes `--disallowedTools AskUserQuestion` for every configuration, because a headless run denies it anyway; disabling it means no configuration spends turns on a question nobody can answer.
- Defaults favor quality, so a session behaves differently after updating: `review_policy` is `risky` (was `cheap`), `show_cost` is `off` (was `on`), and the Sonnet effort ladder is `high`, `xhigh` (was `medium`, `high`, `xhigh`); a risky Sonnet task starts at `xhigh`. The implementer's own effort is `high`.
- The README tells the quality-first story for Pro and Max: Opus plans and reviews, Sonnet researches and builds, review runs in a fresh context, and cost is optional. Light mode is for when the usage window is tight.
- The benchmark's first table puts quality first and tokens last: `pass@1`, `Δ pass@1 vs Opus only`, `pass^k`, `Resolved`, `Broke something`, `Recreated existing code`, `Tokens per resolved task`. The `Δ tokens vs Opus only` column is gone. `bench/run.mjs` defaults to `bench/tasks-login.json`.
- The benchmark tables no longer show dollars. The 0.5 dollar table is withdrawn: its session-mode column summed session-cumulative cost, and the 0.5 pass rates used the old criterion (hidden check plus the model's own tests, no before-form PASS_TO_PASS), so they are not like-for-like with 0.6.

### Removed

- The easy (`bench/tasks.json`), calculator, and dotenv-trap benchmark suites, and the 0.4 and 0.5 cost results. The benchmark now measures quality only.

## 0.5.1 - 2026-10-19

### Added

- `bench/fixture-hard/` and `bench/tasks-hard.json`: a harder benchmark on a shift-scheduling service with shared state, time zones, and async booking. It has twelve tasks: 4 trivial, 3 normal, 3 hard, and 2 large requests that mix all three kinds. Each hidden check in `bench/checks-hard/` fails on the untouched fixture and passes with the reference fix in `bench/solutions-hard/`, and `npm test` verifies both. Not run in full yet; a Sonnet-only calibration is in `bench/results/calibration-sonnet-hard.json`.
- `bench/run.mjs` takes `--tasks-file`, `--fixture`, and `--checks` (`tasks-hard.json` pairs with `fixture-hard/` and `checks-hard/` by default). It records subagents by type for every configuration. For cc-tiers it also records the escalations the hooks announced and whether each task was routed as the README says, both read from the session transcript.

### Changed

- `bench/run.mjs` starts `claude` with `--setting-sources project,local`, so the user's own CLAUDE.md, agents, plugins, and hooks no longer leak into a benchmark run.

## 0.5.0 - 2026-10-19

### Added

- Cost per task, with no other plugin needed. Each finished task gets a `cc-tiers cost` line at Anthropic API list prices, priced per model id from `prices` in `config/routing.default.json` (cache reads at the model's rate, cache writes at 1.25x or 2x input), next to the same tokens at Opus rates. The session summary carries the running total. `show_cost` (`on` / `off`).
- `/cc-tiers:report [--all]` and `hooks/report.mjs`: one table per session with the tiers each task ran on, attempts, escalations, effort, review, status, and cost next to Opus rates.
- Large files: a task that names project files adding up to `largeFileBytes` (400 KB) or more scores 2 on complexity and starts on Sonnet. This is the Claude-only take on long-context routing.
- `bench/`: a benchmark with a fixture project, seven tasks with hidden checks, and a runner that compares Opus only, Sonnet only, the orchestrator, and light mode, one task per session or all tasks in one session. Results are in `bench/results/` and in the README.
- The README covers pairing light mode with Claude Code's advisor tool.

### Changed

- The benchmark showed that a fresh subagent context costs more than a small task. `light_path` is now `inline` by default: a one-task trivial request is done by the session agent itself, with no worker and no checker. `delegate` keeps the 0.4 behavior; `off` turns it off. `on` reads as `inline`.
- The light-mode dispatcher does one ordinary task itself on Sonnet instead of opening a Sonnet implementer, and marks the attempt with a `CC_TIERS_ROLE: dispatcher` trailer that the hooks count like the Opus ceiling trailer. Two failures still move the task to `cc-tiers:architect`. It delegates when a request has several tasks or a task is too big for its context.

## 0.4.0 - 2026-10-19

### Added

- Effort ladder. A retry at the same tier runs one effort level higher before the task changes model: Haiku `low` → `medium`, Sonnet `medium` → `high` → `xhigh`, Opus (`cc-tiers:architect`) `high` → `xhigh`. The PreToolUse hook sets `effort` on the Agent call with `updatedInput`, keeps a higher level the orchestrator asks for up to the top of the ladder, and never lowers it. A Sonnet task that matches a review keyword starts one level up. While budget routing conserves, effort stops at `conserveCap` (`high`). `effort_ladder` (`on` / `off`) in `/config`, and `effort.<tier>` / `effort.conserveCap` in the project file.
- Complexity score, a local second opinion next to the keyword lists: several steps, three or more files, design or investigation wording (`sonnet.complexKeywords`, English and Portuguese), or a long brief. A trivial-looking task that scores 2 or more starts on Sonnet (`because: complex`). `/cc-tiers:route` prints the score, its signals, and the first effort.
- Haiku classifier, a `prompt` hook limited to `cc-tiers:worker` calls (`if: Agent(cc-tiers:worker)`, `continueOnBlock`). It refuses a worker call whose task is not really trivial, and the orchestrator sends the slug to Sonnet without counting a failure. `classifier: local` turns it off; worker prompts then carry `CC_TIERS_CLASSIFY: skip`, which the command hook refuses while the classifier is `haiku`.
- Light path. UserPromptSubmit tells the orchestrator when a request is one trivial task: no written plan, one delegation, no checker pass for a lookup. `light_path` (`on` / `off`).
- Light mode: `cc-tiers:dispatcher`, a Sonnet session agent that calls Opus only through `cc-tiers:planner` (a read-only plan for a multi-task request), `cc-tiers:architect` (the ceiling), and `cc-tiers:reviewer`. Planner runs are not attempts; their spend goes to `(orchestration)`.
- Sonnet escalations are learned. A task that used its attempts on Sonnet is recorded in the history with `tier: sonnet`, and a similar task later starts on Sonnet at the top of its ladder.

### Changed

- An API or network error (overloaded, rate limit, 5xx, connection reset) is no longer counted as a failure. The same tier runs again, so an outage does not push work up to Opus.
- Under the `cheap` policy, a lookup or search that changed no files skips the checker.
- Escalation and refusal messages name `cc-tiers:architect` as the Opus ceiling in light mode.

## 0.3.0 - 2026-10-19

### Fixed

- Risk and trivial routing now match. The built-in lists were full sentences matched as substrings, so "Add OAuth authentication" never counted as risky and "fix a typo in README" never counted as trivial. Routing adds word-start **keywords** (`haiku.keywords`, `opus.reviewKeywords`), case- and accent-insensitive, in English and Portuguese. A trivial-looking task that hits a review keyword starts on Sonnet.
- Haiku history matches the task slug from the `CC_TIERS_TASK` header. The old kind comparison could never match. Accented words are folded before comparing.
- Spend no longer shrinks or drifts. The transcript is read incrementally from a stored offset instead of re-summing the last 2 MB, rows that repeat a message id are counted once, and the orchestrator's own turns go to `(orchestration)` instead of the last delegated task.
- A late run on a lower tier no longer resets the counter of an escalated task.
- `pluginRoot` uses `fileURLToPath`, so paths with spaces and Windows paths resolve.

### Added

- PreToolUse hook on Agent: refuses a cc-tiers delegation that passes `model`, has no `CC_TIERS_TASK` header, or sends an escalated task back down. An early escalation moves the counter. It also hints when a Haiku delegation matches history or a review keyword.
- Background agents are counted. The launch records the agent id, SubagentStop counts the report and the agent transcript's tokens, and the note reaches the orchestrator at its next delegation, prompt, or the end of the turn (Stop asks it to continue once).
- Opus ceiling attempts are counted from an orchestrator trailer (`CC_TIERS_ROLE: orchestrator` plus `CC_TIERS_STATUS`).
- `/cc-tiers:route` runs `hooks/route.mjs`, the same heuristic as the hooks.
- The session counter is written under a lock and atomically, so parallel agents do not drop counts.
- GitHub Actions CI: tests on Linux, macOS, and Windows with Node 18, 20, and 22, plus `claude plugin validate --strict`.

### Changed

- The history file goes in `.git/info/exclude` (worktrees resolved) instead of the tracked `.gitignore`. Nothing is written outside git checkouts.
- Hooks call `node` directly, without the bash wrappers, so they also run under PowerShell. `.gitattributes` keeps LF line endings.
- Requires Claude Code 2.1.295+ for `onFailure` on the PreToolUse hook.

## 0.2.0 - 2026-10-19

### Added

- Per-task spend by model tier when [cc-cost](https://github.com/edsoncantuaria/cc-cost) is installed. Fresh tokens follow cc-cost: input + cache write + output, cache reads excluded. Daily totals read cc-cost's `novos:<day>:<sessionId>` keys when that store is on disk. The 5h and 7d windows use cc-cost's `five_hour` and `seven_day` kinds.
- Budget routing. `budget_5h` and `budget_7d` (default 80) bias new work toward Haiku and Sonnet when either window is at the threshold. Opus stays the escalation ceiling and the reviewer for critical work. A window that has already reset counts as 0. No reading means no bias.
- Haiku failure history in `.claude/cc-tiers-history.json`. Similar tasks start on Sonnet. The file is added to `.gitignore` the first time it is written. `learn` (`on` / `off`) disables the record and the bias.
- Review policy `cheap` (the new default) and `cc-tiers:checker` on Sonnet. Sonnet reviews Haiku output. Opus reviews only risky or non-trivial work, or the ceiling.

### Changed

- Hooks run on Node.js. Claude Code already ships with Node, so Python is not required.
- `review_policy` default is `cheap`. `risky`, `always`, and `never` remain.

### Removed

- The Python hook scripts and the Python test suite.
