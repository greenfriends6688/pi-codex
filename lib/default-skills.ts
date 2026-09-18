/**
 * 内置技能目录：首次启动种子到用户技能目录的只读资产（GAP-20 资产部分）。
 *
 * - 资产位置：本仓 `assets/default-skills/<slug>/`（随仓库分发，打包接线由主 Agent 负责）。
 * - 种子目标：`~/.pi/agent/skills/<slug>/`（运行时由调用方传入，本模块不硬编码该路径，
 *   单测也只写 `os.tmpdir()`，绝不触碰 `~/.pi/`）。
 * - 种子语义：默认只补缺失，同名已存在技能一律拒绝覆盖或合并（与跨工作区导入的
 *   “同名拒绝”语义一致），避免覆盖用户已修改的技能。
 * - 许可红线：只收录允许再分发的技能（Apache-2.0 / MIT / 公共领域类），每个技能目录
 *   必须自带 `LICENSE*`；许可不明或带商用限制的一律不收录，见
 *   `assets/default-skills/README.md` 的许可表。
 */

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

/** 本仓内默认技能资产的目录名（`assets/<DEFAULT_SKILLS_DIR_NAME>/<slug>/`）。 */
export const DEFAULT_SKILLS_DIR_NAME = "default-skills";

/** 技能目录名白名单：只允许小写字母、数字与连字符，防止路径穿越。 */
const SKILL_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** 从 `assets/default-skills` 读出的单个内置技能摘要。 */
export interface DefaultSkillInfo {
  /** 目录名，同时是种子到目标目录后的目录名。 */
  slug: string;
  /** `SKILL.md` frontmatter 的 `name`，缺失时回退为 slug。 */
  name: string;
  /** `SKILL.md` frontmatter 的 `description`，缺失为空字符串。 */
  description: string;
  /** `SKILL.md` frontmatter 的 `version`，缺失为空字符串。 */
  version: string;
  /** `SKILL.md` frontmatter 的 `license`，缺失为空字符串（以同目录 LICENSE* 文件为准）。 */
  license: string;
  /** 该技能在资产目录中的绝对路径。 */
  path: string;
}

/** `syncDefaultSkills()` 的入参。 */
export interface SyncDefaultSkillsOptions {
  /** 资产根目录，即 `assets/default-skills` 本身。 */
  assetsRoot: string;
  /** 种子目标目录，即用户技能目录（如 `~/.pi/agent/skills`，由调用方决定并传入）。 */
  targetDir: string;
  /**
   * 默认 `true`：只补缺失的技能。
   * 即使显式传 `false`，当前实现仍拒绝覆盖或合并同名已存在技能（安全优先）；
   * 如需重装某个技能，请人工删除目标目录下的同名目录后重跑。
   */
  onlyMissing?: boolean;
}

/** `syncDefaultSkills()` 的结果：已复制与已跳过（已存在/已退役）的 slug 列表。 */
export interface SyncDefaultSkillsResult {
  copied: string[];
  skipped: string[];
}

/**
 * 已退役的技能 slug 表（当前为空）。
 *
 * 何时填写：当某个内置技能在上游被改名或下架，而用户技能目录里还留着旧 slug 的
 * 副本时，把旧 slug 加进来，调用方可据此提示用户手工清理（本模块绝不自动删除
 * 用户目录里的任何东西，只负责“不复制退役技能”）。
 */
export function retiredSkillSlugs(): string[] {
  return [];
}

/** 解析 `SKILL.md` 顶部的 `---` frontmatter，返回扁平键值（只取首层 `key: value`）。 */
function parseSkillFrontmatter(skillMd: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!skillMd.startsWith("---")) return result;
  const end = skillMd.indexOf("\n---", 3);
  if (end === -1) return result;
  const body = skillMd.slice(3, end);
  for (const line of body.split("\n")) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/** 读取单个资产技能目录的摘要；目录无效或缺少 `SKILL.md` 时返回 null。 */
function readSkillInfo(assetsRoot: string, slug: string): DefaultSkillInfo | null {
  if (!SKILL_SLUG_RE.test(slug)) return null;
  const skillPath = join(assetsRoot, slug);
  const skillMdPath = join(skillPath, "SKILL.md");
  let skillMd: string;
  try {
    skillMd = readFileSync(skillMdPath, "utf8");
  } catch {
    // 没有 SKILL.md 的目录不是有效技能，跳过而不是报错。
    return null;
  }
  const frontmatter = parseSkillFrontmatter(skillMd);
  return {
    slug,
    name: frontmatter["name"] || slug,
    description: frontmatter["description"] || "",
    version: frontmatter["version"] || "",
    license: frontmatter["license"] || "",
    path: skillPath,
  };
}

/**
 * 列出资产目录中的全部有效内置技能（按 slug 排序）。
 * 资产目录不存在时返回空数组（调用方首次启动种子时直接视为空，无需抛错）。
 */
export function listDefaultSkills(assetsRoot: string): DefaultSkillInfo[] {
  let entries;
  try {
    entries = readdirSync(assetsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: DefaultSkillInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const info = readSkillInfo(assetsRoot, entry.name);
    if (info) skills.push(info);
  }
  skills.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return skills;
}

/**
 * 原子写单个文件：先写同目录临时文件再 rename，避免种子中途崩溃留下半截文件。
 * 技能不是凭据，用默认权限即可（不复用凭据专用的 0600 写）。
 */
function writeFileAtomicSync(filePath: string, data: Buffer): void {
  const dir = dirname(filePath);
  const tempPath = join(dir, `.${basename(filePath)}-${randomUUID()}.tmp`);
  let operationFailed = false;
  try {
    writeFileSync(tempPath, data, { flag: "wx" });
    renameSync(tempPath, filePath);
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    try {
      unlinkSync(tempPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !operationFailed) {
        throw error;
      }
    }
  }
}

/**
 * 递归复制技能目录（保留子目录与 LICENSE*，跳过 symlink 以防路径逃逸）。
 * 目标目录由本函数逐级创建。
 */
function copySkillDirAtomicSync(sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });
  const entries = readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    // 跳过隐藏的临时文件（如上次中断残留的 `.xxx.tmp`）。
    if (entry.name.startsWith(".")) continue;
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      copySkillDirAtomicSync(sourcePath, targetPath);
    } else if (entry.isFile()) {
      writeFileAtomicSync(targetPath, readFileSync(sourcePath));
    }
    // 其它类型（socket / fifo 等）技能目录里不应出现，直接忽略。
  }
}

/**
 * 把资产技能种子到目标目录，默认只补缺失。
 *
 * - 目标目录不存在会自动创建；资产目录不存在则直接返回空结果（不抛错）。
 * - 同名目标已存在（文件或目录）时一律跳过：绝不覆盖、绝不合并，无论
 *   `onlyMissing` 取何值（见 `SyncDefaultSkillsOptions.onlyMissing` 说明）。
 * - 已退役 slug（见 `retiredSkillSlugs()`）不复制、只记入 `skipped`，且绝不删除
 *   目标目录里的旧副本（删用户文件必须由用户确认）。
 */
export function syncDefaultSkills(options: SyncDefaultSkillsOptions): SyncDefaultSkillsResult {
  const { assetsRoot, targetDir, onlyMissing = true } = options;
  void onlyMissing; // 保留开关语义：当前任何取值都不覆盖已存在技能，见接口注释。
  const result: SyncDefaultSkillsResult = { copied: [], skipped: [] };
  const retired = new Set(retiredSkillSlugs());
  const skills = listDefaultSkills(assetsRoot);
  if (skills.length === 0) return result;
  mkdirSync(targetDir, { recursive: true });
  for (const skill of skills) {
    if (retired.has(skill.slug)) {
      result.skipped.push(skill.slug);
      continue;
    }
    const destination = join(targetDir, skill.slug);
    if (existsSync(destination)) {
      // 同名拒绝：用户可能已修改过该技能，任何情况下都不覆盖、不合并。
      result.skipped.push(skill.slug);
      continue;
    }
    copySkillDirAtomicSync(skill.path, destination);
    result.copied.push(skill.slug);
  }
  result.copied.sort();
  result.skipped.sort();
  return result;
}
