import { NextResponse } from "next/server";
import { collectRecentProjects } from "@/lib/recent-projects";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// GET /api/recent-projects
// 从本机其它编辑器/Agent 的本地数据里读「最近打开的工作区」。只读、best-effort：
// 任何源读不到都静默跳过，出错也只返回空列表（推荐列表为空不是错误）。
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  try {
    const projects = await collectRecentProjects();
    return NextResponse.json(
      { projects },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to collect recent projects:", error);
    return NextResponse.json({ projects: [] });
  }
}
