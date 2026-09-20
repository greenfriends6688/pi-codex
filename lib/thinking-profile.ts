/**
 * 服务端入口：把 pi-ai 的 `Model<Api>` 转成推理强度 Profile。
 *
 * 纯逻辑在 `lib/thinking-request-core.ts`（无 pi-ai 依赖，客户端编辑态预览共用），
 * 本文件只负责把 Model 适配为 `ThinkingModelFields`。等级支持表由
 * `supportedLevelsFromFields` 计算（镜像 pi-ai 0.85.1 `models.js` 的
 * `getSupportedThinkingLevels`，一致性由 `lib/thinking-profile.test.mjs` 断言保证）。
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  buildProfileFromFields,
  type ModelThinkingProfile,
  type ThinkingModelFields,
} from "./thinking-request-core";

export type {
  ModelThinkingProfile,
  ThinkingLevel,
  ThinkingModelFields,
  ThinkingRequestParams,
  ThinkingRequestSpec,
} from "./thinking-request-core";
export { THINKING_LEVELS, buildProfileFromFields } from "./thinking-request-core";

/** 只提取 profile 需要的字段（provider/baseUrl 参与 compat 自动探测，必须带上）。 */
export function toThinkingModelFields(model: Model<Api>): ThinkingModelFields {
  return {
    provider: model.provider,
    id: model.id,
    name: model.name,
    baseUrl: model.baseUrl,
    api: model.api,
    reasoning: model.reasoning,
    compat: (model.compat ?? {}) as Record<string, unknown>,
  };
}

/** 权威 profile（levels/map/requests/meta）。 */
export function buildThinkingProfile(model: Model<Api>): ModelThinkingProfile {
  const map = (model.thinkingLevelMap ?? {}) as Record<string, string | null>;
  return buildProfileFromFields(toThinkingModelFields(model), map);
}

/** `/api/models` 里 thinkingLevels/thinkingLevelMaps/thinkingProfiles 的统一 key。 */
export function thinkingProfileKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}
