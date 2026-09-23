/**
 * fork:zn-18 — 枚举本机可用字体（Zeno `lib/appearance-fonts.ts` 的同款做法）。
 *
 * 浏览器**不能**列出系统字体（隐私），但 Zeno 用两条腿绕过去，两条我们都能用：
 *
 *   1. **Local Font Access API**（`window.queryLocalFonts()`）：Chromium 有，但要
 *      用户授权、且必须是用户手势里调用，Firefox/Safari 没有。拿到的是全量清单。
 *   2. **canvas 探测**：把一段定宽文本分别用 `sans-serif` 和 `"候选字体", sans-serif`
 *      量一遍，宽度不同就说明候选字体存在。零权限、全平台可用，但只能探测**已知候选**。
 *
 * 所以顺序是先试 1、空了再用 2 —— 与 Zeno 一致。候选清单也照抄它的（`UI_PROBE_FAMILIES`，
 * 含中文的 PingFang SC / 微软雅黑 / 思源黑体），因为本仓的中文字形就是靠这几个。
 *
 * 纯浏览器 API + 一个可选的 `queryLocalFonts`，服务端调用返回空清单。
 */

export interface FontChoice {
  /** 下拉的 value：小写族名，`system` 保留给默认栈。 */
  id: string;
  /** 写进 `--font-ui-base` 的 CSS 字体栈。 */
  stack: string;
  /** 下拉里显示的名字。 */
  label: string;
}

export const SYSTEM_FONT_ID = "system";

/** 与 Zeno `UI_PROBE_FAMILIES` 同表；顺序按「本仓最可能用到的排前面」。 */
export const UI_PROBE_FAMILIES = [
  "Inter",
  "SF Pro Text",
  "SF Pro Display",
  "Segoe UI",
  "Helvetica Neue",
  "Helvetica",
  "Arial",
  "Roboto",
  "Noto Sans",
  "Noto Sans CJK SC",
  "Noto Sans SC",
  "Source Han Sans SC",
  "PingFang SC",
  "Hiragino Sans GB",
  "Microsoft YaHei",
  "Microsoft YaHei UI",
  "WenQuanYi Micro Hei",
  "IBM Plex Sans",
  "Source Sans 3",
  "Source Sans Pro",
  "Ubuntu",
  "Cantarell",
  "Optima",
  "Avenir Next",
  "Avenir",
  "Gill Sans",
  "Trebuchet MS",
  "Verdana",
  "Tahoma",
] as const;

/** 等宽族不进「UI 字体」清单：那是另一个旋钮的事，混进来只会让人挑错。 */
const MONO_NAME_RE =
  /mono|consolas|courier|menlo|monaco|cascadia|fira code|jetbrains|iosevka|hack|inconsolata|source code|plex mono|dejavu|liberation|noto sans mono|sarasa|等距|更纱|sf mono/i;

/** 族名里有空格或非 ASCII 就要加引号，否则 CSS 会把它当两个 family 名。 */
function quoteFamily(name: string): string {
  const cleaned = name.replace(/"/g, "");
  return /[\s]/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

/**
 * 把族名包成一条**带回退**的栈：候选字体不存在时仍然落到系统无衬线，
 * 而不是让浏览器退回 serif（选错字体不该让整页变成衬线）。
 */
export function uiFontStackForFamily(primary: string): string {
  const name = primary.trim();
  if (!name) return "";
  if (name.includes(",")) return name;
  return `${quoteFamily(name)}, "SF Pro Text", "Segoe UI", system-ui, -apple-system, sans-serif`;
}

/**
 * canvas 探测：宽度差 > 0.5px 判定存在。
 *
 * 0.5 而不是 0：浏览器对同一段文本的亚像素排版会有微小抖动，阈值取 0 会把
 * 「不存在的字体下仍然多出半像素」判成命中。`document.fonts.check` 只是补充信号
 * —— 它只对**已声明**的 webfont 可靠，对系统字体经常返回 false。
 */
export function canvasDetectsFamily(family: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const probe = "mmmmmmmmmmlli";
    ctx.font = "72px sans-serif";
    const base = ctx.measureText(probe).width;
    ctx.font = `72px ${quoteFamily(family)}, sans-serif`;
    const mixed = ctx.measureText(probe).width;
    if (typeof document.fonts?.check === "function") {
      try {
        if (document.fonts.check(`12px ${quoteFamily(family)}`)) return true;
      } catch {
        // 无效的 font 简写会抛；忽略，继续用宽度判据
      }
    }
    return Math.abs(mixed - base) > 0.5;
  } catch {
    return false;
  }
}

async function familiesFromLocalFonts(): Promise<string[]> {
  const query = (
    window as unknown as { queryLocalFonts?: () => Promise<Array<{ family?: string }>> }
  ).queryLocalFonts;
  if (typeof query !== "function") return [];
  try {
    const fonts = await query();
    const set = new Set<string>();
    for (const font of fonts) {
      const family = font?.family?.trim();
      if (family) set.add(family);
    }
    return [...set];
  } catch {
    // 用户拒绝授权、或不在用户手势里：静默回退到探测
    return [];
  }
}

function familiesFromProbe(): string[] {
  return UI_PROBE_FAMILIES.filter((family) => canvasDetectsFamily(family));
}

/**
 * 本机可用于 UI 的字体 + 「系统默认」一项。
 *
 * 永远至少返回一项（系统默认），所以下拉不会出现空列表。
 */
export async function listInstalledUiFonts(systemLabel: string): Promise<FontChoice[]> {
  const system: FontChoice = { id: SYSTEM_FONT_ID, stack: "", label: systemLabel };

  let families = await familiesFromLocalFonts();
  if (families.length === 0) families = familiesFromProbe();

  const sorted = families
    .filter((family) => !MONO_NAME_RE.test(family))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  // Local Font Access 可能因为权限/平台什么都没给；这时探测结果就是兜底。
  const list = sorted.length > 0 ? sorted : familiesFromProbe().sort(
    (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }),
  );

  const choices: FontChoice[] = [system];
  const seen = new Set<string>([SYSTEM_FONT_ID]);
  for (const family of list) {
    const id = family.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    choices.push({ id, stack: uiFontStackForFamily(family), label: family });
  }
  return choices;
}
