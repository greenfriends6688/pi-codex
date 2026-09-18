import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { MarkdownFilePreview } = await jiti.import("./MarkdownFilePreview.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

test("keeps source Markdown line ranges on rendered selectable blocks", () => {
  const html = renderToStaticMarkup(React.createElement(MarkdownFilePreview, {
    content: "# Title\n\nFirst paragraph\ncontinues here\n\nSecond paragraph\n",
    filePath: "D:/workspace/example.md",
  }));

  assert.match(html, /<h1[^>]*data-source-start-line="1"[^>]*data-source-end-line="1"/);
  assert.match(html, /<p[^>]*data-source-start-line="3"[^>]*data-source-end-line="4"/);
  assert.match(html, /<p[^>]*data-source-start-line="6"[^>]*data-source-end-line="6"/);
});

test("splits multiline Markdown text into line-level spans", () => {
  const html = renderToStaticMarkup(React.createElement(MarkdownFilePreview, {
    content: "First paragraph\ncontinues here\n",
    filePath: "D:/workspace/example.md",
  }));

  assert.match(html, /<span[^>]*data-source-line="1"[^>]*>First paragraph\n<\/span>/);
  // Markdown parsers do not retain the paragraph's trailing newline in the
  // text node; the line identity is carried by the span itself.
  assert.match(html, /<span[^>]*data-source-line="2"[^>]*>continues here<\/span>/);
});

test("keeps source-line identity through inline Markdown", () => {
  const html = renderToStaticMarkup(React.createElement(MarkdownFilePreview, {
    content: "This is **bold** and [linked](https://example.com).\n",
    filePath: "D:/workspace/example.md",
  }));

  assert.match(html, /<strong><span[^>]*data-source-line="1"[^>]*>bold<\/span><\/strong>/);
  assert.match(html, /<a href="https:\/\/example\.com"><span[^>]*data-source-line="1"[^>]*>linked<\/span><\/a>/);
});

test("does not wrap fenced code text with source-line spans", () => {
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(MarkdownFilePreview, {
      content: "```ts\nconst value = 1;\n```\n",
      filePath: "D:/workspace/example.md",
    }),
  ));

  assert.doesNotMatch(html, /data-source-line=/);
  // fork:perf-highlighter — the source-line wrapper belongs on the block, not on the
  // code text. The token spans only appear once the lazily imported highlighter has
  // loaded (see MermaidBlock.test.mjs), so the static render checks the wrapper only.
  assert.match(html, /class="markdown-code-block"/);
  assert.doesNotMatch(html, /class="token"/);
});

test("fork:fix-md-preview — sourceLines=false 时不注入行号 spans（阅读路径的省钱开关）", () => {
  const html = renderToStaticMarkup(React.createElement(MarkdownFilePreview, {
    content: "# Title\n\nFirst paragraph\ncontinues here\n",
    filePath: "D:/workspace/example.md",
    sourceLines: false,
  }));

  assert.doesNotMatch(html, /data-source-line=/);
  // 块级区间仍然保留：它只服务滚动定位，不会产生逐行节点。
  assert.match(html, /<p[^>]*data-source-start-line="3"[^>]*data-source-end-line="4"/);
});
