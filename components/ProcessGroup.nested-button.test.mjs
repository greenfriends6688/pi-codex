// fork:fix-nested-button — 守卫：文件 chip 不能渲染成 <button>
//
// 背景（用户实测的报错）：
//   In HTML, <button> cannot be a descendant of <button>. / <button> cannot contain a nested <button>.
// 症状：hydration 报错刷控制台，开发者工具里整棵过程步骤都是红的。
// 根因：`FileChips` 的两个调用点都在按钮内部（步骤行 `process-step-row`、紧凑行 `process-chip`），
// 而它自己渲染的是 `<button className="process-file-chip">` → 嵌套按钮（非法 HTML）。
// 修法：chip 改成 `span[role=button] tabIndex=0` + Enter/Space 处理，行为与可达性不变。
//
// 这条测试把「chip 不是 button」钉住：有人图省事改回 `<button>` 会立刻红。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ProcessGroup.tsx", import.meta.url), "utf8");

// 注释里也会出现 "<button>" 字样（就是在解释这个坑），先去掉行注释再断言
const code = source.replace(/^\s*\/\/.*$/gm, "");

test("文件 chip 是 span[role=button]，不是 <button>", () => {
  assert.doesNotMatch(
    code,
    /<button[^>]*className="process-file-chip"/,
    "process-file-chip 不能是 <button>：它的调用点都在按钮内部",
  );
  assert.match(code, /<span[^>]*role="button"[\s\S]{0,200}?className="process-file-chip"/, "chip 应当是 span[role=button]");
});

test("chip 的键盘可达性没丢（Enter / 空格同样打开文件）", () => {
  assert.match(code, /onKeyDown=\{\(event\) => \{[\s\S]{0,300}?onOpenFile\(target\)/, "chip 要有键盘处理");
  assert.match(code, /event\.stopPropagation\(\);\s*\n?\s*onOpenFile\(target\)/, "点击要阻止冒泡（否则会连带折叠步骤行）");
});

test("这个文件里只有一个 <button>（时间线步骤行），别的地方不许再冒出来", () => {
  // 标签视图删除前是 2 个（步骤行 + 芯片条），现在只剩步骤行。
  const buttons = code.match(/<button/g) ?? [];
  assert.equal(buttons.length, 1, `ProcessGroup.tsx 期望只有 1 个 <button>，实际 ${buttons.length} 个`);
});
