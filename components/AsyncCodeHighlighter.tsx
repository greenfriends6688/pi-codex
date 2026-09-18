"use client";

/**
 * fork:perf-highlighter — the syntax highlighter, isolated in its own chunk.
 *
 * `code-splitting` note: this file must stay the *only* module that imports
 * react-syntax-highlighter, so the bundler can put it behind a dynamic import.
 * Upstream imported it statically in MermaidBlock.tsx, which pulled its ~1.5MB
 * (Prism with every language) into the initial chat route — every page load and
 * every file open paid for highlighting that most views never use.
 *
 * Themes are imported one file at a time (`styles/prism/vs`, not the
 * `styles/prism` barrel): the barrel re-exports ~200 themes and none of them
 * tree-shake reliably through CJS.
 *
 * ponytail: still ships Prism's full language set in the lazy chunk. Swap to
 * `PrismAsyncLight` + registerLanguage for the handful of languages we see if
 * that chunk ever shows up in a real performance profile.
 */

import {
  Prism as SyntaxHighlighter,
  createElement as renderSyntaxNode,
  type SyntaxHighlighterProps,
} from "react-syntax-highlighter";
import { FILE_CODE_STYLE, FILE_LINE_NUMBER_STYLE } from "@/lib/file-source-styles";
import vs from "react-syntax-highlighter/dist/esm/styles/prism/vs";
import vscDarkPlus from "react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus";

export type HighlighterProps = SyntaxHighlighterProps & { isDark?: boolean };

type SourceCodeRendererProps = Parameters<NonNullable<SyntaxHighlighterProps["renderer"]>>[0] & {
  wrapLines: boolean;
};

/**
 * One `<span class="file-source-line">` per source line, so the viewer's line numbers,
 * per-line location highlight and text selection keep working on top of Prism's token
 * tree. Moved here from FileViewer.tsx (which must not import this package at all).
 */
function SourceCodeRenderer({ rows, stylesheet, useInlineStyles, wrapLines }: SourceCodeRendererProps) {
  return rows.map((row, lineIndex) => {
    const children = row.children ?? [];
    const firstChildClasses = children[0]?.properties?.className;
    const hasLineNumber = Array.isArray(firstChildClasses)
      && firstChildClasses.includes("react-syntax-highlighter-line-number");
    const lineNumberNode = hasLineNumber ? children[0] : null;
    const contentNodes = hasLineNumber ? children.slice(1) : children;

    return (
      <span
        className="file-source-line"
        data-line-number={lineIndex + 1}
        key={`source-line-${lineIndex}`}
        style={{ display: "flex", minWidth: "100%" }}
      >
        {lineNumberNode && renderSyntaxNode({
          node: lineNumberNode,
          stylesheet,
          useInlineStyles,
          key: `source-line-number-${lineIndex}`,
        })}
        <span
          className="file-source-line-content"
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            overflowWrap: wrapLines ? "anywhere" : "normal",
            whiteSpace: wrapLines ? "pre-wrap" : "pre",
          }}
        >
          {contentNodes.map((node, tokenIndex) => renderSyntaxNode({
            node,
            stylesheet,
            useInlineStyles,
            key: `source-token-${lineIndex}-${tokenIndex}`,
          }))}
        </span>
      </span>
    );
  });
}

export interface FileSourceViewProps {
  code: string;
  language: string;
  isDark: boolean;
  wrapLines: boolean;
}

/** The file viewer's highlighted source view (see useLazyHighlighter.ts). */
export function AsyncFileSourceView({ code, language, isDark, wrapLines }: FileSourceViewProps) {
  return (
    <SyntaxHighlighter
      className={wrapLines ? "file-source-view is-wrapped" : "file-source-view"}
      language={language === "text" ? "plaintext" : language}
      style={isDark ? vscDarkPlus : vs}
      showLineNumbers
      lineNumberStyle={{ ...FILE_LINE_NUMBER_STYLE }}
      customStyle={{
        margin: 0,
        padding: 0,
        border: 0,
        background: "var(--bg)",
        ...FILE_CODE_STYLE,
        width: wrapLines ? "100%" : "max-content",
        minWidth: "100%",
        minHeight: "100%",
        overflow: "visible",
      }}
      codeTagProps={{
        style: {
          fontFamily: "var(--font-mono)",
          overflowWrap: wrapLines ? "anywhere" : "normal",
        },
      }}
      renderer={(rendererProps) => <SourceCodeRenderer {...rendererProps} wrapLines={wrapLines} />}
      wrapLongLines={wrapLines}
    >
      {code}
    </SyntaxHighlighter>
  );
}

export default function AsyncCodeHighlighter({ isDark, ...props }: HighlighterProps) {
  return <SyntaxHighlighter {...props} style={isDark ? vscDarkPlus : vs} />;
}
