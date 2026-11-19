# Behavioural evals

Evals run the plugin under `claude plugin eval` (Claude Code 2.1.269 or later; written and run on 2.1.328). Docs: https://code.claude.com/docs/en/plugin-evals.md

## Run

```bash
claude plugin eval . --case research-before-implementer --ablation none --scaffold --trust-plugin --no-publish --max-cost-usd 10 --allow-tools Bash,Edit,Write
```

- The target `.` goes before `--allow-tools`.
- `--scaffold` is required: the case builds its repo with `fixture.sh`.
- `--allow-tools Bash,Edit,Write` is required: `allowed_tools` in a case only grants read-only tools, and the implementer needs to write.
- `--ablation none` runs one arm. The default (with and without the plugin) doubles the cost, and the without-arm cannot dispatch `cc-tiers:*` agents.
- Add `--runs 1 --keep-temp` to debug one run. The kept directory is sealed: `chmod 700 <dir> <dir>/sealed` opens it, and `out/trace.jsonl` is the trace.
- Results land in `evals/results/<timestamp>/` (gitignored).

## Case: `research-before-implementer`

| File | What it is |
| --- | --- |
| `case.yaml` | schema 1.1, points `context.scaffold_script` at `fixture.sh` |
| `fixture.sh` | a node repo with `text.js`, its test, `"test": "node --test"` and one commit |
| `prompt.md` | asks for a `cli.js` that uses `util.parseArgs`, a `bin` entry and `cli.test.js` |
| `graders/research-first.md` | `tool_order`: an `Agent` call to `cc-tiers:researcher` comes before the first `Agent` call to `cc-tiers:implementer`. The pattern is not anchored to `subagent_type`, so a name quoted in another agent's prompt would also match; in the recorded runs the names appear only in `subagent_type` |
| `graders/cli-uses-parseargs.md` | `regex` on the contents of `cli.js`: it calls `parseArgs(` |

The prompt does not mention agents. It uses a version-sensitive built-in API (`util.parseArgs`) so that research has something to do, and it is one task so that the orchestrator does not split it.

The result grader only proves that `cli.js` exists and uses `parseArgs`. That `npm test` passes rests on the cc-tiers verify gate, not on a grader.

### Result of the pilot

3 runs, 3 passed (score 1.0, exit 0). Total cost $1.99 (runs: $0.61, $0.83, $0.55), 383 s in all (94 to 163 s a run), 12 to 13 turns a run, no judge cost (no `llm` grader). `aggregate-result.json` carries cost but no token counts.

The first two designs failed, and both failures are findings about the plugin rather than about the grader:

1. A one-function request (`wordCount` in `text.js` plus a test): the orchestrator took the light path and edited the two files itself. No `Agent` call, so `research-first` failed. The case is too small to delegate.
2. A request with two parts (`wordCount` and `lineCount` in `text.js`, and a `cli.js`): the orchestrator split it into two tasks. It sent the string functions to `cc-tiers:implementer` with `CC_TIERS_RESEARCH: none - pure string functions` before it ran the researcher for the CLI. The first `researcher` call came after the first `implementer` call, so `research-first` failed. The plugin allows skipping research for a task that needs none, so a grader on the first call is too strict for any case that can split.

## What the pilot found about running under `claude -p`

Each run is a `claude -p` child with the plugin loaded. Probed with `--keep-temp`: the hook state in `config/plugins/data/`, the session transcript, and `out/trace.jsonl`.

- **Hooks run.** `SessionStart` injected the routing summary (it is in the trace as `hook_response`). The `PreToolUse` hook on `Agent` blocked a dependent task ("cli-tool depends on text-counts, which has not passed yet"). The `PreToolUse` hook on `Bash` blocked a compound command from the researcher. The verify gate ran `npm test` outside the sandbox after an implementer and the orchestrator relied on it. `cc-tiers:reviewer` was dispatched. The plugin's `"agent": "orchestrator"` setting applied (the main agent wrote the `CC_TIERS_ATTEMPT` marker). The trace has `hook_started` and `hook_response` events only for `SessionStart`, so the `Stop` hook was not seen directly.
- **`CLAUDE_PROJECT_DIR` is the run's workspace.** In a debug variant of the fixture (the committed `fixture.sh` writes no `.claude/` file), the scaffold wrote `.claude/cc-tiers.json` with `{"effort": {"sonnet": ["xhigh"]}}`. `SessionStart` reported `Project routing file: <workspace>/.claude/cc-tiers.json` and the ladder line read `sonnet xhigh`. Claude Code itself loads nothing from that `.claude/`, but cc-tiers reads its own project file, so a case can ship per-case routing through `fixture.sh`. cc-tiers ignores some keys in that file by design (`maxAttempts`, `reviewPolicy`, `learn`, the budgets); the effort ladders and `tiers` phrases do apply.
- **`CLAUDE_CODE_EFFORT_LEVEL` reaches the run.** Exported as `low`, the session transcript recorded `"effort":"low"` on every turn; with it unset the same transcript recorded `"effort":"medium"`. It beats the effort that the hook sets on each `Agent` call (model-config docs), so it flattens every cc-tiers agent to one level. It is not a way to compare the effort ladders. I checked the main session only, not a subagent's transcript.
- **`CLAUDE_PLUGIN_OPTION_*` do not reach the hooks.** With `CLAUDE_PLUGIN_OPTION_MAX_ATTEMPTS=3` and `CLAUDE_PLUGIN_OPTION_EFFORT_LADDER=off` exported, `SessionStart` still said `Max attempts per tier: 2` and `Effort ladder: on`. Only the project file route above changes routing in an eval. Case `env:` keys must be `EVAL_*`, so they do not help either.
- **`Bash` inside the run does not work on this machine.** Every shell command from the orchestrator, implementer and reviewer failed at start with `apply-seccomp: write /proc/self/setgroups (nested userns is capability-restricted; caller must provide CAP_SYS_ADMIN): Permission denied`. I launched the evals from a sandboxed agent session. A run with that session's sandbox disabled failed the same way, so I cannot say whether the cause is the machine or the launching session; run the case from a plain terminal to find out. Agents worked around it by reading files, and the cc-tiers gate ran the tests (hooks run outside the agent's sandbox). I saw this in both debug runs; the three real runs were not kept, so I did not check it there.

## Effort sweep (issue #10)

Question: does a lower first rung of an effort ladder pass as often with fewer tokens? Four case groups (the haiku pair, the sonnet ladder pair, the sonnet one-level pair and the review case), which are seven case directories because a level is its own case, run as eight sets of 3 runs (the review case ran twice, once per `CLAUDE_CODE_EFFORT_LEVEL`). All with `--ablation none --scaffold --keep-temp --runs 3 -j 3` and `--max-cost-usd` on every invocation. Total spend $13.86, the sum of `costUsd` in the eight sweep `aggregate-result.json` files (the cap was $20).

**How a level is set.** Each case's `fixture.sh` writes `.claude/cc-tiers.json` into the run workspace (cc-tiers reads it; Claude Code does not). That sets the ladder per case, so only the agent on that ladder changes. `CLAUDE_CODE_EFFORT_LEVEL` is used only for `effort-review`, because nothing else moves the reviewer. A scaffold script gets no `EVAL_*` variables, so a variant is a separate case directory (the fixtures are copies that differ in one line). The level each agent really got comes from the hook's `model.selected` events (`config/plugins/data/cc-tiers-inline/events.jsonl` in a kept run directory), not from the ladder in the file.

| Case | What it asks | Level under test |
| --- | --- | --- |
| `effort-haiku-low`, `effort-haiku-medium` | three mechanical edits (rename in two files, a typo, a year) | haiku ladder `low, medium` vs `medium, high` |
| `effort-sonnet-medium`, `effort-sonnet-high` | the pilot's `cli.js` task | sonnet ladder `medium, high` vs `high, xhigh` |
| `effort-sonnet-only-medium`, `effort-sonnet-only-high` | the same task | sonnet ladder of one level, `medium` vs `high` |
| `effort-review` | finish a committed `cli.js` draft that counts words with `split(' ')` and lines with `split('\n').length` | all agents at `CLAUDE_CODE_EFFORT_LEVEL=medium` vs `high` |

The two review graders read `cli.js` after the run: `words-defect-gone` fails on `split(' ')`, and `lines-defect-gone` fails on the draft's own last line, `: text.split('\n').length)`. The lines grader matches that text and not any use of `split('\n').length`, because correct code can still contain that call (`text.split('\n').length - (text.endsWith('\n') ? 1 : 0)`). It is a text match, so code that moves the expression without changing the count would pass it; the six kept `cli.js` files were also run by hand (below).

Run one pair, for example: `claude plugin eval . --case effort-sonnet-only-medium --ablation none --scaffold --trust-plugin --no-publish --keep-temp --runs 3 -j 3 --max-cost-usd 2.5 --allow-tools Bash,Edit,Write`. For `effort-review` prefix `CLAUDE_CODE_EFFORT_LEVEL=medium` or `high`.

### Results

Pass rate is runs where every grader passed. The graders read the files after the run (and check that the expected agent was called); they do not run `npm test`, and **Bash inside the runs failed on this machine**, so no agent could run tests (see above). `aggregate-result.json` has no token counts, so **cost per run stands in for tokens**. 3 runs per row is too few to see a difference smaller than the spread between runs (about $0.2 for the same row).

| Model | Level (what the hook set for the first attempt) | Runs | Pass rate | Mean cost per run | Reading |
| --- | --- | --- | --- | --- | --- |
| haiku | `low` (ladder `low, medium`) | 3 | 3/3 | $0.419 | worker reached 3/3; the worker's first attempt failed on 2 of 9 tasks (no Bash), and 1 task got a second attempt |
| haiku | `medium` (ladder `medium, high`) | 3 | 3/3 | $0.401 | same pass rate, same cost within noise; the worker's first attempt failed on 6 of 9 tasks (no Bash), and 1 task got a second attempt |
| sonnet | `high` x3 (ladder `medium, high`, boosted one rung, see below) | 3 | 3/3 | $0.630 | Opus review ran in 1 of 3 |
| sonnet | `high` x2, `xhigh` x1 (ladder `high, xhigh`) | 3 | 3/3 | $0.671 | Opus review ran in 2 of 3 |
| sonnet | `medium` (single-level ladder) | 3 | 3/3 | $0.751 | Opus review ran in 3 of 3 |
| sonnet | `high` (single-level ladder) | 3 | 3/3 | $0.559 | Opus review ran in 0 of 3 |
| opus (the reviewer) | all agents at `medium` | 3 | 1/3 (re-graded) | $0.568 | `words` defect gone 3/3, `lines` defect gone 3/3 (re-graded), reviewer reached 1/3; the one run that reached the reviewer passed |
| opus (the reviewer) | all agents at `high` | 3 | 1/3 (re-graded) | $0.621 | `words` defect gone 3/3, `lines` defect gone 3/3 (re-graded), reviewer reached 1/3; the one run that reached the reviewer passed |

**The two `opus (the reviewer)` rows were re-graded by hand.** The first `lines-defect-gone` grader failed any `cli.js` that contained the text `split('\n').length`, including correct code, and the stored `aggregate-result.json` of those two run sets still holds that verdict (0/3 each; `lines` defect gone 1/3 at `medium` and 2/3 at `high`). After fixing the grader I ran the six kept `cli.js` files: all six print 2 for both `'a b\nc\n'` and `'a b\nc'` (the seeded draft prints 3 for the first), 0 for an empty file, and 3 words for `'a b\nc\n'`. So the lines defect was fixed in 3 of 3 runs at each level, and the only run in each set that passed every grader is the one that reached the reviewer. Costs do not depend on the grader and are unchanged.

What the numbers say:

- **Haiku and Sonnet: no pass-rate difference at any level** (3/3 everywhere), so the sweep cannot show that a higher level helps. Cost does not follow effort: the cheap Sonnet rows are the runs where the implementer reported `fail` (it could not run `npm test`) and the orchestrator stopped before the Opus review; the dear rows are the runs where the review ran ($0.68 to $0.81 against $0.54 to $0.58 without it). That difference is the review, not the level.
- **Opus cannot be compared through the ladder.** The reviewer is not on a ladder: it runs at the `effort: high` its agent file pins, and the hook skips review roles when it sets effort. The `opus` ladder is only read for `cc-tiers:architect`, which the dispatcher uses; in an eval the session agent is the orchestrator, which implements an Opus attempt itself, so that ladder is never reached. `effort-review` flattens everything with the environment variable instead (the hook still logs `xhigh` for the implementer in those runs, because that case has no project ladder and the keyword boost applies; the variable overrides it), and it is inconclusive: the reviewer ran in 1 of 3 runs at each level, because the implementer reported `fail` (no Bash) and the orchestrator stopped without a review. Both defects were fixed in all 6 runs, 4 of them with no review, so the implementer fixed them and no review caught them. After the re-grade the pass rate is 1/3 at each level and the `lines` defect is gone in 3/3 at each level: there is no difference between `medium` and `high`.
- **Haiku was reachable.** Three separate mechanical edits do reach `cc-tiers:worker` 3/3 at both levels (a single trivial edit takes the light path and the orchestrator edits it itself, as the pilot found).

### Findings about the plugin

- **A review keyword in the orchestrator's own note boosts the first attempt.** The delegation text mentioned `apply-seccomp ... permission denied` (the Bash failure), `permission` is an Opus review keyword, so `attemptEffort` started the Sonnet writer one rung up. With the ladder `medium, high` the implementer therefore ran at `high` in all 3 runs. The single-level ladders (`["medium"]`, `["high"]`) avoid it, because a rung past the end of the list stays on the last level. On a machine where Bash works the note would not appear, so rerun the ladder pair there before reading it as a clean comparison.
- **The haiku ladder is not boosted** (`attemptEffort` skips the boost for haiku), so its two rows are the levels they say.
- **With no Bash the verify gate decides, and the implementer's own `fail` stops the run.** An implementer that cannot run its tests reports `fail`, the hook counts a failed attempt, and the orchestrator in these runs did not retry. That is a property of this machine (and of launching the evals from a sandboxed session), not of the effort level.

### Recommendation per model

The rule in the issue: change the ladder only where a level passes as often with fewer tokens, or more often.

| Model | First rung now | Decision | Numbers |
| --- | --- | --- | --- |
| haiku | `low` | keep | `low` 3/3 at $0.419 against `medium` 3/3 at $0.401: same pass rate, no saving to claim (the $0.018 gap is under the $0.2 spread). The worker first-attempt failures (2 of 9 at `low`, 6 of 9 at `medium`) come from the Bash block (the worker could not run `node --test`), and only 1 task per level got a second attempt, so they say nothing about the level |
| sonnet | `high` | keep | the one-level pair passes the same (3/3 each) but `medium` cost more ($0.751 against $0.559) because its runs reached the review; the ladder pair is $0.630 against $0.671, within the spread. No level passes more often, none passes cheaper for a reason about effort |
| opus | `high` | keep | not measurable here: the reviewer is outside the ladder, and the review case reached the reviewer in 1 of 3 runs per level (pass rate 1/3 and `lines` defect gone 3/3 at both `medium` and `high`, re-graded) |

Nothing in `config/routing.default.json`, `agents/*.md` or `hooks/` was changed. A repeat on a machine where Bash works, with more runs, is the way to get a real Sonnet and Opus reading.

## Rerun attempt (issue #18)

The sweep above could not tell levels apart because Bash failed inside every run. Issue #18 tried to rerun it with Bash working. It did not get that far on this machine.

**Precheck.** With `kernel.apparmor_restrict_unprivileged_userns` set to `0` for the run, one run of `research-before-implementer` passed its graders (score 1.00, $0.87, `evals/results/2026-11-19T15-55-24-917Z`), but Bash still failed in it: the kept trace has `apply-seccomp: write /proc/self/setgroups (nested userns is capability-restricted; caller must provide CAP_SYS_ADMIN): Permission denied`, and the implementer reported `fail` because `npm test` could not run. The sweep was not started.

**Cause.** The sysctl alone is not enough on Ubuntu with AppArmor. The `bwrap-userns-restrict` profile (`/etc/apparmor.d/bwrap-userns-restrict`) lets `bwrap` create its user namespace but strips capabilities from its children, so the nested user namespace the eval's Bash sandbox needs is denied. It reproduces without the eval: `bwrap --dev-bind / / --unshare-user -- bwrap --dev-bind / / --unshare-user -- true` fails with "No permissions to create a new namespace".

**To measure.** Run the cases on a machine or CI runner without that profile (or, for the run only, with `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` and `sudo apparmor_parser -R /etc/apparmor.d/bwrap-userns-restrict`, restored afterwards with `sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict` and `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=1`; the maintainer chose not to do this here). Check first that the trace of one pilot run has no `apply-seccomp` line.

**Ready cases.** `effort-review-opus-medium` and `effort-review-opus-high` copy `effort-review` and set the reviewer's level through the project file (`{"effort": {"opus": ["medium", "xhigh"]}}` and `["high", "xhigh"]`), which cc-tiers now honours for review roles (`reviewEffort` in `hooks/cc_tiers.mjs`), instead of flattening every agent with `CLAUDE_CODE_EFFORT_LEVEL`. The opus ladder also sets `cc-tiers:planner` (and an Opus `cc-tiers:architect` writer), so a run that calls either has a second variable; the orchestrator itself keeps its own effort. Run them with the haiku pair and the one-level sonnet pair, 3 runs each:

```
for c in effort-haiku-low effort-haiku-medium effort-sonnet-only-medium effort-sonnet-only-high effort-review-opus-medium effort-review-opus-high; do
  claude plugin eval . --case "$c" --ablation none --scaffold --trust-plugin --no-publish --keep-temp --runs 3 -j 3 --max-cost-usd 4 --allow-tools Bash,Edit,Write
done
```

**Decision.** No new numbers, so the ladders stay as they are (haiku `low`, sonnet `high`, opus `high`). For haiku and sonnet the reasons are in the table above; for opus the reason is now only the missing measurement, since the reviewer does follow a project ladder (`reviewEffort`, commit 27580ec).
