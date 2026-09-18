/**
 * lib/sound-presets.test.mjs 对应的被测模块见 ./sound-presets.ts。
 * 中文注释：提示音库单测——只验证参数表与调度逻辑，不测真实音频；
 * AudioContext 用结构化 fake 代替，保证 Node 里可直接 import。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  SOUND_PRESETS,
  SOUND_KINDS,
  DEFAULT_SOUND_SELECTION,
  getSoundPreset,
  isValidSelection,
  playPreset,
} = await jiti.import("./sound-presets.ts");

/** 记录每次调度的结构化 fake context。 */
function makeFakeCtx() {
  const scheduled = [];
  const ctx = {
    currentTime: 100,
    destination: {},
    created: 0,
    createOscillator() {
      this.created += 1;
      const osc = {
        type: null,
        frequency: { value: 0 },
        connected: null,
        startAt: -1,
        stopAt: -1,
        connect(node) { this.connected = node; },
        start(when) { this.startAt = when; },
        stop(when) { this.stopAt = when; },
      };
      scheduled.push(osc);
      return osc;
    },
    createGain() {
      const gain = {
        volume: -1,
        connected: null,
        gain: {
          setValueAtTime() {},
          linearRampToValueAtTime(value) { gain.volume = value; },
          exponentialRampToValueAtTime() {},
        },
        connect(node) { this.connected = node; },
      };
      return gain;
    },
  };
  return { ctx, scheduled };
}

test("4 套音色 × 4 类语义齐备", () => {
  assert.equal(SOUND_PRESETS.length, 4);
  assert.deepEqual([...SOUND_KINDS], ["complete", "blocked", "checkpoint", "notification"]);
  const ids = SOUND_PRESETS.map((preset) => preset.id);
  assert.deepEqual([...new Set(ids)].length, ids.length); // id 不重复
  for (const preset of SOUND_PRESETS) {
    for (const kind of SOUND_KINDS) {
      const tones = preset.tones[kind];
      assert.ok(Array.isArray(tones) && tones.length > 0, `${preset.id}/${kind} 必须有音符`);
      for (const tone of tones) {
        assert.ok(tone.freq > 0, "频率为正");
        assert.ok(tone.delayMs >= 0 && tone.durationMs > 0, "时序合法");
        assert.ok(tone.volume > 0 && tone.volume <= 1, "音量在 (0,1] 内防爆音");
        assert.ok(["sine", "triangle", "square"].includes(tone.type), "波形合法");
      }
    }
  }
});

test("默认选择合法", () => {
  assert.ok(isValidSelection(DEFAULT_SOUND_SELECTION));
  assert.equal(getSoundPreset(DEFAULT_SOUND_SELECTION.presetId)?.id, DEFAULT_SOUND_SELECTION.presetId);
});

test("isValidSelection 拒绝非法输入", () => {
  assert.equal(isValidSelection(null), false);
  assert.equal(isValidSelection({}), false);
  assert.equal(isValidSelection({ presetId: "不存在" }), false);
  assert.equal(isValidSelection({ presetId: 42 }), false);
  assert.equal(isValidSelection("soft"), false);
  assert.equal(getSoundPreset("不存在"), undefined);
});

test("playPreset 按参数表调度振荡器", () => {
  const { ctx, scheduled } = makeFakeCtx();
  assert.equal(playPreset(ctx, "soft", "complete"), true);
  // soft/complete 有两个音符。
  assert.equal(scheduled.length, 2);
  assert.equal(scheduled[0].frequency.value, 523.25);
  assert.equal(scheduled[0].type, "sine");
  assert.equal(scheduled[1].frequency.value, 659.25);
  // 第二个音符延迟 180ms。
  assert.ok(Math.abs(scheduled[1].startAt - (100 + 0.18)) < 1e-9);
  assert.ok(scheduled[0].stopAt > scheduled[0].startAt);
  assert.ok(scheduled[0].connected, "osc 接到 gain");
});

test("playPreset 失败路径返回 false 而不抛异常", () => {
  const { ctx } = makeFakeCtx();
  assert.equal(playPreset(null, "soft", "complete"), false);
  assert.equal(playPreset(undefined, "soft", "complete"), false);
  assert.equal(playPreset({}, "soft", "complete"), false);
  assert.equal(playPreset(ctx, "不存在", "complete"), false);
  assert.equal(playPreset(ctx, "soft", "不存在的语义"), false);
  assert.equal(playPreset({ createOscillator() { throw new Error("boom"); }, createGain() { throw new Error("boom"); } }, "soft", "complete"), false);
});
