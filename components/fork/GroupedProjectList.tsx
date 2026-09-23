"use client";

/**
 * fork:zc-11 + fork:zm-06 — 侧栏项目列表的「用户分组 + 拖拽排序」渲染层。
 *
 * WHY：项目行原来直接 `visibleProjects.map(...)` 平铺；用户要把项目归到自建分组里、
 * 并手动调整顺序。这个组件把分组表（`lib/session-groups.ts`）翻译成可拖拽的 DOM：
 *
 * - 分组行可折叠、可改名、可删除；空分组保留，作为拖拽落点；
 * - 拖拽源是**项目标题行本身**（通过 `useProjectDrag` 注入 `draggable` 与事件），
 *   不是整个项目节点 —— 展开的会话列表里选择文字不会误触发排序；
 * - 拖到另一个项目行上 = 排到它前面并跟随它所在的分组；拖到分组头上 = 加入该组；
 *   拖到底部的「移出分组」区 = 回到未分组；
 * - 每次重排 / 折叠后，用 `lib/flip-animate.ts` 做 FLIP：元素从旧位置飞到新位置，
 *   而不是瞬移（fork:zm-06）。reduced-motion / SSR / jsdom 下整体跳过。
 *
 * 输入数据是 `RecentProject` 形状的最小约束（`{ key }`），排序/分组全部由纯函数完成，
 * 组件本身不读 localStorage（store 由 SessionSidebar 传入），便于测试与复用。
 *
 * 视觉沿用 SessionSidebar 的内联样式 + CSS 变量 + `TEXT`，不引入 Tailwind。
 */

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { TEXT } from "@/lib/typography";
import { useI18n } from "@/hooks/useI18n";
import { animateFlip, diffFlip, type ElementRect, type FlipSnapshot } from "@/lib/flip-animate";
import {
  groupProjects,
  type SessionGroup,
  type SessionGroupsStore,
} from "@/lib/session-groups";

export interface GroupedProjectListProps<T extends { key: string }> {
  /** 项目列表（默认顺序由调用方给，组件按存储的 order 重排）。 */
  projects: readonly T[];
  /** `useSessionGroups()` 返回的 store（state + actions）。 */
  store: SessionGroupsStore;
  /** 单个项目的完整节点（含自身展开的会话列表），由 SessionSidebar 提供。 */
  renderProject: (project: T) => ReactNode;
}

const ROW_HEIGHT = 28;

interface ProjectDragContextValue {
  draggingKey: string | null;
  dropKey: string | null;
  begin: (event: React.DragEvent, projectKey: string) => void;
  end: () => void;
}

const ProjectDragContext = createContext<ProjectDragContextValue | null>(null);

export interface ProjectDragHandle {
  draggable: boolean;
  dragging: boolean;
  dropActive: boolean;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
}

/**
 * fork:zc-11 — 项目标题行用的拖拽句柄。
 *
 * 只有渲染在 `GroupedProjectList` 内的项目标题行会拿到真实句柄（来自 context）；
 * 其它上下文（单测、复用）返回禁用态，组件不需要自己判断是否存在分组列表。
 */
export function useProjectDrag(projectKey: string): ProjectDragHandle {
  const context = useContext(ProjectDragContext);
  if (!context) {
    return { draggable: false, dragging: false, dropActive: false, onDragStart: () => {}, onDragEnd: () => {} };
  }
  return {
    draggable: true,
    dragging: context.draggingKey === projectKey,
    dropActive: context.dropKey === projectKey,
    onDragStart: (event: React.DragEvent) => context.begin(event, projectKey),
    onDragEnd: context.end,
  };
}

export function GroupedProjectList<T extends { key: string }>({
  projects,
  store,
  renderProject,
}: GroupedProjectListProps<T>) {
  const { t } = useI18n();
  const sections = useMemo(() => groupProjects(projects, store.state), [projects, store.state]);

  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [dropGroupId, setDropGroupId] = useState<string | null>(null);
  const [ungroupDropActive, setUngroupDropActive] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  /* ------------------------------------------------------------------ */
  /* fork:zm-06 — FLIP：每次提交后对比矩形，元素飞向新位置。               */
  /* ------------------------------------------------------------------ */

  const flipNodesRef = useRef(new Map<string, HTMLElement>());
  const listRootRef = useRef<HTMLDivElement | null>(null);
  const previousRectsRef = useRef<FlipSnapshot | null>(null);
  const flipAnimationsRef = useRef<Animation[]>([]);

  const registerFlipNode = useCallback((key: string) => (node: HTMLElement | null) => {
    if (node) flipNodesRef.current.set(key, node);
    else flipNodesRef.current.delete(key);
  }, []);

  useLayoutEffect(() => {
    // 动画飞行途中不重新测量：getBoundingClientRect() 会包含当前 transform，
    // 用中间态做快照会让下一次计算从错误的位置起飞。
    if (flipAnimationsRef.current.some((animation) => animation.playState === "running")) return;
    // 以列表容器为原点：外层滚动（用户滚侧栏）不应被误判成「元素移动了」。
    const rootRect = listRootRef.current?.getBoundingClientRect();
    const originTop = rootRect?.top ?? 0;
    const originLeft = rootRect?.left ?? 0;
    const next = new Map<string, ElementRect>();
    flipNodesRef.current.forEach((element, key) => {
      if (!element.isConnected) return;
      const rect = element.getBoundingClientRect();
      next.set(key, {
        top: rect.top - originTop,
        left: rect.left - originLeft,
        width: rect.width,
        height: rect.height,
      });
    });
    const previous = previousRectsRef.current;
    if (previous) {
      const deltas = diffFlip(previous, next);
      if (deltas.length > 0) {
        flipAnimationsRef.current = animateFlip(deltas, (key) => flipNodesRef.current.get(key) ?? null);
      }
    }
    previousRectsRef.current = next;
  });

  const clearDragState = useCallback(() => {
    setDragKey(null);
    setDropKey(null);
    setDropGroupId(null);
    setUngroupDropActive(false);
  }, []);

  const sourceKeyOf = (event: React.DragEvent): string | null => {
    if (dragKey) return dragKey;
    try {
      return event.dataTransfer.getData("text/plain") || null;
    } catch {
      return null;
    }
  };

  const beginDrag = useCallback((event: React.DragEvent, projectKey: string) => {
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("text/plain", projectKey);
    } catch {
      // 某些浏览器在 dragstart 之外不暴露 dataTransfer；dragKey state 仍是兜底。
    }
    setDragKey(projectKey);
  }, []);

  const dragContext = useMemo<ProjectDragContextValue>(
    () => ({ draggingKey: dragKey, dropKey, begin: beginDrag, end: clearDragState }),
    [dragKey, dropKey, beginDrag, clearDragState],
  );

  const overProject = (projectKey: string) => {
    if (dropKey !== projectKey) setDropKey(projectKey);
    if (dropGroupId !== null) setDropGroupId(null);
  };

  const dropOnProject = (event: React.DragEvent, targetKey: string) => {
    event.preventDefault();
    const source = sourceKeyOf(event);
    const groupId = store.state.assignments[targetKey] ?? null;
    clearDragState();
    if (!source || source === targetKey) return;
    store.moveProject({ projectKey: source, beforeKey: targetKey, groupId });
  };

  const dropOnGroup = (event: React.DragEvent, groupId: string) => {
    event.preventDefault();
    const source = sourceKeyOf(event);
    clearDragState();
    if (!source) return;
    store.moveProject({ projectKey: source, beforeKey: null, groupId });
  };

  const dropOnUngrouped = (event: React.DragEvent) => {
    event.preventDefault();
    const source = sourceKeyOf(event);
    clearDragState();
    if (!source) return;
    store.moveProject({ projectKey: source, beforeKey: null, groupId: null });
  };


  const commitRename = (id: string) => {
    store.renameGroup(id, renameValue);
    setRenamingId(null);
  };

  const draggingGrouped = Boolean(dragKey && store.state.assignments[dragKey]);

  const renderProjectRow = (project: T) => (
    <div
      key={project.key}
      ref={registerFlipNode(`project:${project.key}`)}
      data-fork-project-row={project.key}
      onDragOver={(event) => {
        event.preventDefault();
        overProject(project.key);
      }}
      onDrop={(event) => dropOnProject(event, project.key)}
      style={{ borderRadius: "var(--zn-radius-row)" }}
    >
      {renderProject(project)}
    </div>
  );

  return (
    <ProjectDragContext.Provider value={dragContext}>
      <div ref={listRootRef} data-fork-grouped-projects="true" style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {sections.map((section) => {
          const group = section.group;
          if (!group) {
            return (
              <div key="__ungrouped" style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {section.projects.map(renderProjectRow)}
              </div>
            );
          }
          return (
            <div key={group.id} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <GroupHeader
                group={group}
                count={section.projects.length}
                dropActive={dropGroupId === group.id}
                renaming={renamingId === group.id}
                renameValue={renameValue}
                registerFlipNode={registerFlipNode}
                onRenameValue={setRenameValue}
                onToggle={() => store.toggleGroupCollapsed(group.id)}
                onBeginRename={() => {
                  setRenamingId(group.id);
                  setRenameValue(group.name);
                }}
                onCommitRename={() => commitRename(group.id)}
                onCancelRename={() => setRenamingId(null)}
                onDelete={() => store.deleteGroup(group.id)}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (dropGroupId !== group.id) setDropGroupId(group.id);
                  if (dropKey) setDropKey(null);
                }}
                onDrop={(event) => dropOnGroup(event, group.id)}
              />
              {!group.collapsed && section.projects.map(renderProjectRow)}
            </div>
          );
        })}

        {/* fork:zc-11 — 拖拽中的已分组项目需要一个「回到未分组」的落点；
            没有它，用户只能先拖出组再拖回来。 */}
        {draggingGrouped && (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              if (!ungroupDropActive) setUngroupDropActive(true);
            }}
            onDragLeave={() => setUngroupDropActive(false)}
            onDrop={dropOnUngrouped}
            style={{
              minHeight: ROW_HEIGHT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              margin: "2px 0",
              border: "1px dashed var(--border)",
              borderRadius: "var(--radius-md)",
              background: ungroupDropActive ? "var(--bg-selected)" : "transparent",
              color: ungroupDropActive ? "var(--text)" : "var(--text-dim)",
              fontSize: TEXT.sm,
              userSelect: "none",
            }}
          >
            {t("sidebar.ungroupHint")}
          </div>
        )}

      </div>
    </ProjectDragContext.Provider>
  );
}

const iconButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  padding: 0,
  flexShrink: 0,
  background: "transparent",
  border: "none",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-muted)",
  cursor: "pointer",
};

/** 分组头：折叠开关 + 名字（可改名）+ 数量 + 悬停操作（改名/删除），并作为拖拽落点。 */
function GroupHeader({
  group,
  count,
  dropActive,
  renaming,
  renameValue,
  registerFlipNode,
  onRenameValue,
  onToggle,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  onDragOver,
  onDrop,
}: {
  group: SessionGroup;
  count: number;
  dropActive: boolean;
  renaming: boolean;
  renameValue: string;
  registerFlipNode: (key: string) => (node: HTMLElement | null) => void;
  onRenameValue: (value: string) => void;
  onToggle: () => void;
  onBeginRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);

  if (renaming) {
    return (
      <div
        ref={registerFlipNode(`group:${group.id}`)}
        data-fork-group-header={group.id}
        onDragOver={onDragOver}
        onDrop={onDrop}
        style={{ display: "flex", alignItems: "center", gap: 4, height: ROW_HEIGHT, padding: "0 6px" }}
      >
        <input
          autoFocus
          value={renameValue}
          onChange={(event) => onRenameValue(event.target.value)}
          onBlur={onCommitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCommitRename();
            if (event.key === "Escape") onCancelRename();
          }}
          aria-label={t("sidebar.renameGroup")}
          style={{
            flex: 1,
            minWidth: 0,
            height: 24,
            padding: "0 8px",
            background: "var(--bg)",
            border: "1px solid var(--accent)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text)",
            fontSize: TEXT.sm,
            outline: "none",
          }}
        />
      </div>
    );
  }

  return (
    <div
      ref={registerFlipNode(`group:${group.id}`)}
      data-fork-group-header={group.id}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        height: ROW_HEIGHT,
        padding: "0 6px 0 4px",
        background: dropActive ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        borderRadius: "var(--radius-md)",
        color: "var(--text-muted)",
        fontSize: TEXT.sm,
        fontWeight: 600,
        userSelect: "none",
        transition: "background 0.12s",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!group.collapsed}
        title={t(group.collapsed ? "session.expandGroup" : "session.collapseGroup")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          flex: 1,
          minWidth: 0,
          height: "100%",
          padding: 0,
          background: "transparent",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          textAlign: "left",
          fontSize: "inherit",
          fontWeight: "inherit",
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            flexShrink: 0,
            // fork:zm-06 — 只动 transform（折叠即时生效，不做无谓的持续动画）。
            transform: group.collapsed ? "rotate(-90deg)" : "rotate(0deg)",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {group.name}
        </span>
      </button>
      <span style={{ flexShrink: 0, minWidth: 14, textAlign: "right", color: "var(--text-dim)", fontWeight: 400 }}>{count}</span>
      {(hovered || dropActive) && (
        <span style={{ display: "flex", gap: 2, flexShrink: 0 }}>
          <button type="button" onClick={onBeginRename} title={t("sidebar.renameGroup")} aria-label={t("sidebar.renameGroup")} style={iconButtonStyle}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </button>
          <button type="button" onClick={onDelete} title={t("sidebar.deleteGroup")} aria-label={t("sidebar.deleteGroup")} style={iconButtonStyle}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
          </button>
        </span>
      )}
    </div>
  );
}
