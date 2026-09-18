/**
 * fork:gap-unsupported-preview — 判断"这个文件能不能在应用内预览"（纯逻辑 + 单测）。
 *
 * 背景（`docs/proma-feature-matrix-2026-09-18.md` §3.3）：本仓库对无法预览的文件
 * **没有降级卡片**——二进制文件（`.zip`、`.wasm`、`.sqlite`、可执行文件…）会被当作
 * UTF-8 文本渲染，用户看到的是一片乱码，既不知道这是二进制、也拿不到"用系统应用打开"
 * 的入口。对照项目给的是带元数据与默认应用按钮的卡片。
 *
 * 这个模块只做分类，UI 在 `components/fork/UnsupportedFilePreview.tsx`。
 */

/** 明确按二进制处理的扩展名（与 `lib/file-types.ts` 的编辑黑名单同源，但用途不同）。 */
const BINARY_EXTENSIONS = new Set([
  "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar", "dmg", "pkg", "iso",
  "exe", "dll", "so", "dylib", "node", "o", "a", "class", "jar", "wasm",
  "sqlite", "sqlite3", "db", "realm", "mdb",
  "ttf", "otf", "woff", "woff2", "eot",
  "psd", "ai", "sketch", "fig", "xd",
  "pyc", "pyo", "obj", "bin", "dat", "pack", "idx",
]);

/** 已知能预览的类别（判定为这些就交给对应的查看器）。 */
const PREVIEWABLE_EXTENSIONS = new Set([
  // 文本 / 代码 / 结构化文本
  "txt", "text", "log", "md", "markdown", "mdx", "json", "json5", "jsonc", "yaml", "yml", "toml", "ini", "conf", "cfg", "env",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "scss", "less", "html", "htm", "xml", "svg", "vue", "svelte", "astro",
  "py", "rb", "go", "rs", "java", "kt", "kts", "swift", "c", "h", "cc", "cpp", "hpp", "cs", "php", "pl", "lua", "r", "jl", "scala", "dart", "ex", "exs", "erl", "hs", "ml", "clj", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
  "sql", "graphql", "gql", "proto", "diff", "patch", "csv", "tsv", "lock", "gitignore", "dockerfile", "makefile",
  // 图片 / 音视频 / 文档
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "tif", "tiff",
  "mp3", "wav", "ogg", "m4a", "flac", "aac", "opus",
  "mp4", "mov", "webm", "mkv", "avi", "m4v",
  "pdf", "docx",
]);

export type PreviewSupport = "supported" | "binary" | "unknown";

/** 取扩展名（小写、不含点）；没有扩展名返回空串。 */
export function extensionOf(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? "";
  const index = base.lastIndexOf(".");
  if (index <= 0 || index === base.length - 1) return "";
  return base.slice(index + 1).toLowerCase();
}

/** 无扩展名的常见文本文件名（Dockerfile、Makefile…）按可预览处理。 */
const EXTENSIONLESS_TEXT_NAMES = new Set([
  "dockerfile", "makefile", "gemfile", "procfile", "brewfile", "rakefile", "license", "licence", "notice", "authors", "changelog",
]);

export function previewSupport(filePath: string): PreviewSupport {
  const base = (filePath.split(/[\\/]/).pop() ?? "").toLowerCase();
  if (EXTENSIONLESS_TEXT_NAMES.has(base)) return "supported";
  const ext = extensionOf(filePath);
  if (!ext) return "supported"; // 无扩展名一律按文本处理（与 isEditableTextPath 一致）
  if (PREVIEWABLE_EXTENSIONS.has(ext)) return "supported";
  if (BINARY_EXTENSIONS.has(ext)) return "binary";
  return "unknown";
}

/** 是否应该显示"无法预览"的降级卡片。 */
export function shouldShowUnsupportedCard(filePath: string): boolean {
  return previewSupport(filePath) !== "supported";
}

/**
 * 降级原因文案的 i18n 键与展示用扩展名。
 * 拆出来是为了让 UI 层不重复实现一遍分类。
 */
export function unsupportedReasonKey(filePath: string): "i18n.unsupportedBinary" | "i18n.unsupportedUnknown" {
  return previewSupport(filePath) === "binary" ? "i18n.unsupportedBinary" : "i18n.unsupportedUnknown";
}
