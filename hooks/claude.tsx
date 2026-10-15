import type { ClientModule } from 'claude-code'

type Props = { isWorking: boolean }
type State = { isWorking: boolean; frame: number }

// The glow moves a letter a tick; the spark turns every other tick, a mote
// moves every fourth.
const TICK_MS = 60
const TRACK = 3
const MIDDLE = 1
// Claude Code's own spinner glyphs, less ✳, which some fonts draw as an emoji.
// They are wider than a cell: over the box's background, xterm.js's DOM
// renderer (VS Code with GPU acceleration off) cuts them; WebGL draws them whole.
const SPARK = ['·', '✢', '✶', '✻', '✽', '✻', '✶', '✢']
// Where a mote of the spark's play pops up: either side of it and never on
// it, bouncing between a low dot and a high one.
const MOTES: [number, string][] = [[0, '.'], [2, '·'], [0, '·'], [2, '.'], [2, '·'], [0, '.'], [2, '.'], [0, '·']]
const WORD = 'Working'
// The glow by distance from its centre, as bar.tsx's shine: Claude's accent
// (the theme's `claude`) washed toward white, brightest in the middle.
const ACCENT = [215, 119, 87]
const GLOW = [0.75, 0.5, 0.3, 0.12]
const glow = (wash: number) => `#${ACCENT.map(v => Math.round(v + (255 - v) * wash).toString(16).padStart(2, '0')).join('')}`

// Claude at work: its spark frolicking in one spot, turning and pulsing, motes
// of its play popping up either side, and a glow sweeping across it and on
// over `working`. At rest it is the binary's `● ready`, and the timer does
// nothing.
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
  const turn = Math.floor(frame / 2)
  const [mote, dot] = MOTES[Math.floor(turn / 2) % MOTES.length]!
  // The glow's centre, over the track, its gap and the word as one strip: it
  // enters from before the spark and leaves past the word's end.
  const shine = (frame % (TRACK + 1 + WORD.length + 8)) - (GLOW.length - 1)
  const washOf = (at: number) => GLOW[Math.abs(at - shine)]
  const tint = (at: number) => {
    const wash = washOf(at)
    return wash === undefined ? 'claude' : glow(wash)
  }
  const isBright = (at: number) => (washOf(at) ?? 0) >= 0.5
  const track = Array.from({ length: TRACK }, (_, i) =>
    i === MIDDLE ? (
      <Text color={tint(i)} bold={turn % 4 < 2 || isBright(i)}>
        {SPARK[turn % SPARK.length]}
      </Text>
    ) : i === mote ? (
      // A mote the glow reaches lights up out of its dimness.
      <Text color={tint(i)} dimColor={washOf(i) === undefined}>
        {dot}
      </Text>
    ) : (
      <Text> </Text>
    ),
  )
  const word = [...WORD].map((ch, i) => (
    <Text color={tint(TRACK + 1 + i)} bold={isBright(TRACK + 1 + i)}>
      {ch}
    </Text>
  ))
  return (
    <Text>
      {track}
      <Text> </Text>
      {word}
    </Text>
  )
}

export default Claude
