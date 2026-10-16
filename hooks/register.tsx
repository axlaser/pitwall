import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage, TurnStepInput } from 'claude-code'

import type { Advisor, Agent, Alerted, Cache, Git, Menu, Motion, Place, Preview, RateWindow, Reading, Speed, Spend, Tokens, Verdicts } from '../types'
import { figure, formatElapsed } from './count'
import { RAMP_HIGH, RAMP_MID } from './bar'
import { READY_CELLS, WORKING_CELLS } from './claude'
import { apportion } from './split'
import type { Figure } from './count'
import { ground, keepGround, unground } from './ground'
import { notify } from './notify'
import { isKnownLightTheme, paletteOf, skinOfTheme } from './skin'
import { promptRow, replyBlock, toolRow } from './history'
import type { Palette } from './skin'

type $ = EngineInterface

const ZERO: Tokens = { in: 0, cacheWrite: 0, cacheRead: 0, out: 0 }
const reading = atom({ plugin: 'pitwall', key: 'reading' } as const, null)
const meta = atom({ plugin: 'pitwall', key: 'meta' } as const, null)
const place = atom({ plugin: 'pitwall', key: 'place' } as const, null)
const totals = atom({ plugin: 'pitwall', key: 'totals' } as const, ZERO)
const last = atom({ plugin: 'pitwall', key: 'last' } as const, ZERO)
const advisor = atom({ plugin: 'pitwall', key: 'advisor' } as const, null)
const agentAdvisor = atom({ plugin: 'pitwall', key: 'agentAdvisor' } as const, {} as Record<string, Advisor>)
const override = atom({ plugin: 'pitwall', key: 'override' } as const, null)
const turns = atom({ plugin: 'pitwall', key: 'turns' } as const, 0)
const agents = atom({ plugin: 'pitwall', key: 'agents' } as const, [])
const stopArmed = atom({ plugin: 'pitwall', key: 'stopArmed' } as const, null)
const NO_SPEND: Spend = { main: 0, agents: 0, background: 0 }
const spend = atom({ plugin: 'pitwall', key: 'spend' } as const, NO_SPEND)
const NO_SPEED: Speed = { firstOutputMs: null, replyMs: null, startedAt: null }
const speed = atom({ plugin: 'pitwall', key: 'speed' } as const, NO_SPEED)
const cache = atom({ plugin: 'pitwall', key: 'cache' } as const, null)
const transcriptBytes = atom({ plugin: 'pitwall', key: 'transcriptBytes' } as const, null)
const menu = atom({ plugin: 'pitwall', key: 'menu' } as const, null)
const motion = atom({ plugin: 'pitwall', key: 'motion' } as const, {} as Record<string, Motion>)
const folded = atom({ plugin: 'pitwall', key: 'folded' } as const, [] as string[])
const previews = atom({ plugin: 'pitwall', key: 'previews' } as const, [] as Preview[])
const now = atom({ plugin: 'pitwall', key: 'now' } as const, 0)
const panelClosed = atom({ plugin: 'pitwall', key: 'panelClosed' } as const, false)
const skin = atom({ plugin: 'pitwall', key: 'skin' } as const, 'classic' as string)
const isLight = atom({ plugin: 'pitwall', key: 'isLight' } as const, false)
const chatSkinned = atom({ plugin: 'pitwall', key: 'chatSkinned' } as const, true)
const grounded = atom({ plugin: 'pitwall', key: 'grounded' } as const, true)
const took = atom({ plugin: 'pitwall', key: 'took' } as const, {} as Record<string, number>)
const TOOK_KEPT = 200
const NOT_ALERTED: Alerted = { context: false, rate: {} }
const alerted = atom({ plugin: 'pitwall', key: 'alerted' } as const, NOT_ALERTED)
const NO_VERDICTS: Verdicts = { allowed: 0, blocked: 0 }
const verdicts = atom({ plugin: 'pitwall', key: 'verdicts' } as const, NO_VERDICTS)

const CHANGELOG = 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md'
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const PANE = 'sidebar'
const PANE_COLUMNS = 40
const SIDEBAR_TURN = ['›', '>', '|', '<', '‹']
const MENU_TURN = ['▾', '▸', '▴']
const CHEVRON_CELLS = 2
const PILL_LEAD = { effort: ' · ', model: ' ' }
const PILL_TAIL = ' '
const NOT_OFFERED = ['default', 'opusplan', 'best']
const FAMILY_ORDER = ['haiku', 'sonnet', 'opus', 'fable']
const FIRST_OUTPUT_FAST_MS = 10_000
const FIRST_OUTPUT_SLOW_MS = 30_000
const US_INFERENCE_MULTIPLIER = 1.1
let families: Record<string, string> = {}

const sparkInk = (P: Palette) => ({ accent: P.accent, glowHex: P.accentShine, ok: P.ok })
const barInk = (P: Palette) => ({ ramp: P.ramp, track: P.track, paceColor: P.mark })
const ENDED_SHOWN = 5
const ENDED = new Set(['completed', 'failed', 'killed'])
const LINGER_MS = 60_000
const STOP_ARM_MS = 4000
const RATE: Record<string, [string, number]> = { five_hour: ['5-hour', 18_000], seven_day: ['7-day', 604_800] }
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
const FIVE_MINUTES = 300_000
const HOUR = 3_600_000
const LABEL_W = 7
const CACHE_LABEL = 'cache '
const TITLE_TAIL = 10
const TITLE_ARROW = 3
const STOPPING = 'stopping…'
const STATE_CELLS = Math.max(WORKING_CELLS, STOPPING.length)
const IF_RESUMED = ' if resumed'
const LEFT_CELLS = 7
const MIN_BAR = 4
const MIN_TYPE = 6
const BACK = '‹ main conversation'
const BAR_WIDTH = 30
const MIN_INNER = 30
const MIN_BOX_BAR = 10
const BRANCH_CELLS = 20

export const register: Register = (on, options) => {
  const sounds = options.sounds !== false
  const limits = { context: Number(options.contextAlert ?? 70), rate: Number(options.rateLimitAlert ?? 80) }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await seedSession($)
    await seedSkin($, options)
    await $.command.register({ name: 'sidebar', description: 'Open the side panel: usage, the session and its cost, the prompt cache, the advisor and agents' })
    $.clock.every(1000, () => {
      void $.clock
        .now()
        .then(t => update($, now, () => t))
        .catch(() => undefined)
      if (isAwaitingConversation) void awaitConversation($).catch(() => undefined)
    })
    return r
  })

  // A /resume, a /clear or a fork goes on in this process under another
  // session: the engine drops every value a plugin keeps as the last one ends
  // and raises no session.start for this one.
  on('classic.SessionStart', async ($, e, next) => {
    const isAnother = e.source === 'resume' || e.source === 'clear' || e.source === 'fork'
    if (isAnother && e.session_id !== seededFor) {
      void seedSession($).catch(() => undefined)
      void seedSkin($, options)
        .then(() => keepGround($))
        .catch(() => undefined)
    }
    return next(e)
  })

  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const r = await next(e)
    if ('value' in r) {
      await update($, skin, () => skinOfTheme(r.value)?.skin ?? 'classic')
      await update($, isLight, () => isKnownLightTheme(r.value))
    }
    return r
  })
  on('config.set', { key: 'pitwall.chatSkin' }, async ($, e, next) => {
    const r = await next(e)
    if ('value' in r) await update($, chatSkinned, () => r.value !== false)
    return r
  })
  on('config.set', { key: 'pitwall.terminalBackground' }, async ($, e, next) => {
    const r = await next(e)
    if ('value' in r) await update($, grounded, () => r.value !== false)
    return r
  })

  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear' && e.reason !== 'resume') await unground($)
    if (e.reason === 'clear') {
      const t = await $.clock.now()
      await update($, totals, () => ZERO)
      await update($, last, () => ZERO)
      await update($, advisor, () => null)
      await update($, agentAdvisor, () => ({}))
      await update($, override, () => null)
      await update($, turns, () => 0)
      await update($, spend, () => NO_SPEND)
      await update($, speed, () => NO_SPEED)
      await update($, cache, () => null)
      await update($, verdicts, () => NO_VERDICTS)
      await update($, stopArmed, () => null)
      await update($, meta, m => m && { ...m, startedAt: t })
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const r = toReading(e)
    await update($, reading, () => r)
    if (r.rate.length > 0) void $.store.set('rate', r.rate).catch(() => undefined)
    void checkThresholds($, r, limits, sounds).catch(() => undefined)
    return next(e)
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    void notify($, 'permission', sounds)
    return next(e)
  })
  on('classic.Stop', async ($, e, next) => {
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
    await update($, cache, c => c && { ...c, at: null })
    return next(e)
  })
  on('classic.PostModelSwitch', async ($, e, next) => {
    const model = bare(e.to_model)
    if (model !== bare(e.from_model)) await update($, cache, c => c && { ...c, at: null, model })
    await adoptModel($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      await refreshAgents($)
    } else {
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
      const m = await read($, meta)
      let pick = await read($, override)
      const isEffortSetSince = pick !== null && m?.sessionEffort != null && effort !== m.sessionEffort
      if (isEffortSetSince) {
        await update($, override, () => null)
        pick = null
      }
      if (pick !== null && e.effort !== undefined) sent = { ...e, effort: pick as TurnStepInput['effort'] }
      await update($, meta, x => x && { ...x, model, sessionEffort: effort, effort })
    } else {
      await update($, agents, list => list.map(a => (a.id === id ? { ...a, model, effort } : a)))
    }
    const sentAt = await $.clock.now()
    const result = yield* next(sent)
    if (id !== undefined && result.usage) {
      const u = result.usage
      const key = usageKey(u.input_tokens, u.output_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens)
      const cost = take(unmatchedCosts, key)
      if (cost === undefined) remember(unmatchedSteps, key, id)
      const prompt = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      await update($, agents, list =>
        list.map(a =>
          a.id === id
            ? {
                ...a,
                context: prompt,
                in: (a.in ?? 0) + u.input_tokens,
                out: a.out + u.output_tokens,
                cacheRead: (a.cacheRead ?? 0) + u.cache_read_input_tokens,
                cacheWrite: (a.cacheWrite ?? 0) + u.cache_creation_input_tokens,
                calls: (a.calls ?? 0) + 1,
                usd: a.usd + (cost?.usd ?? 0),
                cacheAt: sentAt,
                cacheTtlMs: cost ? cost.ttl(a.cacheTtlMs) : (a.cacheTtlMs ?? FIVE_MINUTES),
              }
            : a,
        ),
      )
    }
    if (id === undefined && result.usage) {
      const u = result.usage
      const step: Tokens = { in: u.input_tokens, cacheWrite: u.cache_creation_input_tokens, cacheRead: u.cache_read_input_tokens, out: u.output_tokens }
      await update($, last, x => add(x, step))
      await update($, totals, x => add(x, step))
    }
    // session.measure fires once per turn
    if (id === undefined) await refreshReading($)
    if (result.serverToolUses?.some(use => use.name === 'advisor')) {
      if (id === undefined) isAdvisorPending = true
      else advisedAgents.add(id)
      void (id === undefined ? refreshAdvisor($) : refreshAgentAdvisor($, id)).catch(() => undefined)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) {
      await refreshAgents($)
      if (advisedAgents.delete(e.agentId)) await refreshAgentAdvisor($, e.agentId)
      return r
    }
    await update($, speed, x => ({ ...x, replyMs: e.durationMs, startedAt: null }))
    scheduleGit($)
    await refreshReading($)
    await measureTranscript($)
    // The API reports an advisor call's tokens nowhere but the transcript.
    if (isAdvisorPending) {
      isAdvisorPending = false
      await refreshAdvisor($)
    }
    return r
  })

  on('ui.message', { element: /^(chevron|chip)-/ }, async ($, e, next) => {
    const kind = e.element.replace(/^(chevron|chip)-/, '')
    if (kind === 'panel') await togglePanel($)
    else if (kind === 'model' || kind === 'effort') await toggleMenu($, kind)
    return next(e)
  })

  on('ui.message', { element: /^pick-(model|effort)-/ }, async ($, e, next) => {
    const [, kind, value] = /^pick-(model|effort)-(.*)$/.exec(e.element) ?? []
    const [open, m, chosenEffort] = await Promise.all([read($, menu), read($, meta), read($, override)])
    if (open && !open.isClosing && open.kind === kind && value !== undefined && open.options.includes(value)) {
      const pick = value === (kind === 'effort' ? (chosenEffort ?? m?.effort) : aliasOf(m?.model)) ? undefined : value
      const isRoomChanging = (pick === undefined) !== (open.pick === undefined)
      await animate($, 'menu-room', pick === undefined ? 0 : 1, isRoomChanging, () =>
        update($, menu, x => {
          if (!x) return x
          const { pick: _, ...rest } = x
          return pick === undefined ? rest : { ...rest, pick }
        }),
      )
    }
    return next(e)
  })

  on('ui.message', { element: /^fold-/ }, async ($, e, next) => {
    await toggleFold($, e.element.slice('fold-'.length))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const started = await $.clock.now()
    const r = await next(e)
    if (r.deny === undefined && !r.isReadOnly) scheduleGit($)
    const id = e.tool_use_id
    if (id) {
      const ms = (await $.clock.now()) - started
      await update($, took, x => Object.fromEntries([...Object.entries(x), [id, ms] as const].slice(-TOOK_KEPT)))
    }
    return r
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const P = await chatPalette($)
    if (P === null) return next(e)
    const [ms, p] = await Promise.all([read($, took), read($, place)])
    return toolRow($.ui.resolve(e), P, e.props, ms[e.props.tool_use_id], { cwd: p?.cwd ?? '', home: p?.home ?? null })
  })
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.origin.kind !== 'composer') return next(e)
    const P = await chatPalette($)
    if (P === null) return next(e)
    return promptRow($.ui.resolve(e), P, e.props.text)
  })
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const P = await chatPalette($)
    if (P === null) return next(e)
    return replyBlock($.ui.resolve(e), P, e.props)
  })

  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    if (/\[Image #\d+/.test(e.text + r.text)) void syncPreviews($, r.text, true).catch(() => undefined)
    return r
  })

  on('prompt.change', async ($, e, next) => {
    const r = await next(e)
    void syncPreviews($, e.text, e.origin.kind === 'engine').catch(() => undefined)
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    isAwaitingConversation = false
    scheduleGit($)
    draftImageIds = new Set()
    await update($, previews, () => [])
    await update($, menu, () => null)
    await update($, motion, ({ menu: _, 'menu-room': __, ...rest }) => rest)
    const r = await next(e)
    if (r.drop === undefined && !e.command && !e.isMeta) await update($, turns, n => n + 1)
    return r
  })

  on('telemetry.log', { to: 'collector' }, async ($, e, next) => {
    const r = await next(e)
    const usd = e.attributes.cost_usd
    if (e.event === 'api_request' && typeof usd === 'number') {
      const a = e.attributes
      const key = spendClass(a.query_source)
      await update($, spend, x => ({ ...x, [key]: x[key] + usd }))
      if (key === 'main') {
        const took = Number(a.duration_ms)
        const t = (await $.clock.now()) - (took > 0 ? took : 0)
        await update($, cache, c => ({
          at: t,
          ttlMs: ttlOf(a.cache_creation_5m_tokens, a.cache_creation_1h_tokens, c?.ttlMs),
          model: typeof a.model === 'string' ? bare(a.model) : (c?.model ?? ''),
        }))
      }
      if (key === 'agents') {
        const tokens = usageKey(Number(a.input_tokens), Number(a.output_tokens), Number(a.cache_read_tokens), Number(a.cache_creation_tokens))
        const id = take(unmatchedSteps, tokens)
        const ttl = (was: number | undefined) => ttlOf(a.cache_creation_5m_tokens, a.cache_creation_1h_tokens, was)
        if (id === undefined) remember(unmatchedCosts, tokens, { usd, ttl })
        else await update($, agents, list => list.map(x => (x.id === id ? { ...x, usd: x.usd + usd, cacheTtlMs: ttl(x.cacheTtlMs) } : x)))
      }
      await refreshReading($)
    }
    const verdict = e.event === 'tool_decision' ? e.attributes.classifier_verdict : undefined
    if (verdict === 'allow') await update($, verdicts, x => ({ ...x, allowed: x.allowed + 1 }))
    if (verdict === 'block') await update($, verdicts, x => ({ ...x, blocked: x.blocked + 1 }))
    return r
  })

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
    if (e.props.hasSurvey || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    const { P } = await paint($)
    if (e.surface === 'terminal') ground($, (await read($, grounded)) && P.bg ? { bg: P.bg, text: P.text } : null)
    if (!isPanelOffered && e.viewport?.isFullscreen === true) {
      isPanelOffered = true
      if (!(await read($, panelClosed))) {
        void $.ui
          .open({ id: PANE, title: 'SIDEBAR', columns: PANE_COLUMNS })
          .then(() => $.ui.invalidate('ui.render'))
          .catch(() => undefined)
      }
    }
    const [r, session, chosenEffort, p, tot, delta, pasted, isPanelOpen, open, moving] = await Promise.all([
      read($, reading),
      read($, meta),
      read($, override),
      read($, place),
      read($, totals),
      read($, last),
      read($, previews),
      $.ui.panes().then(panes => panes.some(pane => pane.id === PANE)),
      read($, menu),
      read($, motion),
    ])
    const m = session && { ...session, effort: chosenEffort ?? session.effort }
    const pct = r?.percent ?? 0
    const avail = e.props.bodyColumns - 4
    const room = avail - widthOf(innerOf(P, { section: 0, label: '', content: [] }))
    const rows: Row[] = [
      { section: 0, label: p?.git ? 'repo' : 'project', content: pathRow(P, p, room) },
      { section: 1, label: 'model', content: modelRow(P, r, m, e.props.isWorking, room) },
      { section: 1, label: 'tokens', content: tokensRow(P, tot, delta, room) },
    ]
    const inForce = open && (open.kind === 'effort' ? m?.effort : aliasOf(m?.model))
    if (open) {
      const made = moving['menu-room']?.openness ?? (open.pick === undefined ? 0 : 1)
      const { rows: picker, give } = pickRows(P, open, inForce, m?.model, roomOf(P, rows, avail), rows[1]?.content ?? [], made)
      foldRows.set('menu', picker.length)
      foldRows.set('menu-room', Math.max(1, give))
      const openness = moving.menu?.openness
      rows.splice(2, 0, ...(openness === undefined ? picker : picker.slice(0, Math.round(picker.length * openness))))
    }
    const lines = frame(P, rows, avail)

    const elements = $.ui.resolve(e)
    const { Box, Button, Client, Text } = elements
    const draw = (span: Span) => (
      <Text color={span.color} bold={span.bold} dimColor={span.dimColor} inverse={span.inverse}>
        {span.text}
      </Text>
    )
    const chip = (span: Span, kind: 'panel' | 'model' | 'effort', isOpen: boolean, turn: string[], onPress: () => Promise<void>) => (
      <Box width={widthOf([span])} flexShrink={0}>
        {kind === 'panel' ? (
          span.text.length > CHEVRON_CELLS && (
            <Button plain key={kind} hover={{ scope: kind, inverse: true }} onPress={() => void onPress().catch(() => undefined)}>
              {draw({ ...span, text: span.text.slice(0, -CHEVRON_CELLS) })}
            </Button>
          )
        ) : (
          <Client
            key={`chip-${kind}`}
            module="./chip.tsx"
            width={widthOf([span])}
            props={{
              label: span.text.slice(0, -CHEVRON_CELLS),
              color: span.color ?? P.alt,
              ...(kind === 'effort' && span.value && { glowHex: effortShine(P, span.value) }),
              scope: kind,
              isShining: e.props.isWorking,
              isOpen,
              frames: turn,
            }}
          />
        )}
        {kind === 'panel' && (
          <Client key={`chevron-${kind}`} module="./chevron.tsx" width={CHEVRON_CELLS} props={{ isOpen, frames: turn, scope: kind, ...(span.color && { color: span.color }) }} />
        )}
      </Box>
    )
    const control = (span: Span) =>
      span.el === 'model' || span.el === 'effort' ? (
        chip(span, span.el, open?.kind === span.el && !open.isClosing, MENU_TURN, () => toggleMenu($, span.el as Menu['kind']))
      ) : span.el === 'panel' ? (
        chip(span, 'panel', isPanelOpen && moving.panel?.to !== 0, SIDEBAR_TURN, () => togglePanel($))
      ) : span.el === 'wire' && span.wire ? (
        <Client
          key={span.wire.isArrow ? 'wire-arrow' : 'wire'}
          module="./wire.tsx"
          width={widthOf([span])}
          props={{ ...span.wire, width: widthOf([span]), color: span.color ?? P.muted, isClosing: open?.isClosing === true }}
        />
      ) : span.el === 'pick' && open ? (
        <Client
          key={`pick-${open.kind}-${span.value}`}
          module="./pill.tsx"
          width={widthOf([span])}
          props={{
            id: `pick-${open.kind}-${span.value}`,
            label: open.kind === 'effort' ? (span.value ?? '') : span.text.slice(PILL_LEAD.model.length, -PILL_TAIL.length),
            kind: open.kind,
            color: open.kind === 'effort' ? effortColor(P, span.value ?? '') : modelColor(P, span.value ?? ''),
            isPicked: span.inverse === true,
            isInForce: span.value === inForce,
            index: open.options.indexOf(span.value ?? ''),
            count: open.options.length,
            isClosing: open.isClosing === true,
            flare: [P.bad, P.warn, P.text, P.warn],
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
          props={{ percent: r?.percent ?? 0, isWorking: e.props.isWorking, width: widthOf([span]), ...barInk(P) }}
        />
      ) : span.el === 'claude' ? (
        <Client key="claude" module="./claude.tsx" width={widthOf([span])} props={{ isWorking: e.props.isWorking, ...sparkInk(P) }} />
      ) : span.count ? (
        <Client key={`n-${span.count.key}`} module="./count.tsx" width={widthOf([span])} props={countProps({ ...span, count: span.count })} />
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
    return (
      <Box flexDirection="column" alignItems="flex-start">
        {e.surface === 'terminal' && pasted.length > 0 && (
          <Box>
            {pasted.map(image => (
              <Box marginRight={2}>
                <Button plain dimColor key={`open-image-${image.id}`} label={`#${image.id} open ↗`} onPress={() => void openUrl($, image.path)} />
              </Box>
            ))}
          </Box>
        )}
        <Box marginTop={1}>
          <Text color="composerSidebarBackground">{lines.map(() => '▐').join('\n')}</Text>
          <Box flexDirection="column" alignItems="flex-start" backgroundColor="composerSidebarBackground">
            {lines.map(drawLine)}
          </Box>
          <Text color="composerSidebarBackground">{lines.map(() => '▌').join('\n')}</Text>
        </Box>
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

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const r = await next(e)
    const asked = e.args.trim()
    const level = LEVELS.includes(asked) ? asked : await settingsEffort($, (await read($, meta))?.model ?? '')
    await update($, override, () => null)
    if (level !== null) await update($, meta, x => x && { ...x, effort: level })
    return r
  })

  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    if (e.id === PANE && e.origin.kind === 'person') await update($, panelClosed, () => true)
    if (e.id === PANE) $.ui.invalidate('ui.render')
    return r
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { P } = await paint($)
    const [ags, armed, t, mainAdvisor, agentAdvisors, r, sp, n, m, fast, c, folds, moving, bytes, v] = await Promise.all([
      read($, agents),
      read($, stopArmed),
      read($, now),
      read($, advisor),
      read($, agentAdvisor),
      read($, reading),
      read($, spend),
      read($, turns),
      read($, meta),
      read($, speed),
      read($, cache),
      read($, folded),
      read($, motion),
      read($, transcriptBytes),
      read($, verdicts),
    ])
    const viewing = e.props.view.agentId
    const fromAgents = Object.values(agentAdvisors).reduce<Advisor | null>(addAdvisor, null)
    const adv = addAdvisor(mainAdvisor, fromAgents)
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const Client = 'Client' in elements ? elements.Client : undefined
    const inner = paneInnerOf(e.props.bodyColumns)
    const draw = (span: Span) => (
      <Text color={span.color} bold={span.bold} dimColor={span.dimColor}>
        {span.text}
      </Text>
    )
    const shown = [
      ...ags.filter(a => a.doneAt === null),
      ...ags.filter(a => a.doneAt !== null).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)).slice(0, ENDED_SHOWN),
    ]
    const isStopping = (a: Agent) => halting.has(a.id) && a.doneAt === null
    const state = (a: Agent) =>
      isStopping(a) ? (
        <Text color={P.bad}>{STOPPING}</Text>
      ) : a.doneAt === null && Client ? (
        <Client key={`working-${a.id}`} module="./claude.tsx" width={WORKING_CELLS} props={{ isWorking: true, ...sparkInk(P) }} />
      ) : a.doneAt === null ? (
        <Text color={P.accent}>Working</Text>
      ) : a.status === 'completed' ? (
        <Text color={P.ok}>✓ done</Text>
      ) : (
        <Text color={P.bad}>{`✗ ${a.status}`}</Text>
      )
    const header = ({ name, summary, tint = P.muted }: Section, isOpen: boolean) =>
      Client ? (
        <Client key={`fold-${name}`} module="./fold.tsx" width={inner} props={{ name, isOpen, summary, tint, width: inner, accent: P.accent, muted: P.muted }} />
      ) : (
        <Button plain key={`fold-${name}`} onPress={() => void toggleFold($, name)}>
          <Text color={P.accent} bold>{`${isOpen ? '▾' : '▸'} ${name}`}</Text>
          {!isOpen && <Text color={tint}>{` ${summary}`}</Text>}
        </Button>
      )
    const figures = (owner: string, value: Span[]) =>
      Client && value.some(span => span.count) ? (
        <Box flexShrink={0}>
          {value.map(span =>
            span.count ? <Client key={`n-${owner}-${span.count.key}`} module="./count.tsx" width={widthOf([span])} props={countProps({ ...span, count: span.count })} /> : draw(span),
          )}
        </Box>
      ) : (
        <Text wrap="truncate-end">{value.map(draw)}</Text>
      )
    const spread = (owner: string, [left, right]: Pair) => (
      <Box justifyContent="space-between">
        {figures(owner, left)}
        {right.length > 0 && (
          <Box flexShrink={0} marginLeft={left.length > 0 ? 1 : 0}>
            {figures(owner, right)}
          </Box>
        )}
      </Box>
    )
    const share = adv?.usd != null && r?.costUsd ? Math.min(100, Math.round((adv.usd / r.costUsd) * 100)) : null
    const meter = inner - CARD_INSET
    const line = (owner: string, [label, values]: [string, Span[][]]) => {
      const labelled = [label.padEnd(8), `${label} `].flatMap(head => values.map((value): Pair => [[dim(head), ...value], []]))
      return figures(owner, pick(meter, [...labelled, [values[values.length - 1] ?? [], []]])[0])
    }
    const half = Math.floor((meter - 2) / 2)
    const fitsHalf = ([label, value]: [string | Span[], Span[]]) => widthOf(typeof label === 'string' ? [s(label)] : label) + 1 + widthOf(value) <= half
    const grid = (owner: string, pairs: [string | Span[], Span[]][], width = half) => (
      <Box justifyContent="space-between">
        {pairs.map(([label, value]) => (
          <Box width={width} justifyContent="space-between">
            {typeof label === 'string' ? (
              <Text dimColor wrap="truncate-end">
                {label}
              </Text>
            ) : (
              <Text wrap="truncate-end">{label.map(draw)}</Text>
            )}
            {figures(owner, value)}
          </Box>
        ))}
      </Box>
    )
    const say = (long: string, short: string) => <Text dimColor wrap="truncate-end">{cellsOf(long) <= inner ? long : short}</Text>
    const flat = (percent: number, color: string, width = meter) => (
      <Text>
        <Text color={color}>{'━'.repeat(Math.round((Math.min(100, Math.max(0, percent)) / 100) * width))}</Text>
        <Text color={P.muted}>{'─'.repeat(width - Math.round((Math.min(100, Math.max(0, percent)) / 100) * width))}</Text>
      </Text>
    )
    const sections: Section[] = []
    const gap = () => <Text> </Text>
    const card = (border: 'round' | 'double', color: string, lines: JSX.Element[], look: { key?: string; isDim?: boolean } = {}) => ({
      rows: lines.length + BORDER_ROWS,
      body: (clip?: number) => (
        <Box
          {...(look.key && { key: look.key })}
          flexDirection="column"
          paddingX={1}
          borderStyle={border}
          borderColor={color}
          {...(look.isDim && { borderDimColor: true })}
          {...held(clip)}
        >
          <Box flexDirection="column" flexShrink={0}>
            {lines}
          </Box>
        </Box>
      ),
    })

    if (r && r.rate.length > 0) {
      const usageLines = r.rate.flatMap((w, i) => {
        const f = rateFacts(P, w, t)
        const burn = Math.abs(f.burn) >= 1 ? [s(' '), num(`${w.kind}-burn`, Math.abs(f.burn), 'int', f.burn > 0 ? P.bad : P.ok, f.burn > 0 ? '⇡' : '⇣', '%')] : []
        const name: Span[] = [{ text: f.name, bold: true }]
        const pct = num(w.kind, f.pct, 'int', f.color, '', '%')
        const mark: Span = { text: '┃', color: P.text, bold: true }
        const resets = f.remaining === null ? '' : formatDuration(f.remaining)
        return [
          ...(i === 0 ? [] : [gap()]),
          spread('usage', pick(meter, [[name, [pct, ...burn]], [name, [pct]]])),
          Client ? (
            <Client
              key={`usage-${w.kind}`}
              module="./bar.tsx"
              width={meter}
              props={{ percent: w.percentUsed, isWorking: false, width: meter, ...(f.pace !== null && { pace: f.pace }), ...barInk(P) }}
            />
          ) : (
            flat(w.percentUsed, f.color)
          ),
          ...(f.remaining === null
            ? []
            : [
                spread(
                  'usage',
                  pick(meter, [
                    [[dim(`resets in ${resets}`)], [mark, dim(` pace ${f.pace}%`)]],
                    [[dim(`resets ${resets}`)], [mark, dim(` pace ${f.pace}%`)]],
                    [[dim(`resets ${resets}`)], [mark, dim(` ${f.pace}%`)]],
                    [[dim(`resets ${resets}`)], []],
                    [[dim(resets)], []],
                  ]),
                ),
              ]),
        ]
      })
      sections.push({
        name: 'USAGE',
        summary: r.rate.map(w => `${rateFacts(P, w, t).name} ${Math.round(w.percentUsed)}%`).join(' · '),
        ...card('round', P.cool, usageLines),
      })
    }

    const spent = sp.main + sp.agents + sp.background
    const total = r?.costUsd == null ? spent || null : Math.max(r.costUsd, spent)
    const parts = total === null ? [] : costParts(P, sp, total, mainAdvisor?.usd ?? 0, fromAgents?.usd ?? 0)
    const { firstOutputMs: first, replyMs: reply } = fast
    const running = fast.startedAt == null || t === 0 ? null : Math.max(0, t - fast.startedAt)
    const ticking = running === null ? null : s(formatElapsed(running), P.accent)
    const firstFigure = first !== null ? num('first', first, 'wait', first < FIRST_OUTPUT_FAST_MS ? P.ok : first < FIRST_OUTPUT_SLOW_MS ? P.warn : P.bad) : ticking
    const replyFigure = reply !== null ? num('reply', reply, 'wait', P.text) : first !== null ? ticking : null
    const replied = replyFigure ? [dim('reply '), replyFigure] : []
    const messages = [num('messages', n, 'int', P.text), dim(n === 1 ? ' message' : ' messages')]
    const allowed = num('allowed', v.allowed, 'int', P.text)
    const blocked = num('blocked', v.blocked, 'int', v.blocked > 0 ? P.bad : P.text)
    const decided = [allowed, dim(' allowed · '), blocked, dim(' blocked')]
    const sessionLines = [
      spread('session', pick(meter, [[messages, m && t > 0 ? [s(formatElapsed(t - m.startedAt), P.text)] : []], [messages, []]])),
      ...(firstFigure || replyFigure
        ? [
            spread(
              'session',
              pick(
                meter,
                firstFigure
                  ? [
                      [[dim('first output '), firstFigure], replied],
                      [[dim('first '), firstFigure], replied],
                      [[dim('first '), firstFigure], []],
                    ]
                  : [[[], replied]],
              ),
            ),
          ]
        : []),
      ...(bytes === null ? [] : [spread('session', [[dim('transcript')], [s(formatBytes(bytes), P.text)]])]),
      ...(v.allowed + v.blocked === 0
        ? []
        : [
            spread(
              'session',
              pick(meter, [
                [[dim('auto mode')], decided],
                [[dim('auto')], decided],
                [[dim('auto')], [allowed, dim(' ✓ '), blocked, dim(' ✗')]],
              ]),
            ),
          ]),
      ...(total === null
        ? []
        : [
            gap(),
            figures('cost', [{ ...num('total', total, 'usd', total > 0.5 ? P.warn : P.ok), bold: true }]),
            ...(parts.length === 0
              ? []
              : [
                  Client ? (
                    <Client key="cost-split" module="./split.tsx" width={meter} props={{ parts: parts.map(part => ({ key: part.label, usd: part.usd, color: part.color })), width: meter, track: P.track }} />
                  ) : (
                    <Box key="cost-split">
                      <Text>
                        {apportion(parts.map(part => part.usd), meter).map((cells, i) => (
                          <Text color={parts[i]?.color}>{'━'.repeat(cells)}</Text>
                        ))}
                      </Text>
                    </Box>
                  ),
                ]),
            ...(() => {
              const usd = (part: CostPart) => num(part.label, part.usd, 'usd', P.text)
              const shareOf = (part: CostPart) => num(`${part.label}-share`, Math.round((part.usd / total) * 100), 'int', part.color, '', '%')
              const usdCells = Math.max(0, ...parts.map(part => widthOf([usd(part)])))
              const shareCells = Math.max(0, ...parts.map(part => widthOf([shareOf(part)])))
              const isShared = 2 + Math.max(0, ...parts.map(part => part.label.length)) + 1 + usdCells + 1 + shareCells <= meter
              const labelCells = Math.min(12, meter - 2 - usdCells - (isShared ? 1 + shareCells : 0))
              const label = (part: CostPart) => (labelCells < 4 ? [] : [dim(clip(part.label, labelCells - 1).padEnd(labelCells))])
              return parts.map(part => spread('cost', [[s('● ', part.color), ...label(part), usd(part)], isShared ? [shareOf(part)] : []]))
            })(),
          ]),
    ]
    sections.push({
      name: 'SESSION',
      summary: [`${n} ${n === 1 ? 'message' : 'messages'}`, ...(total === null ? [] : [figure('usd', total)]), ...(v.blocked > 0 ? [`${v.blocked} blocked`] : [])].join(' · '),
      ...card('round', P.accent, sessionLines),
    })

    if (c) {
      const left = c.at === null ? 0 : c.at + c.ttlMs - t
      const isWarm = left > 0
      const tokens = r?.tokens ?? null
      const price = priceOf(c.model)
      const mult = orgPricing?.multiplier ?? 1
      const reread = tokens === null || price === undefined ? null : priceCall(price, { cache_read_input_tokens: tokens }) * mult
      const rewrite =
        tokens === null || price === undefined
          ? null
          : priceCall(price, { cache_creation_input_tokens: tokens, cache_creation: { ephemeral_1h_input_tokens: c.ttlMs === HOUR ? tokens : 0 } }) * mult
      const warmth: Span[] = [{ text: isWarm ? '● warm' : '○ cold', color: isWarm ? P.ok : P.muted, bold: true }]
      const lasts = c.ttlMs === HOUR ? '1h' : '5m'
      const cost = isWarm ? reread : rewrite
      const other = isWarm ? rewrite : reread
      const verb = isWarm ? ' to read' : ' to rewrite'
      const cacheLines = [
        spread(
          'cache',
          pick(
            meter,
            isWarm
              ? [
                  [warmth, [s(`${formatElapsed(left)} left`, P.text)]],
                  [warmth, [s(formatElapsed(left), P.text)]],
                ]
              : [
                  [warmth, [s(`lasts ${lasts} idle`, P.text)]],
                  [warmth, [s(`${lasts} idle`, P.text)]],
                ],
          ),
        ),
        ...(isWarm
          ? [
              Client ? (
                <Client key="cache-left" module="./bar.tsx" width={meter} props={{ percent: (left / c.ttlMs) * 100, isWorking: false, width: meter, color: left < c.ttlMs / 5 ? P.warn : P.ok, ...barInk(P) }} />
              ) : (
                flat((left / c.ttlMs) * 100, left < c.ttlMs / 5 ? P.warn : P.ok)
              ),
            ]
          : []),
        ...(cost !== null && other !== null && tokens !== null
          ? (() => {
              const next = num('next', cost, 'usd', isWarm ? P.ok : P.warn)
              const then = num('other', other, 'usd', P.muted)
              return [
                line('cache', ['next', [[next, dim(`${verb} `), num('tokens', tokens, 'tokens', P.text)], [next, dim(verb)], [next]]]),
                line('cache', [isWarm ? 'if cold' : 'if warm', [[then, dim(isWarm ? ' to rewrite' : ' to read')], [then]]]),
              ]
            })()
          : []),
      ]
      sections.push({
        name: 'CACHE',
        summary: isWarm ? `● warm · ${formatElapsed(left)} left` : '○ cold',
        tint: isWarm ? P.ok : P.muted,
        ...card('round', isWarm ? P.ok : P.muted, cacheLines),
      })
    } else {
      sections.push({ name: 'CACHE', summary: 'none yet', tint: P.muted, rows: 1, body: () => say('Nothing cached in this session yet.', 'Nothing cached yet.') })
    }

    if (adv) {
      const advisorLines = [
        spread('advisor', [[{ text: `✶ ${prettify(adv.model)}`, color: P.alt, bold: true }], [num('calls', adv.calls, 'int', P.text), dim(adv.calls === 1 ? ' call' : ' calls')]]),
        ...advisorRows(P, adv, share, fromAgents).map(row => line('advisor', row)),
        ...(share === null
          ? []
          : [Client ? <Client key="advisor-share" module="./bar.tsx" width={meter} props={{ percent: share, isWorking: false, width: meter, ...barInk(P) }} /> : flat(share, P.alt)]),
      ]
      sections.push({
        name: 'ADVISOR',
        summary: [`${adv.calls} ${adv.calls === 1 ? 'call' : 'calls'}`, ...(adv.usd === null ? [] : [figure('usd', adv.usd)])].join(' · '),
        ...card('double', P.alt, advisorLines),
      })
    }

    const working = ags.filter(a => a.doneAt === null).length
    const isTimed = meter - STATE_CELLS - TITLE_TAIL >= MIN_TYPE
    const typeRoom = Math.max(1, meter - STATE_CELLS - (isTimed ? TITLE_TAIL : TITLE_ARROW))
    const fuseOf = (id: string, border: 'round' | 'double', color: string, rows: number, at: number) => {
      const [tl, tr, bl, br, across, down] = FRAMES[border]
      const k = Math.round(at * (inner + rows - 1))
      const side = (n: number, corner: string) => Array.from({ length: n }, (_, i) => (i === rows - 2 ? corner : down)).join('\n')
      const right = Math.max(0, Math.min(k - inner, rows - 1))
      const left = Math.max(0, Math.min(k - 1, rows - 1))
      const bottom = Math.max(0, Math.min(k - rows, inner - 1))
      return [
        ...(k > 0 ? [[`fuse-top-${id}`, 0, 0, (tl + across.repeat(inner - 2) + tr).slice(0, Math.min(k, inner))] as const] : []),
        ...(right > 0 ? [[`fuse-right-${id}`, 1, inner - 1, side(right, br)] as const] : []),
        ...(left > 0 ? [[`fuse-left-${id}`, 1, 0, side(left, bl)] as const] : []),
        ...(bottom > 0 ? [[`fuse-bottom-${id}`, rows - 1, 1, (across.repeat(inner - 2) + br).slice(0, bottom)] as const] : []),
      ].map(([key, top, x, text]) => (
        <Box key={key} position="absolute" top={top} left={x}>
          <Text color={color}>{text}</Text>
        </Box>
      ))
    }
    const agentItems = shown.map((a, i) => {
      const fuse = moving[`halt-${a.id}`]
      const drop = moving[`drop-${a.id}`]
      const border = a.id === viewing ? 'double' : 'round'
      const tone = a.id === viewing || fuse !== undefined ? P.accent : isStopping(a) ? P.bad : a.doneAt === null ? P.accent : a.status === 'completed' ? P.ok : P.bad
      const c = card(
        border,
        tone,
        [
          <Box justifyContent="space-between">
            {unviewable.has(a.id) ? (
              <Text bold wrap="truncate-end">{clip(a.type, typeRoom)}</Text>
            ) : (
              <Button plain key={`view-${a.id}`} hover={{ scope: `view-${a.id}` }} onPress={() => void viewAgent($, a.id === viewing ? undefined : a).catch(() => undefined)}>
                <Text bold wrap="truncate-end" color={a.id === viewing ? P.accent : P.text}>{clip(a.type, typeRoom)}</Text>
                <Text color={a.id === viewing ? P.accent : P.muted} hover={{ scope: `view-${a.id}`, color: a.id === viewing ? P.accent : P.text }}>
                  {a.id === viewing ? ' ‹' : ' ›'}
                </Text>
              </Button>
            )}
            <Box flexShrink={0}>
              {state(a)}
              {isTimed && (a.doneAt !== null || t > 0) && <Text dimColor>{` ${formatElapsed((a.doneAt ?? t) - a.startedAt)}`}</Text>}
            </Box>
          </Box>,
          <Box justifyContent="space-between">
            <Text dimColor wrap="truncate-end">{a.description || a.type}</Text>
            <Box flexShrink={0} marginLeft={1}>
              {isStopping(a) ? null : a.doneAt === null ? (
                <Button plain key={`stop-${a.id}`} hover={{ scope: `stop-${a.id}` }} onPress={() => void stopAgent($, a).catch(() => undefined)}>
                  <Text color={P.bad} bold={armed === a.id} hover={{ scope: `stop-${a.id}`, bold: true }}>
                    {armed === a.id ? '■ Confirm' : '■ Stop'}
                  </Text>
                </Button>
              ) : (
                <Button plain key={`dismiss-${a.id}`} onPress={() => void dismissAgent($, a.id).catch(() => undefined)}>
                  <Text color={P.muted}>✕ dismiss</Text>
                </Button>
              )}
            </Box>
          </Box>,
          ...(() => {
            const { head, cells } = agentRows(P, a)
            const advised = agentAdvisors[a.id]
            return [
              ...(head ? [spread(a.id, pick(meter, head))] : []),
              ...cells.flatMap(pairs => (pairs.every(fitsHalf) ? [grid(a.id, pairs)] : pairs.map(pair => grid(a.id, [pair], meter)))),
              ...(advised ? [spread(a.id, pick(meter, advisedBy(P, advised, 'advisor').map((value): Pair => [[s(`✶ ${prettify(advised.model)}`, P.alt)], value])))] : []),
            ]
          })(),
          ...(a.cacheAt == null
            ? []
            : (() => {
                const left = Math.max(0, a.cacheAt + a.cacheTtlMs - t)
                const room = meter - CACHE_LABEL.length - LEFT_CELLS
                const tail = a.doneAt !== null && left > 0 && room - IF_RESUMED.length >= MIN_BAR ? IF_RESUMED : ''
                const tint = left === 0 || a.doneAt !== null ? P.muted : left < a.cacheTtlMs / 5 ? P.warn : P.ok
                const percent = (left / a.cacheTtlMs) * 100
                const width = Math.max(0, room - tail.length)
                return [
                  <Box>
                    <Text dimColor>{CACHE_LABEL}</Text>
                    {width > 0 &&
                      (Client ? (
                        <Client key={`cache-left-${a.id}`} module="./bar.tsx" width={width} props={{ percent, isWorking: false, width, color: tint, ...barInk(P) }} />
                      ) : (
                        flat(percent, tint, width)
                      ))}
                    <Text color={tint}>{(left > 0 ? formatElapsed(left) : 'cold').padStart(width > 0 ? LEFT_CELLS : 0)}</Text>
                    {tail && <Text dimColor>{tail}</Text>}
                  </Box>,
                ]
              })()),
          ...(a.id === viewing ? [<Text color={P.accent}>● viewing</Text>] : []),
        ],
        { key: `agent-${a.id}`, isDim: a.status === 'completed' },
      )
      const lead = i > 0 && !(i === 1 && moving[`drop-${shown[0]?.id}`] !== undefined)
      const trail = i === 0 && shown.length > 1 && drop !== undefined
      const full = c.rows + (lead || trail ? 1 : 0)
      const out = drop ? Math.round(inner * Math.min(1, (1 - drop.openness) * 2) ** 2) : 0
      const rows = drop ? Math.round(full * Math.min(1, drop.openness * 2)) : full
      return {
        rows,
        body: () => (
          <Box key={`slot-${a.id}`} flexDirection="column" flexShrink={0} {...(drop && { height: rows, overflow: 'hidden' as const })}>
            <Box flexDirection="column" flexShrink={0} marginLeft={out} width={inner}>
              {lead && gap()}
              <Box flexDirection="column">
                {c.body()}
                {fuse && fuseOf(a.id, border, P.bad, c.rows, fuse.openness)}
              </Box>
              {trail && gap()}
            </Box>
          </Box>
        ),
      }
    })
    const agentBody = agentItems.length > 0 ? agentItems : [{ rows: 1, body: () => say('No agents in this session yet.', 'No agents yet.') }]
    sections.push({
      name: 'AGENTS',
      summary: working > 0 ? `${working} working` : ags.length > 0 ? `${ags.length} done` : 'none yet',
      tint: working > 0 ? P.accent : P.muted,
      rows: agentBody.reduce((sum, item) => sum + item.rows, 0),
      body: () => <Box flexDirection="column">{agentBody.map(item => item.body())}</Box>,
    })

    const columns = e.props.bodyColumns
    const offset = moving.panel ? Math.round(columns * offPanel(moving.panel)) : 0
    const { offset: top, bodyRows } = e.props.scroll
    return (
      <Box width={columns} minHeight={bodyRows} overflow="hidden" flexShrink={0}>
        <Box key="slide" flexDirection="column" paddingX={1} marginLeft={offset} width={columns} flexShrink={0}>
          {viewing !== undefined && (
            <Box marginBottom={1} justifyContent="space-between">
              <Button plain key="view-main" onPress={() => void viewAgent($).catch(() => undefined)}>
                <Text color={P.accent} bold>
                  {cellsOf(BACK) + ' viewing'.length <= inner ? BACK : '‹ main'}
                </Text>
              </Button>
              <Text dimColor wrap="truncate-end">{`viewing ${ags.find(a => a.id === viewing)?.type ?? 'an agent'}`}</Text>
            </Box>
          )}
          {sections.map((section, i) => {
            const isOpen = !folds.includes(section.name)
            const fold = moving[`fold-${section.name}`]
            foldRows.set(`fold-${section.name}`, section.rows)
            const clip = fold && Math.round(section.rows * fold.openness)
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
          {m?.version &&
            (() => {
              const [[version], [changelog]] = pick(inner, [
                [[dim(`Claude Code v${m.version}`)], [s('changelog ›')]],
                [[dim(`v${m.version}`)], [s('changelog ›')]],
                [[dim(`v${m.version}`)], [s('›')]],
              ])
              return (
                <Box marginTop={1} justifyContent="space-between">
                  <Text dimColor wrap="truncate-end">{version?.text}</Text>
                  <Box flexShrink={0} marginLeft={1}>
                    <Button plain key="version" onPress={() => void openUrl($, CHANGELOG)}>
                      <Text color={P.muted}>{changelog?.text}</Text>
                    </Button>
                  </Box>
                </Box>
              )
            })()}
        </Box>
        {offset > 0 && offset < columns && (
          <Box key="curtain" position="absolute" top={top} left={offset}>
            <Text dimColor>{Array.from({ length: bodyRows }, () => '│').join('\n')}</Text>
          </Box>
        )}
      </Box>
    )
  })
}

type Span = {
  text: string
  color?: string
  bold?: boolean
  dimColor?: boolean
  inverse?: boolean
  el?: 'model' | 'effort' | 'repo' | 'bar' | 'claude' | 'panel' | 'count' | 'pick' | 'wire' | 'confirm'
  count?: Count
  value?: string
  wire?: { from: number; to: number; isArrow: boolean }
}
type Count = { key: string; value: number; figure: Figure; before: string; after: string }
type Pair = [Span[], Span[]]
type CostPart = { label: string; usd: number; color: string }
type Row = { section: number; label: string; content: Span[]; isTight?: boolean }
type Section = { name: string; summary: string; tint?: string; rows: number; body: (clip?: number) => JSX.Element }

const BORDER_ROWS = 2
export const CARD_INSET = 4
export const paneInnerOf = (bodyColumns: number) => Math.max(16, bodyColumns - 2)
const FRAMES = { round: ['╭', '╮', '╰', '╯', '─', '│'], double: ['╔', '╗', '╚', '╝', '═', '║'] } as const
const held = (clip?: number) => (clip === undefined ? {} : { height: Math.max(2, clip), overflow: 'hidden' as const })

const s = (t: string, c?: string): Span => ({ text: t, color: c })
const dim = (t: string): Span => ({ text: t, dimColor: true })
const num = (k: string, value: number, f: Figure, c?: string, before = '', after = ''): Span => {
  const v = Number.isFinite(value) ? value : 0
  return { text: before + figure(f, v) + after, color: c, el: 'count', count: { key: k, value: v, figure: f, before, after } }
}

function countProps(span: Span & { count: Count }) {
  return {
    value: span.count.value,
    figure: span.count.figure,
    before: span.count.before,
    after: span.count.after,
    ...(span.color && { color: span.color }),
    ...(span.bold && { bold: true }),
    ...(span.dimColor && { dimColor: true }),
  }
}

function join(P: Palette, parts: Span[][], sep: Span = s(' · ', P.muted)): Span[] {
  return parts.filter(part => part.length > 0).flatMap((part, i) => (i === 0 ? part : [sep, ...part]))
}

function fit(room: number, variants: Span[][]): Span[] {
  return pick(room, variants.map((variant): Pair => [variant, []]))[0]
}

function pick(room: number, variants: Pair[]): Pair {
  const width = ([left, right]: Pair) => widthOf(left) + widthOf(right) + (left.length > 0 && right.length > 0 ? 1 : 0)
  return variants.find(variant => width(variant) <= room) ?? variants[variants.length - 1] ?? [[], []]
}

function widthOf(spans: Span[]): number {
  return spans.reduce((n, span) => n + cellsOf(span.text), 0)
}

const WIDE: [number, number][] = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
]
const ZERO_WIDTH: [number, number][] = [[0x0300, 0x036f], [0x200b, 0x200f], [0xfe00, 0xfe0f]]
const within = (ranges: [number, number][], c: number) => ranges.some(([from, to]) => c >= from && c <= to)

export function cellsOf(text: string): number {
  let cells = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    if (!within(ZERO_WIDTH, c)) cells += within(WIDE, c) ? 2 : 1
  }
  return cells
}

function frame(P: Palette, rows: Row[], avail = Infinity): Span[][] {
  const inners = rows
    .filter(row => row.content.length > 0)
    .map(row => {
      const inner = innerOf(P, row)
      return { section: row.section, isTight: row.isTight, inner, width: widthOf(inner) }
    })
  const max = Math.max(Math.min(MIN_INNER, avail), ...inners.map(row => row.width))
  const heavy = '━'.repeat(max)
  const divider = s(`┃ ${'─'.repeat(LABEL_W + 1)}┼${'─'.repeat(Math.max(1, max - (LABEL_W + 4)))} ┃`, P.muted)

  const lines: Span[][] = [[s(`┏${heavy}┓`, P.muted)]]
  inners.forEach((row, i) => {
    const previous = inners[i - 1]
    if (previous && !row.isTight) lines.push([previous.section === row.section ? divider : s(`┣${heavy}┫`, P.muted)])
    lines.push([s('┃', P.muted), ...row.inner, s(' '.repeat(max - row.width)), s('┃', P.muted)])
  })
  lines.push([s(`┗${heavy}┛`, P.muted)])
  return lines
}

function innerOf(P: Palette, row: Row): Span[] {
  return [s(' '), dim(row.label.padEnd(LABEL_W)), s(' '), s('│', P.muted), s('  '), ...row.content, s(' ')]
}

function roomOf(P: Palette, rows: Row[], avail = Infinity): number {
  const bare = widthOf(innerOf(P, { section: 0, label: '', content: [] }))
  return Math.max(Math.min(MIN_INNER, avail), ...rows.map(row => widthOf(innerOf(P, row)))) - bare
}

const CONFIRM_GAP = 2

function pickRows(
  P: Palette,
  open: Menu,
  inForce: string | null | undefined,
  model: string | undefined,
  room: number,
  above: Span[],
  made: number,
): { rows: Row[]; give: number } {
  const current = open.pick ?? inForce
  const confirm: Span = { text: ' ✓ Confirm ', color: P.ok, bold: true, el: 'confirm' }
  const isPending = open.pick !== undefined && open.pick !== inForce && !open.isClosing
  const { centred, give, fits } = placeConfirm(pillLines(P, open, current, model, room), confirm, room, made, isPending)
  const drop = wireRows(P, open, current, above, centred[0] ?? [], room)
  const last = isPending && !fits ? [s(' '.repeat(centreOf(room, [confirm]))), confirm] : [s('')]
  return { rows: [...drop, ...centred, last].map(content => ({ section: 1, label: '', content, isTight: true })), give }
}

function pillLines(P: Palette, open: Menu, current: string | null | undefined, model: string | undefined, room: number): Span[][] {
  const isEffort = open.kind === 'effort'
  const lines: Span[][] = [[]]
  for (const option of open.options) {
    const label = isEffort ? option : modelLabel(option, model)
    const tint = isEffort ? effortColor(P, option) : modelColor(P, option)
    const pill: Span = {
      text: `${PILL_LEAD[open.kind]}${label}${PILL_TAIL}`,
      el: 'pick',
      value: option,
      ...(option === current ? { color: tint, bold: true, inverse: true } : { dimColor: true }),
    }
    const line = lines[lines.length - 1] ?? []
    if (line.length === 0) line.push(pill)
    else if (widthOf(line) + 1 + widthOf([pill]) <= room) line.push(s(' '), pill)
    else lines.push([pill])
  }
  return lines
}

const centreOf = (room: number, line: Span[]) => Math.max(0, Math.floor((room - widthOf(line)) / 2))

function placeConfirm(
  lines: Span[][],
  confirm: Span,
  room: number,
  made: number,
  isPending: boolean,
): { centred: Span[][]; give: number; fits: boolean } {
  const lastLine = lines.length - 1
  const tail = lines[lastLine] ?? []
  const fits = widthOf(tail) + CONFIRM_GAP + widthOf([confirm]) <= room
  const give = fits ? Math.max(0, centreOf(room, tail) + widthOf(tail) + CONFIRM_GAP + widthOf([confirm]) - room) : 0
  const centred = lines.map((line, n) => [s(' '.repeat(centreOf(room, line) - (n === lastLine ? Math.round(give * made) : 0))), ...line])
  if (isPending && fits && (give === 0 || made === 1)) centred[lastLine]?.push(s(' '.repeat(CONFIRM_GAP)), confirm)
  return { centred, give, fits }
}

function wireRows(P: Palette, open: Menu, current: string | null | undefined, above: Span[], first: Span[], room: number): Span[][] {
  const i = above.findIndex(span => span.el === open.kind)
  const chip = above[i]
  const from = chip ? widthOf(above.slice(0, i)) + Math.floor((widthOf([chip]) - CHEVRON_CELLS) / 2) : -1
  const j = first.findIndex(span => span.value === current)
  if (j < 0 && open.options.includes(current ?? '')) return [[s('')], [s('')]]
  const k = j < 0 ? first.findIndex(span => span.el === 'pick') : j
  const target = first[k]
  const lead = PILL_LEAD[open.kind].length
  const labelCells = target ? widthOf([target]) - lead - PILL_TAIL.length : 0
  const to = target ? widthOf(first.slice(0, k)) + lead + Math.floor(labelCells / 2) : -1
  if (from < 0 || to < 0) return [[s('')]]
  const color = open.kind === 'effort' ? effortColor(P, current ?? '') : modelColor(P, current ?? '')
  const wire = (isArrow: boolean): Span => ({ text: ' '.repeat(room), color, el: 'wire', wire: { from, to, isArrow } })
  return [[wire(false)], [wire(true)]]
}

function modelLabel(alias: string, model: string | undefined): string {
  if (model && aliasOf(model) === alias) return prettify(model)
  const family = alias.replace(/\[1m\]$/, '')
  return families[family] ?? family.replace(/^./, c => c.toUpperCase())
}

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

function isNewer(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false
  const [x, y] = [a, b].map(v => v.split('.').map(Number))
  for (let i = 0; i < Math.max(x!.length, y!.length); i++) {
    const [p, q] = [x![i] ?? 0, y![i] ?? 0]
    if (p !== q) return p > q
  }
  return false
}

function pathRow(P: Palette, p: Place | null, room = Infinity): Span[] {
  const git = p?.git
  const cwd = formatCwd(p?.cwd ?? '', p?.home ?? null)
  const parts = cwd.split('/')
  const paths = [cwd, ...parts.slice(2).map((_, i) => `.../${parts.slice(i + 2).join('/')}`)]
  const last = paths[paths.length - 1] ?? cwd
  const path = (text: string): Span[] => [{ ...s(text, P.info), el: p?.remote ? 'repo' : undefined }]
  const panel = (isShort: boolean): Span[] => [{ ...dim(isShort ? ` ${SIDEBAR_TURN[0]}` : `SIDEBAR ${SIDEBAR_TURN[0]}`), el: 'panel' }]
  if (!git) return fit(room, [...paths.map(text => join(P, [path(text), panel(false)])), join(P, [path(last), panel(true)])])
  const isDirty = git.insertions > 0 || git.deletions > 0 || git.untracked > 0
  const counts = [
    git.ahead > 0 && s(` ↑${git.ahead}`, P.info),
    git.behind > 0 && s(` ↓${git.behind}`, P.alt),
    git.insertions > 0 && s(` +${git.insertions}`, P.ok),
    git.deletions > 0 && s(` -${git.deletions}`, P.bad),
    git.untracked > 0 && s(` ~${git.untracked}`, P.muted),
    // The space is deliberate: ⊟ is drawn edge to edge and swallows a digit.
    git.stash > 0 && dim(` ⊟ ${git.stash}`),
  ].filter((span): span is Span => span !== false)
  const row = (text: string, branch: string, shown: Span[], isShort: boolean) => join(P, [path(text), [dim('on'), s(' '), s(branch, isDirty ? P.warn : P.ok), ...shown], panel(isShort)])
  const branch = clip(git.branch, BRANCH_CELLS)
  const tight = clip(git.branch, Math.max(1, room - widthOf(row(last, '', [], true))))
  return fit(room, [
    ...paths.map(text => row(text, git.branch, counts, false)),
    row(last, branch, counts, false),
    row(last, branch, [], false),
    row(last, branch, [], true),
    row(last, tight, [], true),
  ])
}

async function toggleFold($: $, name: string): Promise<void> {
  const wasFolded = (await read($, folded)).includes(name)
  const list = await animate($, `fold-${name}`, wasFolded ? 1 : 0, true, () => update($, folded, xs => (wasFolded ? xs.filter(x => x !== name) : [...xs, name])))
  await $.store.set('folded', list).catch(() => undefined)
}

export const ROW_MS = 24
const MOST_MS = 320
const SLIDE_MS = 240
const DROP_MS = 400
const HALT_MS = 480
const foldRows = new Map<string, number>()

function stepOf(key: string): number {
  if (key === 'panel') return ROW_MS / SLIDE_MS
  if (key.startsWith('drop-')) return ROW_MS / DROP_MS
  if (key.startsWith('halt-')) return ROW_MS / HALT_MS
  return Math.max(1 / (foldRows.get(key) ?? 8), ROW_MS / MOST_MS)
}

async function move($: $, key: string, to: 0 | 1): Promise<void> {
  await update($, motion, moving => ({ ...moving, [key]: { openness: moving[key]?.openness ?? 1 - to, to } }))
  ticker ??= $.clock.every(ROW_MS, () => void stepFolds($).catch(() => undefined))
}

async function animate<T>($: $, key: string, to: 0 | 1, isMoving: boolean, change: () => Promise<T>): Promise<T> {
  if (isMoving) await move($, key, to)
  return change()
}

async function stepFolds($: $): Promise<void> {
  const shut: string[] = []
  let left = await update($, motion, moving => {
    const next: Record<string, Motion> = {}
    for (const [key, { openness, to }] of Object.entries(moving)) {
      const isFromOlderModule = typeof openness !== 'number'
      if (isFromOlderModule) continue
      const step = stepOf(key)
      const stepped = to === 1 ? Math.min(1, openness + step) : Math.max(0, openness - step)
      const reached = Math.abs(stepped - to) < 1e-9 ? to : stepped
      if (reached !== to) next[key] = { openness: reached, to }
      else if (to === 0) {
        shut.push(key)
        if (key === 'panel') next[key] = { openness: 0, to }
      }
    }
    return next
  })
  if (shut.includes('menu')) await update($, menu, x => (x?.isClosing ? null : x))
  const dropped = shut.filter(key => key.startsWith('drop-')).map(key => key.slice('drop-'.length))
  if (dropped.length > 0) await forget($, dropped)
  if (shut.includes('panel')) {
    await $.ui.close({ id: PANE }).catch(() => undefined)
    left = await update($, motion, ({ panel, ...rest }) => (panel?.to === 0 ? rest : { ...rest, ...(panel && { panel }) }))
    $.ui.invalidate('ui.render')
  }
  if (Object.keys(left).length === 0) {
    ticker?.cancel()
    ticker = null
  }
}

async function toggleMenu($: $, kind: Menu['kind']): Promise<void> {
  const open = await read($, menu)
  if (open?.kind === kind && !open.isClosing) return shutMenu($)
  if (open?.kind === kind) {
    const isFolding = Boolean((await read($, motion)).menu)
    return void (await animate($, 'menu', 1, isFolding, () => update($, menu, x => x && { ...x, isClosing: false })))
  }
  let options: string[] = [...LEVELS]
  if (kind === 'model') {
    const [rows, m] = await Promise.all([$.config.list(), read($, meta)])
    families = await readFamilies($, m?.version ?? '')
    const all = rows.find(row => row.key === 'model')?.options ?? []
    const isLong = m?.model.endsWith('[1m]') === true
    const rank = (o: string) => {
      const at = FAMILY_ORDER.findIndex(family => o.includes(family))
      return at < 0 ? FAMILY_ORDER.length : at
    }
    options = all
      .filter(o => !o.endsWith('[1m]') && !NOT_OFFERED.includes(o))
      .map(o => (isLong && all.includes(`${o}[1m]`) ? `${o}[1m]` : o))
      .sort((a, b) => rank(a) - rank(b))
  }
  const isRolling = !open || (open.isClosing === true && Boolean((await read($, motion)).menu))
  await animate($, 'menu', 1, isRolling, async () => {
    await update($, motion, ({ 'menu-room': _, ...rest }) => rest)
    return update($, menu, () => ({ kind, options }))
  })
}

const CLOSE_MS = 220
let latestShut = 0

async function shutMenu($: $): Promise<void> {
  if (!(await update($, menu, x => x && { ...x, isClosing: true }))) return
  const fold = ++latestShut
  $.clock.after(CLOSE_MS, () => {
    if (fold === latestShut) void read($, menu).then(x => (x?.isClosing ? move($, 'menu', 0) : undefined)).catch(() => undefined)
  })
}

async function confirmPick($: $): Promise<void> {
  const open = await read($, menu)
  if (open?.pick !== undefined && !open.isClosing) await choose($, open.kind, open.pick)
}

async function choose($: $, kind: Menu['kind'], value: string): Promise<void> {
  await shutMenu($)
  if (kind === 'effort') {
    await update($, override, () => value)
    void $.command.run({ command: 'effort', args: value }).catch(() => undefined)
    return
  }
  const r = await $.config.set({ key: 'model', value })
  if (r.deny !== undefined) return $.ui.toast(r.deny)
  await adoptModel($)
}

async function settingsEffort($: $, model: string): Promise<string | null> {
  const s = (await $.settings.read()) as { effortLevel?: unknown; modelSettings?: Record<string, { effortLevel?: unknown } | undefined> }
  const level = s.modelSettings?.[bare(model)]?.effortLevel ?? s.effortLevel
  return typeof level === 'string' ? level : null
}

async function adoptModel($: $): Promise<void> {
  const model = await $.session.model()
  const effort = await settingsEffort($, model)
  await update($, override, () => null)
  await update($, meta, x => x && { ...x, model, ...(effort !== null && { effort }) })
}

function aliasOf(model: string | undefined): string | undefined {
  const family = /fable|opus|sonnet|haiku/.exec(model ?? '')?.[0]
  return family && `${family}${model?.endsWith('[1m]') ? '[1m]' : ''}`
}

const unviewable = new Set<string>()

async function viewAgent($: $, agent?: Agent): Promise<void> {
  const shown = await $.ui.view(agent ? { agentId: agent.id } : {})
  if (shown.deny === undefined) return
  if (agent && agent.doneAt !== null) {
    unviewable.add(agent.id)
    $.ui.invalidate('ui.render')
  }
  $.ui.toast(shown.deny)
}

let disarm: { cancel: () => void } | null = null

async function stopAgent($: $, agent: Agent): Promise<void> {
  disarm?.cancel()
  disarm = null
  if ((await read($, stopArmed)) !== agent.id) {
    await update($, stopArmed, () => agent.id)
    disarm = $.clock.after(STOP_ARM_MS, () => {
      void read($, stopArmed)
        .then(x => (x === agent.id ? update($, stopArmed, () => null) : undefined))
        .catch(() => undefined)
    })
    return
  }
  await update($, stopArmed, () => null)
  halting.add(agent.id)
  await move($, `halt-${agent.id}`, 1)
  const r = await $.tool
    .call({ tool: 'TaskStop', task_id: agent.id, consent: `The user pressed "■ Stop" then "■ Confirm" in the pitwall panel to stop agent ${agent.id}` })
    .catch(() => null)
  const refusal = r === null ? 'Claude Code cannot stop agents here' : (r.deny ?? (r.isError ? (r.text ?? `The ${agent.type} agent did not stop`) : undefined))
  if (refusal !== undefined) {
    halting.delete(agent.id)
    await move($, `halt-${agent.id}`, 0)
    $.ui.toast(refusal)
  }
  await refreshAgents($)
}

const halting = new Set<string>()
const leaving = new Set<string>()

async function dismissAgent($: $, id: string): Promise<void> {
  if ((await read($, stopArmed)) === id) {
    disarm?.cancel()
    disarm = null
    await update($, stopArmed, () => null)
  }
  await dropAgent($, id)
}

async function dropAgent($: $, id: string): Promise<void> {
  if (leaving.has(id) || gone.has(id)) return
  leaving.add(id)
  await move($, `drop-${id}`, 0)
}

async function forget($: $, ids: string[]): Promise<void> {
  for (const id of ids) {
    gone.add(id)
    leaving.delete(id)
    halting.delete(id)
  }
  await update($, agents, list => list.filter(a => !ids.includes(a.id)))
}

async function togglePanel($: $): Promise<void> {
  const [panes, moving] = await Promise.all([$.ui.panes(), read($, motion)])
  if (!panes.some(pane => pane.id === PANE)) await openPanel($)
  else if (moving.panel?.to === 0) {
    await update($, panelClosed, () => false)
    await move($, 'panel', 1)
  } else {
    await update($, panelClosed, () => true)
    await move($, 'panel', 0)
  }
  $.ui.invalidate('ui.render')
}

const offPanel = ({ openness }: Motion) => (1 - openness) ** 3

async function openPanel($: $): Promise<boolean> {
  await update($, panelClosed, () => false)
  await move($, 'panel', 1)
  return (await $.ui.open({ id: PANE, title: 'SIDEBAR', focus: true, columns: PANE_COLUMNS })).isPlaced
}

function modelRow(P: Palette, r: Reading | null, m: { model: string; effort: string | null; version: string } | null, isWorking: boolean, room = Infinity): Span[] {
  const pct = r?.percent ?? 0
  const color = r?.percent == null ? P.ok : pctColor(P, pct)
  const used = r?.tokens ?? Math.floor(((r?.window ?? 0) * pct) / 100)
  const figures = r && r.window > 0 ? [num('used', used, 'tokens', P.text), s(`/${windowLabel(r.window)}`, P.muted)] : []
  const bar = (cells: number): Span[] => {
    const filled = filledCells(pct, cells)
    return cells > 0 ? [{ text: '█'.repeat(filled) + '░'.repeat(cells - filled), color: color, el: 'bar' }, s(' ')] : []
  }
  const row = (cells: number, shown: Span[], isLong: boolean, sep: string, spark: number) =>
    join(P, [
      [...bar(cells), num('pct', pct, 'int', color, '', '%')],
      shown,
      [{ ...s(`${m?.model ? prettify(m.model) : 'unknown'} ${MENU_TURN[0]}`, m?.model ? modelColor(P, aliasOf(m.model) ?? '') : P.muted), el: 'model' }],
      m?.effort ? [{ ...s(`${m.effort}${isLong ? ' effort' : ''} ${MENU_TURN[0]}`, effortColor(P, m.effort)), el: 'effort', value: m.effort }] : [],
      spark > 0 ? [{ text: ' '.repeat(spark), el: 'claude' }] : [],
    ], s(sep))
  const most = Math.max(WORKING_CELLS, READY_CELLS)
  const cells = Math.max(MIN_BOX_BAR, Math.min(BAR_WIDTH, room - widthOf(row(0, figures, true, '  ', most)) - 1))
  const variants: [number, Span[], boolean, string, boolean][] = [
    [cells, figures, true, '  ', true],
    [cells, [], true, '  ', true],
    [cells, [], false, '  ', true],
    [cells, [], false, ' ', true],
    [0, [], false, ' ', true],
    [0, [], false, ' ', false],
  ]
  const [bars, shown, isLong, sep, isSparked] = variants.find(([n, list, long, gap, sparked]) => widthOf(row(n, list, long, gap, sparked ? most : 0)) <= room) ?? [0, [], false, ' ', false]
  return row(bars, shown, isLong, sep, isSparked ? (isWorking ? WORKING_CELLS : READY_CELLS) : 0)
}

function filledCells(pct: number, cells = BAR_WIDTH): number {
  return Math.floor((cells * Math.min(100, Math.max(0, Math.trunc(pct))) + 50) / 100)
}

function tokensRow(P: Palette, tot: Tokens, delta: Tokens, room = Infinity): Span[] {
  const row = (isAdded: (plus: number) => boolean, kinds: (keyof Tokens)[]) => {
    const buckets: Record<keyof Tokens, Span[]> = {
      in: bucket(P, 'in', 'in', '', tot.in, delta.in, P.info, P.info, isAdded(delta.in)),
      cacheWrite: bucket(P, 'cacheWrite', 'cache', '↑', tot.cacheWrite, delta.cacheWrite, P.muted, P.warn, isAdded(delta.cacheWrite)),
      cacheRead: bucket(P, 'cacheRead', 'cache', '↓', tot.cacheRead, delta.cacheRead, P.muted, P.info, isAdded(delta.cacheRead)),
      out: bucket(P, 'out', 'out', '', tot.out, delta.out, P.alt, P.alt, isAdded(delta.out)),
    }
    return join(P, kinds.map(kind => buckets[kind]))
  }
  const every: (keyof Tokens)[] = ['in', 'cacheWrite', 'cacheRead', 'out']
  return fit(room, [row(() => true, every), row(plus => plus > 0, every), row(() => false, every), row(() => false, ['in', 'cacheRead', 'out']), row(() => false, ['in', 'out'])])
}

function bucket(P: Palette, key: string, label: string, arrow: string, value: number, plus: number, idle: string, active: string, isAdded = true): Span[] {
  const arrowPart = arrow ? [s(arrow, P.muted)] : []
  const added = num(`${key}-delta`, plus, 'tokens', plus > 0 ? P.ok : undefined, '(+', ')')
  const tail = isAdded ? [s(' '), plus > 0 ? added : { ...added, dimColor: true }] : []
  return plus > 0
    ? [{ text: label, color: active, bold: true }, ...arrowPart, s(' '), num(key, value, 'tokens', active), ...tail]
    : [dim(label), ...arrowPart, s(' '), num(key, value, 'tokens', idle), ...tail]
}

function agentRows(P: Palette, a: Agent): { head: Pair[] | null; cells: [string | Span[], Span[]][][] } {
  const n = a.calls ?? 0
  const name = a.model ? [s(prettify(a.model), P.alt)] : []
  const model = join(P, [name, a.model && a.effort ? [s(a.effort, effortColor(P, a.effort))] : []])
  const calls = n > 0 ? [num('calls', n, 'int', P.text), dim(n === 1 ? ' call' : ' calls')] : []
  const head: Pair[] | null = model.length + calls.length > 0 ? [[model, calls], [name, calls]] : null
  if (a.context + a.out === 0) return { head, cells: [] }
  const cost: [string, Span[]][] = a.usd > 0 ? [['cost', [num('usd', a.usd, 'usd', a.usd > 0.5 ? P.warn : P.ok)]]] : []
  return {
    head,
    cells: [
      [
        [[s('in', P.info)], [num('in', a.in ?? 0, 'tokens', P.info)]],
        [[s('out', P.alt)], [num('out', a.out, 'tokens', P.alt)]],
      ],
      [
        [[s('cache', P.warn), s('↑', P.muted)], [num('cacheWrite', a.cacheWrite ?? 0, 'tokens', P.warn)]],
        [[s('cache', P.info), s('↓', P.muted)], [num('cacheRead', a.cacheRead ?? 0, 'tokens', P.info)]],
      ],
      [['context', [num('context', a.context, 'tokens', P.text)]], ...cost],
    ],
  }
}

function advisorRows(P: Palette, a: Advisor, share: number | null, fromAgents: Advisor | null): [string, Span[][]][] {
  const [tokensIn, tokensOut] = [num('in', a.in, 'tokens', P.info), num('out', a.out, 'tokens', P.alt)]
  const rows: [string, Span[][]][] = [['tokens', [join(P, [[tokensIn, dim(' in')], [tokensOut, dim(' out')]]), join(P, [[tokensIn], [tokensOut]]), [tokensIn, dim(' in')]]]]
  if (a.usd !== null) {
    const usd = num('usd', a.usd, 'usd', a.usd > 0.5 ? P.warn : P.ok)
    const part = share === null ? [] : [dim(' · '), num('share', share, 'int', P.alt, '', '%')]
    rows.push(['cost', [[usd, ...part, ...(share === null ? [] : [dim(' of session')])], [usd, ...part], [usd]]])
  }
  if (fromAgents) rows.push(['agents', advisedBy(P, fromAgents, 'agents')])
  return rows
}

function advisedBy(P: Palette, a: Advisor, key: string): Span[][] {
  const count = num(`${key}-calls`, a.calls, 'int', P.text)
  const calls = [count, dim(a.calls === 1 ? ' call' : ' calls')]
  return [...(a.usd === null ? [] : [[...calls, dim(' · '), num(`${key}-usd`, a.usd, 'usd', P.text)]]), calls, [count]]
}

function addAdvisor(a: Advisor | null, b: Advisor | null): Advisor | null {
  if (!a || !b) return a ?? b
  return { model: a.model || b.model, calls: a.calls + b.calls, in: a.in + b.in, out: a.out + b.out, usd: a.usd === null || b.usd === null ? null : a.usd + b.usd }
}

function spendClass(source: unknown): keyof Spend {
  if (typeof source !== 'string' || source.startsWith('repl_main_thread') || source === 'sdk') return 'main'
  if (source.startsWith('agent:') || source === 'hook_agent') return 'agents'
  return 'background'
}

function costParts(P: Palette, x: Spend, total: number, advisor: number, agentsAdvisor: number): CostPart[] {
  if (x.main + x.agents + x.background === 0) return []
  const earlier = Math.max(0, total - x.main - x.agents - x.background)
  const advisorUsd = Math.min(Math.max(0, advisor), x.main + earlier)
  const advisorFromMain = Math.min(x.main, advisorUsd)
  const advisorFromEarlier = advisorUsd - advisorFromMain
  const advisorFromAgents = Math.min(Math.max(0, agentsAdvisor), x.agents)
  return [
    { label: 'main', usd: x.main - advisorFromMain, color: P.accent },
    { label: 'advisor', usd: advisorUsd + advisorFromAgents, color: P.alt },
    { label: 'agents', usd: x.agents - advisorFromAgents, color: P.info },
    { label: 'background', usd: x.background, color: P.cool },
    { label: 'earlier', usd: earlier - advisorFromEarlier, color: P.muted },
  ].filter(part => part.usd >= 0.00005)
}

function carriedRate(kept: unknown, t: number): RateWindow[] {
  if (!Array.isArray(kept)) return []
  return kept.flatMap((w: Partial<RateWindow> | null): RateWindow[] => {
    if (typeof w?.kind !== 'string' || typeof w.percentUsed !== 'number') return []
    const resetsAt = typeof w.resetsAt === 'string' ? w.resetsAt : null
    const isReset = resetsAt !== null && Date.parse(resetsAt) <= t
    return [{ kind: w.kind, percentUsed: isReset ? 0 : w.percentUsed, resetsAt: isReset ? null : resetsAt }]
  })
}

function rateFacts(P: Palette, w: RateWindow, t: number) {
  const [name, span] = RATE[w.kind] ?? [w.kind, 0]
  const pct = Math.round(w.percentUsed)
  const remaining = w.resetsAt ? Math.floor((Date.parse(w.resetsAt) - t) / 1000) : NaN
  const isInWindow = remaining > 0 && remaining <= span
  const pace = isInWindow ? Math.floor(((span - remaining) * 100) / span) : null
  return {
    name,
    pct,
    color: pct >= 80 ? P.bad : pct >= 50 ? P.warn : P.ok,
    pace,
    burn: pace === null ? 0 : pct - pace,
    remaining: isInWindow ? remaining : null,
  }
}

let isGitQueued = false

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

async function checkThresholds($: $, r: Reading, limits: { context: number; rate: number }, sounds: boolean) {
  const was = await read($, alerted)
  const next: Alerted = { context: was.context, rate: { ...(was.rate && typeof was.rate === 'object' ? was.rate : {}) } }
  const pct = Math.round(r.percent ?? 0)
  if (pct < limits.context) next.context = false
  else if (limits.context > 0 && !was.context) {
    next.context = true
    void notify($, 'context_high', sounds)
  }
  let crossed = false
  if (limits.rate > 0) for (const w of r.rate) {
    if (Math.trunc(w.percentUsed) < limits.rate || next.rate[w.kind] === w.resetsAt) continue
    next.rate[w.kind] = w.resetsAt
    crossed = true
  }
  if (crossed) void notify($, 'rate_limit', sounds)
  if (JSON.stringify(next) !== JSON.stringify(was)) await update($, alerted, () => next)
}

async function refreshReading($: $) {
  const usage = await $.session.usage()
  await update($, reading, () => toReading(usage))
}

// Claude Code draws a Link's URL as text in a terminal it judges unable to
// show one.
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

async function configDir($: $): Promise<string | null> {
  const set = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await homeDir($)
  return set || (home && `${home}/.claude`)
}

async function globalConfigPath($: $): Promise<string | null> {
  const [dir, set, home] = await Promise.all([configDir($), $.env.get('CLAUDE_CONFIG_DIR'), homeDir($)])
  const legacy = `${dir}/.config.json`
  const stat = dir ? await $.fs.stat(legacy).catch(() => null) : null
  if (stat?.kind === 'file' && stat.size > 0) return legacy
  const base = set || home
  return base ? `${base}/.claude.json` : null
}

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

const gone = new Set<string>()

let syncQueue: Promise<void> = Promise.resolve()

function refreshAgents($: $): Promise<void> {
  const run = syncQueue.then(() => syncAgents($))
  syncQueue = run.catch(() => undefined)
  return run
}

async function syncAgents($: $): Promise<void> {
  const [list, t, prev] = await Promise.all([$.agent.list(), $.clock.now(), read($, agents)])
  for (const a of list) {
    if (ENDED.has(a.status)) halting.delete(a.id)
    else if (gone.delete(a.id) || leaving.delete(a.id)) await move($, `drop-${a.id}`, 1)
  }
  const merge = (was: Agent[]): Agent[] => [
    ...list
      .filter(a => !gone.has(a.id))
      .map((a): Agent => {
        const old = was.find(p => p.id === a.id)
        return {
          id: a.id,
          description: a.description,
          type: a.type,
          status: a.status,
          model: old?.model ?? null,
          effort: old?.effort ?? null,
          startedAt: old?.startedAt ?? t,
          doneAt: ENDED.has(a.status) ? (old?.doneAt ?? t) : null,
          context: old?.context ?? 0,
          in: old?.in ?? 0,
          out: old?.out ?? 0,
          cacheRead: old?.cacheRead ?? 0,
          cacheWrite: old?.cacheWrite ?? 0,
          calls: old?.calls ?? 0,
          usd: old?.usd ?? 0,
          cacheAt: old?.cacheAt ?? null,
          cacheTtlMs: old?.cacheTtlMs ?? FIVE_MINUTES,
        }
      }),
    // Claude Code drops a finished agent's task some seconds after it ends, raising nothing.
    ...was.filter(p => !gone.has(p.id) && !list.some(a => a.id === p.id)).map(p => (p.doneAt === null ? { ...p, status: 'completed', doneAt: t } : p)),
  ]
  const next = merge(prev)
  const expired = next.filter(a => a.doneAt !== null && t - a.doneAt >= LINGER_MS).map(a => a.id)
  const isSame = next.length === prev.length && next.every(a => prev.some(p => p.id === a.id && p.status === a.status && p.doneAt === a.doneAt))
  const held = isSame ? prev : await update($, agents, merge)
  for (const id of expired) await dropAgent($, id)
  const isStaying = (id: string) => !gone.has(id) && !leaving.has(id)
  if (list.some(a => isStaying(a.id)) || held.some(a => isStaying(a.id))) agentWatch ??= $.clock.every(AGENT_POLL_MS, () => void refreshAgents($).catch(() => undefined))
  else {
    agentWatch?.cancel()
    agentWatch = null
  }
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
let ticker: { cancel: () => void } | null = null
let agentWatch: { cancel: () => void } | null = null
const AGENT_POLL_MS = 5000
let seededFor: string | null = null
let isAwaitingConversation = false
let seedTries = 0
const SEED_TRIES = 10
let isPanelOffered = false
let turnStartedAt: number | null = null

const unmatchedSteps = new Map<string, string[]>()
const unmatchedCosts = new Map<string, { usd: number; ttl: (was: number | undefined) => number }[]>()

function usageKey(input: number, output: number, cacheRead: number, cacheWrite: number): string {
  return `${input}|${output}|${cacheRead}|${cacheWrite}`
}

function remember<V>(waiting: Map<string, V[]>, key: string, value: V): void {
  waiting.set(key, [...(waiting.get(key) ?? []), value])
  if (waiting.size > 100) waiting.delete(waiting.keys().next().value as string)
}

function take<V>(waiting: Map<string, V[]>, key: string): V | undefined {
  const [first, ...rest] = waiting.get(key) ?? []
  if (rest.length > 0) waiting.set(key, rest)
  else waiting.delete(key)
  return first
}

async function seedSkin($: $, options: Record<string, unknown>): Promise<void> {
  const rows = await $.config.list().catch(() => [])
  const row = (key: string) => rows.find(x => x.key === key)?.value
  const theme = row('theme')
  await update($, skin, () => skinOfTheme(theme)?.skin ?? 'classic')
  await update($, isLight, () => isKnownLightTheme(theme))
  await update($, chatSkinned, () => (row('pitwall.chatSkin') ?? options.chatSkin) !== false)
  await update($, grounded, () => (row('pitwall.terminalBackground') ?? options.terminalBackground) !== false)
}

async function paint($: $): Promise<{ name: string; P: Palette }> {
  const [name, light] = await Promise.all([read($, skin), read($, isLight)])
  return { name, P: paletteOf(name, light) }
}

async function chatPalette($: $): Promise<Palette | null> {
  const { name, P } = await paint($)
  return (await read($, chatSkinned)) && name !== 'classic' ? P : null
}

async function seedSession($: $): Promise<void> {
  const [usage, model, version, n, t, id] = await Promise.all([
    $.session.usage(),
    $.session.model(),
    $.session.version(),
    $.session.turns(),
    $.clock.now(),
    $.session.id(),
  ])
  seededFor = id
  captured.clear()
  const setEffort = await settingsEffort($, model)
  await update($, meta, m => ({
    model: m?.model ?? model,
    effort: m?.effort ?? setEffort,
    sessionEffort: m?.sessionEffort ?? null,
    version: version.base ?? version.version,
    startedAt: usage.startedAt,
  }))
  const carried = usage.rateLimits.length > 0 ? [] : carriedRate(await $.store.get('rate').catch(() => undefined), t)
  await update($, reading, () => ({ ...toReading(usage), ...(carried.length > 0 && { rate: carried }) }))
  await update($, menu, () => null)
  await update($, motion, () => ({}))
  if (leaving.size > 0) await forget($, [...leaving])
  await update($, turns, () => n)
  await update($, now, () => t)
  await refreshPlace($)
  await refreshAgents($)
  await readPrices($)
  const kept = await $.store.get('folded').catch(() => undefined)
  if (Array.isArray(kept)) await update($, folded, () => kept.filter((x): x is string => typeof x === 'string'))
  seedTries = 0
  isAwaitingConversation = !(await seed($)) && n === 0
}

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

let advisorReads = 0
async function refreshAdvisor($: $): Promise<void> {
  const n = ++advisorReads
  const scan = await readTranscript($)
  if (scan && n === advisorReads) await update($, advisor, () => scan.advisor)
}

const advisedAgents = new Set<string>()
const agentAdvisorReads = new Map<string, number>()

async function refreshAgentAdvisor($: $, id: string): Promise<void> {
  const n = (agentAdvisorReads.get(id) ?? 0) + 1
  agentAdvisorReads.set(id, n)
  const main = await transcriptPath($)
  const path = main && /^[\w-]+$/.test(id) ? `${main.replace(/\.jsonl$/, '')}/subagents/agent-${id}.jsonl` : null
  if (!path || !(await $.fs.exists(path))) return
  const found = await readAdvisor($, path)
  if (found && agentAdvisorReads.get(id) === n) await update($, agentAdvisor, x => ({ ...x, [id]: found }))
}

async function readAdvisor($: $, path: string): Promise<Advisor | null> {
  const byMessage = new Map<string, Iteration[]>()
  for await (const line of transcriptLines($, path)) {
    if (!line.includes('"advisor_message"')) continue
    try {
      const row = JSON.parse(line)
      const u = row?.message?.usage
      if (row.type !== 'assistant' || !Array.isArray(u?.iterations)) continue
      const calls: Iteration[] = u.iterations.filter((it: Iteration) => it.type === 'advisor_message')
      byMessage.set(row.message.id ?? line, calls.map(it => ({ ...it, inference_geo: u.inference_geo })))
    } catch {
    }
  }
  return sumAdvisor([...byMessage.values()].flat())
}

async function measureTranscript($: $): Promise<void> {
  const path = await transcriptPath($)
  const stat = path ? await $.fs.stat(path).catch(() => null) : null
  await update($, transcriptBytes, () => stat?.size ?? null)
}

async function awaitConversation($: $): Promise<void> {
  if ((await $.session.turns()) === 0 || !isAwaitingConversation) return
  isAwaitingConversation = false
  if (!(await seed($)) && ++seedTries < SEED_TRIES) isAwaitingConversation = true
}

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
          calls: iterations
            .filter(it => it.type === 'advisor_message')
            .map(it => ({ ...it, inference_geo: u.inference_geo })),
        })
      } catch {
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
    return null
  }
}

// $.fs.read stops at 4 MiB, which a long session's transcript passes, so a
// larger one is streamed through a child that prints it, piece by piece. On
// Windows that is `findstr /r ^`, every line byte for byte. Backslashes only,
// or it reads `/.claude` as a switch.
export const FS_READ_MAX = 4 * 1024 * 1024

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

const SAVE_PS =
  'Add-Type -AssemblyName System.Windows.Forms, System.Drawing;' +
  '$img = [System.Windows.Forms.Clipboard]::GetImage(); if ($null -eq $img) { exit 1 };' +
  "Get-ChildItem -LiteralPath (Split-Path $env:PITWALL_SAVE) -Filter 'pitwall-*.png' | Where-Object LastWriteTime -lt (Get-Date).AddDays(-1) | Remove-Item -ErrorAction SilentlyContinue;" +
  '$img.Save($env:PITWALL_SAVE, [System.Drawing.Imaging.ImageFormat]::Png)'

const captured = new Map<number, Promise<Preview | null>>()
let draftImageIds = new Set<number>()

async function syncPreviews($: $, text: string, isPaste: boolean): Promise<void> {
  const ids = new Set([...text.matchAll(/\[Image #(\d+)\]/g)].map(m => Number(m[1])))
  draftImageIds = ids
  if ((await read($, previews)).some(p => !ids.has(p.id))) await update($, previews, list => list.filter(p => ids.has(p.id)))
  for (const id of ids) {
    if (isPaste && !captured.has(id)) captured.set(id, captureClipboard($, id).catch(() => null))
    const preview = await captured.get(id)
    if (preview && draftImageIds.has(id)) await update($, previews, list => (list.some(p => p.id === id) ? list : [...list, preview]))
  }
}

async function captureClipboard($: $, id: number): Promise<Preview | null> {
  const [os, temp, session] = await Promise.all([$.env.get('OS'), $.env.get('TEMP'), $.session.id()])
  if (os !== 'Windows_NT' || !temp) return null
  const path = `${temp.replace(/[\\/]+$/, '')}\\pitwall-${session.replace(/[^\w-]/g, '_')}-${id}.png`
  const r = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Sta', '-Command', SAVE_PS], {
    env: { PITWALL_SAVE: path },
    timeoutMs: 10_000,
  })
  return r.exitCode === 0 ? { id, path } : null
}

const isCost = (v: unknown, max = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max

async function readPrices($: $): Promise<void> {
  const config = await globalConfigPath($)
    .then(path => (path ? $.fs.read(path) : '{}'))
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
    const org = orgPricing?.overrides[model.toLowerCase()]
    const p = priceOf(model)
    sum.in += (call.input_tokens ?? 0) + (call.cache_read_input_tokens ?? 0) + written(call)
    sum.out += call.output_tokens ?? 0
    usd = usd === null || p === undefined ? null : usd + priceCall(p, call, org === undefined) * (orgPricing?.multiplier ?? 1)
  }
  return { model: calls.at(-1)?.model ?? '', calls: calls.length, ...sum, usd }
}

function priceOf(model: string): Price | undefined {
  return orgPricing?.overrides[model.toLowerCase()] ?? PRICE[priceRemap[model] ?? ''] ?? PRICE[model] ?? newerPrices[model]
}

const bare = (model: string) => model.replace(/\[.*\]$/, '')

function ttlOf(fiveMinute: unknown, hour: unknown, was: number | undefined): number {
  return Number(hour) > 0 ? HOUR : Number(fiveMinute) > 0 ? FIVE_MINUTES : (was ?? FIVE_MINUTES)
}

function written(call: Iteration): number {
  const split = call.cache_creation
  return call.cache_creation_input_tokens ?? (split?.ephemeral_5m_input_tokens ?? 0) + (split?.ephemeral_1h_input_tokens ?? 0)
}

function priceCall(base: Price, call: Iteration, isGeoPriced = true): number {
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
  return isGeoPriced && call.inference_geo === 'us' ? usd * US_INFERENCE_MULTIPLIER : usd
}

function add(a: Tokens, b: Tokens): Tokens {
  return {
    in: a.in + b.in,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheRead: a.cacheRead + b.cacheRead,
    out: a.out + b.out,
  }
}

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
    return null
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

function windowLabel(size: number): string {
  const k = Math.floor(size / 1000)
  return k >= 1000 ? `${Math.floor(k / 1000)}M` : `${k}K`
}

function pctColor(P: Palette, pct: number): string {
  return pct >= RAMP_HIGH ? P.bad : pct >= RAMP_MID ? P.warn : P.ok
}

const effortOf = (P: Palette, level: string) => P.efforts[level.toLowerCase() as keyof Palette['efforts']] ?? P.efforts.medium

function effortColor(P: Palette, level: string): string {
  return effortOf(P, level).color
}

function effortShine(P: Palette, level: string): string {
  return effortOf(P, level).shine
}

function modelColor(P: Palette, alias: string): string {
  const family = /^(opus|sonnet|haiku|fable)/.exec(alias.toLowerCase())?.[1] as keyof Palette['models'] | undefined
  return (family && P.models[family]) || P.models.other
}

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
