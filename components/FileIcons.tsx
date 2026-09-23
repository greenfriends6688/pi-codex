import type { CSSProperties } from "react";


interface IconProps {
  size?: number;
}

type CatppuccinIconName =
  | "_file"
  | "_folder"
  | "_folder_open"
  | "bash"
  | "config"
  | "css"
  | "database"
  | "docker"
  | "env"
  | "git"
  | "graphql"
  | "html"
  | "javascript"
  | "javascript-react"
  | "json"
  | "lock"
  | "npm-lock"
  | "bun-lock"
  | "next"
  | "eslint"
  | "markdown"
  | "ms-word"
  | "pdf"
  | "python"
  | "rust"
  | "sass"
  | "terraform"
  | "toml"
  | "typescript"
  | "typescript-react"
  | "yaml"
  | "go";

const CATPPUCCIN_ICONS_ROOT = "/icons/catppuccin";

function CatppuccinIcon({ name, size = 14 }: IconProps & { name: CatppuccinIconName }) {
  const style = {
    width: size,
    height: size,
    "--catppuccin-icon-light": `url(${CATPPUCCIN_ICONS_ROOT}/latte/${name}.svg)`,
    "--catppuccin-icon-dark": `url(${CATPPUCCIN_ICONS_ROOT}/mocha/${name}.svg)`,
  } as CSSProperties;

  return (
    <span
      aria-hidden="true"
      className="catppuccin-file-icon"
      style={style}
    />
  );
}

export function FolderIcon({ size = 14, open = false }: IconProps & { open?: boolean }) {
  return <CatppuccinIcon name={open ? "_folder_open" : "_folder"} size={size} />;
}

export function GenericFileIcon({ size = 14 }: IconProps) {
  return <CatppuccinIcon name="_file" size={size} />;
}

const EXTENSION_ICONS: Record<string, CatppuccinIconName> = {
  ts: "typescript",
  tsx: "typescript-react",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript-react",
  py: "python",
  json: "json",
  jsonl: "json",
  css: "css",
  less: "css",
  scss: "sass",
  html: "html",
  htm: "html",
  md: "markdown",
  mdx: "markdown",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  rs: "rust",
  go: "go",
  sql: "database",
  graphql: "graphql",
  gql: "graphql",
  tf: "terraform",
  hcl: "terraform",
  docx: "ms-word",
  pdf: "pdf",
  lock: "lock",
};

function getSpecialFileIcon(name: string): CatppuccinIconName | undefined {
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "docker";
  if (name === ".env" || name.startsWith(".env.")) return "env";
  if ([".gitignore", ".gitattributes", ".gitmodules"].includes(name)) return "git";
  if (name === "package-lock.json") return "npm-lock";
  if (name === "bun.lock") return "bun-lock";
  if (["next.config.js", "next.config.mjs", "next.config.cjs", "next.config.ts"].includes(name)) return "next";
  if ([".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", "eslint.config.mjs", "eslint.config.js"].includes(name)) return "eslint";
  if (["yarn.lock", "pnpm-lock.yaml", "cargo.lock"].includes(name)) return "lock";
  if (name.endsWith(".config.ts") || name.endsWith(".config.js") || name.endsWith(".config.mjs") || name.endsWith(".config.cjs")) return "config";
  return undefined;
}

export function getFileIcon(name: string, size = 14): React.ReactNode {
  const lower = name.toLowerCase();
  const specialIcon = getSpecialFileIcon(lower);
  if (specialIcon) return <CatppuccinIcon name={specialIcon} size={size} />;

  const ext = lower.split(".").pop() ?? "";
  const icon = EXTENSION_ICONS[ext];
  return icon ? <CatppuccinIcon name={icon} size={size} /> : <GenericFileIcon size={size} />;
}

/**
 * fork:ui-file-manager-icon — 系统文件管理器的**平台图标**。
 *
 * 原来无论哪个平台都画一个通用文件夹轮廓，跟系统里别处（Dock、任务栏、其它应用）的
 * 图标对不上。这里按服务端给的 `process.platform` 出图：macOS 用 Finder 的笑脸，
 * Windows 用资源管理器的黄色文件夹 + 蓝色条，其余平台保留通用轮廓。
 */
export function FileManagerIcon({ platform, size = 14 }: IconProps & { platform?: string | null }) {
  if (platform === "darwin") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        {/* Finder：圆角方块分左右两半（右半深一档），白脸 + 眼睛 + 微笑。 */}
        <rect x="2" y="2" width="20" height="20" rx="5.2" fill="#3fa9f5" />
        <path d="M12 2h4.8A5.2 5.2 0 0 1 22 7.2V22H12Z" fill="#1b7fd4" />
        <path d="M7.6 9.4v2.4M16.4 9.4v2.4" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M7.8 15.2c1.2 1.3 2.6 2 4.2 2s3-.7 4.2-2" stroke="#fff" strokeWidth="1.7" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  if (platform === "win32") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        {/* 资源管理器：后板深黄、前板亮黄，前板上沿一条蓝带。 */}
        <path d="M2.6 6.6A1.6 1.6 0 0 1 4.2 5h4.3l1.8 1.9h9.5A1.6 1.6 0 0 1 21.4 8.5v9.9a1.6 1.6 0 0 1-1.6 1.6H4.2a1.6 1.6 0 0 1-1.6-1.6Z" fill="#e0a92c" />
        <path d="M2.6 9.4h18.8v9a1.6 1.6 0 0 1-1.6 1.6H4.2a1.6 1.6 0 0 1-1.6-1.6Z" fill="#ffd35c" />
        <path d="M2.6 9.4h18.8v2.1H2.6Z" fill="#2b7fff" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8a2 2 0 0 1 2-2h3.4l1.9 1.9H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}
