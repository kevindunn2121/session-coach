import type { Category, Fix, Insight, Priority, SetupRecommendation, Stage, Tip } from '../types'

export const PRIORITIES: readonly Priority[] = [1, 2, 3, 4]
export const CATEGORIES: readonly Category[] = ['safety', 'cost', 'quality', 'context', 'workflow', 'git', 'setup']

export const PRIORITY_LABEL: Record<Priority, string> = { 1: 'P1 Critical', 2: 'P2 High', 3: 'P3 Medium', 4: 'P4 Low' }

export const PRIORITY_COLOR: Record<Priority, string> = { 1: 'error', 2: 'claude', 3: 'warning', 4: 'suggestion' }

export const CATEGORY_LABEL: Record<Category, string> = {
  safety: 'Safety',
  cost: 'Tokens & cost',
  quality: 'Quality',
  context: 'Context',
  workflow: 'Workflow',
  git: 'Git',
  setup: 'Setup',
}

export const CATEGORY_COLOR: Record<Category, string> = {
  safety: 'error',
  cost: 'claude',
  quality: 'success',
  context: 'planMode',
  workflow: 'suggestion',
  git: 'merged',
  setup: 'permission',
}

export const STAGES: readonly Stage[] = ['start', 'setup', 'plan', 'build', 'verify', 'ship', 'learn', 'context', 'safety']

export const STAGE_LABEL: Record<Stage, string> = {
  start: '1 Start',
  setup: '2 Set up',
  plan: '3 Plan',
  build: '4 Build',
  verify: '5 Verify',
  ship: '6 Ship',
  learn: '7 Learn',
  context: 'Context & cost line',
  safety: 'Safety line',
}

const STAGE_FOR_CATEGORY: Record<Category, Stage> = {
  safety: 'safety',
  cost: 'context',
  quality: 'verify',
  context: 'context',
  workflow: 'build',
  git: 'ship',
  setup: 'setup',
}

export const STAGE_COLOR: Record<Stage, string> = {
  start: 'claude',
  setup: 'permission',
  plan: 'success',
  build: 'suggestion',
  verify: 'warning',
  ship: 'merged',
  learn: 'planMode',
  context: 'subtle',
  safety: 'error',
}

export const DEFAULT_PLAYBOOK_URL = 'https://claude.ai/artifact/UT9DVjes46X3bM5J2DRVFU'

export const parseStage = (value: unknown, category: Category): Stage =>
  STAGES.includes(value as Stage) ? (value as Stage) : STAGE_FOR_CATEGORY[category]

export const stageUrl = (base: string, stage: Stage): string => `${base.replace(/#.*$/, '')}#${stage}`

export const stageMarkdown = (base: string, stage: Stage): string => `Playbook station: [${STAGE_LABEL[stage]}](${stageUrl(base, stage)})`

export const RANK_SCHEMA =
  '"priority":1,"category":"safety|cost|quality|context|workflow|git|setup","stage":"start|setup|plan|build|verify|ship|learn|context|safety"'

export const RANK_RULES =
  'Set priority for each item: 1 critical (causing failures, data risk or wasted work right now), 2 high (costs tokens or quality in every session), 3 medium (a clear improvement), 4 low (nice to have). Set category to the one that fits best: safety, cost (tokens and plan usage), quality (correctness and verification), context (context window and prompts), workflow (process and delegation), git, or setup (CLAUDE.md, settings, agents, skills, MCP). Set stage to the playbook station the advice belongs to: start (how a project or task is framed in its first prompt), setup (rules, agents, hooks, skills), plan (spec, done-when, plan mode), build (delegation, parallel sessions, editing), verify (tests, review, evals), ship (branches, commits, PRs), learn (turning mistakes into rules, skills and evals), context (context window, cost and plan usage, always on) or safety (destructive actions, secrets, permissions, always on).'

export const parsePriority = (value: unknown, fallback: Priority = 3): Priority => {
  const n = typeof value === 'string' ? Number(value.replace(/^p/i, '')) : value
  return PRIORITIES.includes(n as Priority) ? (n as Priority) : fallback
}

export const parseCategory = (value: unknown, fallback: Category = 'workflow'): Category =>
  CATEGORIES.includes(value as Category) ? (value as Category) : fallback

export type RankedItem = {
  key: string
  source: 'rule' | 'expert'
  priority: Priority
  category: Category
  stage: Stage
  title: string
  detail?: string
  fix?: Fix
  permanent?: Fix
}

export const rankedItems = (rules: Tip[], insights: Insight[]): RankedItem[] => {
  const items: RankedItem[] = [
    ...rules.map((tip): RankedItem => ({
      key: `tip-${tip.id}`,
      source: 'rule',
      priority: tip.priority,
      category: tip.category,
      stage: tip.stage,
      title: tip.text,
      fix: tip.fix,
      ...(tip.permanent ? { permanent: tip.permanent } : {}),
    })),
    ...insights.map((insight, n): RankedItem => ({
      key: `insight-${n}`,
      source: 'expert',
      priority: insight.priority ?? 3,
      category: insight.category ?? 'workflow',
      stage: insight.stage ?? STAGE_FOR_CATEGORY[insight.category ?? 'workflow'],
      title: insight.title,
      detail: `${insight.detail}${insight.name ? ` (${insight.kind}: ${insight.name})` : ''}`,
      ...(insight.fix ? { fix: insight.fix } : {}),
    })),
  ]
  return items.map((item, order) => ({ item, order })).sort((a, b) => a.item.priority - b.item.priority || a.order - b.order).map(({ item }) => item)
}

export const priorityCounts = (items: readonly { priority: Priority }[]): string =>
  PRIORITIES.map(p => ({ p, count: items.filter(item => item.priority === p).length }))
    .filter(({ count }) => count > 0)
    .map(({ p, count }) => `${count} P${p}`)
    .join(' · ')

export const sortRecommendations = (recs: SetupRecommendation[]): SetupRecommendation[] =>
  recs.map((rec, order) => ({ rec, order })).sort((a, b) => (a.rec.priority ?? 3) - (b.rec.priority ?? 3) || a.order - b.order).map(({ rec }) => rec)
