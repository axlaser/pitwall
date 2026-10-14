import type { ClientModule } from 'claude-code'

type Props = { percent: number; isWorking: boolean; width: number }
// `shown` glides toward `target`; `phase` walks the shine while Claude works.
type State = { shown: number; target: number; isWorking: boolean; phase: number }

const TICK_MS = 50
// A smooth ramp by where a cell sits, through render.rs's thresholds: green
// at the start, yellow by 60 %, red by 85 %.
const STOPS: [number, number[]][] = [[0, [63, 185, 80]], [60, [210, 153, 34]], [85, [248, 81, 73]], [100, [248, 81, 73]]]
const TRACK = '#3c3c3c'

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
  return <Text>{runs(s?.shown ?? 0, props.width, s?.isWorking ? s.phase : null).map(r => <Text color={r.color} bold={r.bold}>{r.text}</Text>)}</Text>
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
// that joins it to the track, the track; the shine is two cells sweeping the
// filled part, washed toward white.
function runs(percent: number, width: number, phase: number | null): { text: string; color: string; bold?: boolean }[] {
  const fill = (Math.min(100, Math.max(0, percent)) / 100) * width
  const full = Math.floor(fill)
  const isHalf = fill - full >= 0.5
  const shine = phase === null || full === 0 ? -1 : phase % (full + 8)
  const cells: { text: string; color: string; bold?: boolean }[] = []
  for (let i = 0; i < width; i++) {
    const color = ramp(((i + 0.5) / width) * 100)
    if (i < full) cells.push(i === shine || i === shine - 1 ? { text: '━', color: hex(mix(color, [255, 255, 255], 0.6)), bold: true } : { text: '━', color: hex(color) })
    else if (i === full && isHalf) cells.push({ text: '╾', color: hex(color) })
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
