/**
 * fork:proma-01-approval — 工具审批的**语义层**（纯函数）。
 *
 * pi 官方文档把 permission gate 列为扩展首要用例（`docs/extensions.md:19`），
 * 并给了完整写法（`examples/extensions/permission-gate.ts`）：`pi.on("tool_call")`
 * 里返回 `{ block: true, reason }` 拦截，用 `ctx.ui.select()` 问用户。
 *
 * 本仓的 UI 与回答通道**早就做完了**（`extension_ui_request` → ChatWindow 对话框 →
 * `extension_ui_response`，含 rpc-manager 重发未决请求带来的刷新恢复），所以这个补丁
 * 从零写的只有语义：**风险档、摘要脱敏、白名单/会话授权、以及「放行还是不拦」的判定**。
 *
 * ## 默认必须是全放行
 *
 * 升级链（对齐 Proma 的 `agent-permission-service.ts:120-167`）：
 *
 *   1. 会话授权命中 → 放行（用户说过「本次会话总是允许」）
 *   2. 模式 = bypass（**默认**）→ 放行（与改动前的行为完全等价）
 *   3. 只读 / 安全命令 → 放行
 *   4. 其余 → 在 ask / plan 模式下拦住问人
 *
 * 第 2 条是硬约束：只有用户显式选了「需审批 / 计划」才会出现审批卡，默认路径一个字都不改。
 *
 * ## 只读判定宁可保守
 *
 * 安全命令走**显式白名单**（`git status`、`ls`、`cat`、`grep`…），而不是「看起来不像危险的就算安全」。
 * 白名单没命中一律算未知 —— 未知在 bypass 下依然放行，但在 ask 下会问，这正是我们要的：
 * 宁可多问一次，也不要把 `rm -rf` 误判成安全（那正是 Proma `agent-orchestrator.ts:1204-1240`
 * 的 Bash 只读正则的价值所在）。
 *
 * 纯数据模块：服务端与客户端都可 import，无平台依赖，全部可单测。
 */

export type ApprovalRiskTier = "read-only" | "unknown" | "dangerous";

/** 判定输入：工具名 + 它的参数（`bash` 的 `command`、`write` 的 `path` 等）。 */
export interface ApprovalSubject {
  toolName: string;
  input: Record<string, unknown> | undefined;
}

/** 会话授权：一条授权覆盖「同一个工具的同一类动作」。 */
export interface ToolGrant {
  toolName: string;
  /** 归一化后的匹配串（bash 是命令前缀，文件类工具是路径前缀）。 */
  target: string;
}

export interface ApprovalDecision {
  tier: ApprovalRiskTier;
  /** 是否需要弹审批卡。 */
  needsApproval: boolean;
  /** 命中的具体原因（危险模式的说明或安全判定的名称），用于卡片副标题。 */
  reason?: string;
  /** 供卡片显示的参数摘要（已脱敏、已截断）。 */
  summary: string;
  /** 授权匹配用的键；空字符串表示这个工具不适合「总是允许」。 */
  grantTarget: string;
}

/** 危险模式：命中即 dangerous。顺序无关，全部对照小写后的命令。 */
const DANGEROUS_RULES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "recursive-delete", pattern: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive|--force)/i },
  { id: "privilege-escalation", pattern: /\b(sudo|doas|runas)\b/i },
  { id: "world-writable", pattern: /\b(chmod|chown)\b[^\n]*\b(777|666)\b/i },
  { id: "git-force-push", pattern: /\bgit\s+push\b[^\n]*(--force\b|--force-with-lease|\s-f\b)/i },
  { id: "git-destructive", pattern: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*[fdx]|checkout\s+--\s)/i },
  { id: "pipe-to-shell", pattern: /\b(curl|wget|invoke-webrequest|iwr)\b[^\n]*\|\s*(ba)?sh\b/i },
  { id: "encoded-powershell", pattern: /\bpowershell\b[^\n]*\s-(enc|encodedcommand)\b/i },
  { id: "publish-or-release", pattern: /\b(npm|pnpm|yarn)\s+publish\b|\bgh\s+release\s+create\b/i },
  { id: "raw-disk", pattern: /\b(dd|mkfs|fdisk|diskpart)\b/i },
  { id: "system-package-manager", pattern: /\b(apt-get|apt|yum|dnf|brew|choco|winget)\s+(install|remove|uninstall|upgrade)\b/i },
  { id: "kill-all", pattern: /\bkill(all)?\s+-9\b|\btaskkill\b[^\n]*\/f\b/i },
  { id: "env-exfiltration", pattern: /\b(env|printenv|set)\b[^\n]*\|\s*(curl|wget)\b/i },
];

/** 显式安全白名单：只读、无副作用。**不是**「不危险」的兜底。 */
const READ_ONLY_RULES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "list", pattern: /^\s*(ls|dir|pwd|tree|find)\b[^\n]*$/i },
  { id: "read", pattern: /^\s*(cat|head|tail|less|type|wc|file)\b[^\n]*$/i },
  { id: "search", pattern: /^\s*(grep|rg|findstr|select-string|ag)\b[^\n]*$/i },
  { id: "git-read", pattern: /^\s*git\s+(status|log|diff|show|branch|remote|describe|rev-parse|ls-files)\b[^\n]*$/i },
  { id: "version", pattern: /^\s*(node|npm|pnpm|yarn|python|python3|go|rustc|cargo|java)\s+(-v|--version|-version)\b[^\n]*$/i },
  { id: "echo", pattern: /^\s*echo\b[^\n]*$/i },
];

/** 只读工具名（读文件、搜索、列目录）——工具级安全，无需看参数。 */
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls", "glob", "search"]);

/** 密钥类参数的脱敏：命中键名就把值换掉，**绝不回显完整内容**。 */
const SECRET_KEY = /(token|secret|password|passwd|api[-_]?key|authorization|cookie|credential|private[-_]?key)/i;

const MAX_ARG_CHARS = 160;

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** 取命令文本（bash/powershell 的 `command`，兼容 `cmd`/`script` 拼写）。 */
export function commandOf(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  return asString(input.command) ?? asString(input.cmd) ?? asString(input.script);
}

/**
 * 参数摘要：只留最有辨识度的一两个字段，其余按密钥规则脱敏并截断。
 *
 * 规格要求「卡片只显示参数摘要，不要回显完整密钥/长内容」——所以这里先按键名脱敏，
 * 再把整串压成一行、超长截断。宁可摘要不够详细，也不要把 token 画到屏幕上。
 */
export function summarizeApprovalInput(
  toolName: string,
  input: Record<string, unknown> | undefined,
): string {
  if (!input || Object.keys(input).length === 0) return "";
  const preferred = ["command", "cmd", "script", "path", "file_path", "filePath", "url", "pattern", "query", "prompt"];
  const parts: string[] = [];
  const used = new Set<string>();

  for (const key of preferred) {
    const value = asString(input[key]);
    if (!value) continue;
    used.add(key);
    const safe = SECRET_KEY.test(key) ? "[redacted]" : value;
    parts.push(safe);
    if (parts.length >= 2) break;
  }
  if (parts.length === 0) {
    for (const [key, value] of Object.entries(input)) {
      const text = asString(value);
      if (!text) continue;
      parts.push(SECRET_KEY.test(key) ? `${key}=[redacted]` : `${key}=${text}`);
      if (parts.length >= 2) break;
    }
  }

  const joined = parts.join(" · ").replace(/\s+/g, " ").trim();
  return joined.length > MAX_ARG_CHARS ? `${joined.slice(0, MAX_ARG_CHARS - 1)}…` : joined;
}

/** 授权匹配串：命令取首两个词（`git push`），文件类取路径本身。 */
export function grantTargetFor(subject: ApprovalSubject): string {
  const command = commandOf(subject.input);
  if (command) {
    const words = command.trim().split(/\s+/).slice(0, 2).join(" ");
    return words.toLowerCase();
  }
  const path = asString(subject.input?.path) ?? asString(subject.input?.file_path) ?? asString(subject.input?.filePath);
  if (path) return path;
  const url = asString(subject.input?.url);
  if (url) return url;
  return "";
}

/** 一个授权是否覆盖当前调用：工具同名且目标相同（或目标的上级路径）。 */
export function grantMatches(grant: ToolGrant, subject: ApprovalSubject): boolean {
  if (grant.toolName !== subject.toolName) return false;
  const target = grantTargetFor(subject);
  if (!grant.target || !target) return grant.target === target;
  if (grant.target === target) return true;
  // 路径类授权覆盖子路径（授权 /repo 覆盖 /repo/a.ts）；命令类要求完全一致，
  // 否则一条 `git status` 的授权会顺带放行 `git push`。
  const looksLikePath = /[\\/]/.test(grant.target);
  if (!looksLikePath) return false;
  const normalized = grant.target.replace(/[\\/]+$/, "");
  return target.startsWith(`${normalized}/`) || target.startsWith(`${normalized}\\`);
}

export type PermissionModeName = "bypass" | "ask" | "plan";

export interface ApprovalDecisionInput extends ApprovalSubject {
  mode: PermissionModeName;
  grants?: readonly ToolGrant[];
}

/**
 * 主判定：返回风险档、是否要问人、摘要与授权键。
 *
 * 注意顺序：**先看授权，再看模式**。用户在 ask 模式下点过「本次会话总是允许」之后，
 * 同一动作不该再被问第二遍。
 */
export function decideApproval(input: ApprovalDecisionInput): ApprovalDecision {
  const subject: ApprovalSubject = { toolName: input.toolName, input: input.input };
  const command = commandOf(input.input);
  const summary = summarizeApprovalInput(input.toolName, input.input);
  const grantTarget = grantTargetFor(subject);
  const base = { summary, grantTarget };

  if (input.grants?.some((grant) => grantMatches(grant, subject))) {
    return { ...base, tier: "unknown", needsApproval: false, reason: "session-grant" };
  }
  if (input.mode === "bypass") {
    return { ...base, tier: "unknown", needsApproval: false, reason: "bypass" };
  }
  if (READ_ONLY_TOOLS.has(input.toolName.toLowerCase())) {
    return { ...base, tier: "read-only", needsApproval: false, reason: "read-only-tool" };
  }
  if (command) {
    const dangerous = DANGEROUS_RULES.find((rule) => rule.pattern.test(command));
    if (dangerous) {
      return { ...base, tier: "dangerous", needsApproval: true, reason: dangerous.id };
    }
    const safe = READ_ONLY_RULES.find((rule) => rule.pattern.test(command));
    if (safe) {
      return { ...base, tier: "read-only", needsApproval: false, reason: safe.id };
    }
  }
  return { ...base, tier: "unknown", needsApproval: true, reason: "unclassified" };
}

/**
 * 审批卡片的三个选项。
 *
 * 注意这里是**给人看的标签**，不是机器 id：`ctx.ui.select` 会把选项原样渲染成对话框按钮，
 * 传 `allow-once` 这种 id 的话，用户看到的就是三行英文单词。机器语义放 `APPROVAL_CHOICE_IDS`。
 */
export const APPROVAL_CHOICES = ["允许一次", "本次会话总是允许", "拒绝"] as const;
export const APPROVAL_CHOICE_IDS = ["allow-once", "allow-session", "deny"] as const;
export type ApprovalChoice = typeof APPROVAL_CHOICE_IDS[number];

/**
 * 把 `ctx.ui.select` 的返回值映射成决策。
 *
 * 三种写法都接受：人话标签（实际渲染的）、机器 id（测试与旧调用）、以及**下标**
 * （`select` 在部分实现里返回选中项的下标）。除此之外一律当拒绝 ——
 * 取消/中止/乱码都不能变成放行。
 */
export function parseApprovalChoice(selected: string | number | undefined | null): ApprovalChoice {
  if (typeof selected === "number") {
    return APPROVAL_CHOICE_IDS[selected] ?? "deny";
  }
  if (typeof selected !== "string") return "deny";
  const trimmed = selected.trim();
  const asId = APPROVAL_CHOICE_IDS.find((id) => id === trimmed);
  if (asId) return asId;
  const asLabel = APPROVAL_CHOICES.findIndex((label) => label === trimmed);
  if (asLabel >= 0) return APPROVAL_CHOICE_IDS[asLabel]!;
  return "deny";
}

/** 会话授权的持久化形态（写进 `pi-web:tool-grants` custom entry）。 */
export interface ToolGrantsEntry {
  version: 1;
  grants: ToolGrant[];
}

export const TOOL_GRANTS_ENTRY_TYPE = "pi-web:tool-grants";

export function isToolGrantsEntry(value: unknown): value is ToolGrantsEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<ToolGrantsEntry>;
  if (entry.version !== 1 || !Array.isArray(entry.grants)) return false;
  return entry.grants.every((grant) => (
    grant && typeof grant === "object"
    && typeof (grant as ToolGrant).toolName === "string"
    && typeof (grant as ToolGrant).target === "string"
  ));
}

/** 追加一条授权（同键去重，保持插入顺序）。 */
export function addGrant(grants: readonly ToolGrant[], next: ToolGrant): ToolGrant[] {
  if (!next.target && !next.toolName) return [...grants];
  if (grants.some((grant) => grant.toolName === next.toolName && grant.target === next.target)) {
    return [...grants];
  }
  return [...grants, next];
}
