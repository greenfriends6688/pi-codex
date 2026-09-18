import { NextResponse } from "next/server";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import { MEMORY_DIR_NAME, PI_MEMORY_FILES } from "@/lib/pi-memory";
import { shouldInviteMemoryRefresh, type MemoryRefreshState } from "@/lib/memory-refresh";

export const dynamic = "force-dynamic";

// fork:fix-memory-refresh — 记忆周检邀请的服务端接口。
//
//   GET  /api/memory/refresh -> { invite, daysSinceTidied, reason }
//   POST /api/memory/refresh { action: "invited" | "tidied" } -> 记录冷却状态
//
// 原则（与 lib/memory-refresh.ts 相同）：只判定、只邀请、**绝不自动写记忆**。
// 客户端在前台会话加载后懒调一次 GET；自动化/cron/委派运行不经过这条路，
// 天然不会触发。

const STATE_FILE = "memory-refresh.json";

function statePath(): string {
  return join(getAgentDir(), STATE_FILE);
}

function readState(): MemoryRefreshState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), "utf8")) as MemoryRefreshState;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** 最新的会话文件 mtime。记忆目录是 agent 级全局的，所以扫全部项目目录。 */
function latestSessionMtime(): number | undefined {
  const sessionsDir = join(getAgentDir(), "sessions");
  if (!existsSync(sessionsDir)) return undefined;
  let newest: number | undefined;
  try {
    for (const project of readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const projectDir = join(sessionsDir, project.name);
      for (const entry of readdirSync(projectDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const mtime = statSync(join(projectDir, entry.name)).mtimeMs;
        if (newest == null || mtime > newest) newest = mtime;
      }
    }
  } catch {
    return newest;
  }
  return newest;
}

/** MEMORY.md 的 mtime：它是长期记忆的主文件，把它的修改时间当作"上次整理"。 */
function memoryTidiedMtime(): number | undefined {
  const memoryFile = join(getAgentDir(), MEMORY_DIR_NAME, PI_MEMORY_FILES[0]);
  try {
    return statSync(memoryFile).mtimeMs;
  } catch {
    return undefined;
  }
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const decision = shouldInviteMemoryRefresh({
    state: readState(),
    latestSessionAt: latestSessionMtime(),
    memoryTidiedAt: memoryTidiedMtime(),
  });
  return NextResponse.json(decision);
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  const body = await req.json().catch(() => null) as { action?: unknown } | null;
  const action = body?.action;
  if (action !== "invited" && action !== "tidied") {
    return NextResponse.json({ error: "action must be \"invited\" or \"tidied\"" }, { status: 400 });
  }

  const state = readState();
  const now = new Date().toISOString();
  if (action === "invited") state.lastInviteAt = now;
  if (action === "tidied") state.lastTidiedAt = now;
  try {
    writePrivateFileAtomicSync(statePath(), JSON.stringify(state, null, 2));
  } catch (error) {
    // 冷却状态写不进去只影响"少提醒"，不应当把请求报成失败。
    console.warn("[pi-web] failed to persist memory-refresh state:", error instanceof Error ? error.message : error);
  }
  return NextResponse.json({ ok: true, state });
}
