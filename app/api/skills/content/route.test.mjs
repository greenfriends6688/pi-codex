import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:skills-content — 技能正文读写是**信任边界**：全局技能目录
// （~/.pi/agent/skills、~/.agents/skills）不在 /api/files 的允许根里，这条路由
// 自己补根校验。所以这里按源码断言钉住三件事：鉴权、根校验、乐观并发。
const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

test("both methods guard the request before touching the filesystem", () => {
  assert.match(source, /export async function GET\(request: Request\)/);
  assert.match(source, /export async function PUT\(request: Request\)/);
  assert.match(source, /hasJsonContentType\(request\)/);
  assert.match(source, /isExistingFilePathAllowed\(filePath, allowedRoots\)/);
  // 与 /api/skills 的 PATCH 用同一套根：会话可访问根 + agent 目录 + 全局技能目录。
  assert.match(source, /allowedRoots\.add\(getAgentDir\(\)\)/);
  assert.match(source, /path\.join\(homedir\(\), "\.agents", "skills"\)/);
});

test("rejects bad input instead of writing it", () => {
  assert.match(source, /typeof body\.content !== "string"/);
  assert.match(source, /MAX_SKILL_CONTENT_BYTES/);
  assert.match(source, /status: 413/);
  assert.match(source, /status: 403/);
  assert.match(source, /status: 404/);
});

test("refuses to overwrite a file that changed underneath the editor", () => {
  assert.match(source, /body\.baseContent !== current/);
  assert.match(source, /error: "SKILL\.md changed on disk", content: current/);
  assert.match(source, /status: 409/);
});
