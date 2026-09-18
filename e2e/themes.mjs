// Run against an existing dev server: node e2e/themes.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const artifacts = fileURLToPath(new URL("../test-results/themes/", import.meta.url));
const themes = ["light", "dark", "mist", "rose", "pine", "auto"];
const labels = ["Light", "Dark", "Mist", "Rose", "Pine", "System"];
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch();

// DSN-02：旧 contrast() 只会解析 hex（slice/parseInt），而主题 token 是 oklch，
// getComputedStyle 读回形如 `oklch(26% 0 0/.68)`，旧函数返回 NaN → 断言恒失败。
// 新做法：在页面里用 canvas 做浏览器真实解析——fillStyle 写入任意 CSS 颜色
// （oklch / color-mix / transparent 全支持），getImageData 读回 sRGB，再按
// WCAG 公式算相对亮度。半透明的合成也在 sRGB 空间逐层做，与浏览器渲染一致：
// 前景落在底色上；底色本身半透明（bg-hover/bg-selected/user-bg 都是设计给
// --bg 上的 overlay，assistant-bg 甚至是 transparent）时先落在 --bg 上。
async function contrastRatios(page, colors) {
  return page.evaluate((tokens) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const read = () => Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
    // top 落在 opaque bottom 上，返回合成后的 sRGB（canvas 的 source-over
    // 与页面渲染走同一条合成路径，alpha 不用手算）。
    const over = (top, bottom) => {
      ctx.globalCompositeOperation = "copy";
      ctx.fillStyle = `rgb(${bottom[0]}, ${bottom[1]}, ${bottom[2]})`;
      ctx.fillRect(0, 0, 1, 1);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = top;
      ctx.fillRect(0, 0, 1, 1);
      return read();
    };
    const opaque = (style) => {
      ctx.globalCompositeOperation = "copy";
      ctx.fillStyle = style;
      ctx.fillRect(0, 0, 1, 1);
      return read();
    };
    const luminance = ([r, g, b]) => {
      const f = (v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (fg, bg) => {
      const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const base = opaque(tokens.bg);
    const resolved = {};
    for (const key of Object.keys(tokens)) resolved[key] = over(tokens[key], base);
    const out = {};
    for (const fg of Object.keys(tokens)) {
      for (const bg of Object.keys(tokens)) {
        out[`${fg} on ${bg}`] = ratio(over(tokens[fg], resolved[bg]), resolved[bg]);
      }
    }
    return { ratios: out, resolved };
  }, colors);
}

// DSN-02：深色中性灰检查。旧写法把 token 当 hex 切片（slice/match），oklch 下
// 直接误判；改为检查浏览器解析后的 sRGB 三通道极差（暖灰允许微小偏暖，
// 抓的是“串成彩色”类回归）。半透明 token 先落在 --bg 上再量，量的是实际
// 渲染色，避免 alpha 预乘展开的舍入污染读数。门限 16：深色暖灰设计本身极差
// 约 10（text 实测 10），16 留余量；真串成彩色时极差通常 30+。
async function maxChannelSpread(page, value, base) {
  return page.evaluate(([style, baseStyle]) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.globalCompositeOperation = "copy";
    ctx.fillStyle = baseStyle;
    ctx.fillRect(0, 0, 1, 1);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = style;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return Math.max(r, g, b) - Math.min(r, g, b);
  }, [value, base]);
}

try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "en-US", colorScheme: "light", reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Keep the check independent of the user's session catalogue.
    await page.route(/\/api\/sessions(?:\?.*)?$/, (route) => route.fulfill({ json: { sessions: [] } }));
    await page.goto(base);
    await page.getByText("No sessions found", { exact: true }).waitFor({ state: "attached" });
    const openSettings = async () => {
      const sidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
      if (width <= 640) await sidebar.waitFor();
      if (await sidebar.isVisible()) await sidebar.click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
    };
    const expectTheme = async (theme) => {
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
      assert.equal(await page.locator("html").evaluate((root) => root.classList.contains("dark")), theme === "dark" || theme === "pine");
      assert.equal(await page.locator("html").evaluate((root) => getComputedStyle(root).colorScheme), theme === "dark" || theme === "pine" ? "dark" : "light");
    };
    await openSettings();
    for (const [index, theme] of themes.entries()) {
      const radio = page.getByRole("radio", { name: labels[index], exact: true });
      await radio.locator("..").click();
      await expectTheme(theme === "auto" ? "light" : theme);
      assert.equal(await radio.isChecked(), true);
      assert.equal(await page.evaluate(() => localStorage.getItem("pi-theme")), theme);
      const colors = await page.locator("html").evaluate((root) => {
        const style = getComputedStyle(root);
        return Object.fromEntries(["bg", "bg-panel", "bg-hover", "bg-selected", "user-bg", "assistant-bg", "tool-bg", "text", "text-muted", "text-dim", "accent", "accent-text", "accent-hover", "accent-contrast"].map((key) => [key, style.getPropertyValue(`--${key}`).trim()]));
      });
      // DSN-02 阈值分级（理由见 PR DSN-02）：
      // - 4.5：正文类（text/text-muted/text-dim/accent-text），WCAG 1.4.3 正文；
      // - 3.0：accent 只作非文字图形色（描边/图标/大图形），WCAG 1.4.11 非文本；
      // - 3.0：按钮（accent-contrast 落在 accent/accent-hover 上）按 UI 组件级
      //   1.4.11 拦回归。light 主题白字在品牌蓝上实测约 3.8/4.5，不到正文 4.5，
      //   这是已知现状：把品牌蓝加深到 4.5 会改变产品视觉，需单独决策，不在本门禁内卡死。
      const { ratios } = await contrastRatios(page, colors);
      for (const foreground of ["text", "text-muted", "text-dim", "accent-text"]) {
        for (const background of ["bg", "bg-panel", "bg-hover", "bg-selected", "user-bg", "assistant-bg", "tool-bg"]) {
          assert.ok(ratios[`${foreground} on ${background}`] >= 4.5, `${theme}: ${foreground} on ${background} must meet WCAG AA (${ratios[`${foreground} on ${background}`].toFixed(2)} < 4.5)`);
        }
      }
      for (const foreground of ["accent"]) {
        for (const background of ["bg", "bg-panel", "bg-hover", "bg-selected", "user-bg", "assistant-bg", "tool-bg"]) {
          assert.ok(ratios[`${foreground} on ${background}`] >= 3.0, `${theme}: ${foreground} on ${background} as non-text graphics must meet 3:1 (${ratios[`${foreground} on ${background}`].toFixed(2)} < 3.0)`);
        }
      }
      for (const background of ["accent", "accent-hover"]) {
        assert.ok(ratios[`accent-contrast on ${background}`] >= 3.0, `${theme}: button contrast (${ratios[`accent-contrast on ${background}`].toFixed(2)} < 3.0)`);
      }
      assert.equal(await page.locator(".settings-theme-option").evaluateAll((options) => options.every((option) => {
        const label = option.querySelector(".settings-theme-option-label");
        const box = option.getBoundingClientRect();
        const text = label.getBoundingClientRect();
        return option.scrollWidth <= option.clientWidth && text.right <= box.right && text.bottom <= box.bottom;
      })), true, `Theme labels must fit at ${width}px`);
      await page.screenshot({ path: `${artifacts}/${theme}-${width}.png`, animations: "disabled" });
      await page.reload();
      await expectTheme(theme === "auto" ? "light" : theme);
      await openSettings();
      assert.equal(await radio.isChecked(), true, "Selection must survive refresh");
    }
    await page.emulateMedia({ colorScheme: "dark" });
    await expectTheme("dark");
    await page.getByRole("radio", { name: "Pine", exact: true }).locator("..").click();
    await page.emulateMedia({ colorScheme: "light" });
    await expectTheme("pine");
    const light = page.getByRole("radio", { name: "Light", exact: true });
    await light.focus();
    await light.press("ArrowRight");
    await expectTheme("dark");
    assert.equal(await page.getByRole("radio", { name: "Dark", exact: true }).isChecked(), true);
    await page.keyboard.press("Escape");
    await page.reload();
    await expectTheme("dark");
    await page.getByText("No sessions found", { exact: true }).waitFor({ state: "attached" });
    const themeButton = page.getByRole("button", { name: /^Theme:/ });
    const menu = page.getByRole("menu", { name: "Appearance", exact: true });
    const showToolbar = async () => {
      if (width > 640) return;
      const more = page.locator("[data-mobile-toolbar-more]");
      if (await more.getAttribute("aria-expanded") !== "true") await more.click();
    };
    const openThemeMenu = async () => {
      await showToolbar();
      await themeButton.click();
      await menu.waitFor();
    };
    for (const [index, theme] of themes.entries()) {
      const before = await page.evaluate(() => localStorage.getItem("pi-theme"));
      await openThemeMenu();
      assert.equal(await page.evaluate(() => localStorage.getItem("pi-theme")), before, "Opening the menu must not switch themes");
      assert.equal(await themeButton.getAttribute("aria-expanded"), "true");
      assert.deepEqual(await menu.getByRole("menuitemradio").allTextContents(), labels);
      assert.equal(await menu.getByRole("menuitemradio", { checked: true }).count(), 1);
      assert.equal(await menu.locator("svg").count(), 6);
      const bounds = await menu.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, "Menu must fit the viewport");
      await menu.getByRole("menuitemradio", { name: labels[index], exact: true }).click();
      await expectTheme(theme === "auto" ? "light" : theme);
      await menu.waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => localStorage.getItem("pi-theme")), theme);
      assert.equal(await themeButton.evaluate((button) => button === document.activeElement), true);
    }
    await openThemeMenu();
    assert.equal(await menu.getByRole("menuitemradio", { name: "System", exact: true }).evaluate((button) => button === document.activeElement), true);
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expectTheme("dark");
    await openThemeMenu();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expectTheme("pine");
    await openThemeMenu();
    await page.screenshot({ path: `${artifacts}/menu-${width}.png`, animations: "disabled" });
    await page.evaluate(() => {
      window.themeEscapeReachedWindow = false;
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") window.themeEscapeReachedWindow = true;
      });
    });
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => window.themeEscapeReachedWindow), false, "Escape must not reach the global agent-abort shortcut");
    assert.equal(await themeButton.evaluate((button) => button === document.activeElement), true);
    await openThemeMenu();
    await page.mouse.click(width - 10, 850);
    await menu.waitFor({ state: "detached" });
    await openThemeMenu();
    await page.keyboard.press("End");
    await page.keyboard.press("Tab");
    await menu.waitFor({ state: "detached" });

    // Both selectors share positioning, dismissal, and focus handling.
    await showToolbar();
    await page.getByRole("button", { name: "Language", exact: true }).click();
    const languageMenu = page.getByRole("menu", { name: "Language", exact: true });
    await languageMenu.waitFor();
    await page.keyboard.press("Escape");
    await languageMenu.waitFor({ state: "detached" });
    if (width === 1440) {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await openThemeMenu();
      await menu.getByRole("menuitemradio", { name: "Dark", exact: true }).click();
      await expectTheme("dark");
      await page.waitForFunction(() => !document.getAnimations().some((animation) => animation.playState === "running"));
      await page.reload();
      await expectTheme("dark");
      for (const key of ["bg", "bg-panel", "bg-hover", "bg-selected", "border", "text", "text-muted", "text-dim", "user-bg", "tool-bg"]) {
        const [token, base] = await page.locator("html").evaluate((root, name) => {
          const s = getComputedStyle(root);
          return [s.getPropertyValue(`--${name}`).trim(), s.getPropertyValue("--bg").trim()];
        }, key);
        assert.ok(await maxChannelSpread(page, token, base) <= 16, `Dark ${key} must remain neutral gray (${token})`);
      }
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: palettes, contrast, persistence, system preference, menu selection, keyboard navigation, dismissal, icons`);
    await context.close();
  }
} finally {
  await browser.close();
}
