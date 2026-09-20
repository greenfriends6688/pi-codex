/**
 * fork:pr13-composer — 拖入文件绝对路径 → cwd 相对 `@` 引用路径。
 *
 * 纯字符串逻辑（不依赖 node:path），因此既能在浏览器里跑，也能被单测直接引用。
 * 桌面外壳通过 `webUtils.getPathForFile` 给到磁盘绝对路径；落在项目目录内的文件
 * 直接零拷贝引用，落在 cwd 之外的一律拒绝，交给调用方走原有上传 / 引用管线 ——
 * `@` token 的语义始终是「项目内文件」，不能靠 `..` 或相似前缀把它掰弯。
 */

const WINDOWS_DRIVE_RE = /^[a-zA-Z]:/;

/** 统一正斜杠并去掉末尾斜杠（单独的盘符根 / 根目录也会被剥成空串）。 */
export function normalizePathSlashes(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isWindowsDrivePath(p: string): boolean {
  return WINDOWS_DRIVE_RE.test(p);
}

/** 比较用 key：Windows 路径大小写不敏感（盘符大小写混用很常见）。 */
function pathCompareKey(p: string): string {
  return isWindowsDrivePath(p) ? p.toLowerCase() : p;
}

/** 路径里是否含有 `..` 段 —— 有就拒绝，绝不尝试 resolve。 */
function hasParentTraversal(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => segment === "..");
}

export interface CwdRelativeResult {
  /** cwd 相对、以 `/` 分隔、无前导 `./` 的路径。 */
  mentions: string[];
  /** 落在 cwd 之外（或无法安全相对化）的绝对路径，原样带回给调用方。 */
  rejected: string[];
}

/**
 * 把一批绝对路径转成 cwd 相对 `@` 路径。
 *
 * 只有确实位于 cwd 之下的路径才会被接受；其余（包括 `..` 逃逸、前缀相似的兄弟
 * 目录、大小写不一致的盘符根）一律进 `rejected`，让调用方保留「上传 / 就地引用」
 * 的兜底，而不是把不合法的 token 插进草稿。
 *
 * 防逃逸策略：即使字符串前缀匹配，只要相对段里出现任何 `..` 就拒绝（例如
 * `/repo/src/../../etc/passwd` 前缀是 `/repo/` 但实际指向 cwd 之外）。这是有意的
 * 保守选择 —— 拖入的路径来自 Electron，本身一定是规范化的，不会因为拒绝合法
 * 的 `a/../b` 而误伤。
 */
export function toCwdRelativeMentions(absPaths: string[], cwd: string): CwdRelativeResult {
  const mentions: string[] = [];
  const rejected: string[] = [];

  const normalizedCwd = normalizePathSlashes(cwd);
  // 空 cwd 无法判断归属，全部拒绝；cwd 是文件系统根时，所有绝对路径都在它下面。
  const rootCwd = normalizedCwd === "" && /^[\\/]+$/.test(cwd);
  if (!normalizedCwd && !rootCwd) {
    return { mentions, rejected: [...absPaths] };
  }
  const cwdKey = pathCompareKey(normalizedCwd);
  const cwdPrefix = `${cwdKey}/`;

  for (const raw of absPaths) {
    const normalized = normalizePathSlashes(raw);
    if (!normalized) {
      rejected.push(raw);
      continue;
    }

    let relative: string;
    if (rootCwd) {
      // 根目录：去掉前导斜杠即为相对路径；根自身没有可引用的相对形式。
      const stripped = normalized.replace(/^\/+/, "");
      if (!stripped) {
        rejected.push(raw);
        continue;
      }
      relative = stripped;
    } else {
      if (normalized === normalizedCwd) {
        rejected.push(raw);
        continue;
      }
      const key = pathCompareKey(normalized);
      if (!key.startsWith(cwdPrefix)) {
        rejected.push(raw);
        continue;
      }
      relative = normalized.slice(normalizedCwd.length + 1);
    }

    if (!relative || hasParentTraversal(relative)) {
      rejected.push(raw);
      continue;
    }
    // 归一化多余的空段与 `.` 段（`/repo//a/./b.ts` → `a/b.ts`）；空结果说明剥
    // 到最后就是 cwd 本身，同样拒绝。
    const cleaned = relative.split("/").filter((segment) => segment !== "" && segment !== ".").join("/");
    if (!cleaned) {
      rejected.push(raw);
      continue;
    }
    mentions.push(cleaned);
  }

  return { mentions, rejected };
}
