export type RateWindow = { kind: string; percentUsed: number; resetsAt: string | null }

export type Reading = {
  tokens: number | null
  window: number
  percent: number | null
  costUsd: number | null
  rate: RateWindow[]
}

export type Meta = {
  model: string
  effort: string | null
  sessionEffort: string | null
  version: string
  startedAt: number
}

export type Git = {
  branch: string
  ahead: number
  behind: number
  insertions: number
  deletions: number
  untracked: number
  stash: number
}

export type Place = { cwd: string; home: string | null; remote: string | null; git: Git | null }

export type Tokens = { in: number; cacheWrite: number; cacheRead: number; out: number }

export type Advisor = {
  model: string
  calls: number
  in: number
  out: number
  usd: number | null
}

export type Spend = { main: number; agents: number; background: number }

export type Speed = { firstOutputMs: number | null; replyMs: number | null; startedAt: number | null }

export type Cache = { at: number | null; ttlMs: number; model: string }

export type Menu = { kind: 'model' | 'effort'; options: string[]; pick?: string; isClosing?: boolean }

export type Motion = { openness: number; to: 0 | 1 }

export type Preview = { id: number; path: string }

export type Agent = {
  id: string
  description: string
  type: string
  status: string
  model: string | null
  effort: string | null
  startedAt: number
  doneAt: number | null
  context: number
  in: number
  out: number
  cacheRead: number
  cacheWrite: number
  calls: number
  usd: number
  cacheAt: number | null
  cacheTtlMs: number
}

export type Alerted = { context: boolean; rate: Record<string, string | null> }

export type Verdicts = { allowed: number; blocked: number }

declare module 'claude-code' {
  interface PluginState {
    statusbox: {
      skin: string
      isLight: boolean
      chatSkinned: boolean
      took: Record<string, number>
      grounded: boolean
      ground: string | null
      reading: Reading | null
      meta: Meta | null
      place: Place | null
      totals: Tokens
      last: Tokens
      advisor: Advisor | null
      agentAdvisor: Record<string, Advisor>
      override: string | null
      turns: number
      agents: Agent[]
      stopArmed: string | null
      spend: Spend
      speed: Speed
      cache: Cache | null
      transcriptBytes: number | null
      menu: Menu | null
      motion: Record<string, Motion>
      folded: string[]
      previews: Preview[]
      now: number
      panelClosed: boolean
      alerted: Alerted
      verdicts: Verdicts
    }
  }
}
