/**
 * fork:markdown-incremental — 流式 Markdown 的「稳定前缀块 + 增长 tail」切分。
 *
 * 流式回答的文本只在尾部增长。把文本按块边界切开后，UI 只需要对变化的 tail
 * 重跑 remark/rehype 管线；已经完成的前缀块因为文本引用不变，可以直接跳过
 * React 协调与 Prism 分词。
 *
 * 切分规则（与 react-markdown 实际使用的 CommonMark + GFM 对齐）：
 * - 未闭合的代码围栏会把从它的起始行开始的所有内容都拉进 tail：闭合围栏
 *   到达之前，围栏内容是否属于代码都是不确定的，不能提前 parse。
 * - 其余情况 tail 从「最后一个空行」之后开始：空行是硬块边界，空行之前的
 *   内容不会因为 tail 增长而改变语义。连续块（列表、引用、表格、setext
 *   标题、缩进代码）内部没有空行，因此永远不会被从中间切开。
 * - 生成分块时收敛连续空行。
 */
export interface MarkdownStreamPart {
  /** 稳定内容 key —— 相同文本永远映射到同一个 id。 */
  id: string;
  /** 分块文本。稳定块的字符串对象在多次调用间复用。 */
  text: string;
  /** 最后一个分块为 true，它在流式期间仍会增长。 */
  tail: boolean;
}

/** cyrb53 —— 快速、确定性的 53 位哈希，base-36 编码。 */
function hashString(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function makePart(
  text: string,
  tail: boolean,
  cache: Map<string, string> | undefined,
): MarkdownStreamPart {
  const id = hashString(text);
  if (cache) {
    const cached = cache.get(id);
    if (cached !== undefined) return { id, text: cached, tail };
    cache.set(id, text);
  }
  return { id, text, tail };
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/**
 * 把一篇 Markdown 文档切成若干稳定前缀块和一个增长 tail。
 *
 * @param markdown 归一化后的 Markdown 文本（display math 已经展开）
 * @param cache 可选的字符串 interning map：内容哈希相同的稳定块会返回**同一个
 *   字符串对象**，因此 React.memo 可以用引用相等判断并整块跳过重复渲染。
 */
export function splitStableParts(
  markdown: string,
  cache?: Map<string, string>,
): MarkdownStreamPart[] {
  if (markdown.length === 0) return [];
  const lines = markdown.split(/\r?\n/);

  // 找到最后一个未闭合围栏的起始行，状态机与 lib/markdown.ts 的
  // normalizeDisplayMath 保持一致。
  let fenceMarker = "";
  let fenceSize = 0;
  let inFence = false;
  let lastOpenFenceLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const match = FENCE_OPEN.exec(lines[i]);
    if (!inFence) {
      if (match) {
        fenceMarker = match[1][0];
        fenceSize = match[1].length;
        inFence = true;
        lastOpenFenceLine = i;
      }
    } else if (match && match[1][0] === fenceMarker && match[1].length >= fenceSize) {
      inFence = false;
      fenceMarker = "";
      fenceSize = 0;
      lastOpenFenceLine = -1;
    }
  }

  let tailStartLine: number;
  if (lastOpenFenceLine >= 0) {
    tailStartLine = lastOpenFenceLine;
  } else {
    let lastBlankLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "") lastBlankLine = i;
    }
    tailStartLine = lastBlankLine + 1; // 没有空行时为 0 → 全部都是 tail
  }

  const stableLines = lines.slice(0, tailStartLine);
  const tailLines = lines.slice(tailStartLine);

  // 收敛连续空行，并在空行处把稳定前缀切成多个分块。这样每个分块都结束于
  // 一个硬块边界，可以独立于后续内容解析。
  const parts: MarkdownStreamPart[] = [];
  let partLines: string[] = [];
  const flush = () => {
    while (partLines.length > 0 && partLines[partLines.length - 1] === "") partLines.pop();
    while (partLines.length > 0 && partLines[0] === "") partLines.shift();
    if (partLines.length > 0) {
      parts.push(makePart(partLines.join("\n"), false, cache));
      partLines = [];
    }
  };
  for (const line of stableLines) {
    if (line === "" && partLines.length > 0) flush();
    else partLines.push(line);
  }
  if (partLines.length > 0) flush();

  // tail 去掉开头的空行（它们只是分隔符），但绝不动尾部内容 —— tail 还在增长。
  while (tailLines.length > 0 && tailLines[0] === "") tailLines.shift();
  if (tailLines.length > 0) {
    parts.push(makePart(tailLines.join("\n"), true, cache));
  }
  return parts;
}
