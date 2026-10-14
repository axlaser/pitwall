import type { ClientModule } from 'claude-code'

type Props = { text: string; color: string }

// The effort chip: a left click steps to the next level, round from max to
// low, and once clicked, → and ← step up and down. The hooks module applies it.
// Under the pointer it inverts, as the band's Buttons do.
//
// No right click: a `down` makes the chip hold the pointer until its `up`, and
// VS Code's terminal keeps the right button's `up` for itself, which left the
// chip holding it, and every hover, click and selection on screen went astray.
const Effort: ClientModule<Props, boolean> = (props, surface) => {
  surface.onPointer(e => {
    if (e.type === 'enter' || e.type === 'leave') {
      const isHovered = e.type === 'enter'
      if (isHovered !== (surface.state ?? false)) surface.setState(isHovered)
    } else if (e.type === 'up' && e.button === 'left') {
      surface.post({ step: 1, wrap: true })
    }
  })
  surface.onKey(e => {
    if (e.key === 'right') surface.post({ step: 1 })
    else if (e.key === 'left') surface.post({ step: -1 })
  })
  const { Text } = surface.elements
  return (
    <Text color={props.color} inverse={surface.state ?? false}>
      {props.text}
    </Text>
  )
}

export default Effort
