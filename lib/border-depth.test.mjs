import assert from "node:assert/strict";
import test from "node:test";

const {
  clampBorderDepth,
  stepDepth,
  parseStoredBorderDepth,
  borderDepthValue,
  borderDepthNeedsOverride,
  BORDER_DEPTH_DEFAULT,
  BORDER_STEP_OFFSETS,
} = await import("./border-depth.ts");

test("clampBorderDepth rounds and clamps to 0-100", () => {
  assert.equal(clampBorderDepth(0), 0);
  assert.equal(clampBorderDepth(100), 100);
  assert.equal(clampBorderDepth(-40), 0);
  assert.equal(clampBorderDepth(240), 100);
  assert.equal(clampBorderDepth(49.6), 50);
  assert.equal(clampBorderDepth("33"), 33);
  // Garbage must never become NaN (which would make the slider inert).
  assert.equal(clampBorderDepth("abc"), BORDER_DEPTH_DEFAULT);
  assert.equal(clampBorderDepth(undefined), BORDER_DEPTH_DEFAULT);
  assert.equal(clampBorderDepth(NaN), BORDER_DEPTH_DEFAULT);
});

test("parseStoredBorderDepth tolerates missing and malformed storage", () => {
  assert.equal(parseStoredBorderDepth(null), BORDER_DEPTH_DEFAULT);
  assert.equal(parseStoredBorderDepth(""), BORDER_DEPTH_DEFAULT);
  assert.equal(parseStoredBorderDepth("nope"), BORDER_DEPTH_DEFAULT);
  assert.equal(parseStoredBorderDepth("0"), 0);
  assert.equal(parseStoredBorderDepth("100"), 100);
  assert.equal(parseStoredBorderDepth("9000"), 100);
});

test("stepDepth keeps the three-step ladder ordered at every depth", () => {
  const mid = 50;
  const strong = stepDepth(mid, "--border-strong");
  const normal = stepDepth(mid, "--border");
  const faint = stepDepth(mid, "--border-faint");
  assert.ok(strong > normal, "strong is firmer than the default line");
  assert.ok(normal > faint, "default is firmer than faint");

  // The offsets must not push any step out of range.
  assert.equal(stepDepth(100, "--border-strong"), 100);
  assert.equal(stepDepth(0, "--border-faint"), 0);
  assert.equal(stepDepth(100, "--border"), 100);
});

test("borderDepthValue is the identity at depth 50 (no color-mix cost)", () => {
  assert.equal(borderDepthValue("--border-orig", 50), "var(--border-orig)");
});

test("borderDepthValue fades the border's own alpha below 50", () => {
  // Blending toward --bg here would RAISE the alpha (the Codex hairlines are
  // translucent and --bg is opaque), producing a firmer line as the user slid
  // toward "invisible". The fade must target `transparent`.
  assert.equal(borderDepthValue("--border-orig", 0), "transparent");
  const quarter = borderDepthValue("--border-orig", 25);
  assert.ok(quarter.includes("transparent"), quarter);
  assert.ok(!quarter.includes("var(--bg)"), quarter);
  assert.ok(!quarter.includes("var(--text)"), quarter);
});

test("borderDepthValue blends toward the text colour above 50", () => {
  assert.equal(borderDepthValue("--border-orig", 100), "var(--text)");
  const threeQuarter = borderDepthValue("--border-orig", 75);
  assert.ok(threeQuarter.includes("var(--text)"));
  assert.ok(!threeQuarter.includes("transparent"));
});

test("borderDepthValue is monotonic and visible away from the midpoint", () => {
  // The useful range must not sit entirely at the two ends: a gamma below 1
  // keeps a move in the middle of the track perceptible.
  const percentAt = (depth) => {
    const value = borderDepthValue("--border-orig", depth) ?? "";
    const match = /(\d+)%/.exec(value);
    return match ? Number(match[1]) : (depth === 0 ? 0 : 100);
  };
  assert.ok(percentAt(25) > 25, `expected a sub-midpoint boost, got ${percentAt(25)}%`);
  for (let depth = 0; depth < 50; depth += 5) {
    assert.ok(percentAt(depth) <= percentAt(depth + 5), `not monotonic at ${depth}`);
  }
});

test("borderDepthNeedsOverride is false exactly when every step is a pass-through", () => {
  // Only the default offset is 0, so 50 still overrides strong and faint.
  assert.equal(borderDepthNeedsOverride(50), true);
  assert.equal(borderDepthNeedsOverride(0), true);
  assert.equal(borderDepthNeedsOverride(100), true);
  // A depth where all three offsets land on 50 would need no override; the
  // ladder offsets make that impossible by construction, which is asserted here
  // so a future offset edit cannot silently break the fast path.
  const allAtFifty = Object.values(BORDER_STEP_OFFSETS).every((offset) => offset === 0);
  assert.equal(allAtFifty, false);
});
