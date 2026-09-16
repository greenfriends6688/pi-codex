import assert from "node:assert/strict";

// Skin values: this fork's chat column defaults to 860px / 13px with a 640px
// floor (hooks/useChatAppearance.ts + docs/codex-skin/delta.md), where upstream
// ships 820px / 14px. Code fences size from a 12.5px monospace base
// (components/MermaidBlock.tsx), so they sit 0.5px under the prose base.
// Everything else in this file is behaviour, not numbers.

/**
 * Open the settings panel and wait for it to actually mount.
 *
 * The fork's entry point sits in the sidebar footer, which hydrates later than
 * the SSR markup the caller just waited on, so a single click straight after
 * `domcontentloaded` can land before React attaches the handler and be dropped.
 * Retry until the panel exists instead of assuming one click is enough.
 */
export async function openSettingsPanel(page) {
  const panel = page.locator(".settings-dialog-surface");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    if (await panel.isVisible().catch(() => false)) return;
    await page.waitForTimeout(250);
  }
  await panel.waitFor({ state: "visible" });
}

export async function checkChatAppearanceReset(page) {
  const width = page.getByRole("slider", { name: "Chat content width", exact: true });
  const fontSize = page.getByRole("slider", { name: "Chat font size", exact: true });
  const resetWidth = page.getByRole("button", { name: "Reset chat content width", exact: true });
  const resetFontSize = page.getByRole("button", { name: "Reset chat font size", exact: true });
  await width.press("End");
  await fontSize.press("End");
  await resetWidth.click();
  assert.equal(await width.inputValue(), "860");
  assert.equal(await fontSize.inputValue(), "24", "Resetting width must preserve font size");
  await width.press("End");
  await resetFontSize.click();
  assert.equal(await fontSize.inputValue(), "13");
  assert.equal(await width.inputValue(), "2000", "Resetting font size must preserve width");
  await resetWidth.click();
  assert.deepEqual(await page.evaluate(() => ({
    width: localStorage.getItem("pi-chat-content-width"),
    fontSize: localStorage.getItem("pi-chat-content-font-size"),
    appliedWidth: document.documentElement.style.getPropertyValue("--chat-content-max-width"),
    appliedFontSize: document.documentElement.style.getPropertyValue("--chat-content-font-size"),
  })), { width: "860", fontSize: "13", appliedWidth: "860px", appliedFontSize: "13px" });
  await page.reload({ waitUntil: "networkidle" });
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await showSidebar.isVisible()) await showSidebar.click();
  await openSettingsPanel(page);
  assert.equal(await width.inputValue(), "860");
  assert.equal(await fontSize.inputValue(), "13");
  assert.equal(await resetWidth.isDisabled(), true);
  assert.equal(await resetFontSize.isDisabled(), true);
}

export async function checkChatAppearance(page) {
  await page.setViewportSize({ width: 2560, height: 1100 });
  const textarea = page.locator(".chat-input-textarea");
  const openSettings = () => openSettingsPanel(page);
  const closeSettings = () => page.keyboard.press("Escape");
  const width = page.getByRole("slider", { name: "Chat content width", exact: true });
  const fontSize = page.getByRole("slider", { name: "Chat font size", exact: true });
  const font = (locator) => locator.evaluate((el) => getComputedStyle(el).fontSize);
  const fittedHeight = async () => {
    await page.waitForFunction(() => {
      const input = document.querySelector(".chat-input-textarea");
      return input && (input.scrollHeight <= input.clientHeight + 1 || input.clientHeight >= 199);
    });
    return textarea.evaluate((el) => el.clientHeight);
  };

  await openSettings();
  assert.equal(await width.inputValue(), "860");
  assert.equal(await fontSize.inputValue(), "13");
  await width.press("End");
  await closeSettings();
  const draft = "Existing drafts resize when the available width or the reading font changes. ".repeat(6);
  await textarea.fill(draft);
  const fixedWidthHeight = await fittedHeight();
  await openSettings();
  await width.press("Home");
  assert.equal(await width.inputValue(), "640");
  await closeSettings();
  const sameWidthHeight = await fittedHeight();
  assert.ok(sameWidthHeight > fixedWidthHeight, "Chat width setting must affect chat wrapping");

  await openSettings();
  await fontSize.press("End");
  await closeSettings();
  assert.ok(await fittedHeight() > sameWidthHeight, "Increasing the font must grow the draft");
  await openSettings();
  await width.press("End");
  await fontSize.press("Home");
  for (let i = 12; i < 18; i++) await fontSize.press("ArrowRight");
  // Read the slider while the panel is still open: this fork closes the settings
  // dialog on Escape (upstream leaves it mounted), so `closeSettings` would take
  // the slider out of the DOM and the value assertion could never resolve.
  assert.equal(await width.inputValue(), "2000");
  await closeSettings();
  assert.equal(await textarea.inputValue(), draft);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".markdown-code-block pre").waitFor();
  assert.equal(await font(textarea), "18px");
  assert.equal(await font(page.locator(".markdown-user-message")), "18px");
  // Code fences go through CodeBlock, which sizes its <pre> as
  // `calc(12.5px + var(--chat-font-size-offset))` (components/MermaidBlock.tsx),
  // so the monospace base is 0.5px under the prose base: 17.5px at font=18.
  assert.equal(await font(page.locator(".markdown-code-block pre")), "17.5px");

  await openSettings();
  assert.equal(await width.inputValue(), "2000");
  assert.equal(await fontSize.inputValue(), "18");
  await checkChatAppearanceReset(page);
  for (const viewport of [{ width: 1280, height: 600 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await page.locator(".settings-general").evaluate((el) => { el.scrollTop = el.scrollHeight; });
    assert.equal(await page.locator(".settings-language-options button:last-child").evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), true, "Every language option must remain reachable in a short settings panel");
  }
  await fontSize.press("Home");
  await closeSettings();
  assert.equal(await font(textarea), "16px", "Mobile inputs retain the focus-zoom minimum");
  await textarea.fill("A mobile draft wraps and resizes within the available space.");
  await fittedHeight();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log("PASS: chat appearance persistence, typography, draft resizing, and short settings panels");
}
