/**
 * fork:zc-04 — the shortcut kernel: one table, one matcher, one recorder.
 *
 * Why this module exists: before ZC-04 every shortcut was a hand-written
 * `if (event.key === ...)` in the component that owned the behaviour. That
 * scattered the key knowledge (which modifiers, which layout code, whether IME
 * input or key repeat counts) across listeners that could not see each other,
 * so two features could bind the same key and neither could be listed in
 * settings. This file is the single place that knows how a keyboard event maps
 * to a binding; the settings table and the global dispatcher are consumers.
 *
 * The techniques (not the command list) are ported from the reference project
 * (`packages/ui/src/shortcuts/bindings.ts` + `conflicts.ts` in ZCode):
 *   - `event.code` → canonical key name fallback, so non-US layouts record the
 *     physical key;
 *   - noise filtering: IME composition (`isComposing` / `Process` / `Dead` /
 *     legacy `keyCode 229`) and long-press `repeat` never match or record;
 *   - strict modifier matching: an extra modifier means "no match", so `⌘K`
 *     cannot fire on `⌘⇧K`;
 *   - platform labels: Apple renders `⌘K`, Windows/Linux render `Ctrl+K`.
 *
 * The command list itself is this fork's own: only bindings that actually have
 * a handler are marked `managed`. `⌘K` (command palette) and `⌘F` (conversation
 * find) are listed as read-only rows because their own hooks still register
 * them; ZC-04 deliberately does not rewire those files (they are owned by the
 * features that landed them). Their conflict slots are still protected.
 *
 * Pure module: no DOM, no storage, no React. Everything is injectable data so
 * `lib/shortcuts.test.mjs` can pin the edge cases without a browser.
 */

export const SHORTCUT_GROUPS = ["essential", "layout", "appearance", "notMigrated"] as const;
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

export const SHORTCUT_GROUP_LABEL_KEYS: Record<ShortcutGroup, string> = {
  essential: "settings.shortcuts.groupEssential",
  layout: "settings.shortcuts.groupLayout",
  appearance: "settings.shortcuts.groupAppearance",
  notMigrated: "settings.shortcuts.groupNotMigrated",
};

export const SHORTCUT_COMMAND_IDS = [
  "stopAgent",
  "newSession",
  "toggleSidebar",
  "toggleRightPanel",
  "toggleTheme",
  "findInConversation",
] as const;
export type ShortcutCommandId = (typeof SHORTCUT_COMMAND_IDS)[number];

export interface ShortcutCommandDefinition {
  id: ShortcutCommandId;
  /** i18n key for the row label. */
  labelKey: string;
  group: ShortcutGroup;
  /** Canonical serialized bindings. Multiple entries = aliases for one action. */
  defaultBindings: readonly string[];
  /**
   * true  = the global dispatcher in `hooks/useKeyboardShortcuts.ts` consumes it.
   * false = read-only row: another feature registers it today (⌘K palette, ⌘F
   *         find). It stays in the table for discovery and conflict protection.
   */
  managed: boolean;
}

export const SHORTCUT_COMMANDS: readonly ShortcutCommandDefinition[] = [
  // Esc is the one bare named key the fork owns; ChatInput still lets it through
  // from a textarea, which is why the dispatcher keeps that guard.
  { id: "stopAgent", labelKey: "settings.shortcuts.stopAgent", group: "essential", defaultBindings: ["Escape"], managed: true },
  // Ctrl+Alt+N (not CmdOrCtrl): this is the chord the app shipped with on every
  // platform, and the kernel matches explicit Ctrl on Apple too.
  { id: "newSession", labelKey: "settings.shortcuts.newSession", group: "essential", defaultBindings: ["Ctrl+Alt+n"], managed: true },
  { id: "toggleSidebar", labelKey: "settings.shortcuts.toggleSidebar", group: "layout", defaultBindings: ["CmdOrCtrl+b"], managed: true },
  { id: "toggleRightPanel", labelKey: "settings.shortcuts.toggleRightPanel", group: "layout", defaultBindings: ["CmdOrCtrl+Alt+b"], managed: true },
  { id: "toggleTheme", labelKey: "settings.shortcuts.toggleTheme", group: "appearance", defaultBindings: ["CmdOrCtrl+Shift+l"], managed: true },
  // Read-only rows — see the header comment. Not migrated on purpose.
  { id: "findInConversation", labelKey: "settings.shortcuts.findInConversation", group: "notMigrated", defaultBindings: ["CmdOrCtrl+f"], managed: false },
];

export type ShortcutOverrides = Record<string, readonly string[]>;
export type EffectiveShortcutBindings = Record<string, readonly string[]>;

export function getDefaultShortcutBindings(id: string): readonly string[] {
  return SHORTCUT_COMMANDS.find((entry) => entry.id === id)?.defaultBindings ?? [];
}

// ============================================================================
// Binding format
// ============================================================================

export interface ParsedShortcutBinding {
  cmdOrCtrl: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Canonical key name: lowercase letter / digit / symbol, or a named key. */
  key: string;
}

const MODIFIER_ORDER = [
  ["CmdOrCtrl", "cmdOrCtrl"],
  ["Ctrl", "ctrl"],
  ["Alt", "alt"],
  ["Shift", "shift"],
] as const satisfies ReadonlyArray<readonly [string, keyof ParsedShortcutBinding]>;

/** Apple display order is ⌃⌥⇧⌘; serialization order is CmdOrCtrl, Ctrl, Alt, Shift. */
const SINGLE_CHAR_KEY = /^[a-z0-9[\]=\-,./;'\\`]$/;

const NAMED_KEYS: ReadonlySet<string> = new Set([
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
  "Escape",
  "Enter",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Delete",
  "Insert",
]);

export function normalizeShortcutKey(rawKey: string): string | null {
  if (SINGLE_CHAR_KEY.test(rawKey)) return rawKey;
  if (NAMED_KEYS.has(rawKey)) return rawKey;
  // Function keys are recorded as F1..F12; keep a lowercase alias for patience.
  const upper = rawKey.toUpperCase();
  if (/^F([1-9]|1[0-2])$/.test(upper)) return upper;
  return null;
}

export function parseShortcutBinding(binding: string): ParsedShortcutBinding | null {
  if (!binding) return null;
  const tokens = binding.split("+");
  const keyToken = tokens[tokens.length - 1];
  if (!keyToken) return null;

  const parsed: ParsedShortcutBinding = {
    cmdOrCtrl: false,
    ctrl: false,
    alt: false,
    shift: false,
    key: "",
  };

  for (const token of tokens.slice(0, -1)) {
    const modifier = MODIFIER_ORDER.find(([name]) => name === token);
    if (!modifier || parsed[modifier[1]]) return null;
    parsed[modifier[1]] = true;
  }

  const key = normalizeShortcutKey(keyToken);
  if (key === null) return null;
  parsed.key = key;
  return parsed;
}

export function serializeShortcutBinding(parsed: ParsedShortcutBinding): string | null {
  const key = normalizeShortcutKey(parsed.key);
  if (key === null) return null;
  const parts: string[] = [];
  for (const [name, field] of MODIFIER_ORDER) {
    if (parsed[field]) parts.push(name);
  }
  parts.push(key);
  return parts.join("+");
}

export function isValidShortcutBinding(binding: string): boolean {
  const parsed = parseShortcutBinding(binding);
  return parsed !== null && serializeShortcutBinding(parsed) === binding;
}

// ============================================================================
// Platform + labels
// ============================================================================

export interface ShortcutPlatformInfo {
  platform?: string;
  userAgent?: string;
}

export function isApplePlatform(info?: ShortcutPlatformInfo): boolean {
  if (info?.platform !== undefined || info?.userAgent !== undefined) {
    return /mac|iphone|ipad|ipod/i.test(info.platform ?? "")
      || /Macintosh|iPhone|iPad/i.test(info.userAgent ?? "");
  }
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform)
    || /Macintosh|iPhone|iPad/i.test(navigator.userAgent);
}

const DISPLAY_KEY_ALIASES: Record<string, string> = {
  Escape: "Esc",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  "=": "+",
};

export function formatShortcutBindingLabelParts(
  binding: string,
  platformInfo?: ShortcutPlatformInfo,
): string[] {
  const parsed = parseShortcutBinding(binding);
  if (parsed === null) return [binding];

  const displayKey = DISPLAY_KEY_ALIASES[parsed.key]
    ?? (parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);
  const isApple = isApplePlatform(platformInfo);

  if (isApple) {
    const parts: string[] = [];
    if (parsed.ctrl) parts.push("⌃");
    if (parsed.alt) parts.push("⌥");
    if (parsed.shift) parts.push("⇧");
    if (parsed.cmdOrCtrl) parts.push("⌘");
    parts.push(displayKey);
    return parts;
  }

  const parts: string[] = [];
  if (parsed.cmdOrCtrl || parsed.ctrl) parts.push("Ctrl");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  parts.push(displayKey);
  return parts;
}

export function formatShortcutBindingLabel(
  binding: string,
  platformInfo?: ShortcutPlatformInfo,
): string {
  return formatShortcutBindingLabelParts(binding, platformInfo).join(isApplePlatform(platformInfo) ? "" : "+");
}

// ============================================================================
// Noise filtering (IME / long press)
// ============================================================================

export interface ShortcutKeyboardEvent {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  /** Chromium reports 229 while an IME composes; kept for legacy events. */
  keyCode?: number;
}

export function isImeEvent(event: Pick<ShortcutKeyboardEvent, "key" | "isComposing" | "keyCode">): boolean {
  return event.isComposing === true
    || event.key === "Process"
    || event.key === "Dead"
    || event.keyCode === 229;
}

export function isShortcutEventNoise(event: ShortcutKeyboardEvent): boolean {
  return event.repeat === true || isImeEvent(event);
}

// ============================================================================
// Matching
// ============================================================================

const CODE_TO_KEY: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Array.from({ length: 26 }, (_, index) => [`Key${String.fromCharCode(65 + index)}`, String.fromCharCode(97 + index)])),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`Digit${index}`, String(index)])),
  ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, `F${index + 1}`])),
  BracketLeft: "[",
  BracketRight: "]",
  Equal: "=",
  Minus: "-",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Backslash: "\\",
  Escape: "Escape",
  Enter: "Enter",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Delete: "Delete",
  Insert: "Insert",
};

const KEY_TO_CODE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(CODE_TO_KEY).map(([code, key]) => [key, code]),
);

function eventMatchesKey(event: Pick<ShortcutKeyboardEvent, "key" | "code">, key: string): boolean {
  if (event.key === key) return true;
  if (event.key.length === 1 && event.key.toLowerCase() === key) return true;
  if (event.code !== undefined && KEY_TO_CODE[key] === event.code) return true;
  return false;
}

function modifiersMatch(
  event: ShortcutKeyboardEvent,
  parsed: ParsedShortcutBinding,
  isApple: boolean,
): boolean {
  const { metaKey: meta, ctrlKey: ctrl, altKey: alt, shiftKey: shift } = event;
  // Primary modifier: ⌘ on Apple, Ctrl elsewhere. Explicit Ctrl is only
  // distinct from the primary on Apple (the system Emacs editing zone); on
  // Windows/Linux it is the same physical key, so `Ctrl+N` and `CmdOrCtrl+N`
  // both match it.
  const wantPrimary = parsed.cmdOrCtrl || (!isApple && parsed.ctrl);
  const wantCtrl = parsed.ctrl && isApple;

  // Bare named keys (Esc, arrows, F-keys) must not swallow their modified
  // variants; requiring the primary modifiers to be up keeps that boundary.
  if (!wantPrimary && !wantCtrl && (meta || ctrl)) return false;

  if (wantPrimary && !(isApple ? meta && !ctrl : ctrl && !meta)) return false;
  if (wantCtrl && !(ctrl && !meta)) return false;
  if (parsed.alt !== alt) return false;
  return parsed.shift === shift;
}

/**
 * Strict matching: the event's modifier set must equal the binding's. Extra
 * modifiers are not ignored, so `⌘K` never fires on `⌘⇧K` (the bug this kernel
 * is built to prevent). Long-press and IME events never match.
 */
export function matchesShortcutBinding(
  event: ShortcutKeyboardEvent,
  binding: string,
  platformInfo?: ShortcutPlatformInfo,
): boolean {
  if (isShortcutEventNoise(event)) return false;
  const parsed = parseShortcutBinding(binding);
  if (parsed === null) return false;
  if (!modifiersMatch(event, parsed, isApplePlatform(platformInfo))) return false;
  return eventMatchesKey(event, parsed.key);
}

/** Does any of this command's effective bindings match the event? */
export function matchesAnyShortcutBinding(
  event: ShortcutKeyboardEvent,
  bindings: readonly string[],
  platformInfo?: ShortcutPlatformInfo,
): boolean {
  return bindings.some((binding) => matchesShortcutBinding(event, binding, platformInfo));
}

// ============================================================================
// Recording
// ============================================================================

export type ShortcutRecordResult =
  | { kind: "pending" }
  | { kind: "binding"; binding: string }
  | { kind: "invalid"; reason: "no-modifier" | "unsupported-key" };

function isModifierOnlyKey(key: string): boolean {
  return key === "Shift" || key === "Control" || key === "Meta" || key === "Alt" || key === "AltGraph" || key === "OS";
}

function normalizeEventKeyFallback(rawKey: string): string | null {
  if (rawKey.length === 1) return normalizeShortcutKey(rawKey.toLowerCase());
  return normalizeShortcutKey(rawKey);
}

/**
 * Turn one keydown into a canonical binding. Modifier-only presses return
 * `pending` (recording keeps listening); printable keys without a modifier and
 * keys outside the whitelist return `invalid`. Repeat never records. IME
 * composition uses `event.code` because `event.key` is unreliable there.
 */
export function recordShortcutBinding(
  event: ShortcutKeyboardEvent,
  platformInfo?: ShortcutPlatformInfo,
): ShortcutRecordResult {
  if (event.repeat === true || isModifierOnlyKey(event.key)) return { kind: "pending" };

  const codeKey = event.code !== undefined ? CODE_TO_KEY[event.code] : undefined;
  const key = codeKey ?? normalizeEventKeyFallback(event.key);
  if (key === null) return { kind: "invalid", reason: "unsupported-key" };

  const isApple = isApplePlatform(platformInfo);
  const namedKey = key.length > 1;
  const hasModifier = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
  if (!hasModifier && !namedKey) return { kind: "invalid", reason: "no-modifier" };

  const parsed: ParsedShortcutBinding = {
    cmdOrCtrl: isApple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey,
    ctrl: isApple ? event.ctrlKey && !event.metaKey : false,
    alt: event.altKey,
    shift: event.shiftKey,
    key,
  };

  // A meta/ctrl press that maps to neither the primary nor explicit Ctrl (e.g.
  // bare ⌘ on Windows) would serialize as a naked key and then fire on every
  // plain press — reject it instead.
  if ((event.metaKey || event.ctrlKey) && !parsed.cmdOrCtrl && !parsed.ctrl) {
    return { kind: "invalid", reason: "unsupported-key" };
  }

  const binding = serializeShortcutBinding(parsed);
  if (binding === null) return { kind: "invalid", reason: "unsupported-key" };
  return { kind: "binding", binding };
}

// ============================================================================
// Recording-active gate
// ============================================================================

let shortcutRecordingActive = false;

/**
 * Set by the settings recorder while it owns the keyboard. The global
 * dispatcher short-circuits when this is true, otherwise pressing a chord to
 * record it would also run the command it is currently bound to.
 */
export function setShortcutRecordingActive(active: boolean): void {
  shortcutRecordingActive = active;
}

export function isShortcutRecordingActive(): boolean {
  return shortcutRecordingActive;
}

// ============================================================================
// Effective table
// ============================================================================

/**
 * Defaults + user overrides. An explicit empty array means "unassigned" and
 * stays empty (does not fall back to the default). Overrides whose entries are
 * all invalid fall back to the default so a hand-corrupted storage value cannot
 * make every shortcut dead.
 */
export function resolveEffectiveShortcutBindings(
  overrides?: ShortcutOverrides | null,
): EffectiveShortcutBindings {
  const effective: EffectiveShortcutBindings = {};
  for (const entry of SHORTCUT_COMMANDS) {
    const override = overrides?.[entry.id];
    if (override === undefined) {
      effective[entry.id] = entry.defaultBindings;
      continue;
    }
    const valid = override.filter((binding) => parseShortcutBinding(binding) !== null);
    if (override.length > 0 && valid.length === 0) {
      effective[entry.id] = entry.defaultBindings;
      continue;
    }
    effective[entry.id] = valid;
  }
  return effective;
}

/** Storage-shaped value → a validated overrides object. Never throws. */
export function parseShortcutOverrides(raw: unknown): ShortcutOverrides {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ShortcutOverrides = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!SHORTCUT_COMMAND_IDS.includes(id as ShortcutCommandId)) continue;
    if (!Array.isArray(value)) continue;
    const bindings = value.filter((item): item is string => typeof item === "string" && item.length > 0);
    if (bindings.length !== value.length) continue;
    out[id] = bindings;
  }
  return out;
}

// ============================================================================
// Conflict detection
// ============================================================================

/**
 * Browser/OS chords that cannot be dispatched reliably (reload, devtools, tab
 * management) or that the platform owns (F11 fullscreen). Compared after
 * canonicalization so a hand-written equivalent is still rejected.
 */
const RESERVED_BINDINGS: readonly string[] = [
  "CmdOrCtrl+r",
  "CmdOrCtrl+Shift+r",
  "CmdOrCtrl+Shift+i",
  "CmdOrCtrl+Shift+j",
  "CmdOrCtrl+Shift+c",
  "CmdOrCtrl+l",
  "CmdOrCtrl+t",
  "CmdOrCtrl+w",
  "CmdOrCtrl+Shift+w",
  "CmdOrCtrl+q",
  "CmdOrCtrl+p",
  "F5",
  "F11",
  "F12",
];

export type ShortcutConflict =
  | { kind: "reserved"; binding: string }
  | { kind: "invalid"; binding: string }
  | {
      kind: "occupied";
      binding: string;
      ownerCommandId: ShortcutCommandId;
      /** false = the owner is read-only (⌘K / ⌘F) and cannot be stolen. */
      ownerManaged: boolean;
    };

function canonicalBindingKey(binding: string, isApple: boolean): string | null {
  const parsed = parseShortcutBinding(binding);
  if (parsed === null) return null;
  if (isApple) {
    return `${parsed.cmdOrCtrl ? 1 : 0}${parsed.ctrl ? 1 : 0}${parsed.alt ? 1 : 0}${parsed.shift ? 1 : 0}:${parsed.key}`;
  }
  // On Windows/Linux CmdOrCtrl and explicit Ctrl are the same physical press.
  return `${parsed.cmdOrCtrl || parsed.ctrl ? 1 : 0}${parsed.alt ? 1 : 0}${parsed.shift ? 1 : 0}:${parsed.key}`;
}

export function isSamePhysicalBinding(
  a: string,
  b: string,
  platformInfo?: ShortcutPlatformInfo,
): boolean {
  const isApple = isApplePlatform(platformInfo);
  const keyA = canonicalBindingKey(a, isApple);
  const keyB = canonicalBindingKey(b, isApple);
  return keyA !== null && keyA === keyB;
}

let reservedCanonicalCache: { apple: ReadonlySet<string>; other: ReadonlySet<string> } | null = null;

function getReservedCanonicalKeys(): { apple: ReadonlySet<string>; other: ReadonlySet<string> } {
  if (reservedCanonicalCache === null) {
    const apple = new Set<string>();
    const other = new Set<string>();
    for (const binding of RESERVED_BINDINGS) {
      const appleKey = canonicalBindingKey(binding, true);
      if (appleKey) apple.add(appleKey);
      const otherKey = canonicalBindingKey(binding, false);
      if (otherKey) other.add(otherKey);
    }
    reservedCanonicalCache = { apple, other };
  }
  return reservedCanonicalCache;
}

/**
 * Can `newBinding` be assigned to `commandId`? `null` means yes. The command's
 * own current bindings never conflict with themselves (whole-group replace).
 */
export function checkShortcutBindingConflict(
  commandId: ShortcutCommandId,
  newBinding: string,
  overrides?: ShortcutOverrides | null,
  platformInfo?: ShortcutPlatformInfo,
): ShortcutConflict | null {
  const isApple = isApplePlatform(platformInfo);
  const newKey = canonicalBindingKey(newBinding, isApple);
  if (newKey === null) return { kind: "invalid", binding: newBinding };

  const reserved = getReservedCanonicalKeys()[isApple ? "apple" : "other"];
  if (reserved.has(newKey)) return { kind: "reserved", binding: newBinding };

  const effective = resolveEffectiveShortcutBindings(overrides);
  for (const entry of SHORTCUT_COMMANDS) {
    if (entry.id === commandId) continue;
    for (const binding of effective[entry.id] ?? []) {
      if (canonicalBindingKey(binding, isApple) === newKey) {
        return {
          kind: "occupied",
          binding: newBinding,
          ownerCommandId: entry.id,
          ownerManaged: entry.managed,
        };
      }
    }
  }
  return null;
}

/**
 * After the user confirms "use it anyway": assign the binding to `commandId`
 * and remove it from every managed command it was stolen from. Read-only
 * commands must already have been rejected by `checkShortcutBindingConflict`.
 */
export function buildShortcutOverridesAfterSteal(
  overrides: ShortcutOverrides | null | undefined,
  commandId: ShortcutCommandId,
  newBinding: string,
  platformInfo?: ShortcutPlatformInfo,
): ShortcutOverrides {
  const effective = resolveEffectiveShortcutBindings(overrides);
  const isApple = isApplePlatform(platformInfo);
  const newKey = canonicalBindingKey(newBinding, isApple);
  const next: Record<string, string[]> = {};
  for (const entry of SHORTCUT_COMMANDS) {
    if (entry.id === commandId) continue;
    const bindings = effective[entry.id] ?? [];
    const remaining = entry.managed
      ? bindings.filter((binding) => canonicalBindingKey(binding, isApple) !== newKey)
      : [...bindings];
    if (remaining.length !== bindings.length) next[entry.id] = remaining;
  }
  next[commandId] = [newBinding];
  return next;
}
