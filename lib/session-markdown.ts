import type { SessionEntry, SessionMessageEntry, SessionHeader } from "./types";

/**
 * fork:ui-18 — a session as a Markdown document.
 *
 * The HTML export (delegated to pi's own exporter, `/export`) is for sharing a
 * rendered transcript; this is for the case people actually hit: "give me the
 * conversation as text" — to paste into a doc, a PR description or another model.
 *
 * Rules that keep the output useful rather than exhaustive:
 *   - text and user messages are verbatim;
 *   - tool calls collapse to a one-line summary (name + first argument), never the
 *     raw JSON blob — a 4000-line transcript is not a document;
 *   - tool results are summarised to their first lines, and truncated;
 *   - thinking blocks are dropped (they are not part of what was said).
 */

/** Cap for a single tool result block in the output. */
export const MARKDOWN_TOOL_RESULT_MAX_CHARS = 600;

function oneLine(value: string, max = 160): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function summariseInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  for (const key of ["command", "path", "file_path", "pattern", "query", "url", "description"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return oneLine(value);
  }
  const firstString = Object.values(record).find((value) => typeof value === "string" && value.trim());
  return typeof firstString === "string" ? oneLine(firstString) : "";
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block as { type?: string; text?: string; thinking?: string };
    if (typed.type === "text" && typeof typed.text === "string") parts.push(typed.text);
    // thinking is intentionally skipped: it is not part of the conversation.
  }
  return parts.join("\n\n").trim();
}

/** `## User` / `## Assistant` sections with tool activity as bullet lines. */
export function sessionToMarkdown(header: SessionHeader | null, entries: readonly SessionEntry[]): string {
  const lines: string[] = [];
  const title = header?.id ? `Session ${header.id}` : "Session";
  lines.push(`# ${title}`, "");
  if (header?.cwd) lines.push(`- **cwd**: \`${header.cwd}\``);
  if (header?.timestamp) lines.push(`- **started**: ${header.timestamp}`);
  lines.push("");

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = (entry as SessionMessageEntry).message as {
      role?: string;
      content?: unknown;
      toolName?: string;
      toolCallId?: string;
      details?: unknown;
    };
    if (!message?.role) continue;

    if (message.role === "user") {
      const text = messageText(message.content);
      if (text) lines.push("## User", "", text, "");
      continue;
    }
    if (message.role === "assistant") {
      const content = Array.isArray(message.content) ? message.content : [];
      const text = messageText(content);
      const calls = content
        .filter((block) => block && typeof block === "object" && (block as { type?: string }).type === "toolCall")
        .map((block) => {
          const call = block as { name?: string; arguments?: unknown; input?: unknown };
          const summary = summariseInput(call.arguments ?? call.input);
          return `- \`${call.name ?? "tool"}\`${summary ? ` — ${summary}` : ""}`;
        });
      const body = [text, calls.length > 0 ? calls.join("\n") : ""].filter(Boolean).join("\n\n");
      if (body) lines.push("## Assistant", "", body, "");
      continue;
    }
    if (message.role === "toolResult") {
      const text = messageText(message.content);
      if (!text) continue;
      const clipped = text.length > MARKDOWN_TOOL_RESULT_MAX_CHARS
        ? `${text.slice(0, MARKDOWN_TOOL_RESULT_MAX_CHARS)}…`
        : text;
      lines.push(`<details><summary>${message.toolName ?? "tool"} result</summary>`, "", "```", clipped.trimEnd(), "```", "", "</details>", "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
