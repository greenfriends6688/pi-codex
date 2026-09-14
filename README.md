# Pi Web — Codex Style

> Special thanks to [@agegr](https://github.com/agegr/pi-web), the author of Pi Web, for the excellent original project.
>
> This is a Codex-style fork of Pi Web. It keeps the upstream feature set, restyles the whole UI to match Codex aesthetics, and picks a few upstream pull requests that have not shipped in any release yet.
>
> 感谢 [Pi Web 作者 @agegr](https://github.com/agegr/pi-web) 的优秀开源项目。本项目是基于 Pi Web 的 Codex 风格分支：保留上游功能，把整套 UI 重排为 Codex 设计语言，并摘取了若干尚未进入上游正式版的 PR。

[中文文档](./README.zh-CN.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

Local browser UI for the [pi coding agent](https://github.com/earendil-works/pi). Pi Web shares pi's local configuration and session files, so you can browse and resume conversations, run agent turns, configure models and resources, and inspect project files from a browser.

![Pi Web displaying a pi session with structured Markdown, tool calls, and project navigation](./docs/screenshot2.png)

## What is different from upstream

| | Upstream Pi Web | This fork |
| --- | --- | --- |
| Visual language | Upstream design | Codex skin — layered surfaces, hairline translucent borders, three-level foreground alpha, a single monochrome primary action, 13px chat type, SF Mono |
| Themes | 6 palettes | Same 6 palettes (`light` / `dark` / `mist` / `rose` / `pine` / `auto`), all repainted in the Codex palette |
| File tree | Left sidebar | Right-hand panel, so the sidebar stays a pure session list |
| Message actions | Shown on hover | Always visible |
| MCP servers | Not available | Managed from the Plugins panel (picked from [#470](https://github.com/agegr/pi-web/pull/470)) |
| Workspace editor | Not available | Markdown editor with a switchable main/secondary layout (picked from [#838](https://github.com/agegr/pi-web/pull/838)) |
| Provider usage | Not available | OpenCode Go quota display (picked from [#844](https://github.com/agegr/pi-web/pull/844)) |

Every intentional deviation from upstream — and the exact procedure for merging a new upstream release without losing the skin — is recorded in [`docs/codex-skin/delta.md`](./docs/codex-skin/delta.md). Read that before touching theme or layout code.

## Features

- **Session workspace**: browse, resume, rename, export, and delete conversations grouped by project, with running state, context usage, cost, and compaction details.
- **Two ways to branch**: **New session** creates an independent session file from an earlier message; **Edit from here** creates a branch inside the current session.
- **Project file tools**: browse and upload files, inspect Git diffs, and preview source, Markdown, images, audio, PDFs, and DOCX files with automatic refresh.
- **Git worktrees**: switch checkouts from the sidebar while keeping sessions from the same repository grouped together.
- **MCP server management**: view, add, edit, enable/disable, move between scopes, test, and delete MCP servers from the Plugins panel — no hand-editing JSON.
- **Web-based configuration**: manage provider login and API keys, models, model tests, plugin packages, and skills without leaving Pi Web.
- **English, Simplified Chinese, and Traditional Chinese UI**: Pi Web follows the browser language initially and provides a language switcher in the settings panel.

## Quick Start

Pi Web requires Node.js 22.19.0 or newer. Check your version with `node --version`, then:

```bash
git clone https://github.com/greenfriends6688/pi-codex.git
cd pi-codex
npm install
npm run prod
```

`npm run prod` builds for production and serves it at [http://127.0.0.1:30141](http://127.0.0.1:30141). Pi Web listens only on `127.0.0.1` by default.

> The upstream `npx @agegr/pi-web` command installs the upstream package, **not** this fork — it has neither the Codex skin nor the MCP panel. Install this fork from source.

If no model provider is configured yet, open the **Models** panel to sign in or add an API key.

## MCP servers

The Plugins panel has an **MCP servers** section alongside the plugin list. It reads and writes the same two files pi's MCP tooling uses:

| Scope | File |
| --- | --- |
| Global | `~/.pi/agent/mcp.json` |
| Project | `<project>/.pi/mcp.json` |

Global acts as the base and project entries override it by name. Writing to project scope requires the project to be trusted, exactly like plugin installation. The detail view lists environment variable **names only** — values are never returned by the list endpoint; the advanced JSON editor fetches the full definition (including values) only while you are editing.

The **Test connection** button spawns a stdio server (or POSTs `initialize` for HTTP servers) and reports the server name, version, and tool count; stdio tests time out after 20 seconds.

> **Important:** pi core ships **no built-in MCP**. The upstream documentation states it "intentionally does not include built-in MCP" — MCP support has to come from a pi extension or package. This panel manages the configuration such a package consumes; it does not by itself wire MCP servers into the agent.

## Configuration

For port and hostname, command-line options override the corresponding environment variables. Either `--no-open` or `PI_WEB_NO_OPEN=1` disables automatic browser opening. Run `pi-web --help` (or `-h`) to print startup options and exit without starting the server. Unknown options exit with an error.

| Option or environment variable | Purpose | Default |
| --- | --- | --- |
| `--help`, `-h` | Print startup options and exit | — |
| `--port <port>`, `-p <port>`, or `PORT` | Server port | `30141` |
| `--hostname <host>`, `-H <host>`, or `PI_WEB_HOSTNAME` | Bind hostname | `127.0.0.1` |
| `--no-open` or `PI_WEB_NO_OPEN=1` | Do not open a browser automatically | Browser opens |
| `PI_WEB_SKIP_VERSION_CHECK=1` | Disable Pi Web update checks | Unset |
| `PI_WEB_ALLOWED_HOSTS` | Additional exact proxy or custom hostnames, comma-separated | Unset |
| `PI_WEB_PASSWORD` | Enable browser password login; API clients may use Basic Auth with username `pi` | Authentication disabled |
| `PI_WEB_IDLE_TIMEOUT_MS` | Session idle timeout in milliseconds, up to `2147483647`; `0` disables idle shutdown; invalid or out-of-range values use the default | `600000` (10 min) |

For example:

```bash
pi-web --help
pi-web -p 8080 -H 0.0.0.0 --no-open
```

### Remote Access

Binding to a non-loopback address exposes an agent that can execute high-privilege actions. On a trusted LAN, require a long random password:

```bash
PI_WEB_PASSWORD='a-long-random-password' pi-web --hostname 0.0.0.0
```

Password authentication does not encrypt the connection. Do not expose Pi Web over plain HTTP to the internet; use HTTPS through a trusted reverse proxy or a trusted VPN. If a reverse proxy sends an external hostname, add that exact name to `PI_WEB_ALLOWED_HOSTS`. This allow-list does not change the address Pi Web binds to.

### HTTP Proxy

Server-side model and API requests honor the standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables.

On macOS or Linux:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npm run prod
```

On Windows PowerShell:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npm run prod
```

## Development

**Everyday use — precompiled and fast:**

```bash
npm run prod        # clear the dev cache -> next build -> next start, port 30141
```

Production mode is precompiled and roughly 10x faster per request than development mode, where Turbopack compiles each route on first visit (10–15 s measured) and `reactStrictMode` double-invokes effects. Use `npm run prod` for daily work and demos.

**Editing code:**

```bash
npm run dev:clean   # clear the production cache -> next dev, port 30141
npm run mode:status # report which mode .next currently belongs to
```

`dev` and `prod` share `.next/` and their outputs are incompatible; mixing them by hand produces bogus `Failed to compile` or `Module ... factory is not available` errors. `prod` and `dev:clean` move the mismatched cache to the system temp directory before starting, so always switch through those two commands rather than running a bare `next build` followed by `next dev`.

Checks:

```bash
node_modules/.bin/tsc --noEmit
npm run lint
npm test
```

`npm test` currently reports two pre-existing failures unrelated to feature work: a `SessionSidebar` structural assertion that the Codex skin refactor invalidated, and a `model-discovery` test that needs to create a lock file under `~/.pi/agent/`. Everything else passes.

After touching the theme layer, also run:

```bash
node docs/codex-skin/audit-tokens.mjs   # self-invented tokens, 6-palette completeness, CSS brace balance
node docs/codex-skin/verify-themes.mjs  # duplicate theme blocks + the token values actually rendered
```

The static checks cannot catch a duplicated theme selector; only the render check can.

Contributor guides: [Internationalization](./docs/i18n.md), [Release process](./docs/release.md), and the [skin delta ledger](./docs/codex-skin/delta.md).

## Repository Layout

```text
app/             Next.js UI and API routes
components/      React UI components
hooks/           Client state and interaction hooks
lib/             Session, agent, model, file, Git, and security logic
public/          Static assets and PWA files
bin/             npm CLI entrypoint and launch option parsing
scripts/         Build and mode-switching helpers
docs/            Focused user and contributor guides
docs/codex-skin/ Skin delta ledger, token audit, theme render check
```

See [AGENTS.md](./AGENTS.md) for the architecture notes and detailed file map.

## Merging a new upstream release

This fork's `upstream` branch holds **pristine upstream source tarballs**, not the real upstream git history, so it shares no ancestry with upstream's own commits. The sync procedure is therefore:

1. Unpack the new release into the `upstream` worktree (`../pi-web-upstream`) and commit it there as `upstream vX.Y.Z`.
2. Run `git merge upstream` on `main`. Conflicts should only appear in the files the ledger lists.
3. Resolve logic conflicts in favour of upstream and re-apply the skin per the ledger, then run the full check list above.

Never `git merge` an upstream pull request branch. Pick it as a patch against its own base release instead — the exact commands are in the ledger.

## Notes

- **Agent data**: Pi Web reads pi data from `~/.pi/agent` by default, including session files under `sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`. Set `PI_CODING_AGENT_DIR` to use another pi agent directory.
- **Filesystem access**: Pi Web must be able to read the agent data directory and the working directories recorded by its sessions. Run Pi Web in the same filesystem environment as pi when sharing existing sessions.
- **Shared configuration**: the Models panel uses pi's model, settings, and credential storage, so changes are visible to both interfaces.
- **File access boundary**: the file browser is limited to working directories selected in Pi Web and project or session roots it already knows about; it is not a general filesystem browser.
- **Git worktrees**: see [Worktrees in Pi Web](./docs/worktrees.md) for switcher visibility, worktree creation, and removal behavior.

### Downstream Session Context Menu

Electron wrappers and other downstream integrations can provide a session-row
context menu without patching `SessionSidebar`. Listen for the cancelable
`pi-web:session-row-contextmenu` browser event and call `preventDefault()`
synchronously when the integration will handle it:

```js
window.addEventListener("pi-web:session-row-contextmenu", (event) => {
  event.preventDefault();
  const { id, path, cwd, name, clientX, clientY, refresh } = event.detail;

  void openSessionMenu({ id, path, cwd, name, clientX, clientY }).then((changed) => {
    if (changed) refresh();
  });
});
```

The detail object contains `id`, `path`, `cwd`, optional `name`, pointer
coordinates, and a `refresh()` callback for actions that change the session
list. If no listener cancels the extension event, Pi Web preserves the
browser's native context menu. This hook is browser-side and independent of
Pi agent extensions.

### Extension Session Liveness

Server-side Pi extensions with detached work can prevent automatic idle
session eviction through the versioned global registry:

```js
const liveness = globalThis[Symbol.for("@agegr/pi-web/session-liveness/v1")];
const release = liveness?.version === 1
  ? liveness.register({
      name: "my-extension",
      sessionId,
      sessionFile: sessionFile || undefined,
      isActive: () => detachedJobs.size > 0,
    })
  : () => {};
```

Register once per active extension session and call the returned idempotent
`release` function on session shutdown, replacement, or reload. `isActive`
must be synchronous, cheap, and scoped to the supplied exact session id or
file. Provider errors fail safe by preserving that session. This lease only
affects automatic idle eviction; explicit shutdown and Stop fallback cleanup
still take precedence.

## License

[MIT](./LICENSE)
