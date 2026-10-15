import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage, TurnStepInput } from 'claude-code'

import type { Advisor, Agent, Alerted, Cache, Git, Menu, Motion, Place, Preview, RateWindow, Reading, Speed, Spend, Tokens } from '../types'
import { figure, formatElapsed } from './count'
import { apportion } from './split'
import type { Figure } from './count'
import { notify } from './notify'

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
const NO_SPEED: Speed = { firstOutputMs: null, replyMs: null, startedAt: null }
const speed = atom({ plugin: 'statusbox', key: 'speed' } as const, NO_SPEED)
const cache = atom({ plugin: 'statusbox', key: 'cache' } as const, null)
// The transcript's size on disk, as of the last seed or turn.
const transcriptBytes = atom({ plugin: 'statusbox', key: 'transcriptBytes' } as const, null)
// The box's open dropdown, if any: the model's or the effort's, and its choices.
const menu = atom({ plugin: 'statusbox', key: 'menu' } as const, null)
// What is folding or unfolding now, by name: `menu` the box's picker,
// `fold-<NAME>` a panel section. An entry that arrives is dropped, so a
// settled screen holds none.
const motion = atom({ plugin: 'statusbox', key: 'motion' } as const, {} as Record<string, Motion>)
// The panel's sections the person folded, kept in $.store across sessions too.
const folded = atom({ plugin: 'statusbox', key: 'folded' } as const, [] as string[])
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
// The chevrons' turns, shut to open: the sidebar's faces the panel's way, a
// dropdown's points down shut and up open.
const SIDEBAR_TURN = ['›', '>', '|', '<', '‹']
const MENU_TURN = ['▾', '▸', '▴']
// The model each family alias names, by its picker name (`opus` -> `Opus 5.5`),
// read from Claude Code's model catalog each time the model picker opens.
let families: Record<string, string> = {}
const ENDED_SHOWN = 5
const ENDED = new Set(['completed', 'failed', 'killed'])
const RATE: Record<string, [string, number]> = { five_hour: ['5-hour', 18_000], seven_day: ['7-day', 604_800] }
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
const PRICE: Record<string, Price> = {
  'claude-fable-5-1': { inputTokens: 10, outputTokens: 50, promptCacheWriteTokens: 12.5, promptCacheWrite1hTokens: 20, promptCacheReadTokens: 0.25 },
  'claude-opus-5-5': { inputTokens: 4, outputTokens: 20, promptCacheWriteTokens: 5, promptCacheWrite1hTokens: 8, promptCacheReadTokens: 0.2 },
}
let newerPrices: Record<string, Price> = {}
let priceRemap: Record<string, string> = {}
let orgPricing: { multiplier: number; overrides: Record<string, Price> } | null = null
// How long a prompt-cache entry lives unread: the API's default, and the hour
// Claude Code asks for where the account has it.
const FIVE_MINUTES = 300_000
const HOUR = 3_600_000
const LABEL_W = 7
const BAR_WIDTH = 30
const MIN_INNER = 30

export const register: Register = (on, options) => {
  // The /config rows (plugin.json's userConfig); 0 turns a threshold alert off.
  const sounds = options.sounds !== false
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
    // A reload cancels the timers: nothing is left half open.
    await update($, menu, () => null)
    await update($, motion, () => ({}))
    await update($, turns, () => n)
    await update($, now, () => t)
    await refreshPlace($)
    await refreshAgents($)
    await readPrices($)
    const kept = await $.store.get('folded').catch(() => undefined)
    if (Array.isArray(kept)) await update($, folded, () => kept.filter((x): x is string => typeof x === 'string'))
    await $.command.register({ name: 'sidebar', description: 'Open the side panel: usage, the session and its cost, the prompt cache, the advisor and agents' })
    // A session the background daemon runs (the agent view's, or a spare it
    // hands one later) starts the plugin before its conversation arrives, the
    // transcript written ~2 s on: then the clock waits for it, and seeds once.
    isAwaitingConversation = !(await seed($)) && n === 0
    $.clock.every(1000, () => {
      void $.clock
        .now()
        .then(t => update($, now, () => t))
        .catch(() => undefined)
      // An image pasted in a way prompt.edit does not report is still caught.
      void syncPreviews($).catch(() => undefined)
      if (isAwaitingConversation) void awaitConversation($).catch(() => undefined)
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
      await update($, cache, () => null)
      await update($, meta, m => m && { ...m, startedAt: t })
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const r = toReading(e)
    await update($, reading, () => r)
    void checkThresholds($, r, limits, sounds).catch(() => undefined)
    return next(e)
  })

  // The alerts the binary's settings hooks raised, on the same events; each
  // passes on untouched, its alert raised beside it.
  on('classic.PermissionRequest', async ($, e, next) => {
    void notify($, 'permission', sounds)
    return next(e)
  })
  on('classic.Stop', async ($, e, next) => {
    // A turn that ends while a subagent runs is only paused: Claude Code goes
    // on when it reports back, so alerting now would be false and then twice.
    const pending = e.background_tasks
    if (!(Array.isArray(pending) && pending.length > 0)) void notify($, 'stop', sounds)
    return next(e)
  })
  on('classic.PreCompact', async ($, e, next) => {
    void notify($, 'compaction_start', sounds)
    return next(e)
  })
  on('classic.PostCompact', async ($, e, next) => {
    void notify($, 'compaction_done', sounds)
    // The summary replaces the conversation the entry held.
    await update($, cache, c => c && { ...c, at: 0 })
    return next(e)
  })
  // A cache entry is one model's: after a switch the next request writes the
  // whole context again, on the new model.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const model = bare(e.to_model)
    if (model !== bare(e.from_model)) await update($, cache, c => c && { ...c, at: 0, model })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      await refreshAgents($)
    } else {
      // A new turn's speed and tokens replace the last one's as they come in.
      turnStartedAt = await $.clock.now()
      await update($, speed, () => ({ ...NO_SPEED, startedAt: turnStartedAt }))
      await update($, last, () => ZERO)
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
    // Each main-loop request's tokens count as it lands, so the band's figures
    // roll through a long turn rather than all at its end.
    if (id === undefined && result.usage) {
      const u = result.usage
      const step: Tokens = { in: u.input_tokens, cacheWrite: u.cache_creation_input_tokens, cacheRead: u.cache_read_input_tokens, out: u.output_tokens }
      await update($, last, x => add(x, step))
      await update($, totals, x => add(x, step))
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
    await update($, speed, x => ({ ...x, replyMs: e.durationMs, startedAt: null }))
    scheduleGit($)
    await refreshReading($)
    await measureTranscript($)
    // The API reports an advisor call's tokens nowhere but the transcript, so
    // it is read again only after a turn that consulted one.
    if (isAdvisorPending) {
      isAdvisorPending = false
      const scan = await readTranscript($)
      if (scan) await update($, advisor, () => scan.advisor)
    }
    return r
  })

  // A click on a chip's chevron: the sidebar's toggles the panel, the model's
  // and the effort's their dropdowns.
  on('ui.message', { element: /^chevron-/ }, async ($, e, next) => {
    const kind = e.element.slice('chevron-'.length)
    if (kind === 'panel') await togglePanel($)
    else if (kind === 'model' || kind === 'effort') await toggleMenu($, kind)
    return next(e)
  })

  // A click on a choice in the box's picker picks it, if the picker open
  // offers it: the wire glides over to it, and its confirm applies it. The
  // one in force, clicked, takes a pick back.
  on('ui.message', { element: /^pick-(model|effort)-/ }, async ($, e, next) => {
    const [, kind, value] = /^pick-(model|effort)-(.*)$/.exec(e.element) ?? []
    const [open, m] = await Promise.all([read($, menu), read($, meta)])
    if (open && !open.isClosing && open.kind === kind && value !== undefined && open.options.includes(value)) {
      const pick = value === (kind === 'effort' ? m?.effort : aliasOf(m?.model)) ? undefined : value
      // The row makes room for the confirm, or gives it back: the motion
      // first, so no frame draws the row already moved.
      if ((pick === undefined) !== (open.pick === undefined)) await move($, 'menu-room', pick === undefined ? 0 : 1)
      await update($, menu, x => {
        if (!x) return x
        const { pick: _, ...rest } = x
        return pick === undefined ? rest : { ...rest, pick }
      })
    }
    return next(e)
  })

  // A section's header folds it or opens it again.
  on('ui.message', { element: /^fold-/ }, async ($, e, next) => {
    await toggleFold($, e.element.slice('fold-'.length))
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
  // button away. Captured off the hook's path: PowerShell takes a second.
  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    if (/\[Image #\d+\]/.test(e.inputText + e.text.slice(e.start, e.end))) void syncPreviews($).catch(() => undefined)
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    // The person's own first prompt: this session's conversation starts here.
    isAwaitingConversation = false
    scheduleGit($)
    await update($, previews, () => [])
    await update($, menu, () => null)
    await update($, motion, ({ menu: _, 'menu-room': __, ...rest }) => rest)
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
      // A main-loop request reads the cache or writes it, and either starts
      // the entry's life over.
      if (key === 'main') {
        const t = await $.clock.now()
        await update($, cache, c => ({
          at: t,
          ttlMs: ttlOf(a.cache_creation_5m_tokens, a.cache_creation_1h_tokens, c?.ttlMs),
          model: typeof a.model === 'string' ? bare(a.model) : (c?.model ?? ''),
        }))
      }
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
      if (!(await read($, panelClosed))) {
        void $.ui
          .open({ id: PANE, title: 'sidebar', columns: PANE_COLUMNS })
          .then(() => $.ui.invalidate('ui.render'))
          .catch(() => undefined)
      }
    }
    const [r, m, p, tot, delta, pasted, isPanelOpen, open, moving] = await Promise.all([
      read($, reading),
      read($, meta),
      read($, place),
      read($, totals),
      read($, last),
      read($, previews),
      // The engine's record, whoever opened or closed the panel; a change
      // redraws the band through $.ui.invalidate.
      $.ui.panes().then(panes => panes.some(pane => pane.id === PANE)),
      read($, menu),
      read($, motion),
    ])
    const pct = r?.percent ?? 0
    // The session's figures, its cost and the rate windows are the side panel's.
    const rows: Row[] = [
      { section: 0, label: p?.git ? 'repo' : 'project', content: pathRow(p) },
      { section: 1, label: 'model', content: modelRow(r, m, e.props.isWorking) },
      { section: 1, label: 'tokens', content: tokensRow(tot, delta) },
    ]
    // An open picker hangs its choices under the model row, inside the frame,
    // rolling open from the top a row a beat and shut from the bottom; the
    // terminal moves what is in them (wire.tsx, pill.tsx).
    const inForce = open && (open.kind === 'effort' ? m?.effort : aliasOf(m?.model))
    if (open) {
      // A pick made, its row stands moved to make room for the confirm; it
      // stays so while the picker folds, even once the pick is in force.
      const made = moving['menu-room']?.at ?? (open.pick === undefined ? 0 : 1)
      const { rows: picker, give } = pickRows(open, inForce, m?.model, roomOf(rows), rows[1]?.content ?? [], made)
      foldRows.set('menu', picker.length)
      foldRows.set('menu-room', Math.max(1, give))
      const at = moving.menu?.at
      rows.splice(2, 0, ...(at === undefined ? picker : picker.slice(0, Math.round(picker.length * at))))
    }
    const lines = frame(rows)

    const elements = $.ui.resolve(e)
    const { Box, Button, Client, Text } = elements
    const draw = (span: Span) => (
      <Text color={span.c} bold={span.b} dimColor={span.d} inverse={span.i}>
        {span.t}
      </Text>
    )
    // The binary's OSC 8 links become presses: Claude Code draws a Link's URL
    // as text in a terminal it judges unable to show one (VS Code's). Each
    // control is held to its text's width, so its click area is that text.
    // A chip: its words a Button, for the keyboard, and a chevron that turns
    // as what it opens opens; the two share a hover group, and a click on the
    // chevron does what the Button does. Its span ends with the chevron's two
    // cells.
    const chip = (span: Span, kind: 'panel' | 'model' | 'effort', isOpen: boolean, turn: string[], onPress: () => Promise<void>) => (
      <Box width={widthOf([span])} flexShrink={0}>
        <Button plain key={kind} hover={{ scope: kind, inverse: true }} onPress={() => void onPress().catch(() => undefined)}>
          {draw({ ...span, t: span.t.slice(0, -2) })}
        </Button>
        <Client key={`chevron-${kind}`} module="./chevron.tsx" width={2} props={{ isOpen, frames: turn, scope: kind, ...(span.c && { color: span.c }) }} />
      </Box>
    )
    const control = (span: Span) =>
      span.el === 'model' || span.el === 'effort' ? (
        chip(span, span.el, open?.kind === span.el && !open.isClosing, MENU_TURN, () => toggleMenu($, span.el as Menu['kind']))
      ) : span.el === 'panel' ? (
        chip(span, 'panel', isPanelOpen, SIDEBAR_TURN, () => togglePanel($))
      ) : span.el === 'wire' && span.w ? (
        <Client
          key={span.w.isArrow ? 'wire-arrow' : 'wire'}
          module="./wire.tsx"
          width={widthOf([span])}
          props={{ ...span.w, width: widthOf([span]), color: span.c ?? 'gray', isClosing: open?.isClosing === true }}
        />
      ) : span.el === 'pick' && open ? (
        // A choice is one Client, so it ripples in and out, and an effort
        // level plays its flourish wherever the pointer lands on it.
        <Client
          key={`pick-${open.kind}-${span.v}`}
          module="./pill.tsx"
          width={widthOf([span])}
          props={{
            label: open.kind === 'effort' ? (span.v ?? '') : span.t.slice(1, -1),
            level: open.kind === 'effort' ? (span.v ?? '') : '',
            color: open.kind === 'effort' ? effortColor(span.v ?? '') : 'magenta',
            isPicked: span.i === true,
            isInForce: span.v === inForce,
            index: open.options.indexOf(span.v ?? ''),
            count: open.options.length,
            isClosing: open.isClosing === true,
          }}
        />
      ) : span.el === 'confirm' ? (
        <Box width={widthOf([span])} flexShrink={0}>
          <Button plain key="confirm" hover={{ scope: 'confirm', inverse: true }} onPress={() => void confirmPick($).catch(() => undefined)}>
            {draw(span)}
          </Button>
        </Box>
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
          <Button plain key={span.el} onPress={() => void openUrl($, p?.remote ?? '')}>
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
        {/* Pasted images, opened in the viewer before they are sent: `#N` as
            the draft names them. The desktop app shows its own. */}
        {e.surface === 'terminal' && pasted.length > 0 && (
          <Box>
            {pasted.map(image => (
              <Box marginRight={2}>
                <Button plain dimColor key={`open-image-${image.id}`} label={`#${image.id} open ↗`} onPress={() => void openUrl($, image.path)} />
              </Box>
            ))}
          </Box>
        )}
        {/* The frame, filled with the docked panel's own background (its
            theme key). The heavy lines run through the middle of their rows,
            so half a row of it shows above and below; a half-block column
            either side keeps the sides near that, a cell being about 2.5
            times as tall as it is wide. A blank row above keeps it off the
            transcript. */}
        <Box marginTop={1}>
          <Text color="composerSidebarBackground">{lines.map(() => '▐').join('\n')}</Text>
          <Box flexDirection="column" alignItems="flex-start" backgroundColor="composerSidebarBackground">
            {lines.map(drawLine)}
          </Box>
          <Text color="composerSidebarBackground">{lines.map(() => '▌').join('\n')}</Text>
        </Box>
        {/* What a status line cannot do: act. Past the threshold, offer the fix. */}
        {pct >= 85 && !e.props.isWorking && (
          <Button key="compact" label="compact context" onPress={() => void $.session.compact()} />
        )}
      </Box>
    )
  })

  on('command.run', { command: 'sidebar' }, async $ => {
    const isPlaced = await openPanel($)
    return { text: isPlaced ? 'Side panel opened.' : 'The panel opens beside the transcript in fullscreen, from 110 columns.' }
  })

  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    if (e.id === PANE && e.origin.kind === 'person') await update($, panelClosed, () => true)
    if (e.id === PANE) $.ui.invalidate('ui.render')
    return r
  }).catch(($, e, next) => next(e))

  // The panel beside the transcript: the rate windows, the session (its
  // messages, age, speed and cost), the prompt cache, the advisor's card once
  // it has been consulted, and this session's agents with their work. Claude
  // Code docks a pane on the right; its layout has no slot on the left.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const [ags, t, adv, r, sp, n, m, fast, c, folds, moving, bytes] = await Promise.all([
      read($, agents),
      read($, now),
      read($, advisor),
      read($, reading),
      read($, spend),
      read($, turns),
      read($, meta),
      read($, speed),
      read($, cache),
      read($, folded),
      read($, motion),
      read($, transcriptBytes),
    ])
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
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
        <Client key={`working-${a.id}`} module="./claude.tsx" width={11} props={{ isWorking: true }} />
      ) : a.doneAt === null ? (
        <Text color="claude">Working</Text>
      ) : a.status === 'completed' ? (
        <Text color="green">✓ done</Text>
      ) : (
        <Text color="red">{`✗ ${a.status}`}</Text>
      )
    // A section's name in the accent behind its chevron, ruled to the edge,
    // folded ones with their summary at the end; fold.tsx sweeps the rule out.
    const header = ({ name, summary, tint = 'gray' }: Section, isOpen: boolean) =>
      Client ? (
        <Client key={`fold-${name}`} module="./fold.tsx" width={inner} props={{ name, isOpen, summary, tint, width: inner }} />
      ) : (
        <Button plain key={`fold-${name}`} onPress={() => void toggleFold($, name)}>
          <Text color="claude" bold>{`${isOpen ? '▾' : '▸'} ${name}`}</Text>
          {!isOpen && <Text color={tint}>{` ${summary}`}</Text>}
        </Button>
      )
    // A card's row of spans: a Box where a figure rolls, as a Client cannot
    // sit in a Text; `owner` keeps two cards' figures apart.
    const figures = (owner: string, value: Span[]) =>
      Client && value.some(span => span.n) ? (
        <Box>
          {value.map(span =>
            span.n ? <Client key={`n-${owner}-${span.n.k}`} module="./count.tsx" width={widthOf([span])} props={countProps({ ...span, n: span.n })} /> : draw(span),
          )}
        </Box>
      ) : (
        <Text wrap="truncate-end">{value.map(draw)}</Text>
      )
    const line = (owner: string, [label, value]: [string, Span[]]) => figures(owner, [dim(label.padEnd(8)), ...value])
    // The advisor's part of the session's cost, a whole percent.
    const share = adv?.usd != null && r?.costUsd ? Math.min(100, Math.round((adv.usd / r.costUsd) * 100)) : null
    // The card's content: the body less its border and padding.
    const meter = inner - 4
    // A bar where no Client draws one (VS Code, mobile): filled, then track.
    const flat = (percent: number, color: string) => (
      <Text>
        <Text color={color}>{'━'.repeat(Math.round((Math.min(100, Math.max(0, percent)) / 100) * meter))}</Text>
        <Text color="gray">{'─'.repeat(meter - Math.round((Math.min(100, Math.max(0, percent)) / 100) * meter))}</Text>
      </Text>
    )
    const sections: Section[] = []

    // Each rate window: its use, a bar with a tick where a steady pace would
    // stand by now, and when it resets.
    if (r && r.rate.length > 0) {
      sections.push({
        name: 'USAGE',
        summary: r.rate.map(w => `${rateFacts(w, t).name} ${Math.round(w.percentUsed)}%`).join(' · '),
        // The card's gap and border; each window its name, bar and reset, apart.
        rows: 3 + r.rate.reduce((sum, w, i) => sum + (i === 0 ? 0 : 1) + 2 + (rateFacts(w, t).remaining === null ? 0 : 1), 0),
        body: clip => (
        <Box flexDirection="column" marginTop={1} paddingX={1} borderStyle="round" borderColor="blue" {...held(clip)}>
          <Box flexDirection="column" flexShrink={0}>
            {r.rate.map((w, i) => {
              const f = rateFacts(w, t)
              const burn = Math.abs(f.burn) >= 1 ? [s(' '), num(`${w.kind}-burn`, Math.abs(f.burn), 'int', f.burn > 0 ? 'red' : 'green', f.burn > 0 ? '⇡' : '⇣', '%')] : []
              return (
                <Box key={`window-${w.kind}`} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
                  <Box justifyContent="space-between">
                    <Text bold>{f.name}</Text>
                    {figures('usage', [num(w.kind, f.pct, 'int', f.color, '', '%'), ...burn])}
                  </Box>
                  {Client ? (
                    <Client
                      key={`usage-${w.kind}`}
                      module="./bar.tsx"
                      width={meter}
                      props={{ percent: w.percentUsed, isWorking: false, width: meter, ...(f.pace !== null && { mark: f.pace }) }}
                    />
                  ) : (
                    flat(w.percentUsed, f.color)
                  )}
                  {f.remaining !== null && (
                    <Box justifyContent="space-between">
                      <Text dimColor>{`resets in ${formatDuration(f.remaining)}`}</Text>
                      <Text>
                        <Text color="white" bold>┃</Text>
                        <Text dimColor>{` pace ${f.pace}%`}</Text>
                      </Text>
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        </Box>
        ),
      })
    }

    // The session: its messages and age, the latest turn's speed, its
    // transcript's size, then its total (Claude Code's own) and who it went to, as one bar split by colour
    // and a legend of each part's dollars and share.
    const total = r?.costUsd ?? (sp.main + sp.agents + sp.background || null)
    const parts = total === null ? [] : costParts(sp, total, adv?.usd ?? 0)
    const { firstOutputMs: first, replyMs: reply } = fast
    // While a turn runs, the timing not known yet counts up with the clock.
    const running = fast.startedAt == null || t === 0 ? null : Math.max(0, t - fast.startedAt)
    const ticking = (label: string, ms: number) => (
      <Text>
        <Text dimColor>{label}</Text>
        <Text color="claude">{formatElapsed(ms)}</Text>
      </Text>
    )
    const hasSpeed = first !== null || reply !== null || running !== null
    sections.push({
      name: 'SESSION',
      summary: [`${n} ${n === 1 ? 'message' : 'messages'}`, ...(total === null ? [] : [figure('usd', total)])].join(' · '),
      // The card's gap and border, the messages, the speed, the transcript;
      // the cost, its bar and its parts, apart.
      rows: 4 + (hasSpeed ? 1 : 0) + (bytes === null ? 0 : 1) + (total === null ? 0 : 2 + (parts.length > 0 ? 1 : 0) + parts.length),
      body: clip => (
      <Box flexDirection="column" marginTop={1} paddingX={1} borderStyle="round" borderColor="claude" {...held(clip)}>
        <Box flexDirection="column" flexShrink={0}>
          <Box justifyContent="space-between">
            {figures('session', [num('messages', n, 'int', 'white'), dim(n === 1 ? ' message' : ' messages')])}
            {/* The age steps every second: drawn plainly, as a roll would never settle. */}
            {m && t > 0 && <Text color="white">{formatElapsed(t - m.startedAt)}</Text>}
          </Box>
          {hasSpeed && (
            <Box justifyContent="space-between">
              {/* 10 s and 30 s: across this machine's 895 transcript turns the same
                  wait ran p50 9.4 s, p75 18.9 s, p90 36 s, so red is about the
                  slowest eighth. */}
              {first === null ? (running === null ? <Text> </Text> : ticking('first output ', running)) : figures('session', [dim('first output '), num('first', first, 'wait', first < 10_000 ? 'green' : first < 30_000 ? 'yellow' : 'red')])}
              {reply !== null ? figures('session', [dim('reply '), num('reply', reply, 'wait', 'white')]) : first !== null && running !== null && ticking('reply ', running)}
            </Box>
          )}
          {bytes !== null && (
            <Box justifyContent="space-between">
              <Text dimColor>transcript</Text>
              <Text color="white">{formatBytes(bytes)}</Text>
            </Box>
          )}
          {total !== null && (
            <Box flexDirection="column" marginTop={1}>
              {figures('cost', [{ ...num('total', total, 'usd', total > 0.5 ? 'yellow' : 'green'), b: true }])}
              {parts.length > 0 &&
                (Client ? (
                  <Client key="cost-split" module="./split.tsx" width={meter} props={{ parts: parts.map(part => ({ key: part.label, usd: part.usd, color: part.color })), width: meter }} />
                ) : (
                  <Box key="cost-split">
                    <Text>
                      {apportion(parts.map(part => part.usd), meter).map((cells, i) => (
                        <Text color={parts[i]?.color}>{'━'.repeat(cells)}</Text>
                      ))}
                    </Text>
                  </Box>
                ))}
              {parts.map(part => (
                <Box justifyContent="space-between">
                  {figures('cost', [s('● ', part.color), dim(part.label.padEnd(12)), num(part.label, part.usd, 'usd', 'white')])}
                  {figures('cost', [num(`${part.label}-share`, Math.round((part.usd / total) * 100), 'int', part.color, '', '%')])}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Box>
      ),
    })

    // The prompt cache: warm, the next message reads the context from it at a
    // small part of the input price; cold, it writes it all again at more than
    // the input price. Counted down plainly, as the session's age is.
    if (c) {
      const left = c.at + c.ttlMs - t
      const isWarm = left > 0
      const tokens = r?.tokens ?? null
      const price = priceOf(c.model)
      const mult = orgPricing?.multiplier ?? 1
      const reread = tokens === null || price === undefined ? null : priceCall(price, { cache_read_input_tokens: tokens }) * mult
      const rewrite =
        tokens === null || price === undefined
          ? null
          : priceCall(price, { cache_creation_input_tokens: tokens, cache_creation: { ephemeral_1h_input_tokens: c.ttlMs === HOUR ? tokens : 0 } }) * mult
      sections.push({
        name: 'CACHE',
        summary: isWarm ? `● warm · ${formatElapsed(left)} left` : '○ cold',
        // The card's gap and border, warm or cold, the bar, the next message's two prices.
        rows: 4 + (isWarm ? 1 : 0) + (reread !== null && rewrite !== null && tokens !== null ? 2 : 0),
        tint: isWarm ? 'green' : 'gray',
        body: clip => (
        <Box flexDirection="column" marginTop={1} paddingX={1} borderStyle="round" borderColor={isWarm ? 'green' : 'gray'} {...held(clip)}>
          <Box flexDirection="column" flexShrink={0}>
            <Box justifyContent="space-between">
              <Text color={isWarm ? 'green' : 'gray'} bold>{isWarm ? '● warm' : '○ cold'}</Text>
              <Text color="white">{isWarm ? `${formatElapsed(left)} left` : `lasts ${c.ttlMs === HOUR ? '1h' : '5m'} idle`}</Text>
            </Box>
            {/* Refilled by each message, gliding back up as the context bar does. */}
            {isWarm &&
              (Client ? (
                <Client key="cache-left" module="./bar.tsx" width={meter} props={{ percent: (left / c.ttlMs) * 100, isWorking: false, width: meter, color: left < c.ttlMs / 5 ? 'yellow' : 'green' }} />
              ) : (
                flat((left / c.ttlMs) * 100, left < c.ttlMs / 5 ? 'yellow' : 'green')
              ))}
            {reread !== null &&
              rewrite !== null &&
              tokens !== null && [
                line('cache', ['next', [num('next', isWarm ? reread : rewrite, 'usd', isWarm ? 'green' : 'yellow'), dim(isWarm ? ' to read ' : ' to rewrite '), num('tokens', tokens, 'tokens', 'white')]]),
                line('cache', [isWarm ? 'if cold' : 'if warm', [num('other', isWarm ? rewrite : reread, 'usd', 'gray'), dim(isWarm ? ' to rewrite' : ' to read')]]),
              ]}
          </Box>
        </Box>
        ),
      })
    }

    // Double-ruled in the advisor's magenta, apart from the agents' round cards.
    if (adv) {
      sections.push({
        name: 'ADVISOR',
        summary: [`${adv.calls} ${adv.calls === 1 ? 'call' : 'calls'}`, ...(adv.usd === null ? [] : [figure('usd', adv.usd)])].join(' · '),
        // The card's gap and border, the model and calls, its rows, the share's bar.
        rows: 4 + advisorRows(adv, share).length + (share === null ? 0 : 1),
        body: clip => (
        <Box flexDirection="column" marginTop={1} paddingX={1} borderStyle="double" borderColor="magenta" {...held(clip)}>
          <Box flexDirection="column" flexShrink={0}>
            <Box justifyContent="space-between">
              <Text color="magenta" bold>{`✶ ${prettify(adv.model)}`}</Text>
              {figures('advisor', [num('calls', adv.calls, 'int', 'white'), dim(adv.calls === 1 ? ' call' : ' calls')])}
            </Box>
            {advisorRows(adv, share).map(row => line('advisor', row))}
            {/* That part as a bar, gliding as the context bar does. */}
            {share !== null &&
              (Client ? (
                <Client key="advisor-share" module="./bar.tsx" width={meter} props={{ percent: share, isWorking: false, width: meter }} />
              ) : (
                flat(share, 'magenta')
              ))}
          </Box>
        </Box>
        ),
      })
    }

    // One card per agent, its border the state's colour: at work, done, failed.
    const working = ags.filter(a => a.doneAt === null).length
    sections.push({
      name: 'AGENTS',
      summary: working > 0 ? `${working} working` : ags.length > 0 ? `${ags.length} done` : 'none yet',
      // The empty line and its gap; else each card's gap and border, its state,
      // description and rows.
      rows: shown.length === 0 ? 2 : shown.reduce((sum, a) => sum + 5 + agentRows(a).length, 0),
      tint: working > 0 ? 'claude' : 'gray',
      body: () => (
      <Box flexDirection="column">
        {shown.length === 0 && (
          <Box marginTop={1}>
            <Text dimColor>No agents in this session yet.</Text>
          </Box>
        )}
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
            {agentRows(a).map(row => line(a.id, row))}
          </Box>
        ))}
      </Box>
      ),
    })

    return (
      <Box flexDirection="column" paddingX={1}>
        {sections.map((section, i) => {
          const isOpen = !folds.includes(section.name)
          const fold = moving[`fold-${section.name}`]
          // Folding or unfolding, the body is held to the rows it has reached:
          // cut there, at its own height, for a box squeezed below its own
          // height draws its border over the rows above.
          foldRows.set(`fold-${section.name}`, section.rows)
          const clip = fold && Math.round(section.rows * fold.at)
          return (
            <Box key={`section-${section.name}`} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
              {header(section, isOpen)}
              {clip === undefined ? (
                isOpen && section.body()
              ) : (
                <Box flexDirection="column" height={clip} overflow="hidden">
                  <Box flexDirection="column" flexShrink={0}>
                    {section.body(clip)}
                  </Box>
                </Box>
              )}
            </Box>
          )
        })}
        {/* Claude Code's version, and its changelog a click away. */}
        {m?.version && (
          <Box marginTop={1} justifyContent="space-between">
            <Text dimColor>{`Claude Code v${m.version}`}</Text>
            <Button plain key="version" onPress={() => void openUrl($, CHANGELOG)}>
              <Text color="gray">changelog ›</Text>
            </Button>
          </Box>
        )}
      </Box>
    )
  })
}

// --- spans: render.rs's ANSI strings as data, so the box can be measured -----

// `i` draws it inverse; `v` is a picker pill's choice; `w` is wire.tsx's.
type Span = {
  t: string
  c?: string
  b?: boolean
  d?: boolean
  i?: boolean
  el?: 'model' | 'effort' | 'repo' | 'bar' | 'claude' | 'panel' | 'count' | 'pick' | 'wire' | 'confirm'
  n?: Count
  v?: string
  w?: { from: number; to: number; isArrow: boolean }
}
// A figure count.tsx rolls to each new value: `k` names it across redraws.
type Count = { k: string; v: number; f: Figure; before: string; after: string }
// A tight row follows the one above with no divider: a picker's lines.
type Row = { section: number; label: string; content: Span[]; isTight?: boolean }
// One of the panel's sections: what its header says while folded, in `tint`.
// `rows`: how tall its body is, every row of it one line, its fold's measure;
// `body`, given the `clip` rows it is held to while it folds.
type Section = { name: string; summary: string; tint?: string; rows: number; body: (clip?: number) => JSX.Element }

// A card held to its share of `clip`, the gap above it one row of that: its
// contents, kept at their own height (flexShrink 0) and cut, roll up inside
// its border like a drawer's, the border going last. It is never less than
// its border, which the section's own hold then cuts.
const held = (clip?: number) => (clip === undefined ? {} : { height: Math.max(2, clip - 1), overflow: 'hidden' as const })

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
      const inner = innerOf(row)
      return { section: row.section, isTight: row.isTight, inner, width: widthOf(inner) }
    })
  const max = Math.max(MIN_INNER, ...inners.map(row => row.width))
  const heavy = '━'.repeat(max)
  const divider = s(`┃ ${'─'.repeat(LABEL_W + 1)}┼${'─'.repeat(Math.max(1, max - (LABEL_W + 4)))} ┃`, 'gray')

  const lines: Span[][] = [[s(`┏${heavy}┓`, 'gray')]]
  inners.forEach((row, i) => {
    const previous = inners[i - 1]
    if (previous && !row.isTight) lines.push([previous.section === row.section ? divider : s(`┣${heavy}┫`, 'gray')])
    lines.push([s('┃', 'gray'), ...row.inner, s(' '.repeat(max - row.width)), s('┃', 'gray')])
  })
  lines.push([s(`┗${heavy}┛`, 'gray')])
  return lines
}

// A row's cells inside the frame: its label, the rule, its content.
function innerOf(row: Row): Span[] {
  return [s(' '), dim(row.label.padEnd(LABEL_W)), s(' '), s('│', 'gray'), s('  '), ...row.content, s(' ')]
}

// The content cells the frame has room for without growing past its rows.
function roomOf(rows: Row[]): number {
  const bare = widthOf(innerOf({ section: 0, label: '', content: [] }))
  return Math.max(MIN_INNER, ...rows.map(row => widthOf(innerOf(row)))) - bare
}

// Cells between the last choice and its confirm.
const CONFIRM_GAP = 2

// The open picker's choices as pills, wrapped to `room` cells and centred in
// them: the one picked (the one in force until another is clicked) inverted in
// its colour, the rest dim, an effort level's led by its glyph. A pick not yet
// in force has its confirm after the last pill: the last line gives up as many
// cells to its left as it lacks on its right, `made` of the way there, the
// confirm showing once they are made (`give`, those cells, for the ticker).
// A line too full for it even so leaves the confirm to the row below.
// wire.tsx's two rows run from the middle of its chip's words on `above`, the
// row it hangs under, to the middle of the words of the one picked (else the
// first). A blank row closes the picker, keeping it off the next row.
function pickRows(
  open: Menu,
  inForce: string | null | undefined,
  model: string | undefined,
  room: number,
  above: Span[],
  made: number,
): { rows: Row[]; give: number } {
  const isEffort = open.kind === 'effort'
  const current = open.pick ?? inForce
  const lines: Span[][] = [[]]
  for (const option of open.options) {
    const label = isEffort ? option : modelLabel(option, model)
    const tint = isEffort ? effortColor(option) : 'magenta'
    // An effort pill's first two cells are its glyph's.
    const pill: Span = {
      t: isEffort ? ` · ${label} ` : ` ${label} `,
      el: 'pick',
      v: option,
      ...(option === current ? { c: tint, b: true, i: true } : { d: true }),
    }
    const line = lines[lines.length - 1] ?? []
    if (line.length === 0) line.push(pill)
    else if (widthOf(line) + 1 + widthOf([pill]) <= room) line.push(s(' '), pill)
    else lines.push([pill])
  }
  const confirm: Span = { t: ' ✓ Confirm ', c: 'green', b: true, el: 'confirm' }
  const lastLine = lines.length - 1
  const tail = lines[lastLine] ?? []
  const centre = (line: Span[]) => Math.max(0, Math.floor((room - widthOf(line)) / 2))
  const fits = widthOf(tail) + CONFIRM_GAP + widthOf([confirm]) <= room
  const give = fits ? Math.max(0, centre(tail) + widthOf(tail) + CONFIRM_GAP + widthOf([confirm]) - room) : 0
  const centred = lines.map((line, n) => [s(' '.repeat(centre(line) - (n === lastLine ? Math.round(give * made) : 0))), ...line])
  const isPending = open.pick !== undefined && open.pick !== inForce && !open.isClosing
  if (isPending && fits && (give === 0 || made === 1)) centred[lastLine]?.push(s(' '.repeat(CONFIRM_GAP)), confirm)
  const i = above.findIndex(span => span.el === open.kind)
  const chip = above[i]
  // The chip's words end before their chevron's two cells.
  const from = chip ? widthOf(above.slice(0, i)) + Math.floor((widthOf([chip]) - 2) / 2) : -1
  const first = centred[0] ?? []
  const j = first.findIndex(span => span.v === current)
  const k = j < 0 ? first.findIndex(span => span.el === 'pick') : j
  const target = first[k]
  // A pill's words: after its space, and an effort level's glyph.
  const lead = isEffort ? 3 : 1
  const to = target ? widthOf(first.slice(0, k)) + lead + Math.floor((widthOf([target]) - lead - 1) / 2) : -1
  const wire = (isArrow: boolean): Span => ({
    t: ' '.repeat(room),
    c: isEffort ? effortColor(current ?? '') : 'magenta',
    el: 'wire',
    w: { from, to, isArrow },
  })
  const drop = from < 0 || to < 0 ? [[s('')]] : [[wire(false)], [wire(true)]]
  const last = isPending && !fits ? [s(' '.repeat(centre([confirm]))), confirm] : [s('')]
  return { rows: [...drop, ...centred, last].map(content => ({ section: 1, label: '', content, isTight: true })), give }
}

// The Model row's alias as the picker shows it, its version as the box shows
// the model: `opus[1m]` -> `Opus 5.5`.
function modelLabel(alias: string, model: string | undefined): string {
  if (model && aliasOf(model) === alias) return prettify(model)
  const family = alias.replace(/\[1m\]$/, '')
  return families[family] ?? family.replace(/^./, c => c.toUpperCase())
}

// The family aliases' models by their picker names: the `main` rows of the
// catalog Claude Code polls from Anthropic every 5 to 15 minutes, so a new
// model is named without a new plugin. A row this Claude Code is too old for
// is left out, as its own picker leaves it. shortcut: Bedrock, Vertex and
// ANTHROPIC_DEFAULT_*_MODEL can point an alias elsewhere (the pill in force
// reads the session's own model); the newest-fetched catalog stands for this
// account's, which the engine keys by org and an account hash.
async function readFamilies($: $, version: string): Promise<Record<string, string>> {
  const dir = await configDir($)
  if (!dir) return {}
  const folder = `${dir}/cache/model-catalog`
  const files = (await $.fs.list(folder).catch(() => [])).filter(entry => entry.kind === 'file' && entry.name.endsWith('-cc.json'))
  const catalogs = await Promise.all(
    files.map(entry => $.fs.read(`${folder}/${entry.name}`).then(text => JSON.parse(text) as Record<string, any>, () => null)),
  )
  const newest = catalogs.sort((a, b) => (b?.fetchedAt ?? 0) - (a?.fetchedAt ?? 0))[0]
  const rows: unknown = newest?.catalog?.config?.models
  return Object.fromEntries(
    (Array.isArray(rows) ? rows : []).flatMap(row =>
      row?.section === 'main' && typeof row.short_name === 'string' && typeof row.name === 'string' && !isNewer(row.min_claude_code_version, version)
        ? [[row.short_name.toLowerCase(), row.name]]
        : [],
    ),
  )
}

// Whether version `a` is past `b`: `2.1.400` against `2.1.300`.
function isNewer(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false
  const [x, y] = [a, b].map(v => v.split('.').map(Number))
  for (let i = 0; i < Math.max(x!.length, y!.length); i++) {
    const [p, q] = [x![i] ?? 0, y![i] ?? 0]
    if (p !== q) return p > q
  }
  return false
}

function pathRow(p: Place | null): Span[] {
  const git = p?.git
  const path: Span[] = [{ ...s(formatCwd(p?.cwd ?? '', p?.home ?? null), 'cyan'), el: p?.remote ? 'repo' : undefined }]
  // A press opens the panel, or closes it while it is open.
  const panel: Span[] = [{ ...dim(`sidebar ${SIDEBAR_TURN[0]}`), el: 'panel' }]
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

// Folds a panel section or opens it again, and keeps the choice for the
// sessions after.
async function toggleFold($: $, name: string): Promise<void> {
  const wasFolded = (await read($, folded)).includes(name)
  // The motion first: while it runs it alone sets the body's height, so the
  // flip after it never draws a frame of the body already open or shut.
  await move($, `fold-${name}`, wasFolded ? 1 : 0)
  const list = await update($, folded, xs => (wasFolded ? xs.filter(x => x !== name) : [...xs, name]))
  // Folded this session even where the choice cannot be kept.
  await $.store.set('folded', list).catch(() => undefined)
}

// --- folds: the box's picker, a panel section's body -------------------------

// A row a beat, evenly: rows arriving at a steady pace read as one smooth
// wipe, where an eased curve over a few whole rows reads as pause and jump. A
// tall body goes quicker, so no fold takes longer than MOST_MS.
const ROW_MS = 24
const MOST_MS = 320
// Each fold's rows, by its motion's key, as its last drawing counted them.
const foldRows = new Map<string, number>()

// Sets `key` folding open (1) or shut (0) from wherever it stands, the other
// end where it stands nowhere, and starts the ticker if it is still.
async function move($: $, key: string, to: 0 | 1): Promise<void> {
  await update($, motion, moving => ({ ...moving, [key]: { at: moving[key]?.at ?? 1 - to, to } }))
  ticker ??= $.clock.every(ROW_MS, () => void stepFolds($).catch(() => undefined))
}

// One beat: each fold a row nearer its end, and dropped there; a picker
// rolled shut leaves the box. With nothing left moving, the ticker stops.
async function stepFolds($: $): Promise<void> {
  const shut: string[] = []
  const left = await update($, motion, moving => {
    const next: Record<string, Motion> = {}
    for (const [key, { at, to }] of Object.entries(moving)) {
      const step = Math.max(1 / (foldRows.get(key) ?? 8), ROW_MS / MOST_MS)
      const reached = to === 1 ? Math.min(1, at + step) : Math.max(0, at - step)
      if (reached !== to) next[key] = { at: reached, to }
      else if (to === 0) shut.push(key)
    }
    return next
  })
  if (shut.includes('menu')) await update($, menu, x => (x?.isClosing ? null : x))
  if (Object.keys(left).length === 0) {
    ticker?.cancel()
    ticker = null
  }
}

// Opens a chip's dropdown, or shuts it when it is the one open: the model's
// choices are Claude Code's own Model row in /config, the effort's its levels.
// One choice per model: on a 1M session a model's 1M alias stands in for it,
// so a pick keeps the context window; a switch of window is /model's, and so
// are `opusplan` (Opus while planning, Sonnet otherwise) and `best` (the
// strongest model, already offered by name), left out.
async function toggleMenu($: $, kind: Menu['kind']): Promise<void> {
  const open = await read($, menu)
  // Its own chip again: it folds away, or mid-fold opens back up, rolling down
  // again from wherever it stands.
  if (open?.kind === kind && !open.isClosing) return shutMenu($)
  if (open?.kind === kind) {
    if ((await read($, motion)).menu) await move($, 'menu', 1)
    return void (await update($, menu, x => x && { ...x, isClosing: false }))
  }
  let options: string[] = [...LEVELS]
  if (kind === 'model') {
    const [rows, m] = await Promise.all([$.config.list(), read($, meta)])
    families = await readFamilies($, m?.version ?? '')
    const all = rows.find(row => row.key === 'model')?.options ?? []
    const isLong = m?.model.endsWith('[1m]') === true
    options = all.filter(o => !o.endsWith('[1m]') && o !== 'opusplan' && o !== 'best').map(o => (isLong && all.includes(`${o}[1m]`) ? `${o}[1m]` : o))
  }
  // From shut it rolls open, the motion first so no frame draws it whole; the
  // other picker, open, simply gives way to it. Its row starts unmoved.
  if (!open || (open.isClosing && (await read($, motion)).menu)) await move($, 'menu', 1)
  await update($, motion, ({ 'menu-room': _, ...rest }) => rest)
  await update($, menu, () => ({ kind, options }))
}

// How long a picker's choices take to ripple out and its wire to all but draw
// back into the chip, before its rows roll shut.
const CLOSE_MS = 220
// Which fold is the latest, so an earlier one's timer, the picker opened and
// folded again since, leaves it be.
let shutting = 0

// Folds the picker away: its choices out, then its rows rolled shut, and the
// ticker drops it from the box.
async function shutMenu($: $): Promise<void> {
  if (!(await update($, menu, x => x && { ...x, isClosing: true }))) return
  const fold = ++shutting
  $.clock.after(CLOSE_MS, () => {
    if (fold === shutting) void read($, menu).then(x => (x?.isClosing ? move($, 'menu', 0) : undefined)).catch(() => undefined)
  })
}

// The confirm under a picker's choices: the one picked, applied.
async function confirmPick($: $): Promise<void> {
  const open = await read($, menu)
  if (open?.pick !== undefined && !open.isClosing) await choose($, open.kind, open.pick)
}

// A choice from a dropdown. The model goes through /config's Model row, as the
// person's pick there would, and a refusal (Fable before its consent) shows as
// a toast. The effort is the box's own, for this session: it goes out on each
// request (turn.step) and is saved nowhere.
async function choose($: $, kind: Menu['kind'], value: string): Promise<void> {
  await shutMenu($)
  if (kind === 'effort') {
    await update($, override, () => value)
    await update($, meta, x => x && { ...x, effort: value })
    return
  }
  const r = await $.config.set({ key: 'model', value })
  if (r.deny !== undefined) return $.ui.toast(r.deny)
  const model = await $.session.model()
  await update($, meta, x => x && { ...x, model })
}

// shortcut: the Model row's alias for a model id, guessed from its family and
// a 1M suffix; `default` is never marked as in force
function aliasOf(model: string | undefined): string | undefined {
  const family = /fable|opus|sonnet|haiku/.exec(model ?? '')?.[0]
  return family && `${family}${model?.endsWith('[1m]') ? '[1m]' : ''}`
}

// The box's control: closes the panel when the engine holds it open, and
// keeps it closed as the person's close would; opens it otherwise.
async function togglePanel($: $): Promise<void> {
  if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
    await update($, panelClosed, () => true)
    await $.ui.close({ id: PANE })
  } else await openPanel($)
  $.ui.invalidate('ui.render')
}

// Opens the panel with the keyboard; false where the surface cannot place it
// (the main screen, or under 110 columns).
async function openPanel($: $): Promise<boolean> {
  await update($, panelClosed, () => false)
  return (await $.ui.open({ id: PANE, title: 'sidebar', focus: true, columns: PANE_COLUMNS })).isPlaced
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
    [{ ...s(`${m?.model ? prettify(m.model) : 'unknown'} ${MENU_TURN[0]}`, 'magenta'), el: 'model' }],
    m?.effort ? [{ ...s(`${m.effort} effort ${MENU_TURN[0]}`, effortColor(m.effort)), el: 'effort' }] : [],
    // Drawn by claude.tsx: the spark's three-cell track and `working`, or `●  ready`.
    [{ t: isWorking ? '    Working' : '●  ready', el: 'claude' }],
  ])
}

// The four buckets, each with the latest turn's share.
function tokensRow(tot: Tokens, delta: Tokens): Span[] {
  return join([
    bucket('in', 'in', '', tot.in, delta.in, 'cyan', 'cyan'),
    bucket('cacheWrite', 'cache', '↑', tot.cacheWrite, delta.cacheWrite, 'gray', 'yellow'),
    bucket('cacheRead', 'cache', '↓', tot.cacheRead, delta.cacheRead, 'gray', 'cyan'),
    bucket('out', 'out', '', tot.out, delta.out, 'magenta', 'magenta'),
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

// The advisor card's rows: its tokens, and its dollars, already inside the
// session's total (Claude Code's own), with the part of that total they are.
function advisorRows(a: Advisor, share: number | null): [string, Span[]][] {
  const rows: [string, Span[]][] = [['tokens', join([[num('in', a.in, 'tokens', 'cyan'), dim(' in')], [num('out', a.out, 'tokens', 'magenta'), dim(' out')]])]]
  if (a.usd !== null) {
    const part = share === null ? [] : [dim(' · '), num('share', share, 'int', 'magenta', '', '%'), dim(' of session')]
    rows.push(['cost', [num('usd', a.usd, 'usd', a.usd > 0.5 ? 'yellow' : 'green'), ...part]])
  }
  return rows
}

// The engine's request classes, as its own `ns` splits a query source; a
// request that names none is the main loop's, as the engine reads it.
function spendClass(source: unknown): keyof Spend {
  if (typeof source !== 'string' || source.startsWith('repl_main_thread') || source === 'sdk') return 'main'
  if (source.startsWith('agent:') || source === 'hook_agent') return 'agents'
  return 'background'
}

// The session's cost as the panel splits it, by who asked: summing to Claude
// Code's own total, `earlier` being what this process spent before the mod saw
// it, or what a resumed session spent in an earlier one. Empty until a request
// record has been seen.
//
// The advisor's calls run inside main-loop requests, whose records price them
// in: its dollars are carved out of `main`, and what main cannot hold (calls
// from before the mod saw the session) out of `earlier`, so nothing counts twice.
function costParts(x: Spend, total: number, advisor: number): { label: string; usd: number; color: string }[] {
  if (x.main + x.agents + x.background === 0) return []
  const earlier = Math.max(0, total - x.main - x.agents - x.background)
  const adv = Math.min(Math.max(0, advisor), x.main + earlier)
  const fromMain = Math.min(x.main, adv)
  return [
    { label: 'main', usd: x.main - fromMain, color: 'claude' },
    { label: 'advisor', usd: adv, color: 'magenta' },
    { label: 'agents', usd: x.agents, color: 'cyan' },
    { label: 'background', usd: x.background, color: 'blue' },
    { label: 'earlier', usd: earlier - (adv - fromMain), color: 'gray' },
  ].filter(part => part.usd >= 0.00005)
}

// A rate window's use, the use a steady pace would have reached by now (`pace`,
// null outside a window of known length) and the seconds left to its reset.
function rateFacts(w: RateWindow, t: number) {
  const [name, span] = RATE[w.kind] ?? [w.kind, 0]
  const pct = Math.round(w.percentUsed)
  const remaining = w.resetsAt ? Math.floor((Date.parse(w.resetsAt) - t) / 1000) : NaN
  const isInWindow = remaining > 0 && remaining <= span
  const pace = isInWindow ? Math.floor(((span - remaining) * 100) / span) : null
  return {
    name,
    pct,
    color: pct >= 80 ? 'red' : pct >= 50 ? 'yellow' : 'green',
    pace,
    burn: pace === null ? 0 : pct - pace,
    remaining: isInWindow ? remaining : null,
  }
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
async function checkThresholds($: $, r: Reading, limits: { context: number; rate: number }, sounds: boolean) {
  const was = await read($, alerted)
  const next = { ...was }
  const pct = Math.round(r.percent ?? 0)
  if (pct < limits.context) next.context = false
  else if (limits.context > 0 && !was.context) {
    next.context = true
    void notify($, 'context_high', sounds)
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
    void notify($, 'rate_limit', sounds)
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
// The ticker that moves the folds, running only while one moves.
let ticker: { cancel: () => void } | null = null
// Set while a session that started empty may still be handed its conversation.
let isAwaitingConversation = false
let seedTries = 0
const SEED_TRIES = 10
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

// What the transcript says of the session it now holds: its tokens, prompts,
// advisor and cache, and the effort of its last request where none is known
// (settings may name none). False where there is no transcript to read.
async function seed($: $): Promise<boolean> {
  const scan = await readTranscript($)
  if (!scan) return false
  await measureTranscript($)
  await update($, totals, () => scan.main)
  await update($, advisor, () => scan.advisor)
  await update($, turns, () => scan.prompts)
  if (scan.cache) await update($, cache, () => scan.cache)
  if (scan.effort) await update($, meta, m => m && { ...m, effort: m.effort ?? scan.effort })
  return true
}

// The transcript's size, for the SESSION card: looked at as the session seeds
// and after each turn, never on the clock.
async function measureTranscript($: $): Promise<void> {
  const path = await transcriptPath($)
  const stat = path ? await $.fs.stat(path).catch(() => null) : null
  await update($, transcriptBytes, () => stat?.size ?? null)
}

// Each second while awaited: once the engine holds a conversation, seed from
// its transcript; a few tries for the file to land, then it gives up.
async function awaitConversation($: $): Promise<void> {
  if ((await $.session.turns()) === 0 || !isAwaitingConversation) return
  isAwaitingConversation = false
  if (!(await seed($)) && ++seedTries < SEED_TRIES) isAwaitingConversation = true
}

// The session's spend from its transcript, each main-loop message counted
// once: the main model's tokens (top-level usage, which leaves the advisor
// out) and the advisor's calls (its `usage.iterations`). The binary sums
// every line, and a message spans several, so it reads ~2x. Its last
// main-loop row says how warm a resumed session's cache still is.
async function readTranscript(
  $: $,
): Promise<{ main: Tokens; advisor: Advisor | null; prompts: number; cache: Cache | null; effort: string | null } | null> {
  try {
    const path = await transcriptPath($)
    if (!path) return null
    const byMessage = new Map<string, { main: Tokens; calls: Iteration[] }>()
    let prompts = 0
    let cached: Cache | null = null
    let effort: string | null = null
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
        if (typeof row.effort === 'string') effort = row.effort
        const at = Date.parse(row.timestamp)
        if (Number.isFinite(at)) {
          const ttlMs = ttlOf(u.cache_creation?.ephemeral_5m_input_tokens, u.cache_creation?.ephemeral_1h_input_tokens, cached?.ttlMs)
          cached = { at, ttlMs, model: String(row.message.model ?? '') }
        }
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
      cache: cached,
      effort,
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

// Claude Code reads a pasted image into memory and deletes its file, so the
// capture saves the clipboard it was just pasted from, as a PNG beside the
// others, for the button to open; a day on, the next capture deletes it.
// Exits 1 when the clipboard holds no image.
const SAVE_PS =
  'Add-Type -AssemblyName System.Windows.Forms, System.Drawing;' +
  '$img = [System.Windows.Forms.Clipboard]::GetImage(); if ($null -eq $img) { exit 1 };' +
  "Get-ChildItem -LiteralPath (Split-Path $env:STATUSBOX_SAVE) -Filter 'statusbox-*.png' | Where-Object LastWriteTime -lt (Get-Date).AddDays(-1) | Remove-Item -ErrorAction SilentlyContinue;" +
  '$img.Save($env:STATUSBOX_SAVE, [System.Drawing.Imaging.ImageFormat]::Png)'

const captured = new Set<number>()

// The draft's `[Image #N]`s, each with a button that opens it: a new one
// captured once from the clipboard, one no longer in the draft dropped.
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
// through PowerShell too; elsewhere a paste gets no button
async function captureClipboard($: $, id: number): Promise<Preview | null> {
  const [os, temp, session] = await Promise.all([$.env.get('OS'), $.env.get('TEMP'), $.session.id()])
  if (os !== 'Windows_NT' || !temp) return null
  const path = `${temp.replace(/[\\/]+$/, '')}\\statusbox-${session.replace(/[^\w-]/g, '_')}-${id}.png`
  const r = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Sta', '-Command', SAVE_PS], {
    env: { STATUSBOX_SAVE: path },
    timeoutMs: 10_000,
  })
  return r.exitCode === 0 ? { id, path } : null
}

const isCost = (v: unknown, max = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max

// Everything besides the catalog that sets what Claude Code charges, each
// checked as the engine checks it: prices it fetched for models newer than its
// catalog, a model it prices as another until a date (`alder_ford`), and an
// org's `modelPricing` from trusted managed policy.
async function readPrices($: $): Promise<void> {
  const config = await globalConfigPath($)
    .then(path => (path ? $.fs.read(path) : '{}'))
    // A file half written (or unreadable) prices from the catalog alone.
    .then(text => JSON.parse(text) as Record<string, any>)
    .catch(() => ({}) as Record<string, any>)
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
    // An org's row carries no ×1.1; the org's multiplier is on either.
    const org = orgPricing?.overrides[model.toLowerCase()]
    const p = priceOf(model)
    sum.in += (call.input_tokens ?? 0) + (call.cache_read_input_tokens ?? 0) + written(call)
    sum.out += call.output_tokens ?? 0
    usd = usd === null || p === undefined ? null : usd + priceCall(p, org ? { ...call, inference_geo: null } : call) * (orgPricing?.multiplier ?? 1)
  }
  return { model: calls.at(-1)?.model ?? '', calls: calls.length, ...sum, usd }
}

// The engine's order: an org's row for the model, else the catalog's price,
// remapped while a remap stands, else a fetched one.
function priceOf(model: string): Price | undefined {
  return orgPricing?.overrides[model.toLowerCase()] ?? PRICE[priceRemap[model] ?? ''] ?? PRICE[model] ?? newerPrices[model]
}

// The id the price table keys: `claude-opus-5-5[1m]` -> `claude-opus-5-5`.
const bare = (model: string) => model.replace(/\[.*\]$/, '')

// What a request's cache write says of the entry's life; one that wrote
// nothing leaves it as it was.
function ttlOf(fiveMinute: unknown, hour: unknown, was: number | undefined): number {
  return Number(hour) > 0 ? HOUR : Number(fiveMinute) > 0 ? FIVE_MINUTES : (was ?? FIVE_MINUTES)
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

// A file's size in 1024s, as a file manager shows it: `512 B`, `4.5 MB`.
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  let size = n / 1024
  let unit = 'KB'
  for (const next of ['MB', 'GB']) {
    if (size < 1024) break
    size /= 1024
    unit = next
  }
  return `${size.toFixed(1)} ${unit}`
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
