"use strict";

// pi-web 桌面壳（macOS）：在 Electron 里托管 Next.js 服务（next start），
// 复用 bin/pi-web.js 的启动方式，用 Electron 自身二进制（ELECTRON_RUN_AS_NODE=1）
// 当作 Node 来跑 next 的 CLI，避免依赖系统 Node。

// 宿主 shell（pi / 类 agent 环境）会注入这两个变量，会让 Electron 以纯 Node 模式
// 启动导致无窗口退出，这里必须清除，保证 app 本体正常进入 Electron 主流程。
delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_RUNNING;

const { app, BrowserWindow, Menu, Tray, shell, dialog } = require("electron");
const { spawn } = require("node:child_process");
const { createServer } = require("node:net");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const APP_NAME = "pi-web";
let mainWindow = null;
let tray = null;
let serverProc = null;
let serverPort = null;
let quitting = false;

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
      "pi-web 启动失败",
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
        "pi-web 服务已退出",
        "Next.js 本地服务异常退出，应用将关闭。可重新打开应用重试。",
      );
      app.quit();
    }
  });

  serverPort = port;
  console.log(`[pi-web] Next.js 服务启动: http://127.0.0.1:${port} (dev=${useDevServer})`);
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

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    title: APP_NAME,
    // macOS 保留原生交通灯 + 原生全屏，隐藏标题栏；不要用 frame:false
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: "#0f1117",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.on("close", () => {
    mainWindow = null;
  });

  // 外部链接一律交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  const url = `http://127.0.0.1:${serverPort}`;
  mainWindow.loadURL(url);
  return mainWindow;
}

function showWindow() {
  const win = createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function setupTray() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "trayTemplate.png")
    : path.join(getAppRoot(), "build", "trayTemplate.png");
  if (!fs.existsSync(iconPath)) return;

  tray = new Tray(iconPath);
  tray.setToolTip(APP_NAME);
  tray.setTemplateImage(true); // 菜单栏图标：单色黑 + alpha
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

// ── 应用生命周期 ────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", showWindow);

  app.whenReady().then(async () => {
    const appRoot = getAppRoot();
    if (!fs.existsSync(path.join(appRoot, ".next"))) {
      dialog.showErrorBox(
        "pi-web 缺少构建产物",
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

    // 角色化菜单：Cmd+Q/W/M/H 等快捷键自动生效
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: "appMenu" },
        { role: "fileMenu" },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ]),
    );

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
  if (serverProc && !serverProc.killed) serverProc.kill("SIGTERM");
});