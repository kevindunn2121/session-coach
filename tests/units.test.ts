import { expect, test } from 'claude-code/testing'

import { parseInsights, reportMarkdown } from '../hooks/coach'
import { SEED_PLAYBOOK, collectPosts, mergePosts, parseFeed, parsePlaybook, parseRedditJson, playbookPrompt, recencyWeight, splitList } from '../hooks/feed'
import type { FetchText } from '../hooks/feed'
import { parseJudgment, sparkline, turnDelta } from '../hooks/judge'
import { classifyPrompt, emptyMetrics, recordPrompt, recordTool, score, tips } from '../hooks/metrics'

const tool = (name: string, input: Record<string, unknown>, isError = false) => ({ tool: name, input, isError, isDenied: false })

test('an edit to a file never read counts as blind; a read first does not', async () => {
  let m = emptyMetrics(0)
  m = recordTool(m, tool('Edit', { file_path: 'C:\\src\\a.ts' }))
  m = recordTool(m, tool('Read', { file_path: 'c:/src/b.ts' }))
  m = recordTool(m, tool('Edit', { file_path: 'C:\\SRC\\b.ts' }))

  expect(m.edits).toBe(2)
  expect(m.blindEdits).toBe(1)
})

test('a test run resets the edits-since-verify count', async () => {
  let m = emptyMetrics(0)
  for (let i = 0; i < 6; i++) m = recordTool(m, tool('Write', { file_path: `f${i}.ts` }))
  expect(m.editsSinceVerify).toBe(6)
  expect(tips(m).some(t => t.id === 'verify')).toBe(true)

  m = recordTool(m, tool('Bash', { command: 'npm test' }))
  expect(m.editsSinceVerify).toBe(0)
  expect(m.verifyRuns).toBe(1)
})

test('the same failing command twice is a repeated failure', async () => {
  let m = emptyMetrics(0)
  m = recordTool(m, tool('Bash', { command: 'make build' }, true))
  m = recordTool(m, tool('Bash', { command: 'make build' }, true))

  expect(m.failedCommands).toBe(2)
  expect(m.repeatedFailures).toBe(1)
  expect(tips(m)[0]?.id).toBe('loop')
})

test('prompts are classified by files, criteria, vagueness and rework', async () => {
  expect(classifyPrompt('Fix the null check in src/auth.ts so login tests pass')).toEqual({ isSpecific: true, hasCriteria: true, isRework: false, isVague: false })
  expect(classifyPrompt('make it better').isVague).toBe(true)
  expect(classifyPrompt('yes').isVague).toBe(false)
  expect(classifyPrompt("no, that's still broken").isRework).toBe(true)

  const m = recordPrompt(emptyMetrics(0), 'make it better')
  expect(m.vaguePrompts).toBe(1)
  expect(m.recentPrompts).toEqual(['make it better'])
})

test('score stays within 0..100 and each part within 0..20', async () => {
  let m = emptyMetrics(0)
  for (let i = 0; i < 30; i++) {
    m = recordTool(m, tool('Edit', { file_path: `x${i}.ts` }))
    m = recordTool(m, tool('Bash', { command: 'boom' }, true))
  }
  const s = score(m)
  expect(s.total).toBeGreaterThanOrEqual(0)
  expect(s.total).toBeLessThanOrEqual(100)
  for (const part of Object.values(s.parts)) {
    expect(part).toBeGreaterThanOrEqual(0)
    expect(part).toBeLessThanOrEqual(20)
  }
})

test('feeds parse from Reddit JSON, RSS and Atom', async () => {
  const reddit = JSON.stringify({ data: { children: [{ data: { title: 'Use plan mode', selftext: 'It helps', score: 120 } }] } })
  expect(parseRedditJson(reddit, 'r/ClaudeAI')).toEqual([{ source: 'r/ClaudeAI', title: 'Use plan mode', body: 'It helps', score: 120, publishedAt: 0 }])

  const rss = '<rss><channel><item><title>Hooks &amp; skills</title><description><![CDATA[<p>Run the <b>linter</b></p>]]></description></item></channel></rss>'
  expect(parseFeed(rss, '@bcherny')[0]).toEqual({ source: '@bcherny', title: 'Hooks & skills', body: 'Run the linter', score: 0, publishedAt: 0 })

  const atom = '<feed><entry><title type="html">Subagents</title><summary>Delegate reads</summary></entry></feed>'
  expect(parseFeed(atom, 'blog')[0]?.body).toBe('Delegate reads')

  expect(splitList(' a, b ,,c ')).toEqual(['a', 'b', 'c'])
})

test('collectPosts falls back from blocked Reddit JSON to RSS and across X mirrors', async () => {
  const fetched: string[] = []
  const fetchText: FetchText = async url => {
    fetched.push(url)
    if (url.includes('top.json')) return { ok: true, status: 200, text: '<html>blocked</html>' }
    if (url.includes('top/.rss')) return { ok: true, status: 200, text: '<feed><entry><title>From RSS</title></entry></feed>' }
    if (url.startsWith('https://down.example')) return { ok: false, status: 503, text: '' }
    return { ok: true, status: 200, text: '<rss><item><title>Post by handle</title></item></rss>' }
  }

  const posts = await collectPosts(fetchText, {
    subreddits: ['ClaudeAI'],
    xHandles: ['karpathy'],
    xMirrors: ['https://down.example/{handle}/rss', 'https://up.example/{handle}/rss'],
    extraFeeds: [],
    pasted: ['pasted tip'],
  })

  expect(posts.map(p => p.source)).toEqual(['r/ClaudeAI', '@karpathy', 'pasted from X'])
  expect(fetched).toContain('https://up.example/karpathy/rss')
})

test('playbook and insight replies parse from JSON wrapped in prose', async () => {
  const reply = 'Here you go:\n{"practices":[{"practice":"Write tests first","why":"closes the loop","signal":"test runs"}],"tools":[{"kind":"hook","name":"lint-on-edit","what":"runs lint"},{"kind":"bogus","name":"x","what":"y"}]}'
  const playbook = parsePlaybook(reply, [{ source: 'r/ClaudeAI', title: 't', body: '', score: 1 }], 5)
  expect(playbook?.practices.length).toBe(1)
  expect(playbook?.tools[1]?.kind).toBe('habit')
  expect(playbook?.sources).toEqual(['r/ClaudeAI'])
  expect(parsePlaybook('no json here', [], 0)).toBeUndefined()

  const insights = parseInsights('{"insights":[{"kind":"skill","title":"Add a TDD skill","detail":"You edit without tests.","name":"tdd"},{"title":""}]}')
  expect(insights).toEqual([{ kind: 'skill', title: 'Add a TDD skill', detail: 'You edit without tests.', name: 'tdd', priority: 3, category: 'workflow', stage: 'build' }])
})

test('the report compares against history', async () => {
  const m = emptyMetrics(0)
  const s = score(m)
  const report = reportMarkdown(m, s, [], [], SEED_PLAYBOOK, [{ endedAt: 1, total: s.total - 10, turns: 3, tokens: 100 }], 60000)
  expect(report).toContain(`**Score ${s.total}/100** (+10 vs your average`)
})

test('feeds read their publish dates, and the playbook prompt puts fresh posts first', async () => {
  const now = Date.parse('2026-10-29T12:00:00Z')
  const day = 24 * 60 * 60 * 1000
  const reddit = JSON.stringify({ data: { children: [{ data: { title: 't', score: 1, created_utc: 1792929600 } }] } })
  expect(parseRedditJson(reddit, 'r/ClaudeCode')[0]?.publishedAt).toBe(1792929600000)
  const rss = '<rss><item><title>Dated</title><pubDate>Tue, 27 Oct 2026 08:00:00 GMT</pubDate></item></rss>'
  expect(parseFeed(rss, 'blog')[0]?.publishedAt).toBe(Date.parse('2026-10-27T08:00:00Z'))
  const atom = '<feed><entry><title>Atom</title><updated>2026-10-28T08:00:00Z</updated></entry></feed>'
  expect(parseFeed(atom, 'blog')[0]?.publishedAt).toBe(Date.parse('2026-10-28T08:00:00Z'))

  expect(recencyWeight(now - 2 * day, now)).toBe(1)
  expect(recencyWeight(now - 14 * day, now)).toBe(0.5)
  expect(recencyWeight(0, now)).toBe(0.5)

  const prompt = playbookPrompt([
    { source: 'old', title: 'Stale advice', body: '', score: 0, publishedAt: now - 40 * day },
    { source: 'undated', title: 'Undated advice', body: '', score: 0 },
    { source: 'fresh', title: 'Fresh advice', body: '', score: 0, publishedAt: now - day },
  ], now)
  const order = ['[fresh, 1d old] Fresh advice', '[undated] Undated advice', '[old, 40d old] Stale advice'].map(line => prompt.indexOf(line))
  expect(order.every(index => index >= 0)).toBe(true)
  expect(order).toEqual([...order].sort((a, b) => a - b))
})

test('merging posts drops duplicates by title, keeping the first', async () => {
  const merged = mergePosts(
    [{ source: 'simonwillison.net', title: 'Use Plan Mode!', body: '', score: 9 }],
    [{ source: 'r/ClaudeAI', title: 'use plan mode', body: 'dup', score: 1 }, { source: 'r/ClaudeAI', title: 'Other', body: '', score: 1 }],
  )
  expect(merged.map(p => p.source + ':' + p.title)).toEqual(['simonwillison.net:Use Plan Mode!', 'r/ClaudeAI:Other'])
})

test('judgments parse, reject unknown verdicts, and the trail draws', async () => {
  expect(parseJudgment('ok {"verdict":"stuck","note":"Same test fails","nudge":"Read the stack trace"}', 4, 9)).toEqual({ turn: 4, at: 9, verdict: 'stuck', note: 'Same test fails', nudge: 'Read the stack trace' })
  expect(parseJudgment('{"verdict":"great","note":"x"}', 1, 1)).toBeUndefined()
  expect(sparkline([0, 50, 100])).toBe('▁▅█')

  let after = emptyMetrics(0)
  after = recordTool(after, tool('Bash', { command: 'npm test' }, true))
  expect(turnDelta(emptyMetrics(0), after)).toEqual({ toolCalls: 1, edits: 0, verifyRuns: 1, failedCommands: 1, repeatedFailures: 0, denials: 0 })
})
