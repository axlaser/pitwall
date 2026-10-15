import type { AgentStatus, On, PromptEditInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The engine's own answers, which the kit leaves to the test.
// `opened` collects each pane open's `focus`; the store it keeps is returned.
const engine = (on: On, opened?: (true | undefined)[], turns = () => 3) => {
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
  on('ui.close', ($, e) => (panes.delete(e.id), { value: undefined }))
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  for (const event of ['PermissionRequest', 'Stop', 'PreCompact', 'PostCompact', 'PostModelSwitch'] as const) on(`classic.${event}`, () => ({}))
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
  title: 'sidebar',
  isFocused: false,
  bodyColumns: 40,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

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

    for (const text of ['~/repo', 'main', '↑2', '+5', '-1', '~1', 'Opus 5.5', '┏━', '┣━', '┼']) {
      expect((await ui.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)
    }
    expect(await ui.find({ key: 'n-messages' })).toBeUndefined()
    expect((await ui.find({ key: 'effort' }))?.text).toBe('xhigh effort')

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
    const chip = async () => (await ui.find({ key: 'effort' }))?.text
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
    // level is still to come. Settled, the level in force is lit as one pill,
    // glyph and name in one colour.
    await clock.advance(952)
    expect([await isOffered('pick-effort-max'), (await pill('max'))?.text?.trim()]).toEqual([true, ''])
    await ui.advance(1200)
    expect([(await pill('xhigh'))?.props.inverse, (await pill('xhigh'))?.text, (await pill('low'))?.props.inverse]).toEqual([true, ' ✸ xhigh ', undefined])
    // Under the pointer a level lights the same way and plays its flourish
    // again: max flares through red, yellow and white, low keeps its gray.
    // Looked at each 30 ms tick of pill.tsx.
    const flare = async (level: string) => {
      await ui.pointer({ type: 'enter', x: 0, y: 0, in: `pick-effort-${level}` })
      const colors = new Set<string>()
      for (let t = 0; t < 1200; t += 30) colors.add(await ui.advance(30).then(async () => (await pill(level))?.props.color as string))
      const text = (await pill(level))?.text
      await ui.pointer({ type: 'leave', x: 0, y: 0, in: `pick-effort-${level}` })
      return { colors: [...colors].sort(), text }
    }
    expect([await flare('max'), await flare('low')]).toEqual([
      { colors: ['red', 'white', 'yellow'], text: ' ✹ max ' },
      { colors: ['gray'], text: ' · low ' },
    ])
    expect((await pill('max'))?.props.inverse).toBeUndefined()
    // A click on a pill picks its level, lit in place of the one in force,
    // with a confirm after the row, which has room for it where it stands;
    // nothing is applied yet.
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'pick-effort-max' })
    const confirm = async () => (await ui.find({ key: 'confirm' }))?.text
    expect([await chip(), (await pill('max'))?.props.inverse, (await pill('xhigh'))?.props.inverse, await confirm()]).toEqual(['xhigh effort', true, undefined, ' ✓ Confirm '])
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
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'pick-effort-low' })
    await ui.press({ key: 'confirm' })
    await unfold()
    expect(await chip()).toBe('low effort')
    expect(await isOffered('pick-effort-max')).toBe(false)
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'chevron-effort' })
    await unfold()
    expect(await isOffered('pick-effort-max')).toBe(true)
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'chevron-effort' })
    await unfold()
    expect(await isOffered('pick-effort-max')).toBe(false)
    // Opened again while it rolls shut, it rolls back down from where it stood:
    // its choices gone by then, the wire's row still there.
    const chevron = () => ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'chevron-effort' })
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
    const fromChip = middle(unrolled.lines[wireRow - 1], 'model', (await label('model')) ?? '')
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
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'pick-model-sonnet' })
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
    // Opus, in force, clicked again takes the pick back, and the confirm goes.
    // Sonnet again, and its confirm sets the Model row.
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'pick-model-opus' })
    expect(await isOffered('confirm')).toBe(false)
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'pick-model-sonnet' })
    await ui.press({ key: 'confirm' })
    expect(sets).toEqual([['model', 'sonnet']])
    await unfold()
    expect(await isOffered('pick-model-opus')).toBe(false)
    // On a 1M session the 1M aliases stand in, so a pick keeps the window.
    await ui.press({ key: 'model' })
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
    const fromEffort = middle(glided.lines[glided.at - 1], 'effort', (await label('effort')) ?? '')
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
    const fold = () => pane.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'fold-USAGE' })
    // The heights a folding body and its card are held to, outermost first;
    // none while it rests.
    const heldTo = (node: unknown): number[] => {
      const el = node as { props?: { overflow?: string; height?: number }; children?: unknown[] }
      const inner = (el?.children ?? []).flatMap(heldTo)
      return el?.props?.overflow === 'hidden' ? [el.props.height ?? -1, ...inner] : inner
    }
    expect([await pane.find({ key: 'n-usage-five_hour' }) !== undefined, heldTo(await pane.drawn())]).toEqual([true, []])
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

    // The body folds a row a beat: whole until then, one beat in its five
    // rows (the card's gap and border, the window's name and bar) are four,
    // the card's border kept round the three left to it.
    expect(await clicked()).toEqual(['5,4', '4,3'])
    await clock.advance(300)
    expect([await pane.find({ key: 'n-usage-five_hour' }), heldTo(await pane.drawn())]).toEqual([undefined, []])
    // The rule sweeps out, the summary waiting at its end.
    await pane.advance(500)
    expect(await pane.find({ type: 'Text', text: ' 5-hour 23%', in: 'fold-USAGE' })).toBeDefined()
    expect(kept.get('folded')).toEqual(['USAGE'])

    // It unfolds the same way, from nothing, and rests at its own height: a
    // beat in only its gap shows, the card, never less than its border, cut
    // below it.
    expect(await clicked()).toEqual(['0,2', '1,2'])
    await clock.advance(300)
    expect([await pane.find({ key: 'n-usage-five_hour' }) !== undefined, heldTo(await pane.drawn())]).toEqual([true, []])
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
    // Frame after frame the spark keeps the middle of its three cells.
    for (let i = 0; i < 8; i++) {
      await working.advance(120)
      const cells = [...((await working.find({ type: 'Text', in: 'claude' }))?.text ?? '')]
      expect(['·', '✢', '✶', '✻', '✽'].includes(cells[1] ?? '') ? 'middle' : cells.join('')).toBe('middle')
    }
    // A glow sweeps the spark and on over `Working`, Claude's accent washed
    // toward white, a cell a 60 ms tick. Over one sweep (its eleven cells and
    // eight more) the first letter brightens to the glow's middle and fades
    // back, and the glow's middle passes the spark and every letter.
    const lit = new Set<string>()
    const brightest: string[] = []
    for (let i = 0; i < 19; i++) {
      await working.advance(60)
      lit.add((await working.find({ type: 'Text', text: /^W$/, in: 'claude' }))?.props.color as string)
      for (const cell of await working.findAll({ type: 'Text', in: 'claude' })) if (cell.props.color === '#f5ddd5') brightest.push(cell.text ?? '')
    }
    expect([...lit].sort()).toEqual(['#dc876b', '#e3a089', '#ebbbab', '#f5ddd5', 'claude'])
    const letters = brightest.filter(text => /^[A-Za-z]$/.test(text))
    expect([letters.sort().join(''), brightest.some(text => ['·', '✢', '✶', '✻', '✽'].includes(text))]).toEqual([[...'Working'].sort().join(''), true])

    const idle = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })
    expect(await has(idle, 'ready', 'claude')).toBe('ready')
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
    engine(on, opened)
    mock.env(on, { HOME: '/home/me' })
    on('session.root', () => ({ value: '/home/me/repo' }))
    on('session.id', () => ({ value: 's1' }))

    const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })
    const chevron = async () => (await ui.find({ type: 'Text', in: 'chevron-panel' }))?.text
    expect((await ui.find({ key: 'panel' }))?.text).toBe('sidebar')
    expect(await chevron()).toBe(' ›')

    // The keyboard opens it; the chevron turns through to face the panel's way.
    await ui.press({ key: 'panel' })
    expect(opened).toEqual([true])
    await ui.advance(60)
    expect(await chevron()).toBe(' >')
    await ui.advance(500)
    expect(await chevron()).toBe(' ‹')

    // Again closes it, and it turns back.
    await ui.press({ key: 'panel' })
    await ui.advance(500)
    expect(await chevron()).toBe(' ›')

    // A click on the chevron itself opens it once more.
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'chevron-panel' })
    expect(opened).toEqual([true, true])
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
    await ui.press({ key: 'model' })
    await clock.advance(1000)
    const row = async () => (await lines()).find(line => cellsTo(line, 'pick-model-default') >= 0)
    const unmoved = cellsTo(await row(), 'pick-model-default')

    // A pick: no room for its confirm where the row stands, so the row slides
    // left a cell a beat on the hooks' clock, and the confirm shows once it
    // has made room, two cells after the last choice, the frame as wide as ever.
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'pick-model-sonnet' })
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
    expect([await figure('out'), await ui.find({ key: 'effort' })]).toEqual(['0', undefined])

    isLoaded = true
    await clock.advance(1000)
    await ui.advance(3000)
    expect([await figure('out'), await figure('cacheRead'), (await ui.find({ key: 'effort' }))?.text]).toEqual(['20', '300', 'high effort'])
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
