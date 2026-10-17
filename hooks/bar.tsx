import type { ClientModule } from 'claude-code'
import { glowCentre, hexOf, mixRgb, rgbOf, washAt } from './glow'

type Props = { percent: number; isWorking: boolean; width: number; pace?: number; color?: string; ramp?: string[]; track?: string; paceColor?: string }
type State = { shown: number; target: number; isWorking: boolean; phase: number }

const TICK_MS = 50
const RAMP = ['#3fb950', '#d29922', '#f85149']
export const RAMP_MID = 60
export const RAMP_HIGH = 85
const TRACK = '#3c3c3c'
const PACE = '#ffffff'
type Stops = [number, number[]][]
const stopsOf = (ramp: string[]): Stops => {
  const [low, mid, high] = [0, 1, 2].map(i => rgbOf(ramp[i] ?? '') ?? rgbOf(RAMP[i] ?? PACE) ?? [])
  return [[0, low ?? []], [RAMP_MID, mid ?? []], [RAMP_HIGH, high ?? []], [100, high ?? []]]
}

const Bar: ClientModule<Props, State> = (props, surface) => {
  const s = surface.state
  if (s === undefined) {
    surface.every(TICK_MS, () => tick(surface))
    surface.setState({ shown: 0, target: props.percent, isWorking: props.isWorking, phase: 0 })
  } else if (s.target !== props.percent || s.isWorking !== props.isWorking) {
    surface.setState({ ...s, target: props.percent, isWorking: props.isWorking })
  }
  const { Text } = surface.elements
  const ink = { stops: stopsOf(props.ramp ?? RAMP), track: props.track ?? TRACK, pace: props.paceColor ?? PACE }
  const cells = runs(s?.shown ?? 0, props.width, s?.isWorking ? s.phase : null, ink, props.pace, props.color)
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

function runs(
  percent: number,
  width: number,
  phase: number | null,
  ink: { stops: Stops; track: string; pace: string },
  pace?: number,
  fixed?: string,
): { text: string; color: string; bold?: boolean }[] {
  const fill = (Math.min(100, Math.max(0, percent)) / 100) * width
  const full = Math.floor(fill)
  const isHalf = fill - full >= 0.5
  const centre = phase === null || full === 0 ? null : glowCentre(phase, full)
  const paceCell = pace === undefined ? -1 : Math.min(width - 1, Math.floor((Math.max(0, pace) / 100) * width))
  const cells: { text: string; color: string; bold?: boolean }[] = []
  for (let i = 0; i < width; i++) {
    const rgb = ramp(ink.stops, ((i + 0.5) / width) * 100)
    const color = fixed ?? hexOf(rgb)
    if (i === paceCell) cells.push({ text: '┃', color: ink.pace, bold: true })
    else if (i < full) {
      const wash = centre === null ? undefined : washAt(i, centre)
      cells.push(wash === undefined ? { text: '━', color } : { text: '━', color: hexOf(mixRgb(rgb, [255, 255, 255], wash)), bold: wash >= 0.5 })
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
  return mixRgb(from, to, b === a ? 0 : (at - a) / (b - a))
}

export default Bar
