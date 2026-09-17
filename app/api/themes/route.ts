import { NextRequest, NextResponse } from "next/server";
import { listThemeSets } from "@/lib/pi-theme";
import { BUILTIN_THEMES } from "@/lib/pi-theme-builtin";

/**
 * List the available pi CLI theme sets.
 *
 * Sources: user themes in `~/.pi/agent/themes/`, project themes in
 * `<cwd>/.pi/themes/`, plus the bundled registry. A user theme with the same
 * base name as a bundled one wins (handled inside `listThemeSets`).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cwd = searchParams.get("cwd") || undefined;
    return NextResponse.json({ themeSets: listThemeSets(cwd, BUILTIN_THEMES) });
  } catch (error) {
    console.error("Failed to list pi themes:", error);
    return NextResponse.json({ error: "Failed to list themes" }, { status: 500 });
  }
}
