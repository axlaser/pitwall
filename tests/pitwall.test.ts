import type { AgentInfo, AgentStatus, ConfigValue, On, PromptChangeInput, PromptEditInput, SessionUsage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { shortPath } from '../hooks/history'
import { CARD_INSET, cellsOf, FS_READ_MAX, paneInnerOf, ROW_MS } from '../hooks/register'
import { SKINS, paletteOf, themeOf } from '../hooks/skin'

const engine = (on: On, { opened, turns = () => 3, onClose }: { opened?: (true | undefined)[]; turns?: () => number; onClose?: () => Promise<void> } = {}) => {
  const kept = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: kept.get(e.key) }))
  on('store.set', ($, e) => (kept.set(e.key, e.value), { value: undefined }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.turns', () => ({ value: turns() }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('telemetry.log', () => ({ value: undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  const panes = new Set<string>()
  on('ui.open', ($, e) => (opened?.push(e.focus), panes.add(e.id), { value: { isPlaced: true as const } }))
  on('ui.close', async ($, e) => (await onClose?.(), panes.delete(e.id), { value: undefined }))
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  for (const event of ['PermissionRequest', 'Stop', 'PreCompact', 'PostCompact', 'PostModelSwitch', 'SessionStart'] as const) on(`classic.${event}`, () => ({}))
  return kept
}

const NO_GIT = { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }

const mockSession = (on: On, o: { model?: () => string; settings?: () => Record<string, unknown>; id?: () => string; os?: string; agents?: () => AgentInfo[]; usage?: () => SessionUsage } = {}) => {
  mock.env(on, o.os ? { HOME: '/home/me', OS: o.os } : { HOME: '/home/me' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: o.model?.() ?? 'claude-sonnet-6' }))
  on('session.version', () => ({ value: { version: '2.1.300', base: '2.1.300' } }))
  on('session.usage', () => ({ value: o.usage?.() ?? { startedAt: 0, context: { tokens: 1000, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }))
  on('session.cwd', () => ({ value: '/home/me/repo' }))
  on('session.repo', () => ({ value: null }))
  on('session.root', () => ({ value: '/home/me/repo' }))
  on('session.id', () => ({ value: o.id?.() ?? 'abc' }))
  on('settings.read', () => ({ value: o.settings?.() ?? {} }))
  on('agent.list', () => ({ value: o.agents?.() ?? [] }))
}

const responseRow = (kind: string, agentId?: string) => ({
  message: { type: 'assistant' as const, role: 'assistant' as const, content: [{ type: kind }] },
  door: 'response' as const,
  origin: { kind: 'model' as const, model: 'claude-opus-5-5' },
  uuid: `row-${kind}-${agentId ?? 'main'}`,
  ...(agentId && { agentId }),
})

const apiRequest = (attributes: Record<string, string | number>) =>
  ({ to: 'collector', event: 'api_request', attributes, loggedAt: '2026-10-14T00:00:00.000Z' }) as const

type Drawn = { props?: { backgroundColor?: string }; children?: unknown[] }
const backdrop = (node: Drawn | undefined): Drawn | undefined =>
  node?.props?.backgroundColor === 'composerSidebarBackground' ? node : (node?.children ?? []).map(child => backdrop(child as Drawn)).find(Boolean)
const frameOf = async (ui: { drawn: () => Promise<unknown> }) => backdrop((await ui.drawn()) as Drawn)
const cells = (node: unknown): number => {
  if (typeof node === 'string') return [...node].length
  const el = node as { type?: string; props?: { width?: number }; children?: unknown[] }
  if (el.type === 'Client') return el.props?.width ?? 0
  return (el.children ?? []).reduce((n: number, child) => n + cells(child), 0)
}
const cellsTo = (line: unknown, key: string): number => {
  let n = 0
  const walk = (node: unknown): boolean => {
    if (typeof node === 'string') return void (n += [...node].length), false
    const el = node as { type?: string; key?: string; props?: { key?: string; width?: number }; children?: unknown[] }
    if (el.key === key || el.props?.key === key) return true
    if (el.type === 'Client') return void (n += el.props?.width ?? 0), false
    return (el.children ?? []).some(walk)
  }
  return walk(line) ? n : -1
}

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 140,
  scroll: { offset: 0, bodyRows: 19 },
  view: {},
}

const PANE = {
  title: 'SIDEBAR',
  isFocused: false,
  bodyColumns: 40,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

const METER = paneInnerOf(PANE.bodyColumns) - CARD_INSET

test('each skin paints in hex, on a dark theme and a light one', () => {
  const colours = (value: unknown): string[] =>
    typeof value === 'string'
      ? [value]
      : value && typeof value === 'object'
        ? Object.entries(value).flatMap(([key, v]) => (key === 'name' ? [] : colours(v)))
        : []
  const bad = Object.entries(SKINS)
    .filter(([name]) => name !== 'classic')
    .flatMap(([name, pair]) => [...colours(pair.dark), ...colours(pair.light)].filter(c => !/^#[0-9a-f]{6}$/.test(c)).map(c => `${name}: ${c}`))
  expect([Object.keys(SKINS).length, bad]).toEqual([8, []])
})

test('each skin makes a Claude Code theme of each palette', () => {
  const made = Object.entries(SKINS).map(([name, pair]) => [name, themeOf(pair.dark, false), themeOf(pair.light, true)] as const)
  const bad = made.flatMap(([name, dark, light]) =>
    [dark, light].flatMap(theme => Object.entries(theme?.overrides ?? {}).filter(([, c]) => !/^#[0-9a-f]{6}$/.test(c)).map(([key]) => `${name}: ${key}`)),
  )
  const shape = made.map(([name, dark, light]) => [name, dark?.base, light?.base, dark?.name, light?.name])
  expect([shape.slice(0, 3), bad]).toEqual([
    [
      ['classic', undefined, undefined, undefined, undefined],
      ['tokyo-night', 'dark', 'light', 'Tokyo Night', 'Tokyo Day'],
      ['dracula', 'dark', 'light', 'Dracula', 'Alucard'],
    ],
    [],
  ])
})

test('a wide character takes two cells and a combining mark none', () => {
  expect(['repo', 'リポ', 'cafe\u0301', '⊟ 2', '✶'].map(cellsOf)).toEqual([4, 4, 4, 3, 1])
})

test('a tool row shortens a path by either separator', () => {
  const posix = { cwd: '/home/ana/repo', home: '/home/ana' }
  expect(shortPath('/home/ana/repo/hooks/a.ts', posix)).toBe('hooks/a.ts')
  expect(shortPath('/home/ana/notes.md', posix)).toBe('~/notes.md')
  expect(shortPath('/home/ana/repo-old/a.ts', posix)).toBe('~/repo-old/a.ts')
  expect(shortPath('/etc/hosts', posix)).toBe('/etc/hosts')
  const windows = { cwd: 'C:\\Users\\ana\\repo', home: 'C:\\Users\\ana' }
  expect(shortPath('C:\\Users\\ana\\repo\\hooks\\a.ts', windows)).toBe('hooks\\a.ts')
  expect(shortPath('C:\\Users\\ana\\notes.md', windows)).toBe('~\\notes.md')
  expect(shortPath('C:\\Users\\anabel\\a.ts', windows)).toBe('C:\\Users\\anabel\\a.ts')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the band draws the measured context and the turn's tokens as each request lands`, async ($, on) => {
    engine(on)
    const clock = mock.clock(on)

    const measured = {
      context: { tokens: 84_000, window: 200_000, percent: 42 },
      rateLimits: [{ kind: 'five_hour' as const, percentUsed: 23 }],
      cost: { usd: 0.1234 },
    }
    on('session.usage', () => ({ value: { startedAt: 0, ...measured } }))
    const usage = [
      { model: 'claude-opus-5-5', input_tokens: 1500, output_tokens: 150, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      { model: 'claude-opus-5-5', input_tokens: 1200, output_tokens: 250, cache_read_input_tokens: 0, cache_creation_input_tokens: 1200 },
    ]
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: usage[e.index] ?? null }
    })
    const step = async (index: number) => {
      for await (const _ of $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', effort: 'xhigh', messageCount: 1 })) {
      }
    }
    await $.session.measure({ ...measured, changed: ['context', 'rateLimits', 'cost'] })
    await $.turn.start({ text: 'hi', turnId: 't1' })
    await clock.advance(3000)
    await $.session.append(responseRow('text', 'a1'))
    await $.session.append(responseRow('thinking'))
    await clock.advance(4300)
    await $.session.append(responseRow('text'))
    await step(0)
    const band = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })
    expect((await band.find({ type: 'Text', in: 'n-in' }))?.text).toBe('1.5K')
    await band.unmount()
    await clock.advance(2000)
    await $.session.append(responseRow('tool_use'))
    await step(1)
    await $.turn.complete({
      answer: 'done',
      durationMs: 15_000,
      isAborted: false,
      turnId: 't1',
      reason: 'answer',
      usage: {
        model: 'claude-opus-5-5',
        input_tokens: 2700,
        output_tokens: 400,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 1200,
      },
    })

    const typed = { wait: false, origin: { kind: 'composer' } } as const
    await $.prompt.submit({ ...typed, text: 'hi' })
    await $.prompt.submit({ ...typed, text: '/effort max', command: { name: 'effort', args: 'max' } })

    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })
    const figure = async (key: string) => (await ui.find({ type: 'Text', in: `n-${key}` }))?.text

    expect(await ui.find({ type: 'Text', text: '/200K' })).toBeDefined()
    expect(await frameOf(ui)).toBeDefined()
    const want = { pct: '42%', used: '84.0K', in: '2.7K', 'in-delta': '(+2.7K)' }
    for (const [key, text] of Object.entries(want)) expect(`${key} ${await figure(key)}`).toBe(`${key} ${text}`)
    expect(await ui.find({ key: 'compact' })).toBeUndefined()

    for (const key of ['n-messages', 'n-first', 'n-reply', 'n-cost']) expect(await ui.find({ key })).toBeUndefined()
    const pane = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    for (const text of ['5-hour', ' message', 'first output ', 'reply ']) {
      expect((await pane.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)
    }
    const card = { 'usage-five_hour': '23%', 'session-messages': '1', 'session-first': '7.3s', 'session-reply': '15s', 'cost-total': '$0.1234' }
    for (const [key, text] of Object.entries(card)) {
      expect(`${key} ${(await pane.find({ type: 'Text', in: `n-${key}` }))?.text}`).toBe(`${key} ${text}`)
    }
  })

  const MiB = 1024 * 1024
  type Seed = { size: number; os: string; dir: string; folder: string }
  const seeds: Seed[] = [
    { size: 1024, os: 'Linux', dir: '/home/me/.claude', folder: '-home-me-repo' },
    { size: 5 * MiB, os: 'Linux', dir: '/cfg', folder: '-home-me-repo' },
    { size: 5 * MiB, os: 'Windows_NT', dir: '/home/me/.claude', folder: 'resumed-elsewhere' },
  ]
  const seedName = ({ size, os, dir, folder }: Seed) => `${os}, ${dir}/projects/${folder}, transcript of ${size} bytes`

  const seeded = async ($: Engine, on: On, { size, os, dir, folder }: Seed) => {
    const kept = engine(on)
    kept.set('folded', ['AGENTS'])
    const at = Date.parse('2026-10-14T12:00:00Z')
    const clock = mock.clock(on, { now: at })
    const set: Record<string, string> = dir === '/cfg' ? { CLAUDE_CONFIG_DIR: dir } : {}
    mock.env(on, os === 'Windows_NT' ? { HOME: '/home/me', OS: os, ...set } : { HOME: '/home/me', ...set })
    const ends = (path: string, tail: string) => path.replace(/\\/g, '/').endsWith(tail)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    const resets = (s: number) => new Date(at + s * 1000).toISOString()
    const rateLimits = [
      { kind: 'five_hour', percentUsed: 42, resetsAt: resets(2 * 3600) },
      { kind: 'seven_day', percentUsed: 20, resetsAt: resets(6 * 86_400) },
    ]
    on('session.usage', () => ({ value: { startedAt: at, context: { tokens: 100_000, window: 200_000, percent: 50 }, rateLimits, cost: { usd: 0.3 } } }))
    const sessionModel = 'claude-opus-5-5[1m]'
    on('session.model', () => ({ value: sessionModel }))
    on('session.version', () => ({ value: { version: '2.1.299', base: '2.1.299' } }))
    on('session.cwd', () => ({ value: '/home/me/repo' }))
    on('session.root', () => ({ value: '/home/me/repo' }))
    on('session.id', () => ({ value: 'abc' }))
    on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
    const model = { key: 'model', label: 'Model', kind: 'choice' as const, value: 'Default (recommended)', isLocked: false }
    const rows = [{ ...model, options: ['default', 'sonnet', 'opus', 'haiku', 'fable', 'best', 'sonnet[1m]', 'opus[1m]', 'fable[1m]', 'opusplan'], provider: { plugin: 'engine', tier: 'core' as const } }]
    const sets: [string, unknown][] = []
    on('config.list', () => ({ value: rows }))
    on('config.set', ($, e) => (sets.push([e.key, e.value]), { value: e.value }))
    on('agent.list', () => ({ value: [] }))
    const advice = { type: 'advisor_message', model: 'claude-fable-5-1', input_tokens: 1000, output_tokens: 100 }
    const cache_creation = { ephemeral_5m_input_tokens: 50, ephemeral_1h_input_tokens: 0 }
    const usage = { input_tokens: 100, output_tokens: 7, cache_creation, iterations: [{ type: 'message' }, advice] }
    const timestamp = new Date(at - 10 * 60_000).toISOString()
    const row = (id: string, extra = {}) => JSON.stringify({ type: 'assistant', timestamp, ...extra, message: { id, model: 'claude-opus-5-5', usage } })
    on('fs.read', ($, e) => ({
      value: ends(e.path, `${dir === '/cfg' ? '/cfg' : '/home/me'}/.claude.json`)
        ? config
        : isTranscript(e.path) && size <= FS_READ_MAX
          ? transcript
          : (Object.entries(catalogs).find(([name]) => ends(e.path, `${catalogDir}/${name}`))?.[1] ?? ''),
    }))
    const catalogDir = `${dir === '/cfg' ? '/cfg' : '/home/me/.claude'}/cache/model-catalog`
    const main = (name: string, extra = {}) => ({ id: name, name, short_name: name.split(' ')[0], section: 'main', ...extra })
    const catalogOf = (fetchedAt: number, models: unknown[]) => JSON.stringify({ version: 2, fetchedAt, catalog: { config: { models } } })
    const catalogs: Record<string, string> = {
      'org-a-cc.json': catalogOf(1, [main('Sonnet 9')]),
      'org-b-cc.json': catalogOf(2, [main('Opus 5.5'), main('Sonnet 6'), main('Fable 6', { min_claude_code_version: '2.1.400' }), { ...main('Haiku 4.5'), section: 'overflow' }]),
    }
    const fable6 = { inputTokens: 10, outputTokens: 50, promptCacheWriteTokens: 12.5, promptCacheReadTokens: 1, webSearchRequests: 0.01 }
    const config = JSON.stringify({ additionalModelCostsCache: { 'claude-fable-6': fable6, 'claude-bad-1': { inputTokens: -1 } } })
    const later = JSON.stringify({
      type: 'assistant',
      message: { id: 'm3', usage: { input_tokens: 0, output_tokens: 0, iterations: [{ ...advice, model: 'claude-fable-6' }] } },
    })
    const user = (content: unknown, extra = {}) => JSON.stringify({ type: 'user', ...extra, message: { content } })
    const notPrompts = [
      user('<command-name>/effort</command-name>'),
      user('<local-command-stdout>Set effort level to max</local-command-stdout>'),
      user([{ type: 'tool_result' }], { toolUseResult: {} }),
      user('a reminder', { isMeta: true }),
      user('the summary', { isCompactSummary: true }),
    ]
    const transcript = [user('hi'), ...notPrompts, row('m1'), row('m1'), row('m2', { isSidechain: true }), later, '{"type":"assis'].join('\n')
    const isTranscript = (path: string) => ends(path, `${dir}/projects/${folder}/abc.jsonl`)
    on('fs.exists', ($, e) => ({ value: isTranscript(e.path) }))
    on('fs.list', ($, e) => ({
      value: ends(e.path, catalogDir)
        ? ['masked-ids.json', ...Object.keys(catalogs)].map(name => ({ name, kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false }))
        : ['someone-else', folder].map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })),
    }))
    on('fs.stat', ($, e) => ({
      value: { kind: 'file', size: isTranscript(e.path) ? size : 0, mtimeMs: 0, isLink: false },
    }))
    on('process.spawn', async function* ($, e) {
      const file = e.argv.at(-1) ?? ''
      const isPrinter = os === 'Windows_NT' ? e.argv.join(' ') === `findstr /r ^ ${file}` && !file.includes('/') : e.argv[0] === 'cat'
      if (isPrinter && isTranscript(file)) {
        for (let at = 0; at < transcript.length; at += 37) yield { stream: 'stdout' as const, text: transcript.slice(at, at + 37) }
      }
      return { value: { code: 0, signal: null } }
    })
    const sentEffort: unknown[] = []
    on('turn.step', async function* ($, e) {
      sentEffort.push(e.effort)
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
    })
    const step = async (effort: 'high' | 'xhigh', model = sessionModel) => {
      for await (const _ of $.turn.step({ turnId: 't', index: 0, model, effort, messageCount: 1 })) {
      }
      return sentEffort.at(-1)
    }
    on('session.repo', () => ({
      value: { root: '/home/me/repo', remote: 'git@github.com:me/repo.git', internal: false, name: null },
    }))
    const ran: string[] = []
    on('command.run', ($, e) => (ran.push(`/${e.command} ${e.args}`), { text: '' }))
    const opened: string[][] = []
    on('process.run', ($, e) => (e.argv[0] === 'git' ? undefined : opened.push([...e.argv]), {
      value: {
        exitCode: 0,
        stdout: e.argv.includes('status')
          ? '# branch.oid abc1234def\n# branch.head main\n# branch.ab +2 -0\n? new.txt\n'
          : ' 1 file changed, 5 insertions(+), 1 deletion(-)\n',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }))

    await $.session.start({ cwd: '/home/me/repo', surface, isInteractive: true })
    return { clock, sets, ran, opened, step }
  }

  for (const seed of seeds) test(`${surface}: session start draws the repo row, git counts and version (${seedName(seed)})`, async ($, on) => {
    const { clock, opened } = await seeded($, on, seed)
    const { size } = seed
    const cache = async (ui: { find: (q: { type: 'Text'; in: string }) => Promise<{ text?: string } | undefined> }) =>
      Object.fromEntries(await Promise.all(['next', 'tokens', 'other'].map(async key => [key, (await ui.find({ type: 'Text', in: `n-cache-${key}` }))?.text])))
    const cold = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    for (const text of ['○ cold', 'lasts 5m idle', ' to rewrite ']) expect((await cold.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)
    expect(await cache(cold)).toEqual({ next: '$0.5000', tokens: '100.0K', other: '$0.0200' })
    await cold.unmount()
    await $.telemetry.log(apiRequest({ query_source: 'repl_main_thread', cost_usd: 0.25, model: 'claude-opus-5-5', cache_creation_1h_tokens: 1000, duration_ms: 90_000 }))
    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })
    const figure = async (key: string) => (await ui.find({ type: 'Text', in: `n-${key}` }))?.text

    for (const text of ['~/repo', 'main', '↑2', '+5', '-1', '~1', '┏━', '┣━', '┼']) {
      expect((await ui.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)
    }
    expect((await ui.find({ type: 'Text', text: 'Opus 5.5', in: 'chip-model' }))?.props.color).toBe('#d77757')
    expect(await ui.find({ key: 'n-messages' })).toBeUndefined()
    expect((await ui.find({ key: 'effort', in: 'chip-effort' }))?.text).toBe('xhigh effort')

    const lines = ((await frameOf(ui)) as { children: unknown[] }).children.filter(Boolean)
    expect(new Set(lines.map(cells)).size).toBe(1)
    for (const side of ['▐', '▌']) expect(await ui.find({ type: 'Text', text: lines.map(() => side).join('\n') })).toBeDefined()
    const want = { in: '100', 'in-delta': '(+0)', out: '7', 'out-delta': '(+0)' }
    for (const [key, text] of Object.entries(want)) expect(`${key} ${await figure(key)}`).toBe(`${key} ${text}`)
    expect(await ui.find({ key: 'n-advisor-calls' })).toBeUndefined()

    const pane = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    expect(await pane.find({ type: 'Text', text: '✶ Fable 6' })).toBeDefined()
    const onDisk = size < MiB ? '1.0 KB' : '5.0 MB'
    expect((await pane.find({ type: 'Text', text: onDisk })) ? onDisk : `missing: ${onDisk}`).toBe(onDisk)
    const card = { calls: '2', in: '2.0K', out: '200', usd: '$0.0300', share: '10%' }
    for (const [key, text] of Object.entries(card)) {
      expect(`${key} ${(await pane.find({ type: 'Text', in: `n-advisor-${key}` }))?.text}`).toBe(`${key} ${text}`)
    }
    expect(await pane.find({ key: 'advisor-share' })).toBeDefined()

    for (const [key, text] of Object.entries({ 'session-messages': '1', 'cost-total': '$0.3000' })) {
      expect(`${key} ${(await pane.find({ type: 'Text', in: `n-${key}` }))?.text}`).toBe(`${key} ${text}`)
    }
    expect(await pane.find({ type: 'Text', text: '0s' })).toBeDefined()
    const split = { main: '$0.2200', advisor: '$0.0300', 'advisor-share': '10%', earlier: '$0.0500' }
    for (const [key, text] of Object.entries(split)) {
      expect(`${key} ${(await pane.find({ type: 'Text', in: `n-cost-${key}` }))?.text}`).toBe(`${key} ${text}`)
    }
    await pane.advance(1000)
    expect((await pane.find({ type: 'Text', in: 'cost-split' }))?.text).toBe('━'.repeat(METER))
    const windows = { five_hour: '42%', 'five_hour-burn': '⇣18%', seven_day: '20%', 'seven_day-burn': '⇡6%' }
    for (const [key, text] of Object.entries(windows)) {
      expect(`${key} ${(await pane.find({ type: 'Text', in: `n-usage-${key}` }))?.text}`).toBe(`${key} ${text}`)
    }
    for (const text of ['5-hour', '7-day', 'resets in 2h', 'resets in 6d', ' pace 60%', ' pace 14%']) {
      expect((await pane.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)
    }
    expect(await pane.find({ type: 'Text', text: '┃', in: 'usage-five_hour' })).toBeDefined()
    expect(await ui.find({ key: 'n-usage-five_hour' })).toBeUndefined()

    for (const text of ['● warm', '58m30s left']) expect((await pane.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)
    expect(await cache(pane)).toEqual({ next: '$0.0200', tokens: '100.0K', other: '$0.8000' })
    const switched = { from_model: 'claude-opus-5-5[1m]', to_model: 'claude-fable-5-1', requested_model: 'fable', source: 'command' as const }
    await $.classic.PostModelSwitch({ ...switched, context_tokens: 100_000, prompt_cache_warm: true, cache_ttl: '1h', estimated_cache_write_usd: 2, pricing: 'catalog' })
    await pane.advance(1000)
    expect(await pane.find({ type: 'Text', text: '○ cold' })).toBeDefined()
    expect(await cache(pane)).toEqual({ next: '$2.0000', tokens: '100.0K', other: '$0.0250' })

    expect(await pane.find({ type: 'Text', text: 'No agents in this session yet.' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: ' none yet', in: 'fold-AGENTS' })).toBeDefined()

    await $.turn.start({ text: 'go', turnId: 't2' })
    await clock.advance(5000)
    for (const text of ['first output ', '5s']) expect((await pane.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)

    expect(await ui.find({ type: 'Text', text: 'v2.1.299' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: 'Claude Code v2.1.299' })).toBeDefined()
    await pane.press({ key: 'version' })
    await ui.press({ key: 'repo' })
    expect(opened.map(argv => argv.at(-1))).toEqual([
      'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md',
      'https://github.com/me/repo',
    ])
  })

  test(`${surface}: the effort chip's picker flares its levels, confirms one through /effort and folds`, async ($, on) => {
    const { clock, ran, step } = await seeded($, on, seeds[0] as Seed)
    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })
    const isOffered = async (key: string) => (await ui.find({ key })) !== undefined
    const isLit = async (key: string) => (await ui.find({ type: 'Text', in: key }))?.props.inverse === true
    const unfold = () => clock.advance(1000)
    const chip = async () => (await ui.find({ key: 'effort', in: 'chip-effort' }))?.text
    const pill = async (level: string) => ui.find({ type: 'Text', in: `pick-effort-${level}` })
    await ui.press({ key: 'effort' })
    expect(await isOffered('wire')).toBe(false)
    await clock.advance(48)
    expect([await isOffered('wire'), await isOffered('pick-effort-max')]).toEqual([true, false])
    await clock.advance(952)
    expect([await isOffered('pick-effort-max'), (await pill('max'))?.text?.trim()]).toEqual([true, ''])
    const flared = { max: new Set<string>(), low: new Set<string>() }
    for (let t = 0; t < 1200; t += 30) {
      await ui.advance(30)
      for (const level of ['max', 'low'] as const) {
        const color = (await ui.findAll({ type: 'Text', in: `pick-effort-${level}` })).find(text => text.props.color)?.props.color
        if (typeof color === 'string') flared[level].add(color)
      }
    }
    expect([[...flared.max].sort(), [...flared.low]]).toEqual([['red', 'white', 'yellow'], ['gray']])
    const layerOf = async (level: string) => (await ui.findAll({ type: 'Box', in: `pick-effort-${level}` })).find(box => box.props.position === 'absolute')
    expect([(await layerOf('max'))?.props.display, (await ui.find({ key: 'pick-effort-max-lit', in: 'pick-effort-max' }))?.type]).toEqual(['none', 'Button'])
    const looped = new Set<string>()
    for (let t = 0; t < 1500; t += 30) looped.add(await ui.advance(30).then(async () => (await ui.findAll({ type: 'Text', in: 'pick-effort-max' })).at(-1)?.text ?? ''))
    expect([...looped].sort()).toEqual([' ✸ max ', ' ✹ max ', ' ✺ max ', ' ❂ max '])
    const picked = new Set<string>()
    for (let t = 0; t < 1500; t += 30) {
      await ui.advance(30)
      const lit = await pill('xhigh')
      picked.add(lit?.props.inverse === true ? (lit.text ?? '') : 'not lit')
    }
    expect([[...picked].sort(), (await pill('low'))?.props.inverse]).toEqual([[' ✶ xhigh ', ' ✷ xhigh ', ' ✸ xhigh ', ' ✹ xhigh ', ' ✺ xhigh '], undefined])
    expect((await pill('max'))?.props.inverse).toBeUndefined()
    expect(await ui.find({ key: 'pick-effort-xhigh-lit', in: 'pick-effort-xhigh' })).toBeUndefined()
    await ui.press({ key: 'pick-effort-max' })
    const confirm = async () => (await ui.find({ key: 'confirm' }))?.text
    expect([await chip(), (await pill('max'))?.props.inverse, (await pill('xhigh'))?.props.inverse, await confirm()]).toEqual(['xhigh effort', true, undefined, ' ✓ Confirm '])
    const flare: string[] = []
    for (const ms of [30, 60, 30]) flare.push(await ui.advance(ms).then(async () => `${(await pill('max'))?.text} ${(await pill('max'))?.props.color}`))
    expect(flare).toEqual([' ✺ max  red', ' ✹ max  yellow', ' ❂ max  white'])
    await ui.press({ key: 'confirm' })
    expect([await chip(), await isOffered('pick-effort-max'), await confirm()]).toEqual(['max effort', true, undefined])
    await ui.advance(90)
    expect([(await pill('max'))?.text?.trim(), (await pill('low'))?.text?.trim()]).toEqual(['', '· low'])
    await unfold()
    expect(await isOffered('pick-effort-max')).toBe(false)
    await ui.press({ key: 'effort' })
    await unfold()
    await ui.press({ key: 'pick-effort-low' })
    await ui.press({ key: 'confirm' })
    await unfold()
    expect(await chip()).toBe('low effort')
    expect(await isOffered('pick-effort-max')).toBe(false)
    await ui.press({ key: 'chevron-effort' })
    await unfold()
    expect(await isOffered('pick-effort-max')).toBe(true)
    await ui.press({ key: 'chevron-effort' })
    await unfold()
    expect(await isOffered('pick-effort-max')).toBe(false)
    const chevron = () => ui.press({ key: 'chevron-effort' })
    await chevron()
    await unfold()
    await chevron()
    await clock.advance(300)
    expect([await isOffered('pick-effort-max'), await isOffered('wire')]).toEqual([false, true])
    await chevron()
    await clock.advance(700)
    expect(await isOffered('pick-effort-max')).toBe(true)
    await chevron()
    await unfold()
    expect(await isOffered('wire')).toBe(false)
    expect(ran).toEqual(['/effort max', '/effort low'])
    expect(await step('xhigh')).toBe('low')
    expect(await step('high')).toBe('high')
    expect(await chip()).toBe('high effort')
  })

  for (const seed of seeds) test(`${surface}: the model chip's picker names its models from the catalog and draws a wire to the pick (${seedName(seed)})`, async ($, on) => {
    const { clock, sets, step } = await seeded($, on, seed)
    await step('high', 'claude-opus-5-5')
    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })
    const isOffered = async (key: string) => (await ui.find({ key })) !== undefined
    const isLit = async (key: string) => (await ui.find({ type: 'Text', in: key }))?.props.inverse === true
    const unfold = () => clock.advance(1000)
    const widths = async () => new Set(((await frameOf(ui)) as { children: unknown[] }).children.filter(Boolean).map(cells))
    const width = await widths()
    await ui.press({ key: 'model' })
    await unfold()
    const drawnIn = async (key: string) => (await ui.find({ type: 'Text', in: key }))?.text?.trim()
    expect([await drawnIn('wire'), await drawnIn('wire-arrow')]).toEqual(['◂', ''])
    await ui.advance(1000)
    const pillText = async (key: string) => (await ui.find({ type: 'Text', in: key }))?.text
    const labels = await Promise.all(['opus', 'sonnet', 'fable', 'haiku'].map(alias => pillText(`pick-model-${alias}`)))
    expect(labels).toEqual([' Opus 5.5 ', ' Sonnet 6 ', ' Fable ', ' Haiku '])
    const tints = await Promise.all(['opus', 'sonnet', 'fable', 'haiku'].map(async alias => (await ui.find({ type: 'Text', in: `pick-model-${alias}` }))?.props.color))
    expect(tints).toEqual(['#d77757', '#5f9cf5', '#b48cf2', '#5fbf8f'])
    const [swept, padded] = [new Set<unknown>(), new Set<unknown>()]
    for (let t = 0; t < 1500; t += 30) {
      await ui.advance(30)
      for (const text of await ui.findAll({ type: 'Text', in: 'pick-model-sonnet' })) swept.add(text.props.color)
      for (const text of await ui.findAll({ type: 'Text', in: 'pick-model-haiku' })) if (text.text === ' ' && text.props.color) padded.add(text.props.color)
    }
    expect([swept.size, swept.has('#5f9cf5'), padded.size]).toEqual([4, true, 4])
    expect(await Promise.all(['default', 'opus[1m]', 'opusplan', 'best'].map(alias => isOffered(`pick-model-${alias}`)))).toEqual([false, false, false, false])
    expect(await isLit('pick-model-opus')).toBe(true)
    expect(await widths()).toEqual(width)
    const textOf = (node: unknown): string => (typeof node === 'string' ? node : ((node as { children?: unknown[] }).children ?? []).map(textOf).join(''))
    const isBlank = (text = 'x') => text.replace(/[┃│\s]/g, '') === ''
    const linesOf = async () => ((await frameOf(ui)) as { children: unknown[] }).children.filter(Boolean)
    const textIn = async (key: string) => [...((await ui.find({ type: 'Text', in: key }))?.text ?? '')]
    const middle = (line: unknown, key: string, text: string) => cellsTo(line, key) + Math.floor([...text].length / 2)
    const wireAt = async () => {
      const lines = await linesOf()
      const at = lines.findIndex(line => cellsTo(line, 'wire') >= 0)
      const base = cellsTo(lines[at], 'wire')
      const [run, arrow] = [await textIn('wire'), await textIn('wire-arrow')]
      return { lines, at, corners: [base + run.indexOf('╯'), base + run.indexOf('╭'), base + arrow.indexOf('▾')] }
    }
    const unrolled = await wireAt()
    const wireRow = unrolled.at
    const texts = unrolled.lines.map(textOf)
    const end = texts.findIndex((text, i) => i > wireRow + 2 && isBlank(text))
    expect([wireRow > 0, texts[end + 1]?.includes('┼')]).toEqual([true, true])
    const fromChip = middle(unrolled.lines[wireRow - 1], 'chip-model', (await ui.find({ key: 'model', in: 'chip-model' }))?.text ?? '')
    const toPill = middle(unrolled.lines[wireRow + 2], 'pick-model-opus', ' Opus 5.5 ')
    expect(toPill).toBeGreaterThan(0)
    expect(toPill).toBeLessThan(fromChip)
    expect(unrolled.corners).toEqual([fromChip, toPill, toPill])
    const pillLine = unrolled.lines[wireRow + 2]
    const start = cellsTo(unrolled.lines[wireRow], 'wire')
    const room = (await textIn('wire')).length
    const before = cellsTo(pillLine, 'pick-model-haiku') - start
    const after = start + room - (cellsTo(pillLine, 'pick-model-fable') + ' Fable '.length)
    expect([0, 1]).toContain(after - before)
    const order = ['haiku', 'sonnet', 'opus', 'fable'].map(alias => cellsTo(pillLine, `pick-model-${alias}`))
    expect([order.every(at => at >= 0), order]).toEqual([true, [...order].sort((a, b) => a - b)])
    await ui.press({ key: 'pick-model-sonnet' })
    await ui.advance(16)
    expect([sets, (await textIn('wire')).includes('◂'), await drawnIn('wire-arrow')]).toEqual([[], true, ''])
    const pills = (await linesOf())[wireRow + 2]
    expect([cellsTo(pills, 'confirm'), (await ui.find({ key: 'confirm' }))?.text]).toEqual([cellsTo(pills, 'pick-model-fable') + ' Fable '.length + 2, ' ✓ Confirm '])
    expect(await widths()).toEqual(width)
    await ui.advance(1000)
    const toSonnet = middle(pills, 'pick-model-sonnet', ' Sonnet 6 ')
    expect((await wireAt()).corners).toEqual([fromChip, toSonnet, toSonnet])
    await ui.press({ key: 'pick-model-opus-lit' })
    expect(await isOffered('confirm')).toBe(false)
    const heads = async () => (await textIn('wire')).filter(cell => cell === '▸' || cell === '◂')
    const backing = [await heads(), await ui.advance(160).then(heads)]
    expect(backing).toEqual([['◂'], ['◂']])
    await ui.press({ key: 'pick-model-sonnet' })
    await ui.press({ key: 'confirm' })
    expect(sets).toEqual([['model', 'sonnet']])
    await unfold()
    expect(await isOffered('pick-model-opus')).toBe(false)
    await ui.press({ key: 'chevron-model' })
    await unfold()
    await ui.advance(1000)
    expect(await pillText('pick-model-sonnet[1m]')).toBe(' Sonnet 6 ')
    expect([await isOffered('pick-model-sonnet'), await isLit('pick-model-opus[1m]')]).toEqual([false, true])
    await ui.advance(1000)
    const settled = (await textIn('wire')).join('')
    await ui.press({ key: 'effort' })
    expect([(await textIn('wire')).join('').replace(/[▸◂]/, '╭'), await drawnIn('wire-arrow')]).toEqual([settled, ''])
    await ui.advance(1000)
    const glided = await wireAt()
    const fromEffort = middle(glided.lines[glided.at - 1], 'chip-effort', (await ui.find({ key: 'effort', in: 'chip-effort' }))?.text ?? '')
    const toXhigh = cellsTo(glided.lines[glided.at + 2], 'pick-effort-xhigh') + 3 + Math.floor('xhigh'.length / 2)
    expect(glided.corners).toEqual([fromEffort, toXhigh, toXhigh])
  })

  test(`${surface}: a section's header folds it, says what it holds, and keeps the choice`, async ($, on) => {
    const kept = engine(on)
    const clock = mock.clock(on)
    let afterWrites: Promise<string>[] | null = null
    on('state.set', async ($, e, next) => {
      const r = await next(e)
      afterWrites?.push(pane.drawn().then(drawn => heldTo(drawn).join()))
      return r
    })
    await $.session.measure({ context: { tokens: 1, window: 200_000, percent: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 23 }], changed: ['rateLimits'] })
    const pane = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    const fold = () => pane.press({ key: 'fold-USAGE' })
    const heldTo = (node: unknown): number[] => {
      const el = node as { props?: { overflow?: string; height?: number }; children?: unknown[] }
      const inner = (el?.children ?? []).flatMap(heldTo)
      return el?.props?.overflow === 'hidden' && el.props.height !== undefined ? [el.props.height, ...inner] : inner
    }
    expect([await pane.find({ key: 'n-usage-five_hour' }) !== undefined, heldTo(await pane.drawn())]).toEqual([true, []])
    const rule = async () =>
      [...((await pane.findAll({ type: 'Text', in: 'fold-USAGE' })).find(text => /^ [─ ]*$/.test(text.text ?? ''))?.text ?? '')].filter(cell => cell === '─').length
    const ruled = async () => {
      const seen = [await rule()]
      for (let tick = 0; tick < 8; tick++) seen.push(await pane.advance(25).then(rule))
      return seen.filter((cells, i) => cells !== seen[i - 1])
    }
    expect(await ruled()).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24])
    await pane.advance(100)
    expect(await rule()).toBe(30)
    const clicked = async () => {
      afterWrites = []
      await fold()
      await clock.advance(ROW_MS)
      const seen = [...new Set(await Promise.all(afterWrites))]
      afterWrites = null
      return seen
    }

    expect(await clicked()).toEqual(['4,4', '3,3'])
    await clock.advance(300)
    expect([await pane.find({ key: 'n-usage-five_hour' }), heldTo(await pane.drawn())]).toEqual([undefined, []])
    expect(await pane.find({ type: 'Text', text: ' 5-hour 23%', in: 'fold-USAGE' })).toBeUndefined()
    expect(await ruled()).toEqual([30, 27, 24, 21, 19])
    expect(await pane.find({ type: 'Text', text: ' 5-hour 23%', in: 'fold-USAGE' })).toBeDefined()
    expect(kept.get('folded')).toEqual(['USAGE'])

    expect(await clicked()).toEqual(['0,2', '1,2'])
    await clock.advance(300)
    expect([await pane.find({ key: 'n-usage-five_hour' }) !== undefined, heldTo(await pane.drawn())]).toEqual([true, []])
    expect(await ruled()).toEqual([19, 22, 25, 28, 30])
    expect(kept.get('folded')).toEqual([])
  })

  test(`${surface}: the cost card splits the total by who asked, from the engine's request records`, async ($, on) => {
    engine(on)
    mock.clock(on)
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1000, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }))
    const record = (query_source: string, cost_usd: number) => $.telemetry.log(apiRequest({ query_source, cost_usd }))
    await record('repl_main_thread', 0.25)
    await record('agent:builtin:Explore', 0.1)
    await record('auto_mode', 0.01)
    await $.telemetry.log({ to: 'collector', event: 'tool_result', attributes: { cost_usd: 9 }, loggedAt: '2026-10-14T00:00:00.000Z' })
    await $.session.measure({ context: { tokens: 1, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 0.4 }, changed: ['cost'] })

    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })

    const want = { main: '$0.2500', 'main-share': '63%', agents: '$0.1000', 'agents-share': '25%', background: '$0.0100', earlier: '$0.0400', 'earlier-share': '10%' }
    for (const [key, text] of Object.entries(want)) {
      expect(`${key} ${(await ui.find({ type: 'Text', in: `n-cost-${key}` }))?.text}`).toBe(`${key} ${text}`)
    }
    await ui.advance(1000)
    const split = (await ui.find({ type: 'Text', in: 'cost-split' }))?.text ?? ''
    expect([...split].length).toBe(METER)
    expect(split).toBe('━'.repeat(METER))
  })

  test(`${surface}: while agents work the cost card splits the cost as it stands, never past the whole`, async ($, on) => {
    engine(on)
    mock.clock(on)
    let ledger = 0
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: ledger } } }))
    const record = async (query_source: string, cost_usd: number, isInLedger = true) => {
      if (isInLedger) ledger += cost_usd
      await $.telemetry.log(apiRequest({ query_source, cost_usd }))
    }
    await record('repl_main_thread', 0.25)
    await $.session.measure({ context: { tokens: 1, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: ledger }, changed: ['cost'] })
    await record('agent:builtin:Explore', 0.5)
    await record('agent:builtin:Explore', 0.5)
    const shares = async () => {
      const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
      const keys = ['total', 'main-share', 'agents-share', 'background-share']
      const texts = await Promise.all(keys.map(async key => (await ui.find({ type: 'Text', in: `n-cost-${key}` }).catch(() => undefined))?.text))
      await ui.unmount()
      return texts
    }
    expect(await shares()).toEqual(['$1.2500', '20%', '80%', undefined])
    await record('auto_mode', 0.25, false)
    expect(await shares()).toEqual(['$1.5000', '17%', '67%', '17%'])
  })

  test(`${surface}: a figure rolls to its new value, holding the cells it settles in`, async ($, on) => {
    engine(on)
    await $.session.measure({ context: { tokens: 84_000, window: 200_000, percent: 42 }, rateLimits: [], changed: ['context'] })
    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })
    const used = async () => (await ui.find({ type: 'Text', in: 'n-used' }))?.text ?? ''
    expect(await used()).toBe('84.0K')

    await $.session.measure({ context: { tokens: 120_000, window: 200_000, percent: 60 }, rateLimits: [], changed: ['context'] })
    await ui.advance(200)
    const mid = await used()
    expect(mid.length).toBe('120.0K'.length)
    const at = Number.parseFloat(mid)
    expect(at > 84 && at < 120 ? 'between' : mid).toBe('between')
    await ui.advance(1000)
    expect(await used()).toBe('120.0K')

    await $.session.measure({ context: { tokens: 9_000, window: 200_000, percent: 4 }, rateLimits: [], changed: ['context'] })
    await ui.advance(40)
    expect(await used()).toBe('9.0K')
  })

  test(`${surface}: the bar glides to the reading and Claude frolics in one spot while it works`, async ($, on) => {
    engine(on)
    await $.session.measure({ context: { tokens: 84_000, window: 200_000, percent: 42 }, rateLimits: [], changed: ['context'] })
    const working = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: { ...BAND, isWorking: true } })
    const has = async (ui: typeof working, text: string, at: string) => ((await ui.find({ type: 'Text', text, in: at })) ? text : `missing: ${text}`)

    expect(await has(working, '━━━━', 'bar')).toBe('missing: ━━━━')
    await working.advance(3000)
    expect(await has(working, '╾', 'bar')).toBe('╾')
    await working.advance(120 - (3000 % 120))
    const spark = async () => (await Promise.all(['✢', '✶', '✻', '✽'].map(g => has(working, g, 'claude')))).find(g => !g.startsWith('missing'))
    const first = await spark()
    await working.advance(240)
    expect(await spark()).not.toBe(first)
    for (let i = 0; i < 8; i++) {
      await working.advance(120)
      const cells = [...((await working.find({ type: 'Text', in: 'claude' }))?.text ?? '')]
      const isSpaced = cells[1] === ' ' && cells.slice(2).join('') === 'Working' && ['·', '✢', '✶', '✻', '✽'].includes(cells[0] ?? '')
      expect(isSpaced ? 'spark, space, word' : cells.join('')).toBe('spark, space, word')
    }
    const lit = new Set<string>()
    const brightest: string[] = []
    for (let i = 0; i < 17; i++) {
      await working.advance(60)
      lit.add((await working.find({ type: 'Text', text: /^W$/, in: 'claude' }))?.props.color as string)
      for (const cell of await working.findAll({ type: 'Text', in: 'claude' })) if (cell.props.color === '#f5ddd5') brightest.push(cell.text ?? '')
    }
    expect([...lit].sort()).toEqual(['#dc876b', '#e3a089', '#ebbbab', '#f5ddd5', 'claude'])
    const letters = brightest.filter(text => /^[A-Za-z]$/.test(text))
    expect([letters.sort().join(''), brightest.some(text => ['·', '✢', '✶', '✻', '✽'].includes(text))]).toEqual([[...'Working'].sort().join(''), true])

    const idle = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })
    const colorOf = async (text: RegExp) => (await idle.find({ type: 'Text', text, in: 'claude' }))?.props.color
    expect([await has(idle, 'Ready', 'claude'), await colorOf(/^✓$/), await colorOf(/^Ready$/)]).toEqual(['Ready', 'green', 'green'])
  })

  test(`${surface}: an agent in the panel carries its tokens, working time and engine-priced cost`, async ($, on) => {
    engine(on)
    const clock = mock.clock(on)
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1000, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }))
    let status: AgentStatus = 'running'
    on('agent.list', () => ({ value: [{ id: 'a1', description: 'Org pricing', type: 'Explore', status }] }))
    on('turn.step', async function* ($, e) {
      const n = e.index
      return {
        turnId: e.turnId,
        index: n,
        answer: '',
        toolUses: [],
        stopReason: 'end_turn' as const,
        usage: { model: 'claude-opus-5-5', input_tokens: 10 + n, output_tokens: 3000 + n, cache_read_input_tokens: 40_000 + n, cache_creation_input_tokens: 2000 + n },
      }
    })
    const step = async (index: number) => {
      for await (const _ of $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', effort: 'xhigh', messageCount: 1, agentId: 'a1' })) {
      }
    }
    const record = (n: number, cost_usd: number) =>
      $.telemetry.log(
        apiRequest({ query_source: 'agent:builtin:Explore', cost_usd, input_tokens: 10 + n, output_tokens: 3000 + n, cache_read_tokens: 40_000 + n, cache_creation_tokens: 2000 + n }),
      )

    await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })
    await record(0, 0.25)
    await step(0)
    await step(1)
    await record(1, 0.1)
    await clock.advance(70_000)
    const busy = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    expect(await busy.find({ type: 'Text', text: 'Working', in: 'working-a1' })).toBeDefined()
    await busy.unmount()
    status = 'completed'
    await $.turn.complete({ answer: 'done', durationMs: 70_000, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })

    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    for (const text of ['✓ done', 'Explore', 'Org pricing', ' 1m10s', 'Opus 5.5 · xhigh', ' calls', 'in', 'out', 'cache↑', 'cache↓', 'context', 'cost']) {
      expect((await ui.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)
    }
    const want = { calls: '2', in: '21', out: '6.0K', cacheWrite: '4.0K', cacheRead: '80.0K', context: '42.0K', usd: '$0.3500' }
    for (const [key, text] of Object.entries(want)) {
      expect(`${key} ${(await ui.find({ type: 'Text', in: `n-a1-${key}` }))?.text}`).toBe(`${key} ${text}`)
    }
    const P = paletteOf('classic', false)
    const colours = await Promise.all(['cacheWrite', 'cacheRead'].map(async key => (await ui.find({ type: 'Text', in: `n-a1-${key}` }))?.props.color))
    expect([colours, P.warn === P.info]).toEqual([[P.warn, P.info], false])
    const band = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ type: 'Text', text: 'Org pricing' })).toBeUndefined()
  })

  test(`${surface}: two agents whose requests used the same tokens each get their own cost`, async ($, on) => {
    engine(on)
    mock.clock(on)
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1000, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }))
    on('agent.list', () => ({ value: ['a1', 'a2'].map(id => ({ id, description: id, type: 'Explore', status: 'running' as AgentStatus })) }))
    const usage = { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 3000, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 2000 }
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
    })
    for (const agentId of ['a1', 'a2']) {
      await $.turn.start({ text: 'go', turnId: agentId, agentId })
      for await (const _ of $.turn.step({ turnId: agentId, index: 0, model: 'claude-opus-5-5', effort: 'xhigh', messageCount: 1, agentId })) {
      }
    }
    for (const _ of ['a1', 'a2']) {
      await $.telemetry.log(apiRequest({ query_source: 'agent:builtin:Explore', cost_usd: 0.25, input_tokens: 10, output_tokens: 3000, cache_read_tokens: 40_000, cache_creation_tokens: 2000 }))
    }
    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    const costs = await Promise.all(['a1', 'a2'].map(async id => (await ui.find({ type: 'Text', in: `n-${id}-usd` }).catch(() => undefined))?.text))
    expect(costs).toEqual(['$0.2500', '$0.2500'])
  })

  test(`${surface}: an agent's name puts its transcript in the main view, and the panel leads back to the main one`, async ($, on) => {
    engine(on)
    mock.clock(on)
    on('agent.list', () => ({
      value: [
        { id: 'a1', description: 'Org pricing', type: 'Explore', status: 'running' as AgentStatus },
        { id: 'a2', description: 'Old search', type: 'general-purpose', status: 'completed' as AgentStatus },
      ],
    }))
    const asked: (string | undefined)[] = []
    on('ui.view', ($, e) => (asked.push(e.agentId), { value: e.agentId === 'a2' ? { deny: 'that agent is not one the tasks list shows' } : {} }))
    const toasts: string[] = []
    on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
    await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })

    const main = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    expect([(await main.find({ key: 'view-a1' }))?.text, await main.find({ key: 'view-main' })]).toEqual(['Explore ›', undefined])
    type Node = { type?: string; props?: { color?: string }; hover?: unknown; children?: unknown[] }
    const textOf = (node: Node | undefined, text: string): Node | undefined =>
      node?.type === 'Text' && node.children?.join('') === text ? node : (node?.children ?? []).map(child => textOf(child as Node, text)).find(Boolean)
    const drawn = (await main.drawn()) as Node
    const [name, chevron] = [textOf(drawn, 'Explore'), textOf(drawn, ' ›')]
    expect([chevron?.hover, name?.props?.color]).toEqual([{ scope: 'view-a1', color: name?.props?.color }, expect.any(String)])
    const doubles = (node: unknown): number => {
      const el = node as { props?: { borderStyle?: string }; children?: unknown[] } | undefined
      return (el?.props?.borderStyle === 'double' ? 1 : 0) + (el?.children ?? []).reduce((n: number, child) => n + doubles(child), 0)
    }
    expect([await main.find({ type: 'Text', text: '● viewing' }), doubles(drawn)]).toEqual([undefined, 0])
    await main.press({ key: 'view-a1' })
    await main.unmount()

    const inAgent = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: { ...PANE, view: { agentId: 'a1' } } })
    expect((await inAgent.find({ key: 'view-a1' }))?.text).toBe('Explore ‹')
    expect([await inAgent.find({ type: 'Text', text: 'viewing Explore' }), await inAgent.find({ type: 'Text', text: '● viewing' })].map(Boolean)).toEqual([true, true])
    const viewed = (await inAgent.drawn()) as Node
    const [viewedName, back] = [textOf(viewed, 'Explore'), textOf(viewed, ' ‹')]
    expect([back?.hover, doubles(viewed)]).toEqual([{ scope: 'view-a1', color: viewedName?.props?.color }, 1])
    await inAgent.press({ key: 'view-main' })
    await inAgent.press({ key: 'view-a1' })
    await inAgent.press({ key: 'view-a2' })
    await inAgent.unmount()
    expect([asked, toasts]).toEqual([['a1', undefined, undefined, 'a2'], ['that agent is not one the tasks list shows']])

    const after = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    expect([await after.find({ key: 'view-a2' }), await after.find({ type: 'Text', text: 'general-purpose' })].map(Boolean)).toEqual([false, true])
  })

  test(`${surface}: a finished agent stays a minute after it ends, even once Claude Code drops it, then leaves the panel`, async ($, on) => {
    engine(on)
    const clock = mock.clock(on)
    let list: { id: string; description: string; type: string; status: AgentStatus }[] = [{ id: 'a1', description: 'Org pricing', type: 'Explore', status: 'running' }]
    let lists = 0
    on('agent.list', () => (lists++, { value: list }))
    let writes = 0
    on('state.set', { plugin: 'pitwall', key: 'agents' }, ($, e, next) => (writes++, next(e)))
    await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })
    list = [{ ...list[0]!, status: 'completed' }]
    await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    expect(await ui.find({ type: 'Text', text: '✓ done' })).toBeDefined()

    list = []
    const before = writes
    await clock.advance(55_000)
    expect([await ui.find({ type: 'Text', text: '✓ done' }), writes - before]).toEqual([expect.anything(), 0])
    await clock.advance(6000)
    expect([await ui.find({ type: 'Text', text: '✓ done' }), await ui.find({ type: 'Text', text: 'No agents in this session yet.' })].map(Boolean)).toEqual([false, true])
    const polled = lists
    await clock.advance(20_000)
    expect(lists).toBe(polled)
  })

  const stoppable = (on: On) => {
    engine(on)
    const clock = mock.clock(on)
    const agent = { id: 'a1', description: 'Org pricing', type: 'Explore', status: 'running' as AgentStatus }
    let lists = 0
    on('agent.list', () => (lists++, { value: [agent] }))
    return { clock, agent, lists: () => lists }
  }
  const mountPane = (surface: 'terminal' | 'desktop', $: Engine) => $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })

  test(`${surface}: two agents starting at once both stay running, whichever list read lands last`, async ($, on) => {
    engine(on)
    mock.clock(on)
    const x = { id: 'x', description: 'first', type: 'Explore', status: 'running' as AgentStatus }
    const y = { id: 'y', description: 'second', type: 'Explore', status: 'running' as AgentStatus }
    let reads = 0
    let release = () => {}
    const held = new Promise<void>(resolve => (release = resolve))
    on('agent.list', async () => {
      const n = reads++
      if (n === 0) await held
      return { value: n === 0 ? [x] : [x, y] }
    })
    const started = [$.turn.start({ text: 'go', turnId: 'tx', agentId: 'x' }), $.turn.start({ text: 'go', turnId: 'ty', agentId: 'y' })]
    release()
    await Promise.all(started)
    const ui = await mountPane(surface, $)
    expect(await Promise.all(['stop-x', 'stop-y', 'dismiss-y'].map(async key => Boolean(await ui.find({ key }))))).toEqual([true, true, false])
  })

  test(`${surface}: a long agent type is cut short so its card keeps one title row`, async ($, on) => {
    engine(on)
    mock.clock(on)
    on('agent.list', () => ({ value: [{ id: 'a1', description: 'Review', type: 'compound-engineering:ce-code-review', status: 'running' as AgentStatus }] }))
    await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })
    const name = (await (await mountPane(surface, $)).find({ key: 'view-a1' }))?.text ?? ''
    expect([name.endsWith('… ›'), cellsOf(name) <= METER - 9 - 10 + 2]).toEqual([true, true])
  })

  test(`${surface}: a running agent's stop asks once more, then stops it through TaskStop`, async ($, on) => {
    const { agent } = stoppable(on)
    const calls: { tool: string; task_id?: string; consent?: string }[] = []
    on('tool.call', ($, e) => {
      calls.push(e as never)
      agent.status = 'killed'
      return { result: { message: 'Successfully stopped task: a1', task_id: 'a1', task_type: 'local_agent' } as never }
    })
    await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })
    const ui = await mountPane(surface, $)
    expect([(await ui.find({ key: 'stop-a1' }))?.text, await ui.find({ key: 'dismiss-a1' })]).toEqual(['■ Stop', undefined])
    type Node = { type?: string; props?: { color?: string; bold?: boolean }; hover?: unknown; children?: unknown[] }
    const textOf = (node: Node | undefined, text: string): Node | undefined =>
      node?.type === 'Text' && node.children?.join('') === text ? node : (node?.children ?? []).map(child => textOf(child as Node, text)).find(Boolean)
    const stop = textOf((await ui.drawn()) as Node, '■ Stop')
    expect([stop?.props?.color, stop?.props?.bold ?? false, stop?.hover]).toEqual([paletteOf('classic', false).bad, false, { scope: 'stop-a1', bold: true }])

    await ui.press({ key: 'stop-a1' })
    const armed = await ui.find({ key: 'stop-a1' })
    expect([armed?.text, calls.length]).toEqual(['■ Confirm', 0])
    await ui.press({ key: 'stop-a1' })
    expect(calls.map(call => [call.tool, call.task_id])).toEqual([['TaskStop', 'a1']])
    expect(calls[0]?.consent).toEqual(expect.stringContaining('"■ Confirm" in the pitwall panel to stop agent a1'))
    expect([await ui.find({ key: 'stop-a1' }), (await ui.find({ key: 'dismiss-a1' }))?.text, await ui.find({ type: 'Text', text: '✗ killed' })].map(Boolean)).toEqual([
      false,
      true,
      true,
    ])
  })

  test(`${surface}: an armed stop goes back to rest after four seconds without stopping anything`, async ($, on) => {
    const { clock } = stoppable(on)
    let stops = 0
    on('tool.call', () => (stops++, { result: {} as never }))
    await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })
    const ui = await mountPane(surface, $)
    await ui.press({ key: 'stop-a1' })
    await clock.advance(3900)
    expect((await ui.find({ key: 'stop-a1' }))?.text).toBe('■ Confirm')
    await clock.advance(100)
    expect([(await ui.find({ key: 'stop-a1' }))?.text, stops]).toEqual(['■ Stop', 0])
  })

  test(`${surface}: a stop Claude Code refuses or cannot make says why`, async ($, on) => {
    stoppable(on)
    const toasts: string[] = []
    on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
    let answers = 0
    on('tool.call', () => (answers++ === 0 ? { deny: 'The user declined to stop the agent' } : { isError: true as const, result: undefined, text: 'No task found with ID: a1' }))
    await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })
    const ui = await mountPane(surface, $)
    for (let i = 0; i < 4; i++) await ui.press({ key: 'stop-a1' })
    expect([toasts, (await ui.find({ key: 'stop-a1' }))?.text]).toEqual([['The user declined to stop the agent', 'No task found with ID: a1'], '■ Stop'])
  })

  test(`${surface}: a stop where no tool can stop agents says Claude Code cannot`, async ($, on) => {
    stoppable(on)
    const toasts: string[] = []
    on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
    await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })
    const ui = await mountPane(surface, $)
    await ui.press({ key: 'stop-a1' })
    await ui.press({ key: 'stop-a1' })
    expect(toasts).toEqual(['Claude Code cannot stop agents here'])
  })

  test(`${surface}: dismissing a finished agent slides its card out, rolls its rows shut, and a later poll leaves it out`, async ($, on) => {
    const { clock, agent, lists } = stoppable(on)
    await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })
    agent.status = 'completed'
    await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
    const ui = await mountPane(surface, $)
    expect([(await ui.find({ key: 'dismiss-a1' }))?.text, await ui.find({ key: 'stop-a1' })]).toEqual(['✕ dismiss', undefined])
    const slot = async () => {
      const box = await ui.find({ key: 'slot-a1' })
      const inner = box?.children[0] as { props?: { marginLeft?: number } } | undefined
      return box && ([inner?.props?.marginLeft ?? 0, box.props.height as number | undefined] as const)
    }
    expect(await slot()).toEqual([0, undefined])

    await ui.press({ key: 'dismiss-a1' })
    const seen = [await slot()]
    for (let beat = 0; beat < 20; beat++) seen.push(await clock.advance(ROW_MS).then(slot))
    const drawn = seen.filter(x => x !== undefined)
    const [margins, heights] = [drawn.map(([margin]) => margin), drawn.map(([, height]) => height ?? 0)]
    const out = PANE.bodyColumns - 2
    expect([
      margins.some(margin => margin > 0 && margin < out),
      margins.every((margin, i) => i === 0 || margin >= margins[i - 1]!),
      heights.slice(0, margins.indexOf(out)).every(height => height === heights[0]),
      heights.every((height, i) => i === 0 || height <= heights[i - 1]!),
      heights.some(height => height > 0 && height < heights[0]!),
      seen.at(-1),
    ]).toEqual([true, true, true, true, true, undefined])
    expect([await ui.find({ key: 'view-a1' }), await ui.find({ type: 'Text', text: 'No agents in this session yet.' })].map(Boolean)).toEqual([false, true])
    const polled = lists()
    await clock.advance(5000)
    expect([lists() > polled, await ui.find({ key: 'view-a1' }), await ui.find({ type: 'Text', text: 'No agents in this session yet.' })].map(Boolean)).toEqual([true, false, true])
  })

  test(`${surface}: a finished agent resumed after it left the panel comes back, sliding in, working again`, async ($, on) => {
    const { clock, agent } = stoppable(on)
    await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })
    agent.status = 'completed'
    await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
    const ui = await mountPane(surface, $)
    await ui.press({ key: 'dismiss-a1' })
    await clock.advance(ROW_MS * 20)
    expect(await ui.find({ key: 'view-a1' })).toBeUndefined()
    await clock.advance(5000)
    expect(await ui.find({ key: 'view-a1' })).toBeUndefined()

    agent.status = 'running'
    await $.turn.start({ text: 'one more', turnId: 't2', agentId: 'a1' })
    const height = async () => (await ui.find({ key: 'slot-a1' }))?.props.height
    const opening = [await height()]
    for (let beat = 0; beat < 20; beat++) opening.push(await clock.advance(ROW_MS).then(height))
    const rolled = opening.filter((rows): rows is number => typeof rows === 'number')
    expect([rolled[0], rolled.every((rows, i) => i === 0 || rows >= rolled[i - 1]!), opening.at(-1)]).toEqual([0, true, undefined])
    expect([(await ui.find({ key: 'stop-a1' }))?.text, await ui.find({ key: 'dismiss-a1' })]).toEqual(['■ Stop', undefined])
  })

  test(`${surface}: an agent's cache countdown runs from when its request was sent, not from when its answer ended`, async ($, on) => {
    engine(on)
    const clock = mock.clock(on)
    mockSession(on, { agents: () => [{ id: 'a1', description: 'a1', type: 'Explore', status: 'running' as AgentStatus }] })
    on('process.run', () => NO_GIT)
    on('fs.exists', () => ({ value: false }))
    on('fs.list', () => ({ value: [] }))
    on('turn.step', async function* ($, e) {
      await clock.sleep(30_000)
      const usage = { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500 }
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
    })
    await $.session.start({ cwd: '/home/me/repo', surface, isInteractive: true })
    await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })
    const stepping = (async () => {
      for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1, agentId: 'a1' })) {
      }
    })()
    await clock.advance(30_000)
    await stepping
    const ui = await mountPane(surface, $)
    expect((await ui.findAll({ type: 'Text' })).find(text => /^ +\d+m\d+s$/.test(text.text ?? ''))?.text).toBe('  4m30s')
  })

  test(`${surface}: a finished agent's cache row dims and reads "if resumed" while it stays warm`, async ($, on) => {
    const { agent } = stoppable(on)
    on('turn.step', async function* ($, e) {
      const usage = { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500 }
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
    })
    await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1, agentId: 'a1' })) {
    }
    const ui = await mountPane(surface, $)
    const P = paletteOf('classic', false)
    const row = async () => {
      const time = (await ui.findAll({ type: 'Text' })).find(text => /^ +(\d+m\d+s|cold)$/.test(text.text ?? ''))
      return [time?.text, time?.props.color, Boolean(await ui.find({ type: 'Text', text: ' if resumed' }))]
    }
    expect(await row()).toEqual(['  5m00s', P.ok, false])
    agent.status = 'completed'
    await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
    expect(await row()).toEqual(['  5m00s', P.muted, true])
  })

  test(`${surface}: a confirmed stop runs a red fuse round its card, which a refusal drains back`, async ($, on) => {
    const { clock, agent } = stoppable(on)
    const P = paletteOf('classic', false)
    let answer: { deny?: string } = {}
    on('tool.call', async () => {
      await clock.sleep(240)
      if (answer.deny === undefined) agent.status = 'killed'
      return answer.deny === undefined ? { result: {} as never } : { deny: answer.deny }
    })
    await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })
    const ui = await mountPane(surface, $)
    const lit = async () => {
      const sides = await Promise.all(['top', 'right', 'left', 'bottom'].map(side => ui.find({ key: `fuse-${side}-a1` })))
      return sides.reduce((sum, box) => sum + [...(box?.text ?? '')].filter(cell => cell !== '\n').length, 0)
    }
    const look = async () => [(await ui.find({ key: 'agent-a1' }))?.props.borderColor, (await ui.find({ key: 'stop-a1' }))?.text ?? null] as const
    const burn = async (beats: number) => {
      const seen: number[] = []
      for (let beat = 0; beat < beats; beat++) seen.push(await clock.advance(ROW_MS).then(lit))
      return seen
    }

    answer = { deny: 'The user declined to stop the agent' }
    await ui.press({ key: 'stop-a1' })
    const refused = ui.press({ key: 'stop-a1' })
    await clock.settle()
    expect([await lit(), ...(await look()), Boolean(await ui.find({ type: 'Text', text: 'stopping…' }))]).toEqual([0, P.accent, null, true])
    const lighting = await burn(9)
    expect(lighting.every((cells, i) => cells > (lighting[i - 1] ?? 0))).toBe(true)
    const draining = await burn(20)
    expect([draining.every((cells, i) => cells <= (draining[i - 1] ?? lighting.at(-1)!)), draining.at(-1), ...(await look())]).toEqual([true, 0, P.accent, '■ Stop'])

    answer = {}
    await ui.press({ key: 'stop-a1' })
    const stopped = ui.press({ key: 'stop-a1' })
    await clock.settle()
    const burnt = await burn(25)
    const peak = Math.max(...burnt)
    const card = (await ui.find({ key: 'agent-a1' }))!
    expect([burnt.indexOf(peak) > 15, burnt.at(-1), card.props.borderColor, Boolean(await ui.find({ type: 'Text', text: '✗ killed' }))]).toEqual([true, 0, P.bad, true])
    await Promise.all([refused, stopped])
  })

  test(`${surface}: an agent's card counts down its prompt cache, its lifetime from the agent's request records`, async ($, on) => {
    engine(on)
    const clock = mock.clock(on)
    const ids = ['a1', 'a2', 'a3']
    mockSession(on, { agents: () => ids.map(id => ({ id, description: id, type: 'Explore', status: 'running' as AgentStatus })) })
    on('process.run', () => NO_GIT)
    on('fs.exists', () => ({ value: false }))
    on('fs.list', () => ({ value: [] }))
    const input = (id: string | undefined) => 10 * (ids.indexOf(id ?? '') + 1)
    on('turn.step', async function* ($, e) {
      const usage = { model: 'claude-opus-5-5', input_tokens: input(e.agentId), output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500 }
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
    })
    await $.session.start({ cwd: '/home/me/repo', surface, isInteractive: true })
    const step = async (agentId: string) => {
      await $.turn.start({ text: 'go', turnId: agentId, agentId })
      for await (const _ of $.turn.step({ turnId: agentId, index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1, agentId })) {
      }
    }
    const record = (agentId: string, split: Record<string, number>) =>
      $.telemetry.log(
        apiRequest({ query_source: 'agent:builtin:Explore', cost_usd: 0.01, input_tokens: input(agentId), output_tokens: 100, cache_read_tokens: 1000, cache_creation_tokens: 500, ...split }),
      )
    await step('a1')
    await record('a1', { cache_creation_5m_tokens: 0, cache_creation_1h_tokens: 500 })
    await record('a2', { cache_creation_5m_tokens: 0, cache_creation_1h_tokens: 500 })
    await step('a2')
    await step('a3')
    await record('a3', { cache_creation_5m_tokens: 500, cache_creation_1h_tokens: 0 })
    const ui = await mountPane(surface, $)
    const caches = async () =>
      (await ui.findAll({ type: 'Text' }))
        .filter(text => text.props.color !== undefined)
        .map(text => text.text ?? '')
        .filter(text => /^ +(\d+h\d+m|\d+m\d+s|\d+s|cold)$/.test(text))
    const bars = async () => Promise.all(['a1', 'a2', 'a3'].map(async id => Boolean(await ui.find({ key: `cache-left-${id}` }))))
    expect([await caches(), await bars()]).toEqual([['  1h00m', '  1h00m', '  5m00s'], [true, true, true]])

    await clock.advance(301_000)
    expect(await caches()).toEqual([' 54m59s', ' 54m59s', '   cold'])
  })

  test(`${surface}: the session card counts what auto mode's classifier allowed and blocked`, async ($, on) => {
    engine(on)
    mock.clock(on)
    const decision = (attributes: Record<string, string>) =>
      $.telemetry.log({ to: 'collector', event: 'tool_decision', attributes: { tool_name: 'Bash', ...attributes }, loggedAt: '2026-10-15T00:00:00.000Z' })
    const before = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    expect(await before.find({ type: 'Text', text: 'auto mode' })).toBeUndefined()
    await before.unmount()

    await decision({ decision: 'accept', source: 'config', classifier_verdict: 'allow', permission_mode: 'auto' })
    await decision({ decision: 'accept', source: 'config', classifier_verdict: 'allow', permission_mode: 'auto' })
    await decision({ decision: 'reject', source: 'config', classifier_verdict: 'block', permission_mode: 'auto' })
    await decision({ decision: 'reject', source: 'config', classifier_verdict: 'unavailable', permission_mode: 'auto' })
    await decision({ decision: 'accept', source: 'user_temporary', permission_mode: 'default' })
    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    expect(await ui.find({ type: 'Text', text: 'auto mode' })).toBeDefined()
    const counts = await Promise.all(['allowed', 'blocked'].map(async key => (await ui.find({ type: 'Text', in: `n-session-${key}` }))?.text))
    expect(counts).toEqual(['2', '1'])
  })

  if (surface === 'terminal') test(`${surface}: a pasted screenshot gets a button that opens it until its placeholder goes`, async ($, on) => {
    engine(on)
    const clock = mock.clock(on)
    mock.env(on, { HOME: '/home/me', OS: 'Windows_NT', TEMP: 'C:\\Temp' })
    on('session.id', () => ({ value: 'abc' }))
    let draft = 'look '
    let reads = 0
    on('prompt.read', () => (reads++, { value: { text: draft, cursor: draft.length } }))
    on('prompt.edit', () => ({ text: draft, cursor: draft.length }))
    on('prompt.change', ($, e) => ({ text: e.text }))
    const ran: string[][] = []
    on('process.run', ($, e) => (ran.push([...e.argv]), {
      value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))
    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })
    const settle = async (want: boolean) => {
      let isShown = Boolean(await ui.find({ key: 'open-image-1' }))
      for (let i = 0; i < 50 && isShown !== want; i++) isShown = Boolean(await ui.find({ key: 'open-image-1' }))
      return isShown
    }
    const edit = (e: PromptEditInput) => ($.prompt as unknown as { edit: (e: PromptEditInput) => Promise<unknown> }).edit(e)

    draft = 'look [Image #1] '
    await edit({ origin: { kind: 'composer' }, text: 'look ', cursor: 5, start: 5, end: 5, inputText: '[Image #1] ' })
    expect(await settle(true)).toBe(true)
    expect((await ui.find({ key: 'open-image-1' }))?.text).toBe('#1 open ↗')
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect(ran.filter(argv => argv[0] === 'powershell').length).toBe(1)
    await ui.press({ key: 'open-image-1' })
    expect(ran.at(-1)).toEqual(['rundll32', 'url.dll,FileProtocolHandler', 'C:\\Temp\\pitwall-abc-1.png'])

    draft = 'look '
    await edit({ origin: { kind: 'composer' }, text: 'look [Image #1] ', cursor: 16, start: 5, end: 16, inputText: '' })
    expect(await settle(false)).toBe(false)

    const change = (e: PromptChangeInput) => ($.prompt as unknown as { change: (e: PromptChangeInput) => Promise<unknown> }).change(e)
    await change({ origin: { kind: 'history' }, text: 'again [Image #1] ', cursor: 17 })
    expect(await settle(true)).toBe(true)
    await change({ origin: { kind: 'clear' }, text: '', cursor: 0 })
    expect(await settle(false)).toBe(false)
    await clock.advance(3000)
    expect([reads, ran.filter(argv => argv[0] === 'powershell').length]).toEqual([0, 1])
  })

  if (surface === 'terminal') test(`${surface}: a screenshot's button goes with a broken placeholder, a capture that lands late shows none, and a recall reads no clipboard`, async ($, on) => {
    engine(on)
    mock.clock(on)
    mock.env(on, { HOME: '/home/me', OS: 'Windows_NT', TEMP: 'C:\\Temp' })
    on('session.id', () => ({ value: 'abc' }))
    let draft = ''
    on('prompt.edit', () => ({ text: draft, cursor: draft.length }))
    on('prompt.change', ($, e) => ({ text: e.text }))
    let captures = 0
    let land = () => {}
    on('process.run', async ($, e) => {
      if (e.argv[0] === 'powershell') {
        captures++
        if (captures === 2) await new Promise<void>(resolve => (land = resolve))
      }
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })
    const settle = async (key: string, want: boolean) => {
      let isShown = Boolean(await ui.find({ key }))
      for (let i = 0; i < 50 && isShown !== want; i++) isShown = Boolean(await ui.find({ key }))
      return isShown
    }
    const edit = (e: PromptEditInput) => ($.prompt as unknown as { edit: (e: PromptEditInput) => Promise<unknown> }).edit(e)
    const change = (e: PromptChangeInput) => ($.prompt as unknown as { change: (e: PromptChangeInput) => Promise<unknown> }).change(e)

    draft = '[Image #1] '
    await edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: draft })
    expect(await settle('open-image-1', true)).toBe(true)
    draft = '[Image #1 '
    await edit({ origin: { kind: 'composer' }, text: '[Image #1] ', cursor: 10, start: 9, end: 10, inputText: '' })
    expect(await settle('open-image-1', false)).toBe(false)

    draft = '[Image #2] '
    await edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: draft })
    await change({ origin: { kind: 'clear' }, text: '', cursor: 0 })
    land()
    expect(await settle('open-image-2', true)).toBe(false)

    await change({ origin: { kind: 'history' }, text: 'old [Image #3] ', cursor: 15 })
    expect(await settle('open-image-3', true)).toBe(false)
    expect(captures).toBe(2)
  })

  test(`${surface}: the box's sidebar control opens and closes the panel, its chevron turning`, async ($, on) => {
    const opened: (true | undefined)[] = []
    const atClose: unknown[] = []
    engine(on, { opened, onClose: async () => void atClose.push(await offset()) })
    const clock = mock.clock(on)
    mock.env(on, { HOME: '/home/me' })
    on('session.root', () => ({ value: '/home/me/repo' }))
    on('session.id', () => ({ value: 's1' }))

    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })
    const pane = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    const offset = async () => (await pane.find({ key: 'slide' }))?.props.marginLeft
    const curtain = async () => (await pane.find({ key: 'curtain' }))?.props.left
    const edged = async () => [await offset(), await curtain()]
    const chevron = async () => (await ui.find({ type: 'Text', in: 'chevron-panel' }))?.text
    expect((await ui.find({ key: 'panel' }))?.text).toBe('SIDEBAR')
    expect(await chevron()).toBe(' ›')

    await ui.press({ key: 'panel' })
    expect(opened).toEqual([true])
    const turn: string[] = []
    for (const ms of [120, 30, 90, 90, 150]) turn.push(await ui.advance(ms).then(chevron).then(text => text ?? ''))
    expect(turn).toEqual([' ›', ' >', ' |', ' <', ' ‹'])
    const slid: unknown[] = [await offset()]
    const sweep: unknown[][] = [await edged()]
    for (let beat = 0; beat < 10; beat++) {
      await clock.advance(ROW_MS)
      slid.push(await offset())
      sweep.push(await edged())
    }
    expect(slid).toEqual([40, 29, 20, 14, 9, 5, 3, 1, 0, 0, 0])
    expect(sweep).toEqual(slid.map(at => [at, typeof at === 'number' && at > 0 && at < 40 ? at : undefined]))
    await ui.press({ key: 'panel' })
    await clock.advance(144)
    expect((await pane.find({ key: 'curtain' }))?.text?.split('\n')).toEqual(Array.from({ length: PANE.scroll.bodyRows }, () => '│'))
    await ui.press({ key: 'panel' })
    await clock.advance(240)

    await ui.press({ key: 'panel' })
    await ui.advance(500)
    expect(await chevron()).toBe(' ›')
    const out: unknown[][] = []
    for (let beat = 0; beat < 9; beat++) out.push(await clock.advance(ROW_MS).then(edged))
    expect([out, atClose]).toEqual([[...sweep].reverse().slice(1, -1), []])
    await clock.advance(ROW_MS)
    expect(atClose).toEqual([slid[0]])

    await ui.press({ key: 'chevron-panel' })
    expect(opened).toEqual([true, true])
    await clock.advance(240)
    await ui.press({ key: 'panel' })
    await clock.advance(144)
    const turned: unknown[] = [await offset()]
    await ui.press({ key: 'panel' })
    for (let beat = 0; beat < 6; beat++) turned.push(await clock.advance(ROW_MS).then(offset))
    expect([opened, turned, atClose, await curtain()]).toEqual([[true, true], [9, 5, 3, 1, 0, 0, 0], [40], undefined])
  })

  test(`${surface}: a pick on a row too full for its confirm slides the row left to make room`, async ($, on) => {
    engine(on)
    const clock = mock.clock(on)
    mock.env(on, { HOME: '/home/me' })
    const options = ['default', 'opus', 'sonnet', 'haiku', 'fable']
    const model = { key: 'model', label: 'Model', kind: 'choice' as const, value: 'Default', isLocked: false, options, provider: { plugin: 'engine', tier: 'core' as const } }
    on('config.list', () => ({ value: [model] }))
    const sets: unknown[] = []
    on('config.set', ($, e) => (sets.push(e.value), { value: e.value }))
    on('session.model', () => ({ value: 'claude-sonnet-6' }))
    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })
    const lines = async () => ((await frameOf(ui)) as { children: unknown[] }).children.filter(Boolean)
    const widths = async () => new Set((await lines()).map(cells))
    const width = await widths()
    await ui.press({ key: 'model' })
    await clock.advance(1000)
    await ui.advance(1000)
    const row = async () => (await lines()).find(line => cellsTo(line, 'pick-model-opus') >= 0)
    const unmoved = cellsTo(await row(), 'pick-model-opus')

    await ui.press({ key: 'pick-model-sonnet' })
    expect(await ui.find({ key: 'confirm' })).toBeUndefined()
    await clock.advance(ROW_MS)
    expect(cellsTo(await row(), 'pick-model-opus')).toBe(unmoved - 1)
    await clock.advance(976)
    const moved = await row()
    expect(cellsTo(moved, 'confirm')).toBe(cellsTo(moved, 'pick-model-fable') + ' Fable '.length + 2)
    expect(await widths()).toEqual(width)
    await ui.press({ key: 'confirm' })
    expect([sets, cellsTo(await row(), 'pick-model-opus')]).toEqual([['sonnet'], cellsTo(moved, 'pick-model-opus')])
    await clock.advance(1000)
    expect(await row()).toBeUndefined()

    await ui.press({ key: 'model' })
    await clock.advance(1000)
    expect([cellsTo(await row(), 'pick-model-opus'), await ui.find({ key: 'confirm' })]).toEqual([unmoved, undefined])
  })

  test(`${surface}: a session started before its conversation arrives seeds it once it does`, async ($, on) => {
    let isLoaded = false
    engine(on, { turns: () => (isLoaded ? 2 : 0) })
    const clock = mock.clock(on)
    mockSession(on, { model: () => 'claude-opus-5-5' })
    on('process.run', () => NO_GIT)
    const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 }
    const transcript = [
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      JSON.stringify({ type: 'assistant', effort: 'high', message: { id: 'm1', model: 'claude-opus-5-5', usage } }),
      JSON.stringify({ type: 'user', message: { content: 'and again' } }),
    ].join('\n')
    const isTranscript = (path: string) => isLoaded && path.replace(/\\/g, '/').endsWith('/home/me/.claude/projects/-home-me-repo/abc.jsonl')
    on('fs.exists', ($, e) => ({ value: isTranscript(e.path) }))
    on('fs.list', () => ({ value: [] }))
    on('fs.stat', ($, e) => ({ value: { kind: 'file', size: isTranscript(e.path) ? transcript.length : 0, mtimeMs: 0, isLink: false } }))
    on('fs.read', ($, e) => ({ value: isTranscript(e.path) ? transcript : '' }))
    await $.session.start({ cwd: '/home/me/repo', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })
    const figure = async (key: string) => (await ui.find({ type: 'Text', in: `n-${key}` }))?.text
    expect([await figure('out'), await ui.find({ key: 'effort', in: 'chip-effort' }).catch(() => undefined)]).toEqual(['0', undefined])

    isLoaded = true
    await clock.advance(1000)
    await ui.advance(3000)
    expect([await figure('out'), await figure('cacheRead'), (await ui.find({ key: 'effort', in: 'chip-effort' }))?.text]).toEqual(['20', '300', 'high effort'])
  })

  test(`${surface}: a session the process goes on under, resumed or cleared, is seeded again`, async ($, on) => {
    engine(on, { turns: () => 2 })
    const clock = mock.clock(on)
    let id = 'abc'
    mockSession(on, { model: () => 'claude-opus-5-5', id: () => id })
    on('process.run', () => NO_GIT)
    const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 }
    const transcript = [
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      JSON.stringify({ type: 'assistant', effort: 'high', message: { id: 'm1', model: 'claude-opus-5-5', usage } }),
    ].join('\n')
    const isTranscript = (path: string) => path.replace(/\\/g, '/').endsWith(`/home/me/.claude/projects/-home-me-repo/${id}.jsonl`)
    let reads = 0
    on('fs.exists', ($, e) => ({ value: isTranscript(e.path) }))
    on('fs.list', () => ({ value: [] }))
    on('fs.stat', ($, e) => ({ value: { kind: 'file', size: isTranscript(e.path) ? transcript.length : 0, mtimeMs: 0, isLink: false } }))
    on('fs.read', ($, e) => (isTranscript(e.path) && reads++, { value: isTranscript(e.path) ? transcript : '' }))
    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })
    const figure = async (key: string) => (await ui.find({ type: 'Text', in: `n-${key}` }))?.text
    const shown = async () => [
      (await ui.find({ key: 'model', in: 'chip-model' }))?.text,
      (await ui.find({ key: 'effort', in: 'chip-effort' }).catch(() => undefined))?.text,
      await figure('out'),
    ]
    expect(await shown()).toEqual(['unknown', undefined, '0'])

    await $.classic.SessionStart({ source: 'resume', session_id: id })
    await clock.advance(0)
    await ui.advance(3000)
    expect([await shown(), reads]).toEqual([['Opus 5.5', 'high effort', '20'], 1])
    await $.classic.SessionStart({ source: 'resume', session_id: id })
    await $.classic.SessionStart({ source: 'compact', session_id: id })
    await clock.advance(0)
    expect(reads).toBe(1)
    id = 'def'
    await $.classic.SessionStart({ source: 'clear', session_id: id })
    await clock.advance(0)
    expect(reads).toBe(2)
  })

  test(`${surface}: while Claude works the model's and the effort's chips glisten in their picker colours`, async ($, on) => {
    engine(on)
    mock.clock(on)
    mockSession(on, { settings: () => ({ modelSettings: { 'claude-sonnet-6': { effortLevel: 'xhigh' } } }) })
    on('process.run', () => NO_GIT)
    on('fs.exists', () => ({ value: false }))
    on('fs.list', () => ({ value: [] }))
    await $.session.start({ cwd: '/home/me/repo', surface, isInteractive: true })
    const colours = async (isWorking: boolean, chip = 'chip-model') => {
      const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: { ...BAND, isWorking } })
      const [seen, turned] = [new Set<unknown>(), new Set<unknown>()]
      let isBold = false
      for (let t = 0; t < 1200; t += 60) {
        await ui.advance(60)
        for (const text of await ui.findAll({ type: 'Text', in: chip })) {
          if (text.props.color) seen.add(text.props.color)
          if (text.props.color && text.text?.trim() === '▾') turned.add(text.props.color)
          isBold ||= text.props.bold === true
        }
      }
      await ui.unmount()
      return { all: [...seen], chevron: turned.size, isBold }
    }
    expect(await colours(false)).toEqual({ all: ['#5f9cf5'], chevron: 1, isBold: false })
    const working = await colours(true)
    expect([working.all.length, working.all.includes('#5f9cf5'), working.chevron, working.isBold]).toEqual([5, true, 5, false])
    expect(await colours(false, 'chip-effort')).toEqual({ all: ['yellow'], chevron: 1, isBold: false })
    const effort = await colours(true, 'chip-effort')
    expect([effort.all.length, effort.all.includes('yellow'), effort.all.includes('#f2f288'), effort.chevron, effort.isBold]).toEqual([5, true, true, 5, false])
  })

  test(`${surface}: a model switch shows the effort Claude Code keeps for that model, and /effort moves the chip at once`, async ($, on) => {
    engine(on)
    mock.clock(on)
    let model = 'claude-opus-5-5'
    let settings: Record<string, unknown> = { effortLevel: 'high', modelSettings: { 'claude-sonnet-6': { effortLevel: 'low' } } }
    mockSession(on, { model: () => model, settings: () => settings })
    on('process.run', () => NO_GIT)
    on('fs.exists', () => ({ value: false }))
    on('fs.list', () => ({ value: [] }))
    on('command.run', () => ({ text: '' }))
    await $.session.start({ cwd: '/home/me/repo', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })
    const chip = async () => (await ui.find({ key: 'effort', in: 'chip-effort' }))?.text
    expect(await chip()).toBe('high effort')

    model = 'claude-sonnet-6'
    const switched = { from_model: 'claude-opus-5-5', to_model: model, requested_model: 'sonnet', source: 'command' as const }
    await $.classic.PostModelSwitch({ ...switched, context_tokens: 1000, prompt_cache_warm: false, cache_ttl: '5m', estimated_cache_write_usd: 0, pricing: 'catalog' })
    expect(await chip()).toBe('low effort')

    const typed = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 140 } }
    await $.command.run({ command: 'effort', args: 'max', ...typed })
    expect(await chip()).toBe('max effort')
    settings = { modelSettings: { 'claude-sonnet-6': { effortLevel: 'medium' } } }
    await $.command.run({ command: 'effort', args: '', ...typed })
    expect(await chip()).toBe('medium effort')
  })

  test(`${surface}: the cache card says nothing is cached until the first request writes it`, async ($, on) => {
    engine(on)
    mock.clock(on)
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1000, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }))
    const pane = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    const has = async (text: string) => (await pane.find({ type: 'Text', text })) !== undefined
    expect([await has('Nothing cached in this session yet.'), await has('● warm')]).toEqual([true, false])
    await $.telemetry.log(apiRequest({ query_source: 'repl_main_thread', cost_usd: 0.01, model: 'claude-opus-5-5' }))
    await pane.advance(1000)
    expect([await has('Nothing cached in this session yet.'), await has('● warm')]).toEqual([false, true])
  })

  test(`${surface}: a new session shows the last reading of the rate windows before its first request`, async ($, on) => {
    const kept = engine(on)
    const at = Date.parse('2026-10-14T12:00:00Z')
    mock.clock(on, { now: at })
    mockSession(on)
    on('process.run', () => NO_GIT)
    on('fs.exists', () => ({ value: false }))
    on('fs.list', () => ({ value: [] }))
    const resets = (s: number) => new Date(at + s * 1000).toISOString()
    kept.set('rate', [
      { kind: 'five_hour', percentUsed: 42, resetsAt: resets(-60) },
      { kind: 'seven_day', percentUsed: 20, resetsAt: resets(6 * 86_400) },
    ])
    await $.session.start({ cwd: '/home/me/repo', surface, isInteractive: true })
    const pane = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    const shown = async () => Promise.all(['five_hour', 'seven_day'].map(async kind => (await pane.find({ type: 'Text', in: `n-usage-${kind}` }))?.text))
    expect([await shown(), await pane.find({ type: 'Text', text: 'resets in 6d' }) !== undefined]).toEqual([['0%', '20%'], true])

    const live = [{ kind: 'five_hour' as const, percentUsed: 7, resetsAt: resets(3 * 3600) }]
    await $.session.measure({ context: { tokens: 1, window: 200_000, percent: 1 }, rateLimits: live, changed: ['rateLimits'] })
    expect(kept.get('rate')).toEqual(live)
  })

  test(`${surface}: a skin's theme repaints the box and the panel, its light theme in its light palette`, async ($, on) => {
    engine(on)
    const clock = mock.clock(on)
    mockSession(on, { settings: () => ({ effortLevel: 'xhigh' }) })
    on('process.run', () => NO_GIT)
    on('fs.exists', () => ({ value: false }))
    on('fs.list', () => ({ value: [] }))
    const engineRow = { label: 'Theme', kind: 'choice' as const, isLocked: false, provider: { plugin: 'engine', tier: 'core' as const } }
    on('config.list', () => ({ value: [{ key: 'theme', value: 'custom:pitwall:tokyo-night-dark', ...engineRow }] }))
    on('config.set', ($, e) => ({ value: e.value }))
    await $.session.start({ cwd: '/home/me/repo', surface, isInteractive: true })
    const band = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })
    const pane = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    const inkIn = async (key: string) => (await band.findAll({ type: 'Text', in: key })).find(text => text.props.color)?.props.color
    const card = async (color: string) => (await pane.findAll({ type: 'Box' })).some(box => box.props.borderColor === color)
    const shown = async (accent: string) => [
      await inkIn('chip-model'),
      await inkIn('chip-effort'),
      (await band.find({ type: 'Text', text: /^✓$/, in: 'claude' }))?.props.color,
      await card(accent),
    ]

    expect(await shown('#7aa2f7')).toEqual(['#7aa2f7', '#e0af68', '#9ece6a', true])
    const person = { origin: { kind: 'composer' as const } }
    const pick = (value: string, previous: string) => $.config.set({ key: 'theme', value, previous, provider: engineRow.provider, ...person })
    await pick('custom:pitwall:tokyo-night-light', 'custom:pitwall:tokyo-night-dark')
    await clock.advance(0)
    expect(await shown('#2e7de9')).toEqual(['#2e7de9', '#8c6c3e', '#587539', true])
    await pick('dark', 'custom:pitwall:tokyo-night-light')
    await clock.advance(0)
    expect(await shown('claude')).toEqual(['#5f9cf5', 'yellow', 'green', true])
  })

  const themed = async ($: Engine, on: On, theme: string, os?: string) => {
    engine(on)
    const clock = mock.clock(on)
    mockSession(on, { os })
    on('fs.exists', () => ({ value: false }))
    on('fs.list', () => ({ value: [] }))
    const writes: [string | undefined, string | undefined][] = []
    on('process.run', ($, e) => {
      const isWrite = e.init?.env?.PITWALL_OSC !== undefined
      if (isWrite) writes.push([e.init?.env?.PITWALL_OSC, e.init?.env?.PITWALL_TTY])
      const device = e.argv[0] === 'powershell' ? 'CONOUT$\r\n' : '/dev/ttys009'
      return { value: { exitCode: isWrite ? 0 : 1, stdout: isWrite ? device : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const rows = new Map<string, ConfigValue>([['theme', theme]])
    const engineRow = { label: 'Theme', kind: 'choice' as const, isLocked: false, provider: { plugin: 'engine', tier: 'core' as const } }
    on('config.list', () => ({ value: [...rows].map(([key, value]) => ({ key, value, ...engineRow })) }))
    on('config.set', ($, e) => (rows.set(e.key, e.value), { value: e.value }))
    on('session.end', ($, e) => ({ sessionId: e.sessionId }))
    await $.session.start({ cwd: '/home/me/repo', surface, isInteractive: true })
    const band = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })
    await clock.advance(0)
    const change = async (key: string, value: ConfigValue, previous: ConfigValue) => {
      const provider = key.startsWith('pitwall.') ? { plugin: 'pitwall', tier: 'user' as const } : engineRow.provider
      await $.config.set({ key, value, previous, provider, origin: { kind: 'composer' as const } })
      await clock.advance(1000)
    }
    return { clock, band, writes, change }
  }

  test(`${surface}: a skin's own theme picked in /theme repaints the box in that skin`, async ($, on) => {
    const { band, change } = await themed($, on, 'dark')
    const sonnet = async () => (await band.findAll({ type: 'Text', in: 'chip-model' })).find(text => text.props.color)?.props.color
    await change('theme', 'custom:pitwall:nord-light', 'dark')
    const nord = await sonnet()
    await change('theme', 'dark', 'custom:pitwall:nord-light')
    expect([nord, await sonnet()]).toEqual(['#5e81ac', '#5f9cf5'])
  })

  test(`${surface}: a skin paints the terminal's background and text, and leaving puts the terminal's own back`, async ($, on) => {
    const { clock, writes, change } = await themed($, on, 'custom:pitwall:tokyo-night-dark')
    await clock.advance(1000)
    await change('theme', 'custom:pitwall:tokyo-night-light', 'custom:pitwall:tokyo-night-dark')
    await change('pitwall.terminalBackground', false, true)
    await change('pitwall.terminalBackground', true, false)
    await $.session.end({ reason: 'clear', sessionId: 'abc', resume: { id: 'abc' } })
    const cleared = writes.length
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'abc', resume: { id: 'abc' } })
    const tty = '/dev/ttys009'
    const [night, day] = ['10;#c0caf5|11;#1a1b26', '10;#3760bf|11;#e1e2e7']
    expect([cleared, writes]).toEqual(
      surface === 'terminal' ? [4, [[night, ''], [day, tty], ['110|111', tty], [day, tty], ['110|111', tty]]] : [0, []],
    )
  })

  test(`${surface}: a background write waits out the redraw, and only the last colour asked for is written`, async ($, on) => {
    const { clock, writes } = await themed($, on, 'custom:pitwall:tokyo-night-dark')
    await clock.advance(1000)
    const engineRow = { plugin: 'engine', tier: 'core' as const }
    const pick = (value: string, previous: string) => $.config.set({ key: 'theme', value, previous, provider: engineRow, origin: { kind: 'composer' as const } })
    await pick('custom:pitwall:nord-dark', 'custom:pitwall:tokyo-night-dark')
    await clock.advance(30)
    await pick('custom:pitwall:dracula-dark', 'custom:pitwall:nord-dark')
    await clock.advance(30)
    const waiting = writes.length
    await clock.advance(1000)
    expect([waiting, writes.map(([osc]) => osc)]).toEqual(surface === 'terminal' ? [1, ['10;#c0caf5|11;#1a1b26', '10;#f8f8f2|11;#282a36']] : [0, []])
  })

  test(`${surface}: on Windows a skin paints the background through Claude Code's console`, async ($, on) => {
    const { clock, writes } = await themed($, on, 'custom:pitwall:tokyo-night-dark', 'Windows_NT')
    await clock.advance(1000)
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'abc', resume: { id: 'abc' } })
    expect(writes).toEqual(surface === 'terminal' ? [['10;#c0caf5|11;#1a1b26', ''], ['110|111', 'CONOUT$']] : [])
  })

  test(`${surface}: classic leaves the terminal's background alone`, async ($, on) => {
    const { clock, writes } = await themed($, on, 'dark')
    await clock.advance(1000)
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'abc', resume: { id: 'abc' } })
    expect(writes).toEqual([])
  })

  const skinned = async ($: Engine, on: On, theme = 'custom:pitwall:tokyo-night-dark') => {
    engine(on)
    on('config.list', () => ({ value: [{ key: 'theme', value: theme, label: 'Theme', kind: 'choice' as const, isLocked: false, provider: { plugin: 'engine', tier: 'core' as const } }] }))
    const clock = mock.clock(on)
    mockSession(on)
    on('process.run', () => NO_GIT)
    on('fs.exists', () => ({ value: false }))
    on('fs.list', () => ({ value: [] }))
    on('tool.call', async ($, e) => (e.tool === 'Bash' && (await clock.advance(1200)), { result: { stdout: '', stderr: '', interrupted: false } as never }))
    on('ui.render', () => ({ type: 'engine' as const, ref: 0 }))
    await $.session.start({ cwd: '/home/me/repo', surface, isInteractive: true })
    return clock
  }
  const row = (tool: string, input: unknown, id = 'toolu_1') => ({
    tool_use_id: id,
    tool,
    input,
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
  })

  test(`${surface}: a skinned chat draws a tool call's row in its kind's colour, with its edit and its time`, async ($, on) => {
    await skinned($, on)
    const mount = (props: ReturnType<typeof row>) => $.ui.mount({ plugin: 'pitwall', surface, component: 'ToolUse', requestId: props.tool_use_id, props })
    const textIn = async (ui: Awaited<ReturnType<typeof mount>>) => (await ui.findAll({ type: 'Text' })).filter(t => t.props.color).map(t => `${t.text}:${t.props.color}`)
    const edit = await mount(row('Edit', { file_path: '/home/me/repo/src/a.ts', old_string: 'a\nb', new_string: 'a\nb\nc' }))
    await $.tool.call({ tool: 'Bash', command: 'npm test\nmore', tool_use_id: 'toolu_bash' } as never)
    const bash = await mount(row('Bash', { command: 'npm test\nmore' }, 'toolu_bash'))
    const old = await mount(row('Read', { file_path: '/home/me/notes.md' }, 'toolu_old'))
    if (surface === 'desktop') {
      expect([await edit.find({ key: 'tool-row' }), await bash.find({ key: 'tool-row' })]).toEqual([undefined, undefined])
      return
    }
    expect(await textIn(edit)).toEqual(['●:#9ece6a', 'Edit:#9ece6a', 'src/a.ts:#c0caf5', '+3:#9ece6a', '-2:#f7768e'])
    expect(await textIn(bash)).toEqual(['●:#7aa2f7', 'Bash:#7aa2f7', 'npm test:#c0caf5', '1.2s:#565f89'])
    expect(await textIn(old)).toEqual(['●:#7dcfff', 'Read:#7dcfff', '~/notes.md:#c0caf5'])
    const running = await mount({ ...row('Grep', { pattern: 'TODO', path: '/home/me/repo/src' }, 'toolu_run'), isRunning: true })
    const failed = await mount({ ...row('WebFetch', { url: 'https://example.com' }, 'toolu_bad'), isErrored: true })
    expect([await textIn(running), (await textIn(failed))[0]]).toEqual([['○:#7dcfff', 'Grep:#7dcfff', 'TODO in src:#c0caf5', 'running…:#565f89'], '✗:#f7768e'])
  })

  test(`${surface}: classic, or the toggle off, leaves the chat to Claude Code`, async ($, on) => {
    await skinned($, on, 'dark')
    const tool = await $.ui.mount({ plugin: 'pitwall', surface, component: 'ToolUse', requestId: 'toolu_1', props: row('Read', { file_path: '/x' }) })
    expect(await tool.find({ key: 'tool-row' })).toBeUndefined()
  })

  test(`${surface}: a skin with its chat toggle off leaves the chat to Claude Code`, { options: { chatSkin: false } }, async ($, on) => {
    await skinned($, on)
    const tool = await $.ui.mount({ plugin: 'pitwall', surface, component: 'ToolUse', requestId: 'toolu_1', props: row('Read', { file_path: '/x' }) })
    const prompt = await $.ui.mount({ plugin: 'pitwall', surface, component: 'UserMessage', requestId: 'm1', props: { text: 'hi', origin: { kind: 'composer' }, isExpanded: true } })
    expect([await tool.find({ key: 'tool-row' }), await prompt.find({ key: 'prompt-row' })]).toEqual([undefined, undefined])
  })

  test(`${surface}: a skinned chat outlines the person's prompt and draws a reply's tables as cards`, async ($, on) => {
    await skinned($, on)
    const prompt = await $.ui.mount({ plugin: 'pitwall', surface, component: 'UserMessage', requestId: 'm1', props: { text: 'fix the bar', origin: { kind: 'composer' }, isExpanded: true } })
    const notice = await $.ui.mount({
      plugin: 'pitwall',
      surface,
      component: 'UserMessage',
      requestId: 'm2',
      props: { text: 'task done', origin: { kind: 'task-notification' }, isExpanded: true },
    })
    const text = ['Two runs:', '', '| run | ms |', '|-----|---:|', '| **a** | 12 |', '| b | 340 |', '', 'And the raw form:', '```', '| x | y |', '|---|---|', '```'].join('\n')
    const reply = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AssistantMessage', requestId: 'r1', props: { text, isFirstOfReply: true } })
    if (surface === 'desktop') {
      expect([await prompt.find({ key: 'prompt-row' }), await reply.find({ key: 'reply' })]).toEqual([undefined, undefined])
      return
    }
    const outline = await prompt.find({ key: 'prompt-row' })
    expect([outline?.props.borderStyle, outline?.text, await notice.find({ key: 'prompt-row' })]).toEqual(['round', '❯ fix the bar', undefined])
    const markdown = (await reply.findAll({ type: 'Markdown' })).map(m => m.props.text)
    expect([(await reply.find({ type: 'Text', text: /^●$/ }))?.props.color, markdown]).toEqual(['#7aa2f7', ['Two runs:', 'And the raw form:\n```\n| x | y |\n|---|---|\n```']])
    const card = await reply.find({ key: 'table-1' })
    const bands = [await reply.find({ key: 'table-1-row-0' }), await reply.find({ key: 'table-1-row-1' })].map(r => r?.props.backgroundColor)
    const head = (await reply.findAll({ type: 'Text', text: /^(run|ms)$/ })).map(t => t.props.color)
    expect([card?.props.borderStyle, bands, head, (await reply.find({ type: 'Text', text: /^a$/ }))?.text]).toEqual(['round', [undefined, '#3b4261'], ['#7aa2f7', '#7aa2f7'], 'a'])
  })

  test(`${surface}: the advisor's card takes a call as soon as the response that made it is whole`, async ($, on) => {
    engine(on)
    const clock = mock.clock(on)
    mockSession(on, { model: () => 'claude-opus-5-5' })
    on('process.run', () => NO_GIT)
    let isAdvised = false
    const advice = { type: 'advisor_message', model: 'claude-fable-5-1', input_tokens: 1000, output_tokens: 100 }
    const transcript = () =>
      [
        JSON.stringify({ type: 'user', message: { content: 'hi' } }),
        ...(isAdvised ? [JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 20, iterations: [{ type: 'message' }, advice] } } })] : []),
      ].join('\n')
    const isTranscript = (path: string) => path.replace(/\\/g, '/').endsWith('/home/me/.claude/projects/-home-me-repo/abc.jsonl')
    on('fs.exists', ($, e) => ({ value: isTranscript(e.path) }))
    on('fs.list', () => ({ value: [] }))
    on('fs.stat', ($, e) => ({ value: { kind: 'file', size: isTranscript(e.path) ? transcript().length : 0, mtimeMs: 0, isLink: false } }))
    on('fs.read', ($, e) => ({ value: isTranscript(e.path) ? transcript() : '' }))
    on('turn.step', async function* ($, e) {
      const serverToolUses = [{ id: 'adv1', name: 'advisor', input: {}, startedAt: 0, endedAt: 1 }]
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], serverToolUses, stopReason: 'end_turn' as const, usage: null }
    })
    await $.session.start({ cwd: '/home/me/repo', surface, isInteractive: true })
    const pane = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    const card = async () => (await pane.find({ type: 'Text', text: '✶ Fable 5.1' })) !== undefined
    expect(await card()).toBe(false)

    isAdvised = true
    await $.turn.start({ text: 'hi', turnId: 't1' })
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })) {
    }
    await clock.advance(0)
    expect(await card()).toBe(true)
  })

  test(`${surface}: an agent's advice is read from its own transcript, onto its card, the advisor's card and the cost split`, async ($, on) => {
    engine(on)
    const clock = mock.clock(on)
    mockSession(on, { model: () => 'claude-opus-5-5', agents: () => [{ id: 'a1', description: 'a1', type: 'Explore', status: 'running' as AgentStatus }] })
    on('process.run', () => NO_GIT)
    const main = '/home/me/.claude/projects/-home-me-repo/abc.jsonl'
    const own = '/home/me/.claude/projects/-home-me-repo/abc/subagents/agent-a1.jsonl'
    const advice = { type: 'advisor_message', model: 'claude-fable-5-1', input_tokens: 1000, output_tokens: 100 }
    const row = (id: string) => JSON.stringify({ type: 'assistant', isSidechain: true, message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 2, output_tokens: 3, iterations: [{ type: 'message' }, advice] } } })
    let isAdvised = false
    const is = (path: string, tail: string) => path.replace(/\\/g, '/').endsWith(tail)
    const files = (path: string) => (is(path, own) ? (isAdvised ? [row('m1'), row('m1'), row('m2')].join('\n') : '') : JSON.stringify({ type: 'user', message: { content: 'hi' } }))
    const reads: string[] = []
    on('fs.exists', ($, e) => ({ value: [main, own].some(tail => is(e.path, tail)) }))
    on('fs.list', () => ({ value: [] }))
    on('fs.stat', ($, e) => ({ value: { kind: 'file', size: files(e.path).length, mtimeMs: 0, isLink: false } }))
    on('fs.read', ($, e) => (reads.push(e.path), { value: files(e.path) }))
    on('turn.step', async function* ($, e) {
      const serverToolUses = [{ id: 'adv1', name: 'advisor', input: {}, startedAt: 0, endedAt: 1 }]
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], serverToolUses, stopReason: 'end_turn' as const, usage: null }
    })
    await $.session.start({ cwd: '/home/me/repo', surface, isInteractive: true })
    reads.length = 0
    isAdvised = true
    await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1, agentId: 'a1' })) {
    }
    await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
    await clock.settle()
    expect([reads.length > 0, reads.every(path => is(path, own))]).toEqual([true, true])

    await $.telemetry.log(apiRequest({ query_source: 'agent:builtin:Explore', cost_usd: 1, input_tokens: 2, output_tokens: 3, cache_read_tokens: 0, cache_creation_tokens: 0 }))
    const pane = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    const figure = async (key: string) => `${key} ${(await pane.find({ type: 'Text', in: `n-${key}` }))?.text}`
    const want = {
      'a1-advisor-calls': '2',
      'a1-advisor-usd': '$0.0300',
      'advisor-calls': '2',
      'advisor-usd': '$0.0300',
      'advisor-agents-calls': '2',
      'cost-advisor': '$0.0300',
      'cost-agents': '$0.9700',
    }
    expect(await Promise.all(Object.keys(want).map(figure))).toEqual(Object.entries(want).map(([key, text]) => `${key} ${text}`))
    expect(await pane.find({ type: 'Text', text: '✶ Fable 5.1' })).toBeDefined()
  })

  test(`${surface}: a narrow panel keeps every row of every card on one line inside it`, async ($, on) => {
    engine(on)
    const at = Date.parse('2026-10-14T12:00:00Z')
    const clock = mock.clock(on, { now: at })
    let status: AgentStatus = 'running'
    const resets = (s: number) => new Date(at + s * 1000).toISOString()
    const rateLimits = [
      { kind: 'five_hour' as const, percentUsed: 42, resetsAt: resets(3 * 3600 + 1240) },
      { kind: 'seven_day' as const, percentUsed: 18, resetsAt: resets(5 * 86_400 + 7200) },
    ]
    mockSession(on, {
      model: () => 'claude-opus-5-5',
      agents: () => [{ id: 'a1', description: 'Find every caller of the frobnicator', type: 'general-purpose', status }],
      usage: () => ({ startedAt: at - 3_600_000, context: { tokens: 84_000, window: 200_000, percent: 42 }, rateLimits, cost: { usd: 12.3456 } }),
    })
    on('process.run', () => NO_GIT)
    const main = '/home/me/.claude/projects/-home-me-repo/abc.jsonl'
    const advice = { type: 'advisor_message', model: 'claude-fable-5-1', input_tokens: 100_000, output_tokens: 10_000 }
    const transcript = [
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 2, output_tokens: 3, iterations: [{ type: 'message' }, advice] } } }),
    ].join('\n')
    const isMain = (path: string) => path.replace(/\\/g, '/').endsWith(main)
    on('fs.exists', ($, e) => ({ value: isMain(e.path) }))
    on('fs.list', () => ({ value: [] }))
    on('fs.stat', ($, e) => ({ value: { kind: 'file', size: isMain(e.path) ? transcript.length : 0, mtimeMs: 0, isLink: false } }))
    on('fs.read', ($, e) => ({ value: isMain(e.path) ? transcript : '' }))
    const usage = { model: 'claude-opus-5-5', input_tokens: 1200, output_tokens: 3400, cache_read_input_tokens: 81_000, cache_creation_input_tokens: 2000 }
    on('turn.step', async function* ($, e) {
      const serverToolUses = [{ id: 'adv1', name: 'advisor', input: {}, startedAt: 0, endedAt: 1 }]
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], serverToolUses, stopReason: 'end_turn' as const, usage }
    })
    await $.session.start({ cwd: '/home/me/repo', surface, isInteractive: true })
    await $.session.measure({ context: { tokens: 84_000, window: 200_000, percent: 42 }, rateLimits, changed: ['rateLimits'] })
    for (const agentId of ['a1', undefined]) {
      await $.turn.start({ text: 'go', turnId: `t-${agentId}`, ...(agentId && { agentId }) })
      for await (const _ of $.turn.step({ turnId: `t-${agentId}`, index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1, ...(agentId && { agentId }) })) {
      }
    }
    const tokens = { input_tokens: 1200, output_tokens: 3400, cache_read_tokens: 81_000, cache_creation_tokens: 2000, duration_ms: 3000 }
    await $.telemetry.log(apiRequest({ query_source: 'agent:builtin:general-purpose', cost_usd: 1.234, ...tokens }))
    await $.telemetry.log(apiRequest({ query_source: 'repl_main_thread', cost_usd: 9.87, model: 'claude-opus-5-5', cache_creation_5m_tokens: 2000, ...tokens }))
    await $.telemetry.log(apiRequest({ query_source: 'compact', cost_usd: 0.4567 }))
    for (const verdict of ['allow', 'block']) await $.telemetry.log({ to: 'collector', event: 'tool_decision', attributes: { classifier_verdict: verdict }, loggedAt: '2026-10-14T00:00:00.000Z' })
    status = 'completed'
    await clock.advance(6000)

    type Node = { type?: string; props?: { width?: number; paddingX?: number; borderStyle?: string; marginLeft?: number; flexDirection?: string; wrap?: string }; children?: unknown[] }
    const need = (node: unknown): number => {
      if (typeof node === 'string') return cellsOf(node)
      const el = node as Node
      if (el.type === 'Client') return el.props?.width ?? 0
      if (el.type === 'Text' && el.props?.wrap === 'truncate-end') return 1
      const kids = (el.children ?? []).map(need)
      const own = el.props?.flexDirection === 'column' ? Math.max(0, ...kids) : kids.reduce((sum, cells) => sum + cells, 0)
      return Math.max(own, el.props?.width ?? 0) + (el.props?.paddingX ?? 0) * 2 + (el.props?.borderStyle ? 2 : 0) + (el.props?.marginLeft ?? 0)
    }
    const isStacked = (node: unknown): boolean => typeof node !== 'string' && ((node as Node).props?.flexDirection === 'column' || ((node as Node).type !== 'Client' && ((node as Node).children ?? []).some(isStacked)))
    const over = (node: unknown, room: number): string[] => {
      const el = node as Node
      if (typeof node === 'string' || el.type === 'Client' || el.type === 'Text') return []
      const width = el.props?.width ?? room
      const inside = width - (el.props?.paddingX ?? 0) * 2 - (el.props?.borderStyle ? 2 : 0)
      if (el.type === 'Box' && el.props?.flexDirection !== 'column' && !(el.children ?? []).some(isStacked)) return need(el) > width ? [`${textOf(el)}: ${need(el)} > ${width}`] : []
      return (el.children ?? []).flatMap(child => over(child, inside))
    }
    const textOf = (node: unknown): string => (typeof node === 'string' ? node : ((node as Node).children ?? []).map(textOf).join(''))
    const seen: unknown[] = []
    for (const bodyColumns of [40, 28, 22, 18]) {
      const pane = await $.ui.mount({ plugin: 'pitwall', surface, component: 'Pane', requestId: 'sidebar', props: { ...PANE, bodyColumns, scroll: { offset: 0, bodyRows: 80 } } })
      const bar = (await pane.find({ key: 'cache-left-a1' }))?.props.width
      seen.push([bodyColumns, over(await pane.drawn(), bodyColumns), (await pane.find({ type: 'Text', text: ' if resumed' })) !== undefined, bar === undefined || (bar as number) > 0])
      await pane.unmount()
    }
    expect(seen).toEqual([
      [40, [], true, true],
      [28, [], false, true],
      [22, [], false, true],
      [18, [], false, true],
    ])
  })

  test(`${surface}: a narrow box keeps every line inside the column, and the wire only reaches a pick on the first row of choices`, async ($, on) => {
    const opened: (true | undefined)[] = []
    engine(on, { opened })
    const clock = mock.clock(on)
    const repo = '/home/me/Desktop/repos/personal/pitwall'
    mock.env(on, { HOME: '/home/me' })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('session.version', () => ({ value: { version: '2.1.300', base: '2.1.300' } }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 84_000, window: 200_000, percent: 42 }, rateLimits: [], cost: { usd: 0 } } }))
    on('session.cwd', () => ({ value: repo }))
    on('session.root', () => ({ value: repo }))
    on('session.repo', () => ({ value: { root: repo, remote: 'git@github.com:me/pitwall.git', internal: false, name: null } }))
    on('session.id', () => ({ value: 'abc' }))
    on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
    on('agent.list', () => ({ value: [] }))
    on('fs.exists', () => ({ value: false }))
    on('fs.list', () => ({ value: [] }))
    const model = { key: 'model', label: 'Model', kind: 'choice' as const, value: 'opus', isLocked: false, options: ['default', 'sonnet', 'opus', 'haiku', 'fable'], provider: { plugin: 'engine', tier: 'core' as const } }
    on('config.list', () => ({ value: [model] }))
    on('process.run', ($, e) => ({
      value: {
        exitCode: 0,
        stdout: e.argv.includes('status') ? '# branch.oid abc1234def\n# branch.head dev-claude-plugin\n# branch.ab +2 -1\n? new.txt\n' : ' 3 files changed, 125 insertions(+), 41 deletions(-)\n',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }))
    on('turn.step', async function* ($, e) {
      const usage = { model: e.model, input_tokens: 12_345, output_tokens: 3_456, cache_read_input_tokens: 812_000, cache_creation_input_tokens: 23_400 }
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
    })
    const step = async (model: string) => {
      for await (const _ of $.turn.step({ turnId: 't1', index: 0, model, effort: 'xhigh', messageCount: 1 })) {
      }
    }
    await $.session.start({ cwd: repo, surface, isInteractive: true })
    await $.session.measure({ context: { tokens: 84_000, window: 200_000, percent: 42 }, rateLimits: [], changed: ['context'] })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await step('claude-opus-5-5')
    await clock.advance(1000)

    const shown: unknown[] = []
    for (const bodyColumns of [140, 93, 63, 52, 44]) {
      const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: { ...BAND, isWorking: true, bodyColumns } })
      const lines = ((await frameOf(ui)) as { children: unknown[] }).children.filter(Boolean)
      const has = async (key: string) => (await ui.find({ key })) !== undefined
      const full = [(await ui.find({ key: 'bar' }))?.props.width, await has('panel'), await has('n-in-delta')]
      shown.push([bodyColumns, Math.max(...lines.map(cells)) + 2 <= bodyColumns, await has('chip-model'), await has('chip-effort'), await has('n-pct'), ...(bodyColumns === 140 ? full : [])])
      await ui.unmount()
    }
    expect(shown).toEqual([140, 93, 63, 52, 44].map(bodyColumns => [bodyColumns, true, true, true, true, ...(bodyColumns === 140 ? [30, true, true] : [])]))

    const bare = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns: 52 } })
    expect(await bare.find({ key: 'panel' })).toBeUndefined()
    await bare.press({ key: 'chevron-panel' })
    expect(opened).toEqual([true])
    await bare.unmount()

    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: { ...BAND, isWorking: true, bodyColumns: 44 } })
    await ui.press({ key: 'model' })
    await clock.advance(1000)
    await ui.advance(1000)
    const linesOf = async () => ((await frameOf(ui)) as { children: unknown[] }).children.filter(Boolean)
    const middleOf = async (alias: string): Promise<[number, number]> => {
      const lines = await linesOf()
      const at = lines.findIndex(line => cellsTo(line, `pick-model-${alias}`) >= 0)
      const text = (await ui.find({ type: 'Text', in: `pick-model-${alias}` }))?.text ?? ''
      return [at, cellsTo(lines[at], `pick-model-${alias}`) + Math.floor([...text].length / 2)]
    }
    const arrow = async () => {
      const line = (await linesOf()).find(line => cellsTo(line, 'wire-arrow') >= 0)
      return line === undefined ? -1 : cellsTo(line, 'wire-arrow') + [...((await ui.find({ type: 'Text', in: 'wire-arrow' }))?.text ?? '')].indexOf('▾')
    }
    const [opusRow, opusAt] = await middleOf('opus')
    const [fableRow] = await middleOf('fable')
    expect([Math.max(...(await linesOf()).map(cells)) + 2 <= 44, fableRow > opusRow, await arrow()]).toEqual([true, true, opusAt])

    await step('claude-fable-5-1')
    await ui.advance(1000)
    expect([(await middleOf('fable'))[0] > (await middleOf('opus'))[0], await ui.find({ key: 'wire' }), await arrow()]).toEqual([true, undefined, -1])
  })

  test(`${surface}: the panel opens by itself in fullscreen only`, async ($, on) => {
    const opened: (true | undefined)[] = []
    engine(on, { opened })
    const main = { columns: 160, rows: 40, isFullscreen: false }
    await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND, viewport: main })
    expect(opened).toEqual([])
    await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND, viewport: { ...main, isFullscreen: true } })
    expect(opened).toEqual([undefined])
  })

  test(`${surface}: a panel the person closed stays shut when fullscreen comes`, async ($, on) => {
    const opened: (true | undefined)[] = []
    engine(on, { opened })
    const clock = mock.clock(on)
    mock.env(on, { HOME: '/home/me' })
    on('session.root', () => ({ value: '/home/me/repo' }))
    on('session.id', () => ({ value: 's1' }))
    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })
    for (let press = 0; press < 2; press++) {
      await ui.press({ key: 'panel' })
      await clock.advance(1000)
    }
    await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND, viewport: { columns: 160, rows: 40, isFullscreen: true } })
    expect(opened).toEqual([true])
  })

  test(`${surface}: past 85% the band offers to compact`, async ($, on) => {
    engine(on)

    await $.session.measure({
      context: { tokens: 180_000, window: 200_000, percent: 90 },
      rateLimits: [],
      changed: ['context'],
    })

    const ui = await $.ui.mount({ plugin: 'pitwall', surface, component: 'AbovePrompt', props: BAND })

    expect(await ui.find({ key: 'compact' })).toBeDefined()
  })
}

const alerts = (on: On) => {
  const ran: Record<string, string>[] = []
  on('process.run', ($, e) => (
    ran.push(e.init?.env ?? {}),
    { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  ))
  return ran
}

const nudge = ($: { telemetry: { log: (e: ReturnType<typeof apiRequest>) => Promise<unknown> } }) =>
  $.telemetry.log(apiRequest({ query_source: 'sdk' }))

test('alerts: a permission request, a finished turn and compaction each raise one; a paused turn none', async ($, on) => {
  engine(on)
  mock.env(on, { HOME: '/home/me', OS: 'Windows_NT' })
  const ran = alerts(on)
  const settle = async (n: number) => {
    for (let i = 0; i < 50 && ran.length < n; i++) await nudge($)
  }
  const running = [{ id: 't1', type: 'local_agent', status: 'running', description: 'explore' }]

  await $.classic.PermissionRequest({ tool_name: 'Edit', tool_input: { file_path: '/repo/src/a.ts' }, cwd: '/repo' })
  await settle(1)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: running })
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  await settle(2)
  await $.classic.PreCompact({ trigger: 'auto', custom_instructions: null })
  await settle(3)

  expect(ran.map(env => env.PITWALL_SOUND)).toEqual(['Windows Exclamation.wav', 'chimes.wav', 'Windows Battery Low.wav'])
})

test('alerts: the context alert re-arms below its threshold, the rate alert when its window resets', async ($, on) => {
  engine(on)
  mock.env(on, { HOME: '/home/me', OS: 'Windows_NT' })
  const ran = alerts(on)
  const heard: number[] = []
  const readings = [
    { context: 75, rate: 10, resetsAt: 'A' },
    { context: 76, rate: 10, resetsAt: 'A' },
    { context: 60, rate: 85, resetsAt: 'A' },
    { context: 71, rate: 90, resetsAt: 'A' },
    { context: 71, rate: 85, resetsAt: 'B' },
  ]
  for (const { context, rate, resetsAt } of readings) {
    await $.session.measure({
      context: { tokens: context, window: 100, percent: context },
      rateLimits: [{ kind: 'five_hour', percentUsed: rate, resetsAt }],
      changed: ['context', 'rateLimits'],
    })
    for (let i = 0; i < 20; i++) await nudge($)
    heard.push(ran.length)
  }
  expect(heard).toEqual([1, 1, 2, 3, 4])
  expect(new Set(ran.map(env => env.PITWALL_SOUND))).toEqual(new Set(['Windows Battery Critical.wav']))
})

test('alerts: each rate window sounds once until its own reset, whichever of them is higher', async ($, on) => {
  engine(on)
  mock.env(on, { HOME: '/home/me', OS: 'Windows_NT' })
  const ran = alerts(on)
  const heard: number[] = []
  const readings = [
    { five: 85, fiveResets: 'A', seven: 82, sevenResets: 'B' },
    { five: 82, fiveResets: 'A', seven: 85, sevenResets: 'B' },
    { five: 85, fiveResets: 'A', seven: 82, sevenResets: 'B' },
    { five: 85, fiveResets: 'A', seven: 82, sevenResets: 'C' },
    { five: 85, fiveResets: 'D', seven: 82, sevenResets: 'C' },
  ]
  for (const { five, fiveResets, seven, sevenResets } of readings) {
    await $.session.measure({
      context: { tokens: 10, window: 100, percent: 10 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: five, resetsAt: fiveResets },
        { kind: 'seven_day', percentUsed: seven, resetsAt: sevenResets },
      ],
      changed: ['context', 'rateLimits'],
    })
    for (let i = 0; i < 20; i++) await nudge($)
    heard.push(ran.length)
  }
  expect(heard).toEqual([1, 1, 1, 2, 3])
  expect(new Set(ran.map(env => env.PITWALL_SOUND))).toEqual(new Set(['Windows Battery Critical.wav']))
})

test('alerts: with sounds off nothing starts', { options: { sounds: false } }, async ($, on) => {
  engine(on)
  mock.env(on, { HOME: '/home/me', OS: 'Windows_NT' })
  const ran = alerts(on)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  for (let i = 0; i < 20; i++) await nudge($)
  expect(ran).toEqual([])
})
