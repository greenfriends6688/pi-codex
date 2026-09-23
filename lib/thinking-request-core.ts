/**
 * 思考等级「实际请求参数」的纯逻辑镜像（无 pi-ai / Node 依赖，客户端编辑态预览与服务端 profile 共用）。
 *
 * 这是对 pi-ai 各 `api/*.js` 请求构造逻辑的**只读镜像**，仅用于展示与一致化
 * （配置页逐行显示「实际会发什么」、编辑 thinkingLevelMap 时实时预览）。
 * 真正请求仍由 SDK 构造，本文件不参与运行时请求。
 *
 * ── SDK 对照（本仓库 pin 的 @earendil-works/pi-ai@0.85.1） ──────────────────
 * 对照文件均在 `node_modules/@earendil-works/pi-ai/dist/` 下：
 * - `models.js`：`getSupportedThinkingLevels` / `clampThinkingLevel`（等级支持表与 clamp）
 * - `api/openai-completions.js`：`buildParams` 的 thinking 分支 + `detectCompat`/`getCompat`
 * - `api/openai-responses.js` / `api/azure-openai-responses.js` / `api/openai-codex-responses.js`
 * - `api/anthropic-messages.js`：`streamSimple` + `buildParams`
 * - `api/google-generative-ai.js` / `api/google-vertex.js` / `api/google-shared.js`
 * - `api/bedrock-converse-stream.js`：Claude 的 adaptive/budget 分支
 * - `api/mistral-conversations.js`
 * - `api/simple-options.js`：`DEFAULT_THINKING_BUDGETS` / `clampReasoning`
 *
 * 注意：REF 的 205 行版本按旧分支假设「compat 只看模型显式字段、google 统一 effort+budget」，
 * 与 0.85.1 不一致；本文件按 0.85.1 的实际行为重写：
 * 1. openai-completions 的 `supportsReasoningEffort`/`thinkingFormat` 会先按 provider/baseUrl
 *    自动探测（`detectCompat`），显式 `compat` 只做覆盖；
 * 2. google 在 Gemini 3 Pro/Flash、Gemma 4 上发 `thinkingConfig.thinkingLevel`，
 *    其余模型按模型 id 选 `thinkingConfig.thinkingBudget`（不再统一用 effort+budget）；
 * 3. `xhigh`/`max` 在预算类分支被 clamp 到 `high`；
 * 4. `off` 档由 pi-agent-core 以「省略 reasoning 字段」实现
 *    （`node_modules/@earendil-works/pi-agent-core/dist/agent.js` 中
 *    `reasoning: thinkingLevel === "off" ? undefined : thinkingLevel`），
 *    所以 off 不是字符串 "off" 传给 SDK。
 *
 * SDK 升级后必须重新 diff 上述文件，并由 `lib/thinking-profile.test.mjs` 钉住关键分支。
 */

/**
 * 权威抽象等级集合（升序，与 pi-ai `EXTENDED_THINKING_LEVELS` 一致）。
 * 本仓库尚无独立的 `lib/thinking-levels.ts`，所以常量先落在本文件内。
 */
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** 请求体中「推理相关」的 JSON 片段（空对象 = 该等级不添加任何推理参数）。 */
export type ThinkingRequestParams = Record<string, unknown>;

/**
 * 单个等级实际构造的请求参数描述。
 * `params` 是该等级会附加到请求体上的推理字段片段；`kind` 只是给 UI 分类用的粗粒度标签。
 */
export type ThinkingRequestSpec =
  | { kind: "effort"; effort: string; budgetTokens?: number; params: ThinkingRequestParams }
  | { kind: "toggle"; enabled: boolean; effort?: string; params: ThinkingRequestParams }
  | { kind: "budget"; budgetTokens: number; params: ThinkingRequestParams }
  /** 该档不可关闭（map.off === null）或 SDK 不会发送任何推理参数。 */
  | { kind: "off"; params: ThinkingRequestParams }
  /** 映射值非法，SDK 实际会抛错（目前仅 google 的 thinkingLevelMap 会校验）。 */
  | { kind: "invalid"; error: string; params: ThinkingRequestParams };

/** 计算 profile 所需的模型字段（不依赖完整 Model 对象，客户端可只传编辑中的字段）。 */
export interface ThinkingModelFields {
  provider?: string;
  id?: string;
  name?: string;
  baseUrl?: string;
  api?: string;
  reasoning?: boolean;
  /** 模型输出上限。预算类分支会按「至少给答案留 1024 token」再夹一次（见 clampedBudgetForLevel）。 */
  maxTokens?: number;
  compat?: Record<string, unknown>;
}

export interface ModelThinkingProfile {
  /** 权威支持表 = getSupportedThinkingLevels 结果，随 reasoning + thinkingLevelMap 实时变化。 */
  levels: string[];
  /** 有效映射（provider 默认 + 用户 models.json 合并后）。 */
  map: Record<string, string | null>;
  /** 全部 7 个抽象等级各自的实际请求描述（配置页逐行展示）。 */
  requests: Record<string, ThinkingRequestSpec>;
  /** 计算该 profile 所需的模型字段（供编辑态实时预览复用）。 */
  meta: ThinkingModelFields;
}

/** budget 模式各档预算（镜像 pi-ai `api/simple-options.js` DEFAULT_THINKING_BUDGETS）。 */
const DEFAULT_THINKING_BUDGETS: Record<string, number> = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
};

/** 镜像 pi-ai `api/simple-options.js` clampReasoning：xhigh/max 归一到 high。 */
function clampReasoning(level: string): string {
  return level === "xhigh" || level === "max" ? "high" : level;
}

/** 预算类档位的名义预算；xhigh/max → high。 */
function thinkingBudgetForLevel(level: string): number | undefined {
  return DEFAULT_THINKING_BUDGETS[clampReasoning(level)];
}

/** pi-ai `MIN_ANSWER_TOKENS`：思考预算和答案共享输出上限时，至少给答案留这么多。 */
const MIN_ANSWER_TOKENS = 1024;

/**
 * 实际发出的预算 = 名义预算按 answer room 夹取后的值（镜像 pi-ai `adjustMaxTokensForThinking`
 * + `clampThinkingBudgetToAnswerRoom`）。
 *
 * pi-ai 只在 `maxTokens <= budget` 时才夹，等价于 `min(budget, max(0, maxTokens - 1024))`；
 * `maxTokens` 未知（老调用方只传 id/provider）时退回名义值。
 */
function clampedBudgetForLevel(level: string, model: ThinkingModelFields): number | undefined {
  const nominal = thinkingBudgetForLevel(level);
  if (nominal === undefined) return undefined;
  const ceiling = model.maxTokens;
  if (typeof ceiling !== "number" || !Number.isFinite(ceiling)) return nominal;
  return ceiling <= nominal ? Math.min(nominal, Math.max(0, ceiling - MIN_ANSWER_TOKENS)) : nominal;
}

function mappedString(
  map: Record<string, string | null>,
  level: string,
): string | undefined {
  const value = map[level];
  return typeof value === "string" ? value : undefined;
}

function mappedOrLevel(map: Record<string, string | null>, level: string): string {
  return mappedString(map, level) ?? level;
}

/**
 * 权威支持表（镜像 pi-ai `models.js` getSupportedThinkingLevels）：
 * - 非 reasoning 模型只有 off；
 * - off 映射 null → 不支持；
 * - xhigh/max 未显式映射 → 不支持。
 */
export function supportedLevelsFromFields(
  model: ThinkingModelFields,
  map: Record<string, string | null>,
): string[] {
  if (!model.reasoning) return ["off"];
  return THINKING_LEVELS.filter((level) => {
    const mapped = map[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

/**
 * 等级归一（镜像 pi-ai `models.js` clampThinkingLevel）：
 * 请求的等级不受支持时，先向上找更强的档，再向下找更弱的档，最后退回支持表首项。
 */
export function clampLevelFromFields(
  model: ThinkingModelFields,
  level: string,
  map: Record<string, string | null>,
): string {
  const available = supportedLevelsFromFields(model, map);
  if (available.includes(level)) return level;
  const requestedIndex = (THINKING_LEVELS as readonly string[]).indexOf(level);
  if (requestedIndex === -1) return available[0] ?? "off";
  for (let i = requestedIndex; i < THINKING_LEVELS.length; i++) {
    if (available.includes(THINKING_LEVELS[i])) return THINKING_LEVELS[i];
  }
  for (let i = requestedIndex - 1; i >= 0; i--) {
    if (available.includes(THINKING_LEVELS[i])) return THINKING_LEVELS[i];
  }
  return available[0] ?? "off";
}

// ── openai-completions：compat 探测（镜像 0.85.1 getCompat + detectCompat） ──

interface OpenAiThinkingCompat {
  supportsReasoningEffort: boolean;
  thinkingFormat: string;
  supportsThinkingTokenBudget: boolean;
  thinkingTokenBudgetField: string | undefined;
}

/**
 * 镜像 `api/openai-completions.js` 的 `detectCompat`（只保留推理相关字段）。
 * 0.85.1 会按 provider/baseUrl 自动探测，显式 compat 只覆盖对应键。
 */
function detectOpenAiThinkingCompat(model: ThinkingModelFields): OpenAiThinkingCompat {
  const provider = model.provider ?? "";
  const baseUrl = model.baseUrl ?? "";
  const isZai = provider === "zai"
    || provider === "zai-coding-cn"
    || baseUrl.includes("api.z.ai")
    || baseUrl.includes("open.bigmodel.cn");
  const isTogether = provider === "together"
    || baseUrl.includes("api.together.ai")
    || baseUrl.includes("api.together.xyz");
  const isMoonshot = provider === "moonshotai"
    || provider === "moonshotai-cn"
    || baseUrl.includes("api.moonshot.");
  const isOpenRouter = provider === "openrouter" || baseUrl.includes("openrouter.ai");
  const isCloudflareAiGateway = provider === "cloudflare-ai-gateway" || baseUrl.includes("gateway.ai.cloudflare.com");
  const isNvidia = provider === "nvidia" || baseUrl.includes("integrate.api.nvidia.com");
  const isAntLing = provider === "ant-ling" || baseUrl.includes("api.ant-ling.com");
  const isDeepSeek = provider === "deepseek" || baseUrl.toLowerCase().includes("deepseek.com");
  const isGrok = provider === "xai" || baseUrl.includes("api.x.ai");
  return {
    supportsReasoningEffort: !isGrok
      && !isZai
      && !isMoonshot
      && !isTogether
      && !isCloudflareAiGateway
      && !isNvidia
      && !isAntLing,
    thinkingFormat: isDeepSeek
      ? "deepseek"
      : isZai
        ? "zai"
        : isTogether
          ? "together"
          : isAntLing
            ? "ant-ling"
            : isOpenRouter
              ? "openrouter"
              : "openai",
    // detectCompat 默认不支持 token budget；只有显式 compat 才会打开。
    supportsThinkingTokenBudget: false,
    thinkingTokenBudgetField: undefined,
  };
}

function resolveOpenAiThinkingCompat(model: ThinkingModelFields): OpenAiThinkingCompat {
  const detected = detectOpenAiThinkingCompat(model);
  const compat = model.compat ?? {};
  return {
    supportsReasoningEffort: typeof compat.supportsReasoningEffort === "boolean"
      ? compat.supportsReasoningEffort
      : detected.supportsReasoningEffort,
    thinkingFormat: typeof compat.thinkingFormat === "string"
      ? compat.thinkingFormat
      : detected.thinkingFormat,
    supportsThinkingTokenBudget: typeof compat.supportsThinkingTokenBudget === "boolean"
      ? compat.supportsThinkingTokenBudget
      : detected.supportsThinkingTokenBudget,
    thinkingTokenBudgetField: typeof compat.thinkingTokenBudgetField === "string"
      ? compat.thinkingTokenBudgetField
      : detected.thinkingTokenBudgetField,
  };
}

/** 镜像 `api/openai-completions.js` resolveThinkingTokenBudgetField。 */
function resolveThinkingTokenBudgetField(compat: OpenAiThinkingCompat): string | undefined {
  if (compat.thinkingTokenBudgetField) return compat.thinkingTokenBudgetField;
  if (compat.supportsThinkingTokenBudget) return "thinking_token_budget";
  return undefined;
}

/** 镜像 `api/openai-completions.js` resolveChatTemplateKwargValue（chat-template / baseten）。 */
function resolveChatTemplateKwargValue(
  model: ThinkingModelFields,
  level: string,
  map: Record<string, string | null>,
  value: unknown,
  thinkingBudget: number | undefined,
): unknown {
  if (typeof value !== "object" || value === null) return value;
  const entry = value as { $var?: string; omitWhenOff?: boolean };
  const reasoningEffort = level === "off" ? undefined : level;
  if (!reasoningEffort && entry.omitWhenOff) return undefined;
  if (entry.$var === "thinking.enabled") return Boolean(reasoningEffort);
  if (entry.$var === "thinking.budget") return thinkingBudget;
  const mapped = reasoningEffort ? map[reasoningEffort] : map.off;
  return mapped === undefined ? reasoningEffort : typeof mapped === "string" ? mapped : undefined;
}

function buildChatTemplateValues(
  model: ThinkingModelFields,
  level: string,
  map: Record<string, string | null>,
  values: unknown,
  thinkingBudget: number | undefined,
): Record<string, unknown> | undefined {
  if (typeof values !== "object" || values === null) return undefined;
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    const next = resolveChatTemplateKwargValue(model, level, map, value, thinkingBudget);
    if (next !== undefined) resolved[key] = next;
  }
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function describeOpenAiCompletions(
  model: ThinkingModelFields,
  level: string,
  map: Record<string, string | null>,
): ThinkingRequestSpec {
  if (!model.reasoning) return { kind: "off", params: {} };
  const compat = resolveOpenAiThinkingCompat(model);
  const base = describeOpenAiCompletionsFormat(model, level, map, compat);
  return withOpenAiBudget(model, base, level === "off" ? undefined : clampLevelFromFields(model, level, map), compat);
}

/** 追加顶层 token budget 字段（与 thinkingFormat 无关，只要 supportsThinkingTokenBudget 就附加）。 */
function withOpenAiBudget(
  model: ThinkingModelFields,
  spec: ThinkingRequestSpec,
  reasoningEffort: string | undefined,
  compat: OpenAiThinkingCompat,
): ThinkingRequestSpec {
  if (!reasoningEffort || !compat.supportsThinkingTokenBudget) return spec;
  const nominalBudget = clampedBudgetForLevel(reasoningEffort, model);
  if (nominalBudget === undefined) return spec;
  const field = resolveThinkingTokenBudgetField(compat) ?? "thinking_token_budget";
  const params = { ...spec.params, [field]: nominalBudget };
  return spec.kind === "effort"
    ? { ...spec, budgetTokens: nominalBudget, params }
    : { ...spec, params };
}

function describeOpenAiCompletionsFormat(
  model: ThinkingModelFields,
  level: string,
  map: Record<string, string | null>,
  compat: OpenAiThinkingCompat,
): ThinkingRequestSpec {
  const isOff = level === "off";
  // 镜像 streamSimple：先 clamp 再决定 reasoningEffort；off 表示省略该字段。
  const effective = isOff ? "off" : clampLevelFromFields(model, level, map);
  const reasoningEffort = effective === "off" ? undefined : effective;
  const format = compat.thinkingFormat;
  const nominalBudget = reasoningEffort ? thinkingBudgetForLevel(reasoningEffort) : undefined;

  if (format === "zai") {
    const params: ThinkingRequestParams = {
      thinking: reasoningEffort
        ? { type: "enabled", clear_thinking: false }
        : { type: "disabled" },
    };
    let effort: string | undefined;
    if (reasoningEffort && compat.supportsReasoningEffort) {
      const mapped = map[reasoningEffort];
      const value = mapped === undefined ? reasoningEffort : mapped;
      if (typeof value === "string") {
        params.reasoning_effort = value;
        effort = value;
      }
    }
    return effort !== undefined
      ? { kind: "effort", effort, params }
      : { kind: "toggle", enabled: Boolean(reasoningEffort), params };
  }

  if (format === "qwen") {
    const params: ThinkingRequestParams = { enable_thinking: Boolean(reasoningEffort) };
    let effort: string | undefined;
    if (reasoningEffort && compat.supportsReasoningEffort) {
      const value = mappedOrLevel(map, reasoningEffort);
      params.reasoning_effort = value;
      effort = value;
    }
    return effort !== undefined
      ? { kind: "effort", effort, params }
      : { kind: "toggle", enabled: Boolean(reasoningEffort), params };
  }

  if (format === "qwen-chat-template") {
    return {
      kind: "toggle",
      enabled: Boolean(reasoningEffort),
      params: { chat_template_kwargs: { enable_thinking: Boolean(reasoningEffort), preserve_thinking: true } },
    };
  }

  if (format === "chat-template") {
    const kwargs = buildChatTemplateValues(
      model,
      effective,
      map,
      model.compat?.chatTemplateKwargs,
      nominalBudget,
    );
    return {
      kind: "toggle",
      enabled: Boolean(reasoningEffort),
      params: kwargs ? { chat_template_kwargs: kwargs } : {},
    };
  }

  if (format === "baseten") {
    const params: ThinkingRequestParams = {};
    const args = buildChatTemplateValues(
      model,
      effective,
      map,
      model.compat?.chatTemplateArgs,
      nominalBudget,
    );
    if (args) params.chat_template_args = args;
    if (compat.supportsReasoningEffort) {
      const requested = reasoningEffort;
      const mapped = requested ? map[requested] : map.off;
      const value = mapped === undefined ? requested : mapped;
      if (typeof value === "string") {
        params.reasoning_effort = value;
        return { kind: "effort", effort: value, params };
      }
    }
    return { kind: "toggle", enabled: Boolean(reasoningEffort), params };
  }

  if (format === "deepseek") {
    const params: ThinkingRequestParams = {};
    if (reasoningEffort) params.thinking = { type: "enabled" };
    else if (map.off !== null) params.thinking = { type: "disabled" };
    if (reasoningEffort && compat.supportsReasoningEffort) {
      params.reasoning_effort = mappedOrLevel(map, reasoningEffort);
    }
    return params.reasoning_effort !== undefined
      ? { kind: "effort", effort: String(params.reasoning_effort), params }
      : { kind: "toggle", enabled: Boolean(reasoningEffort), params };
  }

  if (format === "openrouter") {
    // 0.85.1：openrouter 无视 supportsReasoningEffort，非 off 一律发嵌套 reasoning.effort。
    if (reasoningEffort) {
      const effort = mappedOrLevel(map, reasoningEffort);
      return { kind: "effort", effort, params: { reasoning: { effort } } };
    }
    if (map.off !== null) {
      const effort = typeof map.off === "string" ? map.off : "none";
      return { kind: "off", params: { reasoning: { effort } } };
    }
    return { kind: "off", params: {} };
  }

  if (format === "ant-ling") {
    if (reasoningEffort) {
      const mapped = map[reasoningEffort];
      if (typeof mapped === "string") {
        return { kind: "effort", effort: mapped, params: { reasoning: { effort: mapped } } };
      }
    }
    return { kind: "toggle", enabled: Boolean(reasoningEffort), params: {} };
  }

  if (format === "together") {
    const params: ThinkingRequestParams = { reasoning: { enabled: Boolean(reasoningEffort) } };
    if (reasoningEffort && compat.supportsReasoningEffort) {
      const effort = mappedOrLevel(map, reasoningEffort);
      params.reasoning_effort = effort;
      return { kind: "effort", effort, params };
    }
    return { kind: "toggle", enabled: Boolean(reasoningEffort), params };
  }

  if (format === "string-thinking") {
    if (reasoningEffort) {
      const thinking = mappedOrLevel(map, reasoningEffort);
      return { kind: "effort", effort: thinking, params: { thinking } };
    }
    if (map.off !== null) {
      const thinking = typeof map.off === "string" ? map.off : "none";
      return { kind: "off", params: { thinking } };
    }
    return { kind: "off", params: {} };
  }

  // 默认（标准 OpenAI 兼容 / 显式 "openai" / moonshot 等自动探测为 openai 的 provider）。
  if (reasoningEffort && compat.supportsReasoningEffort) {
    const effort = mappedOrLevel(map, reasoningEffort);
    return { kind: "effort", effort, params: { reasoning_effort: effort } };
  }
  if (!reasoningEffort && compat.supportsReasoningEffort && typeof map.off === "string") {
    return { kind: "off", params: { reasoning_effort: map.off } };
  }
  // 非 off 但 supportsReasoningEffort=false：0.85.1 不会附加任何推理参数。
  return { kind: "toggle", enabled: Boolean(reasoningEffort), params: {} };
}

// ── openai-responses 家族 ────────────────────────────────────────────────────

const RESPONSES_REASONING_INCLUDE = ["reasoning.encrypted_content"];

function describeOpenAiResponses(
  model: ThinkingModelFields,
  level: string,
  map: Record<string, string | null>,
): ThinkingRequestSpec {
  if (!model.reasoning) return { kind: "off", params: {} };
  if (level === "off") {
    // github-copilot 不发 reasoning；off:null 时也不发。off 分支不带 include（xai 除外）。
    if (map.off === null || model.provider === "github-copilot") return { kind: "off", params: {} };
    return {
      kind: "off",
      params: {
        reasoning: { effort: typeof map.off === "string" ? map.off : "none" },
        ...(model.provider === "xai" ? { include: RESPONSES_REASONING_INCLUDE } : {}),
      },
    };
  }
  const effort = mappedOrLevel(map, clampLevelFromFields(model, level, map));
  return {
    kind: "effort",
    effort,
    params: { reasoning: { effort, summary: "auto" }, include: RESPONSES_REASONING_INCLUDE },
  };
}

function describeAzureResponses(
  model: ThinkingModelFields,
  level: string,
  map: Record<string, string | null>,
): ThinkingRequestSpec {
  if (!model.reasoning) return { kind: "off", params: {} };
  if (level === "off") {
    // azure 的 off 分支不写 include（见 api/azure-openai-responses.js buildParams）。
    if (map.off === null) return { kind: "off", params: {} };
    return { kind: "off", params: { reasoning: { effort: typeof map.off === "string" ? map.off : "none" } } };
  }
  const effort = mappedOrLevel(map, clampLevelFromFields(model, level, map));
  return {
    kind: "effort",
    effort,
    params: { reasoning: { effort, summary: "auto" }, include: RESPONSES_REASONING_INCLUDE },
  };
}

function describeCodexResponses(
  model: ThinkingModelFields,
  level: string,
  map: Record<string, string | null>,
): ThinkingRequestSpec {
  if (!model.reasoning) return { kind: "off", params: {} };
  if (level === "off") return { kind: "off", params: {} };
  const effort = mappedOrLevel(map, clampLevelFromFields(model, level, map));
  return { kind: "effort", effort, params: { reasoning: { effort, summary: "auto" } } };
}

// ── anthropic-messages ───────────────────────────────────────────────────────

/** 镜像 `api/anthropic-messages.js` mapThinkingLevelToEffort。 */
function anthropicDefaultEffort(level: string): string {
  if (level === "minimal" || level === "low") return "low";
  if (level === "medium") return "medium";
  if (level === "high") return "high";
  return "high";
}

function describeAnthropic(
  model: ThinkingModelFields,
  level: string,
  map: Record<string, string | null>,
): ThinkingRequestSpec {
  if (!model.reasoning) return { kind: "off", params: {} };
  const compat = model.compat ?? {};
  const supportsMidConvoEffort = compat.supportsMidConvoEffort === true;
  const forceAdaptiveThinking = compat.forceAdaptiveThinking === true;
  // 0.85.1 对 supportsMidConvoEffort 模型在 buildParams 里写死 output_config.effort="high"，
  // 真实档位通过 insertThinkingLevelMessages 注入到消息里（这里只描述推理字段）。
  if (supportsMidConvoEffort) {
    return {
      kind: "effort",
      effort: "high",
      params: {
        thinking: {
          type: "adaptive",
          display: "summarized",
          block_binding: { prefix_mismatch_behavior: "drop_block" },
        },
        output_config: { effort: "high" },
      },
    };
  }
  if (level === "off") {
    if (map.off === null) return { kind: "off", params: {} };
    return { kind: "toggle", enabled: false, params: { thinking: { type: "disabled" } } };
  }
  const effective = clampLevelFromFields(model, level, map);
  if (forceAdaptiveThinking) {
    const effort = mappedString(map, effective) ?? anthropicDefaultEffort(effective);
    return {
      kind: "effort",
      effort,
      params: {
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort },
      },
    };
  }
  // 老模型：预算随等级变化，xhigh/max clamp 到 high；buildParams 里 `thinkingBudgetTokens || 1024`，
  // 再按 answer room 夹一次（`Math.min(adjusted.thinkingBudget, max(0, maxTokens - 1024))`）。
  const budget = clampedBudgetForLevel(effective, model) ?? 1024;
  return {
    kind: "budget",
    budgetTokens: budget,
    params: { thinking: { type: "enabled", budget_tokens: budget, display: "summarized" } },
  };
}

// ── google-generative-ai / google-vertex ─────────────────────────────────────

/**
 * 镜像 `api/google-shared.js` `usesGoogleThinkingLevel`：只有这些模型走离散 thinkingLevel，
 * 其余走 token 预算。0.87 起 vertex 与 generative-ai 用同一个判定（不再区分 Gemma）。
 */
function googleUsesThinkingLevel(model: ThinkingModelFields): boolean {
  const id = (model.id ?? "").toLowerCase();
  return /gemini-3(?:\.\d+)?-(?:pro|flash)/.test(id)
    || id === "gemini-flash-latest"
    || id === "gemini-flash-lite-latest"
    || /gemma-?4/.test(id);
}

/**
 * 镜像 `api/google-shared.js` `getDisabledGoogleThinkingConfig`：
 * 走预算的模型（含 2.5 系列）off → `thinkingBudget: 0`；走 thinkingLevel 的模型先 clamp 回退档，
 * 回退仍是 off 才用预算 0，否则发那一档的 thinkingLevel。
 */
function googleDisabledThinkingConfig(
  model: ThinkingModelFields,
  map: Record<string, string | null>,
): ThinkingRequestParams {
  if (!googleUsesThinkingLevel(model)) return { thinkingBudget: 0 };
  const fallback = clampLevelFromFields(model, "off", map);
  if (fallback === "off") return { thinkingBudget: 0 };
  const resolved = resolveGoogleLevel(map, fallback);
  if ("error" in resolved) return { thinkingBudget: 0 };
  const level = googleThinkingLevelValue(resolved.level);
  return level === undefined ? { thinkingBudget: 0 } : { thinkingLevel: level };
}

/** 镜像 `api/google-shared.js` resolveGoogleThinkingLevel（会抛错的非法映射由调用方捕获）。 */
function resolveGoogleLevel(
  map: Record<string, string | null>,
  level: string,
): { level: string } | { error: string } {
  if (level === "off") return { level: "high" };
  const mapped = map[level];
  const resolved = (typeof mapped === "string" ? mapped.toLowerCase() : level);
  if (resolved === "minimal" || resolved === "low" || resolved === "medium" || resolved === "high") {
    return { level: resolved };
  }
  return { error: `Unsupported Google thinking level mapping for ${level} -> ${String(mapped)}` };
}

/**
 * 镜像 `api/google-shared.js` `toGoogleThinkingLevel`。
 * 0.87 起四档一一对应（0.85.1 的 Pro/Gemma 折叠映射已不适用）。
 */
function googleThinkingLevelValue(level: string): string | undefined {
  if (level === "minimal") return "MINIMAL";
  if (level === "low") return "LOW";
  if (level === "medium") return "MEDIUM";
  if (level === "high") return "HIGH";
  return undefined;
}

/** 镜像 `api/google-generative-ai.js` getGoogleBudget（按模型 id 选表，未知返回 -1）。 */
function googleBudgetForLevel(model: ThinkingModelFields, level: string): number {
  const id = model.id ?? "";
  if (id.includes("2.5-pro")) {
    return { minimal: 128, low: 2048, medium: 8192, high: 32768 }[level] ?? -1;
  }
  if (id.includes("2.5-flash-lite")) {
    return { minimal: 512, low: 2048, medium: 8192, high: 24576 }[level] ?? -1;
  }
  if (id.includes("2.5-flash")) {
    return { minimal: 128, low: 2048, medium: 8192, high: 24576 }[level] ?? -1;
  }
  return -1;
}

function describeGoogle(
  model: ThinkingModelFields,
  level: string,
  map: Record<string, string | null>,
): ThinkingRequestSpec {
  if (!model.reasoning) return { kind: "off", params: {} };
  if (level === "off") {
    if (map.off === null) return { kind: "off", params: {} };
    return {
      kind: "toggle",
      enabled: false,
      params: { thinkingConfig: googleDisabledThinkingConfig(model, map) },
    };
  }
  const effective = clampLevelFromFields(model, level, map);
  const resolved = resolveGoogleLevel(map, effective);
  if ("error" in resolved) return { kind: "invalid", error: resolved.error, params: {} };
  if (googleUsesThinkingLevel(model)) {
    const thinkingLevel = googleThinkingLevelValue(resolved.level);
    if (thinkingLevel === undefined) {
      return {
        kind: "invalid",
        error: `Google thinkingLevel has no mapping for ${resolved.level}`,
        params: {},
      };
    }
    return {
      kind: "effort",
      effort: resolved.level,
      params: { thinkingConfig: { includeThoughts: true, thinkingLevel } },
    };
  }
  const budget = googleBudgetForLevel(model, resolved.level);
  return {
    kind: "budget",
    budgetTokens: budget,
    params: { thinkingConfig: { includeThoughts: true, thinkingBudget: budget } },
  };
}

// ── bedrock-converse-stream ──────────────────────────────────────────────────

function bedrockModelCandidates(model: ThinkingModelFields): string[] {
  const values = model.name ? [model.id ?? "", model.name] : [model.id ?? ""];
  return values.flatMap((value) => {
    const lower = value.toLowerCase();
    return [lower, lower.replace(/[\s_.:]+/g, "-")];
  });
}

function isBedrockAnthropicClaude(model: ThinkingModelFields): boolean {
  const id = (model.id ?? "").toLowerCase();
  const name = (model.name ?? "").toLowerCase();
  return id.includes("anthropic.claude")
    || id.includes("anthropic/claude")
    || name.includes("anthropic.claude")
    || name.includes("anthropic/claude")
    || name.includes("claude");
}

function bedrockSupportsAdaptiveThinking(model: ThinkingModelFields): boolean {
  return bedrockModelCandidates(model).some((candidate) =>
    candidate.includes("opus-4-6")
    || candidate.includes("opus-4-7")
    || candidate.includes("opus-4-8")
    || candidate.includes("opus-5")
    || candidate.includes("sonnet-4-6")
    || candidate.includes("sonnet-5")
    || candidate.includes("fable-5"));
}

function bedrockSupportsNativeXhigh(model: ThinkingModelFields): boolean {
  return bedrockModelCandidates(model).some((candidate) =>
    candidate.includes("opus-4-7")
    || candidate.includes("opus-4-8")
    || candidate.includes("opus-5")
    || candidate.includes("sonnet-5")
    || candidate.includes("fable-5"));
}

function describeBedrock(
  model: ThinkingModelFields,
  level: string,
  map: Record<string, string | null>,
): ThinkingRequestSpec {
  if (!model.reasoning) return { kind: "off", params: {} };
  // off（省略 reasoning）或非 Claude 模型：SDK 不生成 additionalModelRequestFields。
  if (level === "off" || !isBedrockAnthropicClaude(model)) return { kind: "off", params: {} };
  const effective = clampLevelFromFields(model, level, map);
  if (bedrockSupportsAdaptiveThinking(model)) {
    // 注意：0.85.1 先看 native xhigh，再回退到 thinkingLevelMap（见 bedrock mapThinkingLevelToEffort）。
    let effort: string | undefined;
    if (effective === "xhigh" && bedrockSupportsNativeXhigh(model)) effort = "xhigh";
    if (effort === undefined) effort = mappedString(map, effective);
    if (effort === undefined) {
      if (effective === "minimal" || effective === "low") effort = "low";
      else if (effective === "medium") effort = "medium";
      else effort = "high";
    }
    return {
      kind: "effort",
      effort,
      params: {
        additionalModelRequestFields: {
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort },
        },
      },
    };
  }
  // 预算模式：xhigh/max clamp 到 high，默认表见 bedrock buildAdditionalModelRequestFields，
  // 同样按 answer room 夹取（bedrock 把 adjusted.thinkingBudget 写进 thinkingBudgets）。
  const budget = clampedBudgetForLevel(effective, model) ?? 16384;
  return {
    kind: "budget",
    budgetTokens: budget,
    params: {
      additionalModelRequestFields: {
        thinking: { type: "enabled", budget_tokens: budget, display: "summarized" },
        anthropic_beta: ["interleaved-thinking-2025-05-14"],
      },
    },
  };
}

// ── mistral-conversations ────────────────────────────────────────────────────

function describeMistral(
  model: ThinkingModelFields,
  level: string,
  map: Record<string, string | null>,
): ThinkingRequestSpec {
  if (!model.reasoning) return { kind: "off", params: {} };
  if (level === "off") return { kind: "off", params: {} };
  const effective = clampLevelFromFields(model, level, map);
  const id = model.id ?? "";
  const usesReasoningEffort = id === "mistral-small-2603" || id === "mistral-small-latest" || id === "mistral-medium-3.5";
  if (usesReasoningEffort) {
    // mapReasoningEffort：`thinkingLevelMap?.[level] ?? "high"`（null 也会落到 "high"）。
    const effort = mappedString(map, effective) ?? "high";
    return { kind: "effort", effort, params: { reasoningEffort: effort } };
  }
  return { kind: "toggle", enabled: true, params: { promptMode: "reasoning" } };
}

/**
 * 计算某个等级的实际请求描述（纯函数，不抛错）。
 * 未镜像的 API 家族退回保守的 `reasoning_effort` 透传描述，仅用于展示。
 */
// fork:upstream-0.9.2-thinking-profile — D2-PR-21 的镜像入口（由 lib/thinking-profile.test.mjs 钉住 SDK 行为）
export function describeThinkingRequestFromFields(
  model: ThinkingModelFields,
  level: string,
  map: Record<string, string | null>,
): ThinkingRequestSpec {
  switch (model.api) {
    case "openai-completions":
      return describeOpenAiCompletions(model, level, map);
    case "openai-responses":
      return describeOpenAiResponses(model, level, map);
    case "azure-openai-responses":
      return describeAzureResponses(model, level, map);
    case "openai-codex-responses":
      return describeCodexResponses(model, level, map);
    case "anthropic-messages":
      return describeAnthropic(model, level, map);
    case "google-generative-ai":
    case "google-vertex":
      return describeGoogle(model, level, map);
    case "bedrock-converse-stream":
      return describeBedrock(model, level, map);
    case "mistral-conversations":
      return describeMistral(model, level, map);
    default: {
      if (!model.reasoning) return { kind: "off", params: {} };
      if (level === "off") return { kind: "off", params: {} };
      const effort = mappedOrLevel(map, clampLevelFromFields(model, level, map));
      return { kind: "effort", effort, params: { reasoning_effort: effort } };
    }
  }
}

/** 用模型字段 + 映射构建完整 profile（服务端 buildThinkingProfile 与客户端编辑态预览共用）。 */
export function buildProfileFromFields(
  model: ThinkingModelFields,
  map: Record<string, string | null>,
): ModelThinkingProfile {
  return {
    levels: supportedLevelsFromFields(model, map),
    map,
    requests: Object.fromEntries(
      THINKING_LEVELS.map((level) => [level, describeThinkingRequestFromFields(model, level, map)]),
    ),
    meta: model,
  };
}
