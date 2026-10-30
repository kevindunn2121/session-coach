import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const INSIGHTS_REPLY = '{"insights":[{"kind":"hook","title":"Lint after every edit","detail":"Add a PostToolUse hook.","name":"lint-on-edit"}]}'

const engineBottom = (on: On) => {
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: { ok: true } as never }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine draws') as never
  })
}

const report = async ($: { command: { run: (e: never) => Promise<{ text?: string }> } }) =>
  (await $.command.run({ command: 'coach', args: 'report' } as never)).text ?? ''

const turn = (turnId: string) => ({ answer: 'ok', durationMs: 1000, isAborted: false, turnId, reason: 'answer' as const })

test('tool calls, prompts and turns feed live metrics', { options: { analyzeEvery: 0 } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1000 })
  engineBottom(on)

  await $.prompt.submit({ text: 'Fix src/app.ts so the tests pass' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'src/app.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'src/util.ts' } as never)
  await $.turn.complete(turn('t1'))

  const text = await report($)
  expect(text).toContain('- 1 turns over')
  expect(text).toContain('2 tool calls')
  expect(text).toContain('1 edits')
  expect(text).toContain('- 1 prompts: 1 named files, 1 stated criteria, 0 corrections')
})

test('analysis runs on its turn and stores the model suggestions', { options: { analyzeEvery: 1 } }, async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1000 })
  engineBottom(on)
  on('http.fetch', () => ({ value: { status: 403, ok: false, headers: {}, text: '' } }))
  on('model.complete', () => ({ value: { isAnswered: true as const, text: INSIGHTS_REPLY, usage: USAGE } }))

  await $.turn.complete(turn('t1'))
  await clock.advance(10)

  expect(await report($)).toContain('**Lint after every edit** (hook: `lint-on-edit`): Add a PostToolUse hook.')
})

test('/coach report and /coach paste answer in text', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1000 })

  const pasted = await $.command.run({ command: 'coach', args: 'paste Keep CLAUDE.md short and current' } as never)
  expect(pasted.text).toContain('Saved (1 pasted posts)')

  expect(await report($)).toContain('# Session coach report')
})

test('the band shows the score after a turn on terminal and desktop', { options: { analyzeEvery: 0 } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1000 })
  engineBottom(on)
  await $.turn.complete(turn('t1'))

  const band = { plugin: 'session-coach', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100 } as never } as const

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band, surface })
    expect(await ui.find({ type: 'Text', text: /^Coach \d+$/ })).toBeDefined()
    await ui.unmount()
  }

  const shown = await $.ui.mount({ ...band, surface: 'terminal' })
  await shown.press({ key: 'hide' })
  await shown.unmount()

  const hidden = await $.ui.mount({ ...band, surface: 'desktop' })
  expect(await hidden.find({ text: 'engine draws' })).toBeDefined()
  await hidden.unmount()
})

test('a refresh reads the web feeds, never an inbox file, and sends fresh posts first', { options: { analyzeEvery: 0, judgeTurns: false, subreddits: '', xHandles: '', extraFeeds: 'https://blog.example/feed' } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2026-10-29T12:00:00Z') })
  mock.env(on, { HOME: '/Users/kevin' })
  engineBottom(on)
  const fetched: string[] = []
  const read: string[] = []
  const prompts: string[] = []
  on('http.fetch', ($, e) => {
    fetched.push(e.url)
    const text = '<rss><item><title>Old tip</title><pubDate>Mon, 01 Sep 2026 08:00:00 GMT</pubDate></item><item><title>New tip</title><pubDate>Wed, 28 Oct 2026 08:00:00 GMT</pubDate></item></rss>'
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
  on('fs.read', ($, e) => {
    read.push(e.path)
    throw new Error('missing')
  })
  on('model.complete', ($, e) => {
    prompts.push(e.prompt as string)
    return { value: { isAnswered: true as const, text: '{"practices":[{"practice":"Keep context small","why":"w","signal":"s"}],"tools":[]}', usage: USAGE } }
  })

  const refreshed = await $.command.run({ command: 'coach', args: 'refresh' } as never)
  expect(refreshed.text).toBe('Playbook rebuilt from 2 posts across 1 sources.')
  expect(fetched).toEqual(['https://blog.example/feed'])
  expect(read.some(path => path.includes('inbox'))).toBe(false)
  const prompt = prompts.at(-1) ?? ''
  expect(prompt.indexOf('New tip')).toBeGreaterThan(-1)
  expect(prompt.indexOf('New tip')).toBeLessThan(prompt.indexOf('Old tip'))
})

test('each turn gets a verdict that the band shows', { options: { analyzeEvery: 0 } }, async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1000 })
  engineBottom(on)
  on('model.complete', () => ({ value: { isAnswered: true as const, text: '{"verdict":"drifting","note":"Edits without tests","nudge":"Run the tests"}', usage: USAGE } }))

  await $.prompt.submit({ text: 'Add the dash ability to player.gd' } as never)
  await $.turn.complete(turn('t1'))
  await clock.advance(10)

  const band = { plugin: 'session-coach', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120 } as never } as const
  const ui = await $.ui.mount({ ...band, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Coach \d+ ~ Drifting$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Run the tests' })).toBeDefined()
  await ui.unmount()
})

const pane = { plugin: 'session-coach', component: 'Pane', requestId: 'session-coach', props: { bodyColumns: 100 } as never } as const

test('the pane Analyze button shows suggestions, or why there are none', { options: { analyzeEvery: 0, judgeTurns: false } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1000 })
  engineBottom(on)
  let reply: unknown = { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded_error', usage: USAGE }
  on('model.complete', () => ({ value: reply as never }))

  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  await ui.press({ key: 'analyze' })
  expect(await ui.find({ text: /Analysis failed: API error 529\./ })).toBeDefined()

  reply = { isAnswered: true, text: INSIGHTS_REPLY, usage: USAGE }
  await ui.press({ key: 'analyze' })
  expect(await ui.find({ text: /Lint after every edit/ })).toBeDefined()
  expect(await ui.find({ text: /1 suggestions after turn 0\./ })).toBeDefined()
  await ui.unmount()
})

test('each job uses its own model and effort', { options: { analyzeEvery: 1 } }, async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1000 })
  engineBottom(on)
  const calls: string[] = []
  on('model.complete', ($, e) => {
    calls.push(`${e.model}:${e.effort ?? 'default'}:${e.maxTokens ?? 0}`)
    return { value: { isAnswered: true as const, text: '{"verdict":"on-track","note":"ok"}', usage: USAGE } }
  })

  await $.prompt.submit({ text: 'Fix src/app.ts' } as never)
  await $.turn.complete(turn('t1'))
  await clock.advance(10)

  expect(calls.sort()).toEqual(['claude-haiku-5-5:low:1024', 'claude-sonnet-5-5:medium:4000'])
})

test('a pressed analysis shows its result at the top of the pane', { options: { analyzeEvery: 0, judgeTurns: false } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1000 })
  engineBottom(on)
  on('model.complete', () => ({ value: { isAnswered: true as const, text: INSIGHTS_REPLY, usage: USAGE } }))

  const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
  expect(await ui.find({ key: 'status' })).toBeUndefined()
  await ui.press({ key: 'analyze' })

  const status = await ui.find({ key: 'status' })
  expect(status?.text).toContain('1 new suggestion: Lint after every edit')
  expect(await ui.find({ type: 'Text', text: /^Recommendations · .*✦ new$/ })).toBeDefined()
  expect((await ui.find({ key: 'insight-0-text' }))?.text).toContain('Lint after every edit')
  expect(await ui.find({ type: 'Text', text: '📊 Vitals' })).toBeDefined()
  await ui.unmount()
})
