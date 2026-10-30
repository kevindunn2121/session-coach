import type { Category, FixWhen, Metrics, Priority, Score, Stage, Tip } from '../types'

export type TipDraft = Omit<Tip, 'priority' | 'category' | 'stage'>

export type TipRank = [Priority, Category, Stage]

export type ToolEvent = {
  tool: string
  input: Record<string, unknown>
  isError: boolean
  isDenied: boolean
}

export type TurnEvent = {
  durationMs: number
  isAborted: boolean
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const BLIND_EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
const SUBAGENT_TOOLS = new Set(['Agent', 'Task'])
const WEB_TOOLS = new Set(['WebSearch', 'WebFetch'])

const FILE_REF = /(@[\w./\\-]+|[\w-]+\.(tsx?|jsx?|py|gd|cs|md|json|tscn|tres|go|rs|java|kt|swift|cpp|h|css|html|ya?ml|toml|sql)\b|:\d+\b|`[^`]+`)/i
const CRITERIA = /\b(should|must|expect|acceptance|done when|so that|verify|make sure|without breaking|test(s|ed)?|passes|fails?)\b/i
const CONFIRMATION = /^(y|yes|yep|ok|okay|go|go ahead|do it|continue|proceed|thanks|thank you|lgtm|ship it|sure|next)\b/i
const REWORK = /^(no\b|nope|wrong|that'?s not|this is not|still (broken|failing|not|wrong)|undo|revert|didn'?t work|doesn'?t work|not working|try again|you (broke|forgot|missed|ignored))/i
const VERIFY = /\b(test|tests|pytest|jest|vitest|mocha|gut_cmdln|cargo (test|check|clippy)|go (test|vet)|tsc|eslint|ruff|mypy|lint|typecheck|check-only|plugin (test|validate)|dotnet (test|build))\b/i

const READ_FILES_CAP = 300
const EDIT_COUNTS_CAP = 200
const CONTEXT_TRAIL_CAP = 20
const COMPACTION_AT = 95
const CHURN_EDITS = 5
const PERMISSION_ASKS = 8
const FAILED_KEYS_CAP = 50
const RECENT_PROMPTS = 6
const PROMPT_EXCERPT = 280

export const emptyMetrics = (now: number): Metrics => ({
  startedAt: now,
  turns: 0,
  abortedTurns: 0,
  turnMs: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  contextTrail: [],
  editCounts: {},
  permissionAsks: 0,
  contextPercent: 0,
  compactions: 0,
  prompts: 0,
  promptChars: 0,
  specificPrompts: 0,
  criteriaPrompts: 0,
  vaguePrompts: 0,
  reworkPrompts: 0,
  toolCalls: 0,
  toolCounts: {},
  reads: 0,
  edits: 0,
  blindEdits: 0,
  editsSinceVerify: 0,
  verifyRuns: 0,
  failedCommands: 0,
  repeatedFailures: 0,
  denials: 0,
  subagents: 0,
  subagentTypes: {},
  skills: 0,
  planModeUses: 0,
  webLookups: 0,
  readFiles: [],
  failedCommandKeys: [],
  recentPrompts: [],
})

export const normalizeMetrics = (m: Metrics): Metrics => ({ ...emptyMetrics(m.startedAt), ...m })

export const normalizePath = (path: string): string => path.replace(/\\/g, '/').toLowerCase()

export const classifyPrompt = (text: string) => {
  const trimmed = text.trim()
  const isSpecific = FILE_REF.test(trimmed)
  const hasCriteria = CRITERIA.test(trimmed)
  const isRework = REWORK.test(trimmed)
  const isConfirmation = CONFIRMATION.test(trimmed) && trimmed.length < 80
  const isVague = trimmed.length < 60 && !isSpecific && !hasCriteria && !isConfirmation && !isRework

  return { isSpecific, hasCriteria, isRework, isVague }
}

export const recordPrompt = (m: Metrics, text: string): Metrics => {
  const kind = classifyPrompt(text)
  const excerpt = text.trim().slice(0, PROMPT_EXCERPT)

  return {
    ...m,
    prompts: m.prompts + 1,
    promptChars: m.promptChars + text.length,
    specificPrompts: m.specificPrompts + (kind.isSpecific ? 1 : 0),
    criteriaPrompts: m.criteriaPrompts + (kind.hasCriteria ? 1 : 0),
    vaguePrompts: m.vaguePrompts + (kind.isVague ? 1 : 0),
    reworkPrompts: m.reworkPrompts + (kind.isRework ? 1 : 0),
    recentPrompts: [...m.recentPrompts, excerpt].slice(-RECENT_PROMPTS),
  }
}

const stringField = (input: Record<string, unknown>, key: string): string => {
  const value = input[key]
  return typeof value === 'string' ? value : ''
}

export const recordTool = (m: Metrics, call: ToolEvent): Metrics => {
  const next: Metrics = {
    ...m,
    toolCalls: m.toolCalls + 1,
    toolCounts: { ...m.toolCounts, [call.tool]: (m.toolCounts[call.tool] ?? 0) + 1 },
  }

  if (call.isDenied) {
    return { ...next, denials: m.denials + 1 }
  }

  const filePath = normalizePath(stringField(call.input, 'file_path') || stringField(call.input, 'notebook_path'))

  if (call.tool === 'Read' && filePath) {
    const readFiles = m.readFiles.includes(filePath) ? m.readFiles : [...m.readFiles, filePath].slice(-READ_FILES_CAP)
    return { ...next, reads: m.reads + 1, readFiles }
  }

  if (call.tool === 'Grep' || call.tool === 'Glob') {
    return { ...next, reads: m.reads + 1 }
  }

  if (EDIT_TOOLS.has(call.tool)) {
    const isBlind = BLIND_EDIT_TOOLS.has(call.tool) && filePath !== '' && !m.readFiles.includes(filePath)
    const canCount = filePath !== '' && (filePath in m.editCounts || Object.keys(m.editCounts).length < EDIT_COUNTS_CAP)
    return {
      ...next,
      editCounts: canCount ? { ...m.editCounts, [filePath]: (m.editCounts[filePath] ?? 0) + 1 } : m.editCounts,
      edits: m.edits + 1,
      blindEdits: m.blindEdits + (isBlind ? 1 : 0),
      editsSinceVerify: m.editsSinceVerify + 1,
    }
  }

  if (SHELL_TOOLS.has(call.tool)) {
    const command = stringField(call.input, 'command').trim()
    const isVerify = VERIFY.test(command)
    const key = command.slice(0, 120)
    const hasFailedBefore = call.isError && m.failedCommandKeys.includes(key)

    return {
      ...next,
      verifyRuns: m.verifyRuns + (isVerify ? 1 : 0),
      editsSinceVerify: isVerify ? 0 : m.editsSinceVerify,
      failedCommands: m.failedCommands + (call.isError ? 1 : 0),
      repeatedFailures: m.repeatedFailures + (hasFailedBefore ? 1 : 0),
      failedCommandKeys: call.isError && !hasFailedBefore
        ? [...m.failedCommandKeys, key].slice(-FAILED_KEYS_CAP)
        : m.failedCommandKeys,
    }
  }

  if (SUBAGENT_TOOLS.has(call.tool)) {
    const type = stringField(call.input, 'subagent_type') || 'general-purpose'
    return { ...next, subagents: m.subagents + 1, subagentTypes: { ...m.subagentTypes, [type]: (m.subagentTypes[type] ?? 0) + 1 } }
  }
  if (call.tool === 'Skill') return { ...next, skills: m.skills + 1 }
  if (call.tool === 'EnterPlanMode') return { ...next, planModeUses: m.planModeUses + 1 }
  if (WEB_TOOLS.has(call.tool)) return { ...next, webLookups: m.webLookups + 1 }

  return next
}

export const recordTurn = (m: Metrics, turn: TurnEvent): Metrics => ({
  ...m,
  turns: m.turns + 1,
  abortedTurns: m.abortedTurns + (turn.isAborted ? 1 : 0),
  turnMs: m.turnMs + turn.durationMs,
  inputTokens: m.inputTokens + turn.inputTokens,
  outputTokens: m.outputTokens + turn.outputTokens,
  cacheReadTokens: m.cacheReadTokens + turn.cacheReadTokens,
  cacheCreationTokens: m.cacheCreationTokens + turn.cacheCreationTokens,
})

export const recordContext = (m: Metrics, percent: number): Metrics => ({
  ...m,
  contextPercent: percent,
  contextTrail: [...m.contextTrail, percent].slice(-CONTEXT_TRAIL_CAP),
})

export const recordPermissionAsk = (m: Metrics): Metrics => ({ ...m, permissionAsks: m.permissionAsks + 1 })

export const cacheHitRate = (m: Metrics): number | undefined => {
  const total = m.inputTokens + m.cacheReadTokens + m.cacheCreationTokens
  return total === 0 ? undefined : m.cacheReadTokens / total
}

export const contextRunway = (m: Metrics): number | undefined => {
  const recent = m.contextTrail.slice(-6)
  if (recent.length < 3) return undefined
  const deltas = recent.slice(1).map((value, i) => value - (recent[i] ?? value)).filter(delta => delta > 0)
  if (deltas.length === 0) return undefined
  const growth = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length
  return growth < 0.5 ? undefined : Math.max(0, Math.floor((COMPACTION_AT - m.contextPercent) / growth))
}

export const mostEditedFile = (m: Metrics): { path: string; count: number } | undefined => {
  const [top] = Object.entries(m.editCounts).sort((a, b) => b[1] - a[1])
  return top === undefined ? undefined : { path: top[0], count: top[1] }
}

const fileName = (path: string): string => path.split('/').pop() ?? path

export const recordCompaction = (m: Metrics): Metrics => ({ ...m, compactions: m.compactions + 1 })

const clamp = (value: number): number => Math.round(Math.max(0, Math.min(20, value)))

const contextScore = (m: Metrics): number => {
  if (m.prompts === 0) return 12
  const specificRate = m.specificPrompts / m.prompts
  const criteriaRate = m.criteriaPrompts / m.prompts
  const vagueRate = m.vaguePrompts / m.prompts
  return clamp(8 + 12 * Math.max(specificRate, criteriaRate) - 8 * vagueRate)
}

const verificationScore = (m: Metrics): number => {
  if (m.edits === 0) return 14
  const expectedRuns = Math.max(1, m.edits / 4)
  const runRatio = Math.min(1, m.verifyRuns / expectedRuns)
  const stalePenalty = Math.min(8, Math.max(0, m.editsSinceVerify - 3) * 2)
  return clamp(20 * runRatio - stalePenalty)
}

const disciplineScore = (m: Metrics): number => {
  if (m.edits === 0) return 14
  const blindRate = m.blindEdits / m.edits
  const lowReadPenalty = m.reads / m.edits < 0.5 ? 4 : 0
  const noPlanPenalty = m.edits > 15 && m.planModeUses === 0 ? 3 : 0
  return clamp(20 * (1 - blindRate) - lowReadPenalty - noPlanPenalty)
}

const leverageScore = (m: Metrics): number => {
  if (m.toolCalls < 10) return 12
  return clamp(
    6 +
      (m.subagents > 0 ? 6 : 0) +
      (m.skills > 0 ? 4 : 0) +
      (m.webLookups > 0 ? 2 : 0) +
      (m.planModeUses > 0 ? 2 : 0),
  )
}

const efficiencyScore = (m: Metrics): number => {
  const contextPenalty = m.contextPercent > 80 ? 4 : m.contextPercent > 60 ? 2 : 0
  return clamp(
    20 -
      Math.min(6, m.failedCommands) -
      Math.min(6, m.repeatedFailures * 3) -
      Math.min(6, m.reworkPrompts * 2) -
      Math.min(3, m.denials) -
      contextPenalty,
  )
}

export const score = (m: Metrics): Score => {
  const parts = {
    context: contextScore(m),
    verification: verificationScore(m),
    discipline: disciplineScore(m),
    leverage: leverageScore(m),
    efficiency: efficiencyScore(m),
  }
  const total = parts.context + parts.verification + parts.discipline + parts.leverage + parts.efficiency

  return { total, parts }
}

const TIP_WHEN: Record<string, FixWhen> = {
  context: 'next',
  loop: 'interrupt',
  verify: 'steer',
  rework: 'interrupt',
  blind: 'steer',
  vague: 'next',
  plan: 'interrupt',
  delegate: 'steer',
  cache: 'later',
  runway: 'next',
  churn: 'interrupt',
  asks: 'next',
}

const TIP_RANK: Record<string, TipRank> = {
  context: [2, 'context', 'context'],
  loop: [1, 'quality', 'verify'],
  verify: [2, 'quality', 'verify'],
  rework: [1, 'workflow', 'plan'],
  blind: [2, 'quality', 'build'],
  vague: [3, 'context', 'start'],
  plan: [2, 'workflow', 'plan'],
  delegate: [3, 'cost', 'build'],
  cache: [2, 'cost', 'context'],
  runway: [1, 'context', 'context'],
  churn: [1, 'quality', 'build'],
  asks: [4, 'workflow', 'safety'],
}

export const finishTip = (tip: TipDraft, when: FixWhen | undefined, [priority, category, stage]: TipRank): Tip => ({
  ...tip,
  fix: when === undefined || tip.fix.when ? tip.fix : { ...tip.fix, when },
  ...(tip.permanent ? { permanent: { ...tip.permanent, when: tip.permanent.when ?? 'later' } } : {}),
  priority,
  category,
  stage,
})

export const tips = (m: Metrics): Tip[] => {
  const found: TipDraft[] = []

  if (m.contextPercent >= 75) {
    found.push({
      id: 'context',
      text: `Context is ${m.contextPercent}% full. Compact now, or start a fresh session with a handoff note.`,
      fix: { kind: 'command', text: '/compact keep the current task, the files changed so far, and the open decisions', then: 'Continue in this session. If the context fills again, start a new session.' },
    })
  }
  if (m.repeatedFailures > 0) {
    found.push({
      id: 'loop',
      text: 'The same command failed more than once. Diagnose the cause before you retry.',
      fix: { kind: 'prompt', text: 'Stop retrying. Read the full output of the last failing command, state the root cause in one sentence, then propose one fix and wait for my OK.' },
    })
  }
  if (m.editsSinceVerify >= 5) {
    found.push({
      id: 'verify',
      text: `${m.editsSinceVerify} edits since the last test, lint or type check.`,
      fix: { kind: 'prompt', text: "Run the project's tests, linter and type checker now and show me the real output before you make more edits." },
      permanent: { kind: 'claude-md', text: '- After every meaningful change, run the tests, linter and type checker, and show the real output.' },
    })
  }
  if (m.reworkPrompts >= 2) {
    found.push({
      id: 'rework',
      text: `${m.reworkPrompts} correction prompts so far. Agree on what done looks like before the next attempt.`,
      fix: { kind: 'prompt', text: 'Before you change anything else, restate the goal as 3 acceptance criteria I can check, and wait for my OK.' },
    })
  }
  if (m.blindEdits >= 2) {
    found.push({
      id: 'blind',
      text: `${m.blindEdits} edits to files Claude did not read this session.`,
      fix: { kind: 'prompt', text: 'Read every file you plan to edit before you change it, and tell me which files you read.' },
      permanent: { kind: 'claude-md', text: '- Read a file before you edit it. Never edit a file you have not read in this session.' },
    })
  }
  if (m.prompts >= 3 && m.vaguePrompts / m.prompts > 0.4) {
    found.push({
      id: 'vague',
      text: 'Many short prompts with no file or goal.',
      fix: { kind: 'prompt', text: 'In <file>, change <behavior> so that <expected result>. Done when <test or check> passes.', then: 'Replace the parts in angle brackets before you send it.' },
    })
  }
  if (m.edits > 15 && m.planModeUses === 0) {
    found.push({
      id: 'plan',
      text: 'Big change with no plan step.',
      fix: { kind: 'prompt', text: 'Stop editing. Write a short plan: the files to change, the approach, and how you will test it. Wait for my OK.' },
      permanent: { kind: 'claude-md', text: '- For any change that touches more than 5 files, write a plan first and wait for approval.' },
    })
  }
  if (m.toolCalls >= 40 && m.subagents === 0) {
    found.push({
      id: 'delegate',
      text: 'Long session with no subagents. Searches and reads fill the main context.',
      fix: { kind: 'prompt', text: 'Use the scout agent for the next searches and file reads, and give me only its summary.' },
    })
  }
  const hitRate = cacheHitRate(m)
  if (m.turns >= 5 && hitRate !== undefined && hitRate < 0.5) {
    found.push({
      id: 'cache',
      text: `Prompt cache hit rate is ${Math.round(hitRate * 100)}%. Something early in the context changes every turn.`,
      fix: { kind: 'action', text: 'Do not edit CLAUDE.md, switch models or turn MCP servers on or off during a session.', then: 'If you changed one of them, start a new session.' },
    })
  }
  const runway = contextRunway(m)
  if (runway !== undefined && runway <= 3) {
    found.push({
      id: 'runway',
      text: `About ${runway} turns until auto-compaction.`,
      fix: { kind: 'command', text: '/compact keep the current task, the files changed so far, and the open decisions' },
    })
  }
  const churn = mostEditedFile(m)
  if (churn !== undefined && churn.count >= CHURN_EDITS) {
    found.push({
      id: 'churn',
      text: `${fileName(churn.path)} edited ${churn.count} times. That is thrashing.`,
      fix: { kind: 'prompt', text: `Stop editing ${fileName(churn.path)}. Show me the failing case, explain what keeps going wrong, then propose one change.` },
    })
  }
  if (m.permissionAsks >= PERMISSION_ASKS) {
    found.push({
      id: 'asks',
      text: `${m.permissionAsks} permission asks this session.`,
      fix: { kind: 'command', text: '/fewer-permission-prompts', then: 'Review the allowlist it proposes before you accept it.' },
    })
  }

  return found.map(tip => finishTip(tip, TIP_WHEN[tip.id], TIP_RANK[tip.id] ?? [3, 'workflow', 'build']))
}
