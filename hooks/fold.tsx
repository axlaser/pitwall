import type { ClientModule } from 'claude-code'

// `summary` is what the header says of its section while it is folded.
type Props = { name: string; isOpen: boolean; summary: string; tint: string; width: number }
// `rule` is how many cells of the rule are drawn, moving a few a tick toward
// `to`; `isOpen` is whether the section was open when it last set off.
type State = { isOpen: boolean; rule: number; to: number }

const TICK_MS = 25
const STEP = 3

// A section's header in the panel: its chevron and name, and a rule that
// sweeps out to the edge when the panel opens. As the section folds, the rule
// draws back just far enough for the summary, which then shows at its end;
// as it opens, the summary goes and the rule runs on out to the edge. The
// chevron and name are a Button: a click, or Return under the panel's focus,
// posts the toggle, and the hooks module keeps the choice; under the pointer
// it inverts, as the band's Buttons do. Still, the timer changes nothing.
//
// A Button, never a pointer listener: see chevron.tsx for the drift one
// brings to every click on screen.
const Fold: ClientModule<Props, State> = (props, surface) => {
  const s = surface.state
  const head = `${props.isOpen ? '▾' : '▸'} ${props.name}`
  // What is left after the head and the space that follows it.
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
    // A fold sets the rule's end off for its new place, as does a new width
    // while it moves; resting, a new width or a summary's new figures put it
    // there at once.
    const isMoving = s.isOpen !== props.isOpen || s.rule !== s.to
    surface.setState({ isOpen: props.isOpen, rule: isMoving ? s.rule : rule, to: rule })
  }

  const { Box, Button, Text } = surface.elements
  const drawn = Math.min(room, s?.rule ?? 0)
  // The summary shows once the rule's end has reached it.
  const isSummed = summary !== '' && drawn === rule
  return (
    <Box>
      <Button plain key={`fold-${props.name}`} onPress={() => surface.post({ toggle: true })}>
        <Text color="claude" bold>
          {head}
        </Text>
      </Button>
      <Text color="gray">{` ${'─'.repeat(drawn)}${' '.repeat(room - drawn - (isSummed ? summary.length : 0))}`}</Text>
      {isSummed && <Text color={props.tint}>{summary}</Text>}
    </Box>
  )
}

export default Fold
