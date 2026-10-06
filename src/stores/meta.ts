/**
 * stores/meta · 局外解锁状态（docs/16 5.3 / 6.1，docs/36 T1）
 *
 * 记录：通关过的职业 + 已解锁内容 id（卡 / 遗物）。内容是否入池由 core 依
 * unlockCondition + 这份 id 列表判定（core 不依赖 UI 层）。
 */
import { defineStore } from "pinia";
import { readSlot, writeSlot } from "@/systems/save";

interface MetaState {
  clearedClasses: string[];
  unlocked: string[];
}

/** 一次远征的成就输入（由 run store 汇总）。 */
export interface RunAchievements {
  readonly classId: string;
  /** 本局是否打出过任何血契卡 */
  readonly usedBloodpact: boolean;
  /** 本局触发过载反噬的次数 */
  readonly overloadCount: number;
}

export const useMetaStore = defineStore("meta", {
  state: () => ({
    clearedClasses: [] as string[],
    unlocked: [] as string[],
    /** 最近一次通关新解锁的内容 id（结算页弹提示用） */
    lastUnlocked: [] as string[],
    loaded: false,
  }),
  getters: {
    hasCleared: (state) => (classId: string) => state.clearedClasses.includes(classId),
    /** 职业解锁判定：unlock 缺省 / default = 初始可用；first_boss_clear = 任一职业通关一次。 */
    isUnlocked: (state) => (unlock: string | undefined) => {
      if (!unlock || unlock === "default" || unlock === "none") return true;
      if (unlock === "first_boss_clear") return state.clearedClasses.length > 0;
      // 第三职业（docs/38 §二 B-1）：血械 + 炉心各通关一次
      if (unlock === "both_classes_clear") {
        return state.clearedClasses.includes("bloodwright") && state.clearedClasses.includes("engineer");
      }
      return state.clearedClasses.length > 0;
    },
    /** 内容（卡/遗物）是否已解锁。 */
    isContentUnlocked: (state) => (id: string | undefined) => !id || state.unlocked.includes(id),
    /** 锈蚀难度是否解锁（通关一次）。 */
    rustUnlocked: (state) => state.clearedClasses.length > 0,
  },
  actions: {
    ensureLoaded(): void {
      if (this.loaded) return;
      const saved = readSlot<MetaState | null>("meta", null);
      if (saved) {
        this.clearedClasses = saved.clearedClasses ?? [];
        this.unlocked = saved.unlocked ?? [];
      }
      this.loaded = true;
    },
    persist(): void {
      writeSlot("meta", { clearedClasses: [...this.clearedClasses], unlocked: [...this.unlocked] } satisfies MetaState);
    },
    unlock(ids: readonly string[]): string[] {
      this.ensureLoaded();
      const gained: string[] = [];
      const next = new Set(this.unlocked);
      for (const id of ids) {
        if (next.has(id)) continue;
        next.add(id);
        gained.push(id);
      }
      if (gained.length > 0) {
        this.unlocked = [...next];
        this.persist();
      }
      return gained;
    },
    markCleared(classId: string): void {
      this.ensureLoaded();
      if (!this.clearedClasses.includes(classId)) {
        this.clearedClasses = [...this.clearedClasses, classId];
        this.persist();
      }
    },
    /**
     * 通关结算成就（docs/36 T1）：
     * - 任一职业首通 → 血锈光环
     * - 炉心机士首通 → 炉心余烬
     * - 全程未打出任何血契卡 → 不朽
     * - 单局触发过载反噬 ≥3 次 → 红线协议
     * 返回本次新解锁的内容 id。
     */
    evaluateRun(ach: RunAchievements): string[] {
      this.ensureLoaded();
      if (this.clearedClasses.length === 0) return [];
      const ids: string[] = ["bloodrust"];
      if (this.hasCleared("engineer")) ids.push("ember_core");
      if (!ach.usedBloodpact) ids.push("immortality");
      if (ach.overloadCount >= 3) ids.push("redlineprotocol");
      // 三职业各通关一次 → 朝圣者之铃（docs/38 §一.4 T3）
      if (this.clearedClasses.length >= 3) ids.push("pilgrim_bell");
      const gained = this.unlock(ids);
      this.lastUnlocked = gained;
      return gained;
    },
    clearLastUnlocked(): void {
      this.lastUnlocked = [];
    },
    clear(): void {
      this.clearedClasses = [];
      this.unlocked = [];
      this.lastUnlocked = [];
      this.persist();
    },
  },
});
