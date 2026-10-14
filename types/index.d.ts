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
// turn; null until known.
export type Speed = { firstOutputMs: number | null; replyMs: number | null }

// A pasted image's thumbnail, drawn above the box while its `[Image #id]`
// stands in the draft: a Raster's cells, quadrant blocks of its pixels, and
// the full image saved where the viewer opens it.
export type Preview = { id: number; columns: number; rows: number; cells: string; path: string }

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

// One of this project's sessions, most recently written first: what its tab
// switches to, titled as /resume lists it (null until it has a title).
export type Tab = { id: string; title: string | null; mtimeMs: number }

// A Claude Code session running on this machine, from the record Claude Code
// keeps of it for its agents view: `status` busy, idle, waiting (on the
// person) or shell; `kind` interactive (a terminal holds it) or a background one.
export type Live = { sessionId: string; cwd: string; kind: string; status: string; since: number }

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
      previews: Preview[]
      now: number
      tabs: Tab[]
      live: Live[]
      sessionId: string | null
      panelClosed: boolean
      alerted: Alerted
    }
  }
}
