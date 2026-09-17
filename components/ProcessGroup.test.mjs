import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ProcessGroup } = await jiti.import("./ProcessGroup.tsx");
const { messageToProcessContentBlocks } = await jiti.import("@/lib/process-content");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderGroup(messages) {
  const blocks = messages.flatMap((message, messageIndex) => messageToProcessContentBlocks(message, {
    messageIndex,
    entryId: `entry-${messageIndex}`,
    phase: "process",
  }));
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ProcessGroup, { blocks, reveal: true }),
    ),
  );
}

test("renders custom content arrays and standalone image blocks", () => {
  const html = renderGroup([
    {
      role: "custom",
      customType: "status",
      display: true,
      content: [
        { type: "text", text: "Scanning the workspace" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "abc123" } },
      ],
    },
    {
      role: "assistant",
      provider: "test",
      model: "test",
      content: [
        { type: "image", source: { type: "url", url: "https://example.com/shot.png" } },
      ],
    },
  ]);

  assert.match(html, /Scanning the workspace/);
  assert.doesNotMatch(html, /\[object Object\]/);
  assert.match(html, /data:image\/png;base64,abc123/);
  assert.match(html, /https:\/\/example\.com\/shot\.png/);
});
