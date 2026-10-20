# 🎚️ cc-tiers

### Opus plans and reviews. Sonnet builds. Research comes first.

A Claude Code plugin for Pro and Max subscribers who want better answers, not cheaper ones. Plan, research, implementation, and review each run in their own context: Opus plans, Sonnet researches and then builds, and Opus reviews the result without having seen how it was written. When a task fails, the next tier gets the failure notes. The [benchmark](#-benchmark) measures quality with standard metrics; tokens are the price of that quality, not the goal.

[![Claude Code](https://img.shields.io/badge/Claude_Code-2.1.295%2B-d97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://claude.com/claude-code)
[![Plugin](https://img.shields.io/badge/type-plugin-8a63d2?style=for-the-badge)](#-install)
[![License: MIT](https://img.shields.io/badge/license-MIT-2f81f7?style=for-the-badge)](LICENSE)

**English** · [Português](README.pt-BR.md)

🔬 research before code  •  🧐 independent review  •  🪜 more effort before a bigger model  •  🔁 two failures, then escalate  •  📏 quality measured

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
| Plan | `cc-tiers:orchestrator` | Opus | Splits the request, delegates, and implements only the ceiling |
| Research | `cc-tiers:researcher` | Sonnet | Finds the installed version, that version's docs, and existing usage before code is written. Does not edit |
| Default | `cc-tiers:implementer` | Sonnet | Features, bug fixes, tests, local refactors |
| Trivial | `cc-tiers:worker` | Haiku | Renames, typos, formatting, lookups, simple searches, ~15-line edits |
| Check | `cc-tiers:checker` | Sonnet | A fresh pass over Haiku's output. Does not edit |
| Review | `cc-tiers:reviewer` | Opus | A fresh pass over risky or non-trivial work. Does not edit |
| Light mode | `cc-tiers:dispatcher` | Sonnet | Optional session agent for when the window is tight: it routes on Sonnet and calls Opus only when needed |
| Light plan | `cc-tiers:planner` | Opus | Plans a multi-task request for the dispatcher. Does not edit |
| Light ceiling | `cc-tiers:architect` | Opus | Implements the ceiling for the dispatcher |

While the plugin is enabled, `settings.json` sets the session agent to `orchestrator`. Your own `agent` in `~/.claude/settings.json` still wins. If you override it, `/cc-tiers:tiers` runs the same workflow.

The agents pin `model: haiku`, `sonnet`, or `opus`. The orchestrator does not pass a model on the call, because a per-call override would replace the tier. A PreToolUse hook refuses a cc-tiers delegation that tries.

```mermaid
flowchart LR
    A[Opus orchestrator] --> B{Task}
    B -- trivial --> C[Haiku worker]
    B -- normal --> R[Sonnet researcher]
    R -- brief --> D[Sonnet implementer]
    C -- fail twice --> D
    D -- fail twice --> E[Opus implements]
    C -- pass --> H[Sonnet checker]
    D -- pass, risky --> F[Opus reviewer]
    H -- reject --> C
    F -- reject --> D
    H -- approve --> G[Done]
    F -- approve --> G
```

---

## 🔬 Research first

Code written from memory of an old API version fails in ways a test does not always catch. Before a task goes to `cc-tiers:implementer` or `cc-tiers:architect`, `cc-tiers:researcher` (Sonnet, read-only) checks four things:

- The version in use, read from the lock file first and the manifest second.
- The docs of that version, from `vendor/` or `node_modules/` when installed, never the docs of the latest release by default.
- How the repo already calls the API, as `file:line`.
- Prior art outside the repo, only when it applies.

It returns a brief of under about 30 lines in three blocks, **Version and docs**, **In the repo**, and **Outside the repo**, with a source for every fact. The orchestrator pastes the whole report, trailer included, into the writer's prompt between two lines that hold only `CC_TIERS_RESEARCH_BEGIN` and `CC_TIERS_RESEARCH_END`, and adds `CC_TIERS_RESEARCH: done`. A task that touches no library, framework, or external API says why instead: `CC_TIERS_RESEARCH: none - <reason>`. One brief can serve several tasks: the researcher's prompt carries `CC_TIERS_COVERS: <slug>, <slug>`, and a pass marks all of them.

The PreToolUse hook enforces this. It refuses a call to the implementer or the architect that has neither a finished research for that task nor a `none` line. A research is not an attempt, and a failed research does not count against the task. The worker is exempt. The Opus ceiling and the dispatcher's own task are researched by prompt, with no hook check. `research: off` removes the step and the check.

---

## 🔁 Escalation

A failure is a failed test, a rejected review, or a subagent error. The task may fail **twice** at its tier (`max_attempts`, default 2). The next attempt moves up, and the failure notes go with it:

**Haiku → Sonnet → Opus**

The new tier starts at zero. Opus is the last stop: the orchestrator does that work itself, and if those attempts fail too it stops and tells you. A review rejection counts against the tier that wrote the diff, not against the checker or the reviewer. Budget routing does not block this ceiling.

A hook on the Agent tool keeps the counter. When it reports `cc-tiers counted a failure`, that count is the one the orchestrator follows.

The hooks enforce what the prompts ask for:

- **Before a delegation** (PreToolUse), a call to a cc-tiers agent is refused when it passes `model`, has no `CC_TIERS_TASK` header, or sends an escalated task back down a tier. Sending a task up early (`/cc-tiers:escalate`) moves the counter with the notes carried.
- **Research** (`research: on`, the default): a call to the implementer or the architect is refused when its task has neither a researcher pass nor a `CC_TIERS_RESEARCH: none - <reason>` line.
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

The PreToolUse hook sets `effort` on the Agent call (Claude Code's per-call `effort`, 2.1.292+), so the orchestrator cannot forget it. It may ask for a higher level, never a lower one, and never above the top of the ladder. A risky Sonnet task, one that matches a review keyword, starts at `xhigh`. While budget routing is conserving, effort stops at `high`. When the Opus orchestrator implements the ceiling itself, it keeps its own session effort. `CLAUDE_CODE_EFFORT_LEVEL`, when set, wins over all of this.

`effort_ladder: off` leaves each agent at the effort its file pins. A project can replace a ladder in `.claude/cc-tiers.json` with `effort.haiku`, `effort.sonnet`, `effort.opus`, and `effort.conserveCap`.

---

## 🧪 Classifier

The keyword lists are a first guess. Two checks stand behind them before a task reaches Haiku:

- **Complexity score**, local and free. Several steps (bullets, "and then", "e depois"), three or more files, design or investigation wording (refactor, architecture, debug, flaky, memory leak), or a long brief add points. At 2 points a trivial-looking task starts on Sonnet. `/cc-tiers:route` prints the score and its signals.
- **Large files.** When the task names files in the project that add up to 400 KB or more (`largeFileBytes`), it starts on Sonnet. This is cc-tiers' take on long-context routing: every current model has a 1M window, but a huge file is still a lot for one cheap pass, and Haiku 4.5, if your `haiku` alias still points there, has only 200K.
- **Haiku classifier**, a `prompt` hook that runs only on `cc-tiers:worker` calls. A quick Haiku pass reads the task, and when it is not really trivial the call is refused with the reason, and the orchestrator sends the same slug to Sonnet. That is a routing correction, not a failure. `classifier: local` turns it off: the orchestrator then marks worker prompts `CC_TIERS_CLASSIFY: skip`, which the command hook only accepts in that mode.

---

## 🪶 Light mode

Plan, research, and review in separate contexts use more of your window than one thread. Light mode is for when the window is tight. The Opus orchestrator reads every request, even a typo fix, and every subagent starts a fresh context, so for a small task that overhead can cost more than the task. Two things cut it:

- **Light path** (`light_path: inline`, the default). When a request is one trivial task, the UserPromptSubmit hook tells the session agent to do it itself: no plan, no worker, no checker. `delegate` sends it to the worker in one call instead (the 0.4 behavior), and `off` plans every request.
- **Light mode**, the `cc-tiers:dispatcher` session agent on Sonnet. It does one ordinary task itself, marking the attempt with a `CC_TIERS_ROLE: dispatcher` trailer that the hooks count, so two failures still move it to Opus. It calls Opus only for three things: `cc-tiers:planner` for a request with more than one task or a design decision, `cc-tiers:architect` for a task that used its attempts on Sonnet, and `cc-tiers:reviewer` for risky work.

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

With `learn` set to `on` (the default), a Haiku failure is appended to `.claude/cc-tiers-history.json` in the project. The next task with the same slug, or enough of the same words, starts on Sonnet instead of Haiku. A task that used its attempts on Sonnet is recorded too, and a similar task later starts on Sonnet at the top of its effort ladder (`xhigh`) instead of climbing it again. Opus still never starts a task. Words are compared without accents, so `migração` and `migracao` match. `off` writes nothing and ignores the file.

The first write adds the file to `.git/info/exclude` when the project is a git checkout (worktrees included), so it stays out of git without touching your tracked `.gitignore`. The plugin repo ignores that path too.

---

## 💬 Commands

| Command | What it does |
| --- | --- |
| `/cc-tiers:tiers [task]` | Plan, route, and run the work |
| `/cc-tiers:route [task]` | Name the tier and stop. Runs the same heuristic as the hooks. No edits |
| `/cc-tiers:escalate [slug]` | Move that task up one tier now, notes included |
| `/cc-tiers:report [--all]` | Per-task table for this session: tiers, attempts, effort, review, status, and cost next to Opus rates |

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
| `light_path` | `inline` | One trivial task: `inline` does it in the session, `delegate` sends it to the worker, `off` plans it |
| `show_cost` | `off` | `on` shows the estimated cost of each task and the session next to Opus rates |
| `research` | `on` | Require a researcher brief, or a `none - <reason>` line, before code goes to the implementer or the architect. `off` removes the step |

`risky` is the default: Opus reviews non-trivial work in a fresh context and skips a trivial Haiku pass. `cheap` sends Haiku output to the Sonnet checker and sends Opus review only for a review phrase or the ceiling. `always` reviews every pass (Haiku on Sonnet, the rest on Opus). `never` skips review. While a budget window is conserving, Opus review is reserved for critical work even under `risky` or `always`.

Routing matches two kinds of lists. **Phrases** (`when`, `reviewWhen`, and the `_extra` options) match when the whole phrase appears in the task. **Keywords** (`haiku.keywords`, `opus.reviewKeywords`) match at the start of a word, case- and accent-insensitive: `migra` finds "migration" and "migração", `authent` finds "authentication" but not "author". The built-in keywords cover renames, typos, formatting and lookups for Haiku, and auth, payments, migrations, schemas, public APIs, security, and concurrency for Opus review, in English and Portuguese. A task that looks trivial but hits a review keyword, or scores 2 on complexity (`sonnet.complexKeywords` is one of its signals), starts on Sonnet.

To replace a whole list, add `.claude/cc-tiers.json` to the project. A list you include replaces that list; lists you omit stay at the default. The same file may set `learn`, `budget5h`, and `budget7d` when `/config` leaves them empty. `/config` still wins when both are set. See `config/cc-tiers.example.json`.

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

The escalation order is fixed. Routing phrases and keywords, the retry limit, the effort ladders, the review policy, the research gate, the classifier, learning, and the two budget thresholds are the knobs.

---

## 📊 Benchmark

> [!IMPORTANT]
> **The benchmark measures quality first.** A run spends tokens, and cc-tiers spends more of them than one model alone, because plan, research, build, and review are separate contexts. Those extra tokens are meant to buy tasks that pass and keep passing; the table shows whether they do. A configuration is judged on the quality columns before it is judged on tokens.

`bench/` grades each run by hidden checks and reports metrics that come from published work:

| Metric | Meaning | Where it comes from |
| --- | --- | --- |
| `pass@1` | Share of runs that resolve the task, averaged over tasks | pass@k, HumanEval (Chen et al., 2021) |
| `pass^k` | Share of tasks solved in all `k` repetitions. It drops when a configuration is lucky, not reliable. The table shows it as `(k=N)` | pass^k, τ-bench (Yao et al., 2024) |
| FAIL_TO_PASS | The hidden check that fails on the untouched fixture must pass after the change | SWE-bench (Jimenez et al., 2024) |
| PASS_TO_PASS | Test files that passed before the step must still pass: each is re-run in its before-form, one file at a time | SWE-bench (Jimenez et al., 2024) |
| Resolved | FAIL_TO_PASS passed and no PASS_TO_PASS file regressed | SWE-bench |
| Tokens per resolved task | Fresh tokens (input + cache write + output) of the whole run divided by resolved tasks | cc-tiers |

Tests the model wrote do not count toward resolved; they are kept in the raw JSON as `ownTests`. A task in a tasks file may also list `changesTests`: the original test files that task legitimately changes. They are left out of PASS_TO_PASS. Nothing is recorded per run.

**Four suites.**

- `bench/tasks.json`: seven small tasks (3 trivial, 2 normal, 1 mixed, 1 hard) on `bench/fixture/`.
- `bench/tasks-hard.json`: twelve tasks on `bench/fixture-hard/`, a 1,600-line Node service with shared state, time zones, and async booking. It has 4 trivial, 3 normal, 3 hard (a race that only shows under concurrent requests, a path-traversal fix whose naive version passes the visible tests, a multi-tenant refactor that must keep the public API), and 2 large requests that each mix a trivial, a normal, and a hard change. Each hidden check in `bench/checks-hard/` fails on the untouched fixture and passes with the reference fix in `bench/solutions-hard/`.
- `bench/tasks-calc.json`: one normal task on `bench/fixture-calc/`, an expression evaluator (`src/calc.js`) with precedence, unary minus, and error cases. The hidden check is in `bench/checks-calc/` and the reference in `bench/solutions-calc/calc.js`. It is the showcase: one task, repeated.
- `bench/tasks-trap.json`: one hard task on `bench/fixture-trap/`, a `loadConfig` that reads `.env` and `.env.local` with the installed dotenv. The installed version is 8.6.0, older than what models remember: it has no multi-line values and keeps ` # comment` in an unquoted value, and code written for a newer dotenv runs without an error and returns the wrong values. Research (reading the installed version and its docs) and validation (testing the rules the task states) are what catch it. The hidden check is in `bench/checks-trap/` and the reference in `bench/solutions-trap/config.js`; `npm test` also checks that a naive dotenv 8.6.0 solution fails it.

`npm test` verifies both sides of every check: it fails on the fixture and passes with the reference.

**Run it.**

```bash
npm run bench -- --tasks-file bench/tasks-calc.json --repeat 3
node bench/run.mjs --tasks-file bench/tasks-hard.json --session --repeat 3 --timeout 30
```

> [!WARNING]
> A run uses your real Claude Code login, so on Pro or Max it spends your usage window. A `--repeat 3` run of four configurations is many sessions. Start with the calculator suite. `npm run bench:table -- <result files>` prints the table from saved results.

**Cheap comparison.** The tasks that tell the configurations apart are the trap and two hard tasks. This runs only those, against Opus only, Sonnet only, and cc-tiers, and merges the results into one table:

```bash
npm run bench -- --tasks-file bench/tasks-trap.json --configs opus,sonnet,cc-tiers --repeat 3 --out bench/results/trap.json
npm run bench -- --tasks-file bench/tasks-hard.json --tasks traversal,race --configs opus,sonnet,cc-tiers --repeat 3 --out bench/results/hard-pair.json
npm run bench:table -- bench/results/trap.json bench/results/hard-pair.json
```

The runner loads only project and local settings, so your own CLAUDE.md, agents, and plugins stay out of the measurement. In session mode it stores usage per step, because Claude Code reports usage cumulative over a session on `--resume`. For cc-tiers it also reads, from the session transcript, the escalations the hooks announced and whether each task was routed as this README says.

**Results.** The columns are `Configuration`, `pass@1`, `pass^k`, `Resolved`, `Regressions`, `Tokens per resolved task`, `Δ tokens vs Opus only`, and `Δ pass@1 vs Opus only`. The last one is the configuration's pass@1 minus Opus only's, in percentage points (`+33 pp`, `−17 pp`), so the gain or loss from the orchestrator is read in one cell. Below the per-task table, **Where it made a difference** lists only the tasks where some configuration resolved a different share of runs than Opus only, as `resolved/k`; when none did, it says `No task differs from Opus only.`

| Configuration | pass@1 | pass^k | Resolved | Regressions | Tokens per resolved task | Δ tokens vs Opus only | Δ pass@1 vs Opus only |
| --- | --: | --: | --: | --: | --: | --: | --: |
| Opus only | not measured yet | not measured yet | not measured yet | not measured yet | not measured yet | — | — |
| Sonnet only | not measured yet | not measured yet | not measured yet | not measured yet | not measured yet | not measured yet | not measured yet |
| cc-tiers (Opus orchestrator) | not measured yet | not measured yet | not measured yet | not measured yet | not measured yet | not measured yet | not measured yet |
| cc-tiers light (Sonnet dispatcher) | not measured yet | not measured yet | not measured yet | not measured yet | not measured yet | not measured yet | not measured yet |

**What the 0.5 data can and cannot say.**

- The 0.5 result files (`bench/results/*-0.5.json`) were graded with the old pass criterion: the hidden check plus the model's own tests, with no before-form PASS_TO_PASS. Their pass rates are not like-for-like with 0.6.
- The 0.5 session-mode dollar column summed session-cumulative cost, so it overstated the cost per task. That table is withdrawn from this README.
- In session mode, a test file the model added in an earlier step can count as a regression in a later step.
- Sonnet calibration on the hard suite (`bench/results/calibration-sonnet-hard.json`), graded with the old criterion: Sonnet alone failed the path traversal, because it still served a file through a symlink. It ran the race task three times; the two runs kept for re-grading fail the final check, because both fixes queue every request behind one lock. The first run passed an earlier version of the check and was not kept. It solved the refactor in all three runs; the two graded against the final check passed it.
- The large tasks and the final race check have only been tried against the reference fixes and the saved Sonnet fixes, never against a live model.

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
| `hooks/report.mjs` | The table behind `/cc-tiers:report` |
| `commands/report.md` | `/cc-tiers:report` |
| `bench/` | The benchmark: four fixtures (including the calculator and dotenv trap suites), tasks, hidden checks, runner, and results |
| `.github/workflows/ci.yml` | Tests on Linux, macOS, and Windows, and `claude plugin validate` |
| `CHANGELOG.md` | Release notes |

## 🔒 Privacy

No telemetry, and the command hooks make no network calls. With `classifier: haiku`, the classifier hook sends each `cc-tiers:worker` call's input to Haiku through Claude Code, the same way the session reaches Claude. The hooks read the routing files, the plugin options Claude Code already passes in, the session transcript, and cc-cost's local plugin data when that plugin is installed. They write the attempt counter under the plugin data directory (`latest.json` and one file per session) and, when learning is on, `.claude/cc-tiers-history.json` in the project plus one line in `.git/info/exclude`. Uninstalling the plugin removes the plugin data directory unless you pass `--keep-data`. The history file stays in the project until you delete it.

---

Made with ☕ by [@edsoncantuaria](https://github.com/edsoncantuaria) · [MIT](LICENSE)

If it gets you better answers, leave a ⭐
