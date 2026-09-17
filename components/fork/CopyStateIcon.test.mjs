import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { CopyStateIcon } = await jiti.import("./CopyStateIcon.tsx");

/*
 * Both glyphs stay mounted so the CSS cross-fade (app/fork-ui.css
 * `fork-copy-glyph`) has something to interpolate and the button width never
 * changes. The state lives in one data attribute — that pair is the contract
 * the CSS selector depends on, so it is what the test pins.
 */
test("both glyphs are mounted and the state rides one data attribute", () => {
  const idle = renderToStaticMarkup(React.createElement(CopyStateIcon, { copied: false }));
  assert.match(idle, /data-copied="false"/);
  assert.match(idle, /fork-copy-glyph__idle/);
  assert.match(idle, /fork-copy-glyph__done/);
  assert.equal((idle.match(/<svg/g) ?? []).length, 2, "copy and check glyphs are both present");
});

test("copied flips the attribute without unmounting a glyph", () => {
  const done = renderToStaticMarkup(React.createElement(CopyStateIcon, { copied: true }));
  assert.match(done, /data-copied="true"/);
  assert.equal((done.match(/<svg/g) ?? []).length, 2);
  // The wrapper itself is decoration; screen readers get the button label.
  assert.match(done, /aria-hidden="true"/);
});
