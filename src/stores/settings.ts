/**
 * stores/settings · 设置项投影（ui README 待做项）
 * 只做状态与持久化转发，不含任何数值逻辑。
 */
import { defineStore } from "pinia";
import { readSlot, writeSlot } from "@/systems/save";

/**
 * 战斗动画档位（docs/41 §3.1 降级）：
 *  - full：完整（前扑 / 飘字 / 屏震 / 微光 / 呼吸）
 *  - simple：简化（仅飘字，保住"挨打看得见"的信息层）
 *  - off：关闭
 */
export type BattleAnim = "full" | "simple" | "off";

export interface Settings {
  masterVolume: number;
  bgmVolume: number;
  sfxVolume: number;
  battleAnim: BattleAnim;
  /** 跳过单场动画（docs/08 §6：支持跳过与 2× 倍速） */
  animationSpeed: 1 | 2;
  language: "zh-CN";
  /** 开发者模式（测试用）：解锁全部内容，并在选人/地图页露出跳关入口 */
  developerMode: boolean;
  /** 首遇提示弹窗（docs/41 §4.1）：关掉后除图鉴回看外不再弹任何机制说明 */
  tipPopups: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  bgmVolume: 0.6,
  sfxVolume: 0.8,
  battleAnim: "full",
  animationSpeed: 1,
  language: "zh-CN",
  developerMode: false,
  tipPopups: true,
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
    battleAnim: normalizeBattleAnim(r),
    animationSpeed: r.animationSpeed === 2 ? 2 : 1,
    language: "zh-CN",
    developerMode: typeof r.developerMode === "boolean" ? r.developerMode : DEFAULT_SETTINGS.developerMode,
    tipPopups: typeof r.tipPopups === "boolean" ? r.tipPopups : DEFAULT_SETTINGS.tipPopups,
  };
}

const BATTLE_ANIMS: readonly BattleAnim[] = ["full", "simple", "off"];

/** 战斗动画档位归一化：兼容旧版 screenShake 布尔开关（关 = 动画关闭）。 */
function normalizeBattleAnim(raw: Partial<Settings> & { screenShake?: unknown }): BattleAnim {
  const value = (raw as { battleAnim?: unknown }).battleAnim;
  if (typeof value === "string" && (BATTLE_ANIMS as readonly string[]).includes(value)) {
    return value as BattleAnim;
  }
  // 旧档迁移：screenShake=false 视为玩家明确不要战斗动画
  if (raw.screenShake === false) return "off";
  return DEFAULT_SETTINGS.battleAnim;
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
