import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ProcessGroup, buildProcessSteps } = await jiti.import("./ProcessGroup.tsx");
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

/*
 * fork:zm-02 — streaming entrance. The component must stay inert wherever the
 * motion preference is unknown (SSR / jsdom), and the stagger slot must come
 * from the stable per-turn step ordinal rather than the render array index.
 */

function renderStreaming(messages) {
  const blocks = messages.flatMap((message, messageIndex) => messageToProcessContentBlocks(message, {
    messageIndex,
    entryId: `entry-${messageIndex}`,
    phase: "process",
  }));
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ProcessGroup, { blocks, isStreaming: true, reveal: true }),
    ),
  );
}

function assistantWithToolCalls(toolCallIds) {
  return {
    role: "assistant",
    provider: "test",
    model: "test",
    content: toolCallIds.map((id) => ({
      type: "toolCall",
      toolCallId: id,
      toolName: "read",
      input: { file_path: `${id}.ts` },
    })),
  };
}

test("SSR never emits the entrance scope, marker or delay variable", () => {
  const html = renderStreaming([assistantWithToolCalls(["call-a", "call-b"])]);

  // The motion preference is unknown on the server, so nothing animation-related
  // may leave the server render: the scope attribute, the per-row marker and the
  // delay variable only appear once a mounted browser reported no-preference.
  assert.doesNotMatch(html, /data-fork-stream-animate/);
  assert.doesNotMatch(html, /data-fork-enter/);
  assert.doesNotMatch(html, /--fork-enter-delay/);
});

test("step sequences are stable while the turn grows", () => {
  const firstBlocks = messageToProcessContentBlocks(assistantWithToolCalls(["call-a", "call-b"]), {
    messageIndex: 0,
    entryId: "entry-0",
    phase: "process",
  });
  const t = (key) => key;
  const first = buildProcessSteps(firstBlocks, t);
  assert.deepEqual(first.map((step) => step.sequence), [0], "consecutive same-tone calls group into one step");

  const grownBlocks = messageToProcessContentBlocks(assistantWithToolCalls(["call-a", "call-b", "call-c"]), {
    messageIndex: 0,
    entryId: "entry-0",
    phase: "process",
  });
  const grown = buildProcessSteps(grownBlocks, t);
  assert.equal(grown[0].sequence, 0, "the existing step keeps its slot");
  assert.equal(grown[0].count, 3);

  const mixed = buildProcessSteps([
    ...messageToProcessContentBlocks(assistantWithToolCalls(["call-a"]), {
      messageIndex: 0,
      entryId: "entry-0",
      phase: "process",
    }),
    {
      id: "entry-0:1",
      origin: { phase: "process", placement: "inline", sourceMessageIndex: 0 },
      type: "text",
      text: "done",
    },
  ], t);
  assert.deepEqual(mixed.map((step) => step.sequence), [0, 1]);
});

test("the entrance delay reads step.sequence, never the render index", async () => {
  const source = await readFile(new URL("./ProcessGroup.tsx", import.meta.url), "utf8");
  assert.match(source, /--fork-enter-delay/);
  assert.match(source, /streamEnterDelay\(step\.sequence\)/);
  assert.match(source, /data-fork-stream-animate/);
  assert.match(source, /data-fork-enter/);
});
