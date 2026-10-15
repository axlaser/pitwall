import type { ClientModule } from 'claude-code'

// `accent` paints the spark and the word, `shine` is the hex the glow washes
// toward white from, `ok` paints `✓ Ready`: the skin's, Claude's own where
// not given.
type Props = { isWorking: boolean; accent?: string; shine?: string; ok?: string }
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
// The glow by distance from its centre, as bar.tsx's shine: the accent's hex
// (Claude's, the theme's `claude`, where none is given) washed toward white,
// brightest in the middle.
const ACCENT = '#d77757'
const GLOW = [0.75, 0.5, 0.3, 0.12]
const glow = (base: string, wash: number) => {
  const rgb = /^#[0-9a-f]{6}$/i.test(base) ? [1, 3, 5].map(i => parseInt(base.slice(i, i + 2), 16)) : [215, 119, 87]
  return `#${rgb.map(v => Math.round(v + (255 - v) * wash).toString(16).padStart(2, '0')).join('')}`
}

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
        <Text color={props.ok ?? 'green'}>✓</Text>
        <Text> </Text>
        <Text color={props.ok ?? 'green'}>Ready</Text>
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
    return wash === undefined ? (props.accent ?? 'claude') : glow(props.shine ?? ACCENT, wash)
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
