#!/usr/bin/env node
/**
 * Ad-hoc probe: verifies the theme/border/wallpaper wiring in a real browser
 * without depending on UI text (the app is localized, so text selectors are
 * brittle). Temporary tooling.
 */
import { chromium } from "playwright";

const BASE = process.env.PI_BASE ?? "http://127.0.0.1:30141";
const browser = await chromium.launch();

async function readBorders(page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const inline = document.documentElement.style;
    return {
      border: style.getPropertyValue("--border").trim(),
      strong: style.getPropertyValue("--border-strong").trim(),
      faint: style.getPropertyValue("--border-faint").trim(),
      stored: window.localStorage.getItem("pi-border-depth"),
      inlineBorder: JSON.stringify(inline.getPropertyValue("--border")),
      inlineOrig: JSON.stringify(inline.getPropertyValue("--border-orig")),
    };
  });
}

// 1. Border depth actually bites, across the range.
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const failures = [];
page.on("response", (response) => {
  if (response.status() >= 400) console.log("[http]", response.status(), response.url());
});

for (const depth of [0, 25, 50, 75, 100]) {
  await page.addInitScript((value) => {
    window.localStorage.setItem("pi-border-depth", String(value));
  }, depth);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const borders = await readBorders(page);
  console.log(`depth ${String(depth).padStart(3)} → border=${borders.border}`);
  console.log(`         stored=${borders.stored} inlineBorder=${borders.inlineBorder} inlineOrig=${borders.inlineOrig}`);
  if (depth === 0 && borders.border !== "transparent") {
    failures.push(`depth 0 did not clear the border (got ${borders.border})`);
  }
  if (depth === 100 && !/oklch\(26%/.test(borders.border) && !borders.border.includes("var(--text)")) {
    failures.push(`depth 100 did not reach the text colour (got ${borders.border})`);
  }
}

// 2. Themes API + the built-in wallpaper assets.
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(600);
const api = await page.evaluate(async () => {
  const themes = await (await fetch("/api/themes")).json();
  const head = await fetch("/monet-artworks/default.jpg", { method: "HEAD" });
  const gruvbox = await fetch("/monet-artworks/gruvbox.jpg", { method: "HEAD" });
  return {
    themeNames: themes.themeSets?.map((set) => set.name) ?? [],
    defaultPainting: head.status,
    gruvboxPainting: gruvbox.status,
  };
});
console.log("api:", JSON.stringify(api));
if (api.themeNames.length === 0) failures.push("/api/themes returned no sets");
if (api.defaultPainting !== 200) failures.push("default wallpaper asset missing");
if (api.gruvboxPainting !== 200) failures.push("gruvbox wallpaper asset missing");

// 3. Enabling the wallpaper should paint the built-in painting.
await page.addInitScript(() => {
  window.localStorage.setItem("pi-wallpaper-enabled", "1");
  window.localStorage.setItem("pi-palette-probe", "1");
});
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
const wallpaper = await page.evaluate(() => {
  const layer = document.querySelector(".chat-wallpaper");
  const img = layer?.querySelector("img");
  return {
    attr: document.documentElement.getAttribute("data-wallpaper"),
    src: img?.getAttribute("src") ?? null,
    ready: document.documentElement.dataset.wallpaperReady ?? null,
  };
});
console.log("wallpaper:", JSON.stringify(wallpaper));
if (wallpaper.attr !== "on") failures.push("wallpaper did not turn on");
if (!wallpaper.src?.startsWith("/monet-artworks/")) failures.push(`wallpaper src not a built-in painting: ${wallpaper.src}`);

await page.screenshot({ path: "probe-wallpaper.png" });
await browser.close();

if (failures.length > 0) {
  console.log("\nFAILURES:");
  for (const failure of failures) console.log(" -", failure);
  process.exit(1);
}
console.log("\nAll probes passed.");
