import type { ClientModule } from 'claude-code'

// `id` is the pill's address, its Client's key, which keys its Buttons and
// names the hover group that lights it; `label` is what the pill says and
// `color` its colour (an effort level's a theme colour, a model's a hex its
// sweep washes toward white); `level` names the effort level whose glyph leads
// it ('' for a model, which has none);
// `isPicked` marks the choice the wire ends on (the one in force until another
// is clicked), `isInForce` the one in force; `index` and `count` place it in
// its row, for the ripple it fades in and out on; `isClosing` while the
// picker folds away; `flare` the colours max's flourish flickers through,
// the skin's.
type Props = {
  id: string
  label: string
  level: string
  color: string
  isPicked: boolean
  isInForce: boolean
  index: number
  count: number
  isClosing: boolean
  flare?: string[]
}
// `tick` counts up from the play's start, as the row opens; `age` from the
// pill's first drawing until it has faded in; `gone` from the picker starting
// to fold until it has faded out; `hover` is the frame the loop stands at, the
// hover layer's and the picked pill's; `isPicked` the pick the loop last
// started over for, and `isRestart` asks the timer to start it over.
type State = { tick: number; age: number; gone: number; hover: number; isPicked: boolean; isRestart: boolean }

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
// A model's play: a glow sweeping across its name a cell a beat, its colour
// washed toward white and brightest in the middle, as bar.tsx's shine; softer
// than claude.tsx's, so the name stays legible on a light theme.
const SWEEP_MS = 45
const SHINE = [0.55, 0.32, 0.14]
// Under the pointer the play loops, resting this long between plays.
const REST_MS = 400

const washed = (color: string, wash: number) => {
  const rgb = /^#[0-9a-f]{6}$/i.test(color) ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)) : null
  return rgb ? `#${rgb.map(v => Math.round(v + (255 - v) * wash).toString(16).padStart(2, '0')).join('')}` : color
}

// A pill's play, by its frames and how long each shows: an effort level's
// flourish, or the sweep's every place, from before the pill to past it, its
// padding cell either side of the name and all.
const playOf = (props: Props) => {
  const f = FLOURISH[props.level]
  return f ? { frames: f.frames.length, ms: f.ms } : { frames: [...props.label].length + 2 + 2 * (SHINE.length - 1), ms: SWEEP_MS }
}

// One choice in the box's picker, a model or an effort level, drawn whole by
// the terminal so it moves without a redraw from the hooks module: it fades
// in a step after the choice before it, and as the picker folds, out a step
// after the one after it. As the row opens it plays: an effort level's glyph
// its level's flourish, a model's name a sweep of light in its colour. Lit
// (picked, or under the pointer) the whole pill inverts in its colour, the
// flare's flicker and all; at rest a glyph keeps the colour and the words are
// dim, a model's in its colour, but for the choice in force. The picked one
// plays on a loop for as long as it stays picked, from the start each time it
// is picked.
//
// The pill is a Button: a click, or Return under the box's focus, posts the
// pick. A Button, never a pointer listener (see chevron.tsx for the drift one
// brings to every click on screen), so nothing tells the pill the pointer has
// arrived: under the pointer the hover group reveals a second layer over it,
// a Button too, whose play loops for as long as the row is open. Hidden, its
// frames draw nothing on screen.
const Pill: ClientModule<Props, State> = (props, surface) => {
  const s = surface.state
  const play = playOf(props)
  // The ripple's two ends: this pill's turn to fade in, and to fade out.
  const fadedIn = props.index * STAGGER + FADE
  const fadedOut = (props.count - 1 - props.index) * STAGGER_OUT + FADE
  if (s === undefined) {
    // Keyed by its choice, so the play a pill draws never changes.
    const ticks = Math.ceil((play.frames * play.ms) / TICK_MS)
    const loop = play.frames + Math.ceil(REST_MS / play.ms)
    let beats = 0
    surface.every(TICK_MS, () => {
      const now = surface.state
      if (!now) return
      beats = now.isRestart ? 0 : beats + 1
      const next = {
        ...now,
        tick: Math.min(ticks, now.tick + 1),
        age: Math.min(fadedIn, now.age + 1),
        gone: now.gone < 0 ? now.gone : Math.min(fadedOut, now.gone + 1),
        hover: Math.floor((beats * TICK_MS) / play.ms) % loop,
        isRestart: false,
      }
      const isMoved = next.tick !== now.tick || next.age !== now.age || next.gone !== now.gone || next.hover !== now.hover
      if (isMoved || now.isRestart) surface.setState(next)
    })
    surface.setState({ tick: 0, age: 0, gone: props.isClosing ? 0 : -1, hover: 0, isPicked: props.isPicked, isRestart: false })
  } else if (props.isClosing !== s.gone >= 0) {
    // The picker started folding, or opened back up mid-fold.
    surface.setState({ ...s, gone: props.isClosing ? 0 : -1 })
  } else if (props.isPicked !== s.isPicked) {
    // Picked, its loop starts over from the play's first frame.
    surface.setState({ ...s, isPicked: props.isPicked, isRestart: props.isPicked, hover: props.isPicked ? 0 : s.hover })
  }
  const { Box, Button, Text } = surface.elements
  const f = FLOURISH[props.level]
  // What a frame of the play draws: an effort level's glyph and colour, or
  // the colour of each of a model's letters; past its last, the pill at rest.
  const glyphAt = (at: number) => (f ? (at < f.frames.length ? f.frames[at] : f.rest) : '')
  // A flourish that flickers through colours takes the skin's, where given.
  const flicker = f?.colors && (props.flare ?? f.colors)
  const colorAt = (at: number) => (flicker && f && at < f.frames.length ? (flicker[at % flicker.length] ?? props.color) : props.color)
  // A model's pill at a frame of its sweep, cell by cell from the padding
  // before its name to the padding after: lit, those two are bars of its
  // colour, which the light crosses too. Past the last frame, at rest.
  const swept = (at: number) =>
    at < play.frames
      ? [' ', ...props.label, ' '].map((cell, i) => {
          const wash = SHINE[Math.abs(i - (at - (SHINE.length - 1)))]
          return (
            <Text color={wash === undefined ? props.color : washed(props.color, wash)} bold={wash !== undefined}>
              {cell}
            </Text>
          )
        })
      : ` ${props.label} `
  const looped = s?.hover ?? 0
  // The picked pill shows the loop, the others the play the row opened with.
  const at = props.isPicked ? looped : Math.floor(((s?.tick ?? 0) * TICK_MS) / play.ms)
  const isPlaying = at < play.frames
  const lead = f ? ` ${glyphAt(at)}` : ''
  const text = `${lead} ${props.label} `
  // Ticks since this pill's turn to fade in came, and its turn to fade out.
  const shown = (s?.age ?? 0) - props.index * STAGGER
  const going = (s?.gone ?? -1) - (props.count - 1 - props.index) * STAGGER_OUT
  if (shown < 0 || going >= FADE) return <Text>{' '.repeat([...text].length)}</Text>
  const isDim = shown < FADE || going >= 0
  const press = () => surface.post({ pick: true })
  return (
    <Box>
      <Button plain key={props.id} hover={{ scope: props.id }} onPress={press}>
        {props.isPicked ? (
          <Text color={colorAt(at)} inverse bold dimColor={isDim}>
            {f ? `${lead} ${props.label} ` : swept(at)}
          </Text>
        ) : f ? (
          <Text>
            <Text color={colorAt(at)} bold={isPlaying} dimColor={isDim}>
              {lead}
            </Text>
            <Text dimColor={!props.isInForce}>{` ${props.label} `}</Text>
          </Text>
        ) : (
          <Text color={props.color} dimColor={isDim || (!props.isInForce && !isPlaying)}>
            {swept(at)}
          </Text>
        )}
      </Button>
      {/* The layer the pointer reveals, lit from its first frame: drawn
          inverted, not left to the engine's hover to reach its Button. The
          picked pill already plays lit, so it has none, and nothing changes
          under the pointer for it to flicker between. */}
      {!props.isPicked && (
        <Box position="absolute" top={0} left={0} display="none" hover={{ scope: props.id, display: 'flex' }}>
          <Button plain key={`${props.id}-lit`} hover={{ scope: props.id }} onPress={press}>
            <Text color={colorAt(looped)} inverse bold>
              {f ? ` ${glyphAt(looped)} ${props.label} ` : swept(looped)}
            </Text>
          </Button>
        </Box>
      )}
    </Box>
  )
}

export default Pill
