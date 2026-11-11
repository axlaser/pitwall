import type { Elements } from 'claude-code'
import { hexOf, mixRgb, rgbOf } from './glow'

type El = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button' | 'Svg' | 'Link'>

export type Tone = 'accent' | 'text' | 'muted' | 'ok' | 'warn' | 'bad' | 'info' | 'alt' | 'cool'

const INK: Record<Tone, string> = {
  accent: 'claude',
  text: 'text',
  muted: 'inactive',
  ok: 'success',
  warn: 'warning',
  bad: 'error',
  info: 'permission',
  alt: 'autoAccept',
  cool: 'merged',
}
const TRACK = 'promptBorder'
// Icons and the meter's lights are Svg images, which cannot take the page's
// tokens: mid tones that read on the app's light and dark grounds alike.
const HUE = {
  grey: '#8b8d98',
  blue: '#4f8ff7',
  purple: '#a371f7',
  cyan: '#2fb3c6',
  amber: '#d29922',
  green: '#3fb950',
  red: '#f85149',
  brand: '#d97757',
}
const RAMP: [number, string][] = [
  [0, HUE.green],
  [60, HUE.amber],
  [85, HUE.red],
  [100, HUE.red],
]

const GLYPHS = {
  folder: '<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  branch: '<circle cx="6" cy="5" r="2.2"/><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="7" r="2.2"/><path d="M6 7.2v9.6"/><path d="M18 9.2c0 5-12 3-12 7.6"/>',
  gauge: '<path d="M4.6 17.5a9 9 0 1 1 14.8 0"/><path d="m12 13 4.2-4.2"/><circle cx="12" cy="13" r="1.4"/>',
  input: '<path d="M12 3.5v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20.5h14"/>',
  output: '<path d="M12 15V4"/><path d="m7 8.5 5-5 5 5"/><path d="M5 20.5h14"/>',
  zap: '<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-4.9"/>',
  panel: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M15 4.5v15"/>',
  chart: '<path d="M3.5 20.5h17"/><rect x="5" y="11" width="3.2" height="6.5" rx="1"/><rect x="10.4" y="5.5" width="3.2" height="12" rx="1"/><rect x="15.8" y="8.5" width="3.2" height="9" rx="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  sparkle: '<path d="M12 3.5 13.9 9l5.6 2-5.6 2L12 18.5 10.1 13l-5.6-2 5.6-2z"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4.5V8"/><circle cx="12" cy="3.5" r="1"/><path d="M9 13.2v1.6M15 13.2v1.6"/>',
  message: '<path d="M4 5h16a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 17H9.5L5 20.5V17H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 5z"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V10M9.5 2.5h5"/>',
  hourglass: '<path d="M6.5 3h11M6.5 21h11"/><path d="M7.5 3c0 4.5 4.5 5.5 4.5 9s-4.5 4.5-4.5 9M16.5 3c0 4.5-4.5 5.5-4.5 9s4.5 4.5 4.5 9"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.3 3 7.9 7 9.5 4-1.6 7-5.2 7-9.5V6z"/><path d="m9 12 2.2 2.2L15 10.4"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.4c-.5-.9-1.6-1.5-2.8-1.5-1.7 0-3 .9-3 2.1 0 2.9 6 1.4 6 4.2 0 1.2-1.3 2.1-3 2.1-1.3 0-2.4-.6-2.9-1.5M12 6v1.9M12 16.3V18"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
}
export type Glyph = keyof typeof GLYPHS
const GLYPH_HUE: Record<Glyph, string> = {
  folder: HUE.grey,
  branch: HUE.grey,
  gauge: HUE.green,
  input: HUE.blue,
  output: HUE.purple,
  zap: HUE.cyan,
  database: HUE.amber,
  check: HUE.green,
  panel: HUE.grey,
  chart: HUE.blue,
  clock: HUE.blue,
  sparkle: HUE.purple,
  bot: HUE.grey,
  message: HUE.grey,
  timer: HUE.green,
  hourglass: HUE.grey,
  file: HUE.grey,
  shield: HUE.green,
  coin: HUE.brand,
  calendar: HUE.blue,
}

function icon(el: El, glyph: Glyph, alt: string, size = 14, hex = GLYPH_HUE[glyph]) {
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${hex}" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[glyph]}</svg>`
  return <el.Svg source={source} alt={alt} width={size} />
}

export type Fig = { key: string; text: string; tone?: Tone }
export type Part = string | Fig
export type Stat = { label: string; parts: Part[]; icon?: Glyph }

export type BandFacts = {
  isWorking: boolean

  context: { percent: number; tone: Tone; pct: Fig; used: Fig | null; window: string | null } | null
  tokens: { kind: 'in' | 'out' | 'cacheRead' | 'cacheWrite'; label: string; value: Fig; delta: Fig | null }[]
  repo: { name: string; path: string; remote: string | null; branch: string | null; branchTone: Tone; counts: { text: string; tone: Tone }[] }
  isPanelOpen: boolean
  canCompact: boolean
}
export type BandActs = { togglePanel: () => void; compact: () => void }

export type Rate = { kind: string; name: string; pct: Fig; percent: number; tone: Tone; pace: number | null; resets: string | null; burn: Fig | null }
export type Cost = { total: Fig; parts: { label: string; usd: Fig; share: Fig; tone: Tone; weight: number }[] }
export type CacheFacts = { isWarm: boolean; status: string; time: string; percent: number | null; tone: Tone; rows: Stat[] }
export type AdvisorFacts = { model: string; calls: Part[]; rows: Stat[]; share: number | null }
export type AgentFacts = {
  id: string
  type: string
  description: string
  state: 'working' | 'stopping' | 'done' | 'failed'
  stateText: string
  elapsed: string | null
  model: string | null
  calls: Part[]
  stats: Stat[]
  cache: { percent: number; tone: Tone; time: string; isResumable: boolean } | null
  isArmed: boolean
}
export type Body =
  | { kind: 'usage'; windows: Rate[] }
  | { kind: 'session'; stats: Stat[]; cost: Cost | null }
  | { kind: 'cache'; cache: CacheFacts | null }
  | { kind: 'advisor'; advisor: AdvisorFacts }
  | { kind: 'agents'; agents: AgentFacts[] }
export type Section = { name: string; title: string; summary: string; tone: Tone; isOpen: boolean; body: Body }
export type PaneFacts = { sections: Section[]; version: string | null; changelog: string }
export type PaneActs = { fold: (name: string) => void; stop: (id: string) => void; dismiss: (id: string) => void }

type Size = 'caption' | 'footnote' | 'body' | 'heading'
type Weight = 'medium' | 'semibold'

const clamp = (percent: number) => Math.min(100, Math.max(0, percent))

export function rampAt(at: number): string {
  const i = Math.max(1, RAMP.findIndex(([stop]) => stop >= at))
  const [a, from] = RAMP[i - 1] ?? RAMP[0]!
  const [b, to] = RAMP[i] ?? RAMP[0]!
  return hexOf(mixRgb(rgbOf(from) ?? [], rgbOf(to) ?? [], b === a ? 0 : (clamp(at) - a) / (b - a)))
}

const lit = (percent: number, leds: number) => Math.round((clamp(percent) / 100) * leds)
const ledAt = (i: number, leds: number) => ((i + 0.5) / leds) * 100

// Claude at work: an uneven spark that blooms from a dot, opens wide while it
// turns a little, and closes back, the motion the app gives its own spark
// while Claude thinks. The source never changes, so the page keeps the one
// running image through every redraw.
const RAYS: [number, number, number][] = [
  [0, 9.6, 2.6],
  [31, 7.4, 2.2],
  [64, 9.0, 2.5],
  [98, 6.9, 2.1],
  [130, 9.4, 2.6],
  [163, 7.8, 2.3],
  [196, 8.8, 2.5],
  [229, 6.6, 2.0],
  [262, 9.5, 2.6],
  [295, 7.2, 2.2],
  [328, 8.6, 2.4],
]
const BLOOM_S = 1.3
export function sparkSource(size: number): string {
  const rays = RAYS.map(
    ([deg, reach, weight]) => `<line x1="12" y1="10.4" x2="12" y2="${(12 - 1.6 - reach).toFixed(2)}" stroke-width="${weight}" transform="rotate(${deg} 12 12)"/>`,
  ).join('')
  // Scale and turn add up about the centre; the turn jumps back while the
  // spark is a dot, where the jump cannot be seen.
  const bloom =
    `<animateTransform attributeName="transform" type="scale" values=".22;1;1;.22" keyTimes="0;.42;.58;1" calcMode="spline" ` +
    `keySplines=".2 .7 .3 1;0 0 1 1;.7 0 .8 .3" dur="${BLOOM_S}s" repeatCount="indefinite" additive="sum"/>` +
    `<animateTransform attributeName="transform" type="rotate" values="-30;40" dur="${BLOOM_S}s" repeatCount="indefinite" additive="sum"/>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">` +
    `<g transform="translate(12 12)"><g>${bloom}<g transform="translate(-12 -12)" stroke="${HUE.brand}" stroke-linecap="round">${rays}</g></g></g></svg>`
  )
}
function spark(el: El, size = 14) {
  return <el.Svg source={sparkSource(size)} alt="Working" width={size} />
}

// The band's context meter: a row of shift lights, each lit in the ramp's
// colour at its place. While Claude works a sheen crosses the lit lights at an
// even pace, leaves them whole, and rests before the next pass.
// The page draws an Svg as an image from its source, and a source it has drawn
// before is the same running image: so the source holds nothing that changes
// between redraws but the lights themselves, and a redraw never restarts it.
const HERO = { leds: 20, w: 6, gap: 2, h: 8 }
const SHEEN = 28
const SHEEN_PX_PER_S = 110
const SHEEN_REST_S = 0.9
export function heroSource(percent: number, isWorking: boolean): string {
  const { leds, w, gap, h } = HERO
  const width = leds * w + (leds - 1) * gap
  const on = lit(percent, leds)
  const end = on * (w + gap) - gap
  const led = (i: number, fill: string, opacity = 1) =>
    `<rect x="${i * (w + gap)}" y="0" width="${w}" height="${h}" rx="1.5" fill="${fill}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}/>`
  const lights = Array.from({ length: leds }, (_, i) => (i < on ? led(i, rampAt(ledAt(i, leds))) : led(i, HUE.grey, 0.28))).join('')
  const travel = (end + SHEEN) / SHEEN_PX_PER_S
  const cycle = travel + SHEEN_REST_S
  const sheen =
    isWorking && on > 0
      ? `<defs><clipPath id="lit">${Array.from({ length: on }, (_, i) => led(i, '#000')).join('')}</clipPath>` +
        '<linearGradient id="shine" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>' +
        `<g clip-path="url(#lit)"><rect x="${-SHEEN}" y="0" width="${SHEEN}" height="${h}" fill="url(#shine)">` +
        `<animate attributeName="x" values="${-SHEEN};${end};${end}" keyTimes="0;${(travel / cycle).toFixed(3)};1" dur="${cycle.toFixed(3)}s" repeatCount="indefinite"/></rect></g>`
      : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${lights}${sheen}</svg>`
}

function meter(el: El, percent: number, tone: Tone, mark: number | null = null) {
  const { Box } = el
  const filled = clamp(percent)
  return (
    <Box position="relative" width="100%" height={0.3} borderStyle="round" borderColor={TRACK} backgroundColor={TRACK} padding={0} overflow="hidden">
      {filled > 0 && <Box width={`${Math.max(2, Math.round(filled))}%`} height="100%" borderStyle="round" borderColor={INK[tone]} backgroundColor={INK[tone]} padding={0} />}
      {mark !== null && (
        <Box position="absolute" top={0} left={0} width="100%" height="100%">
          <Box width={`${clamp(mark)}%`} height="100%" />
          <Box width={0.2} height="100%" backgroundColor="text" />
        </Box>
      )}
    </Box>
  )
}

function split(el: El, parts: Cost['parts']) {
  const { Box } = el
  const whole = parts.reduce((sum, part) => sum + part.weight, 0) || 1
  return (
    <Box key="cost-split" width="100%" height={0.3} columnGap={0.3}>
      {parts.map(part => (
        <Box width={`${Math.max(1, Math.round((part.weight / whole) * 100))}%`} height="100%" borderStyle="round" borderColor={INK[part.tone]} backgroundColor={INK[part.tone]} padding={0} flexShrink={1} />
      ))}
    </Box>
  )
}

function figureOf(el: El, f: Fig, look: { size?: Size; weight?: Weight } = {}) {
  const { Box, Text } = el
  return (
    <Box key={`n-${f.key}`} flexShrink={0}>
      <Text tabular size={look.size} weight={look.weight} {...(f.tone && { color: INK[f.tone] })}>
        {f.text}
      </Text>
    </Box>
  )
}

function parts(el: El, list: Part[], size: Size = 'footnote') {
  const { Box, Text } = el
  return (
    <Box alignItems="center" flexWrap="wrap" flexShrink={0}>
      {list.map(part =>
        typeof part === 'string' ? (
          <Text size={size} color="inactive">
            {part}
          </Text>
        ) : (
          figureOf(el, part, { size })
        ),
      )}
    </Box>
  )
}

function label(el: El, glyph: Glyph | undefined, text: string, size = 12) {
  const { Box, Text } = el
  return (
    <Box alignItems="center" columnGap="xs">
      {glyph && icon(el, glyph, text, size)}
      <Text size="caption" color="inactive" wrap="truncate-end">
        {text}
      </Text>
    </Box>
  )
}

// A figure in a card: its icon and small label, the value in a larger weight,
// and whatever follows the value on a small line of its own beneath it.
function stat(el: El, s: Stat) {
  const { Box, Text } = el
  const at = s.parts.findIndex(part => typeof part !== 'string')
  const lead = s.parts[at]
  const rest = at < 0 ? s.parts : s.parts.slice(at + 1)
  const first = rest[0]
  const after = typeof first === 'string' ? [first.replace(/^\s*(·\s*)?/, ''), ...rest.slice(1)].filter(part => part !== '') : rest
  return (
    <Box flexDirection="column">
      {label(el, s.icon, s.label)}
      {lead !== undefined && typeof lead !== 'string' && figureOf(el, lead, { size: 'body', weight: 'semibold' })}
      {after.length > 0 && (
        <Box alignItems="center" flexWrap="wrap">
          {after.map(part =>
            typeof part === 'string' ? (
              <Text size="caption" color="inactive">
                {part}
              </Text>
            ) : (
              figureOf(el, part, { size: 'caption' })
            ),
          )}
        </Box>
      )}
    </Box>
  )
}

function tiles(el: El, stats: Stat[], columns = 2) {
  const { Box } = el
  return (
    <Box flexWrap="wrap" rowGap="md">
      {stats.map(s => (
        <Box width={`${Math.floor(100 / columns)}%`} paddingRight="sm">
          {stat(el, s)}
        </Box>
      ))}
    </Box>
  )
}

const TOKEN_GLYPH: Record<BandFacts['tokens'][number]['kind'], Glyph> = { in: 'input', out: 'output', cacheRead: 'zap', cacheWrite: 'database' }

// A figure the band shows: a coloured icon and a small label over its value.
function tile(el: El, key: string, glyph: JSX.Element, text: string, value: (JSX.Element | null)[], aside: JSX.Element | null = null) {
  const { Box, Text } = el
  return (
    <Box key={`tile-${key}`} flexDirection="column" rowGap="xs" flexShrink={0}>
      <Box alignItems="center" justifyContent="space-between" columnGap="md">
        <Box alignItems="center" columnGap="xs">
          {glyph}
          <Text size="caption" color="inactive">
            {text}
          </Text>
        </Box>
        {aside}
      </Box>
      <Box alignItems="center" columnGap="sm">
        {value}
      </Box>
    </Box>
  )
}

export function deskBand(el: El, f: BandFacts, act: BandActs) {
  const { Box, Text, Button, Link, Svg } = el
  const ctx = f.context
  const project = (
    <Box key="project" alignItems="center" columnGap="xs" flexShrink={0}>
      {icon(el, 'folder', 'Project')}
      {f.repo.remote ? (
        <Link href={f.repo.remote} label={f.repo.name} />
      ) : (
        <Text size="footnote" weight="semibold">
          {f.repo.name}
        </Text>
      )}
    </Box>
  )
  const branch = f.repo.branch && (
    <Box key="branch" alignItems="center" columnGap="xs" flexShrink={0}>
      {icon(el, 'branch', 'Branch', 14, f.repo.branchTone === 'warn' ? HUE.amber : HUE.green)}
      <Text size="footnote" color="inactive">
        {f.repo.branch}
      </Text>
    </Box>
  )
  const counts = f.repo.counts.length > 0 && (
    <Box key="counts" alignItems="center" columnGap="sm" flexShrink={0}>
      {f.repo.counts.map(count => (
        <Text size="footnote" tabular color={INK[count.tone]}>
          {count.text}
        </Text>
      ))}
    </Box>
  )
  const status = f.isWorking ? (
    <Box key="state" alignItems="center" columnGap="xs" flexShrink={0}>
      {spark(el, 15)}
      <Text size="footnote" weight="medium" color="claude">
        Working
      </Text>
    </Box>
  ) : (
    <Box key="state" alignItems="center" columnGap="xs" flexShrink={0}>
      {icon(el, 'check', 'Ready')}
      <Text size="footnote" color="inactive">
        Ready
      </Text>
    </Box>
  )
  const sidebar = (
    <Box key="sidebar" alignItems="center" columnGap="xs" flexShrink={0}>
      {icon(el, 'panel', 'Sidebar')}
      <Button plain dimColor key="panel" label={f.isPanelOpen ? 'Hide sidebar' : 'Sidebar'} onPress={act.togglePanel} />
    </Box>
  )
  const context =
    ctx &&
    tile(
      el,
      'context',
      icon(el, 'gauge', 'Context', 14, rampAt(ctx.percent)),
      'Context',
      [
        <Box key="bar" flexShrink={0}>
          <Svg source={heroSource(ctx.percent, f.isWorking)} alt={`Context ${Math.round(ctx.percent)}% full`} />
        </Box>,
        figureOf(el, ctx.pct, { size: 'body', weight: 'semibold' }),
      ],
      ctx.used && (
        <Box alignItems="center">
          {figureOf(el, ctx.used, { size: 'caption' })}
          {ctx.window && (
            <Text size="caption" color="inactive" tabular>
              {` / ${ctx.window}`}
            </Text>
          )}
        </Box>
      ),
    )
  const tokens = f.tokens.map(token =>
    tile(el, token.kind, icon(el, TOKEN_GLYPH[token.kind], token.label), token.label, [
      figureOf(el, token.value, { size: 'body', weight: 'semibold' }),
      token.delta && figureOf(el, token.delta, { size: 'caption' }),
    ]),
  )
  return (
    <Box flexDirection="column" rowGap="sm" paddingX="sm" paddingY="xs">
      <Box key="place" justifyContent="space-between" alignItems="center" columnGap="lg" rowGap="xs" flexWrap="wrap">
        <Box alignItems="center" columnGap="md" rowGap="xs" flexWrap="wrap">
          {project}
          {branch}
          {counts}
        </Box>
        <Box alignItems="center" columnGap="lg" flexShrink={0}>
          {f.canCompact && <Button key="compact" variant="secondary" label="Compact context" onPress={act.compact} />}
          {status}
          {sidebar}
        </Box>
      </Box>
      <Box key="tiles" justifyContent="space-between" alignItems="center" columnGap="md" rowGap="sm" flexWrap="wrap">
        {[...(context ? [context] : []), ...tokens]}
      </Box>
    </Box>
  )
}

function usage(el: El, windows: Rate[]) {
  const { Box, Text } = el
  return windows.map(w => (
    <Box key={`usage-${w.kind}`} flexDirection="column" rowGap="xs">
      <Box justifyContent="space-between" alignItems="center" columnGap="sm">
        {label(el, w.kind === 'five_hour' ? 'clock' : 'calendar', w.name)}
        {w.resets !== null && (
          <Text size="caption" color="inactive" tabular>
            {`Resets in ${w.resets}`}
          </Text>
        )}
      </Box>
      <Box justifyContent="space-between" alignItems="center" columnGap="sm">
        <Box alignItems="center" columnGap="sm">
          {figureOf(el, w.pct, { size: 'body', weight: 'semibold' })}
          {w.burn && figureOf(el, w.burn, { size: 'caption' })}
        </Box>
        {w.pace !== null && (
          <Text size="caption" color="inactive" tabular>
            {`Pace ${w.pace}%`}
          </Text>
        )}
      </Box>
      {meter(el, w.percent, w.tone, w.pace)}
    </Box>
  ))
}

function session(el: El, stats: Stat[], cost: Cost | null) {
  const { Box, Text } = el
  return [
    tiles(el, stats),
    ...(cost === null
      ? []
      : [
          <Box flexDirection="column" rowGap="sm">
            <Box flexDirection="column">
              {label(el, 'coin', 'Cost')}
              {figureOf(el, cost.total, { size: 'heading', weight: 'semibold' })}
            </Box>
            {cost.parts.length > 0 && split(el, cost.parts)}
            <Box flexDirection="column" rowGap="xs">
              {cost.parts.map(part => (
                <Box justifyContent="space-between" alignItems="center" columnGap="md">
                  <Box alignItems="center" columnGap="xs">
                    <Text size="caption" color={INK[part.tone]}>
                      ●
                    </Text>
                    <Text size="footnote">{part.label}</Text>
                  </Box>
                  <Box alignItems="center" columnGap="md" flexShrink={0}>
                    {figureOf(el, part.usd, { size: 'footnote' })}
                    <Box width={5} justifyContent="flex-end">
                      {figureOf(el, { ...part.share, tone: part.tone }, { size: 'footnote' })}
                    </Box>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>,
        ]),
  ]
}

function cacheCard(el: El, c: CacheFacts) {
  const { Box, Text } = el
  return [
    <Box justifyContent="space-between" alignItems="center" columnGap="sm">
      <Box alignItems="center" columnGap="xs">
        <Text size="caption" color={INK[c.tone]}>
          {c.isWarm ? '●' : '○'}
        </Text>
        <Text size="body" weight="semibold" color={c.isWarm ? INK[c.tone] : 'text'}>
          {c.status}
        </Text>
      </Box>
      <Text size="footnote" tabular color="inactive">
        {c.time}
      </Text>
    </Box>,
    ...(c.percent === null ? [] : [<Box key="cache-left">{meter(el, c.percent, c.tone)}</Box>]),
    ...(c.rows.length === 0 ? [] : [tiles(el, c.rows)]),
  ]
}

function advisorCard(el: El, a: AdvisorFacts) {
  const { Box, Text } = el
  return [
    <Box justifyContent="space-between" alignItems="center" columnGap="sm">
      <Box alignItems="center" columnGap="xs">
        {icon(el, 'sparkle', 'Advisor')}
        <Text size="body" weight="semibold" wrap="truncate-end">
          {a.model}
        </Text>
      </Box>
      {parts(el, a.calls, 'caption')}
    </Box>,
    tiles(el, a.rows),
    ...(a.share === null ? [] : [<Box key="advisor-share">{meter(el, a.share, 'alt')}</Box>]),
  ]
}

function stateOf(el: El, a: AgentFacts) {
  const { Box, Text } = el
  if (a.state === 'working')
    return (
      <Box key={`working-${a.id}`} alignItems="center" columnGap="xs">
        {spark(el, 12)}
        <Text size="footnote" color={INK.accent}>
          {a.stateText}
        </Text>
      </Box>
    )
  const tone: Tone = a.state === 'done' ? 'ok' : 'bad'
  return (
    <Text size="footnote" color={INK[tone]}>
      {a.stateText}
    </Text>
  )
}

// The desktop app keeps its main view on the conversation (`$.ui.view` is
// refused there), so a card names its agent without offering to open it.
const agentTint = (a: AgentFacts): { tone: Tone; isDim: boolean } =>
  a.state === 'stopping' ? { tone: 'bad', isDim: false } : { tone: a.state === 'working' ? 'accent' : a.state === 'done' ? 'ok' : 'bad', isDim: true }

function agentCard(el: El, a: AgentFacts, act: PaneActs) {
  const { Box, Text, Button } = el
  const tint = agentTint(a)
  return (
    <Box key={`agent-${a.id}`} flexDirection="column" rowGap="sm" borderStyle="round" borderColor={INK[tint.tone]} borderDimColor={tint.isDim}>
      <Box flexDirection="column">
        <Box justifyContent="space-between" alignItems="center" columnGap="sm">
          <Box key={`name-${a.id}`} alignItems="center" columnGap="xs">
            {icon(el, 'bot', 'Agent')}
            <Text size="footnote" weight="semibold" wrap="truncate-end">
              {a.type}
            </Text>
          </Box>
          <Box alignItems="center" columnGap="sm" flexShrink={0}>
            {stateOf(el, a)}
            {a.elapsed && (
              <Text size="footnote" tabular color="inactive">
                {a.elapsed}
              </Text>
            )}
          </Box>
        </Box>
        {a.description && (
          <Text size="caption" color="inactive" wrap="truncate-end">
            {a.description}
          </Text>
        )}
      </Box>
      {(a.model || a.calls.length > 0) && (
        <Box justifyContent="space-between" alignItems="center" columnGap="sm">
          <Text size="footnote" color={INK.alt} wrap="truncate-end">
            {a.model ?? ''}
          </Text>
          {parts(el, a.calls, 'caption')}
        </Box>
      )}
      {a.stats.length > 0 && tiles(el, a.stats, 3)}
      {a.cache && (
        <Box alignItems="center" columnGap="sm">
          {label(el, 'database', 'Cache')}
          <Box key={`cache-left-${a.id}`} flexGrow={1}>
            {meter(el, a.cache.percent, a.cache.tone)}
          </Box>
          <Text size="caption" tabular color={INK[a.cache.tone]}>
            {a.cache.time}
          </Text>
          {a.cache.isResumable && (
            <Text size="caption" color="inactive">
              if resumed
            </Text>
          )}
        </Box>
      )}
      {a.state === 'working' ? (
        <Box justifyContent="flex-end">
          <Button key={`stop-${a.id}`} variant={a.isArmed ? 'primary' : 'secondary'} label={a.isArmed ? 'Confirm stop' : 'Stop'} onPress={() => act.stop(a.id)} />
        </Box>
      ) : a.state !== 'stopping' ? (
        <Box justifyContent="flex-end">
          <Button plain dimColor key={`dismiss-${a.id}`} label="Dismiss" onPress={() => act.dismiss(a.id)} />
        </Box>
      ) : null}
    </Box>
  )
}

function empty(el: El, text: string) {
  return (
    <el.Text size="footnote" color="inactive">
      {text}
    </el.Text>
  )
}

const HEAD: Record<Body['kind'], { glyph: Glyph; hex: string }> = {
  usage: { glyph: 'chart', hex: HUE.blue },
  session: { glyph: 'clock', hex: HUE.brand },
  cache: { glyph: 'database', hex: HUE.green },
  advisor: { glyph: 'sparkle', hex: HUE.purple },
  agents: { glyph: 'bot', hex: HUE.grey },
}

function bodyOf(el: El, body: Body, act: PaneActs) {
  const { Box } = el
  const card = (lines: JSX.Element[], gap: 'sm' | 'md' | 'lg' = 'md') => (
    <Box flexDirection="column" rowGap={gap} borderStyle="round">
      {lines}
    </Box>
  )
  switch (body.kind) {
    case 'usage':
      return card(usage(el, body.windows), 'lg')
    case 'session':
      return card(session(el, body.stats, body.cost), 'lg')
    case 'cache':
      return body.cache ? card(cacheCard(el, body.cache)) : empty(el, 'Nothing cached in this session yet.')
    case 'advisor':
      return card(advisorCard(el, body.advisor))
    case 'agents':
      return body.agents.length === 0 ? (
        empty(el, 'No agents running.')
      ) : (
        <Box flexDirection="column" rowGap="sm">
          {body.agents.map(a => agentCard(el, a, act))}
        </Box>
      )
  }
}

export function deskPane(el: El, f: PaneFacts, act: PaneActs) {
  const { Box, Text, Button, Link } = el
  return (
    <Box flexDirection="column" rowGap="lg" paddingY="sm">
      {f.sections.map(section => (
        <Box key={`section-${section.name}`} flexDirection="column" rowGap="sm">
          <Box justifyContent="space-between" alignItems="center" columnGap="sm">
            <Box alignItems="center" columnGap="xs">
              {icon(el, HEAD[section.body.kind].glyph, section.title, 13, HEAD[section.body.kind].hex)}
              <Button plain key={`fold-${section.name}`} onPress={() => act.fold(section.name)}>
                <Text size="caption" weight="semibold">
                  {section.name}
                </Text>
                <Text size="caption" color="inactive">
                  {section.isOpen ? ' ▾' : ' ▸'}
                </Text>
              </Button>
            </Box>
            {!section.isOpen && section.summary && (
              <Text size="caption" tabular color={INK[section.tone]} wrap="truncate-end">
                {section.summary}
              </Text>
            )}
          </Box>
          {section.isOpen && bodyOf(el, section.body, act)}
        </Box>
      ))}
      {f.version && (
        <Box justifyContent="space-between" alignItems="center" columnGap="sm">
          <Text size="caption" color="inactive" wrap="truncate-end">
            {`Claude Code v${f.version}`}
          </Text>
          <Link href={f.changelog} label="Changelog" />
        </Box>
      )}
    </Box>
  )
}
