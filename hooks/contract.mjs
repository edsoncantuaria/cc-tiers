/**
 * Task contract: the spec block as numbered criteria, what the agents report per criterion,
 * and the completion status the gate, the criteria and the review add up to. Pure functions.
 */

import { criterionKey } from './verify.mjs'

export { criterionKey }

export const CRITERION_KINDS = ['functional', 'preserve', 'check', 'security', 'evidence', 'edge']
export const CRITERION_STATES = ['pending', 'pass', 'fail', 'unverifiable', 'na']

const HEADINGS = {
  criteria: 'functional',
  preserve: 'preserve',
  checks: 'check',
  security: 'security',
  evidence: 'evidence',
  'edge cases': 'edge',
  assumed: 'assumed',
  ambiguous: 'ambiguity',
}
const HEADING_RE = /^[*_#\s]*(criteria|preserve|checks|security|evidence|edge cases|assumed|ambiguous)[*_#\s]*:?[*_#\s]*$/i
const BULLET_RE = /^\s*(?:[-*•]|\d+\.)\s+/
const BARE_BULLET_RE = /^(?:[-*•]|\d+\.)\s*/
const ORIGIN_RE = /\s*\((?:request|user|repo|docs|decided)(?::.*)?\)\s*$/i
const ORIGIN_TAG_RE = /\((?:request|user|repo|docs|decided)(?::[^)]*)?\)/gi
const CHECK_RE = /`([^`]+)`/
const REPORT_RE = /^CC_TIERS_CRITERION:\s*(C\d+)\s+(pass|fail|unverifiable|na)(?:\s+-\s+(.*?))?\s*$/i
const RISK_RANK = { low: 0, medium: 1, high: 2, critical: 3 }

/** Same rule as the spec check in cc_tiers.mjs: a heading, a bare bullet or an origin tag alone is not a line. */
function hasContent(item) {
  return /[\p{L}\p{N}]/u.test(item.replace(BARE_BULLET_RE, '').replace(ORIGIN_TAG_RE, ''))
}

/** The body of a spec block, without its CC_TIERS_SPEC markers, as criteria, assumptions and ambiguities. */
export function parseContract(specText) {
  const contract = { criteria: [], assumptions: [], ambiguities: [] }
  let kind = 'functional'
  for (const line of String(specText || '').split(/\r?\n/)) {
    const item = line.trim()
    const heading = HEADING_RE.exec(item)
    if (heading) {
      kind = HEADINGS[heading[1].toLowerCase()]
      continue
    }
    if (!hasContent(item)) continue
    const body = item.replace(BULLET_RE, '').trim()
    if (kind === 'assumed') contract.assumptions.push(body)
    else if (kind === 'ambiguity') contract.ambiguities.push(body)
    else {
      const origin = ORIGIN_RE.exec(body)
      const text = body.replace(ORIGIN_RE, '').trim()
      contract.criteria.push({
        id: `C${contract.criteria.length + 1}`,
        kind,
        text,
        origin: origin ? origin[0].trim().slice(1, -1) : '',
        mandatory: true,
        check: kind === 'check' ? (CHECK_RE.exec(text)?.[1] ?? '') : '',
      })
    }
  }
  return contract
}

/** The previous mandatory criteria that next no longer carries word for word: reworded counts as weakened. */
export function weakenedCriteria(previous, next) {
  const kept = new Set((next?.criteria || []).map((criterion) => criterionKey(criterion.text)))
  return (previous?.criteria || []).filter((criterion) => criterion.mandatory && !kept.has(criterionKey(criterion.text)))
}

/** Every valid CC_TIERS_CRITERION line; na and unverifiable need a reason, and the last line per id wins. */
export function parseCriterionReports(text) {
  const reports = new Map()
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = REPORT_RE.exec(line.trim())
    if (!match) continue
    const state = match[2].toLowerCase()
    const evidence = match[3] || ''
    if ((state === 'na' || state === 'unverifiable') && !evidence) continue
    reports.set(match[1].toUpperCase(), { id: match[1].toUpperCase(), state, evidence })
  }
  return [...reports.values()]
}

export function oneSpacing(text) {
  return String(text ?? '').split(/\s+/).filter(Boolean).join(' ')
}

/** True when the evidence names the command as whole tokens: not inside a longer word, flag or path. */
function namesCommand(evidence, command) {
  const escaped = oneSpacing(command).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<=^|[\\s\`'"(])${escaped}(?=$|[\\s\`'"]|[.,;:!?)\\]](?:\\s|$))`).test(oneSpacing(evidence))
}

/** The criteria with the state the evidence supports: a declared pass alone is not evidence until a verified command or a passed review backs it. */
export function evaluateCriteria(contract, { reports = [], verified = [], reviewPassed = false, failedCriteria = [] } = {}) {
  const reported = new Map()
  for (const report of reports) reported.set(String(report.id).toUpperCase(), report)
  const failed = new Set(failedCriteria.map(criterionKey))
  return (contract?.criteria || []).map((criterion) => {
    const report = reported.get(criterion.id)
    const evaluated = (state, evidenced, evidence) => ({ ...criterion, state, evidenced, evidence })
    if (failed.has(criterionKey(criterion.text))) return evaluated('fail', false, report?.evidence || 'reviewer finding')
    if (report?.state === 'fail') return evaluated('fail', false, report.evidence)
    const command = criterion.check && verified.find((item) => oneSpacing(item) === oneSpacing(criterion.check))
    if (command) return evaluated('pass', true, command)
    // A check criterion names its own command: only that command passing is evidence, never another one or a review.
    if (criterion.check && report?.state === 'pass') return evaluated('pass', false, `declared; \`${criterion.check}\` did not run`)
    if (report?.state === 'pass') {
      const named = verified.find((item) => oneSpacing(item) && namesCommand(report.evidence, item))
      if (named) return evaluated('pass', true, named)
      return evaluated('pass', reviewPassed, reviewPassed ? report.evidence : 'declared')
    }
    // A writer's own n/a is a claim like a declared pass: it stands only once an independent review passed.
    if (report?.state === 'na') return evaluated('na', reviewPassed, report.evidence)
    if (report?.state === 'unverifiable') return evaluated(report.state, false, report.evidence)
    return evaluated('pending', false, '')
  })
}

function riskRank(risk) {
  return RISK_RANK[risk] ?? RISK_RANK.medium
}

export function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** What the task reached: status from the gate, the criteria and the review, with a qualitative confidence. */
export function completion({
  criteria,
  risk = 'medium',
  gate = { status: 'missing', verified: [], flaky: [], unverified: [] },
  review = 'none',
  strictFrom = 'medium',
  approved = '',
  preexisting = '',
}) {
  const mandatory = (criteria || []).filter((criterion) => criterion.mandatory)
  const ids = (state) => mandatory.filter((criterion) => criterion.state === state).map((criterion) => criterion.id)
  const evidenced = mandatory.filter((criterion) => criterion.state === 'pass' && criterion.evidenced)
  const passed = [...new Set([...(gate.verified || []), ...(gate.flaky || [])])]
  const flaky = gate.flaky || []
  const unverified = gate.unverified || []
  const failedIds = ids('fail')
  const pending = ids('pending')
  const unverifiable = ids('unverifiable')
  const na = ids('na')
  // An n/a only the writer declared never verifies a task, at any risk.
  const declaredNa = mandatory.filter((criterion) => criterion.state === 'na' && !criterion.evidenced).map((criterion) => criterion.id)
  // A pass the writer only declared (or a check whose own command never ran) is a claim, not evidence.
  const declaredPass = mandatory.filter((criterion) => criterion.state === 'pass' && !criterion.evidenced).map((criterion) => criterion.id)
  const gateFailed = gate.status === 'fail'
  // A failing command the writer declared pre-existing is reported, not counted against the change, but it never lets the task reach 'verified'.
  const inherited = gateFailed && Boolean(preexisting)
  const hasVerified = passed.length > 0 || gate.status === 'pass'
  const strict = riskRank(risk) >= riskRank(strictFrom)
  const needsReview = riskRank(risk) >= RISK_RANK.high

  let status = 'unverified'
  if ((gateFailed && !inherited) || review === 'fail' || failedIds.length) status = 'failed'
  else if (
    hasVerified &&
    !inherited &&
    !declaredNa.length &&
    (!strict || mandatory.every((criterion) => evidenced.includes(criterion) || (criterion.state === 'na' && criterion.evidenced))) &&
    (!needsReview || review === 'pass')
  )
    status = 'verified'
  else if (hasVerified || evidenced.length) status = 'partial'

  const criticalUnreviewed = risk === 'critical' && review !== 'pass'
  let level = 'moderate'
  if (status === 'failed' || status === 'unverified' || criticalUnreviewed) level = 'low'
  else if (status === 'verified' && !flaky.length && !unverifiable.length && !pending.length && !declaredNa.length && !declaredPass.length) level = 'high'

  // Criteria no human approved cap the confidence at moderate.
  const unapproved = approved === 'none'
  if (unapproved && level === 'high') level = 'moderate'

  const reasons = []
  if (gateFailed && !inherited) reasons.push('gate failed')
  else if (passed.length) reasons.push(`gate verified ${plural(passed.length, 'command')}`)
  else if (gate.status === 'pass') reasons.push('gate passed')
  else reasons.push('no verified command')
  if (inherited) reasons.push(`\`${preexisting}\` failed and was declared pre-existing`)
  if (flaky.length) reasons.push(plural(flaky.length, 'flaky command'))
  if (review === 'fail') reasons.push('review failed')
  for (const id of failedIds) reasons.push(`criterion ${id} failed`)
  for (const id of pending) reasons.push(`criterion ${id} pending`)
  for (const id of unverifiable) reasons.push(`criterion ${id} unverifiable`)
  for (const criterion of mandatory) if (criterion.state === 'na' && !criterion.evidenced) reasons.push(`criterion ${criterion.id} n/a only as declared`)
  for (const id of declaredPass) reasons.push(`criterion ${id} passed only as declared`)
  if (criticalUnreviewed) reasons.push('critical risk without review')
  if (unapproved) reasons.push('criteria not approved by the user')

  const remaining = []
  for (const criterion of mandatory) {
    if (criterion.state === 'pending') remaining.push(`criterion ${criterion.id} pending`)
    else if (criterion.state === 'unverifiable') remaining.push(`criterion ${criterion.id} unverifiable: ${criterion.evidence}`)
    else if (criterion.state === 'na' && !criterion.evidenced) remaining.push(`criterion ${criterion.id} declared n/a (${criterion.evidence}); an independent review must accept it`)
    else if (criterion.state === 'pass' && !criterion.evidenced) remaining.push(`criterion ${criterion.id} passed only as declared (${criterion.evidence}); needs a verified command or a review`)
  }
  for (const item of unverified) remaining.push(item.reason ?? String(item))
  if (needsReview && review !== 'pass') remaining.push('no independent review')

  return {
    status,
    implemented: true,
    checks: { run: passed.length + (gateFailed ? 1 : 0), passed: passed.length, failed: gateFailed ? 1 : 0, notRun: unverified.length, flaky: flaky.length },
    criteria: { total: mandatory.length, evidenced: evidenced.length, pending, failed: failedIds, unverifiable, na },
    remaining,
    confidence: { level, reasons },
  }
}
