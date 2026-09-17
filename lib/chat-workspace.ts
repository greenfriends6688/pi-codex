import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { samePath, toNativePath } from "./paths";

/**
 * Standalone chat workspace (fork feature: `docs/patches/0001-chat-workspace.md`).
 *
 * Pi Web derives its "projects" from session cwds, so a conversation outside any
 * project still needs a cwd. This module owns one dedicated directory for those
 * conversations, plus the user's override for it.
 *
 * The override lives in `<agentDir>/pi-web-chat.json` (`{ version, path }`), kept
 * beside the rest of pi's config so a reinstall of pi-web does not lose it. The
 * directory itself is never created implicitly by a read — only `ensureChatWorkspace()`
 * and `writeChatWorkspacePath()` touch the filesystem.
 */

export const CHAT_WORKSPACE_DIR_NAME = "pi-web-chat";

/** Config file name inside pi's agent directory. */
export const CHAT_WORKSPACE_CONFIG_FILE = "pi-web-chat.json";

const CONFIG_VERSION = 1;
const CONFIG_CACHE_TTL_MS = 5_000;

declare global {
  // globalThis survives Next.js hot-reload; a module-level Map does not.
  var __piChatWorkspaceConfigCache: Map<string, { path: string; expiresAt: number }> | undefined;
}

interface StoredChatWorkspaceConfig extends Record<string, unknown> {
  version?: unknown;
  path?: unknown;
}

export function getChatWorkspaceConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, CHAT_WORKSPACE_CONFIG_FILE);
}

/** Default chat workspace: `~/pi-web-chat`, next to (not inside) the user's projects. */
export function defaultChatWorkspacePath(home = homedir()): string {
  return join(home, CHAT_WORKSPACE_DIR_NAME);
}

function configCache(): Map<string, { path: string; expiresAt: number }> {
  if (!globalThis.__piChatWorkspaceConfigCache) {
    globalThis.__piChatWorkspaceConfigCache = new Map();
  }
  return globalThis.__piChatWorkspaceConfigCache;
}

function readStoredConfig(configPath: string): StoredChatWorkspaceConfig {
  if (!existsSync(configPath)) return {};
  const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid chat workspace config: expected an object");
  }
  return parsed as StoredChatWorkspaceConfig;
}

/**
 * Expand `~` and return a native absolute path. Relative input is rejected
 * because the UI picks absolute directories and the server's own cwd is not a
 * meaningful base for the user.
 */
export function normalizeChatWorkspaceInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const expanded = trimmed === "~"
    ? homedir()
    : trimmed.startsWith("~/") || trimmed.startsWith("~\\")
      ? join(homedir(), trimmed.slice(2))
      : trimmed;
  if (!isAbsolute(expanded)) return "";
  return toNativePath(resolve(expanded));
}

/** Configured chat workspace, falling back to the default when unset or malformed. */
export function getChatWorkspacePath(configPath = getChatWorkspaceConfigPath()): string {
  const cache = configCache();
  const cached = cache.get(configPath);
  if (cached && cached.expiresAt > Date.now()) return cached.path;

  let path = defaultChatWorkspacePath();
  try {
    const stored = readStoredConfig(configPath);
    if (typeof stored.path === "string") {
      path = normalizeChatWorkspaceInput(stored.path) || path;
    }
  } catch {
    // A malformed config never blocks the chat workspace; the default is used.
  }
  cache.set(configPath, { path, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
  return path;
}

/** Whether a path is the chat workspace. Compare paths with this, never with `===`. */
export function isChatWorkspacePath(candidate: string, configPath = getChatWorkspaceConfigPath()): boolean {
  if (!candidate) return false;
  return samePath(candidate, getChatWorkspacePath(configPath));
}

/** Create the chat workspace directory if needed and return its path. */
export function ensureChatWorkspace(configPath = getChatWorkspaceConfigPath()): string {
  const path = getChatWorkspacePath(configPath);
  mkdirSync(path, { recursive: true });
  return path;
}

/**
 * Persist a new chat workspace directory (creating it) and return the normalized
 * path. Unknown keys in the config file are preserved so other tooling that
 * shares the file keeps working.
 */
export function writeChatWorkspacePath(
  value: string,
  configPath = getChatWorkspaceConfigPath(),
): string {
  const path = normalizeChatWorkspaceInput(value);
  if (!path) throw new Error("CHAT_WORKSPACE_PATH_INVALID");

  mkdirSync(path, { recursive: true });
  let stored: StoredChatWorkspaceConfig = {};
  try {
    stored = readStoredConfig(configPath);
  } catch {
    // Overwrite a malformed config instead of refusing the user's choice.
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writePrivateFileAtomicSync(
    configPath,
    JSON.stringify({ ...stored, version: CONFIG_VERSION, path }, null, 2),
  );
  configCache().set(configPath, { path, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
  return path;
}

/** Test/DI helper: drop the cached config so a rewritten file is re-read. */
export function invalidateChatWorkspaceCache(configPath?: string): void {
  const cache = configCache();
  if (configPath) cache.delete(configPath);
  else cache.clear();
}
