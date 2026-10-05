/**
 * stores/codex · 图鉴「见过即解锁」（docs/16 4.7）
 *
 * 只记录"见过"的 id（卡牌 / 遗物 / 敌人），持久化到独立存档槽 codex；
 * 不参与任何数值逻辑。战斗开始、奖励展示、锻造界面都会点亮对应条目。
 */
import { defineStore } from "pinia";
import { readSlot, writeSlot } from "@/systems/save";

interface SeenState {
  cards: string[];
  relics: string[];
  enemies: string[];
}

export const useCodexStore = defineStore("codex", {
  state: () => ({
    seenCards: [] as string[],
    seenRelics: [] as string[],
    seenEnemies: [] as string[],
    loaded: false,
  }),
  getters: {
    cardSeen: (state) => (id: string) => state.seenCards.includes(id),
    relicSeen: (state) => (id: string) => state.seenRelics.includes(id),
    enemySeen: (state) => (id: string) => state.seenEnemies.includes(id),
  },
  actions: {
    ensureLoaded(): void {
      if (this.loaded) return;
      const saved = readSlot<SeenState | null>("codex", null);
      if (saved) {
        this.seenCards = saved.cards ?? [];
        this.seenRelics = saved.relics ?? [];
        this.seenEnemies = saved.enemies ?? [];
      }
      this.loaded = true;
    },
    markCards(ids: readonly string[]): void {
      this.ensureLoaded();
      const next = new Set(this.seenCards);
      for (const id of ids) next.add(id);
      if (next.size !== this.seenCards.length) {
        this.seenCards = [...next];
        this.persist();
      }
    },
    markRelics(ids: readonly string[]): void {
      this.ensureLoaded();
      const next = new Set(this.seenRelics);
      for (const id of ids) next.add(id);
      if (next.size !== this.seenRelics.length) {
        this.seenRelics = [...next];
        this.persist();
      }
    },
    markEnemies(ids: readonly string[]): void {
      this.ensureLoaded();
      const next = new Set(this.seenEnemies);
      for (const id of ids) next.add(id);
      if (next.size !== this.seenEnemies.length) {
        this.seenEnemies = [...next];
        this.persist();
      }
    },
    persist(): void {
      const payload: SeenState = {
        cards: [...this.seenCards],
        relics: [...this.seenRelics],
        enemies: [...this.seenEnemies],
      };
      writeSlot("codex", payload);
    },
    clear(): void {
      this.seenCards = [];
      this.seenRelics = [];
      this.seenEnemies = [];
      this.persist();
    },
  },
});
