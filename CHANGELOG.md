# Changelog

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
