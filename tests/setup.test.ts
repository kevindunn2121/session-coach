import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { emptyMetrics } from '../hooks/metrics'
import { auditPrompt, measure, mcpServerNames, parseAgentFile, parseRecommendations, recommendationCard, redact, summarizeSettings } from '../hooks/setup'

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const REPLY = JSON.stringify({
  recommendations: [
    {
      id: 'Enforce Routing!',
      area: 'agents',
      title: 'Your routing rule is never followed',
      problem: 'CLAUDE.md says delegate to builder and scout, but no subagent ran.',
      evidence: 'Subagents by type: none; 40 tool calls on the main thread.',
      change: 'Add a SubagentStart reminder hook or soften the rule.',
      applyPrompt: 'Edit ~/.claude/CLAUDE.md: rewrite the Model routing table as concrete triggers. Show the diff first.',
      ifApplied: { drift: 'less', tokens: '~-3k/session', summary: 'Reads move to Haiku.' },
      ifSkipped: { drift: 'more', tokens: '~+3k/session', summary: 'Opus keeps doing reads | searches.' },
      confidence: 'high',
    },
    { id: 'no-prompt', title: 'Missing applyPrompt is dropped' },
  ],
})

test('secrets are redacted from instructions and hook commands', async () => {
  expect(redact('use sk-ant-abc123def456 and API_KEY=hunter22 and token: "xyz"')).toBe('use [redacted] and API_KEY=[redacted] and token: [redacted]')

  const summary = summarizeSettings('s.json', JSON.stringify({
    model: 'opus',
    env: { OPENAI_API_KEY: 'sk-live-should-not-appear' },
    permissions: { allow: ['Bash(npm test)'], deny: ['Read(.env)'] },
    hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'lint --token=abc123456789' }] }] },
    enabledPlugins: { 'caveman@caveman': true, 'off@x': false },
  }))
  expect(summary?.envNames).toEqual(['OPENAI_API_KEY'])
  expect(JSON.stringify(summary)).not.toContain('sk-live')
  expect(summary?.hooks).toEqual(['PostToolUse[Edit]: lint --token=[redacted]'])
  expect(summary?.plugins).toEqual(['caveman@caveman'])
  expect(summary?.permissions).toEqual({ allow: 1, deny: 1, ask: 0, samples: ['Read(.env)', 'Bash(npm test)'] })
})

test('agents, MCP servers and token math come from the setup files', async () => {
  expect(parseAgentFile('scout.md', '---\nname: scout\ndescription: Read-only lookups\nmodel: haiku\n---\nbody', 'user')).toEqual({ name: 'scout', scope: 'user', model: 'haiku', description: 'Read-only lookups' })
  expect(parseAgentFile('x.md', 'no front matter', 'project').model).toBe('inherit')
  expect(mcpServerNames(JSON.stringify({ mcpServers: { jev: {} }, projects: { 'X:/Apps/p': { mcpServers: { godot: {} } } } }), 'X:\\Apps\\p')).toEqual(['jev', 'godot'])

  const snapshot = { instructions: [{ path: 'CLAUDE.md', text: 'x'.repeat(4000) }], settings: [], skills: [], agents: [], mcpServers: [] }
  expect(measure(snapshot, [{ turns: 10 }, { turns: 20 }], 3)).toEqual({ instructionTokens: 1000, avgTurns: 15, sessionsSeen: 2 })
  expect(auditPrompt(snapshot, measure(snapshot, [], 3), emptyMetrics(0), 'playbook')).toContain('load ~1000 tokens into every request')
})

test('recommendations parse, normalize and render with apply and skip outcomes', async () => {
  const recs = parseRecommendations(`Here: ${REPLY}`)
  expect(recs.map(r => r.id)).toEqual(['enforce-routing'])
  const card = recommendationCard(recs[0]!)
  expect(card).toContain('| If you apply | ↓ less | ~-3k/session | Reads move to Haiku. |')
  expect(card).toContain('| If you skip | ↑ more | ~+3k/session | Opus keeps doing reads / searches. |')
})

const PATCH_REPLY = JSON.stringify({
  recommendations: [
    {
      id: 'deny-prod',
      area: 'permissions',
      title: 'Deny prod Snowflake SQL',
      problem: 'Nothing stops a prod query.',
      change: 'Add a deny rule.',
      applyPrompt: 'Add Bash(snow sql:*) to permissions.deny in ~/.claude/settings.json.',
      patch: { kind: 'settings-merge', target: '~/.claude/settings.json', set: { deny: ['Bash(snow sql:*)'] } },
    },
    {
      id: 'safety-rule',
      area: 'claude-md',
      title: 'Write the DEV_ rule down',
      problem: 'The rule is only in your head.',
      change: 'Add it to CLAUDE.md.',
      applyPrompt: 'Add the DEV_ rule to ~/.claude/CLAUDE.md.',
      patch: { kind: 'claude-md-append', target: '~/.claude/CLAUDE.md', heading: '## Safety', lines: '- Ask before writing outside DEV_.' },
    },
  ],
})

type World = { reply?: string; files?: Record<string, string>; submitted?: string[]; isWriteBroken?: boolean }

const setupWorld = (on: On, { reply = REPLY, files = {}, submitted = [], isWriteBroken = false }: World = {}) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, { HOME: '/Users/kevin' })
  on('session.cwd', () => ({ value: '/work/game' }))
  on('ui.open', () => ({ value: { isPlaced: true } as never }))
  on('fs.read', ($, e) => {
    const path = e.path.replaceAll('\\', '/')
    if (path in files) return { value: files[path]! }
    if (path.endsWith('scout.md')) return { value: '---\nname: scout\nmodel: haiku\n---' }
    throw new Error('missing')
  })
  on('fs.write', ($, e) => {
    if (isWriteBroken) throw new Error('read-only file system')
    files[e.path.replaceAll('\\', '/')] = e.text
    return { value: undefined }
  })
  on('fs.list', ($, e) => ({ value: e.path.replaceAll('\\', '/').endsWith('/Users/kevin/.claude/agents') ? [{ name: 'scout.md', kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }] : [] }))
  on('model.complete', () => ({ value: { isAnswered: true as const, text: reply, usage: USAGE } }))
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine draws') as never
  })
  return clock
}

const mountSetup = ($: Engine, surface: 'terminal' | 'desktop' = 'desktop') =>
  $.ui.mount({ plugin: 'session-coach', surface, component: 'Pane', requestId: 'session-coach-setup', props: { bodyColumns: 100 } as never })

const SETTINGS = '/Users/kevin/.claude/settings.json'
const CLAUDE_MD = '/Users/kevin/.claude/CLAUDE.md'

test('/coach setup audits, Fix with Claude sends the instruction in one click, Skip hides the card', { options: { judgeTurns: false, analyzeEvery: 0 } }, async ($, on) => {
  const submitted: string[] = []
  setupWorld(on, { files: { [CLAUDE_MD]: '# Rules\nDelegate reads to scout.' }, submitted })

  const answer = await $.command.run({ command: 'coach', args: 'setup' } as never)
  expect(answer.text).toBe('- Your routing rule is never followed (agents): Add a SubagentStart reminder hook or soften the rule.')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountSetup($, surface)
    expect(await ui.find({ text: /Your routing rule is never followed/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await mountSetup($)
  expect(await ui.find({ key: 'fix-enforce-routing' })).toBeUndefined()
  await ui.press({ key: 'send-enforce-routing' })
  expect(submitted).toEqual(['Edit ~/.claude/CLAUDE.md: rewrite the Model routing table as concrete triggers. Show the diff first.'])
  expect(await ui.find({ text: /Sent to Claude as your next prompt/ })).toBeDefined()
  expect(await ui.find({ key: 'send-enforce-routing' })).toBeUndefined()
  expect((await ui.find({ key: 'skip-enforce-routing' }))?.text).toContain('Done')

  await ui.press({ key: 'skip-enforce-routing' })
  expect(await ui.find({ text: /Your routing rule is never followed/ })).toBeUndefined()
  expect(await ui.find({ key: 'unskip' })).toBeDefined()
  await ui.unmount()
})

test('Fix writes a patch with a backup and a diff, and Undo puts the file back', { options: { judgeTurns: false, analyzeEvery: 0 } }, async ($, on) => {
  const submitted: string[] = []
  const before = '{\n  "model": "opus"\n}\n'
  const files: Record<string, string> = { [SETTINGS]: before }
  setupWorld(on, { reply: PATCH_REPLY, files, submitted })
  await $.command.run({ command: 'coach', args: 'setup' } as never)

  const ui = await mountSetup($)
  expect(await ui.find({ key: 'send-deny-prod' })).toBeUndefined()
  await ui.press({ key: 'fix-deny-prod' })
  expect(submitted).toEqual([])
  expect(JSON.parse(files[SETTINGS]!)).toEqual({ model: 'opus', permissions: { deny: ['Bash(snow sql:*)'] } })
  expect(files['/Users/kevin/.claude/session-coach/backups/deny-prod-1970-01-01T00-00-01-000Z-settings.json']).toBe(before)
  expect(await ui.find({ text: /Changed `\/Users\/kevin\/\.claude\/settings\.json`\. It takes effect in your next session\./ })).toBeDefined()
  expect((await ui.find({ key: 'text-deny-prod' }))?.text).toContain('+       "Bash(snow sql:*)"')
  expect(await ui.find({ key: 'fix-deny-prod' })).toBeUndefined()

  await ui.press({ key: 'undo-deny-prod' })
  expect(files[SETTINGS]).toBe(before)
  expect(await ui.find({ text: /Undone\./ })).toBeDefined()
  expect(await ui.find({ key: 'fix-deny-prod' })).toBeDefined()
  await ui.unmount()
})

test('Undo leaves a file alone when it changed after the fix, and Fix writes nothing when the change is already there', { options: { judgeTurns: false, analyzeEvery: 0 } }, async ($, on) => {
  const files: Record<string, string> = { [SETTINGS]: '{}\n', [CLAUDE_MD]: '# Rules\n\n## Safety\n- Ask before writing outside DEV_.\n' }
  setupWorld(on, { reply: PATCH_REPLY, files })
  await $.command.run({ command: 'coach', args: 'setup' } as never)

  const ui = await mountSetup($)
  await ui.press({ key: 'fix-deny-prod' })
  files[SETTINGS] = '{"model": "haiku"}\n'
  await ui.press({ key: 'undo-deny-prod' })
  expect(files[SETTINGS]).toBe('{"model": "haiku"}\n')
  expect(await ui.find({ text: /changed after the fix, so Undo left it alone\. The file before the fix is saved at/ })).toBeDefined()

  await ui.press({ key: 'fix-safety-rule' })
  expect(Object.keys(files).filter(path => path.includes('safety-rule'))).toEqual([])
  expect(await ui.find({ text: /already has this change\. Nothing was written\./ })).toBeDefined()
  expect(await ui.find({ key: 'undo-safety-rule' })).toBeUndefined()
  await ui.unmount()
})

test('a patch the plugin cannot write falls back to Fix with Claude', { options: { judgeTurns: false, analyzeEvery: 0 } }, async ($, on) => {
  const submitted: string[] = []
  setupWorld(on, { reply: PATCH_REPLY, files: { [SETTINGS]: '{"model": "opus",}' }, submitted })
  await $.command.run({ command: 'coach', args: 'setup' } as never)

  const ui = await mountSetup($)
  await ui.press({ key: 'fix-deny-prod' })
  expect(await ui.find({ text: /is not valid JSON, so the plugin will not rewrite it\. Press \*\*Fix with Claude\*\* instead\./ })).toBeDefined()
  await ui.press({ key: 'send-deny-prod' })
  expect(submitted).toEqual(['Add Bash(snow sql:*) to permissions.deny in ~/.claude/settings.json.'])
  await ui.unmount()
})

test('a failed write says why and offers Fix with Claude', { options: { judgeTurns: false, analyzeEvery: 0 } }, async ($, on) => {
  setupWorld(on, { reply: PATCH_REPLY, files: { [SETTINGS]: '{}\n' }, isWriteBroken: true })
  await $.command.run({ command: 'coach', args: 'setup' } as never)

  const ui = await mountSetup($)
  await ui.press({ key: 'fix-deny-prod' })
  expect((await ui.find({ key: 'text-deny-prod' }))?.text).toMatch(/The plugin could not make this change itself: [^\n]*\S\. Press \*\*Fix with Claude\*\* instead\./)
  expect(await ui.find({ key: 'send-deny-prod' })).toBeDefined()
  await ui.unmount()
})

test('the first audit runs at session start, before any session, from the role and stack in the profile', { options: { judgeTurns: false, analyzeEvery: 0, openPane: 'command', profile: 'AI app and data engineer on Snowflake, Azure containers and GitHub.' } }, async ($, on) => {
  const prompts: string[] = []
  mock.store(on)
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, { HOME: '/Users/kevin' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work/game' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('fs.read', () => {
    throw new Error('missing')
  })
  on('fs.list', ($, e) => {
    const path = e.path.replaceAll('\\', '/')
    const file = (name: string) => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })
    if (path === '/work/game') return { value: [file('dbt_project.yml'), file('Dockerfile'), file('notes.md')] }
    if (path === '/work/game/.github/workflows') return { value: [file('deploy.yml')] }
    return { value: [] }
  })
  on('model.complete', ($, e) => {
    const text = typeof e.prompt === 'string' ? e.prompt : JSON.stringify(e.prompt)
    if (text.includes('audit')) prompts.push(text)
    return { value: { isAnswered: true as const, text: text.includes('audit') ? REPLY : '{}', usage: USAGE } }
  })

  await $.session.start({ cwd: '/work/game', surface: null, isInteractive: true })
  await clock.advance(8000)

  expect(prompts.length).toBe(1)
  const prompt = prompts[0] ?? ''
  expect(prompt).toContain('This is the first audit, before any session has run.')
  expect(prompt).toContain('<developer>\nAI app and data engineer on Snowflake, Azure containers and GitHub.\n</developer>')
  expect(prompt).toContain('No sessions recorded yet.')
  expect(prompt).toContain('project files: dbt_project.yml, Dockerfile')
  expect(prompt).toContain('GitHub Actions workflows: deploy.yml')
  expect(prompt).not.toContain('notes.md')
})
