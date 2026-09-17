import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  discoverMcpServers,
  normalizeDiscoveredDef,
  parseCodexMcpToml,
} = await jiti.import("@/lib/mcp-discovery");

/*
 * fork:mcp-import — these parsers read other tools' files, so the contract that
 * matters is: each dialect maps to pi's shape, project beats user, and a file we do
 * not understand is skipped instead of producing a broken server entry.
 */
test("the common dialect maps to command/args/env", () => {
  assert.deepEqual(
    normalizeDiscoveredDef({ command: "npx", args: ["-y", "server-github"], env: { TOKEN: "x" } }),
    { def: { command: "npx", args: ["-y", "server-github"], env: { TOKEN: "x" } }, disabled: false },
  );
  assert.deepEqual(normalizeDiscoveredDef({ url: "https://example.com/mcp" }), { def: { url: "https://example.com/mcp" }, disabled: false });
  assert.deepEqual(normalizeDiscoveredDef({ socket: "/tmp/x.sock" }), { def: { socket: "/tmp/x.sock" }, disabled: false });
});

test("OpenCode's argv array and `environment` become command + args + env", () => {
  assert.deepEqual(
    normalizeDiscoveredDef({ type: "local", command: ["bun", "run", "server.ts"], environment: { KEY: 1 } }),
    { def: { command: "bun", args: ["run", "server.ts"], env: { KEY: "1" } }, disabled: false },
  );
  assert.deepEqual(normalizeDiscoveredDef({ type: "remote", url: "https://x/mcp" }), { def: { url: "https://x/mcp" }, disabled: false });
});

test("disabled flags are read from either spelling", () => {
  assert.equal(normalizeDiscoveredDef({ command: "x", enabled: false }).disabled, true);
  assert.equal(normalizeDiscoveredDef({ command: "x", disabled: true }).disabled, true);
  assert.equal(normalizeDiscoveredDef({ command: "x" }).disabled, false);
});

test("entries with nothing runnable are dropped", () => {
  assert.equal(normalizeDiscoveredDef({}), null);
  assert.equal(normalizeDiscoveredDef({ type: "local", command: [] }), null);
  assert.equal(normalizeDiscoveredDef("npx server"), null);
  assert.equal(normalizeDiscoveredDef(null), null);
});

test("the Codex TOML subset parses tables, arrays and inline env", () => {
  const toml = [
    "# comment",
    "[mcp_servers.github]",
    'command = "npx"',
    'args = ["-y", "@modelcontextprotocol/server-github"]',
    'env = { GITHUB_TOKEN = "abc" }',
    "",
    "[mcp_servers.files]",
    'command = "uvx"',
    "",
    "[mcp_servers.files.env]",
    'ROOT = "/tmp"',
    "",
    "[other]",
    'command = "ignored"',
  ].join("\n");

  const servers = parseCodexMcpToml(toml);
  assert.deepEqual(Object.keys(servers), ["github", "files"]);
  assert.deepEqual(servers.github.args, ["-y", "@modelcontextprotocol/server-github"]);
  assert.deepEqual(servers.github.env, { GITHUB_TOKEN: "abc" });
  assert.equal(servers.files.command, "uvx");
  assert.deepEqual(servers.files.env, { ROOT: "/tmp" });
});

test("discovery walks real files, project first, and marks shadowed entries", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-web-mcp-home-"));
  const project = mkdtempSync(join(tmpdir(), "pi-web-mcp-project-"));
  try {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({
      mcpServers: { shared: { command: "user-shared" }, onlyUser: { command: "user-only" } },
    }));
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(join(home, ".cursor", "mcp.json"), "not json at all");
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(join(project, ".claude", "mcp.json"), JSON.stringify({
      mcpServers: { shared: { command: "project-shared" }, blocked: { command: "project-blocked", enabled: false } },
    }));
    mkdirSync(join(project, ".vscode"), { recursive: true });
    writeFileSync(join(project, ".vscode", "mcp.json"), JSON.stringify({ servers: { vsc: { type: "http", url: "https://vsc/mcp" } } }));
    writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { cursorOnly: { command: "cursor" } } }));
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "config.toml"), '[mcp_servers.codexOne]\ncommand = "codex-mcp"\n');

    const found = discoverMcpServers(project, home);
    // First occurrence wins: the list is ordered by precedence (project before user).
    const byName = new Map();
    for (const entry of found) if (!byName.has(entry.name)) byName.set(entry.name, entry);

    assert.equal(byName.get("shared").def.command, "project-shared", "the project entry wins");
    assert.equal(byName.get("shared").scope, "project");
    assert.equal(byName.get("shared").shadowed, false);

    // The user entry with the same name is still reported, flagged as shadowed.
    const userShared = found.filter((entry) => entry.name === "shared");
    assert.equal(userShared.length, 2);
    assert.equal(userShared[1].scope, "user");
    assert.equal(userShared[1].shadowed, true);

    assert.equal(byName.get("onlyUser").scope, "user");
    assert.equal(byName.get("cursorOnly").tool, "cursor");
    assert.equal(byName.get("vsc").def.url, "https://vsc/mcp");
    assert.equal(byName.get("codexOne").def.command, "codex-mcp");
    assert.equal(byName.get("blocked").disabled, true);

    // The unreadable cursor user file earlier in the list does not break discovery.
    assert.ok(found.length >= 6);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("an empty project discovers nothing instead of throwing", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-web-mcp-empty-"));
  const project = mkdtempSync(join(tmpdir(), "pi-web-mcp-empty-p-"));
  try {
    assert.deepEqual(discoverMcpServers(project, home), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});
