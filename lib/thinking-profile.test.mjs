// fork:upstream-0.9.2-thinking-profile — D2-PR-21 的验收测试。
//
// `lib/thinking-request-core.ts` 是 pi-ai 请求构造的**只读镜像**（配置页用它解释「每档实际发什么」）。
// 镜像一旦和 SDK 漂移，展示就是错的，所以这里用 SDK 自己的请求体把它钉住：
//
//   1. 等级表 / clamp —— 直接对拍 pi-ai 的 `getSupportedThinkingLevels` / `clampThinkingLevel`；
//   2. 每档实际请求 —— 给 `streamSimple` 塞 `onPayload` 抓最终 body，再和镜像的 `params` 比。
//
// 这是本仓库唯一的 SDK 内部耦合点：**pi-ai 升级后先跑这个文件**，红了就是镜像要跟着改。
import assert from "node:assert/strict";
import test from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  THINKING_LEVELS,
  buildProfileFromFields,
  clampLevelFromFields,
  describeThinkingRequestFromFields,
  supportedLevelsFromFields,
} = await jiti.import("./thinking-request-core.ts");
const { getSupportedThinkingLevels, clampThinkingLevel } = await import("@earendil-works/pi-ai");

const FAMILY = {
  "openai-completions": await import("@earendil-works/pi-ai/api/openai-completions"),
  "openai-responses": await import("@earendil-works/pi-ai/api/openai-responses"),
  "azure-openai-responses": await import("@earendil-works/pi-ai/api/azure-openai-responses"),
  "anthropic-messages": await import("@earendil-works/pi-ai/api/anthropic-messages"),
  "google-generative-ai": await import("@earendil-works/pi-ai/api/google-generative-ai"),
  "google-vertex": await import("@earendil-works/pi-ai/api/google-vertex"),
  "mistral-conversations": await import("@earendil-works/pi-ai/api/mistral-conversations"),
};

function model(over = {}) {
  return {
    provider: "test",
    id: "test-model",
    name: "Test",
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 64000,
    ...over,
  };
}

const context = { messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 }] };

/** Capture the request body the SDK would send, without any network. */
async function captureBody(modelDef, level) {
  const mod = FAMILY[modelDef.api];
  assert.ok(mod?.streamSimple, `no streamSimple for ${modelDef.api}`);
  let body = null;
  try {
    await mod
      .streamSimple(modelDef, context, {
        apiKey: "test",
        onPayload: (payload) => {
          body = payload;
          throw new Error("__captured__");
        },
        // pi-agent-core omits `reasoning` entirely for off; "off" is never passed as a string.
        ...(level === "off" ? {} : { reasoning: level }),
      })
      .result();
  } catch {
    // The onPayload throw (or the adapter's own error) is expected.
  }
  return body;
}

/** Reasoning-related fields only: the mirror describes those, not the whole body. */
const REASON_FIELDS = [
  "reasoning_effort",
  "reasoning",
  "thinking",
  "include",
  "output_config",
  "enable_thinking",
  "chat_template_kwargs",
  "chat_template_args",
  "thinking_token_budget",
  "promptMode",
  "reasoningEffort",
  "additionalModelRequestFields",
];

function reasoningFields(body) {
  if (!body) return null;
  const out = {};
  for (const key of REASON_FIELDS) if (key in body) out[key] = body[key];
  const google = body.config?.thinkingConfig ?? body.generationConfig?.thinkingConfig;
  if (google) out.thinkingConfig = google;
  return out;
}

/** Key order is not part of the request, so compare structurally. */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return keysA.length === keysB.length && keysA.every((key) => deepEqual(a[key], b[key]));
}

const SHAPES = [
  ["openai default", model()],
  ["deepseek", model({ provider: "deepseek", baseUrl: "https://api.deepseek.com" })],
  ["zai", model({ provider: "zai", baseUrl: "https://api.z.ai/v1" })],
  ["openrouter", model({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1" })],
  ["together", model({ provider: "together", baseUrl: "https://api.together.ai/v1" })],
  ["openai token budget", model({ provider: "custom", baseUrl: "https://custom.test/v1", compat: { supportsThinkingTokenBudget: true } })],
  ["openai qwen", model({ provider: "qwen", baseUrl: "https://dashscope.test/v1", compat: { thinkingFormat: "qwen" } })],
  ["openai string-thinking", model({ provider: "custom2", baseUrl: "https://c2.test/v1", compat: { thinkingFormat: "string-thinking" } })],
  ["anthropic budget", model({ api: "anthropic-messages", provider: "anthropic", baseUrl: "https://api.anthropic.com" })],
  ["anthropic adaptive", model({ api: "anthropic-messages", provider: "anthropic", baseUrl: "https://api.anthropic.com", compat: { forceAdaptiveThinking: true } })],
  ["anthropic tight ceiling", model({ api: "anthropic-messages", provider: "anthropic", baseUrl: "https://api.anthropic.com", maxTokens: 4096 })],
  ["openai-responses", model({ api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1" })],
  ["azure responses", model({ api: "azure-openai-responses", provider: "azure", id: "gpt-5", baseUrl: "https://x.openai.azure.com" })],
  ["google gemini-3-pro", model({ api: "google-generative-ai", provider: "google", id: "gemini-3-pro-preview" })],
  ["google 2.5-flash", model({ api: "google-generative-ai", provider: "google", id: "gemini-2.5-flash" })],
  ["google 2.5-pro", model({ api: "google-generative-ai", provider: "google", id: "gemini-2.5-pro" })],
  ["genai gemma-4", model({ api: "google-generative-ai", provider: "google", id: "gemma-4-27b" })],
  ["vertex gemini-3-flash", model({ api: "google-vertex", provider: "google-vertex", id: "gemini-3-flash-preview" })],
  ["vertex gemma-4", model({ api: "google-vertex", provider: "google-vertex", id: "gemma-4-27b" })],
  ["mistral effort", model({ api: "mistral-conversations", provider: "mistral", id: "mistral-small-latest" })],
  ["mistral prompt mode", model({ api: "mistral-conversations", provider: "mistral", id: "mistral-large-3" })],
];

test("mirrors the SDK's supported-level table and clamp", () => {
  const shapes = [
    model({ reasoning: false }),
    model(),
    model({ thinkingLevelMap: { off: null } }),
    model({ thinkingLevelMap: { off: null, xhigh: "high", max: "max" } }),
    model({ thinkingLevelMap: { minimal: null, low: null, xhigh: "xhigh" } }),
    model({ thinkingLevelMap: { medium: "MEDIUM" } }),
  ];
  for (const shape of shapes) {
    const map = shape.thinkingLevelMap ?? {};
    assert.deepEqual(
      supportedLevelsFromFields(shape, map),
      getSupportedThinkingLevels(shape),
      `supported levels differ for ${JSON.stringify(shape.thinkingLevelMap ?? {})}`,
    );
    for (const level of [...THINKING_LEVELS, "bogus"]) {
      assert.equal(
        clampLevelFromFields(shape, level, map),
        clampThinkingLevel(shape, level),
        `clamp(${level}) differs for ${JSON.stringify(shape.thinkingLevelMap ?? {})}`,
      );
    }
  }
});

test("describes the request the SDK actually sends, for every level and api family", async () => {
  const mismatches = [];
  for (const [name, shape] of SHAPES) {
    for (const level of THINKING_LEVELS) {
      const sdk = reasoningFields(await captureBody(shape, level));
      const mirror = describeThinkingRequestFromFields(shape, level, {}).params;
      if (!deepEqual(sdk, mirror)) {
        mismatches.push(`${name} / ${level}\n    sdk:    ${JSON.stringify(sdk)}\n    mirror: ${JSON.stringify(mirror)}`);
      }
    }
  }
  assert.deepEqual(mismatches, [], `mirror drifted from the installed pi-ai:\n  ${mismatches.join("\n  ")}`);
});

test("clamps thinking budgets to leave answer room, like the SDK does", () => {
  const anthropic = model({ api: "anthropic-messages", provider: "anthropic" });

  // A generous ceiling keeps the nominal budget...
  assert.deepEqual(
    describeThinkingRequestFromFields({ ...anthropic, maxTokens: 64000 }, "high", {}).params,
    { thinking: { type: "enabled", budget_tokens: 16384, display: "summarized" } },
  );
  // ...a tight one leaves MIN_ANSWER_TOKENS for the answer (4096 - 1024).
  assert.deepEqual(
    describeThinkingRequestFromFields({ ...anthropic, maxTokens: 4096 }, "high", {}).params,
    { thinking: { type: "enabled", budget_tokens: 3072, display: "summarized" } },
  );
  // Without a known ceiling the mirror reports the nominal budget rather than guessing.
  assert.equal(
    describeThinkingRequestFromFields(anthropic, "high", {}).params.thinking.budget_tokens,
    16384,
  );
});

test("buildProfileFromFields covers all seven levels and follows the model's support table", () => {
  const profile = buildProfileFromFields(
    model({ thinkingLevelMap: { off: null, xhigh: "high" } }),
    { off: null, xhigh: "high" },
  );

  assert.deepEqual(Object.keys(profile.requests), [...THINKING_LEVELS]);
  assert.deepEqual(profile.levels, ["minimal", "low", "medium", "high", "xhigh"]);
  assert.deepEqual(profile.meta.id, "test-model");
});
