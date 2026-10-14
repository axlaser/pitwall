<div align="center">

# statusbox

**A live status box for [Claude Code](https://claude.ai/code), built as a plugin.**<br>
Context, git, tokens, cost and rate limits above the prompt, a side panel of sessions and agents, and desktop notifications.

[![macOS](https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white)](#install)
[![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](#install)
[![Windows](https://img.shields.io/badge/Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white)](#install)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](#license)

![screenshot](assets/screenshot.png)

[Install](#install) · [The box](#the-box) · [The side panel](#the-side-panel) · [Notifications](#notifications) · [Settings](#settings) · [Troubleshooting](#troubleshooting)

</div>

## Install

At the prompt of a Claude Code session (2.1.299 or later):

```text
/plugin install statusbox --marketplace axlaser/statusbox
```

Answer `y` to add the marketplace, then pick a scope (user is the first one offered). The box appears in that session straight away, and in every session after it.

From a shell instead:

```bash
claude plugin install statusbox --marketplace axlaser/statusbox
```

In the desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `axlaser/statusbox`, then **Add plugin**.

**Update:** `claude plugin update statusbox`, then `/reload-plugins` in a running session.

**Uninstall:** `/plugin uninstall statusbox`.

**Coming from claude-statusline?** The Rust binary this replaced registered itself in `~/.claude/settings.json`. Remove it first, or you'll get two status lines and every alert twice:

```bash
curl -fsSL https://raw.githubusercontent.com/axlaser/statusbox/v1.0.0-rc.2/install/uninstall.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/axlaser/statusbox/v1.0.0-rc.2/install/uninstall.ps1 | iex
```

## The box

A band above the prompt, redrawn as things happen rather than on a timer.

| Row | Contents |
|-----|----------|
| **repo** | Directory (shortened to `~`), branch, `↑ahead` `↓behind`, `+insertions` `-deletions` `~untracked`, `⊟ stashes`, and `sessions ›` to open the side panel. Labelled **project** outside a git repo. Click the path to open the repository's web page. |
| **model** | Context bar with %, `used/window` tokens, model, reasoning effort, `● ready` or Claude's working animation, and your Claude Code version (click it for the changelog). |
| **tokens** | Session totals for `in`, `cache↑` (writes), `cache↓` (reads) and `out`, the latest turn's share in brackets, then how long the latest turn took to its first output and in all. |
| **advisor** | Only when the advisor tool was used: its model, calls, tokens and cost. |
| **spend** | This process's cost split by who asked: the main conversation, subagents, and background work (titles, compaction). `earlier` is what the session cost before the plugin saw it. |
| **cost** | Total cost in USD, messages, session length, and 5-hour and 7-day rate-limit usage. |

Rows with nothing to show are hidden.

**Reading it**

- **Context bar:** a line that shades from green to yellow at 60% and red from 85%. It glides to each new reading, and a highlight runs along it while Claude works.
- **Effort:** click it to step through the levels, or use ← and → while it has focus. The pick lasts for this session and saves nothing.
- **Rate limits:** `5h 42% ⇡3% (1h)` means 42% used, 3 points ahead of an even pace, resetting in 1 hour. `⇣` means you're under pace. Rate limits only show on Pro and Max plans.
- **First output:** green under 10 s, yellow under 30 s, red above.
- **Compact:** past 85% context, a `compact context` button appears under the box.
- **Pasted images (Windows):** paste a screenshot with **Alt+V** and a thumbnail of it shows above the box while `[Image #N]` is in your draft. Click `#N open ↗` to see it full size.

**Keys:** `ctrl+x ctrl+a` hides and shows the box, `ctrl+x tab` moves the focus into it.

## The side panel

In fullscreen mode (`"tui": "fullscreen"`), a panel docks beside the transcript. Open it with `/sidebar` or `sessions ›` in the box.

- **Sessions:** this project's six most recent sessions as tabs, titled the way `/resume` lists them. Click one to switch to it in place; `+` starts a new session (`/clear`).
- **Agents:** a card per subagent in this session: what it was asked, its model and effort, tokens, cost and time, with Claude's animation while it works.
- **Elsewhere:** the other Claude Code sessions running on this machine, busy, idle or waiting for you.

**Keys:** `ctrl+x ←` and `ctrl+x →` widen and narrow it, `ctrl+x x` closes it. Once closed it stays closed until you open it again.

Claude Code docks panels on the right, and only in fullscreen mode at 110 columns or wider; a plugin can't move it to the left. A session of another project can't be switched to in place, and one already open in another terminal isn't taken over: the panel says where it is instead.

## Notifications

A sound and a desktop notification for the moments you'd otherwise miss.

| Event | When |
|-------|------|
| Permission request | Claude is waiting for your approval (the message names the tool and the command or file) |
| Finished | Claude finishes responding. Not while a subagent it's waiting on is still running. |
| Compaction start / done | Context compaction begins or ends |
| Context high | Context usage reaches 70%, once until it drops below again |
| Rate limit | 5-hour or 7-day usage reaches 80%, once per window |

**Clicking a notification** brings the session's window to the front: on Windows the terminal or VS Code window the session runs in (for 60 seconds after it appears), on macOS the terminal app (needs terminal-notifier), on Linux the X11 window (needs `xdotool`).

| Platform | Notifications | Sounds |
|----------|---------------|--------|
| Windows | Built in | Built in (Windows Media sounds) |
| macOS | Built in; install [terminal-notifier](https://github.com/julienXX/terminal-notifier) (`brew install terminal-notifier`) for click-to-focus | `afplay` with the system sounds |
| Linux | `notify-send` (`libnotify-bin` / `libnotify`) | `paplay`, `ffplay` or `ogg123` with the freedesktop sounds |

## Settings

In `/config`, under statusbox:

| Setting | Default | |
|---------|---------|---|
| Desktop notifications | on | |
| Notification sounds | on | |
| Context alert (%) | 70 | 0 turns it off |
| Rate limit alert (%) | 80 | 0 turns it off |

## Troubleshooting

**Nothing shows.** Run `/plugin` and check statusbox is installed and enabled, and that `claude --version` is 2.1.299 or later. A hook that fails shows a dim `statusbox: …` line in the transcript; `claude --debug` writes the full reason to the debug log.

**The box is gone but the plugin is enabled.** `ctrl+x ctrl+a` hides it; press it again.

**The side panel doesn't appear.** It needs fullscreen mode and 110 columns or more. `/sidebar` says so when it can't place the panel.

**No notifications.** Check the settings above, then your OS: Windows' notification settings for "Windows PowerShell", macOS's for terminal-notifier or Script Editor, and that `notify-send` is installed on Linux.

## How it works

statusbox is a Claude Code plugin made of function hooks: the box, the panel and the alerts react to the engine's own events (each request, each turn, compaction, permission prompts) instead of running a program on every refresh. The box draws above the prompt through `ui.render`, the panel is a docked `Pane`, and the animations are small client modules the terminal runs locally.

It reads only what Claude Code already writes: the session's transcript (once at start, and after a turn that used the advisor), your project's session files for their titles, and Claude Code's record of running sessions. After each turn it runs `git` for the repo row and one `findstr` (or `grep`) for the session titles; nothing runs on a timer but file reads. It makes no network calls, and the cost figures are Claude Code's own.

This repository was `claude-statusline`, a Rust binary; that version is at [v1.0.0-rc.2](https://github.com/axlaser/statusbox/tree/v1.0.0-rc.2).

## License

MIT. The Claude icon in `assets/` is from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Claude_AI_symbol.svg) (public domain).
