/**
 * Routing merge, attempt counter, cc-cost spend, budget bias, and Haiku history.
 * Hook entrypoints stay thin. This module is what the tests lock in.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'

export const TIERS = ['haiku', 'sonnet', 'opus']
export const NEXT_TIER = { haiku: 'sonnet', sonnet: 'opus', opus: null }
export const IMPLEMENTERS = { haiku: 'worker', sonnet: 'implementer', opus: 'orchestrator' }
export const SCOPED = {
  worker: 'cc-tiers:worker',
  implementer: 'cc-tiers:implementer',
  reviewer: 'cc-tiers:reviewer',
  checker: 'cc-tiers:checker',
  orchestrator: 'cc-tiers:orchestrator',
}
export const ROLES = { worker: 'haiku', implementer: 'sonnet', reviewer: 'opus', checker: 'sonnet' }
export const REVIEW_ROLES = new Set(['reviewer', 'checker'])
export const REVIEW_POLICIES = new Set(['cheap', 'risky', 'always', 'never'])
export const DEFAULT_MAX_ATTEMPTS = 2
export const DEFAULT_BUDGET = 80
export const HISTORY_BASENAME = 'cc-tiers-history.json'
export const HISTORY_IGNORE = `.claude/${HISTORY_BASENAME}`
export const MAX_PHRASES = 40
export const MAX_PHRASE_LEN = 200
export const MAX_CARRIED = 8
export const MAX_REASON = 500
export const MAX_HISTORY = 40
const HEADER_RE = /^CC_TIERS_([A-Z]+):\s*(.*?)\s*$/
const ORCHESTRATION_PHRASE = 'planning and splitting work into tasks'
const STOP = new Set(
  `a an the to of and or for in on with from by at as is are was were be this that it its into over under out up down do does
   um uma o os as de da do dos das e ou para com sem por em no na nos nas que se
   cc tiers task status role review reason pass fail pending skip worker implementer reviewer checker orchestrator haiku sonnet opus`
    .split(/\s+/)
    .filter(Boolean),
)

export function loadJson(file) {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${file} must contain a JSON object`)
  }
  return data
}

export function parsePhrases(value) {
  if (value == null) return []
  const parts = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : null
  if (!parts) return []
  const phrases = []
  for (const part of parts) {
    if (typeof part !== 'string') continue
    const text = part.split(/\s+/).filter(Boolean).join(' ')
    if (!text) continue
    phrases.push(text.slice(0, MAX_PHRASE_LEN))
    if (phrases.length >= MAX_PHRASES) break
  }
  return phrases
}

export function clampAttempts(value, fallback = DEFAULT_MAX_ATTEMPTS) {
  const number = Number.parseInt(value, 10)
  if (!Number.isInteger(number) || number < 1 || number > 5) return fallback
  return number
}

export function clampPercent(value, fallback = DEFAULT_BUDGET) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 1 || number > 100) return fallback
  return Math.round(number)
}

/** `/config` stores learn as on/off. Project files may say true or false. */
export function parseLearn(value, fallback = true) {
  if (value == null || value === '') return fallback
  if (typeof value === 'boolean') return value
  const text = String(value).trim().toLowerCase()
  if (['on', 'true', 'yes', '1'].includes(text)) return true
  if (['off', 'false', 'no', '0'].includes(text)) return false
  return fallback
}

function phraseList(value) {
  if (!Array.isArray(value) || value.length === 0) return null
  const phrases = parsePhrases(value)
  const strings = value.filter((item) => typeof item === 'string' && item.trim())
  if (phrases.length !== strings.length) return null
  return phrases.length ? phrases : null
}

function appendUnique(base, extra) {
  const seen = new Set(base.map((item) => item.toLowerCase()))
  const merged = [...base]
  for (const item of extra) {
    if (seen.has(item.toLowerCase())) continue
    merged.push(item)
    seen.add(item.toLowerCase())
    if (merged.length >= MAX_PHRASES) break
  }
  return merged
}

function pickNumber(userValue, projectValue, fallback, note, notes) {
  if (projectValue != null && projectValue !== '' && userValue != null && userValue !== '') {
    notes.push(note)
  }
  if (userValue != null && userValue !== '') return clampPercent(userValue, fallback)
  if (projectValue != null && projectValue !== '') return clampPercent(projectValue, fallback)
  return fallback
}

export function mergeRouting(defaults, project = null, user = null) {
  const source = project || {}
  const config = user || {}
  const notes = []

  let maxAttempts = clampAttempts(defaults.maxAttempts, DEFAULT_MAX_ATTEMPTS)
  if ('maxAttempts' in source) notes.push('Project maxAttempts is ignored; set max_attempts in /config.')
  if (config.max_attempts != null && config.max_attempts !== '') {
    maxAttempts = clampAttempts(config.max_attempts, maxAttempts)
  }

  let review = String(defaults.reviewPolicy || 'cheap').toLowerCase()
  if (!REVIEW_POLICIES.has(review)) review = 'cheap'
  if (source.reviewPolicy != null && source.reviewPolicy !== '') {
    notes.push('Project reviewPolicy is ignored; set review_policy in /config.')
  }
  if (config.review_policy != null && config.review_policy !== '') {
    const lowered = String(config.review_policy).trim().toLowerCase()
    review = REVIEW_POLICIES.has(lowered) ? lowered : review
  }

  const learnFallback = parseLearn(defaults.learn, true)
  let learn = learnFallback
  const projectLearn = source.learn
  const userLearn = config.learn
  if (projectLearn != null && projectLearn !== '' && userLearn != null && userLearn !== '') {
    notes.push('Project learn is ignored; set learn in /config.')
  }
  if (userLearn != null && userLearn !== '') learn = parseLearn(userLearn, learnFallback)
  else if (projectLearn != null && projectLearn !== '') learn = parseLearn(projectLearn, learnFallback)

  const budgetFallback5 = clampPercent(defaults.budget5h, DEFAULT_BUDGET)
  const budgetFallback7 = clampPercent(defaults.budget7d, DEFAULT_BUDGET)
  const budget5h = pickNumber(
    config.budget_5h,
    source.budget5h ?? source.budget_5h,
    budgetFallback5,
    'Project budget5h is ignored; set budget_5h in /config.',
    notes,
  )
  const budget7d = pickNumber(
    config.budget_7d,
    source.budget7d ?? source.budget_7d,
    budgetFallback7,
    'Project budget7d is ignored; set budget_7d in /config.',
    notes,
  )

  const tiersIn = defaults.tiers && typeof defaults.tiers === 'object' ? defaults.tiers : {}
  const projectTiers = source.tiers && typeof source.tiers === 'object' ? source.tiers : {}

  function whenList(tier, key) {
    const base = tiersIn[tier] && typeof tiersIn[tier] === 'object' ? tiersIn[tier] : {}
    let phrases = [...(base[key] || [])]
    const override = projectTiers[tier] && typeof projectTiers[tier] === 'object' ? projectTiers[tier] : {}
    if (key in override) {
      const replaced = phraseList(override[key])
      if (replaced == null) notes.push(`Ignored ${tier}.${key} in the project file; it must be a non-empty list of strings.`)
      else phrases = replaced
    }
    return phrases
  }

  let haikuWhen = whenList('haiku', 'when')
  const sonnetWhen = whenList('sonnet', 'when')
  const opusWhen = whenList('opus', 'when')
  let reviewWhen = whenList('opus', 'reviewWhen')
  haikuWhen = appendUnique(haikuWhen, parsePhrases(source.trivialExtra))
  haikuWhen = appendUnique(haikuWhen, parsePhrases(config.trivial_extra))
  reviewWhen = appendUnique(reviewWhen, parsePhrases(source.riskyExtra))
  reviewWhen = appendUnique(reviewWhen, parsePhrases(config.risky_extra))

  return {
    maxAttempts,
    reviewPolicy: review,
    learn,
    budget5h,
    budget7d,
    escalation: [...TIERS],
    notes,
    tiers: {
      haiku: { model: 'haiku', agent: 'worker', scoped: SCOPED.worker, when: haikuWhen },
      sonnet: { model: 'sonnet', agent: 'implementer', scoped: SCOPED.implementer, when: sonnetWhen },
      opus: {
        model: 'opus',
        agent: 'orchestrator',
        scoped: SCOPED.orchestrator,
        reviewAgent: 'reviewer',
        reviewScoped: SCOPED.reviewer,
        when: opusWhen,
        reviewWhen,
      },
    },
  }
}

function matchesAny(text, phrases) {
  const hay = String(text || '').toLowerCase()
  return (phrases || []).some((phrase) => phrase && hay.includes(String(phrase).toLowerCase()))
}

export function isRisky(text, routing) {
  return matchesAny(text, routing?.tiers?.opus?.reviewWhen)
}

/**
 * Who reviews a finished writer tier.
 * cheap: Sonnet checks Haiku; Opus reviews only risky work or the Opus ceiling.
 * risky: Opus reviews non-trivial work and skips a trivial Haiku pass.
 * always: every pass is reviewed, Haiku on Sonnet and the rest on Opus.
 * never: no review.
 * While conserving, Opus review is reserved for risky work and the Opus ceiling.
 */
export function selectReviewer({ policy, writerTier, risky, conserve }) {
  if (policy === 'never') return null
  const critical = Boolean(risky) || writerTier === 'opus'
  if (conserve) {
    if (writerTier === 'haiku') {
      if (policy === 'always' || policy === 'cheap' || risky) return 'checker'
      return null
    }
    return critical ? 'reviewer' : null
  }
  if (policy === 'always') return writerTier === 'haiku' ? 'checker' : 'reviewer'
  if (policy === 'cheap') {
    if (writerTier === 'haiku') return 'checker'
    if (writerTier === 'opus' || risky) return 'reviewer'
    return null
  }
  if (writerTier === 'haiku') return risky ? 'checker' : null
  return 'reviewer'
}

export function tokenize(text) {
  const words = String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP.has(word))
  const seen = new Set()
  const tokens = []
  for (const word of words) {
    if (seen.has(word)) continue
    seen.add(word)
    tokens.push(word)
  }
  return tokens
}

export function stripHeaders(text) {
  return String(text || '')
    .split(/\n/)
    .filter((line) => !/^CC_TIERS_[A-Z]+:/.test(line.trim()))
    .join('\n')
}

export function emptyHistory() {
  return { version: 1, entries: [] }
}

export function historyMatches(text, history) {
  if (!history || !Array.isArray(history.entries)) return false
  const tokens = tokenize(stripHeaders(text))
  const kind = slug(stripHeaders(text).slice(0, 80))
  for (const entry of history.entries) {
    if (!entry || typeof entry !== 'object') continue
    if (entry.kind && kind && entry.kind === kind) return true
    const known = new Set(Array.isArray(entry.tokens) ? entry.tokens : [])
    let shared = 0
    for (const token of tokens) if (known.has(token)) shared += 1
    const denom = Math.min(tokens.length, known.size)
    if (shared >= 2 && denom > 0 && shared / denom >= 0.5) return true
  }
  return false
}

export function noteHaikuFailure(history, { task, prompt, reason, now }) {
  const base = history && Array.isArray(history.entries) ? history : emptyHistory()
  const kind = slug(task) || 'task'
  const tokens = tokenize(stripHeaders(`${task}\n${prompt || ''}\n${reason || ''}`)).slice(0, 24)
  const updated = now || new Date().toISOString()
  const entries = base.entries.map((entry) => ({ ...entry }))
  const found = entries.find((entry) => entry.kind === kind)
  const cleanReason = String(reason || 'no reason given').split(/\s+/).filter(Boolean).join(' ').slice(0, MAX_REASON)
  if (found) {
    found.count = (Number(found.count) || 1) + 1
    found.reason = cleanReason
    found.updated = updated
    if (tokens.length) found.tokens = tokens
  } else {
    entries.push({ kind, tokens, reason: cleanReason, count: 1, updated })
  }
  entries.sort((a, b) => String(b.updated).localeCompare(String(a.updated)))
  return { version: 1, entries: entries.slice(0, MAX_HISTORY) }
}

/**
 * Classify one task description.
 * because is one of: ceiling, orchestration, trivial, default, opus-phrase, history, budget.
 */
export function decideTier(text, routing, { history = null, conserve = false, ceiling = false } = {}) {
  if (ceiling) return { tier: 'opus', agent: SCOPED.orchestrator, because: 'ceiling' }
  let tier = 'sonnet'
  let because = 'default'
  if (matchesAny(text, routing.tiers.haiku.when)) {
    tier = 'haiku'
    because = 'trivial'
  } else if (matchesAny(text, routing.tiers.opus.when)) {
    tier = 'opus'
    because = 'opus-phrase'
  }
  if (matchesAny(text, [ORCHESTRATION_PHRASE])) {
    tier = 'opus'
    because = 'orchestration'
  }
  if (history && tier === 'haiku' && historyMatches(text, history)) {
    tier = 'sonnet'
    because = 'history'
  }
  if (conserve && tier === 'opus' && because !== 'orchestration') {
    tier = 'sonnet'
    because = 'budget'
  }
  const agent = tier === 'haiku' ? SCOPED.worker : tier === 'sonnet' ? SCOPED.implementer : SCOPED.orchestrator
  return { tier, agent, because }
}

export function guidance(routing, budget, history) {
  const lines = []
  const policy = routing.reviewPolicy
  const conserve = budget?.conserve === true
  if (conserve) {
    const which = (budget.hits || []).join(', ') || 'a usage window'
    lines.push(
      `Budget routing: conserve (${which}). Delegate new work to cc-tiers:worker or cc-tiers:implementer. Do not start a task on Opus. Opus stays the escalation ceiling after Sonnet uses its attempts, and the reviewer for critical work.`,
    )
  } else if (budget && (budget.fiveHour == null && budget.sevenDay == null)) {
    lines.push(
      `Budget routing: normal. Thresholds are 5h ${routing.budget5h}% and 7d ${routing.budget7d}%. No 5h or 7d reading yet, so routing does not conserve.`,
    )
  } else if (budget) {
    const five = budget.fiveHour == null ? 'unread' : `${budget.fiveHour}%`
    const seven = budget.sevenDay == null ? 'unread' : `${budget.sevenDay}%`
    lines.push(
      `Budget routing: normal. 5h ${five} (threshold ${routing.budget5h}%), 7d ${seven} (threshold ${routing.budget7d}%). Opus is the escalation ceiling, not the default implementer.`,
    )
  }
  if (policy === 'cheap') {
    lines.push(
      'Review: send Haiku output to cc-tiers:checker (Sonnet). Send work written at the Opus ceiling, and any result that matches an Opus review phrase, to cc-tiers:reviewer. Ordinary Sonnet work does not go to Opus.',
    )
  } else if (policy === 'always') {
    lines.push(
      'Review: send every Haiku pass to cc-tiers:checker (Sonnet). Send every Sonnet or Opus pass to cc-tiers:reviewer, unless budget routing is conserving and the result is not critical.',
    )
  } else if (policy === 'never') {
    lines.push('Review: no review pass. Tell the worker or implementer to set CC_TIERS_REVIEW: skip.')
  } else {
    lines.push(
      'Review: skip a trivial Haiku pass. Send other finished work to cc-tiers:reviewer (Opus). A risky Haiku result goes to cc-tiers:checker (Sonnet), not Opus. While conserving, skip Opus review unless the result matches an Opus review phrase or it was written at the Opus ceiling.',
    )
  }
  if (!routing.learn) {
    lines.push('Haiku failure history: off. Do not read .claude/cc-tiers-history.json.')
  } else if (history && Array.isArray(history.entries) && history.entries.length) {
    const kinds = history.entries.slice(0, 12).map((entry) => entry.kind).filter(Boolean)
    lines.push(
      `Haiku failure history: on. Similar tasks start on Sonnet, not Haiku: ${kinds.join(', ')}.`,
    )
  } else {
    lines.push('Haiku failure history: on. No Haiku failures recorded yet. The file is .claude/cc-tiers-history.json.')
  }
  return lines
}

export function formatSessionContext(routing, projectNote, snapshot = {}) {
  const tiers = routing.tiers
  const lines = [
    'cc-tiers routing is active.',
    `Max attempts per tier: ${routing.maxAttempts}.`,
    `Review policy: ${routing.reviewPolicy}.`,
    'Escalation order: haiku (cc-tiers:worker) -> sonnet (cc-tiers:implementer) -> opus (the orchestrator implements the ceiling).',
    'Reviewer: cc-tiers:reviewer, on Opus, in a fresh context.',
    'Checker: cc-tiers:checker, on Sonnet, reviews Haiku output when the review policy asks for it.',
    'Delegated agents select haiku, sonnet, or opus from their own definitions. A per-invocation model override replaces that choice.',
    `Haiku when: ${tiers.haiku.when.join('; ')}.`,
    `Sonnet when: ${tiers.sonnet.when.join('; ')}.`,
    `Opus review when: ${tiers.opus.reviewWhen.join('; ')}.`,
    `Project routing file: ${projectNote}.`,
  ]
  if (routing.notes?.length) lines.push(`Config notes: ${routing.notes.join(' ')}`)
  lines.push(
    'A failure at a tier is a failed test, a rejected review, or a subagent error. ' +
      `After ${routing.maxAttempts} failures the task moves up one tier and those notes travel with it. ` +
      'Opus is the last tier: the orchestrator then stops and reports the notes to the user.',
  )
  lines.push(...guidance(routing, snapshot.budget, snapshot.history))
  lines.push(snapshot.ccCost?.installed ? ccCostLine(snapshot) : 'cc-cost: not installed. Per-task spend is omitted.')
  return lines.join('\n')
}

function ccCostLine(snapshot) {
  const lines = [
    'cc-cost: installed. Spend uses cc-cost fresh tokens (input + cache write + output; cache reads excluded).',
  ]
  if (snapshot.today != null) lines.push(`cc-cost today: ${snapshot.today} fresh tokens (novos:<day>:<session> keys).`)
  const spendLines = formatSpend(snapshot.spend)
  if (spendLines.length) lines.push('Per-task spend:', ...spendLines)
  else lines.push('No per-task spend has been recorded yet.')
  return lines.join('\n')
}

export function formatSpend(spend) {
  if (!spend || typeof spend !== 'object') return []
  const lines = []
  for (const [task, tiers] of Object.entries(spend)) {
    const parts = []
    for (const tier of TIERS) {
      const amount = Number(tiers?.[tier]) || 0
      if (amount > 0) parts.push(`${tier} ${amount}`)
    }
    if (parts.length) lines.push(`${task}: ${parts.join(', ')} fresh tokens`)
  }
  return lines
}

export function formatTaskSpend(task, tiers) {
  const line = formatSpend({ [task]: tiers })[0]
  if (!line) return ''
  return `cc-tiers spend for ${line} (input + cache write + output; cache reads excluded, same as cc-cost).`
}

export function emptyState(sessionId) {
  return { session_id: sessionId, seen: [], tasks: {}, spend: {} }
}

export function sessionPath(dataDir, sessionId) {
  const safe = String(sessionId || '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'unknown'
  return path.join(dataDir, `session-${safe}.json`)
}

export function loadState(file, sessionId) {
  if (!file || !existsSync(file)) return emptyState(sessionId)
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (!data || typeof data !== 'object' || !data.tasks || typeof data.tasks !== 'object') return emptyState(sessionId)
    if (!Array.isArray(data.seen)) data.seen = []
    if (!data.spend || typeof data.spend !== 'object') data.spend = {}
    data.session_id = sessionId
    return data
  } catch {
    return emptyState(sessionId)
  }
}

export function saveState(file, state) {
  mkdirSync(path.dirname(file), { recursive: true })
  const body = `${JSON.stringify(state, null, 2)}\n`
  writeFileSync(file, body)
  writeFileSync(path.join(path.dirname(file), 'latest.json'), body)
  pruneSessions(path.dirname(file))
}

function pruneSessions(dataDir) {
  const files = readdirSync(dataDir)
    .filter((name) => name.startsWith('session-') && name.endsWith('.json'))
    .map((name) => path.join(dataDir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  for (const stale of files.slice(20)) {
    try {
      unlinkSync(stale)
    } catch {
      // A locked session file can wait until the next write.
    }
  }
}

export function parseHeaders(text) {
  const found = {}
  for (const line of String(text || '').split(/\n/)) {
    const match = HEADER_RE.exec(line.trim())
    if (match) found[match[1]] = match[2].trim()
  }
  return found
}

export function matchRole(subagentType) {
  if (!subagentType) return null
  const base = String(subagentType).split(':').pop().trim().toLowerCase()
  return base in ROLES ? base : null
}

function contentText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block
        if (block && typeof block === 'object' && typeof block.text === 'string') return block.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content && typeof content === 'object' && typeof content.text === 'string') return content.text
  return ''
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null
  const event = String(raw.hook_event_name || '')
  if (event !== 'PostToolUse' && event !== 'PostToolUseFailure') return null
  if (raw.tool_name != null && raw.tool_name !== '' && raw.tool_name !== 'Agent') return null
  if (raw.is_interrupt === true) return null

  const toolInput = raw.tool_input && typeof raw.tool_input === 'object' ? raw.tool_input : {}
  const role = matchRole(String(toolInput.subagent_type || ''))
  if (!role) return null
  const prompt = String(toolInput.prompt || '')
  if (event === 'PostToolUseFailure') {
    return {
      kind: 'error',
      tool_use_id: String(raw.tool_use_id || ''),
      session_id: String(raw.session_id || 'unknown'),
      role,
      prompt,
      text: '',
      error: String(raw.error || 'subagent error').slice(0, MAX_REASON),
    }
  }
  const response = raw.tool_response
  if (response && typeof response === 'object' && response.status === 'async_launched') {
    return {
      kind: 'background',
      tool_use_id: String(raw.tool_use_id || ''),
      session_id: String(raw.session_id || 'unknown'),
      role,
    }
  }
  const content = response && typeof response === 'object' ? response.content : response
  return {
    kind: 'report',
    tool_use_id: String(raw.tool_use_id || ''),
    session_id: String(raw.session_id || 'unknown'),
    role,
    prompt,
    text: contentText(content),
    error: '',
  }
}

function emptyMeta(event) {
  return {
    haikuFailure: false,
    task: '',
    tier: '',
    role: event.role,
    reason: '',
    prompt: event.prompt || '',
  }
}

export function applyEvent(state, event, routing) {
  const meta = emptyMeta(event)
  if (event.kind === 'background') {
    return {
      state,
      meta,
      message:
        `${SCOPED[event.role]} moved to the background before it reported. ` +
        'cc-tiers counts a failure only from a finished foreground report. ' +
        'Wait for the report, then apply the attempt rule yourself if no count arrives.',
    }
  }

  const seen = [...(state.seen || [])]
  const toolUseId = event.tool_use_id || ''
  if (toolUseId && seen.includes(toolUseId)) return { state, message: '', meta }
  if (toolUseId) {
    seen.push(toolUseId)
    state.seen = seen.slice(-200)
  }

  const headers = parseHeaders(event.prompt || '')
  Object.assign(headers, parseHeaders(event.text || ''))
  const task = slug(headers.TASK || '')
  meta.task = task
  meta.prompt = event.prompt || ''
  if (!task) {
    return {
      state,
      meta,
      message:
        `${SCOPED[event.role]} finished without a CC_TIERS_TASK slug. ` +
        'cc-tiers did not count an attempt. The orchestrator counts a crashed or untagged run as a failure.',
    }
  }

  const role = event.role
  let tier = (headers.TIER || '').toLowerCase()
  const defaultTier = role === 'checker' ? 'haiku' : role === 'reviewer' ? 'sonnet' : ROLES[role]
  if (!TIERS.includes(tier)) tier = defaultTier
  if (!REVIEW_ROLES.has(role)) tier = ROLES[role]
  meta.tier = tier

  let status = (headers.STATUS || '').toLowerCase()
  if (event.kind === 'error') status = 'fail'
  if (status !== 'pass' && status !== 'fail') {
    return {
      state,
      meta,
      message:
        `Task ${task} on ${SCOPED[role]} finished without CC_TIERS_STATUS pass or fail. ` +
        'cc-tiers did not count an attempt.',
    }
  }

  let reason = headers.REASON || event.error || 'no reason given'
  reason = reason.split(/\s+/).filter(Boolean).join(' ').slice(0, MAX_REASON)
  meta.reason = reason
  const review = (headers.REVIEW || '').toLowerCase()
  const tasks = state.tasks || (state.tasks = {})
  let current = tasks[task]
  if (!current || typeof current !== 'object') current = { tier, failures: [], carried: [] }

  let message
  if (REVIEW_ROLES.has(role)) {
    const applied = applyReview(tasks, task, current, tier, status, reason, routing, role)
    message = applied.message
    meta.haikuFailure = applied.haikuFailure
  } else if (status === 'pass' && review === 'skip') {
    delete tasks[task]
    message = `Task ${task} passed on ${tier} and review was skipped. cc-tiers cleared its attempt counter.`
  } else if (status === 'pass') {
    const next = selectReviewer({
      policy: routing.reviewPolicy,
      writerTier: tier,
      risky: isRisky(`${event.prompt || ''}\n${event.text || ''}`, routing),
      conserve: routing.conserve === true,
    })
    if (next == null) {
      delete tasks[task]
      message = `Task ${task} passed on ${tier}. Review policy is ${routing.reviewPolicy} and no review is due. cc-tiers cleared its attempt counter.`
    } else {
      current.tier = tier
      tasks[task] = current
      const who = next === 'checker' ? 'cc-tiers:checker (Sonnet)' : 'cc-tiers:reviewer (Opus)'
      message =
        `Task ${task} passed on ${tier}. Review policy is ${routing.reviewPolicy}. ` +
        `Send the result to ${who}. The attempt counter stays until that review passes, or until a later report sets CC_TIERS_REVIEW: skip.`
    }
  } else {
    const applied = applyFailure(tasks, task, current, tier, role, reason, routing)
    message = applied.message
    meta.haikuFailure = applied.haikuFailure
  }
  return { state, message, meta }
}

function applyReview(tasks, task, current, tier, status, reason, routing, role) {
  if (status === 'pass') {
    delete tasks[task]
    const who = role === 'checker' ? 'Sonnet' : 'Opus'
    return { message: `Task ${task} passed ${who} review. cc-tiers cleared its attempt counter.`, haikuFailure: false }
  }
  current.tier = tier
  return applyFailure(tasks, task, current, tier, role, reason, routing)
}

function applyFailure(tasks, task, current, tier, role, reason, routing) {
  if (current.tier !== tier) current = { tier, failures: [], carried: [...(current.carried || [])] }
  const failures = [...(current.failures || [])]
  failures.push(`${tier}/${role}: ${reason}`)
  current.failures = failures
  current.tier = tier
  const maxAttempts = Number(routing.maxAttempts)
  const carried = [...(current.carried || [])]
  const history = [...carried, ...failures]
  const haikuFailure = tier === 'haiku'

  if (failures.length < maxAttempts) {
    tasks[task] = current
    return {
      haikuFailure,
      message: formatCount(
        task,
        tier,
        failures.length,
        maxAttempts,
        `Retry on ${tier} (${SCOPED[IMPLEMENTERS[tier]]}). Include the failure notes in the next prompt.`,
        history,
      ),
    }
  }

  const next = NEXT_TIER[tier]
  const carriedForward = [...carried, ...failures].slice(-MAX_CARRIED)
  if (next == null) {
    tasks[task] = { tier, failures, carried }
    return {
      haikuFailure,
      message: formatCount(
        task,
        tier,
        failures.length,
        maxAttempts,
        'Opus is the last tier. Stop and report these notes to the user.',
        history,
      ),
    }
  }
  tasks[task] = { tier: next, failures: [], carried: carriedForward }
  return {
    haikuFailure,
    message: formatCount(
      task,
      tier,
      failures.length,
      maxAttempts,
      `The next tier is ${next} (${SCOPED[IMPLEMENTERS[next]]}). ` +
        'Pass the failure notes in the delegation prompt. The new tier starts at zero failures.',
      history,
    ),
  }
}

function formatCount(task, tier, count, maximum, decision, history) {
  const lines = [
    `cc-tiers counted a failure for ${task}.`,
    `Tier ${tier} has ${count} failure(s); max attempts is ${maximum}.`,
    decision,
    'Failure notes:',
  ]
  history.slice(-MAX_CARRIED).forEach((note, index) => lines.push(`${index + 1}. ${note}`))
  return lines.join('\n')
}

export function hookOutput(eventName, text) {
  return { hookSpecificOutput: { hookEventName: eventName, additionalContext: text } }
}

export function readProjectFile(projectDir) {
  if (!projectDir) return { project: null, note: 'not checked' }
  const file = path.join(projectDir, '.claude', 'cc-tiers.json')
  if (!existsSync(file)) return { project: null, note: 'not present' }
  try {
    return { project: loadJson(file), note: file }
  } catch (error) {
    return { project: null, note: `present but ignored (${error.name || 'Error'})` }
  }
}

export function historyPath(projectDir) {
  return path.join(projectDir, '.claude', HISTORY_BASENAME)
}

export function loadHistory(file) {
  if (!file || !existsSync(file)) return emptyHistory()
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (!data || typeof data !== 'object' || !Array.isArray(data.entries)) return emptyHistory()
    return { version: 1, entries: data.entries }
  } catch {
    return emptyHistory()
  }
}

export function saveHistory(file, history) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(history, null, 2)}\n`)
}

export function ensureHistoryGitignore(projectDir) {
  const gitignore = path.join(projectDir, '.gitignore')
  const hasGit = existsSync(path.join(projectDir, '.git'))
  if (!existsSync(gitignore)) {
    if (!hasGit) return false
    writeFileSync(gitignore, `# cc-tiers learns Haiku failures locally\n${HISTORY_IGNORE}\n`)
    return true
  }
  const text = readFileSync(gitignore, 'utf8')
  if (text.includes(HISTORY_IGNORE)) return false
  const suffix = text.endsWith('\n') || text.length === 0 ? '' : '\n'
  writeFileSync(gitignore, `${text}${suffix}# cc-tiers learns Haiku failures locally\n${HISTORY_IGNORE}\n`)
  return true
}

/** cc-cost fresh tokens: cache reads stay out, because they resend the same context. */
export function freshTokens(usage) {
  if (!usage || typeof usage !== 'object') return 0
  const num = (value) => {
    const number = Number(value ?? 0)
    return Number.isFinite(number) && number > 0 ? number : 0
  }
  const total =
    num(usage.input_tokens ?? usage.input) +
    num(usage.cache_creation_input_tokens ?? usage.cacheWrite ?? usage.cache_creation) +
    num(usage.output_tokens ?? usage.output)
  return Math.round(total)
}

export function tierOfModel(model) {
  const id = String(model || '').toLowerCase()
  if (id.includes('haiku')) return 'haiku'
  if (id.includes('sonnet')) return 'sonnet'
  if (id.includes('opus')) return 'opus'
  return null
}

function resetMs(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  const text = String(value).trim()
  if (/^\d+(\.\d+)?$/.test(text)) {
    const number = Number(text)
    return number < 1e12 ? number * 1000 : number
  }
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : null
}

function percentValue(entry, now) {
  if (entry == null) return null
  if (typeof entry === 'number') return Math.min(100, Math.max(0, entry))
  if (typeof entry !== 'object') return null
  const reset = resetMs(entry.resetsAt ?? entry.resets_at)
  if (reset != null && reset <= now) return 0
  const raw = entry.percentUsed ?? entry.used_percentage ?? entry.percent
  if (raw == null || raw === '') return null
  const number = Number(raw)
  if (!Number.isFinite(number)) return null
  return Math.min(100, Math.max(0, number))
}

/** Accept cc-cost's `{ kind, percentUsed }` list and the status-line `rate_limits` shape. */
export function parseLimits(raw, now = Date.now()) {
  const result = { fiveHour: null, sevenDay: null }
  if (!raw || typeof raw !== 'object') return result
  const apply = (kind, entry) => {
    const key = kind === 'five_hour' || kind === '5h' ? 'fiveHour' : kind === 'seven_day' || kind === '7d' ? 'sevenDay' : null
    if (!key) return
    const percent = percentValue(entry, now)
    if (percent != null) result[key] = percent
  }
  const fromArray = (list) => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (item && typeof item === 'object') apply(String(item.kind || ''), item)
    }
  }
  const fromMap = (map) => {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return
    for (const [kind, entry] of Object.entries(map)) apply(kind, entry)
  }
  if (Array.isArray(raw)) fromArray(raw)
  fromArray(raw.rateLimits)
  fromArray(raw.limits)
  fromMap(raw.rate_limits)
  if (raw.rateLimits && !Array.isArray(raw.rateLimits)) fromMap(raw.rateLimits)
  if (raw.spend && typeof raw.spend === 'object') {
    const nested = parseLimits(raw.spend, now)
    if (nested.fiveHour != null) result.fiveHour = nested.fiveHour
    if (nested.sevenDay != null) result.sevenDay = nested.sevenDay
  }
  return result
}

export function budgetDecision(limits, routing) {
  const fiveHour = limits?.fiveHour ?? null
  const sevenDay = limits?.sevenDay ?? null
  const hits = []
  if (fiveHour != null && fiveHour >= routing.budget5h) hits.push(`5h ${fiveHour}%`)
  if (sevenDay != null && sevenDay >= routing.budget7d) hits.push(`7d ${sevenDay}%`)
  return { fiveHour, sevenDay, hits, conserve: hits.length > 0 }
}

export function manifestHasCcCost(data) {
  if (!data || typeof data !== 'object') return false
  const plugins = data.plugins ?? data
  if (Array.isArray(plugins)) {
    return plugins.some((plugin) => {
      const name = String(plugin?.name || plugin?.id || '')
      return name === 'cc-cost' || name.startsWith('cc-cost@')
    })
  }
  if (typeof plugins === 'object') {
    return Object.keys(plugins).some((key) => key === 'cc-cost' || key.startsWith('cc-cost@'))
  }
  return false
}

export function claudeDir(env = process.env) {
  if (env.CLAUDE_CONFIG_DIR) return env.CLAUDE_CONFIG_DIR
  if (env.HOME) return path.join(env.HOME, '.claude')
  return ''
}

export function findCcCost(env = process.env) {
  if (env.CC_TIERS_CC_COST === '0') return false
  if (env.CC_TIERS_CC_COST === '1') return true
  const file = env.CC_TIERS_PLUGINS_FILE || (claudeDir(env) ? path.join(claudeDir(env), 'plugins', 'installed_plugins.json') : '')
  if (!file || !existsSync(file)) return false
  try {
    return manifestHasCcCost(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return false
  }
}

function readJsonIfPresent(file) {
  if (!file || !existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function ccCostDataDir(env = process.env) {
  if (env.CC_TIERS_CC_COST_DATA) return env.CC_TIERS_CC_COST_DATA
  const root = claudeDir(env)
  return root ? path.join(root, 'plugins', 'data', 'cc-cost') : ''
}

/** Latest 5h/7d reading from the hook payload, the transcript, and cc-cost's data directory. */
export function collectLimits({ payload, transcript, env = process.env, now = Date.now() } = {}) {
  let best = { fiveHour: null, sevenDay: null }
  const take = (raw) => {
    const parsed = parseLimits(raw, now)
    if (parsed.fiveHour != null) best.fiveHour = parsed.fiveHour
    if (parsed.sevenDay != null) best.sevenDay = parsed.sevenDay
  }
  take(payload)
  if (transcript) {
    for (const line of String(transcript).split(/\n/)) {
      if (!line.trim()) continue
      try {
        take(JSON.parse(line))
      } catch {
        // Transcript lines that are not JSON are not usage records.
      }
    }
  }
  const explicit = env.CC_TIERS_LIMITS_FILE
  if (explicit) take(readJsonIfPresent(explicit))
  const dataDir = ccCostDataDir(env)
  if (dataDir && existsSync(dataDir)) {
    for (const name of ['limits.json', 'store.json', 'spend.json']) take(readJsonIfPresent(path.join(dataDir, name)))
  }
  return best
}

/** Sum cc-cost's `novos:<day>:<sessionId>` store keys for one local day. */
export function freshFromStore(store, day) {
  if (!store || typeof store !== 'object' || Array.isArray(store)) return null
  const prefix = `novos:${day}:`
  let total = 0
  let any = false
  for (const [key, value] of Object.entries(store)) {
    if (!key.startsWith(prefix)) continue
    const number = Number(value)
    if (!Number.isFinite(number)) continue
    total += number
    any = true
  }
  return any ? Math.round(total) : null
}

export function localDay(now = Date.now()) {
  const date = new Date(now)
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function readTodayTotal(env = process.env, now = Date.now()) {
  const dataDir = ccCostDataDir(env)
  if (!dataDir) return null
  const store = readJsonIfPresent(path.join(dataDir, 'store.json'))
  return freshFromStore(store, localDay(now))
}

function collectStrings(node, found) {
  if (typeof node === 'string') {
    found.push(node)
    return
  }
  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, found)
    return
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectStrings(value, found)
  }
}

function hasTokenFields(node) {
  return Boolean(
    node &&
      typeof node === 'object' &&
      (node.input_tokens != null || node.output_tokens != null || node.input != null || node.output != null),
  )
}

function collectUsages(node, found, inheritedModel) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) collectUsages(item, found, inheritedModel)
    return
  }
  const model = typeof node.model === 'string' ? node.model : inheritedModel
  if (node.usage && typeof node.usage === 'object' && hasTokenFields(node.usage)) {
    found.push({ model: node.usage.model || model, usage: node.usage })
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'usage') continue
    collectUsages(value, found, model)
  }
}

export function attributeTranscript(text) {
  const spend = {}
  let task = ''
  for (const line of String(text || '').split(/\n/)) {
    if (!line.trim()) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const strings = []
    collectStrings(row, strings)
    for (const value of strings) {
      const headers = parseHeaders(value)
      if (headers.TASK) task = slug(headers.TASK)
    }
    if (!task) continue
    const usages = []
    collectUsages(row, usages, null)
    for (const item of usages) {
      const tier = tierOfModel(item.model)
      const amount = freshTokens(item.usage)
      if (!tier || !amount) continue
      addSpend(spend, task, tier, amount)
    }
  }
  return spend
}

export function addSpend(spend, task, tier, amount) {
  if (!task || !TIERS.includes(tier) || !amount) return spend
  const current = spend[task] || { haiku: 0, sonnet: 0, opus: 0 }
  current[tier] = (Number(current[tier]) || 0) + amount
  spend[task] = current
  return spend
}

const ROLE_TIER = { worker: 'haiku', implementer: 'sonnet', reviewer: 'opus', checker: 'sonnet', orchestrator: 'opus' }

export function usageFromToolResponse(response, role) {
  if (!response || typeof response !== 'object' || !response.usage) return null
  const amount = freshTokens(response.usage)
  if (!amount) return null
  const tier = tierOfModel(response.usage.model || response.model) || ROLE_TIER[role] || null
  if (!tier) return null
  return { tier, tokens: amount }
}

export function mergeTranscriptSpend(state, transcriptSpend, extra) {
  const spend = {}
  for (const [task, tiers] of Object.entries(state.spend || {})) spend[task] = { ...tiers }
  if (transcriptSpend) {
    for (const [task, tiers] of Object.entries(transcriptSpend)) {
      spend[task] = { haiku: 0, sonnet: 0, opus: 0, ...tiers }
    }
  }
  if (extra?.task && extra.tier && extra.tokens && !transcriptSpend?.[extra.task]?.[extra.tier]) {
    addSpend(spend, extra.task, extra.tier, extra.tokens)
  }
  state.spend = spend
  return state
}

export function userFromEnv(env = process.env) {
  return {
    max_attempts: env.CLAUDE_PLUGIN_OPTION_MAX_ATTEMPTS || null,
    review_policy: env.CLAUDE_PLUGIN_OPTION_REVIEW_POLICY || null,
    trivial_extra: env.CLAUDE_PLUGIN_OPTION_TRIVIAL_EXTRA || '',
    risky_extra: env.CLAUDE_PLUGIN_OPTION_RISKY_EXTRA || '',
    learn: env.CLAUDE_PLUGIN_OPTION_LEARN || null,
    budget_5h: env.CLAUDE_PLUGIN_OPTION_BUDGET_5H || null,
    budget_7d: env.CLAUDE_PLUGIN_OPTION_BUDGET_7D || null,
  }
}

export function pluginRoot(env = process.env) {
  if (env.CLAUDE_PLUGIN_ROOT) return env.CLAUDE_PLUGIN_ROOT
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
}

export function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

export function parsePayload(raw) {
  if (!String(raw || '').trim()) return {}
  try {
    const data = JSON.parse(raw)
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

export function readTranscript(file) {
  if (!file || !existsSync(file)) return ''
  try {
    const stat = statSync(file)
    const cap = 2_000_000
    if (stat.size <= cap) return readFileSync(file, 'utf8')
    const fd = readFileSync(file)
    return fd.subarray(fd.length - cap).toString('utf8')
  } catch {
    return ''
  }
}
