import { expect, mock, test } from 'claude-code/testing'

import { parseRecommendations } from '../hooks/setup'
import { emptyMetrics, recordTool, tips } from '../hooks/metrics'
import { STAGE_LABEL, parseCategory, parsePriority, parseStage, priorityCounts, rankedItems, sortRecommendations, stageMarkdown, stageUrl } from '../hooks/rank'
import { vitalTips } from '../hooks/vitals'

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('priorities and categories parse with safe fallbacks', async () => {
  expect(parsePriority(1)).toBe(1)
  expect(parsePriority('P2')).toBe(2)
  expect(parsePriority(9)).toBe(3)
  expect(parseCategory('git')).toBe('git')
  expect(parseCategory('vibes')).toBe('workflow')
  expect(parseCategory('vibes', 'setup')).toBe('setup')
})

test('rule tips and expert suggestions merge into one list, most important first', async () => {
  let m = emptyMetrics(0)
  for (let i = 0; i < 6; i++) m = recordTool(m, { tool: 'Write', input: { file_path: `f${i}.ts` }, isError: false, isDenied: false })
  m = recordTool(m, { tool: 'Bash', input: { command: 'make' }, isError: true, isDenied: false })
  m = recordTool(m, { tool: 'Bash', input: { command: 'make' }, isError: true, isDenied: false })
  const rules = tips(m)
  expect(rules.find(t => t.id === 'loop')).toMatchObject({ priority: 1, category: 'quality' })
  expect(rules.find(t => t.id === 'verify')).toMatchObject({ priority: 2, category: 'quality' })

  const items = rankedItems(rules, [
    { kind: 'habit', title: 'Low thing', detail: 'd', priority: 4, category: 'context' },
    { kind: 'hook', title: 'Critical thing', detail: 'd', priority: 1, category: 'safety' },
  ])
  expect(items.map(i => `${i.priority}:${i.title}`)).toEqual([
    '1:The same command failed more than once. Diagnose the cause before you retry.',
    '1:Critical thing',
    '2:6 edits since the last test, lint or type check.',
    '4:Low thing',
  ])
  expect(priorityCounts(items)).toBe('2 P1 · 1 P2 · 1 P4')

  const now = Date.parse('2026-10-25T12:00:00Z')
  const git = { isRepo: true, branch: 'main', changedFiles: 1, insertions: 1, deletions: 0, lastCommitAt: now, checkedAt: now }
  expect(vitalTips([{ kind: 'five_hour', percent: 97 }], git, now).map(t => `${t.id}:P${t.priority}:${t.category}`)).toEqual(['plan-critical-five_hour:P1:cost', 'git-main:P2:git'])
})

test('setup recommendations are ranked and categorized', async () => {
  const recs = parseRecommendations(JSON.stringify({
    recommendations: [
      { id: 'later', title: 'Low', applyPrompt: 'x', priority: 4, category: 'context', ifApplied: {}, ifSkipped: {} },
      { id: 'urgent', title: 'High', applyPrompt: 'y', priority: 1, category: 'safety', ifApplied: {}, ifSkipped: {} },
      { id: 'plain', title: 'No rank', applyPrompt: 'z', ifApplied: {}, ifSkipped: {} },
    ],
  }))
  expect(recs.find(r => r.id === 'plain')).toMatchObject({ priority: 3, category: 'setup' })
  expect(sortRecommendations(recs).map(r => r.id)).toEqual(['urgent', 'plain', 'later'])
})

test('the pane shows colored sections and ranked cards with priority and category chips', { options: { analyzeEvery: 0, judgeTurns: false } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1000 })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: { ok: false } as never, isError: true }) as never)
  on('model.complete', () => ({ value: { isAnswered: true as const, text: '{"insights":[{"kind":"habit","title":"Expert P4","detail":"d","priority":4,"category":"context"}]}', usage: USAGE } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine draws') as never
  })
  await $.tool.call({ tool: 'Bash', command: 'make' } as never)
  await $.tool.call({ tool: 'Bash', command: 'make' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' as const })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-coach', surface, component: 'Pane', requestId: 'session-coach', props: { bodyColumns: 100 } as never })
    await ui.press({ key: 'analyze' })
    for (const title of ['⚡ Now', '📊 Vitals', '🛠 Setup & feed']) {
      expect(await ui.find({ type: 'Text', text: title }), title).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /^Recommendations · 1 P1 · 1 P4/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'P1 CRITICAL' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '· Quality' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'P4 LOW' })).toBeDefined()
    expect((await ui.find({ key: 'tip-loop' }))?.props.borderColor).toBe('error')
    expect(await ui.find({ type: 'Text', text: '· 5 Verify' })).toBeDefined()
    expect((await ui.find({ key: 'tip-loop-text' }))?.text).toContain('Playbook station: [5 Verify](https://claude.ai/artifact/UT9DVjes46X3bM5J2DRVFU#verify)')
    expect((await ui.find({ key: 'insight-0' }))?.props.borderColor).toBe('suggestion')
    await ui.unmount()
  }
})

test('every recommendation names its playbook station and links to it', async () => {
  expect(parseStage('verify', 'git')).toBe('verify')
  expect(parseStage('nowhere', 'git')).toBe('ship')
  expect(parseStage(undefined, 'cost')).toBe('context')
  expect(stageUrl('https://claude.ai/artifact/abc#old', 'plan')).toBe('https://claude.ai/artifact/abc#plan')
  expect(stageMarkdown('https://claude.ai/artifact/abc', 'verify')).toBe('Playbook station: [5 Verify](https://claude.ai/artifact/abc#verify)')
  expect(STAGE_LABEL.safety).toBe('Safety line')

  let m = emptyMetrics(0)
  m = recordTool(m, { tool: 'Bash', input: { command: 'make' }, isError: true, isDenied: false })
  m = recordTool(m, { tool: 'Bash', input: { command: 'make' }, isError: true, isDenied: false })
  expect(tips(m).find(t => t.id === 'loop')?.stage).toBe('verify')
  const recs = parseRecommendations(JSON.stringify({ recommendations: [{ id: 'gate', title: 'Gate', applyPrompt: 'x', category: 'safety', ifApplied: {}, ifSkipped: {} }] }))
  expect(recs[0]?.stage).toBe('safety')
})
