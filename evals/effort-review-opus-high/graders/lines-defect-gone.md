---
type: regex
pattern: ":\\s*text\\.split\\('\\\\n'\\)\\.length\\)"
match: not_contains
target:
  source: file
  path: cli.js
---
