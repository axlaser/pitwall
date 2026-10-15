import type { ClientModule } from 'claude-code'
import { washAt, washed } from './glow'

type Props = {
  id: string
  kind: 'model' | 'effort'
  label: string
  color: string
  isPicked: boolean
  isInForce: boolean
  index: number
  count: number
  isClosing: boolean
  flare?: string[]
}
type Timing = { ms: number; frames: number; ticks: number; loop: number; fadedIn: number; fadedOut: number }
type State = { tick: number; age: number; gone: number; hover: number; isPicked: boolean; isRestart: boolean; timing: Timing }

const TICK_MS = 30
const STAGGER = 2
const STAGGER_OUT = 1
const FADE = 3
type Flourish = { frames: string[]; ms: number; colors?: string[]; rest: string }
const FLOURISH: Record<string, Flourish> = {
  low: { frames: ['.', '·', '∙', '·', '.', '·'], ms: 150, rest: '·' },
  medium: { frames: ['∘', '○', '◎', '○', '∘', '○'], ms: 110, rest: '○' },
  high: { frames: ['·', '✢', '✣', '✤', '✥', '✶', '✻', '✶'], ms: 80, rest: '✶' },
  xhigh: { frames: ['✶', '✷', '✸', '✹', '✺', '✹', '✸', '✷', '✶', '✷', '✸', '✹', '✺', '✹', '✸'], ms: 55, rest: '✸' },
  max: {
    frames: ['✺', '✹', '❂', '✺', '✹', '❂', '✺', '✹', '✸', '✹', '✺', '✹', '✸', '✹'],
    ms: 45,
    colors: ['red', 'yellow', 'white', 'yellow'],
    rest: '✹',
  },
}
const SWEEP_MS = 45
const SHINE = [0.55, 0.32, 0.14]
const REST_MS = 400

const flourishOf = (props: Props) => (props.kind === 'effort' ? FLOURISH[props.label] : undefined)
const padded = (label: string) => [' ', ...label, ' ']

const timingOf = (props: Props): Timing => {
  const f = flourishOf(props)
  const play = f ? { frames: f.frames.length, ms: f.ms } : { frames: padded(props.label).length + 2 * (SHINE.length - 1), ms: SWEEP_MS }
  return {
    ...play,
    ticks: Math.ceil((play.frames * play.ms) / TICK_MS),
    loop: play.frames + Math.ceil(REST_MS / play.ms),
    fadedIn: props.index * STAGGER + FADE,
    fadedOut: (props.count - 1 - props.index) * STAGGER_OUT + FADE,
  }
}
const isSameTiming = (a: Timing, b: Timing) => (Object.keys(a) as (keyof Timing)[]).every(k => a[k] === b[k])

// A Button, never a pointer listener (see CLAUDE.md, Clicks are Buttons, for
// the drift one brings to every click on screen), so nothing tells the pill
// the pointer has arrived: under the pointer the hover group reveals a second
// layer over it, a Button too.
const Pill: ClientModule<Props, State> = (props, surface) => {
  const s = surface.state
  const timing = timingOf(props)
  if (s === undefined) {
    let beats = 0
    surface.every(TICK_MS, () => {
      const now = surface.state
      if (!now) return
      const t = now.timing
      beats = now.isRestart ? 0 : beats + 1
      const next = {
        ...now,
        tick: Math.min(t.ticks, now.tick + 1),
        age: Math.min(t.fadedIn, now.age + 1),
        gone: now.gone < 0 ? now.gone : Math.min(t.fadedOut, now.gone + 1),
        hover: Math.floor((beats * TICK_MS) / t.ms) % t.loop,
        isRestart: false,
      }
      const isMoved = next.tick !== now.tick || next.age !== now.age || next.gone !== now.gone || next.hover !== now.hover
      if (isMoved || now.isRestart) surface.setState(next)
    })
    surface.setState({ tick: 0, age: 0, gone: props.isClosing ? 0 : -1, hover: 0, isPicked: props.isPicked, isRestart: false, timing })
  } else if (props.isClosing !== s.gone >= 0) {
    surface.setState({ ...s, gone: props.isClosing ? 0 : -1 })
  } else if (props.isPicked !== s.isPicked) {
    surface.setState({ ...s, isPicked: props.isPicked, isRestart: props.isPicked, hover: props.isPicked ? 0 : s.hover })
  } else if (!s.timing || !isSameTiming(s.timing, timing)) {
    surface.setState({ ...s, timing })
  }
  const { Box, Button, Text } = surface.elements
  const f = flourishOf(props)
  const glyphAt = (at: number) => (f ? (at < f.frames.length ? f.frames[at] : f.rest) : '')
  const flicker = f?.colors && (props.flare ?? f.colors)
  const colorAt = (at: number) => (flicker && f && at < f.frames.length ? (flicker[at % flicker.length] ?? props.color) : props.color)
  const swept = (at: number) =>
    at < timing.frames
      ? padded(props.label).map((cell, i) => {
          const wash = washAt(i, at - (SHINE.length - 1), SHINE)
          return (
            <Text color={wash === undefined ? props.color : washed(props.color, wash)} bold={wash !== undefined}>
              {cell}
            </Text>
          )
        })
      : ` ${props.label} `
  const looped = s?.hover ?? 0
  const at = props.isPicked ? looped : Math.floor(((s?.tick ?? 0) * TICK_MS) / timing.ms)
  const isPlaying = at < timing.frames
  const lead = f ? ` ${glyphAt(at)}` : ''
  const text = `${lead} ${props.label} `
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
