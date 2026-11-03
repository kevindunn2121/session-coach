import type { Patch, PatchPlan, SettingsPatch } from '../types'

// The plugin writes only these changes itself. Hooks, allow rules and every other key
// go to Claude, so its permission prompt reviews them.
const ENV_NAMES = new Set([
  'MAX_THINKING_TOKENS',
  'MAX_MCP_OUTPUT_TOKENS',
  'BASH_DEFAULT_TIMEOUT_MS',
  'BASH_MAX_TIMEOUT_MS',
  'BASH_MAX_OUTPUT_LENGTH',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
])
const ENV_DISABLE = /^(CLAUDE_CODE_)?DISABLE_[A-Z0-9_]+$/
const ENV_VALUE = /^[\w.:-]{1,64}$/
const MODEL = /^[\w.[\]-]{1,64}$/
const RULE = /^[A-Za-z][\w-]*(\([^()\n]{1,200}\))?$/
const HEADING = /^#{1,4} \S.{0,80}$/
const MAX_LINES_CHARS = 2000
const SETTINGS_KEYS = new Set(['model', 'env', 'deny', 'ask'])

const CLAUDE_MD = /(^|\/)CLAUDE(\.local)?\.md$/
const SETTINGS_FILE = /(^|\/)\.claude\/settings(\.local)?\.json$/

export const PATCH_RULES =
  'patch is optional: set it only when the whole change is one of these two kinds, so the plugin can apply it in one click. claude-md-append adds lines to a CLAUDE.md or CLAUDE.local.md: target the file path, heading the existing or new markdown heading to put them under (empty for the end of the file), lines the exact lines. settings-merge changes a .claude/settings.json or .claude/settings.local.json: target the file path, set holds only model, env (only MAX_THINKING_TOKENS, MAX_MCP_OUTPUT_TOKENS, BASH_DEFAULT_TIMEOUT_MS, BASH_MAX_TIMEOUT_MS, BASH_MAX_OUTPUT_LENGTH, CLAUDE_CODE_MAX_OUTPUT_TOKENS or DISABLE_* names), deny and ask permission rules to add. Leave patch out for hooks, allow rules, skills, agents, MCP servers, new files and anything else: Claude makes those changes.'

export const PATCH_SCHEMA =
  '"patch":{"kind":"claude-md-append|settings-merge","target":"file path","heading":"## Heading, for claude-md-append","lines":"exact lines, for claude-md-append","set":{"model":"","env":{"NAME":"value"},"deny":["Tool(spec)"],"ask":["Tool(spec)"]}}'

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const slashes = (path: string): string => path.replace(/\\/g, '/')

const isSafePath = (path: string): boolean => path !== '' && !slashes(path).split('/').includes('..')

const rules = (value: unknown): string[] | undefined => {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const list = value.map(asString)
  return list.every(rule => RULE.test(rule)) ? list : undefined
}

const env = (value: unknown): Record<string, string> | undefined => {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [name, raw] of Object.entries(value)) {
    const text = typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : asString(raw)
    if (!(ENV_NAMES.has(name) || ENV_DISABLE.test(name)) || !ENV_VALUE.test(text)) return undefined
    out[name] = text
  }
  return out
}

const parseSettingsPatch = (value: unknown): SettingsPatch | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (Object.keys(raw).some(key => !SETTINGS_KEYS.has(key))) return undefined
  const model = asString(raw.model)
  const envs = env(raw.env)
  const deny = rules(raw.deny)
  const ask = rules(raw.ask)
  if ((raw.model !== undefined && !MODEL.test(model)) || !envs || !deny || !ask) return undefined
  const set: SettingsPatch = {
    ...(model ? { model } : {}),
    ...(Object.keys(envs).length > 0 ? { env: envs } : {}),
    ...(deny.length > 0 ? { deny } : {}),
    ...(ask.length > 0 ? { ask } : {}),
  }
  return Object.keys(set).length > 0 ? set : undefined
}

export const parsePatch = (value: unknown): Patch | undefined => {
  const raw = (value ?? {}) as Record<string, unknown>
  const target = slashes(asString(raw.target))
  if (!isSafePath(target)) return undefined
  switch (asString(raw.kind)) {
    case 'claude-md-append': {
      const lines = typeof raw.lines === 'string' ? raw.lines.replace(/\r\n/g, '\n').replace(/^\n+|\s+$/g, '') : ''
      const heading = asString(raw.heading)
      if (!CLAUDE_MD.test(target) || lines === '' || lines.length > MAX_LINES_CHARS) return undefined
      return { kind: 'claude-md-append', target, heading: HEADING.test(heading) ? heading : '', lines }
    }
    case 'settings-merge': {
      const set = parseSettingsPatch(raw.set)
      return SETTINGS_FILE.test(target) && set ? { kind: 'settings-merge', target, set } : undefined
    }
    default:
      return undefined
  }
}

export const resolveTarget = (target: string, home: string, cwd: string): string => {
  const path = slashes(target)
  if (path === '~' || path.startsWith('~/')) return `${slashes(home).replace(/\/+$/, '')}${path.slice(1)}`
  if (path.startsWith('/') || /^[A-Za-z]:\//.test(path)) return path
  return `${slashes(cwd).replace(/\/+$/, '')}/${path.replace(/^\.\//, '')}`
}

export const backupPath = (home: string, id: string, target: string, at: number): string =>
  `${slashes(home).replace(/\/+$/, '')}/.claude/session-coach/backups/${id}-${new Date(at).toISOString().replace(/[:.]/g, '-')}-${slashes(target).split('/').pop()}`

// Every plan and diff splits and joins through these two, so a file keeps its line ending
// and its final newline. A new file gets a final newline.
type Lines = { lines: string[]; eol: string; hasFinalNewline: boolean }

const toLines = (text: string): Lines => ({
  lines: text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/),
  eol: text.includes('\r\n') ? '\r\n' : '\n',
  hasFinalNewline: text === '' || text.endsWith('\n'),
})

const fromLines = ({ lines, eol, hasFinalNewline }: Lines): string => `${lines.join(eol)}${hasFinalNewline && lines.length > 0 ? eol : ''}`

const headingLevel = (line: string): number => line.match(/^(#{1,6}) /)?.[1]?.length ?? 0

const planClaudeMd = (current: string, patch: Extract<Patch, { kind: 'claude-md-append' }>): PatchPlan => {
  const text = toLines(current)
  const { lines } = text
  const adding = patch.lines.split('\n')
  const present = new Set(lines.map(line => line.trim()))
  if (adding.every(line => line.trim() === '' || present.has(line.trim()))) return { isChanged: false, before: current, after: current }

  const at = patch.heading ? lines.findIndex(line => line.trim() === patch.heading) : -1
  if (at >= 0) {
    const level = headingLevel(patch.heading)
    let end = lines.findIndex((line, i) => i > at && headingLevel(line) > 0 && headingLevel(line) <= level)
    if (end < 0) end = lines.length
    let insert = end
    while (insert - 1 > at && lines[insert - 1]!.trim() === '') insert--
    const gap = insert === at + 1 ? [''] : []
    const tail = insert === end && end < lines.length ? [''] : []
    return { isChanged: true, before: current, after: fromLines({ ...text, lines: [...lines.slice(0, insert), ...gap, ...adding, ...tail, ...lines.slice(insert)] }) }
  }

  let last = lines.length
  while (last > 0 && lines[last - 1]!.trim() === '') last--
  const base = lines.slice(0, last)
  const block = [...(base.length > 0 ? [''] : []), ...(patch.heading ? [patch.heading, ''] : []), ...adding]
  return { isChanged: true, before: current, after: fromLines({ ...text, lines: [...base, ...block] }) }
}

const union = (list: unknown, add: string[] | undefined): string[] | undefined => {
  const existing = Array.isArray(list) ? list.filter((rule): rule is string => typeof rule === 'string') : []
  const merged = [...new Set([...existing, ...(add ?? [])])]
  return merged.length > 0 ? merged : undefined
}

const planSettings = (current: string, patch: Extract<Patch, { kind: 'settings-merge' }>): PatchPlan => {
  let parsed: unknown
  try {
    parsed = current.trim() === '' ? {} : JSON.parse(current)
  } catch {
    return { error: `${patch.target} is not valid JSON, so the plugin will not rewrite it.` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { error: `${patch.target} does not hold a settings object.` }

  const settings = structuredClone(parsed) as Record<string, unknown>
  const { model, env: envs, deny, ask } = patch.set
  if (model) settings.model = model
  if (envs) settings.env = { ...((settings.env ?? {}) as Record<string, unknown>), ...envs }
  if (deny || ask) {
    const permissions = { ...((settings.permissions ?? {}) as Record<string, unknown>) }
    const denied = union(permissions.deny, deny)
    const asked = union(permissions.ask, ask)
    if (denied) permissions.deny = denied
    if (asked) permissions.ask = asked
    settings.permissions = permissions
  }
  if (JSON.stringify(settings) === JSON.stringify(parsed)) return { isChanged: false, before: current, after: current }

  const indent = current.match(/\n([ \t]+)"/)?.[1] ?? '  '
  return { isChanged: true, before: current, after: fromLines({ ...toLines(current), lines: JSON.stringify(settings, null, indent).split('\n') }) }
}

// `current` is the file's text, or undefined when it does not exist yet.
export const planPatch = (current: string | undefined, patch: Patch): PatchPlan =>
  patch.kind === 'claude-md-append' ? planClaudeMd(current ?? '', patch) : planSettings(current ?? '', patch)

// What Undo writes back. The plugin cannot delete files, so a file it created goes back to empty.
export const restoreText = (patch: Patch, before: string | undefined): string =>
  before !== undefined ? before : patch.kind === 'settings-merge' ? '{}\n' : ''

const lcs = (a: string[], b: string[]): string[] => {
  const rows = a.length + 1
  const cols = b.length + 1
  const table = new Uint32Array(rows * cols)
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * cols + j] = a[i] === b[j] ? table[(i + 1) * cols + j + 1]! + 1 : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!)
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push(`  ${a[i]}`)
      i++
      j++
    } else if (i < a.length && (j === b.length || table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!)) out.push(`- ${a[i++]}`)
    else out.push(`+ ${b[j++]}`)
  }
  return out
}

export const diffLines = (before: string, after: string, context = 2): string => {
  const a = toLines(before).lines
  const b = toLines(after).lines
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const lines = [...a.slice(0, head).map(line => `  ${line}`), ...lcs(a.slice(head, a.length - tail), b.slice(head, b.length - tail)), ...a.slice(a.length - tail).map(line => `  ${line}`)]

  const keep = lines.map((line, i) => lines.slice(Math.max(0, i - context), i + context + 1).some(near => !near.startsWith('  ')))
  return lines
    .flatMap((line, i) => (keep[i] ? [line] : i > 0 && keep[i - 1] ? ['…'] : []))
    .join('\n')
}
