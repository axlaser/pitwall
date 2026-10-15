# CLAUDE.md -- statusbox

A Claude Code plugin made of function hooks: a live status box above the prompt, a docked side panel (rate-limit usage, the session and its cost, the prompt cache, the advisor, agents), an open button for pasted images, and alert sounds. The repository is also its own marketplace, so `/plugin install statusbox --marketplace axlaser/statusbox` installs it from `master`.

## Project Structure

```
.claude-plugin/plugin.json       the manifest: name, version, the types contract, userConfig (the /config rows)
.claude-plugin/marketplace.json  makes the repo a marketplace; its one entry's source is the repo root
hooks/hooks.json                 names the one hooks module
hooks/register.tsx               the hooks module: every event hook, the box (AbovePrompt) and the panel (Pane)
hooks/notify.ts                  alert sounds: one child process per alert, per OS
hooks/skin.ts                    the palette (every colour the box and the panel paint in, by what it means) and the skins that fill it
hooks/history.tsx                the chat history in a skin's colours: a tool call's row, the person's prompt, a reply block and its tables as cards
hooks/ground.ts                  the terminal's own background in the skin's: OSC 11 to Claude Code's terminal device, OSC 111 to put it back
themes/                          each skin's Claude Code themes, <skin>-<dark|light>.json, made from skin.ts (see Development)
hooks/bar.tsx, claude.tsx, count.tsx, fold.tsx, split.tsx, chevron.tsx, chip.tsx, pill.tsx, wire.tsx   Client modules the terminal runs locally (the bars, the working animation, the rolling figures, the panel's folding headers, the cost split, the sidebar chip's chevron, the model and effort chips (words and chevron, one glow over both), the picker's choices, the picker's wire; count.tsx also holds the number formatters, split.tsx `apportion`)
types/index.d.ts                 the $.state contract: every value the module keeps, declared under PluginState
tests/statusbox.test.ts          the one test file, run by `claude plugin test .`
assets/                          README images
```

`.claude-plugin/types/` is written by the engine whenever it loads the plugin (the full API, about 14,000 lines with doc comments) and is gitignored; `tsconfig.json` extends the one it writes there. Grep it for an event or noun before guessing at the API.

## Architecture

Events write atoms; the one `AbovePrompt` render hook reads them; a write redraws exactly the readers. Nothing runs per refresh: the 1-second clock only advances `now`, checks the prompt for a newly pasted image, and, in a session that started empty, asks for the turn count until its conversation arrives.

Where each figure comes from:

- **Context, cost, rate limits:** `session.measure` and `$.session.usage()` (refreshed after every main-loop request in `turn.step`).
- **Token totals and prompt count:** the transcript, read once at `session.start` (streamed through `findstr`/`cat` past 4 MiB), then each main-loop `turn.step`'s usage as it lands. A session the background daemon runs (the agent view's) starts the plugin before its conversation arrives: then the read waits until `$.session.turns()` is above zero. A `/resume`, `/clear` or fork goes on in the same process under another session: the engine drops every plugin value as the last one ends and raises no `session.start` for the next, so `classic.SessionStart` seeds it again (`seedSession`).
- **Advisor:** only the transcript records advisor iterations, so it is re-read as soon as a response that consulted it is whole (`turn.step`), and once more as that turn ends.
- **Spend:** `telemetry.log` on the collector stream, `api_request.cost_usd`, classified by `query_source` the way the engine does.
- **Agents:** `$.agent.list()` plus each agent's `turn.step` usage; its cost is matched to its `api_request` record by the four token counts.
- **Prompt cache:** the `cache_creation_5m_tokens`/`cache_creation_1h_tokens` of each main-loop `api_request` record (its life restarts with every request), seeded from the transcript's last main-loop row at session start; `classic.PostModelSwitch` and `classic.PostCompact` make it cold.
- **Transcript size:** `$.fs.stat` of the transcript as the session seeds and after each main-loop turn.
- **Model picker:** the choices are `$.config.list()`'s `model` row, named from the `main` rows of the model catalog Claude Code caches in `cache/model-catalog/` (read when the picker opens); a pick is `$.config.set({ key: 'model' })`, as `/config` sets it. The effort picker's pick rides each request through `turn.step`.
- **Folded panel sections:** the `folded` atom, kept in `$.store` too and read back at `session.start`.
- **Folds in motion:** the `motion` atom, the box's picker (`menu`) or a panel section's body (`fold-<NAME>`) a row nearer open or shut, the room a picker's row makes for its confirm (`menu-room`) a cell, and the panel's contents (`panel`) a step nearer in from its right edge or out, an edge of the panel's own riding their left side since Claude Code's dock edge cannot move (`$.ui.close` once they are out, before the motion is dropped), each 24 ms beat of a ticker that runs only while one moves. The motion is written before the atom it animates (`menu`, `folded`): each write redraws, and the other order draws one frame of the end state first. A picker's wire and pills move on the terminal's clock; folding, they go out for `CLOSE_MS` before its rows roll shut. A section's height comes from its `rows`, counted from what builds its body: a body that gains a row must count it. A held body keeps its own height (`flexShrink={0}`) and is cut: a box squeezed below its border draws it over the rows above.
- **Skin:** Claude Code's theme picks it. The `skin` and `isLight` atoms come from the `theme` row as each session seeds, and from its `config.set`. A theme of statusbox's own (`themes/`, named `custom:statusbox:<skin>-<dark|light>`, read by `skinOfTheme`) gives its skin; any other gives classic. Both render hooks set the module's palette `P` from them before they build a span; a colour is a slot of `P`, never a literal, and a Client takes the colours it paints in as props, each with classic's as its fallback. `themeOf` makes each skin's two themes from its palettes. There is no skin option: `$.config.set` takes only Claude Code's built-in themes, so an option could not turn a skin's theme on, and two switches that disagree confused people.
- **Terminal background:** ground.ts. The `AbovePrompt` hook on the terminal asks for the skin's `bg`, or null for classic or with the `grounded` toggle off. Only a change starts a child, from a `$.clock.after` timer that waits out the redraw a theme switch makes (`SETTLE_MS`): a write from another process landing inside Claude Code's frame splits one of its sequences, and no plugin can ask for the full redraw that would repair it. That child (`/bin/sh`) writes OSC 11 to the terminal device of the first forebear that has one, found once with `ps`; on Windows, PowerShell attaches to Claude Code's console (its parent) and writes it there. The colour on the terminal is also the `ground` atom, so a reloaded module knows it. `session.end` puts the terminal's own back unless the process goes on (`clear`, `resume`), and `classic.SessionStart` writes the atom again after one.
- **Chat history:** `ui.render` hooks on `ToolUse`, `UserMessage` (the composer's) and `AssistantMessage` draw history.tsx's rows on the terminal while a skin other than classic is on and the `chatSkinned` toggle allows; otherwise `next(e)`, Claude Code's own drawing (tool results, groups and other prompts always are). A tool row's time comes from the `took` atom, which the `tool.call` hook fills from its call to its answer. A row hook reads atoms only: it fires per transcript row.
- **Alerts:** `classic.PermissionRequest`, `classic.Stop`, `classic.PreCompact`, `classic.PostCompact`, and threshold checks in `session.measure`.

**"The binary" and file names like `render.rs`, `src/subagent.rs` or `src/notify_state.rs` in comments mean the Rust implementation this plugin replaced.** It was deleted on `dev-claude-plugin`; `67f0e5b` on `dev` (and the `v1.0.0-rc.2` tag) is its final state. Those comments explain why a threshold, a rule or a wording is what it is; keep them.

## Development

```
claude plugin validate .          # manifest, marketplace, module scan: what the engine would refuse
claude plugin test .              # the test file against the engine itself
tsc -p .                          # once the engine has written .claude-plugin/types/
claude --plugin-dir .             # a session with this checkout loaded and watched for edits
```

All three checks are gates on every commit, and CI runs the first two on Linux, macOS and Windows.

- **One test file.** `tests/statusbox.test.ts`; a behaviour with a branch gets a test there. Write UI tests once and loop them over `['terminal', 'desktop']`.
- `claude --debug` logs every hook failure and every tree the engine refused. In a session that hot-reloads the plugin, the transcript also gets one dim `statusbox: …` line per failure.
- A render hook is pure: a value written from it, or from any promise it started, is refused (`state.set: denied`). Work it starts that writes a value goes through a `$.clock.after` timer (ground.ts).
- `themes/` is made from skin.ts; after changing a palette or `themeOf`, make it again (Node 23.6 or later): `node -e "import('./hooks/skin.ts').then(({ SKINS, themeOf }) => { for (const [skin, pair] of Object.entries(SKINS)) for (const light of [false, true]) { const t = themeOf(light ? pair.light : pair.dark, light); if (t) require('fs').writeFileSync('themes/' + skin + (light ? '-light' : '-dark') + '.json', JSON.stringify(t, null, 2) + '\n') } })"`. A test cannot read files, so nothing checks the two agree. Claude Code reads a plugin's themes as it starts: `/reload-plugins` leaves them as they were, so see a change in a new session.
- On a reload the Client modules swap in a beat before the hooks module, so a Client runs once on the props the old hooks module drew it with. A new prop needs a fallback: a Client that throws stays unmounted past the reload, the plugin's name drawn in its place.

## Rules

These apply to every task unless explicitly overridden. Bias: caution over speed on non-trivial work.

### A hook never breaks the session

A hook that throws is skipped and the box simply stops updating, with nothing on screen to say why. So:

- Every hook calls `next(e)` and returns what it resolves to, unless it means to answer for the engine.
- Work started off the hook's path (`void …`) carries its own `.catch`: an unhandled rejection is still a failure.
- Child processes are bounded with `timeoutMs`, and a missing tool means a missing feature, never an error.
- A hook that refuses something (a guard) gets a `.catch` that refuses when the hook fails. The rest need none: a failing one is skipped and the event goes on, so the validator's "gating hook without .catch" lines for them are expected.

### The state scanner's rules

The engine lists every `$.state` key a module reads and writes, and refuses a module it cannot list:

- An atom must be declared (`atom({ plugin: 'statusbox', key })`) in the same file that reads or writes it. Two files may declare the same key.
- Every key is declared in `types/index.d.ts`. Renaming one drops a running session's value on reload.

### Platform branches are confined

`OS === 'Windows_NT'` and friends appear only in: the clipboard capture (Windows only), the transcript stream (`findstr` against `cat`), the URL opener, the terminal background's writer (PowerShell against `sh`), and `hooks/notify.ts`. A branch anywhere else is a design error: decide the behaviour once instead. Where the background's writer finds no terminal to write to, its write fails and nothing changes.

### Performance

- No subprocess on the 1-second clock or in a hook that fires per request. `git` runs once after a turn (debounced). The one child a render hook starts is the terminal background's, and only when the colour it asks for changes.
- The transcript is read as a session seeds (at start, once a background session's conversation arrives, after a `/resume` or `/clear`) and after a response that consulted the advisor only.
- A Client module's timer changes nothing once it has settled, so an idle box never redraws. The one exception is an open picker's choices: their hover layers loop, hidden, and the picked one's loop shows, for as long as the picker stays open. The hooks module's fold ticker cancels itself once nothing moves.

### Clicks are Buttons

A Client module never calls `surface.onPointer`. While a Client with a pointer listener is drawn, Claude Code switches the whole terminal's mouse reports to pixels (DECSET 1016) and turns them back into cells by the cell size the terminal reports; VS Code's terminal rounds that to a whole pixel, so every hover, click and selection on screen drifts off what is drawn, further the further right and down. A Client that takes a click draws a `Button` whose `onPress` posts, and lights under the pointer with `hover` props. A Text inside a Button follows a hover group but cannot light it, so the Button carries the `scope`. Nothing tells a Client the pointer has arrived, so to play something under it, it draws a layer the hover group reveals (`position: absolute`, `display: none`, `hover: { display: 'flex' }`), a Button too: the hit test finds the topmost child, so the layer takes the click (pill.tsx). The layer draws itself lit (`inverse`) rather than waiting on the pointer's inversion, which reaches a newly revealed Button a beat late, and a control already lit draws none: either way the handover flickers.

### Untrusted text stays data

Paths and sound names reach a child process as argv items or environment variables, never inside script text. The Windows scripts are constant strings that read `$env:`.

### Repo Skills and Branching

- Two-tier flow: feature branches are `dev-<feature>`, PR'd into `dev`; `dev` is released into `master` by a release PR. **Merging into `master` publishes**: it is what `/plugin install` and `claude plugin update` fetch. Bump the version in `.claude-plugin/plugin.json` in the release PR.
- Every commit, sync, and pull request goes through the repo-local skills (`commit`, `sync`, `pr`), never hand-written `git commit`, `git merge`, or `gh pr create`.
- Never create a new branch without asking the user first, using `AskUserQuestion` when available. This applies even when a plan, skill, or workflow suggests a branch.

### Never Commit

- A hardcoded absolute personal path (`/Users/<name>/...`, `C:\Users\<name>\...`). The plugin runs on other people's machines.
- A debug log, a scratch script, or `.claude-plugin/types/`.
