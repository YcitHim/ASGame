// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyVolumes,
  isAudioMuted,
  isAudioUnlocked,
  isBgmPlaying,
  playSfx,
  previewBgm,
  previewSfx,
  resetAudioForTest,
  SFX_IDS,
  startBgm,
  stopBgm,
  unlockAudio,
} from "@/systems/audio";

/**
 * docs/43 Q1 / docs/45 Q10 · 音频层。
 *
 * jsdom 没有 Web Audio，所以这里注入一份最小假实现：只统计「建了几个振荡器 / 几个噪声源 /
 * 几个滤波器、包络有没有被设过」。要验的是**调用契约**（静默降级、解锁、三条音量、四条音色
 * 各自真发了声），不是波形好坏——音色靠耳朵在设置页试听。
 */

class FakeParam {
  value = 0;
  setValueAtTime(v: number): this { this.value = v; return this; }
  linearRampToValueAtTime(v: number): this { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number): this { this.value = v; return this; }
}

class FakeNode {
  connect(): void {}
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakeOsc extends FakeNode {
  type = "sine";
  frequency = new FakeParam();
  detune = new FakeParam();
  starts = 0;
  stops = 0;
  start(): void { this.starts += 1; }
  stop(): void { this.stops += 1; }
}
class FakeFilter extends FakeNode {
  type = "lowpass";
  frequency = new FakeParam();
  Q = new FakeParam();
}
class FakeSource extends FakeNode {
  buffer: { length: number } | null = null;
  loop = false;
  starts = 0;
  stops = 0;
  start(): void { this.starts += 1; }
  stop(): void { this.stops += 1; }
}

class FakeAudioContext {
  static created: FakeAudioContext[] = [];
  static get last(): FakeAudioContext { return FakeAudioContext.created[FakeAudioContext.created.length - 1]!; }
  sampleRate = 48000;
  currentTime = 10;
  /** 真实浏览器在首次用户手势前就是 suspended——未解锁时 resume 才是必须的那一步 */
  state = "suspended";
  destination = new FakeNode();
  oscs: FakeOsc[] = [];
  gains: FakeGain[] = [];
  filters: FakeFilter[] = [];
  sources: FakeSource[] = [];
  resumeCalls = 0;
  constructor() { FakeAudioContext.created.push(this); }
  resume(): Promise<void> { this.resumeCalls += 1; this.state = "running"; return Promise.resolve(); }
  createGain(): FakeGain { const n = new FakeGain(); this.gains.push(n); return n; }
  createOscillator(): FakeOsc { const n = new FakeOsc(); this.oscs.push(n); return n; }
  createBiquadFilter(): FakeFilter { const n = new FakeFilter(); this.filters.push(n); return n; }
  createBufferSource(): FakeSource { const n = new FakeSource(); this.sources.push(n); return n; }
  createBuffer(_ch: number, length: number): { length: number; getChannelData: () => Float32Array } {
    return { length, getChannelData: () => new Float32Array(length) };
  }
}

function installFakeAudio(): void {
  FakeAudioContext.created = [];
  (window as unknown as Record<string, unknown>).AudioContext = FakeAudioContext;
}

function removeFakeAudio(): void {
  delete (window as unknown as Record<string, unknown>).AudioContext;
  delete (window as unknown as Record<string, unknown>).webkitAudioContext;
}

describe("systems/audio · 音频层", () => {
  beforeEach(() => {
    installFakeAudio();
    resetAudioForTest();
    FakeAudioContext.created = [];
  });
  afterEach(() => {
    resetAudioForTest();
    removeFakeAudio();
  });

  it("无 AudioContext（jsdom / 旧浏览器）时全部静默：不抛错、也不出声", () => {
    removeFakeAudio();
    resetAudioForTest();
    expect(unlockAudio()).toBe(false);
    expect(isAudioUnlocked()).toBe(false);
    expect(isAudioMuted()).toBe(true);
    for (const id of SFX_IDS) expect(() => playSfx(id)).not.toThrow();
    expect(() => startBgm()).not.toThrow();
    expect(isBgmPlaying()).toBe(false);
    expect(() => stopBgm()).not.toThrow();
  });

  it("未解锁前不出声（自动播放策略）：playSfx 一个节点都不建", () => {
    playSfx("cardPlay");
    expect(FakeAudioContext.created.length).toBe(0);
  });

  it("unlockAudio 建图并 resume；之后才出声", () => {
    expect(unlockAudio()).toBe(true);
    expect(isAudioUnlocked()).toBe(true);
    expect(isAudioMuted()).toBe(false);
    const ctx = FakeAudioContext.last;
    expect(ctx.resumeCalls).toBe(1);
    playSfx("cardPlay");
    expect(ctx.oscs.length).toBeGreaterThan(0);
  });

  it("四条音效各有可听的配方（振荡器 / 噪声源都在）", () => {
    unlockAudio();
    const ctx = FakeAudioContext.last;
    const counts: Record<string, { osc: number; src: number }> = {};
    /** 配方签名 = 振荡器（波形:频率）+ 滤波器（类型:频率），用来判断"两条音色是不是同一份" */
    const sig: Record<string, string> = {};
    for (const id of SFX_IDS) {
      const o0 = ctx.oscs.length;
      const s0 = ctx.sources.length;
      const f0 = ctx.filters.length;
      playSfx(id);
      counts[id] = { osc: ctx.oscs.length - o0, src: ctx.sources.length - s0 };
      sig[id] = [
        ...ctx.oscs.slice(o0).map((o) => `${o.type}:${o.frequency.value}`),
        ...ctx.filters.slice(f0).map((f) => `${f.type}:${f.frequency.value}`),
      ].join("|");
    }
    // 每条都要有音高（振荡器）+ 质感（噪声）
    for (const id of SFX_IDS) {
      expect(counts[id]!.osc, id + " 应该有振荡器").toBeGreaterThan(0);
      expect(counts[id]!.src, id + " 应该有噪声源").toBeGreaterThan(0);
    }
    // docs/45 Q10：命中必须分敌我两种——两条都是 2 振荡器 + 1 噪声源，
    // 但波形 / 频率 / 滤波完全不同（打敌人是金属脆响，自己挨打是低频闷响）
    expect(sig.hitEnemy).not.toBe(sig.hitPlayer);
    expect(new Set(SFX_IDS.map((id) => sig[id])).size).toBe(SFX_IDS.length);
    // 每个发声节点都被 graph 接上并 start/stop（不能泄漏成永远在响的振荡器）
    for (const osc of ctx.oscs) {
      expect(osc.starts).toBe(1);
      expect(osc.stops).toBe(1);
    }
    for (const src of ctx.sources) {
      expect(src.starts).toBe(1);
      expect(src.stops).toBe(1);
    }
  });

  it("三条音量各自一条 GainNode，改设置当场生效并夹到 0..1", () => {
    unlockAudio();
    const ctx = FakeAudioContext.last;
    // master / sfx / bgm 三条支路在 ensure 时就建好了
    expect(ctx.gains.length).toBeGreaterThanOrEqual(3);
    applyVolumes({ masterVolume: 0.5, bgmVolume: 0.25, sfxVolume: 1 });
    const values = ctx.gains.slice(0, 3).map((g) => g.gain.value);
    expect(values).toEqual([0.5, 1, 0.25]);
    // 越界 / NaN 一律夹住，绝不把负数或 NaN 塞进 GainNode
    // （ensure() 建支路的顺序固定是 master → sfx → bgm，所以取值顺序就是 [主, 音效, 音乐]）
    applyVolumes({ masterVolume: -3, bgmVolume: 9, sfxVolume: Number.NaN });
    expect(ctx.gains.slice(0, 3).map((g) => g.gain.value)).toEqual([0, 0, 1]);
  });

  it("BGM 反复 start 只有一份（不叠成噪音），stop 后能再开", () => {
    unlockAudio();
    const ctx = FakeAudioContext.last;
    startBgm();
    const afterFirst = ctx.oscs.length;
    startBgm();
    expect(ctx.oscs.length).toBe(afterFirst);
    expect(isBgmPlaying()).toBe(true);
    stopBgm();
    expect(isBgmPlaying()).toBe(false);
    startBgm();
    expect(isBgmPlaying()).toBe(true);
    stopBgm();
  });

  it("BGM 的循环垫是 loop 起来的噪声源（一首循环 BGM 不靠一段旋律）", () => {
    unlockAudio();
    const ctx = FakeAudioContext.last;
    startBgm();
    expect(ctx.sources.some((s) => s.loop)).toBe(true);
    stopBgm();
  });

  it("试听入口自带解锁：第一次点击就出声（否则设置页按了没反应）", () => {
    previewSfx("hitEnemy");
    expect(isAudioUnlocked()).toBe(true);
    expect(FakeAudioContext.last.oscs.length).toBeGreaterThan(0);
    resetAudioForTest();
    FakeAudioContext.created = [];
    previewBgm();
    expect(isBgmPlaying()).toBe(true);
  });
});
