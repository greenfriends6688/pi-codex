/**
 * lib/sound-presets.ts
 *
 * 用途：语义提示音库（GAP-27）。4 类语义（complete 完成 / blocked 受阻 /
 * checkpoint 检查点 / notification 普通通知）× 4 套音色，全部用 Web Audio
 * 振荡器参数描述，不引入任何音频文件，体积零增加。
 *
 * 音色一览（id）：
 * - soft：正弦双音，沿用 useAudio 现有听感，默认选中；
 * - chime：三角波上行琶音，偏“提醒”；
 * - pulse：方波短促两下，偏“受阻/警告”；
 * - glass：高频正弦泛音，偏“轻通知”。
 *
 * 本模块不触碰 window/AudioContext 全局：播放所需的 context 由调用方
 * （hooks/useAudio）传入，单测用结构化 fake 即可验证调度逻辑。
 * 与现有偏好兼容：localStorage 的 `pi-sound-enabled` 开关保持不动，
 * 这里只管“选哪套、怎么播”。
 */

export type SoundKind = "complete" | "blocked" | "checkpoint" | "notification";

/** 全部语义种类，渲染设置 UI 时遍历它即可。 */
export const SOUND_KINDS: readonly SoundKind[] = ["complete", "blocked", "checkpoint", "notification"];

/** 单个音符：频率 / 相对起始延迟 / 时长 / 波形 / 音量。 */
export interface ToneSpec {
  freq: number;
  delayMs: number;
  durationMs: number;
  type: OscillatorType;
  volume: number;
}

/** 一套音色：4 类语义各一组音符序列。 */
export interface SoundPreset {
  id: string;
  /** 中文名只用于代码可读性；展示文案由接线方走 lib/i18n。 */
  comment: string;
  tones: Record<SoundKind, ToneSpec[]>;
}

const SINE: OscillatorType = "sine";
const TRIANGLE: OscillatorType = "triangle";
const SQUARE: OscillatorType = "square";

export const SOUND_PRESETS: readonly SoundPreset[] = [
  {
    id: "soft",
    comment: "柔和正弦：沿用现有完成声听感，默认音色",
    tones: {
      complete: [
        { freq: 523.25, delayMs: 0, durationMs: 450, type: SINE, volume: 0.18 },
        { freq: 659.25, delayMs: 180, durationMs: 450, type: SINE, volume: 0.18 },
      ],
      blocked: [
        { freq: 392.0, delayMs: 0, durationMs: 300, type: SINE, volume: 0.18 },
        { freq: 311.13, delayMs: 200, durationMs: 450, type: SINE, volume: 0.18 },
      ],
      checkpoint: [
        { freq: 587.33, delayMs: 0, durationMs: 350, type: SINE, volume: 0.16 },
      ],
      notification: [
        { freq: 659.25, delayMs: 0, durationMs: 300, type: SINE, volume: 0.14 },
      ],
    },
  },
  {
    id: "chime",
    comment: "三角波上行琶音：提醒感强",
    tones: {
      complete: [
        { freq: 523.25, delayMs: 0, durationMs: 300, type: TRIANGLE, volume: 0.16 },
        { freq: 659.25, delayMs: 120, durationMs: 300, type: TRIANGLE, volume: 0.16 },
        { freq: 783.99, delayMs: 240, durationMs: 500, type: TRIANGLE, volume: 0.16 },
      ],
      blocked: [
        { freq: 440.0, delayMs: 0, durationMs: 250, type: TRIANGLE, volume: 0.16 },
        { freq: 349.23, delayMs: 180, durationMs: 400, type: TRIANGLE, volume: 0.16 },
      ],
      checkpoint: [
        { freq: 659.25, delayMs: 0, durationMs: 250, type: TRIANGLE, volume: 0.14 },
        { freq: 783.99, delayMs: 140, durationMs: 350, type: TRIANGLE, volume: 0.14 },
      ],
      notification: [
        { freq: 783.99, delayMs: 0, durationMs: 250, type: TRIANGLE, volume: 0.12 },
      ],
    },
  },
  {
    id: "pulse",
    comment: "方波短促：警告/受阻存在感强，音量压低防刺耳",
    tones: {
      complete: [
        { freq: 523.25, delayMs: 0, durationMs: 160, type: SQUARE, volume: 0.07 },
        { freq: 659.25, delayMs: 140, durationMs: 220, type: SQUARE, volume: 0.07 },
      ],
      blocked: [
        { freq: 220.0, delayMs: 0, durationMs: 200, type: SQUARE, volume: 0.08 },
        { freq: 220.0, delayMs: 240, durationMs: 300, type: SQUARE, volume: 0.08 },
      ],
      checkpoint: [
        { freq: 587.33, delayMs: 0, durationMs: 160, type: SQUARE, volume: 0.06 },
      ],
      notification: [
        { freq: 880.0, delayMs: 0, durationMs: 120, type: SQUARE, volume: 0.05 },
      ],
    },
  },
  {
    id: "glass",
    comment: "高频泛音：轻通知几乎无打扰",
    tones: {
      complete: [
        { freq: 1046.5, delayMs: 0, durationMs: 500, type: SINE, volume: 0.1 },
        { freq: 1318.5, delayMs: 160, durationMs: 500, type: SINE, volume: 0.08 },
      ],
      blocked: [
        { freq: 784.0, delayMs: 0, durationMs: 350, type: SINE, volume: 0.1 },
        { freq: 622.25, delayMs: 200, durationMs: 500, type: SINE, volume: 0.1 },
      ],
      checkpoint: [
        { freq: 1174.66, delayMs: 0, durationMs: 400, type: SINE, volume: 0.09 },
      ],
      notification: [
        { freq: 1318.5, delayMs: 0, durationMs: 350, type: SINE, volume: 0.08 },
      ],
    },
  },
];

/** 用户选择：目前整套切换（4 类语义同走一套音色），以后可扩展为按类混搭。 */
export interface SoundSelection {
  presetId: string;
}

export const DEFAULT_SOUND_SELECTION: SoundSelection = { presetId: "soft" };

/** 按 id 取预设，不存在返回 undefined。 */
export function getSoundPreset(presetId: string): SoundPreset | undefined {
  return SOUND_PRESETS.find((preset) => preset.id === presetId);
}

/** 校验外来选择（localStorage 回读等）：id 必须命中已知预设。 */
export function isValidSelection(value: unknown): value is SoundSelection {
  if (typeof value !== "object" || value === null) return false;
  const presetId = (value as { presetId?: unknown }).presetId;
  return typeof presetId === "string" && getSoundPreset(presetId) !== undefined;
}

/** playPreset 只需要的最小 context 面：真 AudioContext 与单测 fake 都满足。 */
export interface PresetOscillator {
  type: OscillatorType;
  frequency: { value: number };
  // 声明成方法（不是属性）以启用参数双变性：真实 AudioContext 的
  // `connect(destinationNode: AudioNode)` 因此可赋给这个宽松签名，单测 fake 也能满足。
  connect(node: unknown): void;
  start: (when: number) => void;
  stop: (when: number) => void;
}

export interface PresetGain {
  gain: {
    setValueAtTime: (value: number, when: number) => void;
    linearRampToValueAtTime: (value: number, when: number) => void;
    exponentialRampToValueAtTime: (value: number, when: number) => void;
  };
  connect(node: unknown): void;
}

export interface PresetAudioContext {
  currentTime: number;
  destination: unknown;
  createOscillator: () => PresetOscillator;
  createGain: () => PresetGain;
}

/**
 * 按预设与语义播放一组音符。成功返回 true；preset/kind 未知、context 不可用
 * 或调度中途异常都返回 false，绝不抛异常（调用方无需 try/catch）。
 */
export function playPreset(
  ctx: PresetAudioContext | null | undefined,
  presetId: string,
  kind: SoundKind,
): boolean {
  try {
    if (!ctx || typeof ctx.createOscillator !== "function" || typeof ctx.createGain !== "function") return false;
    const preset = getSoundPreset(presetId);
    if (!preset) return false;
    const tones = preset.tones[kind];
    if (!Array.isArray(tones) || tones.length === 0) return false;
    const now = ctx.currentTime;
    for (const tone of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = tone.type;
      osc.frequency.value = tone.freq;
      const start = now + tone.delayMs / 1000;
      const dur = tone.durationMs / 1000;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(tone.volume, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.start(start);
      osc.stop(start + dur);
    }
    return true;
  } catch {
    return false;
  }
}
