import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { enteredClass } = await jiti.import("@/hooks/useTwoPhaseEnter");

/*
 * The modifier must be appended to the *complete* base class. Both failure modes
 * below shipped in the reference implementation (MusePi docs/gui-design.md
 * §"两段式统一"): dropping the base class puts the layer back in document flow,
 * and an orphan `--entered` token matches no selector, leaving the layer at
 * `opacity: 0` forever.
 */
test("enteredClass keeps the base class and appends the modifier", () => {
  assert.equal(enteredClass("context-menu", true), "context-menu context-menu--entered");
  assert.equal(enteredClass("context-menu", false), "context-menu");
});

test("enteredClass never emits a bare modifier", () => {
  const entered = enteredClass("gui-foo", true);
  const tokens = entered.split(" ");
  assert.equal(tokens.length, 2);
  assert.equal(tokens[0], "gui-foo");
  assert.equal(tokens[1], "gui-foo--entered");
  assert.ok(entered.includes(" "), "space-separated, not concatenated");
});
