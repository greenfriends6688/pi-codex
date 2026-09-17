import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { statSync } from "node:fs";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { isPathAction, pathActionCommand } from "@/lib/path-actions";
import { toNativePath } from "@/lib/paths";

export const dynamic = "force-dynamic";

// fork:ui-20 — hand a file to the OS (reveal in the file manager / open with the
// default app).
//
// POST /api/files/reveal  body: { path: string, action: "reveal" | "open" }
//
// Guarded by the same allow-list as /api/files: this runs a program on the host,
// so anything outside the browsable roots is refused before a command is built.
// The command never goes through a shell (argv array), and the path is passed as
// a single argument, so spaces/quotes/`;` in a file name cannot turn into a
// second command.
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let body: { path?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action;
  if (!isPathAction(action)) {
    return NextResponse.json({ error: "action must be reveal or open" }, { status: 400 });
  }
  const raw = typeof body.path === "string" ? body.path.trim() : "";
  if (!raw) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const target = toNativePath(raw);
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(target, roots)) {
    return NextResponse.json({ error: "Path is outside the allowed roots" }, { status: 403 });
  }
  let isDirectory = false;
  try {
    isDirectory = statSync(target).isDirectory();
  } catch {
    return NextResponse.json({ error: "Path does not exist" }, { status: 404 });
  }

  const { command, args } = pathActionCommand(action, target, { isDirectory });
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { stdio: "ignore", detached: true });
      child.on("error", reject);
      // Detach immediately: the opener outlives the request and we never read
      // its output, so waiting for exit would just hold the response open.
      child.unref();
      resolve();
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Could not run ${action}: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, action });
}
