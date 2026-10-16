<div align="center">

# statusbox

**A live status box for [Claude Code](https://claude.ai/code), built as a plugin.**<br>
Context, git and tokens above the prompt, a side panel of rate-limit usage, the session and its cost, the prompt cache, the advisor and agents, and alert sounds.

[![macOS](https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white)](#install)
[![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](#install)
[![Windows](https://img.shields.io/badge/Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white)](#install)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](#license)

![screenshot](assets/screenshot.png)

[Install](#install) · [The box](#the-box) · [The side panel](#the-side-panel) · [Alert sounds](#alert-sounds) · [Settings](#settings) · [Troubleshooting](#troubleshooting)

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

A band above the prompt, redrawn as things happen rather than on a timer. Its figures roll up or down to each new value.

| Row | Contents |
|-----|----------|
| **repo** | Directory (shortened to `~`), branch, `↑ahead` `↓behind`, `+insertions` `-deletions` `~untracked`, `⊟ stashes`, and `SIDEBAR ›` to open or close the side panel (its contents slide in and out behind an edge that sweeps with them, and its chevron turns to match). Labelled **project** outside a git repo. Click the path to open the repository's web page. |
| **model** | Context bar with %, `used/window` tokens, model `▾`, reasoning effort `▾`, and `✓ Ready` or Claude's working animation. |
| **tokens** | Session totals for `in`, `cache↑` (writes), `cache↓` (reads) and `out`, with the current turn's share in brackets, counted as each request lands. |

Rows with nothing to show are hidden.

**Reading it**

- **Context bar:** a line that shades from green to yellow at 60% and red from 85%. It glides to each new reading, and a soft glow runs along it while Claude works.
- **Model and effort:** click either (or its `▾`) and the box rolls open with its choices rippling in, centred, a line unrolling from it to the one in force, which is highlighted. Click another and the line glides over to it, its arrowhead leading the way; `✓ Confirm`, to the right of the choices, applies it (the row slides left to make room where it has to; click the chip again to back out). Switching between the two pickers slides the line across. The model list is the one in `/config`, each model named by its version, and picking one switches the model the same way, keeping the context window you are on. The effort pick lasts for this session and saves nothing; in its picker each level plays a flourish of its own as the row opens and again while the pointer rests on it, from a slow ripple at low to a flare at max. In the model picker each model has a colour of its own, and a sweep of light runs across its name the same way. The choice picked keeps playing for as long as it stays picked. The box shows the model and the effort in their picker colours, and both glisten, `▾` and all, while Claude works.
- **Rate limits:** `5h 42% ⇡3% (1h)` means 42% used, 3 points ahead of an even pace, resetting in 1 hour. `⇣` means you're under pace. Rate limits only show on Pro and Max plans.
- **First output:** green under 10 s, yellow under 30 s, red above.
- **Compact:** past 85% context, a `compact context` button appears under the box.
- **Pasted images (Windows):** paste a screenshot with **Alt+V** and `#N open ↗` shows above the box while `[Image #N]` is in your draft. Click it to see the image full size.

**Keys:** `ctrl+x ctrl+a` hides and shows the box, `ctrl+x tab` moves the focus into it.

## The side panel

In fullscreen mode (`"tui": "fullscreen"`), a panel docks beside the transcript. Open it with `/sidebar` or `SIDEBAR ›` in the box, which closes it again too.

Click a section's name to fold it, smoothly, down to one line that sums it up (`▸ USAGE ── 5-hour 10% · 7-day 5%`), and again to open it. Folded sections stay folded in later sessions. Your Claude Code version sits at the bottom, with a link to the changelog.

- **Usage:** the 5-hour and 7-day rate limits, each with a bar, a tick where a steady pace would put you by now, and the time to its reset.
- **Session:** messages, session length and how long the latest turn took to its first output and in all (counting up while Claude works), the size of its transcript on disk, in auto mode how many tool calls its classifier allowed and blocked, then the session's cost: its total, and a bar split by who asked (the main conversation, the advisor, subagents, background work such as titles and compaction, and `earlier`, what the session cost before the plugin saw it), with each part's dollars and share below.
- **Cache:** once Claude has answered, whether the prompt cache still holds the conversation. **Warm**, the next message reads it back for a small part of the input price, and a countdown shows how long it stays warm without a message (5 minutes or an hour, whichever Claude Code asked for). **Cold**, it writes the whole context to the cache again at more than the full input price. The card shows what the next message pays for that and what it would pay the other way. Switching model or compacting makes it cold.
- **Advisor:** once the advisor tool has been used, a card with its model, calls, tokens and cost, and a bar for its share of the session's cost. Advice your agents asked for counts too, with its own `agents` row, and each agent's card shows the advice it asked for.
- **Agents:** a card per subagent in this session: what it was asked, its model and effort, tokens, cost and time, and its prompt cache's countdown, with Claude's animation while it works. **■ Stop** on a running agent's card stops it once you press it again (**■ Confirm**), a red line running round the card as it stops, and **✕ dismiss** slides a finished one out of the panel; finished agents leave the same way on their own a minute after they end, and come back if Claude resumes them. A finished agent's cache countdown is dimmed and reads "if resumed": it is how long a resume would still find its prompt cached. Click an agent's name to watch its transcript in the main view, and **‹ main conversation** at the top of the panel to go back. With statusbox on, Claude Code's own agent rows under the prompt are hidden, since the panel shows them; a `subagentStatusLine` of your own in `settings.json` takes precedence.

**Keys:** `ctrl+x ←` and `ctrl+x →` widen and narrow it, `ctrl+x x` closes it. Once you click a header, Return folds and opens it. Once closed it stays closed until you open it again.

Claude Code docks panels on the right, and only in fullscreen mode at 110 columns or wider; a plugin can't move it to the left.

## Alert sounds

A sound for the moments you'd otherwise miss.

| Event | When |
|-------|------|
| Permission request | Claude is waiting for your approval |
| Finished | Claude finishes responding. Not while a subagent it's waiting on is still running. |
| Compaction start / done | Context compaction begins or ends |
| Context high | Context usage reaches 70%, once until it drops below again |
| Rate limit | 5-hour or 7-day usage reaches 80%, once for each until it resets |

| Platform | Sounds |
|----------|--------|
| Windows | Built in (Windows Media sounds) |
| macOS | `afplay` with the system sounds |
| Linux | `paplay`, `ffplay` or `ogg123` with the freedesktop sounds |

## Settings

In `/config`, under statusbox:

| Setting | Default | |
|---------|---------|---|
| Alert sounds | on | |
| Context alert (%) | 70 | 0 turns it off |
| Rate limit alert (%) | 80 | 0 turns it off |
| Skin the chat history | on | With a statusbox theme, draws the chat in its colours too |
| Paint the terminal background | on | With a statusbox theme, sets the terminal's background to its colour |

**Themes.** statusbox adds fourteen themes to `/theme`: Tokyo Night and Tokyo Day, Dracula and Alucard, Catppuccin Mocha and Latte, Gruvbox Dark and Light, Nord and Nord Light, Noir and Noir Light (black and white, with red only for danger), and Mono and Mono Light (greys only). Picking one paints everything in its palette: Claude Code's own text, inline code, diffs, prompt border and spinner, plus the box, the side panel, the chat history and the terminal's background. With any other theme, Claude Code's own included, statusbox keeps its classic look, in your terminal theme's colours. Switching theme repaints at once. Claude Code reads the themes as it starts, so after installing or updating statusbox, restart it to see them.

With a statusbox theme, statusbox draws the chat history too, in the terminal. Each tool call gets a row in its kind's colour: reads, edits, shell commands, web, agents and MCP tools. The row shows what it acted on, the lines an edit adds and removes, and how long it took. Your prompts sit in a rounded outline, and Claude's replies open on the skin's bullet, with tables drawn as banded cards. Tool output, grouped calls and the text inside a reply keep Claude Code's own drawing, in the skin's theme. Turn **Skin the chat history** off to leave the chat to Claude Code.

**The background.** Claude Code draws on your terminal's own background, which no theme can change. So with a statusbox theme, statusbox sets the terminal's background to the theme's while Claude Code runs, and puts yours back when you exit. This works on macOS and Linux, in terminals that take the OSC 11 escape sequence: VS Code's, iTerm2, Ghostty, kitty and WezTerm. Apple Terminal ignores it. If Claude Code crashes, the colour stays until you open a new terminal or run `printf '\e]111\a'` in that one.

On Windows, or in a terminal that ignores it, set the background yourself. In VS Code, add this to `settings.json`, with your theme's colour from the table below:

```json
"workbench.colorCustomizations": { "terminal.background": "#1a1b26" }
```

| Dark theme | Background | Light theme | Background |
|------------|------------|-------------|------------|
| Tokyo Night | `#1a1b26` | Tokyo Day | `#e1e2e7` |
| Dracula | `#282a36` | Alucard | `#fffbeb` |
| Catppuccin Mocha | `#1e1e2e` | Catppuccin Latte | `#eff1f5` |
| Gruvbox Dark | `#282828` | Gruvbox Light | `#fbf1c7` |
| Nord | `#2e3440` | Nord Light | `#eceff4` |
| Noir | `#0a0a0a` | Noir Light | `#ffffff` |
| Mono | `#1c1c1c` | Mono Light | `#f2f2f2` |

## Troubleshooting

**Nothing shows.** Run `/plugin` and check statusbox is installed and enabled, and that `claude --version` is 2.1.299 or later. A hook that fails shows a dim `statusbox: …` line in the transcript; `claude --debug` writes the full reason to the debug log.

**A skin's colours look washed out.** VS Code's terminal shifts colours to keep them readable (`terminal.integrated.minimumContrastRatio`, 4.5 by default). Set it to 1 to see the skin's own colours.

**The screen is garbled.** Resizing the terminal redraws it. For a key that does the same, bind Claude Code's `app:redraw` (it has none by default) in `~/.claude/keybindings.json`:

```json
{ "bindings": [{ "context": "Global", "bindings": { "ctrl+x r": "app:redraw" } }] }
```

**The box is gone but the plugin is enabled.** `ctrl+x ctrl+a` hides it; press it again.

**The side panel doesn't appear.** It needs fullscreen mode and 110 columns or more. `/sidebar` says so when it can't place the panel.

**No sounds.** Check the setting above, your system volume, and on Linux that one of `paplay`, `ffplay` or `ogg123` is installed.

## How it works

statusbox is a Claude Code plugin made of function hooks: the box, the panel and the alerts react to the engine's own events (each request, each turn, compaction, permission prompts) instead of running a program on every refresh. The box draws above the prompt through `ui.render`, the panel is a docked `Pane`, and the animations are small client modules the terminal runs locally.

It reads only what Claude Code already writes: the session's transcript, once at start and again after a turn that used the advisor, and an agent's transcript after it used the advisor. After each turn it runs `git` for the repo row. It makes no network calls, and the cost figures are Claude Code's own.

This repository was `claude-statusline`, a Rust binary; that version is at [v1.0.0-rc.2](https://github.com/axlaser/statusbox/tree/v1.0.0-rc.2).

## License

MIT. The Claude icon in `assets/` is from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Claude_AI_symbol.svg) (public domain).
