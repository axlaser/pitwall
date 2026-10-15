import type { ClientModule } from 'claude-code'

type Props = { isWorking: boolean }
type State = { isWorking: boolean; frame: number }

// The glow moves a letter a tick; the spark turns every other tick.
const TICK_MS = 60
// The spark's own cell, then the word a space on: one space either side of
// it, as the row's separators keep.
const TRACK = 1
// Claude Code's own spinner glyphs, less ✳, which some fonts draw as an emoji.
// They are wider than a cell: over the box's background, xterm.js's DOM
// renderer (VS Code with GPU acceleration off) cuts them; WebGL draws them whole.
const SPARK = ['·', '✢', '✶', '✻', '✽', '✻', '✶', '✢']
const WORD = 'Working'
// The glow by distance from its centre, as bar.tsx's shine: Claude's accent
// (the theme's `claude`) washed toward white, brightest in the middle.
const ACCENT = [215, 119, 87]
const GLOW = [0.75, 0.5, 0.3, 0.12]
const glow = (wash: number) => `#${ACCENT.map(v => Math.round(v + (255 - v) * wash).toString(16).padStart(2, '0')).join('')}`

// Claude at work: its spark turning and pulsing in its cell, and a glow
// sweeping across it and on over `working`. At rest it is `✓ Ready` in
// green, as a finished agent's `✓ done`, the check in the spark's cell, and
// the timer does nothing.
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
        <Text color="green">✓</Text>
        <Text> </Text>
        <Text color="green">Ready</Text>
      </Text>
    )
  }
  const frame = s?.frame ?? 0
  const turn = Math.floor(frame / 2)
  // The glow's centre, over the track, its gap and the word as one strip: it
  // enters from before the spark and leaves past the word's end.
  const shine = (frame % (TRACK + 1 + WORD.length + 8)) - (GLOW.length - 1)
  const washOf = (at: number) => GLOW[Math.abs(at - shine)]
  const tint = (at: number) => {
    const wash = washOf(at)
    return wash === undefined ? 'claude' : glow(wash)
  }
  const isBright = (at: number) => (washOf(at) ?? 0) >= 0.5
  const track = (
    <Text color={tint(0)} bold={turn % 4 < 2 || isBright(0)}>
      {SPARK[turn % SPARK.length]}
    </Text>
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
