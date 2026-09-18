"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  DEFAULT_SOUND_SELECTION,
  isValidSelection,
  playPreset,
  getSoundPreset,
  type SoundKind,
} from "@/lib/sound-presets";

/** 选中的音色包持久化键；`pi-sound-enabled` 保持兼容不变。 */
export const SOUND_PRESET_STORAGE_KEY = "pi-sound-preset";

function readStoredSelection(): string {
  if (typeof window === "undefined") return DEFAULT_SOUND_SELECTION.presetId;
  try {
    const stored = localStorage.getItem(SOUND_PRESET_STORAGE_KEY);
    const candidate = stored ? { presetId: stored } : null;
    return candidate && isValidSelection(candidate) ? candidate.presetId : DEFAULT_SOUND_SELECTION.presetId;
  } catch {
    return DEFAULT_SOUND_SELECTION.presetId;
  }
}

/**
 * fork:gap-sound-presets — 原来的实现硬编码一个双音正弦（523.25/659.25Hz），
 * 只有“完成”一种语义。现在改为从 `lib/sound-presets.ts` 读音色包，
 * 并按 4 类语义（complete / blocked / checkpoint / notification）播放。
 * 默认音色包 `soft` 的 composer 就是原来那对音，所以默认听感不变。
 */
function playTone(ctx: AudioContext, kind: SoundKind, presetId: string) {
  // 真实 AudioContext 的结构面与 lib/sound-presets 的 PresetAudioContext 兼容
  //（后者刻意把 connect 声明成方法以启用参数双变性，便于单测注入 fake）。
  playPreset(ctx, presetId, kind);
}

export function useAudio() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("pi-sound-enabled");
    return stored === null ? true : stored === "true";
  });

  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Reuse a single AudioContext so it can be resumed if the browser
  // autoplay policy suspends it (contexts created outside user gestures
  // start in "suspended" state and produce no sound).
  const ctxRef = useRef<AudioContext | null>(null);
  const getCtx = useCallback((): AudioContext | null => {
    if (ctxRef.current && ctxRef.current.state !== "closed") return ctxRef.current;
    try {
      ctxRef.current = new AudioContext();
    } catch {
      return null;
    }
    return ctxRef.current;
  }, []);

  const unlockAudio = useCallback((force = false) => {
    if (!force && !enabledRef.current) return;
    const ctx = getCtx();
    if (!ctx || ctx.state !== "suspended") return;
    ctx.resume().catch(() => {});
  }, [getCtx]);

  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    if (next) unlockAudio(true);
    enabledRef.current = next;
    localStorage.setItem("pi-sound-enabled", String(next));
    setEnabled(next);
  }, [unlockAudio]);

  const playDone = useCallback((kind: SoundKind = "complete") => {
    if (!enabledRef.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    const presetId = readStoredSelection();
    const play = () => {
      try {
        playTone(ctx, kind, presetId);
      } catch {
        // AudioContext not available
      }
    };
    if (ctx.state === "suspended") {
      ctx.resume().then(play).catch(() => {});
      return;
    }
    play();
  }, [getCtx]);

  return {
    soundEnabled: enabled,
    onSoundToggle: toggle,
    playDoneSound: playDone,
    unlockAudio,
    soundEnabledRef: enabledRef,
    soundPresetId: readStoredSelection(),
    soundPresetComment: getSoundPreset(readStoredSelection())?.comment,
  };
}
