"use client";

import { createContext, useContext, useMemo, useRef, type ComponentProps, type MouseEvent } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { resolveLocalFileHref, shouldOpenLocalFileInApp } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownRehypePluginsFor, markdownRemarkPlugins, markdownUrlTransform, normalizeDisplayMath } from "@/lib/markdown";
import { useThrottledText } from "@/hooks/useThrottledText";
import { ImagePreview } from "./ImagePreview";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";

const MarkdownLinkContext = createContext(false);

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
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

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile }: MarkdownBodyProps) {
  // fork:fix-markdown-stream — 节流后的可见文本。
  //
  // 原先这里直接 `useMemo(normalizeDisplayMath, [children])`：`children` 是流式增长的
  // 字符串，每来一个 delta 都会让整条管线（normalizeDisplayMath 全文行扫描 +
  // react-markdown 全量 parse + rehype 全量 transform）重跑一遍，长回答因此越到
  // 尾越卡。现在流式期间最多每 120ms 重跑一次，且流式结束时一定交付完整文本。
  const visibleText = useThrottledText(children, { active: Boolean(isStreaming) });
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(visibleText), [visibleText]);
  // fork:fix-markdown-stream — 流式期间不跑同步 KaTeX 排版（见 lib/markdown.ts）。
  const rehypePlugins = markdownRehypePluginsFor(Boolean(isStreaming));
  // 流式状态用 ref 透传给叶子渲染器，这样 `components` 的依赖里就不必包含
  // `isStreaming`：否则流式结束翻转那一下会让全部 code/img/a 渲染器 identity 失效，
  // 触发整棵消息树 reconcile。叶子在同一次 render 里读到的是最新值。
  const streamingRef = useRef(Boolean(isStreaming));
  streamingRef.current = Boolean(isStreaming);
  // Stable renderer identities keep stateful blocks mounted across message hover updates.
  const components = useMemo<Components>(() => ({
    code({ className, children, ...props }) {
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      const isBlock = className?.includes("language-") || raw.includes("\n");
      const streaming = streamingRef.current;
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
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        return (
          <MarkdownLinkContext.Provider value={true}>
            <a href={href} {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          </MarkdownLinkContext.Provider>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (!shouldOpenLocalFileInApp(event)) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath);
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
  }), [cwd, onOpenFile]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={onOpenFile ? markdownUrlTransform : undefined}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
