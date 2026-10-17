import type { ClientModule } from 'claude-code'
import { TURN_TICK_MS, turned } from './turn'

type Props = { isOpen: boolean; frames: string[]; scope: string; color?: string }
type State = { frame: number; target: number; held: number }

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
