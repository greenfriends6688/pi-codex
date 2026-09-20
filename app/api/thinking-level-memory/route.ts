import { NextResponse } from "next/server";
import { forgetThinkingLevel } from "@/lib/thinking-level-memory";
import { invalidateModelsCache } from "@/lib/models-cache";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// DELETE /api/thinking-level-memory — 清除某模型的 per-model 推理强度记忆。
// Body: { modelKey: "provider/modelId" }（斜杠形式）。
// 清除后让 /api/models 缓存失效，前端下次拉取即看不到该记忆。
export async function DELETE(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  try {
    const body = await req.json() as { modelKey?: unknown };
    if (typeof body?.modelKey !== "string" || !body.modelKey.includes("/")) {
      return NextResponse.json({ error: "modelKey (provider/modelId) is required" }, { status: 400 });
    }
    forgetThinkingLevel(body.modelKey);
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
