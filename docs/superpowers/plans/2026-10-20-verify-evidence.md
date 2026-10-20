# cc-tiers 0.7 — verification gate, evidence-based review, ablation: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A writer's `pass` counts only after the hook itself runs the verification commands the writer declared; a reviewer's rejection counts only with a blocking finding backed by evidence; the benchmark measures this against Opus only.

**Architecture:** A new focused module `hooks/verify.mjs` holds pure parsing (`CC_TIERS_VERIFY`, `CC_TIERS_FINDING_*`), the allow list, and the command runner (injectable for tests). Commands never run under the session lock (`LOCK_STALE_MS` 10 s): entrypoints call `prepareReport` before `withSession`, attach the result to the event, and `applyEvent` stays pure. Ceiling and dispatcher trailers found by the transcript scan are parked in `state.awaiting` and verified in the Stop hook, outside the lock.

**Tech Stack:** Node 18+ ESM, `node:test`, `node:child_process.spawnSync`, no dependencies; Claude Code plugin 2.1.295+.

**Spec:** `docs/superpowers/specs/2026-10-20-verify-evidence-design.md`

## Global Constraints

- Report lines: `CC_TIERS_VERIFY: <command>` (one per line, several allowed) or `CC_TIERS_VERIFY: none - <reason>`; findings between lines that hold only `CC_TIERS_FINDING_BEGIN` / `CC_TIERS_FINDING_END`, fields `category`, `severity`, `evidence`, `command`, `expected`, `observed`, `where`, `criterion`.
- Values: `category` ∈ `correctness, regression, security, state, scope`; `severity` ∈ `blocking, note`; `evidence` ∈ `command, trace, coverage`.
- Command line: refused if it contains any of `; | & > < \` $( ) \n` except one leading `cd <dir> && `; leading `KEY=value` tokens become env; `<dir>` relative, resolved inside the project dir. Allow list compared on the remaining argv, whole words.
- Options (all `/config`, env `CLAUDE_PLUGIN_OPTION_<UPPER>`): `verify` on/off default `on`; `verify_allow` string, default `npm test, npm run test, node --test, npx tsc, npx eslint, npx vitest, npx jest, npx playwright test, vendor/bin/phpunit, ./vendor/bin/phpunit, vendor/bin/phpstan, ./vendor/bin/phpstan, vendor/bin/phpcs, ./vendor/bin/phpcs, pytest, python -m pytest, go test, cargo test` (no `docker exec`); `verify_timeout` number default 300 min 10 max 600; `verify_budget` number default 600 min 30 max 600; `review_evidence` on/off default `on`. No new project-file key: the user forbids `.claude/` in their projects.
- `hooks.json` timeout 660 for PostToolUse, PostToolUseFailure, SubagentStop, and Stop; the others stay 15.
- Hook messages, verbatim prefixes (the benchmark greps them): `cc-tiers gate: <task> verified: <cmds>` · `cc-tiers gate: <task> failed: <cmd> (exit <code>)` · `cc-tiers gate: <task> timed out: <cmd> after <n> s` · `cc-tiers gate: <task> flaky: <cmd>` · `cc-tiers gate: <task> not validated: <reason>` · `cc-tiers gate: <task> reported pass without CC_TIERS_VERIFY` · `cc-tiers review: <task> discarded <n> finding(s): the evidence command passed` · `cc-tiers review: <task> rejected without evidence; <n> finding(s) became notes`.
- Out-of-list reason text: `outside verify_allow: <cmd> (add its prefix in /config)`; budget reason: `budget exhausted: <cmd>`.
- Plugin text in English; README EN/pt-BR in sync; CHANGELOG `## 0.7.0 - 2026-10-20`; version 0.7.0 in `plugin.json` and `package.json`.
- Work on branch `verificacao-evidencia` from `main`. One commit per task, Portuguese subject, blank line, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push.
- Existing tests that report `pass` from a writer without `CC_TIERS_VERIFY`: set `verify: 'off'` (routing) or `CLAUDE_PLUGIN_OPTION_VERIFY=off` (env) in them, as done for research and specify. Same for `review_evidence` where a reviewer `fail` has no finding.

## Review Focus

1. A command with a shell metacharacter hidden after an allowed prefix (`npm test; rm -rf x`, `npm test $(id)`) must be refused, not run → Task 1 test.
2. `cd ../.. && npm test` or `cd /etc && …` must be refused (dir outside the project) → Task 1 test.
3. A reviewer `fail` whose only blocking finding is `coverage` with a criterion not in that task's spec block (or task with `CC_TIERS_SPEC: none`) must not count → Task 2 test.
4. A gate that fails must not leave the lock held or the counter half-written: commands run before `withSession` → Task 4 test (state saved once, `prepareReport` called without the lock file present).
5. A `CC_TIERS_VERIFY` line quoted inside the pasted research or spec block of the *prompt* must not count as the writer's declaration: only the report text is parsed → Task 1 test.

---

### Task 1: `hooks/verify.mjs` — declarations, allow list, runner, gate

**Files:** Create `hooks/verify.mjs`, `tests/verify.test.mjs`.

**Interfaces:**
- Produces:
  - `parseVerify(text: string): Array<{ raw, kind: 'command'|'none'|'invalid', argv?: string[], env?: Record<string,string>, cwd?: string, reason?: string }>` — every `CC_TIERS_VERIFY:` line of the report text, in order. `cwd` relative as written; `invalid` carries the refusal reason.
  - `parseAllow(value: string): string[][]` — comma list → token arrays.
  - `isAllowed(argv: string[], allow: string[][]): boolean` — some entry is a whole-token prefix of argv.
  - `runCommand(cmd, { projectDir, timeoutS }): { code: number|null, timedOut: boolean, tail: string, ms: number }` — `spawnSync` without shell (on `win32`, `shell: true`, safe because metacharacters were refused), cwd = `path.resolve(projectDir, cmd.cwd || '.')`, env merged over `process.env`, `tail` = last 40 lines of stdout+stderr.
  - `runGate(text, { projectDir, allow, timeoutS, budgetS, run = runCommand }): GateResult` where `GateResult = { status: 'pass'|'fail'|'missing'|'unverified', verified: string[], flaky: string[], unverified: Array<{ raw, reason }>, failure: { raw, code, timedOut, tail } | null }`. Rules: no lines → `missing`; `invalid` line or a cwd outside projectDir → `unverified` item (not a failure); `none - r` → unverified with reason `r`; not allowed → unverified with the out-of-list reason; exit ≠ 0 → run once more, pass on 2nd → `flaky` + `verified`, fail on 2nd → `failure`, stop running; timeout at the full `timeoutS` → failure with `timedOut`; budget: per-command timeout = min(timeoutS, remaining), remaining ≤ 0 or timeout cut short by the budget → unverified `budget exhausted`. Final status: failure → `fail`; else ≥1 verified → `pass`; else `unverified`.
  - `gateMessage(task: string, gate: GateResult): string` — the gate lines from Global Constraints, one per fact.

- [ ] **Step 1: Failing tests** in `tests/verify.test.mjs` with a fake `run` that returns scripted results: `parses commands, none and env/cd forms`; `refuses metacharacters and dirs outside the project` (Review Focus 1, 2); `allow list matches whole words` (`npm test -- x` yes, `npm testx` no, `docker exec x` no by default); `pass without lines is missing`; `fails twice → fail with tail`; `fails then passes → flaky and pass`; `out of list → unverified, not fail`; `timeout → fail`; `budget exhausted → unverified`; `only the report text counts` (Review Focus 5: a prompt-side line is never passed in — assert `runGate` reads only its `text` arg, and `prepareReport` in Task 4 passes `event.text`); `runCommand runs a real node command` (`node -e "process.exit(3)"` → code 3; `node -e "setTimeout(()=>{},5000)"` with timeoutS 1 → timedOut).
- [ ] **Step 2: `npm test`** — new tests FAIL.
- [ ] **Step 3: Implement** the interfaces.
- [ ] **Step 4: `npm test`** — PASS.
- [ ] **Step 5: Commit** `Gate de verificação: parse do CC_TIERS_VERIFY, lista de prefixos e execução`

### Task 2: Findings — parse and judge

**Files:** Modify `hooks/verify.mjs`, `tests/verify.test.mjs`.

**Interfaces:**
- Consumes: `parseVerify`'s command-line parser (reuse it for `command:`), `isAllowed`, `runCommand`.
- Produces:
  - `parseFindings(text): Array<Finding>`; `Finding = { category, severity, evidence, command?, expected?, observed?, where?, criterion?, valid: boolean, problem?: string }`. Valid when: known category/severity/evidence; `command` → parsable command + expected + observed + where; `trace` → expected + observed + where; `coverage` → criterion + where.
  - `judgeFindings(findings, { specText: string, allow, projectDir, timeoutS, budgetS, run = runCommand }): { blocking: Finding[], discarded: Finding[], notes: Finding[], invalid: Finding[] }`. Blocking + `command` + allowed → run once: exit 0 → `discarded`, else `blocking`; not allowed → treated as `trace` (blocking). `coverage` → blocking only if `fold(criterion)` occurs in `fold(specText)` (accent/case-insensitive, whitespace collapsed); `specText` empty → invalid. `severity: note` → `notes`.
  - `reviewMessage(task, judged): string` — the two review lines from Global Constraints when they apply, plus a `Notes:` list of note findings (category + where), at most 8.
  - `findingsNote(judged): string` — the failure note for the writer: blocking findings only, each `category @ where: expected / observed` (or the criterion for coverage).

- [ ] **Step 1: Failing tests**: `parses a full finding of each evidence kind`; `incomplete or unknown values are invalid`; `command evidence that passes is discarded`; `command evidence that fails blocks`; `out-of-list command evidence counts as trace`; `coverage needs the criterion in the spec block` (Review Focus 3, incl. empty spec); `notes never block`.
- [ ] **Step 2: `npm test`** — FAIL.
- [ ] **Step 3: Implement.** `fold` is the same accent folding as `cc_tiers.mjs` `fold`; import it from there only if that creates no cycle, else move `fold` into `verify.mjs` and re-export it from `cc_tiers.mjs`.
- [ ] **Step 4: `npm test`** — PASS.
- [ ] **Step 5: Commit** `Revisão com evidência: parse e julgamento dos achados`

### Task 3: Options

**Files:** Modify `.claude-plugin/plugin.json`, `config/routing.default.json`, `hooks/cc_tiers.mjs` (`userFromEnv`, `mergeRouting`, `formatSessionContext` + a `verifyLine(routing)` after `specifyLine`), `tests/cc_tiers.test.mjs`.

**Interfaces:**
- Produces on `routing`: `verify: boolean`, `verifyAllow: string[][]`, `verifyTimeout: number`, `verifyBudget: number`, `reviewEvidence: boolean`. Bad numbers clamp/fall back like `max_attempts`. Session line: `Verify: on (gate runs CC_TIERS_VERIFY commands; review needs evidence)` / `Verify: off`, and `Review evidence: on|off`.

- [ ] **Step 1: Failing tests**: `manifest declares the verify knobs` (the 5 options with Global Constraints defaults/bounds); `verify options come from /config env` (off, a custom allow list, timeout 700 → 600, budget 5 → 30); `session context states verify and review evidence`.
- [ ] **Step 2: `npm test`** — FAIL. **Step 3: Implement.** **Step 4: `npm test` + `claude plugin validate --strict .`** — PASS.
- [ ] **Step 5: Commit** `Opções do gate e da revisão com evidência no /config`

### Task 4: Gate in delegations (P0 wiring)

**Files:** Modify `hooks/cc_tiers.mjs` (`applyEvent`, `logReport`, new `prepareReport`), `hooks/after_agent.mjs`, `hooks/subagent_stop.mjs`, `hooks/hooks.json`, `tests/cc_tiers.test.mjs`.

**Interfaces:**
- Consumes: `runGate`, `gateMessage` (Task 1); routing fields (Task 3).
- Produces:
  - `prepareReport(ctx, event): event` — returns a copy; for a writer role (`WRITER_ROLES` or `SESSION_ROLES`) whose report text has `CC_TIERS_STATUS: pass` and `ctx.routing.verify`, adds `event.gate = runGate(event.text, …)` with `projectDir = ctx.projectDir || payload cwd`. Reviewer/checker part comes in Task 6. Never called inside `withSession`.
  - `applyEvent`: when `routing.verify` and a writer reports `pass`: `event.gate` absent or `status: 'missing'` → treated as `fail` with reason `reported pass without CC_TIERS_VERIFY`; `fail` → `fail` with reason `<cmd> exit <code>: <last tail line>` and the full tail appended to the failure notes; `unverified`/`pass` → stays `pass`. `gateMessage` is prepended to the message in every case. `meta.gate = gate`.
  - `logReport` stores `entry.verify = { verified, flaky, unverified }` from `meta.gate` (latest attempt).
  - On a gate failure, when `state.tasks` holds other open slugs, the message adds `Other open tasks in this session (<slugs>) may share the working tree; one of them may have caused this failure.` (spec, Limitations).
  - `after_agent.mjs`: `prepareReport` before `withSession`. `subagent_stop.mjs`: first `withSession` reads `state.background[agentId]` (role, prompt) without deleting; then `prepareReport` outside; then the existing `withSession` that deletes and processes.
  - `hooks.json`: timeouts per Global Constraints.

- [ ] **Step 1: Failing tests**: `writer pass without VERIFY counts a failure`; `failed gate counts a failure with the tail in the notes and escalates after max_attempts`; `unverified gate keeps the pass and says not validated`; `verify off keeps 0.6 behavior`; `prepareReport runs outside the lock` (Review Focus 4: spawn `after_agent.mjs` with a payload whose VERIFY is `node -e "require('fs').writeFileSync(process.env.OUT, String(require('fs').existsSync(process.env.LOCK)))"`-style probe — the probe writes whether the session lock file exists; assert `false`; add `node -e` to the test's `CLAUDE_PLUGIN_OPTION_VERIFY_ALLOW`); `hooks.json gives the gate 660 s`. Update existing pass-report tests per Global Constraints.
- [ ] **Step 2: `npm test`** — FAIL. **Step 3: Implement.** **Step 4: `npm test`** — PASS.
- [ ] **Step 5: Commit** `Gate de verificação nas delegações, fora da trava da sessão`

### Task 5: Gate for the Opus ceiling and the dispatcher

**Files:** Modify `hooks/cc_tiers.mjs` (`withSession` scan loop, new `takeAwaiting`), `hooks/stop.mjs`, `tests/cc_tiers.test.mjs`.

**Interfaces:**
- Produces:
  - In `withSession`: a scanned session-role report with `STATUS: pass` while `routing.verify` is pushed to `state.awaiting` (`{ id, role, text }`, capped at `MAX_PENDING`) instead of `processReport`; other scanned reports unchanged.
  - `takeAwaiting(state): Array<{ id, role, text }>` empties the list.
  - `stop.mjs` on `Stop` only: (1) `withSession` → `takeAwaiting` + `takePending`; (2) outside the lock, `prepareReport` each awaiting report; (3) `withSession` → `processReport` each prepared event and collect messages; output as today (block once, `systemMessage` when `stop_hook_active`). `UserPromptSubmit` path unchanged (it never runs commands).
- [ ] **Step 1: Failing tests**: `a ceiling pass waits for the Stop gate` (scan in a PreToolUse-like call leaves the task uncounted and `state.awaiting` with 1 item); `Stop verifies the ceiling and blocks once on failure` (spawn `stop.mjs` with a transcript holding an orchestrator trailer whose VERIFY exits 1 → output `decision: block` with `cc-tiers gate: … failed`); `a passing ceiling gate clears the counter`.
- [ ] **Step 2: `npm test`** — FAIL. **Step 3: Implement.** **Step 4: `npm test`** — PASS.
- [ ] **Step 5: Commit** `Gate do teto do Opus e do dispatcher no Stop`

### Task 6: Evidence-based review (P1 wiring)

**Files:** Modify `hooks/cc_tiers.mjs` (`prepareReport`, `applyEvent`/`applyReview`, new exported `specText(prompt)`), `tests/cc_tiers.test.mjs`.

**Interfaces:**
- Consumes: `parseFindings`, `judgeFindings`, `reviewMessage`, `findingsNote` (Task 2).
- Produces:
  - `specText(prompt): string` — the content of the first `CC_TIERS_SPEC_BEGIN/END` block, '' when absent.
  - `prepareReport`: for reviewer/checker with `STATUS: fail` and `routing.reviewEvidence`, adds `event.judged = judgeFindings(parseFindings(event.text), { specText: specText(event.prompt), … })`. For `pass` with note findings, `event.judged` too (notes only).
  - `applyEvent` for review roles when `routing.reviewEvidence`: `fail` with `judged.blocking.length === 0` → handled as a review `pass` (counter cleared) with `reviewMessage`; `fail` with blocking → failure whose reason is `findingsNote(judged)`; `reviewMessage` prepended in both. `meta.review = { blocking, discarded, notes, invalid }` counts. `review_evidence: off` → 0.6 behavior.
- [ ] **Step 1: Failing tests**: `review fail without evidence is approved with notes`; `review fail with a failing evidence command counts against the writer tier`; `discarded finding is reported`; `coverage finding counts only with the criterion in the spec block`; `checker follows the same rule`; `review_evidence off keeps 0.6 behavior`.
- [ ] **Step 2: `npm test`** — FAIL. **Step 3: Implement.** **Step 4: `npm test`** — PASS.
- [ ] **Step 5: Commit** `Revisão com evidência: rejeição só conta com achado bloqueante provado`

### Task 7: Agent prompts and the report table

**Files:** Modify `agents/implementer.md`, `agents/worker.md`, `agents/architect.md`, `agents/dispatcher.md`, `agents/orchestrator.md`, `skills/tiers/SKILL.md`, `agents/reviewer.md`, `agents/checker.md`, `hooks/report.mjs`, `tests/cc_tiers.test.mjs`.

- Writers (implementer, worker, architect, dispatcher's own task, orchestrator's ceiling trailer): run the focused tests of the touched area; declare each command as `CC_TIERS_VERIFY:` before `CC_TIERS_STATUS`, in the allowed format (one command per line, only the `cd <dir> &&` and `KEY=value` forms); `none - <reason>` only when no command can check the change; the hook re-runs them and a failure counts.
- Orchestrator/dispatcher/skill: the reviewer and checker prompt carries the diff, spec block, research block and the request — never the writer's report or explanation; the final answer repeats, per task, `verified` / `flaky` / `not validated` from the hook messages.
- Reviewer and checker: walk correctness, regression, security, state, scope; one `CC_TIERS_FINDING` block per finding (format from the spec, English values); describe the defect, never the fix; hardening the spec does not ask for, style, and other-issue work are `note`; `fail` only with at least one `blocking` finding with evidence; a missing test for a spec criterion is `coverage` with the criterion copied verbatim.
- `report.mjs`: a `Verify` column from `entry.verify` (`ok`, `flaky`, `not validated`, `—`).
- [ ] **Step 1: Failing tests**: `prompts declare verification and evidence` (needles: `CC_TIERS_VERIFY` in the 5 writer/session files and the skill; `CC_TIERS_FINDING_BEGIN`, `coverage`, `never the fix` or equivalent fixed phrase in reviewer/checker; `never the writer's report` in orchestrator/dispatcher/skill); `report shows the verify column`.
- [ ] **Step 2: `npm test`** — FAIL. **Step 3: Edit** keeping each file's voice. **Step 4: `npm test` + `claude plugin validate --strict .`** — PASS.
- [ ] **Step 5: Commit** `Prompts: declarar verificação e achados com evidência`

### Task 8: Benchmark metrics per layer

**Files:** Modify `bench/run.mjs`, `tests/cc_tiers.test.mjs`.

**Interfaces:**
- Produces: `qualityIn(lines, from = 0): { gateBlocked, flaky, notValidated, discarded, noEvidence }` — counts of the Global Constraints prefixes in hook output only (same `fromHook` filter as `escalationsIn`); `gateBlocked` counts `failed:`, `timed out:` and `reported pass without`. Each cc-tiers row gains `quality` and `reviewRounds` (number of `cc-tiers:reviewer` + `cc-tiers:checker` steps). `table` adds a section **Quality layers** (cc-tiers configs only): `| Configuration | Pass blocked by gate | Flaky | Not validated | Findings discarded | Rejections without evidence | Review rounds per task |`; `—` for configs without data.
- [ ] **Step 1: Failing tests**: `qualityIn counts only hook output`; `table shows the quality layers section`.
- [ ] **Step 2: `npm test`** — FAIL. **Step 3: Implement.** **Step 4: `npm test`** — PASS.
- [ ] **Step 5: Commit** `Benchmark: métricas por camada (gate e revisão)`

### Task 9: Docs and version

**Files:** Modify `README.md`, `README.pt-BR.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json`, `package.json`, `tests/cc_tiers.test.mjs` (version assertion).

- README EN + pt-BR, same structure: new section **Verify** (after Specify and ask): declaration, what the hook runs, allow list and why `docker exec` is off by default, budget/timeout, not validated, ceiling at Stop; new section **Evidence-based review** (findings format, what counts, coverage, notes); flowchart gains the gate; Configure table gains the 5 options; Limitations from the spec (parallel sessions, gate proves the command passes not that it covers the change, `trace` not checked, the allow list restricts command shape, not what the tests execute). Benchmark section: run command for this suite and a placeholder `Results pending` until Task 10.
- CHANGELOG `## 0.7.0 - 2026-10-20` with Added / Changed (a writer `pass` without `CC_TIERS_VERIFY` now counts a failure; a review `fail` without evidence no longer counts).
- [ ] **Step 1:** Update the version test to 0.7.0 → FAIL. **Step 2:** Edit. **Step 3: `npm test` + `claude plugin validate --strict .`** — PASS.
- [ ] **Step 4: Commit** `Docs e versão 0.7.0: gate de verificação e revisão com evidência`

### Task 10: Run the ablation (needs the user's go-ahead: it spends their usage window)

- [ ] **Step 1:** Ask the user. Without a yes, stop here and hand over the command.
- [ ] **Step 2:** `npm run bench -- --tasks-file bench/tasks-hard.json --tasks race,cancel,instances,traversal,date-filter,csv-escape,offboarding,recurring-pack --configs opus,cc-tiers --repeat 2 --out bench/results/verify-evidence.json` (cc-tiers at the Task 9 commit).
- [ ] **Step 3:** `npm run bench:table -- bench/results/verify-evidence.json`; paste the tables into both READMEs with an honest reading (ties included; tokens and wall time per resolved task stated).
- [ ] **Step 4: `npm test`** — PASS. **Commit** `Resultados medidos: gate e revisão com evidência na suíte difícil`
