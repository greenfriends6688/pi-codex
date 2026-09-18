import { watch, type FSWatcher } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { isApiRequestAllowed } from "@/lib/request-security";
import { shouldIgnoreWatchPath } from "@/lib/file-watch-filter";

export const dynamic = "force-dynamic";

/**
 * fork:fix-tree-watch — 目录级变更订阅（SSE）。
 *
 * 为什么需要它：`components/FileExplorer.tsx` 的刷新完全靠父级 `refreshKey` 自上而下重取，
 * 组件从未订阅任何事件流，所以外部（agent 写文件、别的终端、编辑器）改动后文件树不会自己更新。
 * 原有的 `?type=watch` 只监听**单个文件**（供编辑器检测外部改写），不覆盖目录列表。
 *
 * 设计取舍：
 *   - 复用 `/api/files` 同一套 allow-list（`isExistingFilePathAllowed`），不做新的可见性规则；
 *   - `fs.watch(..., { recursive: true })` 在 macOS/Windows 与 Node 20+ 的 Linux 可用；
 *     不支持时降级为非递归监听（只报顶层变化，仍然可用）；
 *   - 噪声路径（`node_modules` / `.git` / `.next` / 构建产物 / 编辑器临时文件）直接丢弃，
 *     否则大仓里一次 `npm install` 就能把 SSE 打满；
 *   - 事件按 250ms 去抖后合并成一次 `change`，把路径列表给客户端，
 *     让客户端自己决定重取哪些已展开目录。
 */

const DEBOUNCE_MS = 250;

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return new Response(JSON.stringify({ error: "Untrusted API request" }), { status: 403 });
  }
  const url = new URL(req.url);
  const requested = url.searchParams.get("path");
  if (!requested) {
    return new Response(JSON.stringify({ error: "path is required" }), { status: 400 });
  }

  const target = resolve(requested);
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(target, allowedRoots)) {
    return new Response(JSON.stringify({ error: "Access denied" }), { status: 403 });
  }

  const encoder = new TextEncoder();
  let watcher: FSWatcher | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const pending = new Set<string>();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (eventName: string, data: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // 客户端已断开
        }
      };

      const flush = () => {
        debounce = null;
        if (pending.size === 0) return;
        const paths = [...pending].slice(0, 200);
        pending.clear();
        send("change", { paths });
      };

      const onEvent = (_eventType: string, filename: string | Buffer | null) => {
        const name = filename == null ? null : filename.toString();
        if (shouldIgnoreWatchPath(name)) return;
        pending.add(name ? join(target, name) : target);
        if (debounce) return;
        debounce = setTimeout(flush, DEBOUNCE_MS);
      };

      try {
        watcher = watch(target, { recursive: true }, onEvent);
      } catch {
        // 平台不支持递归：降级为只盯顶层，仍然能覆盖绝大多数“新建/删除直接子项”的场景。
        try {
          watcher = watch(target, onEvent);
          send("degraded", { recursive: false });
        } catch {
          send("error", { message: "Failed to watch directory" });
          try { controller.close(); } catch { /* ignore */ }
          return;
        }
      }

      watcher.on("error", () => {
        try { watcher?.close(); } catch { /* ignore */ }
        watcher = null;
        send("error", { message: "Watcher failed" });
        try { controller.close(); } catch { /* ignore */ }
      });

      // 客户端收到 connected 后再做首次拉取，避免“订阅建立前的改动”被漏掉。
      send("connected", { path: target, name: basename(target), separator: sep });
    },
    cancel() {
      closed = true;
      if (debounce) clearTimeout(debounce);
      try { watcher?.close(); } catch { /* ignore */ }
      watcher = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
