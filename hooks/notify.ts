import type { EngineInterface } from 'claude-code'

// Desktop alerts: a sound and a toast through the OS's own tools, as the Rust
// binary raised them (src/cmd/notify.rs). Claude Code's own `$.ui.notify`
// writes a terminal sequence VS Code's terminal ignores, and `$.audio.play`
// plays only on macOS, so each platform gets one child process that does both.
// The message reaches that child as data (env or argv), never as script text.

type $ = EngineInterface

export type Alert = 'permission' | 'stop' | 'compaction_start' | 'compaction_done' | 'context_high' | 'rate_limit'
export type Delivery = { toasts: boolean; sounds: boolean }

const TITLE = 'Claude Code'
// The binary's sounds by event: macOS, Linux (freedesktop), Windows (Media).
const SOUNDS: Record<Alert, [string, string, string]> = {
  permission: ['Tink.aiff', 'bell.oga', 'Windows Exclamation.wav'],
  compaction_start: ['Tink.aiff', 'bell.oga', 'Windows Battery Low.wav'],
  stop: ['Glass.aiff', 'complete.oga', 'chimes.wav'],
  compaction_done: ['Glass.aiff', 'complete.oga', 'chimes.wav'],
  context_high: ['Sosumi.aiff', 'dialog-warning.oga', 'Windows Battery Critical.wav'],
  rate_limit: ['Sosumi.aiff', 'dialog-warning.oga', 'Windows Battery Critical.wav'],
}
// A click waits this long for the person before the child gives up.
const CLICK_WAIT_S = 60
// The macOS app terminal-notifier activates on a click, by TERM_PROGRAM.
const BUNDLES: Record<string, string> = {
  Apple_Terminal: 'com.apple.Terminal',
  'iTerm.app': 'com.googlecode.iterm2',
  ghostty: 'com.mitchellh.ghostty',
  vscode: 'com.microsoft.VSCode',
  WezTerm: 'com.github.wez.wezterm',
  kitty: 'net.kovidgoyal.kitty',
  Alacritty: 'org.alacritty',
  WarpTerminal: 'dev.warp.Warp-Stable',
}

// Windows: the toast under PowerShell's own app id, its sound, then, while the
// toast stands, a wait for its click. Only a click pays for finding the window
// this session runs in, the first ancestor that owns visible windows (VS
// Code's, the one titled with the session's folder), and raises it.
const WINDOWS_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$toast = $null
if ($env:STATUSBOX_TOAST -eq '1') {
  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $title = [Security.SecurityElement]::Escape($env:STATUSBOX_TITLE)
  $text = [Security.SecurityElement]::Escape($env:STATUSBOX_MESSAGE)
  $xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$title</text><text>$text</text></binding></visual><audio silent='true'/></toast>")
  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
  Register-ObjectEvent -InputObject $toast -EventName Activated -SourceIdentifier click | Out-Null
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($toast)
}
if ($env:STATUSBOX_SOUND) {
  $wav = Join-Path $env:SystemRoot ('Media\\' + $env:STATUSBOX_SOUND)
  if (Test-Path -LiteralPath $wav) { (New-Object Media.SoundPlayer $wav).PlaySync() } else { [Media.SystemSounds]::Asterisk.Play() }
}
if ($null -eq $toast) { return }
if (-not (Wait-Event -SourceIdentifier click -Timeout ${CLICK_WAIT_S})) { return }
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class StatusboxWindows {
  delegate bool Visit(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(Visit f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  public static List<KeyValuePair<IntPtr, string>> Of(uint pid) {
    var found = new List<KeyValuePair<IntPtr, string>>();
    EnumWindows((h, l) => {
      uint owner; GetWindowThreadProcessId(h, out owner);
      if (owner == pid && IsWindowVisible(h) && GetWindow(h, 4) == IntPtr.Zero) {
        var title = new StringBuilder(512); GetWindowText(h, title, 512);
        if (title.Length > 0) found.Add(new KeyValuePair<IntPtr, string>(h, title.ToString()));
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
$all = @{}
Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CreationDate | ForEach-Object { $all[[uint32]$_.ProcessId] = $_ }
$window = [IntPtr]::Zero
$child = $all[[uint32]$PID]
for ($i = 0; $i -lt 64 -and $null -ne $child; $i++) {
  $parent = $all[[uint32]$child.ParentProcessId]
  # A parent younger than its child is a reused pid: the chain ends there.
  if ($null -eq $parent -or $parent.CreationDate -gt $child.CreationDate) { break }
  $windows = [StatusboxWindows]::Of([uint32]$parent.ProcessId)
  if ($windows.Count -gt 0) {
    $mine = if ($parent.Name -match '^(Code|Code - Insiders|Cursor|Windsurf)\\.exe$') { @($windows | Where-Object { $_.Value -like ('*' + $env:STATUSBOX_FOLDER + '*') }) } else { @($windows) }
    if ($mine.Count -eq 1) { $window = $mine[0].Key }
    break
  }
  $child = $parent
}
if ($window -eq [IntPtr]::Zero) { return }
if ([StatusboxWindows]::IsIconic($window)) { [void][StatusboxWindows]::ShowWindow($window, 9) }
[void][StatusboxWindows]::SetForegroundWindow($window)
`

// macOS: the sound in the background, then terminal-notifier, which brings the
// terminal forward on a click, where it is installed; else a plain banner.
const MAC_SH = `
sound=$1 title=$2 message=$3 toast=$4 bundle=$5
[ -n "$sound" ] && afplay "$sound" >/dev/null 2>&1 &
[ "$toast" = 1 ] || exit 0
if command -v terminal-notifier >/dev/null 2>&1; then
  terminal-notifier -title "$title" -message "$message" \${bundle:+-activate "$bundle"} >/dev/null 2>&1
else
  osascript -e 'on run argv' -e 'display notification (item 2 of argv) with title (item 1 of argv)' -e 'end run' "$title" "$message" >/dev/null 2>&1
fi
`

// Linux: the sound through the first player there is, then notify-send; with
// an X11 window id and xdotool, a click on the toast raises that window.
const LINUX_SH = `
sound=$1 title=$2 message=$3 toast=$4
if [ -n "$sound" ] && [ -f "$sound" ]; then
  { paplay "$sound" || ffplay -nodisp -autoexit -loglevel quiet "$sound" || ogg123 -q "$sound"; } >/dev/null 2>&1 &
fi
[ "$toast" = 1 ] || exit 0
command -v notify-send >/dev/null 2>&1 || exit 0
if [ -n "$WINDOWID" ] && command -v xdotool >/dev/null 2>&1; then
  picked=$(timeout ${CLICK_WAIT_S} notify-send "$title" "$message" --urgency=normal -A default=Focus 2>/dev/null)
  status=$?
  [ "$picked" = default ] && xdotool windowactivate "$WINDOWID" >/dev/null 2>&1
  # An old libnotify without -A fails at once: the toast goes out plain.
  [ -z "$picked" ] && [ "$status" -ne 0 ] && [ "$status" -ne 124 ] && notify-send "$title" "$message" --urgency=normal
else
  notify-send "$title" "$message" --urgency=normal >/dev/null 2>&1
fi
`

let platform: 'windows' | 'mac' | 'linux' | null = null

async function detect($: $): Promise<'windows' | 'mac' | 'linux'> {
  if (platform) return platform
  if ((await $.env.get('OS')) === 'Windows_NT') return (platform = 'windows')
  return (platform = (await $.fs.exists('/System/Library/Sounds')) ? 'mac' : 'linux')
}

// Raises the alert and returns at once: the child shows the toast, plays the
// sound and waits for a click on its own, so no hook waits on it. Never
// rejects: an alert that cannot go out is dropped.
export async function notify($: $, alert: Alert, message: string, delivery: Delivery, cwd: string): Promise<void> {
  if (!delivery.toasts && !delivery.sounds) return
  await raise($, alert, message, delivery, cwd).catch(() => undefined)
}

async function raise($: $, alert: Alert, message: string, delivery: Delivery, cwd: string): Promise<void> {
  const os = await detect($)
  const [mac, linux, windows] = SOUNDS[alert]
  const toast = delivery.toasts ? '1' : '0'
  const timeoutMs = (CLICK_WAIT_S + 30) * 1000
  const run = (argv: string[], env?: Record<string, string>) => void $.process.run(argv, { timeoutMs, ...(env && { env }) }).catch(() => undefined)
  if (os === 'windows') {
    const folder = cwd.split(/[\\/]/).filter(Boolean).pop() ?? ''
    return run(['powershell', '-NoProfile', '-NonInteractive', '-Sta', '-Command', WINDOWS_PS], {
      STATUSBOX_TITLE: TITLE,
      STATUSBOX_MESSAGE: message,
      STATUSBOX_TOAST: toast,
      STATUSBOX_SOUND: delivery.sounds ? windows : '',
      STATUSBOX_FOLDER: folder,
    })
  }
  if (os === 'mac') {
    const bundle = (await $.env.get('__CFBundleIdentifier')) || BUNDLES[(await $.env.get('TERM_PROGRAM')) ?? ''] || ''
    return run(['/bin/sh', '-c', MAC_SH, 'statusbox', delivery.sounds ? `/System/Library/Sounds/${mac}` : '', TITLE, message, toast, bundle])
  }
  run(['/bin/sh', '-c', LINUX_SH, 'statusbox', delivery.sounds ? `/usr/share/sounds/freedesktop/stereo/${linux}` : '', TITLE, message, toast])
}

// What a permission request asks, as the binary worded it: the tool and, for a
// command or a file, what it touches, cut to 80 characters.
export function permissionMessage(tool: unknown, input: unknown, cwd: string): string {
  if (typeof tool !== 'string' || !tool) return 'Waiting for permission'
  const fields = (input ?? {}) as Record<string, unknown>
  let detail = ''
  if (tool === 'Bash' && typeof fields.command === 'string') detail = fields.command
  if (['Edit', 'Write', 'Read'].includes(tool) && typeof fields.file_path === 'string') {
    const path = fields.file_path
    const base = cwd.replace(/[\\/]+$/, '')
    const isInside = base !== '' && path.toLowerCase().startsWith(base.toLowerCase()) && /^[\\/]/.test(path.slice(base.length))
    detail = isInside ? path.slice(base.length + 1) : path
  }
  detail = detail.replace(/\s+/g, ' ').trim()
  const cut = [...detail].length > 80 ? `${[...detail].slice(0, 79).join('')}…` : detail
  return cut ? `${tool}: ${cut}` : tool
}
