import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./CronConfig.tsx", import.meta.url), "utf8");

/*
 * fork:fix-cron-model-list — `GET /api/models` returns `models` as a
 * `provider:id → display name` Record and the array a picker renders as
 * `modelList` (lib/models-cache.ts `ModelsData`). Reading the Record made
 * `.map` throw, the `.catch` swallowed the TypeError, and the picker silently
 * kept a single "default" option.
 */

test("the model picker lists the selectable models, not the lookup map", () => {
  assert.match(source, /setModels\(\(data\.modelList \?\? \[\]\)\.map\(/);
  assert.doesNotMatch(source, /data\?\.models/, "the Record has no .map()");
});

test("the default option names the model a run will actually use", () => {
  assert.match(source, /const defaultModelLabel = useMemo\(/);
  assert.match(source, /t\("cron\.modelDefault", \{ model: defaultModelLabel \}\)/);
});

test("a failed model list is reported instead of silently empty", () => {
  assert.match(source, /setModelsError\(data\.modelError \?\? null\)/);
  assert.match(source, /setModelsError\(cause instanceof Error \? cause\.message : String\(cause\)\)/);
  assert.match(source, /\{modelsError && \(/);
  assert.match(source, /t\("cron\.modelListError", \{ error: modelsError \}\)/);
});
