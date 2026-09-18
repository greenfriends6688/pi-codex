import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { listDefaultSkills, syncDefaultSkills, DEFAULT_SKILLS_DIR_NAME } from "@/lib/default-skills";

export const dynamic = "force-dynamic";

/**
 * fork:gap-default-skills — 内置技能目录的查询与按需种子。
 *
 * 两个刻意的设计取舍：
 *
 * 1. **不在启动时自动写入**。`assets/default-skills/` 里是随仓库分发的技能模板，
 *    但种子最终会写进用户的 `~/.pi/agent/skills/`——那是用户自己的目录。
 *    自动播种意味着"装个前端顺手改了我的 pi 配置"，所以这里只提供显式动作
 *    （POST action=seed），由用户/UI 决定何时执行。
 * 2. **只补缺失，绝不覆盖**。同名技能已存在就跳过（`syncDefaultSkills` 的默认行为），
 *    用户改过的技能不会被模板悄悄回滚。
 *
 * 资产位置：开发时是 `<repo>/assets/default-skills`；打包后 Electron 把它放在
 * `Resources/default-skills`（见 package.json 的 extraResources）。
 */

function resolveAssetsRoot(): string | null {
  const candidates = [
    // 打包后：process.resourcesPath 只在 Electron 主进程里有；这里优先用相对路径探测。
    process.env.PI_WEB_DEFAULT_SKILLS_DIR,
    join(process.cwd(), "assets", DEFAULT_SKILLS_DIR_NAME),
    join(process.cwd(), "..", "Resources", DEFAULT_SKILLS_DIR_NAME),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const assetsRoot = resolveAssetsRoot();
  if (!assetsRoot) {
    return NextResponse.json({ skills: [], installed: [], assetsRoot: null });
  }
  const skills = listDefaultSkills(assetsRoot);
  const targetDir = join(getAgentDir(), "skills");
  const installed = skills
    .filter((skill) => existsSync(join(targetDir, skill.slug)))
    .map((skill) => skill.slug);
  return NextResponse.json({ skills, installed, assetsRoot });
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "seed") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }
  const assetsRoot = resolveAssetsRoot();
  if (!assetsRoot) {
    return NextResponse.json({ error: "Default skills assets not found" }, { status: 404 });
  }
  // onlyMissing 固定为 true：这是本路由的安全边界，不接受调用方关闭它。
  const result = syncDefaultSkills({
    assetsRoot,
    targetDir: join(getAgentDir(), "skills"),
    onlyMissing: true,
  });
  return NextResponse.json({ ...result, assetsRoot });
}
