---
type: regex
pattern: 'CC_TIERS_FINDING_BEGIN(?=(?:(?!CC_TIERS_FINDING_(?:BEGIN|END)).)*CC_TIERS_FINDING_END)(?=(?:(?!CC_TIERS_FINDING_END).)*severity: (?:blocking|blocker|high)\b)'
match: not_contains
target: trace
---
