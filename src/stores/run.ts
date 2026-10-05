/**
 * stores/run · 一次远征的局外状态（地图进度 / 卡组实例 / 遗物 / 跨节点 HP）
 *
 * 玩法规则（节点推进、奖励抽取、局外 HP）全部来自 core/map；
 * 这里只做保存、投影与持久化（G2 存档）。
 */
import { defineStore } from "pinia";
import {
  advanceNode,
  createRunState,
  MAX_ENHANCEMENT_SLOTS,
  currentNode,
  healRun,
  isRunComplete,
  mapView,
  rollCardRewards,
  rollEnhancementChoices,
  setRunHp,
  type RunState,
} from "@/core/map";
import type { ActDefinition, CardDefinition, MapNode } from "@/core/registry";
import { loadGameContent } from "@/data/load";
import { clearSlot, readSlot, writeSlot } from "@/systems/save";

export { MAX_ENHANCEMENT_SLOTS };
/** 休息点回复比例（最大 HP 的 30%） */
export const REST_HEAL_RATIO = 0.3;

export interface RunCard {
  readonly cardId: string;
  readonly upgraded: boolean;
  readonly enhancements: readonly string[];
}

export interface EnhancementOffer {
  readonly id: string;
  readonly tier: number;
  readonly targets: readonly number[];
}

interface SavedRun {
  run: RunState;
  deck: RunCard[];
  relics: string[];
  acquired: string[];
}

export const useRunStore = defineStore("run", {
  state: () => ({
    active: false,
    run: null as RunState | null,
    deck: [] as RunCard[],
    relics: [] as string[],
    acquired: [] as string[],
  }),

  getters: {
    act(): ActDefinition | undefined {
      return loadGameContent().acts[0];
    },
    view(): ReturnType<typeof mapView> | null {
      return this.act && this.run ? mapView(this.run, this.act) : null;
    },
    current(): MapNode | undefined {
      return this.act && this.run ? currentNode(this.run, this.act) : undefined;
    },
    finished(): boolean {
      return !!this.act && !!this.run && isRunComplete(this.run, this.act);
    },
    hp(): number {
      return this.run?.hp ?? this.act?.player.maxHp ?? 0;
    },
    maxHp(): number {
      return this.act?.player.maxHp ?? 0;
    },
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
      const act = this.act;
      if (!act) return;
      this.run = createRunState(act, seed);
      this.deck = act.startDeck.map((cardId) => ({ cardId, upgraded: false, enhancements: [] }));
      this.relics = [...(act.startRelics ?? [])];
      this.acquired = [];
      this.active = true;
      this.persist();
    },

    /** 节点结算完成 → 推进到下一个节点。 */
    advance(): void {
      if (!this.run || !this.act) return;
      this.run = advanceNode(this.run, this.act);
      this.persist();
    },

    /** 战斗结束写回局外 HP。 */
    setHp(hp: number): void {
      if (!this.run) return;
      this.run = setRunHp(this.run, hp);
      this.persist();
    },

    /** 休息点：回复 或 升级一张卡。 */
    rest(option: "heal" | "upgrade", deckIndex = -1): void {
      if (!this.run || !this.act) return;
      if (option === "heal") {
        this.run = healRun(this.run, this.act.player.maxHp, Math.round(this.act.player.maxHp * REST_HEAL_RATIO));
      } else if (deckIndex >= 0) {
        this.upgradeCard(deckIndex);
      }
      this.persist();
    },

    addCard(cardId: string): void {
      this.deck = [...this.deck, { cardId, upgraded: false, enhancements: [] }];
      this.persist();
    },

    /** 卡奖三选一（走 reward 流，同种子可复现）。 */
    cardRewards(): string[] {
      if (!this.run) return [];
      const game = loadGameContent();
      return rollCardRewards(game.content, this.act!, this.run, this.run.nodeIndex);
    },

    /** 锻造祭坛三选一。 */
    enhancementChoices(): string[] {
      if (!this.run) return [];
      const game = loadGameContent();
      return rollEnhancementChoices(game.content, this.run, this.run.nodeIndex);
    },

    canApply(enhancementId: string, deckIndex: number): boolean {
      const enhancement = loadGameContent().content.enhancements.get(enhancementId);
      const card = this.deck[deckIndex];
      if (!enhancement || !card) return false;
      if (!enhancement.appliesTo.includes(card.cardId)) return false;
      if (card.enhancements.length >= MAX_ENHANCEMENT_SLOTS) return false;
      // 同一强化全局唯一：已给过某张卡，就不能再给别的卡
      if (this.deck.some((c) => c.enhancements.includes(enhancementId))) return false;
      const mutex = enhancement.mutex ?? [];
      return !mutex.some((m) => card.enhancements.includes(m));
    },

    offers(ids: readonly string[]): EnhancementOffer[] {
      const content = loadGameContent().content;
      return ids
        .map((id) => content.enhancements.get(id))
        .filter((e): e is NonNullable<typeof e> => e !== undefined)
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
      this.persist();
      return true;
    },

    upgradeCard(deckIndex: number): boolean {
      const card = this.deck[deckIndex];
      if (!card || card.upgraded) return false;
      this.deck = this.deck.map((c, i) => (i === deckIndex ? { ...c, upgraded: true } : c));
      this.persist();
      return true;
    },

    /* ---------- G2 存档 ---------- */

    serialize(): SavedRun | null {
      if (!this.run) return null;
      return {
        run: this.run,
        deck: this.deck.map((c) => ({ cardId: c.cardId, upgraded: c.upgraded, enhancements: [...c.enhancements] })),
        relics: [...this.relics],
        acquired: [...this.acquired],
      };
    },

    persist(): void {
      const payload = this.serialize();
      if (payload) writeSlot("progress", payload);
    },

    /** 读档并恢复"; 无档或损坏返回 false。 */
    load(): boolean {
      const saved = readSlot<SavedRun | null>("progress", null);
      if (!saved || !saved.run || !Array.isArray(saved.deck)) return false;
      this.run = saved.run;
      this.deck = saved.deck;
      this.relics = saved.relics ?? [];
      this.acquired = saved.acquired ?? [];
      this.active = true;
      return true;
    },

    clearSave(): void {
      clearSlot("progress");
      this.active = false;
      this.run = null;
      this.deck = [];
      this.relics = [];
      this.acquired = [];
    },
  },
});
