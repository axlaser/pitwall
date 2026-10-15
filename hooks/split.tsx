import type { ClientModule } from 'claude-code'

type Part = { key: string; usd: number; color: string }
type Props = { parts: Part[]; width: number; track?: string }
type State = { shown: Record<string, number>; target: Record<string, number> }

const TICK_MS = 40
const TRACK = '#3c3c3c'

const Split: ClientModule<Props, State> = (props, surface) => {
  const target = shares(props.parts)
  const s = surface.state
  if (s === undefined) {
    surface.every(TICK_MS, () => {
      const now = surface.state
      if (now === undefined) return
      const keys = Object.keys(now.target)
      if (keys.every(k => Math.abs((now.target[k] ?? 0) - (now.shown[k] ?? 0)) < 0.002) && Object.keys(now.shown).length === keys.length) return
      const shown = Object.fromEntries(
        keys.map(k => {
          const from = now.shown[k] ?? 0
          const to = now.target[k] ?? 0
          return [k, Math.abs(to - from) < 0.002 ? to : from + (to - from) * 0.25]
        }),
      )
      surface.setState({ ...now, shown })
    })
    surface.setState({ shown: {}, target })
  } else if (JSON.stringify(s.target) !== JSON.stringify(target)) {
    surface.setState({ ...s, target })
  }

  const { Text } = surface.elements
  const shown = props.parts.map(part => s?.shown[part.key] ?? 0)
  const filled = Math.min(props.width, Math.round(shown.reduce((a, b) => a + b, 0) * props.width))
  const cells = apportion(shown, filled)
  return (
    <Text>
      {props.parts.map((part, i) => (
        <Text color={part.color}>{'━'.repeat(cells[i] ?? 0)}</Text>
      ))}
      <Text color={props.track ?? TRACK}>{'─'.repeat(props.width - filled)}</Text>
    </Text>
  )
}

function shares(parts: Part[]): Record<string, number> {
  const sum = parts.reduce((a, part) => a + part.usd, 0)
  return Object.fromEntries(parts.map(part => [part.key, sum > 0 ? part.usd / sum : 0]))
}

export function apportion(values: number[], width: number): number[] {
  const sum = values.reduce((a, b) => a + b, 0)
  if (sum <= 0) return values.map(() => 0)
  const exact = values.map(v => (v / sum) * width)
  const cells = exact.map(Math.floor)
  const remainders = exact.map((e, i) => e - (cells[i] ?? 0))
  let left = width - cells.reduce((a, b) => a + b, 0)
  for (const i of exact.map((e, i) => i).sort((a, b) => (remainders[b] ?? 0) - (remainders[a] ?? 0))) {
    if (left-- <= 0) break
    cells[i]!++
  }
  return cells
}

export default Split
