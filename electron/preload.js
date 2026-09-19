"use strict";

// pi codex desktop bridge.
//
// The renderer is the same web app the browser runs, so everything native is opt-in
// through this bridge (see lib/desktop-shell.ts). Nothing here exposes Node: only the
// handful of macOS integrations that make the packaged app feel like an app instead of
// a browser tab — native notifications, the Dock badge, keep-awake during a run, and a
// channel for main-process events (notification clicks).

const { contextBridge, ipcRenderer, webUtils } = require("electron");

const DESKTOP_ACTIONS = ["notification-clicked", "theme-changed", "open-session"];

contextBridge.exposeInMainWorld("piWebDesktop", {
  version: 1,
  platform: process.platform,
  /** Native notification; returns false when the main process refused to show one. */
  notify: (payload) => ipcRenderer.invoke("desktop:notify", payload),
  /** Dock badge text (null clears it). */
  setBadge: (text) => ipcRenderer.send("desktop:badge", text),
  /** Hold a power-save blocker while an agent run is active. */
  setKeepAwake: (active) => ipcRenderer.send("desktop:keep-awake", Boolean(active)),
  /** Open a URL in the user's browser. */
  openExternal: (url) => ipcRenderer.send("desktop:open-external", url),
  /** Ask the main process to reveal a path in Finder. */
  revealPath: (target) => ipcRenderer.send("desktop:reveal", target),
  /**
   * fork:gap07-attachments — real on-disk path of a dropped File.
   *
   * Browsers deliberately hide it; Electron exposes it through webUtils. Composer
   * attachments use it to reference an oversized file in place instead of uploading
   * (or dropping) it. Returns null when Electron refuses the object, which is the
   * signal for the renderer to fall back to uploading.
   */
  filePathFor: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
  onAction: (callback) => {
    const listener = (_event, action) => {
      if (!action || !DESKTOP_ACTIONS.includes(action.kind)) return;
      callback(action);
    };
    ipcRenderer.on("desktop:action", listener);
    return () => ipcRenderer.removeListener("desktop:action", listener);
  },
});
