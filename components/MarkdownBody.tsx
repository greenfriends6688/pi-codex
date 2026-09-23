"use client";

import { createContext, memo, useContext, useMemo, useRef, type ComponentProps, type MouseEvent } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { parsePdfPageFragment, resolveLocalFileHref, shouldOpenLinkInApp, shouldOpenLocalFileInApp } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownRehypePluginsFor, markdownRemarkPlugins, markdownUrlTransform, normalizeDisplayMath } from "@/lib/markdown";
import { mentionRehypePlugin, mentionRemarkPlugin, type MentionValidators } from "@/lib/mention-tokens";
import { splitStableParts } from "@/lib/markdown-incremental";
import { useThrottledText } from "@/hooks/useThrottledText";
import { ImagePreview } from "./ImagePreview";
import { useOpenLink } from "./LinkOpenContext";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";

const MarkdownLinkContext = createContext(false);

/**
 * fork:open-link-in-app — 外链渲染。
 *
 * 默认单左键单击交给应用内的浏览器面板（`LinkOpenContext`，由 AppShell 提供）；
 * 带修饰键 / 中键仍然走 `target="_blank"`，也就是真正的系统浏览器。
 * 没有 provider（例如单独渲染的测试、或本就不该内嵌的场景）时保持原行为。
 */
function ExternalLink({ href, children, ...props }: ComponentProps<"a"> & ExtraProps) {
  const openLink = useOpenLink();
  const handleClick = openLink
    ? (event: MouseEvent<HTMLAnchorElement>) => {
        if (!shouldOpenLinkInApp(event) || !href) return;
        event.preventDefault();
        openLink(href);
      }
    : undefined;
  return (
    <a href={href} {...props} target="_blank" rel="noopener noreferrer" onClick={handleClick}>
      {children}
    </a>
  );
}

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
  /** D2-PR-12 — 打开消息正文里的 @file / /skill: mention 高亮（需要 validators）。 */
  highlightMentions?: boolean;
  /** D2-PR-12 — 合法性查询；数据未加载时返回 undefined（一律不高亮，不猜）。 */
  mentionValidators?: MentionValidators;
}

function MarkdownImage({
  src,
  alt,
  cwd,
  ...props
}: ComponentProps<"img"> & ExtraProps & { cwd?: string }) {
  const insideLink = useContext(MarkdownLinkContext);
  delete props.node;
  const href = typeof src === "string" ? src : undefined;
  const filePath = href ? resolveLocalFileHref(href, cwd) : null;
  const imageSrc = filePath
    ? `/api/files/${encodeFilePathForApi(filePath)}?type=read`
    : href;
  // Dynamic local paths are served directly by the file API.
  // eslint-disable-next-line @next/next/no-img-element
  const image = <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
  if (!imageSrc || insideLink) return image;
  return (
    <ImagePreview src={imageSrc} alt={alt ?? ""} className="markdown-image">
      {image}
    </ImagePreview>
  );
}

/**
 * fork:markdown-incremental — 构造一套 markdown 叶子渲染器。
 *
 * `readStreaming` 用回调而不是布尔值：一次性渲染路径把读取推迟到渲染真正发生的
 * 那一刻（`streamingRef`），因此 `isStreaming` 翻转不会重建整棵 `components`、
 * 触发全量 reconcile（本仓库刻意的修复）；分块路径则各自闭包自己的分块标记。
 */
function buildMarkdownComponents(
  readStreaming: () => boolean,
  cwd: string | undefined,
  onOpenFile: ((filePath: string, page?: number) => void) | undefined,
): Components {
  return {
    code({ className, children, ...props }) {
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      const isBlock = className?.includes("language-") || raw.includes("\n");
      const streaming = readStreaming();
      if (isBlock) {
        if (lang === "mermaid") {
          return (
            <MermaidBlock
              code={raw.replace(/\n$/, "")}
              isStreaming={streaming}
              defaultPreview
            />
          );
        }
        return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} isStreaming={streaming} />;
      }
      return (
        <code
          className="markdown-inline-code"
          {...props}
        >
          {children}
        </code>
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    a({ href, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
      // fork:pdf-page-fragment — resolveLocalFileHref drops `#…`; page lives only on the raw href.
      const page = onOpenFile ? parsePdfPageFragment(href) : null;
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        return (
          <MarkdownLinkContext.Provider value={true}>
            <ExternalLink href={href} {...props}>
              {children}
            </ExternalLink>
          </MarkdownLinkContext.Provider>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (!shouldOpenLocalFileInApp(event)) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath, page ?? undefined);
      };

      return (
        <MarkdownLinkContext.Provider value={true}>
          <a href={href} {...props} onClick={handleClick}>
            {children}
          </a>
        </MarkdownLinkContext.Provider>
      );
    },
    img(props) {
      return <MarkdownImage cwd={cwd} {...props} />;
    },
    table({ children }) {
      return (
        <div className="markdown-table-wrap">
          <table>{children}</table>
        </div>
      );
    },
  };
}

/**
 * fork:markdown-incremental — 一个稳定的 Markdown 分块。
 *
 * `memo` 用引用相等跳过没变的分块：稳定块的文本由 `splitStableParts` 的
 * interning cache（cyrb53）复用同一个字符串对象，所以流式期间只有增长的 tail
 * 会重跑 remark/rehype 管线，已完成区块不再重复解析。
 *
 * 稳定块按 `partStreaming=false` 渲染：块内代码围栏已经闭合，可以立刻走高亮/
 * Mermaid 预览；只有 tail 保持流式行为（Mermaid 显示源码、代码块纯文本）。
 */
const MarkdownPart = memo(function MarkdownPart({
  text,
  partStreaming,
  remarkPlugins,
  rehypePlugins,
  cwd,
  onOpenFile,
}: {
  text: string;
  partStreaming: boolean;
  remarkPlugins: ComponentProps<typeof ReactMarkdown>["remarkPlugins"];
  rehypePlugins: ComponentProps<typeof ReactMarkdown>["rehypePlugins"];
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
}) {
  const components = useMemo(
    () => buildMarkdownComponents(() => partStreaming, cwd, onOpenFile),
    [partStreaming, cwd, onOpenFile],
  );
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      urlTransform={onOpenFile ? markdownUrlTransform : undefined}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
});

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile, highlightMentions, mentionValidators }: MarkdownBodyProps) {
  // fork:fix-markdown-stream — 节流后的可见文本。
  //
  // 原先这里直接 `useMemo(normalizeDisplayMath, [children])`：`children` 是流式增长的
  // 字符串，每来一个 delta 都会让整条管线（normalizeDisplayMath 全文行扫描 +
  // react-markdown 全量 parse + rehype 全量 transform）重跑一遍，长回答因此越到
  // 尾越卡。现在流式期间最多每 120ms 重跑一次，且流式结束时一定交付完整文本。
  const visibleText = useThrottledText(children, { active: Boolean(isStreaming) });
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(visibleText), [visibleText]);
  // fork:fix-markdown-stream — 流式期间不跑同步 KaTeX 排版（见 lib/markdown.ts）。
  // D2-PR-12 — mention 高亮的两段式接线：
  // 1. remark 插件只在 text 节点上工作 → 代码块 / 行内代码里的 @xxx 永不改样式；
  // 2. sanitize 会剥掉 span 的 class/data（默认 schema，本 PR 不改 lib/markdown.ts），
  //    所以插件先产出哨兵链接，再由 mentionRehypePlugin 在 sanitize 之后还原成
  //    <span class="mention-token …">。
  const mentionPlugins = useMemo(
    () => (highlightMentions && mentionValidators ? [mentionRemarkPlugin(mentionValidators)] : []),
    [highlightMentions, mentionValidators],
  );
  const rehypePlugins = useMemo(() => {
    const base = markdownRehypePluginsFor(Boolean(isStreaming)) ?? [];
    return mentionPlugins.length ? [...base, mentionRehypePlugin] : base;
  }, [isStreaming, mentionPlugins]);
  const remarkPlugins = useMemo(
    () => (mentionPlugins.length ? [...(markdownRemarkPlugins ?? []), ...mentionPlugins] : markdownRemarkPlugins),
    [mentionPlugins],
  );
  // 流式状态用 ref 透传给叶子渲染器，这样 `components` 的依赖里就不必包含
  // `isStreaming`：否则流式结束翻转那一下会让全部 code/img/a 渲染器 identity 失效，
  // 触发整棵消息树 reconcile。叶子在同一次 render 里读到的是最新值。
  const streamingRef = useRef(Boolean(isStreaming));
  streamingRef.current = Boolean(isStreaming);
  // Stable renderer identities keep stateful blocks mounted across message hover updates.
  const components = useMemo<Components>(
    () => buildMarkdownComponents(() => streamingRef.current, cwd, onOpenFile),
    [cwd, onOpenFile],
  );

  // fork:markdown-incremental — 稳定前缀块与增长的 tail 分开。
  //
  // interning cache 按内容哈希复用稳定块的字符串对象，配合 MarkdownPart 的
  // memo，流式期间已完成区块整块跳过 parse/rehype/Prism；未闭合的代码围栏
  // 会被 splitStableParts 整段拉进 tail，因此不会跨块撕裂。
  const partCacheRef = useRef<Map<string, string>>(new Map());
  const parts = useMemo(
    () => splitStableParts(normalizedMarkdown, partCacheRef.current),
    [normalizedMarkdown],
  );
  // 只有「流式 + 至少一个稳定块 + tail」才拆分渲染。流式结束后（或本来就不是
  // 流式）回到原来的单棵 ReactMarkdown，保证结束态与一次性渲染结果完全一致。
  const streamingSplit = Boolean(isStreaming) && parts.length > 1;

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      {streamingSplit ? (
        parts.map((part, index) => (
          <MarkdownPart
            key={`${index}-${part.id}`}
            text={part.text}
            partStreaming={part.tail}
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            cwd={cwd}
            onOpenFile={onOpenFile}
          />
        ))
      ) : (
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          urlTransform={onOpenFile ? markdownUrlTransform : undefined}
          components={components}
        >
          {normalizedMarkdown}
        </ReactMarkdown>
      )}
    </div>
  );
}
