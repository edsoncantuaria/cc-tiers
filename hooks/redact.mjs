/**
 * Secret scrubbing for everything cc-tiers persists outside the session state:
 * telemetry events and the engineering memory. A pattern list, not a guarantee.
 */

const PATTERNS = [
  // PEM private keys, whole block.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  // Provider tokens with a known prefix.
  /\b(?:sk|pk|rk)[-_](?:ant-|proj-|live_|test_|live-|test-)?[A-Za-z0-9_-]{16,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
  /\bhttps:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  // Credentials inside a URL: scheme://user:pass@host.
  /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s/@]+@/gi,
  // Authorization and cookie headers.
  /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/g,
  /\b((?:Set-)?Cookie)(\s*:\s*)[^\r\n]+/gi,
  // CLI flags that carry a secret: --password x, --token=x.
  /(--(?:password|passwd|token|api-key|apikey|secret|client-secret))([=\s]+)(?:"[^"]*"|'[^']*'|\S+)/gi,
  // key=value or key: value where the key names a secret.
  // A JSON key keeps its closing quote: "password": "x".
  /\b([A-Za-z0-9_.-]*(?:password|passwd|senha|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|credential)[A-Za-z0-9_.-]*["']?)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
  // E-mail addresses are personal data.
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
]

/** The text with every match replaced by [redacted]; keys of key=value pairs and URL schemes stay readable. */
export function redact(text) {
  let out = String(text ?? '')
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, (match, first, second) => {
      if (typeof first === 'string' && first.includes('://')) return `${first}[redacted]@`
      if (typeof first === 'string' && typeof second === 'string') return `${first}${second}[redacted]`
      if (typeof first === 'string' && /^(Bearer|Basic|Token)$/.test(first)) return `${first} [redacted]`
      return '[redacted]'
    })
  }
  return out
}

/** One line of at most max characters, redacted. */
export function clip(text, max = 200) {
  const line = redact(text).split(/\s+/).filter(Boolean).join(' ')
  return line.length > max ? `${line.slice(0, Math.max(0, max - 1))}…` : line
}

/** True when redact would change the text. */
export function hasSecret(text) {
  return redact(text) !== String(text ?? '')
}
