import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Playbook } from '../types'
import { SEED_PLAYBOOK, parsePlaybook, playbookPrompt } from '../hooks/feed'
import { escapeHtml, renderPlaybookMap, stageOf } from '../hooks/map'
import { STAGES } from '../hooks/rank'

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const playbook = (over: Partial<Playbook> = {}): Playbook => ({
  fetchedAt: Date.parse('2026-10-27T06:00:00Z'),
  sources: ['r/ClaudeCode', '@karpathy'],
  postCount: 42,
  practices: [],
  tools: [],
  ...over,
})

const sectionOf = (html: string, stage: string): string => {
  const start = html.indexOf(`id="${stage}"`)
  return start < 0 ? '' : html.slice(start, html.indexOf('</section>', start))
}

test('the map escapes HTML from the playbook', async () => {
  const html = renderPlaybookMap(
    playbook({
      sources: ['<b>evil</b>'],
      practices: [{ practice: '<script>alert("x")</script>', why: "Tom & Jerry's", signal: '<img src=x onerror=alert(1)>', stage: 'plan' }],
      tools: [{ kind: 'hook', name: '"><svg onload=alert(1)>', what: 'a < b', stage: 'setup' }],
    }),
  )

  expect(html).not.toContain('<script>alert')
  expect(html).not.toContain('<img src=x')
  expect(html).not.toContain('<svg onload')
  expect(html).not.toContain('<b>evil</b>')
  expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
  expect(html).toContain('Tom &amp; Jerry&#39;s')
  expect(html).toContain('a &lt; b')
  expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;')
})

test('every station and line anchor exists exactly once, with the kickoff prompt', async () => {
  const html = renderPlaybookMap(SEED_PLAYBOOK)
  for (const stage of STAGES) {
    expect(html.split(`id="${stage}"`).length - 1).toBe(1)
    expect(html).toContain(`href="#${stage}"`)
  }
  expect(html.startsWith('<!doctype html>')).toBe(true)
  expect(html).toContain('id="kickoff"')
  expect(html).toContain('id="copyKickoff"')
  expect(sectionOf(html, 'start')).toContain('Kickoff prompt')
})

test('practices and tools land on their own station', async () => {
  const html = renderPlaybookMap(
    playbook({
      practices: [
        { practice: 'Run tests before done', why: 'w', signal: 's', stage: 'verify' },
        { practice: 'Draft PR after the first commit', why: 'w', signal: 's', stage: 'ship' },
        { practice: 'Gate rm -rf in a hook', why: 'w', signal: 's', stage: 'safety' },
      ],
      tools: [{ kind: 'agent', name: 'spec-blind-test-writer', what: 'Writes tests from the spec', stage: 'verify' }],
    }),
  )

  expect(sectionOf(html, 'verify')).toContain('Run tests before done')
  expect(sectionOf(html, 'verify')).toContain('spec-blind-test-writer')
  expect(sectionOf(html, 'ship')).toContain('Draft PR after the first commit')
  expect(sectionOf(html, 'safety')).toContain('Gate rm -rf in a hook')
  expect(sectionOf(html, 'plan')).not.toContain('Run tests before done')
  expect(sectionOf(html, 'plan')).toContain('No practice in today')
  expect(html).toContain('Built from <b>42</b> posts')
  expect(html).toContain('Playbook <b>2026-10-27</b>')
  expect(html).toContain('Sources: r/ClaudeCode, @karpathy.')
})

test('practices from older playbooks without a stage get a keyword guess', async () => {
  expect(stageOf({}, 'Compact before the context window fills')).toBe('context')
  expect(stageOf({}, 'Open a draft PR early')).toBe('ship')
  expect(stageOf({}, 'Something with no keyword at all')).toBe('build')
  expect(stageOf({ stage: 'learn' }, 'Run the tests')).toBe('learn')
})

test('the playbook model assigns a stage, with a category fallback', async () => {
  expect(playbookPrompt([], 0)).toContain('"stage":"start|setup|plan|build|verify|ship|learn|context|safety"')

  const reply = JSON.stringify({
    practices: [
      { practice: 'Plan first', why: 'w', signal: 's', stage: 'plan', category: 'workflow' },
      { practice: 'Commit often', why: 'w', signal: 's', stage: 'nowhere', category: 'git' },
      { practice: 'No hints', why: 'w', signal: 's' },
    ],
    tools: [
      { kind: 'agent', name: 'reviewer', what: 'w', stage: 'verify' },
      { kind: 'hook', name: 'gate', what: 'w', category: 'safety' },
      { kind: 'skill', name: 'bare', what: 'w' },
    ],
  })
  const built = parsePlaybook(reply, [], 1000)
  expect(built?.practices.map(p => p.stage)).toEqual(['plan', 'ship', 'build'])
  expect(built?.tools.map(t => t.stage)).toEqual(['verify', 'safety', 'setup'])
})

const pane = { plugin: 'session-coach', component: 'Pane', requestId: 'session-coach', surface: 'desktop', props: { bodyColumns: 100 } as never } as const

const recordWrites = (on: On) => {
  const writes: { path: string; text: string }[] = []
  on('fs.write', ($, e) => {
    writes.push({ path: e.path.replaceAll('\\', '/'), text: e.text })
    return { value: undefined }
  })
  return writes
}

const ONE_FEED = { subreddits: '', xHandles: '', extraFeeds: 'https://blog.example/feed' }

test('a playbook rebuild writes the line map and the pane shows its path', { options: { analyzeEvery: 0, judgeTurns: false, ...ONE_FEED } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2026-10-27T08:00:00Z') })
  mock.env(on, { HOME: '/Users/kevin' })
  const writes = recordWrites(on)
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '<rss><item><title>Keep context small</title></item></rss>' } }))
  on('model.complete', () => ({
    value: { isAnswered: true as const, text: '{"practices":[{"practice":"Keep context <small>","why":"w","signal":"s","stage":"context"}],"tools":[]}', usage: USAGE },
  }))

  const refreshed = await $.command.run({ command: 'coach', args: 'refresh' } as never)
  expect(refreshed.text).toBe('Playbook rebuilt from 1 posts across 1 sources.')

  const [written] = writes
  expect(writes.length).toBe(1)
  expect(written?.path).toBe('/Users/kevin/.claude/session-coach/playbook-line-map.html')
  expect(sectionOf(written?.text ?? '', 'context')).toContain('Keep context &lt;small&gt;')

  const ui = await $.ui.mount(pane)
  expect(await ui.find({ text: /Open local map: `\/Users\/kevin\/\.claude\/session-coach\/playbook-line-map\.html`/ })).toBeDefined()
  await ui.unmount()
})

test('a failed rebuild does not write the map', { options: { analyzeEvery: 0, judgeTurns: false, ...ONE_FEED } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2026-10-27T08:00:00Z') })
  mock.env(on, { HOME: '/Users/kevin' })
  const writes = recordWrites(on)
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '<rss><item><title>Keep context small</title></item></rss>' } }))
  on('model.complete', () => ({ value: { isAnswered: true as const, text: 'not json', usage: USAGE } }))

  const refreshed = await $.command.run({ command: 'coach', args: 'refresh' } as never)
  expect(refreshed.text).toBe('The model reply was not a playbook.')
  expect(writes).toEqual([])
})

test('/coach map writes the map on demand and prints the path', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1000 })
  mock.env(on, { HOME: '/Users/kevin' })
  const writes = recordWrites(on)

  const result = await $.command.run({ command: 'coach', args: 'map' } as never)
  expect(result.text).toBe('Playbook map written to /Users/kevin/.claude/session-coach/playbook-line-map.html. Open it in a browser.')
  expect(writes.length).toBe(1)
  expect(writes[0]?.text).toContain('Explore, plan, then code')
  expect(writes[0]?.text).toContain('Playbook <b>built-in seed</b>')
})
