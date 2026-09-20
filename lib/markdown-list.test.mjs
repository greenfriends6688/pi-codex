import assert from "node:assert/strict";
import test from "node:test";

const { continueMarkdownList } = await import("./markdown-list.ts");

test("continues unordered list markers", () => {
  assert.deepEqual(continueMarkdownList("- item", 6, 6), { value: "- item\n- ", caret: 9 });
  assert.deepEqual(continueMarkdownList("* item", 6, 6), { value: "* item\n* ", caret: 9 });
  assert.deepEqual(continueMarkdownList("+ item", 6, 6), { value: "+ item\n+ ", caret: 9 });
});

test("continues ordered lists by incrementing the number", () => {
  assert.deepEqual(continueMarkdownList("1. item", 7, 7), { value: "1. item\n2. ", caret: 11 });
  assert.deepEqual(continueMarkdownList("3) item", 7, 7), { value: "3) item\n4) ", caret: 11 });
  assert.deepEqual(continueMarkdownList("9. item", 7, 7), { value: "9. item\n10. ", caret: 12 });
});

test("continues task checkboxes as unchecked", () => {
  assert.deepEqual(continueMarkdownList("- [ ] task", 10, 10), { value: "- [ ] task\n- [ ] ", caret: 17 });
  assert.deepEqual(continueMarkdownList("- [x] task", 10, 10), { value: "- [x] task\n- [ ] ", caret: 17 });
});

test("continues blockquotes, nested and combined prefixes", () => {
  assert.deepEqual(continueMarkdownList("> line", 6, 6), { value: "> line\n> ", caret: 9 });
  assert.deepEqual(continueMarkdownList(">> line", 7, 7), { value: ">> line\n>> ", caret: 11 });
  assert.deepEqual(continueMarkdownList("  - item", 8, 8), { value: "  - item\n  - ", caret: 13 });
  assert.deepEqual(continueMarkdownList("> - [ ] item", 13, 13), { value: "> - [ ] item\n> - [ ] ", caret: 22 });
});

test("an empty item ends the structure by removing the marker", () => {
  assert.deepEqual(continueMarkdownList("- ", 2, 2), { value: "", caret: 0 });
  assert.deepEqual(continueMarkdownList("> item\n> ", 9, 9), { value: "> item\n", caret: 7 });
  assert.deepEqual(continueMarkdownList("1. ", 3, 3), { value: "", caret: 0 });
  assert.deepEqual(continueMarkdownList("- [ ] ", 6, 6), { value: "", caret: 0 });
  assert.deepEqual(continueMarkdownList("  - ", 4, 4), { value: "", caret: 0 });
});

test("handles a caret in the middle of the line and selections", () => {
  assert.deepEqual(continueMarkdownList("- item more", 4, 4), { value: "- it\n- em more", caret: 7 });
  // 先替换选区再续行（选中 "te" 得到 "- im"，仍是非空项）；
  // 若选中的是整个条目内容则变成空项，于是结束列表。
  assert.deepEqual(continueMarkdownList("- item", 3, 5), { value: "- i\n- m", caret: 6 });
  assert.deepEqual(continueMarkdownList("- item", 2, 5), { value: "m", caret: 0 });
});

test("returns null for lines without a structural prefix", () => {
  assert.equal(continueMarkdownList("plain text", 10, 10), null);
  assert.equal(continueMarkdownList("# heading", 9, 9), null);
  assert.equal(continueMarkdownList("", 0, 0), null);
  assert.equal(continueMarkdownList("```", 3, 3), null);
  assert.equal(continueMarkdownList("  ", 2, 2), null);
  assert.equal(continueMarkdownList("-", 1, 1), null); // 没有尾随空格的标记不算列表
});
