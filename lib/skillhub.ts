/**
 * SkillHub（skillhub.cn）客户端 —— 直接用它的公开 JSON 接口，**不经过任何 CLI**。
 *
 * 接口是从它的前端 bundle（`skill-hub.*.js`）里反查出来的，三个都免登录：
 *
 * | 用途 | 请求 | 返回 |
 * | --- | --- | --- |
 * | 列表 / 搜索 | `GET /api/skills?page&pageSize&sortBy=score&keyword` | `{code:0,data:{skills,total}}` |
 * | 下载 | `GET /api/v1/download?slug=<slug>` | **302 → ZIP**（内含 `SKILL.md`） |
 * | 文件清单 | `GET /api/v1/skills/<slug>/files` | `{files:[{path,sha256,size}],version}` |
 *
 * 列表接口的 `code === 0` 才算成功（非 0 时 `message` 是错误原因）。
 * 基址可用 `SKILLHUB_API_URL` 覆盖（自建镜像 / 测试）。
 */

const DEFAULT_API_BASE = "https://api.skillhub.cn";

/** SkillHub 的公开站点前缀（拼详情链接用）。 */
export const SKILLHUB_SITE_BASE = "https://skillhub.cn";

export function skillHubApiBase(): string {
  return (process.env.SKILLHUB_API_URL || DEFAULT_API_BASE).replace(/\/+$/, "");
}

export const SKILLHUB_PAGE_SIZE_MAX = 60;

export interface SkillHubNamespace {
  canonicalName?: string;
  displayName?: string;
  handle?: string;
  publicSlug?: string;
}

export interface SkillHubSkill {
  slug?: string;
  name?: string;
  description?: string;
  downloads?: number;
  stars?: number;
  version?: string;
  namespace?: SkillHubNamespace;
  category?: string;
  iconUrl?: string;
  verified?: boolean;
  updated_at?: string;
}

export interface SkillHubListResponse {
  code?: number;
  message?: string;
  data?: { skills?: SkillHubSkill[]; total?: number };
}

export interface SkillHubListItem {
  slug: string;
  name: string;
  description: string;
  /** 作者命名空间，形如 `@tencent-adm`。 */
  publisher: string;
  version: string;
  downloads: number;
  stars: number;
  /** 详情页，交给应用内的浏览器面板打开。 */
  url: string;
}

export function skillHubPageUrl(options: {
  page: number;
  pageSize: number;
  sortBy?: string;
  keyword?: string;
  category?: string;
}): string {
  const params = new URLSearchParams();
  params.set("page", String(options.page));
  params.set("pageSize", String(options.pageSize));
  if (options.sortBy) params.set("sortBy", options.sortBy);
  if (options.keyword?.trim()) params.set("keyword", options.keyword.trim());
  if (options.category) params.set("category", options.category);
  return `${skillHubApiBase()}/api/skills?${params.toString()}`;
}

export function skillHubDownloadUrl(slug: string, version?: string): string {
  const params = new URLSearchParams({ slug });
  if (version) params.set("version", version);
  return `${skillHubApiBase()}/api/v1/download?${params.toString()}`;
}

export function skillHubDetailUrl(slug: string): string {
  return `${SKILLHUB_SITE_BASE}/skills/${encodeURIComponent(slug)}`;
}

/**
 * 下载量 → 人话。跟 skills.sh 那边的 `formatInstalls` 同款刻度，但用中文站点
 * 更像的「次下载」而不是 "installs"。
 */
export function formatDownloads(count: number | undefined): string {
  if (!count || count <= 0) return "";
  if (count >= 100_000_000) return `${(count / 100_000_000).toFixed(1).replace(/\.0$/, "")} 亿次下载`;
  if (count >= 10_000) return `${(count / 10_000).toFixed(1).replace(/\.0$/, "")} 万次下载`;
  return `${count} 次下载`;
}

/** 列表项 → 界面用的形状；没有 slug 的条目直接丢掉（装不了）。 */
export function mapSkillHubSkill(skill: SkillHubSkill): SkillHubListItem | null {
  const slug = skill.slug?.trim();
  if (!slug) return null;
  return {
    slug,
    name: skill.name?.trim() || slug,
    description: (skill.description ?? "").replace(/\s+/g, " ").trim(),
    publisher: skill.namespace?.handle?.trim() ?? "",
    version: skill.version?.trim() ?? "",
    downloads: typeof skill.downloads === "number" ? skill.downloads : 0,
    stars: typeof skill.stars === "number" ? skill.stars : 0,
    url: skillHubDetailUrl(slug),
  };
}

export interface SkillHubSearchResult {
  items: SkillHubListItem[];
  total: number;
}

/**
 * 拉一页 SkillHub 技能。
 * 不传 keyword 就是「按评分浏览」——这正是站点首页的默认视图。
 */
export async function fetchSkillHubSkills(options: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  sortBy?: string;
  fetchImpl?: typeof fetch;
}): Promise<SkillHubSearchResult> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(SKILLHUB_PAGE_SIZE_MAX, Math.max(1, Math.floor(options.pageSize ?? 30)));
  const url = skillHubPageUrl({ page, pageSize, sortBy: options.sortBy ?? "score", keyword: options.keyword });
  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(url, { cache: "no-store", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`SkillHub 列表请求失败: HTTP ${res.status}`);

  const body = (await res.json()) as SkillHubListResponse;
  if (body.code !== 0) throw new Error(body.message || `SkillHub 返回错误码 ${String(body.code)}`);
  const raw = body.data?.skills ?? [];
  return {
    items: raw.map(mapSkillHubSkill).filter((item): item is SkillHubListItem => item !== null),
    total: typeof body.data?.total === "number" ? body.data.total : raw.length,
  };
}

/**
 * slug 会直接当目录名用，所以必须比「非空」更严：路径分隔符、`..`、Windows 保留字符
 * 一律拒绝。SkillHub 自己的 slug 是 `[a-z0-9-]`（可带 `@命名空间/`），但下载下来的
 * 目录名只取最后一段。
 */
export function isSafeSkillSlug(slug: string): boolean {
  if (!slug || slug.length > 120) return false;
  if (slug.includes("/") || slug.includes("\\") || slug.includes("..")) return false;
  return /^[\w.@-]+$/.test(slug);
}

/** 从 slug 推安装目录名：`@ns/name` 取 `name`。 */
export function skillDirectoryName(slug: string): string {
  const last = slug.split("/").pop() ?? slug;
  return last.replace(/[^\w.-]/g, "-");
}
