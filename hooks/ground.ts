import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

// Nothing in the plugin API writes to the terminal, and a child of the engine
// has no terminal of its own, so no /dev/tty to write to: the child writes to
// the device of the first of its forebears that has one, Claude Code itself.
// On Windows the child joins Claude Code's console instead (it is the child's
// parent: the engine runs in it) and writes there; ConPTY passes the sequence
// on.

type $ = EngineInterface

const SH = `
tty=$PITWALL_TTY
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
set -f
IFS='|'
for osc in $PITWALL_OSC; do printf '\\033]%s\\007' "$osc"; done > "$tty" && printf '%s' "$tty"
`
const PS = `
trap { exit 1 }
Add-Type -Name Console -Namespace Pitwall -MemberDefinition @'
[DllImport("kernel32.dll")] static extern bool FreeConsole();
[DllImport("kernel32.dll")] static extern bool AttachConsole(int pid);
[DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
[DllImport("kernel32.dll")] static extern bool GetConsoleMode(IntPtr h, out uint mode);
[DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool WriteConsoleW(IntPtr h, string s, int n, out int written, IntPtr reserved);
const int ATTACH_PARENT_PROCESS = -1;
const uint GENERIC_READ_WRITE = 0xC0000000, FILE_SHARE_WRITE = 2, OPEN_EXISTING = 3, ENABLE_VIRTUAL_TERMINAL_PROCESSING = 4;
public static bool Paint(string osc) {
  FreeConsole();
  if (!AttachConsole(ATTACH_PARENT_PROCESS)) return false;
  IntPtr h = CreateFileW("CONOUT$", GENERIC_READ_WRITE, FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
  uint mode;
  int n;
  return GetConsoleMode(h, out mode) && (mode & ENABLE_VIRTUAL_TERMINAL_PROCESSING) != 0 && WriteConsoleW(h, osc, osc.Length, out n, IntPtr.Zero);
}
'@
$osc = -join ($env:PITWALL_OSC.Split('|') | ForEach-Object { [char]27 + ']' + $_ + [char]7 })
if (-not [Pitwall.Console]::Paint($osc)) { exit 1 }
'CONOUT$'
`
// The text colour goes with the background: a reply drawn in the terminal's own
// foreground stays legible when a light theme paints over a dark profile.
export type Ground = { bg: string; text: string }
const paint = (g: Ground) => `10;${g.text}|11;${g.bg}`
const RESET = '110|111'
const TIMEOUT_MS = 2000
// A theme switched redraws the whole screen at once, and a write from another
// process that lands inside that frame splits one of Claude Code's own
// sequences: the screen stays garbled until something redraws it whole, which
// no plugin can ask for. Past the frame, the write lands between two.
const SETTLE_MS = 100

const kept = atom({ plugin: 'pitwall', key: 'ground' } as const, null)

let tty: string | undefined
let isTtyMissing = false
let painted: string | null | undefined
let asked: string | null | undefined
let queue: Promise<void> = Promise.resolve()

export function ground($: $, g: Ground | null): void {
  const osc = g && paint(g)
  if (osc === asked || isTtyMissing) return
  asked = osc
  $.clock.after(SETTLE_MS, () => {
    if (osc === asked) queue = queue.then(() => paintTo($, osc))
  })
}

export async function unground($: $): Promise<void> {
  if (isTtyMissing) return
  asked = null
  queue = queue.then(() => paintTo($, null))
  await queue
}

// A /clear or a /resume drops every value as the old session ends, but the
// colour stays on the terminal: the new session keeps it again.
export async function keepGround($: $): Promise<void> {
  if (painted !== undefined) await update($, kept, () => painted ?? null)
}

async function paintTo($: $, osc: string | null): Promise<void> {
  try {
    if (painted === undefined) painted = await read($, kept)
    if (isTtyMissing || osc === painted) return
    const argv = (await $.env.get('OS')) === 'Windows_NT' ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', PS] : ['/bin/sh', '-c', SH]
    const r = await $.process.run(argv, { timeoutMs: TIMEOUT_MS, env: { PITWALL_OSC: osc ?? RESET, PITWALL_TTY: tty ?? '' } })
    const out = r.stdout.trim()
    isTtyMissing = r.exitCode !== 0 || !(out.startsWith('/dev/') || out === 'CONOUT$')
    if (isTtyMissing) return
    tty = out
    painted = osc
    await update($, kept, () => osc)
  } catch {
    isTtyMissing = true
  }
}
