import type { ClientModule } from 'claude-code'
import { glowCentre, washAt, washed } from './glow'
import { TURN_TICK_MS, turned } from './turn'

type Props = { label: string; color: string; glowHex?: string; scope: string; isShining: boolean; isOpen: boolean; frames?: string[] }
type State = { isShining: boolean; beat: number; frame: number; target: number; held: number; steps: number }

const GLOW_MS = 60

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
    surface.every(TURN_TICK_MS, () => {
      const now = surface.state
      if (now && now.frame !== now.target) surface.setState(turned(now, now.steps))
    })
    surface.setState({ isShining: props.isShining, beat: 0, frame: target, target, held: 0, steps })
  } else if (s.isShining !== props.isShining || s.target !== target || s.steps !== steps) {
    const isNewFrames = s.steps !== steps
    surface.setState({
      ...s,
      isShining: props.isShining,
      beat: s.isShining !== props.isShining ? 0 : s.beat,
      target,
      steps,
      ...(isNewFrames && { frame: target, held: 0 }),
    })
  }
  const { Box, Button, Text } = surface.elements
  const words = [...props.label]
  const chevron = [' ', frames[s?.frame ?? target] ?? '']
  const centre = glowCentre(s?.beat ?? 0, words.length + chevron.length)
  const lit = (cells: string[], from: number) =>
    props.isShining ? (
      <Text>
        {cells.map((cell, i) => {
          const wash = washAt(from + i, centre)
          return <Text color={wash === undefined ? props.color : washed(props.glowHex ?? props.color, wash)}>{cell}</Text>
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
