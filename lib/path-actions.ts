/**
 * fork:ui-20 — pure part of the "path actions" (copy path / reveal in file
 * manager / open with default app).
 *
 * The app runs on the user's own machine, so revealing a file or handing it to
 * the OS opener is a normal thing to want from the file tree and the viewer —
 * MusePi exposes the same two actions from its file pane
 * (`FilePane.tsx:922-943`). Only the command construction is pure and testable;
 * the route owns the guard and the spawn.
 *
 * Commands are returned as argv arrays and always run without a shell: a path
 * can contain spaces, quotes or `;` and must never be re-parsed by `sh`.
 */

export const PATH_ACTION_VALUES = ["reveal", "open"] as const;
export type PathAction = (typeof PATH_ACTION_VALUES)[number];

export function isPathAction(value: unknown): value is PathAction {
  return typeof value === "string" && (PATH_ACTION_VALUES as readonly string[]).includes(value);
}

export interface PathCommand {
  command: string;
  args: string[];
}

export interface PathActionOptions {
  platform?: NodeJS.Platform;
  /** The caller already stat'ed the target; revealing a folder opens the folder. */
  isDirectory?: boolean;
  /** Injectable for tests; defaults to a minimal cross-platform dirname. */
  dirname?: (p: string) => string;
}

/**
 * Platform opener. `reveal` selects the file in the file manager, `open` hands it
 * to the default application.
 *
 * Linux has no portable "reveal" (the spec is file-manager specific), so it opens
 * the containing directory — or the directory itself when the target *is* a
 * folder, which is what `open -R`/`/select,` do on the other two platforms.
 */
export function pathActionCommand(
  action: PathAction,
  target: string,
  options: PathActionOptions = {},
): PathCommand {
  const { platform = process.platform, isDirectory = false, dirname = defaultDirname } = options;
  if (platform === "darwin") {
    return action === "reveal" ? { command: "open", args: ["-R", target] } : { command: "open", args: [target] };
  }
  if (platform === "win32") {
    if (action === "reveal") return { command: "explorer", args: [`/select,${target}`] };
    // `start` is a cmd builtin; `""` is the window title so a quoted path is not
    // swallowed as the title.
    return { command: "cmd", args: ["/c", "start", "", target] };
  }
  if (action === "open") return { command: "xdg-open", args: [target] };
  return { command: "xdg-open", args: [isDirectory ? target : dirname(target)] };
}

/** Minimal POSIX/Windows-agnostic dirname; the route has no path module needs beyond this. */
export function defaultDirname(p: string): string {
  const normalized = p.replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (index <= 0) return normalized.slice(0, index + 1) || "/";
  return normalized.slice(0, index);
}
