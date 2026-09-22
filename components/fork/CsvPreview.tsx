"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getFileExt } from "@/lib/file-types";
import { parseDelimitedText } from "@/lib/csv-preview";
import { TEXT } from "@/lib/typography";

/**
 * fork:zc-12 — CSV / TSV 表格预览。
 *
 * WHY：宽表按逐行文本渲染时列对不齐，几百行的文件也没法快速扫。这里把解析交给
 * 纯函数 `lib/csv-preview.ts`，组件只负责画：
 *
 *   - 行窗口化：只挂载视口内 + 少量 overscan 的行，滚动时按固定行高换窗口，
 *     不引虚拟化库（表格行高固定，计算比测量便宜也更稳）；
 *   - 表头粘顶，单元格 nowrap + ellipsis，hover 出完整值；
 *   - 解析层的截断 / 行宽不齐 / 源内容截断都在顶部给出提示条。
 */

const ROW_HEIGHT = 26;
const OVERSCAN = 12;
const FALLBACK_VIEWPORT_HEIGHT = 480;

interface Props {
  content: string;
  filePath: string;
  /** fork:zc-12 — 文件接口在 256KB 处截断了源内容，解析结果不代表整个文件。 */
  sourceTruncated?: boolean;
}

function WarningBar({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      style={{
        padding: "4px 12px",
        borderBottom: "1px solid var(--border)",
        background: "var(--warning-soft)",
        color: "var(--warning)",
        fontSize: TEXT.xs,
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

export function CsvPreview({ content, filePath, sourceTruncated = false }: Props) {
  const { t } = useI18n();
  // 扩展名是比内容更强的意图信号：.tsv 恒用 tab，其余交给嗅探。
  const parsed = useMemo(
    () => parseDelimitedText(content, getFileExt(filePath) === "tsv" ? { delimiter: "\t" } : undefined),
    [content, filePath],
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setViewportHeight(element.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rows = parsed.rows;
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const lastRow = Math.min(
    rows.length,
    firstRow + Math.max(1, Math.ceil((viewportHeight || FALLBACK_VIEWPORT_HEIGHT) / ROW_HEIGHT)) + OVERSCAN * 2,
  );
  const visibleRows = rows.slice(firstRow, lastRow);
  const columnCount = Math.max(parsed.header.length, parsed.columnCount, 1);

  const headerCellStyle: CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 1,
    padding: "4px 10px",
    background: "var(--bg-panel)",
    borderBottom: "1px solid var(--border)",
    borderRight: "1px solid var(--border)",
    color: "var(--text-muted)",
    fontWeight: 600,
    textAlign: "left",
    whiteSpace: "nowrap",
    maxWidth: 360,
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
  const bodyCellStyle: CSSProperties = {
    padding: "3px 10px",
    borderBottom: "1px solid var(--border)",
    borderRight: "1px solid var(--border)",
    color: "var(--text)",
    whiteSpace: "nowrap",
    maxWidth: 360,
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
  const spacerCellStyle = (height: number): CSSProperties => ({ padding: 0, border: "none", height });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--bg)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "4px 12px",
          borderBottom: "1px solid var(--border)",
          color: "var(--text-dim)",
          fontSize: TEXT.xs,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            padding: "1px 6px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {parsed.delimiter === "\t" ? t("csv.delimiterTab") : t("csv.delimiterComma")}
        </span>
        <span>{t("csv.rows", { count: parsed.rowCount })}</span>
        <span>{t("csv.columns", { count: columnCount })}</span>
      </div>

      {sourceTruncated && <WarningBar>{t("csv.sourceTruncated")}</WarningBar>}
      {parsed.columnsTruncated && <WarningBar>{t("csv.truncatedColumns", { count: columnCount })}</WarningBar>}
      {parsed.rowsTruncated && <WarningBar>{t("csv.truncatedRows", { count: parsed.rowCount })}</WarningBar>}
      {parsed.ragged && (
        <WarningBar>{t("csv.raggedRows", { count: parsed.raggedRows })}</WarningBar>
      )}

      {parsed.header.length === 0 ? (
        <div style={{ padding: "16px 12px", color: "var(--text-dim)", fontSize: TEXT.sm }}>{t("csv.empty")}</div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          style={{ flex: 1, minHeight: 0, overflow: "auto" }}
        >
          <table
            style={{
              borderCollapse: "collapse",
              fontFamily: "var(--font-mono)",
              fontSize: TEXT.sm,
              width: "max-content",
              minWidth: "100%",
            }}
          >
            <thead>
              <tr>
                {parsed.header.map((cell, columnIndex) => (
                  <th key={columnIndex} style={headerCellStyle} title={cell}>
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {firstRow > 0 && (
                <tr style={{ height: firstRow * ROW_HEIGHT }} aria-hidden="true">
                  <td colSpan={columnCount} style={spacerCellStyle(firstRow * ROW_HEIGHT)} />
                </tr>
              )}
              {visibleRows.map((row, visibleIndex) => (
                <tr key={firstRow + visibleIndex} style={{ height: ROW_HEIGHT }}>
                  {parsed.header.map((_, columnIndex) => {
                    const cell = row[columnIndex] ?? "";
                    return (
                      <td key={columnIndex} style={bodyCellStyle} title={cell}>
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {lastRow < rows.length && (
                <tr style={{ height: (rows.length - lastRow) * ROW_HEIGHT }} aria-hidden="true">
                  <td colSpan={columnCount} style={spacerCellStyle((rows.length - lastRow) * ROW_HEIGHT)} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
