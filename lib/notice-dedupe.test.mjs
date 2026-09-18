import assert from "node:assert/strict";
import test from "node:test";

import { NOTICE_DEDUPE_TTL_MS, __resetNoticeDedupe, isDuplicateNotice } from "./notice-dedupe.ts";

const MEMORY_NOTICE = "memory_search requires qmd.\n\nInstall qmd (either works):";

test("the same notice is reported as a duplicate inside the window", () => {
  __resetNoticeDedupe();
  assert.equal(isDuplicateNotice(MEMORY_NOTICE), false);
  assert.equal(isDuplicateNotice(MEMORY_NOTICE), true);
});

test("different text and different types still get through", () => {
  __resetNoticeDedupe();
  assert.equal(isDuplicateNotice(MEMORY_NOTICE), false);
  assert.equal(isDuplicateNotice(`${MEMORY_NOTICE} `), false, "trimmed text differs");
  assert.equal(isDuplicateNotice("another notice"), false);
  assert.equal(isDuplicateNotice(MEMORY_NOTICE, "error"), false, "same text, other type");
});

test("the notice surfaces again once the window has passed", () => {
  __resetNoticeDedupe();
  const start = 1_000;
  assert.equal(isDuplicateNotice(MEMORY_NOTICE, "info", start), false);
  assert.equal(isDuplicateNotice(MEMORY_NOTICE, "info", start + NOTICE_DEDUPE_TTL_MS), true);
  assert.equal(isDuplicateNotice(MEMORY_NOTICE, "info", start + NOTICE_DEDUPE_TTL_MS + 1), false);
});
