/**
 * stores/meta · 局外解锁状态（docs/16 5.3 / 6.1 的最小落地）
 *
 * 0.5 阶段只记「哪些职业通关过」，用于职业 2 的解锁式入口；
 * P6 的完整 meta 管线（解锁式卡/遗物入池）会在此基础上扩展。
 */
import { defineStore } from "pinia";
import { readSlot, writeSlot } from "@/systems/save";

interface MetaState {
  clearedClasses: string[];
}

export const useMetaStore = defineStore("meta", {
  state: () => ({
    clearedClasses: [] as string[],
    loaded: false,
  }),
  getters: {
    /** 该职业是否有通关记录。 */
    hasCleared: (state) => (classId: string) => state.clearedClasses.includes(classId),
    /** 解锁判定：unlock 缺省 / default = 初始可用；first_boss_clear = 任一职业通关一次。 */
    isUnlocked: (state) => (unlock: string | undefined) => {
      if (!unlock || unlock === "default" || unlock === "none") return true;
      if (unlock === "first_boss_clear") return state.clearedClasses.length > 0;
      return state.clearedClasses.length > 0;
    },
  },
  actions: {
    ensureLoaded(): void {
      if (this.loaded) return;
      const saved = readSlot<MetaState | null>("meta", null);
      if (saved) this.clearedClasses = saved.clearedClasses ?? [];
      this.loaded = true;
    },
    markCleared(classId: string): void {
      this.ensureLoaded();
      if (this.clearedClasses.includes(classId)) return;
      this.clearedClasses = [...this.clearedClasses, classId];
      writeSlot("meta", { clearedClasses: [...this.clearedClasses] } satisfies MetaState);
    },
    clear(): void {
      this.clearedClasses = [];
      writeSlot("meta", { clearedClasses: [] } satisfies MetaState);
    },
  },
});
