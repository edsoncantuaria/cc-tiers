---
name: review-ok-default
description: Review the last commit of a tiny node repo (issue #27).
tags: [review, issue-27]
expected_outcome: The reviewer runs, approves the change and reports no blocking finding.
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Agent, Read, Glob, Grep, Skill, TodoWrite]
append_system_prompt: "For this eval, do not review the code yourself and change no file. Delegate the review of the last commit (git diff HEAD~1 HEAD) to cc-tiers:reviewer: start its prompt with the lines CC_TIERS_TASK: review-last-commit and CC_TIERS_RESEARCH: none - eval, then give it the diff and the request, and report its verdict."
---

Review the last commit before I merge it.
