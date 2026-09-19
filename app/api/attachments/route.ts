import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { allowFileRoot } from "@/lib/file-access";
import { isApiRequestAllowed } from "@/lib/request-security";

/**
 * fork:gap07-attachments — composer 附件的落盘目录。
 *
 * 为什么需要这个路由：任意文件的字节**没法**直接进消息（pi 的 prompt 内容块只有
 * `text` 与 `image`，见 `lib/image-attachments.ts` 的 `validateAgentImages`），所以
 * 「加附件」在本仓只能是「落到磁盘 + 把路径写进消息」。既有上传路由
 * （`app/api/files/[...path]/route.ts` 的 POST）已经能写、有 25MB/文件与 100MB/单次
 * 的封套、有冲突策略，但它要求**目标目录必须在允许根内**——而允许根来自会话 cwd、
 * 项目根这些用户仓库位置，往用户仓库里随手写附件是不能接受的。
 *
 * 所以这里只做一件事：给出一个专用的、位于 pi agent 目录下的附件目录，并把它登记为
 * 允许根。字节仍然走既有的上传路由（不新开写通道），冲突仍然由它判定。
 *
 * 目录按天分桶（`<agentDir>/attachments/YYYY-MM-DD/`）：既是暂存区，也好清理，
 * 而且不会在一个目录里堆成千上万个文件。
 *
 * GET /api/attachments → { dir }
 */
export const dynamic = "force-dynamic";

export function attachmentsDirectory(now: Date = new Date()): string {
  const day = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return join(getAgentDir(), "attachments", day);
}

export async function GET(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  try {
    const dir = attachmentsDirectory();
    fs.mkdirSync(dir, { recursive: true });
    // 登记为允许根：上传路由会用同一个允许根集合校验写入目标，文件树/预览也才能读回。
    allowFileRoot(dir);
    return NextResponse.json({ dir });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
