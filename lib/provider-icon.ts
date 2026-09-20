/**
 * Provider 图标的三层决策：模式（auto/api/letter/emoji）+ API 类型角标 +
 * 每个 provider 的自定义 emoji。
 *
 * 这里是纯决策函数（可单测、不碰 DOM），加一个由 localStorage 支撑的
 * per-provider 设置仓库，供 `components/ProviderIcon.tsx` 与
 * `components/ModelsConfig.tsx` 共用；服务端调用时仓库是 no-op。
 *
 * 与 `lib/provider-listing.ts` 的关系：provider 列表与 auth capability 仍由
 * 那里的 `buildApiKeyProviderList` / `buildOAuthProviderList` 产出，本模块
 * 不复制任何 provider 表——调用方传入 providerId 与 api，图标本体继续用
 * `public/provider-icons.svg` 的 sprite（41 个映射）。
 */

export type ProviderIconMode = "auto" | "api" | "letter" | "emoji";

export const PROVIDER_ICON_MODES: readonly ProviderIconMode[] = ["auto", "api", "letter", "emoji"];

/** 全局默认模式（每个 provider 可在模型设置里覆盖）。 */
export const PROVIDER_ICON_MODES_KEY = "pi-provider-icon-mode";

/** 每个 provider 的自定义 emoji（mode 为 "emoji" 时使用）。 */
export const PROVIDER_ICON_EMOJIS_KEY = "pi-provider-icon-emoji";

/**
 * API 类型 → 图标右下角角标字母。
 * 字母取 API family 的代表首字母；不同 family 重字母没关系，主图标本身
 * 已经能区分（例如 openai-completions 与 openai-responses 都用 C/R）。
 */
export const API_TYPE_BADGES: Readonly<Record<string, string>> = {
  "openai-completions": "C",
  "openai-responses": "R",
  "openai-codex-responses": "X",
  "azure-openai-responses": "R",
  "anthropic-messages": "M",
  "google-generative-ai": "G",
  "google-vertex": "G",
  "mistral-conversations": "M",
  "bedrock-converse-stream": "B",
  "pi-messages": "P",
};

/** 已知 API 类型的角标字母；未知 API 类型返回 null。 */
export function resolveApiBadge(api: string | null | undefined): string | null {
  if (!api) return null;
  return API_TYPE_BADGES[api] ?? null;
}

/** provider id 的第一个字母/数字，大写；没有可用字符时返回 "?"。 */
export function resolveProviderLetter(providerId: string): string {
  const match = providerId.trim().match(/[a-zA-Z0-9]/);
  return match ? match[0].toUpperCase() : "?";
}

/** 解析持久化的模式值；任何非法值都归为 "auto"。 */
export function parseProviderIconMode(raw: unknown): ProviderIconMode {
  return raw === "api" || raw === "letter" || raw === "emoji" ? raw : "auto";
}

// Intl.Segmenter 会把 emoji ZWJ 序列（👨‍💻）和旗帜（🇨🇳）当成一个 grapheme；
// 用结构化类型声明，避免依赖 TS lib 版本是否声明了 Segmenter。
const graphemeSegmenter: { segment(input: string): Iterable<{ segment: string }> } | null =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new (Intl as unknown as {
        Segmenter: new (locale?: string, opts?: { granularity: string }) => { segment(input: string): Iterable<{ segment: string }> };
      }).Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** 取字符串的第一个 grapheme cluster；空串/纯空白返回 ""。 */
export function firstGrapheme(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (graphemeSegmenter) {
    for (const { segment } of graphemeSegmenter.segment(trimmed)) return segment;
  }
  return Array.from(trimmed)[0] ?? "";
}

export type ProviderIconSource =
  | { type: "letter"; letter: string }
  | { type: "provider-logo" }
  | { type: "api-logo"; api: string; badge: string }
  | { type: "emoji"; emoji: string }
  | { type: "cpu" };

/**
 * 解析某个 provider/model 单元格该画什么图标。
 * - emoji：该 provider 的自定义 emoji；没有存储时退回首字母而不是空白。
 * - letter：永远首字母，不带角标。
 * - api：API 类型的代表图标 + 角标字母。
 * - auto：有预设 logo 的 provider 用纯 logo（不加角标），否则用 API 类型
 *   代表图标 + 角标，再否则用 CPU 占位。
 */
export function resolveProviderIconSource(
  providerId: string,
  api: string | null | undefined,
  mode: ProviderIconMode,
  hasProviderLogo: boolean,
  emoji?: string | null,
): ProviderIconSource {
  if (mode === "emoji") {
    const glyph = emoji ? firstGrapheme(emoji) : "";
    if (glyph) return { type: "emoji", emoji: glyph };
    return { type: "letter", letter: resolveProviderLetter(providerId) };
  }
  if (mode === "letter") return { type: "letter", letter: resolveProviderLetter(providerId) };
  const badge = resolveApiBadge(api);
  if (mode === "api") {
    if (badge && api) return { type: "api-logo", api, badge };
    // 没有 API 类型信息（例如没有 model 上下文的 provider 列表）：保留
    // 预设 logo，而不是把每个格子都降级成 CPU 图标。
    if (hasProviderLogo) return { type: "provider-logo" };
    return { type: "cpu" };
  }
  // auto：预设 provider 保持纯 logo——角标只是「没有预设 logo」时的兜底表现。
  if (hasProviderLogo) return { type: "provider-logo" };
  if (badge && api) return { type: "api-logo", api, badge };
  return { type: "cpu" };
}

// ── Per-provider 模式仓库（仅客户端）────────────────────────────────────────

function loadStoredModes(): Record<string, ProviderIconMode> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PROVIDER_ICON_MODES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const modes: Record<string, ProviderIconMode> = {};
    for (const [providerId, value] of Object.entries(parsed)) {
      modes[providerId] = parseProviderIconMode(value);
    }
    return modes;
  } catch {
    // 无法读取或不是 JSON：当作未设置。
    return {};
  }
}

let modesCache: Record<string, ProviderIconMode> | null = null;
let modesVersion = 0;
const listeners = new Set<() => void>();

/** 读取某个 provider 当前的图标模式；未设置时返回 "auto"。 */
export function getProviderIconMode(providerId: string): ProviderIconMode {
  if (modesCache === null) modesCache = loadStoredModes();
  return modesCache[providerId] ?? "auto";
}

/** 单调递增的版本号，供 useSyncExternalStore 当快照使用。 */
export function getProviderIconModesVersion(): number {
  return modesVersion;
}

export function subscribeProviderIconModes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 持久化某个 provider 的图标模式，并通知所有订阅者。 */
export function setProviderIconMode(providerId: string, mode: ProviderIconMode): void {
  const modes = loadStoredModes();
  if (mode === "auto") delete modes[providerId];
  else modes[providerId] = mode;
  try {
    window.localStorage.setItem(PROVIDER_ICON_MODES_KEY, JSON.stringify(modes));
  } catch {
    // 存储不可用（隐私模式）：改动只是无法跨刷新保留。
  }
  modesCache = null;
  modesVersion++;
  for (const listener of listeners) listener();
}

// ── Per-provider emoji 仓库（仅客户端）──────────────────────────────────────

function loadStoredEmojis(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PROVIDER_ICON_EMOJIS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const emojis: Record<string, string> = {};
    for (const [providerId, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim()) emojis[providerId] = value;
    }
    return emojis;
  } catch {
    // 无法读取或不是 JSON：当作未设置。
    return {};
  }
}

let emojisCache: Record<string, string> | null = null;

/** 读取某个 provider 存储的 emoji（原始存储值）；未设置时返回 null。 */
export function getProviderEmoji(providerId: string): string | null {
  if (emojisCache === null) emojisCache = loadStoredEmojis();
  return emojisCache[providerId] ?? null;
}

/**
 * 持久化某个 provider 的自定义 emoji（只保留第一个 grapheme，ZWJ 序列不会被
 * 截断），并通知订阅者。空值/null 表示清除。
 */
export function setProviderEmoji(providerId: string, emoji: string | null): void {
  const emojis = loadStoredEmojis();
  const glyph = emoji ? firstGrapheme(emoji) : "";
  if (glyph) emojis[providerId] = glyph;
  else delete emojis[providerId];
  try {
    window.localStorage.setItem(PROVIDER_ICON_EMOJIS_KEY, JSON.stringify(emojis));
  } catch {
    // 存储不可用：改动只是无法跨刷新保留。
  }
  emojisCache = null;
  modesVersion++;
  for (const listener of listeners) listener();
}
