"use client";

import type { ReactNode } from "react";
import { PluginsConfig } from "../PluginsConfig";

/*
 * fork:mcp-section — MCP server management as its own settings entry.
 *
 * The implementation lives in PluginsConfig (its loaders, action plumbing and the
 * add/edit forms are shared), which exposes an `only="mcp"` mode: this page renders
 * the MCP half with the plugin half hidden, and the plug-ins page renders the
 * reverse. Splitting the 500 lines of MCP code into a second file was possible but
 * would have duplicated the request plumbing for no user-visible gain.
 */

export function McpConfig({
  cwd,
  sessionId,
  onClose,
  onReloaded,
}: {
  cwd: string | null;
  sessionId: string | null;
  onClose: () => void;
  onReloaded?: () => void;
}): ReactNode {
  return (
    <PluginsConfig
      embedded
      only="mcp"
      cwd={cwd ?? ""}
      sessionId={sessionId}
      onClose={onClose}
      onReloaded={onReloaded}
    />
  );
}
