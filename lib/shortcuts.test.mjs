// fork:zc-04 — kernel edge cases that are invisible in the UI: strict modifier
// matching, IME/repeat noise, layout-independent recording, conflict detection.
import assert from "node:assert/strict";
import test from "node:test";

const {
  SHORTCUT_COMMANDS,
  buildShortcutOverridesAfterSteal,
  checkShortcutBindingConflict,
  formatShortcutBindingLabel,
  getDefaultShortcutBindings,
  isImeEvent,
  isSamePhysicalBinding,
  matchesShortcutBinding,
  parseShortcutBinding,
  parseShortcutOverrides,
  recordShortcutBinding,
  resolveEffectiveShortcutBindings,
  serializeShortcutBinding,
} = await import("./shortcuts.ts");

const MAC = { platform: "MacIntel" };
const WIN = { platform: "Win32" };

function keyEvent(overrides = {}) {
  return {
    key: "k",
    code: "KeyK",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

test("serializes and parses canonical bindings in one stable order", () => {
  assert.equal(serializeShortcutBinding(parseShortcutBinding("Shift+CmdOrCtrl+k")), "CmdOrCtrl+Shift+k");
  assert.equal(serializeShortcutBinding(parseShortcutBinding("CmdOrCtrl+Alt+n")), "CmdOrCtrl+Alt+n");
  // Duplicate and unknown modifiers are rejected.
  assert.equal(parseShortcutBinding("CmdOrCtrl+CmdOrCtrl+k"), null);
  assert.equal(parseShortcutBinding("Meta+k"), null);
  // Uppercase / unknown keys are rejected rather than silently normalized.
  assert.equal(parseShortcutBinding("CmdOrCtrl+K"), null);
  assert.equal(parseShortcutBinding("CmdOrCtrl+Foo"), null);
});

test("matches modifiers strictly: Cmd+K never fires on Cmd+Shift+K", () => {
  assert.equal(matchesShortcutBinding(keyEvent({ metaKey: true }), "CmdOrCtrl+k", MAC), true);
  assert.equal(matchesShortcutBinding(keyEvent({ metaKey: true, shiftKey: true }), "CmdOrCtrl+k", MAC), false);
  // Extra Alt is also an extra modifier.
  assert.equal(matchesShortcutBinding(keyEvent({ metaKey: true, altKey: true }), "CmdOrCtrl+k", MAC), false);
  // On Apple the primary is Meta, not Ctrl; Ctrl+K is a different physical key.
  assert.equal(matchesShortcutBinding(keyEvent({ ctrlKey: true }), "CmdOrCtrl+k", MAC), false);
  // On Windows/Linux the primary is Ctrl, and Meta must be absent.
  assert.equal(matchesShortcutBinding(keyEvent({ ctrlKey: true }), "CmdOrCtrl+k", WIN), true);
  assert.equal(matchesShortcutBinding(keyEvent({ ctrlKey: true, metaKey: true }), "CmdOrCtrl+k", WIN), false);
});

test("the legacy Ctrl+Alt+N chord matches on every platform", () => {
  const chord = keyEvent({ key: "n", code: "KeyN", ctrlKey: true, altKey: true });
  assert.equal(matchesShortcutBinding(chord, "Ctrl+Alt+n", MAC), true);
  assert.equal(matchesShortcutBinding(chord, "Ctrl+Alt+n", WIN), true);
  // It must not fire on Cmd+Alt+N on Apple (that is a different physical chord).
  assert.equal(matchesShortcutBinding(keyEvent({ key: "n", code: "KeyN", metaKey: true, altKey: true }), "Ctrl+Alt+n", MAC), false);
  // Explicit Ctrl behaves as the primary modifier on Windows/Linux as well.
  assert.equal(matchesShortcutBinding(keyEvent({ key: "b", code: "KeyB", ctrlKey: true }), "Ctrl+b", WIN), true);
});

test("a bare named binding does not match its modified variants", () => {
  assert.equal(matchesShortcutBinding(keyEvent({ key: "Escape", code: "Escape" }), "Escape", MAC), true);
  assert.equal(
    matchesShortcutBinding(keyEvent({ key: "Escape", code: "Escape", metaKey: true }), "Escape", MAC),
    false,
  );
  // Uppercase event.key from Shift+letter still matches the lowercase binding.
  assert.equal(matchesShortcutBinding(keyEvent({ key: "K", metaKey: true }), "CmdOrCtrl+k", MAC), true);
});

test("IME composition and long-press repeat are ignored", () => {
  assert.equal(isImeEvent({ key: "Process", isComposing: false }), true);
  assert.equal(isImeEvent({ key: "k", keyCode: 229 }), true);
  assert.equal(matchesShortcutBinding(keyEvent({ keyCode: 229, metaKey: true }), "CmdOrCtrl+k", MAC), false);
  assert.equal(matchesShortcutBinding(keyEvent({ isComposing: true, metaKey: true }), "CmdOrCtrl+k", MAC), false);
  assert.equal(matchesShortcutBinding(keyEvent({ repeat: true, metaKey: true }), "CmdOrCtrl+k", MAC), false);
});

test("records physical keys via event.code regardless of layout", () => {
  const recorded = recordShortcutBinding(
    keyEvent({ key: "&", code: "Digit7", metaKey: true, shiftKey: true }),
    MAC,
  );
  assert.deepEqual(recorded, { kind: "binding", binding: "CmdOrCtrl+Shift+7" });
  // Modifier-only presses keep waiting.
  assert.deepEqual(recordShortcutBinding(keyEvent({ key: "Meta", metaKey: true }), MAC), { kind: "pending" });
  // Long press never records.
  assert.deepEqual(recordShortcutBinding(keyEvent({ repeat: true, metaKey: true }), MAC), { kind: "pending" });
  // Printable keys need a modifier; named keys (F/arrows/Esc) do not.
  assert.deepEqual(recordShortcutBinding(keyEvent({ metaKey: false, ctrlKey: false }), MAC), {
    kind: "invalid",
    reason: "no-modifier",
  });
  assert.deepEqual(recordShortcutBinding(keyEvent({ key: "F6", code: "F6" }), MAC), {
    kind: "binding",
    binding: "F6",
  });
});

test("renders platform labels: ⌘K on Apple, Ctrl+K elsewhere", () => {
  assert.equal(formatShortcutBindingLabel("CmdOrCtrl+k", MAC), "⌘K");
  assert.equal(formatShortcutBindingLabel("CmdOrCtrl+k", WIN), "Ctrl+K");
  assert.equal(formatShortcutBindingLabel("CmdOrCtrl+Alt+n", MAC), "⌥⌘N");
  assert.equal(formatShortcutBindingLabel("CmdOrCtrl+Alt+n", WIN), "Ctrl+Alt+N");
  assert.equal(formatShortcutBindingLabel("CmdOrCtrl+Shift+l", MAC), "⇧⌘L");
  assert.equal(formatShortcutBindingLabel("Escape", MAC), "Esc");
});

test("effective table: override wins, empty means unassigned, garbage falls back", () => {
  const effective = resolveEffectiveShortcutBindings({
    toggleSidebar: ["CmdOrCtrl+Shift+b"],
    toggleTheme: [],
    toggleRightPanel: ["not a binding"],
  });
  assert.deepEqual(effective.toggleSidebar, ["CmdOrCtrl+Shift+b"]);
  assert.deepEqual(effective.toggleTheme, []);
  assert.deepEqual(effective.toggleRightPanel, getDefaultShortcutBindings("toggleRightPanel"));
  assert.deepEqual(effective.stopAgent, ["Escape"]);
});

test("reset to default removes the override", () => {
  const overrides = { toggleSidebar: ["CmdOrCtrl+Shift+b"] };
  const next = { ...overrides };
  delete next.toggleSidebar;
  assert.deepEqual(resolveEffectiveShortcutBindings(next).toggleSidebar, ["CmdOrCtrl+b"]);
});

test("storage parser drops unknown ids and non-string bindings", () => {
  assert.deepEqual(
    parseShortcutOverrides({
      toggleSidebar: ["CmdOrCtrl+b"],
      notACommand: ["CmdOrCtrl+x"],
      stopAgent: ["Escape", 7],
    }),
    { toggleSidebar: ["CmdOrCtrl+b"] },
  );
  assert.deepEqual(parseShortcutOverrides("garbage"), {});
});

test("conflict detection: reserved, occupied, read-only owner, physical equivalence", () => {
  assert.equal(checkShortcutBindingConflict("toggleSidebar", "CmdOrCtrl+r", {}, MAC)?.kind, "reserved");
  // ⌘K（命令面板）已按用户要求删除，改用仍然存在的 ⌘F 作为「被只读行占用」的样例。
  const occupied = checkShortcutBindingConflict("toggleSidebar", "CmdOrCtrl+f", {}, MAC);
  assert.equal(occupied?.kind, "occupied");
  assert.equal(occupied?.ownerCommandId, "findInConversation");
  assert.equal(occupied?.ownerManaged, false);
  // Esc is owned by stopAgent; the same command may keep its own binding.
  assert.equal(checkShortcutBindingConflict("stopAgent", "Escape", {}, MAC), null);
  // On Windows CmdOrCtrl and explicit Ctrl are the same physical press.
  assert.equal(isSamePhysicalBinding("CmdOrCtrl+b", "Ctrl+b", WIN), true);
  assert.equal(isSamePhysicalBinding("CmdOrCtrl+b", "Ctrl+b", MAC), false);
});

test("steal moves the binding between managed commands only", () => {
  const stolen = buildShortcutOverridesAfterSteal(
    { toggleSidebar: ["CmdOrCtrl+b"] },
    "toggleRightPanel",
    "CmdOrCtrl+b",
    MAC,
  );
  assert.deepEqual(stolen.toggleRightPanel, ["CmdOrCtrl+b"]);
  assert.deepEqual(stolen.toggleSidebar, []);
});

test("the table keeps ⌘F as a read-only row", () => {
  // ⌘K（命令面板）已随该功能一并删除；⌘F（会话内查找）仍由它自己的功能注册，
  // 所以在表里是只读行 —— 不可抢绑，也不参与内核分发。
  const find = SHORTCUT_COMMANDS.find((entry) => entry.id === "findInConversation");
  assert.equal(find?.managed, false);
  assert.deepEqual(find?.defaultBindings, ["CmdOrCtrl+f"]);
  assert.equal(SHORTCUT_COMMANDS.some((entry) => entry.id === "openCommandPalette"), false);
});
