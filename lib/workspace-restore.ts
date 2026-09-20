/**
 * fork:workspace-restore — 切回某个工作区时该打开什么。
 *
 * 之前的逻辑只有一条：读 `pi-web:last-open-by-workspace` 里记的会话 id，找到就打开，
 * 找不到就什么都不做 —— 于是「没打开过任何会话的工作区」切过去永远是空白页。
 * 这里把优先级补齐（REF 的 workspace-restore 同款，但 key 用本仓库的 projectKey）：
 *
 *   1. 记忆的会话（且**仍属于这个工作区**）
 *   2. 该工作区**最近修改**的会话
 *   3. 新草稿
 *
 * 纯函数，方便单测；调用方负责真正的打开动作。
 */

export interface RestoreSessionCandidate {
  id: string;
  modified?: string;
  /** `workspaceKeyOf` 接受的最小形状：cwd 必填（服务端会话信息一定有）。 */
  cwd: string;
  projectRoot?: string | null;
  projectKey?: string | null;
}

export type RestoreTarget =
  | { kind: "remembered"; sessionId: string }
  | { kind: "newest"; sessionId: string }
  | { kind: "new-draft" };

export function resolveRestoreTarget(input: {
  rememberedSessionId: string | null;
  sessions: readonly RestoreSessionCandidate[];
  workspaceKey: string;
  /** 会话 → 工作区 key（调用方传 `workspaceKeyOf`，避免这里复制一份身份规则）。 */
  keyOf: (session: RestoreSessionCandidate) => string;
}): RestoreTarget {
  const { rememberedSessionId, sessions, workspaceKey, keyOf } = input;
  const inWorkspace = sessions.filter((session) => keyOf(session) === workspaceKey);

  if (rememberedSessionId) {
    const remembered = inWorkspace.find((session) => session.id === rememberedSessionId);
    if (remembered) return { kind: "remembered", sessionId: remembered.id };
  }

  // 「最近修改」按 modified 降序取第一条；缺时间戳的排在后面（与侧栏的排序口径一致）。
  let newest: RestoreSessionCandidate | null = null;
  for (const session of inWorkspace) {
    if (!newest) {
      newest = session;
      continue;
    }
    const a = Date.parse(session.modified ?? "") || 0;
    const b = Date.parse(newest.modified ?? "") || 0;
    if (a > b) newest = session;
  }
  if (newest) return { kind: "newest", sessionId: newest.id };

  return { kind: "new-draft" };
}
