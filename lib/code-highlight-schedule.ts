/**
 * fork:fix-highlight-chunk — 代码块高亮的调度策略（纯逻辑，可在 Node 里单测）。
 *
 * 背景（`docs/proma-optimization-2026-09-18.md` §1 R3）：
 * `components/MermaidBlock.tsx` 的 `CodeBlock` 在流式期间渲染纯文本，
 * 流式**结束的那一刻**才对攒下的整个代码块跑一次 Prism 全量 tokenize。
 * 一条回答里若有多个大代码块，它们会在同一帧里排队执行，
 * 于是观感是「打字很快、停下来顿一下」。
 *
 * 这里只做两件事：
 *   1. `shouldHighlightCode()` —— 超过阈值的块直接不上高亮（改用带提示的纯文本），
 *      避免单块 tokenize 把主线程按死；
 *   2. `highlightBudgetMs()` —— 给每个块算一个错峰预算，让多个块分散到不同空闲帧，
 *      而不是全部挤在流式结束的那一帧。
 *
 * 真正的「流式期渐进上色」需要迁到 Shiki 的 token API（见 PR 文档 FIX-02 的后续项），
 * 不在本模块范围内。
 */

/** 单块超过这个字符数就不再上高亮：Prism 全量 tokenize 的代价随长度近似线性。 */
export const MAX_HIGHLIGHT_CHARS = 60_000;

/** 行数上限，作用同上（长行少的文件与短行多的文件都要挡住）。 */
export const MAX_HIGHLIGHT_LINES = 1_200;

/** 小于这个长度的块视为“便宜”，立即高亮，不引入任何延迟。 */
export const IMMEDIATE_HIGHLIGHT_CHARS = 4_000;

export function countLines(code: string): number {
  if (code === "") return 0;
  let lines = 1;
  for (let index = 0; index < code.length; index++) {
    if (code.charCodeAt(index) === 10) lines++;
  }
  return lines;
}

/**
 * 是否值得上高亮。空块返回 false（纯空白没必要高亮）。
 * 注意：返回 false 时调用方必须仍然渲染代码内容，只是不带 token 颜色。
 */
export function shouldHighlightCode(code: string): boolean {
  if (code.trim() === "") return false;
  if (code.length > MAX_HIGHLIGHT_CHARS) return false;
  if (countLines(code) > MAX_HIGHLIGHT_LINES) return false;
  return true;
}

/**
 * 错峰预算：让大块晚一点、多个块分散开。
 *
 * - 便宜块（≤ IMMEDIATE_HIGHLIGHT_CHARS）返回 0：保持原来的即时体验；
 * - 更长的块返回 1..MAX_BUDGET_MS 的递增预算，调用方据此用 `requestIdleCallback`
 *   的 timeout 或 `setTimeout` 延后执行。
 */
export const MAX_HIGHLIGHT_BUDGET_MS = 240;

export function highlightBudgetMs(code: string): number {
  if (code.length <= IMMEDIATE_HIGHLIGHT_CHARS) return 0;
  const over = (code.length - IMMEDIATE_HIGHLIGHT_CHARS) / (MAX_HIGHLIGHT_CHARS - IMMEDIATE_HIGHLIGHT_CHARS);
  const clamped = Math.min(1, Math.max(0, over));
  return Math.round(clamped * MAX_HIGHLIGHT_BUDGET_MS);
}

/**
 * 超大代码块在上高亮被跳过时，UI 用这条提示解释原因（i18n key）。
 * 放在这里是为了让阈值与文案一一对应，避免两处各写一遍。
 */
export const HIGHLIGHT_SKIPPED_I18N_KEY = "i18n.codeTooLargeToHighlight";
