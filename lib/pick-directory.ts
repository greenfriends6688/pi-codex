/**
 * fork:ui-pick-directory — 选一个目录：**优先系统原生选择器**。
 *
 * 桌面版（Electron）走 `POST /api/cwd/pick`，服务端拉起系统对话框；浏览器里没有这个能力，
 * 退到 File System Access API 的 `showDirectoryPicker()`。两条都不行就返回 null，
 * 由调用方决定回退（例如让用户手输路径）。
 */
export async function pickDirectory(): Promise<string | null> {
  // 1) 服务端原生选框（桌面版）。
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 65_000);
    const res = await fetch("/api/cwd/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json() as { cwd?: unknown };
      if (typeof data.cwd === "string" && data.cwd) return data.cwd;
    }
  } catch {
    // 远程访问 / 不支持的平台：继续往下试
  }

  // 2) 浏览器目录选择器（Chrome 系）。注意它只给目录名，拿不到绝对路径，
  //    所以只作为「提示用户去手输」的兜底信号 —— 返回 null 让调用方处理。
  return null;
}
