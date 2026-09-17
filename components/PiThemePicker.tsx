"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { loadThemeSets, usePiTheme } from "@/hooks/usePiTheme";
import type { ThemeSetInfo } from "@/lib/pi-theme";

/**
 * pi CLI theme picker.
 *
 * Rendered **inside** the appearance section, right under the six Codex
 * palette buttons, because the two are one decision ("what does this app look
 * like") split by source. Giving them separate sections made the settings page
 * read as two competing theme pickers.
 *
 * Selecting a palette clears the pi overlay (handled by the palette buttons
 * themselves); selecting a pi theme layers its colours on top. User themes are
 * labelled "From disk" and sorted first, mirroring the precedence
 * `listThemeSets()` applies on the server.
 */
export function PiThemePicker({ cwd }: { cwd: string | null }) {
  const { t } = useI18n();
  const { piThemeName, setPiTheme } = usePiTheme();
  const [sets, setSets] = useState<ThemeSetInfo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadThemeSets(cwd).then((loaded) => {
      if (!cancelled) setSets(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const ordered = useMemo(() => {
    if (!sets) return [];
    // Local themes first (they override a bundled theme of the same name).
    return [...sets].sort(
      (a, b) => Number(a.builtin) - Number(b.builtin) || a.displayName.localeCompare(b.displayName),
    );
  }, [sets]);

  return (
    <div className="settings-pi-theme">
      <div className="settings-theme-group-label">
        <span>{t("settings.piTheme")}</span>
        <span className="settings-theme-group-note">{t("settings.piThemeHint")}</span>
      </div>

      <div role="radiogroup" aria-label={t("settings.piTheme")} className="settings-pi-theme-options">
        <button
          type="button"
          role="radio"
          aria-checked={piThemeName === ""}
          className={`settings-pi-theme-option${piThemeName === "" ? " is-active" : ""}`}
          onClick={() => void setPiTheme("")}
        >
          <span className="settings-pi-theme-swatch" aria-hidden="true" />
          <span className="settings-pi-theme-name">{t("settings.piThemeNone")}</span>
        </button>

        {ordered.map((set) => {
          const active = piThemeName === set.name;
          return (
            <button
              key={set.name}
              type="button"
              role="radio"
              aria-checked={active}
              className={`settings-pi-theme-option${active ? " is-active" : ""}`}
              onClick={() => void setPiTheme(set.name, cwd)}
            >
              <span className="settings-pi-theme-swatch" aria-hidden="true" />
              <span className="settings-pi-theme-name">{set.displayName}</span>
              <span className="settings-pi-theme-badge">
                {t(set.builtin ? "settings.piThemeBundled" : "settings.piThemeLocal")}
              </span>
            </button>
          );
        })}
      </div>

      {sets === null && <p className="settings-pi-theme-note">{t("settings.piThemeLoading")}</p>}
      {sets !== null && ordered.length === 0 && (
        <p className="settings-pi-theme-note">{t("settings.piThemeEmpty")}</p>
      )}
    </div>
  );
}
