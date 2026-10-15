import type { AgentStatus, ConfigValue, On, PromptEditInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { shortPath } from '../hooks/history'
import { SKINS, themeOf } from '../hooks/skin'

// The engine's own answers, which the kit leaves to the test.
// `opened` collects each pane open's `focus`; the store it keeps is returned.
const engine = (on: On, opened?: (true | undefined)[], turns = () => 3, onClose?: () => Promise<void>) => {
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
  // The engine's record of the open panes.
  const panes = new Set<string>()
  on('ui.open', ($, e) => (opened?.push(e.focus), panes.add(e.id), { value: { isPlaced: true as const } }))
  on('ui.close', async ($, e) => (await onClose?.(), panes.delete(e.id), { value: undefined }))
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  for (const event of ['PermissionRequest', 'Stop', 'PreCompact', 'PostCompact', 'PostModelSwitch', 'SessionStart'] as const) on(`classic.${event}`, () => ({}))
  return kept
}

// One row of Claude's response being appended, its first block of `kind`.
const responseRow = (kind: string, agentId?: string) => ({
  message: { type: 'assistant' as const, role: 'assistant' as const, content: [{ type: kind }] },
  door: 'response' as const,
  origin: { kind: 'model' as const, model: 'claude-opus-5-5' },
  uuid: `row-${kind}-${agentId ?? 'main'}`,
  ...(agentId && { agentId }),
})

// One API request's record, as the engine raises it on the collector stream.
const apiRequest = (attributes: Record<string, string | number>) =>
  ({ to: 'collector', event: 'api_request', attributes, loggedAt: '2026-10-14T00:00:00.000Z' }) as const

// The band's frame: the Box on the docked panel's background.
type Drawn = { props?: { backgroundColor?: string }; children?: unknown[] }
const backdrop = (node: Drawn | undefined): Drawn | undefined =>
  node?.props?.backgroundColor === 'composerSidebarBackground' ? node : (node?.children ?? []).map(child => backdrop(child as Drawn)).find(Boolean)
const frameOf = async (ui: { drawn: () => Promise<unknown> }) => backdrop((await ui.drawn()) as Drawn)
// A drawn line's cells, a Client counted at its width.
const cells = (node: unknown): number => {
  if (typeof node === 'string') return [...node].length
  const el = node as { type?: string; props?: { width?: number }; children?: unknown[] }
  if (el.type === 'Client') return el.props?.width ?? 0
  return (el.children ?? []).reduce((n: number, child) => n + cells(child), 0)
}
// The cells of a drawn line before the element keyed `key`; -1 where it has none.
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

// Every colour a skin paints in, its light palette's too, is a hex a sweep or
// a ramp can blend, but classic's names, which follow the terminal's theme.
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

// Each skin makes Claude Code's own themes of its palettes, over the base of
// the same lightness and in hex throughout; classic, whose colours are the
// theme's, makes none. themes/ ships what this makes (CLAUDE.md says how).
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

// A row's path is named from the working directory, else from home, and a
// folder whose name only starts with one is neither.
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
    // Two main-loop requests: 1.5K in and 1.2K, the second with a cache write.
    const usage = [
      { model: 'claude-opus-5-5', input_tokens: 1500, output_tokens: 150, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      { model: 'claude-opus-5-5', input_tokens: 1200, output_tokens: 250, cache_read_input_tokens: 0, cache_creation_input_tokens: 1200 },
    ]
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: usage[e.index] ?? null }
    })
    const step = async (index: number) => {
      for await (const _ of $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', effort: 'xhigh', messageCount: 1 })) {
        // only the result counts
      }
    }
    await $.session.measure({ ...measured, changed: ['context', 'rateLimits', 'cost'] })
    // The wait ends at the turn's first main-loop row that shows: not its
    // thinking, not a subagent's row, and a later row does not move it.
    await $.turn.start({ text: 'hi', turnId: 't1' })
    await clock.advance(3000)
    await $.session.append(responseRow('text', 'a1'))
    await $.session.append(responseRow('thinking'))
    await clock.advance(4300)
    await $.session.append(responseRow('text'))
    await step(0)
    const band = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })
    // The first request's tokens show before the turn is over.
    expect((await band.find({ type: 'Text', in: 'n-in' }))?.text).toBe('1.5K')
    await band.unmount()
    await clock.advance(2000)
    await $.session.append(responseRow('tool_use'))
    await step(1)
    // The turn's sum comes again at its end, and is not counted twice.
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

    // A prompt counts as a message; a slash command does not.
    const typed = { wait: false, origin: { kind: 'composer' } } as const
    await $.prompt.submit({ ...typed, text: 'hi' })
    await $.prompt.submit({ ...typed, text: '/effort max', command: { name: 'effort', args: 'max' } })

    const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })
    // A figure is drawn by its own count.tsx, found by its key.
    const figure = async (key: string) => (await ui.find({ type: 'Text', in: `n-${key}` }))?.text

    expect(await ui.find({ type: 'Text', text: '/200K' })).toBeDefined()
    // The frame sits on the docked panel's own background.
    expect(await frameOf(ui)).toBeDefined()
    const want = { pct: '42%', used: '84.0K', in: '2.7K', 'in-delta': '(+2.7K)' }
    for (const [key, text] of Object.entries(want)) expect(`${key} ${await figure(key)}`).toBe(`${key} ${text}`)
    expect(await ui.find({ key: 'compact' })).toBeUndefined()

    // The session's figures, its cost and the rate windows are the panel's,
    // no longer the box's.
    for (const key of ['n-messages', 'n-first', 'n-reply', 'n-cost']) expect(await ui.find({ key })).toBeUndefined()
    const pane = await $.ui.mount({ plugin: 'statusbox', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    for (const text of ['5-hour', ' message', 'first output ', 'reply ']) {
      expect((await pane.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)
    }
    const card = { 'usage-five_hour': '23%', 'session-messages': '1', 'session-first': '7.3s', 'session-reply': '15s', 'cost-total': '$0.1234' }
    for (const [key, text] of Object.entries(card)) {
      expect(`${key} ${(await pane.find({ type: 'Text', in: `n-${key}` }))?.text}`).toBe(`${key} ${text}`)
    }
  })

  // A transcript up to fs.read's 4 MiB is read whole; past it, it streams.
  // Each also finds the transcript a way of its own: in the folder named for
  // the directory, under CLAUDE_CONFIG_DIR (its .claude.json too), or in a
  // folder of another name that holds the session's file.
  const reads = [
    [1024, 'Linux', '/home/me/.claude', '-home-me-repo'],
    [5 * 1024 * 1024, 'Linux', '/cfg', '-home-me-repo'],
    [5 * 1024 * 1024, 'Windows_NT', '/home/me/.claude', 'resumed-elsewhere'],
  ] as const
  for (const [size, os, dir, folder] of reads) test(`${surface}: session start draws the repo row, git counts and version (${os}, ${dir}/projects/${folder}, transcript of ${size} bytes)`, async ($, on) => {
    const kept = engine(on)
    // The person folded the agents in an earlier session.
    kept.set('folded', ['AGENTS'])
    const at = Date.parse('2026-10-14T12:00:00Z')
    const clock = mock.clock(on, { now: at })
    const set: Record<string, string> = dir === '/cfg' ? { CLAUDE_CONFIG_DIR: dir } : {}
    mock.env(on, os === 'Windows_NT' ? { HOME: '/home/me', OS: os, ...set } : { HOME: '/home/me', ...set })
    // The engine hands a hook an fs path resolved for the platform.
    const ends = (path: string, tail: string) => path.replace(/\\/g, '/').endsWith(tail)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    // Two hours left of five, so a steady pace stands at 60 %; six days left of seven, at 14 %.
    const resets = (s: number) => new Date(at + s * 1000).toISOString()
    const rateLimits = [
      { kind: 'five_hour', percentUsed: 42, resetsAt: resets(7200) },
      { kind: 'seven_day', percentUsed: 20, resetsAt: resets(518_400) },
    ]
    on('session.usage', () => ({ value: { startedAt: at, context: { tokens: 100_000, window: 200_000, percent: 50 }, rateLimits, cost: { usd: 0.3 } } }))
    on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
    on('session.version', () => ({ value: { version: '2.1.299', base: '2.1.299' } }))
    on('session.cwd', () => ({ value: '/home/me/repo' }))
    on('session.root', () => ({ value: '/home/me/repo' }))
    on('session.id', () => ({ value: 'abc' }))
    on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
    // Claude Code's Model row in /config, and what the plugin sets through it.
    const model = { key: 'model', label: 'Model', kind: 'choice' as const, value: 'Default (recommended)', isLocked: false }
    const rows = [{ ...model, options: ['default', 'sonnet', 'opus', 'haiku', 'fable', 'best', 'sonnet[1m]', 'opus[1m]', 'fable[1m]', 'opusplan'], provider: { plugin: 'engine', tier: 'core' as const } }]
    const sets: [string, unknown][] = []
    on('config.list', () => ({ value: rows }))
    on('config.set', ($, e) => (sets.push([e.key, e.value]), { value: e.value }))
    on('agent.list', () => ({ value: [] }))
    // One message written as two lines (thinking, then text) that consulted the
    // advisor once, one subagent row, and a torn last line.
    const advice = { type: 'advisor_message', model: 'claude-fable-5-1', input_tokens: 1000, output_tokens: 100 }
    // Its write went to a 5-minute entry, ten minutes ago.
    const cache_creation = { ephemeral_5m_input_tokens: 50, ephemeral_1h_input_tokens: 0 }
    const usage = { input_tokens: 100, output_tokens: 7, cache_creation, iterations: [{ type: 'message' }, advice] }
    const timestamp = new Date(at - 600_000).toISOString()
    const row = (id: string, extra = {}) => JSON.stringify({ type: 'assistant', timestamp, ...extra, message: { id, model: 'claude-opus-5-5', usage } })
    // Past fs.read's 4 MiB the transcript streams through `cat`, or `findstr` on
    // Windows, its pieces cut mid-line; the engine resolves an fs path for the
    // platform before a hook sees it, but not a child's argv.
    on('fs.read', ($, e) => ({
      value: ends(e.path, `${dir === '/cfg' ? '/cfg' : '/home/me'}/.claude.json`)
        ? config
        : isTranscript(e.path) && size <= 4 * 1024 * 1024
          ? transcript
          : (Object.entries(catalogs).find(([name]) => ends(e.path, `${catalogDir}/${name}`))?.[1] ?? ''),
    }))
    // Claude Code's model catalogs, two accounts': the newer names a Sonnet the
    // plugin has never seen and a Fable this Claude Code (2.1.299) is too old for.
    const catalogDir = `${dir === '/cfg' ? '/cfg' : '/home/me/.claude'}/cache/model-catalog`
    const main = (name: string, extra = {}) => ({ id: name, name, short_name: name.split(' ')[0], section: 'main', ...extra })
    const catalogOf = (fetchedAt: number, models: unknown[]) => JSON.stringify({ version: 2, fetchedAt, catalog: { config: { models } } })
    const catalogs: Record<string, string> = {
      'org-a-cc.json': catalogOf(1, [main('Sonnet 9')]),
      'org-b-cc.json': catalogOf(2, [main('Opus 5.5'), main('Sonnet 6'), main('Fable 6', { min_claude_code_version: '2.1.400' }), { ...main('Haiku 4.5'), section: 'overflow' }]),
    }
    // A later call on a model newer than the mod's table, priced as Claude Code
    // fetched it into ~/.claude.json, beside an entry that fails the check.
    const fable6 = { inputTokens: 10, outputTokens: 50, promptCacheWriteTokens: 12.5, promptCacheReadTokens: 1, webSearchRequests: 0.01 }
    const config = JSON.stringify({ additionalModelCostsCache: { 'claude-fable-6': fable6, 'claude-bad-1': { inputTokens: -1 } } })
    const later = JSON.stringify({
      type: 'assistant',
      message: { id: 'm3', usage: { input_tokens: 0, output_tokens: 0, iterations: [{ ...advice, model: 'claude-fable-6' }] } },
    })
    // One prompt the person typed among the user rows that are not one.
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
    // The engine's bottom of a model request: records the effort it was sent.
    const sentEffort: unknown[] = []
    on('turn.step', async function* ($, e) {
      sentEffort.push(e.effort)
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
    })
    const step = async (effort: 'high' | 'xhigh') => {
      for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort, messageCount: 1 })) {
        // a request's pieces; only what it was sent matters here
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
    // The transcript's last write lapsed five minutes ago: the next message
    // writes the 100K context again, $5 a million against reading it at $0.20.
    const cache = async (ui: { find: (q: { type: 'Text'; in: string }) => Promise<{ text?: string } | undefined> }) =>
      Object.fromEntries(await Promise.all(['next', 'tokens', 'other'].map(async key => [key, (await ui.find({ type: 'Text', in: `n-cache-${key}` }))?.text])))
    const cold = await $.ui.mount({ plugin: 'statusbox', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    for (const text of ['○ cold', 'lasts 5m idle', ' to rewrite ']) expect((await cold.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)
    expect(await cache(cold)).toEqual({ next: '$0.5000', tokens: '100.0K', other: '$0.0200' })
    await cold.unmount()
    // One main-loop request seen since: $0.25 of the session's $0.30, its write
    // to an hour's entry.
    await $.telemetry.log(apiRequest({ query_source: 'repl_main_thread', cost_usd: 0.25, model: 'claude-opus-5-5', cache_creation_1h_tokens: 1000 }))
    const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })
    const figure = async (key: string) => (await ui.find({ type: 'Text', in: `n-${key}` }))?.text

    for (const text of ['~/repo', 'main', '↑2', '+5', '-1', '~1', '┏━', '┣━', '┼']) {
      expect((await ui.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)
    }
    // The model in the colour its picker gives it.
    expect((await ui.find({ type: 'Text', text: 'Opus 5.5', in: 'chip-model' }))?.props.color).toBe('#d77757')
    expect(await ui.find({ key: 'n-messages' })).toBeUndefined()
    expect((await ui.find({ key: 'effort', in: 'chip-effort' }))?.text).toBe('xhigh effort')

    // Every line of the frame is the same number of cells, controls included,
    // so a ragged right edge on screen is the terminal's drawing, not the mod's.
    const lines = ((await frameOf(ui)) as { children: unknown[] }).children.filter(Boolean)
    expect(new Set(lines.map(cells)).size).toBe(1)
    // A half-cell column of the frame's background either side, as tall as it.
    for (const side of ['▐', '▌']) expect(await ui.find({ type: 'Text', text: lines.map(() => side).join('\n') })).toBeDefined()
    // Seeded from the transcript: m1 once, the subagent's row and the torn line left out.
    const want = { in: '100', 'in-delta': '(+0)', out: '7', 'out-delta': '(+0)' }
    for (const [key, text] of Object.entries(want)) expect(`${key} ${await figure(key)}`).toBe(`${key} ${text}`)
    // The advisor has its card in the panel, not a row in the box.
    expect(await ui.find({ key: 'n-advisor-calls' })).toBeUndefined()

    // Its calls: Fable 5.1's from the table and Fable 6's from ~/.claude.json,
    // each $10 / $50 on 1,000 in and 100 out: $0.0150 apiece, $0.0300 of $0.30.
    const pane = await $.ui.mount({ plugin: 'statusbox', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    expect(await pane.find({ type: 'Text', text: '✶ Fable 6' })).toBeDefined()
    // The session card gives the transcript's size on disk.
    const onDisk = size < 1024 * 1024 ? '1.0 KB' : '5.0 MB'
    expect((await pane.find({ type: 'Text', text: onDisk })) ? onDisk : `missing: ${onDisk}`).toBe(onDisk)
    const card = { calls: '2', in: '2.0K', out: '200', usd: '$0.0300', share: '10%' }
    for (const [key, text] of Object.entries(card)) {
      expect(`${key} ${(await pane.find({ type: 'Text', in: `n-advisor-${key}` }))?.text}`).toBe(`${key} ${text}`)
    }
    expect(await pane.find({ key: 'advisor-share' })).toBeDefined()

    // The session card: one message, the session just begun, and its total
    // over that one message.
    for (const [key, text] of Object.entries({ 'session-messages': '1', 'cost-total': '$0.3000' })) {
      expect(`${key} ${(await pane.find({ type: 'Text', in: `n-${key}` }))?.text}`).toBe(`${key} ${text}`)
    }
    expect(await pane.find({ type: 'Text', text: '0s' })).toBeDefined()
    // The advisor's $0.03 rode inside that main request: carved out of main,
    // its own part, and the parts still sum to the total.
    const split = { main: '$0.2200', advisor: '$0.0300', 'advisor-share': '10%', earlier: '$0.0500' }
    for (const [key, text] of Object.entries(split)) {
      expect(`${key} ${(await pane.find({ type: 'Text', in: `n-cost-${key}` }))?.text}`).toBe(`${key} ${text}`)
    }
    // The split grows in from the left and settles filling the card's 34 cells.
    await pane.advance(1000)
    expect((await pane.find({ type: 'Text', in: 'cost-split' }))?.text).toBe('━'.repeat(34))
    // The usage card: each window's use against its pace, the tick on its bar
    // where that pace stands, and the time to its reset.
    const windows = { five_hour: '42%', 'five_hour-burn': '⇣18%', seven_day: '20%', 'seven_day-burn': '⇡6%' }
    for (const [key, text] of Object.entries(windows)) {
      expect(`${key} ${(await pane.find({ type: 'Text', in: `n-usage-${key}` }))?.text}`).toBe(`${key} ${text}`)
    }
    for (const text of ['5-hour', '7-day', 'resets in 2h', 'resets in 6d', ' pace 60%', ' pace 14%']) {
      expect((await pane.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)
    }
    expect(await pane.find({ type: 'Text', text: '┃', in: 'usage-five_hour' })).toBeDefined()
    // Nothing of either is left in the box.
    expect(await ui.find({ key: 'n-usage-five_hour' })).toBeUndefined()

    // That request started an hour's entry over: warm, the next message reads it.
    for (const text of ['● warm', '1h00m left']) expect((await pane.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)
    expect(await cache(pane)).toEqual({ next: '$0.0200', tokens: '100.0K', other: '$0.8000' })
    // A switch to Fable forfeits it: the next message writes it on Fable, at $20 a million.
    const switched = { from_model: 'claude-opus-5-5[1m]', to_model: 'claude-fable-5-1', requested_model: 'fable', source: 'command' as const }
    await $.classic.PostModelSwitch({ ...switched, context_tokens: 100_000, prompt_cache_warm: true, cache_ttl: '1h', estimated_cache_write_usd: 2, pricing: 'catalog' })
    await pane.advance(1000)
    expect(await pane.find({ type: 'Text', text: '○ cold' })).toBeDefined()
    expect(await cache(pane)).toEqual({ next: '$2.0000', tokens: '100.0K', other: '$0.0250' })

    // The effort chip opens its picker inside the frame, the level in force
    // inverted; a pick, confirmed, shuts it. Its chevron opens and shuts it too.
    const chip = async () => (await ui.find({ key: 'effort', in: 'chip-effort' }))?.text
    const isOffered = async (key: string) => (await ui.find({ key })) !== undefined
    // A choice in force is lit: its pill inverted.
    const isLit = async (key: string) => (await ui.find({ type: 'Text', in: key }))?.props.inverse === true
    // A picker folds away on the hooks' clock; a whole second, so the 1-second
    // clock keeps the phase the timings below count on.
    const unfold = () => clock.advance(1000)
    const pill = async (level: string) => ui.find({ type: 'Text', in: `pick-effort-${level}` })
    // The picker rolls open from the top a row a beat on the hooks' clock,
    // never drawn whole first: two beats in, the wire's two rows are there and
    // the choices still to come.
    await ui.press({ key: 'effort' })
    expect(await isOffered('wire')).toBe(false)
    await clock.advance(48)
    expect([await isOffered('wire'), await isOffered('pick-effort-max')]).toEqual([true, false])
    // Then its row ripples in from the left on the terminal's clock: the last
    // level is still to come.
    await clock.advance(952)
    expect([await isOffered('pick-effort-max'), (await pill('max'))?.text?.trim()]).toEqual([true, ''])
    // As it ripples in, each level plays its flourish: max flares through red,
    // yellow and white, low keeps its gray. Looked at each 30 ms tick of
    // pill.tsx, at the glyph that leads the pill.
    const flared = { max: new Set<string>(), low: new Set<string>() }
    for (let t = 0; t < 1200; t += 30) {
      await ui.advance(30)
      for (const level of ['max', 'low'] as const) {
        const color = (await ui.findAll({ type: 'Text', in: `pick-effort-${level}` })).find(text => text.props.color)?.props.color
        if (typeof color === 'string') flared[level].add(color)
      }
    }
    expect([[...flared.max].sort(), [...flared.low]]).toEqual([['red', 'white', 'yellow'], ['gray']])
    // Under the pointer it plays again: a layer over the pill, hidden until the
    // hover group reveals it and a Button too, loops the flourish for as long
    // as the row is open, resting between plays.
    const layerOf = async (level: string) => (await ui.findAll({ type: 'Box', in: `pick-effort-${level}` })).find(box => box.props.position === 'absolute')
    expect([(await layerOf('max'))?.props.display, (await ui.find({ key: 'pick-effort-max-lit', in: 'pick-effort-max' }))?.type]).toEqual(['none', 'Button'])
    const looped = new Set<string>()
    for (let t = 0; t < 1500; t += 30) looped.add(await ui.advance(30).then(async () => (await ui.findAll({ type: 'Text', in: 'pick-effort-max' })).at(-1)?.text ?? ''))
    expect([...looped].sort()).toEqual([' ✸ max ', ' ✹ max ', ' ✺ max ', ' ❂ max '])
    // Settled, the level in force is lit as one pill, glyph and name in one
    // colour, and as the pick it plays its flourish on a loop; the rest are not.
    const picked = new Set<string>()
    for (let t = 0; t < 1500; t += 30) {
      await ui.advance(30)
      const lit = await pill('xhigh')
      picked.add(lit?.props.inverse === true ? (lit.text ?? '') : 'not lit')
    }
    expect([[...picked].sort(), (await pill('low'))?.props.inverse]).toEqual([[' ✶ xhigh ', ' ✷ xhigh ', ' ✸ xhigh ', ' ✹ xhigh ', ' ✺ xhigh '], undefined])
    expect((await pill('max'))?.props.inverse).toBeUndefined()
    // Already lit and playing, the pick has no layer to hand the pointer over
    // to: the handover flickered.
    expect(await ui.find({ key: 'pick-effort-xhigh-lit', in: 'pick-effort-xhigh' })).toBeUndefined()
    // A click on a pill picks its level, lit in place of the one in force,
    // with a confirm after the row, which has room for it where it stands;
    // nothing is applied yet.
    await ui.press({ key: 'pick-effort-max' })
    const confirm = async () => (await ui.find({ key: 'confirm' }))?.text
    expect([await chip(), (await pill('max'))?.props.inverse, (await pill('xhigh'))?.props.inverse, await confirm()]).toEqual(['xhigh effort', true, undefined, ' ✓ Confirm '])
    // Picked, it plays its flare from the start, 45 ms a frame from the tick
    // that starts it over: looked at that tick, 60 ms on and 90.
    const flare: string[] = []
    for (const ms of [30, 60, 30]) flare.push(await ui.advance(ms).then(async () => `${(await pill('max'))?.text} ${(await pill('max'))?.props.color}`))
    expect(flare).toEqual([' ✺ max  red', ' ✹ max  yellow', ' ❂ max  white'])
    // The confirm applies it, and the picker folds away: its row ripples out
    // from the right, then its rows roll shut and it leaves the box.
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
    // Opened again while it rolls shut, it rolls back down from where it stood:
    // its choices gone by then, the wire's row still there.
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
    // No command ran: the pick goes out on the next request instead.
    expect(ran).toEqual([])
    expect(await step('xhigh')).toBe('low')
    // A level the person set since (/effort high) wins and clears the pick.
    expect(await step('high')).toBe('high')
    expect(await chip()).toBe('high effort')

    // The model chip offers the Model row's choices, the one in force marked;
    // a pick, confirmed, sets that row, as the person's pick in /config would.
    // Each model once, by its version as the box names it, the session's own
    // from its id and the rest from the newest catalog. The pills wrap so the
    // frame keeps its width and its even right edge.
    const widths = async () => new Set(((await frameOf(ui)) as { children: unknown[] }).children.filter(Boolean).map(cells))
    const width = await widths()
    await ui.press({ key: 'model' })
    await unfold()
    // Rolled open, the wire has not left the chip: its end is the one cell
    // under it, a head pointing the way it goes (Opus lies left of the chip),
    // its arrow waiting for it to arrive. It unrolls, and the choices ripple
    // in, on the terminal's clock.
    const drawnIn = async (key: string) => (await ui.find({ type: 'Text', in: key }))?.text?.trim()
    expect([await drawnIn('wire'), await drawnIn('wire-arrow')]).toEqual(['◂', ''])
    await ui.advance(1000)
    const label = async (key: string) => (await ui.find({ key }))?.text
    const pillText = async (key: string) => (await ui.find({ type: 'Text', in: key }))?.text
    const labels = await Promise.all(['opus', 'sonnet', 'fable', 'haiku'].map(alias => pillText(`pick-model-${alias}`)))
    expect(labels).toEqual([' Opus 5.5 ', ' Sonnet 6 ', ' Fable ', ' Haiku '])
    // Each model in a colour of its own, none an effort level's; under the
    // pointer a sweep of light runs across its name, washed from that colour
    // toward white at three strengths, looping while the row is open.
    const tints = await Promise.all(['opus', 'sonnet', 'fable', 'haiku', 'default'].map(async alias => (await ui.find({ type: 'Text', in: `pick-model-${alias}` }))?.props.color))
    expect(tints).toEqual(['#d77757', '#5f9cf5', '#b48cf2', '#5fbf8f', '#a9afc2'])
    // The light crosses the pill's padding either side of the name too, the
    // bars a lit pill shows there: looked at on Haiku, whose name holds no
    // space of its own.
    const [swept, padded] = [new Set<unknown>(), new Set<unknown>()]
    for (let t = 0; t < 1500; t += 30) {
      await ui.advance(30)
      for (const text of await ui.findAll({ type: 'Text', in: 'pick-model-sonnet' })) swept.add(text.props.color)
      for (const text of await ui.findAll({ type: 'Text', in: 'pick-model-haiku' })) if (text.text === ' ' && text.props.color) padded.add(text.props.color)
    }
    expect([swept.size, swept.has('#5f9cf5'), padded.size]).toEqual([4, true, 4])
    expect(await Promise.all(['opus[1m]', 'opusplan', 'best'].map(alias => isOffered(`pick-model-${alias}`)))).toEqual([false, false, false])
    expect(await isLit('pick-model-opus')).toBe(true)
    expect(await widths()).toEqual(width)
    // The wire unrolls from the middle of the chip's words to the middle of
    // the choice in force's, its arrow on the row below; the pills are centred
    // under them, a blank frame row follows them, then the divider.
    const textOf = (node: unknown): string => (typeof node === 'string' ? node : ((node as { children?: unknown[] }).children ?? []).map(textOf).join(''))
    const isBlank = (text = 'x') => text.replace(/[┃│\s]/g, '') === ''
    const linesOf = async () => ((await frameOf(ui)) as { children: unknown[] }).children.filter(Boolean)
    const textIn = async (key: string) => [...((await ui.find({ type: 'Text', in: key }))?.text ?? '')]
    const middle = (line: unknown, key: string, text: string) => cellsTo(line, key) + Math.floor([...text].length / 2)
    // Where the wire's corners and arrow stand, in the frame line's cells.
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
    // Opus lies left of the chip, so the wire turns down at ╭ and up at ╯.
    expect(toPill).toBeGreaterThan(0)
    expect(toPill).toBeLessThan(fromChip)
    expect(unrolled.corners).toEqual([fromChip, toPill, toPill])
    // Centred: as many cells of the row before the first pill as after the
    // last, but for the one an odd split leaves over. The wire's row is the
    // content's whole width.
    const pillLine = unrolled.lines[wireRow + 2]
    const start = cellsTo(unrolled.lines[wireRow], 'wire')
    const room = (await textIn('wire')).length
    const before = cellsTo(pillLine, 'pick-model-default') - start
    const after = start + room - (cellsTo(pillLine, 'pick-model-fable') + ' Fable '.length)
    expect([0, 1]).toContain(after - before)
    // A click on Sonnet picks it and sets nothing yet: the wire's end sets off
    // for it, a head pointing its way (Sonnet lies left of Opus) and its arrow
    // lifted, then turns down onto it.
    await ui.press({ key: 'pick-model-sonnet' })
    await ui.advance(16)
    expect([sets, (await textIn('wire')).includes('◂'), await drawnIn('wire-arrow')]).toEqual([[], true, ''])
    // Its confirm shows two cells after the last choice, the row having room
    // for it where it stands, and the frame as wide as ever.
    const pills = (await linesOf())[wireRow + 2]
    expect([cellsTo(pills, 'confirm'), (await ui.find({ key: 'confirm' }))?.text]).toEqual([cellsTo(pills, 'pick-model-fable') + ' Fable '.length + 2, ' ✓ Confirm '])
    expect(await widths()).toEqual(width)
    // The wire follows Sonnet over and turns down onto it.
    await ui.advance(1000)
    const toSonnet = middle(pills, 'pick-model-sonnet', ' Sonnet 6 ')
    expect((await wireAt()).corners).toEqual([fromChip, toSonnet, toSonnet])
    // Opus, in force, clicked again takes the pick back, and the confirm goes:
    // clicked where the pointer rests, on the layer it revealed. Sonnet again,
    // and its confirm sets the Model row.
    await ui.press({ key: 'pick-model-opus-lit' })
    expect(await isOffered('confirm')).toBe(false)
    await ui.press({ key: 'pick-model-sonnet' })
    await ui.press({ key: 'confirm' })
    expect(sets).toEqual([['model', 'sonnet']])
    await unfold()
    expect(await isOffered('pick-model-opus')).toBe(false)
    // On a 1M session the 1M aliases stand in, so a pick keeps the window.
    // The chip's chevron opens the picker as its words do.
    await ui.press({ key: 'chevron-model' })
    await unfold()
    await ui.advance(1000)
    expect(await pillText('pick-model-sonnet[1m]')).toBe(' Sonnet 6 ')
    expect([await isOffered('pick-model-sonnet'), await isLit('pick-model-opus[1m]')]).toEqual([false, true])
    // Switching to the effort picker slides the wire over, the rows staying
    // open: drawn at once it still runs from the model's chip, its end now a
    // head under way and its arrow lifted, then both ends glide to the
    // effort's.
    await ui.advance(1000)
    const settled = (await textIn('wire')).join('')
    await ui.press({ key: 'effort' })
    expect([(await textIn('wire')).join('').replace(/[▸◂]/, '╭'), await drawnIn('wire-arrow')]).toEqual([settled, ''])
    await ui.advance(1000)
    const glided = await wireAt()
    const fromEffort = middle(glided.lines[glided.at - 1], 'chip-effort', (await ui.find({ key: 'effort', in: 'chip-effort' }))?.text ?? '')
    const toHigh = cellsTo(glided.lines[glided.at + 2], 'pick-effort-high') + 3 + Math.floor('high'.length / 2)
    expect(glided.corners).toEqual([fromEffort, toHigh, toHigh])

    // The agents' section stays folded, its header saying what it holds.
    expect(await pane.find({ type: 'Text', text: 'No agents in this session yet.' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: ' none yet', in: 'fold-AGENTS' })).toBeDefined()

    // While a turn runs, the timing not known yet counts up.
    await $.turn.start({ text: 'go', turnId: 't2' })
    await clock.advance(5000)
    for (const text of ['first output ', '5s']) expect((await pane.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)

    // The version is the panel's now, the band's no longer.
    expect(await ui.find({ type: 'Text', text: 'v2.1.299' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: 'Claude Code v2.1.299' })).toBeDefined()
    await pane.press({ key: 'version' })
    await ui.press({ key: 'repo' })
    expect(opened.map(argv => argv.at(-1))).toEqual([
      'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md',
      'https://github.com/me/repo',
    ])
  })

  test(`${surface}: a section's header folds it, says what it holds, and keeps the choice`, async ($, on) => {
    const kept = engine(on)
    const clock = mock.clock(on)
    // The panel as drawn after each write, while a click is watched.
    let afterWrites: string[] | null = null
    on('state.set', async ($, e, next) => {
      const r = await next(e)
      afterWrites?.push(heldTo(await pane.drawn()).join())
      return r
    })
    await $.session.measure({ context: { tokens: 1, window: 200_000, percent: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 23 }], changed: ['rateLimits'] })
    const pane = await $.ui.mount({ plugin: 'statusbox', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    const fold = () => pane.press({ key: 'fold-USAGE' })
    // The heights a folding body and its card are held to, outermost first;
    // none while it rests. (The frame the panel slides in cuts at its width.)
    const heldTo = (node: unknown): number[] => {
      const el = node as { props?: { overflow?: string; height?: number }; children?: unknown[] }
      const inner = (el?.children ?? []).flatMap(heldTo)
      return el?.props?.overflow === 'hidden' && el.props.height !== undefined ? [el.props.height, ...inner] : inner
    }
    expect([await pane.find({ key: 'n-usage-five_hour' }) !== undefined, heldTo(await pane.drawn())]).toEqual([true, []])
    // The header's rule, in cells, and the ones it stands at over the next
    // 25 ms ticks, each once. It sweeps out to the edge as the panel opens.
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
    // A click and its first beat, as drawn after each write: each must agree
    // with the fold, so it never flashes the other way.
    const clicked = async () => {
      afterWrites = []
      await fold()
      await clock.advance(24)
      const seen = [...new Set(afterWrites)]
      afterWrites = null
      return seen
    }

    // The body folds a row a beat: whole until then, one beat in its four
    // rows (the card's border, straight under the header, and the window's
    // name and bar) are three, the card's border kept round them.
    expect(await clicked()).toEqual(['4,4', '3,3'])
    await clock.advance(300)
    expect([await pane.find({ key: 'n-usage-five_hour' }), heldTo(await pane.drawn())]).toEqual([undefined, []])
    // The rule draws back just far enough for the summary, never back to the
    // name and out again, and the summary then shows at its end.
    expect(await pane.find({ type: 'Text', text: ' 5-hour 23%', in: 'fold-USAGE' })).toBeUndefined()
    expect(await ruled()).toEqual([30, 27, 24, 21, 19])
    expect(await pane.find({ type: 'Text', text: ' 5-hour 23%', in: 'fold-USAGE' })).toBeDefined()
    expect(kept.get('folded')).toEqual(['USAGE'])

    // It unfolds the same way, from nothing, and rests at its own height: a
    // beat in only its top border shows, the card, never less than its
    // border, cut below it.
    expect(await clicked()).toEqual(['0,2', '1,2'])
    await clock.advance(300)
    expect([await pane.find({ key: 'n-usage-five_hour' }) !== undefined, heldTo(await pane.drawn())]).toEqual([true, []])
    // The summary goes, and the rule runs on from where it stood to the edge.
    expect(await ruled()).toEqual([19, 22, 25, 28, 30])
    expect(kept.get('folded')).toEqual([])
  })

  test(`${surface}: the cost card splits the total by who asked, from the engine's request records`, async ($, on) => {
    engine(on)
    mock.clock(on)
    const record = (query_source: string, cost_usd: number) => $.telemetry.log(apiRequest({ query_source, cost_usd }))
    await record('repl_main_thread', 0.25)
    await record('agent:builtin:Explore', 0.1)
    await record('auto_mode', 0.01)
    await $.telemetry.log({ to: 'collector', event: 'tool_result', attributes: { cost_usd: 9 }, loggedAt: '2026-10-14T00:00:00.000Z' })
    // The ledger also holds $0.04 from before the mod saw this process.
    await $.session.measure({ context: { tokens: 1, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 0.4 }, changed: ['cost'] })

    const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'Pane', requestId: 'sidebar', props: PANE })

    // Each part's dollars and its share of the $0.40 total.
    const want = { main: '$0.2500', 'main-share': '63%', agents: '$0.1000', 'agents-share': '25%', background: '$0.0100', earlier: '$0.0400', 'earlier-share': '10%' }
    for (const [key, text] of Object.entries(want)) {
      expect(`${key} ${(await ui.find({ type: 'Text', in: `n-cost-${key}` }))?.text}`).toBe(`${key} ${text}`)
    }
    // The split fills the card's 34 cells exactly: 40 columns, less the panel's
    // margin, the card's border and its padding.
    await ui.advance(1000)
    const split = (await ui.find({ type: 'Text', in: 'cost-split' }))?.text ?? ''
    expect([...split].length).toBe(34)
    expect(split).toBe('━'.repeat(34))
  })

  test(`${surface}: a figure rolls to its new value, holding the cells it settles in`, async ($, on) => {
    engine(on)
    await $.session.measure({ context: { tokens: 84_000, window: 200_000, percent: 42 }, rateLimits: [], changed: ['context'] })
    const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })
    const used = async () => (await ui.find({ type: 'Text', in: 'n-used' }))?.text ?? ''
    // Mounted, it shows its value at once.
    expect(await used()).toBe('84.0K')

    await $.session.measure({ context: { tokens: 120_000, window: 200_000, percent: 60 }, rateLimits: [], changed: ['context'] })
    await ui.advance(200)
    const mid = await used()
    expect(mid.length).toBe('120.0K'.length)
    const at = Number.parseFloat(mid)
    expect(at > 84 && at < 120 ? 'between' : mid).toBe('between')
    await ui.advance(1000)
    expect(await used()).toBe('120.0K')

    // Down past a power of ten the roll is wider than its cells: the target shows.
    await $.session.measure({ context: { tokens: 9_000, window: 200_000, percent: 4 }, rateLimits: [], changed: ['context'] })
    await ui.advance(40)
    expect(await used()).toBe('9.0K')
  })

  test(`${surface}: the bar glides to the reading and Claude frolics in one spot while it works`, async ($, on) => {
    engine(on)
    await $.session.measure({ context: { tokens: 84_000, window: 200_000, percent: 42 }, rateLimits: [], changed: ['context'] })
    const working = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: { ...BAND, isWorking: true } })
    const has = async (ui: typeof working, text: string, at: string) => ((await ui.find({ type: 'Text', text, in: at })) ? text : `missing: ${text}`)

    // From empty to 42 % of 30 cells, 12.6: twelve full and half of one.
    expect(await has(working, '━━━━', 'bar')).toBe('missing: ━━━━')
    await working.advance(3000)
    expect(await has(working, '╾', 'bar')).toBe('╾')
    // The spark turns a glyph every 120 ms.
    await working.advance(120 - (3000 % 120))
    // The first frame is a `·` too, so the turning glyphs are looked for.
    const spark = async () => (await Promise.all(['✢', '✶', '✻', '✽'].map(g => has(working, g, 'claude')))).find(g => !g.startsWith('missing'))
    const first = await spark()
    await working.advance(240)
    expect(await spark()).not.toBe(first)
    // Frame after frame the spark keeps its one cell, a single space before
    // the word, as the row's separators space their parts.
    for (let i = 0; i < 8; i++) {
      await working.advance(120)
      const cells = [...((await working.find({ type: 'Text', in: 'claude' }))?.text ?? '')]
      const isSpaced = cells[1] === ' ' && cells.slice(2).join('') === 'Working' && ['·', '✢', '✶', '✻', '✽'].includes(cells[0] ?? '')
      expect(isSpaced ? 'spark, space, word' : cells.join('')).toBe('spark, space, word')
    }
    // A glow sweeps the spark and on over `Working`, Claude's accent washed
    // toward white, a cell a 60 ms tick. Over one sweep (its nine cells and
    // eight more) the first letter brightens to the glow's middle and fades
    // back, and the glow's middle passes the spark and every letter.
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

    const idle = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })
    // At rest, `✓ Ready` in green, as a finished agent's `✓ done`.
    const colorOf = async (text: RegExp) => (await idle.find({ type: 'Text', text, in: 'claude' }))?.props.color
    expect([await has(idle, 'Ready', 'claude'), await colorOf(/^✓$/), await colorOf(/^Ready$/)]).toEqual(['Ready', 'green', 'green'])
  })

  test(`${surface}: an agent in the panel carries its tokens, working time and engine-priced cost`, async ($, on) => {
    engine(on)
    const clock = mock.clock(on)
    let status: AgentStatus = 'running'
    on('agent.list', () => ({ value: [{ id: 'a1', description: 'Org pricing', type: 'Explore', status }] }))
    // Each request of the agent's answers a little more than the last.
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
        // only the result counts
      }
    }
    const record = (n: number, cost_usd: number) =>
      $.telemetry.log(
        apiRequest({ query_source: 'agent:builtin:Explore', cost_usd, input_tokens: 10 + n, output_tokens: 3000 + n, cache_read_tokens: 40_000 + n, cache_creation_tokens: 2000 + n }),
      )

    await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })
    // One request's record lands before its result, the other's after.
    await record(0, 0.25)
    await step(0)
    await step(1)
    await record(1, 0.1)
    await clock.advance(70_000)
    // While it works, the panel runs Claude's working animation for it.
    const busy = await $.ui.mount({ plugin: 'statusbox', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    expect(await busy.find({ type: 'Text', text: 'Working', in: 'working-a1' })).toBeDefined()
    await busy.unmount()
    status = 'completed'
    await $.turn.complete({ answer: 'done', durationMs: 70_000, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })

    const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    for (const text of ['✓ done', 'Explore', 'Org pricing', '1m10s', 'Opus 5.5 · xhigh', ' context', ' out']) {
      expect((await ui.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)
    }
    const want = { context: '42.0K', out: '6.0K', usd: '$0.3500' }
    for (const [key, text] of Object.entries(want)) {
      expect(`${key} ${(await ui.find({ type: 'Text', in: `n-a1-${key}` }))?.text}`).toBe(`${key} ${text}`)
    }
    // The box above the prompt no longer carries agents.
    const band = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ type: 'Text', text: 'Org pricing' })).toBeUndefined()
  })

  // The desktop app shows pasted images itself.
  if (surface === 'terminal') test(`${surface}: a pasted screenshot gets a button that opens it until its placeholder goes`, async ($, on) => {
    engine(on)
    mock.env(on, { HOME: '/home/me', OS: 'Windows_NT', TEMP: 'C:\\Temp' })
    on('session.id', () => ({ value: 'abc' }))
    let draft = 'look '
    on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
    on('prompt.edit', () => ({ text: draft, cursor: draft.length }))
    // The capture saves the clipboard's image and prints nothing.
    const ran: string[][] = []
    on('process.run', ($, e) => (ran.push([...e.argv]), {
      value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))
    const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })
    // The capture runs off the hook's path; each look lets it move on.
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
    // No thumbnail is drawn: the button alone stands for the image.
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect(ran.filter(argv => argv[0] === 'powershell').length).toBe(1)
    // A press opens the copy the capture saved.
    await ui.press({ key: 'open-image-1' })
    expect(ran.at(-1)).toEqual(['rundll32', 'url.dll,FileProtocolHandler', 'C:\\Temp\\statusbox-abc-1.png'])

    draft = 'look '
    await edit({ origin: { kind: 'composer' }, text: 'look [Image #1] ', cursor: 16, start: 5, end: 16, inputText: '' })
    expect(await settle(false)).toBe(false)
  })

  // shortcut: the kit raises no person's close, so the gate that keeps a
  // closed panel shut across reloads goes untested here.
  test(`${surface}: the box's sidebar control opens and closes the panel, its chevron turning`, async ($, on) => {
    const opened: (true | undefined)[] = []
    // Where the panel's contents stood each time it closed.
    const atClose: unknown[] = []
    engine(on, opened, undefined, async () => void atClose.push(await offset()))
    const clock = mock.clock(on)
    mock.env(on, { HOME: '/home/me' })
    on('session.root', () => ({ value: '/home/me/repo' }))
    on('session.id', () => ({ value: 's1' }))

    const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })
    const pane = await $.ui.mount({ plugin: 'statusbox', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    // How far right of its place the panel's contents stand, and where the
    // panel's own edge stands, there while they slide but in place.
    const offset = async () => (await pane.find({ key: 'slide' }))?.props.marginLeft
    const curtain = async () => (await pane.find({ key: 'curtain' }))?.props.left
    const edged = async () => [await offset(), await curtain()]
    const chevron = async () => (await ui.find({ type: 'Text', in: 'chevron-panel' }))?.text
    expect((await ui.find({ key: 'panel' }))?.text).toBe('SIDEBAR')
    expect(await chevron()).toBe(' ›')

    // The keyboard opens it; the chevron turns through to face the panel's way,
    // eased: slow off the mark and into place, quick through the middle.
    await ui.press({ key: 'panel' })
    expect(opened).toEqual([true])
    const turn: string[] = []
    for (const ms of [120, 30, 90, 90, 150]) turn.push(await ui.advance(ms).then(chevron).then(text => text ?? ''))
    expect(turn).toEqual([' ›', ' >', ' |', ' <', ' ‹'])
    // Its contents slide in from its right edge over 240 ms, a 24 ms beat at
    // a time, quick off the mark and slow into place, an edge like the dock's
    // riding their left margin until it meets the dock's own.
    const slid: unknown[] = [await offset()]
    const sweep: unknown[][] = [await edged()]
    for (let beat = 0; beat < 10; beat++) {
      await clock.advance(24)
      slid.push(await offset())
      sweep.push(await edged())
    }
    expect(slid).toEqual([40, 29, 20, 14, 9, 5, 3, 1, 0, 0, 0])
    expect(sweep).toEqual(slid.map(at => [at, typeof at === 'number' && at > 0 && at < 40 ? at : undefined]))
    // It runs the panel's height in view, floor to ceiling, as the dock's does.
    await ui.press({ key: 'panel' })
    await clock.advance(144)
    expect((await pane.find({ key: 'curtain' }))?.text?.split('\n')).toEqual(Array.from({ length: PANE.scroll.bodyRows }, () => '│'))
    await ui.press({ key: 'panel' })
    await clock.advance(240)

    // Again: the chevron turns back at once, and the contents go out as they
    // came in, played backwards, the panel's edge peeling off the dock's and
    // riding out with them. The panel closes while they are still drawn out
    // of sight, never back in place.
    await ui.press({ key: 'panel' })
    await ui.advance(500)
    expect(await chevron()).toBe(' ›')
    const out: unknown[][] = []
    for (let beat = 0; beat < 9; beat++) out.push(await clock.advance(24).then(edged))
    expect([out, atClose]).toEqual([[...sweep].reverse().slice(1, -1), []])
    await clock.advance(24)
    expect(atClose).toEqual([slid[0]])

    // A click on the chevron itself opens it once more, the panel having
    // closed. Turned mid-slide out, the contents come back in from where they
    // stand, never jumping, and it stays open.
    await ui.press({ key: 'chevron-panel' })
    expect(opened).toEqual([true, true])
    await clock.advance(240)
    await ui.press({ key: 'panel' })
    await clock.advance(144)
    const turned: unknown[] = [await offset()]
    await ui.press({ key: 'panel' })
    for (let beat = 0; beat < 6; beat++) turned.push(await clock.advance(24).then(offset))
    expect([opened, turned, atClose, await curtain()]).toEqual([[true, true], [9, 5, 3, 1, 0, 0, 0], [40], undefined])
  })

  test(`${surface}: a pick on a row too full for its confirm slides the row left to make room`, async ($, on) => {
    engine(on)
    const clock = mock.clock(on)
    mock.env(on, { HOME: '/home/me' })
    // Five models, centred in this box's narrower row (58 cells for content),
    // leave it 4 cells short of room for a confirm after them.
    const options = ['default', 'opus', 'sonnet', 'haiku', 'fable']
    const model = { key: 'model', label: 'Model', kind: 'choice' as const, value: 'Default', isLocked: false, options, provider: { plugin: 'engine', tier: 'core' as const } }
    on('config.list', () => ({ value: [model] }))
    const sets: unknown[] = []
    on('config.set', ($, e) => (sets.push(e.value), { value: e.value }))
    on('session.model', () => ({ value: 'claude-sonnet-6' }))
    const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })
    const lines = async () => ((await frameOf(ui)) as { children: unknown[] }).children.filter(Boolean)
    const widths = async () => new Set((await lines()).map(cells))
    const width = await widths()
    // The picker rolls open, and its choices ripple in on the terminal's
    // clock: a choice is a Button once it is drawn.
    await ui.press({ key: 'model' })
    await clock.advance(1000)
    await ui.advance(1000)
    const row = async () => (await lines()).find(line => cellsTo(line, 'pick-model-default') >= 0)
    const unmoved = cellsTo(await row(), 'pick-model-default')

    // A pick: no room for its confirm where the row stands, so the row slides
    // left a cell a beat on the hooks' clock, and the confirm shows once it
    // has made room, two cells after the last choice, the frame as wide as ever.
    await ui.press({ key: 'pick-model-sonnet' })
    expect(await ui.find({ key: 'confirm' })).toBeUndefined()
    await clock.advance(24)
    expect(cellsTo(await row(), 'pick-model-default')).toBe(unmoved - 1)
    await clock.advance(976)
    const moved = await row()
    expect(cellsTo(moved, 'confirm')).toBe(cellsTo(moved, 'pick-model-fable') + ' Fable '.length + 2)
    expect(await widths()).toEqual(width)
    // The confirm sets the model, and the row stays where it is as the picker
    // folds away.
    await ui.press({ key: 'confirm' })
    expect([sets, cellsTo(await row(), 'pick-model-default')]).toEqual([['sonnet'], cellsTo(moved, 'pick-model-default')])
    await clock.advance(1000)
    expect(await row()).toBeUndefined()

    // Opened again, its row starts centred, with no pick to make room for.
    await ui.press({ key: 'model' })
    await clock.advance(1000)
    expect([cellsTo(await row(), 'pick-model-default'), await ui.find({ key: 'confirm' })]).toEqual([unmoved, undefined])
  })

  test(`${surface}: a session started before its conversation arrives seeds it once it does`, async ($, on) => {
    // The daemon's process for the agent view: the plugin starts, then the
    // conversation lands with its transcript a moment later.
    let isLoaded = false
    engine(on, undefined, () => (isLoaded ? 2 : 0))
    const clock = mock.clock(on)
    mock.env(on, { HOME: '/home/me' })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('session.version', () => ({ value: { version: '2.1.300', base: '2.1.300' } }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1000, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }))
    on('session.cwd', () => ({ value: '/home/me/repo' }))
    on('session.repo', () => ({ value: null }))
    on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('session.root', () => ({ value: '/home/me/repo' }))
    on('session.id', () => ({ value: 'abc' }))
    on('settings.read', () => ({ value: {} }))
    on('agent.list', () => ({ value: [] }))
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
    const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })
    const figure = async (key: string) => (await ui.find({ type: 'Text', in: `n-${key}` }))?.text
    // No effort yet, so no chip for it.
    expect([await figure('out'), await ui.find({ key: 'effort', in: 'chip-effort' }).catch(() => undefined)]).toEqual(['0', undefined])

    isLoaded = true
    await clock.advance(1000)
    await ui.advance(3000)
    expect([await figure('out'), await figure('cacheRead'), (await ui.find({ key: 'effort', in: 'chip-effort' }))?.text]).toEqual(['20', '300', 'high effort'])
  })

  test(`${surface}: a session the process goes on under, resumed or cleared, is seeded again`, async ($, on) => {
    // /resume and /clear go on in the same process under another session: the
    // engine drops every value the plugin keeps as the last one ends and raises
    // no session.start for the next, only the classic SessionStart.
    engine(on, undefined, () => 2)
    const clock = mock.clock(on)
    mock.env(on, { HOME: '/home/me' })
    let id = 'abc'
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('session.version', () => ({ value: { version: '2.1.300', base: '2.1.300' } }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1000, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }))
    on('session.cwd', () => ({ value: '/home/me/repo' }))
    on('session.repo', () => ({ value: null }))
    on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('session.root', () => ({ value: '/home/me/repo' }))
    on('session.id', () => ({ value: id }))
    on('settings.read', () => ({ value: {} }))
    on('agent.list', () => ({ value: [] }))
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
    const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })
    const figure = async (key: string) => (await ui.find({ type: 'Text', in: `n-${key}` }))?.text
    const shown = async () => [
      (await ui.find({ key: 'model', in: 'chip-model' }))?.text,
      (await ui.find({ key: 'effort', in: 'chip-effort' }).catch(() => undefined))?.text,
      await figure('out'),
    ]
    expect(await shown()).toEqual(['unknown', undefined, '0'])

    // Resumed: the model, its effort and the transcript's figures come back.
    await $.classic.SessionStart({ source: 'resume', session_id: id })
    await clock.advance(0)
    await ui.advance(3000)
    expect([await shown(), reads]).toEqual([['Opus 5.5', 'high effort', '20'], 1])
    // A SessionStart for the session already seeded (`claude --resume` as the
    // process starts) and a compaction read nothing again; a /clear does.
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
    mock.env(on, { HOME: '/home/me' })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.model', () => ({ value: 'claude-sonnet-6' }))
    on('session.version', () => ({ value: { version: '2.1.300', base: '2.1.300' } }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1000, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }))
    on('session.cwd', () => ({ value: '/home/me/repo' }))
    on('session.repo', () => ({ value: null }))
    on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('session.root', () => ({ value: '/home/me/repo' }))
    on('session.id', () => ({ value: 'abc' }))
    // /effort's level for this model alone: the chip is drawn before any request.
    on('settings.read', () => ({ value: { modelSettings: { 'claude-sonnet-6': { effortLevel: 'xhigh' } } } }))
    on('agent.list', () => ({ value: [] }))
    on('fs.exists', () => ({ value: false }))
    on('fs.list', () => ({ value: [] }))
    await $.session.start({ cwd: '/home/me/repo', surface, isInteractive: true })
    // The colours a chip's cells take over a sweep and more, a 60 ms tick at
    // a time: all of them, and how many its chevron's; and whether any was
    // bold.
    const colours = async (isWorking: boolean, chip = 'chip-model') => {
      const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: { ...BAND, isWorking } })
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
    // At rest, Sonnet's blue alone; at work, a glow washes it toward white,
    // and on over its chevron. In colour alone: a bold letter grows heavier
    // inverted, under the pointer.
    expect(await colours(false)).toEqual({ all: ['#5f9cf5'], chevron: 1, isBold: false })
    const working = await colours(true)
    expect([working.all.length, working.all.includes('#5f9cf5'), working.chevron, working.isBold]).toEqual([5, true, 5, false])
    // The effort's chip glistens alike: at rest its theme's yellow, at work a
    // glow washing VS Code's own yellow toward white.
    expect(await colours(false, 'chip-effort')).toEqual({ all: ['yellow'], chevron: 1, isBold: false })
    const effort = await colours(true, 'chip-effort')
    expect([effort.all.length, effort.all.includes('yellow'), effort.all.includes('#f2f288'), effort.chevron, effort.isBold]).toEqual([5, true, true, 5, false])
  })

  test(`${surface}: a skin's theme repaints the box and the panel, its light theme in its light palette`, async ($, on) => {
    engine(on)
    const clock = mock.clock(on)
    mock.env(on, { HOME: '/home/me' })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.model', () => ({ value: 'claude-sonnet-6' }))
    on('session.version', () => ({ value: { version: '2.1.300', base: '2.1.300' } }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1000, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }))
    on('session.cwd', () => ({ value: '/home/me/repo' }))
    on('session.repo', () => ({ value: null }))
    on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('session.root', () => ({ value: '/home/me/repo' }))
    on('session.id', () => ({ value: 'abc' }))
    on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
    on('agent.list', () => ({ value: [] }))
    on('fs.exists', () => ({ value: false }))
    on('fs.list', () => ({ value: [] }))
    // The /config rows as they stand, the theme Tokyo Night's; a change is taken.
    const engineRow = { label: 'Theme', kind: 'choice' as const, isLocked: false, provider: { plugin: 'engine', tier: 'core' as const } }
    on('config.list', () => ({ value: [{ key: 'theme', value: 'custom:statusbox:tokyo-night-dark', ...engineRow }] }))
    on('config.set', ($, e) => ({ value: e.value }))
    await $.session.start({ cwd: '/home/me/repo', surface, isInteractive: true })
    const band = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })
    const pane = await $.ui.mount({ plugin: 'statusbox', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    // What the skin paints: Sonnet's chip, xhigh's, Ready's check, and the
    // session card's border.
    const inkIn = async (key: string) => (await band.findAll({ type: 'Text', in: key })).find(text => text.props.color)?.props.color
    const card = async (color: string) => (await pane.findAll({ type: 'Box' })).some(box => box.props.borderColor === color)
    const shown = async (accent: string) => [
      await inkIn('chip-model'),
      await inkIn('chip-effort'),
      (await band.find({ type: 'Text', text: /^✓$/, in: 'claude' }))?.props.color,
      await card(accent),
    ]

    // Tokyo Night's night palette.
    expect(await shown('#7aa2f7')).toEqual(['#7aa2f7', '#e0af68', '#9ece6a', true])
    // Its day theme picked in /theme swaps in the day palette.
    const person = { origin: { kind: 'composer' as const } }
    const pick = (value: string, previous: string) => $.config.set({ key: 'theme', value, previous, provider: engineRow.provider, ...person })
    await pick('custom:statusbox:tokyo-night-light', 'custom:statusbox:tokyo-night-dark')
    await clock.advance(0)
    expect(await shown('#2e7de9')).toEqual(['#2e7de9', '#8c6c3e', '#587539', true])
    // Any other theme repaints in the colours statusbox has always drawn in,
    // the terminal theme's own.
    await pick('dark', 'custom:statusbox:tokyo-night-light')
    await clock.advance(0)
    expect(await shown('claude')).toEqual(['#5f9cf5', 'yellow', 'green', true])
  })

  // A session on the theme given, the box drawn. The /config rows are held
  // here as the menu keeps them, each change taken, and each write to the
  // terminal is recorded with the device it went to.
  const themed = async ($: Engine, on: On, theme: string, os?: string) => {
    engine(on)
    const clock = mock.clock(on)
    mock.env(on, os ? { HOME: '/home/me', OS: os } : { HOME: '/home/me' })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.model', () => ({ value: 'claude-sonnet-6' }))
    on('session.version', () => ({ value: { version: '2.1.300', base: '2.1.300' } }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1000, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }))
    on('session.cwd', () => ({ value: '/home/me/repo' }))
    on('session.repo', () => ({ value: null }))
    on('session.root', () => ({ value: '/home/me/repo' }))
    on('session.id', () => ({ value: 'abc' }))
    on('settings.read', () => ({ value: {} }))
    on('agent.list', () => ({ value: [] }))
    on('fs.exists', () => ({ value: false }))
    on('fs.list', () => ({ value: [] }))
    const writes: [string | undefined, string | undefined][] = []
    on('process.run', ($, e) => {
      const isWrite = e.init?.env?.STATUSBOX_OSC !== undefined
      if (isWrite) writes.push([e.init?.env?.STATUSBOX_OSC, e.init?.env?.STATUSBOX_TTY])
      const device = e.argv[0] === 'powershell' ? 'CONOUT$\r\n' : '/dev/ttys009'
      return { value: { exitCode: isWrite ? 0 : 1, stdout: isWrite ? device : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const rows = new Map<string, ConfigValue>([['theme', theme]])
    const engineRow = { label: 'Theme', kind: 'choice' as const, isLocked: false, provider: { plugin: 'engine', tier: 'core' as const } }
    on('config.list', () => ({ value: [...rows].map(([key, value]) => ({ key, value, ...engineRow })) }))
    on('config.set', ($, e) => (rows.set(e.key, e.value), { value: e.value }))
    on('session.end', ($, e) => ({ sessionId: e.sessionId }))
    await $.session.start({ cwd: '/home/me/repo', surface, isInteractive: true })
    const band = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })
    await clock.advance(0)
    // A /config row changed as the person changes it in the menu, and time
    // for the drawing, and a write to the terminal, to follow.
    const change = async (key: string, value: ConfigValue, previous: ConfigValue) => {
      const provider = key.startsWith('statusbox.') ? { plugin: 'statusbox', tier: 'user' as const } : engineRow.provider
      await $.config.set({ key, value, previous, provider, origin: { kind: 'composer' as const } })
      await clock.advance(1000)
    }
    return { clock, band, writes, change }
  }

  test(`${surface}: a skin's own theme picked in /theme repaints the box in that skin`, async ($, on) => {
    const { band, change } = await themed($, on, 'dark')
    const sonnet = async () => (await band.findAll({ type: 'Text', in: 'chip-model' })).find(text => text.props.color)?.props.color
    await change('theme', 'custom:statusbox:nord-light', 'dark')
    const nord = await sonnet()
    // Another theme gives the box classic.
    await change('theme', 'dark', 'custom:statusbox:nord-light')
    expect([nord, await sonnet()]).toEqual(['#5e81ac', '#5f9cf5'])
  })

  // On the terminal the skin paints the background behind everything, one
  // write for each colour asked for: the night's, the day's on a light theme,
  // the terminal's own with the toggle off and as the session leaves the
  // process; none for a /clear, which goes on in it.
  test(`${surface}: a skin paints the terminal's background, and leaving puts the terminal's own back`, async ($, on) => {
    const { clock, writes, change } = await themed($, on, 'custom:statusbox:tokyo-night-dark')
    await clock.advance(1000)
    await change('theme', 'custom:statusbox:tokyo-night-light', 'custom:statusbox:tokyo-night-dark')
    await change('statusbox.terminalBackground', false, true)
    await change('statusbox.terminalBackground', true, false)
    await $.session.end({ reason: 'clear', sessionId: 'abc', resume: { id: 'abc' } })
    const cleared = writes.length
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'abc', resume: { id: 'abc' } })
    const tty = '/dev/ttys009'
    expect([cleared, writes]).toEqual(
      surface === 'terminal' ? [4, [['11;#1a1b26', ''], ['11;#e1e2e7', tty], ['111', tty], ['11;#e1e2e7', tty], ['111', tty]]] : [0, []],
    )
  })

  // A write waits for the redraw a theme switch makes to pass, so as not to
  // land inside its frame; a colour replaced while it waits is never written.
  test(`${surface}: a background write waits out the redraw, and only the last colour asked for is written`, async ($, on) => {
    const { clock, writes } = await themed($, on, 'custom:statusbox:tokyo-night-dark')
    await clock.advance(1000)
    const engineRow = { plugin: 'engine', tier: 'core' as const }
    const pick = (value: string, previous: string) => $.config.set({ key: 'theme', value, previous, provider: engineRow, origin: { kind: 'composer' as const } })
    await pick('custom:statusbox:nord-dark', 'custom:statusbox:tokyo-night-dark')
    await clock.advance(30)
    await pick('custom:statusbox:dracula-dark', 'custom:statusbox:nord-dark')
    await clock.advance(30)
    const waiting = writes.length
    await clock.advance(1000)
    expect([waiting, writes.map(([osc]) => osc)]).toEqual(surface === 'terminal' ? [1, ['11;#1a1b26', '11;#282a36']] : [0, []])
  })

  // Windows has no /dev: PowerShell writes to Claude Code's console instead.
  test(`${surface}: on Windows a skin paints the background through Claude Code's console`, async ($, on) => {
    const { clock, writes } = await themed($, on, 'custom:statusbox:tokyo-night-dark', 'Windows_NT')
    await clock.advance(1000)
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'abc', resume: { id: 'abc' } })
    expect(writes).toEqual(surface === 'terminal' ? [['11;#1a1b26', ''], ['111', 'CONOUT$']] : [])
  })

  test(`${surface}: classic leaves the terminal's background alone`, async ($, on) => {
    const { clock, writes } = await themed($, on, 'dark')
    await clock.advance(1000)
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'abc', resume: { id: 'abc' } })
    expect(writes).toEqual([])
  })

  // A session on the theme given, Tokyo Night's unless named, its repo at
  // /home/me/repo.
  const skinned = async ($: Engine, on: On, theme = 'custom:statusbox:tokyo-night-dark') => {
    engine(on)
    on('config.list', () => ({ value: [{ key: 'theme', value: theme, label: 'Theme', kind: 'choice' as const, isLocked: false, provider: { plugin: 'engine', tier: 'core' as const } }] }))
    const clock = mock.clock(on)
    mock.env(on, { HOME: '/home/me' })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.model', () => ({ value: 'claude-sonnet-6' }))
    on('session.version', () => ({ value: { version: '2.1.300', base: '2.1.300' } }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1000, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }))
    on('session.cwd', () => ({ value: '/home/me/repo' }))
    on('session.repo', () => ({ value: null }))
    on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('session.root', () => ({ value: '/home/me/repo' }))
    on('session.id', () => ({ value: 'abc' }))
    on('settings.read', () => ({ value: {} }))
    on('agent.list', () => ({ value: [] }))
    on('fs.exists', () => ({ value: false }))
    on('fs.list', () => ({ value: [] }))
    // A Bash call takes 1.2 s.
    on('tool.call', async ($, e) => (e.tool === 'Bash' && (await clock.advance(1200)), { result: { stdout: '', stderr: '', interrupted: false } as never }))
    // Claude Code's own drawing of a row the plugin leaves to it.
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
    const mount = (props: ReturnType<typeof row>) => $.ui.mount({ plugin: 'statusbox', surface, component: 'ToolUse', requestId: props.tool_use_id, props })
    const textIn = async (ui: Awaited<ReturnType<typeof mount>>) => (await ui.findAll({ type: 'Text' })).filter(t => t.props.color).map(t => `${t.text}:${t.props.color}`)
    // An Edit: its name in the edit kind's colour, its file from the repo, the
    // lines it adds and takes away.
    const edit = await mount(row('Edit', { file_path: '/home/me/repo/src/a.ts', old_string: 'a\nb', new_string: 'a\nb\nc' }))
    // A Bash call, timed as it ran; one from before the plugin saw it, untimed.
    await $.tool.call({ tool: 'Bash', command: 'npm test\nmore', tool_use_id: 'toolu_bash' } as never)
    const bash = await mount(row('Bash', { command: 'npm test\nmore' }, 'toolu_bash'))
    const old = await mount(row('Read', { file_path: '/home/me/notes.md' }, 'toolu_old'))
    if (surface === 'desktop') {
      // Claude Code draws its own rows on the desktop.
      expect([await edit.find({ key: 'tool-row' }), await bash.find({ key: 'tool-row' })]).toEqual([undefined, undefined])
      return
    }
    expect(await textIn(edit)).toEqual(['●:#9ece6a', 'Edit:#9ece6a', 'src/a.ts:#c0caf5', '+3:#9ece6a', '-2:#f7768e'])
    expect(await textIn(bash)).toEqual(['●:#7aa2f7', 'Bash:#7aa2f7', 'npm test:#c0caf5', '1.2s:#565f89'])
    expect(await textIn(old)).toEqual(['●:#7dcfff', 'Read:#7dcfff', '~/notes.md:#c0caf5'])
    // Running it is hollow and says so; failed, a cross in the skin's red.
    const running = await mount({ ...row('Grep', { pattern: 'TODO', path: '/home/me/repo/src' }, 'toolu_run'), isRunning: true })
    const failed = await mount({ ...row('WebFetch', { url: 'https://example.com' }, 'toolu_bad'), isErrored: true })
    expect([await textIn(running), (await textIn(failed))[0]]).toEqual([['○:#7dcfff', 'Grep:#7dcfff', 'TODO in src:#c0caf5', 'running…:#565f89'], '✗:#f7768e'])
  })

  test(`${surface}: classic, or the toggle off, leaves the chat to Claude Code`, async ($, on) => {
    await skinned($, on, 'dark')
    const tool = await $.ui.mount({ plugin: 'statusbox', surface, component: 'ToolUse', requestId: 'toolu_1', props: row('Read', { file_path: '/x' }) })
    expect(await tool.find({ key: 'tool-row' })).toBeUndefined()
  })

  test(`${surface}: a skin with its chat toggle off leaves the chat to Claude Code`, { options: { chatSkin: false } }, async ($, on) => {
    await skinned($, on)
    const tool = await $.ui.mount({ plugin: 'statusbox', surface, component: 'ToolUse', requestId: 'toolu_1', props: row('Read', { file_path: '/x' }) })
    const prompt = await $.ui.mount({ plugin: 'statusbox', surface, component: 'UserMessage', requestId: 'm1', props: { text: 'hi', origin: { kind: 'composer' }, isExpanded: true } })
    expect([await tool.find({ key: 'tool-row' }), await prompt.find({ key: 'prompt-row' })]).toEqual([undefined, undefined])
  })

  test(`${surface}: a skinned chat outlines the person's prompt and draws a reply's tables as cards`, async ($, on) => {
    await skinned($, on)
    const prompt = await $.ui.mount({ plugin: 'statusbox', surface, component: 'UserMessage', requestId: 'm1', props: { text: 'fix the bar', origin: { kind: 'composer' }, isExpanded: true } })
    const notice = await $.ui.mount({
      plugin: 'statusbox',
      surface,
      component: 'UserMessage',
      requestId: 'm2',
      props: { text: 'task done', origin: { kind: 'task-notification' }, isExpanded: true },
    })
    // One table, then a fenced block whose lines only look like one.
    const text = ['Two runs:', '', '| run | ms |', '|-----|---:|', '| **a** | 12 |', '| b | 340 |', '', 'And the raw form:', '```', '| x | y |', '|---|---|', '```'].join('\n')
    const reply = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AssistantMessage', requestId: 'r1', props: { text, isFirstOfReply: true } })
    if (surface === 'desktop') {
      expect([await prompt.find({ key: 'prompt-row' }), await reply.find({ key: 'reply' })]).toEqual([undefined, undefined])
      return
    }
    // The prompt in a rounded outline, its mark in the accent; a notification
    // the person did not type is Claude Code's to draw.
    const outline = await prompt.find({ key: 'prompt-row' })
    expect([outline?.props.borderStyle, outline?.text, await notice.find({ key: 'prompt-row' })]).toEqual(['round', '❯ fix the bar', undefined])
    // The reply opens on the accent's bullet; its text as Claude Code draws
    // markdown, either side of the one card, the fence left as code.
    const markdown = (await reply.findAll({ type: 'Markdown' })).map(m => m.props.text)
    expect([(await reply.find({ type: 'Text', text: /^●$/ }))?.props.color, markdown]).toEqual(['#7aa2f7', ['Two runs:', 'And the raw form:\n```\n| x | y |\n|---|---|\n```']])
    // The card: its header in the accent, its rows banded, `ms` to the right,
    // the markup dropped from `a`.
    const card = await reply.find({ key: 'table-1' })
    const bands = [await reply.find({ key: 'table-1-row-0' }), await reply.find({ key: 'table-1-row-1' })].map(r => r?.props.backgroundColor)
    const head = (await reply.findAll({ type: 'Text', text: /^(run|ms)$/ })).map(t => t.props.color)
    expect([card?.props.borderStyle, bands, head, (await reply.find({ type: 'Text', text: /^a$/ }))?.text]).toEqual(['round', [undefined, '#3b4261'], ['#7aa2f7', '#7aa2f7'], 'a'])
  })

  test(`${surface}: the advisor's card takes a call as soon as the response that made it is whole`, async ($, on) => {
    engine(on)
    const clock = mock.clock(on)
    mock.env(on, { HOME: '/home/me' })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('session.version', () => ({ value: { version: '2.1.300', base: '2.1.300' } }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1000, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }))
    on('session.cwd', () => ({ value: '/home/me/repo' }))
    on('session.repo', () => ({ value: null }))
    on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('session.root', () => ({ value: '/home/me/repo' }))
    on('session.id', () => ({ value: 'abc' }))
    on('settings.read', () => ({ value: {} }))
    on('agent.list', () => ({ value: [] }))
    // The transcript gains the response that consulted the advisor.
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
    const pane = await $.ui.mount({ plugin: 'statusbox', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    const card = async () => (await pane.find({ type: 'Text', text: '✶ Fable 5.1' })) !== undefined
    expect(await card()).toBe(false)

    // The response that consulted it is whole; the turn has not ended.
    isAdvised = true
    await $.turn.start({ text: 'hi', turnId: 't1' })
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })) {
      // only the result counts
    }
    await clock.advance(0)
    expect(await card()).toBe(true)
  })

  test(`${surface}: the panel opens by itself in fullscreen only`, async ($, on) => {
    const opened: (true | undefined)[] = []
    engine(on, opened)
    const main = { columns: 160, rows: 40, isFullscreen: false }
    await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND, viewport: main })
    expect(opened).toEqual([])
    await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND, viewport: { ...main, isFullscreen: true } })
    expect(opened).toEqual([undefined])
  })

  test(`${surface}: past 85% the band offers to compact`, async ($, on) => {
    engine(on)

    await $.session.measure({
      context: { tokens: 180_000, window: 200_000, percent: 90 },
      rateLimits: [],
      changed: ['context'],
    })

    const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })

    expect(await ui.find({ key: 'compact' })).toBeDefined()
  })
}

// The alerts' child processes, by the sound each plays: on Windows the script
// reads it from its environment.
const alerts = (on: On) => {
  const ran: Record<string, string>[] = []
  on('process.run', ($, e) => (
    ran.push(e.init?.env ?? {}),
    { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  ))
  return ran
}

// A round trip through the engine, which lets work a hook left running go on.
const tick = ($: { telemetry: { log: (e: ReturnType<typeof apiRequest>) => Promise<unknown> } }) =>
  $.telemetry.log(apiRequest({ query_source: 'sdk', cost_usd: 0 }))

test('alerts: a permission request, a finished turn and compaction each raise one; a paused turn none', async ($, on) => {
  engine(on)
  mock.env(on, { HOME: '/home/me', OS: 'Windows_NT' })
  const ran = alerts(on)
  // The child is started off the hook's path; each look lets it go on.
  const settle = async (n: number) => {
    for (let i = 0; i < 50 && ran.length < n; i++) await tick($)
  }
  const running = [{ id: 't1', type: 'local_agent', status: 'running', description: 'explore' }]

  await $.classic.PermissionRequest({ tool_name: 'Edit', tool_input: { file_path: '/repo/src/a.ts' }, cwd: '/repo' })
  await settle(1)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: running })
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  await settle(2)
  await $.classic.PreCompact({ trigger: 'auto', custom_instructions: null })
  await settle(3)

  expect(ran.map(env => env.STATUSBOX_SOUND)).toEqual(['Windows Exclamation.wav', 'chimes.wav', 'Windows Battery Low.wav'])
})

test('alerts: the context alert re-arms below its threshold, the rate alert when its window resets', async ($, on) => {
  engine(on)
  mock.env(on, { HOME: '/home/me', OS: 'Windows_NT' })
  const ran = alerts(on)
  // The sounds played by the end of each reading: the context at 75, the rate
  // at 85, the context again at 71 once it fell below, the rate in a new window.
  const heard: number[] = []
  const readings: [number, number, string][] = [[75, 10, 'A'], [76, 10, 'A'], [60, 85, 'A'], [71, 90, 'A'], [71, 85, 'B']]
  for (const [percent, used, resetsAt] of readings) {
    await $.session.measure({
      context: { tokens: percent, window: 100, percent },
      rateLimits: [{ kind: 'five_hour', percentUsed: used, resetsAt }],
      changed: ['context', 'rateLimits'],
    })
    for (let i = 0; i < 20; i++) await tick($)
    heard.push(ran.length)
  }
  expect(heard).toEqual([1, 1, 2, 3, 4])
  expect(new Set(ran.map(env => env.STATUSBOX_SOUND))).toEqual(new Set(['Windows Battery Critical.wav']))
})

test('alerts: with sounds off nothing starts', { options: { sounds: false } }, async ($, on) => {
  engine(on)
  mock.env(on, { HOME: '/home/me', OS: 'Windows_NT' })
  const ran = alerts(on)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  for (let i = 0; i < 20; i++) await tick($)
  expect(ran).toEqual([])
})
