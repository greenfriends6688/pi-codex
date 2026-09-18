/**
 * fork:ui-12 — which tabs stay in the bar and which fold into the "…" menu.
 *
 * Pure so the layout rules are testable without a DOM: the TabBar measures real tab
 * widths and asks this function what to show. Two rules matter beyond "whatever
 * fits":
 *
 *   1. the **active** tab is always visible — an active tab hidden behind "…" is
 *      indistinguishable from a broken panel;
 *   2. the divider ("…") itself takes width, so the budget shrinks as soon as one
 *      tab is folded away. That is handled by reserving `moreWidth` up front when a
 *      fold is needed at all.
 */

export interface TabOverflowInput {
  /** Measured widths, same order as the tabs. Unknown widths fall back to `fallbackWidth`. */
  widths: number[];
  containerWidth: number;
  moreWidth: number;
  activeIndex: number;
  fallbackWidth?: number;
  /** Gap between tabs, if any. */
  gap?: number;
}

export interface TabOverflowResult {
  visible: number[];
  hidden: number[];
}

export function splitVisibleTabs({
  widths,
  containerWidth,
  moreWidth,
  activeIndex,
  fallbackWidth = 120,
  gap = 2,
}: TabOverflowInput): TabOverflowResult {
  const total = widths.length;
  const all = Array.from({ length: total }, (_, index) => index);
  if (total === 0) return { visible: [], hidden: [] };

  const widthOf = (index: number) => (widths[index] && widths[index] > 0 ? widths[index] : fallbackWidth);
  const totalWidth = (indexes: number[]) => indexes.reduce((sum, index) => sum + widthOf(index), 0) + gap * Math.max(0, indexes.length - 1);

  if (totalWidth(all) <= containerWidth) return { visible: all, hidden: [] };

  const visible: number[] = [];
  let used = 0;
  for (const index of all) {
    const next = used + widthOf(index) + (visible.length > 0 ? gap : 0);
    // The "…" button needs room as soon as something is folded away.
    if (next + moreWidth > containerWidth) break;
    visible.push(index);
    used = next;
  }
  if (visible.length === 0) visible.push(0);

  // Rule 1: the active tab is never hidden.
  if (activeIndex >= 0 && !visible.includes(activeIndex)) {
    visible[visible.length - 1] = activeIndex;
  }

  const visibleSet = new Set(visible);
  return {
    visible: visible.sort((a, b) => a - b),
    hidden: all.filter((index) => !visibleSet.has(index)),
  };
}
