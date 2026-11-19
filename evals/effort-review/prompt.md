---
name: effort-review
description: Finish a draft that has two counting defects; run at one CLAUDE_CODE_EFFORT_LEVEL.
tags: [effort, sweep]
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Agent, Read, Glob, Grep, Skill, TodoWrite]
---

I committed a first draft of a command line tool in this tiny node package, `cli.js`. It takes a file path and one flag, `--words` or `--lines`, and prints how many whitespace-separated words or how many lines that file has. A missing file, a missing flag or both flags must exit with code 1 and a message on stderr. Finish it: add a `bin` entry for it in `package.json`, and tests in `cli.test.js` that run the tool as a child process. `npm test` has to pass when you are done.
