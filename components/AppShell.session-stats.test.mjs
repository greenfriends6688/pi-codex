import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const stats = source.slice(source.indexOf("const renderSessionStatsButton"));

test("reports the session message count alongside tokens and context", () => {
  assert.match(stats, /const totalMessages = sessionStats\?\.totalMessages \?\? 0;/);
  // The skin keeps the whole stats row always visible and dims the zero state
  // instead of hiding the readout, so an empty session still shows the slot.
  assert.match(stats, /color: messageCountColor, opacity: totalMessages \? 1 : 0\.45/);
  assert.match(stats, /\{formatCompact\(totalMessages\)\}/);
  assert.match(stats, /if \(totalMessages > 0\) tooltipParts\.push\(`messages: \$\{totalMessages\.toLocaleString\(locale\)\}`\)/);
});

test("warns before a session grows large enough to slow switching", () => {
  // Skin tokenisation: the upstream literals are replaced by semantic tokens.
  assert.match(stats, /totalMessages > 5000\s*\?\s*"var\(--danger\)"/);
  assert.match(stats, /totalMessages > 2000\s*\?\s*"var\(--warning\)"/);
  // Same thresholds and colours the context gauge already uses.
  assert.match(stats, /percent > 90\) contextColor = "var\(--danger\)"/);
  assert.match(stats, /percent > 70\) contextColor = "var\(--warning\)"/);
});
