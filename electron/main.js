"use strict";

// pi-web 桌面壳（macOS）：在 Electron 里托管 Next.js 服务（next start），
// 复用 bin/pi-web.js 的启动方式，用 Electron 自身二进制（ELECTRON_RUN_AS_NODE=1）
// 当作 Node 来跑 next 的 CLI，避免依赖系统 Node。

// 宿主 shell（pi / 类 agent 环境）会注入这两个变量，会让 Electron 以纯 Node 模式
// 启动导致无窗口退出，这里必须清除，保证 app 本体正常进入 Electron 主流程。
delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_RUNNING;

const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  powerSaveBlocker,
  screen,
  shell,
} = require("electron");
const { spawn } = require("node:child_process");
const { createServer } = require("node:net");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const APP_NAME = "Pinkslab";
/** Previous product names, newest first; the migration below picks the first that exists. */
const LEGACY_APP_NAMES = ["Pi Codex", "pi-web"];
const { legacyUserDataSource } = require("./legacy-user-data");
let mainWindow = null;
let tray = null;
let serverProc = null;
let serverPort = null;
let quitting = false;
let keepAwakeId = null;

// ── 路径解析 ────────────────────────────────────────────────────────────────
function getAppRoot() {
  // 打包后整个项目被平铺到 Contents/Resources/app（asar:false）
  return app.isPackaged
    ? path.join(process.resourcesPath, "app")
    : path.join(__dirname, "..");
}

function getNextBin(appRoot) {
  const candidates = [
    path.join(appRoot, "node_modules", "next", "dist", "bin", "next"),
  ];
  try {
    candidates.push(require.resolve("next/dist/bin/next", { paths: [appRoot] }));
  } catch {
    /* fall through to candidates */
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// ── 端口分配：监听 port 0 拿一个空闲端口，避免与 30141(dev) 冲突 ────────────
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

// ── 启动 Next.js 服务 ───────────────────────────────────────────────────────
async function startServer(appRoot) {
  // 优先使用外部指定的端口（冒烟测试/运维固定端口），否则取空闲端口
  const requested = Number(process.env.PI_WEB_PORT || process.env.PORT || 0);
  const port = requested > 0 && requested < 65536 ? requested : await getFreePort();
  const nextBin = getNextBin(appRoot);
  if (!nextBin) {
    dialog.showErrorBox(
      `${APP_NAME} 启动失败`,
      "找不到 Next.js CLI（node_modules/next/dist/bin/next），请重新打包。",
    );
    app.quit();
    return null;
  }

  const isDev = !app.isPackaged;
  const useDevServer = isDev && !fs.existsSync(path.join(appRoot, ".next"));
  const nextArgs = useDevServer
    ? ["dev", "-H", "127.0.0.1", "-p", String(port)]
    : ["start", "-p", String(port), "-H", "127.0.0.1"];

  serverProc = spawn(process.execPath, [nextBin, ...nextArgs], {
    cwd: appRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProc.stdout.on("data", (chunk) => process.stdout.write(chunk));
  serverProc.stderr.on("data", (chunk) => process.stderr.write(chunk));
  serverProc.on("error", (err) => {
    console.error("pi-web server spawn error:", err);
    app.quit();
  });
  serverProc.on("exit", (code, signal) => {
    console.error(`pi-web server exited (code=${code} signal=${signal})`);
    if (!quitting && !useDevServer) {
      // 服务意外退出：提示并退出，避免窗口停留在无法连接的页面上
      dialog.showErrorBox(
        `${APP_NAME} 服务已退出`,
        "Next.js 本地服务异常退出，应用将关闭。可重新打开应用重试。",
      );
      app.quit();
    }
  });

  serverPort = port;
  console.log(`[pinkslab] Next.js 服务启动: http://127.0.0.1:${port} (dev=${useDevServer})`);
  return { port, useDevServer };
}

function waitReady(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/" },
        (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) resolve();
          else schedule();
        },
      );
      req.on("error", schedule);
      req.setTimeout(1000, () => {
        req.destroy();
        schedule();
      });
    };
    const schedule = () => {
      if (Date.now() > deadline) {
        reject(new Error("等待 pi-web 服务就绪超时"));
        return;
      }
      setTimeout(poll, 300);
    };
    poll();
  });
}

// ── 窗口 ────────────────────────────────────────────────────────────────────
function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  const state = loadWindowState();
  // fork:desktop-win — 窗口边框按平台分叉。
  //
  // macOS 保持 `hidden` + 原生红绿灯浮在应用自己的顶栏上（顶栏由 fork-ui.css 的
  // drag 区域负责拖动，lib/desktop-shell.ts 给 darwin 预留 64px 让位）。
  //
  // Windows 上不能用同一套：`titleBarStyle: "hidden"` 会连最小化/最大化/关闭一起
  // 去掉，而 `titleBarOverlay` 画出来的系统按钮区（约 138px）正好压在顶栏右侧的
  // 面板切换按钮上，应用又没有用 `env(titlebar-area-*)` 让位——结果是"能看见窗口
  // 但关不掉"。所以 Windows 保留系统原生边框：按钮一定可用，顶栏整体下移一条，
  // 拖动/双击最大化也由系统负责。`desktopTrafficLightInset()` 对非 darwin 返回 0，
  // 顶栏不会被多推一段空白。
  const isMac = process.platform === "darwin";
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: 940,
    minHeight: 600,
    title: APP_NAME,
    ...(isMac
      ? {
        // macOS keeps the native traffic lights and native fullscreen; the web app draws
        // its own bar, so the title bar stays hidden. `movable` is on and the renderer
        // marks the bar as a drag region (see lib/desktop-shell.ts + fork-ui.css) —
        // without that region a hidden-title-bar window cannot be dragged at all.
        titleBarStyle: "hidden",
        trafficLightPosition: { x: 14, y: 16 },
      }
      : { titleBarStyle: "default" }),
    movable: true,
    fullscreenable: true,
    backgroundColor: "#0f1117",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      spellcheck: false,
    },
  });

  if (state.maximized) mainWindow.maximize();

  for (const event of ["resize", "move"]) {
    mainWindow.on(event, () => saveWindowState(mainWindow));
  }
  mainWindow.on("close", (event) => {
    saveWindowState(mainWindow);
    // fork:close-to-tray — 关窗 = 收进托盘，而不是结束进程：后台任务（长回答、
    // 定时任务）不该因为用户顺手点一下关闭就断。托盘双击/单击恢复窗口，
    // 只有托盘「退出」、Cmd+Q 或 quitting 标记才真正退出。
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    mainWindow = null;
  });

  // Crash visibility: a silent white window is the worst possible failure mode.
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[pinkslab] renderer gone:", details.reason);
    dialog.showMessageBox({
      type: "error",
      title: APP_NAME,
      message: "界面进程异常退出",
      detail: `原因：${details.reason}。点击「重新加载」可以恢复当前会话。`,
      buttons: ["重新加载", "退出"],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0 && mainWindow) mainWindow.reload();
      else app.quit();
    });
  });

  // 外部链接一律交给系统浏览器；页面内跳转到其它 host 也走同一规则
  //
  // fork:fix-desktop-blocked-nav — 这里必须留痕。
  // 之前被拦掉的导航是**静默**的（既不开系统浏览器也可能被 deny），
  // 用户看到的现象就是"某个按钮点了没反应、也不报错"，而主进程日志里什么都没有，
  // 排查只能靠猜。现在每次拦截都打一行日志，冒烟脚本会去收集它。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/.test(url)) {
      console.log(`[pinkslab] blocked window.open → 交给系统浏览器: ${url}`);
      shell.openExternal(url);
    } else {
      console.log(`[pinkslab] blocked window.open（非 http(s)/mailto，已丢弃）: ${url}`);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const target = new URL(url);
    if (target.port && Number(target.port) === serverPort) return;
    event.preventDefault();
    if (/^(https?|mailto):/.test(url)) {
      console.log(`[pinkslab] blocked will-navigate → 交给系统浏览器: ${url}（应用内表现为"按钮无反应"）`);
      shell.openExternal(url);
    } else {
      console.log(`[pinkslab] blocked will-navigate（非 http(s)/mailto，已丢弃）: ${url}`);
    }
  });

  const url = `http://127.0.0.1:${serverPort}`;
  mainWindow.loadURL(url);
  return mainWindow;
}

// ── 原生集成（通知 / Dock 角标 / 防休眠 / 外部工具） ─────────────────────────
function setupDesktopIpc() {
  ipcMain.handle("desktop:notify", (_event, payload) => {
    if (!Notification.isSupported()) return false;
    const { title, body, tag, url } = payload ?? {};
    if (!title && !body) return false;
    const notification = new Notification({
      title: String(title ?? APP_NAME),
      body: String(body ?? ""),
      // The app already plays its own completion sound; the system one would double it.
      silent: payload?.silent !== false,
      ...(tag ? { tag: String(tag) } : {}),
    });
    notification.on("click", () => {
      showWindow();
      if (url) {
        mainWindow?.webContents.send("desktop:action", { kind: "notification-clicked", url: String(url) });
      }
    });
    notification.show();
    return true;
  });

  ipcMain.on("desktop:badge", (_event, text) => {
    // Dock badge: the macOS-native place for "there are unread conversations".
    if (process.platform !== "darwin" || !app.dock) return;
    app.dock.setBadge(text ? String(text) : "");
  });

  ipcMain.on("desktop:keep-awake", (_event, active) => {
    // Long agent runs should not be interrupted by the display sleeping.
    if (active && keepAwakeId === null) {
      keepAwakeId = powerSaveBlocker.start("prevent-display-sleep");
    } else if (!active && keepAwakeId !== null) {
      powerSaveBlocker.stop(keepAwakeId);
      keepAwakeId = null;
    }
  });

  ipcMain.on("desktop:open-external", (_event, url) => {
    if (typeof url === "string" && /^(https?|mailto):/.test(url)) void shell.openExternal(url);
  });

  ipcMain.on("desktop:reveal", (_event, target) => {
    if (typeof target === "string" && target) shell.showItemInFolder(target);
  });

  // The renderer keeps its own palette; this only tells it when the *system* flipped
  // so an "auto" palette can follow without a reload.
  nativeTheme.on("updated", () => {
    mainWindow?.webContents.send("desktop:action", {
      kind: "theme-changed",
      dark: nativeTheme.shouldUseDarkColors,
    });
  });
}

function showWindow() {
  const win = createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function setupTray() {
  const isMac = process.platform === "darwin";
  // fork:desktop-win — macOS 用 template 图标（单色遮罩，系统按亮/暗自动反白）；
  // Windows 托盘铺在深色任务栏上，同一个黑色字形等于看不见，所以改用彩色应用图标
  // 并缩到 16px。extraResources 里的 appIcon.png 与 build/icon.png 是同一张图。
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, isMac ? "trayTemplate.png" : "appIcon.png")
    : path.join(getAppRoot(), "build", isMac ? "trayTemplate.png" : "icon.png");
  if (!fs.existsSync(iconPath)) return;

  // Template image must be set on the nativeImage, not on the Tray (Tray has no
  // setTemplateImage — calling it throws an unhandled rejection and the menu bar
  // icon keeps its original colours).
  let trayIcon = nativeImage.createFromPath(iconPath);
  if (isMac) trayIcon.setTemplateImage(true);
  else trayIcon = trayIcon.resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip(APP_NAME);
  tray.on("click", showWindow);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示窗口", click: showWindow },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

// ── 改名后的一次性迁移 ──────────────────────────────────────────────────────
// The product name decides `app.getPath("userData")`, and the renderer keeps its
// window geometry, drafts and layout state there (localStorage), so a renamed
// product would silently start with an empty directory. Copy the newest legacy
// one once (a user can arrive from any older name, pi-web or Pi Codex).
function migrateLegacyUserData() {
  if (process.platform !== "darwin") return;
  try {
    const support = path.join(app.getPath("appData"));
    const legacy = legacyUserDataSource(support, APP_NAME, LEGACY_APP_NAMES);
    if (!legacy) return;
    const next = path.join(support, APP_NAME);
    fs.cpSync(legacy, next, { recursive: true });
    console.log(`[pinkslab] migrated user data: ${legacy} → ${next}`);
  } catch (error) {
    console.error("[pinkslab] user data migration failed:", error);
  }
}

// ── 窗口位置/尺寸记忆 ───────────────────────────────────────────────────────
function windowStatePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function loadWindowState() {
  const fallback = { width: 1280, height: 820 };
  try {
    const parsed = JSON.parse(fs.readFileSync(windowStatePath(), "utf8"));
    const state = { width: Number(parsed.width) || fallback.width, height: Number(parsed.height) || fallback.height };
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      // Keep the window on a screen that still exists (a monitor may be gone).
      const area = screen.getDisplayMatching({ x: parsed.x, y: parsed.y, width: state.width, height: state.height }).workArea;
      const onScreen = parsed.x + 80 > area.x && parsed.y + 40 > area.y && parsed.x < area.x + area.width - 80 && parsed.y < area.y + area.height - 40;
      if (onScreen) {
        state.x = parsed.x;
        state.y = parsed.y;
      }
    }
    if (parsed.maximized === true) state.maximized = true;
    return state;
  } catch {
    return fallback;
  }
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const bounds = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    fs.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
    fs.writeFileSync(windowStatePath(), JSON.stringify({
      ...bounds,
      maximized: win.isMaximized(),
    }, null, 2));
  } catch (error) {
    console.error("[pinkslab] failed to persist window state:", error);
  }
}

// ── 应用生命周期 ────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", showWindow);

  // Must run before the first window/state write so the migrated state is the one
  // that gets read.
  migrateLegacyUserData();

  app.whenReady().then(async () => {
    const appRoot = getAppRoot();
    if (!fs.existsSync(path.join(appRoot, ".next"))) {
      dialog.showErrorBox(
        `${APP_NAME} 缺少构建产物`,
        ".next 目录不存在。打包前请先执行 npm run build。",
      );
      app.quit();
      return;
    }

    const result = await startServer(appRoot);
    if (!result) return;
    try {
      await waitReady(result.port, 90_000);
    } catch (err) {
      console.error(err.message);
      app.quit();
      return;
    }

    // 角色化菜单：Cmd+Q/W/M/H、复制粘贴、缩放、原生全屏等快捷键自动生效
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      version: `Electron ${process.versions.electron} · Node ${process.versions.node}`,
      copyright: "Pinkslab — local coding agent workbench",
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        // fork:desktop-win — `appMenu` 是 macOS 专有 role。Windows 上它不报错，
        // 但会留下一个空的顶级菜单项（"应用" 点了没东西），所以只在 darwin 加。
        ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
        { role: "fileMenu" },
        { role: "editMenu" },
        {
          label: "视图",
          submenu: [
            { role: "reload" },
            { role: "forceReload" },
            { role: "toggleDevTools" },
            { type: "separator" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { type: "separator" },
            { role: "togglefullscreen" },
          ],
        },
        { role: "windowMenu" },
        {
          role: "help",
          submenu: [
            {
              label: "GitHub 仓库",
              click: () => void shell.openExternal("https://github.com/greenfriends6688/pinkslab"),
            },
            {
              label: "打开数据目录",
              click: () => void shell.openPath(app.getPath("userData")),
            },
            { type: "separator" },
            {
              label: "显示窗口",
              click: showWindow,
            },
          ],
        },
      ]),
    );

    setupDesktopIpc();
    createWindow();
    setupTray();

    app.on("activate", () => {
      // macOS 上点击 Dock 图标时若无窗口则重建
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });
}

// macOS 上关闭全部窗口不退出应用
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    quitting = true;
    app.quit();
  }
});

app.on("before-quit", () => {
  quitting = true;
  if (keepAwakeId !== null) {
    powerSaveBlocker.stop(keepAwakeId);
    keepAwakeId = null;
  }
  if (serverProc && !serverProc.killed) serverProc.kill("SIGTERM");
});