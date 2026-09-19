import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const settingsPanel = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const chatAppearanceHook = await readFile(new URL("../hooks/useChatAppearance.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url);
const { clampChatContentWidth, clampChatContentFontSize, clampExtensionWidgetFontSize } = await jiti.import("../hooks/useChatAppearance.ts");

const widthVariable = /var\(--chat-content-max-width, 800px\)/g;
const composerVariable = /var\(--composer-max-width, 892px\)/g;

test("chat content keeps the 800px default behind one shared variable", () => {
  assert.equal((chatWindow.match(widthVariable) ?? []).length, 1);
  assert.equal((chatInput.match(composerVariable) ?? []).length, 1);
  assert.match(globals, /--chat-content-max-width: 800px;/);
  assert.doesNotMatch(chatWindow, /max-w-\[768px\]|maxWidth: 768/);
  assert.doesNotMatch(chatInput, /maxWidth: 768/);
});

test("Markdown reading and editing keep an independent fixed 900px measure", () => {
  assert.match(globals, /--readable-content-max-width: 900px;/);
  assert.match(chatAppearanceHook, /--chat-content-max-width/);
  assert.doesNotMatch(chatAppearanceHook, /setProperty\("--readable-content-max-width"/);
  assert.match(globals, /\.markdown-readable-column[\s\S]*var\(--readable-content-max-width, 900px\)/);
});

test("General chat settings own the chat width preference", () => {
  assert.match(chatInput, /useChatAppearance\(\)/);
  assert.match(settingsPanel, /useChatAppearance\(\)/);
  assert.match(settingsPanel, /type="range"/);
  assert.match(settingsPanel, /min=\{CHAT_CONTENT_WIDTH_MIN\}/);
  assert.match(settingsPanel, /max=\{CHAT_CONTENT_WIDTH_MAX\}/);
  assert.match(settingsPanel, /step=\{10\}/);
  assert.match(chatAppearanceHook, /pi-chat-content-width/);
  assert.match(chatAppearanceHook, /localStorage\.setItem/);
});

test("chat width validation preserves the default and supported range", () => {
  assert.equal(clampChatContentWidth(undefined), 800);
  assert.equal(clampChatContentWidth("invalid"), 800);
  assert.equal(clampChatContentWidth(700), 700);
  assert.equal(clampChatContentWidth(1104), 1104);
  assert.equal(clampChatContentWidth(2400), 2000);
});

test("chat font size preserves the default and bounds stored or supplied values", () => {
  // fork:zn-11 —默认字号 13 → 14（Zeno 的正文尺寸）；下限/上限不变。
  for (const value of [undefined, null, "invalid", Infinity, NaN]) {
    assert.equal(clampChatContentFontSize(value), 14);
  }
  assert.equal(clampChatContentFontSize(8), 12);
  assert.equal(clampChatContentFontSize("18"), 18);
  assert.equal(clampChatContentFontSize(18.7), 19);
  assert.equal(clampChatContentFontSize(30), 24);
});

test("extension widget font size preserves the default and bounds stored or supplied values", () => {
  for (const value of [undefined, null, "invalid", Infinity, NaN]) {
    assert.equal(clampExtensionWidgetFontSize(value), 14);
  }
  assert.equal(clampExtensionWidgetFontSize(8), 12);
  assert.equal(clampExtensionWidgetFontSize("18"), 18);
  assert.equal(clampExtensionWidgetFontSize(18.7), 19);
  assert.equal(clampExtensionWidgetFontSize(30), 24);
});
