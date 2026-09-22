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

/*
 * fork:zc-19 — the human-readable frequency editor must compile to the existing
 * 5-field cron (lib/cron-rule.ts); the raw expression remains an escape hatch.
 */
test("the frequency editor compiles readable rules to cron", () => {
  assert.match(source, /import \{ compileCronRule, parseClockTime, type CronRule \} from "@\/lib\/cron-rule"/);
  assert.match(source, /const scheduleForCreate = \(\): CronSchedule \| null => \{/);
  assert.match(source, /const result = compiledResult;/);
  assert.match(source, /kind: "cron",\s*\n\s*times: \[\],\s*\n\s*expression: result\.expression,/);
  assert.match(source, /t\("cron\.frequency"\)/);
  assert.match(source, /t\("cron\.freq\.monthly"\)/);
  assert.match(source, /t\("cron\.monthlyByWeekday"\)/);
  assert.match(source, /t\("cron\.endDate"\)/);
  assert.match(source, /t\("cron\.compiled"\)/);
});

/*
 * fork:zc-14 — the per-task history region: 8 rows per page, start/end, status,
 * output excerpt, open-session and delete-a-row.
 */
test("the run history region pages 8 rows and links to the run session", () => {
  assert.match(source, /const HISTORY_PAGE_SIZE = 8;/);
  assert.match(source, /function TaskHistory\(\{ task, onOpenSession, onDeleteRun \}/);
  assert.match(source, /runs\.slice\(\(currentPage - 1\) \* HISTORY_PAGE_SIZE, currentPage \* HISTORY_PAGE_SIZE\)/);
  assert.match(source, /t\("cron\.history\.pageOf", \{ current: currentPage, total: totalPages \}\)/);
  assert.match(source, /t\("cron\.openRun"\)/);
  assert.match(source, /t\("cron\.history\.deleteRun"\)/);
  assert.match(source, /run\.outputExcerpt \?\? ""/);
  assert.match(source, /run\.finishedAt \? new Date\(run\.finishedAt\) : null/);
  assert.match(source, /\/api\/cron\?id=\$\{encodeURIComponent\(taskId\)\}&runId=/);
});
