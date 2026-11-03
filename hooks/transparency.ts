import type { FeedStatus, Playbook, PlaybookTrail, Priority, Stage, TrailPost } from '../types'
import { PROMPT_CHARS } from './feed'
import { MAP_STYLE, builtOn, escapeHtml, practiceStage, toolStage } from './map'
import { GUIDE_FILE, MAP_FILE, NAV_STYLE, siteNav } from './nav'
import { RULE_CATALOG } from './metrics'
import type { RuleEntry } from './metrics'
import { CATEGORY_LABEL, PRIORITY_LABEL, RANK_RULES, STAGE_LABEL } from './rank'
import { VITAL_CATALOG } from './vitals'

export type TransparencyInput = {
  playbook: Playbook
  trail: PlaybookTrail | null
  feed: FeedStatus | null
  analysisModel: string
  judgeModel: string
  analyzeEvery: number
  generatedAt: number
}

const DAY_MS = 24 * 60 * 60 * 1000

const WHEN_LABEL: Record<RuleEntry['when'], string> = { btw: 'Side question', steer: 'Steer now', next: 'Next prompt', interrupt: 'Stop first', later: 'After this session' }

const PRIORITY_VAR: Record<Priority, string> = { 1: 'safety', 2: 'start', 3: 'verify', 4: 'build' }

const isoDay = (at: number): string => (at > 0 ? new Date(at).toISOString().slice(0, 10) : 'never')

const isoMinute = (at: number): string => (at > 0 ? `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'never')

const stageChip = (stage: Stage): string => `<span class="chip" style="--c: var(--${stage})">${escapeHtml(STAGE_LABEL[stage])}</span>`

const priorityChip = (priority: Priority): string => `<span class="chip" style="--c: var(--${PRIORITY_VAR[priority]})">${escapeHtml(PRIORITY_LABEL[priority])}</span>`

const postAge = (post: TrailPost, builtAt: number): string =>
  post.publishedAt ? `${Math.max(0, Math.floor((builtAt - post.publishedAt) / DAY_MS))}d` : 'undated'

const postTitle = (post: TrailPost): string => {
  const title = escapeHtml(post.title || '(no title)')
  return post.url && /^https?:\/\//i.test(post.url) ? `<a href="${escapeHtml(post.url)}" rel="noopener">${title}</a>` : title
}

const evidenceLinks = (evidence: number[] | undefined): string =>
  evidence && evidence.length > 0
    ? `<span class="cites">Backed by ${evidence.map(n => `<a class="cite" href="#post-${n}">#${n}</a>`).join(' ')}</span>`
    : '<span class="cites none">No post cited: the model\'s own synthesis</span>'

/** For each post number, the practices (P1…) and tools (T1…) that cite it. */
const citedBy = (playbook: Playbook): Map<number, string[]> => {
  const map = new Map<number, string[]>()
  const add = (n: number, label: string) => map.set(n, [...(map.get(n) ?? []), label])
  playbook.practices.forEach((practice, i) => practice.evidence?.forEach(n => add(n, `P${i + 1}`)))
  playbook.tools.forEach((tool, i) => tool.evidence?.forEach(n => add(n, `T${i + 1}`)))
  return map
}

const noTrail = (playbook: Playbook): string =>
  `<p class="empty">${
    playbook.fetchedAt > 0
      ? 'This playbook was built before the coach recorded its work.'
      : 'This is the built-in seed playbook, so no feed has been read yet.'
  } Press Refresh feed in the coach pane, or run /coach refresh, to record a full trail.</p>`

const funnel = (playbook: Playbook, trail: PlaybookTrail | null): string => {
  const steps: [string, string, string][] = trail
    ? [
        [String(trail.fetched), 'posts fetched', `${trail.sources.filter(s => s.fetched > 0).length} of ${trail.sources.length} sources answered`],
        [String(trail.kept), 'kept', `${trail.fetched - trail.kept} duplicates removed`],
        [String(trail.posts.length), 'sent to the model', `${trail.kept - trail.posts.length} cut at ${trail.promptLimit.toLocaleString('en-US')} characters`],
        [`${playbook.practices.length} + ${playbook.tools.length}`, 'practices + tools', `${[...playbook.practices, ...playbook.tools].filter(item => item.evidence?.length).length} cite a post`],
      ]
    : [['–', 'posts fetched', 'no trail yet'], ['–', 'kept', ''], ['–', 'sent to the model', ''], [`${playbook.practices.length} + ${playbook.tools.length}`, 'practices + tools', 'built-in seed']]
  return `<ol class="funnel" aria-label="From posts to playbook">${steps
    .map(([num, label, note]) => `<li><b>${escapeHtml(num)}</b><span>${escapeHtml(label)}</span>${note ? `<small>${escapeHtml(note)}</small>` : ''}</li>`)
    .join('')}</ol>`
}

const sourcesSection = (trail: PlaybookTrail | null, playbook: Playbook): string => {
  if (trail === null) return noTrail(playbook)
  const rows = trail.sources
    .map(
      source =>
        `<tr class="${source.fetched === 0 ? 'zero' : ''}"><td><code>${escapeHtml(source.source)}</code></td><td>${source.fetched === 0 ? 'no posts reached' : source.fetched}</td><td>${source.kept}</td><td>${source.sent}</td></tr>`,
    )
    .join('')
  const skipped =
    trail.skippedHandles.length > 0
      ? `<p class="note">X has no free API and no mirror is set, so ${trail.skippedHandles.length} X accounts were not read: ${trail.skippedHandles.map(h => `<code>@${escapeHtml(h)}</code>`).join(' ')}. Set <code>xMirrors</code> to read them, or save posts with <code>/coach paste</code>.</p>`
      : ''
  return `<div class="tablewrap"><table><thead><tr><th>Source</th><th>Fetched</th><th>Kept</th><th>Sent</th></tr></thead><tbody>${rows}</tbody></table></div>${skipped}
      <p class="note">Each source gives at most 12 posts. Reddit is read through RSS because its JSON API refuses anonymous clients. Kept means the post survived duplicate removal: two posts with the same title count once.</p>`
}

const RANK_EXPLAINER = `
      <div class="formula" aria-label="Ranking formula"><code>rank = (1 + log2(1 + score)) × recency</code></div>
      <ul class="facts">
        <li><b>Score</b> is the post's upvotes. Only Reddit gives one; every other post starts at 0, so recency decides.</li>
        <li><b>Recency</b> is 1 for a post from the last 7 days. After that it halves for each further week: 0.5 at 14 days, 0.25 at 21.</li>
        <li><b>Undated</b> posts count 0.5. <b>Pasted</b> posts count as new, because you chose them.</li>
      </ul>`

const postsSection = (trail: PlaybookTrail | null, playbook: Playbook): string => {
  if (trail === null) return noTrail(playbook)
  const cites = citedBy(playbook)
  const share = trail.promptLimit > 0 ? Math.min(100, Math.round((trail.promptChars / trail.promptLimit) * 100)) : 0
  const rows = trail.posts
    .map(post => {
      const by = cites.get(post.n) ?? []
      return `<tr id="post-${post.n}" class="${by.length > 0 ? 'cited' : ''}"><td>#${post.n}</td><td><code>${escapeHtml(post.source)}</code></td><td class="title">${postTitle(post)}</td><td>${postAge(post, trail.builtAt)}</td><td>${post.score}</td><td>${post.weight}</td><td>${post.rank}</td><td>${by.length > 0 ? by.map(label => `<a href="#${label.toLowerCase()}">${label}</a>`).join(' ') : '–'}</td></tr>`
    })
    .join('')
  return `
      <div class="meter" role="img" aria-label="${trail.promptChars} of ${trail.promptLimit} characters used"><i style="width: ${share}%"></i></div>
      <p class="note">The model saw <b>${trail.posts.length}</b> posts in <b>${trail.promptChars.toLocaleString('en-US')}</b> of ${trail.promptLimit.toLocaleString('en-US')} characters, best rank first. The next post would not fit, so ${trail.kept - trail.posts.length} lower-ranked posts were cut. Highlighted rows back at least one practice or tool.</p>
      <div class="tablewrap"><table class="posts"><thead><tr><th>#</th><th>Source</th><th>Post</th><th>Age</th><th>Score</th><th>Recency</th><th>Rank</th><th>Cited by</th></tr></thead><tbody>${rows}</tbody></table></div>`
}

const distillSection = (playbook: Playbook, model: string): string => {
  const practices = playbook.practices
    .map((practice, i) => {
      const stage = practiceStage(practice)
      return `<article class="card" id="p${i + 1}" style="--c: var(--${stage})"><span class="eyebrow">P${i + 1} · ${escapeHtml(STAGE_LABEL[stage])}</span><h4>${escapeHtml(practice.practice)}</h4>${practice.why ? `<p class="why">${escapeHtml(practice.why)}</p>` : ''}${evidenceLinks(practice.evidence)}</article>`
    })
    .join('')
  const tools = playbook.tools
    .map((tool, i) => {
      const stage = toolStage(tool)
      return `<li id="t${i + 1}"><b>T${i + 1}</b> <span class="kind" style="--c: var(--${stage})">${escapeHtml(tool.kind)}</span><code>${escapeHtml(tool.name)}</code> ${escapeHtml(tool.what)} ${stageChip(stage)} ${evidenceLinks(tool.evidence)}</li>`
    })
    .join('')
  return `
      <ul class="facts">
        <li>The playbook model, <code>${escapeHtml(model)}</code>, reads the numbered posts as data, not instructions.</li>
        <li>It returns at most 12 practices and 8 tools, skips hype, news and model gossip, and puts each item on a station of the <a href="${MAP_FILE}">line map</a>.</li>
        <li>It cites the posts behind each item by number. A cited number that names no post it saw is dropped.</li>
      </ul>
      <div class="cols">${practices}</div>
      ${tools ? `<div class="box"><h5>Tools to add</h5><ul class="tools">${tools}</ul></div>` : ''}`
}

const ruleRows = (rules: readonly RuleEntry[]): string =>
  [...rules]
    .sort((a, b) => a.priority - b.priority)
    .map(rule => `<tr><td>${priorityChip(rule.priority)}</td><td>${escapeHtml(rule.trigger)}</td><td>${escapeHtml(CATEGORY_LABEL[rule.category])}</td><td>${stageChip(rule.stage)}</td><td>${escapeHtml(WHEN_LABEL[rule.when])}</td></tr>`)
    .join('')

const engineSection = (input: TransparencyInput): string => {
  const cadence = input.analyzeEvery > 0 ? `every ${input.analyzeEvery} turns` : 'only when you press Analyze now'
  return `
      <div class="lanes">
        <div class="lane" style="--c: var(--verify)"><span class="eyebrow">Lane 1 · no model</span><h3>Rule tips</h3><p>Counted from every prompt, tool call and turn. A rule fires when its trigger is met, with a fixed priority, category, station and timing.</p></div>
        <div class="lane" style="--c: var(--build)"><span class="eyebrow">Lane 2 · ${escapeHtml(input.analysisModel)}</span><h3>Expert suggestions</h3><p>Runs ${escapeHtml(cadence)}. Compares your metrics, score, rule tips and profile with the practices above and returns up to 4 suggestions.</p></div>
        <div class="lane" style="--c: var(--setup)"><span class="eyebrow">Lane 3 · ${escapeHtml(input.analysisModel)}</span><h3>Setup audit</h3><p>Runs daily and when your setup files change. Compares CLAUDE.md, settings, skills and agents with your sessions and the playbook.</p></div>
      </div>
      <h3>Every built-in rule</h3>
      <div class="tablewrap"><table><thead><tr><th>Priority</th><th>Fires when</th><th>Category</th><th>Station</th><th>Fix timing</th></tr></thead><tbody>${ruleRows([...RULE_CATALOG, ...VITAL_CATALOG])}</tbody></table></div>
      <h3>How the models rank their advice</h3>
      <blockquote>${escapeHtml(RANK_RULES)}</blockquote>
      <h3>How the list is ordered</h3>
      <ul class="facts">
        <li>Rule tips and expert suggestions share one list, sorted P1 first.</li>
        <li>At the same priority, rule tips come before expert suggestions, each in the order found.</li>
        <li>The turn judge (<code>${escapeHtml(input.judgeModel)}</code>) writes the Now box after each turn. Its verdict is not a recommendation, but a stuck or drifting verdict comes with the next prompt to send.</li>
      </ul>`
}

const banner = (feed: FeedStatus | null, playbook: Playbook): string =>
  feed?.state === 'failed'
    ? `<p class="banner" role="status"><b>Last refresh failed:</b> ${escapeHtml(feed.message)} Everything below is from the playbook built ${escapeHtml(builtOn(playbook))}.</p>`
    : ''

/** How the coach built its playbook and its recommendations, as a standalone HTML page written on each feed refresh. */
export const renderTransparency = (input: TransparencyInput): string => {
  const { playbook, trail, feed } = input
  const model = trail?.model ?? 'not recorded'

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Playbook Transparency</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;800;900&family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@400;600&display=swap">
<style>${MAP_STYLE}${STYLE}${NAV_STYLE}</style>
</head>
<body>
${siteNav('transparency')}
<div class="wrap">
  <header>
    <span class="eyebrow">Session coach · transparency · show our work</span>
    <h1>How the coach built its advice</h1>
    <p class="lede">Each feed refresh writes this page again. It shows what the coach read, how it ranked and cut the posts, which posts back each practice, and the rules that turn the playbook into recommendations.</p>
    <div class="meta">
      <span>Playbook <b>${escapeHtml(builtOn(playbook))}</b></span>
      <span>Model <b>${escapeHtml(model)}</b></span>
      <span>Last refresh <b>${escapeHtml(feed?.state ?? 'not run')}</b></span>
      <span>Page written <b>${escapeHtml(isoMinute(input.generatedAt))}</b></span>
    </div>
  </header>
  ${banner(feed, playbook)}
  ${funnel(playbook, trail)}
  <nav class="steps" aria-label="Steps">
    <a href="#sources">1 Read</a><a href="#rank">2 Rank</a><a href="#cut">3 Cut</a><a href="#distill">4 Distill</a><a href="#engine">5 Recommend</a>
  </nav>

  <section class="step" id="sources"><span class="eyebrow">Step 1</span><h2>Read the sources</h2>
    ${sourcesSection(trail, playbook)}
  </section>

  <section class="step" id="rank"><span class="eyebrow">Step 2</span><h2>Rank by score and age</h2>
    ${RANK_EXPLAINER}
  </section>

  <section class="step" id="cut"><span class="eyebrow">Step 3</span><h2>Cut to fit, then number</h2>
    ${postsSection(trail, playbook)}
  </section>

  <section class="step" id="distill"><span class="eyebrow">Step 4</span><h2>Distill the playbook</h2>
    ${distillSection(playbook, model)}
  </section>

  <section class="step" id="engine"><span class="eyebrow">Step 5</span><h2>Turn it into recommendations</h2>
    ${engineSection(input)}
  </section>

  <footer>
    <span>Written by session-coach on ${escapeHtml(isoDay(input.generatedAt))}. Post titles come from public feeds; pasted posts appear here too, so check them before you share this file.</span>
    <span>The prompt limit is ${PROMPT_CHARS.toLocaleString('en-US')} characters. The <a href="${MAP_FILE}">line map</a> shows the same playbook by station, and the <a href="${GUIDE_FILE}">guide</a> shows how to use the coach.</span>
  </footer>
</div>
</body>
</html>
`
}

const STYLE = `
.banner { border: 2px solid var(--safety); border-radius: 6px; padding: 12px 16px; background: var(--panel); }
.funnel { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 12px; counter-reset: f; }
.funnel li { background: var(--panel); border: 1px solid var(--rule); border-left: 7px solid var(--build); border-radius: 6px; padding: 12px 16px; display: grid; gap: 2px; }
.funnel li:last-child { border-left-color: var(--start); }
.funnel b { font-family: var(--display); font-size: 2.4rem; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; }
.funnel span { font-weight: 700; }
.funnel small { color: var(--muted); font-size: 0.86rem; }
.steps { display: flex; flex-wrap: wrap; gap: 8px; }
.steps a { font-family: var(--mono); font-size: 0.8rem; text-decoration: none; border: 1px solid var(--rule); background: var(--panel); border-radius: 999px; padding: 6px 12px; min-height: 36px; display: inline-flex; align-items: center; }
.step { display: grid; gap: 14px; scroll-margin-top: 16px; }
.step > .eyebrow { color: var(--build); font-weight: 600; }
.tablewrap { overflow-x: auto; background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; }
table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--rule); vertical-align: top; }
th { font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); font-weight: 600; white-space: nowrap; }
td { font-variant-numeric: tabular-nums; }
tbody tr:last-child td { border-bottom: 0; }
tr.zero td { color: var(--muted); font-style: italic; }
tr.cited td { background: color-mix(in srgb, var(--plan) 9%, transparent); }
tr:target td { outline: 2px solid var(--build); outline-offset: -2px; }
.posts td.title { min-width: 260px; }
.note { color: var(--muted); font-size: 0.92rem; }
.formula { background: var(--code-bg); color: var(--code-ink); border-radius: 6px; padding: 14px 18px; font-size: 1.05rem; overflow-x: auto; }
.facts { margin: 0; padding-left: 20px; display: grid; gap: 6px; max-width: 80ch; }
.meter { height: 12px; border-radius: 6px; background: var(--rule); overflow: hidden; }
.meter i { display: block; height: 100%; background: var(--build); }
.cites { font-size: 0.86rem; display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.cites.none { color: var(--muted); font-style: italic; }
.cite { font-family: var(--mono); font-size: 0.78rem; border: 1px solid var(--plan); color: var(--plan); border-radius: 3px; padding: 0 5px; text-decoration: none; }
.card { scroll-margin-top: 16px; }
.card .eyebrow { color: var(--c); font-weight: 600; }
.card:target { outline: 3px solid var(--c); }
.tools { gap: 10px !important; }
.tools li:target { outline: 2px solid var(--build); }
.lanes { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 14px; }
.lane { background: var(--panel); border: 1px solid var(--rule); border-top: 7px solid var(--c); border-radius: 6px; padding: 14px 16px; display: grid; gap: 6px; align-content: start; }
.lane .eyebrow { color: var(--c); font-weight: 600; }
blockquote { margin: 0; border-left: 5px solid var(--build); background: var(--panel); padding: 12px 16px; border-radius: 0 6px 6px 0; font-size: 0.92rem; max-width: 90ch; }
`
