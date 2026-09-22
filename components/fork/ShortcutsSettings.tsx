"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useShortcutBindings } from "@/hooks/useShortcutBindings";
import { ConfigButton } from "../SettingsUi";
import { TEXT } from "@/lib/typography";
import {
  SHORTCUT_COMMANDS,
  SHORTCUT_GROUPS,
  SHORTCUT_GROUP_LABEL_KEYS,
  buildShortcutOverridesAfterSteal,
  checkShortcutBindingConflict,
  formatShortcutBindingLabel,
  formatShortcutBindingLabelParts,
  isSamePhysicalBinding,
  recordShortcutBinding,
  setShortcutRecordingActive,
  type ShortcutCommandDefinition,
  type ShortcutCommandId,
  type ShortcutConflict,
  type ShortcutPlatformInfo,
} from "@/lib/shortcuts";

/*
 * fork:zc-04 — the settings table for the central shortcut kernel.
 *
 * Every row is rendered from `SHORTCUT_COMMANDS`, so adding a command in
 * `lib/shortcuts.ts` makes it appear here, in the conflict checker and in the
 * storage parser at once. The recording flow is the reference project's:
 * Escape cancels, Backspace/Delete restores the default, a chord that another
 * command already uses shows the owner and offers an explicit "use anyway"
 * (read-only commands — the palette and find rows other features still own —
 * cannot be stolen). IME composition and key repeat never record because the
 * kernel filters them before this component sees a binding.
 */

interface RecordingState {
  commandId: ShortcutCommandId;
  /** Binding formatted for display while the chord is being chosen. */
  preview: string | null;
  error: string | null;
  conflict: ShortcutConflict | null;
}

function PlatformKeycaps({ binding, platform }: { binding: string; platform: ShortcutPlatformInfo }): ReactNode {
  const parts = formatShortcutBindingLabelParts(binding, platform);
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      {parts.map((part, index) => (
        <kbd
          key={`${part}-${index}`}
          style={{
            minWidth: 20,
            padding: "1px 6px",
            border: "1px solid var(--border)",
            borderBottomWidth: 2,
            borderRadius: "var(--radius-sm, 6px)",
            background: "var(--bg-panel)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: TEXT.xs,
            lineHeight: "17px",
            textAlign: "center",
          }}
        >
          {part}
        </kbd>
      ))}
    </span>
  );
}

export function ShortcutsSettings(): ReactNode {
  const { t } = useI18n();
  const { overrides, effective, updateBindings, resetBindings } = useShortcutBindings();
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [query, setQuery] = useState("");

  const platform = useMemo<ShortcutPlatformInfo>(() => ({
    platform: typeof navigator !== "undefined" ? navigator.platform : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  }), []);

  const commandLabel = useCallback(
    (id: ShortcutCommandId) => t(SHORTCUT_COMMANDS.find((entry) => entry.id === id)?.labelKey ?? id),
    [t],
  );

  const applyBinding = useCallback(
    (commandId: ShortcutCommandId, binding: string) => {
      updateBindings(buildShortcutOverridesAfterSteal(overrides, commandId, binding, platform));
      setRecording(null);
    },
    [overrides, platform, updateBindings],
  );

  const resetCommand = useCallback(
    (commandId: ShortcutCommandId) => {
      const next = { ...overrides };
      delete next[commandId];
      updateBindings(next);
    },
    [overrides, updateBindings],
  );

  // Recording owns the keyboard: the global dispatcher short-circuits while the
  // flag is set, otherwise the chord being recorded would first fire whatever
  // the command is currently bound to.
  useEffect(() => {
    if (!recording) return;
    setShortcutRecordingActive(true);

    const handler = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecording(null);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        resetCommand(recording.commandId);
        setRecording(null);
        return;
      }
      if (event.repeat) return;

      const result = recordShortcutBinding(event, platform);
      if (result.kind === "pending") {
        // A bare modifier means the user is still building the chord; clear any
        // stale error so the input visibly keeps listening.
        if (recording.error !== null || recording.preview !== null || recording.conflict !== null) {
          setRecording({ ...recording, preview: null, error: null, conflict: null });
        }
        return;
      }
      if (result.kind === "invalid") {
        setRecording({
          ...recording,
          preview: null,
          conflict: null,
          error: t(result.reason === "no-modifier" ? "settings.shortcuts.invalidNoModifier" : "settings.shortcuts.invalidKey"),
        });
        return;
      }

      // Same command, same physical chord: nothing to gain, reject loudly.
      const ownBindings = effective[recording.commandId] ?? [];
      if (ownBindings.some((binding) => isSamePhysicalBinding(binding, result.binding, platform))) {
        setRecording({
          ...recording,
          preview: formatShortcutBindingLabel(result.binding, platform),
          conflict: null,
          error: t("settings.shortcuts.duplicateBinding"),
        });
        return;
      }

      const conflict = checkShortcutBindingConflict(recording.commandId, result.binding, overrides, platform);
      if (conflict) {
        const owner = conflict.kind === "occupied" ? commandLabel(conflict.ownerCommandId) : "";
        setRecording({
          ...recording,
          preview: formatShortcutBindingLabel(result.binding, platform),
          conflict,
          error: conflict.kind === "reserved"
            ? t("settings.shortcuts.conflictReserved")
            : conflict.kind === "occupied" && !conflict.ownerManaged
              ? t("settings.shortcuts.conflictReadonly", { command: owner })
              : t("settings.shortcuts.conflictOccupied", { command: owner }),
        });
        return;
      }

      applyBinding(recording.commandId, result.binding);
    };

    window.addEventListener("keydown", handler, true);
    return () => {
      window.removeEventListener("keydown", handler, true);
      setShortcutRecordingActive(false);
    };
  }, [applyBinding, commandLabel, effective, overrides, platform, recording, resetCommand, t]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleCommands = normalizedQuery
    ? SHORTCUT_COMMANDS.filter((entry) =>
        t(entry.labelKey).toLowerCase().includes(normalizedQuery)
        || entry.id.toLowerCase().includes(normalizedQuery)
        || (effective[entry.id] ?? []).some((binding) => binding.toLowerCase().includes(normalizedQuery)))
    : SHORTCUT_COMMANDS;

  return (
    <div className="settings-general">
      <h2 className="settings-general-title">{t("settings.shortcuts.title")}</h2>
      <p className="settings-chat-range-hint" style={{ marginTop: -6 }}>{t("settings.shortcuts.description")}</p>

      <section className="settings-general-section">
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings.shortcuts.searchPlaceholder")}
            aria-label={t("settings.shortcuts.searchPlaceholder")}
            maxLength={60}
            className="settings-search-input"
            style={{ flex: 1, minWidth: 0 }}
          />
          <ConfigButton
            variant="ghost"
            size="small"
            disabled={Object.keys(overrides).length === 0}
            onClick={() => resetBindings()}
          >
            {t("settings.shortcuts.resetAll")}
          </ConfigButton>
        </div>

        {SHORTCUT_GROUPS.map((group) => {
          const commands = visibleCommands.filter((entry) => entry.group === group);
          if (commands.length === 0) return null;
          return (
            <div key={group} style={{ marginTop: 14 }}>
              <h3 className="settings-general-heading">{t(SHORTCUT_GROUP_LABEL_KEYS[group])}</h3>
              <div style={{ display: "grid", gap: 4 }}>
                {commands.map((entry) => (
                  <ShortcutRow
                    key={entry.id}
                    entry={entry}
                    label={t(entry.labelKey)}
                    bindings={effective[entry.id] ?? []}
                    isOverridden={overrides[entry.id] !== undefined}
                    isRecording={recording?.commandId === entry.id}
                    recording={recording?.commandId === entry.id ? recording : null}
                    platform={platform}
                    onStartRecording={() => setRecording({ commandId: entry.id, preview: null, error: null, conflict: null })}
                    onReset={() => resetCommand(entry.id)}
                    onSteal={(binding) => applyBinding(entry.id, binding)}
                    onCancel={() => setRecording(null)}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {visibleCommands.length === 0 && (
          <p role="status" className="settings-chat-range-hint" style={{ marginTop: 12 }}>
            {t("settings.shortcuts.searchEmpty")}
          </p>
        )}
      </section>
    </div>
  );
}

function ShortcutRow({
  entry,
  label,
  bindings,
  isOverridden,
  isRecording,
  recording,
  platform,
  onStartRecording,
  onReset,
  onSteal,
  onCancel,
}: {
  entry: ShortcutCommandDefinition;
  label: string;
  bindings: readonly string[];
  isOverridden: boolean;
  isRecording: boolean;
  recording: RecordingState | null;
  platform: ShortcutPlatformInfo;
  onStartRecording: () => void;
  onReset: () => void;
  onSteal: (binding: string) => void;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const borderColor = isRecording ? "var(--accent)" : "var(--border-faint)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "7px 9px",
        border: `1px solid ${borderColor}`,
        borderRadius: "var(--radius-md)",
        background: isRecording ? "var(--bg-selected)" : "var(--bg-panel)",
      }}
    >
      <span style={{ flex: 1, minWidth: 160, fontSize: TEXT.sm, color: "var(--text)" }}>
        {label}
        {entry.managed === false && (
          <span style={{ display: "block", fontSize: TEXT.xs, color: "var(--text-dim)", marginTop: 1 }}>
            {t("settings.shortcuts.notConfigurable")}
          </span>
        )}
      </span>

      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {bindings.length === 0 ? (
          <span style={{ fontSize: TEXT.xs, color: "var(--text-dim)" }}>{t("settings.shortcuts.unassigned")}</span>
        ) : (
          bindings.map((binding) => <PlatformKeycaps key={binding} binding={binding} platform={platform} />)
        )}
      </span>

      {isRecording ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: TEXT.xs, color: "var(--text-dim)" }}>
            {recording?.preview ?? t("settings.shortcuts.pressKeys")}
          </span>
          {recording?.conflict?.kind === "occupied" && recording.conflict.ownerManaged && (
            <ConfigButton
              variant="primary"
              size="small"
              onClick={() => onSteal(recording.conflict!.binding)}
            >
              {t("settings.shortcuts.steal")}
            </ConfigButton>
          )}
          <ConfigButton variant="ghost" size="small" onClick={onCancel}>
            {t("i18n.cancel")}
          </ConfigButton>
        </span>
      ) : entry.managed ? (
        <span style={{ display: "inline-flex", gap: 6 }}>
          <ConfigButton variant="secondary" size="small" onClick={onStartRecording}>
            {t("settings.shortcuts.record")}
          </ConfigButton>
          <ConfigButton
            variant="ghost"
            size="small"
            disabled={!isOverridden}
            onClick={onReset}
            title={t("settings.shortcuts.reset")}
          >
            {t("settings.shortcuts.reset")}
          </ConfigButton>
        </span>
      ) : null}

      {isRecording && recording?.error && (
        <span role="alert" style={{ flexBasis: "100%", fontSize: TEXT.xs, color: "var(--text)" }}>
          {recording.error}
        </span>
      )}
    </div>
  );
}
