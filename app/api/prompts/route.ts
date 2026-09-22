import { NextResponse } from "next/server";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import { allowFileRoot } from "@/lib/file-access";
import { isExistingPathWithinRoots, isPathWithinRoots } from "@/lib/path-security";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  PROMPT_FILE_MAX_BYTES,
  buildPromptContent,
  normalizePromptName,
  parsePromptFile,
  replacePromptBody,
  resolvePromptPath,
  setPromptDescription,
  type PromptFile,
} from "@/lib/prompt-files";

/*
 * fork:zc-16 — CRUD for `~/.pi/agent/prompts/*.md`.
 *
 * pi discovers these files itself and `components/ChatInput.tsx` already lists
 * them in the slash palette, so this route only has to be a well-guarded file
 * editor:
 *
 *   GET    -> { dir, prompts }            (size/mtime/description summaries)
 *   POST   -> create one file (409 when it exists)
 *   PUT    -> surgical update: only `description` and the body after the
 *             frontmatter fence change, every other byte is preserved
 *   DELETE -> remove one file
 *
 * Security: the name is validated by `lib/prompt-files.ts` (no separators, no
 * `..`, `.md` only) *and* the resulting path is checked with
 * `lib/path-security.ts`; an existing symlink that escapes the prompts root is
 * rejected too. Writes are bounded and atomic.
 */
export const dynamic = "force-dynamic";

function promptsRoot(): string {
  return join(getAgentDir(), "prompts");
}

function resolvePromptPathForName(raw: unknown): { path: string; name: string } | null {
  const root = promptsRoot();
  const normalized = normalizePromptName(typeof raw === "string" ? raw : "");
  if (!normalized) return null;
  const filePath = resolvePromptPath(root, normalized);
  if (!filePath || !isPathWithinRoots(filePath, new Set([root]))) return null;
  // A symlink inside the prompts directory must not redirect the write outside
  // the root; non-existent targets are fine (creation).
  if (existsSync(filePath) && !isExistingPathWithinRoots(filePath, new Set([root]))) return null;
  return { path: filePath, name: normalized };
}

function readPromptFile(filePath: string, name: string): PromptFile {
  const stats = statSync(filePath);
  return parsePromptFile(readFileSync(filePath, "utf8"), name, stats.size, stats.mtime.toISOString());
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const root = promptsRoot();
  // Let the main file viewer open prompt files (they live outside every
  // session cwd).
  allowFileRoot(root);

  const prompts: PromptFile[] = [];
  if (existsSync(root)) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      const filePath = join(root, entry.name);
      let stats;
      try {
        stats = statSync(filePath);
      } catch {
        continue;
      }
      if (!stats.isFile()) continue;
      const normalized = normalizePromptName(entry.name);
      if (!normalized) continue;
      try {
        prompts.push(readPromptFile(filePath, normalized));
      } catch {
        // Unreadable file: skip it rather than failing the whole listing.
      }
    }
  }
  prompts.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ dir: root, prompts });
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  const body = await req.json().catch(() => null) as {
    name?: unknown;
    description?: unknown;
    body?: unknown;
  } | null;
  const target = resolvePromptPathForName(body?.name);
  if (!target) return NextResponse.json({ error: "Invalid prompt name" }, { status: 400 });
  if (existsSync(target.path)) {
    return NextResponse.json({ error: "A prompt with that name already exists" }, { status: 409 });
  }

  const description = typeof body?.description === "string" ? body.description : "";
  const promptBody = typeof body?.body === "string" ? body.body : "";
  const content = buildPromptContent(description, promptBody);
  if (Buffer.byteLength(content, "utf8") > PROMPT_FILE_MAX_BYTES) {
    return NextResponse.json({ error: "Prompt is too large" }, { status: 413 });
  }

  try {
    mkdirSync(promptsRoot(), { recursive: true });
    writePrivateFileAtomicSync(target.path, content);
    allowFileRoot(promptsRoot());
    return NextResponse.json({ prompt: readPromptFile(target.path, target.name) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  const body = await req.json().catch(() => null) as {
    name?: unknown;
    description?: unknown;
    body?: unknown;
  } | null;
  const target = resolvePromptPathForName(body?.name);
  if (!target) return NextResponse.json({ error: "Invalid prompt name" }, { status: 400 });
  if (!existsSync(target.path)) return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  if (body?.description === undefined && body?.body === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    let content = readFileSync(target.path, "utf8");
    if (typeof body?.description === "string") {
      content = setPromptDescription(content, body.description);
    }
    if (typeof body?.body === "string") {
      content = replacePromptBody(content, body.body);
    }
    if (Buffer.byteLength(content, "utf8") > PROMPT_FILE_MAX_BYTES) {
      return NextResponse.json({ error: "Prompt is too large" }, { status: 413 });
    }
    writePrivateFileAtomicSync(target.path, content);
    return NextResponse.json({ prompt: readPromptFile(target.path, target.name) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  let name = new URL(req.url).searchParams.get("name");
  if (!name && req.headers.get("content-type")?.includes("application/json")) {
    const body = await req.json().catch(() => null) as { name?: unknown } | null;
    if (typeof body?.name === "string") name = body.name;
  }
  const target = resolvePromptPathForName(name);
  if (!target) return NextResponse.json({ error: "Invalid prompt name" }, { status: 400 });
  if (!existsSync(target.path)) return NextResponse.json({ error: "Prompt not found" }, { status: 404 });

  try {
    unlinkSync(target.path);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
