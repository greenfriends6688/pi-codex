import { NextRequest, NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath, invalidateSessionListCache } from "@/lib/session-reader";
import { rewindSessionFile } from "@/lib/session-rewind";

/**
 * fork:proma-04-rewind — POST /api/sessions/[id]/rewind  { entryId }
 *
 * 「回退到此处」：把会话截断到这条记录（**含**该条），之后的对话消失。
 *
 * 三条纪律（都来自本仓已记录的坑）：
 *
 * 1. **运行中拒绝**：agent 正在跑时截断它自己的会话文件，等于把手伸进别人的写操作里。
 *    返回 409 + 可读原因（而不是 500）—— 这是最常见的拒绝路径，UI 要能直接显示。
 * 2. **先销毁 wrapper**：AGENTS.md「Fork must destroy the wrapper immediately」同样适用于回退。
 *    wrapper 缓存着文件和内存态；截断后必须让它下次重建，否则后续请求拿到的是被截断前的脏状态。
 * 3. **文件改动不回退**：与 Proma 的 rewind 契约一致（`filesReverted: false` 会跟着回执返回），
 *    避免用户以为磁盘上的改动也被撤销了。
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { entryId?: unknown };
  try {
    body = await request.json() as { entryId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const entryId = typeof body.entryId === "string" ? body.entryId.trim() : "";
  if (!entryId) {
    return NextResponse.json({ error: "entryId is required" }, { status: 400 });
  }

  const live = getRpcSession(id);
  if (live?.isAlive() && live.isRunning()) {
    return NextResponse.json({
      error: "会话正在运行，先停止再回退",
      code: "rewind_rejected",
      reason: "running",
    }, { status: 409 });
  }

  const filePath = await resolveSessionPath(id);
  if (!filePath) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // 先销毁：截断之后再让它按需重建（否则内存里的文件句柄/状态还是旧的）
  live?.destroy();

  const result = rewindSessionFile(filePath, entryId);
  if (!result.ok) {
    // 拒绝路径给可读原因 + 机器可读的 reason（UI 按 reason 决定文案与是否给"刷新"入口）
    const status = result.reason === "entry-not-found" ? 404 : 409;
    return NextResponse.json({
      error: result.message,
      code: "rewind_rejected",
      reason: result.reason,
    }, { status });
  }

  invalidateSessionListCache();
  return NextResponse.json({
    success: true,
    data: {
      dropped: result.dropped,
      kept: result.kept,
      entryType: result.entryType,
      filesReverted: result.filesReverted,
    },
  });
}
