"use client";

import { Component, type ReactNode } from "react";

interface Props {
  /** Rendered instead of the editor when it cannot be used. */
  fallback: ReactNode;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Keeps a markdown editor that cannot mount from blanking the pane.
 *
 * The WYSIWYG editor is a `next/dynamic` chunk. After a rebuild the chunk URL a
 * stale page holds no longer exists, so the import rejects and React renders
 * nothing — which read as "Preview is blank while Source is fine". The caller
 * passes the read-only preview as the fallback, so a failed editor degrades to
 * something readable instead of an empty rectangle.
 */
export class MarkdownEditorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[pi-web] markdown editor failed to mount; falling back to the static preview:", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
