export const TEXT_PREVIEW_MAX_BYTES = 256 * 1024;
export const IMAGE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
export const DOCX_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

// These are source/config formats that are safe to edit as UTF-8 text. Files
// outside this allow-list keep the existing read-only viewer behavior.
const EDITABLE_TEXT_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "rb", "go", "rs", "java", "kt", "swift",
  "c", "cpp", "h", "hpp", "cs",
  "html", "htm", "css", "scss", "less",
  "json", "jsonl", "yaml", "yml", "toml", "xml",
  "sh", "bash", "zsh", "fish", "sql", "graphql", "gql",
  "tf", "hcl", "dockerfile", "env", "gitignore", "makefile", "txt",
  "md", "mdx",
  // Added with the "every text file is editable" pass (2026-09-16).
  "ini", "cfg", "conf", "config", "properties", "lock", "csv", "tsv", "log", "text",
  "vue", "svelte", "astro", "php", "pl", "pm", "lua", "r", "dart", "scala", "clj", "cljs",
  "ex", "exs", "erl", "hs", "ml", "mli", "nim", "zig", "v", "asm", "s",
  "bat", "cmd", "ps1", "awk", "sed", "diff", "patch", "tex", "bib", "rst", "adoc", "org", "mmd",
  "gitattributes", "editorconfig", "npmrc", "nvmrc", "bashrc", "zshrc", "profile", "service", "timer",
  "ipynb", "svg", "srt", "vtt", "nix", "gradle", "csproj", "sln", "plist",
]);

export type DocumentPreviewKind = "pdf" | "docx";

export const IMAGE_EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

export const AUDIO_EXT_TO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  weba: "audio/webm",
};

export const VIDEO_EXT_TO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
};

export const DOCUMENT_EXT_TO_MIME: Record<DocumentPreviewKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function getBaseName(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() ?? "";
}

export function getFileExt(filePath: string): string {
  return getBaseName(filePath).toLowerCase().split(".").pop() ?? "";
}

/**
 * Extensions that must never open in the text editor: archives, binaries and
 * anything with a dedicated preview (images / audio / video / office documents).
 * Everything outside this list is editable, because the viewer already falls
 * back to reading unknown types as UTF-8 — user request 2026-09-16: "in
 * principle every file should be editable".
 */
const BINARY_EXTENSIONS = new Set([
  "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar",
  "dmg", "pkg", "app", "exe", "dll", "so", "dylib", "a", "o", "obj", "class", "jar", "pyc",
  "wasm", "bin", "dat", "db", "sqlite", "sqlite3",
  "ttf", "otf", "woff", "woff2", "eot", "icns", "ico",
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "avif", "heic", "svgz",
  "pdf", "docx", "xlsx", "pptx", "doc", "xls", "ppt",
  "mp3", "wav", "ogg", "flac", "m4a", "aac", "mp4", "mov", "avi", "mkv", "webm",
]);

export function isEditableTextPath(filePath: string): boolean {
  const ext = getFileExt(filePath);
  // Extension-less names (Dockerfile, Makefile, LICENSE…) are text.
  if (!ext) return true;
  if (EDITABLE_TEXT_EXTENSIONS.has(ext)) return true;
  if (BINARY_EXTENSIONS.has(ext)) return false;
  if (IMAGE_EXT_TO_MIME[ext] || AUDIO_EXT_TO_MIME[ext] || VIDEO_EXT_TO_MIME[ext]) return false;
  if (DOCUMENT_EXT_TO_MIME[ext as DocumentPreviewKind]) return false;
  return true;
}

export function getImageMime(filePath: string): string | null {
  return IMAGE_EXT_TO_MIME[getFileExt(filePath)] ?? null;
}

export function getAudioMime(filePath: string): string | null {
  return AUDIO_EXT_TO_MIME[getFileExt(filePath)] ?? null;
}

export function getVideoMime(filePath: string): string | null {
  return VIDEO_EXT_TO_MIME[getFileExt(filePath)] ?? null;
}

export function getDocumentMime(filePath: string): string | null {
  return DOCUMENT_EXT_TO_MIME[getFileExt(filePath) as DocumentPreviewKind] ?? null;
}

export function documentPreviewKind(filePath: string): DocumentPreviewKind | null {
  const ext = getFileExt(filePath);
  if (ext === "pdf" || ext === "docx") return ext;
  return null;
}

export function isImagePath(filePath: string): boolean {
  return getImageMime(filePath) !== null;
}

export function isAudioPath(filePath: string): boolean {
  return getAudioMime(filePath) !== null;
}

export function isVideoPath(filePath: string): boolean {
  return getVideoMime(filePath) !== null;
}

export function isDocumentPreviewPath(filePath: string): boolean {
  return documentPreviewKind(filePath) !== null;
}
