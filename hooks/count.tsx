import type { ClientModule } from 'claude-code'

export type Figure = 'tokens' | 'usd' | 'int' | 'wait'
type Props = { value: number; figure: Figure; before: string; after: string; width: number; color?: string; bold?: boolean; dimColor?: boolean }
// A roll runs from `from` to `to` in STEPS ticks; `run` names the timer that
// drives it, so a roll a newer value cut short stops its own timer.
type State = { from: number; to: number; shown: number; step: number; run: number }

const TICK_MS = 40
const STEPS = 15

// A figure of the box that rolls to each new value, up or down, easing out
// over 600 ms. Mounted it shows its value at once; at rest no timer runs.
const Count: ClientModule<Props, State> = (props, surface) => {
  const s = surface.state
  if (s === undefined) {
    surface.setState({ from: props.value, to: props.value, shown: props.value, step: STEPS, run: 0 })
  } else if (s.to !== props.value) {
    const run = s.run + 1
    surface.setState({ from: s.shown, to: props.value, shown: s.shown, step: 0, run })
    const stop = surface.every(TICK_MS, () => {
      const now = surface.state
      if (now === undefined || now.run !== run) return stop()
      const step = now.step + 1
      const eased = 1 - (1 - step / STEPS) ** 3
      surface.setState({ ...now, step, shown: step >= STEPS ? now.to : now.from + (now.to - now.from) * eased })
      if (step >= STEPS) stop()
    })
  }
  const at = props.before + figure(props.figure, s?.shown ?? props.value) + props.after
  // shortcut: the region is the target's width, so a frame drawn wider (a roll
  // down past a power of ten, a wait up from `9.9s` to `15s`) shows the target.
  const text = [...at].length > props.width ? props.before + figure(props.figure, props.value) + props.after : at.padStart(props.width)
  const { Text } = surface.elements
  return (
    <Text color={props.color} bold={props.bold} dimColor={props.dimColor}>
      {text}
    </Text>
  )
}

export default Count

// --- formatters, ported from src/render.rs; the hooks module draws with these too

export function figure(kind: Figure, value: number): string {
  if (kind === 'tokens') return formatTokens(Math.round(value))
  if (kind === 'usd') return formatCost(value)
  if (kind === 'wait') return formatWait(value)
  return String(Math.round(value))
}

function formatTokens(n: number): string {
  if (n >= 1e9) return `${Math.floor(n / 1e9)}.${String(Math.floor((n % 1e9) / 1e7)).padStart(2, '0')}B`
  if (n >= 1e6) return `${Math.floor(n / 1e6)}.${Math.floor((n % 1e6) / 1e5)}M`
  if (n >= 1e3) return `${Math.floor(n / 1e3)}.${Math.floor((n % 1e3) / 100)}K`
  return String(n)
}

function formatCost(usd: number): string {
  if (Math.abs(usd) < 1000) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

export function formatElapsed(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000))
  const pad = (v: number) => String(v).padStart(2, '0')
  if (secs >= 3600) return `${Math.floor(secs / 3600)}h${pad(Math.floor((secs % 3600) / 60))}m`
  if (secs >= 60) return `${Math.floor(secs / 60)}m${pad(secs % 60)}s`
  return `${secs}s`
}

// `1.2s` under ten seconds, where a tenth matters; formatElapsed's above.
function formatWait(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : formatElapsed(ms)
}
