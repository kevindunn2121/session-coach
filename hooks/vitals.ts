import type { CoachJob, CoachSpend, GitStatus, JobSpend, Metrics, Tip, UsageWindow } from '../types'

import { cacheHitRate, contextRunway, finishTip, mostEditedFile } from './metrics'
import type { TipDraft, TipRank } from './metrics'

const HOUR_MS = 60 * 60 * 1000
const PLAN_WARN = 80
const PLAN_CRITICAL = 95
const GIT_FILES = 10
const GIT_LINES = 300
const GIT_AGE_MS = 2 * HOUR_MS
const JOBS: readonly CoachJob[] = ['judge', 'analysis', 'playbook', 'setup']

const WINDOW_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

export const windowLabel = (kind: string): string => WINDOW_LABEL[kind] ?? kind.replace(/_/g, ' ')

export const planWindows = (limits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]): UsageWindow[] =>
  limits.map(limit => ({ kind: limit.kind, percent: limit.percentUsed, ...(limit.resetsAt ? { resetsAt: limit.resetsAt } : {}) }))

export const formatTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

export const formatDuration = (ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h ${minutes % 60}m` : `${Math.round(hours / 24)}d`
}

export const formatUntil = (iso: string | undefined, now: number): string => {
  const at = iso ? Date.parse(iso) : NaN
  return Number.isNaN(at) ? '' : `resets in ${formatDuration(at - now)}`
}

export const parseShortstat = (text: string): { insertions: number; deletions: number } => ({
  insertions: Number(text.match(/(\d+) insertions?\(\+\)/)?.[1] ?? 0),
  deletions: Number(text.match(/(\d+) deletions?\(-\)/)?.[1] ?? 0),
})

export const countPorcelain = (text: string): number => text.split('\n').filter(line => line.trim().length > 0).length

export const emptySpend = (): CoachSpend => ({
  judge: { calls: 0, input: 0, output: 0, cacheRead: 0 },
  analysis: { calls: 0, input: 0, output: 0, cacheRead: 0 },
  playbook: { calls: 0, input: 0, output: 0, cacheRead: 0 },
  setup: { calls: 0, input: 0, output: 0, cacheRead: 0 },
})

export const addSpend = (
  spend: CoachSpend | null,
  job: CoachJob,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number },
): CoachSpend => {
  const base = spend ?? emptySpend()
  const current = base[job]
  return {
    ...base,
    [job]: {
      calls: current.calls + 1,
      input: current.input + usage.input_tokens + usage.cache_creation_input_tokens,
      output: current.output + usage.output_tokens,
      cacheRead: current.cacheRead + usage.cache_read_input_tokens,
    },
  }
}

export const spendTotal = (spend: CoachSpend | null): JobSpend =>
  JOBS.reduce<JobSpend>(
    (sum, job) => {
      const s = spend?.[job]
      return s ? { calls: sum.calls + s.calls, input: sum.input + s.input, output: sum.output + s.output, cacheRead: sum.cacheRead + s.cacheRead } : sum
    },
    { calls: 0, input: 0, output: 0, cacheRead: 0 },
  )

const sessionTokens = (m: Metrics): number => m.inputTokens + m.cacheReadTokens + m.cacheCreationTokens + m.outputTokens

export const coachShare = (m: Metrics, spend: CoachSpend | null): number | undefined => {
  const total = spendTotal(spend)
  const coach = total.input + total.cacheRead + total.output
  const session = sessionTokens(m)
  return session === 0 ? undefined : coach / (session + coach)
}

const fileName = (path: string): string => path.split('/').pop() ?? path

export type Vitals = { metrics: Metrics; usage: UsageWindow[]; git: GitStatus | null; spend: CoachSpend | null; now: number }

export const vitalsLines = ({ metrics, usage, git, spend, now }: Vitals): string[] => {
  const lines: string[] = []

  if (usage.length > 0) {
    lines.push(`Plan: ${usage.map(w => `${windowLabel(w.kind)} ${w.percent}%${w.resetsAt ? ` (${formatUntil(w.resetsAt, now)})` : ''}`).join(' · ')}`)
  }

  const hitRate = cacheHitRate(metrics)
  const runway = contextRunway(metrics)
  lines.push(
    `Cache hit ${hitRate === undefined ? '-' : `${Math.round(hitRate * 100)}%`} · Context ${metrics.contextPercent}%${runway === undefined ? '' : `, ~${runway} turns to compaction`}`,
  )

  if (git?.isRepo) {
    const age = git.lastCommitAt > 0 ? `, last commit ${formatDuration(now - git.lastCommitAt)} ago` : ', no commits yet'
    lines.push(`Git ${git.branch}: ${git.changedFiles} changed files, +${git.insertions}/−${git.deletions}${age}`)
  }

  const churn = mostEditedFile(metrics)
  lines.push(`Permission asks ${metrics.permissionAsks}${churn && churn.count > 1 ? ` · Most edited ${fileName(churn.path)} ×${churn.count}` : ''}`)

  const total = spendTotal(spend)
  const share = coachShare(metrics, spend)
  lines.push(
    total.calls === 0
      ? 'Coach cost: no model calls yet'
      : `Coach cost: ${total.calls} calls, ${formatTokens(total.input + total.cacheRead)} in / ${formatTokens(total.output)} out${share === undefined ? '' : ` (${Math.round(share * 100)}% of all tokens)`}`,
  )

  return lines
}

export const vitalTips = (usage: UsageWindow[], git: GitStatus | null, now: number): Tip[] => {
  const found: TipDraft[] = []
  const worst = [...usage].sort((a, b) => b.percent - a.percent)[0]

  if (worst !== undefined && worst.percent >= PLAN_CRITICAL) {
    const reset = worst.resetsAt ? `, ${formatUntil(worst.resetsAt, now)}` : ''
    found.push({
      id: `plan-critical-${worst.kind}`,
      text: `${windowLabel(worst.kind)} plan window at ${worst.percent}%${reset}.`,
      fix: { kind: 'prompt', text: 'Finish only the current step, commit it, and write a short handoff note listing what is left. Then stop.' },
    })
  } else if (worst !== undefined && worst.percent >= PLAN_WARN) {
    const reset = worst.resetsAt ? `, ${formatUntil(worst.resetsAt, now)}` : ''
    found.push({
      id: `plan-${worst.kind}`,
      text: `${windowLabel(worst.kind)} plan window at ${worst.percent}%${reset}.`,
      fix: { kind: 'prompt', text: 'Until the plan window resets, use the scout agent for every search and file read, keep answers short, and do not re-read files you already read.' },
    })
  }

  if (git?.isRepo && git.changedFiles > 0) {
    if (git.branch === 'main' || git.branch === 'master') {
      found.push({
        id: 'git-main',
        text: `Uncommitted changes on ${git.branch}.`,
        fix: { kind: 'prompt', text: 'Move the uncommitted changes to a new feat/ branch with git switch -c, then continue there.' },
      })
    }
    if (git.changedFiles >= GIT_FILES || git.insertions + git.deletions >= GIT_LINES) {
      found.push({
        id: 'git-size',
        text: `${git.changedFiles} files, +${git.insertions}/−${git.deletions} uncommitted.`,
        fix: { kind: 'prompt', text: 'Commit the current work as a checkpoint: review git status, stage the files by name, and use a Conventional Commit message.' },
      })
    } else if (git.lastCommitAt > 0 && now - git.lastCommitAt > GIT_AGE_MS) {
      found.push({
        id: 'git-age',
        text: `Last commit was ${formatDuration(now - git.lastCommitAt)} ago with work pending.`,
        fix: { kind: 'prompt', text: 'Commit the current work as a checkpoint: review git status, stage the files by name, and use a Conventional Commit message.' },
      })
    }
  }

  const rank = (id: string): TipRank =>
    id.startsWith('plan-critical') ? [1, 'cost', 'context'] : id.startsWith('plan-') ? [2, 'cost', 'context'] : id === 'git-age' ? [3, 'git', 'ship'] : [2, 'git', 'ship']
  return found.map(tip => finishTip(tip, tip.id.startsWith('plan-') ? 'steer' : 'next', rank(tip.id)))
}
