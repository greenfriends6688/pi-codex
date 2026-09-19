// after-pack.mjs — electron-builder afterPack 钩子
// Turbopack 把 serverExternalPackages（undici、pi SDK、node-pty 等）外部化为
// .next/node_modules/<pkg>-<hash> 符号链接，指向项目 node_modules；electron-builder
// 既不带符号链接打包，也默认把嵌套 node_modules 过滤掉。打包脚本已把符号链接解引用
// 成真实副本，这里把它们注入到产物的 app/.next/ 下。
//
// 产物布局依平台不同（asar:false 时整个项目被平铺到 resources/app）：
//   - darwin          <appOutDir>/<Product>.app/Contents/Resources/app
//   - win32 / linux   <appOutDir>/resources/app
// 早期版本只处理了 macOS 的 Contents/Resources 路径，Windows 上会把文件拷到一个
// 不被使用的 <Product>.exe/... 目录（cpSync 会自建目录，所以不报错），产物里则
// 永远缺这一层——表现为打包后 /api/terminal、SSE、会话接口半残。
import { cpSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

export default async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  // appOutDir 是包含 .app / .exe 的那个目录（如 release/mac-arm64、release/win-unpacked），
  // 不是 bundle 内部
  const projectDir = packager.info?.projectDir || process.cwd();
  const productName = packager.appInfo.productFilename;

  const appResources = electronPlatformName === "darwin"
    ? join(appOutDir, `${productName}.app`, "Contents", "Resources")
    : join(appOutDir, "resources");

  if (!existsSync(appResources)) {
    console.log(`[after-pack] 未找到 ${appResources}，跳过注入（打包配置可能变了）`);
    return;
  }

  const src = resolve(join(projectDir, ".next", "node_modules"));
  const dest = join(appResources, "app", ".next", "node_modules");

  if (!existsSync(src)) {
    console.log("[after-pack] 无 .next/node_modules（webpack 构建或为空），跳过注入");
    return;
  }
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[after-pack] 已注入 .next/node_modules (${src}) -> ${dest}`);
}
