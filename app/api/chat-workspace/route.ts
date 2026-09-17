import { NextResponse } from "next/server";
import { statSync } from "node:fs";
import { allowFileRoot } from "@/lib/file-access";
import { projectIdentityKey } from "@/lib/project-identity";
import {
  ensureChatWorkspace,
  normalizeChatWorkspaceInput,
  writeChatWorkspacePath,
} from "@/lib/chat-workspace";
import { resolveProject } from "@/lib/worktree";
import { samePath } from "@/lib/paths";

export const dynamic = "force-dynamic";

// Standalone chat workspace (fork feature: `docs/patches/0001-chat-workspace.md`).
//
// GET  /api/chat-workspace           -> { cwd, projectKey } for the chat workspace
// POST /api/chat-workspace { cwd }   -> persist a different directory, then the same payload
//
// The returned projectKey is the same stable identity `/api/sessions` attaches to
// sessions, so the client groups and selects the chat workspace without ever
// comparing paths in the browser.

function chatPayload(cwd: string) {
  // Keep the files route allowed-roots cache in sync: without this the chat
  // workspace is unreadable in the file explorer until a session exists there.
  allowFileRoot(cwd);
  return { cwd, projectKey: projectIdentityKey(cwd) };
}

export async function GET() {
  try {
    return NextResponse.json(chatPayload(ensureChatWorkspace()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { cwd?: unknown };
    const requested = typeof body.cwd === "string" ? body.cwd : "";
    const cwd = normalizeChatWorkspaceInput(requested);
    if (!cwd) {
      return NextResponse.json(
        { error: requested.trim() ? `Path must be absolute: ${requested}` : "Path is required" },
        { status: 400 },
      );
    }

    let stat;
    try {
      stat = statSync(cwd);
    } catch {
      return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
    }
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: `Path is not a directory: ${cwd}` }, { status: 400 });
    }

    // A chat workspace inside a git repository would be folded into that project
    // by resolveProject(), so chat sessions would silently group under it instead
    // of staying standalone.
    const project = await resolveProject(cwd);
    if (!samePath(project.projectRoot, cwd)) {
      return NextResponse.json({
        error: `${cwd} belongs to the project ${project.projectRoot}. Pick a directory outside any project.`,
        code: "chat_workspace_inside_project",
        projectRoot: project.projectRoot,
      }, { status: 409 });
    }

    return NextResponse.json(chatPayload(writeChatWorkspacePath(cwd)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
