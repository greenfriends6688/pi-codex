#!/usr/bin/env node
/**
 * fork-patch — 零依赖的 unified diff 生成器。
 *
 * 为什么需要它：本仓库是从 macOS 拷贝过来的树，**没有 `.git`，机器上也没有 `git` / `diff` /
 * `python`**（`docs/proma-prs-2026-09-18.md` 附录 E.2 已记录）。而
 * `docs/patches/README.md` 要求每个补丁产出一份 `NNNN-<name>.patch`（unified diff），
 * 用来在合并上游后对照重打。于是这里自带一个 LCS diff，保证「可回滚补丁文件」这条纪律
 * 在没有版本控制的情况下也能执行。
 *
 * 用法：
 *   node scripts/fork-patch.mjs --old <旧文件> --new <新文件> --path <仓库相对路径>
 *   node scripts/fork-patch.mjs --old <旧> --new <新> --path src/a.ts \      # 多文件拼接
 *       --old <旧2> --new <新2> --path src/b.ts --out docs/patches/0002-x.patch
 *   node scripts/fork-patch.mjs --selftest                                   # 内置自检
 *
 * 输出是标准的 `--- a/<path>` / `+++ b/<path>` / `@@ -l,c +l,c @@` 形式，
 * 带 3 行上下文，可被 `git apply -p1` / `patch -p1` 读取。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const CONTEXT = 3;

/** 行级 LCS：返回 [oldIndex, newIndex] 配对（两侧索引都从 0 开始）。 */
function lcsPairs(a, b) {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i += 1) dp[i] = new Uint32Array(m + 1);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

/** 把两个文件的行数组变成 hunk 列表（不做上下文合并，调用方负责分组）。 */
function buildOps(oldLines, newLines) {
  const pairs = lcsPairs(oldLines, newLines);
  const ops = [];
  let i = 0;
  let j = 0;
  for (const [oi, nj] of pairs) {
    while (i < oi) { ops.push({ type: "del", oldIndex: i, text: oldLines[i] }); i += 1; }
    while (j < nj) { ops.push({ type: "add", newIndex: j, text: newLines[j] }); j += 1; }
    ops.push({ type: "ctx", oldIndex: i, newIndex: j, text: oldLines[i] });
    i = oi + 1;
    j = nj + 1;
  }
  while (i < oldLines.length) { ops.push({ type: "del", oldIndex: i, text: oldLines[i] }); i += 1; }
  while (j < newLines.length) { ops.push({ type: "add", newIndex: j, text: newLines[j] }); j += 1; }
  return ops;
}

/**
 * 把 ops 切成 hunk：相邻改动距离 ≤ 2*CONTEXT 时并入同一个 hunk，
 * 两端各留 CONTEXT 行上下文（与 git 的默认行为一致）。
 */
function toHunks(ops) {
  const changeIndices = [];
  ops.forEach((op, index) => { if (op.type !== "ctx") changeIndices.push(index); });
  if (changeIndices.length === 0) return [];

  const hunks = [];
  let start = changeIndices[0];
  let end = changeIndices[0];
  for (const index of changeIndices.slice(1)) {
    if (index - end <= CONTEXT * 2) {
      end = index;
      continue;
    }
    hunks.push([start, end]);
    start = index;
    end = index;
  }
  hunks.push([start, end]);

  return hunks.map(([first, last]) => {
    const from = Math.max(0, first - CONTEXT);
    const to = Math.min(ops.length - 1, last + CONTEXT);
    return ops.slice(from, to + 1);
  });
}

function splitLines(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  // 末尾换行会产生一个空尾巴，diff 里不该把它当作一行内容
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** 文件是否“末尾没有换行符”（空文件不算）。git 用 `\ No newline at end of file` 表达这件事。 */
function lacksEofNewline(text) {
  return text.length > 0 && !text.replace(/\r\n/g, "\n").endsWith("\n");
}

const NO_EOF_NEWLINE = "\\ No newline at end of file";

function hunkHeader(hunk, oldStart, newStart) {
  let oldCount = 0;
  let newCount = 0;
  for (const op of hunk) {
    if (op.type !== "add") oldCount += 1;
    if (op.type !== "del") newCount += 1;
  }
  const oldFrom = oldCount === 0 ? oldStart - 1 : oldStart;
  const newFrom = newCount === 0 ? newStart - 1 : newStart;
  // git 约定：行数为 1 时省略 `,1`（`@@ -1 +1,2 @@`）
  const range = (from, count) => (count === 1 ? `${from}` : `${from},${count}`);
  return `@@ -${range(oldFrom, oldCount)} +${range(newFrom, newCount)} @@`;
}

/** 生成单文件的 unified diff；内容相同返回空串。 */
export function unifiedDiff(oldText, newText, path) {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const oldLacksEof = lacksEofNewline(oldText);
  const newLacksEof = lacksEofNewline(newText);
  let ops = buildOps(oldLines, newLines);
  // 只有末尾换行符不同时，行内容全等 → 行级 diff 会把这种情况当成“没变”。
  // git 的做法是把末行写成“删了再加”，好把 `\ No newline` 标记挂上去。
  if (oldLacksEof !== newLacksEof && ops.length > 0 && ops[ops.length - 1].type === "ctx") {
    const last = ops[ops.length - 1];
    ops = [
      ...ops.slice(0, -1),
      { type: "del", oldIndex: last.oldIndex, text: last.text },
      { type: "add", newIndex: last.newIndex, text: last.text },
    ];
  }
  const hunks = toHunks(ops);
  if (hunks.length === 0) return "";

  const out = [`--- a/${path}`, `+++ b/${path}`];
  const oldLast = oldLines.length - 1;
  const newLast = newLines.length - 1;
  let oldCursor = 0;
  let newCursor = 0;
  for (const hunk of hunks) {
    // 游标推进到该 hunk 第一行之前
    while (oldCursor < hunk[0].oldIndex || (hunk[0].type === "add" && newCursor < hunk[0].newIndex)) {
      if (hunk[0].type === "add") break;
      if (oldCursor >= (hunk[0].oldIndex ?? Infinity)) break;
      oldCursor += 1;
      newCursor += 1;
    }
    const first = hunk[0];
    const oldStart = first.oldIndex !== undefined ? first.oldIndex + 1 : oldCursor + 1;
    const newStart = first.newIndex !== undefined ? first.newIndex + 1 : newCursor + 1;
    out.push(hunkHeader(hunk, oldStart, newStart));
    for (const op of hunk) {
      const marker = op.type === "ctx" ? " " : op.type === "add" ? "+" : "-";
      out.push(`${marker}${op.text}`);
      // 末行缺少换行符时，git 会紧跟一行 `\ No newline at end of file`。
      // 两侧**各自**带标记：这样即使改动离文件末尾很远（末行根本不在 hunk 里），
      // 应用方也能从「有没有标记」推出两侧的末尾状态。
      if (op.type !== "add" && op.oldIndex === oldLast && oldLacksEof) out.push(NO_EOF_NEWLINE);
      if (op.type !== "del" && op.newIndex === newLast && newLacksEof) out.push(NO_EOF_NEWLINE);
      if (op.oldIndex !== undefined) oldCursor = op.oldIndex + 1;
      if (op.newIndex !== undefined) newCursor = op.newIndex + 1;
    }
  }
  return `${out.join("\n")}\n`;
}

function parseArgs(argv) {
  const files = [];
  let out = null;
  let selftest = false;
  let apply = null;
  let check = false;
  let stripRoot = process.cwd();
  let current = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--selftest") { selftest = true; continue; }
    if (arg === "--check") { check = true; continue; }
    if (arg === "--apply") { apply = argv[++i]; continue; }
    if (arg === "--root") { stripRoot = argv[++i]; continue; }
    if (arg === "--out") { out = argv[++i]; continue; }
    if (arg === "--old") {
      current = { old: argv[++i], isNew: false };
      files.push(current);
      continue;
    }
    if (arg === "--new") {
      if (!current) throw new Error("--new must follow --old");
      current.new = argv[++i];
      continue;
    }
    if (arg === "--path") {
      if (!current) throw new Error("--path must follow --old");
      current.path = argv[++i];
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return { files, out, selftest, apply, check, stripRoot };
}

/**
 * 应用一份本工具生成的 unified diff，返回新内容。上下文/待删行不匹配时抛错
 * （宁可失败也不静默改错文件）。用于 `--apply` 回滚，也是自检里的往返验证。
 */
export function applyUnifiedDiff(oldText, diffText) {
  const oldLines = splitLines(oldText);
  const diffLines = diffText.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let cursor = 0;
  let index = 0;
  /**
   * 末尾换行状态：两侧各自由 `\ No newline at end of file` 标记告知。
   * 两侧都没有标记时（改动离末尾很远、末行不在任何 hunk 里）就继承旧文件 —— 
   * 那种情况下末行本来就没被改动，这是唯一正确的选择。
   */
  let sawOldMarker = false;
  let sawNewMarker = false;
  let lastMarker = " ";
  const noteMarker = () => {
    if (lastMarker === "-") sawOldMarker = true;
    else sawNewMarker = true;
  };
  const resultLacksEof = () => (sawNewMarker ? true : sawOldMarker ? false : lacksEofNewline(oldText));
  while (index < diffLines.length) {
    const line = diffLines[index];
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line === "") { index += 1; continue; }
    if (line.startsWith("\\")) {
      noteMarker();
      index += 1;
      continue;
    }
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!header) throw new Error(`unexpected line in patch: ${line}`);
    const oldStart = Number(header[1]);
    const target = oldStart === 0 ? 0 : oldStart - 1;
    // 拷贝 hunk 之前未改动的内容
    while (cursor < target) { out.push(oldLines[cursor]); cursor += 1; }
    index += 1;
    while (index < diffLines.length && !diffLines[index].startsWith("@@")) {
      const body = diffLines[index];
      if (body.startsWith("--- ") || body.startsWith("+++ ")) break;
      if (body.startsWith("\\")) {
        noteMarker();
        index += 1;
        continue;
      }
      const marker = body.slice(0, 1);
      const text = body.slice(1);
      if (marker === " ") {
        if (oldLines[cursor] !== text) {
          throw new Error(`context mismatch at line ${cursor + 1}: expected ${JSON.stringify(text)}, found ${JSON.stringify(oldLines[cursor])}`);
        }
        out.push(text);
        cursor += 1;
      } else if (marker === "-") {
        if (oldLines[cursor] !== text) {
          throw new Error(`removal mismatch at line ${cursor + 1}: expected ${JSON.stringify(text)}, found ${JSON.stringify(oldLines[cursor])}`);
        }
        cursor += 1;
      } else if (marker === "+") {
        out.push(text);
      } else if (body === "") {
        break;
      } else {
        throw new Error(`unexpected hunk line marker: ${JSON.stringify(body.slice(0, 1))}`);
      }
      lastMarker = marker;
      index += 1;
    }
  }
  while (cursor < oldLines.length) { out.push(oldLines[cursor]); cursor += 1; }
  if (out.length === 0) return "";
  // 没有 `\ No newline` 标记时继承旧文件；有标记时标记优先。
  return resultLacksEof() ? out.join("\n") : `${out.join("\n")}\n`;
}

/** 把补丁文本按文件拆开：返回 [{ path, diff }]，path 取 `--- a/<path>` 里的值。 */
export function splitPatchByFile(diffText) {
  const lines = diffText.replace(/\r\n/g, "\n").split("\n");
  const chunks = [];
  let current = null;
  for (const line of lines) {
    const header = /^--- a\/(.+)$/.exec(line);
    if (header) {
      current = { path: header[1], lines: [line] };
      chunks.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return chunks.map((chunk) => ({ path: chunk.path, diff: `${chunk.lines.join("\n")}\n` }));
}

function selfTest() {
  const cases = [
    {
      name: "identical files produce no diff",
      old: "a\nb\n", new: "a\nb\n", path: "x.ts", expect: "",
    },
    {
      name: "single changed line",
      old: "a\nb\nc\n", new: "a\nB\nc\n", path: "x.ts",
      expect: "--- a/x.ts\n+++ b/x.ts\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n",
    },
    {
      name: "added line at the end",
      old: "a\n", new: "a\nb\n", path: "x.ts",
      expect: "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1,2 @@\n a\n+b\n",
    },
    {
      name: "removed line",
      old: "a\nb\nc\n", new: "a\nc\n", path: "x.ts",
      expect: "--- a/x.ts\n+++ b/x.ts\n@@ -1,3 +1,2 @@\n a\n-b\n c\n",
    },
    {
      name: "CRLF input is normalized",
      old: "a\r\nb\r\n", new: "a\r\nB\r\n", path: "x.ts",
      expect: "--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n",
    },
  ];
  let failed = 0;
  for (const testCase of cases) {
    const actual = unifiedDiff(testCase.old, testCase.new, testCase.path);
    if (actual !== testCase.expect) {
      failed += 1;
      console.error(`FAIL ${testCase.name}\n--- expected ---\n${testCase.expect}--- actual ---\n${actual}`);
    } else {
      console.log(`ok   ${testCase.name}`);
    }
  }

  // 上下文合并：两处改动相距 ≤6 行时应落进同一个 hunk
  const merged = unifiedDiff("1\n2\n3\n4\n5\n6\n7\n8\n", "1\nX\n3\n4\n5\n6\n7\nY\n", "x.ts");
  const hunkCount = (merged.match(/^@@/gm) ?? []).length;
  if (hunkCount !== 1) {
    failed += 1;
    console.error(`FAIL nearby changes merge into one hunk (got ${hunkCount})\n${merged}`);
  } else {
    console.log("ok   nearby changes merge into one hunk");
  }

  // 远处改动应分成两个 hunk
  const far = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n16\n";
  const farNew = "X\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\nY\n";
  const farHunks = (unifiedDiff(far, farNew, "x.ts").match(/^@@/gm) ?? []).length;
  if (farHunks !== 2) {
    failed += 1;
    console.error(`FAIL distant changes split into two hunks (got ${farHunks})`);
  } else {
    console.log("ok   distant changes split into two hunks");
  }

  // 往返：生成补丁再应用回去，必须逐字节等于新文件（含“末尾没有换行符”的文件）
  const roundTrip = [
    { old: "a\nb\nc\n", new: "a\nB\nc\n", path: "x.ts" },
    { old: "a\n", new: "a\nb\n", path: "x.ts" },
    { old: "a\nb\nc\n", new: "a\nc\n", path: "x.ts" },
    { old: "1\n2\n3\n4\n5\n6\n7\n8\n", new: "X\n2\n3\n4\n5\n6\n7\n8\n9\n", path: "x.ts" },
    { old: "only\n", new: "only\n", path: "x.ts" },
    { old: "a\nb\nc", new: "a\nB\nc", path: "x.ts" },
    { old: "a\nb\nc\n", new: "a\nb\nc", path: "x.ts" },
    { old: "a\nb\nc", new: "a\nb\nc\n", path: "x.ts" },
  ];
  for (const case_ of roundTrip) {
    const diff = unifiedDiff(case_.old, case_.new, case_.path);
    const applied = applyUnifiedDiff(case_.old, diff);
    if (applied !== case_.new) {
      failed += 1;
      console.error(`FAIL round trip ${JSON.stringify(case_.old)} -> ${JSON.stringify(case_.new)}\n${diff}\ngot ${JSON.stringify(applied)}`);
    }
  }
  if (failed === 0) console.log("ok   generated patches apply back to the new file (round trip)");

  if (failed > 0) {
    console.error(`\n${failed} selftest case(s) failed`);
    process.exit(1);
  }
  console.log("\nall selftest cases passed");
}

function main() {
  const { files, out, selftest, apply, check, stripRoot } = parseArgs(process.argv.slice(2));
  if (selftest) { selfTest(); return; }

  if (apply) {
    const chunks = splitPatchByFile(readFileSync(apply, "utf8"));
    if (chunks.length === 0) {
      console.error(`no file hunks found in ${apply}`);
      process.exit(1);
    }
    for (const chunk of chunks) {
      const target = join(stripRoot, chunk.path);
      // 新增文件：目标不存在时按空文件处理（补丁会把内容全部加进去）
      let before = "";
      try {
        before = readFileSync(target, "utf8");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      const after = applyUnifiedDiff(before, chunk.diff);
      if (check) {
        console.log(`${before === after ? "unchanged" : "would patch"}  ${chunk.path}`);
        continue;
      }
      writeFileSync(target, after, "utf8");
      console.log(`patched  ${chunk.path}`);
    }
    if (check) console.log("\n(--check: nothing was written)");
    return;
  }

  if (files.length === 0) {
    console.error("usage: node scripts/fork-patch.mjs --old <file> --new <file> --path <repo/relative/path> [--out <patch>] [--selftest]");
    process.exit(2);
  }

  const chunks = [];
  for (const file of files) {
    if (!file.old || !file.new || !file.path) {
      throw new Error("each entry needs --old, --new and --path");
    }
    const diff = unifiedDiff(readFileSync(file.old, "utf8"), readFileSync(file.new, "utf8"), file.path);
    if (diff) chunks.push(diff);
    else console.error(`(no changes) ${file.path}`);
  }

  const text = chunks.join("");
  if (out) {
    writeFileSync(out, text, "utf8");
    const files2 = text.split("\n").filter((line) => line.startsWith("--- a/")).length;
    console.error(`wrote ${out} (${files2} file(s), ${text.split("\n").length - 1} lines) from ${basename(process.argv[1])}`);
  } else {
    process.stdout.write(text);
  }
}

// 只有直接执行时才跑 CLI（被 import 时应纯暴露 unifiedDiff）
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  main();
}
