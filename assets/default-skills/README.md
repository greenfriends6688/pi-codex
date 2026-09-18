# 内置技能目录（`assets/default-skills`）

> GAP-20 资产部分：随仓库分发的内置技能模板。首次启动时由服务端种子到用户技能
> 目录（`~/.pi/agent/skills/<slug>/`），种子逻辑见 `lib/default-skills.ts`
>（默认只补缺失，同名已存在技能绝不覆盖、不合并）。

## 来源

摘自参考项目 `pi参考项目/Proma-main/apps/electron/default-skills/`（Proma Electron 版
自带的 17 个技能模板）。本仓只收录其中**许可允许再分发**的子集，原样复制（含
`LICENSE*` 与全部子目录，未改动任何技能文件）。

## 许可表（2026-09-18 核查）

| 技能 | 许可 / 依据 | 是否收录 | 来源标注 |
| --- | --- | --- | --- |
| `guizang-ppt-skill` | MIT（同目录 `LICENSE`，Copyright (c) 2026 op7418） | ✅ 已收录 | 第三方开源（歸藏），随附 LICENSE |
| `skill-creator` | Apache-2.0（同目录 `LICENSE.txt`） | ✅ 已收录 | 上游技能生态，随附 LICENSE.txt |
| `docx` | Proprietary（`LICENSE.txt`：Anthropic，禁止 extract/reproduce/derivative） | ❌ 需人工确认 | Anthropic 自带技能， commercial 限制 |
| `pdf` | Proprietary（同上） | ❌ 需人工确认 | 同上 |
| `pptx` | Proprietary（同上） | ❌ 需人工确认 | 同上 |
| `xlsx` | Proprietary（同上） | ❌ 需人工确认 | 同上 |
| `session-cleaner` | AGPL-3.0-only（`SKILL.md` frontmatter；仓库根 LICENSE 亦为 AGPL） | ❌ 需人工确认 | copyleft，传染性需法务/主 Agent 定夺 |
| `agent-collaboration` | 许可不明（无 `license` 字段、无 LICENSE 文件；Proma 自研，`group: proma`） | ❌ 需人工确认 | Proma 自带，需上游明确再分发授权 |
| `automation` | 许可不明（同上，`group: proma`） | ❌ 需人工确认 | 同上 |
| `in-app-browser` | 许可不明（同上，`group: proma`） | ❌ 需人工确认 | 同上 |
| `knowledge-maintenance` | 许可不明（无 license 字段、无 LICENSE 文件） | ❌ 需人工确认 | Proma 自带，需上游明确授权 |
| `proma-coach` | 许可不明（同上） | ❌ 需人工确认 | 同上 |
| `prompt-clarifier` | 许可不明（同上） | ❌ 需人工确认 | 同上 |
| `tool-builder` | 许可不明（同上） | ❌ 需人工确认 | 同上 |
| `executing-plans` | 许可不明（无 license 字段、无 LICENSE 文件） | ❌ 需人工确认 | 疑似外部技能改写，需溯源 |
| `writing-plans` | 许可不明（同上） | ❌ 需人工确认 | 同上 |
| `find-skills` | 许可不明（同上） | ❌ 需人工确认 | 同上 |

核查方法：逐个读取 `SKILL.md` frontmatter 的 `license` 字段与同目录 `LICENSE` /
`LICENSE.txt`（命令见任务记录）。“需人工确认”的 15 个一律未复制。

## 总体积

- 已收录：`guizang-ppt-skill`（448K）+ `skill-creator`（204K）≈ **652K**，远低于
  10MB 上限。
- 参考源总量约 4.4M（含未收录的 docx/pptx/xlsx 脚本与 schema）。

## 升级方式

1. 在参考项目确认目标技能的许可未变（重读 `SKILL.md` frontmatter + `LICENSE*`）。
2. 仅当许可仍为 Apache-2.0 / MIT / 公共领域类时，才可整目录覆盖复制到此处
   （保留 `LICENSE*` 与子目录，不要只拷 `SKILL.md`）。
3. 同步更新上表与 `lib/default-skills.test.mjs` 的真实资产门禁测试。
4. 技能改名/下架时：不要删用户目录旧副本，把旧 slug 填进
   `lib/default-skills.ts` 的 `retiredSkillSlugs()` 并提示用户手工清理。

## 安全

- 不要执行复制过来的任何脚本（如 `skill-creator/scripts/*.py`、
  `guizang-ppt-skill/scripts/*.mjs` 仅作模板分发，不在构建/启动链中运行）。
- 不要把本目录的引入写进 `package.json` 的 `files` / `extraResources`
 （打包接线由主 Agent 统一做）。
