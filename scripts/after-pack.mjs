// after-pack.mjs — electron-builder afterPack 钩子
// Turbopack 把 serverExternalPackages（undici、pi SDK、node-pty 等）外部化为
// .next/node_modules/<pkg>-<hash> 符号链接，指向项目 node_modules；electron-builder
// 既不带符号链接打包，也默认把嵌套 node_modules 过滤掉。打包脚本已把符号链接解引用
// 成真实副本，这里在签名前把它们注入到 .app 的 Resources/app/.next/ 下。
// （macOS 必须在签名前注入，签名会封印 Contents/Resources/）
import { cpSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

export default async function afterPack(context) {
  const { appOutDir, packager } = context;
  // appOutDir 是包含 .app 的目录（如 release/mac-arm64），不是 bundle 内部
  const projectDir = packager.info?.projectDir || process.cwd();
  const productName = packager.appInfo.productFilename;

  const src = resolve(join(projectDir, ".next", "node_modules"));
  const dest = join(
    appOutDir,
    `${productName}.app`,
    "Contents",
    "Resources",
    "app",
    ".next",
    "node_modules",
  );

  if (!existsSync(src)) {
    console.log("[after-pack] 无 .next/node_modules（webpack 构建或为空），跳过注入");
    return;
  }
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[after-pack] 已注入 .next/node_modules (${src}) -> ${dest}`);
}