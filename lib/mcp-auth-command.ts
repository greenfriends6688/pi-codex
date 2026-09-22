/**
 * lib/mcp-auth-command.ts
 *
 * ZC-18 — MCP OAuth 入口的纯函数部分（fork:zc-18）。
 *
 * 分工（别在别的层重新实现）：
 * - `pi-mcp-adapter` v2.34.0 已经自带完整 OAuth：浏览器授权、PKCE、凭据存
 *   操作系统钥匙串（按 server name 键控）、以及无头场景的「把 callback URL
 *   粘回来」流程。它还注册了 `/mcp-auth <server>`（单个 server 授权）和
 *   `/mcp logout <server>`（清掉钥匙串凭据）两个斜杠命令。
 * - pi-web 不重复实现 OAuth、不碰钥匙串；这里只负责把「在会话里执行的
 *   精确命令」拼出来，MCP 面板把它复制给用户，剩下的交给扩展。
 *
 * 为什么不加引号：`pi-mcp-adapter` 对 `/mcp-auth` 的参数只做 `args.trim()`，
 * 整个剩余行就是 server name（见该扩展 index.ts:1327 / commands.ts:283）。
 * 加 shell 引号会把引号本身变成名字的一部分，反而查不到配置项。所以这里改为
 * 校验名字能否安全地放进一条单行斜杠命令：不能就返回 null，由 UI 隐藏入口。
 *
 * 安全边界：server name 是用户在 `mcp.json` 里可编辑的 JSON key，按不可信输入
 * 处理。换行/行分隔符会让「一条命令」变成「两条命令」（第二行以 `/` 开头就是
 * 另一个斜杠命令），因此含控制字符的名字一律拒绝，而不是清洗成近似名字。
 */

import type { McpServerInfo } from "./api-types";
import type { McpServerConfig } from "./mcp-validator";

/**
 * 同时兼容仓库里已有的两种配置形状（只取传输判定需要的字段，不新造解析器）：
 * - `McpServerInfo`（lib/api-types.ts）：`/api/mcp` 返回、MCP 面板渲染的形状；
 * - `McpServerConfig`（lib/mcp-validator.ts）：mcp.json 原始定义的形状。
 */
export type McpAuthServerShape = {
  kind?: McpServerInfo["kind"];
  url?: McpServerInfo["url"];
  transport?: McpServerConfig["transport"];
};

/** 行终止符（含 U+2028/U+2029）与 C0/C1 控制字符：会破坏「单行命令」这个前提。 */
const UNSAFE_COMMAND_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * 是否是 URL（HTTP/SSE）型 server —— 只有这类才可能走 OAuth 浏览器回调。
 *
 * 保守口径，与 `lib/mcp-validator.ts` 的 http/sse 分支保持一致：
 * - `kind === "command" | "socket"` 或 `transport === "stdio"` → 本地进程/套接字，排除；
 * - 必须存在非空且以 http(s) 开头的 `url`，否则视为 stdio（同 `isStdioConfig` 的思路）。
 *
 * 无法从配置形状可靠判断 server 是否声明了 OAuth（`auth` 字段、自动探测都在
 * 扩展里），所以这里只按「远程 URL」放行：命令由扩展执行，扩展自己会拒绝并
 * 解释「does not use OAuth」。
 */
export function isRemoteMcpServer(server: McpAuthServerShape | null | undefined): boolean {
  if (!server || typeof server !== "object") return false;
  if (server.kind === "command" || server.kind === "socket") return false;
  if (server.transport === "stdio") return false;
  const url = typeof server.url === "string" ? server.url.trim() : "";
  return /^https?:\/\//i.test(url);
}

function buildCommand(prefix: string, serverName: unknown): string | null {
  if (typeof serverName !== "string" || !serverName) return null;
  // 换行/控制字符 = 可能夹带第二条斜杠命令，直接拒绝。
  if (UNSAFE_COMMAND_CHARS.test(serverName)) return null;
  // 扩展对参数 trim 后再查表，首尾空白的 key 用命令本来也寻址不到。
  if (serverName.trim() !== serverName) return null;
  return `${prefix} ${serverName}`;
}

/**
 * `/mcp-auth <server>` —— 由 `pi-mcp-adapter` 注册，触发该 server 的 OAuth。
 * 名字不可信/无法安全表示时返回 null。
 */
export function buildMcpAuthCommand(serverName: unknown): string | null {
  return buildCommand("/mcp-auth", serverName);
}

/**
 * `/mcp logout <server>` —— `pi-mcp-adapter` 的 `/mcp` 子命令，清掉该 server
 * 存在操作系统钥匙串里的凭据。名字不可信/无法安全表示时返回 null。
 */
export function buildMcpLogoutCommand(serverName: unknown): string | null {
  return buildCommand("/mcp logout", serverName);
}
