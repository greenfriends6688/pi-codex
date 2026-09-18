/**
 * fork:memory-panel — what this fork knows about the pi-memory package.
 *
 * The memory feature is NOT implemented here: `npm:pi-memory` (installed through
 * the plugins API, listed in the official pi package directory) owns it, writes
 * markdown under `<agentDir>/memory/`, and registers its own tools. This module only
 * names the facts the settings page needs, so the string `pi-memory` and the
 * directory name exist in exactly one place.
 */

export const PI_MEMORY_PACKAGE_SOURCE = "npm:pi-memory";
export const MEMORY_DIR_NAME = "memory";
export const PI_MEMORY_DAILY_DIR = "daily";

/**
 * The files pi-memory keeps, in the order the panel lists them. Kept here (not in the
 * route) so the panel can name them and the route can whitelist them from one list —
 * they come from the package source: `MEMORY.md` = durable facts, `SCRATCHPAD.md` =
 * things to come back to, `daily/<date>.md` = the running log it appends to.
 */
export const PI_MEMORY_FILES = ["MEMORY.md", "SCRATCHPAD.md"] as const;

/** Writable by the panel (daily logs are matched by pattern in the route). */
export const PI_MEMORY_WRITABLE: readonly string[] = ["MEMORY.md", "SCRATCHPAD.md"];

/** Starter content, so "create the file" leaves something meaningful behind. */
export const PI_MEMORY_TEMPLATES: Record<string, string> = {
  "MEMORY.md": "# Memory\n\nDurable facts, decisions and preferences. One line per entry, newest at the top.\n",
  "SCRATCHPAD.md": "# Scratchpad\n\nThings to come back to.\n",
};

/** Tools pi-memory registers; used to show "installed but not loaded yet" states. */
export const PI_MEMORY_TOOLS = [
  "memory_write",
  "memory_read",
  "memory_forget",
  "memory_restore",
  "scratchpad",
  "memory_search",
  "memory_status",
] as const;

/** Search needs the external `qmd` binary; everything else works without it. */
export const PI_MEMORY_SEARCH_HINT_URL = "https://github.com/tobi/qmd";
