import type { ClientModule } from 'claude-code'
import { glowCentre, washAt, washed } from './glow'

type Props = { isWorking: boolean; accent?: string; glowHex?: string; ok?: string }
type State = { isWorking: boolean; frame: number }

const TICK_MS = 60
const SPARK_CELLS = 1
// Claude Code's own spinner glyphs, less ✳, which some fonts draw as an emoji.
const SPARK = ['·', '✢', '✶', '✻', '✽', '✻', '✶', '✢']
const WORD = 'Working'
export const WORKING_CELLS = SPARK_CELLS + 1 + WORD.length
const READY = 'Ready'
export const READY_CELLS = 2 + READY.length
const CLAUDE_HEX = '#d77757'

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
        <Text color={props.ok ?? 'green'}>{READY}</Text>
      </Text>
    )
  }
  const frame = s?.frame ?? 0
  const turn = Math.floor(frame / 2)
  const centre = glowCentre(frame, WORKING_CELLS)
  const tint = (at: number) => {
    const wash = washAt(at, centre)
    return wash === undefined ? (props.accent ?? 'claude') : washed(props.glowHex ?? CLAUDE_HEX, wash)
  }
  const isBright = (at: number) => (washAt(at, centre) ?? 0) >= 0.5
  const spark = (
    <Text color={tint(0)} bold={turn % 4 < 2 || isBright(0)}>
      {SPARK[turn % SPARK.length]}
    </Text>
  )
  const word = [...WORD].map((ch, i) => (
    <Text color={tint(SPARK_CELLS + 1 + i)} bold={isBright(SPARK_CELLS + 1 + i)}>
      {ch}
    </Text>
  ))
  return (
    <Text>
      {spark}
      <Text> </Text>
      {word}
    </Text>
  )
}

export default Claude
