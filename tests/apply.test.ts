import { expect, test } from 'claude-code/testing'

import { backupPath, diffLines, parsePatch, planPatch, resolveTarget, restoreText } from '../hooks/apply'
import { emptyMetrics } from '../hooks/metrics'
import { auditPrompt, measure, parseRecommendations } from '../hooks/setup'
import type { Patch } from '../types'

const SAFETY = { kind: 'claude-md-append', target: '~/.claude/CLAUDE.md', heading: '## Safety', lines: '- Ask before writing outside DEV_.' }

test('patches parse only for CLAUDE.md lines and the safe settings keys', async () => {
  expect(parsePatch(SAFETY)).toEqual(SAFETY)
  expect(parsePatch({ ...SAFETY, heading: 'not a heading' })).toEqual({ ...SAFETY, heading: '' })
  expect(parsePatch({ ...SAFETY, target: 'C:\\Users\\kevin\\.claude\\CLAUDE.local.md' })?.target).toBe('C:/Users/kevin/.claude/CLAUDE.local.md')
  expect(parsePatch({ ...SAFETY, target: 'README.md' })).toBeUndefined()
  expect(parsePatch({ ...SAFETY, target: '../other/CLAUDE.md' })).toBeUndefined()
  expect(parsePatch({ ...SAFETY, lines: '  ' })).toBeUndefined()
  expect(parsePatch({ kind: 'file', target: 'CLAUDE.md', lines: 'x' })).toBeUndefined()

  const settings = { kind: 'settings-merge', target: '.claude/settings.json' }
  expect(parsePatch({ ...settings, set: { model: 'opus', env: { MAX_THINKING_TOKENS: 8000, DISABLE_TELEMETRY: '1' }, deny: ['Bash(snow sql:*)'], ask: ['Bash(git push:*)'] } })).toEqual({
    ...settings,
    set: { model: 'opus', env: { MAX_THINKING_TOKENS: '8000', DISABLE_TELEMETRY: '1' }, deny: ['Bash(snow sql:*)'], ask: ['Bash(git push:*)'] },
  })
  expect(parsePatch({ ...settings, set: { hooks: { PostToolUse: [] } } })).toBeUndefined()
  expect(parsePatch({ ...settings, set: { allow: ['Bash(*)'] } })).toBeUndefined()
  expect(parsePatch({ ...settings, set: { permissions: { deny: ['Read(.env)'] } } })).toBeUndefined()
  expect(parsePatch({ ...settings, set: { env: { ANTHROPIC_BASE_URL: 'https://example.com' } } })).toBeUndefined()
  expect(parsePatch({ ...settings, set: { env: { BASH_ENV: '/tmp/x.sh' } } })).toBeUndefined()
  expect(parsePatch({ ...settings, set: { deny: ['Bash(echo $(whoami))'] } })).toBeUndefined()
  expect(parsePatch({ ...settings, set: {} })).toBeUndefined()
  expect(parsePatch({ ...settings, target: '/Users/kevin/settings.json', set: { model: 'opus' } })).toBeUndefined()
})

test('CLAUDE.md lines go under their heading, or a new one, once', async () => {
  const patch = parsePatch(SAFETY) as Extract<Patch, { kind: 'claude-md-append' }>
  const current = '# Rules\n\n## Safety\n- Never use prod.\n\n## Git\n- Branch first.\n'
  const plan = planPatch(current, patch)
  expect(plan).toEqual({ isChanged: true, before: current, after: '# Rules\n\n## Safety\n- Never use prod.\n- Ask before writing outside DEV_.\n\n## Git\n- Branch first.\n' })
  if ('error' in plan) throw new Error(plan.error)
  expect(planPatch(plan.after, patch)).toEqual({ isChanged: false, before: plan.after, after: plan.after })

  expect(planPatch('## Safety\n- a\n', patch)).toMatchObject({ after: '## Safety\n- a\n- Ask before writing outside DEV_.\n' })
  expect(planPatch('## Safety\n## Git\n', patch)).toMatchObject({ after: '## Safety\n\n- Ask before writing outside DEV_.\n\n## Git\n' })
  expect(planPatch('# Rules\n- x\n', patch)).toMatchObject({ after: '# Rules\n- x\n\n## Safety\n\n- Ask before writing outside DEV_.\n' })
  expect(planPatch(undefined, patch)).toMatchObject({ before: '', after: '## Safety\n\n- Ask before writing outside DEV_.\n' })
  expect(planPatch('# R\r\n- x\r\n', { ...patch, heading: '', lines: '- y\n- z' })).toMatchObject({ after: '# R\r\n- x\r\n\r\n- y\r\n- z\r\n' })
})

test('settings merge keeps existing keys, rules and indentation', async () => {
  const patch = parsePatch({ kind: 'settings-merge', target: '~/.claude/settings.json', set: { deny: ['Read(.env)', 'Bash(snow sql:*)'], env: { MAX_THINKING_TOKENS: '8000' } } })!
  const current = '{\n    "model": "opus",\n    "permissions": {\n        "allow": ["Bash(ls)"],\n        "deny": ["Read(.env)"]\n    }\n}\n'
  const plan = planPatch(current, patch)
  if ('error' in plan) throw new Error(plan.error)
  expect(plan.isChanged).toBe(true)
  expect(plan.after.startsWith('{\n    "model": "opus",\n    "permissions": {\n        "allow": [\n            "Bash(ls)"')).toBe(true)
  expect(JSON.parse(plan.after)).toEqual({ model: 'opus', permissions: { allow: ['Bash(ls)'], deny: ['Read(.env)', 'Bash(snow sql:*)'] }, env: { MAX_THINKING_TOKENS: '8000' } })
  expect(planPatch(plan.after, patch)).toMatchObject({ isChanged: false })

  expect(planPatch(undefined, patch)).toMatchObject({ after: '{\n  "env": {\n    "MAX_THINKING_TOKENS": "8000"\n  },\n  "permissions": {\n    "deny": [\n      "Read(.env)",\n      "Bash(snow sql:*)"\n    ]\n  }\n}\n' })
  expect(planPatch('{"model": "opus",}', patch)).toEqual({ error: '~/.claude/settings.json is not valid JSON, so the plugin will not rewrite it.' })
  expect(planPatch('[]', patch)).toEqual({ error: '~/.claude/settings.json does not hold a settings object.' })
})

test('targets resolve, backups get their own name, undo restores and the diff shows only what changed', async () => {
  expect(resolveTarget('~/.claude/CLAUDE.md', '/Users/kevin/', '/repo')).toBe('/Users/kevin/.claude/CLAUDE.md')
  expect(resolveTarget('./CLAUDE.md', '/Users/kevin', '/repo/')).toBe('/repo/CLAUDE.md')
  expect(resolveTarget('/etc/x/CLAUDE.md', '/Users/kevin', '/repo')).toBe('/etc/x/CLAUDE.md')
  expect(backupPath('/Users/kevin', 'deny-prod', '~/.claude/settings.json', Date.UTC(2026, 10, 3, 9, 30))).toBe('/Users/kevin/.claude/session-coach/backups/deny-prod-2026-11-03T09-30-00-000Z-settings.json')

  const settings = parsePatch({ kind: 'settings-merge', target: '.claude/settings.json', set: { model: 'opus' } }) as Patch
  expect(restoreText(settings, undefined)).toBe('{}\n')
  expect(restoreText(parsePatch(SAFETY)!, undefined)).toBe('')
  expect(restoreText(settings, '{"model":"haiku"}')).toBe('{"model":"haiku"}')

  expect(diffLines('a\nb\nc\nd\ne\nf\n', 'a\nb\nc\nd\nX\ne\nf\n', 1)).toBe('  d\n+ X\n  e\n…')
  expect(diffLines('', '- y\n')).toBe('+ - y')
  expect(diffLines('"model": "haiku"', '"model": "opus"')).toBe('- "model": "haiku"\n+ "model": "opus"')
})

test('the audit asks for patches and keeps only the safe ones', async () => {
  const snapshot = { instructions: [], settings: [], skills: [], agents: [], mcpServers: [] }
  expect(auditPrompt(snapshot, measure(snapshot, [], 0), emptyMetrics(0), 'playbook')).toContain('claude-md-append adds lines')

  const base = { title: 'T', applyPrompt: 'Do it.', area: 'settings' }
  const recs = parseRecommendations(JSON.stringify({
    recommendations: [
      { ...base, id: 'deny-prod', patch: { kind: 'settings-merge', target: '~/.claude/settings.json', set: { deny: ['Bash(snow sql:*)'] } } },
      { ...base, id: 'add-hook', patch: { kind: 'settings-merge', target: '~/.claude/settings.json', set: { hooks: { Stop: [] } } } },
    ],
  }))
  expect(recs.map(rec => [rec.id, rec.patch?.kind])).toEqual([['deny-prod', 'settings-merge'], ['add-hook', undefined]])
})
