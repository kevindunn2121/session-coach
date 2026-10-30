import type { Fix, FixKind, FixWhen } from '../types'

const FIX_KINDS: readonly FixKind[] = ['prompt', 'claude-md', 'settings', 'file', 'command', 'action']
const FIX_WHENS: readonly FixWhen[] = ['btw', 'steer', 'next', 'interrupt', 'later']

const DEFAULT_WHEN: Record<FixKind, FixWhen> = {
  prompt: 'next',
  'claude-md': 'later',
  settings: 'later',
  file: 'later',
  command: 'next',
  action: 'next',
}

export const WHEN_TEXT: Record<FixWhen, string> = {
  btw: 'Now, while Claude keeps working. It goes in as a /btw side question, so Claude answers without changing its task.',
  steer: 'Now, while Claude is working. Press Enter and Claude reads it before its next step.',
  next: 'After Claude finishes this turn, as your next prompt.',
  interrupt: 'Stop first. Press Esc to stop Claude, then send this instead, because continuing wastes work.',
  later: 'When Claude is idle, or after this session.',
}

export const FIX_TIMING_RULES =
  'Set when for each fix: btw for a side question that must not change the current task (it is sent as /btw), steer for a small correction Claude should apply while it keeps working, next for work after the current turn finishes, interrupt when Claude is going the wrong way and continuing wastes work (the developer presses Esc first), later for CLAUDE.md, settings or other global changes that take effect in a new session.'

export const whenOf = (fix: Fix): FixWhen => fix.when ?? DEFAULT_WHEN[fix.kind]

const parseWhen = (value: unknown): FixWhen | undefined =>
  FIX_WHENS.includes(value as FixWhen) ? (value as FixWhen) : undefined

const DEFAULT_TARGET: Partial<Record<FixKind, string>> = {
  'claude-md': '~/.claude/CLAUDE.md',
  settings: '~/.claude/settings.json',
}

const DEFAULT_THEN: Partial<Record<FixKind, string>> = {
  'claude-md': 'Start a new Claude session so it loads the change.',
  settings: 'Start a new Claude session. If Claude asks, approve the new hook in /hooks.',
}

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export const parseFix = (value: unknown): Fix | undefined => {
  const raw = (value ?? {}) as Record<string, unknown>
  const kind = asString(raw.kind) as FixKind
  const text = asString(raw.text)
  if (!FIX_KINDS.includes(kind) || text === '') return undefined
  const target = asString(raw.target)
  const then = asString(raw.then)
  const when = parseWhen(asString(raw.when))
  return { kind, text, ...(target ? { target } : {}), ...(then ? { then } : {}), ...(when ? { when } : {}) }
}

const targetOf = (fix: Fix): string => fix.target ?? DEFAULT_TARGET[fix.kind] ?? ''

const thenOf = (fix: Fix): string => fix.then ?? DEFAULT_THEN[fix.kind] ?? ''

const fence = (text: string): string[] => ['```text', text, '```']

const PROMPT_LEAD: Record<FixWhen, string> = {
  btw: 'Ask this on the side:',
  steer: 'Send this while Claude works:',
  next: 'Add this to your next prompt:',
  interrupt: 'Stop Claude, then send this:',
  later: 'Send this to Claude:',
}

const LEAD: Record<FixKind, (fix: Fix) => string> = {
  prompt: fix => PROMPT_LEAD[whenOf(fix)],
  'claude-md': fix => `Update \`${targetOf(fix)}\` with:`,
  settings: fix => `Update \`${targetOf(fix)}\` with:`,
  file: fix => `Edit \`${targetOf(fix) || 'the file'}\`:`,
  command: () => 'Run this in Claude:',
  action: () => 'Do this:',
}

export const fixMarkdown = (fix: Fix, label = 'How to fix'): string => {
  const then = thenOf(fix)
  return [
    `**${label}:** ${LEAD[fix.kind](fix)}`,
    ...fence(fixPromptText(fix, true)),
    `**When:** ${WHEN_TEXT[whenOf(fix)]}`,
    ...(then ? [`Then: ${then}`] : []),
  ].join('\n')
}

export const fixCopyText = (fix: Fix): string => {
  const then = thenOf(fix)
  const lead = fix.kind === 'prompt' || fix.kind === 'command' ? '' : `${LEAD[fix.kind](fix).replace(/`/g, '')}\n`
  return `${lead}${fix.text}${then ? `\n\nThen: ${then}` : ''}`
}

export const fixPromptText = (fix: Fix, isDisplay = false): string => {
  switch (fix.kind) {
    case 'prompt':
      return whenOf(fix) === 'btw' && !fix.text.startsWith('/btw') ? `/btw ${fix.text}` : fix.text
    case 'command':
      return fix.text
    case 'claude-md':
    case 'settings':
    case 'file':
      return isDisplay ? fix.text : `Add this to ${targetOf(fix) || 'the file'}. Show me the diff before writing.\n\n${fix.text}`
    case 'action':
      return fix.text
  }
}

export const FIX_SCHEMA =
  '"fix":{"kind":"prompt|claude-md|settings|file|command|action","target":"file path, for claude-md, settings or file","text":"the exact text to paste, add or run","when":"btw|steer|next|interrupt|later","then":"what to do next, such as start a new session"}'

export type PromptedMessage = { label: string; when: FixWhen; isWorking: boolean }

export const promptedMessage = ({ label, when, isWorking }: PromptedMessage): string => {
  const lead = `${label} is in your prompt box.`
  if (!isWorking) return when === 'later' ? `${lead} Press Enter to make the change, then start a new session for it to take effect.` : `${lead} Press Enter to send it.`
  switch (when) {
    case 'btw':
      return `${lead} Press Enter now. Claude answers on the side and keeps working on its task.`
    case 'steer':
      return `${lead} Press Enter now. Claude reads it before its next step.`
    case 'next':
      return `${lead} Wait until Claude finishes this turn, then press Enter.`
    case 'interrupt':
      return `${lead} Press Esc to stop Claude, then press Enter to send it.`
    case 'later':
      return `${lead} Wait until Claude finishes, then press Enter. Start a new session afterwards for the change to take effect.`
  }
}
