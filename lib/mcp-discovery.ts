import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * fork:mcp-import — discover MCP servers that other agents already configured.
 *
 * pi-web writes pi's own config (`<agentDir>/mcp.json`, `<cwd>/.pi/mcp.json`), so a
 * user who already has servers in Claude Code / Codex / Cursor / VS Code has to
 * retype them. MusePi solves this by reading every tool's config file and merging it
 * into its own list (`docs/mcp-config.md` §"Imported tool configs"); this is the same
 * idea, read-only: we list what was found and let the user import one or all.
 *
 * Precedence follows the reference: a **project** entry is encountered before a
 * same-named **user** entry, so the project one wins and the user one is reported as
 * shadowed. External files are never written to.
 */

export type McpDiscoveryScope = "user" | "project";

export interface McpSourceSpec {
  /** Tool the file belongs to, e.g. "claude", "codex", "cursor". */
  tool: string;
  scope: McpDiscoveryScope;
  /** Path relative to the project root (project) or absolute (user). */
  path: string;
  /** Which envelope key holds the server map. Codex is TOML and handled separately. */
  key: "mcpServers" | "mcp" | "servers";
  format: "json" | "toml";
}

export interface McpDiscoveredServer {
  name: string;
  tool: string;
  scope: McpDiscoveryScope;
  /** Absolute path of the file it came from. */
  path: string;
  /** Normalized definition, ready for pi's config. */
  def: Record<string, unknown>;
  /** Set when the source file marks the server off. */
  disabled: boolean;
  /** True when a higher-priority source defines the same name (project wins). */
  shadowed: boolean;
}

/** Every known external source, project entries first so they win. */
export function mcpDiscoverySources(home = homedir()): McpSourceSpec[] {
  return [
    { tool: "project", scope: "project", path: ".pi/mcp.json", key: "mcpServers", format: "json" },
    { tool: "claude", scope: "project", path: ".claude/mcp.json", key: "mcpServers", format: "json" },
    { tool: "claude", scope: "project", path: ".claude/.mcp.json", key: "mcpServers", format: "json" },
    { tool: "codex", scope: "project", path: ".codex/config.toml", key: "mcpServers", format: "toml" },
    { tool: "gemini", scope: "project", path: ".gemini/settings.json", key: "mcpServers", format: "json" },
    { tool: "opencode", scope: "project", path: "opencode.json", key: "mcp", format: "json" },
    { tool: "cursor", scope: "project", path: ".cursor/mcp.json", key: "mcpServers", format: "json" },
    { tool: "windsurf", scope: "project", path: ".windsurf/mcp_config.json", key: "mcpServers", format: "json" },
    { tool: "vscode", scope: "project", path: ".vscode/mcp.json", key: "servers", format: "json" },
    { tool: "portable", scope: "project", path: "mcp.json", key: "mcpServers", format: "json" },
    { tool: "portable", scope: "project", path: ".mcp.json", key: "mcpServers", format: "json" },
    { tool: "claude", scope: "user", path: join(home, ".claude.json"), key: "mcpServers", format: "json" },
    { tool: "claude", scope: "user", path: join(home, ".claude", "mcp.json"), key: "mcpServers", format: "json" },
    { tool: "codex", scope: "user", path: join(home, ".codex", "config.toml"), key: "mcpServers", format: "toml" },
    { tool: "gemini", scope: "user", path: join(home, ".gemini", "settings.json"), key: "mcpServers", format: "json" },
    { tool: "opencode", scope: "user", path: join(home, ".config", "opencode", "opencode.json"), key: "mcp", format: "json" },
    { tool: "cursor", scope: "user", path: join(home, ".cursor", "mcp.json"), key: "mcpServers", format: "json" },
    { tool: "windsurf", scope: "user", path: join(home, ".codeium", "windsurf", "mcp_config.json"), key: "mcpServers", format: "json" },
  ];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length > 0 ? items : undefined;
}

/**
 * Minimal TOML reader for Codex's `[mcp_servers.<name>]` tables.
 *
 * A general TOML parser is a dependency; this reads exactly the subset Codex writes
 * for MCP servers (`command`, `args = [...]`, inline or table `env`) and ignores
 * everything else. Ceiling: no arrays of tables, no multi-line strings, no dates —
 * documented in the UI as "Codex 配置按基础字段导入".
 */
export function parseCodexMcpToml(text: string): Record<string, Record<string, unknown>> {
  const servers: Record<string, Record<string, unknown>> = {};
  let current: string | null = null;
  let currentEnv: Record<string, string> | null = null;

  const unquote = (raw: string): string => raw.trim().replace(/^["']|["']$/g, "");
  const parseValue = (raw: string): unknown => {
    const value = raw.trim();
    const array = asStringArray(value.replace(/^\[|\]$/g, "").split(",").map(unquote).filter(Boolean));
    if (value.startsWith("[")) return array ? array : [];
    return unquote(value);
  };

  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;

    const table = /^\[([^\]]+)\]$/.exec(line);
    if (table) {
      const path = table[1]!.split(".").map((part) => part.trim());
      if (path[0] === "mcp_servers" && path.length === 2) {
        current = path[1]!;
        servers[current] = servers[current] ?? {};
        currentEnv = null;
      } else if (path[0] === "mcp_servers" && path.length === 3 && path[2] === "env" && current) {
        currentEnv = {};
        servers[current]!.env = currentEnv;
      } else {
        current = null;
        currentEnv = null;
      }
      continue;
    }

    const assignment = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!assignment) continue;
    const key = assignment[1]!;
    const value = assignment[2]!;

    if (currentEnv && current) {
      currentEnv[key] = unquote(value);
      continue;
    }
    if (!current) continue;
    if (key === "env") {
      const inline = asRecord(parseInlineTable(value));
      if (inline) servers[current]!.env = Object.fromEntries(Object.entries(inline).map(([k, v]) => [k, String(v)]));
      continue;
    }
    servers[current]![key] = parseValue(value);
  }
  return servers;
}

/** `{ a = "b", c = "d" }` → `{ a: "b", c: "d" }` (Codex writes env inline too). */
function parseInlineTable(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const body = trimmed.slice(1, -1);
  const out: Record<string, unknown> = {};
  for (const pair of body.split(",")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq).trim().replace(/^["']|["']$/g, "");
    const value = pair.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Normalize one tool's entry into pi's shape.
 *
 * Three dialects are handled: the common `{command,args,env|environment}` form,
 * VS Code's `{type:"stdio"|"http", …}`, and OpenCode's
 * `{type:"local"|"remote", command: string[]}`.
 */
export function normalizeDiscoveredDef(raw: unknown): { def: Record<string, unknown>; disabled: boolean } | null {
  const entry = asRecord(raw);
  if (!entry) return null;

  const disabled = entry.enabled === false || entry.disabled === true;
  const env = asRecord(entry.env) ?? asRecord(entry.environment) ?? undefined;
  const envStrings = env
    ? Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)]))
    : undefined;

  const commandValue = entry.command;
  const url = typeof entry.url === "string" && entry.url ? entry.url : undefined;

  // OpenCode: command is an argv array and remote servers use `url`.
  if (Array.isArray(commandValue)) {
    const argv = asStringArray(commandValue);
    if (!argv || argv.length === 0) return url ? { def: { url }, disabled } : null;
    const [command, ...args] = argv;
    return {
      def: { command, ...(args.length > 0 ? { args } : {}), ...(envStrings ? { env: envStrings } : {}) },
      disabled,
    };
  }

  if (typeof commandValue === "string" && commandValue) {
    const args = asStringArray(entry.args);
    return {
      def: {
        command: commandValue,
        ...(args ? { args } : {}),
        ...(envStrings ? { env: envStrings } : {}),
      },
      disabled,
    };
  }

  if (url) return { def: { url }, disabled };
  if (typeof entry.socket === "string" && entry.socket) return { def: { socket: entry.socket }, disabled };
  return null;
}

export function readDiscoveryFile(spec: McpSourceSpec, cwd: string, home = homedir()): { servers: Record<string, unknown>; path: string } | null {
  const path = spec.scope === "project" ? join(cwd, spec.path) : spec.path.startsWith("~") ? join(home, spec.path.slice(1)) : spec.path;
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8");
    if (spec.format === "toml") return { servers: parseCodexMcpToml(text), path };
    const parsed = asRecord(JSON.parse(text));
    if (!parsed) return null;
    // VS Code nests under `mcp.servers` in some versions and `servers` in others.
    const envelope = asRecord(parsed[spec.key])
      ?? (spec.key === "servers" ? asRecord(asRecord(parsed.mcp)?.servers) : null);
    return { servers: envelope ?? {}, path };
  } catch {
    return null;
  }
}

/**
 * Walk every source and return what is importable, project-first.
 *
 * `shadowed` marks an entry that a higher-priority source already defines (the
 * reference's rule: a project entry suppresses the same-named user entry, including
 * when the project entry is the one that disables it).
 */
export function discoverMcpServers(cwd: string, home = homedir(), sources = mcpDiscoverySources(home)): McpDiscoveredServer[] {
  const seen = new Map<string, { tool: string; scope: McpDiscoveryScope; disabled: boolean }>();
  const out: McpDiscoveredServer[] = [];

  for (const spec of sources) {
    const file = readDiscoveryFile(spec, cwd, home);
    if (!file) continue;
    for (const [name, raw] of Object.entries(file.servers)) {
      const normalized = normalizeDiscoveredDef(raw);
      if (!normalized) continue;
      const previous = seen.get(name);
      out.push({
        name,
        tool: spec.tool,
        scope: spec.scope,
        path: file.path,
        def: normalized.def,
        disabled: normalized.disabled,
        shadowed: Boolean(previous),
      });
      if (!previous) seen.set(name, { tool: spec.tool, scope: spec.scope, disabled: normalized.disabled });
    }
  }
  return out;
}
