import { NextResponse } from "next/server";
import { collectUsageStats, isUsageRange, isValidTimeZone, type UsageRange } from "@/lib/usage-stats";
import { isApiRequestAllowed } from "@/lib/request-security";

/*
 * fork:zc-03 — GET /api/usage-stats?range=7d|30d|all&tz=<IANA zone>
 *
 * Read-only aggregation over `~/.pi/agent/sessions/**`; the fingerprint cache
 * lives in `~/.pi/agent/pi-web-usage-cache.json`. Session files are never
 * written. The client sends its own IANA zone so day buckets match the user's
 * calendar (the server may run in a different zone); an invalid or missing zone
 * falls back to the server's local time.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const url = new URL(req.url);
  const rangeParam = url.searchParams.get("range");
  const range: UsageRange = isUsageRange(rangeParam) ? rangeParam : "30d";
  const tzParam = url.searchParams.get("tz");
  const timeZone = isValidTimeZone(tzParam) ? tzParam : undefined;

  try {
    return NextResponse.json(await collectUsageStats({ range, timeZone }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
