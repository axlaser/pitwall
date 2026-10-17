import type { ClientModule } from 'claude-code'

type Props = { name: string; isOpen: boolean; summary: string; tint: string; width: number; accent?: string; muted?: string }
type State = { isOpen: boolean; rule: number; to: number }

const TICK_MS = 25
const STEP = 3

const Fold: ClientModule<Props, State> = (props, surface) => {
  const s = surface.state
  const head = `${props.isOpen ? '▾' : '▸'} ${props.name}`
  const room = Math.max(0, props.width - head.length - 1)
  const summary = props.isOpen || !props.summary ? '' : ` ${props.summary.slice(0, Math.max(0, room - 3))}`
  const rule = room - summary.length
  if (s === undefined) {
    surface.every(TICK_MS, () => {
      const now = surface.state
      if (now && now.rule !== now.to) {
        surface.setState({ ...now, rule: now.rule < now.to ? Math.min(now.to, now.rule + STEP) : Math.max(now.to, now.rule - STEP) })
      }
    })
    surface.setState({ isOpen: props.isOpen, rule: 0, to: rule })
  } else if (s.isOpen !== props.isOpen || s.to !== rule) {
    const isMoving = s.isOpen !== props.isOpen || s.rule !== s.to
    surface.setState({ isOpen: props.isOpen, rule: isMoving ? s.rule : rule, to: rule })
  }

  const { Box, Button, Text } = surface.elements
  const drawn = Math.min(room, s?.rule ?? 0)
  const isSummed = summary !== '' && drawn === rule
  return (
    <Box>
      <Button plain key={`fold-${props.name}`} onPress={() => surface.post({ toggle: true })}>
        <Text color={props.accent ?? 'claude'} bold>
          {head}
        </Text>
      </Button>
      <Text color={props.muted ?? 'gray'}>{` ${'─'.repeat(drawn)}${' '.repeat(room - drawn - (isSummed ? summary.length : 0))}`}</Text>
      {isSummed && <Text color={props.tint}>{summary}</Text>}
    </Box>
  )
}

export default Fold
