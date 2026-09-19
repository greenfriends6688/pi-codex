# 0004 · Windows 上 `npm run prod` / `dev:clean` 静默失败

| 项 | 值 |
| --- | --- |
| 意图 | 让本仓记录的两条日常命令（`npm run prod` / `npm run dev:clean`）在 Windows 上能用 |
| 补丁文件 | [`0004-windows-next-mode.patch`](./0004-windows-next-mode.patch) |
| fork 标记 | 无（改的是本仓自带的 `scripts/next-mode.mjs`，不是上游文件） |
| 新增文件 | 无 |
| 上游文件接触面 | 无（`scripts/next-mode.mjs` 是本仓脚本） |

## 根因：`spawnSync("next", { shell: false })` 在 Windows 上必然 ENOENT

`scripts/next-mode.mjs` 原本三处都是：

```js
const r = spawnSync("next", ["dev", "-H", HOST, "-p", PORT], { stdio: "inherit", shell: false });
```

Windows 上 `next` 不是可执行文件，而是 `node_modules/.bin/next.cmd`（外加 `next.ps1` / 无扩展名的 shim）。
`spawnSync` 在 `shell: false` 下不做 `.cmd` 解析 → 直接 `ENOENT`。

现场表现很容易误导人：

- 脚本打印 `[prod] 构建中 ...` 后**立刻**打印 `[prod] 构建失败，未启动服务`，
  **中间一行构建输出都没有**（子进程根本没起来，所以 `stdio: "inherit"` 也没有东西可继承）；
- `next-mode.mjs prod` 里 `spawnSync` 返回的 `status` 为空 → `process.exit(b.status ?? 1)` 退出码 1。

即：不是「构建失败」，而是**构建从未开始**；`dev` 分支同理。

## 方案

不再 spawn 命令名，而是用当前 node 直接跑 next 的 JS 入口，并显式固定 `cwd`：

```js
function nextCli() {
  const pkgPath = createRequire(import.meta.url).resolve("next/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.next;
  return join(dirname(pkgPath), bin ?? "dist/bin/next");
}

function runNext(args) {
  return spawnSync(process.execPath, [nextCli(), ...args], { stdio: "inherit", cwd: ROOT });
}
```

好处：三平台通用（不依赖 `.cmd`/`.ps1` shim 与 PATH）、不依赖 shell 的引号规则、`cwd` 明确，
且用的是**本仓安装的那份** next（不会误用全局 next）。

## 验收

- `node scripts/fork-patch.mjs --selftest` 与本文件无关，略。
- `npm run prod`（Windows / PowerShell）实测：构建走完
  （`Compiled successfully` → `Finished TypeScript` → `Generating static pages (18/18)` →
  `Collecting build traces` → `next start`），`127.0.0.1:30141` 起来并能响应
  `GET /` 200、`/api/sessions` 200。
- `npm run dev:clean` 同样可用（本补丁落地后就是用它起的 dev 服务）。

## 已知取舍

- `dist/bin/next` 是 next 的 bin 入口路径兜底；若上游 next 改了 `bin` 字段形状（例如改成
  `{ next: { ... } }`），`nextCli()` 会回退到 `dist/bin/next`，必要时再跟着改。
- 没有改 `package.json` 里的 npm scripts：`npm run dev` / `start` 由 npm 自己解析 `.cmd`，
  它们本来就是好的；坏的只有绕过 npm 直接 spawn 的这份脚本。

## 合并上游后怎么重打

`scripts/next-mode.mjs` 是本仓脚本，上游不含它。若哪天上游也加了同类脚本而与本文件重名，
保留本文件的 `runNext()` 实现（Windows 上唯一能用的版本）。
