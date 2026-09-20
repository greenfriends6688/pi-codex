/**
 * fork:gap07-attachments — 附件的分类与「路径引用」降级。
 *
 * ## 为什么不是「把任意文件塞进消息」
 *
 * pi 的 prompt 内容块只有 `text` 与 `image` 两种，`lib/image-attachments.ts` 的
 * `validateAgentImages` 就是这条边界的守卫（非 image 直接拒绝）。所以图片以外的字节
 * **不可能**直接进上下文。真正可行的机制是：把文件落到磁盘、把路径写进消息，由 agent
 * 用自己的工具去读 —— 这也正是 `docs/proma-prs-2026-09-18.md` 里 GAP-07 写的
 * 「>100MB 且有源路径时降级为路径引用」的方向。
 *
 * ## 三类出口（全部显式，没有一条是静默丢弃）
 *
 * | 出口 | 条件 | 落地 |
 * | --- | --- | --- |
 * | `image` | `image/*` 且 ≤10MB（既有上限） | 现有内联图片管道 + 压缩，**保持不变** |
 * | `reference` | 其他文件，≤上传上限（或已有本地路径） | 上传到附件目录后插入 `@path` |
 * | `skipped` | 超限**且**拿不到本地路径 | 显式提示原因，用户可改走文件树 / `@` 引用 |
 *
 * 上限与上传路由（`app/api/files/[...path]/route.ts`）保持一致：每文件 25MB、单次合计
 * 100MB。这里不自行放宽 —— 上传是唯一会把字节写进磁盘的入口，它的封套不该被新功能顺手撑大。
 */

import { buildAtInsertText } from "./file-fuzzy";

/** 与上传路由的每文件上限一致。 */
export const MAX_ATTACHED_FILE_BYTES = 25 * 1024 * 1024;
/** 与上传路由的单次合计上限一致。 */
export const MAX_ATTACHED_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024;

export type AttachmentSkipReason = "too-large" | "no-path";

/** 只需要这几个字段，所以 `File` 与测试里的字面量都能直接传进来。 */
export interface AttachmentFileFacts {
  name: string;
  size: number;
  type?: string;
}

export interface AttachmentPlan {
  /** 需要上传到附件目录的（每文件与合计都在上限内）。 */
  upload: AttachmentFileFacts[];
  /** 超过上传上限、但拿到了本地路径 → 直接就地把路径写进消息，不复制字节。 */
  referenceInPlace: Array<{ file: AttachmentFileFacts; path: string }>;
  /** 既超限又没有本地路径 → 显式提示，绝不静默丢。 */
  skipped: Array<{ file: AttachmentFileFacts; reason: AttachmentSkipReason }>;
}

export interface AttachmentPlanOptions {
  /**
   * 该文件的本地绝对路径（桌面外壳可以给：`webUtils.getPathForFile`）。
   * 浏览器里返回 `null` —— 这正是「>25MB 在网页版只能提示」的原因。
   */
  pathOf?: (file: AttachmentFileFacts) => string | null | undefined;
  /** 本次还能上传多少字节（默认单次合计上限）。 */
  uploadBudgetBytes?: number;
}

/**
 * 把一批拖入/粘贴的文件分成「上传 / 就地引用 / 跳过」。
 *
 * 顺序敏感：合计预算按顺序消耗，所以先到先得；超预算但**有本地路径**的文件仍然能
 * 就地引用（路径没有大小上限），只有两条路都走不通才进 `skipped`。
 */
export function planAttachments(
  files: readonly AttachmentFileFacts[],
  options: AttachmentPlanOptions = {},
): AttachmentPlan {
  const budget = options.uploadBudgetBytes ?? MAX_ATTACHED_UPLOAD_TOTAL_BYTES;
  const plan: AttachmentPlan = { upload: [], referenceInPlace: [], skipped: [] };
  let remaining = Math.max(0, budget);

  for (const file of files) {
    const path = options.pathOf?.(file) ?? null;
    const withinPerFile = file.size <= MAX_ATTACHED_FILE_BYTES;
    if (withinPerFile && file.size <= remaining) {
      plan.upload.push(file);
      remaining -= file.size;
      continue;
    }
    if (path) {
      plan.referenceInPlace.push({ file, path });
      continue;
    }
    plan.skipped.push({ file, reason: "too-large" });
  }

  return plan;
}

/**
 * 上传时用的文件名：先做一次与路由同源的清洗（路由也会校验，这里只是尽早失败并给用户
 * 一个能看懂的原因）。返回 `null` 表示这个名字不可用。
 */
export function sanitizeAttachmentName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return null;
  if (trimmed.includes("\0")) return null;
  if (trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (trimmed.length > 200) return null;
  return trimmed;
}

/**
 * 附件目录里已经有同名文件时，换一个不冲突的名字（`report.csv` → `report-2.csv`）。
 *
 * 不用 `conflict=overwrite`：附件目录是同一天的暂存区，同名覆盖会让**旧消息里的引用
 * 指向新内容** —— 那种错误很难在事后发现。宁可多一次请求也不覆盖。
 */
export function nextAvailableAttachmentName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem}-${index}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now().toString(36)}${ext}`;
}

/**
 * 把本地路径变成消息里的引用文本，复用 `@` 文件菜单的插入规则：
 * `@path `（含空格时 `@"path" `）。
 */
/** 跨平台的取文件名（不能用 node:path：这段代码会打进浏览器包）。 */
function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/**
 * fork:ui — 附件插入的不再是完整路径，而是 `@文件名`。
 *
 * 原因：`@/Users/…/.pi/agent/attachments/2026-09-20/9201-9269-2.docx` 这种路径
 * 会把输入框整个撑爆，用户要求“输入框里只显文件名，发给 AI 时仍是路径”。
 * 发送前由 `expandAttachmentReferences()` 还原（见下）。
 */
export function buildAttachmentReference(path: string): { text: string; cursorOffset: number } {
  return buildAtInsertText(fileNameOf(path), false, false);
}

/**
 * 发送前把 `@文件名` 还原成 `@完整路径`。
 *
 * 只还原本次输入过程中插入过的附件（`paths`），不碰用户手打的其他 `@` 文本；
 * 同一文件名出现多次时全部替换（同一个附件被插了两次的情况）。
 */
export function expandAttachmentReferences(text: string, paths: readonly string[]): string {
  let out = text;
  for (const path of paths) {
    const token = `@${fileNameOf(path)}`;
    if (out.includes(token)) out = out.replaceAll(token, `@${path}`);
  }
  return out;
}

/** 提示条要展示的文案键：没有任何需要说明的出口时返回 `null`。 */
export type AttachmentNotice = "none" | "references" | "skipped";

export interface AttachmentOutcome {
  /** 成功变成内联图片的数量。 */
  images?: number;
  /** 成功插入引用的文件名。 */
  referenced: string[];
  /** 跳过的文件名与原因。 */
  skipped?: Array<{ name: string; reason: AttachmentSkipReason }>;
}

export function attachmentNotice(outcome: AttachmentOutcome): AttachmentNotice {
  if ((outcome.skipped?.length ?? 0) > 0) return "skipped";
  if (outcome.referenced.length > 0 || (outcome.images ?? 0) > 0) return "references";
  return "none";
}
