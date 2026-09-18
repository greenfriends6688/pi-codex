#!/usr/bin/env node
/**
 * Upstream merge-surface audit.
 *
 * Answers one question: **if a new upstream tarball lands tomorrow, how many
 * files can conflict, and which of them have no `fork:` marker to guide the
 * re-apply?**
 *
 * The fork convention (`docs/patches/README.md`, `docs/ui-layout-pr-plan-2026-09-17.md` §5)
 * says every change to an upstream-origin file carries a `// fork:<slug>` marker.
 * A file that differs from upstream but carries no marker is a "leak": there is
 * no map for it, so the merge is guesswork.
 *
 * Usage:
 *   node docs/upstream-merge-audit.mjs                 # audit vs the `upstream` ref
 *   node docs/upstream-merge-audit.mjs --ref=agegr/main
 *   node docs/upstream-merge-audit.mjs --json          # machine-readable
 *   node docs/upstream-merge-audit.mjs --list=leaks    # just the leak paths
 *
 * Exit code is 0 unless --check is passed, in which case a leak count above
 * --max-leaks (default: the recorded baseline) exits 1.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const eq = hit.indexOf("=");
  return eq === -1 ? true : hit.slice(eq + 1);
};

const REF = flag("ref", "upstream");
const MARKER = /fork:[a-z0-9-]+/g;
const BASELINE_FILE = "docs/upstream-merge-baseline.json";

/** Files that legitimately differ from upstream without a marker. */
const REVIEWED_NO_MARKER = new Set([
  "package-lock.json", // dependency resolution, not logic
  "README.md", "README.zh-CN.md", "README.ja.md", "README.ru.md",
  "LICENSE", "CONTRIBUTING.md", "SECURITY.md",
]);

function git(...cmd) {
  return execFileSync("git", cmd, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function tryGit(...cmd) {
  try {
    return git(...cmd);
  } catch {
    return null;
  }
}

function lines(text) {
  return (text ?? "").split("\n").filter(Boolean);
}

function main() {
  // 1. Which upstream-origin files did we change?
  const changed = new Set(lines(tryGit("diff", "--name-only", REF, "HEAD")));
  const upstreamFiles = new Set(lines(tryGit("ls-tree", "-r", "--name-only", REF)));

  if (upstreamFiles.size === 0) {
    console.error(`Cannot read ref "${REF}". Fetch it first, e.g. git fetch agegr`);
    process.exit(2);
  }

  const surface = [...changed].filter((f) => upstreamFiles.has(f)).sort();
  const added = [...changed].filter((f) => !upstreamFiles.has(f)).sort();
  const deleted = lines(tryGit("diff", "--name-only", "--diff-filter=D", REF, "HEAD"))
    .filter((f) => upstreamFiles.has(f));

  // 2. Marker inventory across the whole tree.
  const markers = new Map(); // slug -> Set<file>
  const markedFiles = new Set();
  const leaks = [];
  const reviewed = new Set();

  for (const file of surface) {
    if (!existsSync(file)) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      text = "";
    }
    const found = [...new Set(text.match(MARKER) ?? [])];
    if (found.length > 0) {
      markedFiles.add(file);
      for (const m of found) {
        const slug = m.slice("fork:".length);
        if (!markers.has(slug)) markers.set(slug, new Set());
        markers.get(slug).add(file);
      }
    } else if (REVIEWED_NO_MARKER.has(file)) {
      reviewed.add(file);
    } else {
      leaks.push(file);
    }
  }

  const sections = lines(tryGit("diff", "--numstat", REF, "HEAD"));
  let totalAdd = 0;
  let totalDel = 0;
  for (const row of sections) {
    const [a, d] = row.split("\t");
    if (a !== "-") totalAdd += Number(a) || 0; // "-" = binary
    if (d !== "-") totalDel += Number(d) || 0;
  }

  const base = tryGit("merge-base", "HEAD", REF)?.trim() ?? "(none)";

  const report = {
    ref: REF,
    mergeBase: base.slice(0, 8) || "(none)",
    mergeSurface: surface.length,
    upstreamFiles: upstreamFiles.size,
    forkOnlyFiles: added.length,
    deletedUpstreamFiles: deleted.length,
    churn: { added: totalAdd, deleted: totalDel },
    marked: markedFiles.size,
    leaks: leaks.length,
    reviewedNoMarker: reviewed.size,
    leakRate: surface.length === 0 ? 0 : Number((leaks.length / surface.length).toFixed(3)),
    slugs: [...markers.entries()]
      .map(([slug, files]) => ({ slug, files: files.size }))
      .sort((a, b) => b.files - a.files),
    leakFiles: leaks,
  };

  if (flag("json")) {
    console.log(JSON.stringify(report, null, 2));
    return finish(report);
  }

  if (flag("list") === "leaks") {
    for (const f of leaks) console.log(f);
    return finish(report);
  }

  console.log(`upstream merge-surface audit  (ref: ${REF}, merge-base: ${report.mergeBase})\n`);
  console.log(`  merge surface   ${report.mergeSurface} files   ← 会冲突的候选面`);
  console.log(`    with marker   ${report.marked}`);
  console.log(`    no marker     ${report.leaks}   ← leak（无重打地图）`);
  console.log(`    reviewed ok   ${report.reviewedNoMarker}`);
  if (report.leakFiles.length > 0) {
    console.log(`\n  leak rate       ${(report.leakRate * 100).toFixed(0)}%`);
  }
  console.log(`  fork-only files ${report.forkOnlyFiles}   ← 新文件，不冲突`);
  console.log(`  churn           +${report.churn.added} / -${report.churn.deleted}`);
  console.log(`  marker slugs    ${report.slugs.length}`);

  if (flag("list") === "slugs") {
    console.log("\nmarkers by slug:");
    for (const { slug, files } of report.slugs) {
      console.log(`  ${String(files).padStart(3)}  fork:${slug}`);
    }
  }

  if (report.leakFiles.length > 0 && !flag("quiet")) {
    const shown = flag("all") ? report.leakFiles : report.leakFiles.slice(0, 25);
    console.log(`\nleaks${flag("all") ? "" : ` (first ${shown.length} of ${report.leaks})`}:`);
    for (const f of shown) console.log(`  ${f}`);
    if (!flag("all") && report.leaks > shown.length) {
      console.log(`  … run with --all or --list=leaks for the rest`);
    }
  }

  return finish(report);
}

function finish(report) {
  if (!flag("check")) return;
  const max = Number(flag("max-leaks", Number.NaN));
  let budget = max;
  if (Number.isNaN(budget) && existsSync(BASELINE_FILE)) {
    budget = JSON.parse(readFileSync(BASELINE_FILE, "utf8")).leaks;
  }
  if (Number.isNaN(budget)) {
    console.error(`\n--check needs --max-leaks=N or a ${BASELINE_FILE} baseline`);
    process.exit(2);
  }
  if (report.leaks > budget) {
    console.error(`\nFAIL: ${report.leaks} unmarked upstream files (budget ${budget})`);
    process.exit(1);
  }
  console.log(`\nOK: ${report.leaks} unmarked upstream files (budget ${budget})`);
}

main();
