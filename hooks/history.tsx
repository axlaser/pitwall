import type { Elements } from 'claude-code'
import type { Palette } from './theme'

type El = Elements['terminal']

type Kind = 'read' | 'edit' | 'shell' | 'web' | 'agent' | 'mcp' | 'other'
const KINDS: Record<string, Kind> = {
  Read: 'read', Glob: 'read', Grep: 'read', LS: 'read', NotebookRead: 'read',
  Edit: 'edit', MultiEdit: 'edit', Write: 'edit', NotebookEdit: 'edit',
  Bash: 'shell', BashOutput: 'shell', KillShell: 'shell',
  WebFetch: 'web', WebSearch: 'web',
  Task: 'agent', Agent: 'agent',
}
const kindOf = (tool: string): Kind => KINDS[tool] ?? (tool.startsWith('mcp__') ? 'mcp' : 'other')
const inkOf = (P: Palette, kind: Kind) =>
  ({ read: P.info, edit: P.ok, shell: P.accent, web: P.cool, agent: P.alt, mcp: P.warn, other: P.text })[kind]

const nameOf = (tool: string) => {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  return mcp ? `${mcp[1]} · ${mcp[2]}` : tool === 'Task' ? 'Agent' : tool
}

export type Where = { cwd: string; home: string | null }
const isUnder = (path: string, dir: string | null): dir is string =>
  !!dir && path.startsWith(dir) && (path[dir.length] === '/' || path[dir.length] === '\\')
export const shortPath = (path: string, where: Where) =>
  isUnder(path, where.cwd) ? path.slice(where.cwd.length + 1) : isUnder(path, where.home) ? `~${path.slice(where.home.length)}` : path

export function summaryOf(tool: string, input: unknown, where: Where): string {
  const i = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const str = (key: string) => (typeof i[key] === 'string' ? (i[key] as string) : '')
  const firstLine = (text: string) => text.split('\n')[0] ?? ''
  switch (tool) {
    case 'Bash':
      return firstLine(str('command'))
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return shortPath(str('file_path'), where)
    case 'NotebookEdit':
    case 'NotebookRead':
      return shortPath(str('notebook_path'), where)
    case 'Grep':
    case 'Glob':
      return str('path') ? `${str('pattern')} in ${shortPath(str('path'), where)}` : str('pattern')
    case 'LS':
      return shortPath(str('path'), where)
    case 'WebFetch':
      return str('url')
    case 'WebSearch':
      return str('query')
    case 'Task':
    case 'Agent':
      return str('description')
    default:
      return firstLine(Object.values(i).find((v): v is string => typeof v === 'string') ?? '')
  }
}

export function changeOf(tool: string, input: unknown): { added: number; removed: number } | null {
  const i = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const lines = (v: unknown) => (typeof v === 'string' && v !== '' ? v.split('\n').length : 0)
  if (tool === 'Write') return { added: lines(i.content), removed: 0 }
  if (tool === 'Edit') return { added: lines(i.new_string), removed: lines(i.old_string) }
  if (tool === 'MultiEdit' && Array.isArray(i.edits)) {
    return (i.edits as Record<string, unknown>[]).reduce<{ added: number; removed: number }>(
      (sum, edit) => ({ added: sum.added + lines(edit.new_string), removed: sum.removed + lines(edit.old_string) }),
      { added: 0, removed: 0 },
    )
  }
  return null
}

export function tookLabel(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const secs = Math.floor(ms / 1000)
  return `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}s`
}

type ToolProps = { tool: string; input: unknown; isRunning: boolean; isErrored: boolean; isInterrupted: boolean }

export function toolRow(el: El, P: Palette, props: ToolProps, took: number | undefined, where: Where) {
  const { Box, Text } = el
  const ink = inkOf(P, kindOf(props.tool))
  const [mark, markInk] = props.isInterrupted
    ? ['■', P.warn]
    : props.isErrored
      ? ['✗', P.bad]
      : props.isRunning
        ? ['○', ink]
        : ['●', ink]
  const change = changeOf(props.tool, props.input)
  const summary = summaryOf(props.tool, props.input, where)
  return (
    <Box key="tool-row" width="100%">
      <Box width={2} flexShrink={0}>
        <Text color={markInk}>{mark}</Text>
      </Box>
      <Box flexShrink={0}>
        <Text color={ink} bold>
          {nameOf(props.tool)}
        </Text>
      </Box>
      {summary !== '' && (
        <Box marginLeft={2} flexShrink={1}>
          <Text color={P.text} wrap="truncate-end">
            {summary}
          </Text>
        </Box>
      )}
      <Box flexGrow={1} />
      {change && (change.added > 0 || change.removed > 0) && (
        <Box marginLeft={2} flexShrink={0}>
          {change.added > 0 && <Text color={P.ok}>{`+${change.added}`}</Text>}
          {change.added > 0 && change.removed > 0 && <Text> </Text>}
          {change.removed > 0 && <Text color={P.bad}>{`-${change.removed}`}</Text>}
        </Box>
      )}
      {(props.isRunning || took !== undefined) && (
        <Box marginLeft={2} flexShrink={0}>
          <Text color={P.muted}>{props.isRunning ? 'running…' : tookLabel(took ?? 0)}</Text>
        </Box>
      )}
    </Box>
  )
}

export function promptRow(el: El, P: Palette, text: string) {
  const { Box, Text } = el
  return (
    <Box key="prompt-row" borderStyle="round" borderColor={P.muted} paddingX={1} alignSelf="flex-start" flexShrink={1}>
      <Text color={P.accent}>{'❯ '}</Text>
      <Text color={P.text}>{text}</Text>
    </Box>
  )
}

type Align = 'left' | 'center' | 'right'
export type Table = { header: string[]; align: Align[]; rows: string[][] }
export type Part = { kind: 'text'; text: string } | { kind: 'table'; table: Table }

const cellsOf = (line: string) => {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'))
}
const isRow = (line: string) => /^\s*\|.*\|\s*$/.test(line) || (line.includes('|') && line.trim() !== '' && !/^\s*```/.test(line))
const isSeparator = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)

export function splitTables(markdown: string): Part[] {
  const lines = markdown.split('\n')
  const parts: Part[] = []
  let text: string[] = []
  let fence: string | null = null
  const flush = () => {
    const joined = text.join('\n').replace(/^\n+|\n+$/g, '')
    if (joined !== '') parts.push({ kind: 'text', text: joined })
    text = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const opener = /^\s*(```+|~~~+)/.exec(line)?.[1]
    if (opener) {
      if (fence === null) fence = opener[0] === '`' ? '```' : '~~~'
      else if (opener.startsWith(fence)) fence = null
      text.push(line)
      continue
    }
    const next = lines[i + 1] ?? ''
    if (fence === null && isRow(line) && isSeparator(next)) {
      flush()
      const header = cellsOf(line)
      const align = cellsOf(next).map((cell): Align => (cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left'))
      const rows: string[][] = []
      i += 2
      while (i < lines.length && isRow(lines[i] ?? '')) rows.push(cellsOf(lines[i++] ?? ''))
      i--
      parts.push({ kind: 'table', table: { header, align, rows } })
      continue
    }
    text.push(line)
  }
  flush()
  return parts
}

const plain = (cell: string) => cell.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/`([^`]*)`/g, '$1').replace(/\*(.+?)\*/g, '$1')

export function tableCard(el: El, P: Palette, table: Table, key: string) {
  const { Box, Text } = el
  const columns = table.header.length
  const widths = Array.from({ length: columns }, (_, c) =>
    Math.max([...plain(table.header[c] ?? '')].length, ...table.rows.map(row => [...plain(row[c] ?? '')].length), 1),
  )
  const justify = (c: number) => (table.align[c] === 'right' ? 'flex-end' : table.align[c] === 'center' ? 'center' : 'flex-start')
  const row = (cells: string[], ink: string, isHead: boolean, band?: string, rowKey?: string) => (
    <Box key={rowKey} backgroundColor={band}>
      {widths.map((width, c) => (
        <Box width={width + 2} flexShrink={1} paddingX={1} justifyContent={justify(c)}>
          <Text color={ink} bold={isHead} wrap="truncate-end">
            {plain(cells[c] ?? '')}
          </Text>
        </Box>
      ))}
    </Box>
  )
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={P.muted} alignSelf="flex-start" flexShrink={1}>
      {row(table.header, P.accent, true)}
      {table.rows.map((cells, r) => row(cells, P.text, false, r % 2 === 1 ? P.track : undefined, `${key}-row-${r}`))}
    </Box>
  )
}

type ReplyProps = { text: string; isFirstOfReply: boolean; isSummary?: true }

export function replyBlock(el: El, P: Palette, props: ReplyProps) {
  const { Box, Text, Markdown } = el
  const parts = splitTables(props.text)
  return (
    <Box key="reply">
      <Box width={2} flexShrink={0}>
        <Text color={P.accent}>{props.isFirstOfReply ? '●' : ' '}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {parts.map((part, i) =>
          part.kind === 'table' ? (
            <Box key={`reply-table-${i}`} marginTop={i === 0 ? 0 : 1} marginBottom={i === parts.length - 1 ? 0 : 1}>
              {tableCard(el, P, part.table, `table-${i}`)}
            </Box>
          ) : (
            <Markdown key={`reply-text-${i}`} text={part.text} />
          ),
        )}
        {props.isSummary && <Text dimColor> · summary</Text>}
      </Box>
    </Box>
  )
}
