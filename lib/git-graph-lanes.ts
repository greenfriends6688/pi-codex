/**
 * fork:git-graph — Git 图谱的车道状态机（纯函数，可在 Node 里单测）。
 *
 * 移植自已验证的原型（.myLastChat/git_graph_charstream_demo.html，思路同
 * vscode-git-graph）：行只提供 hash/父链接，机器推导列（lane）与边几何。规则：
 * - commit 落到第一个「pending parent 等于它」的车道；同一 hash 的重复
 *   pending 车道全部释放；
 * - 首个 parent 继承 commit 所在车道；额外 parent 向右开新车道（分支边）；
 * - root commit 释放自己的车道；
 * - `compact` 回收已释放车道（产品默认），`faithful` 只向右长、不回收
 *   （对齐 git 终端的字符画输出，保留用于对照与测试）。
 *
 * 颜色只返回调色板下标，由组件映射到主题派生色板（git-graph-palette.ts）。
 */

import type { GitLogCommit } from "./git-graph-parser";

export type GitGraphEdgeKind = "straight" | "branch" | "merge";

export interface GitGraphNode {
  hash: string;
  row: number;
  lane: number;
  colorIndex: number;
}

export interface GitGraphEdge {
  fromRow: number;
  fromLane: number;
  toRow: number;
  toLane: number;
  colorIndex: number;
  kind: GitGraphEdgeKind;
}

export interface GitGraphLayout {
  nodes: GitGraphNode[];
  edges: GitGraphEdge[];
  laneCount: number;
}

export function buildGitGraphLayout(commits: GitLogCommit[], strategy: "compact" | "faithful" = "compact"): GitGraphLayout {
  const lanes: (string | null)[] = []; // lane -> 等待被画出的 parent hash
  const laneColors: number[] = [];
  const nodes: GitGraphNode[] = [];
  const byHash = new Map<string, GitGraphNode>();
  const edgeRecords: { fromHash: string; toHash: string; colorIndex: number; kind?: GitGraphEdgeKind }[] = [];
  const freeLanes: number[] = []; // compact 策略的车道回收池
  let maxLane = 0;
  let colorCursor = 0;

  const nextColorIndex = () => colorCursor++;
  const alloc = (): number => {
    if (strategy === "compact" && freeLanes.length > 0) {
      const lane = freeLanes.shift()!;
      laneColors[lane] = nextColorIndex();
      return lane;
    }
    laneColors[maxLane] = nextColorIndex();
    return maxLane++;
  };
  const release = (lane: number) => {
    lanes[lane] = null;
    if (strategy === "compact" && !freeLanes.includes(lane)) freeLanes.push(lane);
  };

  commits.forEach((commit, row) => {
    let lane = lanes.indexOf(commit.hash);
    if (lane < 0) {
      // 防御：窗口在分叉中途被截断时，pending 项可能不在本批数据里。
      lane = alloc();
    } else {
      // 同一 hash 可能有多个 pending 车道（octopus merge 后收敛），清掉重复项。
      for (let i = lane + 1; i < lanes.length; i++) {
        if (lanes[i] === commit.hash) release(i);
      }
    }
    lanes[lane] = null;
    const node: GitGraphNode = { hash: commit.hash, row, lane, colorIndex: laneColors[lane] };
    nodes.push(node);
    byHash.set(commit.hash, node);

    commit.parents.forEach((parent, index) => {
      const colorIndex = index === 0 ? laneColors[lane] : nextColorIndex();
      if (index > 0 && lanes.indexOf(parent) < 0) {
        const newLane = alloc();
        lanes[newLane] = parent;
        edgeRecords.push({ fromHash: commit.hash, toHash: parent, colorIndex: laneColors[newLane], kind: "branch" });
      } else {
        if (index === 0) lanes[lane] = parent; // 首个 parent 继承当前车道
        edgeRecords.push({ fromHash: commit.hash, toHash: parent, colorIndex });
      }
    });

    if (commit.parents.length === 0) release(lane); // root 不再占车道
  });

  // 边解析成几何：指向窗口外（被截断）的 parent 没有目标节点，直接丢弃，
  // 这样「只显示前 N 条」时不会画出悬空线。
  const edges: GitGraphEdge[] = [];
  for (const record of edgeRecords) {
    const from = byHash.get(record.fromHash);
    const to = byHash.get(record.toHash);
    if (!from || !to) continue;
    edges.push({
      fromRow: from.row,
      fromLane: from.lane,
      toRow: to.row,
      toLane: to.lane,
      colorIndex: record.colorIndex,
      kind: record.kind ?? (from.lane === to.lane ? "straight" : "merge"),
    });
  }

  return { nodes, edges, laneCount: maxLane };
}
