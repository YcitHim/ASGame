/**
 * stores/settings · 设置项投影（ui README 待做项）
 * 只做状态与持久化转发，不含任何数值逻辑。
 */
import { defineStore } from "pinia";
import { readSlot, writeSlot } from "@/systems/save";

export interface Settings {
  masterVolume: number;
  bgmVolume: number;
  sfxVolume: number;
  screenShake: boolean;
  /** 跳过单场动画（docs/08 §6：支持跳过与 2× 倍速） */
  animationSpeed: 1 | 2;
  language: "zh-CN";
  /** 开发者模式（测试用）：解锁全部内容，并在选人/地图页露出跳关入口 */
  developerMode: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  bgmVolume: 0.6,
  sfxVolume: 0.8,
  screenShake: true,
  animationSpeed: 1,
  language: "zh-CN",
  developerMode: false,
};

function clamp01(n: unknown, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

/** 磁盘数据可能是旧版 / 被手改，逐字段兜底（纯函数，可单测）。 */
export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const r = raw ?? {};
  return {
    masterVolume: clamp01(r.masterVolume, DEFAULT_SETTINGS.masterVolume),
    bgmVolume: clamp01(r.bgmVolume, DEFAULT_SETTINGS.bgmVolume),
    sfxVolume: clamp01(r.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    screenShake: typeof r.screenShake === "boolean" ? r.screenShake : DEFAULT_SETTINGS.screenShake,
    animationSpeed: r.animationSpeed === 2 ? 2 : 1,
    language: "zh-CN",
    developerMode: typeof r.developerMode === "boolean" ? r.developerMode : DEFAULT_SETTINGS.developerMode,
  };
}

export const useSettingsStore = defineStore("settings", {
  state: (): { values: Settings; ready: boolean } => ({
    values: { ...DEFAULT_SETTINGS },
    ready: false,
  }),
  actions: {
    init(): void {
      if (this.ready) return;
      this.values = normalizeSettings(readSlot<Partial<Settings> | null>("settings", null));
      this.ready = true;
    },
    update(patch: Partial<Settings>): void {
      this.values = normalizeSettings({ ...this.values, ...patch });
      writeSlot("settings", this.values);
    },
    reset(): void {
      this.values = { ...DEFAULT_SETTINGS };
      writeSlot("settings", this.values);
    },
  },
});
