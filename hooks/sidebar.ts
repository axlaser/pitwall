import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Live, Tab } from '../types'

// The side panel's sessions: this project's recent ones, which /resume
// switches between in place, and every Claude Code session running on this
// machine, from the records Claude Code keeps for its agents view. A session
// of another project cannot be switched to: /resume names only this one's.

type $ = EngineInterface

const TABS = 6
const tabs = atom({ plugin: 'statusbox', key: 'tabs' } as const, [] as Tab[])
const live = atom({ plugin: 'statusbox', key: 'live' } as const, [] as Live[])
const sessionId = atom({ plugin: 'statusbox', key: 'sessionId' } as const, null as string | null)

// `dir` is Claude Code's folder; the project's sessions sit in the folder
// named for its directory (each non-alphanumeric a `-`).
export async function refreshTabs($: $, dir: string | null): Promise<void> {
  const [root, id] = await Promise.all([$.session.root(), $.session.id()])
  await update($, sessionId, () => id)
  if (!dir) return
  const folder = `${dir}/projects/${root.replace(/[^a-zA-Z0-9]/g, '-')}`
  // A file of a row or two is no conversation: a bridge record, an aborted start.
  const files = (await $.fs.list(folder).catch(() => []))
    .filter(f => f.kind === 'file' && f.name.endsWith('.jsonl') && (f.size > 1024 || f.name === `${id}.jsonl`))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, TABS)
  const titles = await readTitles($, folder, files.map(f => f.name))
  await update($, tabs, () => files.map(f => ({ id: f.name.slice(0, -'.jsonl'.length), title: titles.get(f.name) ?? null, mtimeMs: f.mtimeMs })))
}

// Each session's title as /resume lists it: its last /rename (a custom-title
// row), else its last ai-title row. Those rows start their lines, so one
// findstr (grep) over the files reads them and nothing else.
async function readTitles($: $, folder: string, names: string[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  if (names.length === 0) return titles
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const paths = names.map(name => `${folder}/${name}`)
  const argv = isWindows
    ? ['findstr', '/r', '/c:^{.type.:.ai-title', '/c:^{.type.:.custom-title', ...paths.map(p => p.replace(/\//g, '\\'))]
    : ['grep', '-H', '-E', '^\\{"type":"(ai|custom)-title"', '--', ...paths]
  const r = await $.process.run(argv, { timeoutMs: 10_000 }).catch(() => null)
  const custom = new Map<string, string>()
  for (const line of r?.stdout.split(/\r?\n/) ?? []) {
    const at = line.indexOf('{"type":')
    if (at < 0) continue
    // findstr names the file only when it reads more than one.
    const name = at === 0 ? names[0] : line.slice(0, at - 1).split(/[\\/]/).pop()
    if (name === undefined) continue
    try {
      const row = JSON.parse(line.slice(at)) as { type?: unknown; aiTitle?: unknown; customTitle?: unknown }
      if (row.type === 'custom-title' && typeof row.customTitle === 'string') custom.set(name, row.customTitle)
      if (row.type === 'ai-title' && typeof row.aiTitle === 'string') titles.set(name, row.aiTitle)
    } catch {
      // a row cut off by the output cap
    }
  }
  for (const [name, title] of custom) titles.set(name, title)
  return titles
}

// shortcut: no check that each record's process still runs; one a crashed
// session left shows until Claude Code's own listing prunes it.
export async function refreshLive($: $, dir: string | null): Promise<void> {
  if (!dir) return
  const folder = `${dir}/sessions`
  const names = (await $.fs.list(folder).catch(() => [])).filter(f => f.kind === 'file' && /^\d+\.json$/.test(f.name)).map(f => f.name)
  const records = await Promise.all(names.map(name => $.fs.read(`${folder}/${name}`).then(parseLive, () => null)))
  const list = records.filter((r): r is Live => r !== null).sort((a, b) => b.since - a.since)
  await update($, live, prev => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list))
}

function parseLive(text: string): Live | null {
  try {
    const r = JSON.parse(text) as Record<string, unknown>
    const text_ = (v: unknown) => (typeof v === 'string' ? v : null)
    const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    const id = text_(r.sessionId)
    const cwd = text_(r.cwd)
    if (!id || !cwd) return null
    // A session an SDK program runs (a hook's helper, a script) reports no
    // status and no update time: it is labelled for what it is, aged from its start.
    const isProgram = text_(r.entrypoint)?.startsWith('sdk') === true
    return {
      sessionId: id,
      cwd,
      kind: text_(r.kind) ?? 'interactive',
      status: text_(r.status) ?? (isProgram ? 'sdk' : 'idle'),
      name: text_(r.name) ?? space(cwd),
      since: time(r.statusUpdatedAt) ?? time(r.updatedAt) ?? time(r.startedAt) ?? 0,
    }
  } catch {
    return null
  }
}

// Switches this terminal to the session: /resume, in place. One another
// terminal has open would gain a second writer, so it is named instead; a
// background one /resume attaches to.
export async function openSession($: $, id: string): Promise<void> {
  if (id === (await read($, sessionId))) return
  const held = (await read($, live)).find(s => s.sessionId === id)
  if (held?.status === 'sdk') return $.ui.toast(`That session is run by a program, not a terminal (${held.name})`)
  if (held?.kind === 'interactive') return $.ui.toast(`That session is open in another terminal (${held.name})`)
  await $.command.run({ command: 'resume', args: id }).catch(() => $.ui.toast('Could not switch to that session'))
}

export function space(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd
}

export function age(ms: number): string {
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}
