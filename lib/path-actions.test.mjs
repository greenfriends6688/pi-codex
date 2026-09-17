import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { isPathAction, pathActionCommand } = await jiti.import("@/lib/path-actions");

/*
 * The route spawns these, so the contract that matters is: argv arrays (never a
 * shell string), one argument per path, and reveal ≠ open per platform.
 */
test("a hostile path stays one argv entry and never adds arguments", () => {
  const nasty = "/tmp/a b; rm -rf ~/x";
  const expectedArgs = {
    darwin: { reveal: 2, open: 1 },
    win32: { reveal: 1, open: 4 },
    linux: { reveal: 1, open: 1 },
  };
  for (const platform of ["darwin", "win32", "linux"]) {
    for (const action of ["reveal", "open"]) {
      const { command, args } = pathActionCommand(action, nasty, { platform });
      assert.ok(!command.includes(" "), `${platform}/${action}: command must be a bare program`);
      assert.equal(args.length, expectedArgs[platform][action], `${platform}/${action}: argument count changed`);
      // The path (or, for Linux reveal, its containing directory) must be one
      // argument — a split path would have shown up as a higher arg count above.
      const last = args[args.length - 1];
      const carried = platform === "linux" && action === "reveal"
        ? nasty.slice(0, nasty.lastIndexOf("/"))
        : nasty;
      assert.ok(last === carried || last.endsWith(carried), `${platform}/${action}: expected ${carried}, got ${last}`);
    }
  }
});

test("macOS mirrors the Finder contract", () => {
  assert.deepEqual(pathActionCommand("reveal", "/p/a.txt", { platform: "darwin" }), { command: "open", args: ["-R", "/p/a.txt"] });
  assert.deepEqual(pathActionCommand("open", "/p/a.txt", { platform: "darwin" }), { command: "open", args: ["/p/a.txt"] });
});

test("Windows selects the file in Explorer and uses start for opening", () => {
  const reveal = pathActionCommand("reveal", "C:\\p\\a.txt", { platform: "win32" });
  assert.equal(reveal.command, "explorer");
  assert.deepEqual(reveal.args, ["/select,C:\\p\\a.txt"]);

  const open = pathActionCommand("open", "C:\\p\\a.txt", { platform: "win32" });
  assert.equal(open.command, "cmd");
  // The empty title argument is what keeps a quoted path from being eaten by start.
  assert.deepEqual(open.args, ["/c", "start", "", "C:\\p\\a.txt"]);
});

test("Linux reveals through the containing directory", () => {
  assert.deepEqual(
    pathActionCommand("reveal", "/home/me/proj/src/file.ts", { platform: "linux" }),
    { command: "xdg-open", args: ["/home/me/proj/src"] },
  );
  assert.deepEqual(
    pathActionCommand("open", "/home/me/proj/src/file.ts", { platform: "linux" }),
    { command: "xdg-open", args: ["/home/me/proj/src/file.ts"] },
  );
});

test("revealing a folder opens the folder, not its parent", () => {
  assert.deepEqual(
    pathActionCommand("reveal", "/home/me/proj", { platform: "linux", isDirectory: true }).args,
    ["/home/me/proj"],
  );
  assert.deepEqual(
    pathActionCommand("reveal", "/home/me/proj", { platform: "linux", isDirectory: false }).args,
    ["/home/me"],
  );
  // macOS and Windows select the target either way, so the flag is not needed there.
  assert.deepEqual(pathActionCommand("reveal", "/home/me/proj", { platform: "darwin" }).args, ["-R", "/home/me/proj"]);
});

test("only the two known actions are accepted", () => {
  assert.equal(isPathAction("reveal"), true);
  assert.equal(isPathAction("open"), true);
  assert.equal(isPathAction("delete"), false);
  assert.equal(isPathAction(undefined), false);
});
