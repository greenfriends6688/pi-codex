import assert from "node:assert/strict";
import test from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

// 直接加载被 --experimental-strip-types 处理的 TS 源文件：mention-tokens.ts 只有
// `import type`，运行时会被完整剥离。
async function loadSubject() {
  return import("./mention-tokens.ts");
}

const INDEX = new Set(["src/chat.tsx", "docs/guide.md", "assets"]);
const SKILLS = new Set(["agent-md", "planning-doc"]);

function validators() {
  return {
    fileExists: (p) => INDEX.has(p) ? true : false,
    isSkill: (n) => SKILLS.has(n) ? true : false,
  };
}

test("highlights valid @file mentions and keeps unknown ones plain", async () => {
  const { tokenizeMentions } = await loadSubject();
  const segments = tokenizeMentions("check @src/chat.tsx and @missing/file.ts", validators());

  assert.equal(segments.length, 4);
  assert.equal(segments[0].type, "text");
  assert.deepEqual(segments[1], {
    type: "mention",
    text: "@src/chat.tsx",
    token: { kind: "file", value: "src/chat.tsx", valid: true },
  });
  assert.deepEqual(segments[3].token, { kind: "file", value: "missing/file.ts", valid: false });
});

test("quoted mentions are matched only when closed", async () => {
  const { tokenizeMentions } = await loadSubject();
  const closed = tokenizeMentions('see @"docs/guide.md" here', validators());
  assert.equal(closed.filter((s) => s.type === "mention").length, 1);
  assert.equal(closed[1].token.valid, true);
  assert.equal(closed[1].text, '@"docs/guide.md"');

  // Unclosed quote = still being typed → no highlight.
  const open = tokenizeMentions('see @"docs/guide', validators());
  assert.equal(open.filter((s) => s.type === "mention").length, 0);
});

test("directory mentions with trailing slash are validated against dirs", async () => {
  const { tokenizeMentions } = await loadSubject();
  const segments = tokenizeMentions("@assets/", validators());
  assert.equal(segments[0].type, "mention");
  assert.equal(segments[0].token.valid, true);
  assert.equal(segments[0].token.value, "assets");
});

test("@ inside words and emails never matches", async () => {
  const { tokenizeMentions } = await loadSubject();
  const segments = tokenizeMentions("foo@bar.com and a@b", validators());
  assert.equal(segments.length, 1);
  assert.equal(segments[0].type, "text");
});

test("valid /skill: tokens highlight, unknown ones stay plain", async () => {
  const { tokenizeMentions } = await loadSubject();
  const good = tokenizeMentions("/skill:agent-md write a plan", validators());
  assert.deepEqual(good[0], {
    type: "mention",
    text: "/skill:agent-md",
    token: { kind: "skill", value: "agent-md", valid: true },
  });

  const bad = tokenizeMentions("/skill:unknown-skill x", validators());
  assert.equal(bad[0].type, "mention");
  assert.equal(bad[0].token.valid, false);
});

test("unknown validator state (not loaded) never validates", async () => {
  const { tokenizeMentions } = await loadSubject();
  const segments = tokenizeMentions("@src/chat.tsx", {});
  assert.equal(segments[0].type, "mention");
  assert.equal(segments[0].token.valid, false);
});

test("the token under the active @ query caret stays plain", async () => {
  const { tokenizeMentions } = await loadSubject();
  // The autocomplete query starts at the "@" (index 0).
  const segments = tokenizeMentions("@src/chat.tsx done", validators(), 0);
  assert.equal(segments[0].type, "text");
  assert.equal(segments[0].text, "@src/chat.tsx");
  assert.equal(segments[1].type, "text");
});

test("mentions at line starts and after whitespace are found", async () => {
  const { tokenizeMentions } = await loadSubject();
  const segments = tokenizeMentions("a\n@src/chat.tsx\nb @docs/guide.md", validators());
  const mentions = segments.filter((s) => s.type === "mention");
  assert.equal(mentions.length, 2);
  assert.ok(mentions.every((m) => m.token.valid));
});

test("highlights sha-shaped @comment: tokens as commit mentions", async () => {
  const { tokenizeMentions } = await loadSubject();
  const segments = tokenizeMentions("see @comment:a1b2c3d4e5 and @comment:zzz", validators());
  assert.equal(segments.length, 4);
  assert.deepEqual(segments[1], {
    type: "mention",
    text: "@comment:a1b2c3d4e5",
    token: { kind: "comment", value: "a1b2c3d4e5", valid: true },
  });
  // Non-sha values stay plain (invalid comment token).
  assert.deepEqual(segments[3], {
    type: "mention",
    text: "@comment:zzz",
    token: { kind: "comment", value: "zzz", valid: false },
  });
});

test("generic @ tokens never swallow the comment: prefix", async () => {
  const { tokenizeMentions } = await loadSubject();
  const segments = tokenizeMentions("@comment:a1b2c3d", validators());
  assert.equal(segments.length, 1);
  assert.equal(segments[0].token.kind, "comment");
});

test("@comment: needs the same word boundary as @file", async () => {
  const { tokenizeMentions } = await loadSubject();
  const segments = tokenizeMentions("foo@comment:a1b2c3d", validators());
  assert.equal(segments.length, 1);
  assert.equal(segments[0].type, "text");
});

// ── markdown pipeline ──────────────────────────────────────────────────────
// D2-PR-12：remark 阶段产出哨兵链接（只改 text 节点），sanitize 之后由
// mentionRehypePlugin 还原成带 class 的 span。这里用最严格的 defaultSchema
// 跑完整管线，证明 class/data 属性不会被 sanitize 洗掉。

async function runPipeline(markdown, pluginValidators) {
  const { mentionRemarkPlugin, mentionRehypePlugin } = await loadSubject();
  const processor = unified()
    .use(remarkParse)
    .use(mentionRemarkPlugin(pluginValidators))
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, defaultSchema)
    .use(mentionRehypePlugin);
  return processor.runSync(processor.parse(markdown));
}

function findSpan(tree) {
  const walk = (node) => {
    if (node.type === "element" && node.tagName === "span") return node;
    for (const child of node.children ?? []) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(tree);
}

test("remark plugin marks valid mentions as sentinel links and leaves invalid ones as text", async () => {
  const { mentionRemarkPlugin } = await loadSubject();
  const processor = unified().use(remarkParse).use(mentionRemarkPlugin({
    fileExists: (p) => (p === "src/chat.tsx" ? true : false),
  }));
  const tree = processor.runSync(processor.parse("see @src/chat.tsx and @nope.ts"));
  const children = tree.children[0].children;
  assert.deepEqual(children.map((c) => c.type), ["text", "link", "text", "text"]);
  assert.equal(children[1].url, "#pi-mention-file-src%2Fchat.tsx");
  assert.equal(children[1].children[0].value, "@src/chat.tsx");
  assert.equal(children[2].value, " and ");
  assert.equal(children[3].value, "@nope.ts");
});

test("pipeline wraps valid mentions in styled spans that survive sanitize", async () => {
  const tree = await runPipeline("see @src/chat.tsx and @nope.ts", {
    fileExists: (p) => (p === "src/chat.tsx" ? true : false),
  });
  const paragraph = tree.children[0];
  const span = paragraph.children.find((c) => c.type === "element");
  assert.ok(span, "valid mention renders as an element");
  assert.equal(span.tagName, "span");
  assert.deepEqual(span.properties.className, ["mention-token", "mention-token-file"]);
  assert.equal(span.properties.dataMentionKind, "file");
  assert.equal(span.properties.dataMentionValue, "src/chat.tsx");
  assert.equal(span.children[0].value, "@src/chat.tsx");
  // Invalid mention stays as plain text (no element).
  assert.equal(paragraph.children.filter((c) => c.type === "element").length, 1);
});

test("token text is carried as a text node, never as raw HTML", async () => {
  const tree = await runPipeline('see @"a&b 1<2.md" here', {
    fileExists: () => true,
  });
  const span = findSpan(tree);
  assert.ok(span);
  assert.equal(span.children[0].type, "text");
  assert.equal(span.children[0].value, '@"a&b 1<2.md"');
});

test("pipeline leaves code blocks untouched", async () => {
  const tree = await runPipeline("```\n@src/chat.tsx\n```", {
    fileExists: () => true,
  });
  // The fenced code is a code node, not a text node — nothing to split.
  assert.equal(tree.children[0].type, "element");
  assert.equal(tree.children[0].tagName, "pre");
  assert.equal(findSpan(tree), null);
  const code = tree.children[0].children.find((c) => c.tagName === "code");
  // remark 会给围栏代码补一个尾部换行。
  assert.equal(code.children[0].value, "@src/chat.tsx\n");
});

test("pipeline leaves inline code spans untouched", async () => {
  const tree = await runPipeline("use `@src/chat.tsx` inline", {
    fileExists: () => true,
  });
  assert.equal(findSpan(tree), null);
  const paragraph = tree.children[0];
  const inline = paragraph.children.find((c) => c.tagName === "code");
  assert.ok(inline);
  assert.equal(inline.children[0].value, "@src/chat.tsx");
});

test("pipeline splits only the text node that contains the mention", async () => {
  const tree = await runPipeline("**bold @src/chat.tsx end**", {
    fileExists: () => true,
  });
  const strong = tree.children[0].children[0];
  assert.equal(strong.tagName, "strong");
  assert.deepEqual(strong.children.map((c) => c.type), ["text", "element", "text"]);
  assert.equal(strong.children[1].tagName, "span");
  assert.deepEqual(strong.children[1].properties.className, ["mention-token", "mention-token-file"]);
});

test("pipeline renders valid skill tokens as spans, unknown skills plain", async () => {
  const tree = await runPipeline("/skill:agent-md write a plan", {
    isSkill: (n) => (n === "agent-md" ? true : false),
  });
  const span = findSpan(tree);
  assert.ok(span);
  assert.deepEqual(span.properties.className, ["mention-token", "mention-token-skill"]);
  assert.equal(span.properties.dataMentionValue, "agent-md");
});

test("pipeline renders valid comment tokens as spans", async () => {
  const tree = await runPipeline("revert @comment:a1b2c3d4e5 later", {});
  const span = findSpan(tree);
  assert.ok(span);
  assert.deepEqual(span.properties.className, ["mention-token", "mention-token-comment"]);
  assert.equal(span.properties.dataMentionValue, "a1b2c3d4e5");
});
