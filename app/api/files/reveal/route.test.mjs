import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");

function request(body, headers = {}) {
  return new NextRequest("http://localhost/api/files/reveal", {
    method: "POST",
    headers: {
      Host: "localhost",
      Origin: "http://localhost",
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/*
 * This route runs a program on the host, so the boundary is the point of the test:
 * everything the user did not open as a browsable root must be refused before a
 * command is constructed, and the action must be one of the two known verbs.
 */
test("rejects an unknown action", async () => {
  const res = await POST(request({ path: "/tmp/x", action: "delete" }));
  assert.equal(res.status, 400);
});

test("rejects a missing path", async () => {
  const res = await POST(request({ path: "   ", action: "reveal" }));
  assert.equal(res.status, 400);
});

test("rejects a path outside the allowed roots", async () => {
  const res = await POST(request({ path: "/etc/hosts", action: "open" }));
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /allowed roots/);
});

test("rejects a cross-origin request before anything else", async () => {
  const res = await POST(request({ path: "/tmp/x", action: "open" }, { Origin: "http://evil.example", "Sec-Fetch-Site": "cross-site" }));
  assert.equal(res.status, 403);
});

test("requires a JSON content type", async () => {
  const res = await POST(new NextRequest("http://localhost/api/files/reveal", {
    method: "POST",
    headers: { Host: "localhost", Origin: "http://localhost", "Sec-Fetch-Site": "same-origin", "Content-Type": "text/plain" },
    body: "{}",
  }));
  assert.equal(res.status, 415);
});
