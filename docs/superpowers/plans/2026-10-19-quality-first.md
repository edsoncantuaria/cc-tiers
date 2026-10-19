# cc-tiers 0.6 — quality first: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reposition cc-tiers around answer quality: quality-first defaults, a mandatory research step before code is delegated, and a benchmark that reports quality metrics (resolved %, pass@1, pass^k, regressions) with tokens as their price.

**Architecture:** All routing logic stays in `hooks/cc_tiers.mjs` (pure functions + `checkDelegation`/`applyEvent`), tested from `tests/cc_tiers.test.mjs`. The new `cc-tiers:researcher` agent is a read-only Sonnet subagent whose pass marks slugs as researched in session state; the PreToolUse gate checks that mark. The benchmark runner `bench/run.mjs` splits grading into FAIL_TO_PASS (hidden check) and PASS_TO_PASS (tests that passed before the step, run in their before-form).

**Tech Stack:** Node 18+ ESM, `node:test`, no dependencies. Claude Code plugin (agents, hooks, userConfig) 2.1.295+.

**Spec:** `docs/superpowers/specs/2026-10-19-quality-first-design.md`

## Global Constraints

- Node 18+, no new dependencies. Plugin files in English, short concrete sentences, few comments; README.pt-BR.md mirrors README.md.
- `npm test` and `claude plugin validate --strict .` must pass after every task.
- Defaults: `review_policy` = `risky`, `show_cost` = `off`, `research` = `on`, Sonnet effort ladder = `["high", "xhigh"]`, `implementer.md` `effort: high`.
- Researcher: `model: sonnet`, `effort: medium`, `maxTurns: 25`, tools `Read, Grep, Glob, Bash, WebSearch, WebFetch`, brief ≤ ~30 lines in three blocks (Version and docs / In the repo / Outside the repo), every fact with a source, "not found" instead of a guess.
- Gate lines: `CC_TIERS_RESEARCH: done` or `CC_TIERS_RESEARCH: none - <reason>`. Brief delimiters: `CC_TIERS_RESEARCH_BEGIN` / `CC_TIERS_RESEARCH_END` (own lines). Multi-slug: `CC_TIERS_COVERS: <slug>, <slug>`.
- Do not change the escalation order, the counter, budget routing, light mode, or cc-cost integration. Do not delete files in `bench/results/`. Do not run the full benchmark.
- Version 0.6.0. Commits only when the user has said so (their rule); one commit per task, message in Portuguese, short.

## Review Focus

1. A researcher report pasted into a writer prompt carries its own trailer (`CC_TIERS_TASK`, `CC_TIERS_ROLE: researcher`, `CC_TIERS_STATUS`). Lines inside the research block must never be read as the writer's headers → Task 2, test `headers inside the research block are ignored`.
2. A researcher launched in the background has not finished when the orchestrator writes `done` → the gate refuses until the SubagentStop report marks it → Task 2, test `a background researcher marks the slug only when it reports pass`.
3. A slug that passed (and so was deleted from `state.tasks`) is reused for a follow-up delegation → research mark survives → Task 2, test `the research mark survives a passed task`.
4. In `--session` mode a test file the model deleted or rewrote counts against PASS_TO_PASS in its before-form, while a file an earlier task legitimately changed does not → Task 4, test `pass-to-pass uses the before-form of each test file`.
5. `--table` over old result files (no `resolved`/`f2p`/`p2p` fields) must still render, using `pass` as resolved → Task 4, test `old result rows render with pass as resolved`.

---

### Task 1: Quality-first defaults

**Files:**
- Modify: `config/routing.default.json` (`reviewPolicy`, `effort.sonnet`, add `"showCost": false`)
- Modify: `hooks/cc_tiers.mjs:54-56` (`DEFAULT_LADDERS.sonnet`, `AGENT_EFFORT.implementer`)
- Modify: `agents/implementer.md` (frontmatter `effort: high`; the body sentence about "a retry runs at a higher effort" stays true)
- Modify: `.claude-plugin/plugin.json` (`review_policy.default` = `risky`, `show_cost.default` = `off`; descriptions say what the default now means)
- Test: `tests/cc_tiers.test.mjs`

**Interfaces:**
- Produces: `DEFAULT_LADDERS.sonnet === ['high', 'xhigh']`, `AGENT_EFFORT.implementer === 'high'`, `mergeRouting(defaults)` → `reviewPolicy: 'risky'`, `showCost: false`.

- [ ] **Step 1: Update the tests that pin defaults.** In the manifest test assert `review.default === 'risky'` and `manifest.userConfig.show_cost.default === 'off'`; in the agents test set `implementer: 'high'` in `efforts`. Add `test('quality defaults: risky review, cost hidden, Sonnet starts at high')` asserting on `mergeRouting(loadJson('config/routing.default.json'))`: `reviewPolicy === 'risky'`, `showCost === false`, `effort.ladders.sonnet` deep-equals `['high', 'xhigh']`, and `decideTier('Add pagination to GET /users', routing).effort === 'high'`.
- [ ] **Step 2: Run `npm test`** — Expected: the new/changed assertions FAIL.
- [ ] **Step 3: Change the defaults** listed under Files.
- [ ] **Step 4: Run `npm test`.** Other existing tests that encoded the old defaults (e.g. `routing.reviewPolicy === 'cheap'` at ~line 303, Sonnet first effort `medium`) will fail: update only those expectations to the new defaults; tests that pass `review_policy`/ladders explicitly stay as they are. Expected: all PASS. Then `claude plugin validate --strict .` → passes.
- [ ] **Step 5: Commit** `git commit -m "Padrões focados em qualidade: revisão risky, custo oculto, Sonnet começa em high"`

### Task 2: Research gate in the hooks

**Files:**
- Modify: `hooks/cc_tiers.mjs` — `SCOPED`, `ROLES`, `AGENT_EFFORT`, `stripHeaders`, `parseHeaders`, `mergeRouting`, `formatSessionContext`, `emptyState`/`loadState`, `applyEvent`, `processReport`, `checkDelegation`, `userFromEnv`
- Modify: `config/routing.default.json` (`"research": true`), `.claude-plugin/plugin.json` (option `research`: string, options `["on","off"]`, default `on`, description of the gate and the `none - <reason>` escape)
- Test: `tests/cc_tiers.test.mjs`

**Interfaces:**
- Produces:
  - `ROLES.researcher = 'sonnet'`, `SCOPED.researcher = 'cc-tiers:researcher'`, `AGENT_EFFORT.researcher = 'medium'`. Not in `WRITER_ROLES`, `REVIEW_ROLES`, or `SESSION_ROLES`.
  - `stripResearch(text: string): string` — removes every `CC_TIERS_RESEARCH_BEGIN`…`CC_TIERS_RESEARCH_END` block (inclusive; an unclosed BEGIN strips to the end).
  - `parseHeaders` and `stripHeaders` call `stripResearch` first.
  - `mergeRouting(...).research: boolean` — `/config` `research` wins over project `research`, which wins over defaults; parsed with `parseLearn`, fallback `true`.
  - `researchLine(routing): string` — one line in `formatSessionContext`, after `classifierLine`.
  - State: `state.researched: { [slug]: true }` in `emptyState`, normalized in `loadState`, capped at `MAX_SEEN` entries (drop oldest).
  - `applyEvent` for role `researcher`: needs a `CC_TIERS_TASK`; on `STATUS: pass` marks the task slug and each slug in `CC_TIERS_COVERS` (comma-separated, slugified); never counts an attempt; `meta.outcome = 'research'`; message `cc-tiers marked <slugs> as researched.` (pass) or `cc-tiers: research for <slug> did not pass; research again or use CC_TIERS_RESEARCH: none - <reason>.` (fail/missing status). Its spend goes to the task slug (not `(orchestration)`); `logReport` is not called for it.
  - `checkDelegation`: `researcher` needs the `CC_TIERS_TASK` header and otherwise passes. For `implementer` and `architect` when `routing.research` is true, before any state change: header `RESEARCH` must be `done` with `state.researched[task]` set, or match `/^none\s*-\s*\S/`. Refusal texts: `cc-tiers: run cc-tiers:researcher for <task> before delegating it, or add CC_TIERS_RESEARCH: none - <reason>.` / `cc-tiers: <task> has no finished research. Wait for cc-tiers:researcher to report pass, or use CC_TIERS_RESEARCH: none - <reason>.` `worker` is exempt.
  - Routing signals ignore the brief: `checkDelegation` passes `stripResearch(prompt)` to `decideTier`, `assessComplexity`, and `attemptEffort`; history already goes through `stripHeaders`.
  - `userFromEnv().research = env.CLAUDE_PLUGIN_OPTION_RESEARCH || null`.

- [ ] **Step 1: Write the failing tests** (helpers `event`, `report`, `riskyRouting` already exist in the file):
  - `stripResearch drops the brief and an unclosed block` — `'a\nCC_TIERS_RESEARCH_BEGIN\nauth schema\nCC_TIERS_RESEARCH_END\nb'` → `'a\nb'`; unclosed → `'a'`.
  - `headers inside the research block are ignored` — prompt `CC_TIERS_TASK: csv\n…BEGIN\nCC_TIERS_TASK: other\nCC_TIERS_ROLE: researcher\nCC_TIERS_STATUS: pass\n…END` → `parseHeaders(...).TASK === 'csv'`, no `STATUS`.
  - `the gate refuses an implementer without research` — `research: true`: no `RESEARCH` line → deny contains `run cc-tiers:researcher for csv`; `done` without a mark → deny contains `has no finished research`; `none -` (empty reason) → deny; `none - pure refactor, no external API` → allowed; `research: false` → allowed without the line; `cc-tiers:worker` → allowed without the line; a refused call leaves `state.tasks` unchanged.
  - `a researcher pass marks the task and its covers` — `applyEvent` with role researcher, prompt `CC_TIERS_TASK: csv\nCC_TIERS_COVERS: date-filter, cancel`, report `STATUS: pass` → `state.researched` has the three slugs, `meta.outcome === 'research'`, `state.tasks.csv` undefined; then `checkDelegation` with `CC_TIERS_RESEARCH: done` for `cancel` → allowed. A `STATUS: fail` report marks nothing.
  - `a background researcher marks the slug only when it reports pass` — `kind: 'background'` event marks nothing; the later report (as SubagentStop delivers it) marks it.
  - `the research mark survives a passed task` — mark `csv`, then an implementer pass with `REVIEW: skip` deletes `state.tasks.csv`; `state.researched.csv` is still true.
  - `the brief does not raise effort or complexity` — a Sonnet prompt with `CC_TIERS_RESEARCH: done` and a brief full of `schema`, `permission`, `login` words and bullet lines gets the same `input.effort`/notes as the same prompt without the brief.
  - `research is a /config and project option` — `mergeRouting(defaults, { research: false }).research === false`; `mergeRouting(defaults, { research: false }, { research: 'on' }).research === true`; manifest has `research` with options `['on','off']`, default `'on'`; `formatSessionContext` includes `Research: on`.
- [ ] **Step 2: Run `npm test`** — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the interfaces above in `hooks/cc_tiers.mjs`, `config/routing.default.json`, `.claude-plugin/plugin.json`. Agents test (`agents pin family aliases`) will need `researcher` once Task 3 adds the file — until then keep `AGENT_EFFORT` assertions consistent by adding `researcher: 'medium'` to the test's `efforts` only in Task 3.
- [ ] **Step 4: Run `npm test`** → all PASS; `claude plugin validate --strict .` → passes.
- [ ] **Step 5: Commit** `git commit -m "Gate de pesquisa no hook: researcher marca o slug, implementer exige pesquisa"`

### Task 3: The researcher agent and the prompts that use it

**Files:**
- Create: `agents/researcher.md`
- Modify: `agents/orchestrator.md`, `agents/dispatcher.md`, `agents/implementer.md`, `agents/architect.md`, `agents/reviewer.md`, `agents/checker.md`, `skills/tiers/SKILL.md`
- Test: `tests/cc_tiers.test.mjs` (agents test)

**Interfaces:**
- Consumes: Task 2's header names, delimiters, refusal texts, and `research` option (`${user_config.research}` placeholder in the session agents' live settings lists).
- Produces: `agents/researcher.md` frontmatter `name: researcher`, `model: sonnet`, `effort: medium`, `maxTurns: 25`, `tools: Read, Grep, Glob, Bash, WebSearch, WebFetch`, a `color`.

- [ ] **Step 1: Extend the agents test** — add `researcher: 'sonnet'` to `expected`, `researcher: 'medium'` to `efforts`, and assert `frontmatter(agents/researcher.md).tools` matches `/^Read, Grep, Glob, Bash, WebSearch, WebFetch$/` and `maxTurns` is `'25'`. Assert `orchestrator.md`, `dispatcher.md` and `skills/tiers/SKILL.md` each contain `cc-tiers:researcher`, `CC_TIERS_RESEARCH_BEGIN` and `CC_TIERS_RESEARCH: none - `.
- [ ] **Step 2: Run `npm test`** — Expected: FAIL (file missing).
- [ ] **Step 3: Write `agents/researcher.md`.** Body, in the style of the other agents: the four steps from the spec (version from the lock before the manifest — `composer.lock`, `package-lock.json`/`pnpm-lock.yaml`/`yarn.lock`, `poetry.lock`/`uv.lock`/`requirements*.txt`, `go.sum`, `Cargo.lock`; docs of that version from `vendor/`/`node_modules/` or versioned docs or the repo at the tag, saying so when only `main` docs were found; existing usage in the repo as `file:line`; prior art outside the repo, its idea and what changes here, only if applicable, else "nothing applicable"), the three-block brief with a source per fact, "not found" instead of guessing, Bash only for reading, no edits, no agents, and the trailer `CC_TIERS_TASK / CC_TIERS_TIER: sonnet / CC_TIERS_ROLE: researcher / CC_TIERS_STATUS: pass|fail / CC_TIERS_REASON`, echoing `CC_TIERS_COVERS` when the prompt has it.
- [ ] **Step 4: Update the prompts.**
  - `orchestrator.md` and `dispatcher.md`: researcher row in "Who does the work"; a "Research" step before delegating to `cc-tiers:implementer` or `cc-tiers:architect` (and before the orchestrator's own ceiling attempt / the dispatcher's own task, where no hook checks it); independent researches in parallel; one research may cover several slugs with `CC_TIERS_COVERS`; paste the brief between the delimiters under the header and add `CC_TIERS_RESEARCH: done`, or `CC_TIERS_RESEARCH: none - <reason>` when the task touches no library, framework, or external API; `Research: ${user_config.research}` in the live settings list (fallback `on`). Orchestrator intro: quality first (plan, research, independent review), light mode as the choice when the window is tight — remove "cheaper session agent" framing.
  - `implementer.md` / `architect.md`: the brief is fact; for an API fact the brief lacks, check the lock and that version's docs before using it; never assume a signature.
  - `reviewer.md` / `checker.md`: check the change uses the API of the version the brief names.
  - `skills/tiers/SKILL.md`: add the research step to its flow.
- [ ] **Step 5: Run `npm test`** → PASS; `claude plugin validate --strict .` → passes.
- [ ] **Step 6: Commit** `git commit -m "Agente researcher e passo de pesquisa nos prompts"`

### Task 4: Quality metrics in the benchmark runner

**Files:**
- Modify: `bench/run.mjs` (`check`, `summarize`, `table`, `kindTable`, the two job loops, header doc comment)
- Modify: `bench/tasks.json`, `bench/tasks-hard.json` (add `changesTests` where needed)
- Test: `tests/cc_tiers.test.mjs` (the three benchmark tests)

**Interfaces:**
- Produces:
  - `changesTests?: string[]` per task — paths like `test/payroll.test.mjs`: the original test files that fail, in their original form, against a correct solution. Hard suite: exactly the original files that fail against the reference patch (asserted by `npm test`). Easy suite: by hand (`rename` → `test/users.test.mjs`; check `pagination` and `mixed` the same way).
  - `passingTests(dir: string): Map<string, string>` — runs each `test/*.test.mjs` file on its own (`node --test <file>`, `NODE_TEST_CONTEXT` removed) and returns path → content for the files that pass. Called before each step.
  - `grade(dir, task, result, checks, before: Map<string,string>) → { f2p: boolean, p2p: boolean, ownTests: boolean, resolved: boolean, regressions: string[], output: string }` — f2p: hidden check alone; p2p: every file in `before` minus `task.changesTests`, temporarily written back in its before-form (restored/removed afterwards so the model's tree is untouched), run together; ownTests: the current `test/` files as the model left them; `resolved = f2p && p2p`; `regressions` = before-files that failed.
  - Rows gain `f2p`, `p2p`, `ownTests`, `resolved`, `regressions`, `freshTokens` (sum over `modelUsage` of input + cacheWrite + output). `pass` stays as an alias of `resolved` for old readers. `cost` stays in the raw JSON.
  - `metrics(rows) → { pass1: number, passK: number, k: number, resolved: number, runs: number, regressions: number, tokensPerResolved: number|null }` — pass@1 = mean over tasks of (resolved runs / runs); pass^k = share of tasks resolved in every run, k = runs per task (min across tasks); regressions = runs with f2p && !p2p.
  - `table(results)`: first table `| Configuration | pass@1 | pass^k | Resolved | Regressions | Tokens per resolved task | Δ tokens vs Opus only |` (percent with no decimals for rates, tokens as `123.4k`, Δ as `+12%`/`−8%`, `—` when the `opus` config is absent or nothing resolved); per-task table `✅/🟡/❌ resolved/k`; `kindTable` becomes pass@1 per kind plus escalations and routed-as-documented. No `$` anywhere in the tables. Rows without `resolved` use `pass`; rows without `freshTokens` count 0 tokens and the cell shows `—`.
  - Session mode: `before` is taken right before each step, on the tree the previous step left.

- [ ] **Step 1: Write the failing tests.**
  - `pass-to-pass uses the before-form of each test file` — in a temp copy of `bench/fixture`: take `passingTests`, then (a) rewrite `test/users.test.mjs` so it would pass trivially and break `src/users.js` → `p2p === false`, `regressions` includes `test/users.test.mjs`, and afterwards the model's rewritten file is back on disk; (b) a task with `changesTests: ['test/users.test.mjs']` and the same break → `p2p === true`; (c) delete `test/api.test.mjs` and break `src/api.js` → regression counted, file absent afterwards.
  - `quality metrics: pass@1, pass^k, regressions, tokens` — rows for config `opus` and `cc-tiers`, 2 tasks × 2 reps, with chosen `resolved/f2p/p2p/freshTokens` → exact `metrics()` values and table cells, e.g. `| Opus only | 75% | 50% | 3/4 | 0 | 30.0k | — |` and a `+50%` Δ cell for cc-tiers (pick numbers that give these).
  - `old result rows render with pass as resolved` — rows with only `pass`, `cost`, `models` → `table()` does not throw, shows `1/2` resolved and `—` tokens.
  - Update the existing `table(rows)` assertions in `the benchmark fixture is green…` and the `kindTable` assertions in `the benchmark counts escalations…` to the new columns (no `$`).
  - In the hard-suite test, after applying each reference patch: run every original test file (before-form) alone; the set that fails must deep-equal `task.changesTests ?? []`.
- [ ] **Step 2: Run `npm test`** — Expected: FAIL.
- [ ] **Step 3: Implement** `passingTests`, `grade`, `metrics`, the new rows and tables in `bench/run.mjs`; replace `check()` with `grade()` in both job loops; update the header comment (what is recorded; no cost talk beyond "raw JSON keeps the cost Claude Code reports"). Fill `changesTests` in both task files.
- [ ] **Step 4: Run `npm test`** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Benchmark mede qualidade: FAIL_TO_PASS, PASS_TO_PASS, pass@1, pass^k e tokens por tarefa resolvida"`

### Task 5: Calculator showcase suite

**Files:**
- Create: `bench/tasks-calc.json`, `bench/fixture-calc/package.json` (`{"name":"calc-fixture","private":true,"type":"module","scripts":{"test":"node --test test/"}}`), `bench/fixture-calc/README.md` (one line), `bench/fixture-calc/test/smoke.test.mjs` (one trivial passing test so PASS_TO_PASS is not empty), `bench/checks-calc/calc.test.mjs`, `bench/solutions-calc/calc.js`
- Test: `tests/cc_tiers.test.mjs`

**Interfaces:**
- Consumes: Task 4's runner (the `tasks-calc.json` ↔ `fixture-calc/` ↔ `checks-calc/` naming already works).
- Produces: task `{ "id": "calc", "kind": "normal", "prompt": <the spec's prompt verbatim> }`.

- [ ] **Step 1: Write the test** `the calculator check fails on the empty fixture and passes with the reference` — copy fixture to temp, copy check to `.bench-check/calc.test.mjs`: fails; copy `solutions-calc/calc.js` to `src/calc.js`: check + `test/smoke.test.mjs` pass.
- [ ] **Step 2: Write `bench/checks-calc/calc.test.mjs`** importing `../src/calc.js` dynamically (so a missing file fails the test, not the loader) and asserting: `8-3-2`→3, `8/4/2`→1, `2+3*4`→14, `(2+3)*4`→20, `((1+2)*(3+4))`→21, `-(2+3)`→-5, `2*-3`→-6, `--2`→2, `-2*-2`→4, `.5+1`→1.5, `1.25*4`→5, `'  7 *  ( 1 + 1 ) '`→14; `1/0` and `1/(2-2)` throw `RangeError`; `''`, `'2+'`, `'(1'`, `'1)'`, `'1 2'`, `'abc'`, `'1..2'`, `'2*/3'` throw `SyntaxError`; `src/calc.js` source does not match `/\beval\s*\(|\bFunction\s*\(/`.
- [ ] **Step 3: Write `bench/solutions-calc/calc.js`** — a small recursive-descent parser (`expr := term (('+'|'-') term)*`, `term := unary (('*'|'/') unary)*`, `unary := '-' unary | primary`, `primary := number | '(' expr ')'`), throwing the errors above.
- [ ] **Step 4: Run `npm test`** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Suíte vitrine da calculadora no benchmark"`

### Task 6: README, changelog, version

**Files:**
- Modify: `README.md`, `README.pt-BR.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json` (`version`, `description`), `package.json` (`version`, `description`), `tests/cc_tiers.test.mjs` (changelog asserts `0.6.0`)

**Interfaces:**
- Consumes: everything above (option names, defaults, header lines, metric names, commands).

- [ ] **Step 1: Test** — add `assert.ok(changelog.includes('0.6.0'))`; assert `plugin.json` and `package.json` versions are `0.6.0`; run `npm test` → FAIL.
- [ ] **Step 2: Rewrite the README (EN), then mirror in pt-BR.**
  - Tagline `Opus plans and reviews. Sonnet builds. Research comes first.` and an opening paragraph about quality (separate plan / research / implementation / independent review contexts; escalation carries the failure notes), aimed at Pro/Max.
  - New section "🔬 Research first" (what the researcher checks, the brief, the gate lines, `none - <reason>`, `CC_TIERS_COVERS`, `research: off`).
  - "Who does what" table gains the researcher row; light mode = "when the window is tight"; budget = "protect your Pro/Max window".
  - "Spend and cost": optional (`show_cost: on`), not the headline.
  - Configure table: new defaults and the `research` row; Example section rewritten for `risky` + research + Sonnet at `high`.
  - Replace the Benchmark section: what each metric is and where it comes from (pass@k — HumanEval, Chen et al. 2021; FAIL_TO_PASS/PASS_TO_PASS — SWE-bench; pass^k — τ-bench), the three suites, how to run (`npm run bench -- --tasks-file bench/tasks-calc.json --repeat 3`, the hard suite command), the warning that a Pro/Max login spends the window, results table marked **not measured yet**, the Sonnet calibration kept and marked as graded with the old pass criterion. Remove the dollar table and "Light mode is the setting that saves".
  - Layout table: `agents/*.md` includes the researcher; `bench/` mentions the calculator suite.
- [ ] **Step 3: CHANGELOG `## 0.6.0 - 2026-10-19`** with Added (researcher, gate, `research` option, quality metrics, calculator suite) and Changed (defaults `risky`, `show_cost: off`, Sonnet ladder `high, xhigh` — behavior change on update; README positioning; benchmark tables no longer show dollars). Bump versions and descriptions.
- [ ] **Step 4: Run `npm test`** → PASS; `claude plugin validate --strict .` → passes.
- [ ] **Step 5: Commit** `git commit -m "README e changelog da 0.6.0: qualidade primeiro"`

### Task 7: Smoke run (approved by the user)

- [ ] **Step 1:** `node bench/run.mjs --tasks-file bench/tasks-calc.json --repeat 1 --parallel 4 --out <scratchpad>/smoke-calc.json` (all four configs, one run each). Expected: four rows, each with `f2p`/`p2p`/`resolved`/`freshTokens` filled, the quality table printed, and for `cc-tiers` a route showing a `cc-tiers:researcher` call or a `CC_TIERS_RESEARCH: none` decision.
- [ ] **Step 2:** If a row has `error` or zero tokens, read its `checkOutput`/`error`, fix the runner, rerun only that config. The smoke file stays in the scratchpad (one run is not a measurement); report its table to the user as a smoke check, not as results.
