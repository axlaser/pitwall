import type { ClientModule } from 'claude-code'

type Props = { from: number; to: number; isArrow: boolean; width: number; color: string; isClosing: boolean }
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

const ease = (p: number) => 1 - (1 - p) ** 3
const along = (start: number, goal: number, tick: number) => Math.round(start + (goal - start) * ease(Math.min(1, tick / TICKS)))

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
