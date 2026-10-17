import type { EngineInterface } from 'claude-code'

// `$.audio.play` plays only on macOS, so each platform gets one child process.

type $ = EngineInterface

export type Alert = 'permission' | 'stop' | 'compaction_start' | 'compaction_done' | 'context_high' | 'rate_limit'

const SOUNDS: Record<Alert, { mac: string; linux: string; windows: string }> = {
  permission: { mac: 'Tink.aiff', linux: 'bell.oga', windows: 'Windows Exclamation.wav' },
  compaction_start: { mac: 'Tink.aiff', linux: 'bell.oga', windows: 'Windows Battery Low.wav' },
  stop: { mac: 'Glass.aiff', linux: 'complete.oga', windows: 'chimes.wav' },
  compaction_done: { mac: 'Glass.aiff', linux: 'complete.oga', windows: 'chimes.wav' },
  context_high: { mac: 'Sosumi.aiff', linux: 'dialog-warning.oga', windows: 'Windows Battery Critical.wav' },
  rate_limit: { mac: 'Sosumi.aiff', linux: 'dialog-warning.oga', windows: 'Windows Battery Critical.wav' },
}
const TIMEOUT_MS = 30_000

const WINDOWS_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$wav = Join-Path $env:SystemRoot ('Media\\' + $env:PITWALL_SOUND)
if (Test-Path -LiteralPath $wav) { (New-Object Media.SoundPlayer $wav).PlaySync() } else { [Media.SystemSounds]::Asterisk.Play() }
`

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

export async function notify($: $, alert: Alert, isOn: boolean): Promise<void> {
  if (!isOn) return
  await raise($, alert).catch(() => undefined)
}

async function raise($: $, alert: Alert): Promise<void> {
  const os = await detect($)
  const { mac, linux, windows } = SOUNDS[alert]
  const run = (argv: string[], env?: Record<string, string>) => void $.process.run(argv, { timeoutMs: TIMEOUT_MS, ...(env && { env }) }).catch(() => undefined)
  if (os === 'windows') return run(['powershell', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_PS], { PITWALL_SOUND: windows })
  if (os === 'mac') return run(['afplay', `/System/Library/Sounds/${mac}`])
  run(['/bin/sh', '-c', LINUX_SH, 'pitwall', `/usr/share/sounds/freedesktop/stereo/${linux}`])
}
