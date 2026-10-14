import type { ClientModule } from 'claude-code'

type Props = { isWorking: boolean }
type State = { isWorking: boolean; frame: number }

const TICK_MS = 120
const TRACK = 5
// Claude Code's own spinner glyphs, less ✳, which some fonts draw as an emoji.
const SPARK = ['·', '✢', '✶', '✻', '✽', '✻', '✶', '✢']
const WORD = 'working'

// Claude at work: its spark squiggling back and forth along a short track,
// turning as it goes, and `working` shimmering a letter at a time. At rest it is the binary's `● ready`, and the timer does nothing.
const Claude: ClientModule<Props, State> = (props, surface) => {
  const s = surface.state
  if (s === undefined) {
    surface.every(TICK_MS, () => {
      const now = surface.state
      if (now?.isWorking) surface.setState({ ...now, frame: now.frame + 1 })
    })
    surface.setState({ isWorking: props.isWorking, frame: 0 })
  } else if (s.isWorking !== props.isWorking) {
    surface.setState({ isWorking: props.isWorking, frame: 0 })
  }
  const { Text } = surface.elements
  if (!props.isWorking) {
    return (
      <Text>
        <Text color="green">●</Text>
        <Text>{'  '}</Text>
        <Text color="white">ready</Text>
      </Text>
    )
  }
  const frame = s?.frame ?? 0
  // Back and forth over the track, a step every other tick.
  const step = Math.floor(frame / 2) % (2 * (TRACK - 1))
  const at = step < TRACK ? step : 2 * (TRACK - 1) - step
  const track = Array.from({ length: TRACK }, (_, i) =>
    i === at ? <Text color="claude" bold>{SPARK[frame % SPARK.length]}</Text> : <Text> </Text>,
  )
  const lit = frame % (WORD.length + 4)
  const word = [...WORD].map((ch, i) =>
    i === lit ? <Text color="white" bold>{ch}</Text> : <Text color="claude">{ch}</Text>,
  )
  return (
    <Text>
      {track}
      <Text> </Text>
      {word}
    </Text>
  )
}

export default Claude
