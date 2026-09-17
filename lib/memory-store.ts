import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

/**
 * fork:memory — durable notes the agent (and the user) can keep across sessions.
 *
 * Pi has no memory feature: there is no `memory_*` tool, no embedding store, and
 * `docs/*.md` only ever says "in-memory". MusePi solves it with a local SQLite
 * engine (`packages/mnemopi`) plus `packages/snapcompact`; that is a product of its
 * own. What this file implements is the smallest thing that earns the name:
 * a JSON list of short facts, scoped either globally or to one project, written by
 * a tool the model can call and injected back into every session's context.
 *
 * File: `<agentDir>/pi-web-memory.json` (same place and shape conventions as the
 * chat-workspace config, so a pi-web reinstall does not lose it).
 *
 * No embeddings on purpose: recall is substring/token matching over a list that is
 * expected to stay in the low hundreds of entries. `ponytail:` the ceiling is that
 * recall degrades once entries exceed what a substring scan can rank — upgrade to
 * an index only if a real memory set gets that large.
 */

export const MEMORY_CONFIG_VERSION = 1;
export const MEMORY_CONFIG_FILE = "pi-web-memory.json";

/** How many entries a recall may return; keeps the injected context bounded. */
export const MEMORY_RECALL_LIMIT = 20;
/** Entry text cap. Long prose belongs in a file, not in a memory list. */
export const MEMORY_TEXT_MAX = 500;

export interface MemoryEntry {
  id: string;
  /** The fact, instruction or preference, one or two sentences. */
  text: string;
  /** `global`, or an absolute cwd for project-scoped memories. */
  scope: string;
  source: "user" | "agent";
  createdAt: string;
}

/**
 * The two switches. Both default to **off**: a memory feature that starts writing
 * about you without being asked is worse than no memory feature, and automatic
 * capture spends tokens on every run — see the reference implementation's own
 * warning ("消耗额外 token").
 */
export interface MemorySettings {
  /** Master switch: when false no tools are registered and nothing is injected. */
  enabled: boolean;
  /** Run one capture turn after a normal run settles, so facts get saved without asking. */
  autoLearn: boolean;
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = { enabled: false, autoLearn: false };

export interface MemoryFile {
  version: number;
  settings: MemorySettings;
  entries: MemoryEntry[];
}

const CONFIG_CACHE_TTL_MS = 5_000;

declare global {
  var __piMemoryCache: { file: string; value: MemoryFile; expiresAt: number } | undefined;
}

export function getMemoryConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, MEMORY_CONFIG_FILE);
}

function emptyFile(): MemoryFile {
  return { version: MEMORY_CONFIG_VERSION, settings: { ...DEFAULT_MEMORY_SETTINGS }, entries: [] };
}

export function normalizeMemorySettings(input: unknown): MemorySettings {
  const raw = (input ?? {}) as Partial<MemorySettings>;
  return {
    // Anything other than an explicit `true` is off — that is the safe direction.
    enabled: raw.enabled === true,
    autoLearn: raw.autoLearn === true,
  };
}

export function readMemoryFile(file = getMemoryConfigPath()): MemoryFile {
  const cached = globalThis.__piMemoryCache;
  if (cached && cached.file === file && cached.expiresAt > Date.now()) return cached.value;

  let value = emptyFile();
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<MemoryFile>;
      const entries = Array.isArray(parsed.entries)
        ? parsed.entries.map((entry) => normalizeEntry(entry as Partial<MemoryEntry>)).filter((entry): entry is MemoryEntry => entry !== null)
        : [];
      // A file written before the switches existed has no `settings`: it stays off
      // until the user turns it on, and its entries are kept.
      value = { version: MEMORY_CONFIG_VERSION, settings: normalizeMemorySettings(parsed.settings), entries };
    }
  } catch {
    value = emptyFile();
  }
  globalThis.__piMemoryCache = { file, value, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };
  return value;
}

export function writeMemoryFile(next: MemoryFile, file = getMemoryConfigPath()): void {
  const directory = dirname(file);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  const value: MemoryFile = {
    version: MEMORY_CONFIG_VERSION,
    settings: normalizeMemorySettings(next.settings),
    entries: next.entries,
  };
  writePrivateFileAtomicSync(file, `${JSON.stringify(value, null, 2)}\n`);
  globalThis.__piMemoryCache = { file, value, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };
}

export function getMemorySettings(file = getMemoryConfigPath()): MemorySettings {
  return readMemoryFile(file).settings;
}

/** Patch the switches without touching entries (the UI toggles them independently). */
export function setMemorySettings(patch: Partial<MemorySettings>, file = getMemoryConfigPath()): MemorySettings {
  const current = readMemoryFile(file);
  const settings = normalizeMemorySettings({ ...current.settings, ...patch });
  writeMemoryFile({ ...current, settings }, file);
  return settings;
}

export function invalidateMemoryCache(): void {
  globalThis.__piMemoryCache = undefined;
}

export function normalizeScope(value: unknown): string {
  if (typeof value !== "string") return "global";
  const trimmed = value.trim();
  return trimmed && trimmed !== "global" ? trimmed : "global";
}

export function normalizeEntry(input: Partial<MemoryEntry>): MemoryEntry | null {
  const text = typeof input.text === "string" ? input.text.trim().slice(0, MEMORY_TEXT_MAX) : "";
  if (!text) return null;
  return {
    id: typeof input.id === "string" && input.id ? input.id : randomUUID(),
    text,
    scope: normalizeScope(input.scope),
    source: input.source === "agent" ? "agent" : "user",
    createdAt: typeof input.createdAt === "string" ? input.createdAt : new Date().toISOString(),
  };
}

export function listMemory(scope?: string, file = getMemoryConfigPath()): MemoryEntry[] {
  const entries = readMemoryFile(file).entries;
  const filtered = scope ? entries.filter((entry) => entry.scope === scope || entry.scope === "global") : entries;
  return [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addMemory(input: { text: string; scope?: string; source?: MemoryEntry["source"] }, file = getMemoryConfigPath()): MemoryEntry | null {
  const entry = normalizeEntry({ ...input, id: randomUUID(), createdAt: new Date().toISOString() });
  if (!entry) return null;
  const current = readMemoryFile(file);
  // Deduplicate: the same fact saved twice (which an agent will do) must not double
  // the injected context.
  const duplicate = current.entries.find((existing) => existing.text === entry.text && existing.scope === entry.scope);
  if (duplicate) return duplicate;
  writeMemoryFile({ ...current, entries: [entry, ...current.entries] }, file);
  return entry;
}

export function deleteMemory(id: string, file = getMemoryConfigPath()): boolean {
  const current = readMemoryFile(file);
  const entries = current.entries.filter((entry) => entry.id !== id);
  if (entries.length === current.entries.length) return false;
  writeMemoryFile({ ...current, entries }, file);
  return true;
}

export function updateMemory(id: string, text: string, file = getMemoryConfigPath()): MemoryEntry | null {
  const current = readMemoryFile(file);
  const existing = current.entries.find((entry) => entry.id === id);
  if (!existing) return null;
  const next = normalizeEntry({ ...existing, text });
  if (!next) return null;
  writeMemoryFile({ ...current, entries: current.entries.map((entry) => (entry.id === id ? next : entry)) }, file);
  return next;
}

/** Query tokens: lowercased words, CJK kept as runs so a Chinese query still matches. */
export function memoryQueryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/**
 * Rank entries for a query. Empty query = "everything, newest first" (an agent
 * calling `recall` with no argument wants the standing list back).
 *
 * Scoring is deliberately simple and explainable: an entry must contain every query
 * token to match at all, then matches sort by how many of the entry's own tokens the
 * query covers (so a short exact entry beats a long paragraph that mentions it).
 */
export function recallMemory(entries: readonly MemoryEntry[], query: string, limit = MEMORY_RECALL_LIMIT): MemoryEntry[] {
  const tokens = memoryQueryTokens(query);
  if (tokens.length === 0) return entries.slice(0, limit);

  const scored = entries
    .map((entry) => {
      const haystack = entry.text.toLowerCase();
      if (!tokens.every((token) => haystack.includes(token))) return null;
      const own = memoryQueryTokens(entry.text);
      const covered = own.length === 0 ? 0 : own.filter((token) => tokens.some((needle) => token.includes(needle) || needle.includes(token))).length / own.length;
      return { entry, score: covered };
    })
    .filter((row): row is { entry: MemoryEntry; score: number } => row !== null)
    .sort((a, b) => b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt));

  return scored.slice(0, limit).map((row) => row.entry);
}

/**
 * The block injected into a session's context. Empty when there is nothing to say,
 * so a fresh install does not gain a "you have no memories" paragraph in every
 * system prompt.
 */
export function renderMemoryBlock(entries: readonly MemoryEntry[], scope?: string): string {
  const scoped = scope ? entries.filter((entry) => entry.scope === scope) : [];
  const global = entries.filter((entry) => entry.scope === "global");
  if (scoped.length === 0 && global.length === 0) return "";

  const blocks: string[] = [];
  if (scoped.length > 0) {
    blocks.push(`## Project memory\n${scoped.map((entry) => `- ${entry.text}`).join("\n")}`);
  }
  if (global.length > 0) {
    const heading = scoped.length > 0 ? "## Global memory" : "## Memory";
    blocks.push(`${heading}\n${global.map((entry) => `- ${entry.text}`).join("\n")}`);
  }
  return blocks.join("\n\n");
}

// ---------------------------------------------------------------------------
// Maintenance (memory stats / export / cleanup)
//
// MusePi's memory page has 强制固化 / 清空 / 统计 / 诊断 next to the list; these are
// the cheap, local versions of the same ideas — no extra model call, no second
// store. Consolidation is deterministic (trim, drop near-duplicates) precisely so it
// can run on a click without spending tokens; an LLM rewrite pass would be a
// different feature with a different cost.
// ---------------------------------------------------------------------------

export interface MemoryStats {
  total: number;
  global: number;
  projects: number;
  /** Distinct project scopes. */
  projectCount: number;
  characters: number;
  fromAgent: number;
  fromUser: number;
  oldest: string | null;
  newest: string | null;
}

export function memoryStats(entries: readonly MemoryEntry[]): MemoryStats {
  const scopes = new Set(entries.map((entry) => entry.scope));
  const sorted = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    total: entries.length,
    global: entries.filter((entry) => entry.scope === "global").length,
    projects: entries.filter((entry) => entry.scope !== "global").length,
    projectCount: [...scopes].filter((scope) => scope !== "global").length,
    characters: entries.reduce((sum, entry) => sum + entry.text.length, 0),
    fromAgent: entries.filter((entry) => entry.source === "agent").length,
    fromUser: entries.filter((entry) => entry.source === "user").length,
    oldest: sorted[0]?.createdAt ?? null,
    newest: sorted[sorted.length - 1]?.createdAt ?? null,
  };
}

/** Remove every entry (optionally only one scope). Settings are untouched. */
export function clearMemory(scope?: string, file = getMemoryConfigPath()): number {
  const current = readMemoryFile(file);
  const kept = scope ? current.entries.filter((entry) => entry.scope !== scope) : [];
  const removed = current.entries.length - kept.length;
  if (removed > 0) writeMemoryFile({ ...current, entries: kept }, file);
  return removed;
}

/**
 * Deterministic consolidation: trim whitespace, drop entries that say the same thing
 * (case/space-insensitive within a scope), and keep the newest of each duplicate.
 * Returns how many entries were removed.
 */
export function consolidateMemory(file = getMemoryConfigPath()): number {
  const current = readMemoryFile(file);
  const key = (entry: MemoryEntry): string => `${entry.scope}\u0000${entry.text.toLowerCase().replace(/\s+/g, " ").trim()}`;
  const byKey = new Map<string, MemoryEntry>();
  // Entries are stored newest-first, so the first one seen is the one to keep.
  for (const entry of current.entries) {
    const dedupeKey = key(entry);
    const existing = byKey.get(dedupeKey);
    if (!existing) {
      byKey.set(dedupeKey, { ...entry, text: entry.text.trim().slice(0, MEMORY_TEXT_MAX) });
      continue;
    }
    // Same fact, different wording of the source: keep the user-authored one.
    if (existing.source === "agent" && entry.source === "user") byKey.set(dedupeKey, { ...entry, text: entry.text.trim().slice(0, MEMORY_TEXT_MAX) });
  }
  const entries = [...byKey.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const removed = current.entries.length - entries.length;
  if (removed > 0 || entries.some((entry, index) => entry.text !== current.entries[index]?.text)) {
    writeMemoryFile({ ...current, entries }, file);
  }
  return removed;
}

/** The list as a markdown document — what "export the memory" means to a human. */
export function renderMemoryMarkdown(entries: readonly MemoryEntry[]): string {
  if (entries.length === 0) return "# Memory\n\n(empty)\n";
  const byScope = new Map<string, MemoryEntry[]>();
  for (const entry of entries) {
    byScope.set(entry.scope, [...(byScope.get(entry.scope) ?? []), entry]);
  }
  const lines = ["# Memory", ""];
  for (const [scope, scoped] of byScope) {
    lines.push(`## ${scope === "global" ? "Global" : scope}`, "");
    for (const entry of scoped) {
      lines.push(`- ${entry.text}  <!-- ${entry.source} · ${entry.createdAt.slice(0, 10)} -->`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * Mirrors the list to `<agentDir>/pi-web-memory.md` so the tray of "memory files"
 * the reference shows exists here too, and so the notes can be read/edited with any
 * editor. The JSON stays the source of truth (the UI edits entries, and a two-way
 * markdown sync would be a parser + a conflict story for no extra capability).
 */
export function writeMemoryMarkdownMirror(file = getMemoryConfigPath()): string {
  const path = join(dirname(file), "pi-web-memory.md");
  writePrivateFileAtomicSync(path, renderMemoryMarkdown(readMemoryFile(file).entries));
  return path;
}
