import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { stat } from "fs/promises";
import type { Stats } from "fs";
import { homedir } from "os";
import { resolveDirectory } from "@/lib/directory-browser";

const execFileAsync = promisify(execFile);

interface ExecError extends Error {
  code?: string;
  stdout?: string;
  stderr?: string;
}

function hasCode(error: unknown): error is ExecError {
  return typeof error === "object" && error !== null && "code" in error;
}

function isLocalRequest(request: NextRequest): boolean {
  const host = request.headers.get("host") || "";
  if (/^(127\.0\.0\.1|::1|localhost)(:|$)/.test(host.split(",")[0].trim())) return true;
  if (!host) return true;
  return false;
}

async function pickOnMac(currentPath?: string): Promise<string | null> {
  const prompt = "选择项目目录";
  const defaultLocation = currentPath ? ` default location POSIX file ${JSON.stringify(currentPath)}` : "";
  const script = `try
  set theFolder to choose folder with prompt ${JSON.stringify(prompt)}${defaultLocation}
  POSIX path of theFolder
on error
  return ""
end try`;
  const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 60000 });
  const result = stdout.trim();
  if (!result) return null;
  return result;
}

async function pickOnWindows(currentPath?: string): Promise<string | null> {
  const psCommands = ["powershell.exe", "powershell", "pwsh"];
  const selectedPath = currentPath ? currentPath.replace(/'/g, "''") : "";
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$f = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$f.Description = '选择项目目录'",
    selectedPath ? `$f.SelectedPath = '${selectedPath}'` : "",
    "$f.ShowNewFolderButton = $true",
    "if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $f.SelectedPath } else { exit 1 }",
  ]
    .filter(Boolean)
    .join("; ");
  let lastError: unknown = null;
  for (const exe of psCommands) {
    try {
      const { stdout } = await execFileAsync(exe, ["-NoProfile", "-STA", "-Command", script], { timeout: 60000 });
      const result = stdout.trim();
      if (!result) return null;
      return result;
    } catch (error: unknown) {
      if (hasCode(error) && error.code === "ENOENT") {
        lastError = error;
        continue;
      }
      const message = error instanceof Error ? error.message : "";
      if (message.includes("exit code 1")) return null;
      lastError = error;
      break;
    }
  }
  if (lastError) throw lastError;
  return null;
}

async function pickOnLinux(currentPath?: string): Promise<string | null> {
  const filenameArg = currentPath ? `--filename=${currentPath}/` : "";
  const title = "选择项目目录";
  const tries: Array<{ cmd: string; args: string[] }> = [
    { cmd: "zenity", args: ["--file-selection", "--directory", `--title=${title}`, ...(filenameArg ? [filenameArg] : [])] },
    { cmd: "kdialog", args: ["--getexistingdirectory", currentPath || homedir(), "--title", title] },
    { cmd: "yad", args: ["--file-selection", "--directory", `--title=${title}`, ...(filenameArg ? [`--filename=${filenameArg}`] : [])] },
  ];
  let lastError: unknown = null;
  for (const { cmd, args } of tries) {
    try {
      const { stdout } = await execFileAsync(cmd, args, { timeout: 60000 });
      const result = stdout.trim();
      if (!result) return null;
      return result;
    } catch (error: unknown) {
      if (hasCode(error) && error.code === "ENOENT") {
        lastError = error;
        continue;
      }
      const message = error instanceof Error ? error.message : "";
      if (message.includes("exit code 1")) return null;
      lastError = error;
      break;
    }
  }
  if (lastError) throw lastError;
  throw new Error("ENOENT_NATIVE: No native file dialog available (install zenity, kdialog or yad)");
}

// POST /api/cwd/pick — open native OS folder picker on the server's desktop
export async function POST(request: NextRequest) {
  try {
    const _isLocal = isLocalRequest(request);
    void _isLocal;
    let body: { currentPath?: string } = {};
    try {
      body = (await request.json()) as { currentPath?: string };
    } catch {
      // empty body is fine
    }
    const currentPath = typeof body.currentPath === "string" ? body.currentPath.trim() || undefined : undefined;
    const platform = process.platform;
    let picked: string | null = null;
    if (platform === "darwin") {
      try {
        picked = await pickOnMac(currentPath);
      } catch (error: unknown) {
        if (hasCode(error) && error.code === "ENOENT") {
          return NextResponse.json({ error: "osascript not available", fallback: true }, { status: 501 });
        }
        throw error;
      }
    } else if (platform === "win32") {
      try {
        picked = await pickOnWindows(currentPath);
      } catch (error: unknown) {
        if (hasCode(error) && error.code === "ENOENT") {
          return NextResponse.json({ error: "No PowerShell available", fallback: true }, { status: 501 });
        }
        throw error;
      }
    } else {
      if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        return NextResponse.json({ error: "No display available for native dialog", fallback: true }, { status: 501 });
      }
      try {
        picked = await pickOnLinux(currentPath);
      } catch (error: unknown) {
        if (hasCode(error) && (error.code === "ENOENT" || error.code === "ENOENT_NATIVE")) {
          const message = error instanceof Error ? error.message : "No native dialog";
          return NextResponse.json({ error: message, fallback: true }, { status: 501 });
        }
        throw error;
      }
    }
    if (picked === null || picked === "") {
      return NextResponse.json({ cancelled: true });
    }
    let resolved: string;
    try {
      resolved = await resolveDirectory(picked);
    } catch {
      return NextResponse.json({ error: "Selected path does not exist" }, { status: 400 });
    }
    let directoryStat: Stats | null = null;
    try {
      directoryStat = await stat(resolved);
    } catch {
      return NextResponse.json({ error: "Cannot access selected directory" }, { status: 400 });
    }
    if (!directoryStat.isDirectory()) {
      return NextResponse.json({ error: "Selected path is not a directory" }, { status: 400 });
    }
    return NextResponse.json({ cwd: resolved });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("-128") || message.includes("User canceled")) {
      return NextResponse.json({ cancelled: true });
    }
    return NextResponse.json({ error: message || "Failed to open native picker" }, { status: 500 });
  }
}
