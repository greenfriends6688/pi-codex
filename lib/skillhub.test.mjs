import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  fetchSkillHubSkills,
  formatDownloads,
  isSafeSkillSlug,
  mapSkillHubSkill,
  skillDirectoryName,
  skillHubDetailUrl,
  skillHubDownloadUrl,
  skillHubPageUrl,
} = await jiti.import("./skillhub.ts");

test("列表 URL 带上排序与关键词，空关键词不写 keyword 参数", () => {
  const browse = skillHubPageUrl({ page: 1, pageSize: 30, sortBy: "score" });
  assert.match(browse, /\/api\/skills\?page=1&pageSize=30&sortBy=score$/);
  const search = skillHubPageUrl({ page: 2, pageSize: 10, sortBy: "score", keyword: "  搜索  " });
  assert.match(search, /keyword=%E6%90%9C%E7%B4%A2/);
  assert.doesNotMatch(browse, /keyword/);
});

test("下载与详情 URL", () => {
  assert.match(skillHubDownloadUrl("brave-search"), /\/api\/v1\/download\?slug=brave-search$/);
  assert.match(skillHubDownloadUrl("x", "1.2.3"), /version=1\.2\.3/);
  assert.equal(skillHubDetailUrl("brave-search"), "https://skillhub.cn/skills/brave-search");
});

test("下载量刻度：万 / 亿", () => {
  assert.equal(formatDownloads(0), "");
  assert.equal(formatDownloads(999), "999 次下载");
  assert.equal(formatDownloads(1568), "1568 次下载");
  assert.equal(formatDownloads(585_000), "58.5 万次下载");
  assert.equal(formatDownloads(1_228_729), "122.9 万次下载");
  assert.equal(formatDownloads(250_000_000), "2.5 亿次下载");
});

test("列表项映射：没 slug 的丢掉，缺字段有兜底", () => {
  assert.equal(mapSkillHubSkill({}), null);
  assert.equal(mapSkillHubSkill({ slug: "   " }), null);
  const mapped = mapSkillHubSkill({
    slug: "dev-expert",
    name: "编程专家",
    description: "多行\n描述  带空白",
    namespace: { handle: "indiv-ebandao" },
    version: "1.21.7",
    downloads: 1228729,
    stars: 250,
  });
  assert.deepEqual(mapped, {
    slug: "dev-expert",
    name: "编程专家",
    description: "多行 描述 带空白",
    publisher: "indiv-ebandao",
    version: "1.21.7",
    downloads: 1228729,
    stars: 250,
    url: "https://skillhub.cn/skills/dev-expert",
  });
});

test("fetchSkillHubSkills 走 code===0 才算成功", async () => {
  const okFetch = async () => new Response(JSON.stringify({
    code: 0,
    data: { skills: [{ slug: "a", name: "A" }], total: 160382 },
  }), { status: 200 });
  const result = await fetchSkillHubSkills({ fetchImpl: okFetch });
  assert.equal(result.total, 160382);
  assert.deepEqual(result.items.map((i) => i.slug), ["a"]);

  const badCode = async () => new Response(JSON.stringify({ code: 403, message: "无权限" }), { status: 200 });
  await assert.rejects(() => fetchSkillHubSkills({ fetchImpl: badCode }), /无权限/);

  const http500 = async () => new Response("boom", { status: 500 });
  await assert.rejects(() => fetchSkillHubSkills({ fetchImpl: http500 }), /HTTP 500/);
});

test("slug 校验挡住路径穿越与怪字符（它会直接当目录名用）", () => {
  for (const good of ["brave-search", "dev_expert", "a.b", "v2-skills"]) {
    assert.equal(isSafeSkillSlug(good), true, good);
  }
  // 带命名空间的 `@ns/name` 也拒绝：列表接口给的就是裸 slug，斜杠没有存在的理由，
  // 而目录名里出现斜杠就是一次穿越机会。命名空间要展示的话另有 publisher 字段。
  for (const bad of ["", "..", "../evil", "@ns/name", "a/b/../c", "a\\b", "有中文", "a b", "x".repeat(121)]) {
    assert.equal(isSafeSkillSlug(bad), false, bad);
  }
});

test("安装目录名取最后一段并清掉非法字符", () => {
  assert.equal(skillDirectoryName("brave-search"), "brave-search");
  // 即便校验被绕过，落盘前还要再兜一层：只取最后一段。
  assert.equal(skillDirectoryName("@ns/brave-search"), "brave-search");
  assert.equal(skillDirectoryName("a b"), "a-b");
});
