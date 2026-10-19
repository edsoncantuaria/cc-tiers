"""Layout checks against the Claude Code plugin rules, plus the attempt counter."""

from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "hooks"))

import cc_tiers  # noqa: E402

MODELS = {"haiku", "sonnet", "opus"}
RESERVED_PREFIXES = ("claude-", "anthropic-", "anthropics-", "cc-plugin-")


def _frontmatter(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise AssertionError(f"{path} must open with frontmatter")
    end = text.find("\n---\n", 4)
    if end < 0:
        raise AssertionError(f"{path} frontmatter does not close")
    block = text[4:end]
    fields: dict[str, str] = {}
    for line in block.splitlines():
        if not line.strip() or line.startswith(" "):
            continue
        key, _, value = line.partition(":")
        fields[key.strip()] = value.strip().strip('"')
    return fields


def _report(role: str, tier: str, status: str, review: str = "", reason: str = "pytest failed") -> str:
    lines = [
        "CC_TIERS_TASK: users-pagination",
        f"CC_TIERS_TIER: {tier}",
        f"CC_TIERS_ROLE: {role}",
        f"CC_TIERS_STATUS: {status}",
    ]
    if review:
        lines.append(f"CC_TIERS_REVIEW: {review}")
    lines.append(f"CC_TIERS_REASON: {reason}")
    return "\n".join(lines)


def _event(tool_use_id: str, role: str, text: str, prompt: str = "", failure: bool = False) -> dict:
    scoped = f"cc-tiers:{role}"
    base = {
        "session_id": "sess-1",
        "tool_name": "Agent",
        "tool_use_id": tool_use_id,
        "tool_input": {"subagent_type": scoped, "prompt": prompt},
    }
    if failure:
        base["hook_event_name"] = "PostToolUseFailure"
        base["error"] = "agent crashed"
        return base
    base["hook_event_name"] = "PostToolUse"
    base["tool_response"] = {"status": "completed", "content": [{"type": "text", "text": text}]}
    return base


class LayoutTest(unittest.TestCase):
    def test_required_files(self) -> None:
        for relative in (
            ".claude-plugin/plugin.json",
            ".claude-plugin/marketplace.json",
            "settings.json",
            "LICENSE",
            "README.md",
            "README.pt-BR.md",
            "hooks/hooks.json",
            "hooks/cc_tiers.py",
            "skills/tiers/SKILL.md",
            "commands/route.md",
            "commands/escalate.md",
            "config/routing.default.json",
            "agents/orchestrator.md",
            "agents/worker.md",
            "agents/implementer.md",
            "agents/reviewer.md",
        ):
            self.assertTrue((ROOT / relative).is_file(), relative)

    def test_manifest(self) -> None:
        manifest = json.loads((ROOT / ".claude-plugin/plugin.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["name"], "cc-tiers")
        self.assertNotRegex(manifest["name"], r"[\s@:./\\]")
        self.assertFalse(manifest["name"].startswith(RESERVED_PREFIXES))
        self.assertEqual(manifest["license"], "MIT")
        self.assertTrue(manifest["homepage"].startswith("https://"))
        for key, expected in (
            ("max_attempts", "number"),
            ("review_policy", "string"),
            ("trivial_extra", "string"),
            ("risky_extra", "string"),
        ):
            option = manifest["userConfig"][key]
            self.assertEqual(option["type"], expected)
            self.assertTrue(option["title"])
            self.assertTrue(option["description"])
        attempts = manifest["userConfig"]["max_attempts"]
        self.assertEqual(attempts["default"], 2)
        self.assertEqual(attempts["min"], 1)
        self.assertEqual(attempts["max"], 5)
        review = manifest["userConfig"]["review_policy"]
        self.assertEqual(review["options"], ["risky", "always", "never"])
        self.assertIn(review["default"], review["options"])
        self.assertNotIn("CLAUDE.md", {path.name for path in ROOT.iterdir()})

    def test_marketplace(self) -> None:
        market = json.loads((ROOT / ".claude-plugin/marketplace.json").read_text(encoding="utf-8"))
        self.assertEqual(market["name"], "cc-tiers")
        self.assertTrue(market["owner"]["name"])
        entry = market["plugins"][0]
        self.assertEqual(entry["name"], "cc-tiers")
        self.assertEqual(entry["source"], "./")

    def test_agents_pin_family_aliases(self) -> None:
        expected = {
            "orchestrator": "opus",
            "reviewer": "opus",
            "implementer": "sonnet",
            "worker": "haiku",
        }
        for name, model in expected.items():
            fields = _frontmatter(ROOT / "agents" / f"{name}.md")
            self.assertEqual(fields["name"], name)
            self.assertTrue(fields["description"])
            self.assertEqual(fields["model"], model)
            self.assertIn(fields["model"], MODELS)
            self.assertNotIn(":", fields["name"])

    def test_skill_and_commands(self) -> None:
        skill = _frontmatter(ROOT / "skills/tiers/SKILL.md")
        self.assertEqual(skill["name"], "tiers")
        self.assertIn("Haiku", skill["description"])
        body = (ROOT / "skills/tiers/SKILL.md").read_text(encoding="utf-8")
        self.assertIn("${user_config.max_attempts}", body)
        for command in ("route.md", "escalate.md"):
            fields = _frontmatter(ROOT / "commands" / command)
            self.assertNotIn("name", fields)
            self.assertTrue(fields["description"])

    def test_hooks_shape(self) -> None:
        hooks = json.loads((ROOT / "hooks/hooks.json").read_text(encoding="utf-8"))
        events = hooks["hooks"]
        self.assertIn("SessionStart", events)
        self.assertEqual(events["PostToolUse"][0]["matcher"], "Agent")
        self.assertEqual(events["PostToolUseFailure"][0]["matcher"], "Agent")
        for event in events.values():
            command = event[0]["hooks"][0]["command"]
            self.assertIn("${CLAUDE_PLUGIN_ROOT}", command)
            self.assertIn('"', command)
        for script in ("session-start.sh", "after-agent.sh"):
            path = ROOT / "hooks" / script
            mode = path.stat().st_mode
            self.assertTrue(mode & stat.S_IXUSR, f"{script} is not executable")

    def test_settings_selects_orchestrator(self) -> None:
        settings = json.loads((ROOT / "settings.json").read_text(encoding="utf-8"))
        self.assertEqual(settings["agent"], "orchestrator")
        self.assertEqual(set(settings), {"agent"})

    def test_readmes_share_the_example(self) -> None:
        for name in ("README.md", "README.pt-BR.md"):
            text = (ROOT / name).read_text(encoding="utf-8")
            self.assertIn("/plugin install cc-tiers --marketplace edsoncantuaria/cc-tiers", text)
            self.assertIn("users-pagination", text)
            self.assertIn("max_attempts", text)
            self.assertIn("fetchUser", text)
        license_text = (ROOT / "LICENSE").read_text(encoding="utf-8")
        self.assertIn("MIT License", license_text)
        self.assertIn("Copyright (c) 2026 Edson Cantuária", license_text)


class RoutingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.defaults = cc_tiers.load_json(ROOT / "config" / "routing.default.json")

    def test_user_config_wins_for_attempts_and_policy(self) -> None:
        routing = cc_tiers.merge_routing(
            self.defaults,
            {"maxAttempts": 5, "reviewPolicy": "never", "trivialExtra": ["changelog edits"]},
            {"max_attempts": 3, "review_policy": "always", "trivial_extra": "license year bumps"},
        )
        self.assertEqual(routing["maxAttempts"], 3)
        self.assertEqual(routing["reviewPolicy"], "always")
        self.assertIn("changelog edits", routing["tiers"]["haiku"]["when"])
        self.assertIn("license year bumps", routing["tiers"]["haiku"]["when"])
        self.assertTrue(any("maxAttempts" in note for note in routing["notes"]))

    def test_bad_attempts_fall_back(self) -> None:
        routing = cc_tiers.merge_routing(self.defaults, None, {"max_attempts": "nine", "review_policy": "loud"})
        self.assertEqual(routing["maxAttempts"], 2)
        self.assertEqual(routing["reviewPolicy"], "risky")

    def test_project_list_replaces_only_that_list(self) -> None:
        routing = cc_tiers.merge_routing(
            self.defaults,
            {"tiers": {"haiku": {"when": ["changelog edits"]}, "opus": {"reviewWhen": "nope"}}},
        )
        self.assertEqual(routing["tiers"]["haiku"]["when"], ["changelog edits"])
        self.assertIn("public API", " ".join(routing["tiers"]["opus"]["reviewWhen"]))
        self.assertTrue(any("reviewWhen" in note for note in routing["notes"]))

    def test_session_context_states_the_limit(self) -> None:
        routing = cc_tiers.merge_routing(self.defaults, None, {"max_attempts": 2, "review_policy": "risky"})
        text = cc_tiers.format_session_context(routing, "not present")
        self.assertIn("Max attempts per tier: 2.", text)
        self.assertIn("cc-tiers:worker", text)
        self.assertIn("not present", text)


class CounterTest(unittest.TestCase):
    def setUp(self) -> None:
        self.routing = cc_tiers.merge_routing(
            cc_tiers.load_json(ROOT / "config" / "routing.default.json"),
            None,
            {"max_attempts": 2, "review_policy": "risky"},
        )
        self.state = cc_tiers.empty_state("sess-1")

    def _apply(self, tool_use_id: str, role: str, text: str, prompt: str = "") -> str:
        event = cc_tiers.normalize_event(_event(tool_use_id, role, text, prompt))
        self.assertIsNotNone(event)
        self.state, message = cc_tiers.apply_event(self.state, event, self.routing)
        return message

    def test_two_sonnet_failures_escalate_with_notes(self) -> None:
        first = self._apply("t1", "implementer", _report("implementer", "sonnet", "fail", reason="cursor off by one"))
        self.assertIn("Retry on sonnet", first)
        self.assertEqual(self.state["tasks"]["users-pagination"]["failures"], ["sonnet/implementer: cursor off by one"])
        second = self._apply("t2", "implementer", _report("implementer", "sonnet", "fail", reason="cursor still wrong"))
        self.assertIn("The next tier is opus", second)
        self.assertIn("cursor off by one", second)
        self.assertIn("cursor still wrong", second)
        task = self.state["tasks"]["users-pagination"]
        self.assertEqual(task["tier"], "opus")
        self.assertEqual(task["failures"], [])
        self.assertEqual(len(task["carried"]), 2)

    def test_review_rejection_counts_against_the_writer(self) -> None:
        self._apply("t1", "implementer", _report("implementer", "sonnet", "fail", reason="tests failed"))
        passed = self._apply("t2", "implementer", _report("implementer", "sonnet", "pass", review="pending"))
        self.assertIn("passed on sonnet", passed)
        rejected = self._apply(
            "t3",
            "reviewer",
            _report("reviewer", "sonnet", "fail", reason="cursor is not validated"),
        )
        self.assertIn("The next tier is opus", rejected)
        self.assertIn("tests failed", rejected)
        self.assertIn("reviewer: cursor is not validated", rejected)

    def test_review_pass_clears_the_task(self) -> None:
        self._apply("t1", "implementer", _report("implementer", "sonnet", "pass", review="pending"))
        message = self._apply("t2", "reviewer", _report("reviewer", "sonnet", "pass", reason="checked the cursor"))
        self.assertIn("passed Opus review", message)
        self.assertNotIn("users-pagination", self.state["tasks"])

    def test_skip_review_clears(self) -> None:
        message = self._apply("t1", "worker", _report("worker", "haiku", "pass", review="skip", reason="renamed"))
        self.assertIn("review was skipped", message)
        self.assertNotIn("users-pagination", self.state["tasks"])

    def test_opus_ceiling_stops(self) -> None:
        state = cc_tiers.empty_state("sess-1")
        for index, reason in enumerate(("first", "second"), start=1):
            event = cc_tiers.normalize_event(
                _event(f"o{index}", "implementer", _report("implementer", "sonnet", "fail", reason=reason))
            )
            state, message = cc_tiers.apply_event(state, event, self.routing)
        self.assertIn("next tier is opus", message)
        self.assertEqual(state["tasks"]["users-pagination"]["tier"], "opus")

        # The orchestrator implements the Opus ceiling itself. A reviewer rejection
        # of that diff is what the hook can see, and the trailer names the tier.
        state["tasks"]["users-pagination"]["failures"] = []
        event = cc_tiers.normalize_event(
            _event("r1", "reviewer", _report("reviewer", "opus", "fail", reason="still wrong"))
        )
        state, first = cc_tiers.apply_event(state, event, self.routing)
        self.assertIn("Retry on opus", first)
        event = cc_tiers.normalize_event(
            _event("r2", "reviewer", _report("reviewer", "opus", "fail", reason="still wrong again"))
        )
        state, second = cc_tiers.apply_event(state, event, self.routing)
        self.assertIn("Opus is the last tier", second)

    def test_duplicate_tool_use_is_ignored(self) -> None:
        text = _report("implementer", "sonnet", "fail", reason="once")
        self._apply("same", "implementer", text)
        message = self._apply("same", "implementer", text)
        self.assertEqual(message, "")
        self.assertEqual(len(self.state["tasks"]["users-pagination"]["failures"]), 1)

    def test_subagent_error_counts_from_the_prompt_header(self) -> None:
        prompt = "CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: haiku\nCC_TIERS_ROLE: worker\nRename it."
        raw = _event("e1", "worker", "", prompt, failure=True)
        event = cc_tiers.normalize_event(raw)
        self.state, message = cc_tiers.apply_event(self.state, event, self.routing)
        self.assertIn("Retry on haiku", message)
        self.assertIn("agent crashed", message)

    def test_interrupt_does_not_count(self) -> None:
        raw = _event("e1", "worker", "", failure=True)
        raw["is_interrupt"] = True
        self.assertIsNone(cc_tiers.normalize_event(raw))

    def test_background_launch_does_not_increment(self) -> None:
        raw = _event("b1", "worker", "CC_TIERS_STATUS: fail")
        raw["tool_response"] = {"status": "async_launched"}
        event = cc_tiers.normalize_event(raw)
        self.assertEqual(event["kind"], "background")
        self.state, message = cc_tiers.apply_event(self.state, event, self.routing)
        self.assertIn("background", message)
        self.assertEqual(self.state["tasks"], {})


class HookScriptTest(unittest.TestCase):
    def test_session_start_emits_context(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "project"
            (project / ".claude").mkdir(parents=True)
            (project / ".claude" / "cc-tiers.json").write_text(
                json.dumps({"trivialExtra": ["changelog edits"]}),
                encoding="utf-8",
            )
            data = Path(tmp) / "data"
            env = os.environ.copy()
            env.update(
                {
                    "CLAUDE_PLUGIN_ROOT": str(ROOT),
                    "CLAUDE_PROJECT_DIR": str(project),
                    "CLAUDE_PLUGIN_DATA": str(data),
                    "CLAUDE_PLUGIN_OPTION_MAX_ATTEMPTS": "2",
                    "CLAUDE_PLUGIN_OPTION_REVIEW_POLICY": "risky",
                    "CLAUDE_PLUGIN_OPTION_TRIVIAL_EXTRA": "license year bumps",
                    "CLAUDE_PLUGIN_OPTION_RISKY_EXTRA": "billing",
                }
            )
            proc = subprocess.run(
                [sys.executable, str(ROOT / "hooks" / "session_start.py")],
                input=json.dumps({"session_id": "abc", "hook_event_name": "SessionStart"}).encode(),
                capture_output=True,
                env=env,
                check=False,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr.decode())
            payload = json.loads(proc.stdout)
            text = payload["hookSpecificOutput"]["additionalContext"]
            self.assertEqual(payload["hookSpecificOutput"]["hookEventName"], "SessionStart")
            self.assertIn("Max attempts per tier: 2.", text)
            self.assertIn("changelog edits", text)
            self.assertIn("license year bumps", text)
            self.assertIn("billing", text)
            self.assertTrue((data / "session-abc.json").is_file())

    def test_after_agent_script_escalates_on_the_second_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env = os.environ.copy()
            env.update(
                {
                    "CLAUDE_PLUGIN_ROOT": str(ROOT),
                    "CLAUDE_PLUGIN_DATA": tmp,
                    "CLAUDE_PLUGIN_OPTION_MAX_ATTEMPTS": "2",
                    "CLAUDE_PLUGIN_OPTION_REVIEW_POLICY": "risky",
                    "CLAUDE_PLUGIN_OPTION_TRIVIAL_EXTRA": "",
                    "CLAUDE_PLUGIN_OPTION_RISKY_EXTRA": "",
                }
            )
            script = str(ROOT / "hooks" / "after_agent.py")
            messages = []
            for tool_id, reason in (("a", "cursor off by one"), ("b", "cursor still wrong")):
                raw = _event("implementer-id", "implementer", _report("implementer", "sonnet", "fail", reason=reason))
                raw["tool_use_id"] = tool_id
                proc = subprocess.run(
                    [sys.executable, script],
                    input=json.dumps(raw).encode(),
                    capture_output=True,
                    env=env,
                    check=False,
                )
                self.assertEqual(proc.returncode, 0, proc.stderr.decode())
                messages.append(json.loads(proc.stdout)["hookSpecificOutput"]["additionalContext"])
            self.assertIn("Retry on sonnet", messages[0])
            self.assertIn("The next tier is opus", messages[1])
            self.assertIn("cursor off by one", messages[1])


if __name__ == "__main__":
    unittest.main()
