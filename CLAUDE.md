# CLAUDE.md -- pitwall

A Claude Code plugin made of function hooks: a live status box above the prompt, a docked side panel (rate-limit usage, the session and its cost, the prompt cache, the advisor, agents), an open button for pasted images, and alert sounds. The repository is also its own marketplace, so `/plugin install pitwall --marketplace axlaser/pitwall` installs it from `master`.

## Project Structure

```
.claude-plugin/plugin.json       the manifest: name, version, the types contract, userConfig (the /config rows)
.claude-plugin/marketplace.json  makes the repo a marketplace; its one entry's source is the repo root
hooks/hooks.json                 names the one hooks module
settings.json                    the plugin's default settings: a subagentStatusLine that hides Claude Code's own agent rows under the prompt
hooks/register.tsx               the hooks module: every event hook, the box (AbovePrompt) and the panel (Pane)
hooks/notify.ts                  alert sounds: one child process per alert, per OS
hooks/skin.ts                    the palette (every colour the box and the panel paint in, by what it means) and the skins that fill it
hooks/history.tsx                the chat history in a skin's colours: a tool call's row, the person's prompt, a reply block and its tables as cards
hooks/ground.ts                  the terminal's own background and text colour in the skin's: OSC 11 and 10 to Claude Code's terminal device, OSC 111 and 110 to put them back
themes/                          each skin's Claude Code themes, <skin>-<dark|light>.json, made from skin.ts (see Development)
hooks/bar.tsx, claude.tsx, count.tsx, fold.tsx, split.tsx, chevron.tsx, chip.tsx, pill.tsx, wire.tsx   Client modules the terminal runs locally (the bars, the working animation, the rolling figures, the panel's folding headers, the cost split, the sidebar chip's chevron, the model and effort chips (words and chevron, one glow over both), the picker's choices, the picker's wire; count.tsx also holds the number formatters, split.tsx `apportion`)
hooks/glow.ts, turn.ts           what the Clients share: the glow that sweeps a working figure and its colour arithmetic; a chevron's quarter turn
types/index.d.ts                 the $.state contract: every value the module keeps, declared under PluginState
tests/pitwall.test.ts            the one test file, run by `claude plugin test .`
.github/workflows/ci.yml         validate and test on Linux, macOS and Windows for every push and PR, and refuse `onPointer` under hooks/
.claude/skills/, .claude/agents/ the repo skills (commit, sync, pr, no-comments) and no-comments' comment-sicko agent
assets/                          README screenshots
```

`.claude-plugin/types/` is written by the engine whenever it loads the plugin (the full API, about 14,000 lines with doc comments) and is gitignored; `tsconfig.json` extends the one it writes there. Grep it for an event or noun before guessing at the API.

## Architecture

Events write atoms; the one `AbovePrompt` render hook reads them; a write redraws exactly the readers. Nothing runs per refresh: the 1-second clock only advances `now` and, in a session that started empty, asks for the turn count until its conversation arrives.

Where each figure comes from:

- **Context, cost, rate limits:** `session.measure` and `$.session.usage()` (refreshed after every main-loop request in `turn.step`, and as each `api_request` record lands, so an agent's or a background request's cost reaches the total with its spend). The cost card never counts its total below the spend it splits. The rate windows come with a response, so until a session's first one the last reading `session.measure` kept in `$.store` (`rate`) stands in, a window past its reset at 0%.
- **Token totals and prompt count:** the transcript, read once at `session.start` (streamed through `findstr`/`cat` past 4 MiB), then each main-loop `turn.step`'s usage as it lands. A session the background daemon runs (the agent view's) starts the plugin before its conversation arrives: then the read waits until `$.session.turns()` is above zero. A `/resume`, `/clear` or fork goes on in the same process under another session: the engine drops every plugin value as the last one ends and raises no `session.start` for the next, so `classic.SessionStart` seeds it again (`seedSession`).
- **Advisor:** only the transcript records advisor iterations, so it is re-read as soon as a response that consulted it is whole (`turn.step`), and once more as that turn ends. An agent's response that consulted it reads that agent's own transcript (`<session>/subagents/agent-<id>.jsonl`, beside the session's) the same way into `agentAdvisor`, kept after the agent leaves the panel: the agent's card shows it, the advisor card adds it to its totals with an `agents` row, and the cost split moves those dollars from agents to the advisor.
- **Spend:** `telemetry.log` on the collector stream, `api_request.cost_usd`, classified by `query_source` the way the engine does.
- **Agents:** `$.agent.list()` plus each agent's `turn.step` usage (its calls, as the advisor's card counts them, tokens in and out, cache read and written, and its last prompt as its context); its cost, and its prompt cache's lifetime (the record's 5m/1h split; its last step's send starts the card's countdown), come from its `api_request` record, matched by the four token counts. A press on an agent's name puts its transcript in the main view (`$.ui.view`), and the panel draws for the view in force (`e.props.view`): the agent's card says so and a row leads back to the main conversation. A finished agent the view refuses loses the press. Claude Code drops a finished agent's task some seconds after it ends and raises nothing, so `refreshAgents` keeps one the list no longer holds (a running one as `completed`) until it has been finished a minute (`LINGER_MS`); while the list holds an agent not in `gone`, or the panel holds any, it asks `$.agent.list()` every 5 s, writing only when an id, status or `doneAt` changed. Refreshes run one at a time (`syncQueue`): two agents starting together each refresh, and a list read before the other's write must not land after it and mark the newer agent finished. An agent past its minute or dismissed from its card first slides out and rolls shut (`drop-<id>`, `leaving`), then goes into `gone` and stays out while Claude Code lists it finished; the poll does not wait on one leaving. One Claude Code lists running again (resumed, through SendMessage) leaves `gone` and slides back in. A finished card's cache row is muted and reads "if resumed": a resume within it reads the agent's prompt from the cache. No plugin API stops an agent, so a running card's stop calls the built-in `TaskStop` through `$.tool.call` with a `consent` naming the press; it takes two presses, the first arming it (`stopArmed`) for 4 s. The second starts a red fuse round the card's border (`halt-<id>`) and marks the agent `halting` until the list says it ended, the card red once the fuse is round; a refusal, an error or no such tool drains the fuse back and is a toast. The panel replaces Claude Code's own agent rows under the prompt: `settings.json` ships a `subagentStatusLine` (one of the two keys a plugin's settings may set, and the lowest layer, so the person's own wins) whose command answers each task's id with `"content": ""`, which drops its row; with none left the list goes. It needs `grep` and `sed` on the shell Claude Code runs it in; without them the command fails and the rows stay. `$.ui.view` still opens an agent whose row is hidden.
- **Auto mode:** the `tool_decision` records on the collector stream, counted by their `classifier_verdict` (`allow`, `block`). An `unavailable` or `no_verdict` verdict ends in a permission prompt, which the permission alert already covers.
- **Pasted images:** `prompt.edit` for any edit while the draft holds an `[Image #`, before or after it, with the text its chain resolved to, and `prompt.change` for every other change to the box (a recalled entry, a clear, an undo, a fill). Only an edit or the engine's own write reads the clipboard; each capture is kept by its number, so a placeholder that comes back through an undo or a recall gets its button without a second read, and a capture that lands after its placeholder went shows nothing.
- **Prompt cache:** the `cache_creation_5m_tokens`/`cache_creation_1h_tokens` of each main-loop `api_request` record (its life restarts with every request that reads or writes it, counted from the request's start as the API counts it: the record's arrival less its `duration_ms`), seeded from the transcript's last main-loop row at session start, and until either the card says nothing is cached yet; `classic.PostModelSwitch` and `classic.PostCompact` make it cold.
- **Transcript size:** `$.fs.stat` of the transcript as the session seeds and after each main-loop turn.
- **Model picker:** the choices are `$.config.list()`'s `model` row, named from the `main` rows of the model catalog Claude Code caches in `cache/model-catalog/` (read when the picker opens); a pick is `$.config.set({ key: 'model' })`, as `/config` sets it. The effort picker's pick runs `/effort <level>`, so Claude Code's own setting is it, and rides each request through `turn.step` until the engine's effort is it: a command waits for a running turn to end. A model switch (`classic.PostModelSwitch`, and the picker's) and a `/effort` the person runs take the level Claude Code keeps for that model from settings (`modelSettings`, then `effortLevel`).
- **Folded panel sections:** the `folded` atom, kept in `$.store` too and read back at `session.start`.
- **Folds in motion:** the `motion` atom, the box's picker (`menu`) or a panel section's body (`fold-<NAME>`) a row nearer open or shut, the room a picker's row makes for its confirm (`menu-room`) a cell, an agent's card (`drop-<id>`) a step nearer gone, its fuse (`halt-<id>`) a step further round, and the panel's contents (`panel`) a step nearer in from its right edge or out, an edge of the panel's own riding their left side since Claude Code's dock edge cannot move (`$.ui.close` once they are out, before the motion is dropped), each 24 ms beat of a ticker that runs only while one moves. The motion is written before the atom it animates (`menu`, `folded`), through `animate`: each write redraws, and the other order draws one frame of the end state first. A picker's wire and pills move on the terminal's clock; folding, they go out for `CLOSE_MS` before its rows roll shut. A section's body is a list of rows, a blank row for each gap, and its `rows` is that list's length plus its border (`card`), so a row added to a body is counted. A held body keeps its own height (`flexShrink={0}`) and is cut: a box squeezed below its border draws it over the rows above.
- **Box width:** the box fits `e.props.bodyColumns`, the main column less Claude Code's five: a row's content gets that less 17 (the caps, the borders and the label column), and `fit` takes the first of its versions that fits. The model row's bar shrinks from 30 to 10 first, sized against the full row so it never grows back as the row drops `used/window`, shortens `xhigh effort ▾` to `xhigh ▾` and closes its gaps; then the bar goes, and last the Claude animation. It measures with the working animation's width either way, so starting work does not reflow it. The tokens row drops its zero deltas, then every delta, then cache written, then cache read; the repo row shortens its path a segment at a time (`.../`), then cuts the branch and drops the git counts and `SIDEBAR` (its chevron is a Button of its own). A picker's pills wrap in the room that leaves, and its wire, which runs only to the first row of pills, is not drawn for a pick below it.
- **Panel width:** the panel is laid out for `e.props.bodyColumns`, which the person's drag or `ctrl+x ←`/`→` of the dock decides (the 40 it opens with is a request), never below 16. Each row of a card stays one line inside it, since a card's `rows` counts its `lines`: `pick` takes the first of a row's versions that fits, the full one first, so a row gives up its wording and its lesser figures before its padding, and its label last; a box of figures never shrinks, and `spread` keeps its right side whole and lets its left label truncate. An agent's grid stacks to a pair a row once a pair outgrows half the card, its title drops the elapsed time, and its cache row drops `if resumed`, then its bar: a Client of negative width makes the engine refuse the whole panel.
- **Skin:** Claude Code's theme picks it. The `skin` and `isLight` atoms come from the `theme` row as each session seeds, and from its `config.set`. A theme of pitwall's own (`themes/`, named `custom:pitwall:<skin>-<dark|light>`, read by `skinOfTheme`) gives its skin; any other gives classic. Both render hooks take the palette `P` from them (`paint`) and hand it to every helper that builds a span; a colour is a slot of `P`, never a literal, and a Client takes the colours it paints in as props, each with classic's as its fallback. `themeOf` makes each skin's two themes from its palettes. There is no skin option: `$.config.set` takes only Claude Code's built-in themes, so an option could not turn a skin's theme on, and two switches that disagree confused people.
- **Terminal colours:** ground.ts. The `AbovePrompt` hook on the terminal asks for the skin's `bg` and `text`, or null for classic or with the `grounded` toggle off. Only a change starts a child, from a `$.clock.after` timer that waits out the redraw a theme switch makes (`SETTLE_MS`): a write from another process landing inside Claude Code's frame splits one of its sequences, and no plugin can ask for the full redraw that would repair it. That child (`/bin/sh`) writes OSC 10 and 11 to the terminal device of the first forebear that has one, found once with `ps`; on Windows, PowerShell attaches to Claude Code's console (its parent) and writes them there. The text colour goes with the background because a reply drawn through `Markdown` takes the terminal's own foreground: a light skin over a dark profile would draw it pale. The sequences on the terminal are also the `ground` atom, so a reloaded module knows them. `session.end` puts the terminal's own back unless the process goes on (`clear`, `resume`), and `classic.SessionStart` writes the atom again after one.
- **Chat history:** `ui.render` hooks on `ToolUse`, `UserMessage` (the composer's) and `AssistantMessage` draw history.tsx's rows on the terminal while a skin other than classic is on and the `chatSkinned` toggle allows; otherwise `next(e)`, Claude Code's own drawing (tool results, groups and other prompts always are). A tool row's time comes from the `took` atom, which the `tool.call` hook fills from its call to its answer. A row hook reads atoms only: it fires per transcript row.
- **Alerts:** `classic.PermissionRequest`, `classic.Stop`, `classic.PreCompact`, `classic.PostCompact`, and threshold checks in `session.measure`.

## Development

```
claude plugin validate .          # manifest, marketplace, module scan: what the engine would refuse
claude plugin test .              # the test file against the engine itself
tsc -p .                          # once the engine has written .claude-plugin/types/
claude --plugin-dir .             # a session with this checkout loaded and watched for edits
```

All three checks are gates on every commit, and CI runs the first two on Linux, macOS and Windows. The repo installs no TypeScript (there is no package.json): without a global `tsc`, run `npx -y -p typescript tsc -p .`.

- **One test file.** `tests/pitwall.test.ts`; a behaviour with a branch gets a test there. Write UI tests once and loop them over `['terminal', 'desktop']`. The kit answers an event with the first `on` registered for it, so a shared mock (`engine`, `mockSession`) takes options rather than being registered over.
- `claude --debug` logs every hook failure and every tree the engine refused. In a session that hot-reloads the plugin, the transcript also gets one dim `pitwall: …` line per failure.
- A render hook is pure: a value written from it, or from any promise it started, is refused (`state.set: denied`). Work it starts that writes a value goes through a `$.clock.after` timer (ground.ts).
- `themes/` is made from skin.ts; after changing a palette or `themeOf`, make it again (Node 23.6 or later): `node -e "import('./hooks/skin.ts').then(({ SKINS, themeOf }) => { for (const [skin, pair] of Object.entries(SKINS)) for (const light of [false, true]) { const t = themeOf(light ? pair.light : pair.dark, light); if (t) require('fs').writeFileSync('themes/' + skin + (light ? '-light' : '-dark') + '.json', JSON.stringify(t, null, 2) + '\n') } })"`. A test cannot read files, so nothing checks the two agree. Claude Code reads a plugin's themes as it starts: `/reload-plugins` leaves them as they were, so see a change in a new session. `settings.json` too.
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

- An atom must be declared (`atom({ plugin: 'pitwall', key })`) in the same file that reads or writes it. Two files may declare the same key.
- Every key is declared in `types/index.d.ts`. Renaming one drops a running session's value on reload.

### Platform branches are confined

`OS === 'Windows_NT'` and friends appear only in: the clipboard capture (Windows only), the transcript stream (`findstr` against `cat`), the URL opener, the terminal background's writer (PowerShell against `sh`), and `hooks/notify.ts`. A branch anywhere else is a design error: decide the behaviour once instead. Where the background's writer finds no terminal to write to, its write fails and nothing changes.

### Performance

- No subprocess on the 1-second clock or in a hook that fires per request. `git` runs once after a turn (debounced). The one child a render hook starts is the terminal background's, and only when the colour it asks for changes.
- The transcript is read as a session seeds (at start, once a background session's conversation arrives, after a `/resume` or `/clear`) and after a response that consulted the advisor only; an agent's own transcript only after one of its responses that consulted the advisor.
- A Client module's timer changes nothing once it has settled, so an idle box never redraws. The one exception is an open picker's choices: their hover layers loop, hidden, and the picked one's loop shows, for as long as the picker stays open. The hooks module's fold ticker cancels itself once nothing moves.

### Clicks are Buttons

A Client module never calls `surface.onPointer`; CI fails on the name anywhere under `hooks/`. While a Client with a pointer listener is drawn, Claude Code switches the whole terminal's mouse reports to pixels (DECSET 1016) and turns them back into cells by the cell size the terminal reports; VS Code's terminal rounds that to a whole pixel, so every hover, click and selection on screen drifts off what is drawn, further the further right and down. A Client that takes a click draws a `Button` whose `onPress` posts, and lights under the pointer with `hover` props. A Text inside a Button follows a hover group but cannot light it, so the Button carries the `scope`. Nothing tells a Client the pointer has arrived, so to play something under it, it draws a layer the hover group reveals (`position: absolute`, `display: none`, `hover: { display: 'flex' }`), a Button too: the hit test finds the topmost child, so the layer takes the click (pill.tsx). The layer draws itself lit (`inverse`) rather than waiting on the pointer's inversion, which reaches a newly revealed Button a beat late, and a control already lit draws none: either way the handover flickers.

### Untrusted text stays data

Paths and sound names reach a child process as argv items or environment variables, never inside script text. The Windows scripts are constant strings that read `$env:`.

### Repo Skills and Branching

- Two-tier flow: feature branches are `dev-<feature>`, PR'd into `dev`; `dev` is released into `master` by a release PR. **Merging into `master` publishes**: it is what `/plugin install` and `claude plugin update` fetch. Bump the version in `.claude-plugin/plugin.json` in the release PR.
- Every commit, sync, and pull request goes through the repo-local skills (`commit`, `sync`, `pr`), never hand-written `git commit`, `git merge`, or `gh pr create`.
- Never create a new branch without asking the user first, using `AskUserQuestion` when available. This applies even when a plan, skill, or workflow suggests a branch.

### Never Commit

- A hardcoded absolute personal path (`/Users/<name>/...`, `C:\Users\<name>\...`). The plugin runs on other people's machines.
- A debug log, a scratch script, or `.claude-plugin/types/`.
