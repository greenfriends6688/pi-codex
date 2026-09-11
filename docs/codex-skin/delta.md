# Codex 皮肤改造台账

本文件记录 pi-web 相对上游 v0.9.0 的全部**皮肤/布局**改动，用于将来合并上游更新时快速定位冲突并重打皮肤。这里不应出现任何功能改动；如果你发现台账之外的行为差异，视为合并事故。

## 版本与分支

| 分支/引用 | 内容 |
|---|---|
| `upstream` | 纯净上游快照链：`68e746c` = v0.9.0 原始源码包 |
| `main` | `a43952b` 本地基线（v0.9.0 + 旧配色改造）→ 本皮肤各阶段提交 |
| worktree | `../pi-web-upstream` 挂在 `upstream` 分支，专门用于落新版本源码包 |

## 更新流水线（收到新源码包时）

1. 先核对版本来源：以 npm `@agegr/pi-web` latest / GitHub Release 为准，不要只看 semver 最大的 tag（历史上 `v0.10.5` 比 `v0.9.0` 更早，是分叉线）。
2. 在 `../pi-web-upstream` 解压覆盖新包 → `git add -A && git commit -m "upstream vX.Y.Z"`。
3. 回主仓库 `git merge upstream`；冲突只应出现在本台账列出的文件。
4. 冲突策略：**逻辑冲突一律取上游**；皮肤冲突按本台账重打（见下方"皮肤改动点"）。
5. `npm install`（依赖变化时）→ `tsc --noEmit` → `npm run lint` → `npm test`（已知唯一环境性失败：`uses the CLI global lock location` 依赖全局安装，可在干净环境复现，与本皮肤无关）。
6. 提交 merge commit，打 tag `skin-vX.Y.Z`，并把本台账的"基线版本"更新为新版本。

## 皮肤改动点

### 基座 `app/globals.css`
- 圆角改为 `--corner-radius-scale: 1.25` 的 calc 体系（xs 5 / sm 7.5 / md 10 / lg 12.5 / xl 15 / 2xl 20）。
- 阴影改为 Codex 轻投影，新增 `--elevation-stroke/prominent/sidebar`、`--scrim`、`--focus-ring`。
- 布局 token：`--chat-content-max-width: 768px`、`--height-toolbar-sm/pane`、`--spacing-token-button-composer: 28px`、`--conversation-item-gap` 等。
- 等宽字体栈改为 SF Mono 优先；聊天正文 13px（`--chat-content-font-size`），markdown 行高 1.62。

### 骨架 `components/AppShell.tsx`
- 顶栏按钮改 32px 圆角 chip：去掉 `borderRight` 分隔线与激活态 2px accent 顶边；`TOP_BAR_ICON_BUTTON_SIZE` 36→32。
- 右面板头部 46→40px（`--height-toolbar-pane`），默认宽 384（`lib/panel-layout.ts`）。
- 背景/遮罩统一 `var(--scrim)`；信任警告改 warning 软底 chip。

### 侧边栏 `components/SessionSidebar.tsx`
- **会话行改为 Codex 单行胶囊**：`SESSION_LIST_ITEM_HEIGHT` 48→32（导出供测试推导）、`borderRadius: var(--radius-pill)`、标题 13px，时间/消息数只在 hover 时出现，running/unread 指示器移到标题前，hover 操作按钮 24px 无边框。
- 头部：标题 13.5px/600 非等宽；新建/搜索/cwd 选择器改 subtle chip。
- **文件树整段迁出**（见 ExplorerPanel），SessionSidebar 不再接收 `onOpenFile/onOpenTerminal/explorerRefreshKey/onExplorerRefresh/onAtMention/onAtMentions` 属性。

### 右侧面板 `components/ExplorerPanel.tsx`（新增）
- 由 SessionSidebar 的 FileExplorer 章节原样搬出，state 与 FileExplorer 回调不变；`ToolbarIconButton` 一并搬入。
- 无打开 Tab 时由 AppShell 右侧面板渲染，替代原 "files.noneOpen" 空态；`TabBar` 改为 32px 胶囊 Tab（去右边框分隔）。

### 消息 `components/ChatWindow.tsx` / `MessageView.tsx` / `ChatMinimap.tsx`
- 列宽 768、列内边距 12；空态标题改非等宽 24/20px；通知条 `--radius-xl` + `--bg-elev`。
- 用户气泡 80% 宽、13px、20px 圆角；时间戳 11px；工具卡/思考块沿用 token 化圆角与状态色；diff 行高 1.7。
- Minimap 圆点改 22×3 圆角 marker（scaleX 渐进）。

### Composer `components/ChatInput.tsx` / `ModelSelector.tsx`
- 控件统一 28px（`--spacing-token-button-composer`）、gap/padding 收紧、圆角 `--radius-md`。
- 发送键改 28px 圆形图标键（`aria-label` 保留，测试断言 `aria-label="Send"`）；Steer/Follow-up 改 12px 紧凑键。

### 设置与弹窗 `app/settings.css` + `Settings*` / `ModelsConfig` / `SkillsConfig` / `PluginsConfig` / `AgentsConfig` / `ProjectTrustDialog` / `DirectoryPicker`
- 遮罩统一 `var(--scrim)`；半径/阴影走 token；硬编码色（红/蓝/琥珀）全部换成 `--danger/--accent/--warning` 及 color-mix 变体。

### 行为常量（皮肤相关，合并时注意）
- `hooks/useChatAppearance.ts`：宽度默认 768、下限 640；字号默认 13。`clampChatContentWidth(null)` 视为默认值（修复了 `Number(null)=0` 被钳到下限的边界）。
- `lib/file-explorer-state.ts`：折叠状态 key 不变，由 ExplorerPanel 继续使用。

## 已知测试断言同步

以下测试断言的是皮肤数值，合并上游若覆盖需同步：
`ChatAppearance`（768/13）、`SessionSidebar`（行高常量推导）、`AgentSessionPanel`（`--radius-md` 圆角）、`ImagePreview`（`--radius-md`/`--bg-elev`）、`MessageView`（`--border` 工具卡）、`MobilePwaLayout`（`--height-toolbar`/`--height-toolbar-pane`）、`panel-layout`（384 默认宽）。
