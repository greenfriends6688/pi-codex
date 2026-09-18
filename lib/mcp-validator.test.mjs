/**
 * lib/mcp-validator.test.mjs 对应的被测模块见 ./mcp-validator.ts。
 * 中文注释：MCP 握手验证单测——全部用 mock 注入（fake 子进程 / fake fetch），
 * 绝不真连网、不拉真子进程；覆盖成功 / 失败 / 超时三类路径。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { validateMcpServer, isStdioConfig, parseSseEndpoint, parseSseResponses } =
  await jiti.import("./mcp-validator.ts");

/** 确定性 id 生成器：单测可预测请求 id。 */
function makeIds() {
  let next = 1000;
  return () => next++;
}

/**
 * fake stdio 子进程：收到 request 行就按 behavior 回响应；
 * behavior(request) 返回响应对象 / null（不回，即模拟超时）。
 */
function makeFakeSpawn(behavior) {
  const spawned = [];
  const spawnImpl = (command, args, options) => {
    const listeners = {};
    let killed = null;
    const child = {
      get killedSignal() { return killed; },
      stdin: {
        write(line) {
          let request = null;
          try {
            request = JSON.parse(String(line));
          } catch {
            return;
          }
          if (!request || !("id" in request)) return; // notification 不回
          const response = behavior(request);
          if (response) {
            setImmediate(() => listeners.data?.(`${JSON.stringify(response)}\n`));
          }
        },
        end() {},
      },
      stdout: {
        on(event, listener) { listeners[event] = listener; },
      },
      on(event, listener) { listeners[`child:${event}`] = listener; },
      kill(signal) { killed = signal ?? "SIGKILL"; },
    };
    spawned.push({ command, args, options, child, listeners });
    return child;
  };
  return { spawnImpl, spawned };
}

const SUCCESS_BEHAVIOR = (request) => {
  if (request.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "mock", version: "1" } },
    };
  }
  if (request.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: { tools: [{ name: "t1", description: "d1" }, { name: "t2" }] },
    };
  }
  return null;
};

function jsonResponse(payload, { status = 200, contentType = "application/json", sessionId = null } = {}) {
  return {
    status,
    headers: {
      get(name) {
        const lower = String(name).toLowerCase();
        if (lower === "content-type") return contentType;
        if (lower === "mcp-session-id") return sessionId;
        return null;
      },
    },
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
  };
}

/** fake fetch：按 body 里的 method 分发；never 模式模拟 hang 住。 */
function makeFakeFetch({ mode = "ok", sseBody = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const body = init.body ? JSON.parse(init.body) : {};
    if (mode === "http500") return jsonResponse("boom", { status: 500 });
    if (mode === "reject") throw new Error("connect ECONNREFUSED 127.0.0.1:1");
    if (mode === "hang") {
      return new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
      });
    }
    if (init.method === "GET") {
      // legacy SSE 建流：endpoint 事件 + 预置的响应（id 由 makeIds 确定）。
      return jsonResponse("event: endpoint\ndata: /messages?sid=1\n\n", { contentType: "text/event-stream" });
    }
    let payload;
    if (body.method === "initialize") {
      payload = { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05", capabilities: {} } };
    } else if (body.method === "tools/list") {
      payload = { jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "web-tool" }] } };
    } else {
      payload = { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "unknown" } };
    }
    if (sseBody) {
      return jsonResponse(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, { contentType: "text/event-stream" });
    }
    return jsonResponse(payload);
  };
  return { fetchImpl, calls };
}

test("stdio 成功：initialize + tools/list 走完并返回工具", async () => {
  const { spawnImpl, spawned } = makeFakeSpawn(SUCCESS_BEHAVIOR);
  const result = await validateMcpServer(
    { command: "mock-server", args: ["--x"] },
    { timeoutMs: 2000 },
    { spawnImpl, randomId: makeIds() },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.tools, [{ name: "t1", description: "d1" }, { name: "t2" }]);
  assert.equal(typeof result.durationMs, "number");
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].command, "mock-server");
});

test("stdio 超时：server 不回包时返回 timeout 而不是挂起", async () => {
  const { spawnImpl } = makeFakeSpawn(() => null);
  const result = await validateMcpServer(
    { command: "mute-server" },
    { timeoutMs: 60 },
    { spawnImpl, randomId: makeIds() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "timeout");
  assert.ok(result.durationMs < 2000);
});

test("stdio 异常：spawn 抛错 / tools 缺失都转为错误对象", async () => {
  const throwing = () => { throw new Error("ENOENT"); };
  const failed = await validateMcpServer({ command: "nope" }, { timeoutMs: 1000 }, { spawnImpl: throwing });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "spawn-failed");

  const { spawnImpl } = makeFakeSpawn((request) => ({
    jsonrpc: "2.0",
    id: request.id,
    result: request.method === "initialize" ? { protocolVersion: "x" } : { tools: "not-an-array" },
  }));
  const badTools = await validateMcpServer({ command: "weird" }, { timeoutMs: 1000 }, { spawnImpl, randomId: makeIds() });
  assert.equal(badTools.ok, false);
  assert.equal(badTools.error, "protocol-error");
});

test("非法配置直接返回 invalid-config（不抛异常）", async () => {
  assert.equal((await validateMcpServer({ command: "  " }, { timeoutMs: 500 })).error, "invalid-config");
  assert.equal((await validateMcpServer({ transport: "http", url: "ftp://x" }, { timeoutMs: 500 })).error, "invalid-config");
  assert.equal((await validateMcpServer(null, { timeoutMs: 500 })).error, "invalid-config");
});

test("http 成功：纯 JSON 与 SSE 包裝两种响应体都接受", async () => {
  for (const sseBody of [false, true]) {
    const { fetchImpl } = makeFakeFetch({ sseBody });
    const result = await validateMcpServer(
      { transport: "http", url: "https://example.com/mcp" },
      { timeoutMs: 2000 },
      { fetchImpl, randomId: makeIds() },
    );
    assert.equal(result.ok, true, `sseBody=${sseBody}`);
    assert.deepEqual(result.tools, [{ name: "web-tool" }]);
  }
});

test("http 失败：500 / 拒连 / 超时都转为错误对象", async () => {
  const { fetchImpl: f500 } = makeFakeFetch({ mode: "http500" });
  const r500 = await validateMcpServer({ transport: "http", url: "https://example.com/mcp" }, { timeoutMs: 1000 }, { fetchImpl: f500, randomId: makeIds() });
  assert.equal(r500.ok, false);
  assert.equal(r500.error, "http-error");

  const { fetchImpl: fRefused } = makeFakeFetch({ mode: "reject" });
  const rRefused = await validateMcpServer({ transport: "http", url: "https://example.com/mcp" }, { timeoutMs: 1000 }, { fetchImpl: fRefused, randomId: makeIds() });
  assert.equal(rRefused.ok, false);
  assert.equal(rRefused.error, "connection-refused");

  const { fetchImpl: fHang } = makeFakeFetch({ mode: "hang" });
  const rTimeout = await validateMcpServer({ transport: "http", url: "https://example.com/mcp" }, { timeoutMs: 60 }, { fetchImpl: fHang, randomId: makeIds() });
  assert.equal(rTimeout.ok, false);
  assert.equal(rTimeout.error, "timeout");
});

test("sse 成功：GET 建流取 endpoint 后 POST 握手", async () => {
  const { fetchImpl, calls } = makeFakeFetch({});
  const result = await validateMcpServer(
    { transport: "sse", url: "https://example.com/sse" },
    { timeoutMs: 2000 },
    { fetchImpl, randomId: makeIds() },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.tools, [{ name: "web-tool" }]);
  assert.ok(calls.some((call) => call.init.method === "GET"), "必须先 GET 建流");
});

test("isStdioConfig / parseSseEndpoint / parseSseResponses 单元行为", () => {
  assert.equal(isStdioConfig({ command: "x" }), true);
  assert.equal(isStdioConfig({ transport: "http", url: "https://x" }), false);
  assert.equal(parseSseEndpoint("event: endpoint\ndata: /msg\n\n"), "/msg");
  assert.equal(parseSseEndpoint("data: hello\n\n"), null);
  const responses = parseSseResponses('data: {"jsonrpc":"2.0","id":7,"result":{}}\ndata: /messages\n\n');
  assert.deepEqual([...responses.keys()], [7]);
});
