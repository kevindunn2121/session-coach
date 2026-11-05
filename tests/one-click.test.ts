import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { patchId, tipPatch } from '../hooks/apply'
import { parseInsights } from '../hooks/coach'
import { emptyMetrics, tips } from '../hooks/metrics'

// Ticket 3: live tips on the Fix / Undo / Fix with Claude path, and Undo records that survive a
// plugin reload. The reload tests run in pairs: the first fixes and keeps what the store holds,
// the second starts a fresh plugin from that store, so its $.state is empty, and still finds Undo.

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const HOME = '/Users/kevin'
const CLAUDE_MD = `${HOME}/.claude/CLAUDE.md`
const SETTINGS = `${HOME}/.claude/settings.json`
const VERIFY_LINE = '- After every meaningful change, run the tests, linter and type checker, and show the real output.'
const RULES = '# Rules\n- Be brief.\n'
const RULES_FIXED = `${RULES}\n## Session coach\n\n${VERIFY_LINE}\n`

const VERIFY_PATCH = tipPatch({ kind: 'claude-md', text: VERIFY_LINE })!
const VERIFY_ID = patchId(VERIFY_PATCH)

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
  ],
})

const replyWith = (recommendations: unknown[]) => JSON.stringify({ recommendations })

const OTHER_REC = { id: 'trim-md', area: 'claude-md', title: 'Trim CLAUDE.md', problem: 'p', change: 'c', applyPrompt: 'Trim it.' }

type World = { files: Record<string, string>; submitted?: string[]; store?: Record<string, unknown>; reply?: () => string; isWriteBroken?: boolean }

// The plugin store is a plain object the test holds, so a test can read it and hand it to the
// next test as a fresh plugin load would find it.
const world = (on: On, { files, submitted = [], store = {}, reply = () => PATCH_REPLY, isWriteBroken = false }: World) => {
  on('store.get', ($, e) => ({ value: structuredClone(store[e.key]) }))
  on('store.set', ($, e) => {
    store[e.key] = structuredClone(e.value)
    return { value: undefined }
  })
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, { HOME })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work/game' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } as never }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: { ok: true } as never }))
  on('fs.read', ($, e) => {
    const path = e.path.replaceAll('\\', '/')
    if (path in files) return { value: files[path]! }
    throw new Error('missing')
  })
  on('fs.write', ($, e) => {
    if (isWriteBroken) throw new Error('read-only file system')
    files[e.path.replaceAll('\\', '/')] = e.text
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [] }))
  on('model.complete', ($, e) => {
    const text = typeof e.prompt === 'string' ? e.prompt : JSON.stringify(e.prompt)
    return { value: { isAnswered: true as const, text: text.includes('audit') ? reply() : '{"insights":[]}', usage: USAGE } }
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

const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: 'session-coach', surface: 'desktop', component: 'Pane', requestId: 'session-coach', props: { bodyColumns: 100 } as never })

const mountSetup = ($: Engine) =>
  $.ui.mount({ plugin: 'session-coach', surface: 'desktop', component: 'Pane', requestId: 'session-coach-setup', props: { bodyColumns: 100 } as never })

const startSession = ($: Engine) => $.session.start({ cwd: '/work/game', surface: null, isInteractive: true })

// Six writes and a turn with no test run raise the verify tip.
const raiseVerifyTip = async ($: Engine) => {
  for (let i = 0; i < 6; i++) await $.tool.call({ tool: 'Write', file_path: `f${i}.ts`, content: 'x' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' as const })
}

test('the permanent CLAUDE.md lines of rule tips become patches under one heading', async () => {
  expect(VERIFY_PATCH).toEqual({ kind: 'claude-md-append', target: '~/.claude/CLAUDE.md', heading: '## Session coach', lines: VERIFY_LINE })
  expect(tipPatch({ kind: 'prompt', text: 'Run the tests.' })).toBeUndefined()
  expect(tipPatch({ kind: 'settings', text: '{"hooks":{}}' })).toBeUndefined()
  expect(patchId(VERIFY_PATCH)).toBe(patchId({ ...VERIFY_PATCH }))
  expect(patchId(VERIFY_PATCH)).not.toBe(patchId(tipPatch({ kind: 'claude-md', text: '- Other.' })!))

  const m = { ...emptyMetrics(0), editsSinceVerify: 5, blindEdits: 2, edits: 16, toolCalls: 40 }
  const patched = tips(m).filter(tip => tip.patch).map(tip => tip.id)
  expect(patched.sort()).toEqual(['blind', 'delegate', 'plan', 'verify'])
  expect(tips(m).find(tip => tip.id === 'verify')?.patch).toEqual(VERIFY_PATCH)
})

test('expert suggestions keep a valid patch with their fix and drop the rest', async () => {
  const fix = { kind: 'claude-md', target: '~/.claude/CLAUDE.md', text: '- Plan first.' }
  const good = { kind: 'claude-md-append', target: '~/.claude/CLAUDE.md', heading: '## Workflow', lines: '- Plan first.' }
  const insights = parseInsights(
    JSON.stringify({
      insights: [
        { kind: 'habit', title: 'Plan first', detail: 'd', fix, patch: good },
        { kind: 'hook', title: 'Lint on edit', detail: 'd', fix: { kind: 'settings', text: '{}' }, patch: { kind: 'settings-merge', target: '~/.claude/settings.json', set: { hooks: {} } } },
        { kind: 'habit', title: 'No fix', detail: 'd', patch: good },
      ],
    }),
  )
  expect(insights.map(i => i.patch)).toEqual([good, undefined, undefined])
})

test('a live tip fixes in one click with a backup and a diff, and Undo puts CLAUDE.md back', { options: { analyzeEvery: 0, judgeTurns: false } }, async ($, on) => {
  const submitted: string[] = []
  const files: Record<string, string> = { [CLAUDE_MD]: RULES }
  world(on, { files, submitted })
  await raiseVerifyTip($)

  const ui = await mountPane($)
  expect(await ui.find({ key: 'tip-verify-permanent-send' })).toBeUndefined()
  await ui.press({ key: 'tip-verify-permanent-fix' })
  expect(files[CLAUDE_MD]).toBe(RULES_FIXED)
  expect(files[`${HOME}/.claude/session-coach/backups/${VERIFY_ID}-1970-01-01T00-00-01-000Z-CLAUDE.md`]).toBe(RULES)
  const text = (await ui.find({ key: 'tip-verify-text' }))?.text ?? ''
  expect(text).toContain('Changed `/Users/kevin/.claude/CLAUDE.md`. Start a new session, or run /clear, for Claude to read it. **Undo** puts the file back.')
  expect(text).toContain(`+ ${VERIFY_LINE}`)
  expect(await ui.find({ key: 'tip-verify-permanent-fix' })).toBeUndefined()
  expect(submitted).toEqual([])

  await ui.press({ key: 'tip-verify-permanent-undo' })
  expect(files[CLAUDE_MD]).toBe(RULES)
  expect((await ui.find({ key: 'tip-verify-text' }))?.text).toContain('Undone.')
  expect(await ui.find({ key: 'tip-verify-permanent-fix' })).toBeDefined()
  await ui.unmount()
})

test('Fix with Claude sends a live tip as your prompt, and a fix the plugin cannot write falls back to it', { options: { analyzeEvery: 0, judgeTurns: false } }, async ($, on) => {
  const submitted: string[] = []
  const files: Record<string, string> = { [CLAUDE_MD]: RULES }
  world(on, { files, submitted, isWriteBroken: true })
  await raiseVerifyTip($)

  const ui = await mountPane($)
  await ui.press({ key: 'tip-verify-send' })
  expect(submitted).toEqual(["Run the project's tests, linter and type checker now and show me the real output before you make more edits."])
  expect((await ui.find({ key: 'status' }))?.text).toContain('Sent the fix to Claude.')
  expect(await ui.find({ key: 'tip-verify-permanent-fill' })).toBeDefined()

  await ui.press({ key: 'tip-verify-permanent-fix' })
  expect((await ui.find({ key: 'tip-verify-text' }))?.text).toMatch(/The plugin could not make this change itself: [^\n]*\. Press \*\*Fix with Claude\*\* instead\./)
  await ui.press({ key: 'tip-verify-permanent-send' })
  expect(submitted.at(-1)).toBe(`Add this to ~/.claude/CLAUDE.md. Show me the diff before writing.\n\n${VERIFY_LINE}`)
  await ui.unmount()
})

let tipStore: Record<string, unknown> | undefined

test('reload, part 1: a live-tip fix is saved to the plugin store', { options: { analyzeEvery: 0, judgeTurns: false } }, async ($, on) => {
  const files: Record<string, string> = { [CLAUDE_MD]: RULES }
  const store: Record<string, unknown> = {}
  world(on, { files, store })
  await raiseVerifyTip($)
  const ui = await mountPane($)
  await ui.press({ key: 'tip-verify-permanent-fix' })
  await ui.unmount()

  const saved = store.tipApplied as { states: Record<string, string>; applied: Record<string, { path: string; title: string }> }
  expect(saved.states[VERIFY_ID]).toBe('applied')
  expect(saved.applied[VERIFY_ID]?.path).toBe(CLAUDE_MD)
  tipStore = structuredClone(store)
})

test('reload, part 2: a fresh plugin finds the live-tip Undo after the tip is gone, and Undo works', { options: { analyzeEvery: 0, judgeTurns: false, openPane: 'command' } }, async ($, on) => {
  expect(tipStore).toBeDefined()
  const backup = `${HOME}/.claude/session-coach/backups/${VERIFY_ID}-1970-01-01T00-00-01-000Z-CLAUDE.md`
  const files: Record<string, string> = { [CLAUDE_MD]: RULES_FIXED, [backup]: RULES }
  world(on, { files, store: tipStore })

  const before = await mountPane($)
  expect(await before.find({ key: `undo-${VERIFY_ID}` })).toBeUndefined()
  await before.unmount()

  await startSession($)
  const ui = await mountPane($)
  expect(await ui.find({ key: 'tip-verify-text' })).toBeUndefined()
  expect(await ui.find({ text: /Earlier fixes you can undo/ })).toBeDefined()
  expect((await ui.find({ key: `earlier-text-${VERIFY_ID}` }))?.text).toContain('After every meaningful change')
  await ui.press({ key: `undo-${VERIFY_ID}` })
  expect(files[CLAUDE_MD]).toBe(RULES)
  expect((await ui.find({ key: 'status' }))?.text).toContain('Undone. /Users/kevin/.claude/CLAUDE.md is back as it was.')
  expect(await ui.find({ key: `undo-${VERIFY_ID}` })).toBeUndefined()
  await ui.unmount()
})

let setupStore: Record<string, unknown> | undefined
const SETTINGS_BEFORE = '{\n  "model": "opus"\n}\n'

test('reload, part 3: a setup fix is saved to the store with the audit fingerprint', { options: { analyzeEvery: 0, judgeTurns: false } }, async ($, on) => {
  const files: Record<string, string> = { [SETTINGS]: SETTINGS_BEFORE }
  const store: Record<string, unknown> = {}
  world(on, { files, store })
  await $.command.run({ command: 'coach', args: 'setup' } as never)
  const ui = await mountSetup($)
  await ui.press({ key: 'fix-deny-prod' })
  await ui.unmount()

  const audit = store.setupAudit as { fingerprint: string }
  const saved = store.setupApplied as { fingerprint: string; states: Record<string, string> }
  expect(saved.fingerprint).toBe(audit.fingerprint)
  expect(saved.states['deny-prod']).toBe('applied')
  setupStore = structuredClone(store)
})

test('reload, part 4: a fresh plugin still shows Undo on the setup card, and Undo works', { options: { analyzeEvery: 0, judgeTurns: false, openPane: 'command' } }, async ($, on) => {
  expect(setupStore).toBeDefined()
  const files: Record<string, string> = {
    [SETTINGS]: JSON.stringify({ model: 'opus', permissions: { deny: ['Bash(snow sql:*)'] } }, null, 2) + '\n',
    [`${HOME}/.claude/session-coach/backups/deny-prod-1970-01-01T00-00-01-000Z-settings.json`]: SETTINGS_BEFORE,
  }
  world(on, { files, store: setupStore })
  await startSession($)

  const ui = await mountSetup($)
  expect((await ui.find({ key: 'text-deny-prod' }))?.text).toContain('+       "Bash(snow sql:*)"')
  expect(await ui.find({ key: 'fix-deny-prod' })).toBeUndefined()
  await ui.press({ key: 'undo-deny-prod' })
  expect(files[SETTINGS]).toBe(SETTINGS_BEFORE)
  expect(await ui.find({ text: /Undone\./ })).toBeDefined()
  await ui.unmount()
})

test('a re-audit keeps Undo for a fix it no longer lists, and moves a reused id aside', { options: { analyzeEvery: 0, judgeTurns: false } }, async ($, on) => {
  const files: Record<string, string> = { [SETTINGS]: SETTINGS_BEFORE }
  const store: Record<string, unknown> = {}
  let reply = PATCH_REPLY
  world(on, { files, store, reply: () => reply })
  await $.command.run({ command: 'coach', args: 'setup' } as never)
  const ui = await mountSetup($)
  await ui.press({ key: 'fix-deny-prod' })
  const fixed = files[SETTINGS]

  reply = replyWith([OTHER_REC])
  await $.command.run({ command: 'coach', args: 'setup refresh' } as never)
  expect(await ui.find({ key: 'text-deny-prod' })).toBeUndefined()
  expect(await ui.find({ text: /Earlier fixes you can undo/ })).toBeDefined()
  expect((await ui.find({ key: 'earlier-text-deny-prod' }))?.text).toContain('Deny prod Snowflake SQL')
  expect(((store.setupApplied) as { states: Record<string, string> }).states['deny-prod']).toBe('applied')

  const reused = { ...JSON.parse(PATCH_REPLY).recommendations[0], patch: { kind: 'settings-merge', target: '~/.claude/settings.json', set: { deny: ['Bash(rm -rf:*)'] } } }
  reply = replyWith([reused, { ...OTHER_REC, id: 'trim-md-2' }])
  await $.command.run({ command: 'coach', args: 'setup refresh' } as never)
  expect(await ui.find({ key: 'fix-deny-prod' })).toBeDefined()
  expect(await ui.find({ key: 'undo-earlier-deny-prod' })).toBeDefined()
  expect(files[SETTINGS]).toBe(fixed)

  await ui.press({ key: 'undo-earlier-deny-prod' })
  expect(files[SETTINGS]).toBe(SETTINGS_BEFORE)
  expect(await ui.find({ key: 'undo-earlier-deny-prod' })).toBeUndefined()
  await ui.unmount()
})
