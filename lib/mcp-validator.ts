/**
 * lib/mcp-validator.ts
 *
 * 用途：MCP server 启用前握手验证（GAP-18 的第一步）。对候选 server 做一次
 * 真实握手（`initialize` + `tools/list`），只有验证通过才允许写 enabled，
 * 避免把“指不到的 server”标记为已启用。
 *
 * 仓内没有 @modelcontextprotocol/sdk 依赖，所以这里用手写 JSON-RPC：
 * - stdio：经 node:child_process spawn 子进程，行分隔 JSON 走 stdin/stdout；
 * - http（Streamable HTTP）：POST initialize + POST tools/list，兼容纯 JSON
 *   与 text/event-stream 两种响应体；
 * - sse（legacy SSE）：先 GET 建流拿到 `endpoint` 事件，再把 JSON-RPC POST
 *   到该地址，响应从 GET 流里按 id 相关。
 *
 * 安全边界：
 * - 只做只读握手，绝不调用任何 tool；stdio 默认不给 shell（shell:false），
 *   避免 command 注入；headers/凭据只放在内存里，不写任何文件。
 * - 任何失败都返回错误对象，绝不抛异常（调用方无需 try/catch 也能降级）。
 * 性能边界：
 * - 全程超时保护（默认 10s），超时后杀掉子进程 / abort 掉 fetch；
 * - stdout 缓冲与 HTTP 响应体都有上限，超限即判 bad-response，防止被
 *   恶意 server 用无限输出拖死。
 *
 * 服务端与客户端都可 import 类型；但实际握手只应在服务端路由里调用
 * （浏览器里没有 child_process，stdio 会直接返回 unsupported）。
 */

export type McpTransport = "stdio" | "http" | "sse";

/** stdio 传输：拉起本地命令做握手。 */
export interface McpStdioConfig {
  transport?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/** http / sse 传输：连远程地址做握手。 */
export interface McpHttpConfig {
  transport: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioConfig | McpHttpConfig;

export interface McpToolInfo {
  name: string;
  description?: string;
}

/**
 * 机器可读的错误码（非展示文案：UI 接线时再映射到 lib/i18n，不直接展示）。
 * invalid-config/conection… 等只说明失败种类，细节进 detail。
 */
export type McpValidationError =
  | "invalid-config"
  | "unsupported"
  | "spawn-failed"
  | "timeout"
  | "connection-refused"
  | "http-error"
  | "bad-response"
  | "protocol-error";

export interface McpValidationResult {
  ok: boolean;
  tools?: McpToolInfo[];
  error?: McpValidationError;
  /** 给日志/排障看的细节，绝不在 UI 上原文展示。 */
  detail?: string;
  durationMs: number;
}

export interface McpValidateOptions {
  /** 全程超时毫秒数，默认 10000。 */
  timeoutMs?: number;
}

/** 可注入的依赖：单测用 mock 注入，生产走默认实现。 */
export interface McpValidatorDeps {
  spawnImpl?: (
    command: string,
    args: string[],
    options: { env?: Record<string, string>; cwd?: string },
  ) => McpChildProcess;
  fetchImpl?: (url: string, init: McpFetchInit) => Promise<McpFetchResponse>;
  /** JSON-RPC id 生成器，单测注入确定性序列。 */
  randomId?: () => string | number;
}

/** 只描述本模块用到的最小子进程面，便于 mock。 */
export interface McpChildProcess {
  stdin: { write: (data: string) => void; end: () => void } | null;
  stdout: { on: (event: string, listener: (chunk: string | Uint8Array) => void) => void } | null;
  on: (event: string, listener: (...args: Array<string | number | null>) => void) => void;
  kill: (signal?: string) => void;
}

export interface McpFetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface McpFetchResponse {
  status: number;
  headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_STDIO_BUFFER = 4 * 1024 * 1024;
const MAX_HTTP_BODY = 2 * 1024 * 1024;
const CLIENT_INFO = { name: "pi-web", version: "0.9.0" };
const PROTOCOL_VERSION = "2024-11-05";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStdioConfig(config: McpServerConfig): config is McpStdioConfig {
  // 与 resolveTransport 同口径：没有可用 url 即视为 stdio。
  return !("url" in config) || typeof (config as McpHttpConfig).url !== "string";
}

function resolveTransport(config: McpServerConfig): McpTransport {
  if ("url" in config && typeof config.url === "string") {
    return config.transport === "sse" ? "sse" : "http";
  }
  return "stdio";
}

function normalizeTools(value: unknown): McpToolInfo[] | null {
  if (!isRecord(value) || !isRecord(value.result) || !Array.isArray(value.result.tools)) return null;
  const tools: McpToolInfo[] = [];
  for (const tool of value.result.tools) {
    if (!isRecord(tool) || typeof tool.name !== "string" || !tool.name) return null;
    tools.push(typeof tool.description === "string" ? { name: tool.name, description: tool.description } : { name: tool.name });
  }
  return tools;
}

function isInitializeResult(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.result)) return false;
  // 错误响应形如 { error: { code, message } }，result 缺席即协议失败。
  if ("error" in value && isRecord(value.error)) return false;
  return true;
}

/**
 * MCP server 启用前握手验证。成功返回 { ok:true, tools, durationMs }，
 * 任何失败返回 { ok:false, error, detail?, durationMs }，绝不抛异常。
 */
export async function validateMcpServer(
  config: McpServerConfig,
  options: McpValidateOptions = {},
  deps: McpValidatorDeps = {},
): Promise<McpValidationResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const done = (partial: Omit<McpValidationResult, "durationMs">): McpValidationResult => ({
    ...partial,
    durationMs: Date.now() - startedAt,
  });
  try {
    if (!isRecord(config)) {
      return done({ ok: false, error: "invalid-config", detail: "config must be an object" });
    }
    const transport = resolveTransport(config);
    if (transport === "stdio") {
      const stdio = config as McpStdioConfig;
      if (typeof stdio.command !== "string" || !stdio.command.trim()) {
        return done({ ok: false, error: "invalid-config", detail: "stdio config requires a non-empty command" });
      }
      return done(await validateStdio(stdio, timeoutMs, deps));
    }
    const http = config as McpHttpConfig;
    if (typeof http.url !== "string" || !/^https?:\/\//.test(http.url)) {
      return done({ ok: false, error: "invalid-config", detail: "http/sse config requires an http(s) url" });
    }
    if (transport === "sse") {
      return done(await validateLegacySse(http, timeoutMs, deps));
    }
    return done(await validateStreamableHttp(http, timeoutMs, deps));
  } catch (error) {
    // 最后一道防线：连返回错误对象都失败时也不抛。
    return done({ ok: false, error: "protocol-error", detail: error instanceof Error ? error.message : String(error) });
  }
}

function defaultSpawn(
  command: string,
  args: string[],
  options: { env?: Record<string, string>; cwd?: string },
): McpChildProcess {
  // 动态 import 的同步替代：在服务端路由里永远可用；在浏览器里 require 不存在，
  // 外层 try/catch 会把它转成 unsupported，而不是在模块顶层就炸掉 import。
  // 顶层静态 import node:child_process 会让客户端 bundle 构建失败，故必须延迟加载。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const childProcess = require("node:child_process") as typeof import("node:child_process");
  const child = childProcess.spawn(command, args, {
    env: options.env ? { ...process.env, ...options.env } : process.env,
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "ignore"],
    shell: false,
    windowsHide: true,
  });
  return child as unknown as McpChildProcess;
}

async function validateStdio(
  config: McpStdioConfig,
  timeoutMs: number,
  deps: McpValidatorDeps,
): Promise<Omit<McpValidationResult, "durationMs">> {
  const spawnImpl = deps.spawnImpl ?? defaultSpawn;
  const nextId = deps.randomId ?? (() => Math.floor(Math.random() * 1_000_000_000));

  return new Promise((resolve) => {
    let settled = false;
    let child: McpChildProcess | null = null;
    const finish = (partial: Omit<McpValidationResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child?.kill("SIGKILL");
      } catch {
        // 杀不掉也无妨：进程已退出或句柄已失效。
      }
      resolve(partial);
    };
    const timer = setTimeout(() => {
      finish({ ok: false, error: "timeout", detail: `stdio handshake exceeded ${timeoutMs}ms` });
    }, timeoutMs);

    const pending = new Map<string | number, (value: unknown) => void>();

    const request = (method: string, params: unknown): Promise<unknown> =>
      new Promise((accept, reject) => {
        const id = nextId();
        pending.set(id, accept);
        try {
          child?.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
        } catch {
          pending.delete(id);
          reject(new Error("failed to write to server stdin"));
        }
      });

    const notify = (method: string, params: unknown): void => {
      try {
        child?.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
      } catch {
        // notification 发不出去不致命，后续 request 超时会兜底。
      }
    };

    let buffer = "";
    let bufferOverflow = false;
    const onData = (chunk: string | Uint8Array) => {
      if (settled) return;
      buffer += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      if (buffer.length > MAX_STDIO_BUFFER) {
        bufferOverflow = true;
        finish({ ok: false, error: "bad-response", detail: `stdio output exceeded ${MAX_STDIO_BUFFER} bytes` });
        return;
      }
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(line);
          } catch {
            // 非 JSON 行（某些 server 的启动日志）直接跳过。
          }
          if (isRecord(parsed) && ("id" in parsed)) {
            const waiter = pending.get(parsed.id as string | number);
            if (waiter) {
              pending.delete(parsed.id as string | number);
              waiter(parsed);
            }
          }
        }
        newline = buffer.indexOf("\n");
      }
    };

    try {
      child = spawnImpl(config.command, config.args ?? [], { env: config.env, cwd: config.cwd });
    } catch (error) {
      finish({
        ok: false,
        error: "spawn-failed",
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (!child.stdin || !child.stdout) {
      finish({ ok: false, error: "unsupported", detail: "stdio transport needs piped stdio" });
      return;
    }
    child.stdout.on("data", onData);
    child.on("error", (error) => {
      finish({ ok: false, error: "spawn-failed", detail: typeof error === "string" ? error : String(error) });
    });
    child.on("close", (code) => {
      if (!settled && pending.size > 0) {
        finish({ ok: false, error: "protocol-error", detail: `server exited with code ${String(code)} before handshake completed` });
      }
    });

    void (async () => {
      try {
        const initResponse = await request("initialize", {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: CLIENT_INFO,
        });
        if (!isInitializeResult(initResponse)) {
          finish({ ok: false, error: "protocol-error", detail: "initialize did not return a result" });
          return;
        }
        notify("notifications/initialized", {});
        const toolsResponse = await request("tools/list", {});
        const tools = normalizeTools(toolsResponse);
        if (!tools) {
          finish({ ok: false, error: "protocol-error", detail: "tools/list did not return a tools array" });
          return;
        }
        finish({ ok: true, tools });
      } catch (error) {
        if (!bufferOverflow) {
          finish({ ok: false, error: "protocol-error", detail: error instanceof Error ? error.message : String(error) });
        }
      }
    })();
  });
}

function defaultFetch(url: string, init: McpFetchInit): Promise<McpFetchResponse> {
  const fetchImpl = (globalThis as { fetch?: unknown }).fetch;
  if (typeof fetchImpl !== "function") {
    return Promise.reject(new Error("fetch is not available in this runtime"));
  }
  return (fetchImpl as typeof fetch)(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  }) as unknown as Promise<McpFetchResponse>;
}

/** 解析纯 JSON 或 SSE（data: 行）响应体，超限直接判 bad-response。 */
async function parseJsonRpcBody(response: McpFetchResponse): Promise<{ parsed?: unknown; failure?: string }> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return { failure: error instanceof Error ? error.message : String(error) };
  }
  if (text.length > MAX_HTTP_BODY) {
    return { failure: `response body exceeded ${MAX_HTTP_BODY} bytes` };
  }
  const contentType = response.headers.get("content-type") ?? "";
  const candidate = contentType.includes("text/event-stream") ? lastSseData(text) : text;
  if (!candidate) return { failure: "empty response body" };
  try {
    return { parsed: JSON.parse(candidate) as unknown };
  } catch {
    return { failure: "response body is not JSON" };
  }
}

function lastSseData(body: string): string {
  let last = "";
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data:")) {
      const data = trimmed.slice("data:".length).trim();
      if (data && data !== "[DONE]") last = data;
    }
  }
  return last;
}

async function validateStreamableHttp(
  config: McpHttpConfig,
  timeoutMs: number,
  deps: McpValidatorDeps,
): Promise<Omit<McpValidationResult, "durationMs">> {
  const fetchImpl = deps.fetchImpl ?? defaultFetch;
  const nextId = deps.randomId ?? (() => Math.floor(Math.random() * 1_000_000_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const baseHeaders: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...config.headers,
    };
    let sessionId: string | null = null;
    const post = async (payload: unknown): Promise<{ parsed?: unknown; failure?: string }> => {
      let response: McpFetchResponse;
      try {
        response = await fetchImpl(config.url, {
          method: "POST",
          headers: sessionId ? { ...baseHeaders, "mcp-session-id": sessionId } : baseHeaders,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) return { failure: `__timeout__ exceeded ${timeoutMs}ms` };
        return { failure: error instanceof Error ? error.message : String(error) };
      }
      const returned = response.headers.get("mcp-session-id");
      if (returned) sessionId = returned;
      if (response.status < 200 || response.status >= 300) {
        return { failure: `__http__ ${response.status}` };
      }
      // 202 + 空 body 是 notification 的正常回执。
      return parseJsonRpcBody(response);
    };

    const initId = nextId();
    const init = await post({ jsonrpc: "2.0", id: initId, method: "initialize", params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    } });
    if (init.failure) return httpFailure(init.failure, timeoutMs);
    if (!isInitializeResult(init.parsed)) {
      return { ok: false, error: "protocol-error", detail: "initialize did not return a result" };
    }
    const tools = await post({ jsonrpc: "2.0", id: nextId(), method: "tools/list", params: {} });
    if (tools.failure) return httpFailure(tools.failure, timeoutMs);
    const normalized = normalizeTools(tools.parsed);
    if (!normalized) {
      return { ok: false, error: "protocol-error", detail: "tools/list did not return a tools array" };
    }
    return { ok: true, tools: normalized };
  } finally {
    clearTimeout(timer);
  }
}

function httpFailure(failure: string, timeoutMs: number): Omit<McpValidationResult, "durationMs"> {
  if (failure.startsWith("__timeout__")) {
    return { ok: false, error: "timeout", detail: `http handshake exceeded ${timeoutMs}ms` };
  }
  if (failure.startsWith("__http__")) {
    return { ok: false, error: "http-error", detail: `server responded with status ${failure.slice("__http__ ".length)}` };
  }
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|fetch failed|not available/i.test(failure)) {
    return { ok: false, error: "connection-refused", detail: failure };
  }
  return { ok: false, error: "bad-response", detail: failure };
}

/**
 * Legacy SSE：GET 建流取 endpoint，再 POST 发请求、从流里按 id 收响应。
 * 流式读 + 相关等待都受同一超时保护，结束时 cancel 掉 reader。
 */
async function validateLegacySse(
  config: McpHttpConfig,
  timeoutMs: number,
  deps: McpValidatorDeps,
): Promise<Omit<McpValidationResult, "durationMs">> {
  const fetchImpl = deps.fetchImpl ?? defaultFetch;
  const nextId = deps.randomId ?? (() => Math.floor(Math.random() * 1_000_000_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let stream: McpFetchResponse;
    try {
      stream = await fetchImpl(config.url, {
        method: "GET",
        headers: { accept: "text/event-stream", ...config.headers },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return { ok: false, error: "timeout", detail: `sse handshake exceeded ${timeoutMs}ms` };
      }
      return { ok: false, error: "connection-refused", detail: error instanceof Error ? error.message : String(error) };
    }
    if (stream.status < 200 || stream.status >= 300) {
      return { ok: false, error: "http-error", detail: `sse endpoint responded with status ${stream.status}` };
    }
    let body: string;
    try {
      body = await stream.text();
    } catch (error) {
      if (controller.signal.aborted) {
        return { ok: false, error: "timeout", detail: `sse handshake exceeded ${timeoutMs}ms` };
      }
      return { ok: false, error: "bad-response", detail: error instanceof Error ? error.message : String(error) };
    }
    const endpoint = parseSseEndpoint(body);
    if (!endpoint) {
      return { ok: false, error: "protocol-error", detail: "sse stream did not advertise a message endpoint" };
    }
    const messageUrl = new URL(endpoint, config.url).toString();
    // endpoint 事件之后同流里可能直接跟 responses：先收割一遍，避免重读。
    const earlyResponses = parseSseResponses(body);

    const postAndWait = async (payload: { id: string | number; method: string; params: unknown }): Promise<unknown> => {
      const early = earlyResponses.get(payload.id);
      if (early) return early;
      let response: McpFetchResponse;
      try {
        response = await fetchImpl(messageUrl, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...config.headers },
          body: JSON.stringify({ jsonrpc: "2.0", ...payload }),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) throw new Error(`sse handshake exceeded ${timeoutMs}ms`);
        throw error instanceof Error ? error : new Error(String(error));
      }
      if (response.status === 202) {
        // 202 表示 server 经 GET 流回传：把当前流剩余内容再读一遍找对应 id。
        // mock 与短流场景下 body 已完整；长连接由外层超时兜底。
        const rest = await response.text().catch(() => "");
        const found = parseSseResponses(rest).get(payload.id) ?? parseSseResponses(body).get(payload.id);
        if (found) return found;
        throw new Error(`no response for request ${String(payload.id)} on the sse stream`);
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`message endpoint responded with status ${response.status}`);
      }
      const { parsed, failure } = await parseJsonRpcBody(response);
      if (failure) throw new Error(failure);
      return parsed;
    };

    let initResponse: unknown;
    try {
      initResponse = await postAndWait({ id: nextId(), method: "initialize", params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      } });
    } catch (error) {
      if (controller.signal.aborted) {
        return { ok: false, error: "timeout", detail: `sse handshake exceeded ${timeoutMs}ms` };
      }
      return { ok: false, error: "protocol-error", detail: error instanceof Error ? error.message : String(error) };
    }
    if (!isInitializeResult(initResponse)) {
      return { ok: false, error: "protocol-error", detail: "initialize did not return a result" };
    }
    let toolsResponse: unknown;
    try {
      toolsResponse = await postAndWait({ id: nextId(), method: "tools/list", params: {} });
    } catch (error) {
      if (controller.signal.aborted) {
        return { ok: false, error: "timeout", detail: `sse handshake exceeded ${timeoutMs}ms` };
      }
      return { ok: false, error: "protocol-error", detail: error instanceof Error ? error.message : String(error) };
    }
    const tools = normalizeTools(toolsResponse);
    if (!tools) {
      return { ok: false, error: "protocol-error", detail: "tools/list did not return a tools array" };
    }
    return { ok: true, tools };
  } finally {
    clearTimeout(timer);
  }
}

/** 从 SSE 流文本里找 `event: endpoint` + `data: <url>`。 */
export function parseSseEndpoint(body: string): string | null {
  const lines = body.split("\n");
  let event = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("event:")) {
      event = trimmed.slice("event:".length).trim();
    } else if (trimmed.startsWith("data:")) {
      const data = trimmed.slice("data:".length).trim();
      if (event === "endpoint" && data) return data;
      // 有些实现不写 event 名，直接第一条 data 就是 endpoint：兜底看路径形态。
      if (!event && data.startsWith("/")) return data;
    } else if (trimmed === "") {
      event = "";
    }
  }
  return null;
}

/** 从 SSE 流文本里收集所有带 id 的 JSON-RPC 响应。 */
export function parseSseResponses(body: string): Map<string | number, unknown> {
  const out = new Map<string | number, unknown>();
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice("data:".length).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const parsed: unknown = JSON.parse(data);
      if (isRecord(parsed) && "id" in parsed && (typeof parsed.id === "string" || typeof parsed.id === "number")) {
        out.set(parsed.id, parsed);
      }
    } catch {
      // endpoint 地址等非 JSON data 行直接忽略。
    }
  }
  return out;
}

// 导出 isStdioConfig 供调用方做配置分支判断（避免调用方重复写类型收窄）。
export { isStdioConfig };
