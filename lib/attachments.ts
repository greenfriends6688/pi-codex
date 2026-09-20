import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * fork:gap07-attachments — composer 附件的落盘目录。
 *
 * 按天分桶（`<agentDir>/attachments/YYYY-MM-DD/`）：既是暂存区，也好清理，
 * 而且不会在一个目录里堆成千上万个文件。
 *
 * 放在 route 之外的理由：Next.js 的路由文件不允许额外导出（生成的路由类型
 * 校验会报 `attachmentsDirectory is incompatible with index signature`），
 * 而这段分桶逻辑要能单独被 `route.test.mjs` 调用。
 */
export function attachmentsDirectory(now: Date = new Date()): string {
  const day = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return join(getAgentDir(), "attachments", day);
}
