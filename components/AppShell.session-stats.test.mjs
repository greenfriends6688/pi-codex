import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:ui-stats-inline — 统计从「AppShell 顶栏按钮 + 悬浮面板」搬到 composer
// 下方的状态条右端，所以这些结构断言跟着统计组件走（SessionStatsBar.tsx）。
const stats = await readFile(new URL("./SessionStatsBar.tsx", import.meta.url), "utf8");
const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const appShell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("reports the session message count alongside tokens and context", () => {
  assert.match(stats, /const totalMessages = sessionStats\?\.totalMessages \?\? 0;/);
  // The skin keeps the whole stats row always visible and dims the zero state
  // instead of hiding the readout, so an empty session still shows the slot.
  assert.match(stats, /color: messageCountColor, opacity: totalMessages \? 1 : 0\.45/);
  assert.match(stats, /\{formatCompactTokens\(totalMessages\)\}/);
  assert.match(stats, /formatCompactTokens\(tokens\?\.input \?\? 0\)/);
  assert.match(stats, /formatCompactTokens\(tokens\?\.output \?\? 0\)/);
  assert.match(stats, /formatCompactTokens\(tokens\?\.cacheRead \?\? 0\)/);
});

test("warns before a session grows large enough to slow switching", () => {
  // Skin tokenisation: the upstream literals are replaced by semantic tokens.
  assert.match(stats, /totalMessages > 5000\s*\?\s*"var\(--danger\)"/);
  assert.match(stats, /totalMessages > 2000\s*\?\s*"var\(--warning\)"/);
  // Same thresholds and colours the context gauge already uses.
  assert.match(stats, /percent > 90\) return "var\(--danger\)"/);
  assert.match(stats, /percent > 70\) return "var\(--warning\)"/);
});

test("expands the token detail in place instead of a top-bar popover", () => {
  assert.match(stats, /t\("session\.input"\)/);
  assert.match(stats, /t\("session\.output"\)/);
  assert.match(stats, /t\("session\.cacheRead"\)/);
  assert.match(stats, /t\("session\.total"\)/);
  assert.match(stats, /t\("session\.cost"\)/);
  assert.match(stats, /t\("session\.context"\)/);
  assert.match(stats, /t\("session\.cacheHitRate"\)/);
  // 面板挂在 composer 下方的扩展状态条右端，展开状态由 ChatWindow 持有。
  assert.match(chatWindow, /trailing=\{\(\s*<SessionStatsBar/);
  assert.match(chatWindow, /const \[statsExpanded, setStatsExpanded\] = useState\(false\)/);
  // 顶栏那条老路径必须彻底消失，否则会同时出现两个入口。
  assert.doesNotMatch(appShell, /renderSessionStatsButton/);
  assert.doesNotMatch(appShell, /session-info-popover/);
  assert.doesNotMatch(appShell, /activeTopPanel === "session"/);
});
