/**
 * stores/tips · 首遇提示的运行期队列（docs/41 §4.1）
 *
 * 「已读」记录在 meta 存档里（跨局不再出现）；这里只管当前局面：
 * 同屏至多 1 条，其余排队；战斗动画播放中先压住，等行动结束再弹。
 */
import { defineStore } from "pinia";
import { FIRST_TIPS } from "@/ui/first-tips";
import { useMetaStore } from "@/stores/meta";

export const useTipsStore = defineStore("tips", {
  state: () => ({
    /** 当前展示的提示 id */
    current: null as string | null,
    /** 排队的提示 id（同屏至多 1 条） */
    queue: [] as string[],
    /** 战斗动画 / 结算动画播放中：压住不弹（策划 §4.1「战斗高潮延迟」） */
    busy: false,
  }),
  getters: {
    /** 全部提示（图鉴回看用） */
    all: () => FIRST_TIPS,
  },
  actions: {
    ensureLoaded(): void {
      useMetaStore().ensureLoaded();
    },
    /** 触发一条首遇提示；已读 / 已在屏 / 已排队都会忽略。 */
    trigger(id: string): void {
      this.ensureLoaded();
      if (useMetaStore().hasSeenTip(id)) return;
      if (this.current === id || this.queue.includes(id)) return;
      if (!this.busy && this.current === null) this.current = id;
      else if (this.queue.length < 4) this.queue = [...this.queue, id];
    },
    /** 直接标记已读（教学里已经讲过的机制，在正式局首次再遇时不再弹）。 */
    markSeen(id: string): void {
      useMetaStore().markTipSeen(id);
    },

    /**
     * 教学进行中就"教过即标记"，否则正常弹（docs/42 §五）。
     * 让教学与首遇提示互为补位，而不是同一句话说两遍。
     */
    triggerUnlessTaught(id: string, taught: boolean): void {
      if (taught) this.markSeen(id);
      else this.trigger(id);
    },

    /** 玩家点掉提示（等于「不再提示」）：记入 meta，队列前移一位。 */
    dismiss(): void {
      if (this.current) useMetaStore().markTipSeen(this.current);
      this.current = this.queue[0] ?? null;
      this.queue = this.queue.slice(1);
    },
    setBusy(busy: boolean): void {
      this.busy = busy;
      if (!busy && this.current === null && this.queue.length > 0) {
        this.current = this.queue[0];
        this.queue = this.queue.slice(1);
      }
    },
    /** 图鉴页「重新显示一遍」（调试与教学复查用）。 */
    resetAll(): void {
      useMetaStore().resetTips();
      this.current = null;
      this.queue = [];
    },
  },
});
