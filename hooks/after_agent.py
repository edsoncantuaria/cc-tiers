#!/usr/bin/env python3
"""PostToolUse / PostToolUseFailure hook for Agent calls from cc-tiers."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import cc_tiers  # noqa: E402


def plugin_root() -> Path:
    raw = os.environ.get("CLAUDE_PLUGIN_ROOT", "")
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parents[1]


def user_from_env() -> dict:
    return {
        "max_attempts": os.environ.get("CLAUDE_PLUGIN_OPTION_MAX_ATTEMPTS") or None,
        "review_policy": os.environ.get("CLAUDE_PLUGIN_OPTION_REVIEW_POLICY") or None,
        "trivial_extra": os.environ.get("CLAUDE_PLUGIN_OPTION_TRIVIAL_EXTRA", ""),
        "risky_extra": os.environ.get("CLAUDE_PLUGIN_OPTION_RISKY_EXTRA", ""),
    }


def main() -> int:
    raw = sys.stdin.read()
    if not raw.strip():
        return 0
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return 0
    if not isinstance(payload, dict):
        return 0

    event = cc_tiers.normalize_event(payload)
    if event is None:
        return 0

    root = plugin_root()
    defaults = cc_tiers.load_json(root / "config" / "routing.default.json")
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
    project, _note = cc_tiers.read_project_file(Path(project_dir) if project_dir else None)
    routing = cc_tiers.merge_routing(defaults, project, user_from_env())

    data_dir = os.environ.get("CLAUDE_PLUGIN_DATA", "")
    session_id = event.get("session_id") or "unknown"
    path = cc_tiers.session_path(Path(data_dir), session_id) if data_dir else None
    state = cc_tiers.load_state(path, session_id) if path else cc_tiers.empty_state(session_id)
    state, message = cc_tiers.apply_event(state, event, routing)
    if path is not None:
        cc_tiers.save_state(path, state)
    if not message:
        return 0

    event_name = str(payload.get("hook_event_name") or "PostToolUse")
    sys.stdout.write(json.dumps(cc_tiers.hook_output(event_name, message)) + "\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:  # noqa: BLE001 — counting must never fail the tool result
        raise SystemExit(0)
