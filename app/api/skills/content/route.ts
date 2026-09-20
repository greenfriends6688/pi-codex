import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * fork:skills-content — 读写单个 SKILL.md。
 *
 * 设置里的技能页原来只显示 name / description（都来自 frontmatter），正文要另外去文件
 * 浏览器里找，而且全局技能目录（~/.pi/agent/skills、~/.agents/skills）根本不在
 * `/api/files` 的允许根里。这里用与 `/api/skills` PATCH 完全相同的一套根校验，
 * 让「看到正文 + 就地编辑」成立，且不放开任何别的目录。
 */

/** 技能文件允许的根：会话可访问根 + agent 目录 + 全局技能目录（与 PATCH 一致）。 */
async function isSkillFileAllowed(filePath: string): Promise<boolean> {
  const allowedRoots = new Set(await getAllowedFileRoots());
  allowedRoots.add(getAgentDir());
  const globalSkillsDir = path.join(homedir(), ".agents", "skills");
  if (existsSync(globalSkillsDir)) allowedRoots.add(globalSkillsDir);
  return isExistingFilePathAllowed(filePath, allowedRoots);
}

function readFilePath(request: Request): string | null {
  const filePath = new URL(request.url).searchParams.get("filePath");
  return filePath && filePath.length > 0 ? filePath : null;
}

export async function GET(request: Request) {
  const filePath = readFilePath(request);
  if (!filePath) return NextResponse.json({ error: "filePath required" }, { status: 400 });
  if (!existsSync(filePath)) return NextResponse.json({ error: "file not found" }, { status: 404 });
  if (!(await isSkillFileAllowed(filePath))) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    return NextResponse.json(
      { content: readFileSync(filePath, "utf8") },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** 单次编辑的上限：SKILL.md 是提示词，正常几 KB；这个值只防「贴错文件」。 */
const MAX_SKILL_CONTENT_BYTES = 2 * 1024 * 1024;

export async function PUT(request: Request) {
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  let body: { filePath?: unknown; content?: unknown; baseContent?: unknown };
  try {
    body = await request.json() as { filePath?: unknown; content?: unknown; baseContent?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const filePath = typeof body.filePath === "string" ? body.filePath : "";
  if (!filePath) return NextResponse.json({ error: "filePath required" }, { status: 400 });
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content must be a string" }, { status: 400 });
  }
  if (Buffer.byteLength(body.content, "utf8") > MAX_SKILL_CONTENT_BYTES) {
    return NextResponse.json({ error: "SKILL.md is too large to edit here" }, { status: 413 });
  }
  if (!existsSync(filePath)) return NextResponse.json({ error: "file not found" }, { status: 404 });
  if (!(await isSkillFileAllowed(filePath))) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    // 乐观并发：面板里存着的是打开时读到的内容，如果文件在这期间被别的进程
    // （`npx skills add`、别的编辑器）改过，直接写会静默吃掉对方的内容 —— 409 交回去，
    // 由界面提示「已被改动」并让用户重新载入。
    const current = readFileSync(filePath, "utf8");
    if (typeof body.baseContent === "string" && body.baseContent !== current) {
      return NextResponse.json(
        { error: "SKILL.md changed on disk", content: current },
        { status: 409 },
      );
    }
    writeFileSync(filePath, body.content, "utf8");
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
