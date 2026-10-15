import type { ClientModule } from 'claude-code'

// `frames` runs from the shut glyph to the open one; `scope` is the hover group
// the chip's Button shares, so the pointer on either lights both. The group is
// this Button's: a Text inside a Button follows a group but cannot light it.
type Props = { isOpen: boolean; frames: string[]; scope: string; color?: string }
// `frame` is where the chevron stands in `frames`, stepping toward `target`;
// `held` is how long it has stood there.
type State = { frame: number; target: number; held: number }

const TICK_MS = 30
// A turn takes this long a step, eased: each step lasts as long as an eased
// swing takes between the two frames, so the chevron sets off and settles
// slowly and swings through the middle (the sidebar's four steps 150, 90, 90
// and 150 ms).
const STEP_MS = 110
// When, of the swing's time, it reaches frame `k` of `n` steps: the sine
// ease's inverse.
const reached = (k: number, n: number) => Math.acos(1 - (2 * k) / n) / Math.PI

// The sidebar chip's chevron in the box, turning as the panel opens and
// shuts: it faces right while the panel is shut and left while it is open,
// eased in and out. (The model's and the effort's are chip.tsx's.) Turned,
// the timer changes nothing.
//
// A press of it posts the toggle. The press is a Button's, never a pointer
// listener's: a Client listening to the pointer turns the whole terminal's
// mouse reports to pixels, which Claude Code turns back into cells by the
// cell size the terminal reports, and VS Code's terminal reports it rounded
// to a whole pixel, so every hover, click and selection on screen drifts off
// what is drawn, further the further right and down it is.
const Chevron: ClientModule<Props, State> = (props, surface) => {
  const s = surface.state
  const target = props.isOpen ? props.frames.length - 1 : 0
  if (s === undefined) {
    const n = props.frames.length - 1
    surface.every(TICK_MS, () => {
      const now = surface.state
      if (!now || now.frame === now.target) return
      const to = now.frame + Math.sign(now.target - now.frame)
      const lasts = n * STEP_MS * Math.abs(reached(to, n) - reached(now.frame, n))
      const held = now.held + TICK_MS
      surface.setState(held >= lasts ? { ...now, frame: to, held: 0 } : { ...now, held })
    })
    surface.setState({ frame: target, target, held: 0 })
  } else if (s.target !== target) {
    surface.setState({ ...s, target })
  }
  const { Button, Text } = surface.elements
  return (
    <Button plain key={`chevron-${props.scope}`} hover={{ scope: props.scope, inverse: true }} onPress={() => surface.post({ toggle: true })}>
      <Text color={props.color} dimColor={!props.color}>
        {` ${props.frames[s?.frame ?? target] ?? ''}`}
      </Text>
    </Button>
  )
}

export default Chevron
