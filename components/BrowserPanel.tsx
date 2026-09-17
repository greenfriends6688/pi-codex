"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { normalizeBrowserUrl, type BrowserTab } from "./browser-tab-state";

interface Props {
  tab: BrowserTab;
  /** Keep the tab's url in AppShell state so sessionStorage survives a refresh. */
  onChangeUrl: (tabId: string, url: string) => void;
}

/**
 * An in-app browser for local services (dev servers, docs servers, localhost
 * tools). It is an iframe, so sites that send `X-Frame-Options: DENY` or a
 * `frame-ancestors` CSP simply stay blank — the toolbar offers "open in a new
 * window" for those, and the hint below the address bar says so.
 */
export function BrowserPanel({ tab, onChangeUrl }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(tab.url);
  const [history, setHistory] = useState<string[]>(() => (tab.url ? [tab.url] : []));
  const [historyIndex, setHistoryIndex] = useState(() => (tab.url ? 0 : -1));
  const [reloadKey, setReloadKey] = useState(0);
  // fork:ui-30 — viewport preset. `null` keeps the iframe filling the panel; a
  // number pins it to a device width and centres it, which is the only way to
  // check a responsive layout without a second device.
  const [viewport, setViewport] = useState<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // A tab restored from sessionStorage carries a url the component never saw.
  useEffect(() => {
    setDraft(tab.url);
    setHistory(tab.url ? [tab.url] : []);
    setHistoryIndex(tab.url ? 0 : -1);
  }, [tab.id, tab.url]);

  const currentUrl = history[historyIndex] ?? "";

  const navigate = (input: string, { replace = false } = {}) => {
    const url = normalizeBrowserUrl(input);
    if (!url) return;
    setDraft(url);
    onChangeUrl(tab.id, url);
    if (replace || historyIndex < 0) {
      setHistory((entries) => [...entries.slice(0, historyIndex + 1), url]);
      setHistoryIndex((index) => (historyIndex < 0 ? 0 : index + 1));
      return;
    }
    // Same url: just reload.
    if (url === currentUrl) {
      setReloadKey((key) => key + 1);
      return;
    }
    setHistory((entries) => [...entries.slice(0, historyIndex + 1), url]);
    setHistoryIndex(historyIndex + 1);
  };

  const go = (delta: number) => {
    const next = historyIndex + delta;
    if (next < 0 || next >= history.length) return;
    setHistoryIndex(next);
    const url = history[next];
    setDraft(url);
    onChangeUrl(tab.id, url);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--bg)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          className="file-viewer-icon-button"
          title={t("browser.back")}
          aria-label={t("browser.back")}
          disabled={historyIndex <= 0}
          onClick={() => go(-1)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5" /><polyline points="11 18 5 12 11 6" />
          </svg>
        </button>
        <button
          type="button"
          className="file-viewer-icon-button"
          title={t("browser.forward")}
          aria-label={t("browser.forward")}
          disabled={historyIndex >= history.length - 1}
          onClick={() => go(1)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14" /><polyline points="13 6 19 12 13 18" />
          </svg>
        </button>
        <button
          type="button"
          className="file-viewer-icon-button"
          title={t("browser.reload")}
          aria-label={t("browser.reload")}
          disabled={!currentUrl}
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
          </svg>
        </button>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            navigate(draft);
          }}
          placeholder={t("browser.addressPlaceholder")}
          aria-label={t("browser.address")}
          spellCheck={false}
          autoComplete="off"
          style={{
            flex: 1,
            minWidth: 0,
            height: 28,
            padding: "0 10px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            background: "var(--bg)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            outline: "none",
          }}
        />
        <a
          href={currentUrl || undefined}
          target="_blank"
          rel="noopener noreferrer"
          title={t("browser.openExternal")}
          aria-label={t("browser.openExternal")}
          className="file-viewer-icon-button"
          aria-disabled={!currentUrl}
          style={{ opacity: currentUrl ? 1 : 0.45, pointerEvents: currentUrl ? "auto" : "none" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 3h6v6" /><path d="M10 14 21 3" />
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          </svg>
        </a>
        {/* fork:ui-30 — device widths for checking a responsive layout in place. */}
        <select
          value={viewport === null ? "fill" : String(viewport)}
          onChange={(event) => setViewport(event.target.value === "fill" ? null : Number(event.target.value))}
          title={t("browser.viewport")}
          aria-label={t("browser.viewport")}
          style={{
            height: 28,
            padding: "0 4px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            background: "var(--bg)",
            color: "var(--text-muted)",
            fontSize: 11,
            flexShrink: 0,
          }}
        >
          <option value="fill">{t("browser.viewportFill")}</option>
          <option value="390">{t("browser.viewportPhone")}</option>
          <option value="768">{t("browser.viewportTablet")}</option>
          <option value="1024">{t("browser.viewportLaptop")}</option>
          <option value="1280">{t("browser.viewportDesktop")}</option>
        </select>
      </div>

      {currentUrl ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            justifyContent: "center",
            background: viewport === null ? "var(--bg)" : "var(--bg-panel)",
          }}
        >
        <iframe
          ref={iframeRef}
          key={`${currentUrl}#${reloadKey}`}
          src={currentUrl}
          title={tab.url}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
          referrerPolicy="no-referrer"
          style={{
            flex: viewport === null ? 1 : "0 0 auto",
            minHeight: 0,
            width: viewport === null ? "100%" : viewport,
            maxWidth: "100%",
            border: "none",
            background: "var(--bg)",
            ...(viewport === null ? {} : { boxShadow: "var(--shadow-sm)", borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)" }),
          }}
        />
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: 24,
            color: "var(--text-dim)",
            fontSize: 12,
            textAlign: "center",
          }}
        >
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("browser.emptyTitle")}</div>
          <div style={{ maxWidth: 420, lineHeight: 1.6 }}>{t("browser.emptyHint")}</div>
        </div>
      )}
    </div>
  );
}
