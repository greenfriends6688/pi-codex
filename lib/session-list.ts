import type { SessionInfo } from "@/lib/types";

/**
 * fork:session-list-cache — 会话列表的客户端共享缓存。
 *
 * 同一帧里 AppShell 的恢复流程、会话水合、侧栏刷新可能同时要列表：以前是三次
 * `/api/sessions`，服务端每次都要扫一遍会话目录。这里把并发调用合并到同一个
 * in-flight promise，并在需要时用 `?force=1` 绕过服务端缓存。
 *
 * 与 `lib/session-list-scanner.ts` 的分工：那个是**服务端**的列表级增量索引，
 * 这个只是**浏览器**侧的同帧去重，两者不冲突。
 */

export interface SessionListPayload {
  sessions: SessionInfo[];
  [key: string]: unknown;
}

let inflight: Promise<SessionListPayload | null> | null = null;

/** 读取会话列表；并发调用共享同一次请求。`force` 会带 `?force=1` 绕过服务端缓存。 */
export function loadSessionList(options: { force?: boolean } = {}): Promise<SessionListPayload | null> {
  if (inflight) return inflight;
  const url = options.force ? "/api/sessions?force=1" : "/api/sessions";
  const request = fetch(url, { cache: "no-store" })
    .then((response) => (response.ok ? (response.json() as Promise<SessionListPayload>) : null))
    .catch(() => null)
    .finally(() => {
      // 只有当前这次请求自己清空槽位，避免把后来者的 promise 一起清掉。
      if (inflight === request) inflight = null;
    });
  inflight = request;
  return request;
}

/** 本地改了会话（改名 / 删除 / 新建）后调用，让下一次读取重新走网络。 */
export function invalidateSessionList(): void {
  inflight = null;
}
