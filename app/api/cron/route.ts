import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  deleteCronTask,
  findCronTask,
  listCronTasks,
  normalizeTask,
  upsertCronTask,
  type CronTask,
} from "@/lib/cron-store";
import { runCronTask } from "@/lib/cron-runner";

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
// so a manual run and a scheduled run cannot drift apart.

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
    const result = await runCronTask(existing);
    return NextResponse.json(result, { status: result.status === "ok" ? 200 : 500 });
  }

  // Patch semantics: absent fields stay, `enabled` toggles alone, and a malformed
  // schedule is rejected instead of silently dropping the task's only trigger.
  const merged = normalizeTask({
    ...existing,
    ...body,
    id: existing.id,
    createdAt: existing.createdAt,
    runCount: existing.runCount,
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
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (!deleteCronTask(id)) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
