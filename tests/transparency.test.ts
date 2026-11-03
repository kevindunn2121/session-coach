import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Playbook } from '../types'
import { SEED_PLAYBOOK, buildTrail, parseFeed, parsePlaybook, parseRedditJson, playbookPrompt, selectPosts } from '../hooks/feed'
import type { Post } from '../hooks/feed'
import { RULE_CATALOG } from '../hooks/metrics'
import { renderTransparency } from '../hooks/transparency'
import { VITAL_CATALOG } from '../hooks/vitals'

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-29T12:00:00Z')

const post = (over: Partial<Post>): Post => ({ source: 'blog.example', title: 't', body: '', score: 0, publishedAt: NOW - DAY, ...over })

const input = (playbook: Playbook, over: Partial<Parameters<typeof renderTransparency>[0]> = {}) => ({
  playbook,
  trail: null,
  feed: null,
  analysisModel: 'claude-sonnet-5-5',
  judgeModel: 'claude-haiku-5-5',
  analyzeEvery: 3,
  generatedAt: NOW,
  ...over,
})

test('feeds keep each post link: RSS link, Atom href and Reddit permalink', async () => {
  const rss = '<rss><item><title>A</title><link>https://blog.example/a</link></item></rss>'
  expect(parseFeed(rss, 'blog')[0]?.url).toBe('https://blog.example/a')

  const atom = '<feed><entry><title>B</title><link rel="alternate" href="https://blog.example/b?x=1&amp;y=2"/></entry></feed>'
  expect(parseFeed(atom, 'blog')[0]?.url).toBe('https://blog.example/b?x=1&y=2')

  const unsafe = '<rss><item><title>C</title><link>javascript:alert(1)</link></item></rss>'
  expect(parseFeed(unsafe, 'blog')[0]?.url).toBeUndefined()

  const reddit = JSON.stringify({ data: { children: [{ data: { title: 'D', score: 3, permalink: '/r/ClaudeCode/comments/1/d/' } }] } })
  expect(parseRedditJson(reddit, 'r/ClaudeCode')[0]?.url).toBe('https://www.reddit.com/r/ClaudeCode/comments/1/d/')
})

test('the prompt numbers each post, and the playbook keeps only citations of posts the model saw', async () => {
  const posts = [post({ title: 'Fresh' }), post({ title: 'Old', publishedAt: NOW - 30 * DAY })]
  const { sent } = selectPosts(posts, NOW)
  expect(sent.map(item => `${item.n}:${item.post.title}`)).toEqual(['1:Fresh', '2:Old'])

  const prompt = playbookPrompt(posts, NOW)
  expect(prompt).toContain('#1 [blog.example, 1d old] Fresh')
  expect(prompt).toContain('#2 [blog.example, 30d old] Old')
  expect(prompt).toContain('"evidence":[1,4]')

  const reply = JSON.stringify({
    practices: [
      { practice: 'Cites both', why: 'w', signal: 's', evidence: [2, '#1', 1, 9, 0, 'x'] },
      { practice: 'Cites nothing', why: 'w', signal: 's', evidence: [] },
      { practice: 'No field', why: 'w', signal: 's' },
    ],
    tools: [{ kind: 'hook', name: 'gate', what: 'w', evidence: [1] }],
  })
  const built = parsePlaybook(reply, posts, NOW)
  expect(built?.practices.map(p => p.evidence)).toEqual([[2, 1], undefined, undefined])
  expect(built?.tools[0]?.evidence).toEqual([1])
})

test('the trail counts every source tried, including ones that gave nothing', async () => {
  const config = { subreddits: ['ClaudeCode'], xHandles: ['karpathy'], xMirrors: [], extraFeeds: ['https://blog.example/feed', 'https://quiet.example/rss'], pasted: [] }
  const fetched = [post({ title: 'A', url: 'https://blog.example/a' }), post({ title: 'A' }), post({ title: 'B', source: 'r/ClaudeCode', score: 40 })]
  const kept = [fetched[0] as Post, fetched[2] as Post]

  const trail = buildTrail(config, fetched, kept, NOW, 'claude-sonnet-5-5')
  expect(trail.sources).toEqual([
    { source: 'r/ClaudeCode', fetched: 1, kept: 1, sent: 1 },
    { source: 'blog.example', fetched: 2, kept: 1, sent: 1 },
    { source: 'quiet.example', fetched: 0, kept: 0, sent: 0 },
  ])
  expect(trail.skippedHandles).toEqual(['karpathy'])
  expect([trail.fetched, trail.kept, trail.posts.length]).toEqual([3, 2, 2])
  expect(trail.posts[0]).toEqual({ n: 1, source: 'r/ClaudeCode', title: 'B', score: 40, publishedAt: NOW - DAY, weight: 1, rank: 6.36 })
  expect(trail.posts[1]?.url).toBe('https://blog.example/a')
  expect(trail.promptChars).toBeGreaterThan(0)
})

test('every built-in rule has a trigger the page can show', async () => {
  const rules = [...RULE_CATALOG, ...VITAL_CATALOG]
  expect(rules.length).toBe(17)
  for (const rule of rules) expect(rule.trigger.length).toBeGreaterThan(10)
  expect(new Set(rules.map(rule => rule.id)).size).toBe(rules.length)
})

test('the page links each practice to the posts behind it, and escapes feed text', async () => {
  const posts = [post({ title: '<script>alert(1)</script>', url: 'https://blog.example/x' }), post({ title: 'Second', url: 'javascript:alert(1)' })]
  const playbook: Playbook = {
    fetchedAt: NOW,
    sources: ['blog.example'],
    postCount: 2,
    practices: [
      { practice: 'Backed', why: 'w', signal: 's', stage: 'verify', evidence: [1] },
      { practice: 'Unbacked', why: 'w', signal: 's', stage: 'plan' },
    ],
    tools: [{ kind: 'hook', name: 'gate', what: 'w', stage: 'safety', evidence: [2] }],
  }
  const trail = buildTrail({ subreddits: [], xHandles: [], xMirrors: [], extraFeeds: ['https://blog.example/feed'], pasted: [] }, posts, posts, NOW, 'claude-sonnet-5-5')
  const html = renderTransparency(input(playbook, { trail, feed: { state: 'ok', message: 'ok', fetchedAt: NOW, postCount: 2 } }))

  expect(html.startsWith('<!doctype html>')).toBe(true)
  expect(html).not.toContain('<script>alert')
  expect(html).not.toContain('href="javascript:')
  expect(html).toContain('<a href="https://blog.example/x" rel="noopener">&lt;script&gt;alert(1)&lt;/script&gt;</a>')
  expect(html).toContain('id="post-1" class="cited"')
  expect(html).toContain('<a href="#p1">P1</a>')
  expect(html).toContain('<a href="#t1">T1</a>')
  expect(html).toContain('Backed by <a class="cite" href="#post-1">#1</a>')
  expect(html).toContain('No post cited')
  expect(html).toContain('Uncommitted changes on main or master.')
  expect(html).toContain('every 3 turns')
  expect(html).toContain('href="playbook-line-map.html"')
  for (const id of ['sources', 'rank', 'cut', 'distill', 'engine']) expect(html.split(`id="${id}"`).length - 1).toBe(1)
})

test('the seed playbook gets a page that says no feed has been read', async () => {
  const html = renderTransparency(input(SEED_PLAYBOOK))
  expect(html).toContain('built-in seed playbook, so no feed has been read yet')
  expect(html).toContain('Explore, plan, then code')
  expect(html).not.toContain('Last refresh failed')
})

const recordWrites = (on: On) => {
  const writes: { path: string; text: string }[] = []
  on('fs.write', ($, e) => {
    writes.push({ path: e.path.replaceAll('\\', '/'), text: e.text })
    return { value: undefined }
  })
  return writes
}

const pane = { plugin: 'session-coach', component: 'Pane', requestId: 'session-coach', surface: 'desktop', props: { bodyColumns: 100 } as never } as const

test(
  'each feed refresh writes the transparency page with the cited posts, and the pane shows its path',
  { options: { analyzeEvery: 0, judgeTurns: false, subreddits: '', xHandles: '', extraFeeds: 'https://blog.example/feed' } },
  async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: NOW })
    mock.env(on, { HOME: '/Users/kevin' })
    const writes = recordWrites(on)
    on('fs.read', ($, e) => {
      if (e.path.replaceAll('\\', '/').endsWith('/docs/session-coach-guide.html')) return { value: '<!doctype html><title>Guide</title>' }
      throw new Error(`ENOENT: ${e.path}`)
    })
    on('http.fetch', () => ({
      value: { status: 200, ok: true, headers: {}, text: '<rss><item><title>Run the tests</title><link>https://blog.example/tests</link><pubDate>Wed, 28 Oct 2026 08:00:00 GMT</pubDate></item></rss>' },
    }))
    on('model.complete', () => ({
      value: { isAnswered: true as const, text: '{"practices":[{"practice":"Close the loop","why":"w","signal":"s","stage":"verify","evidence":[1]}],"tools":[]}', usage: USAGE },
    }))

    await $.command.run({ command: 'coach', args: 'refresh' } as never)
    const page = writes.find(write => write.path === '/Users/kevin/.claude/session-coach/playbook-transparency.html')?.text ?? ''
    expect(page).toContain('<a href="https://blog.example/tests" rel="noopener">Run the tests</a>')
    expect(page).toContain('Backed by <a class="cite" href="#post-1">#1</a>')
    expect(page).toContain('Model <b>claude-sonnet-5-5</b>')
    const map = writes.find(write => write.path === '/Users/kevin/.claude/session-coach/playbook-line-map.html')?.text ?? ''
    expect(map).toContain('<a href="playbook-transparency.html">')
    expect(map).toContain('<a href="session-coach-guide.html">')
    for (const [html, current] of [[page, 'playbook-transparency.html'], [map, 'playbook-line-map.html']] as const) {
      expect(html).toContain('<html lang="en" data-theme="dark">')
      expect(html.split('class="site-nav"').length - 1).toBe(1)
      expect(html).toContain(`<a href="${current}" aria-current="page">`)
      for (const file of ['session-coach-guide.html', 'playbook-line-map.html', 'playbook-transparency.html']) expect(html).toContain(`<a href="${file}"`)
    }
    expect(writes.find(write => write.path === '/Users/kevin/.claude/session-coach/session-coach-guide.html')?.text).toBe('<!doctype html><title>Guide</title>')

    const again = await $.command.run({ command: 'coach', args: 'transparency' } as never)
    expect(again.text).toBe('Transparency page written to /Users/kevin/.claude/session-coach/playbook-transparency.html. Open it in a browser.')
    expect(writes.at(-1)?.text).toContain('Close the loop')

    const ui = await $.ui.mount(pane)
    expect(await ui.find({ text: /How the advice was built: `\/Users\/kevin\/\.claude\/session-coach\/playbook-transparency\.html`/ })).toBeDefined()
    await ui.unmount()
  },
)
