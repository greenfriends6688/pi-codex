/**
 * fork:zc-12 — CSV / TSV 表格预览的纯解析层。
 *
 * WHY：`.csv` / `.tsv` 现在在文件查看器里按普通文本逐行渲染，列对不齐、宽表
 * 横向无法扫读。这里提供一个零依赖的 RFC4180-ish 解析器：
 *
 *   - 分隔符嗅探（`,` vs `\t`），按「有分隔符的行数」投票，再比出现次数；
 *   - 引号字段支持 `""` 转义、引号内换行、CRLF / LF / CR 三种行尾；
 *   - 行 / 列有上限，超过时置 `rowsTruncated` / `columnsTruncated`；
 *   - 行宽与表头不一致时置 `ragged` 并给出计数，UI 负责提示。
 *
 * 解析只做「行 × 列」的数据结构，不做渲染窗口 —— 窗口化在 CsvPreview 里，
 * 这样纯函数可以直接单测，组件只负责画。
 */

export type CsvDelimiter = "," | "\t";

export const CSV_SNIFF_LINE_LIMIT = 10;
export const CSV_DEFAULT_MAX_ROWS = 2_000;
export const CSV_DEFAULT_MAX_COLUMNS = 200;

export interface CsvParseOptions {
  /** 显式指定分隔符；缺省时按内容嗅探（文件扩展名的优先级由调用方决定）。 */
  delimiter?: CsvDelimiter;
  maxRows?: number;
  maxColumns?: number;
}

export interface CsvParseResult {
  delimiter: CsvDelimiter;
  /** 第一行（表头）；空文件为 `[]`。 */
  header: string[];
  /** 表头之后的数据行，已按上限截断。 */
  rows: string[][];
  rowCount: number;
  columnCount: number;
  /** 任一维度发生截断。 */
  truncated: boolean;
  rowsTruncated: boolean;
  columnsTruncated: boolean;
  ragged: boolean;
  /** 与表头列数不一致的数据行条数。 */
  raggedRows: number;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** 统计一行里引号外的分隔符出现次数（嗅探用；不处理跨行引号）。 */
function countDelimitersOutsideQuotes(line: string): { comma: number; tab: number } {
  let comma = 0;
  let tab = 0;
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (char === ",") comma += 1;
    else if (char === "\t") tab += 1;
  }
  return { comma, tab };
}

/**
 * 从前若干行嗅探分隔符。不含任何候选分隔符时默认逗号。
 */
export function sniffDelimiter(text: string): CsvDelimiter {
  const lines = stripBom(text).split(/\r\n|\n|\r/).slice(0, CSV_SNIFF_LINE_LIMIT);
  let commaLines = 0;
  let tabLines = 0;
  let commaCount = 0;
  let tabCount = 0;
  for (const line of lines) {
    const counts = countDelimitersOutsideQuotes(line);
    if (counts.comma > 0) {
      commaLines += 1;
      commaCount += counts.comma;
    }
    if (counts.tab > 0) {
      tabLines += 1;
      tabCount += counts.tab;
    }
  }
  // 大多数行命中的那个赢；行数打平时再比总出现次数（表头是单列的表也可能有
  // 偶发逗号，行数投票更稳）。
  if (tabLines !== commaLines) return tabLines > commaLines ? "\t" : ",";
  return tabCount > commaCount ? "\t" : ",";
}

/**
 * 把 RFC4180-ish 文本解析成表头 + 行数据。
 */
export function parseDelimitedText(text: string, options: CsvParseOptions = {}): CsvParseResult {
  const maxRows = Math.max(1, options.maxRows ?? CSV_DEFAULT_MAX_ROWS);
  const maxColumns = Math.max(1, options.maxColumns ?? CSV_DEFAULT_MAX_COLUMNS);
  const input = stripBom(text);
  const delimiter = options.delimiter ?? sniffDelimiter(input);

  const rawRows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  // A field may only open a quote at its very start; a quote later in an
  // unquoted field is kept literally instead of swallowing the rest of the line.
  let fieldStart = true;
  let rowsTruncated = false;
  let columnsTruncated = false;
  let endedWithNewline = false;

  const pushField = () => {
    if (row.length < maxColumns) row.push(field);
    else columnsTruncated = true;
    field = "";
    fieldStart = true;
  };

  if (input.length === 0) {
    return {
      delimiter,
      header: [],
      rows: [],
      rowCount: 0,
      columnCount: 0,
      truncated: false,
      rowsTruncated: false,
      columnsTruncated: false,
      ragged: false,
      raggedRows: 0,
    };
  }

  let index = 0;
  while (index < input.length) {
    const char = input[index];

    if (!inQuotes && (char === delimiter || char === "\n" || char === "\r")) {
      pushField();
      if (char === delimiter) {
        index += 1;
        continue;
      }
      rawRows.push(row);
      row = [];
      endedWithNewline = true;
      // 表头之外最多保留 maxRows 条；第 maxRows+1 条数据行只用来判定截断。
      if (rawRows.length > maxRows + 1) {
        rowsTruncated = true;
        rawRows.pop();
        break;
      }
      if (char === "\r" && input[index + 1] === "\n") index += 2;
      else index += 1;
      continue;
    }

    if (char === "\"") {
      if (inQuotes) {
        if (input[index + 1] === "\"") {
          field += "\"";
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      if (fieldStart) {
        inQuotes = true;
        fieldStart = false;
        index += 1;
        continue;
      }
      field += "\"";
      fieldStart = false;
      index += 1;
      continue;
    }

    // A newline outside quotes ends the row above; inside quotes it is data.
    if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") {
        field += "\n";
        index += 2;
      } else {
        field += char;
        index += 1;
      }
      fieldStart = false;
      continue;
    }

    field += char;
    fieldStart = false;
    index += 1;
  }

  // The final row has no trailing newline (or the file ended inside quotes): it
  // still needs to be flushed. A file ending with a newline must NOT grow a
  // phantom empty row.
  if (!endedWithNewline || inQuotes || field !== "" || row.length > 0) {
    pushField();
    rawRows.push(row);
  }

  const header = rawRows[0] ?? [];
  const rows = rawRows.slice(1);
  let raggedRows = 0;
  let columnCount = header.length;
  for (const dataRow of rows) {
    if (dataRow.length !== header.length) raggedRows += 1;
    if (dataRow.length > columnCount) columnCount = dataRow.length;
  }

  return {
    delimiter,
    header,
    rows,
    rowCount: rows.length,
    columnCount,
    truncated: rowsTruncated || columnsTruncated,
    rowsTruncated,
    columnsTruncated,
    ragged: raggedRows > 0,
    raggedRows,
  };
}
