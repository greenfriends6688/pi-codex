/**
 * fork:zn-18 — 界面字体与界面字号（Zeno 设置 → 外观 →「UI 字体 / UI 字号」）。
 *
 * 两件事：
 *
 *   - **字号**写 `--ui-font-size`，默认等于 `--text-lg`（body 原本的字号），
 *     所以不设这项时行为与之前完全一致。
 *   - **字体**存的是**完整 CSS 字体栈**，不是枚举 id。原因见
 *     `lib/font-discovery.ts`：真实可选项是本机装了哪些字体，是运行时枚举出来的，
 *     枚举不出来的（Safari/Firefox、或用户拒绝授权）只能给「系统默认」。
 *     存栈而不是存族名，也让「换了机器、那个字体没了」自然回退到栈尾的系统字体。
 *
 * 空字符串 = 系统默认 = 不写内联变量，让 `app/globals.css` 的字体栈生效。
 *
 * 纯数据模块：服务端可 import，不碰 DOM。
 */

export const UI_FONT_STORAGE_KEY = "pi-ui-font";
export const UI_FONT_SIZE_STORAGE_KEY = "pi-ui-font-size";

export const UI_FONT_SIZE_MIN = 12;
export const UI_FONT_SIZE_MAX = 16;
export const UI_FONT_SIZE_DEFAULT = 14;

/** 空栈即「系统默认」；`--font-ui-base` 会被移除而不是设成空格。 */
export function parseStoredUiFontStack(raw: string | null): string {
  if (!raw || raw === "system") return "";
  return raw.trim();
}

export function parseStoredUiFontSize(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return UI_FONT_SIZE_DEFAULT;
  return Math.min(UI_FONT_SIZE_MAX, Math.max(UI_FONT_SIZE_MIN, parsed));
}

/** 逐 px 的档位（Zeno 的字体设置也是逐 px）。 */
export const UI_FONT_SIZE_OPTIONS: readonly number[] = Array.from(
  { length: UI_FONT_SIZE_MAX - UI_FONT_SIZE_MIN + 1 },
  (_, index) => UI_FONT_SIZE_MIN + index,
);
