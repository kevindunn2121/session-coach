import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteRequest, ModelCompleteResult, PluginOptions, Register, RenderChildren, RenderSurface } from 'claude-code'

import type { ApplyState, CoachJob, FeedStatus, Fix, Insight, Metrics, Playbook, PlaybookTrail, SetupAudit, SetupRecommendation, Tip, UsageWindow } from '../types'
import { comparePrompt, parseInsights, playbookText, reportMarkdown } from './coach'
import type { HistoryEntry } from './coach'
import { SEED_PLAYBOOK, buildTrail, collectPosts, mergePosts, parsePlaybook, pastedPosts, playbookPrompt, splitList } from './feed'
import type { FetchText } from './feed'
import { GUIDE_FILE, MAP_FILE, TRANSPARENCY_FILE, renderPlaybookMap } from './map'
import { renderTransparency } from './transparency'
import { VERDICT_COLOR, VERDICT_GLYPH, VERDICT_LABEL, judgePrompt, parseJudgment, sparkline, turnDelta } from './judge'
import { auditPrompt, fingerprint, mcpServerNames, measure, parseAgentFile, parseRecommendations, recommendationCard, snapshotText, summarizeSettings } from './setup'
import type { AgentDef, InstructionFile, SettingsSummary, SetupSnapshot } from './setup'
import {
  emptyMetrics,
  normalizeMetrics,
  recordCompaction,
  recordContext,
  recordPermissionAsk,
  recordPrompt,
  recordTool,
  recordTurn,
  score,
  tips,
} from './metrics'
import { fixCopyText, fixMarkdown, fixPromptText, promptedMessage, whenOf } from './fix'
import { CATEGORY_COLOR, CATEGORY_LABEL, DEFAULT_PLAYBOOK_URL, PRIORITY_COLOR, PRIORITY_LABEL, STAGE_COLOR, STAGE_LABEL, priorityCounts, rankedItems, sortRecommendations, stageMarkdown } from './rank'
import type { RankedItem } from './rank'
import { addSpend, countPorcelain, parseShortstat, planWindows, vitalTips, vitalsLines } from './vitals'

const PANE = 'session-coach'
const SETUP_PANE = 'session-coach-setup'
const COMMAND = 'coach'
const DAY_MS = 24 * 60 * 60 * 1000
const HISTORY_CAP = 100
const PASTED_CAP = 100
const TRAIL_CAP = 40
const JUDGMENTS_CAP = 30
const FRESH_MS = 10 * 60 * 1000

const metricsRef = atom({ plugin: 'session-coach', key: 'metrics' } as const, null)
const insightsRef = atom({ plugin: 'session-coach', key: 'insights' } as const, [])
const feedRef = atom({ plugin: 'session-coach', key: 'feed' } as const, { state: 'idle', message: 'Using the built-in playbook.', fetchedAt: 0, postCount: 0 })
const bandHiddenRef = atom({ plugin: 'session-coach', key: 'isBandHidden' } as const, false)
const analyzingRef = atom({ plugin: 'session-coach', key: 'isAnalyzing' } as const, false)
const analysisNoteRef = atom({ plugin: 'session-coach', key: 'analysisNote' } as const, '')
const judgmentsRef = atom({ plugin: 'session-coach', key: 'judgments' } as const, [])
const trailRef = atom({ plugin: 'session-coach', key: 'trail' } as const, [])
const setupRef = atom({ plugin: 'session-coach', key: 'setup' } as const, null)
const auditingRef = atom({ plugin: 'session-coach', key: 'isAuditing' } as const, false)
const setupNoteRef = atom({ plugin: 'session-coach', key: 'setupNote' } as const, '')
const setupSkippedRef = atom({ plugin: 'session-coach', key: 'setupSkipped' } as const, [])
const setupApplyStateRef = atom({ plugin: 'session-coach', key: 'setupApplyState' } as const, {})
const planUsageRef = atom({ plugin: 'session-coach', key: 'planUsage' } as const, [])
const spendRef = atom({ plugin: 'session-coach', key: 'coachSpend' } as const, null)
const gitRef = atom({ plugin: 'session-coach', key: 'git' } as const, null)
const lastActionRef = atom({ plugin: 'session-coach', key: 'lastAction' } as const, null)
const isWorkingRef = atom({ plugin: 'session-coach', key: 'isWorking' } as const, false)
const mapPathRef = atom({ plugin: 'session-coach', key: 'mapPath' } as const, '')
const transparencyPathRef = atom({ plugin: 'session-coach', key: 'transparencyPath' } as const, '')

type Config = {
  profile: string
  subreddits: string[]
  xHandles: string[]
  xMirrors: string[]
  extraFeeds: string[]
  analyzeEvery: number
  playbookModel: string
  analysisModel: string
  judgeModel: string
  obsidianDir: string
  judgeTurns: boolean
  openPane: string
  playbookUrl: string
}

const readConfig = (options: PluginOptions): Config => ({
  profile: String(options.profile ?? '').trim(),
  subreddits: splitList(String(options.subreddits ?? '')),
  xHandles: splitList(String(options.xHandles ?? '')),
  xMirrors: splitList(String(options.xMirrors ?? '')),
  extraFeeds: splitList(String(options.extraFeeds ?? '')),
  analyzeEvery: Number(options.analyzeEvery ?? 3),
  playbookModel: String(options.playbookModel ?? '') || 'claude-sonnet-5-5',
  analysisModel: String(options.analysisModel ?? '') || 'claude-sonnet-5-5',
  judgeModel: String(options.judgeModel ?? '') || 'claude-haiku-5-5',
  obsidianDir: String(options.obsidianDir ?? '').trim(),
  judgeTurns: options.judgeTurns !== false,
  openPane: String(options.openPane ?? 'auto'),
  playbookUrl: String(options.playbookUrl ?? '').trim() || DEFAULT_PLAYBOOK_URL,
})

const loadPlaybook = async ($: EngineInterface): Promise<Playbook> =>
  ((await $.store.get('playbook')) as Playbook | undefined) ?? SEED_PLAYBOOK

const loadTrail = async ($: EngineInterface): Promise<PlaybookTrail | null> =>
  ((await $.store.get('playbookTrail')) as PlaybookTrail | undefined) ?? null

const loadStrings = async ($: EngineInterface, key: string): Promise<string[]> => {
  const value = await $.store.get(key)
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

const changeMetrics = async ($: EngineInterface, change: (m: Metrics) => Metrics): Promise<void> => {
  const now = await $.clock.now()
  await update($, metricsRef, m => change(normalizeMetrics(m ?? emptyMetrics(now))))
}

const currentMetrics = async ($: EngineInterface): Promise<Metrics> => {
  const m = await read($, metricsRef)
  return m === null ? emptyMetrics(await $.clock.now()) : normalizeMetrics(m)
}

const coachComplete = async ($: EngineInterface, job: CoachJob, request: ModelCompleteRequest): Promise<ModelCompleteResult> => {
  const reply = await $.model.complete(request)
  await update($, spendRef, spend => addSpend(spend, job, reply.usage))
  return reply
}

const currentTips = async ($: EngineInterface, metrics: Metrics): Promise<Tip[]> => [
  ...vitalTips(await read($, planUsageRef), await read($, gitRef), await $.clock.now()),
  ...tips(metrics),
]

const setFeed = ($: EngineInterface, feed: FeedStatus) => update($, feedRef, () => feed)

const replyFailure = (reply: ModelCompleteResult): string =>
  reply.isAnswered ? '' : reply.reason === 'api-error' ? `API error${reply.status ? ` ${reply.status}` : ''}` : reply.reason

const readUsage = async ($: EngineInterface): Promise<{ percent?: number; windows?: UsageWindow[] }> => {
  try {
    const { context, rateLimits } = await $.session.usage()
    const percent = context.percent !== undefined ? Math.round(context.percent) : context.tokens ? Math.round((context.tokens / context.window) * 100) : undefined
    return { ...(percent !== undefined ? { percent } : {}), windows: planWindows(rateLimits) }
  } catch {
    return {}
  }
}

const refreshPlanUsage = async ($: EngineInterface): Promise<number | undefined> => {
  const usage = await readUsage($)
  if (usage.windows !== undefined) {
    const windows = usage.windows
    await update($, planUsageRef, () => windows)
  }
  return usage.percent
}

const checkGit = async ($: EngineInterface): Promise<void> => {
  try {
    const cwd = await $.session.cwd()
    const git = (args: string[]) => $.process.run(['git', ...args], { cwd })
    const now = await $.clock.now()
    const branch = await git(['branch', '--show-current'])
    if (branch.exitCode !== 0) {
      await update($, gitRef, () => ({ isRepo: false, branch: '', changedFiles: 0, insertions: 0, deletions: 0, lastCommitAt: 0, checkedAt: now }))
      return
    }
    const [status, stat, last] = await Promise.all([git(['status', '--porcelain']), git(['diff', '--shortstat', 'HEAD']), git(['log', '-1', '--format=%ct'])])
    const { insertions, deletions } = parseShortstat(stat.exitCode === 0 ? stat.stdout : '')
    const committedAt = last.exitCode === 0 ? Number(last.stdout.trim()) * 1000 : 0
    await update($, gitRef, () => ({
      isRepo: true,
      branch: branch.stdout.trim() || 'detached',
      changedFiles: status.exitCode === 0 ? countPorcelain(status.stdout) : 0,
      insertions,
      deletions,
      lastCommitAt: Number.isFinite(committedAt) ? committedAt : 0,
      checkedAt: now,
    }))
  } catch {
    // No git on PATH, or process.run is unavailable on this surface.
  }
}

let config: Config = readConfig({})
const shownTips = new Set<string>()
let lastAnalyzedTurn = 0
let turnStart: Metrics | null = null
let lastPrompt = ''
let lastGitTurn = -1

const refreshFeed = async ($: EngineInterface, isForced: boolean): Promise<string> => {
  if (isForced) await setAction($, 'Refreshing the expert feed…', true)
  let message: string
  try {
    message = await rebuildPlaybook($, isForced)
  } catch (error) {
    message = `Feed refresh failed: ${error instanceof Error ? error.message : String(error)}`
    await setFeed($, { state: 'failed', message, fetchedAt: 0, postCount: 0 })
  }
  if (isForced) await setAction($, message, false)
  return message
}

const rebuildPlaybook = async ($: EngineInterface, isForced: boolean): Promise<string> => {
  const playbook = await loadPlaybook($)
  const now = await $.clock.now()
  if (!isForced && playbook.fetchedAt > 0 && now - playbook.fetchedAt < DAY_MS) {
    await setFeed($, { state: 'ok', message: 'Playbook is fresh.', fetchedAt: playbook.fetchedAt, postCount: playbook.postCount })
    return 'Playbook is less than a day old.'
  }

  await setFeed($, { state: 'fetching', message: 'Fetching posts...', fetchedAt: playbook.fetchedAt, postCount: playbook.postCount })
  const fetchText: FetchText = (url, headers) => $.http.fetch(url, { headers })
  const webPosts = await collectPosts(fetchText, { ...config, pasted: [] })
  const pasted = pastedPosts(await loadStrings($, 'pasted'), now)
  const posts = mergePosts(webPosts, pasted)
  if (posts.length === 0) {
    const message = 'No posts reached: the web feeds were blocked. Paste posts with /coach paste.'
    await failRefresh($, playbook, message)
    return message
  }

  const reply = await coachComplete($, 'playbook', {
    model: config.playbookModel,
    prompt: playbookPrompt(posts, now),
    effort: 'medium',
    maxTokens: 8000,
    timeoutMs: 180000,
  })
  const built = reply.isAnswered ? parsePlaybook(reply.text, posts, now) : undefined
  if (built === undefined) {
    const message = reply.isAnswered ? 'The model reply was not a playbook.' : `Model call failed: ${reply.reason}.`
    await failRefresh($, playbook, message)
    return message
  }

  const trail = buildTrail({ ...config, pasted: [] }, [...webPosts, ...pasted], posts, now, config.playbookModel)
  await $.store.set('playbook', built)
  await $.store.set('playbookTrail', trail)
  await writeMap($, built)
  const message = `Playbook rebuilt from ${built.postCount} posts across ${built.sources.length} sources.`
  const feed: FeedStatus = { state: 'ok', message, fetchedAt: built.fetchedAt, postCount: built.postCount }
  await setFeed($, feed)
  await writeTransparency($, built, trail, feed)
  return message
}

// A failed refresh keeps the last playbook, and the transparency page says the refresh failed.
const failRefresh = async ($: EngineInterface, playbook: Playbook, message: string): Promise<void> => {
  const feed: FeedStatus = { state: 'failed', message, fetchedAt: playbook.fetchedAt, postCount: playbook.postCount }
  await setFeed($, feed)
  await writeTransparency($, playbook, await loadTrail($), feed)
}

const noteAnalysis = async ($: EngineInterface, note: string, isFailure: boolean): Promise<void> => {
  await update($, analysisNoteRef, () => note)
  if (isFailure) {
    $.ui.toast(`Coach: ${note}`)
    await setAction($, note, false)
  }
}

const setAction = async ($: EngineInterface, text: string, isRunning: boolean): Promise<void> => {
  const at = await $.clock.now()
  await update($, lastActionRef, () => ({ text, at, isRunning }))
}

const analyze = async ($: EngineInterface): Promise<Insight[]> => {
  if (await read($, analyzingRef)) return read($, insightsRef)
  await update($, analyzingRef, () => true)
  await update($, analysisNoteRef, () => 'Analyzing…')
  await setAction($, 'Analyzing your session against the expert playbook…', true)
  try {
    const metrics = await currentMetrics($)
    lastAnalyzedTurn = metrics.turns
    const playbook = await loadPlaybook($)
    const reply = await coachComplete($, 'analysis', {
      model: config.analysisModel,
      prompt: [{ text: playbookText(playbook), cache: true }, { text: comparePrompt(metrics, score(metrics), tips(metrics), config.profile) }],
      effort: 'medium',
      maxTokens: 4000,
      timeoutMs: 60000,
    })
    if (!reply.isAnswered) {
      await noteAnalysis($, `Analysis failed: ${replyFailure(reply)}.`, true)
      return []
    }
    const insights = parseInsights(reply.text)
    const [top] = insights
    if (top === undefined) {
      await noteAnalysis($, 'Analysis came back with no usable suggestions.', true)
      return []
    }
    await update($, insightsRef, () => insights)
    await noteAnalysis($, `${insights.length} suggestions after turn ${metrics.turns}.`, false)
    await setAction($, `${insights.length} new suggestion${insights.length === 1 ? '' : 's'}: ${top.title}`, false)
    $.ui.toast(`Coach: ${top.title}`)
    return insights
  } catch (error) {
    await noteAnalysis($, `Analysis failed: ${error instanceof Error ? error.message : String(error)}`, true)
    return []
  } finally {
    await update($, analyzingRef, () => false)
  }
}

const judgeTurn = async ($: EngineInterface, answer: string, isAborted: boolean, before: Metrics): Promise<void> => {
  try {
    const after = await currentMetrics($)
    const recent = (await read($, judgmentsRef)).slice(-3)
    const reply = await coachComplete($, 'judge', {
      model: config.judgeModel,
      prompt: judgePrompt(lastPrompt, answer, turnDelta(before, after), isAborted, score(after).total, recent),
      effort: 'low',
      maxTokens: 1024,
      timeoutMs: 30000,
    })
    const judgment = reply.isAnswered ? parseJudgment(reply.text, after.turns, await $.clock.now()) : undefined
    if (judgment === undefined) return
    await update($, judgmentsRef, list => [...list, judgment].slice(-JUDGMENTS_CAP))
    if (judgment.verdict !== 'on-track' && recent.at(-1)?.verdict !== judgment.verdict) {
      $.ui.toast(`Coach: ${VERDICT_LABEL[judgment.verdict]}. ${judgment.nudge ?? judgment.note}`)
    }
  } catch {
    // A failed judgment leaves the previous verdict standing.
  }
}

type SkippedRecord = { fingerprint: string; ids: string[] }

const homeDir = async ($: EngineInterface): Promise<string> =>
  ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/[\\/]+$/, '')

// The map and the transparency page link to the guide, so a copy of the shipped guide sits beside them.
const copyGuide = async ($: EngineInterface, home: string): Promise<void> => {
  try {
    await $.fs.write(`${home}/.claude/session-coach/${GUIDE_FILE}`, await $.fs.read(`${$.plugin.root}/docs/${GUIDE_FILE}`))
  } catch (error) {
    $.ui.log(`session-coach: could not copy the guide: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const writeMap = async ($: EngineInterface, playbook: Playbook): Promise<string | undefined> => {
  const home = await homeDir($)
  if (!home) return undefined
  await copyGuide($, home)
  const path = `${home}/.claude/session-coach/${MAP_FILE}`
  try {
    await $.fs.write(path, renderPlaybookMap(playbook))
  } catch (error) {
    $.ui.log(`session-coach: could not write the playbook map to ${path}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
  await update($, mapPathRef, () => path)
  await $.store.set('mapPath', path)
  return path
}

const writeTransparency = async ($: EngineInterface, playbook: Playbook, trail: PlaybookTrail | null, feed: FeedStatus | null): Promise<string | undefined> => {
  const home = await homeDir($)
  if (!home) return undefined
  await copyGuide($, home)
  const path = `${home}/.claude/session-coach/${TRANSPARENCY_FILE}`
  const page = renderTransparency({
    playbook,
    trail,
    feed,
    analysisModel: config.analysisModel,
    judgeModel: config.judgeModel,
    analyzeEvery: config.analyzeEvery,
    generatedAt: await $.clock.now(),
  })
  try {
    await $.fs.write(path, page)
  } catch (error) {
    $.ui.log(`session-coach: could not write the transparency page to ${path}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
  await update($, transparencyPathRef, () => path)
  await $.store.set('transparencyPath', path)
  return path
}

const readText = async ($: EngineInterface, path: string): Promise<string | undefined> => {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}

const listNames = async ($: EngineInterface, path: string, kind: 'file' | 'dir'): Promise<string[]> => {
  try {
    return (await $.fs.list(path)).filter(entry => entry.kind === kind || (kind === 'dir' && entry.isLink)).map(entry => entry.name)
  } catch {
    return []
  }
}

const collectSnapshot = async ($: EngineInterface): Promise<SetupSnapshot> => {
  const home = await homeDir($)
  const cwd = (await $.session.cwd()).replace(/[\\/]+$/, '')
  const userDir = home ? `${home}/.claude` : ''
  const projectDirs = cwd && cwd.toLowerCase() !== home.toLowerCase() ? [cwd] : []

  const instructionPaths = [...(userDir ? [`${userDir}/CLAUDE.md`] : []), ...projectDirs.flatMap(dir => [`${dir}/CLAUDE.md`, `${dir}/.claude/CLAUDE.md`, `${dir}/CLAUDE.local.md`])]
  const instructions: InstructionFile[] = []
  for (const path of instructionPaths) {
    const text = await readText($, path)
    if (text?.trim()) instructions.push({ path, text })
  }

  const settingsPaths = [...(userDir ? [`${userDir}/settings.json`] : []), ...projectDirs.flatMap(dir => [`${dir}/.claude/settings.json`, `${dir}/.claude/settings.local.json`])]
  const settings: SettingsSummary[] = []
  for (const path of settingsPaths) {
    const text = await readText($, path)
    const summary = text === undefined ? undefined : summarizeSettings(path, text)
    if (summary) settings.push(summary)
  }

  const scopes: { dir: string; scope: AgentDef['scope'] }[] = [
    ...(userDir ? [{ dir: userDir, scope: 'user' as const }] : []),
    ...projectDirs.map(dir => ({ dir: `${dir}/.claude`, scope: 'project' as const })),
  ]
  const skills: string[] = []
  const agents: AgentDef[] = []
  for (const { dir, scope } of scopes) {
    skills.push(...(await listNames($, `${dir}/skills`, 'dir')).map(name => (scope === 'project' ? `${name} (project)` : name)))
    for (const file of (await listNames($, `${dir}/agents`, 'file')).filter(name => name.toLowerCase().endsWith('.md'))) {
      const text = await readText($, `${dir}/agents/${file}`)
      if (text !== undefined) agents.push(parseAgentFile(file, text, scope))
    }
  }

  const claudeJson = userDir ? await readText($, `${home}/.claude.json`) : undefined
  const projectMcp = projectDirs.length ? await readText($, `${projectDirs[0]}/.mcp.json`) : undefined
  const mcpServers = [...new Set([...(claudeJson ? mcpServerNames(claudeJson, cwd) : []), ...(projectMcp ? mcpServerNames(projectMcp, cwd) : [])])]

  const stack: string[] = []
  for (const dir of projectDirs) {
    const found = (await listNames($, dir, 'file')).filter(name => STACK_FILES.test(name))
    if (found.length) stack.push(`project files: ${found.join(', ')}`)
    const workflows = await listNames($, `${dir}/.github/workflows`, 'file')
    if (workflows.length) stack.push(`GitHub Actions workflows: ${workflows.join(', ')}`)
  }

  return { instructions, settings, skills, agents, mcpServers, stack }
}

// Files whose names say how the project builds and deploys. Only names are read, never contents.
const STACK_FILES = /^(dbt_project\.yml|snowflake\.yml|spec\.ya?ml|Dockerfile.*|docker-compose\.ya?ml|compose\.ya?ml|azure\.yaml|azure-pipelines\.yml|main\.bicep|.*\.tf|pyproject\.toml|requirements\.txt|package\.json)$/i

const noteSetup = async ($: EngineInterface, note: string, isFailure: boolean): Promise<void> => {
  await update($, setupNoteRef, () => note)
  if (isFailure) $.ui.toast(`Coach: ${note}`)
}

const runAudit = async ($: EngineInterface, isForced: boolean): Promise<SetupAudit | null> => {
  if (await read($, auditingRef)) return read($, setupRef)
  await update($, auditingRef, () => true)
  await update($, setupNoteRef, () => 'Auditing your setup…')
  try {
    const snapshot = await collectSnapshot($)
    const print = fingerprint(`${config.profile}\n${snapshotText(snapshot)}`)
    const stored = (await $.store.get('setupAudit')) as SetupAudit | undefined
    const now = await $.clock.now()
    if (!isForced && stored !== undefined && stored.fingerprint === print && now - stored.at < DAY_MS) {
      await update($, setupRef, () => stored)
      await noteSetup($, 'Setup unchanged since the last audit.', false)
      return stored
    }

    const metrics = await currentMetrics($)
    const history = ((await $.store.get('history')) as HistoryEntry[] | undefined) ?? []
    const measured = measure(snapshot, history, metrics.turns)
    const reply = await coachComplete($, 'setup', {
      model: config.analysisModel,
      prompt: auditPrompt(snapshot, measured, metrics, playbookText(await loadPlaybook($)), config.profile),
      effort: 'medium',
      maxTokens: 8000,
      timeoutMs: 180000,
    })
    if (!reply.isAnswered) {
      await noteSetup($, `Setup audit failed: ${replyFailure(reply)}.`, true)
      return read($, setupRef)
    }
    const recommendations = parseRecommendations(reply.text)
    if (recommendations.length === 0) {
      await noteSetup($, 'Setup audit came back with no usable recommendations.', true)
      return read($, setupRef)
    }

    const audit: SetupAudit = { at: now, fingerprint: print, instructionTokens: measured.instructionTokens, recommendations }
    await $.store.set('setupAudit', audit)
    await update($, setupRef, () => audit)
    if (stored?.fingerprint !== print) {
      await update($, setupSkippedRef, () => [])
      await update($, setupApplyStateRef, () => ({}))
      await $.store.set('setupSkipped', { fingerprint: print, ids: [] })
    }
    await noteSetup($, `${recommendations.length} recommendations. Instruction files add ~${measured.instructionTokens} tokens to every request.`, false)
    $.ui.toast(`Coach: setup audit found ${recommendations.length} recommendations. /coach setup to review.`)
    return audit
  } catch (error) {
    await noteSetup($, `Setup audit failed: ${error instanceof Error ? error.message : String(error)}`, true)
    return read($, setupRef)
  } finally {
    await update($, auditingRef, () => false)
  }
}

const setApplyState = ($: EngineInterface, id: string, state: ApplyState) =>
  update($, setupApplyStateRef, states => ({ ...states, [id]: state }))

const FILL_TIMEOUT_MS = 3000

const fillPrompt = async ($: EngineInterface, text: string): Promise<boolean> => {
  const timedOut = $.clock.sleep(FILL_TIMEOUT_MS).then(() => false)
  const filled = $.prompt.fill({ text, mode: 'replace' }).then(result => result.isFilled, () => false)
  return Promise.race([filled, timedOut])
}

const saveExport = async ($: EngineInterface, text: string): Promise<string | undefined> => {
  const home = await homeDir($)
  if (!home) return undefined
  const path = `${home}/.claude/session-coach/export.md`
  try {
    await $.fs.write(path, text)
    return path
  } catch {
    return undefined
  }
}

const putFixInPrompt = async ($: EngineInterface, fix: Fix, label: string): Promise<void> => {
  const isFilled = await fillPrompt($, fixPromptText(fix))
  const isWorking = await read($, isWorkingRef)
  await setAction($, isFilled ? promptedMessage({ label, when: whenOf(fix), isWorking }) : 'Could not reach your prompt box. Press Copy instead.', false)
}

const copyText = async ($: EngineInterface, text: string, surface: RenderSurface, label: string, fallback: 'prompt' | 'file'): Promise<void> => {
  const copied = await $.ui.copy({ text, surface }).catch(() => ({ isCopied: false }))
  if (copied.isCopied) {
    await setAction($, `Copied ${label} to your clipboard.`, false)
    return
  }
  if (fallback === 'prompt' && (await fillPrompt($, text))) {
    await setAction($, `This app does not let plugins copy, so ${label} is in your prompt box. Select it there and copy it, or press Enter to send it.`, false)
    return
  }
  const path = await saveExport($, text)
  await setAction($, path ? `This app does not let plugins copy, so ${label} is saved to ${path}.` : `Could not copy ${label}.`, false)
}

const recommendationCopyText = (rec: SetupRecommendation): string => (rec.manualFix ? fixCopyText(rec.manualFix) : rec.applyPrompt)

const applyRecommendation = async ($: EngineInterface, rec: SetupRecommendation): Promise<void> => {
  await setApplyState($, rec.id, 'filling')
  const isFilled = await fillPrompt($, rec.applyPrompt)
  await setApplyState($, rec.id, isFilled ? 'filled' : 'refused')
}

const sendRecommendation = async ($: EngineInterface, rec: SetupRecommendation): Promise<void> => {
  await $.prompt.submit({ text: rec.applyPrompt, asUser: true })
  await setApplyState($, rec.id, 'sent')
}

const copyRecommendation = async ($: EngineInterface, rec: SetupRecommendation, surface: RenderSurface): Promise<void> => {
  const text = recommendationCopyText(rec)
  const copied = await $.ui.copy({ text, surface }).catch(() => ({ isCopied: false }))
  if (copied.isCopied) {
    await setApplyState($, rec.id, 'copied')
    return
  }
  await setApplyState($, rec.id, (await fillPrompt($, text)) ? 'filled' : 'copy-failed')
}

const skipRecommendation = async ($: EngineInterface, id: string): Promise<void> => {
  const audit = await read($, setupRef)
  const ids = [...new Set([...(await read($, setupSkippedRef)), id])]
  await update($, setupSkippedRef, () => ids)
  if (audit) await $.store.set('setupSkipped', { fingerprint: audit.fingerprint, ids })
}

const unskipAll = async ($: EngineInterface): Promise<void> => {
  const audit = await read($, setupRef)
  await update($, setupSkippedRef, () => [])
  if (audit) await $.store.set('setupSkipped', { fingerprint: audit.fingerprint, ids: [] })
}

const loadStoredSetup = async ($: EngineInterface): Promise<void> => {
  const stored = (await $.store.get('setupAudit')) as SetupAudit | undefined
  if (stored === undefined) return
  await update($, setupRef, () => stored)
  const skipped = (await $.store.get('setupSkipped')) as SkippedRecord | undefined
  if (skipped?.fingerprint === stored.fingerprint) await update($, setupSkippedRef, () => skipped.ids)
}

const buildReport = async ($: EngineInterface): Promise<string> => {
  const metrics = await currentMetrics($)
  const history = ((await $.store.get('history')) as HistoryEntry[] | undefined) ?? []
  const now = await $.clock.now()
  const report = reportMarkdown(metrics, score(metrics), await currentTips($, metrics), await read($, insightsRef), await loadPlaybook($), history, now)
  const vitals = vitalsLines({ metrics, usage: await read($, planUsageRef), git: await read($, gitRef), spend: await read($, spendRef), now })
  return `${report}\n\n## Vitals\n\n${vitals.map(line => `- ${line}`).join('\n')}`
}

const saveSession = async ($: EngineInterface, sessionId: string): Promise<void> => {
  const metrics = await currentMetrics($)
  if (metrics.turns === 0) return
  const now = await $.clock.now()
  const report = await buildReport($)
  const history = ((await $.store.get('history')) as HistoryEntry[] | undefined) ?? []
  const entry: HistoryEntry = { endedAt: now, total: score(metrics).total, turns: metrics.turns, tokens: metrics.inputTokens + metrics.outputTokens }
  await $.store.set('history', [...history, entry].slice(-HISTORY_CAP))
  await $.store.set('lastReport', report)
  if (config.obsidianDir) {
    const date = new Date(now).toISOString().slice(0, 10)
    try {
      await $.fs.write(`${config.obsidianDir.replace(/[\\/]+$/, '')}/${date}-${sessionId.slice(0, 8)}.md`, report)
    } catch (error) {
      $.ui.log(`session-coach: could not write the report to ${config.obsidianDir}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

export const register: Register = (on, options) => {
  config = readConfig(options)
  shownTips.clear()
  lastAnalyzedTurn = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Session coach: live score and suggestions. Args: analyze, refresh, setup [refresh], paste <post>, report, map, transparency, hide, show',
      argumentHint: '[analyze|refresh|setup|paste <post>|report|map|transparency|hide|show]',
    })
    if ((await read($, metricsRef)) === null) {
      const now = await $.clock.now()
      await update($, metricsRef, () => emptyMetrics(now))
    }
    await update($, analyzingRef, () => false)
    await update($, analysisNoteRef, () => '')
    const mapPath = await $.store.get('mapPath')
    if (typeof mapPath === 'string') await update($, mapPathRef, () => mapPath)
    const transparencyPath = await $.store.get('transparencyPath')
    if (typeof transparencyPath === 'string') await update($, transparencyPathRef, () => transparencyPath)
    if (config.openPane === 'auto') void $.ui.open({ id: PANE, title: 'Session coach' })
    $.clock.after(3000, () => void refreshFeed($, false))
    await update($, auditingRef, () => false)
    await loadStoredSetup($)
    $.clock.after(8000, () => void runAudit($, false))
    $.clock.after(1500, () => void refreshPlanUsage($))
    $.clock.after(2000, () => void checkGit($))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    await update($, isWorkingRef, () => true)
    return result
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta !== true && e.command === undefined) {
      turnStart = await currentMetrics($)
      lastPrompt = e.text.trim().slice(0, 500)
      await changeMetrics($, m => recordPrompt(m, e.text))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined) {
      await changeMetrics($, m =>
        recordTool(m, {
          tool: String(e.tool),
          input: e as unknown as Record<string, unknown>,
          isError: ran.isError === true,
          isDenied: ran.deny !== undefined,
        }),
      )
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask') await changeMetrics($, recordPermissionAsk)
    return verdict
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    await changeMetrics($, recordCompaction)
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await update($, isWorkingRef, () => false)

    const percent = await refreshPlanUsage($)
    await changeMetrics($, m =>
      recordContext(
        recordTurn(m, {
          durationMs: e.durationMs,
          isAborted: e.isAborted,
          inputTokens: e.usage?.input_tokens ?? 0,
          outputTokens: e.usage?.output_tokens ?? 0,
          cacheReadTokens: e.usage?.cache_read_input_tokens ?? 0,
          cacheCreationTokens: e.usage?.cache_creation_input_tokens ?? 0,
        }),
        percent ?? m.contextPercent,
      ),
    )

    const metrics = await currentMetrics($)
    const total = score(metrics).total
    await update($, trailRef, trail => [...trail, total].slice(-TRAIL_CAP))
    const before = turnStart ?? metrics
    turnStart = null
    if (config.judgeTurns) {
      const { answer, isAborted } = e
      $.clock.after(0, () => void judgeTurn($, answer, isAborted, before))
    }
    if (metrics.toolCalls > before.toolCalls || lastGitTurn < 0 || metrics.turns - lastGitTurn >= 5) {
      lastGitTurn = metrics.turns
      await checkGit($)
    }
    const fresh = (await currentTips($, metrics)).find(tip => !shownTips.has(tip.id))
    if (fresh !== undefined) {
      shownTips.add(fresh.id)
      $.ui.toast(`Coach: ${fresh.text}`)
    }
    if (config.analyzeEvery > 0 && metrics.turns - lastAnalyzedTurn >= config.analyzeEvery) {
      lastAnalyzedTurn = metrics.turns
      $.clock.after(0, () => void analyze($))
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await saveSession($, e.sessionId)
    if (e.reason === 'clear') {
      const now = await $.clock.now()
      await update($, metricsRef, () => emptyMetrics(now))
      await update($, spendRef, () => null)
      await update($, insightsRef, () => [])
      await update($, judgmentsRef, () => [])
      await update($, trailRef, () => [])
      shownTips.clear()
      lastAnalyzedTurn = 0
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    switch (verb.toLowerCase()) {
      case '': {
        await $.ui.open({ id: PANE, title: 'Session coach' })
        const metrics = await currentMetrics($)
        const s = score(metrics)
        return { text: `Coach pane opened. Score ${s.total}/100 after ${metrics.turns} turns.` }
      }
      case 'analyze': {
        const insights = await analyze($)
        return { text: insights.length === 0 ? await read($, analysisNoteRef) : insights.map(i => `- ${i.title} (${i.kind}): ${i.detail}`).join('\n') }
      }
      case 'refresh':
        return { text: await refreshFeed($, true) }
      case 'paste': {
        const post = e.args.trim().slice(verb.length).trim()
        if (!post) return { text: 'Usage: /coach paste <text of an X post>' }
        const pasted = await loadStrings($, 'pasted')
        await $.store.set('pasted', [...pasted, post].slice(-PASTED_CAP))
        return { text: `Saved (${pasted.length + 1} pasted posts). Run /coach refresh to rebuild the playbook.` }
      }
      case 'setup': {
        await $.ui.open({ id: SETUP_PANE, title: 'Setup audit' })
        const audit = await runAudit($, rest[0]?.toLowerCase() === 'refresh')
        const skipped = await read($, setupSkippedRef)
        const open = audit?.recommendations.filter(rec => !skipped.includes(rec.id)) ?? []
        return { text: open.length === 0 ? await read($, setupNoteRef) : open.map(rec => `- ${rec.title} (${rec.area}): ${rec.change}`).join('\n') }
      }
      case 'report':
        return { text: await buildReport($) }
      case 'map': {
        const path = await writeMap($, await loadPlaybook($))
        return { text: path ? `Playbook map written to ${path}. Open it in a browser.` : 'Could not write the playbook map to ~/.claude/session-coach.' }
      }
      case 'transparency': {
        const path = await writeTransparency($, await loadPlaybook($), await loadTrail($), await read($, feedRef))
        return { text: path ? `Transparency page written to ${path}. Open it in a browser.` : 'Could not write the transparency page to ~/.claude/session-coach.' }
      }
      case 'hide':
        await update($, bandHiddenRef, () => true)
        return { text: 'Coach band hidden. /coach show brings it back.' }
      case 'show':
        await update($, bandHiddenRef, () => false)
        return { text: 'Coach band shown.' }
      default:
        return { text: `Unknown: ${[verb, ...rest].join(' ')}. Use analyze, refresh, setup [refresh], paste <post>, report, map, transparency, hide or show.` }
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const stored = await read($, metricsRef)
    if (e.props.hasSurvey || stored === null || stored.turns === 0 || (await read($, bandHiddenRef))) {
      return next(e)
    }
    const metrics = normalizeMetrics(stored)
    const plan = Math.max(0, ...(await read($, planUsageRef)).map(w => w.percent))

    const { Box, Button, Text } = $.ui.resolve(e)
    const s = score(metrics)
    const insights = await read($, insightsRef)
    const latest = (await read($, judgmentsRef)).at(-1)
    const verdict = latest ? ` ${VERDICT_GLYPH[latest.verdict]} ${VERDICT_LABEL[latest.verdict]}` : ''
    const nudge = latest && latest.verdict !== 'on-track' ? latest.nudge ?? latest.note : undefined
    const topItem = nudge === undefined ? rankedItems(await currentTips($, metrics), insights)[0] : undefined
    const top = nudge ?? topItem?.title ?? latest?.note ?? 'On track.'
    const chip = topItem ? `P${topItem.priority}` : ''
    const planText = plan >= 60 ? `plan ${plan}%` : ''
    const width = Math.max(20, (e.props.bodyColumns ?? 80) - 26 - verdict.length - planText.length - chip.length)

    return (
      <Box flexDirection="row" gap={1}>
        <Text color={s.total >= 75 ? 'green' : s.total >= 50 ? 'yellow' : 'red'}>Coach {s.total}{verdict}</Text>
        {planText !== '' && <Text color={plan >= 80 ? 'red' : 'yellow'}>{planText}</Text>}
        {topItem && <Text color={PRIORITY_COLOR[topItem.priority]} bold>{chip}</Text>}
        <Text dimColor>{top.length > width ? `${top.slice(0, width - 1)}…` : top}</Text>
        <Button key="details" label="Details" onPress={() => void $.ui.open({ id: PANE, title: 'Session coach' })} />
        <Button key="hide" label="Hide" onPress={() => void update($, bandHiddenRef, () => true)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const metrics = await currentMetrics($)
    const s = score(metrics)
    const flagged = await currentTips($, metrics)
    const vitals = vitalsLines({ metrics, usage: await read($, planUsageRef), git: await read($, gitRef), spend: await read($, spendRef), now: await $.clock.now() })
    const insights = await read($, insightsRef)
    const feed = await read($, feedRef)
    const mapPath = await read($, mapPathRef)
    const transparencyPath = await read($, transparencyPathRef)
    const isAnalyzing = await read($, analyzingRef)
    const analysisNote = await read($, analysisNoteRef)
    const judgments = await read($, judgmentsRef)
    const trail = await read($, trailRef)
    const latest = judgments.at(-1)
    const setup = await read($, setupRef)
    const setupSkipped = await read($, setupSkippedRef)
    const openSetup = setup?.recommendations.filter(rec => !setupSkipped.includes(rec.id)) ?? []
    const now = await $.clock.now()
    const action = await read($, lastActionRef)
    const showAction = action !== null && (action.isRunning || now - action.at < FRESH_MS)
    const insightsFresh = action !== null && !action.isRunning && action.text.includes('new suggestion') && now - action.at < FRESH_MS
    const items = rankedItems(flagged, insights)
    const counts = priorityCounts(items)
    const bar = (value: number) => '█'.repeat(Math.round(value / 2)) + '░'.repeat(10 - Math.round(value / 2))

    const nudgeFix: Fix | undefined = latest?.nudge ? { kind: 'prompt', text: latest.nudge, ...(latest.nudgeWhen ? { when: latest.nudgeWhen } : {}) } : undefined
    const verdictColor = latest ? VERDICT_COLOR[latest.verdict] : 'subtle'
    const verdictText = [
      latest ? `**${VERDICT_GLYPH[latest.verdict]} ${VERDICT_LABEL[latest.verdict]}** · turn ${latest.turn}` : 'Judging starts after the first turn.',
      ...(latest ? ['', latest.note] : []),
      ...(nudgeFix ? ['', fixMarkdown(nudgeFix, 'Next')] : []),
      '',
      '```',
      `Score     ${sparkline(trail)} ${s.total}/100`,
      `Verdicts  ${judgments.slice(-20).map(j => VERDICT_GLYPH[j.verdict]).join(' ') || '-'}`,
      '```',
    ].join('\n')
    const recsNote = [
      ...(items.length === 0 ? ['Nothing to fix right now.'] : []),
      ...(insights.length === 0 ? [`Expert suggestions arrive ${config.analyzeEvery > 0 ? `every ${config.analyzeEvery} turns` : 'when you press Analyze now'}.`] : []),
      ...(analysisNote && !isAnalyzing ? [`_${analysisNote}_`] : []),
    ].join('\n\n')
    const recsTitle = `Recommendations${counts ? ` · ${counts}` : ''}${isAnalyzing ? ' · analyzing…' : insightsFresh ? ' · ✦ new' : ''}`

    const section = (key: string, title: string, color: string, children: RenderChildren[]) => (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} gap={1}>
        <Text color={color} bold>{title}</Text>
        {children}
      </Box>
    )
    const fixButtons = (key: string, fix: Fix, label: string) => (
      <Box key={`${key}-buttons`} flexDirection="row" gap={1}>
        <Button key={`${key}-fill`} label="Put in prompt" onPress={() => putFixInPrompt($, fix, label)} />
        <Button key={`${key}-copy`} label="Copy" onPress={press => copyText($, fixCopyText(fix), press.surface, label, 'prompt')} />
      </Box>
    )
    const card = (item: RankedItem) => (
      <Box key={item.key} flexDirection="column" borderStyle="round" borderColor={PRIORITY_COLOR[item.priority]} paddingX={1}>
        <Box key={`${item.key}-chips`} flexDirection="row" gap={1}>
          <Text color={PRIORITY_COLOR[item.priority]} bold>{PRIORITY_LABEL[item.priority].toUpperCase()}</Text>
          <Text color={CATEGORY_COLOR[item.category]}>{`· ${CATEGORY_LABEL[item.category]}`}</Text>
          <Text color={STAGE_COLOR[item.stage]}>{`· ${STAGE_LABEL[item.stage]}`}</Text>
          <Text dimColor>{`· ${item.source === 'rule' ? 'rule' : 'expert'}`}</Text>
        </Box>
        <Markdown
          key={`${item.key}-text`}
          text={[
            `**${item.title}**`,
            ...(item.detail ? ['', item.detail] : []),
            ...(item.fix ? ['', fixMarkdown(item.fix)] : []),
            ...(item.permanent ? ['', fixMarkdown(item.permanent, 'To make it stick')] : []),
            '',
            stageMarkdown(config.playbookUrl, item.stage),
          ].join('\n')}
        />
        {item.fix && fixButtons(item.key, item.fix, 'The fix')}
        {item.permanent && fixButtons(`${item.key}-permanent`, item.permanent, 'The permanent fix')}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Button key="analyze" variant="primary" label={isAnalyzing ? 'Analyzing…' : 'Analyze now'} onPress={() => analyze($)} />
          <Button key="refresh" label="Refresh feed" onPress={() => refreshFeed($, true)} />
          <Button key="setup" label="Setup audit" onPress={() => $.ui.open({ id: SETUP_PANE, title: 'Setup audit' })} />
          <Button key="copy-report" label="Copy report" onPress={async press => copyText($, await buildReport($), press.surface, 'the session report', 'file')} />
        </Box>
        {showAction && action !== null && (
          <Box key="status-box" borderStyle="round" borderColor={action.isRunning ? 'warning' : 'suggestion'} paddingX={1}>
            <Markdown key="status" text={`${action.isRunning ? '⏳' : '✦'} **${action.text}**`} />
          </Box>
        )}
        {section('now', '⚡ Now', verdictColor, [
          <Markdown key="verdict" text={verdictText} />,
          nudgeFix ? fixButtons('nudge', nudgeFix, 'The next prompt') : null,
        ])}
        {section('recs', recsTitle, 'claude', [
          recsNote ? <Markdown key="recs-note" text={recsNote} /> : null,
          ...items.map(card),
        ])}
        {section('vitals', '📊 Vitals', 'planMode', [<Markdown key="vitals-text" text={vitals.map(line => `- ${line}`).join('\n')} />])}
        {section('score', `🎯 Score ${s.total}/100`, 'suggestion', [
          <Markdown
            key="score-text"
            text={[
              '```',
              `Context       ${bar(s.parts.context)} ${s.parts.context}`,
              `Verification  ${bar(s.parts.verification)} ${s.parts.verification}`,
              `Discipline    ${bar(s.parts.discipline)} ${s.parts.discipline}`,
              `Leverage      ${bar(s.parts.leverage)} ${s.parts.leverage}`,
              `Efficiency    ${bar(s.parts.efficiency)} ${s.parts.efficiency}`,
              '```',
              '',
              `${metrics.turns} turns · ${metrics.toolCalls} tools · ${metrics.edits} edits · ${metrics.verifyRuns} checks · ${metrics.subagents} agents · ${metrics.skills} skills · context ${metrics.contextPercent}%`,
            ].join('\n')}
          />,
        ])}
        {section('setup-feed', '🛠 Setup & feed', 'subtle', [
          <Markdown
            key="setup-feed-text"
            text={[
              `Setup audit: ${openSetup.length} open recommendation${openSetup.length === 1 ? '' : 's'}${openSetup.length ? ` (${priorityCounts(openSetup.map(rec => ({ priority: rec.priority ?? 3 })))})` : ''}. Press **Setup audit** to review them.`,
              '',
              `Feed: ${feed.message}${feed.postCount ? ` (${feed.postCount} posts)` : ''}`,
              '',
              `Playbook map: [Agent Playbook Line Map](${config.playbookUrl}). Every recommendation links to its station.`,
              '',
              mapPath ? `Open local map: \`${mapPath}\` (rebuilt with the playbook; /coach map writes it now).` : 'Open local map: not written yet. Run /coach map.',
              '',
              transparencyPath
                ? `How the advice was built: \`${transparencyPath}\` (rewritten on every feed refresh; /coach transparency writes it now).`
                : 'How the advice was built: not written yet. Press Refresh feed or run /coach transparency.',
            ].join('\n')}
          />,
        ])}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: SETUP_PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const audit = await read($, setupRef)
    const isAuditing = await read($, auditingRef)
    const note = await read($, setupNoteRef)
    const skipped = await read($, setupSkippedRef)
    const applyStates = await read($, setupApplyStateRef)
    const open = sortRecommendations(audit?.recommendations.filter(rec => !skipped.includes(rec.id)) ?? [])
    const counts = priorityCounts(open.map(rec => ({ priority: rec.priority ?? 3 })))
    const header = [
      `## 🛠 Setup audit${counts ? ` · ${counts}` : ''}`,
      '',
      isAuditing ? '_Auditing your setup…_' : note ? `_${note}_` : audit ? '' : '_No audit yet. Press Run audit._',
      ...(audit ? ['', `Last audit ${new Date(audit.at).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${open.length} open · ${skipped.length} skipped`] : []),
    ].join('\n')

    return (
      <Box flexDirection="column" gap={1}>
        <Markdown text={header} />
        {open.map(rec => {
          const state = applyStates[rec.id]
          const canSend = state !== undefined && state !== 'sent'
          const canCopy = state !== 'copied'
          return (
            <Box key={`card-${rec.id}`} flexDirection="column" borderStyle="round" borderColor={PRIORITY_COLOR[rec.priority ?? 3]} paddingX={1}>
              <Box key={`chips-${rec.id}`} flexDirection="row" gap={1}>
                <Text color={PRIORITY_COLOR[rec.priority ?? 3]} bold>{PRIORITY_LABEL[rec.priority ?? 3].toUpperCase()}</Text>
                <Text color={CATEGORY_COLOR[rec.category ?? 'setup']}>{`· ${CATEGORY_LABEL[rec.category ?? 'setup']}`}</Text>
                <Text color={STAGE_COLOR[rec.stage ?? 'setup']}>{`· ${STAGE_LABEL[rec.stage ?? 'setup']}`}</Text>
                <Text dimColor>{`· ${rec.confidence} confidence`}</Text>
              </Box>
              <Markdown key={`text-${rec.id}`} text={`${recommendationCard(rec, state)}\n\n${stageMarkdown(config.playbookUrl, rec.stage ?? 'setup')}`} />
              <Box flexDirection="row" gap={1}>
                {state === undefined && <Button key={`apply-${rec.id}`} variant="primary" label="Apply" onPress={() => applyRecommendation($, rec)} />}
                {canSend && <Button key={`send-${rec.id}`} variant="primary" label="Send to Claude" onPress={() => sendRecommendation($, rec)} />}
                {canCopy && <Button key={`copy-${rec.id}`} label="Copy" onPress={press => copyRecommendation($, rec, press.surface)} />}
                <Button key={`skip-${rec.id}`} label={state === 'sent' ? 'Done' : 'Skip'} onPress={() => skipRecommendation($, rec.id)} />
              </Box>
            </Box>
          )
        })}
        <Box flexDirection="row" gap={1}>
          <Button key="rerun" label={isAuditing ? 'Auditing…' : audit ? 'Re-run audit' : 'Run audit'} onPress={() => runAudit($, true)} />
          {skipped.length > 0 && <Button key="unskip" label={`Show ${skipped.length} skipped`} onPress={() => unskipAll($)} />}
        </Box>
      </Box>
    )
  })
}
