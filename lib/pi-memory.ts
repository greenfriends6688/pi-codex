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
