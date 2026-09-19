import type { ExtensionAPI, ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  APPROVAL_CHOICES,
  TOOL_GRANTS_ENTRY_TYPE,
  addGrant,
  decideApproval,
  grantTargetFor,
  isToolGrantsEntry,
  parseApprovalChoice,
  type PermissionModeName,
  type ToolGrant,
} from "./approval-policy";

/**
 * fork:proma-01-approval — 工具审批引擎（pi 内联扩展）。
 *
 * 官方文档把 permission gate 列为扩展首要用例，并给了完整写法
 * （`docs/extensions.md:19`、`examples/extensions/permission-gate.ts`）：在
 * `pi.on("tool_call")` 里返回 `{ block: true, reason }` 就能拦下这次调用，
 * 用 `ctx.ui.select()` 问用户。本扩展走的就是这条路，**没有自造审批通道** ——
 * `ctx.ui.select` 在本仓映射到既有的 `extension_ui_request` → ChatWindow 对话框 →
 * `extension_ui_response`，连「刷新后待决请求能恢复」都由 rpc-manager 重发未决请求
 * 免费提供（`AgentSessionWrapper.onEvent` 会补发 `pendingUiRequests`）。
 *
 * 三条纪律：
 *
 * 1. **默认全放行**：`getMode()` 返回 `bypass` 时这个扩展等价于不存在（`decideApproval`
 *    在 bypass 下直接放行）。只有用户显式把会话设成 ask / plan，才会出现审批卡。
 * 2. **中止即拒绝**：等待期间用户点了停止（stop），`select` 的 Promise 会抛/返回空 ——
 *    一律当拒绝，绝不放行一个没被回答的危险调用。
 * 3. **只记「总是允许」的授权**：一次性放行不写会话，避免会话文件里堆噪音；
 *    授权写进 `pi-web:tool-grants` custom entry，随分支回退一起回退（与 todo 同款语义）。
 */

export const HOST_APPROVAL_EXTENSION_NAME = "pi-web-approval";

/** 从分支里读回会话授权（同名工具 + 同目标；后写的覆盖先写的）。 */
export function readToolGrants(entries: readonly unknown[]): ToolGrant[] {
  let grants: ToolGrant[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { type?: unknown; customType?: unknown; data?: unknown };
    if (candidate.type !== "custom" || candidate.customType !== TOOL_GRANTS_ENTRY_TYPE) continue;
    if (!isToolGrantsEntry(candidate.data)) continue;
    grants = candidate.data.grants.map((grant) => ({ ...grant }));
  }
  return grants;
}

/** 人话描述：卡片上先看到「要干什么」，再看参数摘要。 */
function approvalPrompt(toolName: string, summary: string, reason: string | undefined): string {
  const label = toolName === "bash" ? "命令" : `工具 ${toolName}`;
  const because = reason === "unclassified" ? "不在只读白名单里" : `命中风险规则：${reason}`;
  return [
    `需要确认这笔操作（${because}）`,
    "",
    summary ? `${label}：${summary}` : label,
  ].join("\n");
}

export function createApprovalExtension(getMode: () => PermissionModeName): InlineExtension {
  return {
    name: HOST_APPROVAL_EXTENSION_NAME,
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      let grants: ToolGrant[] = [];

      const reconstruct = (ctx: ExtensionContext) => {
        grants = readToolGrants(ctx.sessionManager.getBranch());
      };
      pi.on("session_start", async (_event, ctx) => reconstruct(ctx));
      pi.on("session_tree", async (_event, ctx) => reconstruct(ctx));

      pi.on("tool_call", async (event, ctx) => {
        const input = (event.input ?? {}) as Record<string, unknown>;
        const decision = decideApproval({
          mode: getMode(),
          toolName: event.toolName,
          input,
          grants,
        });
        if (!decision.needsApproval) return undefined;

        // 没有 UI（非交互运行）时必须拦，而不是默默放行 —— 与官方示例一致。
        if (!ctx.hasUI) {
          return { block: true, reason: `需要用户确认，但当前没有可用的交互界面（${decision.reason ?? "unknown"}）` };
        }

        let selected: string | null | undefined;
        try {
          selected = await ctx.ui.select(
            approvalPrompt(event.toolName, decision.summary, decision.reason),
            [...APPROVAL_CHOICES],
          );
        } catch {
          // 中止本轮 / 对话框被取消：按拒绝处理
          return { block: true, reason: "审批未获答复，已按拒绝处理" };
        }

        const choice = parseApprovalChoice(selected);
        if (choice === "deny") return { block: true, reason: "用户拒绝了这次工具调用" };

        if (choice === "allow-session" && decision.grantTarget) {
          const grant: ToolGrant = { toolName: event.toolName, target: decision.grantTarget };
          grants = addGrant(grants, grant);
          try {
            // 扩展侧写会话状态的正规入口是 `pi.appendEntry()`（官方文档 § Session persistence）。
            // 不用 `ctx.sessionManager.appendCustomEntry`：那条在扩展上下文里被标成只读类型，
            // 是宿主（rpc-manager）侧用的。
            pi.appendEntry(TOOL_GRANTS_ENTRY_TYPE, { version: 1, grants });
          } catch (error) {
            // 写不进去不影响本次放行；下一次同类调用会再问一次（宁可多问，不可静默放行）
            console.error("[pi-web] failed to persist tool grant:", error instanceof Error ? error.message : error);
          }
        }
        return undefined;
      });
    },
  };
}

/** 供测试断言用：授权键的入口就是策略里的那一个实现。 */
export { grantTargetFor };
