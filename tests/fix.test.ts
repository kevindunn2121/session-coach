import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { parseInsights } from '../hooks/coach'
import { fixCopyText, fixMarkdown, fixPromptText, parseFix, promptedMessage } from '../hooks/fix'
import { parseJudgment } from '../hooks/judge'
import { emptyMetrics, recordTool, tips } from '../hooks/metrics'
import { parseRecommendations } from '../hooks/setup'

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('fixes parse, and say where the change goes and what to do next', async () => {
  expect(parseFix({ kind: 'nonsense', text: 'x' })).toBeUndefined()
  expect(parseFix({ kind: 'prompt', text: '  ' })).toBeUndefined()

  const claudeMd = parseFix({ kind: 'claude-md', text: '- Read a file before you edit it.' })!
  expect(fixMarkdown(claudeMd)).toBe('**How to fix:** Update `~/.claude/CLAUDE.md` with:\n```text\n- Read a file before you edit it.\n```\n**When:** When Claude is idle, or after this session.\nThen: Start a new Claude session so it loads the change.')
  expect(fixPromptText(claudeMd)).toBe('Add this to ~/.claude/CLAUDE.md. Show me the diff before writing.\n\n- Read a file before you edit it.')
  expect(fixCopyText(claudeMd)).toBe('Update ~/.claude/CLAUDE.md with:\n- Read a file before you edit it.\n\nThen: Start a new Claude session so it loads the change.')

  const command = parseFix({ kind: 'command', text: '/compact keep the task', then: 'Continue here.' })!
  expect(fixPromptText(command)).toBe('/compact keep the task')
  expect(fixMarkdown(command)).toContain('Run this in Claude:')
})

test('every rule tip carries an exact fix', async () => {
  let m = emptyMetrics(0)
  for (let i = 0; i < 6; i++) m = recordTool(m, { tool: 'Edit', input: { file_path: `f${i}.ts` }, isError: false, isDenied: false })
  m = recordTool(m, { tool: 'Bash', input: { command: 'make' }, isError: true, isDenied: false })
  m = recordTool(m, { tool: 'Bash', input: { command: 'make' }, isError: true, isDenied: false })
  const found = tips(m)
  expect(found.length).toBeGreaterThan(2)
  for (const tip of found) {
    expect(tip.fix.text.length, tip.id).toBeGreaterThan(10)
  }
  expect(found.find(t => t.id === 'verify')?.permanent?.kind).toBe('claude-md')
})

test('the delegate tip offers a CLAUDE.md line', async () => {
  let m = emptyMetrics(0)
  for (let i = 0; i < 40; i++) m = recordTool(m, { tool: 'Read', input: { file_path: `f${i}.ts` }, isError: false, isDenied: false })
  const delegate = tips(m).find(t => t.id === 'delegate')
  expect(delegate?.permanent?.kind).toBe('claude-md')
  expect(delegate?.permanent?.text).toBe('- Delegate codebase searches and broad file reads to a subagent and keep only its summary in the main context.')
})

test('model suggestions and setup cards keep their fixes', async () => {
  const insights = parseInsights('{"insights":[{"kind":"hook","title":"Lint on edit","detail":"d","fix":{"kind":"settings","target":"~/.claude/settings.json","text":"{\\"hooks\\":{}}","then":"Start a new session."}}]}')
  expect(insights[0]?.fix).toEqual({ kind: 'settings', target: '~/.claude/settings.json', text: '{"hooks":{}}', then: 'Start a new session.' })

  const recs = parseRecommendations(JSON.stringify({ recommendations: [{ id: 'trim', title: 'Trim CLAUDE.md', applyPrompt: 'Trim it.', manualFix: { kind: 'claude-md', text: 'Delete the Godot section.' }, ifApplied: {}, ifSkipped: {} }] }))
  expect(recs[0]?.manualFix).toEqual({ kind: 'claude-md', text: 'Delete the Godot section.' })
})

const world = (on: On, writes: string[], filled: string[], toolFails = false) => {
  mock.store(on)
  mock.clock(on, { now: 1000 })
  mock.env(on, { HOME: '/Users/kevin' })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', () => (toolFails ? ({ result: { ok: false } as never, isError: true } as never) : { result: { ok: true } as never }))
  on('ui.copy', () => ({ value: { isCopied: false, reason: 'no-surface' } as never }))
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('fs.write', ($, e) => {
    writes.push(`${e.path}::${e.text.slice(0, 30)}`)
    return { value: undefined }
  })
  on('model.complete', () => ({ value: { isAnswered: true as const, text: '{"verdict":"drifting","note":"n","nudge":"Run the tests now."}', usage: USAGE } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine draws') as never
  })
}

test('Copy falls back to the prompt box, and Copy report to a saved file', { options: { analyzeEvery: 0 } }, async ($, on) => {
  const writes: string[] = []
  const filled: string[] = []
  world(on, writes, filled)
  for (let i = 0; i < 6; i++) await $.tool.call({ tool: 'Write', file_path: `f${i}.ts`, content: 'x' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' as const })

  const ui = await $.ui.mount({ plugin: 'session-coach', surface: 'desktop', component: 'Pane', requestId: 'session-coach', props: { bodyColumns: 100 } as never })
  expect((await ui.find({ key: 'tip-verify-text' }))?.text).toContain('Send this while Claude works:')
  expect((await ui.find({ key: 'tip-verify-text' }))?.text).toContain('**When:** Now, while Claude is working.')

  await ui.press({ key: 'tip-verify-copy' })
  expect(filled.at(-1)).toContain("Run the project's tests, linter and type checker now")
  expect((await ui.find({ key: 'status' }))?.text).toContain('This app does not let plugins copy, so The fix is in your prompt box')

  await ui.press({ key: 'tip-verify-permanent-fill' })
  expect(filled.at(-1)).toBe('Add this to ~/.claude/CLAUDE.md. Show me the diff before writing.\n\n- After every meaningful change, run the tests, linter and type checker, and show the real output.')

  await ui.press({ key: 'copy-report' })
  expect(writes.at(-1)?.replaceAll('\\', '/').startsWith('/Users/kevin/.claude/session-coach/export.md::# Session coach report')).toBe(true)
  expect((await ui.find({ key: 'status' }))?.text).toContain('the session report is saved to /Users/kevin/.claude/session-coach/export.md')
  await ui.unmount()
})

test('timing says when to send each fix, depending on whether Claude is working', async () => {
  const btw = parseFix({ kind: 'prompt', text: 'What does gate.ps1 deny?', when: 'btw' })!
  expect(fixPromptText(btw)).toBe('/btw What does gate.ps1 deny?')
  expect(fixMarkdown(btw)).toContain('Ask this on the side:')
  expect(parseFix({ kind: 'prompt', text: 'x', when: 'whenever' })?.when).toBeUndefined()

  expect(promptedMessage({ label: 'The fix', when: 'interrupt', isWorking: true })).toBe('The fix is in your prompt box. Press Esc to stop Claude, then press Enter to send it.')
  expect(promptedMessage({ label: 'The fix', when: 'next', isWorking: true })).toBe('The fix is in your prompt box. Wait until Claude finishes this turn, then press Enter.')
  expect(promptedMessage({ label: 'The fix', when: 'interrupt', isWorking: false })).toBe('The fix is in your prompt box. Press Enter to send it.')
  expect(promptedMessage({ label: 'The fix', when: 'later', isWorking: false })).toContain('then start a new session')

  expect(parseJudgment('{"verdict":"stuck","note":"n","nudge":"Stop and read the error.","nudgeWhen":"interrupt"}', 2, 0)?.nudgeWhen).toBe('interrupt')
  expect(parseJudgment('{"verdict":"on-track","note":"n","nudgeWhen":"interrupt"}', 2, 0)?.nudgeWhen).toBeUndefined()

  let m = emptyMetrics(0)
  m = recordTool(m, { tool: 'Bash', input: { command: 'make' }, isError: true, isDenied: false })
  m = recordTool(m, { tool: 'Bash', input: { command: 'make' }, isError: true, isDenied: false })
  const loop = tips(m).find(t => t.id === 'loop')
  expect(loop?.fix.when).toBe('interrupt')
})

test('Put in prompt while Claude is working tells you to press Esc for a stop-first fix', { options: { analyzeEvery: 0, judgeTurns: false } }, async ($, on) => {
  const writes: string[] = []
  const filled: string[] = []
  world(on, writes, filled, true)
  on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
  await $.tool.call({ tool: 'Bash', command: 'make' } as never)
  await $.tool.call({ tool: 'Bash', command: 'make' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' as const })
  await $.turn.start({ text: 'next', turnId: 't2' } as never)

  const ui = await $.ui.mount({ plugin: 'session-coach', surface: 'desktop', component: 'Pane', requestId: 'session-coach', props: { bodyColumns: 100 } as never })
  expect((await ui.find({ key: 'tip-loop-text' }))?.text).toContain('Stop Claude, then send this:')
  await ui.press({ key: 'tip-loop-fill' })
  expect(filled.at(-1)).toContain('Stop retrying.')
  expect((await ui.find({ key: 'status' }))?.text).toContain('Press Esc to stop Claude, then press Enter to send it.')
  await ui.unmount()
})
