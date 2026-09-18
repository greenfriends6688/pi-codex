/**
 * lib/perf-monitor.ts
 *
 * 用途：`?perf=1` 诊断开关（GAP-28 的新增部分）。URL 带 ?perf=1 时才激活，
 * 采集 Long Task（>50ms 的主线程阻塞）与 JS 堆内存，其余情况零开销、
 * 零监听，普通用户完全无感。
 *
 * 安全与性能边界：
 * - 只读 performance / PerformanceObserver，不读 cookie、storage 或任何
 *   用户数据，不上报网络，快照只留在内存里供诊断面板拉取；
 * - 无 window（服务端渲染/单测）时安全降级为 noop，绝不抛异常；
 * - 只保留三个数字计数器，不存逐条 entry，诊断本身零泄漏；
 * - PerformanceObserver 构造/observe 全程 try/catch：不支持 longtask
 *   的浏览器直接退化为“激活但无数据”，不影响业务。
 */

export interface PerfSnapshot {
  /** 是否处于 ?perf=1 激活态。 */
  active: boolean;
  /** 记录到的 Long Task 数量。 */
  longTasks: number;
  /** Long Task 累计阻塞毫秒数。 */
  totalBlockedMs: number;
  /** 单个最长的 Long Task 毫秒数。 */
  maxTaskMs: number;
  /** JS 堆已用 MB（仅 Chromium 系有 performance.memory，无则缺席）。 */
  memoryUsedMB?: number;
  /** JS 堆上限 MB（同上）。 */
  memoryLimitMB?: number;
}

interface PerfState {
  active: boolean;
  observer: { disconnect: () => void } | null;
  longTasks: number;
  totalBlockedMs: number;
  maxTaskMs: number;
}

const state: PerfState = {
  active: false,
  observer: null,
  longTasks: 0,
  totalBlockedMs: 0,
  maxTaskMs: 0,
};

function hasPerfFlag(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const search = window.location?.search;
    if (typeof search !== "string" || !search) return false;
    return new URLSearchParams(search).get("perf") === "1";
  } catch {
    return false;
  }
}

function stopObserver(): void {
  if (state.observer) {
    try {
      state.observer.disconnect();
    } catch {
      // 断开失败不影响业务，直接丢弃句柄。
    }
    state.observer = null;
  }
}

/**
 * 按当前 URL 决定是否激活。幂等：重复调用不会叠加监听。
 * 返回清理函数（断开 Long Task 监听并重置计数），调用方在用完后执行。
 */
export function initPerfMonitor(): () => void {
  stopObserver();
  state.longTasks = 0;
  state.totalBlockedMs = 0;
  state.maxTaskMs = 0;
  state.active = hasPerfFlag();
  if (!state.active) return () => {};

  try {
    const Observer = (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver;
    if (typeof Observer !== "function") return () => {};
    const observer = new (Observer as new (
      callback: (list: { getEntries: () => Array<{ duration?: number }> }) => void,
    ) => { observe: (options: { entryTypes: string[] }) => void; disconnect: () => void })((list) => {
      try {
        for (const entry of list.getEntries()) {
          const duration = typeof entry.duration === "number" ? entry.duration : 0;
          state.longTasks += 1;
          state.totalBlockedMs += duration;
          if (duration > state.maxTaskMs) state.maxTaskMs = duration;
        }
      } catch {
        // 回调里绝不抛：观察器异常不能影响被观测的页面。
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
    state.observer = observer;
  } catch {
    // 不支持 longtask 的环境：保持激活态但无数据，由快照如实反映。
    state.observer = null;
  }
  return () => {
    stopObserver();
  };
}

/** 供诊断面板轮询的当前快照；未激活时返回零值快照，绝不抛异常。 */
export function getPerfSnapshot(): PerfSnapshot {
  const snapshot: PerfSnapshot = {
    active: state.active,
    longTasks: state.active ? state.longTasks : 0,
    totalBlockedMs: state.active ? state.totalBlockedMs : 0,
    maxTaskMs: state.active ? state.maxTaskMs : 0,
  };
  if (!state.active) return snapshot;
  try {
    const performanceLike = (globalThis as {
      performance?: { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number } };
    }).performance;
    const memory = performanceLike?.memory;
    if (memory && typeof memory.usedJSHeapSize === "number") {
      snapshot.memoryUsedMB = memory.usedJSHeapSize / 1024 / 1024;
      if (typeof memory.jsHeapSizeLimit === "number") {
        snapshot.memoryLimitMB = memory.jsHeapSizeLimit / 1024 / 1024;
      }
    }
  } catch {
    // 内存读不到就缺席，不影响其它字段。
  }
  return snapshot;
}

/** 单测/诊断面板手动清零计数（不改变激活态）。 */
export function resetPerfSnapshot(): void {
  state.longTasks = 0;
  state.totalBlockedMs = 0;
  state.maxTaskMs = 0;
}
