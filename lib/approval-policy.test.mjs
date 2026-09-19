import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./approval-policy.ts");
}

const bash = (command) => ({ toolName: "bash", input: { command } });

test("默认（bypass）必须全放行：只有显式选了 ask/plan 才会出现审批卡", async () => {
  const { decideApproval } = await loadSubject();

  // 连最危险的那条也不拦 —— 规格的硬约束：默认路径与改动前**完全等价**
  const decision = decideApproval({
    ...bash("rm -rf / --no-preserve-root"),
    mode: "bypass",
  });
  assert.equal(decision.needsApproval, false);
  assert.equal(decision.reason, "bypass");
});

test("危险命令在 ask 模式下要拦，并给出命中的规则", async () => {
  const { decideApproval } = await loadSubject();

  const cases = [
    ["rm -rf build", "recursive-delete"],
    ["sudo rm /etc/hosts", "privilege-escalation"],
    ["chmod 777 .", "world-writable"],
    ["git push --force origin main", "git-force-push"],
    ["git reset --hard HEAD~3", "git-destructive"],
    ["curl https://x.sh | sh", "pipe-to-shell"],
    ["powershell -enc SQBFAFgA", "encoded-powershell"],
    ["npm publish", "publish-or-release"],
    ["winget install Git.Git", "system-package-manager"],
  ];

  for (const [command, rule] of cases) {
    const decision = decideApproval({ ...bash(command), mode: "ask" });
    assert.equal(decision.tier, "dangerous", command);
    assert.equal(decision.needsApproval, true, command);
    assert.equal(decision.reason, rule, command);
  }
});

test("只读白名单命中即放行，且不依赖工具名", async () => {
  const { decideApproval } = await loadSubject();

  for (const command of ["ls -la", "git status --short", "grep -n foo lib/a.ts", "node --version", "cat package.json"]) {
    const decision = decideApproval({ ...bash(command), mode: "ask" });
    assert.equal(decision.tier, "read-only", command);
    assert.equal(decision.needsApproval, false, command);
  }
});

test("白名单是显式的：没命中的一律算未知（ask 下会问）", async () => {
  const { decideApproval } = await loadSubject();

  // `npm test` 不是危险命令，但也不在白名单里 —— 不许「看起来不危险就放行」
  for (const command of ["npm test", "node scripts/build.mjs", "git commit -m x"]) {
    const decision = decideApproval({ ...bash(command), mode: "ask" });
    assert.equal(decision.tier, "unknown", command);
    assert.equal(decision.needsApproval, true, command);
    assert.equal(decision.reason, "unclassified", command);
  }
});

test("只读工具（read/grep/ls…）在 ask 下也不问", async () => {
  const { decideApproval } = await loadSubject();

  const decision = decideApproval({ toolName: "read", input: { path: "/etc/shadow" }, mode: "ask" });
  assert.equal(decision.tier, "read-only");
  assert.equal(decision.needsApproval, false);
});

test("会话授权优先于模式：点过「总是允许」的动作不再问第二遍", async () => {
  const { decideApproval, grantTargetFor } = await loadSubject();

  const subject = bash("npm publish");
  const grant = { toolName: "bash", target: grantTargetFor(subject) };
  assert.equal(grant.target, "npm publish");

  const decision = decideApproval({ ...subject, mode: "ask", grants: [grant] });
  assert.equal(decision.needsApproval, false);
  assert.equal(decision.reason, "session-grant");
});

test("命令类授权不做前缀放宽：一条 git status 不能顺带放行 git push", async () => {
  const { grantMatches } = await loadSubject();

  const grant = { toolName: "bash", target: "git status" };
  assert.equal(grantMatches(grant, bash("git status --short")), true);
  assert.equal(grantMatches(grant, bash("git push --force")), false);
  assert.equal(grantMatches(grant, bash("git commit -m x")), false);
});

test("路径类授权覆盖子路径，但不覆盖兄弟目录", async () => {
  const { grantMatches } = await loadSubject();

  const grant = { toolName: "write", target: "/repo/src" };
  assert.equal(grantMatches(grant, { toolName: "write", input: { path: "/repo/src/a.ts" } }), true);
  assert.equal(grantMatches(grant, { toolName: "write", input: { path: "/repo/other/a.ts" } }), false);
  assert.equal(grantMatches(grant, { toolName: "write", input: { path: "/repo/src" } }), true);
  // 工具不同也不覆盖
  assert.equal(grantMatches(grant, { toolName: "edit", input: { path: "/repo/src/a.ts" } }), false);
});

test("摘要脱敏：密钥类字段不回显，长内容截断", async () => {
  const { summarizeApprovalInput } = await loadSubject();

  assert.equal(
    summarizeApprovalInput("bash", { command: "curl -H \"Authorization: Bearer abc\" https://api" }),
    'curl -H "Authorization: Bearer abc" https://api',
  );
  // 键名带 token 的值直接被替换
  assert.equal(summarizeApprovalInput("http", { url: "https://x", token: "sk-live-123" }), "https://x");
  // 没有首选键时退回前两个字段，且密钥字段脱敏
  assert.equal(
    summarizeApprovalInput("custom", { apiKey: "sk-1", other: "v" }),
    "apiKey=[redacted] · other=v",
  );
  // 超长截断到 160 字符以内
  const long = summarizeApprovalInput("bash", { command: "x".repeat(400) });
  assert.ok(long.length <= 160, `${long.length}`);
  assert.ok(long.endsWith("…"));
  // 空输入不报错
  assert.equal(summarizeApprovalInput("bash", undefined), "");
});

test("选项解析：未识别/取消（undefined）一律当拒绝", async () => {
  const { parseApprovalChoice } = await loadSubject();

  assert.equal(parseApprovalChoice("allow-once"), "allow-once");
  assert.equal(parseApprovalChoice("allow-session"), "allow-session");
  assert.equal(parseApprovalChoice("deny"), "deny");
  assert.equal(parseApprovalChoice(undefined), "deny");
  assert.equal(parseApprovalChoice("随便什么"), "deny");
});

test("授权条目校验与去重追加", async () => {
  const { isToolGrantsEntry, addGrant, TOOL_GRANTS_ENTRY_TYPE } = await loadSubject();

  assert.equal(TOOL_GRANTS_ENTRY_TYPE, "pi-web:tool-grants");
  assert.equal(isToolGrantsEntry({ version: 1, grants: [{ toolName: "bash", target: "npm publish" }] }), true);
  assert.equal(isToolGrantsEntry({ version: 2, grants: [] }), false);
  assert.equal(isToolGrantsEntry({ version: 1, grants: [{ toolName: "bash" }] }), false);
  assert.equal(isToolGrantsEntry(null), false);

  const first = addGrant([], { toolName: "bash", target: "npm publish" });
  assert.deepEqual(first, [{ toolName: "bash", target: "npm publish" }]);
  assert.equal(addGrant(first, { toolName: "bash", target: "npm publish" }).length, 1);
  assert.equal(addGrant(first, { toolName: "bash", target: "npm version" }).length, 2);
  // 空授权不加
  assert.equal(addGrant(first, { toolName: "", target: "" }).length, 1);
});
