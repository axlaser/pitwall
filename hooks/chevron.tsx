import type { ClientModule } from 'claude-code'

// `frames` runs from the shut glyph to the open one; `scope` is the hover group
// the chip's Button shares, so the pointer on either lights both.
type Props = { isOpen: boolean; frames: string[]; scope: string; color?: string }
// `frame` is where the chevron stands in `frames`, stepping toward `target`.
type State = { frame: number; target: number }

const TICK_MS = 60

// A chip's chevron in the box, turning as what it opens opens and shuts: the
// sidebar's faces right while the panel is shut and left while it is open, a
// dropdown's points down shut and up open. Turned, the timer changes nothing.
//
// A left click posts the toggle. Left only: a `down` makes the chevron hold
// the pointer until its `up`, and VS Code's terminal keeps the right button's
// `up` for itself, which left a control holding it, and every hover, click and
// selection on screen went astray.
const Chevron: ClientModule<Props, State> = (props, surface) => {
  const s = surface.state
  const target = props.isOpen ? props.frames.length - 1 : 0
  if (s === undefined) {
    surface.every(TICK_MS, () => {
      const now = surface.state
      if (now && now.frame !== now.target) surface.setState({ ...now, frame: now.frame + Math.sign(now.target - now.frame) })
    })
    surface.setState({ frame: target, target })
  } else if (s.target !== target) {
    surface.setState({ ...s, target })
  }
  surface.onPointer(e => {
    if (e.type === 'up' && e.button === 'left') surface.post({ toggle: true })
  })
  const { Text } = surface.elements
  return (
    <Text color={props.color} dimColor={!props.color} hover={{ scope: props.scope, inverse: true }}>
      {` ${props.frames[s?.frame ?? target] ?? ''}`}
    </Text>
  )
}

export default Chevron
