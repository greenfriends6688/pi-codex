import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  deleteCronRun,
  deleteCronTask,
  findCronTask,
  listCronTasks,
  normalizeTask,
  upsertCronTask,
  type CronTask,
} from "@/lib/cron-store";
import { launchCronTask } from "@/lib/cron-runner";

export const dynamic = "force-dynamic";

// fork:cron — scheduled tasks.
//
// GET    /api/cron                 -> { tasks: CronTaskView[] }
// POST   /api/cron   { …task }     -> create (id assigned)
// PATCH  /api/cron   { id, …patch }-> update, or { id, action: "run" } to run now
// DELETE /api/cron?id=…            -> remove
//
// The scheduler itself lives in the server process (lib/cron-runner.ts); this route
// only owns the file. "Run now" deliberately goes through the same `runCronTask`
// path as a scheduled run (launched in the background, not awaited here), so a
// manual run and a scheduled run cannot drift apart. fork:zc-19

function guard(req: Request): NextResponse | null {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  return NextResponse.json({ tasks: listCronTasks() });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as Partial<CronTask> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const task = normalizeTask({ ...body, id: randomUUID(), runCount: 0, createdAt: new Date().toISOString() });
  if (!task) {
    return NextResponse.json(
      { error: "A task needs a prompt, a cwd and at least one valid time" },
      { status: 400 },
    );
  }
  upsertCronTask(task);
  return NextResponse.json({ task });
}

export async function PATCH(req: Request) {
  const denied = guard(req);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as (Partial<CronTask> & { id?: string; action?: string }) | null;
  if (!body?.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const existing = findCronTask(body.id);
  if (!existing) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  if (body.action === "run") {
    // fork:zc-19 — launching (not awaiting) keeps the request short; the run's
    // outcome is recorded in the task history. A concurrent run is a 409.
    const result = launchCronTask(existing);
    return NextResponse.json(result, { status: result.status === "duplicate" ? 409 : 200 });
  }

  // fork:fix-cron-lifecycle — 用户显式重新启用时视为一次"重启"：
  // 清掉自动暂停原因与失败计数；若此前是因达到 maxRuns 而完成，
  // 一并清掉完成标记并把计数归零（否则 isTaskExhausted 会立刻再次挡住它，
  // 界面看起来就是"开关打开了却不跑"）。
  const explicitlyEnabling = body.enabled === true && existing.enabled === false;
  const restart: Partial<CronTask> = explicitlyEnabling
    ? {
        pausedReason: undefined,
        consecutiveFailures: 0,
        // fork:zc-19 — re-enabling cancels any pending backoff retry as well.
        retryAt: undefined,
        retryAttempt: undefined,
        ...(existing.completedAt ? { completedAt: undefined } : {}),
        ...(existing.completedAt ? { runCount: 0 } : {}),
      }
    : {};

  // Patch semantics: absent fields stay, `enabled` toggles alone, and a malformed
  // schedule is rejected instead of silently dropping the task's only trigger.
  const merged = normalizeTask({
    ...existing,
    ...restart,
    ...body,
    id: existing.id,
    createdAt: existing.createdAt,
    runCount: restart.runCount ?? existing.runCount,
    schedule: body.schedule ?? existing.schedule,
  });
  if (!merged) return NextResponse.json({ error: "Invalid task" }, { status: 400 });

  upsertCronTask(merged);
  return NextResponse.json({ task: merged });
}

export async function DELETE(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const params = new URL(req.url).searchParams;
  // fork:zc-14 — `runId` deletes one run row; without it the whole task goes.
  const runId = params.get("runId") ?? "";
  if (runId) {
    const taskId = params.get("id") ?? "";
    if (!taskId) return NextResponse.json({ error: "id is required" }, { status: 400 });
    if (!deleteCronRun(taskId, runId)) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  }
  const id = params.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (!deleteCronTask(id)) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
