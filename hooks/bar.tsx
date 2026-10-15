import type { ClientModule } from 'claude-code'

// `mark`, where given, is a percent drawn as a tick across the bar: where a
// rate window would stand at a steady pace. `color`, where given, fills it in
// that one colour in place of the ramp. The skin's `ramp` (hex, low to high),
// `track` and `markColor` paint it, render.rs's where not given.
type Props = { percent: number; isWorking: boolean; width: number; mark?: number; color?: string; ramp?: string[]; track?: string; markColor?: string }
// `shown` glides toward `target`; `phase` walks the shine while Claude works.
type State = { shown: number; target: number; isWorking: boolean; phase: number }

const TICK_MS = 50
// A smooth ramp by where a cell sits, through render.rs's thresholds: its
// first colour at the start, its second by 60 %, its third by 85 %.
const RAMP = ['#3fb950', '#d29922', '#f85149']
const TRACK = '#3c3c3c'
const MARK = '#ffffff'
type Stops = [number, number[]][]
const stopsOf = (ramp: string[]): Stops => {
  const [low, mid, high] = [0, 1, 2].map(i => rgbOf(ramp[i] ?? RAMP[i] ?? MARK))
  return [[0, low ?? []], [60, mid ?? []], [85, high ?? []], [100, high ?? []]]
}
// The shine's glow by distance from its centre: washed toward white, brightest
// in the middle and fading over the cells either side.
const GLOW = [0.75, 0.5, 0.3, 0.12]

// The context bar: one continuous line, heavy where filled and coloured along
// the ramp, light and dark where not, filled to half a cell (`╾`), gliding to
// a new reading rather than jumping, with a shine running across the filled
// part while Claude works. Idle and settled, the timer changes nothing and
// nothing redraws.
const Bar: ClientModule<Props, State> = (props, surface) => {
  const s = surface.state
  if (s === undefined) {
    surface.every(TICK_MS, () => tick(surface))
    surface.setState({ shown: 0, target: props.percent, isWorking: props.isWorking, phase: 0 })
  } else if (s.target !== props.percent || s.isWorking !== props.isWorking) {
    surface.setState({ ...s, target: props.percent, isWorking: props.isWorking })
  }
  const { Text } = surface.elements
  const ink = { stops: stopsOf(props.ramp ?? RAMP), track: props.track ?? TRACK, mark: props.markColor ?? MARK }
  const cells = runs(s?.shown ?? 0, props.width, s?.isWorking ? s.phase : null, ink, props.mark, props.color)
  return <Text>{cells.map(r => <Text color={r.color} bold={r.bold}>{r.text}</Text>)}</Text>
}

function tick(surface: { state: State | undefined; setState: (next: State) => void }) {
  const s = surface.state
  if (s === undefined) return
  const gap = s.target - s.shown
  const isSettled = Math.abs(gap) < 0.05
  if (isSettled && !s.isWorking) {
    if (s.shown !== s.target) surface.setState({ ...s, shown: s.target })
    return
  }
  surface.setState({ ...s, shown: isSettled ? s.target : s.shown + gap * 0.2, phase: s.isWorking ? s.phase + 1 : s.phase })
}

// The cells as runs of one style: the filled part's heavy line, the half cell
// that joins it to the track, the track; the shine is a glow sweeping the
// filled part, shaded off from its centre.
function runs(
  percent: number,
  width: number,
  phase: number | null,
  ink: { stops: Stops; track: string; mark: string },
  mark?: number,
  fixed?: string,
): { text: string; color: string; bold?: boolean }[] {
  const fill = (Math.min(100, Math.max(0, percent)) / 100) * width
  const full = Math.floor(fill)
  const isHalf = fill - full >= 0.5
  // The glow's centre: it enters from before the bar's start and leaves past its fill.
  const shine = phase === null || full === 0 ? null : (phase % (full + 8)) - (GLOW.length - 1)
  const tick = mark === undefined ? -1 : Math.min(width - 1, Math.floor((Math.max(0, mark) / 100) * width))
  const cells: { text: string; color: string; bold?: boolean }[] = []
  for (let i = 0; i < width; i++) {
    const rgb = ramp(ink.stops, ((i + 0.5) / width) * 100)
    const color = fixed ?? hex(rgb)
    if (i === tick) cells.push({ text: '┃', color: ink.mark, bold: true })
    else if (i < full) {
      const wash = shine === null ? undefined : GLOW[Math.abs(i - shine)]
      cells.push(wash === undefined ? { text: '━', color } : { text: '━', color: hex(mix(rgb, [255, 255, 255], wash)), bold: wash >= 0.5 })
    } else if (i === full && isHalf) cells.push({ text: '╾', color })
    else cells.push({ text: '─', color: ink.track })
  }
  return cells.reduce<typeof cells>((out, c) => {
    const last = out.at(-1)
    if (last && last.color === c.color && last.bold === c.bold) last.text += c.text
    else out.push({ ...c })
    return out
  }, [])
}

function ramp(stops: Stops, at: number): number[] {
  const i = Math.max(1, stops.findIndex(([stop]) => stop >= at))
  const [a, from] = stops[i - 1] ?? stops[0]!
  const [b, to] = stops[i] ?? stops[0]!
  return mix(from, to, b === a ? 0 : (at - a) / (b - a))
}

function mix(from: number[], to: number[], t: number): number[] {
  return from.map((v, c) => Math.round(v + ((to[c] ?? v) - v) * t))
}

function hex(rgb: number[]): string {
  return `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`
}

// A hex's channels; white for one that is not a hex.
function rgbOf(color: string): number[] {
  return /^#[0-9a-f]{6}$/i.test(color) ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)) : [255, 255, 255]
}

export default Bar
