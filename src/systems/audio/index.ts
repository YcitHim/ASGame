/**
 * systems/audio · 最简音频层（docs/43 Q1 / docs/45 Q10，v1.1）
 *
 * 范围（策划定死，不再扩张）：**出牌 / 命中×2（打敌人、自己挨打）/ 回合切换** 四条音效
 * + 一首循环 BGM。命中拆两种是 docs/45 Q10 加的：受击反馈是 v1.0.2 的主题，声音要跟上飘字。
 *
 * 实现选择：**Web Audio 程序化合成**，零音频资源、零新依赖。三条理由——
 * ① 本仓库没有音频资源目录，程序也不该凭空塞二进制进去；
 * ② 音色用「振荡器 + 滤波 + 包络」描述，调音是调参数，不用重新录音；
 * ③ 将来策划给了真录音，把 playSfx 内部换成 buffer 播放即可，对外接口不变。
 *
 * 三条硬约束：
 * - **静默降级**：没有 AudioContext（jsdom / 旧浏览器）一律 no-op，绝不抛错；
 * - **自动播放策略**：首次用户手势前不出声（unlockAudio 由首次交互调用）；
 * - **音量三分支**：主音量 / 音效 / BGM 各自一条 GainNode，改设置即生效。
 */

export type SfxId = "cardPlay" | "hitEnemy" | "hitPlayer" | "turn";

export const SFX_IDS: readonly SfxId[] = ["cardPlay", "hitEnemy", "hitPlayer", "turn"];

export interface AudioVolumes {
  readonly masterVolume: number;
  readonly bgmVolume: number;
  readonly sfxVolume: number;
}

interface Graph {
  readonly master: GainNode;
  readonly sfx: GainNode;
  readonly bgm: GainNode;
}

let ctx: AudioContext | null = null;
let graph: Graph | null = null;
let unlocked = false;
let bgmHandle: { stop: () => void } | null = null;
let volumes: AudioVolumes = { masterVolume: 1, bgmVolume: 0.6, sfxVolume: 0.8 };

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

function contextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** 懒创建音频图；不可用（无 API / 创建失败）时返回 null，此后一律 no-op。 */
function ensure(): Graph | null {
  if (graph) return graph;
  const Ctor = contextCtor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    const master = ctx.createGain();
    master.connect(ctx.destination);
    const sfx = ctx.createGain();
    sfx.connect(master);
    const bgm = ctx.createGain();
    bgm.connect(master);
    graph = { master, sfx, bgm };
    applyVolumes(volumes);
    return graph;
  } catch {
    ctx = null;
    graph = null;
    return null;
  }
}

/** 首次用户手势时调用：浏览器在交互前不允许出声。返回是否已就绪。 */
export function unlockAudio(): boolean {
  const g = ensure();
  if (!g || !ctx) return false;
  if (ctx.state === "suspended") void ctx.resume();
  unlocked = true;
  return true;
}

export function isAudioUnlocked(): boolean {
  return unlocked;
}

/** 无音频环境 / 未解锁时为 true——调用方据此静默跳过，不必自己判断。 */
export function isAudioMuted(): boolean {
  return !unlocked || graph === null;
}

/** 设置变更时调用：三分支当场生效，不需要重建上下文。 */
export function applyVolumes(next: AudioVolumes): void {
  volumes = {
    masterVolume: clamp01(next.masterVolume),
    bgmVolume: clamp01(next.bgmVolume),
    sfxVolume: clamp01(next.sfxVolume),
  };
  if (!graph) return;
  graph.master.gain.value = volumes.masterVolume;
  graph.sfx.gain.value = volumes.sfxVolume;
  graph.bgm.gain.value = volumes.bgmVolume;
}

function noiseBuffer(seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx!.sampleRate * seconds));
  const buffer = ctx!.createBuffer(1, length, ctx!.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

interface ToneOptions {
  readonly freq: number;
  readonly to?: number;
  readonly type?: OscillatorType;
  readonly start: number;
  readonly decay: number;
  readonly peak: number;
  readonly attack?: number;
}

/** 一个带包络的振荡器。 */
function tone(dest: AudioNode, o: ToneOptions): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(Math.max(20, o.freq), o.start);
  if (o.to !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), o.start + o.decay);
  }
  const gain = ctx.createGain();
  const attack = o.attack ?? 0.006;
  gain.gain.setValueAtTime(0.0001, o.start);
  gain.gain.linearRampToValueAtTime(o.peak, o.start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, o.start + o.decay);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(o.start);
  osc.stop(o.start + o.decay + 0.05);
}

interface NoiseOptions {
  readonly start: number;
  readonly decay: number;
  readonly peak: number;
  readonly type?: BiquadFilterType;
  readonly freq: number;
  readonly to?: number;
  readonly q?: number;
}

/** 一段带滤波与包络的噪声（金属撞击 / 气声 / 水声的底子）。 */
function noiseBurst(dest: AudioNode, o: NoiseOptions): void {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(Math.max(0.05, o.decay));
  const filter = ctx.createBiquadFilter();
  filter.type = o.type ?? "bandpass";
  filter.frequency.setValueAtTime(Math.max(40, o.freq), o.start);
  if (o.to !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.to), o.start + o.decay);
  }
  filter.Q.value = o.q ?? 1;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(o.peak, o.start);
  gain.gain.exponentialRampToValueAtTime(0.0001, o.start + o.decay);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  src.start(o.start);
  src.stop(o.start + o.decay + 0.05);
}

/** 四条音色的配方：改音色就是改这里的参数。 */
const RECIPES: Record<SfxId, (out: AudioNode, t: number) => void> = {
  // 出牌：甩牌的气声 + 一小片金属
  cardPlay: (out, t) => {
    noiseBurst(out, { start: t, decay: 0.16, peak: 0.22, type: "highpass", freq: 900, to: 2800, q: 0.8 });
    tone(out, { type: "triangle", freq: 430, to: 170, start: t, decay: 0.12, peak: 0.07 });
  },
  // 打敌人：短促的金属脆响
  hitEnemy: (out, t) => {
    noiseBurst(out, { start: t, decay: 0.12, peak: 0.3, type: "bandpass", freq: 2400, to: 900, q: 1.6 });
    tone(out, { type: "square", freq: 190, to: 88, start: t, decay: 0.12, peak: 0.09 });
    tone(out, { type: "sine", freq: 1320, start: t, decay: 0.18, peak: 0.05 });
  },
  // 自己挨打：更闷更低，带一点下坠（和飘字同主题）
  hitPlayer: (out, t) => {
    tone(out, { type: "sine", freq: 150, to: 58, start: t, decay: 0.3, peak: 0.26 });
    noiseBurst(out, { start: t, decay: 0.22, peak: 0.18, type: "lowpass", freq: 700, to: 200, q: 0.7 });
    tone(out, { type: "sawtooth", freq: 96, to: 68, start: t + 0.02, decay: 0.2, peak: 0.06 });
  },
  // 回合切换：一声低钟 + 齿轮咔哒
  turn: (out, t) => {
    tone(out, { type: "sine", freq: 523.25, start: t, decay: 0.5, peak: 0.08 });
    tone(out, { type: "sine", freq: 261.63, start: t, decay: 0.75, peak: 0.1 });
    noiseBurst(out, { start: t + 0.05, decay: 0.1, peak: 0.1, type: "bandpass", freq: 1600, q: 2 });
  },
};

/** 播一条音效。未解锁 / 无音频环境时静默返回。 */
export function playSfx(id: SfxId): void {
  if (!unlocked) return;
  const g = ensure();
  if (!g || !ctx) return;
  RECIPES[id](g.sfx, ctx.currentTime);
}

/**
 * BGM：低频 drone + 水声垫 + 慢速呼吸，持续播放直到 stopBgm。
 * 「一首循环 BGM」在这里的形态是**连续声场**而不是音轨循环——第二幕的沉没圣堂要的是氛围，
 * 不是一段会听腻的旋律；真录音到位后换 buffer 即可。
 */
export function startBgm(): void {
  if (bgmHandle) return;
  const g = ensure();
  if (!g || !ctx) return;
  const t = ctx.currentTime;
  const stopFns: (() => void)[] = [];

  const drones: readonly [number, number, number][] = [
    [55, 0.1, -6],
    [55, 0.08, 7],
    [82.41, 0.05, 3],
  ];
  for (const [freq, peak, detune] of drones) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.detune.value = detune;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + 4);
    // 慢速呼吸：LFO 直接加在增益上
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.04 + Math.random() * 0.04;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = peak * 0.45;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    osc.connect(gain);
    gain.connect(g.bgm);
    osc.start(t);
    lfo.start(t);
    stopFns.push(() => {
      osc.stop();
      lfo.stop();
    });
  }

  const pad = ctx.createBufferSource();
  pad.buffer = noiseBuffer(4);
  pad.loop = true;
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 300;
  const padGain = ctx.createGain();
  padGain.gain.value = 0.045;
  pad.connect(padFilter);
  padFilter.connect(padGain);
  padGain.connect(g.bgm);
  pad.start(t);
  stopFns.push(() => pad.stop());

  bgmHandle = {
    stop: () => {
      for (const fn of stopFns) {
        try {
          fn();
        } catch {
          // 已经停了
        }
      }
    },
  };
}

export function stopBgm(): void {
  bgmHandle?.stop();
  bgmHandle = null;
}

export function isBgmPlaying(): boolean {
  return bgmHandle !== null;
}

/** 设置页「试听」：先解锁（点击本身就是手势），再放一条当前音量的样本。 */
export function previewSfx(id: SfxId): void {
  unlockAudio();
  playSfx(id);
}

/** 设置页「试听音乐」：解锁并确保 BGM 在播（再点一次由设置页决定是否停）。 */
export function previewBgm(): void {
  unlockAudio();
  startBgm();
}

/** 仅测试用：把模块级状态清回初始。 */
export function resetAudioForTest(): void {
  stopBgm();
  ctx = null;
  graph = null;
  unlocked = false;
  volumes = { masterVolume: 1, bgmVolume: 0.6, sfxVolume: 0.8 };
}
