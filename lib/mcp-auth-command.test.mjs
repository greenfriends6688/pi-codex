import assert from "node:assert/strict";
import test from "node:test";

/*
 * ZC-18 — pins the pure part of the MCP OAuth entry point.
 *
 * The commands built here are handed to the user (copied to the clipboard) and
 * run inside a chat session by `pi-mcp-adapter`. Server names come from a
 * user-editable mcp.json, so the injection cases below are the security
 * contract: a name must never be able to smuggle a second slash command or a
 * second line into the generated string.
 */

async function loadSubject() {
  return import("./mcp-auth-command.ts");
}

test("isRemoteMcpServer accepts url-based http/sse servers only", async () => {
  const { isRemoteMcpServer } = await loadSubject();

  assert.equal(isRemoteMcpServer({ kind: "url", url: "https://example.com/mcp" }), true);
  assert.equal(isRemoteMcpServer({ transport: "http", url: "http://127.0.0.1:8931/mcp" }), true);
  assert.equal(isRemoteMcpServer({ transport: "sse", url: "https://example.com/sse" }), true);
  // Raw mcp.json definition with both command and url: the route derives kind from
  // url first, so this is the http/sse server the panel shows.
  assert.equal(isRemoteMcpServer({ command: "npx", url: "https://example.com/mcp" }), true);

  assert.equal(isRemoteMcpServer({ kind: "command", command: "npx", args: ["-y", "server"] }), false);
  assert.equal(isRemoteMcpServer({ kind: "socket", socket: "/tmp/mcp.sock" }), false);
  assert.equal(isRemoteMcpServer({ transport: "stdio", command: "npx" }), false);
  assert.equal(isRemoteMcpServer({ kind: "url" }), false);
  assert.equal(isRemoteMcpServer({ kind: "url", url: "file:///tmp/mcp.sock" }), false);
  assert.equal(isRemoteMcpServer(null), false);
  assert.equal(isRemoteMcpServer(undefined), false);
});

test("buildMcpAuthCommand / buildMcpLogoutCommand build the exact commands", async () => {
  const { buildMcpAuthCommand, buildMcpLogoutCommand } = await loadSubject();

  assert.equal(buildMcpAuthCommand("github"), "/mcp-auth github");
  assert.equal(buildMcpAuthCommand("my server"), "/mcp-auth my server");
  assert.equal(buildMcpLogoutCommand("github"), "/mcp logout github");
  assert.equal(buildMcpLogoutCommand("my server"), "/mcp logout my server");
});

test("a newline in the server name cannot start a second slash command", async () => {
  const { buildMcpAuthCommand, buildMcpLogoutCommand } = await loadSubject();

  const injected = "foo\n/mcp logout bar";
  assert.equal(buildMcpAuthCommand(injected), null);
  assert.equal(buildMcpLogoutCommand(injected), null);

  // Every line terminator JavaScript treats as one, plus CRLF and the Unicode
  // separators, must be rejected the same way.
  assert.equal(buildMcpAuthCommand("foo\r\n/mcp logout bar"), null);
  assert.equal(buildMcpAuthCommand("foo\r/mcp logout bar"), null);
  assert.equal(buildMcpAuthCommand("foo\u2028/mcp logout bar"), null);
  assert.equal(buildMcpAuthCommand("foo\u2029/mcp logout bar"), null);
  assert.equal(buildMcpAuthCommand("foo\u0000bar"), null);
  assert.equal(buildMcpAuthCommand("foo\u007fbar"), null);
});

test("shell metacharacters stay inside one single-line command", async () => {
  const { buildMcpAuthCommand } = await loadSubject();

  const command = buildMcpAuthCommand("foo; rm -rf /");
  // Slash commands are not shell lines, so the metacharacters remain part of the
  // (nonexistent) server name. The security property to pin is that the string
  // is exactly one line with no second command to run.
  assert.equal(command, "/mcp-auth foo; rm -rf /");
  assert.equal(command.split("\n").length, 1);
  assert.equal(command.includes("\n"), false);
  assert.equal(command.includes("\r"), false);
  assert.equal(command.startsWith("/mcp-auth "), true);
});

test("empty, padded and non-string names are rejected", async () => {
  const { buildMcpAuthCommand, buildMcpLogoutCommand } = await loadSubject();

  assert.equal(buildMcpAuthCommand(""), null);
  assert.equal(buildMcpAuthCommand("   "), null);
  assert.equal(buildMcpAuthCommand(" padded"), null);
  assert.equal(buildMcpAuthCommand("padded "), null);
  assert.equal(buildMcpAuthCommand(undefined), null);
  assert.equal(buildMcpAuthCommand(null), null);
  assert.equal(buildMcpAuthCommand(42), null);
  assert.equal(buildMcpLogoutCommand(""), null);
  assert.equal(buildMcpLogoutCommand(undefined), null);
});
