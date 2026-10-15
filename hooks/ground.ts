import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

// The terminal's own background in the skin's. Claude Code paints no
// background of its own and no theme key reaches one: everything it draws sits
// on the terminal's. OSC 11 sets that colour (VS Code's terminal, iTerm2,
// Ghostty, kitty, WezTerm and Windows Terminal take it; Apple Terminal ignores
// it), and OSC 111 puts the terminal's own back.
//
// Nothing in the plugin API writes to the terminal, and a child of the engine
// has no terminal of its own, so no /dev/tty to write to: the child writes to
// the device of the first of its forebears that has one, Claude Code itself.
// Where there is none (Windows, the desktop app, a session the background
// daemon runs), or no `sh` to look, nothing changes: a missing feature, never
// an error. The colour reaches the child as data, never as script text.

type $ = EngineInterface

// Finds the device unless it is given, writes the sequence to it and prints
// it back; exits 1 where there is none to write to.
const SH = `
tty=$STATUSBOX_TTY
p=$PPID
n=0
while [ -z "$tty" ] && [ "$n" -lt 8 ] && [ "$p" -gt 1 ] 2>/dev/null; do
  t=$(ps -o tty= -p "$p" 2>/dev/null | tr -d ' ')
  case $t in
    '' | '?' | '??') p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' '); n=$((n + 1)) ;;
    *) tty=/dev/$t ;;
  esac
done
[ -n "$tty" ] && [ -w "$tty" ] || exit 1
printf '\\033]%s\\007' "$STATUSBOX_OSC" > "$tty" && printf '%s' "$tty"
`
const TIMEOUT_MS = 2000
// How long a write waits after its colour is asked for. A theme switched
// redraws the whole screen at once, and a write from another process that
// lands inside that frame splits one of Claude Code's own sequences: the
// screen stays garbled until something redraws it whole, which no plugin can
// ask for. Past the frame, the write lands between two.
const SETTLE_MS = 100

// The colour on the terminal now, null for its own: kept as a value, so the
// module a /config change or a reload brings up knows what this one painted.
const kept = atom({ plugin: 'statusbox', key: 'ground' } as const, null)

// The device once found (null: none, for good); the colour on the terminal
// (undefined until read back from `kept`) and the one last asked for; the
// writes, in the order they were asked.
let tty: string | null | undefined
let painted: string | null | undefined
let asked: string | null | undefined
let queue: Promise<void> = Promise.resolve()

// Asks for the background `color`, or the terminal's own for null, when that
// is not what was last asked for; returns at once. The box's render hook on
// the terminal calls it, so the colour follows the skin, the theme and the
// toggle the moment one changes. The write waits on a timer, as nothing a
// render starts may write a value, and for the frame to pass (SETTLE_MS); a
// colour asked for in the meantime takes its place. Nothing was painted and
// nothing is wanted, no child runs.
export function ground($: $, color: string | null): void {
  if (color === asked || tty === null) return
  asked = color
  $.clock.after(SETTLE_MS, () => {
    if (color === asked) queue = queue.then(() => paintTo($, color))
  })
}

// Puts the terminal's own background back as the session leaves the process,
// when one was painted; awaited, so it lands before the process exits.
export async function unground($: $): Promise<void> {
  if (tty === null) return
  asked = null
  queue = queue.then(() => paintTo($, null))
  await queue
}

// A /clear or a /resume drops every value as the old session ends, but the
// colour stays on the terminal: the new session keeps it again.
export async function keepGround($: $): Promise<void> {
  if (painted !== undefined) await update($, kept, () => painted ?? null)
}

// Never rejects: a write that fails leaves the terminal as it was, and no
// further one is tried.
async function paintTo($: $, color: string | null): Promise<void> {
  try {
    if (painted === undefined) painted = await read($, kept)
    if (tty === null || color === painted) return
    const osc = color === null ? '111' : `11;${color}`
    const r = await $.process.run(['/bin/sh', '-c', SH], { timeoutMs: TIMEOUT_MS, env: { STATUSBOX_OSC: osc, STATUSBOX_TTY: tty ?? '' } })
    tty = r.exitCode === 0 && r.stdout.startsWith('/dev/') ? r.stdout : null
    if (tty === null) return
    painted = color
    await update($, kept, () => color)
  } catch {
    tty = null
  }
}
