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
