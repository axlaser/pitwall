import type { ClientModule } from 'claude-code'

// `label` is the chip's words and `color` their colour; `shine` the hex the
// glow washes toward white, where `color` is a theme colour's name, else
// `color` itself. `scope` is the chip's kind, which keys its Buttons and
// names the hover group they share; `isShining` while Claude works. `frames`
// runs from its chevron's shut glyph to the open one, as chevron.tsx's.
type Props = { label: string; color: string; shine?: string; scope: string; isShining: boolean; isOpen: boolean; frames: string[] }
// `beat` counts the glow's ticks while it shines; `frame` is where the chevron
// stands in `frames`, stepping toward `target`, and `held` how long it has
// stood there; `steps` is how many steps `frames` takes from end to end.
type State = { isShining: boolean; beat: number; frame: number; target: number; held: number; steps: number }

// The glow moves a cell a tick and fades by distance from its centre, as
// claude.tsx's over `working`; GAP ticks pass between one sweep leaving the
// chip and the next entering. Colour alone: under the pointer the whole chip
// goes bold, inverted, and a glow of bold letters would lose itself in it.
const GLOW_MS = 60
const GLOW = [0.75, 0.5, 0.3, 0.12]
const GAP = 8
// The chevron turns as chevron.tsx's does, eased.
const TURN_MS = 30
const STEP_MS = 110
const reached = (k: number, n: number) => Math.acos(1 - (2 * k) / n) / Math.PI

const washed = (color: string, wash: number) => {
  const rgb = /^#[0-9a-f]{6}$/i.test(color) ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)) : null
  return rgb ? `#${rgb.map(v => Math.round(v + (255 - v) * wash).toString(16).padStart(2, '0')).join('')}` : color
}

// A chip's words in the box and its chevron, the model's or the effort's, in
// the colour its picker gives them, each a Button: a click on either, or
// Return under the box's focus on the words, posts the toggle. Under the
// pointer both invert and go bold, as the pick in its picker is drawn. While
// Claude works the chip glistens, a glow sweeping across the words and on
// over the chevron, as the context bar's and `working`'s do; the chevron
// turns as what the chip opens opens and shuts. At rest and turned, the
// timers change nothing.
//
// Buttons, never a pointer listener: see chevron.tsx for the drift one brings
// to every click on screen.
const Chip: ClientModule<Props, State> = (props, surface) => {
  const s = surface.state
  // On a reload this module can run a beat before the hooks module does, on
  // the props the old one drew it with: a prop missing then must not throw,
  // or the chip stays unmounted, the plugin's name drawn in its place.
  const frames = props.frames ?? []
  const steps = Math.max(0, frames.length - 1)
  const target = props.isOpen ? steps : 0
  if (s === undefined) {
    surface.every(GLOW_MS, () => {
      const now = surface.state
      if (now?.isShining) surface.setState({ ...now, beat: now.beat + 1 })
    })
    surface.every(TURN_MS, () => {
      const now = surface.state
      if (!now || now.frame === now.target) return
      const to = now.frame + Math.sign(now.target - now.frame)
      const n = now.steps
      const lasts = n * STEP_MS * Math.abs(reached(to, n) - reached(now.frame, n))
      const held = now.held + TURN_MS
      surface.setState(held >= lasts ? { ...now, frame: to, held: 0 } : { ...now, held })
    })
    surface.setState({ isShining: props.isShining, beat: 0, frame: target, target, held: 0, steps })
  } else if (s.isShining !== props.isShining || s.target !== target || s.steps !== steps) {
    const isMoved = s.steps !== steps
    surface.setState({
      ...s,
      isShining: props.isShining,
      beat: s.isShining !== props.isShining ? 0 : s.beat,
      target,
      steps,
      // New frames, the chevron stands where they would have it.
      ...(isMoved && { frame: target, held: 0 }),
    })
  }
  const { Box, Button, Text } = surface.elements
  const words = [...props.label]
  const chevron = [' ', frames[s?.frame ?? target] ?? '']
  // The glow's centre: it enters from before the first letter and leaves
  // past the chevron.
  const shine = ((s?.beat ?? 0) % (words.length + chevron.length + GAP)) - (GLOW.length - 1)
  const lit = (cells: string[], from: number) =>
    props.isShining ? (
      <Text>
        {cells.map((cell, i) => {
          const wash = GLOW[Math.abs(from + i - shine)]
          return <Text color={wash === undefined ? props.color : washed(props.shine ?? props.color, wash)}>{cell}</Text>
        })}
      </Text>
    ) : (
      <Text color={props.color}>{cells.join('')}</Text>
    )
  const press = () => surface.post({ toggle: true })
  return (
    <Box>
      <Button plain key={props.scope} hover={{ scope: props.scope, inverse: true, bold: true }} onPress={press}>
        {lit(words, 0)}
      </Button>
      <Button plain key={`chevron-${props.scope}`} hover={{ scope: props.scope, inverse: true, bold: true }} onPress={press}>
        {lit(chevron, words.length)}
      </Button>
    </Box>
  )
}

export default Chip
