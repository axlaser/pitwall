import type { ClientModule } from 'claude-code'

// `summary` is what the header says of its section while it is folded.
type Props = { name: string; isOpen: boolean; summary: string; tint: string; width: number }
// `sweep` is how many cells of the rule are drawn so far.
type State = { isOpen: boolean; sweep: number; width: number; isHovered: boolean }

const TICK_MS = 25
const STEP = 3

// A section's header in the panel: its chevron and name, and a rule that
// sweeps out to the edge when the panel opens and each time the section folds
// or opens, the folded one's summary waiting at the end of it. A left click,
// or Return or Space once clicked, posts the toggle; the hooks module keeps
// the choice. Under the pointer the name inverts, as the band's Buttons do.
// Swept, the timer changes nothing.
//
// Left button only: see chevron.tsx for the right button's lost `up`.
const Fold: ClientModule<Props, State> = (props, surface) => {
  const s = surface.state
  if (s === undefined) {
    surface.every(TICK_MS, () => {
      const now = surface.state
      if (now && now.sweep < now.width) surface.setState({ ...now, sweep: Math.min(now.width, now.sweep + STEP) })
    })
    surface.setState({ isOpen: props.isOpen, sweep: 0, width: props.width, isHovered: false })
  } else if (s.isOpen !== props.isOpen || s.width !== props.width) {
    surface.setState({ ...s, isOpen: props.isOpen, sweep: s.isOpen !== props.isOpen ? 0 : s.sweep, width: props.width })
  }
  surface.onPointer(e => {
    const now = surface.state
    if (now && (e.type === 'enter' || e.type === 'leave') && now.isHovered !== (e.type === 'enter')) {
      surface.setState({ ...now, isHovered: e.type === 'enter' })
    } else if (e.type === 'up' && e.button === 'left') {
      surface.post({ toggle: true })
    }
  })
  surface.onKey(e => {
    if (e.key === 'return' || e.key === ' ') surface.post({ toggle: true })
  })

  const { Text } = surface.elements
  const head = `${props.isOpen ? '▾' : '▸'} ${props.name}`
  // What is left after the head and the space that follows it.
  const room = Math.max(0, props.width - head.length - 1)
  const summary = props.isOpen || !props.summary ? '' : ` ${props.summary.slice(0, Math.max(0, room - 3))}`
  const rule = room - summary.length
  const drawn = Math.min(rule, s?.sweep ?? 0)
  return (
    <Text>
      <Text color="claude" bold inverse={s?.isHovered ?? false}>
        {head}
      </Text>
      <Text color="gray">{` ${'─'.repeat(drawn)}${' '.repeat(rule - drawn)}`}</Text>
      {/* The summary shows once the rule has reached it. */}
      <Text color={props.tint}>{drawn >= rule ? summary : ' '.repeat(summary.length)}</Text>
    </Text>
  )
}

export default Fold
