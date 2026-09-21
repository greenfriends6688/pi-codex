import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  fetchSkillHubSkills,
  formatDownloads,
  skillHubDetailUrl,
  type SkillHubListItem,
} from "@/lib/skillhub";
import type { SkillSearchResult } from "@/lib/api-types";

export const dynamic = "force-dynamic";

/**
 * SkillHub（skillhub.cn）的浏览/搜索代理。
 *
 * 走这一层而不是浏览器直连，是因为：① 站点按中国网络优化，跨域直连会撞 CORS；
 * ② 把第三方响应的形状收在本文件里，将来它改字段只改这里。
 *
 * POST /api/skills/skillhub  body: { query?: string; page?: number; pageSize?: number }
 * 不传 query = 按评分浏览（就是站点首页那个 `?sortBy=score` 视图）。
 */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json().catch(() => ({})) as {
      query?: unknown;
      page?: unknown;
      pageSize?: unknown;
    };
    const query = typeof body.query === "string" ? body.query : "";
    const page = typeof body.page === "number" ? body.page : 1;
    const pageSize = typeof body.pageSize === "number" ? body.pageSize : 30;

    const { items, total } = await fetchSkillHubSkills({ page, pageSize, keyword: query });
    return NextResponse.json({
      // 复用 skills.sh 那条结果形状，界面不用写第二套列表。
      results: items.map(toSearchResult),
      total,
      source: "skillhub",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}

function toSearchResult(item: SkillHubListItem): SkillSearchResult {
  return {
    package: item.slug,
    installs: formatDownloads(item.downloads),
    url: item.url || skillHubDetailUrl(item.slug),
    source: "skillhub",
    description: item.description,
    publisher: item.publisher,
    version: item.version,
    stars: item.stars,
  };
}
