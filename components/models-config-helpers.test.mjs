// fork:upstream-0.9.2-thinking-profile — D2-PR-21 展示层的单测
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { formatThinkingRequestParams } = await createJiti(import.meta.url)
  .import("./models-config-helpers.ts");

test("flattens nested request params into one line", () => {
  assert.equal(
    formatThinkingRequestParams({ reasoning_effort: "high" }),
    "reasoning_effort=high",
  );
  assert.equal(
    formatThinkingRequestParams({ thinking: { type: "enabled", budget_tokens: 8192, display: "summarized" } }),
    "thinking.type=enabled, thinking.budget_tokens=8192, thinking.display=summarized",
  );
  assert.equal(
    formatThinkingRequestParams({ thinkingConfig: { includeThoughts: true, thinkingLevel: "HIGH" } }),
    "thinkingConfig.includeThoughts=true, thinkingConfig.thinkingLevel=HIGH",
  );
  assert.equal(
    formatThinkingRequestParams({ reasoning: { effort: "none" }, include: ["reasoning.encrypted_content"] }),
    "reasoning.effort=none, include=reasoning.encrypted_content",
  );
});

test("returns null when a level sends no reasoning params", () => {
  assert.equal(formatThinkingRequestParams({}), null);
});
