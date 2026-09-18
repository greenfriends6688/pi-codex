// lib/default-skills.ts 的单测：只在 os.tmpdir() 里读写，绝不触碰 ~/.pi/。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const {
  DEFAULT_SKILLS_DIR_NAME,
  listDefaultSkills,
  retiredSkillSlugs,
  syncDefaultSkills,
} = await import("./default-skills.ts");

const REPO_ASSETS_ROOT = fileURLToPath(
  new URL("../assets/default-skills", import.meta.url),
);

function createTempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-default-skills-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** 在指定目录下建一个最小技能夹具（含 frontmatter + 子目录 + LICENSE）。 */
function writeFixtureSkill(assetsRoot, slug, frontmatter) {
  const dir = path.join(assetsRoot, slug);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\n${frontmatter}\n---\n\n# ${slug}\n`,
  );
  fs.writeFileSync(path.join(dir, "LICENSE"), `license of ${slug}\n`);
  fs.writeFileSync(path.join(dir, "scripts", "tool.py"), "# fixture\n");
  return dir;
}

function buildFixtureAssets(root) {
  const assetsRoot = path.join(root, "assets");
  fs.mkdirSync(assetsRoot, { recursive: true });
  writeFixtureSkill(
    assetsRoot,
    "alpha-skill",
    'name: alpha-skill\ndescription: fixture alpha\nversion: "1.0.0"',
  );
  writeFixtureSkill(
    assetsRoot,
    "beta-skill",
    'name: beta-skill\ndescription: fixture beta\nversion: "2.0.0"\nlicense: MIT',
  );
  // 无 SKILL.md 的目录与非法 slug 都应被忽略。
  fs.mkdirSync(path.join(assetsRoot, "not-a-skill"), { recursive: true });
  fs.writeFileSync(path.join(assetsRoot, "not-a-skill", "README.md"), "no skill here\n");
  fs.mkdirSync(path.join(assetsRoot, "..evil"), { recursive: true });
  return assetsRoot;
}

test("listDefaultSkills 只列出有效技能并解析 frontmatter", (t) => {
  const root = createTempRoot(t);
  const assetsRoot = buildFixtureAssets(root);

  const skills = listDefaultSkills(assetsRoot);

  assert.deepEqual(
    skills.map((s) => s.slug),
    ["alpha-skill", "beta-skill"],
  );
  const beta = skills.find((s) => s.slug === "beta-skill");
  assert.equal(beta.name, "beta-skill");
  assert.equal(beta.description, "fixture beta");
  assert.equal(beta.version, "2.0.0");
  assert.equal(beta.license, "MIT");
  assert.equal(beta.path, path.join(assetsRoot, "beta-skill"));
});

test("listDefaultSkills 资产目录不存在时返回空数组", () => {
  assert.deepEqual(
    listDefaultSkills(path.join(os.tmpdir(), "pi-web-no-such-dir")),
    [],
  );
});

test("syncDefaultSkills 新增：缺失技能被完整复制（含子目录与 LICENSE）", (t) => {
  const root = createTempRoot(t);
  const assetsRoot = buildFixtureAssets(root);
  const targetDir = path.join(root, "skills");

  const result = syncDefaultSkills({ assetsRoot, targetDir });

  assert.deepEqual(result, { copied: ["alpha-skill", "beta-skill"], skipped: [] });
  for (const slug of ["alpha-skill", "beta-skill"]) {
    assert.equal(
      fs.readFileSync(path.join(targetDir, slug, "SKILL.md"), "utf8"),
      fs.readFileSync(path.join(assetsRoot, slug, "SKILL.md"), "utf8"),
    );
    assert.equal(
      fs.readFileSync(path.join(targetDir, slug, "scripts", "tool.py"), "utf8"),
      "# fixture\n",
    );
    assert.ok(fs.existsSync(path.join(targetDir, slug, "LICENSE")));
  }
  // 不得残留原子写的临时文件。
  assert.ok(
    !fs.readdirSync(path.join(targetDir, "alpha-skill")).some((n) => n.endsWith(".tmp")),
  );
});

test("syncDefaultSkills 已存在不动：同名技能不覆盖、不合并", (t) => {
  const root = createTempRoot(t);
  const assetsRoot = buildFixtureAssets(root);
  const targetDir = path.join(root, "skills");

  // 预置一个用户改过的 alpha-skill：旧 SKILL.md + 用户自己的 extra.md。
  const existing = path.join(targetDir, "alpha-skill");
  fs.mkdirSync(existing, { recursive: true });
  fs.writeFileSync(path.join(existing, "SKILL.md"), "---\nname: alpha-skill\n---\n\nuser edited\n");
  fs.writeFileSync(path.join(existing, "extra.md"), "user file\n");

  const result = syncDefaultSkills({ assetsRoot, targetDir });

  assert.deepEqual(result, { copied: ["beta-skill"], skipped: ["alpha-skill"] });
  // 旧内容原样保留。
  assert.match(fs.readFileSync(path.join(existing, "SKILL.md"), "utf8"), /user edited/);
  assert.equal(fs.readFileSync(path.join(existing, "extra.md"), "utf8"), "user file\n");
  // 来源的新文件没有被合并进来（LICENSE / scripts 都是资产里有、目标里没有的）。
  assert.ok(!fs.existsSync(path.join(existing, "LICENSE")));
  assert.ok(!fs.existsSync(path.join(existing, "scripts", "tool.py")));
});

test("syncDefaultSkills 不覆盖：onlyMissing=false 仍拒绝覆盖已存在技能", (t) => {
  const root = createTempRoot(t);
  const assetsRoot = buildFixtureAssets(root);
  const targetDir = path.join(root, "skills");

  const existing = path.join(targetDir, "beta-skill");
  fs.mkdirSync(existing, { recursive: true });
  fs.writeFileSync(path.join(existing, "SKILL.md"), "user version\n");

  const result = syncDefaultSkills({ assetsRoot, targetDir, onlyMissing: false });

  assert.deepEqual(result, { copied: ["alpha-skill"], skipped: ["beta-skill"] });
  assert.equal(fs.readFileSync(path.join(existing, "SKILL.md"), "utf8"), "user version\n");
});

test("retiredSkillSlugs 预留为空数组", () => {
  assert.deepEqual(retiredSkillSlugs(), []);
});

test("DEFAULT_SKILLS_DIR_NAME 为 default-skills", () => {
  assert.equal(DEFAULT_SKILLS_DIR_NAME, "default-skills");
});

test("仓库真实资产门禁：每个内置技能都有 LICENSE 且不含商用限制许可", () => {
  const skills = listDefaultSkills(REPO_ASSETS_ROOT);
  assert.ok(
    skills.length > 0,
    `assets/default-skills 为空：${REPO_ASSETS_ROOT}`,
  );
  for (const skill of skills) {
    const hasLicense =
      fs.existsSync(path.join(skill.path, "LICENSE")) ||
      fs.existsSync(path.join(skill.path, "LICENSE.txt"));
    assert.ok(hasLicense, `${skill.slug} 缺少 LICENSE*，不允许收录`);
    assert.ok(
      !/proprietary/i.test(skill.license),
      `${skill.slug} 的 frontmatter 许可为 ${skill.license}，不允许收录`,
    );
    const licenseText = [
      path.join(skill.path, "LICENSE"),
      path.join(skill.path, "LICENSE.txt"),
    ]
      .filter((p) => fs.existsSync(p))
      .map((p) => fs.readFileSync(p, "utf8"))
      .join("\n");
    assert.ok(
      !/extract these materials|reproduce or copy these materials|create derivative works based on these materials/i.test(
        licenseText,
      ),
      `${skill.slug} 的 LICENSE 文本含再分发限制，需人工确认后才能收录`,
    );
  }
});
