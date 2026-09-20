import { NextResponse } from "next/server";
import { readModelsConfig, writeModelsConfig } from "@/lib/models-config-store";
import { findBuiltinModelConflicts } from "@/lib/builtin-models";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(readModelsConfig());
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    writeModelsConfig(body);
    // provider-composer 对 `models[]` 是「整条替换」：用户写一个与内置同名的模型会丢掉
    // 内置 thinkingLevelMap / compat。保存成功后把 `provider/modelId` 冲突列表作为可选字段
    // `warnings` 回传（旧响应是 { success: true }，新字段向后兼容）。
    // 前端（components/ModelsConfig.tsx 保存回调）应在 d.warnings?.length > 0 时用现有
    // toast/notice 机制展示「覆盖内置定义」警告；没有冲突时不带该字段。
    const providers = (body.providers ?? {}) as Record<string, { models?: { id?: string }[] }>;
    const warnings = findBuiltinModelConflicts(providers);
    return NextResponse.json({
      success: true,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
