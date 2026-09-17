import { NextResponse } from "next/server";
import { homedir } from "node:os";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { isApiRequestAllowed } from "@/lib/request-security";
import { discoverMcpServers } from "@/lib/mcp-discovery";

export const dynamic = "force-dynamic";

// fork:mcp-import — read-only discovery of MCP servers other agents already configured.
//
// GET /api/mcp/discover?cwd=…  -> { servers, sources }
//
// Nothing is written here: the UI imports a discovered server through
// POST /api/mcp { action: "add" }, which owns the trust check and the file write.
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const cwd = new URL(req.url).searchParams.get("cwd") ?? "";
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const home = homedir();
  const servers = discoverMcpServers(cwd, home);
  // Group by file so the UI can say "found 3 in ~/.claude.json" instead of listing
  // the same path on every row.
  const sources = [...new Map(servers.map((server) => [server.path, {
    path: server.path,
    tool: server.tool,
    scope: server.scope,
    count: servers.filter((entry) => entry.path === server.path).length,
  }])).values()];

  return NextResponse.json({ servers, sources });
}
