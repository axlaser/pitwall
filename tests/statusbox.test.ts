import type { AgentStatus, On, PromptEditInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The engine's own answers, which the kit leaves to the test.
// `opened` collects each pane open's `focus`.
const engine = (on: On, opened?: (true | undefined)[]) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.turns', () => ({ value: 3 }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('telemetry.log', () => ({ value: undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', ($, e) => (opened?.push(e.focus), { value: { isPlaced: true as const } }))
  for (const event of ['PermissionRequest', 'Stop', 'PreCompact', 'PostCompact'] as const) on(`classic.${event}`, () => ({}))
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

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 140,
  scroll: { offset: 0, bodyRows: 19 },
  view: {},
}

const PANE = {
  title: 'sessions',
  isFocused: false,
  bodyColumns: 40,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the band draws the measured context and the last turn's tokens`, async ($, on) => {
    engine(on)
    const clock = mock.clock(on)

    await $.session.measure({
      context: { tokens: 84_000, window: 200_000, percent: 42 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 23 }],
      cost: { usd: 0.1234 },
      changed: ['context', 'rateLimits', 'cost'],
    })
    // The wait ends at the turn's first main-loop row that shows: not its
    // thinking, not a subagent's row, and a later row does not move it.
    await $.turn.start({ text: 'hi', turnId: 't1' })
    await clock.advance(3000)
    await $.session.append(responseRow('text', 'a1'))
    await $.session.append(responseRow('thinking'))
    await clock.advance(4300)
    await $.session.append(responseRow('text'))
    await clock.advance(2000)
    await $.session.append(responseRow('tool_use'))
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

    for (const text of ['42%', '84.0K', '/200K', '$0.1234', '(+2.7K)', '1 message', '5h', 'first output 7.3s · reply 15s']) {
      expect((await ui.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)
    }
    expect(await ui.find({ key: 'compact' })).toBeUndefined()
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
    engine(on)
    mock.clock(on)
    const set: Record<string, string> = dir === '/cfg' ? { CLAUDE_CONFIG_DIR: dir } : {}
    mock.env(on, os === 'Windows_NT' ? { HOME: '/home/me', OS: os, ...set } : { HOME: '/home/me', ...set })
    // The engine hands a hook an fs path resolved for the platform.
    const ends = (path: string, tail: string) => path.replace(/\\/g, '/').endsWith(tail)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
    on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
    on('session.version', () => ({ value: { version: '2.1.299', base: '2.1.299' } }))
    on('session.cwd', () => ({ value: '/home/me/repo' }))
    on('session.root', () => ({ value: '/home/me/repo' }))
    on('session.id', () => ({ value: 'abc' }))
    on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
    on('agent.list', () => ({ value: [] }))
    // One message written as two lines (thinking, then text) that consulted the
    // advisor once, one subagent row, and a torn last line.
    const advice = { type: 'advisor_message', model: 'claude-fable-5-1', input_tokens: 1000, output_tokens: 100 }
    const usage = { input_tokens: 100, output_tokens: 7, iterations: [{ type: 'message' }, advice] }
    const row = (id: string, extra = {}) => JSON.stringify({ type: 'assistant', ...extra, message: { id, usage } })
    // Past fs.read's 4 MiB the transcript streams through `cat`, or `findstr` on
    // Windows, its pieces cut mid-line; the engine resolves an fs path for the
    // platform before a hook sees it, but not a child's argv.
    on('fs.read', ($, e) => ({
      value: ends(e.path, `${dir === '/cfg' ? '/cfg' : '/home/me'}/.claude.json`) ? config : isTranscript(e.path) && size <= 4 * 1024 * 1024 ? transcript : '',
    }))
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
    on('fs.list', () => ({
      value: ['someone-else', folder].map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })),
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
    const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })

    for (const text of ['~/repo', 'main', '↑2', '+5', '-1', '~1', 'Opus 5.5', 'v2.1.299', '┏━', '┣━', '┼', '1 message']) {
      expect((await ui.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)
    }
    expect(await ui.find({ type: 'Text', text: 'xhigh effort', in: 'effort' })).toBeDefined()

    // Every line of the frame is the same number of cells, controls included,
    // so a ragged right edge on screen is the terminal's drawing, not the mod's.
    const cells = (node: unknown): number => {
      if (typeof node === 'string') return [...node].length
      const el = node as { type?: string; props?: { width?: number }; children?: unknown[] }
      if (el.type === 'Client') return el.props?.width ?? 0
      return (el.children ?? []).reduce((n: number, child) => n + cells(child), 0)
    }
    const lines = ((await ui.drawn()) as { children: unknown[] }).children.filter(Boolean)
    expect(new Set(lines.map(cells)).size).toBe(1)
    // Seeded from the transcript: m1 once, the subagent's row and the torn line left out.
    expect(await ui.find({ type: 'Text', text: 'in 100 (+0)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'out 7 (+0)' })).toBeDefined()
    // The advisor's calls: Fable 5.1's from the table and Fable 6's from
    // ~/.claude.json, each $10 / $50 on 1,000 in and 100 out: $0.0150 apiece.
    expect(await ui.find({ type: 'Text', text: 'Fable 6 · 2 calls · in 2.0K · out 200 · $0.0300' })).toBeDefined()

    // A left click steps round the levels, max to low; a right click does nothing.
    const chip = async () => (await ui.find({ type: 'Text', in: 'effort' }))?.text
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'effort' })
    expect(await chip()).toBe('max effort')
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'effort' })
    expect(await chip()).toBe('low effort')
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'right', in: 'effort' })
    expect(await chip()).toBe('low effort')
    // No command ran: the pick goes out on the next request instead.
    expect(ran).toEqual([])
    expect(await step('xhigh')).toBe('low')
    // A level the person set since (/effort high) wins and clears the pick.
    expect(await step('high')).toBe('high')
    expect(await chip()).toBe('high effort')

    await ui.press({ key: 'version' })
    await ui.press({ key: 'repo' })
    expect(opened.map(argv => argv.at(-1))).toEqual([
      'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md',
      'https://github.com/me/repo',
    ])
  })

  test(`${surface}: the spend row splits the cost by who asked, from the engine's request records`, async ($, on) => {
    engine(on)
    const record = (query_source: string, cost_usd: number) => $.telemetry.log(apiRequest({ query_source, cost_usd }))
    await record('repl_main_thread', 0.25)
    await record('agent:builtin:Explore', 0.1)
    await record('auto_mode', 0.01)
    await $.telemetry.log({ to: 'collector', event: 'tool_result', attributes: { cost_usd: 9 }, loggedAt: '2026-10-14T00:00:00.000Z' })
    // The ledger also holds $0.04 from before the mod saw this process.
    await $.session.measure({ context: { tokens: 1, window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 0.4 }, changed: ['cost'] })

    const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })

    const text = 'main $0.2500 · agents $0.1000 · background $0.0100 · earlier $0.0400'
    expect((await ui.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)
  })

  test(`${surface}: the bar glides to the reading and Claude squiggles while it works`, async ($, on) => {
    engine(on)
    await $.session.measure({ context: { tokens: 84_000, window: 200_000, percent: 42 }, rateLimits: [], changed: ['context'] })
    const working = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: { ...BAND, isWorking: true } })
    const has = async (ui: typeof working, text: string, at: string) => ((await ui.find({ type: 'Text', text, in: at })) ? text : `missing: ${text}`)

    // From empty to 42 % of 30 cells, 12.6: twelve full and half of one.
    expect(await has(working, '━━━━', 'bar')).toBe('missing: ━━━━')
    await working.advance(3000)
    expect(await has(working, '╾', 'bar')).toBe('╾')
    // The spark turns a glyph a tick: ✢ on the first, ✻ on the third.
    await working.advance(120 - (3000 % 120))
    // The first frame is a `·` too, so the turning glyphs are looked for.
    const spark = async () => (await Promise.all(['✢', '✶', '✻', '✽'].map(g => has(working, g, 'claude')))).find(g => !g.startsWith('missing'))
    const first = await spark()
    await working.advance(240)
    expect(await spark()).not.toBe(first)

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
    expect(await busy.find({ type: 'Text', text: 'working', in: 'working-a1' })).toBeDefined()
    await busy.unmount()
    status = 'completed'
    await $.turn.complete({ answer: 'done', durationMs: 70_000, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })

    const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    for (const text of ['✓ done', 'Explore', 'Org pricing', '1m10s', 'Opus 5.5 · xhigh', '42.0K context · 6.0K out', '$0.3500']) {
      expect((await ui.find({ type: 'Text', text })) ? text : `missing: ${text}`).toBe(text)
    }
    // The box above the prompt no longer carries agents.
    const band = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ type: 'Text', text: 'Org pricing' })).toBeUndefined()
  })

  test(`${surface}: the panel's tabs switch sessions with /resume, and name one another terminal holds`, async ($, on) => {
    engine(on)
    mock.clock(on)
    mock.env(on, { HOME: '/home/me', OS: 'Windows_NT' })
    on('session.root', () => ({ value: 'C:\\repo' }))
    on('session.id', () => ({ value: 's1' }))
    const file = (name: string, mtimeMs: number, size = 5000) => ({ name, kind: 'file' as const, size, mtimeMs, isLink: false })
    // Three conversations and a bridge stub; two running sessions, this one and
    // one in another terminal.
    on('fs.list', ($, e) => ({
      value: e.path.endsWith('sessions')
        ? [file('100.json', 0), file('200.json', 0)]
        : [file('s1.jsonl', 3000), file('s2.jsonl', 2000), file('s3.jsonl', 1000), file('stub.jsonl', 4000, 200)],
    }))
    const record = (sessionId: string, cwd: string, status: string) => JSON.stringify({ sessionId, cwd, kind: 'interactive', status, updatedAt: 1 })
    on('fs.read', ($, e) => ({ value: e.path.endsWith('100.json') ? record('s1', 'C:\\repo', 'busy') : record('s3', 'C:\\other', 'idle') }))
    // findstr names each file before the rows it found there; a /rename wins.
    const dir = 'C:\\home\\me\\.claude\\projects\\C--repo'
    const found = [
      `${dir}\\s1.jsonl:{"type":"ai-title","aiTitle":"Old name"}`,
      `${dir}\\s1.jsonl:{"type":"custom-title","customTitle":"Mod work"}`,
      `${dir}\\s2.jsonl:{"type":"ai-title","aiTitle":"Fix the leak"}`,
    ]
    on('process.run', () => ({ value: { exitCode: 0, stdout: found.join('\r\n'), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    const ran: string[] = []
    on('command.run', ($, e) => (ran.push(`${e.command} ${e.args}`), { text: '' }))
    const toasts: string[] = []
    on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))

    await $.command.run({ command: 'sidebar', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'Pane', requestId: 'sidebar', props: PANE })
    for (const text of ['1 Mod work', '2 Fix the leak', '3 s3', 'idle', 'other']) {
      expect((await ui.find({ type: 'Button', text })) ? text : `missing: ${text}`).toBe(text)
    }
    expect(await ui.find({ key: 'tab-stub' })).toBeUndefined()

    await ui.press({ key: 'tab-s2' })
    await ui.press({ key: 'tab-s1' })
    await ui.press({ key: 'tab-s3' })
    await ui.press({ key: 'new' })
    expect(ran.filter(r => r !== 'sidebar ')).toEqual(['resume s2', 'clear '])
    expect(toasts).toEqual(['That session is open in another terminal (other)'])
  })

  // Raster is the terminal's alone; the desktop draws no preview.
  if (surface === 'terminal') test(`${surface}: a pasted screenshot shows above the box until its placeholder goes`, async ($, on) => {
    engine(on)
    mock.env(on, { HOME: '/home/me', OS: 'Windows_NT', TEMP: 'C:\\Temp' })
    on('session.id', () => ({ value: 'abc' }))
    let draft = 'look '
    on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
    on('prompt.edit', () => ({ text: draft, cursor: draft.length }))
    // The thumbnailer's answer: one cell's 2×2 pixels, BGR rows padded to 8
    // bytes, red on the left and blue on the right.
    const ran: string[][] = []
    on('process.run', ($, e) => (ran.push([...e.argv]), {
      value: { exitCode: 0, stdout: '1 1 8 AAD//wAAAAAAAP//AAAAAA==', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))
    const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })
    // The capture runs off the hook's path; each look lets it move on.
    const settle = async (want: boolean) => {
      let isShown = Boolean(await ui.find({ key: 'image-1' }))
      for (let i = 0; i < 50 && isShown !== want; i++) isShown = Boolean(await ui.find({ key: 'image-1' }))
      return isShown
    }
    const edit = (e: PromptEditInput) => ($.prompt as unknown as { edit: (e: PromptEditInput) => Promise<unknown> }).edit(e)

    draft = 'look [Image #1] '
    await edit({ origin: { kind: 'composer' }, text: 'look ', cursor: 5, start: 5, end: 5, inputText: '[Image #1] ' })
    expect(await settle(true)).toBe(true)
    // ▌ in red on blue.
    expect((await ui.find({ key: 'image-1' }))?.props.cells).toBe('jCUAAAAA/wD/AAAA')
    expect((await ui.find({ key: 'open-image-1' }))?.text).toBe('#1 open ↗')
    expect(ran.filter(argv => argv[0] === 'powershell').length).toBe(1)

    draft = 'look '
    await edit({ origin: { kind: 'composer' }, text: 'look [Image #1] ', cursor: 16, start: 5, end: 16, inputText: '' })
    expect(await settle(false)).toBe(false)
  })

  // shortcut: the kit raises no person's close, so the gate that keeps a
  // closed panel shut across reloads goes untested here.
  test(`${surface}: the box's sessions control opens the panel with the keyboard`, async ($, on) => {
    const opened: (true | undefined)[] = []
    engine(on, opened)
    mock.env(on, { HOME: '/home/me' })
    on('session.root', () => ({ value: '/home/me/repo' }))
    on('session.id', () => ({ value: 's1' }))

    const ui = await $.ui.mount({ plugin: 'statusbox', surface, component: 'AbovePrompt', props: BAND })
    expect((await ui.find({ key: 'panel' }))?.text).toBe('sessions ›')
    await ui.press({ key: 'panel' })
    expect(opened).toEqual([true])
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

// The alerts' child processes, by what each would show: on Windows the script
// reads the message and the sound from its environment.
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

  expect(ran.map(env => [env.STATUSBOX_MESSAGE, env.STATUSBOX_SOUND])).toEqual([
    ['Edit: src/a.ts', 'Windows Exclamation.wav'],
    ['Finished working', 'chimes.wav'],
    ['Compacting context...', 'Windows Battery Low.wav'],
  ])
})

test('alerts: the context alert re-arms below its threshold, the rate alert when its window resets', async ($, on) => {
  engine(on)
  mock.env(on, { HOME: '/home/me', OS: 'Windows_NT' })
  on('session.cwd', () => ({ value: '/repo' }))
  const ran = alerts(on)
  const readings: [number, number, string][] = [[75, 10, 'A'], [76, 10, 'A'], [60, 85, 'A'], [71, 90, 'A'], [71, 85, 'B']]
  for (const [percent, used, resetsAt] of readings) {
    await $.session.measure({
      context: { tokens: percent, window: 100, percent },
      rateLimits: [{ kind: 'five_hour', percentUsed: used, resetsAt }],
      changed: ['context', 'rateLimits'],
    })
    for (let i = 0; i < 20; i++) await tick($)
  }
  expect(ran.map(env => env.STATUSBOX_MESSAGE)).toEqual(['Context window at 75%', 'Rate limit at 85%', 'Context window at 71%', 'Rate limit at 85%'])
})

test('alerts: with toasts and sounds both off nothing starts', { options: { toasts: false, sounds: false } }, async ($, on) => {
  engine(on)
  mock.env(on, { HOME: '/home/me', OS: 'Windows_NT' })
  const ran = alerts(on)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  for (let i = 0; i < 20; i++) await tick($)
  expect(ran).toEqual([])
})
