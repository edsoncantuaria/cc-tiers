"""Routing merge and per-tier attempt counter for the cc-tiers plugin.

The hook scripts stay thin. This module is the behavior tests lock in:
how a project file and /config combine, and when a failure retries or escalates.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

TIERS = ("haiku", "sonnet", "opus")
NEXT_TIER = {"haiku": "sonnet", "sonnet": "opus", "opus": None}
IMPLEMENTERS = {
    "haiku": "worker",
    "sonnet": "implementer",
    "opus": "orchestrator",
}
SCOPED = {
    "worker": "cc-tiers:worker",
    "implementer": "cc-tiers:implementer",
    "reviewer": "cc-tiers:reviewer",
    "orchestrator": "cc-tiers:orchestrator",
}
ROLES = {"worker": "haiku", "implementer": "sonnet", "reviewer": "opus"}
REVIEW_POLICIES = {"risky", "always", "never"}
DEFAULT_MAX_ATTEMPTS = 2
MAX_PHRASES = 40
MAX_PHRASE_LEN = 200
MAX_CARRIED = 8
MAX_REASON = 500
HEADER_RE = re.compile(r"^CC_TIERS_([A-Z]+):\s*(.*?)\s*$")


def load_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return data


def parse_phrases(value: Any) -> list[str]:
    """Accept a comma-separated string or a list of strings."""
    if value is None:
        return []
    if isinstance(value, str):
        parts = value.split(",")
    elif isinstance(value, list):
        parts = value
    else:
        return []
    phrases: list[str] = []
    for part in parts:
        if not isinstance(part, str):
            continue
        text = " ".join(part.split())
        if not text:
            continue
        phrases.append(text[:MAX_PHRASE_LEN])
        if len(phrases) >= MAX_PHRASES:
            break
    return phrases


def clamp_attempts(value: Any, fallback: int = DEFAULT_MAX_ATTEMPTS) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    if number < 1 or number > 5:
        return fallback
    return number


def _phrase_list(value: Any) -> list[str] | None:
    if not isinstance(value, list) or not value:
        return None
    phrases = parse_phrases(value)
    if len(phrases) != len([item for item in value if isinstance(item, str) and item.strip()]):
        return None
    return phrases or None


def merge_routing(
    defaults: dict[str, Any],
    project: dict[str, Any] | None = None,
    user: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the effective routing table.

    `/config` (the user dict) wins for max attempts and review policy.
    A project file replaces a phrase list only when it supplies a non-empty
    list of strings for that list. Extra phrases from both places are appended.
    Agent names and the escalation order stay fixed.
    """
    project = project or {}
    user = user or {}
    notes: list[str] = []

    max_attempts = clamp_attempts(defaults.get("maxAttempts"), DEFAULT_MAX_ATTEMPTS)
    if "maxAttempts" in project:
        notes.append("Project maxAttempts is ignored; set max_attempts in /config.")
    if user.get("max_attempts") not in (None, ""):
        max_attempts = clamp_attempts(user.get("max_attempts"), max_attempts)

    review = str(defaults.get("reviewPolicy") or "risky").lower()
    if review not in REVIEW_POLICIES:
        review = "risky"
    project_review = project.get("reviewPolicy")
    if project_review not in (None, ""):
        notes.append("Project reviewPolicy is ignored; set review_policy in /config.")
    chosen = user.get("review_policy")
    if chosen not in (None, ""):
        lowered = str(chosen).strip().lower()
        review = lowered if lowered in REVIEW_POLICIES else review

    tiers_in = defaults.get("tiers") if isinstance(defaults.get("tiers"), dict) else {}
    project_tiers = project.get("tiers") if isinstance(project.get("tiers"), dict) else {}

    def when_list(tier: str, key: str) -> list[str]:
        base = tiers_in.get(tier) if isinstance(tiers_in.get(tier), dict) else {}
        phrases = list(base.get(key) or [])
        override = project_tiers.get(tier) if isinstance(project_tiers.get(tier), dict) else {}
        if key in override:
            replaced = _phrase_list(override.get(key))
            if replaced is None:
                notes.append(f"Ignored {tier}.{key} in the project file; it must be a non-empty list of strings.")
            else:
                phrases = replaced
        return phrases

    haiku_when = when_list("haiku", "when")
    sonnet_when = when_list("sonnet", "when")
    opus_when = when_list("opus", "when")
    review_when = when_list("opus", "reviewWhen")

    haiku_when = _append_unique(haiku_when, parse_phrases(project.get("trivialExtra")))
    haiku_when = _append_unique(haiku_when, parse_phrases(user.get("trivial_extra")))
    review_when = _append_unique(review_when, parse_phrases(project.get("riskyExtra")))
    review_when = _append_unique(review_when, parse_phrases(user.get("risky_extra")))

    return {
        "maxAttempts": max_attempts,
        "reviewPolicy": review,
        "escalation": list(TIERS),
        "notes": notes,
        "tiers": {
            "haiku": {"model": "haiku", "agent": "worker", "scoped": SCOPED["worker"], "when": haiku_when},
            "sonnet": {
                "model": "sonnet",
                "agent": "implementer",
                "scoped": SCOPED["implementer"],
                "when": sonnet_when,
            },
            "opus": {
                "model": "opus",
                "agent": "orchestrator",
                "scoped": SCOPED["orchestrator"],
                "reviewAgent": "reviewer",
                "reviewScoped": SCOPED["reviewer"],
                "when": opus_when,
                "reviewWhen": review_when,
            },
        },
    }


def _append_unique(base: list[str], extra: list[str]) -> list[str]:
    seen = {item.lower() for item in base}
    merged = list(base)
    for item in extra:
        if item.lower() in seen:
            continue
        merged.append(item)
        seen.add(item.lower())
        if len(merged) >= MAX_PHRASES:
            break
    return merged


def format_session_context(routing: dict[str, Any], project_note: str) -> str:
    tiers = routing["tiers"]
    lines = [
        "cc-tiers routing is active.",
        f"Max attempts per tier: {routing['maxAttempts']}.",
        f"Review policy: {routing['reviewPolicy']}.",
        "Escalation order: haiku (cc-tiers:worker) -> sonnet (cc-tiers:implementer) -> opus (the orchestrator implements the ceiling).",
        "Reviewer: cc-tiers:reviewer, on Opus, in a fresh context.",
        "Delegated agents select haiku, sonnet, or opus from their own definitions. A per-invocation model override replaces that choice.",
        "Haiku when: " + "; ".join(tiers["haiku"]["when"]) + ".",
        "Sonnet when: " + "; ".join(tiers["sonnet"]["when"]) + ".",
        "Opus review when: " + "; ".join(tiers["opus"]["reviewWhen"]) + ".",
        f"Project routing file: {project_note}.",
    ]
    if routing.get("notes"):
        lines.append("Config notes: " + " ".join(routing["notes"]))
    lines.append(
        "A failure at a tier is a failed test, a rejected review, or a subagent error. "
        f"After {routing['maxAttempts']} failures the task moves up one tier and those notes travel with it. "
        "Opus is the last tier: the orchestrator then stops and reports the notes to the user."
    )
    return "\n".join(lines)


def empty_state(session_id: str) -> dict[str, Any]:
    return {"session_id": session_id, "seen": [], "tasks": {}}


def session_path(data_dir: Path, session_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_-]", "-", session_id)[:80] or "unknown"
    return data_dir / f"session-{safe}.json"


def load_state(path: Path, session_id: str) -> dict[str, Any]:
    if not path.exists():
        return empty_state(session_id)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return empty_state(session_id)
    if not isinstance(data, dict) or not isinstance(data.get("tasks"), dict):
        return empty_state(session_id)
    data.setdefault("seen", [])
    data["session_id"] = session_id
    return data


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    latest = path.parent / "latest.json"
    latest.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    _prune_sessions(path.parent)


def _prune_sessions(data_dir: Path) -> None:
    files = sorted(data_dir.glob("session-*.json"), key=lambda item: item.stat().st_mtime, reverse=True)
    for stale in files[20:]:
        try:
            stale.unlink()
        except OSError:
            pass


def parse_headers(text: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for line in text.splitlines():
        match = HEADER_RE.match(line.strip())
        if not match:
            continue
        found[match.group(1)] = match.group(2).strip()
    return found


def match_role(subagent_type: str) -> str | None:
    if not subagent_type:
        return None
    base = subagent_type.split(":")[-1].strip().lower()
    if base in ROLES:
        return base
    return None


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and isinstance(block.get("text"), str):
                parts.append(block["text"])
        return "\n".join(parts)
    if isinstance(content, dict) and isinstance(content.get("text"), str):
        return content["text"]
    return ""


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9-]+", "-", value.lower()).strip("-")
    return slug[:64]


def normalize_event(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Reduce a PostToolUse or PostToolUseFailure payload to one report."""
    if not isinstance(raw, dict):
        return None
    event = str(raw.get("hook_event_name") or "")
    if event not in {"PostToolUse", "PostToolUseFailure"}:
        return None
    if raw.get("tool_name") not in (None, "", "Agent"):
        return None
    if raw.get("is_interrupt") is True:
        return None

    tool_input = raw.get("tool_input") if isinstance(raw.get("tool_input"), dict) else {}
    subagent_type = str(tool_input.get("subagent_type") or "")
    role = match_role(subagent_type)
    if role is None:
        return None

    prompt = str(tool_input.get("prompt") or "")
    if event == "PostToolUseFailure":
        text = ""
        error = str(raw.get("error") or "subagent error")[:MAX_REASON]
        kind = "error"
    else:
        response = raw.get("tool_response")
        if isinstance(response, dict) and response.get("status") == "async_launched":
            return {
                "kind": "background",
                "tool_use_id": str(raw.get("tool_use_id") or ""),
                "session_id": str(raw.get("session_id") or "unknown"),
                "role": role,
            }
        content = response.get("content") if isinstance(response, dict) else response
        text = _content_text(content)
        error = ""
        kind = "report"

    return {
        "kind": kind,
        "tool_use_id": str(raw.get("tool_use_id") or ""),
        "session_id": str(raw.get("session_id") or "unknown"),
        "role": role,
        "prompt": prompt,
        "text": text,
        "error": error,
    }


def apply_event(state: dict[str, Any], event: dict[str, Any], routing: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """Update the attempt counter. Return the context note for the orchestrator."""
    if event.get("kind") == "background":
        return state, (
            f"{SCOPED[event['role']]} moved to the background before it reported. "
            "cc-tiers counts a failure only from a finished foreground report. "
            "Wait for the report, then apply the attempt rule yourself if no count arrives."
        )

    seen = list(state.get("seen") or [])
    tool_use_id = event.get("tool_use_id") or ""
    if tool_use_id and tool_use_id in seen:
        return state, ""
    if tool_use_id:
        seen.append(tool_use_id)
        state["seen"] = seen[-200:]

    headers = parse_headers(event.get("prompt") or "")
    headers.update(parse_headers(event.get("text") or ""))
    task = _slug(headers.get("TASK", ""))
    if not task:
        return state, (
            f"{SCOPED[event['role']]} finished without a CC_TIERS_TASK slug. "
            "cc-tiers did not count an attempt. The orchestrator counts a crashed or untagged run as a failure."
        )

    role = event["role"]
    default_tier = ROLES[role] if role != "reviewer" else "sonnet"
    tier = headers.get("TIER", "").lower()
    if tier not in TIERS:
        tier = default_tier
    if role != "reviewer":
        tier = ROLES[role]

    status = headers.get("STATUS", "").lower()
    if event.get("kind") == "error":
        status = "fail"
    if status not in {"pass", "fail"}:
        return state, (
            f"Task {task} on {SCOPED[role]} finished without CC_TIERS_STATUS pass or fail. "
            "cc-tiers did not count an attempt."
        )

    reason = headers.get("REASON") or event.get("error") or "no reason given"
    reason = " ".join(reason.split())[:MAX_REASON]
    review = headers.get("REVIEW", "").lower()
    tasks: dict[str, Any] = state.setdefault("tasks", {})
    current = tasks.get(task)
    if not isinstance(current, dict):
        current = {"tier": tier, "failures": [], "carried": []}

    if role == "reviewer":
        message = _apply_review(tasks, task, current, tier, status, reason, routing)
    elif status == "pass" and review == "skip":
        tasks.pop(task, None)
        message = f"Task {task} passed on {tier} and review was skipped. cc-tiers cleared its attempt counter."
    elif status == "pass":
        current["tier"] = tier
        tasks[task] = current
        message = (
            f"Task {task} passed on {tier}. Review policy is {routing['reviewPolicy']}. "
            "The attempt counter stays until the Opus reviewer passes it, or until a later report sets CC_TIERS_REVIEW: skip."
        )
    else:
        message = _apply_failure(tasks, task, current, tier, role, reason, routing)

    return state, message


def _apply_review(
    tasks: dict[str, Any],
    task: str,
    current: dict[str, Any],
    tier: str,
    status: str,
    reason: str,
    routing: dict[str, Any],
) -> str:
    if status == "pass":
        tasks.pop(task, None)
        return f"Task {task} passed Opus review. cc-tiers cleared its attempt counter."
    current["tier"] = tier
    return _apply_failure(tasks, task, current, tier, "reviewer", reason, routing)


def _apply_failure(
    tasks: dict[str, Any],
    task: str,
    current: dict[str, Any],
    tier: str,
    role: str,
    reason: str,
    routing: dict[str, Any],
) -> str:
    if current.get("tier") != tier:
        current = {"tier": tier, "failures": [], "carried": list(current.get("carried") or [])}
    failures = list(current.get("failures") or [])
    failures.append(f"{tier}/{role}: {reason}")
    current["failures"] = failures
    current["tier"] = tier
    max_attempts = int(routing["maxAttempts"])
    carried = list(current.get("carried") or [])
    history = carried + failures

    if len(failures) < max_attempts:
        tasks[task] = current
        return _format_count(
            task,
            tier,
            len(failures),
            max_attempts,
            f"Retry on {tier} ({SCOPED[IMPLEMENTERS[tier]]}). Include the failure notes in the next prompt.",
            history,
        )

    nxt = NEXT_TIER[tier]
    carried_forward = (carried + failures)[-MAX_CARRIED:]
    if nxt is None:
        tasks[task] = {
            "tier": tier,
            "failures": failures,
            "carried": carried,
        }
        return _format_count(
            task,
            tier,
            len(failures),
            max_attempts,
            "Opus is the last tier. Stop and report these notes to the user.",
            history,
        )

    tasks[task] = {"tier": nxt, "failures": [], "carried": carried_forward}
    return _format_count(
        task,
        tier,
        len(failures),
        max_attempts,
        f"The next tier is {nxt} ({SCOPED[IMPLEMENTERS[nxt]]}). "
        "Pass the failure notes in the delegation prompt. The new tier starts at zero failures.",
        history,
    )


def _format_count(task: str, tier: str, count: int, maximum: int, decision: str, history: list[str]) -> str:
    lines = [
        f"cc-tiers counted a failure for {task}.",
        f"Tier {tier} has {count} failure(s); max attempts is {maximum}.",
        decision,
        "Failure notes:",
    ]
    for index, note in enumerate(history[-MAX_CARRIED:], start=1):
        lines.append(f"{index}. {note}")
    return "\n".join(lines)


def hook_output(event_name: str, text: str) -> dict[str, Any]:
    return {
        "hookSpecificOutput": {
            "hookEventName": event_name,
            "additionalContext": text,
        }
    }


def read_project_file(project_dir: Path | None) -> tuple[dict[str, Any] | None, str]:
    if project_dir is None:
        return None, "not checked"
    path = project_dir / ".claude" / "cc-tiers.json"
    if not path.exists():
        return None, "not present"
    try:
        data = load_json(path)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        return None, f"present but ignored ({exc.__class__.__name__})"
    return data, str(path)
