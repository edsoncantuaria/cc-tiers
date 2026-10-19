#!/usr/bin/env python3
"""SessionStart hook: inject the effective cc-tiers routing summary."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import cc_tiers  # noqa: E402


def _env(name: str) -> str:
    return os.environ.get(name, "")


def plugin_root() -> Path:
    raw = _env("CLAUDE_PLUGIN_ROOT")
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parents[1]


def user_from_env() -> dict:
    return {
        "max_attempts": _env("CLAUDE_PLUGIN_OPTION_MAX_ATTEMPTS") or None,
        "review_policy": _env("CLAUDE_PLUGIN_OPTION_REVIEW_POLICY") or None,
        "trivial_extra": _env("CLAUDE_PLUGIN_OPTION_TRIVIAL_EXTRA"),
        "risky_extra": _env("CLAUDE_PLUGIN_OPTION_RISKY_EXTRA"),
    }


def read_stdin() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def main() -> int:
    payload = read_stdin()
    root = plugin_root()
    defaults = cc_tiers.load_json(root / "config" / "routing.default.json")
    project_dir = Path(_env("CLAUDE_PROJECT_DIR")) if _env("CLAUDE_PROJECT_DIR") else None
    project, project_note = cc_tiers.read_project_file(project_dir)
    routing = cc_tiers.merge_routing(defaults, project, user_from_env())
    text = cc_tiers.format_session_context(routing, project_note)

    data_dir = _env("CLAUDE_PLUGIN_DATA")
    session_id = str(payload.get("session_id") or "unknown")
    if data_dir:
        path = cc_tiers.session_path(Path(data_dir), session_id)
        state = cc_tiers.load_state(path, session_id)
        cc_tiers.save_state(path, state)

    sys.stdout.write(json.dumps(cc_tiers.hook_output("SessionStart", text)) + "\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001 — a hook must not break session start
        fallback = cc_tiers.hook_output(
            "SessionStart",
            "cc-tiers is enabled. The routing summary could not be built "
            f"({exc.__class__.__name__}). Defaults still apply: max attempts per tier is 2, "
            "review policy is risky, escalation is haiku then sonnet then opus.",
        )
        sys.stdout.write(json.dumps(fallback) + "\n")
        raise SystemExit(0)
