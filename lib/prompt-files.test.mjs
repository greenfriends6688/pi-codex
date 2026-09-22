// fork:zc-16 — prompt file naming, frontmatter preservation, body round-trip.
import assert from "node:assert/strict";
import test from "node:test";

const {
  buildPromptContent,
  normalizePromptName,
  parsePromptFile,
  promptFileName,
  readPromptBody,
  readPromptDescription,
  replacePromptBody,
  resolvePromptPath,
  setPromptDescription,
} = await import("./prompt-files.ts");

test("accepts plain names with or without the .md suffix", () => {
  assert.equal(normalizePromptName("review"), "review");
  assert.equal(normalizePromptName("review.md"), "review");
  assert.equal(normalizePromptName("code-review_2"), "code-review_2");
  assert.equal(normalizePromptName("  review.md  "), "review");
  assert.equal(promptFileName("review"), "review.md");
});

test("rejects traversal, separators, hidden and oversized names", () => {
  assert.equal(normalizePromptName("../evil"), null);
  assert.equal(normalizePromptName("a/b"), null);
  assert.equal(normalizePromptName("a\\b"), null);
  assert.equal(normalizePromptName(".."), null);
  assert.equal(normalizePromptName(".hidden"), null);
  assert.equal(normalizePromptName(""), null);
  assert.equal(normalizePromptName("   "), null);
  assert.equal(normalizePromptName("x".repeat(65)), null);
  assert.equal(normalizePromptName("bad\u0000name"), null);
  assert.equal(normalizePromptName("review.txt"), null);
});

test("resolvePromptPath stays inside the prompts root", () => {
  assert.equal(resolvePromptPath("/home/u/.pi/agent/prompts", "review"), "/home/u/.pi/agent/prompts/review.md");
  assert.equal(resolvePromptPath("/home/u/.pi/agent/prompts", "../secrets"), null);
  assert.equal(resolvePromptPath("/home/u/.pi/agent/prompts", "/etc/passwd"), null);
});

test("reads simple and quoted descriptions", () => {
  assert.equal(readPromptDescription("---\ndescription: Hello world\n---\nbody"), "Hello world");
  assert.equal(readPromptDescription('---\ndescription: "Hello: world"\n---\nbody'), "Hello: world");
  assert.equal(readPromptDescription("---\ndescription: 'it''s fine'\n---\nbody"), "it's fine");
  assert.equal(readPromptDescription("no frontmatter here"), "");
  assert.equal(readPromptDescription("---\ntitle: x\n---\nbody"), "");
});

test("description edit preserves comments, unknown keys and body byte-for-byte", () => {
  const original = [
    "---",
    "# keep this comment",
    "name: draft",
    "description: old description",
    "custom:",
    "  nested: true",
    "---",
    "",
    "Body line 1",
    "",
    "Body line 2",
    "",
  ].join("\n");

  const edited = setPromptDescription(original, "new description");
  assert.equal(readPromptDescription(edited), "new description");
  assert.match(edited, /# keep this comment/);
  assert.match(edited, /name: draft/);
  assert.match(edited, /custom:\n  nested: true/);
  assert.equal(readPromptBody(edited), readPromptBody(original));
});

test("inserts description without disturbing the rest when the key is absent", () => {
  const original = "---\nname: draft\ncustom: 1\n---\nBody\n";
  const edited = setPromptDescription(original, "Added");
  assert.equal(readPromptDescription(edited), "Added");
  assert.match(edited, /name: draft\ncustom: 1/);
  assert.equal(readPromptBody(edited), "Body\n");
});

test("empty description removes the key but keeps other keys", () => {
  const original = "---\nname: draft\ndescription: gone soon\ncustom: 1\n---\nBody\n";
  const edited = setPromptDescription(original, "");
  assert.equal(readPromptDescription(edited), "");
  assert.doesNotMatch(edited, /description:/);
  assert.match(edited, /name: draft\ncustom: 1/);
});

test("adds a frontmatter block when the file has none", () => {
  const edited = setPromptDescription("Just a body\n", "First");
  assert.equal(edited, "---\ndescription: First\n---\nJust a body\n");
  // No description and no frontmatter: the file is left alone.
  assert.equal(setPromptDescription("Just a body\n", ""), "Just a body\n");
});

test("special characters are serialized as valid quoted YAML", () => {
  const value = "Use: a, b — \"quotes\"\nand a newline";
  const edited = setPromptDescription("---\nname: x\n---\nbody", value);
  assert.equal(readPromptDescription(edited), value);
  // The quoted scalar must not leak a raw newline into the frontmatter.
  const head = edited.slice(0, edited.indexOf("\n---", 3));
  assert.equal(head.split("\n").length, 3);
});

test("body replacement keeps the blank line after the fence", () => {
  const original = "---\ndescription: x\n---\n\nOld body\n";
  const replaced = replacePromptBody(original, "New body\n");
  assert.equal(replaced, "---\ndescription: x\n---\n\nNew body\n");
  assert.equal(readPromptBody(replaced), "\nNew body\n");
  assert.equal(readPromptDescription(replaced), "x");
});

test("CRLF frontmatter survives a description edit", () => {
  const original = "---\r\ndescription: old\r\nname: keep\r\n---\r\nbody\r\n";
  const edited = setPromptDescription(original, "new");
  assert.equal(readPromptDescription(edited), "new");
  assert.match(edited, /name: keep/);
  assert.match(edited, /\r\n/);
});

test("parsePromptFile returns name, description, body and metadata", () => {
  const parsed = parsePromptFile(buildPromptContent("Do the thing", "Instructions here\n"), "thing", 42, "2026-09-21T00:00:00.000Z");
  assert.equal(parsed.name, "thing");
  assert.equal(parsed.description, "Do the thing");
  assert.equal(parsed.size, 42);
  assert.equal(parsed.mtime, "2026-09-21T00:00:00.000Z");
  assert.match(parsed.body, /Instructions here/);
});
