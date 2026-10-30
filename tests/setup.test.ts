import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

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

const setupWorld = (on: On, filled: string[], fillResult: { isFilled: boolean; refusal?: 'no_composer' } | 'hang' = { isFilled: true }, submitted: string[] = []) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, { HOME: '/Users/kevin' })
  on('session.cwd', () => ({ value: '/work/game' }))
  on('ui.open', () => ({ value: { isPlaced: true } as never }))
  on('fs.read', ($, e) => {
    const path = e.path.replaceAll('\\', '/')
    if (path.endsWith('/.claude/CLAUDE.md') && path.startsWith('/Users/kevin/')) return { value: '# Rules\nDelegate reads to scout.' }
    if (path.endsWith('scout.md')) return { value: '---\nname: scout\nmodel: haiku\n---' }
    throw new Error('missing')
  })
  on('fs.list', ($, e) => ({ value: e.path.replaceAll('\\', '/').endsWith('/Users/kevin/.claude/agents') ? [{ name: 'scout.md', kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }] : [] }))
  on('model.complete', () => ({ value: { isAnswered: true as const, text: REPLY, usage: USAGE } }))
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return fillResult === 'hang' ? new Promise<never>(() => undefined) : fillResult
  })
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

test('/coach setup audits, Apply fills the prompt, Skip hides the card', { options: { judgeTurns: false, analyzeEvery: 0 } }, async ($, on) => {
  const filled: string[] = []
  setupWorld(on, filled)

  const answer = await $.command.run({ command: 'coach', args: 'setup' } as never)
  expect(answer.text).toBe('- Your routing rule is never followed (agents): Add a SubagentStart reminder hook or soften the rule.')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-coach', surface, component: 'Pane', requestId: 'session-coach-setup', props: { bodyColumns: 100 } as never })
    expect(await ui.find({ text: /Your routing rule is never followed/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'session-coach', surface: 'desktop', component: 'Pane', requestId: 'session-coach-setup', props: { bodyColumns: 100 } as never })
  await ui.press({ key: 'apply-enforce-routing' })
  expect(filled).toEqual(['Edit ~/.claude/CLAUDE.md: rewrite the Model routing table as concrete triggers. Show the diff first.'])
  expect(await ui.find({ text: /The instruction is in your prompt box/ })).toBeDefined()
  expect(await ui.find({ key: 'apply-enforce-routing' })).toBeUndefined()
  expect(await ui.find({ key: 'send-enforce-routing' })).toBeDefined()

  await ui.press({ key: 'skip-enforce-routing' })
  expect(await ui.find({ text: /Your routing rule is never followed/ })).toBeUndefined()
  expect(await ui.find({ key: 'unskip' })).toBeDefined()
  await ui.unmount()
})

test('when the prompt box refuses the fill, the card says so and Send to Claude submits it', { options: { judgeTurns: false, analyzeEvery: 0 } }, async ($, on) => {
  const filled: string[] = []
  const submitted: string[] = []
  setupWorld(on, filled, { isFilled: false, refusal: 'no_composer' }, submitted)
  await $.command.run({ command: 'coach', args: 'setup' } as never)

  const ui = await $.ui.mount({ plugin: 'session-coach', surface: 'desktop', component: 'Pane', requestId: 'session-coach-setup', props: { bodyColumns: 100 } as never })
  await ui.press({ key: 'apply-enforce-routing' })
  expect(await ui.find({ text: /prompt box can't be filled by a plugin/ })).toBeDefined()
  expect((await ui.find({ key: 'text-enforce-routing' }))?.text).toContain('Edit ~/.claude/CLAUDE.md: rewrite the Model routing table')
  expect(await ui.find({ key: 'copy-enforce-routing' })).toBeDefined()

  await ui.press({ key: 'send-enforce-routing' })
  expect(submitted).toEqual(['Edit ~/.claude/CLAUDE.md: rewrite the Model routing table as concrete triggers. Show the diff first.'])
  expect(await ui.find({ text: /Sent to Claude as your next prompt/ })).toBeDefined()
  expect(await ui.find({ key: 'send-enforce-routing' })).toBeUndefined()
  await ui.unmount()
})

test('a prompt fill that never answers falls back to Send to Claude after 3 seconds', { options: { judgeTurns: false, analyzeEvery: 0 } }, async ($, on) => {
  const filled: string[] = []
  const clock = setupWorld(on, filled, 'hang')
  await $.command.run({ command: 'coach', args: 'setup' } as never)

  const ui = await $.ui.mount({ plugin: 'session-coach', surface: 'desktop', component: 'Pane', requestId: 'session-coach-setup', props: { bodyColumns: 100 } as never })
  const pressed = ui.press({ key: 'apply-enforce-routing' })
  await clock.advance(3000)
  await pressed
  expect(await ui.find({ text: /prompt box can't be filled by a plugin/ })).toBeDefined()
  expect(await ui.find({ key: 'send-enforce-routing' })).toBeDefined()
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
