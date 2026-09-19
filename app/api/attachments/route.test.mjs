import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

// 附件目录必须在 agent 目录下 —— 用临时目录当 agent 目录，绝不碰真实的那份。
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-attachments-"));
mkdirSync(agentDir, { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, attachmentsDirectory } = await jiti.import("./route.ts");

function request(headers = {}) {
  return new NextRequest("http://localhost/api/attachments", {
    method: "GET",
    headers: {
      Host: "localhost",
      Origin: "http://localhost",
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
  });
}

test("按天分桶，且位于 agent 目录下", () => {
  const dir = attachmentsDirectory(new Date("2026-09-18T10:00:00Z"));
  assert.ok(dir.startsWith(agentDir), `${dir} should live under ${agentDir}`);
  assert.match(dir, /attachments[\\/]2026-09-18$/);
});

test("GET 创建目录并返回路径", async () => {
  const res = await GET(request());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.dir.startsWith(agentDir));
  assert.equal(existsSync(body.dir), true);
});

test("跨站请求在创建目录之前就被拒", async () => {
  const res = await GET(request({ Origin: "http://evil.example", "Sec-Fetch-Site": "cross-site" }));
  assert.equal(res.status, 403);
});
