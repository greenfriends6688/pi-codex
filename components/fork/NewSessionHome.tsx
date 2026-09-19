"use client";

import { useI18n } from "@/hooks/useI18n";
import { TEXT } from "@/lib/typography";

/*
 * fork:ui-newhome — empty-state hero for a brand new session.
 *
 * Structure follows upstream pi-web 0.14.6 (`new-session-home` in
 * components/ChatWindow.tsx:699-760): centred hero, one row of starter cards,
 * composer below. The starters are plain prompts instead of upstream's
 * `/skill:<name>` inserts, because this fork ships no fixed skill set — a
 * hard-coded skill the user does not have would fill the composer with a
 * command that fails.
 */

function cwdBasename(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  const name = cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  return name || cwd;
}

const STARTERS = [
  { key: "chat.homeExplore", prompt: "chat.homeExplorePrompt", icon: "compass" },
  { key: "chat.homeReview", prompt: "chat.homeReviewPrompt", icon: "review" },
  { key: "chat.homeTest", prompt: "chat.homeTestPrompt", icon: "flask" },
  { key: "chat.homeExplain", prompt: "chat.homeExplainPrompt", icon: "book" },
] as const;

function StarterIcon({ name }: { name: string }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "compass") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <polygon points="15.5 8.5 13.6 13.6 8.5 15.5 10.4 10.4" />
      </svg>
    );
  }
  if (name === "review") {
    return (
      <svg {...common}>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    );
  }
  if (name === "flask") {
    return (
      <svg {...common}>
        <path d="M9 3h6M10 3v6.5L5.2 18A2 2 0 0 0 7 21h10a2 2 0 0 0 1.8-3L14 9.5V3" />
        <path d="M7.5 15h9" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5Z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5" />
    </svg>
  );
}

export function NewSessionHome({
  cwd,
  isMobile,
  onInsertPrompt,
}: {
  cwd: string | null | undefined;
  isMobile: boolean;
  onInsertPrompt: (text: string) => void;
}) {
  const { t } = useI18n();
  const label = cwdBasename(cwd);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 py-8">
        <div className="my-auto w-full text-center" style={{ maxWidth: 720 }}>
          <div
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 40,
              height: 40,
              marginBottom: 14,
              borderRadius: "var(--radius-md)",
              background: "var(--bg-panel)",
              border: "1px solid var(--border-faint)",
              color: "var(--text-muted)",
              fontSize: TEXT["2xl"],
              fontWeight: 600,
              fontFamily: "var(--font-mono)",
            }}
          >
            π
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: "var(--text-2xl)",
              fontWeight: 500,
              letterSpacing: "-0.02em",
              color: "var(--text)",
              lineHeight: "var(--leading-title)",
            }}
          >
            {label ? t("chat.homeTitle", { cwd: label }) : t("chat.homeTitleGeneric")}
          </h1>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))",
              gap: 10,
              marginTop: 20,
              textAlign: "left",
            }}
          >
            {STARTERS.map(({ key, prompt, icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => onInsertPrompt(t(prompt))}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 10,
                  minHeight: 92,
                  padding: "12px 14px",
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border-faint)",
                  borderRadius: "var(--radius-lg)",
                  color: "var(--text)",
                  cursor: "pointer",
                  fontSize: "var(--text-ui)",
                  lineHeight: "var(--leading-ui)",
                  textAlign: "left",
                  transition: "background 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.background = "var(--bg-hover)";
                  event.currentTarget.style.borderColor = "var(--border)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background = "var(--bg-panel)";
                  event.currentTarget.style.borderColor = "var(--border-faint)";
                }}
              >
                <span style={{ color: "var(--text-muted)", display: "flex" }}>
                  <StarterIcon name={icon} />
                </span>
                <span>{t(key)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
