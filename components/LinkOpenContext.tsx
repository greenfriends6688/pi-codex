"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * fork:open-link-in-app — 链接该在哪儿打开。
 *
 * 应用里本来就有内置浏览器面板（`BrowserPanel` + AppShell 的 `handleOpenBrowser`），
 * 但**没有任何一处链接调它**：正文/预览里的外链全是裸 `<a target="_blank">`，
 * Electron 的 `setWindowOpenHandler` 再把它们全转给系统浏览器。于是"点链接"
 * 永远等于"跳出应用"。
 *
 * 用 context 而不是层层传 prop：MarkdownBody 出现在聊天正文、处理详情、
 * 文件预览、设置里的说明文字……每一处单独接线既啰嗦又漏。这里在 AppShell
 * 挂一次，`MarkdownBody` 的 `a` 渲染器直接取。
 *
 * 取值 `null` = 没有内置浏览器可用（例如独立渲染的测试），此时保持原行为
 * （`target="_blank"` 交给系统浏览器）。
 */
export const LinkOpenContext = createContext<((url: string) => void) | null>(null);

export function LinkOpenProvider({ onOpenLink, children }: { onOpenLink: (url: string) => void; children: ReactNode }) {
  return <LinkOpenContext.Provider value={onOpenLink}>{children}</LinkOpenContext.Provider>;
}

export function useOpenLink(): ((url: string) => void) | null {
  return useContext(LinkOpenContext);
}
