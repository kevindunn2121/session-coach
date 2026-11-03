import type { Playbook, Practice, Stage, ToolIdea } from '../types'
import { STAGES } from './rank'

import { GUIDE_FILE, MAP_FILE, NAV_STYLE, TRANSPARENCY_FILE, siteNav } from './nav'

export { GUIDE_FILE, MAP_FILE, TRANSPARENCY_FILE }

type Station = { stage: Stage; number: number; name: string; title: string; lede: string; watches: string[] }

type Rail = { stage: 'context' | 'safety'; title: string; chips: string[] }

const STATIONS: readonly Station[] = [
  {
    stage: 'start',
    number: 1,
    name: 'Start',
    title: 'The first prompt',
    lede: 'Frame every new project the same way. One prompt sets the goal and the definition of done, asks for a plan before code, names the agents and makes testing and git part of the job from minute one.',
    watches: ['Short prompts with no file or goal (P3 Context)', 'Big changes with no plan step (P2 Workflow)'],
  },
  {
    stage: 'setup',
    number: 2,
    name: 'Set up',
    title: 'Rules, agents and hooks',
    lede: 'Make the good path the default before the first feature: short rules the agent always loads, agents for each kind of work, and hooks that enforce what rules only ask for.',
    watches: ['Setup audit cards: rules the session ignores, stale or bloated CLAUDE.md, missing hooks'],
  },
  {
    stage: 'plan',
    number: 3,
    name: 'Plan',
    title: 'Spec first, code second',
    lede: 'Specification quality, not prompt tricks, separates strong agent users from weak ones. Plan in a separate step and re-plan when work goes sideways.',
    watches: ['Big change with no plan step (P2 Workflow)', 'Two or more correction prompts (P1 Workflow)'],
  },
  {
    stage: 'build',
    number: 4,
    name: 'Build',
    title: 'Delegate and run in parallel',
    lede: 'Routine code goes to cheaper models, judgment stays on the top model, and parallel sessions each get their own worktree so nobody overwrites anybody.',
    watches: ['Edits to files Claude never read (P2 Quality)', 'One file edited 5+ times (P1 Quality)', 'Long session with no subagents (P3 Tokens & cost)'],
  },
  {
    stage: 'verify',
    number: 5,
    name: 'Verify',
    title: 'Close the loop',
    lede: 'An agent that can check its own work and iterates until the check passes produces 2 to 3 times better results. Make it prove things, and review it like a skeptic.',
    watches: ['5+ edits since the last test, lint or type check (P2 Quality)', 'The same command failing twice (P1 Quality)'],
  },
  {
    stage: 'ship',
    number: 6,
    name: 'Ship',
    title: 'Branch, PR, merge',
    lede: 'Small, visible steps reach main through pull requests. Checks run before every merge, and a bad turn is always one revert away.',
    watches: ['Uncommitted changes on main (P2 Git)', '10+ files or 300+ lines uncommitted (P2 Git)', '2+ hours since the last commit with work pending (P3 Git)'],
  },
  {
    stage: 'learn',
    number: 7,
    name: 'Learn',
    title: 'Turn mistakes into rules',
    lede: 'Every repeated correction is a missing rule, skill or eval. Learn feeds straight back into the next Plan.',
    watches: ['Session report and score trend against your average', 'Setup audit: rules worth adding or pruning'],
  },
]

const RAILS: readonly Rail[] = [
  { stage: 'context', title: 'Context & cost line', chips: ['P1 runway', 'P2 context 75%', 'P2 cache hit', 'P1/P2 plan window'] },
  { stage: 'safety', title: 'Safety line', chips: ['PreToolUse guard hook', 'P4 permission asks'] },
]

const STAGE_KEYWORDS: readonly [Stage, RegExp][] = [
  ['safety', /secret|destructive|permission|rm -rf|force.?push|sandbox|danger/i],
  ['context', /context|token|cost|cache|compact|\/clear|window|budget/i],
  ['ship', /\bgit\b|commit|branch|pull request|\bprs?\b|merge|worktree/i],
  ['verify', /test|verif|lint|review|eval|check/i],
  ['learn', /claude\.md|lesson|mistake|correction|retro/i],
  ['plan', /plan|spec|done.?when|acceptance|criteria/i],
  ['setup', /hook|skill|agent|mcp|setting|command/i],
  ['start', /first prompt|kickoff|new project/i],
]

/** The station a practice or tool sits on: its own stage, or a keyword guess for playbooks built before stages existed. */
export const stageOf = (item: { stage?: Stage }, text: string): Stage =>
  item.stage !== undefined && STAGES.includes(item.stage) ? item.stage : (STAGE_KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'build')

export const practiceStage = (practice: Practice): Stage => stageOf(practice, `${practice.practice} ${practice.why}`)

export const toolStage = (tool: ToolIdea): Stage => stageOf(tool, `${tool.kind} ${tool.name} ${tool.what}`)

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, char => HTML_ESCAPES[char] ?? char)

const card = (practice: Practice): string =>
  `<article class="card"><h4>${escapeHtml(practice.practice)}</h4>${practice.why ? `<p class="why">${escapeHtml(practice.why)}</p>` : ''}${
    practice.signal ? `<p class="see"><b>You will see</b><br>${escapeHtml(practice.signal)}</p>` : ''
  }</article>`

const toolItem = (tool: ToolIdea): string =>
  `<li><span class="kind">${escapeHtml(tool.kind)}</span><code>${escapeHtml(tool.name)}</code>${tool.what ? ` ${escapeHtml(tool.what)}` : ''}</li>`

const box = (title: string, items: string[]): string => `<div class="box"><h5>${title}</h5><ul>${items.join('')}</ul></div>`

const stationSection = (station: Station, practices: Practice[], tools: ToolIdea[]): string => {
  const cards = practices.length > 0 ? `<div class="cols">${practices.map(card).join('')}</div>` : `<p class="empty">No practice in today's playbook landed on this station.</p>`
  const strip = [
    ...(tools.length > 0 ? [box('Add to your setup', tools.map(toolItem))] : []),
    box('Coach watches for', station.watches.map(watch => `<li>${escapeHtml(watch)}</li>`)),
  ]
  return `
  <section class="station" id="${station.stage}" style="--c: var(--${station.stage})">
    <div class="track"><div class="stop">${station.number}</div></div>
    <div class="body">
      <header>
        <span class="eyebrow">Station ${station.number} · ${escapeHtml(station.name)}</span>
        <h2>${escapeHtml(station.title)}</h2>
        <p class="lede">${escapeHtml(station.lede)}</p>
      </header>${station.stage === 'start' ? KICKOFF : ''}
      ${cards}
      <div class="strip">${strip.join('')}</div>
    </div>
  </section>`
}

const railItem = (practice: Practice): string =>
  `<li><b>${escapeHtml(practice.practice)}.</b>${practice.why ? ` ${escapeHtml(practice.why)}` : ''}${practice.signal ? ` <span class="signal">You will see: ${escapeHtml(practice.signal)}</span>` : ''}</li>`

const railSection = (rail: Rail, practices: Practice[], tools: ToolIdea[]): string => {
  const items = [...practices.map(railItem), ...tools.map(toolItem)]
  return `
    <section class="rail ${rail.stage}" id="${rail.stage}" style="--c: var(--${rail.stage})">
      <span class="eyebrow">Runs the whole trip</span>
      <h2>${escapeHtml(rail.title)}</h2>
      ${items.length > 0 ? `<ul>${items.join('')}</ul>` : `<p class="empty">No practice in today's playbook landed on this line.</p>`}
      <div class="chips">${rail.chips.map(chip => `<span class="chip" style="--c: var(--${rail.stage})">${escapeHtml(chip)}</span>`).join('')}</div>
    </section>`
}

export const builtOn = (playbook: Playbook): string => (playbook.fetchedAt > 0 ? new Date(playbook.fetchedAt).toISOString().slice(0, 10) : 'built-in seed')

/** The Agent Playbook Line Map as a standalone HTML page, filled from the playbook. */
export const renderPlaybookMap = (playbook: Playbook): string => {
  const practicesOn = (stage: Stage) => playbook.practices.filter(practice => practiceStage(practice) === stage)
  const toolsOn = (stage: Stage) => playbook.tools.filter(tool => toolStage(tool) === stage)
  const date = builtOn(playbook)
  const sources = playbook.sources.length > 0 ? playbook.sources.join(', ') : 'none'

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Agent Playbook Line Map</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;800;900&family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@400;600&display=swap">
<style>${MAP_STYLE}${NAV_STYLE}</style>
</head>
<body>
${siteNav('map')}
<div class="wrap">
  <header>
    <span class="eyebrow">Session coach · expert playbook · line map</span>
    <h1>Agent Playbook Line Map</h1>
    <p class="lede">How a project should run with AI coding agents, from the first prompt to shipping and learning. Every coach recommendation links to the station it belongs to.</p>
    <div class="meta">
      <span>Built from <b>${playbook.postCount}</b> posts</span>
      <span><b>${playbook.sources.length}</b> sources (Reddit, X, expert blogs)</span>
      <span><b>${playbook.practices.length}</b> practices · <b>${playbook.tools.length}</b> tools</span>
      <span>Playbook <b>${escapeHtml(date)}</b></span>
    </div>
  </header>
${MAP_NAV}
${STATIONS.map(station => stationSection(station, practicesOn(station.stage), toolsOn(station.stage))).join('\n')}

  <div class="rails">${RAILS.map(rail => railSection(rail, practicesOn(rail.stage), toolsOn(rail.stage))).join('')}
  </div>

  <section class="coachnote" aria-label="How the coach uses this map">
    <h3>How the coach uses this map</h3>
    <p>Every recommendation in the session coach carries a station chip, such as "3 Plan" or "5 Verify", and links to that station on this page. Fix the P1 items first, then read the station to see the practice behind the fix.</p>
    <div class="chips">
      <span class="chip" style="--c: var(--start)">1 Start</span><span class="chip" style="--c: var(--setup)">2 Set up</span><span class="chip" style="--c: var(--plan)">3 Plan</span><span class="chip" style="--c: var(--build)">4 Build</span><span class="chip" style="--c: var(--verify)">5 Verify</span><span class="chip" style="--c: var(--ship)">6 Ship</span><span class="chip" style="--c: var(--learn)">7 Learn</span><span class="chip" style="--c: var(--context)">Context &amp; cost</span><span class="chip" style="--c: var(--safety)">Safety</span>
    </div>
  </section>

  <footer>
    <span>Sources: ${escapeHtml(sources)}.</span>
    <span>Practices are summarized from the session coach playbook built on ${escapeHtml(date)}. The coach rebuilds the playbook daily and writes this page again each time.</span>
    <span><a href="${TRANSPARENCY_FILE}">How this playbook was built</a>: the sources, ranking and posts behind each practice.</span>
    <span><a href="${GUIDE_FILE}">How to use session-coach</a>: install, the pane, fixes and commands.</span>
  </footer>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`
}

export const MAP_STYLE = `
/* Layout: a transit-line map of one project's life. Seven stations in order, two lines (context & cost, safety) running the whole length. */
:root {
  --paper: #eef1f4;
  --panel: #ffffff;
  --ink: #15212c;
  --muted: #566573;
  --rule: #cfd6dd;
  --start: #d9481f;
  --setup: #6d4fa3;
  --plan: #16805f;
  --build: #2463d1;
  --verify: #b88400;
  --ship: #b3165a;
  --learn: #007a85;
  --context: #4b6b88;
  --safety: #c62828;
  --code-bg: #15212c;
  --code-ink: #e8eef4;
  --display: "Big Shoulders Display", "Arial Narrow", "Roboto Condensed", sans-serif;
  --body: "Atkinson Hyperlegible", "Segoe UI", system-ui, sans-serif;
  --mono: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #0d141b; --panel: #151f29; --ink: #e5ecf2; --muted: #9aa9b7; --rule: #2a3946;
    --start: #ff7a52; --setup: #a98ae6; --plan: #3cc796; --build: #6aa2ff; --verify: #f1c043; --ship: #f0609d; --learn: #3fc6d1;
    --context: #8fb0cf; --safety: #ff6b6b; --code-bg: #0a1016; --code-ink: #e8eef4;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --paper: #0d141b; --panel: #151f29; --ink: #e5ecf2; --muted: #9aa9b7; --rule: #2a3946;
  --start: #ff7a52; --setup: #a98ae6; --plan: #3cc796; --build: #6aa2ff; --verify: #f1c043; --ship: #f0609d; --learn: #3fc6d1;
  --context: #8fb0cf; --safety: #ff6b6b; --code-bg: #0a1016; --code-ink: #e8eef4;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; }
body > .site-nav:first-child { margin: -28px calc(-1 * max(16px, env(safe-area-inset-right, 0px))) 28px calc(-1 * max(16px, env(safe-area-inset-left, 0px))); }
body {
  background: var(--paper); color: var(--ink); font-family: var(--body); font-size: 16px; line-height: 1.55;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  padding-block: 28px 56px;
}
.wrap { max-width: 1080px; margin: 0 auto; display: flex; flex-direction: column; gap: 40px; }
h1, h2, h3 { font-family: var(--display); line-height: 1.02; text-wrap: balance; margin: 0; }
h1 { font-size: clamp(2.6rem, 7vw, 4.6rem); font-weight: 900; letter-spacing: 0.01em; text-transform: uppercase; }
h2 { font-size: clamp(1.9rem, 4.4vw, 2.7rem); font-weight: 800; text-transform: uppercase; }
h3 { font-size: 1.25rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; }
p { margin: 0; max-width: 68ch; }
.eyebrow { font-family: var(--mono); font-size: 0.78rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
a { color: inherit; }
a:focus-visible, button:focus-visible { outline: 3px solid var(--build); outline-offset: 2px; }

header { display: grid; gap: 14px; }
.meta { display: flex; flex-wrap: wrap; gap: 8px 18px; color: var(--muted); font-size: 0.92rem; }
.meta b { color: var(--ink); font-variant-numeric: tabular-nums; }

/* line map */
.map { background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; overflow-x: auto; padding: 18px 12px 8px; }
.map svg { display: block; min-width: 860px; width: 100%; height: auto; }
.map text { font-family: var(--display); font-weight: 800; fill: var(--ink); }
.map .small { font-family: var(--mono); font-weight: 400; font-size: 11px; fill: var(--muted); letter-spacing: 0.06em; }
.map a:hover circle.ring, .map a:focus circle.ring { stroke-width: 9; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 0.86rem; color: var(--muted); padding: 8px 6px 4px; }
.legend span { display: inline-flex; align-items: center; gap: 8px; }
.legend i { display: inline-block; width: 26px; height: 0; border-top: 5px solid var(--c); }
.legend i.dash { border-top-style: dashed; }

/* station sections */
.station { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 0 20px; scroll-margin-top: 16px; }
.track { position: relative; display: flex; justify-content: center; }
.track::before { content: ""; position: absolute; top: 0; bottom: -40px; width: 8px; background: var(--c); border-radius: 4px; opacity: 0.9; }
.station:last-of-type .track::before { bottom: 0; }
.stop { position: relative; z-index: 1; width: 56px; height: 56px; border-radius: 50%; background: var(--panel); border: 7px solid var(--c);
  display: grid; place-items: center; font-family: var(--display); font-weight: 900; font-size: 1.5rem; color: var(--ink); }
.body { display: grid; gap: 16px; min-width: 0; padding-bottom: 6px; }
.body > header { gap: 6px; }
.body .eyebrow { color: var(--c); font-weight: 600; }
.lede { font-size: 1.06rem; }

.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 14px; }
.card { background: var(--panel); border: 1px solid var(--rule); border-top: 5px solid var(--c); border-radius: 6px; padding: 14px 16px; display: grid; gap: 6px; align-content: start; min-width: 0; }
.card h4 { margin: 0; font-size: 1rem; line-height: 1.3; }
.card .why { color: var(--muted); font-size: 0.93rem; }
.card .see { font-size: 0.9rem; border-left: 3px solid var(--rule); padding-left: 10px; }
.card .see b { font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); font-weight: 600; }

.strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 12px; }
.box { border: 1px dashed var(--rule); border-radius: 6px; padding: 12px 14px; display: grid; gap: 6px; align-content: start; min-width: 0; }
.box h5 { margin: 0; font-family: var(--mono); font-size: 0.74rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
.box ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: 0.93rem; }
.kind { display: inline-block; font-family: var(--mono); font-size: 0.7rem; letter-spacing: 0.06em; text-transform: uppercase; border: 1px solid var(--c); color: var(--c); border-radius: 3px; padding: 0 5px; margin-right: 6px; }
code { font-family: var(--mono); font-size: 0.88em; }

/* kickoff prompt */
.prompt { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 300px); gap: 16px; align-items: start; }
.code { background: var(--code-bg); color: var(--code-ink); border-radius: 6px; overflow: hidden; min-width: 0; }
.code .bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.12); }
.code .bar span { font-family: var(--mono); font-size: 0.76rem; letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.75; }
.code button { font: 600 0.85rem var(--body); background: var(--start); color: #fff; border: 0; border-radius: 4px; padding: 6px 12px; cursor: pointer; }
.code pre { margin: 0; padding: 14px 16px 16px; overflow-x: auto; font-family: var(--mono); font-size: 0.84rem; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.code .ln { display: block; padding-left: 12px; border-left: 4px solid var(--lc, transparent); margin-bottom: 2px; }
.code .fill { color: #ffd58a; }
.keymap { display: grid; gap: 10px; }
.keymap div { display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 10px; align-items: start; font-size: 0.92rem; }
.keymap i { width: 14px; height: 14px; border-radius: 50%; background: var(--c); margin-top: 4px; }
.addon { display: grid; gap: 6px; }
.addon summary { cursor: pointer; font-weight: 700; }
.addon pre { margin: 6px 0 0; background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; padding: 12px 14px; overflow-x: auto; font-family: var(--mono); font-size: 0.82rem; white-space: pre-wrap; }

/* rails */
.rails { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 16px; }
.rail { background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; padding: 18px; display: grid; gap: 12px; align-content: start; scroll-margin-top: 16px; position: relative; overflow: hidden; }
.rail::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 7px; background: var(--c); }
.rail.safety::before { background: repeating-linear-gradient(135deg, var(--safety) 0 12px, var(--ink) 12px 24px); }
.rail.context::before { background: repeating-linear-gradient(90deg, var(--context) 0 16px, transparent 16px 26px); }
.rail h2 { font-size: 1.8rem; }
.rail ul { margin: 0; padding-left: 18px; display: grid; gap: 8px; }

.coachnote { border: 2px solid var(--ink); border-radius: 6px; padding: 16px 18px; display: grid; gap: 8px; background: var(--panel); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font-family: var(--mono); font-size: 0.74rem; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--c); color: var(--c); white-space: nowrap; }
footer { color: var(--muted); font-size: 0.86rem; display: grid; gap: 6px; }

@media (max-width: 720px) {
  .station { grid-template-columns: 44px minmax(0, 1fr); gap: 0 12px; }
  .stop { width: 42px; height: 42px; border-width: 6px; font-size: 1.15rem; }
  .track::before { width: 6px; }
  .prompt { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: no-preference) {
  .stop { transition: transform 160ms ease; }
  .station:target .stop, .station:hover .stop { transform: scale(1.08); }
}
.empty { color: var(--muted); font-style: italic; }
.rail .signal { color: var(--muted); }
`

const MAP_NAV = `
  <nav class="map" aria-label="Project line map">
    <svg viewBox="0 0 1000 250" role="img" aria-labelledby="mapTitle">
      <title id="mapTitle">Seven stations in order: Start, Set up, Plan, Build, Verify, Ship, Learn. Two lines run the full length: Context and cost, and Safety.</title>
      <line x1="60" y1="190" x2="940" y2="190" stroke="var(--context)" stroke-width="6" stroke-dasharray="18 10" />
      <line x1="60" y1="222" x2="940" y2="222" stroke="var(--safety)" stroke-width="6" />
      <a href="#context"><text class="small" x="60" y="182">CONTEXT &amp; COST LINE · ALWAYS ON</text></a>
      <a href="#safety"><text class="small" x="60" y="244">SAFETY LINE · ALWAYS ON</text></a>
      <line x1="80" y1="96" x2="200" y2="96" stroke="var(--start)" stroke-width="10" />
      <line x1="200" y1="96" x2="340" y2="96" stroke="var(--setup)" stroke-width="10" />
      <line x1="340" y1="96" x2="480" y2="96" stroke="var(--plan)" stroke-width="10" />
      <line x1="480" y1="96" x2="620" y2="96" stroke="var(--build)" stroke-width="10" />
      <line x1="620" y1="96" x2="760" y2="96" stroke="var(--verify)" stroke-width="10" />
      <line x1="760" y1="96" x2="900" y2="96" stroke="var(--ship)" stroke-width="10" />
      <path d="M900 96 C 940 96, 940 40, 900 40 L 560 40" fill="none" stroke="var(--learn)" stroke-width="6" stroke-dasharray="4 8" />
      <text class="small" x="610" y="32">LEARN FEEDS THE NEXT PLAN</text>
      <g>
        <a href="#start"><circle class="ring" cx="80" cy="96" r="18" fill="var(--panel)" stroke="var(--start)" stroke-width="7" /><text x="80" y="102" text-anchor="middle" font-size="17">1</text><text x="80" y="146" text-anchor="middle" font-size="19">START</text><text class="small" x="80" y="164" text-anchor="middle">FIRST PROMPT</text></a>
        <a href="#setup"><circle class="ring" cx="200" cy="96" r="18" fill="var(--panel)" stroke="var(--setup)" stroke-width="7" /><text x="200" y="102" text-anchor="middle" font-size="17">2</text><text x="200" y="146" text-anchor="middle" font-size="19">SET UP</text><text class="small" x="200" y="164" text-anchor="middle">RULES · AGENTS · HOOKS</text></a>
        <a href="#plan"><circle class="ring" cx="340" cy="96" r="18" fill="var(--panel)" stroke="var(--plan)" stroke-width="7" /><text x="340" y="102" text-anchor="middle" font-size="17">3</text><text x="340" y="146" text-anchor="middle" font-size="19">PLAN</text><text class="small" x="340" y="164" text-anchor="middle">SPEC · DONE WHEN</text></a>
        <a href="#build"><circle class="ring" cx="480" cy="96" r="18" fill="var(--panel)" stroke="var(--build)" stroke-width="7" /><text x="480" y="102" text-anchor="middle" font-size="17">4</text><text x="480" y="146" text-anchor="middle" font-size="19">BUILD</text><text class="small" x="480" y="164" text-anchor="middle">DELEGATE · PARALLEL</text></a>
        <a href="#verify"><circle class="ring" cx="620" cy="96" r="18" fill="var(--panel)" stroke="var(--verify)" stroke-width="7" /><text x="620" y="102" text-anchor="middle" font-size="17">5</text><text x="620" y="146" text-anchor="middle" font-size="19">VERIFY</text><text class="small" x="620" y="164" text-anchor="middle">TESTS · REVIEW</text></a>
        <a href="#ship"><circle class="ring" cx="760" cy="96" r="18" fill="var(--panel)" stroke="var(--ship)" stroke-width="7" /><text x="760" y="102" text-anchor="middle" font-size="17">6</text><text x="760" y="146" text-anchor="middle" font-size="19">SHIP</text><text class="small" x="760" y="164" text-anchor="middle">BRANCH · PR · MERGE</text></a>
        <a href="#learn"><circle class="ring" cx="900" cy="96" r="18" fill="var(--panel)" stroke="var(--learn)" stroke-width="7" /><text x="900" y="102" text-anchor="middle" font-size="17">7</text><text x="900" y="146" text-anchor="middle" font-size="19">LEARN</text><text class="small" x="900" y="164" text-anchor="middle">RULES · SKILLS · EVALS</text></a>
      </g>
    </svg>
    <div class="legend">
      <span style="--c: var(--context)"><i class="dash"></i>Context &amp; cost runs the whole trip</span>
      <span style="--c: var(--safety)"><i></i>Safety runs the whole trip</span>
      <span style="--c: var(--learn)"><i class="dash"></i>Learn loops back into the next plan</span>
    </div>
  </nav>
`

const KICKOFF = `
      <div class="prompt">
        <div class="code">
          <div class="bar"><span>Kickoff prompt · fill in the yellow parts</span><button type="button" id="copyKickoff">Copy prompt</button></div>
          <pre id="kickoff"><span class="ln" style="--lc: var(--plan)">New project: <span class="fill">&lt;name&gt;</span>. Goal: <span class="fill">&lt;one sentence&gt;</span>.</span>
<span class="ln" style="--lc: var(--plan)">Done when:
1. <span class="fill">&lt;criterion a user or player can check&gt;</span>
2. <span class="fill">&lt;criterion&gt;</span>
3. <span class="fill">&lt;criterion&gt;</span></span>
<span class="ln" style="--lc: var(--setup)">Stack and limits: <span class="fill">&lt;language or engine and version&gt;</span>. Do not add dependencies without asking.</span>
<span class="ln" style="--lc: var(--plan)">Step 1. Read and plan only. Read the repo and any CLAUDE.md. List edge cases and risks first. Ask me up to 3 questions. Then write a plan: the files to create, the approach and the test plan. Wait for my OK before you write code.</span>
<span class="ln" style="--lc: var(--setup)">Step 2. Set up before features. Create CLAUDE.md with the build, test, lint and type-check commands and our conventions. Set up <span class="fill">&lt;test framework&gt;</span> with one passing test.</span>
<span class="ln" style="--lc: var(--build)">Agents: use scout (Haiku) for searches and file reads, builder (Sonnet) for well-specified implementation from the agreed plan, and stay on Opus for design and hard debugging. Have a fresh-context reviewer check the plan.</span>
<span class="ln" style="--lc: var(--verify)">Testing: after every change, run the tests, linter and type checker and show me the real output. Iterate until they pass before you say done. Write tests from the spec, not from the implementation.</span>
<span class="ln" style="--lc: var(--ship)">Git: work on a feat/ branch in its own worktree, commit each step, and open a draft PR early.</span>
<span class="ln" style="--lc: var(--learn)">At the end of each session, summarize what changed, what is open and what is blocked. If I correct you twice on the same thing, propose a CLAUDE.md rule.</span></pre>
        </div>
        <div class="keymap" aria-label="Which station each line feeds">
          <span class="eyebrow">Each line feeds a station</span>
          <div style="--c: var(--plan)"><i></i><span><b>Plan.</b> Goal, done-when list and "read and plan only". Misunderstandings surface in the plan, where they are cheap.</span></div>
          <div style="--c: var(--setup)"><i></i><span><b>Set up.</b> Stack limits, CLAUDE.md with real commands, a working test harness before any feature.</span></div>
          <div style="--c: var(--build)"><i></i><span><b>Build.</b> Names the agents, so cheap models do reads and routine code while Opus keeps judgment.</span></div>
          <div style="--c: var(--verify)"><i></i><span><b>Verify.</b> A closed loop: the agent proves its work with real output and spec-first tests.</span></div>
          <div style="--c: var(--ship)"><i></i><span><b>Ship.</b> Branch and worktree per task, commits per step, a visible draft PR.</span></div>
          <div style="--c: var(--learn)"><i></i><span><b>Learn.</b> A session summary, and repeated corrections turn into rules.</span></div>
          <details class="addon">
            <summary>Add for a Godot project</summary>
            <pre>Engine: Godot 4.7, typed GDScript everywhere. Tests use GUT; run them headless with $env:GODOT and treat exit code 0 as a pass. Parse-check every script you touch with --check-only. Gameplay feel cannot be tested headless, so end each step by telling me what to playtest and what to look for.</pre>
          </details>
        </div>
      </div>`

const SCRIPT = `
(function () {
  var button = document.getElementById('copyKickoff');
  var pre = document.getElementById('kickoff');
  if (!button || !pre) return;
  button.addEventListener('click', function () {
    var text = pre.innerText;
    var done = function (label) { button.textContent = label; setTimeout(function () { button.textContent = 'Copy prompt'; }, 1800); };
    var select = function () {
      var range = document.createRange(); range.selectNodeContents(pre);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      done('Selected, press Ctrl+C');
    };
    try {
      navigator.clipboard.writeText(text).then(function () { done('Copied'); }, select);
    } catch (e) { select(); }
  });
})();
`
