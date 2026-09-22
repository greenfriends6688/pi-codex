import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/*
 * fork:zm-05 — the sliding active-tab pill.
 *
 * TabBar's "…" fold is driven by measured widths (`lib/tab-overflow.ts` reads the
 * per-tab `offsetWidth`s against the container's `clientWidth`). The pill must
 * therefore stay out of flow forever; these are source-level guards because the
 * regression they prevent would silently change which tabs are folded.
 */

const source = await readFile(new URL("./TabBar.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/fork-ui.css", import.meta.url), "utf8");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] ?? "";
}

test("the pill is absolutely positioned and cannot influence tab measurements", () => {
  const pill = rule(".fork-tab-pill");
  assert.match(pill, /position:\s*absolute/, "out of flow, so offsetWidth/clientWidth ignore it");
  assert.match(pill, /pointer-events:\s*none/, "and it must not eat clicks aimed at the tabs");
  assert.match(rule(".fork-tabbar"), /position:\s*relative/, "offsetLeft is measured against the bar");
  assert.match(rule(".fork-tab"), /z-index:\s*1/, "tabs paint above the pill");
  // The overflow logic still measures the real tab elements.
  assert.match(source, /element\.offsetWidth/);
});

test("the pill is mounted once, before the tabs, with a class hook", () => {
  const pillIndex = source.indexOf('className="fork-tab-pill"');
  const mapIndex = source.indexOf("{tabs.map(");
  assert.ok(pillIndex > 0, "TabBar renders the pill");
  assert.ok(mapIndex > pillIndex, "the pill is the first child, ahead of every tab");
  assert.match(source, /aria-hidden="true"[\s\S]{0,160}fork-tab-pill/);
});

test("the pill starts transparent until the first measurement", () => {
  assert.match(source, /ready:\s*false/);
  assert.match(source, /opacity:\s*pillState\.ready/);
});

test("both the pill transition and the press feedback have a reduced-motion branch", () => {
  assert.match(css, /--fork-tab-pill-duration:\s*200ms/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?\.fork-tab-pill\s*\{[\s\S]*?transition:/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?\.fork-tab:active[\s\S]*?scale\(0\.985\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.fork-tab-pill[\s\S]*?transition:\s*none\s*!important/);
});

test("the pill follows keyboard navigation by id, not by DOM position", () => {
  assert.match(source, /pendingTabFocusRef\.current = nextId/);
  assert.match(source, /tabElementsRef\.current\.get\(pendingFocusId\)\?\.focus\(\)/);
  assert.doesNotMatch(source, /children\[next\]\s*as\s+HTMLElement/, "the pill would shift a positional lookup");
});
