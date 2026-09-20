import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "@/lib/file-access";
import { getGitCommitFiles, getGitLog } from "@/lib/git-graph";
import { isApiRequestAllowed } from "@/lib/request-security";

/**
 * fork:git-graph — Git 图谱数据接口（PR-07）。
 *
 * 鉴权沿用本仓库既有做法，不引入 REF 的 request-security：
 * 1. `isApiRequestAllowed` 挡跨站浏览器请求（Host / Origin / Fetch Metadata）；
 * 2. `getAllowedFileRoots` + `isFilePathAllowed` 做 allowed-roots 词法校验，
 *    再用 `isExistingFilePathAllowed` 解析软链后复核，越权 cwd 一律 403。
 *
 * `force-dynamic`：响应取决于 query 与仓库实时状态，不能被 Next 静态化。
 */

export const dynamic = "force-dynamic";

const DEFAULT_LOG_LIMIT = 400;
const MAX_LOG_LIMIT = 2000;

export async function GET(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(cwd);
    } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }
    // 目录存在后再解析软链复核一次，避免 allowed 根下的软链指向根外。
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const commit = request.nextUrl.searchParams.get("commit")?.trim();
    if (commit) {
      return NextResponse.json(await getGitCommitFiles(cwd, commit));
    }

    const parsedLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), MAX_LOG_LIMIT)
      : DEFAULT_LOG_LIMIT;
    return NextResponse.json(await getGitLog(cwd, limit));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
