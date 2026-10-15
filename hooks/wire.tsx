import type { ClientModule } from 'claude-code'

// `from` is the column of the chip's middle, `to` that of the choice the wire
// ends on, both in this row's `width` cells; `isArrow` draws the arrow's row
// under the run instead of the run itself; `isClosing` while the picker folds.
type Props = { from: number; to: number; isArrow: boolean; width: number; color: string; isClosing: boolean }
// Where the ends stand now, where this glide set out from and is bound for,
// its tick, and the colour drawn (the new one taken on arrival).
type State = {
  from: number
  to: number
  startFrom: number
  startTo: number
  goalFrom: number
  goalTo: number
  tick: number
  color: string
  goalColor: string
}

const TICK_MS = 16
const GLIDE_MS = 320
const TICKS = Math.ceil(GLIDE_MS / TICK_MS)

// Cubic ease-out: off quickly, settling softly.
const ease = (p: number) => 1 - (1 - p) ** 3
const along = (start: number, goal: number, tick: number) => Math.round(start + (goal - start) * ease(Math.min(1, tick / TICKS)))

// The open picker's wire: from under its chip's middle it runs along to the
// choice picked and turns down onto it, its arrow on the row below. As the
// picker opens it unrolls from the chip; when another choice is picked, or the
// other picker takes its place, its ends glide over, one eased glide of fixed
// length however far; as the picker folds it draws back into the chip. Under
// way, its end is a head pointing the way it goes, turning down into the arrow
// only once it arrives; drawing back, it has none. Arrived, the timer changes
// nothing. The run and the arrow are two of these, one a row, keyed apart.
const Wire: ClientModule<Props, State> = (props, surface) => {
  const s = surface.state
  const goalTo = props.isClosing ? props.from : props.to
  if (s === undefined) {
    surface.every(TICK_MS, () => {
      const now = surface.state
      if (!now || now.tick >= TICKS) return
      const tick = now.tick + 1
      surface.setState({
        ...now,
        tick,
        from: along(now.startFrom, now.goalFrom, tick),
        to: along(now.startTo, now.goalTo, tick),
        color: tick >= TICKS ? now.goalColor : now.color,
      })
    })
    surface.setState({
      from: props.from,
      to: props.from,
      startFrom: props.from,
      startTo: props.from,
      goalFrom: props.from,
      goalTo,
      tick: 0,
      color: props.color,
      goalColor: props.color,
    })
  } else if (s.goalFrom !== props.from || s.goalTo !== goalTo || s.goalColor !== props.color) {
    // A new course: set out again from wherever the ends stand.
    surface.setState({ ...s, startFrom: s.from, startTo: s.to, goalFrom: props.from, goalTo, tick: 0, goalColor: props.color })
  }
  const from = s?.from ?? props.from
  const to = s?.to ?? props.from
  const [left, right] = [Math.min(from, to), Math.max(from, to)]
  const goal = s?.goalTo ?? goalTo
  const isUnderWay = to !== goal
  const head = goal > to ? '▸' : '◂'
  const line = '─'.repeat(Math.max(0, right - left - 1))
  let run: string
  if (props.isArrow) run = isUnderWay || props.isClosing ? '' : '▾'
  else if (isUnderWay) run = from === to ? head : from < to ? `╰${line}${head}` : `${head}${line}╯`
  else if (props.isClosing) run = ''
  else run = from === to ? '│' : from > to ? `╭${line}╯` : `╰${line}╮`
  const start = props.isArrow ? to : left
  const { Text } = surface.elements
  return (
    <Text color={s?.color ?? props.color} dimColor>
      {`${' '.repeat(start)}${run}${' '.repeat(Math.max(0, props.width - start - [...run].length))}`}
    </Text>
  )
}

export default Wire
