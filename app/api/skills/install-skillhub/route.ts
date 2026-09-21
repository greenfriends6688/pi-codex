import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { extractArchive } from "@/lib/file-archives";
import { isSafeSkillSlug, skillDirectoryName, skillHubDownloadUrl } from "@/lib/skillhub";

export const dynamic = "force-dynamic";

/**
 * 从 SkillHub 装技能 —— **不经过 skills CLI**。
 *
 * SkillHub 的 `GET /api/v1/download?slug=<slug>` 会 302 到对象存储上的一个 ZIP，
 * 里面就是 `SKILL.md`（+ 可选的 `_meta.json`）。所以流程是纯搬运：
 *
 *   下载 ZIP → 解到临时目录 → 校验解出来的东西有 SKILL.md → 挪进技能目录
 *
 * 技能目录按 pi 自己的扫描路径放（见 SDK 的 package-manager）：
 *   - 全局：`~/.pi/agent/skills/<name>/`
 *   - 项目：`<cwd>/.pi/skills/<name>/`（要求项目已被信任，和 skills.sh 那条一致）
 *
 * 有意**不**去写 `~/.agents/skills` + 建软链（CLI 的做法）：Windows 上建软链要
 * 管理员权限，而 pi 本来就同时扫描 `~/.pi/agent/skills`，直写更省事也更稳。
 *
 * POST /api/skills/install-skillhub  body: { slug, scope, cwd?, version? }
 */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let workDir: string | null = null;
  try {
    const body = await req.json() as { slug?: unknown; scope?: unknown; cwd?: unknown; version?: unknown };
    const slug = typeof body.slug === "string" ? body.slug.trim() : "";
    const scope = body.scope === "project" ? "project" : "global";
    const version = typeof body.version === "string" && body.version.trim() ? body.version.trim() : undefined;

    if (!isSafeSkillSlug(slug)) {
      return NextResponse.json({ error: "Invalid skill slug" }, { status: 400 });
    }

    const cwd = typeof body.cwd === "string" ? body.cwd : "";
    if (scope === "project" && !cwd) {
      return NextResponse.json({ error: "cwd required for project install" }, { status: 400 });
    }
    if (scope === "project") {
      const allowedRoots = await getAllowedFileRoots();
      if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
      if (!getProjectTrustStatus(cwd, getAgentDir()).trusted) {
        return NextResponse.json(
          { error: "Project resources must be trusted before installing project skills" },
          { status: 403 },
        );
      }
    }

    const skillsRoot = scope === "project"
      ? join(cwd, ".pi", "skills")
      : join(getAgentDir(), "skills");
    const targetDir = join(skillsRoot, skillDirectoryName(slug));

    // 1) 下载 ZIP
    const res = await fetch(skillHubDownloadUrl(slug, version), { redirect: "follow", cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: `SkillHub 下载失败: HTTP ${res.status}` }, { status: 502 });
    }
    const archive = Buffer.from(await res.arrayBuffer());
    if (archive.byteLength === 0) {
      return NextResponse.json({ error: "SkillHub 返回了空文件" }, { status: 502 });
    }

    // 2) 解到临时目录（复用文件管理那条抽包路径：bsdtar 自身拒绝绝对路径与穿越）
    workDir = mkdtempSync(join(tmpdir(), "pi-skillhub-"));
    const archivePath = join(workDir, `${skillDirectoryName(slug)}.zip`);
    writeFileSync(archivePath, archive);
    // 抽包目录 = 压缩包同级的同名文件夹（extractArchive 自己算并防重名）。
    const extracted = await extractArchive(archivePath, new Set([workDir]));
    if (!extracted.ok || !extracted.extractedTo) {
      return NextResponse.json({ error: `解压失败: ${extracted.ok ? "无输出目录" : extracted.error}` }, { status: 500 });
    }

    // 3) 有的包外面套一层目录，往里找真正的 SKILL.md
    const sourceDir = findSkillRoot(extracted.extractedTo);
    if (!sourceDir) {
      return NextResponse.json({ error: "这个技能包里没有 SKILL.md" }, { status: 422 });
    }

    // 4) 落位（已存在则覆盖：重装/升级走同一条路）
    mkdirSync(skillsRoot, { recursive: true });
    rmSync(targetDir, { recursive: true, force: true });
    renameDirectory(sourceDir, targetDir);

    return NextResponse.json({
      success: true,
      slug,
      scope,
      path: targetDir,
      name: basename(targetDir),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  } finally {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  }
}

/** 解压结果里含 SKILL.md 的那一层（先看根，再看唯一的子目录）。 */
function findSkillRoot(root: string): string | null {
  if (existsSync(join(root, "SKILL.md"))) return root;
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const candidate = join(root, entry);
    if (existsSync(join(candidate, "SKILL.md"))) return candidate;
  }
  return null;
}

/** 同卷 rename；跨卷（临时目录在另一个盘）时退回「递归拷贝」。 */
function renameDirectory(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch {
    cpSync(from, to, { recursive: true });
  }
}
