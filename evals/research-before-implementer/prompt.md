---
name: research-before-implementer
description: A small command line tool in a tiny node repo; the plugin should research the API before it implements.
tags: [pilot, orchestration]
expected_outcome: cli.js exists and uses util.parseArgs, npm test passes, and a researcher ran before the implementer.
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Agent, Read, Glob, Grep, Skill, TodoWrite]
---

This repo is a tiny node package. Add a command line tool to it as `cli.js`. It takes a file path and one flag, `--words` or `--lines`, parses its arguments with Node's built-in `util.parseArgs`, and prints how many whitespace-separated words or how many lines that file has. A missing file, a missing flag or both flags exit with code 1 and a message on stderr. Add a `bin` entry for it in `package.json`, and tests in `cli.test.js` that run the tool as a child process. `npm test` has to pass when you are done.
