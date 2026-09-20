#!/usr/bin/env node
/**
 * 动效时长门禁（PR-21）
 *
 * 规则：`transition` 的时长必须走 `--motion-*` token，不许写裸值。
 *
 * 为什么需要这条：改 `app/*.css` 时最容易顺手写 `transition: opacity .15s`，
 * 一次两次看不出问题，积累起来就是「十个地方十个时长」——PR-21 之前实测
 * transition 里混用了 90ms / .12s / .14s / .15s / .16s / .18s / .2s 七种值。
 *
 * 例外：`animation` 的时长不管（入场/循环动画本来就有各自的节奏，
 * 比如 shimmer 1.4s、壁纸淡入 0.4s），本脚本只看 `transition:` 行。
 *
 * 用法：node docs/codex-skin/audit-motion.mjs
 * 退出码：0 = 干净；1 = 有裸时长
 */

import { readFileSync } from "node:fs";

const FILES = ["app/globals.css", "app/fork-ui.css", "app/settings.css", "app/wallpaper.css"];

/** `120ms` / `0.15s` / `.2s` —— 不含 `var(...)` 的情形。 */
const BARE_DURATION = /(?:^|[\s,(])(\d*\.?\d+)(ms|s)(?=[\s,;)]|$)/g;

/**
 * 刻意的例外（不是漏改），值本身就是要那个数：
 *   - `0.01ms`：reduced-motion 的标准做法——把过渡压到不可感知，
 *     不能用 `--motion-*`（那是正常态的时长）。
 *   - `0.4s`：壁纸淡入。壁纸是大面积图像，快速淡入反而显稿；
 *     这个值跟着壁纸模块走，不入全局阶梯。
 */
const ALLOWED_VALUES = new Set(["0.01ms", "0.4s"]);

let bad = 0;
for (const file of FILES) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  text.split("\n").forEach((line, index) => {
    const isTransition = /\btransition(-property|-duration)?\s*:/.test(line);
    if (!isTransition) return;
    // transition 里出现 var(--motion-*) 是合规的；裸时长才报。
    const hits = [];
    for (const match of line.matchAll(BARE_DURATION)) {
      const value = match[0].trim();
      if (ALLOWED_VALUES.has(value)) continue;
      hits.push(value);
    }
    if (hits.length > 0) {
      console.log(`${file}:${index + 1}  裸时长 ${hits.join(", ")}`);
      console.log(`    ${line.trim()}`);
      bad += 1;
    }
  });
}

if (bad > 0) {
  console.log(`\n${bad} 处 transition 写了裸时长 —— 改成 var(--motion-instant|fast|base|slow)。`);
  process.exit(1);
}
console.log("OK  transition 时长全部走 --motion-* token");
