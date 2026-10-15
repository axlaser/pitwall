import type { ClientModule } from 'claude-code'

// `mark`, where given, is a percent drawn as a tick across the bar: where a
// rate window would stand at a steady pace. `color`, where given, fills it in
// that one colour in place of the ramp.
type Props = { percent: number; isWorking: boolean; width: number; mark?: number; color?: string }
// `shown` glides toward `target`; `phase` walks the shine while Claude works.
type State = { shown: number; target: number; isWorking: boolean; phase: number }

const TICK_MS = 50
// A smooth ramp by where a cell sits, through render.rs's thresholds: green
// at the start, yellow by 60 %, red by 85 %.
const STOPS: [number, number[]][] = [[0, [63, 185, 80]], [60, [210, 153, 34]], [85, [248, 81, 73]], [100, [248, 81, 73]]]
const TRACK = '#3c3c3c'
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
  const cells = runs(s?.shown ?? 0, props.width, s?.isWorking ? s.phase : null, props.mark, props.color)
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
function runs(percent: number, width: number, phase: number | null, mark?: number, fixed?: string): { text: string; color: string; bold?: boolean }[] {
  const fill = (Math.min(100, Math.max(0, percent)) / 100) * width
  const full = Math.floor(fill)
  const isHalf = fill - full >= 0.5
  // The glow's centre: it enters from before the bar's start and leaves past its fill.
  const shine = phase === null || full === 0 ? null : (phase % (full + 8)) - (GLOW.length - 1)
  const tick = mark === undefined ? -1 : Math.min(width - 1, Math.floor((Math.max(0, mark) / 100) * width))
  const cells: { text: string; color: string; bold?: boolean }[] = []
  for (let i = 0; i < width; i++) {
    const rgb = ramp(((i + 0.5) / width) * 100)
    const color = fixed ?? hex(rgb)
    if (i === tick) cells.push({ text: '┃', color: '#ffffff', bold: true })
    else if (i < full) {
      const wash = shine === null ? undefined : GLOW[Math.abs(i - shine)]
      cells.push(wash === undefined ? { text: '━', color } : { text: '━', color: hex(mix(rgb, [255, 255, 255], wash)), bold: wash >= 0.5 })
    } else if (i === full && isHalf) cells.push({ text: '╾', color })
    else cells.push({ text: '─', color: TRACK })
  }
  return cells.reduce<typeof cells>((out, c) => {
    const last = out.at(-1)
    if (last && last.color === c.color && last.bold === c.bold) last.text += c.text
    else out.push({ ...c })
    return out
  }, [])
}

function ramp(at: number): number[] {
  const i = Math.max(1, STOPS.findIndex(([stop]) => stop >= at))
  const [a, from] = STOPS[i - 1] ?? STOPS[0]!
  const [b, to] = STOPS[i] ?? STOPS[0]!
  return mix(from, to, b === a ? 0 : (at - a) / (b - a))
}

function mix(from: number[], to: number[], t: number): number[] {
  return from.map((v, c) => Math.round(v + ((to[c] ?? v) - v) * t))
}

function hex(rgb: number[]): string {
  return `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`
}

export default Bar
