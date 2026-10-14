# CLAUDE.md -- statusbox

A Claude Code plugin made of function hooks: a live status box above the prompt, a docked side panel of agents, pasted-image previews, and desktop notifications. The repository is also its own marketplace, so `/plugin install statusbox --marketplace axlaser/statusbox` installs it from `master`.

## Project Structure

```
.claude-plugin/plugin.json       the manifest: name, version, the types contract, userConfig (the /config rows)
.claude-plugin/marketplace.json  makes the repo a marketplace; its one entry's source is the repo root
hooks/hooks.json                 names the one hooks module
hooks/register.tsx               the hooks module: every event hook, the box (AbovePrompt) and the panel (Pane)
hooks/notify.ts                  desktop alerts: one child process per alert, per OS
hooks/bar.tsx, claude.tsx, effort.tsx, count.tsx   Client modules the terminal runs locally (the bar, the working animation, the effort chip, the rolling figures; count.tsx also holds the number formatters)
types/index.d.ts                 the $.state contract: every value the module keeps, declared under PluginState
tests/statusbox.test.ts          the one test file, run by `claude plugin test .`
assets/                          README images
```

`.claude-plugin/types/` is written by the engine whenever it loads the plugin (the full API, about 14,000 lines with doc comments) and is gitignored; `tsconfig.json` extends the one it writes there. Grep it for an event or noun before guessing at the API.

## Architecture

Events write atoms; the one `AbovePrompt` render hook reads them; a write redraws exactly the readers. Nothing runs per refresh: the 1-second clock only advances `now` and checks the prompt for a newly pasted image.

Where each figure comes from:

- **Context, cost, rate limits:** `session.measure` and `$.session.usage()` (refreshed after every main-loop request in `turn.step`).
- **Token totals and prompt count:** the transcript, read once at `session.start` (streamed through `findstr`/`cat` past 4 MiB), then `turn.complete` usage.
- **Advisor:** only the transcript records advisor iterations, so it is re-read after a turn that consulted one.
- **Spend:** `telemetry.log` on the collector stream, `api_request.cost_usd`, classified by `query_source` the way the engine does.
- **Agents:** `$.agent.list()` plus each agent's `turn.step` usage; its cost is matched to its `api_request` record by the four token counts.
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

`OS === 'Windows_NT'` and friends appear only in: the clipboard capture (Windows only), the transcript stream (`findstr` against `cat`), the URL opener, and `hooks/notify.ts`. A branch anywhere else is a design error: decide the behaviour once instead.

### Performance

- No subprocess on the 1-second clock or in a hook that fires per request. `git` runs once after a turn (debounced).
- The transcript is read at session start and after an advisor turn only.
- A Client module's timer changes nothing once it has settled, so an idle box never redraws.

### Untrusted text stays data

Notification text and paths reach a child process as argv items or environment variables, never inside script text. The Windows scripts are constant strings that read `$env:`.

### Repo Skills and Branching

- Two-tier flow: feature branches are `dev-<feature>`, PR'd into `dev`; `dev` is released into `master` by a release PR. **Merging into `master` publishes**: it is what `/plugin install` and `claude plugin update` fetch. Bump the version in `.claude-plugin/plugin.json` in the release PR.
- Every commit, sync, and pull request goes through the repo-local skills (`commit`, `sync`, `pr`), never hand-written `git commit`, `git merge`, or `gh pr create`.
- Never create a new branch without asking the user first, using `AskUserQuestion` when available. This applies even when a plan, skill, or workflow suggests a branch.

### Never Commit

- A hardcoded absolute personal path (`/Users/<name>/...`, `C:\Users\<name>\...`). The plugin runs on other people's machines.
- A debug log, a scratch script, or `.claude-plugin/types/`.
