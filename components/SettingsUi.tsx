"use client";

import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";
import { useDialogA11y } from "@/hooks/useDialogA11y";

type ConfigButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ConfigButtonSize = "small" | "default";

interface ConfigPanelShellProps {
  embedded: boolean;
  title: string;
  subtitle?: string;
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  height?: string;
}

export function ConfigPanelShell({
  embedded,
  title,
  subtitle,
  closeLabel = "Close",
  onClose,
  children,
  width = 900,
  height = "78vh",
}: ConfigPanelShellProps) {
  const panelStyle = embedded
    ? undefined
    : ({
        "--config-panel-width": `${width}px`,
        "--config-panel-height": height,
      } as CSSProperties);

  // fork:dsn-dialog-a11y — 只有 modal 形态需要焦点约束；embedded 是页面内面板。
  // 补齐：打开移焦进弹层、Tab 在弹层内循环、Esc 关闭、兄弟节点 inert、关闭还原焦点。
  // 原先只有 role/aria-modal 两个属性，键盘用户 Tab 会走到弹层背后的侧栏。
  const { dialogRef, dialogProps } = useDialogA11y({ open: !embedded, onClose });

  return (
    <div
      ref={embedded ? undefined : dialogRef}
      role={embedded ? undefined : dialogProps.role}
      aria-modal={embedded ? undefined : dialogProps["aria-modal"]}
      aria-label={title}
      className={`config-panel-root ${embedded ? "is-embedded" : "is-modal"}`}
      onClick={(event) => {
        if (!embedded && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="config-panel-surface" style={panelStyle}>
        {!embedded && (
          <div className="config-panel-header">
            <strong className="config-panel-title">{title}</strong>
            {subtitle && (
              <code className="config-panel-subtitle" title={subtitle}>
                {subtitle}
              </code>
            )}
            <button
              type="button"
              className="config-close-button"
              onClick={onClose}
              title={closeLabel}
              aria-label={closeLabel}
            >
              ×
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function ConfigSplitView({ children }: { children: ReactNode }) {
  return <div className="config-split-view">{children}</div>;
}

export function ConfigSidebar({ children }: { children: ReactNode }) {
  return <aside className="config-sidebar">{children}</aside>;
}

export function ConfigSidebarList({ children }: { children: ReactNode }) {
  return <div className="config-sidebar-list">{children}</div>;
}

export function ConfigSidebarGroupLabel({ children }: { children: ReactNode }) {
  return <div className="config-sidebar-group-label">{children}</div>;
}

export function ConfigSidebarItem({
  active = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      aria-current={active ? "page" : undefined}
      className={["config-sidebar-item", className].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}

export function ConfigSidebarText({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      className={["config-sidebar-text", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailStack({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["config-detail-stack", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["config-detail-header", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailHeaderInfo({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["config-detail-header-info", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["config-detail-actions", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailTitle({ children }: { children: ReactNode }) {
  return <div className="config-detail-title">{children}</div>;
}

export function ConfigSectionTitle({ children }: { children: ReactNode }) {
  return <div className="config-section-title">{children}</div>;
}

export function ConfigField({ label, children, style }: { label: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="config-field" style={style}>
      <span className="config-field-label">{label}</span>
      {children}
    </div>
  );
}

export function ConfigEmptyState({ children }: { children: ReactNode }) {
  return <div className="config-empty-state">{children}</div>;
}

export function ConfigDetail({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="config-detail" style={style}>
      {children}
    </div>
  );
}

export function ConfigFooter({ status, children }: { status?: ReactNode; children?: ReactNode }) {
  return (
    <footer className="config-footer">
      <div className="config-footer-status">{status}</div>
      <div className="config-footer-actions">{children}</div>
    </footer>
  );
}

export function ConfigButton({
  variant = "secondary",
  size = "default",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ConfigButtonVariant; size?: ConfigButtonSize }) {
  return (
    <button
      type="button"
      {...props}
      className={[
        "config-button",
        `config-button-${variant}`,
        `config-button-${size}`,
        className,
      ].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}

export function ConfigSwitch({ checked, disabled = false, loading = false, label, onChange }: { checked: boolean; disabled?: boolean; loading?: boolean; label: string; onChange: (checked: boolean) => void }) {
  const inactive = disabled || loading;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={loading || undefined}
      aria-label={label}
      title={label}
      disabled={inactive}
      className={`config-switch${loading ? " is-loading" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="config-switch-knob" aria-hidden="true" />
    </button>
  );
}

export function ConfigListAction({ active = false, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <div className="config-list-action">
      <button
        type="button"
        {...props}
        aria-current={active ? "page" : undefined}
        className={["config-list-action-button", className].filter(Boolean).join(" ")}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {children}
      </button>
    </div>
  );
}

export function ConfigStatusDot({ active, color }: { active?: boolean; color?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`config-status-dot${active ? " is-active" : active === false ? " is-inactive" : ""}`}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

/* ---------------------------------------------------------------------------
 * fork:zn-15 — Zeno 的设置分组卡与设置行。
 *
 * 规格搬到了 `app/fork-ui.css` 的 `.fork-settings-*`；这里只做结构。
 * 与既有的 `ConfigField` 并列而不是替换它：`ConfigField` 是「标签在左、控件在右」
 * 的紧凑表格行，Zeno 的 `SettingsRow` 是「标题 + 说明在上、控件在右上」的卡片行，
 * 两者在 Zeno 里也是并存的（`.settings-row` vs `.settings-field`）。
 * ------------------------------------------------------------------------- */

export function SettingsBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="fork-settings-block">
      <h3 className="fork-settings-block-label">{label}</h3>
      <div className="fork-settings-card">{children}</div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  control,
  last = false,
}: {
  title: string;
  /** 省略即「紧凑行」：`is-compact` 让行竖直居中、上下内距收窄。 */
  description?: ReactNode;
  control: ReactNode;
  last?: boolean;
}) {
  const hasDescription =
    description != null && description !== false && description !== "";
  return (
    <div
      className={[
        "fork-settings-row",
        hasDescription ? "" : "is-compact",
        last ? "is-last" : "",
      ].filter(Boolean).join(" ")}
    >
      <div className="fork-settings-row-copy">
        <div className="fork-settings-row-title">{title}</div>
        {hasDescription ? <div className="fork-settings-row-desc">{description}</div> : null}
      </div>
      <div
        className={[
          "fork-settings-row-control",
          hasDescription ? "is-multiline" : "",
        ].filter(Boolean).join(" ")}
      >
        {control}
      </div>
    </div>
  );
}

export function SettingsSlider({
  label,
  ariaLabel,
  value,
  displayValue,
  min,
  max,
  step = 1,
  disabled = false,
  onChange,
}: {
  /** 省略即「内联形态」：轨道与数值同一行，标签由外层 `SettingsRow` 给。
   *  Zeno 两形态都有 —— 设置行里的宽度滑块是一行（`SettingsPage.tsx:2459`），
   *  主题工作室里的调参是「标签+数值」在上、轨道在下（`.theme-skin-slider`）。 */
  label?: string;
  ariaLabel?: string;
  value: number;
  /** 右侧显示的文本（如 `244px`、`30%`）—— Zeno 把单位和数值一起显示。 */
  displayValue: string;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  const id = `fork-slider-${(label ?? ariaLabel ?? "range").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`;
  const range = (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={label ? undefined : ariaLabel}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );

  if (!label) {
    return (
      <div className="fork-settings-slider is-inline">
        {range}
        <output htmlFor={id}>{displayValue}</output>
      </div>
    );
  }

  return (
    <div className="fork-settings-slider">
      <div className="fork-settings-slider-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{displayValue}</output>
      </div>
      {range}
    </div>
  );
}

export function SettingsSelect({
  value,
  options,
  ariaLabel,
  disabled = false,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  ariaLabel: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <select
      className="fork-settings-select"
      value={value}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
