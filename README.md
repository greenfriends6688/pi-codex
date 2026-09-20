# Pinkslab

> **Pinkslab** = **Pi** + **Ink** + **Slab** — a workbench for the [pi coding agent](https://github.com/earendil-works/pi): a local browser UI and a desktop app that share pi's own sessions, models and configuration.

English | [简体中文](./README.zh-CN.md)

![Pinkslab driving a pi session: collapsible tool calls, a syntax-highlighted answer and the composer](./assets/readme-screenshot.png)

A conversation started in the pi terminal can be picked up in Pinkslab and handed back, because Pinkslab reads and writes the same files pi does — sessions under `~/.pi/agent/sessions`, plus `models.json`, `settings.json`, auth, skills and packages. Nothing leaves the machine: the server binds to `127.0.0.1` and provider keys stay in pi's own config.

## Highlights

- **Same pi, another surface** — sessions, context usage, cost and compaction state come straight from pi's files; you can keep running turns, fork sessions and branch inside them.
- **One window for the whole loop** — chat, file tree, Git graph, terminal and a localhost browser sit in tabs next to each other.
- **Configure everything in the UI** — models, providers, skills, plugins, MCP servers, subagents, scheduled tasks and memory, without hand-editing JSON.
- **Chinese as much as English** — 简体中文 / 繁體中文 / English, typeset in Inter + Noto Sans Mono.

## Features

### Sessions and workspace

- Sessions grouped by project and Git worktree, with virtualized lists and session families shown together.
- Time groups (pinned / today / yesterday / this week / this month / older) with remembered expansion.
- Pin, archive and colour-code sessions locally, without touching the session files.
- Full-text search across every conversation, plus a separate file search that jumps into the viewer.
- Rename, export to Markdown, delete, and optional model-generated session titles.
- Standalone chat workspace for conversations that belong to no project.
- Recent projects discovered from VS Code, Cursor, Zed, Claude, Codex and OpenCode histories.
- Workspace restore: reopening remembers which session a workspace was left on.
- Git worktrees can be created, switched and removed from the sidebar, with sessions of one repository kept together.

### Chat and streaming

- Streaming answers with Markdown, syntax highlighting, KaTeX, Mermaid and ANSI output, plus clickable file links.
- Collapsible thinking blocks and tool results that can inline images.
- Three ways to render a tool run: legacy inline, live timeline, or paged.
- Image and file attachments; oversized files degrade to a path reference instead of failing.
- `@` mentions with fuzzy file search, and drag-and-drop that turns into a workspace-relative reference.
- Inline references for sessions (`&`), MCP servers (`#`) and todos (`~`).
- Quote a selection straight into the composer; copy any message.
- Message queue you can steer per item: withdraw, delete, reorder, or send immediately.
- Slash-command palette and `/compact` with a readable summary.
- Reading mode collapses the composer; drafts and attachments are remembered per session.
- Chips for the files written in each turn, and a minimap for long sessions.
- Thinking level from auto to max, remembered per model.
- Permission modes (ask / bypass / plan), tool whitelists and plan mode.
- Todo chips and panel, completion sounds, and desktop or browser notifications.
- Extension surfaces: status bar entries, widgets and dialog requests.
- Session stats bar with messages, tokens, cost, cache hit rate and a context ring.
- Inspect the effective system prompt and every tool definition.

### Branching

- **New session** from any message: an independent session file that keeps its parent in the list.
- **Edit from here**: a branch inside the current session, switchable with the branch navigator.
- **Rewind to here**: truncate everything after a message, with an explicit note about the file on disk.
- Exploration branches: try a tangent, keep the conclusion, and read the pane side by side.

### Files and previews

- Multi-root file tree with scope badges and Git status decoration.
- Upload with overwrite / skip / error conflict policies; create, rename and delete.
- Preview source, diffs, Markdown (editable, written back to disk), images, audio, video, PDF and DOCX.
- Zoom for images and documents, auto-refresh when files change, fuzzy file index, line highlighting, and reveal in Finder/Explorer.

### Git

- Status, diff and log endpoints feeding the viewer and the graph.
- Git graph tab with lanes, commit details, changed files that open straight into a diff, and ref chips.

### Terminal and browser

- Embedded terminal (xterm) with tabs, reconnect and exit codes.
- Embedded browser tab for localhost services, with history and device-width presets.

### Models and providers

- OAuth sign-in and API keys, catalog presets, connection tests and editable costs.
- Model favourites shared between the composer picker and the settings page.
- Warnings when a built-in model definition is overridden.
- Provider usage and quota display where the provider exposes it.
- Default model and a separate model for session titles, plus a request proxy setting.

### Auth and remote access

- Password login page and Basic Auth, with login throttling.
- Idle session reaping, extension keep-alive leases and a request host allow-list.

### Extensions

- Plugins and standalone extensions: install, enable/disable, remove, update checks.
- Skills: browse, search, install, update, remove, and ship built-in defaults.
- MCP servers: add, edit, enable/disable, move between scopes, test connections, import from other agents.
- Subagents: profiles with their own model, tools and thinking level, plus a sub-session list.
- Project trust prompt before anything writes into a project scope.

### Automation and memory

- Scheduled tasks: daily, weekly or one-off, with a timezone and run-now.
- Memory panel: toggle pi-memory and edit `MEMORY.md` files.

### Interface

- Settings with sections and a search box that understands English and Chinese terms.
- Light, dark and auto themes on a semantic token layer, with Inter + Noto Sans Mono.
- Adjustable density, border depth, chat width and type sizes.
- Wallpapers: two built-in paintings or your own image, with scrim, opacity and blur per area.
- Toggles for thinking expansion, selection quoting, PowerShell and push registration.
- Mobile layout with a compact toolbar, and keyboard shortcuts throughout.

### Desktop app, PWA and push

- Electron shell: close to tray, tray menu, native notifications, badge, prevent-sleep while running, external links open in the browser, reveal in folder, remembered window position.
- Dropping a file on the desktop window resolves its absolute path.
- Update checks with an in-app notice.
- PWA manifest, service worker, offline page and Web Push subscriptions.

## Requirements

- Node.js 22.19.0 or newer (`node --version`).
- A working pi installation with at least one provider configured. Pinkslab reads `~/.pi/agent`; point `PI_CODING_AGENT_DIR` elsewhere if your pi data lives in another directory.

## Run it

```bash
git clone https://github.com/greenfriends6688/pinkslab.git
cd pinkslab
npm install
npm run prod        # builds for production and serves http://127.0.0.1:30141
```

Pinkslab listens on `127.0.0.1` only. Use `npm run dev:clean` while working on the code, `npm test` for the unit suite and `npx tsc --noEmit` for types.

### Desktop app

```bash
npm run desktop        # run the Electron shell against the local build
npm run desktop:dist   # package installers for the current platform
npm run desktop:dist:win   # Windows installers, cross-built
```

The desktop shell bundles the same Next.js server, so the browser and the app are the same product.

> Pinkslab is installed from source. The `@agegr/pi-web` package on npm is upstream Pi Web, a different project.

## Data and privacy

- Sessions, models, auth, skills and plugins all live in pi's own directories; Pinkslab adds its own state only for drafts, layout and local flags.
- Provider credentials are read through pi's auth storage and are never returned by an API endpoint.
- The file browser is limited to working directories recorded by your sessions, their project roots and roots you explicitly add — it is not a general filesystem browser.
- Password protection does not encrypt traffic. Do not expose Pinkslab over plain HTTP to the internet; put it behind HTTPS on a trusted reverse proxy or a VPN.

## Credits

Pinkslab is a fork of [Pi Web](https://github.com/agegr/pi-web) by [@agegr](https://github.com/agegr/pi-web). Session browsing, the in-process agent session layer, the file and preview stack, and most of the configuration surfaces started there — thank you for the original work, without it this fork would not exist.

The agent runtime, session format and terminal experience belong to [pi](https://github.com/earendil-works/pi) by [earendil-works](https://github.com/earendil-works).

## License

[MIT](./LICENSE)
