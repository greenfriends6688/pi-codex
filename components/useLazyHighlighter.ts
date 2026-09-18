"use client";

/**
 * fork:perf-highlighter — one place that knows how to pull Prism at runtime.
 *
 * react-syntax-highlighter (Prism build, every language) is ~1.5MB and upstream imported
 * it statically in two hot paths: the markdown code block and the file viewer's source
 * view. That put it in the initial route bundle, so every page load and every file open
 * paid for highlighting most views never use.
 *
 * Both callers render plain text until `useHighlighterReady()` flips, which means the
 * first paint never waits for the chunk; the highlighted version is an upgrade, not a
 * prerequisite. The import promise is module-level so N code blocks trigger one request.
 */

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

export const LazyCodeHighlighter = dynamic(() => import("./AsyncCodeHighlighter"), { ssr: false });
export const LazyFileSourceView = dynamic(
  () => import("./AsyncCodeHighlighter").then((mod) => mod.AsyncFileSourceView),
  { ssr: false },
);

let highlighterPromise: Promise<void> | null = null;
const highlighterListeners = new Set<() => void>();
let highlighterLoaded = false;

function loadHighlighter(): Promise<void> {
  highlighterPromise ??= import("./AsyncCodeHighlighter").then(() => {
    highlighterLoaded = true;
    for (const listener of highlighterListeners) listener();
  }).catch(() => {
    // Highlighting is decoration: a failed chunk must not break the view.
  });
  return highlighterPromise;
}

export function useHighlighterReady(): boolean {
  const [ready, setReady] = useState(highlighterLoaded);
  useEffect(() => {
    if (highlighterLoaded) return;
    const listener = () => setReady(true);
    highlighterListeners.add(listener);
    void loadHighlighter();
    return () => { highlighterListeners.delete(listener); };
  }, []);
  return ready;
}
