/**
 * fork:git-graph — 车道边到 SVG path 的共享几何（纯函数，可在 Node 里单测）。
 *
 * 车道状态机（git-graph-lanes.ts）刻意不碰几何；这里把边转成路径。
 * 图谱 tab（大常量、行高可变）与 `@comment:` 菜单的迷你图（紧凑行）
 * 都委托到这里，保证两种尺寸的连线形状一致。
 */

import type { GitGraphEdge } from "./git-graph-lanes";

export interface GitGraphEdgeGeometry {
  /** lane 下标 -> x 像素。 */
  laneX: (lane: number) => number;
  /** 行下标 -> 顶部 y 像素（累加；行高可以不同）。 */
  rowTops: number[];
  /** 行下标 -> 高度像素。 */
  rowHeight: (row: number) => number;
  /** 圆角上限像素（实际会按位移夹紧）。 */
  cornerRadius: number;
}

/**
 * 单条车道边的 SVG path。同车道是直线；跨车道是圆角拐弯：
 * - branch（子提交向右开新车道）：先水平出、再垂直入 parent；
 * - merge（子提交车道折回 parent 车道）：先垂直出、再水平入 parent。
 */
export function gitGraphEdgePath(edge: GitGraphEdge, g: GitGraphEdgeGeometry): string {
  const x1 = g.laneX(edge.fromLane);
  const y1 = g.rowTops[edge.fromRow] + g.rowHeight(edge.fromRow) / 2;
  const x2 = g.laneX(edge.toLane);
  const y2 = g.rowTops[edge.toRow] + g.rowHeight(edge.toRow) / 2;
  if (edge.fromLane === edge.toLane) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  const dx = x2 > x1 ? 1 : -1;
  const sy = y2 > y1 ? 1 : -1;
  // 圆角不能超过两端位移的一半，否则圆弧会把整条边吃掉。
  const r = Math.min(g.cornerRadius, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2);
  if (edge.kind === "branch") {
    // 从子提交水平出去，圆角后垂直进入 parent。
    return `M ${x1} ${y1} L ${x2 - dx * r} ${y1} Q ${x2} ${y1} ${x2} ${y1 + sy * r} L ${x2} ${y2}`;
  }
  // merge：先从子提交车道垂直出去，再圆角水平进入 parent 车道。
  return `M ${x1} ${y1} L ${x1} ${y2 - sy * r} Q ${x1} ${y2} ${x1 + dx * r} ${y2} L ${x2} ${y2}`;
}
