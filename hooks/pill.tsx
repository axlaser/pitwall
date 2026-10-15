import type { ClientModule } from 'claude-code'

// `label` is what the pill says and `color` its colour; `level` names the
// effort level whose glyph leads it ('' for a model, which has none);
// `isPicked` marks the choice the wire ends on (the one in force until another
// is clicked), `isInForce` the one in force; `index` and `count` place it in
// its row, for the ripple it fades in and out on; `isClosing` while the
// picker folds away.
type Props = { label: string; level: string; color: string; isPicked: boolean; isInForce: boolean; index: number; count: number; isClosing: boolean }
// `tick` counts up from the flourish's last start (the row opening, or the
// pointer arriving); `age` from the pill's first drawing until it has faded
// in; `gone` from the picker starting to fold until it has faded out.
type State = { tick: number; age: number; gone: number; isHovered: boolean }

const TICK_MS = 30
// Ticks between one pill starting to fade in and the next, the same going
// out (quicker: a fold should not keep you), and the ticks a fade takes: the
// row ripples in from the left and out from the right.
const STAGGER = 2
const STAGGER_OUT = 1
const FADE = 3
// Each effort level's flourish, calm to fierce: its frames, how long each
// shows, the colours it flickers through (its own where none), and the glyph
// it rests on.
type Flourish = { frames: string[]; ms: number; colors?: string[]; rest: string }
const FLOURISH: Record<string, Flourish> = {
  // A dot surfacing slowly, a ripple.
  low: { frames: ['.', '·', '∙', '·', '.', '·'], ms: 150, rest: '·' },
  // A breath: a ring swelling and settling.
  medium: { frames: ['∘', '○', '◎', '○', '∘', '○'], ms: 110, rest: '○' },
  // A spark catching.
  high: { frames: ['·', '✢', '✣', '✤', '✥', '✶', '✻', '✶'], ms: 80, rest: '✶' },
  // A star spinning up, twice.
  xhigh: { frames: ['✶', '✷', '✸', '✹', '✺', '✹', '✸', '✷', '✶', '✷', '✸', '✹', '✺', '✹', '✸'], ms: 55, rest: '✸' },
  // A flare, burning red, yellow and white before it smoulders.
  max: {
    frames: ['✺', '✹', '❂', '✺', '✹', '❂', '✺', '✹', '✸', '✹', '✺', '✹', '✸', '✹'],
    ms: 45,
    colors: ['red', 'yellow', 'white', 'yellow'],
    rest: '✹',
  },
}

const ticksOf = (level: string) => {
  const f = FLOURISH[level]
  return f ? Math.ceil((f.frames.length * f.ms) / TICK_MS) : 0
}

// One choice in the box's picker, a model or an effort level, drawn whole by
// the terminal so it moves without a redraw from the hooks module: it fades
// in a step after the choice before it, and as the picker folds, out a step
// after the one after it. An effort level leads with its glyph, which plays
// the level's flourish as the row opens and each time the pointer arrives.
// Lit (picked, or under the pointer) the whole pill inverts in its colour,
// the flare's flicker and all; at rest a glyph keeps the colour and the words
// are dim, but for the choice in force. A left click, or Return or Space once
// clicked, posts the pick.
// Settled, the timer changes nothing.
//
// Left button only: see chevron.tsx for the right button's lost `up`.
const Pill: ClientModule<Props, State> = (props, surface) => {
  const s = surface.state
  // The ripple's two ends: this pill's turn to fade in, and to fade out.
  const fadedIn = props.index * STAGGER + FADE
  const fadedOut = (props.count - 1 - props.index) * STAGGER_OUT + FADE
  if (s === undefined) {
    // Keyed by its choice, so the level a pill draws never changes.
    const ticks = ticksOf(props.level)
    surface.every(TICK_MS, () => {
      const now = surface.state
      if (!now) return
      const next = {
        ...now,
        tick: Math.min(ticks, now.tick + 1),
        age: Math.min(fadedIn, now.age + 1),
        gone: now.gone < 0 ? now.gone : Math.min(fadedOut, now.gone + 1),
      }
      if (next.tick !== now.tick || next.age !== now.age || next.gone !== now.gone) surface.setState(next)
    })
    surface.setState({ tick: 0, age: 0, gone: props.isClosing ? 0 : -1, isHovered: false })
  } else if (props.isClosing !== s.gone >= 0) {
    // The picker started folding, or opened back up mid-fold.
    surface.setState({ ...s, gone: props.isClosing ? 0 : -1 })
  }
  surface.onPointer(e => {
    const now = surface.state
    if (!now) return
    if (e.type === 'enter' && !now.isHovered) surface.setState({ ...now, isHovered: true, tick: 0 })
    else if (e.type === 'leave' && now.isHovered) surface.setState({ ...now, isHovered: false })
    else if (e.type === 'up' && e.button === 'left') surface.post({ pick: true })
  })
  surface.onKey(e => {
    if (e.key === 'return' || e.key === ' ') surface.post({ pick: true })
  })

  const { Text } = surface.elements
  const f = FLOURISH[props.level]
  const at = f ? Math.floor(((s?.tick ?? 0) * TICK_MS) / f.ms) : 0
  const isPlaying = f !== undefined && at < f.frames.length
  const glyph = f ? (isPlaying ? f.frames[at] : f.rest) : ''
  const color = isPlaying && f.colors ? (f.colors[at % f.colors.length] ?? props.color) : props.color
  const lead = glyph ? ` ${glyph}` : ''
  const text = `${lead} ${props.label} `
  // Ticks since this pill's turn to fade in came, and its turn to fade out.
  const shown = (s?.age ?? 0) - props.index * STAGGER
  const going = (s?.gone ?? -1) - (props.count - 1 - props.index) * STAGGER_OUT
  if (shown < 0 || going >= FADE) return <Text>{' '.repeat([...text].length)}</Text>
  const isDim = shown < FADE || going >= 0
  if (props.isPicked || s?.isHovered) {
    return (
      <Text color={color} inverse bold dimColor={isDim}>
        {text}
      </Text>
    )
  }
  return (
    <Text>
      {lead && (
        <Text color={color} bold={isPlaying} dimColor={isDim}>
          {lead}
        </Text>
      )}
      <Text dimColor={!props.isInForce}>{` ${props.label} `}</Text>
    </Text>
  )
}

export default Pill
