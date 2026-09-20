// D2-PR-12 — @file / /skill: mention 的切词与渲染标记。
//
// 输入框高亮层与消息正文共用这份逻辑：只有「解析到真实目标」的 token 才加
// accent + 点状下划线，否则保持纯文本。三条必须守住的坑：
//
// 1. **valid 才高亮**：`fileExists` / `isSkill` 在索引未加载时返回 `undefined`，
//    一律按 invalid 处理 —— 高亮绝不猜（REF 注释原文：highlighting must never guess）。
// 2. **光标所在 token 保持纯文本**（`activeTokenStart`）：用户正在输入的那截
//    token 不能闪高亮，否则每敲一个字符都在「高亮/不高亮」之间跳。
// 3. **代码块内不改**：消息体侧走 remark 插件，只替换 `text` 节点；`code` /
//    `inlineCode` 节点不经过 `transform`，所以围栏和行内代码里的 `@xxx` 永不改样式。
//
// 消息体侧为什么不用 raw HTML span：本仓库 `lib/markdown.ts` 的
// `rehype-sanitize` schema 没有放行 `span` 的 class/data 属性（默认 GitHub schema
// 会全部剥掉），而本 PR 不允许改 `lib/markdown.ts`。所以 remark 阶段先产出
// 「哨兵链接」(`#pi-mention-<kind>-<encodeURIComponent(value)>`)，`#` 开头的 href
// 能原样穿过 sanitize；随后由 `mentionRehypePlugin` 在 sanitize 之后把哨兵链接
// 还原成 `<span class="mention-token …">`。高亮表现与 REF 的 raw-HTML 方案一致。

import type { Root } from "mdast";

export type MentionKind = "file" | "skill" | "comment";

export interface MentionValidators {
  /**
   * cwd 相对路径是否存在于项目索引。索引未加载时返回 `undefined`
   * （按 invalid 处理 —— 高亮必须等数据，不能猜）。
   */
  fileExists?: (path: string) => boolean | undefined;
  /** skill 名是否已加载。`undefined` = 未知（同上规则）。 */
  isSkill?: (name: string) => boolean | undefined;
}

export interface MentionToken {
  kind: MentionKind;
  /** 归一化后的值：去引号的路径（去掉尾部 "/"）或 skill 名 */
  value: string;
  valid: boolean;
}

export interface MentionSegment {
  type: "mention";
  /** 原始 token 文本（`@"引号形式"` 原样保留） */
  text: string;
  token: MentionToken;
}

export interface TextSegment {
  type: "text";
  text: string;
}

export type InputSegment = TextSegment | MentionSegment;

/**
 * `@` 只在线首或空白后触发 —— 与 TUI 自动补全同一套边界规则，邮箱
 * （foo@bar.com）永远不会命中。引号形式必须闭合（`@"my dir/file"`）：
 * 未闭合说明 token 还在输入中。`@comment:` 分支必须排在通用 `@` 之前，
 * 否则会被当成（不存在的）文件路径吞掉；全角冒号兼容 IME 布局。
 * `/skill:` 同样需要边界，名字一直取到下一个空白。
 */
const MENTION_RE = /(?<=^|[\s\u00A0])(@"[^"\n]*"|@comment[：:][^\s"]+|@[^\s"]+|\/skill:[^\s]+)/g;

/**
 * D2-PR-12 — sha 格式的内联校验。
 *
 * REF 把这个函数放在 `lib/comment-mentions.ts`（`@comment:` 补全体系随 Git
 * 数据层一起排队，本仓库暂缓）。高亮只需要格式判断，不需要 Git 数据，所以这里
 * 内联同一条规则：6-40 位十六进制、从 7 位起，避免 "cafe" 这类单词被误判。
 */
const COMMENT_SHA_RE = /^[0-9a-f]{7,40}$/i;

function isCommentShaValue(value: string): boolean {
  return COMMENT_SHA_RE.test(value);
}

function stripFileToken(raw: string): string {
  if (raw.startsWith('@"') && raw.endsWith('"')) return raw.slice(2, -1);
  return raw.slice(1);
}

function classifyToken(raw: string, validators: MentionValidators): MentionToken {
  if (raw.startsWith("/skill:")) {
    const name = raw.slice("/skill:".length);
    return {
      kind: "skill",
      value: name,
      valid: validators.isSkill?.(name) === true,
    };
  }
  if (raw.startsWith("@comment:") || raw.startsWith("@comment：")) {
    // 有效性来自 token 格式本身（sha 形状），不需要 validator 数据：所以
    // `@comment:` 在没有 commit 缓存的历史消息里也能高亮。
    const value = raw.slice("@comment:".length);
    return { kind: "comment", value, valid: isCommentShaValue(value) };
  }
  const value = stripFileToken(raw).replace(/\/+$/, "");
  return {
    kind: "file",
    value,
    valid: validators.fileExists?.(value) === true,
  };
}

/**
 * 把文本切成「纯文本 / mention」段。
 *
 * `activeTokenStart` 指向正在编辑的 `@` token 起点（来自自动补全查询状态）；
 * 光标所在的 token 保持纯文本，这样半截输入永远不会闪高亮（坑 #2）。
 */
export function tokenizeMentions(
  text: string,
  validators: MentionValidators,
  activeTokenStart: number | null = null,
): InputSegment[] {
  const segments: InputSegment[] = [];
  let lastIndex = 0;
  MENTION_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = MENTION_RE.exec(text)) !== null) {
    const raw = match[0];
    const start = match.index;
    const end = start + raw.length;

    if (start > lastIndex) {
      segments.push({ type: "text", text: text.slice(lastIndex, start) });
    }
    if (activeTokenStart !== null && start === activeTokenStart) {
      // 正在输入（自动补全打开）的 token：连同原始文本保持纯文本。
      segments.push({ type: "text", text: raw });
    } else {
      segments.push({ type: "mention", text: raw, token: classifyToken(raw, validators) });
    }
    lastIndex = end;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", text: text.slice(lastIndex) });
  }
  return segments;
}

// ── remark 插件：给渲染后的 markdown 打标记 ────────────────────────────────
// 只在 `text` 节点上工作（AST 层面），所以代码块（code / inlineCode 节点）
// 里的 mention 永远不会被动（坑 #3）；跨 markdown 结构的 token 也只会拆开
// 自己所在的 text 节点。valid 的 mention 变成「哨兵链接」，invalid/未知保持
// 纯文本。

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

/** 哨兵 href 前缀：`#` 开头没有协议，能原样穿过 rehype-sanitize。 */
const MENTION_HREF_PREFIX = "#pi-mention-";

/** 把一段 valid mention 编码成哨兵链接（kind 与归一化 value 都带上）。 */
function buildMentionHref(segment: MentionSegment): string {
  return `${MENTION_HREF_PREFIX}${segment.token.kind}-${encodeURIComponent(segment.token.value)}`;
}

function walkTextNodes(node: MdNode, transform: (value: string) => MdNode[] | null): void {
  const children = node.children;
  if (!children) return;
  const next: MdNode[] = [];
  for (const child of children) {
    if (child.type === "text" && typeof child.value === "string") {
      const replaced = transform(child.value);
      if (replaced) {
        // 插入的节点全部是叶子（text）或自带原文的哨兵链接。**不再向下递归**：
        // 链接的孩子就是刚替换出来的 token 原文，递归会再次命中 transform 造成
        // 无限展开。
        for (const item of replaced) next.push(item);
        continue;
      }
    }
    walkTextNodes(child, transform);
    next.push(child);
  }
  node.children = next;
}

export function mentionRemarkPlugin(validators: MentionValidators) {
  return () => (tree: Root) => {
    walkTextNodes(tree as unknown as MdNode, (value) => {
      const segments = tokenizeMentions(value, validators);
      if (segments.length === 1 && segments[0].type === "text") return null;
      const nodes: MdNode[] = [];
      for (const segment of segments) {
        if (segment.type === "text") {
          nodes.push({ type: "text", value: segment.text });
        } else if (segment.token.valid) {
          // valid 才打标（坑 #1）；原始 token 文本作为链接子节点原样显示。
          nodes.push({
            type: "link",
            url: buildMentionHref(segment),
            children: [{ type: "text", value: segment.text }],
          });
        } else {
          nodes.push({ type: "text", value: segment.text });
        }
      }
      return nodes;
    });
  };
}

// ── rehype 插件：把哨兵链接还原成带样式的 span ─────────────────────────────
// 运行在 sanitize **之后**（MarkdownBody 把本插件追加在 rehype 链尾部），
// 因此 class / data-* 不会被洗掉；同时跳过 code / pre 子树，双保险保证
// 「代码块内不改」这条坑。

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
}

function decodeMentionHref(href: string): { kind: MentionKind; value: string } | null {
  if (!href.startsWith(MENTION_HREF_PREFIX)) return null;
  const rest = href.slice(MENTION_HREF_PREFIX.length);
  const dash = rest.indexOf("-");
  if (dash < 1) return null;
  const kind = rest.slice(0, dash);
  if (kind !== "file" && kind !== "skill" && kind !== "comment") return null;
  try {
    return { kind, value: decodeURIComponent(rest.slice(dash + 1)) };
  } catch {
    // 手工构造的坏 href：当普通链接留着，不做破坏性替换。
    return null;
  }
}

function isMentionLink(node: HastNode): { kind: MentionKind; value: string } | null {
  if (node.type !== "element" || node.tagName !== "a") return null;
  const href = node.properties?.href;
  if (typeof href !== "string") return null;
  return decodeMentionHref(href);
}

function toMentionSpan(node: HastNode, kind: MentionKind, value: string): HastNode {
  return {
    type: "element",
    tagName: "span",
    properties: {
      className: ["mention-token", `mention-token-${kind}`],
      dataMentionKind: kind,
      dataMentionValue: value,
    },
    children: node.children ?? [],
  };
}

function walkHast(node: HastNode): void {
  const children = node.children;
  if (!children) return;
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    // 代码块/行内代码子树整段跳过（坑 #3 的第二道保险）。
    if (child.type === "element" && (child.tagName === "code" || child.tagName === "pre")) {
      continue;
    }
    const mention = isMentionLink(child);
    if (mention) {
      children[index] = toMentionSpan(child, mention.kind, mention.value);
      continue;
    }
    walkHast(child);
  }
}

export function mentionRehypePlugin() {
  return (tree: unknown) => {
    walkHast(tree as HastNode);
  };
}
