import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

/*
 * fork:process-live-2 — a running turn must stay on the grouped renderer.
 *
 * The live tail used to render every message flat and only the in-flight one
 * reached `ProcessGroup`, so with "process display: steps" the timeline was
 * visible for one message and flipped back to the flat list as soon as the
 * turn's first tool call was committed to `messages` — then flipped again when
 * the turn finished. The turn is now one timeline from start to finish.
 */

// The branch runs from its guard to the point where it reports that the turn's
// timeline has been emitted; `rendered.push(renderMessage(userIdx))` sits in the
// middle of it and would cut the slice short.
const LIVE_TAIL_END = "liveTurnTimeline = true;";
const liveTail = source.slice(
  source.indexOf("const isLiveTail ="),
  source.indexOf(LIVE_TAIL_END) + LIVE_TAIL_END.length,
);

test("the running turn is rendered as one timeline instead of the flat list", () => {
  assert.ok(liveTail.length > 0, "the live-tail branch moved; update this test with it");
  // legacy keeps the flat renderer …
  assert.match(liveTail, /if \(!grouped\) \{/);
  // … and the grouped path builds a single group out of the turn's committed
  // steps plus the in-flight blocks.
  assert.match(liveTail, /const liveBlocks: ProcessContentBlock\[\] = \[\]/);
  assert.match(liveTail, /liveBlocks\.push\(\.\.\.streamingProcess\.blocks\)/);
  assert.match(liveTail, /<ProcessGroup/);
  assert.match(liveTail, /liveTurnTimeline = true/);
});

test("the in-flight message is converted once and shared by both call sites", () => {
  assert.match(source, /const streamingProcess = useMemo\(\(\) => \{/);
  assert.match(source, /if \(processDisplayMode === "legacy"\) return null;/);
});

test("the streaming block contributes only the answer once the timeline exists", () => {
  const streaming = source.slice(source.indexOf("streamState.isStreaming && hasStreamingContent"));
  assert.ok(streaming.length > 0, "the streaming block moved; update this test with it");
  assert.match(streaming, /if \(liveTurnTimeline\) return answerView;/);
  assert.match(
    streaming,
    /if \(!streamingProcess \|\| \(streamingProcess\.blocks\.length === 0 && !liveTurnTimeline\)\)/,
  );
});
