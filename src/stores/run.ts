/**
 * stores/run · 一次远征的局外状态（卡组实例 / 遗物 / 进度）
 *
 * 卡组是"实例"而非卡牌 id：锻造祭坛把强化挂到具体实例上，战斗开局按实例建卡。
 * 数值逻辑一律在 core，这里只保存数据与调用 core 的纯函数。
 */
import { defineStore } from "pinia";
import type { CardDefinition } from "@/core/registry";
import { loadGameContent } from "@/data/load";

export const MAX_ENHANCEMENT_SLOTS = 3;

export interface RunCard {
  readonly cardId: string;
  readonly upgraded: boolean;
  readonly enhancements: readonly string[];
}

export interface EnhancementOffer {
  readonly id: string;
  readonly tier: number;
  /** 本次可附着的卡组下标（appliesTo 命中且槽位未满、无互斥冲突） */
  readonly targets: readonly number[];
}

export const useRunStore = defineStore("run", {
  state: () => ({
    active: false,
    seed: 0,
    deck: [] as RunCard[],
    relics: [] as string[],
    encounterIndex: 0,
    /** 本局已获得的强化 id（用于展示） */
    acquired: [] as string[],
  }),
  getters: {
    deckSize(state): number {
      return state.deck.length;
    },
    cardDef(): (cardId: string) => CardDefinition | undefined {
      const content = loadGameContent().content;
      return (cardId: string) => content.cards.get(cardId);
    },
  },
  actions: {
    startRun(seed = (Date.now() ^ 0x9e3779b9) >>> 0): void {
      const game = loadGameContent();
      const act = game.acts[0];
      this.seed = seed >>> 0;
      this.deck = act.startDeck.map((cardId) => ({ cardId, upgraded: false, enhancements: [] }));
      this.relics = [...(act.startRelics ?? [])];
      this.encounterIndex = 0;
      this.acquired = [];
      this.active = true;
    },

    /** 该强化能否附着到某张卡（appliesTo + 槽位 + 互斥）。 */
    canApply(enhancementId: string, deckIndex: number): boolean {
      const game = loadGameContent();
      const enhancement = game.content.enhancements.get(enhancementId);
      const card = this.deck[deckIndex];
      if (!enhancement || !card) return false;
      if (!enhancement.appliesTo.includes(card.cardId)) return false;
      if (card.enhancements.length >= MAX_ENHANCEMENT_SLOTS) return false;
      if (card.enhancements.includes(enhancementId)) return false;
      const mutex = enhancement.mutex ?? [];
      if (mutex.some((m) => card.enhancements.includes(m))) return false;
      return true;
    },

    /** 锻造祭坛三选一：列出可用强化 + 各自可附着的卡组下标。 */
    offers(): EnhancementOffer[] {
      const game = loadGameContent();
      return [...game.content.enhancements.values()]
        .map((e) => ({
          id: e.id,
          tier: e.tier,
          targets: this.deck.map((_, i) => i).filter((i) => this.canApply(e.id, i)),
        }))
        .filter((o) => o.targets.length > 0);
    },

    applyEnhancement(deckIndex: number, enhancementId: string): boolean {
      if (!this.canApply(enhancementId, deckIndex)) return false;
      this.deck = this.deck.map((card, i) =>
        i === deckIndex ? { ...card, enhancements: [...card.enhancements, enhancementId] } : card,
      );
      this.acquired = [...this.acquired, enhancementId];
      return true;
    },

    upgradeCard(deckIndex: number): boolean {
      const card = this.deck[deckIndex];
      if (!card || card.upgraded) return false;
      this.deck = this.deck.map((c, i) => (i === deckIndex ? { ...c, upgraded: true } : c));
      return true;
    },

    advanceEncounter(): void {
      this.encounterIndex += 1;
    },
  },
});
