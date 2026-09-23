/**
 * fork:upstream-0.9.2-edge-instrumentation — Node-only instrumentation entry.
 *
 * `instrumentation.ts` is built for both the Node and the Edge runtime, and the
 * Edge compilation statically rejects Node APIs. An early `return` there only
 * folded away the return itself, so `process.on` (and undici) still landed in
 * the Edge module and warned on every dev start. `instrumentation.ts` now
 * reaches this file through a positive `NEXT_RUNTIME === "nodejs"` branch that
 * the bundler eliminates entirely for Edge.
 */
export async function registerNodeInstrumentation(): Promise<void> {
  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  // 2026-09-06 root-cause fix for the recurring "zombie node, 502" outages:
  // on SIGINT/SIGTERM Next 16 (production) runs server.close() and waits for
  // ALL connections to end before process.exit — with no timeout. Our SSE
  // streams (app/api/agent/[id]/events) only end when the CLIENT disconnects,
  // so a Servy stop left the process draining forever: not listening (502)
  // but never exiting, and every restart leaked one orphan. Closing the
  // streams here lets Next's drain finish and the process exit cleanly.
  // fork:cron — scheduled tasks run in this process (lib/cron-runner.ts).
  const { startCronScheduler } = await import("@/lib/cron-runner");
  startCronScheduler();

  const { closeAllAgentEventStreams } = await import("@/lib/agent-event-stream");
  const shutdownStreams = () => closeAllAgentEventStreams();
  process.on("SIGINT", shutdownStreams);
  process.on("SIGTERM", shutdownStreams);
}
