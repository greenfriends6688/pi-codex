import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { addMemory, clearMemory, consolidateMemory, deleteMemory, getMemorySettings, listMemory, memoryStats, renderMemoryMarkdown, setMemorySettings, updateMemory, writeMemoryMarkdownMirror } from "@/lib/memory-store";

export const dynamic = "force-dynamic";

// fork:memory — the saved-memory list.
//
// GET    /api/memory?scope=…      -> { settings, entries, stats }
// POST   /api/memory { text, scope? }  -> add (user-sourced)
// PATCH  /api/memory { id, text }      -> edit
// DELETE /api/memory?id=…              -> remove
//
// The agent writes through the `remember` tool instead (lib/memory-extension.ts);
// both paths land in the same file.

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const scope = new URL(req.url).searchParams.get("scope") ?? undefined;
  const entries = listMemory(scope);
  return NextResponse.json({ settings: getMemorySettings(), entries, stats: memoryStats(listMemory()) });
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  const body = await req.json().catch(() => null) as { text?: unknown; scope?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  if (!text.trim()) return NextResponse.json({ error: "text is required" }, { status: 400 });
  const entry = addMemory({ text, scope: typeof body?.scope === "string" ? body.scope : undefined, source: "user" });
  if (!entry) return NextResponse.json({ error: "text is required" }, { status: 400 });
  return NextResponse.json({ entry });
}

export async function PATCH(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  const body = await req.json().catch(() => null) as { id?: unknown; text?: unknown; settings?: unknown; action?: string; scope?: unknown } | null;

  // Maintenance actions share one endpoint: they are single clicks in the panel and
  // none of them deserves a route of its own.
  if (body?.action === "clear") {
    return NextResponse.json({ removed: clearMemory(typeof body.scope === "string" ? body.scope : undefined) });
  }
  if (body?.action === "consolidate") {
    return NextResponse.json({ removed: consolidateMemory() });
  }
  if (body?.action === "export") {
    return NextResponse.json({ path: writeMemoryMarkdownMirror(), markdown: renderMemoryMarkdown(listMemory()) });
  }

  // The switches are patched on their own — the panel toggles them without
  // touching any entry.
  if (body?.settings && typeof body.settings === "object") {
    return NextResponse.json({ settings: setMemorySettings(body.settings as { enabled?: boolean; autoLearn?: boolean }) });
  }

  const id = typeof body?.id === "string" ? body.id : "";
  const text = typeof body?.text === "string" ? body.text : "";
  if (!id || !text.trim()) return NextResponse.json({ error: "id and text are required" }, { status: 400 });
  const entry = updateMemory(id, text);
  if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  return NextResponse.json({ entry });
}

export async function DELETE(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (!deleteMemory(id)) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
