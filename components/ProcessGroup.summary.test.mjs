import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { summarizeSteps } = await jiti.import("./ProcessGroup.tsx");

/** Labels pass through so assertions read as i18n keys plus their count. */
const t = (key, params) => `${key}:${params?.count ?? ""}`;

function toolBlock(toolName, input = {}) {
  return {
    type: "toolCall",
    id: `${toolName}-${Math.random()}`,
    origin: { phase: "process", placement: "inline", sourceMessageIndex: 0 },
    toolCallId: `${toolName}-id`,
    toolName,
    input,
    status: "success",
  };
}

function step(blocks, extra = {}) {
  return { id: `step-${Math.random()}`, label: "x", icon: "tool", targets: [], blocks, ...extra };
}

/*
 * fork:ui-19 — the turn summary line. Files are counted **distinctly** (one file
 * edited twice is one file), commands are shell-family calls, and the summary only
 * mentions categories that actually happened.
 */
test("distinct files, commands and tools are counted separately", () => {
  const summary = summarizeSteps([
    step([toolBlock("edit", { file_path: "src/a.ts" })]),
    step([toolBlock("edit", { file_path: "src/a.ts" })]),
    step([toolBlock("write", { file_path: "src/b.ts" })]),
    step([toolBlock("bash", { command: "npm test" })]),
    step([toolBlock("bash", { command: "ls" })]),
    step([toolBlock("grep", { pattern: "x" })]),
  ], t);

  assert.match(summary, /process\.summaryFiles:2/, "one file edited twice counts once");
  assert.match(summary, /process\.summaryCommands:2/);
  assert.match(summary, /process\.summaryTools:6/);
});

test("read-only turns summarize as reads instead of files", () => {
  const summary = summarizeSteps([
    step([toolBlock("read", { file_path: "src/a.ts" })]),
    step([toolBlock("find", { pattern: "*.ts" })]),
  ], t);

  assert.match(summary, /process\.summaryReads:2/);
  assert.doesNotMatch(summary, /process\.summaryFiles/);
  assert.doesNotMatch(summary, /process\.summaryCommands/);
});

test("failures and thinking keep their own segments", () => {
  const failing = step([toolBlock("bash", { command: "false" })], { failed: true });
  const thinking = {
    id: "think",
    label: "reason",
    icon: "brain",
    targets: [],
    thinking: true,
    reasoning: true,
    blocks: [{ type: "thinking", id: "t1", origin: { phase: "process", placement: "inline", sourceMessageIndex: 0 }, thinking: "…" }],
  };
  const summary = summarizeSteps([thinking, failing], t);

  assert.match(summary, /process\.summaryThoughts:1/);
  assert.match(summary, /process\.summaryFailed:1/);
  assert.match(summary, /process\.summaryCommands:1/);
});

test("an empty turn produces no dangling separators", () => {
  const summary = summarizeSteps([], t);
  assert.match(summary, /process\.summaryTools:0/);
  assert.doesNotMatch(summary, / ·  · /);
});
