/**
 * fork:pr13-composer — 编辑器换行时的 Markdown 结构续行。
 *
 * 在 composer 里按 Shift+Enter（显式换行）时，把当前行开头的结构前缀原样带到
 * 新行：无序列表（`-` / `*` / `+`）、有序列表 `1.` / `1)`（序号递增）、task
 * 复选框（重置为 `[ ]`）、引用 `>`（支持嵌套 `>>`），以及「缩进 + 引用 + 列表 +
 * 复选框」的组合。当前行没有结构前缀时返回 `null`，让调用方走原生换行。
 *
 * 纯函数，方便单测；真正在不在 Shift+Enter 上启用由 ChatInput 决定。
 */

export interface MarkdownContinuation {
  value: string;
  caret: number;
}

const LIST_MARKER = /^([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/;
const QUOTE_MARKER = /^(?:>\s*)+/;
const ORDERED_MARKER = /^\d+[.)]$/;

export function continueMarkdownList(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownContinuation | null {
  // 重发换行时先按「选区被替换」处理，光标基点是选区起点。
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const effective = end > start
    ? value.slice(0, start) + value.slice(end)
    : value;

  const lineStart = effective.lastIndexOf("\n", start - 1) + 1;
  const line = effective.slice(lineStart, start);

  const indent = line.match(/^\s*/)?.[0] ?? "";
  let rest = line.slice(indent.length);
  const quotes = rest.match(QUOTE_MARKER)?.[0] ?? "";
  rest = rest.slice(quotes.length);
  const list = rest.match(LIST_MARKER);

  if (!quotes && !list) return null;

  const prefix = indent + quotes + (list?.[0] ?? "");

  // 空列表项 = 结束结构：整段前缀删掉，光标回到行首（VS Code / Typora 行为）。
  if (line.slice(prefix.length).trim() === "") {
    return {
      value: effective.slice(0, lineStart) + effective.slice(lineStart + prefix.length),
      caret: lineStart,
    };
  }

  // 非空项：在新行重发前缀 —— 有序序号 +1，task 复选框重置为未勾选。
  let nextPrefix = indent + quotes;
  if (list) {
    const marker = list[1];
    nextPrefix += ORDERED_MARKER.test(marker)
      ? `${parseInt(marker, 10) + 1}${marker.slice(-1)} `
      : `${marker} `;
    if (list[3]) nextPrefix += "[ ] ";
  }

  const insert = `\n${nextPrefix}`;
  return {
    value: effective.slice(0, start) + insert + effective.slice(start),
    caret: start + insert.length,
  };
}
