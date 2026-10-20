# Changelog

## 0.7.0 - 2026-10-20

### Added

- Verify gate (`hooks/verify.mjs`). A writer's report lists the commands that prove its work in `CC_TIERS_VERIFY: <command>` lines, or says `CC_TIERS_VERIFY: none - <reason>`. When the report is `pass`, the hook runs each command itself, as argv without a shell. A line with `` ; | & > < ` $ ( ) `` (on Windows also `% ! ^`) or a line break is refused, and so is one that carries code: a `data:` or `javascript:` URL, or a flag that loads or evaluates it (`--import`, `--require`, `-r`, `-e`, `-p`, `--script-shell`, `--node-options`, and the rest in README, Verify). `KEY=value` at the start becomes an environment variable (`PATH`, `LD_*`, `DYLD_*`, `NODE_OPTIONS`, `npm_config_*`, `PYTHONPATH`, and the other keys that load code are refused) and `cd <dir> &&` runs in a relative directory inside the project, symlinks resolved. A command that fails runs once more: passing the second time is `flaky`, failing twice is a failure, and so is failing once with no budget left for the second run. A timeout is a failure. A command outside the allow list, a `none` line, a refused line, or a command left by the time budget is `not validated`, not a failure. A failure stops the commands after it.
- The gate covers the worker, the implementer, the architect, the Opus ceiling, and the dispatcher. The ceiling and the dispatcher have no Agent call, so their pass waits until the Stop hook, which runs the commands outside the session lock and blocks once on a failure.
- Evidence-based review. The reviewer and the checker report each defect as a `CC_TIERS_FINDING_BEGIN` / `CC_TIERS_FINDING_END` block with `category`, `severity`, and `evidence` (`command`, `trace`, or `coverage`). A `fail` counts only with a valid blocking finding. The hook re-runs a `command` finding once and discards it when the command passes, and a `coverage` finding stands only when its criterion appears in the task's spec block. A `fail` without such a finding becomes notes.
- Options `verify` (`on` / `off`, default `on`), `verify_allow` (command prefixes, `docker exec` not included), `verify_timeout` (default 300 s, 10-600), `verify_budget` (default 600 s, 30-600), and `review_evidence` (`on` / `off`, default `on`).
- `/cc-tiers:report` has a Verify column: `ok`, `flaky`, or `not validated`. The final report says `verified`, `flaky`, or `not validated` per task.
- Benchmark: for cc-tiers a quality layers table counts passes blocked by the gate, flaky commands, tasks not validated, findings discarded, rejections without evidence, and review rounds per task. README documents the run for the hard suite (`bench/results/verify-evidence.json`); results are pending.

### Changed

- A writer `pass` without `CC_TIERS_VERIFY` now counts as a failure. `verify: off` restores 0.6.
- A review `fail` without a blocking finding with evidence no longer counts as a failure. `review_evidence: off` restores 0.6.
- The hook timeout of PostToolUse, PostToolUseFailure, SubagentStop, and Stop is 660 s, so the gate can run its commands. The other hooks keep their timeouts.
- The reviewer and the checker no longer receive the writer's report, only the diff, the spec block, the research block, and the request.

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
