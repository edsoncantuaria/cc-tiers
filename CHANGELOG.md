# Changelog

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
