import assert from "node:assert/strict";
import test from "node:test";
import { browserTabLabel, newBrowserTab, normalizeBrowserUrl, restoreBrowserTabs } from "./browser-tab-state.ts";

test("bare hosts get a scheme; loopback stays on http", () => {
  assert.equal(normalizeBrowserUrl("example.com"), "https://example.com");
  assert.equal(normalizeBrowserUrl("  example.com/app?x=1  "), "https://example.com/app?x=1");
  assert.equal(normalizeBrowserUrl("localhost:5001"), "http://localhost:5001");
  assert.equal(normalizeBrowserUrl("127.0.0.1:3000/docs"), "http://127.0.0.1:3000/docs");
  assert.equal(normalizeBrowserUrl("http://localhost:8080"), "http://localhost:8080");
  assert.equal(normalizeBrowserUrl("https://pideck.caoayu.top/"), "https://pideck.caoayu.top/");
  assert.equal(normalizeBrowserUrl("   "), "");
});

test("tab labels show the host, with the port when there is one", () => {
  assert.equal(browserTabLabel("http://localhost:5001/x"), "localhost:5001");
  assert.equal(browserTabLabel("https://example.com/a/b"), "example.com");
  assert.equal(browserTabLabel(""), "");
  assert.equal(browserTabLabel("not a url"), "not a url");
});

test("a new tab normalizes its url and carries a 32-char id", () => {
  const tab = newBrowserTab("localhost:5001");
  assert.match(tab.id, /^[a-f0-9]{32}$/);
  assert.equal(tab.url, "http://localhost:5001");
  assert.equal(newBrowserTab().url, "");
});

test("restore keeps well-formed tabs only and requires a matching active id", () => {
  const id = "a".repeat(32);
  const other = "b".repeat(32);
  const restored = restoreBrowserTabs(JSON.stringify({
    tabs: [{ id, url: "http://localhost:5001" }, { id: "short", url: "http://x" }, { id: other }],
    activeId: id,
    open: true,
  }));
  assert.deepEqual(restored.tabs.map((tab) => tab.id), [id, other]);
  assert.equal(restored.activeId, id);
  assert.equal(restored.open, true);

  const miss = restoreBrowserTabs(JSON.stringify({ tabs: [{ id, url: "" }], activeId: other, open: false }));
  assert.equal(miss.activeId, null);
  assert.equal(miss.open, false);
  assert.deepEqual(restoreBrowserTabs("not json"), { tabs: [], activeId: null, open: false });
  assert.deepEqual(restoreBrowserTabs(null), { tabs: [], activeId: null, open: false });
});
