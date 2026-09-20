"use client";

import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import {
  getProviderEmoji,
  getProviderIconMode,
  getProviderIconModesVersion,
  resolveProviderIconSource,
  subscribeProviderIconModes,
  type ProviderIconMode,
} from "@/lib/provider-icon";

// 图标本体继续使用本仓库的 sprite（public/provider-icons.svg），不引外部图标库。
// 这里只负责「模式 + API 类型角标 + 自定义 emoji」三层决策的渲染。
const PROVIDER_ICONS: Record<string, { symbol: string; color: boolean }> = {
  anthropic: { symbol: "anthropic", color: false },
  openai: { symbol: "openai", color: false },
  "openai-codex": { symbol: "openai", color: false },
  google: { symbol: "google", color: true },
  "google-vertex": { symbol: "google", color: true },
  "ant-ling": { symbol: "antgroup", color: true },
  deepseek: { symbol: "deepseek", color: true },
  groq: { symbol: "groq", color: false },
  mistral: { symbol: "mistral", color: true },
  moonshotai: { symbol: "moonshot", color: false },
  "moonshotai-cn": { symbol: "moonshot", color: false },
  moonshot: { symbol: "moonshot", color: false },
  minimax: { symbol: "minimax", color: true },
  "minimax-cn": { symbol: "minimax", color: true },
  fireworks: { symbol: "fireworks", color: true },
  huggingface: { symbol: "huggingface", color: true },
  cerebras: { symbol: "cerebras", color: true },
  openrouter: { symbol: "openrouter", color: false },
  xai: { symbol: "xai", color: false },
  "cloudflare-ai-gateway": { symbol: "cloudflare", color: true },
  "cloudflare-workers-ai": { symbol: "cloudflare", color: true },
  "vercel-ai-gateway": { symbol: "vercel", color: false },
  "github-copilot": { symbol: "githubcopilot", color: false },
  "amazon-bedrock": { symbol: "aws", color: true },
  "azure-openai-responses": { symbol: "azure", color: true },
  "kimi-coding": { symbol: "kimi", color: true },
  nvidia: { symbol: "nvidia", color: true },
  opencode: { symbol: "opencode", color: false },
  "opencode-go": { symbol: "opencode", color: false },
  qwen: { symbol: "qwen", color: true },
  xiaomi: { symbol: "xiaomimimo", color: false },
  "xiaomi-token-plan-ams": { symbol: "xiaomimimo", color: false },
  "xiaomi-token-plan-cn": { symbol: "xiaomimimo", color: false },
  "xiaomi-token-plan-sgp": { symbol: "xiaomimimo", color: false },
  zai: { symbol: "zai", color: false },
  "zai-coding-cn": { symbol: "zai", color: false },
  zhipu: { symbol: "zhipu", color: true },
  cohere: { symbol: "cohere", color: true },
  perplexity: { symbol: "perplexity", color: true },
  together: { symbol: "together", color: true },
  grok: { symbol: "grok", color: false },
};

/**
 * API 类型 → sprite 中的代表品牌（"api" 模式或 auto 兜底时使用）。
 * `pi-messages` 没有对应 sprite，回退到 CPU 占位图标 + 角标字母。
 */
const API_TYPE_SPRITES: Record<string, { symbol: string; color: boolean }> = {
  "openai-completions": { symbol: "openai", color: false },
  "openai-responses": { symbol: "openai", color: false },
  "openai-codex-responses": { symbol: "openai", color: false },
  "azure-openai-responses": { symbol: "azure", color: true },
  "anthropic-messages": { symbol: "anthropic", color: false },
  "google-generative-ai": { symbol: "google", color: true },
  "google-vertex": { symbol: "google", color: true },
  "mistral-conversations": { symbol: "mistral", color: true },
  "bedrock-converse-stream": { symbol: "aws", color: true },
};

function SpriteIcon({ symbol, color, size }: { symbol: string; color: boolean; size: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color ? undefined : "currentColor"}
      style={{ color: "var(--text-muted)", flexShrink: 0 }}
    >
      <use href={`/provider-icons.svg#${symbol}`} />
    </svg>
  );
}

/** 右下角角标：显示 API 类型的代表字母。 */
function CornerBadge({ letter, size }: { letter: string; size: number }) {
  const badge = Math.max(7, Math.round(size * 0.58));
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        right: -1,
        bottom: -1,
        minWidth: badge,
        height: badge,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 1px",
        boxSizing: "border-box",
        borderRadius: Math.max(2, Math.round(size * 0.15)),
        background: "var(--bg-panel)",
        border: "1px solid currentColor",
        color: "currentColor",
        fontSize: Math.max(5, Math.round(size * 0.4)),
        fontWeight: 700,
        fontFamily: "var(--font-mono)",
        lineHeight: 1,
        pointerEvents: "none",
      }}
    >
      {letter}
    </span>
  );
}

/** 首字母徽章：透明圆角方块 + provider 的首个字母/数字。 */
function LetterBadge({ letter, size }: { letter: string; size: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        borderRadius: Math.max(3, Math.round(size * 0.28)),
        border: "1px solid currentColor",
        color: "currentColor",
        fontSize: Math.max(6, Math.round(size * 0.55)),
        fontWeight: 700,
        fontFamily: "var(--font-mono)",
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {letter}
    </span>
  );
}

/** 订阅 per-provider 图标模式仓库，模式切换后立即重渲染。 */
function useProviderIconMode(providerId: string): ProviderIconMode {
  useSyncExternalStore(subscribeProviderIconModes, getProviderIconModesVersion, () => 0);
  return getProviderIconMode(providerId);
}

/**
 * 渲染 provider 图标：预设 logo → API 类型代表图标（可带角标）→ 首字母 →
 * 自定义 emoji → CPU。每个 provider 的显示模式（auto/api/letter/emoji）在
 * ModelsConfig 里设置；显式传入的 `mode` 会覆盖存储值（用于设置页预览）。
 * auto 模式下预设 provider 保持纯 logo，角标只出现在兜底图标或强制 api 模式。
 */
export function ProviderIcon({ id, api, size = 14, mode }: { id: string; api?: string | null; size?: number; mode?: ProviderIconMode }) {
  const storedMode = useProviderIconMode(id);
  const emoji = getProviderEmoji(id);
  const normalizedId = id.toLowerCase();
  const source = resolveProviderIconSource(id, api, mode ?? storedMode, normalizedId in PROVIDER_ICONS, emoji);

  if (source.type === "emoji") {
    // emoji 字形在同样尺寸下视觉偏小，稍微放大一点与 logo 对齐；
    // 固定宽高保证列表对齐不跳。
    return (
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontSize: Math.max(10, Math.round(size * 1.08)),
          lineHeight: 1,
        }}
      >
        {source.emoji}
      </span>
    );
  }

  if (source.type === "letter") {
    return (
      <span style={{ position: "relative", display: "inline-flex", flexShrink: 0, width: size, height: size, color: "var(--text-muted)" }}>
        <LetterBadge letter={source.letter} size={size} />
      </span>
    );
  }

  let icon: ReactNode;
  if (source.type === "provider-logo") {
    const entry = PROVIDER_ICONS[normalizedId];
    icon = <SpriteIcon symbol={entry.symbol} color={entry.color} size={size} />;
  } else if (source.type === "api-logo") {
    const entry = API_TYPE_SPRITES[source.api];
    icon = entry ? <SpriteIcon symbol={entry.symbol} color={entry.color} size={size} /> : <DefaultModelIcon size={size} />;
  } else {
    icon = <DefaultModelIcon size={size} />;
  }

  return (
    // 外层负责相对定位角标；固定宽高保证列表对齐。
    <span style={{ position: "relative", display: "inline-flex", flexShrink: 0, width: size, height: size, color: "var(--text-muted)" }}>
      {icon}
      {source.type === "api-logo" && <CornerBadge letter={source.badge} size={size} />}
    </span>
  );
}

const MODEL_ICON_RULES: Array<[RegExp, string]> = [
  [/\b(?:claude|anthropic)\b/i, "anthropic"],
  [/\b(?:gpt|chatgpt|codex|o[1-9](?:[-.]\d+)?)\b/i, "openai"],
  [/\b(?:gemini|gemma)\b/i, "google"],
  [/\bdeepseek\b/i, "deepseek"],
  [/\b(?:grok|xai)\b/i, "grok"],
  [/\b(?:qwen|通义)\b/i, "qwen"],
  [/\b(?:glm|chatglm|智谱)\b/i, "zhipu"],
  [/\b(?:mistral|mixtral)\b/i, "mistral"],
  [/\b(?:kimi|moonshot)\b/i, "moonshot"],
  [/\bminimax\b/i, "minimax"],
];

function DefaultModelIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" />
    </svg>
  );
}

export function ModelIcon({ provider, modelId, modelName, size = 14 }: { provider: string; modelId: string; modelName?: string; size?: number }) {
  const text = `${modelId} ${modelName ?? ""}`;
  const matchedSymbol = MODEL_ICON_RULES.find(([pattern]) => pattern.test(text))?.[1];
  const providerIcon = PROVIDER_ICONS[provider.toLowerCase()];
  if (matchedSymbol) {
    const icon = PROVIDER_ICONS[matchedSymbol];
    return <SpriteIcon symbol={icon.symbol} color={icon.color} size={size} />;
  }
  if (providerIcon) return <SpriteIcon symbol={providerIcon.symbol} color={providerIcon.color} size={size} />;
  return <DefaultModelIcon size={size} />;
}
