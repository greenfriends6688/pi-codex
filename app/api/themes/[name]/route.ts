import { NextRequest, NextResponse } from "next/server";
import { resolveTheme, type ThemeVariant } from "@/lib/pi-theme";
import { BUILTIN_THEMES } from "@/lib/pi-theme-builtin";

/**
 * Resolve one variant of a pi CLI theme set into Codex CSS custom properties.
 *
 * The returned `cssVars` are applied as inline custom properties on `<html>` by
 * `hooks/usePiTheme.ts`; they are deliberately *not* a full palette — geometry
 * tokens keep coming from the active Codex palette.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;
    const { searchParams } = new URL(request.url);
    const cwd = searchParams.get("cwd") || undefined;
    const mode = (searchParams.get("mode") || "dark") as ThemeVariant;

    const resolved = resolveTheme(
      decodeURIComponent(name),
      mode === "light" ? "light" : "dark",
      cwd,
      BUILTIN_THEMES,
    );

    if (!resolved) {
      return NextResponse.json(
        { error: `Theme "${name}" variant "${mode}" not found` },
        { status: 404 },
      );
    }

    return NextResponse.json(resolved);
  } catch (error) {
    console.error("Failed to resolve pi theme:", error);
    return NextResponse.json({ error: "Failed to resolve theme" }, { status: 500 });
  }
}
