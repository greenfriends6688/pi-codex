/**
 * 客户端会话标题设置（D2-PR-22）。
 *
 * 两个 localStorage key 驱动自动命名：
 * - `pi-title-auto`（"on" | "off"，默认 "on"）：新会话首条消息后是否自动生成标题。
 * - `pi-title-model`（"provider:modelId"）：生成标题所用的模型；空 = 未配置，
 *   命名请求会退回会话自身模型。
 */

const TITLE_AUTO_KEY = "pi-title-auto";
const TITLE_MODEL_KEY = "pi-title-model";

/** 是否开启自动命名；读取失败时按开启处理。 */
export function getTitleAutoEnabled(): boolean {
  try {
    return localStorage.getItem(TITLE_AUTO_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setTitleAutoEnabled(enabled: boolean): void {
  persistSetting(TITLE_AUTO_KEY, enabled ? "on" : "off");
}

/** 读取命名模型 `{ provider, modelId }`；未配置或格式非法时返回 null。 */
export function getTitleModel(): { provider: string; modelId: string } | null {
  try {
    const stored = localStorage.getItem(TITLE_MODEL_KEY);
    if (!stored) return null;
    const sep = stored.indexOf(":");
    if (sep <= 0) return null;
    const provider = stored.slice(0, sep);
    const modelId = stored.slice(sep + 1);
    if (!provider || !modelId) return null;
    return { provider, modelId };
  } catch {
    return null;
  }
}

export function setTitleModel(provider: string, modelId: string): void {
  persistSetting(TITLE_MODEL_KEY, `${provider}:${modelId}`);
}

export function clearTitleModel(): void {
  persistSetting(TITLE_MODEL_KEY, "");
}

function persistSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    // 广播给其他窗口/面板（与 ChatConfig 的快捷键、通知时长设置同一模式）。
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  } catch {
    // 忽略存储错误。
  }
}
