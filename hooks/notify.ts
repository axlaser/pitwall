import type { EngineInterface } from 'claude-code'

// Alert sounds through the OS's own players, as the Rust binary played them
// (src/cmd/notify.rs). `$.audio.play` plays only on macOS, so each platform
// gets one child process. The sound's name reaches that child as data (env or
// argv), never as script text.

type $ = EngineInterface

export type Alert = 'permission' | 'stop' | 'compaction_start' | 'compaction_done' | 'context_high' | 'rate_limit'

// The binary's sounds by event: macOS, Linux (freedesktop), Windows (Media).
const SOUNDS: Record<Alert, [string, string, string]> = {
  permission: ['Tink.aiff', 'bell.oga', 'Windows Exclamation.wav'],
  compaction_start: ['Tink.aiff', 'bell.oga', 'Windows Battery Low.wav'],
  stop: ['Glass.aiff', 'complete.oga', 'chimes.wav'],
  compaction_done: ['Glass.aiff', 'complete.oga', 'chimes.wav'],
  context_high: ['Sosumi.aiff', 'dialog-warning.oga', 'Windows Battery Critical.wav'],
  rate_limit: ['Sosumi.aiff', 'dialog-warning.oga', 'Windows Battery Critical.wav'],
}
const TIMEOUT_MS = 30_000

// Windows: the Media sound, or the system's own where it is missing.
const WINDOWS_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$wav = Join-Path $env:SystemRoot ('Media\\' + $env:STATUSBOX_SOUND)
if (Test-Path -LiteralPath $wav) { (New-Object Media.SoundPlayer $wav).PlaySync() } else { [Media.SystemSounds]::Asterisk.Play() }
`

// Linux: the first player there is.
const LINUX_SH = `
[ -f "$1" ] || exit 0
{ paplay "$1" || ffplay -nodisp -autoexit -loglevel quiet "$1" || ogg123 -q "$1"; } >/dev/null 2>&1
`

let platform: 'windows' | 'mac' | 'linux' | null = null

async function detect($: $): Promise<'windows' | 'mac' | 'linux'> {
  if (platform) return platform
  if ((await $.env.get('OS')) === 'Windows_NT') return (platform = 'windows')
  return (platform = (await $.fs.exists('/System/Library/Sounds')) ? 'mac' : 'linux')
}

// Plays the alert's sound and returns at once: no hook waits on the child.
// Never rejects: a sound that cannot play is dropped.
export async function notify($: $, alert: Alert, isOn: boolean): Promise<void> {
  if (!isOn) return
  await raise($, alert).catch(() => undefined)
}

async function raise($: $, alert: Alert): Promise<void> {
  const os = await detect($)
  const [mac, linux, windows] = SOUNDS[alert]
  const run = (argv: string[], env?: Record<string, string>) => void $.process.run(argv, { timeoutMs: TIMEOUT_MS, ...(env && { env }) }).catch(() => undefined)
  if (os === 'windows') return run(['powershell', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_PS], { STATUSBOX_SOUND: windows })
  if (os === 'mac') return run(['afplay', `/System/Library/Sounds/${mac}`])
  run(['/bin/sh', '-c', LINUX_SH, 'statusbox', `/usr/share/sounds/freedesktop/stereo/${linux}`])
}
