"use client";

// D2-PR-12 — 项目文件索引 / 已加载 skill 的共享缓存。
//
// 给 @file / /skill: mention 的合法性校验用：每条用户消息、输入框高亮层都订阅
// 同一份快照，所以一个会话只发一次请求。策略与 REF 一致：
// - 模块级缓存（跨组件、跨消息复用）；
// - 30s TTL（过期后由第一个订阅者触发重取）；
// - 并发去重（同一 cwd 同时在飞的请求只保留一个 Promise）。
//
// 与 REF 的差异：`useSyncExternalStore` 补了 `getServerSnapshot`。本仓库的
// ChatInput/MessageView 测试会 `renderToStaticMarkup`（SSR），缺第三个参数时
// React 会抛 "Missing getServerSnapshot"；服务端一律返回 null（未加载 → 不高亮，
// 与「valid 才高亮、绝不猜」一致）。

import { useEffect, useSyncExternalStore } from "react";
import { buildEntriesFromFiles } from "@/lib/file-fuzzy";
import type { SkillInfo, SkillsResponse } from "@/lib/api-types";

export interface FileIndexSnapshot {
  cwd: string;
  /** 小写化的 cwd 相对路径（文件）与目录，均不带尾部 "/" */
  paths: Set<string>;
  dirs: Set<string>;
  /** 服务端列出被截断时为 true —— 未命中可能是假阴性 */
  truncated: boolean;
}

export interface SkillInfoSnapshot {
  cwd: string;
  /** skill 名 → 元数据（description、filePath、baseDir） */
  skills: Map<string, SkillInfo>;
}

const INDEX_TTL_MS = 30_000;
const SKILLS_TTL_MS = 30_000;

const listeners = new Set<() => void>();
function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** SSR/预渲染快照：索引未知，mention 一律不高亮。 */
function getServerSnapshot(): null {
  return null;
}

const indexSnapshots = new Map<string, FileIndexSnapshot>();
const indexFetchedAt = new Map<string, number>();
const indexInflight = new Map<string, Promise<FileIndexSnapshot | null>>();

async function fetchFileIndex(cwd: string): Promise<FileIndexSnapshot | null> {
  const existing = indexInflight.get(cwd);
  if (existing) return existing;
  const request = (async () => {
    try {
      const response = await fetch(`/api/file-index?cwd=${encodeURIComponent(cwd)}`);
      if (!response.ok) return null;
      const data = (await response.json()) as { files?: string[]; truncated?: boolean };
      const entries = buildEntriesFromFiles(data.files ?? []);
      const snapshot: FileIndexSnapshot = {
        cwd,
        paths: new Set(entries.filter((e) => !e.isDir).map((e) => e.path.toLowerCase())),
        dirs: new Set(entries.filter((e) => e.isDir).map((e) => e.path.toLowerCase())),
        truncated: !!data.truncated,
      };
      indexSnapshots.set(cwd, snapshot);
      indexFetchedAt.set(cwd, Date.now());
      notify();
      return snapshot;
    } catch {
      return null;
    } finally {
      indexInflight.delete(cwd);
    }
  })();
  indexInflight.set(cwd, request);
  return request;
}

const skillSnapshots = new Map<string, SkillInfoSnapshot>();
const skillsFetchedAt = new Map<string, number>();
const skillsInflight = new Map<string, Promise<SkillInfoSnapshot | null>>();

async function fetchSkillInfo(cwd: string): Promise<SkillInfoSnapshot | null> {
  const existing = skillsInflight.get(cwd);
  if (existing) return existing;
  const request = (async () => {
    try {
      const response = await fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`);
      if (!response.ok) return null;
      const data = (await response.json()) as SkillsResponse;
      const snapshot: SkillInfoSnapshot = {
        cwd,
        skills: new Map(data.skills.map((skill) => [skill.name, skill])),
      };
      skillSnapshots.set(cwd, snapshot);
      skillsFetchedAt.set(cwd, Date.now());
      notify();
      return snapshot;
    } catch {
      return null;
    } finally {
      skillsInflight.delete(cwd);
    }
  })();
  skillsInflight.set(cwd, request);
  return request;
}

/**
 * 某个 cwd 的项目文件索引；未知时为 null。每个 cwd 每 TTL 最多重取一次，
 * 并发订阅者共享同一个请求。
 */
export function useFileIndex(cwd?: string | null): FileIndexSnapshot | null {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (cwd ? (indexSnapshots.get(cwd) ?? null) : null),
    getServerSnapshot,
  );
  useEffect(() => {
    if (!cwd) return;
    const fetchedAt = indexFetchedAt.get(cwd);
    if (fetchedAt !== undefined && Date.now() - fetchedAt < INDEX_TTL_MS) return;
    void fetchFileIndex(cwd);
  }, [cwd]);
  return snapshot;
}

/**
 * 某个 cwd 已加载的 skill 元数据（settings skills、package skills、
 * 项目 .agents/skills —— 与运行时同一视角）。
 * 返回 name → SkillInfo；未知时为 null。
 */
export function useSkillInfo(cwd?: string | null): Map<string, SkillInfo> | null {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (cwd ? (skillSnapshots.get(cwd) ?? null) : null),
    getServerSnapshot,
  );
  useEffect(() => {
    if (!cwd) return;
    const fetchedAt = skillsFetchedAt.get(cwd);
    if (fetchedAt !== undefined && Date.now() - fetchedAt < SKILLS_TTL_MS) return;
    void fetchSkillInfo(cwd);
  }, [cwd]);
  return snapshot ? snapshot.skills : null;
}

/**
 * 某个 cwd 已加载的 skill 名集合；未知时为 null。
 */
export function useSkillNames(cwd?: string | null): Set<string> | null {
  const skills = useSkillInfo(cwd);
  return skills ? new Set(skills.keys()) : null;
}
