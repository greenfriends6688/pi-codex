import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  BOTTOM_ANCHOR_EPSILON_PX,
  captureScrollAnchor,
  computeScrollMaskState,
  distanceToBottom,
  initialFollowing,
  isAtBottom,
  keyboardScrollIntent,
  nextFollowingAfterIntent,
  prependHeightDelta,
  resolveFollowingAfterScroll,
  resolvePrependRestoreScrollTop,
  scrollMaskImage,
  shouldAllowProgrammaticScroll,
  shouldTriggerLoadOlder,
  touchScrollIntent,
  wheelScrollIntent,
} = await jiti.import("./scroll-follow.ts");

const metrics = (scrollTop, viewportHeight = 600, contentHeight = 2000) => ({
  scrollTop,
  viewportHeight,
  contentHeight,
});

test("distance to bottom never goes negative", () => {
  assert.equal(distanceToBottom(metrics(1400)), 0);
  assert.equal(distanceToBottom(metrics(1200)), 200);
  assert.equal(distanceToBottom(metrics(0, 800, 500)), 0);
});

test("48px epsilon is the at-bottom rule", () => {
  assert.equal(isAtBottom(metrics(1400)), true);
  assert.equal(isAtBottom(metrics(1352)), true);
  assert.equal(isAtBottom(metrics(1351)), false);
  assert.equal(isAtBottom(metrics(1351), 49), true);
  assert.equal(BOTTOM_ANCHOR_EPSILON_PX, 48);
});

test("programmatic scrolls never flip following, even x100", () => {
  let following = false;
  for (let i = 0; i < 100; i += 1) {
    // 流式贴底 / resize / prepend 都是程序化来源：落点在哪都不改变用户意图。
    following = resolveFollowingAfterScroll({ following, metrics: metrics(1400), source: "programmatic" });
    assert.equal(following, false);
    following = resolveFollowingAfterScroll({ following, metrics: metrics(0), source: "layout" });
    assert.equal(following, false);
  }
  // 反方向同理：跟随中不会被程序化滚动解除。
  following = true;
  for (let i = 0; i < 100; i += 1) {
    following = resolveFollowingAfterScroll({ following, metrics: metrics(0), source: "programmatic" });
    assert.equal(following, true);
  }
});

test("user scroll decides by final landing position", () => {
  assert.equal(resolveFollowingAfterScroll({ following: true, metrics: metrics(1200), source: "user" }), false);
  assert.equal(resolveFollowingAfterScroll({ following: false, metrics: metrics(1400), source: "user" }), true);
  assert.equal(resolveFollowingAfterScroll({ following: false, metrics: metrics(1352), source: "user" }), true);
});

test("an up-scroll intent detaches immediately, even inside the epsilon", () => {
  assert.equal(
    nextFollowingAfterIntent({ following: true, intent: "awayFromBottom", metrics: metrics(1370) }),
    false,
  );
  // 下滑只有真正接近底部才恢复跟随。
  assert.equal(nextFollowingAfterIntent({ following: false, intent: "towardBottom", metrics: metrics(1000) }), false);
  assert.equal(nextFollowingAfterIntent({ following: false, intent: "towardBottom", metrics: metrics(1400) }), true);
  assert.equal(nextFollowingAfterIntent({ following: false, intent: "none", metrics: metrics(1400) }), false);
});

test("wheel / touch / keyboard intents agree on direction", () => {
  assert.equal(wheelScrollIntent(-1), "awayFromBottom");
  assert.equal(wheelScrollIntent(1), "towardBottom");
  assert.equal(wheelScrollIntent(0), "none");

  assert.equal(touchScrollIntent(100, 130), "awayFromBottom");
  assert.equal(touchScrollIntent(130, 100), "towardBottom");
  assert.equal(touchScrollIntent(100, 100), "none");

  assert.equal(keyboardScrollIntent({ key: "PageUp", shiftKey: false, editableTarget: false }), "awayFromBottom");
  assert.equal(keyboardScrollIntent({ key: "ArrowDown", shiftKey: false, editableTarget: false }), "towardBottom");
  assert.equal(keyboardScrollIntent({ key: " ", shiftKey: true, editableTarget: false }), "awayFromBottom");
  assert.equal(keyboardScrollIntent({ key: " ", shiftKey: false, editableTarget: false }), "towardBottom");
  assert.equal(keyboardScrollIntent({ key: "ArrowUp", shiftKey: false, editableTarget: true }), "none");
  assert.equal(keyboardScrollIntent({ key: "a", shiftKey: false, editableTarget: false }), "none");
});

test("a programmatic jump to the tail is vetoed only while detached", () => {
  const tail = { requestedTop: 2000, contentHeight: 2000 };
  assert.equal(shouldAllowProgrammaticScroll({ ...tail, following: true }), true);
  assert.equal(shouldAllowProgrammaticScroll({ ...tail, following: false }), false);

  // 跳到某条消息（显式导航）永远放行，哪怕落到最大滚动位置。
  assert.equal(shouldAllowProgrammaticScroll({ requestedTop: 1400, contentHeight: 2000, following: false }), true);
  assert.equal(shouldAllowProgrammaticScroll({ requestedTop: 600, contentHeight: 2000, following: false }), true);
  // 非有限值不拦（防御）。
  assert.equal(shouldAllowProgrammaticScroll({ requestedTop: Number.NaN, contentHeight: 2000, following: false }), true);
});

test("masks hide at both ends and follow the scroll position", () => {
  // 内容不足一屏：两端都没有藏着的内容。
  assert.equal(computeScrollMaskState({ scrollTop: 0, viewportHeight: 600, contentHeight: 600 }), "none");
  assert.equal(computeScrollMaskState({ scrollTop: 0, viewportHeight: 600, contentHeight: 500 }), "none");
  // 两端都到底（0 距离可滚）同样隐藏。
  assert.equal(
    computeScrollMaskState({ scrollTop: 0, viewportHeight: 300, contentHeight: 300.5 }),
    "none",
  );
  // 在顶：只淡出底部。
  assert.equal(computeScrollMaskState({ scrollTop: 0, viewportHeight: 600, contentHeight: 2000 }), "bottom");
  // 在底：只淡出顶部。
  assert.equal(computeScrollMaskState({ scrollTop: 1400, viewportHeight: 600, contentHeight: 2000 }), "top");
  // 中间：两端都淡出。
  assert.equal(computeScrollMaskState({ scrollTop: 700, viewportHeight: 600, contentHeight: 2000 }), "both");
});

test("mask gradients exist only for the visible ends", () => {
  assert.equal(scrollMaskImage("none"), undefined);
  assert.match(scrollMaskImage("top"), /^linear-gradient\(to bottom, transparent 0, black 24px, black 100%\)$/);
  assert.match(scrollMaskImage("bottom"), /calc\(100% - 24px\)/);
  assert.match(scrollMaskImage("both"), /transparent 0, black 24px, black calc\(100% - 24px\), transparent 100%/);
  assert.match(scrollMaskImage("top", 40), /black 40px/);
});

test("prepending keeps the anchor pixel-stable using offsetTop", () => {
  // 前插前：锚点消息 offsetTop = 1200，scrollTop = 1100 → 视口偏移 100。
  const anchor = captureScrollAnchor({ entryId: "e1", elementViewportTop: 100, viewportTop: 0 });
  assert.deepEqual(anchor, { entryId: "e1", viewportOffsetPx: 100 });

  // 前插 200px 后：同一个元素的 offsetTop 变成 1400，scrollTop 还是 1100。
  const restored = resolvePrependRestoreScrollTop(anchor, {
    elementViewportTop: 300,
    viewportTop: 0,
    scrollTop: 1100,
  });
  assert.equal(restored, 1300);
  // 像素不动：offsetTop - scrollTop 仍等于采样时的视口偏移。
  assert.equal(1400 - restored, 100);

  // 中间被别的恢复逻辑先改过 scrollTop 时，绝对目标 - 实时值，不会重复计入。
  const again = resolvePrependRestoreScrollTop(anchor, {
    elementViewportTop: 200,   // 已经被别的补偿改了位置
    viewportTop: 0,
    scrollTop: 1200,
  });
  assert.equal(again, 1300);
});

test("prepend restore clamps at the top and is inert on bad input", () => {
  const anchor = { entryId: "e1", viewportOffsetPx: 100 };
  assert.equal(resolvePrependRestoreScrollTop(anchor, { elementViewportTop: 10, viewportTop: 0, scrollTop: 50 }), 0);
  assert.equal(resolvePrependRestoreScrollTop(anchor, { elementViewportTop: Number.NaN, viewportTop: 0, scrollTop: 50 }), null);
  assert.equal(resolvePrependRestoreScrollTop(anchor, { elementViewportTop: 10, viewportTop: 0, scrollTop: Number.NaN }), null);
});

test("height delta only counts real growth", () => {
  assert.equal(prependHeightDelta(1000, 1200), 200);
  assert.equal(prependHeightDelta(1000, 1000), 0);
  assert.equal(prependHeightDelta(1000, 900), 0);
  assert.equal(prependHeightDelta(Number.NaN, 900), 0);
});

test("load-older triggers only at the top and only once", () => {
  assert.equal(shouldTriggerLoadOlder({ scrollTop: 10, canLoadOlder: true, loadingOlder: false }), true);
  assert.equal(shouldTriggerLoadOlder({ scrollTop: 64, canLoadOlder: true, loadingOlder: false }), true);
  assert.equal(shouldTriggerLoadOlder({ scrollTop: 65, canLoadOlder: true, loadingOlder: false }), false);
  assert.equal(shouldTriggerLoadOlder({ scrollTop: 0, canLoadOlder: false, loadingOlder: false }), false);
  assert.equal(shouldTriggerLoadOlder({ scrollTop: 0, canLoadOlder: true, loadingOlder: true }), false);
  assert.equal(shouldTriggerLoadOlder({ scrollTop: 100, canLoadOlder: true, loadingOlder: false, triggerPx: 120 }), true);
});

test("a fresh session starts following", () => {
  assert.equal(initialFollowing(), true);
});
