import { expect, mock, test } from 'claude-code/testing'

import { cacheHitRate, contextRunway, emptyMetrics, mostEditedFile, recordContext, recordPermissionAsk, recordTool, recordTurn, tips } from '../hooks/metrics'
import { addSpend, coachShare, countPorcelain, formatUntil, parseShortstat, planWindows, vitalTips, vitalsLines } from '../hooks/vitals'

const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 }
const HOUR = 60 * 60 * 1000

const turn = (input: number, cacheRead: number, cacheCreation: number) =>
  ({ durationMs: 1, isAborted: false, inputTokens: input, outputTokens: 10, cacheReadTokens: cacheRead, cacheCreationTokens: cacheCreation })

test('cache hit rate, context runway, churn and permission asks', async () => {
  let m = emptyMetrics(0)
  for (let i = 0; i < 5; i++) m = recordTurn(m, turn(900, 100, 0))
  expect(cacheHitRate(m)).toBe(0.1)
  expect(tips(m).some(t => t.id === 'cache')).toBe(true)

  for (const percent of [60, 70, 80, 88]) m = recordContext(m, percent)
  expect(contextRunway(m)).toBe(0)
  expect(tips(m).find(t => t.id === 'runway')?.text).toBe('About 0 turns until auto-compaction.')
  expect(tips(m).find(t => t.id === 'runway')?.fix).toEqual({ kind: 'command', text: '/compact keep the current task, the files changed so far, and the open decisions', when: 'next' })

  for (let i = 0; i < 5; i++) m = recordTool(m, { tool: 'Edit', input: { file_path: 'X:\\game\\player.gd' }, isError: false, isDenied: false })
  expect(mostEditedFile(m)).toEqual({ path: 'x:/game/player.gd', count: 5 })
  expect(tips(m).find(t => t.id === 'churn')?.text).toContain('player.gd edited 5 times')

  for (let i = 0; i < 8; i++) m = recordPermissionAsk(m)
  expect(tips(m).some(t => t.id === 'asks')).toBe(true)
})

test('plan windows, git risk and coach spend', async () => {
  const now = Date.parse('2026-10-16T12:00:00Z')
  const usage = planWindows([{ kind: 'five_hour', percentUsed: 83.5, resetsAt: '2026-10-16T14:30:00Z' }, { kind: 'seven_day', percentUsed: 20 }])
  expect(formatUntil('2026-10-16T14:30:00Z', now)).toBe('resets in 2h 30m')
  expect(parseShortstat(' 7 files changed, 210 insertions(+), 40 deletions(-)')).toEqual({ insertions: 210, deletions: 40 })
  expect(parseShortstat(' 1 file changed, 1 insertion(+)')).toEqual({ insertions: 1, deletions: 0 })
  expect(countPorcelain(' M a.ts\n?? b.ts\n')).toBe(2)

  const git = { isRepo: true, branch: 'main', changedFiles: 12, insertions: 210, deletions: 40, lastCommitAt: now - 3 * HOUR, checkedAt: now }
  expect(vitalTips(usage, git, now).map(t => t.id)).toEqual(['plan-five_hour', 'git-main', 'git-size'])
  expect(vitalTips(usage, git, now)[0]?.text).toBe('5h plan window at 83.5%, resets in 2h 30m.')
  expect(vitalTips(usage, git, now)[0]?.fix.kind).toBe('prompt')
  expect(vitalTips([], { ...git, branch: 'feat/x', changedFiles: 2, insertions: 5, deletions: 0 }, now).map(t => t.id)).toEqual(['git-age'])

  const spend = addSpend(addSpend(null, 'judge', USAGE), 'analysis', USAGE)
  expect(spend.judge).toEqual({ calls: 1, input: 1000, output: 200, cacheRead: 3000 })
  let m = emptyMetrics(0)
  m = recordTurn(m, turn(10000, 70000, 0))
  expect(Math.round((coachShare(m, spend) ?? 0) * 100)).toBe(10)

  const lines = vitalsLines({ metrics: m, usage, git, spend, now })
  expect(lines[0]).toBe('Plan: 5h 83.5% (resets in 2h 30m) · 7d 20%')
  expect(lines[2]).toBe('Git main: 12 changed files, +210/−40, last commit 3h 0m ago')
  expect(lines[4]).toBe('Coach cost: 2 calls, 8k in / 400 out (10% of all tokens)')
})

test('the pane shows live vitals from usage, git and the coach model calls', { options: { analyzeEvery: 0 } }, async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-16T12:00:00Z') })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: { ok: true } as never }))
  on('tool.check', () => ({ decision: 'ask' as const }))
  on('session.cwd', () => ({ value: '/work/game' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 42 }, rateLimits: [{ kind: 'five_hour', percentUsed: 91, resetsAt: '2026-10-16T13:00:00Z' }] } as never }))
  on('process.run', ($, e) => {
    const args = e.argv.slice(1).join(' ')
    const stdout = args === 'branch --show-current' ? 'main\n' : args === 'status --porcelain' ? ' M player.gd\n' : args.startsWith('diff') ? ' 1 file changed, 3 insertions(+)' : '1792140000\n'
    return { value: { exitCode: 0, stdout, stderr: '' } as never }
  })
  on('model.complete', () => ({ value: { isAnswered: true as const, text: '{"verdict":"on-track","note":"fine"}', usage: USAGE } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine draws') as never
  })

  await $.prompt.submit({ text: 'Fix player.gd' } as never)
  await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' } } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'player.gd', old_string: 'a', new_string: 'b' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' as const })
  await clock.advance(10)

  const ui = await $.ui.mount({ plugin: 'session-coach', surface: 'desktop', component: 'Pane', requestId: 'session-coach', props: { bodyColumns: 100 } as never })
  expect(await ui.find({ text: /Plan: 5h 91% \(resets in 1h 0m\)/ }), 'plan line').toBeDefined()
  expect(await ui.find({ text: /Git main: 1 changed files, \+3\/−0/ }), 'git line').toBeDefined()
  expect(await ui.find({ text: /Permission asks [12]\b/ }), 'asks line (the explicit check, plus the Edit call own check on engines that raise tool.check from tool.call)').toBeDefined()
  expect(await ui.find({ text: /Coach cost: 1 calls/ }), 'cost line').toBeDefined()
  expect(await ui.find({ text: /5h plan window at 91%/ }), 'plan tip').toBeDefined()
  await ui.unmount()

  const band = await $.ui.mount({ plugin: 'session-coach', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 140 } as never })
  expect(await band.find({ type: 'Text', text: 'plan 91%' }), 'band plan').toBeDefined()
  await band.unmount()
})
