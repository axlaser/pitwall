import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage, TurnStepInput } from 'claude-code'

import type { Advisor, Agent, Alerted, Git, Place, Preview, RateWindow, Reading, Speed, Spend, Tokens } from '../types'
import { figure, formatElapsed } from './count'
import type { Figure } from './count'
import { notify, permissionMessage } from './notify'
import type { Delivery } from './notify'

// The claude-statusline box, rebuilt on events instead of a process per tick:
// every event writes an atom, the one AbovePrompt hook reads them, and a write
// redraws exactly that band. The drawing is src/render.rs's, span for span.

type $ = EngineInterface

const ZERO: Tokens = { in: 0, cacheWrite: 0, cacheRead: 0, out: 0 }
const reading = atom({ plugin: 'statusbox', key: 'reading' } as const, null)
const meta = atom({ plugin: 'statusbox', key: 'meta' } as const, null)
const place = atom({ plugin: 'statusbox', key: 'place' } as const, null)
const totals = atom({ plugin: 'statusbox', key: 'totals' } as const, ZERO)
const last = atom({ plugin: 'statusbox', key: 'last' } as const, ZERO)
const advisor = atom({ plugin: 'statusbox', key: 'advisor' } as const, null)
const override = atom({ plugin: 'statusbox', key: 'override' } as const, null)
const turns = atom({ plugin: 'statusbox', key: 'turns' } as const, 0)
const agents = atom({ plugin: 'statusbox', key: 'agents' } as const, [])
const NO_SPEND: Spend = { main: 0, agents: 0, background: 0 }
const spend = atom({ plugin: 'statusbox', key: 'spend' } as const, NO_SPEND)
const NO_SPEED: Speed = { firstOutputMs: null, replyMs: null }
const speed = atom({ plugin: 'statusbox', key: 'speed' } as const, NO_SPEED)
const previews = atom({ plugin: 'statusbox', key: 'previews' } as const, [] as Preview[])
const now = atom({ plugin: 'statusbox', key: 'now' } as const, 0)
// Set when the person closes the panel, so a reload does not open it again.
const panelClosed = atom({ plugin: 'statusbox', key: 'panelClosed' } as const, false)
// Which threshold alerts have fired, so each fires once until it re-arms.
const NOT_ALERTED: Alerted = { context: false, rate: false, resetsAt: null }
const alerted = atom({ plugin: 'statusbox', key: 'alerted' } as const, NOT_ALERTED)

const CHANGELOG = 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md'
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const PANE = 'sidebar'
const PANE_COLUMNS = 40
const ENDED_SHOWN = 5
const ENDED = new Set(['completed', 'failed', 'killed'])
const RATE: Record<string, [string, number]> = { five_hour: ['5h', 18_000], seven_day: ['7d', 604_800] }
// $/MTok in Claude Code's own price shape (ModelCosts). Its catalog is compiled
// in, so the models it knows are copied from it here (2.1.299's tiers);
// a model newer than the binary is priced from what Claude Code fetched into
// ~/.claude.json. shortcut: neither has the long-prompt tier or the ×1.1 for
// US-only inference; a model in neither shows tokens with no dollars.
type Price = {
  inputTokens: number
  outputTokens: number
  promptCacheWriteTokens: number
  promptCacheWrite1hTokens?: number
  promptCacheReadTokens: number
  longPrompt?: Price & { abovePromptTokens: number }
}
const ADVISOR_PRICE: Record<string, Price> = {
  'claude-fable-5-1': { inputTokens: 10, outputTokens: 50, promptCacheWriteTokens: 12.5, promptCacheWrite1hTokens: 20, promptCacheReadTokens: 0.25 },
  'claude-opus-5-5': { inputTokens: 4, outputTokens: 20, promptCacheWriteTokens: 5, promptCacheWrite1hTokens: 8, promptCacheReadTokens: 0.2 },
}
let newerPrices: Record<string, Price> = {}
let priceRemap: Record<string, string> = {}
let orgPricing: { multiplier: number; overrides: Record<string, Price> } | null = null
const LABEL_W = 7
const BAR_WIDTH = 30
const MIN_INNER = 30

export const register: Register = (on, options) => {
  // The /config rows (plugin.json's userConfig); 0 turns a threshold alert off.
  const delivery: Delivery = { toasts: options.toasts !== false, sounds: options.sounds !== false }
  const limits = { context: Number(options.contextAlert ?? 70), rate: Number(options.rateLimitAlert ?? 80) }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const [usage, model, version, settings, n, t] = await Promise.all([
      $.session.usage(),
      $.session.model(),
      $.session.version(),
      $.settings.read(),
      $.session.turns(),
      $.clock.now(),
    ])
    const setEffort = (settings as Record<string, unknown>).effortLevel
    // A reload keeps what turn.step learned: the resolved id beats /model's label.
    await update($, meta, m => ({
      model: m?.model ?? model,
      effort: m?.effort ?? (typeof setEffort === 'string' ? setEffort : null),
      sessionEffort: m?.sessionEffort ?? null,
      version: version.base ?? version.version,
      startedAt: usage.startedAt,
    }))
    await update($, reading, () => toReading(usage))
    await update($, turns, () => n)
    await update($, now, () => t)
    await refreshPlace($)
    await refreshAgents($)
    await readPrices($)
    await $.command.register({ name: 'sidebar', description: "Open the panel of this session's agents" })
    const scan = await readTranscript($)
    if (scan) {
      await update($, totals, () => scan.main)
      await update($, advisor, () => scan.advisor)
      await update($, turns, () => scan.prompts)
    }
    $.clock.every(1000, () => {
      void $.clock.now().then(t => update($, now, () => t))
      // An image pasted in a way prompt.edit does not report is still caught.
      void syncPreviews($)
    })
    return r
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      const t = await $.clock.now()
      await update($, totals, () => ZERO)
      await update($, last, () => ZERO)
      await update($, advisor, () => null)
      await update($, override, () => null)
      await update($, turns, () => 0)
      await update($, spend, () => NO_SPEND)
      await update($, speed, () => NO_SPEED)
      await update($, meta, m => m && { ...m, startedAt: t })
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const r = toReading(e)
    await update($, reading, () => r)
    void checkThresholds($, r, limits, delivery).catch(() => undefined)
    return next(e)
  })

  // The alerts the binary's settings hooks raised, on the same events; each
  // passes on untouched, its alert raised beside it.
  on('classic.PermissionRequest', async ($, e, next) => {
    void notify($, 'permission', permissionMessage(e.tool_name, e.tool_input, e.cwd), delivery, e.cwd)
    return next(e)
  })
  on('classic.Stop', async ($, e, next) => {
    // A turn that ends while a subagent runs is only paused: Claude Code goes
    // on when it reports back, so alerting now would be false and then twice.
    const pending = e.background_tasks
    if (!(Array.isArray(pending) && pending.length > 0)) void notify($, 'stop', 'Finished working', delivery, e.cwd)
    return next(e)
  })
  on('classic.PreCompact', async ($, e, next) => {
    void notify($, 'compaction_start', 'Compacting context...', delivery, e.cwd)
    return next(e)
  })
  on('classic.PostCompact', async ($, e, next) => {
    void notify($, 'compaction_done', 'Context compacted', delivery, e.cwd)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      await refreshAgents($)
    } else {
      // A new turn's speed replaces the last one's as it becomes known.
      turnStartedAt = await $.clock.now()
      await update($, speed, () => NO_SPEED)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const model = e.model
    const effort = e.effort === undefined ? null : String(e.effort)
    const id = e.agentId
    let sent = e
    if (id === undefined) {
      // The chip's pick goes out on each main-loop request: a hook's effort is
      // the engine's first choice, ahead of the session's and the env's, and
      // unlike /effort it changes no state the whole screen redraws for.
      const m = await read($, meta)
      let pick = await read($, override)
      // A level the person set themselves since (/effort, /model) wins.
      if (pick !== null && m?.sessionEffort != null && effort !== m.sessionEffort) {
        await update($, override, () => null)
        pick = null
      }
      if (pick !== null && e.effort !== undefined) sent = { ...e, effort: pick as TurnStepInput['effort'] }
      await update($, meta, x => x && { ...x, model, sessionEffort: effort, effort: pick ?? effort })
    } else {
      await update($, agents, list => list.map(a => (a.id === id ? { ...a, model, effort } : a)))
    }
    const result = yield* next(sent)
    if (id !== undefined && result.usage) {
      const u = result.usage
      const key = usageKey(u.input_tokens, u.output_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens)
      const usd = unmatchedCosts.get(key)
      if (usd === undefined) remember(unmatchedSteps, key, id)
      else unmatchedCosts.delete(key)
      const prompt = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      await update($, agents, list =>
        list.map(a => (a.id === id ? { ...a, context: prompt, out: a.out + u.output_tokens, usd: a.usd + (usd ?? 0) } : a)),
      )
    }
    // session.measure fires once per turn; the binary redrew mid-turn, so read
    // the figures again after every main-loop request.
    if (id === undefined) await refreshReading($)
    if (result.serverToolUses?.some(use => use.name === 'advisor')) isAdvisorPending = true
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) {
      await refreshAgents($)
      return r
    }
    await update($, speed, x => ({ ...x, replyMs: e.durationMs }))
    if (e.usage) {
      const u = e.usage
      const turn: Tokens = {
        in: u.input_tokens,
        cacheWrite: u.cache_creation_input_tokens,
        cacheRead: u.cache_read_input_tokens,
        out: u.output_tokens,
      }
      await update($, last, () => turn)
      await update($, totals, t => add(t, turn))
    }
    scheduleGit($)
    await refreshReading($)
    // The API reports an advisor call's tokens nowhere but the transcript, so
    // it is read again only after a turn that consulted one.
    if (isAdvisorPending) {
      isAdvisorPending = false
      const scan = await readTranscript($)
      if (scan) await update($, advisor, () => scan.advisor)
    }
    return r
  })

  // The effort chip: a click steps round the levels, ← and → step and stop at
  // the ends. The pick is the mod's alone, for this session: nothing is saved
  // and no command runs, so the screen does not redraw and history stays clean.
  on('ui.message', { element: 'effort' }, async ($, e, next) => {
    const data = (e.data ?? {}) as { step?: unknown; wrap?: unknown }
    const step = data.step === -1 ? -1 : 1
    const m = await read($, meta)
    const found = LEVELS.indexOf(m?.effort ?? '')
    const at = (found === -1 ? 1 : found) + step
    const level = LEVELS[data.wrap ? (at + LEVELS.length) % LEVELS.length : Math.min(LEVELS.length - 1, Math.max(0, at))]
    if (m && level && level !== m.effort) {
      await update($, override, () => level)
      await update($, meta, x => x && { ...x, effort: level })
    }
    return next(e)
  })

  // The git-refresh hook's job: a tool that may have written makes git stale.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && !r.isReadOnly) scheduleGit($)
    return r
  })

  // $.session.turns counts a slash command and its output as two prompts, so
  // the band keeps its own count: what the person sent, as the binary counts.
  // A paste of an image puts `[Image #N]` in the draft; deleting it takes the
  // thumbnail away. Captured off the hook's path: PowerShell takes a second.
  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    if (/\[Image #\d+\]/.test(e.inputText + e.text.slice(e.start, e.end))) void syncPreviews($)
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    scheduleGit($)
    await update($, previews, () => [])
    const r = await next(e)
    if (r.drop === undefined && !e.command && !e.isMeta) await update($, turns, n => n + 1)
    return r
  })

  // The engine raises every API request's record (`api_request`, its cost
  // priced as /cost prices it) on the OpenTelemetry stream, exporter or not;
  // the first-party stream, which also prices each advisor call, is closed to
  // mods. Read after `next`, so a failure here never costs anyone's exporter
  // the record.
  on('telemetry.log', { to: 'collector' }, async ($, e, next) => {
    const r = await next(e)
    const usd = e.attributes.cost_usd
    if (e.event === 'api_request' && typeof usd === 'number') {
      const a = e.attributes
      const key = spendClass(a.query_source)
      await update($, spend, x => ({ ...x, [key]: x[key] + usd }))
      if (key === 'agents') {
        const tokens = usageKey(Number(a.input_tokens), Number(a.output_tokens), Number(a.cache_read_tokens), Number(a.cache_creation_tokens))
        const id = unmatchedSteps.get(tokens)
        if (id === undefined) remember(unmatchedCosts, tokens, usd)
        else {
          unmatchedSteps.delete(tokens)
          await update($, agents, list => list.map(x => (x.id === id ? { ...x, usd: x.usd + usd } : x)))
        }
      }
    }
    return r
  })

  // The wait the person sees: a turn's start to Claude's first row that shows,
  // text or a tool call. A row is appended as its block ends, as it appears;
  // thinking shows nothing, so it is part of the wait, not its end.
  on('session.append', { door: 'response' }, async ($, e, next) => {
    const r = await next(e)
    const kind = e.message.content[0]?.type ?? ''
    if (turnStartedAt !== null && e.agentId === undefined && !kind.includes('thinking')) {
      const waited = (await $.clock.now()) - turnStartedAt
      turnStartedAt = null
      await update($, speed, x => ({ ...x, firstOutputMs: waited }))
    }
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The band is raised on these two alone, the two that draw a Client.
    if (e.props.hasSurvey || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    // The panel opens by itself only where it docks beside the transcript;
    // on the main screen it would sit above the prompt, a third of it tall.
    if (!isPanelOffered && e.viewport?.isFullscreen === true) {
      isPanelOffered = true
      if (!(await read($, panelClosed))) void $.ui.open({ id: PANE, title: 'agents', columns: PANE_COLUMNS }).catch(() => undefined)
    }
    const [r, m, p, tot, delta, adv, n, t, sp, fast, thumbs] = await Promise.all([
      read($, reading),
      read($, meta),
      read($, place),
      read($, totals),
      read($, last),
      read($, advisor),
      read($, turns),
      read($, now),
      read($, spend),
      read($, speed),
      read($, previews),
    ])
    const pct = r?.percent ?? 0
    const lines = frame([
      { section: 0, label: p?.git ? 'repo' : 'project', content: pathRow(p) },
      { section: 1, label: 'model', content: modelRow(r, m, e.props.isWorking) },
      { section: 1, label: 'tokens', content: tokensRow(tot, delta, fast) },
      { section: 1, label: 'advisor', content: adv ? advisorRow(adv) : [] },
      { section: 1, label: 'spend', content: spendRow(sp, r) },
      { section: 1, label: 'cost', content: costRow(r, m, n, t) },
    ])

    const elements = $.ui.resolve(e)
    const { Box, Button, Client, Text } = elements
    const Raster = 'Raster' in elements ? elements.Raster : undefined
    const draw = (span: Span) => (
      <Text color={span.c} bold={span.b} dimColor={span.d}>
        {span.t}
      </Text>
    )
    // The binary's OSC 8 links become presses: Claude Code draws a Link's URL
    // as text in a terminal it judges unable to show one (VS Code's). Each
    // control is held to its text's width, so its click area is that text.
    const control = (span: Span) =>
      span.el === 'effort' ? (
        <Client
          key="effort"
          module="./effort.tsx"
          width={widthOf([span])}
          props={{ text: span.t, color: span.c ?? 'white' }}
        />
      ) : span.el === 'bar' ? (
        <Client
          key="bar"
          module="./bar.tsx"
          width={widthOf([span])}
          props={{ percent: r?.percent ?? 0, isWorking: e.props.isWorking, width: BAR_WIDTH }}
        />
      ) : span.el === 'claude' ? (
        <Client key="claude" module="./claude.tsx" width={widthOf([span])} props={{ isWorking: e.props.isWorking }} />
      ) : span.n ? (
        <Client key={`n-${span.n.k}`} module="./count.tsx" width={widthOf([span])} props={countProps({ ...span, n: span.n })} />
      ) : (
        <Box width={widthOf([span])} flexShrink={0}>
          <Button plain key={span.el} onPress={() => void (span.el === 'panel' ? openPanel($) : openUrl($, span.el === 'repo' ? (p?.remote ?? '') : CHANGELOG))}>
            {draw(span)}
          </Button>
        </Box>
      )
    const drawLine = (line: Span[]) => {
      if (!line.some(span => span.el)) return <Text wrap="truncate-end">{line.map(draw)}</Text>
      const parts: JSX.Element[] = []
      let run: Span[] = []
      for (const span of [...line, null]) {
        if (span && !span.el) {
          run.push(span)
          continue
        }
        if (run.length > 0) parts.push(<Text wrap="truncate-end">{run.map(draw)}</Text>)
        run = []
        if (span) parts.push(control(span))
      }
      return <Box>{parts}</Box>
    }
    // flex-start: each line is as wide as its cells, never stretched to the
    // band, so no control is handed the spare columns to its right.
    return (
      <Box flexDirection="column" alignItems="flex-start">
        {/* Pasted images, seen before they are sent: `#N` as the draft names them. */}
        {Raster && thumbs.length > 0 && (
          <Box>
            {thumbs.map(thumb => (
              <Box flexDirection="column" alignItems="center" marginRight={2}>
                <Raster key={`image-${thumb.id}`} columns={thumb.columns} rows={thumb.rows} cells={thumb.cells} />
                {/* A terminal cell holds four pixels at most: the full image opens in the viewer. */}
                <Button plain dimColor key={`open-image-${thumb.id}`} label={`#${thumb.id} open ↗`} onPress={() => void openUrl($, thumb.path)} />
              </Box>
            ))}
          </Box>
        )}
        {lines.map(drawLine)}
        {/* What a status line cannot do: act. Past the threshold, offer the fix. */}
        {pct >= 85 && !e.props.isWorking && (
          <Button key="compact" label="compact context" onPress={() => void $.session.compact()} />
        )}
      </Box>
    )
  })

  on('command.run', { command: 'sidebar' }, async $ => {
    const isPlaced = await openPanel($)
    return { text: isPlaced ? 'Agents panel opened.' : 'The panel opens beside the transcript in fullscreen, from 110 columns.' }
  })

  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    if (e.id === PANE && e.origin.kind === 'person') await update($, panelClosed, () => true)
    return r
  }).catch(($, e, next) => next(e))

  // The panel beside the transcript: this session's agents with their work.
  // Claude Code docks a pane on the right; its layout has no slot on the left.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const [ags, t] = await Promise.all([read($, agents), read($, now)])
    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    const Client = 'Client' in elements ? elements.Client : undefined
    // The body less the panel's own margin of a cell each side.
    const inner = Math.max(16, e.props.bodyColumns - 2)
    const draw = (span: Span) => (
      <Text color={span.c} bold={span.b} dimColor={span.d}>
        {span.t}
      </Text>
    )
    const shown = [
      ...ags.filter(a => a.doneAt === null),
      ...ags.filter(a => a.doneAt !== null).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)).slice(0, ENDED_SHOWN),
    ]
    const state = (a: Agent) =>
      a.doneAt === null && Client ? (
        <Client key={`working-${a.id}`} module="./claude.tsx" width={13} props={{ isWorking: true }} />
      ) : a.doneAt === null ? (
        <Text color="claude">working</Text>
      ) : a.status === 'completed' ? (
        <Text color="green">✓ done</Text>
      ) : (
        <Text color="red">{`✗ ${a.status}`}</Text>
      )
    // A section's name in the accent, ruled to the edge.
    const header = (name: string) => (
      <Text>
        <Text color="claude" bold>
          {name}
        </Text>
        <Text color="gray">{` ${'─'.repeat(Math.max(0, inner - name.length - 1))}`}</Text>
      </Text>
    )
    return (
      <Box flexDirection="column" paddingX={1}>
        {header('AGENTS')}
        {shown.length === 0 && (
          <Box marginTop={1}>
            <Text dimColor>No agents in this session yet.</Text>
          </Box>
        )}
        {/* One card per agent, its border the state's colour: at work, done, failed. */}
        {shown.map(a => (
          <Box
            key={`agent-${a.id}`}
            flexDirection="column"
            marginTop={1}
            paddingX={1}
            borderStyle="round"
            borderColor={a.doneAt === null ? 'claude' : a.status === 'completed' ? 'green' : 'red'}
            borderDimColor={a.status === 'completed'}
          >
            <Box justifyContent="space-between">
              <Box>
                {state(a)}
                <Text bold>{` ${a.type}`}</Text>
              </Box>
              {(a.doneAt !== null || t > 0) && <Text dimColor>{formatElapsed((a.doneAt ?? t) - a.startedAt)}</Text>}
            </Box>
            <Text wrap="truncate-end">{a.description || a.type}</Text>
            {agentRows(a).map(([label, value]) =>
              // A row with a figure is a Box, as a Client cannot sit in a Text.
              Client && value.some(span => span.n) ? (
                <Box>
                  <Text dimColor>{label.padEnd(8)}</Text>
                  {value.map(span =>
                    span.n ? <Client key={`n-${a.id}-${span.n.k}`} module="./count.tsx" width={widthOf([span])} props={countProps({ ...span, n: span.n })} /> : draw(span),
                  )}
                </Box>
              ) : (
                <Text wrap="truncate-end">
                  <Text dimColor>{label.padEnd(8)}</Text>
                  {value.map(draw)}
                </Text>
              ),
            )}
          </Box>
        ))}
      </Box>
    )
  })
}

// --- spans: render.rs's ANSI strings as data, so the box can be measured -----

type Span = { t: string; c?: string; b?: boolean; d?: boolean; el?: 'effort' | 'repo' | 'version' | 'bar' | 'claude' | 'panel' | 'count'; n?: Count }
// A figure count.tsx rolls to each new value: `k` names it across redraws.
type Count = { k: string; v: number; f: Figure; before: string; after: string }
type Row = { section: number; label: string; content: Span[] }

const s = (t: string, c?: string): Span => ({ t, c })
const dim = (t: string): Span => ({ t, d: true })
// `t` is the figure at rest, what the frame measures and count.tsx settles on.
// A NaN would differ from itself on every redraw and restart its roll forever.
const num = (k: string, value: number, f: Figure, c?: string, before = '', after = ''): Span => {
  const v = Number.isFinite(value) ? value : 0
  return { t: before + figure(f, v) + after, c, el: 'count', n: { k, v, f, before, after } }
}

// count.tsx's props for a figure: plain data, no key left undefined.
function countProps(span: Span & { n: Count }) {
  return {
    value: span.n.v,
    figure: span.n.f,
    before: span.n.before,
    after: span.n.after,
    width: widthOf([span]),
    ...(span.c && { color: span.c }),
    ...(span.b && { bold: true }),
    ...(span.d && { dimColor: true }),
  }
}
const SEP = s(' · ', 'gray')

function join(parts: Span[][]): Span[] {
  return parts.filter(part => part.length > 0).flatMap((part, i) => (i === 0 ? part : [SEP, ...part]))
}

// shortcut: one cell per code point, which every glyph drawn here is; a wide
// character in a path would push its row's right edge out by one.
function widthOf(spans: Span[]): number {
  return spans.reduce((n, span) => n + [...span.t].length, 0)
}

// render.rs `assemble`: heavy frame, heavy divider between sections, thin
// dividers between rows of one section, every row padded to the widest.
function frame(rows: Row[]): Span[][] {
  const inners = rows
    .filter(row => row.content.length > 0)
    .map(row => {
      const inner = [s(' '), dim(row.label.padEnd(LABEL_W)), s(' '), s('│', 'gray'), s('  '), ...row.content, s(' ')]
      return { section: row.section, inner, width: widthOf(inner) }
    })
  const max = Math.max(MIN_INNER, ...inners.map(row => row.width))
  const heavy = '━'.repeat(max)
  const divider = s(`┃ ${'─'.repeat(LABEL_W + 1)}┼${'─'.repeat(Math.max(1, max - (LABEL_W + 4)))} ┃`, 'gray')

  const lines: Span[][] = [[s(`┏${heavy}┓`, 'gray')]]
  inners.forEach((row, i) => {
    const previous = inners[i - 1]
    if (previous) lines.push([previous.section === row.section ? divider : s(`┣${heavy}┫`, 'gray')])
    lines.push([s('┃', 'gray'), ...row.inner, s(' '.repeat(max - row.width)), s('┃', 'gray')])
  })
  lines.push([s(`┗${heavy}┛`, 'gray')])
  return lines
}

function pathRow(p: Place | null): Span[] {
  const git = p?.git
  const path: Span[] = [{ ...s(formatCwd(p?.cwd ?? '', p?.home ?? null), 'cyan'), el: p?.remote ? 'repo' : undefined }]
  // The panel's way back once it is closed: a press opens it again.
  const panel: Span[] = [{ ...dim('agents ›'), el: 'panel' }]
  if (!git) return join([path, panel])
  const isDirty = git.insertions > 0 || git.deletions > 0 || git.untracked > 0
  const counts = [
    git.ahead > 0 && s(` ↑${git.ahead}`, 'cyan'),
    git.behind > 0 && s(` ↓${git.behind}`, 'magenta'),
    git.insertions > 0 && s(` +${git.insertions}`, 'green'),
    git.deletions > 0 && s(` -${git.deletions}`, 'red'),
    git.untracked > 0 && s(` ~${git.untracked}`, 'gray'),
    // The space is deliberate: ⊟ is drawn edge to edge and swallows a digit.
    git.stash > 0 && dim(` ⊟ ${git.stash}`),
  ].filter((span): span is Span => span !== false)
  return join([path, [dim('on'), s(' '), s(git.branch, isDirty ? 'yellow' : 'green'), ...counts], panel])
}

// Opens the panel with the keyboard; false where the surface cannot place it
// (the main screen, or under 110 columns).
async function openPanel($: $): Promise<boolean> {
  await update($, panelClosed, () => false)
  return (await $.ui.open({ id: PANE, title: 'agents', focus: true, columns: PANE_COLUMNS })).isPlaced
}

function modelRow(r: Reading | null, m: { model: string; effort: string | null; version: string } | null, isWorking: boolean): Span[] {
  // The bar fills from the truncated percentage, the label shows the rounded one.
  const pct = r?.percent ?? 0
  const color = r?.percent == null ? 'green' : pctColor(pct)
  const filled = Math.floor((BAR_WIDTH * Math.min(100, Math.max(0, Math.trunc(pct))) + 50) / 100)
  const used = r?.tokens ?? Math.floor(((r?.window ?? 0) * pct) / 100)
  return join([
    // Drawn by bar.tsx, which animates it; the text holds its width.
    [{ t: '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled), c: color, el: 'bar' }, s(' '), num('pct', pct, 'int', color, '', '%')],
    r && r.window > 0 ? [num('used', used, 'tokens', 'white'), s(`/${windowLabel(r.window)}`, 'gray')] : [],
    [s(m?.model ? prettify(m.model) : 'unknown', 'magenta')],
    m?.effort ? [{ ...s(`${m.effort} effort`, effortColor(m.effort)), el: 'effort' }] : [],
    // Drawn by claude.tsx: the spark's five-cell track and `working`, or `●  ready`.
    [{ t: isWorking ? '      working' : '●  ready', el: 'claude' }],
    m?.version ? [{ ...s(`v${m.version}`, 'gray'), el: 'version' }] : [],
  ])
}

// The buckets, then the latest turn's speed: `first output 9.4s · reply 34s`.
function tokensRow(tot: Tokens, delta: Tokens, fast: Speed): Span[] {
  const { firstOutputMs: first, replyMs: reply } = fast
  return join([
    bucket('in', 'in', '', tot.in, delta.in, 'cyan', 'cyan'),
    bucket('cacheWrite', 'cache', '↑', tot.cacheWrite, delta.cacheWrite, 'gray', 'yellow'),
    bucket('cacheRead', 'cache', '↓', tot.cacheRead, delta.cacheRead, 'gray', 'cyan'),
    bucket('out', 'out', '', tot.out, delta.out, 'magenta', 'magenta'),
    // 10 s and 30 s: across this machine's 895 transcript turns the same wait
    // ran p50 9.4 s, p75 18.9 s, p90 36 s, so red is about the slowest eighth.
    first === null ? [] : [dim('first output'), s(' '), num('first', first, 'wait', first < 10_000 ? 'green' : first < 30_000 ? 'yellow' : 'red')],
    reply === null ? [] : [dim('reply'), s(' '), num('reply', reply, 'wait', 'white')],
  ])
}

// One token bucket: `in 2.7K (+2.7K)`, bold and coloured while it is moving.
function bucket(key: string, label: string, arrow: string, value: number, plus: number, idle: string, active: string): Span[] {
  const arrowPart = arrow ? [s(arrow, 'gray')] : []
  const added = num(`${key}-delta`, plus, 'tokens', plus > 0 ? 'green' : undefined, '(+', ')')
  return plus > 0
    ? [{ t: label, c: active, b: true }, ...arrowPart, s(' '), num(key, value, 'tokens', active), s(' '), added]
    : [dim(label), ...arrowPart, s(' '), num(key, value, 'tokens', idle), s(' '), { ...added, d: true }]
}

// An agent card's rows under its header, each a dim label and its value:
// model and effort, tokens (context + out is the `↓ N tokens` Claude Code's
// agent list shows), and cost.
function agentRows(a: Agent): [string, Span[]][] {
  const rows: [string, Span[]][] = []
  if (a.model) rows.push(['model', join([[s(prettify(a.model), 'magenta')], a.effort ? [s(a.effort, effortColor(a.effort))] : []])])
  if (a.context + a.out > 0) {
    rows.push(['tokens', join([[num('context', a.context, 'tokens', 'cyan'), dim(' context')], [num('out', a.out, 'tokens', 'magenta'), dim(' out')]])])
  }
  if (a.usd > 0) rows.push(['cost', [num('usd', a.usd, 'usd', a.usd > 0.5 ? 'yellow' : 'green')]])
  return rows
}

// `Fable 5.1 · 2 calls · in 352.9K · out 14.5K · $4.1266`: already inside the
// cost row's total, which is Claude Code's own; shown here as its share.
function advisorRow(a: Advisor): Span[] {
  return join([
    [s(prettify(a.model), 'magenta')],
    [num('advisor-calls', a.calls, 'int', 'white'), s(' '), dim(a.calls === 1 ? 'call' : 'calls')],
    [dim('in'), s(' '), num('advisor-in', a.in, 'tokens', 'cyan')],
    [dim('out'), s(' '), num('advisor-out', a.out, 'tokens', 'magenta')],
    a.usd === null ? [] : [num('advisor-usd', a.usd, 'usd', a.usd > 0.5 ? 'yellow' : 'green')],
  ])
}

// The engine's request classes, as its own `ns` splits a query source; a
// request that names none is the main loop's, as the engine reads it.
function spendClass(source: unknown): keyof Spend {
  if (typeof source !== 'string' || source.startsWith('repl_main_thread') || source === 'sdk') return 'main'
  if (source.startsWith('agent:') || source === 'hook_agent') return 'agents'
  return 'background'
}

// `main $1.2345 · agents $0.4567 · background $0.0123 · earlier $43.2100`,
// summing to the cost row's total; `earlier` is what this process spent before
// the mod saw it, or what a resumed session spent in an earlier one.
function spendRow(x: Spend, r: Reading | null): Span[] {
  const seen = x.main + x.agents + x.background
  if (seen === 0) return []
  const earlier = (r?.costUsd ?? 0) - seen
  const part = (label: string, usd: number): Span[] =>
    usd >= 0.00005 ? [dim(label), s(' '), num(`spend-${label}`, usd, 'usd', usd > 0.5 ? 'yellow' : 'green')] : []
  return join([part('main', x.main), part('agents', x.agents), part('background', x.background), part('earlier', earlier)])
}

function costRow(r: Reading | null, m: { startedAt: number } | null, n: number, t: number): Span[] {
  const cost = r?.costUsd
  return join([
    cost != null ? [num('cost', cost, 'usd', cost > 0.5 ? 'yellow' : 'green')] : [],
    n > 0 ? [num('messages', n, 'int', 'white'), s(' '), dim(n === 1 ? 'message' : 'messages')] : [],
    // The session's age and the windows' resets step every second: drawn
    // plainly, as a roll would never settle.
    m && t > 0 ? [s(formatElapsed(t - m.startedAt), 'white')] : [],
    ...(r?.rate ?? []).map(w => rateWindow(w, t)),
  ])
}

// One window: `5h 42% ⇡3% (1h)`. The arrow compares use with the linear
// expectation for the elapsed part of the window.
function rateWindow(w: RateWindow, t: number): Span[] {
  const [label, span] = RATE[w.kind] ?? [w.kind, 0]
  const pct = Math.round(w.percentUsed)
  const color = pct >= 80 ? 'red' : pct >= 50 ? 'yellow' : 'green'
  const remaining = w.resetsAt ? Math.floor((Date.parse(w.resetsAt) - t) / 1000) : NaN
  const isInWindow = remaining > 0 && remaining <= span
  const burn = isInWindow ? pct - Math.floor(((span - remaining) * 100) / span) : 0
  return [
    dim(label),
    s(' '),
    num(`rate-${w.kind}`, pct, 'int', color, '', '%'),
    ...(Math.abs(burn) >= 1 ? [s(' '), num(`rate-${w.kind}-burn`, Math.abs(burn), 'int', burn > 0 ? 'red' : 'green', burn > 0 ? '⇡' : '⇣', '%')] : []),
    ...(isInWindow ? [s(' '), s(`(${formatDuration(remaining)})`, 'gray')] : []),
  ]
}

// --- state the events feed -------------------------------------------------

let isGitQueued = false

// One git read per burst of edits, where the binary paid one per 5 s TTL.
function scheduleGit($: $) {
  if (isGitQueued) return
  isGitQueued = true
  $.clock.after(300, () => {
    isGitQueued = false
    void refreshPlace($)
  })
}

async function refreshPlace($: $) {
  const cwd = await $.session.cwd()
  const [home, repo, git] = await Promise.all([homeDir($), $.session.repo(), readGit($, cwd)])
  await update($, place, () => ({ cwd, home, remote: webUrl(repo?.remote ?? null), git }))
}

// The binary's threshold alerts (src/notify_state.rs): context fires once at
// its threshold and re-arms below it; the rate limit fires once per window,
// re-armed only when the window resets. A muted alert still latches.
async function checkThresholds($: $, r: Reading, limits: { context: number; rate: number }, delivery: Delivery) {
  const was = await read($, alerted)
  const next = { ...was }
  const cwd = await $.session.cwd().catch(() => '')
  const pct = Math.round(r.percent ?? 0)
  if (pct < limits.context) next.context = false
  else if (limits.context > 0 && !was.context) {
    next.context = true
    void notify($, 'context_high', `Context window at ${pct}%`, delivery, cwd)
  }
  // The 7-day window speaks only when it is strictly the fuller one.
  const five = r.rate.find(w => w.kind === 'five_hour')
  const seven = r.rate.find(w => w.kind === 'seven_day')
  const window = seven && (!five || Math.trunc(seven.percentUsed) > Math.trunc(five.percentUsed)) ? seven : five
  if (window && window.resetsAt !== was.resetsAt) {
    next.rate = false
    next.resetsAt = window.resetsAt
  }
  const used = window ? Math.trunc(window.percentUsed) : 0
  if (window && limits.rate > 0 && used >= limits.rate && !next.rate) {
    next.rate = true
    void notify($, 'rate_limit', `Rate limit at ${used}%`, delivery, cwd)
  }
  if (JSON.stringify(next) !== JSON.stringify(was)) await update($, alerted, () => next)
}

async function refreshReading($: $) {
  const usage = await $.session.usage()
  await update($, reading, () => toReading(usage))
}

// shortcut: Windows' and xdg's openers, then macOS's; no opener means no-op.
async function openUrl($: $, url: string) {
  if (!url) return
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const opener = isWindows ? ['rundll32', 'url.dll,FileProtocolHandler', url] : ['xdg-open', url]
  try {
    await $.process.run(opener, { timeoutMs: 5000 })
  } catch {
    if (!isWindows) await $.process.run(['open', url], { timeoutMs: 5000 }).catch(() => undefined)
  }
}

// An https page for the origin remote, with any credentials and port dropped.
function webUrl(remote: string | null): string | null {
  if (!remote) return null
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(remote)
  try {
    const url = new URL(scp ? `https://${scp[1]}/${scp[2]}` : remote)
    if (!['https:', 'http:', 'ssh:'].includes(url.protocol)) return null
    return `https://${url.hostname}${url.pathname.replace(/\.git$/, '')}`
  } catch {
    return null
  }
}

async function homeDir($: $) {
  return (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? null
}

// Claude Code's folder: CLAUDE_CONFIG_DIR, else ~/.claude.
async function configDir($: $): Promise<string | null> {
  const set = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await homeDir($)
  return set || (home && `${home}/.claude`)
}

// Its global config: `.claude.json` in CLAUDE_CONFIG_DIR, else in the home
// folder itself; a non-empty legacy `.config.json` in the config folder wins.
async function globalConfigPath($: $): Promise<string | null> {
  const [dir, set, home] = await Promise.all([configDir($), $.env.get('CLAUDE_CONFIG_DIR'), homeDir($)])
  const legacy = `${dir}/.config.json`
  const stat = dir ? await $.fs.stat(legacy).catch(() => null) : null
  if (stat?.kind === 'file' && stat.size > 0) return legacy
  const base = set || home
  return base ? `${base}/.claude.json` : null
}

// This session's transcript, in the project folder named for its directory
// (each non-alphanumeric a `-`); where that name is not it (a resumed session,
// a /cd, a name cut at 200 with a hash), the folder that holds the file.
async function transcriptPath($: $): Promise<string | null> {
  const [dir, root, id] = await Promise.all([configDir($), $.session.root(), $.session.id()])
  if (!dir || !/^[\w-]+$/.test(id)) return null
  const projects = `${dir}/projects`
  const named = `${projects}/${root.replace(/[^a-zA-Z0-9]/g, '-')}/${id}.jsonl`
  if (await $.fs.exists(named)) return named
  for (const entry of await $.fs.list(projects).catch(() => [])) {
    const path = `${projects}/${entry.name}/${id}.jsonl`
    if (entry.kind === 'dir' && (await $.fs.exists(path))) return path
  }
  return null
}

async function refreshAgents($: $) {
  const [list, t] = await Promise.all([$.agent.list(), $.clock.now()])
  // Ended agents stay in the list so a later refresh keeps their first stamp;
  // the render hides them once the linger is over.
  await update($, agents, prev =>
    list.map((a): Agent => {
      const old = prev.find(p => p.id === a.id)
      return {
        id: a.id,
        description: a.description,
        type: a.type,
        status: a.status,
        model: old?.model ?? null,
        effort: old?.effort ?? null,
        // First seen at its first turn's start, which refreshes the list.
        startedAt: old?.startedAt ?? t,
        doneAt: ENDED.has(a.status) ? (old?.doneAt ?? t) : null,
        context: old?.context ?? 0,
        out: old?.out ?? 0,
        usd: old?.usd ?? 0,
      }
    }),
  )
}

type Iteration = {
  type?: string
  model?: string
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
  inference_geo?: string | null
}

let isAdvisorPending = false
// Whether this load has offered the panel once, in fullscreen.
let isPanelOffered = false
let turnStartedAt: number | null = null

// A request record names no agent, so an agent's step result and the record of
// its request meet by their four token counts, which the two report alike;
// whichever lands first waits here for the other.
const unmatchedSteps = new Map<string, string>()
const unmatchedCosts = new Map<string, number>()

function usageKey(input: number, output: number, cacheRead: number, cacheWrite: number): string {
  return `${input}|${output}|${cacheRead}|${cacheWrite}`
}

// shortcut: a pair that never meets (a request with no record) waits until
// 100 newer ones push it out
function remember<V>(waiting: Map<string, V>, key: string, value: V): void {
  waiting.set(key, value)
  if (waiting.size > 100) waiting.delete(waiting.keys().next().value as string)
}

// The session's spend from its transcript, each main-loop message counted
// once: the main model's tokens (top-level usage, which leaves the advisor
// out) and the advisor's calls (its `usage.iterations`). The binary sums
// every line, and a message spans several, so it reads ~2x.
async function readTranscript($: $): Promise<{ main: Tokens; advisor: Advisor | null; prompts: number } | null> {
  try {
    const path = await transcriptPath($)
    if (!path) return null
    const byMessage = new Map<string, { main: Tokens; calls: Iteration[] }>()
    let prompts = 0
    for await (const line of transcriptLines($, path)) {
      if (!line.includes('"assistant"') && !line.includes('"user"')) continue
      try {
        const row = JSON.parse(line)
        // A prompt as the binary counts one: no tool result, slash command or
        // its output, meta row, or compaction summary.
        if (row.type === 'user') {
          const isPrompt = !('toolUseResult' in row) && row.isMeta !== true && !row.isCompactSummary && !row.isSidechain
          if (isPrompt && !/<command-name>|<local-command-stdout>/.test(line)) prompts++
          continue
        }
        const u = row?.message?.usage
        if (row.type !== 'assistant' || row.isSidechain || !u) continue
        const iterations: Iteration[] = Array.isArray(u.iterations) ? u.iterations : []
        byMessage.set(row.message.id ?? line, {
          main: {
            in: u.input_tokens ?? 0,
            cacheWrite: u.cache_creation_input_tokens ?? 0,
            cacheRead: u.cache_read_input_tokens ?? 0,
            out: u.output_tokens ?? 0,
          },
          // The engine prices an advisor call with its parent response's geo.
          calls: iterations
            .filter(it => it.type === 'advisor_message')
            .map(it => ({ ...it, inference_geo: u.inference_geo })),
        })
      } catch {
        // a line still being written
      }
    }
    const messages = [...byMessage.values()]
    return {
      main: messages.map(m => m.main).reduce(add, ZERO),
      advisor: sumAdvisor(messages.flatMap(m => m.calls)),
      prompts,
    }
  } catch {
    // shortcut: a transcript under CLAUDE_CONFIG_DIR, or one no child could print, is not read
    return null
  }
}

// $.fs.read stops at 4 MiB, which a long session's transcript passes, so a
// larger one is streamed through a child that prints it, piece by piece. On
// Windows that is `findstr /r ^`, every line byte for byte: ~40 ms on 5 MB,
// where `type` took ~270 and PowerShell ~800. Backslashes only, or it reads
// `/.claude` as a switch.
const FS_READ_MAX = 4 * 1024 * 1024

async function* transcriptLines($: $, path: string): AsyncGenerator<string> {
  if ((await $.fs.stat(path)).size <= FS_READ_MAX) {
    yield* (await $.fs.read(path)).split('\n')
    return
  }
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const argv = isWindows ? ['findstr', '/r', '^', path.replace(/\//g, '\\')] : ['cat', '--', path]
  let rest = ''
  for await (const piece of $.process.spawn({ argv })) {
    if (piece.stream !== 'stdout') continue
    const lines = (rest + piece.text).split('\n')
    rest = lines.pop() ?? ''
    yield* lines
  }
  yield rest
}

// --- pasted images ---------------------------------------------------------

const THUMB_COLS = 48 // 48×12 cells keep one image inside the Raster palette's 1024 color pairs
const THUMB_ROWS = 12
// Claude Code reads a pasted image into memory and deletes its file, so the
// preview reads the clipboard it was just pasted from. A cell is twice as tall
// as wide and holds 2×2 pixels, so the image is drawn into (2·cols)×(2·rows)
// pixels with cols / (2·rows) its aspect, and printed as `cols rows stride`
// and the 24-bit bitmap's rows (BGR, padded to the stride), base64. The full
// image is kept as a PNG beside the others for the label to open; a day on,
// the next capture deletes it.
const THUMB_PS =
  'Add-Type -AssemblyName System.Windows.Forms, System.Drawing;' +
  '$img = [System.Windows.Forms.Clipboard]::GetImage(); if ($null -eq $img) { exit 1 };' +
  "Get-ChildItem -LiteralPath (Split-Path $env:STATUSBOX_SAVE) -Filter 'statusbox-*.png' | Where-Object LastWriteTime -lt (Get-Date).AddDays(-1) | Remove-Item -ErrorAction SilentlyContinue;" +
  '$img.Save($env:STATUSBOX_SAVE, [System.Drawing.Imaging.ImageFormat]::Png);' +
  '$cw = [int]$env:STATUSBOX_COLS; $rh = [int]$env:STATUSBOX_ROWS; $a = $img.Width / $img.Height;' +
  'if ($a -ge $cw / (2 * $rh)) { $c = $cw; $r = [Math]::Max(1, [int][Math]::Round($cw / (2 * $a))) }' +
  ' else { $r = $rh; $c = [Math]::Max(1, [int][Math]::Round(2 * $rh * $a)) };' +
  '$pw = 2 * $c; $ph = 2 * $r;' +
  '$b = New-Object System.Drawing.Bitmap $pw, $ph, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb);' +
  '$g = [System.Drawing.Graphics]::FromImage($b); $g.Clear([System.Drawing.Color]::Black);' +
  "$g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'; $g.DrawImage($img, 0, 0, $pw, $ph); $g.Dispose();" +
  "$d = $b.LockBits((New-Object System.Drawing.Rectangle 0, 0, $pw, $ph), 'ReadOnly', 'Format24bppRgb');" +
  '$raw = New-Object byte[] ($d.Stride * $ph); [System.Runtime.InteropServices.Marshal]::Copy($d.Scan0, $raw, 0, $raw.Length); $b.UnlockBits($d);' +
  '[Console]::Out.Write("$c $r $($d.Stride) " + [Convert]::ToBase64String($raw))'

// Quadrant blocks by which of a cell's four pixels take the foreground:
// top-left 1, top-right 2, bottom-left 4, bottom-right 8.
const QUADRANT = [0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b, 0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588]
// The seven ways to split four pixels in two, and all four as one colour.
const SPLITS = [1, 2, 3, 4, 5, 6, 7, 15]

// Each cell as the quadrant block and two colours closest to its four pixels:
// twice the detail across of half blocks, in the same cells.
function quadrantCells(raw: Uint8Array, columns: number, rows: number, stride: number): string {
  const words = new Uint32Array(columns * rows * 3)
  const px = (x: number, y: number) => {
    const at = y * stride + x * 3
    return [raw[at + 2] ?? 0, raw[at + 1] ?? 0, raw[at] ?? 0] // BGR on disk
  }
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < columns; cx++) {
      const quad = [px(2 * cx, 2 * cy), px(2 * cx + 1, 2 * cy), px(2 * cx, 2 * cy + 1), px(2 * cx + 1, 2 * cy + 1)]
      let best = { error: Infinity, mask: 15, fg: [0, 0, 0], bg: [0, 0, 0] }
      for (const mask of SPLITS) {
        const fg = mean(quad.filter((_, i) => mask & (1 << i)))
        const bg = mean(quad.filter((_, i) => !(mask & (1 << i))))
        const error = quad.reduce((sum, p, i) => sum + distance(p, mask & (1 << i) ? fg : bg), 0)
        if (error < best.error) best = { error, mask, fg, bg }
      }
      const at = (cy * columns + cx) * 3
      words[at] = QUADRANT[best.mask] ?? 0x2588
      words[at + 1] = rgb(best.fg)
      words[at + 2] = rgb(best.mask === 15 ? best.fg : best.bg)
    }
  }
  return (new Uint8Array(words.buffer) as Uint8Array & { toBase64(): string }).toBase64()
}

function mean(pixels: number[][]): number[] {
  if (pixels.length === 0) return [0, 0, 0]
  return [0, 1, 2].map(c => Math.round(pixels.reduce((sum, p) => sum + (p[c] ?? 0), 0) / pixels.length))
}

function distance(a: number[], b: number[]): number {
  return [0, 1, 2].reduce((sum, c) => sum + ((a[c] ?? 0) - (b[c] ?? 0)) ** 2, 0)
}

function rgb([r = 0, g = 0, b = 0]: number[]): number {
  return (r << 16) | (g << 8) | b
}

const captured = new Set<number>()

// The draft's `[Image #N]`s as thumbnails: a new one captured once from the
// clipboard, one no longer in the draft dropped.
async function syncPreviews($: $): Promise<void> {
  const { text } = await $.prompt.read()
  const ids = new Set([...text.matchAll(/\[Image #(\d+)\]/g)].map(m => Number(m[1])))
  if ((await read($, previews)).some(p => !ids.has(p.id))) await update($, previews, list => list.filter(p => ids.has(p.id)))
  for (const id of ids) {
    if (captured.has(id)) continue
    captured.add(id)
    const preview = await captureClipboard($, id).catch(() => null)
    if (preview) await update($, previews, list => (list.some(p => p.id === id) ? list : [...list, preview]))
  }
}

// shortcut: Windows only, where Claude Code's own paste reads the clipboard
// through PowerShell too; elsewhere a paste shows no preview
async function captureClipboard($: $, id: number): Promise<Preview | null> {
  const [os, temp, session] = await Promise.all([$.env.get('OS'), $.env.get('TEMP'), $.session.id()])
  if (os !== 'Windows_NT' || !temp) return null
  const path = `${temp.replace(/[\\/]+$/, '')}\\statusbox-${session.replace(/[^\w-]/g, '_')}-${id}.png`
  const r = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Sta', '-Command', THUMB_PS], {
    env: { STATUSBOX_COLS: String(THUMB_COLS), STATUSBOX_ROWS: String(THUMB_ROWS), STATUSBOX_SAVE: path },
    timeoutMs: 10_000,
  })
  const [c, h, s, data = ''] = r.stdout.trim().split(' ')
  const [columns, rows, stride] = [Number(c), Number(h), Number(s)]
  // A malformed Raster refuses the whole band, so the bitmap is checked first.
  const isSized =
    r.exitCode === 0 && !r.isStdoutTruncated &&
    Number.isInteger(columns) && columns >= 1 && columns <= THUMB_COLS &&
    Number.isInteger(rows) && rows >= 1 && rows <= THUMB_ROWS &&
    Number.isInteger(stride) && stride >= columns * 6 && /^[A-Za-z0-9+/]*={0,2}$/.test(data)
  if (!isSized) return null
  const raw = (Uint8Array as unknown as { fromBase64(text: string): Uint8Array }).fromBase64(data)
  if (raw.length !== stride * rows * 2) return null
  return { id, columns, rows, cells: quadrantCells(raw, columns, rows, stride), path }
}

const isCost = (v: unknown, max = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max

// Everything besides the catalog that sets what Claude Code charges, each
// checked as the engine checks it: prices it fetched for models newer than its
// catalog, a model it prices as another until a date (`alder_ford`), and an
// org's `modelPricing` from trusted managed policy.
async function readPrices($: $): Promise<void> {
  const config = await globalConfigPath($)
    .then(path => (path ? $.fs.read(path) : '{}'))
    .then(text => JSON.parse(text) as Record<string, any>, () => ({}) as Record<string, any>)
  newerPrices = Object.fromEntries(
    Object.entries((config.additionalModelCostsCache ?? {}) as Record<string, Partial<Price>>).filter(
      ([, p]) =>
        isCost(p?.inputTokens) &&
        isCost(p?.outputTokens) &&
        isCost(p?.promptCacheWriteTokens) &&
        isCost(p?.promptCacheReadTokens) &&
        (p?.promptCacheWrite1hTokens === undefined || isCost(p.promptCacheWrite1hTokens)),
    ),
  ) as Record<string, Price>

  // The bootstrap data of this entrypoint and account, newest first.
  // shortcut: the engine also keys a slot by the main model and version; a
  // remap is the account's, so the newest slot of the two stands in for it
  const [entrypoint, t] = await Promise.all([$.env.get('CLAUDE_CODE_ENTRYPOINT'), $.clock.now()])
  const org = config.oauthAccount?.organizationUuid ?? null
  const slots = Object.values((config.clientDataCacheSlots ?? {}) as Record<string, any>)
    .filter(slot => (slot?.entrypoint ?? null) === (entrypoint ?? 'cli') && (slot?.org ?? null) === org)
    .sort((a, b) => (b?.at ?? 0) - (a?.at ?? 0))
  const remap = (slots[0]?.data ?? config.clientDataCache?.data ?? config.clientDataCache)?.alder_ford ?? {}
  priceRemap = Object.fromEntries(
    Object.entries(remap as Record<string, any>).flatMap(([model, r]) =>
      typeof r?.as === 'string' && isCost(r?.ends_at, 1e11) && t < r.ends_at * 1000 ? [[model, r.as]] : [],
    ),
  )

  const policy = (await $.settings.read({ source: 'policy' }).catch(() => ({}))) as Record<string, any>
  const mp = policy.modelPricing
  // An org's rates count only from a policy the person cannot write.
  if (policy.personWritablePolicy === true || mp === undefined || mp === null) return void (orgPricing = null)
  const multiplier = mp.multiplier === undefined ? 1 : isCost(mp.multiplier, 10) && mp.multiplier > 0 ? mp.multiplier : null
  const overrides = Object.entries((mp.overrides ?? {}) as Record<string, any>).flatMap(([model, row]): [string, Price][] =>
    [row?.input, row?.output, row?.cacheRead, row?.cacheWrite].every(v => isCost(v, 10_000))
      ? [[model.toLowerCase(), { inputTokens: row.input, outputTokens: row.output, promptCacheReadTokens: row.cacheRead, promptCacheWriteTokens: row.cacheWrite }]]
      : [],
  )
  orgPricing = multiplier === null ? null : { multiplier, overrides: Object.fromEntries(overrides) }
}

function sumAdvisor(calls: Iteration[]): Advisor | null {
  if (calls.length === 0) return null
  let usd: number | null = 0
  const sum = { in: 0, out: 0 }
  for (const call of calls) {
    const model = call.model ?? ''
    // The engine's order: an org's row for the model (no ×1.1 on it), else the
    // catalog's price, remapped while a remap stands, else a fetched one; the
    // org's multiplier on either.
    const org = orgPricing?.overrides[model.toLowerCase()]
    const p = org ?? ADVISOR_PRICE[priceRemap[model] ?? ''] ?? ADVISOR_PRICE[model] ?? newerPrices[model]
    sum.in += (call.input_tokens ?? 0) + (call.cache_read_input_tokens ?? 0) + written(call)
    sum.out += call.output_tokens ?? 0
    usd = usd === null || p === undefined ? null : usd + priceCall(p, org ? { ...call, inference_geo: null } : call) * (orgPricing?.multiplier ?? 1)
  }
  return { model: calls.at(-1)?.model ?? '', calls: calls.length, ...sum, usd }
}

function written(call: Iteration): number {
  const split = call.cache_creation
  return call.cache_creation_input_tokens ?? (split?.ephemeral_5m_input_tokens ?? 0) + (split?.ephemeral_1h_input_tokens ?? 0)
}

// One advisor call's dollars as the engine's `tpt` prices it: the long-prompt
// tier once the prompt passes its threshold, 1h cache writes at their own
// price (all at the 5m one when the tier has none), and ×1.1 when the request
// was served in the US only. An advisor call carries no web search.
function priceCall(base: Price, call: Iteration): number {
  const cacheWrite = written(call)
  const prompt = (call.input_tokens ?? 0) + (call.cache_read_input_tokens ?? 0) + cacheWrite
  const p = base.longPrompt !== undefined && prompt > base.longPrompt.abovePromptTokens ? base.longPrompt : base
  const hour = p.promptCacheWrite1hTokens === undefined ? 0 : Math.min(call.cache_creation?.ephemeral_1h_input_tokens ?? 0, cacheWrite)
  const usd =
    ((call.input_tokens ?? 0) * p.inputTokens +
      (call.output_tokens ?? 0) * p.outputTokens +
      (call.cache_read_input_tokens ?? 0) * p.promptCacheReadTokens +
      (cacheWrite - hour) * p.promptCacheWriteTokens +
      hour * (p.promptCacheWrite1hTokens ?? 0)) /
    1e6
  return call.inference_geo === 'us' ? usd * 1.1 : usd
}

function add(a: Tokens, b: Tokens): Tokens {
  return {
    in: a.in + b.in,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheRead: a.cacheRead + b.cacheRead,
    out: a.out + b.out,
  }
}

// Same two concurrent children as src/git.rs, run only when something changed.
async function readGit($: $, cwd: string): Promise<Git | null> {
  try {
    const [status, diff] = await Promise.all([
      $.process.run(['git', 'status', '--porcelain=v2', '--branch', '--show-stash'], { cwd, timeoutMs: 5000 }),
      $.process.run(['git', '-c', 'diff.autoRefreshIndex=false', 'diff', '--shortstat', 'HEAD'], {
        cwd,
        timeoutMs: 5000,
      }),
    ])
    if (status.exitCode !== 0) return null
    const git: Git = { branch: '', ahead: 0, behind: 0, insertions: 0, deletions: 0, untracked: 0, stash: 0 }
    let oid = ''
    for (const line of status.stdout.split('\n')) {
      if (line.startsWith('# branch.head ')) git.branch = line.slice(14).trim()
      else if (line.startsWith('# branch.oid ')) oid = line.slice(13).trim()
      else if (line.startsWith('# branch.ab ')) {
        const [ahead = '', behind = ''] = line.slice(12).trim().split(' ')
        git.ahead = Number(ahead.replace('+', '')) || 0
        git.behind = Number(behind.replace('-', '')) || 0
      } else if (line.startsWith('# stash ')) git.stash = Number(line.slice(8)) || 0
      else if (line.startsWith('? ')) git.untracked += 1
    }
    if (git.branch === '(detached)') git.branch = oid.slice(0, 7)
    git.insertions = Number(/(\d+) insertion/.exec(diff.stdout)?.[1] ?? 0)
    git.deletions = Number(/(\d+) deletion/.exec(diff.stdout)?.[1] ?? 0)
    return git.branch ? git : null
  } catch {
    return null // no git, or too slow: the row reads `project`, as the binary's did
  }
}

function toReading(u: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>): Reading {
  return {
    tokens: u.context.tokens ?? null,
    window: u.context.window,
    percent: u.context.percent ?? null,
    costUsd: u.cost?.usd ?? null,
    rate: u.rateLimits.map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt ?? null })),
  }
}

// --- formatters, ported from src/render.rs ---------------------------------

function windowLabel(size: number): string {
  const k = Math.floor(size / 1000)
  return k >= 1000 ? `${Math.floor(k / 1000)}M` : `${k}K`
}

function pctColor(pct: number): string {
  return pct >= 85 ? 'red' : pct >= 60 ? 'yellow' : 'green'
}

function effortColor(level: string): string {
  const colors: Record<string, string> = { low: 'gray', high: 'cyan', xhigh: 'yellow', max: 'red' }
  return colors[level.toLowerCase()] ?? 'white'
}

// `claude-opus-5-5[1m]` -> `Opus 5.5`; `Opus 5.5 (1M context)` -> `Opus 5.5`.
function prettify(id: string): string {
  const bare = id.replace(/-\d{8}$/, '')
  const [, family, version] = /^(?:claude-)?(fable|opus|sonnet|haiku)-(\d[\d-]*)/.exec(bare) ?? []
  if (family && version) {
    return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version.replace(/-+$/, '').replace(/-/g, '.')}`
  }
  return clip(bare.replace(/^Claude /, '').replace(/(.) \([^)]*\)$/, '$1'), 24)
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function formatCwd(cwd: string, home: string | null): string {
  const path = cwd.replace(/\\/g, '/')
  const base = home?.replace(/\\/g, '/')
  if (base) {
    if (path === base) return '~'
    if (path.startsWith(`${base}/`)) return `~${path.slice(base.length)}`
  }
  const parts = path.split('/').filter(Boolean)
  return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : path
}

function formatDuration(secs: number): string {
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86400) {
    const m = Math.floor((secs % 3600) / 60)
    return `${Math.floor(secs / 3600)}h${m ? `${m}m` : ''}`
  }
  const h = Math.floor((secs % 86400) / 3600)
  return `${Math.floor(secs / 86400)}d${h ? `${h}h` : ''}`
}
