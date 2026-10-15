export type RateWindow = { kind: string; percentUsed: number; resetsAt: string | null }

export type Reading = {
  tokens: number | null
  window: number
  percent: number | null
  costUsd: number | null
  rate: RateWindow[]
}

// `effort` is what the band shows: the chip's pick while one stands, else
// `sessionEffort`, the level Claude Code itself last asked for (null until a
// request has been seen).
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

// The advisor's calls run inside a main-loop request, on a model of their
// own; only the transcript's `usage.iterations` records what they spent.
export type Advisor = {
  model: string
  calls: number
  in: number
  out: number
  usd: number | null
}

// What this process's API requests cost, in the engine's own dollars, by its
// request classes: the main loop (its advisor calls included), subagents, and
// the rest (compaction, titles, the auto-mode check).
export type Spend = { main: number; agents: number; background: number }

// The latest main-loop turn's speed: how long until Claude's first row that
// shows (text or a tool call, thinking included in the wait), and the whole
// turn; null until known. `startedAt` is when the turn still running began.
export type Speed = { firstOutputMs: number | null; replyMs: number | null; startedAt: number | null }

// The main loop's prompt-cache entry: when a request last read or wrote it
// (0 once a model switch forfeited it), how long it lives unread (5 minutes or
// an hour, as the request wrote it), and the model it is that model's for.
export type Cache = { at: number; ttlMs: number; model: string }

// The box's open dropdown: which chip opened it and the choices it offers;
// `pick`, the choice clicked and waiting to be confirmed; `isClosing` while it
// folds away.
export type Menu = { kind: 'model' | 'effort'; options: string[]; pick?: string; isClosing?: boolean }

// A fold the hooks module animates, the box's picker or a panel section's:
// how open it stands, 0 shut to 1 open, and which of the two it is bound for.
export type Motion = { at: number; to: 0 | 1 }

// A pasted image, offered above the box while its `[Image #id]` stands in the
// draft: the copy saved where the viewer opens it.
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
  // Its latest request's prompt (cache reads and writes included), its output
  // so far and their engine-priced dollars: context + out is the figure Claude
  // Code's agent list shows as `↓ N tokens`.
  context: number
  out: number
  usd: number
}

// The threshold alerts already raised: the context's until it drops below its
// threshold, the rate limit's until the window it fired for (`resetsAt`) resets.
export type Alerted = { context: boolean; rate: boolean; resetsAt: string | null }

declare module 'claude-code' {
  interface PluginState {
    statusbox: {
      reading: Reading | null
      meta: Meta | null
      place: Place | null
      totals: Tokens
      last: Tokens
      advisor: Advisor | null
      override: string | null
      turns: number
      agents: Agent[]
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
    }
  }
}
