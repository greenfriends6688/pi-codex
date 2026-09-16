/**
 * Browser tabs mirror the terminal tabs: ephemeral, restored from sessionStorage
 * on refresh, addressed by a random id. A tab only ever holds a URL — the page
 * itself lives in an iframe inside BrowserPanel.
 */

export const BROWSER_TABS_KEY = "pi-web:browser-tabs";

export interface BrowserTab {
  id: string;
  url: string;
  restored?: boolean;
}

export function randomBrowserTabId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Adds the missing scheme. Bare hosts get https, except loopback names which are
 * almost always plain-http dev servers.
 */
export function normalizeBrowserUrl(input: string): string {
  const value = input.trim();
  if (!value) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(value)) return `http://${value}`;
  return `https://${value}`;
}

/** Tab label: the host, so several tabs stay distinguishable. */
export function browserTabLabel(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  } catch {
    return url;
  }
}

export function newBrowserTab(url = ""): BrowserTab {
  return { id: randomBrowserTabId(), url: normalizeBrowserUrl(url) };
}

export function restoreBrowserTabs(raw: string | null): {
  tabs: BrowserTab[];
  activeId: string | null;
  open: boolean;
} {
  try {
    const saved = JSON.parse(raw ?? "null");
    const tabs: BrowserTab[] = [];
    for (const tab of Array.isArray(saved?.tabs) ? saved.tabs : []) {
      if (tab && typeof tab.id === "string" && /^[a-f0-9]{32}$/.test(tab.id)) {
        // A tab without a url is a legitimate empty browser tab.
        tabs.push({ id: tab.id, url: typeof tab.url === "string" ? tab.url : "", restored: true });
      }
    }
    return {
      tabs,
      activeId: tabs.some((tab) => tab.id === saved?.activeId) ? saved.activeId : null,
      open: saved?.open === true,
    };
  } catch {
    return { tabs: [], activeId: null, open: false };
  }
}
