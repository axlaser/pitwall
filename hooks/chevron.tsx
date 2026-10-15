import type { ClientModule } from 'claude-code'
import { TURN_TICK_MS, turned } from './turn'

// `scope` is the hover group the chip's Button shares, so the pointer on
// either lights both. The group is this Button's: a Text inside a Button
// follows a group but cannot light it.
type Props = { isOpen: boolean; frames: string[]; scope: string; color?: string }
type State = { frame: number; target: number; held: number }

// The press is a Button's, never a pointer listener's: a Client listening to
// the pointer turns the whole terminal's mouse reports to pixels, which Claude
// Code turns back into cells by the cell size the terminal reports, and VS
// Code's terminal reports it rounded to a whole pixel, so every hover, click
// and selection on screen drifts off what is drawn, further the further right
// and down it is.
const Chevron: ClientModule<Props, State> = (props, surface) => {
  const s = surface.state
  const target = props.isOpen ? props.frames.length - 1 : 0
  if (s === undefined) {
    const n = props.frames.length - 1
    surface.every(TURN_TICK_MS, () => {
      const now = surface.state
      if (now && now.frame !== now.target) surface.setState(turned(now, n))
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
