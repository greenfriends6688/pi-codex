# 0018 · 命令环境测试的平台修正（fork:test-platform-fix）

| 项 | 值 |
| --- | --- |
| 意图 | 修掉 Windows 上一条**假失败**：测试用宿主分隔符去构建「platform: linux」用例的期望值 |
| fork 标记 | `fork:test-platform-fix`（注释里） |
| 上游文件接触面 | 1 个：`lib/project-command-env.test.mjs`（1 行 + 注释） |
| `.patch` | [`0018-command-env-test-platform.patch`](./0018-command-env-test-platform.patch)（0.7KB） |

## 这个 bug 不在产品代码里（更正一个先前的判断）

先前我把这条失败归类成「上游代码在 Windows 上的真实小 bug（PATH 用 `:` 而不是 `;`）」。**读过实现之后是错的**：`lib/project-command-env.ts` 的 `withAgentBinDirectory()` 本来就是按**传入的 `platform` 选项**决定分隔符与 PATH 键名：

```ts
const pathKey = platform === "win32" ? Object.keys(environment).find((n) => n.toUpperCase() === "PATH") ?? "PATH" : "PATH";
const pathDelimiter = platform === "win32" ? ";" : ":";
```

问题在测试：`lib/project-command-env.test.mjs` 里那个用例显式声明 `platform: "linux"`，但期望值用的是**从 `node:path` 导入的宿主 `delimiter`**：

```ts
expected: { Path: "project-metadata", PATH: `${agentBinDir}${delimiter}/usr/bin` }
```

在 macOS（当初写测试的机器）上宿主也是 `:`，两种写法结果一样，所以一直绿；在 Windows 上宿主是 `;`，用例的「linux」期望值就写成了 `bin;/usr/bin`，而实现按 linux 规则给的是 `bin:/usr/bin` → 假失败。于是这条失败在 Windows 上被当成「环境性失败」长期挂着。

## 修法

期望值明确写 linux 的分隔符，并留一行注释说明「分隔符要跟着**用例的**平台走」——免得以后有人又改回宿主 `delimiter`。

## 验收

- `node --experimental-strip-types --test lib/project-command-env.test.mjs` → **7/7 通过**（此前 1 条假失败）。
- 全量测试里这条不再出现在失败列表；失败数从 6 条降到 5 条（剩下的都是真环境性：ProjectChip ×2、node-pty ×2、ChatInput jiti ×1）。
