import type { ClientModule } from 'claude-code'

export type Figure = 'tokens' | 'usd' | 'int' | 'wait'
type Props = { value: number; figure: Figure; before: string; after: string; color?: string; bold?: boolean; dimColor?: boolean }
type State = { from: number; to: number; shown: number; step: number; rollId: number }

const TICK_MS = 40
const STEPS = 15

const Count: ClientModule<Props, State> = (props, surface) => {
  const s = surface.state
  if (s === undefined) {
    surface.setState({ from: props.value, to: props.value, shown: props.value, step: STEPS, rollId: 0 })
  } else if (s.to !== props.value) {
    const rollId = (s.rollId ?? 0) + 1
    surface.setState({ from: s.shown, to: props.value, shown: s.shown, step: 0, rollId })
    const stop = surface.every(TICK_MS, () => {
      const now = surface.state
      if (now === undefined || now.rollId !== rollId) return stop()
      const step = now.step + 1
      const eased = 1 - (1 - step / STEPS) ** 3
      surface.setState({ ...now, step, shown: step >= STEPS ? now.to : now.from + (now.to - now.from) * eased })
      if (step >= STEPS) stop()
    })
  }
  const at = props.before + figure(props.figure, s?.shown ?? props.value) + props.after
  const target = props.before + figure(props.figure, props.value) + props.after
  const width = [...target].length
  const text = [...at].length > width ? target : at.padStart(width)
  const { Text } = surface.elements
  return (
    <Text color={props.color} bold={props.bold} dimColor={props.dimColor}>
      {text}
    </Text>
  )
}

export default Count

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

function formatWait(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : formatElapsed(ms)
}
