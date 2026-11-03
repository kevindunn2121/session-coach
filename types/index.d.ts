export type Metrics = {
  startedAt: number
  turns: number
  abortedTurns: number
  turnMs: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  contextTrail: number[]
  editCounts: Record<string, number>
  permissionAsks: number
  contextPercent: number
  compactions: number
  prompts: number
  promptChars: number
  specificPrompts: number
  criteriaPrompts: number
  vaguePrompts: number
  reworkPrompts: number
  toolCalls: number
  toolCounts: Record<string, number>
  reads: number
  edits: number
  blindEdits: number
  editsSinceVerify: number
  verifyRuns: number
  failedCommands: number
  repeatedFailures: number
  denials: number
  subagents: number
  subagentTypes: Record<string, number>
  skills: number
  planModeUses: number
  webLookups: number
  readFiles: string[]
  failedCommandKeys: string[]
  recentPrompts: string[]
}

export type ScoreParts = {
  context: number
  verification: number
  discipline: number
  leverage: number
  efficiency: number
}

export type Score = { total: number; parts: ScoreParts }

export type FixKind = 'prompt' | 'claude-md' | 'settings' | 'file' | 'command' | 'action'

export type FixWhen = 'btw' | 'steer' | 'next' | 'interrupt' | 'later'

export type Fix = { kind: FixKind; text: string; target?: string; then?: string; when?: FixWhen }

export type SettingsPatch = { model?: string; env?: Record<string, string>; deny?: string[]; ask?: string[] }

export type Patch =
  | { kind: 'claude-md-append'; target: string; heading: string; lines: string }
  | { kind: 'settings-merge'; target: string; set: SettingsPatch }

export type PatchPlan = { isChanged: boolean; before: string; after: string } | { error: string }

export type Priority = 1 | 2 | 3 | 4

export type Category = 'safety' | 'cost' | 'quality' | 'context' | 'workflow' | 'git' | 'setup'

export type Stage = 'start' | 'setup' | 'plan' | 'build' | 'verify' | 'ship' | 'learn' | 'context' | 'safety'

export type Tip = { id: string; text: string; fix: Fix; permanent?: Fix; priority: Priority; category: Category; stage: Stage }

export type InsightKind = 'habit' | 'skill' | 'agent' | 'hook' | 'command'

export type Insight = {
  kind: InsightKind
  title: string
  detail: string
  name?: string
  source?: string
  fix?: Fix
  priority?: Priority
  category?: Category
  stage?: Stage
}

export type Practice = { practice: string; why: string; signal: string; stage?: Stage; evidence?: number[] }

export type ToolIdea = { kind: InsightKind; name: string; what: string; stage?: Stage; evidence?: number[] }

export type Playbook = {
  fetchedAt: number
  sources: string[]
  postCount: number
  practices: Practice[]
  tools: ToolIdea[]
}

/** One feed source in a playbook build: posts fetched, kept after duplicates were removed, and sent to the model. */
export type TrailSource = { source: string; fetched: number; kept: number; sent: number }

/** A post the playbook model saw, numbered as in its prompt so practices can cite it. */
export type TrailPost = { n: number; source: string; title: string; url?: string; score: number; publishedAt?: number; weight: number; rank: number }

/** How one playbook was built, for the transparency page. */
export type PlaybookTrail = {
  builtAt: number
  model: string
  sources: TrailSource[]
  skippedHandles: string[]
  fetched: number
  kept: number
  posts: TrailPost[]
  promptChars: number
  promptLimit: number
}

export type UsageWindow = { kind: string; percent: number; resetsAt?: string }

export type JobSpend = { calls: number; input: number; output: number; cacheRead: number }

export type CoachJob = 'judge' | 'analysis' | 'playbook' | 'setup'

export type CoachSpend = Record<CoachJob, JobSpend>

export type GitStatus = {
  isRepo: boolean
  branch: string
  changedFiles: number
  insertions: number
  deletions: number
  lastCommitAt: number
  checkedAt: number
}

export type Verdict = 'on-track' | 'drifting' | 'stuck' | 'blocked'

export type Judgment = {
  turn: number
  at: number
  verdict: Verdict
  note: string
  nudge?: string
  nudgeWhen?: FixWhen
}

export type Drift = 'less' | 'same' | 'more'

export type Outcome = { drift: Drift; tokens: string; summary: string }

export type SetupRecommendation = {
  id: string
  area: string
  title: string
  problem: string
  evidence: string
  change: string
  applyPrompt: string
  ifApplied: Outcome
  ifSkipped: Outcome
  confidence: 'high' | 'medium' | 'low'
  manualFix?: Fix
  patch?: Patch
  priority?: Priority
  category?: Category
  stage?: Stage
}

export type ApplyState = 'applied' | 'already' | 'undone' | 'undo-blocked' | 'apply-failed' | 'sent' | 'filled' | 'copied' | 'copy-failed'

export type AppliedPatch = { path: string; diff?: string; backup?: string; afterPrint?: string; isNew?: boolean; reason?: string }

export type SetupAudit = {
  at: number
  fingerprint: string
  instructionTokens: number
  recommendations: SetupRecommendation[]
}

export type ActionStatus = { text: string; at: number; isRunning: boolean }

export type FeedStatus = {
  state: 'idle' | 'fetching' | 'ok' | 'failed'
  message: string
  fetchedAt: number
  postCount: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-coach': {
      metrics: Metrics | null
      insights: Insight[]
      feed: FeedStatus
      isBandHidden: boolean
      isAnalyzing: boolean
      analysisNote: string
      judgments: Judgment[]
      trail: number[]
      setup: SetupAudit | null
      isAuditing: boolean
      setupNote: string
      setupSkipped: string[]
      setupApplyState: Record<string, ApplyState>
      setupApplied: Record<string, AppliedPatch>
      planUsage: UsageWindow[]
      coachSpend: CoachSpend | null
      git: GitStatus | null
      lastAction: ActionStatus | null
      isWorking: boolean
      mapPath: string
      transparencyPath: string
    }
  }
}
