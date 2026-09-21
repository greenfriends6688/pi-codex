import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelSource = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const globalCssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const themeSource = await readFile(new URL("../hooks/useTheme.ts", import.meta.url), "utf8");
const themeOptionsSource = await readFile(new URL("../lib/theme.ts", import.meta.url), "utf8");
const enSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhSource = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");
const loginSource = await readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8");

test("opens one settings panel from the AppShell sidebar footer", () => {
  assert.match(shellSource, /<SettingsPanel/);
  // fork:ui-03b — 底栏收敛成一个齿轮按钮：模型/技能等分区都在面板里，
  // 原来的三个图标行（models / skills / settings）已删除。
  assert.match(shellSource, /onClick=\{\(\) => setSettingsSection\(getLastSettingsSection\(projectTrustCwd\)\)\}/);
  assert.match(shellSource, /initialSection=\{settingsSection\}/);
  assert.doesNotMatch(shellSource, /onClick=\{\(\) => setSettingsSection\(section\)\}/);
  assert.doesNotMatch(shellSource, /<SettingsSectionIcon/);
  assert.doesNotMatch(sidebarSource, /section="settings"/);
  assert.doesNotMatch(sidebarSource, /onOpenSettings/);
  assert.doesNotMatch(sidebarSource, /section="(?:models|skills|plugins)"/);
  assert.doesNotMatch(shellSource, /\["plugins", translate\("common\.plugins"\)\]/);
  assert.doesNotMatch(shellSource, /setModelsConfigOpen|setSkillsConfigOpen|setAgentsConfigOpen|setPluginsConfigOpen/);
});

test("keeps every requested configuration surface inside the settings panel", () => {
  for (const section of ["general", "models", "skills", "agents", "plugins"]) {
    assert.match(panelSource, new RegExp(`id: "${section}"`));
  }
  for (const component of ["ModelsConfig", "SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(panelSource, new RegExp(`<${component} embedded`));
  }
});

test("restores the settings section and each list detail selection", async () => {
  assert.match(shellSource, /initialSection=\{settingsSection\}/);
  assert.match(panelSource, /setLastSettingsSection\(initialSection\)/);
  assert.match(panelSource, /setLastSettingsSection\(nextSection\)/);
  for (const name of ["ModelsConfig", "SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(
      await readFile(new URL(`./${name}.tsx`, import.meta.url), "utf8"),
      /getLastSettingsSelection/,
    );
  }
});

test("keeps visited settings sections mounted and contains nested Escape handling", async () => {
  const modelsSource = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
  assert.match(panelSource, /mountedSections\.has\(id\)/);
  assert.match(panelSource, /hidden=\{section !== id\}/);
  assert.match(panelSource, /event\.defaultPrevented/);
  assert.match(modelsSource, /e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*onClose\(\);/);
});

test("offers five palettes and system theme selection with native radios", () => {
  for (const preference of ["light", "dark", "auto"]) {
    assert.match(themeOptionsSource, new RegExp(`id: "${preference}"`));
  }
  assert.match(panelSource, /THEME_OPTIONS\.map/);
  assert.match(panelSource, /type="radio"/);
  assert.match(panelSource, /setThemePreference\(option\.id\)/);
  assert.match(themeSource, /const setThemePreference = useCallback/);
});

test("keeps language selection in General settings", () => {
  assert.match(panelSource, /t\("common\.language"\)/);
  assert.match(panelSource, /className="settings-language-options"/);
  assert.match(panelSource, /setLocale\(plugin\.id/);
});

test("groups chat display controls together without row backgrounds", () => {
  const appearanceSection = panelSource.slice(
    panelSource.indexOf('{t("settings.appearance")}'),
    panelSource.indexOf('{t("settings.chat")}'),
  );
  const chatSection = panelSource.slice(
    panelSource.indexOf('{t("settings.chat")}'),
    panelSource.indexOf("{shellSettings?.isWindows"),
  );

  assert.doesNotMatch(appearanceSection, /settings-chat-content/);
  assert.match(chatSection, /className="settings-chat-options"/);
  // 7 = 原 7 条（含 fork:ui-22 的界面密度下拉）去掉「过程显示」下拉；三个类别开关
  // 由一次 `.map()` 渲染，源码里只有一处 `settings-chat-option`。
  assert.equal((chatSection.match(/className="settings-chat-option(?: |")/g) ?? []).length, 7);
  // 2 → 4：三个类别开关由 map 出，源码里是 1 个 <ConfigSwitch>，加上原本 2 个、减去
  // 被删掉的过程显示下拉（本来也不是 switch）→ 实际为 3。
  assert.equal((chatSection.match(/<ConfigSwitch/g) ?? []).length, 3);
  // 每个开关右边要写明当前状态（「推理展开」/「推理关闭」）。
  assert.match(chatSection, /className=\{on \? "settings-chat-switch-state is-on" : "settings-chat-switch-state"\}/);
  assert.match(chatSection, /settings\.stepExpandOn/);
  for (const key of ["thinkingExpandedDefault", "chatContentWidth", "chatContentFontSize", "extensionWidgetFontSize", "quoteSelection"]) {
    assert.match(chatSection, new RegExp(`t\\("settings\\.${key}"\\)`));
  }
  // 三个类别开关的文案走 map 的 key 数组，不是直接写 t("...").
  for (const key of ["stepExpandReasoning", "stepExpandCommand", "stepExpandTool"]) {
    assert.match(chatSection, new RegExp(`"settings\.${key}"`));
  }

  assert.doesNotMatch(panelSource, /ThinkingIcon|settings-thinking-/);
  const chatOptionStyles = cssSource.match(/\.settings-chat-option \{[\s\S]*?\}/)?.[0] ?? "";
  assert.match(chatOptionStyles, /font-size: var\(--text-sm\)/);
  assert.doesNotMatch(chatOptionStyles, /background/);
});

test("settings search filters sections and highlights rows", () => {
  assert.match(panelSource, /className="settings-search-input"/);
  assert.match(panelSource, /sectionSearchTerms\(item\.id\)/);
  assert.match(panelSource, /settings-search-match/);
  assert.match(panelSource, /scrollIntoView\(\{ block: "center" \}\)/);
  assert.match(cssSource, /\.settings-search-match \{[\s\S]*?background:/);
  assert.match(cssSource, /\.settings-search-input \{/);
});

test("keeps General free of divider rows", () => {
  assert.match(panelSource, /className="settings-dialog-header"/);
  assert.match(cssSource, /\.settings-dialog-header \{[\s\S]*?display: flex[\s\S]*?align-items: center[\s\S]*?min-height: 50px/);
  assert.doesNotMatch(panelSource, /sections\.find\(\(item\) => item\.id === section\)/);
  assert.doesNotMatch(panelSource, /<section style=\{\{[^}]*borderBottom/);
  assert.doesNotMatch(panelSource, /borderLeft: index > 0/);
});

test("uses a left section column on desktop and one compact picker on mobile", () => {
  assert.match(panelSource, /className="settings-mobile-section-picker"/);
  assert.match(panelSource, /className="settings-section-tabs"/);
  // fork:ui-14 — the class is composed with the search-hit modifier now.
  assert.match(panelSource, /className=\{`settings-section-tab\$\{jumpHit \? " settings-section-tab--hit" : ""\}`\}/);
  // fork:ui-08 — a vertical column (upstream 0.14.6 layout) instead of a row of
  // fixed 96px cells.
  assert.match(panelSource, /className="settings-dialog-body"/);
  assert.match(cssSource, /\.settings-section-tabs \{[\s\S]*?flex-direction: column/);
  assert.match(cssSource, /\.settings-section-tabs \{[\s\S]*?width: 184px/);
  assert.match(cssSource, /\.settings-section-tab \{[\s\S]*?flex: 0 0 auto/);
  assert.match(cssSource, /\.settings-section-icon \{[\s\S]*?flex-shrink: 0/);
  assert.match(cssSource, /\.settings-section-tab::after \{[\s\S]*?width: 2px/);
  assert.match(cssSource, /\.settings-section-tab\[aria-current="page"\]::after/);
  assert.match(cssSource, /\.settings-section-tab:focus-visible:not\(\[aria-current="page"\]\)/);
  // 焦点环改由 globals.css 的皮肤覆盖层统一提供，这一支不再清掉 outline。
  const currentTabFocusRule = cssSource.match(/\.settings-section-tab:focus-visible\[aria-current="page"\] \{[\s\S]*?\}/)?.[0] ?? "";
  assert.ok(currentTabFocusRule, "the current section tab focus rule should exist");
  assert.doesNotMatch(currentTabFocusRule, /outline: none/);
  assert.match(globalCssSource, /:where\(button[\s\S]*?:focus-visible \{[\s\S]*?outline: 2px solid var\(--accent\) !important/);
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?\.settings-section-tabs \{[\s\S]*?display: none/);
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?\.settings-mobile-section-picker \{[\s\S]*?display: block/);
  assert.doesNotMatch(panelSource, /width: isMobile \? "100%" : 188/);
  // fork:ui-14 — the content column carries the search-highlight ref now.
  assert.match(panelSource, /<main className="settings-dialog-main" ref=\{mainRef\}>/);
  assert.doesNotMatch(panelSource, /<style>/);
  assert.doesNotMatch(panelSource, /style=\{\{/);
});

test("labels agent profiles as sub-agents", () => {
  assert.match(enSource, /"common\.agents": "Sub-agents"/);
  assert.match(enSource, /"agents\.new": "New sub-agent"/);
  assert.match(zhSource, /"common\.agents": "子代理"/);
  assert.match(zhSource, /"agents\.new": "新建子代理"/);
});

test("uses the child-session robot glyph for the sub-agents tab", () => {
  const robotGlyph = /<rect x="5" y="7" width="14" height="11" rx="2" \/>\s*<path d="M9 11h\.01M15 11h\.01M9 15h6M12 7V4M10 4h4" \/>/;
  assert.match(panelSource, robotGlyph);
  assert.match(sidebarSource, robotGlyph);
  assert.match(panelSource, /section === "agents"[\s\S]*?className="settings-section-icon is-agent"/);
  assert.match(cssSource, /\.settings-section-icon\.is-agent \{[\s\S]*?transform: scale\(1\.25\)/);
});

test("uses the compact controls glyph for General", () => {
  assert.match(panelSource, /section === "general"[\s\S]*?<path d="M20 7h-9M14 17H5" \/>[\s\S]*?<circle cx="7" cy="7" r="3" \/>[\s\S]*?<circle cx="17" cy="17" r="3" \/>/);
});

test("keeps password authentication to one login field and one settings action", () => {
  assert.equal((loginSource.match(/type="password"/g) ?? []).length, 1);
  assert.doesNotMatch(loginSource, /type="(?:text|email)"/);
  assert.match(loginSource, /autoComplete="current-password"/);
  assert.match(loginSource, /!destination\.startsWith\("\/\/"\)/);
  assert.match(panelSource, /fetch\("\/api\/web-auth", \{ method: "DELETE" \}\)/);
  assert.match(panelSource, /t\("auth\.logOut"\)/);
  assert.match(loginSource, /className="web-login-composer"[\s\S]*?type="password"[\s\S]*?<button type="submit"/);
  assert.match(globalCssSource, /\.web-login-composer \{[\s\S]*?display: flex;[\s\S]*?border-radius: var\(--radius-lg\)/);
});
