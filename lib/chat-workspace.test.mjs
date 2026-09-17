import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  defaultChatWorkspacePath,
  ensureChatWorkspace,
  getChatWorkspacePath,
  invalidateChatWorkspaceCache,
  isChatWorkspacePath,
  normalizeChatWorkspaceInput,
  writeChatWorkspacePath,
} = await jiti.import("./chat-workspace.ts");

function tempDir() {
  return mkdtempSync(join(tmpdir(), "pi-web-chat-workspace-"));
}

test("falls back to the default chat workspace when no config exists", () => {
  const dir = tempDir();
  try {
    const configPath = join(dir, "pi-web-chat.json");
    assert.equal(getChatWorkspacePath(configPath), defaultChatWorkspacePath());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a malformed config never blocks the chat workspace", () => {
  const dir = tempDir();
  try {
    const configPath = join(dir, "pi-web-chat.json");
    writeFileSync(configPath, JSON.stringify(["not", "an", "object"]), "utf8");
    assert.equal(getChatWorkspacePath(configPath), defaultChatWorkspacePath());

    writeFileSync(configPath, "{not json", "utf8");
    invalidateChatWorkspaceCache(configPath);
    assert.equal(getChatWorkspacePath(configPath), defaultChatWorkspacePath());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("persists a chosen directory, creates it, and preserves unknown config keys", () => {
  const dir = tempDir();
  try {
    const configPath = join(dir, "pi-web-chat.json");
    const chosen = join(dir, "custom-chat");
    writeFileSync(configPath, JSON.stringify({ version: 1, future: { keep: true } }), "utf8");

    assert.equal(writeChatWorkspacePath(chosen, configPath), chosen);
    assert.equal(getChatWorkspacePath(configPath), chosen);
    assert.ok(isChatWorkspacePath(chosen, configPath));
    assert.ok(!isChatWorkspacePath(join(dir, "elsewhere"), configPath));

    const stored = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(stored.path, chosen);
    assert.equal(stored.version, 1);
    assert.deepEqual(stored.future, { keep: true });

    // ensureChatWorkspace() never rewrites the config, only the directory.
    const ensured = ensureChatWorkspace(configPath);
    assert.equal(ensured, chosen);
    assert.equal(JSON.parse(readFileSync(configPath, "utf8")).path, chosen);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an existing config is re-read after the cache is dropped", () => {
  const dir = tempDir();
  try {
    const configPath = join(dir, "pi-web-chat.json");
    writeFileSync(configPath, JSON.stringify({ version: 1, path: join(dir, "first") }), "utf8");
    assert.equal(getChatWorkspacePath(configPath), join(dir, "first"));

    writeFileSync(configPath, JSON.stringify({ version: 1, path: join(dir, "second") }), "utf8");
    invalidateChatWorkspaceCache(configPath);
    assert.equal(getChatWorkspacePath(configPath), join(dir, "second"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("normalizes tilde and rejects empty or relative input", () => {
  const expanded = normalizeChatWorkspaceInput("~/chats");
  assert.ok(isAbsolute(expanded));
  assert.match(expanded.replace(/\\/g, "/"), /\/chats$/);
  assert.equal(normalizeChatWorkspaceInput("~"), normalizeChatWorkspaceInput(homedir()));

  assert.equal(normalizeChatWorkspaceInput("   "), "");
  assert.equal(normalizeChatWorkspaceInput("relative/path"), "");
  assert.equal(normalizeChatWorkspaceInput(""), "");
});

test("windows path variants of the chat workspace stay equivalent", () => {
  const dir = tempDir();
  try {
    const configPath = join(dir, "pi-web-chat.json");
    const chosen = join(dir, "chats");
    mkdirSync(chosen, { recursive: true });
    writeChatWorkspacePath(chosen, configPath);

    const variant = process.platform === "win32" ? chosen.toUpperCase() : `${chosen}/`;
    assert.ok(isChatWorkspacePath(variant, configPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
