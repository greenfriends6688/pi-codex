/**
 * fork:zc-07 — 词级行内 diff（纯函数，无 React / DOM 依赖）。
 *
 * WHY：并排 diff 目前只给整行着色。改动一行里的一个标识符时，左右两侧各有一
 * 大片同色背景，用户得自己找差异。这里把「改了什么词/字」算出来，渲染层只负责
 * 把命中的字符段加一层更深的背景：
 *
 *   1. 先裁掉两行完全相同的公共前缀 / 后缀（字符级，按码点推进，不劈开代理对）；
 *   2. 对剩下的中段做词级 LCS —— 英文按词、CJK / 全角按**单字**（中文没有空格
 *      断词，按字匹配才可能命中局部）；
 *   3. 未被 LCS 命中的 token 合并成连续区间，转成 UTF-16 下标返回；
 *   4. 任一侧中段超过 MAX_INTRALINE_LINE_LENGTH 时返回 null —— 调用方回退整行
 *      着色。O(n*m) 的表格与查找随机长行一起会拖慢整条渲染，所以用长度硬闸而
 *      不是「先算再截断」。
 *
 * 输入输出都是普通字符串 / 数字，方便单测直接断言边界。
 */

/** 超过这个长度（UTF-16 code unit，按单侧中段计）不再做词级匹配。 */
export const MAX_INTRALINE_LINE_LENGTH = 500;

/** 一段连续的变化区间，`[start, end)`，下标是 UTF-16 code unit。 */
export interface IntralineSpan {
  start: number;
  end: number;
}

export interface IntralinePair {
  left: IntralineSpan[];
  right: IntralineSpan[];
}

/** 渲染层的一段文本：`changed` 为 true 时加行内高亮。 */
export interface IntralineSegment {
  text: string;
  changed: boolean;
}

interface Token {
  text: string;
  /** 该 token 覆盖的字符（码点）数，用于把 token 区间换算回字符串下标。 */
  length: number;
}

const CJK_CHAR = /^[\u2e80-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]$/u;
const WORD_CHAR = /^[\p{L}\p{N}_]$/u;
const SPACE_CHAR = /^\s$/u;

/** 词级切分：CJK / 全角单字成 token，拉丁等文字连续成词，空白连续成段。 */
function tokenize(chars: string[]): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < chars.length) {
    const start = index;
    const char = chars[index];
    if (CJK_CHAR.test(char)) {
      index += 1;
    } else if (WORD_CHAR.test(char)) {
      index += 1;
      while (index < chars.length && WORD_CHAR.test(chars[index]) && !CJK_CHAR.test(chars[index])) index += 1;
    } else if (SPACE_CHAR.test(char)) {
      index += 1;
      while (index < chars.length && SPACE_CHAR.test(chars[index])) index += 1;
    } else {
      index += 1;
    }
    const text = chars.slice(start, index).join("");
    tokens.push({ text, length: text.length });
  }
  return tokens;
}

/** 经典 LCS 回溯，返回两串里互相匹配的 token 下标对。 */
function longestCommonSubsequence(a: Token[], b: Token[]): Array<[number, number]> {
  const rows = a.length;
  const columns = b.length;
  if (rows === 0 || columns === 0) return [];
  const width = columns + 1;
  const table = new Int32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i].text === b[j].text
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const matches: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (a[i].text === b[j].text) {
      matches.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return matches;
}

/** 把未命中的 token 合并成连续区间；下标相对该 token 序列的 UTF-16 偏移。 */
function unmatchedSpans(tokens: Token[], matched: Set<number>): IntralineSpan[] {
  const spans: IntralineSpan[] = [];
  let offset = 0;
  let runStart = -1;
  let runEnd = -1;
  for (let index = 0; index < tokens.length; index += 1) {
    const tokenStart = offset;
    offset += tokens[index].length;
    if (matched.has(index)) {
      if (runStart >= 0) {
        spans.push({ start: runStart, end: runEnd });
        runStart = -1;
      }
      continue;
    }
    if (runStart < 0) runStart = tokenStart;
    runEnd = offset;
  }
  if (runStart >= 0) spans.push({ start: runStart, end: runEnd });
  return spans;
}

/**
 * 计算一行改动左右两侧需要高亮的字符区间。
 *
 * @returns `null` 表示「超长行，整行着色回退」；空数组表示该侧没有可标出的局部变化。
 */
export function diffIntraline(left: string, right: string): IntralinePair | null {
  if (left === right) return { left: [], right: [] };

  const leftChars = Array.from(left);
  const rightChars = Array.from(right);

  let prefix = 0;
  while (prefix < leftChars.length && prefix < rightChars.length && leftChars[prefix] === rightChars[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < leftChars.length - prefix
    && suffix < rightChars.length - prefix
    && leftChars[leftChars.length - 1 - suffix] === rightChars[rightChars.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const leftMiddle = leftChars.slice(prefix, leftChars.length - suffix);
  const rightMiddle = rightChars.slice(prefix, rightChars.length - suffix);
  if (leftMiddle.length > MAX_INTRALINE_LINE_LENGTH || rightMiddle.length > MAX_INTRALINE_LINE_LENGTH) {
    return null;
  }
  if (leftMiddle.length === 0 && rightMiddle.length === 0) return { left: [], right: [] };

  const leftTokens = tokenize(leftMiddle);
  const rightTokens = tokenize(rightMiddle);
  const matchedLeft = new Set<number>();
  const matchedRight = new Set<number>();
  if (leftTokens.length > 0 && rightTokens.length > 0) {
    for (const [leftIndex, rightIndex] of longestCommonSubsequence(leftTokens, rightTokens)) {
      matchedLeft.add(leftIndex);
      matchedRight.add(rightIndex);
    }
  }

  // prefix 是按码点数的，转成 UTF-16 偏移后再加到 token 区间上。
  const prefixOffset = leftChars.slice(0, prefix).join("").length;
  const shift = (span: IntralineSpan): IntralineSpan => ({
    start: span.start + prefixOffset,
    end: span.end + prefixOffset,
  });
  return {
    left: unmatchedSpans(leftTokens, matchedLeft).map(shift),
    right: unmatchedSpans(rightTokens, matchedRight).map(shift),
  };
}

function normalizeSpans(spans: IntralineSpan[], length: number): IntralineSpan[] {
  const normalized = spans
    .map((span) => ({ start: Math.max(0, span.start), end: Math.min(length, span.end) }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);
  const merged: IntralineSpan[] = [];
  for (const span of normalized) {
    const previous = merged.at(-1);
    if (previous && span.start <= previous.end) {
      previous.end = Math.max(previous.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/**
 * 把高亮区间切成渲染用的文本段。`null` 表示整行高亮（超长行回退）。
 */
export function buildIntralineSegments(text: string, spans: IntralineSpan[] | null): IntralineSegment[] {
  if (spans === null) return [{ text, changed: true }];
  if (text.length === 0) return [];
  const segments: IntralineSegment[] = [];
  let cursor = 0;
  for (const span of normalizeSpans(spans, text.length)) {
    if (span.start > cursor) segments.push({ text: text.slice(cursor, span.start), changed: false });
    segments.push({ text: text.slice(span.start, span.end), changed: true });
    cursor = span.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), changed: false });
  return segments;
}
